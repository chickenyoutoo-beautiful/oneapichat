<?php
/**
 * OneAPIChat 用户认证 API
 * POST: register / login / logout / update_profile
 * GET: verify / get_profile
 */

// ---- 动态 CORS（允许所有可信域名 + 允许 credentials）----
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = [
    'https://naujtrats.xyz',
    'https://www.naujtrats.xyz',
    'https://aliyun.naujtrats.xyz',
    'http://39.172.0.99',
    'http://192.168.195.213',
    'http://192.168.1.129',
];
// 动态匹配: 如果 Origin 的 host 等于当前服务器域名/IP, 也视为同源
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
header('Access-Control-Allow-Headers: Content-Type, Auth-Token');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ---- 数据目录 ----
$usersDir = dirname(__DIR__) . '/users/';
if (!is_dir($usersDir)) {
    @mkdir($usersDir, 0755, true);
}

$usersFile = $usersDir . 'users.json';
$sessionsFile = $usersDir . 'sessions.json';

// ---- 读取/写入辅助函数 ----
function readJson($path) {
    if (!file_exists($path)) return [];
    $raw = file_get_contents($path);
    if ($raw === false || trim($raw) === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        // ★ 文件损坏时保留备份并返回空数组,下次写入会覆盖
        $backup = $path . '.corrupted.' . date('Ymd_His');
        @rename($path, $backup);
        error_log('[auth.php] Corrupted JSON file backed up: ' . $backup);
        return [];
    }
    return $data;
}

function writeJson($path, $data) {
    // ★ 原子写入: 先写临时文件,再 rename,防止并发写入导致文件损坏
    $tmpPath = $path . '.' . getmypid() . '.tmp';
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false) return false;
    if (@file_put_contents($tmpPath, $json, LOCK_EX) === false) return false;
    if (!@rename($tmpPath, $path)) {
        @unlink($tmpPath);
        return false;
    }
    return true;
}

function jsonError($code, $msg) {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

function jsonSuccess($data = []) {
    // ★ 保存 token 到 session（跨域共享）
    if (isset($data['token']) && session_status() === PHP_SESSION_ACTIVE) {
        $_SESSION['auth_token'] = $data['token'];
        $_SESSION['auth_username'] = $data['username'] ?? '';
        $_SESSION['auth_user_id'] = $data['user_id'] ?? '';
    }

    // ★ 跨域登录状态同步 cookie
    if (isset($data['token'])) {
        setcookie('auth_token', $data['token'], [
            'expires' => time() + 30 * 86400,
            'path' => '/',
            'domain' => '.naujtrats.xyz',
            'secure' => true,
            'httponly' => false,
            'samesite' => 'Lax'
        ]);
    }
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

require_once __DIR__ . '/auth_helpers.php';
// ★ verifyAuthToken → auth_helpers.php (共享实现)

// ---- 请求处理 ----
$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? trim($_GET['action']) : '';
$input = json_decode(file_get_contents('php://input'), true);


/**
 * 获取跨域认证 token（优先 session，其次 cookie）
 */

// ★ 跨域 session: 所有子域名共享登录态
if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'lifetime' => 30 * 86400,
        'path' => '/',
        'domain' => '.naujtrats.xyz',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax'
    ]);
    @session_start();
}

function getCrossDomainToken() {
    if (session_status() === PHP_SESSION_ACTIVE && !empty($_SESSION['auth_token'])) {
        return $_SESSION['auth_token'];
    }
    if (!empty($_COOKIE['auth_token'])) {
        return $_COOKIE['auth_token'];
    }
    return null;
}

switch ($method) {
    case 'POST':
        if (!$input) jsonError(400, '无效的请求数据');

        if ($action === 'send_reg_code') {
            $email = trim($input['email'] ?? '');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) jsonError(400, '邮箱格式不正确');

            // 检查是否已注册
            $users = readJson($usersFile);
            foreach ($users as $u) {
                if (($u['email'] ?? '') === $email) jsonError(409, '该邮箱已被注册');
            }

            $code = str_pad(random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            $codeFile = $usersDir . 'reg_codes.json';
            $regCodes = readJson($codeFile);
            $regCodes[$email] = ['code' => $code, 'time' => time()];
            writeJson($codeFile, $regCodes);

            require_once __DIR__ . '/mailer.php';
            if (sendVerificationCode($email, $code)) {
                jsonSuccess(['message' => '验证码已发送到 ' . $email]);
            } else {
                jsonSuccess(['message' => '验证码: ' . $code, 'debug_code' => $code]);
            }

        } elseif ($action === 'send_reset') {
            $email = trim($input['email'] ?? '');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) jsonError(400, '邮箱格式不正确');
            $users = readJson($usersFile);
            $userId = null;
            foreach ($users as $id => $u) {
                if (($u['email'] ?? '') === $email) { $userId = $id; break; }
            }
            if (!$userId) jsonError(404, '该邮箱未注册');
            $resetToken = bin2hex(random_bytes(32));
            $users[$userId]['reset_token'] = $resetToken;
            $users[$userId]['reset_token_time'] = time();
            writeJson($usersFile, $users);
            $resetLink = 'https://naujtrats.xyz/oneapichat/reset_password.html?token=' . $resetToken;
            require_once __DIR__ . '/mailer.php';
            $sent = sendResetMail($email, $resetLink);
            if ($sent) {
                jsonSuccess(['message' => '重置链接已发送到 ' . $email]);
            } else {
                jsonSuccess(['message' => '重置链接: ' . $resetLink]);
            }
        } elseif ($action === 'reset_password') {
            $resetToken = trim($input['token'] ?? '');
            $newPassword = trim($input['password'] ?? '');
            if (strlen($resetToken) < 10) jsonError(400, '无效的重置链接');
            if (strlen($newPassword) < 6) jsonError(400, '新密码至少6位');
            $users = readJson($usersFile);
            $userId = null;
            foreach ($users as $id => $u) {
                if (($u['reset_token'] ?? '') === $resetToken) {
                    if (time() - ($u['reset_token_time'] ?? 0) > 3600) jsonError(400, '重置链接已过期（1小时）');
                    $userId = $id; break;
                }
            }
            if (!$userId) jsonError(400, '无效或已过期的重置链接');
            $users[$userId]['password_hash'] = password_hash($newPassword, PASSWORD_DEFAULT);
            unset($users[$userId]['reset_token'], $users[$userId]['reset_token_time']);
            writeJson($usersFile, $users);
            jsonSuccess(['message' => '密码已重置，请重新登录']);
        } elseif ($action === 'register') {
            // jsonError(403, '注册暂未开放,请使用已有账号登录');
            $username = cleanUsername($input['username'] ?? '');
            $password = trim($input['password'] ?? '');
            // 速率限制(注册)
            require_once __DIR__ . '/init.php';
            $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
            $rl = checkLoginRateLimit($ip, 'ip');
            if (!$rl['allowed']) {
                http_response_code(429);
                jsonError(429, "请求过于频繁，请 {$rl['retry_after']} 秒后重试");
                exit;
            }

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

            $email = trim($input['email'] ?? '');
            $code = trim($input['code'] ?? '');
            if (!$email) jsonError(400, '请填写邮箱');

            // 验证邮箱验证码
            $codeFile = $usersDir . 'reg_codes.json';
            $regCodes = readJson($codeFile);
            $saved = $regCodes[$email] ?? null;
            if (!$saved || time() - ($saved['time'] ?? 0) > 600) {
                jsonError(400, '验证码已过期，请重新发送');
            }
            if (($saved['code'] ?? '') !== $code) {
                jsonError(400, '验证码错误');
            }
            unset($regCodes[$email]);
            writeJson($codeFile, $regCodes);

            $userId = generateUserId();
            foreach ($users as $u) {
                if (($u['email'] ?? '') === $email) {
                    jsonError(409, '该邮箱已被注册');
                }
            }
            $users[$userId] = [
                'username' => $username,
                'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                'created_at' => date('c'),
                'email' => $email ?: null,
                'role' => 'user'
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
                'user_id' => $userId,
                'role' => 'user'
            ]);

        } elseif ($action === 'login') {
            $login = trim($input['username'] ?? '');
            $password = trim($input['password'] ?? '');
            $username = cleanUsername($login);

            // 速率限制(登录) — IP + 用户双维度
            require_once __DIR__ . '/init.php';
            $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
            $rlIp = checkLoginRateLimit($ip, 'ip');
            $rlUser = checkLoginRateLimit($username ?: $login, 'user');
            if (!$rlIp['allowed'] || !$rlUser['allowed']) {
                $retry = max($rlIp['retry_after'] ?? 0, $rlUser['retry_after'] ?? 0);
                http_response_code(429);
                jsonError(429, "登录尝试过多，请 {$retry} 秒后重试");
                exit;
            }

            if (empty($login) || empty($password)) {
                jsonError(400, '请输入用户名/邮箱和密码');
            }

            $users = readJson($usersFile);
            $userId = null;
            foreach ($users as $id => $u) {
                // 支持用户名或邮箱登录
                if ($u['username'] === $login || ($u['email'] ?? '') === $login) {
                    if (password_verify($password, $u['password_hash'])) {
                        $userId = $id;
                    }
                    break;
                }
            }

            if (!$userId) {
                jsonError(401, '用户名/邮箱或密码错误');
            }

            $token = generateToken();
            $sessions = readJson($sessionsFile);
            $sessions[$token] = [
                'user_id' => $userId,
                'created_at' => time()
            ];
            writeJson($sessionsFile, $sessions);

            // 从数据库读取真实 role
            $role = $users[$userId]['role'] ?? 'user';
            jsonSuccess([
                'token' => $token,
                'username' => $users[$userId]['username'] ?? $username,
                'user_id' => $userId,
                'role' => $role
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
            $userId = verifyAuthToken($token);
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

        } elseif ($action === 'send_verify_code') {
            $token = $input['token'] ?? '';
            $email = trim($input['email'] ?? '');
            if (empty($token)) jsonError(401, '未登录');
            $userId = verifyAuthToken($token);
            if (!$userId) jsonError(401, '登录已过期');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) jsonError(400, '邮箱格式不正确');

            $users = readJson($usersFile);
            // 检查邮箱是否已被其他用户绑定
            foreach ($users as $id => $u) {
                if ($id !== $userId && ($u['email'] ?? '') === $email) {
                    jsonError(409, '该邮箱已被其他账号绑定');
                }
            }

            $code = str_pad(random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            $users[$userId]['verify_code'] = $code;
            $users[$userId]['verify_code_time'] = time();
            $users[$userId]['pending_email'] = $email;
            writeJson($usersFile, $users);

            require_once __DIR__ . '/mailer.php';
            if (sendVerificationCode($email, $code)) {
                jsonSuccess(['message' => '验证码已发送到 ' . $email]);
            } else {
                // SMTP 不可用，debug 模式：返回验证码给前端
                jsonSuccess(['message' => '验证码: ' . $code . '（调试模式，请尽快配置SMTP）', 'debug_code' => $code]);
            }

        } elseif ($action === 'bind_email') {
            $token = $input['token'] ?? '';
            $code = trim($input['code'] ?? '');
            if (empty($token)) jsonError(401, '未登录');
            $userId = verifyAuthToken($token);
            if (!$userId) jsonError(401, '登录已过期');
            if (strlen($code) !== 6) jsonError(400, '验证码格式不正确');

            $users = readJson($usersFile);
            $userData = $users[$userId] ?? null;
            if (!$userData) jsonError(404, '用户不存在');

            $savedCode = $userData['verify_code'] ?? '';
            $codeTime = $userData['verify_code_time'] ?? 0;
            if (time() - $codeTime > 600) jsonError(400, '验证码已过期，请重新发送');
            if ($savedCode !== $code) jsonError(400, '验证码错误');

            $newEmail = $userData['pending_email'] ?? '';
            $users[$userId]['email'] = $newEmail;
            unset($users[$userId]['verify_code'], $users[$userId]['verify_code_time'], $users[$userId]['pending_email']);
            writeJson($usersFile, $users);

            jsonSuccess(['email' => $newEmail, 'message' => '邮箱绑定成功']);
        } elseif ($action === 'unbind_email') {
            $token = $input['token'] ?? '';
            if (empty($token)) jsonError(401, '未登录');
            $userId = verifyAuthToken($token);
            if (!$userId) jsonError(401, '登录已过期');
            $users = readJson($usersFile);
            if (!isset($users[$userId])) jsonError(404, '用户不存在');
            $users[$userId]['email'] = null;
            unset($users[$userId]['verify_code'], $users[$userId]['verify_code_time'], $users[$userId]['pending_email']);
            writeJson($usersFile, $users);
            jsonSuccess(['message' => '邮箱已解绑']);
        } elseif ($action === 'delete_account') {
            $token = $input['token'] ?? '';
            if (empty($token)) jsonError(401, '未登录');
            $userId = verifyAuthToken($token);
            if (!$userId) jsonError(401, '登录已过期');
            $users = readJson($usersFile);
            if (!isset($users[$userId])) jsonError(404, '用户不存在');
            unset($users[$userId]);
            writeJson($usersFile, $users);
            $sessions = readJson($sessionsFile);
            foreach ($sessions as $t => $info) {
                if (($info['user_id'] ?? '') === $userId) unset($sessions[$t]);
            }
            writeJson($sessionsFile, $sessions);
            jsonSuccess(['message' => '账号已注销']);

        } else {
            jsonError(400, '未知操作');
        }
        break;

    case 'GET':
        if ($action === 'verify') {
            $token = $_GET['token'] ?? '';
            $userId = verifyAuthToken($token);
            if (!$userId) {
                echo json_encode(['valid' => false]);
                exit;
            }
            $users = readJson($usersFile);
            $username = $users[$userId]['username'] ?? '未知用户';
            $role = $users[$userId]['role'] ?? 'user';
            // ★ 更新最后活跃时间 (带保护: 用户数据为空时跳过写入)
            if (!empty($users[$userId]) && !empty($users[$userId]['username'])) {
                $users[$userId]['last_active'] = date('c');
                writeJson($usersFile, $users);
            }
            echo json_encode([
                'valid' => true,
                'username' => $username,
                'user_id' => $userId,
                'role' => $role
            ]);
            exit;
        } elseif ($action === 'get_profile') {
            $token = $_GET['token'] ?? '';
            if (empty($token)) jsonError(401, '未登录');
            $userId = verifyAuthToken($token);
            if (!$userId) jsonError(401, '登录已过期');

            $users = readJson($usersFile);
            if (!isset($users[$userId])) jsonError(404, '用户不存在');

            echo json_encode([
                'success' => true,
                'user_id' => $userId,
                'username' => $users[$userId]['username'] ?? '',
                'role' => $users[$userId]['role'] ?? 'user',
                'email' => $users[$userId]['email'] ?? null,
                'last_active' => $users[$userId]['last_active'] ?? null,
                'created_at' => $users[$userId]['created_at'] ?? null
            ]);
            exit;
        } elseif ($action === 'cross_domain_token') {
            // ★ 跨域 cookie/session → 返回 token
            $token = getCrossDomainToken();
            if ($token) {
                echo json_encode(['success' => true, 'token' => $token, 'username' => ($_SESSION['auth_username'] ?? '')]);
            } else {
                echo json_encode(['success' => false]);
            }
            exit;
        }
        jsonError(400, '未知操作');
        break;
    default:
        echo json_encode(['error' => 'Method not allowed']);
}
