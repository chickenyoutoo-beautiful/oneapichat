// amap.js — 高德地图 API 处理器 v1.0
// 基于 ClawHub @lbs-amap (GaodeMapOfficial) personal-map Skill 自动生成
// 提供 11 个高德地图 Web 服务 API 调用能力

// ==================== 高德地图 API 处理器 ====================
async function amapApiHandler(action, args) {
    var token = localStorage.getItem('authToken') || '';
    var authSuffix = token ? '&auth_token=' + encodeURIComponent(token) : '';

    // 从 localStorage 读取用户保存的 Amap Key
    var amapKey = localStorage.getItem('amapKey') || '';
    var keySuffix = amapKey ? '&amap_key=' + encodeURIComponent(amapKey) : '';

    let base = '/oneapichat/api/amap_api.php?action=' + action + authSuffix + keySuffix;

    // 拼接额外参数
    if (args) {
        for (var k in args) {
            if (args.hasOwnProperty(k) && args[k] !== undefined && args[k] !== '') {
                // lineList 是数组，需要 JSON 编码
                var val = typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k];
                base += '&' + k + '=' + encodeURIComponent(val);
            }
        }
    }

    try {
        var opts = { signal: AbortSignal.timeout(30000) };
        // schema_personal_map 用 POST
        if (action === 'schema_personal_map') {
            opts.method = 'POST';
            opts.headers = { 'Content-Type': 'application/json' };
            opts.body = JSON.stringify({
                orgName: args.orgName || '',
                lineList: args.lineList || [],
                sceneType: args.sceneType || 1,
            });
        }
        var r = await fetch(base, opts);
        var d = await r.json();
        if (d.success) {
            return { result: JSON.stringify(d, null, 2) };
        }
        var _err = d.error || '操作失败';
        return { error: _err };
    } catch(e) {
        return { error: '高德地图 API 错误: ' + e.message };
    }
}
