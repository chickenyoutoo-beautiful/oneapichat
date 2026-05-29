<?php
/**
 * OneAPIChat 图片上传 API v3 (用户隔离 + Auth验证)
 * POST: 上传图片，返回 URL
 * GET: 获取图片列表（需认证，返回当前用户文件）
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Auth-Token');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ---- 用户认证辅助（从 chat.php 复制）----
function verifyAuthToken($token) {
    $sessionsFile = __DIR__ . '/users/sessions.json';
    if (!file_exists($sessionsFile)) return null;
    $sessions = @json_decode(@file_get_contents($sessionsFile), true);
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

// ---- 获取认证用户信息 ----
$authToken = isset($_GET['auth_token']) ? preg_replace('/[^a-f0-9]/', '', $_GET['auth_token']) : '';
if (empty($authToken)) {
    $authToken = isset($_SERVER['HTTP_AUTH_TOKEN']) ? preg_replace('/[^a-f0-9]/', '', $_SERVER['HTTP_AUTH_TOKEN']) : '';
}

$userId = null;
if (!empty($authToken)) {
    $userId = verifyAuthToken($authToken);
}

// ---- 目录隔离逻辑 ----
$uploadDir = __DIR__ . '/uploads/';
if ($userId) {
    // 已登录用户：按 userId 分目录
    $subDir = 'user_' . preg_replace('/[^a-zA-Z0-9_-]/', '', $userId);
} elseif (isset($_GET['device_id'])) {
    // 未登录但有 device_id
    $deviceId = preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['device_id']);
    $subDir = (strlen($deviceId) > 0 && strlen($deviceId) <= 64) ? 'device_' . $deviceId : 'anonymous';
} else {
    // 匿名用户
    $subDir = 'anonymous';
}

// 最终 uploadDir 带子目录
$uploadDir = $uploadDir . $subDir . '/';
if (!is_dir($uploadDir)) {
    if (!@mkdir($uploadDir, 0755, true)) {
        http_response_code(500);
        echo json_encode(['error' => 'Cannot create upload directory']);
        exit;
    }
}

// ---- 路径安全辅助：禁止目录穿越 ----
function safePath($baseDir, $filename) {
    $realBase = realpath($baseDir);
    if ($realBase === false) return false;
    $fullPath = $realBase . '/' . basename($filename);
    // basename() 会剥掉 ../ 等路径成分
    return (strpos($fullPath, $realBase) === 0) ? $fullPath : false;
}


if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $filename = '';
    $imageData = null;
    $ext = 'png';

    // 支持 multipart/form-data 和 base64 JSON
    if (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
        $tmpFile = $_FILES['image']['tmp_name'];
        $origName = $_FILES['image']['name'];
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
        // 大文件(>50MB)直接移动，不读到内存
        $fileSize = filesize($tmpFile);
        if ($fileSize > 50 * 1024 * 1024) {
            $imageData = null; // 不读入内存
        } else {
            $imageData = @file_get_contents($tmpFile);
        }
    } else {
        $input = file_get_contents('php://input');
        if ($input === false || $input === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Empty request body']);
            exit;
        }
        $data = json_decode($input, true);
        if (!$data || !isset($data['image'])) {
            http_response_code(400);
            echo json_encode(['error' => 'No image data provided']);
            exit;
        }

        $imageRaw = $data['image'];
        if (preg_match('/^data:(image|video)\/(\w+);base64,(.+)$/s', $imageRaw, $matches)) {
            $ext = strtolower($matches[2]);
            $imageData = base64_decode($matches[3]);
        } else {
            $imageData = base64_decode($imageRaw);
            $ext = 'png';
        }
    }

    if ($imageData === null) {
        // 大文件模式：直接从 tmp 文件移动到目标位置
    } else if (!$imageData || strlen($imageData) === 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid or empty image data']);
        exit;
    }

    // 验证文件类型（常见图片格式 + 视频格式）
    $allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'tif', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'];
    $videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'];
    if (!in_array($ext, $allowedExts)) {
        $ext = 'png'; // 未知扩展名默认 png
    }
    $isVideo = in_array($ext, $videoExts);

    // 检查是否为真实图片或视频
    if ($isVideo) {
        // 视频: 基本检查（大文件从 tmp 文件检测）
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if ($imageData === null && isset($tmpFile)) {
            $detectedMime = finfo_file($finfo, $tmpFile);
        } else {
            $detectedMime = finfo_buffer($finfo, $imageData);
        }
        finfo_close($finfo);
        $validVideoMimes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/x-flv', 'video/x-ms-wmv'];
        $allowed = false;
        foreach ($validVideoMimes as $vm) {
            if (strpos($detectedMime, $vm) === 0) { $allowed = true; break; }
        }
        if (!$allowed) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid video type: ' . $detectedMime]);
            exit;
        }
    } else if (!in_array($ext, ['svg'])) {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if ($imageData === null && isset($tmpFile)) {
            $detectedMime = finfo_file($finfo, $tmpFile);
        } else {
            $detectedMime = finfo_buffer($finfo, $imageData);
        }
        finfo_close($finfo);
        $validMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/x-icon'];
        $allowed = false;
        foreach ($validMimes as $vm) {
            if (strpos($detectedMime, $vm) === 0) { $allowed = true; break; }
        }
        if (!$allowed) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid image type: ' . $detectedMime]);
            exit;
        }
    }

    // 限制文件大小: 2GB (大文件模式走 filesize)
    $maxSize = 2 * 1024 * 1024 * 1024;
    if ($imageData === null) {
        // 大文件模式：使用 filesize 检查
        $checkSize = filesize($tmpFile);
    } else {
        $checkSize = strlen($imageData);
    }
    if ($checkSize > $maxSize) {
        $typeLabel = $isVideo ? 'Video' : 'Image';
        $maxLabel = $isVideo ? '300MB' : '10MB';
        http_response_code(413);
        echo json_encode(['error' => $typeLabel . ' too large (max ' . $maxLabel . ')']);
        exit;
    }

    // 安全生成文件名（防遍历、防重复）
    if ($imageData === null) {
        $hash = substr(hash_file('sha256', $tmpFile), 0, 12);
    } else {
        $hash = substr(hash('sha256', $imageData), 0, 12);
    }
    $filename = 'img_' . $hash . '.' . $ext;
    $filepath = safePath($uploadDir, $filename);
    if ($filepath === false) {
        http_response_code(403);
        echo json_encode(['error' => 'Invalid filename']);
        exit;
    }

    $writeOk = false;
    if ($imageData === null) {
        // 大文件：直接移动临时文件
        $writeOk = rename($tmpFile, $filepath);
        $finalSize = $writeOk ? filesize($filepath) : 0;
    } else {
        $writeOk = file_put_contents($filepath, $imageData, LOCK_EX) !== false;
        $finalSize = strlen($imageData);
    }
    if ($writeOk) {
        $url = '/oneapichat/uploads/' . $subDir . '/' . rawurlencode($filename);
        echo json_encode([
            'url' => $url,
            'path' => $filepath,
            'size' => $finalSize,
            'type' => $ext
        ]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to save image']);
    }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // 列表接口需要认证（未登录只能查看自己上传的文件）
    // 注意：anonymous 无 token 也允许列出（因为 anonymous 没有 auth_token）
    // 但如果有 auth_token 但验证失败，仍返回 401
    if (!empty($authToken) && $userId === null) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }

    // 只列出当前用户/设备目录下的文件
    $images = glob($uploadDir . '*.{jpg,jpeg,png,gif,webp,bmp,svg,ico,tiff}', GLOB_BRACE);
    $list = [];
    if ($images !== false) {
        foreach ($images as $img) {
            $safe = safePath($uploadDir, basename($img));
            if ($safe === false) continue;
            $list[] = [
                'filename' => basename($img),
                'url' => '/oneapichat/uploads/' . $subDir . '/' . rawurlencode(basename($img)),
                'size' => filesize($safe)
            ];
        }
    }
    echo json_encode(['images' => $list, 'directory' => $subDir], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
