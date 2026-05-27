<?php
/**
 * Cloudreve 自动登录跳转 - 通过临时 token 安全传递凭据
 * GET /oneapichat/cloudreve_login.php?t=临时token
 */

$tmpToken = $_GET['t'] ?? '';

if (!$tmpToken) {
    header('Location: https://cloudreve.naujtrats.xyz');
    exit;
}

// 从临时文件读取凭据（主页登录时写，这里读后立即删除）
$tmpFile = "/tmp/cloudreve_login_" . preg_replace('/[^a-f0-9]/', '', $tmpToken) . ".json";

if (!file_exists($tmpFile)) {
    header('Location: https://cloudreve.naujtrats.xyz');
    exit;
}

$creds = json_decode(file_get_contents($tmpFile), true);
@unlink($tmpFile); // 用完即删

$email = $creds['email'] ?? '';
$password = $creds['password'] ?? '';

if (!$email || !$password) {
    header('Location: https://cloudreve.naujtrats.xyz');
    exit;
}

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => 'http://127.0.0.1:5212/api/v4/session/token',
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['email' => $email, 'password' => $password]),
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Host: cloudreve.naujtrats.xyz'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 5,
]);
$body = curl_exec($ch);
curl_close($ch);

$data = json_decode($body, true);
if (($data['code'] ?? 1) === 0) {
    $token = $data['data']['token']['access_token'] ?? '';
    header("Location: https://cloudreve.naujtrats.xyz/?cr_login=" . urlencode($token));
} else {
    header('Location: https://cloudreve.naujtrats.xyz');
}
exit;
