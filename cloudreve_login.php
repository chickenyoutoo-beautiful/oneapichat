<?php
/**
 * Cloudreve 自动登录跳转 v3
 * 策略：通过 Cookie 跨子域共享 token，Cloudreve 首页加载时自动登录
 */
$tmpToken = $_GET['t'] ?? '';
if (!$tmpToken) { header('Location: https://cloudreve.naujtrats.xyz'); exit; }

$tmpFile = "/tmp/cloudreve_login_" . preg_replace('/[^a-f0-9]/', '', $tmpToken) . ".json";
if (!file_exists($tmpFile)) { header('Location: https://cloudreve.naujtrats.xyz'); exit; }

$creds = json_decode(file_get_contents($tmpFile), true);
@unlink($tmpFile);

$email = $creds['email'] ?? '';
$password = $creds['password'] ?? '';
if (!$email || !$password) { header('Location: https://cloudreve.naujtrats.xyz'); exit; }

$ch = curl_init('http://127.0.0.1:5212/api/v4/session/token');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['email' => $email, 'password' => $password]),
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Host: cloudreve.naujtrats.xyz'],
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5,
]);
$data = json_decode(curl_exec($ch), true);
curl_close($ch);

if (($data['code'] ?? 1) !== 0) { header('Location: https://cloudreve.naujtrats.xyz'); exit; }

$accessToken = $data['data']['token']['access_token'] ?? '';
$refreshToken = $data['data']['token']['refresh_token'] ?? '';

// ★ 构建 Cloudreve session 数据
$session = json_encode([
    'sessions' => ['' => ['access_token' => $accessToken, 'refresh_token' => $refreshToken]],
    'anonymousSettings' => new stdClass(),
    'anonymousUser' => null,
]);

// ★ 通过 Cookie 传递（跨 .naujtrats.xyz 子域共享）
// Cloudreve 通过 API /api/v4/user/me 验证 token
// Cookie 只是让 Cloudreve 前端读取

// ★ 最终方案：HTML bridge —— 打开 Cloudreve 主页并通过 postMessage/iframe 写入 localStorage
// 更简单：直接在 cloudreve 域名下执行登录
$tokenEncoded = urlencode($accessToken);
$redirectUrl = 'https://cloudreve.naujtrats.xyz/?cr_login=' . $tokenEncoded;

// ★ 直接 302 跳转，依赖 Nginx sub_filter 注入的 JS
header("Location: {$redirectUrl}");
exit;
