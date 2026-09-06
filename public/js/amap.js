// amap.js — 高德地图 API 处理器 v1.0
// 基于 ClawHub @lbs-amap (GaodeMapOfficial) personal-map Skill 自动生成
// 提供 11 个高德地图 Web 服务 API 调用能力

// ==================== 高德地图 API 处理器 ====================
async function amapApiHandler(action, args) {
    args = args || {};
    var amapKey = localStorage.getItem('amapKey') || '';
    var headers = getSessionAuthHeaders();
    if (amapKey) headers['X-Amap-Key'] = amapKey;
    var base = '/oneapichat/api/amap_api.php?action=' + encodeURIComponent(action);

    try {
        var opts = { method: 'POST', headers: headers, signal: AbortSignal.timeout(30000) };
        if (action === 'schema_personal_map') {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify({
                orgName: args.orgName || '',
                lineList: args.lineList || [],
                sceneType: args.sceneType || 1
            });
        } else {
            var form = new URLSearchParams();
            for (var k in args) {
                if (args.hasOwnProperty(k) && args[k] !== undefined && args[k] !== '') {
                    var val = typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k];
                    form.set(k, val);
                }
            }
            opts.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
            opts.body = form.toString();
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
