<?php
/**
 * Cloudreve 自动登录跳转 v2
 * GET /oneapichat/cloudreve_login.php?t=临时token
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

// 获取 Cloudreve JWT token
$ch = curl_init('http://127.0.0.1:5212/api/v4/session/token');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['email' => $email, 'password' => $password]),
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Host: cloudreve.naujtrats.xyz'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 5,
]);
$data = json_decode(curl_exec($ch), true);
curl_close($ch);

if (($data['code'] ?? 1) !== 0) { header('Location: https://cloudreve.naujtrats.xyz'); exit; }

$accessToken = $data['data']['token']['access_token'] ?? '';
$refreshToken = $data['data']['token']['refresh_token'] ?? '';

// ★ 方案：用一段HTML做bridge — 设置localStorage/token后跳转
header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>跳转中...</title></head>
<body style="background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;">
<div style="text-align:center">
  <div style="font-size:48px;margin-bottom:16px;">☁️</div>
  <p>正在进入 Cloudreve...</p>
</div>
<script>
(function(){
  var at = <?=json_encode($accessToken)?>;
  var rt = <?=json_encode($refreshToken)?>;
  // 直接跳转云盘，带 token
  var url = 'https://cloudreve.naujtrats.xyz/?cr_login=' + encodeURIComponent(at);
  // 同时存 sessionStorage（Cloudreve Nginx 注入的 JS 会用它）
  try {
    sessionStorage.setItem('cloudreve_access_token', at);
    localStorage.setItem('cloudreve_session', JSON.stringify({access_token:at, refresh_token:rt}));
  } catch(e) {}
  location.replace(url);
})();
</script>
</body></html>
