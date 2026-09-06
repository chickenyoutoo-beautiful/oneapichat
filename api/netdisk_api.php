<?php
/**
 * netdisk_api.php — 网盘解析 API 代理 v1.0
 *
 * 支持: 百度网盘、夸克网盘、阿里云盘、天翼云盘、迅雷网盘、移动网盘、UC网盘、123网盘
 * 解析策略: 本地解析引擎 → 第三方API → 浏览器抓取
 *
 * 动作:
 *   parse        解析网盘链接获取直链
 *   download     使用aria2下载文件到服务器
 *   parse_and_download  解析+下载一键完成
 *   download_status     查询下载进度
 *   config       检查/设置解析配置
 */

require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';

header('Content-Type: application/json; charset=utf-8');

// ── 认证 ──
// Bearer / 同站 Cookie 优先；legacy query/form 只保留旧客户端兼容。
$authToken = extractSessionToken(true);
$userId = $authToken !== '' ? verifyAuthToken($authToken) : null;

// ── 辅助函数 ──
function netdisk_success($data = null, $extra = []) {
    echo json_encode(array_merge(['success' => true], $extra, $data ?: []));
    exit;
}

function netdisk_error($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $msg]);
    exit;
}

// Cookie/动态会话请求头只允许留在服务端下载链路，禁止回传给模型或浏览器日志。
function netdisk_public_result($value) {
    if (!is_array($value)) return $value;
    $out = [];
    foreach ($value as $key => $item) {
        if (strtolower((string)$key) === 'headers') continue;
        $out[$key] = is_array($item) ? netdisk_public_result($item) : $item;
    }
    return $out;
}

function identify_netdisk_type($url) {
    $patterns = [
        'baidu'   => '/pan\.baidu\.com/',
        'quark'   => '/pan\.quark\.cn/',
        'aliyun'  => '/(alipan\.com|aliyundrive\.com)/',
        'tianyi'  => '/cloud\.189\.cn/',
        'xunlei'  => '/pan\.xunlei\.com/',
        'mobile'  => '/(yun\.139\.com|caiyun\.139\.com)/',
        'uc'      => '/(drive\.uc\.cn|fast\.uc\.cn)/',
        '123'     => '/123pan\.com/',
        // ★ ilanzou 必须先于 lanzou, 且 lanzou 模式用 (?:^|[^a-z0-9]) 避免误命中 "ilanzou.com"
        'ilanzou' => '/(?:^|[^a-z0-9])ilanzou\.com/',
        'lanzou'  => '/(?:^|[^a-z0-9])lanzou[a-z]*\.com|lanzous\.com/',
        'feijipan' => '/feijipan\.com/',
        'guangyapan' => '/guangyapan\.com/',
    ];
    foreach ($patterns as $type => $pattern) {
        if (preg_match($pattern, $url)) return $type;
    }
    return 'unknown';
}

// ── JxPan (自部署 Cloudflare Worker 网盘直链解析) 兜底 ──
function get_jxpan_api() {
    static $api = null;
    if ($api === null) {
        $api = getenv('JXPAN_API') ?: '';
        if (!$api) {
            $ini = @parse_ini_file(APP_ROOT . '/config.ini', true);
            $api = trim($ini['netdisk']['jxpan_api'] ?? '');
        }
    }
    return $api;
}

function jxpan_parse($url, $password) {
    $api = get_jxpan_api();
    if ($api === '') return null;
    // JxPan Worker 对百度链接会抛 Cloudflare 1101 异常, 直接跳过(百度走 Playwright 兜底)
    if (preg_match('/pan\.baidu\.com/', $url)) return null;
    $apiUrl = rtrim($api, '/') . '/?url=' . urlencode($url) . '&type=json';
    if ($password !== '') $apiUrl .= '&pwd=' . urlencode($password);
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $apiUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; oneapichat-netdisk)',
    ]);
    $resp = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if (!$resp) return ['success' => false, 'error' => 'JxPan 请求失败: ' . ($err ?: '空响应')];
    $data = json_decode($resp, true);
    if (!is_array($data)) return ['success' => false, 'error' => 'JxPan 返回非JSON'];
    if (empty($data['success']) || empty($data['data']['download_url'])) {
        $msg = $data['msg'] ?? ($data['error'] ?? '解析失败');
        return ['success' => false, 'error' => 'JxPan: ' . $msg];
    }
    $d = $data['data'];
    $size = 0;
    if (isset($d['file_size']) && is_string($d['file_size'])) {
        // 兼容 "58.3 M" / "1.2G" / "300MB" 等常见格式
        if (preg_match('/^([\d.]+)\s*([KMGT]?B?)$/i', trim($d['file_size']), $m)) {
            $units = [
                'B' => 1, 'KB' => 1024, 'K' => 1024,
                'MB' => 1048576, 'M' => 1048576,
                'GB' => 1073741824, 'G' => 1073741824,
                'TB' => 1099511627776, 'T' => 1099511627776,
            ];
            $size = (int)round((float)$m[1] * $units[strtoupper($m[2])]);
        } elseif (is_numeric($d['file_size'])) {
            $size = (int)$d['file_size'];
        }
    }
    return [
        'success' => true,
        'direct_url' => $d['download_url'],
        'filename' => $d['file_name'] ?? '',
        'file_size' => $size,
        'netdisk_type' => 'jxpan',
        'source' => 'jxpan',
        'headers' => $d['headers'] ?? null,
    ];
}

// 统一解析入口: 本地解析器 → JxPan 兜底(百度除外, 百度已有 Playwright 兜底)
function resolve_parse($type, $url, $password) {
    switch ($type) {
        case 'baidu':  $local = parse_baidu_link($url, $password); break;
        case 'quark':  $local = parse_quark_link($url, $password); break;
        case 'aliyun': $local = parse_aliyun_link($url, $password); break;
        default:       $local = parse_generic($url, $password); break;
    }
    if (!empty($local['success'])) return $local;
    // JxPan 不支持蓝奏云；调用它只会把“密码错误”这类无关信息拼到蓝奏云失败里。
    if ($type !== 'baidu' && $type !== 'lanzou' && $type !== 'ilanzou') {
        $jx = jxpan_parse($url, $password);
        if ($jx && !empty($jx['success'])) return $jx;
        if ($jx && !empty($jx['error'])) {
            $local['error'] = ($local['error'] ?? '') . '; ' . $jx['error'];
        }
    }
    return $local;
}

// ── 解析引擎 ──

/**
 * 百度网盘解析
 * 策略: 使用 BaiduPCS-API 或 netdisk-fast-download 兼容接口
 */
function parse_baidu_link($url, $password) {
    // ★ 调用通用 Python 解析器 (支持Cookie认证)
    $scriptPath = __DIR__ . '/../python/netdisk/netdisk_parser.py';
    if (file_exists($scriptPath)) {
        $cmd = sprintf(
            '%s %s %s %s 2>&1',
            pythonBin(),
            escapeshellarg($scriptPath),
            escapeshellarg($url),
            escapeshellarg($password)
        );
        $output = shell_exec($cmd);
        if ($output) {
            $result = json_decode($output, true);
            if ($result && !empty($result['success'])) return $result;
            // ★ 失败时不直接返回: 继续走浏览器兜底(旧API流程对新版SPA页面已失效)
        }
    }

    // ★ 浏览器兜底: 新版 pan.baidu.com 分享页是 SPA, 旧API流程已失效。
    //   通过 MCP 服务器(naujtrats用户, 有Playwright + 登录Cookie)解析,
    //   自动填提取码并捕获 sharedownload 直链。
    $mcpBody = json_encode(['name' => 'netdisk_login', 'arguments' => [
        'action' => 'parse', 'service' => 'baidu', 'url' => $url, 'password' => $password,
    ]], JSON_UNESCAPED_UNICODE);
    $mcpCtx = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\n",
        'content' => $mcpBody,
        'timeout' => 130,
        'ignore_errors' => true,
    ]]);
    $mcpResp = @file_get_contents('http://127.0.0.1:18788/mcp/api/tools/call', false, $mcpCtx);
    $mcpFailError = null;
    if ($mcpResp) {
        $mcpData = json_decode($mcpResp, true);
        $mcpResult = $mcpData['result'] ?? $mcpData ?? null;
        if (is_string($mcpResult)) { $mcpResult = json_decode($mcpResult, true) ?: $mcpResult; }
        if (is_array($mcpResult) && !empty($mcpResult['success'])) return $mcpResult;
        // ★ 验证码人机协助: 把验证码图片/vcode 原样返回, 由用户提供验证码后重试
        if (is_array($mcpResult) && !empty($mcpResult['captcha_required'])) return $mcpResult;
        if (is_array($mcpResult) && !empty($mcpResult['error'])) $mcpFailError = $mcpResult['error'];
    }

    // 回退: 使用 netdisk-fast-download API (如果本地部署)
    $localApi = 'http://127.0.0.1:18080/api/parse';
    $apiUrl = $localApi . '?url=' . urlencode($url) . '&pwd=' . urlencode($password);
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $apiUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && $resp) {
        $data = json_decode($resp, true);
        if ($data && !empty($data['url'])) {
            return [
                'success' => true,
                'direct_url' => $data['url'],
                'filename' => $data['file_name'] ?? null,
                'file_size' => $data['file_size'] ?? null,
                'netdisk_type' => 'baidu',
            ];
        }
    }

    $finalError = $mcpFailError ?: '百度网盘解析失败: 请检查链接和密码是否正确';
    return ['success' => false, 'error' => $finalError];
}

/**
 * 夸克网盘解析
 */
function parse_quark_link($url, $password) {
    if (!preg_match('/s\/([a-zA-Z0-9]+)/', $url, $m)) {
        return ['success' => false, 'error' => '无法提取夸克网盘分享ID'];
    }
    // ★ 调用通用 Python 解析器
    $scriptPath = __DIR__ . '/../python/netdisk/netdisk_parser.py';
    if (file_exists($scriptPath)) {
        $cmd = sprintf(
            '%s %s %s %s 2>&1',
            pythonBin(),
            escapeshellarg($scriptPath),
            escapeshellarg($url),
            escapeshellarg($password)
        );
        $output = shell_exec($cmd);
        if ($output) {
            $result = json_decode($output, true);
            if ($result) return $result;
        }
    }

    return ['success' => false, 'error' => '夸克网盘解析失败: 请检查链接是否正确'];
}

/**
 * 阿里云盘解析
 */
function parse_aliyun_link($url, $password) {
    // 提取 share_id
    if (!preg_match('/s\/([a-zA-Z0-9]+)/', $url, $m)) {
        return ['success' => false, 'error' => '无法提取阿里云盘分享ID'];
    }

    // ★ 使用统一 Python 解析器 (netdisk_parser.py 内含 parse_aliyun: refresh_token → 直链)
    $scriptPath = __DIR__ . '/../python/netdisk/netdisk_parser.py';
    if (file_exists($scriptPath)) {
        $cmd = sprintf(
            '%s %s %s %s 2>&1',
            pythonBin(),
            escapeshellarg($scriptPath),
            escapeshellarg($url),
            escapeshellarg($password)
        );
        $output = shell_exec($cmd);
        if ($output) {
            $result = json_decode($output, true);
            if ($result) return $result;
            return ['success' => false, 'error' => '阿里云盘解析引擎返回异常: ' . substr($output, 0, 200)];
        }
    }

    return ['success' => false, 'error' => '阿里云盘解析引擎未安装'];
}

/**
 * 通用解析入口 — 使用 Python 统一解析器
 */
function parse_generic($url, $password) {
    $scriptPath = __DIR__ . '/../python/netdisk/netdisk_parser.py';
    if (!file_exists($scriptPath)) {
        return ['success' => false, 'error' => '解析引擎未安装'];
    }

    $cmd = sprintf(
        '%s %s %s %s 2>&1',
        pythonBin(),
        escapeshellarg($scriptPath),
        escapeshellarg($url),
        escapeshellarg($password)
    );
    $output = shell_exec($cmd);
    if ($output) {
        $result = json_decode($output, true);
        if ($result && !empty($result['success'])) return $result;
        $failedResult = $result ?: ['success' => false, 'error' => '解析引擎无输出'];

        // ★ 蓝奏云浏览器兜底: 页面被阿里云WAF JS挑战拦截, 纯Python拿不到真实页面。
        //   Playwright(以 naujtrats 身份, 由MCP服务运行) 自动执行JS挑战后提取sign请求ajaxm.php。
        if (preg_match('/(?:^|[^a-z0-9])(?:wws?\.)?lanzou[a-z]*\.com|lanzous\.com/i', $url)) {
            $mcpBody = json_encode(['name' => 'netdisk_login', 'arguments' => [
                'action' => 'parse', 'service' => 'lanzou', 'url' => $url, 'password' => $password,
            ]], JSON_UNESCAPED_UNICODE);
            $mcpCtx = stream_context_create(['http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $mcpBody,
                'timeout' => 90,
                'ignore_errors' => true,
            ]]);
            $mcpResp = @file_get_contents('http://127.0.0.1:18788/mcp/api/tools/call', false, $mcpCtx);
            if ($mcpResp) {
                $mcpData = json_decode($mcpResp, true);
                $mcpResult = $mcpData['result'] ?? $mcpData ?? null;
                if (is_string($mcpResult)) { $mcpResult = json_decode($mcpResult, true) ?: $mcpResult; }
                if (is_array($mcpResult) && !empty($mcpResult['success'])) return $mcpResult;
            }
        }

        return $failedResult;
    }
    return ['success' => false, 'error' => '解析引擎无输出'];
}

/**
 * 使用 aria2 下载文件
 */
function download_file($url, $filename, $outputDir, $threads, $headers = null) {
    global $userId; // ★ 2026-08-03: 下载完成按用户同步云盘
    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        return ['success' => false, 'error' => '无效的下载链接'];
    }

    // 安全检查: 下载目录必须在 uploads/ 下
    $realOutputDir = realpath($outputDir);
    $uploadsDir = realpath(__DIR__ . '/../uploads');
    if ($realOutputDir === false || strpos($realOutputDir, $uploadsDir) !== 0) {
        // 默认使用用户下载目录
        $outputDir = __DIR__ . '/../uploads/downloads';
        if (!is_dir($outputDir)) {
            mkdir($outputDir, 0755, true);
        }
    }

    $threads = min(max(intval($threads), 1), 32);
    $cmd = sprintf(
        'aria2c -s %d -x %d -k 4M -d %s --file-allocation=none --continue=true --console-log-level=warn --allow-overwrite=true --max-tries=5 --retry-wait=3 --timeout=60 --connect-timeout=20',
        $threads, $threads,
        escapeshellarg($outputDir)
    );
    // ★ 带完整会话请求头下载。夸克直链的 Cookie 会动态轮换，且多连接/重试
    // 必须继续携带 Referer 与 UA，否则 CDN 常返回 403 或反复超时。
    if (is_array($headers)) {
        foreach (['Cookie', 'Accept', 'Origin'] as $hk) {
            if (!empty($headers[$hk])) {
                $cmd .= ' --header=' . escapeshellarg($hk . ': ' . $headers[$hk]);
            }
        }
        if (!empty($headers['Referer'])) {
            $cmd .= ' --referer=' . escapeshellarg($headers['Referer']);
        }
        if (!empty($headers['User-Agent'])) {
            $cmd .= ' --user-agent=' . escapeshellarg($headers['User-Agent']);
        }
    }
    if ($filename) {
        $cmd .= ' -o ' . escapeshellarg(basename($filename));
    }
    $cmd .= ' ' . escapeshellarg($url) . ' 2>&1';

    exec($cmd, $output, $returnCode);

    if ($returnCode === 0) {
        // ★ 2026-08-03 云盘全面结合: 下载完成自动同步到用户 Cloudreve 账号 OneAPIChat/downloads
        // ★ 2026-08-09 大文件异步同步: >5GB 走 Python 后台上传, 避免 PHP 超时
        $cloudreve = null;
        if ($userId) {
            $downloadedFile = $filename ? $outputDir . '/' . basename($filename) : '';
            if (!$downloadedFile || !is_file($downloadedFile)) {
                // 无显式文件名: 取目录内最新文件
                $dirFiles = glob($outputDir . '/*');
                usort($dirFiles, function($a, $b) { return filemtime($b) - filemtime($a); });
                $downloadedFile = $dirFiles[0] ?? '';
            }
            if ($downloadedFile && is_file($downloadedFile)) {
                $fileSize = filesize($downloadedFile);
                $asyncThreshold = 5 * 1024 * 1024 * 1024; // 5GB
                if ($fileSize > $asyncThreshold) {
                    // 大文件: 后台异步同步
                    $script = __DIR__ . '/../cloudreve_bg_upload.py';
                    $logFile = '/tmp/cloudreve_bg_' . md5($downloadedFile) . '.log';
                    $bgCmd = sprintf(
                        'nohup python3 %s %s downloads > %s 2>&1 &',
                        escapeshellarg($script),
                        escapeshellarg($downloadedFile),
                        escapeshellarg($logFile)
                    );
                    exec($bgCmd);
                    $cloudreve = [
                        'synced' => false,
                        'async' => true,
                        'message' => '文件较大 (' . round($fileSize / 1024 / 1024 / 1024, 1) . 'GB), 后台同步中, 请稍后刷新云盘查看',
                    ];
                    error_log("[cloudreve] 大文件后台同步已启动: $downloadedFile ($fileSize bytes)");
                } else {
                    // 小文件: 同步上传
                    require_once __DIR__ . '/cloudreve_lib.php';
                    $crResult = cr_importFile($userId, $downloadedFile, 'downloads');
                    if (empty($crResult['success'])) {
                        error_log('[cloudreve] netdisk 下载导入失败: ' . ($crResult['error'] ?? '未知错误') . " file=$downloadedFile");
                    }
                    $cloudreve = [
                        'synced' => !empty($crResult['success']),
                        'path' => $crResult['cloudreve_path'] ?? '',
                        'source' => $crResult['source'] ?? '',
                        'error' => $crResult['error'] ?? null,
                    ];
                }
            }
        }
        return [
            'success' => true,
            'message' => '下载完成',
            'output_dir' => $outputDir,
            'threads' => $threads,
            'cloudreve' => $cloudreve,
        ];
    }
    // aria2 在部分夸克 CDN 节点上会因多连接重定向丢失会话，使用 curl 单连接
    // 断点续传兜底。它仍携带同一组动态 Cookie/Referer/UA，不再把“直链已解析”误报为失败。
    if (is_array($headers) && preg_match('/quark\.cn/i', $url) && $filename) {
        $curlCmd = 'curl --location --fail --silent --show-error --retry 5 --retry-delay 3 --retry-all-errors ' .
            '--connect-timeout 20 --max-time 0 --continue-at - --output ' .
            escapeshellarg($outputDir . '/' . basename($filename));
        foreach (['Cookie', 'Referer', 'User-Agent', 'Accept', 'Origin'] as $hk) {
            if (!empty($headers[$hk])) {
                $curlCmd .= ' --header ' . escapeshellarg($hk . ': ' . $headers[$hk]);
            }
        }
        $curlCmd .= ' ' . escapeshellarg($url) . ' 2>&1';
        exec($curlCmd, $curlOutput, $curlCode);
        if ($curlCode === 0) {
            return [
                'success' => true,
                'message' => '下载完成(夸克会话流式兜底)',
                'output_dir' => $outputDir,
                'threads' => 1,
                'fallback' => 'curl',
            ];
        }
        $output = array_merge($output, $curlOutput);
        $returnCode = $curlCode;
    }
    return [
        'success' => false,
        'error' => '下载失败 (code=' . $returnCode . '): ' . implode("\n", array_slice($output, -5)),
    ];
}

// ── 大文件异步下载队列 ──
function netdisk_job_dir() {
    $dir = __DIR__ . '/../uploads/downloads/.jobs';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return $dir;
}

function queue_download($url, $filename, $outputDir, $threads, $headers = null, $expectedSize = 0) {
    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        return ['success' => false, 'error' => '无效的下载链接'];
    }
    $realOutputDir = realpath($outputDir);
    $uploadsDir = realpath(__DIR__ . '/../uploads');
    if ($realOutputDir === false || !$uploadsDir || strpos($realOutputDir, $uploadsDir) !== 0) {
        $outputDir = __DIR__ . '/../uploads/downloads';
        if (!is_dir($outputDir)) @mkdir($outputDir, 0755, true);
    }
    $filename = basename($filename ?: ('download_' . date('Ymd_His')));
    $threads = min(max(intval($threads), 1), 32);
    $jobId = bin2hex(random_bytes(12));
    $jobDir = netdisk_job_dir();
    $jobFile = $jobDir . '/' . $jobId . '.json';
    $confFile = $jobDir . '/' . $jobId . '.conf';
    $logFile = $jobDir . '/' . $jobId . '.log';
    $exitFile = $jobDir . '/' . $jobId . '.exit';
    $target = $outputDir . '/' . $filename;
    $conf = [
        'dir=' . $outputDir,
        'out=' . $filename,
        'file-allocation=none',
        'continue=true',
        'allow-overwrite=true',
        'auto-file-renaming=false',
        'max-tries=5',
        'retry-wait=3',
        'timeout=60',
        'connect-timeout=20',
        'max-connection-per-server=' . min($threads, 8),
        'split=' . min($threads, 8),
        'min-split-size=4M',
        'console-log-level=warn',
    ];
    if (is_array($headers)) {
        foreach (['Cookie', 'Referer', 'User-Agent', 'Accept', 'Origin'] as $hk) {
            if (!empty($headers[$hk])) $conf[] = 'header=' . $hk . ': ' . str_replace(["\r", "\n"], '', $headers[$hk]);
        }
    }
    if (@file_put_contents($confFile, implode("\n", $conf) . "\n", LOCK_EX) === false) {
        return ['success' => false, 'error' => '无法创建下载任务配置'];
    }
    @chmod($confFile, 0600);
    $job = [
        'job_id' => $jobId,
        'status' => 'queued',
        'filename' => $filename,
        'path' => $target,
        'output_dir' => $outputDir,
        'expected_size' => max(0, (int)$expectedSize),
        'created_at' => time(),
        'updated_at' => time(),
        'log' => $logFile,
        'exit' => $exitFile,
    ];
    @file_put_contents($jobFile, json_encode($job, JSON_UNESCAPED_UNICODE), LOCK_EX);
    $inner = sprintf(
        'aria2c --conf-path=%s %s; rc=$?; printf "%%s" "$rc" > %s; rm -f %s; exit "$rc"',
        escapeshellarg($confFile), escapeshellarg($url), escapeshellarg($exitFile), escapeshellarg($confFile)
    );
    $launch = 'nohup sh -c ' . escapeshellarg($inner) . ' > ' . escapeshellarg($logFile) . ' 2>&1 & echo $!';
    $pidLines = [];
    exec($launch, $pidLines, $launchCode);
    $pid = (int)trim($pidLines[0] ?? '0');
    if ($launchCode !== 0 || !$pid) {
        @unlink($confFile);
        $job['status'] = 'failed';
        $job['error'] = '无法启动 aria2 下载进程';
        @file_put_contents($jobFile, json_encode($job, JSON_UNESCAPED_UNICODE), LOCK_EX);
        return ['success' => false, 'error' => $job['error']];
    }
    $job['status'] = 'running';
    $job['pid'] = $pid;
    $job['updated_at'] = time();
    @file_put_contents($jobFile, json_encode($job, JSON_UNESCAPED_UNICODE), LOCK_EX);
    return [
        'success' => true,
        'queued' => true,
        'job_id' => $jobId,
        'status' => 'running',
        'filename' => $filename,
        'message' => '大文件已进入后台下载队列，请稍后使用 netdisk_status 查询进度',
    ];
}

function read_download_job($jobId) {
    if (!preg_match('/^[a-f0-9]{24}$/', (string)$jobId)) return null;
    $file = netdisk_job_dir() . '/' . $jobId . '.json';
    if (!is_file($file)) return null;
    $job = json_decode(@file_get_contents($file), true);
    if (!is_array($job)) return null;
    $exit = isset($job['exit']) && is_file($job['exit']) ? trim((string)@file_get_contents($job['exit'])) : null;
    $size = is_file($job['path'] ?? '') ? (int)@filesize($job['path']) : 0;
    if ($exit !== null) {
        $job['status'] = ($exit === '0') ? 'completed' : 'failed';
        $job['exit_code'] = (int)$exit;
        if ($job['status'] === 'failed' && !empty($job['log']) && is_file($job['log'])) {
            $lines = @file($job['log'], FILE_IGNORE_NEW_LINES);
            $job['error'] = implode("\n", array_slice($lines ?: [], -5));
        }
    } elseif ($job['status'] === 'running') {
        $job['status'] = 'running';
    }
    $job['size'] = $size;
    $job['updated_at'] = time();
    @file_put_contents(netdisk_job_dir() . '/' . $jobId . '.json', json_encode($job, JSON_UNESCAPED_UNICODE), LOCK_EX);
    return $job;
}

// ── 路由 ──
$action = $_GET['action'] ?? $_POST['action'] ?? '';

switch ($action) {
    case 'parse':
        $url = $_GET['url'] ?? $_POST['url'] ?? '';
        $password = $_GET['password'] ?? $_POST['password'] ?? $_GET['pwd'] ?? $_POST['pwd'] ?? '';
        if (empty($url)) netdisk_error('缺少网盘链接 (url 参数)');

        $netdiskType = identify_netdisk_type($url);
        $result = resolve_parse($netdiskType, $url, $password);

        if ($result['success']) {
            $result['netdisk_type'] = $netdiskType;
            netdisk_success(netdisk_public_result($result));
        } elseif (!empty($result['captcha_required'])) {
            // 百度验证码: 返回图片+提示, 客户端可展示给用户人工识别
            $result['netdisk_type'] = $netdiskType;
            echo json_encode($result, JSON_UNESCAPED_UNICODE);
            exit;
        } else {
            netdisk_error($result['error'] ?? '解析失败');
        }
        break;

    case 'download':
        $url = $_GET['url'] ?? $_POST['url'] ?? '';
        $password = $_GET['password'] ?? $_POST['password'] ?? $_GET['pwd'] ?? $_POST['pwd'] ?? '';
        $filename = $_GET['filename'] ?? $_POST['filename'] ?? '';
        $outputDir = $_GET['output_dir'] ?? $_POST['output_dir'] ?? (__DIR__ . '/../uploads/downloads');
        $threads = $_GET['threads'] ?? $_POST['threads'] ?? 16;

        if (empty($url)) netdisk_error('缺少下载链接 (url 参数)');
        // 兼容模型直接调用 netdisk_download(share_url)：自动解析并保留动态会话请求头，
        // 不再要求模型把夸克 Cookie/直链会话暴露后再手工转发。
        $downloadHeaders = null;
        $downloadType = identify_netdisk_type($url);
        if (preg_match('/(?:pan\.quark\.cn|pan\.baidu\.com|alipan\.com|aliyundrive\.com)/i', $url) && preg_match('/\/(?:s|share)\//i', $url)) {
            $parsed = resolve_parse($downloadType, $url, $password);
            if (empty($parsed['success'])) netdisk_error('解析失败: ' . ($parsed['error'] ?? '未知错误'));
            $downloadHeaders = $parsed['headers'] ?? null;
            $url = $parsed['direct_url'] ?? '';
            if (!$filename) $filename = $parsed['filename'] ?? '';
            $fileSize = (int)($parsed['file_size'] ?? 0);
            if ($fileSize >= 512 * 1024 * 1024) {
                netdisk_success(queue_download($url, $filename, $outputDir, $threads, $downloadHeaders, $fileSize));
            }
        }

        $result = download_file($url, $filename, $outputDir, $threads, $downloadHeaders);
        if ($result['success']) {
            netdisk_success($result);
        } else {
            netdisk_error($result['error']);
        }
        break;

    case 'parse_and_download':
        $url = $_GET['url'] ?? $_POST['url'] ?? '';
        $password = $_GET['password'] ?? $_POST['password'] ?? $_GET['pwd'] ?? $_POST['pwd'] ?? '';
        $filename = $_GET['filename'] ?? $_POST['filename'] ?? '';
        $outputDir = $_GET['output_dir'] ?? $_POST['output_dir'] ?? (__DIR__ . '/../uploads/downloads');
        $threads = $_GET['threads'] ?? $_POST['threads'] ?? 16;

        if (empty($url)) netdisk_error('缺少网盘链接 (url 参数)');

        // Step 1: Parse
        $netdiskType = identify_netdisk_type($url);
        $parseResult = resolve_parse($netdiskType, $url, $password);

        if (!$parseResult['success']) {
            netdisk_error('解析失败: ' . ($parseResult['error'] ?? '未知错误'));
        }

        // Step 2: Download
        $directUrl = $parseResult['direct_url'];
        $autoFilename = $filename ?: ($parseResult['filename'] ?? '');
        $downloadHeaders = $parseResult['headers'] ?? null;
        // 夸克/其他网盘的大文件不能占用一次工具调用等待数分钟；进入后台队列，
        // 由 netdisk_status(job_id) 查询进度，且队列配置会继续携带动态 Cookie。
        $fileSize = (int)($parseResult['file_size'] ?? 0);
        if ($fileSize >= 512 * 1024 * 1024) {
            $downloadResult = queue_download($directUrl, $autoFilename, $outputDir, $threads, $downloadHeaders, $fileSize);
        } else {
            $downloadResult = download_file($directUrl, $autoFilename, $outputDir, $threads, $downloadHeaders);
        }

        netdisk_success([
            'parse' => netdisk_public_result($parseResult),
            'download' => netdisk_public_result($downloadResult),
            'netdisk_type' => $netdiskType,
        ]);
        break;

    case 'download_status':
    case 'status':
        $jobId = $_GET['job_id'] ?? $_POST['job_id'] ?? '';
        if ($jobId !== '') {
            $job = read_download_job($jobId);
            if (!$job) netdisk_error('下载任务不存在或已过期', 404);
            netdisk_success([
                'job_id' => $job['job_id'],
                'status' => $job['status'],
                'filename' => $job['filename'] ?? '',
                'size' => $job['size'] ?? 0,
                'expected_size' => $job['expected_size'] ?? 0,
                'error' => $job['error'] ?? null,
                'path' => ($job['status'] === 'completed') ? ($job['path'] ?? '') : null,
            ]);
        }
        // 无 job_id 时返回服务状态，兼容旧客户端。
        exec('which aria2c 2>/dev/null', $whichOut, $whichRc);
        netdisk_success([
            'aria2_available' => ($whichRc === 0),
            'download_dir' => __DIR__ . '/../uploads/downloads',
        ]);
        break;

    case 'config':
        // 返回支持的网盘类型
        netdisk_success([
            'supported_types' => ['baidu', 'quark', 'aliyun', 'tianyi', 'xunlei', 'mobile', 'uc', '123', 'lanzou', 'ilanzou', 'feijipan', 'guangyapan'],
            'type_names' => [
                'baidu' => '百度网盘',
                'quark' => '夸克网盘',
                'aliyun' => '阿里云盘',
                'tianyi' => '天翼云盘',
                'xunlei' => '迅雷网盘',
                'mobile' => '移动网盘',
                'uc' => 'UC网盘',
                '123' => '123网盘',
                'lanzou' => '蓝奏云',
                'ilanzou' => '蓝奏云优享版',
                'feijipan' => '小飞机网盘',
                'guangyapan' => '光鸭云盘',
            ],
            'jxpan_enabled' => get_jxpan_api() !== '',
        ]);
        break;

    default:
        netdisk_error('未知动作: ' . $action . ' (支持: parse/download/parse_and_download/download_status/config)');
}
