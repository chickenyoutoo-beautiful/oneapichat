<?php
header('Content-Type: application/json');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
require_once __DIR__ . '/init.php';
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Auth-Token');

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

require_once __DIR__ . '/auth_helpers.php';

/**
 * 获取用户级 config.ini 路径
 */
function userConfigPath($userId) {
    return CHAOXING_DIR . '/config_' . $userId . '.ini';
}

/** 持久化权威副本：/tmp 只供 Python 运行时使用。 */
function durableUserConfigPath($userId) {
    $safeId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$userId);
    return APP_ROOT . '/users/chaoxing/config_' . $safeId . '.ini';
}

function isValidChaoxingConfig($path) {
    clearstatcache(true, $path);
    if (!is_file($path) || filesize($path) <= 0) return false;
    $ini = @parse_ini_file($path, true, INI_SCANNER_RAW);
    return is_array($ini) && isset($ini['common']) && is_array($ini['common']);
}

function atomicWritePrivateFile($path, $contents) {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 02775, true) && !is_dir($dir)) return false;
    }
    @chgrp($dir, 'www-data');
    @chmod($dir, 02775);

    $tmp = @tempnam($dir, '.sync-');
    if ($tmp === false) {
        $tmp = @tempnam(sys_get_temp_dir(), '.sync-cx-');
        if ($tmp === false) return false;
    }
    if (@file_put_contents($tmp, $contents, LOCK_EX) === false) {
        @unlink($tmp);
        return false;
    }
    @chgrp($tmp, 'www-data');
    @chmod($tmp, 0664);

    if (!@rename($tmp, $path)) {
        if (!@copy($tmp, $path)) {
            @unlink($tmp);
            return false;
        }
        @unlink($tmp);
    }
    @chgrp($path, 'www-data');
    @chmod($path, 0664);
    return true;
}

/** 原子双写持久副本和 Python 运行镜像。 */
function saveUserConfig($userId, $contents) {
    $parsed = @parse_ini_string($contents, true, INI_SCANNER_RAW);
    if (!is_array($parsed) || !isset($parsed['common'])) {
        throw new RuntimeException('拒绝保存损坏的学习通配置');
    }
    $durable = durableUserConfigPath($userId);
    if (!atomicWritePrivateFile($durable, $contents)) {
        throw new RuntimeException('学习通持久配置同步失败');
    }
    $runtime = userConfigPath($userId);
    if (!atomicWritePrivateFile($runtime, $contents)) {
        error_log("[Chaoxing] 运行镜像同步失败: $runtime，降级使用持久配置: $durable");
        return $durable;
    }
    return $runtime;
}

/**
 * 获取用户级 PID 文件路径
 */
function userPidPath($userId) {
    return APP_TEMP . '/chaoxing_task_' . $userId . '.pid';
}

function examPidPath($userId) {
    return APP_TEMP . '/chaoxing_exam_' . $userId . '.pid';
}

/**
 * 获取任务状态文件路径（记录启动时间、启动者 tab_id）
 */
function taskStatePath($userId) {
    return APP_TEMP . '/chaoxing_task_state_' . $userId . '.json';
}

/**
 * 读取或初始化任务状态文件
 */
function readTaskState($userId) {
    $path = taskStatePath($userId);
    if (!file_exists($path)) {
        return ['started_at' => 0, 'starter_tab_id' => '', 'progress_percent' => 0];
    }
    $raw = file_get_contents($path);
    if ($raw === false) { return ['started_at' => 0, 'starter_tab_id' => '', 'progress_percent' => 0]; }
    $data = json_decode($raw, true);
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
    return APP_TEMP . '/chaoxing_task_' . $userId . '.log';
}

function examLogPath($userId) {
    return APP_TEMP . '/chaoxing_exam_' . $userId . '.log';
}

/**
 * 获取用户级课程缓存文件路径
 */
function userCoursesCachePath($userId) {
    return APP_TEMP . '/chaoxing_courses_' . md5($userId) . '.json';
}

/**
 * 确保用户 config.ini 存在且结构完整。
 *
 * /tmp 可能被系统清理，进程中断也可能留下 0 字节文件，
 * 因此不能只检查 file_exists，必须验证 [common] 节并原子替换。
 */
function ensureUserConfig($userId) {
    $path = userConfigPath($userId);
    $durable = durableUserConfigPath($userId);

    // 持久副本为权威数据：换设备、PHP 重启或 /tmp 清理后都由它恢复。
    if (isValidChaoxingConfig($durable)) {
        $contents = @file_get_contents($durable);
        if ($contents === false) throw new RuntimeException('无法读取学习通持久配置');
        if (!isValidChaoxingConfig($path) || @hash_file('sha256', $path) !== hash('sha256', $contents)) {
            if (!atomicWritePrivateFile($path, $contents)) {
                error_log("[Chaoxing] 写入运行镜像失败: $path，降级使用持久配置: $durable");
                return $durable;
            }
        }
        return $path;
    }

    // 升级时把旧 /tmp 配置一次性迁移到持久目录。
    if (isValidChaoxingConfig($path)) {
        $contents = @file_get_contents($path);
        return saveUserConfig($userId, $contents);
    }

    $template = APP_ROOT . '/config.ini.template';
    if (!is_file($template)) $template = APP_ROOT . '/config.ini';
    $contents = is_file($template) ? @file_get_contents($template) : false;
    $templateIni = $contents !== false
        ? @parse_ini_string($contents, true, INI_SCANNER_RAW)
        : false;
    if (!is_array($templateIni) || !isset($templateIni['common'])) {
        throw new RuntimeException('学习通配置模板缺失或损坏');
    }

    $contents = preg_replace('/^course_list\s*=.*$/m', 'course_list = ', $contents);
    return saveUserConfig($userId, $contents);
}

/**
 * 保存一门课程的完整配置副本（在 courses 缓存文件中，方便其他 action 读取 course_list）
 * 注意：courses 缓存是 per-user 的，但真正驱动刷任务的 course_list 存在 per-user config.ini 中
 */
function readIniValue($path, $section, $key, $default = '') {
    if (!file_exists($path)) return $default;
    $ini = @parse_ini_file($path, true, INI_SCANNER_RAW);
    if (!is_array($ini)) return $default;
    return $ini[$section][$key] ?? $default;
}

// 认证检查：Bearer / 同站 Cookie 优先，query/form 仅保留旧客户端兼容。
$authToken = extractSessionToken(true);
$userId = $authToken !== '' ? verifyAuthToken($authToken) : null;
$action = $_GET['action'] ?? '';
if ($action === 'search_answer') {
    // 搜题接口不需要认证，放行
} elseif (!$userId) {
    http_response_code(401);
    echo json_encode(['error' => '未认证，请先登录', 'code' => 'UNAUTHORIZED']);
    exit;
}
$script_dir = CHAOXING_DIR;

switch ($action) {
    case 'courses':
        $config_path = ensureUserConfig($userId);
        $cache_file = userCoursesCachePath($userId);
        $cache_ttl = 300;
        $force = ($_GET['force'] ?? '') === 'true';
        if (!$force && file_exists($cache_file) && (time() - filemtime($cache_file)) < $cache_ttl) {
            $json = file_get_contents($cache_file);
        } else {
            $cmd = pyCmd('python/chaoxing/api_get_courses.py', '--user-id ' . escapeshellarg($userId) . ' --config ' . escapeshellarg($config_path) . " 2>&1");
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
            // ★ 只缓存成功且非空的响应（空列表可能是 Cookie 失效/风控的假象，缓存后会持续误导面板 5 分钟）
            if (strpos($json, '"courses"') !== false && strpos($json, '"courses":[]') === false) {
                file_put_contents($cache_file, $json);
            } elseif (file_exists($cache_file)) {
                // 空结果或错误：顺手清掉已存在的空/旧缓存，避免下次命中
                $cached = @file_get_contents($cache_file);
                if ($cached !== false && strpos($cached, '"courses":[]') !== false) {
                    @unlink($cache_file);
                }
            }
        }
        // 从 DB 合并课程状态（通过 Python 查询，避免 PHP SQLite3 扩展依赖）
        $data = json_decode($json, true);
        if ($data && isset($data['courses'])) {
            $db_statuses = [];
            $db_videos = [];
            $db_works = [];
            // 读取用户配置，提取学习通账号（手机号）作为唯一标识
            $phone = '';
            $phone_config_path = ($config_path && file_exists($config_path)) ? $config_path : userConfigPath($userId);
            if ($phone_config_path && file_exists($phone_config_path)) {
                $ini_phone = parse_ini_file($phone_config_path, true);
                $phone = $ini_phone['common']['username'] ?? '';
            }
            $phone_arg = $phone ? '--phone ' . escapeshellarg($phone) : '';
            $db_json = shell_exec(pyCmd('python/chaoxing/db_course_status.py', '--user-id ' . escapeshellarg($userId) . " $phone_arg 2>/dev/null"));
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
            $active_config_path = ($config_path && file_exists($config_path)) ? $config_path : userConfigPath($userId);
            $course_list_str = '';
            if (file_exists($active_config_path)) {
                $ini = parse_ini_file($active_config_path, true);
                $course_list_str = $ini['common']['course_list'] ?? '';
            } else {
                // 如果用户 config 还不存在，读取 shared（兼容旧数据）
                if (file_exists(CHAOXING_DIR . '/config.ini')) {
                    $ini = parse_ini_file(CHAOXING_DIR . '/config.ini', true);
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
                // checkbox 状态：completed → 勾选+禁用；in_progress → 勾选但不禁用；not_started → 不勾选+可用
                if ($db_status === 'completed') {
                    $course['checked'] = true;
                    $course['disabled'] = true;
                } elseif ($db_status === 'in_progress') {
                    $course['checked'] = true;
                    $course['disabled'] = false;
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

        // 重置 DB 中被选课程的 in_progress 状态（允许重新刷）
        $reset_cmd = pyCmd('python/chaoxing/db_course_status.py', '--user-id ' . escapeshellarg($userId) . ' --reset-start ' . escapeshellarg($course_ids) . ' 2>/dev/null');
        exec($reset_cmd);

        // 写入 course_list 到用户级 config
        $ini = file_get_contents($config_path);
        $ini = preg_replace('/course_list = .*/', 'course_list = ' . $course_ids, $ini);
        saveUserConfig($userId, $ini);

        // 清空日志
        file_put_contents($log_path, '');

        // 启动 Python 进程，传入用户级 config
        $cmd = pyBgCmd('python/chaoxing/main.py', '-c' . escapeshellarg($config_path), $log_path);
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
                if ($fileSize > 0) {
                    $readBytes = min($fileSize, 30720); // 30KB
                    fseek($fh, $fileSize - $readBytes);
                    $raw = fread($fh, $readBytes);
                }
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
            // 最多保留最后 500 条日志行
            if (count($cleaned_lines) > 500) {
                $cleaned_lines = array_slice($cleaned_lines, -500);
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

    case 'exam_status':
        // 考试模式专用状态检查（读考试日志，不混学习日志）
        $pid_file = examPidPath($userId);
        $log_path = examLogPath($userId);

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
        if (file_exists($log_path)) {
            $raw = '';
            $fh = @fopen($log_path, 'r');
            if ($fh) {
                fseek($fh, 0, SEEK_END);
                $fileSize = ftell($fh);
                if ($fileSize > 0) {
                    $readBytes = min($fileSize, 30720);
                    fseek($fh, $fileSize - $readBytes);
                    $raw = fread($fh, $readBytes);
                }
                fclose($fh);
            }
            // 简化解析：只提取时间戳行
            $lines = explode("\n", $raw);
            $cleaned_lines = [];
            foreach ($lines as $line) {
                $line = trim($line);
                if (!$line) continue;
                // 移除 \r 进度覆盖行（考试模式不需要）
                if (strpos($line, "\r") !== false) {
                    $subParts = explode("\r", $line);
                    foreach ($subParts as $sp) {
                        $sp = trim($sp);
                        if (!$sp) continue;
                        if (strpos($sp, '2026-') === 0 || strpos($sp, '2025-') === 0) {
                            $cleaned_lines[] = $sp;
                        }
                    }
                } else {
                    $cleaned_lines[] = $line;
                }
            }
            if (count($cleaned_lines) > 500) {
                $cleaned_lines = array_slice($cleaned_lines, -500);
            }
            $log = implode("\n", $cleaned_lines);
            if (strlen($log) > 30000) $log = '...' . substr($log, -30000);
        }

        echo json_encode([
            'running' => $running,
            'log' => $log
        ]);
        break;

    case 'exam_stop':
        $pid_file = examPidPath($userId);
        $stopped = false;
        if (file_exists($pid_file)) {
            $pid = trim(file_get_contents($pid_file));
            if ($pid && is_numeric($pid)) {
                exec("kill " . intval($pid) . " 2>/dev/null");
                $stopped = true;
            }
            @unlink($pid_file);
        }
        echo json_encode(['success' => $stopped, 'message' => $stopped ? '考试已停止' : '没有运行中的考试']);
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
            saveUserConfig($userId, $ini);
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
        // 读取配置获取学习通手机号，用于精准定位账号
        $phone = '';
        if (file_exists($config_path)) {
            $ini_phone = parse_ini_file($config_path, true);
            $phone = $ini_phone['common']['username'] ?? '';
        }
        $phone_arg = $phone ? '--phone ' . escapeshellarg($phone) : '';
        $db_json = shell_exec(pyCmd('python/chaoxing/db_course_status.py', '--user-id ' . escapeshellarg($userId) . " $phone_arg 2>/dev/null"));

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

    // ── 考试模式 ────────────────────────────────
    case 'exam_list':
        // 列出所有课程的考试
        $config_path = ensureUserConfig($userId);
        $ini = parse_ini_file($config_path, true);
        $username = $ini['common']['username'] ?? '';
        $password = $ini['common']['password'] ?? '';
        $course_ids = $ini['common']['course_list'] ?? '';
        if (!$username) { echo json_encode(['error' => '未配置学习通账号']); exit; }

        // 调用 Python 脚本获取考试列表
        $tmp = sys_get_temp_dir();
        $exam_cache = $tmp . '/exam_list_' . $userId . '.json';
        $cache_ttl = 120;
        if (file_exists($exam_cache) && (time() - filemtime($exam_cache)) < $cache_ttl) {
            echo file_get_contents($exam_cache);
            exit;
        }

        $cmd = pyCmd('python/chaoxing/exam_api.py', 'list --user-id ' . escapeshellarg($userId) . ' 2>&1');
        exec($cmd, $out, $code);
        $json = implode('', $out);
        // 找 JSON 行
        foreach (array_reverse($out) as $line) {
            $line = trim($line);
            if (strpos($line, '{"exams"') === 0 || strpos($line, '{"error"') === 0) {
                $json = $line; break;
            }
        }
        if (!$json) $json = json_encode(['error' => '获取考试列表失败', 'detail' => '退出码='.$code]);
        file_put_contents($exam_cache, $json);
        echo $json;
        break;

    case 'search_answer':
        // 自动答题脚本调用的搜题接口（无需认证）
        $input = json_decode(file_get_contents('php://input'), true);
        $title = $input['title'] ?? '';
        $options = $input['options'] ?? '';
        $qtype = $input['type'] ?? 'single';
        if (!$title) { echo json_encode(['answer' => null]); break; }

        $pyScript = APP_ROOT . '/api/search_question.py';
        $cmd = 'cd ' . escapeshellarg(CHAOXING_DIR)
            . ' && PLAYWRIGHT_BROWSERS_PATH=' . escapeshellarg('/home/naujtrats/.cache/ms-playwright')
            . ' PYTHONPATH=' . escapeshellarg(APP_ROOT)
            . ' python3 ' . escapeshellarg($pyScript)
            . ' --title ' . escapeshellarg($title)
            . ' --options ' . escapeshellarg($options)
            . ' --type ' . escapeshellarg($qtype)
            . ' 2>&1';
        $output = shell_exec($cmd);
        $result = json_decode($output, true);
        echo json_encode(['answer' => $result['answer'] ?? null]);
        break;

    case 'exam_config':
        // 获取/设置考试配置
        $action = $_GET['sub'] ?? 'load';
        $config_path = APP_ROOT . '/users/' . preg_replace('/[^a-zA-Z0-9_-]/', '', $userId) . '_exam_config.json';
        if ($action === 'load') {
            $cfg = file_exists($config_path) ? json_decode(file_get_contents($config_path), true) : [];
            echo json_encode(['success' => true, 'config' => $cfg]);
        } elseif ($action === 'save') {
            $raw = file_get_contents('php://input');
            $body = json_decode($raw, true);
            $cfg = $body['config'] ?? [];
            file_put_contents($config_path, json_encode($cfg, JSON_PRETTY_PRINT));
            echo json_encode(['success' => true]);
        }
        break;

    case 'exam_start':
        // 启动考试模式
        $config_path = ensureUserConfig($userId);
        $log_path = examLogPath($userId);

        // 清空旧日志
        if (file_exists($log_path)) @unlink($log_path);

        // 检测刷课是否在运行
        $study_running = false;
        $study_pid_file = userPidPath($userId);
        if (file_exists($study_pid_file)) {
            $s_pid = trim(file_get_contents($study_pid_file));
            if ($s_pid && is_numeric($s_pid)) {
                exec("kill -0 " . intval($s_pid) . " 2>/dev/null", $null, $ec);
                if ($ec === 0) {
                    $study_running = true;
                    // 自动暂停刷课进程，避免风控
                    exec("kill " . intval($s_pid) . " 2>/dev/null");
                    @unlink($study_pid_file);
                }
            }
        }

        // 读取选中的考试列表（POST JSON body）
        $raw = file_get_contents('php://input');
        $body = json_decode($raw, true);
        $exam_list = $body['exams'] ?? [];
        $exam_json_arg = '';
        if ($exam_list && is_array($exam_list) && count($exam_list) > 0) {
            $exam_json_path = APP_TEMP . '/exam_selected_' . md5($userId) . '.json';
            file_put_contents($exam_json_path, json_encode($exam_list));
            $exam_json_arg = ' --exam-json ' . escapeshellarg($exam_json_path);
        }

        $cmd = pyBgCmd('python/chaoxing/main.py', '-c' . escapeshellarg($config_path) . ' --exam' . $exam_json_arg, $log_path);
        $pid = trim(shell_exec($cmd));
        $pid_file = examPidPath($userId);
        file_put_contents($pid_file, $pid);
        echo json_encode(['success' => true, 'pid' => $pid, 'study_running' => $study_running]);
        break;


    case 'login':
        $rawJson = @json_decode(file_get_contents('php://input'), true);
        $user = $rawJson['username'] ?? $_POST['username'] ?? $_GET['username'] ?? '';
        $pass = $rawJson['password'] ?? $_POST['password'] ?? $_GET['password'] ?? '';
        $user = trim(str_replace(["\r", "\n"], '', $user));
        $pass = trim(str_replace(["\r", "\n"], '', $pass));
        if (!$user || !$pass) { echo json_encode(['error' => '请输入账号密码']); exit; }

        // 使用独立 config
        $config_path = ensureUserConfig($userId);
        $ini = file_get_contents($config_path);

        // ★ 切换账号或重新登录时，彻底清空旧账号 Cookie 与残留缓存，避免串号
        $cookie_paths = [
            APP_ROOT . '/users/chaoxing/cookies_' . $userId . '.pkl',
            APP_TEMP . '/AutomaticCB/cookies.txt',
            APP_ROOT . '/users/chaoxing/qr_cookie_' . $userId . '.txt'
        ];
        foreach ($cookie_paths as $cp) {
            if (file_exists($cp)) @unlink($cp);
        }

        // 清理旧课程缓存与旧选课列表（新账号课程ID不同，旧列表残留会导致任务数量为0瞬间结束）
        $cache_file = userCoursesCachePath($userId);
        @unlink($cache_file);
        $ini = preg_replace('/^course_list\s*=\s*.*/m', 'course_list = ', $ini);

        // ★ 使用占位符避免密码中的 $ \ 等特殊字符被 preg_replace 当作正则元字符
        $ini = preg_replace('/^username\s*=\s*.*/m', 'username = @@@USER@@@', $ini);
        $ini = preg_replace('/^password\s*=\s*.*/m', 'password = @@@PASS@@@', $ini);
        $ini = str_replace(['@@@USER@@@', '@@@PASS@@@'], [$user, $pass], $ini);
        if ($ini === null || $ini === false || trim($ini) === '') {
            echo json_encode(['success' => false, 'error' => '配置文件异常，请刷新页面后重试']);
            exit;
        }
        saveUserConfig($userId, $ini);

        // ★ 检查超星网络连通性
        $net_test = @file_get_contents('https://passport2.chaoxing.com', false, stream_context_create(['http' => ['timeout' => 5, 'ignore_errors' => true], 'ssl' => ['verify_peer' => true]]));
        if ($net_test === false) {
            echo json_encode(['success' => false, 'error' => '无法连接超星服务器，请检查网络或稍后重试']);
            exit;
        }

        // ★ 显式带上 --force-login，真实向超星发起鉴权，绝不复用旧 Cookie！
        $cmd = pyCmd('python/chaoxing/api_get_courses.py', '--user-id ' . escapeshellarg($userId) . ' --config ' . escapeshellarg($config_path) . " --force-login 2>&1");
        exec($cmd, $out, $code);
        $json_line = '';
        foreach (array_reverse($out) as $line) {
            if (strpos(trim($line), '{"courses"') === 0) { $json_line = $line; break; }
            if (strpos(trim($line), '{"error"') === 0) { $json_line = $line; break; }
        }
        if ($json_line && strpos($json_line, '"courses"') !== false) {
            // 顺手写入课程缓存，供前端立即消费
            if (strpos($json_line, '"courses":[]') === false) {
                file_put_contents($cache_file, $json_line);
            }
            echo json_encode(['success' => true, 'username' => $user, 'synced' => true]);
        } elseif ($json_line) {
            $err_data = json_decode($json_line, true);
            $err_msg = $err_data['error'] ?? '登录验证失败，请检查账号密码';
            // ★ 如果提示密码错误，添加验证码/风控提示
            if (strpos($err_msg, '密码错误') !== false || strpos($err_msg, '用户名或密码') !== false) {
                $err_msg .= '。可能是：(1)超星要求验证码——请先在浏览器访问 https://i.chaoxing.com 手动登录一次，超星会记住设备；或 (2)账号密码确实有误，请核实。';
            }
            echo json_encode(['success' => false, 'error' => $err_msg]);
        } else {
            echo json_encode(['success' => false, 'error' => '登录验证失败：Python脚本无输出，请检查服务器日志。可能是超星接口变动或网络问题。']);
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
            'ai_key' => $tiku['ai_key'] ?? '',
            'ai_search' => $tiku['ai_search'] ?? '0',
            'ai_search_key' => $tiku['ai_search_key'] ?? ''
        ]);
        break;

    case 'save_tiku':
        $provider = str_replace(["\r", "\n"], '', $_GET['provider'] ?? 'TikuYanxi');
        $submit = ($_GET['submit'] ?? 'true') === 'true' ? 'true' : 'false';
        $tokens = str_replace(["\r", "\n"], '', $_GET['tokens'] ?? '');
        $true_list = str_replace(["\r", "\n"], '', $_GET['true_list'] ?? '正确,对,√,是');
        $false_list = str_replace(["\r", "\n"], '', $_GET['false_list'] ?? '错误,错,×,否,不对,不正确');
        $ai_base_url = str_replace(["\r", "\n"], '', $_GET['ai_base_url'] ?? '');
        $ai_model = str_replace(["\r", "\n"], '', $_GET['ai_model'] ?? '');
        $ai_key = str_replace(["\r", "\n"], '', $_GET['ai_key'] ?? '');
        $ai_search = ($_GET['ai_search'] ?? '0') === '1' || ($_GET['ai_search'] ?? '') === 'true' ? '1' : '0';
        $ai_search_key = $_GET['ai_search_key'] ?? '';

        $config_path = ensureUserConfig($userId);
        $ini = file_get_contents($config_path);
        $tiku_section = "[tiku]\nprovider=$provider\nsubmit=$submit\ntokens=$tokens\ntrue_list=$true_list\nfalse_list=$false_list";
        if (strpos($provider, 'TikuAI') !== false) {
            $tiku_section .= "\nai_base_url=$ai_base_url\nai_model=$ai_model\nai_key=$ai_key\nai_search=$ai_search\nai_search_key=$ai_search_key";
        }
        // 仅替换 [tiku] 节，不能像旧逻辑一样吞掉后面的 [netdisk] 等配置。
        $ini = preg_replace('/^\[tiku\]\R.*?(?=^\[[^\]]+\]|\z)/ms', rtrim($tiku_section) . "\n\n", $ini);
        saveUserConfig($userId, $ini);
        echo json_encode(['success' => true, 'synced' => true]);
        break;

    case 'ai_sync':
        // ★ 从主客户端真实配置同步 AI 答题配置：真实 baseUrl / apiKey（解密）/ 当前模型 / 联网搜索 key
        //   数据源: SQLite user_config 表（主客户端 chat.php save_config 的实际存储，跨设备一致）
        //   兜底: users/{uid}_config.json（旧文件存储）
        $out = ['base_url' => '', 'api_key' => '', 'model' => '', 'search_key' => '', 'search_enabled' => '0'];
        $mc = null;
        $dbPath = dirname(__DIR__) . '/users/oneapichat.db';
        try {
            $pdo = new PDO("sqlite:$dbPath");
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $stmt = $pdo->prepare("SELECT config_json FROM user_config WHERE user_id = ?");
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row) $mc = json_decode($row['config_json'], true);
        } catch (Exception $e) {}
        if (!is_array($mc)) {
            $main_config_file = dirname(__DIR__) . '/users/' . preg_replace('/[^a-zA-Z0-9_-]/', '', $userId) . '_config.json';
            if (file_exists($main_config_file)) $mc = json_decode(file_get_contents($main_config_file), true);
        }
        if (is_array($mc)) {
            $out['base_url'] = $mc['baseUrl'] ?? '';
            // ★ 从 baseUrl 反推实际提供商（域名匹配优先于 baseUrlProvider 字段，防残留旧值导致 key/model 错位）
            $bu = strtolower($mc['baseUrl'] ?? '');
            $actualProvider = '';
            if (strpos($bu, 'deepseek') !== false) $actualProvider = 'deepseek';
            elseif (strpos($bu, 'openai') !== false || strpos($bu, 'chatgpt') !== false) $actualProvider = 'openai';
            elseif (strpos($bu, 'anthropic') !== false || strpos($bu, 'claude') !== false) $actualProvider = 'anthropic';
            elseif (strpos($bu, 'gemini') !== false || strpos($bu, 'googleapis') !== false) $actualProvider = 'gemini';
            elseif (strpos($bu, 'longcat') !== false) $actualProvider = 'longcat';
            elseif (strpos($bu, 'x.ai') !== false || strpos($bu, 'grok') !== false) $actualProvider = 'xai';
            elseif (strpos($bu, 'openrouter') !== false) $actualProvider = 'openrouter';
            elseif (strpos($bu, 'minimax') !== false) $actualProvider = 'minimax';
            // ★ model：优先按实际提供商选独立键（model_{provider}），通用 model 兜底，并校验模型-提供商匹配
            $provider = $mc['baseUrlProvider'] ?? 'custom';
            $out['model'] = $mc['model'] ?? '';
            if ($actualProvider && !empty($mc['model_' . $actualProvider])) {
                $out['model'] = $mc['model_' . $actualProvider];
            }
            // ★ 模型-提供商匹配校验：若模型名明显不属于该提供商，按提供商选默认模型（防 LongCat-2.0 配 DeepSeek 端点等错位）
            $modelLower = strtolower($out['model']);
            if ($actualProvider === 'deepseek' && strpos($modelLower, 'deepseek') === false && strpos($modelLower, 'custom') === false) {
                $out['model'] = 'deepseek-v4-flash';
            } elseif ($actualProvider === 'openai' && strpos($modelLower, 'gpt') === false && strpos($modelLower, 'o1') === false && strpos($modelLower, 'o3') === false) {
                $out['model'] = 'gpt-5';
            } elseif ($actualProvider === 'anthropic' && strpos($modelLower, 'claude') === false) {
                $out['model'] = 'claude-sonnet-4-20250514';
            } elseif ($actualProvider === 'gemini' && strpos($modelLower, 'gemini') === false) {
                $out['model'] = 'gemini-2.5-flash';
            }
            // ★ apiKey：优先按 baseUrl 实际域名选提供商 key，baseUrlProvider 作次选，通用 apiKey 兜底
            $rawKey = $mc['apiKey'] ?? '';
            $provKeyMap = ['deepseek' => 'apiKeyDeepseek', 'openai' => 'apiKeyOpenai', 'xai' => 'apiKeyXAI',
                'gemini' => 'apiKeyGemini', 'custom' => 'apiKeyCustom', 'minimax' => 'apiKeyMinimax',
                'anthropic' => 'apiKeyAntthropic', 'openrouter' => 'apiKeyOpenRouter', 'longcat' => 'apiKeyLongCat'];
            foreach ([$actualProvider, $provider] as $p) {
                if (!empty($provKeyMap[$p]) && !empty($mc[$provKeyMap[$p]])) { $rawKey = $mc[$provKeyMap[$p]]; break; }
            }
            if (!empty($rawKey)) $out['api_key'] = decrypt_config_key((string)$rawKey);
            // ★ 联网搜索：按 searchProvider 选 key（tavily 优先专用键，其次通用 searchApiKey）
            $sp = $mc['searchProvider'] ?? '';
            $searchKey = '';
            if ($sp === 'tavily' && !empty($mc['searchApiKeyTavily'])) $searchKey = $mc['searchApiKeyTavily'];
            elseif ($sp === 'brave' && !empty($mc['searchApiKeyBrave'])) $searchKey = $mc['searchApiKeyBrave'];
            elseif (!empty($mc['searchApiKey'])) $searchKey = $mc['searchApiKey'];
            if (!empty($searchKey)) $out['search_key'] = decrypt_config_key((string)$searchKey);
            $out['search_enabled'] = ($mc['enableSearch'] ?? '0') === '1' || ($mc['enableSearch'] ?? '') === 'true' ? '1' : '0';
        }
        echo json_encode(['success' => true, 'ai' => $out]);
        break;

    case 'stats':
        $result = ['total_courses'=>0,'completed'=>0,'videos_done'=>0,'works_done'=>0];
        $phone = '';
        $config_path = userConfigPath($userId);
        if ($config_path && file_exists($config_path)) {
            $ini_phone = parse_ini_file($config_path, true);
            $phone = $ini_phone['common']['username'] ?? '';
        }
        $phone_arg = $phone ? '--phone ' . escapeshellarg($phone) : '';
        $db_json = shell_exec(pyCmd('python/chaoxing/db_course_status.py', '--user-id ' . escapeshellarg($userId) . " $phone_arg 2>/dev/null"));
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
            'synced' => true,
            'sync_source' => 'persistent',
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
        saveUserConfig($userId, $ini_str);
        echo json_encode(['success' => true, 'synced' => true]);
        break;

    case 'models_proxy':
        // ★ 服务端代理 /models 请求 — 绕过浏览器 CORS 限制（chaoxing.html 是单文件，无法加载 proxyFetch）
        //   前端直接 fetch 外部 API 的 /models 会被浏览器拦截，改由 PHP curl 中继（同源请求）
        $mUrl = $_GET['url'] ?? '';
        $mKey = $_GET['key'] ?? '';
        if (!$mUrl || !preg_match('#^https?://#', $mUrl)) {
            echo json_encode(['error' => 'invalid url']);
            break;
        }
        $mUrl = rtrim($mUrl, '/') . '/models';
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $mUrl,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_HTTPHEADER => $mKey ? ['Authorization: Bearer ' . $mKey, 'Content-Type: application/json'] : ['Content-Type: application/json'],
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,  // ★ 东财风控教训：强制 IPv4 防 DNS 污染
        ]);
        $resp = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $cerr = curl_error($ch);
        curl_close($ch);
        if ($httpCode >= 200 && $httpCode < 300 && $resp) {
            // 直接透传 API 原始响应（保持 data: [{id}] 格式）
            header('Content-Type: application/json');
            echo $resp;
        } else {
            echo json_encode(['error' => 'proxy fetch failed', 'http' => $httpCode, 'curl_err' => $cerr]);
        }
        break;

    default:
        echo json_encode(['error' => 'unknown action']);
}
