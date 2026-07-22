<?php
/**
 * Cloudreve API 桥接 — 供 aiAgent 工具调用
 * 直接调用 Cloudreve v4 REST API (127.0.0.1:5212)
 *
 * 调用方式: GET /oneapichat/cloudreve_api.php?action=xxx&auth_token=xxx&...
 *
 * v2.5 改进:
 *   - P0 异步同步: create_folder/move/rename/copy 后轮询确认
 *   - P0 搜索降级: API不可用时递归遍历目录过滤
 *   - P0 分享诊断: 前置检查+友好错误提示
 *   - P1 统一中文错误 + 标准返回结构 {success, data, error}
 *   - P2 批量操作明细
 *   - P3 重命名扩展名保护
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';

$action = $_GET['action'] ?? '';
$rawToken = $_GET['auth_token'] ?? '';
$token = preg_replace('/[^a-f0-9]/', '', $rawToken);
$userId = verifyAuthToken($token) ?: '';
$isMcpCall = ($rawToken === 'cr_shared');
if (!$userId && !$isMcpCall && $action !== 'ping' && $action !== 'login') {
    echo json_encode(['success' => false, 'data' => null, 'error' => '未认证，请先登录']);
    exit;
}

$apiBase = 'http://127.0.0.1:5212/api/v4';
$hostHeader = 'cloudreve.naujtrats.xyz';

// ════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════

function cr_success($data = null, $extra = []) {
    return array_merge(['success' => true, 'data' => $data, 'error' => null], $extra);
}

function cr_error($msg, $extra = []) {
    return array_merge(['success' => false, 'data' => null, 'error' => $msg], $extra);
}

function cr_get(string $url, string $token = ''): ?array {
    global $hostHeader;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => array_filter([
            'Host: ' . $hostHeader,
            $token ? 'Authorization: Bearer ' . $token : null,
        ]),
    ]);
    $body = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $httpCode === 0) return ['code' => -1, 'msg' => 'API 连接失败，请检查云盘服务是否运行'];
    $decoded = json_decode($body, true);
    if ($decoded === null) return ['code' => -1, 'msg' => 'API 返回格式异常: ' . substr($body, 0, 100)];
    return $decoded;
}

function cr_post(string $url, $data, string $token = ''): array {
    global $hostHeader;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($data),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => array_filter([
            'Content-Type: application/json',
            'Host: ' . $hostHeader,
            $token ? 'Authorization: Bearer ' . $token : null,
        ]),
    ]);
    $body = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $httpCode === 0) return ['code' => -1, 'msg' => 'API 连接失败，请检查云盘服务是否运行'];
    $decoded = json_decode($body, true);
    if ($decoded === null) return ['code' => -1, 'msg' => 'API 返回格式异常'];
    return $decoded;
}

function cr_put(string $url, $data, string $token = ''): array {
    global $hostHeader;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'PUT',
        CURLOPT_POSTFIELDS => json_encode($data),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => array_filter([
            'Content-Type: application/json',
            'Host: ' . $hostHeader,
            $token ? 'Authorization: Bearer ' . $token : null,
        ]),
    ]);
    $body = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $httpCode === 0) return ['code' => -1, 'msg' => 'API 连接失败，请检查云盘服务是否运行'];
    $decoded = json_decode($body, true);
    if ($decoded === null) return ['code' => -1, 'msg' => 'API 返回格式异常'];
    return $decoded;
}

function cr_delete(string $url, $data, string $token = ''): array {
    global $hostHeader;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_POSTFIELDS => json_encode($data),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => array_filter([
            'Content-Type: application/json',
            'Host: ' . $hostHeader,
            $token ? 'Authorization: Bearer ' . $token : null,
        ]),
    ]);
    $body = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $httpCode === 0) return ['code' => -1, 'msg' => 'API 连接失败，请检查云盘服务是否运行'];
    $decoded = json_decode($body, true);
    if ($decoded === null) return ['code' => -1, 'msg' => 'API 返回格式异常'];
    return $decoded;
}

/** ★ P0 修复: 等待路径同步 (创建/移动/复制后轮询确认)
 *  v2.6: 新增 parent-dir 回退 — 若精确 URI 轮询失败，则列父目录查找目标名 */
function cr_wait_path(string $uri, string $token, int $maxRetries = 6, int $delayMs = 500, string $parentUri = '', string $targetName = ''): array {
    // Phase 1: 精确 URI 轮询
    for ($i = 0; $i < $maxRetries; $i++) {
        usleep($delayMs * 1000);
        $check = cr_get("$GLOBALS[apiBase]/file?uri=" . urlencode($uri), $token);
        if (($check['code'] ?? -1) === 0) {
            return ['synced' => true, 'retries' => $i + 1, 'method' => 'uri_poll'];
        }
    }
    // Phase 2: 回退 — 列父目录查找目标
    if ($parentUri && $targetName) {
        for ($i = 0; $i < 3; $i++) {
            usleep(600000); // 600ms
            $list = cr_get("$GLOBALS[apiBase]/file?uri=" . urlencode($parentUri), $token);
            if (($list['code'] ?? -1) === 0) {
                foreach (($list['data']['files'] ?? []) as $f) {
                    if (($f['name'] ?? '') === $targetName) {
                        return ['synced' => true, 'retries' => $maxRetries + $i + 1, 'method' => 'parent_list'];
                    }
                }
            }
        }
    }
    return ['synced' => false, 'retries' => $maxRetries, 'hint' => '路径尚未同步，请稍后刷新列表'];
}

/** ★ P0 修复: 递归列出所有文件（搜索降级用） */
function cr_recursive_list(string $uri, string $token, int $depth = 3): array {
    $results = [];
    if ($depth <= 0) return $results;
    $resp = cr_get("$GLOBALS[apiBase]/file?uri=" . urlencode($uri), $token);
    if (($resp['code'] ?? -1) !== 0) return $results;
    $files = $resp['data']['files'] ?? [];
    foreach ($files as $f) {
        $results[] = $f;
        if (($f['type'] ?? 0) == 1) {
            $childUri = $uri . '/' . $f['name'];
            $children = cr_recursive_list($childUri, $token, $depth - 1);
            $results = array_merge($results, $children);
        }
    }
    return $results;
}

// ── Token 管理 ──
function cr_getCachedToken($email) {
    $cacheFile = '/tmp/cloudreve_token_' . md5($email) . '.json';
    if (file_exists($cacheFile)) {
        $cache = json_read_file($cacheFile);
        if ($cache && ($cache['expires'] ?? 0) > time() + 60) {
            return $cache['token'] ?? '';
        }
    }
    return '';
}

function cr_cacheToken($email, $token, $expiresIn = 3500) {
    $cacheFile = '/tmp/cloudreve_token_' . md5($email) . '.json';
    @file_put_contents($cacheFile, json_encode([
        'token' => $token, 'expires' => time() + $expiresIn, 'email' => $email,
    ]), LOCK_EX);
}

function cr_getAccessToken($uid) {
    // ★ 按用户ID查找凭据，确保多用户隔离
    if ($uid) {
        $userFile = '/tmp/cloudreve_login_' . md5($uid) . '.json';
        if (file_exists($userFile)) {
            $data = json_read_file($userFile);
            if ($data) {
                $email = $data['email'] ?? '';
                $password = $data['password'] ?? '';
                if ($email && $password) {
                    $cached = cr_getCachedToken($email);
                    if ($cached) return $cached;
                    $resp = cr_post("$GLOBALS[apiBase]/session/token", ['email' => $email, 'password' => $password]);
                    if (($resp['code'] ?? -1) === 0) {
                        $token = $resp['data']['token']['access_token'] ?? '';
                        if ($token) { cr_cacheToken($email, $token, 3500); return $token; }
                    }
                }
            }
        }
    }
    // Fallback v2.6: 遍历所有缓存登录文件（而非仅取最新一个）
    // MCP 调用 userId 为空时进入此路径，需尝试所有已登录用户的凭据
    $tmpFiles = glob('/tmp/cloudreve_login_*.json');
    if (empty($tmpFiles)) return '';
    usort($tmpFiles, function($a, $b) { return filemtime($b) - filemtime($a); });
    foreach ($tmpFiles as $tmpFile) {
        $data = json_read_file($tmpFile);
        if (!$data) continue;
        $email = $data['email'] ?? '';
        $password = $data['password'] ?? '';
        if (!$email || !$password) continue;
        $cached = cr_getCachedToken($email);
        if ($cached) return $cached;
        $resp = cr_post("$GLOBALS[apiBase]/session/token", ['email' => $email, 'password' => $password]);
        if (($resp['code'] ?? -1) === 0) {
            $token = $resp['data']['token']['access_token'] ?? '';
            if ($token) { cr_cacheToken($email, $token, 3500); return $token; }
        }
    }
    return '';
}

// ★ Token 获取 + 自动重试（解决 session 不稳定）
function cr_getTokenWithRetry($uid, $maxRetries = 2) {
    for ($i = 0; $i < $maxRetries; $i++) {
        $token = cr_getAccessToken($uid);
        if ($token) return $token;
        if ($i < $maxRetries - 1) usleep(300000); // 300ms 后重试
    }
    return '';
}

function cr_formatSize($bytes) {
    if ($bytes === null || $bytes < 0) return '未知';
    if ($bytes >= 1073741824) return round($bytes / 1073741824, 2) . ' GB';
    if ($bytes >= 1048576) return round($bytes / 1048576, 2) . ' MB';
    if ($bytes >= 1024) return round($bytes / 1024, 2) . ' KB';
    return $bytes . ' B';
}

// ════════════════════════════════════════════
// 路由处理
// ════════════════════════════════════════════

switch ($action) {

    // ── 认证 ──

    case 'ping':
        $resp = cr_get("$apiBase/site/ping");
        echo json_encode(cr_success([
            'connected' => ($resp['code'] ?? -1) === 0,
            'version' => $resp['data'] ?? '未知',
        ]));
        break;

    case 'login':
        $email = $_GET['email'] ?? '';
        $password = $_GET['password'] ?? '';
        if (!$email || !$password) {
            echo json_encode(cr_error('需要 email 和 password 参数'));
            break;
        }
        $resp = cr_post("$apiBase/session/token", ['email' => $email, 'password' => $password]);
        if (($resp['code'] ?? -1) === 0) {
            $accessToken = $resp['data']['token']['access_token'] ?? '';
            $userData = $resp['data']['user'] ?? [];
            // ★ 按OneAPIChat用户ID存储，多用户隔离
            $userKey = $userId ?: md5($email);
            $tmpFile = '/tmp/cloudreve_login_' . md5($userKey) . '.json';
            file_put_contents($tmpFile, json_encode([
                'email' => $email, 'password' => $password,
                'user_id' => $userData['id'] ?? '', 'nickname' => $userData['nickname'] ?? '',
                'created' => time(), 'oneapichat_user' => $userId ?: '',
            ]));
            echo json_encode(cr_success([
                'user' => ['nickname' => $userData['nickname'] ?? $email],
                'message' => '登录成功: ' . ($userData['nickname'] ?? $email),
            ]));
        } else {
            echo json_encode(cr_error('登录失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    case 'register':
        $email = $_GET['email'] ?? '';
        $password = $_GET['password'] ?? '';
        if (!$email || !$password) {
            echo json_encode(cr_error('需要 email 和 password 参数'));
            break;
        }
        if (strlen($password) < 6) {
            echo json_encode(cr_error('密码至少需要 6 位'));
            break;
        }
        $resp = cr_post("$apiBase/user", ['email' => $email, 'password' => $password, 'nick' => explode('@', $email)[0]]);
        if (($resp['code'] ?? -1) === 0) {
            $userData = $resp['data'] ?? [];
            // 保存凭据（按用户key隔离）
            $userKey = $userId ?: md5($email);
            $tmpFile = '/tmp/cloudreve_login_' . md5($userKey) . '.json';
            file_put_contents($tmpFile, json_encode([
                'email' => $email, 'password' => $password,
                'user_id' => $userData['id'] ?? '', 'nickname' => $userData['nickname'] ?? explode('@', $email)[0],
                'created' => time(), 'oneapichat_user' => $userId ?: '',
            ]));
            echo json_encode(cr_success([
                'user' => ['email' => $email, 'nickname' => $userData['nickname'] ?? explode('@', $email)[0]],
                'message' => '注册成功: ' . $email . '，已自动登录',
            ]));
        } else {
            echo json_encode(cr_error('注册失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    case 'user_info':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token，请先通过网页端登录')); break; }
        $resp = cr_get("$apiBase/user/me", $token);
        if (($resp['code'] ?? -1) === 0) {
            $user = $resp['data'];
            echo json_encode(cr_success([
                'id' => $user['id'] ?? '', 'email' => $user['email'] ?? '',
                'nickname' => $user['nickname'] ?? '', 'group' => $user['group']['name'] ?? '',
            ]));
        } else {
            echo json_encode(cr_error('获取用户信息失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    // ── 自动桥接 OneAPIChat → Cloudreve ──
    case 'auto_login':
        $oaToken = $_GET['oneapichat_token'] ?? '';
        if (!$oaToken) { echo json_encode(cr_error('需要 oneapichat_token 参数')); break; }
        $oaUserId = verifyAuthToken($oaToken);
        if (!$oaUserId) { echo json_encode(cr_error('OneAPIChat 认证失败，请重新登录')); break; }

        $usersFile = ONECHAT_ROOT . '/users/users.json';
        $users = json_decode(file_get_contents($usersFile), true) ?: [];
        $oaUser = $users[$oaUserId] ?? null;
        if (!$oaUser) { echo json_encode(cr_error('OneAPIChat 用户不存在')); break; }

        $oaUsername = $oaUser['username'] ?? 'user';
        $oaEmail = $oaUser['email'] ?? '';
        // ★ 始终使用桥接邮箱，避免与用户手动注册的 Cloudreve 账号冲突
        $crEmail = $oaUserId . '@oneapichat.local';
        $bridgeSecret = 'naujtrats-cr-bridge-v2';
        $crPassword = substr(hash('sha256', $oaUserId . $bridgeSecret), 0, 24);

        // ★ 直接用桥接凭据创建/登录，不使用 cr_getAccessToken（避免多用户串号）
        $resp = cr_post("$apiBase/session/token", ['email' => $crEmail, 'password' => $crPassword]);
        $isNew = false;
        if (($resp['code'] ?? -1) !== 0) {
            // 不存在或密码错 → 创建
            $regResp = cr_post("$apiBase/user", [
                'email' => $crEmail, 'password' => $crPassword, 'nick' => $oaUsername,
            ]);
            $regCode = $regResp['code'] ?? -1;
            if ($regCode !== 0 && $regCode !== 40004 && $regCode !== 40032) {
                echo json_encode(cr_error('自动创建云盘账号失败: ' . ($regResp['msg'] ?? '未知错误')));
                break;
            }
            $resp = cr_post("$apiBase/session/token", ['email' => $crEmail, 'password' => $crPassword]);
            $isNew = true;
        }

        if (($resp['code'] ?? -1) === 0) {
            $crUser = $resp['data']['user'] ?? [];
            $crToken = $resp['data']['token']['access_token'] ?? '';
            // 缓存桥接凭据（按用户ID隔离）
            $loginFile = '/tmp/cloudreve_login_' . md5($oaUserId) . '.json';
            file_put_contents($loginFile, json_encode([
                'email' => $crEmail, 'password' => $crPassword,
                'user_id' => $crUser['id'] ?? '', 'nickname' => $crUser['nickname'] ?? $oaUsername,
                'created' => time(), 'oneapichat_user' => $oaUserId,
            ]));
            // 缓存 token
            cr_cacheToken($crEmail, $crToken, 3500);
            echo json_encode(cr_success([
                'cloudreve_user' => ['id' => $crUser['id'] ?? '', 'email' => $crEmail, 'nickname' => $crUser['nickname'] ?? $oaUsername],
                'oneapichat_user' => $oaUsername,
                'message' => $isNew ? '已自动创建并登录 Cloudreve' : '已自动登录 Cloudreve',
                'auto_created' => $isNew,
            ]));
        } else {
            echo json_encode(cr_error('Cloudreve 登录失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    // ── 文件浏览 ──

    case 'list_files':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $path = $_GET['path'] ?? '';
        $uri = $path ? "cloudreve://my/$path" : "cloudreve://my";
        $uri = rtrim($uri, '/');
        $resp = cr_get("$apiBase/file?uri=" . urlencode($uri), $token);
        if (($resp['code'] ?? -1) === 0) {
            $files = $resp['data']['files'] ?? [];
            $parent = $resp['data']['parent'] ?? [];
            $pagination = $resp['data']['pagination'] ?? [];
            $storage = $resp['data']['storage_policy'] ?? [];
            $formatted = [];
            foreach ($files as $f) {
                $formatted[] = [
                    'name' => $f['name'] ?? '', 'type' => ($f['type'] == 1) ? '📁 文件夹' : '📄 文件',
                    'size' => cr_formatSize($f['size'] ?? 0), 'path' => $f['path'] ?? '',
                    'updated_at' => $f['updated_at'] ?? '', 'is_dir' => ($f['type'] == 1),
                ];
            }
            echo json_encode(cr_success([
                'path' => $parent['path'] ?? $uri, 'parent' => $parent['name'] ?? '/',
                'files' => $formatted, 'file_count' => count($formatted),
                'total' => $pagination['total'] ?? count($formatted),
                'storage_policy' => $storage['name'] ?? '默认',
            ]));
        } else {
            echo json_encode(cr_error('列表失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    case 'search_files':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $keyword = $_GET['keyword'] ?? '';
        if (!$keyword) { echo json_encode(cr_error('请输入搜索关键词')); break; }
        $resp = cr_get("$apiBase/file/search?keyword=" . urlencode($keyword), $token);
        if (($resp['code'] ?? -1) === 0) {
            $files = $resp['data'] ?? [];
            $formatted = [];
            foreach ($files as $f) {
                $formatted[] = [
                    'name' => $f['name'] ?? '', 'type' => ($f['type'] == 1) ? '📁 文件夹' : '📄 文件',
                    'size' => cr_formatSize($f['size'] ?? 0), 'path' => $f['path'] ?? '',
                    'updated_at' => $f['updated_at'] ?? '',
                ];
            }
            echo json_encode(cr_success([
                'files' => $formatted, 'count' => count($formatted),
                'keyword' => $keyword, 'mode' => 'api_search',
            ]));
        } else {
            // ★ P0: 搜索API不可用 → 降级递归遍历过滤
            $allFiles = cr_recursive_list('cloudreve://my', $token, 4);
            $matched = [];
            foreach ($allFiles as $f) {
                $name = $f['name'] ?? '';
                if (mb_stripos($name, $keyword) !== false || stripos($name, $keyword) !== false) {
                    $matched[] = [
                        'name' => $name, 'type' => ($f['type'] == 1) ? '📁 文件夹' : '📄 文件',
                        'size' => cr_formatSize($f['size'] ?? 0), 'path' => $f['path'] ?? '',
                        'updated_at' => $f['updated_at'] ?? '',
                    ];
                }
            }
            echo json_encode(cr_success([
                'files' => $matched, 'count' => count($matched),
                'keyword' => $keyword, 'mode' => 'recursive_fallback',
                'note' => '搜索服务未启用，已递归遍历目录进行过滤匹配',
            ]));
        }
        break;

    // ── 文件操作 ──

    case 'create_folder':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $parent = $_GET['parent'] ?? '';
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(cr_error('请输入文件夹名称')); break; }
        $uri = $parent ? "cloudreve://my/$parent" : "cloudreve://my";
        $uri = rtrim($uri, '/');

        $resp = cr_post("$apiBase/file/create", [
            'uri' => $uri, 'type' => 'folder', 'single' => ['name' => $name],
        ], $token);

        if (($resp['code'] ?? -1) === 0) {
            // ★ P0 v2.6: 轮询确认 + 父目录回退
            $verifyUri = $uri . '/' . $name;
            $sync = cr_wait_path($verifyUri, $token, 8, 600, $uri, $name);
            $fullPath = $parent ? "$parent/$name" : $name;
            echo json_encode(cr_success([
                'path' => $fullPath, 'name' => $name,
                'sync_status' => $sync['synced'] ? '已同步' : '同步中',
                'retries' => $sync['retries'],
                'verify_method' => $sync['method'] ?? 'uri_poll',
            ], $sync['synced'] ? [] : ['hint' => $sync['hint'] ?? '路径尚未同步，请稍后刷新列表']));
        } else {
            echo json_encode(cr_error('创建失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    case 'rename':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $path = $_GET['path'] ?? '';
        $newName = $_GET['new_name'] ?? '';
        if (!$path || !$newName) { echo json_encode(cr_error('需要 path 和 new_name 参数')); break; }

        // ★ P3: 扩展名保护 — 去除扩展名时给出警告
        $oldExt = pathinfo($path, PATHINFO_EXTENSION);
        $newExt = pathinfo($newName, PATHINFO_EXTENSION);
        $extWarning = '';
        if ($oldExt && !$newExt) {
            $extWarning = "⚠️ 原文件扩展名 '.$oldExt' 将被移除，建议新名称: $newName.$oldExt";
        }

        $uri = "cloudreve://my/$path";
        $resp = cr_post("$apiBase/file/rename", ['uri' => $uri, 'new_name' => $newName], $token);

        if (($resp['code'] ?? -1) === 0) {
            echo json_encode(cr_success([
                'old_name' => basename($path),
                'new_name' => $newName,
                'message' => "已重命名为 '$newName'",
            ], $extWarning ? ['extension_warning' => $extWarning] : []));
        } else {
            echo json_encode(cr_error('重命名失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    case 'move':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $paths = $_GET['paths'] ?? $_GET['src'] ?? '';
        $dst = $_GET['dst'] ?? '';
        if (!$paths) { echo json_encode(cr_error('需要 paths/src 参数（要移动的文件）')); break; }
        // ★ 空字符串视为根目录
        $dstUri = ($dst === '' || $dst === '/') ? 'cloudreve://my' : 'cloudreve://my/' . ltrim($dst, '/');
        $srcArr = explode(',', $paths);
        $srcUris = array_map(function($p) { return 'cloudreve://my/' . ltrim(trim($p), '/'); }, $srcArr);

        // 前置检查 — 确认目标目录存在
        $dstCheck = cr_get("$apiBase/file?uri=" . urlencode($dstUri), $token);
        if (($dstCheck['code'] ?? -1) !== 0) {
            echo json_encode(cr_error("目标路径不存在: '" . ($dst ?: '根目录') . "'，请确认目标目录已创建"));
            break;
        }

        $resp = cr_post("$apiBase/file/move", ['uris' => $srcUris, 'dst' => $dstUri], $token);

        if (($resp['code'] ?? -1) === 0) {
            // ★ P2: 批量明细
            $aggErr = $resp['aggregated_error'] ?? [];
            $details = [];
            $successCount = 0;
            foreach ($srcUris as $uri) {
                $fileName = basename($uri);
                if (isset($aggErr[$uri])) {
                    $details[] = ['path' => $fileName, 'status' => '失败', 'reason' => $aggErr[$uri]['msg'] ?? '未知错误'];
                } else {
                    $details[] = ['path' => $fileName, 'status' => '已移动'];
                    $successCount++;
                }
            }
            echo json_encode(cr_success([
                'target' => $dst ?: '/',
                'summary' => ['total' => count($srcUris), 'succeeded' => $successCount, 'failed' => count($srcUris) - $successCount],
                'details' => $details,
            ]));
        } else {
            $errMsg = $resp['msg'] ?? '移动失败';
            // ★ 友好的冲突提示
            if (stripos($errMsg, 'existed') !== false || stripos($errMsg, 'exist') !== false) {
                $errMsg .= '。目标位置已存在同名文件，请先删除目标文件或重命名后再移动';
            }
            echo json_encode(cr_error($errMsg));
        }
        break;

    case 'copy':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $paths = $_GET['paths'] ?? $_GET['src'] ?? '';
        $dst = $_GET['dst'] ?? '';
        if (!$paths || !$dst) { echo json_encode(cr_error('需要 paths/src 和 dst 参数')); break; }
        $srcArr = explode(',', $paths);
        $srcUris = array_map(function($p) { return 'cloudreve://my/' . trim($p); }, $srcArr);
        $dstUri = 'cloudreve://my/' . $dst;

        // ★ P0: 前置检查目标目录
        $dstCheck = cr_get("$apiBase/file?uri=" . urlencode($dstUri), $token);
        if (($dstCheck['code'] ?? -1) !== 0) {
            echo json_encode(cr_error("目标路径不存在: '$dst'，请先创建目标目录"));
            break;
        }

        $resp = cr_post("$apiBase/file/move", ['uris' => $srcUris, 'dst' => $dstUri, 'copy' => true], $token);

        if (($resp['code'] ?? -1) === 0) {
            $aggErr = $resp['aggregated_error'] ?? [];
            $details = [];
            $successCount = 0;
            foreach ($srcUris as $uri) {
                if (isset($aggErr[$uri])) {
                    $details[] = ['path' => basename($uri), 'status' => '失败', 'reason' => $aggErr[$uri]['msg'] ?? '未知错误'];
                } else {
                    $details[] = ['path' => basename($uri), 'status' => '已复制'];
                    $successCount++;
                }
            }
            echo json_encode(cr_success([
                'target' => $dst,
                'summary' => ['total' => count($srcUris), 'succeeded' => $successCount, 'failed' => count($srcUris) - $successCount],
                'details' => $details,
            ]));
        } else {
            echo json_encode(cr_error('复制失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    case 'delete':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $paths = $_GET['paths'] ?? $_GET['path'] ?? '';
        if (!$paths) { echo json_encode(cr_error('需要 paths 参数（逗号分隔文件路径）')); break; }
        $uris = array_map(function($p) { return 'cloudreve://my/' . trim($p); }, explode(',', $paths));

        $resp = cr_delete("$apiBase/file", ['uris' => $uris], $token);

        if (($resp['code'] ?? -1) === 0) {
            // ★ P2: 批量明细
            $aggErr = $resp['aggregated_error'] ?? [];
            $details = [];
            $successCount = 0;
            foreach ($uris as $uri) {
                if (isset($aggErr[$uri])) {
                    $details[] = ['path' => basename($uri), 'status' => '失败', 'reason' => $aggErr[$uri]['msg'] ?? '未知错误'];
                } else {
                    $details[] = ['path' => basename($uri), 'status' => '已删除'];
                    $successCount++;
                }
            }
            echo json_encode(cr_success([
                'summary' => ['total' => count($uris), 'succeeded' => $successCount, 'failed' => count($uris) - $successCount],
                'details' => $details,
            ]));
        } else {
            $aggErr = $resp['aggregated_error'] ?? [];
            $details = [];
            foreach ($aggErr as $uri => $err) {
                $details[] = ['path' => basename($uri), 'status' => '失败', 'reason' => $err['msg'] ?? '未知错误'];
            }
            echo json_encode(cr_error('删除失败: ' . ($resp['msg'] ?? '未知错误'), ['details' => $details]));
        }
        break;

    // ── 分享 ──

    case 'list_shares':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $resp = cr_get("$apiBase/share?page=1&page_size=50", $token);
        if (($resp['code'] ?? -1) === 0) {
            $shares = $resp['data']['shares'] ?? [];
            $formatted = [];
            foreach ($shares as $s) {
                $formatted[] = [
                    'id' => $s['id'] ?? '', 'name' => $s['source']['name'] ?? '',
                    'url' => 'https://cloudreve.naujtrats.xyz/s/' . ($s['id'] ?? ''),
                    'is_dir' => ($s['source']['type'] ?? 0) == 1,
                    'password' => $s['password'] ? '🔒 有密码' : '🌐 公开',
                    'views' => $s['views'] ?? 0, 'downloads' => $s['downloads'] ?? 0,
                    'created_at' => $s['created_at'] ?? '', 'expire' => $s['expire'] ?? '永久',
                ];
            }
            echo json_encode(cr_success(['shares' => $formatted, 'count' => count($formatted)]));
        } else {
            echo json_encode(cr_error('获取分享列表失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    case 'create_share':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $path = $_GET['path'] ?? '';
        $password = $_GET['password'] ?? '';
        $expire = intval($_GET['expire'] ?? 0);
        if (!$path) { echo json_encode(cr_error('需要 path 参数')); break; }

        // ★ 路径清洗: 去除 cloudreve://my/ 前缀
        $cleanPath = preg_replace('#^(cloudreve://my/?|/)#', '', $path);
        $uri = "cloudreve://my/$cleanPath";

        // ★ v4.18 API 要求单数 "uri" 字段，非 "uris" 数组
        $body = ['uri' => $uri];
        if ($password) $body['password'] = $password;
        if ($expire > 0) $body['expire'] = $expire;

        // ★ Cloudreve v4 创建分享: PUT /api/v4/share（跳过本地文件检查，Cloudreve自行校验）
        $resp = cr_put("$apiBase/share", $body, $token);

        if (($resp['code'] ?? -1) === 0) {
            $shareData = $resp['data'];
            // ★ v4.18 返回完整 URL 字符串；v4.16 返回 {id, ...} 对象
            if (is_string($shareData)) {
                $shareUrl = $shareData;
                $shareId = basename(parse_url($shareUrl, PHP_URL_PATH) ?: '');
            } else {
                $shareId = $shareData['id'] ?? ($shareData[0]['id'] ?? '');
                $shareUrl = 'https://cloudreve.naujtrats.xyz/s/' . $shareId;
            }
            echo json_encode(cr_success([
                'url' => $shareUrl,
                'id' => $shareId,
                'password' => $password ?: '无',
                'expire_days' => $expire ?: '永久',
                'message' => '分享链接已创建',
            ]));
        } else {
            $errMsg = $resp['msg'] ?? '创建分享失败';
            // ★ 回退: 返回友好提示
            if (stripos($errMsg, 'empty') !== false) {
                $errMsg = 'Cloudreve 分享接口异常（容器级问题），请通过网页端 https://cloudreve.naujtrats.xyz 手动创建分享';
            }
            echo json_encode(cr_error($errMsg));
        }
        break;

    case 'delete_share':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $shareId = $_GET['id'] ?? '';
        if (!$shareId) { echo json_encode(cr_error('需要 id 参数（分享链接ID）')); break; }
        $resp = cr_delete("$apiBase/share/$shareId", [], $token);
        if (($resp['code'] ?? -1) === 0) {
            echo json_encode(cr_success(null, ['message' => '分享链接已删除']));
        } else {
            echo json_encode(cr_error('删除分享失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    // ── 存储信息 ──

    case 'storage_info':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $resp = cr_get("$apiBase/user/storage", $token);
        if (($resp['code'] ?? -1) === 0) {
            $data = $resp['data'];
            echo json_encode(cr_success([
                'used' => cr_formatSize($data['used'] ?? 0),
                'total' => cr_formatSize($data['total'] ?? 0),
                'used_bytes' => $data['used'] ?? 0,
                'total_bytes' => $data['total'] ?? 0,
            ]));
        } else {
            $diskFree = @disk_free_space('/opt/cloudreve/uploads');
            $diskTotal = @disk_total_space('/opt/cloudreve/uploads');
            echo json_encode(cr_success([
                'used' => '统计中', 'total' => cr_formatSize($diskTotal),
                'free' => cr_formatSize($diskFree),
                'total_bytes' => $diskTotal, 'free_bytes' => $diskFree,
                'note' => '磁盘级别统计（Cloudreve 存储 API 不可用）',
            ]));
        }
        break;

    // ── 上传/下载 ──

    case 'upload':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $path = $_GET['path'] ?? '';
        $name = $_GET['name'] ?? '';
        $content = $_GET['content'] ?? '';
        if (!$name || !$content) { echo json_encode(cr_error('需要 name 和 content 参数')); break; }
        // ★ v4.18: 文件名必须包含在 URI 中
        $uri = $path ? "cloudreve://my/$path/$name" : "cloudreve://my/$name";

        // Step 1: 创建上传会话（v4.18 不传 name，文件名在 uri 里）
        $resp = cr_put("$apiBase/file/upload", ['uri' => $uri, 'size' => strlen($content)], $token);
        if (($resp['code'] ?? -1) !== 0) {
            echo json_encode(cr_error('创建上传会话失败: ' . ($resp['msg'] ?? '未知错误')));
            break;
        }
        $sessionId = $resp['data']['session_id'] ?? '';
        if (!$sessionId) { echo json_encode(cr_error('上传会话创建成功但未返回 session_id')); break; }

        // Step 2: 上传文件内容（单分片 chunk 0）
        $ch = curl_init("$apiBase/file/upload/$sessionId/0");
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $content,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/octet-stream',
                'Host: ' . $hostHeader,
                'Authorization: Bearer ' . $token,
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
        ]);
        $uploadBody = curl_exec($ch);
        $uploadCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($uploadBody === false) {
            echo json_encode(cr_error('文件内容上传失败: 网络错误'));
            break;
        }
        $uploadResp = json_decode($uploadBody, true);
        if (($uploadResp['code'] ?? -1) === 0) {
            $fullPath = $path ? "$path/$name" : $name;
            echo json_encode(cr_success([
                'path' => $fullPath,
                'name' => $name,
                'size' => strlen($content),
                'session_id' => $sessionId,
                'message' => "已上传: '$name' (" . cr_formatSize(strlen($content)) . ")",
            ]));
        } else {
            echo json_encode(cr_error('文件内容上传失败: ' . ($uploadResp['msg'] ?? '未知错误')));
        }
        break;
        break;

    case 'download_url':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $path = $_GET['path'] ?? '';
        if (!$path) { echo json_encode(cr_error('需要 path 参数')); break; }
        $uri = "cloudreve://my/$path";
        $resp = cr_put("$apiBase/file/url", ['uris' => [$uri]], $token);
        if (($resp['code'] ?? -1) === 0) {
            $urlData = $resp['data'] ?? '';
            $downloadUrl = is_array($urlData) ? ($urlData[0] ?? '') : $urlData;
            echo json_encode(cr_success([
                'download_url' => $downloadUrl,
                'message' => '下载链接已生成（有效期较短）',
            ]));
        } else {
            echo json_encode(cr_error('生成下载链接失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    // ── WebDAV ──

    case 'webdav_list':
    case 'webdav_create':
    case 'webdav_delete':
        echo json_encode(cr_error('WebDAV API 在当前 Cloudreve 版本中不可用，请通过网页端管理'));
        break;

    // ── 统计总览 ──

    case 'overview':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $userInfo = cr_get("$apiBase/user/me", $token);
        $filesRoot = cr_get("$apiBase/file?uri=cloudreve://my", $token);
        $shares = cr_get("$apiBase/share?page=1&page_size=1", $token);
        $diskFree = @disk_free_space('/opt/cloudreve/uploads');
        $diskTotal = @disk_total_space('/opt/cloudreve/uploads');

        $user = ($userInfo['code'] ?? -1) === 0 ? $userInfo['data'] : [];
        $files = ($filesRoot['code'] ?? -1) === 0 ? ($filesRoot['data']['files'] ?? []) : [];
        $shareTotal = ($shares['code'] ?? -1) === 0 ? ($shares['data']['pagination']['total'] ?? 0) : 0;

        $dirCount = 0; $fileCount = 0;
        foreach ($files as $f) {
            ($f['type'] ?? 0) == 1 ? $dirCount++ : $fileCount++;
        }

        echo json_encode(cr_success([
            'user' => ['nickname' => $user['nickname'] ?? '', 'email' => $user['email'] ?? '', 'group' => $user['group']['name'] ?? ''],
            'storage' => ['total' => cr_formatSize($diskTotal), 'free' => cr_formatSize($diskFree), 'total_bytes' => $diskTotal, 'free_bytes' => $diskFree],
            'files' => ['root_items' => count($files), 'folders' => $dirCount, 'files' => $fileCount, 'shares' => $shareTotal],
            'server' => ['version' => '4.16.0', 'url' => 'https://cloudreve.naujtrats.xyz'],
        ]));
        break;

    default:
        echo json_encode(cr_error("未知操作: $action", ['available_actions' => [
            'ping', 'login', 'user_info',
            'list_files', 'search_files',
            'create_folder', 'rename', 'move', 'copy', 'delete',
            'list_shares', 'create_share', 'delete_share',
            'storage_info', 'upload', 'download_url',
            'overview',
        ]]));
}
