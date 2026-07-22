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

require_once __DIR__ . '/init.php';
setCorsHeaders();

// json_read_file() 由 init.php 提供
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/auth_helpers.php';

$dataDir = ONECHAT_ROOT . '/chat_data/';
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
// ★ 优先从 HTTP Header 读取 (避免 URL 明文传输)
$authHeader = '';
if (function_exists('getallheaders')) {
    $headers = getallheaders();
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    if ($authHeader && strpos($authHeader, 'Bearer ') === 0) $authHeader = substr($authHeader, 7);
} elseif (isset($_SERVER['HTTP_AUTHORIZATION'])) {
    $authHeader = str_replace('Bearer ', '', $_SERVER['HTTP_AUTHORIZATION']);
} elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    $authHeader = str_replace('Bearer ', '', $_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
}
$authToken = '';
if (!empty($authHeader) && preg_match('/^[a-f0-9]{32,}$/', $authHeader)) {
    $authToken = $authHeader;
} else {
    $authToken = isset($_GET['auth_token']) ? preg_replace('/[^a-f0-9]/', '', $_GET['auth_token']) : '';
}
$userId = null;
if (!empty($authToken)) {
    $userId = verifyAuthToken($authToken);
    // ★ 更新最后活跃时间
    if ($userId) {
        $uf = dirname(__DIR__) . '/users/users.json';
        if (file_exists($uf)) {
            $ud = json_read_file($uf);
            if (is_array($ud) && isset($ud[$userId])) {
                $ud[$userId]['last_active'] = date('c');
                @file_put_contents($uf, json_encode($ud, JSON_UNESCAPED_UNICODE), LOCK_EX);
            }
        }
    }
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
$configDir = dirname(__DIR__) . '/chat_data/';
if (!is_dir($configDir)) @mkdir($configDir, 0755, true);

// ★ 用户配置持久化（独立处理）
$action = isset($_GET['action']) ? $_GET['action'] : (isset($_POST['action']) ? $_POST['action'] : '');

$publicActions = ['login', 'register', 'send_reg_code', 'verify', 'cross_domain_token'];
if (!$userId && !in_array($action, $publicActions)) {
    http_response_code(401);
    echo json_encode(['error' => '未登录，请先登录', 'code' => 'UNAUTHORIZED']);
    exit;
}
if ($action === 'save_config' && $userId && $method === 'POST') {
    $input = file_get_contents('php://input');
    $newConfig = json_decode($input, true);
    $configFile = $configDir . 'config_' . $namespace . '.json';

    // ★ DB 优先：写入 SQLite，JSON 文件作为备份
    $dbPath = dirname(__DIR__) . '/users/oneapichat.db';
    if (is_array($newConfig)) {
        // 合并保护：防止新设备空配置覆盖已有密钥
        $existingConfig = [];
        // 先从 DB 读取
        try {
            $pdo = new PDO("sqlite:$dbPath");
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $stmt = $pdo->prepare("SELECT config_json FROM user_config WHERE user_id = ?");
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row) { $existingConfig = json_decode($row['config_json'], true) ?: []; }
        } catch (Exception $e) {}
        // 也从 JSON 文件合并
        if (file_exists($configFile)) {
            $fileConfig = json_decode(file_get_contents($configFile), true) ?: [];
            $existingConfig = array_merge($existingConfig, $fileConfig);
        }
        // 敏感字段保护
        $protectedKeys = ['apiKey', 'searchApiKey', 'searchApiKeyBrave', 'searchApiKeyGoogle', 'searchApiKeyTavily',
            'ep_apikey', 'ep_apikey_2', 'visionApiKey', 'imageApiKey', 'imageApiKey2',
            'providerApiKey', 'providerApiKey2', 'providerApiKey3',
            'apiKeyAntthropic', 'apiKeyDeepseek', 'apiKeyOpenai', 'apiKeyMinimax', 'apiKeyGoogle'];
        foreach ($protectedKeys as $key) {
            if (empty($newConfig[$key]) && !empty($existingConfig[$key])) {
                $newConfig[$key] = $existingConfig[$key];
            }
        }
        $newConfig = array_merge($existingConfig, $newConfig);

        // 写入 DB
        try {
            $pdo = new PDO("sqlite:$dbPath");
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $stmt = $pdo->prepare("INSERT OR REPLACE INTO user_config (user_id, config_json, updated_at) VALUES (?, ?, ?)");
            $stmt->execute([$userId, json_encode($newConfig), time()]);
        } catch (Exception $e) {}
    }

    // 同步写 JSON 备份
    @file_put_contents($configFile, json_encode($newConfig), LOCK_EX);
    @chmod($configFile, 0666);
    echo json_encode(['success' => true]);
    exit;
}
if ($action === 'get_config' && $userId && $method === 'GET') {
    $configFile = $configDir . 'config_' . $namespace . '.json';

    // ★ DB 优先读取
    $dbPath = dirname(__DIR__) . '/users/oneapichat.db';
    $dbConfig = null;
    try {
        $pdo = new PDO("sqlite:$dbPath");
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $stmt = $pdo->prepare("SELECT config_json FROM user_config WHERE user_id = ?");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) { $dbConfig = $row['config_json']; }
    } catch (Exception $e) {}

    if ($dbConfig) {
        // ★ 剥离不应跨设备同步的本地设置
        $configArr = json_decode($dbConfig, true) ?: [];
        unset($configArr['useAnthropicFormat']); // 本地开关，禁止从服务器恢复
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($configArr);
    } elseif (file_exists($configFile)) {
        $fileConfig = json_decode(file_get_contents($configFile), true) ?: [];
        unset($fileConfig['useAnthropicFormat']);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($fileConfig);
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
        $backupDir = dirname(__DIR__) . '/chat_data/backups/';
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
            @chmod($filename, 0666); // ★ 确保 www-data 后续可写入
            echo json_encode(['success' => true, 'path' => basename($filename)]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to save chat']);
        }
        break;

    case 'GET':
        $chatId = isset($_GET['chat_id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['chat_id']) : null;
        
        // ★ chat_id=all 时列出所有聊天（前端 loadChatsFromServer 使用）
        if ($chatId === 'all') $chatId = null;
        
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
            // ★ chat_id=all: 返回完整聊天数据（前端 restoreUserData 期望 chats 对象映射）
            $chats = [];
            $pattern = $dataDir . $namespace . '_*.json';
            $files = glob($pattern);
            if ($files === false) {
                echo json_encode(['chats' => (object)[]]);
                break;
            }
            foreach ($files as $file) {
                $basename = basename($file, '.json');
                // 跳过 config 文件和非all文件（但保留 all 的完整数据优先）
                if (strpos($basename, 'config_') === 0) continue;
                $chatIdFromFile = substr($basename, strlen($namespace) + 1);
                // ★ all.json 包含完整聊天映射，优先级最高
                if ($chatIdFromFile === 'all') {
                    $allContent = json_read_file($file);
                    if ($allContent && isset($allContent['chats'])) {
                        foreach ($allContent['chats'] as $cid => $cdata) {
                            if (isset($cdata['messages'])) {
                                $chats[$cid] = $cdata;
                            }
                        }
                    }
                    continue;
                }
                // 单个聊天文件（也包含完整 messages）
                $content = json_read_file($file);
                if ($content && isset($content['messages'])) {
                    $chats[$chatIdFromFile] = $content;
                }
            }
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
        // ★ 也从 all.json 中移除 + 清除备份
        $allFile = $dataDir . $namespace . '_all.json';
        if (file_exists($allFile)) {
            $allData = json_read_file($allFile);
            if ($allData && isset($allData['chats'][$chatId])) {
                unset($allData['chats'][$chatId]);
                $allData['updated_at'] = date('c');
                if (@file_put_contents($allFile, json_encode($allData, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR), LOCK_EX)) {
                    $success = true;
                }
            }
        }
        // ★ 同时清理该聊天文件的备份
        $backupDir = dirname(__DIR__) . '/chat_data/backups/';
        $backupPattern = $backupDir . basename($filename) . '.*';
        foreach (glob($backupPattern) as $oldBackup) {
            @unlink($oldBackup);
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

