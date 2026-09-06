<?php
/**
 * OneAPIChat 代理中继 — 将前端 API 请求通过代理转发
 * 支持 HTTP/HTTPS/SOCKS5 代理 + 智能路由
 *
 * 路由策略:
 *   - 生图请求: 本机 Mihomo 优先，连接失败再回退 ECS1→GCP
 *   - 其他请求: 国内可达目标直连优先，失败依次回退 Mihomo、ECS1→GCP
 *   - 显式 proxy 参数: 使用指定代理
 *
 * 安全: 流式硬超时 900s + 低速检测 120s + 客户端断开传播, 防止永久挂起
 */

require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';
setCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST required']);
    exit;
}

// The relay can reach third-party model providers, so it must never be an
// unauthenticated public proxy. Prefer the Authorization header; the secure
// shared-domain cookie keeps existing browser sessions compatible.
$authToken = extractBearerToken();
if ($authToken === '' && !empty($_COOKIE['auth_token'])) {
    $authToken = $_COOKIE['auth_token'];
}
if (!verifyAuthToken($authToken)) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!$data || empty($data['url'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing url parameter']);
    exit;
}

$targetUrl = $data['url'];
$method = strtoupper($data['method'] ?? 'POST');
$headers = $data['headers'] ?? [];
$body = $data['body'] ?? null;
$multipart = $data['multipart'] ?? null;
$proxyUrl = $data['proxy'] ?? '';
// ★ 智能路由标记: 代理开启时前端传 true, 启用直连优先策略
$tryDirect = !empty($data['tryDirect']);
$isStream = !empty($data['stream']);

// ★ 哨兵值: 前端标记走中继, 在此清除 (必须在代理 URL 格式校验之前)
if ($proxyUrl === '__relay_only__') {
    $proxyUrl = '';
}

// ★ 如果 relay 顶层没传 stream, 解析 body 中的 stream 字段
if (!$isStream && $body && is_string($body)) {
    $bodyDecoded = json_decode($body, true);
    if ($bodyDecoded && !empty($bodyDecoded['stream'])) {
        $isStream = true;
    }
}

// 安全: 只允许 HTTPS 目标
if (!preg_match('#^https?://#', $targetUrl)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid target URL, only http/https allowed']);
    exit;
}

// 验证代理 URL 格式
if ($proxyUrl && !preg_match('#^(socks5h?|socks4|http|https)://#', $proxyUrl)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid proxy URL format']);
    exit;
}

// ── 路由决策 ──
// 首选当前服务器的 Mihomo；GCP 仅作为传输层失败后的灾备出口。
$mihomoProxy = 'http://127.0.0.1:1080';
$gcpProxy = 'http://192.168.195.226:8890';
$targetHost = parse_url($targetUrl, PHP_URL_HOST) ?: '';
$requestPath = (string) (parse_url($targetUrl, PHP_URL_PATH) ?: '');
$isImageGeneration = (bool) preg_match('#/images/(?:generations|edits)/?$#', $requestPath);

// GFW 封锁域名 — 服务器直连不通, 直接走 ECS1→GCP (避免 15s 直连超时浪费)
$blockedHosts = [
    'generativelanguage.googleapis.com', 'googleapis.com',
    'api.openai.com',
    'api.anthropic.com',
    'api.x.ai',
    'openrouter.ai',
    'integrate.api.nvidia.com',
    'api.search.brave.com', 'brave.com',
    'api.tavily.com', 'tavily.com',
];
$isBlocked = false;
foreach ($blockedHosts as $bh) {
    if ($targetHost === $bh || str_ends_with($targetHost, '.' . $bh)) {
        $isBlocked = true;
        break;
    }
}

// ★ 智能路由优化：国内大模型提供商（DeepSeek、智谱、通义千问、Kimi、豆包、MiniMax、小米MiMo等）直连速度极快（<100ms），严禁盲目走代理！
//    只有明确的 GFW 封锁名单（OpenAI/Anthropic/xAI/Google/OpenRouter/NVIDIA等）或用户指定代理才默认走 Mihomo。
$domesticHosts = [
    'api.deepseek.com', 'deepseek.com',
    'open.bigmodel.cn', 'bigmodel.cn',
    'dashscope.aliyuncs.com', 'aliyuncs.com',
    'api.moonshot.cn', 'moonshot.cn',
    'ark.cn-beijing.volces.com', 'volces.com',
    'api.minimaxi.com', 'minimax.chat', 'minimaxi.com',
    'api.xiaomimimo.com', 'xiaomimimo.com',
    'api.longcat.chat', 'longcat.chat'
];
$isDomestic = false;
foreach ($domesticHosts as $dh) {
    if ($targetHost === $dh || str_ends_with($targetHost, '.' . $dh)) {
        $isDomestic = true;
        break;
    }
}

$fallbackProxies = [];
if (!$proxyUrl && $isImageGeneration) {
    $proxyUrl = $mihomoProxy;
    $fallbackProxies = [$gcpProxy];
} elseif ($isDomestic || ($tryDirect && !$isBlocked)) {
    // 国内服务或允许直连的非封锁服务：直接直连（0延迟），失败后才退避走 Mihomo
    $proxyUrl = '';
    $fallbackProxies = [$mihomoProxy, $gcpProxy];
} elseif (!$proxyUrl && $isBlocked) {
    // 国外被墙域名：直奔 Mihomo 代理，失败回退 GCP
    $proxyUrl = $mihomoProxy;
    $fallbackProxies = [$gcpProxy];
} elseif (!$proxyUrl) {
    // 其他普通域名：默认直连优先
    $proxyUrl = '';
    $fallbackProxies = [$mihomoProxy, $gcpProxy];
}

// ── 构建 curl 公共数据 ──
$curlHeaders = [];
foreach ($headers as $key => $value) {
    // multipart 请求的 Content-Type 必须由 cURL 自动生成并附带 boundary。
    if (is_array($multipart) && strcasecmp((string)$key, 'Content-Type') === 0) continue;
    $curlHeaders[] = "$key: $value";
}

$multipartTempFiles = [];
register_shutdown_function(function() use (&$multipartTempFiles) {
    foreach ($multipartTempFiles as $tmpPath) {
        if (is_string($tmpPath) && is_file($tmpPath)) @unlink($tmpPath);
    }
});
$bodyStr = null;
if (is_array($multipart)) {
    $bodyStr = [];
    foreach ($multipart as $index => $part) {
        if (!is_array($part) || empty($part['name'])) continue;
        $name = (string)$part['name'];
        if (($part['kind'] ?? '') === 'file') {
            $decoded = base64_decode((string)($part['dataBase64'] ?? ''), true);
            if ($decoded === false) {
                http_response_code(400);
                echo json_encode(['error' => 'Invalid multipart file encoding']);
                exit;
            }
            $tmpPath = tempnam(sys_get_temp_dir(), 'oac_multipart_');
            if ($tmpPath === false || file_put_contents($tmpPath, $decoded) === false) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to prepare multipart upload']);
                exit;
            }
            $multipartTempFiles[] = $tmpPath;
            $safeFilename = basename((string)($part['filename'] ?? ('upload_' . $index . '.bin')));
            $contentType = (string)($part['contentType'] ?? 'application/octet-stream');
            $bodyStr[$name] = new CURLFile($tmpPath, $contentType, $safeFilename);
        } else {
            $bodyStr[$name] = (string)($part['value'] ?? '');
        }
    }
} elseif ($body !== null) {
    $bodyStr = is_array($body) ? json_encode($body, JSON_UNESCAPED_UNICODE) : (string)$body;
}

// ★ 客户端断开时中止 PHP (配合前端 AbortController, 不再空转)
ignore_user_abort(false);

// ── 应用代理设置 ──
function _applyProxy($ch, $proxyUrl) {
    if (!$proxyUrl) return;
    curl_setopt($ch, CURLOPT_PROXY, $proxyUrl);
    if (strpos($proxyUrl, 'socks5h') === 0) {
        curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5_HOSTNAME);
    } elseif (strpos($proxyUrl, 'socks5') === 0) {
        curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5);
    } elseif (strpos($proxyUrl, 'socks4') === 0) {
        curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS4);
    }
}

// 硬超时安全网：生图上游通常 2–5 分钟才返回首字节，不能套用普通 API 的 60s。
// Nginx/FastCGI 超时必须略大于这里，由 PHP 先负责结束请求并返回可读错误。
$hardTimeout = $isStream ? 900 : ($isImageGeneration ? 900 : 180);

// ── 流式响应: 直接输出 ──
if ($isStream) {
    header('Content-Type: text/event-stream');
    header('Cache-Control: no-cache');
    header('X-Accel-Buffering: no');

    // ★ 立即发送注释刷新响应头, 防止中间代理 (含客户端本地代理) 缓冲 SSE
    echo ": connected\n\n";
    ob_flush();
    flush();

    $ch = curl_init($targetUrl);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    if ($bodyStr !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $bodyStr);
    if (!empty($curlHeaders)) curl_setopt($ch, CURLOPT_HTTPHEADER, $curlHeaders);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, $hardTimeout);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
    // ★ 低速检测: 120s 内传输 < 1 字节/秒 则中止 (防 SSE 流挂起, 同时给推理模型留足思考时间)
    curl_setopt($ch, CURLOPT_LOW_SPEED_LIMIT, 1);
    curl_setopt($ch, CURLOPT_LOW_SPEED_TIME, 120);
    _applyProxy($ch, $proxyUrl);

    // ★ 客户端断开检测: 通过 write 回调中止 curl
    $aborted = false;
    $streamDataSent = false; // 追踪是否已发送响应数据 (避免重试导致重复输出)
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) use (&$aborted, &$streamDataSent) {
        if (connection_aborted()) {
            $aborted = true;
            return -1; // 返回非 strlen 值 → curl 中止
        }
        if (strlen($data) > 0) $streamDataSent = true;
        echo $data;
        ob_flush();
        flush();
        return strlen($data);
    });

    curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    // ★ 未发送任何流数据时才允许切换出口，避免重复输出/重复模型请求。
    //    (已发送数据时重试会导致模型重新生成 → 内容重复, 故放弃)
    if ($error && !empty($fallbackProxies) && !$aborted && !$streamDataSent) {
        foreach ($fallbackProxies as $fallbackProxy) {
            if (!$error || connection_aborted() || $proxyUrl === $fallbackProxy) continue;
            error_log("[proxy.php] {$targetHost} 经 " . ($proxyUrl ?: 'direct') . " 失败: {$error} — 回退 {$fallbackProxy}");
            $ch2 = curl_init($targetUrl);
            curl_setopt($ch2, CURLOPT_CUSTOMREQUEST, $method);
            if ($bodyStr !== null) curl_setopt($ch2, CURLOPT_POSTFIELDS, $bodyStr);
            if (!empty($curlHeaders)) curl_setopt($ch2, CURLOPT_HTTPHEADER, $curlHeaders);
            curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch2, CURLOPT_FOLLOWLOCATION, true);
            curl_setopt($ch2, CURLOPT_TIMEOUT, $hardTimeout);
            curl_setopt($ch2, CURLOPT_CONNECTTIMEOUT, 15);
            curl_setopt($ch2, CURLOPT_LOW_SPEED_LIMIT, 1);
            curl_setopt($ch2, CURLOPT_LOW_SPEED_TIME, 120);
            _applyProxy($ch2, $fallbackProxy);
            curl_setopt($ch2, CURLOPT_WRITEFUNCTION, function($ch, $data) {
                if (connection_aborted()) return -1;
                echo $data;
                ob_flush();
                flush();
                return strlen($data);
            });
            curl_exec($ch2);
            $error = curl_error($ch2);
            curl_close($ch2);
            $proxyUrl = $fallbackProxy;
            if (!$error) break;
        }
    }

    if ($error) {
        echo "data: " . json_encode(['error' => $error]) . "\n\n";
    }
    exit;
}

// ── 非流式响应 ──
$ch = curl_init($targetUrl);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
if ($bodyStr !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $bodyStr);
if (!empty($curlHeaders)) curl_setopt($ch, CURLOPT_HTTPHEADER, $curlHeaders);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, $hardTimeout);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
_applyProxy($ch, $proxyUrl);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$error = curl_error($ch);
curl_close($ch);

// ★ 仅传输层失败时逐级回退；收到 HTTP 响应后不重放生图 POST，避免重复计费。
if ($error && !empty($fallbackProxies)) {
    foreach ($fallbackProxies as $fallbackProxy) {
        if (!$error || $proxyUrl === $fallbackProxy) continue;
        error_log("[proxy.php] {$targetHost} 经 " . ($proxyUrl ?: 'direct') . " 失败: {$error} — 回退 {$fallbackProxy}");
        $ch2 = curl_init($targetUrl);
        curl_setopt($ch2, CURLOPT_CUSTOMREQUEST, $method);
        if ($bodyStr !== null) curl_setopt($ch2, CURLOPT_POSTFIELDS, $bodyStr);
        if (!empty($curlHeaders)) curl_setopt($ch2, CURLOPT_HTTPHEADER, $curlHeaders);
        curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch2, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch2, CURLOPT_TIMEOUT, $hardTimeout);
        curl_setopt($ch2, CURLOPT_CONNECTTIMEOUT, 15);
        _applyProxy($ch2, $fallbackProxy);
        $response = curl_exec($ch2);
        $httpCode = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
        $contentType = curl_getinfo($ch2, CURLINFO_CONTENT_TYPE);
        $error = curl_error($ch2);
        curl_close($ch2);
        $proxyUrl = $fallbackProxy;
        if (!$error) break;
    }
}

if ($error) {
    http_response_code(502);
    echo json_encode(['error' => 'Request failed: ' . $error]);
    exit;
}

// 返回响应
http_response_code($httpCode);
if ($contentType) {
    header('Content-Type: ' . $contentType);
}
echo $response;
