<?php
/**
 * OneAPIChat API v1 — Tool Execution
 *
 * POST /oneapichat/api/v1/tools/call
 *
 * 执行 OneAPIChat 全部 69 个 MCP 工具。
 * 4 个特殊工具 (web_search/web_fetch/generate_image/engine_push) 有 PHP 原生实现，
 * 其余全部透明代理到 MCP Server (Node.js port 18788)。
 */

require_once __DIR__ . '/../../init.php';
require_once __DIR__ . '/../../auth_helpers.php';
setApiCorsHeaders();
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204); exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed, use POST']);
    exit;
}

// ── 认证 ──
$bearerToken = extractBearerToken();
$userId = null;
if ($bearerToken) {
    $userId = verifyApiKey($bearerToken) ?: verifyAuthToken($bearerToken);
}
if (!$userId) {
    http_response_code(401);
    echo json_encode(['error' => ['message' => 'Invalid API key', 'type' => 'authentication_error', 'code' => 'INVALID_API_KEY']]);
    exit;
}

$rawBody = file_get_contents('php://input');
$body = json_decode($rawBody, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON: ' . json_last_error_msg()]);
    exit;
}

$toolName = $body['name'] ?? '';
$args = $body['arguments'] ?? [];

if (empty($toolName)) {
    http_response_code(400);
    echo json_encode(['error' => '"name" is required']);
    exit;
}

// PHP 7.x polyfill
if (!function_exists('str_starts_with')) { function str_starts_with($h, $n) { return strncmp($h, $n, strlen($n)) === 0; } }
if (str_starts_with($toolName, 'mmx_')) {
    http_response_code(404);
    echo json_encode(['error' => ['message' => 'MMX tools have been removed', 'type' => 'invalid_request_error', 'code' => 'TOOL_REMOVED']]);
    exit;
}

$userIdSafe = preg_replace('/[^a-zA-Z0-9_-]/', '', $userId);

// Load user config for search/image API keys
// ★ DB 优先 (与 chat.php get_config 一致), JSON 文件作为备份
$userConfig = [];
$dbPath = ONECHAT_ROOT . '/users/oneapichat.db';
try {
    $pdo = new PDO("sqlite:$dbPath");
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $stmt = $pdo->prepare("SELECT config_json FROM user_config WHERE user_id = ?");
    $stmt->execute([$userIdSafe]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row) { $cfg = @json_decode($row['config_json'], true); if (is_array($cfg)) $userConfig = $cfg; }
} catch (Exception $e) {}
// DB 无配置时回退到 JSON 文件
if (empty($userConfig)) {
    $configPath = ONECHAT_ROOT . '/chat_data/config_user_' . $userIdSafe . '.json';
    if (file_exists($configPath)) {
        $raw = @file_get_contents($configPath);
        if ($raw !== false) { $cfg = @json_decode($raw, true); if (is_array($cfg)) $userConfig = $cfg; }
    }
}
if (empty($userConfig)) {
    $altPath = ONECHAT_ROOT . '/users/' . $userIdSafe . '_config.json';
    if (file_exists($altPath)) {
        $raw = @file_get_contents($altPath);
        if ($raw !== false) { $cfg = @json_decode($raw, true); if (is_array($cfg)) $userConfig = $cfg; }
    }
}

// ── 解密 v2 AES-256-GCM 加密的 API Key ──
function _decrypt_config_key(string $encoded): string {
    if (empty($encoded)) return '';
    if (str_starts_with($encoded, 'v2:')) {
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
    $decoded = base64_decode($encoded, true);
    if ($decoded !== false && strlen($decoded) > 0) {
        $encKey = getEncryptionKey();
        $result = '';
        for ($i = 0; $i < strlen($decoded); $i++) {
            $result .= chr(ord($decoded[$i]) ^ ord($encKey[$i % strlen($encKey)]));
        }
        if (preg_match('/^(sk-|tvly-|oac-|AIza|nvapi-)/', $result)) return $result;
    }
    return $encoded;
}

// ═══════════════════════════════════════════════════════
//  4 个特殊工具 — PHP 原生实现
// ═══════════════════════════════════════════════════════

if ($toolName === 'web_search') {
    exec_web_search($args, $userConfig);
    exit;
}
if ($toolName === 'web_fetch') {
    exec_web_fetch($args);
    exit;
}
if ($toolName === 'generate_image') {
    exec_generate_image($args, $userConfig);
    exit;
}
if ($toolName === 'engine_push') {
    exec_push_file($args);
    exit;
}

// ═══════════════════════════════════════════════════════
//  其余 65 个工具 — 透明代理到 MCP Server
// ═══════════════════════════════════════════════════════

// B站工具走专用端点 (Python bridge), 其余走通用 MCP
$mcpEndpoint = str_starts_with($toolName, 'bilibili_') ? '/mcp/bilibili/tools/call' : '/mcp/api/tools/call';

// 长时间运行的工具 (登录/轮询/视频) 需要更长的超时
$longRunningTools = ['chaoxing_qr_login', 'bilibili_qr_login', 'video_edit', 'generate_ppt', 'generate_docx', 'generate_xlsx', 'generate_pdf'];
$timeout = in_array($toolName, $longRunningTools) ? 300 : 120;

// ★ 2026-08-03 云盘全面结合: 透传用户上下文 (video_download/bili_download 等下载完成后自动同步到该用户云盘)
if ($userId && in_array($toolName, ['video_download', 'bili_download', 'bili_download_dash', 'netdisk_download', 'netdisk_parse_and_download'])) {
    $args['user_id'] = $userId;
}

$mcpCtx = stream_context_create(['http' => [
    'method' => 'POST',
    'header' => "Content-Type: application/json\r\n",
    'content' => json_encode(['name' => $toolName, 'arguments' => $args], JSON_UNESCAPED_UNICODE),
    'timeout' => $timeout,
    'ignore_errors' => true,
]]);

// 抑制 PHP 警告 (MCP 服务偶尔重启)
$mcpResp = @file_get_contents('http://127.0.0.1:18788' . $mcpEndpoint, false, $mcpCtx);

if ($mcpResp === false) {
    http_response_code(502);
    echo json_encode(['error' => 'MCP service unreachable — tool: ' . $toolName]);
    exit;
}

$mcpData = json_decode($mcpResp, true);
if (isset($mcpData['error'])) {
    // 透传 MCP 错误
    echo json_encode($mcpData);
} else {
    // 统一返回格式: { result: ... }
    $result = $mcpData['result'] ?? $mcpData;
    echo json_encode(['result' => $result], JSON_UNESCAPED_UNICODE);
}
exit;


// ═══════════════════════════════════════════════════════
//  web_search — 配置优先：Tavily / Brave（无可用凭证时明确失败）
// ═══════════════════════════════════════════════════════
function exec_web_search(array $args, array $config): void {
    $query = trim($args['query'] ?? '');
    $maxResults = min(intval($args['max_results'] ?? 5), 10);

    if (empty($query)) {
        http_response_code(400);
        echo json_encode(['error' => 'query is required']);
        exit;
    }

    $searchProvider = $config['searchProvider'] ?? 'tavily';
    // 历史配置中的 DuckDuckGo 已下线，避免旧会话继续走失效网络路径。
    if ($searchProvider === 'duckduckgo' || $searchProvider === 'google') $searchProvider = 'tavily';

    $proxies = ['http://127.0.0.1:1080', 'http://192.168.195.226:8890', ''];

    // Tavily
    if ($searchProvider === 'tavily' || $searchProvider === 'auto') {
        $searchKey = _decrypt_config_key($config['searchApiKeyTavily'] ?? $config['searchApiKey'] ?? '');
        if (!empty($searchKey)) {
            $body = json_encode(['api_key' => $searchKey, 'query' => $query, 'search_depth' => 'basic', 'max_results' => $maxResults]);
            foreach ($proxies as $proxy) {
                $ch = curl_init('https://api.tavily.com/search');
                $opts = [
                    CURLOPT_POST => true,
                    CURLOPT_POSTFIELDS => $body,
                    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT => 12,
                    CURLOPT_CONNECTTIMEOUT => 5,
                    CURLOPT_ENCODING => '',
                    CURLOPT_SSL_VERIFYPEER => false,
                    CURLOPT_SSL_VERIFYHOST => false,
                ];
                if ($proxy) $opts[CURLOPT_PROXY] = $proxy;
                curl_setopt_array($ch, $opts);
                $resp = curl_exec($ch);
                $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);
                if ($resp !== false && $code >= 200 && $code < 400) {
                    $data = json_decode($resp, true);
                    if ($data && isset($data['results'])) {
                        echo json_encode(['results' => $data['results'], 'status' => 'ok', 'provider' => 'tavily']);
                        return;
                    }
                }
            }
        }
    }

    // Brave
    if ($searchProvider === 'brave') {
        $searchKey = _decrypt_config_key($config['searchApiKeyBrave'] ?? $config['searchApiKey'] ?? '');
        if (!empty($searchKey)) {
            $braveUrl = 'https://api.search.brave.com/res/v1/web/search?q=' . urlencode($query) . '&count=' . min(max($maxResults, 1), 20) . '&safesearch=off&text_decorations=0';
            foreach ($proxies as $proxy) {
                $ch = curl_init($braveUrl);
                $opts = [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_FOLLOWLOCATION => true,
                    CURLOPT_TIMEOUT => 12,
                    CURLOPT_CONNECTTIMEOUT => 5,
                    CURLOPT_ENCODING => '',
                    CURLOPT_SSL_VERIFYPEER => false,
                    CURLOPT_SSL_VERIFYHOST => false,
                    CURLOPT_HTTPHEADER => [
                        'Accept: application/json',
                        'Accept-Encoding: gzip',
                        'X-Subscription-Token: ' . $searchKey
                    ],
                ];
                if ($proxy) $opts[CURLOPT_PROXY] = $proxy;
                curl_setopt_array($ch, $opts);
                $resp = curl_exec($ch);
                $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);
                if ($resp !== false && $code >= 200 && $code < 400) {
                    $data = json_decode($resp, true);
                    if ($data && isset($data['web']['results'])) {
                        $formattedResults = array_map(function($r) {
                            $snippet = $r['description'] ?? '';
                            if (!empty($r['extra_snippets']) && is_array($r['extra_snippets'])) {
                                $snippet .= "\n" . implode("\n", $r['extra_snippets']);
                            }
                            return [
                                'title' => $r['title'] ?? '',
                                'url' => $r['url'] ?? '',
                                'content' => $snippet,
                                'description' => $snippet
                            ];
                        }, $data['web']['results']);
                        echo json_encode(['results' => $formattedResults, 'status' => 'ok', 'provider' => 'brave']);
                        return;
                    }
                }
            }
        }
    }

    echo json_encode(['results' => [], 'status' => 'error', 'error' => '当前搜索服务不可用，请检查 Tavily 或 Brave API Key。']);
}


// ═══════════════════════════════════════════════════════
//  web_fetch — 抓取网页 + 文本提取
// ═══════════════════════════════════════════════════════
function exec_web_fetch(array $args): void {
    $urls = $args['urls'] ?? ($args['url'] ? [$args['url']] : []);
    if (empty($urls) || !is_array($urls)) {
        http_response_code(400);
        echo json_encode(['error' => 'urls (array) or url (string) is required']);
        exit;
    }

    $results = [];
    foreach (array_slice($urls, 0, 5) as $u) {
        $u = trim($u);
        if (!preg_match('#^https?://#', $u)) {
            $results[$u] = ['error' => 'Invalid URL'];
            continue;
        }
        // ★ 跳过图片/视频/二进制文件
        if (preg_match('/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|mp4|webm|avi|mov|mp3|wav|pdf|zip|docx?|xlsx?|pptx?)(\?|$)/i', $u)) {
            $results[$u] = ['error' => 'Binary/image file — use analyze_image for images. URL: ' . $u, 'url' => $u];
            continue;
        }
        $resp = @file_get_contents($u, false, stream_context_create(['http' => [
            'timeout' => 15, 'ignore_errors' => true,
            'header' => "User-Agent: Mozilla/5.0 (compatible; OneAPIChat/1.0)\r\nAccept: text/html\r\n",
        ]]));
        if ($resp === false) {
            $results[$u] = ['error' => 'Fetch failed'];
        } else {
            $text = preg_replace('/<script[^>]*>[\s\S]*?<\/script>/i', '', $resp);
            $text = preg_replace('/<style[^>]*>[\s\S]*?<\/style>/i', '', $text);
            $text = strip_tags($text);
            $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $text = preg_replace('/\s+/', ' ', trim($text));
            if (mb_strlen($text) > 8000) $text = mb_substr($text, 0, 8000) . '...[truncated]';
            $results[$u] = ['content' => $text, 'length' => strlen($text)];
        }
    }
    echo json_encode(['results' => $results, 'status' => 'ok']);
}


// ═══════════════════════════════════════════════════════
//  generate_image — 多提供商分发 (MiniMax / OpenAI / xAI / Custom)
// ═══════════════════════════════════════════════════════
function exec_generate_image(array $args, array $config): void {
    $prompt = trim($args['prompt'] ?? '');
    if (empty($prompt)) {
        http_response_code(400);
        echo json_encode(['error' => 'prompt is required']);
        exit;
    }

    // ★ 读取用户配置的图像提供商 (默认 MiniMax 兼容旧行为)
    $provider = strtolower($config['imageProvider'] ?? 'minimax');

    if ($provider === 'openrouter') {
        _exec_generate_image_openai_compat('openrouter', $prompt, $config, $args);
        return;
    }
    if ($provider === 'openai') {
        _exec_generate_image_openai_compat('openai', $prompt, $config, $args);
        return;
    }
    if ($provider === 'custom') {
        _exec_generate_image_openai_compat('custom', $prompt, $config, $args);
        return;
    }

    // ===== 默认: MiniMax (保留原有行为 + CLI 回退) =====
    $imageKey = _decrypt_config_key($config['imageApiKey'] ?? '');
    $mmxConfig = @json_decode(@file_get_contents(ONECHAT_ROOT . '/config/.mmx_config.json'), true);
    $mmxKey = $imageKey ?: ($mmxConfig['api_key'] ?? '');

    if (empty($mmxKey)) {
        http_response_code(400);
        echo json_encode(['error' => 'MiniMax API key not configured']);
        exit;
    }

    // 直接调用 MiniMax API
    $ch = curl_init('https://api.minimaxi.com/v1/image_generation');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['model' => 'image-01', 'prompt' => $prompt, 'n' => 1, 'response_format' => 'url']),
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $mmxKey, 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 120,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if (!$err && $resp) {
        $data = json_decode($resp, true);
        if ($data && !empty($data['data']['image_urls'])) {
            echo json_encode(['images' => $data['data']['image_urls'], 'status' => 'ok', 'provider' => 'minimax']);
            return;
        }
    }

    // CLI 回退
    exec_generate_image_cli($prompt, $mmxKey);
}

/**
 * OpenAI 兼容生图 (OpenRouter / OpenAI / Custom)
 * xAI (Grok) 也走此路径, 自动省略 size/quality 参数
 */
function _exec_generate_image_openai_compat(string $provider, string $prompt, array $config, array $args): void {
    // 提供商 → 配置键映射
    $keyMap = [
        'openrouter' => ['key' => 'imageApiKeyOpenrouter', 'url' => 'imageBaseUrlOpenrouter', 'model' => 'imageModel_openrouter', 'defaultUrl' => 'https://openrouter.ai/api/v1', 'defaultModel' => 'openai/gpt-5.4-image-2'],
        'openai'     => ['key' => 'imageApiKeyOpenai',     'url' => 'imageBaseUrlOpenai',     'model' => 'imageModel_openai',     'defaultUrl' => 'https://api.openai.com/v1',        'defaultModel' => 'gpt-image-1'],
        'custom'     => ['key' => 'imageApiKeyCustom',     'url' => 'imageBaseUrlCustom',     'model' => 'imageModel_custom',     'defaultUrl' => '',                              'defaultModel' => ''],
    ];

    if (!isset($keyMap[$provider])) {
        http_response_code(400);
        echo json_encode(['error' => 'Unknown image provider: ' . $provider]);
        return;
    }
    $km = $keyMap[$provider];

    $apiKey = _decrypt_config_key($config[$km['key']] ?? '');
    $baseUrl = rtrim($config[$km['url']] ?? $km['defaultUrl'], '/');
    $model = trim($config[$km['model']] ?? '') ?: $km['defaultModel'];

    if (empty($apiKey)) {
        http_response_code(400);
        echo json_encode(['error' => 'API key not configured for provider: ' . $provider . '. Please set it in Settings → Image Generation.']);
        return;
    }
    if (empty($baseUrl)) {
        http_response_code(400);
        echo json_encode(['error' => 'API base URL not configured for provider: ' . $provider]);
        return;
    }
    if (!str_ends_with($baseUrl, '/v1')) $baseUrl .= '/v1';

    // ★ xAI (Grok) 不支持 size / quality 参数, 需自动省略避免 400 错误
    $isXai = (strpos($baseUrl, 'x.ai') !== false) || (stripos($model, 'grok') !== false);

    $n = min($args['n'] ?? 1, 10);
    $body = ['model' => $model, 'prompt' => $prompt, 'n' => $n, 'response_format' => 'b64_json'];
    if (!$isXai) {
        // size 参数: 从 args 或 aspect_ratio 推导
        $size = $args['size'] ?? _aspect_ratio_to_size($args['aspect_ratio'] ?? '1:1');
        $body['size'] = $size;
    }

    $apiUrl = $baseUrl . '/images/generations';
    $ch = curl_init($apiUrl);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $apiKey, 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 120,
        CURLOPT_CONNECTTIMEOUT => 15,
    ]);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($err) {
        http_response_code(502);
        echo json_encode(['error' => 'Image generation request failed: ' . $err, 'provider' => $provider]);
        return;
    }

    $data = @json_decode($resp, true);
    if ($httpCode !== 200) {
        $errMsg = $data['error']['message'] ?? $data['error'] ?? substr($resp ?: '', 0, 300);
        http_response_code($httpCode);
        echo json_encode(['error' => 'Image generation failed (' . $httpCode . '): ' . $errMsg, 'provider' => $provider]);
        return;
    }

    // 提取图片 (支持 url 和 b64_json 两种格式)
    $images = [];
    if (!empty($data['data']) && is_array($data['data'])) {
        foreach ($data['data'] as $item) {
            if (!empty($item['url'])) $images[] = $item['url'];
            elseif (!empty($item['b64_json'])) $images[] = 'data:image/png;base64,' . $item['b64_json'];
        }
    }

    if (empty($images)) {
        http_response_code(502);
        echo json_encode(['error' => 'No images returned', 'raw' => mb_substr($resp ?: '', 0, 300), 'provider' => $provider]);
        return;
    }

    echo json_encode(['images' => $images, 'status' => 'ok', 'provider' => $provider, 'model' => $model]);
}

/** aspect_ratio → OpenAI size 映射 */
function _aspect_ratio_to_size(string $ratio): string {
    $map = ['1:1' => '1024x1024', '16:9' => '1792x1024', '9:16' => '1024x1792', '4:3' => '1024x1024', '3:4' => '1024x1024', '21:9' => '1792x1024'];
    return $map[$ratio] ?? '1024x1024';
}


function exec_generate_image_cli(string $prompt, string $mmxKey): void {
    $mmxBin = '/home/naujtrats/.npm-global/bin/mmx';
    $workDir = ONECHAT_ROOT . '/uploads/shared/';
    if (!is_dir($workDir)) @mkdir($workDir, 0777, true);
    $homeDir = $workDir . 'mmx_' . getmypid() . '_' . bin2hex(random_bytes(4));
    @mkdir($homeDir, 0777, true);

    $cmd = 'cd ' . escapeshellarg($workDir) . ' && HOME=' . escapeshellarg($homeDir) . ' ' . escapeshellcmd($mmxBin)
        . ' image generate --prompt ' . escapeshellarg($prompt)
        . ' --api-key ' . escapeshellarg($mmxKey)
        . ' --region cn --non-interactive --output json 2>&1';

    $output = shell_exec($cmd);

    if (is_dir($homeDir)) {
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($homeDir, RecursiveDirectoryIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f) {
            $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
        }
        @rmdir($homeDir);
    }

    $parsed = json_decode($output, true);
    if ($parsed && !empty($parsed['urls'])) {
        echo json_encode(['images' => $parsed['urls'], 'status' => 'ok', 'provider' => 'minimax']);
    } else {
        echo json_encode(['error' => 'Image generation failed', 'raw' => mb_substr($output ?: '', 0, 500)]);
    }
}


// ═══════════════════════════════════════════════════════
//  engine_push — 复制文件到 shared 公共目录
// ═══════════════════════════════════════════════════════
function exec_push_file(array $args): void {
    $path = $args['path'] ?? $args['file'] ?? '';
    if (empty($path)) { echo json_encode(['error' => 'path required']); exit; }

    $src = $path;
    if (str_starts_with($path, '/oneapichat/')) {
        $src = ONECHAT_ROOT . '/' . substr($path, strlen('/oneapichat/'));
    }
    if (!file_exists($src)) { echo json_encode(['error' => 'File not found: ' . $path]); exit; }

    $sharedDir = ONECHAT_ROOT . '/uploads/shared/';
    if (!is_dir($sharedDir)) @mkdir($sharedDir, 0755, true);
    $basename = basename($src);
    // 加时间戳 + hash 防止冲突
    $mtime = filemtime($src);
    $dest = $sharedDir . $mtime . '_' . substr(md5($src . $mtime), 0, 8) . '_' . $basename;
    if (@copy($src, $dest)) {
        @chmod($dest, 0644);
        echo json_encode(['ok' => true, 'path' => '/oneapichat/uploads/shared/' . basename($dest), 'url' => 'https://naujtrats.xyz/oneapichat/uploads/shared/' . basename($dest)]);
    } else {
        echo json_encode(['error' => 'Copy failed']);
    }
}
