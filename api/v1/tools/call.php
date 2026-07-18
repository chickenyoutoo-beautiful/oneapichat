<?php
/**
 * OneAPIChat API v1 — Tool Execution
 *
 * POST /oneapichat/api/v1/tools/call
 *
 * 执行 OneAPIChat 内置工具，返回执行结果
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

$userIdSafe = preg_replace('/[^a-zA-Z0-9_-]/', '', $userId);
$engine_url = 'http://127.0.0.1:8766';

// Load user config for search/image API keys
$configPaths = [
    ONECHAT_ROOT . '/chat_data/config_user_' . $userIdSafe . '.json',
    ONECHAT_ROOT . '/users/' . $userIdSafe . '_config.json',
];
$userConfig = [];
foreach ($configPaths as $cp) {
    if (file_exists($cp)) {
        $raw = file_get_contents($cp);
        if ($raw !== false) { $cfg = json_decode($raw, true); if (is_array($cfg)) { $userConfig = $cfg; break; } }
    }
}

// ── Route execution ──
// Tool → engine path mapping for all engine tools
$engineToolMap = [
    'server_sys_info'       => 'sys/info',
    'server_file_read'      => 'file/read',
    'server_file_write'     => 'file/write',
    'server_file_append'    => 'file/write',
    'server_file_search'    => 'file_search',
    'server_file_grep'      => 'file_grep',
    'server_file_edit'      => 'file_edit',
    'server_file_op'        => 'file_op',
    'server_exec'           => 'exec',
    'server_python'         => 'python',
    'server_ps'             => 'ps',
    'server_disk'           => 'disk',
    'server_network'        => 'network',
    'server_docker'         => 'docker',
    'server_db_query'       => 'db_query',
    'browser_navigate'      => 'browser/navigate',
    'browser_screenshot'    => 'browser/screenshot',
    'browser_click'         => 'browser/click',
    'browser_type'          => 'browser/type',
    'browser_get_content'   => 'browser/get_content',
    'browser_get_snapshot'  => 'browser/get_snapshot',
    'platform_extract'      => 'platform_extract',
    'run_skill'             => 'skills/run',
    'video_edit'            => 'video_edit',
];

switch ($toolName) {
    case 'web_search':
        _exec_web_search($args, $userConfig);
        break;
    case 'web_fetch':
        _exec_web_fetch($args);
        break;
    case 'generate_image':
        _exec_generate_image($args, $userConfig);
        break;
    case 'engine_push':
        _exec_push_file($args);
        break;
    default:
        // ★ 先检查引擎工具映射
        if (isset($engineToolMap[$toolName])) {
            _exec_engine_proxy($engineToolMap[$toolName], $args, $engine_url, $userIdSafe);
        }
        // ★ B站工具 + 通用 MCP 代理: 转发到 MCP Server
        elseif (str_starts_with($toolName, 'bilibili_') || str_starts_with($toolName, 'mmx_') || str_starts_with($toolName, 'win_') || str_starts_with($toolName, 'cr_') || str_starts_with($toolName, 'src_') || str_starts_with($toolName, 'chaoxing_') || in_array($toolName, ['generate_ppt','generate_docx','generate_xlsx','generate_pdf','video_understanding','analyze_image','rag_search','plan_update','delegate_task','delegate_workflow','ask_agent','autonomous_mode','toggle_proxy'])) {
            $mcpEndpoint = str_starts_with($toolName, 'bilibili_') ? '/mcp/bilibili/tools/call' : '/mcp/api/tools/call';
            $mcpCtx = stream_context_create(['http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => json_encode(['name' => $toolName, 'arguments' => $args], JSON_UNESCAPED_UNICODE),
                'timeout' => 120,
                'ignore_errors' => true,
            ]]);
            $mcpResp = file_get_contents('http://127.0.0.1:18788' . $mcpEndpoint, false, $mcpCtx);
            if ($mcpResp === false) {
                http_response_code(502);
                echo json_encode(['error' => 'MCP 服务不可达']);
            } else {
                $mcpData = json_decode($mcpResp, true);
                if (isset($mcpData['error'])) {
                    echo json_encode(['error' => $mcpData['error']]);
                } else {
                    echo json_encode(['result' => $mcpData['result'] ?? $mcpData]);
                }
            }
        } else {
            http_response_code(400);
            $all = array_merge(['web_search','web_fetch','generate_image','engine_push'], array_keys($engineToolMap));
            echo json_encode(['error' => 'Unknown tool: ' . $toolName, 'available' => $all]);
        }
}

exit;


// ═══════════════════════════════════════════════════════
// 解密 v2 AES-256-GCM 加密的 API Key
// ═══════════════════════════════════════════════════════
function _decrypt_config_key(string $encoded): string {
    if (empty($encoded)) return '';
    // v2: AES-256-GCM (Web Crypto 格式: IV[12] + CT[含16字节GCM tag])
    if (str_starts_with($encoded, 'v2:')) {
        $raw = base64_decode(substr($encoded, 3));
        if ($raw === false || strlen($raw) < 28) return $encoded;
        $iv = substr($raw, 0, 12);
        $data = substr($raw, 12);
        // GCM tag 在末尾 16 字节
        $tagLen = 16;
        $ct = substr($data, 0, -$tagLen);
        $tag = substr($data, -$tagLen);
        $encKey = getEncryptionKey();
        $aesKey = hash_pbkdf2('sha256', $encKey, 'oneapichat-aes-v2', 100000, 32, true);
        $result = openssl_decrypt($ct, 'aes-256-gcm', $aesKey, OPENSSL_RAW_DATA, $iv, $tag);
        return $result !== false ? $result : $encoded;
    }
    // Old XOR format (base64 encoded)
    $decoded = base64_decode($encoded, true);
    if ($decoded !== false && strlen($decoded) > 0) {
        $encKey = getEncryptionKey();
        $result = '';
        for ($i = 0; $i < strlen($decoded); $i++) {
            $result .= chr(ord($decoded[$i]) ^ ord($encKey[$i % strlen($encKey)]));
        }
        // Valid API keys start with common prefixes
        if (preg_match('/^(sk-|tvly-|oac-|AIza)/', $result)) return $result;
    }
    // Plaintext fallback
    return $encoded;
}

// ═══════════════════════════════════════════════════════
// web_search — 通过用户配置的搜索 Provider
// ═══════════════════════════════════════════════════════
function _exec_web_search(array $args, array $config): void {
    $query = trim($args['query'] ?? '');
    $maxResults = min(intval($args['max_results'] ?? 5), 10);

    if (empty($query)) {
        http_response_code(400);
        echo json_encode(['error' => 'query is required']);
        exit;
    }

    $searchProvider = $config['searchProvider'] ?? 'tavily';

    if ($searchProvider === 'tavily' || $searchProvider === 'auto') {
        $searchKey = _decrypt_config_key($config['searchApiKeyTavily'] ?? $config['searchApiKey'] ?? '');
        if (!empty($searchKey)) {
            $resp = @file_get_contents('https://api.tavily.com/search', false, stream_context_create(['http' => [
                'method' => 'POST', 'timeout' => 10, 'ignore_errors' => true,
                'header' => "Content-Type: application/json\r\n",
                'content' => json_encode(['api_key' => $searchKey, 'query' => $query, 'search_depth' => 'basic', 'max_results' => $maxResults]),
            ]]));
            if ($resp) {
                $data = json_decode($resp, true);
                if ($data && isset($data['results'])) {
                    echo json_encode(['results' => $data['results'], 'status' => 'ok', 'provider' => 'tavily']);
                    return;
                }
            }
        }
    }

    if ($searchProvider === 'brave') {
        $searchKey = _decrypt_config_key($config['searchApiKeyBrave'] ?? '');
        if (!empty($searchKey)) {
            $resp = @file_get_contents('https://api.search.brave.com/res/v1/web/search?q=' . urlencode($query) . '&count=' . $maxResults, false, stream_context_create(['http' => [
                'timeout' => 10, 'ignore_errors' => true,
                'header' => "Accept: application/json\r\nX-Subscription-Token: $searchKey\r\n",
            ]]));
            if ($resp) {
                $data = json_decode($resp, true);
                if ($data && isset($data['web']['results'])) {
                    echo json_encode(['results' => $data['web']['results'], 'status' => 'ok', 'provider' => 'brave']);
                    return;
                }
            }
        }
    }

    // DuckDuckGo fallback (使用 curl 避免 IPv6/file_get_contents 挂起)
    $ddgUrl = 'https://api.duckduckgo.com/?q=' . urlencode($query) . '&format=json&no_html=1';
    $ch = curl_init($ddgUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,  // 强制 IPv4
    ]);
    $resp = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($resp !== false && !$err) {
        $data = json_decode($resp, true);
        $results = [];
        if (!empty($data['RelatedTopics'])) {
            foreach (array_slice($data['RelatedTopics'], 0, $maxResults) as $r) {
                if (!empty($r['Text'])) {
                    $results[] = ['title' => $r['FirstURL'] ?? '', 'url' => $r['FirstURL'] ?? '', 'content' => strip_tags($r['Text'])];
                }
            }
        }
        echo json_encode(['results' => $results, 'status' => 'ok', 'provider' => 'duckduckgo']);
        return;
    }

    echo json_encode(['results' => [], 'status' => 'error', 'error' => 'All search providers failed']);
}

// ═══════════════════════════════════════════════════════
// web_fetch — 抓取网页
// ═══════════════════════════════════════════════════════
function _exec_web_fetch(array $args): void {
    $urls = $args['urls'] ?? ($args['url'] ? [$args['url']] : []);
    if (empty($urls) || !is_array($urls)) {
        http_response_code(400);
        echo json_encode(['error' => 'urls (array) or url (string) is required']);
        exit;
    }

    $results = [];
    foreach (array_slice($urls, 0, 5) as $u) {  // Max 5 URLs
        $u = trim($u);
        if (!preg_match('#^https?://#', $u)) {
            $results[$u] = ['error' => 'Invalid URL'];
            continue;
        }
        $resp = @file_get_contents($u, false, stream_context_create(['http' => [
            'timeout' => 15, 'ignore_errors' => true,
            'header' => "User-Agent: Mozilla/5.0 (compatible; OneAPIChat/1.0)\r\nAccept: text/html\r\n",
        ]]));
        if ($resp === false) {
            $results[$u] = ['error' => 'Fetch failed'];
        } else {
            // Simple text extraction
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
// Engine proxy — 转发到 Python 引擎
// ═══════════════════════════════════════════════════════
function _exec_engine_proxy(string $enginePath, array $args, string $engine_url, string $uid): void {
    $url = $engine_url . '/engine/' . $enginePath . '?user_id=' . urlencode($uid);

    // Append query params
    foreach ($args as $k => $v) {
        if (is_scalar($v)) $url .= '&' . urlencode($k) . '=' . urlencode($v);
    }

    $ch = curl_init($url);
    $opts = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CONNECTTIMEOUT => 5];

    // File write/append use POST
    if (in_array($enginePath, ['file/write', 'file/append', 'file_edit'])) {
        $opts[CURLOPT_POST] = true;
        $body = json_encode(['path' => $args['path'] ?? '', 'content' => $args['content'] ?? '']);
        if ($enginePath === 'file_edit') {
            $body = json_encode(['path' => $args['path'] ?? '', 'old_string' => $args['old_string'] ?? '', 'new_string' => $args['new_string'] ?? '']);
        }
        if ($enginePath === 'file/append') {
            $body = json_encode(['path' => $args['path'] ?? '', 'content' => $args['content'] ?? '', 'mode' => 'append']);
        }
        $opts[CURLOPT_POSTFIELDS] = $body;
        $opts[CURLOPT_HTTPHEADER] = ['Content-Type: application/json'];
    }

    // Python execution uses POST
    if ($enginePath === 'python') {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = $args['code'] ?? $args['script'] ?? '';
        $opts[CURLOPT_HTTPHEADER] = ['Content-Type: text/plain'];
    }

    // Skills run uses POST
    if ($enginePath === 'skills/run') {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = json_encode(['name' => $args['name'] ?? '', 'args' => $args]);
        $opts[CURLOPT_HTTPHEADER] = ['Content-Type: application/json'];
    }

    // Video edit uses POST
    if ($enginePath === 'video_edit') {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = json_encode($args);
        $opts[CURLOPT_HTTPHEADER] = ['Content-Type: application/json'];
        $opts[CURLOPT_TIMEOUT] = 600;
    }

    curl_setopt_array($ch, $opts);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($resp === false) {
        http_response_code(502);
        echo json_encode(['error' => 'Engine unreachable']);
        exit;
    }

    header('Content-Type: application/json; charset=utf-8');
    http_response_code($httpCode >= 200 && $httpCode < 500 ? $httpCode : 200);
    echo $resp;
}

// ═══════════════════════════════════════════════════════
// engine_push — 复制文件到 shared 目录
// ═══════════════════════════════════════════════════════
function _exec_push_file(array $args): void {
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
    $dest = $sharedDir . time() . '_' . $basename;
    if (@copy($src, $dest)) {
        @chmod($dest, 0644);
        echo json_encode(['ok' => true, 'path' => '/oneapichat/uploads/shared/' . basename($dest), 'url' => 'https://naujtrats.xyz/oneapichat/uploads/shared/' . basename($dest)]);
    } else {
        echo json_encode(['error' => 'Copy failed']);
    }
}

// ═══════════════════════════════════════════════════════
// generate_image — AI 图片生成
// ═══════════════════════════════════════════════════════
function _exec_generate_image(array $args, array $config): void {
    $prompt = trim($args['prompt'] ?? '');
    if (empty($prompt)) {
        http_response_code(400);
        echo json_encode(['error' => 'prompt is required']);
        exit;
    }

    $imageProvider = $config['imageProvider'] ?? 'minimax';
    // ★ 解密 imageApiKey
    $imageKey = _decrypt_config_key($config['imageApiKey'] ?? '');
    $imageBaseUrl = $config['imageBaseUrl'] ?? '';

    if ($imageProvider === 'minimax' || empty($imageProvider)) {
        // ★ 方案 1: 直接用 MiniMax API（避免 CLI 权限问题）
        $mmxConfig = @json_decode(@file_get_contents(ONECHAT_ROOT . '/config/.mmx_config.json'), true);
        $mmxKey = $imageKey ?: ($mmxConfig['api_key'] ?? '');
        if (empty($mmxKey)) {
            http_response_code(400);
            echo json_encode(['error' => 'MiniMax API key not configured. Set imageApiKey in OneAPIChat settings or configure .mmx_config.json']);
            exit;
        }

        // 直接调用 MiniMax image generation API
        $apiBody = json_encode([
            'model' => 'image-01',
            'prompt' => $prompt,
            'n' => 1,
            'response_format' => 'url',
        ]);

        $ch = curl_init('https://api.minimaxi.com/v1/image_generation');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $apiBody,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $mmxKey,
                'Content-Type: application/json',
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_CONNECTTIMEOUT => 10,
        ]);
        $resp = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($err || $resp === false) {
            // 回退到 CLI
            _exec_generate_image_cli($prompt, $mmxKey);
            return;
        }

        $data = json_decode($resp, true);
        if ($data && !empty($data['data'])) {
            // MiniMax 返回格式: {"data":{"image_urls":["http://..."]}}
            $urls = $data['data']['image_urls'] ?? [];
            if (!empty($urls)) {
                echo json_encode(['images' => $urls, 'status' => 'ok', 'provider' => 'minimax']);
                return;
            }
        }

        // API 失败，回退到 CLI
        _exec_generate_image_cli($prompt, $mmxKey);
        return;
    }

    echo json_encode(['error' => 'Image provider not supported: ' . $imageProvider]);
}

// ═══════════════════════════════════════════════════════
// CLI 回退 — 权限修复版
// ═══════════════════════════════════════════════════════
function _exec_generate_image_cli(string $prompt, string $mmxKey): void {
    $mmxBin = '/home/naujtrats/.npm-global/bin/mmx';

    // ★ 使用 uploads/shared 作为工作目录，确保 mmx CLI 有写入权限下载图片
    $workDir = ONECHAT_ROOT . '/uploads/shared/';
    if (!is_dir($workDir)) @mkdir($workDir, 0777, true);
    @chmod($workDir, 0777);
    $homeDir = $workDir . 'mmx_' . getmypid() . '_' . bin2hex(random_bytes(4));
    @mkdir($homeDir, 0777, true);

    $cmd = 'cd ' . escapeshellarg($workDir) . ' && HOME=' . escapeshellarg($homeDir) . ' ' . escapeshellcmd($mmxBin)
        . ' image generate --prompt ' . escapeshellarg($prompt)
        . ' --api-key ' . escapeshellarg($mmxKey)
        . ' --region cn --non-interactive --output json 2>&1';

    $output = shell_exec($cmd);

    // 清理 HOME 目录
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
