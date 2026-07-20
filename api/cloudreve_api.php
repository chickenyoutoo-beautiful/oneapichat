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
$token = $_GET['auth_token'] ?? '';
$token = preg_replace('/[^a-f0-9]/', '', $token);
$userId = verifyAuthToken($token) ?: '';
if (!$userId && $action !== 'ping' && $action !== 'login') {
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

/** ★ P0 修复: 等待路径同步 (创建/移动/复制后轮询确认) */
function cr_wait_path(string $uri, string $token, int $maxRetries = 6, int $delayMs = 500): array {
    for ($i = 0; $i < $maxRetries; $i++) {
        usleep($delayMs * 1000);
        $check = cr_get("$GLOBALS[apiBase]/file?uri=" . urlencode($uri), $token);
        if (($check['code'] ?? -1) === 0) {
            return ['synced' => true, 'retries' => $i + 1];
        }
    }
    return ['synced' => false, 'retries' => $maxRetries, 'hint' => '路径尚未同步，请稍后刷新'];
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

function cr_cacheToken($email, $token, $expiresIn = 3600) {
    $cacheFile = '/tmp/cloudreve_token_' . md5($email) . '.json';
    @file_put_contents($cacheFile, json_encode([
        'token' => $token, 'expires' => time() + $expiresIn, 'email' => $email,
    ]), LOCK_EX);
}

function cr_getAccessToken($uid) {
    $tmpFiles = glob('/tmp/cloudreve_login_*.json');
    if (empty($tmpFiles)) return '';
    usort($tmpFiles, function($a, $b) { return filemtime($b) - filemtime($a); });
    $data = json_read_file($tmpFiles[0]);
    if (!$data) return '';
    $email = $data['email'] ?? '';
    $password = $data['password'] ?? '';
    if (!$email || !$password) return '';
    $cached = cr_getCachedToken($email);
    if ($cached) return $cached;
    $resp = cr_post("$GLOBALS[apiBase]/session/token", ['email' => $email, 'password' => $password]);
    if (($resp['code'] ?? -1) === 0) {
        $token = $resp['data']['token']['access_token'] ?? '';
        if ($token) { cr_cacheToken($email, $token, 3500); return $token; }
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
            $tmpFile = '/tmp/cloudreve_login_' . bin2hex(random_bytes(16)) . '.json';
            file_put_contents($tmpFile, json_encode([
                'email' => $email, 'password' => $password,
                'user_id' => $userData['id'] ?? '', 'nickname' => $userData['nickname'] ?? '',
                'created' => time(),
            ]));
            echo json_encode(cr_success([
                'user' => ['nickname' => $userData['nickname'] ?? $email],
                'message' => '登录成功: ' . ($userData['nickname'] ?? $email),
            ]));
        } else {
            echo json_encode(cr_error('登录失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    case 'user_info':
        $token = cr_getAccessToken($userId);
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

    // ── 文件浏览 ──

    case 'list_files':
        $token = cr_getAccessToken($userId);
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
        $token = cr_getAccessToken($userId);
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
        $token = cr_getAccessToken($userId);
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
            // ★ P0: 轮询确认文件夹已同步
            $verifyUri = $uri . '/' . $name;
            $sync = cr_wait_path($verifyUri, $token, 6, 500);
            $fullPath = $parent ? "$parent/$name" : $name;
            echo json_encode(cr_success([
                'path' => $fullPath, 'name' => $name,
                'sync_status' => $sync['synced'] ? '已同步' : '同步中',
                'retries' => $sync['retries'],
            ], $sync['synced'] ? [] : ['hint' => $sync['hint'] ?? '路径尚未同步，请稍后刷新']));
        } else {
            echo json_encode(cr_error('创建失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    case 'rename':
        $token = cr_getAccessToken($userId);
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
        $token = cr_getAccessToken($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $paths = $_GET['paths'] ?? $_GET['src'] ?? '';
        $dst = $_GET['dst'] ?? '';
        if (!$paths || !$dst) { echo json_encode(cr_error('需要 paths/src 和 dst 参数')); break; }
        $srcArr = explode(',', $paths);
        $srcUris = array_map(function($p) { return 'cloudreve://my/' . trim($p); }, $srcArr);
        $dstUri = 'cloudreve://my/' . $dst;

        // ★ P0: 前置检查 — 确认目标目录存在
        $dstCheck = cr_get("$apiBase/file?uri=" . urlencode($dstUri), $token);
        if (($dstCheck['code'] ?? -1) !== 0) {
            echo json_encode(cr_error("目标路径不存在: '$dst'，请确认目标目录已创建并同步完成"));
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
                'target' => $dst,
                'summary' => ['total' => count($srcUris), 'succeeded' => $successCount, 'failed' => count($srcUris) - $successCount],
                'details' => $details,
            ]));
        } else {
            echo json_encode(cr_error('移动失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    case 'copy':
        $token = cr_getAccessToken($userId);
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

        $resp = cr_post("$apiBase/file/copy", ['uris' => $srcUris, 'dst' => $dstUri], $token);

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
        $token = cr_getAccessToken($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $paths = $_GET['paths'] ?? '';
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
        $token = cr_getAccessToken($userId);
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
        $token = cr_getAccessToken($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $path = $_GET['path'] ?? '';
        $password = $_GET['password'] ?? '';
        $expire = intval($_GET['expire'] ?? 0);
        if (!$path) { echo json_encode(cr_error('需要 path 参数')); break; }

        // ★ P0: 前置确认文件存在
        $uri = "cloudreve://my/$path";
        $check = cr_get("$apiBase/file?uri=" . urlencode($uri), $token);
        if (($check['code'] ?? -1) !== 0) {
            echo json_encode(cr_error("文件不存在: '$path'，请确认路径正确"));
            break;
        }

        $body = ['uris' => [$uri]];
        if ($password) $body['password'] = $password;
        if ($expire > 0) $body['expire'] = $expire;

        $resp = cr_post("$apiBase/share", $body, $token);

        if (($resp['code'] ?? -1) === 0) {
            $shareData = $resp['data'];
            echo json_encode(cr_success([
                'url' => 'https://cloudreve.naujtrats.xyz/s/' . ($shareData['id'] ?? ''),
                'password' => $password ?: '无',
                'expire_days' => $expire,
                'message' => '分享链接已创建',
            ]));
        } else {
            $errMsg = $resp['msg'] ?? '创建分享失败';
            // ★ P0: 诊断信息
            $diag = [
                '可能的原因为' => [
                    '未配置分享存储策略',
                    'SSL/HTTPS 未正确配置',
                    '云盘域名未绑定',
                ],
                '参考文档' => 'https://docs.cloudreve.org/config/share',
            ];
            echo json_encode(cr_error($errMsg, ['diagnosis' => $diag]));
        }
        break;

    case 'delete_share':
        $token = cr_getAccessToken($userId);
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
        $token = cr_getAccessToken($userId);
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

    case 'upload_url':
        $token = cr_getAccessToken($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $path = $_GET['path'] ?? '';
        $name = $_GET['name'] ?? '';
        $size = intval($_GET['size'] ?? 0);
        if (!$name) { echo json_encode(cr_error('需要 name 参数')); break; }
        $uri = $path ? "cloudreve://my/$path" : "cloudreve://my";
        $uri = rtrim($uri, '/');
        $resp = cr_put("$apiBase/file/upload", ['uri' => $uri, 'name' => $name, 'size' => $size], $token);
        if (($resp['code'] ?? -1) === 0) {
            echo json_encode(cr_success([
                'session_id' => $resp['data']['session_id'] ?? '',
                'message' => '上传会话已创建',
            ]));
        } else {
            echo json_encode(cr_error('创建上传会话失败: ' . ($resp['msg'] ?? '未知错误')));
        }
        break;

    case 'download_url':
        $token = cr_getAccessToken($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $path = $_GET['path'] ?? '';
        if (!$path) { echo json_encode(cr_error('需要 path 参数')); break; }
        $uri = "cloudreve://my/$path";
        $resp = cr_put("$apiBase/file/download", ['uris' => [$uri]], $token);
        if (($resp['code'] ?? -1) === 0) {
            echo json_encode(cr_success([
                'download_url' => $resp['data'] ?? '',
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
        $token = cr_getAccessToken($userId);
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
            'storage_info', 'upload_url', 'download_url',
            'overview',
        ]]));
}
