<?php
/**
 * Cloudreve 单点登录票据消费端。
 * 此文件经 cloudreve.naujtrats.xyz/cr_login.php 提供，因此可以在 Cloudreve
 * 同源 localStorage 中写入 v4.18 的完整 cloudreve_session。
 */

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');

function renderCloudreveTicketError(string $message, int $status = 410): never {
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    $safe = htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    echo '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>云盘登录链接已失效</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fb;color:#334155;font:15px system-ui,sans-serif}.box{max-width:420px;padding:28px;border-radius:16px;background:#fff;box-shadow:0 12px 35px #0f172a18;text-align:center}a{display:inline-block;margin-top:16px;padding:9px 16px;border-radius:9px;background:#1976d2;color:#fff;text-decoration:none}</style></head>'
        . '<body><main class="box"><h2>云盘登录链接已失效</h2><p>' . $safe . '</p><a href="https://www.naujtrats.xyz/">返回主页并重新打开云盘</a></main></body></html>';
    exit;
}

$ticket = strtolower(trim((string)($_POST['t'] ?? $_GET['t'] ?? '')));
if (!preg_match('/^[a-f0-9]{64}$/', $ticket)) {
    renderCloudreveTicketError('链接格式无效，请从 OneAPIChat 或网站主页重新点击云盘入口。', 400);
}

/** 原子消费票据，避免同一票据并发使用两次。 */
function consumeCloudreveTicket(string $path): ?array {
    if (!is_file($path)) return null;
    $claimed = $path . '.consume.' . getmypid() . '.' . bin2hex(random_bytes(4));
    if (!@rename($path, $claimed)) return null;
    try {
        $data = json_decode((string)@file_get_contents($claimed), true);
        return is_array($data) ? $data : null;
    } finally {
        @unlink($claimed);
    }
}

$session = null;
$ssoPayload = consumeCloudreveTicket('/tmp/cloudreve_sso_' . $ticket . '.json');
if ($ssoPayload && (int)($ssoPayload['expires_at'] ?? 0) >= time()) {
    $session = $ssoPayload['session'] ?? null;
}

// 兼容登录页在认证成功后生成的旧式一次性凭据票据。
if (!$session) {
    $creds = consumeCloudreveTicket('/tmp/cloudreve_login_' . $ticket . '.json');
    $email = trim((string)($creds['email'] ?? ''));
    $password = (string)($creds['password'] ?? '');
    if ($email !== '' && $password !== '') {
        if (strlen($password) < 6) $password = 'cr_' . substr(base64_encode($password), 0, 14);
        $ch = curl_init('http://127.0.0.1:5212/api/v4/session/token');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode(['email' => $email, 'password' => $password]),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Host: cloudreve.naujtrats.xyz'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 5,
        ]);
        $response = json_decode((string)curl_exec($ch), true);
        curl_close($ch);
        if (($response['code'] ?? -1) === 0) $session = $response['data'] ?? null;
    }
}

if (!is_array($session)
    || empty($session['user']['id'])
    || empty($session['token']['access_token'])
    || empty($session['token']['refresh_token'])
    || empty($session['token']['access_expires'])
    || empty($session['token']['refresh_expires'])) {
    renderCloudreveTicketError('一次性链接已使用或超过 5 分钟，请关闭本页后重新点击云盘入口。');
}

$nonce = base64_encode(random_bytes(18));
header("Content-Security-Policy: default-src 'none'; script-src 'nonce-{$nonce}'; style-src 'nonce-{$nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
header('Content-Type: text/html; charset=utf-8');
$sessionJson = json_encode($session, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
?>
<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>正在登录云盘</title>
    <style nonce="<?= htmlspecialchars($nonce, ENT_QUOTES, 'UTF-8') ?>">
        body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fb;color:#475569;font:14px system-ui,sans-serif}
        .box{text-align:center}.dot{display:inline-block;width:8px;height:8px;margin:0 3px;border-radius:50%;background:#1976d2;animation:p 1s infinite alternate}.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}@keyframes p{to{opacity:.25;transform:translateY(-5px)}}
    </style>
</head>
<body><div class="box">正在安全登录 Cloudreve<br><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
<script nonce="<?= htmlspecialchars($nonce, ENT_QUOTES, 'UTF-8') ?>">
(() => {
    try {
        const incoming = <?= $sessionJson ?>;
        let state = { sessions: {}, anonymousSettings: {} };
        try {
            const cached = JSON.parse(localStorage.getItem('cloudreve_session') || 'null');
            if (cached && typeof cached === 'object') state = cached;
        } catch (_) {}
        if (!state.sessions || typeof state.sessions !== 'object') state.sessions = {};
        if (!state.anonymousSettings || typeof state.anonymousSettings !== 'object') state.anonymousSettings = {};
        const uid = String(incoming.user.id);
        const previousSettings = state.sessions[uid] && state.sessions[uid].settings || {};
        state.sessions[uid] = Object.assign({}, incoming, { settings: previousSettings, signedOut: false });
        state.current = uid;
        localStorage.setItem('cloudreve_session', JSON.stringify(state));
        location.replace('/home');
    } catch (_) {
        location.replace('/session?reason=sso_failed');
    }
})();
</script></body></html>
