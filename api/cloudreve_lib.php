<?php
/**
 * Cloudreve 公共函数库 — 供 cloudreve_api.php / upload.php / netdisk_api.php 等复用
 *
 * 2026-08-03 新增: 云盘全面结合（镜像同步架构）
 *   - cr_ensureAccount(): 解析用户绑定的 Cloudreve 账号（绑定凭据 → 邮箱匹配 → 桥接账号自动创建）
 *   - cr_ensureFolder(): 确保 OneAPIChat/{category} 目录存在
 *   - cr_uploadLocalFile(): 本地文件分片上传（从 upload_file action 抽取）
 *   - cr_importFile(): 高层入口 — 探活 → 账号解析 → 目录确保 → 分片上传
 *
 * 其余函数从 cloudreve_api.php 原样抽取（curl 助手 / token 管理 / 等待同步 / 递归列表）
 */

require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';

// Cloudreve 实例（同一台服务器 Docker 容器 127.0.0.1:5212）
$GLOBALS['apiBase'] = $GLOBALS['apiBase'] ?? 'http://127.0.0.1:5212/api/v4';
$GLOBALS['hostHeader'] = $GLOBALS['hostHeader'] ?? 'cloudreve.naujtrats.xyz';

// ★ MCP 主账号 — 无 oneapichat 用户上下文时的固定账号（与主页登录账号一致）
if (!defined('MCP_PRIMARY_EMAIL')) define('MCP_PRIMARY_EMAIL', 'xyq070519@gmail.com');
if (!defined('MCP_PRIMARY_FILE')) define('MCP_PRIMARY_FILE', '/tmp/cloudreve_login_' . md5('mcp_primary') . '.json');

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

/** ★ 快速探活（短超时，导入前调用避免长时间阻塞上传/下载流程） */
function cr_probe(int $timeoutMs = 1500): bool {
    global $hostHeader;
    $ch = curl_init($GLOBALS['apiBase'] . '/site/ping');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT_MS => $timeoutMs,
        CURLOPT_HTTPHEADER => ['Host: ' . $hostHeader],
    ]);
    $body = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $body !== false && $httpCode === 200;
}

/** ★ P0 修复: 等待路径同步 (创建/移动/复制后轮询确认)
 *  v2.6: 新增 parent-dir 回退 — 若精确 URI 轮询失败，则列父目录查找目标名 */
function cr_wait_path(string $uri, string $token, int $maxRetries = 6, int $delayMs = 500, string $parentUri = '', string $targetName = ''): array {
    // Phase 1: 精确 URI 轮询
    for ($i = 0; $i < $maxRetries; $i++) {
        usleep($delayMs * 1000);
        $check = cr_get($GLOBALS['apiBase'] . '/file?uri=' . urlencode($uri), $token);
        if (($check['code'] ?? -1) === 0) {
            return ['synced' => true, 'retries' => $i + 1, 'method' => 'uri_poll'];
        }
    }
    // Phase 2: 回退 — 列父目录查找目标
    if ($parentUri && $targetName) {
        for ($i = 0; $i < 3; $i++) {
            usleep(600000); // 600ms
            $list = cr_get($GLOBALS['apiBase'] . '/file?uri=' . urlencode($parentUri), $token);
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
    $resp = cr_get($GLOBALS['apiBase'] . '/file?uri=' . urlencode($uri), $token);
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
                    $resp = cr_post($GLOBALS['apiBase'] . '/session/token', ['email' => $email, 'password' => $password]);
                    if (($resp['code'] ?? -1) === 0) {
                        $token = $resp['data']['token']['access_token'] ?? '';
                        if ($token) { cr_cacheToken($email, $token, 3500); return $token; }
                    }
                }
            }
        }
        // ★ userId 专属文件不存在或登录失败 → 返回空（禁止跨用户 glob 回退，防串号）
        //   上层 check_login / cr_importFile 会调用 cr_ensureAccount 自动同步
        return '';
    }
    // Fallback v2.7: MCP 调用 userId 为空时进入此路径。
    // ★ 修复: 优先使用 MCP 主账号凭据（与主页登录账号一致的 Cloudreve 账号），
    //   不再依赖「最新的缓存文件」——历史 root@naujtrats.xyz 等凭据会导致文件落错账号
    if (MCP_PRIMARY_EMAIL && file_exists(MCP_PRIMARY_FILE)) {
        $pData = json_read_file(MCP_PRIMARY_FILE);
        $pEmail = $pData['email'] ?? '';
        $pPassword = $pData['password'] ?? '';
        if ($pEmail === MCP_PRIMARY_EMAIL && $pPassword) {
            $cached = cr_getCachedToken($pEmail);
            if ($cached) return $cached;
            $resp = cr_post($GLOBALS['apiBase'] . '/session/token', ['email' => $pEmail, 'password' => $pPassword]);
            if (($resp['code'] ?? -1) === 0) {
                $token = $resp['data']['token']['access_token'] ?? '';
                if ($token) { cr_cacheToken($pEmail, $token, 3500); return $token; }
            }
            // 主账号凭据失效 → 移除后继续回退
            @unlink(MCP_PRIMARY_FILE);
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
        $resp = cr_post($GLOBALS['apiBase'] . '/session/token', ['email' => $email, 'password' => $password]);
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
// ★ 2026-08-03 云盘全面结合: 账号解析 / 目录确保 / 导入
// ════════════════════════════════════════════

/** 用凭据登录并缓存 token，返回 token 或 '' */
function cr_loginCreds(string $email, string $password): string {
    if (!$email || !$password) return '';
    $cached = cr_getCachedToken($email);
    if ($cached) return $cached;
    $resp = cr_post($GLOBALS['apiBase'] . '/session/token', ['email' => $email, 'password' => $password]);
    if (($resp['code'] ?? -1) !== 0) return '';
    $token = $resp['data']['token']['access_token'] ?? '';
    if ($token) cr_cacheToken($email, $token, 3500);
    return $token;
}

/**
 * ★ 解析/确保用户绑定的 Cloudreve 账号
 * 优先级: ① 主项目同步凭据(真实邮箱+密码,auth.php写入) → 登录/自动注册
 *         ② 面板绑定凭据(用户手动登录 cloudreve) → ③ 邮箱匹配已有缓存凭据 → ④ 桥接账号兜底
 * @return array ['success', 'email', 'password', 'token', 'user_id', 'source', 'error']
 */
function cr_ensureAccount(string $userId): array {
    $fail = function(string $msg) { return ['success' => false, 'error' => $msg]; };

    // 0) 用户信息
    $users = json_read_file(ONECHAT_ROOT . '/users/users.json') ?: [];
    $oaUser = $users[$userId] ?? [];
    $email = $oaUser['email'] ?? '';
    $username = $oaUser['username'] ?? 'user';
    $userFile = '/tmp/cloudreve_login_' . md5($userId) . '.json';

    // ★ ① 主项目同步凭据（真实邮箱 + 明文密码，auth.php 登录/注册时写入）
    //    用主项目同邮箱同密码登录云盘；若云盘账号不存在则自动注册
    $syncData = json_read_file($userFile);
    if ($syncData && !empty($syncData['email']) && !empty($syncData['password'])) {
        $syncEmail = $syncData['email'];
        $syncPass = $syncData['password'];
        // 跳过桥接账号格式（无真实邮箱的旧缓存不应走此路径）
        if (strpos($syncEmail, '@oneapichat.local') === false) {
            $token = cr_loginCreds($syncEmail, $syncPass);
            if ($token) {
                // 登录成功 → 补全 cloudreve user_id
                $me = cr_get($GLOBALS['apiBase'] . '/user/me', $token);
                $crUserId = (($me['code'] ?? -1) === 0) ? ($me['data']['id'] ?? '') : '';
                $syncData['user_id'] = $crUserId;
                $syncData['nickname'] = $syncData['nickname'] ?? $username;
                @file_put_contents($userFile, json_encode($syncData), LOCK_EX);
                return [
                    'success' => true, 'email' => $syncEmail, 'password' => $syncPass,
                    'token' => $token, 'user_id' => $crUserId, 'source' => 'main_sync',
                ];
            }
            // 登录失败 → 云盘账号不存在或密码不同 → 用主项目密码自动注册
            $regResp = cr_post($GLOBALS['apiBase'] . '/user', [
                'email' => $syncEmail, 'password' => $syncPass, 'nick' => $username,
            ]);
            $regCode = $regResp['code'] ?? -1;
            if ($regCode === 0 || $regCode === 40004 || $regCode === 40032) {
                // 注册成功(或已存在) → 再次登录
                $resp = cr_post($GLOBALS['apiBase'] . '/session/token', ['email' => $syncEmail, 'password' => $syncPass]);
                if (($resp['code'] ?? -1) === 0) {
                    $crUser = $resp['data']['user'] ?? [];
                    $crToken = $resp['data']['token']['access_token'] ?? '';
                    if ($crToken) {
                        cr_cacheToken($syncEmail, $crToken, 3500);
                        @file_put_contents($userFile, json_encode([
                            'email' => $syncEmail, 'password' => $syncPass,
                            'user_id' => $crUser['id'] ?? '', 'nickname' => $crUser['nickname'] ?? $username,
                            'created_at' => time(), 'oneapichat_user' => $userId, 'source' => 'main_sync',
                        ]));
                        return [
                            'success' => true, 'email' => $syncEmail, 'password' => $syncPass,
                            'token' => $crToken, 'user_id' => $crUser['id'] ?? '', 'source' => 'main_sync_registered',
                        ];
                    }
                }
            }
            // 注册也失败（如邮箱已被其他密码占用）→ 删除失效缓存，继续回退
            @unlink($userFile);
        }
    }

    // ② 面板绑定凭据（用户手动在 cloudreve 面板登录过的凭据）
    $data = json_read_file($userFile);
    if ($data && !empty($data['email']) && !empty($data['password'])) {
        $token = cr_loginCreds($data['email'], $data['password']);
        if ($token) {
            return [
                'success' => true, 'email' => $data['email'], 'password' => $data['password'],
                'token' => $token, 'user_id' => $data['user_id'] ?? '', 'source' => 'bound',
            ];
        }
        // 凭据失效 → 删除，继续回退
        @unlink($userFile);
    }

    // ③ 邮箱匹配已有缓存凭据（如 root 的 xyq070519@gmail.com = 主账号）
    if ($email) {
        foreach (glob('/tmp/cloudreve_login_*.json') as $f) {
            if ($f === $userFile) continue;
            $d = json_read_file($f);
            if (!$d || empty($d['password'])) continue;
            if (($d['email'] ?? '') !== $email) continue;
            $token = cr_loginCreds($email, $d['password']);
            if (!$token) continue;
            // 绑定到 userId 键，下次直接命中
            @file_put_contents($userFile, json_encode([
                'email' => $email, 'password' => $d['password'],
                'user_id' => $d['user_id'] ?? '', 'nickname' => $d['nickname'] ?? $username,
                'created' => time(), 'oneapichat_user' => $userId, 'source_binding' => 'email_match',
            ]));
            return [
                'success' => true, 'email' => $email, 'password' => $d['password'],
                'token' => $token, 'user_id' => $d['user_id'] ?? '', 'source' => 'email_match',
            ];
        }
    }

    // ④ 桥接账号（无真实邮箱时的兜底，确定性创建，密码可离线推导）
    $crEmail = $userId . '@oneapichat.local';
    $crPassword = substr(hash('sha256', $userId . 'naujtrats-cr-bridge-v2'), 0, 24);
    $resp = cr_post($GLOBALS['apiBase'] . '/session/token', ['email' => $crEmail, 'password' => $crPassword]);
    $isNew = false;
    if (($resp['code'] ?? -1) !== 0) {
        $regResp = cr_post($GLOBALS['apiBase'] . '/user', [
            'email' => $crEmail, 'password' => $crPassword, 'nick' => $username,
        ]);
        $regCode = $regResp['code'] ?? -1;
        if ($regCode !== 0 && $regCode !== 40004 && $regCode !== 40032) {
            return $fail('自动创建云盘账号失败: ' . ($regResp['msg'] ?? '未知错误'));
        }
        $resp = cr_post($GLOBALS['apiBase'] . '/session/token', ['email' => $crEmail, 'password' => $crPassword]);
        $isNew = true;
    }
    if (($resp['code'] ?? -1) !== 0) {
        return $fail('云盘登录失败: ' . ($resp['msg'] ?? '未知错误'));
    }
    $crUser = $resp['data']['user'] ?? [];
    $crToken = $resp['data']['token']['access_token'] ?? '';
    if (!$crToken) return $fail('云盘登录未返回 token');
    @file_put_contents($userFile, json_encode([
        'email' => $crEmail, 'password' => $crPassword,
        'user_id' => $crUser['id'] ?? '', 'nickname' => $crUser['nickname'] ?? $username,
        'created' => time(), 'oneapichat_user' => $userId,
    ]));
    cr_cacheToken($crEmail, $crToken, 3500);
    return [
        'success' => true, 'email' => $crEmail, 'password' => $crPassword,
        'token' => $crToken, 'user_id' => $crUser['id'] ?? '', 'source' => 'bridge',
    ];
}

/**
 * ★ 确保云盘目录存在（递归创建缺失层级）
 * @return bool
 */
function cr_ensureFolder(string $token, string $folderPath): bool {
    $folderPath = trim($folderPath, '/');
    if ($folderPath === '') return true;
    $parts = explode('/', $folderPath);
    $cur = '';
    foreach ($parts as $p) {
        $cur = $cur ? "$cur/$p" : $p;
        $check = cr_get($GLOBALS['apiBase'] . '/file?uri=' . urlencode("cloudreve://my/$cur"), $token);
        if (($check['code'] ?? -1) === 0) continue; // 已存在
        $parent = ($cur === $p) ? '' : substr($cur, 0, strrpos($cur, '/'));
        $uri = $parent ? "cloudreve://my/$parent" : 'cloudreve://my';
        $createResp = cr_post($GLOBALS['apiBase'] . '/file/create', [
            'uri' => $uri, 'type' => 'folder', 'single' => ['name' => $p],
        ], $token);
        if (($createResp['code'] ?? -1) !== 0) return false;
        usleep(300000); // 等目录落库
    }
    return true;
}

/**
 * ★ 本地文件分片上传到云盘指定目录（从 upload_file action 抽取）
 * @return array ['success', 'cloudreve_path', 'name', 'size', 'chunks', 'error']
 */
function cr_uploadLocalFile(string $token, string $filePath, string $crPath = '', string $crName = ''): array {
    if (!file_exists($filePath)) return ['success' => false, 'error' => "文件不存在: $filePath"];
    if (!is_readable($filePath)) return ['success' => false, 'error' => "文件不可读: $filePath"];

    $fileSize = filesize($filePath);
    $fileName = $crName ?: basename($filePath);
    $crPath = trim($crPath, '/');
    $uri = $crPath ? "cloudreve://my/$crPath/$fileName" : "cloudreve://my/$fileName";

    // Step 1: 创建上传会话（v4.18 文件名包含在 uri 中）
    $resp = cr_put($GLOBALS['apiBase'] . '/file/upload', ['uri' => $uri, 'size' => $fileSize], $token);
    if (($resp['code'] ?? -1) !== 0) {
        $sessionErr = $resp['msg'] ?? '未知错误';
        // ★ 幂等: 目标路径已存在 (重名导入/并发重复) 视为成功, 避免迁移报错中断
        if (stripos($sessionErr, 'exist') !== false) {
            return [
                'success' => true, 'cloudreve_path' => $crPath ? "$crPath/$fileName" : $fileName,
                'name' => $fileName, 'size' => $fileSize, 'chunks' => 0, 'exists' => true,
            ];
        }
        return ['success' => false, 'error' => '创建上传会话失败: ' . $sessionErr];
    }
    $sessionId = $resp['data']['session_id'] ?? '';
    $chunkSize = $resp['data']['chunk_size'] ?? 26214400; // Cloudreve 默认 25MB 分片
    if (!$sessionId) return ['success' => false, 'error' => '上传会话创建成功但未返回 session_id'];

    // Step 2: 分片上传
    $totalChunks = (int)ceil($fileSize / $chunkSize);
    $fh = fopen($filePath, 'rb');
    if (!$fh) return ['success' => false, 'error' => '无法打开文件'];

    $uploadedChunks = 0;
    $lastError = null;

    for ($i = 0; $i < $totalChunks; $i++) {
        $chunkData = fread($fh, $chunkSize);
        if ($chunkData === false) {
            $lastError = "读取文件分片 $i/$totalChunks 失败";
            break;
        }

        $ch = curl_init($GLOBALS['apiBase'] . "/file/upload/$sessionId/$i");
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $chunkData,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/octet-stream',
                'Host: ' . $GLOBALS['hostHeader'],
                'Authorization: Bearer ' . $token,
                'Content-Length: ' . strlen($chunkData),
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 120,
        ]);
        $uploadBody = curl_exec($ch);
        $uploadCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($uploadBody === false) {
            $lastError = "分片 $i/$totalChunks 上传网络错误";
            break;
        }
        $uploadResp = json_decode($uploadBody, true);
        if (($uploadResp['code'] ?? -1) !== 0) {
            $lastError = "分片 $i/$totalChunks 失败: " . ($uploadResp['msg'] ?? '未知错误');
            break;
        }
        $uploadedChunks++;
    }
    fclose($fh);

    if ($lastError) {
        return ['success' => false, 'error' => $lastError, 'uploaded_chunks' => $uploadedChunks, 'total_chunks' => $totalChunks];
    }

    return [
        'success' => true,
        'cloudreve_path' => $crPath ? "$crPath/$fileName" : $fileName,
        'name' => $fileName,
        'size' => $fileSize,
        'chunks' => $totalChunks,
    ];
}

/**
 * ★ 高层导入入口 — 探活 → 账号解析 → 目录确保 → 分片上传
 * @param string $userId oneapichat 用户 ID（空 = 主账号）
 * @param string $filePath 本地文件路径（支持 /oneapichat/... 相对路径）
 * @param string $category 目录类别: uploads / downloads / generated（映射 OneAPIChat/{category}）
 * @return array ['success', 'cloudreve_path', 'name', 'size', 'chunks', 'source', 'error']
 */
function cr_importFile(string $userId, string $filePath, string $category = 'uploads', string $crName = ''): array {
    if (!cr_probe()) {
        return ['success' => false, 'error' => '云盘服务不可达（127.0.0.1:5212）', 'cloudreve_path' => ''];
    }

    // 路径解析（与 upload_file 智能解析一致）
    if (preg_match('#^https?://[^/]+(/oneapichat/.+)$#', $filePath, $urlMatch)) {
        $filePath = ONECHAT_ROOT . substr($urlMatch[1], strlen('/oneapichat'));
    } elseif (preg_match('#^/oneapichat/(.+)$#', $filePath, $relMatch)) {
        $filePath = ONECHAT_ROOT . '/' . $relMatch[1];
    } elseif ($filePath[0] !== '/') {
        $filePath = ONECHAT_ROOT . '/' . ltrim($filePath, '/');
    }
    if (!file_exists($filePath)) return ['success' => false, 'error' => "文件不存在: $filePath", 'cloudreve_path' => ''];
    if (!is_readable($filePath)) return ['success' => false, 'error' => "文件不可读: $filePath", 'cloudreve_path' => ''];

    // 账号解析（空 userId → 主账号，直接走 cr_getAccessToken）
    if ($userId) {
        $acc = cr_ensureAccount($userId);
        if (!$acc['success']) return $acc;
        $token = $acc['token'];
        $source = $acc['source'];
    } else {
        $token = cr_getTokenWithRetry('');
        if (!$token) return ['success' => false, 'error' => '无法获取 Cloudreve token（主账号未配置）', 'cloudreve_path' => ''];
        $source = 'main';
    }

    $folder = 'OneAPIChat/' . preg_replace('/[^a-zA-Z0-9_-]/', '', $category);
    if (!cr_ensureFolder($token, $folder)) {
        return ['success' => false, 'error' => "创建云盘目录失败: $folder", 'cloudreve_path' => ''];
    }

    $result = cr_uploadLocalFile($token, $filePath, $folder, $crName);
    $result['source'] = $source;
    return $result;
}
