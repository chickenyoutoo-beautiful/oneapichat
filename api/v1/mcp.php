<?php
/**
 * OneAPIChat API v1 — MCP Streamable HTTP Endpoint
 *
 * POST /oneapichat/api/v1/mcp
 *
 * 实现标准 MCP (Model Context Protocol) Streamable HTTP 传输层。
 * 对外暴露标准 JSON-RPC 2.0 接口 (initialize / tools/list / tools/call)，
 * 内部翻译成 Node.js MCP Server (port 18788) 的自定义协议。
 *
 * 这样 OpenClaw / Claude Code / Cursor 等标准 MCP 客户端即可直接连接。
 */

require_once __DIR__ . '/../init.php';
require_once __DIR__ . '/../auth_helpers.php';

// ── CORS + 缓存控制 ──
setApiCorsHeaders();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// 仅接受 POST (MCP Streamable HTTP 的 JSON-RPC 请求)
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJsonRpcError(null, -32600, 'Method not allowed, use POST');
    exit;
}

// ── 读取请求体 ──
$raw = file_get_contents('php://input');
$req = json_decode($raw, true);
if (!is_array($req)) {
    sendJsonRpcError(null, -32700, 'Parse error: invalid JSON');
    exit;
}

// ── 认证: 可选 (个人服务器) ──
// 支持三种 token:
//   1. API Key (oac-<48hex>)  → verifyApiKey
//   2. Session Token           → verifyAuthToken
//   3. OAuth Bearer (oat-*)    → 内部签发，直接信任
// 无 token 也允许访问 (个人服务器), 自动回退到最近活跃用户
$bearerToken = extractBearerToken();
$authenticated = false;
$userId = '';
if ($bearerToken) {
    // OAuth token (oat-*) — 直接信任
    if (str_starts_with($bearerToken, 'oat-')) {
        $authenticated = true;
    } else {
        $userId = verifyApiKey($bearerToken) ?: verifyAuthToken($bearerToken);
        $authenticated = !empty($userId);
    }
}
// ★ 无认证时, 自动获取最近活跃用户 (个人服务器通常只有一个用户)
if (!$userId) {
    try {
        $dbPath = ONECHAT_ROOT . '/users/oneapichat.db';
        if (file_exists($dbPath)) {
            $pdo = new PDO("sqlite:$dbPath");
            // 从 sessions 表找最近活跃的用户
            $stmt = $pdo->prepare("SELECT user_id FROM sessions ORDER BY created_at DESC LIMIT 1");
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row && !empty($row['user_id'])) {
                $userId = $row['user_id'];
            }
        }
    } catch (Exception $e) {}
    // DB  fallback: 从 JSON sessions 文件找
    if (!$userId) {
        $sessionsFile = ONECHAT_ROOT . '/users/sessions.json';
        if (file_exists($sessionsFile)) {
            $sessions = json_decode(file_get_contents($sessionsFile), true) ?: [];
            if (!empty($sessions)) {
                // 找最近创建的 session
                $latest = null;
                $latestTime = 0;
                foreach ($sessions as $t => $info) {
                    if (($info['created_at'] ?? 0) > $latestTime) {
                        $latestTime = $info['created_at'];
                        $latest = $info;
                    }
                }
                if ($latest && !empty($latest['user_id'])) {
                    $userId = $latest['user_id'];
                }
            }
        }
    }
}

// ── 内部 MCP Server 代理 ──
$MCP_HOST = 'http://127.0.0.1:18788';

// ── 分发 JSON-RPC 方法 ──
$method = $req['method'] ?? '';
$reqId  = $req['id'] ?? null;
$params = $req['params'] ?? [];

switch ($method) {
    case 'initialize':
        // 首次握手 — 返回服务器能力
        // MCP Streamable HTTP 要求返回 Mcp-Session-Id 头 (RFC 的 Session Management)
        $sessionId = 'mcp-' . bin2hex(random_bytes(16));
        header('Mcp-Session-Id: ' . $sessionId);
        header('Access-Control-Expose-Headers: Mcp-Session-Id');
        sendJsonRpcResult($reqId, [
            'protocolVersion' => '2024-11-05',
            'capabilities'    => ['tools' => ['listChanged' => false]],
            'serverInfo'      => ['name' => 'oneapichat-mcp', 'version' => '1.0.0'],
        ]);
        break;

    case 'notifications/initialized':
    case 'notifications/cancelled':
        // 通知类 — 无需响应
        http_response_code(204);
        break;

    case 'tools/list':
        // 直接透传内部 MCP 的原始 JSON，避免 PHP json_decode 把空对象 {} 变成空数组 []
        $rawTools = fetchAllToolsRaw($MCP_HOST);
        if ($rawTools !== null) {
            // ★ 修复 analyze_image schema: 补充 image_url/image_path/focus 参数
            $rawTools = fixAnalyzeImageSchema($rawTools);
            header('Content-Type: application/json; charset=utf-8');
            echo $rawTools;
            exit;
        }
        $tools = fetchAllTools($MCP_HOST);
        $tools = fixAnalyzeImageSchemaArr($tools);
        sendJsonRpcResult($reqId, ['tools' => $tools]);
        break;

    case 'tools/call':
        $toolName  = $params['name'] ?? '';
        $arguments = $params['arguments'] ?? [];
        if (!$toolName) {
            sendJsonRpcError($reqId, -32602, 'Missing tool name');
            break;
        }
        // ★ analyze_image 服务器端执行 (读取数据库 xAI key, 不依赖浏览器)
        //    支持两种认证: 1) 通过 API Key/Session Token 认证  2) 通过 arguments 传入 user_id
        if ($toolName === 'analyze_image') {
            // 方式1: 已认证用户
            if ($userId) {
                sendJsonRpcResult($reqId, analyzeImageServerSide($userId, $arguments));
                break;
            }
            // 方式2: 通过 arguments.user_id 指定用户 (无认证场景)
            if (!empty($arguments['user_id'])) {
                $argUserId = preg_replace('/[^a-zA-Z0-9_-]/', '', $arguments['user_id']);
                if ($argUserId) {
                    sendJsonRpcResult($reqId, analyzeImageServerSide($argUserId, $arguments));
                    break;
                }
            }
            // 方式3: 无用户信息, 尝试用 arguments 中的 image_url 直接调用 xAI (需要 arguments.api_key)
            if (!empty($arguments['image_url']) && !empty($arguments['api_key'])) {
                sendJsonRpcResult($reqId, analyzeImageWithKey($arguments));
                break;
            }
        }
        sendJsonRpcResult($reqId, callMcpTool($MCP_HOST, $toolName, $arguments));
        break;

    case 'ping':
        sendJsonRpcResult($reqId, []);
        break;

    default:
        sendJsonRpcError($reqId, -32601, 'Method not found: ' . $method);
        break;
}

exit;

// ============================================================
// 内部 MCP Server 交互
// ============================================================

/**
 * 直接透传内部 MCP 的原始 JSON 字符串（避免 PHP json_decode 把 {} 变成 []）
 * 合并主工具 + bilibili 工具，返回标准 JSON-RPC 响应字符串
 */
function fetchAllToolsRaw(string $mcpHost): ?string
{
    $allTools = [];
    foreach (['/mcp/api/tools', '/mcp/bilibili/tools'] as $endpoint) {
        $resp = @file_get_contents($mcpHost . $endpoint, false, stream_context_create([
            'http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\n", 'timeout' => 5, 'ignore_errors' => true],
        ]));
        if ($resp) {
            $data = json_decode($resp, true);
            if (isset($data['tools']) && is_array($data['tools'])) {
                foreach ($data['tools'] as $t) {
                    if (!empty($t['name'])) $allTools[$t['name']] = $t;
                }
            }
        }
    }
    if (empty($allTools)) return null;
    // 递归将空数组转为 stdClass，确保 JSON 编码为 {} 而非 []
    $result = ['jsonrpc' => '2.0', 'id' => 1, 'result' => ['tools' => array_values($allTools)]];
    $result = fixEmptyArrays($result);
    return json_encode($result, JSON_UNESCAPED_UNICODE);
}

/**
 * 递归修复 schema 中的空数组问题
 * 仅对 inputSchema.properties 的空数组转为 {}（JSON 对象）
 * 其他字段（如 required, tools 列表）保持原样
 */
function fixEmptyArrays($value)
{
    if (is_array($value)) {
        // 数字索引数组（如 tools 列表、required 列表）— 保持数组，递归处理元素
        if (array_keys($value) === range(0, count($value) - 1)) {
            return array_map('fixEmptyArrays', $value);
        }
        // 关联数组（如 inputSchema）— 检查 properties 字段
        if (isset($value['properties']) && is_array($value['properties']) && empty($value['properties'])) {
            $value['properties'] = new stdClass();
        }
        // 递归处理嵌套数组/对象字段
        foreach ($value as $k => $v) {
            if (is_array($v) && $k !== 'properties') {
                $value[$k] = fixEmptyArrays($v);
            }
        }
    }
    return $value;
}

/**
 * 从内部 MCP Server 加载全部工具列表 (合并主工具 + bilibili 工具)
 */
function fetchAllTools(string $mcpHost): array
{
    $allTools = [];

    foreach (['/mcp/api/tools', '/mcp/bilibili/tools'] as $endpoint) {
        $resp = @file_get_contents($mcpHost . $endpoint, false, stream_context_create([
            'http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\n", 'timeout' => 5, 'ignore_errors' => true],
        ]));
        if ($resp) {
            $data = json_decode($resp, true);
            if (isset($data['tools']) && is_array($data['tools'])) {
                foreach ($data['tools'] as $t) {
                    if (!empty($t['name'])) $allTools[$t['name']] = $t;
                }
            }
        }
    }

    return array_values($allTools);
}

// ★ analyze_image 完整参数定义 (MCP 工具列表用)
function getAnalyzeImageFullSchema(): array {
    return [
        'name' => 'analyze_image',
        'description' => '分析图片内容。支持 URL、本地路径、聊天历史图片。使用服务器端配置的 xAI/OpenAI key 或传入 api_key。',
        'inputSchema' => [
            'type' => 'object',
            'properties' => [
                'image_url' => ['type' => 'string', 'description' => '图片 URL（http/https）或 data:image/... base64'],
                'image_path' => ['type' => 'string', 'description' => '服务器本地图片路径（需在 uploads 目录内）'],
                'image_index' => ['type' => 'integer', 'description' => '从聊天历史中获取第 N 张图片（0=第一张）'],
                'focus' => ['type' => 'string', 'description' => '分析重点，如"人物特征"、"文字识别"等'],
                'api_key' => ['type' => 'string', 'description' => '★ 直接传入 API Key（无认证场景）'],
                'provider' => ['type' => 'string', 'description' => '视觉提供商: "xai" (默认) / "openai"'],
                'model' => ['type' => 'string', 'description' => '模型名: "grok-4.5" (默认) / "gpt-4o"'],
            ],
            'required' => [],
        ],
        'capabilities' => [],
    ];
}

/** 修复 JSON 字符串中的 analyze_image schema */
function fixAnalyzeImageSchema(string $jsonStr): string {
    $data = json_decode($jsonStr, true);
    if (!$data || !isset($data['result']['tools'])) return $jsonStr;
    $tools = $data['result']['tools'];
    $found = false;
    foreach ($tools as $i => $t) {
        if (($t['name'] ?? '') === 'analyze_image') {
            $tools[$i] = getAnalyzeImageFullSchema();
            $found = true;
            break;
        }
    }
    if (!$found) {
        $tools[] = getAnalyzeImageFullSchema();
    }
    $data['result']['tools'] = $tools;
    return json_encode($data, JSON_UNESCAPED_UNICODE);
}

/** 修复数组中的 analyze_image schema */
function fixAnalyzeImageSchemaArr(array $tools): array {
    $found = false;
    foreach ($tools as $i => $t) {
        if (($t['name'] ?? '') === 'analyze_image') {
            $tools[$i] = getAnalyzeImageFullSchema();
            $found = true;
            break;
        }
    }
    if (!$found) {
        $tools[] = getAnalyzeImageFullSchema();
    }
    return $tools;
}

/**
 * 调用内部 MCP 工具，返回标准 MCP 格式结果
 */
function callMcpTool(string $mcpHost, string $name, array $arguments): array
{
    $endpoint = str_starts_with($name, 'bilibili_') ? '/mcp/bilibili/tools/call' : '/mcp/api/tools/call';

    $payload = json_encode(['name' => $name, 'arguments' => $arguments]);
    $ctx     = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/json\r\n",
        'content' => $payload,
        'timeout' => 120,
        'ignore_errors' => true,
    ]]);

    $resp = @file_get_contents($mcpHost . $endpoint, false, $ctx);
    if ($resp === false) {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => 'MCP server unreachable for tool: ' . $name]]];
    }

    $data = json_decode($resp, true);
    if (!is_array($data)) {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => 'Invalid MCP response for tool: ' . $name]]];
    }

    // 错误响应
    if (isset($data['error'])) {
        $errMsg = is_string($data['error']) ? $data['error'] : ($data['error']['message'] ?? json_encode($data['error']));
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => 'Tool error: ' . $errMsg]]];
    }

    // 成功 — 提取结果
    $result = $data['result'] ?? $data;

    // 如果 result 已经是 MCP content 格式 (有 content 数组)
    if (isset($result['content']) && is_array($result['content'])) {
        return $result;
    }

    // 否则把 result 序列化为文本
    $text = is_string($result) ? $result : json_encode($result, JSON_UNESCAPED_UNICODE);
    return ['isError' => false, 'content' => [['type' => 'text', 'text' => $text]]];
}

// ============================================================
// JSON-RPC 响应辅助
// ============================================================

function sendJsonRpcResult($id, $result): void
{
    echo json_encode(['jsonrpc' => '2.0', 'id' => $id, 'result' => $result], JSON_UNESCAPED_UNICODE);
}

function sendJsonRpcError($id, int $code, string $msg): void
{
    echo json_encode(['jsonrpc' => '2.0', 'id' => $id, 'error' => ['code' => $code, 'message' => $msg]], JSON_UNESCAPED_UNICODE);
}

// ============================================================
// ★ analyze_image 服务器端执行 (供 MCP 第三方客户端使用)
// 从数据库读取用户配置的 xAI/OpenAI key, 直接调用视觉 API
// ============================================================
function analyzeImageServerSide(string $userId, array $arguments): array
{
    $focus = $arguments['focus'] ?? '请详细描述这张图片的内容,包括物体、场景、文字等可见信息。';
    $imgIdx = isset($arguments['image_index']) ? intval($arguments['image_index']) : 0;

    // 1. 读取用户配置 (DB 优先)
    $cfg = [];
    $dbPath = ONECHAT_ROOT . '/users/oneapichat.db';
    if (file_exists($dbPath)) {
        try {
            $pdo = new PDO("sqlite:$dbPath");
            $stmt = $pdo->prepare("SELECT config_json FROM user_config WHERE user_id = ?");
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row) $cfg = json_decode($row['config_json'], true) ?: [];
        } catch (Exception $e) {}
    }
    if (empty($cfg)) {
        $cfgFile = ONECHAT_ROOT . '/chat_data/config_' . $userId . '.json';
        if (file_exists($cfgFile)) $cfg = json_decode(file_get_contents($cfgFile), true) ?: [];
    }

    // 2. 确定视觉提供商和 key
    $visProvider = $cfg['visionProvider'] ?? 'minimax';
    $visKey = '';
    $visUrl = '';
    $visModel = '';
    if ($visProvider === 'xai') {
        $visKey = decrypt_config_key($cfg['visionApiKeyXAI'] ?? '');
        $visUrl = ($cfg['visionApiUrlXAI'] ?? '') ?: 'https://api.x.ai/v1';
        $visModel = ($cfg['visionModel'] ?? '') ?: 'grok-4.5';
    } elseif ($visProvider === 'openai') {
        $visKey = decrypt_config_key($cfg['visionApiKeyOpenAI'] ?? '');
        $visUrl = ($cfg['visionApiUrlOpenAI'] ?? '') ?: 'https://api.openai.com/v1';
        $visModel = ($cfg['visionModel'] ?? '') ?: 'gpt-4o';
    } else {
        $visKey = decrypt_config_key($cfg['visionApiKey'] ?? '');
        $visUrl = ($cfg['visionApiUrl'] ?? '') ?: 'https://api.minimaxi.com/v1/coding_plan/vlm';
        $visModel = ($cfg['visionModel'] ?? '') ?: 'MiniMax-VL-01';
    }

    // 3. key 为空则回退到主模型
    if (!$visKey) {
        $mainKey = $cfg['apiKey'] ?? '';
        $mainBaseUrl = $cfg['baseUrl'] ?? '';
        $mainModel = $cfg['model'] ?? '';
        if ($mainKey && $mainBaseUrl && $mainModel) {
            $visKey = $mainKey;
            $visUrl = rtrim($mainBaseUrl, '/');
            if (strpos($visUrl, '/chat/completions') === false) {
                $visUrl = preg_replace('/\/v1\/?$/', '', $visUrl) . '/v1';
            }
            $visModel = $mainModel;
        } else {
            return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 视觉分析需要配置 API Key。请在设置中填写 visionApiKey (MiniMax) 或 visionApiKeyXAI (xAI) 或确保主模型 key 可用。']]];
        }
    }

    // 4. 获取图片 (从上传目录或 URL)
    $imageB64 = '';
    if (isset($arguments['image_url']) && $arguments['image_url']) {
        // 直接传入 URL
        $imgUrl = $arguments['image_url'];
        if (preg_match('#^/#', $imgUrl)) $imgUrl = 'https://naujtrats.xyz' . $imgUrl;
        $imgData = @file_get_contents($imgUrl, false, stream_context_create(['http' => ['timeout' => 15, 'ignore_errors' => true]]));
        if ($imgData) $imageB64 = 'data:image/jpeg;base64,' . base64_encode($imgData);
    } elseif (isset($arguments['image_path']) && $arguments['image_path']) {
        // 服务器本地路径
        $realPath = realpath($arguments['image_path']);
        $uploadBase = realpath(ONECHAT_ROOT . '/uploads');
        if ($realPath && $uploadBase && strpos($realPath, $uploadBase) === 0 && is_file($realPath)) {
            $imageB64 = 'data:image/jpeg;base64,' . base64_encode(file_get_contents($realPath));
        }
    } else {
        // 从聊天历史中查找图片
        $chatDataFiles = glob(ONECHAT_ROOT . '/chat_data/' . $userId . '_*.json');
        foreach ($chatDataFiles as $cf) {
            $chatData = json_decode(file_get_contents($cf), true);
            if (!$chatData || !isset($chatData['chats'])) continue;
            foreach ($chatData['chats'] as $chat) {
                foreach (($chat['messages'] ?? []) as $msg) {
                    $files = $msg['files'] ?? [];
                    $imgFiles = array_filter($files, function($f) {
                        return ($f['isImage'] || (isset($f['type']) && strpos($f['type'], 'image/') === 0));
                    });
                    $imgFiles = array_values($imgFiles);
                    if (isset($imgFiles[$imgIdx])) {
                        $f = $imgFiles[$imgIdx];
                        if (!empty($f['serverUrl'])) {
                            $su = $f['serverUrl'];
                            if (preg_match('#^/#', $su)) $su = 'https://naujtrats.xyz' . $su;
                            $imgData = @file_get_contents($su, false, stream_context_create(['http' => ['timeout' => 15, 'ignore_errors' => true]]));
                            if ($imgData) { $imageB64 = 'data:image/jpeg;base64,' . base64_encode($imgData); break 3; }
                            // 尝试本地路径
                            $localPath = ONECHAT_ROOT . '/uploads' . preg_replace('#^/oneapichat#', '', $f['serverUrl']);
                            if (file_exists($localPath)) { $imageB64 = 'data:image/jpeg;base64,' . base64_encode(file_get_contents($localPath)); break 3; }
                        }
                    }
                }
            }
        }
    }

    if (!$imageB64) {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 未找到可分析的图片。请通过 image_url 参数传入图片 URL，或确保聊天历史中有图片。']]];
    }

    // 5. 调用视觉 API (OpenAI 格式, 适用于 xAI/OpenAI/DeepSeek)
    $apiEndpoint = (strpos($visUrl, '/chat/completions') !== false) ? $visUrl : (rtrim($visUrl, '/') . '/chat/completions');
    $reqBody = [
        'model' => $visModel,
        'messages' => [[
            'role' => 'user',
            'content' => [
                ['type' => 'text', 'text' => $focus],
                ['type' => 'image_url', 'image_url' => ['url' => $imageB64, 'detail' => 'auto']]
            ]
        ]],
        'max_tokens' => 2048,
        'stream' => false
    ];

    // MiniMax 用不同格式
    if ($visProvider === 'minimax' && strpos($visUrl, 'minimax') !== false && strpos($visUrl, '/chat/completions') === false) {
        $apiEndpoint = $visUrl; // MiniMax 专用端点
        $reqBody = [
            'model' => $visModel,
            'prompt' => $focus,
            'image_url' => $imageB64
        ];
    }

    // ★ 始终通过 proxy.php 中继 (走本地 Mihomo 代理, 避免中国大陆封锁)
    $proxyUrl = (isset($_SERVER['HTTP_HOST']) ? ('https://' . $_SERVER['HTTP_HOST']) : 'https://naujtrats.xyz') . '/oneapichat/api/proxy.php';
    $relayBody = json_encode([
        'url' => $apiEndpoint,
        'method' => 'POST',
        'headers' => ['Content-Type' => 'application/json', 'Authorization' => 'Bearer ' . $visKey],
        'body' => $reqBody,
        'proxy' => '__relay_only__',
        'stream' => false,
        'tryDirect' => true
    ]);
    $relayCtx = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\n",
        'content' => $relayBody,
        'timeout' => 180,
        'ignore_errors' => true,
    ]]);
    $resp = @file_get_contents($proxyUrl, false, $relayCtx);
    // proxy.php 返回的是包装后的 JSON, 需要解包
    if ($resp) {
        $relayResp = json_decode($resp, true);
        if (isset($relayResp['body'])) {
            $resp = $relayResp['body'];
        } elseif (isset($relayResp['error'])) {
            return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 代理请求失败: ' . (is_string($relayResp['error']) ? $relayResp['error'] : json_encode($relayResp['error']))]]];
        }
    }

    if (!$resp) {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 视觉 API 请求失败: 无法连接到 ' . parse_url($apiEndpoint, PHP_URL_HOST) . ' (可能需要开启代理)']]];
    }

    $data = json_decode($resp, true);
    if (!$data) {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 视觉 API 返回无效 JSON: ' . substr($resp, 0, 200)]]];
    }

    // 提取结果 (兼容多种格式)
    $result = '';
    if (isset($data['choices'][0]['message']['content'])) {
        $result = $data['choices'][0]['message']['content'];
    } elseif (isset($data['content'])) {
        $result = is_string($data['content']) ? $data['content'] : json_encode($data['content']);
    } elseif (isset($data['result'])) {
        $result = is_string($data['result']) ? $data['result'] : json_encode($data['result']);
    } elseif (isset($data['error'])) {
        $errMsg = is_string($data['error']) ? $data['error'] : json_encode($data['error']);
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 视觉 API 错误: ' . $errMsg]]];
    }

    if (!$result) {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 视觉 API 返回空结果']]];
    }

    return ['isError' => false, 'content' => [['type' => 'text', 'text' => $result]]];
}

// ============================================================
// ★ analyze_image 直接传入 API Key (无用户认证场景)
// ============================================================
function analyzeImageWithKey(array $arguments): array
{
    $focus = $arguments['focus'] ?? '请详细描述这张图片的内容,包括物体、场景、文字等可见信息。';
    $apiKey = $arguments['api_key'] ?? '';
    $provider = strtolower($arguments['provider'] ?? 'xai');
    $imageUrl = $arguments['image_url'] ?? '';

    if (!$apiKey) {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 缺少 api_key 参数']]];
    }
    if (!$imageUrl) {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 缺少 image_url 参数']]];
    }

    // 确定 API 端点和模型
    if ($provider === 'xai') {
        $apiEndpoint = 'https://api.x.ai/v1/chat/completions';
        $model = $arguments['model'] ?? 'grok-4.5';
    } elseif ($provider === 'openai') {
        $apiEndpoint = 'https://api.openai.com/v1/chat/completions';
        $model = $arguments['model'] ?? 'gpt-4o';
    } else {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 不支持的 provider: ' . $provider . ' (支持 xai/openai)']]];
    }

    // 下载图片并转 base64
    $imgData = @file_get_contents($imageUrl, false, stream_context_create(['http' => ['timeout' => 30, 'ignore_errors' => true]]));
    if (!$imgData) {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 无法下载图片: ' . substr($imageUrl, 0, 100)]]];
    }
    $mime = (strpos($imgData, "\xFF\xD8\xFF") === 0) ? 'image/jpeg' : 'image/png';
    $imageB64 = 'data:' . $mime . ';base64,' . base64_encode($imgData);

    // 调用视觉 API (通过代理)
    $reqBody = [
        'model' => $model,
        'messages' => [[
            'role' => 'user',
            'content' => [
                ['type' => 'text', 'text' => $focus],
                ['type' => 'image_url', 'image_url' => ['url' => $imageB64, 'detail' => 'auto']]
            ]
        ]],
        'max_tokens' => 2048,
        'stream' => false
    ];

    $proxyUrl = (isset($_SERVER['HTTP_HOST']) ? ('https://' . $_SERVER['HTTP_HOST']) : 'https://naujtrats.xyz') . '/oneapichat/api/proxy.php';
    $relayBody = json_encode([
        'url' => $apiEndpoint,
        'method' => 'POST',
        'headers' => ['Content-Type' => 'application/json', 'Authorization' => 'Bearer ' . $apiKey],
        'body' => $reqBody,
        'proxy' => '__relay_only__',
        'stream' => false,
        'tryDirect' => true
    ]);
    $relayCtx = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\n",
        'content' => $relayBody,
        'timeout' => 180,
        'ignore_errors' => true,
    ]]);
    $resp = @file_get_contents($proxyUrl, false, $relayCtx);
    if ($resp) {
        $relayResp = json_decode($resp, true);
        if (isset($relayResp['body'])) $resp = $relayResp['body'];
        elseif (isset($relayResp['error'])) {
            return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 代理失败: ' . json_encode($relayResp['error'])]]];
        }
    }

    if (!$resp) {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ API 请求失败']]];
    }
    $data = json_decode($resp, true);
    if (!$data) {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ 返回无效 JSON: ' . substr($resp, 0, 200)]]];
    }
    $result = $data['choices'][0]['message']['content'] ?? '';
    if (!$result && isset($data['error'])) {
        $errMsg = is_string($data['error']) ? $data['error'] : json_encode($data['error']);
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ API 错误: ' . $errMsg]]];
    }
    if (!$result) {
        return ['isError' => true, 'content' => [['type' => 'text', 'text' => '❌ API 返回空结果']]];
    }
    return ['isError' => false, 'content' => [['type' => 'text', 'text' => $result]]];
}
