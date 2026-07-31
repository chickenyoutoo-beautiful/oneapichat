<?php
/**
 * image_proxy.php — 安全图片代理端点
 * 从服务器本地读取图片文件并返回 base64 data URL
 * 用于 analyze_image 工具获取历史图片的真实数据
 */

require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';

// ★ 认证: 兼容 auth_token 参数 (与 chat.php / upload.php 一致)
$authToken = isset($_GET['auth_token']) ? preg_replace('/[^a-f0-9]/', '', $_GET['auth_token']) : '';
$userId = $authToken ? verifyAuthToken($authToken) : null;
if (!$userId) {
    http_response_code(401);
    echo json_encode(['error' => '未登录或 token 无效']);
    exit;
}

$action = $_GET['action'] ?? '';

if ($action === 'get') {
    $path = $_GET['path'] ?? '';

    // ★ 剥离 URL 前缀 /oneapichat (serverUrl 形如 /oneapichat/uploads/xxx)
    //    image_proxy.php 位于 api/ 目录, ../ 即项目根, 只需拼接 uploads/xxx
    $path = preg_replace('#^/oneapichat#', '', $path);

    // ★ 安全校验: 只允许访问 uploads 目录下的文件
    $realPath = realpath(__DIR__ . '/../' . ltrim($path, '/'));
    $uploadBase = realpath(__DIR__ . '/../uploads');

    if ($realPath === false || strpos($realPath, $uploadBase) !== 0) {
        http_response_code(403);
        echo json_encode(['error' => '路径不在允许范围内']);
        exit;
    }

    if (!file_exists($realPath) || !is_file($realPath)) {
        http_response_code(404);
        echo json_encode(['error' => '文件不存在']);
        exit;
    }

    // 检查扩展名
    $ext = strtolower(pathinfo($realPath, PATHINFO_EXTENSION));
    $allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
    if (!in_array($ext, $allowed)) {
        http_response_code(400);
        echo json_encode(['error' => '不支持的文件类型: ' . $ext]);
        exit;
    }

    // 检查文件大小 (最大 10MB)
    $size = filesize($realPath);
    if ($size > 10 * 1024 * 1024) {
        http_response_code(400);
        echo json_encode(['error' => '文件过大: ' . round($size / 1024 / 1024, 1) . 'MB']);
        exit;
    }

    // 读取文件并返回 base64
    $mimeMap = [
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'png' => 'image/png', 'gif' => 'image/gif',
        'webp' => 'image/webp', 'bmp' => 'image/bmp'
    ];
    $mime = $mimeMap[$ext] ?? 'image/jpeg';
    $data = file_get_contents($realPath);
    $base64 = base64_encode($data);

    header('Content-Type: application/json');
    echo json_encode([
        'success' => true,
        'dataUrl' => 'data:' . $mime . ';base64,' . $base64,
        'size' => $size,
        'mime' => $mime
    ]);
    exit;
}

// 默认: 返回错误
http_response_code(400);
echo json_encode(['error' => '未知操作']);
