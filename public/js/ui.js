// ui.js — UI 交互层 v1.0 (Phase 7 拆分自 main.js)
// 思考指示器 / 工具状态行 / Toast / Slash命令 / 暗色模式 / 侧边栏

// ==================== UI 工具 ====================
window.autoResize = function (el) {
    el.style.height = 'auto';
    // ★ 限制最大高度避免 rounded-full 背景溢出
    var max = window.innerWidth <= 480 ? 80 : 100;
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
window.showToolStatus = function(toolName, argPreview, status, chatId) {
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

    if (status === null) return;

    // ★ 旧行推出 - 用 opacity + margin-top 压缩
    tcContainer.querySelectorAll('.tool-call-line').forEach(function(old) {
        old.style.transition = 'all 0.15s ease';
        old.style.opacity = '0';
        old.style.marginTop = '-28px';
        setTimeout(function() { if (old.parentNode) old.remove(); }, 180);
    });

    var line = document.createElement('div');

    var iconHtml = '';
    if (status === 'running') {
        iconHtml = '<svg class=tool-call-spin width=18 height=18 viewBox="0 0 24 24" fill=none stroke=#6366f1 stroke-width=3 stroke-linecap=round><path d="M12 2a10 10 0 0 1 0 20"/></svg>';
    } else if (status === 'success') {
        iconHtml = '<svg class=tool-call-check width=18 height=18 viewBox="0 0 24 24" fill=none stroke=#22c55e stroke-width=3 stroke-linecap=round stroke-linejoin=round><path d="M4 12l6 6L20 6"/></svg>';
    } else if (status === 'error') {
        iconHtml = '<svg class=tool-call-x width=16 height=16 viewBox="0 0 24 24" fill=none stroke=#dc2626 stroke-width=3 stroke-linecap=round><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
    }

    line.innerHTML = '<span class=tool-c...wrap>' + iconHtml + '</span>' +
        '<span class="tool-call-name">' + escapeHtml(toolName) + '</span>' +
        (argPreview ? '<span class="tool-call-arg">' + escapeHtml((argPreview||'').substring(0, 40)) + '</span>' : '');

    var cls = 'tool-call-line';
    if (status === 'running') cls += ' tool-call-running';
    else if (status === 'success') { cls += ' tool-call-success'; try { navigator.vibrate && navigator.vibrate([15]); } catch(e){} }
    else if (status === 'error') { cls += ' tool-call-error'; try { navigator.vibrate && navigator.vibrate([30,50,30]); } catch(e){} }
    line.className = cls;
    line.dataset.tcStatus = status;
    line.dataset.tcName = toolName;
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

    // 完成后 3 秒淡出
    if (status === 'success' || status === 'error') {
        var self = line;
        setTimeout(function() {
            if (!self.parentNode) return;
            self.style.transition = 'all 0.35s ease';
            self.style.maxHeight = '0'; self.style.opacity = '0'; self.style.padding = '0'; self.style.margin = '0'; self.style.borderWidth = '0';
            setTimeout(function() { if (self.parentNode) self.remove(); }, 400);
        }, 3000);
    }
};

function showToast(msg, type = 'info', dur = 3000) {
    var container = getEl('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    var toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${ { success: '✓', error: '✕', warning: '⚠', info: 'i' }[type] }</div>
        <div class="toast-message">${escapeHtml(msg)}</div>
        <button class="toast-close">&times;</button>
    `;
    toast.querySelector('.toast-close').onclick = () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(function() { toast.remove(); }, 200);
    };
    setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(function() { toast.remove(); }, 200);
    }, dur);
    container.appendChild(toast);
}

// ============================================================
// ⌨️ Slash Command Popup
// ============================================================
const SLASH_COMMANDS = [
    { cmd: 'search', hint: '强制联网搜索', args: '[query]', icon: 'search', group: '搜索' },
    { cmd: 'news', hint: '搜索新闻', args: '[query]', icon: 'news', group: '搜索' },
    { cmd: 'image', hint: '搜索图片', args: '[query]', icon: 'image', group: '搜索' },
    { cmd: 'mode', hint: '切换工作模式', args: '[plan|agent|yolo|off]', icon: 'mode', group: 'Agent' },
    { cmd: 'model', hint: '切换 AI 模型', args: '[name]', icon: 'model', group: 'Agent' },
    { cmd: 'agents', hint: '列出活跃子代理', icon: 'agent', group: 'Agent' },
    { cmd: 'retry', hint: '重新生成上一条回复', icon: 'retry', group: '对话' },
    { cmd: 'clear', hint: '清空当前对话', icon: 'clear', group: '对话' },
    { cmd: 'compact', hint: '压缩对话上下文', icon: 'compact', group: '对话' },
    { cmd: 'new', hint: '新建对话', icon: 'new', group: '对话' },
    { cmd: 'export', hint: '导出聊天记录', icon: 'export', group: '对话' },
    { cmd: 'copy', hint: '复制最后 AI 回复', icon: 'copy', group: '对话' },
    { cmd: 'remember', hint: '保存/查看记忆', args: '[key: content]', icon: 'config', group: '对话' },
    { cmd: 'stop', hint: '停止当前生成', icon: 'stop', group: '对话' },
    { cmd: 'config', hint: '打开配置面板', icon: 'config', group: '系统' },
    { cmd: 'context', hint: '查看上下文用量', icon: 'context', group: '系统' },
    { cmd: 'doctor', hint: '系统诊断检查', icon: 'doctor', group: '系统' },
    { cmd: 'diff', hint: '查看 Git/文件差异', icon: 'diff', group: '系统' },
    { cmd: 'color', hint: '切换主题颜色', args: '[dark|light|auto]', icon: 'color', group: '系统' },
    { cmd: 'logout', hint: '退出登录', icon: 'logout', group: '系统' },
    { cmd: 'help', hint: '显示所有命令', icon: 'help', group: '帮助' }
];

window._slashIdx = -1;
window._slashVisible = false;

function handleSlashInput(el) {
    var val = el.value;
    if (!val.startsWith('/')) { hideSlashPopup(); return; }
    var query = val.slice(1);
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
        var wrap = document.getElementById('userInput')?.closest('.input-wrapper') || document.querySelector('.input-wrapper');
        if (wrap) wrap.appendChild(popup);
        else document.body.appendChild(popup);
    }
    var matches = SLASH_COMMANDS.filter(function(c) { return !query || c.cmd.indexOf(query) >= 0 || c.hint.indexOf(query) >= 0; });
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

// 自动滚动到底部(用于AI回复等场景)

// 自动滚动到底部(用于AI回复等场景)
function autoScrollToBottom(reason) {
    if (!$.chatBox) return;
    const { scrollTop, scrollHeight, clientHeight } = $.chatBox;
    var distFromBottom = scrollHeight - scrollTop - clientHeight;
    if (distFromBottom > clientHeight * 1.5 && reason !== 'loadChat') {
        if (reason !== 'streaming' || userScrolled) return;
    }
    // ★ 位置匹配法: 标记程序化滚动目标,scroll事件中匹配则忽略
    window.__lastAutoScrollTarget = $.chatBox.scrollHeight;
    if (distFromBottom > 200) {
        $.chatBox.scrollTo({ top: $.chatBox.scrollHeight, behavior: 'smooth' });
    } else {
        $.chatBox.scrollTop = $.chatBox.scrollHeight;
    }
}

window.scrollToBottom = () => {
    window.__lastAutoScrollTarget = $.chatBox.scrollHeight;
    $.chatBox?.scrollTo({ top: $.chatBox.scrollHeight, behavior: 'smooth' });
    userScrolled = false;
};

window.toggleDarkMode = function (init = false) {
    let html = document.documentElement;
    var dark = html.classList.toggle('dark');
    if (!init) localStorage.setItem('dark', dark);
    var moon = getEl('moonPath');
    var sun = getEl('sunPath');
    moon?.classList.toggle('hidden', dark);
    sun?.classList.toggle('hidden', !dark);
    var theme = getEl('hljsTheme');
    if (theme) theme.href = dark ? 'lib/atom-one-dark.min.css' : 'lib/atom-one-light.min.css';
    // 同步下拉菜单暗色适配
    if (typeof applyDropdownTheme === 'function') applyDropdownTheme();
};

function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
}

window.closeMobileSidebars = () => {
    if (!isMobile()) return;
    $.sidebar?.classList.remove('mobile-open');
    $.configPanel?.classList.remove('mobile-open');
    $.sidebarMask?.classList.remove('active');
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

window.closeAllSidebars = function () {
    $.sidebar?.classList.remove('mobile-open');
    $.configPanel?.classList.remove('mobile-open');
    $.agentPanel?.classList.add('hidden-panel');
    $.sidebarMask?.classList.remove('active');
    lockBodyScroll(false);
};

window.toggleSidebar = () => {
    // ★ Agent 模式: 禁止展开侧边栏
    if (isAgentToolsActive()) {
        showToast('Agent 模式下侧边栏已折叠', 'info', 2000);
        return;
    }
    if (isMobile()) {
        if ($.sidebar?.classList.contains('mobile-open')) {
            $.sidebar.classList.remove('mobile-open');
            $.sidebarMask?.classList.remove('active');
            lockBodyScroll(false);
        } else {
            $.sidebar?.classList.add('mobile-open');
            $.configPanel?.classList.remove('mobile-open');
            $.sidebarMask?.classList.add('active');
            lockBodyScroll(true);
        }
    } else {
        $.sidebar?.classList.toggle('collapsed');
        if ($.sidebarToggle) $.sidebarToggle.style.display = $.sidebar?.classList.contains('collapsed') ? 'block' : 'none';
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
            $.configPanel.classList.remove('mobile-open');
            $.sidebarMask?.classList.remove('active');
            configPanelWasOpen = false;
            lockBodyScroll(false);
        } else {
            $.configPanel?.classList.remove('hidden-panel');
            $.configPanel?.classList.add('mobile-open');
            $.sidebar?.classList.remove('mobile-open');
            $.sidebarMask?.classList.add('active');
            configPanelWasOpen = true;
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
        document.querySelector(".flex-1.flex-col")?.classList.toggle("config-open", isOpening);
        // 打开时保存配置快照,关闭时清除
        if (isOpening) {
            configSnapshot = snapshotConfig();
            configPanelWasOpen = true;
            // ★ 加载工具开关状态、自定义技能列表、记忆系统
            if (window.loadToolToggleStates) window.loadToolToggleStates();
            if (window.renderCustomSkillsList) window.renderCustomSkillsList();
            if (window.refreshMemoryList) window.refreshMemoryList();
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

// 切换图像提供商(MiniMax / OpenRouter)时更新字段:可见性、密钥、提示
async function toggleImageProviderFields() {
    var provider = getVal('imageProvider') || 'minimax';
    var keyInput = getEl('imageApiKey');       // MiniMax Key 输入框
    var urlInput = getEl('imageBaseUrl');       // MiniMax URL 输入框
    var orKeyInput = getEl('imageApiKeyOpenrouter');  // OpenRouter Key 输入框
    var orUrlInput = getEl('imageBaseUrlOpenrouter'); // OpenRouter URL 输入框
    var modelInput = getEl('imageModel');
    var hintEl = getEl('imageProviderHint');

    // 切换前保存当前值到对应提供商的 localStorage 键
    if (window._lastImageProvider && window._lastImageProvider !== provider) {
        var _prevFinal = window._lastImageProvider;
        if (_prevFinal === 'minimax') {
            localStorage.setItem('imageApiKey', await encrypt(getVal('imageApiKey') || ''));
            localStorage.setItem('imageBaseUrl', getVal('imageBaseUrl') || '');
        } else {
            localStorage.setItem('imageApiKeyOpenrouter', await encrypt(getVal('imageApiKeyOpenrouter') || ''));
            localStorage.setItem('imageBaseUrlOpenrouter', getVal('imageBaseUrlOpenrouter') || '');
        }
    }
    window._lastImageProvider = provider;

    // 切换字段可见性
    var _miniFields = ['imageKeyField', 'imageUrlField'];
    var _orFields = ['orKeyField', 'orUrlField'];
    _miniFields.forEach(function(id) {
        var el = getEl(id); if (el) el.style.display = provider === 'minimax' ? '' : 'none';
    });
    _orFields.forEach(function(id) {
        var el = getEl(id); if (el) el.style.display = provider === 'openrouter' ? '' : 'none';
    });

    if (provider === 'openrouter') {
        // 从 localStorage 恢复 OpenRouter 密钥
        var _storedOrKeyFinal = await decrypt(localStorage.getItem('imageApiKeyOpenrouter') || '') || '';
        var _storedOrUrlFinal = localStorage.getItem('imageBaseUrlOpenrouter') || 'https://openrouter.ai/api';
        if (orKeyInput) orKeyInput.value = _storedOrKeyFinal !== 'not-needed' ? _storedOrKeyFinal : '';
        if (orUrlInput) orUrlInput.value = _storedOrUrlFinal;
        if (modelInput) {
            modelInput.placeholder = 'openai/gpt-5.4-image-2';
            var curModel = modelInput.value;
            if (!curModel || curModel === 'image-01') modelInput.value = 'openai/gpt-5.4-image-2';
        }
        if (hintEl) hintEl.textContent = 'OpenRouter: 使用 GPT Image 2。使用独立的 API Key,不影响频道聊天用的主 API Key。';
    } else {
        // 从 localStorage 恢复 MiniMax 密钥
        var _storedMxKeyFinal = await decrypt(localStorage.getItem('imageApiKey') || '') || '';
        var _storedMxUrlFinal = localStorage.getItem('imageBaseUrl') || 'https://api.minimaxi.com';
        if (keyInput) keyInput.value = _storedMxKeyFinal !== 'not-needed' ? _storedMxKeyFinal : '';
        if (urlInput) urlInput.value = _storedMxUrlFinal;
        if (modelInput) {
            modelInput.placeholder = 'image-01';
            var curModel = modelInput.value;
            if (!curModel || curModel === 'openai/gpt-5.4-image-2') modelInput.value = 'image-01';
        }
        if (hintEl) hintEl.textContent = 'MiniMax: 使用 image-01 模型,写实风格。使用独立 API Key,不影响主 API Key。';
    }

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
    
    // 切换前保存当前值到对应提供商的 localStorage
    if (window._lastVisionProvider && window._lastVisionProvider !== provider) {
        if (window._lastVisionProvider === 'minimax') {
            localStorage.setItem('visionApiKey', await encrypt(getVal('visionApiKey') || ''));
            localStorage.setItem('visionApiUrl', getVal('visionApiUrl') || '');
        } else if (window._lastVisionProvider === 'openai') {
            localStorage.setItem('visionApiKeyOpenAI', await encrypt(getVal('visionApiKeyOpenAI') || ''));
            localStorage.setItem('visionApiUrlOpenAI', getVal('visionApiUrlOpenAI') || '');
        }
    }
    window._lastVisionProvider = provider;
    localStorage.setItem('visionProvider', provider);
    
    // 切换字段可见性
    var fields = { minimax: ['visionKeyField', 'visionUrlField'], openai: ['visionOAKeyField', 'visionOAUrlField'] };
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
        if (hintEl) hintEl.textContent = 'OpenAI: 使用 GPT-4o 等视觉模型。使用独立的 API Key。';
    } else if (provider === 'minimax') {
        var _storedKey2 = await decrypt(localStorage.getItem('visionApiKey') || '') || '';
        var _storedUrl = localStorage.getItem('visionApiUrl') || 'https://api.minimaxi.com/v1/coding_plan/vlm';
        if (keyInput) keyInput.value = _storedKey2;
        if (urlInput) urlInput.value = _storedUrl;
        if (modelInput) modelInput.value = 'MiniMax-VL-01';
        if (hintEl) hintEl.textContent = 'MiniMax: 使用 coding-plan-vlm 端点的视觉理解能力。';
    } else {
        // 自定义
        if (hintEl) hintEl.textContent = '自定义: 设置自己的 API 地址和模型。';
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
        'searchApiKey', 'searchRegion', 'searchTimeout', 'maxSearchResults', 'aiSearchJudge',
        'aiSearchJudgeModel', 'aiSearchJudgePrompt', 'enableSearchOptimize', 'fontSize',
        'searchType', 'aiSearchTypeToggle', 'searchShowPrompt', 'searchAppendToSystem'];
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
        'searchApiKey', 'searchRegion', 'searchTimeout', 'maxSearchResults', 'aiSearchJudge',
        'aiSearchJudgeModel', 'aiSearchJudgePrompt', 'enableSearchOptimize', 'fontSize',
        'searchType', 'aiSearchTypeToggle', 'searchShowPrompt', 'searchAppendToSystem'];
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
        $.configPanel?.classList.add('hidden-panel');
        configSnapshot = null;
        configPanelWasOpen = false;
        return;
    }
    // 恢复配置
    restoreConfigSnapshot(configSnapshot);
    // 关闭面板
    $.configPanel?.classList.add('hidden-panel');
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

    // 只处理侧边栏,配置面板完全由用户手动控制,不自动关闭
    if (nowMobile) {
        $.sidebar?.classList.remove('mobile-open', 'collapsed');
        $.sidebarMask?.classList.remove('active');
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'block';
    } else {
        $.sidebar?.classList.remove('mobile-open', 'collapsed');
        $.sidebarMask?.classList.remove('active');
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
    }
}, 100);


