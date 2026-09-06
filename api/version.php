<?php
/**
 * version.php — 页面版本检测端点
 * 返回 public/index.html 的内容指纹 (mtime + md5), 前端 update-check.js 轮询对比:
 *   指纹变化 = 部署了新版本 → 弹出「新版本可用」硬刷新按钮
 * 注意: 指纹基于内容而非文件时间, 避免仅触碰文件不改变内容造成的误报
 */
$f = dirname(__DIR__) . '/public/index.html';
$styleFile = dirname(__DIR__) . '/public/css/style.css';
header('Content-Type: application/json');
header('Cache-Control: no-store, no-cache, must-revalidate');
if (!is_file($f)) {
    echo json_encode(['ok' => false, 'error' => 'index.html not found']);
    exit;
}
echo json_encode([
    'ok'       => true,
    'v'        => filemtime($f),
    'style_v'  => is_file($styleFile) ? filemtime($styleFile) : null,
    'hash'     => md5_file($f),
]);
