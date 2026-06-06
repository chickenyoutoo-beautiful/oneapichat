<?php
/**
 * OneAPIChat 代理中继 — 将前端 API 请求通过代理转发
 * 支持 HTTP/HTTPS/SOCKS5 代理
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
$isStream = !empty($data['stream']);

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

$ch = curl_init($targetUrl);

// 设置请求方法和 body
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
if ($body !== null) {
    $bodyStr = is_array($body) ? json_encode($body) : (string)$body;
    curl_setopt($ch, CURLOPT_POSTFIELDS, $bodyStr);
}

// 设置请求头
$curlHeaders = [];
foreach ($headers as $key => $value) {
    $curlHeaders[] = "$key: $value";
}
if (!empty($curlHeaders)) {
    curl_setopt($ch, CURLOPT_HTTPHEADER, $curlHeaders);
}

// ★ 代理地址映射: 公网地址 → 内网直连
// proxy.php 运行在 xiaoxin (192.168.195.213), 可以直接走内网
$internalProxy = $proxyUrl;
if ($proxyUrl) {
    // proxy.naujtrats.xyz:8888 → 晓星 10808
    if (preg_match('#^https?://proxy\.naujtrats\.xyz:8888#', $proxyUrl)) {
        $internalProxy = 'http://192.168.195.213:10808';
    }
    // proxy.naujtrats.xyz:8889 → 天选 10808
    elseif (preg_match('#^https?://proxy\.naujtrats\.xyz:8889#', $proxyUrl)) {
        $internalProxy = 'http://192.168.195.22:10808';
    }
}

// 代理设置
if ($proxyUrl) {
    curl_setopt($ch, CURLOPT_PROXY, $internalProxy);

    // SOCKS5 代理类型
    if (strpos($proxyUrl, 'socks5') === 0) {
        curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5);
    } elseif (strpos($proxyUrl, 'socks4') === 0) {
        curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS4);
    }
}

// 通用设置
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 0);  // 无超时限制
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);

// ★ 流式响应: 直接输出
if ($isStream) {
    header('Content-Type: text/event-stream');
    header('Cache-Control: no-cache');
    header('X-Accel-Buffering: no');

    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) {
        echo $data;
        ob_flush();
        flush();
        return strlen($data);
    });

    curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($error) {
        echo "data: " . json_encode(['error' => $error]) . "\n\n";
    }
    exit;
}

// 非流式响应
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$error = curl_error($ch);
curl_close($ch);

// ★ 代理失败时降级直连（代理服务器可能临时不可用）
if ($error && $proxyUrl) {
    error_log("[proxy.php] 代理失败({$proxyUrl}): {$error} — 降级直连");
    $ch2 = curl_init($targetUrl);
    curl_setopt($ch2, CURLOPT_CUSTOMREQUEST, $method);
    if ($body !== null) {
        $bodyStr = is_array($body) ? json_encode($body) : (string)$body;
        curl_setopt($ch2, CURLOPT_POSTFIELDS, $bodyStr);
    }
    if (!empty($curlHeaders)) {
        curl_setopt($ch2, CURLOPT_HTTPHEADER, $curlHeaders);
    }
    curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch2, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch2, CURLOPT_TIMEOUT, 0);
    curl_setopt($ch2, CURLOPT_CONNECTTIMEOUT, 15);
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
