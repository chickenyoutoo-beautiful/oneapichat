<?php
/**
 * 默认代理链状态接口。
 * OneAPIChat 默认链路：本机 Mihomo 智能路由（GEMINI / OPENAI / PROXY 分组自动切换）。
 * 已移除失效的 GCP 灾备（原 ECS1 226:8890 链路已下线）。
 */
header('Content-Type: application/json; charset=utf-8');

$isRunning = false;
$currentNode = '';
$nodeDelay = 0;
$nodes = [];
$groups = ['GEMINI'=>null, 'OPENAI'=>null, 'PROXY'=>null];

exec('pgrep -x mihomo 2>/dev/null', $o, $c);
$isRunning = ($c === 0 && !empty($o));
if ($isRunning) {
    exec("ss -tlnp | grep ':9090'", $so, $sc);
    $isRunning = ($sc === 0 && !empty($so));
}

if ($isRunning) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, 'http://127.0.0.1:9090/proxies');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 3);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && $response) {
        $data = json_decode($response, true);
        $proxies = $data['proxies'] ?? [];

        foreach (array_keys($groups) as $g) {
            if (isset($proxies[$g])) {
                $now = $proxies[$g]['now'] ?? '';
                $d = 0;
                if ($now) {
                    if ($g === 'GEMINI') {
                        // GEMINI 当前节点实时测速（select 组无 history）
                        $ch2 = curl_init('http://127.0.0.1:9090/proxies/' . urlencode($now) . '/delay?timeout=3000&url=' . urlencode('http://www.gstatic.com/generate_204'));
                        curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
                        curl_setopt($ch2, CURLOPT_TIMEOUT, 4);
                        curl_setopt($ch2, CURLOPT_CONNECTTIMEOUT, 2);
                        $r2 = curl_exec($ch2);
                        $c2 = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
                        curl_close($ch2);
                        if ($c2 === 200 && $r2) { $dj = json_decode($r2, true); $d = $dj['delay'] ?? 0; }
                    } elseif (isset($proxies[$now]['history'])) {
                        $h = $proxies[$now]['history'];
                        if (!empty($h)) $d = $h[count($h) - 1]['delay'] ?? 0;
                    }
                }
                $groups[$g] = ['now'=>$now, 'delay'=>$d];
            }
        }

        $gemAll = $proxies['GEMINI']['all'] ?? [];
        foreach ($gemAll as $name) {
            $p = $proxies[$name] ?? null;
            if (!$p) continue;
            $h = $p['history'] ?? [];
            $delay = 0; $alive = false;
            if (!empty($h)) {
                $last = $h[count($h) - 1];
                $delay = $last['delay'] ?? 0;
                $alive = ($delay > 0 && $p['alive'] === true);
            } else {
                $alive = ($p['alive'] ?? false) === true;
            }
            $nodes[] = ['name'=>$name, 'delay'=>$delay, 'alive'=>$alive, 'type'=>$p['type'] ?? '?'];
        }
        usort($nodes, function($a, $b) {
            if (!$a['alive']) return 1;
            if (!$b['alive']) return -1;
            return $a['delay'] - $b['delay'];
        });

        $currentNode = $groups['GEMINI']['now'] ?? '';
        $nodeDelay = $groups['GEMINI']['delay'] ?? 0;
    }
}

echo json_encode([
    'ok' => true,
    'route' => 'mihomo-smart',
    'primary_ready' => $isRunning,
    'fallback_ready' => false,
    'gcp_relay_running' => false,
    'gcp_relay_delay' => 0,
    'mihomo_running' => $isRunning,
    'current_node' => $currentNode,
    'node_delay' => $nodeDelay,
    'groups' => $groups,
    'nodes' => array_slice($nodes, 0, 20),
], JSON_UNESCAPED_UNICODE);
