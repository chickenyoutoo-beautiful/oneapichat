<?php
/**
 * URL Fetch Proxy v3
 * GET ?url=...&extract=1&raw=0 → 抓取网页并提取文本
 * POST { urls:[], extract:true } → 并行抓取多个网页
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ========== 配置 ==========
set_time_limit(15); // 防止 PHP 超时导致 502
define('MAX_URL_LENGTH', 2048);
define('MAX_CONTENT_SIZE', 2 * 1024 * 1024);
define('MAX_RESULT_LENGTH', 50000);
define('FETCH_TIMEOUT', 10);
define('MAX_REDIRECTS', 3);
define('MAX_PARALLEL', 5);

// User-Agent 轮换池（更多变体应对反爬）
$USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
];

// ========== 辅助函数 ==========

function isPrivateIP($host) {
    $resolved = @gethostbyname($host);
    if ($resolved === $host) return false;
    $ipLong = ip2long($resolved);
    if ($ipLong === false) return false;
    $ranges = [
        ['10.0.0.0',    '10.255.255.255'],
        ['172.16.0.0',  '172.31.255.255'],
        ['192.168.0.0', '192.168.255.255'],
        ['127.0.0.0',   '127.255.255.255'],
        ['169.254.0.0', '169.254.255.255'],
        ['0.0.0.0',     '0.255.255.255'],
        ['100.64.0.0',  '100.127.255.255'],
    ];
    foreach ($ranges as $r) {
        if ($ipLong >= ip2long($r[0]) && $ipLong <= ip2long($r[1])) return true;
    }
    return false;
}

function validateURL($url) {
    $url = trim($url);
    if (empty($url) || strlen($url) > MAX_URL_LENGTH) return false;
    // ★ 处理中文/非ASCII URL: 编码为合法 URI
    $url = encodeIRI($url);
    if (!filter_var($url, FILTER_VALIDATE_URL)) return false;
    $scheme = parse_url($url, PHP_URL_SCHEME);
    if (!in_array($scheme, ['http', 'https'])) return false;
    $host = parse_url($url, PHP_URL_HOST);
    if (!$host || empty($host)) return false;
    // ★ 白名单: 允许抓取自己的域名（即使是内网IP）
    $isSelf = (stripos($host, '.naujtrats.xyz') !== false || stripos($host, 'naujtrats.xyz') !== false || $host === 'localhost');
    if (!$isSelf && isPrivateIP($host)) return false;
    return $url;
}

// ★ IRI → URI: 把 URL 中的中文等非ASCII字符编码为 %XX 格式
function encodeIRI($url) {
    if (preg_match('/^[\x20-\x7E]+$/', $url)) return $url;
    $parts = parse_url($url);
    if ($parts === false) {
        // 解析失败时用正则兜底编码所有非ASCII字节
        return preg_replace_callback('/[^\x20-\x7E]/', function($m) { return rawurlencode($m[0]); }, $url);
    }
    $encoded = ($parts['scheme'] ?? 'http') . '://';
    if (isset($parts['user'])) $encoded .= rawurlencode($parts['user']) . (isset($parts['pass']) ? ':' . rawurlencode($parts['pass']) : '') . '@';
    $encoded .= $parts['host'];
    if (isset($parts['port'])) $encoded .= ':' . $parts['port'];
    if (isset($parts['path'])) $encoded .= implode('/', array_map('rawurlencode', explode('/', $parts['path'])));
    if (isset($parts['query'])) $encoded .= '?' . preg_replace_callback('/[^\x20-\x7E]/', function($m) { return rawurlencode($m[0]); }, $parts['query']);
    if (isset($parts['fragment'])) $encoded .= '#' . rawurlencode($parts['fragment']);
    return $encoded;
}

function extractTextFromHTML($html, $baseUrl = '') {
    // 解析 base URL 用于处理相对链接
    if (empty($baseUrl) && isset($_GET['base'])) {
        $baseUrl = $_GET['base'];
    }
    // 移除 script, style, noscript, iframe
    $html = preg_replace('/<script[^>]*>.*?<\/script>/si', ' ', $html);
    $html = preg_replace('/<style[^>]*>.*?<\/style>/si', ' ', $html);
    $html = preg_replace('/<noscript[^>]*>.*?<\/noscript>/si', ' ', $html);
    $html = preg_replace('/<iframe[^>]*>.*?<\/iframe>/si', ' ', $html);
    $html = preg_replace('/<svg[^>]*>.*?<\/svg>/si', ' ', $html);
    // 移除注释
    $html = preg_replace('/<!--.*?-->/s', ' ', $html);
    // 移除 footer / header / nav
    $html = preg_replace('/<footer[^>]*>.*?<\/footer>/si', ' ', $html);
    $html = preg_replace('/<nav[^>]*>.*?<\/nav>/si', ' ', $html);
    // ★ 保留链接: <a href="...">text</a> → [text](url) markdown 格式
    $html = preg_replace_callback('/<a[^>]*href=["\']([^"\'#][^"\']*)["\'][^>]*>(.*?)<\/a>/si', function($m) use ($baseUrl) {
        $url = $m[1];
        $text = trim(strip_tags($m[2]));
        if (empty($text)) $text = $url;
        if (!preg_match('/^https?:\/\//i', $url) && !empty($baseUrl)) {
            $url = rtrim($baseUrl, '/') . '/' . ltrim($url, '/');
        }
        return ' [' . $text . '](' . $url . ') ';
    }, $html);
    // ★ 保留图片: <img src="..." alt="..."> → ![alt](src) markdown 格式
    $html = preg_replace_callback('/<img[^>]*src=["\']([^"\']+)["\'][^>]*>/si', function($m) use ($baseUrl) {
        $url = $m[1];
        // 跳过 data: URI 和 1x1 占位图
        if (preg_match('/^(data:|\/\/)/i', $url)) return ' ';
        if (!preg_match('/^https?:\/\//i', $url) && !empty($baseUrl)) {
            $url = rtrim($baseUrl, '/') . '/' . ltrim($url, '/');
        }
        // 尝试提取 alt 文本
        preg_match('/alt=["\']([^"\']*)["\']/i', $m[0], $altMatch);
        $alt = !empty($altMatch[1]) ? trim($altMatch[1]) : '图片';
        return "\n![" . $alt . '](' . $url . ")\n";
    }, $html);
    // 保留换行: br, p, div, li, h 标签前加换行
    $html = preg_replace('/<(br|hr)\s*\/?>/i', "\n", $html);
    $html = preg_replace('/<\/(p|div|li|h[1-6]|tr|section|article|header)>/i', "\n", $html);
    // 标题加前缀
    $html = preg_replace('/<h([1-6])[^>]*>(.*?)<\/h\1>/si', "\n## $2\n", $html);
    // 去掉所有剩余标签
    $html = strip_tags($html);
    // 解码 HTML 实体
    $html = html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    // 清理多余空白行
    $html = preg_replace('/\n\s*\n\s*\n/', "\n\n", $html);
    $html = preg_replace('/[ \t]{2,}/', ' ', $html);
    $html = preg_replace('/^\s+|\s+$/m', '', $html);
    return trim($html);
}

function fetchSingleURL($url, $uaIndex = 0) {
    global $USER_AGENTS;
    $ua = $USER_AGENTS[$uaIndex % count($USER_AGENTS)];

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => FETCH_TIMEOUT,
            'follow_location' => 1,
            'max_redirects' => MAX_REDIRECTS,
            'header' => "User-Agent: $ua\r\nAccept: text/html,application/xhtml+xml,text/plain;q=0.9\r\nAccept-Language: zh-CN,zh;q=0.9,en;q=0.8\r\nAccept-Encoding: identity\r\nCache-Control: no-cache\r\n"
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false
        ]
    ]);

    $content = @file_get_contents($url, false, $context);
    if ($content === false) {
        $error = error_get_last();
        $msg = $error ? substr($error['message'] ?? 'Unknown', 0, 200) : 'Unknown error';
        // 判断是否是403/反爬，尝试换UA重试
        if (strpos($msg, '403') !== false && $uaIndex < count($USER_AGENTS) - 1) {
            return fetchSingleURL($url, $uaIndex + 1);
        }
        return ['error' => $msg, 'status' => 502];
    }

    if (strlen($content) > MAX_CONTENT_SIZE) {
        $content = substr($content, 0, MAX_CONTENT_SIZE);
    }

    // 检测 HTTP 状态码
    $statusCode = 200;
    if (isset($http_response_header)) {
        foreach ($http_response_header as $header) {
            if (preg_match('/^HTTP\/\d+\.?\d*\s+(\d+)/', $header, $m)) {
                $statusCode = (int)$m[1];
                break;
            }
        }
    }
    if ($statusCode >= 400) {
        // 403 换 UA 重试
        if ($statusCode === 403 && $uaIndex < count($USER_AGENTS) - 1) {
            return fetchSingleURL($url, $uaIndex + 1);
        }
        return ['error' => "HTTP $statusCode", 'status' => $statusCode];
    }

    return ['content' => $content, 'status' => $statusCode];
}

// ========== 路由 ==========

$method = $_SERVER['REQUEST_METHOD'];

// ------ POST: 并行抓取 ------
if ($method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $urls = isset($input['urls']) ? $input['urls'] : [];
    $doExtract = isset($input['extract']) ? (bool)$input['extract'] : true;
    $raw = isset($input['raw']) ? (bool)$input['raw'] : false;

    if (!is_array($urls) || empty($urls)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing or empty urls array']);
        exit;
    }

    // 限制数量
    $urls = array_slice($urls, 0, MAX_PARALLEL);
    $validated = array_map('validateURL', $urls);
    $valid = [];
    foreach ($validated as $i => $v) {
        if ($v === false) continue;
        $valid[] = $v;
    }
    $urls = array_values($valid);
    $results = [];
    // ★ 没有可抓取的 URL 就直接返回
    if (empty($urls)) {
        echo json_encode(['results' => $results]);
        exit;
    }

    // ★ 并行: stream_select + 逐个读取
    $streams = [];
    $contexts = [];

    foreach ($urls as $i => $url) {
        $ua = $USER_AGENTS[$i % count($USER_AGENTS)];
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => FETCH_TIMEOUT,
                'follow_location' => 1,
                'max_redirects' => MAX_REDIRECTS,
                'ignore_errors' => true,
                'header' => "User-Agent: $ua\r\nAccept: text/html,text/plain;q=0.9\r\nAccept-Language: zh-CN,zh;q=0.9,en;q=0.8\r\n"
            ],
            'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]
        ]);
        $contexts[$i] = $ctx;
        $streams[$i] = @fopen($url, 'rb', false, $ctx);
    }

    // 用 stream_select 并行读取
    $activeStreams = array_filter($streams);
    $startTime = microtime(true);

    while (!empty($activeStreams) && (microtime(true) - $startTime) < FETCH_TIMEOUT + 3) {
        $read = array_values($activeStreams);
        $write = null;
        $except = null;

        if (@stream_select($read, $write, $except, 0, 200000) > 0) {
            // 这里 select 在 PHP 里对 HTTP 可能不完全有效
            // 简化为逐个异步读取
            break;
        }
    }

    // 实际逐个读取（PHP stream 兼容方案）
    foreach ($streams as $i => $stream) {
        if (!$stream) {
            $results[] = ['url' => $urls[$i], 'error' => 'Failed to open stream', 'content' => ''];
            continue;
        }

        $content = '';
        $meta = stream_get_meta_data($stream);

        // 读取内容
        while (!feof($stream)) {
            $chunk = @fread($stream, 32768);
            if ($chunk === false || $chunk === '') break;
            $content .= $chunk;
            if (strlen($content) > MAX_CONTENT_SIZE) {
                $content = substr($content, 0, MAX_CONTENT_SIZE);
                break;
            }
        }
        fclose($stream);

        if (empty($content)) {
            $results[] = ['url' => $urls[$i], 'error' => 'Empty response', 'content' => ''];
            continue;
        }

        if ($raw) {
            $results[] = ['url' => $urls[$i], 'content' => substr($content, 0, MAX_RESULT_LENGTH), 'error' => ''];
            continue;
        }

        if ($doExtract) {
            $extracted = extractTextFromHTML($content);
            $extracted = substr($extracted, 0, MAX_RESULT_LENGTH);
            $results[] = ['url' => $urls[$i], 'content' => $extracted, 'error' => ''];
        } else {
            $results[] = ['url' => $urls[$i], 'content' => $raw ? $content : substr($content, 0, MAX_RESULT_LENGTH), 'error' => ''];
        }
    }

    echo json_encode(['results' => $results]);
    exit;
}

// ------ GET: 单页面抓取 ------
$url = isset($_GET['url']) ? trim($_GET['url']) : '';
$doExtract = isset($_GET['extract']) ? ($_GET['extract'] !== '0' && $_GET['extract'] !== 'false') : true;
$raw = isset($_GET['raw']) ? ($_GET['raw'] === '1' || $_GET['raw'] === 'true') : false;

if (empty($url)) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing url parameter']);
    exit;
}

$url = validateURL($url);
if ($url === false) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid URL or internal address blocked']);
    exit;
}

$result = fetchSingleURL($url);

if (isset($result['error'])) {
    http_response_code($result['status']);
    echo json_encode(['error' => $result['error'], 'content' => '']);
    exit;
}

$content = $result['content'];

if ($raw) {
    echo json_encode(['content' => substr($content, 0, MAX_RESULT_LENGTH), 'error' => '']);
    exit;
}

if ($doExtract) {
    $extracted = extractTextFromHTML($content);
    $extracted = substr($extracted, 0, MAX_RESULT_LENGTH);
    echo json_encode(['content' => $extracted, 'error' => '']);
} else {
    echo json_encode(['content' => substr($content, 0, MAX_RESULT_LENGTH), 'error' => '']);
}
