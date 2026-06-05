<?php
/**
 * Cloudreve 自动登录桥接 v6
 * 直接用 cr_login 参数跳转，让 Cloudreve 的 SPA 内联脚本处理
 */
$tmpToken = $_GET['t'] ?? '';
if (!$tmpToken) { header('Location: https://cloudreve.naujtrats.xyz'); exit; }

$tmpFile = "/tmp/cloudreve_login_" . preg_replace('/[^a-f0-9]/', '', $tmpToken) . ".json";
error_log("[cr_login] tmpFile: $tmpFile exists: " . (file_exists($tmpFile) ? 'yes' : 'no'));
if (!file_exists($tmpFile)) { header('Location: https://cloudreve.naujtrats.xyz'); exit; }

$creds = json_decode(file_get_contents($tmpFile), true);
@unlink($tmpFile);

$email = $creds['email'] ?? '';
$password = $creds['password'] ?? '';
if (!$email || !$password) { header('Location: https://cloudreve.naujtrats.xyz'); exit; }

// ★ 短密码兼容处理（同 cloudreve_sync.php 逻辑）
if (strlen($password) < 6) {
    $password = 'cr_' . substr(base64_encode($password), 0, 14);
}

// 调用 Cloudreve API 获取 token
$ch = curl_init('http://127.0.0.1:5212/api/v4/session/token');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['email' => $email, 'password' => $password]),
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Host: cloudreve.naujtrats.xyz'],
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5,
]);
$body = curl_exec($ch);
$info = curl_getinfo($ch);
curl_close($ch);

$data = json_decode($body, true);
$code = $data['code'] ?? 1;
$accessToken = $data['data']['token']['access_token'] ?? '';
error_log("[cr_login] API http_code={$info['http_code']} code=$code token_len=" . strlen($accessToken));

if ($code !== 0) { header('Location: https://cloudreve.naujtrats.xyz'); exit; }
if (!$accessToken) { header('Location: https://cloudreve.naujtrats.xyz'); exit; }

// ★ 直接用 cr_login 参数跳转，Cloudreve 的 SPA sub_filter 脚本会处理
$redirectUrl = 'https://cloudreve.naujtrats.xyz/?cr_login=' . urlencode($accessToken);
error_log("[cr_login] redirect: $redirectUrl");
header("Location: {$redirectUrl}");
exit;
