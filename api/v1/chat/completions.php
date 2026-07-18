<?php
/**
 * OneAPIChat API v1 — Chat Completions (OpenAI 兼容)
 *
 * POST /oneapichat/api/v1/chat/completions
 *
 * 认证: Authorization: Bearer <api_key>
 * 直接调用 Provider API，支持流式/非流式/函数调用
 */

require_once __DIR__ . '/../../init.php';
require_once __DIR__ . '/../../auth_helpers.php';
setApiCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204); exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => ['message' => 'Method not allowed', 'type' => 'invalid_request_error', 'code' => 'METHOD_NOT_ALLOWED']]);
    exit;
}

// ── 1. 认证 ──
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

// ── 2. 解析请求体 ──
$rawBody = file_get_contents('php://input');
$body = json_decode($rawBody, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'Invalid JSON: ' . json_last_error_msg(), 'type' => 'invalid_request_error', 'code' => 'INVALID_JSON']]);
    exit;
}

$reqModel = trim($body['model'] ?? '');
$messages = $body['messages'] ?? [];
if (empty($reqModel)) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => '"model" is required', 'type' => 'invalid_request_error', 'code' => 'MISSING_MODEL']]);
    exit;
}
if (!is_array($messages) || empty($messages)) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => '"messages" is required', 'type' => 'invalid_request_error', 'code' => 'MISSING_MESSAGES']]);
    exit;
}

// ── 3. 加载用户配置 ──
$userIdSafe = preg_replace('/[^a-zA-Z0-9_-]/', '', $userId);
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
// ── 4. 收集所有已配置的 Provider ──
$providers = [
    'deepseek'  => ['label' => 'DeepSeek',       'baseUrl' => 'https://api.deepseek.com',                     'keyName' => 'apiKeyDeepseek'],
    'openai'    => ['label' => 'OpenAI',         'baseUrl' => 'https://api.openai.com/v1',                     'keyName' => 'apiKeyOpenAI'],
    'xai'       => ['label' => 'xAI',            'baseUrl' => 'https://api.x.ai/v1',                           'keyName' => 'apiKeyXAI'],
    'antthropic'=> ['label' => 'Anthropic',      'baseUrl' => 'https://api.anthropic.com/v1',                  'keyName' => 'apiKeyAnth'],
    'minimax'   => ['label' => 'MiniMax',        'baseUrl' => 'https://api.minimaxi.com/v1',                   'keyName' => 'apiKeyMiniMax'],
    'gemini'    => ['label' => 'Gemini',         'baseUrl' => 'https://generativelanguage.googleapis.com/v1beta/openai', 'keyName' => 'apiKeyGemini'],
    'zhipu'     => ['label' => '智谱',           'baseUrl' => 'https://open.bigmodel.cn/api/paas/v4',           'keyName' => 'apiKeyZhipu'],
    'qwen'      => ['label' => '通义千问',       'baseUrl' => 'https://dashscope.aliyuncs.com/compatible-mode/v1','keyName' => 'apiKeyQwen'],
    'moonshot'  => ['label' => 'Kimi',           'baseUrl' => 'https://api.moonshot.cn/v1',                     'keyName' => 'apiKeyMoonshot'],
    'doubao'    => ['label' => '豆包',           'baseUrl' => 'https://ark.cn-beijing.volces.com/api/v3',       'keyName' => 'apiKeyDoubao'],
    'mimo'      => ['label' => 'MiMo',           'baseUrl' => 'https://api.xiaomimimo.com/v1',                 'keyName' => 'apiKeyMiMo'],
    'openrouter'=> ['label' => 'OpenRouter',     'baseUrl' => 'https://openrouter.ai/api/v1',                 'keyName' => 'apiKeyOpenRouter'],
    'opencode'  => ['label' => 'OpenCode',       'baseUrl' => 'https://api.opencode.ai/v1',                     'keyName' => 'apiKeyOpenCode'],
    'llamacpp'  => ['label' => '本地模型',       'baseUrl' => 'https://localmodels.naujtrats.xyz/v1',          'keyName' => 'apiKeyLlamaCpp'],
    'custom'    => ['label' => '自定义',         'baseUrl' => '',                                               'keyName' => 'apiKeyCustom'],
];

// 收集所有有 API Key + 模型的 Provider
$allProviders = [];
// 默认（当前激活的 Provider）
$activeKey = _decrypt_config_key($userConfig['apiKey'] ?? '');
$activeBaseUrl = rtrim($userConfig['baseUrl'] ?? '', '/');
if (!empty($activeKey) && !empty($activeBaseUrl)) {
    $allProviders[] = ['apiKey' => $activeKey, 'baseUrl' => $activeBaseUrl, 'label' => 'active'];
}

foreach ($providers as $pid => $pcfg) {
    $key = _decrypt_config_key($userConfig[$pcfg['keyName']] ?? '');
    if (empty($key)) continue;
    $baseUrl = $pcfg['baseUrl'];
    if ($pid === 'custom') $baseUrl = $userConfig['baseUrlCustom'] ?? $baseUrl;
    if (empty($baseUrl)) continue;
    // 避免重复
    $dup = false;
    foreach ($allProviders as $e) { if ($e['baseUrl'] === rtrim($baseUrl, '/') && $e['apiKey'] === $key) { $dup = true; break; } }
    if ($dup) continue;
    $allProviders[] = ['apiKey' => $key, 'baseUrl' => rtrim($baseUrl, '/'), 'label' => $pcfg['label']];
}

if (empty($allProviders)) {
    http_response_code(402);
    echo json_encode(['error' => ['message' => 'Account has no provider configured.', 'type' => 'server_error', 'code' => 'PROVIDER_NOT_CONFIGURED']]);
    exit;
}

// ── 5. 选择 Provider：按请求的 model 匹配 ──
$userModel = $userConfig['model'] ?? '';
$systemPrompt = $userConfig['systemPrompt'] ?? '';
$userTemp = isset($userConfig['temp']) ? floatval($userConfig['temp']) : 0.7;
$userTokens = isset($userConfig['tokens']) ? intval($userConfig['tokens']) : 4096;
$proxyEnabled = !empty($userConfig['proxyEnabled']);
$proxyUrl = $userConfig['proxyUrl'] ?? '';

$finalModel = $reqModel ?: $userModel;
$finalTemp = isset($body['temperature']) ? floatval($body['temperature']) : $userTemp;
$finalMaxTokens = isset($body['max_tokens']) ? intval($body['max_tokens']) : $userTokens;
$stream = !empty($body['stream']);
$tools = $body['tools'] ?? null;
$toolChoice = $body['tool_choice'] ?? null;

// ★ 过滤客户端传入的 tools（也防止 schema 问题导致 Provider 拒绝）
if ($tools) {
    $tools = array_values(array_filter($tools, function($t) {
        $fn = $t['function'] ?? $t;
        $params = $fn['parameters'] ?? null;
        return is_array($params) && !empty($params['type']) && $params['type'] === 'object';
    }));
    if (empty($tools)) $tools = null;
}

// ★ 自动注入工具：如果客户端没传 tools，从引擎加载全部可用工具
if (empty($tools) && !isset($body['tools'])) {
    $engineToolsJson = @file_get_contents('http://127.0.0.1:8766/engine/v2/tools/list', false, stream_context_create(['http' => ['timeout' => 3, 'ignore_errors' => true]]));
    if ($engineToolsJson) {
        $engineToolsData = @json_decode($engineToolsJson, true);
        $engineToolsList = $engineToolsData['tools'] ?? [];
        if (!empty($engineToolsList)) {
            $tools = [];
            foreach ($engineToolsList as $t) {
                if (!is_array($t) || empty($t['name'])) continue;
                // ★ PHP json_decode 把 {} 转成 []，必须检查有效性
                $schema = $t['input_schema'] ?? $t['parameters'] ?? null;
                if (!is_array($schema) || empty($schema['type']) || empty($schema['properties']) || !is_array($schema['properties'])) {
                    continue; // 跳过空 schema 的工具（Provider 拒绝 properties: {}）
                }
                if (empty($schema['required'])) unset($schema['required']);
                $tools[] = [
                    'type' => 'function',
                    'function' => [
                        'name' => $t['name'],
                        'description' => $t['description'] ?? '',
                        'parameters' => $schema,
                    ],
                ];
            }
        }
    }
    // ★ 过滤非法 schema：parameters 必须是有效对象
    if ($tools) {
        $tools = array_values(array_filter($tools, function($t) {
            $fn = $t['function'] ?? $t;
            $params = $fn['parameters'] ?? null;
            return is_array($params) && !empty($params) && isset($params['type']) && $params['type'] === 'object';
        }));
        // 没有合法工具时清空，避免 Provider 拒绝
        if (empty($tools)) $tools = null;
    }
    // 追加 generate_image（引擎外工具）
    if ($tools) {
        $tools[] = [
            'type' => 'function',
            'function' => [
                'name' => 'generate_image',
                'description' => '使用 AI 生成图片。传入提示词描述想要的图片内容。',
                'parameters' => ['type' => 'object', 'properties' => ['prompt' => ['type' => 'string', 'description' => '图片生成提示词']], 'required' => ['prompt']],
            ],
        ];
    }
}
$stop = $body['stop'] ?? null;
$topP = $body['top_p'] ?? null;

// 选择 Provider：优先用第一个（当前激活的），后续可通过 model 匹配优化
$selectedProvider = $allProviders[0];
$providerApiKey = $selectedProvider['apiKey'];
$providerBaseUrl = $selectedProvider['baseUrl'];

// ── 4. 解密工具 ──
if (!function_exists('str_starts_with')) { function str_starts_with($h, $n) { return strncmp($h, $n, strlen($n)) === 0; } }
function _decrypt_config_key(string $encoded): string {
    if (empty($encoded)) return '';
    if (str_starts_with($encoded, 'v2:')) {
        $raw = base64_decode(substr($encoded, 3));
        if ($raw === false || strlen($raw) < 28) return $encoded;
        $iv = substr($raw, 0, 12); $data = substr($raw, 12);
        $ct = substr($data, 0, -16); $tag = substr($data, -16);
        $aesKey = hash_pbkdf2('sha256', getEncryptionKey(), 'oneapichat-aes-v2', 100000, 32, true);
        $result = openssl_decrypt($ct, 'aes-256-gcm', $aesKey, OPENSSL_RAW_DATA, $iv, $tag);
        return $result !== false ? $result : $encoded;
    }
    $decoded = base64_decode($encoded, true);
    if ($decoded !== false && strlen($decoded) > 0) {
        $encKey = getEncryptionKey(); $result = '';
        for ($i = 0; $i < strlen($decoded); $i++) $result .= chr(ord($decoded[$i]) ^ ord($encKey[$i % strlen($encKey)]));
        if (preg_match('/^(sk-|tvly-|oac-|AIza)/', $result)) return $result;
    }
    return $encoded;
}

// ── 6. 注入 System Prompt ──
$hasSystem = false;
foreach ($messages as $msg) {
    if (is_array($msg) && ($msg['role'] ?? '') === 'system') { $hasSystem = true; break; }
}
if (!$hasSystem && !empty($systemPrompt)) {
    array_unshift($messages, ['role' => 'system', 'content' => $systemPrompt]);
}

// ── 5. 构建 Provider 请求体 ──
$providerBody = [
    'model' => $finalModel,
    'messages' => $messages,
    'stream' => $stream,
    'temperature' => $finalTemp,
    'max_tokens' => $finalMaxTokens,
];
if ($tools) $providerBody['tools'] = $tools;
if ($toolChoice) $providerBody['tool_choice'] = $toolChoice;
if ($stop) $providerBody['stop'] = $stop;
if ($topP !== null) $providerBody['top_p'] = $topP;

$targetUrl = $providerBaseUrl . '/chat/completions';

// ── 6. 调用 Provider API ──
$ch = curl_init($targetUrl);
$curlHeaders = [
    'Authorization: Bearer ' . $providerApiKey,
    'Content-Type: application/json',
];
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($providerBody, JSON_UNESCAPED_UNICODE),
    CURLOPT_HTTPHEADER => $curlHeaders,
    CURLOPT_TIMEOUT => 600,
    CURLOPT_CONNECTTIMEOUT => 10,
]);

// 代理配置（Google/被墙域名自动走中继）
$useProxy = false;
if ($proxyEnabled && $proxyUrl) {
    $useProxy = true;
} elseif (stripos($providerBaseUrl, 'api.google') !== false || stripos($providerBaseUrl, 'generativelanguage') !== false) {
    $useProxy = true;
    $proxyUrl = '__relay_only__';
}

if ($useProxy) {
    if ($proxyUrl === '__relay_only__') {
        // 仅 CORS 中继（通过本地 proxy.php）
    } else {
        $proxyParsed = parse_url($proxyUrl);
        if ($proxyParsed && isset($proxyParsed['host'])) {
            curl_setopt($ch, CURLOPT_PROXY, $proxyParsed['host']);
            curl_setopt($ch, CURLOPT_PROXYPORT, $proxyParsed['port'] ?? 1080);
            if (($proxyParsed['scheme'] ?? '') === 'socks5') {
                curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5);
            }
        }
    }
}

// 流式
if ($stream) {
    _sendStream($ch);
} else {
    _sendNonStream($ch);
}


// ═══════════════════════════════════════════════════════
function _sendNonStream($ch): void {
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 300]);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($err) {
        http_response_code(502);
        echo json_encode(['error' => ['message' => 'Upstream error: ' . $err, 'type' => 'server_error', 'code' => 'UPSTREAM_ERROR']]);
        exit;
    }

    // ★ 检测 Provider 错误（有些 Provider 用 200 返回错误 JSON）
    $parsed = json_decode($resp, true);
    if ($parsed && isset($parsed['error'])) {
        $errMsg = is_string($parsed['error']) ? $parsed['error'] : ($parsed['error']['message'] ?? 'Provider error');
        $errType = $parsed['error']['type'] ?? 'server_error';
        if (stripos($errMsg, 'invalid schema') !== false || $errType === 'invalid_request_error') {
            http_response_code(400);
        } elseif (stripos($errMsg, 'auth') !== false || $errType === 'authentication_error') {
            http_response_code(401);
        } elseif (stripos($errMsg, 'rate') !== false || $errType === 'rate_limit_error') {
            http_response_code(429);
        } else {
            http_response_code(500);
        }
    } elseif ($httpCode >= 400) {
        http_response_code($httpCode);
    }
    header('Content-Type: application/json; charset=utf-8');
    echo $resp;
    exit;
}

function _sendStream($ch): void {
    ini_set('output_buffering', 'off');
    ini_set('zlib.output_compression', false);
    while (ob_get_level()) ob_end_clean();
    header('Content-Type: text/event-stream');
    header('Cache-Control: no-cache');
    header('X-Accel-Buffering: no');

    // ★ 缓冲前几字节检测非流式错误
    $buffer = '';
    $checked = false;
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_TIMEOUT => 600,
        CURLOPT_WRITEFUNCTION => function($ch, $data) use (&$buffer, &$checked) {
            if (!$checked) {
                $buffer .= $data;
                // 前 200 字节内检测是否为 SSE 格式
                if (strlen($buffer) > 200 || str_contains($buffer, "\n\n")) {
                    $checked = true;
                    if (!str_starts_with(trim($buffer), 'data:')) {
                        // 非 SSE — Provider 返回了 JSON 错误
                        $parsed = json_decode(trim($buffer), true);
                        if ($parsed && isset($parsed['error'])) {
                            $errType = $parsed['error']['type'] ?? 'server_error';
                            if (stripos(json_encode($parsed['error']), 'invalid schema') !== false || $errType === 'invalid_request_error') {
                                http_response_code(400);
                            } elseif (stripos(json_encode($parsed['error']), 'auth') !== false || $errType === 'authentication_error') {
                                http_response_code(401);
                            }
                        }
                        echo $buffer;
                        return strlen($data);
                    }
                    echo $buffer;
                    ob_flush(); flush();
                    return strlen($data);
                }
                // 还在缓冲中，不输出
                return strlen($data);
            }
            echo $data; ob_flush(); flush();
            return strlen($data);
        },
    ]);

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_TIMEOUT => 600,
        CURLOPT_WRITEFUNCTION => function($ch, $data) {
            echo $data; ob_flush(); flush();
            return strlen($data);
        },
    ]);
    curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($err) {
        echo "data: " . json_encode(['error' => ['message' => 'Stream error: ' . $err, 'type' => 'server_error', 'code' => 'STREAM_ERROR']]) . "\n\n";
    }
    echo "data: [DONE]\n\n";
    exit;
}
