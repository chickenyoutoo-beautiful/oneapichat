<?php
/**
 * OneAPIChat API v1 — Conversations (对话同步)
 *
 * GET    /conversations        — 列出所有对话
 * GET    /conversations?id=xxx — 获取单个对话
 * POST   /conversations        — 创建/更新对话
 * DELETE /conversations?id=xxx — 删除对话
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
$namespace = 'user_' . $userIdSafe;
$dataDir = ONECHAT_ROOT . '/chat_data/';

if (!is_dir($dataDir)) @mkdir($dataDir, 0755, true);

$method = $_SERVER['REQUEST_METHOD'];
$chatId = isset($_GET['id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['id']) : null;

switch ($method) {
    case 'GET':
        if ($chatId) {
            // 获取单个对话
            $filename = $dataDir . $namespace . '_' . $chatId . '.json';
            if (file_exists($filename)) {
                $data = json_decode(file_get_contents($filename), true);
                echo json_encode(_formatConversation($data), JSON_UNESCAPED_UNICODE);
            } else {
                http_response_code(404);
                echo json_encode(['error' => ['message' => 'Conversation not found', 'type' => 'not_found', 'code' => 'NOT_FOUND']]);
            }
        } else {
            // 列出所有对话（摘要）
            $conversations = [];
            $pattern = $dataDir . $namespace . '_*.json';
            $files = glob($pattern);
            if ($files === false) $files = [];
            foreach ($files as $file) {
                $basename = basename($file, '.json');
                if (strpos($basename, 'config_') === 0) continue;
                $cid = substr($basename, strlen($namespace) + 1);
                if ($cid === 'all') {
                    // all.json 包含聚合数据
                    $allData = json_decode(file_get_contents($file), true);
                    if ($allData && isset($allData['chats'])) {
                        foreach ($allData['chats'] as $cId => $cData) {
                            $conversations[] = _formatSummary($cId, $cData);
                        }
                    }
                    continue;
                }
                $cData = json_decode(file_get_contents($file), true);
                if ($cData) $conversations[] = _formatSummary($cid, $cData);
            }
            echo json_encode(['object' => 'list', 'data' => $conversations], JSON_UNESCAPED_UNICODE);
        }
        break;

    case 'POST':
        $input = json_decode(file_get_contents('php://input'), true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            http_response_code(400);
            echo json_encode(['error' => ['message' => 'Invalid JSON', 'type' => 'invalid_request_error', 'code' => 'INVALID_JSON']]);
            exit;
        }

        $cid = $input['id'] ?? $input['chat_id'] ?? ('chat_' . (time() * 1000));
        $cid = preg_replace('/[^a-zA-Z0-9_-]/', '', $cid);

        if (strlen($cid) < 1 || strlen($cid) > 128) {
            http_response_code(400);
            echo json_encode(['error' => ['message' => 'Invalid id', 'type' => 'invalid_request_error']]);
            exit;
        }

        $filename = $dataDir . $namespace . '_' . $cid . '.json';
        $existing = file_exists($filename) ? json_decode(file_get_contents($filename), true) : [];

        $data = array_merge(is_array($existing) ? $existing : [], $input);
        $data['id'] = $cid;
        $data['updated_at'] = date('c');
        if (!isset($data['created_at']) && empty($existing)) {
            $data['created_at'] = date('c');
        }

        if (@file_put_contents($filename, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR), LOCK_EX) !== false) {
            @chmod($filename, 0666);
            echo json_encode(_formatConversation($data), JSON_UNESCAPED_UNICODE);
        } else {
            http_response_code(500);
            echo json_encode(['error' => ['message' => 'Failed to save', 'type' => 'server_error']]);
        }
        break;

    case 'DELETE':
        if (!$chatId) {
            http_response_code(400);
            echo json_encode(['error' => ['message' => 'id parameter required', 'type' => 'invalid_request_error']]);
            exit;
        }
        $filename = $dataDir . $namespace . '_' . $chatId . '.json';
        $deleted = false;
        if (file_exists($filename)) {
            @unlink($filename);
            $deleted = true;
        }
        // 同时从 all.json 移除
        $allFile = $dataDir . $namespace . '_all.json';
        if (file_exists($allFile)) {
            $allData = json_decode(file_get_contents($allFile), true);
            if ($allData && isset($allData['chats'][$chatId])) {
                unset($allData['chats'][$chatId]);
                @file_put_contents($allFile, json_encode($allData, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR), LOCK_EX);
                $deleted = true;
            }
        }
        if ($deleted) {
            echo json_encode(['success' => true, 'id' => $chatId, 'deleted' => true]);
        } else {
            http_response_code(404);
            echo json_encode(['error' => ['message' => 'Conversation not found', 'type' => 'not_found']]);
        }
        break;

    default:
        http_response_code(405);
        echo json_encode(['error' => ['message' => 'Method not allowed', 'type' => 'invalid_request_error']]);
}

// ── 格式化 ──
function _formatConversation(array $data): array {
    $msgs = $data['messages'] ?? [];
    return [
        'id' => $data['id'] ?? $data['chat_id'] ?? '',
        'object' => 'conversation',
        'title' => $data['title'] ?? '',
        'messages' => $msgs,
        'message_count' => count($msgs),
        'created_at' => $data['created_at'] ?? '',
        'updated_at' => $data['updated_at'] ?? '',
    ];
}

function _formatSummary(string $cid, array $data): array {
    $msgs = $data['messages'] ?? [];
    $lastMsg = !empty($msgs) ? end($msgs) : null;
    return [
        'id' => $cid,
        'object' => 'conversation',
        'title' => $data['title'] ?? '',
        'message_count' => count($msgs),
        'last_message' => $lastMsg ? mb_substr(is_string($lastMsg['content'] ?? '') ? $lastMsg['content'] : '', 0, 100) : null,
        'created_at' => $data['created_at'] ?? '',
        'updated_at' => $data['updated_at'] ?? '',
    ];
}
