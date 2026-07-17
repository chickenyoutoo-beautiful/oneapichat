<?php
/**
 * OneAPIChat API v1 — Tools List
 *
 * GET /oneapichat/api/v1/tools
 *
 * 返回 OneAPIChat 可用工具定义列表（OpenAI function calling 格式）
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

// ★ 额外工具（引擎端点未在 registry 中注册）
$extraTools = [
    ['type'=>'function','function'=>['name'=>'server_file_search','description'=>'按文件名模式搜索文件。','parameters'=>['type'=>'object','properties'=>['pattern'=>['type'=>'string','description'=>'搜索模式'],'path'=>['type'=>'string','description'=>'搜索目录']],'required'=>['pattern']]]],
    ['type'=>'function','function'=>['name'=>'server_file_grep','description'=>'在文件内容中搜索文本。','parameters'=>['type'=>'object','properties'=>['pattern'=>['type'=>'string','description'=>'搜索正则'],'path'=>['type'=>'string','description'=>'文件或目录'],'max_results'=>['type'=>'integer']],'required'=>['pattern']]]],
    ['type'=>'function','function'=>['name'=>'server_file_edit','description'=>'替换文件中的字符串。','parameters'=>['type'=>'object','properties'=>['path'=>['type'=>'string'],'old_string'=>['type'=>'string'],'new_string'=>['type'=>'string']],'required'=>['path','old_string','new_string']]]],
    ['type'=>'function','function'=>['name'=>'server_file_op','description'=>'文件操作：cp/mv/rm/mkdir。','parameters'=>['type'=>'object','properties'=>['action'=>['type'=>'string','enum'=>['cp','mv','rm','mkdir']],'src'=>['type'=>'string'],'dst'=>['type'=>'string']],'required'=>['action']]]],
    ['type'=>'function','function'=>['name'=>'server_ps','description'=>'查看服务器进程列表。','parameters'=>['type'=>'object','properties'=>['filter'=>['type'=>'string','description'=>'进程名过滤']],'required'=>[]]]],
    ['type'=>'function','function'=>['name'=>'server_disk','description'=>'查看服务器磁盘使用情况。','parameters'=>['type'=>'object','properties'=>['path'=>['type'=>'string','description'=>'指定路径']],'required'=>[]]]],
    ['type'=>'function','function'=>['name'=>'server_network','description'=>'网络诊断：ping/curl/端口。','parameters'=>['type'=>'object','properties'=>['action'=>['type'=>'string','enum'=>['ping','curl','port']],'target'=>['type'=>'string','description'=>'目标地址']],'required'=>['action','target']]]],
    ['type'=>'function','function'=>['name'=>'server_docker','description'=>'Docker容器管理：ps/start/stop/logs。','parameters'=>['type'=>'object','properties'=>['action'=>['type'=>'string','enum'=>['ps','start','stop','logs','restart']],'name'=>['type'=>'string','description'=>'容器名']],'required'=>['action']]]],
    ['type'=>'function','function'=>['name'=>'server_db_query','description'=>'查询SQLite数据库。','parameters'=>['type'=>'object','properties'=>['sql'=>['type'=>'string','description'=>'SQL查询语句']],'required'=>['sql']]]],
];

// ★ 内置工具定义（与前端 tools.js 同步）
$tools = [
    [
        'type' => 'function',
        'function' => [
            'name' => 'web_search',
            'description' => '搜索互联网获取实时信息。当用户询问最新新闻、实时数据或需要联网查询时使用。',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'query' => ['type' => 'string', 'description' => '搜索关键词'],
                    'max_results' => ['type' => 'integer', 'description' => '最大结果数，默认 5'],
                ],
                'required' => ['query'],
            ],
        ],
    ],
    [
        'type' => 'function',
        'function' => [
            'name' => 'web_fetch',
            'description' => '抓取网页内容，提取文本信息。用于阅读文章、获取网页详情。',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'urls' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => '要抓取的 URL 列表'],
                ],
                'required' => ['urls'],
            ],
        ],
    ],
    [
        'type' => 'function',
        'function' => [
            'name' => 'server_file_read',
            'description' => '读取服务器上的文件内容。',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'path' => ['type' => 'string', 'description' => '文件路径'],
                    'max_lines' => ['type' => 'integer', 'description' => '最大读取行数，默认 200'],
                ],
                'required' => ['path'],
            ],
        ],
    ],
    [
        'type' => 'function',
        'function' => [
            'name' => 'server_file_write',
            'description' => '写入内容到服务器文件。',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'path' => ['type' => 'string', 'description' => '文件路径'],
                    'content' => ['type' => 'string', 'description' => '写入内容'],
                ],
                'required' => ['path', 'content'],
            ],
        ],
    ],
    [
        'type' => 'function',
        'function' => [
            'name' => 'server_file_search',
            'description' => '在服务器上搜索文件。',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'pattern' => ['type' => 'string', 'description' => '文件名搜索模式'],
                    'path' => ['type' => 'string', 'description' => '搜索目录路径'],
                ],
                'required' => ['pattern'],
            ],
        ],
    ],
    [
        'type' => 'function',
        'function' => [
            'name' => 'server_exec',
            'description' => '在服务器上执行 Shell 命令（需审批）。',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'cmd' => ['type' => 'string', 'description' => '要执行的命令'],
                ],
                'required' => ['cmd'],
            ],
        ],
    ],
    [
        'type' => 'function',
        'function' => [
            'name' => 'generate_image',
            'description' => '使用 AI 生成图片。',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'prompt' => ['type' => 'string', 'description' => '图片生成提示词'],
                ],
                'required' => ['prompt'],
            ],
        ],
    ],
];

// 尝试从引擎加载工具列表
$engineResp = @file_get_contents('http://127.0.0.1:8766/engine/v2/tools/list', false, stream_context_create(['http' => ['timeout' => 3, 'ignore_errors' => true]]));
if ($engineResp) {
    $engineData = @json_decode($engineResp, true);
    $engineTools = $engineData['tools'] ?? [];
    if (is_array($engineTools)) {
        foreach ($engineTools as $t) {
            if (!is_array($t) || empty($t['name'])) continue;
            // Convert engine format to OpenAI function calling format
            $exists = false;
            foreach ($tools as $existing) {
                if (($existing['function']['name'] ?? '') === $t['name']) { $exists = true; break; }
            }
            if ($exists) continue;
            // ★ 修复空 schema：PHP json_decode('{}') → []，必须检查
            $schema = $t['input_schema'] ?? $t['parameters'] ?? [];
            if (!is_array($schema) || empty($schema['type'])) {
                $schema = ['type' => 'object', 'properties' => new stdClass(), 'required' => []];
            }
            if (!isset($schema['properties']) || !is_array($schema['properties'])) {
                $schema['properties'] = new stdClass();
            }
            if (!isset($schema['required'])) {
                $schema['required'] = [];
            }
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

// 合并额外工具（引擎未注册的端点）
foreach ($extraTools as $et) {
    $exists = false;
    foreach ($tools as $existing) {
        if (($existing['function']['name'] ?? '') === $et['function']['name']) { $exists = true; break; }
    }
    if (!$exists) $tools[] = $et;
}

echo json_encode(['object' => 'list', 'data' => $tools], JSON_UNESCAPED_UNICODE);
