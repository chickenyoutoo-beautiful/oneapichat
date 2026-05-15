<?php
/**
 * OneAPIChat —— 跨平台全局常量与辅助函数
 * 在所有 PHP 入口文件前引入：require_once __DIR__ . '/init.php';
 */

define('APP_ROOT', __DIR__);
define('APP_TEMP', sys_get_temp_dir());
define('CHAOXING_DIR', APP_TEMP . DIRECTORY_SEPARATOR . 'AutomaticCB');

function pythonBin() {
    static $bin = null;
    if ($bin !== null) return $bin;
    $candidates = strtoupper(substr(PHP_OS, 0, 3)) === 'WIN'
        ? ['python', 'python3', 'py']
        : ['python3', 'python'];
    foreach ($candidates as $c) {
        exec("$c --version 2>&1", $out, $rc);
        if ($rc === 0) { $bin = $c; return $bin; }
    }
    $bin = 'python3'; return $bin;
}

// ── 构建 PYTHONPATH（始终包含项目根 + 常见 site-packages 可能路径）──
function pythonPathStr() {
    $paths = [APP_ROOT];
    // 用户 site-packages（从 python 查询）
    $site = trim(shell_exec(pythonBin() . " -m site --user-site 2>/dev/null") ?: '');
    if ($site) $paths[] = $site;
    // 已知可能的 site-packages 位置（按可能性排序，不检查权限）
    $known = [
        '/home/naujtrats/.local/lib/python3.12/site-packages',
        '/usr/local/lib/python3.12/dist-packages',
        '/usr/lib/python3/dist-packages',
        '/usr/lib/python3.12/dist-packages',
    ];
    foreach ($known as $p) {
        if (!in_array($p, $paths)) $paths[] = $p;
    }
    return implode(':', $paths);
}

function pyCmd($script, $args = '') {
    $scriptPath = APP_ROOT . DIRECTORY_SEPARATOR . $script;
    if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        return 'cd /d "' . CHAOXING_DIR . '" 2>nul & '
            . pythonBin() . ' "' . $scriptPath . '" ' . $args;
    }
    return 'cd ' . escapeshellarg(CHAOXING_DIR) . ' && PYTHONPATH='
        . escapeshellarg(pythonPathStr()) . ' '
        . pythonBin() . ' ' . escapeshellarg($scriptPath) . ' ' . $args;
}

function pyBgCmd($script, $args, $logPath) {
    $scriptPath = APP_ROOT . DIRECTORY_SEPARATOR . $script;
    if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        return 'start /B "" ' . pythonBin() . ' "' . $scriptPath . '" ' . $args
            . ' > "' . $logPath . '" 2>&1';
    }
    $args = preg_replace('/^(-[a-z])([\'"])/', '$1 $2', $args);
    return 'cd ' . escapeshellarg(CHAOXING_DIR) . ' && PYTHONPATH='
        . escapeshellarg(pythonPathStr()) . ' '
        . pythonBin() . ' ' . escapeshellarg($scriptPath) . ' ' . $args
        . ' > ' . escapeshellarg($logPath) . ' 2>&1 & echo $!';
}
