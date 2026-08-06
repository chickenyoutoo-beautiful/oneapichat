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

header('Content-Type: application/json; charset=utf-8');

// ── 认证 ──
// ★ 2026-08-03 修复: sessions.json 实际结构是 {token: {user_id, created_at}},
//   旧逻辑遍历找 $sess['token'] 永远匹配不到 → $userId 恒为 null（下载无法按用户隔离）
$userId = null;
$authToken = $_GET['auth_token'] ?? $_POST['auth_token'] ?? '';
if ($authToken) {
    // DB 优先（与 verifyAuthToken 同源）
    $dbPath = __DIR__ . '/../users/oneapichat.db';
    if (file_exists($dbPath)) {
        try {
            $pdo = new PDO("sqlite:$dbPath");
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $stmt = $pdo->prepare("SELECT user_id, created_at FROM sessions WHERE token = ?");
            $stmt->execute([$authToken]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row && time() - ($row['created_at'] ?? 0) < 30 * 24 * 3600) {
                $userId = $row['user_id'];
            }
        } catch (Exception $e) {}
    }
    // 回退: JSON 文件
    if (!$userId) {
        $sessionFile = __DIR__ . '/../users/sessions.json';
        if (file_exists($sessionFile)) {
            $sessions = json_decode(file_get_contents($sessionFile), true) ?: [];
            if (isset($sessions[$authToken]['user_id'])) {
                $sess = $sessions[$authToken];
                if (time() - ($sess['created_at'] ?? 0) < 30 * 24 * 3600) {
                    $userId = $sess['user_id'];
                }
            }
        }
    }
}

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
    if ($type !== 'baidu') {
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
        'aria2c -s %d -x %d -k 1M -d %s --console-log-level=warn --allow-overwrite=true',
        $threads, $threads,
        escapeshellarg($outputDir)
    );
    // ★ 带请求头下载(夸克直链需要最新 __pus/__puus Cookie + Referer/UA, 否则CDN回调403)
    if (is_array($headers)) {
        foreach (['Cookie', 'Referer', 'User-Agent'] as $hk) {
            if (!empty($headers[$hk])) {
                $cmd .= ' --header=' . escapeshellarg($hk . ': ' . $headers[$hk]);
            }
        }
    }
    if ($filename) {
        $cmd .= ' -o ' . escapeshellarg(basename($filename));
    }
    $cmd .= ' ' . escapeshellarg($url) . ' 2>&1';

    exec($cmd, $output, $returnCode);

    if ($returnCode === 0) {
        // ★ 2026-08-03 云盘全面结合: 下载完成自动同步到用户 Cloudreve 账号 OneAPIChat/downloads
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
        return [
            'success' => true,
            'message' => '下载完成',
            'output_dir' => $outputDir,
            'threads' => $threads,
            'cloudreve' => $cloudreve,
        ];
    }
    return [
        'success' => false,
        'error' => '下载失败 (code=' . $returnCode . '): ' . implode("\n", array_slice($output, -5)),
    ];
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
            netdisk_success($result);
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
        $filename = $_GET['filename'] ?? $_POST['filename'] ?? '';
        $outputDir = $_GET['output_dir'] ?? $_POST['output_dir'] ?? (__DIR__ . '/../uploads/downloads');
        $threads = $_GET['threads'] ?? $_POST['threads'] ?? 16;

        if (empty($url)) netdisk_error('缺少下载链接 (url 参数)');

        $result = download_file($url, $filename, $outputDir, $threads);
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
        $downloadResult = download_file($directUrl, $autoFilename, $outputDir, $threads, $downloadHeaders);

        netdisk_success([
            'parse' => $parseResult,
            'download' => $downloadResult,
            'netdisk_type' => $netdiskType,
        ]);
        break;

    case 'download_status':
    case 'status':
        // 检查 aria2 是否可用
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
