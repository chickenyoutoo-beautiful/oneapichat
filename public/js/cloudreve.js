// cloudreve.js — Cloudreve 云盘 API v1.0 (Phase 3 拆分自 main.js)
// cloudreveApiHandler / 文件搜索 / 上传 / 下载

// ==================== Cloudreve 云盘 API 处理器 ====================
function _cloudreveAuthHeaders() {
    var token = typeof getAuthToken === 'function' ? getAuthToken() : (localStorage.getItem('authToken') || '');
    return token ? { Authorization: 'Bearer ' + token } : {};
}

async function cloudreveApiHandler(action, args) {
    let base = '/oneapichat/api/cloudreve_api.php?action=' + action;

    // 拼接额外参数
    if (args) {
        for (var k in args) {
            if (args.hasOwnProperty(k) && args[k] !== undefined && args[k] !== '') {
                base += '&' + k + '=' + encodeURIComponent(args[k]);
            }
        }
    }

    try {
        var r = await fetch(base, { signal: AbortSignal.timeout(60000), headers: _cloudreveAuthHeaders() });
        var d = await r.json();
        if (d.success) {
            return { result: JSON.stringify(d, null, 2) };
        }
        // ★ 增强错误信息，引导 AI 正确修复
        var _err = d.error || d.msg || '操作失败';
        if (_err.includes('无法获取') && _err.includes('token')) {
            _err += '。请先用 cr_login(server_url="https://your-cloudreve-url", email="xxx", password="xxx") 登录。';
        } else if (_err.includes('Incorrect password') || _err.includes('密码')) {
            _err += '。请检查 server_url/email/password 是否正确，确认 Cloudreve 服务可访问后重试。';
        }
        return { error: _err };
    } catch(e) {
        return { error: 'Cloudreve API 错误: ' + e.message };
    }
}

// ==================== 云盘账号同步（切账号时自动调用） ====================
/**
 * ★ 同步当前主项目账号到 Cloudreve 云盘
 * 使用主项目同邮箱同密码登录云盘；云盘账号不存在则自动注册
 * @param {boolean} silent 是否静默（失败不弹 toast）
 */
window.syncCloudreveAccount = async function(silent) {
    var token = localStorage.getItem('authToken') || '';
    if (!token) return;
    try {
        var r = await fetch('/oneapichat/api/cloudreve_api.php?action=auto_login', { cache: 'no-store', headers: _cloudreveAuthHeaders() });
        var d = await r.json();
        if (d.success) {
            if (!silent && typeof showToast === 'function') {
                showToast('☁️ 云盘已同步: ' + (d.data.cloudreve_user.email || d.data.oneapichat_user), 'success', 2500);
            }
            return d.data;
        } else {
            if (!silent && typeof showToast === 'function') showToast('☁️ 云盘同步失败: ' + (d.error || '未知错误'), 'warning', 3000);
        }
    } catch(e) {
        if (!silent && typeof showToast === 'function') showToast('☁️ 云盘同步异常: ' + e.message, 'warning', 3000);
    }
};

/** 在 Cloudreve 新标签页中建立与当前 OneAPIChat 用户匹配的完整会话。 */
window.openCloudreveWeb = async function() {
    var token = localStorage.getItem('authToken') || '';
    if (!token) {
        if (typeof showToast === 'function') showToast('请先登录主项目', 'warning', 2500);
        return;
    }
    var win = window.open('about:blank', 'cloudreve_sso');
    if (win) {
        try { win.opener = null; win.document.write('<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#f5f7fb;color:#64748b;font:14px system-ui">正在安全登录 Cloudreve…</body>'); } catch (_) {}
    }
    try {
        var response = await fetch('/oneapichat/api/cloudreve_sso.php', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            cache: 'no-store'
        });
        var data = await response.json();
        if (!response.ok || !data.success || !data.ticket) throw new Error(data.error || '云盘单点登录失败');
        // Cloudreve 的 Workbox NavigationRoute 会把未知 GET（包括 cr_login.php?t=...）
        // 拦截成 SPA index.html，最终显示“页面不存在”。表单 POST 不匹配其 GET
        // NavigationRoute，能够可靠到达 PHP 消费端。
        var form = document.createElement('form');
        form.method = 'POST';
        form.action = data.action_url || 'https://cloudreve.naujtrats.xyz/api/oneapichat-sso';
        form.target = win ? 'cloudreve_sso' : '_self';
        form.style.display = 'none';
        var input = document.createElement('input');
        input.type = 'hidden'; input.name = 't'; input.value = data.ticket;
        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
        form.remove();
    } catch (e) {
        if (win) win.close();
        if (typeof showToast === 'function') showToast('☁️ ' + e.message, 'warning', 4500);
    }
};

// ==================== Cloudreve 简易面板 ====================
// v2: 修复文件列表解析 bug + 目录导航(点击进入/上级/面包屑) + 云盘主页通道
var _crPanelState = { path: '', webUrl: '' };  // path: 相对 my/ 的原始路径(未编码), 如 '' | '实习资料' | '实习资料/子目录'

window.toggleCloudrevePanel = async function() {
    var existing = document.getElementById('crPanelOverlay');
    if (existing) { existing.remove(); return; }
    _crPanelState.path = '';

    var overlay = document.createElement('div');
    overlay.id = 'crPanelOverlay';
    overlay.className = 'cr-overlay';
    overlay.innerHTML = [
        '<div class="cr-panel">',
        '  <div class="cr-panel-head">',
        '    <span class="cr-panel-title">☁️ Cloudreve 云盘<span class="cr-ok" id="crLoginBadge"></span></span>',
        '    <button class="cr-close" title="关闭">✕</button>',
        '  </div>',
        '  <div class="cr-toolbar" id="crToolbar" style="display:none">',
        '    <span class="cr-crumb" id="crCrumb"></span>',
        '    <button class="cr-btn" id="crBtnUp" title="返回上级目录">⬆️ 上级</button>',
        '    <button class="cr-btn" id="crBtnRefresh" title="刷新当前目录">🔄</button>',
        '    <button class="cr-btn" id="crBtnHome" title="在浏览器中打开云盘主页">🌐 云盘主页</button>',
        '  </div>',
        '  <div class="cr-body" id="crPanelBody">加载中...</div>',
        '  <div class="cr-foot" id="crPanelFoot"></div>',
        '</div>'
    ].join('');
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.cr-close').onclick = function() { overlay.remove(); };
    document.getElementById('crBtnHome').onclick = window.openCloudreveWeb;
    document.getElementById('crBtnUp').onclick = function() {
        var p = _crPanelState.path;
        if (!p) return;
        _crPanelState.path = p.indexOf('/') === -1 ? '' : p.substring(0, p.lastIndexOf('/'));
        loadPanel();
    };
    document.getElementById('crBtnRefresh').onclick = loadPanel;

    // ── 面包屑: 各级目录可点击跳转 ──
    function renderCrumb() {
        var crumb = document.getElementById('crCrumb');
        var parts = _crPanelState.path ? _crPanelState.path.split('/') : [];
        var html = '';
        if (parts.length === 0) {
            html = '<span class="cr-crumb-cur">☁️ 我的云盘</span>';
        } else {
            html = '<button data-cr-go="">☁️ 我的云盘</button>';
            var acc = [];
            for (var i = 0; i < parts.length; i++) {
                acc.push(parts[i]);
                html += '<span class="cr-crumb-sep">/</span>';
                if (i === parts.length - 1) {
                    html += '<span class="cr-crumb-cur">' + escapeHtml(parts[i]) + '</span>';
                } else {
                    html += '<button data-cr-go="' + escapeHtml(acc.join('/')) + '">' + escapeHtml(parts[i]) + '</button>';
                }
            }
        }
        crumb.innerHTML = html;
        var btns = crumb.querySelectorAll('button[data-cr-go]');
        for (var j = 0; j < btns.length; j++) {
            btns[j].onclick = function() {
                _crPanelState.path = this.getAttribute('data-cr-go');
                loadPanel();
            };
        }
    }

    // ── 主加载流程: check_login → 已登录(列文件) / 未登录(登录表单) ──
    async function loadPanel() {
        var body = document.getElementById('crPanelBody');
        var foot = document.getElementById('crPanelFoot');
        var badge = document.getElementById('crLoginBadge');
        body.innerHTML = '<div class="cr-loading">⏳ 加载中...</div>';
        foot.innerHTML = '';
        try {
            var login = await cloudreveApiHandler('check_login', {});
            if (login.error) throw new Error(login.error);
            var obj = JSON.parse(login.result);
            var cr = obj.data || obj;
            if (cr.web_url) _crPanelState.webUrl = cr.web_url;
            if (cr.logged_in) {
                badge.textContent = '· 已登录 ' + (cr.nickname || cr.email || '');
                document.getElementById('crToolbar').style.display = 'flex';
                await renderFileList();
            } else {
                badge.textContent = '';
                document.getElementById('crToolbar').style.display = 'none';
                renderLoginForm(cr);
            }
        } catch(e) {
            body.innerHTML = '<div class="cr-error">❌ ' + escapeHtml(e.message) + '</div>';
        }
    }

    // ── 文件列表渲染 (★ 解析: 真实文件在 d.data.files, 而非 d.files) ──
    async function renderFileList() {
        var body = document.getElementById('crPanelBody');
        var foot = document.getElementById('crPanelFoot');
        body.innerHTML = '<div class="cr-loading">⏳ 加载目录...</div>';
        try {
            var res = await cloudreveApiHandler('list_files', { path: _crPanelState.path });
            if (res.error) throw new Error(res.error);
            var d = JSON.parse(res.result);
            if (!d.success) throw new Error(d.error || '获取文件列表失败');
            var data = d.data || {};
            var items = data.files || [];
            renderCrumb();
            document.getElementById('crBtnUp').disabled = !_crPanelState.path;

            if (items.length === 0) {
                body.innerHTML = '<div class="cr-empty"><span class="cr-empty-icon">📂</span>空目录</div>';
            } else {
                // 文件夹优先, 再按名称排序
                items.sort(function(a, b) {
                    return ((b.is_dir ? 1 : 0) - (a.is_dir ? 1 : 0)) || (a.name || '').localeCompare(b.name || '', 'zh');
                });
                var html = '<ul class="cr-file-list">';
                for (var i = 0; i < items.length; i++) {
                    var f = items[i];
                    var meta = '';
                    if (!f.is_dir) meta = f.size || '';
                    if (f.updated_at) meta += (meta ? ' · ' : '') + String(f.updated_at).slice(0, 10);
                    var fpath = (_crPanelState.path ? _crPanelState.path + '/' : '') + (f.name || '');
                    html += '<li class="cr-file-item' + (f.is_dir ? ' cr-dir' : '') + '" data-goto="' + escapeHtml(fpath) + '" data-dir="' + (f.is_dir ? '1' : '0') + '" title="' + escapeHtml(f.is_dir ? '进入 ' + f.name : f.name) + '">' +
                        '<span class="cr-ficon">' + (f.is_dir ? '📁' : crFileIcon(f.name)) + '</span>' +
                        '<span class="cr-fname">' + escapeHtml(f.name) + '</span>' +
                        (meta ? '<span class="cr-fmeta">' + escapeHtml(meta) + '</span>' : '') +
                        '</li>';
                }
                html += '</ul>';
                body.innerHTML = html;
                var lis = body.querySelectorAll('.cr-file-item');
                for (var k = 0; k < lis.length; k++) {
                    lis[k].onclick = function() {
                        if (this.getAttribute('data-dir') === '1') {
                            _crPanelState.path = this.getAttribute('data-goto');
                            loadPanel();
                        }
                    };
                }
            }
            // 底部信息: 文件数 + 存储策略
            var info = '共 ' + (data.total || items.length) + ' 项';
            if (data.storage_policy) info += ' · ' + data.storage_policy;
            foot.innerHTML = '<span>' + escapeHtml(info) + '</span><span>📤 上传/下载/生成的文件自动同步到 OneAPIChat 文件夹</span>';
        } catch(e) {
            body.innerHTML = '<div class="cr-error">❌ ' + escapeHtml(e.message) + '</div>';
        }
    }

    // ── 未登录: 登录表单 + 主页通道 ──
    function renderLoginForm(cr) {
        var body = document.getElementById('crPanelBody');
        var foot = document.getElementById('crPanelFoot');
        var accounts = cr.accounts || [];
        var html = '<div class="cr-login-form">';
        html += '<p style="color:#dc2626;margin:0 0 12px;">❌ 未登录 Cloudreve 云盘</p>';
        html += '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">' +
            '<button class="cr-btn cr-primary" id="crOpenHome" style="font-size:13px;padding:7px 14px;">🌐 打开云盘主页</button>' +
            '<button class="cr-btn" id="crGoRegister" style="font-size:13px;padding:7px 14px;">没有账号? 去注册</button>' +
            '</div>';
        if (accounts.length > 0) {
            html += '<div style="margin-bottom:12px;font-size:12.5px;color:var(--text-secondary,#6b7280);"><strong>已有账号(点击填入):</strong></div>';
            html += '<div class="cr-acc-chips">';
            accounts.forEach(function(acc) {
                html += '<button class="cr-acc-chip" data-acc="' + escapeHtml(acc) + '">' + escapeHtml(acc) + '</button>';
            });
            html += '</div>';
        }
        html += '<label>邮箱</label>';
        html += '<input id="crLoginEmail" type="email" placeholder="your@email.com">';
        html += '<label>密码</label>';
        html += '<input id="crLoginPwd" type="password" placeholder="密码">';
        html += '<button class="cr-btn cr-primary" id="crLoginBtn" style="width:100%;padding:10px;font-size:14px;justify-content:center;">🔑 登录</button>';
        html += '<p class="cr-login-msg" id="crLoginMsg"></p>';
        html += '</div>';
        body.innerHTML = html;
        foot.innerHTML = '<span>登录后可在此浏览文件, 完整管理请打开云盘主页</span>';

        document.getElementById('crOpenHome').onclick = window.openCloudreveWeb;
        document.getElementById('crGoRegister').onclick = function() { window.open((_crPanelState.webUrl || (window.location.origin + '/cloudreve')) + '/signup', '_blank'); };
        var chips = body.querySelectorAll('.cr-acc-chip');
        for (var i = 0; i < chips.length; i++) {
            chips[i].onclick = function() { document.getElementById('crLoginEmail').value = this.getAttribute('data-acc'); };
        }
        document.getElementById('crLoginBtn').onclick = async function() {
            var email = document.getElementById('crLoginEmail').value.trim();
            var pwd = document.getElementById('crLoginPwd').value;
            var msg = document.getElementById('crLoginMsg');
            if (!email || !pwd) { msg.style.color = '#dc2626'; msg.textContent = '请填写邮箱和密码'; return; }
            msg.style.color = 'var(--text-secondary,#6b7280)'; msg.textContent = '⏳ 登录中...';
            try {
                var r = await cloudreveApiHandler('login', { email: email, password: pwd });
                if (r.error) { msg.style.color = '#dc2626'; msg.textContent = '❌ ' + r.error; return; }
                msg.style.color = '#16a34a'; msg.textContent = '✅ 登录成功!';
                setTimeout(loadPanel, 800);
            } catch(e) {
                msg.style.color = '#dc2626'; msg.textContent = '❌ ' + e.message;
            }
        };
        // 回车提交
        document.getElementById('crLoginPwd').onkeydown = function(e) { if (e.key === 'Enter') document.getElementById('crLoginBtn').click(); };
    }

    loadPanel();
};

// 按扩展名选择文件图标
function crFileIcon(name) {
    var n = String(name || '').toLowerCase();
    var m = n.lastIndexOf('.');
    var ext = m === -1 ? '' : n.substring(m + 1);
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic'].indexOf(ext) >= 0) return '🖼️';
    if (['mp4', 'mkv', 'avi', 'mov', 'flv', 'webm', 'wmv', 'ts', 'rmvb'].indexOf(ext) >= 0) return '🎬';
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].indexOf(ext) >= 0) return '🎵';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].indexOf(ext) >= 0) return '🗜️';
    if (['doc', 'docx', 'md', 'txt', 'rtf'].indexOf(ext) >= 0) return '📝';
    if (['pdf'].indexOf(ext) >= 0) return '📕';
    if (['xls', 'xlsx', 'csv'].indexOf(ext) >= 0) return '📊';
    if (['ppt', 'pptx'].indexOf(ext) >= 0) return '📽️';
    return '📄';
}

// ★ 引擎响应防御解析: 非 JSON (nginx 504 HTML 页/PHP 错误页) 时返回 null
//   由调用方给出可读错误, 避免 "Unexpected token '<'" 这类晦涩报错
async function _parseEngineJson(r) {
    try {
        var _t = await r.text();
        return JSON.parse(_t);
    } catch (_e) {
        return null;
    }
}

async function engineApiHandler(action, args) {
    // Engine API authenticates with the same-site session cookie (and supports bearer
    // credentials); never append the reusable token to an operational URL.
    // ★ 统一补 Bearer Header：部分浏览器/跨子域场景不携带 auth_token Cookie，
    //    否则 server_file_grep/server_exec 会被 engine_api.php 判定为“未登录”。
    var _engineNativeFetch = window.fetch.bind(window);
    var fetch = function(_url, _options) {
        var _opts = Object.assign({}, _options || {});
        var _headers = {};
        if (_opts.headers instanceof Headers) {
            _opts.headers.forEach(function(v, k) { _headers[k] = v; });
        } else if (Array.isArray(_opts.headers)) {
            _opts.headers.forEach(function(h) { _headers[h[0]] = h[1]; });
        } else if (_opts.headers) {
            _headers = Object.assign({}, _opts.headers);
        }
        _opts.headers = Object.assign({}, _cloudreveAuthHeaders(), _headers);
        if (window._fullFileAccessGrantId && window._fullFileAccessChatId) {
            _opts.headers['X-OneAPIChat-Grant'] = window._fullFileAccessGrantId;
            _opts.headers['X-OneAPIChat-Chat'] = window._fullFileAccessChatId;
        }
        return _engineNativeFetch(_url, _opts);
    };
    var token = typeof getAuthToken === 'function' ? getAuthToken() : (localStorage.getItem('authToken') || '');
    var authSuffix = '';

    try {
        if (action === 'cron_list') {
            var r = await fetch(_apiBase + '?action=cron_list' + authSuffix);
            var d = await r.json();
            var names = Object.keys(d);
            if (names.length === 0) return { result: '暂无后台任务' };
            var msg = '📋 后台任务列表:\n';
            names.forEach(function(n) {
                var j = d[n];
                msg += '- ' + n + ' (每' + j.interval + '秒, ' + (j.enabled ? '运行中' : '已停止') + ')';
                if (j.last_run) msg += ' 上次: ' + (j.last_run.time || '') + ' 状态: ' + (j.last_run.exit_code === 0 ? '✅' : '❌');
                msg += '\n';
            });
            return { result: msg };
        }
        if (action === 'cron_create') {
            var url = '/oneapichat/api/engine_api.php?action=cron_create&name=' + encodeURIComponent(args.name);
            url += '&interval=' + encodeURIComponent(args.interval);
            var _cmd = args.action_cmd || args.action || args.command || args.cmd || '';
            url += '&action_cmd=' + encodeURIComponent(_cmd);
            url += authSuffix;
            var r = await fetch(url);
            var d = await r.json();
            if (d.ok) return { result: '✅ Cron任务已创建: ' + args.name + ' (每' + args.interval + '秒)' };
            return { error: d.error || '创建失败' };
        }
        if (action === 'cron_delete') {
            var r = await fetch(_apiBase + '?action=cron_delete&name=' + encodeURIComponent(args.name) + authSuffix);
            var d = await r.json();
            if (d.ok) return { result: '已删除任务: ' + args.name };
            return { error: d.error || '删除失败' };
        }
        if (action === 'agent_create') {
            var currentProvider = args.provider || (typeof getVal === 'function' ? getVal('baseUrlProvider') : null) || localStorage.getItem('baseUrlProvider') || '';
            var currentUrl = args.base_url || (typeof getVal === 'function' ? getVal('baseUrl') : null) || localStorage.getItem('baseUrl') || 'https://api.deepseek.com/v1';
            var currentModel = args.model || (typeof getVal === 'function' ? getVal('modelSelect') : null) || localStorage.getItem('model_' + currentProvider) || localStorage.getItem('model') || 'deepseek-chat';
            var agentRole = args.role || 'general';
            var _agentHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
            if (token) _agentHeaders.Authorization = 'Bearer ' + token;
            try {
                var r = await fetch('/oneapichat/api/engine_api.php?action=agent_create', {
                    method: 'POST', headers: _agentHeaders,
                    body: JSON.stringify({
                        name: args.name, prompt: args.prompt || args.task || '', role: agentRole,
                        model: currentModel, base_url: currentUrl, provider: currentProvider,
                        proxy_url: args.proxy_url || '', proxy_enabled: args.proxy_enabled || ''
                    })
                });
                var d = await _parseEngineJson(r);
                if (d && d.ok) {
                    // 若调用方未显式禁用 auto_run，则自动启动
                    if (args.auto_run !== false) {
                        fetch(_apiBase + '?action=agent_run', {
                            method: 'POST', headers: _agentHeaders, body: JSON.stringify({ name: args.name })
                        }).catch(function(){});
                    }
                    return { ok: true, result: '✅ 子代理 ' + args.name + ' 已创建并启动(角色:' + agentRole + ')' };
                }
                return { error: d && d.error || '创建失败' };
            } catch(e) {
                return { error: '引擎服务异常: ' + e.message };
            }
        }
        if (action === 'agent_run') {
            var _arHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
            if (token) _arHeaders.Authorization = 'Bearer ' + token;
            var _arRes = await fetch(_apiBase + '?action=agent_run', {
                method: 'POST', headers: _arHeaders,
                body: JSON.stringify({ name: args.name, message: args.message || '', from_ask: !!args.from_ask })
            });
            var _arData = await _parseEngineJson(_arRes);
            if (_arData && _arData.ok) return { result: '✅ 子代理 ' + args.name + ' 已启动' };
            return { error: _arData && _arData.error || '启动失败' };
        }
        if (action === 'agent_status') {
            var r = await fetch(_apiBase + '?action=agent_status&name=' + encodeURIComponent(args.name) + authSuffix);
            var d = await r.json();
            if (d.name) {
                var msg = '🤖 子代理: ' + d.name + '\n状态: ' + d.status + '\n模型: ' + d.model;
                if (d.result) msg += '\n结果: ' + d.result;
                if (d.error) msg += '\n错误: ' + d.error;
                window.showAgentNotification(d.error ? 'error' : 'success', '🤖 ' + d.name + ': ' + d.status);
                return { result: msg };
            }
            return { error: '未找到子代理' };
        }
        if (action === 'agent_list') {
            var r = await fetch(_apiBase + '?action=agent_list' + authSuffix);
            var d = await r.json();
            var names = Object.keys(d);
            if (names.length === 0) return { result: '暂无子代理' };
            var msg = '🤖 子代理列表:\n';
            names.forEach(function(n) {
                msg += '- ' + n + ' (' + d[n].status + ')';
                if (d[n].result) msg += ' 结果: ' + d[n].result.slice(0, 100);
                msg += '\n';
            });
            return { result: msg };
        }
        if (action === 'agent_ask') {
            var name = args.name;
            var message = args.message;
            if (!name || !message) return { error: '请提供子代理名称和消息' };
            // 先查子代理是否存在
            var sr = await fetch(_apiBase + '?action=agent_status&name=' + encodeURIComponent(name) + authSuffix);
            var sd = await sr.json();
            if (!sd.name) return { error: '子代理 ' + name + ' 不存在' };
            // 运行子代理(直接触发一次)
            await fetch(_apiBase + '?action=agent_run&name=' + encodeURIComponent(name) + '&message=' + encodeURIComponent(message) + '&from_ask=1' + authSuffix);
            // 等待完成
            var waitStart = Date.now();
            var resultMsg = '';
            while (Date.now() - waitStart < 120000) {
                await new Promise(r2 => setTimeout(r2, 2000));
                sr = await fetch(_apiBase + '?action=agent_status&name=' + encodeURIComponent(name) + authSuffix);
                sd = await sr.json();
                if (sd.status === 'completed' || sd.status === 'error' || sd.status === 'failed') {
                    if (sd.result) resultMsg = sd.result.slice(0, 1000);
                    if (sd.error) resultMsg = resultMsg ? resultMsg + '\n❌ ' + sd.error : '❌ ' + sd.error;
                    break;
                }
            }
            if (resultMsg) {
                return { result: '\u{1F916} ' + name + ' 回复: ' + resultMsg };
            } else {
                return { result: name + ' 仍在运行中(已超时120秒), 请稍后查询' };
            }
        }
        if (action === 'agent_delete') {
            var r = await fetch(_apiBase + '?action=agent_delete&name=' + encodeURIComponent(args.name) + authSuffix);
            var d = await r.json();
            if (d.ok) return { result: '✅ 子代理已删除: ' + args.name };
            return { error: d.error || '删除失败' };
        }
        if (action === 'cron_delete') {
            var r = await fetch(_apiBase + '?action=cron_delete&name=' + encodeURIComponent(args.name) + authSuffix);
            var d = await r.json();
            if (d.ok) return { result: '✅ Cron任务已删除: ' + args.name };
            return { error: d.error || '删除失败' };
        }
        if (action === 'sys_info') {
            var r = await fetch(_apiBase + '?action=sys_info' + authSuffix);
            var d = await r.json();
            if (d.ok) {
                var info = '🖥️ 系统信息:\n' +
                    '主机: ' + d.hostname + '\n' +
                    '系统: ' + d.os + '\n' +
                    'Python: ' + d.python + '\n' +
                    '负载: ' + (d.cpu_uptime || d.cpu || 'N/A') + '\n' +
                    '内存: ' + (d.memory || 'N/A') + '\n' +
                    '磁盘: ' + (d.disk || 'N/A') + '\n' +
                    '进程数: ' + d.processes + '\n' +
                    '时间: ' + d.time;
                return { result: info };
            }
            return { error: d.error || '获取系统信息失败' };
        }
        if (action === 'exec') {
            var _execCmd = args.cmd || args.command || args.query || '';
            // ★ 复杂命令(含引号/特殊字符)改用 POST JSON body, 避免 URL 转义/长度截断
            var _execUrl = _apiBase + '?action=exec&timeout=' + (args.timeout || 60) + '&cwd=' + encodeURIComponent(args.cwd || '') + authSuffix;
            var r = await fetch(_execUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
                body: JSON.stringify({ cmd: _execCmd })
            });
            // ★ 网关超时/非JSON响应 (如 nginx 504 HTML 页) 给出可读错误, 避免 "Unexpected token '<'"
            var d = await _parseEngineJson(r);  // ★ 必须 await (漏了会拿到 Promise, ok/error 永远 undefined → 永远报"命令执行失败")
            if (d === null) {
                return { error: '引擎网关错误 (HTTP ' + r.status + (r.status === 504 ? ', 网关超时 — 命令可能仍在后台执行, 请稍后查询文件/进程状态' : '') + ')' };
            }
            if (d.ok) {
                var out = '💻 命令: ' + _execCmd + '\n退出码: ' + d.exit_code + '\n';
                if (d.stdout) out += '输出:\n' + d.stdout + '\n';
                if (d.stderr) out += '错误:\n' + d.stderr + '\n';
                if (d.error) out += '异常: ' + d.error;
                return { result: out };
            }
            return { error: d.error || '命令执行失败' };
        }
        if (action === 'run_code') {
            var _rcResp = await fetch(_apiBase + '?action=run_code' + authSuffix, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args || {})});
            var _rcData = await _parseEngineJson(_rcResp);
            if (!_rcData) return {error:'run_code 网关返回非 JSON'};
            if (_rcData.ok) return {result:_rcData.result,tool_calls:_rcData.tool_calls || [],logs:_rcData.logs || [],todos:_rcData.todos || []};
            return {error:_rcData.error || 'run_code 失败',code:_rcData.code || '',capability:_rcData.capability || '',retryable:!!_rcData.retryable,tool_calls:_rcData.tool_calls || []};
        }
        if (action === 'python') {
            var r = await fetch(_apiBase + '?action=python&timeout=' + (args.timeout || 30) + authSuffix + '&t=' + Date.now(), {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' },
                body: args.script || ''
            });
            var d = await _parseEngineJson(r);  // ★ 必须 await (漏了会拿到 Promise, ok/error 永远 undefined → 永远报"脚本执行失败")
            if (d === null) {
                return { error: '引擎网关错误 (HTTP ' + r.status + (r.status === 504 ? ', 网关超时 — 脚本可能仍在执行' : '') + ')' };
            }
            if (d.ok) {
                var out = '🐍 Python 脚本执行结果:\n退出码: ' + d.exit_code + '\n';
                if (d.stdout) out += '输出:\n' + d.stdout + '\n';
                if (d.stderr) out += '错误:\n' + d.stderr + '\n';
                return { result: out };
            }
            return { error: d.error || 'Python 脚本执行失败' };
        }
        if (action === 'self_context') {
            var _selfUrl = '/engine/self/context?query=' + encodeURIComponent(args.query || '') + '&budget=' + encodeURIComponent(args.budget || 14000);
            var _selfResp = await fetch(_selfUrl);
            var _selfData = await _selfResp.json();
            if (_selfData && _selfData.ok) return { result: _selfData.context && _selfData.context.text || JSON.stringify(_selfData.context) };
            return { error: (_selfData && _selfData.error) || '项目自描述暂时不可用' };
        }
        if (action === 'file_read') {
            let _frUrl = _apiBase + '?action=file_read&path=' + encodeURIComponent(args.path) + '&max_lines=' + (args.max_lines || 200);
            if (args.start_line) _frUrl += '&start_line=' + args.start_line;
            if (args.end_line) _frUrl += '&end_line=' + args.end_line;
            if ((typeof window.hasFullFileAccess === 'function' && window.hasFullFileAccess()) || args.full_access) _frUrl += '&full_access=true';
            // ★ 字符偏移分页: 压缩 JSON 等单行巨长文件按行读不到内容, 用 offset/max_chars 分页
            if (args.offset !== undefined && args.offset !== null && args.offset !== '') _frUrl += '&offset=' + args.offset;
            if (args.max_chars) _frUrl += '&max_chars=' + args.max_chars;
            _frUrl += authSuffix;
            var r = await fetch(_frUrl);
            var d = await r.json();
            if (d.ok) {
                var _range = d.shown_range
                    ? (d.mode === 'chars' ? ' [' + d.shown_range + ']' : ' [' + d.shown_range + '/' + d.total_lines + '行]')
                    : '';
                var out = '📄 ' + args.path + _range + ' (' + (d.size || 0) + ' bytes)\n' + d.content;
                return { result: out };
            }
            return { error: d.error || '读取失败', code: d.code || '', capability: d.capability || '', retryable: !!d.retryable, path: d.path || args.path || '' };
        }
        if (action === 'parse_document') {
            let _pdUrl = _apiBase + '?action=parse_document&path=' + encodeURIComponent(args.path);
            if (args.max_chars) _pdUrl += '&max_chars=' + encodeURIComponent(args.max_chars);
            _pdUrl += authSuffix;
            var _pdr = await fetch(_pdUrl);
            var _pdd = await _pdr.json();
            if (_pdd.ok) {
                var _truncMark = _pdd.truncated ? '\n\n[内容已截断，仅显示前 ' + (args.max_chars || 50000) + ' 字符]' : '';
                var _pdOut = '📄 文档解析: ' + (_pdd.filename || args.path) + ' (格式: ' + (_pdd.format || '?') + ', 大小: ' + (_pdd.file_size || 0) + ' bytes)\n\n' + _pdd.content + _truncMark;
                return { result: _pdOut };
            }
            return { error: _pdd.error || '解析失败', code: _pdd.code || '', capability: _pdd.capability || '', retryable: !!_pdd.retryable, path: _pdd.path || args.path || '' };
        }
        // ═══════════════════════════════════════════════════
        // ★ 股票数据工具 (A股 — 东方财富数据源)
        // ═══════════════════════════════════════════════════
        if (action === 'stock_realtime') {
            let _u = _apiBase + '?action=stock_realtime&symbol=' + encodeURIComponent(args.symbol) + authSuffix;
            let _r = await fetch(_u);
            let _d = await _r.json();
            if (_d.ok) {
                let _arrow = _d.change_pct >= 0 ? '🔴📈' : '🟢📉';
                let _volume = Number(_d.volume) || 0;
                let _amount = Number(_d.amount) || 0;
                let _turnover = Number(_d.turnover) || 0;
                let _marketCap = Number(_d.market_cap) || 0;
                let _out = '📈 **' + _d.name + ' (' + _d.symbol + ')** 实时行情\n\n' +
                    _arrow + ' 最新价: **' + _d.price + '**  涨跌幅: **' + (_d.change_pct >= 0 ? '+' : '') + _d.change_pct + '%**  涨跌额: ' + (_d.change_amt >= 0 ? '+' : '') + _d.change_amt + '\n' +
                    '📊 今开: ' + _d.open + '  最高: ' + _d.high + '  最低: ' + _d.low + '  昨收: ' + _d.prev_close + '\n' +
                    '💰 成交量: ' + (_volume / 10000).toFixed(2) + '万  成交额: ' + (_amount / 100000000).toFixed(2) + '亿  换手率: ' + _turnover + '%\n';
                if (_d.pe) _out += '📐 市盈率(动): ' + _d.pe + (_marketCap ? '  总市值: ' + (_marketCap / 100000000).toFixed(0) + '亿' : '');
                return { result: _out };
            }
            return { error: _d.error || '获取行情失败' };
        }
        if (action === 'stock_kline') {
            let _u = _apiBase + '?action=stock_kline&symbol=' + encodeURIComponent(args.symbol);
            if (args.period) _u += '&period=' + encodeURIComponent(args.period);
            if (args.start) _u += '&start=' + encodeURIComponent(args.start);
            if (args.end) _u += '&end=' + encodeURIComponent(args.end);
            if (args.adjust) _u += '&adjust=' + encodeURIComponent(args.adjust);
            if (args.count) _u += '&count=' + encodeURIComponent(args.count);
            _u += authSuffix;
            let _r = await fetch(_u);
            let _d = await _r.json();
            if (_d.ok && _d.data) {
                let _out = '📊 **' + _d.name + ' (' + _d.symbol + ')** ' + _d.period + ' K线 (共' + _d.count + '条)\n\n';
                _out += '| 日期 | 开盘 | 收盘 | 最高 | 最低 | 涨跌幅 | 成交量 |\n';
                _out += '|------|------|------|------|------|--------|--------|\n';
                _d.data.slice(-15).forEach(function(row) {
                    _out += '| ' + row.date + ' | ' + row.open + ' | ' + row.close + ' | ' + row.high + ' | ' + row.low + ' | ' + (row.change_pct >= 0 ? '+' : '') + row.change_pct + '% | ' + (row.volume / 10000).toFixed(1) + '万 |\n';
                });
                return { result: _out };
            }
            return { error: _d.error || '获取K线失败' };
        }
        if (action === 'stock_sector_flow') {
            let _u = _apiBase + '?action=stock_sector_flow';
            if (args.sector_type) _u += '&sector_type=' + encodeURIComponent(args.sector_type);
            _u += authSuffix;
            let _r = await fetch(_u);
            let _d = await _r.json();
            if (_d.ok && _d.data) {
                let _out = '💰 **' + _d.type + '板块资金流向** (主力净流入TOP15)\n\n';
                _out += '| 板块 | 涨跌幅 | 主力净流入 | 超大单 | 大单 |\n';
                _out += '|------|--------|------------|--------|------|\n';
                _d.data.slice(0, 15).forEach(function(s) {
                    let _flow = (s.main_inflow / 100000000).toFixed(2);
                    _out += '| ' + s.name + ' | ' + (s.change_pct >= 0 ? '+' : '') + s.change_pct + '% | ' + (_flow >= 0 ? '+' : '') + _flow + '亿 | ' + (s.super_large_inflow / 100000000).toFixed(2) + '亿 | ' + (s.large_inflow / 100000000).toFixed(2) + '亿 |\n';
                });
                return { result: _out };
            }
            return { error: _d.error || '获取板块资金流失败' };
        }
        if (action === 'stock_dragon_tiger') {
            let _u = _apiBase + '?action=stock_dragon_tiger';
            if (args.date) _u += '&date=' + encodeURIComponent(args.date);
            _u += authSuffix;
            let _r = await fetch(_u);
            let _d = await _r.json();
            if (_d.ok && _d.data) {
                let _out = '🐉 **龙虎榜** (' + _d.date + ', 共' + _d.count + '只)\n\n';
                _out += '| 股票 | 收盘价 | 涨跌幅 | 净买入额 | 买入额 | 卖出额 |\n';
                _out += '|------|--------|--------|----------|--------|--------|\n';
                _d.data.slice(0, 20).forEach(function(item) {
                    _out += '| ' + item.name + '(' + item.code + ') | ' + item.close + ' | ' + (item.change_pct >= 0 ? '+' : '') + item.change_pct + '% | ' + (item.net_amount / 10000).toFixed(0) + '万 | ' + (item.buy_amount / 10000).toFixed(0) + '万 | ' + (item.sell_amount / 10000).toFixed(0) + '万 |\n';
                });
                return { result: _out };
            }
            return { error: _d.error || '获取龙虎榜失败' };
        }
        if (action === 'stock_north_flow') {
            let _u = _apiBase + '?action=stock_north_flow' + authSuffix;
            let _r = await fetch(_u);
            let _d = await _r.json();
            if (_d.ok) {
                // 兼容当前引擎扁平字段与旧版嵌套字段，避免接口成功时读取 undefined.net_inflow。
                let _sh = Number(_d.sh_net_inflow != null ? _d.sh_net_inflow : (_d.sh_connect && _d.sh_connect.net_inflow)) || 0;
                let _sz = Number(_d.sz_net_inflow != null ? _d.sz_net_inflow : (_d.sz_connect && _d.sz_connect.net_inflow)) || 0;
                let _totalRaw = Number(_d.total_net_inflow != null ? _d.total_net_inflow : (_sh + _sz)) || 0;
                let _total = _totalRaw / 100000000;
                let _out = '🌊 **北向资金实时流向**\n\n' +
                    '📥 沪股通净流入: **' + (_sh / 100000000).toFixed(2) + '亿**\n' +
                    '📥 深股通净流入: **' + (_sz / 100000000).toFixed(2) + '亿**\n' +
                    '💰 合计净流入: **' + (_total >= 0 ? '+' : '') + _total.toFixed(2) + '亿**';
                return { result: _out };
            }
            return { error: _d.error || '获取北向资金失败' };
        }
        if (action === 'stock_diagnosis') {
            let _u = _apiBase + '?action=stock_diagnosis&symbol=' + encodeURIComponent(args.symbol) + authSuffix;
            let _r = await fetch(_u);
            let _d = await _r.json();
            if (_d.ok) {
                let _arrow = _d.change_pct >= 0 ? '🔴📈' : '🟢📉';
                let _out = '🏥 **' + _d.name + ' (' + _d.symbol + ')** 综合诊断\n\n' +
                    _arrow + ' 最新价: **' + _d.price + '**  涨跌幅: **' + (_d.change_pct >= 0 ? '+' : '') + _d.change_pct + '%**\n' +
                    '📐 市盈率(动): ' + (_d.pe || '-') + '  市净率: ' + (_d.pb || '-') + '\n' +
                    '🔄 换手率: ' + _d.turnover + '%  总市值: ' + (_d.market_cap ? (_d.market_cap / 100000000).toFixed(0) + '亿' : '-');
                return { result: _out };
            }
            return { error: _d.error || '获取诊断失败' };
        }
        if (action === 'stock_indicators') {
            let _u = _apiBase + '?action=stock_indicators&symbol=' + encodeURIComponent(args.symbol);
            if (args.count) _u += '&count=' + encodeURIComponent(args.count);
            _u += authSuffix;
            let _r = await fetch(_u);
            let _d = await _r.json();
            if (_d.ok && _d.data) {
                let _out = '📐 **' + _d.name + ' (' + _d.symbol + ')** 技术指标\n\n';
                _d.data.forEach(function(row) {
                    _out += '**' + row.date + '**\n';
                    if (row.MA5) _out += '  MA5=' + row.MA5 + ' MA10=' + row.MA10 + ' MA20=' + row.MA20;
                    if (row.DIF) _out += '\n  DIF=' + row.DIF + ' DEA=' + row.DEA + ' MACD=' + row.MACD;
                    if (row.K) _out += '\n  K=' + row.K + ' D=' + row.D + ' J=' + row.J;
                    if (row.RSI6) _out += '\n  RSI6=' + row.RSI6 + ' RSI12=' + row.RSI12 + ' RSI24=' + row.RSI24;
                    if (row.BOLL_MID) _out += '\n  布林上轨=' + row.BOLL_UP + ' 中轨=' + row.BOLL_MID + ' 下轨=' + row.BOLL_DN;
                    _out += '\n\n';
                });
                return { result: _out };
            }
            return { error: _d.error || '计算指标失败' };
        }
        if (action === 'stock_chart') {
            let _u = _apiBase + '?action=stock_chart&symbol=' + encodeURIComponent(args.symbol);
            if (args.period) _u += '&period=' + encodeURIComponent(args.period);
            if (args.count) _u += '&count=' + encodeURIComponent(args.count);
            if (args.adjust) _u += '&adjust=' + encodeURIComponent(args.adjust);
            if (args.indicators) _u += '&indicators=' + encodeURIComponent(args.indicators);
            _u += authSuffix;
            let _r = await fetch(_u);
            let _d = await _r.json();
            if (_d.ok && _d.chart_url) {
                let _out = '📈 **' + _d.name + ' (' + _d.symbol + ')** K线分析图 (' + _d.period + ', ' + _d.data_points + '条)\n\n' +
                    '![K线图](' + _d.chart_url + ')';
                return { result: _out };
            }
            return { error: _d.error || '生成图表失败' };
        }
        if (action === 'stock_market_overview') {
            let _u = _apiBase + '?action=stock_market_overview' + authSuffix;
            let _r = await fetch(_u);
            let _d = await _r.json();
            // ★ 引擎实际返回 { ok, beijing_time, us_eastern_time, us/cn/hk_market_status,
            //   us_indices[], cn_indices[], hk_indices[], global_indices[] } —— 没有顶层 data 字段
            if (_d.ok) {
                let _out = '🏛️ **全球市场全景**\n';
                if (_d.beijing_time) _out += '🕐 北京时间: ' + _d.beijing_time + '\n';
                if (_d.us_eastern_time) _out += '🇺🇸 美东时间: ' + _d.us_eastern_time + '\n';
                if (_d.us_market_status) _out += '🇺🇸 美股: ' + _d.us_market_status + '\n';
                if (_d.cn_market_status) _out += '🇨🇳 A股: ' + _d.cn_market_status + '\n';
                if (_d.hk_market_status) _out += '🇭🇰 港股: ' + _d.hk_market_status + '\n';
                var _renderIdx = function(title, list) {
                    if (!list || !list.length) return '';
                    var s = '\n**' + title + '**\n';
                    list.forEach(function(idx) {
                        var _pct = Number(idx.change_pct) || 0;
                        var _arrow = _pct >= 0 ? '🔴📈' : '🟢📉';
                        s += _arrow + ' ' + (idx.name || idx.symbol || idx.code || '') + ': ' + (idx.price || '-')
                           + ' (' + (_pct >= 0 ? '+' : '') + _pct + '%)\n';
                    });
                    return s;
                };
                _out += _renderIdx('📈 美股核心指数', _d.us_indices);
                _out += _renderIdx('🏛️ A股主要指数', _d.cn_indices);
                _out += _renderIdx('🇭🇰 港股指数', _d.hk_indices);
                _out += _renderIdx('🌍 全球外盘', _d.global_indices);
                return { result: _out.trim() };
            }
            return { error: _d.error || '获取市场概览失败' };
        }
        if (action === 'file_grep') {
            let _fgUrl = _apiBase + '?action=file_grep&pattern=' + encodeURIComponent(args.pattern) + '&path=' + encodeURIComponent(args.path || '/var/www/html/oneapichat');
            if (args.context_lines) _fgUrl += '&context_lines=' + args.context_lines;
            if (args.file_pattern) _fgUrl += '&file_pattern=' + encodeURIComponent(args.file_pattern);
            if (args.max_results) _fgUrl += '&max_results=' + args.max_results;
            if (args.ignore_case === false) _fgUrl += '&ignore_case=false';
            if ((typeof window.hasFullFileAccess === 'function' && window.hasFullFileAccess()) || args.full_access) _fgUrl += '&full_access=true';
            _fgUrl += authSuffix;
            var _fgr = await fetch(_fgUrl);
            var _fgd = await _fgr.json();
            if (_fgd.ok && _fgd.results) {
                let _fgOut = '🔍 搜索 "' + args.pattern + '" (' + _fgd.total_matches + ' 处匹配):\n\n';
                _fgd.results.forEach(function(_fr) {
                    _fgOut += '─── ' + _fr.file + ' ───\n';
                    _fr.matches.forEach(function(_m) { _fgOut += _m + '\n\n'; });
                });
                // ★ 保底截断: 即使引擎已限制, 客户端再兜一层, 防止超长结果撑爆上下文
                var _fgTotalChars = _fgd.total_chars || _fgOut.length;
                if (_fgd.truncated) {
                    _fgOut += '...(结果过多已截断: ' + (_fgd.note || '请缩小搜索范围或减少 max_results') + ')\n';
                }
                if (_fgOut.length > 100000) {
                    _fgOut = _fgOut.substring(0, 100000) + '\n\n...(结果过长已截断: 原始约 ' + _fgTotalChars + ' 字符 → 仅保留前 100000 字符)';
                }
                return { result: _fgOut };
            }
            return { error: _fgd.error || '搜索失败', code: _fgd.code || '', capability: _fgd.capability || '', retryable: !!_fgd.retryable, path: _fgd.path || args.path || '' };
        }
        if (action === 'file_edit') {
            var _fePath = args.path || args.file_path || args.file || '';
            var _feOld = args.old_string || args.old_str || args.old || args.original || '';
            var _feNew = args.new_string || args.new_str || args.new || args.replacement || '';
            let _feUrl = _apiBase + '?action=file_edit&path=' + encodeURIComponent(_fePath);
            if (args.replace_all) _feUrl += '&replace_all=true';
            _feUrl += authSuffix + '&t=' + Date.now();
            var _fer = await fetch(_feUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_string: _feOld, new_string: _feNew })
            });
            var _fed = await _fer.json();
            if (_fed.ok) {
                return { result: '✅ 已编辑 ' + _fePath + ' (' + _fed.replaced + ' 处替换)' + (_fed.backup ? ' [备份: ' + _fed.backup + ']' : '') };
            }
            return { error: _fed.error || '编辑失败', code: _fed.code || '', capability: _fed.capability || '', retryable: !!_fed.retryable, path: _fed.path || _fePath, old_string_preview: _fed.old_string_preview, validation: _fed.validation || null };
        }
        if (action === 'file_write') {
            var _fwPath = args.path || args.file_path || args.file || args.filename || '';
            var _fwContent = args.content !== undefined ? args.content : (args.text || args.data || args.body || '');
            var appendParam = args.append ? '&append=true' : '';
            var r = await fetch(_apiBase + '?action=file_write&path=' + encodeURIComponent(_fwPath) + appendParam + authSuffix + '&t=' + Date.now(), {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' },
                body: typeof _fwContent === 'string' ? _fwContent : JSON.stringify(_fwContent)
            });
            var d = await r.json();
            if (d.ok) {
                // ★ 自动生成可访问URL（根据当前访问域名动态生成）
                var _fp = _fwPath;
                var _webUrl = '';
                if (_fp.indexOf('/oneapichat/') !== -1) {
                    _webUrl = window.location.origin + '/' + _fp.substring(_fp.indexOf('oneapichat/'));
                } else if (_fp.startsWith('/tmp/')) {
                    _webUrl = '(服务器临时文件: ' + _fp + ', 如需访问请用 engine_push 推送)';
                }
                let _resultMsg = '✅ 已写入 ' + _fp + ' (' + d.written + ' 字符)';
                if (_webUrl && !_webUrl.startsWith('(')) {
                    _resultMsg += '\n🔗 在线访问: ' + _webUrl;
                } else if (_webUrl) {
                    _resultMsg += '\n' + _webUrl;
                }
                return { result: _resultMsg };
            }
            return { error: d.error || '写入失败', code: d.code || '', capability: d.capability || '', retryable: !!d.retryable, path: d.path || _fwPath, validation: d.validation || null };
        }
        if (action === 'agent_stop') {
            var r = await fetch(_apiBase + '?action=agent_stop&name=' + encodeURIComponent(args.name) + authSuffix);
            var d = await r.json();
            if (d.ok) return { result: '✅ 已停止子代理: ' + args.name };
            return { error: d.error || '停止失败' };
        }
        if (action === 'push') {
            var r = await fetch(_apiBase + '?action=push&msg=' + encodeURIComponent(args.msg) + authSuffix);
            var d = await r.json();
            if (d.ok) { window.showAgentNotification('info', '📤 已推送通知'); return { result: '消息已推送,将在下次心跳时送达' }; }
            return { error: d.error || '推送失败' };
        }
        // ===== PS / DISK: 无需参数的工具,直接用明确 URL =====
        if (action === 'ps') {
            var _r = await fetch(_apiBase + '?action=ps' + authSuffix);
            var _d = await _r.json();
            if (_d.ok) return { result: _d.stdout, total: _d.total };
            console.warn('[ps] failed:', { status: _r.status, responseKeys: _d && typeof _d === 'object' ? Object.keys(_d).slice(0, 20) : [] });
            return { error: _d.error || 'unreachable' };
        }
        if (action === 'disk') {
            var _r = await fetch(_apiBase + '?action=disk' + authSuffix);
            var _d = await _r.json();
            if (_d.ok) return { result: _d.stdout };
            return { error: _d.error || 'unreachable' };
        }
        // ===== 浏览��工具 (无头浏览器操控) =====
        var browserActions = ['browser_navigate', 'browser_screenshot', 'browser_click', 'browser_type', 'browser_get_content', 'browser_get_snapshot'];
        if (browserActions.indexOf(action) >= 0) {
            // ★ PHP 期望的 action 名 (去掉 browser_ 前缀的变化)
            var _phpAction = action.replace('browser_', 'browser_');  // keep as-is
            let _burl = _apiBase + '?action=' + encodeURIComponent(action) + authSuffix;
            // POST body 用于 navigate/click/type
            var _bmethod = (action === 'browser_navigate' || action === 'browser_click' || action === 'browser_type') ? 'POST' : 'GET';
            if (_bmethod === 'POST') {
                var _r = await fetch(_burl, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(args || {}) });
                var _d = await _r.json();
                if (_d.error) return { error: _d.error, code: _d.code || "", capability: _d.capability || "", chat_id: _d.chat_id || "", retryable: !!_d.retryable };
                // ★ 修复: 返回实际内容而非空壳 '操作完成'
                if (_d.content !== undefined) return { result: _d.content };
                if (_d.snapshot !== undefined) return { result: typeof _d.snapshot === 'string' ? _d.snapshot : JSON.stringify(_d.snapshot) };
                if (_d.result !== undefined) return { result: _d.result };
                if (_d.ok) {
                    // navigate 返回 {ok:true, url:"...", title:"..."}
                    var _parts = [];
                    if (_d.url) _parts.push('📍 ' + _d.url);
                    if (_d.title) _parts.push('📄 ' + _d.title);
                    if (_d.warning) _parts.push('⚠️ ' + _d.warning);
                    return { result: _parts.join('\n') || '操作完成', _url: _d.url };
                }
                return { result: JSON.stringify(_d) };
            } else {
                // GET: 拼参数到 URL
                Object.keys(args || {}).forEach(function(k) {
                    var v = args[k];
                    if (k !== 'action' && k !== 'auth_token' && v !== undefined && v !== null) {
                        _burl += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(String(v));
                    }
                });
                var _r = await fetch(_burl);
                var _d = await _r.json();
                if (_d.error) return { error: _d.error, code: _d.code || "", capability: _d.capability || "", chat_id: _d.chat_id || "", retryable: !!_d.retryable };
                // screenshot: 带 image base64
                if (_d.image) return { result: '截图完成', image: _d.image };
                if (_d.content) return { result: _d.content, url: _d.url };
                if (_d.snapshot) return { result: typeof _d.snapshot === 'string' ? _d.snapshot : JSON.stringify(_d.snapshot) };
                if (_d.ok) return { result: JSON.stringify(_d) };
                return _d;
            }
        }
        // ===== 引擎直通工具 (通过 engine_api.php 的 security_checks + 转发到 engine_server) =====
        var directActions = ['sys_info', 'ps', 'disk', 'network', 'docker', 'db_query', 'file_search', 'file_op', 'file_read', 'file_write'];
        if (directActions.indexOf(action) >= 0) {
            // Docker deployment uses JSON POST to avoid URL length/escaping failures.
            if (action === 'docker' && args && ['doctor','pull','yatori_deploy','logs','stop','remove'].indexOf(String(args.action || 'ps')) >= 0) {
                try {
                    var _dr = await fetch(_apiBase + '?action=docker' + authSuffix, {
                        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(args)
                    });
                    var _dd = await _dr.json();
                    if (_dd.error) return { error: _dd.error, code: _dd.code || '', retryable: !!_dd.retryable, hint: _dd.hint || '' };
                    if (_dd.result !== undefined) return _dd;
                    if (_dd.ok) return { result: JSON.stringify(_dd), data: _dd };
                    return _dd;
                } catch (_dockerTransportError) {
                    return { error: 'Docker API 请求失败: ' + _dockerTransportError.message, code: 'DOCKER_TRANSPORT' };
                }
            }
            let _url = _apiBase + '?action=' + encodeURIComponent(action) + authSuffix;
            // 把 args 里的参数都拼到 URL (跳过与路径冲突的 action 和 php 保留字)
            var _skipKeys = ['action_cmd', 'auth_token'];
            Object.keys(args || {}).forEach(function(k) {
                var v = args[k];
                if (_skipKeys.indexOf(k) >= 0) return;
                // file_op/network/docker 的 action 参数名冲突, 重命名
                var _pk = k;
                if (k === 'action') {
                    if (action === 'file_op') _pk = 'file_action';
                    else if (action === 'network') _pk = 'net_action';
                    else if (action === 'docker') _pk = 'docker_action';
                }
                if (v !== undefined && v !== null) {
                    _url += '&' + encodeURIComponent(_pk) + '=' + encodeURIComponent(String(v));
                }
            });
            try {
                var _r = await fetch(_url);
                var _d = await _r.json();
                if (_d.error) return { error: _d.error, code: _d.code || "", capability: _d.capability || "", chat_id: _d.chat_id || "", retryable: !!_d.retryable };
                // 引擎返回的是对象 (如 {ok:true, stdout:"..."}), 直接返回
                if (_d.ok) {
                    if (_d.stdout) return { result: _d.stdout, stderr: _d.stderr };
                    if (_d.files) return { result: _d.files.length > 0 ? '找到 ' + _d.total + ' 个文件:\n' + _d.files.join('\n') : '未找到匹配文件', files: _d.files, total: _d.total };
                    if (action === 'file_search') return { result: (_d.files && _d.files.length > 0) ? '找到 ' + _d.total + ' 个文件:\n' + _d.files.join('\n') : '未找到匹配文件' };
                    return { result: JSON.stringify(_d) };
                }
                if (_d.result) return _d;
                // stdout 格式: 提取关键输出
                if (_d.stdout) return { result: _d.stdout, stderr: _d.stderr, exitCode: _d.exit_code };
                // files 格式
                if (_d.files) return { result: _d.files.length > 0 ? '找到 ' + _d.total + ' 个文件:\n' + _d.files.join('\n') : '未找到匹配文件', files: _d.files, total: _d.total };
                return _d;
            } catch(_e) {
                console.error('[engineApiHandler] action=' + action + ' url=' + _url + ' error:', _e.message, _e.stack);
                return { error: '引擎工具执行失败: ' + _e.message };
            }
        }
        if (action === 'workflow_create') {
            let _wfUrl = _apiBase + '?action=workflow_create&name=' + encodeURIComponent(args.name);
            _wfUrl += '&steps=' + encodeURIComponent(args.steps || '[]');
            _wfUrl += authSuffix;
            var _wfr = await fetch(_wfUrl);
            var _wfd = await _wfr.json();
            return _wfd;
        }
        if (action === 'workflow_run') {
            var _wrUrl = _apiBase + '?action=workflow_run&name=' + encodeURIComponent(args.name) + authSuffix;
            fetch(_wrUrl).catch(function(){}); // 异步启动，不等待
            return { ok: true };
        }
        // ===== 视频猎手 Video Hunter (B站下载/BT磁力/云盘) =====
        if (action === 'video_hunter') {
            var vhAction = args.action || '';
            var vhArgs = args.args || {};
            var _vhUrl = _apiBase + '?action=video_hunter&sub_action=' + encodeURIComponent(vhAction);
            // 拼接参数
            Object.keys(vhArgs).forEach(function(k) {
                var v = vhArgs[k];
                if (v !== undefined && v !== null && v !== '') {
                    _vhUrl += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v));
                }
            });
            _vhUrl += authSuffix;
            try {
                var _vhr = await fetch(_vhUrl);
                var _vhd = await _vhr.json();
                if (_vhd.error) return { error: _vhd.error };
                return { result: typeof _vhd === 'string' ? _vhd : JSON.stringify(_vhd, null, 2) };
            } catch(_vhErr) {
                return { error: '视频猎手执行失败: ' + _vhErr.message };
            }
        }
        if (action === 'bilibili') {
            var biliAction = args.action || '';
            var biliArgs = args.args || {};
            var _biliUrl = _apiBase + '?action=bilibili_bridge&sub_action=' + encodeURIComponent(biliAction);
            Object.keys(biliArgs).forEach(function(k) {
                var v = biliArgs[k];
                if (v !== undefined && v !== null && v !== '') {
                    _biliUrl += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v));
                }
            });
            _biliUrl += authSuffix;
            try {
                var _biliR = await fetch(_biliUrl);
                var _biliD = await _biliR.json();
                if (_biliD.error) return { error: _biliD.error };
                return { result: typeof _biliD === 'string' ? _biliD : JSON.stringify(_biliD, null, 2) };
            } catch(_biliErr) {
                return { error: 'B站工具执行失败: ' + _biliErr.message };
            }
        }
        return { error: '未知操作: ' + action };
    } catch(e) {
        console.error('[EngineAPI] ' + action + ' 失败:', e.message, '(请确认引擎服务运行正常)');
        return { error: '引擎API错误(' + action + '): ' + e.message };
    }
}

function queryRAG() {
    var input = getEl('ragQueryInput');
    if (!input || !input.value.trim()) return;
    var q = input.value.trim();
    var btn = getEl('ragQueryBtn');
    if (btn) { btn.textContent = '...'; btn.disabled = true; }
    var uid = localStorage.getItem('authUserId') || '';
    var coll = localStorage.getItem('ragCurrentCollection') || 'default';
    var ns = uid ? uid + '_' + coll : coll;
    fetch(RAG_API + '?action=search&collection=' + encodeURIComponent(ns), {
        method: 'POST', headers: Object.assign({'Content-Type': 'application/json'}, _cloudreveAuthHeaders()),
        body: JSON.stringify({question: q})
    }).then(function(r) { return r.json(); })
      .then(function(d) {
          if (btn) { btn.textContent = '查询'; btn.disabled = false; }
          if (d && d.hits && d.hits.length > 0) showToast('找到' + d.hits.length + '条结果', 'success');
          else showToast('未找到', 'warning');
      }).catch(function(e) {
          if (btn) { btn.textContent = '查询'; btn.disabled = false; }
          showToast('查询失败', 'error');
      });
}

// ★ init.js 已有 DOMContentLoaded → init() → loadAllResources()，此处不重复调用

function deleteDocument(docId) {
    if (!docId || !confirm('确认删除此文档?')) return;
    var uid = localStorage.getItem('authUserId') || '';
    var coll = localStorage.getItem('ragCurrentCollection') || 'default';
    var ns = uid ? uid + '_' + coll : coll;
    showToast('删除中...', 'info');
    fetch(RAG_API + '?action=knowledge&collection=' + encodeURIComponent(ns) + '&doc_id=' + encodeURIComponent(docId), { method: 'DELETE', headers: _cloudreveAuthHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d && d.success) {
                showToast('已删除', 'success');
                loadKnowledgeList();
            } else {
                showToast('删除失败', 'error');
            }
        })
        .catch(function() { showToast('删除失败', 'error'); });
}


function loadEmbedConfig() {
    var coll = localStorage.getItem('ragCurrentCollection') || 'default';
    var uid = localStorage.getItem('authUserId') || '';
    var ns = uid ? encodeURIComponent(uid + '_' + coll) : encodeURIComponent(coll);
    // 先获取模型列表填充下拉框,再加载当前配置设置选中值(链式避免竞态)
    fetch(RAG_API + '?action=list_models', { headers: _cloudreveAuthHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var sm = getEl('ragEmbedModel');
            if (!sm) return;
            var curVal = sm.value;
            var html = '<option value="">TF-IDF(纯词法)</option>';
            html += '<option value="text-embedding-3-small">text-embedding-3-small(OpenAI)</option>';
            html += '<option value="text-embedding-3-large">text-embedding-3-large(OpenAI)</option>';
            if (data && data.models) {
                data.models.forEach(function(m) {
                    var mn = typeof m === 'string' ? m : (m.model || '');
                    var dim = m.dim || 0;
                    if (mn && (mn.includes('zh') || mn.includes('jina') || mn.includes('bge'))) {
                        html += '<option value="' + mn + '">' + mn + (dim ? ' (' + dim + '维)' : '') + '</option>';
                    }
                });
            }
            sm.innerHTML = html;
            if (curVal) sm.value = curVal;

            // 下拉框就绪后再加载当前配置设置选中值
            return fetch(RAG_API + '?action=embed_config&collection=' + ns, { headers: _cloudreveAuthHeaders() });
        })
        .then(function(r) { return r ? r.json() : null; })
        .then(function(d) {
            if (!d) return;
            var sm = getEl('ragEmbedModel');
            var sm2 = getEl('ragSearchMode');
            var st = getEl('ragEmbedStatus');
            if (sm && d.embed_model) sm.value = d.embed_model;
            if (sm2) sm2.value = d.mode || 'hybrid';
            if (st) {
                if (d.embed_model) {
                    var modeLabel = {hybrid:'混合模式',embedding:'语义搜索',tfidf:'纯词法'}[d.mode] || d.mode;
                    st.innerHTML = '嵌入: ' + d.embed_model + ' (' + modeLabel + ')';
                } else {
                    st.innerHTML = '嵌入: 未启用(纯TF-IDF词法检索)';
                }
            }
        }).catch(function() {});
}
