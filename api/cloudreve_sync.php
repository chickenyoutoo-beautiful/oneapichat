<?php
/**
 * Cloudreve API 账号同步桥接 v5
 * 
 * 目标：主页注册/登录时 → Cloudreve 存在同邮箱+同密码+同用户名的账号
 * 
 * 策略：
 *   0. 必须先校验 OneAPIChat 用户名/邮箱与密码，禁止匿名改写云盘账号
 *   1. 尝试登录 → 成功 = 账号已同步
 *   2. 登录失败 → 尝试注册 → 成功 = 账号已创建
 *   3. 注册失败(40032 邮箱已存在) → 仅用已经验证的主项目密码同步
 *   4. 密码<6位 → 生成兼容密码注册
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: https://naujtrats.xyz');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

require_once __DIR__ . '/cloudreve_lib.php';

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$username = trim($input['username'] ?? '');
$password = $input['password'] ?? '';
$email = trim($input['email'] ?? '');

if (!$username || !$password) {
    echo json_encode(['success' => false, 'error' => '缺少用户名或密码']);
    exit;
}

// CORS 不是认证。同步前必须重新验证主项目密码，并以服务端记录覆盖客户端
// 提交的 email/username，避免凭据持有者借此修改其他 Cloudreve 账号。
$usersFile = __DIR__ . '/../users/users.json';
$users = json_decode(@file_get_contents($usersFile), true) ?: [];
$verifiedUserId = '';
$verifiedUser = null;
foreach ($users as $uid => $u) {
    $matchesLogin = (($u['username'] ?? '') === $username)
        || ($email !== '' && strcasecmp((string)($u['email'] ?? ''), $email) === 0);
    if ($matchesLogin && !empty($u['password_hash']) && password_verify($password, $u['password_hash'])) {
        $verifiedUserId = (string)$uid;
        $verifiedUser = $u;
        break;
    }
}
if (!$verifiedUser) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => '主项目身份验证失败，已拒绝云盘同步']);
    exit;
}
$username = (string)($verifiedUser['username'] ?? $username);
$email = trim((string)($verifiedUser['email'] ?? ''));
if ($email === '') {
    http_response_code(409);
    echo json_encode(['success' => false, 'error' => '主项目账号未绑定邮箱，无法同步到 Cloudreve']);
    exit;
}

function cr_http(string $method, string $path, array $data = []): ?array {
    $ch = curl_init("http://127.0.0.1:5212/api/v4" . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Host: cloudreve.naujtrats.xyz'],
    ]);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    }
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['http' => $code, 'data' => json_decode($body, true) ?: []];
}

function save_token($email, $password, $username) {
    $t = bin2hex(random_bytes(32));
    file_put_contents("/tmp/cloudreve_login_{$t}.json", json_encode([
        'email' => $email, 'password' => $password, 'username' => $username, 'created' => time(),
    ]));
    foreach (glob('/tmp/cloudreve_login_*.json') as $f) {
        if (time() - filemtime($f) > 300) @unlink($f);
    }
    return $t;
}

// 步骤1: 登录
$r1 = cr_http('POST', '/session/token', ['email' => $email, 'password' => $password]);
if ($r1['http'] === 200 && ($r1['data']['code'] ?? -1) === 0) {
    $token = save_token($email, $password, $username);
    echo json_encode(['success' => true, 'login_token' => $token, 'email' => $email, 'status' => 'synced', 'message' => 'Cloudreve 账号已同步']);
    exit;
}

// 步骤2: 密码<6 特殊处理
if (strlen($password) < 6) {
    $safe = 'cr_' . substr(base64_encode($password), 0, 14);
    $r2 = cr_http('POST', '/user', ['email' => $email, 'password' => $safe, 'nick' => $username]);
    if ($r2['http'] === 200 && ($r2['data']['code'] ?? -1) === 0) {
        $token = save_token($email, $safe, $username);
        echo json_encode(['success' => true, 'login_token' => $token, 'email' => $email, 'status' => 'created_alt', 'message' => 'Cloudreve 账号已创建（密码已调整）']);
        exit;
    }
    $rc = $r2['data']['code'] ?? -1;
    if ($rc === 40032) {
        // 邮箱已存在但密码不同 → 尝试用安全密码登录
        $rl = cr_http('POST', '/session/token', ['email' => $email, 'password' => $safe]);
        if ($rl['http'] === 200 && ($rl['data']['code'] ?? -1) === 0) {
            $token = save_token($email, $safe, $username);
            echo json_encode(['success' => true, 'login_token' => $token, 'email' => $email, 'status' => 'synced_alt', 'message' => 'Cloudreve 账号已同步']);
            exit;
        }
    }
    echo json_encode(['success' => false, 'error' => 'Cloudreve 要求密码至少6位', 'need_stronger_password' => true]);
    exit;
}

// 步骤3: 密码>=6 → 注册
$r3 = cr_http('POST', '/user', ['email' => $email, 'password' => $password, 'nick' => $username]);
if ($r3['http'] === 200 && ($r3['data']['code'] ?? -1) === 0) {
    $token = save_token($email, $password, $username);
    echo json_encode(['success' => true, 'login_token' => $token, 'email' => $email, 'status' => 'created', 'message' => 'Cloudreve 账号已创建（同邮箱同密码同用户名）']);
    exit;
}

$rc3 = $r3['data']['code'] ?? -1;
$rm3 = $r3['data']['msg'] ?? '';

// 步骤4: 邮箱已存在 → 只允许使用上方已经验证的主项目密码同步
if ($rc3 === 40032) {
    if (cr_syncVerifiedMainPassword($email, $password)) {
        $rl = cr_http('POST', '/session/token', ['email' => $email, 'password' => $password]);
        if ($rl['http'] === 200 && ($rl['data']['code'] ?? -1) === 0) {
            $token = save_token($email, $password, $username);
            echo json_encode(['success' => true, 'login_token' => $token, 'email' => $email, 'status' => 'updated_in_place', 'message' => 'Cloudreve 账号已原地同步']);
            exit;
        }
    }
    echo json_encode(['success' => false, 'error' => "该邮箱已在 Cloudreve 注册但原地同步失败，请联系管理员"]);
    exit;
}

// 其他失败
echo json_encode(['success' => false, 'error' => "同步失败: {$rm3}"]);
