<?php
// ---- CORS headers ----
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Auth-Token');
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ---- Auth token helper (same as chat.php) ----
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

// ---- Auth verification ----
$action = $_GET['action'] ?? '';

// health action: no auth required
if ($action !== 'health') {
    $authToken = isset($_GET['auth_token'])
        ? preg_replace('/[^a-f0-9]/', '', $_GET['auth_token'])
        : (isset($_SERVER['HTTP_AUTH_TOKEN'])
            ? preg_replace('/[^a-f0-9]/', '', $_SERVER['HTTP_AUTH_TOKEN'])
            : '');

    $userId = null;
    if (!empty($authToken)) {
        $userId = verifyAuthToken($authToken);
    }

    // 未登录也允许device_id（读兼容）
    $hasDeviceId = isset($_GET['device_id']) && preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $_GET['device_id']);

    if (!$userId && !$hasDeviceId) {
        echo json_encode(['error' => 'Unauthorized']);
        http_response_code(401);
        exit;
    }
}

// ---- Config ----
$rag_url = 'http://127.0.0.1:8765';
$collection_param = '';

if (!empty($_GET['collection'])) {
    $collection_param = '?collection=' . urlencode($_GET['collection']);
}

// ---- Proxy helpers ----
function proxy_get($url) {
    return @file_get_contents($url);
}

function proxy_get_long($url, $timeout = 120) {
    $opts = ['http' => [
        'timeout' => $timeout,
        'ignore_errors' => true
    ]];
    return @file_get_contents($url, false, stream_context_create($opts));
}

function proxy_post($url, $body, $timeout = 60) {
    $opts = ['http' => [
        'method' => 'POST',
        'header' => 'Content-Type: application/json',
        'content' => $body,
        'timeout' => $timeout,
        'ignore_errors' => true
    ]];
    return @file_get_contents($url, false, stream_context_create($opts));
}

function proxy_upload($url) {
    if (!isset($_FILES['file'])) {
        return json_encode(['error' => '没有收到文件', 'file_info' => $_FILES ?? []]);
    }
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        return json_encode(['error' => '上传错误', 'code' => $file['error']]);
    }
    $boundary = '----RAG' . md5(time());
    $body = '';
    $body .= '--' . $boundary . "\r\n";
    $body .= 'Content-Disposition: form-data; name="file"; filename="' . basename($file['name']) . "\"\r\n";
    $body .= "Content-Type: application/octet-stream\r\n\r\n";
    $body .= file_get_contents($file['tmp_name']) . "\r\n";
    $body .= '--' . $boundary . "--\r\n";
    $opts = ['http' => [
        'method' => 'POST',
        'header' => "Content-Type: multipart/form-data; boundary=$boundary\r\nContent-Length: " . strlen($body),
        'content' => $body,
        'timeout' => 120,
        'ignore_errors' => true
    ]];
    $result = @file_get_contents($url, false, stream_context_create($opts));
    if ($result === false) {
        return json_encode(['error' => '后端无响应']);
    }
    return $result;
}

// ---- Action routing ----
switch ($action) {
    case 'health':
        echo proxy_get("$rag_url/health$collection_param");
        break;
    case 'knowledge':
        echo proxy_get("$rag_url/knowledge$collection_param");
        break;
    case 'search':
        $body = file_get_contents('php://input');
        echo proxy_post("$rag_url/search$collection_param", $body, 10);
        break;
    case 'ask':
        $body = file_get_contents('php://input');
        echo proxy_post("$rag_url/ask$collection_param", $body, 60);
        break;
    case 'list_models':
        echo proxy_get("$rag_url/list_models");
        break;
    case 'upload':
        $modeParam = isset($_GET['mode']) ? '&mode=' . urlencode($_GET['mode']) : '';
        echo proxy_upload("$rag_url/upload$collection_param$modeParam");
        break;
    case 'embed_config':
        $extra = '';
        if (!empty($_GET['embed_model'])) $extra .= '&embed_model=' . urlencode($_GET['embed_model']);
        if (!empty($_GET['embed_base_url'])) $extra .= '&embed_base_url=' . urlencode($_GET['embed_base_url']);
        if (!empty($_GET['mode'])) $extra .= '&mode=' . urlencode($_GET['mode']);
        // 后端统一处理 GET/POST，代理统一用 GET 避免 stream 慢
        echo proxy_get_long("$rag_url/embed_config$collection_param$extra");
        break;
    case 'collections':
        $all = json_decode(proxy_get("$rag_url/collections"), true);
        $cols = $all['collections'] ?? [];
        // 提取用户ID前缀：collection=userId → userId_
        $ns = '';
        if (!empty($_GET['collection'])) {
            $ns = $_GET['collection'] . '_';
        }
        $filtered = [];
        foreach ($cols as $c) {
            if (!$ns || strpos($c, $ns) === 0) {
                // 去掉用户ID前缀，只返回集合显示名
                $filtered[] = $ns ? substr($c, strlen($ns)) : $c;
            }
        }
        echo json_encode(['collections' => $filtered]);
        break;
    case 'create_collection':
        $name = $_GET['name'] ?? '';
        // 从collection参数提取用户前缀
        $ns = '';
        if (!empty($_GET['collection'])) {
            $ns = $_GET['collection'] . '_';
        }
        $full_name = $ns . urlencode($name);
        echo proxy_get("$rag_url/create_collection?name=$full_name");
        break;
    case 'delete_document':
        $docId = $_GET['doc_id'] ?? '';
        echo proxy_get("$rag_url/delete_document$collection_param&doc_id=" . urlencode($docId));
        break;
    case 'delete_collection':
        $name = $_GET['name'] ?? '';
        // build full namespaced name
        $ns = '';
        if (!empty($_GET['collection'])) {
            $ns = $_GET['collection'] . '_';
        }
        $full_name = $ns . urlencode($name);
        echo proxy_get("$rag_url/delete_collection?name=$full_name");
        break;
    default:
        echo json_encode(['error' => 'unknown action']);
}