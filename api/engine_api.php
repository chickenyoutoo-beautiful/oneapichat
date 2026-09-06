<?php
header('Content-Type: application/json');
require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';
require_once __DIR__ . '/permission_grants.php';
setCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── 引擎请求辅助 (替代 @file_get_contents 抑制) ──
function _engine_bridge_secret(): string {
    static $secret = null;
    if ($secret !== null) return $secret;
    $path = dirname(__DIR__) . '/.engine/internal_bridge.key';
    $raw = is_readable($path) ? file_get_contents($path) : false;
    $secret = ($raw !== false) ? trim($raw) : '';
    return strlen($secret) >= 32 ? $secret : '';
}
function _engine_headers(array $headers = []): array {
    $secret = _engine_bridge_secret();
    if ($secret !== '') $headers[] = 'X-OneAPIChat-Internal: ' . $secret;
    return $headers;
}
function _engine_get(string $path, string $fallback = '{}', $customCtx = null): string {
    $options = $customCtx ? stream_context_get_options($customCtx) : [];
    $http = $options['http'] ?? [];
    $http['timeout'] = $http['timeout'] ?? 120;
    $http['ignore_errors'] = true;
    $headers = $http['header'] ?? [];
    if (is_string($headers)) $headers = preg_split('/\r?\n/', trim($headers));
    $http['header'] = _engine_headers(is_array($headers) ? $headers : []);
    $options['http'] = $http;
    $ctx = stream_context_create($options);
    $resp = file_get_contents($path, false, $ctx);
    return ($resp !== false) ? $resp : $fallback;
}
function _engine_post_json(string $path, array $payload, string $fallback = '{}'): string {
    $ch = curl_init($path);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => _engine_headers(['Content-Type: application/json', 'Accept: application/json']),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 120,
    ]);
    $resp = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    return (!$err && $resp !== false) ? $resp : $fallback;
}

function _engine_mmx_config_read(): array {
    $path = dirname(__DIR__) . '/config/.mmx_config.json';
    if (!file_exists($path)) return [];
    $raw = file_get_contents($path);
    if ($raw === false) return [];
    $cfg = json_decode($raw, true);
    return is_array($cfg) ? $cfg : [];
}
// ★ 递归删除目录（用于清理 mmx 隔离 HOME）
function _rmdir(string $dir): bool {
    if (!is_dir($dir)) return false;
    $items = array_diff(scandir($dir), ['.', '..']);
    foreach ($items as $item) {
        $path = $dir . '/' . $item;
        is_dir($path) ? _rmdir($path) : @unlink($path);
    }
    return @rmdir($dir);
}

$action = $_GET['action'] ?? '';
$engine_url = 'http://127.0.0.1:8766';

// ── /engine/video_edit POST 转发 ──
$requestUri = $_SERVER['REQUEST_URI'] ?? '';
$requestPath = parse_url($requestUri, PHP_URL_PATH) ?? '';
if (str_ends_with($requestPath, '/engine/video_edit') && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = file_get_contents('php://input');
    $ch = curl_init($engine_url . '/engine/video_edit');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => _engine_headers(['Content-Type: application/json']),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 600,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($err) {
        http_response_code(502);
        echo json_encode(['error' => 'Engine unreachable: ' . $err]);
    } else {
        http_response_code($httpCode);
        echo $resp;
    }
    exit;
}

// ★ 优先从 HTTP Header 读取 auth_token (避免 URL 明文传输)
$authHeader = '';
if (function_exists('getallheaders')) {
    $headers = getallheaders();
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    if ($authHeader && strpos($authHeader, 'Bearer ') === 0) {
        $authHeader = substr($authHeader, 7);
    }
} elseif (isset($_SERVER['HTTP_AUTHORIZATION'])) {
    $authHeader = str_replace('Bearer ', '', $_SERVER['HTTP_AUTHORIZATION']);
} elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    $authHeader = str_replace('Bearer ', '', $_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
}
$authToken = '';
// Header 优先, 回退到 GET param (兼容旧版)
if (!empty($authHeader) && preg_match('/^[a-f0-9]{32,}$/', $authHeader)) {
    $authToken = $authHeader;
} elseif (isset($_GET['auth_token'])) {
    $authToken = preg_replace('/[^a-f0-9]/', '', $_GET['auth_token']);
} elseif (!empty($_COOKIE['auth_token'])) {
    $authToken = preg_replace('/[^a-f0-9]/', '', (string) $_COOKIE['auth_token']);
}
$userId = '';
if (!empty($authToken)) {
    $uid = verifyAuthToken($authToken);
    if ($uid !== null) {
        $userId = $uid;
    }
}
$userParam = $userId ? '&user_id=' . urlencode($userId) : '';
// 浏览器端点通过本地 PHP bridge 调用引擎，必须显式携带已验证的用户绑定；
// 内部 bridge 不会把 PHP 会话自动映射到 FastAPI request.state。
$engineUserQuery = $userId ? '?user_id=' . urlencode($userId) : '';

function _permission_grant_input(): array {
    static $cached = null;
    if (is_array($cached)) return $cached;
    $raw = file_get_contents('php://input');
    $body = $raw ? json_decode($raw, true) : [];
    $cached = is_array($body) ? $body : [];
    return $cached;
}
function _permission_grant_for(string $userId, string $capability): array {
    $grantId = trim((string)($_SERVER['HTTP_X_ONEAPICHAT_GRANT'] ?? $_GET['grant_id'] ?? ''));
    $chatId = trim((string)($_SERVER['HTTP_X_ONEAPICHAT_CHAT'] ?? $_GET['chat_id'] ?? ''));
    if (!$grantId) {
        $input = _permission_grant_input();
        $grantId = trim((string)($input['grant_id'] ?? ''));
        if (!$chatId) $chatId = trim((string)($input['chat_id'] ?? ''));
    }
    return [verifyPermissionGrant($grantId, $userId, $chatId, $capability), $grantId, $chatId];
}
function _require_permission_grant(string $userId, string $capability): array {
    [$ok, $grantId, $chatId] = _permission_grant_for($userId, $capability);
    if (!$ok) {
        http_response_code(403);
        echo json_encode([
            'ok' => false,
            'error' => '需要用户批准扩展文件系统权限',
            'code' => 'PERMISSION_REQUIRED',
            'capability' => $capability,
            'chat_id' => $chatId,
            'retryable' => true,
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
    return [$grantId, $chatId];
}

// ★ 强制认证: 部分 action 无需 session 登录（有自己的 API Key 或公开股票行情等只读接口）
$publicActions = [
    'health', 'get_encryption_key',
    'stock_realtime', 'stock_market_overview', 'stock_kline',
    'stock_sector_flow', 'stock_dragon_tiger', 'stock_north_flow',
    'stock_diagnosis', 'stock_indicators', 'stock_chart',
];
if (!$userId && !in_array($action, $publicActions, true)) {
    http_response_code(401);
    echo json_encode(['error' => '未登录，请先登录', 'code' => 'UNAUTHORIZED']);
    exit;
}

switch ($action) {
    case 'permission_grant_create':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error'=>'POST required']); break; }
        $input = _permission_grant_input();
        $chatId = normalizeGrantChatId((string)($input['chat_id'] ?? ''));
        $caps = normalizeGrantCapabilities($input['capabilities'] ?? []);
        try {
            purgeExpiredPermissionGrants();
            $grant = issuePermissionGrant($userId, $chatId, $caps, intval($input['ttl_seconds'] ?? 1800));
            echo json_encode(['ok'=>true] + $grant, JSON_UNESCAPED_UNICODE);
        } catch (Throwable $e) {
            http_response_code(400); echo json_encode(['ok'=>false,'error'=>'invalid grant request']);
        }
        break;

    case 'permission_grant_revoke':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error'=>'POST required']); break; }
        $input = _permission_grant_input();
        $grantId = (string)($input['grant_id'] ?? $_GET['grant_id'] ?? '');
        $chatId = (string)($input['chat_id'] ?? $_GET['chat_id'] ?? '');
        $ok = revokePermissionGrant($grantId, $userId, $chatId);
        echo json_encode(['ok'=>$ok]);
        break;

    case 'permission_grant_status':
        $capability = (string)($_GET['capability'] ?? 'filesystem.read');
        [$ok, $_grantId, $chatId] = _permission_grant_for($userId, $capability);
        echo json_encode(['ok'=>true,'granted'=>$ok,'chat_id'=>$chatId,'capability'=>$capability]);
        break;

    case 'health':
        $resp = _engine_get($engine_url . '/engine/health');
        echo $resp ?: json_encode(['status' => 'error', 'message' => 'unreachable']);
        break;

    case 'workspace_browse':
        // 仅列出目录名称，供 Agent 工作区选择器浏览；不返回文件内容。
        $requested = trim((string)($_GET['path'] ?? '/var/www/html/oneapichat'));
        $allowedRoots = ['/var/www', '/home', '/opt', '/tmp'];
        $resolved = realpath($requested);
        if ($resolved === false || !is_dir($resolved)) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => '目录不存在或不可访问'], JSON_UNESCAPED_UNICODE);
            break;
        }
        $allowed = false;
        foreach ($allowedRoots as $root) {
            $realRoot = realpath($root);
            if ($realRoot !== false && ($resolved === $realRoot || str_starts_with($resolved, $realRoot . DIRECTORY_SEPARATOR))) {
                $allowed = true;
                break;
            }
        }
        if (!$allowed) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => '该目录不在允许浏览范围内'], JSON_UNESCAPED_UNICODE);
            break;
        }
        $directories = [];
        $entries = @scandir($resolved);
        if ($entries === false) {
            http_response_code(403);
            echo json_encode(['ok' => false, 'error' => '目录不可读'], JSON_UNESCAPED_UNICODE);
            break;
        }
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..' || str_starts_with($entry, '.')) continue;
            $child = $resolved . DIRECTORY_SEPARATOR . $entry;
            if (!is_dir($child) || is_link($child)) continue;
            $directories[] = ['name' => $entry, 'path' => $child];
            if (count($directories) >= 200) break;
        }
        usort($directories, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));
        $parent = dirname($resolved);
        if ($parent === $resolved) $parent = null;
        echo json_encode([
            'ok' => true,
            'path' => $resolved,
            'parent' => $parent,
            'directories' => $directories,
            'roots' => $allowedRoots,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        break;

    case 'get_encryption_key':
        // 返回 AES 加密密钥 (需认证，与 config.ini 一致)
        $auth = $_GET['auth'] ?? '';
        if (!$auth || !verifyAuthToken($auth)) {
            http_response_code(401);
            echo json_encode(['error' => 'unauthorized']);
            exit;
        }
        require_once __DIR__ . '/init.php';
        echo json_encode(['encryption_key' => getEncryptionKey()]);
        break;

    case 'chat_stream':
        // SSE 流（支持 offset 断点续传）
        $msg_id = urlencode($_GET['msg_id'] ?? '');
        $since = intval($_GET['since'] ?? 0);
        $stream_id = urlencode($_GET['stream_id'] ?? '');
        $snapshot = intval($_GET['snapshot'] ?? 0);
        if (!$msg_id && !$stream_id) {
            http_response_code(400);
            echo json_encode(['error' => 'msg_id or stream_id required']);
            exit;
        }
        ini_set('output_buffering', 'off');
        ini_set('zlib.output_compression', false);
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: text/event-stream');
        header('Cache-Control: no-cache');
        header('X-Accel-Buffering: no');
        $stream_url = $engine_url . '/engine/chat/stream?msg_id=' . $msg_id
            . '&since=' . $since . '&stream_id=' . $stream_id
            . '&snapshot=' . $snapshot . $userParam;
        $ch = curl_init($stream_url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_HTTPHEADER => _engine_headers(),
            CURLOPT_WRITEFUNCTION => function($ch, $data) {
                echo $data; ob_flush(); flush(); return strlen($data);
            },
            CURLOPT_TIMEOUT => 600,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        curl_exec($ch);
        curl_close($ch);
        exit;

    case 'chat_create':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            http_response_code(405); echo json_encode(['error' => 'POST required']); exit;
        }
        if (!$userId) { http_response_code(401); echo json_encode(['error' => 'auth required']); exit; }
        $body = file_get_contents('php://input');
        $createData = json_decode($body ?: '{}', true);
        // DSH-style durable idempotency: derive one stable msg_id when a legacy client omits it.
        // This lets the Python engine attach retries/other tabs to the same authoritative task.
        if (is_array($createData) && empty($createData['msg_id'])) {
            $chatKey = (string)($createData['chat_id'] ?? '');
            $lastUser = '';
            $messages = isset($createData['messages']) && is_array($createData['messages']) ? $createData['messages'] : [];
            for ($i = count($messages) - 1; $i >= 0; $i--) {
                if (is_array($messages[$i]) && (($messages[$i]['role'] ?? '') === 'user')) {
                    $lastUser = json_encode($messages[$i], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                    break;
                }
            }
            $createData['msg_id'] = 'msg_req_' . substr(hash('sha256', $userId . '|' . $chatKey . '|' . $lastUser), 0, 24);
            $body = json_encode($createData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        $traceId = is_array($createData) ? trim((string)($createData['trace_id'] ?? ($_SERVER['HTTP_X_ONEAPICHAT_TRACE'] ?? ''))) : '';
        if ($traceId !== '') {
            $traceEntry = [
                'ts' => (int)(microtime(true) * 1000), 'component' => 'engine_api.php', 'stage' => 'stream_create_forward',
                'trace_id' => substr(preg_replace('/[^a-zA-Z0-9_.:-]/', '', $traceId), 0, 96),
                'chat_id' => (string)($createData['chat_id'] ?? ''), 'msg_id' => (string)($createData['msg_id'] ?? ''),
                'user_id' => $userId, 'model' => (string)($createData['model'] ?? ''), 'bytes' => strlen((string)$body),
            ];
            @file_put_contents(ONECHAT_ROOT . '/logs/multidevice-sync.jsonl', json_encode($traceEntry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
        }
        $ch = curl_init($engine_url . '/engine/chat/create?user_id=' . urlencode($userId));
        $createHeaders = ['Content-Type: application/json'];
        if ($traceId !== '') $createHeaders[] = 'X-OneAPIChat-Trace: ' . $traceId;
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => _engine_headers($createHeaders),
            CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);
        if ($traceId !== '') {
            $resultData = json_decode($resp ?: '{}', true);
            $traceEntry = [
                'ts' => (int)(microtime(true) * 1000), 'component' => 'engine_api.php', 'stage' => 'stream_create_result',
                'trace_id' => substr(preg_replace('/[^a-zA-Z0-9_.:-]/', '', $traceId), 0, 96),
                'chat_id' => (string)($createData['chat_id'] ?? ''), 'user_id' => $userId,
                'http_status' => $code, 'ok' => $curlErr === '' && $code >= 200 && $code < 300,
                'stream_id' => is_array($resultData) ? (string)($resultData['stream_id'] ?? '') : '',
                'task_id' => is_array($resultData) ? (string)($resultData['task_id'] ?? '') : '',
                'error' => $curlErr !== '' ? substr($curlErr, 0, 160) : '',
            ];
            @file_put_contents(ONECHAT_ROOT . '/logs/multidevice-sync.jsonl', json_encode($traceEntry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
        }
        http_response_code($code ?: 200);
        header('Content-Type: application/json; charset=utf-8');
        echo $resp;
        break;

    case 'heartbeat':
        $resp = _engine_get($engine_url . '/engine/heartbeat?' . $userParam);
        echo $resp ?: json_encode(['ok' => false, 'responses' => []]);
        break;

    case 'events_broadcast':
        // 转发前端广播到引擎 (SSE 事件总线)
        $body = file_get_contents('php://input');
        $parsed = json_decode($body ?: '{}', true);
        $eventType = is_array($parsed) ? (string)($parsed['event_type'] ?? '') : '';
        $eventData = is_array($parsed) && isset($parsed['data']) && is_array($parsed['data']) ? $parsed['data'] : [];
        $traceId = trim((string)($eventData['trace_id'] ?? ($_SERVER['HTTP_X_ONEAPICHAT_TRACE'] ?? '')));
        if ($traceId !== '') {
            $traceEntry = [
                'ts' => (int)(microtime(true) * 1000),
                'component' => 'engine_api.php',
                'stage' => 'broadcast_forward',
                'trace_id' => substr(preg_replace('/[^a-zA-Z0-9_.:-]/', '', $traceId), 0, 96),
                'event_type' => $eventType,
                'chat_id' => (string)($eventData['chat_id'] ?? ''),
                'user_id' => $userId,
                'source' => (string)($eventData['source'] ?? ''),
                'bytes' => strlen((string)$body),
            ];
            @file_put_contents(ONECHAT_ROOT . '/logs/multidevice-sync.jsonl', json_encode($traceEntry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
        }
        $ch = curl_init($engine_url . '/engine/events/broadcast?' . $userParam);
        $headers = ['Content-Type: application/json'];
        if ($traceId !== '') $headers[] = 'X-OneAPIChat-Trace: ' . $traceId;
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => _engine_headers($headers),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 5,
        ]);
        $resp = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);
        if ($traceId !== '') {
            $traceEntry = [
                'ts' => (int)(microtime(true) * 1000),
                'component' => 'engine_api.php',
                'stage' => 'broadcast_result',
                'trace_id' => substr(preg_replace('/[^a-zA-Z0-9_.:-]/', '', $traceId), 0, 96),
                'event_type' => $eventType,
                'chat_id' => (string)($eventData['chat_id'] ?? ''),
                'user_id' => $userId,
                'http_status' => $httpCode,
                'ok' => $curlErr === '' && $httpCode >= 200 && $httpCode < 300,
                'error' => $curlErr !== '' ? substr($curlErr, 0, 160) : '',
            ];
            @file_put_contents(ONECHAT_ROOT . '/logs/multidevice-sync.jsonl', json_encode($traceEntry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
        }
        echo $resp !== false ? $resp : json_encode(['ok' => false, 'error' => $curlErr ?: 'engine unavailable']);
        break;

    case 'notifications':
        // 返回用户未读的 cron/agent 通知
        $resp = _engine_get($engine_url . '/engine/notifications?' . $userParam);
        echo $resp ?: json_encode(['ok' => true, 'notifications' => [], 'cron_results' => [], 'agent_results' => []]);
        break;

    case 'cron_list':
        echo _engine_get($engine_url . '/engine/cron/list?' . $userParam) ?: '{}';
        break;

    case 'cron_create':
        $name = $_GET['name'] ?? '';
        $interval = intval($_GET['interval'] ?? 60);
        $action_cmd = $_GET['action_cmd'] ?? '';
        if (!$name || !$action_cmd) { echo json_encode(['error' => '缺少参数']); exit; }
        $url = $engine_url . '/engine/cron/create?name=' . urlencode($name) . '&interval=' . $interval . '&action=' . urlencode($action_cmd) . $userParam;
        echo _engine_get($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'cron_delete':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo _engine_get($engine_url . '/engine/cron/delete?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'agent_list':
        echo _engine_get($engine_url . '/engine/agent/list?' . $userParam) ?: '{}';
        break;

    case 'agent_create':
        $body = json_decode(file_get_contents('php://input'), true);
        if (!is_array($body)) $body = [];
        $name = $body['name'] ?? ($_GET['name'] ?? '');
        $prompt = $body['prompt'] ?? ($_GET['prompt'] ?? '');
        $model = $body['model'] ?? ($_GET['model'] ?? '');
        $base_url = $body['base_url'] ?? ($_GET['base_url'] ?? '');
        $provider = $body['provider'] ?? ($_GET['provider'] ?? '');
        $role = $body['role'] ?? ($_GET['role'] ?? 'general');
        $proxy_url = $body['proxy_url'] ?? ($_GET['proxy_url'] ?? '');
        $proxy_enabled = $body['proxy_enabled'] ?? ($_GET['proxy_enabled'] ?? '');
        if (!$name || !$prompt) { echo json_encode(['error' => '缺少参数']); exit; }
        // Credentials are intentionally never forwarded; the engine loads encrypted per-user config.
        $url = $engine_url . '/engine/agent/create?user_id=' . urlencode($userId);
        echo _engine_post_json($url, [
            'name' => $name, 'prompt' => $prompt, 'model' => $model,
            'base_url' => $base_url, 'provider' => $provider, 'role' => $role,
            'proxy_url' => $proxy_url, 'proxy_enabled' => $proxy_enabled,
        ], json_encode(['ok' => false, 'error' => 'engine unreachable']));
        break;

    case 'agent_run':
        $body = json_decode(file_get_contents('php://input'), true);
        if (!is_array($body)) $body = [];
        $name = $body['name'] ?? ($_GET['name'] ?? '');
        $message = $body['message'] ?? ($_GET['message'] ?? '');
        $from_ask = $body['from_ask'] ?? ($_GET['from_ask'] ?? '');
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        $url = $engine_url . '/engine/agent/run?user_id=' . urlencode($userId);
        echo _engine_post_json($url, [
            'name' => $name, 'message' => $message, 'from_ask' => $from_ask,
        ], json_encode(['ok' => false, 'error' => 'engine unreachable']));
        break;

    case 'agent_status':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo _engine_get($engine_url . '/engine/agent/status?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'agent_stop':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo _engine_get($engine_url . '/engine/agent/stop?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'agent_delete':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo _engine_get($engine_url . '/engine/agent/delete?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'agent_notifications':
        $raw = _engine_get($engine_url . '/engine/agent/notifications?' . $userParam, '');
        $data = $raw ? json_decode($raw, true) : null;
        if (!$data) {
            echo json_encode(['notifications' => [], 'count' => 0, 'allProcessed' => true]);
            break;
        }
        $notifs = $data['notifications'] ?? [];
        // 判断是否全部已处理
        $allProcessed = true;
        foreach ($notifs as $n) {
            if (empty($n['processed'])) { $allProcessed = false; break; }
        }
        $data['allProcessed'] = $allProcessed;
        echo json_encode($data);
        break;

    case 'agent_notifications_mark':
        echo _engine_get($engine_url . '/engine/agent/notifications/mark?' . $userParam) ?: json_encode(['ok' => false]);
        break;

    case 'workflow_create':
        $name = $_GET['name'] ?? '';
        $steps = $_GET['steps'] ?? '';
        if (!$name || !$steps) { echo json_encode(['error' => '缺少参数']); exit; }
        echo _engine_get($engine_url . '/engine/workflow/create?name=' . urlencode($name) . '&steps=' . urlencode($steps) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'workflow_run':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo _engine_get($engine_url . '/engine/workflow/run?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'workflow_list':
        echo _engine_get($engine_url . '/engine/workflow/list?' . $userParam) ?: '{}';
        break;

    case 'workflow_status':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo _engine_get($engine_url . '/engine/workflow/status?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'workflow_delete':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo _engine_get($engine_url . '/engine/workflow/delete?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'workflow_roles':
        echo _engine_get($engine_url . '/engine/workflow/roles?' . $userParam) ?: json_encode(['roles' => []]);
        break;

    case 'push':
        $msg = $_GET['msg'] ?? '';
        if (!$msg) { echo json_encode(['error' => '缺少msg']); exit; }
        $url = $engine_url . '/engine/heartbeat/push?msg=' . urlencode($msg) . $userParam;
        echo _engine_get($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;


    case 'run_code':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error'=>'POST required']); break; }
        $body = _permission_grant_input();
        $full_access_requested = !empty($body['full_access']);
        if ($full_access_requested) _require_permission_grant($userId, 'filesystem.write');
        $body['user_id'] = $userId;
        $body['full_access'] = $full_access_requested;
        echo _engine_post_json($engine_url . '/engine/run_code', $body, json_encode(['ok'=>false,'error'=>'engine unreachable']));
        break;

    case 'exec':
        $cmd = '';
        $timeout = intval($_GET['timeout'] ?? 60);
        $cwd = $_GET['cwd'] ?? '';
        // ★ 复杂命令(含引号/特殊字符)用 POST JSON/raw body 传输,避免 URL 转义和长度限制
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $rawBody = file_get_contents('php://input');
            if ($rawBody !== false && trim($rawBody) !== '') {
                $parsed = json_decode($rawBody, true);
                if (is_array($parsed)) {
                    $cmd = $parsed['cmd'] ?? $parsed['command'] ?? '';
                    if (isset($parsed['timeout'])) $timeout = intval($parsed['timeout']);
                    if (isset($parsed['cwd'])) $cwd = $parsed['cwd'];
                } else {
                    $cmd = $rawBody;
                }
            }
        }
        if ($cmd === '') $cmd = $_GET['cmd'] ?? $_GET['command'] ?? '';
        if (!$cmd) { echo json_encode(['error' => '缺少cmd']); exit; }
        $url = $engine_url . '/engine/exec?timeout=' . $timeout . '&cwd=' . urlencode($cwd) . $userParam;
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $cmd);
        curl_setopt($ch, CURLOPT_HTTPHEADER, _engine_headers(['Content-Type: text/plain']));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout + 10);
        $resp = curl_exec($ch);
        $err = curl_error($ch);
        curl_close($ch);
        echo $resp ?: json_encode(['ok' => false, 'error' => 'engine unreachable: ' . $err]);
        break;

    case 'python':
        $timeout = intval($_GET['timeout'] ?? 30);
        // ★ script 从 POST raw body 读(支持大脚本)
        $script = file_get_contents('php://input');
        if (!$script) { echo json_encode(['error' => '缺少script']); exit; }
        // ★ 大脚本:路径参数在 URL,content 通过 raw body 传
        $url = $engine_url . '/engine/python?timeout=' . $timeout;
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $script);
        curl_setopt($ch, CURLOPT_HTTPHEADER, _engine_headers(['Content-Type: text/plain']));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout + 5);
        echo curl_exec($ch) ?: json_encode(['ok' => false, 'error' => 'engine unreachable: ' . curl_error($ch)]);
        curl_close($ch);
        break;

    case 'file_read':
        $path = $_GET['path'] ?? '';
        $cwd = $_GET['cwd'] ?? '';
        $max_lines = intval($_GET['max_lines'] ?? 200);
        $start_line = intval($_GET['start_line'] ?? 0);
        $end_line = intval($_GET['end_line'] ?? 0);
        $offset = (isset($_GET['offset']) && $_GET['offset'] !== '') ? intval($_GET['offset']) : -1;
        $max_chars = intval($_GET['max_chars'] ?? 0);
        if (!$path) { echo json_encode(['error' => '缺少path']); exit; }
        $full_access_requested = (($_GET['full_access'] ?? '') === 'true' || ($_GET['full_access'] ?? '') === '1');
        if ($full_access_requested) _require_permission_grant($userId, 'filesystem.read');
        $full_access = $full_access_requested ? '&full_access=true' : '';
        $url = $engine_url . '/engine/file/read?path=' . urlencode($path) . '&max_lines=' . $max_lines . ($cwd !== '' ? '&cwd=' . urlencode($cwd) : '') . $full_access;
        if ($start_line > 0) $url .= '&start_line=' . $start_line;
        if ($end_line > 0) $url .= '&end_line=' . $end_line;
        if ($offset >= 0) $url .= '&offset=' . $offset;
        if ($max_chars > 0) $url .= '&max_chars=' . $max_chars;
        echo _engine_get($url . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'parse_document':
        $path = $_GET['path'] ?? '';
        $max_chars = intval($_GET['max_chars'] ?? 50000);
        if (!$path) { echo json_encode(['ok' => false, 'error' => '缺少path参数']); exit; }
        $full_access_requested = (($_GET['full_access'] ?? '') === 'true' || ($_GET['full_access'] ?? '') === '1');
        if ($full_access_requested) _require_permission_grant($userId, 'filesystem.read');
        $full_access = $full_access_requested ? '&full_access=true' : '';
        $url = $engine_url . '/engine/parse_document?path=' . urlencode($path) . '&max_chars=' . $max_chars . $full_access;
        echo _engine_get($url . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    // ═══════════════════════════════════════════════════
    // ★ 股票数据工具 (A股 — 东方财富数据源, 10秒缓存)
    // ═══════════════════════════════════════════════════
    case 'stock_realtime':
        $symbol = $_GET['symbol'] ?? '';
        if (!$symbol) { echo json_encode(['ok' => false, 'error' => '缺少symbol参数']); exit; }
        $url = $engine_url . '/engine/stock_realtime?symbol=' . urlencode($symbol);
        echo _engine_get($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;
    case 'stock_kline':
        $symbol = $_GET['symbol'] ?? '';
        if (!$symbol) { echo json_encode(['ok' => false, 'error' => '缺少symbol参数']); exit; }
        $period = $_GET['period'] ?? 'daily';
        $start = $_GET['start'] ?? '';
        $end = $_GET['end'] ?? '';
        $adjust = $_GET['adjust'] ?? 'qfq';
        $count = intval($_GET['count'] ?? 120);
        $url = $engine_url . '/engine/stock_kline?symbol=' . urlencode($symbol)
            . '&period=' . urlencode($period) . '&adjust=' . urlencode($adjust) . '&count=' . $count;
        if ($start) $url .= '&start=' . urlencode($start);
        if ($end) $url .= '&end=' . urlencode($end);
        echo _engine_get($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;
    case 'stock_sector_flow':
        $sector_type = $_GET['sector_type'] ?? '2';
        $url = $engine_url . '/engine/stock_sector_flow?sector_type=' . urlencode($sector_type);
        echo _engine_get($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;
    case 'stock_dragon_tiger':
        $date = $_GET['date'] ?? '';
        $url = $engine_url . '/engine/stock_dragon_tiger?date=' . urlencode($date);
        echo _engine_get($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;
    case 'stock_north_flow':
        $url = $engine_url . '/engine/stock_north_flow';
        echo _engine_get($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;
    case 'stock_diagnosis':
        $symbol = $_GET['symbol'] ?? '';
        if (!$symbol) { echo json_encode(['ok' => false, 'error' => '缺少symbol参数']); exit; }
        $url = $engine_url . '/engine/stock_diagnosis?symbol=' . urlencode($symbol);
        echo _engine_get($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;
    case 'stock_indicators':
        $symbol = $_GET['symbol'] ?? '';
        if (!$symbol) { echo json_encode(['ok' => false, 'error' => '缺少symbol参数']); exit; }
        $count = intval($_GET['count'] ?? 120);
        $url = $engine_url . '/engine/stock_indicators?symbol=' . urlencode($symbol) . '&count=' . $count;
        echo _engine_get($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;
    case 'stock_chart':
        $symbol = $_GET['symbol'] ?? '';
        if (!$symbol) { echo json_encode(['ok' => false, 'error' => '缺少symbol参数']); exit; }
        $period = $_GET['period'] ?? 'daily';
        $count = intval($_GET['count'] ?? 60);
        $adjust = $_GET['adjust'] ?? 'qfq';
        $indicators = $_GET['indicators'] ?? 'ma,macd,volume';
        $url = $engine_url . '/engine/stock_chart?symbol=' . urlencode($symbol)
            . '&period=' . urlencode($period) . '&count=' . $count
            . '&adjust=' . urlencode($adjust) . '&indicators=' . urlencode($indicators);
        echo _engine_get($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;
    case 'stock_market_overview':
        $url = $engine_url . '/engine/stock_market_overview';
        echo _engine_get($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'file_write':
        $path = $_GET['path'] ?? '';
        $cwd = $_GET['cwd'] ?? '';
        $append = isset($_GET['append']) && $_GET['append'] === 'true';
        // ★ content 从 POST raw body 读(支持大文件)
        $content = file_get_contents('php://input');
        if (!$path || $content === false || $content === '') { echo json_encode(['error' => '缺少参数']); exit; }
        // ★ 大文件:参数放在 URL query,content 通过 CURLOPT_POSTFIELDS 的 raw body 传
        $full_access_requested = (($_GET['full_access'] ?? '') === 'true' || ($_GET['full_access'] ?? '') === '1');
        if ($full_access_requested) _require_permission_grant($userId, 'filesystem.write');
        $full_access = $full_access_requested ? '&full_access=true' : '';
        $url = $engine_url . '/engine/file/write?path=' . urlencode($path) . '&append=' . ($append ? 'true' : 'false') . ($cwd !== '' ? '&cwd=' . urlencode($cwd) : '') . $full_access . $userParam;
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $content);
        curl_setopt($ch, CURLOPT_HTTPHEADER, _engine_headers(['Content-Type: text/plain']));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        echo curl_exec($ch) ?: json_encode(['ok' => false, 'error' => 'engine unreachable: ' . curl_error($ch)]);
        curl_close($ch);
        break;

    case 'sys_info':
        echo _engine_get($engine_url . '/engine/sys/info?') ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'unknown action', 'supported_actions' => [
            'health', 'chat_stream', 'chat_create', 'heartbeat', 'events_broadcast',
            'notifications', 'cron_list', 'cron_create', 'cron_delete',
            'agent_list', 'agent_create', 'agent_run', 'agent_status', 'agent_stop', 'agent_delete',
            'agent_notifications', 'agent_notifications_mark',
            'agent_persona_load', 'agent_persona_save', 'agent_memory_load', 'agent_memory_save', 'agent_memory_delete',
            'agent_identity_load', 'agent_identity_save', 'agent_heartbeat', 'agent_heartbeat_status',
            // ★ 记忆系统 v2
            'memory_fact_save', 'memory_fact_list', 'memory_fact_delete',
            'memory_episode_save', 'memory_episode_list', 'memory_episode_delete',
            'memory_hybrid_search', 'memory_context', 'memory_extract', 'memory_stats', 'memory_cleanup',
            'memory_v1_migrate',
            'personality_presets', 'personality_set_preset', 'personality_load', 'personality_save',
            'personality_validate', 'personality_narrative', 'personality_cache', 'personality_state',
            'workflow_create', 'workflow_run', 'workflow_list', 'workflow_status', 'workflow_delete', 'workflow_roles',
            'push', 'exec', 'python', 'sys_info', 'push_file', 'minimax_search',
            'file_read', 'file_write', 'file_search', 'file_grep', 'file_edit', 'file_op',
            'browser_navigate', 'browser_screenshot', 'browser_click', 'browser_type', 'browser_get_content', 'browser_get_snapshot', 'browser_js',
            'ps', 'disk', 'docker', 'db_query', 'network'
        ]]);
        break;

    case 'ps':
        echo _engine_get($engine_url . '/engine/ps?' . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'disk':
        echo _engine_get($engine_url . '/engine/disk?' . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'docker':
        // Deployment settings are forwarded as JSON POST; read-only legacy GET remains supported.
        $body = file_get_contents('php://input');
        $payload = $body ? json_decode($body, true) : [];
        if (!is_array($payload)) $payload = [];
        $docker_action = $payload['action'] ?? ($_GET['docker_action'] ?? $_GET['cmd'] ?? $_GET['command'] ?? 'ps');
        $payload['action'] = $docker_action;
        $payload['user_id'] = $userId;
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            echo _engine_post_json($engine_url . '/engine/docker', $payload, json_encode(['ok' => false, 'error' => 'engine unreachable']));
        } else {
            echo _engine_get($engine_url . '/engine/docker?action=' . urlencode($docker_action) . $userParam) ?: json_encode(['error' => 'unreachable']);
        }
        break;
    case 'db_query':
        $sql = $_GET['sql'] ?? '';
        if (!$sql) { echo json_encode(['error' => '缺少sql']); exit; }
        echo _engine_get($engine_url . '/engine/db_query?sql=' . urlencode($sql) . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'network':
        $target = $_GET['target'] ?? $_GET['host'] ?? $_GET['address'] ?? $_GET['url'] ?? '';
        $action_n = $_GET['net_action'] ?? $_GET['cmd'] ?? $_GET['command'] ?? 'ping';
        $timeout_n = intval($_GET['timeout'] ?? 10);
        if (!$target) { echo json_encode(['error' => '缺少target']); exit; }
        echo _engine_get($engine_url . '/engine/network?target=' . urlencode($target) . '&action=' . urlencode($action_n) . '&timeout=' . $timeout_n . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'file_search':
        $pattern = $_GET['pattern'] ?? '';
        $path_fs = $_GET['path'] ?? (defined('PROJECT_ROOT') ? PROJECT_ROOT : '/var/www');
        $cwd = $_GET['cwd'] ?? '';
        $full_access_requested = (($_GET['full_access'] ?? '') === 'true' || ($_GET['full_access'] ?? '') === '1');
        if ($full_access_requested) _require_permission_grant($userId, 'filesystem.search');
        $full_access = $full_access_requested ? '&full_access=true' : '';
        if (!$pattern) { echo json_encode(['error' => '缺少pattern']); exit; }
        echo _engine_get($engine_url . '/engine/file_search?pattern=' . urlencode($pattern) . '&path=' . urlencode($path_fs) . ($cwd !== '' ? '&cwd=' . urlencode($cwd) : '') . '&max_results=' . intval($_GET['max_results'] ?? 30) . $full_access . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'file_grep':
        $pattern = $_GET['pattern'] ?? '';
        $path_fs = $_GET['path'] ?? (defined('PROJECT_ROOT') ? PROJECT_ROOT : '/var/www');
        $cwd = $_GET['cwd'] ?? '';
        $context_lines = intval($_GET['context_lines'] ?? 2);
        $file_pattern = $_GET['file_pattern'] ?? '';
        $max_results = intval($_GET['max_results'] ?? 20);
        $ignore_case = ($_GET['ignore_case'] ?? 'true') === 'true';
        $full_access_requested = (($_GET['full_access'] ?? '') === 'true' || ($_GET['full_access'] ?? '') === '1');
        if ($full_access_requested) _require_permission_grant($userId, 'filesystem.search');
        $full_access = $full_access_requested ? '&full_access=true' : '';
        if (!$pattern) { echo json_encode(['error' => '缺少pattern']); exit; }
        $url = $engine_url . '/engine/file_grep?pattern=' . urlencode($pattern) . '&path=' . urlencode($path_fs) . ($cwd !== '' ? '&cwd=' . urlencode($cwd) : '') . '&context_lines=' . $context_lines . '&max_results=' . $max_results . '&ignore_case=' . ($ignore_case ? '1' : '0') . $full_access;
        if ($file_pattern) $url .= '&file_pattern=' . urlencode($file_pattern);
        echo _engine_get($url . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'file_edit':
        $path = $_GET['path'] ?? '';
        $cwd = $_GET['cwd'] ?? '';
        $replace_all = ($_GET['replace_all'] ?? 'false') === 'true';
        // ★ old_string/new_string 从 POST body 读取，不在 URL 参数中
        $postBody = json_decode(file_get_contents('php://input'), true) ?: [];
        $old_string = $postBody['old_string'] ?? '';
        $new_string = $postBody['new_string'] ?? '';
        if (!$cwd && !empty($postBody['cwd'])) $cwd = $postBody['cwd'];
        if (!$path || !$old_string) { echo json_encode(['error' => '缺少参数(path/old_string/new_string)']); exit; }
        $full_access_requested = (($_GET['full_access'] ?? '') === 'true' || ($_GET['full_access'] ?? '') === '1');
        if ($full_access_requested) _require_permission_grant($userId, 'filesystem.write');
        $full_access = $full_access_requested ? '&full_access=true' : '';
        $url = $engine_url . '/engine/file_edit?path=' . urlencode($path) . ($cwd !== '' ? '&cwd=' . urlencode($cwd) : '') . '&replace_all=' . ($replace_all ? '1' : '0') . $full_access . $userParam;
        $body = json_encode(['old_string' => $old_string, 'new_string' => $new_string, 'cwd' => $cwd, 'full_access' => $full_access !== '']);
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_HTTPHEADER, _engine_headers(['Content-Type: application/json']));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        echo curl_exec($ch) ?: json_encode(['ok' => false, 'error' => 'engine unreachable: ' . curl_error($ch)]);
        curl_close($ch);
        break;
    case 'file_op':
        $action_f = $_GET['file_action'] ?? $_GET['file_op_action'] ?? $_GET['cmd'] ?? $_GET['command'] ?? $_GET['action'] ?? '';
        $src = $_GET['src'] ?? $_GET['source'] ?? $_GET['path'] ?? '';
        $dst = $_GET['dst'] ?? $_GET['dest'] ?? $_GET['destination'] ?? '';
        if (!$action_f || !$src) { echo json_encode(['error' => '缺少参数']); exit; }
        $full_access_requested = (($_GET['full_access'] ?? '') === 'true' || ($_GET['full_access'] ?? '') === '1');
        if ($full_access_requested) _require_permission_grant($userId, 'filesystem.move');
        $full_access = $full_access_requested ? '&full_access=true' : '';
        echo _engine_get($engine_url . '/engine/file_op?action=' . urlencode($action_f) . '&src=' . urlencode($src) . '&dst=' . urlencode($dst) . $full_access . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;

    // ==================== Agent 记忆/人格/身份/心跳 系统 ====================
    case 'agent_persona_load':
        echo _engine_get($engine_url . '/engine/agent/persona/load?' . $userParam) ?: json_encode(['ok' => false]);
        break;

    case 'agent_persona_save':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/agent/persona/save?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'agent_memory_load':
        $query = isset($_GET['query']) ? '&query=' . urlencode($_GET['query']) : '';
        echo _engine_get($engine_url . '/engine/agent/memory/load?' . $userParam . $query) ?: json_encode(['ok' => false]);
        break;

    case 'agent_memory_save':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/agent/memory/save?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'agent_memory_delete':
        $key = $_GET['key'] ?? '';
        if (!$key) { echo json_encode(['error' => '缺少key']); exit; }
        echo _engine_get($engine_url . '/engine/agent/memory/delete?key=' . urlencode($key) . $userParam) ?: json_encode(['ok' => false]);
        break;

    case 'agent_identity_load':
        echo _engine_get($engine_url . '/engine/agent/identity/load?' . $userParam) ?: json_encode(['ok' => false]);
        break;

    case 'agent_identity_save':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/agent/identity/save?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'agent_heartbeat':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/agent/heartbeat?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'agent_heartbeat_status':
        echo _engine_get($engine_url . '/engine/agent/heartbeat/status?' . $userParam) ?: json_encode(['ok' => false]);
        break;

    // ==================== ★ 记忆系统 v2 ====================
    case 'memory_fact_save':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/memory/fact/save?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'memory_fact_list':
        $limit = $_GET['limit'] ?? 50;
        $offset = $_GET['offset'] ?? 0;
        echo _engine_get($engine_url . '/engine/memory/fact/list?' . $userParam . '&limit=' . $limit . '&offset=' . $offset) ?: json_encode([]);
        break;

    case 'memory_fact_delete':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/memory/fact/delete?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'memory_episode_save':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/memory/episode/save?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'memory_episode_list':
        $limit = $_GET['limit'] ?? 20;
        echo _engine_get($engine_url . '/engine/memory/episode/list?' . $userParam . '&limit=' . $limit) ?: json_encode([]);
        break;

    case 'memory_episode_delete':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/memory/episode/delete?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'memory_hybrid_search':
        $q = urlencode($_GET['q'] ?? '');
        $limit = $_GET['limit'] ?? 10;
        $layers = urlencode($_GET['layers'] ?? '');
        echo _engine_get($engine_url . '/engine/memory/hybrid_search?' . $userParam . '&q=' . $q . '&limit=' . $limit . '&layers=' . $layers) ?: json_encode([]);
        break;

    case 'memory_context':
        $q = urlencode($_GET['q'] ?? '');
        echo _engine_get($engine_url . '/engine/memory/context?' . $userParam . '&q=' . $q) ?: json_encode(['context' => '']);
        break;

    case 'memory_extract':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/memory/extract?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'memory_stats':
        echo _engine_get($engine_url . '/engine/memory/stats?' . $userParam) ?: json_encode(['stats' => []]);
        break;

    case 'memory_cleanup':
        $opts = ['http' => ['method' => 'POST']];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/memory/cleanup?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'memory_v1_migrate':
        $opts = ['http' => ['method' => 'POST']];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/memory/v1/migrate?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'personality_presets':
        echo _engine_get($engine_url . '/engine/personality/presets') ?: json_encode(['presets' => []]);
        break;

    case 'personality_set_preset':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/personality/set_preset?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'personality_load':
        echo _engine_get($engine_url . '/engine/personality/load?' . $userParam) ?: json_encode(['personality' => []]);
        break;

    case 'personality_save':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/personality/save?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'personality_validate':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/personality/validate?' . $userParam, false, $ctx) ?: json_encode(['ok' => true]);
        break;

    case 'personality_narrative':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/personality/narrative?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'personality_cache':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/personality/cache?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'personality_state':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/personality/state?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    // ==================== 浏览器工具 ====================
    case 'browser_navigate':
        $rawBody = file_get_contents('php://input');
        $body = $rawBody ? json_decode($rawBody, true) : [];
        $browserUrl = $body['url'] ?? $_GET['url'] ?? '';
        if (!$browserUrl) { echo json_encode(['ok' => false, 'error' => '缺少url']); exit; }
        $postData = json_encode(['url' => $browserUrl]);
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $postData]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/browser/navigate' . $engineUserQuery, false, $ctx) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'browser_screenshot':
        echo _engine_get($engine_url . '/engine/browser/screenshot' . $engineUserQuery) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'browser_click':
        $rawBody = file_get_contents('php://input');
        $body = $rawBody ? json_decode($rawBody, true) : [];
        $browserSel = $body['selector'] ?? $_GET['selector'] ?? '';
        if (!$browserSel) { echo json_encode(['ok' => false, 'error' => '缺少selector']); exit; }
        $postData = json_encode(['selector' => $browserSel]);
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $postData]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/browser/click' . $engineUserQuery, false, $ctx) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'browser_type':
        $rawBody = file_get_contents('php://input');
        $body = $rawBody ? json_decode($rawBody, true) : [];
        $browserSel = $body['selector'] ?? $_GET['selector'] ?? '';
        $browserText = $body['text'] ?? $_GET['text'] ?? '';
        if (!$browserSel || !$browserText) { echo json_encode(['ok' => false, 'error' => '缺少selector或text']); exit; }
        $postData = json_encode(['selector' => $browserSel, 'text' => $browserText]);
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $postData]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/browser/type' . $engineUserQuery, false, $ctx) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'browser_get_content':
        echo _engine_get($engine_url . '/engine/browser/content' . $engineUserQuery) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'browser_get_snapshot':
        echo _engine_get($engine_url . '/engine/browser/snapshot' . $engineUserQuery) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'browser_js':
        $browserCode = file_get_contents('php://input');
        $input = json_decode($browserCode ?: '{}', true);
        $code = $input['code'] ?? ($_GET['code'] ?? '');
        if (!$code) { echo json_encode(['ok' => false, 'error' => '缺少code']); exit; }
        $postData = json_encode(['code' => $code]);
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $postData]];
        $ctx = stream_context_create($opts);
        echo _engine_get($engine_url . '/engine/browser/js' . $engineUserQuery, false, $ctx) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    // ★ engine_push 文件复制到 uploads
    case 'minimax_search':
        $msInput = $_SERVER['REQUEST_METHOD'] === 'POST'
            ? (json_decode((string) file_get_contents('php://input'), true) ?: []) : [];
        $query = (string) ($msInput['q'] ?? $_GET['q'] ?? '');
        $limit = intval($msInput['limit'] ?? $_GET['limit'] ?? 5);
        if ($limit < 1) $limit = 1;
        if ($limit > 20) $limit = 20;
        if (!$query) { echo json_encode(['error' => '缺少查询词 q']); exit; }
        $escapedQuery = escapeshellarg($query);
        $mmxBin = '/home/naujtrats/.npm-global/bin/mmx';
        // Key 优先级: 请求参数(前端传) > 服务器配置
        $mmxKey = (string) ($msInput['api_key'] ?? $_GET['api_key'] ?? '');
        $mmxRegion = (string) ($msInput['region'] ?? $_GET['region'] ?? 'cn');
        if (!$mmxKey) {
            $cfg = _engine_mmx_config_read();
            if ($cfg && !empty($cfg['api_key'])) { $mmxKey = $cfg['api_key']; $mmxRegion = $cfg['region'] ?? 'cn'; }
        }
        if (!$mmxKey || !preg_match('/^[a-zA-Z0-9_-]+$/', $mmxKey)) { echo json_encode(['error' => 'MiniMax API Key 未配置']); exit; }
        $escapedKey = escapeshellarg($mmxKey);
        $escapedRegion = escapeshellarg($mmxRegion);
        // ★ 进程隔离: 避免并发搜索竞争 ~/.mmx/config.json
        $isolatedHome2 = sys_get_temp_dir() . '/mmx_' . getmypid() . '_' . bin2hex(random_bytes(8));
        $prefixCmd2 = @mkdir($isolatedHome2, 0700, true) ? 'HOME=' . escapeshellarg($isolatedHome2) . ' ' : '';
        $cmd = "{$prefixCmd2}{$mmxBin} search query {$escapedQuery} --limit {$limit} --api-key {$escapedKey} --region {$escapedRegion} 2>&1";
        $output = shell_exec($cmd);
        if ($isolatedHome2 && is_dir($isolatedHome2)) _rmdir($isolatedHome2);
        if ($output === null || trim($output) === '') {
            echo json_encode(['error' => '搜索服务未响应']);
        } else {
            $parsed = json_decode($output, true);
            if ($parsed && isset($parsed['organic']) && is_array($parsed['organic'])) {
                echo json_encode(['results' => $parsed['organic'], 'status' => 'ok']);
            } elseif ($parsed && isset($parsed['base_resp']['status_msg'])) {
                echo json_encode(['error' => $parsed['base_resp']['status_msg']]);
            } else {
                // 原始输出是 JSON 但格式不同,直接返回
                echo $output;
            }
        }
        break;

    case 'search_proxy':
        // ★ 通用搜索引擎代理 — 经由项目代理转发外部搜索 API，消除 CORS 与 GFW 封锁
        $spInput = $_SERVER['REQUEST_METHOD'] === 'POST'
            ? (json_decode((string) file_get_contents('php://input'), true) ?: []) : [];
        $spProvider = strtolower(trim((string)($spInput['provider'] ?? '')));
        $spUrl = (string) ($spInput['url'] ?? $_GET['url'] ?? '');
        $spMethod = strtoupper((string) ($spInput['method'] ?? $_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $spHeaders = [];
        if ($spProvider === 'duckduckgo') {
            http_response_code(410);
            echo json_encode(['error' => 'DuckDuckGo 搜索已移除，请改用 Brave、Tavily、DeepSeek 或 MiniMax。'], JSON_UNESCAPED_UNICODE); exit;
        } elseif ($spProvider === 'deepseek') {
            $dsQuery = trim((string)($spInput['query'] ?? ''));
            $dsKey = trim((string)($spInput['api_key'] ?? ''));
            $dsModel = trim((string)($spInput['model'] ?? 'deepseek-v4-flash')) ?: 'deepseek-v4-flash';
            if ($dsQuery === '' || $dsKey === '') {
                http_response_code(400);
                echo json_encode(['error' => 'DeepSeek 联网搜索缺少 query 或 API Key'], JSON_UNESCAPED_UNICODE); exit;
            }
            $spUrl = 'https://api.deepseek.com/responses';
            $spMethod = 'POST';
            $spHeaders = ['Authorization: Bearer ' . $dsKey, 'Content-Type: application/json', 'Accept: application/json'];
            $spBody = json_encode([
                'model' => $dsModel,
                'input' => $dsQuery,
                'tools' => [['type' => 'web_search']],
            ], JSON_UNESCAPED_UNICODE);
        } elseif ($spProvider === 'brave') {
            $spQuery = trim((string)($spInput['query'] ?? ''));
            $spType = strtolower((string)($spInput['type'] ?? 'web'));
            $spLimit = min(max((int)($spInput['limit'] ?? 5), 1), 20);
            $spCountry = strtolower(trim((string)($spInput['country'] ?? '')));
            $spApiKey = trim((string)($spInput['api_key'] ?? ''));
            if ($spQuery === '' || $spApiKey === '') {
                http_response_code(400);
                echo json_encode(['error' => 'Brave 搜索缺少 query 或 API Key'], JSON_UNESCAPED_UNICODE); exit;
            }
            $spEndpoint = $spType === 'news' ? 'news/search' : ($spType === 'images' ? 'images/search' : 'web/search');
            $spParams = [
                'q' => $spQuery,
                'count' => $spLimit,
                'safesearch' => 'off',
                'text_decorations' => '0',
            ];
            if (preg_match('/^[a-z]{2}$/', $spCountry)) $spParams['country'] = $spCountry;
            $spUrl = 'https://api.search.brave.com/res/v1/' . $spEndpoint . '?' . http_build_query($spParams);
            $spMethod = 'GET';
            $spHeaders = [
                'Accept: application/json',
                'Accept-Encoding: gzip',
                'X-Subscription-Token: ' . $spApiKey,
            ];
        }
        if (!$spUrl || !preg_match('#^https?://#', $spUrl)) { echo json_encode(['error' => '缺少合法 url 参数']); exit; }
        if (!empty($spInput['headers']) && is_array($spInput['headers'])) {
            foreach ($spInput['headers'] as $hk => $hv) {
                $spHeaders[] = is_numeric($hk) ? (string)$hv : ($hk . ': ' . $hv);
            }
        }
        $spHeaderKey = (string) ($spInput['header_key'] ?? $_GET['header_key'] ?? '');
        $spHeaderVal = (string) ($spInput['header_val'] ?? $_GET['header_val'] ?? '');
        if ($spHeaderKey && $spHeaderVal) {
            $spHeaders[] = $spHeaderKey . ': ' . $spHeaderVal;
        }
        if (!preg_grep('#^Accept:#i', $spHeaders)) {
            $spHeaders[] = 'Accept: application/json';
        }
        if (!isset($spBody)) {
            $spBody = isset($spInput['body']) ? (is_array($spInput['body']) ? json_encode($spInput['body'], JSON_UNESCAPED_UNICODE) : (string)$spInput['body']) : null;
        }
        
        $spProxies = ['http://127.0.0.1:1080', 'http://192.168.195.226:8890', ''];
        $spResp = false;
        $spHttpCode = 0;
        $spErr = '';
        foreach ($spProxies as $spProxy) {
            $ch = curl_init($spUrl);
            $curlOpts = [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS => 4,
                CURLOPT_TIMEOUT => 15,
                CURLOPT_CONNECTTIMEOUT => 6,
                CURLOPT_ENCODING => '', // 自动支持 gzip/deflate
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => false,
                CURLOPT_HTTPHEADER => $spHeaders,
            ];
            if ($spMethod === 'POST') {
                $curlOpts[CURLOPT_POST] = true;
                if ($spBody !== null) $curlOpts[CURLOPT_POSTFIELDS] = $spBody;
            }
            if ($spProxy) {
                $curlOpts[CURLOPT_PROXY] = $spProxy;
            }
            curl_setopt_array($ch, $curlOpts);
            $spResp = curl_exec($ch);
            $spHttpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $spErr = curl_error($ch);
            curl_close($ch);
            // 2xx/3xx 成功；4xx 是确定的业务错误，不应再切换代理重复请求。
            if ($spResp !== false && $spHttpCode >= 200 && $spHttpCode < 500) {
                break;
            }
        }
        if ($spResp === false || ($spHttpCode >= 500 && !$spResp)) {
            echo json_encode(['error' => '搜索请求失败: ' . ($spErr ?: "HTTP $spHttpCode")]); exit;
        }
        if ($spHttpCode >= 400) {
            http_response_code($spHttpCode);
            $upstreamError = json_decode((string)$spResp, true);
            if (is_array($upstreamError)) {
                $upstreamError['provider'] = $spProvider ?: 'proxy';
                $upstreamError['http_status'] = $spHttpCode;
                echo json_encode($upstreamError, JSON_UNESCAPED_UNICODE);
                break;
            }
        }
        if ($spProvider === 'deepseek') {
            $dsResponse = json_decode((string)$spResp, true);
            $dsResults = [];
            foreach ((array)($dsResponse['output'] ?? []) as $output) {
                foreach ((array)($output['content'] ?? []) as $content) {
                    $text = (string)($content['text'] ?? $content['value'] ?? '');
                    $annotations = (array)($content['annotations'] ?? []);
                    foreach ($annotations as $annotation) {
                        $url = (string)($annotation['url'] ?? $annotation['url_citation']['url'] ?? '');
                        $title = (string)($annotation['title'] ?? $annotation['url_citation']['title'] ?? 'DeepSeek 联网搜索结果');
                        if ($url) $dsResults[] = ['title' => $title, 'url' => $url, 'snippet' => $text];
                    }
                    if (!$annotations && $text !== '') $dsResults[] = ['title' => 'DeepSeek 联网搜索摘要', 'url' => '', 'snippet' => $text];
                }
            }
            if (!$dsResults && !empty($dsResponse['output_text'])) {
                $dsResults[] = ['title' => 'DeepSeek 联网搜索摘要', 'url' => '', 'snippet' => (string)$dsResponse['output_text']];
            }
            echo json_encode(['results' => $dsResults, 'provider' => 'deepseek', 'response_id' => $dsResponse['id'] ?? null], JSON_UNESCAPED_UNICODE);
            break;
        }
        echo $spResp;
        break;

    case 'tavily_search':
        $tsInput = $_SERVER['REQUEST_METHOD'] === 'POST'
            ? (json_decode((string) file_get_contents('php://input'), true) ?: []) : [];
        $tsQuery = (string) ($tsInput['q'] ?? $_GET['q'] ?? '');
        $tsKey = (string) ($tsInput['api_key'] ?? $_GET['api_key'] ?? '');
        $tsLimit = intval($tsInput['limit'] ?? $_GET['limit'] ?? 5);
        if (!$tsQuery) { echo json_encode(['error' => '缺少 q 参数']); exit; }
        if (!$tsKey) { echo json_encode(['error' => '缺少 Tavily API Key']); exit; }
        $tsBody = json_encode(['api_key' => $tsKey, 'query' => $tsQuery, 'search_depth' => 'basic', 'max_results' => min($tsLimit, 10)]);
        $tsProxies = ['http://127.0.0.1:1080', 'http://192.168.195.226:8890', ''];
        $tsResp = false;
        foreach ($tsProxies as $tsProxy) {
            $ch = curl_init('https://api.tavily.com/search');
            $curlOpts = [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $tsBody,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 15,
                CURLOPT_CONNECTTIMEOUT => 6,
                CURLOPT_ENCODING => '',
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => false,
            ];
            if ($tsProxy) $curlOpts[CURLOPT_PROXY] = $tsProxy;
            curl_setopt_array($ch, $curlOpts);
            $tsResp = curl_exec($ch);
            $tsCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($tsResp !== false && $tsCode >= 200 && $tsCode < 500) break;
        }
        if ($tsResp === false) { echo json_encode(['error' => 'Tavily API 请求失败']); exit; }
        echo $tsResp;
        break;

    case 'mcp_proxy':
        // ★ 通用 MCP 工具代理 — 所有 MCP 工具统一入口
        // 浏览器无法直连 127.0.0.1:18788, PHP 内部转发
        $mp_input = json_decode(file_get_contents('php://input'), true);
        $mp_name = $mp_input['name'] ?? '';
        $mp_args = $mp_input['arguments'] ?? (object)[];
        if (!$mp_name) { echo json_encode(['error' => '缺少 tool name']); exit; }
        if (!is_array($mp_args)) $mp_args = [];
        // 身份只由已验证的主站会话注入，忽略浏览器伪造的 user_id/auth_token。
        $mp_args['user_id'] = $userId;
        $mp_args['_auth_token'] = $authToken;
        // 按前缀路由到 MCP 子端点
        $mp_endpoint = str_starts_with($mp_name, 'bilibili_') ? '/mcp/bilibili/tools/call' : '/mcp/api/tools/call';
        // ★ poll 类工具需要更长超时(长轮询等待扫码), 其他工具用默认超时
        $mp_action = (string)($mp_args['action'] ?? '');
        $mp_is_poll = str_contains($mp_name, 'poll') || in_array($mp_action, ['poll', 'login'], true);
        $mp_timeout = $mp_is_poll ? 330 : 120;
        $mp_ctx = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => json_encode(['name' => $mp_name, 'arguments' => $mp_args], JSON_UNESCAPED_UNICODE),
            'timeout' => $mp_timeout,
            'ignore_errors' => true,
        ]]);
        $mp_resp = file_get_contents('http://127.0.0.1:18788' . $mp_endpoint, false, $mp_ctx);
        if ($mp_resp === false) { echo json_encode(['error' => 'MCP 服务不可达']); exit; }
        header('Content-Type: application/json; charset=utf-8');
        echo $mp_resp;
        break;

    case 'push_file':
        $srcPath = $_GET['path'] ?? '';
        $requestedFilename = trim((string)($_GET['filename'] ?? ''));
        if (!$srcPath) { echo json_encode(['ok'=>false,'error'=>'缺少path']); exit; }
        // ★ 路径转换
        if (str_starts_with($srcPath, '/oneapichat/uploads/')) {
            $srcPath = dirname(__DIR__) . '/uploads/' . substr($srcPath, strlen('/oneapichat/uploads/'));
        } elseif (str_starts_with($srcPath, '/oneapichat/')) {
            $srcPath = dirname(__DIR__) . '/' . substr($srcPath, strlen('/oneapichat/'));
        }
        // ★ /tmp/ 等绝对路径直接复制
        if (!file_exists($srcPath)) { echo json_encode(['ok'=>false,'error'=>'源文件不存在: '.$srcPath]); exit; }
        if (!is_readable($srcPath)) { echo json_encode(['ok'=>false,'error'=>'无法读取源文件']); exit; }
        $ext = strtolower(pathinfo($srcPath, PATHINFO_EXTENSION));
        // 保留用户要求的下载文件名；只清理路径分隔符与控制字符。
        $displayName = $requestedFilename !== '' ? basename(str_replace('\\', '/', $requestedFilename)) : basename($srcPath);
        $displayName = preg_replace('/[\x00-\x1F\x7F\/\\\\]+/u', '_', $displayName);
        if ($displayName === '' || $displayName === '.' || $displayName === '..') $displayName = 'download' . ($ext ? '.' . $ext : '');
        if ($ext && strtolower(pathinfo($displayName, PATHINFO_EXTENSION)) !== $ext) $displayName .= '.' . $ext;
        $fn = $displayName;
        $destDir = dirname(__DIR__) . '/uploads/shared/';
        if (!is_dir($destDir)) mkdir($destDir, 0755, true);
        $destPath = $destDir . $fn;
        // 同名但内容不同才追加短哈希；同一产物重复推送保持稳定 URL。
        if (file_exists($destPath) && hash_file('sha256', $destPath) !== hash_file('sha256', $srcPath)) {
            $stem = pathinfo($displayName, PATHINFO_FILENAME);
            $suffix = pathinfo($displayName, PATHINFO_EXTENSION);
            $fn = $stem . '_' . substr(hash_file('sha256', $srcPath), 0, 8) . ($suffix ? '.' . $suffix : '');
            $destPath = $destDir . $fn;
        }
        if (copy($srcPath, $destPath) || rename($srcPath, $destPath)) {
            $url = '/oneapichat/uploads/shared/' . rawurlencode($fn);
            $fullUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http') . '://' . 'naujtrats.xyz' . $url;
            echo json_encode(['ok'=>true,'url'=>$fullUrl,'path'=>$url,'filename'=>$fn,'display_name'=>$displayName,'size'=>filesize($destPath)], JSON_UNESCAPED_UNICODE);
        } else {
            echo json_encode(['ok'=>false,'error'=>'复制失败']);
        }
        break;

    case 'platform_extract':
        $platUrl = $_GET['url'] ?? '';
        if (!$platUrl) { echo json_encode(['ok'=>false,'error'=>'缺少url参数']); exit; }
        $engineUrl = 'http://127.0.0.1:8766/engine/platform_extract?url=' . urlencode($platUrl);
        $resp = _engine_get($engineUrl, '');
        if ($resp !== false) {
            echo $resp;
        } else {
            echo json_encode(['ok'=>false,'error'=>'引擎无响应']);
        }
        break;

    case 'skills_run':
        $input = json_decode(file_get_contents('php://input'), true);
        $engineUrl = 'http://127.0.0.1:8766/engine/skills/run';
        $ch = curl_init($engineUrl);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($input),
            CURLOPT_HTTPHEADER => _engine_headers(['Content-Type: application/json']),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
        ]);
        $resp = curl_exec($ch);
        curl_close($ch);
        echo $resp;
        break;

    case 'video_hunter':
        // ★ 视频猎手工具代理 → MCP Server (__video/ bridge)
        $vh_action = $_GET['sub_action'] ?? '';
        if (!$vh_action) { echo json_encode(['error' => '缺少 sub_action']); exit; }
        // 构造 MCP 工具名
        $vh_tool = 'video_' . $vh_action;
        $vh_args = [];
        foreach ($_GET as $k => $v) {
            if ($k !== 'action' && $k !== 'sub_action' && $k !== 'auth_token') {
                $vh_args[$k] = $v;
            }
        }
        // 也检查 POST body
        $vh_raw = file_get_contents('php://input');
        if ($vh_raw) {
            $vh_post = json_decode($vh_raw, true);
            if ($vh_post) $vh_args = array_merge($vh_args, $vh_post);
        }
        // ★ 2026-08-03 云盘全面结合: 透传用户上下文, 下载完成自动同步到该用户云盘
        if ($userId) $vh_args['user_id'] = $userId;
        $vh_ctx = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => json_encode(['name' => $vh_tool, 'arguments' => $vh_args], JSON_UNESCAPED_UNICODE),
            'timeout' => 120,
            'ignore_errors' => true,
        ]]);
        $vh_resp = file_get_contents('http://127.0.0.1:18788/mcp/api/tools/call', false, $vh_ctx);
        if ($vh_resp === false) { echo json_encode(['error' => 'MCP 服务不可达 (video_hunter)']); exit; }
        header('Content-Type: application/json; charset=utf-8');
        echo $vh_resp;
        break;

    case 'bilibili_bridge':
        // ★ B站下载工具代理 → MCP Server (__bili/ bridge)
        $bili_action = $_GET['sub_action'] ?? '';
        if (!$bili_action) { echo json_encode(['error' => '缺少 sub_action']); exit; }
        $bili_tool = 'bili_' . $bili_action;
        $bili_args = [];
        foreach ($_GET as $k => $v) {
            if ($k !== 'action' && $k !== 'sub_action' && $k !== 'auth_token') {
                $bili_args[$k] = $v;
            }
        }
        $bili_raw = file_get_contents('php://input');
        if ($bili_raw) {
            $bili_post = json_decode($bili_raw, true);
            if ($bili_post) $bili_args = array_merge($bili_args, $bili_post);
        }
        // ★ 2026-08-03 云盘全面结合: 透传用户上下文, 下载完成自动同步到该用户云盘
        if ($userId) $bili_args['user_id'] = $userId;
        $bili_ctx = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => json_encode(['name' => $bili_tool, 'arguments' => $bili_args], JSON_UNESCAPED_UNICODE),
            'timeout' => 120,
            'ignore_errors' => true,
        ]]);
        $bili_resp = file_get_contents('http://127.0.0.1:18788/mcp/api/tools/call', false, $bili_ctx);
        if ($bili_resp === false) { echo json_encode(['error' => 'MCP 服务不可达 (bilibili_bridge)']); exit; }
        header('Content-Type: application/json; charset=utf-8');
        echo $bili_resp;
        break;
}
