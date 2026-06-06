// commands.js — 斜杠命令处理 v1.0 (Phase 9 拆分自 main.js)
// parseCommand / handleSlashCommand — /cmd 解析与分派

window.parseCommand = function(text) {
    if (!text) return null;
    var parts = text.split(/\s+/);
    var cmd = parts[0].toLowerCase();
    var rest = parts.slice(1).join(' ').trim();
    // 搜索类
    if (cmd === '/search' || cmd === '/s') return { type: 'command', cmd: 'force_search', query: rest, kind: 'web' };
    if (cmd === '/news') return { type: 'command', cmd: 'force_search', query: rest, kind: 'news' };
    if (cmd === '/image') return { type: 'command', cmd: 'force_search', query: rest, kind: 'images' };
    // 模式切换
    if (cmd === '/mode' || cmd === '/agent') {
        var m = (rest || 'agent').toLowerCase();
        if (['off','plan','agent','yolo'].indexOf(m) === -1) m = 'agent';
        return { type: 'command', cmd: 'set_mode', mode: m };
    }
    // 模型切换
    if (cmd === '/model') return { type: 'command', cmd: 'set_model', model: rest };
    // 对话管理
    if (cmd === '/clear') return { type: 'command', cmd: 'clear_chat' };
    if (cmd === '/compact') return { type: 'command', cmd: 'compact' };
    if (cmd === '/new') return { type: 'command', cmd: 'new_chat' };
    // 帮助
    if (cmd === '/help' || cmd === '/?') return { type: 'command', cmd: 'show_help' };
    // 系统
    if (cmd === '/config') return { type: 'command', cmd: 'open_config' };
    if (cmd === '/logout') return { type: 'command', cmd: 'logout' };
    // 重试
    if (cmd === '/retry') return { type: 'command', cmd: 'retry' };
    // 导出
    if (cmd === '/export') return { type: 'command', cmd: 'export_chat' };
    // 记忆
    if (cmd === '/remember') return { type: 'command', cmd: 'remember', content: rest };
    // ★ 新增命令 (Phase 3b)
    if (cmd === '/copy') return { type: 'command', cmd: 'copy' };
    if (cmd === '/stop') return { type: 'command', cmd: 'stop_gen' };
    if (cmd === '/diff') return { type: 'command', cmd: 'show_diff', args: rest };
    if (cmd === '/doctor') return { type: 'command', cmd: 'doctor' };
    if (cmd === '/context') return { type: 'command', cmd: 'show_context' };
    if (cmd === '/agents') return { type: 'command', cmd: 'list_agents' };
    if (cmd === '/color') return { type: 'command', cmd: 'set_color', theme: rest || 'auto' };
    return null;
}

// ★ 处理 /slash 命令
window.handleSlashCommand = function(cmd) {
    var modeLabels = { off:'已关闭', plan:'Plan 只读模式', agent:'Agent 交互模式', yolo:'YOLO 自动模式' };
    // ★ 异步包装 async 分支
    var _async = (async function() {
    if (cmd.cmd === 'set_mode') {
        setAgentMode(cmd.mode);
        showToast('已切换到 ' + (modeLabels[cmd.mode] || cmd.mode), 'success', 3000);
    } else if (cmd.cmd === 'set_model') {
        var sel = document.getElementById('modelSelect');
        if (!sel) return;
        var models = Array.from(sel.options).filter(function(o) { return o.value; });
        if (!cmd.model) {
            // 无参数: 显示模型列表供选择
            var list = models.slice(0, 15).map(function(o) { return o.value; }).join('\n');
            appendMessage('system', '📋 可用模型 (输入 /model <名称> 切换):\n' + list);
            return;
        }
        // 有参数: 模糊匹配
        var q = cmd.model.toLowerCase();
        var best = null; var bestScore = 0;
        models.forEach(function(o) {
            var v = o.value.toLowerCase();
            if (v === q) { best = o; bestScore = 999; }
            else if (v.indexOf(q) >= 0 && bestScore < 100) { var s = q.length / v.length; if (s > bestScore) { best = o; bestScore = s; } }
        });
        if (best) {
            sel.value = best.value;
            localStorage.setItem('model', best.value);
            var _p = getEl('baseUrlProvider')?.value || 'custom';
            localStorage.setItem('model_' + _p, best.value);
            var toast = showToast('已切换: ' + best.text, 'success', 3000);
        } else {
            var partials = models.filter(function(o) { return o.value.toLowerCase().indexOf(q) >= 0; });
            if (partials.length > 0) {
                appendMessage('system', '🔍 匹配结果 (输入完整名称切换):\n' + partials.map(function(o) { return o.value; }).join('\n'));
            } else {
                appendMessage('system', '❌ 未找到模型: ' + cmd.model);
            }
        }
    } else if (cmd.cmd === 'clear_chat') {
        var cid = currentChatId;
        if (cid && chats[cid]) {
            // ★ 真正清空:重建整个 chat 对象,保留标题和时间
            var title = chats[cid].title;
            var createdAt = chats[cid].created_at || chats[cid].updated_at || Date.now();
            var agentMode = getAgentMode();
            // Agent 模式下用 agent system prompt, 普通模式用普通 system prompt
            var sysPrompt = '';
            if (cid === '_agent_main' && agentMode !== 'off') {
                sysPrompt = localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt;
            } else {
                sysPrompt = getVal('systemPrompt') || DEFAULT_CONFIG.system;
            }
            chats[cid] = {
                title: title,
                userId: chats[cid].userId || localStorage.getItem('authUserId') || '',
                created_at: createdAt,
                updated_at: Date.now(),
                messages: [{ role: 'system', content: sysPrompt }]
            };
            // 清理额外数据
            delete chats[cid]._agentMessages;
            delete chats[cid]._internalToolCalls;
            saveChats();
            // ★ 全量重渲染(updateHeaderTitle + refreshAll)
            var container = $.chatMessagesContainer;
            if (container) {
                container.innerHTML = '';
                showWelcome();
            }
            renderChatHistory();
            updateHeaderTitle();
            showToast('✅ 对话已完全清空', 'success', 2000);
        }
    } else if (cmd.cmd === 'new_chat') {
        createNewChat();
    } else if (cmd.cmd === 'compact') {
        compressContextIfNeeded();
    } else if (cmd.cmd === 'show_help') {
        var helpText = SLASH_COMMANDS.map(function(c) {
            return ' `/' + c.cmd + '`' + (c.args ? ' *' + c.args + '*' : '') + ' - ' + c.hint;
        }).join('\n');
        appendMessage('system', '## ⌨️ 命令列表\n' + helpText + '\n\n> 输入 `/` 可随时唤出命令面板');
    } else if (cmd.cmd === 'open_config') {
        toggleConfigPanel();
        showToast('已打开配置面板', 'info', 2000);
    } else if (cmd.cmd === 'logout') {
        if (confirm('确定退出登录?')) { logout(); }
    } else if (cmd.cmd === 'retry') {
        var cid = currentChatId;
        if (!cid || !chats[cid]) return;
        var msgs = chats[cid].messages;
        // 找到最后一条 assistant 消息,删除它,然后重新发送上一条 user 消息
        var lastAssistIdx = -1;
        for (var i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant' && !msgs[i].partial) { lastAssistIdx = i; break; }
        }
        if (lastAssistIdx >= 0) {
            // 找到这条 assistant 前面的最后一条 user
            var lastUserIdx = -1;
            for (var i = lastAssistIdx - 1; i >= 0; i--) {
                if (msgs[i].role === 'user') { lastUserIdx = i; break; }
            }
            if (lastUserIdx >= 0) {
                var userMsg = msgs[lastUserIdx];
                msgs.splice(lastAssistIdx);
                saveChats();
                renderChatHistory();
                sendMessage(true, userMsg.text, userMsg.files);
            }
        }
    } else if (cmd.cmd === 'export_chat') {
        var cid = currentChatId;
        if (!cid || !chats[cid]) return;
        var msgs = chats[cid].messages;
        var md = '# ' + (chats[cid].title || '对话') + '\n\n' + msgs.filter(function(m) { return m.role !== 'system' && !m.temporary && !m._internal; }).map(function(m) {
            var role = m.role === 'user' ? '🧑 用户' : '🤖 AI';
            return '## ' + role + '\n' + (m.text || m.content || '');
        }).join('\n\n---\n\n');
        var blob = new Blob([md], { type: 'text/markdown' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = (chats[cid].title || 'chat') + '.md';
        a.click();
        URL.revokeObjectURL(url);
        showToast('已导出为 Markdown', 'success', 2000);
    } else if (cmd.cmd === 'remember') {
        // /remember key: content
        var parts = (cmd.content || '').split(':');
        if (parts.length >= 2) {
            var key = parts[0].trim();
            var content = parts.slice(1).join(':').trim();
            if (key && content) {
                var token = localStorage.getItem('authToken');
                try {
                    var resp = await fetch('/oneapichat/api/memory_api.php?action=save_memory&token=' + encodeURIComponent(token), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: key, content: content })
                    });
                    var data = await resp.json();
                    if (data.success) {
                        window._loadCloudMemories();
                        showToast('已记住: ' + key, 'success', 2000);
                    } else {
                        showToast('保存失败', 'error');
                    }
                } catch(e) { showToast('保存失败', 'error'); }
            } else {
                appendMessage('system', '用法: /remember 键: 内容\n例: /remember user_name: 向奕侨');
            }
        } else {
            // 无参数: 显示已保存的记忆
            window.refreshMemoryList?.();
            var token2 = localStorage.getItem('authToken');
            try {
                var resp2 = await fetch('/oneapichat/api/memory_api.php?action=get_memories&token=' + encodeURIComponent(token2));
                var data2 = await resp2.json();
                if (data2.success && data2.memories.length > 0) {
                    var list = data2.memories.map(function(m) { return '- `' + m.key + '`: ' + m.content; }).join('\n');
                    appendMessage('system', '📝 已保存的记忆:\n' + list);
                } else {
                    appendMessage('system', '📝 暂无保存的记忆');
                }
            } catch(e) {}
            showToast('用法: /remember 键: 内容', 'info', 3000);
        }
    // ★ Phase 3b: 新增命令处理
    } else if (cmd.cmd === 'copy') {
        var cid2 = currentChatId;
        if (!cid2 || !chats[cid2]) return;
        var msgs2 = chats[cid2].messages;
        var lastAI = '';
        for (var i2 = msgs2.length - 1; i2 >= 0; i2--) {
            if (msgs2[i2].role === 'assistant' && !msgs2[i2].partial) { lastAI = msgs2[i2].content || msgs2[i2].text || ''; break; }
        }
        if (lastAI) {
            navigator.clipboard.writeText(lastAI).then(function() {
                showToast('📋 已复制最后回复 (' + lastAI.length + ' 字符)', 'success', 2000);
            }).catch(function() {
                showToast('❌ 复制失败', 'error');
            });
        } else {
            showToast('📋 暂无 AI 回复可复制', 'info');
        }
    } else if (cmd.cmd === 'stop_gen') {
        // ★ 停止当前生成
        if (window._activeAbortCtrl) {
            try { window._activeAbortCtrl.abort(); } catch(e) {}
            showToast('⏹️ 已中止生成', 'info', 2000);
        } else {
            showToast('⚠️ 当前没有进行中的生成', 'info', 2000);
        }
    } else if (cmd.cmd === 'show_diff') {
        // ★ 显示 git diff
        var diffCmd = 'cd /var/www/html/oneapichat && git diff --stat 2>&1';
        if (cmd.args) diffCmd = 'cd /var/www/html/oneapichat && git diff ' + cmd.args.replace(/[^a-zA-Z0-9._\-\/\s]/g, '') + ' 2>&1';
        try {
            var diffResp = await fetch('/engine/exec', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({cmd: diffCmd, timeout: 10})
            });
            var diffData = await diffResp.json();
            var diffOutput = (diffData.result || diffData.stdout || diffData.error || '(无差异)');
            appendMessage('system', '## 📊 Git Diff\n```diff\n' + diffOutput.substring(0, 4000) + '\n```');
        } catch(e) {
            appendMessage('system', '❌ 无法获取 diff: ' + e.message);
        }
    } else if (cmd.cmd === 'doctor') {
        // ★ 系统诊断
        showToast('🔍 运行诊断...', 'info', 3000);
        appendMessage('system', '## 🩺 系统诊断\n');
        var checks = [];
        // 引擎健康
        try {
            var hResp = await fetch('/engine/health');
            checks.push(hResp.ok ? '✅ 引擎服务正常' : '❌ 引擎服务异常 (' + hResp.status + ')');
        } catch(e) { checks.push('❌ 引擎服务不可达: ' + e.message); }
        // 会话状态
        checks.push('📋 活跃对话: ' + Object.keys(chats).length + ' 个');
        // localStorage 用量
        var lsUsed = JSON.stringify(localStorage).length;
        checks.push('💾 localStorage: ' + (lsUsed / 1024 / 1024).toFixed(1) + ' MB / 5 MB');
        // 当前引擎模式
        checks.push('🔄 可恢复流式: ' + (localStorage.getItem('__enableResumeStream') !== '0' ? '已启用' : '已禁用'));
        // 代理状态
        checks.push('🌐 代理: ' + (window.isProxyEnabled ? (window.isProxyEnabled() ? '已启用' : '已禁用') : '未知'));
        checks.push('📡 在线状态: ' + (navigator.onLine ? '在线' : '离线'));
        appendMessage('system', checks.join('\n'));
    } else if (cmd.cmd === 'show_context') {
        // ★ 上下文用量估算
        var cid3 = currentChatId;
        if (!cid3 || !chats[cid3]) { appendMessage('system', '❌ 无活跃对话'); return; }
        var msgs3 = chats[cid3].messages;
        var totalChars = 0, systemChars = 0, userChars = 0, assistantChars = 0;
        msgs3.forEach(function(m) {
            var len = (m.content || m.text || '').length + (m.reasoning || '').length;
            totalChars += len;
            if (m.role === 'system') systemChars += len;
            else if (m.role === 'user') userChars += len;
            else if (m.role === 'assistant') assistantChars += len;
        });
        var estTokens = Math.round(totalChars / 3.5); // 粗略估算: 3.5 字符 ≈ 1 token
        appendMessage('system', '## 📐 上下文用量估算\n' +
            '💬 总消息: ' + msgs3.length + ' 条\n' +
            '📝 总字符: ' + totalChars.toLocaleString() + ' (~' + estTokens.toLocaleString() + ' tokens)\n' +
            '  ├ system: ' + (systemChars/1024).toFixed(1) + ' KB\n' +
            '  ├ user: ' + (userChars/1024).toFixed(1) + ' KB\n' +
            '  └ assistant: ' + (assistantChars/1024).toFixed(1) + ' KB\n' +
            '📊 估算占比: ' + Math.round(estTokens / 128000 * 100) + '% of 128K 上下文');
    } else if (cmd.cmd === 'list_agents') {
        // ★ 列出活跃子代理
        var token3 = localStorage.getItem('authToken') || '';
        try {
            var agResp = await fetch('/oneapichat/api/engine_api.php?action=agent_list&auth_token=' + token3);
            var agData = await agResp.json();
            if (agData.agents && agData.agents.length > 0) {
                var agList = agData.agents.map(function(a) {
                    return '- `' + (a.name || a.id || '?') + '` [' + (a.status || '?') + '] ' + (a.task || '');
                }).join('\n');
                appendMessage('system', '## 🤖 活跃子代理\n' + agList);
            } else {
                appendMessage('system', '🤖 暂无活跃子代理');
            }
        } catch(e) { appendMessage('system', '❌ 查询失败: ' + e.message); }
    } else if (cmd.cmd === 'set_color') {
        // ★ 主题颜色切换
        var theme = cmd.theme || 'auto';
        var root = document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
            localStorage.setItem('theme', 'dark');
            showToast('🌙 深色模式', 'success', 2000);
        } else if (theme === 'light') {
            root.classList.remove('dark');
            localStorage.setItem('theme', 'light');
            showToast('☀️ 浅色模式', 'success', 2000);
        } else {
            root.classList.remove('dark');
            localStorage.setItem('theme', 'auto');
            showToast('🔄 自动模式（跟随系统）', 'success', 2000);
        }
    }
    })(); // end async wrapper
}
