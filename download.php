<?php
/**
 * OneAPIChat 文件下载 API
 * 安全地提供 /tmp/ 目录下由子代理生成的文件
 * 
 * GET /download.php?file=外卖省钱攻略.md
 * GET /download.php?file=外卖省钱攻略.md&raw=1  → 仅返回 raw 文本，不触发下载
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$filename = isset($_GET['file']) ? basename($_GET['file']) : '';
if (!$filename) {
    http_response_code(400);
    echo json_encode(['error' => '缺少 file 参数']);
    exit;
}

// 安全检查：只允许临时目录下的 .md 和 .txt 文件
$allowedDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR;
$filepath = $allowedDir . $filename;

// 防止目录穿越
$realPath = realpath($filepath);
if ($realPath === false || strpos($realPath, realpath($allowedDir)) !== 0) {
    http_response_code(403);
    echo json_encode(['error' => '文件路径不合法']);
    exit;
}

if (!file_exists($realPath)) {
    http_response_code(404);
    echo json_encode(['error' => '文件不存在']);
    exit;
}

// 只允许特定扩展名
$ext = strtolower(pathinfo($realPath, PATHINFO_EXTENSION));
$allowedExts = ['md', 'txt', 'csv', 'json', 'html', 'log'];
if (!in_array($ext, $allowedExts)) {
    http_response_code(403);
    echo json_encode(['error' => '不允许下载该类型文件']);
    exit;
}

// 文件大小限制：50MB
$maxSize = 50 * 1024 * 1024;
$fileSize = filesize($realPath);
if ($fileSize > $maxSize) {
    http_response_code(413);
    echo json_encode(['error' => '文件过大']);
    exit;
}

// raw 模式：直接输出文本（供前端预览）
if (isset($_GET['raw'])) {
    header('Content-Type: text/plain; charset=utf-8');
    header('Content-Length: ' . $fileSize);
    readfile($realPath);
    exit;
}

// 下载模式
header('Content-Description: File Transfer');
header('Content-Type: text/markdown; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Content-Length: ' . $fileSize);
header('Cache-Control: no-cache');
readfile($realPath);
