<?php
/**
 * Cloudreve SSO 桥接 v3
 * - 同步时如果失败（密码太短），忽略（Cloudreve 下次点开再处理）
 * - 从主页打开时：直接用存好的 login_token 获取 Cloudreve token
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

if (!$email) $email = "{$username}@naujtrats.xyz";

$apiBase = 'http://127.0.0.1:5212/api/v4';

// 先尝试用原密码登录
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "$apiBase/session/token",
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['email' => $email, 'password' => $password]),
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Host: cloudreve.naujtrats.xyz'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 5,
]);
$resp = json_decode(curl_exec($ch), true);
curl_close($ch);

if (($resp['code'] ?? 1) === 0) {
    // 能登录，直接用
    goto generate_tmp_token;
}

// 登录失败，尝试用原密码注册
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "$apiBase/user",
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['email' => $email, 'password' => $password, 'nick' => $username]),
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Host: cloudreve.naujtrats.xyz'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 5,
]);
$regResp = json_decode(curl_exec($ch), true);
curl_close($ch);

if (($regResp['code'] ?? 1) !== 0) {
    // 注册也失败（如密码太短）→ 生成 Cloudreve 专用强密码
    $cloudPwd = bin2hex(random_bytes(8)); // 16位随机密码
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => "$apiBase/user",
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['email' => $email, 'password' => $cloudPwd, 'nick' => $username]),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Host: cloudreve.naujtrats.xyz'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
    ]);
    $regResp = json_decode(curl_exec($ch), true);
    curl_close($ch);

    if (($regResp['code'] ?? 1) !== 0) {
        echo json_encode(['success' => false, 'error' => $regResp['msg'] ?? '无法创建']);
        exit;
    }
    // Cloudreve 专用密码已创建，后续以此凭据登录
    $password = $cloudPwd;
}

generate_tmp_token:
// 生成临时登录 token
$tmpToken = bin2hex(random_bytes(32));
file_put_contents("/tmp/cloudreve_login_{$tmpToken}.json", json_encode([
    'email' => $email,
    'password' => $password,
    'created' => time()
]));

// 清理旧文件
foreach (glob('/tmp/cloudreve_login_*.json') as $f) {
    if (time() - filemtime($f) > 300) @unlink($f);
}

echo json_encode(['success' => true, 'login_token' => $tmpToken, 'email' => $email]);
