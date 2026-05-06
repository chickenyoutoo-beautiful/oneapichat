<?php
/**
 * OneAPIChat 用户认证 API
 * POST: register / login / logout / update_profile
 * GET: verify / get_profile
 */

// ---- 动态 CORS（允许所有可信域名 + 允许 credentials）----
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = [
    'https://xiaoxin.naujtrats.xyz',
    'https://naujtrats.xyz',
    'https://www.naujtrats.xyz'
];
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
} else {
    header('Access-Control-Allow-Origin: *');
}
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Auth-Token');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ---- 数据目录 ----
$usersDir = __DIR__ . '/users/';
if (!is_dir($usersDir)) {
    @mkdir($usersDir, 0755, true);
}

$usersFile = $usersDir . 'users.json';
$sessionsFile = $usersDir . 'sessions.json';

// ---- 读取/写入辅助函数 ----
function readJson($path) {
    if (!file_exists($path)) return [];
    $data = @json_decode(@file_get_contents($path), true);
    return is_array($data) ? $data : [];
}

function writeJson($path, $data) {
    return @file_put_contents($path, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX) !== false;
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

function generateToken() {
    return bin2hex(random_bytes(32));
}

function generateUserId() {
    return 'u_' . bin2hex(random_bytes(12));
}

function cleanUsername($name) {
    return preg_replace('/[^a-zA-Z0-9_\x{4e00}-\x{9fa5}]/u', '', trim($name));
}

// ---- 清理过期会话 ----
function cleanExpiredSessions(&$sessions) {
    $now = time();
    $expireTime = 30 * 24 * 3600; // 30 天
    foreach ($sessions as $token => $info) {
        if (($now - ($info['created_at'] ?? 0)) > $expireTime) {
            unset($sessions[$token]);
        }
    }
}

// ---- Token 验证 ----
function verifyToken($token) {
    global $sessionsFile;
    if (empty($token) || strlen($token) < 20) return null;
    $sessions = readJson($sessionsFile);
    cleanExpiredSessions($sessions);
    $info = $sessions[$token] ?? null;
    if (!$info) return null;
    return $info['user_id'] ?? null;
}

// ---- 请求处理 ----
$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? trim($_GET['action']) : '';
$input = json_decode(file_get_contents('php://input'), true);

switch ($method) {
    case 'POST':
        if (!$input) jsonError(400, '无效的请求数据');

        if ($action === 'register') {
            $username = cleanUsername($input['username'] ?? '');
            $password = trim($input['password'] ?? '');

            if (strlen($username) < 2 || strlen($username) > 20) {
                jsonError(400, '用户名长度需在 2-20 个字符');
            }
            if (strlen($password) < 6) {
                jsonError(400, '密码长度至少 6 位');
            }

            $users = readJson($usersFile);
            foreach ($users as $u) {
                if ($u['username'] === $username) {
                    jsonError(409, '用户名已存在');
                }
            }

            $userId = generateUserId();
            $users[$userId] = [
                'username' => $username,
                'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                'created_at' => date('c')
            ];
            if (!writeJson($usersFile, $users)) {
                jsonError(500, '创建用户失败');
            }

            $token = generateToken();
            $sessions = readJson($sessionsFile);
            $sessions[$token] = [
                'user_id' => $userId,
                'created_at' => time()
            ];
            writeJson($sessionsFile, $sessions);

            jsonSuccess([
                'token' => $token,
                'username' => $username,
                'user_id' => $userId
            ]);

        } elseif ($action === 'login') {
            $username = cleanUsername($input['username'] ?? '');
            $password = trim($input['password'] ?? '');

            if (empty($username) || empty($password)) {
                jsonError(400, '请输入用户名和密码');
            }

            $users = readJson($usersFile);
            $userId = null;
            foreach ($users as $id => $u) {
                if ($u['username'] === $username) {
                    if (password_verify($password, $u['password_hash'])) {
                        $userId = $id;
                    }
                    break;
                }
            }

            if (!$userId) {
                jsonError(401, '用户名或密码错误');
            }

            $token = generateToken();
            $sessions = readJson($sessionsFile);
            $sessions[$token] = [
                'user_id' => $userId,
                'created_at' => time()
            ];
            writeJson($sessionsFile, $sessions);

            jsonSuccess([
                'token' => $token,
                'username' => $username,
                'user_id' => $userId
            ]);

        } elseif ($action === 'logout') {
            $token = $input['token'] ?? '';
            if (!empty($token)) {
                $sessions = readJson($sessionsFile);
                unset($sessions[$token]);
                writeJson($sessionsFile, $sessions);
            }
            jsonSuccess(['message' => '已退出登录']);

        } elseif ($action === 'update_profile') {
            $token = $input['token'] ?? '';
            if (empty($token)) jsonError(401, '未登录');
            $userId = verifyToken($token);
            if (!$userId) jsonError(401, '登录已过期');

            $users = readJson($usersFile);
            if (!isset($users[$userId])) jsonError(404, '用户不存在');

            if (!empty($input['username'])) {
                $newUsername = cleanUsername($input['username']);
                if (strlen($newUsername) < 2 || strlen($newUsername) > 20) {
                    jsonError(400, '用户名长度需在 2-20 个字符');
                }
                foreach ($users as $id => $u) {
                    if ($id !== $userId && $u['username'] === $newUsername) {
                        jsonError(409, '用户名已被占用');
                    }
                }
                $users[$userId]['username'] = $newUsername;
            }

            if (!empty($input['new_password'])) {
                if (empty($input['current_password'])) {
                    jsonError(400, '请输入当前密码');
                }
                if (!password_verify($input['current_password'], $users[$userId]['password_hash'])) {
                    jsonError(401, '当前密码错误');
                }
                if (strlen($input['new_password']) < 6) {
                    jsonError(400, '新密码长度至少 6 位');
                }
                $users[$userId]['password_hash'] = password_hash($input['new_password'], PASSWORD_DEFAULT);
            }

            $users[$userId]['updated_at'] = date('c');
            if (!writeJson($usersFile, $users)) {
                jsonError(500, '保存失败');
            }

            jsonSuccess(['username' => $users[$userId]['username'], 'message' => '更新成功']);

        } else {
            jsonError(400, '未知操作');
        }
        break;

    case 'GET':
        if ($action === 'verify') {
            $token = $_GET['token'] ?? '';
            $userId = verifyToken($token);
            if (!$userId) {
                echo json_encode(['valid' => false]);
                exit;
            }
            $users = readJson($usersFile);
            $username = $users[$userId]['username'] ?? '未知用户';
            echo json_encode([
                'valid' => true,
                'username' => $username,
                'user_id' => $userId
            ]);
            exit;
        } elseif ($action === 'get_profile') {
            $token = $_GET['token'] ?? '';
            if (empty($token)) jsonError(401, '未登录');
            $userId = verifyToken($token);
            if (!$userId) jsonError(401, '登录已过期');

            $users = readJson($usersFile);
            if (!isset($users[$userId])) jsonError(404, '用户不存在');

            echo json_encode([
                'success' => true,
                'username' => $users[$userId]['username'],
                'created_at' => $users[$userId]['created_at'] ?? null
            ]);
            exit;
        }
        jsonError(400, '未知操作');
        break;

    default:
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
}
