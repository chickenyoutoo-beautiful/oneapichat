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
$userId = null;
$authToken = $_GET['auth_token'] ?? $_POST['auth_token'] ?? '';
if ($authToken) {
    $sessionFile = __DIR__ . '/../users/sessions.json';
    if (file_exists($sessionFile)) {
        $sessions = json_decode(file_get_contents($sessionFile), true) ?: [];
        foreach ($sessions as $uid => $sess) {
            if (!empty($sess['token']) && $sess['token'] === $authToken) {
                $userId = $uid;
                break;
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
        'lanzou'  => '/(lanzou[a-z]*\.com|lanzous\.com)/',
        'ilanzou' => '/ilanzou\.com/',
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
        if (preg_match('/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i', trim($d['file_size']), $m)) {
            $units = ['B' => 1, 'KB' => 1024, 'MB' => 1048576, 'GB' => 1073741824, 'TB' => 1099511627776];
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
        'timeout' => 80,
        'ignore_errors' => true,
    ]]);
    $mcpResp = @file_get_contents('http://127.0.0.1:18788/mcp/api/tools/call', false, $mcpCtx);
    $mcpFailError = null;
    if ($mcpResp) {
        $mcpData = json_decode($mcpResp, true);
        $mcpResult = $mcpData['result'] ?? $mcpData ?? null;
        if (is_string($mcpResult)) { $mcpResult = json_decode($mcpResult, true) ?: $mcpResult; }
        if (is_array($mcpResult) && !empty($mcpResult['success'])) return $mcpResult;
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

    // 阿里云盘解析需要 token，使用本地脚本
    $scriptPath = __DIR__ . '/../python/netdisk/aliyun_parser.py';
    if (file_exists($scriptPath)) {
        $cmd = sprintf(
            '%s %s %s 2>&1',
            pythonBin(),
            escapeshellarg($scriptPath),
            escapeshellarg($url)
        );
        $output = shell_exec($cmd);
        if ($output) {
            $result = json_decode($output, true);
            if ($result) return $result;
        }
    }

    return ['success' => false, 'error' => '阿里云盘解析暂不支持，需要配置 refresh_token'];
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
        if ($result) return $result;
        return ['success' => false, 'error' => '解析引擎返回异常: ' . substr($output, 0, 200)];
    }
    return ['success' => false, 'error' => '解析引擎无输出'];
}

/**
 * 使用 aria2 下载文件
 */
function download_file($url, $filename, $outputDir, $threads) {
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
    if ($filename) {
        $cmd .= ' -o ' . escapeshellarg(basename($filename));
    }
    $cmd .= ' ' . escapeshellarg($url) . ' 2>&1';

    exec($cmd, $output, $returnCode);

    if ($returnCode === 0) {
        return [
            'success' => true,
            'message' => '下载完成',
            'output_dir' => $outputDir,
            'threads' => $threads,
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
        $downloadResult = download_file($directUrl, $autoFilename, $outputDir, $threads);

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
