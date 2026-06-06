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
    }
    })(); // end async wrapper
}
