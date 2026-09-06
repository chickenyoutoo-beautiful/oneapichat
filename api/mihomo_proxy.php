<?php
/**
 * OneAPIChat - Mihomo 节点管理 API（仅 root 可用）
 * 转发 mihomo external-controller (127.0.0.1:9090) + 节点真实探测
 */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = [
    'https://xiaoxin.naujtrats.xyz','https://naujtrats.xyz','https://www.naujtrats.xyz','https://aliyun.naujtrats.xyz',
    'http://39.172.0.99','http://192.168.195.213','http://192.168.1.129',
];
if (!in_array($origin, $allowedOrigins, true) && $origin) {
    $oh = parse_url($origin, PHP_URL_HOST);
    $sh = $_SERVER['HTTP_HOST'] ?? '';
    if ($oh && $oh === $sh) $allowedOrigins[] = $origin;
}
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
} else { header('Access-Control-Allow-Origin: *'); }
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Auth-Token');
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$usersDir = dirname(__DIR__) . '/users/';
$usersFile = $usersDir . 'users.json';
$sessionsFile = $usersDir . 'sessions.json';

function readJson($p){ if(!file_exists($p)) return []; $d=@json_decode(@file_get_contents($p),true); return is_array($d)?$d:[]; }
function jsonError($c,$m){ http_response_code($c); echo json_encode(['error'=>$m]); exit; }
function jsonOk($d=[]){ echo json_encode(array_merge(['success'=>true],$d)); exit; }

function verifyToken($token){
    global $sessionsFile;
    if (empty($token) || strlen($token) < 20) return null;
    $sessions = readJson($sessionsFile);
    $info = $sessions[$token] ?? null;
    return $info['user_id'] ?? null;
}

$token = $_GET['token'] ?? $_POST['token'] ?? '';
$input = json_decode(file_get_contents('php://input'), true);
if ($input && empty($token)) $token = $input['token'] ?? '';

$userId = verifyToken($token);
if (!$userId) jsonError(401, '登录已过期，请重新登录');
$users = readJson($usersFile);
$currentUser = $users[$userId] ?? null;
if (!$currentUser || ($currentUser['role'] ?? 'user') !== 'root') {
    jsonError(403, '权限不足，仅管理员可操作');
}

$action = $_GET['action'] ?? '';
$MI = 'http://127.0.0.1:9090';
$GROUPS = ['GEMINI','OPENAI','PROXY'];

function miReq($url, $method='GET', $body=null){
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $res = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code'=>$code, 'body'=>$res];
}

switch ($action) {
    case 'overview': {
        $out = ['mihomo'=>false, 'version'=>'', 'groups'=>[]];
        $v = miReq($MI . '/version');
        if ($v['code'] === 200 && $v['body']) { $out['mihomo']=true; $out['version']=trim($v['body']); }
        foreach ($GROUPS as $g) {
            $r = miReq($MI . '/proxies/' . urlencode($g));
            if ($r['code'] !== 200) { $out['groups'][$g] = null; continue; }
            $j = json_decode($r['body'], true);
            $out['groups'][$g] = [
                'type'=>$j['type'] ?? '', 'now'=>$j['now'] ?? '',
                'alive'=>isset($j['alive']) ? $j['alive'] : true,
                'count'=>count($j['all'] ?? []),
            ];
        }
        jsonOk($out);
    }
    case 'group': {
        $name = $_GET['name'] ?? '';
        if (!in_array($name, $GROUPS, true)) jsonError(400, '未知分组');
        $r = miReq($MI . '/proxies/' . urlencode($name));
        if ($r['code'] !== 200) jsonError(502, 'mihomo API 不可达');
        $j = json_decode($r['body'], true);
        // 拉取全部节点 history 以附带延迟/存活/类型
        $all = miReq($MI . '/proxies');
        $map = [];
        if ($all['code'] === 200) {
            $ap = json_decode($all['body'], true);
            foreach (($ap['proxies'] ?? []) as $pk => $pv) {
                $last = null;
                if (!empty($pv['history'])) { $h = end($pv['history']); $last = $h['delay'] ?? null; }
                $map[$pk] = ['delay'=>$last, 'alive'=>isset($pv['alive']) ? $pv['alive'] : true, 'type'=>$pv['type'] ?? ''];
            }
        }
        $nodes = [];
        $now = $j['now'] ?? '';
        // 当前节点实时测速（select 组无定时 history，实测才能拿到延迟）
        $nowDelay = null;
        if ($now) {
            $rd = miReq($MI . '/proxies/' . urlencode($now) . '/delay?timeout=5000&url=' . urlencode('http://www.gstatic.com/generate_204'));
            if ($rd['code'] === 200) { $dj = json_decode($rd['body'], true); $nowDelay = $dj['delay'] ?? null; }
        }
        foreach (($j['all'] ?? []) as $n) {
            $m = $map[$n] ?? [];
            $d = $m['delay'] ?? null;
            if ($n === $now && $nowDelay !== null) $d = $nowDelay;
            $nodes[] = ['name'=>$n, 'delay'=>$d, 'alive'=>$m['alive'] ?? true, 'type'=>$m['type'] ?? ''];
        }
        jsonOk(['name'=>$name, 'type'=>$j['type'] ?? '', 'now'=>$now, 'nowDelay'=>$nowDelay, 'nodes'=>$nodes]);
    }
    case 'select': {
        $g = $input['group'] ?? $_POST['group'] ?? '';
        $n = $input['node']  ?? $_POST['node']  ?? '';
        if (!in_array($g, $GROUPS, true) || !$n) jsonError(400, '缺少参数');
        $r = miReq($MI . '/proxies/' . urlencode($g), 'PUT', ['name'=>$n]);
        if ($r['code'] !== 204 && $r['code'] !== 200) jsonError(502, '切换失败: ' . $r['body']);
        jsonOk(['group'=>$g, 'node'=>$n]);
    }
    case 'probe': {
        $n = $_GET['node'] ?? '';
        $g = $_GET['group'] ?? 'GEMINI';
        if (!$n) jsonError(400, '缺少 node');
        $script = ($g === 'OPENAI') ? 'openai-failover.sh' : 'gemini-failover.sh';
        $cmd = 'sudo -n /home/naujtrats/mihomo/' . $script . ' probe ' . escapeshellarg($n) . ' 2>&1';
        $out = trim(shell_exec($cmd));
        if (!$out) jsonError(502, '探测执行失败');
        $parts = preg_split('/\s+/', $out);
        $node = array_shift($parts);
        $cls  = $parts[0] ?? 'UNKNOWN';
        $ms   = $parts[1] ?? '';
        $clsMap = [
            'REGION_OK'      => ['label'=>'可用','ok'=>true,'color'=>'green'],
            'OPENAI_OK'      => ['label'=>'可用','ok'=>true,'color'=>'green'],
            'REGION_BLOCKED' => ['label'=>'地区受限','ok'=>false,'color'=>'red'],
            'UNREACHABLE'    => ['label'=>'不可达','ok'=>false,'color'=>'red'],
        ];
        jsonOk(['node'=>$node, 'class'=>$cls, 'ms'=>floatval($ms), 'detail'=>$clsMap[$cls] ?? ['label'=>$cls,'ok'=>false,'color'=>'orange']]);
    }
    case 'sweep': {
        $g = $_POST['group'] ?? $_GET['group'] ?? 'GEMINI';
        $script = ($g === 'OPENAI') ? 'openai-failover.sh' : 'gemini-failover.sh';
        $log = ($g === 'OPENAI') ? '/home/naujtrats/mihomo/openai-failover.log' : '/home/naujtrats/mihomo/gemini-failover.log';
        shell_exec('nohup sudo -n /home/naujtrats/mihomo/' . $script . ' --sweep >> ' . escapeshellarg($log) . ' 2>&1 &');
        jsonOk(['message'=>($g==='OPENAI'?'OpenAI':'Gemini') . ' 全量扫描已在后台启动（约 2-3 分钟），可稍后刷新日志查看']);
    }
    case 'quick': {
        $g = $_POST['group'] ?? $_GET['group'] ?? 'GEMINI';
        $script = ($g === 'OPENAI') ? 'openai-failover.sh' : 'gemini-failover.sh';
        $log = ($g === 'OPENAI') ? '/home/naujtrats/mihomo/openai-failover.log' : '/home/naujtrats/mihomo/gemini-failover.log';
        shell_exec('nohup sudo -n /home/naujtrats/mihomo/' . $script . ' >> ' . escapeshellarg($log) . ' 2>&1 &');
        jsonOk(['message'=>($g==='OPENAI'?'OpenAI':'Gemini') . ' 快速巡检已在后台启动，几秒后可刷新日志查看']);
    }
    case 'log': {
        $lines = max(1, min(200, intval($_GET['lines'] ?? 60)));
        $g = $_GET['group'] ?? 'GEMINI';
        $log = ($g === 'OPENAI') ? '/home/naujtrats/mihomo/openai-failover.log' : '/home/naujtrats/mihomo/gemini-failover.log';
        $txt = '';
        if (file_exists($log)) $txt = trim(shell_exec('tail -n ' . intval($lines) . ' ' . escapeshellarg($log) . ' 2>/dev/null'));
        jsonOk(['log'=>$txt]);
    }
    default:
        jsonError(400, '未知 action');
}