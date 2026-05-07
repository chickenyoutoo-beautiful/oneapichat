<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type, Auth-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ---- 全局异常处理 ----
set_exception_handler(function (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'error'   => '服务器内部错误',
        'message' => $e->getMessage(),
        'code'    => 'INTERNAL_ERROR'
    ]);
    exit;
});

// ---- 用户认证辅助（从 chat.php 复用）----
function verifyAuthToken($token) {
    $sessionsFile = '/var/www/html/oneapichat/users/sessions.json';
    if (!file_exists($sessionsFile)) return null;
    $sessions = @json_decode(@file_get_contents($sessionsFile), true);
    if (!is_array($sessions)) return null;
    $now = time();
    $expireTime = 30 * 24 * 3600;
    foreach ($sessions as $t => $info) {
        if (($now - ($info['created_at'] ?? 0)) > $expireTime) {
            unset($sessions[$t]);
        }
    }
    $info = $sessions[$token] ?? null;
    return $info ? ($info['user_id'] ?? null) : null;
}

/**
 * 获取用户级 config.ini 路径
 */
function userConfigPath($userId) {
    return '/tmp/AutomaticCB/config_' . $userId . '.ini';
}

/**
 * 获取用户级 PID 文件路径
 */
function userPidPath($userId) {
    return '/tmp/chaoxing_task_' . $userId . '.pid';
}

/**
 * 获取任务状态文件路径（记录启动时间、启动者 tab_id）
 */
function taskStatePath($userId) {
    return '/tmp/chaoxing_task_state_' . $userId . '.json';
}

/**
 * 读取或初始化任务状态文件
 */
function readTaskState($userId) {
    $path = taskStatePath($userId);
    if (!file_exists($path)) {
        return ['started_at' => 0, 'starter_tab_id' => '', 'progress_percent' => 0];
    }
    $data = @json_decode(@file_get_contents($path), true);
    if (!is_array($data)) {
        return ['started_at' => 0, 'starter_tab_id' => '', 'progress_percent' => 0];
    }
    return $data;
}

/**
 * 写入任务状态文件
 */
function writeTaskState($userId, $data) {
    $path = taskStatePath($userId);
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    file_put_contents($path, json_encode($data));
}

/**
 * 清除任务状态文件
 */
function clearTaskState($userId) {
    $path = taskStatePath($userId);
    if (file_exists($path)) {
        @unlink($path);
    }
}

/**
 * 检查是否已有运行中的进程（返回 PID 或 false）
 */
function getRunningPid($userId) {
    $pid_file = userPidPath($userId);
    if (!file_exists($pid_file)) return false;
    $pid = trim(file_get_contents($pid_file));
    if (!$pid || !is_numeric($pid)) return false;
    exec('kill -0 ' . intval($pid) . ' 2>/dev/null', $null, $exitCode);
    if ($exitCode === 0) return intval($pid);
    // 进程不存在，清理
    @unlink($pid_file);
    return false;
}

/**
 * 获取用户级日志文件路径
 */
function userLogPath($userId) {
    return '/tmp/chaoxing_task_' . $userId . '.log';
}

/**
 * 获取用户级课程缓存文件路径
 */
function userCoursesCachePath($userId) {
    return '/tmp/chaoxing_courses_' . md5($userId) . '.json';
}

/**
 * 确保用户 config.ini 存在（从模板复制）
 */
function ensureUserConfig($userId) {
    $path = userConfigPath($userId);
    if (!file_exists($path)) {
        $template = '/tmp/AutomaticCB/config.ini.template';
        if (!file_exists($template)) {
            // fallback: 用当前 shared config 作为模板
            $template = '/tmp/AutomaticCB/config.ini';
        }
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        copy($template, $path);
        // 清理 course_list
        $ini = file_get_contents($path);
        $ini = preg_replace('/^course_list\s*=.*/m', 'course_list = ', $ini);
        file_put_contents($path, $ini);
    }
    return $path;
}

/**
 * 保存一门课程的完整配置副本（在 courses 缓存文件中，方便其他 action 读取 course_list）
 * 注意：courses 缓存是 per-user 的，但真正驱动刷任务的 course_list 存在 per-user config.ini 中
 */
function readIniValue($path, $section, $key, $default = '') {
    if (!file_exists($path)) return $default;
    $ini = parse_ini_file($path, true);
    return $ini[$section][$key] ?? $default;
}

// 认证检查
$authToken = isset($_GET['auth_token']) ? preg_replace('/[^a-f0-9]/', '', $_GET['auth_token']) : (isset($_SERVER['HTTP_AUTH_TOKEN']) ? preg_replace('/[^a-f0-9]/', '', $_SERVER['HTTP_AUTH_TOKEN']) : '');
$userId = null;
if (!empty($authToken)) {
    $userId = verifyAuthToken($authToken);
}
if (!$userId) {
    http_response_code(401);
    echo json_encode(['error' => '未认证，请先登录', 'code' => 'UNAUTHORIZED']);
    exit;
}

$action = $_GET['action'] ?? '';
$script_dir = '/tmp/AutomaticCB';

switch ($action) {
    case 'courses':
        $cache_file = userCoursesCachePath($userId);
        $cache_ttl = 300;
        if (file_exists($cache_file) && (time() - filemtime($cache_file)) < $cache_ttl) {
            $json = file_get_contents($cache_file);
        } else {
            $cmd = "python3 /var/www/html/oneapichat/api_get_courses.py --user-id " . escapeshellarg($userId) . " 2>&1";
            exec($cmd, $output, $exit_code);
            $json = '';
            foreach (array_reverse($output) as $line) {
                $line = trim($line);
                if (strpos($line, '{"courses"') === 0 || strpos($line, '{"error"') === 0) {
                    $json = $line;
                    break;
                }
            }
            if (!$json) {
                echo json_encode(['error' => '获取课程列表失败', 'detail' => $exit_code == 0 ? '无JSON输出' : '退出码='.$exit_code]);
                exit;
            }
            file_put_contents($cache_file, $json);
        }
        // 从 DB 合并课程状态（通过 Python 查询，避免 PHP SQLite3 扩展依赖）
        $data = json_decode($json, true);
        if ($data && isset($data['courses'])) {
            $db_statuses = [];
            $db_videos = [];
            $db_works = [];
            $db_json = shell_exec('python3 /var/www/html/oneapichat/db_course_status.py --user-id ' . escapeshellarg($userId) . ' 2>/dev/null');
            if ($db_json) {
                $db_data = json_decode($db_json, true);
                if ($db_data && isset($db_data['courses'])) {
                    foreach ($db_data['courses'] as $row) {
                        $db_statuses[$row['id']] = $row['status'];
                        $db_videos[$row['id']] = ['done' => (int)($row['completed_videos'] ?? 0), 'total' => (int)($row['total_videos'] ?? 0)];
                        $db_works[$row['id']] = ['done' => (int)($row['completed_works'] ?? 0), 'total' => (int)($row['total_works'] ?? 0)];
                    }
                }
            }
            // 从用户自己的配置文件中读取 course_list
            $config_path = userConfigPath($userId);
            $course_list_str = '';
            if (file_exists($config_path)) {
                $ini = parse_ini_file($config_path, true);
                $course_list_str = $ini['common']['course_list'] ?? '';
            } else {
                // 如果用户 config 还不存在，读取 shared（兼容旧数据）
                if (file_exists('/tmp/AutomaticCB/config.ini')) {
                    $ini = parse_ini_file('/tmp/AutomaticCB/config.ini', true);
                    $course_list_str = $ini['common']['course_list'] ?? '';
                }
            }
            $config_course_ids = array_filter(array_map('trim', explode(',', $course_list_str)));
            foreach ($data['courses'] as &$course) {
                $cid = $course['courseId'];
                $db_status = $db_statuses[$cid] ?? 'not_started';
                // 标准化状态
                if ($db_status === 'running') $db_status = 'in_progress';
                $course['db_status'] = $db_status;
                $course['videos'] = $db_videos[$cid] ?? ['done' => 0, 'total' => 0];
                $course['works'] = $db_works[$cid] ?? ['done' => 0, 'total' => 0];
                // 正在刷课中或已完成的，checkbox 禁用 + 勾选
                $is_in_list = in_array($cid, $config_course_ids);
                if ($db_status === 'completed' || $db_status === 'in_progress' || $is_in_list) {
                    $course['checked'] = true;
                    $course['disabled'] = true;
                } else {
                    $course['checked'] = false;
                    $course['disabled'] = false;
                }
            }
            unset($course);
            echo json_encode($data);
            exit;
        }
        echo $json;
        exit;

    case 'start':
        $config_path = ensureUserConfig($userId);
        $pid_file = userPidPath($userId);
        $log_path = userLogPath($userId);

        $course_ids = $_GET['ids'] ?? '';
        if (!$course_ids) { echo json_encode(['error' => '请选择课程']); exit; }

        $tab_id = $_GET['tab_id'] ?? '';

        // 先检查旧进程是否存在
        $existingPid = getRunningPid($userId);
        if ($existingPid !== false) {
            // 任务已在运行，返回信息而不是报错
            $state = readTaskState($userId);
            echo json_encode([
                'running' => true,
                'already_started' => true,
                'pid' => $existingPid,
                'starter_tab_id' => $state['starter_tab_id'] ?? ''
            ]);
            exit;
        }

        // 清理旧状态/pid/log文件
        @unlink($pid_file);
        clearTaskState($userId);

        // 写入 course_list 到用户级 config
        $ini = file_get_contents($config_path);
        $ini = preg_replace('/course_list = .*/', 'course_list = ' . $course_ids, $ini);
        file_put_contents($config_path, $ini);

        // 清空日志
        file_put_contents($log_path, '');

        // 启动 Python 进程，传入用户级 config
        $cmd = "cd $script_dir && CHAOXING_USER_ID=" . escapeshellarg($userId) . " PYTHONPATH=/tmp/pylib:/home/naujtrats/.local/lib/python3.12/site-packages python3 main.py -c " . escapeshellarg($config_path) . " > " . escapeshellarg($log_path) . " 2>&1 & echo \$!";
        $pid = trim(shell_exec($cmd));
        file_put_contents($pid_file, $pid);

        // 写入任务状态（启动时间、启动者 tab_id）
        writeTaskState($userId, [
            'started_at' => time(),
            'starter_tab_id' => $tab_id,
            'progress_percent' => 0
        ]);

        echo json_encode(['success' => true, 'pid' => $pid]);
        break;

    case 'status':
        $pid_file = userPidPath($userId);
        $log_path = userLogPath($userId);

        $running = false;
        if (file_exists($pid_file)) {
            $pid = trim(file_get_contents($pid_file));
            if ($pid && is_numeric($pid)) {
                exec("kill -0 " . intval($pid) . " 2>/dev/null", $null, $exitCode);
                $running = ($exitCode === 0);
            }
            if (!$running) @unlink($pid_file);
        }
        $log = '';
        $progress = 0;
        if (file_exists($log_path)) {
            // 读最后 30KB 提高性能
            $raw = '';
            $fh = @fopen($log_path, 'r');
            if ($fh) {
                fseek($fh, 0, SEEK_END);
                $fileSize = ftell($fh);
                $readBytes = min($fileSize, 30720); // 30KB
                fseek($fh, $fileSize - $readBytes);
                $raw = fread($fh, $readBytes);
                fclose($fh);
            }
            // ★ 正确解析 \r（视频进度覆盖）和 \n（正常日志）混合的日志
            // Python 用 print(..., end='\r') 覆盖进度，正常日志用 \n 换行
            $cleaned_lines = [];
            $lastProgressLine = '';
            $lines = explode("\n", $raw);
            $pending_traceback = []; // 跟踪当前 ERROR 行的后续 traceback 行
            foreach ($lines as $line) {
                $line = trim($line);
                if (!$line) continue;
                // 行内可能包含多个 \r 分隔的进度覆盖
                if (strpos($line, "\r") !== false) {
                    $subParts = explode("\r", $line);
                    $hasTimestampedPart = false;
                    foreach ($subParts as $sp) {
                        $sp = trim($sp);
                        if (!$sp) continue;
                        $isTimestamped = (strpos($sp, '2026-') === 0 || strpos($sp, '2025-') === 0);
                        if (strpos($sp, '当前任务:') === 0) {
                            $lastProgressLine = $sp;
                            if (preg_match('/\|\s*(\d+)%/', $sp, $pm)) $progress = (int)$pm[1];
                        } elseif ($isTimestamped) {
                            $hasTimestampedPart = true;
                            // 先把之前收集的 traceback 附加到上一条 ERROR 行
                            if (!empty($pending_traceback)) {
                                $lastIdx = count($cleaned_lines) - 1;
                                if ($lastIdx >= 0) {
                                    $cleaned_lines[$lastIdx] .= '\n' . implode('\n', $pending_traceback);
                                }
                                $pending_traceback = [];
                            }
                            $cleaned_lines[] = $sp;
                        }
                    }
                    // 收集非时间戳的子部分作为 traceback（\r 分隔的行中不属于进度的部分）
                    if ($hasTimestampedPart && count($subParts) > 1) {
                        foreach ($subParts as $sp) {
                            $sp = trim($sp);
                            if (!$sp) continue;
                            if (strpos($sp, '2026-') !== 0 && strpos($sp, '2025-') !== 0 && strpos($sp, '当前任务:') !== 0) {
                                $pending_traceback[] = $sp;
                            }
                        }
                    }
                } else {
                    // 先把之前收集的 traceback 附加到上一条 ERROR 行
                    if (!empty($pending_traceback)) {
                        $lastIdx = count($cleaned_lines) - 1;
                        if ($lastIdx >= 0) {
                            $cleaned_lines[$lastIdx] .= '\n' . implode('\n', $pending_traceback);
                        }
                        $pending_traceback = [];
                    }
                    if (strpos($line, '当前任务:') === 0) {
                        $lastProgressLine = $line;
                        if (preg_match('/\|\s*(\d+)%/', $line, $pm)) $progress = (int)$pm[1];
                    } elseif (strpos($line, '2026-') === 0 || strpos($line, '2025-') === 0) {
                        $cleaned_lines[] = $line;
                    } else {
                        // 非时间戳行：作为下一条时间戳行的 traceback 收集
                        $pending_traceback[] = $line;
                    }
                }
            }
            // 文件末尾如果还有未发出的 traceback，附加到最后一条日志行
            if (!empty($pending_traceback) && !empty($cleaned_lines)) {
                $lastIdx = count($cleaned_lines) - 1;
                $cleaned_lines[$lastIdx] .= '\n' . implode('\n', $pending_traceback);
            }
            // 最多保留最后 100 条日志行
            if (count($cleaned_lines) > 100) {
                $cleaned_lines = array_slice($cleaned_lines, -100);
            }
            $cleaned = implode("\n", $cleaned_lines);
            if ($lastProgressLine) {
                $cleaned .= "\n" . $lastProgressLine;
            }
            if (strlen($cleaned) > 30000) $log = '...' . substr($cleaned, -30000);
            else $log = $cleaned;
        }

        // 读取任务状态（包含启动者和进度）
        $state = readTaskState($userId);
        if ($progress > 0) {
            $state['progress_percent'] = $progress;
            writeTaskState($userId, $state);
        }

        echo json_encode([
            'running' => $running,
            'log' => $log,
            'progress' => $progress,
            'starter_tab_id' => $state['starter_tab_id'] ?? '',
            'started_at' => $state['started_at'] ?? 0
        ]);
        break;

    case 'poll':
        // 轻量级状态检查，不带日志内容
        $pid_file = userPidPath($userId);

        $running = false;
        if (file_exists($pid_file)) {
            $pid = trim(file_get_contents($pid_file));
            if ($pid && is_numeric($pid)) {
                exec("kill -0 " . intval($pid) . " 2>/dev/null", $null, $exitCode);
                $running = ($exitCode === 0);
            }
            if (!$running) @unlink($pid_file);
        }

        // 从状态文件获取进度
        $state = readTaskState($userId);

        echo json_encode([
            'running' => $running,
            'progress_percent' => (int)($state['progress_percent'] ?? 0),
            'starter_tab_id' => $state['starter_tab_id'] ?? '',
            'started_at' => $state['started_at'] ?? 0
        ]);
        break;

    case 'stop':
        $pid_file = userPidPath($userId);
        $log_path = userLogPath($userId);
        $config_path = userConfigPath($userId);
        $cache_file = userCoursesCachePath($userId);

        $tab_id = $_GET['tab_id'] ?? '';

        if (file_exists($pid_file)) {
            $pid = trim(file_get_contents($pid_file));
            if ($pid) exec("kill $pid 2>/dev/null");
            @unlink($pid_file);
        }

        // 清空 course_list
        if (file_exists($config_path)) {
            $ini = file_get_contents($config_path);
            $ini = preg_replace('/^course_list\s*=.*/m', 'course_list = ', $ini);
            file_put_contents($config_path, $ini);
        }

        // 删除日志文件
        if (file_exists($log_path)) {
            @unlink($log_path);
        }

        // 清理课程缓存
        if (file_exists($cache_file)) {
            @unlink($cache_file);
        }

        // 清理任务状态
        clearTaskState($userId);

        // ★ 重置该用户在 DB 里的 in_progress 课程状态（防止崩溃后课程卡在"刷课中"）
        @shell_exec('python3 /var/www/html/oneapichat/db_course_status.py --user-id ' . escapeshellarg($userId) . ' --reset-in-progress 2>/dev/null');

        echo json_encode(['success' => true]);
        break;

    case 'account':
        $config_path = ensureUserConfig($userId);
        $ini = parse_ini_file($config_path, true);
        $username = $ini['common']['username'] ?? '';
        $masked = '';
        if (strlen($username) > 4) {
            $masked = substr($username, 0, 3) . '****' . substr($username, -4);
        } elseif (strlen($username) > 0) {
            $masked = substr($username, 0, 1) . '****';
        }
        echo json_encode([
            'username' => $username,
            'masked' => $masked
        ]);
        break;

    case 'login':
        $user = $_POST['username'] ?? $_GET['username'] ?? '';
        $pass = $_POST['password'] ?? $_GET['password'] ?? '';
        if (!$user || !$pass) { echo json_encode(['error' => '请输入账号密码']); exit; }

        // 使用独立 config
        $config_path = ensureUserConfig($userId);
        $ini = file_get_contents($config_path);
        $ini = preg_replace('/username = .*/', 'username = ' . $user, $ini);
        $ini = preg_replace('/password = .*/', 'password = ' . $pass, $ini);
        file_put_contents($config_path, $ini);

        // 清理缓存
        $cache_file = userCoursesCachePath($userId);
        @unlink($cache_file);

        $cmd = "python3 /var/www/html/oneapichat/api_get_courses.py --user-id " . escapeshellarg($userId) . " 2>&1";
        exec($cmd, $out, $code);
        $json_line = '';
        foreach (array_reverse($out) as $line) {
            if (strpos(trim($line), '{"courses"') === 0) { $json_line = $line; break; }
            if (strpos(trim($line), '{"error"') === 0) { $json_line = $line; break; }
        }
        if ($json_line && strpos($json_line, '"courses"') !== false) {
            echo json_encode(['success' => true, 'username' => $user]);
        } else {
            echo json_encode(['success' => false, 'error' => '登录验证失败，请检查账号密码']);
        }
        break;

    case 'tiku_config':
        $config_path = ensureUserConfig($userId);
        $ini = parse_ini_file($config_path, true);
        $tiku = $ini['tiku'] ?? [];
        $submit = ($tiku['submit'] ?? 'true') === 'true' || $tiku['submit'] === '1' || $tiku['submit'] === true;
        echo json_encode([
            'provider' => $tiku['provider'] ?? 'TikuYanxi',
            'submit' => $submit,
            'tokens' => $tiku['tokens'] ?? '',
            'true_list' => $tiku['true_list'] ?? '正确,对,√,是',
            'false_list' => $tiku['false_list'] ?? '错误,错,×,否,不对,不正确',
            'ai_base_url' => $tiku['ai_base_url'] ?? '',
            'ai_model' => $tiku['ai_model'] ?? '',
            'ai_key' => $tiku['ai_key'] ?? ''
        ]);
        break;

    case 'save_tiku':
        $provider = $_GET['provider'] ?? 'TikuYanxi';
        $submit = ($_GET['submit'] ?? 'true') === 'true' ? 'true' : 'false';
        $tokens = $_GET['tokens'] ?? '';
        $true_list = $_GET['true_list'] ?? '正确,对,√,是';
        $false_list = $_GET['false_list'] ?? '错误,错,×,否,不对,不正确';
        $ai_base_url = $_GET['ai_base_url'] ?? '';
        $ai_model = $_GET['ai_model'] ?? '';
        $ai_key = $_GET['ai_key'] ?? '';

        $config_path = ensureUserConfig($userId);
        $ini = file_get_contents($config_path);
        $tiku_section = "[tiku]\nprovider=$provider\nsubmit=$submit\ntokens=$tokens\ntrue_list=$true_list\nfalse_list=$false_list";
        if (strpos($provider, 'TikuAI') !== false) {
            $tiku_section .= "\nai_base_url=$ai_base_url\nai_model=$ai_model\nai_key=$ai_key";
        }
        $ini = preg_replace('/\[tiku\].*/s', $tiku_section, $ini);
        file_put_contents($config_path, $ini);
        echo json_encode(['success' => true]);
        break;

    case 'stats':
        $result = ['total_courses'=>0,'completed'=>0,'videos_done'=>0,'works_done'=>0];
        $db_json = shell_exec('python3 /var/www/html/oneapichat/db_course_status.py --user-id ' . escapeshellarg($userId) . ' 2>/dev/null');
        if ($db_json) {
            $db_data = json_decode($db_json, true);
            if ($db_data && isset($db_data['courses'])) {
                foreach ($db_data['courses'] as $row) {
                    $result['total_courses']++;
                    if ($row['status'] === 'completed') $result['completed']++;
                    $result['videos_done'] += (int)($row['completed_videos'] ?? 0);
                    $result['works_done'] += (int)($row['completed_works'] ?? 0);
                }
            }
        }
        echo json_encode($result);
        break;

    case 'config':
        $config_path = ensureUserConfig($userId);
        $ini = parse_ini_file($config_path, true);
        $common = $ini['common'] ?? [];
        $tiku = $ini['tiku'] ?? [];
        echo json_encode([
            'username' => $common['username'] ?? '',
            'course_list' => $common['course_list'] ?? '',
            'speed' => $common['speed'] ?? '2',
            'auto_next' => isset($common['auto_next']) ? ($common['auto_next'] === 'true' || $common['auto_next'] === '1' || $common['auto_next'] === true) : true,
            'brush_mode' => $common['brush_mode'] ?? 'all',
            'chapter_order' => $common['chapter_order'] ?? 'sequential',
            'tiku' => [
                'provider' => $tiku['provider'] ?? 'TikuYanxi',
                'tokens' => $tiku['tokens'] ?? '',
                'submit' => ($tiku['submit'] ?? 'true') === 'true' || $tiku['submit'] === '1',
                'true_list' => $tiku['true_list'] ?? '正确,对,√,是',
                'false_list' => $tiku['false_list'] ?? '错误,错,×,否,不对,不正确',
                'ai_base_url' => $tiku['ai_base_url'] ?? '',
                'ai_model' => $tiku['ai_model'] ?? '',
                'ai_key' => $tiku['ai_key'] ?? ''
            ]
        ]);
        break;

    case 'save_config':
        $config_path = ensureUserConfig($userId);
        $ini_str = file_get_contents($config_path);
        $fields = ['speed', 'auto_next', 'brush_mode', 'chapter_order'];
        foreach ($fields as $f) {
            if (isset($_GET[$f])) {
                $v = $_GET[$f];
                $ini_str = preg_replace(
                    '/^' . preg_quote($f, '/') . '\s*=.*$/m',
                    $f . ' = ' . $v,
                    $ini_str
                );
            }
        }
        if (!preg_match('/^auto_next\s*=/m', $ini_str)) {
            $v = $_GET['auto_next'] ?? 'true';
            $ini_str = preg_replace('/^(speed\s*=.*)$/m', "$1\nauto_next = $v", $ini_str);
        }
        if (!preg_match('/^brush_mode\s*=/m', $ini_str)) {
            $v = $_GET['brush_mode'] ?? 'all';
            $ini_str = preg_replace('/^(auto_next\s*=.*)$/m', "$1\nbrush_mode = $v", $ini_str);
        }
        if (!preg_match('/^chapter_order\s*=/m', $ini_str)) {
            $v = $_GET['chapter_order'] ?? 'sequential';
            $ini_str = preg_replace('/^(brush_mode\s*=.*)$/m', "$1\nchapter_order = $v", $ini_str);
        }
        file_put_contents($config_path, $ini_str);
        echo json_encode(['success' => true]);
        break;

    default:
        echo json_encode(['error' => 'unknown action']);
}

