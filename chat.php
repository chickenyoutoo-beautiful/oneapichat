<?php
/**
 * OneAPIChat 聊天记录存储 API v3 (用户隔离)
 * POST: 保存聊天记录
 * GET: 获取聊天记录列表或单条
 * DELETE: 删除聊天记录
 *
 * 支持两种模式：
 * 1. 用户隔离 (auth_token) - 推荐，每位用户独立数据
 * 2. 向后兼容 (device_id) - 旧版无登录模式
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Auth-Token');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ---- 用户认证辅助 ----
function verifyAuthToken($token) {
    $sessionsFile = __DIR__ . '/users/sessions.json';
    if (!file_exists($sessionsFile)) return null;
    $sessions = @json_decode(@file_get_contents($sessionsFile), true);
    if (!is_array($sessions)) return null;
    $now = time();
    $expireTime = 30 * 24 * 3600;
    foreach ($sessions as $t => $info) {
        if (($now - ($info['created_at'] ?? 0)) > $expireTime) {
            unset($sessions[$t]);
        }
    }
    $info = $sessions[$token] ?? null;
    return $info ? ($info['user_id'] ?? null) : null;
}

$dataDir = __DIR__ . '/chat_data/';
if (!is_dir($dataDir)) {
    if (!@mkdir($dataDir, 0755, true)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to create data directory']);
        exit;
    }
}

if (!is_writable($dataDir)) {
    http_response_code(500);
    echo json_encode(['error' => 'Data directory not writable']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

// 优先使用 auth_token，其次使用 device_id
$authToken = isset($_GET['auth_token']) ? preg_replace('/[^a-f0-9]/', '', $_GET['auth_token']) : '';
$userId = null;
if (!empty($authToken)) {
    $userId = verifyAuthToken($authToken);
}

// ★ user_id GET 参数：强制指定 namespace（解决新注册账号 bfcache 残留问题）
$explicitUid = isset($_GET['user_id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['user_id']) : null;

$namespace = 'default';
if ($explicitUid) {
    // 强制使用指定的 user_id（用于刚注册后 auth_token 正确但 bfcache 残留场景）
    $namespace = 'user_' . $explicitUid;
} elseif ($userId) {
    // 已登录用户：使用 user_id 隔离
    $namespace = 'user_' . preg_replace('/[^a-zA-Z0-9_-]/', '', $userId);
} else {
    // 未登录：向后兼容 device_id
    $namespace = isset($_GET['device_id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['device_id']) : 'default';
    if (strlen($namespace) > 64 || strlen($namespace) < 1) {
        $namespace = 'default';
    }
}

// ★ 配置存储路径
$configDir = __DIR__ . '/chat_data/';
if (!is_dir($configDir)) @mkdir($configDir, 0755, true);

// ★ 用户配置持久化（独立处理）
$action = isset($_GET['action']) ? $_GET['action'] : (isset($_POST['action']) ? $_POST['action'] : '');
if ($action === 'save_config' && $userId && $method === 'POST') {
    $input = file_get_contents('php://input');
    $configFile = $configDir . 'config_' . $namespace . '.json';
    @file_put_contents($configFile, $input, LOCK_EX);
    echo json_encode(['success' => true]);
    exit;
}
if ($action === 'get_config' && $userId && $method === 'GET') {
    $configFile = $configDir . 'config_' . $namespace . '.json';
    if (file_exists($configFile)) {
        readfile($configFile);
    } else {
        echo json_encode((object)[]);
    }
    exit;
}

switch ($method) {
    case 'POST':
        $input = file_get_contents('php://input');
        if ($input === false || $input === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Empty request body']);
            exit;
        }
        $data = json_decode($input, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid JSON: ' . json_last_error_msg()]);
            exit;
        }
        if (!isset($data['chat_id']) || !is_string($data['chat_id']) || trim($data['chat_id']) === '') {
            http_response_code(400);
            echo json_encode(['error' => 'chat_id required']);
            exit;
        }
        
        $chatId = preg_replace('/[^a-zA-Z0-9_-]/', '', $data['chat_id']);
        if (strlen($chatId) < 1 || strlen($chatId) > 128) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid chat_id']);
            exit;
        }
        
        $filename = $dataDir . $namespace . '_' . $chatId . '.json';
        // 防止路径穿越
        if (strpos(realpath(dirname($filename)), realpath($dataDir)) !== 0) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid path']);
            exit;
        }
        
        $data['updated_at'] = date('c');


        $jsonData = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        if ($jsonData === false) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to encode data']);
            exit;
        }
        
        // ★ 备份旧版本
        $backupDir = __DIR__ . '/chat_data/backups/';
        if (file_exists($filename)) {
            @mkdir($backupDir, 0755, true);
            $backupFile = $backupDir . basename($filename) . '.' . date('Ymd-Hi');
            @copy($filename, $backupFile);
            $backups = glob($backupDir . basename($filename) . '.*');
            if (count($backups) > 30) {
                usort($backups, 'strnatcmp');
                foreach (array_slice($backups, 0, count($backups) - 30) as $old) @unlink($old);
            }
        }
        
        if (@file_put_contents($filename, $jsonData, LOCK_EX) !== false) {
            echo json_encode(['success' => true, 'path' => basename($filename)]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to save chat']);
        }
        break;

    case 'GET':
        $chatId = isset($_GET['chat_id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['chat_id']) : null;
        
        if ($chatId) {
            if (strlen($chatId) < 1 || strlen($chatId) > 128) {
                http_response_code(400);
                echo json_encode(['error' => 'Invalid chat_id']);
                exit;
            }
            $filename = $dataDir . $namespace . '_' . $chatId . '.json';
            if (file_exists($filename)) {
                readfile($filename);
            } else {
                http_response_code(404);
                echo json_encode(['error' => 'Chat not found']);
            }
        } else {
            $chats = [];
            $pattern = $dataDir . $namespace . '_*.json';
            $files = glob($pattern);
            if ($files === false) {
                echo json_encode(['chats' => []]);
                break;
            }
            foreach ($files as $file) {
                $basename = basename($file, '.json');
                $chatIdFromFile = substr($basename, strlen($namespace) + 1);
                $content = @json_decode(@file_get_contents($file), true);
                if ($content && isset($content['messages'])) {
                    // 生成标题：使用第一条用户消息
                    $title = $content['title'] ?? null;
                    if (!$title && !empty($content['messages'])) {
                        foreach ($content['messages'] as $msg) {
                            if (($msg['role'] ?? '') === 'user' && !empty($msg['content'])) {
                                $text = is_string($msg['content']) ? $msg['content'] : 
                                       (is_array($msg['content']) ? ($msg['content'][0]['text'] ?? '') : '');
                                $title = mb_strlen($text) > 30 ? mb_substr($text, 0, 30) . '...' : $text;
                                break;
                            }
                        }
                    }
                    $chats[] = [
                        'chat_id' => $chatIdFromFile,
                        'title' => $title ?: '新对话',
                        'message_count' => count($content['messages']),
                        'updated_at' => $content['updated_at'] ?? $content['created_at'] ?? null
                    ];
                }
            }
            usort($chats, function($a, $b) {
                return strcmp($b['updated_at'] ?? '', $a['updated_at'] ?? '');
            });
            echo json_encode(['chats' => $chats], JSON_UNESCAPED_UNICODE);
        }
        break;

    case 'DELETE':
        $chatId = isset($_GET['chat_id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['chat_id']) : null;
        if (!$chatId || strlen($chatId) < 1) {
            http_response_code(400);
            echo json_encode(['error' => 'chat_id required']);
            exit;
        }
        $filename = $dataDir . $namespace . '_' . $chatId . '.json';
        $success = false;
        if (file_exists($filename)) {
            if (@unlink($filename)) $success = true;
        }
        // ★ 也从 all.json 中移除该聊天
        $allFile = $dataDir . $namespace . '_all.json';
        if (file_exists($allFile)) {
            $allData = @json_decode(@file_get_contents($allFile), true);
            if ($allData && isset($allData['chats'][$chatId])) {
                unset($allData['chats'][$chatId]);
                $allData['updated_at'] = date('c');
                if (@file_put_contents($allFile, json_encode($allData, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR), LOCK_EX)) {
                    $success = true;
                }
            }
        }
        if ($success) {
            echo json_encode(['success' => true]);
        } else {
            http_response_code(404);
            echo json_encode(['error' => 'Chat not found']);
        }
        break;

    default:
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
}

