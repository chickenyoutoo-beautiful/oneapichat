<?php
/**
 * OneAPIChat 记忆系统 API
 * 
 * 跨会话记忆:
 * - save_memory: 保存一条记忆 (key + content)
 * - get_memories: 获取用户的所有记忆
 * - search_memories: 语义搜索记忆（简单关键词匹配）
 * - delete_memory: 删除一条记忆
 * - summarize_memories: AI 摘要压缩
 */

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = [
    'https://xiaoxin.naujtrats.xyz', 'https://naujtrats.xyz',
    'https://www.naujtrats.xyz', 'https://aliyun.naujtrats.xyz',
];
if (!in_array($origin, $allowedOrigins, true) && $origin) {
    $originHost = parse_url($origin, PHP_URL_HOST);
    $serverHost = $_SERVER['HTTP_HOST'] ?? '';
    if ($originHost && $originHost === $serverHost) $allowedOrigins[] = $origin;
}
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
} else {
    header('Access-Control-Allow-Origin: *');
}
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$usersDir = dirname(__DIR__) . '/users/';
$sessionsFile = $usersDir . 'sessions.json';

function readJson($p) {
    if (!file_exists($p)) return [];
    $raw = file_get_contents($p);
    if ($raw === false || trim($raw) === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        $backup = $p . '.corrupted.' . date('Ymd_His');
        @rename($p, $backup);
        error_log('[memory_api] Corrupted JSON: ' . $backup);
        return [];
    }
    return $data;
}
function writeJson($p, $d) {
    $tmpPath = $p . '.' . getmypid() . '.tmp';
    $json = json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false) return false;
    if (@file_put_contents($tmpPath, $json, LOCK_EX) === false) return false;
    if (!@rename($tmpPath, $p)) { @unlink($tmpPath); return false; }
    return true;
}
function jsonError($c, $m) { http_response_code($c); echo json_encode(['error'=>$m]); exit; }
function jsonSuccess($d=[]) { echo json_encode(array_merge(['success'=>true], $d)); exit; }

// 验证 token
$token = $_GET['token'] ?? $_POST['token'] ?? '';
if (!$token) jsonError(401, '未登录');

$sessions = readJson($sessionsFile);
$userId = $sessions[$token]['user_id'] ?? null;
if (!$userId) jsonError(401, '登录已过期');

$memoryFile = $usersDir . 'memories_' . $userId . '.json';

function loadMemories(string $file): array {
    $m = readJson($file);
    return $m['memories'] ?? [];
}
function saveMemories($file, $memories) {
    $data = ['memories' => $memories, 'updated_at' => date('c')];
    return writeJson($file, $data);
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST' && $action === 'save_memory') {
    $input = json_decode(file_get_contents('php://input'), true);
    $key = trim($input['key'] ?? '');
    $content = trim($input['content'] ?? '');
    if (!$key || !$content) jsonError(400, 'key 和 content 不能为空');

    $memories = loadMemories($memoryFile);
    // 去重: 同名 key 则更新
    $found = false;
    foreach ($memories as &$m) {
        if ($m['key'] === $key) {
            $m['content'] = $content;
            $m['updated_at'] = date('c');
            $found = true;
            break;
        }
    }
    if (!$found) {
        $entry = ['key' => $key, 'content' => $content, 'created_at' => date('c'), 'updated_at' => date('c')];
        // ★ 生成 embedding（异步不阻塞保存）
        $embedding = getEmbedding($content);
        if ($embedding) $entry['embedding'] = $embedding;
        $memories[] = $entry;
    } else {
        // 更新时重新生成 embedding
        $embedding = getEmbedding($content);
        if ($embedding) $m['embedding'] = $embedding;
    }
    // 限制最多50条
    if (count($memories) > 50) $memories = array_slice($memories, -50);

    if (!saveMemories($memoryFile, $memories)) jsonError(500, '保存失败');
    jsonSuccess(['count' => count($memories)]);

} elseif ($method === 'GET' && $action === 'get_memories') {
    $memories = loadMemories($memoryFile);
    jsonSuccess(['memories' => $memories]);

} elseif ($method === 'GET' && $action === 'search_memories') {
    $query = trim($_GET['q'] ?? '');
    $memories = loadMemories($memoryFile);
    if (!$query) { jsonSuccess(['memories' => $memories]); exit; }

    // 混合搜索: 关键词(快) + 语义(有embedding时)
    $queryLower = mb_strtolower($query);
    $results = [];
    $useSemantic = ($_GET['semantic'] ?? '1') === '1';

    // 尝试语义搜索（如果记忆有embedding且用户配置了API）
    if ($useSemantic) {
        $hasEmbeddings = false;
        foreach ($memories as $m) {
            if (!empty($m['embedding'])) { $hasEmbeddings = true; break; }
        }
        if ($hasEmbeddings) {
            $queryEmb = getEmbedding($query);
            if ($queryEmb) {
                foreach ($memories as &$m) {
                    if (!empty($m['embedding'])) {
                        $m['semantic_score'] = cosineSimilarity($queryEmb, $m['embedding']);
                    }
                }
            }
        }
    }

    // 关键词匹配 + 语义得分 + 时间衰减
    $now = time();
    foreach ($memories as &$m) {
        $score = 0;
        if (mb_stripos($m['key'], $queryLower) !== false) $score += 3;
        if (mb_stripos($m['content'], $queryLower) !== false) $score += 1;
        // 语义得分加权
        if (isset($m['semantic_score']) && $m['semantic_score'] > 0.3) {
            $score += $m['semantic_score'] * 5;
        }
        // 时间衰减: 每30天衰减一半
        $updatedAt = strtotime($m['updated_at'] ?? $m['created_at'] ?? 'now');
        $ageDays = max(0, ($now - $updatedAt) / 86400);
        $decay = pow(0.5, $ageDays / 30);
        $m['final_score'] = $score * $decay;
        $m['score'] = $score; // 保持兼容
        if ($score > 0 || (isset($m['semantic_score']) && $m['semantic_score'] > 0.5)) {
            $results[] = $m;
        }
    }
    usort($results, function($a, $b) { return $b['final_score'] - $a['final_score']; });
    jsonSuccess(['memories' => array_slice($results, 0, 10)]);

} elseif ($method === 'POST' && $action === 'delete_memory') {
    $input = json_decode(file_get_contents('php://input'), true);
    $key = trim($input['key'] ?? '');
    if (!$key) jsonError(400, '缺少 key');

    $memories = loadMemories($memoryFile);
    $memories = array_values(array_filter($memories, function($m) use ($key) {
        return $m['key'] !== $key;
    }));
    if (!saveMemories($memoryFile, $memories)) jsonError(500, '删除失败');
    jsonSuccess(['count' => count($memories)]);

} elseif ($action === 'context_string') {
    // 生成注入到 API 调用的上下文字符串
    $memories = loadMemories($memoryFile);
    if (empty($memories)) { jsonSuccess(['context' => '']); exit; }

    // 去重后的记忆列表
    $lines = [];
    foreach ($memories as $m) {
        $lines[] = '- [' . $m['key'] . '] ' . $m['content'];
    }
    $context = "## 长期记忆\n以下是用户之前告知的偏好、决策和个人信息:\n" . implode("\n", $lines);
    jsonSuccess(['context' => $context, 'count' => count($memories)]);

} elseif ($action === 'smart_context') {
    // 智能上下文: 返回最近 N 条记忆，按更新时间排序
    $limit = max(1, min(20, intval($_GET['limit'] ?? 5)));
    $memories = loadMemories($memoryFile);
    if (empty($memories)) { jsonSuccess(['context' => '', 'count' => 0]); exit; }

    // 按 updated_at 倒序
    usort($memories, function($a, $b) {
        return strcmp($b['updated_at'] ?? $b['created_at'] ?? '', $a['updated_at'] ?? $a['created_at'] ?? '');
    });
    $recent = array_slice($memories, 0, $limit);

    $lines = [];
    foreach ($recent as $m) {
        $lines[] = '- [' . $m['key'] . '] ' . $m['content'];
    }
    $context = "## 用户记忆\n以下是用户之前告知的偏好和信息:\n" . implode("\n", $lines);
    jsonSuccess(['context' => $context, 'count' => count($recent), 'total' => count($memories)]);

} else {
    jsonError(400, '未知操作: ' . $action);
}

// ═══════════════════════════════════════════════════════
// 语义搜索辅助: Embedding API 调用 + 余弦相似度
// ═══════════════════════════════════════════════════════

/**
 * 调用配置的 AI API 生成文本 embedding
 * 复用用户的 API 配置（baseUrl + apiKey）
 */
function getEmbedding(string $text): ?array {
    static $configCache = null;
    if ($configCache === null) {
        // 尝试读取用户配置
        $configDir = dirname(__DIR__) . '/config/';
        $configFile = $configDir . '.mmx_config.json';
        $configCache = [];
        if (file_exists($configFile)) {
            $cfg = json_decode(file_get_contents($configFile), true);
            if (is_array($cfg)) $configCache = $cfg;
        }
    }

    $baseUrl = $configCache['api_base'] ?? $configCache['base_url'] ?? '';
    $apiKey = $configCache['api_key'] ?? $configCache['mmx_api_key'] ?? '';
    if (!$baseUrl || !$apiKey) return null;

    // 构建 embedding 请求（OpenAI 兼容格式）
    $embedUrl = rtrim($baseUrl, '/') . '/embeddings';
    $body = json_encode([
        'model' => $configCache['embed_model'] ?? 'text-embedding-3-small',
        'input' => mb_substr($text, 0, 2048),
    ]);

    $ch = curl_init($embedUrl);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $apiKey,
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code !== 200 || !$resp) return null;
    $data = json_decode($resp, true);
    $embedding = $data['data'][0]['embedding'] ?? null;
    return $embedding;
}

/**
 * 余弦相似度（两个等长向量）
 */
function cosineSimilarity(array $a, array $b): float {
    $dot = 0.0; $normA = 0.0; $normB = 0.0;
    $len = min(count($a), count($b));
    for ($i = 0; $i < $len; $i++) {
        $dot += $a[$i] * $b[$i];
        $normA += $a[$i] * $a[$i];
        $normB += $b[$i] * $b[$i];
    }
    if ($normA == 0.0 || $normB == 0.0) return 0.0;
    return $dot / (sqrt($normA) * sqrt($normB));
}
