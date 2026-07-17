<?php
/**
 * OneAPIChat 共享认证辅助函数
 * 消除 chat.php / upload.php / chaoxing_api.php 中的重复 verifyAuthToken
 */

// 项目根目录（api/ 的父目录）
if (!defined('ONECHAT_ROOT')) {
    define('ONECHAT_ROOT', dirname(__DIR__));
}

/**
 * 从 Authorization header 提取 Bearer token
 * 供所有 API 端点统一使用
 * @return string token 字符串，无 token 时返回空字符串
 */
function extractBearerToken(): string {
    $authHeader = '';
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    } elseif (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $authHeader = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    if ($authHeader && stripos($authHeader, 'Bearer ') === 0) {
        return trim(substr($authHeader, 7));
    }
    return '';
}

/**
 * 验证 auth_token，返回 user_id 或 null
 * @param string $token 用户 token
 * @return string|null 用户 ID 或 null
 */
function verifyAuthToken(string $token): ?string {
    // 快速拒绝无效 token
    if (strlen($token) < 20) return null;

    $sessionsFile = ONECHAT_ROOT . '/users/sessions.json';
    if (!file_exists($sessionsFile)) return null;
    $raw = file_get_contents($sessionsFile);
    if ($raw === false) return null;
    $sessions = json_decode($raw, true);
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

/**
 * 验证 API Key（oac-<48hex> 格式），返回关联的 user_id 或 null
 * API Key 用于第三方应用接入，与 session token 分离
 * @param string $key 原始 API Key
 * @return string|null 用户 ID 或 null
 */
function verifyApiKey(string $key): ?string {
    // 格式校验: oac- 前缀 + 48 hex 字符 = 52 字符
    if (!preg_match('/^oac-[a-f0-9]{48}$/', $key)) {
        return null;
    }

    $hash = hash('sha256', $key);
    $usersFile = ONECHAT_ROOT . '/users/users.json';
    if (!file_exists($usersFile)) return null;

    $raw = file_get_contents($usersFile);
    if ($raw === false) return null;
    $users = json_decode($raw, true);
    if (!is_array($users)) return null;

    foreach ($users as $uid => $user) {
        $apiKeys = $user['api_keys'] ?? [];
        if (!is_array($apiKeys)) continue;
        foreach ($apiKeys as $ak) {
            if (!is_array($ak)) continue;
            if (($ak['key_hash'] ?? '') === $hash) {
                // 更新最后使用时间
                $ak['last_used_at'] = date('c');
                // 找到并更新
                foreach ($users[$uid]['api_keys'] as $i => $existing) {
                    if (($existing['id'] ?? '') === ($ak['id'] ?? '')) {
                        $users[$uid]['api_keys'][$i]['last_used_at'] = date('c');
                        break;
                    }
                }
                @file_put_contents($usersFile, json_encode($users, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
                return $uid;
            }
        }
    }
    return null;
}

/**
 * 生成新的 API Key
 * @return array ['raw' => 完整key, 'hash' => SHA-256哈希, 'prefix' => 前12字符]
 */
function generateApiKey(): array {
    $raw = 'oac-' . bin2hex(random_bytes(24)); // 52 字符
    return [
        'raw' => $raw,
        'hash' => hash('sha256', $raw),
        'prefix' => substr($raw, 0, 12)
    ];
}
