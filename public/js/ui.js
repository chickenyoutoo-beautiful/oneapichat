// ui.js — UI 交互层 v1.0 (Phase 7 拆分自 main.js)
// 思考指示器 / 工具状态行 / Toast / Slash命令 / 暗色模式 / 侧边栏

// ==================== UI 工具 ====================
window.autoResize = function (el) {
    el.style.height = 'auto';
    // ★ 与 CSS max-height:150px 保持一致(移动端 100px)
    var max = window.innerWidth <= 480 ? 100 : 150;
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
};

// ==================== 🧠 Thinking Indicator API ====================
// 参考 DeepSeek-TUI 的思考进度指示器
window.showThinking = function(step, todoItems) {
    var el = getEl('thinkingIndicator');
    if (!el) return;
    el.classList.add('active');
    var stepEl = getEl('thinkingStep');
    var todoEl = getEl('thinkingTodo');
    if (stepEl && step) stepEl.textContent = step;
    if (todoEl && todoItems) {
        todoEl.innerHTML = todoItems.map(function(item) {
            var cls = item.done ? 'done' : item.active ? 'active' : 'pending';
            var icon = item.done ? '✅' : item.active ? '🔄' : '⏳';
            return '<div class="thinking-todo-item ' + cls + '">' + icon + ' ' + escapeHtml(item.text) + '</div>';
        }).join('');
    }
};
window.updateThinkingStep = function(step) {
    var stepEl = getEl('thinkingStep');
    if (stepEl) stepEl.textContent = step;
};
window.updateThinkingTodo = function(items) {
    var todoEl = getEl('thinkingTodo');
    if (!todoEl) return;
    todoEl.innerHTML = items.map(function(item) {
        var cls = item.done ? 'done' : item.active ? 'active' : 'pending';
        var icon = item.done ? '✅' : item.active ? '🔄' : '⏳';
        return '<div class="thinking-todo-item ' + cls + '">' + icon + ' ' + escapeHtml(item.text) + '</div>';
    }).join('');
};
window.hideThinking = function() {
    var el = getEl('thinkingIndicator');
    if (el) el.classList.remove('active');
};

// ==================== 🔄 工具调用滚动卡片 ====================
// 每个工具调用在回复气泡底部追加一条,调用完后保留显示
// 下一个工具调用时自动追加新行,旧行向上滚动(单向滚动,不闪烁)
window._toolCallLines = [];

// ==================== 原生多模态处理状态提示 ====================
// 参考工具调用状态行样式,正文出现后自动淡出
window.showImageProcessingHint = function(chatId, files) {
    if (!chatId || !activeBubbleMap[chatId]) return;
    var bubble = activeBubbleMap[chatId];
    // 避免重复创建
    if (bubble.querySelector('.native-vision-hint')) return;

    var imgCount = files.filter(function(f) { return f.isImage || (f.type && f.type.startsWith('image/')); }).length;
    var hintEl = document.createElement('div');
    hintEl.className = 'native-vision-hint';
    hintEl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 12px;margin:4px 0;border-radius:8px;background:linear-gradient(135deg,#667eea0a,#764ba20a);border:1px solid #667eea18;font-size:12px;color:#a78bfa;animation:visionPulse 1.8s ease-in-out infinite;';
    hintEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
        '<span>原生视觉分析中 · ' + imgCount + ' 张图片</span>';

    var reasoning = bubble.querySelector('details.reasoning-details');
    var md = bubble.querySelector('.markdown-body');
    if (reasoning) {
        reasoning.after(hintEl);
    } else if (md) {
        md.before(hintEl);
    } else {
        bubble.appendChild(hintEl);
    }

    // ★ 正文出现后自动移除 (用 MutationObserver 监听)
    var observer = new MutationObserver(function() {
        var _md = bubble.querySelector('.markdown-body');
        if (_md && _md.textContent && _md.textContent.trim().length > 5) {
            _fadeOut();
        }
    });
    function _fadeOut() {
        observer.disconnect();
        hintEl.style.transition = 'opacity 0.25s, transform 0.25s';
        hintEl.style.opacity = '0';
        hintEl.style.transform = 'translateY(-4px)';
        setTimeout(function() { if (hintEl.parentNode) hintEl.remove(); }, 260);
    }
    if (md) observer.observe(md, { childList: true, subtree: true, characterData: true });
    // 超时 60 秒自动移除
    setTimeout(function() {
        if (hintEl.parentNode) { _fadeOut(); }
    }, 60000);
};

// ==================== 工具调用状态行 (独立, 完成后3秒淡出) ====================
window.showToolStatus = function(toolName, argPreview, status, chatId, toolCallId) {
    // ★ 使用传入的 chatId 而非全局 currentChatId，避免跨会话工具状态泄露
    var _cid = chatId || currentChatId;
    if (!_cid) return;
    var bubble = activeBubbleMap[_cid];
    if (!bubble) return;

    var tcContainer = bubble.querySelector('.tool-call-lines');
    if (!tcContainer) {
        tcContainer = document.createElement('div');
        tcContainer.className = 'tool-call-lines';
        var reasoning = bubble.querySelector('details');
        var md = bubble.querySelector('.markdown-body');
        if (reasoning && md) reasoning.after(tcContainer);
        else if (md) md.before(tcContainer);
        else bubble.appendChild(tcContainer);
    }

    if (status === null) {
        // 流结束后保留执行摘要与详细步骤，避免生成期间的信息在收尾时消失。
        if (tcContainer) {
            tcContainer.classList.add('tool-call-settled');
            // 极简主题默认收起已完成轨迹，只保留 DSH 风格摘要；用户可随时展开。
            if (!tcContainer.classList.contains('tool-call-user-expanded')) tcContainer.classList.remove('tool-call-expanded');
            var settledSummary = tcContainer.querySelector('.tool-call-live-summary');
            if (settledSummary) {
                settledSummary.setAttribute('data-settled', 'true');
                settledSummary.setAttribute('aria-expanded', String(tcContainer.classList.contains('tool-call-expanded')));
                var settledTitle = settledSummary.querySelector('strong');
                if (settledTitle) settledTitle.textContent = 'Agent 执行记录';
            }
        }
        return;
    }

    // snapshot/hydration 可能被 loadChat、SSE 首包和重连连续触发。相同调用的
    // 相同状态就地更新，避免必须等新输出以及反复执行“滑出再滑入”动画。
    var existingSame = null;
    tcContainer.querySelectorAll('.tool-call-line').forEach(function(old) {
        if (existingSame) return;
        var sameId = toolCallId && old.dataset.tcId === String(toolCallId);
        var sameLegacy = !toolCallId && old.dataset.tcName === toolName;
        if ((sameId || sameLegacy) && old.dataset.tcStatus === status) existingSame = old;
    });
    if (existingSame) {
        existingSame.classList.remove('tc-exit');
        var existingName = existingSame.querySelector('.tool-call-name');
        var existingArg = existingSame.querySelector('.tool-call-arg');
        if (existingName) existingName.textContent = toolName;
        if (existingArg) {
            existingArg.textContent = status === 'error' ? (argPreview || '') : (argPreview || '').substring(0, 40);
            existingArg.title = argPreview || '';
        }
        return existingSame;
    }

    // 实时保留同一轮所有工具步骤，避免生成过程中只剩一个空白占位。
    // 同名调用仅把 running 行更新为 success/error，不再把旧步骤全部挤掉。
    if (status !== 'running') {
        tcContainer.querySelectorAll('.tool-call-line.tool-call-running').forEach(function(old) {
            if (old.dataset.tcName === toolName && !old.classList.contains('tc-exit')) {
                old.classList.add('tc-exit');
                setTimeout(function() { if (old.parentNode) old.remove(); }, 180);
            }
        });
    }

    var line = document.createElement('div');

    var iconHtml = '';
    if (status === 'running') {
        iconHtml = '<svg class=tool-call-spin width=18 height=18 viewBox="0 0 24 24" fill=none stroke=#6366f1 stroke-width=3 stroke-linecap=round><path d="M12 2a10 10 0 0 1 0 20"/></svg>';
    } else if (status === 'success') {
        iconHtml = '<svg class=tool-call-check width=18 height=18 viewBox="0 0 24 24" fill=none stroke=#22c55e stroke-width=3 stroke-linecap=round stroke-linejoin=round><path d="M4 12l6 6L20 6"/></svg>';
    } else if (status === 'error') {
        iconHtml = '<svg class=tool-call-x width=16 height=16 viewBox="0 0 24 24" fill=none stroke=#dc2626 stroke-width=3 stroke-linecap=round><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
    }

    var visiblePreview = status === 'error' ? (argPreview || '') : (argPreview || '').substring(0, 40);
    line.innerHTML = '<span class=tool-c...wrap>' + iconHtml + '</span>' +
        '<span class="tool-call-name">' + escapeHtml(toolName) + '</span>' +
        (visiblePreview ? '<span class="tool-call-arg" title="' + escapeHtml(argPreview || '') + '">' + escapeHtml(visiblePreview) + '</span>' : '');

    var cls = 'tool-call-line';
    var _canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' &&
        (!navigator.userActivation || navigator.userActivation.hasBeenActive);
    if (status === 'running') cls += ' tool-call-running';
    else if (status === 'success') { cls += ' tool-call-success'; if (_canVibrate) { try { navigator.vibrate([15]); } catch(e){} } }
    else if (status === 'error') { cls += ' tool-call-error'; if (_canVibrate) { try { navigator.vibrate([30,50,30]); } catch(e){} } }
    line.className = cls;
    line.dataset.tcStatus = status;
    line.dataset.tcName = toolName;
    if (toolCallId) line.dataset.tcId = String(toolCallId);
    line.setAttribute('role', 'status');
    line.setAttribute('aria-live', status === 'running' ? 'polite' : 'off');
    if (status === 'error' && argPreview) {
        line.classList.add('tool-call-error-detail');
        line.tabIndex = 0;
        line.setAttribute('role', 'button');
        line.setAttribute('aria-expanded', 'false');
        line.title = '点击展开或收起完整错误信息';
        var toggleError = function() {
            var expanded = line.classList.toggle('tool-call-error-expanded');
            line.setAttribute('aria-expanded', String(expanded));
        };
        line.addEventListener('click', toggleError);
        line.addEventListener('keydown', function(ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleError(); }
        });
    }
    tcContainer.appendChild(line);

    // ★ 自动关联计划: 工具开始运行时，尝试匹配计划中的任务
    if (status === 'running' && window._agentPlan && window._agentPlan.tasks) {
        window._agentPlan.tasks.forEach(function(pt) {
            if (pt.status === 'pending') {
                // 通过工具名或参数中匹配计划任务
                var combined = (pt.title + ' ' + (pt.description || '')).toLowerCase();
                var toolLower = toolName.toLowerCase();
                var argLower = (argPreview || '').toLowerCase();
                if (combined.indexOf(toolLower) >= 0 || combined.indexOf(argLower) >= 0 ||
                    toolLower.indexOf('search') >= 0 && combined.indexOf('搜索') >= 0 ||
                    toolLower.indexOf('read') >= 0 && combined.indexOf('读取') >= 0 ||
                    toolLower.indexOf('write') >= 0 && combined.indexOf('写入') >= 0 ||
                    toolLower.indexOf('exec') >= 0 && combined.indexOf('执行') >= 0 ||
                    toolLower.indexOf('browser') >= 0 && combined.indexOf('浏览') >= 0 ||
                    toolLower.indexOf('delegate') >= 0 && combined.indexOf('代理') >= 0) {
                    window.updatePlanTaskStatus(pt.id, 'running');
                }
            }
        });
    }

    // 生成过程中与流结束后均保留步骤，供用户查看本轮执行轨迹。
    var liveSummary = tcContainer.querySelector('.tool-call-live-summary');
    if (!liveSummary) {
        liveSummary = document.createElement('button');
        liveSummary.type = 'button';
        liveSummary.className = 'tool-call-live-summary';
        liveSummary.setAttribute('aria-expanded', 'false');
        liveSummary.setAttribute('aria-label', '展开或收起 Agent 执行步骤');
        liveSummary.addEventListener('click', function() {
            var expanded = tcContainer.classList.toggle('tool-call-expanded');
            tcContainer.classList.add('tool-call-user-expanded');
            liveSummary.setAttribute('aria-expanded', String(expanded));
        });
        tcContainer.insertBefore(liveSummary, tcContainer.firstChild);
    }
    var liveSteps = tcContainer.querySelectorAll('.tool-call-line').length;
    var liveDone = tcContainer.querySelectorAll('.tool-call-success').length;
    var liveErrors = tcContainer.querySelectorAll('.tool-call-error').length;
    var isSettled = tcContainer.classList.contains('tool-call-settled');
    var summaryTitle = isSettled ? 'Agent 执行记录' : 'Agent 执行中';
    liveSummary.innerHTML = '<span class="tool-call-live-icon" aria-hidden="true"></span><strong>' + summaryTitle + '</strong><span class="tool-call-live-count">' + liveSteps + ' 步</span>' + (liveDone || liveErrors ? '<span class="tool-call-live-result">' + liveDone + ' 完成' + (liveErrors ? ' · ' + liveErrors + ' 失败' : '') + '</span>' : '') + '<span class="tool-call-live-chevron" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="m6 8 4 4 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    liveSummary.setAttribute('aria-expanded', String(tcContainer.classList.contains('tool-call-expanded')));
};

function showToast(msg, type = 'info', dur = 8000) {
    var container = getEl('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        document.body.appendChild(container);
    }
    // 相同通知在可见期间只保留一条，并限制侧栏最多 6 条，防止 SSE/重试风暴堆满页面。
    var toastKey = JSON.stringify([String(type), String(msg)]);
    var visibleToasts = container.querySelectorAll('.toast');
    for (var _ti = 0; _ti < visibleToasts.length; _ti++) {
        if (visibleToasts[_ti].getAttribute('data-toast-key') === toastKey) {
            return visibleToasts[_ti];
        }
    }
    while (visibleToasts.length >= 6) {
        visibleToasts[0].remove();
        visibleToasts = container.querySelectorAll('.toast');
    }

    var toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('data-toast-key', toastKey);
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    // SVG 图标(白描边渲染在类型色渐变圆内), 与 .toast-icon 的 CSS 变量色联动
    var ICONS = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };
    toast.innerHTML = `
        <div class="toast-icon" aria-hidden="true">${ICONS[type] || ICONS.info}</div>
        <div class="toast-message">${escapeHtml(msg)}</div>
        <button type="button" class="toast-close" aria-label="关闭通知">&times;</button>
    `;
    // ★ 点击消息区复制全文到方便器,方便用户捕获一闪而过的错误信息
    var msgEl = toast.querySelector('.toast-message');
    if (msgEl) {
        msgEl.style.cursor = 'pointer';
        msgEl.title = '点击复制';
        msgEl.onclick = function() {
            var text = msgEl.textContent || '';
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(function() {
                    // 降级:临时 textarea 选中复制
                    var ta = document.createElement('textarea');
                    ta.value = text; document.body.appendChild(ta);
                    ta.select(); try { document.execCommand('copy'); } catch(_e) {}
                    ta.remove();
                });
            }
        };
    }
    var dismissed = false;
    var dismiss = function() {
        if (dismissed) return;
        dismissed = true;
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(function() { toast.remove(); }, 200);
    };
    toast.querySelector('.toast-close').onclick = dismiss;
    setTimeout(dismiss, dur);
    container.appendChild(toast);
}

// ============================================================
// ⌨️ Slash Command Popup
// ============================================================
const SLASH_COMMANDS = [
    // ── 搜索 ──
    { cmd: 'search', hint: '强制联网搜索', args: '[query]', icon: 'search', group: '搜索' },
    { cmd: 'news', hint: '搜索新闻资讯', args: '[query]', icon: 'news', group: '搜索' },
    { cmd: 'image', hint: '搜索网络图片', args: '[query]', icon: 'image', group: '搜索' },
    // ── Agent ──
    { cmd: 'mode', hint: '查看/切换工作模式', args: '[plan|agent|yolo|off]', icon: 'mode', group: 'Agent' },
    { cmd: 'model', hint: '查看/切换 AI 模型', args: '[name]', icon: 'model', group: 'Agent' },
    { cmd: 'agents', hint: '列出活跃子代理', icon: 'agent', group: 'Agent' },
    { cmd: 'agent', hint: '切换到子代理会话', args: '<name>', icon: 'agent', group: 'Agent' },
    { cmd: 'clearsub', hint: '清理历史子代理会话', icon: 'clear', group: 'Agent' },
    { cmd: 'mcp', hint: '查看 MCP 工具状态', icon: 'mcp', group: 'Agent' },
    { cmd: 'effort', hint: '设置推理思考力度', args: '[off|low|medium|high|max|ultra]', icon: 'effort', group: 'Agent' },
    { cmd: 'think', hint: '切换深度思考', args: '[on|off|auto]', icon: 'think', group: 'Agent' },
    // ── 对话 ──
    { cmd: 'new', hint: '新建对话', icon: 'new', group: '对话' },
    { cmd: 'clear', hint: '彻底清空当前对话与队列', icon: 'clear', group: '对话' },
    { cmd: 'compact', hint: '压缩对话上下文', icon: 'compact', group: '对话' },
    { cmd: 'retry', hint: '重新生成上一条回复', icon: 'retry', group: '对话' },
    { cmd: 'copy', hint: '复制最后 AI 回复', icon: 'copy', group: '对话' },
    { cmd: 'export', hint: '导出 Markdown 聊天记录', icon: 'export', group: '对话' },
    { cmd: 'stop', hint: '全链路停止当前生成', icon: 'stop', group: '对话' },
    { cmd: 'queue', hint: '查看消息队列排队状态', icon: 'queue', group: '对话' },
    { cmd: 'remember', hint: '保存/查看跨会话记忆', args: '[key: content]', icon: 'config', group: '对话' },
    // ── 工作区 ──
    { cmd: 'workspace', hint: '查看/切换 DSH 工作区', args: '[list|add <路径>|<名称>]', icon: 'folder', group: '工作区' },
    { cmd: 'cd', hint: '快速切换工作区路径', args: '<路径>', icon: 'folder', group: '工作区' },
    { cmd: 'cwd', hint: '查看当前工作区路径', icon: 'folder', group: '工作区' },
    // ── 上传 ──
    { cmd: 'attach', hint: '上传文件 / 图片附件', icon: 'attach', group: '上传' },
    { cmd: 'folder', hint: '上传整个文件夹目录', icon: 'folder', group: '上传' },
    // ── 系统 ──
    { cmd: 'config', hint: '打开/关闭配置面板', icon: 'config', group: '系统' },
    { cmd: 'context', hint: '查看上下文用量分析', icon: 'context', group: '系统' },
    { cmd: 'cost', hint: '查看会话费用与 Token 统计', icon: 'cost', group: '系统' },
    { cmd: 'doctor', hint: '系统诊断与服务检查', icon: 'doctor', group: '系统' },
    { cmd: 'diff', hint: '查看 Git 代码差异', args: '[args]', icon: 'diff', group: '系统' },
    { cmd: 'theme', hint: '切换主题外观颜色', args: '[dark|light|auto]', icon: 'theme', group: '系统' },
    { cmd: 'logout', hint: '退出登录当前账户', icon: 'logout', group: '系统' },
    { cmd: 'help', hint: '显示所有可用命令帮助', icon: 'help', group: '帮助' }
];

window._slashIdx = -1;
window._slashVisible = false;

function _positionSlashPopup() {
    var popup = getEl('slashPopup');
    var inp = document.getElementById('userInput');
    if (!popup || !inp) return;
    var rect = inp.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    var width = Math.min(760, Math.max(320, rect.width), window.innerWidth - 24);
    var left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    popup.style.left = left + 'px';
    popup.style.width = width + 'px';
}

function handleSlashInput(el) {
    var val = el.value;
    if (!val || !val.startsWith('/')) { hideSlashPopup(); return; }
    var query = val.slice(1);
    console.log('[Slash] input_changed, query_length=' + query.length);
    if (query.includes(' ')) { hideSlashPopup(); return; }
    updateSlashPopup(query.toLowerCase());
}

function updateSlashPopup(query) {
    var popup = getEl('slashPopup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'slashPopup';
        popup.className = 'slash-popup';
        popup.style.opacity = '0';
        popup.style.transform = 'translateY(8px)';
        // ★ 挂到 body (Input-wrapper 有 overflow:hidden 会裁剪)
        if (!popup.parentNode) document.body.appendChild(popup);
    }
    _positionSlashPopup();
    // ★ 监听 resize/scroll 自动跟随
    if (!window.__slashResizeBound) {
        window.__slashResizeBound = true;
        window.addEventListener('resize', function() { if (window._slashVisible) _positionSlashPopup(); });
        window.addEventListener('scroll', function() { if (window._slashVisible) _positionSlashPopup(); }, true);
    }
    var matches = SLASH_COMMANDS.filter(function(c) { return !query || c.cmd.indexOf(query) >= 0 || c.hint.indexOf(query) >= 0; });
    console.log('[Slash] matches=' + matches.length + ', query_length=' + query.length);
    if (matches.length === 0) { hideSlashPopup(); return; }
    var groups = {};
    matches.forEach(function(m) { if (!groups[m.group]) groups[m.group] = []; groups[m.group].push(m); });
    var html = '';
    var idx = 0;
    Object.keys(groups).forEach(function(g) {
        html += '<div class=slash-popup-group>' + escapeHtml(g) + '</div>';
        groups[g].forEach(function(m) {
            var iconSvg = m.icon ? '<svg class="slash-item-icon-svg"><use href="#cmd-icon-' + m.icon + '"/></svg>' : '';
            var argTag = m.args ? '<span class=slash-item-args>' + m.args + '</span>' : '';
            var disabledClass = m._disabled ? ' slash-item-disabled' : '';
            html += '<div class="slash-popup-item' + (idx === 0 ? ' slash-item-highlight' : '') + disabledClass + '" data-cmd="' + escapeHtml(m.cmd) + '" data-args="' + escapeHtml(m.args||'') + '"' + (m._disabled ? ' style="pointer-events:none;opacity:0.4"' : '') + '>' +
                iconSvg +
                '<span class=slash-item-cmd>/' + m.cmd + '</span>' + argTag +
                '<span class=slash-item-hint>' + (m._disabled ? '(Agent模式可用) ' : '') + m.hint + '</span>' +
            '</div>';
            idx++;
        });
    });
    html += '<div class=slash-popup-footer>↑↓ 选择 · Enter 确认 · Esc 关闭</div>';
    popup.innerHTML = html;
    window._slashIdx = 0;
    window._slashVisible = true;
    popup.style.pointerEvents = 'auto';
    popup.querySelectorAll('.slash-popup-item').forEach(function(item) {
        var _touchStartY = 0;
        item.addEventListener('click', function() { selectSlashCommand(this.dataset.cmd, this.dataset.args); });
        item.addEventListener('touchstart', function(e) { _touchStartY = e.touches[0].clientY; });
        item.addEventListener('touchend', function(e) {
            var _dy = Math.abs(e.changedTouches[0].clientY - _touchStartY);
            // ★ 仅当滑动距离<8px时视为点击,否则是滚动
            if (_dy < 8) {
                e.preventDefault();
                selectSlashCommand(this.dataset.cmd, this.dataset.args);
            }
        });
    });
    requestAnimationFrame(function() {
        popup.style.opacity = '1';
        popup.style.transform = 'translateY(0)';
    });
}

function navigateSlashPopup(dir) {
    var popup = getEl('slashPopup');
    if (!popup || !window._slashVisible) return;
    var items = popup.querySelectorAll('.slash-popup-item');
    if (items.length === 0) return;
    var cur = popup.querySelector('.slash-item-highlight');
    if (cur) cur.classList.remove('slash-item-highlight');
    window._slashIdx = (window._slashIdx + dir + items.length) % items.length;
    var target = items[window._slashIdx];
    target.classList.add('slash-item-highlight');
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function selectSlashCommand(cmd, args) {
    var input = $.userInput;
    if (!input) return;
    if (args) {
        input.value = '/' + cmd + ' ';
        input.setSelectionRange(input.value.length, input.value.length);
    } else {
        input.value = '/' + cmd + ' ';
        input.dispatchEvent(new Event('input', {bubbles:true}));
        sendMessage();
        input.value = '';
        return;
    }
    hideSlashPopup();
    window.autoResize(input);
    input.focus();
}

function hideSlashPopup() {
    var popup = getEl('slashPopup');
    if (popup) {
        window._slashVisible = false;
        popup.style.opacity = '0';
        popup.style.transform = 'translateY(8px)';
        popup.style.pointerEvents = 'none';
    }
}

// ============================================================
// 📌 @ Mention Popup — 输入 @ 时弹出代理/文件/工具选择
// ============================================================
window._mentionIdx = -1;
window._mentionVisible = false;
window._mentionTriggerPos = -1; // 光标处 @ 的起始位置

function _positionMentionPopup() {
    var popup = getEl('mentionPopup');
    var inp = document.getElementById('userInput');
    if (!popup || !inp) return;
    var rect = inp.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    popup.style.left = rect.left + 'px';
    popup.style.width = rect.width + 'px';
}

/** 收集 @ 提及的候选列表 */
function _collectMentionCandidates(query) {
    var candidates = [];
    // 1) 子代理 (从全局缓存读取)
    var agents = window._cachedAgentList || [];
    if (agents && agents.length) {
        agents.forEach(function(a) {
            var name = a.name || a.id || '';
            if (!name) return;
            candidates.push({
                type: 'agent',
                icon: '🤖',
                cmd: name,
                hint: '子代理 · ' + (a.role || 'general') + ' [' + (a.status || '?') + ']',
                group: '子代理'
            });
        });
    }
    // 也检查 _agentListCache (agent.js 的格式)
    var agentCache = window._agentListCache || {};
    Object.keys(agentCache).forEach(function(name) {
        var a = agentCache[name];
        if (!a) return;
        // 避免重复
        if (candidates.some(function(c) { return c.cmd === name; })) return;
        candidates.push({
            type: 'agent',
            icon: '🤖',
            cmd: name,
            hint: '子代理 · ' + (a.role || 'general') + ' [' + (a.status || '?') + ']',
            group: '子代理'
        });
    });
    // 2) 当前已上传/待发送的文件
    if (pendingFiles && pendingFiles.length) {
        pendingFiles.forEach(function(f, i) {
            var isImg = f.isImage || (f.type && f.type.startsWith('image/'));
            candidates.push({
                type: 'file',
                icon: isImg ? '🖼️' : '📄',
                cmd: f.name,
                hint: (isImg ? '图片' : '文件') + ' · ' + _formatFileSize(f.size),
                group: '已附加文件',
                index: i
            });
        });
    }
    // 3) 常用工具快捷引用
    var tools = [
        { cmd: 'web_search', hint: '联网搜索', icon: '🔍' },
        { cmd: 'web_fetch', hint: '抓取网页', icon: '🌐' },
        { cmd: 'analyze_image', hint: '分析图片', icon: '👁️' },
        { cmd: 'parse_document', hint: '解析文档', icon: '📝' },
        { cmd: 'server_exec', hint: '执行命令', icon: '⚙️' },
    ];
    tools.forEach(function(t) {
        candidates.push({ type: 'tool', icon: t.icon, cmd: t.cmd, hint: '工具 · ' + t.hint, group: '工具' });
    });
    // 过滤
    if (query) {
        var q = query.toLowerCase();
        candidates = candidates.filter(function(c) {
            return c.cmd.toLowerCase().indexOf(q) >= 0 || c.hint.toLowerCase().indexOf(q) >= 0;
        });
    }
    return candidates;
}

function handleMentionInput(el) {
    var val = el.value;
    var cursorPos = el.selectionStart || 0;
    if (!val) { hideMentionPopup(); return; }
    // 找到光标前最近的 @
    var beforeCursor = val.substring(0, cursorPos);
    var atIdx = beforeCursor.lastIndexOf('@');
    if (atIdx < 0) { hideMentionPopup(); return; }
    // @ 在开头且后面没有空格（即还在输入提及）
    var afterAt = val.substring(atIdx + 1, cursorPos);
    if (afterAt.indexOf(' ') >= 0) { hideMentionPopup(); return; }
    // @ 前面必须是空格或开头（避免邮箱误触发）
    if (atIdx > 0 && /\S/.test(val.substring(atIdx - 1, atIdx))) { hideMentionPopup(); return; }
    window._mentionTriggerPos = atIdx;
    updateMentionPopup(afterAt.toLowerCase());
}

function updateMentionPopup(query) {
    var popup = getEl('mentionPopup');
    var candidates = _collectMentionCandidates(query);
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'mentionPopup';
        popup.className = 'slash-popup'; // 复用 slash popup 样式
        popup.style.opacity = '0';
        popup.style.transform = 'translateY(8px)';
        if (!popup.parentNode) document.body.appendChild(popup);
    }
    _positionMentionPopup();
    if (!window.__mentionResizeBound) {
        window.__mentionResizeBound = true;
        window.addEventListener('resize', function() { if (window._mentionVisible) _positionMentionPopup(); });
        window.addEventListener('scroll', function() { if (window._mentionVisible) _positionMentionPopup(); }, true);
    }
    if (candidates.length === 0) { hideMentionPopup(); return; }
    var groups = {};
    candidates.forEach(function(m) { if (!groups[m.group]) groups[m.group] = []; groups[m.group].push(m); });
    var html = '';
    var idx = 0;
    Object.keys(groups).forEach(function(g) {
        html += '<div class=slash-popup-group>' + escapeHtml(g) + '</div>';
        groups[g].forEach(function(m) {
            html += '<div class="slash-popup-item' + (idx === 0 ? ' slash-item-highlight' : '') + '" data-type="' + m.type + '" data-cmd="' + escapeHtml(m.cmd) + '" data-index="' + (m.index ?? -1) + '">' +
                '<span class="mention-item-icon">' + m.icon + '</span>' +
                '<span class=slash-item-cmd>' + escapeHtml(m.cmd) + '</span>' +
                '<span class=slash-item-hint>' + escapeHtml(m.hint) + '</span>' +
            '</div>';
            idx++;
        });
    });
    html += '<div class=slash-popup-footer>↑↓ 选择 · Enter 确认 · Esc 关闭</div>';
    popup.innerHTML = html;
    window._mentionIdx = 0;
    window._mentionVisible = true;
    popup.style.pointerEvents = 'auto';
    popup.querySelectorAll('.slash-popup-item').forEach(function(item) {
        item.addEventListener('click', function() {
            selectMentionCommand(this.dataset.type, this.dataset.cmd, parseInt(this.dataset.index || '-1', 10));
        });
    });
    requestAnimationFrame(function() {
        popup.style.opacity = '1';
        popup.style.transform = 'translateY(0)';
    });
}

function navigateMentionPopup(dir) {
    var popup = getEl('mentionPopup');
    if (!popup || !window._mentionVisible) return;
    var items = popup.querySelectorAll('.slash-popup-item');
    if (items.length === 0) return;
    var cur = popup.querySelector('.slash-item-highlight');
    if (cur) cur.classList.remove('slash-item-highlight');
    window._mentionIdx = (window._mentionIdx + dir + items.length) % items.length;
    var target = items[window._mentionIdx];
    target.classList.add('slash-item-highlight');
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function selectMentionCommand(type, cmd, index) {
    var input = $.userInput;
    if (!input) return;
    var val = input.value;
    var pos = window._mentionTriggerPos;
    // 替换 @xxx 为选中的文本
    var before = val.substring(0, pos);
    var after = val.substring(input.selectionStart || val.length);
    var insertText = '';
    if (type === 'agent') {
        insertText = '@' + cmd + ' ';
    } else if (type === 'file') {
        insertText = '[' + cmd + '] ';
    } else if (type === 'tool') {
        insertText = '@' + cmd + ' ';
    } else {
        insertText = cmd + ' ';
    }
    input.value = before + insertText + after;
    var newPos = before.length + insertText.length;
    input.setSelectionRange(newPos, newPos);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    hideMentionPopup();
}

function hideMentionPopup() {
    var popup = getEl('mentionPopup');
    if (popup) {
        window._mentionVisible = false;
        popup.style.opacity = '0';
        popup.style.transform = 'translateY(8px)';
        popup.style.pointerEvents = 'none';
    }
}

// 自动滚动到底部(用于AI回复等场景)
function autoScrollToBottom(reason) {
    if (!$.chatBox) return;
    const { scrollTop, scrollHeight, clientHeight } = $.chatBox;
    var distFromBottom = scrollHeight - scrollTop - clientHeight;
    // ★ 用户已远离开底部(>1.5x视口)时不强制拉回(loadChat 除外)
    if (distFromBottom > clientHeight * 1.5 && reason !== 'loadChat') {
        if (reason !== 'streaming' || userScrolled) return;
    }
    // ★ 统一走 followToBottom: 即时模式(避免 CSS smooth 与程序赋值冲突)
    followToBottom($.chatBox);
}

// 回到底部按钮 — 用户主动行为, 允许平滑滚动
window.scrollToBottom = () => {
    followToBottom($.chatBox, { smooth: true });
    userScrolled = false;
    if ($.scrollToBottomBtn) $.scrollToBottomBtn.classList.remove('visible');
};

window.toggleDarkMode = function (init = false) {
    var html = document.documentElement;
    var storedDark = localStorage.getItem('dark');
    // init=true 表示“同步已保存的主题”，不是再反转一次。
    // 旧实现在 cancelConfig -> initializeConfig -> toggleDarkMode(true)
    // 链路中会把深色变浅色，再点一次又反过来。
    var dark = init
        ? (storedDark === 'true' || (storedDark === null && localStorage.getItem('theme') === 'dark'))
        : !html.classList.contains('dark');
    html.classList.toggle('dark', dark);
    if (!init) localStorage.setItem('dark', dark);
    var moon = getEl('moonPath');
    var sun = getEl('sunPath');
    moon?.classList.toggle('hidden', dark);
    sun?.classList.toggle('hidden', !dark);
    var theme = getEl('hljsTheme');
    if (theme) theme.href = dark ? 'lib/atom-one-dark.min.css' : 'lib/atom-one-light.min.css';
    // 同步下拉菜单暗色适配
    if (typeof applyDropdownTheme === 'function') applyDropdownTheme();
    // 同步侧边栏主题按钮图标与提示文字
    var sidebarMoon = getEl('sidebarMoonPath');
    var sidebarSun = getEl('sidebarSunPath');
    var sidebarThemeText = getEl('sidebarThemeText');
    sidebarMoon?.classList.toggle('hidden', dark);
    sidebarSun?.classList.toggle('hidden', !dark);
    if (sidebarThemeText) sidebarThemeText.textContent = dark ? '浅色模式' : '深色模式';
};

function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
}

window.closeMobileSidebars = () => {
    if (!isMobile()) return;
    $.sidebar?.classList.remove('mobile-open', 'collapsed');
    $.configPanel?.classList.remove('mobile-open');
    $.agentPanel?.classList.add('hidden-panel');
    $.sidebarMask?.classList.remove('active');
    _setPanelAccessibility($.sidebar, false);
    _setPanelAccessibility($.configPanel, false);
    _setPanelAccessibility($.agentPanel, false);
    _setToggleExpanded('[data-panel-toggle="sidebar"], #sidebarToggle', false);
    lockBodyScroll(false);
};

function lockBodyScroll(lock) {
    if (lock) {
        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';
    } else {
        document.body.style.overflow = '';
        document.body.style.touchAction = '';
    }
}

function _moveFocusOutOfPanel(panel) {
    if (!panel || !panel.contains(document.activeElement)) return;
    // aria-hidden/inert 之前先把焦点交还给面板触发按钮，避免浏览器把“聚焦元素的祖先被隐藏”报成无障碍错误。
    var candidates = document.querySelectorAll('[data-panel-toggle="config"], button[onclick*="toggleConfigPanel"], [data-panel-toggle="agent"], button[onclick*="toggleAgentPanel"]');
    var target = null;
    for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i];
        if (panel.contains(candidate) || candidate.disabled) continue;
        if (candidate.getClientRects && candidate.getClientRects().length === 0) continue;
        var hiddenAncestor = candidate.closest('[aria-hidden="true"], [inert]');
        if (hiddenAncestor) continue;
        target = candidate;
        break;
    }
    if (target && typeof target.focus === 'function') {
        try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    } else if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
}

function _setPanelAccessibility(panel, isOpen) {
    if (!panel) return;
    if (!isOpen) _moveFocusOutOfPanel(panel);
    panel.inert = !isOpen;
    panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

function _setToggleExpanded(selector, expanded) {
    document.querySelectorAll(selector).forEach(function(btn) {
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
}

function _syncConfigShellState(isOpen) {
    var shell = document.querySelector('.main-shell') || document.querySelector('.flex-1.flex-col');
    shell?.classList.toggle('config-open', !!isOpen && !isMobile());
    _setPanelAccessibility($.configPanel, !!isOpen);
    _setToggleExpanded('[data-panel-toggle="config"], button[onclick*="toggleConfigPanel"]', !!isOpen);
}
window._syncConfigShellState = _syncConfigShellState;
window._moveFocusOutOfPanel = _moveFocusOutOfPanel;

window.closeConfigPanel = function() {
    if (!$.configPanel) return;
    $.configPanel.classList.remove('mobile-open');
    $.configPanel.classList.add('hidden-panel');
    $.sidebarMask?.classList.remove('active');
    configPanelWasOpen = false;
    _syncConfigShellState(false);
    lockBodyScroll(false);
};

window._syncChatTitlePlacement = function(mobile) {
    var title = $.chatTitle || getEl('chatTitle');
    var header = document.querySelector('.app-header') || document.querySelector('header');
    var chatBox = $.chatBox || getEl('chatBox');
    if (!title || !header || !chatBox) return;
    $.chatTitle = title;

    if (mobile) {
        title.dataset.mobile = '1';
        title.className = 'chat-title chat-title-mobile';
        if (title.parentElement !== chatBox) chatBox.prepend(title);
    } else {
        delete title.dataset.mobile;
        title.className = 'chat-title';
        var right = header.querySelector('.header-actions') || header.querySelector('.flex.items-center.gap-3');
        if (title.parentElement !== header || title.nextElementSibling !== right) {
            header.insertBefore(title, right || null);
        }
    }
};

window.closeAllSidebars = function () {
    $.sidebar?.classList.remove('mobile-open');
    $.sidebar?.classList.remove('collapsed');
    $.configPanel?.classList.remove('mobile-open');
    $.configPanel?.classList.add('hidden-panel');
    if ($.agentPanel && !$.agentPanel.classList.contains('hidden-panel') && typeof window.closeAgentPanel === 'function') {
        window.closeAgentPanel();
    } else {
        $.agentPanel?.classList.add('hidden-panel');
    }
    $.sidebarMask?.classList.remove('active');
    _setPanelAccessibility($.sidebar, !isMobile());
    _setPanelAccessibility($.configPanel, false);
    _setPanelAccessibility($.agentPanel, false);
    _setToggleExpanded('[data-panel-toggle="sidebar"], #sidebarToggle', false);
    _syncConfigShellState(false);
    lockBodyScroll(false);
};

window.toggleSidebar = () => {
    // 移动端抽屉只由 mobile-open 控制；不要让桌面端的 collapsed/hidden-panel
    // 继续携带 width:0、opacity:0 或 inert 状态，否则只会看到遮罩而看不到侧栏。
    if (isMobile()) {
        var sidebar = $.sidebar;
        if (!sidebar) return;
        var open = sidebar.classList.contains('mobile-open');
        if (open) {
            sidebar.classList.remove('mobile-open', 'collapsed');
            $.sidebarMask?.classList.remove('active');
            _setPanelAccessibility(sidebar, false);
            _setToggleExpanded('[data-panel-toggle="sidebar"], #sidebarToggle', false);
            lockBodyScroll(false);
        } else {
            $.configPanel?.classList.remove('mobile-open');
            $.configPanel?.classList.add('hidden-panel');
            sidebar.classList.remove('hidden-panel');
            sidebar.classList.add('mobile-open');
            // Agent 模式切入时可能残留 collapsed；CSS 最终覆盖会保留抽屉宽度。
            $.sidebarMask?.classList.add('active');
            _setPanelAccessibility(sidebar, true);
            _setPanelAccessibility($.configPanel, false);
            _setToggleExpanded('[data-panel-toggle="sidebar"], #sidebarToggle', true);
            _syncConfigShellState(false);
            lockBodyScroll(true);
            if (typeof renderChatHistory === 'function') {
                try { renderChatHistory(); } catch (e) {}
            }
        }
    } else {
        $.sidebar?.classList.toggle('collapsed');
        var sidebarOpen = !$.sidebar?.classList.contains('collapsed');
        _setPanelAccessibility($.sidebar, sidebarOpen);
        _setToggleExpanded('[data-panel-toggle="sidebar"], #sidebarToggle', sidebarOpen);
        if ($.sidebarToggle) $.sidebarToggle.style.display = sidebarOpen ? 'none' : 'inline-flex';
    }
};

window.toggleConfigPanel = () => {
    // 如果当前正在与配置面板交互(输入框聚焦),不允许关闭
    var activeEl = document.activeElement;
    if (configPanelInteracting && activeEl && $.configPanel?.contains(activeEl) && activeEl.matches('input, textarea, select')) {
        return; // 输入框聚焦时禁止关闭
    }
    if (isMobile()) {
        if ($.configPanel?.classList.contains('mobile-open')) {
            window.closeConfigPanel();
        } else {
            $.configPanel?.classList.remove('hidden-panel');
            $.configPanel?.classList.add('mobile-open');
            $.sidebar?.classList.remove('mobile-open');
            $.sidebarMask?.classList.add('active');
            configSnapshot = snapshotConfig();
            configPanelWasOpen = true;
            _setPanelAccessibility($.sidebar, false);
            _syncConfigShellState(true);
            lockBodyScroll(true);
        }
    } else {
        var isOpening = $.configPanel?.classList.contains('hidden-panel');
        // Close SRC panel when opening config panel
        if (isOpening) {
            var sp = document.getElementById("srcPanel");
            if (sp && !sp.classList.contains("hidden-panel")) {
                sp.classList.add("hidden-panel");
            }
        }
        $.configPanel?.classList.toggle('hidden-panel');
        _syncConfigShellState(isOpening);
        // 打开时保存配置快照,关闭时清除
        if (isOpening) {
            configSnapshot = snapshotConfig();
            configPanelWasOpen = true;
            // ★ 加载工具开关状态、自定义技能列表、记忆系统
            if (window.loadToolToggleStates) window.loadToolToggleStates();
            if (window.renderCustomSkillsList) window.renderCustomSkillsList();
            if (window.refreshMemoryList) window.refreshMemoryList();
            // ★ v2: 同步人格预设选择器
            setTimeout(function() {
                var sel = document.getElementById('personalityPreset');
                if (sel && window.__memoryContext && window.__memoryContext.presetId) {
                    sel.value = window.__memoryContext.presetId;
                }
            }, 500);
        } else {
            configSnapshot = null;
            configPanelWasOpen = false;
        }
    }
};
// 图像按钮点击 - 触发图片上传(通用文件)
window.toggleImageConfig = () => {
    $.fileInput?.click();
};

// 切换图像提供商(MiniMax / OpenRouter / OpenAI / 自定义)时更新字段:可见性、密钥、提示
// ★ 模型按提供商独立存储(imageModel_{provider}),切换时不丢失各提供商的模型
async function toggleImageProviderFields() {
    var provider = getVal('imageProvider') || 'minimax';
    var modelInput = getEl('imageModel');
    var hintEl = getEl('imageProviderHint');

    // ★ 字段映射:每个提供商对应一组 Key/URL 字段
    var fields = {
        minimax: ['imageKeyField', 'imageUrlField'],
        openrouter: ['orKeyField', 'orUrlField'],
        openai: ['oaiKeyField', 'oaiUrlField'],
        custom: ['customKeyField', 'customUrlField']
    };
    // ★ 配置映射:每个提供商的 Key/URL localStorage 键 + 默认值 + 模型默认值
    var cfg = {
        minimax: { keyLS: 'imageApiKey', urlLS: 'imageBaseUrl', defUrl: 'https://api.minimaxi.com', defModel: 'image-01', placeholder: 'image-01' },
        openrouter: { keyLS: 'imageApiKeyOpenrouter', urlLS: 'imageBaseUrlOpenrouter', defUrl: 'https://openrouter.ai/api', defModel: 'openai/gpt-5.4-image-2', placeholder: 'openai/gpt-5.4-image-2' },
        openai: { keyLS: 'imageApiKeyOpenai', urlLS: 'imageBaseUrlOpenai', defUrl: 'https://api.openai.com/v1', defModel: 'gpt-image-1', placeholder: 'gpt-image-1' },
        custom: { keyLS: 'imageApiKeyCustom', urlLS: 'imageBaseUrlCustom', defUrl: '', defModel: '', placeholder: '如: dall-e-3' }
    };

    // 切换前保存当前值到对应提供商的 localStorage 键 + 模型
    if (window._lastImageProvider && window._lastImageProvider !== provider) {
        var _prev = window._lastImageProvider;
        var _prevCfg = cfg[_prev] || cfg.minimax;
        localStorage.setItem(_prevCfg.keyLS, await encrypt(getVal(_prevCfg.keyLS === 'imageApiKey' ? 'imageApiKey' :
            _prevCfg.keyLS === 'imageApiKeyOpenrouter' ? 'imageApiKeyOpenrouter' :
            _prevCfg.keyLS === 'imageApiKeyOpenai' ? 'imageApiKeyOpenai' : 'imageApiKeyCustom') || ''));
        // 保存 URL
        var _prevUrlFieldId = (_prev === 'minimax') ? 'imageBaseUrl' : (_prev === 'openrouter') ? 'imageBaseUrlOpenrouter' : (_prev === 'openai') ? 'imageBaseUrlOpenai' : 'imageBaseUrlCustom';
        localStorage.setItem(_prevCfg.urlLS, getVal(_prevUrlFieldId) || '');
        // ★ 保存当前模型到该提供商的独立键
        if (modelInput) localStorage.setItem('imageModel_' + _prev, modelInput.value || '');
    }
    window._lastImageProvider = provider;

    // 切换字段可见性
    Object.keys(fields).forEach(function(k) {
        var _visible = k === provider;
        fields[k].forEach(function(id) {
            var el = getEl(id); if (el) el.style.display = _visible ? '' : 'none';
        });
    });

    // 恢复当前提供商的配置值
    var _curCfg = cfg[provider] || cfg.minimax;
    var _keyFieldId = (provider === 'minimax') ? 'imageApiKey' : (provider === 'openrouter') ? 'imageApiKeyOpenrouter' : (provider === 'openai') ? 'imageApiKeyOpenai' : 'imageApiKeyCustom';
    var _urlFieldId = (provider === 'minimax') ? 'imageBaseUrl' : (provider === 'openrouter') ? 'imageBaseUrlOpenrouter' : (provider === 'openai') ? 'imageBaseUrlOpenai' : 'imageBaseUrlCustom';
    var _keyInput = getEl(_keyFieldId);
    var _urlInput = getEl(_urlFieldId);
    var _storedKey = await decrypt(localStorage.getItem(_curCfg.keyLS) || '') || '';
    var _storedUrl = localStorage.getItem(_curCfg.urlLS) || _curCfg.defUrl;
    if (_keyInput) _keyInput.value = _storedKey !== 'not-needed' ? _storedKey : '';
    if (_urlInput) _urlInput.value = _storedUrl;
    if (modelInput) {
        modelInput.placeholder = _curCfg.placeholder;
        // ★ 恢复模型优先级: 提供商独立键 > 输入框当前值(initializeConfig 已恢复) > 默认值
        // 不直接回退到通用 imageModel 键,避免跨提供商串扰(如 OpenRouter 的 openai/gpt-5.4-image-2 泄漏到 custom)
        var _savedModel = localStorage.getItem('imageModel_' + provider);
        if (_savedModel === null || _savedModel === undefined) {
            // 独立键不存在: 保留 initializeConfig 已恢复的值,仅当为空时用默认值
            if (!modelInput.value) modelInput.value = _curCfg.defModel;
        } else {
            modelInput.value = _savedModel;
        }
    }

    // ★ 提示文本
    var hints = {
        minimax: 'MiniMax: 使用 image-01 模型,写实风格。使用独立 API Key,不影响主 API Key。',
        openrouter: 'OpenRouter: 使用 GPT Image 2。使用独立的 API Key,不影响主 API Key。',
        openai: 'OpenAI: 使用 gpt-image-1 / DALL-E 系列。端点 /v1/images/generations。⚠️ 中国大陆需开启代理。',
        custom: '自定义: 使用 OpenAI 兼容格式 (/v1/images/generations)。填写你的服务地址和模型名。CLIProxyAPI 可用: gpt-image-1.5, gpt-image-2, grok-imagine-image'
    };
    if (hintEl) hintEl.textContent = hints[provider] || '';

    // ★ 仅在用户切换提供商时保存(页面初始化时不触发saveConfig,避免覆盖服务器配置)
    if (window._isUserChangingProvider) {
        saveConfig();
        window._isUserChangingProvider = false;
    }
}

// ===== 视觉理解提供商切换 =====
window.onVisionProviderChange = async function() {
    var provider = getEl('visionProvider')?.value || 'minimax';
    var keyInput = getEl('visionApiKey');
    var urlInput = getEl('visionApiUrl');
    var oaKeyInput = getEl('visionApiKeyOpenAI');
    var oaUrlInput = getEl('visionApiUrlOpenAI');
    var modelInput = getEl('visionModel');
    var hintEl = getEl('visionProviderHint');
    
    // ★ 切换前保存当前值到对应提供商的 localStorage (防止切换时丢失)
    if (window._lastVisionProvider && window._lastVisionProvider !== provider) {
        if (window._lastVisionProvider === 'minimax') {
            localStorage.setItem('visionApiKey', await encrypt(getVal('visionApiKey') || ''));
            localStorage.setItem('visionApiUrl', getVal('visionApiUrl') || '');
        } else if (window._lastVisionProvider === 'openai') {
            localStorage.setItem('visionApiKeyOpenAI', await encrypt(getVal('visionApiKeyOpenAI') || ''));
            localStorage.setItem('visionApiUrlOpenAI', getVal('visionApiUrlOpenAI') || '');
        } else if (window._lastVisionProvider === 'xai') {
            localStorage.setItem('visionApiKeyXAI', await encrypt(getVal('visionApiKeyXAI') || ''));
            localStorage.setItem('visionApiUrlXAI', getVal('visionApiUrlXAI') || 'https://api.x.ai/v1');
        } else if (window._lastVisionProvider === 'custom') {
            localStorage.setItem('visionApiKeyCustom', await encrypt(getVal('visionApiKeyCustom') || ''));
            localStorage.setItem('visionApiUrlCustom', getVal('visionApiUrlCustom') || '');
        }
    }
    window._lastVisionProvider = provider;
    localStorage.setItem('visionProvider', provider);

    // 切换字段可见性
    var fields = { minimax: ['visionKeyField', 'visionUrlField'], openai: ['visionOAKeyField', 'visionOAUrlField'], xai: ['visionXAIKeyField', 'visionXAIUrlField'], custom: ['visionCustomKeyField', 'visionCustomUrlField'] };
    Object.keys(fields).forEach(function(k) {
        fields[k].forEach(function(id) {
            var el = getEl(id); if (el) el.style.display = k === provider ? '' : 'none';
        });
    });

    // 恢复对应提供商的配置值
    if (provider === 'openai') {
        var _storedKey = await decrypt(localStorage.getItem('visionApiKeyOpenAI') || '') || '';
        var _storedUrl = localStorage.getItem('visionApiUrlOpenAI') || 'https://api.openai.com/v1';
        if (oaKeyInput) oaKeyInput.value = _storedKey;
        if (oaUrlInput) oaUrlInput.value = _storedUrl;
        if (modelInput) modelInput.value = 'gpt-4o';
        if (hintEl) hintEl.textContent = 'OpenAI: 使用 GPT-4o 等视觉模型。使用独立的 API Key。⚠️ 中国大陆需开启代理。';
        // ★ 选择 OpenAI 时自动启用代理 (api.openai.com 在中国大陆被封锁)
        if (!window.isProxyEnabled || !window.isProxyEnabled()) {
            if (typeof window.toggleProxy === 'function' && typeof setChecked === 'function') {
                setChecked('proxyToggle', true);
                window.toggleProxy();
                console.log('[visionProvider] OpenAI 已选择, 自动启用代理');
            }
        }
    } else if (provider === 'xai') {
        var _storedKeyX = await decrypt(localStorage.getItem('visionApiKeyXAI') || '') || '';
        var _storedUrlX = localStorage.getItem('visionApiUrlXAI') || 'https://api.x.ai/v1';
        var xaiKeyInput = getEl('visionApiKeyXAI');
        var xaiUrlInput = getEl('visionApiUrlXAI');
        if (xaiKeyInput) xaiKeyInput.value = _storedKeyX;
        if (xaiUrlInput) xaiUrlInput.value = _storedUrlX;
        if (modelInput) modelInput.value = 'grok-4.5';
        if (hintEl) hintEl.textContent = 'xAI: 使用 Grok 视觉模型分析图片，结果以文本传给主模型。需配置 xAI API Key。⚠️ 中国大陆需开启代理。';
        // ★ 选择 xAI 时自动启用代理 (api.x.ai 在中国大陆被封锁)
        if (!window.isProxyEnabled || !window.isProxyEnabled()) {
            if (typeof window.toggleProxy === 'function' && typeof setChecked === 'function') {
                setChecked('proxyToggle', true);
                window.toggleProxy();
                console.log('[visionProvider] xAI 已选择, 自动启用代理');
            }
        }
    } else if (provider === 'minimax') {
        var _storedKey2 = await decrypt(localStorage.getItem('visionApiKey') || '') || '';
        var _storedUrl = localStorage.getItem('visionApiUrl') || 'https://api.minimaxi.com/v1/coding_plan/vlm';
        if (keyInput) keyInput.value = _storedKey2;
        if (urlInput) urlInput.value = _storedUrl;
        if (modelInput) modelInput.value = 'MiniMax-VL-01';
        if (hintEl) hintEl.textContent = 'MiniMax: 使用 coding-plan-vlm 端点的视觉理解能力。';
    } else if (provider === 'custom') {
        // 自定义: 恢复独立存储的 Key/URL
        var _storedKeyC = await decrypt(localStorage.getItem('visionApiKeyCustom') || '') || '';
        var _storedUrlC = localStorage.getItem('visionApiUrlCustom') || '';
        var customKeyInput = getEl('visionApiKeyCustom');
        var customUrlInput = getEl('visionApiUrlCustom');
        if (customKeyInput) customKeyInput.value = _storedKeyC;
        if (customUrlInput) customUrlInput.value = _storedUrlC;
        if (modelInput) modelInput.value = '';
        if (modelInput) modelInput.placeholder = '如: qwen-vl-plus, gpt-4o';
        if (hintEl) hintEl.textContent = '自定义: 使用 OpenAI 兼容格式 (/v1/chat/completions + image_url)。填写你的服务地址、密钥和模型名。适用于 CLIProxyAPI、OneAPI、NewAPI 等中转服务。';
    } else {
        if (hintEl) hintEl.textContent = '请选择视觉理解提供商。';
    }
    window.saveConfig();
};

// 图片上传按钮 - 触发图片选择(仅图片,移动端友好)
// 图片上传功能已整合到文件上传中

// 保存配置快照(localStorage 中的配置值)
function snapshotConfig() {
    var keys = ['apiKey', 'baseUrl', 'systemPrompt', 'model', 'temp', 'tokens', 'stream',
        'requestTimeout', 'customParams', 'customEnabled',
        'lineHeight', 'paragraphMargin', 'markdownGFM', 'markdownBreaks',
        'compress', 'threshold', 'compressModel', 'enableSearch', 'searchModel', 'searchProvider',
        'searchApiKey', 'searchApiKeyBrave', 'searchApiKeyTavily', 'searchApiKeyDeepSeek', 'searchRegion', 'searchTimeout', 'maxSearchResults', 'aiSearchJudge',
        'aiSearchJudgeModel', 'aiSearchJudgePrompt', 'enableSearchOptimize', 'fontSize',
        'searchType', 'aiSearchTypeToggle', 'searchShowPrompt', 'searchAppendToSystem',
        'thinkingIntensity'];
    // ★ 同时捕获 baseUrlProvider 和所有 model_{provider} 键,确保取消时能完整恢复厂商+模型
    for (var _si = 0; _si < localStorage.length; _si++) {
        var _sKey = localStorage.key(_si);
        if (_sKey && (_sKey === 'baseUrlProvider' || _sKey.indexOf('model_') === 0) && keys.indexOf(_sKey) === -1) {
            keys.push(_sKey);
        }
    }
    var snapshot = {};
    keys.forEach(key => {
        let val = localStorage.getItem(key);
        if (val !== null) snapshot[key] = val;
    });
    return snapshot;
}

// 恢复配置快照
function restoreConfigSnapshot(snapshot) {
    if (!snapshot) return;
    // 先清除可能不存在于快照中的配置项
    var allKeys = ['apiKey', 'baseUrl', 'systemPrompt', 'model', 'temp', 'tokens', 'stream',
        'requestTimeout', 'customParams', 'customEnabled',
        'lineHeight', 'paragraphMargin', 'markdownGFM', 'markdownBreaks',
        'compress', 'threshold', 'compressModel', 'enableSearch', 'searchModel', 'searchProvider',
        'searchApiKey', 'searchApiKeyBrave', 'searchApiKeyTavily', 'searchApiKeyDeepSeek', 'searchRegion', 'searchTimeout', 'maxSearchResults', 'aiSearchJudge',
        'aiSearchJudgeModel', 'aiSearchJudgePrompt', 'enableSearchOptimize', 'fontSize',
        'searchType', 'aiSearchTypeToggle', 'searchShowPrompt', 'searchAppendToSystem',
        'thinkingIntensity'];
    // ★ 同时恢复 baseUrlProvider 和所有 model_{provider} 键 (与 snapshotConfig 对称)
    for (var _ri = 0; _ri < localStorage.length; _ri++) {
        var _rKey = localStorage.key(_ri);
        if (_rKey && (_rKey === 'baseUrlProvider' || _rKey.indexOf('model_') === 0) && allKeys.indexOf(_rKey) === -1) {
            allKeys.push(_rKey);
        }
    }
    allKeys.forEach(key => {
        if (snapshot.hasOwnProperty(key)) {
            localStorage.setItem(key, snapshot[key]);
        } else {
            localStorage.removeItem(key);
        }
    });
    // 重新加载配置到 UI
    initializeConfig();
    loadSearchConfig();
}

// 取消配置,恢复到打开面板时的状态
window.cancelConfig = () => {
    if (!configSnapshot) {
        // 没有快照,直接关闭面板
        window.closeConfigPanel();
        configSnapshot = null;
        configPanelWasOpen = false;
        return;
    }
    // 恢复配置
    restoreConfigSnapshot(configSnapshot);
    // 关闭面板
    window.closeConfigPanel();
    configSnapshot = null;
    configPanelWasOpen = false;
    showToast('已取消修改', 'info');
};

// 配置面板状态 - 用于防止键盘弹出时关闭面板
let configPanelWasOpen = false;

const handleResize = debounce(() => {
    var newWidth = window.innerWidth;
    var wasMobile = prevWidth <= MOBILE_BREAKPOINT;
    var nowMobile = newWidth <= MOBILE_BREAKPOINT;
    prevWidth = newWidth;

    if (wasMobile === nowMobile) return;

    // 抽屉跨断点时必须解除滚动锁并清理移动端状态；否则旋转设备后
    // body 仍保持 overflow:hidden，页面看似“卡死”。
    var configWasOpen = !!$.configPanel?.classList.contains('mobile-open');
    $.sidebar?.classList.remove('mobile-open');
    $.configPanel?.classList.remove('mobile-open');
    $.sidebarMask?.classList.remove('active');
    lockBodyScroll(false);
    window._syncChatTitlePlacement(nowMobile);

    if (nowMobile) {
        $.sidebar?.classList.remove('mobile-open', 'collapsed');
        $.configPanel?.classList.add('hidden-panel');
        _setPanelAccessibility($.sidebar, false);
        _syncConfigShellState(false);
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'inline-flex';
    } else {
        $.sidebar?.classList.remove('mobile-open', 'collapsed');
        _setPanelAccessibility($.sidebar, true);
        // 从打开的移动设置抽屉切到桌面时延续“设置已打开”的用户意图。
        $.configPanel?.classList.toggle('hidden-panel', !configWasOpen);
        _syncConfigShellState(configWasOpen);
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
    }
}, 100);
