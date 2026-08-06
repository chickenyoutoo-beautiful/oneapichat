<?php
/**
 * OneAPIChat — MCP Client Proxy
 *
 * 浏览器端 MCP 客户端的 PHP 代理，解决 CORS 限制。
 * 支持 Streamable HTTP 和 SSE 两种传输协议。
 *
 * POST /oneapichat/api/mcp_client.php
 *
 * Actions:
 *   test  — 测试连接 (initialize + tools/list)
 *   call  — 调用工具 (tools/call)
 */

require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';

setApiCorsHeaders();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['success' => false, 'error' => 'Method not allowed, use POST']);
    exit;
}

$raw = file_get_contents('php://input');
$req = json_decode($raw, true);
if (!is_array($req)) {
    echo json_encode(['success' => false, 'error' => 'Invalid JSON']);
    exit;
}

$action = $req['action'] ?? '';

switch ($action) {
    case 'test':
        handle_test($req);
        break;
    case 'call':
        handle_call($req);
        break;
    default:
        echo json_encode(['success' => false, 'error' => 'Unknown action: ' . $action]);
        break;
}

exit;

// ============================================================
// Action: test — 测试连接并拉取工具列表
// ============================================================
function handle_test(array $req): void
{
    $url = trim($req['url'] ?? '');
    $transport = strtolower($req['transport'] ?? 'streamable-http');
    $headers = $req['headers'] ?? [];

    // 校验 URL
    $validated = validate_mcp_url($url);
    if (!$validated) {
        echo json_encode(['success' => false, 'error' => '无效的 URL: 必须为 http(s) 协议']);
        return;
    }

    // initialize
    $init_result = mcp_initialize($transport, $url, $headers);
    if (isset($init_result['error'])) {
        echo json_encode([
            'success' => false,
            'error' => '连接失败: ' . $init_result['error'],
        ]);
        return;
    }

    // tools/list
    $tools = mcp_list_tools($transport, $url, $headers, $init_result['session_id'] ?? null);
    if (isset($tools['error'])) {
        echo json_encode([
            'success' => false,
            'error' => '拉取工具失败: ' . $tools['error'],
        ]);
        return;
    }

    echo json_encode([
        'success' => true,
        'transport' => $transport,
        'server_name' => $init_result['server_name'] ?? '',
        'server_version' => $init_result['server_version'] ?? '',
        'tools_count' => count($tools['tools'] ?? []),
        'tools' => $tools['tools'] ?? [],
    ]);
}

// ============================================================
// Action: call — 调用工具
// ============================================================
function handle_call(array $req): void
{
    $url = trim($req['url'] ?? '');
    $transport = strtolower($req['transport'] ?? 'streamable-http');
    $headers = $req['headers'] ?? [];
    $tool = $req['tool'] ?? '';
    $arguments = $req['arguments'] ?? [];

    if (!$tool) {
        echo json_encode(['success' => false, 'error' => '缺少 tool 参数']);
        return;
    }

    $validated = validate_mcp_url($url);
    if (!$validated) {
        echo json_encode(['success' => false, 'error' => '无效的 URL']);
        return;
    }

    // 每次调用前 initialize (无状态模式，简单可靠)
    $init_result = mcp_initialize($transport, $url, $headers);
    $session_id = $init_result['session_id'] ?? null;

    $result = mcp_call_tool($transport, $url, $headers, $session_id, $tool, $arguments);

    if (isset($result['error'])) {
        echo json_encode(['success' => false, 'error' => $result['error']]);
        return;
    }

    echo json_encode([
        'success' => true,
        'result' => $result,
    ]);
}

// ============================================================
// MCP 协议: initialize
// ============================================================
function mcp_initialize(string $transport, string $url, array $custom_headers): array
{
    $payload = [
        'jsonrpc' => '2.0',
        'id' => 1,
        'method' => 'initialize',
        'params' => [
            'protocolVersion' => '2024-11-05',
            'capabilities' => (object)[],
            'clientInfo' => ['name' => 'oneapichat', 'version' => '1.0.0'],
        ],
    ];

    if ($transport === 'sse') {
        // SSE 模式: initialize 通过 POST 发送，结果从 SSE 流读取
        return ['session_id' => null, 'server_name' => '', 'server_version' => ''];
    }

    // Streamable HTTP
    $resp = mcp_json_rpc_post($url, $custom_headers, $payload, 15);
    if (isset($resp['error'])) {
        return $resp;
    }

    $body = $resp['body'] ?? [];
    $result = $body['result'] ?? [];

    return [
        'session_id' => $resp['session_id'] ?? null,
        'server_name' => $result['serverInfo']['name'] ?? '',
        'server_version' => $result['serverInfo']['version'] ?? '',
    ];
}

// ============================================================
// MCP 协议: tools/list
// ============================================================
function mcp_list_tools(string $transport, string $url, array $custom_headers, ?string $session_id): array
{
    $payload = [
        'jsonrpc' => '2.0',
        'id' => 2,
        'method' => 'tools/list',
        'params' => (object)[],
    ];

    if ($transport === 'sse') {
        return mcp_sse_session($url, $custom_headers, 'tools/list', $payload);
    }

    // Streamable HTTP
    $resp = mcp_json_rpc_post($url, $custom_headers, $payload, 30, $session_id);
    if (isset($resp['error'])) {
        return $resp;
    }

    return ['tools' => $resp['body']['result']['tools'] ?? []];
}

// ============================================================
// MCP 协议: tools/call
// ============================================================
function mcp_call_tool(string $transport, string $url, array $custom_headers, ?string $session_id, string $tool, array $arguments): array
{
    $payload = [
        'jsonrpc' => '2.0',
        'id' => 3,
        'method' => 'tools/call',
        'params' => ['name' => $tool, 'arguments' => $arguments],
    ];

    if ($transport === 'sse') {
        return mcp_sse_session($url, $custom_headers, 'tools/call', $payload);
    }

    // Streamable HTTP
    $resp = mcp_json_rpc_post($url, $custom_headers, $payload, 120, $session_id);
    if (isset($resp['error'])) {
        return $resp;
    }

    $body = $resp['body'] ?? [];
    return $body['result'] ?? $body;
}

// ============================================================
// Streamable HTTP: POST JSON-RPC
// ============================================================
function mcp_json_rpc_post(string $url, array $custom_headers, array $payload, int $timeout = 30, ?string $session_id = null): array
{
    $hdrs = ['Content-Type: application/json'];
    foreach ($custom_headers as $k => $v) {
        if (is_string($k) && is_string($v)) {
            $hdrs[] = $k . ': ' . $v;
        }
    }
    if ($session_id) {
        $hdrs[] = 'Mcp-Session-Id: ' . $session_id;
    }

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => $hdrs,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HEADER => true,
    ]);

    $response = curl_exec($ch);
    $err = curl_error($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $header_size = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);

    if ($response === false) {
        return ['error' => '连接失败: ' . ($err ?: '未知错误')];
    }

    $resp_headers = substr($response, 0, $header_size);
    $resp_body = substr($response, $header_size);

    // 提取 Mcp-Session-Id
    $sid = null;
    if (preg_match('/Mcp-Session-Id:\s*([^\r\n]+)/i', $resp_headers, $m)) {
        $sid = trim($m[1]);
    }

    // 检查 Content-Type 判断是 JSON 还是 SSE 流
    $content_type = '';
    if (preg_match('/Content-Type:\s*([^\r\n]+)/i', $resp_headers, $m)) {
        $content_type = strtolower(trim($m[1]));
    }

    if (strpos($content_type, 'text/event-stream') !== false) {
        // SSE 流响应 — 解析最后一个 result 事件
        $parsed = parse_sse_response($resp_body);
        if ($parsed !== null) {
            return ['session_id' => $sid, 'body' => $parsed];
        }
        return ['error' => '无法解析 SSE 流响应'];
    }

    // JSON 响应
    if ($http_code < 200 || $http_code >= 300) {
        $decoded = json_decode($resp_body, true);
        $err_msg = $decoded['error']['message'] ?? ($decoded['error'] ?? "HTTP $http_code");
        return ['error' => '服务器错误: ' . $err_msg];
    }

    $data = json_decode($resp_body, true);
    if (!is_array($data)) {
        return ['error' => '返回无效 JSON: ' . substr($resp_body, 0, 200)];
    }

    if (isset($data['error'])) {
        $err_msg = is_string($data['error']) ? $data['error'] : ($data['error']['message'] ?? json_encode($data['error']));
        return ['error' => $err_msg];
    }

    return ['session_id' => $sid, 'body' => $data];
}

// ============================================================
// SSE: 建立 session 并执行一次调用
// ============================================================
function mcp_sse_session(string $url, array $custom_headers, string $method, array $payload): array
{
    $hdrs = ['Accept: text/event-stream'];
    foreach ($custom_headers as $k => $v) {
        if (is_string($k) && is_string($v)) {
            $hdrs[] = $k . ': ' . $v;
        }
    }

    // 1. GET 打开 SSE 流获取 endpoint
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_HTTPGET => true,
        CURLOPT_HTTPHEADER => $hdrs,
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_WRITEFUNCTION => function($ch, $data) {
            // 只缓冲数据，不输出
            return strlen($data);
        },
    ]);

    // 使用一个更可控的方式：用临时流捕获 SSE
    $sse_buffer = '';
    $endpoint_url = null;
    $session_id = null;

    // 简单方案: GET 读取前几秒获取 endpoint 事件
    $ch2 = curl_init();
    curl_setopt_array($ch2, [
        CURLOPT_URL => $url,
        CURLOPT_HTTPGET => true,
        CURLOPT_HTTPHEADER => $hdrs,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    $sse_data = curl_exec($ch2);
    $sse_err = curl_error($ch2);
    curl_close($ch2);

    if ($sse_data === false) {
        return ['error' => 'SSE 连接失败: ' . ($sse_err ?: '未知错误')];
    }

    // 解析 SSE 流中的 endpoint 事件
    if (preg_match('/event:\s*endpoint\s*\r?\ndata:\s*(.+?)(?:\r?\n\r?\n|\r\r|$)/', $sse_data, $m)) {
        $endpoint_path = trim($m[1]);
        // 拼接完整 URL
        $parsed = parse_url($url);
        $base = ($parsed['scheme'] ?? 'http') . '://' . ($parsed['host'] ?? '');
        if (isset($parsed['port'])) $base .= ':' . $parsed['port'];

        if (preg_match('#^/#', $endpoint_path)) {
            $endpoint_url = $base . $endpoint_path;
        } elseif (preg_match('#^https?://#', $endpoint_path)) {
            $endpoint_url = $endpoint_path;
        } else {
            // 相对路径
            $base_path = $parsed['path'] ?? '';
            $endpoint_url = $base . rtrim(dirname($base_path), '/') . '/' . $endpoint_path;
        }

        // 提取 sessionId (可能在 endpoint URL 的 query 中)
        if (preg_match('/sessionId=([^&\s]+)/', $endpoint_path, $sm)) {
            $session_id = urldecode($sm[1]);
        }
    }

    if (!$endpoint_url) {
        return ['error' => '无法从 SSE 流获取 endpoint URL'];
    }

    // 2. POST 调用到 endpoint
    $call_hdrs = ['Content-Type: application/json'];
    foreach ($custom_headers as $k => $v) {
        if (is_string($k) && is_string($v)) {
            $call_hdrs[] = $k . ': ' . $v;
        }
    }

    $ch3 = curl_init();
    curl_setopt_array($ch3, [
        CURLOPT_URL => $endpoint_url,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => $call_hdrs,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    $call_resp = curl_exec($ch3);
    curl_close($ch3);

    // SSE 的 POST 通常返回 202 Accepted，实际结果通过 GET SSE 流返回
    // 但为了简化，我们再次打开 SSE 流获取结果
    if ($call_resp !== false && strlen($call_resp) > 0) {
        $decoded = json_decode($call_resp, true);
        if (is_array($decoded)) {
            if (isset($decoded['error'])) {
                return ['error' => is_string($decoded['error']) ? $decoded['error'] : ($decoded['error']['message'] ?? json_encode($decoded['error']))];
            }
            if (isset($decoded['result'])) {
                return $decoded['result'];
            }
        }
    }

    // 3. 重新打开 SSE 流读取结果 (带 session_id)
    $read_hdrs = ['Accept: text/event-stream'];
    foreach ($custom_headers as $k => $v) {
        if (is_string($k) && is_string($v)) {
            $read_hdrs[] = $k . ': ' . $v;
        }
    }

    // 用 endpoint_url 读取 SSE (复用 session)
    $ch4 = curl_init();
    curl_setopt_array($ch4, [
        CURLOPT_URL => $endpoint_url,
        CURLOPT_HTTPGET => true,
        CURLOPT_HTTPHEADER => $read_hdrs,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    $result_sse = curl_exec($ch4);
    curl_close($ch4);

    if ($result_sse) {
        $parsed = parse_sse_response($result_sse);
        if ($parsed !== null) {
            return $parsed;
        }
    }

    return ['error' => 'SSE 调用超时或无法读取结果'];
}

// ============================================================
// 解析 SSE 流 — 提取最后一个 JSON-RPC result
// ============================================================
function parse_sse_response(string $sse_data): ?array
{
    // 匹配 event: message \n data: {...}
    if (preg_match_all('/event:\s*message\s*\r?\ndata:\s*(\{.+?\})\s*(?:\r?\n\r?\n|\r\r)/s', $sse_data, $matches)) {
        // 取最后一个
        $last = end($matches[1]);
        $decoded = json_decode($last, true);
        if (is_array($decoded)) {
            if (isset($decoded['error'])) {
                return ['error' => is_string($decoded['error']) ? $decoded['error'] : ($decoded['error']['message'] ?? json_encode($decoded['error']))];
            }
            return $decoded;
        }
    }

    // 也尝试直接匹配 data: {...}
    if (preg_match_all('/^\s*data:\s*(\{.+?\}\s*)$/m', $sse_data, $matches)) {
        $last = end($matches[1]);
        $decoded = json_decode($last, true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }

    return null;
}

// ============================================================
// URL 校验
// ============================================================
function validate_mcp_url(string $url): bool
{
    if (!$url) return false;
    $parsed = parse_url($url);
    if (!$parsed) return false;
    $scheme = strtolower($parsed['scheme'] ?? '');
    if (!in_array($scheme, ['http', 'https'])) return false;
    if (empty($parsed['host'])) return false;
    return true;
}
