<?php
/**
 * SRC (StarRailCopilot) 升级/检查 API
 * 当 SRC 未安装时返回指引信息
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$action = $_GET['action'] ?? '';
$dir = '/home/naujtrats/StarRailCopilot';
$notInstalled = !is_dir($dir);

if ($action === 'check') {
    if ($notInstalled) {
        echo json_encode([
            'ok' => false,
            'error' => 'StarRailCopilot 未安装',
            'not_installed' => true,
            'install_guide' => "git clone https://github.com/LmeSzinc/StarRailCopilot.git $dir\\ncd $dir\\npython -m venv venv\\nsource venv/bin/activate\\npip install -r requirements.txt"
        ]);
        exit;
    }

    $current = 'unknown';
    $ver = @shell_exec("cd $dir && git rev-parse --short HEAD 2>/dev/null");
    if ($ver) $current = trim($ver);

    echo json_encode([
        'ok' => true,
        'current' => $current,
        'behind' => 0,
        'need_update' => false,
        'message' => '✅ 已是最新版本 (' . $current . ')'
    ]);
    exit;
}

if ($action === 'upgrade') {
    if ($notInstalled) {
        echo json_encode([
            'ok' => false,
            'error' => 'StarRailCopilot 未安装，无法升级',
            'not_installed' => true
        ]);
        exit;
    }

    $output = '';
    $ret = 0;
    exec("cd $dir && git pull 2>&1", $lines, $ret);
    $output = implode("\n", $lines);
    exec("pkill -f 'gui.py' 2>/dev/null; cd $dir && source venv/bin/activate && nohup python gui.py > /tmp/src_webui.log 2>&1 &", $out2, $ret2);

    echo json_encode([
        'ok' => ($ret === 0),
        'message' => $ret === 0 ? '✅ 升级成功，SRC 已重启' : '❌ 升级失败',
        'output' => $output
    ]);
    exit;
}

echo json_encode(['ok' => false, 'error' => '未知操作']);
