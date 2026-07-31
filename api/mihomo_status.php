<?php
/**
 * Mihomo 状态查询接口
 * 返回当前节点、延迟、可用节点列表
 */
header('Content-Type: application/json; charset=utf-8');

// 检查 Mihomo 是否在运行
$isRunning = false;
$currentNode = '';
$nodeDelay = 0;
$nodes = [];

$apiPort = getenv('MIHOMO_API_PORT') ?: '9090';
$apiHost = '127.0.0.1';
$apiBase = "http://{$apiHost}:{$apiPort}";

// 1. 检查进程
exec('pgrep -x mihomo 2>/dev/null', $pgrepOutput, $pgrepCode);
$isRunning = ($pgrepCode === 0 && !empty($pgrepOutput));

// 2. 检查端口
if ($isRunning) {
    exec("ss -tlnp | grep ':{$apiPort}'", $ssOutput, $ssCode);
    $isRunning = ($ssCode === 0 && !empty($ssOutput));
}

// 3. 查询 Mihomo API
if ($isRunning) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $apiBase . '/proxies');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 3);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && $response) {
        $data = json_decode($response, true);
        if ($data && isset($data['proxies'])) {
            $proxies = $data['proxies'];

            // 查找当前选中的节点 (PROXY 组)
            $proxyGroup = $proxies['PROXY'] ?? null;
            if ($proxyGroup) {
                $currentNode = $proxyGroup['now'] ?? '';

                // 获取当前节点的延迟
                if (isset($proxies[$currentNode])) {
                    $nodeData = $proxies[$currentNode];
                    $history = $nodeData['history'] ?? [];
                    if (!empty($history)) {
                        $nodeDelay = $history[count($history) - 1]['delay'] ?? 0;
                    }
                }
            }

            // 收集所有节点状态
            foreach ($proxies as $name => $p) {
                // 跳过非节点条目
                if (in_array($name, ['PROXY', 'DIRECT', 'REJECT', 'REJECT-DROP', 'GLOBAL', 'COMPATIBLE', 'PASS'])) {
                    continue;
                }
                // 跳过没有 history 的节点
                $history = $p['history'] ?? [];
                $delay = 0;
                $alive = false;
                if (!empty($history)) {
                    $last = $history[count($history) - 1];
                    $delay = $last['delay'] ?? 0;
                    // delay=0 表示超时/失败
                    $alive = ($delay > 0 && $p['alive'] === true);
                }
                $nodes[] = [
                    'name' => $name,
                    'delay' => $delay,
                    'alive' => $alive,
                    'type' => $p['type'] ?? '?',
                ];
            }

            // 按延迟排序
            usort($nodes, function($a, $b) {
                if (!$a['alive']) return 1;
                if (!$b['alive']) return -1;
                return $a['delay'] - $b['delay'];
            });
        }
    }
}

echo json_encode([
    'ok' => true,
    'mihomo_running' => $isRunning,
    'current_node' => $currentNode,
    'node_delay' => $nodeDelay,
    'nodes' => array_slice($nodes, 0, 20),  // 最多显示 20 个
], JSON_UNESCAPED_UNICODE);
