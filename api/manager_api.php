<?php
/**
 * OneAPIChat 管理 API
 * root 用户专属管理接口
 */

// ---- 动态 CORS ----
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = [
    'https://xiaoxin.naujtrats.xyz',
    'https://naujtrats.xyz',
    'https://www.naujtrats.xyz',
    'https://aliyun.naujtrats.xyz',
];
if (!in_array($origin, $allowedOrigins, true) && $origin) {
    $originHost = parse_url($origin, PHP_URL_HOST);
    $serverHost = $_SERVER['HTTP_HOST'] ?? '';
    if ($originHost && $originHost === $serverHost) {
        $allowedOrigins[] = $origin;
    }
}
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
} else {
    header('Access-Control-Allow-Origin: *');
}
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/auth_helpers.php';

$usersDir = dirname(__DIR__) . '/users/';
$usersFile = $usersDir . 'users.json';
$sessionsFile = $usersDir . 'sessions.json';

function readJson($path) {
    if (!file_exists($path)) return [];
    $raw = file_get_contents($path);
    if ($raw === false || trim($raw) === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        $backup = $path . '.corrupted.' . date('Ymd_His');
        @rename($path, $backup);
        error_log('[manager_api] Corrupted JSON: ' . $backup);
        return [];
    }
    return $data;
}

function writeJson($path, $data) {
    $tmpPath = $path . '.' . getmypid() . '.tmp';
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false) return false;
    if (@file_put_contents($tmpPath, $json, LOCK_EX) === false) return false;
    if (!@rename($tmpPath, $path)) { @unlink($tmpPath); return false; }
    return true;
}

function jsonError($code, $msg) {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

function jsonSuccess($data = []) {
    echo json_encode(array_merge(['success' => true], $data));
    exit;
}

// ★ verifyAuthToken → auth_helpers.php (共享实现)

// ---- 验证 root 身份 ----
$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? trim($_GET['action']) : '';

// 所有操作都需要 root token
$token = $_GET['token'] ?? $_POST['token'] ?? '';
$input = json_decode(file_get_contents('php://input'), true);
if ($input && empty($token)) {
    $token = $input['token'] ?? '';
}

$userId = verifyAuthToken($token);
if (!$userId) jsonError(401, '登录已过期，请重新登录');

$users = readJson($usersFile);
$currentUser = $users[$userId] ?? null;
if (!$currentUser || ($currentUser['role'] ?? 'user') !== 'root') {
    jsonError(403, '权限不足，仅 root 可执行此操作');
}

switch ($action) {

    // ---- 获取用户列表 ----
    case 'list_users':
        $userList = [];
        foreach ($users as $id => $u) {
            $userList[] = [
                'user_id' => $id,
                'username' => $u['username'],
                'role' => $u['role'] ?? 'user',
                'created_at' => $u['created_at'] ?? '',
                'last_active' => $u['last_active'] ?? '',
            ];
        }
        // 按创建时间排序
        usort($userList, function($a, $b) {
            return strcmp($a['created_at'], $b['created_at']);
        });
        jsonSuccess(['users' => $userList]);
        break;

    // ---- 提权/降级 ----
    case 'set_role':
        $targetUserId = $_GET['target_user'] ?? $input['target_user'] ?? '';
        $newRole = $_GET['role'] ?? $input['role'] ?? '';

        if (empty($targetUserId)) jsonError(400, '缺少目标用户ID');
        if (!in_array($newRole, ['user', 'root'], true)) jsonError(400, '角色参数错误，仅支持 user / root');

        if (!isset($users[$targetUserId])) jsonError(404, '目标用户不存在');

        $targetUser = $users[$targetUserId];
        // 不能操作自己
        if ($targetUserId === $userId) jsonError(400, '不能修改自己的权限');

        $oldRole = $targetUser['role'] ?? 'user';
        $targetUser['role'] = $newRole;
        $users[$targetUserId] = $targetUser;

        if (!writeJson($usersFile, $users)) {
            jsonError(500, '保存失败');
        }

        jsonSuccess([
            'message' => '权限已修改',
            'username' => $targetUser['username'],
            'old_role' => $oldRole,
            'new_role' => $newRole
        ]);
        break;

    // ---- 删除用户 ----
    case 'delete_user':
        $targetUserId = $_GET['target_user'] ?? $input['target_user'] ?? '';
        if (empty($targetUserId)) jsonError(400, '缺少目标用户ID');
        if (!isset($users[$targetUserId])) jsonError(404, '目标用户不存在');
        if ($targetUserId === $userId) jsonError(400, '不能删除自己的账号');

        $targetUser = $users[$targetUserId];
        $username = $targetUser['username'];

        // 从 users 中删除
        unset($users[$targetUserId]);
        if (!writeJson($usersFile, $users)) {
            jsonError(500, '保存失败');
        }

        // 清理该用户的 session
        $sessions = readJson($sessionsFile);
        foreach ($sessions as $token => $info) {
            if (($info['user_id'] ?? '') === $targetUserId) {
                unset($sessions[$token]);
            }
        }
        writeJson($sessionsFile, $sessions);

        jsonSuccess([
            'message' => '用户已删除',
            'username' => $username
        ]);
        break;

    default:
        jsonError(400, '未知操作');
}
