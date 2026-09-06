<?php
/**
 * OneAPIChat API v1 — Search Proxy (auto-config)
 *
 * POST /oneapichat/api/v1/search
 *
 * 自动从用户配置读取搜索引擎和 API Key，无需客户端传递。
 * MCP Server (web_search) 和第三方客户端统一入口。
 *
 * 请求: { "query": "搜索词", "max_results": 5 }
 * 响应: { "results": [...], "status": "ok", "provider": "tavily" }
 */

require_once __DIR__ . '/../init.php';
require_once __DIR__ . '/../auth_helpers.php';
setApiCorsHeaders();
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204); exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'Use POST']); exit;
}

// ── 读取请求 ──
$req = json_decode(file_get_contents('php://input'), true);
$query = trim($req['query'] ?? '');
$maxResults = intval($req['max_results'] ?? 5);
if (!$query) { echo json_encode(['error' => 'query required', 'results' => [], 'status' => 'error']); exit; }
$maxResults = min(max($maxResults, 1), 10);

// ── 读取用户搜索配置 ──
$userId = 'u_54e32386ecda87e63c7be2b5'; // 默认用户（单用户服务器）
$provider = 'tavily';
$apiKey = '';

$dbPath = ONECHAT_ROOT . '/users/oneapichat.db';
if (file_exists($dbPath)) {
    try {
        $pdo = new PDO("sqlite:$dbPath");
        $stmt = $pdo->prepare("SELECT config_json FROM user_config WHERE user_id = ?");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            $config = json_decode($row['config_json'], true);
            $provider = strtolower((string)($config['searchProvider'] ?? 'tavily'));
            // 按当前引擎读取专属 Key，避免 Brave 错拿 Tavily Key。
            $providerKeyMap = [
                'brave' => 'searchApiKeyBrave',
                'google' => 'searchApiKeyGoogle',
                'tavily' => 'searchApiKeyTavily',
                'deepseek' => 'searchApiKeyDeepSeek',
            ];
            $providerKeyName = $providerKeyMap[$provider] ?? '';
            $apiKey = $providerKeyName ? (string)($config[$providerKeyName] ?? '') : '';
            if (!$apiKey) $apiKey = (string)($config['searchApiKey'] ?? '');
            // 解密 v2: 格式
            if (str_starts_with($apiKey, 'v2:')) {
                $apiKey = _decrypt_search_key($apiKey);
            }
        }
    } catch (Exception $e) {}
}

if (!$apiKey) {
    echo json_encode(['error' => '搜索 API Key 未配置', 'results' => [], 'status' => 'error', 'provider' => $provider]); exit;
}

// ── 执行搜索 ──
$results = [];
$status = 'error';

switch ($provider) {
    case 'tavily':
        $results = searchTavily($query, $maxResults, $apiKey);
        $status = $results ? 'ok' : 'error';
        break;
    case 'brave':
        $results = searchBrave($query, $maxResults, $apiKey);
        $status = $results ? 'ok' : 'error';
        break;
    case 'google':
        $results = searchGoogle($query, $maxResults, $apiKey);
        $status = $results ? 'ok' : 'error';
        break;
    default:
        // 未知 provider 回退 tavily
        $results = searchTavily($query, $maxResults, $apiKey);
        $status = $results ? 'ok' : 'error';
        $provider = 'tavily (fallback)';
}

echo json_encode(['results' => $results, 'status' => $status, 'provider' => $provider], JSON_UNESCAPED_UNICODE);
exit;

// ============================================================
// 搜索引擎实现 (支持项目代理)
// ============================================================

function _search_proxy_curl(string $url, string $method = 'GET', array $headers = [], ?string $body = null): ?string
{
    $proxies = ['http://127.0.0.1:1080', 'http://192.168.195.226:8890', ''];
    foreach ($proxies as $proxy) {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 4,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_ENCODING => '', // 支持 gzip
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_HTTPHEADER => $headers,
        ];
        if (strtoupper($method) === 'POST') {
            $opts[CURLOPT_POST] = true;
            if ($body !== null) $opts[CURLOPT_POSTFIELDS] = $body;
        }
        if ($proxy) {
            $opts[CURLOPT_PROXY] = $proxy;
        }
        curl_setopt_array($ch, $opts);
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($resp !== false && $code >= 200 && $code < 500) {
            return $resp;
        }
    }
    return null;
}

function searchTavily(string $query, int $limit, string $apiKey): array
{
    $body = json_encode(['api_key' => $apiKey, 'query' => $query, 'search_depth' => 'basic', 'max_results' => $limit]);
    $resp = _search_proxy_curl('https://api.tavily.com/search', 'POST', [
        'Content-Type: application/json',
        'Accept: application/json'
    ], $body);
    if (!$resp) return [];
    $data = json_decode($resp, true);
    if (empty($data['results'])) return [];
    return array_map(fn($r) => [
        'title' => $r['title'] ?? '',
        'url' => $r['url'] ?? '',
        'content' => ($r['content'] ?? '') . (isset($r['raw_content']) ? "\n" . substr($r['raw_content'], 0, 500) : ''),
    ], array_slice($data['results'], 0, $limit));
}

function searchBrave(string $query, int $limit, string $apiKey): array
{
    $url = 'https://api.search.brave.com/res/v1/web/search?q=' . urlencode($query) . '&count=' . min(max($limit, 1), 20) . '&safesearch=off&text_decorations=0';
    $resp = _search_proxy_curl($url, 'GET', [
        'Accept: application/json',
        'Accept-Encoding: gzip',
        'X-Subscription-Token: ' . $apiKey,
    ]);
    if (!$resp) return [];
    $data = json_decode($resp, true);
    $webResults = $data['web']['results'] ?? [];
    return array_map(function($r) {
        $content = $r['description'] ?? '';
        if (!empty($r['extra_snippets']) && is_array($r['extra_snippets'])) {
            $content .= "\n" . implode("\n", $r['extra_snippets']);
        }
        return [
            'title' => $r['title'] ?? '',
            'url' => $r['url'] ?? '',
            'content' => $content,
        ];
    }, array_slice($webResults, 0, $limit));
}

function searchGoogle(string $query, int $limit, string $apiKey): array
{
    // Google Custom Search JSON API
    $cx = ''; // 需要搜索引擎 ID
    $url = 'https://www.googleapis.com/customsearch/v1?key=' . urlencode($apiKey) . '&q=' . urlencode($query) . '&num=' . $limit;
    if ($cx) $url .= '&cx=' . urlencode($cx);
    $resp = _search_proxy_curl($url, 'GET', ['Accept: application/json']);
    if (!$resp) return [];
    $data = json_decode($resp, true);
    $items = $data['items'] ?? [];
    return array_map(fn($r) => [
        'title' => $r['title'] ?? '',
        'url' => $r['link'] ?? '',
        'content' => $r['snippet'] ?? '',
    ], array_slice($items, 0, $limit));
}

/**
 * 解密 v2: 格式的配置 key
 */
function _decrypt_search_key(string $encoded): string
{
    if (!str_starts_with($encoded, 'v2:')) return $encoded;
    $raw = base64_decode(substr($encoded, 3));
    if ($raw === false || strlen($raw) < 28) return $encoded;
    $iv = substr($raw, 0, 12);
    $data = substr($raw, 12);
    $tagLen = 16;
    $ct = substr($data, 0, -$tagLen);
    $tag = substr($data, -$tagLen);
    $encKey = getEncryptionKey();
    $aesKey = hash_pbkdf2('sha256', $encKey, 'oneapichat-aes-v2', 100000, 32, true);
    $result = openssl_decrypt($ct, 'aes-256-gcm', $aesKey, OPENSSL_RAW_DATA, $iv, $tag);
    return $result !== false ? $result : $encoded;
}
