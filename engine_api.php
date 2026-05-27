<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ---- 本地认证辅助 ----
function _engine_verifyAuthToken($token) {
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

$action = $_GET['action'] ?? '';
$engine_url = 'http://127.0.0.1:8766';

// ── /engine/video_edit POST 转发 ──
$requestUri = $_SERVER['REQUEST_URI'] ?? '';
$requestPath = parse_url($requestUri, PHP_URL_PATH) ?? '';
if (str_ends_with($requestPath, '/engine/video_edit') && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = file_get_contents('php://input');
    $ch = curl_init($engine_url . '/engine/video_edit');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 600,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($err) {
        http_response_code(502);
        echo json_encode(['error' => 'Engine unreachable: ' . $err]);
    } else {
        http_response_code($httpCode);
        echo $resp;
    }
    exit;
}

// ★ 优先从 HTTP Header 读取 auth_token (避免 URL 明文传输)
$authHeader = '';
if (function_exists('getallheaders')) {
    $headers = getallheaders();
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    if ($authHeader && strpos($authHeader, 'Bearer ') === 0) {
        $authHeader = substr($authHeader, 7);
    }
} elseif (isset($_SERVER['HTTP_AUTHORIZATION'])) {
    $authHeader = str_replace('Bearer ', '', $_SERVER['HTTP_AUTHORIZATION']);
} elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    $authHeader = str_replace('Bearer ', '', $_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
}
$authToken = '';
// Header 优先, 回退到 GET param (兼容旧版)
if (!empty($authHeader) && preg_match('/^[a-f0-9]{32,}$/', $authHeader)) {
    $authToken = $authHeader;
} elseif (isset($_GET['auth_token'])) {
    $authToken = preg_replace('/[^a-f0-9]/', '', $_GET['auth_token']);
}
$userId = '';
if (!empty($authToken)) {
    $uid = _engine_verifyAuthToken($authToken);
    if ($uid !== null) {
        $userId = $uid;
    }
}
$userParam = $userId ? '&user_id=' . urlencode($userId) : '';

switch ($action) {
    case 'health':
        $resp = @file_get_contents($engine_url . '/engine/health');
        echo $resp ?: json_encode(['status' => 'error', 'message' => 'unreachable']);
        break;

    case 'heartbeat':
        $resp = @file_get_contents($engine_url . '/engine/heartbeat?' . $userParam);
        echo $resp ?: json_encode(['ok' => false, 'responses' => []]);
        break;

    case 'notifications':
        // 返回用户未读的 cron/agent 通知
        $resp = @file_get_contents($engine_url . '/engine/notifications?' . $userParam);
        echo $resp ?: json_encode(['ok' => true, 'notifications' => [], 'cron_results' => [], 'agent_results' => []]);
        break;

    case 'cron_list':
        echo @file_get_contents($engine_url . '/engine/cron/list?' . $userParam) ?: '{}';
        break;

    case 'cron_create':
        $name = $_GET['name'] ?? '';
        $interval = intval($_GET['interval'] ?? 60);
        $action_cmd = $_GET['action_cmd'] ?? '';
        if (!$name || !$action_cmd) { echo json_encode(['error' => '缺少参数']); exit; }
        $url = $engine_url . '/engine/cron/create?name=' . urlencode($name) . '&interval=' . $interval . '&action=' . urlencode($action_cmd) . $userParam;
        echo @file_get_contents($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'cron_delete':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo @file_get_contents($engine_url . '/engine/cron/delete?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'agent_list':
        echo shell_exec("curl -s '" . $engine_url . "/engine/agent/list?" . $userParam . "'") ?: '{}';
        break;

    case 'agent_create':
        $name = $_GET['name'] ?? '';
        $prompt = $_GET['prompt'] ?? '';
        $model = $_GET['model'] ?? 'deepseek-chat';
        $api_key = $_GET['api_key'] ?? '';
        $base_url = $_GET['base_url'] ?? '';
        if (!$name || !$prompt) { echo json_encode(['error' => '缺少参数']); exit; }
        $url = $engine_url . '/engine/agent/create?name=' . urlencode($name) . '&prompt=' . urlencode($prompt) . '&model=' . urlencode($model);
        if ($api_key) $url .= '&api_key=' . urlencode($api_key);
        if ($base_url) $url .= '&base_url=' . urlencode($base_url);
        $url .= $userParam;
        echo @file_get_contents($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'agent_run':
        $name = $_GET['name'] ?? '';
        $message = $_GET['message'] ?? '';
        $from_ask = $_GET['from_ask'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        $url = $engine_url . '/engine/agent/run?name=' . urlencode($name) . $userParam;
        if ($message) $url .= '&message=' . urlencode($message);
        if ($from_ask) $url .= '&from_ask=' . urlencode($from_ask);
        echo @file_get_contents($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'agent_status':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo @file_get_contents($engine_url . '/engine/agent/status?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'agent_stop':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo @file_get_contents($engine_url . '/engine/agent/stop?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'agent_delete':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo @file_get_contents($engine_url . '/engine/agent/delete?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'agent_notifications':
        $raw = shell_exec("curl -s '" . $engine_url . "/engine/agent/notifications?" . $userParam . "'");
        $data = $raw ? json_decode($raw, true) : null;
        if (!$data) {
            echo json_encode(['notifications' => [], 'count' => 0, 'allProcessed' => true]);
            break;
        }
        $notifs = $data['notifications'] ?? [];
        // 判断是否全部已处理
        $allProcessed = true;
        foreach ($notifs as $n) {
            if (empty($n['processed'])) { $allProcessed = false; break; }
        }
        $data['allProcessed'] = $allProcessed;
        echo json_encode($data);
        break;

    case 'agent_notifications_mark':
        echo shell_exec("curl -s '" . $engine_url . "/engine/agent/notifications/mark?" . $userParam . "'") ?: json_encode(['ok' => false]);
        break;

    case 'workflow_create':
        $name = $_GET['name'] ?? '';
        $steps = $_GET['steps'] ?? '';
        if (!$name || !$steps) { echo json_encode(['error' => '缺少参数']); exit; }
        echo @file_get_contents($engine_url . '/engine/workflow/create?name=' . urlencode($name) . '&steps=' . urlencode($steps) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'workflow_run':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo @file_get_contents($engine_url . '/engine/workflow/run?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'workflow_list':
        echo @file_get_contents($engine_url . '/engine/workflow/list?' . $userParam) ?: '{}';
        break;

    case 'workflow_status':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo @file_get_contents($engine_url . '/engine/workflow/status?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'workflow_delete':
        $name = $_GET['name'] ?? '';
        if (!$name) { echo json_encode(['error' => '缺少name']); exit; }
        echo @file_get_contents($engine_url . '/engine/workflow/delete?name=' . urlencode($name) . $userParam) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'workflow_roles':
        echo @file_get_contents($engine_url . '/engine/workflow/roles?' . $userParam) ?: json_encode(['roles' => []]);
        break;

    case 'push':
        $msg = $_GET['msg'] ?? '';
        if (!$msg) { echo json_encode(['error' => '缺少msg']); exit; }
        $url = $engine_url . '/engine/heartbeat/push?msg=' . urlencode($msg) . $userParam;
        echo @file_get_contents($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;


    case 'exec':
        $cmd = $_GET['cmd'] ?? '';
        $timeout = intval($_GET['timeout'] ?? 60);
        $cwd = $_GET['cwd'] ?? '';
        if (!$cmd) { echo json_encode(['error' => '缺少cmd']); exit; }
        $url = $engine_url . '/engine/exec?cmd=' . urlencode($cmd) . '&timeout=' . $timeout . '&cwd=' . urlencode($cwd);
        echo @file_get_contents($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'python':
        $script = $_GET['script'] ?? '';
        $timeout = intval($_GET['timeout'] ?? 30);
        if (!$script) { echo json_encode(['error' => '缺少script']); exit; }
        $url = $engine_url . '/engine/python?script=' . urlencode($script) . '&timeout=' . $timeout;
        echo @file_get_contents($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'file_read':
        $path = $_GET['path'] ?? '';
        $max_lines = intval($_GET['max_lines'] ?? 200);
        if (!$path) { echo json_encode(['error' => '缺少path']); exit; }
        $url = $engine_url . '/engine/file/read?path=' . urlencode($path) . '&max_lines=' . $max_lines;
        echo @file_get_contents($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'file_write':
        $path = $_GET['path'] ?? '';
        $content = $_GET['content'] ?? '';
        $append = isset($_GET['append']) && $_GET['append'] === 'true';
        if (!$path || !$content) { echo json_encode(['error' => '缺少参数']); exit; }
        $url = $engine_url . '/engine/file/write?path=' . urlencode($path) . '&content=' . urlencode($content) . '&append=' . ($append ? 'true' : 'false');
        echo @file_get_contents($url) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'sys_info':
        echo @file_get_contents($engine_url . '/engine/sys/info?') ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'mmx':
        $resource = $_GET['resource'] ?? '';
        $cmd = $_GET['cmd'] ?? '';
        $prompt = $_GET['prompt'] ?? '';
        $outFile = $_GET['out'] ?? '';
        if (!$resource || !$cmd) { echo json_encode(['error' => '需要 resource 和 cmd 参数']); exit; }
        // Key 优先级: 请求参数(前端传) > 服务器配置
        $mmxKey = $_GET['api_key'] ?? '';
        $mmxRegion = $_GET['region'] ?? 'cn';
        if (!$mmxKey) {
            $cfg = @json_decode(@file_get_contents(__DIR__ . '/.mmx_config.json'), true);
            if ($cfg && !empty($cfg['api_key'])) { $mmxKey = $cfg['api_key']; $mmxRegion = $cfg['region'] ?? 'cn'; }
        }
        if (!$mmxKey || !preg_match('/^[a-zA-Z0-9_-]+$/', $mmxKey)) { echo json_encode(['error' => 'MiniMax API Key 未配置']); exit; }
        $mmxBin = '/home/naujtrats/.npm-global/bin/mmx';
        // 直接通过 --api-key 传参（key 已验证只有安全字符）
        $apiKeyFlag = '--api-key ' . $mmxKey;
        $regionFlag = '--region ' . $mmxRegion;
        $extraFlags = '--non-interactive --output json ' . $apiKeyFlag . ' ' . $regionFlag;
        if ($prompt) $extraFlags .= ' --prompt ' . escapeshellarg($prompt);
        if ($cmd === 'chat') {
            $system = $_GET['system'] ?? '';
            $message = $_GET['message'] ?? $prompt;
            if (!$message) { echo json_encode(['error' => 'chat 需要 message 或 prompt 参数']); exit; }
            $fullCmd = "{$mmxBin} text chat --message " . escapeshellarg($message) . " --max-tokens 4096 {$extraFlags} 2>&1";
            if ($system) $fullCmd = "{$mmxBin} text chat --message " . escapeshellarg($message) . " --system " . escapeshellarg($system) . " --max-tokens 4096 {$extraFlags} 2>&1";
        } elseif ($cmd === 'image') {
            $aspect = $_GET['aspect_ratio'] ?? '1:1';
            $n = intval($_GET['n'] ?? 1);
            $fullCmd = "{$mmxBin} image generate --aspect-ratio {$aspect} --n {$n} {$extraFlags} 2>&1";
        } elseif ($cmd === 'video') {
            $fullCmd = "{$mmxBin} video generate --no-wait --quiet {$extraFlags} 2>&1";
        } elseif ($cmd === 'speech') {
            $voice = $_GET['voice'] ?? 'female-yujie';
            $text = $_GET['text'] ?? $prompt;
            if (!$text) { echo json_encode(['error' => 'speech 需要 text 或 prompt 参数']); exit; }
            $sharedDir = __DIR__ . '/uploads/shared/';
            if (!is_dir($sharedDir)) mkdir($sharedDir, 0755, true);
            $outPath = $sharedDir . 'speech_' . substr(md5($text . time()), 0, 12) . '.mp3';
            $fullCmd = "{$mmxBin} speech synthesize --text " . escapeshellarg($text) . " --voice " . escapeshellarg($voice) . " --out " . escapeshellarg($outPath) . " {$extraFlags} 2>&1";
        } elseif ($cmd === 'voices') {
            $fullCmd = "{$mmxBin} speech voices {$extraFlags} 2>&1";
        } elseif ($cmd === 'music') {
            $lyrics = $_GET['lyrics'] ?? '';
            $instrumental = $_GET['instrumental'] ?? '';
            $extra = '';
            // ★ 自动歌词优化: 如果没有传歌词,又不是纯音乐模式,则自动生成歌词
            if ($lyrics) {
                $extra .= ' --lyrics ' . escapeshellarg($lyrics);
            } elseif ($instrumental !== 'true') {
                $extra .= ' --lyrics-optimizer';
            }
            if ($instrumental === 'true') $extra .= ' --instrumental';
            $sharedDir = __DIR__ . '/uploads/shared/';
            if (!is_dir($sharedDir)) mkdir($sharedDir, 0755, true);
            $outPath = $sharedDir . 'music_' . substr(md5(time()), 0, 12) . '.mp3';
            $fullCmd = "{$mmxBin} music generate {$extra} --out " . escapeshellarg($outPath) . " {$extraFlags} 2>&1";
        } elseif ($cmd === 'vision') {
            $image = $_GET['image'] ?? '';
            if (!$image) { echo json_encode(['error' => 'vision 需要 image 参数']); exit; }
            $fullCmd = "{$mmxBin} vision describe --image " . escapeshellarg($image) . " {$extraFlags} 2>&1";
        } elseif ($cmd === 'quota') {
            $fullCmd = "{$mmxBin} quota show {$extraFlags} 2>&1";
        } elseif ($cmd === 'search') {
            $q = $_GET['q'] ?? $prompt;
            if (!$q) { echo json_encode(['error' => 'search 需要 q 或 prompt 参数']); exit; }
            $limit = intval($_GET['limit'] ?? 5);
            $fullCmd = "{$mmxBin} search query " . escapeshellarg($q) . " --limit {$limit} {$extraFlags} 2>&1";
        } else {
            echo json_encode(['error' => "未知命令: {$cmd}, 支持: chat/image/video/speech/voices/music/vision/search/quota"]); exit;
        }
        $output = shell_exec($fullCmd);
        if ($output === null || trim($output) === '') {
            echo json_encode(['error' => 'mmx CLI 未响应']);
        } else {
            $parsed = json_decode($output, true);
            // speech/music: 检查文件是否生成成功，优先返回 URL
            if (($cmd === 'speech' || $cmd === 'music') && file_exists($outPath) && filesize($outPath) > 100) {
                $fn = basename($outPath);
                $url = '/oneapichat/uploads/shared/' . rawurlencode($fn);
                $fullUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http') . '://' . 'naujtrats.xyz' . $url;
                echo json_encode(['result' => ['url' => $fullUrl, 'path' => $url, 'size' => filesize($outPath)], 'raw' => $output]);
            } elseif ($parsed !== null) {
                echo json_encode(['result' => $parsed, 'raw' => $output]);
            } else {
                echo json_encode(['result' => $output]);
            }
        }
        break;

    default:
        echo json_encode(['error' => 'unknown action']);

    case 'ps':
        echo @file_get_contents($engine_url . '/engine/ps?' . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'disk':
        echo @file_get_contents($engine_url . '/engine/disk?' . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'docker':
        $docker_action = $_GET['docker_action'] ?? $_GET['cmd'] ?? $_GET['command'] ?? 'ps';
        echo @file_get_contents($engine_url . '/engine/docker?action=' . urlencode($docker_action) . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'db_query':
        $sql = $_GET['sql'] ?? '';
        if (!$sql) { echo json_encode(['error' => '缺少sql']); exit; }
        echo @file_get_contents($engine_url . '/engine/db_query?sql=' . urlencode($sql) . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'network':
        $target = $_GET['target'] ?? $_GET['host'] ?? $_GET['address'] ?? $_GET['url'] ?? '';
        $action_n = $_GET['net_action'] ?? $_GET['cmd'] ?? $_GET['command'] ?? 'ping';
        $timeout_n = intval($_GET['timeout'] ?? 10);
        if (!$target) { echo json_encode(['error' => '缺少target']); exit; }
        echo @file_get_contents($engine_url . '/engine/network?target=' . urlencode($target) . '&action=' . urlencode($action_n) . '&timeout=' . $timeout_n . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'file_search':
        $pattern = $_GET['pattern'] ?? '';
        $path_fs = $_GET['path'] ?? (defined('PROJECT_ROOT') ? PROJECT_ROOT : '/var/www');
        if (!$pattern) { echo json_encode(['error' => '缺少pattern']); exit; }
        echo @file_get_contents($engine_url . '/engine/file_search?pattern=' . urlencode($pattern) . '&path=' . urlencode($path_fs) . '&max_results=' . intval($_GET['max_results'] ?? 30) . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'file_op':
        $action_f = $_GET['file_action'] ?? $_GET['file_op_action'] ?? $_GET['cmd'] ?? $_GET['command'] ?? $_GET['action'] ?? '';
        $src = $_GET['src'] ?? $_GET['source'] ?? $_GET['path'] ?? '';
        $dst = $_GET['dst'] ?? $_GET['dest'] ?? $_GET['destination'] ?? '';
        if (!$action_f || !$src) { echo json_encode(['error' => '缺少参数']); exit; }
        echo @file_get_contents($engine_url . '/engine/file_op?action=' . urlencode($action_f) . '&src=' . urlencode($src) . '&dst=' . urlencode($dst) . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;

    // ==================== Agent 记忆/人格/身份/心跳 系统 ====================
    case 'agent_persona_load':
        echo @file_get_contents($engine_url . '/engine/agent/persona/load?' . $userParam) ?: json_encode(['ok' => false]);
        break;

    case 'agent_persona_save':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo @file_get_contents($engine_url . '/engine/agent/persona/save?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'agent_memory_load':
        $query = isset($_GET['query']) ? '&query=' . urlencode($_GET['query']) : '';
        echo @file_get_contents($engine_url . '/engine/agent/memory/load?' . $userParam . $query) ?: json_encode(['ok' => false]);
        break;

    case 'agent_memory_save':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo @file_get_contents($engine_url . '/engine/agent/memory/save?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'agent_memory_delete':
        $key = $_GET['key'] ?? '';
        if (!$key) { echo json_encode(['error' => '缺少key']); exit; }
        echo @file_get_contents($engine_url . '/engine/agent/memory/delete?key=' . urlencode($key) . $userParam) ?: json_encode(['ok' => false]);
        break;

    case 'agent_identity_load':
        echo @file_get_contents($engine_url . '/engine/agent/identity/load?' . $userParam) ?: json_encode(['ok' => false]);
        break;

    case 'agent_identity_save':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo @file_get_contents($engine_url . '/engine/agent/identity/save?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'agent_heartbeat':
        $json = file_get_contents('php://input');
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $json]];
        $ctx = stream_context_create($opts);
        echo @file_get_contents($engine_url . '/engine/agent/heartbeat?' . $userParam, false, $ctx) ?: json_encode(['ok' => false]);
        break;

    case 'agent_heartbeat_status':
        echo @file_get_contents($engine_url . '/engine/agent/heartbeat/status?' . $userParam) ?: json_encode(['ok' => false]);
        break;

    // ==================== 浏览器工具 ====================
    case 'browser_navigate':
        $rawBody = file_get_contents('php://input');
        $body = $rawBody ? json_decode($rawBody, true) : [];
        $browserUrl = $body['url'] ?? $_GET['url'] ?? '';
        if (!$browserUrl) { echo json_encode(['ok' => false, 'error' => '缺少url']); exit; }
        $postData = json_encode(['url' => $browserUrl]);
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $postData]];
        $ctx = stream_context_create($opts);
        echo @file_get_contents($engine_url . '/engine/browser/navigate', false, $ctx) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'browser_screenshot':
        echo @file_get_contents($engine_url . '/engine/browser/screenshot') ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'browser_click':
        $rawBody = file_get_contents('php://input');
        $body = $rawBody ? json_decode($rawBody, true) : [];
        $browserSel = $body['selector'] ?? $_GET['selector'] ?? '';
        if (!$browserSel) { echo json_encode(['ok' => false, 'error' => '缺少selector']); exit; }
        $postData = json_encode(['selector' => $browserSel]);
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $postData]];
        $ctx = stream_context_create($opts);
        echo @file_get_contents($engine_url . '/engine/browser/click', false, $ctx) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'browser_type':
        $rawBody = file_get_contents('php://input');
        $body = $rawBody ? json_decode($rawBody, true) : [];
        $browserSel = $body['selector'] ?? $_GET['selector'] ?? '';
        $browserText = $body['text'] ?? $_GET['text'] ?? '';
        if (!$browserSel || !$browserText) { echo json_encode(['ok' => false, 'error' => '缺少selector或text']); exit; }
        $postData = json_encode(['selector' => $browserSel, 'text' => $browserText]);
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $postData]];
        $ctx = stream_context_create($opts);
        echo @file_get_contents($engine_url . '/engine/browser/type', false, $ctx) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'browser_get_content':
        echo @file_get_contents($engine_url . '/engine/browser/content') ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'browser_get_snapshot':
        echo @file_get_contents($engine_url . '/engine/browser/snapshot') ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    case 'browser_js':
        $browserCode = file_get_contents('php://input');
        $input = json_decode($browserCode ?: '{}', true);
        $code = $input['code'] ?? ($_GET['code'] ?? '');
        if (!$code) { echo json_encode(['ok' => false, 'error' => '缺少code']); exit; }
        $postData = json_encode(['code' => $code]);
        $opts = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $postData]];
        $ctx = stream_context_create($opts);
        echo @file_get_contents($engine_url . '/engine/browser/js', false, $ctx) ?: json_encode(['ok' => false, 'error' => 'engine unreachable']);
        break;

    // ★ engine_push 文件复制到 uploads
    case 'minimax_search':
        $query = $_GET['q'] ?? '';
        $limit = intval($_GET['limit'] ?? 5);
        if ($limit < 1) $limit = 1;
        if ($limit > 20) $limit = 20;
        if (!$query) { echo json_encode(['error' => '缺少查询词 q']); exit; }
        $escapedQuery = escapeshellarg($query);
        $mmxBin = '/home/naujtrats/.npm-global/bin/mmx';
        // Key 优先级: 请求参数(前端传) > 服务器配置
        $mmxKey = $_GET['api_key'] ?? '';
        $mmxRegion = $_GET['region'] ?? 'cn';
        if (!$mmxKey) {
            $cfg = @json_decode(@file_get_contents(__DIR__ . '/.mmx_config.json'), true);
            if ($cfg && !empty($cfg['api_key'])) { $mmxKey = $cfg['api_key']; $mmxRegion = $cfg['region'] ?? 'cn'; }
        }
        if (!$mmxKey || !preg_match('/^[a-zA-Z0-9_-]+$/', $mmxKey)) { echo json_encode(['error' => 'MiniMax API Key 未配置']); exit; }
        $escapedKey = escapeshellarg($mmxKey);
        $escapedRegion = escapeshellarg($mmxRegion);
        $cmd = "{$mmxBin} search query {$escapedQuery} --limit {$limit} --api-key {$escapedKey} --region {$escapedRegion} 2>&1";
        $output = shell_exec($cmd);
        if ($output === null || trim($output) === '') {
            echo json_encode(['error' => '搜索服务未响应']);
        } else {
            $parsed = json_decode($output, true);
            if ($parsed && isset($parsed['organic']) && is_array($parsed['organic'])) {
                echo json_encode(['results' => $parsed['organic'], 'status' => 'ok']);
            } elseif ($parsed && isset($parsed['base_resp']['status_msg'])) {
                echo json_encode(['error' => $parsed['base_resp']['status_msg']]);
            } else {
                // 原始输出是 JSON 但格式不同,直接返回
                echo $output;
            }
        }
        break;

    case 'push_file':
        $srcPath = $_GET['path'] ?? '';
        if (!$srcPath) { echo json_encode(['ok'=>false,'error'=>'缺少path']); exit; }
        // ★ 路径转换
        if (str_starts_with($srcPath, '/oneapichat/uploads/')) {
            $srcPath = __DIR__ . '/uploads/' . substr($srcPath, strlen('/oneapichat/uploads/'));
        } elseif (str_starts_with($srcPath, '/oneapichat/')) {
            $srcPath = __DIR__ . '/' . substr($srcPath, strlen('/oneapichat/'));
        }
        // ★ /tmp/ 等绝对路径直接复制
        if (!file_exists($srcPath)) { echo json_encode(['ok'=>false,'error'=>'源文件不存在: '.$srcPath]); exit; }
        if (!is_readable($srcPath)) { echo json_encode(['ok'=>false,'error'=>'无法读取源文件']); exit; }
        $ext = strtolower(pathinfo($srcPath, PATHINFO_EXTENSION));
        $fn = 'push_' . substr(md5($srcPath . time()), 0, 8) . '.' . $ext;
        $destDir = __DIR__ . '/uploads/shared/';
        if (!is_dir($destDir)) mkdir($destDir, 0755, true);
        $destPath = $destDir . $fn;
        if (copy($srcPath, $destPath) || rename($srcPath, $destPath)) {
            $url = '/oneapichat/uploads/shared/' . rawurlencode($fn);
            $fullUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http') . '://' . 'naujtrats.xyz' . $url;
            echo json_encode(['ok'=>true,'url'=>$fullUrl,'path'=>$url,'size'=>filesize($destPath)]);
        } else {
            echo json_encode(['ok'=>false,'error'=>'复制失败']);
        }
        break;
}
