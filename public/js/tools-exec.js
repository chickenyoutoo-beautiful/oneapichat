// tools-exec.js — 工具执行分发表 v1.0 (Phase 8 拆分自 main.js)
// executeToolCallForRetry — 100+ 工具分支的统一执行入口

// ★ 容错修复工具参数JSON: 未转义引号 → \"、未转义换行 → \\n、截断 → 补齐引号/花括号
function repairToolArguments(raw) {
    if (typeof raw !== 'string') return '{}';
    var out = '';
    var inStr = false;
    var hadInner = false;
    for (var i = 0; i < raw.length; i++) {
        var ch = raw.charAt(i);
        if (!inStr) {
            out += ch;
            if (ch === '"') { inStr = true; hadInner = false; }
            continue;
        }
        if (ch === '\\') {
            out += ch;
            if (i + 1 < raw.length) { out += raw.charAt(i + 1); i++; }
            continue;
        }
        if (ch === '\n') { out += '\\n'; continue; }
        if (ch === '\r') { out += '\\r'; continue; }
        if (ch === '\t') { out += '\\t'; continue; }
        if (ch.charCodeAt(0) < 32) { out += ' '; continue; }
        if (ch === '"') {
            var j = i + 1;
            while (j < raw.length && (raw.charAt(j) === ' ' || raw.charAt(j) === '\t')) j++;
            var nxt = j < raw.length ? raw.charAt(j) : '';
            if (nxt === ',') {
                var k = j + 1;
                while (k < raw.length && (raw.charAt(k) === ' ' || raw.charAt(k) === '\t')) k++;
                var afterComma = k < raw.length ? raw.charAt(k) : '';
                if (afterComma === '"' || afterComma === '}' || afterComma === ']' || afterComma === '') {
                    if (hadInner) {
                        // 值内引号对刚闭合, 逗号前补一个真正的JSON收尾引号
                        out += '\\"'; out += '"'; inStr = false;
                    } else {
                        out += '"'; inStr = false;
                    }
                } else {
                    out += '\\"'; hadInner = true;
                }
            } else if (nxt === '}' || nxt === ']' || nxt === ':' || nxt === '') {
                out += '"';
                inStr = false;
            } else {
                out += '\\"'; hadInner = true;
            }
            continue;
        }
        out += ch;
    }
    if (inStr) out += '"';
    var ob = (out.match(/\{/g) || []).length;
    var cb = (out.match(/\}/g) || []).length;
    while (cb < ob) { out += '}'; cb++; }
    return out;
}

// ★ 容错提取字符串参数: 兼容模型输出未转义引号/非法JSON的情况
function tolerantExtractArg(raw, keys) {
    if (!raw || typeof raw !== 'string') return '';
    var i, j, k;
    // 1) 标准 JSON 转义的值
    for (i = 0; i < keys.length; i++) {
        var key = keys[i];
        var re = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');
        var m = raw.match(re);
        if (m) {
            return m[1].replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
    }
    // 2) 容错: 值内含未转义的引号 → 取 "key": " 之后全部内容, 从末尾找真正的收尾引号
    for (j = 0; j < keys.length; j++) {
        var key2 = keys[j];
        var re2 = new RegExp('"' + key2 + '"\\s*:\\s*"([\\s\\S]*)$');
        var m2 = raw.match(re2);
        if (!m2) continue;
        var val = m2[1].replace(/\s+$/, '');
        var cut = -1;
        for (k = val.length - 1; k >= 0; k--) {
            if (val.charAt(k) === '"') {
                var rest = val.substring(k + 1).replace(/^\s+/, '');
                if (rest === '' || rest.charAt(0) === '}' || rest.charAt(0) === ',') {
                    cut = k;
                    break;
                }
            }
        }
        if (cut >= 0) val = val.substring(0, cut);
        val = val.trim();
        return val.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return '';
}

                window.executeToolCallForRetry = async function(tc, abortSignal, ctx) {
    var body = ctx.body, pendingMsg = ctx.pendingMsg, chatId = ctx.chatId,
        currentChatId = ctx.currentChatId, activeBubbleMap = ctx.activeBubbleMap,
        chats = ctx.chats;

    // ★ QR码弹窗函数 (放在最前面确保回调时可访问)
    function showQrCodePopup(qrB64, title, hint) {
        var _overlay = document.getElementById('qr-popup-overlay');
        var _img = document.getElementById('qr-popup-img');
        var _title = document.getElementById('qr-popup-title');
        var _desc = document.getElementById('qr-popup-desc');
        var _hintEl = document.getElementById('qr-popup-hint');
        if (_overlay && _img && qrB64) {
            _img.src = qrB64;
            if (_title) _title.textContent = '📷 ' + (title || '扫码登录');
            if (_desc) _desc.textContent = '请用手机APP扫描二维码';
            if (_hintEl) _hintEl.textContent = hint || '扫码确认后将自动完成登录';
            _overlay.style.display = 'flex';
        }
    }
    function hideQrCodePopup() {
        var _overlay = document.getElementById('qr-popup-overlay');
        if (_overlay) _overlay.style.display = 'none';
    }
    window.showQrCodePopup = showQrCodePopup;
    window.hideQrCodePopup = hideQrCodePopup;
                    var func = tc.function;
                    let args;
                    try {
                        if (typeof func.arguments === 'string') {
                            var raw = func.arguments;
                            try {
                                args = JSON.parse(raw || '{}');
                            } catch (e1) {
                                // ★ 修复: 未转义引号/换行/截断 → 容错修复后再解析
                                args = JSON.parse(repairToolArguments(raw) || '{}');
                            }
                        } else {
                            args = func.arguments || {};
                        }
                    } catch (parseErr) {
                        // ★ 尝试更激进的修复: 直接按名称提取参数
                        var argStr2 = typeof func.arguments === 'string' ? func.arguments : '';
                        if (func.name === 'server_file_edit' || func.name === 'server_file_write') {
                            var _pMatch = argStr2.match(/"path"\s*:\s*"([^"]*)"/);
                            var _oMatch = argStr2.match(/"old_string"\s*:\s*"([\s\S]*?)"(?=\s*[,\}])/);
                            var _nMatch = argStr2.match(/"new_string"\s*:\s*"([\s\S]*?)"(?=\s*[,\}])/);
                            var _cMatch = argStr2.match(/"content"\s*:\s*"([\s\S]*?)"(?=\s*[,\}])/);
                            args = {
                                path: _pMatch ? _pMatch[1] : '',
                                old_string: _oMatch ? _oMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '',
                                new_string: _nMatch ? _nMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '',
                                content: _cMatch ? _cMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : ''
                            };
                        } else if (func.name === 'engine_agent_create') {
                            var nameMatch = argStr2.match(/"name"\s*:\s*"([^"]+)"/);
                            var promptMatch = argStr2.match(/"prompt"\s*:\s*"([\s\S]*?)"(?=\s*[,\}])/);
                            var modelMatch = argStr2.match(/"model"\s*:\s*"([^"]+)"/);
                            args = {
                                name: nameMatch ? nameMatch[1] : 'agent_' + Date.now(),
                                prompt: promptMatch ? promptMatch[1].replace(/\\n/g, '\n') : '搜索并整理相关信息',
                                model: modelMatch ? modelMatch[1] : ''
                            };
                        } else if (func.name === 'server_exec') {
                            // ★ 容错提取 cmd(兼容 command/query 别名与值内含未转义引号)
                            var _cmdT = tolerantExtractArg(argStr2, ['cmd', 'command', 'query']);
                            args = _cmdT ? { cmd: _cmdT } : {};
                        } else if (func.name === 'server_python') {
                            // ★ 容错提取 script(兼容 code/cmd 别名)
                            var _scriptT = tolerantExtractArg(argStr2, ['script', 'code', 'cmd']);
                            args = _scriptT ? { script: _scriptT } : {};
                        } else if (func.name === 'plan_update') {
                            // ★ plan_update 参数修复: 从破损 JSON 中提取关键字段
                            var _aMatch = argStr2.match(/"action"\s*:\s*"([^"]+)"/);
                            var _tidMatch = argStr2.match(/"task_id"\s*:\s*"([^"]+)"/);
                            var _stMatch = argStr2.match(/"status"\s*:\s*"([^"]+)"/);
                            var _noteMatch = argStr2.match(/"note"\s*:\s*"([^"]*)"/);
                            // tasks 数组: 尝试提取 tasks 片段
                            var _tasksMatch = argStr2.match(/"tasks"\s*:\s*(\[[\s\S]*?\](?=\s*[,\}]))/);
                            var _tasks = [];
                            if (_tasksMatch) {
                                try { _tasks = JSON.parse(_tasksMatch[1]); } catch(e) {
                                    // 从 tasks 片段中逐个提取 id/title
                                    var _taskItems = _tasksMatch[1].match(/\{[^}]+\}/g);
                                    if (_taskItems) {
                                        _tasks = _taskItems.map(function(ti, idx) {
                                            var _idM = ti.match(/"id"\s*:\s*"([^"]+)"/);
                                            var _tiM = ti.match(/"title"\s*:\s*"([^"]+)"/);
                                            return { id: (_idM ? _idM[1] : 'task_' + (idx+1)), title: (_tiM ? _tiM[1] : '步骤' + (idx+1)), status: 'pending' };
                                        });
                                    }
                                }
                            }
                            args = {
                                action: _aMatch ? _aMatch[1] : '',
                                task_id: _tidMatch ? _tidMatch[1] : '',
                                status: _stMatch ? _stMatch[1] : '',
                                tasks: _tasks,
                                note: _noteMatch ? _noteMatch[1] : ''
                            };
                        } else {
                            // ★ 通用回退: 正则提取所有 "key":"value" 对
                            args = {};
                            var _kvRegex = /"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
                            var _kvMatch;
                            while ((_kvMatch = _kvRegex.exec(argStr2)) !== null) {
                                args[_kvMatch[1]] = _kvMatch[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                            }
                            // 也提取数字和布尔值
                            var _kvNumRegex = /"(\w+)"\s*:\s*(-?\d+(?:\.\d+)?|true|false)/g;
                            while ((_kvMatch = _kvNumRegex.exec(argStr2)) !== null) {
                                var _v = _kvMatch[2];
                                if (_v === 'true') _v = true;
                                else if (_v === 'false') _v = false;
                                else _v = parseFloat(_v);
                                args[_kvMatch[1]] = _v;
                            }
                        }
                        if (Object.keys(args).length === 0) {
                            console.warn('[executeToolCallForRetry] 无法解析工具参数:', func.name, argStr2.substring(0, 200));
                        }
                    }
                    let toolResult = { error: `Unknown tool: ${func.name}` };

                    // ★ 外部 MCP 服务器工具路由 — 通过 PHP 代理转发
                    if (typeof toolRegistry !== 'undefined' && toolRegistry.get && toolRegistry.get(func.name)) {
                        var _mcpMeta = toolRegistry.get(func.name);
                        if (_mcpMeta && _mcpMeta.mcpServerId && typeof window.mcpCallTool === 'function') {
                            toolResult = await window.mcpCallTool(_mcpMeta.mcpServerId, func.name, args);
                            // 标准化返回格式
                            if (toolResult && toolResult.error) {
                                toolResult = { error: toolResult.error };
                            } else if (toolResult && toolResult.content) {
                                // MCP 标准 content 格式 → 提取文本
                                var _texts = [];
                                if (Array.isArray(toolResult.content)) {
                                    toolResult.content.forEach(function(c) {
                                        if (c.type === 'text' && c.text) _texts.push(c.text);
                                    });
                                }
                                toolResult = { result: _texts.join('\n') };
                            } else if (toolResult && typeof toolResult === 'object') {
                                toolResult = { result: JSON.stringify(toolResult, null, 2) };
                            }
                        }
                    }

                    if (func.name === 'web_search') {
                        let query = args.query;
                        if (query) {
                            // ★ 「🔧 工具调用」状态行已移除 (实时状态由 tool-call-lines + 顶部状态栏承担)
                            try {
                                // 不传递外部signal,让performWebSearch使用自己的超时控制器
                                var searchResult = await performWebSearch(query, null, 'web');
                                var optimized = formatRawResults(searchResult);
                                // ★ 气泡外滚动展示搜索标题 (完整结果仍传给模型)
                                if (window.showSearchTicker) window.showSearchTicker(searchResult);
                                toolResult = { result: optimized || '搜索完成' };
                            } catch (e) {
                                toolResult = { error: e.message };
                            }
                        } else {
                            toolResult = { error: 'Missing query parameter' };
                        }
                    }
                    else if (func.name === 'web_fetch') {
                        let urls = [];
                        // ★ 部分模型(如LongCat)会将URL数组直接作为arguments传入,而非包装在 {urls:[...]} 中
                        if (Array.isArray(args)) {
                            urls = args.filter(function(u) { return typeof u === 'string'; }).slice(0, 5);
                        } else if (Array.isArray(args.urls)) {
                            urls = args.urls.slice(0, 5); // 最多5个
                        } else if (typeof args.urls === 'string') {
                            urls = [args.urls];
                        } else if (typeof args.url === 'string') {
                            urls = [args.url];
                        }
                        if (urls.length > 0) {
                            // ★ 抓取状态行已移除 (实时状态由 tool-call-lines + 顶部状态栏承担)
                            try {
                                var fetched = await performWebFetch(urls);
                                if (fetched.error) {
                                    toolResult = { error: fetched.error };
                                } else {
                                    // 格式化为可读的文本
                                    var parts = fetched.results.map((r, i) => {
                                        var label = urls.length > 1 ? `【网页${i + 1}】` : '';
                                        if (r.error) {
                                            return `${label}${r.url}\n⚠️ 抓取失败: ${r.error}`;
                                        }
                                        // 截断过长内容
                                        var content = r.content && r.content.length > 8000
                                            ? r.content.slice(0, 8000) + '...(内容过长已截断)'
                                            : (r.content || '(无内容)');
                                        return `${label}${r.url}\n${content}`;
                                    });
                                    // ★ 只返回字符串结果, 避免LongCat API报 'list object has no attribute items' 错误
                                    toolResult = { result: parts.join('\n\n---\n\n') };
                                    if (currentChatId === chatId) {
                                        var currentBubble = activeBubbleMap[chatId];
                                        let status = currentBubble?.querySelector('.search-status');
                                        if (status) status.textContent = `✅ 抓取完成 (${urls.length}个网页)`;
                                    }
                                }
                            } catch (e) {
                                toolResult = { error: e.message };
                            }
                        } else {
                            toolResult = { error: 'Missing urls parameter. Provide a URL or array of URLs.' };
                        }
                    }
                    else if (func.name === 'run_skill') {
                        var skillName = args.skill_name || '';
                        var skillParams = args.params || {};
                        if (skillName) {
                            try {
                                var skillResp = await fetch('/oneapichat/api/engine_api.php?action=skills_run&auth_token=' + encodeURIComponent(window.getAuthToken ? getAuthToken() : ''), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ skill_name: skillName, params: skillParams })
                                });
                                var skillData = await skillResp.json();
                                if (skillData && skillData.ok) {
                                    toolResult = { result: skillData.prompt || '技能已执行' };
                                } else {
                                    toolResult = { error: (skillData && skillData.error) || '技能执行失败' };
                                }
                            } catch (e) {
                                toolResult = { error: e.message };
                            }
                        } else {
                            toolResult = { error: 'Missing skill_name parameter' };
                        }
                    }
                    else if (func.name === 'platform_extract') {
                        var platUrl = args.url || '';
                        if (platUrl) {
                            try {
                                var platResp = await fetch('/oneapichat/api/engine_api.php?action=platform_extract&url=' + encodeURIComponent(platUrl) + '&auth_token=' + encodeURIComponent(window.getAuthToken ? getAuthToken() : ''));
                                var platData = await platResp.json();
                                if (platData && platData.result) {
                                    toolResult = { result: platData.result };
                                } else if (platData && platData.error) {
                                    toolResult = { error: platData.error };
                                } else {
                                    toolResult = { result: '内容提取完成' };
                                }
                            } catch (e) {
                                toolResult = { error: e.message };
                            }
                        } else {
                            toolResult = { error: 'Missing url parameter' };
                        }
                    }
                    else if (func.name === 'rag_search') {
                        var question = args.question || args.query || '';
                        if (question) {
                            if (currentChatId === chatId) {
                                var _b = activeBubbleMap[chatId];
                                if (_b) {
                                    var _st = _b.querySelector('.search-status');
                                    if (!_st) { _st = document.createElement('div'); _st.className = 'search-status'; _b.querySelector('.markdown-body')?.appendChild(_st); }
                                    _st.textContent = '📚 搜索知识库: ' + question;
                                }
                            }
                            try {
                                var _uid = localStorage.getItem('authUserId') || '';
                                var _coll = localStorage.getItem('ragCurrentCollection') || 'default';
                                var _ns = _uid ? _uid + '_' + _coll : _coll;
                                var _token = getAuthToken();
                                var _resp = await fetch('/oneapichat/api/rag_proxy.php?action=search&collection=' + encodeURIComponent(_ns) + '&auth_token=' + encodeURIComponent(_token), {
                                    method: 'POST', headers: {'Content-Type': 'application/json'},
                                    body: JSON.stringify({question: question})
                                });
                                var _data = await _resp.json();
                                if (_data && _data.hits && _data.hits.length > 0) {
                                    var _parts = _data.hits.map(function(h, i) {
                                        return '[\u7247\u6bb5' + (i+1) + ' \u6765\u6e90:' + h.source + '] ' + h.full_content;
                                    });
                                    toolResult = { result: _parts.join('\n\n') };
                                } else {
                                    toolResult = { result: 'empty' };
                                }
                            } catch(e) {
                                toolResult = { error: 'rag fail: ' + e.message };
                            }
                        } else {
                            toolResult = { error: 'no question' };
                        }
                    }
                     else if (func.name === 'chaoxing_login') {
                        var u = args.username, p = args.password;
                        if (u && p) {
                            toolResult = await chaoxingToolHandler('login', null, u, p);
                        } else {
                            toolResult = { error: '请提供手机号和密码' };
                        }
                    }
                     else if (func.name === 'chaoxing_list_courses') {
                        toolResult = await chaoxingToolHandler('courses');
                    }
                     else if (func.name === 'chaoxing_auto') {
                        var ids = args.course_ids;
                        if (ids) toolResult = await chaoxingToolHandler('start', ids);
                        else toolResult = { error: '请指定课程ID' };
                    }
                     else if (func.name === 'chaoxing_status') {
                        toolResult = await chaoxingToolHandler('status');
                    }
                     else if (func.name === 'chaoxing_stop') {
                        toolResult = await chaoxingToolHandler('stop');
                    }
                     else if (func.name === 'chaoxing_stats') {
                        toolResult = await chaoxingToolHandler('stats');
                    }
                     else if (func.name === 'chaoxing_overview') {
                        toolResult = await chaoxingToolHandler('overview');
                    }
                     else if (func.name === 'chaoxing_auth') {
                        toolResult = await chaoxingToolHandler('auth_check');
                    }
                     else if (func.name === 'chaoxing_exam_list') {
                        toolResult = await chaoxingToolHandler('exam_list');
                    }
                     else if (func.name === 'chaoxing_exam_start') {
                        toolResult = await chaoxingToolHandler('exam_start', args.exam_ids || '');
                    }
                     else if (func.name === 'chaoxing_exam_status') {
                        toolResult = await chaoxingToolHandler('exam_status');
                    }
                     else if (func.name === 'chaoxing_exam_stop') {
                        toolResult = await chaoxingToolHandler('exam_stop');
                    }
                     else if (func.name === 'engine_cron_list') {
                        toolResult = await engineApiHandler('cron_list');
                    }
                     else if (func.name === 'engine_cron_create') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('cron_create', args); }
                        } else { toolResult = await engineApiHandler('cron_create', args); }
                    }
                     else if (func.name === 'engine_cron_delete') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('cron_delete', args); }
                        } else { toolResult = await engineApiHandler('cron_delete', args); }
                    }
                     else if (func.name === 'engine_agent_create') {
                        _hasCreatedSubAgent = true;
                        var _aName = (args && args.name) ? args.name : ('agent_' + Date.now());
                        // ★ 关联到当前任务
                        var _curTaskId = window._lastMsgTaskId || window._currentTaskId;
                        if (_curTaskId && typeof window.addAgentToTask === 'function') {
                            window.addAgentToTask(_curTaskId, _aName, args.role || 'general');
                        }
                        // ★ 传递网络代理配置
                        var _aArgs = Object.assign({}, args);
                        if (window.isProxyEnabled && window.isProxyEnabled() && window.getProxyUrl && window.getProxyUrl()) {
                            _aArgs.proxy_url = window.getProxyUrl();
                            _aArgs.proxy_enabled = '1';
                        }
                        toolResult = await engineApiHandler('agent_create', _aArgs);
                    }
                     else if (func.name === 'engine_agent_status') {
                        toolResult = await engineApiHandler('agent_status', args);
                        // ★ 防护: 子代理运行中时追加警告,防止浪费token轮询
                        if (toolResult && toolResult.result && typeof toolResult.result === 'object') {
                            var _s = toolResult.result.status || '';
                            if (_s === 'running') {
                                toolResult.result._polling_warning = '⚠️ 该子代理正在运行中。请勿重复查询状态！完成后会自动推送结果。';
                            }
                        }
                    }
                     else if (func.name === 'engine_agent_list') {
                        toolResult = await engineApiHandler('agent_list');
                    }
                     else if (func.name === 'engine_agent_delete') {
                        toolResult = await engineApiHandler('agent_delete', args);
                    }
                     else if (func.name === 'engine_cron_delete') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('cron_delete', args); }
                        } else { toolResult = await engineApiHandler('cron_delete', args); }
                    }
                     else if (func.name === 'server_exec') {
                        // ★ 参数别名容错: AI可能用不同参数名
                        if (!args.cmd && args.command) args.cmd = args.command;
                        if (!args.cmd && args.query) args.cmd = args.query;
                        if (!args.cmd && args.code) args.cmd = args.code;
                        if (!args.cmd) { toolResult = { error: '缺少 cmd 参数。格式: server_exec(cmd="shell命令")' }; }
                        else if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('exec', args); }
                        } else { toolResult = await engineApiHandler('exec', args); }
                    }
                     else if (func.name === 'server_python') {
                        // ★ 参数别名容错: AI可能用不同参数名
                        if (!args.script && args.code) args.script = args.code;
                        if (!args.script && args.query) args.script = args.query;
                        if (!args.script && args.cmd) args.script = args.cmd;
                        if (!args.script) { toolResult = { error: '缺少 script 参数。格式: server_python(script="python代码")' }; }
                        else if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('python', args); }
                        } else { toolResult = await engineApiHandler('python', args); }
                    }
                     else if (func.name === 'server_file_read') {
                        toolResult = await engineApiHandler('file_read', args);
                    }
                     else if (func.name === 'parse_document') {
                        // ★ 文档解析: 调用引擎 parse_document 端点
                        if (!args.path) { toolResult = { error: '缺少 path 参数。格式: parse_document(path="/path/to/file.docx")' }; }
                        else { toolResult = await engineApiHandler('parse_document', args); }
                    }
                    // ═══════════════════════════════════════════════════
                    // ★ 股票数据工具 (A股 — 东方财富数据源)
                    // ═══════════════════════════════════════════════════
                     else if (func.name === 'stock_realtime') {
                        if (!args.symbol) { toolResult = { error: '缺少 symbol 参数。格式: stock_realtime(symbol="000001")' }; }
                        else { toolResult = await engineApiHandler('stock_realtime', args); }
                    }
                     else if (func.name === 'stock_kline') {
                        if (!args.symbol) { toolResult = { error: '缺少 symbol 参数。格式: stock_kline(symbol="000001", period="daily")' }; }
                        else { toolResult = await engineApiHandler('stock_kline', args); }
                    }
                     else if (func.name === 'stock_sector_flow') {
                        toolResult = await engineApiHandler('stock_sector_flow', args || {});
                    }
                     else if (func.name === 'stock_dragon_tiger') {
                        toolResult = await engineApiHandler('stock_dragon_tiger', args || {});
                    }
                     else if (func.name === 'stock_north_flow') {
                        toolResult = await engineApiHandler('stock_north_flow', {});
                    }
                     else if (func.name === 'stock_diagnosis') {
                        if (!args.symbol) { toolResult = { error: '缺少 symbol 参数。格式: stock_diagnosis(symbol="600519")' }; }
                        else { toolResult = await engineApiHandler('stock_diagnosis', args); }
                    }
                     else if (func.name === 'stock_indicators') {
                        if (!args.symbol) { toolResult = { error: '缺少 symbol 参数。格式: stock_indicators(symbol="300750")' }; }
                        else { toolResult = await engineApiHandler('stock_indicators', args); }
                    }
                     else if (func.name === 'stock_chart') {
                        if (!args.symbol) { toolResult = { error: '缺少 symbol 参数。格式: stock_chart(symbol="000001")' }; }
                        else { toolResult = await engineApiHandler('stock_chart', args); }
                    }
                     else if (func.name === 'stock_market_overview') {
                        toolResult = await engineApiHandler('stock_market_overview', {});
                    }
                     else if (func.name === 'server_file_write') {
                        // ★ 参数别名容错
                        if (!args.path && args.file_path) args.path = args.file_path;
                        if (!args.path && args.file) args.path = args.file;
                        if (!args.path && args.filename) args.path = args.filename;
                        if (!args.content && args.text) args.content = args.text;
                        if (!args.content && args.data) args.content = args.data;
                        if (!args.content && args.body) args.content = args.body;
                        if (!args.path) { toolResult = { error: '缺少 path 参数。格式: server_file_write(path="/path/to/file", content="文件内容")' }; }
                        else if (!args.content && args.content !== '') { toolResult = { error: '缺少 content 参数。格式: server_file_write(path="/path/to/file", content="文件内容")' }; }
                        else if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('file_write', args); }
                        } else { toolResult = await engineApiHandler('file_write', args); }
                    }
                     else if (func.name === 'server_file_write_chunked') {
                        // ★ 分块写入大文件: 直接走 MCP (引擎新端点)
                        if (!args.path) { toolResult = { error: '缺少 path 参数' }; }
                        else if (!args.content && args.content !== '') { toolResult = { error: '缺少 content 参数' }; }
                        else { toolResult = await _mcpExecute(func.name, args); }
                    }
                     else if (func.name === 'server_file_edit') {
                        // ★ 参数别名容错
                        if (!args.path && args.file_path) args.path = args.file_path;
                        if (!args.path && args.file) args.path = args.file;
                        if (!args.old_string && args.old_str) args.old_string = args.old_str;
                        if (!args.old_string && args.old) args.old_string = args.old;
                        if (!args.old_string && args.original) args.old_string = args.original;
                        if (!args.new_string && args.new_str) args.new_string = args.new_str;
                        if (!args.new_string && args.new) args.new_string = args.new;
                        if (!args.new_string && args.replacement) args.new_string = args.replacement;
                        if (!args.path) {
                            toolResult = { error: '缺少 path 参数。格式: server_file_edit(path="/path/to/file", old_string="原文", new_string="新文")' };
                        } else if (!args.old_string && !args.old_str) {
                            toolResult = { error: '缺少 old_string 参数' };
                        } else if (!args.new_string && !args.new_str) {
                            toolResult = { error: '缺少 new_string 参数' };
                        } else if (isApprovalMode()) {
                            var _editApproved = await requestToolApproval(func.name, args);
                            if (!_editApproved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('file_edit', args); }
                        } else { toolResult = await engineApiHandler('file_edit', args); }
                    }
                     else if (func.name === 'server_file_grep') {
                        toolResult = await engineApiHandler('file_grep', args);
                    }
                     else if (func.name === 'server_sys_info') {
                        toolResult = await engineApiHandler('sys_info', args);
                    }
                     else if (func.name === 'server_ps') {
                        toolResult = await engineApiHandler('ps', args);
                    }
                     else if (func.name === 'server_disk') {
                        toolResult = await engineApiHandler('disk', args);
                    }
                     else if (func.name === 'server_network') {
                        toolResult = await engineApiHandler('network', args);
                    }
                     else if (func.name === 'server_docker') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('docker', args); }
                        } else { toolResult = await engineApiHandler('docker', args); }
                    }
                     else if (func.name === 'server_db_query') {
                        toolResult = await engineApiHandler('db_query', args);
                    }
                     else if (func.name === 'server_file_search') {
                        toolResult = await engineApiHandler('file_search', args);
                    }
                     else if (func.name === 'server_file_op') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('file_op', args); }
                        } else { toolResult = await engineApiHandler('file_op', args); }
                    }
                     else if (func.name === 'ask_agent') {
                        var reason = args.reason || '执行高级操作';
                        if (isYoloMode()) {
                            toolResult = { result: '✅ 当前已是 YOLO 自主模式,无需再次请求。' };
                        } else if (getAgentMode() === 'agent' || getAgentMode() === 'yolo') {
                            toolResult = { result: '✅ Agent 模式已启用,工具可用。' };
                        } else if (window._tempAgentGranted && window._tempAgentChatId === chatId) {
                            toolResult = { result: '✅ 本轮已获得临时授权,请直接使用工具。' };
                        } else {
                            // ★ 单次授权: 弹窗确认 → 动效 → 临时开放 Agent 工具
                            var _granted = confirm('⚠️ 模型请求临时使用高级工具权限\n\n理由: ' + (args.reason || '执行高级操作') + '\n\n允许后，AI 可在本轮对话中调用文件操作、命令执行、子代理等工具。\n完成后权限自动回收。\n\n是否允许？');
                            if (!_granted) {
                                toolResult = { result: '❌ 用户拒绝了临时授权请求。' };
                            } else {
                                // 清除旧会话的临时授权
                                if (window._tempAgentGranted && window._tempAgentChatId !== chatId) {
                                    _updateTempGrantBanner(false);
                                }
                                window._tempAgentGranted = true;
                                window._tempAgentChatId = chatId;
                                try { sessionStorage.setItem('_tempAgentGranted', '1'); } catch(e) {}
                                try { sessionStorage.setItem('_tempAgentChatId', chatId); } catch(e) {}
                                _updateTempGrantBanner(true);
                                // ★ Agent 模式同款进入动效
                                if (typeof playAgentEnterEffect === 'function') playAgentEnterEffect('agent');
                                // ★ 临时授权无聊天切换: 动画播完即淡出(遮罩无固定自动淡出计时器)
                                if (typeof _dismissOverlayAfter === 'function') _dismissOverlayAfter('agent', null, 700, 1800);
                                toolResult = { result: '✅ 已获得单次授权。\n\n⚠️ 重要规则：\n1. 搜索类任务必须用 delegate_task 创建子代理来执行，禁止直接用 web_search 然后谎称是子代理做的\n2. 子代理创建后请等待系统自动通知结果,禁止调用 engine_agent_status 轮询(会浪费token)\n3. 只有超过2次搜索或需要分析/总结的复杂任务才需要子代理\n4. 简单搜索（≤2次）可以直接用 web_search\n\n可用工具：delegate_task（子代理）、engine_agent_create、web_search、web_fetch、server_exec 等。完成后权限自动回收。' };
                                console.log('[AskAgent] 单次授权已授予, chatId=' + chatId);
                            }
                        }
                    }
                     else if (func.name === 'autonomous_mode') {
                        // ★ 必须在 Agent 或 YOLO 模式下才能切换
                        if (getAgentMode() === 'off') {
                            toolResult = { result: '⚠️ 请先启用 Agent 模式，再启用 YOLO 自主模式。' };
                        } else if (isYoloMode()) {
                            toolResult = { result: '✅ 当前已是 YOLO 自主模式。' };
                        } else {
                            var enabled = args.enabled !== false;
                            if (enabled) {
                                if (confirm('⚠️ 确定启用 YOLO 自主模式？\n\n所有工具操作将自动批准，不再逐一确认。\n此操作需由你亲自点击"确定"。')) {
                                    setAgentMode('yolo');
                                    toolResult = { result: '✅ 已切换到 YOLO 自主模式。' };
                                } else {
                                    toolResult = { result: '❌ 用户取消了 YOLO 模式切换。' };
                                }
                            } else {
                                setAgentMode('agent');
                                toolResult = { result: '🔒 已退出自主模式，恢复为 Agent 交互模式。' };
                            }
                        }
                    }
                     else if (func.name === 'plan_update') {
                        var planAction = args.action || '';
                        // ★ 智能修复: 检测常见错误并给出明确提示
                        if (!planAction || planAction.trim() === '') {
                            toolResult = { error: '❌ plan_update 缺少 action 参数。\n\n正确用法:\n1. 创建计划: plan_update(action="create", tasks=[{"id":"step_1","title":"任务1"},{"id":"step_2","title":"任务2"}])\n2. 更新状态: plan_update(action="update", task_id="step_1", status="running/completed/failed")\n3. 完成计划: plan_update(action="complete")\n\n注意: "running" 是 status 参数的值,不是 action 的值。' };
                        } else if (planAction === 'running' || planAction === 'pending' || planAction === 'completed' || planAction === 'failed') {
                            toolResult = { error: '❌ plan_update 的 action 参数不能是 "' + planAction + '"。\n\n"' + planAction + '" 是 status 参数的值。\n\n正确用法: plan_update(action="update", task_id="步骤ID", status="' + planAction + '")' };
                        } else if (planAction === 'create') {
                            var planTasks = (args.tasks || []).map(function(t, idx) {
                                return {
                                    id: t.id || 'step_' + (idx + 1),
                                    title: t.title || 'Untitled',
                                    description: t.description || '',
                                    status: t.status || 'pending'
                                };
                            });
                            if (planTasks.length === 0) {
                                toolResult = { error: 'tasks array is required and cannot be empty for action=create.' };
                            } else {
                                window._agentPlan = {
                                    tasks: planTasks,
                                    createdAt: Date.now(),
                                    status: 'running',
                                    currentTaskId: null
                                };
                                window.createFlowPanel(window._agentPlan);
                                // ★ Plan 模式: 显示审批横幅，等待用户同意
                                if (typeof getAgentMode === 'function' && getAgentMode() === 'plan') {
                                    window._planState = 'reviewing';
                                    window._createPlanApprovalBanner(planTasks.length);
                                    toolResult = { result: '✅ 已创建计划，共 ' + planTasks.length + ' 个任务。\n\n请向用户展示计划摘要，等待用户审批。用户同意后将自动进入执行阶段。' };
                                } else {
                                    toolResult = { result: '✅ 已创建计划，共 ' + planTasks.length + ' 个任务：\n' + planTasks.map(function(t) { return '- [' + t.status + '] ' + t.title; }).join('\n') + '\n\n现在按计划逐步执行，每完成一步调用 plan_update(action="update", task_id="...", status="completed") 更新状态。' };
                                }
                            }
                        } else if (planAction === 'update') {
                            var tid = args.task_id;
                            var newStatus = args.status;
                            // ★ 如果参数缺失，尝试从原始参数字符串中提取
                            if ((!tid || !newStatus) && typeof tc !== 'undefined' && tc.function) {
                                var _raw = typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments || {});
                                if (!tid) { var _tm = _raw.match(/"task_id"\s*:\s*"([^"]+)"/); if (_tm) tid = _tm[1]; }
                                if (!newStatus) { var _sm = _raw.match(/"status"\s*:\s*"([^"]+)"/); if (_sm) newStatus = _sm[1]; }
                            }
                            if (!tid || !newStatus) {
                                // ★ 智能修复: 尝试从截断的 task_id 匹配现有计划
                                if (tid && typeof tid === 'string' && tid.length >= 3 && window._agentPlan && window._agentPlan.tasks) {
                                    var _matched = null;
                                    window._agentPlan.tasks.forEach(function(pt) {
                                        if (pt.id.indexOf(tid) === 0) _matched = pt.id;
                                    });
                                    if (_matched) { tid = _matched; console.log('[plan_update] 自动修复 task_id: "' + args.task_id + '" → "' + tid + '"'); }
                                }
                                // 如果 status 缺失但 task_id 修复成功，尝试推断 status
                                if (tid && !newStatus) {
                                    // 查找当前计划中该任务，如果状态是 pending 则设为 running
                                    if (window._agentPlan && window._agentPlan.tasks) {
                                        window._agentPlan.tasks.forEach(function(pt) {
                                            if (pt.id === tid) {
                                                newStatus = pt.status === 'pending' ? 'running' : 'completed';
                                            }
                                        });
                                    }
                                    if (!newStatus) newStatus = 'completed'; // 兜底
                                }
                            }
                            if (!tid || !newStatus) {
                                toolResult = { error: 'task_id and status are required for action=update. 收到: task_id=' + JSON.stringify(args.task_id) + ', status=' + JSON.stringify(args.status) + '. 请用 plan_update(action="update", task_id="task_X", status="running/completed/failed") 格式调用。如果 task_id 被截断，请缩短其他工具调用参数以腾出空间。' };
                            } else if (window._agentPlan && window._agentPlan.tasks) {
                                var found = false;
                                window._agentPlan.tasks.forEach(function(t) {
                                    if (t.id === tid) {
                                        t.status = newStatus;
                                        if (args.note) t.note = args.note;
                                        if (newStatus === 'running') window._agentPlan.currentTaskId = tid;
                                        found = true;
                                    }
                                });
                                if (found) {
                                    window.updatePlanTaskStatus(tid, newStatus);
                                    window._autoDismissIfAllDone();
                                    toolResult = { result: '✅ 任务 "' + tid + '" 状态更新为 ' + newStatus + '。' };
                                } else {
                                    toolResult = { error: '未找到任务 "' + tid + '" 。当前计划中的任务ID: ' + window._agentPlan.tasks.map(function(t){return t.id;}).join(', ') };
                                }
                            } else {
                                toolResult = { error: '没有活跃计划。请先用 action=create 创建计划。' };
                            }
                        } else if (planAction === 'running') {
                            // ★ action="running" 是常见误用，自动转换为 update + 自动选择第一个 pending 任务
                            if (window._agentPlan && window._agentPlan.tasks) {
                                var _firstPending = null;
                                window._agentPlan.tasks.forEach(function(t) {
                                    if (!_firstPending && t.status === 'pending') _firstPending = t;
                                });
                                if (_firstPending) {
                                    _firstPending.status = 'running';
                                    window._agentPlan.currentTaskId = _firstPending.id;
                                    window.updatePlanTaskStatus(_firstPending.id, 'running');
                                    toolResult = { result: '✅ 自动开始任务 "' + _firstPending.id + '": ' + _firstPending.title + '。\n提示: plan_update 的 action 参数只支持 create/update/complete。"running" 是 status 参数的值。' };
                                } else {
                                    toolResult = { error: '没有待执行(pending)的任务。可用 plan_update(action="update", task_id="X", status="running") 指定具体任务。' };
                                }
                            } else {
                                toolResult = { error: '没有活跃计划。请先用 action=create 创建计划。\n提示: "running" 是任务状态(status字段)，不是 action 字段。action 只支持: create, update, complete。' };
                            }
                        } else if (planAction === 'complete') {
                            if (window._agentPlan) {
                                window._agentPlan.status = 'completed';
                                // 将所有未终态的任务标记为 completed
                                window._agentPlan.tasks.forEach(function(t) {
                                    if (t.status === 'pending' || t.status === 'running') t.status = 'completed';
                                });
                                window.renderPlanTasks(window._agentPlan.tasks);
                                // ★ Plan 模式: 完成后重置审批状态
                                if (typeof getAgentMode === 'function' && getAgentMode() === 'plan') {
                                    window._planState = 'exploring';
                                    window._planApproved = false;
                                }
                                setTimeout(function() { window.dismissFlowPanel(); }, 2500);
                                toolResult = { result: '✅ 计划已完成，所有任务已标记为完成。面板将在几秒后自动关闭。' };
                            } else {
                                toolResult = { error: '没有活跃计划可完成。' };
                            }
                        } else {
                            toolResult = { error: '❌ plan_update 不支持 action="' + planAction + '"。\n\n支持的 action: create, update, complete。\n\n示例:\n- 创建: plan_update(action="create", tasks=[{"id":"t1","title":"搜索资料"},{"id":"t2","title":"整理输出"}])\n- 更新: plan_update(action="update", task_id="t1", status="completed")\n- 完成: plan_update(action="complete")' };
                        }
                    }
                     else if (func.name === 'engine_agent_ask') {
                        // ★ 传递网络代理配置
                        var _askArgs = Object.assign({}, args);
                        if (window.isProxyEnabled && window.isProxyEnabled() && window.getProxyUrl && window.getProxyUrl()) {
                            _askArgs.proxy_url = window.getProxyUrl();
                            _askArgs.proxy_enabled = '1';
                        }
                        toolResult = await engineApiHandler('agent_ask', _askArgs);
                    }
                     else if (func.name === 'engine_agent_stop') {
                        toolResult = await engineApiHandler('agent_stop', args);
                    }
                     else if (func.name === 'engine_push') {
                        let _pushMsg = args.msg || '';
                        var _pushFile = args.file || '';
                        if (_pushFile) {
                            try {
                                var _pRes = await fetch(_apiBase + '?action=push_file&path=' + encodeURIComponent(_pushFile) + '&auth_token=' + (localStorage.getItem('authToken')||''));
                                var _pData = await _pRes.json();
                                if (_pData.ok && _pData.url) {
                                    // ★ 直接追加在 tool_result 中, 并注入到 pendingMsg.content
                                    _pushMsg += '\n📥 ' + _pData.url;
                                    if (pendingMsg) {
                                        pendingMsg.content = (pendingMsg.content || '') + '\n📥 ' + _pData.url;
                                    }
                                } else {
                                    _pushMsg += '\n⚠️ 文件无法分享: ' + (_pData.error || '文件不存在');
                                }
                            } catch(e) { _pushMsg += '\n⚠️ 文件分享异常: ' + e.message; }
                        }
                        toolResult = { result: '✅ ' + _pushMsg };
                    }
                    // ===== toggle_proxy — AI 自主控制代理开关(弹窗确认) =====
                     else if (func.name === 'toggle_proxy') {
                        var _action = (args.action || 'on').toLowerCase();
                        if (_action === 'on') {
                            if (window.isProxyEnabled && window.isProxyEnabled()) {
                                toolResult = { result: '⚠️ 代理已经是开启状态' };
                            } else {
                                // ★ 必须先设置 localStorage, 弹窗确认后再同步 UI
                                var _confirmed = confirm('🤖 AI 请求开启网络代理\n\n' +
                                    '原因: 访问境外网站遇到网络限制,需要开启代理穿透。\n' +
                                    '代理 URL: ' + (window.getProxyUrl ? window.getProxyUrl() : '未配置') + '\n\n' +
                                    '点击 "确定" 开启代理, "取消" 拒绝。');
                                if (_confirmed) {
                                    localStorage.setItem('proxyEnabled', '1');
                                    if (typeof setChecked === 'function') setChecked('proxyToggle', true);
                                    if (typeof window.saveConfig === 'function') window.saveConfig(false);
                                    if (typeof window.toggleProxy === 'function') {
                                        // toggleProxy 会清空 CORS 缓存并保存
                                        setChecked('proxyToggle', true);
                                        window.toggleProxy();
                                    }
                                    toolResult = { result: '✅ 代理已开启。后续网络请求将通过代理转发。' };
                                } else {
                                    toolResult = { result: '❌ 用户拒绝了开启代理的请求。' };
                                }
                            }
                        } else if (_action === 'off') {
                            localStorage.setItem('proxyEnabled', '0');
                            if (typeof setChecked === 'function') setChecked('proxyToggle', false);
                            if (typeof window.saveConfig === 'function') window.saveConfig(false);
                            // ★ 清空 CORS 缓存, 下次可重新尝试直连
                            window._corsBlockedDomains = {};
                            toolResult = { result: '✅ 代理已关闭。已恢复直连模式。' };
                        } else {
                            toolResult = { result: '❌ 无效的操作: ' + _action + ', 必须是 on 或 off' };
                        }
                    }
                    // ===== Cloudreve 云盘工具 =====
                     else if (func.name === 'cr_check_login') {
                        toolResult = await cloudreveApiHandler('check_login', args);
                     }
                     else if (func.name === 'cr_register') {
                        toolResult = await cloudreveApiHandler('register', args);
                     }
                     else if (func.name === 'cr_login') {
                        toolResult = await cloudreveApiHandler('login', args);
                     }
                     else if (func.name === 'cr_user_info') {
                        toolResult = await cloudreveApiHandler('user_info', args);
                     }
                     else if (func.name === 'cr_list_files') {
                        toolResult = await cloudreveApiHandler('list_files', args);
                     }
                     else if (func.name === 'cr_search_files') {
                        toolResult = await cloudreveApiHandler('search_files', args);
                     }
                     else if (func.name === 'cr_create_folder') {
                        toolResult = await cloudreveApiHandler('create_folder', args);
                     }
                     else if (func.name === 'cr_rename') {
                        toolResult = await cloudreveApiHandler('rename', args);
                     }
                     else if (func.name === 'cr_move') {
                        toolResult = await cloudreveApiHandler('move', args);
                     }
                     else if (func.name === 'cr_copy') {
                        toolResult = await cloudreveApiHandler('copy', args);
                     }
                     else if (func.name === 'cr_delete') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了删除操作' }; }
                            else { toolResult = await cloudreveApiHandler('delete', args); }
                        } else { toolResult = await cloudreveApiHandler('delete', args); }
                     }
                     else if (func.name === 'cr_upload') {
                        toolResult = await cloudreveApiHandler('upload', args);
                     }
                     else if (func.name === 'cr_upload_file') {
                        toolResult = await cloudreveApiHandler('upload_file', args);
                     }
                     else if (func.name === 'cr_list_shares') {
                        toolResult = await cloudreveApiHandler('list_shares', args);
                     }
                     else if (func.name === 'cr_create_share') {
                        toolResult = await cloudreveApiHandler('create_share', args);
                     }
                     else if (func.name === 'cr_delete_share') {
                        toolResult = await cloudreveApiHandler('delete_share', args);
                     }
                     else if (func.name === 'cr_storage_info') {
                        toolResult = await cloudreveApiHandler('storage_info', args);
                     }
                     else if (func.name === 'cr_overview') {
                        toolResult = await cloudreveApiHandler('overview', args);
                     }
                    // ===== 高德地图工具 =====
                     else if (func.name === 'amap_geo') {
                        toolResult = await amapApiHandler('geo', args);
                     }
                     else if (func.name === 'amap_regeocode') {
                        toolResult = await amapApiHandler('regeocode', args);
                     }
                     else if (func.name === 'amap_text_search') {
                        toolResult = await amapApiHandler('text_search', args);
                     }
                     else if (func.name === 'amap_around_search') {
                        toolResult = await amapApiHandler('around_search', args);
                     }
                     else if (func.name === 'amap_direction_bicycling') {
                        toolResult = await amapApiHandler('direction_bicycling', args);
                     }
                     else if (func.name === 'amap_distance') {
                        toolResult = await amapApiHandler('distance', args);
                     }
                     else if (func.name === 'amap_search_detail') {
                        toolResult = await amapApiHandler('search_detail', args);
                     }
                     else if (func.name === 'amap_direction_walking') {
                        toolResult = await amapApiHandler('direction_walking', args);
                     }
                     else if (func.name === 'amap_direction_driving') {
                        toolResult = await amapApiHandler('direction_driving', args);
                     }
                     else if (func.name === 'amap_direction_transit') {
                        toolResult = await amapApiHandler('direction_transit', args);
                     }
                     else if (func.name === 'amap_ip_location') {
                        toolResult = await amapApiHandler('ip_location', args);
                     }
                     else if (func.name === 'amap_weather') {
                        toolResult = await amapApiHandler('weather', args);
                     }
                     else if (func.name === 'amap_district') {
                        toolResult = await amapApiHandler('district', args);
                     }
                     else if (func.name === 'amap_schema_personal_map') {
                        toolResult = await amapApiHandler('schema_personal_map', args);
                     }
                    // ===== 网盘解析工具 =====
                     else if (func.name === 'netdisk_parse') {
                        toolResult = await netdiskApiHandler('parse', args);
                     }
                     else if (func.name === 'netdisk_download') {
                        toolResult = await netdiskApiHandler('download', args);
                     }
                     else if (func.name === 'netdisk_parse_and_download') {
                        toolResult = await netdiskApiHandler('parse_and_download', args);
                     }
                     else if (func.name === 'netdisk_status') {
                        toolResult = await netdiskApiHandler('status', args);
                     }
                    // ===== 视频猎手 Video Hunter (B站下载/BT磁力/云盘) =====
                     else if (func.name.startsWith('video_') || func.name.startsWith('bili_')) {
                        // 视频猎手工具 → MCP代理 (统一走 mcp_proxy)
                        toolResult = await _mcpExecute(func.name, args);
                     }
                    // ★ SRC 星穹铁道工具已移除 (功能弃用, 入口改为 Cloudreve 云盘)
                    // ===== Windows 本机工具 =====
                     else if (func.name === 'win_info') {
                        var cmd = WIN_POWERSHELL + ' -Command "systeminfo"';
                        toolResult = await engineApiHandler('exec', { cmd: cmd, timeout: 15 });
                    }
                     else if (func.name === 'win_processes') {
                        var filter = (args.filter || '').replace(/[^a-zA-Z0-9._-]/g, '');
                        var psCmd = filter
                            ? WIN_POWERSHELL + ' -Command "Get-Process ' + filter + ' -ErrorAction SilentlyContinue | Format-Table Name,Id,CPU,WorkingSet -AutoSize | Out-String -Width 200"'
                            : WIN_POWERSHELL + ' -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 | Format-Table Name,Id,CPU,WorkingSet -AutoSize | Out-String -Width 200"';
                        toolResult = await engineApiHandler('exec', { cmd: psCmd, timeout: 10 });
                    }
                     else if (func.name === 'win_kill') {
                        var _target, killCmd;
                        if (args.pid) {
                            _target = String(args.pid).replace(/[^0-9]/g, '');
                            killCmd = WIN_POWERSHELL + ' -Command "Stop-Process -Id ' + _target + ' -Force -ErrorAction SilentlyContinue; Write-Output done"';
                        } else {
                            _target = (args.name || '').replace(/[^a-zA-Z0-9._-]/g, '');
                            killCmd = WIN_POWERSHELL + ' -Command "Stop-Process -Name ' + _target + ' -Force -ErrorAction SilentlyContinue; Write-Output done"';
                        }
                        if (!_target) { toolResult = { error: '请提供进程名(name)或进程ID(pid)' }; }
                        else {
                            toolResult = await engineApiHandler('exec', { cmd: killCmd, timeout: 10 });
                        }
                    }
                     else if (func.name === 'win_start') {
                        var path = (args.path || '').replace(/'/g, '');
                        var app = (args.app || '').replace(/['"\\]/g, '');
                        var startCmd;
                        if (app) {
                            // ★ 中文应用名用 base64 编码防止编码问题
                            var _encodedApp = btoa(unescape(encodeURIComponent(app)));
                            startCmd = WIN_POWERSHELL + ' -Command "' + String.fromCharCode(36) + 'n=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(\'' + _encodedApp + '\')); Start-Process \"shell:AppsFolder\\' + String.fromCharCode(36) + 'n\"; Write-Output started"';
                        } else if (path) {
                            startCmd = WIN_POWERSHELL + ' -Command "Start-Process \"' + path + '\"; Write-Output started"';
                        } else {
                            toolResult = { error: '请提供 path(程序路径) 或 app(应用名)' };
                        }
                        if (startCmd) toolResult = await engineApiHandler('exec', { cmd: startCmd, timeout: 10 });
                    }
                     else if (func.name === 'win_restart') {
                        var name = (args.name || '').replace(/[^a-zA-Z0-9._-]/g, '');
                        var path2 = (args.path || '').replace(/'/g, '');
                        var app2 = (args.app || '').replace(/['"\\]/g, '');
                        let restartCmd = WIN_POWERSHELL + ' -Command "Stop-Process -Name ' + name + ' -Force -ErrorAction SilentlyContinue; Start-Sleep 2';
                        if (app2) {
                            var _encodedApp2 = btoa(unescape(encodeURIComponent(app2)));
                            restartCmd += '; ' + String.fromCharCode(36) + 'n=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(\'' + _encodedApp2 + '\')); Start-Process \"shell:AppsFolder\\' + String.fromCharCode(36) + 'n\"';
                        }
                        else if (path2) restartCmd += '; Start-Process \"' + path2 + '\"';
                        restartCmd += '; Write-Output restarted"';
                        toolResult = await engineApiHandler('exec', { cmd: restartCmd, timeout: 15 });
                    }
                     else if (func.name === 'win_file') {
                        var action = args.action || 'list';
                        var wslPath = (args.path || '/mnt/c/').replace(/\\/g, '/');
                        // ★ 自动转换 Windows 路径 → WSL 路径
                        if (!wslPath.startsWith('/mnt/')) {
                            var _driveMatch = wslPath.match(/^([A-Z]):/i);
                            if (_driveMatch) {
                                wslPath = '/mnt/' + _driveMatch[1].toLowerCase() + wslPath.substring(2);
                            } else if (wslPath.startsWith('/') && !wslPath.startsWith('/mnt/')) {
                                wslPath = '/mnt/c' + wslPath;
                            } else if (!wslPath.startsWith('/')) {
                                wslPath = '/mnt/c/Users/' + (args.user || 'AS') + '/Desktop/' + wslPath;
                            }
                        }
                        if (!wslPath.startsWith('/mnt/')) { toolResult = { result: '⚠️ 路径格式不支持: ' + wslPath }; }
                        else if (action === 'list') {
                            // ★ 使用单引号包裹路径避免转义问题
                            toolResult = await engineApiHandler('exec', { cmd: "ls -la '" + wslPath.replace(/'/g, "'\\''") + "' 2>&1 | head -50", timeout: 5 });
                        } else if (action === 'read') {
                            toolResult = await engineApiHandler('exec', { cmd: "cat '" + wslPath.replace(/'/g, "'\\''") + "' 2>&1 | head -200", timeout: 5 });
                        } else { toolResult = { error: 'action 仅支持 list/read' }; }
                    }
                     else if (func.name === 'win_screenshot') {
                        var fmt = (args.format || 'png').replace(/[^a-z]/g, '');
                        if (fmt !== 'png' && fmt !== 'jpg') fmt = 'png';
                        var _ts = Date.now();
                        // ★ 使用 Windows 临时目录（PowerShell 原生路径，避免 WSL 转义问题）
                        var _outPath = 'C:\\\\Windows\\\\Temp\\\\screenshot_' + _ts + '.' + fmt;
                        var _imgFmt = fmt === 'png' ? 'Png' : 'Jpeg';
                        var ssCmd = WIN_POWERSHELL + ' -Command "Add-Type -AssemblyName System.Windows.Forms; $b=New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size); $b.Save(\\\\\"' + _outPath + '\\\\\",[System.Drawing.Imaging.ImageFormat]::' + _imgFmt + '); $b.Dispose(); $g.Dispose(); Write-Output done"';
                        var r = await engineApiHandler('exec', { cmd: ssCmd, timeout: 15 });
                        // 返回可访问的 URL
                        toolResult = { result: '✅ 截图已保存: ' + _outPath + '\n可通过 server_file_read 读取或直接在浏览器打开: /file?path=' + encodeURIComponent(_outPath) };
                    }
// ===== 浏览器工具 =====
                     else if (func.name === 'browser_navigate') {
                        toolResult = await engineApiHandler('browser_navigate', args);
                    }
                     else if (func.name === 'browser_screenshot') {
                        toolResult = await engineApiHandler('browser_screenshot', args);
                        // ★ 截图上传统一托管，嵌入回复气泡
                        if (toolResult && toolResult.image && currentChatId === chatId) {
                            var _shotUrl = toolResult.image;
                            // 上传 base64 到服务器获取短 URL
                            if (_shotUrl.startsWith('data:')) {
                                try {
                                    var _uploaded = await uploadImageToServer(_shotUrl);
                                    if (_uploaded) _shotUrl = _uploaded;
                                } catch(e) { console.warn('[browser_screenshot] 上传失败，使用原始 data URL'); }
                            }
                            // ★ 内联到当前回复气泡尾部（不创建独立气泡）
                            var _imgTag = '![截图](' + _shotUrl + ')';
                            // 追加到 pendingMsg.content 以持久化
                            if (pendingMsg && pendingMsg.chatId === chatId) {
                                pendingMsg.content = (pendingMsg.content || '') + '\n\n📸 浏览器截图\n\n' + _imgTag;
                            }
                            // 追加到 DOM（当前气泡尾部）
                            var _img = document.createElement('img');
                            _img.src = _shotUrl;
                            _img.style.cssText = 'max-width:100%;border-radius:8px;margin-top:8px;cursor:pointer;';
                            _img.onclick = function() { window.open(this.src, '_blank'); };
                            var _b = activeBubbleMap[chatId];
                            if (_b) { var _md = _b.querySelector('.markdown-body'); if (_md) _md.appendChild(_img); else _b.appendChild(_img); }
                        }
                    }
                     else if (func.name === 'browser_click') {
                        toolResult = await engineApiHandler('browser_click', args);
                    }
                     else if (func.name === 'browser_type') {
                        toolResult = await engineApiHandler('browser_type', args);
                    }
                     else if (func.name === 'browser_get_content') {
                        toolResult = await engineApiHandler('browser_get_content', args);
                    }
                     else if (func.name === 'browser_get_snapshot') {
                        toolResult = await engineApiHandler('browser_get_snapshot', args);
                    }
                     else if (func.name === 'delegate_task') {
                        _hasCreatedSubAgent = true;
                        var taskArgs = args || {};
                        var tName = taskArgs.name || 'agent_' + Date.now();
                        var tTask = taskArgs.task || '';
                        var tRole = taskArgs.role || 'general';
                        var tPrompt = taskArgs.prompt || '';
                        // ★ 关联到当前任务
                        var _curTaskId = window._lastMsgTaskId || window._currentTaskId;
                        console.log('[delegate_task] _curTaskId=' + _curTaskId + ' _lastMsgTaskId=' + window._lastMsgTaskId + ' _currentTaskId=' + window._currentTaskId);
                        if (_curTaskId && typeof window.addAgentToTask === 'function') {
                            window.addAgentToTask(_curTaskId, tName, tRole);
                        }
                        var tTask = taskArgs.task || '';
                        var tRole = taskArgs.role || 'general';
                        var tPrompt = taskArgs.prompt || '';
                        var fullPrompt = tPrompt || '';
                        var _taskDetail = tTask || '';
                        if (!fullPrompt && _taskDetail) {
                            // 纯 task 模式: 基于 task 生成详细 prompt
                            fullPrompt = '## 你的任务\n' + _taskDetail + '\n\n' +
                                '## 执行指南\n' +
                                '1. 分析任务需求，确定搜索关键词或读取目标\n' +
                                '2. 使用工具获取信息（web_search / server_file_read 等）\n' +
                                '3. 整理分析获取的信息，提取关键发现\n' +
                                '4. 输出结构化结果报告\n\n' +
                                '## 输出要求\n' +
                                '- 结果要具体、有数据支撑\n' +
                                '- 搜索不足时说明搜了什么关键词、找到了什么\n' +
                                '- 用中文输出，条理清晰\n\n' +
                                '## ⚠️ 完成后\n' +
                                '任务完成后用 engine_push 推送结果摘要给用户。';
                        } else if (tPrompt && _taskDetail) {
                            // 两者都有: 合并 task 到 prompt 末尾
                            fullPrompt = tPrompt + '\n\n## 当前任务\n' + _taskDetail + '\n\n完成后请用 engine_push 推送结果。';
                        } else if (tPrompt && !_taskDetail) {
                            // 只有 prompt: 直接使用，追加推送要求
                            fullPrompt = tPrompt + '\n\n完成后请用 engine_push 推送结果。';
                        } else {
                            fullPrompt = ''; // 无有效输入
                        }
                        if (fullPrompt) {
                            // ★ 传递网络代理配置到子代理
                            var _proxyConfig = {};
                            if (window.isProxyEnabled && window.isProxyEnabled() && window.getProxyUrl && window.getProxyUrl()) {
                                _proxyConfig = {
                                    proxy_url: window.getProxyUrl(),
                                    proxy_enabled: '1'
                                };
                            }
                            if (typeof window.engineApiHandler === 'function') {
                                var _cr = await window.engineApiHandler('agent_create', {
                                    name: tName,
                                    prompt: fullPrompt,
                                    role: tRole,
                                    proxy_url: _proxyConfig.proxy_url || '',
                                    proxy_enabled: _proxyConfig.proxy_enabled || ''
                                });
                                // 检查创建是否成功
                                if (_cr && _cr.error) {
                                    toolResult = { error: '子代理创建失败: ' + _cr.error };
                                } else {
                                    // 等引擎注册完成再启动
                                    await new Promise(function(r) { setTimeout(r, 300); });
                                    await window.engineApiHandler('agent_run', {
                                        name: tName
                                    });
                                    console.log('[delegate_task] 子代理已创建并启动: ' + tName);
                                    toolResult = { result: '✅ 子代理「' + tName + '」已创建并启动(角色:' + tRole + ')\n\n⚠️ 禁止用 engine_agent_status 轮询! 子代理完成后会自动推送结果给你。现在请等待或做其他不冲突的事，不要主动查询子代理状态。' };
                                }
                            } else {
                                toolResult = { error: '引擎不可用' };
                            }
                        } else {
                            toolResult = { error: '请提供任务描述' };
                        }
                    } else if (func.name === 'delegate_workflow') {
                        var _wfSteps = args.steps;
                        var _wfName = args.name || ('wf_' + Date.now());
                        if (_wfSteps && _wfSteps.length > 0) {
                            if (currentChatId === chatId) {
                                var _cb2 = activeBubbleMap[chatId];
                                if (_cb2) {
                                    var _st2 = _cb2.querySelector('.search-status');
                                    if (!_st2) { _st2 = document.createElement('div'); _st2.className = 'search-status'; _cb2.querySelector('.markdown-body')?.appendChild(_st2); }
                                    _st2.textContent = '🔄 工作流「' + _wfName + '」启动中 (' + _wfSteps.length + '步)...';
                                }
                            }
                            try {
                                var _wfCreated = [];
                                var _wfErrors = [];
                                // ★ 工作流也传递代理配置
                                var _wfProxy = {};
                                if (window.isProxyEnabled && window.isProxyEnabled() && window.getProxyUrl && window.getProxyUrl()) {
                                    _wfProxy = { proxy_url: window.getProxyUrl(), proxy_enabled: '1' };
                                }
                                for (var _si = 0; _si < _wfSteps.length; _si++) {
                                    var _step = _wfSteps[_si];
                                    var _sName = _wfName + '_s' + (_si + 1);
                                    var _sPrompt = _step.prompt;
                                    // ★ 依赖步骤: 只能用上一步结果(异步通知到达后才有)
                                    // 后续步骤的 prompt 应自包含, 不要依赖 {step_N} 变量
                                    var _cr = await engineApiHandler('agent_create', {
                                        name: _sName,
                                        prompt: _sPrompt,
                                        role: _step.role || 'general',
                                        model: localStorage.getItem('model') || 'deepseek-chat',
                                        proxy_url: _wfProxy.proxy_url || '',
                                        proxy_enabled: _wfProxy.proxy_enabled || ''
                                    });
                                    if (_cr && _cr.error) {
                                        _wfErrors.push('步骤' + (_si+1) + '创建失败: ' + _cr.error);
                                        break;
                                    }
                                    await new Promise(function(r) { setTimeout(r, 300); });
                                    await engineApiHandler('agent_run', { name: _sName });
                                    _wfCreated.push(_sName);
                                    console.log('[delegate_workflow] 步骤' + (_si+1) + '/' + _wfSteps.length + ' 已启动: ' + _sName);
                                }
                                var _wfCount = _wfCreated.length;
                                toolResult = { result: '✅ 工作流「' + _wfName + '」已启动 (' + _wfCount + '/' + _wfSteps.length + '步)\n' +
                                    _wfSteps.map(function(s,i){return (i+1)+'. ['+s.role+'] '+s.prompt.substring(0,60);}).join('\n') +
                                    (_wfErrors.length > 0 ? '\n\n⚠️ 错误: ' + _wfErrors.join('; ') : '') +
                                    '\n\n📌 子代理列表: ' + _wfCreated.join(', ') +
                                    '\n⚠️ 每个子代理独立运行、独立推送结果。步骤间没有上下文传递(异步执行)，所以后续步骤的prompt必须自包含。' +
                                    '\n⚠️ 推荐≤2步，≥3步建议改用多次 delegate_task 手动编排。' +
                                    '\n⚠️ 禁止轮询 engine_agent_status! 等待推送即可。' };
                            } catch (e) {
                                toolResult = { error: e.message };
                            }
                        } else {
                            toolResult = { error: '请提供 steps 数组(每步含 role 和 prompt)' };
                        }
                    }
                     else if (func.name === 'generate_image') {
    let prompt = args.prompt;
    if (prompt) {
        if (currentChatId === chatId) {
            var currentBubble = activeBubbleMap[chatId];
            if (currentBubble) {
                let status = currentBubble.querySelector('.search-status');
                if (!status) {
                    status = document.createElement('div');
                    status.className = 'search-status';
                    currentBubble.querySelector('.markdown-body')?.appendChild(status);
                }
                // ★ 并行模式: 跳过个体占位符 (由 main.js 统一显示并行状态)
                if (window.__parallelToolActive) {
                    status.textContent = '🎨 并行生成中...';
                } else {
                    status.textContent = '🎨 正在生成图片...';

                    // ★ 添加图片占位符: 先清除旧占位符,避免重复
                    var _oldPh = currentBubble.querySelector('#image-placeholder');
                    if (_oldPh) _oldPh.remove();
                    var placeholder = document.createElement('div');
                    placeholder.id = 'image-placeholder';
                    placeholder.style = 'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:12px;padding:40px 20px;text-align:center;margin:12px 0;color:white;animation:pulse 2s infinite;';
                    placeholder.innerHTML = '<img src="./src/remi/creating.gif" style="width:64px;height:64px;border-radius:12px;margin:0 auto 12px;display:block;object-fit:cover;" alt="蕾米创作中"><div style="font-size:14px;">图片生成中' + ((args.n || 1) > 1 ? ' (' + (args.n || 1) + '张)' : '') + ',请稍候...</div><div style="font-size:12px;margin-top:8px;opacity:0.8;">' + escapeHtml(prompt.substring(0, 30)) + '...</div>';
                    currentBubble.querySelector('.markdown-body')?.appendChild(placeholder);
                }
            }
        }

        try {
            // ★ 安全规则: n>1(多张)时自动丢弃 seed,防止所有图一模一样
            var _safeSeed = args.seed;
            var _safeN = args.n || 1;
            if (_safeN > 1 && _safeSeed !== undefined) {
                _safeSeed = undefined;
            }
            var imageResult = await window.generateImage(prompt, {
                model: args.model,
                style: args.style,
                aspect_ratio: args.aspect_ratio,
                image_size: args.image_size,
                seed: _safeSeed,
                n: _safeN,
                prompt_optimizer: args.prompt_optimizer,
                aigc_watermark: args.aigc_watermark
            });

            if (imageResult) {
                // ★ 累积所有图片(支持多次调用) — 新格式: 带元数据的对象
                if (!pendingMsg.generatedImages) pendingMsg.generatedImages = [];
                var _imgUrlsFinal = typeof imageResult === 'string' ? [imageResult] : imageResult;
                var _imgOpts = {
                    model: args.model || localStorage.getItem('imageModel_' + (localStorage.getItem('imageProvider') || 'minimax')) || '',
                    aspect_ratio: args.aspect_ratio || '1:1'
                };
                for (var _giF = 0; _giF < _imgUrlsFinal.length; _giF++) {
                    var _imgF = _imgUrlsFinal[_giF];
                    // ★ 新格式: 存储带元数据的对象 {url, prompt, model, aspect_ratio, timestamp}
                    var _metaObj = window.buildImageMeta(_imgF, prompt, _imgOpts);
                    pendingMsg.generatedImages.push(_metaObj);
                    if (_giF === 0) pendingMsg.generatedImage = _metaObj;
                    // 异步上传到服务器,上传成功后替换为服务器URL(避免localStorage溢出)
                    if (_imgF && !_imgF.startsWith(window.location.origin) && !_imgF.startsWith('/oneapichat')) {
                        (function(_origUrl, _idx, _meta) {
                            uploadImageToServer(_origUrl).then(function(srvUrl) {
                                if (srvUrl) {
                                    console.log('[Image] 已上传生成图片:', srvUrl);
                                    // ★ 替换对象中的 url 字段
                                    _meta.url = srvUrl;
                                    if (pendingMsg.generatedImage === _meta) pendingMsg.generatedImage = _meta;
                                    // ★ 同步到 chats 消息对象
                                    var _msgIdx = chats[chatId] && chats[chatId].messages ? chats[chatId].messages.findIndex(function(m) { return m === pendingMsg; }) : -1;
                                    if (_msgIdx !== -1) {
                                        var _cm = chats[chatId].messages[_msgIdx];
                                        if (_cm.generatedImages && _cm.generatedImages[_idx] === _meta) _cm.generatedImages[_idx] = _meta;
                                        if (_cm.generatedImage === _meta) _cm.generatedImage = _meta;
                                    }
                                    // ★ 图片URL替换后立即保存,防止刷新丢失
                                    slimSaveChats();
                                }
                            }).catch(function(e) {
                                console.warn('[Image] 上传生成图片失败:', e.message);
                            });
                        })(_imgF, _giF, _metaObj);
                    }
                }
                slimSaveChats();


                // ★ 立即清除图片生成占位蒙版和 loading 指示器
                try {
                    var _giBub = activeBubbleMap[chatId];
                    if (_giBub) {
                        var _giPh = _giBub.querySelector('#image-placeholder');
                        if (_giPh) _giPh.remove();
                        _giBub.classList.remove('typing');
                    }
                } catch(_giPhErr) {}
                slimSaveChats();
                toolResult = { result: '\u2705 ' + _imgUrlsFinal.length + '\u5f20\u56fe\u7247\u5df2\u751f\u6210' };
            } else {
                toolResult = { result: '[\u56fe\u7247\u751f\u6210\u5931\u8d25]' };
            }
        } catch (e) {
            console.error('[generate_image error]', e.message);
            toolResult = { error: e.message };
            // 替换占位符为错误提示
            if (currentChatId === chatId) {
                var currentBubble = activeBubbleMap[chatId];
                if (currentBubble) {
                    var ph = currentBubble.querySelector('#image-placeholder');
                    if (ph) {
                        ph.innerHTML = '<div style="font-size:24px;margin-bottom:8px;">❌</div><div style="font-size:14px;font-weight:bold;">图片生成失败</div><div style="font-size:12px;color:#666;margin-top:8px;">' + escapeHtml(e.message) + '</div>';
                        ph.style.background = '#fee2e2';
                        ph.style.color = '#dc2626';
                    }
                    let status = currentBubble.querySelector('.search-status');
                    if (status) status.textContent = '❌ 图片生成失败';
                }
            }
        }
    } else {
        toolResult = { error: 'Missing prompt parameter' };
    }
                    } else if (func.name === 'generate_image_i2i') {
                        var userPrompt = args.prompt;
                        let primaryImage = args.image;

                        // ★ 找出当前聊天中用户上传的图片(支持多张参考图)
                        var _allImages = [];
                        // 优先从 chat 级变量获取(当前聊天专属)
                        var _chatImages = window._currentMessageImagesByChat && window._currentMessageImagesByChat[chatId];
                        if (_chatImages && _chatImages.length > 0) {
                            _allImages = _chatImages.filter(function(f) {
                                return f.isImage || (f.type && f.type.startsWith('image/'));
                            });
                        }
                        // 其次从 pendingFiles 获取
                        if (!_allImages.length && pendingFiles && pendingFiles.length > 0) {
                            _allImages = pendingFiles.filter(function(f) {
                                return f.isImage || (f.type && f.type.startsWith('image/'));
                            });
                        }
                        // 最后从聊天历史中获取(用户上传或AI生成的图片)
                        if (!_allImages.length && chatId && chats[chatId]) {
                            var msgs = chats[chatId].messages;
                            for (var _miI2i = msgs.length - 1; _miI2i >= 0; _miI2i--) {
                                // 用户上传的图片
                                if (msgs[_miI2i].role === 'user' && msgs[_miI2i].files && msgs[_miI2i].files.length > 0) {
                                    _allImages = msgs[_miI2i].files.filter(function(f) {
                                        return f.isImage || (f.type && f.type.startsWith('image/'));
                                    });
                                    if (_allImages.length > 0) break;
                                }
                                // AI 生成的图片
                                if (msgs[_miI2i].role === 'assistant' && msgs[_miI2i].generatedImages && msgs[_miI2i].generatedImages.length > 0) {
                                    _allImages = msgs[_miI2i].generatedImages.map(function(imgUrl) {
                                        return { name: 'AI生成的图片', content: imgUrl, isImage: true, type: 'image/png' };
                                    });
                                    if (_allImages.length > 0) break;
                                }
                                if (msgs[_miI2i].role === 'assistant' && msgs[_miI2i].generatedImage) {
                                    _allImages = [{ name: 'AI生成的图片', content: msgs[_miI2i].generatedImage, isImage: true, type: 'image/png' }];
                                    break;
                                }
                            }
                        }

                        if (!userPrompt) {
                            toolResult = { error: 'Missing prompt parameter' };
                        } else if (!_allImages.length) {
                            toolResult = { error: '缺少参考图片。请上传至少一张参考图片后再使用图生图功能。' };
                        } else {
                            // 使用第一张图作为主参考图
                            primaryImage = _allImages[0].serverUrl || _allImages[0].content || '';

                            if (currentChatId === chatId) {
                                var currentBubble = activeBubbleMap[chatId];
                                if (currentBubble) {
                                    let status = currentBubble.querySelector('.search-status');
                                    if (!status) {
                                        status = document.createElement('div');
                                        status.className = 'search-status';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(status);
                                    }
                                    status.textContent = '🔍 正在分析参考图片(' + _allImages.length + '张)...';
                                }
                            }

                            try {
                                // ★ 逐张分析所有参考图,构建完整描述
                                var _allDescs = [];
                                for (var _ai = 0; _ai < _allImages.length; _ai++) {
                                    // 直连 API 优先 base64 content (HTTP URL 会导致 MiniMax 报 invalid image URL)
                                    var _imgSrc = (_isDirectVision ? (_allImages[_ai].content || _allImages[_ai].serverUrl) : (_allImages[_ai].serverUrl || _allImages[_ai].content)) || '';
                                    if (!_imgSrc) continue;
                                    if (currentChatId === chatId) {
                                        var _cbI2i = activeBubbleMap[chatId];
                                        if (_cbI2i) {
                                            var _stI2i = _cbI2i.querySelector('.search-status');
                                            if (_stI2i) _stI2i.textContent = '🔍 正在分析第' + (_ai + 1) + '/' + _allImages.length + '张参考图...';
                                        }
                                    }
                                    try {
                                        var _descPromise = window.analyzeImage(_imgSrc, 'Describe this image in detail: style, subject, colors, composition, mood. Under 150 words.');
                                        var _descResult = await _descPromise;
                                        if (_descResult && typeof _descResult === 'string') {
                                            _allDescs.push('参考图' + (_ai + 1) + ': ' + _descResult.slice(0, 300));
                                        }
                                    } catch(_e) {
                                        console.warn('[i2i] 分析第' + (_ai + 1) + '张图片失败:', _e.message);
                                        _allDescs.push('参考图' + (_ai + 1) + ': (分析失败)');
                                    }
                                }

                                // 构建完整 prompt: 用户原始需求 + 所有图片描述
                                var _allDescsText = _allDescs.join('\n');
                                var fullPrompt = userPrompt + '\n\n【参考图分析】\n' + _allDescsText.slice(0, 2000);

                                if (currentChatId === chatId) {
                                    var currentBubble = activeBubbleMap[chatId];
                                    if (currentBubble) {
                                        let status = currentBubble.querySelector('.search-status');
                                        // ★ 并行模式: 跳过个体占位符
                                        if (window.__parallelToolActive) {
                                            if (status) status.textContent = '🎨 并行图生图中...';
                                        } else {
                                            if (status) status.textContent = '🎨 正在图生图(' + _allImages.length + '张参考图)...';
                                            var placeholder = document.createElement('div');
                                            placeholder.id = 'image-placeholder';
                                            placeholder.style = 'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:12px;padding:40px 20px;text-align:center;margin:12px 0;color:white;animation:pulse 2s infinite;';
                                            placeholder.innerHTML = '<img src="./src/remi/creating.gif" style="width:64px;height:64px;border-radius:12px;margin:0 auto 12px;display:block;object-fit:cover;" alt="蕾米创作中"><div style="font-size:14px;">图生图中' + ((args.n || 1) > 1 ? ' (' + (args.n || 1) + '张)' : '') + ',请稍候...</div><div style="font-size:12px;margin-top:8px;opacity:0.8;">' + escapeHtml(userPrompt.substring(0, 30)) + '...</div>';
                                            currentBubble.querySelector('.markdown-body')?.appendChild(placeholder);
                                        }
                                    }
                                }

                                // ★ 调用图生图 API — 传递所有参考图 (GPT Image 原生支持多图)
                                // 收集所有参考图的 URL
                                var _allRefUrls = _allImages.map(function(img) {
                                    return img.serverUrl || img.content || '';
                                }).filter(function(u) { return u; });
                                var i2iResult = await window.generateImageI2I(fullPrompt, primaryImage, {
                                    model: args.model || localStorage.getItem('imageModel') || 'image-01',
                                    aspect_ratio: args.aspect_ratio,
                                    seed: args.seed,
                                    n: args.n,
                                    reference_images: _allRefUrls,
                                    mask_image: args.mask_image || null
                                });
                                if (i2iResult) {
                                    if (!pendingMsg.generatedImages) pendingMsg.generatedImages = [];
                                    var _imgUrlsI2i = typeof i2iResult === 'string' ? [i2iResult] : i2iResult;
                                    var _i2iOpts = {
                                        model: args.model || localStorage.getItem('imageModel_' + (localStorage.getItem('imageProvider') || 'minimax')) || '',
                                        aspect_ratio: args.aspect_ratio || '1:1'
                                    };
                                    for (var _giI2i = 0; _giI2i < _imgUrlsI2i.length; _giI2i++) {
                                        var _imgI2i = _imgUrlsI2i[_giI2i];
                                        // ★ 新格式: 带元数据的对象
                                        var _metaI2i = window.buildImageMeta(_imgI2i, userPrompt || prompt, _i2iOpts);
                                        pendingMsg.generatedImages.push(_metaI2i);
                                        if (_giI2i === 0) pendingMsg.generatedImage = _metaI2i;
                                        // 异步上传到服务器,上传成功后替换为服务器URL(避免localStorage溢出)
                                        if (_imgI2i && !_imgI2i.startsWith(window.location.origin) && !_imgI2i.startsWith('/oneapichat')) {
                                            (function(_origUrl, _idx, _meta) {
                                                uploadImageToServer(_origUrl).then(function(srvUrl) {
                                                    if (srvUrl) {
                                                        console.log('[Image] i2i已上传:', srvUrl);
                                                        // ★ 替换对象中的 url 字段
                                                        _meta.url = srvUrl;
                                                        if (pendingMsg.generatedImage === _meta) pendingMsg.generatedImage = _meta;
                                                        // ★ 同步到 chats 消息对象
                                                        var _msgIdx = chats[chatId] && chats[chatId].messages ? chats[chatId].messages.findIndex(function(m) { return m === pendingMsg; }) : -1;
                                                        if (_msgIdx !== -1) {
                                                            var _cm = chats[chatId].messages[_msgIdx];
                                                            if (_cm.generatedImages && _cm.generatedImages[_idx] === _meta) _cm.generatedImages[_idx] = _meta;
                                                            if (_cm.generatedImage === _meta) _cm.generatedImage = _meta;
                                                        }
                                                        // ★ 图片URL替换后立即保存,防止刷新丢失
                                                        slimSaveChats();
                                                    }
                                                }).catch(function(e) {
                                                    console.warn('[Image] i2i上传失败:', e.message);
                                                });
                                            })(_imgI2i, _giI2i, _metaI2i);
                                        }
                                    }
                                    toolResult = { result: '\u2705 \u56fe\u7247\u5df2\u751f\u6210' };
                                } else {
                                    // ★ 图片已添加到消息,立即保存到 localStorage 防止刷新丢失
                                    slimSaveChats();
                                    toolResult = { result: i2iResult };
                                }
                            } catch (e) {
                                console.error('[generate_image_i2i error]', e.message);
                                toolResult = { error: e.message };
                                if (currentChatId === chatId) {
                                    var currentBubble = activeBubbleMap[chatId];
                                    if (currentBubble) {
                                        var ph = currentBubble.querySelector('#image-placeholder');
                                        if (ph) {
                                            ph.innerHTML = '<div style="font-size:24px;margin-bottom:8px;">❌</div><div style="font-size:14px;font-weight:bold;">图生图失败</div><div style="font-size:12px;color:#666;margin-top:8px;">' + escapeHtml(e.message) + '</div>';
                                            ph.style.background = '#fee2e2';
                                            ph.style.color = '#dc2626';
                                        }
                                        let status = currentBubble.querySelector('.search-status');
                                        if (status) status.textContent = '❌ 图生图失败';
                                    }
                                }
                            }
                        }
                    } else if (func.name === 'analyze_image') {
                        // 图片理解工具 - 调用 MiniMax 图片理解 API
                        var focus = args.focus || '请详细描述这张图片的内容,包括其中的物体、场景、文字等所有可见信息。';
                        var imgIdx = (typeof args.image_index === 'number' && args.image_index >= 0) ? args.image_index : 0;

                        // 获取当前消息中的所有图片(优先从全局变量获取)
                        var _imgsForChat = window._currentMessageImagesByChat && window._currentMessageImagesByChat[chatId];
                        let currentFiles = _imgsForChat || [];
                        if (!currentFiles.length) {
                            currentFiles = pendingFiles.length > 0 ? pendingFiles : (chats[chatId]?.messages?.slice(-1)[0]?.files || []);
                        }

                        // ★ 修复: 如果当前消息图片不足,从聊天历史中收集所有用户上传的图片(支持多批次上传)
                        if (currentFiles.length < 2 && chats[chatId]) {
                            var _allHistoricalImages = [];
                            var _msgsAll2 = chats[chatId].messages;
                            for (let _hi = _msgsAll2.length - 1; _hi >= 0; _hi--) {
                                if (_msgsAll2[_hi].role === 'user' && _msgsAll2[_hi].files && _msgsAll2[_hi].files.length > 0) {
                                    _msgsAll2[_hi].files.forEach(function(f) {
                                        if ((f.isImage || f.type?.startsWith('image/')) && !_allHistoricalImages.some(ef => ef.name === f.name && ef.serverUrl === f.serverUrl)) {
                                            _allHistoricalImages.push(f);
                                        }
                                    });
                                }
                            }
                            if (_allHistoricalImages.length > currentFiles.length) {
                                currentFiles = _allHistoricalImages;
                                console.log('[analyze_image] 从历史消息收集到', currentFiles.length, '张图片');
                            }
                        }

                        // 如果仍然没有找到图片,尝试从聊天历史中查找(用户上传或AI生成的图片)
                        if (!currentFiles.length && chats[chatId]) {
                            let msgs = chats[chatId].messages;
                            for (let i = msgs.length - 1; i >= 0; i--) {
                                if (msgs[i].role === 'user' && msgs[i].files && msgs[i].files.length > 0) {
                                    currentFiles = msgs[i].files.filter(f => f.isImage || f.type?.startsWith('image/'));
                                    if (currentFiles.length > 0) break;
                                }
                                // AI 生成的图片
                                if (msgs[i].role === 'assistant' && msgs[i].generatedImages && msgs[i].generatedImages.length > 0) {
                                    currentFiles = msgs[i].generatedImages.map(url => ({ name: 'AI生成的图片', content: url, isImage: true, type: 'image/png' }));
                                    if (currentFiles.length > 0) break;
                                }
                                if (msgs[i].role === 'assistant' && msgs[i].generatedImage) {
                                    currentFiles = [{ name: 'AI生成的图片', content: msgs[i].generatedImage, isImage: true, type: 'image/png' }];
                                    break;
                                }
                            }
                        }

                        // 按索引选择图片
                        var imageFiles = currentFiles.filter(f => f.isImage || f.type?.startsWith('image/'));
                        var imageFile = (imageFiles.length > imgIdx) ? imageFiles[imgIdx] : imageFiles[0];

                        // ★ 修复: imageFile.serverUrl 为空时, 从聊天历史中按文件名查找完整 serverUrl
                        if (imageFile && (!imageFile.serverUrl || imageFile.serverUrl.length < 5) && imageFile.name && chats[chatId]) {
                            var _targetName = imageFile.name;
                            var _msgsAll = chats[chatId].messages;
                            // 方法1: 从其他消息的 files 数组中按文件名匹配
                            for (let _mi = _msgsAll.length - 1; _mi >= 0; _mi--) {
                                var _mFiles = _msgsAll[_mi].files;
                                if (_mFiles && _mFiles.length > 0) {
                                    var _match = _mFiles.find(function(ff) { return ff.name === _targetName && ff.serverUrl && ff.serverUrl.length > 5; });
                                    if (_match) {
                                        imageFile.serverUrl = _match.serverUrl;
                                        console.log('[analyze_image] 从历史消息补全 serverUrl:', _targetName, '->', _match.serverUrl);
                                        break;
                                    }
                                }
                            }
                            // 方法2: 仍无 serverUrl, 从消息正文中提取 URL (格式: 🌐 URL: /oneapichat/uploads/...)
                            if (!imageFile.serverUrl || imageFile.serverUrl.length < 5) {
                                for (let _mi2 = _msgsAll.length - 1; _mi2 >= 0; _mi2--) {
                                    var _content2 = _msgsAll[_mi2].text || _msgsAll[_mi2].content || '';
                                    if (typeof _content2 === 'string' && _content2.indexOf(_targetName) !== -1) {
                                        var _urlMatch = _content2.match(/[🌐\s]*URL:\s*(\/[^\s\)]+\.(?:jpeg|jpg|png|webp|gif))/i);
                                        if (_urlMatch && _urlMatch[1]) {
                                            imageFile.serverUrl = _urlMatch[1];
                                            console.log('[analyze_image] 从消息正文提取 serverUrl:', _targetName, '->', _urlMatch[1]);
                                            break;
                                        }
                                    }
                                }
                            }
                        }

                        if (!imageFile) {
                            toolResult = { error: '未找到可分析的图片,请确保用户已上传图片。' };
                        } else {
                            if (currentChatId === chatId) {
                                var currentBubble = activeBubbleMap[chatId];
                                if (currentBubble) {
                                    let status = currentBubble.querySelector('.search-status');
                                    if (!status) {
                                        status = document.createElement('div');
                                        status.className = 'search-status';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(status);
                                    }
                                    status.textContent = '🖼️ 正在分析图片...';
                                }
                            }
                            try {
                                // ★ 更新状态提示(显示第几张)
                                if (currentChatId === chatId) {
                                    var _cbImg = activeBubbleMap[chatId];
                                    if (_cbImg) {
                                        var _stImg = _cbImg.querySelector('.search-status');
                                        if (_stImg) _stImg.textContent = '🖼️ 正在分析第' + (imgIdx + 1) + '/' + imageFiles.length + '张图片...';
                                    }
                                }
                                // ★ 检测视觉提供商
                                var _visProvider = localStorage.getItem('visionProvider') || '';
                                var _visApiKey = '';
                                var _visApiUrl = '';
                                var _visModel = '';
                                console.log('[analyze_image] 视觉提供商:', _visProvider, '图片:', imageFile.name, '有content:', !!(imageFile.content && imageFile.content.length > 10), 'serverUrl:', imageFile.serverUrl);
                                if (_visProvider === 'xai') {
                                    _visApiKey = await decrypt(localStorage.getItem('visionApiKeyXAI') || '');
                                    _visApiUrl = localStorage.getItem('visionApiUrlXAI') || 'https://api.x.ai/v1';
                                    _visModel = localStorage.getItem('visionModel') || 'grok-4.5';
                                    console.log('[analyze_image] xAI Key:', _visApiKey ? 'YES(' + _visApiKey.substring(0, 8) + '...)' : 'NO');
                                    // ★ xAI Key 为空时, 直接从服务器获取配置 (绕过 loadConfigFromServer 守卫)
                                    if (!_visApiKey) {
                                        console.log('[analyze_image] xAI Key 为空, 直接从服务器获取配置...');
                                        try {
                                            var _cfgResp = await fetch('/oneapichat/api/chat.php?action=get_config&auth_token=' + encodeURIComponent(window.getAuthToken() || ''), { cache: 'no-store' });
                                            if (_cfgResp.ok) {
                                                var _cfgData = await _cfgResp.json();
                                                if (_cfgData.visionApiKeyXAI) {
                                                    localStorage.setItem('visionApiKeyXAI', _cfgData.visionApiKeyXAI);
                                                    _visApiKey = await decrypt(_cfgData.visionApiKeyXAI);
                                                    console.log('[analyze_image] 服务器获取 xAI Key 成功:', _visApiKey ? _visApiKey.substring(0, 8) + '...' : 'FAIL');
                                                }
                                                if (_cfgData.visionApiUrlXAI) { localStorage.setItem('visionApiUrlXAI', _cfgData.visionApiUrlXAI); _visApiUrl = _cfgData.visionApiUrlXAI; }
                                            }
                                        } catch(_cfgErr) { console.warn('[analyze_image] 服务器获取配置失败:', _cfgErr.message); }
                                    }
                                    if (!_visApiKey) console.warn('[analyze_image] ⚠️ xAI 提供商已选择但未配置 API Key, 请在设置中填写 visionApiKeyXAI');
                                } else if (_visProvider === 'openai') {
                                    _visApiKey = await decrypt(localStorage.getItem('visionApiKeyOpenAI') || '');
                                    _visApiUrl = localStorage.getItem('visionApiUrlOpenAI') || 'https://api.openai.com/v1';
                                    _visModel = localStorage.getItem('visionModel') || 'gpt-4o';
                                    console.log('[analyze_image] OpenAI Key:', _visApiKey ? 'YES(' + _visApiKey.substring(0, 8) + '...)' : 'NO');
                                    // ★ OpenAI Key 为空时, 直接从服务器获取配置
                                    if (!_visApiKey) {
                                        console.log('[analyze_image] OpenAI Key 为空, 直接从服务器获取配置...');
                                        try {
                                            var _cfgResp2 = await fetch('/oneapichat/api/chat.php?action=get_config&auth_token=' + encodeURIComponent(window.getAuthToken() || ''), { cache: 'no-store' });
                                            if (_cfgResp2.ok) {
                                                var _cfgData2 = await _cfgResp2.json();
                                                if (_cfgData2.visionApiKeyOpenAI) {
                                                    localStorage.setItem('visionApiKeyOpenAI', _cfgData2.visionApiKeyOpenAI);
                                                    _visApiKey = await decrypt(_cfgData2.visionApiKeyOpenAI);
                                                    console.log('[analyze_image] 服务器获取 OpenAI Key 成功:', _visApiKey ? _visApiKey.substring(0, 8) + '...' : 'FAIL');
                                                }
                                                if (_cfgData2.visionApiUrlOpenAI) { localStorage.setItem('visionApiUrlOpenAI', _cfgData2.visionApiUrlOpenAI); _visApiUrl = _cfgData2.visionApiUrlOpenAI; }
                                            }
                                        } catch(_cfgErr2) { console.warn('[analyze_image] 服务器获取配置失败:', _cfgErr2.message); }
                                    }
                                    if (!_visApiKey) console.warn('[analyze_image] ⚠️ OpenAI 提供商已选择但未配置 API Key, 请在设置中填写 visionApiKeyOpenAI');
                                } else if (_visProvider === 'custom') {
                                    // ★ 自定义提供商: 读取独立存储的 Key/URL/Model,走直连 API
                                    _visApiKey = await decrypt(localStorage.getItem('visionApiKeyCustom') || '');
                                    _visApiUrl = localStorage.getItem('visionApiUrlCustom') || '';
                                    _visModel = localStorage.getItem('visionModel') || '';
                                    console.log('[analyze_image] 自定义 Key:', _visApiKey ? 'YES(' + _visApiKey.substring(0, 8) + '...)' : 'NO', 'URL:', _visApiUrl, 'Model:', _visModel);
                                    // ★ 自定义 Key 为空时, 直接从服务器获取配置
                                    if (!_visApiKey && !_visApiUrl) {
                                        try {
                                            var _cfgResp3 = await fetch('/oneapichat/api/chat.php?action=get_config&auth_token=' + encodeURIComponent(window.getAuthToken() || ''), { cache: 'no-store' });
                                            if (_cfgResp3.ok) {
                                                var _cfgData3 = await _cfgResp3.json();
                                                if (_cfgData3.visionApiKeyCustom) {
                                                    localStorage.setItem('visionApiKeyCustom', _cfgData3.visionApiKeyCustom);
                                                    _visApiKey = await decrypt(_cfgData3.visionApiKeyCustom);
                                                }
                                                if (_cfgData3.visionApiUrlCustom) { localStorage.setItem('visionApiUrlCustom', _cfgData3.visionApiUrlCustom); _visApiUrl = _cfgData3.visionApiUrlCustom; }
                                            }
                                        } catch(_cfgErr3) { console.warn('[analyze_image] 服务器获取配置失败:', _cfgErr3.message); }
                                    }
                                    if (!_visApiKey) console.warn('[analyze_image] ⚠️ 自定义提供商已选择但未配置 API Key, 请在设置中填写 visionApiKeyCustom');
                                    if (!_visApiUrl) console.warn('[analyze_image] ⚠️ 自定义提供商已选择但未配置 API 地址, 请在设置中填写 visionApiUrlCustom');
                                } else {
                                    console.log('[analyze_image] ⚠️ 未配置视觉提供商, 走 MiniMax MCP');
                                }
                                var analyzeInput;
                                var _xaiHandled = false;
                                // ★ xAI/OpenAI/自定义 视觉提供商: 强制 base64, 走 proxyFetch
                                if ((_visProvider === 'xai' || _visProvider === 'openai' || _visProvider === 'custom') && _visApiKey && _visApiUrl) {
                                    analyzeInput = imageFile.content || '';
                                    if (!analyzeInput.startsWith('data:')) {
                                        // ★ 优先用服务端代理获取 base64 (可靠, 不依赖浏览器下载)
                                        if (imageFile.serverUrl && imageFile.serverUrl.length > 3) {
                                            try {
                                                var _proxyPath = imageFile.serverUrl.startsWith('http')
                                                    ? imageFile.serverUrl.replace(/^https?:\/\/[^\/]+/, '')
                                                    : imageFile.serverUrl;
                                                console.log('[analyze_image] 尝试服务端代理:', _proxyPath);
                                                var _proxyResp = await fetch('/oneapichat/api/image_proxy.php?action=get&path=' + encodeURIComponent(_proxyPath) + '&auth_token=' + encodeURIComponent(window.getAuthToken() || ''));
                                                console.log('[analyze_image] 代理响应状态:', _proxyResp.status);
                                                if (_proxyResp.ok) {
                                                    var _proxyData = await _proxyResp.json();
                                                    console.log('[analyze_image] 代理返回:', _proxyData.success ? '成功' : '失败', _proxyData.error || '');
                                                    if (_proxyData.success && _proxyData.dataUrl) {
                                                        analyzeInput = _proxyData.dataUrl;
                                                        console.log('[analyze_image] 通过服务端代理获取图片成功:', imageFile.name, '(' + (_proxyData.size / 1024).toFixed(0) + 'KB)');
                                                    }
                                                } else {
                                                    var _proxyErrText = await _proxyResp.text().catch(function() { return ''; });
                                                    console.warn('[analyze_image] 代理HTTP错误:', _proxyResp.status, _proxyErrText.substring(0, 200));
                                                }
                                            } catch(_proxyErr) {
                                                console.warn('[analyze_image] 服务端代理失败:', _proxyErr.message);
                                            }
                                        } else {
                                            console.warn('[analyze_image] ⚠️ 无 serverUrl, 无法获取图片');
                                        }
                                        // 降级: 浏览器直接下载
                                        if (!analyzeInput.startsWith('data:') && imageFile.serverUrl && imageFile.serverUrl.length > 3) {
                                            var _dlUrl = imageFile.serverUrl.startsWith('http') ? imageFile.serverUrl : window.location.origin + imageFile.serverUrl;
                                            try {
                                                var _dlResp = await window.proxyFetch(_dlUrl);
                                                var _dlBlob = await _dlResp.blob();
                                                analyzeInput = await new Promise(function(r) {
                                                    var fr = new FileReader();
                                                    fr.onload = function() { r(fr.result); };
                                                    fr.readAsDataURL(_dlBlob);
                                                });
                                            } catch(_dlErr) {
                                                console.warn('[analyze_image] 浏览器下载也失败:', _dlErr.message);
                                            }
                                        }
                                    }
                                    if (analyzeInput && analyzeInput.startsWith('data:')) {
                                        try {
                                            var _visContent = [
                                                { type: 'text', text: focus || '请详细描述这张图片的内容,包括物体、场景、文字等可见信息。' },
                                                { type: 'image_url', image_url: { url: analyzeInput, detail: 'auto' } }
                                            ];
                                            var _visReqBody = JSON.stringify({ model: _visModel, messages: [{ role: 'user', content: _visContent }], max_tokens: 2048, stream: false });
                                            var _visResp = await window.proxyFetch(_visApiUrl.replace(/\/$/, '') + '/chat/completions', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _visApiKey },
                                                body: _visReqBody
                                            });
                                            // ★ xAI/OpenAI 请求失败 (可能因中国大陆网络限制), 自动启用代理并重试
                                            if (!_visResp.ok && _visResp.status !== 401 && _visResp.status !== 403) {
                                                var _wasProxyEnabled = window.isProxyEnabled && window.isProxyEnabled();
                                                if (!_wasProxyEnabled && typeof window.toggleProxy === 'function' && typeof setChecked === 'function') {
                                                    console.log('[analyze_image] API 请求失败 (' + _visResp.status + '), 尝试启用代理重试...');
                                                    setChecked('proxyToggle', true);
                                                    window.toggleProxy();
                                                    try {
                                                        var _visResp2 = await window.proxyFetch(_visApiUrl.replace(/\/$/, '') + '/chat/completions', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _visApiKey },
                                                            body: _visReqBody
                                                        });
                                                        if (_visResp2.ok) _visResp = _visResp2;
                                                    } catch(e) {}
                                                }
                                            }
                                            if (_visResp.ok) {
                                                var _visData = await _visResp.json();
                                                var _visResult = _visData.choices && _visData.choices[0] && _visData.choices[0].message && _visData.choices[0].message.content;
                                                if (_visResult) {
                                                    toolResult = { result: _visResult };
                                                    _xaiHandled = true;
                                                    // 缓存
                                                    try {
                                                        if (chatId && chats[chatId]) {
                                                            if (!chats[chatId].imageAnalyses) chats[chatId].imageAnalyses = [];
                                                            var _cacheStr = '【' + (imageFile.name || '图片' + imgIdx) + '】\n' + _visResult;
                                                            if (chats[chatId].imageAnalyses.indexOf(_cacheStr) === -1) chats[chatId].imageAnalyses.push(_cacheStr);
                                                            slimSaveChats();
                                                        }
                                                    } catch(e2) {}
                                                }
                                            } else {
                                                console.warn('[analyze_image] xAI API 返回非 OK:', _visResp.status);
                                            }
                                        } catch(_xaiErr) {
                                            console.warn('[analyze_image] xAI 请求失败:', _xaiErr.message);
                                        }
                                    }
                                }
                                // ★ 默认: MiniMax MCP / 直连模式 (仅当 xAI 未成功时执行)
                                if (!_xaiHandled) {
                                var _visUrl = localStorage.getItem('visionApiUrl') || DEFAULT_CONFIG.visionApiUrl || '/mcp';
                                var _isDirectVision = _visUrl.toLowerCase().indexOf('/mcp') === -1;
                                analyzeInput = imageFile.content || '';
                                // ★ content 被剥离时(刷新后大图), 优先用服务端代理获取 base64 (从磁盘读取, 不依赖浏览器下载)
                                if ((!analyzeInput || !analyzeInput.startsWith('data:')) && imageFile.serverUrl && imageFile.serverUrl.length > 3) {
                                    var _proxyPath = imageFile.serverUrl.startsWith('http')
                                        ? imageFile.serverUrl.replace(/^https?:\/\/[^\/]+/, '')
                                        : imageFile.serverUrl;
                                    try {
                                        var _proxyResp2 = await fetch('/oneapichat/api/image_proxy.php?action=get&path=' + encodeURIComponent(_proxyPath) + '&auth_token=' + encodeURIComponent(window.getAuthToken() || ''));
                                        if (_proxyResp2.ok) {
                                            var _proxyData2 = await _proxyResp2.json();
                                            if (_proxyData2.success && _proxyData2.dataUrl) {
                                                analyzeInput = _proxyData2.dataUrl;
                                                console.log('[analyze_image] MiniMax路径-服务端代理获取图片成功:', imageFile.name, '(' + (_proxyData2.size / 1024).toFixed(0) + 'KB)');
                                            } else {
                                                console.warn('[analyze_image] MiniMax路径-代理返回失败:', _proxyData2.error || '未知错误');
                                            }
                                        } else {
                                            var _proxyErrText2 = await _proxyResp2.text().catch(function() { return ''; });
                                            console.warn('[analyze_image] MiniMax路径-代理HTTP错误:', _proxyResp2.status, _proxyErrText2.substring(0, 200));
                                        }
                                    } catch(_proxyErr2) {
                                        console.warn('[analyze_image] MiniMax路径-服务端代理失败:', _proxyErr2.message);
                                    }
                                }
                                // ★ 代理失败且非 base64: 直连模式用 URL (analyzeImage 会下载), MCP 模式也用 URL (服务端下载)
                                if (!analyzeInput.startsWith('data:')) {
                                    if (imageFile.serverUrl && imageFile.serverUrl.length > 3) {
                                        var fullUrl = imageFile.serverUrl.startsWith('http') ? imageFile.serverUrl : window.location.origin + imageFile.serverUrl;
                                        analyzeInput = fullUrl;
                                    } else if (imageFile.name) {
                                        // ★ 按文件名 hash 在聊天历史中查找真实 serverUrl (可能跨消息)
                                        var _fn2 = imageFile.name;
                                        if (/^img_[a-f0-9]+\.\w+$/i.test(_fn2) || /^IMG_\d+\.\w+$/i.test(_fn2)) {
                                            // 尝试从所有消息的 files 中找同名文件
                                            var _allMsgs = chats[chatId]?.messages || [];
                                            for (let _si = _allMsgs.length - 1; _si >= 0; _si--) {
                                                var _sf = _allMsgs[_si].files || [];
                                                var _sfMatch = _sf.find(function(ff) { return ff.name === _fn2 && ff.serverUrl && ff.serverUrl.length > 10; });
                                                if (_sfMatch) {
                                                    analyzeInput = _sfMatch.serverUrl.startsWith('http') ? _sfMatch.serverUrl : window.location.origin + _sfMatch.serverUrl;
                                                    break;
                                                }
                                            }
                                            // 最终回退: 用 anonymous 前缀 (旧版兼容)
                                            if (!analyzeInput.startsWith('http') && !analyzeInput.startsWith('data:')) {
                                                analyzeInput = window.location.origin + '/oneapichat/uploads/anonymous/' + _fn2;
                                            }
                                        }
                                    }
                                }
                                var analyzeResult = await window.analyzeImage(analyzeInput, focus);
                                toolResult = { result: analyzeResult };
                                } // ← 结束 if (!_xaiHandled)
                                // ★ 缓存工具调用的分析结果,后续追问无需重新分析
                                try {
                                    if (chatId && chats[chatId]) {
                                        if (!chats[chatId].imageAnalyses) chats[chatId].imageAnalyses = [];
                                        var _cacheStr = '【' + (imageFile.name || '图片' + imgIdx) + '】\n' + analyzeResult;
                                        if (chats[chatId].imageAnalyses.indexOf(_cacheStr) === -1) {
                                            chats[chatId].imageAnalyses.push(_cacheStr);
                                        }
                                        if (chats[chatId].imageAnalyses.length > 50) {
                                            chats[chatId].imageAnalyses = chats[chatId].imageAnalyses.slice(-30);
                                        }
                                        slimSaveChats();
                                    }
                                } catch(e2) {}
                            } catch (e) {
                                console.error('[analyze_image error]', e);
                                var errorMsg = e?.message || e?.toString() || String(e) || '图片分析失败';
                                toolResult = { error: errorMsg };
                            }
                        }
                    } else if (func.name === 'video_understanding') {
                        var query = args.query || '描述视频内容';
                        var vidIdx = args.video_index || 0;
                        var vids = [];
                        if (chats[chatId]) {
                            var msgs = chats[chatId].messages;
                            for (var vi = msgs.length-1; vi >= 0; vi--) {
                                if (msgs[vi].files) {
                                    var vf2 = msgs[vi].files.filter(function(f){ return f.isVideo || (f.type && f.type.startsWith('video/')); });
                                    vids = vids.concat(vf2);
                                }
                            }
                        }
                        var vf = vids[vidIdx];
                        if (!vf) { toolResult = { error: '未找到视频' }; }
                        else {
                            var input = vf.serverUrl || vf.content;
                            if (input && !input.startsWith('http') && !input.startsWith('data:')) {
                                input = window.location.origin + input;
                            }
                            // ★ 检查缓存: 30分钟内已分析过的视频直接复用
                            var _cacheKey = vf.serverUrl || input;
                            var _cached = chats[chatId]?.videoAnalyses?.[_cacheKey];
                            if (_cached && _cached.time && (Date.now() - _cached.time < 1800000) && _cached.frames && _cached.frames.length > 0) {
                                var _cr = '🎬 **视频分析结果(缓存)**\n\n**元信息:**\n';
                                _cr += '- 时长: ' + Math.floor(_cached.duration/60) + '分' + Math.round(_cached.duration%60) + '秒\n';
                                if (_cached.meta?.width) _cr += '- 分辨率: ' + _cached.meta.width + 'x' + _cached.meta.height + '\n';
                                _cr += '\n**关键帧分析(' + _cached.frames.length + '帧):**\n';
                                _cached.frames.forEach(function(a){ _cr += '\n' + a + '\n'; });
                                toolResult = { result: _cr };
                            } else {
                                var r = await window.analyzeVideo(input, query);
                                toolResult = { result: r };
                            }
                        }
                    } else if (func.name.startsWith('bilibili_')) {
                        // ★ B站工具: 通过 MCP 统一代理
                        toolResult = await _mcpExecute(func.name, args, function(res) {
                            if (func.name === 'bilibili_qr_login') {
                                var _qrB64 = res.qr_image_base64 || res.success_image || null;
                                // ★ 彻底清除气泡内QR: 删generatedImage, 删URL防markdown渲染为图片
                                delete pendingMsg.generatedImage;
                                delete pendingMsg.generatedImages;
                                // 从res和pendingMsg中抹掉QR URL(防止出现在任何文本中被markdown渲染)
                                if (res.qr_image_url) delete res.qr_image_url;
                                if (res.qr_image_base64) delete res.qr_image_base64;
                                if (pendingMsg.content && /bilibili_qr\.png/.test(pendingMsg.content)) {
                                    pendingMsg.content = pendingMsg.content.replace(/https:\/\/[^\s]*bilibili_qr\.png[^\s]*/g, '[QR码]');
                                }
                                if (_qrB64) {
                                    try {
                                        var _qrCont = (typeof $ !== 'undefined' && $.chatMessagesContainer) || document.querySelector('#chat-messages');
                                        if (_qrCont) {
                                            // 移除旧独立QR行
                                            _qrCont.querySelectorAll('[data-qr-login]').forEach(function(el) { el.remove(); });
                                            // 清理所有气泡内可能残留的QR图片
                                            _qrCont.querySelectorAll('.bubble img[src*="base64"], .bubble img[src*="bilibili_qr"], .generated-images-container img').forEach(function(el) {
                                                if (el.src && (el.src.includes('base64') || el.src.includes('bilibili_qr'))) {
                                                    var wrap = el.closest('.generated-images-container') || el.parentElement;
                                                    if (wrap) wrap.remove();
                                                }
                                            });
                                            var _qrRow = document.createElement('div');
                                            _qrRow.className = 'message-row assistant';
                                            _qrRow.setAttribute('data-qr-login', '1');
                                            var _isSuccess = res.status === 'logged_in' || (res.ok && !res.qr_image_base64);
                                                _qrRow.innerHTML = '<div class="bubble assistant" style="text-align:center;padding:12px;">' +
                                                    (_isSuccess ? '<div style="font-size:32px;margin-bottom:8px;">✅</div><div style="font-size:14px;color:var(--text-secondary,#666);">登录成功</div>' :
                                                     '<div style="margin-bottom:6px;font-size:12px;color:var(--text-secondary,#666);">📷 请用哔哩哔哩客户端扫码</div>') +
                                                    '<img src="' + _qrB64 + '" style="max-width:220px;border-radius:10px;display:block;margin:0 auto;" />' +
                                                '</div>';
                                            _qrCont.appendChild(_qrRow);
                                            if (typeof $ !== 'undefined' && $.chatBox && !userScrolled) followToBottom($.chatBox);
                                            // ★ 持久化引用(供reload恢复, 注意不含base64避免token浪费)
                                            pendingMsg._hasQrRow = true;
                                            if (chats[chatId]) {
                                                var _bmi2 = chats[chatId].messages.findIndex(m => m === pendingMsg);
                                                if (_bmi2 !== -1) chats[chatId].messages[_bmi2]._hasQrRow = true;
                                            }
                                        }
                                    } catch(_qrDomErr3) {}
                                }
                            }
                        });
                    } else if (func.name === 'netdisk_login') {
                        // ★ 网盘扫码登录: 独立QR行(聊天消息) + 弹窗(辅助)
                        console.log('[netdisk_login] 处理器被调用, args:', JSON.stringify(args));
                        toolResult = await _mcpExecute(func.name, args, function(res) {
                            console.log('[netdisk_login] _mcpExecute回调被调用, res:', JSON.stringify(res).substring(0, 200));
                            var _qrB64 = res.qr_image_base64 || res.success_image || null;
                            delete pendingMsg.generatedImage;
                            delete pendingMsg.generatedImages;
                            if (res.qr_image_base64) delete res.qr_image_base64;
                            if (res.qr_image_url) delete res.qr_image_url;

                            var _serviceName = (args && args.service) || 'baidu';
                            var _actionName = (args && args.action) || '';
                            var _qrTitle = _serviceName === 'baidu' ? '百度网盘' : (_serviceName === 'quark' ? '夸克网盘' : '阿里云盘');
                            var _hint = '扫码确认后自动完成登录';

                            // ★ 关键反馈: 二维码已由前端展示, 必须让模型知道, 否则它会因为看不到
                            //   base64 而反复重新生成二维码(曾导致每次 qr 都杀掉上一张码 → 永远登不上)
                            if (_actionName === 'qr') {
                                res.notice = '【系统提示】二维码已由前端单独展示给用户(二维码图片base64/URL已从返回中移除以节省token, 聊天界面已显示二维码)。' +
                                    '请勿重复调用qr或重新生成二维码! 请直接调用 poll(service=' + _serviceName + ')持续轮询等待扫码。' +
                                    'poll返回 status=waiting 是正常状态, 表示用户尚未扫码, 需继续poll直到 status=logged_in。';
                            } else if (_actionName === 'poll' && res.status === 'waiting') {
                                res.notice = '【系统提示】用户尚未扫码(status=waiting, 正常状态)。请继续调用 poll 等待, 不要重新生成二维码。';
                            }

                            if (_qrB64) {
                                // ★ 方式1: 独立QR行(聊天消息中, 持久可见)
                                try {
                                    var _qrCont = (typeof $ !== 'undefined' && $.chatMessagesContainer) || document.querySelector('#chat-messages');
                                    if (_qrCont) {
                                        _qrCont.querySelectorAll('[data-qr-login]').forEach(function(el) { el.remove(); });
                                        _qrCont.querySelectorAll('.bubble img[src*="base64"], .bubble img[src*="baidu_qr"], .bubble img[src*="quark_qr"], .bubble img[src*="aliyun_qr"], .generated-images-container img').forEach(function(el) {
                                            if (el.src && (el.src.includes('base64') || el.src.includes('_qr'))) {
                                                var wrap = el.closest('.generated-images-container') || el.parentElement;
                                                if (wrap) wrap.remove();
                                            }
                                        });
                                        var _qrRow = document.createElement('div');
                                        _qrRow.className = 'message-row assistant';
                                        _qrRow.setAttribute('data-qr-login', '1');
                                        _qrRow.innerHTML = '<div class="bubble assistant" style="text-align:center;padding:12px;">' +
                                            '<div style="margin-bottom:6px;font-size:13px;font-weight:500;color:var(--text-primary,#1a1a1a);">📷 ' + _qrTitle + '扫码登录</div>' +
                                            '<div style="margin-bottom:10px;font-size:12px;color:var(--text-secondary,#666);">请用' + _qrTitle + 'APP扫描二维码</div>' +
                                            '<img src="' + _qrB64 + '" style="max-width:220px;border-radius:10px;display:block;margin:0 auto 10px;border:2px solid #e0e0e0;" />' +
                                            '<div style="font-size:11px;color:var(--text-secondary,#999);">' + _hint + '</div>' +
                                            '</div>';
                                        _qrCont.appendChild(_qrRow);
                                        if (typeof $ !== 'undefined' && $.chatBox && !userScrolled) followToBottom($.chatBox);
                                        pendingMsg._hasQrRow = true;
                                        if (chats[chatId]) {
                                            var _bmi = chats[chatId].messages.findIndex(m => m === pendingMsg);
                                            if (_bmi !== -1) chats[chatId].messages[_bmi]._hasQrRow = true;
                                        }
                                        console.log('[netdisk_login] 独立QR行已注入');
                                    }
                                } catch(_qrDomErr) { console.error('[netdisk_login] QR row error:', _qrDomErr); }

                                // ★ 方式2: 弹窗显示(辅助提醒)
                                try {
                                    var _overlay = document.getElementById('qr-popup-overlay');
                                    if (_overlay) {
                                        document.getElementById('qr-popup-img').src = _qrB64;
                                        document.getElementById('qr-popup-title').textContent = '📷 ' + _qrTitle + '扫码登录';
                                        document.getElementById('qr-popup-desc').textContent = '请用' + _qrTitle + 'APP扫描二维码';
                                        document.getElementById('qr-popup-hint').textContent = _hint;
                                        _overlay.style.display = 'flex';
                                        console.log('[netdisk_login] 弹窗已显示');
                                    } else {
                                        console.log('[netdisk_login] 弹窗不存在, 创建临时弹窗');
                                        var _tmpOverlay = document.createElement('div');
                                        _tmpOverlay.id = 'qr-popup-tmp';
                                        _tmpOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;';
                                        _tmpOverlay.innerHTML = '<div style="background:#fff;border-radius:16px;padding:24px;text-align:center;max-width:340px;">' +
                                            '<div style="font-size:18px;font-weight:bold;margin-bottom:8px;">📷 ' + _qrTitle + '扫码登录</div>' +
                                            '<div style="font-size:13px;color:#666;margin-bottom:16px;">请用' + _qrTitle + 'APP扫描二维码</div>' +
                                            '<img src="' + _qrB64 + '" style="width:220px;height:220px;border-radius:12px;display:block;margin:0 auto 16px;" />' +
                                            '<div style="font-size:12px;color:#999;margin-bottom:12px;">' + _hint + '</div>' +
                                            '<button onclick="this.closest(\'#qr-popup-tmp\').remove()" style="background:#1a73e8;color:#fff;border:none;border-radius:8px;padding:10px 28px;cursor:pointer;">关闭</button>' +
                                        '</div>';
                                        document.body.appendChild(_tmpOverlay);
                                    }
                                } catch(e) { console.error('QR popup error:', e); }
                            } else if (res.status === 'logged_in' || res.valid) {
                                // ★ 登录成功: 隐藏弹窗 + 更新独立QR行为成功状态
                                try {
                                    var _ov = document.getElementById('qr-popup-overlay');
                                    if (_ov) _ov.style.display = 'none';
                                    var _tmp = document.getElementById('qr-popup-tmp');
                                    if (_tmp) _tmp.remove();
                                    var _qrCont2 = (typeof $ !== 'undefined' && $.chatMessagesContainer) || document.querySelector('#chat-messages');
                                    if (_qrCont2) {
                                        var _qrRow2 = _qrCont2.querySelector('[data-qr-login]');
                                        if (_qrRow2) {
                                            var _bub = _qrRow2.querySelector('.bubble');
                                            if (_bub) {
                                                _bub.innerHTML = '<div style="font-size:32px;margin-bottom:8px;">✅</div><div style="font-size:14px;font-weight:500;color:var(--text-primary,#1a1a1a);">' + _qrTitle + '登录成功</div>';
                                            }
                                        }
                                    }
                                    console.log('[netdisk_login] 登录成功, QR行已更新');
                                } catch(e) {}
                            }
                        });
                    } else if (func.name === 'chaoxing_qr_login') {
                        // ★ 超星扫码登录: 通过 MCP 统一代理 + QR独立消息行
                        toolResult = await _mcpExecute(func.name, args, function(res) {
                            var _qrB64 = res.qr_image_base64 || res.success_image || null;
                            delete pendingMsg.generatedImage;
                            delete pendingMsg.generatedImages;
                            if (res.qr_image_url) delete res.qr_image_url;
                            if (res.qr_image_base64) delete res.qr_image_base64;
                            if (pendingMsg.content && /chaoxing_qr\.png/.test(pendingMsg.content)) {
                                pendingMsg.content = pendingMsg.content.replace(/https:\/\/[^\s]*chaoxing_qr\.png[^\s]*/g, '[QR码]');
                            }
                            if (_qrB64) {
                                try {
                                    var _qrCont = (typeof $ !== 'undefined' && $.chatMessagesContainer) || document.querySelector('#chat-messages');
                                    if (_qrCont) {
                                        _qrCont.querySelectorAll('[data-qr-login]').forEach(function(el) { el.remove(); });
                                        _qrCont.querySelectorAll('.bubble img[src*="base64"], .bubble img[src*="chaoxing_qr"], .generated-images-container img').forEach(function(el) {
                                            if (el.src && (el.src.includes('base64') || el.src.includes('chaoxing_qr'))) {
                                                var wrap = el.closest('.generated-images-container') || el.parentElement;
                                                if (wrap) wrap.remove();
                                            }
                                        });
                                        var _qrRow = document.createElement('div');
                                        _qrRow.className = 'message-row assistant';
                                        _qrRow.setAttribute('data-qr-login', '1');
                                        var _isSuccess2 = res.status === 'logged_in' || (res.ok && !res.qr_image_base64);
                                        _qrRow.innerHTML = '<div class="bubble assistant" style="text-align:center;padding:12px;">' +
                                            (_isSuccess2 ? '<div style="font-size:32px;margin-bottom:8px;">✅</div><div style="font-size:14px;color:var(--text-secondary,#666);">超星登录成功</div>' :
                                             '<div style="margin-bottom:6px;font-size:12px;color:var(--text-secondary,#666);">📷 请用学习通APP扫码</div>') +
                                            '<img src="' + _qrB64 + '" style="max-width:220px;border-radius:10px;display:block;margin:0 auto;" />' +
                                            '</div>';
                                        _qrCont.appendChild(_qrRow);
                                        if (typeof $ !== 'undefined' && $.chatBox && !userScrolled) followToBottom($.chatBox);
                                        pendingMsg._hasQrRow = true;
                                        if (chats[chatId]) {
                                            var _bmi3 = chats[chatId].messages.findIndex(m => m === pendingMsg);
                                            if (_bmi3 !== -1) chats[chatId].messages[_bmi3]._hasQrRow = true;
                                        }
                                    }
                                } catch(_qrDomErr4) {}
                            }
                        });
                    } else if (func.name === 'get_current_time') {
                        // ★ 获取当前精确时间: 直接走 MCP (瞬时返回,无参数)
                        toolResult = await _mcpExecute(func.name, args);
                    } else if (func.name.startsWith('mmx_')) {
                        // MiniMax CLI 工具：mmx_chat/mmx_image/mmx_video/mmx_speech/mmx_voices/mmx_music/mmx_vision/mmx_quota
                        var _mmxCmd = func.name.replace('mmx_', '');
                        
                        // ★ 定义 appendAudioToChat（如尚未定义）— 内联到当前回复气泡尾部
                        if (typeof window.appendAudioToChat !== 'function') {
                            window.appendAudioToChat = function(url, label) {
                                var cid2 = currentChatId;
                                if (!cid2 || !chats[cid2]) return;
                                var audioTag = '<audio controls style="width:100%;max-width:400px;margin:8px 0;"><source src="' + url + '" type="audio/mpeg"></audio><br><a href="' + url + '" target="_blank" download>⬇️ 下载</a>';
                                var msgContent = '\n\n---\n### ' + label + '\n' + audioTag;
                                // ★ 追加到当前活跃气泡的 markdown-body（而非独立气泡）
                                var _bub = activeBubbleMap[cid2];
                                if (_bub) {
                                    var _md = _bub.querySelector('.markdown-body');
                                    if (_md) {
                                        var _wrapper = document.createElement('div');
                                        _wrapper.innerHTML = msgContent;
                                        _md.appendChild(_wrapper);
                                        // 滚动到底部
                                        if ($.chatBox && !userScrolled) followToBottom($.chatBox);
                                    }
                                }
                                // ★ 追加到 pendingMsg.content 以便持久化到聊天记录
                                if (pendingMsg && pendingMsg.chatId === cid2) {
                                    pendingMsg.content = (pendingMsg.content || '') + msgContent;
                                }
                            };
                        }
                        var _k2 = localStorage.getItem('apiKeyMiniMax') || localStorage.getItem('baseApiKey') || '';
                        var _mmxKey2 = _k2; try { _mmxKey2 = await decrypt(_k2) || _k2; } catch(e) {}
                        let _mmxUrl = SERVER_API_BASE + '/engine_api.php?action=mmx&resource=' + _mmxCmd + '&cmd=' + _mmxCmd + '&api_key=' + encodeURIComponent(_mmxKey2);
                        if (args.message) _mmxUrl += '&message=' + encodeURIComponent(args.message);
                        if (args.system) _mmxUrl += '&system=' + encodeURIComponent(args.system);
                        if (args.prompt) _mmxUrl += '&prompt=' + encodeURIComponent(args.prompt);
                        if (args.text) _mmxUrl += '&text=' + encodeURIComponent(args.text);
                        if (args.voice) _mmxUrl += '&voice=' + encodeURIComponent(args.voice);
                        if (args.image) _mmxUrl += '&image=' + encodeURIComponent(args.image);
                        if (args.lyrics) _mmxUrl += '&lyrics=' + encodeURIComponent(args.lyrics);
                        if (args.aspect_ratio) _mmxUrl += '&aspect_ratio=' + encodeURIComponent(args.aspect_ratio);
                        if (args.n) _mmxUrl += '&n=' + parseInt(args.n);
                        if (args.instrumental === true) _mmxUrl += '&instrumental=true';
                        if (args.max_tokens) _mmxUrl += '&max_tokens=' + parseInt(args.max_tokens);
                        try {
                            var _mmxCtrl = new AbortController();
                            if (abortSignal) {
                                abortSignal.addEventListener('abort', function() { _mmxCtrl.abort(); }, { once: true });
                            }
                            var _to = setTimeout(function() { _mmxCtrl.abort(); }, 300000); // 5分钟超时
                            var _mmxResp = await window.proxyFetch(_mmxUrl, { signal: _mmxCtrl.signal });
                            clearTimeout(_to);
                            // speech 和 music: 生成后自动返回音频 URL
                            if (_mmxCmd === 'speech' || _mmxCmd === 'music') {
                                var _mmxText = await _mmxResp.text();
                                try {
                                    var _mmxJson = JSON.parse(_mmxText);
                                    var _audioUrl = _mmxJson?.result?.url || '';
                                    if (_audioUrl) {
                                        toolResult = { result: '✅ ' + (_mmxCmd === 'speech' ? '语音' : '音乐') + '已生成: ' + _audioUrl };
                                        // ★ 存入 pendingMsg，在气泡末尾统一渲染（与图片一致）
                                        // 不在此处调用 appendAudioToChat 避免被后续工具调用覆盖
                                        if (pendingMsg) {
                                            if (!pendingMsg._audioResults) pendingMsg._audioResults = [];
                                            pendingMsg._audioResults.push({
                                                url: _audioUrl,
                                                label: _mmxCmd === 'music' ? '🎵 生成的音乐' : '🔊 生成的语音',
                                                type: _mmxCmd
                                            });
                                        }
                                    } else {
                                        toolResult = { result: _mmxJson.result || JSON.stringify(_mmxJson) };
                                    }
                                } catch(e) {
                                    toolResult = { result: _mmxText };
                                }
                            } else if (_mmxCmd === 'chat') {
                                // ★ mmx_chat: 从 MiniMax 响应中提取 thinking 和文本
                                var _mmxData = await _mmxResp.json();
                                var _mmxRes = _mmxData.result || _mmxData;
                                // result 可能是 parsed JSON 或原始 JSON 字符串
                                if (typeof _mmxRes === 'string') {
                                    try { _mmxRes = JSON.parse(_mmxRes); } catch(e) {}
                                }
                                if (_mmxRes && typeof _mmxRes === 'object' && _mmxRes.content) {
                                    let _thinking = '', _text = '';
                                    (_mmxRes.content || []).forEach(function(c) {
                                        if (c.type === 'thinking') _thinking += c.thinking || '';
                                        if (c.type === 'text') _text += c.text || '';
                                    });
                                    var _md = '';
                                    if (_thinking) _md += '<details class="reasoning-details" open><summary>💭 思考过程</summary><div class="reasoning-content proxy-mode">' + _thinking + '</div></details>\n\n';
                                    if (_text) _md += _text;
                                    toolResult = { result: _md || JSON.stringify(_mmxRes) };
                                } else {
                                    toolResult = { result: typeof _mmxRes === 'object' ? JSON.stringify(_mmxRes, null, 2) : String(_mmxRes) };
                                }
                            } else {
                                // ★ voices/quota/image/video/vision — 直接返回 API 原始响应
                                var _mmxText2 = await _mmxResp.text();
                                try {
                                    var _mmxJson2 = JSON.parse(_mmxText2);
                                    toolResult = { result: _mmxJson2.result || _mmxJson2.data || JSON.stringify(_mmxJson2, null, 2) };
                                } catch(e2) {
                                    toolResult = { result: _mmxText2 };
                                }
                            }
                        } catch (_mmxErr) {
                            console.error('[mmx] 请求失败:', _mmxErr.message);
                            toolResult = { error: 'MiniMax CLI 调用失败: ' + (_mmxErr.message || '未知错误') };
                        }
                    } else if (func.name === 'generate_ppt' || func.name === 'generate_docx' || func.name === 'generate_xlsx' || func.name === 'generate_pdf') {
                        // ★ 文档生成工具: 透传 MCP Server (PPT/Word/Excel/PDF)
                        toolResult = await _mcpExecute(func.name, args);
                    } else if (func.name === 'video_edit') {
                        // ★ STT action: 特殊处理
                        if (args.action === 'stt') {
                            try {
                                var _sttBody = { action: 'stt', params: { language: args.params?.language || 'zh' }, input_path: args.input_path };
                                var _sttResp = await fetch('/engine/video_edit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(_sttBody) });
                                var _sttData = await _sttResp.json();
                                if (_sttData.error) { toolResult = { error: _sttData.error }; }
                                else if (_sttData.result) { toolResult = { result: '🎤 **语音识别结果:**\n' + _sttData.result }; }
                                else { toolResult = { error: 'STT返回为空' }; }
                            } catch(e) { toolResult = { error: 'STT请求失败: ' + e.message }; }
                            return toolResult;
                        }
                        var _srcEnginePath = args.input_path || '';
                        // ★ 智能补全: 如果没传 input_path,从当前聊天的上传文件里找
                        if (!_srcEnginePath && chats[chatId]) {
                            var _msgs2 = chats[chatId].messages;
                            for (var _vi2 = _msgs2.length-1; _vi2 >= 0; _vi2--) {
                                if (_msgs2[_vi2].files) {
                                    var _vf2 = _msgs2[_vi2].files.find(function(f){ return f.isVideo || (f.type && f.type.startsWith('video/')); });
                                    if (_vf2) { _srcEnginePath = _vf2.serverUrl || _vf2.content || ''; break; }
                                }
                            }
                        }
                        if (_srcEnginePath.startsWith('http')) _srcEnginePath = _srcEnginePath.replace(window.location.origin, '');
                        if (args.params && args.params.files && Array.isArray(args.params.files)) {
                            for (var _fi=0; _fi<args.params.files.length; _fi++) {
                                if (args.params.files[_fi].startsWith('http')) args.params.files[_fi] = args.params.files[_fi].replace(window.location.origin, '');
                            }
                        }
                        var _veditBody = { action: args.action || 'info', params: args.params || {}, input_path: _srcEnginePath };
                        if (args.output_path) _veditBody.output_path = args.output_path;
                        if (args.action === 'tts') {
                            _veditBody.params.api_key = await decrypt(localStorage.getItem('ttsApiKey')||'')||await decrypt(localStorage.getItem('visionApiKey')||'')||'';
                            _veditBody.params.provider = args.params?.provider || localStorage.getItem('ttsProvider') || 'minimax';
                            _veditBody.params.group_id = args.params?.group_id || '';
                        }
                        if (args.action === 'voice' && !_veditBody.params.api_key) {
                            _veditBody.params.api_key = await decrypt(localStorage.getItem('ttsApiKey')||'')||await decrypt(localStorage.getItem('visionApiKey')||'')||'';
                            _veditBody.params.provider = args.params?.provider || localStorage.getItem('ttsProvider') || 'minimax';
                            _veditBody.params.group_id = args.params?.group_id || '';
                        }
                        try {
                            var _ctlr = new AbortController();
                            var _to = setTimeout(function() { _ctlr.abort(); }, 600000); // 10分钟超时
                            // ★ 如果用户停止,同时 abort 这个 fetch
                            if (abortSignal) {
                                abortSignal.addEventListener('abort', function() { _ctlr.abort(); }, { once: true });
                            }
                            var _veditResp = await fetch('/engine/video_edit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(_veditBody), signal: _ctlr.signal });
                            clearTimeout(_to);
                            var _veditData = await _veditResp.json();
                            if (_veditData.error) { toolResult = { error: _veditData.error }; }
                            else { toolResult = { result: _veditData.result || '操作完成' }; }
                        } catch (_veditErr) {
                            console.error('[video_edit] 请求失败:', _veditErr.message);
                            toolResult = { error: '视频剪辑请求超时或失败: ' + (_veditErr.message || '未知错误') + '。请尝试缩小视频或降低分辨率后重试。' };
                        }
                    }
                    // ★ 办公文档工具: 直接走 MCP（仅当前端未处理时）
                    if (!toolResult && (/^generate_(ppt|docx|xlsx|pdf)$/.test(func.name) || /^cr_/.test(func.name) || func.name === 'video_understanding' || func.name === 'analyze_image' || func.name === 'rag_search' || func.name === 'plan_update' || func.name === 'delegate_task' || func.name === 'delegate_workflow' || func.name === 'ask_agent' || func.name === 'autonomous_mode' || func.name === 'toggle_proxy' || func.name === 'get_current_time')) {
                        toolResult = await _mcpExecute(func.name, args);
                    }
                    // ★ 通用 MCP fallback: 前端未知的工具统统转发到 MCP 服务器
                    if (!toolResult && func.name && !func.name.startsWith('mmx_')) {
                        toolResult = await _mcpExecute(func.name, args);
                    }
                    // ★ 反截断: 结果含长URL时追加提示
                    if (toolResult && toolResult.result) {
                        var _rt = String(toolResult.result);
                        if (/https?:\/\/[^\s]{30,}/.test(_rt) && _rt.length > 200) {
                            toolResult.result = _rt + '\n\n🔗 请使用完整链接，不要省略或截断。';
                        }
                    }
                    return toolResult;
                }

                // ★ MCP 统一执行代理 — 通用 PHP→MCP 转发
                async function _mcpExecute(toolName, args, onResult) {
                    var _mcpUrl = (typeof SERVER_API_BASE !== 'undefined' ? SERVER_API_BASE : '/oneapichat/api') + '/engine_api.php?action=mcp_proxy';
                    var _signal = (typeof abortSignal !== 'undefined' && abortSignal) ? abortSignal : AbortSignal.timeout(300000);
                    var _resp = await fetch(_mcpUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: toolName, arguments: args }),
                        signal: _signal,
                    });
                    var _data = await _resp.json();
                    if (_data.error) return { error: _data.error };
                    // ★ _data.result 可能是JSON字符串, 需要解析
                    var _res = _data.result;
                    if (typeof _res === 'string') {
                        try { _res = JSON.parse(_res); } catch(e) {}
                    }
                    if (typeof onResult === 'function') onResult(_res);
                    if (typeof _res === 'object') {
                        return { result: JSON.stringify(_res, null, 2), _mcpRaw: _res };
                    }
                    return { result: String(_res) };
                }

// ==================== Plan 模式审批横幅 ====================

/**
 * 在计划面板上方创建审批横幅（Plan 模式专用）
 * @param {number} taskCount - 任务数量
 */
window._createPlanApprovalBanner = function(taskCount) {
    // 避免重复创建
    var existing = document.getElementById('planApprovalBanner');
    if (existing) existing.remove();

    var panel = document.getElementById('flowPanel');
    if (!panel) return;

    var banner = document.createElement('div');
    banner.id = 'planApprovalBanner';
    banner.className = 'plan-approval-banner';
    banner.innerHTML =
        '<div class="plan-approval-text">' +
            '<span class="plan-approval-icon">📋</span>' +
            '计划已生成 — 共 <strong>' + taskCount + '</strong> 个步骤' +
        '</div>' +
        '<div class="plan-approval-actions">' +
            '<button class="plan-btn plan-btn-approve" onclick="window.approvePlan()">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ' +
                '同意执行' +
            '</button>' +
            '<button class="plan-btn plan-btn-modify" onclick="window.rejectPlan()">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> ' +
                '修改计划' +
            '</button>' +
            '<button class="plan-btn plan-btn-cancel" onclick="window.cancelPlan()">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> ' +
                '取消' +
            '</button>' +
        '</div>';

    // 插入到 flowPanel 最前面
    panel.insertBefore(banner, panel.firstChild);
};
