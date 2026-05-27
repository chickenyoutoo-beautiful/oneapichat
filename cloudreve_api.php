<?php
/**
 * Cloudreve API 桥接 - 供 aiAgent 工具调用
 * 直接调用 Cloudreve v4 REST API (127.0.0.1:5212)
 * 
 * 调用方式: GET /oneapichat/cloudreve_api.php?action=xxx&auth_token=xxx&...
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── 认证 ──
function cr_verifyToken($token) {
    $sessionsFile = __DIR__ . '/users/sessions.json';
    if (!file_exists($sessionsFile)) return null;
    $sessions = @json_decode(@file_get_contents($sessionsFile), true);
    if (!is_array($sessions)) return null;
    $now = time();
    $expireTime = 30 * 24 * 3600;
    foreach ($sessions as $t => $info) {
        if (($now - ($info['created_at'] ?? 0)) > $expireTime) unset($sessions[$t]);
    }
    $info = $sessions[$token] ?? null;
    return $info ? ($info['user_id'] ?? null) : null;
}

$action = $_GET['action'] ?? '';
$token = $_GET['auth_token'] ?? '';
$token = preg_replace('/[^a-f0-9]/', '', $token);
$userId = cr_verifyToken($token) ?: '';
if (!$userId && $action !== 'ping' && $action !== 'login') {
    echo json_encode(['code' => 401, 'msg' => '请先登录', 'error' => '未认证']);
    exit;
}

$apiBase = 'http://127.0.0.1:5212/api/v4';
$hostHeader = 'cloudreve.naujtrats.xyz';

// ── 辅助函数 ──
function cr_get($url, $token = '') {
    global $hostHeader;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => array_filter([
            'Host: ' . $hostHeader,
            $token ? 'Authorization: Bearer ' . $token : null,
        ]),
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    return json_decode($body, true) ?: ['code' => -1, 'msg' => 'API unreachable'];
}

function cr_post($url, $data, $token = '') {
    global $hostHeader;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($data),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => array_filter([
            'Content-Type: application/json',
            'Host: ' . $hostHeader,
            $token ? 'Authorization: Bearer ' . $token : null,
        ]),
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    return json_decode($body, true) ?: ['code' => -1, 'msg' => 'API unreachable'];
}

function cr_put($url, $data, $token = '') {
    global $hostHeader;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'PUT',
        CURLOPT_POSTFIELDS => json_encode($data),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => array_filter([
            'Content-Type: application/json',
            'Host: ' . $hostHeader,
            $token ? 'Authorization: Bearer ' . $token : null,
        ]),
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    return json_decode($body, true) ?: ['code' => -1, 'msg' => 'API unreachable'];
}

function cr_delete($url, $data, $token = '') {
    global $hostHeader;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_POSTFIELDS => json_encode($data),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => array_filter([
            'Content-Type: application/json',
            'Host: ' . $hostHeader,
            $token ? 'Authorization: Bearer ' . $token : null,
        ]),
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    return json_decode($body, true) ?: ['code' => -1, 'msg' => 'API unreachable'];
}

// ── 获取 Cloudreve access_token (从当前用户凭据) ──
function cr_getAccessToken($uid) {
    // 尝试从临时文件中找最近的有效 token
    $tmpFiles = glob('/tmp/cloudreve_login_*.json');
    $bestToken = '';
    $bestTime = 0;
    foreach ($tmpFiles as $f) {
        $data = @json_decode(@file_get_contents($f), true);
        if ($data && ($data['created'] ?? 0) > $bestTime) {
            // 用凭据重新登录获取 token
            $email = $data['email'] ?? '';
            $password = $data['password'] ?? '';
            if ($email && $password) {
                $resp = cr_post('http://127.0.0.1:5212/api/v4/session/token', [
                    'email' => $email,
                    'password' => $password,
                ]);
                if (($resp['code'] ?? -1) === 0) {
                    return $resp['data']['token']['access_token'] ?? '';
                }
            }
        }
    }
    
    // 回退：从数据库读取用户凭据
    $db = '/opt/cloudreve/data/cloudreve.db';
    if (file_exists($db)) {
        // 无法直接获取密码（加密的），返回空
    }
    return '';
}

// ── 格式化文件大小 ──
function cr_formatSize($bytes) {
    if ($bytes === null || $bytes < 0) return '未知';
    if ($bytes >= 1073741824) return round($bytes / 1073741824, 2) . ' GB';
    if ($bytes >= 1048576) return round($bytes / 1048576, 2) . ' MB';
    if ($bytes >= 1024) return round($bytes / 1024, 2) . ' KB';
    return $bytes . ' B';
}

// ── 格式化文件类型 ──
function cr_fileTypeName($type) {
    return ($type == 1) ? '📁' : '📄';
}

// ── 路由处理 ──
switch ($action) {

    // ═══════════════════════════════════════════════════
    // 认证
    // ═══════════════════════════════════════════════════

    case 'ping':
        $resp = cr_get("$apiBase/site/ping");
        echo json_encode([
            'success' => ($resp['code'] ?? -1) === 0,
            'version' => $resp['data'] ?? 'unknown',
            'connected' => true,
        ]);
        break;

    case 'login':
        // 用邮箱密码登录 Cloudreve，获取 token
        $email = $_GET['email'] ?? '';
        $password = $_GET['password'] ?? '';
        if (!$email || !$password) {
            echo json_encode(['success' => false, 'error' => '需要 email 和 password 参数']);
            break;
        }
        $resp = cr_post("$apiBase/session/token", ['email' => $email, 'password' => $password]);
        if (($resp['code'] ?? -1) === 0) {
            $accessToken = $resp['data']['token']['access_token'] ?? '';
            $userData = $resp['data']['user'] ?? [];
            // 保存凭据到临时文件供后续调用使用
            $tmpFile = '/tmp/cloudreve_login_' . bin2hex(random_bytes(16)) . '.json';
            file_put_contents($tmpFile, json_encode([
                'email' => $email,
                'password' => $password,
                'user_id' => $userData['id'] ?? '',
                'nickname' => $userData['nickname'] ?? '',
                'created' => time(),
            ]));
            echo json_encode([
                'success' => true,
                'access_token' => $accessToken,
                'user' => $userData,
                'message' => '登录成功: ' . ($userData['nickname'] ?? $email),
            ]);
        } else {
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '登录失败']);
        }
        break;

    case 'user_info':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token，请先通过主页登录']);
            break;
        }
        $resp = cr_get("$apiBase/user/me", $token);
        if (($resp['code'] ?? -1) === 0) {
            $user = $resp['data'];
            echo json_encode([
                'success' => true,
                'user' => [
                    'id' => $user['id'] ?? '',
                    'email' => $user['email'] ?? '',
                    'nickname' => $user['nickname'] ?? '',
                    'status' => $user['status'] ?? '',
                    'created_at' => $user['created_at'] ?? '',
                    'group' => $user['group']['name'] ?? '',
                ],
            ]);
        } else {
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '获取用户信息失败']);
        }
        break;

    // ═══════════════════════════════════════════════════
    // 文件浏览
    // ═══════════════════════════════════════════════════

    case 'list_files':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $path = $_GET['path'] ?? '';
        $uri = $path ? "cloudreve://my/$path" : "cloudreve://my";
        // 去掉末尾多余斜杠
        $uri = rtrim($uri, '/');
        if (substr($uri, -1) === '/') $uri = rtrim($uri, '/');
        
        $resp = cr_get("$apiBase/file?uri=" . urlencode($uri), $token);
        if (($resp['code'] ?? -1) === 0) {
            $files = $resp['data']['files'] ?? [];
            $parent = $resp['data']['parent'] ?? [];
            $pagination = $resp['data']['pagination'] ?? [];
            $storage = $resp['data']['storage_policy'] ?? [];
            
            $formatted = [];
            foreach ($files as $f) {
                $typeName = ($f['type'] == 1) ? '📁 文件夹' : '📄 文件';
                $formatted[] = [
                    'name' => $f['name'] ?? '',
                    'type' => $typeName,
                    'size' => cr_formatSize($f['size'] ?? 0),
                    'path' => $f['path'] ?? '',
                    'updated_at' => $f['updated_at'] ?? '',
                    'is_dir' => ($f['type'] == 1),
                ];
            }
            
            echo json_encode([
                'success' => true,
                'path' => $parent['path'] ?? $uri,
                'parent' => $parent['name'] ?? '/',
                'files' => $formatted,
                'file_count' => count($formatted),
                'total' => $pagination['total'] ?? count($formatted),
                'storage_policy' => $storage['name'] ?? '默认',
            ]);
        } else {
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '列表失败']);
        }
        break;

    case 'search_files':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $keyword = $_GET['keyword'] ?? '';
        if (!$keyword) {
            echo json_encode(['success' => false, 'error' => '请输入搜索关键词']);
            break;
        }
        // Cloudreve v4 搜索端点
        $resp = cr_get("$apiBase/file/search/keywords/" . urlencode($keyword), $token);
        if (($resp['code'] ?? -1) === 0) {
            $files = $resp['data'] ?? [];
            $formatted = [];
            foreach ($files as $f) {
                $formatted[] = [
                    'name' => $f['name'] ?? '',
                    'type' => ($f['type'] == 1) ? '📁 文件夹' : '📄 文件',
                    'size' => cr_formatSize($f['size'] ?? 0),
                    'path' => $f['path'] ?? '',
                    'updated_at' => $f['updated_at'] ?? '',
                ];
            }
            echo json_encode(['success' => true, 'files' => $formatted, 'count' => count($formatted), 'keyword' => $keyword]);
        } else {
            // 未启用搜索功能
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '搜索功能未启用']);
        }
        break;

    // ═══════════════════════════════════════════════════
    // 文件操作
    // ═══════════════════════════════════════════════════

    case 'create_folder':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $parent = $_GET['parent'] ?? '';
        $name = $_GET['name'] ?? '';
        if (!$name) {
            echo json_encode(['success' => false, 'error' => '请输入文件夹名称']);
            break;
        }
        $uri = $parent ? "cloudreve://my/$parent" : "cloudreve://my";
        $uri = rtrim($uri, '/');
        
        $resp = cr_post("$apiBase/file/create", [
            'uri' => $uri,
            'type' => 'folder',
            'single' => ['name' => $name],
        ], $token);
        
        // Cloudreve create API 可能返回 code=0 但 data 是父目录（不是新对象）
        // 成功创建的标志是 code=0 且没有 error
        if (($resp['code'] ?? -1) === 0) {
            // 验证文件夹是否真的创建了
            $verifyUri = $uri . '/' . $name;
            $verify = cr_get("$apiBase/file?uri=" . urlencode($verifyUri), $token);
            if (($verify['code'] ?? -1) === 0) {
                echo json_encode(['success' => true, 'message' => "文件夹 '$name' 已创建", 'path' => ($parent ? "$parent/$name" : $name)]);
            } else {
                echo json_encode(['success' => true, 'message' => "文件夹 '$name' 创建请求已发送", 'path' => ($parent ? "$parent/$name" : $name), 'note' => '请刷新文件列表确认']);
            }
        } else {
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '创建失败']);
        }
        break;

    case 'rename':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $path = $_GET['path'] ?? '';
        $newName = $_GET['new_name'] ?? '';
        if (!$path || !$newName) {
            echo json_encode(['success' => false, 'error' => '需要 path 和 new_name 参数']);
            break;
        }
        $uri = "cloudreve://my/$path";
        
        $resp = cr_post("$apiBase/file/rename", [
            'uri' => $uri,
            'new_name' => $newName,
        ], $token);
        
        if (($resp['code'] ?? -1) === 0) {
            echo json_encode(['success' => true, 'message' => "已重命名为 '$newName'"]);
        } else {
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '重命名失败']);
        }
        break;

    case 'move':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $paths = $_GET['paths'] ?? '';
        $dst = $_GET['dst'] ?? '';
        if (!$paths || !$dst) {
            echo json_encode(['success' => false, 'error' => '需要 paths 和 dst 参数']);
            break;
        }
        $srcUris = array_map(function($p) { return 'cloudreve://my/' . $p; }, explode(',', $paths));
        $dstUri = 'cloudreve://my/' . $dst;
        
        $resp = cr_post("$apiBase/file/move", [
            'uris' => $srcUris,
            'dst' => $dstUri,
        ], $token);
        
        if (($resp['code'] ?? -1) === 0) {
            echo json_encode(['success' => true, 'message' => '移动成功', 'count' => count($srcUris)]);
        } else {
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '移动失败']);
        }
        break;

    case 'copy':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $paths = $_GET['paths'] ?? '';
        $dst = $_GET['dst'] ?? '';
        if (!$paths || !$dst) {
            echo json_encode(['success' => false, 'error' => '需要 paths 和 dst 参数']);
            break;
        }
        $srcUris = array_map(function($p) { return 'cloudreve://my/' . $p; }, explode(',', $paths));
        $dstUri = 'cloudreve://my/' . $dst;
        
        $resp = cr_post("$apiBase/file/copy", [
            'uris' => $srcUris,
            'dst' => $dstUri,
        ], $token);
        
        if (($resp['code'] ?? -1) === 0) {
            echo json_encode(['success' => true, 'message' => '复制成功', 'count' => count($srcUris)]);
        } else {
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '复制失败']);
        }
        break;

    case 'delete':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $paths = $_GET['paths'] ?? '';
        if (!$paths) {
            echo json_encode(['success' => false, 'error' => '需要 paths 参数（逗号分隔文件路径）']);
            break;
        }
        $uris = array_map(function($p) { return 'cloudreve://my/' . $p; }, explode(',', $paths));
        
        $resp = cr_delete("$apiBase/file", ['uris' => $uris], $token);
        
        if (($resp['code'] ?? -1) === 0) {
            echo json_encode(['success' => true, 'message' => '删除成功', 'count' => count($uris)]);
        } else {
            $aggErr = $resp['aggregated_error'] ?? [];
            $errors = [];
            foreach ($aggErr as $uri => $err) {
                $errors[] = basename($uri) . ': ' . ($err['msg'] ?? '未知错误');
            }
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '删除失败', 'details' => $errors]);
        }
        break;

    // ═══════════════════════════════════════════════════
    // 分享
    // ═══════════════════════════════════════════════════

    case 'list_shares':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $resp = cr_get("$apiBase/share?page=1&page_size=50", $token);
        if (($resp['code'] ?? -1) === 0) {
            $shares = $resp['data']['shares'] ?? [];
            $formatted = [];
            foreach ($shares as $s) {
                $formatted[] = [
                    'id' => $s['id'] ?? '',
                    'name' => $s['source']['name'] ?? '',
                    'url' => 'https://cloudreve.naujtrats.xyz/s/' . ($s['id'] ?? ''),
                    'is_dir' => ($s['source']['type'] ?? 0) == 1,
                    'password' => $s['password'] ? '🔒 有密码' : '🌐 公开',
                    'views' => $s['views'] ?? 0,
                    'downloads' => $s['downloads'] ?? 0,
                    'created_at' => $s['created_at'] ?? '',
                    'expire' => $s['expire'] ?? '永久',
                ];
            }
            echo json_encode(['success' => true, 'shares' => $formatted, 'count' => count($formatted)]);
        } else {
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '获取分享列表失败']);
        }
        break;

    case 'create_share':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $path = $_GET['path'] ?? '';
        $password = $_GET['password'] ?? '';
        $expire = intval($_GET['expire'] ?? 0);
        if (!$path) {
            echo json_encode(['success' => false, 'error' => '需要 path 参数']);
            break;
        }
        $uri = "cloudreve://my/$path";
        
        $body = ['uris' => [$uri]];
        if ($password) $body['password'] = $password;
        if ($expire > 0) $body['expire'] = $expire;
        
        $resp = cr_post("$apiBase/share", $body, $token);
        
        if (($resp['code'] ?? -1) === 0) {
            $shareData = $resp['data'];
            echo json_encode([
                'success' => true,
                'message' => '分享链接已创建',
                'url' => 'https://cloudreve.naujtrats.xyz/s/' . ($shareData['id'] ?? ''),
                'password' => $password ?: '无',
                'expire_days' => $expire,
            ]);
        } else {
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '创建分享失败']);
        }
        break;

    case 'delete_share':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $shareId = $_GET['id'] ?? '';
        if (!$shareId) {
            echo json_encode(['success' => false, 'error' => '需要 id 参数（分享链接ID）']);
            break;
        }
        $resp = cr_delete("$apiBase/share/$shareId", [], $token);
        if (($resp['code'] ?? -1) === 0) {
            echo json_encode(['success' => true, 'message' => '分享链接已删除']);
        } else {
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '删除分享失败']);
        }
        break;

    // ═══════════════════════════════════════════════════
    // 存储信息
    // ═══════════════════════════════════════════════════

    case 'storage_info':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $resp = cr_get("$apiBase/user/storage", $token);
        if (($resp['code'] ?? -1) === 0) {
            $data = $resp['data'];
            echo json_encode([
                'success' => true,
                'used' => cr_formatSize($data['used'] ?? 0),
                'total' => cr_formatSize($data['total'] ?? 0),
                'used_bytes' => $data['used'] ?? 0,
                'total_bytes' => $data['total'] ?? 0,
            ]);
        } else {
            // 备用：从服务器文件系统读取
            $diskFree = disk_free_space('/opt/cloudreve/uploads');
            $diskTotal = disk_total_space('/opt/cloudreve/uploads');
            echo json_encode([
                'success' => true,
                'used' => '统计中',
                'total' => cr_formatSize($diskTotal),
                'free' => cr_formatSize($diskFree),
                'total_bytes' => $diskTotal,
                'free_bytes' => $diskFree,
                'note' => '磁盘级别统计',
            ]);
        }
        break;

    // ═══════════════════════════════════════════════════
    // 上传 (获取上传URL)
    // ═══════════════════════════════════════════════════

    case 'upload_url':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $path = $_GET['path'] ?? '';
        $name = $_GET['name'] ?? '';
        $size = intval($_GET['size'] ?? 0);
        if (!$name) {
            echo json_encode(['success' => false, 'error' => '需要 name 参数']);
            break;
        }
        $uri = $path ? "cloudreve://my/$path" : "cloudreve://my";
        $uri = rtrim($uri, '/');
        
        $resp = cr_put("$apiBase/file/upload", [
            'uri' => $uri,
            'name' => $name,
            'size' => $size,
        ], $token);
        
        if (($resp['code'] ?? -1) === 0) {
            echo json_encode([
                'success' => true,
                'session_id' => $resp['data']['session_id'] ?? '',
                'message' => '上传会话已创建，会话ID: ' . ($resp['data']['session_id'] ?? ''),
            ]);
        } else {
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '创建上传会话失败']);
        }
        break;

    // ═══════════════════════════════════════════════════
    // 下载 (获取下载URL)
    // ═══════════════════════════════════════════════════

    case 'download_url':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        $path = $_GET['path'] ?? '';
        if (!$path) {
            echo json_encode(['success' => false, 'error' => '需要 path 参数']);
            break;
        }
        $uri = "cloudreve://my/$path";
        $resp = cr_put("$apiBase/file/download", ['uris' => [$uri]], $token);
        if (($resp['code'] ?? -1) === 0) {
            echo json_encode([
                'success' => true,
                'download_url' => $resp['data'] ?? '',
                'message' => '下载链接已生成（有效期较短）',
            ]);
        } else {
            echo json_encode(['success' => false, 'error' => $resp['msg'] ?? '生成下载链接失败']);
        }
        break;

    // ═══════════════════════════════════════════════════
    // WebDAV 账号管理
    // ═══════════════════════════════════════════════════

    case 'webdav_list':
    case 'webdav_create':
    case 'webdav_delete':
        echo json_encode(['success' => false, 'error' => 'WebDAV API 在当前 Cloudreve 版本中不可用，请通过网页端管理']);
        break;

    // ═══════════════════════════════════════════════════
    // 统计总览
    // ═══════════════════════════════════════════════════

    case 'overview':
        $token = cr_getAccessToken($userId);
        if (!$token) {
            echo json_encode(['success' => false, 'error' => '无法获取 Cloudreve token']);
            break;
        }
        // 并发获取：用户信息 + 根目录文件数 + 分享数 + 存储
        $userInfo = cr_get("$apiBase/user/me", $token);
        $filesRoot = cr_get("$apiBase/file?uri=cloudreve://my", $token);
        $shares = cr_get("$apiBase/share?page=1&page_size=1", $token);
        $diskFree = disk_free_space('/opt/cloudreve/uploads');
        $diskTotal = disk_total_space('/opt/cloudreve/uploads');
        
        $user = ($userInfo['code'] ?? -1) === 0 ? $userInfo['data'] : [];
        $files = ($filesRoot['code'] ?? -1) === 0 ? ($filesRoot['data']['files'] ?? []) : [];
        $shareTotal = ($shares['code'] ?? -1) === 0 ? ($shares['data']['pagination']['total'] ?? 0) : 0;
        
        // 统计文件和文件夹数量
        $dirCount = 0;
        $fileCount = 0;
        foreach ($files as $f) {
            if (($f['type'] ?? 0) == 1) $dirCount++;
            else $fileCount++;
        }
        
        echo json_encode([
            'success' => true,
            'user' => [
                'nickname' => $user['nickname'] ?? '',
                'email' => $user['email'] ?? '',
                'group' => $user['group']['name'] ?? '',
            ],
            'storage' => [
                'total' => cr_formatSize($diskTotal),
                'free' => cr_formatSize($diskFree),
                'total_bytes' => $diskTotal,
                'free_bytes' => $diskFree,
            ],
            'files' => [
                'root_items' => count($files),
                'folders' => $dirCount,
                'files' => $fileCount,
                'shares' => $shareTotal,
            ],
            'server' => [
                'version' => '4.16.0',
                'url' => 'https://cloudreve.naujtrats.xyz',
            ],
        ]);
        break;

    default:
        echo json_encode(['success' => false, 'error' => "未知操作: $action", 'available_actions' => [
            'ping', 'login', 'user_info',
            'list_files', 'search_files',
            'create_folder', 'rename', 'move', 'copy', 'delete',
            'list_shares', 'create_share', 'delete_share',
            'storage_info', 'upload_url', 'download_url',
            'webdav_list', 'webdav_create', 'webdav_delete',
            'overview',
        ]]);
}
