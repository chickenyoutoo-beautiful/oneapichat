<?php
/**
 * 代理配置 - 本地 Mihomo 集成
 * 所有外部请求自动走 Mihomo SOCKS5 代理
 */

// Mihomo 代理地址
define('PROXY_SOCKS5', 'socks5h://127.0.0.1:1081');
define('PROXY_HTTP', 'http://127.0.0.1:1080');

// 是否启用代理 (默认开启)
define('PROXY_ENABLED', true);

// 不走代理的域名 (本地/内网)
define('PROXY_BYPASS', [
    'localhost',
    '127.0.0.1',
    '10.*',
    '172.16.*',
    '172.17.*',
    '172.18.*',
    '172.19.*',
    '192.168.*',
    'naujtrats.xyz',
    'oneapichat',
]);

/**
 * 获取 curl 代理配置
 */
function get_proxy_config($target_url = '') {
    if (!PROXY_ENABLED) {
        return ['proxy' => false];
    }
    
    // 检查是否需要绕过代理
    $host = parse_url($target_url, PHP_URL_HOST) ?: '';
    foreach (PROXY_BYPASS as $pattern) {
        if (fnmatch($pattern, $host) || strpos($host, $pattern) !== false) {
            return ['proxy' => false];
        }
    }
    
    return [
        'proxy' => true,
        'socks5' => PROXY_SOCKS5,
        'http' => PROXY_HTTP,
    ];
}
