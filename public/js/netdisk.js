// netdisk.js — 网盘解析 API 处理器 v1.0
// 支持: 百度网盘、夸克网盘、阿里云盘、天翼云盘、迅雷网盘、移动网盘、UC网盘、123网盘、蓝奏云
// 提供解析+下载能力

// ==================== 网盘解析 API 处理器 ====================
async function netdiskApiHandler(action, args) {
    var token = localStorage.getItem('authToken') || '';
    var authSuffix = token ? '&auth_token=' + encodeURIComponent(token) : '';

    let base = '/oneapichat/api/netdisk_api.php?action=' + action + authSuffix;

    // 拼接额外参数
    if (args) {
        for (var k in args) {
            if (args.hasOwnProperty(k) && args[k] !== undefined && args[k] !== '') {
                var val = typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k];
                base += '&' + k + '=' + encodeURIComponent(val);
            }
        }
    }

    try {
        var r = await fetch(base, { signal: AbortSignal.timeout(60000) });
        var d = await r.json();
        if (d.success) {
            return { result: JSON.stringify(d, null, 2) };
        }
        var _err = d.error || '操作失败';
        return { error: _err };
    } catch(e) {
        return { error: '网盘解析 API 错误: ' + e.message };
    }
}

// ==================== 辅助函数 ====================

/**
 * 识别网盘类型
 */
function identifyNetdiskType(url) {
    var patterns = {
        'baidu': /pan\.baidu\.com/,
        'quark': /pan\.quark\.cn/,
        'aliyun': /(alipan\.com|aliyundrive\.com)/,
        'tianyi': /cloud\.189\.cn/,
        'xunlei': /pan\.xunlei\.com/,
        'mobile': /(yun\.139\.com|caiyun\.139\.com)/,
        'uc': /(drive\.uc\.cn|fast\.uc\.cn)/,
        '123': /123pan\.com/,
        'lanzou': /lanzou[a-z]*\.com|lanzous\.com/,
        'ilanzou': /ilanzou\.com/,
        'feijipan': /feijipan\.com/,
        'guangyapan': /guangyapan\.com/,
    };
    for (var type in patterns) {
        if (patterns[type].test(url)) return type;
    }
    return 'unknown';
}

/**
 * 获取网盘类型中文名
 */
function getNetdiskTypeName(type) {
    var names = {
        'baidu': '百度网盘',
        'quark': '夸克网盘',
        'aliyun': '阿里云盘',
        'tianyi': '天翼云盘',
        'xunlei': '迅雷网盘',
        'mobile': '移动网盘',
        'uc': 'UC网盘',
        '123': '123网盘',
        'lanzou': '蓝奏云',
        'ilanzou': '蓝奏云优享版',
        'feijipan': '小飞机网盘',
        'guangyapan': '光鸭云盘',
    };
    return names[type] || type;
}
