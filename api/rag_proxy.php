<?php
/**
 * RAG (Retrieval Augmented Generation) Proxy
 * 代理到 Python 引擎的 /engine/rag/ 端点
 */
require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';
require_once __DIR__ . '/engine_bridge.php';
setApiCorsHeaders();
header('Content-Type: application/json');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
$token = extractBearerToken() ?: (string)($_COOKIE['auth_token'] ?? '');
$userId = $token ? verifyAuthToken($token) : null;
if (!$userId) {
    http_response_code(401);
    echo json_encode(['error' => ['code' => 'UNAUTHORIZED', 'message' => 'Authentication required']]);
    exit;
}
// Legacy callers may still include auth_token in the URL; it is never an engine
// parameter and must not be forwarded into loopback request logs.
unset($_GET['auth_token']);
$_GET['user_id'] = $userId;

// RAG 已内置在 oneapichat-engine (8766) 的 /engine/rag/*，不再依赖不存在的独立 8765 进程。
$engine_url = 'http://127.0.0.1:8766';
$action = $_GET['action'] ?? 'search';
$method = $_SERVER['REQUEST_METHOD'];

// 构建引擎 URL
$query = http_build_query($_GET);
$url = $engine_url . '/engine/rag/' . $action . '?' . $query;

if ($method === 'GET') {
    $ctx = oneapichatEngineContext(['timeout' => 60]);
    $resp = @file_get_contents($url, false, $ctx);
    if ($resp !== false) {
        echo $resp;
    } else {
        http_response_code(502);
        echo json_encode(['error' => ['code' => 'RAG_UPSTREAM_UNAVAILABLE', 'message' => 'RAG engine unavailable']]);
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
            CURLOPT_HTTPHEADER => oneapichatEngineHeaders(['Content-Type: application/json']),
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
            CURLOPT_HTTPHEADER => oneapichatEngineHeaders(['Content-Type: application/json']),
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
        CURLOPT_HTTPHEADER => oneapichatEngineHeaders(['Content-Type: application/json']),
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
