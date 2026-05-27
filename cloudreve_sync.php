<?php
/**
 * Cloudreve API 账号同步桥接 v4
 * 
 * 目标：主页注册/登录时 → 确保 Cloudreve 存在同邮箱+同密码+同用户名的账号
 * 
 * 策略：
 *   - 登录时：尝试用相同凭据登录 Cloudreve
 *     → 成功 → 保存凭据，返回 login_token
 *     → 失败（账号不存在）→ 用相同凭据注册 → 成功 → 保存凭据
 *     → 失败（其他原因）→ 返回错误
 *   - 注册时：用新凭据在 Cloudreve 上注册
 *     → 成功 → 保存凭据，返回 login_token
 *     → 失败（邮箱已存在/密码太短等）→ 提示错误
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: https://naujtrats.xyz');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$username = trim($input['username'] ?? '');
$password = $input['password'] ?? '';
$email = trim($input['email'] ?? '');
$action = $input['action'] ?? 'sync'; // sync | register | login

if (!$username || !$password) {
    echo json_encode(['success' => false, 'error' => '缺少用户名或密码']);
    exit;
}

// 邮箱回退：没有邮箱就用 username@naujtrats.xyz
$email = $email ?: "{$username}@naujtrats.xyz";

$apiBase = 'http://127.0.0.1:5212/api/v4';

/**
 * 调用 Cloudreve API
 */
function cr_call($method, $endpoint, $data = [], $token = '') {
    $ch = curl_init("http://127.0.0.1:5212/api/v4" . $endpoint);
    $headers = ['Content-Type: application/json', 'Host: cloudreve.naujtrats.xyz'];
    if ($token) $headers[] = 'Authorization: Bearer ' . $token;
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => $headers,
    ]);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    } elseif ($method === 'PATCH') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    }
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'data' => json_decode($body, true) ?: []];
}

/**
 * 生成临时 login_token 并保存凭据
 */
function save_creds_and_token($email, $password, $username) {
    $tmpToken = bin2hex(random_bytes(32));
    file_put_contents("/tmp/cloudreve_login_{$tmpToken}.json", json_encode([
        'email' => $email,
        'password' => $password,
        'username' => $username,
        'created' => time(),
    ]));
    // 清理超时文件（5分钟）
    foreach (glob('/tmp/cloudreve_login_*.json') as $f) {
        if (time() - filemtime($f) > 300) @unlink($f);
    }
    return $tmpToken;
}

// ═══════════════════════════════════════
// 主逻辑
// ═══════════════════════════════════════

// 步骤1: 尝试用相同凭据登录 Cloudreve
$loginResp = cr_call('POST', '/session/token', [
    'email' => $email,
    'password' => $password,
]);

if ($loginResp['code'] === 200 && ($loginResp['data']['code'] ?? -1) === 0) {
    // ✅ 凭据完全匹配，Cloudreve 已有此账号
    $token = save_creds_and_token($email, $password, $username);
    echo json_encode([
        'success' => true,
        'login_token' => $token,
        'email' => $email,
        'status' => 'synced',
        'message' => 'Cloudreve 账号已同步（同邮箱同密码）',
    ]);
    exit;
}

// 步骤2: 登录失败 → 分析原因
$loginMsg = $loginResp['data']['msg'] ?? '';

// 密码太短（Cloudreve 要求至少 6 位）
if (strlen($password) < 6) {
    // 生成安全兼容密码
    $safePwd = 'cr_' . substr(base64_encode($password), 0, 14);
    
    // 先尝试用 Email 查用户是否存在（登录检测）
    // 尝试注册
    $regResp = cr_call('POST', '/user', [
        'email' => $email,
        'password' => $safePwd,
        'nick' => $username,
    ]);
    
    if ($regResp['code'] === 200 && ($regResp['data']['code'] ?? -1) === 0) {
        $token = save_creds_and_token($email, $safePwd, $username);
        echo json_encode([
            'success' => true,
            'login_token' => $token,
            'email' => $email,
            'status' => 'created_alt',
            'message' => 'Cloudreve 账号已创建（密码已调整为兼容格式）',
        ]);
        exit;
    }
    
    $regCode = $regResp['data']['code'] ?? -1;
    $regMsg = $regResp['data']['msg'] ?? '';
    
    // 邮箱已存在 → 可能是旧用户，用兼容密码尝试登录
    if ($regCode === 40032) {
        // 用兼容密码尝试登录
        $loginSafe = cr_call('POST', '/session/token', [
            'email' => $email,
            'password' => $safePwd,
        ]);
        if ($loginSafe['code'] === 200 && ($loginSafe['data']['code'] ?? -1) === 0) {
            $token = save_creds_and_token($email, $safePwd, $username);
            echo json_encode([
                'success' => true,
                'login_token' => $token,
                'email' => $email,
                'status' => 'synced_alt',
                'message' => 'Cloudreve 账号已同步（使用兼容密码）',
            ]);
            exit;
        }
        echo json_encode([
            'success' => false,
            'error' => "该邮箱已在 Cloudreve 注册，无法同步: {$regMsg}",
        ]);
        exit;
    }
    
    echo json_encode([
        'success' => false,
        'error' => "Cloudreve 注册失败: {$regMsg}",
    ]);
    exit;
}

// 密码 >= 6 位 → 尝试用相同凭据注册
$regResp = cr_call('POST', '/user', [
    'email' => $email,
    'password' => $password,
    'nick' => $username,
]);

if ($regResp['code'] === 200 && ($regResp['data']['code'] ?? -1) === 0) {
    // ✅ 注册成功！现在尝试登录确认
    $login2 = cr_call('POST', '/session/token', [
        'email' => $email,
        'password' => $password,
    ]);
    if ($login2['code'] === 200 && ($login2['data']['code'] ?? -1) === 0) {
        $token = save_creds_and_token($email, $password, $username);
        echo json_encode([
            'success' => true,
            'login_token' => $token,
            'email' => $email,
            'status' => 'created',
            'message' => 'Cloudreve 账号已创建（同邮箱同密码同用户名）',
        ]);
        exit;
    }
    // 账号创建了但登录失败（不太可能但处理一下）
    $token = save_creds_and_token($email, $password, $username);
    echo json_encode([
        'success' => true,
        'login_token' => $token,
        'email' => $email,
        'status' => 'created',
        'message' => 'Cloudreve 账号已创建',
    ]);
    exit;
}

// 步骤3: 注册失败 → 分析原因
$regMsg = $regResp['data']['msg'] ?? '未知错误';
$regCode = $regResp['data']['code'] ?? -1;

// 邮箱已存在 → 说明 Cloudreve 上已有此账号但密码不同
// 尝试用兼容密码模式登录
if ($regCode === 40032) {
    $safePwd = 'cr_' . substr(base64_encode($password), 0, 14);
    $loginAlt = cr_call('POST', '/session/token', [
        'email' => $email,
        'password' => $safePwd,
    ]);
    if ($loginAlt['code'] === 200 && ($loginAlt['data']['code'] ?? -1) === 0) {
        $token = save_creds_and_token($email, $safePwd, $username);
        echo json_encode([
            'success' => true,
            'login_token' => $token,
            'email' => $email,
            'status' => 'synced_alt',
            'message' => 'Cloudreve 账号已同步',
        ]);
        exit;
    }
    echo json_encode([
        'success' => false,
        'error' => "该邮箱已在 Cloudreve 注册但密码不匹配，请使用 Cloudreve 密码或联系管理员",
    ]);
    exit;
}

// 其他注册失败
if (strpos($regMsg, 'too short') !== false || strpos($regMsg, '短') !== false) {
    echo json_encode([
        'success' => false,
        'error' => 'Cloudreve 要求密码至少6位，请使用更长的密码',
        'need_stronger_password' => true,
    ]);
    exit;
}

echo json_encode([
    'success' => false,
    'error' => "Cloudreve 账号同步失败: {$regMsg}",
]);
