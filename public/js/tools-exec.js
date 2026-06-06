// tools-exec.js — 工具执行分发表 v1.0 (Phase 8 拆分自 main.js)
// executeToolCallForRetry — 100+ 工具分支的统一执行入口

                window.executeToolCallForRetry = async function(tc, abortSignal, ctx) {
    var body = ctx.body, pendingMsg = ctx.pendingMsg, chatId = ctx.chatId,
        currentChatId = ctx.currentChatId, activeBubbleMap = ctx.activeBubbleMap,
        chats = ctx.chats;
                    var func = tc.function;
                    let args;
                    try {
                        if (typeof func.arguments === 'string') {
                            // 尝试修复截断的JSON
                            var raw = func.arguments;
                            var qc = (raw.match(/"/g) || []).length;
                            if (qc % 2 !== 0) raw += '"';
                            var ob = (raw.match(/\{/g) || []).length;
                            var cb = (raw.match(/\}/g) || []).length;
                            while (cb < ob) { raw += '}'; cb++; }
                            // ★ 修复: 清理 JSON 字符串中的非法控制字符和未转义换行
                            raw = raw.replace(/[\x00-\x1f]/g, ' ').replace(/\n(?![^"\\]*(?:\\.[^"\\]*)*")/g, '\\n');
                            args = JSON.parse(raw || '{}');
                        } else {
                            args = func.arguments || {};
                        }
                    } catch (parseErr) {
                        // ★ 尝试更激进的修复: 直接按名称提取参数
                        var argStr2 = typeof func.arguments === 'string' ? func.arguments : '';
                        if (func.name === 'engine_agent_create') {
                            var nameMatch = argStr2.match(/"name"\s*:\s*"([^"]+)"/);
                            var promptMatch = argStr2.match(/"prompt"\s*:\s*"([\s\S]*?)"(?=\s*[,\}])/);
                            var modelMatch = argStr2.match(/"model"\s*:\s*"([^"]+)"/);
                            args = {
                                name: nameMatch ? nameMatch[1] : 'agent_' + Date.now(),
                                prompt: promptMatch ? promptMatch[1].replace(/\\n/g, '\n') : '搜索并整理相关信息',
                                model: modelMatch ? modelMatch[1] : ''
                            };
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
                            console.log('[plan_update] JSON修复模式, 提取到 action=' + args.action + ' task_id=' + args.task_id + ' status=' + args.status);
                        } else {
                            args = { query: typeof func.arguments === 'string' ? func.arguments : (func.arguments?.query || '') };
                        }
                    }
                    let toolResult = { error: `Unknown tool: ${func.name}` };

                    if (func.name === 'web_search') {
                        let query = args.query;
                        if (query) {
                            if (currentChatId === chatId) {
                                var currentBubble = activeBubbleMap[chatId];
                                if (currentBubble) {
                                    let status = currentBubble.querySelector('.search-status');
                                    if (!status) {
                                        status = document.createElement('div');
                                        status.className = 'search-status';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(status);
                                    }
                                    status.textContent = `🔧 工具调用: web_search("${query}")`;
                                }
                            }
                            try {
                                // 不传递外部signal,让performWebSearch使用自己的超时控制器
                                var searchResult = await performWebSearch(query, null, 'web');
                                var optimized = formatRawResults(searchResult);
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
                        // 支持 urls 数组 或 单个 url 字符串
                        if (Array.isArray(args.urls)) {
                            urls = args.urls.slice(0, 5); // 最多5个
                        } else if (typeof args.urls === 'string') {
                            urls = [args.urls];
                        } else if (typeof args.url === 'string') {
                            urls = [args.url];
                        }
                        if (urls.length > 0) {
                            if (currentChatId === chatId) {
                                var currentBubble = activeBubbleMap[chatId];
                                if (currentBubble) {
                                    let status = currentBubble.querySelector('.search-status');
                                    if (!status) {
                                        status = document.createElement('div');
                                        status.className = 'search-status';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(status);
                                    }
                                    status.textContent = `🌐 正在抓取网页 (${urls.length}个)...`;
                                }
                            }
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
                                    toolResult = { result: parts.join('\n\n---\n\n'), _webFetchUrls: urls };
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
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('exec', args); }
                        } else { toolResult = await engineApiHandler('exec', args); }
                    }
                     else if (func.name === 'server_python') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('python', args); }
                        } else { toolResult = await engineApiHandler('python', args); }
                    }
                     else if (func.name === 'server_file_read') {
                        toolResult = await engineApiHandler('file_read', args);
                    }
                     else if (func.name === 'server_file_write') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('file_write', args); }
                        } else { toolResult = await engineApiHandler('file_write', args); }
                    }
                     else if (func.name === 'server_file_edit') {
                        // ★ 参数别名容错
                        if (!args.old_string && args.old_str) args.old_string = args.old_str;
                        if (!args.new_string && args.new_str) args.new_string = args.new_str;
                        if (!args.path) {
                            toolResult = { error: '缺少 path 参数。格式: server_file_edit(path="/path/to/file", old_string="原文", new_string="新文")' };
                        } else if (!args.old_string || !args.new_string) {
                            toolResult = { error: '缺少 old_string 或 new_string 参数' };
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
                                toolResult = { result: '✅ 已获得单次授权。\n\n⚠️ 重要规则：\n1. 搜索类任务必须用 delegate_task 创建子代理来执行，禁止直接用 web_search 然后谎称是子代理做的\n2. 子代理创建后必须等待其完成（用 engine_agent_status 查询），不要同时自己搜\n3. 只有超过2次搜索或需要分析/总结的复杂任务才需要子代理\n4. 简单搜索（≤2次）可以直接用 web_search\n\n可用工具：delegate_task（子代理）、engine_agent_create、web_search、web_fetch、server_exec 等。完成后权限自动回收。' };
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
                        if (planAction === 'create') {
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
                                toolResult = { result: '✅ 已创建计划，共 ' + planTasks.length + ' 个任务：\n' + planTasks.map(function(t) { return '- [' + t.status + '] ' + t.title; }).join('\n') + '\n\n现在按计划逐步执行，每完成一步调用 plan_update(action="update", task_id="...", status="completed") 更新状态。' };
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
                        } else if (planAction === 'complete') {
                            if (window._agentPlan) {
                                window._agentPlan.status = 'completed';
                                // 将所有未终态的任务标记为 completed
                                window._agentPlan.tasks.forEach(function(t) {
                                    if (t.status === 'pending' || t.status === 'running') t.status = 'completed';
                                });
                                window.renderPlanTasks(window._agentPlan.tasks);
                                setTimeout(function() { window.dismissFlowPanel(); }, 2500);
                                toolResult = { result: '✅ 计划已完成，所有任务已标记为完成。面板将在几秒后自动关闭。' };
                            } else {
                                toolResult = { error: '没有活跃计划可完成。' };
                            }
                        } else {
                            toolResult = { error: '未知 action: "' + planAction + '" 。支持的值: create, update, complete。' };
                        }
                    }
                     else if (func.name === 'engine_agent_ask') {
                        toolResult = await engineApiHandler('agent_ask', args);
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
                    // ===== Cloudreve 云盘工具 =====
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
                    // ===== SRC 星穹铁道工具 (完整版) =====
                     else if (func.name === 'src_status') {
                        var r = await _srcApi('/status?config_name=src');
                        toolResult = r.ok ? { result: (r.alive ? '✅ 运行中' : '❌ ' + (r.state_label || '已停止')) + ' | state=' + (r.state||'') } : { error: r.error || '获取状态失败' };
                    }
                     else if (func.name === 'src_dashboard') {
                        var r = await _srcApi('/dashboard?config_name=src');
                        if (r.ok && r.resources) {
                            var res = r.resources;
                            var lines = [];
                            var fmts = { trailblaze_power: '⚡体力', reserved_power: '💾后备体力', fuel: '⛽燃料', stellar_jade: '💎星琼', credit: '💰信用点', immersifier: '📿沉浸器', battle_pass_level: '📊大月卡', daily_activity: '📋活跃度', simulated_universe: '🌌模拟宇宙分', echo_of_war: '⚔️历战余响', relic: '📦遗器碎片' };
                            Object.keys(fmts).forEach(function(k) {
                                if (res[k]) lines.push(fmts[k] + ': ' + (res[k].value||0) + '/' + (res[k].total||'∞') + (res[k].time ? ' (' + res[k].time + ')' : ''));
                            });
                            toolResult = { result: '📊 资源面板:\n' + lines.join('\n') + '\n\n更新: ' + (r.updated_at || '') };
                        } else { toolResult = { error: r.error || '获取失败' }; }
                    }
                     else if (func.name === 'src_start') {
                        var task = args.task || 'Alas';
                        var r = await _srcApi('/run', { method: 'POST', body: JSON.stringify({ config_name: 'src', task: task }) });
                        toolResult = r.ok ? { result: '✅ ' + task + ' 已启动' } : { error: r.error || '启动失败(可能已在运行,需先停止)' };
                    }
                     else if (func.name === 'src_stop') {
                        var r = await _srcApi('/stop', { method: 'POST', body: JSON.stringify({ config_name: 'src' }) });
                        toolResult = r.ok ? { result: '✅ SRC 已停止' } : { error: r.error || '停止失败' };
                    }
                     else if (func.name === 'src_get_tasks') {
                        var r = await _srcApi('/tasks?config_name=src');
                        if (r.ok && r.tasks) {
                            var lines = r.tasks.map(function(t) {
                                return (t.enable ? '✅' : '⏸️') + ' ' + t.name + ': ' + (t.description||'') + (t.next_run ? ' → ' + t.next_run : '');
                            });
                            toolResult = { result: '📋 任务列表:\n' + lines.join('\n') };
                        } else { toolResult = { error: r.error || '获取失败' }; }
                    }
                     else if (func.name === 'src_toggle_task') {
                        // 通过配置路径修改任务启用状态
                        var taskName = args.name;
                        var taskPathMap = { Dungeon: 'Dungeon.Scheduler.Enable', Weekly: 'Weekly.Scheduler.Enable', Rogue: 'Rogue.Scheduler.Enable', Ornament: 'Ornament.Scheduler.Enable', Daemon: 'Daemon.Scheduler.Enable', DailyQuest: 'DailyQuest.Scheduler.Enable', BattlePass: 'BattlePass.Scheduler.Enable', Assignment: 'Assignment.Scheduler.Enable', Freebies: 'Freebies.Scheduler.Enable', PlannerScan: 'PlannerScan.Scheduler.Enable' };
                        var path = taskPathMap[taskName];
                        if (!path) { toolResult = { error: '未知任务: ' + taskName + ', 可选: ' + Object.keys(taskPathMap).join(', ') }; }
                        else {
                            var r = await _srcApi('/config/src', { method: 'PUT', body: JSON.stringify({ path: path, value: !!args.enable }) });
                            toolResult = r.ok ? { result: (args.enable ? '✅' : '⏸️') + ' ' + taskName + '已' + (args.enable ? '启用' : '禁用') } : { error: r.error || '操作失败' };
                        }
                    }
                     else if (func.name === 'src_get_config') {
                        var r = await _srcApi('/config/src');
                        toolResult = r.ok ? { result: JSON.stringify(r.data, null, 2) } : { error: r.error || '获取配置失败' };
                    }
                     else if (func.name === 'src_set_config') {
                        var path = args.path, val = args.value;
                        if (val === 'true' || val === 'True') val = true;
                        else if (val === 'false' || val === 'False') val = false;
                        else if (/^\d+$/.test(val)) val = parseInt(val);
                        else if (/^\d+\.\d+$/.test(val)) val = parseFloat(val);
                        var r = await _srcApi('/config/src', { method: 'PUT', body: JSON.stringify({ path: path, value: val }) });
                        toolResult = r.ok ? { result: '✅ ' + path + ' = ' + JSON.stringify(val) } : { error: r.error || '保存失败' };
                    }
                     else if (func.name === 'src_get_logs') {
                        var lines = Math.min(args.lines || 50, 200);
                        var r = await _srcApi('/logs?config_name=src&limit=' + lines);
                        var logLines = r.lines || r.logs || [];
                        // 过滤掉 rich.table.Table 对象
                        var filtered = logLines.filter(function(l) { return typeof l === 'string' && l.indexOf('<rich.table.Table') === -1; });
                        toolResult = r.ok ? { result: filtered.join('\n') || '(日志为空)' } : { error: r.error || '获取失败' };
                    }
                     else if (func.name === 'src_check_upgrade') {
                        var r = await fetch('/oneapichat/api/src_upgrade.php?action=check');
                        var d = await r.json();
                        toolResult = d.ok ? { result: '当前: ' + d.current + ', 落后 ' + d.behind + ' commit, ' + (d.need_update ? '🔔需要更新' : '✅已是最新') } : { error: d.error || '检查失败' };
                    }
                     else if (func.name === 'src_do_upgrade') {
                        if (!confirm('⚠️ AI请求SRC升级\n\ngit pull + pip install + 重启\n\n确认?')) {
                            toolResult = { result: '❌ 取消升级' };
                        } else {
                            var r = await fetch('/oneapichat/api/src_upgrade.php?action=upgrade');
                            var d = await r.json();
                            toolResult = d.ok ? { result: '✅ ' + (d.message || '升级完成') + '\n' + (d.output || '') } : { error: d.error || '升级失败' };
                        }
                    }
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
                                        model: localStorage.getItem('model') || 'deepseek-chat'
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
                status.textContent = '🎨 正在生成图片...';

                // ★ 添加图片占位符: 先清除旧占位符,避免重复
                var _oldPh = currentBubble.querySelector('#image-placeholder');
                if (_oldPh) _oldPh.remove();
                var placeholder = document.createElement('div');
                placeholder.id = 'image-placeholder';
                placeholder.style = 'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:12px;padding:40px 20px;text-align:center;margin:12px 0;color:white;animation:pulse 2s infinite;';
                placeholder.innerHTML = '<div style="font-size:24px;margin-bottom:8px;">🎨</div><div style="font-size:14px;">图片生成中' + ((args.n || 1) > 1 ? ' (' + (args.n || 1) + '张)' : '') + ',请稍候...</div><div style="font-size:12px;margin-top:8px;opacity:0.8;">' + escapeHtml(prompt.substring(0, 30)) + '...</div>';
                currentBubble.querySelector('.markdown-body')?.appendChild(placeholder);
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
                // ★ 累积所有图片(支持多次调用)
                if (!pendingMsg.generatedImages) pendingMsg.generatedImages = [];
                var _imgUrlsFinal = typeof imageResult === 'string' ? [imageResult] : imageResult;
                for (var _giF = 0; _giF < _imgUrlsFinal.length; _giF++) {
                    var _imgF = _imgUrlsFinal[_giF];
                    pendingMsg.generatedImages.push(_imgF);
                    if (_giF === 0) pendingMsg.generatedImage = _imgF;
                    // 异步上传到服务器,上传成功后替换为服务器URL(避免localStorage溢出)
                    if (_imgF && !_imgF.startsWith(window.location.origin) && !_imgF.startsWith('/oneapichat')) {
                        (function(_origUrl, _idx) {
                            uploadImageToServer(_origUrl).then(function(srvUrl) {
                                if (srvUrl) {
                                    console.log('[Image] 已上传生成图片:', srvUrl);
                                    // ★ 替换 pendingMsg 中的 base64 为服务器 URL
                                    var _pos = pendingMsg.generatedImages.indexOf(_origUrl);
                                    if (_pos !== -1) pendingMsg.generatedImages[_pos] = srvUrl;
                                    if (pendingMsg.generatedImage === _origUrl) pendingMsg.generatedImage = srvUrl;
                                    // ★ 同步到 chats 消息对象
                                    var _msgIdx = chats[chatId] && chats[chatId].messages ? chats[chatId].messages.findIndex(function(m) { return m === pendingMsg; }) : -1;
                                    if (_msgIdx !== -1) {
                                        var _cm = chats[chatId].messages[_msgIdx];
                                        if (_cm.generatedImages && _cm.generatedImages[_idx] === _origUrl) _cm.generatedImages[_idx] = srvUrl;
                                        if (_cm.generatedImage === _origUrl) _cm.generatedImage = srvUrl;
                                    }
                                    // ★ 图片URL替换后立即保存,防止刷新丢失
                                    slimSaveChats();
                                }
                            }).catch(function(e) {
                                console.warn('[Image] 上传生成图片失败:', e.message);
                            });
                        })(_imgF, _giF);
                    }
                }
                // ★ 图片已添加到消息,立即保存到 localStorage 防止刷新丢失
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
                                        if (status) status.textContent = '🎨 正在图生图(' + _allImages.length + '张参考图)...';
                                        var placeholder = document.createElement('div');
                                        placeholder.id = 'image-placeholder';
                                        placeholder.style = 'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:12px;padding:40px 20px;text-align:center;margin:12px 0;color:white;animation:pulse 2s infinite;';
                                        placeholder.innerHTML = '<div style="font-size:24px;margin-bottom:8px;">🎨</div><div style="font-size:14px;">图生图中' + ((args.n || 1) > 1 ? ' (' + (args.n || 1) + '张)' : '') + ',请稍候...</div><div style="font-size:12px;margin-top:8px;opacity:0.8;">' + escapeHtml(userPrompt.substring(0, 30)) + '...</div>';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(placeholder);
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
                                    for (var _giI2i = 0; _giI2i < _imgUrlsI2i.length; _giI2i++) {
                                        var _imgI2i = _imgUrlsI2i[_giI2i];
                                        pendingMsg.generatedImages.push(_imgI2i);
                                        if (_giI2i === 0) pendingMsg.generatedImage = _imgI2i;
                                        // 异步上传到服务器,上传成功后替换为服务器URL(避免localStorage溢出)
                                        if (_imgI2i && !_imgI2i.startsWith(window.location.origin) && !_imgI2i.startsWith('/oneapichat')) {
                                            (function(_origUrl, _idx) {
                                                uploadImageToServer(_origUrl).then(function(srvUrl) {
                                                    if (srvUrl) {
                                                        console.log('[Image] i2i已上传:', srvUrl);
                                                        // ★ 替换 pendingMsg 中的 base64 为服务器 URL
                                                        var _pos = pendingMsg.generatedImages.indexOf(_origUrl);
                                                        if (_pos !== -1) pendingMsg.generatedImages[_pos] = srvUrl;
                                                        if (pendingMsg.generatedImage === _origUrl) pendingMsg.generatedImage = srvUrl;
                                                        // ★ 同步到 chats 消息对象
                                                        var _msgIdx = chats[chatId] && chats[chatId].messages ? chats[chatId].messages.findIndex(function(m) { return m === pendingMsg; }) : -1;
                                                        if (_msgIdx !== -1) {
                                                            var _cm = chats[chatId].messages[_msgIdx];
                                                            if (_cm.generatedImages && _cm.generatedImages[_idx] === _origUrl) _cm.generatedImages[_idx] = srvUrl;
                                                            if (_cm.generatedImage === _origUrl) _cm.generatedImage = srvUrl;
                                                        }
                                                        // ★ 图片URL替换后立即保存,防止刷新丢失
                                                        slimSaveChats();
                                                    }
                                                }).catch(function(e) {
                                                    console.warn('[Image] i2i上传失败:', e.message);
                                                });
                                            })(_imgI2i, _giI2i);
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
                                // ★ 根据 API 类型选择最佳图片源:
                                // 直连 API (MiniMax) 需要 data: URL,否则会报 invalid image URL
                                // MCP 代理可以用 HTTP URL
                                var _visUrl = localStorage.getItem('visionApiUrl') || DEFAULT_CONFIG.visionApiUrl || '/mcp';
                                var _isDirectVision = _visUrl.toLowerCase().indexOf('/mcp') === -1;
                                var analyzeInput;
                                if (_isDirectVision) {
                                    // 直连模式: 优先 base64 content, HTTP URL 会导致 MiniMax 报错
                                    analyzeInput = imageFile.content || '';
                                    if ((!analyzeInput || !analyzeInput.startsWith('data:')) && imageFile.serverUrl) {
                                        var fullUrl = imageFile.serverUrl.startsWith('http') ? imageFile.serverUrl : window.location.origin + imageFile.serverUrl;
                                        analyzeInput = fullUrl;
                                    }
                                } else {
                                    // MCP 代理: 优先服务器 URL
                                    analyzeInput = imageFile.content || '';
                                    if (imageFile.serverUrl && typeof imageFile.serverUrl === 'string') {
                                        var fullUrl = imageFile.serverUrl.startsWith('http') ? imageFile.serverUrl : window.location.origin + imageFile.serverUrl;
                                        analyzeInput = fullUrl;
                                    }
                                }
                                var analyzeResult = await window.analyzeImage(analyzeInput, focus);
                                toolResult = { result: analyzeResult };
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
                                        if ($.chatBox) $.chatBox.scrollTop = $.chatBox.scrollHeight;
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
                    return toolResult;
                }

