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
 * 验证 auth_token，返回 user_id 或 null
 * @param string $token 用户 token
 * @return string|null 用户 ID 或 null
 */
function verifyAuthToken(string $token): ?string {
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
