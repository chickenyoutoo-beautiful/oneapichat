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

require_once __DIR__ . '/auth_helpers.php';

/**
 * 将已落盘的生成图原子地绑定到聊天消息。
 * 与 chat.php 使用同一个 all.json.lock，确保旧标签页的全量保存不能穿插覆盖。
 */
function persistGeneratedImageToChat($userId, array $requestData, string $url): array {
    if (empty($requestData['persist_generated'])) return ['requested' => false, 'ok' => false];
    if (!$userId) return ['requested' => true, 'ok' => false, 'error' => 'authentication required'];

    $chatId = isset($requestData['chat_id']) ? (string)$requestData['chat_id'] : '';
    if ($chatId === '' || !preg_match('/^[a-zA-Z0-9_-]{1,128}$/', $chatId)) {
        return ['requested' => true, 'ok' => false, 'error' => 'invalid chat_id'];
    }

    $namespace = 'user_' . preg_replace('/[^a-zA-Z0-9_-]/', '', $userId);
    $chatFile = dirname(__DIR__) . '/chat_data/' . $namespace . '_all.json';
    $lockHandle = @fopen($chatFile . '.lock', 'c');
    if (!$lockHandle || !@flock($lockHandle, LOCK_EX)) {
        if ($lockHandle) @fclose($lockHandle);
        return ['requested' => true, 'ok' => false, 'error' => 'chat save busy'];
    }

    try {
        $allData = is_file($chatFile) ? json_decode((string)file_get_contents($chatFile), true) : null;
        if (!is_array($allData) || !isset($allData['chats'][$chatId]) || !is_array($allData['chats'][$chatId])) {
            return ['requested' => true, 'ok' => false, 'error' => 'chat not found'];
        }
        if (!isset($allData['chats'][$chatId]['messages']) || !is_array($allData['chats'][$chatId]['messages'])) {
            $allData['chats'][$chatId]['messages'] = [];
        }
        $messages =& $allData['chats'][$chatId]['messages'];

        $messageIndex = isset($requestData['message_index']) && is_numeric($requestData['message_index'])
            ? (int)$requestData['message_index'] : -1;
        if ($messageIndex < 0 || !isset($messages[$messageIndex]) || ($messages[$messageIndex]['role'] ?? '') !== 'assistant') {
            $messageIndex = -1;
            for ($i = count($messages) - 1; $i >= 0; $i--) {
                if (($messages[$i]['role'] ?? '') === 'assistant') {
                    $messageIndex = $i;
                    break;
                }
            }
        }
        if ($messageIndex < 0) {
            $messages[] = ['role' => 'assistant', 'content' => '', 'time' => (int)round(microtime(true) * 1000)];
            $messageIndex = count($messages) - 1;
        }

        $rawMeta = isset($requestData['image_meta']) && is_array($requestData['image_meta'])
            ? $requestData['image_meta'] : [];
        $limitText = static function($value, int $max): string {
            $value = is_scalar($value) ? (string)$value : '';
            return mb_substr($value, 0, $max, 'UTF-8');
        };
        $meta = [
            'url' => $url,
            'prompt' => $limitText($rawMeta['prompt'] ?? '', 12000),
            'model' => $limitText($rawMeta['model'] ?? '', 256),
            'aspect_ratio' => $limitText($rawMeta['aspect_ratio'] ?? '1:1', 32),
            'timestamp' => isset($rawMeta['timestamp']) && is_numeric($rawMeta['timestamp'])
                ? (int)$rawMeta['timestamp'] : (int)round(microtime(true) * 1000),
            'notes' => $limitText($rawMeta['notes'] ?? '', 2000),
        ];

        $message =& $messages[$messageIndex];
        $existing = isset($message['generatedImages']) && is_array($message['generatedImages'])
            ? $message['generatedImages'] : [];
        $found = false;
        foreach ($existing as $idx => $item) {
            $itemUrl = is_string($item) ? $item : (is_array($item) ? ($item['url'] ?? '') : '');
            if ($itemUrl === $url) {
                $existing[$idx] = $meta;
                $found = true;
                break;
            }
        }
        if (!$found) $existing[] = $meta;
        $message['generatedImages'] = $existing;
        if (empty($message['generatedImage'])) $message['generatedImage'] = $meta;

        $nowMs = (int)round(microtime(true) * 1000);
        $allData['chats'][$chatId]['updated_at'] = $nowMs;
        $allData['updated_at'] = date('c');
        $encoded = json_encode($allData, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        if ($encoded === false) return ['requested' => true, 'ok' => false, 'error' => 'encode failed'];

        $tmpFile = @tempnam(dirname($chatFile), '.generated-image-');
        if (!$tmpFile || @file_put_contents($tmpFile, $encoded, LOCK_EX) === false || !@rename($tmpFile, $chatFile)) {
            if ($tmpFile && is_file($tmpFile)) @unlink($tmpFile);
            return ['requested' => true, 'ok' => false, 'error' => 'chat write failed'];
        }
        @chmod($chatFile, 0664);
        return ['requested' => true, 'ok' => true, 'message_index' => $messageIndex];
    } finally {
        @flock($lockHandle, LOCK_UN);
        @fclose($lockHandle);
    }
}

// ---- 获取认证用户信息 ----
$authToken = extractBearerToken();
if (empty($authToken) && !empty($_COOKIE['auth_token'])) {
    $authToken = preg_replace('/[^a-f0-9]/', '', (string)$_COOKIE['auth_token']);
}
if (empty($authToken) && !empty($_SERVER['HTTP_AUTH_TOKEN'])) {
    $authToken = preg_replace('/[^a-f0-9]/', '', $_SERVER['HTTP_AUTH_TOKEN']);
}
if (empty($authToken)) {
    // Compatibility for clients pending the header-auth rollout.
    $authToken = isset($_GET['auth_token']) ? preg_replace('/[^a-f0-9]/', '', $_GET['auth_token']) : '';
}

$userId = null;
if (!empty($authToken)) {
    $userId = verifyAuthToken($authToken);
}

// ---- 目录隔离逻辑 ----
$uploadDir = dirname(__DIR__) . '/uploads/';
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
function safePath(string $baseDir, string $filename): string {
    $realBase = realpath($baseDir);
    if ($realBase === false) return false;
    $fullPath = $realBase . '/' . basename($filename);
    // basename() 会剥掉 ../ 等路径成分
    return (strpos($fullPath, $realBase) === 0) ? $fullPath : false;
}

// ---- 文件名提示语净化：将用户输入/提示词转为安全的文件名片段 ----
function sanitizeFilenameHint(string $input): string {
    // 取前 40 字符（中文最多约 20 个汉字）
    $hint = mb_substr($input, 0, 40, 'UTF-8');
    // 将非字母/数字/汉字/连字符的字符替换为连字符
    $hint = preg_replace('/[^\p{L}\p{N}\-]+/u', '-', $hint);
    // 合并连续连字符
    $hint = preg_replace('/-{2,}/', '-', $hint);
    // 去除首尾连字符
    $hint = trim($hint, '-');
    // 限制最终长度（避免超长文件名）
    if (mb_strlen($hint, 'UTF-8') > 60) {
        $hint = mb_substr($hint, 0, 60, 'UTF-8');
        $hint = rtrim($hint, '-');
    }
    return $hint;
}


if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = [];
    $filename = '';
    $imageData = null;
    $ext = 'png';

    // ★ v2.7.0: 通用文件上传模式 — target=generic 跳过图片/MIME验证, 允许任意扩展名
    $isGeneric = (isset($_GET['target']) && $_GET['target'] === 'generic')
        || (isset($_POST['_target']) && $_POST['_target'] === 'generic');

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
            $imageData = file_get_contents($tmpFile);
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
    $allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'heif', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'];
    $videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'];
    if (!$isGeneric && !in_array($ext, $allowedExts)) {
        $ext = 'png'; // 未知扩展名默认 png (仅图片模式)
    }
    $isVideo = in_array($ext, $videoExts);

    // ★ generic 模式: 跳过图片/MIME验证, 仅做基本扩展名安全过滤
    if ($isGeneric) {
        // 过滤危险扩展名 (防止上传可执行脚本)
        $dangerousExts = ['php', 'php3', 'php4', 'php5', 'phtml', 'cgi', 'pl', 'py', 'sh', 'bash', 'exe', 'scr', 'pif', 'cmd', 'bat', 'com', 'vbs', 'js', 'wsf', 'msi'];
        // 注意: .msi/.exe/.bat/.cmd 对 Cloudreve 存储来说是合法文件, 仅禁止作为 Web 脚本执行
        // 真正危险的是 php/cgi/pl/py/sh 等可在服务器执行的脚本
        $scriptExts = ['php', 'php3', 'php4', 'php5', 'phtml', 'cgi', 'pl', 'pyz', 'pyzw'];
        if (in_array($ext, $scriptExts)) {
            http_response_code(400);
            echo json_encode(['error' => "禁止上传可执行脚本: .$ext"]);
            exit;
        }
        // 扩展名安全: 只允许字母数字和少量安全符号
        if (!preg_match('/^[a-zA-Z0-9]{1,10}$/', $ext)) {
            $ext = 'bin'; // 未知或异常扩展名统一为 bin
        }
    } else {
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
        $validMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/x-icon', 'image/heic', 'image/heif'];
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
    } // end if !$isGeneric

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

    // ★ HEIC/HEIF 转换: iPhone 默认格式, xAI/OpenAI API 不支持, 转为 JPEG
    if (!$isGeneric && !$isVideo && in_array(strtolower($ext), ['heic', 'heif'])) {
        $heicConverted = false;
        // 优先用 Imagick (支持 HEIC)
        if (class_exists('Imagick')) {
            try {
                $imagick = new Imagick();
                if ($imageData !== null) {
                    $imagick->readImageBlob($imageData);
                } elseif (isset($tmpFile)) {
                    $imagick->readImage($tmpFile);
                }
                $imagick->setImageFormat('jpeg');
                $imagick->setImageCompressionQuality(90);
                // ★ 处理 EXIF 方向 (iPhone 竖拍照片 orientation 元数据)
                $orientation = $imagick->getImageOrientation();
                switch ($orientation) {
                    case Imagick::ORIENTATION_RIGHTTOP: $imagick->rotateImage('#000', 90); break;
                    case Imagick::ORIENTATION_BOTTOMRIGHT: $imagick->rotateImage('#000', 180); break;
                    case Imagick::ORIENTATION_LEFTBOTTOM: $imagick->rotateImage('#000', 270); break;
                }
                $imagick->setImageOrientation(Imagick::ORIENTATION_TOPLEFT);
                $imageData = $imagick->getImageBlob();
                $imagick->clear();
                $ext = 'jpg';
                $heicConverted = true;
                error_log('[upload] HEIC→JPEG 转换成功 (Imagick), 输出大小: ' . strlen($imageData) . ' bytes');
            } catch (Exception $heicErr) {
                error_log('[upload] Imagick HEIC 转换失败: ' . $heicErr->getMessage());
            }
        }
        // 降级: GD (PHP 8.1+ 支持 HEIC)
        if (!$heicConverted && function_exists('imagecreatefromstring')) {
            try {
                $srcImg = ($imageData !== null) ? imagecreatefromstring($imageData) : imagecreatefromjpeg($tmpFile);
                if ($srcImg) {
                    // 尝试用 GD 直接解码 (PHP 8.1+ with libheif)
                    if ($imageData !== null) {
                        $tmpHeic = tempnam(sys_get_temp_dir(), 'heic');
                        file_put_contents($tmpHeic, $imageData);
                        $gdImg = @imagecreatefromheif($tmpHeic);
                        @unlink($tmpHeic);
                        if ($gdImg) { imagedestroy($srcImg); $srcImg = $gdImg; }
                    }
                    if ($srcImg) {
                        ob_start();
                        imagejpeg($srcImg, null, 90);
                        $imageData = ob_get_clean();
                        imagedestroy($srcImg);
                        $ext = 'jpg';
                        $heicConverted = true;
                        error_log('[upload] HEIC→JPEG 转换成功 (GD), 输出大小: ' . strlen($imageData) . ' bytes');
                    }
                }
            } catch (Exception $gdErr) {
                error_log('[upload] GD HEIC 转换失败: ' . $gdErr->getMessage());
            }
        }
        // 转换失败则拒绝上传, 提示用户
        if (!$heicConverted) {
            http_response_code(415);
            echo json_encode(['error' => 'HEIC 格式转换失败, 请先用相册编辑功能转为 JPEG/PNG 后再上传, 或在 iPhone 设置→相机→格式中选择"兼容性最佳"']);
            exit;
        }
        // 转换后重新检测 mime 确保是合法 JPEG
        $detectedMime = finfo_buffer(finfo_open(FILEINFO_MIME_TYPE), $imageData);
        if (strpos($detectedMime, 'image/jpeg') !== 0) {
            http_response_code(415);
            echo json_encode(['error' => 'HEIC 转换后格式异常: ' . $detectedMime . ', 请转为 JPEG/PNG 后重试']);
            exit;
        }
    }

    // 安全生成文件名（防遍历、防重复）
    if ($imageData === null) {
        $hash = substr(hash_file('sha256', $tmpFile), 0, 12);
    } else {
        $hash = substr(hash('sha256', $imageData), 0, 12);
    }
    // ★ generic 模式用 file_ 前缀, 图片/视频用 img_ 前缀
    $prefix = $isGeneric ? 'file' : 'img';

    // ★ 人类可读文件名: JSON 上传从 data.name 读取，multipart 从 POST name/原始文件名读取。
    // 格式: file_<sanitized_name>_<hash>.ext，避免服务器只剩不可辨识哈希名。
    $nameHint = '';
    $rawNameHint = '';
    if (!empty($data['name']) && is_string($data['name'])) {
        $rawNameHint = $data['name'];
    } elseif (!empty($_POST['name']) && is_string($_POST['name'])) {
        $rawNameHint = $_POST['name'];
    } elseif (!empty($origName)) {
        $rawNameHint = pathinfo($origName, PATHINFO_FILENAME);
    }
    if ($rawNameHint !== '') {
        $rawNameHint = pathinfo($rawNameHint, PATHINFO_FILENAME);
        $nameHint = sanitizeFilenameHint($rawNameHint);
    }
    if ($nameHint !== '') {
        $filename = $prefix . '_' . $nameHint . '_' . $hash . '.' . $ext;
    } else {
        $filename = $prefix . '_' . $hash . '.' . $ext;
    }
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
        @chmod($filepath, 0644);  // 确保 engine 进程可读
        $url = '/oneapichat/uploads/' . $subDir . '/' . rawurlencode($filename);

        // 生成图的聊天关联属于主事务。绑定失败时返回可重试错误；同一图片按哈希
        // 使用同一文件名，客户端重试不会制造重复文件或重复图片记录。
        $chatPersist = persistGeneratedImageToChat($userId, $data, $url);
        if (!empty($chatPersist['requested']) && empty($chatPersist['ok'])) {
            http_response_code(503);
            echo json_encode(['error' => 'Image saved but chat association failed', 'detail' => $chatPersist['error'] ?? 'unknown']);
            exit;
        }

        // ★ 2026-08-03 云盘全面结合: 已登录用户上传的文件同步到其绑定的 Cloudreve 账号 OneAPIChat/uploads
        //   PHP-FPM 下先把本地 URL 返回浏览器，再在响应结束后同步云盘，避免让气泡多等一次远端 I/O。
        $cloudreve = null;
        $responsePayload = [
            'url' => $url,
            'path' => $filepath,
            'size' => $finalSize,
            'type' => $ext,
            'chat_persisted' => !empty($chatPersist['ok']),
            'message_index' => $chatPersist['message_index'] ?? null,
            'cloudreve' => $userId ? ['queued' => true] : null,
        ];

        if ($userId && function_exists('fastcgi_finish_request')) {
            echo json_encode($responsePayload);
            fastcgi_finish_request();
            require_once __DIR__ . '/cloudreve_lib.php';
            $crResult = cr_importFile($userId, $filepath, 'uploads');
            if (empty($crResult['success'])) {
                error_log('[cloudreve] upload.php 自动导入失败: ' . ($crResult['error'] ?? '未知错误') . " file=$filepath");
            }
            exit;
        }
        if ($userId) {
            require_once __DIR__ . '/cloudreve_lib.php';
            $crResult = cr_importFile($userId, $filepath, 'uploads');
            $responsePayload['cloudreve'] = [
                'synced' => !empty($crResult['success']),
                'path' => $crResult['cloudreve_path'] ?? '',
                'source' => $crResult['source'] ?? '',
                'error' => $crResult['error'] ?? null,
            ];
        }
        echo json_encode($responsePayload);
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
