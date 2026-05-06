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

$authToken = isset($_GET['auth_token']) ? preg_replace('/[^a-f0-9]/', '', $_GET['auth_token']) : '';
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
        echo @file_get_contents($engine_url . '/engine/agent/list?' . $userParam) ?: '{}';
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
        echo @file_get_contents($engine_url . '/engine/agent/notifications?' . $userParam) ?: json_encode(['notifications' => [], 'count' => 0]);
        break;

    case 'agent_notifications_mark':
        echo @file_get_contents($engine_url . '/engine/agent/notifications/mark?' . $userParam) ?: json_encode(['ok' => false]);
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

    default:
        echo json_encode(['error' => 'unknown action']);

    case 'ps':
        echo @file_get_contents($engine_url . '/engine/ps' . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'disk':
        echo @file_get_contents($engine_url . '/engine/disk' . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'docker':
        $action = $_GET['action'] ?? 'ps';
        echo @file_get_contents($engine_url . '/engine/docker?action=' . urlencode($action) . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'db_query':
        $sql = $_GET['sql'] ?? '';
        if (!$sql) { echo json_encode(['error' => '缺少sql']); exit; }
        echo @file_get_contents($engine_url . '/engine/db_query?sql=' . urlencode($sql) . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'network':
        $target = $_GET['target'] ?? '';
        $action_n = $_GET['action_n'] ?? 'ping';
        $timeout_n = intval($_GET['timeout'] ?? 10);
        if (!$target) { echo json_encode(['error' => '缺少target']); exit; }
        echo @file_get_contents($engine_url . '/engine/network?target=' . urlencode($target) . '&action=' . urlencode($action_n) . '&timeout=' . $timeout_n . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'file_search':
        $pattern = $_GET['pattern'] ?? '';
        $path_fs = $_GET['path'] ?? '/var/www';
        if (!$pattern) { echo json_encode(['error' => '缺少pattern']); exit; }
        echo @file_get_contents($engine_url . '/engine/file_search?pattern=' . urlencode($pattern) . '&path=' . urlencode($path_fs) . '&max_results=' . intval($_GET['max_results'] ?? 30) . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
    case 'file_op':
        $action_f = $_GET['action'] ?? '';
        $src = $_GET['src'] ?? '';
        $dst = $_GET['dst'] ?? '';
        if (!$action_f || !$src) { echo json_encode(['error' => '缺少参数']); exit; }
        echo @file_get_contents($engine_url . '/engine/file_op?action=' . urlencode($action_f) . '&src=' . urlencode($src) . '&dst=' . urlencode($dst) . $userParam) ?: json_encode(['error' => 'unreachable']);
        break;
}