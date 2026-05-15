<?php
/**
 * OneAPIChat —— 跨平台全局常量与辅助函数
 * 在所有 PHP 入口文件前引入：require_once __DIR__ . '/init.php';
 */

// ── 项目根目录 ────────────────────────────
define('APP_ROOT', __DIR__);

// ── 系统临时目录 ──────────────────────────
define('APP_TEMP', sys_get_temp_dir());

// ── 刷课模块自动学目录 ─────────────────────
define('CHAOXING_DIR', APP_TEMP . DIRECTORY_SEPARATOR . 'AutomaticCB');

// ── Python 命令检测 ───────────────────────
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

// ── 构建 Python 命令（前台执行）─────────────
function pyCmd($script, $args = '') {
    $scriptPath = APP_ROOT . DIRECTORY_SEPARATOR . $script;
    $cd = strtoupper(substr(PHP_OS, 0, 3)) === 'WIN'
        ? 'cd /d "' . CHAOXING_DIR . '" 2>nul & '
        : 'cd ' . escapeshellarg(CHAOXING_DIR) . ' && ';
    return $cd . pythonBin() . ' ' . escapeshellarg($scriptPath) . ' ' . $args;
}

// ── 构建 Python 命令（后台 daemon）──────────
function pyBgCmd($script, $args, $logPath) {
    $scriptPath = APP_ROOT . DIRECTORY_SEPARATOR . $script;
    if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        return 'start /B "" ' . pythonBin() . ' "' . $scriptPath . '" ' . $args
            . ' > "' . $logPath . '" 2>&1';
    }
    // Ensure space between option flag and its value (argparse compatibility)
    $args = preg_replace('/^(-[a-z])([\'"])/', '$1 $2', $args);
    return 'cd ' . escapeshellarg(CHAOXING_DIR) . ' && '
        . pythonBin() . ' ' . escapeshellarg($scriptPath) . ' ' . $args
        . ' > ' . escapeshellarg($logPath) . ' 2>&1 & echo $!';
}
