// cloudreve.js — Cloudreve 云盘 API v1.0 (Phase 3 拆分自 main.js)
// cloudreveApiHandler / 文件搜索 / 上传 / 下载

// ==================== Cloudreve 云盘 API 处理器 ====================
async function cloudreveApiHandler(action, args) {
    var token = localStorage.getItem('authToken') || '';
    var authSuffix = token ? '&auth_token=' + encodeURIComponent(token) : '';
    let base = '/oneapichat/api/cloudreve_api.php?action=' + action + authSuffix;

    // 拼接额外参数
    if (args) {
        for (var k in args) {
            if (args.hasOwnProperty(k) && args[k] !== undefined && args[k] !== '') {
                base += '&' + k + '=' + encodeURIComponent(args[k]);
            }
        }
    }

    try {
        var r = await fetch(base, { signal: AbortSignal.timeout(60000) });
        var d = await r.json();
        if (d.success) {
            return { result: JSON.stringify(d, null, 2) };
        }
        return { error: d.error || d.msg || '操作失败' };
    } catch(e) {
        return { error: 'Cloudreve API 错误: ' + e.message };
    }
}

async function engineApiHandler(action, args) {
    // 所有引擎 API 调用带上 auth_token 实现用户隔离
    var token = localStorage.getItem('authToken') || '';
    var authSuffix = token ? '&auth_token=' + encodeURIComponent(token) : '';

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
            url += '&action_cmd=' + encodeURIComponent(args.action_cmd);
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
            // 继承当前用户的 API Key 和 baseUrl
            var currentKey = localStorage.getItem('apiKey') || '';
            var currentUrl = localStorage.getItem('baseUrl') || 'https://api.deepseek.com/v1';
            var currentModel = args.model || localStorage.getItem('model') || 'deepseek-chat';
            var agentRole = args.role || 'general';
            var url = '/oneapichat/api/engine_api.php?action=agent_create&name=' + encodeURIComponent(args.name);
            url += '&prompt=' + encodeURIComponent(args.prompt || args.task || '');
            url += '&role=' + encodeURIComponent(agentRole);
            url += '&model=' + encodeURIComponent(currentModel);
            url += '&api_key=' + encodeURIComponent(currentKey);
            url += '&base_url=' + encodeURIComponent(currentUrl);
            url += authSuffix;
            try {
                var r = await fetch(url);
                var d = await r.json();
                if (d.ok) {
                    // 创建后自动运行(不等待完成,避免阻塞并行工具调用)
                    fetch(_apiBase + '?action=agent_run&name=' + encodeURIComponent(args.name) + authSuffix).catch(function(){});
                    return { result: '✅ 子代理 ' + args.name + ' 已创建并启动(角色:' + agentRole + ')' };
                }
                return { error: d.error || '创建失败' };
            } catch(e) {
                return { error: '引擎服务异常: ' + e.message };
            }
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
            var r = await fetch(_apiBase + '?action=exec&cmd=' + encodeURIComponent(args.cmd) + '&timeout=' + (args.timeout || 60) + '&cwd=' + encodeURIComponent(args.cwd || '') + authSuffix);
            var d = await r.json();
            if (d.ok) {
                var out = '💻 命令: ' + args.cmd + '\n退出码: ' + d.exit_code + '\n';
                if (d.stdout) out += '输出:\n' + d.stdout + '\n';
                if (d.stderr) out += '错误:\n' + d.stderr + '\n';
                if (d.error) out += '异常: ' + d.error;
                return { result: out };
            }
            return { error: d.error || '命令执行失败' };
        }
        if (action === 'python') {
            var r = await fetch(_apiBase + '?action=python&timeout=' + (args.timeout || 30) + authSuffix + '&t=' + Date.now(), {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' },
                body: args.script || ''
            });
            var d = await r.json();
            if (d.ok) {
                var out = '🐍 Python 脚本执行结果:\n退出码: ' + d.exit_code + '\n';
                if (d.stdout) out += '输出:\n' + d.stdout + '\n';
                if (d.stderr) out += '错误:\n' + d.stderr + '\n';
                return { result: out };
            }
            return { error: d.error || 'Python 脚本执行失败' };
        }
        if (action === 'file_read') {
            let _frUrl = _apiBase + '?action=file_read&path=' + encodeURIComponent(args.path) + '&max_lines=' + (args.max_lines || 200);
            if (args.start_line) _frUrl += '&start_line=' + args.start_line;
            if (args.end_line) _frUrl += '&end_line=' + args.end_line;
            _frUrl += authSuffix;
            var r = await fetch(_frUrl);
            var d = await r.json();
            if (d.ok) {
                var _range = d.shown_range ? ' [' + d.shown_range + '/' + d.total_lines + '行]' : '';
                var out = '📄 ' + args.path + _range + ' (' + (d.size || 0) + ' bytes)\n' + d.content;
                return { result: out };
            }
            return { error: d.error || '读取失败' };
        }
        if (action === 'file_grep') {
            let _fgUrl = _apiBase + '?action=file_grep&pattern=' + encodeURIComponent(args.pattern) + '&path=' + encodeURIComponent(args.path || '/var/www/html/oneapichat');
            if (args.context_lines) _fgUrl += '&context_lines=' + args.context_lines;
            if (args.file_pattern) _fgUrl += '&file_pattern=' + encodeURIComponent(args.file_pattern);
            if (args.max_results) _fgUrl += '&max_results=' + args.max_results;
            if (args.ignore_case === false) _fgUrl += '&ignore_case=false';
            _fgUrl += authSuffix;
            var _fgr = await fetch(_fgUrl);
            var _fgd = await _fgr.json();
            if (_fgd.ok && _fgd.results) {
                let _fgOut = '🔍 搜索 "' + args.pattern + '" (' + _fgd.total_matches + ' 处匹配):\n\n';
                _fgd.results.forEach(function(_fr) {
                    _fgOut += '─── ' + _fr.file + ' ───\n';
                    _fr.matches.forEach(function(_m) { _fgOut += _m + '\n\n'; });
                });
                return { result: _fgOut };
            }
            return { error: _fgd.error || '搜索失败' };
        }
        if (action === 'file_edit') {
            let _feUrl = _apiBase + '?action=file_edit&path=' + encodeURIComponent(args.path);
            if (args.replace_all) _feUrl += '&replace_all=true';
            _feUrl += authSuffix + '&t=' + Date.now();
            var _fer = await fetch(_feUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_string: args.old_string, new_string: args.new_string })
            });
            var _fed = await _fer.json();
            if (_fed.ok) {
                return { result: '✅ 已编辑 ' + args.path + ' (' + _fed.replaced + ' 处替换)' + (_fed.backup ? ' [备份: ' + _fed.backup + ']' : '') };
            }
            return { error: _fed.error || '编辑失败', old_string_preview: _fed.old_string_preview };
        }
        if (action === 'file_write') {
            var appendParam = args.append ? '&append=true' : '';
            var r = await fetch(_apiBase + '?action=file_write&path=' + encodeURIComponent(args.path) + appendParam + authSuffix + '&t=' + Date.now(), {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' },
                body: args.content || ''
            });
            var d = await r.json();
            if (d.ok) {
                // ★ 自动生成可访问URL（根据当前访问域名动态生成）
                var _fp = args.path;
                var _webUrl = '';
                if (_fp.indexOf('/oneapichat/') !== -1) {
                    _webUrl = window.location.origin + '/' + _fp.substring(_fp.indexOf('oneapichat/'));
                } else if (_fp.startsWith('/tmp/')) {
                    _webUrl = '(服务器临时文件: ' + _fp + ', 如需访问请用 engine_push 推送)';
                }
                let _resultMsg = '✅ 已写入 ' + args.path + ' (' + d.written + ' 字符)';
                if (_webUrl && !_webUrl.startsWith('(')) {
                    _resultMsg += '\n🔗 在线访问: ' + _webUrl;
                } else if (_webUrl) {
                    _resultMsg += '\n' + _webUrl;
                }
                return { result: _resultMsg };
            }
            return { error: d.error || '写入失败' };
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
            console.warn('[ps] failed:', JSON.stringify(_d).substring(0,200));
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
                return _d.error ? { error: _d.error } : (_d.content || _d.snapshot || _d.result || _d.ok ? '操作完成' : _d);
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
                if (_d.error) return { error: _d.error };
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
                if (_d.error) return { error: _d.error };
                // 引擎返回的是对象 (如 {ok:true, stdout:"..."}), 直接返回
                if (_d.ok) return _d.stdout ? { result: _d.stdout, stderr: _d.stderr } : { result: JSON.stringify(_d) };
                if (_d.result) return _d;
                // stdout 格式: 提取关键输出
                if (_d.stdout) return { result: _d.stdout, stderr: _d.stderr, exitCode: _d.exit_code };
                // files 格式
                if (_d.files) return { result: _d.files.join('\n'), files: _d.files, total: _d.total };
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
    var _token = getAuthToken();
    fetch(RAG_API + '?action=search&collection=' + encodeURIComponent(ns) + '&auth_token=' + encodeURIComponent(_token), {
        method: 'POST', headers: {'Content-Type': 'application/json'},
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
    var _token = getAuthToken();
    showToast('删除中...', 'info');
    fetch(RAG_API + '?action=delete_document&collection=' + encodeURIComponent(ns) + '&doc_id=' + encodeURIComponent(docId) + '&auth_token=' + encodeURIComponent(_token))
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

    // 先获取本地模型列表,更新下拉框
    var _token = getAuthToken();
    fetch(RAG_API + '?action=list_models&auth_token=' + encodeURIComponent(_token))
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var sm = getEl('ragEmbedModel');
            if (!sm) return;
            // 保留当前选中值
            var curVal = sm.value;
            // 构建选项:API模型 + 本地模型
            let html = '<option value="">TF-IDF(纯词法)</option>';
            html += '<option value="text-embedding-3-small">text-embedding-3-small(OpenAI)</option>';
            html += '<option value="text-embedding-3-large">text-embedding-3-large(OpenAI)</option>';
            if (data && data.models) {
                data.models.forEach(function(m) {
                    if (m.model.includes('zh') || m.model.includes('jina')) {
                        html += '<option value="' + m.model + '">' + m.model + ' (本地, ' + m.dim + '维)</option>';
                    }
                });
            }
            sm.innerHTML = html;
            if (curVal) sm.value = curVal;
        }).catch(function() {});

    // 加载当前配置
    var _token = getAuthToken();
    fetch(RAG_API + '?action=embed_config&collection=' + ns + '&auth_token=' + encodeURIComponent(_token))
        .then(function(r) { return r.json(); })
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


