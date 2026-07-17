<?php
/**
 * OneAPIChat API Key 管理
 * GET  ?action=list   — 列出所有 API Key
 * POST ?action=create — 创建新 API Key (body: {name: "..."})
 * POST ?action=revoke — 撤销 API Key (body: {key_id: "..."})
 *
 * 认证：使用 session token（浏览器登录态）
 */

require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';
setCorsHeaders();
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── 认证 ──
$token = extractBearerToken();
if (empty($token) && isset($_GET['auth_token'])) {
    $token = preg_replace('/[^a-f0-9]/', '', $_GET['auth_token']);
}
$userId = verifyAuthToken($token);
if (!$userId) {
    http_response_code(401);
    echo json_encode(['error' => '未登录，请先登录', 'code' => 'UNAUTHORIZED']);
    exit;
}

$usersFile = ONECHAT_ROOT . '/users/users.json';
$users = json_decode(file_get_contents($usersFile), true) ?: [];

if (!isset($users[$userId])) {
    http_response_code(404);
    echo json_encode(['error' => '用户不存在']);
    exit;
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// ── 列出所有 API Keys ──
if ($method === 'GET' && $action === 'list') {
    $keys = [];
    foreach (($users[$userId]['api_keys'] ?? []) as $ak) {
        if (!is_array($ak)) continue;
        $keys[] = [
            'id' => $ak['id'] ?? '',
            'name' => $ak['name'] ?? '',
            'key_prefix' => $ak['key_prefix'] ?? '',
            'created_at' => $ak['created_at'] ?? '',
            'last_used_at' => $ak['last_used_at'] ?? null,
        ];
    }
    echo json_encode(['success' => true, 'keys' => $keys], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── 创建新 API Key ──
if ($method === 'POST' && $action === 'create') {
    $input = json_decode(file_get_contents('php://input'), true);
    $name = trim($input['name'] ?? '');
    if (empty($name)) {
        $name = 'API Key ' . date('Y-m-d H:i');
    }
    if (mb_strlen($name) > 64) {
        http_response_code(400);
        echo json_encode(['error' => '名称不能超过 64 个字符']);
        exit;
    }

    $newKey = generateApiKey();
    $keyId = 'key_' . bin2hex(random_bytes(8)); // 16 字符 ID

    if (!isset($users[$userId]['api_keys'])) {
        $users[$userId]['api_keys'] = [];
    }

    // 限制每用户最多 20 个 API Key
    if (count($users[$userId]['api_keys']) >= 20) {
        http_response_code(400);
        echo json_encode(['error' => '最多创建 20 个 API Key，请先撤销不再使用的 Key']);
        exit;
    }

    $users[$userId]['api_keys'][] = [
        'id' => $keyId,
        'name' => $name,
        'key_hash' => $newKey['hash'],
        'key_prefix' => $newKey['prefix'],
        'created_at' => date('c'),
        'last_used_at' => null,
    ];

    @file_put_contents($usersFile, json_encode($users, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

    echo json_encode([
        'success' => true,
        'key' => [
            'id' => $keyId,
            'name' => $name,
            'key_prefix' => $newKey['prefix'],
            'full_key' => $newKey['raw'],
            'created_at' => date('c'),
        ]
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── 撤销 API Key ──
if ($method === 'POST' && $action === 'revoke') {
    $input = json_decode(file_get_contents('php://input'), true);
    $keyId = trim($input['key_id'] ?? '');

    if (empty($keyId)) {
        http_response_code(400);
        echo json_encode(['error' => '缺少 key_id']);
        exit;
    }

    $found = false;
    $newKeys = [];
    foreach (($users[$userId]['api_keys'] ?? []) as $ak) {
        if (is_array($ak) && ($ak['id'] ?? '') === $keyId) {
            $found = true;
            continue; // 跳过此项 = 删除
        }
        if (is_array($ak)) {
            $newKeys[] = $ak;
        }
    }

    if (!$found) {
        http_response_code(404);
        echo json_encode(['error' => 'API Key 不存在']);
        exit;
    }

    $users[$userId]['api_keys'] = $newKeys;
    @file_put_contents($usersFile, json_encode($users, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

    echo json_encode(['success' => true, 'message' => 'API Key 已撤销']);
    exit;
}

// ── 未知操作 ──
http_response_code(400);
echo json_encode(['error' => '未知操作，支持: list / create / revoke']);
