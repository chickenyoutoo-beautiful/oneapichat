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
} elseif ($method === 'DELETE') {
    $body = file_get_contents('php://input');
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_POSTFIELDS => $body,
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
