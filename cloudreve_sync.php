<?php
/**
 * Cloudreve API 账号同步桥接 v5
 * 
 * 目标：主页注册/登录时 → Cloudreve 存在同邮箱+同密码+同用户名的账号
 * 
 * 策略：
 *   1. 尝试登录 → 成功 = 账号已同步
 *   2. 登录失败 → 尝试注册 → 成功 = 账号已创建
 *   3. 注册失败(40032 邮箱已存在) → DB删旧 → 重新注册(Cloudreve 会生成正确hash)
 *   4. 密码<6位 → 生成兼容密码注册
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: https://naujtrats.xyz');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$username = trim($input['username'] ?? '');
$password = $input['password'] ?? '';
$email = trim($input['email'] ?? '');

if (!$username || !$password) {
    echo json_encode(['success' => false, 'error' => '缺少用户名或密码']);
    exit;
}
$email = $email ?: "{$username}@naujtrats.xyz";

function cr_http($method, $path, $data = []) {
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

// 步骤4: 邮箱已存在 → 删旧建新(Cloudreve 用正确 hash)
if ($rc3 === 40032) {
    $db = '/opt/cloudreve/data/cloudreve.db';
    if (file_exists($db)) {
        $e = str_replace("'", "''", $email);
        shell_exec("sqlite3 {$db} \"DELETE FROM users WHERE email='{$e}'\" 2>/dev/null");
        $rr = cr_http('POST', '/user', ['email' => $email, 'password' => $password, 'nick' => $username]);
        if ($rr['http'] === 200 && ($rr['data']['code'] ?? -1) === 0) {
            $token = save_token($email, $password, $username);
            echo json_encode(['success' => true, 'login_token' => $token, 'email' => $email, 'status' => 'reset', 'message' => 'Cloudreve 密码已重置为与主页一致']);
            exit;
        }
    }
    echo json_encode(['success' => false, 'error' => "该邮箱已在 Cloudreve 注册但无法重置密码，请联系管理员"]);
    exit;
}

// 其他失败
echo json_encode(['success' => false, 'error' => "同步失败: {$rm3}"]);
