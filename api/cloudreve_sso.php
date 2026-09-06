<?php
/**
 * OneAPIChat -> Cloudreve 一次性 SSO 票据。
 *
 * 浏览器只提交当前 OneAPIChat Bearer token；服务器完成用户映射和 Cloudreve
 * 密码登录，然后签发 5 分钟、单次使用的票据。主项目 token、Cloudreve 密码
 * 和 Cloudreve token 都不会出现在 URL 中。
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Auth-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => '仅支持 POST']);
    exit;
}

require_once __DIR__ . '/cloudreve_lib.php';

$authToken = extractBearerToken();
if ($authToken === '' && function_exists('getallheaders')) {
    $headers = getallheaders();
    $authToken = trim((string)($headers['Auth-Token'] ?? $headers['auth-token'] ?? ''));
}
$userId = verifyAuthToken($authToken);
if (!$userId) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => '主项目登录已过期，请重新登录']);
    exit;
}

$account = cr_ensureAccount($userId);
if (empty($account['success']) || empty($account['email']) || empty($account['password'])) {
    http_response_code(409);
    echo json_encode([
        'success' => false,
        'error' => $account['error'] ?? '云盘账号尚未同步，请退出并重新登录一次主项目',
        'reauth_required' => true,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// 必须重新走官方密码登录以取得完整 access + refresh token 对；仅 access token
// 无法构造 Cloudreve 4.18 前端所需的可续期会话。
$login = cr_post($GLOBALS['apiBase'] . '/session/token', [
    'email' => $account['email'],
    'password' => $account['password'],
]);
$session = $login['data'] ?? null;
if (($login['code'] ?? -1) !== 0
    || !is_array($session)
    || empty($session['user']['id'])
    || empty($session['token']['access_token'])
    || empty($session['token']['refresh_token'])) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Cloudreve 会话签发失败，请重新登录一次主项目']);
    exit;
}

$ticket = bin2hex(random_bytes(32));
$ticketPath = '/tmp/cloudreve_sso_' . $ticket . '.json';
$written = cr_writeCredentialFile($ticketPath, [
    'expires_at' => time() + 300,
    'oneapichat_user' => $userId,
    'session' => $session,
]);
if (!$written) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => '无法创建云盘单点登录票据']);
    exit;
}

// 清理超过 10 分钟的遗留票据；票据本身仍会在消费端检查 expires_at。
foreach (glob('/tmp/cloudreve_sso_*.json') ?: [] as $oldTicket) {
    if ($oldTicket !== $ticketPath && time() - (int)@filemtime($oldTicket) > 600) @unlink($oldTicket);
}

// 动态获取 Cloudreve 站点 URL，优先读取环境变量与请求 Host
$proto = (($_SERVER['HTTPS'] ?? 'off') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') ? 'https://' : 'http://';
$httpHost = $_SERVER['HTTP_HOST'] ?? '';
$crSiteUrl = getenv('CLOUDREVE_SITE_URL') ?: getenv('CLOUDREVE_URL') ?: '';
if ($crSiteUrl === '') {
    // 仅当当前请求本身就来自 cloudreve 或 pan 域名/子域时复用当前 Host，否则固定指向权威独立云盘域名
    if (strpos($httpHost, 'cloudreve.') !== false || strpos($httpHost, 'pan.') !== false) {
        $crSiteUrl = $proto . $httpHost;
    } else {
        $crSiteUrl = 'https://cloudreve.naujtrats.xyz';
    }
}
$ssoActionUrl = rtrim($crSiteUrl, '/') . '/api/oneapichat-sso';

echo json_encode([
    'success' => true,
    'url' => $ssoActionUrl . '?t=' . $ticket,
    // 前端优先用 POST 导航，避免 Cloudreve PWA Service Worker 把 GET 票据
    // 路由当作 SPA 页面拦截并显示“页面不存在”。url 仅保留旧客户端兼容。
    'action_url' => 'https://cloudreve.naujtrats.xyz/api/oneapichat-sso',
    'ticket' => $ticket,
    'expires_in' => 300,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
