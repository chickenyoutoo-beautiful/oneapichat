<?php
/**
 * Cloudreve 自动登录桥接 v7
 * 1. 读 tmp 凭据 → 调 Cloudreve API 拿 token + user
 * 2. 输出一个 HTML 页面，把完整 session state 写入 localStorage
 * 3. JS 跳到 /home（Cloudreve SPA 会自动登录）
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

// 调用 Cloudreve API 获取 token + user
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
$refreshToken = $data['data']['token']['refresh_token'] ?? '';
$accessExpires = $data['data']['token']['access_expires'] ?? '';
$refreshExpires = $data['data']['token']['refresh_expires'] ?? '';
$user = $data['data']['user'] ?? null;
$userId = $user['id'] ?? '';

error_log("[cr_login] API http_code={$info['http_code']} code=$code token_len=" . strlen($accessToken) . " userId=$userId");

if ($code !== 0 || !$accessToken || !$userId) {
    header('Location: https://cloudreve.naujtrats.xyz');
    exit;
}

// ★ 构造 Cloudreve 期望的 state 格式（user.id 作为 sessions key）
$session = [
    'user' => $user,
    'token' => [
        'access_token' => $accessToken,
        'refresh_token' => $refreshToken,
        'access_expires' => $accessExpires,
        'refresh_expires' => $refreshExpires,
    ],
    'settings' => (object)[],
];
$state = [
    'sessions' => [$userId => $session],
    'current' => $userId,
    'anonymousSettings' => (object)[],
    'anonymousUser' => null,
];

// 输出 HTML 桥接页：写 localStorage + 跳转
$stateJson = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$stateJsonEscaped = json_encode($stateJson); // JS 字符串字面量（双重转义）

header('Content-Type: text/html; charset=UTF-8');
?><!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>正在登录 Cloudreve…</title>
<script>
(function() {
  try {
    var stateJson = <?=$stateJsonEscaped?>;
    localStorage.setItem('cloudreve_session', stateJson);
    // 立即跳到 /home（SPA 会读 localStorage 自动登录）
    location.replace('https://cloudreve.naujtrats.xyz/home');
  } catch(e) {
    document.body.innerHTML = '<p>自动登录失败: ' + e.message + '，请 <a href="https://cloudreve.naujtrats.xyz">手动登录</a>。</p>';
  }
})();
</script>
</head>
<body>
<p>正在登录 Cloudreve…</p>
<noscript><p>需要 JavaScript 才能自动登录。请 <a href="https://cloudreve.naujtrats.xyz">手动登录</a>。</p></noscript>
</body>
</html>
