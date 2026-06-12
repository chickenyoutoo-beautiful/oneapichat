<?php
/**
 * RAG (Retrieval Augmented Generation) Proxy
 * 代理到 Python 引擎的 /engine/rag/ 端点
 */
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$engine_url = 'http://127.0.0.1:8766';
$action = $_GET['action'] ?? 'search';
$method = $_SERVER['REQUEST_METHOD'];

// 构建引擎 URL
$query = http_build_query($_GET);
$url = $engine_url . '/engine/rag/' . $action . '?' . $query;

if ($method === 'GET') {
    $ctx = stream_context_create(['http' => ['timeout' => 60, 'ignore_errors' => true]]);
    $resp = file_get_contents($url, false, $ctx);
    if ($resp !== false) {
        echo $resp;
    } else {
        echo json_encode(['error' => 'RAG engine unreachable']);
    }
} elseif ($method === 'POST') {
    if ($action === 'upload' && !empty($_FILES['file'])) {
        // 文件上传: 读取 $_FILES, 构建 JSON 转发给引擎
        $file = $_FILES['file'];
        $filename = $file['name'];
        $tmpPath = $file['tmp_name'];
        if ($file['error'] !== UPLOAD_ERR_OK) {
            http_response_code(400);
            echo json_encode(['error' => '文件上传失败, code=' . $file['error']]);
            exit;
        }
        $content = file_get_contents($tmpPath);
        if ($content === false || strlen($content) === 0) {
            http_response_code(400);
            echo json_encode(['error' => '文件为空或无法读取']);
            exit;
        }
        // 二进制文件（PDF/DOCX/XLSX）：base64编码后传给引擎
        $isUtf8 = mb_check_encoding($content, 'UTF-8');
        $collection = $_GET['collection'] ?? 'default';
        if ($isUtf8) {
            $jsonBody = json_encode([
                'collection' => $collection,
                'filename' => $filename,
                'content' => $content,
            ], JSON_UNESCAPED_UNICODE);
        } else {
            $jsonBody = json_encode([
                'collection' => $collection,
                'filename' => $filename,
                'content_base64' => base64_encode($content),
            ]);
        }
        if ($jsonBody === false) {
            http_response_code(400);
            echo json_encode(['error' => '文件编码处理失败']);
            exit;
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $jsonBody,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        http_response_code($code ?: 200);
        echo $resp;
    } else {
        $body = file_get_contents('php://input');
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        http_response_code($code ?: 200);
        echo $resp;
    }
} elseif ($method === 'DELETE') {
    // DELETE: 从 query params 构建 JSON body(前端通过 URL 传参)
    $deleteBody = json_encode([
        'doc_id' => $_GET['doc_id'] ?? '',
        'collection' => $_GET['collection'] ?? 'default',
    ]);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_POSTFIELDS => $deleteBody,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    http_response_code($code ?: 200);
    echo $resp;
} else {
    echo json_encode(['error' => 'Method not allowed']);
}
