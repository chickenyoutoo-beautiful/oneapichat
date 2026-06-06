<?php
/**
 * OneAPIChat 用户配置 API v1
 * 保存 / 加载用户的所有配置（API Key、模型参数、UI设置等）
 * 
 * GET  ?action=load&auth_token=xxx - 加载用户配置（需 auth_token）
 * POST ?action=save&auth_token=xxx  - 保存用户配置（需 auth_token）
 */

require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';
setCorsHeaders();
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function jsonReply(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function getUserConfigFile(string $userId): string {
    return dirname(__DIR__) . '/users/' . preg_replace('/[^a-zA-Z0-9_-]/', '', $userId) . '_config.json';
}

$token = isset($_GET['auth_token']) ? preg_replace('/[^a-f0-9]/', '', $_GET['auth_token']) : '';
$userId = verifyAuthToken($token);
if (!$userId) jsonReply(['error' => 'Unauthorized'], 401);

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET' && isset($_GET['action']) && $_GET['action'] === 'load') {
    $file = getUserConfigFile($userId);
    if (file_exists($file)) {
        $data = json_decode(file_get_contents($file), true);
        jsonReply(['success' => true, 'config' => $data]);
    } else {
        jsonReply(['success' => true, 'config' => null]);
    }
}

if ($method === 'POST' && isset($_GET['action']) && $_GET['action'] === 'save') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        jsonReply(['error' => 'Invalid JSON'], 400);
    }

    $config = $body['config'] ?? null;
    if (!is_array($config)) jsonReply(['error' => 'config required'], 400);

    $allowedKeys = [
        'apiKey', 'baseUrl', 'model', 'systemPrompt',
        'visionModel', 'visionApiUrl', 'visionApiKey',
        'imageModel', 'imageApiKey', 'imageBaseUrl', 'imageProvider',
        'temp', 'tokens', 'stream',
        'reasoningDelay', 'contentDelay', 'requestTimeout',
        'customParams', 'customEnabled',
        'lineHeight', 'paragraphMargin', 'paragraphPrefix',
        'markdownGFM', 'markdownBreaks',
        'titleModel',
        'enableSearch', 'searchModel', 'searchProvider',
        'searchApiKey', 'searchApiKeyBrave', 'searchApiKeyGoogle', 'searchApiKeyTavily',
        'searchRegion', 'searchTimeout', 'maxSearchResults',
        'aiSearchJudge', 'aiSearchJudgeModel', 'aiSearchJudgePrompt',
        'enableSearchOptimize', 'fontSize',
        'searchType', 'aiSearchTypeToggle', 'searchShowPrompt', 'searchAppendToSystem',
        'searchToolCall', 'dark'
    ];

    $filtered = [];
    foreach ($config as $k => $v) {
        if (in_array($k, $allowedKeys, true) && is_string($v)) {
            $filtered[$k] = $v;
        }
    }

    $file = getUserConfigFile($userId);
    $existing = file_exists($file) ? json_decode(file_get_contents($file), true) : [];
    if (!is_array($existing)) $existing = [];

    $merged = array_merge($existing, $filtered);
    $merged['updated_at'] = date('c');

    if (@file_put_contents($file, json_encode($merged, JSON_PRETTY_PRINT), LOCK_EX) !== false) {
        jsonReply(['success' => true, 'saved_keys' => array_keys($filtered)]);
    } else {
        jsonReply(['error' => 'Failed to save config'], 500);
    }
}

jsonReply(['error' => 'Unknown action'], 400);
