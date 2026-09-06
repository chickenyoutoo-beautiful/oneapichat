// commands.js — 斜杠命令处理 v2.0 (Phase 9 拆分自 main.js & 2026-08-16 全面优化)
// parseCommand / handleSlashCommand — /cmd 解析与分派

// 识别自然语言中的“找现成图片”意图。它与“生成新图片”严格分流：
// - 搜索/收集/找 + 图片类名词 => image_search
// - 明确先搜索再参考生成 => search_and_generate
// - 单纯画/生成/设计 => null，继续交给生图工具
window.classifyImageRequestIntent = function(text) {
    var raw = String(text || '').trim();
    if (!raw || raw.startsWith('/') || raw.startsWith('／')) return null;

    var hasImageNoun = /(图片|图像|照片|相片|壁纸|梗图|迷因|表情包|截图|插图|插画|素材图|参考图|剧照|海报图|头像|image|images|photo|photos|picture|pictures|wallpaper|meme|memes)/i.test(raw);
    var hasSearchVerb = /(搜索|搜一搜|搜搜|搜集|收集|查找|找一下|找一找|帮我找|给我找|找几|找些|找点|推荐几|整理几|看看.{0,8}(?:图片|照片|梗图|表情包)|search|find|look\s*for|collect|browse)/i.test(raw);
    if (!hasImageNoun || !hasSearchVerb) return null;

    var hasGenerateVerb = /(生成|创作|绘制|画一|画成|设计一|重绘|改成|做成|变体|换风格|合成|generate|create|draw|redraw|variation)/i.test(raw);
    var hasReferenceCue = /(参考|基于|照着|仿照|依据|使用搜索结果|用搜索结果|从搜索结果|以上图片|这些图片|找到后|搜索后|搜完后|然后|接着|再生成|并生成|同时生成|reference|based on|then|after)/i.test(raw);

    if (hasGenerateVerb) {
        return hasReferenceCue ? { kind: 'images', imageMode: 'search_and_generate', query: raw } : null;
    }
    return { kind: 'images', imageMode: 'search_only', query: raw };
};

window.parseCommand = function(text) {
    if (!text) return null;
    var trimmed = text.trim();
    // 兼容全角斜杠
    if (trimmed.startsWith('／')) trimmed = '/' + trimmed.slice(1);
    if (!trimmed.startsWith('/')) return null;

    var parts = trimmed.split(/\s+/);
    var cmd = parts[0].toLowerCase();
    var rest = parts.slice(1).join(' ').trim();

    // 搜索类（type: 'search'，交给 handleSearchFlow 处理）
    if (cmd === '/search' || cmd === '/s') return { type: 'search', cmd: 'force_search', query: rest, kind: 'web' };
    if (cmd === '/news') return { type: 'search', cmd: 'force_search', query: rest, kind: 'news' };
    if (cmd === '/image') {
        // /image 默认只搜索已有图片；若同一句明确包含“先搜图，再参考/继续生成”的
        // 复合意图，则保留生图能力，让搜索与图生图在同一轮完成。该标记只属于本轮。
        var q = rest.toLowerCase();
        var hasGenerateVerb = /(生成|创作|绘制|画一|画成|设计|重绘|改成|做成|变体|换风格|合成|generate|create|draw|redraw|variation)/i.test(q);
        var hasReferenceCue = /(参考|基于|照着|仿照|依据|使用搜索结果|用搜索结果|从搜索结果|以上图片|这些图片|找到后|搜索后|搜完后|然后|接着|再生成|并生成|同时生成|reference|based on|then)/i.test(q);
        var imageMode = hasGenerateVerb && hasReferenceCue ? 'search_and_generate' : 'search_only';
        return { type: 'search', cmd: 'force_search', query: rest, kind: 'images', imageMode: imageMode };
    }

    // 工作区机制 (DSH Workspace)
    if (cmd === '/workspace' || cmd === '/ws' || cmd === '/cd' || cmd === '/cwd') {
        return { type: 'command', cmd: 'workspace', args: rest };
    }
    // 模式切换
    if (cmd === '/mode') {
        var m = rest ? rest.toLowerCase() : '';
        return { type: 'command', cmd: 'set_mode', mode: m };
    }
    // 模型切换
    if (cmd === '/model') return { type: 'command', cmd: 'set_model', model: rest };
    // 对话管理
    if (cmd === '/clear') return { type: 'command', cmd: 'clear_chat' };
    if (cmd === '/clearsub' || cmd === '/cleansub') return { type: 'command', cmd: 'clear_subagents' };
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
    // 效率与控制
    if (cmd === '/copy') return { type: 'command', cmd: 'copy' };
    if (cmd === '/stop' || cmd === '/abort') return { type: 'command', cmd: 'stop_gen' };
    if (cmd === '/diff') return { type: 'command', cmd: 'show_diff', args: rest };
    if (cmd === '/doctor') return { type: 'command', cmd: 'doctor' };
    if (cmd === '/context') return { type: 'command', cmd: 'show_context' };
    if (cmd === '/agents') return { type: 'command', cmd: 'list_agents' };
    if (cmd === '/agent') return { type: 'command', cmd: 'switch_agent_chat', agentName: rest };
    if (cmd === '/color' || cmd === '/theme') return { type: 'command', cmd: 'set_color', theme: rest || 'auto' };
    // 高级功能
    if (cmd === '/mcp') return { type: 'command', cmd: 'show_mcp' };
    if (cmd === '/cost' || cmd === '/stats' || cmd === '/usage') return { type: 'command', cmd: 'show_stats' };
    if (cmd === '/effort') return { type: 'command', cmd: 'set_effort', level: rest };
    if (cmd === '/think') return { type: 'command', cmd: 'set_think', mode: rest };
    if (cmd === '/queue') return { type: 'command', cmd: 'show_queue' };
    if (cmd === '/attach') return { type: 'command', cmd: 'open_attach' };
    if (cmd === '/folder') return { type: 'command', cmd: 'open_folder' };
    return null;
};

// ★ 处理 /slash 命令
window.handleSlashCommand = function(cmd) {
    var modeLabels = { off:'普通对话 (已关闭智能体)', plan:'Plan 只读规划模式', agent:'Agent 交互模式', yolo:'YOLO 自动模式' };
    
    // ★ 异步包装 async 分支
    var _async = (async function() {
    if (cmd.cmd === 'set_mode') {
        if (!cmd.mode) {
            var curMode = getAgentMode();
            var info = '## 🛠️ 工作模式设置\n' +
                '当前模式: **' + (modeLabels[curMode] || curMode) + '**\n\n' +
                '**可选切换命令:**\n' +
                '- `/mode off` — 普通对话模式（关闭智能体与工具调用）\n' +
                '- `/mode plan` — Plan 只读模式（仅分析规划，不执行任何工具）\n' +
                '- `/mode agent` — Agent 交互模式（自主调用工具，危险操作弹窗确认）\n' +
                '- `/mode yolo` — YOLO 全自动模式（全自动执行工具，无需二次确认）';
            appendMessage('system', info);
            return;
        }
        var m = cmd.mode.toLowerCase();
        if (['off','plan','agent','yolo'].indexOf(m) === -1) {
            appendMessage('system', '❌ 未知模式: `' + cmd.mode + '`。可选: off / plan / agent / yolo');
            return;
        }
        setAgentMode(m);
        showToast('已切换到 ' + (modeLabels[m] || m), 'success', 3000);
    } else if (cmd.cmd === 'set_model') {
        var sel = document.getElementById('modelSelect');
        if (!sel) return;
        var models = Array.from(sel.options).filter(function(o) { return o.value; });
        if (!cmd.model) {
            // 无参数: 显示可用模型列表
            var list = models.slice(0, 20).map(function(o) { return '- `' + o.value + '`' + (o.text !== o.value ? ' (' + o.text + ')' : ''); }).join('\n');
            appendMessage('system', '## 📋 可用模型 (' + models.length + ' 个)\n' + list + (models.length > 20 ? '\n- ... 还有 ' + (models.length - 20) + ' 个' : '') + '\n\n> 输入 `/model <名称>` 快速切换');
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
            // 触发 change 事件联动 UI 与模型特性配置
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            showToast('已切换模型: ' + (best.text || best.value), 'success', 3000);
        } else {
            var partials = models.filter(function(o) { return o.value.toLowerCase().indexOf(q) >= 0; });
            if (partials.length > 0) {
                appendMessage('system', '🔍 匹配到以下模型 (请输入更完整名称):\n' + partials.map(function(o) { return '- `' + o.value + '`'; }).join('\n'));
            } else {
                appendMessage('system', '❌ 未找到名称匹配的模型: `' + cmd.model + '`');
            }
        }
    } else if (cmd.cmd === 'workspace') {
        if (!window.WorkspaceManager) {
            appendMessage('system', '❌ 工作区管理器未就绪');
            return;
        }
        var wm = window.WorkspaceManager;
        var arg = (cmd.args || '').trim();
        if (!arg || arg === 'list' || arg === 'show' || arg === 'pwd') {
            var cur = wm.getCurrentWorkspace();
            var list = wm.getWorkspaces();
            var text = '## 📁 DSH 工作区列表\n\n' +
                '- **当前活动工作区**: `' + cur.name + '` (路径: `' + cur.path + '`)\n\n' +
                '### 可用工作区 (' + list.length + ' 个):\n' +
                list.map(function(w) {
                    var isCur = w.id === cur.id;
                    return '- ' + (isCur ? '👉 **`' + w.name + '`** (当前)' : '`' + w.name + '`') +
                        ' — `' + w.path + '`' + (w.description ? ' *(' + w.description + ')*' : '');
                }).join('\n') + '\n\n' +
                '> 💡 **快速指令**:\n' +
                '> - `/workspace <名称或路径>` 或 `/cd <路径>` — 快速切换工作区\n' +
                '> - `/workspace add <绝对路径>` — 注册自定义工作区目录';
            appendMessage('system', text);
        } else if (arg.startsWith('add ')) {
            var p = arg.slice(4).trim();
            if (!p) {
                appendMessage('system', '❌ 请提供工作区绝对路径。示例: `/workspace add /var/www/html/my-project`');
                return;
            }
            var added = wm.addWorkspace('', p);
            if (added) {
                wm.setCurrentWorkspace(added.id);
                appendMessage('system', '✅ 已添加并切换至工作区: `' + added.name + '` (`' + added.path + '`)');
            } else {
                appendMessage('system', '❌ 添加工作区失败，请检查路径。');
            }
        } else {
            var found = wm.getWorkspaces().find(function(w) {
                return w.name.toLowerCase() === arg.toLowerCase() ||
                       w.id === arg ||
                       w.path === arg ||
                       w.path.toLowerCase() === arg.toLowerCase();
            });
            if (found) {
                wm.setCurrentWorkspace(found.id);
                appendMessage('system', '✅ 已切换工作区至: `' + found.name + '` (`' + found.path + '`)');
            } else if (arg.startsWith('/')) {
                var wsNew = wm.addWorkspace('', arg);
                if (wsNew) {
                    wm.setCurrentWorkspace(wsNew.id);
                    appendMessage('system', '✅ 已注册并切换至工作区: `' + wsNew.name + '` (`' + wsNew.path + '`)');
                }
            } else {
                appendMessage('system', '❌ 未找到工作区: `' + arg + '`。使用 `/workspace list` 查看所有可用工作区。');
            }
        }
    } else if (cmd.cmd === 'clear_chat') {
        var cid = currentChatId;
        if (cid && chats[cid]) {
            // ★ 1. 中止当前所有进行中的生成 (全链路停止)
            if (typeof window.stopGeneration === 'function') {
                try { window.stopGeneration(); } catch(e) {}
            }
            if (window._activeAbortCtrl) {
                try { window._activeAbortCtrl.abort(); } catch(e) {}
            }
            if (typeof userAbortMap !== 'undefined') userAbortMap[cid] = true;
            if (typeof isTypingMap !== 'undefined') delete isTypingMap[cid];

            // ★ 2. 彻底清空当前会话对象，打上更新与清空标记 (防服务器旧数据反向恢复)
            var title = chats[cid].title || '新对话';
            var createdAt = chats[cid].created_at || chats[cid].updated_at || Date.now();
            var agentMode = getAgentMode();
            var sysPrompt = '';
            if (cid === '_agent_main' && agentMode !== 'off') {
                sysPrompt = localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt;
            } else {
                sysPrompt = getVal('systemPrompt') || DEFAULT_CONFIG.system;
            }

            var nowTs = Date.now();
            chats[cid] = {
                title: title,
                userId: chats[cid].userId || localStorage.getItem('authUserId') || '',
                created_at: createdAt,
                updated_at: nowTs,
                cleared_at: nowTs,
                cleared: true,
                messages: [{ role: 'system', content: sysPrompt }]
            };

            // 清理额外字段与流状态
            delete chats[cid]._agentMessages;
            delete chats[cid]._internalToolCalls;
            delete chats[cid]._savedPartial;
            delete chats[cid]._streamState;
            delete chats[cid]._webFetchUrls;

            // ★ 3. 彻底清除内存队列与持久化队列
            window._messageQueue = [];
            if (window._imageBatchQueue) window._imageBatchQueue = [];
            window._isQueueProcessing = false;
            if (typeof window._clearPersistedQueue === 'function') window._clearPersistedQueue(cid);
            if (typeof window._updateQueueUI === 'function') window._updateQueueUI();
            window._hasInjectedMessage = false;
            window._pendingRecovery = null;

            try {
                sessionStorage.removeItem('_messageQueue');
                localStorage.removeItem('_savedPartial');
                localStorage.removeItem('_hasInjectedMessage');
                localStorage.removeItem('_pendingAgentReply');
                localStorage.removeItem('_pendingAgentReplyChatId');
                localStorage.removeItem('_rs_state_v3');
                localStorage.removeItem('_rs_sid');
                localStorage.removeItem('_rs_cid');
                localStorage.removeItem('_rs_msgid');
                localStorage.removeItem('_autoResume');
                localStorage.removeItem('oc_queue_a_' + cid);
                localStorage.removeItem('oc_queue_n_' + cid);
                localStorage.removeItem('oc_queue_a_default');
                localStorage.removeItem('oc_queue_n_default');
            } catch(e) {}

            // ★ 4. 强制立即保存到 localStorage 与服务器 (forceServer=true)
            saveChats(true);

            // ★ 5. 重绘 UI 界面
            var container = $.chatMessagesContainer;
            if (container) {
                container.innerHTML = '';
                showWelcome();
            }
            renderChatHistory();
            updateHeaderTitle();
            showToast('✅ 对话与待发送队列已完全清空', 'success', 2000);
        }
    } else if (cmd.cmd === 'clear_subagents') {
        if (typeof window.cleanupSubAgentSessions === 'function') {
            window.cleanupSubAgentSessions(0, 0).then(function(n) {
                appendMessage('system', '🧹 已清理 ' + n + ' 个历史子代理会话');
                showToast('已清理 ' + n + ' 个子代理会话', 'success', 2000);
            }).catch(function(e) {
                showToast('清理失败: ' + e.message, 'error');
            });
        } else {
            showToast('未找到子代理清理组件', 'error');
        }
    } else if (cmd.cmd === 'new_chat') {
        createNewChat();
        showToast('已新建对话', 'info', 1500);
    } else if (cmd.cmd === 'compact') {
        var cidCompact = currentChatId;
        if (!cidCompact || !chats[cidCompact]) {
            appendMessage('system', '❌ 当前无活跃会话');
            return;
        }
        showToast('🗜️ 正在压缩对话上下文...', 'info', 2000);
        try {
            if (typeof compressContextIfNeeded === 'function') {
                var ok = await compressContextIfNeeded(cidCompact, true);
                if (ok !== false) {
                    showToast('✅ 对话上下文压缩完成', 'success', 2500);
                } else {
                    showToast('当前消息较少，无需压缩', 'info', 2000);
                }
            } else {
                showToast('压缩功能不可用', 'error');
            }
        } catch(e) {
            showToast('压缩失败: ' + e.message, 'error');
        }
    } else if (cmd.cmd === 'show_help') {
        var groups = {};
        SLASH_COMMANDS.forEach(function(c) {
            var g = c.group || '通用';
            if (!groups[g]) groups[g] = [];
            groups[g].push(c);
        });
        var helpMd = '## ⌨️ 快捷命令列表\n\n';
        Object.keys(groups).forEach(function(g) {
            helpMd += '### ' + g + '\n';
            groups[g].forEach(function(c) {
                var argText = c.args ? ' *' + c.args + '*' : '';
                helpMd += '- `/' + c.cmd + '`' + argText + ' — ' + c.hint + '\n';
            });
            helpMd += '\n';
        });
        helpMd += '> 💡 提示: 输入 `/` 可随时唤起交互式命令选单';
        appendMessage('system', helpMd);
    } else if (cmd.cmd === 'open_config') {
        toggleConfigPanel();
        showToast('已打开配置面板', 'info', 2000);
    } else if (cmd.cmd === 'logout') {
        if (confirm('确定要退出登录当前账户吗?')) { logout(); }
    } else if (cmd.cmd === 'retry') {
        var cidRetry = currentChatId;
        if (!cidRetry || !chats[cidRetry]) return;
        var msgs = chats[cidRetry].messages;
        var lastAssistIdx = -1;
        for (var i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant' && !msgs[i].partial) { lastAssistIdx = i; break; }
        }
        if (lastAssistIdx >= 0) {
            var lastUserIdx = -1;
            for (var i2 = lastAssistIdx - 1; i2 >= 0; i2--) {
                if (msgs[i2].role === 'user') { lastUserIdx = i2; break; }
            }
            if (lastUserIdx >= 0) {
                var userMsg = msgs[lastUserIdx];
                // 中止可能的当前生成
                if (typeof window.stopGeneration === 'function') window.stopGeneration();
                // 移除最后一条 AI 消息
                msgs.splice(lastAssistIdx);
                saveChats(true);
                // 重绘聊天区
                loadChat(cidRetry);
                renderChatHistory();
                showToast('🔄 正在重新生成回复...', 'info', 2000);
                sendMessage(true, userMsg.text, userMsg.files);
            } else {
                showToast('未找到对应的用户提问', 'info');
            }
        } else {
            showToast('暂无 AI 回复可重新生成', 'info');
        }
    } else if (cmd.cmd === 'export_chat') {
        var cidExp = currentChatId;
        if (!cidExp || !chats[cidExp]) return;
        var msgsExp = chats[cidExp].messages;
        var _exportDebug = false;
        try { _exportDebug = localStorage.getItem('exportChatDebug') === '1'; } catch (e) {}
        var _mdTurns = msgsExp.filter(function(m) {
            if (!m || m.role === 'system' || m.temporary || m._internal || m.role === 'tool' || m.role === 'tool_card' || m._toolResult || m._toolCard) return false;
            if (m.role !== 'user' && m.role !== 'assistant') return false;
            var _txt = String(m.text || m.content || '').trim();
            return !!_txt || (_exportDebug && !!m.reasoning);
        }).map(function(m) {
            var role = m.role === 'user' ? '🧑 **用户**' : '🤖 **AI 助手**';
            var content = String(m.text || m.content || '').trim();
            var reasoning = (_exportDebug && m.reasoning) ? '\n\n> 💭 **思考过程:**\n> ' + String(m.reasoning).replace(/\n/g, '\n> ') + '\n\n' : '';
            return '### ' + role + '\n' + reasoning + content;
        });
        var md = '# ' + (chats[cidExp].title || '对话') + '\n\n' +
            '导出时间: ' + new Date().toLocaleString() + '\n\n---\n\n' + _mdTurns.join('\n\n---\n\n');
        // 复用统一 UTF-8 with BOM 下载器，避免 Markdown 在 Windows 上按 ANSI 打开。
        var mdName = (chats[cidExp].title || 'chat').replace(/[/\\?%*:|"<>]/g, '_') + '.md';
        if (typeof window._downloadUtf8Text === 'function') {
            window._downloadUtf8Text(mdName, md, 'text/markdown');
        } else {
            var blob = new Blob(['\uFEFF', md], { type: 'text/markdown;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = mdName;
            a.click();
            setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
        }
        showToast('✅ 已导出为 Markdown 文件', 'success', 2000);
    } else if (cmd.cmd === 'remember') {
        var parts = (cmd.content || '').split(':');
        if (parts.length >= 2) {
            var key = parts[0].trim();
            var content = parts.slice(1).join(':').trim();
            if (key && content) {
                try {
                    var resp = await fetch('/oneapichat/api/memory_api.php?action=save_memory', {
                        method: 'POST',
                        headers: typeof getSessionAuthHeaders === 'function' ? getSessionAuthHeaders({ 'Content-Type': 'application/json' }) : { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: key, content: content })
                    });
                    var data = await resp.json();
                    if (data.success) {
                        if (typeof window._loadCloudMemories === 'function') window._loadCloudMemories();
                        showToast('已记住: ' + key, 'success', 2000);
                    } else {
                        showToast('保存失败: ' + (data.error || '未知错误'), 'error');
                    }
                } catch(e) { showToast('保存失败: ' + e.message, 'error'); }
            } else {
                appendMessage('system', '用法: `/remember 键: 内容`\n例: `/remember user_name: 向奕侨`');
            }
        } else {
            // 无参数: 显示已保存的记忆
            if (typeof window.refreshMemoryList === 'function') window.refreshMemoryList();
            try {
                var resp2 = await fetch('/oneapichat/api/memory_api.php?action=get_memories', {
                    headers: typeof getSessionAuthHeaders === 'function' ? getSessionAuthHeaders() : {}
                });
                var data2 = await resp2.json();
                if (data2.success && data2.memories && data2.memories.length > 0) {
                    var listMem = data2.memories.map(function(m) { return '- `' + m.key + '`: ' + m.content; }).join('\n');
                    appendMessage('system', '## 📝 已保存的记忆 (' + data2.memories.length + ' 条)\n' + listMem);
                } else {
                    appendMessage('system', '📝 暂无保存的记忆。输入 `/remember 键: 内容` 可保存新记忆');
                }
            } catch(e) {
                showToast('获取记忆失败: ' + e.message, 'error');
            }
        }
    } else if (cmd.cmd === 'copy') {
        var cidCopy = currentChatId;
        if (!cidCopy || !chats[cidCopy]) return;
        var msgsCopy = chats[cidCopy].messages;
        var lastAI = '';
        for (var ic = msgsCopy.length - 1; ic >= 0; ic--) {
            if (msgsCopy[ic].role === 'assistant' && !msgsCopy[ic].partial) {
                lastAI = msgsCopy[ic].content || msgsCopy[ic].text || '';
                break;
            }
        }
        if (lastAI) {
            var copyOk = false;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                try {
                    await navigator.clipboard.writeText(lastAI);
                    copyOk = true;
                } catch(e) {}
            }
            if (!copyOk) {
                var ta = document.createElement('textarea');
                ta.value = lastAI;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); copyOk = true; } catch(e) {}
                document.body.removeChild(ta);
            }
            if (copyOk) {
                showToast('📋 已复制最后 AI 回复 (' + lastAI.length + ' 字符)', 'success', 2000);
            } else {
                showToast('❌ 复制失败，请手动选取文本', 'error');
            }
        } else {
            showToast('📋 暂无 AI 回复可复制', 'info');
        }
    } else if (cmd.cmd === 'stop_gen') {
        if (typeof window.stopGeneration === 'function') {
            window.stopGeneration();
            showToast('⏹️ 已中止当前生成', 'info', 2000);
        } else if (window._activeAbortCtrl) {
            try { window._activeAbortCtrl.abort(); } catch(e) {}
            showToast('⏹️ 已中止当前生成', 'info', 2000);
        } else {
            showToast('⚠️ 当前没有进行中的生成', 'info', 2000);
        }
    } else if (cmd.cmd === 'show_diff') {
        var diffCmd = 'cd /var/www/html/oneapichat && git diff --stat 2>&1';
        if (cmd.args) diffCmd = 'cd /var/www/html/oneapichat && git diff ' + cmd.args.replace(/[^a-zA-Z0-9._\-\s]/g, '') + ' 2>&1';
        try {
            var diffResp = await fetch('/engine/exec', {
                method: 'POST',
                headers: typeof getSessionAuthHeaders === 'function' ? getSessionAuthHeaders({'Content-Type': 'application/json'}) : {'Content-Type': 'application/json'},
                body: JSON.stringify({cmd: diffCmd, timeout: 10})
            });
            var diffData = await diffResp.json();
            var diffOutput = (diffData.result || diffData.stdout || diffData.error || '(无差异)');
            appendMessage('system', '## 📊 Git Diff 状态\n```diff\n' + diffOutput.substring(0, 4000) + '\n```');
        } catch(e) {
            appendMessage('system', '❌ 无法获取 Git Diff: ' + e.message);
        }
    } else if (cmd.cmd === 'doctor') {
        showToast('🔍 正在运行系统诊断...', 'info', 2000);
        var checks = ['## 🩺 系统诊断报告\n'];
        // 1. 引擎服务健康
        try {
            var hResp = await fetch('/engine/health');
            if (hResp.ok) {
                var hData = await hResp.json();
                checks.push('✅ **Python 引擎服务**: 正常运行 (时间: ' + (hData.time || 'ok') + ')');
            } else {
                checks.push('❌ **Python 引擎服务**: 响应异常 (HTTP ' + hResp.status + ')');
            }
        } catch(e) { checks.push('❌ **Python 引擎服务**: 不可达 (' + e.message + ')'); }

        // 2. 会话状态
        var totalChats = Object.keys(chats).length;
        var curMsgs = currentChatId && chats[currentChatId] ? (chats[currentChatId].messages || []).length : 0;
        checks.push('📋 **活跃会话**: ' + totalChats + ' 个 (当前会话: ' + curMsgs + ' 条消息)');

        // 3. 消息队列
        var qCount = window._messageQueue ? window._messageQueue.length : 0;
        checks.push('📬 **待发队列**: ' + qCount + ' 条排队消息');

        // 4. localStorage 用量
        var lsUsed = 0;
        try { lsUsed = JSON.stringify(localStorage).length; } catch(e) {}
        checks.push('💾 **本地存储**: ' + (lsUsed / 1024 / 1024).toFixed(2) + ' MB / 5 MB');

        // 5. 工作模式与可恢复流
        var modeStr = getAgentMode ? getAgentMode() : '未知';
        checks.push('🤖 **当前模式**: ' + (modeLabels[modeStr] || modeStr));
        checks.push('🔄 **可恢复流式 (RS)**: ' + (localStorage.getItem('__enableResumeStream') !== '0' ? '已启用' : '已禁用'));

        // 6. 网络与在线状态
        checks.push('🌐 **网络连接**: ' + (navigator.onLine ? '在线 (Online)' : '离线 (Offline)'));
        appendMessage('system', checks.join('\n'));
    } else if (cmd.cmd === 'show_context') {
        var cidContext = currentChatId;
        if (!cidContext || !chats[cidContext]) { appendMessage('system', '❌ 当前无活跃会话'); return; }
        var msgsContext = chats[cidContext].messages || [];
        var totalChars = 0, systemChars = 0, userChars = 0, assistantChars = 0, toolChars = 0;
        msgsContext.forEach(function(m) {
            var len = (m.content || m.text || '').length + (m.reasoning || '').length;
            totalChars += len;
            if (m.role === 'system') systemChars += len;
            else if (m.role === 'user') userChars += len;
            else if (m.role === 'assistant') assistantChars += len;
            else if (m.role === 'tool' || m.role === 'tool_card') toolChars += len;
        });
        var estTokens = Math.round(totalChars / 3.5);
        var currentModel = getVal?.('modelSelect') || localStorage.getItem('model') || 'gpt-4o';
        var ctxLimit = typeof getModelContextLength === 'function' ? getModelContextLength(currentModel) : 128000;
        var pct = Math.min(100, Math.round(estTokens / ctxLimit * 100));

        appendMessage('system', '## 📐 上下文用量分析\n' +
            '- 🤖 **当前模型**: `' + currentModel + '` (最大容量 ~' + (ctxLimit / 1024).toFixed(0) + 'K tokens)\n' +
            '- 💬 **总消息数**: ' + msgsContext.length + ' 条\n' +
            '- 📝 **总字符数**: ' + totalChars.toLocaleString() + ' (~' + estTokens.toLocaleString() + ' tokens)\n' +
            '  ├ System: ' + (systemChars / 1024).toFixed(1) + ' KB\n' +
            '  ├ User: ' + (userChars / 1024).toFixed(1) + ' KB\n' +
            '  ├ Assistant: ' + (assistantChars / 1024).toFixed(1) + ' KB\n' +
            '  └ Tool: ' + (toolChars / 1024).toFixed(1) + ' KB\n' +
            '- 📊 **上下文使用率**: ' + pct + '% of ' + (ctxLimit / 1024).toFixed(0) + 'K');
    } else if (cmd.cmd === 'list_agents') {
        var tokenAgent = localStorage.getItem('authToken') || '';
        try {
            var agResp = await fetch('/oneapichat/api/engine_api.php?action=agent_list', { headers: { Authorization: 'Bearer ' + tokenAgent } });
            var agData = await agResp.json();
            var agentList = agData.agents || [];
            window._cachedAgentList = agentList;
            if (agentList.length > 0) {
                var agList = agentList.map(function(a) {
                    return '- `' + (a.name || a.id || '?') + '` [' + (a.status || '?') + '] ' + (a.role ? '(' + a.role + ') ' : '') + (a.task || '');
                }).join('\n');
                appendMessage('system', '## 🤖 活跃子代理 (' + agentList.length + ' 个)\n' + agList + '\n\n> 输入 `/agent <名称>` 切换会话');
            } else {
                appendMessage('system', '🤖 当前暂无活跃子代理');
            }
        } catch(e) { appendMessage('system', '❌ 查询子代理失败: ' + e.message); }
    } else if (cmd.cmd === 'switch_agent_chat') {
        var _agentName = cmd.agentName || '';
        if (!_agentName) {
            appendMessage('system', '用法: `/agent <子代理名称>`\n例: `/agent agent_1`');
            return;
        }
        var _agToken = localStorage.getItem('authToken') || '';
        try {
            var _agResp = await fetch('/oneapichat/api/engine_api.php?action=agent_list', { headers: { Authorization: 'Bearer ' + _agToken } });
            var _agData = await _agResp.json();
            var _agent = _agData[_agentName] || _agData.agents?.find(function(a) { return a.name === _agentName; });
            if (!_agent) {
                appendMessage('system', '❌ 子代理 `' + _agentName + '` 不存在或已结束');
                return;
            }
            var _agChatId = '_agent_sub_' + _agentName;
            if (!chats[_agChatId]) {
                var _agSysPrompt = '你正在查看子代理 `' + _agentName + '` 的会话。\n角色: ' + (_agent.role || 'general') + '\n状态: ' + (_agent.status || 'unknown');
                chats[_agChatId] = {
                    title: '🤖 ' + _agentName,
                    userId: localStorage.getItem('authUserId') || '',
                    updated_at: Date.now(),
                    messages: [{ role: 'system', content: _agSysPrompt }],
                    _agentSub: true
                };
                var _agKey = 'agent_chat_' + _agentName;
                var _agMsgs = JSON.parse(localStorage.getItem(_agKey) || '[]');
                if (_agMsgs.length > 0) {
                    chats[_agChatId].messages = chats[_agChatId].messages.concat(_agMsgs);
                }
                if (_agent.result && !_agMsgs.some(function(m) { return m.content === _agent.result; })) {
                    chats[_agChatId].messages.push({ role: 'assistant', content: _agent.result, time: Date.now() });
                }
                saveChats(true);
            }
            loadChat(_agChatId);
            renderChatHistory();
            updateHeaderTitle();
            showToast('🤖 已切换到子代理会话: ' + _agentName, 'success', 3000);
        } catch(e) {
            appendMessage('system', '❌ 切换失败: ' + e.message);
        }
    } else if (cmd.cmd === 'set_color') {
        var theme = cmd.theme || 'auto';
        var root = document.documentElement;
        var _isDark = false;
        if (theme === 'dark') {
            _isDark = true;
            root.classList.add('dark');
            localStorage.setItem('dark', 'true');
            localStorage.setItem('theme', 'dark');
            showToast('🌙 已切换为深色模式', 'success', 2000);
        } else if (theme === 'light') {
            root.classList.remove('dark');
            localStorage.setItem('dark', 'false');
            localStorage.setItem('theme', 'light');
            showToast('☀️ 已切换为浅色模式', 'success', 2000);
        } else {
            _isDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
            root.classList.toggle('dark', _isDark);
            localStorage.removeItem('dark');
            localStorage.setItem('theme', 'auto');
            showToast('🔄 已设置为跟随系统主题', 'success', 2000);
        }
        var _moon = getEl('moonPath'), _sun = getEl('sunPath');
        _moon?.classList.toggle('hidden', _isDark);
        _sun?.classList.toggle('hidden', !_isDark);
        var _themeEl = getEl('hljsTheme');
        if (_themeEl) _themeEl.href = _isDark ? 'lib/atom-one-dark.min.css' : 'lib/atom-one-light.min.css';
        if (typeof applyDropdownTheme === 'function') applyDropdownTheme();
    } else if (cmd.cmd === 'show_mcp') {
        showToast('🔌 正在查询 MCP 工具...', 'info', 2000);
        try {
            var mcpResp = await fetch('/oneapichat/api/v1/mcp.php?action=tools/list', { headers: { 'Accept': 'application/json' } });
            var mcpData = await mcpResp.json();
            var mcpTools = mcpData.tools || mcpData.result?.tools || [];
            if (mcpTools.length > 0) {
                var mcpGroups = {};
                mcpTools.forEach(function(t) {
                    var prefix = (t.name || '').split('_')[0] || 'other';
                    if (!mcpGroups[prefix]) mcpGroups[prefix] = [];
                    mcpGroups[prefix].push(t);
                });
                var mcpHtml = '## 🔌 MCP 工具生态 (' + mcpTools.length + ' 个工具)\n';
                Object.keys(mcpGroups).sort().forEach(function(g) {
                    mcpHtml += '\n### ' + g + ' (' + mcpGroups[g].length + ')\n';
                    mcpGroups[g].slice(0, 15).forEach(function(t) {
                        mcpHtml += '- `' + t.name + '` — ' + (t.description || '').substring(0, 60) + '\n';
                    });
                    if (mcpGroups[g].length > 15) mcpHtml += '- ... 还有 ' + (mcpGroups[g].length - 15) + ' 个\n';
                });
                appendMessage('system', mcpHtml);
            } else {
                appendMessage('system', '🔌 MCP 服务正常，但当前未加载外部 MCP 工具');
            }
        } catch(e) {
            var toolCount = window.toolRegistry ? Object.keys(window.toolRegistry).length : 0;
            appendMessage('system', '🔌 MCP 远程服务未就绪 (' + e.message + ')\n\n前端本地注册可用工具: ' + toolCount + ' 个');
        }
    } else if (cmd.cmd === 'show_stats' || cmd.cmd === 'show_cost') {
        if (typeof window.openUsageStatsModal === 'function') {
            window.openUsageStatsModal();
        } else {
            appendMessage('system', '📊 使用统计看板正在加载中...');
        }
    } else if (cmd.cmd === 'set_effort') {
        var level = (cmd.level || '').toLowerCase();
        var validLevels = ['off', 'low', 'medium', 'high', 'max', 'ultra'];
        if (!level) {
            var cur = localStorage.getItem('thinkingIntensity') || 'medium';
            appendMessage('system', '🧠 **当前思考强度**: `' + cur + '`\n\n' +
                '**用法**: `/effort <级别>`\n' +
                '可选: `off` / `low` / `medium` / `high` / `max` / `ultra`\n\n' +
                '> 自动适配: OpenAI (reasoning_effort), Claude (output_config.effort), Gemini (thinking_level)');
            return;
        }
        if (validLevels.indexOf(level) === -1) {
            appendMessage('system', '❌ 无效档位: `' + level + '`。可选: ' + validLevels.join(' / '));
            return;
        }
        localStorage.setItem('thinkingIntensity', level);
        if (typeof window._applyReasonEffort === 'function') window._applyReasonEffort(level);
        var _tiEl = document.getElementById('thinkingIntensity');
        if (_tiEl) _tiEl.value = level;
        if (typeof window._updateThinkingIntensityVisibility === 'function') window._updateThinkingIntensityVisibility();
        showToast('🧠 思考强度已设为: ' + level, 'success', 2000);
    } else if (cmd.cmd === 'set_think') {
        var thinkMode = (cmd.mode || '').toLowerCase();
        var _ti = localStorage.getItem('thinkingIntensity') || 'medium';
        if (!thinkMode || thinkMode === 'auto') {
            thinkMode = (_ti === 'off') ? 'on' : 'off';
        }
        var newLevel = (thinkMode === 'on' || thinkMode === '1' || thinkMode === 'true') ? 'high' : 'off';
        localStorage.setItem('thinkingIntensity', newLevel);
        var _tiEl2 = document.getElementById('thinkingIntensity');
        if (_tiEl2) _tiEl2.value = newLevel;
        if (typeof window._updateThinkingIntensityVisibility === 'function') window._updateThinkingIntensityVisibility();
        showToast('💡 深度思考: ' + (newLevel === 'off' ? '已关闭' : '已开启 (high)'), 'success', 2000);
    } else if (cmd.cmd === 'show_queue') {
        var queue = window._messageQueue || [];
        if (queue.length === 0) {
            appendMessage('system', '📬 消息队列为空（无待发送消息）');
        } else {
            var qList = queue.map(function(q, i) {
                return (i + 1) + '. ' + (q.text || '(无文字内容)').substring(0, 80) + (q.files && q.files.length ? ' [📎 ' + q.files.length + '个文件]' : '');
            }).join('\n');
            appendMessage('system', '## 📬 待发送队列 (' + queue.length + ' 条)\n' + qList + '\n\n> 发送新消息将自动排队或插话');
        }
    } else if (cmd.cmd === 'open_attach') {
        var fileInput = $.fileInput || document.getElementById('fileInput');
        if (fileInput) fileInput.click();
    } else if (cmd.cmd === 'open_folder') {
        var folderInput = document.getElementById('folderInput');
        if (folderInput) folderInput.click();
    }
    })(); // end async wrapper
};
