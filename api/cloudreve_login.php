<?php
/**
 * Cloudreve 登录桥接 v9 — 预填邮箱
 * Cloudreve v4 使用 WebAuthn，无法完全免交互自动登录。
 * 此页面将你重定向到 Cloudreve 登录页，自动填入邮箱。
 */
$tmpToken = $_GET['t'] ?? '';
$email = '';

if ($tmpToken) {
    $tmpFile = "/tmp/cloudreve_login_" . preg_replace('/[^a-f0-9]/', '', $tmpToken) . ".json";
    if (file_exists($tmpFile)) {
        $creds = json_decode(file_get_contents($tmpFile), true);
        @unlink($tmpFile);
        $email = $creds['email'] ?? '';
        // 同步确保账号存在于 Cloudreve（异步，不阻塞跳转）
        if ($email && ($creds['password'] ?? '')) {
            // 触发一次 token 验证确认账号密码正确
            $ch = curl_init('http://127.0.0.1:5212/api/v4/session/token');
            $pw = $creds['password'];
            if (strlen($pw) < 6) $pw = 'cr_' . substr(base64_encode($pw), 0, 14);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode(['email' => $email, 'password' => $pw]),
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3,
            ]);
            curl_exec($ch);
            curl_close($ch);
        }
    }
}

// 跳转到 Cloudreve 登录页，带预填邮箱
$loginUrl = 'https://cloudreve.naujtrats.xyz/login';
if ($email) {
    $loginUrl .= '?email=' . urlencode($email);
}
header("Location: $loginUrl");
exit;

