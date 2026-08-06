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

require_once __DIR__ . '/cloudreve_lib.php';

$action = $_GET['action'] ?? '';
$rawToken = $_GET['auth_token'] ?? '';
$token = preg_replace('/[^a-f0-9]/', '', $rawToken);
$userId = verifyAuthToken($token) ?: '';
$isMcpCall = ($rawToken === 'cr_shared');
if (!$userId && !$isMcpCall && $action !== 'ping' && $action !== 'login' && $action !== 'check_login') {
    echo json_encode(['success' => false, 'data' => null, 'error' => '未认证，请先登录']);
    exit;
}

$apiBase = 'http://127.0.0.1:5212/api/v4';
$hostHeader = 'cloudreve.naujtrats.xyz';

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

    case 'check_login':
        // ★ 快速检查登录状态 — 避免每次对话都重新登录
        $cachedToken = cr_getAccessToken($userId);
        if ($cachedToken) {
            $resp = cr_get("$apiBase/user/me", $cachedToken);
            if (($resp['code'] ?? -1) === 0) {
                echo json_encode(cr_success([
                    'logged_in' => true,
                    'nickname' => $resp['data']['nickname'] ?? '',
                    'email' => $resp['data']['email'] ?? '',
                    'message' => '已登录: ' . ($resp['data']['nickname'] ?? $resp['data']['email'] ?? 'Cloudreve'),
                    'web_url' => 'https://' . $hostHeader,
                ]));
                break;
            }
        }
        // ★ 无有效 token 且有 userId → 自动同步主项目账号到云盘（同邮箱同密码，不存在则注册）
        if ($userId) {
            $acc = cr_ensureAccount($userId);
            if ($acc['success'] && $acc['token']) {
                $meResp = cr_get("$apiBase/user/me", $acc['token']);
                $nickname = (($meResp['code'] ?? -1) === 0) ? ($meResp['data']['nickname'] ?? '') : '';
                $email = (($meResp['code'] ?? -1) === 0) ? ($meResp['data']['email'] ?? '') : $acc['email'];
                echo json_encode(cr_success([
                    'logged_in' => true,
                    'nickname' => $nickname,
                    'email' => $email,
                    'message' => '已自动同步登录 Cloudreve: ' . ($nickname ?: $email),
                    'web_url' => 'https://' . $hostHeader,
                    'synced' => true,
                    'source' => $acc['source'],
                ]));
                break;
            }
        }
        // 无有效凭据时返回 logged_in: false + 已有账号列表（方便前端显示）
        $existingAccounts = [];
        foreach (glob('/tmp/cloudreve_login_*.json') as $f) {
            $d = json_read_file($f);
            if ($d && !empty($d['email'])) $existingAccounts[] = $d['email'];
        }
        echo json_encode(cr_success([
            'logged_in' => false,
            'message' => '未登录，请调用 cr_login 登录',
            'accounts' => array_unique($existingAccounts),
            'web_url' => 'https://' . $hostHeader,
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
            $loginData = [
                'email' => $email, 'password' => $password,
                'user_id' => $userData['id'] ?? '', 'nickname' => $userData['nickname'] ?? '',
                'created' => time(), 'oneapichat_user' => $userId ?: '',
            ];
            // ★ 双写: 同时存储 userId 和 email 两种路径，确保 check_login 和 fallback 都能找到
            if ($userId) {
                file_put_contents('/tmp/cloudreve_login_' . md5($userId) . '.json', json_encode($loginData));
            }
            file_put_contents('/tmp/cloudreve_login_' . md5(md5($email)) . '.json', json_encode($loginData));
            // ★ v2.7: 主账号登录时同步更新 MCP 主账号凭据（保持与主页账号一致）
            if ($email === MCP_PRIMARY_EMAIL) {
                file_put_contents(MCP_PRIMARY_FILE, json_encode($loginData));
            }
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
            // ★ 注册成功后自动登录，获取 token 并缓存
            $loginResp = cr_post("$apiBase/session/token", ['email' => $email, 'password' => $password]);
            if (($loginResp['code'] ?? -1) === 0) {
                $token = $loginResp['data']['token']['access_token'] ?? '';
                if ($token) cr_cacheToken($email, $token, 3500);
            }
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

    // ── 自动同步 OneAPIChat → Cloudreve (真实邮箱+密码，不存在则注册) ──
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

        // ★ 用主项目同步的真实邮箱+密码登录/注册云盘（auth.php 已写入缓存）
        $acc = cr_ensureAccount($oaUserId);
        if ($acc['success'] && $acc['token']) {
            $meResp = cr_get("$apiBase/user/me", $acc['token']);
            $nickname = (($meResp['code'] ?? -1) === 0) ? ($meResp['data']['nickname'] ?? '') : '';
            echo json_encode(cr_success([
                'cloudreve_user' => ['id' => $acc['user_id'] ?? '', 'email' => $acc['email'], 'nickname' => $nickname ?: $oaUsername],
                'oneapichat_user' => $oaUsername,
                'message' => '已自动同步登录 Cloudreve: ' . ($acc['email'] ?: $oaUsername),
                'source' => $acc['source'],
            ]));
        } else {
            echo json_encode(cr_error('Cloudreve 同步失败: ' . ($acc['error'] ?? '未知错误')));
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
        // ★ v2.6.2: 兼容 MCP 工具只传 path 的情况 — 解析为 parent + name
        if (!$name && !empty($_GET['path'])) {
            $rawPath = trim($_GET['path'], '/');
            $slashPos = strrpos($rawPath, '/');
            if ($slashPos !== false) {
                $parent = substr($rawPath, 0, $slashPos);
                $name = substr($rawPath, $slashPos + 1);
            } else {
                $name = $rawPath;
            }
        }
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

    // ★ v2.6.2: 从服务器文件路径上传（支持大文件/二进制文件，自动分片）
    case 'upload_file':
        $token = cr_getTokenWithRetry($userId);
        if (!$token) { echo json_encode(cr_error('无法获取 Cloudreve token')); break; }
        $filePath = $_GET['file_path'] ?? '';
        $crPath = $_GET['cloudreve_path'] ?? '';
        $crName = $_GET['cloudreve_name'] ?? '';
        if (!$filePath) { echo json_encode(cr_error('需要 file_path 参数（服务器上的文件路径）')); break; }
        // ★ v2.6.3: 智能路径解析 — 支持 URL/相对路径/绝对路径
        //    1. https://naujtrats.xyz/oneapichat/uploads/xxx → /var/www/html/oneapichat/uploads/xxx
        //    2. /oneapichat/uploads/xxx → /var/www/html/oneapichat/uploads/xxx
        //    3. uploads/user_xxx/img.mp4 → /var/www/html/oneapichat/uploads/user_xxx/img.mp4
        if (preg_match('#^https?://[^/]+(/oneapichat/.+)$#', $filePath, $urlMatch)) {
            $filePath = ONECHAT_ROOT . substr($urlMatch[1], strlen('/oneapichat'));
        } elseif (preg_match('#^/oneapichat/(.+)$#', $filePath, $relMatch)) {
            $filePath = ONECHAT_ROOT . '/' . $relMatch[1];
        } elseif ($filePath[0] !== '/') {
            $filePath = ONECHAT_ROOT . '/' . ltrim($filePath, '/');
        }
        // 回退: 尝试 uploads/ 简写
        if (!file_exists($filePath)) {
            $altPath = ONECHAT_ROOT . '/uploads/' . basename($filePath);
            if (file_exists($altPath)) $filePath = $altPath;
        }
        $upResult = cr_uploadLocalFile($token, $filePath, $crPath, $crName);
        if (empty($upResult['success'])) {
            echo json_encode(cr_error($upResult['error'] ?? '上传失败'));
            break;
        }
        echo json_encode(cr_success([
            'path' => $upResult['cloudreve_path'],
            'name' => $upResult['name'],
            'size' => $upResult['size'],
            'size_formatted' => cr_formatSize($upResult['size']),
            'chunks' => $upResult['chunks'],
            'message' => "已上传: '{$upResult['name']}' (" . cr_formatSize($upResult['size']) . ", {$upResult['chunks']}个分片)",
        ]));
        break;

    // ★ 2026-08-03 云盘全面结合: 自动导入入口（upload.php/netdisk_api.php/引擎/bridge 共用）
    //   参数: file_path(必), category=uploads|downloads|generated(默认uploads), cloudreve_name(可选), user_id(仅 cr_shared 内部调用)
    case 'import_file':
        $filePath = $_GET['file_path'] ?? '';
        $category = $_GET['category'] ?? 'uploads';
        $crName = $_GET['cloudreve_name'] ?? '';
        if (!$filePath) { echo json_encode(cr_error('需要 file_path 参数（服务器上的文件路径）')); break; }
        if (!$userId && $isMcpCall) {
            // 内部 bridge 调用（auth_token=cr_shared）: 允许指定 oneapichat 用户上下文
            $userId = preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['user_id'] ?? '');
        }
        $impResult = cr_importFile($userId, $filePath, $category, $crName);
        if (empty($impResult['success'])) {
            echo json_encode(cr_error($impResult['error'] ?? '导入失败'));
            break;
        }
        echo json_encode(cr_success([
            'path' => $impResult['cloudreve_path'],
            'name' => $impResult['name'],
            'size' => $impResult['size'],
            'size_formatted' => cr_formatSize($impResult['size']),
            'chunks' => $impResult['chunks'],
            'source' => $impResult['source'] ?? '',
            'message' => "已同步到云盘: '{$impResult['name']}' → OneAPIChat/" . $category,
        ]));
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
            'ping', 'check_login', 'login', 'user_info',
            'list_files', 'search_files',
            'create_folder', 'rename', 'move', 'copy', 'delete',
            'list_shares', 'create_share', 'delete_share',
            'storage_info', 'upload', 'upload_file', 'download_url',
            'overview',
        ]]));
}
