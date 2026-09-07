<?php
/**
 * OneAPIChat — Minimal OAuth Server for MCP
 *
 * 为 OpenClaw / Claude Code / Cursor 等 MCP 客户端提供 OAuth 发现端点。
 * 个人服务器使用静态 Token（无需完整 OAuth 授权码流程）。
 *
 * 端点:
 *   GET  /.well-known/oauth-authorization-server  → OAuth 元数据
 *   POST /oneapichat/oauth/token                   → 获取 Token
 *   GET  /oneapichat/oauth/authorize               → 授权端点（直接放行）
 */

require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';

setApiCorsHeaders();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$uri = $_SERVER['REQUEST_URI'] ?? '';
// ★ 剥离 query string — REQUEST_URI 包含 ?xxx=yyy, 正则 $ 锚点会匹配失败
$path = parse_url($uri, PHP_URL_PATH) ?: $uri;
$method = $_SERVER['REQUEST_METHOD'];

// ── 1. OAuth 发现端点 ──
if (preg_match('#/\.well-known/(oauth-authorization-server|openid-configuration)#', $path)) {
    $base = 'https://naujtrats.xyz/oneapichat/oauth';
    echo json_encode([
        'issuer'                                => 'https://naujtrats.xyz/oneapichat',
        'authorization_endpoint'                => $base . '/authorize',
        'token_endpoint'                        => $base . '/token',
        'registration_endpoint'                 => $base . '/register',
        'scopes_supported'                      => ['mcp', 'offline_access'],
        'response_types_supported'              => ['code', 'token'],
        'grant_types_supported'                 => ['authorization_code', 'client_credentials', 'refresh_token'],
        'token_endpoint_auth_methods_supported' => ['client_secret_basic', 'client_secret_post', 'none'],
        'code_challenge_methods_supported'      => ['S256'],
        'service_documentation'                 => 'https://naujtrats.xyz/oneapichat/API.md',
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ── 2. 客户端注册端点 (Dynamic Client Registration) ──
if (preg_match('#/oauth/register$#', $path) && $method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    $clientId = 'mcp_' . bin2hex(random_bytes(16));
    echo json_encode([
        'client_id'     => $clientId,
        'client_name'   => ($body['client_name'] ?? 'mcp-client'),
        'redirect_uris' => ($body['redirect_uris'] ?? []),
        'grant_types'   => ['authorization_code', 'client_credentials', 'refresh_token'],
        'scope'         => 'mcp',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── 3. Token 端点 ──
if (preg_match('#/oauth/token$#', $path) && $method === 'POST') {
    // 个人服务器: 直接签发 Token（无需验证 client，信任本地连接）
    // 支持 grant_type: client_credentials, authorization_code, refresh_token
    $grantType = $_POST['grant_type'] ?? '';
    $code = $_POST['code'] ?? '';

    // 生成 Token (格式: oat-<64hex>)
    $token = 'oat-' . bin2hex(random_bytes(32));

    // 可选: 存储 token 到 session (用于 MCP 端点验证)
    // 个人服务器简化处理: token 格式本身即可信

    echo json_encode([
        'access_token'  => $token,
        'token_type'    => 'Bearer',
        'expires_in'    => 86400 * 30,  // 30 天
        'scope'         => 'mcp',
        'refresh_token' => 'ort-' . bin2hex(random_bytes(32)),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── 4. 授权端点 (Authorization Code 流程) ──
if (preg_match('#/oauth/authorize$#', $path)) {
    // 个人服务器: 直接生成 code 并重定向回 redirect_uri
    $redirectUri = $_GET['redirect_uri'] ?? '';
    $state = $_GET['state'] ?? '';
    $code = bin2hex(random_bytes(16));

    if ($redirectUri) {
        $sep = (strpos($redirectUri, '?') === false) ? '?' : '&';
        header("Location: {$redirectUri}{$sep}code={$code}&state={$state}");
        exit;
    }
    // 无 redirect_uri 时直接返回 code
    echo json_encode(['code' => $code, 'state' => $state], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── 未知端点 ──
http_response_code(404);
echo json_encode(['error' => 'Not found', 'uri' => $uri]);
