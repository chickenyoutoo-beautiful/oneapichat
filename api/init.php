<?php
/**
 * OneAPIChat —— 跨平台全局常量与辅助函数
 * 在所有 PHP 入口文件前引入：require_once __DIR__ . '/init.php';
 */

define('APP_ROOT', dirname(__DIR__));
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
    $paths = [APP_ROOT, APP_ROOT . '/python'];
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

// ════════════════════════════════════════════════════
// CORS 白名单 (与 nginx map 保持一致)
// ════════════════════════════════════════════════════
function setCorsHeaders(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = [
        'https://naujtrats.xyz',
        'https://www.naujtrats.xyz',
        'https://localmodels.naujtrats.xyz',
    ];
    // 本地开发环境
    if ($origin && (strpos($origin, '//localhost') !== false || strpos($origin, '//127.0.0.1') !== false)) {
        $allowed[] = $origin;
    }
    if (in_array($origin, $allowed, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
    } else {
        header('Access-Control-Allow-Origin: https://naujtrats.xyz');
    }
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, Auth-Token');
}

// ════════════════════════════════════════════════════
// AES-256-GCM 加密密钥 (从 config.ini 读取，不在源码中硬编码)
// ════════════════════════════════════════════════════
function getEncryptionKey(): string {
    static $key = null;
    if ($key !== null) return $key;
    $configPath = APP_ROOT . '/config.ini';
    if (file_exists($configPath)) {
        $ini = parse_ini_file($configPath, true);
        if (!empty($ini['common']['encryption_key'])) {
            $key = $ini['common']['encryption_key'];
            return $key;
        }
    }
    // 降级: 使用默认密钥 (仅当 config.ini 不存在或未配置时)
    $key = 'naujtrats-secret';
    return $key;
}

// ════════════════════════════════════════════════════
// 登录速率限制 (防暴力破解)
// ════════════════════════════════════════════════════
define('RATE_LIMIT_FILE', APP_ROOT . '/.engine/rate_limits.json');
define('RATE_LIMIT_MAX_IP', 5);       // 每IP 5次/15分钟
define('RATE_LIMIT_MAX_USER', 10);    // 每用户 10次/15分钟
define('RATE_LIMIT_WINDOW', 900);     // 15分钟窗口(秒)

function checkLoginRateLimit(string $identifier, string $type = 'ip'): bool {
    $now = time();
    $window = RATE_LIMIT_WINDOW;
    $max = ($type === 'user') ? RATE_LIMIT_MAX_USER : RATE_LIMIT_MAX_IP;

    // 读取 + 清理过期条目
    $attempts = [];
    $file = RATE_LIMIT_FILE;
    $dir = dirname($file);
    if (!is_dir($dir)) { mkdir($dir, 0755, true); }
    if (file_exists($file)) {
        $attempts = json_decode(file_get_contents($file), true) ?: [];
    }
    // 清理超过窗口的旧记录
    $attempts = array_filter($attempts, function($a) use ($now, $window) {
        return ($a['ts'] ?? 0) > ($now - $window);
    });

    // 统计该标识符的尝试次数
    $count = 0;
    foreach ($attempts as $a) {
        if (($a['id'] ?? '') === $identifier && ($a['type'] ?? '') === $type) {
            $count++;
        }
    }

    if ($count >= $max) {
        // 计算最早过期时间
        $oldest = $now;
        foreach ($attempts as $a) {
            if (($a['id'] ?? '') === $identifier && ($a['type'] ?? '') === $type) {
                $oldest = min($oldest, $a['ts'] ?? $now);
            }
        }
        $retryAfter = ($oldest + $window) - $now;
        return ['allowed' => false, 'retry_after' => max(0, $retryAfter), 'attempts' => $count, 'limit' => $max];
    }

    // 记录本次尝试
    $attempts[] = ['id' => $identifier, 'type' => $type, 'ts' => $now];
    file_put_contents($file, json_encode(array_values($attempts)), LOCK_EX);
    return ['allowed' => true, 'attempts' => $count + 1, 'limit' => $max];
}

/**
 * 共享辅助: 读取 JSON 文件并解析为数组
 * 替代所有 @json_decode(@file_get_contents(...)) 模式
 * @return array|null 成功返回数组,失败返回 null
 */
function json_read_file(string $path): ?array {
    if (!file_exists($path)) return null;
    $raw = file_get_contents($path);
    if ($raw === false) return null;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}
