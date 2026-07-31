<?php
/**
 * OneAPIChat 代理中继 — 将前端 API 请求通过代理转发
 * 支持 HTTP/HTTPS/SOCKS5 代理 + 智能路由
 *
 * 路由策略:
 *   - 前端 tryDirect=true (代理开启): 封锁域名走 Mihomo, 其他直连优先 (失败回退 Mihomo)
 *   - 前端 tryDirect=false (代理关闭/直连已失败回退): 直走 Mihomo
 *   - 显式 proxy 参数: 使用指定代理
 *
 * 安全: 流式硬超时 900s + 低速检测 120s + 客户端断开传播, 防止永久挂起
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST required']);
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
if ($proxyUrl && !preg_match('#^(socks5|socks4|http|https)://#', $proxyUrl)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid proxy URL format']);
    exit;
}

// ── 路由决策 ──
$localProxy = 'socks5h://127.0.0.1:1081';
$targetHost = parse_url($targetUrl, PHP_URL_HOST) ?: '';

// GFW 封锁域名 — 服务器直连不通, 直接走 Mihomo (避免 15s 直连超时浪费)
$blockedHosts = [
    'generativelanguage.googleapis.com', 'googleapis.com',
    'api.openai.com',
    'api.anthropic.com',
    'api.x.ai',
    'openrouter.ai',
    'integrate.api.nvidia.com',
];
$isBlocked = false;
foreach ($blockedHosts as $bh) {
    if ($targetHost === $bh || str_ends_with($targetHost, '.' . $bh)) {
        $isBlocked = true;
        break;
    }
}

// ★ 智能路由: 代理开启 (tryDirect) 时, 非封锁域名直连优先, 失败回退 Mihomo
//    - 封锁域名 (Google/OpenAI/Anthropic/xAI/OpenRouter/NVIDIA) → 直走 Mihomo
//    - 代理关闭回退 (前端直连已失败) → 直走 Mihomo
//    - 显式 proxy 参数 → 使用指定代理
//    - 无 proxy 且非 tryDirect → 直连
$fallbackProxy = null;
if ($tryDirect && !$isBlocked) {
    // 直连优先, 失败回退 Mihomo
    $fallbackProxy = $localProxy;
} elseif (!$proxyUrl) {
    // 代理关闭回退 或 封锁域名 → 直走 Mihomo
    $proxyUrl = $localProxy;
}

// ── 构建 curl 公共数据 ──
$curlHeaders = [];
foreach ($headers as $key => $value) {
    $curlHeaders[] = "$key: $value";
}

$bodyStr = null;
if ($body !== null) {
    $bodyStr = is_array($body) ? json_encode($body, JSON_UNESCAPED_UNICODE) : (string)$body;
}

// ★ 客户端断开时中止 PHP (配合前端 AbortController, 不再空转)
ignore_user_abort(false);

// ── 应用代理设置 ──
function _applyProxy($ch, $proxyUrl) {
    if (!$proxyUrl) return;
    curl_setopt($ch, CURLOPT_PROXY, $proxyUrl);
    if (strpos($proxyUrl, 'socks5') === 0) {
        curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5);
    } elseif (strpos($proxyUrl, 'socks4') === 0) {
        curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS4);
    }
}

// 硬超时安全网: 流式 900s (15分钟, 给推理模型留足时间), 非流式 60s
$hardTimeout = $isStream ? 900 : 60;

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

    // ★ 直连失败 + 有回退代理 + 客户端未主动断开 + 未发送数据 → 回退 Mihomo 重试
    //    (已发送数据时重试会导致模型重新生成 → 内容重复, 故放弃)
    if ($error && $fallbackProxy && !$aborted && !$streamDataSent && $proxyUrl !== $fallbackProxy) {
        error_log("[proxy.php] 直连失败({$targetHost}): {$error} — 回退 Mihomo");
        if (!connection_aborted()) {
            echo "data: " . json_encode(['error' => "直连超时, 已切换代理重试..."]) . "\n\n";
            ob_flush();
            flush();
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

// ★ 直连失败 + 有回退代理 → 回退 Mihomo 重试
if ($error && $fallbackProxy && $proxyUrl !== $fallbackProxy) {
    error_log("[proxy.php] 直连失败({$targetHost}): {$error} — 回退 Mihomo");
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
