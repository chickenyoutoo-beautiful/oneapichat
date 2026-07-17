<?php
/**
 * OneAPIChat API v1 — Models List (OpenAI 兼容)
 *
 * GET /oneapichat/api/v1/models
 *
 * 返回用户所有已配置 Provider 的可用模型列表（不只是当前激活的）
 */

require_once __DIR__ . '/../init.php';
require_once __DIR__ . '/../auth_helpers.php';
setApiCorsHeaders();
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$bearerToken = extractBearerToken();
$userId = null;
if ($bearerToken) { $userId = verifyApiKey($bearerToken) ?: verifyAuthToken($bearerToken); }
if (!$userId) {
    http_response_code(401);
    echo json_encode(['error' => ['message' => 'Invalid API key', 'type' => 'authentication_error', 'code' => 'INVALID_API_KEY']]);
    exit;
}

$userIdSafe = preg_replace('/[^a-zA-Z0-9_-]/', '', $userId);

// ── 1. 加载用户配置 ──
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

// ── 2. 解密工具 ──
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

// ── 3. Provider 定义（与前端 core.js API_PROVIDERS 同步）──
$providers = [
    'deepseek'  => ['label' => 'DeepSeek',       'baseUrl' => 'https://api.deepseek.com'],
    'openai'    => ['label' => 'OpenAI',         'baseUrl' => 'https://api.openai.com/v1'],
    'xai'       => ['label' => 'xAI (Grok)',     'baseUrl' => 'https://api.x.ai/v1'],
    'antthropic'=> ['label' => 'Anthropic',      'baseUrl' => 'https://api.anthropic.com/v1'],
    'minimax'   => ['label' => 'MiniMax',        'baseUrl' => 'https://api.minimaxi.com/v1'],
    'gemini'    => ['label' => 'Google Gemini',  'baseUrl' => 'https://generativelanguage.googleapis.com/v1beta/openai'],
    'zhipu'     => ['label' => '智谱 (GLM)',    'baseUrl' => 'https://open.bigmodel.cn/api/paas/v4'],
    'qwen'      => ['label' => '通义千问',       'baseUrl' => 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    'moonshot'  => ['label' => '月之暗面 (Kimi)', 'baseUrl' => 'https://api.moonshot.cn/v1'],
    'doubao'    => ['label' => '字节豆包',       'baseUrl' => 'https://ark.cn-beijing.volces.com/api/v3'],
    'mimo'      => ['label' => '小米 MiMo',       'baseUrl' => 'https://api.xiaomimimo.com/v1'],
    'openrouter'=> ['label' => 'OpenRouter',     'baseUrl' => 'https://openrouter.ai/api/v1'],
    'opencode'  => ['label' => 'OpenCode',       'baseUrl' => 'https://api.opencode.ai/v1'],
    'llamacpp'  => ['label' => '本地模型',       'baseUrl' => 'https://localmodels.naujtrats.xyz/v1'],
    'custom'    => ['label' => '自定义',         'baseUrl' => ''],
];

// ── 4. 收集所有用户已配置的 Provider ──
$configuredProviders = [];
$seenModels = [];

// 始终包含当前激活的 Provider
$activeKey = $userConfig['apiKey'] ?? '';
$activeBaseUrl = $userConfig['baseUrl'] ?? '';
$activeModel = $userConfig['model'] ?? '';
if (!empty($activeKey) && !empty($activeBaseUrl)) {
    $modelName = !empty($activeModel) ? $activeModel : 'unknown';
    $configuredProviders[] = [
        'apiKey' => _decrypt_config_key($activeKey),
        'baseUrl' => rtrim($activeBaseUrl, '/'),
        'model' => $modelName,
        'label' => '当前',
    ];
    $seenModels[$modelName] = true;
}

// 扫描所有 Provider
$providerKeyMap = [
    'deepseek' => 'apiKeyDeepseek',   'openai' => 'apiKeyOpenAI',
    'xai' => 'apiKeyXAI',             'antthropic' => 'apiKeyAnth',
    'minimax' => 'apiKeyMiniMax',     'gemini' => 'apiKeyGemini',
    'zhipu' => 'apiKeyZhipu',         'qwen' => 'apiKeyQwen',
    'moonshot' => 'apiKeyMoonshot',   'doubao' => 'apiKeyDoubao',
    'mimo' => 'apiKeyMiMo',           'openrouter' => 'apiKeyOpenRouter',
    'opencode' => 'apiKeyOpenCode',   'llamacpp' => 'apiKeyLlamaCpp',
    'custom' => 'apiKeyCustom',
];

// 排除中转/聚合类 Provider（非原生 API）
$excludedProviders = ['openrouter', 'opencode'];

foreach ($providerKeyMap as $providerId => $keyName) {
    if (in_array($providerId, $excludedProviders)) continue;

    $pCfg = $providers[$providerId] ?? null;
    if (!$pCfg) continue;

    $apiKey = _decrypt_config_key($userConfig[$keyName] ?? '');
    if (empty($apiKey)) continue;

    // 检查是否有保存的模型
    $modelKey = 'model_' . $providerId;
    $savedModel = $userConfig[$modelKey] ?? '';

    // 跳过占位符模型名
    if (empty($savedModel) || preg_match('/^(加载中|请输入|loading)/', $savedModel)) continue;

    // 获取 baseUrl：自定义 provider 从 baseUrlCustom，其他用默认
    $baseUrl = $pCfg['baseUrl'];
    if ($providerId === 'custom') {
        $baseUrl = $userConfig['baseUrlCustom'] ?? $pCfg['baseUrl'];
    }
    if (empty($baseUrl)) continue;

    // 避免与当前激活 Provider 重复
    $alreadyAdded = false;
    foreach ($configuredProviders as $existing) {
        if ($existing['baseUrl'] === rtrim($baseUrl, '/') && $existing['apiKey'] === $apiKey) {
            $alreadyAdded = true;
            break;
        }
    }
    if ($alreadyAdded) continue;

    $configuredProviders[] = [
        'apiKey' => $apiKey,
        'baseUrl' => rtrim($baseUrl, '/'),
        'model' => $savedModel,
        'label' => $pCfg['label'],
    ];
    $seenModels[$savedModel] = true;
}

// ── 5. 构建模型列表 ──
$models = [];
$proxyEnabled = !empty($userConfig['proxyEnabled']);
$proxyUrl = $userConfig['proxyUrl'] ?? '';

// 过滤不相关的模型后缀
$filterSuffixes = ['-preview','experimental','-exp','gemini-3.1-','-embedding','-tts','-audio',
    'whisper','dall-e','-image','moderation','babbage','davinci','embed','text-embedding','tts-1'];

foreach ($configuredProviders as $prov) {
    // 始终添加用户保存的模型
    $mname = $prov['model'];
    if (!empty($mname) && !isset($seenModels[$mname . '@' . $prov['label']])) {
        $models[] = ['id' => $mname, 'object' => 'model', 'created' => time(), 'owned_by' => strtolower($prov['label'])];
        $seenModels[$mname . '@' . $prov['label']] = true;
    }

    // 从 Provider 拉取模型列表
    $modelsUrl = $prov['baseUrl'] . '/models';
    $ch = curl_init($modelsUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5, CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $prov['apiKey'], 'Content-Type: application/json'],
    ]);
    // Google 域名强制 IPv4（GFW）
    if (stripos($prov['baseUrl'], 'google') !== false || stripos($prov['baseUrl'], 'generativelanguage') !== false) {
        curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    }
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($resp === false || $httpCode < 200 || $httpCode >= 300) continue;

    $providerModels = json_decode($resp, true);
    if (!is_array($providerModels)) continue;

    // 兼容多种响应格式
    $modelList = $providerModels['data'] ?? $providerModels;
    if (!isset($modelList[0]) && isset($providerModels['models'])) $modelList = $providerModels['models'];
    if (isset($modelList[0]) && is_string($modelList[0])) $modelList = array_map(fn($m) => ['id' => $m], $modelList);

    foreach ($modelList as $m) {
        if (!is_array($m)) continue;
        $mid = $m['id'] ?? ($m['name'] ?? '');
        if (empty($mid)) continue;
        // 去 models/ 前缀
        if (str_starts_with($mid, 'models/')) $mid = substr($mid, 7);
        // 过滤
        $skip = false;
        foreach ($filterSuffixes as $sfx) { if (stripos($mid, $sfx) !== false) { $skip = true; break; } }
        if ($skip) continue;
        $key = $mid . '@' . $prov['label'];
        if (isset($seenModels[$key])) continue;
        $seenModels[$key] = true;
        $models[] = ['id' => $mid, 'object' => 'model', 'created' => $m['created'] ?? time(), 'owned_by' => strtolower($prov['label'])];
    }
}

echo json_encode(['object' => 'list', 'data' => $models], JSON_UNESCAPED_UNICODE);
