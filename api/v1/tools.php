<?php
/**
 * OneAPIChat API v1 — Tools List
 *
 * GET /oneapichat/api/v1/tools
 *
 * 返回全部可用工具定义（OpenAI function calling 格式）。
 * 从 MCP Server (port 18788) 动态加载，始终保持与 MCP 同步。
 */

require_once __DIR__ . '/../init.php';
require_once __DIR__ . '/../auth_helpers.php';
setApiCorsHeaders();
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204); exit;
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

// ── 从 MCP Server 动态加载全部工具 ──
$tools = [];

$mcpResp = @file_get_contents('http://127.0.0.1:18788/mcp/api/tools', false, stream_context_create([
    'http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\n", 'timeout' => 5, 'ignore_errors' => true],
]));

if ($mcpResp) {
    $mcpData = json_decode($mcpResp, true);
    $mcpTools = $mcpData['tools'] ?? [];
    foreach ($mcpTools as $t) {
        if (!is_array($t) || empty($t['name'])) continue;

        $schema = $t['inputSchema'] ?? $t['parameters'] ?? [];
        if (!is_array($schema) || empty($schema['type'])) continue;
        // 跳过空 schema (Provider 会拒绝)
        if (empty($schema['properties']) || !is_array($schema['properties'])) continue;
        // 清理空 required
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

// ── 引擎工具补充 (MCP 可能未包含) ──
$engineResp = @file_get_contents('http://127.0.0.1:8766/engine/v2/tools/list', false, stream_context_create([
    'http' => ['timeout' => 3, 'ignore_errors' => true],
]));
if ($engineResp) {
    $engineData = @json_decode($engineResp, true);
    $engineTools = $engineData['tools'] ?? [];
    foreach ($engineTools as $t) {
        if (!is_array($t) || empty($t['name'])) continue;
        $exists = false;
        foreach ($tools as $existing) {
            if (($existing['function']['name'] ?? '') === $t['name']) { $exists = true; break; }
        }
        if ($exists) continue;
        $schema = $t['input_schema'] ?? $t['parameters'] ?? [];
        if (!is_array($schema) || empty($schema['type'])) continue;
        if (empty($schema['properties']) || !is_array($schema['properties'])) continue;
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

// ── 确保 web_fetch 始终存在 (MCP list 用 POST, 可能路径不同) ──
$hasWebFetch = false;
foreach ($tools as $t) {
    if ($t['function']['name'] === 'web_fetch') { $hasWebFetch = true; break; }
}
if (!$hasWebFetch) {
    $tools[] = [
        'type' => 'function',
        'function' => [
            'name' => 'web_fetch',
            'description' => '抓取网页内容，提取文本信息。',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'urls' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => '要抓取的 URL 列表'],
                ],
                'required' => ['urls'],
            ],
        ],
    ];
}

// ── 响应 ──
echo json_encode([
    'object' => 'list',
    'count' => count($tools),
    'data' => $tools,
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
