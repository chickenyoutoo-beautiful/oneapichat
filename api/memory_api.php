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
        $memories[] = ['key' => $key, 'content' => $content, 'created_at' => date('c'), 'updated_at' => date('c')];
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

    // 简单关键词匹配
    $queryLower = mb_strtolower($query);
    $results = [];
    foreach ($memories as $m) {
        $score = 0;
        if (mb_stripos($m['key'], $queryLower) !== false) $score += 3;
        if (mb_stripos($m['content'], $queryLower) !== false) $score += 1;
        if ($score > 0) {
            $m['score'] = $score;
            $results[] = $m;
        }
    }
    usort($results, function($a, $b) { return $b['score'] - $a['score']; });
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
