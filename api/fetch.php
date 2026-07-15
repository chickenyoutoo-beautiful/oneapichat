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

// ========== 熔断器（进程内共享） ==========
define('BREAKER_THRESHOLD', 3);
define('BREAKER_COOLDOWN', 90); // 秒
$GLOBAL_FAILURES = [];  // host => [count, lastFailureTimestamp]

function _breakerKey($host) {
    // 去掉 www. 前缀以减少碎片化
    return preg_replace('/^www\./', '', strtolower($host));
}

function isBreakerOpen($host) {
    global $GLOBAL_FAILURES;
    $key = _breakerKey($host);
    if (!isset($GLOBAL_FAILURES[$key])) return false;
    list($count, $lastFailure) = $GLOBAL_FAILURES[$key];
    if ($count >= BREAKER_THRESHOLD && (time() - $lastFailure) < BREAKER_COOLDOWN) {
        return true;  // 熔断打开
    }
    if ((time() - $lastFailure) >= BREAKER_COOLDOWN) {
        $GLOBAL_FAILURES[$key] = [0, 0];  // 冷却期满，重置
    }
    return false;
}

function recordFailure($host, $httpCode = 0) {
    global $GLOBAL_FAILURES;
    $key = _breakerKey($host);
    if (!isset($GLOBAL_FAILURES[$key])) $GLOBAL_FAILURES[$key] = [0, 0];
    list($count, $lastFailure) = $GLOBAL_FAILURES[$key];
    $GLOBAL_FAILURES[$key] = [$count + 1, time()];
}

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
    global $USER_AGENTS, $GLOBAL_FAILURES, $proxyUrl;
    $host = parse_url($url, PHP_URL_HOST);

    // 熔断器检查 — ★ 有代理时跳过(代理可能是新路径, 不应被旧失败阻止)
    if (isBreakerOpen($host) && !$proxyUrl) {
        return ['error' => "Circuit breaker open (host: $host)", 'status' => 503];
    }
    // ★ 有代理时重置熔断器, 给代理一次机会
    if (isBreakerOpen($host) && $proxyUrl) {
        $key = _breakerKey($host);
        $GLOBAL_FAILURES[$key] = [0, 0];
    }

    $ua = $USER_AGENTS[$uaIndex % count($USER_AGENTS)];

    // ★ 使用 PHP curl（与 proxy.php 一致的代理处理）
    $doRequest = function($useProxy) use ($url, $ua, $proxyUrl) {
        $ch = curl_init();
        $opts = [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => MAX_REDIRECTS,
            CURLOPT_TIMEOUT => FETCH_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_2_0,  // ★ HTTP/2 更像浏览器
            CURLOPT_USERAGENT => $ua,
            CURLOPT_HTTPHEADER => [
                'Accept: text/html,application/xhtml+xml,text/plain;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding: gzip, deflate, br',
                'Cache-Control: no-cache',
                'Sec-Fetch-Dest: document',
                'Sec-Fetch-Mode: navigate',
                'Sec-Fetch-Site: none',
                'Upgrade-Insecure-Requests: 1',
                'DNT: 1'
            ],
            CURLOPT_ENCODING => 'gzip, deflate, br',  // ★ 接受压缩
            CURLOPT_COOKIEFILE => '',   // ★ 启用 cookie 引擎(内存)
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_WHATEVER,
            CURLOPT_TCP_FASTOPEN => 1
        ];
        // ★ 代理设置（与 proxy.php 一致）
        if ($useProxy && $proxyUrl) {
            $opts[CURLOPT_PROXY] = $proxyUrl;
            if (strpos($proxyUrl, 'socks5://') === 0) {
                $opts[CURLOPT_PROXYTYPE] = CURLPROXY_SOCKS5;
            } elseif (strpos($proxyUrl, 'socks4://') === 0) {
                $opts[CURLOPT_PROXYTYPE] = CURLPROXY_SOCKS4;
            }
        }
        curl_setopt_array($ch, $opts);
        $content = curl_exec($ch);
        $info = [
            'status' => (int)curl_getinfo($ch, CURLINFO_HTTP_CODE),
            'error' => curl_error($ch),
            'errno' => curl_errno($ch)
        ];
        curl_close($ch);
        return [$content, $info];
    };

    // ★ 有代理时先走代理,代理失败回退直连
    if ($proxyUrl) {
        list($content, $info) = $doRequest(true);
        if ($content === false || $info['errno'] !== 0 || $info['status'] >= 500) {
            // ★ 代理失败,回退直连
            list($content, $info) = $doRequest(false);
        }
    } else {
        list($content, $info) = $doRequest(false);
    }
    $statusCode = $info['status'];
    $curlError = $info['error'];
    $curlErrno = $info['errno'];

    // 判断错误 — ★ 502/503 等可能是反爬, 等待后换 UA 重试
    if ($content === false || $curlErrno !== 0 || $statusCode >= 500) {
        $errMsg = $curlError ?: 'curl failed';
        $failures = $GLOBAL_FAILURES[_breakerKey($host)][0] ?? 0;
        if (in_array($statusCode, [502, 503, 504]) || $content === false || $statusCode >= 500) {
            if ($uaIndex < min(count($USER_AGENTS) - 1, 2)) {  // ★ 最多重试2次
                // ★ 反爬: 随机延迟 1-3 秒后换 UA 重试
                usleep(rand(1000000, 3000000));
                return fetchSingleURL($url, $uaIndex + 1);
            }
            recordFailure($host, $statusCode ?: 502);
        }
        return ['error' => $errMsg, 'status' => $statusCode ?: 502];
    }

    if (strlen($content) > MAX_CONTENT_SIZE) {
        $content = substr($content, 0, MAX_CONTENT_SIZE);
    }

    if ($statusCode >= 400) {
        recordFailure($host, $statusCode);
        // 403 换 UA 重试
        if ($statusCode === 403 && $uaIndex < count($USER_AGENTS) - 1) {
            return fetchSingleURL($url, $uaIndex + 1);
        }
        return ['error' => "HTTP $statusCode", 'status' => $statusCode];
    }

    // 成功：清除该主机的失败计数
    $key = _breakerKey($host);
    if (isset($GLOBAL_FAILURES[$key])) $GLOBAL_FAILURES[$key] = [0, 0];

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

    // ★ curl 多进程并行抓取（替代 fopen + stream_select）
    $tmpDir = sys_get_temp_dir();
    $pipes = [];  // index => pipe resource
    $cmds = [];   // index => shell command string

    foreach ($urls as $i => $url) {
        $ua = $USER_AGENTS[$i % count($USER_AGENTS)];
        $outFile = "$tmpDir/fetch_result_$i_" . getmypid() . ".tmp";
        $cmd = 'curl -s -L ' .
            '--tlsv1.2 ' .
            '--connect-timeout 5 ' .
            '--max-time ' . FETCH_TIMEOUT . ' ' .
            '--max-redirs ' . MAX_REDIRECTS . ' ' .
            $proxyFlag . ' ' .
            '-H ' . escapeshellarg("User-Agent: $ua") . ' ' .
            '-H ' . escapeshellarg('Accept: text/html,text/plain;q=0.9') . ' ' .
            '-H ' . escapeshellarg('Accept-Language: zh-CN,zh;q=0.9,en;q=0.8') . ' ' .
            '-H ' . escapeshellarg('Accept-Encoding: identity') . ' ' .
            '-k ' .
            '-o ' . escapeshellarg($outFile) . ' ' .
            '-w ' . escapeshellarg('%{http_code}') . ' > ' . escapeshellarg("$tmpDir/fetch_status_$i_" . getmypid() . ".tmp 2>/dev/null") .
            ' & ' .  // 后台运行
            'echo $!';  // 输出 PID
        $cmds[$i] = $outFile;
        $pid = (int)trim(shell_exec($cmd) ?? '0');
    }

    // ★ 等待所有 curl 进程完成（最多 FETCH_TIMEOUT + 2 秒）
    $waitStart = microtime(true);
    $allDone = false;
    while ((microtime(true) - $waitStart) < FETCH_TIMEOUT + 2) {
        usleep(200000); // 200ms
        $done = true;
        foreach ($cmds as $outFile) {
            clearstatcache(true, $outFile);
            // 检查是否完成（状态文件存在 = curl 已退出）
            $statusFile = str_replace('fetch_result_', 'fetch_status_', $outFile);
            if (!file_exists($statusFile)) { $done = false; break; }
        }
        if ($done) { $allDone = true; break; }
    }

    // ★ 收集结果
    foreach ($urls as $i => $url) {
        $outFile = $cmds[$i] ?? '';
        $statusFile = str_replace('fetch_result_', 'fetch_status_', $outFile);
        if (!$outFile || !file_exists($outFile)) {
            $results[] = ['url' => $url, 'error' => 'curl failed', 'content' => ''];
            @unlink($outFile); @unlink($statusFile);
            continue;
        }
        $content = file_get_contents($outFile);
        $httpCode = 200;
        if (file_exists($statusFile)) {
            $codeStr = trim(file_get_contents($statusFile) ?? '');
            if (is_numeric($codeStr)) $httpCode = (int)$codeStr;
            @unlink($statusFile);
        }
        @unlink($outFile);

        if ($httpCode >= 400 || $content === false || strlen($content) < 10) {
            $host = parse_url($url, PHP_URL_HOST);
            recordFailure($host, $httpCode);
            $results[] = ['url' => $url, 'error' => "HTTP $httpCode", 'content' => ''];
            continue;
        }
        if (strlen($content) > MAX_CONTENT_SIZE) {
            $content = substr($content, 0, MAX_CONTENT_SIZE);
        }
        if ($raw) {
            $results[] = ['url' => $url, 'content' => substr($content, 0, MAX_RESULT_LENGTH), 'error' => ''];
        } elseif ($doExtract) {
            $extracted = extractTextFromHTML($content);
            $results[] = ['url' => $url, 'content' => substr($extracted, 0, MAX_RESULT_LENGTH), 'error' => ''];
        } else {
            $results[] = ['url' => $url, 'content' => substr($content, 0, MAX_RESULT_LENGTH), 'error' => ''];
        }
    }

    echo json_encode(['results' => $results]);
    exit;
}

// ------ 代理配置（前端传入） ------
$proxyUrl = isset($_GET['proxy']) ? trim($_GET['proxy']) : '';
if ($proxyUrl === '__relay_only__' || $proxyUrl === '') $proxyUrl = '';
// ★ 内部代理映射（与 proxy.php 一致）
if (strpos($proxyUrl, 'proxy.naujtrats.xyz:8888') !== false) $proxyUrl = 'http://192.168.195.213:10808';
if (strpos($proxyUrl, 'proxy.naujtrats.xyz:8889') !== false) $proxyUrl = 'http://192.168.195.22:10808';
$proxyFlag = '';
if ($proxyUrl) {
    $proxyType = CURLPROXY_HTTP;
    if (strpos($proxyUrl, 'socks5://') === 0) $proxyType = CURLPROXY_SOCKS5;
    elseif (strpos($proxyUrl, 'socks4://') === 0) $proxyType = CURLPROXY_SOCKS4;
    // ★ 构建 curl 代理参数
    $proxyFlag = ' --proxy ' . escapeshellarg($proxyUrl);
    if ($proxyType === CURLPROXY_SOCKS5) $proxyFlag .= ' --socks5 ' . escapeshellarg($proxyUrl);
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
