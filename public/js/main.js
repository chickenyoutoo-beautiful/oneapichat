// main.js v18.1 — 主应用逻辑 (Phase 0: core.js 已抽取)


// 一键修复配置
window.fixImageAnalysisConfig = function() {

    // 清除可能的问题配置
    localStorage.removeItem('visionApiUrl');
    localStorage.removeItem('visionApiKey');
    localStorage.removeItem('visionModel');

    // 设置简单的 MCP 配置
    localStorage.setItem('visionApiUrl', 'https://api.minimaxi.com/v1/coding_plan/vlm');
    localStorage.setItem('visionApiKey', '');
    localStorage.setItem('visionModel', 'MiniMax-M2');
    return {
        visionApiUrl: 'https://api.minimaxi.com/v1/coding_plan/vlm',
        visionModel: 'MiniMax-M2',
        message: '配置已重置,请刷新页面'
    };
};

// 测试 MCP 端点

// 一键配置
window.quickSetupOneAPIChat = function() {

    var config = {
        key: window.ONEAPI_KEY || '',
        url: 'https://oneapi.naujtrats.xyz/v1',
        model: 'deepseek-v4-flash',
        visionApiUrl: window.location.origin + '/mcp',
        visionApiKey: 'test-key',
        visionModel: 'MiniMax-VL-01'
    };

    Object.keys(config).forEach(key => {
        localStorage.setItem(key, config[key]);
    });

    return config;
};





// ★ 工具函数已迁至 utils.js — onProviderChange 等不再在此定义

// ==================== SRC (StarRailCopilot) 操控工具 ====================
const SRC_API_BASE = '/engine/src';

async function _srcApi(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    try {
        var r = await fetch(SRC_API_BASE + path, opts);
        return await r.json();
    } catch(e) {
        return { ok: false, error: e.message };
    }
}


// ★ 图片/视频上传 → js/upload.js (Phase 8)

// ==================== 全局变量 ====================
let keyboardActive = false;
let lastInnerHeight = window.innerHeight;
let lastInnerWidth = window.innerWidth;
let configPanelInteracting = false; // 标记是否正在与配置面板交互

// ★ fetchWithRetry → utils.js

function setupKeyboardDetection() {
    if (window.__keyboardDetectionBound) {
        window.__syncMobileViewport?.();
        return;
    }
    window.__keyboardDetectionBound = true;

    var viewport = window.visualViewport;
    var root = document.documentElement;
    var rafId = 0;
    var settleTimer = 0;
    var finalTimer = 0;
    var trackedWidth = viewport ? viewport.width : window.innerWidth;
    var maxViewportBottom = viewport
        ? viewport.height + Math.max(0, viewport.offsetTop || 0)
        : window.innerHeight;
    var lastScale = 1;   // ★ 上一次采样到的缩放值, 用于识别捏合手势进行中
    var lastApplied = { vvh: null, kb: null, vh: null };   // ★ 脏检查: 数值未变不写 DOM

    function getFocusedControl() {
        var active = document.activeElement;
        return active && active.matches && active.matches('input, textarea, select, [contenteditable="true"]')
            ? active
            : null;
    }

    function applyViewportMetrics(force) {
        rafId = 0;
        var focused = getFocusedControl();
        var width = viewport ? viewport.width : window.innerWidth;
        var viewportHeight = viewport ? viewport.height : window.innerHeight;
        var offsetTop = viewport ? Math.max(0, viewport.offsetTop || 0) : 0;
        var scale = viewport && viewport.scale ? viewport.scale : 1;

        // 捏合/双击缩放进行中(scale 逐帧变化)的实时帧跳过, 避免布局跟随缩放跳动;
        // 回稳定时器(120/420ms, 事件停止后才触发)以 force 兜底应用 —— viewport.height
        // 本身就是 CSS 像素, 已自动包含缩放效果, 不会像旧逻辑(scale≠1 直接 return)
        // 那样永久冻结 --vvh。
        if (!force && Math.abs(scale - lastScale) > 0.02) {
            lastScale = scale;
            return;
        }
        lastScale = scale;

        if (Math.abs(width - trackedWidth) > 2) {
            trackedWidth = width;
            maxViewportBottom = viewportHeight + offsetTop;
        }

        var viewportBottom = viewportHeight + offsetTop;
        if (!focused) maxViewportBottom = Math.max(maxViewportBottom, viewportBottom);
        var reducedBy = Math.max(0, maxViewportBottom - viewportBottom);
        var keyboardThreshold = Math.max(120, maxViewportBottom * 0.18);
        var keyboardOpen = !!focused && reducedBy > keyboardThreshold;

        // 键盘弹起时只使用真实可视高度；无键盘时包含顶部偏移，使应用底边
        // 始终跟随 Safari 地址栏收起后的最终可视底边。
        var appHeight = keyboardOpen ? viewportHeight : viewportBottom;
        appHeight = Math.max(320, Math.round(appHeight));
        var vhRound = Math.round(viewportHeight);
        var kbRound = keyboardOpen ? Math.round(reducedBy) : 0;
        // ★ 脏检查: 数值未变时跳过 DOM 写入, 看门狗轮询零成本
        if (appHeight === lastApplied.vvh && keyboardOpen === lastApplied.kb && vhRound === lastApplied.vh) return;
        lastApplied.vvh = appHeight; lastApplied.kb = keyboardOpen; lastApplied.vh = vhRound;
        root.style.setProperty('--vvh', appHeight + 'px');
        root.style.setProperty('--visual-viewport-height', vhRound + 'px');
        root.style.setProperty('--visual-viewport-offset-top', Math.round(offsetTop) + 'px');
        root.style.setProperty('--keyboard-height', kbRound + 'px');
        root.classList.toggle('keyboard-open', keyboardOpen);
        keyboardActive = !!focused;
        lastInnerHeight = viewportHeight;
        lastInnerWidth = width;
    }

    function scheduleViewportSync(settle) {
        if (!rafId) rafId = requestAnimationFrame(applyViewportMetrics);
        if (!settle) return;
        clearTimeout(settleTimer);
        clearTimeout(finalTimer);
        // ★ force=true: 回稳定时器在事件停止后才触发, 是缩放/键盘动画的最终收敛路径, 必须应用
        settleTimer = setTimeout(function() { applyViewportMetrics(true); }, 120);
        finalTimer = setTimeout(function() { applyViewportMetrics(true); }, 420);
    }

    window.__syncMobileViewport = function() { scheduleViewportSync(true); };
    if (viewport) {
        viewport.addEventListener('resize', function() { scheduleViewportSync(true); }, { passive: true });
        viewport.addEventListener('scroll', function() { scheduleViewportSync(true); }, { passive: true });
        if ('onscrollend' in viewport) {
            viewport.addEventListener('scrollend', function() { scheduleViewportSync(true); }, { passive: true });
        }
    }
    window.addEventListener('resize', function() { scheduleViewportSync(true); }, { passive: true });
    window.addEventListener('orientationchange', function() {
        maxViewportBottom = 0;
        scheduleViewportSync(true);
    }, { passive: true });
    window.addEventListener('pageshow', function() { scheduleViewportSync(true); });
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) scheduleViewportSync(true);
    });
    scheduleViewportSync(true);

    // ★ 兜底看门狗: iOS Safari 在输入框保持焦点时收起键盘(点键盘「完成」/下滑收键盘/点发送
    // 后点别处)可能不派发 visualViewport resize/scroll 事件 —— 尤其根元素 overflow:hidden 时。
    // 此时 --vvh 停留在键盘弹起时的小高度 → 输入框下方空出一大截且永不恢复。
    // 低频轮询(配合脏检查零开销)保证任何事件丢失都能在 1s 内自愈。
    var isTouchish = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia('(max-width: 786px)').matches;
    if (isTouchish) {
        setInterval(function() {
            if (document.hidden) return;
            scheduleViewportSync(false);
        }, 1000);
        // ★ 任意点按后立即重算: 键盘收起后用户的第一次点击即可恢复正确高度
        document.addEventListener('pointerup', function() { scheduleViewportSync(false); }, { passive: true });
        if (!window.PointerEvent) {
            document.addEventListener('touchend', function() { scheduleViewportSync(false); }, { passive: true });
        }
    }

    // 监听输入框聚焦/失焦事件(通用)- 特别针对配置面板
    document.addEventListener('focusin', (e) => {
        if (e.target.matches('input, textarea, select')) {
            keyboardActive = true;
            scheduleViewportSync(true);
            // 检查是否是配置面板内的元素
            if ($.configPanel?.contains(e.target)) {
                configPanelInteracting = true;
                configPanelWasOpen = true; // 标记配置面板处于使用中
            }
        }
    });
    document.addEventListener('focusout', (e) => {
        setTimeout(() => {
            // 检查是否还有其他输入框聚焦
            var focused = document.querySelector('input:focus, textarea:focus, select:focus');
            if (!focused) {
                keyboardActive = false;
            }
            // 检查配置面板内是否还有聚焦
            if (!focused || !$.configPanel?.contains(focused)) {
                configPanelInteracting = false;
            }
            scheduleViewportSync(true);
        }, 150);
    });
}
// currentChatId now in core.js

// chats now in core.js
window.pendingFiles = [];
let isTypingMap = {};
let abortControllerMap = {};
let searchAbortControllerMap = {};
let userAbortMap = {};
window.activeBubbleMap = {};
window.userScrolled = false;
// ★ 滚动状态统一由 scroll-follow.js 管理 (isAutoScrolling/streamingScrollLock 已废弃移除)

  // 流式期间锁定滚动跟随
let modelContextLength = JSON.parse(localStorage.getItem('modelContextLength') || '{}');
let modelMaxOutputTokens = JSON.parse(localStorage.getItem('modelMaxOutputTokens') || '{}');
let prevWidth = window.innerWidth;
let configSnapshot = null;  // 配置面板打开时的配置快照,用于取消功能

var $ = window.$ || {
    chatBox: null,
    chatMessagesContainer: null,
    userInput: null,
    sendBtn: null,
    stopBtn: null,
    filePreviewContainer: null,
    fileInput: null,
    scrollToBottomBtn: null,
    chatTitle: null,
    sidebar: null,
    configPanel: null,
    sidebarMask: null,
    sidebarToggle: null,
    searchQuickToggle: null
};

// ==================== 安全工具函数 ====================
const Safe = {
    get(obj, path, defaultValue = undefined) {
        if (obj == null) return defaultValue;
        var keys = Array.isArray(path) ? path : path.split('.');
        let result = obj;
        for (const key of keys) {
            if (result == null) return defaultValue;
            result = result[key];
        }
        return result ?? defaultValue;
    },
    call(fn, ...args) {
        try { return fn(...args); } catch (e) { console.warn('[Safe.call]', e.message); return undefined; }
    },
    parseJSON(str, fallback = null) {
        try { return JSON.parse(str); } catch (e) { console.warn('[Safe.parseJSON]', e.message); return fallback; }
    },
    arrayGet(arr, index, defaultValue = undefined) {
        return Array.isArray(arr) ? (arr[index] ?? defaultValue) : defaultValue;
    },
    string(val, fallback = '') { return val == null ? fallback : String(val); },
    number(val, fallback = 0) { const n = Number(val); return isNaN(n) ? fallback : n; }
};

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

// ★ 工具参数容错提取: server_exec/server_python 的模型参数非法JSON(未转义引号/截断)时尽量恢复
function tolerantToolInput(toolName, raw) {
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch (e) {}
    try { return JSON.parse(repairToolArguments(raw)); } catch (e2) {}
    var keys = [];
    if (toolName === 'server_exec') keys = ['cmd', 'command', 'query'];
    else if (toolName === 'server_python') keys = ['script', 'code', 'cmd'];
    var targetKey = toolName === 'server_exec' ? 'cmd' : 'script';
    var i, j;
    // 1) 标准 JSON 转义的值
    for (i = 0; i < keys.length; i++) {
        var key = keys[i];
        var re = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');
        var m = raw.match(re);
        if (m) {
            var obj = {};
            obj[targetKey] = m[1].replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            return obj;
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
        for (var k = val.length - 1; k >= 0; k--) {
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
        var obj2 = {};
        obj2[targetKey] = val.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        return obj2;
    }
    return null;
}

// ==================== 统一错误处理 ====================
class AppError extends Error {
    constructor(message, code = 'UNKNOWN', details = null) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.details = details;
    }
}

const ErrorHandler = {
    categorize(error) {
        if (error instanceof AppError) return error;
        var msg = Safe.string(error?.message).toLowerCase();
        if (msg.includes('network') || msg.includes('fetch')) return new AppError('网络错误', 'NETWORK', error);
        if (msg.includes('timeout') || msg.includes('aborted')) return new AppError('请求超时', 'TIMEOUT', error);
        if (msg.includes(' unauthorized') || msg.includes('401') || msg.includes('403')) return new AppError('API Key无效', 'AUTH', error);
        if (msg.includes('429')) return new AppError('请求过于频繁', 'RATE_LIMIT', error);
        if (msg.includes('500') || msg.includes('502')) return new AppError('服务器错误', 'SERVER', error);
        return new AppError(Safe.string(error?.message, '未知错误'), 'UNKNOWN', error);
    },
    show(error, bubble = null) {
        var appError = this.categorize(error);
        console.error('[Error]', appError.code, appError.message);
        showToast(appError.message, 'error', 4000);
        if (bubble) {
            bubble.classList.remove('typing', 'gen-active', 'streaming');
            var div = document.createElement('div');
            div.className = 'error-message';
            div.innerHTML = `<span class="error-icon">❌</span> ${escapeHtml(appError.message)}`;
            bubble.querySelector('.message-content')?.appendChild(div);
        }
        return appError;
    }
};

// ==================== 消息发送核心 ====================
const rateLimit = {
    last: 0,
    min: 1000,
    allowed() {
        var now = Date.now();
        if (now - this.last < this.min) return false;
        this.last = now;
        return true;
    }
};

// 仅中止现有请求,不设置用户停止标记(用于开始新请求时停止旧请求)
function abortExistingRequest(chatId) {
    if (abortControllerMap[chatId]) {
        abortControllerMap[chatId].abort();
        delete abortControllerMap[chatId];
    }
    if (searchAbortControllerMap[chatId]) {
        searchAbortControllerMap[chatId].abort();
        delete searchAbortControllerMap[chatId];
    }
    cleanupStreamState(chatId);  // ★ 清理RAF渲染循环
    // ★ 中止时当前气泡的光标类一并清除 (cleanupStreamState 可能因 st.bubble 被新流覆盖而漏删)
    var _abortBubble = activeBubbleMap[chatId];
    if (_abortBubble) _abortBubble.classList.remove('typing', 'gen-active', 'streaming');
    delete isTypingMap[chatId];
    if (window._activeStreamChatId === chatId) window._activeStreamChatId = null;  // ★ 中止时清除活动流标记
    if (typeof renderChatHistory === 'function') renderChatHistory();
    delete activeBubbleMap[chatId];
    // ★ 主代理空闲了,处理子代理通知队列
    if (window._agentNotifyQueue && window._agentNotifyQueue.length > 0 && typeof window._processAgentNotifyQueue === 'function') {
        setTimeout(function() { window._processAgentNotifyQueue(); }, 500);
    }
}

// 用户主动停止,设置用户停止标记
function stopGenerationForChat(chatId) {
    userAbortMap[chatId] = true; // 标记用户主动停止,不再重试
    cleanupStreamState(chatId);  // ★ 清理RAF渲染循环
    abortExistingRequest(chatId);
    // ★ 停止可恢复流(RS): 通知引擎后台生成线程立即停止, 否则要等模型思考完才停
    try {
        if (window.ResumeStream && typeof window.ResumeStream.cancelActive === 'function') {
            window.ResumeStream.cancelActive(chatId);
        }
    } catch(e) {}
    // ★ 中断所有正在运行的工具调用
    if (window.__toolAbortControllers) {
        Object.keys(window.__toolAbortControllers).forEach(function(k) {
            if (k.startsWith(chatId)) {
                try { window.__toolAbortControllers[k].abort(); } catch(e) {}
                delete window.__toolAbortControllers[k];
            }
        });
    }
    // ★ 清除可恢复流状态 — 防止刷新后误触发续接
    // 先停掉 _streamSaveTimer，否则会在清除后立刻重新写入 _savedPartial
    if (chats[chatId] && chats[chatId].messages) {
        var _msgs = chats[chatId].messages;
        for (var _mi = _msgs.length - 1; _mi >= 0; _mi--) {
            var _pm = _msgs[_mi];
            if (_pm._streamSaveTimer) { clearInterval(_pm._streamSaveTimer); _pm._streamSaveTimer = null; }
            if (_pm.partial) { delete _pm.partial; _pm._aborted = true; }
        }
    }
    try { localStorage.removeItem('_savedPartial'); } catch(e) {}
    try { localStorage.removeItem('_lastStreamMsgId_' + chatId); } catch(e) {}
    try { localStorage.removeItem('_rs_sid'); } catch(e) {}
    try { localStorage.removeItem('_rs_cid'); } catch(e) {}
    try { localStorage.removeItem('_rs_ts'); } catch(e) {}
    try { localStorage.removeItem('_rs_msgid'); } catch(e) {}
    try {
        if (window.ResumeStream && typeof window.ResumeStream.complete === 'function') {
            window.ResumeStream.complete(chatId);
        }
    } catch(e) {}
    // ★ 标记流已被用户主动停止，loadChat 检测到后跳过续接
    try { localStorage.setItem('_streamStopped_' + chatId, '1'); } catch(e) {}
    window._pendingRecovery = null;
    // ★ 用户停止后也要处理队列
    if (window._agentNotifyQueue && window._agentNotifyQueue.length > 0 && typeof window._processAgentNotifyQueue === 'function') {
        setTimeout(function() { window._processAgentNotifyQueue(); }, 500);
    }
}

// ★ 链式输出模式: 工具调用后保留旧消息,新内容追加为新气泡
window._chainMode = localStorage.getItem('chainMode') === '1';  // 默认关闭
window.toggleChainMode = function() {
    window._chainMode = !window._chainMode;
    localStorage.setItem('chainMode', window._chainMode ? '1' : '0');
    // 同步旧按钮（若存在）
    var btn = document.getElementById('chainModeBtn');
    if (btn) btn.classList.toggle('active', window._chainMode);
    // 同步配置面板开关
    var _toggle = document.getElementById('chainModeToggle');
    if (_toggle) _toggle.checked = window._chainMode;
};
// 初始化链式状态
setTimeout(function() {
    var _cb = document.getElementById('chainModeBtn');
    if (_cb && window._chainMode) _cb.classList.add('active');
    var _toggle = document.getElementById('chainModeToggle');
    if (_toggle) _toggle.checked = window._chainMode;
}, 500);

// ★ 链式输出思考步骤可视化（参考 desktop deepseek-chat）
window._showChainSteps = function(chatId, steps) {
    // steps: [{text: '分析请求...', status: 'done'|'active'|'pending'}]
    var bubble = activeBubbleMap[chatId];
    if (!bubble) return;
    var container = bubble.querySelector('.thinking-steps');
    if (!container) {
        container = document.createElement('div');
        container.className = 'thinking-steps';
        var md = bubble.querySelector('.markdown-body');
        if (md) md.insertBefore(container, md.firstChild);
        else bubble.appendChild(container);
    }
    container.innerHTML = '';
    steps.forEach(function(s) {
        var step = document.createElement('div');
        step.className = 'thinking-step ' + (s.status || 'pending');
        var icon = s.status === 'done' ? '✅' : (s.status === 'active' ? '\u{1F504}' : '⏳');
        step.innerHTML = '<span class="step-icon">' + icon + '</span>' + escapeHtml(s.text);
        container.appendChild(step);
    });
    if (!userScrolled) { requestAnimationFrame(function() { followToBottom($.chatBox); }); }
};
window._addChainStep = function(chatId, text) {
    var bubble = activeBubbleMap[chatId];
    if (!bubble) return;
    var container = bubble.querySelector('.thinking-steps');
    if (!container) {
        container = document.createElement('div');
        container.className = 'thinking-steps';
        var md = bubble.querySelector('.markdown-body');
        if (md) md.insertBefore(container, md.firstChild);
        else bubble.appendChild(container);
    }
    // 上一个 active → done
    var steps = container.querySelectorAll('.thinking-step');
    steps.forEach(function(s) { s.classList.remove('active'); s.classList.add('done'); s.querySelector('.step-icon').textContent = '✅'; });
    // 新增 active 步骤
    var newStep = document.createElement('div');
    newStep.className = 'thinking-step active';
    newStep.innerHTML = '<span class="step-icon">\u{1F504}</span>' + escapeHtml(text);
    container.appendChild(newStep);
    if (!userScrolled) { requestAnimationFrame(function() { followToBottom($.chatBox); }); }
};
window._clearChainSteps = function(chatId) {
    var bubble = activeBubbleMap[chatId];
    if (!bubble) return;
    var container = bubble.querySelector('.thinking-steps');
    if (container) container.remove();
};

window.stopGeneration = function () {
    if (currentChatId) {
        stopGenerationForChat(currentChatId);
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
    }
};

function buildHistorySummary(chatId, maxLength = MAX_HISTORY_LENGTH) {
    var messages = chats[chatId]?.messages || [];
    var recent = messages.slice(-10);
    var summary = recent.map(m => {
        if (m.role === 'user') return `用户: ${(m.text || '').slice(0, 300)}`;
        if (m.role === 'assistant') return `助手: ${(m.content || '').slice(0, 300)}`;
        return '';
    }).filter(Boolean).join('\n');
    return summary.slice(0, maxLength) || '无历史记录';
}

// ★ 三级时间戳注入——平衡缓存命中率与时间精度
// Tier 1: 明确问几点 → 分钟精度(无秒), 缓存~1分钟(这类请求极少)
// Tier 2: 时间敏感但不要求精确时刻 → 日期精度, 缓存~24小时
// 已移除 "时间""动态""最新""date""周" 等高频泛词, 避免无意义缓存击穿
function createTemporaryTimestampIfNeeded(text) {
    var lowerText = text.toLowerCase();
    var pad = function(n) { return n < 10 ? '0' + n : n; };
    var daysZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    function _makeTimeStr(withMinutes) {
        var now = new Date();
        var off = -Math.round(now.getTimezoneOffset() / 60);
        var tz = 'GMT' + (off >= 0 ? '+' : '') + off;
        var base = now.getFullYear() + '年' + (now.getMonth()+1) + '月' + now.getDate() + '日 ' + daysZh[now.getDay()];
        if (withMinutes) {
            base += ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ' ' + tz;
        }
        return base;
    }

    // Tier 1: 明确问"现在几点" → 分钟+秒精度
    var exactTimeKeywords = ['现在几点', '几点钟', 'what time', 'clock', '当前确切时间', 'exact time'];
    if (exactTimeKeywords.some(kw => lowerText.includes(kw))) {
        var now = new Date();
        var off = -Math.round(now.getTimezoneOffset() / 60);
        var tz = 'GMT' + (off >= 0 ? '+' : '') + off;
        var ts = now.getFullYear() + '年' + (now.getMonth()+1) + '月' + now.getDate() + '日 ' + daysZh[now.getDay()] + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()) + ' ' + tz;
        return { role: 'system', content: '[' + ts + '] 系统当前精确时间,回答时间相关问题时请以此为准。', temporary: true };
    }

    // Tier 2: 事件时间感知 → 分钟精度
    // 赛事/比赛/直播/活动 — 用户想知道"是否已发生/正在进行/结果"
    var eventKeywords = ['比赛', '赛事', 'match', 'game', '比分', 'score', '直播', 'live', 'stream',
        '开始了吗', '结束了吗', '发生了吗', '已经', '结果', 'result', '正在进行', '进行中', 'ongoing',
        'schedule', '赛程', ' lineup', '首发', '开赛', '开球', 'kickoff', 'tipoff',
        '决赛', '半决赛', 'final', 'semifinal', '季后赛', 'playoff', '常规赛',
        'nba', 'nfl', 'mlb', 'nhl', '英超', '西甲', '欧冠', '中超', 'cba', 'csl',
        'f1', 'tennis', '网球', 'ufc', 'boxing', '拳击', 'esports', '电竞', 'lol', 'dota'];
    if (eventKeywords.some(kw => lowerText.includes(kw))) {
        var ts = _makeTimeStr(true);
        return { role: 'system', content: '[' + ts + '] 系统当前时间,回答事件/赛事相关问题时请以此为准判断是否已发生。', temporary: true };
    }

    // Tier 3: 时间段感知 → 分钟精度
    // 用户提到具体时段 — 需要知道现在是上午/下午/晚上来判断事件过去了没
    var periodKeywords = ['上午', '下午', '中午', '晚上', '今晚', '今早', '今天上午', '今天下午', '今天晚上',
        '凌晨', '傍晚', '夜里', '夜间', '早晨', '早上',
        'morning', 'afternoon', 'evening', 'tonight', 'noon', 'midnight',
        '现在时间', '当前时间', 'time', 'now', '天气', 'weather'];
    if (periodKeywords.some(kw => lowerText.includes(kw))) {
        var ts = _makeTimeStr(true);
        return { role: 'system', content: '[' + ts + '] 系统当前时间,回答时段相关问题时请以此为准。', temporary: true };
    }

    // Tier 4: 仅需日期感知 → 日期精度, 24h缓存友好(主力命中层)
    var dateKeywords = ['今天', '明天', '昨天', '星期几', '几号', '几月', '哪年', '今年', '去年', '明年', '新闻', 'news', '实时'];
    if (dateKeywords.some(kw => lowerText.includes(kw))) {
        var ts = _makeTimeStr(false);
        return { role: 'system', content: '[' + ts + '] 系统当前日期,回答日期相关问题时请以此为准。', temporary: true };
    }

    return null;
}



// ★ 消息队列 → js/queue.js (Phase 8 拆分)

window.sendMessage = async function (skipUserAdd, userTextForRegen, userFilesForRegen) {
    // ★ 子代理会话只读，禁止发送消息
    if (currentChatId && chats[currentChatId] && chats[currentChatId]._agentSub) {
        showToast('🤖 子代理会话为只读，请在主聊天中操作', 'info', 3000);
        return;
    }

    if (!skipUserAdd && !window._isQueueMessage) {
        // ★ ask_agent 临时授权持续整个会话(不再每轮回收,子代理需要跨轮工作)
        // 仅在新用户消息时保持,但等待子代理完成前不回收
        // 用户发起的消息 → 新任务批次开始
        // ★ 创建任务,后续代理将关联到这个任务ID
        var _inputEl = $.userInput;
        var _msgText = userTextForRegen || (_inputEl ? _inputEl.value.trim() : '') || '';
        window._lastMsgTaskId = window.createTask(_msgText, currentChatId);
        console.log('[Agent] 新任务批次开始,taskId=' + window._lastMsgTaskId);

        // ★ 新用户消息: 清除旧计划面板（新任务需要新计划）
        if (window._agentPlan) {
            window.dismissFlowPanel();
            window._agentPlan = null;
            console.log('[FlowPanel] 新消息，清除旧计划');
        }
    }

    // ★ v2: 非阻塞预加载记忆上下文(如果还没加载)
    if (window.refreshMemoryContext && !window.__memoryContext.lastUpdated) {
        window.refreshMemoryContext().catch(function(){});
    }

    // 队列消息绕过 rateLimit(_drainQueue 本身已有 2s 延迟)
    if (!window._isQueueMessage && !rateLimit.allowed()) {
        showToast('请求过于频繁', 'warning');
        return;
    }

    // 检查模型是否还在加载
    var modelVal = getVal('modelSelect');
    if (!modelVal || modelVal === '加载中...') {
        // ★ 等待模型列表加载完成,最多等6秒
        var _waitModelStart = Date.now();
        var _modelLoaded = false;
        await new Promise(function(resolve) {
            var _check = function() {
                var _mv = getVal('modelSelect');
                if (_mv && _mv !== '加载中...') {
                    _modelLoaded = true;
                    resolve();
                    return;
                }
                if (Date.now() - _waitModelStart > 6000) {
                    resolve();
                    return;
                }
                setTimeout(_check, 200);
            };
            _check();
        });
        if (!_modelLoaded) {
            showToast('模型列表加载超时,请检查网络或API Key后重试', 'error', 5000);
            return;
        }
        modelVal = getVal('modelSelect');
    }

    var chatId = currentChatId;
    if (!chatId) return;

    // ★ 停止按钮修复: 每个请求拥有唯一递增ID, finally块通过对比ID判断是否有新请求接管
    // 旧请求的finally若检测到新请求已启动, 则跳过所有状态清理(防止新请求被误停)
    if (!window._msgReqGen) window._msgReqGen = {};
    window._msgReqGen[chatId] = (window._msgReqGen[chatId] || 0) + 1;
    var _myReqGen = window._msgReqGen[chatId];

    // ★ 新请求开始时立即清除旧的中止标记, 防止userAbortMap残留污染新请求
    delete userAbortMap[chatId];

    if (isTypingMap[chatId]) {
        // ★ AI 正在生成: 推入对话 (消息立即进入历史, 流结束后自动继续)
        if (!skipUserAdd) {
            var _inputEl = $.userInput;
            var _qText = userTextForRegen || (_inputEl ? _inputEl.value.trim() : '');
            if (_qText || (pendingFiles && pendingFiles.length > 0)) {
                var safeFiles = (pendingFiles || []).map(function(f) {
                    return { name: f.name, isImage: !!f.isImage, type: f.type, size: f.size };
                });
                var _now = new Date();
                var _daysZh = ['周日','周一','周二','周三','周四','周五','周六'];
                var _dateStr = _now.getFullYear() + '年' + (_now.getMonth()+1) + '月' + _now.getDate() + '日 ' + _daysZh[_now.getDay()];
                var _datePrefix = '[日期: ' + _dateStr + '] ';
                var userMsg = {
                    role: 'user',
                    text: _qText,
                    _datePrefix: _datePrefix,
                    _injected: true,
                    files: safeFiles.map(function(f) {
                        return { name: f.name, content: f.content, serverUrl: f.serverUrl || '', serverPath: f.serverPath || '', size: f.size, type: f.type || (f.isImage ? 'image/' : '') };
                    })
                };
                chats[chatId].messages.push(userMsg);
                pendingFiles = [];
                if (_inputEl) { _inputEl.value = ''; window.autoResize(_inputEl); }
                // ★ 立即渲染用户气泡 (不重新渲染整个聊天, 避免干扰流式输出)
                if (currentChatId === chatId) {
                    appendMessage('user', _qText, userMsg.files, null, null, null, false, null, null, false, -1, true);
                    setTimeout(function() { autoScrollToBottom('inject'); }, 30);
                }
                slimSaveChats();
                if (typeof window._broadcastChatUpdate === 'function') {
                    window._broadcastChatUpdate(chatId);
                }
                window._hasInjectedMessage = true;
                showToast('📨 已推入对话，模型将在当前回复后继续处理', 'info', 2500);
            }
            return;
        }
        // 系统内队列调用:忙时不做任何事,等 finally
        // 由 finally 中的 sendMessage(true) 处理推入消息的自动续接
        return;
    }

    var input = $.userInput;
    let text = skipUserAdd ? userTextForRegen : input?.value.trim() || '';
    var files = skipUserAdd ? userFilesForRegen : pendingFiles;

    // ★ 新消息: 重置滚动状态 + 滚动到底部
    if (!skipUserAdd) {
        userScrolled = false;
        setTimeout(function() { if ($.chatBox) followToBottom($.chatBox); }, 30);
        // ★ 用户主动发送新消息时,清除推入消息标记,防止旧 finally 块误触发 sendMessage(true) 导致重复发送
        window._hasInjectedMessage = false;
    }

    // ★ 内部触发时 (skipUserAdd=true): text 可能为 null/undefined, 统一降级
    if (!text && skipUserAdd) { text = ''; }
    if (!skipUserAdd && !text && !files.length) {
        stopGenerationForChat(chatId);
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
        return;
    }

    // 按需生成临时时间戳消息(基于关键词)
    var temporaryTimestamp = createTemporaryTimestampIfNeeded(text);

    // ★ 防御: 确保 messages 数组存在
    if (!chats[chatId].messages) chats[chatId].messages = [];

    // 移除旧的临时消息
    chats[chatId].messages = chats[chatId].messages.filter(m => !m.temporary);
    // ★ 发送消息时重置滚动状态,并锁定流式跟随
    userScrolled = false;
    window._streamContentRendered = false;
    window._streamCompletedOk = false;  // ★ 流是否正常完成(决定 finally 是否免 loadChat 重建)
    var partialIdx = chats[chatId].messages.findIndex(m => m.partial);
    if (partialIdx !== -1) chats[chatId].messages.splice(partialIdx, 1);

    // 停止旧请求(不设置用户停止标记,以便新请求可以正常重试)
    abortExistingRequest(chatId);
    // ★ 新消息发起时必须清除停止标记,否则上一次停止的 userAbortMap 残留会导致新请求的工具调用被误判为"用户中断"而跳过
    delete userAbortMap[chatId];

    var abortMain = new AbortController();
    abortControllerMap[chatId] = abortMain;
    var abortSearch = new AbortController();
    searchAbortControllerMap[chatId] = abortSearch;

    isTypingMap[chatId] = true;
    window._activeStreamChatId = chatId;  // ★ 标记活动流, 防止 fetchModels 中断正在输出的模型
    if (typeof renderChatHistory === 'function') renderChatHistory();  // 后台指示器
    // ★ 多端同步: 广播流开始到其他设备(非RS路径,引擎侧也会广播)
    if (typeof window._broadcastEvent === 'function') {
        window._broadcastEvent('chat:stream_started', { chat_id: chatId, ts: Date.now() });
    }
    if ($.sendBtn) $.sendBtn.classList.add('hidden');
    if ($.stopBtn) $.stopBtn.classList.add('visible');
    // ★ AI开始生成:更新队列栏状态
    window._updateQueueUI();

    // 处理命令
    var command = parseCommand(text);
    if (command && command.type === 'command') {
        isTypingMap[chatId] = false;
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
        handleSlashCommand(command);
        input.value = '';
        return;
    }
    var forceSearch = !!command;
    var queryText = command ? command.query : text;
    var forcedType = command ? command.kind : null;

    // 构建历史摘要
    var historySummary = buildHistorySummary(chatId);

    // 添加用户消息
    // 保存当前消息是否包含图片(在 clearAllFiles 之前)
    var currentMessageHasImages = files && files.length > 0 && files.some(f => f.isImage || f.type?.startsWith('image/'));
    // ★ 保存标记供 buildApiMessages 使用(pendingFiles 即将被清空)
    window.__currentMessageHasImages = currentMessageHasImages;

    // 立即清空输入框,让用户知道消息已发送（队列消息不清空）
    if (input && !window._isQueueMessage) {
        input.value = '';
        window.autoResize(input);
    }

    // 如果有图片,不自动分析,让AI自主决定是否调用分析工具
    // 图片会作为附件发送给AI,AI可以自主选择是否使用 analyze_image 工具

    if (!skipUserAdd) {
        // ★ 日期前缀(仅日期+周几, 24h稳定 → Provider缓存友好; 时分秒由 createTemporaryTimestampIfNeeded 按需注入)
        var _now = new Date();
        var _daysZh = ['周日','周一','周二','周三','周四','周五','周六'];
        var _dateStr = _now.getFullYear() + '年' + (_now.getMonth()+1) + '月' + _now.getDate() + '日 ' + _daysZh[_now.getDay()];
        var _datePrefix = '[日期: ' + _dateStr + '] ';
        chats[chatId].messages.push({ role: 'user', text: text, _datePrefix: _datePrefix, files: files.map(f => ({ name: f.name, content: f.content, serverUrl: f.serverUrl || '', serverPath: f.serverPath || '', size: f.size, type: f.type || (f.isImage ? 'image/' : '') })) });
        // ★ 用户消息发出后立即保存,确保未开新会话时数据不丢
        slimSaveChats();
        // ★ 多端同步: 广播用户消息已添加到其他设备
        if (typeof window._broadcastChatUpdate === 'function') {
            window._broadcastChatUpdate(chatId);
        }
        if (chats[chatId].title === '新对话') {
            chats[chatId].title = text ? text.slice(0, 10) : (files.length ? '文件消息' : '新对话');
        }
        if (currentChatId === chatId) loadChat(chatId);
        // 输入框已在前面清空
        clearAllFiles();
    } else if (window._isQueueMessage) {
        // ★ 队列消息:插入聊天记录并立即渲染到界面
        var _qFiles = (files && files.length > 0) ? files.map(function(f) {
            return { name: f.name, content: f.content || null, serverUrl: f.serverUrl || '', serverPath: f.serverPath || '', size: f.size || 0, type: f.type || (f.isImage ? 'image/' : '') };
        }) : [];
        chats[chatId].messages.push({ role: 'user', text: text, files: _qFiles });
        slimSaveChats();
        // ★ 多端同步: 广播队列消息已添加到其他设备
        if (typeof window._broadcastChatUpdate === 'function') {
            window._broadcastChatUpdate(chatId);
        }
        if (chats[chatId].title === '新对话') {
            chats[chatId].title = text ? text.slice(0, 10) : (_qFiles.length ? '文件消息' : '新对话');
        }
        // ★ 立即追加用户气泡到界面
        if (currentChatId === chatId) {
            appendMessage('user', text, _qFiles, null, null, null, false);
            setTimeout(function() { autoScrollToBottom('queue'); }, 30);
        }
    }

    // 创建占位气泡（typing 动画等第一批内容到达时自动移除）
    var pendingMsg = { role: 'assistant', content: '', reasoning: '', partial: true };
    chats[chatId].messages.push(pendingMsg);
    let currentBubble = null;
    if (currentChatId === chatId) {
        // ★ 新消息开始: 先清除所有残留的呼吸/生成光晕 (旧流被中止/ID 守卫提前 return 时可能漏清, 导致旧气泡一直发光)
        document.querySelectorAll('.bubble.assistant.typing, .bubble.assistant.gen-active, .bubble.streaming').forEach(function(_b) {
            _b.classList.remove('typing', 'gen-active', 'streaming');
        });
        // ★ 同时移除上一轮的搜索标题滚动条
        document.querySelectorAll('.search-ticker').forEach(function(_t) { _t.remove(); });
        currentBubble = appendMessage('assistant', '', null, null, null, 0, false);
        if (currentBubble) currentBubble.classList.add('typing');
        activeBubbleMap[chatId] = currentBubble;
        setTimeout(function() { autoScrollToBottom('sendMessage'); }, 50);
    }

    // 执行搜索
    var _modelMiniMax2 = (getVal('modelSelect') || '').toLowerCase().includes('minimax');
    // ★ 修复: MiniMax 也启用工具调用模式,让模型通过 tool_calls 决定何时搜索
    var useToolCall = getChecked('searchToolCallToggle') || (files.length > 0 && files.some(f => f.isImage || f.type?.startsWith('image/')));
    let searchResult = { searchPerformed: false, searchResults: null, optimized: null, searchError: null };
    // 工具调用模式下不主动搜索,让模型通过tool_calls决定何时搜索
    if (!useToolCall && (getChecked('searchToggle') || forceSearch)) {
        searchResult = await handleSearchFlow(chatId, text, forceSearch, queryText, historySummary, abortSearch.signal, currentBubble, forcedType);
    }

    // 保存搜索结果
    if (searchResult.searchPerformed && searchResult.optimized) {
        if (getChecked('searchAppendToSystem')) {
            chats[chatId].messages.push({ role: 'system', content: searchResult.optimized });
        } else {
            chats[chatId].messages.push({ role: 'system', content: searchResult.optimized, temporary: true });
        }
    }

    // ★ 非工具调用模式下:自动分析上传的图片并告诉模型
    // 手动关闭搜索工具调用 或 模型不支持工具时，AI无法调用 analyze_image
    if (currentMessageHasImages && !useToolCall) {
        var _allImageAnalyses = [];
        var _imageFiles = files ? files.filter(function(f) { return f.isImage || (f.type && f.type.startsWith('image/')); }) : [];
        // 也检查聊天记录中的图片
        if (!_imageFiles.length && chats[chatId]) {
            var _lastMsgs = chats[chatId].messages;
            for (var _imi = _lastMsgs.length - 1; _imi >= 0; _imi--) {
                var _m = _lastMsgs[_imi];
                if (_m.role === 'user' && _m.files && _m.files.length) {
                    _imageFiles = _m.files.filter(function(f) { return f.isImage || (f.type && f.type.startsWith('image/')); });
                    if (_imageFiles.length) break;
                }
            }
        }
        if (_imageFiles.length) {
            showToast('🔍 正在自动分析' + _imageFiles.length + '张图片...', 'info', 5000);
            if (currentBubble) {
                var _imgStatus = document.createElement('div');
                _imgStatus.className = 'search-status';
                _imgStatus.textContent = '🔍 自动分析' + _imageFiles.length + '张图片...';
                var _mb = currentBubble.querySelector('.markdown-body');
                if (_mb) _mb.appendChild(_imgStatus);
            }
            for (var _iai = 0; _iai < _imageFiles.length; _iai++) {
                var _imgFile = _imageFiles[_iai];
                var _imgInput = '';
                if (_imgFile.serverUrl && typeof _imgFile.serverUrl === 'string' && _imgFile.serverUrl.length > 0) {
                    _imgInput = _imgFile.serverUrl.startsWith('http') ? _imgFile.serverUrl : window.location.origin + _imgFile.serverUrl;
                } else {
                    _imgInput = _imgFile.content || '';
                }
                if (_imgInput) {
                    try {
                        var _analysis = await window.analyzeImage(_imgInput, '请详细描述这张图片的内容,包括物体、场景、文字等所有可见信息。');
                        if (_analysis && typeof _analysis === 'string' && _analysis.length > 10) {
                            _allImageAnalyses.push('【图片' + (_iai + 1) + '分析结果】\n' + _analysis);
                        }
                        if (currentBubble) {
                            var _st = currentBubble.querySelector('.search-status');
                            if (_st) _st.textContent = '✅ 已分析' + (_iai + 1) + '/' + _imageFiles.length + '张图片';
                        }
                    } catch(e) {
                        console.warn('[AutoAnalyze] 图片', _iai + 1, '分析失败:', e.message);
                        _allImageAnalyses.push('【图片' + (_iai + 1) + '】[分析失败: ' + e.message + ']');
                    }
                }
            }
            if (_allImageAnalyses.length) {
                var _analysisText = '\n\n以下是对用户上传图片的自动分析结果(AI无法直接看到图片,请根据以下描述回答):\n\n' + _allImageAnalyses.join('\n\n---\n\n');
                // 注入到最近的非 system 消息中
                var _sysIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
                if (_sysIdx !== -1) {
                    apiMessages[_sysIdx].content += _analysisText;
                } else {
                    apiMessages.unshift({ role: 'system', content: _analysisText });
                }
                // ★ 缓存到 chat 中,后续追问无需重新分析
                try {
                    if (!chats[chatId].imageAnalyses) chats[chatId].imageAnalyses = [];
                    for (var _cai = 0; _cai < _allImageAnalyses.length; _cai++) {
                        var _cacheEntry = _allImageAnalyses[_cai];
                        // 去重:检查是否已缓存过相同内容
                        if (chats[chatId].imageAnalyses.indexOf(_cacheEntry) === -1) {
                            chats[chatId].imageAnalyses.push(_cacheEntry);
                        }
                    }
                    if (chats[chatId].imageAnalyses.length > 50) {
                        chats[chatId].imageAnalyses = chats[chatId].imageAnalyses.slice(-30);
                    }
                    slimSaveChats();
                } catch(e) {
                    console.warn('[CacheImage] 缓存失败:', e.message);
                }
                if (currentBubble) {
                    var _st = currentBubble.querySelector('.search-status');
                    if (_st) _st.textContent = '✅ 图片分析完成(' + _imageFiles.length + '张)';
                }
                showToast('✅ 图片自动分析完成', 'success', 2000);
            }
        }
    }

    // 可选:上下文压缩
    if (!skipUserAdd && getChecked('compressToggle')) {
        var threshold = parseInt(getVal('compressThreshold')) || 10;
        var nonSys = chats[chatId].messages.filter(m => m.role !== 'system' && !m.partial && !m.temporary).length;
        if (nonSys > threshold) await compressContextIfNeeded(chatId);
    }

    // 构建API消息
    // ★ 提前设置 MiniMax 标记,供 buildApiMessages 使用
    window.__isMiniMaxModel = (getVal('modelSelect') || '').toLowerCase().includes('minimax');
    let apiMessages = buildApiMessages(chatId);

    // ★ 注入历史图片分析缓存,避免模型重复调用 analyze_image 工具
    if (chats[chatId] && chats[chatId].imageAnalyses && chats[chatId].imageAnalyses.length > 0) {
        injectCachedImageAnalyses(chatId, apiMessages);
    }

    // 如果有临时时间戳,插入到系统消息之后
    // ★ MiniMax 合并: 时间戳合并到 system 消息,避免 extra system message
    if (temporaryTimestamp) {
        var _isMm = (getVal('modelSelect') || '').toLowerCase().includes('minimax');
        if (_isMm) {
            let sysIdx = apiMessages.findIndex(m => m.role === 'system');
            if (sysIdx !== -1) {
                apiMessages[sysIdx].content += '\n\n' + temporaryTimestamp.content;
            } else {
                // 没有 system 消息,找到 user 消息前面插入
                var userIdx = apiMessages.findIndex(m => m.role === 'user');
                if (userIdx !== -1) {
                    var _uc2 = apiMessages[userIdx].content;
                    if (Array.isArray(_uc2)) {
                        _uc2.unshift({ type: 'text', text: temporaryTimestamp.content + '\n\n' });
                    } else {
                        apiMessages[userIdx].content = temporaryTimestamp.content + '\n\n' + _uc2;
                    }
                } else {
                    apiMessages.unshift(temporaryTimestamp);
                }
            }
        } else {
            var sysIndex = apiMessages.findIndex(m => m.role === 'system');
            if (sysIndex !== -1) {
                apiMessages.splice(sysIndex + 1, 0, temporaryTimestamp);
            } else {
                apiMessages.unshift(temporaryTimestamp);
            }
        }
    }

    // ★ MiniMax: 工具提示注入到 system 消息（而非 user 消息，避免模型误以为是用户指令）
    var __isMiniMaxModel = (getVal('modelSelect') || '').toLowerCase().includes('minimax');
    if (__isMiniMaxModel && getChecked('searchToggle')) {
        var toolHint = '你可以使用 web_search 搜索最新信息,使用 web_fetch 抓取网页详情。';
        var _sysIdx2 = apiMessages.findIndex(function(m) { return m.role === 'system'; });
        if (_sysIdx2 >= 0 && typeof apiMessages[_sysIdx2].content === 'string') {
            if (!apiMessages[_sysIdx2].content.includes('web_search')) {
                apiMessages[_sysIdx2].content += '\n\n' + toolHint;
            }
        }
    }

    // ★ 记忆注入 (所有模式): 构建记忆+人格上下文块
    let memoryInject = '';
    try {
        var _ctx = window.__memoryContext;
        if (_ctx && _ctx.contextBlock) {
            memoryInject = '\n\n' + _ctx.contextBlock;
        } else {
            // 回退到旧缓存
            var _cachedPersona = window.__agentPersonaCache || window.__cloudPersona;
            var _cachedIdentity = window.__agentIdentityCache || window.__cloudIdentity;
            var _cachedUser = window.__cloudUser;
            var _cachedMemories = window.__agentMemoryCache;
            var _cloudMemories = window.__cloudMemories;
            if (_cachedPersona && _cachedPersona.name) {
                memoryInject += '\n## 人格设定\n- AI名称: ' + _cachedPersona.name + '\n';
                if (_cachedPersona.style) memoryInject += '- 风格: ' + _cachedPersona.style + '\n';
            }
            if (_cachedUser && (_cachedUser.name || _cachedUser.notes)) {
                memoryInject += '\n## 用户信息\n';
                if (_cachedUser.name) memoryInject += '- 称呼: ' + _cachedUser.name + '\n';
                if (_cachedUser.notes) memoryInject += '- 备注: ' + _cachedUser.notes + '\n';
            }
            if (_cachedMemories && _cachedMemories.length > 0) {
                memoryInject += '\n## 长期记忆\n';
                var _mc = 0;
                for (var _mi = 0; _mi < _cachedMemories.length && _mc < 15; _mi++) {
                    var _me = _cachedMemories[_mi];
                    if (_me && (_me.key || _me.relation)) {
                        memoryInject += '- [' + (_me.key || _me.relation) + '] ' + (_me.content || '') + '\n';
                        _mc++;
                    }
                }
                if (_cachedMemories.length > 15) memoryInject += '- ...(还有 ' + (_cachedMemories.length - 15) + ' 条记忆)\n';
            }
            if (_cloudMemories && !_cachedMemories) {
                memoryInject += '\n' + _cloudMemories;
            }
        }
        // ★ RAG 知识库上下文注入
        if (window.RAG_ENABLED && window.__ragLastSearchResults && window.__ragLastSearchResults.length > 0) {
            memoryInject += '\n\n## 知识库检索结果\n以下是从本地知识库中检索到的相关内容:\n';
            window.__ragLastSearchResults.slice(0, 5).forEach(function(r) {
                memoryInject += '- [' + (r.filename || 'doc') + '] ' + (r.text || '').substring(0, 600) + '\n';
            });
        }
    } catch(e) { console.warn('[Memory] inject failed:', e); }

    // ★ Plan 模式: 注入专用规划提示词（只读探索→生成计划→等待审批→执行）
    if (typeof isPlanMode === 'function' && isPlanMode()) {
        var planPrompt = '你现在处于 Plan 规划模式。\n\n' +
            '## 工作流（强制遵守）\n' +
            '1. **探索阶段**: 使用只读工具（web_search, web_fetch, server_file_read, server_file_search, rag_search 等）收集信息\n' +
            '2. **规划阶段**: 信息收集完毕后，调用 plan_update(action="create") 创建执行计划（3-8 个步骤）\n' +
            '3. **等待审批**: 创建计划后停止工具调用，输出一段简短的计划摘要供用户参考，然后等待用户审批\n' +
            '4. **执行阶段**: 用户同意计划后，你将收到系统通知，此时按计划逐步执行，每步调用 plan_update(action="update") 更新状态\n' +
            '5. **完成**: 所有步骤完成后调用 plan_update(action="complete")\n\n' +
            '## 限制（强制遵守）\n' +
            '- 探索阶段禁止执行写操作（server_exec、server_file_write、server_python、API 调用等），这些操作会被系统拒绝\n' +
            '- 计划创建后必须等待用户审批，不得提前执行写操作\n' +
            '- 用户可能要求修改计划，根据反馈重新调用 plan_update(action="create") 提交新计划\n' +
            '- 简单任务（≤2 步）无需创建计划，直接执行即可';
        var sysIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
        if (sysIdx !== -1) {
            apiMessages[sysIdx].content = apiMessages[sysIdx].content + '\n\n' + planPrompt + memoryInject;
        } else {
            apiMessages.unshift({ role: 'system', content: planPrompt + memoryInject });
        }
    }
    // ★ Agent 模式: 合并 agent 系统提示词 + 工具指令
    else if (isAgentToolsActive()) {
        let agentPrompt = localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt;
        var _maxRounds = parseInt(localStorage.getItem('agentMaxToolRounds')) || 1000;
        agentPrompt += '\n\n## 工具调用限制\n本轮对话最多调用 ' + _maxRounds + ' 次工具。请合理规划,避免浪费配额。如果接近上限,优先给出已有结果而不是继续调用。';
        if (agentPrompt.indexOf('plan_update') === -1) {
            agentPrompt += '\n\n## 计划管理\n复杂任务(≥3步)先用 plan_update(action="create") 创建计划面板，执行中更新状态，完成后 plan_update(action="complete")。简单任务无需计划。';
        }
        // 追加工具指令 + 记忆
        var sysContent = agentPrompt + memoryInject;
        var sysIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
        if (sysIdx !== -1) {
            apiMessages[sysIdx].content = apiMessages[sysIdx].content + '\n\n' + sysContent;
        } else {
            apiMessages.unshift({ role: 'system', content: sysContent });
        }
    } else if (memoryInject) {
        // ★ 非 Agent 模式: 只注入记忆上下文
        var sysIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
        if (sysIdx !== -1) {
            apiMessages[sysIdx].content = apiMessages[sysIdx].content + memoryInject;
        } else {
            apiMessages.unshift({ role: 'system', content: memoryInject });
        }
    }

    // ★ 内部 Agent 上下文注入(必须在 agent 提示词之后,确保覆盖创建子代理指令)
    if (window.__internalAgentContext) {
        var ctx = window.__internalAgentContext;
        delete window.__internalAgentContext;
        var sysIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
        if (sysIdx !== -1) {
            apiMessages[sysIdx].content += '\n\n' + ctx;
        } else {
            apiMessages.unshift({ role: 'system', content: ctx });
        }
    }

    // ★ 技能匹配: 根据用户消息匹配相关 Skills, 注入到 system prompt
    if (typeof window.matchSkills === 'function') {
        try {
            var _userText = text || '';
            var _matchedSkills = await window.matchSkills(_userText);
            if (_matchedSkills && _matchedSkills.length > 0) {
                var _skillPrompt = window.getMatchedSkillsPrompt(_matchedSkills);
                if (_skillPrompt) {
                    var _sIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
                    if (_sIdx !== -1) {
                        apiMessages[_sIdx].content += '\n' + _skillPrompt;
                    } else {
                        apiMessages.unshift({ role: 'system', content: _skillPrompt });
                    }
                }
            }
            // 始终注入可用技能列表(简介)
            var _skillList = window.getSkillsSystemPrompt();
            if (_skillList) {
                var _sIdx2 = apiMessages.findIndex(function(m) { return m.role === 'system'; });
                if (_sIdx2 !== -1 && apiMessages[_sIdx2].content.indexOf('可用技能') === -1) {
                    apiMessages[_sIdx2].content += '\n' + _skillList;
                }
            }
        } catch(e) {}
    }

    // 选择模型
    let model = getVal('modelSelect') || DEFAULT_CONFIG.model;
    // 图片由 analyze_image 工具处理,不切换模型(analyze_image 会调用 MCP 桥接)
    // 保持使用当前文本模型即可
    if (searchResult.searchPerformed && searchResult.searchResults?.length) {
        var searchModel = getVal('searchModel');
        if (searchModel && searchModel !== '加载中...') model = searchModel;
    }

    // 估算tokens(排除base64图片数据,处理数组格式)
    var totalText = apiMessages.map(m => {
        if (Array.isArray(m.content)) {
            // 数组格式(视觉模型):提取所有文本部分
            return m.content.map(item => {
                if (item.type === 'text') {
                    return item.text || '';
                }
                return '[图片]';
            }).join(' ');
        } else if (typeof m.content === 'string') {
            // 字符串格式:移除base64图片数据
            return m.content.replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/g, '[图片]');
        }
        return '';
    }).join(' ');
    var estimated = estimateTokens(totalText);
    // ★ 完全按用户配置,不按模型自动调整
    let requestedTokens = parseInt(getVal('maxTokens')) || 4096;

    // 构建请求体
    // ★ Anthropic API 格式开关: 用户可通过设置启用(全局或per-provider)
    // 支持 Anthropic Messages API 格式的提供商: Anthropic, MiniMax M3, OpenRouter, 自定义端点等
    // ★ Anthropic 格式判断:
    //   api.anthropic.com → 自动启用
    //   api.deepseek.com / api.minimaxi.com → 开开关后启用
    //   其他 (Grok/OpenAI 等) → 不支持，始终 OpenAI 格式
    var _baseUrl = getVal('baseUrl') || '';
    var _providerName = getEl('baseUrlProvider')?.value || localStorage.getItem('baseUrlProvider') || '';
    var _isLongCatRequest = typeof window.isLongCat === 'function'
        ? window.isLongCat(model, _baseUrl, _providerName)
        : (String(model).toLowerCase().includes('longcat') || _baseUrl.includes('api.longcat.chat'));
    // 官方当前仅提供 LongCat-2.0，避免历史/搜索模型覆盖后带错模型名。
    if (_isLongCatRequest) model = 'LongCat-2.0';
    var _isNativeAnthropic = _baseUrl.indexOf('api.anthropic.com') >= 0;
    var _supportsAnthropic = _isNativeAnthropic || _baseUrl.indexOf('api.deepseek.com') >= 0 || _baseUrl.indexOf('api.minimaxi.com') >= 0 || _baseUrl.indexOf('api.minimax.io') >= 0 || _baseUrl.indexOf('api.longcat.chat') >= 0;
    var _useAnthropicFormat = _isNativeAnthropic || (_supportsAnthropic && localStorage.getItem('useAnthropicFormat') === '1');
    let _aSysContent = '';
    // ★ Anthropic 消息转换 (可复用, 供初始构建和工具循环重建调用)
    function _convertAnthropicMessages(_msgs) {
        var _out = [];
        for (var _i = 0; _i < _msgs.length; _i++) {
            var _m = JSON.parse(JSON.stringify(_msgs[_i])); // deep copy
            // Anthropic 的 system 必须使用顶层 system 字段，不能再留在 messages。
            if (_m.role === 'system') {
                continue;
            } else if (_m.role === 'user') {
                var _alreadyAnthropic = Array.isArray(_m.content) && _m.content.some(function(c){return c.type==='tool_result'||c.type==='tool_use';});
                if (_alreadyAnthropic) { _out.push(_m); continue; }
                if (typeof _m.content === 'string') _m.content = [{type:'text',text:_m.content}];
                else if (Array.isArray(_m.content)) _m.content = _m.content.map(function(c){
                    if (c.type==='image_url') return {type:'image',source:{type:'url',url:c.image_url.url}};
                    if (c.type==='video_url') return {type:'video',source:{type:'url',url:c.video_url.url}};
                    return c;
                });
            } else if (_m.role === 'assistant' && _m.tool_calls) {
                var _blocks = [];
                var _rc = _m.reasoning_content || _m.reasoning || '';
                if (_rc && _rc.trim()) _blocks.push({type:'thinking',thinking:_rc});
                if (typeof _m.content === 'string' && _m.content.trim()) _blocks.push({type:'text',text:_m.content});
                for (var _ti = 0; _ti < _m.tool_calls.length; _ti++) {
                    var _tc = _m.tool_calls[_ti];
                    var _input = {};
                    try { _input = JSON.parse(_tc.function.arguments||'{}'); } catch(e) { _input = tolerantToolInput(_tc.function.name, _tc.function.arguments || '') || {}; }
                    _blocks.push({type:'tool_use',id:_tc.id||('toolu_'+Date.now()),name:_tc.function.name,input:_input});
                }
                _m.content = _blocks;
                delete _m.tool_calls; delete _m.reasoning_content; delete _m.reasoning;
            } else if (_m.role === 'assistant') {
                var _rc2 = _m.reasoning_content || _m.reasoning || '';
                if (_rc2 && _rc2.trim() && typeof _m.content === 'string')
                    _m.content = [{type:'thinking',thinking:_rc2},{type:'text',text:_m.content||''}];
                delete _m.reasoning_content; delete _m.reasoning;
            } else if (_m.role === 'tool') {
                _m.role = 'user';
                var _tid = _m.tool_call_id || '';
                if (!_tid) {
                    for (var _tli = _out.length-1; _tli >= 0; _tli--) {
                        var _prev = _out[_tli];
                        if (_prev.role==='assistant' && Array.isArray(_prev.content))
                            for (var _pci = _prev.content.length-1; _pci >= 0; _pci--)
                                if (_prev.content[_pci].type==='tool_use' && _prev.content[_pci].id) {_tid=_prev.content[_pci].id; break;}
                        if (_tid) break;
                    }
                }
                if (!_tid) _tid = 'toolu_fallback_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
                _m.content = [{type:'tool_result',tool_use_id:_tid,content:typeof _m.content==='string'?_m.content:JSON.stringify(_m.content)}];
                delete _m.tool_call_id; delete _m._datePrefix;
            }
            _out.push(_m);
        }
        // merge consecutive tool_result messages
        var _merged = [];
        for (var _mi = 0; _mi < _out.length; _mi++) {
            var _mm = _out[_mi];
            if (_mm.role==='user' && Array.isArray(_mm.content) && _mm.content.some(function(c){return c.type==='tool_result';})) {
                while (_mi+1 < _out.length) {
                    var _nxt = _out[_mi+1];
                    if (_nxt.role==='user' && Array.isArray(_nxt.content) && _nxt.content.some(function(c){return c.type==='tool_result';})) {
                        _mm.content = _mm.content.concat(_nxt.content); _mi++;
                    } else break;
                }
            }
            _merged.push(_mm);
        }
        // validate tool_use↔tool_result
        var _valid = [];
        for (var _vi = 0; _vi < _merged.length; _vi++) {
            var _vm = _merged[_vi];
            if (_vm.role==='assistant' && Array.isArray(_vm.content) && _vm.content.some(function(c){return c.type==='tool_use';})) {
                var _n2 = _merged[_vi+1];
                if (!_n2 || _n2.role!=='user' || !Array.isArray(_n2.content) || !_n2.content.some(function(c){return c.type==='tool_result';}))
                    _vm.content = _vm.content.filter(function(c){return c.type!=='tool_use';});
            }
            _valid.push(_vm);
        }
        return _valid;
    }

    if (_useAnthropicFormat) {
        // 提取 system 消息
        for (var _ami = 0; _ami < apiMessages.length; _ami++) {
            var _am = apiMessages[_ami];
            if (_am.role === 'system') {
                _aSysContent += (_aSysContent ? '\n\n' : '') + (typeof _am.content === 'string' ? _am.content : '');
            }
        }
        apiMessages = _convertAnthropicMessages(apiMessages);
    }

    // 统一获取模型选择并转小写
    var currentModel = (_isLongCatRequest ? model : (getVal('modelSelect') || '')).replace(/^(models|publishers)\//, '');  // ★ 去除 Google API 等前缀
    var modelLower = currentModel.toLowerCase();

    // ★ LongCat 清洗: 在发送前确保 messages 兼容 LongCat 的 apply_chat_template
    try {
        var _isLC = _isLongCatRequest;
        // Anthropic 格式的 content block/tool_use 数组必须保留；只清洗 OpenAI 格式。
        if (_isLC && !_useAnthropicFormat && typeof window.sanitizeForLongCat === 'function') {
            apiMessages = window.sanitizeForLongCat(apiMessages);
            for (var _lc = 0; _lc < apiMessages.length; _lc++) {
                var _lm = apiMessages[_lc];
                if (Array.isArray(_lm.content)) {
                    console.error('[LongCat] ⚠️ msg[' + _lc + '] role=' + _lm.role + ' content STILL ARRAY!');
                }
            }
        }
    } catch(_e) {
        console.error('[LongCat] ERROR:', _e.message);
    }

    var body = {
        model,
        messages: apiMessages,
        stream: getChecked('streamToggle'),
        temperature: parseFloat(getVal('temperature')) || 0.7,
        max_tokens: requestedTokens
    };

    // ★ 思考强度分级 (全局生效，覆盖 LongCat/MiniMax 原有独立设置)
    var _thinkingIntensity = localStorage.getItem('thinkingIntensity') || 'medium';
    if (window.MODEL_CONFIGS && window.MODEL_CONFIGS.supportsThinkingIntensity(modelName)) {
        var _tp = window.MODEL_CONFIGS.getThinkingIntensityParams(_thinkingIntensity, modelName, _useAnthropicFormat);
        Object.keys(_tp).forEach(function(_k) {
            if (_tp[_k] === undefined) delete body[_k]; else body[_k] = _tp[_k];
        });
    }

    // ★ 按模型配置限制 max_tokens 上限 (如 LongCat 限制 ≤131072)
    var _modelMaxOutput = window.MODEL_CONFIGS && window.MODEL_CONFIGS.getMaxOutputTokens
        ? window.MODEL_CONFIGS.getMaxOutputTokens(model) : 0;
    if (_modelMaxOutput > 0 && requestedTokens > _modelMaxOutput) {
        console.log('[ModelCap] max_tokens ' + requestedTokens + ' → ' + _modelMaxOutput + ' (' + model + ')');
        body.max_tokens = _modelMaxOutput;
        requestedTokens = _modelMaxOutput;
    }

    // ★ MiniMax M3: token 控制（思考强度已由上方统一逻辑处理）
    if (!_useAnthropicFormat && (modelLower.includes('m3') || modelLower.includes('minimax-m3'))) {
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
    }

    // MiniMax M2: 启用 reasoning_split 以分离思考内容
    var isMiniMaxModel = modelLower.includes('minimax');
    // MiniMax M2: 默认使用<think>标签模式(不传reasoning_split以避免参数错误)

    // ★ Agent 模式: 始终启用工具调用
    var agentModeActive = isAgentToolsActive();
    var effectiveToolCall = useToolCall || currentMessageHasImages || agentModeActive;

    // ★ 终极检查: 模型在 no-tool 列表中就直接跳过整个工具注册
    var _noToolCheckList = JSON.parse(localStorage.getItem('noToolModels') || '[]');
    var _modelNameLC = modelLower;
    for (var _ntci = 0; _ntci < _noToolCheckList.length; _ntci++) {
        if (_modelNameLC.indexOf(_noToolCheckList[_ntci]) !== -1) {
            effectiveToolCall = false;
            console.log('[NoTool] 模型', model, '匹配 no-tool 列表,强制关闭工具调用');
            break;
        }
    }

    // 添加工具定义(使用提前保存的当前消息图片状态)
    if (effectiveToolCall) {
        // 只对支持视觉的模型添加图生图工具,文本模型无法处理图片参数
    // 图生图工具:所有模型都可使用,因为系统会自动获取用户上传的图片
    // 注意:generate_image_i2i 工具的参数 image 会由系统自动填充,不需要AI处理
    var i2iTool = IMAGE_I2I_TOOL_DEFINITION;

    // 构建工具列表
    var imageTools = [IMAGE_TOOL_DEFINITION, ANALYZE_IMAGE_TOOL];
    if (i2iTool) imageTools.push(i2iTool);
    imageTools.push(VIDEO_UNDERSTANDING_TOOL);
    imageTools.push(VIDEO_EDIT_TOOL);

    // 构建工具列表:根据搜索开关和工具模式动态选择
    var searchOn = getChecked('searchToggle');
    var toolMode = effectiveToolCall;
    if (toolMode) {
        // ★ 工具分类: A类(始终可用) | B类(Agent模式启用后额外可用) | C类(始终在列表中)
        var tools = [];

        // ===== A 类工具: 始终可用(无论是否 Agent 模式) =====
        // ★ 时间工具: 始终可用(只读,不占缓存,模型按需调用判断事件是否已发生)
        if (typeof GET_CURRENT_TIME_TOOL !== 'undefined') tools.push(GET_CURRENT_TIME_TOOL);
        // 搜索工具(受搜索开关控制)
        if (searchOn) {
            tools.push(SEARCH_TOOL_DEFINITION);
            tools.push(WEB_FETCH_TOOL_DEFINITION);
            if (window.RAG_ENABLED) tools.push(RAG_SEARCH_TOOL_DEFINITION);
        }
        // 图片工具: 原生多模态模型有图片时不注册 analyze_image,避免重复分析
        if (currentMessageHasImages && window.MODEL_CONFIGS && window.MODEL_CONFIGS.supportsVision(modelLower)) {
            tools.push(IMAGE_TOOL_DEFINITION);
            if (i2iTool) tools.push(i2iTool);
        } else {
            tools = tools.concat(imageTools);
        }
        // 文件读取/搜索/解析(基础操作,不限制)
        tools.push(SERVER_FILE_READ_TOOL);
        tools.push(SERVER_FILE_SEARCH_TOOL);
        tools.push(SERVER_FILE_GREP_TOOL);
        if (typeof PARSE_DOCUMENT_TOOL !== 'undefined') tools.push(PARSE_DOCUMENT_TOOL);
        // ★ B站工具 — 始终可用(只读获取)
        tools.push({type:'function',function:{name:'bilibili_search',description:'综合搜索B站内容(视频/专栏/用户)',parameters:{type:'object',properties:{keyword:{type:'string',description:'搜索关键词'},search_type:{type:'string',description:'video/article/bili_user,默认video'},limit:{type:'integer',description:'返回条数,默认10'}},required:['keyword']}}});
        tools.push({type:'function',function:{name:'bilibili_video_info',description:'获取B站视频详情(标题/UP主/播放量/弹幕/分P)',parameters:{type:'object',properties:{bvid:{type:'string',description:'视频BV号或AV号或b23.tv链接'}},required:['bvid']}}});
        tools.push({type:'function',function:{name:'bilibili_article_read',description:'阅读B站专栏文章全文',parameters:{type:'object',properties:{cvid:{type:'string',description:'专栏cv号或URL'}},required:['cvid']}}});
        tools.push({type:'function',function:{name:'bilibili_user_profile',description:'获取B站用户主页(昵称/粉丝/投稿)',parameters:{type:'object',properties:{uid:{type:'string',description:'用户UID'}},required:['uid']}}});
        tools.push({type:'function',function:{name:'bilibili_comment_list',description:'获取B站视频/专栏评论',parameters:{type:'object',properties:{oid:{type:'string',description:'目标ID(视频BV号)'},type:{type:'integer',description:'评论类型:1=视频,12=专栏,默认1'},limit:{type:'integer',description:'条数,默认20'}},required:['oid']}}});
        tools.push({type:'function',function:{name:'bilibili_dynamic_list',description:'获取B站动态流(需登录)',parameters:{type:'object',properties:{uid:{type:'string',description:'用户UID'},limit:{type:'integer',description:'条数,默认10'}},required:['uid']}}});
        tools.push({type:'function',function:{name:'bilibili_qr_login',description:'B站扫码登录。两步流程:①action=qr生成二维码(立即返回)→②action=poll轮询等待扫码(阻塞,拿到结果前不要回复用户)。action=auto一键完成两步。',parameters:{type:'object',properties:{action:{type:'string',description:'qr=生成二维码(返回后必须立即调poll); poll=阻塞等待扫码(不要中断); auto=一键登录',enum:['check','qr','poll','auto']},qrcode_key:{type:'string',description:'poll时传入qr返回的key'},timeout:{type:'integer',description:'超时秒数(默认120)'}},required:['action']}}});
        // PPT生成 — 始终可用
        if (typeof GENERATE_PPT_TOOL !== 'undefined') tools.push(GENERATE_PPT_TOOL);
        // toggle_proxy — 始终可用(非Agent也可用，弹窗确认)
        if (typeof TOGGLE_PROXY_TOOL !== 'undefined') tools.push(TOGGLE_PROXY_TOOL);
        // ask_agent: 仅在普通模式且当前对话无临时授权时注册
        // Agent模式/yolo模式/当前对话已有临时授权时无需此工具
        var _hasTempForThisChat = !!(window._tempAgentGranted && window._tempAgentChatId === chatId);
        if (!agentModeActive && !_hasTempForThisChat) {
            tools.push(ASK_AGENT_TOOL);
        }

        // ★ 临时授权的有效范围: 仅当前对话的临时授权才启用 B 类工具
        var _effectiveAgent = agentModeActive || _hasTempForThisChat;

        // ===== B 类工具: Agent 模式启用后额外可用 =====
        if (_effectiveAgent) {
            // RAG 搜索(仅当搜索关闭时加入,避免重复)
            if (!searchOn || !window.RAG_ENABLED) {
                if (window.RAG_ENABLED) tools.push(RAG_SEARCH_TOOL_DEFINITION);
                else if (!searchOn) tools.push(RAG_SEARCH_TOOL_DEFINITION);
            }
            // 服务器操控工具
            tools.push(SERVER_EXEC_TOOL);
            tools.push(SERVER_PYTHON_TOOL);
            tools.push(SERVER_FILE_WRITE_TOOL);
            tools.push(SERVER_FILE_EDIT_TOOL);
            tools.push(SERVER_FILE_OP_TOOL);
            tools.push(SERVER_SYS_INFO_TOOL);
            tools.push(SERVER_PS_TOOL);
            tools.push(SERVER_DISK_TOOL);
            tools.push(SERVER_NETWORK_TOOL);
            tools.push(SERVER_DOCKER_TOOL);
            tools.push(SERVER_DB_QUERY_TOOL);
            // 引擎/Agent工具
            tools.push(ENGINE_CRON_LIST_TOOL);
            tools.push(ENGINE_CRON_CREATE_TOOL);
            tools.push(ENGINE_CRON_DELETE_TOOL);
            tools.push(DELEGATE_TASK_TOOL);
            tools.push(DELEGATE_WORKFLOW_TOOL);
            tools.push(ENGINE_AGENT_STATUS_TOOL);
            tools.push(ENGINE_AGENT_LIST_TOOL);
            tools.push(ENGINE_AGENT_DELETE_TOOL);
            tools.push(ENGINE_AGENT_ASK_TOOL);
            tools.push(ENGINE_PUSH_TOOL);
            // 计划更新工具(Agent模式)
            tools.push(PLAN_UPDATE_TOOL);
            // ===== 浏览器工具(Agent模式) =====
            tools.push(BROWSER_NAVIGATE_TOOL);
            tools.push(BROWSER_SCREENSHOT_TOOL);
            tools.push(BROWSER_CLICK_TOOL);
            tools.push(BROWSER_TYPE_TOOL);
            tools.push(BROWSER_GET_CONTENT_TOOL);
            tools.push(BROWSER_GET_SNAPSHOT_TOOL);
            // web_fetch 已在 searchOn 分支添加,此处不再重复
        }

        // ===== 刷课工具(始终注册,不受Agent模式影响) =====
        tools.push(CHAOXING_LOGIN_TOOL_DEFINITION);
        tools.push(CHAOXING_LIST_TOOL_DEFINITION);
        tools.push(CHAOXING_TOOL_DEFINITION);
        tools.push(CHAOXING_STATUS_TOOL_DEFINITION);
        tools.push(CHAOXING_STOP_TOOL_DEFINITION);
        tools.push(CHAOXING_STATS_TOOL_DEFINITION);
        tools.push(CHAOXING_OVERVIEW_TOOL);
        tools.push(CHAOXING_AUTH_TOOL);
        tools.push(CHAOXING_QR_LOGIN_TOOL);
        tools.push(CHAOXING_EXAM_LIST_TOOL);
        tools.push(CHAOXING_EXAM_START_TOOL);
        tools.push(CHAOXING_EXAM_STATUS_TOOL);
        tools.push(CHAOXING_EXAM_STOP_TOOL);

        // ===== autonomous_mode: Agent/临时授权模式可用 =====
        if (_effectiveAgent) {
            tools.push(AUTONOMOUS_MODE_TOOL);
        }
        // ★ SRC 星穹铁道工具已移除 (功能弃用)
        // ===== WIN 工具: 仅完整 Agent 模式可用 (临时授权不暴露Windows宿主工具) =====
        if (agentModeActive) {
            if (typeof WIN_TOOLS !== 'undefined') WIN_TOOLS.forEach(function(t) { tools.push(t); });
        }
        // ===== MiniMax CLI 工具(始终注册,不受Agent模式影响) =====
        if (typeof MMX_TOOLS !== 'undefined') {
            MMX_TOOLS.forEach(function(t) { tools.push(t); });
        }
        // ===== Cloudreve 云盘工具(始终注册) =====
        if (typeof CLOUDREVE_TOOLS !== 'undefined') {
            if (typeof CLOUDREVE_TOOLS !== 'undefined') CLOUDREVE_TOOLS.forEach(function(t) { tools.push(t); });
        }
        // ===== 网盘解析工具(始终注册) =====
        if (typeof window.NETDISK_TOOLS !== 'undefined') {
            window.NETDISK_TOOLS.forEach(function(t) { tools.push(t); });
        }
        // ===== 网盘登录工具(始终注册) =====
        if (typeof window.NETDISK_LOGIN_TOOLS !== 'undefined') {
            window.NETDISK_LOGIN_TOOLS.forEach(function(t) { tools.push(t); });
        }
        // ===== 视频猎手工具(始终注册, 含B站下载/BT磁力/云盘) =====
        if (typeof window.VIDEO_HUNTER_TOOLS !== 'undefined') {
            window.VIDEO_HUNTER_TOOLS.forEach(function(t) { tools.push(t); });
        }
        // ★ 添加自定义技能到工具列表
        (function() {
            var _customSkills = [];
            try { _customSkills = JSON.parse(localStorage.getItem('customSkills') || '[]'); } catch(e) {}
            for (var _csi = 0; _csi < _customSkills.length; _csi++) {
                var _cs = _customSkills[_csi];
                if (typeof _cs === 'object' && _cs.function && _cs.function.name) {
                    tools.push(_cs);
                }
            }
        })();
        // ★ 高德地图工具(始终注册, 普通模式可用)
        if (typeof window.AMAP_MAPS_TOOLS !== 'undefined') {
            window.AMAP_MAPS_TOOLS.forEach(function(t) { tools.push(t); });
        }
        // ★ 股票数据工具(始终注册, 普通模式可用)
        if (typeof window.STOCK_TOOLS !== 'undefined') {
            window.STOCK_TOOLS.forEach(function(t) { tools.push(t); });
        }
        // ★ MCP 服务器工具(始终注册, 来自已连接的外部 MCP 服务器)
        if (typeof window.getMcpToolsForChat === 'function') {
            var _mcpTools = window.getMcpToolsForChat();
            _mcpTools.forEach(function(t) { tools.push(t); });
        }
        // ★ 智能工具注入: 根据用户输入动态添加匹配技能的工具
        (function() {
            // 获取用户最新消息
            var _lastUserMsg = '';
            if (chats[chatId] && chats[chatId].messages) {
                for (var _mi = chats[chatId].messages.length - 1; _mi >= 0; _mi--) {
                    var _msg = chats[chatId].messages[_mi];
                    if (_msg.role === 'user' && _msg.content) {
                        _lastUserMsg = typeof _msg.content === 'string' ? _msg.content : '';
                        if (Array.isArray(_msg.content)) {
                            _msg.content.forEach(function(part) {
                                if (part.type === 'text') _lastUserMsg += ' ' + part.text;
                            });
                        }
                        break;
                    }
                }
            }
            if (!_lastUserMsg || _lastUserMsg.trim().length < 2) return;
            // 同步匹配技能 (缓存结果供后续使用)
            var _skills = window._skillsCache || [];
            if (!_skills.length) return;
            var _matched = [];
            var _query = _lastUserMsg.toLowerCase();
            _skills.forEach(function(s) {
                var _triggers = (s.meta && s.meta.oneapichat && s.meta.oneapichat.triggers) || [];
                var _score = 0;
                _triggers.forEach(function(t) {
                    if (_query.indexOf(t.toLowerCase()) !== -1) _score += 10;
                });
                if (_score > 0) _matched.push({ name: s.name, score: _score, tools: (s.meta && s.meta.oneapichat && s.meta.oneapichat.tools) || [] });
            });
            _matched.sort(function(a, b) { return b.score - a.score; });
            // 取TOP3匹配技能的工具, 去重后注入
            var _existingToolNames = new Set(function() {
                var _names = [];
                for (var _ti = 0; _ti < tools.length; _ti++) {
                    if (tools[_ti] && tools[_ti].function) _names.push(tools[_ti].function.name);
                }
                return _names;
            }());
            var _injected = 0;
            for (var _mi2 = 0; _mi2 < Math.min(3, _matched.length); _mi2++) {
                var _skillTools = _matched[_mi2].tools;
                for (var _ti2 = 0; _ti2 < _skillTools.length; _ti2++) {
                    var _toolName = _skillTools[_ti2];
                    if (!_existingToolNames.has(_toolName)) {
                        // 从toolRegistry获取工具定义
                        var _toolDef = typeof toolRegistry !== 'undefined' && toolRegistry.getToolDefinition
                            ? toolRegistry.getToolDefinition(_toolName) : null;
                        if (_toolDef) {
                            tools.push(_toolDef);
                            _existingToolNames.add(_toolName);
                            _injected++;
                        }
                    }
                }
            }
            if (_injected > 0) {
                console.log('[SmartInject] 注入 ' + _injected + ' 个技能工具 (匹配: ' + _matched.slice(0,3).map(function(m){return m.name;}).join(', ') + ')');
            }
        })();
        // ★ 工具启用开关过滤
        (function() {
            var _filteredTools = [];
            var _toolFuncNameToToggleKey = {
                'web_search': 'SEARCH_TOOL_DEFINITION',
                'rag_search': 'RAG_SEARCH_TOOL_DEFINITION',
                'web_fetch': 'WEB_FETCH_TOOL_DEFINITION',
                'generate_image': 'IMAGE_TOOL_DEFINITION',
                'generate_image_i2i': 'IMAGE_TOOL_DEFINITION',
                'analyze_image': 'ANALYZE_IMAGE_TOOL',
                'video_understanding': 'VIDEO_UNDERSTANDING_TOOL',
                'video_edit': 'VIDEO_EDIT_TOOL',
                'chaoxing_login': 'CHAXING_LOGIN_TOOL_DEFINITION',
                'chaoxing_list_courses': 'CHAXING_LIST_TOOL_DEFINITION',
                'chaoxing_auto': 'CHAXING_TOOL_DEFINITION',
                'chaoxing_status': 'CHAXING_STATUS_TOOL_DEFINITION',
                'chaoxing_stop': 'CHAXING_STOP_TOOL_DEFINITION',
                'chaoxing_stats': 'CHAXING_STATS_TOOL_DEFINITION',
                'chaoxing_overview': 'CHAXING_OVERVIEW_TOOL',
                'chaoxing_auth': 'CHAXING_AUTH_TOOL',
                'chaoxing_exam_list': 'CHAXING_EXAM_LIST_TOOL',
                'chaoxing_exam_start': 'CHAXING_EXAM_START_TOOL',
                'chaoxing_exam_status': 'CHAXING_EXAM_STATUS_TOOL',
                'chaoxing_exam_stop': 'CHAXING_EXAM_STOP_TOOL',
                'server_exec': 'SERVER_EXEC_TOOL',
                'server_python': 'SERVER_PYTHON_TOOL',
                'server_file_read': 'SERVER_FILE_READ_TOOL',
                'server_file_write': 'SERVER_FILE_WRITE_TOOL',
                'server_sys_info': 'SERVER_SYS_INFO_TOOL',
                'server_ps': 'SERVER_PS_TOOL',
                'server_disk': 'SERVER_DISK_TOOL',
                'server_network': 'SERVER_NETWORK_TOOL',
                'server_docker': 'SERVER_DOCKER_TOOL',
                'server_db_query': 'SERVER_DB_QUERY_TOOL',
                'server_file_search': 'SERVER_FILE_SEARCH_TOOL',
                'server_file_op': 'SERVER_FILE_OP_TOOL',
                'server_file_edit': 'SERVER_FILE_EDIT_TOOL',
                'server_file_grep': 'SERVER_FILE_GREP_TOOL',
                'engine_cron_list': 'ENGINE_CRON_LIST_TOOL',
                'engine_cron_create': 'ENGINE_CRON_CREATE_TOOL',
                'engine_cron_delete': 'ENGINE_CRON_DELETE_TOOL',
                'delegate_task': 'DELEGATE_TASK_TOOL',
                'delegate_workflow': 'DELEGATE_WORKFLOW_TOOL',
                'engine_agent_status': 'ENGINE_AGENT_STATUS_TOOL',
                'engine_agent_list': 'ENGINE_AGENT_LIST_TOOL',
                'engine_agent_delete': 'ENGINE_AGENT_DELETE_TOOL',
                'engine_agent_ask': 'ENGINE_AGENT_DELETE_TOOL',
                'engine_push': 'ENGINE_PUSH_TOOL',
                'plan_update': 'PLAN_UPDATE_TOOL',
                'ask_agent': 'ASK_AGENT_TOOL',
                'autonomous_mode': 'AUTONOMOUS_MODE_TOOL',
                // ★ src_* 星穹铁道工具已移除
                'win_info': 'WIN_INFO_TOOL',
                'win_processes': 'WIN_PROCESSES_TOOL',
                'win_kill': 'WIN_KILL_TOOL',
                'win_start': 'WIN_START_TOOL',
                'win_restart': 'WIN_RESTART_TOOL',
                'win_file': 'WIN_FILE_TOOL',
                'win_screenshot': 'WIN_SCREENSHOT_TOOL',
                // MiniMax 工具
                'mmx_chat': 'MMX_CHAT_TOOL', 'mmx_speech': 'MMX_SPEECH_TOOL',
                'mmx_music': 'MMX_MUSIC_TOOL', 'mmx_voices': 'MMX_VOICES_TOOL',
                'mmx_quota': 'MMX_QUOTA_TOOL', 'mmx_image': 'MMX_IMAGE_TOOL',
                'mmx_video': 'MMX_VIDEO_TOOL', 'mmx_vision': 'MMX_VISION_TOOL',
                // Cloudreve 工具
                'cr_login': 'CR_LOGIN_TOOL', 'cr_user_info': 'CR_USER_INFO_TOOL',
                'cr_list_files': 'CR_LIST_FILES_TOOL', 'cr_search_files': 'CR_SEARCH_FILES_TOOL',
                'cr_create_folder': 'CR_CREATE_FOLDER_TOOL', 'cr_rename': 'CR_RENAME_TOOL',
                'cr_move': 'CR_MOVE_TOOL', 'cr_copy': 'CR_COPY_TOOL',
                'cr_delete': 'CR_DELETE_TOOL', 'cr_list_shares': 'CR_LIST_SHARES_TOOL',
                'cr_create_share': 'CR_CREATE_SHARE_TOOL', 'cr_delete_share': 'CR_DELETE_SHARE_TOOL',
                'cr_storage_info': 'CR_STORAGE_INFO_TOOL', 'cr_overview': 'CR_OVERVIEW_TOOL',
                // B站工具
                'bilibili_search': 'BILI_SEARCH_TOOL', 'bilibili_video_info': 'BILI_VIDEO_TOOL',
                'bilibili_article_read': 'BILI_ARTICLE_TOOL', 'bilibili_user_profile': 'BILI_USER_TOOL',
                'bilibili_comment_list': 'BILI_COMMENT_TOOL', 'bilibili_dynamic_list': 'BILI_DYNAMIC_TOOL',
                'bilibili_qr_login': 'BILI_QR_LOGIN_TOOL'
            };
            for (var _fti = 0; _fti < tools.length; _fti++) {
                var _ft = tools[_fti];
                var _ftName = _ft.function?.name || '';
                // ★ 动态 toggle key 解析: 映射表 > tool name 直接作 key > 默认启用
                var _toggleKey = _toolFuncNameToToggleKey[_ftName] || _ftName;
                // 兼容旧 key: 检查 oldKey 的 localStorage
                var _oldKey = _toolFuncNameToToggleKey[_ftName];
                var _enabled = window.isToolEnabled(_toggleKey);
                if (!_enabled && _oldKey && _oldKey !== _toggleKey) {
                    _enabled = window.isToolEnabled(_oldKey);  // 回退旧格式
                }
                if (_enabled) {
                    // ★ Agent 模式关闭时, 用 toolRegistry.isAgentOnly 判断代理专属工具
                    var _agentOn = isAgentToolsActive() || (window._tempAgentGranted && window._tempAgentChatId === chatId);
                    var _hasAskAgent = tools.some(function(t) { return t.function?.name === 'ask_agent'; });
                    var _isAgentOnly = typeof toolRegistry !== 'undefined' && toolRegistry.isAgentOnly
                        ? toolRegistry.isAgentOnly(_ftName)
                        : AGENT_ONLY_KEYS.indexOf(_toggleKey) >= 0 || AGENT_ONLY_KEYS.indexOf(_oldKey || '') >= 0;
                    if (!_agentOn && _isAgentOnly) {
                            if (_hasAskAgent) {
                                _filteredTools.push(_ft);  // ask_agent 同行 → 全部 Agent 工具放行
                            }
                            // 无 ask_agent → 过滤
                        } else {
                            _filteredTools.push(_ft);
                        }
                } else if (_ftName.startsWith('impl_') || _ftName.startsWith('custom_')) {
                    // 自定义技能: 用 CUSTOM_SKILL_ 前缀检查
                    if (window.isToolEnabled('CUSTOM_SKILL_' + _ftName)) {
                        _filteredTools.push(_ft);
                    }
                } else {
                    // 未知工具: 用 toolName 直接查开关, 未找到时默认启用
                    if (window.isToolEnabled(_ftName)) {
                        _filteredTools.push(_ft);
                    }
                }
            }
            if (_filteredTools.length < tools.length) {
                console.log('[ToolToggle] 过滤掉', tools.length - _filteredTools.length, '个工具');
                tools = _filteredTools;
                if (tools.length === 0) {
                    console.log('[ToolToggle] 所有工具均被禁用,跳过工具注册');
                    delete body.tools;
                    delete body.tool_choice;
                }
            }
            // ★ 暴露映射供 renderToolPanel 自动发现新工具
            window._toolToggleMap = _toolFuncNameToToggleKey;
        })();
        // ★ 检查模型是否已在"不支持工具"列表中(自动降级 + 模型配置内置)
        var _noToolModels = JSON.parse(localStorage.getItem('noToolModels') || '[]');
        // 匹配方式: 列表中的模式如果出现在模型名中就算匹配
        var _matchedLocal = false;
        for (var _nti = 0; _nti < _noToolModels.length; _nti++) {
            if (modelLower.indexOf(_noToolModels[_nti]) !== -1) {
                _matchedLocal = true;
                break;
            }
        }
        // 同时检查模型配置中是否内置为 no-tool
        var _cfgBuiltinNoTool = false;
        try { _cfgBuiltinNoTool = _getModelCfg().isNoToolsBuiltin(currentModel); } catch(e) {}
        var _isInNoToolList = _matchedLocal || _cfgBuiltinNoTool;
        if (!_isInNoToolList) {
            // ★ MiniMax M3: 限制工具数量避免 422 (MiniMax 支持 ~50 个工具)
            if (modelLower.includes('m3') || modelLower.includes('minimax-m3')) {
                if (tools.length > 50) {
                    console.warn('[M3] 工具数 ' + tools.length + ' > 50, 截断前50');
                    tools = tools.slice(0, 50);
                }
            }
            // ★ Anthropic 格式工具转换: 所有 Anthropic Messages API 统一用 Anthropic-format tools
            if (_useAnthropicFormat) {
                body.tools = tools.map(function(t) {
                    return {
                        name: t.function.name,
                        description: t.function.description || '',
                        input_schema: t.function.parameters || { type: 'object', properties: { _dummy: { type: 'string', description: 'unused' } } }
                    };
                });
            } else {
                body.tools = tools;
            }
            if (!_useAnthropicFormat && (_effectiveAgent || !isMiniMaxModel)) body.tool_choice = "auto";
        } else {
            console.log('[Model]', model, '在 no-tool 列表中,跳过工具注册');
        }
    }
    }
    // ★ Anthropic 格式最终处理
    if (_useAnthropicFormat) {
        if (_aSysContent) body.system = _aSysContent;
        // ★ Anthropic Messages API 端点:
        //   原生 Anthropic: baseUrl + /messages
        //   其他 (DeepSeek等): baseUrl + /anthropic/v1/messages (自动拼接)
        var _baseUrl2 = getVal('baseUrl');
        var _baseClean = _baseUrl2.replace(/\/+$/, '');
        if (_isNativeAnthropic) {
            delete body.tool_choice;
            body._anthropicUrl = _baseClean.replace(/\/v1\/?$/, '') + '/v1/messages';
        } else if (_baseUrl2.indexOf('api.longcat.chat') >= 0) {
            // LongCat: OpenAI /openai/v1/chat → Anthropic /anthropic/v1/messages
            delete body.tool_choice;
            body._anthropicUrl = _baseClean.replace(/\/openai\/v1\/?$/, '') + '/anthropic/v1/messages';
        } else {
            // DeepSeek/MiniMax 等: 去 /v1, 拼 /anthropic/v1/messages
            delete body.tool_choice;
            body._anthropicUrl = _baseClean.replace(/\/v1\/?$/, '').replace(/\/anthropic\/?$/, '') + '/anthropic/v1/messages';
        }
        delete body.stream_options;
        // ★ 预检清除空 tool_use_id 的 tool_result（防止 400）
        // ★ 清理 OpenAI-specific 字段 (Anthropic API 不接受)
        for (var _prei = 0; _prei < body.messages.length; _prei++) {
            var _prem = body.messages[_prei];
            // 移除 OpenAI 特有字段
            delete _prem.reasoning_content;
            delete _prem.reasoning_details;
            delete _prem.tool_call_id;
            if (_prem.role === 'assistant') {
                delete _prem.tool_calls;  // 已转为 tool_use 块
                delete _prem.refusal;
            }
            if (_prem.role === 'user' && Array.isArray(_prem.content)) {
                _prem.content = _prem.content.filter(function(c) {
                    if (c.type === 'tool_result' && (!c.tool_use_id || c.tool_use_id === '')) {
                        console.warn('[Anthropic] 预检移除空 tool_use_id 的 tool_result');
                        return false;
                    }
                    return true;
                });
            }
        }
        // ★ 移除完全空的用户消息
        body.messages = body.messages.filter(function(m) {
            return !(m.role === 'user' && Array.isArray(m.content) && m.content.length === 0);
        });
    }

    // ★ modelName 提升到函数作用域,以便后续 sanitizeBody 和 agent 代码使用
    var modelName = currentModel || getVal('modelSelect') || '';

    if (getChecked('customParamsToggle')) {
        try {
            // MiniMax 不支持部分 OpenAI 参数,过滤掉以避免 2013 错误
            // ★ 模型配置:使用模型专属约束过滤 custom params
            var _mcParamsBanned = _getModelCfg().getBannedParams(modelName);
            let customParams = {};
            try { customParams = JSON.parse(getVal('customParams') || '{}'); } catch(e) {}
            if (_mcParamsBanned.length) {
                _mcParamsBanned.forEach(function(p) { delete customParams[p]; delete body[p]; });
            }
            Object.assign(body, customParams);
        } catch { /* 忽略 */ }
    }

    // ★ Agent 模式: 如果本轮创建了子代理,禁止模型继续说话
    window._hasCreatedSubAgent = false;  // ★ 全局可写（tools-exec.js 中赋值），此处重置

    // ★ 思考强度分级已在 body 构建阶段全局应用 (覆盖 Agent/普通聊天)
    // 模型配置:集中清理 body 中模型不支持的参数
    _getModelCfg().sanitizeBody(modelName, body);
    // LongCat 模型名收敛 (思考强度已由统一逻辑处理)
    if (_isLongCatRequest) {
        body.model = 'LongCat-2.0';
    }

    // ★ 图像模型需要更长超时 (生成图片可达 2-15 分钟)
    var _isImageModel = modelName.toLowerCase().indexOf('image') !== -1
        || modelName.toLowerCase().indexOf('dall-e') !== -1
        || modelName.toLowerCase().indexOf('imagen') !== -1
        || modelName.toLowerCase().indexOf('flux') !== -1;
    // ★ 图像模型: 强制非流式 + 清理历史 base64 图片
    if (_isImageModel) {
        // ★ 图像模型不能流式 (流式不返回图片数据)
        body.stream = false;
        // ★ 添加 modalities 和 image_config (GPT Image 模型必须)
        if (!body.modalities) {
            body.modalities = ['image', 'text'];
        }
        if (!body.image_config) {
            var _imgSize = localStorage.getItem('imageSize') || '1K';
            var _imgRatio = localStorage.getItem('imageAspectRatio') || '1:1';
            body.image_config = {
                aspect_ratio: _imgRatio,
                image_size: _imgSize
            };
        }
        // 限制 max_tokens 防止 context overflow (模型配置已设 256000,这是安全帽)
        if (requestedTokens > 1000000) {
            requestedTokens = 1000000;
            body.max_tokens = 1000000;
        }
        // 清理对话历史中的 base64 图片数据 (大量 token，会导致 context overflow)
        if (body.messages) {
            for (var _imi = 0; _imi < body.messages.length; _imi++) {
                var _imm = body.messages[_imi];
                if (typeof _imm.content === 'string') {
                    _imm.content = _imm.content.replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]{100,}/g, '[图片]');
                } else if (Array.isArray(_imm.content)) {
                    _imm.content = _imm.content.map(function(c) {
                        if (c.type === 'image_url' && c.image_url && c.image_url.url) {
                            if (c.image_url.url.startsWith('data:')) return {type:'text',text:'[图片]'};
                        }
                        return c;
                    });
                }
            }
        }
    }
    // ★ MiniMax M3: 复杂工具调用需要更长时间
    var _timeoutSec = parseInt(getVal('requestTimeout')) || 120;
    if (modelLower.includes('minimax-m3') || modelLower.includes('minimax')) _timeoutSec = Math.max(_timeoutSec, 180);
    if (_isLongCatRequest) _timeoutSec = Math.max(_timeoutSec, 600);
    var timeout = _isImageModel ? 900000 : _timeoutSec * 1000;
    var timeoutId = setTimeout(() => abortMain.abort(), timeout);
    window._activeRequestTimeoutId = timeoutId;  // ★ 供审批弹窗暂停用
    var startTime = Date.now();

    // 网络错误重试配置
    var maxRetries = 3;
    var _longCatPlainRetryUsed = false;
    // Agent 模式使用自定义最大工具调用轮次
    var maxToolCalls = parseInt(localStorage.getItem('agentMaxToolRounds')) || 1000;
    let toolCallCount = 0;

    // ★ 死循环检测: 会话级 LoopGuard(跨轮共享, 400/402 重试与工具轮递归共用同一实例)
    // 小参数模型易陷入工具复读/文本复读死循环烧 token, 详见 loop-guard.js
    window.__loopGuardMap = window.__loopGuardMap || {};
    var _guardCfg = {
        enabled: localStorage.getItem('loopGuardEnabled') !== 'false',
        maxRepeat: parseInt(localStorage.getItem('loopGuardMaxRepeat')) || 3,
        maxToolOnlyRounds: parseInt(localStorage.getItem('loopGuardMaxToolOnlyRounds')) || 6
    };
    window.__loopGuardMap[chatId] = new window.LoopGuard(_guardCfg);
    var _guard = window.__loopGuardMap[chatId];

    // 离线检测
    if (!navigator.onLine) {
        clearTimeout(timeoutId);
        handleError(new Error('网络已断开,请检查网络连接后重试。'), chatId, pendingMsg, currentBubble);
        return;
    }

    // 初始调用使用 abortMain,后续重试使用新的 AbortController
    // ★ 全局工具调用参数修复:发送前确保所有 arguments 是合法 JSON
    function _fixAllToolCalls(msgs) {
        for (var i = 0; i < msgs.length; i++) {
            var m = msgs[i];
            if (m.role === 'assistant' && m.tool_calls) {
                for (var j = 0; j < m.tool_calls.length; j++) {
                    var tc = m.tool_calls[j];
                    if (tc.function && typeof tc.function.arguments === 'string') {
                        var raw = tc.function.arguments;
                        try { JSON.parse(raw); } catch(e) {
                            // ★ 修复非法 JSON(未转义引号/换行/截断), 修复失败才降级空对象
                            try { raw = repairToolArguments(raw); JSON.parse(raw); } catch(e2) { raw = '{}'; }
                            tc.function.arguments = raw;
                        }
                    }
                }
            }
        }
    }
    // ★ 终极修复:在发送前对 body 中所有 tool_calls 的 arguments 做 parse+stringify 重编码
    _fixAllToolCalls(body.messages);
    // 附加:对 MiniMax 流式产生的 arguments 做深度重编码
    for (var _mi = 0; _mi < body.messages.length; _mi++) {
        var _mm = body.messages[_mi];
        if (_mm.role === 'assistant' && _mm.tool_calls) {
            for (var _tj = 0; _tj < _mm.tool_calls.length; _tj++) {
                var _tc = _mm.tool_calls[_tj];
                if (_tc.function && typeof _tc.function.arguments === 'string') {
                    try {
                        var _parsed = JSON.parse(_tc.function.arguments);
                        _tc.function.arguments = JSON.stringify(_parsed);
                    } catch(e) {
                        _tc.function.arguments = JSON.stringify(tolerantToolInput(_tc.function.name, _tc.function.arguments) || {});
                    }
                }
            }
        }
    }

    /** 解析 Anthropic API 响应（支持流式 SSE + 非流式 JSON） */
    async function _parseAnthropicResponse(res, chatId, pendingMsg, currentBubble) {
        let _fullText = '';
        let _reasoningText = '';
        var _toolCalls = [];
        var _usage = null;
        var _truncated = false;
        var _stopReason = '';
        console.log('[A-Stream] status=' + res.status + ' content-type=' + (res.headers.get('content-type') || '?'));

        // ★ 流式 SSE 解析 (Anthropic API 默认流式，非流式极少用)
        var _contentType = res.headers.get('content-type') || '';
        if (!_contentType.includes('application/json') || _contentType.includes('stream')) {
            var _reader = res.body.getReader();
            var _decoder = new TextDecoder();
            var _buf = '';
            var _currentBlockIdx = -1;
            var _currentBlockType = '';
            var _toolUseIdx = -1;
            var _toolUseMap = {}; // index → {id, name, input_json, incomplete}
            var _done = false;
            var _hadIncompleteToolUse = false;
            // SSE 的 event/data 可能落在不同 TCP chunk；事件名必须跨 read() 保留。
            var _event = '';

            while (!_done) {
                var _rr = await _reader.read();
                if (_rr.done) break;
                _buf += _decoder.decode(_rr.value, {stream: true});
                var _lines = _buf.split('\n');
                _buf = _lines.pop() || '';

                for (var _li = 0; _li < _lines.length; _li++) {
                    var _ln = _lines[_li].trim();
                    if (!_ln) continue;
                    if (_ln.startsWith('event:')) { _event = _ln.substring(6).trim(); continue; }
                    if (!_ln.startsWith('data:')) continue;
                    var _js = _ln.substring(5).trim();
                    try {
                        var _d = JSON.parse(_js);
                        // 部分兼容端点只在 JSON 中携带 type，不发送 event: 行。
                        var _eventType = _event || _d.type || '';

                        if (_eventType === 'message_start' || !_eventType) {
                            if (_d.message && _d.message.usage) {
                                _usage = { prompt_tokens: _d.message.usage.input_tokens || 0, completion_tokens: 0, total_tokens: _d.message.usage.input_tokens || 0 };
                            }
                        } else if (_eventType === 'content_block_start') {
                            var _cb = _d.content_block;
                            if (_cb) {
                                _currentBlockIdx = _d.index;
                                _currentBlockType = _cb.type;
                                if (_cb.type === 'tool_use') {
                                    _toolUseIdx = _d.index;
                                    console.log('[A-Tool] tool_use block_start index=' + _d.index + ' cb.id=' + _cb.id + ' cb.name=' + _cb.name);
                                    // ★ 部分 Provider 在 block_start 直接带完整 input(无 input_json_delta), 不能丢
                                    var _seedInput = '';
                                    if (_cb.input !== undefined && _cb.input !== null) {
                                        if (typeof _cb.input === 'string') _seedInput = _cb.input;
                                        else if (typeof _cb.input === 'object' && Object.keys(_cb.input).length > 0) _seedInput = JSON.stringify(_cb.input);
                                    }
                                    _toolUseMap[_d.index] = { id: _cb.id || ('toolu_' + Date.now() + '_' + _d.index), name: _cb.name, input_json: _seedInput, incomplete: false };
                                }
                            }
                        } else if (_eventType === 'content_block_delta') {
                            var _delta = _d.delta;
                            if (_delta) {
                                if (_delta.type === 'text_delta') {
                                    _fullText += _delta.text;
                                    pendingMsg.content = _fullText;
                                    if (currentChatId === chatId) applyStreamRender(chatId, _fullText);
                                } else if (_delta.type === 'thinking_delta') {
                                    _reasoningText += _delta.thinking;
                                    pendingMsg.reasoning = _reasoningText;
                                    // ★ 实时渲染推理面板（与 OpenAI 路径一致）
                                    if (currentChatId === chatId && currentBubble && typeof window._ensureReasoningPanel === 'function') {
                                        window._ensureReasoningPanel(currentBubble, _reasoningText);
                                    }
                                } else if (_delta.type === 'input_json_delta') {
                                    // ★ 按块 index 归位(兼容多个 tool_use 交错/顺序乱序), 不再依赖单一 _toolUseIdx
                                    var _deltaIdx = _d.index !== undefined ? _d.index : _toolUseIdx;
                                    if (_deltaIdx >= 0 && _toolUseMap[_deltaIdx]) {
                                        _toolUseMap[_deltaIdx].input_json += _delta.partial_json || '';
                                    }
                                }
                            }
                        } else if (_eventType === 'content_block_stop') {
                            var _stopIdx = _d.index !== undefined ? _d.index : _toolUseIdx;
                            if (_stopIdx >= 0 && _toolUseMap[_stopIdx]) {
                                var _tu = _toolUseMap[_stopIdx];
                                if (!_tu.incomplete) {
                                    var _rawInput = (_tu.input_json || '').trim();
                                    var _input = {};
                                    var _parseOk = false;
                                    if (!_rawInput) {
                                        // 没有任何 input 数据 → 视为截断/异常, 不执行空调用
                                        _tu.incomplete = true;
                                    } else {
                                        try { _input = JSON.parse(_rawInput); _parseOk = true; } catch(e) {}
                                        if (!_parseOk) {
                                            var _looksClosed = _rawInput.endsWith('}') || _rawInput.endsWith(']');
                                            if (_looksClosed) {
                                                // 完整但格式损坏(未转义引号等) → 容错修复(保持原有行为)
                                                var _rep = tolerantToolInput(_tu.name, _rawInput) || {};
                                                if (Object.keys(_rep).length > 0) _input = _rep;
                                                else _tu.incomplete = true;
                                            } else {
                                                // ★ 截断: input 未闭合(如只有 {"cmd": 或 {"cmd": "abc), 绝不能执行
                                                _tu.incomplete = true;
                                            }
                                        }
                                    }
                                }
                                if (_tu.incomplete) {
                                    _hadIncompleteToolUse = true;
                                    console.warn('[A-Stream] tool_use 未完成(可能被截断), 丢弃: ' + _tu.name + ' input=' + JSON.stringify((_tu.input_json || '').substring(0, 120)));
                                } else {
                                    _toolCalls.push({ id: _tu.id, type: 'function', function: { name: _tu.name, arguments: JSON.stringify(_input) } });
                                }
                                if (_stopIdx === _toolUseIdx) _toolUseIdx = -1;
                            }
                        } else if (_eventType === 'message_delta') {
                            if (_d.delta && _d.delta.stop_reason) {
                                _done = true;
                                _stopReason = _d.delta.stop_reason;
                                if (_stopReason === 'max_tokens' || _stopReason === 'length') _truncated = true;
                            }
                            if (_d.usage) {
                                if (_usage) _usage.completion_tokens = _d.usage.output_tokens || 0;
                                else _usage = { prompt_tokens: 0, completion_tokens: _d.usage.output_tokens || 0, total_tokens: _d.usage.output_tokens || 0 };
                            }
                        } else if (_eventType === 'message_stop') {
                            _done = true;
                        } else if (_eventType === 'ping') {
                            // heartbeat, ignore
                        }
                    } catch(e) {}
                    // 一个 data: 记录消费完即结束当前 SSE event；若 event/data 被拆包，
                    // 这里会在 data 真正到达后才重置。
                    _event = '';
                }
            }
            try { _reader.releaseLock(); } catch(e) {}
            if (_truncated || _hadIncompleteToolUse) {
                // ★ 兜底: 模型把工具调用写在正文 XML/文本里(原生 tool_use 为空/截断)时, 从正文恢复
                var _txtRecover = (typeof _extractTextToolCalls === 'function') ? _extractTextToolCalls(_fullText) : null;
                if (_txtRecover && _txtRecover.toolCalls && _txtRecover.toolCalls.length > 0) {
                    _toolCalls = _toolCalls.concat(_txtRecover.toolCalls);
                    _fullText = _txtRecover.fullText;
                    if (pendingMsg) pendingMsg.content = _fullText;
                    console.log('[A-Stream] 从正文XML/文本恢复工具调用 ' + _txtRecover.toolCalls.length + ' 个: ' + _txtRecover.toolCalls.map(function(t){return t.function.name;}).join(','));
                }
            }
            console.log('[A-Stream] done stop_reason=' + (_stopReason || '?') + ' truncated=' + _truncated + ' toolCalls=' + _toolCalls.length + ' hadIncomplete=' + _hadIncompleteToolUse);
            return { fullText: _fullText, reasoningText: _reasoningText, usage: _usage, toolCalls: _toolCalls, streamAborted: _truncated, truncated: _truncated, stopReason: _stopReason };
        }

        // ★ 非流式 JSON 解析
        try {
            var _data = await res.json();
            _stopReason = _data.stop_reason || '';
            _truncated = _stopReason === 'max_tokens' || _stopReason === 'length';
            if (_data.usage) {
                _usage = { prompt_tokens: _data.usage.input_tokens || 0, completion_tokens: _data.usage.output_tokens || 0, total_tokens: (_data.usage.input_tokens || 0) + (_data.usage.output_tokens || 0) };
            }
            if (_data.content && Array.isArray(_data.content)) {
                for (var _ci = 0; _ci < _data.content.length; _ci++) {
                    var _block = _data.content[_ci];
                    if (_block.type === 'text') { _fullText += _block.text; }
                    else if (_block.type === 'thinking') { _reasoningText += _block.thinking; }
                    else if (_block.type === 'tool_use') {
                        var _blkInput = _block.input;
                        var _blkParsed = {};
                        if (typeof _blkInput === 'string') {
                            try { _blkParsed = JSON.parse(_blkInput || '{}'); } catch(e) { _blkParsed = tolerantToolInput(_block.name, _blkInput) || {}; }
                        } else if (_blkInput && typeof _blkInput === 'object') {
                            _blkParsed = _blkInput;
                        }
                        // 非流式截断(max_tokens)时同样不执行空/残缺 tool_use
                        var _blkTruncated = (_data.stop_reason === 'max_tokens' || _data.stop_reason === 'length');
                        if (_blkTruncated && Object.keys(_blkParsed).length === 0) {
                            console.warn('[A-Stream] 非流式响应被截断, 丢弃空 tool_use: ' + _block.name);
                            _truncated = true;
                            continue;
                        }
                        _toolCalls.push({ id: _block.id || ('toolu_' + Date.now()), type: 'function', function: { name: _block.name, arguments: JSON.stringify(_blkParsed) } });
                    }
                }
            }
            if (_fullText) { pendingMsg.content = _fullText; if (currentChatId === chatId) applyStreamRender(chatId, _fullText); }
            if (_reasoningText) { pendingMsg.reasoning = _reasoningText; }
            if (_truncated) {
                var _txtRecover2 = (typeof _extractTextToolCalls === 'function') ? _extractTextToolCalls(_fullText) : null;
                if (_txtRecover2 && _txtRecover2.toolCalls && _txtRecover2.toolCalls.length > 0) {
                    _toolCalls = _toolCalls.concat(_txtRecover2.toolCalls);
                    _fullText = _txtRecover2.fullText;
                    if (pendingMsg) pendingMsg.content = _fullText;
                    console.log('[A-Stream] 非流式: 从正文恢复工具调用 ' + _txtRecover2.toolCalls.length + ' 个');
                }
            }
        } catch(e) {
            throw new Error('Anthropic 响应解析失败: ' + e.message);
        }
        return { fullText: _fullText, reasoningText: _reasoningText, usage: _usage, toolCalls: _toolCalls, streamAborted: _truncated, truncated: _truncated, stopReason: (_data && _data.stop_reason) || '' };
    }

    // LongCat 的思考预算耗尽时会合法结束，但只返回 reasoning、正文为空。
    // ★ 保留推理内容直接展示，不丢弃推理去 retry（用户宁可看到推理也不愿它消失）
    function _retryLongCatWithoutThinking(attempt, timeoutIdVal) {
        _longCatPlainRetryUsed = true;
        body.thinking = { type: 'disabled' };
        // ★ 不清除推理面板和内容，直接返回空结果让上层保留已有推理展示
        console.warn('[LongCat] 正文为空，保留推理直接展示（不 retry）');
        return { fullText: '', reasoningText: pendingMsg.reasoning || '', usage: null, toolCalls: [], streamAborted: false };
    }

    async function attemptRequestWithFreshAbort(attempt, abortCtrl, timeoutIdVal) {
        // ★ 死循环检测参数解析(容错: JSON 非法时用原始串, 规范化内部会再处理)
        function _parseGuardArgs(argStr) {
            try { return JSON.parse(argStr); } catch(e) { return argStr; }
        }
        // ★ 死循环检测硬中止: 中止在途请求 + 抛出带标记错误, 由外层 catch 分发处理
        function _throwGuardHard(chk, chatIdForErr) {
            try { if (abortControllerMap[chatIdForErr]) abortControllerMap[chatIdForErr].abort(); } catch(_abErr) {}
            console.warn('[LoopGuard] 硬中止:', chk.type, chk.reason);
            var _lgErr = new Error('检测到模型死循环已自动中止: ' + chk.reason);
            _lgErr.loopGuard = chk;
            _lgErr.name = 'LoopGuardError';
            throw _lgErr;
        }
        try {
            // ★ LongCat 清洗: 每次发送前都检查并清洗 (包括工具重试路径)
            if (_isLongCatRequest && !_useAnthropicFormat && body.messages && typeof window.sanitizeForLongCat === 'function') {
                body.messages = window.sanitizeForLongCat(body.messages);
            }
            // ★ 清理空 tool_calls:[] — DeepSeek API 拒绝 empty array (每次重试都检查)
            if (body.messages) {
                for (var _etci2 = 0; _etci2 < body.messages.length; _etci2++) {
                    var _em3 = body.messages[_etci2];
                    if (_em3.role === 'assistant' && _em3.tool_calls !== undefined && _em3.tool_calls !== null) {
                        if (!Array.isArray(_em3.tool_calls) || _em3.tool_calls.length === 0) {
                            delete _em3.tool_calls;
                        }
                    }
                }
            }
            // ★ 修复: 确保每个 tool_calls 都有对应的 tool response (DeepSeek API 要求)
            if (body.messages) {
                var _pendingToolCallIds = {};  // tool_call_id -> 是否已回复
                for (var _ti2 = 0; _ti2 < body.messages.length; _ti2++) {
                    var _msg2 = body.messages[_ti2];
                    if (_msg2.role === 'assistant' && _msg2.tool_calls && _msg2.tool_calls.length > 0) {
                        for (var _ci = 0; _ci < _msg2.tool_calls.length; _ci++) {
                            var _callId = _msg2.tool_calls[_ci] && _msg2.tool_calls[_ci].id;
                            if (_callId) _pendingToolCallIds[_callId] = true;
                        }
                    } else if (_msg2.role === 'tool' && _msg2.tool_call_id) {
                        delete _pendingToolCallIds[_msg2.tool_call_id];
                    }
                }
                // 如果有未回复的 tool_calls, 删除这些 assistant 消息的 tool_calls
                var _orphanedCount = Object.keys(_pendingToolCallIds).length;
                if (_orphanedCount > 0) {
                    console.warn('[SafeSend] 发现', _orphanedCount, '个未回复的 tool_calls, 自动清理');
                    for (var _ti3 = 0; _ti3 < body.messages.length; _ti3++) {
                        var _msg3 = body.messages[_ti3];
                        if (_msg3.role === 'assistant' && _msg3.tool_calls) {
                            // 只保留有回复的 tool_calls
                            _msg3.tool_calls = _msg3.tool_calls.filter(function(_tc) {
                                return !_tc.id || !_pendingToolCallIds[_tc.id];
                            });
                            if (_msg3.tool_calls.length === 0) {
                                delete _msg3.tool_calls;
                            }
                        }
                    }
                }
            }
            // ★ 终极防护: 每次发送前检查 no-tool 列表,确保不发送 tools
            var _curSendModel = getVal('modelSelect') || '';
            var _curSendLower = _curSendModel.toLowerCase();
            var _noToolSend = JSON.parse(localStorage.getItem('noToolModels') || '[]');
            // 匹配方式: 列表中的模式如果出现在模型名中就算匹配(如 'deepseek-r1' 匹配 'deepseek-r1:latest')
            var _matchedNoTool = false;
            for (var _noi = 0; _noi < _noToolSend.length; _noi++) {
                if (_curSendLower.indexOf(_noToolSend[_noi]) !== -1) {
                    _matchedNoTool = true;
                    break;
                }
            }
            // 也检查模型配置
            if (!_matchedNoTool) {
                try { _matchedNoTool = _getModelCfg().isNoToolsBuiltin(_curSendModel); } catch(e) {}
            }
            if (_matchedNoTool) {
                if (body.tools) {
                    console.log('[SafeSend] 模型', _curSendModel, '在 no-tool 列表,剥离 tools');
                    delete body.tools;
                    delete body.tool_choice;
                    // 同时清理消息中的 tool_calls
                    if (body.messages) {
                        for (var _ssi = 0; _ssi < body.messages.length; _ssi++) {
                            if (body.messages[_ssi].role === 'assistant') {
                                delete body.messages[_ssi].tool_calls;
                            }
                        }
                    }
                }
            }

            // ★ MiniMax 直连: 自定义 URL 和 API Key
            var _fallbackAUrl = getVal('baseUrl').replace(/\/+$/, '').replace(/\/v1\/?$/, '').replace(/\/anthropic\/?$/, '') + '/anthropic/v1/messages';
            var _reqUrl = _useAnthropicFormat ? (body._anthropicUrl || _fallbackAUrl) : getVal('baseUrl') + '/chat/completions';
            // ★ 保留 body._anthropicUrl 供重试使用
            var _reqBody = JSON.parse(JSON.stringify(body));
            // 统一声明,后续两个分支都会赋值
            let usage = null;
            let toolCalls = [];
            // 清理日志中的敏感信息
            if (_reqBody.messages) _reqBody.messages = _reqBody.messages.length + ' messages';
            console.log('[API-REQ] model:', body.model, 'stream:', !!_reqBody.stream, 'tools:', (_reqBody.tools||[]).length, 'msgs:', body.messages.length);

            // ★ 硬编码终极防护: 已知不支持工具的模型直接剥离 tools
            var _modelStr = (body.model || '').toLowerCase();
            var _noToolKeywords = ['deepseek-r1', 'deepseek-reasoner', 'qwq',
                'gpt-5.4-image', 'gpt-4o-image', 'image-01', 'image-02', 'dall-e', 'dalle', 'imagen'];
            if (body.tools && _noToolKeywords.some(function(k){return _modelStr.indexOf(k) !== -1;})) {
                console.log('[HARD-SAFE] 模型', body.model, '禁止工具,硬编码移除');
                delete body.tools;
                delete body.tool_choice;
                if (body.messages) {
                    for (var _hsi = 0; _hsi < body.messages.length; _hsi++) {
                        if (body.messages[_hsi].role === 'assistant') {
                            delete body.messages[_hsi].tool_calls;
                        }
                    }
                }
            }

            // ★ 发送前验证所有消息 content 字段
            if (body.messages) {
                window.___assignedTcIds = {}; // ★ 每次请求重置 ID 分配追踪
                for (var _viFix = 0; _viFix < body.messages.length; _viFix++) {
                    var _mFix = body.messages[_viFix];
                    if (!_mFix.content && _mFix.content !== 0) {
                        console.warn('[FIX] messages[' + _viFix + '] missing content, role=' + _mFix.role);
                        _mFix.content = '(empty)';
                    }
                    if (_mFix.role === 'tool' && !_mFix.tool_call_id) {
                        // ★ 向前查找匹配的 tool_calls ID（不能用随机 fake ID）
                        // ★ 追踪已分配的 ID，防止多个孤儿 tool 消息共用同一 ID 导致 400
                        if (!window.___assignedTcIds) window.___assignedTcIds = {};
                        for (var _tli2 = _viFix - 1; _tli2 >= 0; _tli2--) {
                            var _prevM = body.messages[_tli2];
                            if (_prevM.role === 'assistant' && _prevM.tool_calls) {
                                for (var _ttj = _prevM.tool_calls.length - 1; _ttj >= 0; _ttj--) {
                                    var _candId = _prevM.tool_calls[_ttj].id;
                                    if (_candId && !window.___assignedTcIds[_candId]) {
                                        _mFix.tool_call_id = _candId;
                                        window.___assignedTcIds[_candId] = true;
                                        console.warn('[FIX] tool_call_id 自动匹配:', _mFix.tool_call_id);
                                        break;
                                    }
                                }
                                if (_mFix.tool_call_id) break;
                            }
                        }
                        // 找不到匹配 → 删除这条 tool 消息（保留会 400）
                        if (!_mFix.tool_call_id) {
                            _mFix._remove = true;
                            console.warn('[FIX] tool_call_id 无法匹配，标记删除');
                        }
                    }
                }
            }
            // ★ 删除标记为 _remove 的消息
            body.messages = body.messages.filter(function(m) { return !m._remove; });

            // ★ 清理空 tool_calls:[] — DeepSeek API 严格拒绝 empty array
            for (var _etci = 0; _etci < body.messages.length; _etci++) {
                var _em2 = body.messages[_etci];
                if (_em2.role === 'assistant' && _em2.tool_calls !== undefined && _em2.tool_calls !== null) {
                    if (!Array.isArray(_em2.tool_calls) || _em2.tool_calls.length === 0) {
                        delete _em2.tool_calls;
                    }
                }
            }

            // ★ 可恢复流式: 开关打开时走后端引擎
            // ★ MiniMax 模型强制流式（非流式工具调用容易超时/中断）
            var useStream = _isImageModel ? false : getChecked('streamToggle');
            // ★ 可恢复流式：默认启用（引擎后端管理 LLM 流，刷新断点续传）
            // 用户可设置 __enableResumeStream='0' 显式禁用
            var _rsEnabled = (localStorage.getItem('__enableResumeStream') !== '0');
            // ★ 工具链的每一轮都建立独立可恢复流。旧版第 9 轮后退回直连，
            // 深工具链恰好在后半段刷新时仍会中断，违背“刷新不断”的语义。
            // ★ Anthropic 格式也支持 RS (引擎新增Anthropic Messages API流式分支)
            var _useRS = _rsEnabled;
            if (_useRS) {
                // ★ 先持久化用户消息到服务器，防止刷新丢失
                saveChats();
                // ★ 通过引擎后端创建可恢复流，刷新/断线后无感续接
                var _rsResult = await ResumeStream.create(
                    body.messages,
                    { model: body.model, apiKey: getVal('apiKey'), baseUrl: getVal('baseUrl'),
                      temp: body.temperature, tokens: body.max_tokens, tools: body.tools,
                      // ★ Anthropic格式: 传递标志+端点,使RS也支持Anthropic Messages API
                      anthropicFormat: _useAnthropicFormat,
                      anthropicUrl: body._anthropicUrl || '',
                      system: body.system || '',
                      thinking: body.thinking || null },
                    chatId, pendingMsg
                );
                console.log('[RS-DEBUG] _rsResult:', _rsResult ? ('fullText=' + (_rsResult.fullText||'').substring(0,60) + ' toolCalls=' + (_rsResult.toolCalls||[]).length + ' completed=' + _rsResult.completed + ' error=' + (_rsResult.error||'none')) : 'NULL');
                // ★ 停止键: 用户停止时不回退直连(否则会重新发请求继续生成)
                if (_rsResult && _rsResult.aborted) {
                    console.warn('[RS] 用户已停止, 不再回退直连');
                    if (userAbortMap[chatId]) throw new Error('用户停止');
                    throw new Error('RS: 流已中断');
                }
                // LongCat 开启思考后可能在 max_tokens 内只产出 reasoning、正文为空。
                // ★ 保留推理内容直接展示，不丢弃推理去 retry（用户宁可看到推理也不愿它消失）
                if (_rsResult && _isLongCatRequest && _rsResult.reasoningText
                    && !_rsResult.fullText && !(_rsResult.toolCalls && _rsResult.toolCalls.length)) {
                    console.warn('[LongCat] 仅收到思考内容，保留推理直接展示（不 retry）');
                    body.thinking = { type: 'disabled' };
                }
                if (_rsResult && (_rsResult.fullText || (_rsResult.toolCalls && _rsResult.toolCalls.length > 0))) {
                    if (!_rsResult.completed) {
                        if (_rsResult.error) {
                            var _rsErrStr = typeof _rsResult.error === 'string' ? _rsResult.error : JSON.stringify(_rsResult.error);
                            // 400/网络错误: 回退HTTP直连重试
                            if (_rsErrStr.includes('400') || _rsErrStr.includes('Content Exists Risk') || _rsErrStr.includes('sensitive') || _rsErrStr.includes('422') || _rsErrStr.includes('Connection error') || _rsErrStr.includes('connect') || _rsErrStr.includes('timeout')) {
                                console.warn('[RS] 引擎连接失败(' + _rsErrStr + '), 回退HTTP直连重试'); window.__rsFallbackRetry = true;
                                _useRS = false;
                                var _rsDone = false;
                            } else {
                                throw new Error('RS: ' + _rsErrStr);
                            }
                        } else {
                            console.warn('[RS] 流未正常完成(中断/刷新), 回退到 HTTP 直连');
                            _useRS = false;
                            var _rsDone = false;
                        }
                    } else {
                        // 引擎流成功完成 — 直接使用引擎结果，跳过 HTTP 直连
                        usage = _rsResult.usage;
                        toolCalls = _rsResult.toolCalls || [];
                        // 当前批次先放在恢复字段中；下方完成标准化后再按 id 合并进
                        // pendingMsg.tool_calls，避免非法 id 清洗前后各留一份重复调用。
                        pendingMsg._rsToolCalls = toolCalls;
                        if (_rsResult.reasoningText) pendingMsg.reasoning = _rsResult.reasoningText;
                        // ★ 图像模型: 进度条清除
                        try { var _ph = document.getElementById('image-placeholder'); if (_ph) _ph.remove(); } catch(e) {}
                        clearTimeout(timeoutIdVal);
                        // ★ 设置 _rsDone 标记跳过 HTTP 直连路径，但继续工具调用处理
                        var _rsDone = true;
                        // ★ 完成 partial 标记并保存(RS 路径跳过 HTTP 块,需在此处持久化)
                        delete pendingMsg.partial;
                        pendingMsg.time = Date.now() - startTime;
                        pendingMsg.usage = usage;
                        saveChats(true);  // ★ 强制服务器保存+广播到其他设备
                        // ★ 多端同步: 广播 RS 完成到其他设备
                        if (typeof window._broadcastChatUpdate === 'function') {
                            window._broadcastChatUpdate(chatId);
                        }
                    }
                } else {
                    if (_rsResult && _rsResult.error) {
                        var _rsErrStr2 = typeof _rsResult.error === 'string' ? _rsResult.error : JSON.stringify(_rsResult.error);
                        // 400安全过滤: 回退HTTP直连走safety_filter重试
                        if (_rsErrStr2.includes('400') || _rsErrStr2.includes('Content Exists Risk') || _rsErrStr2.includes('Connection error') || _rsErrStr2.includes('connect') || _rsErrStr2.includes('timeout')) {
                            console.warn('[RS] 400安全过滤(空结果), 回退HTTP直连重试(保留完整消息)'); window.__rsFallbackRetry = true;
                            _useRS = false;
                            var _rsDone = false;
                        } else {
                            throw new Error('RS: ' + _rsErrStr2);
                        }
                    } else {
                        console.warn('[RS] Engine stream failed/unavailable, falling back to direct HTTP');
                        _useRS = false;
                        var _rsDone = false;
                    }
                }
            } else { var _rsDone = false; }

            if (!_useRS && !_rsDone) {
            // ★ LongCat 清理: 剥离所有非标准字段,防止 apply_chat_template 'list object' 错误
            //    LongCat 的 apply_chat_template 不支持 reasoning_content/reasoning_details 等非标准字段,
            //    迭代消息时会尝试调用 .items() 导致 'list object' has no attribute 'items' 错误
            //    根因: main.js:2497 工具重试路径 + api-messages.js:318 buildApiMessages 都会设置此字段
            if (body.messages) {
                var _isLongCatModel = _isLongCatRequest || (body.model || '').toLowerCase().includes('longcat');
                for (var _fi3 = 0; _fi3 < body.messages.length; _fi3++) {
                    var _m3 = body.messages[_fi3];
                    if (_isLongCatModel) {
                        // ★ LongCat: 删除所有非 OpenAI 标准字段 (只保留 role, content, name, tool_calls, tool_call_id)
                        delete _m3.reasoning_content;
                        delete _m3.reasoning_details;
                        delete _m3._srcIndex;
                        delete _m3._useVisionModel;
                        delete _m3._hadReasoning;
                        delete _m3.partial;
                        delete _m3._remove;
                        delete _m3._removeOrphan;
                    } else {
                        // ★ 其他模型: 仅删除内部标记字段,保留 reasoning_content (DeepSeek 需要)
                        delete _m3._srcIndex;
                        delete _m3._useVisionModel;
                        delete _m3.partial;
                        delete _m3._remove;
                        delete _m3._removeOrphan;
                    }
                    // ★ 通用防护: 确保 content 始终是字符串 (视觉模型除外 — 保留 image_url 数组)
                    var _isVisionForSafe = _getModelCfg().supportsVision(body.model || '');
                    if (!_useAnthropicFormat && !_isVisionForSafe && typeof _m3.content !== 'string') {
                        if (Array.isArray(_m3.content)) {
                            _m3.content = _m3.content.map(function(c) {
                                if (typeof c === 'string') return c;
                                if (c && typeof c === 'object') {
                                    if (c.type === 'text') return c.text || '';
                                    if (c.type === 'image_url') return '[图片]';
                                    try { return JSON.stringify(c); } catch(e) { return ''; }
                                }
                                return '';
                            }).filter(Boolean).join('\n');
                        } else if (_m3.content && typeof _m3.content === 'object') {
                            try { _m3.content = JSON.stringify(_m3.content); } catch(e) { _m3.content = ''; }
                        } else {
                            _m3.content = (_m3.content === null || _m3.content === undefined) ? '(empty)' : String(_m3.content);
                        }
                    }
                }
            }
            // ★ 统一走 proxyFetch: 代理OFF直连(走系统代理)→失败回退proxy.php中继; 代理ON走proxy.php+外部代理
            var _headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getVal('apiKey') };
            var _wireBody = JSON.parse(JSON.stringify(body));
            delete _wireBody._anthropicUrl; // 仅为本地路由元数据，不发给上游
            var res = await window.proxyFetch(_reqUrl, {
                method: 'POST',
                headers: _headers,
                body: JSON.stringify(_wireBody),
                signal: abortCtrl.signal
            });

            // ★ 图像模型: 不清除进度条, 等图片实际渲染后再清除
            clearTimeout(timeoutIdVal);
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

            let model = getVal('modelSelect') || '';
            var isMiniMax = model.toLowerCase().includes('minimax');

            // ★ Anthropic 格式响应处理
            if (_useAnthropicFormat) {
                try {
                    var _aResult = await _parseAnthropicResponse(res, chatId, pendingMsg, currentBubble);
                    if (_isLongCatRequest && !_longCatPlainRetryUsed && _aResult.reasoningText
                        && !_aResult.fullText && !(_aResult.toolCalls && _aResult.toolCalls.length)) {
                        return _retryLongCatWithoutThinking(attempt, timeoutIdVal);
                    }
                    usage = _aResult.usage;
                    toolCalls = _aResult.toolCalls || [];
                    if (_aResult.reasoningText) {
                        pendingMsg.reasoning = _aResult.reasoningText;
                        // ★ 补渲染：若实时渲染未触发（如非流式 Anthropic 响应），流结束后补上
                        if (currentChatId === chatId && currentBubble && typeof window._ensureReasoningPanel === 'function') {
                            window._ensureReasoningPanel(currentBubble, _aResult.reasoningText);
                        }
                    }
                    // ★ 截断防护: 未完成的 tool_use 已在解析器内丢弃, 这里只提示用户
                    if (_aResult.truncated) {
                        console.warn('[A-Stream] 输出被截断(stop_reason=' + (_aResult.stopReason || '?') + '), 未完成工具调用已丢弃, 保留 ' + toolCalls.length + ' 个完整调用');
                        if (typeof showToast === 'function') {
                            showToast('⚠️ 输出达到长度/上下文限制被截断，未完成的工具调用已丢弃。可精简对话或重试。', 'warning', 6000);
                        }
                    }
                } catch(_aErr) {
                    throw _aErr;
                }
            } else if (useStream) {
                try {
                    let result = await streamResponse(res, chatId, pendingMsg, 3, 2);
                    if (_isLongCatRequest && !_longCatPlainRetryUsed && result.reasoningText
                        && !result.fullText && !(result.toolCalls && result.toolCalls.length)) {
                        return _retryLongCatWithoutThinking(attempt, timeoutIdVal);
                    }
                    usage = result.usage;
                    toolCalls = result.toolCalls || [];
                    // ★ 死循环防护3: 流被中断(超时/网络/用户停止)时, 丢弃未完整返回的工具调用
                    // 半截响应里解析出的 tool_call 不可靠, 若执行后结果又无法配对, 会导致模型反复重发 → 死循环
                    if (result.streamAborted && toolCalls.length > 0) {
                        console.warn('[STREAM] 流中断, 丢弃 ' + toolCalls.length + ' 个未确认的工具调用');
                        toolCalls = [];
                    }
                    // ★ 成本追踪: 累加 token 用量
                    if (usage) {
                        var _pt = usage.prompt_tokens || usage.input_tokens || 0;
                        var _ct = usage.completion_tokens || usage.output_tokens || 0;
                        sessionUsage.promptTokens += _pt;
                        sessionUsage.completionTokens += _ct;
                        // ★ 统一提取缓存命中(多模型格式: DeepSeek/OpenAI/Anthropic/Gemini/Grok)
                        var _cHit = (window._extractCacheHit ? window._extractCacheHit(usage) : 0);
                        sessionUsage.prefixCacheHits += _cHit;
                        if (_cHit > 0) {
                            var _ptBase = (window._extractPromptTokens ? window._extractPromptTokens(usage) : 0) || _pt || _ct;
                            sessionUsage.cacheHitTokens += _cHit;
                            sessionUsage.cacheMissTokens += (_ptBase > _cHit) ? (_ptBase - _cHit) : 0;
                        }
                        // 估算费用 (基于 DeepSeek V4 定价: $0.5/M input, $2/M output)
                        var pt = _pt / 1000000;
                        var ct = _ct / 1000000;
                        sessionUsage.totalCost += pt * 0.5 + ct * 2;
                    }
                    // ★ 确保 reasoning 从结果同步到 pendingMsg(流式期间可能未完全同步)
                    if (result.reasoningText) {
                        pendingMsg.reasoning = result.reasoningText;
                    }
                } catch (streamErr) {
                    // ★ 死循环检测: LoopGuardError 直接上抛, 不走非流式降级重试(会白烧一次 token)
                    if (streamErr && streamErr.loopGuard) throw streamErr;
                    // ★ HTTP2/网络错误降级: 非流式重试一次
                    var isStreamNetErr = streamErr.name === 'TypeError' ||
                        (streamErr.message && (streamErr.message.includes('fetch') || streamErr.message.includes('net::') || streamErr.message.includes('ERR_') || streamErr.message.includes('network')));
                    if (isStreamNetErr) {
                        console.warn('[STREAM] 流式读取失败,尝试非流式降级:', streamErr.message);
                        showToast('流式中断,切换非流式重试...', 'warning', 2000);
                        // 重新构造非流式请求体(清除stream标记)
                        var _nsBody = JSON.parse(JSON.stringify(body));
                        if (_nsBody.stream !== undefined) _nsBody.stream = false;
                        delete _nsBody._anthropicUrl;
                        var _nsFetchFn = window.proxyFetch;  // ★ 统一走 proxyFetch: 直连→回退
                        var _nsRes = await _nsFetchFn(_reqUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getVal('apiKey')}` },
                            body: JSON.stringify(_nsBody),
                            signal: abortCtrl.signal
                        });
                        clearTimeout(timeoutIdVal);
                        if (!_nsRes.ok) throw new Error(`HTTP ${_nsRes.status}: ${await _nsRes.text()}`);
                        var _nsResult = await handleNonStream(_nsRes, chatId, pendingMsg, currentBubble);
                        usage = _nsResult.usage;
                        if (usage) {
                            var _pt2 = usage.prompt_tokens || usage.input_tokens || 0;
                            var _ct2 = usage.completion_tokens || usage.output_tokens || 0;
                            sessionUsage.promptTokens += _pt2;
                            sessionUsage.completionTokens += _ct2;
                            var _cHit2 = (window._extractCacheHit ? window._extractCacheHit(usage) : 0);
                            sessionUsage.prefixCacheHits += _cHit2;
                            if (_cHit2 > 0) {
                                var _ptBase2 = (window._extractPromptTokens ? window._extractPromptTokens(usage) : 0) || _pt2 || _ct2;
                                sessionUsage.cacheHitTokens += _cHit2;
                                sessionUsage.cacheMissTokens += (_ptBase2 > _cHit2) ? (_ptBase2 - _cHit2) : 0;
                            }
                            var pt2 = _pt2 / 1000000;
                            var ct2 = _ct2 / 1000000;
                            sessionUsage.totalCost += pt2 * 0.5 + ct2 * 2;
                        }
                        toolCalls = _nsResult.toolCalls || [];
                        if (_nsResult.generatedImages && _nsResult.generatedImages.length > 0) {
                            if (!pendingMsg.generatedImages) pendingMsg.generatedImages = [];
                            for (var _gii2 = 0; _gii2 < _nsResult.generatedImages.length; _gii2++) {
                                var _imgSf = _nsResult.generatedImages[_gii2];
                                var _imgSfUrl = typeof _imgSf === 'string' ? _imgSf : (_imgSf && _imgSf.url ? _imgSf.url : '');
                                // ★ URL 去重 (对象引用不同但 URL 相同则跳过)
                                var _alreadyExists = pendingMsg.generatedImages.some(function(existing) {
                                    var _existingUrl = typeof existing === 'string' ? existing : (existing && existing.url ? existing.url : '');
                                    return _existingUrl === _imgSfUrl;
                                });
                                if (!_alreadyExists) {
                                    pendingMsg.generatedImages.push(_imgSf);
                                    if (_gii2 === 0 && !pendingMsg.generatedImage) pendingMsg.generatedImage = _imgSf;
                                    // ★ 上传到服务器,确保刷新后图片不消失 (兼容新旧格式)
                                    if (_imgSfUrl && !_imgSfUrl.startsWith(window.location.origin) && !_imgSfUrl.startsWith('/oneapichat')) {
                                        (function(_origSf, _sfIdx, _metaRef) {
                                            uploadImageToServer(_origSf).then(function(srvUrl) {
                                                if (srvUrl) {
                                                    // ★ 新格式: 更新对象 url 字段; 旧格式: 替换数组元素
                                                    if (typeof _metaRef === 'object' && _metaRef.url) {
                                                        _metaRef.url = srvUrl;
                                                    } else {
                                                        var _pSf = pendingMsg.generatedImages.indexOf(_origSf);
                                                        if (_pSf !== -1) pendingMsg.generatedImages[_pSf] = srvUrl;
                                                        if (pendingMsg.generatedImage === _origSf) pendingMsg.generatedImage = srvUrl;
                                                    }
                                                    var _cSf = chats[chatId] && chats[chatId].messages ? chats[chatId].messages.findIndex(function(m) { return m === pendingMsg; }) : -1;
                                                    if (_cSf !== -1) {
                                                        var _cmSf = chats[chatId].messages[_cSf];
                                                        if (_cmSf.generatedImages && _cmSf.generatedImages[_sfIdx] === _metaRef) {
                                                            if (typeof _metaRef === 'object') _metaRef.url = srvUrl;
                                                            else _cmSf.generatedImages[_sfIdx] = srvUrl;
                                                        }
                                                        if (_cmSf.generatedImage === _metaRef && typeof _metaRef === 'object') _metaRef.url = srvUrl;
                                                        else if (_cmSf.generatedImage === _origSf) _cmSf.generatedImage = srvUrl;
                                                    }
                                                }
                                            }).catch(function(e) {
                                                console.warn('[ImageModel] 上传流式降级图片失败:', e.message);
                                            });
                                        })(_imgSfUrl, _gii2, _imgSf);
                                    }
                                }
                            }
                            // 直接插入 DOM
                            var _tb2 = currentBubble || activeBubbleMap[chatId];
                            if (_tb2) {
                                _tb2.classList.remove('typing');
                                var _ph2 = _tb2.querySelector('#image-placeholder');
                                if (_ph2) _ph2.remove();
                            }
                        }
                    } else {
                        throw streamErr;
                    }
                }
            } else {
                var result;
                try {
                    result = await handleNonStream(res, chatId, pendingMsg, currentBubble);
                } catch(_hnsErr) {
                    // ★ 死循环检测: LoopGuardError 直接上抛到外层 catch 分发
                    if (_hnsErr && _hnsErr.loopGuard) throw _hnsErr;
                    console.error('[sendMessage] handleNonStream crashed:', _hnsErr.message, _hnsErr.stack);
                    // 兜底: 保证气泡至少可见,如果有提取到的图片也可以渲染
                    result = { fullText: '', reasoningText: '', usage: null, toolCalls: [], generatedImages: pendingMsg.generatedImages || [] };
                    // ★ 确保 pendingMsg 有基本内容,防止刷新后消息消失
                    if (!pendingMsg.content) pendingMsg.content = '(图片生成中发生内部错误,但图片已保存)';
                    if (currentBubble) {
                        currentBubble.classList.remove('typing', 'gen-active', 'streaming');
                        var _phHns = currentBubble.querySelector('#image-placeholder');
                        if (_phHns) _phHns.remove();
                        // 显示兜底文本
                        var _mbHns = currentBubble.querySelector('.markdown-body');
                        if (_mbHns && !_mbHns.textContent.trim()) {
                            _mbHns.innerHTML = '<p>' + pendingMsg.content + '</p>';
                        }
                    }
                }
                console.log('[ImageModel DEBUG] result.generatedImages:', result.generatedImages ? result.generatedImages.length : 'undefined/null', 'toolCalls len:', (result.toolCalls || []).length);
                if (_isLongCatRequest && !_longCatPlainRetryUsed && result.reasoningText
                    && !result.fullText && !(result.toolCalls && result.toolCalls.length)) {
                    return _retryLongCatWithoutThinking(attempt, timeoutIdVal);
                }
                usage = result.usage;
                if (usage) {
                    var _pt3 = usage.prompt_tokens || usage.input_tokens || 0;
                    var _ct3 = usage.completion_tokens || usage.output_tokens || 0;
                    sessionUsage.promptTokens += _pt3;
                    sessionUsage.completionTokens += _ct3;
                    var _cHit3 = (window._extractCacheHit ? window._extractCacheHit(usage) : 0);
                    sessionUsage.prefixCacheHits += _cHit3;
                    if (_cHit3 > 0) {
                        var _ptBase3 = (window._extractPromptTokens ? window._extractPromptTokens(usage) : 0) || _pt3 || _ct3;
                        sessionUsage.cacheHitTokens += _cHit3;
                        sessionUsage.cacheMissTokens += (_ptBase3 > _cHit3) ? (_ptBase3 - _cHit3) : 0;
                    }
                    var pt3 = _pt3 / 1000000;
                    var ct3 = _ct3 / 1000000;
                    sessionUsage.totalCost += pt3 * 0.5 + ct3 * 2;
                }
                toolCalls = result.toolCalls || [];
                // ★ 图像模型生成的图片 — 直接插入 DOM (不依赖后续渲染)
                if (result.generatedImages && result.generatedImages.length > 0) {
                    console.log('[ImageModel] inserting', result.generatedImages.length, 'images into DOM');
                    if (!pendingMsg.generatedImages) pendingMsg.generatedImages = [];
                    // ★ 清除占位符
                    if (currentBubble) {
                        var _ph = currentBubble.querySelector('#image-placeholder');
                        if (_ph) _ph.remove();
                    }
                    // ★ 直接插入图片到气泡
                    var _targetBubble = currentBubble || activeBubbleMap[chatId];
                    if (_targetBubble) {
                        var _imgCont = _targetBubble.querySelector('.generated-images-container');
                        if (!_imgCont) {
                            _imgCont = document.createElement('div');
                            _imgCont.className = 'generated-images-container';
                            _imgCont.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
                            _targetBubble.appendChild(_imgCont);
                        }
                        result.generatedImages.forEach(function(_imgData, _idx) {
                            var _imgDataUrl = typeof _imgData === 'string' ? _imgData : (_imgData && _imgData.url ? _imgData.url : '');
                            // ★ URL 去重 (对象引用不同但 URL 相同则跳过)
                            var _exists = pendingMsg.generatedImages.some(function(e) {
                                return (typeof e === 'string' ? e : (e && e.url ? e.url : '')) === _imgDataUrl;
                            });
                            if (!_exists) {
                                pendingMsg.generatedImages.push(_imgData);
                                if (_idx === 0 && !pendingMsg.generatedImage) pendingMsg.generatedImage = _imgData;
                                // ★ 上传到服务器,确保刷新后图片不消失 (兼容新旧格式)
                                if (_imgDataUrl && !_imgDataUrl.startsWith(window.location.origin) && !_imgDataUrl.startsWith('/oneapichat')) {
                                    (function(_origUrl, _di, _metaRef) {
                                        uploadImageToServer(_origUrl).then(function(srvUrl) {
                                            if (srvUrl) {
                                                // ★ 新格式: 更新对象 url; 旧格式: 替换数组元素
                                                if (typeof _metaRef === 'object' && _metaRef.url) {
                                                    _metaRef.url = srvUrl;
                                                } else {
                                                    var _posDi = pendingMsg.generatedImages.indexOf(_origUrl);
                                                    if (_posDi !== -1) pendingMsg.generatedImages[_posDi] = srvUrl;
                                                    if (pendingMsg.generatedImage === _origUrl) pendingMsg.generatedImage = srvUrl;
                                                }
                                                // ★ 同步到 chats
                                                var _cmi = chats[chatId] && chats[chatId].messages ? chats[chatId].messages.findIndex(function(m) { return m === pendingMsg; }) : -1;
                                                if (_cmi !== -1) {
                                                    var _cmsg = chats[chatId].messages[_cmi];
                                                    if (_cmsg.generatedImages && _cmsg.generatedImages[_di] === _metaRef) {
                                                        if (typeof _metaRef === 'object') _metaRef.url = srvUrl;
                                                        else _cmsg.generatedImages[_di] = srvUrl;
                                                    }
                                                    if (_cmsg.generatedImage === _metaRef && typeof _metaRef === 'object') _metaRef.url = srvUrl;
                                                    else if (_cmsg.generatedImage === _origUrl) _cmsg.generatedImage = srvUrl;
                                                }
                                            }
                                        }).catch(function(e) {
                                            console.warn('[ImageModel] 上传直接生成图片失败:', e.message);
                                        });
                                    })(_imgData, _idx);
                                }
                            }
                            // ★ 去重 DOM: 检查是否已有相同 src 的图片
                            var _existingImgs = _imgCont.querySelectorAll('img');
                            var _alreadyExists = false;
                            for (var _exi = 0; _exi < _existingImgs.length; _exi++) {
                                if (_existingImgs[_exi].src === (_imgData.startsWith('data:') ? _imgData : _imgData)) {
                                    _alreadyExists = true; break;
                                }
                            }
                            if (_alreadyExists) return;
                            var _wrap = document.createElement('div');
                            _wrap.style.cssText = 'position:relative;cursor:pointer;';
                            var _imgEl = document.createElement('img');
                            _imgEl.src = _imgData.startsWith('data:') ? _imgData : _imgData;
                            _imgEl.decoding = 'async';
                            _imgEl.style.cssText = 'max-width:320px;width:100%;border-radius:8px;display:block;';
                            _imgEl.onerror = function() { _imgEl.style.display = 'none'; };
                            _wrap.appendChild(_imgEl);
                            _imgCont.appendChild(_wrap);
                        });
                        _targetBubble.classList.remove('typing');
                    }
                } else {
                    console.log('[ImageModel] no images in result');
                }
            }
            } // end if (!_useRS)

            // 处理工具调用
            if (toolCalls.length > 0) {
                toolCallCount++;
                setTimeout(function() {
                    var _tEl = getEl("agentToolCount"); if (_tEl) _tEl.textContent = toolCallCount;
                    var _rEl = getEl("agentRoundCount"); if (_rEl) _rEl.textContent = toolCallCount;
                    var _s = toolCallStats.getSummary();
                    var _sEl = getEl("agentSuccessCount"); if (_sEl) _sEl.textContent = _s.success;
                    var _eEl = getEl("agentErrorCount"); if (_eEl) _eEl.textContent = _s.error;
                    var _dEl = getEl("agentTaskDetail");
                    if (_dEl && _s.failedTools.length > 0) {
                        var _lines = _s.failedTools.map(function(ft) {
                            var _last = ft.errors[ft.errors.length - 1] || {};
                            return '<span style=color:#ef4444>❌ ' + ft.name + '</span>: ' + (_last.msg || '未知错误').substring(0,60);
                        });
                        _dEl.innerHTML = _lines.join('<br>');
                    }
                    var _mEl = getEl("agentMaxCount"); if (_mEl) _mEl.textContent = maxToolCalls;
                    var _pBar = getEl("agentProgressBar");
                    var _pFill = getEl("agentProgressFill");
                    if (_pBar && _pFill) {
                        var _pct = Math.min(100, Math.round((toolCallCount / Math.max(maxToolCalls, 1)) * 100));
                        _pBar.style.display = 'block';
                        _pFill.setAttribute('width', _pct + '%');
                    }
                }, 100);
                sessionUsage.toolCalls += toolCalls.length;
                // Feature 6: 工具调用预判 - 标记所有调用的工具为已记录
                toolCalls.forEach(function(tc) {
                    if (tc && tc.function && tc.function.name) {
                        toolCallStats.record(tc.function.name);
                    }
                });

                if (toolCallCount > maxToolCalls) {
                    throw new Error('工具调用已达上限(' + maxToolCalls + '次),已停止。可在配置面板调整上限。');
                }

                // 将助手消息添加到历史(包含tool_calls)
                // 确保tool_calls中的arguments是字符串(API要求)
                // 过滤掉没有有效function.arguments的碎片
                var validToolCalls = toolCalls.filter(tc => tc && tc.function && tc.function.name && (typeof tc.function.arguments === 'object' || (typeof tc.function.arguments === 'string' && tc.function.arguments.length >= 2)));

                // ★ 死循环防护1: 同轮内按 "名称+参数" 去重
                // 模型曾在单轮响应里复读 76 个完全相同的 video_download(同一磁力)，全部被执行导致 79 个重复 aria2 任务。
                // 去重必须在 normalizedToolCalls 之前做, 保证 assistant 消息的 tool_calls 与实际执行的调用一一对应。
                var _seenToolKey = {};
                var _dedupToolCount = 0;
                validToolCalls = validToolCalls.filter(function(tc) {
                    var _ta = tc.function.arguments;
                    var _key;
                    try {
                        _key = tc.function.name + '|' + (typeof _ta === 'string' ? JSON.stringify(JSON.parse(_ta)) : JSON.stringify(_ta));
                    } catch(e) {
                        _key = tc.function.name + '|' + String(_ta);
                    }
                    if (_seenToolKey[_key]) { _dedupToolCount++; return false; }
                    _seenToolKey[_key] = true;
                    return true;
                });
                if (_dedupToolCount > 0) {
                    console.warn('[ToolGuard] 同轮去重 ' + _dedupToolCount + ' 个重复工具调用(名称+参数相同)');
                }

                // ★ 死循环防护2: 单轮工具调用数量上限
                // 防止模型一次性发起大量工具调用（下载/查询类尤其危险），每轮最多执行 _maxPerRound 个。
                var _maxPerRound = Math.max(1, parseInt(localStorage.getItem('agentMaxToolPerRound')) || 8);
                var _truncToolCount = 0;
                if (validToolCalls.length > _maxPerRound) {
                    _truncToolCount = validToolCalls.length - _maxPerRound;
                    console.warn('[ToolGuard] 单轮工具调用超过上限(' + _maxPerRound + '), 截断 ' + _truncToolCount + ' 个: ' + validToolCalls.slice(0, _maxPerRound).map(function(t){return t.function.name;}).join(','));
                    validToolCalls = validToolCalls.slice(0, _maxPerRound);
                }
                var normalizedToolCalls = validToolCalls.map(tc => {
                    var argStr = typeof tc.function.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function.arguments || {});
                    // ★ 修复: 确保 arguments 是合法 JSON 字符串(和 executeToolCallForRetry 相同的修复)
                    try { JSON.parse(argStr); } catch(_e) { argStr = repairToolArguments(argStr); }
                    // ★ 最终验证: 如果JSON仍无效, 用正则提取参数重新序列化
                    try { JSON.parse(argStr); } catch(_argErr) {
                        console.warn('[normalize] 修复后JSON仍无效, 正则提取:', tc.function.name, _argErr.message);
                        var _fixed2 = {};
                        // ★ 预清理: AI有时输出 {, 开头等畸形JSON
                        var _workStr = argStr;
                        // 移除开头的 { 后的逗号: {, → {
                        _workStr = _workStr.replace(/^\{\s*,/, '{');
                        // 移除末尾 ,} : {...,} → {...}
                        _workStr = _workStr.replace(/,\s*\}$/, '}');
                        // 移除重复逗号: ,, → ,
                        _workStr = _workStr.replace(/,\s*,/g, ',');
                        // 尝试替换单引号 key/value 为双引号
                        var _cleanStr = _workStr.replace(/'([^'\\]*)'/g, '"$1"');
                        try { JSON.parse(_cleanStr); argStr = _cleanStr; _fixed2 = null; } catch(_e2) {
                        // 双引号 key: string value
                        var _r = /"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g, _rm;
                        while ((_rm = _r.exec(_workStr)) !== null) _fixed2[_rm[1]] = _rm[2];
                        // 双引号 key: number/boolean/null value
                        var _r2 = /"(\w+)"\s*:\s*(-?\d+(?:\.\d+)?|true|false|null)/g;
                        while ((_rm = _r2.exec(_workStr)) !== null) {
                            var _v = _rm[2];
                            _fixed2[_rm[1]] = _v === 'true' ? true : _v === 'false' ? false : _v === 'null' ? null : parseFloat(_v);
                        }
                        // 无引号 key (AI有时输出 {key:value} 格式)
                        var _r3 = /(\w+)\s*:\s*"((?:[^"\\]|\\.)*)"/g;
                        while ((_rm = _r3.exec(_workStr)) !== null) { if (!_fixed2[_rm[1]]) _fixed2[_rm[1]] = _rm[2]; }
                        // 无引号 key: number
                        var _r4 = /(\w+)\s*:\s*(-?\d+(?:\.\d+)?|true|false|null)/g;
                        while ((_rm = _r4.exec(_workStr)) !== null) {
                            if (!_fixed2[_rm[1]]) {
                                var _v4 = _rm[2];
                                _fixed2[_rm[1]] = _v4 === 'true' ? true : _v4 === 'false' ? false : _v4 === 'null' ? null : parseFloat(_v4);
                            }
                        }
                        // 如果仍然没有提取到任何参数, 保留原始 argStr (让后续工具自己报错)
                        if (Object.keys(_fixed2).length === 0) {
                            console.warn('[normalize] 无法从JSON中提取任何参数, 原始:', argStr.substring(0, 200));
                            argStr = '{}';
                        } else {
                            argStr = JSON.stringify(_fixed2);
                        }
                        }  // end catch _e2
                    }
                    // 针对 engine_agent_create 的 prompt 做特殊处理:截断过长内容
                    if (tc.function.name === 'engine_agent_create' && argStr.length > 2000) {
                        try {
                            var parsed = JSON.parse(argStr);
                            if (parsed.prompt && parsed.prompt.length > 500) {
                                parsed.prompt = parsed.prompt.substring(0, 500) + '...(截断)请完成后用 engine_push 推送结果给用户';
                                argStr = JSON.stringify(parsed);
                            }
                        } catch(e) {}
                    }
                    // ★ 修复: 清理 tool_call_id(避免非法字符导致 400)
                    var tcId = tc.id || '';
                    // 移除所有非安全字符(只保留 ASCII 字母数字和下划线短横)
                    tcId = tcId.replace(/[^a-zA-Z0-9_\-]/g, '');
                    if (!tcId || tcId.length > 64) tcId = 'tc_' + Date.now();

                    var _normalized = {
                        id: tcId,
                        type: tc.type || 'function',
                        function: {
                            name: tc.function.name,
                            arguments: argStr
                        }
                    };
                    // ★ 保留 Gemini thought_signature (Google API 要求回传，否则 400)
                    if (tc.thought_signature) _normalized.thought_signature = tc.thought_signature;
                    if (tc.function.thought_signature) _normalized.function.thought_signature = tc.function.thought_signature;
                    return _normalized;
                });
                // 在任何工具 await 之前先持久化 assistant.tool_calls 与恢复日志。
                // RS 路径可能已经写入同一批原始 tool_calls，这里按 id/签名合并，
                // 避免刷新恢复后出现重复调用或孤立 tool result。
                var _toolCallKey = function(_tc) {
                    if (_tc && _tc.id) return 'id:' + _tc.id;
                    var _fn = _tc && _tc.function || {};
                    return 'fn:' + (_fn.name || '') + '|' + (typeof _fn.arguments === 'string' ? _fn.arguments : JSON.stringify(_fn.arguments || {}));
                };
                var _mergedToolCalls = [];
                var _seenToolCallKeys = {};
                (pendingMsg.tool_calls || []).concat(normalizedToolCalls).forEach(function(_tc) {
                    var _key = _toolCallKey(_tc);
                    if (_seenToolCallKeys[_key]) return;
                    _seenToolCallKeys[_key] = true;
                    _mergedToolCalls.push(_tc);
                });
                pendingMsg.tool_calls = _mergedToolCalls;
                if (window.ResumeStream && typeof window.ResumeStream.prepareTools === 'function') {
                    window.ResumeStream.prepareTools(chatId, pendingMsg, normalizedToolCalls);
                }
                // slimSaveChats 同步写 localStorage；刷新落在首个工具请求期间也能重建状态。
                slimSaveChats();
                // ★ 死循环检测: 记录本轮全部工具调用 + 整轮检测
                // (软触发已在 recordToolCall 内计数; hard 直接中止请求止损)
                if (_guard) {
                    normalizedToolCalls.forEach(function(_ntc) {
                        try { _guard.recordToolCall(_ntc.function.name, JSON.parse(_ntc.function.arguments || '{}')); } catch(_lgE) {}
                    });
                    _guard.recordRound(normalizedToolCalls.length);
                    var _roundChk = _guard.check();
                    if (_roundChk && _roundChk.level === 'hard') {
                        _throwGuardHard(_roundChk, chatId);
                    }
                }
                var assistantMsg = {
                    role: 'assistant',
                    content: (typeof pendingMsg.content === 'string' && pendingMsg.content.trim())
                        ? pendingMsg.content
                        : (pendingMsg.reasoning || ' '),
                    tool_calls: normalizedToolCalls
                };
                // ★ LongCat 例外: apply_chat_template 不支持 reasoning_content 非标准字段
                var _isLongCatRetry = (body.model || '').toLowerCase().includes('longcat');
                if (pendingMsg.reasoning && typeof pendingMsg.reasoning === 'string') {
                    if (!_isLongCatRetry) assistantMsg.reasoning_content = pendingMsg.reasoning;
                }
                // MiniMax reasoning_split:回传reasoning_details (LongCat 同样不支持)
                if (pendingMsg._reasoningDetails && Array.isArray(pendingMsg._reasoningDetails)) {
                    if (!_isLongCatRetry) assistantMsg.reasoning_details = pendingMsg._reasoningDetails;
                }
                body.messages.push(assistantMsg);

                // 工具调用函数(使用独立的AbortController)
                async function executeToolCallForRetry(tc, abortSignal) {
                    // ★ 按需加载 tools-exec.js (101KB, 仅在第一次工具执行时加载)
                    if (!window.executeToolCallForRetry && window.__LAZY_TOOLS_EXEC) {
                        await ensureScript(window.__LAZY_TOOLS_EXEC);
                    }
                    return await window.executeToolCallForRetry(tc, abortSignal, {
                        body: body, pendingMsg: pendingMsg, chatId: chatId,
                        currentChatId: currentChatId, activeBubbleMap: activeBubbleMap,
                        chats: chats
                    });
                }

// ==================== 图片理解函数 ====================
// 测试直接 MiniMax API

// 一键切换方案

// 研究 MiniMax API 格式

// 临时解决方案:使用其他支持 image_url 的模型
window.useAlternativeVisionModel = function() {

    // 方案1:使用支持 image_url 的其他模型
    // 方案2:使用其他视觉 API 服务
    // 方案3:回退到 MCP(如果修复了)
    return {
        message: '需要研究 MiniMax-VL-01 的正确 API 格式或使用替代方案',
        options: [
            'GPT-4-vision',
            '修复 MCP',
            '其他视觉 API'
        ]
    };
};

// 快速测试 MCP
;

// ★ 统一并行工具执行框架 (v4.0)
// 核心原理: 模型同一轮发出的所有工具调用本质上是独立的（模型在发出前看不到任何结果），
// 因此默认全部并行执行。只有明确标记为"需串行"的工具才排除。
//
// 需串行的工具（有副作用冲突风险或依赖去重逻辑）:
//   - video_download/bili_download: 一次性下载，重复调用会开多个 aria2 任务
//   - video_upload_cloudreve/cr_upload_file/cr_create_share: 一次性上传/分享
//   - server_file_write/server_file_append: 同路径写入可能冲突
var _sequentialOnlyTools = Object.create(null);
_sequentialOnlyTools['video_download'] = true;
_sequentialOnlyTools['bili_download'] = true;
_sequentialOnlyTools['video_upload_cloudreve'] = true;
_sequentialOnlyTools['cr_upload_file'] = true;
_sequentialOnlyTools['cr_create_share'] = true;
_sequentialOnlyTools['server_file_write'] = true;
_sequentialOnlyTools['server_file_append'] = true;

var _parallelToolResults = {};
var _parallelToolIndices = new Set();

// 预扫描: 收集所有可并行的工具调用索引
(function() {
    for (var _pi = 0; _pi < normalizedToolCalls.length; _pi++) {
        var _tc = normalizedToolCalls[_pi];
        if (!_tc || !_tc.function || !_tc.function.name) continue;
        if (_sequentialOnlyTools[_tc.function.name]) continue;
        _parallelToolIndices.add(_pi);
    }
    // <2 则无需并行（避免 Promise.all 开销）
    if (_parallelToolIndices.size < 2) {
        _parallelToolIndices.clear();
    }
})();

// ★ 并行预执行: 所有可并行的工具调用通过 Promise.all 同时执行
if (_parallelToolIndices.size >= 2) {
    var _parallelTcList = [];
    _parallelToolIndices.forEach(function(_idx) { _parallelTcList.push({ idx: _idx, tc: normalizedToolCalls[_idx] }); });
    _parallelTcList.sort(function(a, b) { return a.idx - b.idx; });

    // 显示并行状态提示
    if (currentChatId === chatId) {
        var _paraBub = activeBubbleMap[chatId];
        if (_paraBub) {
            var _paraStatus = _paraBub.querySelector('.search-status');
            if (!_paraStatus) {
                _paraStatus = document.createElement('div');
                _paraStatus.className = 'search-status';
                _paraBub.querySelector('.markdown-body')?.appendChild(_paraStatus);
            }
            _paraStatus.textContent = '⚡ 正在并行执行 ' + _parallelToolIndices.size + ' 个工具...';
        }
    }

    // ★ 并行执行: 每个调用独立 AbortController, 各自独立超时
    var _parallelPromises = _parallelTcList.map(function(_item) {
        var _pIdx = _item.idx;
        var _pTc = _item.tc;
        var _pAbortCtrl = new AbortController();
        var _pAbortKey = chatId + '_parallel_' + _pIdx;
        window.__toolAbortControllers = window.__toolAbortControllers || {};
        window.__toolAbortControllers[_pAbortKey] = _pAbortCtrl;
        if (userAbortMap[chatId]) _pAbortCtrl.abort();

        return (async function() {
            try {
                var _pResult = await executeToolCallForRetry(_pTc, _pAbortCtrl.signal);
                _parallelToolResults[_pIdx] = _pResult;
            } catch(_pErr) {
                _parallelToolResults[_pIdx] = { error: _pErr.message || '并行执行异常' };
            } finally {
                delete window.__toolAbortControllers[_pAbortKey];
            }
        })();
    });

    // ★ 设置并行激活标记 — tools-exec.js 检测到该标记时跳过个体占位符
    window.__parallelToolActive = true;
    // ★ 等待全部并行调用完成 (阻塞 for 循环开始, 但各调用本身是并行的)
    await Promise.all(_parallelPromises);
    window.__parallelToolActive = false;
    console.log('[ParallelTool] 全部 ' + _parallelToolIndices.size + ' 个工具并行执行完成');
    if (currentChatId === chatId) {
        var _doneBub = activeBubbleMap[chatId];
        if (_doneBub) {
            var _doneStatus = _doneBub.querySelector('.search-status');
            if (_doneStatus) _doneStatus.textContent = '✅ ' + _parallelToolIndices.size + ' 个工具全部完成';
        }
    }
}

// 执行每个工具调用并添加结果(只对有有效内容的tool call执行)
                var _allWebFetchUrls = [];
                // ★ 图片去重: 跨 for 循环迭代持久化 (并行生成时多个工具调用共享 pendingMsg.generatedImages,
                //   每次迭代都读到全部图片, 仅靠 DOM 去重会因 setTimeout 延迟插入而失效 → 重复渲染)
                var _scheduledImgSrcs = new Set();
                for (var _toolExecIndex = 0; _toolExecIndex < normalizedToolCalls.length; _toolExecIndex++) {
                    const tc = normalizedToolCalls[_toolExecIndex];
                    // ★ 实时显示工具执行状态
                    var _argPreview = '';
                    try {
                        if (tc.function && tc.function.arguments) {
                            var _a = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
                            var _keys = Object.keys(_a || {});
                            _argPreview = _keys.length > 0 ? (_a[_keys[0]] || '').toString().substring(0, 40) : '';
                        }
                    } catch(e) {}
                    // ★ 用户停止检测: 每次工具调用前检查
                    if (userAbortMap[chatId]) {
                        console.log('[ToolAbort] 用户已停止,跳过工具:', tc.function?.name);
                        var _abortMsg = {
                            role: 'tool',
                            tool_call_id: tc.id || '',
                            content: '[用户已中断操作]'
                        };
                        if (window.ResumeStream && typeof window.ResumeStream.markToolResult === 'function') {
                            window.ResumeStream.markToolResult(chatId, tc, _toolExecIndex, _abortMsg.content, true);
                        }
                        if (typeof showToolStatus === 'function') showToolStatus(tc.function?.name || '...', '', 'aborted', chatId, tc.id || '');
                        body.messages.push(_abortMsg);
                        // ★ 同时持久化到 chat 历史，防止下次发送时出现孤 tool_call 导致 400
                        chats[chatId].messages.push(Object.assign({}, _abortMsg, { _toolResult: true }));
                        slimSaveChats();
                        continue;
                    }

                    if (window.ResumeStream && typeof window.ResumeStream.markToolRunning === 'function') {
                        window.ResumeStream.markToolRunning(chatId, tc, _toolExecIndex);
                    }
                    if (typeof showToolStatus === 'function') showToolStatus(tc.function?.name || '...', _argPreview, 'running', chatId, tc.id || '');

                    // ★ 记录工具开始时间（用于详情卡片展示耗时）
                    var _toolStartTime = Date.now();

                    // ★ 传递工具调用的 abort 信号,让 fetch 也能被中断
                    var _toolAbortCtrl = new AbortController();
                    var _toolAbortKey = chatId + '_tool_' + Date.now();
                    window.__toolAbortControllers = window.__toolAbortControllers || {};
                    window.__toolAbortControllers[_toolAbortKey] = _toolAbortCtrl;
                    
                    // 如果用户中止,同时 abort 工具请求
                    if (userAbortMap[chatId]) {
                        _toolAbortCtrl.abort();
                    }
                    
                    // ★ 死循环防护4: 跨轮重复执行检查(仅限下载/上传等一次性操作类工具)
                    // 模型会在下载进度为 0 时反复发起同一 video_download, 这里检测到
                    // "相同名称+参数 且 之前已成功启动" 的调用就直接跳过, 返回提示而不是再开一个 aria2 任务。
                    var _oneShotTool = (tc.function.name === 'video_download' || tc.function.name === 'bili_download' ||
                        tc.function.name === 'video_upload_cloudreve' || tc.function.name === 'cr_upload_file' ||
                        tc.function.name === 'cr_create_share');
                    var _executedBefore = false;
                    if (_oneShotTool) {
                        try {
                            var _curArgs = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function.arguments || {});
                            var _curSorted = {};
                            Object.keys(_curArgs).sort().forEach(function(_k){ _curSorted[_k] = _curArgs[_k]; });
                            var _curKey = tc.function.name + '|' + JSON.stringify(_curSorted);
                            for (var _pk = 0; _pk < chats[chatId].messages.length; _pk++) {
                                var _pmsg = chats[chatId].messages[_pk];
                                if (_pmsg._toolCard && _pmsg._tcName === tc.function.name && _pmsg._tcArgs && typeof _pmsg._tcArgs === 'object') {
                                    var _prevContent = _pmsg.content ? String(_pmsg.content) : '';
                                    // 仅当上次执行成功(无 error 且含 status/success)才跳过, 失败的可重试
                                    if (_prevContent.indexOf('"error"') !== -1) continue;
                                    if (_prevContent.indexOf('"status"') === -1 && _prevContent.indexOf('success') === -1) continue;
                                    var _oldSorted = {};
                                    Object.keys(_pmsg._tcArgs).sort().forEach(function(_k2){ _oldSorted[_k2] = _pmsg._tcArgs[_k2]; });
                                    if (_curKey === (tc.function.name + '|' + JSON.stringify(_oldSorted))) {
                                        _executedBefore = true;
                                        break;
                                    }
                                }
                            }
                        } catch(_deErr) {}
                    }
                    var toolResult;
                    if (_parallelToolResults.hasOwnProperty(_toolExecIndex)) {
                        // ★ 统一并行框架: 使用预计算结果 (已在 for 循环前通过 Promise.all 完成)
                        toolResult = _parallelToolResults[_toolExecIndex];
                        console.log('[ParallelTool] 取用并行结果 [' + _toolExecIndex + ']:', tc.function.name, toolResult.error ? '❌' : '✅');
                    } else if (_executedBefore) {
                        console.warn('[ToolGuard] 跨轮重复调用已自动跳过:', tc.function.name, String(tc.function.arguments || '').substring(0, 120));
                        toolResult = { result: '【系统提示】该调用(名称+参数)在本对话中已成功执行过，为避免重复下载/重复操作已自动跳过。请直接查看历史中的执行结果，不要再发起相同调用。' };
                    } else if (_guard && (_guard.isDuplicateTool(tc.function.name, _parseGuardArgs(tc.function.arguments)) || _guard.oscillationActive())) {
                        // ★ 死循环检测软跳过: 跨轮重复(名称+参数)或工具振荡 → 不执行, 注入提示引导模型收敛
                        // (与防护4 同款注入管线, tool_call_id 配对正常, 模型下一轮能看到提示)
                        var _guardSkipReason = _guard.isDuplicateTool(tc.function.name, _parseGuardArgs(tc.function.arguments))
                            ? '重复调用(名称+参数相同)'
                            : '工具振荡(反复切换)';
                        console.warn('[LoopGuard] 软跳过:', tc.function.name, _guardSkipReason);
                        toolResult = { result: '【系统提示】系统检测到' + _guardSkipReason + '。该调用未执行。请立即停止调用工具，直接基于已有结果回答用户问题。' };
                    } else {
                        toolResult = await executeToolCallForRetry(tc, _toolAbortCtrl.signal);
                    }

                    // 清理控制器 (并行路径已在 finally 中清理, 这里只清理串行路径)
                    if (!_parallelToolResults.hasOwnProperty(_toolExecIndex)) {
                        delete window.__toolAbortControllers[_toolAbortKey];
                    }
                    // ★ 记录统计
                    if (tc.function && tc.function.name) toolCallStats.record(tc.function.name, !!toolResult.error, toolResult.error || '');
                    // ★ 收集 web_fetch 访问的 URL
                    if (tc.function && tc.function.name === 'web_fetch' && toolResult._webFetchUrls && toolResult._webFetchUrls.length > 0) {
                        _allWebFetchUrls = _allWebFetchUrls.concat(toolResult._webFetchUrls);
                        // 去重
                        var _seenUrls = new Set();
                        _allWebFetchUrls = _allWebFetchUrls.filter(function(u) {
                            if (_seenUrls.has(u)) return false;
                            _seenUrls.add(u);
                            return true;
                        });
                    }
                    var resultContent = toolResult.error || toolResult.result || '(empty)';

                    // 确保content是字符串
                    var contentStr = typeof resultContent === 'string'
                        ? resultContent
                        : (resultContent ? JSON.stringify(resultContent) : '(empty)');

                    // ★ 保底机制: 任何工具结果都不允许无上限进入上下文。
                    //   超长(如 grep 单行巨长文件)直接截断并明确提示, 防止撑爆模型上下文。
                    if (contentStr.length > 100000) {
                        var _origToolLen = contentStr.length;
                        contentStr = contentStr.substring(0, 100000)
                            + '\n\n...(工具结果过长已截断: 原始 ' + _origToolLen + ' 字符 → 仅保留前 100000 字符。如需完整内容, 请改用更精确的参数/分页/行号范围重新获取)';
                        if (typeof showToast === 'function') {
                            showToast('⚠️ 工具 ' + (tc.function?.name || '') + ' 结果过长(' + _origToolLen + ' 字符), 已截断后发送给模型', 'warning', 8000);
                        }
                    }

                    // 先同步落盘工具结果，再写消息历史。刷新恰好发生在两步之间时，
                    // 恢复器可从日志补回结果，而不会重复执行已经完成的工具。
                    if (window.ResumeStream && typeof window.ResumeStream.markToolResult === 'function') {
                        window.ResumeStream.markToolResult(chatId, tc, _toolExecIndex, contentStr, !!toolResult.error);
                    }
                    if (typeof showToolStatus === 'function') showToolStatus(tc.function?.name || '...', '', toolResult.error ? 'error' : 'success', chatId, tc.id || '');

                    body.messages.push({
                        role: 'tool',
                        tool_call_id: tc.id || '',
                        content: contentStr
                    });
                    // ★ 持久化工具结果到 chat 历史 — 下轮 sendMessage 需要这些上下文
                    chats[chatId].messages.push({
                        role: 'tool',
                        tool_call_id: tc.id || '',
                        content: contentStr,
                        _toolResult: true  // 标记为工具结果，UI 渲染时跳过
                    });
                    slimSaveChats();

                    // 更新UI
                    if (currentChatId === chatId) {
                        let currentBubble = activeBubbleMap[chatId];
                        if (currentBubble) {
                            let status = currentBubble.querySelector('.search-status');
                            if (status) {
                                if (tc.function.name === 'web_search') {
                                    // ★ 搜索完成状态行整体移除 (进度由顶部状态栏/滚动标题条承担)
                                    status.remove();
                                    status = null;
                                } else if (tc.function.name === 'analyze_image') {
                                    status.textContent = toolResult.error
                                        ? `❌ 图片分析失败: ${toolResult.error}`
                                        : `✅ 图片分析完成`;
                                } else if (toolResult.error) {
                                    status.textContent = `❌ 工具错误: ${toolResult.error}`;
                                    status.style.color = '#ef4444';
                                } else {
                                    status.textContent = `✅ 工具完成: ${tc.function.name}`;
                                }
                                // ★ server_file_edit: 在气泡中展示 diff 预览卡片
                                if (tc.function.name === 'server_file_edit' && !toolResult.error && toolResult.result) {
                                    try {
                                        var _args = {};
                                        try { _args = JSON.parse(tc.function.arguments || '{}'); } catch(e) {}
                                        var _oldStr = _args.old_string || _args.old_str || '';
                                        var _newStr = _args.new_string || _args.new_str || '';
                                        var _filePath = _args.path || '';
                                        if (_oldStr && _newStr && window.showDiffView) {
                                            window.showDiffView(_filePath, _oldStr, _newStr, currentBubble.querySelector('.markdown-body') || currentBubble);
                                        }
                                    } catch(e) {}
                                }
                            }
                            // ★ 如果生成了图片，立即渲染到当前气泡（不等回复结束）
                            if ((tc.function.name === 'generate_image' || tc.function.name === 'generate_image_i2i') && (pendingMsg.generatedImage || pendingMsg.generatedImages)) {
                                var msgIdx = chats[chatId].messages.findIndex(m => m === pendingMsg);
                                if (msgIdx !== -1) {
                                    if (pendingMsg.generatedImage) chats[chatId].messages[msgIdx].generatedImage = pendingMsg.generatedImage;
                                    if (pendingMsg.generatedImages) chats[chatId].messages[msgIdx].generatedImages = pendingMsg.generatedImages.slice();
                                }
                                // ★ 立即 DOM 渲染：链式模式下不等完整回复
                                var _imgBubble = currentBubble || activeBubbleMap[chatId];
                                if (_imgBubble && currentChatId === chatId) {
                                    var _imgCont = _imgBubble.querySelector('.generated-images-container');
                                    if (!_imgCont) {
                                        _imgCont = document.createElement('div');
                                        _imgCont.className = 'generated-images-container';
                                        _imgCont.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
                                        _imgBubble.appendChild(_imgCont);
                                    }
                                    var _imgs = pendingMsg.generatedImages || (pendingMsg.generatedImage ? [pendingMsg.generatedImage] : []);
                                    // 去重: 跨迭代持久化集合 + DOM 兜底 (兼容新旧格式: 对象取 url, 字符串直接用)
                                    _imgCont.querySelectorAll('img').forEach(function(el) { _scheduledImgSrcs.add(el.src); });
                                    _imgs.forEach(function(_imgData, _idx) {
                                        var _imgUrl = typeof _imgData === 'string' ? _imgData : (_imgData && _imgData.url ? _imgData.url : '');
                                        if (!_imgUrl || _scheduledImgSrcs.has(_imgUrl)) return;
                                        _scheduledImgSrcs.add(_imgUrl);
                                        setTimeout(function() {
                                            var _wrap = document.createElement('div');
                                            _wrap.className = 'gen-image-wrapper';
                                            var _imgEl = document.createElement('img');
                                            _imgEl.src = _imgUrl;
                                            _imgEl.decoding = 'async';
                                            _imgEl.className = 'gen-image';
                                            _imgEl.style.maxWidth = '320px';
                                            _imgEl.setAttribute('loading', 'lazy');
                                            _imgEl.addEventListener('click', function() {
                                                if (typeof showImageLightbox === 'function') showImageLightbox(_imgs, _idx);
                                            });
                                            _imgEl.onerror = function() { this.style.display = 'none'; };
                                            _wrap.appendChild(_imgEl);
                                            _imgCont.appendChild(_wrap);
                                        }, _idx * 50);
                                    });
                                    if (!userScrolled) { requestAnimationFrame(function() { followToBottom($.chatBox); }); }
                                }
                            }
                            // ★ B站扫码登录: QR已由tools-exec.js渲染为独立消息, 这里不重复处理
                            // base64不入pendingMsg(避免被buildApiMessages塞进API请求浪费token)
                            // ★ 如果生成了音频/音乐,确保存入消息对象（持久化 & 刷新不丢）
                            if ((tc.function.name === 'mmx_speech' || tc.function.name === 'mmx_music') && pendingMsg._audioResults && pendingMsg._audioResults.length > 0) {
                                var _aMsgIdx = chats[chatId].messages.findIndex(m => m === pendingMsg);
                                if (_aMsgIdx !== -1) {
                                    chats[chatId].messages[_aMsgIdx]._audioResults = pendingMsg._audioResults.slice();
                                }
                            }
                            // ★ 移除隐藏思考模式下注入的占位元素(工具卡片创建后或卡片禁用时均清理)
                            var _phEl = currentBubble.querySelector('.tool-executing-placeholder');
                            if (_phEl) _phEl.remove();

                            // ★ 追加可折叠工具调用详情卡片（必须在 for 循环内, currentBubble 块内）
                            if (typeof appendToolCallMessage === 'function' && localStorage.getItem('toolCards') !== '0') {
                                var _cardDur = Date.now() - (_toolStartTime || Date.now());
                                var _cardArgs = {};
                                try { _cardArgs = JSON.parse(tc.function.arguments || '{}'); } catch(e) {}
                                var _cardResult = toolResult.error || toolResult.result || '(empty)';
                                var _cardRow = appendToolCallMessage(tc.function.name, _cardArgs,
                                    _cardResult, _cardDur, chatId, toolResult._execDetails || null);
                                // ★ 持久化卡片到数据模型，避免重渲染后消失
                                if (_cardRow) {
                                    chats[chatId].messages.push({
                                        role: 'tool_card',
                                        content: _cardResult,
                                        _tcName: tc.function.name,
                                        _tcArgs: _cardArgs,
                                        _tcDur: _cardDur,
                                        _tcExecDetails: toolResult._execDetails || null,
                                        _tcId: tc.id || '',
                                        _toolCard: true,
                                        time: Date.now()
                                    });
                                }
                            }
                        }
                    }
                }

                // ★ 工具执行循环结束 — 状态行各自有3秒定时器, 不强制清除
                // ★ 告知模型去重/截断情况，避免它以为调用已发出但没收到结果而反复重试
                if (_dedupToolCount > 0 || _truncToolCount > 0) {
                    var _guardNote = '【系统提示】本轮你发起了 ' + (_dedupToolCount + _truncToolCount + validToolCalls.length) + ' 个工具调用：其中 ' +
                        _dedupToolCount + ' 个完全重复(名称+参数相同)已被自动去重，' +
                        (_truncToolCount > 0 ? _truncToolCount + ' 个因超过单轮上限(每轮最多 ' + _maxPerRound + ' 个)未执行；' : '') +
                        '实际执行并返回结果的 ' + validToolCalls.length + ' 个见上方。请基于这些结果继续，不要重复发起相同调用。';
                    if (body.messages.length > 0 && body.messages[body.messages.length - 1].role === 'tool') {
                        var _lastToolMsg = body.messages[body.messages.length - 1];
                        _lastToolMsg.content += '\n\n' + _guardNote;
                        for (var _gi = chats[chatId].messages.length - 1; _gi >= 0; _gi--) {
                            if (chats[chatId].messages[_gi].role === 'tool' && chats[chatId].messages[_gi].tool_call_id === _lastToolMsg.tool_call_id) {
                                chats[chatId].messages[_gi].content += '\n\n' + _guardNote;
                                break;
                            }
                        }
                    }
                }
                // ★ 死循环检测软告知: 本轮有软跳过 → 追加系统提示给模型(双写 body + chats 历史, 同 _guardNote 模式)
                if (_guard && _guard.lastSoftTrigger()) {
                    var _softTriggerInfo = _guard.lastSoftTrigger();
                    var _softNote = '【系统提示】系统检测到' + _softTriggerInfo.reason + '，相关调用已被跳过未执行。请立即停止调用工具，直接基于已有结果回答用户问题。';
                    if (body.messages.length > 0 && body.messages[body.messages.length - 1].role === 'tool') {
                        var _lastToolMsg2 = body.messages[body.messages.length - 1];
                        _lastToolMsg2.content += '\n\n' + _softNote;
                        for (var _gi2 = chats[chatId].messages.length - 1; _gi2 >= 0; _gi2--) {
                            if (chats[chatId].messages[_gi2].role === 'tool' && chats[chatId].messages[_gi2].tool_call_id === _lastToolMsg2.tool_call_id) {
                                chats[chatId].messages[_gi2].content += '\n\n' + _softNote;
                                break;
                            }
                        }
                    }
                    // 软触发达上限 → 升级硬中止(模型无视停止提示)
                    if (_guard.softTriggerCount() >= _guard.cfg.maxSoftTriggers) {
                        _throwGuardHard({ type: 'soft-escalate', reason: '连续 ' + _guard.softTriggerCount() + ' 次软触发未收敛(模型无视停止提示)' }, chatId);
                    }
                }
                // ★ 保存 web_fetch 访问的 URL 列表到 pendingMsg
                if (_allWebFetchUrls.length > 0) {
                    pendingMsg._webFetchUrls = _allWebFetchUrls;
                }
                // tool_calls 已在执行任何工具前合并并持久化，避免 await 期间刷新丢失。

                // ★ Agent 模式下:创建子代理后引导模型自主总结,自然结束本轮
                if (window._hasCreatedSubAgent) {
                    if (!validToolCalls || !Array.isArray(validToolCalls)) {
                        console.log('[Agent] 已创建子代理,跳过等待逻辑');
                    } else {
                    var onlyCreatedSubAgents = validToolCalls.every(function(tc) {
                        return tc.function && (tc.function.name === 'delegate_task' || tc.function.name === 'engine_agent_create');
                    });
                    if (onlyCreatedSubAgents) {
                        // ★ 优化: 子代理已创建完毕,注入停止提示防止模型浪费token轮询
                        console.log('[Agent] 本轮只创建了子代理(' + validToolCalls.length + '个),注入停止提示');
                        delete pendingMsg.partial;
                                    try { localStorage.removeItem('_savedPartial'); } catch(e) {}
                        if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
                        pendingMsg.time = Date.now() - startTime;
                        pendingMsg.usage = usage;
                        saveChats();
                        // ★ 注入等待提示,让模型自然停止,不再调用API浪费token
                        var _allNamesOnly = [];
                        validToolCalls.forEach(function(tc) {
                            try {
                                var _a = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function.arguments || {});
                                var _n = _a.name || _a.agent_name || _a.role || 'worker';
                                if (_allNamesOnly.indexOf(_n) === -1) _allNamesOnly.push(_n);
                            } catch(e) {}
                        });
                        chats[chatId].messages.push({
                            role: 'user',
                            text: '已委派子代理: ' + _allNamesOnly.join(', ') + '。请用一句话告知用户你已委派的任务,然后等待。子代理完成后会自动通知你,不要尝试查询子代理状态。',
                            _internal: true
                        });
                        // ★ 继续一轮让模型总结,然后自然停止(不再创建新代理就不会继续loop)
                    } else {
                        // ★ 优雅方式: 不暴力截断,而是给模型注入一个"总结提示"让它自己在下一轮自然结束
                        // 通过修改 pendingMsg.content 末尾追加提示,让模型在下一轮 API 调用时自主收尾
                        var _createdNames = [];
                        validToolCalls.forEach(function(tc) {
                            if (tc.function && (tc.function.name === 'delegate_task' || tc.function.name === 'engine_agent_create')) {
                                try {
                                    var _args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function.arguments || {});
                                    var _n = _args.name || _args.agent_name || _args.role || 'worker';
                                    if (_createdNames.indexOf(_n) === -1) _createdNames.push(_n);
                                } catch(e) {}
                            }
                        });
                        // ★ 给模型注入"请总结"的隐式信号,让它在下一轮自己结束
                        // 实际做法: 不强制 stop,而是在 assistant 消息末尾附加一条 user-role hint
                        // 模型会在下次 API 调用时看到这条 hint 并自动总结
                        console.log('[Agent] 子代理已创建(' + _createdNames.length + '个),允许模型在下一轮自然总结');
                        // 保存当前消息
                        delete pendingMsg.partial;
                                    try { localStorage.removeItem('_savedPartial'); } catch(e) {}
                        if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
                        pendingMsg.time = Date.now() - startTime;
                        pendingMsg.usage = usage;
                        saveChats();
                        // ★ 追加一条 user hint 到消息历史,作为模型的"自然引导"
                        // 模型下一次 API 调用时会读到这条,然后自主决定: 继续操作 / 总结等待
                        var _namesStr = _createdNames.join(', ');
                        var _hintMsg = '已委派子代理: ' + _namesStr + '。' +
                            '请用一句话总结当前进度,告知用户已委派的任务,然后等待子代理完成。' +
                            '子代理完成后系统会自动通知你整合结果。';
                        chats[chatId].messages.push({
                            role: 'user',
                            text: _hintMsg,
                            _internal: true  // 标记为内部消息,不渲染到界面
                        });
                        // ★ 继续递归,让模型看到 hint 后自主总结
                        // 不 return,继续 attemptRequestWithFreshAbort
                    }
                    }
                }

                // ★ 链式输出: 每轮独立气泡（参考 desktop deepseek-chat）
                if (window._chainMode && pendingMsg && (pendingMsg.content || pendingMsg.reasoning)) {
                    // 1. 最终化本轮消息 — 标记完成，保存内容
                    delete pendingMsg.partial;
                    pendingMsg._chainRound = (pendingMsg._chainRound || 1);
                    if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
                    try { localStorage.removeItem('_savedPartial'); } catch(e) {}

                    // 2. 最终化当前气泡（不再追加内容）— 三个光标类全清, 防残留
                    if (currentChatId === chatId) {
                        var _bub = activeBubbleMap[chatId];
                        if (_bub) {
                            _bub.classList.remove('typing', 'gen-active', 'streaming');
                            var _md = _bub.querySelector('.markdown-body');
                            if (_md) _triggerPostRender(_md);
                        }
                        // ★ 创建新气泡用于下一轮流式输出
                        var _newBubble = appendMessage('assistant', '', null, null, null, 0, false);
                        if (_newBubble) _newBubble.classList.add('typing');
                        activeBubbleMap[chatId] = _newBubble;
                        setTimeout(function() { autoScrollToBottom('chain'); }, 30);
                    }

                    // 3. 创建新的 pendingMsg 用于下一轮
                    var _nextRound = (pendingMsg._chainRound || 1) + 1;
                    var _newPending = { role: 'assistant', content: '', reasoning: '', partial: true, _chainRound: _nextRound };
                    chats[chatId].messages.push(_newPending);
                    pendingMsg = _newPending;
                } else if (window._chainMode && pendingMsg && toolCalls && toolCalls.length > 0) {
                    // ★ 修复: 纯工具轮(无正文无思考)也必须清除 partial。
                    //   否则该条 assistant 消息会带着 partial=true 留在历史里, buildApiMessages 会跳过它,
                    //   其 tool_calls 全部丢失 → 对应 tool 结果被当成孤立消息删除 → 模型看不到结果 →
                    //   反复重发同一调用(曾出现 76 个重复 video_download) → 死循环。
                    //   这里只清 partial, 不创建新气泡: 下一轮内容仍写入当前消息/气泡, 与修复前 UI 行为一致。
                    delete pendingMsg.partial;
                    pendingMsg._chainRound = (pendingMsg._chainRound || 1);
                    if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
                    try { localStorage.removeItem('_savedPartial'); } catch(e) {}
                }

                // ★ 重置前先杀死旧的 AbortController
                try { abortMain.abort(); } catch(e) {}
                var newAbortCtrl = new AbortController();
                abortControllerMap[chatId] = newAbortCtrl;
                clearTimeout(timeoutId);
                var newTimeoutVal = timeout;
                var newTimeoutId = setTimeout(() => newAbortCtrl.abort(), newTimeoutVal);
                window._activeRequestTimeoutId = newTimeoutId;

                // ★ 清除 partial 标记(工具调用循环中 assistant 消息已完成)
                // 链式模式已在上面 block 中处理完毕，跳过避免破坏新 pendingMsg
                if (!window._chainMode) delete pendingMsg.partial;
                // ★ 清除 _savedPartial: 链式模式上面已清, 非链式模式也需清, 否则刷新时
                //   loadChat 会误认为流仍在进行中, 触发虚假日志恢复 → 气泡进入"生成中"状态
                try { localStorage.removeItem('_savedPartial'); } catch(e) {}
                // ★ 重建API消息(包含本轮新添加的工具结果和assistant消息)
                body.messages = buildApiMessages(chatId);
                // ★ Anthropic 格式: 重建后需重新转换 tool→user+tool_result
                if (_useAnthropicFormat) {
                    body.messages = _convertAnthropicMessages(body.messages);
                }
                console.log('[RS-TOOLS] rebuild body.messages for next round, msgs:', body.messages.length);
                // 继续循环获取下一个响应
                return attemptRequestWithFreshAbort(attempt, newAbortCtrl, newTimeoutId);
            }

            // 无工具调用,正常完成
            // ★ 清除链式思考步骤
            if (window._chainMode && currentChatId === chatId) {
                window._clearChainSteps(chatId);
            }
            delete pendingMsg.partial;
            // ★ 流结束释放滚动锁定
            // ★ 清除保存的 partial 标记(已完成,刷新不会丢失)
            try { localStorage.removeItem('_savedPartial'); } catch(e) {}
            if (window.ResumeStream && typeof window.ResumeStream.complete === 'function') {
                window.ResumeStream.complete(chatId);
            }
            // ★ 清除流式保存定时器
            if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
            pendingMsg.time = Date.now() - startTime;
            pendingMsg.usage = usage;
            window._streamCompletedOk = true;  // ★ 流正常完成标记(finally 免全量重建)
            saveChats(true);  // ★ 强制服务器保存+广播到其他设备
            // ★ 修复: 不使用 loadChat(全量重渲染),仅更新现有气泡内容
            if (currentChatId === chatId) {
                var _bubble = activeBubbleMap[chatId];
                console.log('[ImageModel] completion: chatId match=', (currentChatId === chatId), 'bubble exists=', !!_bubble, 'hasImages=', !!(pendingMsg.generatedImages && pendingMsg.generatedImages.length > 0));
                if (_bubble) {
                    // ★ 工具状态行各自有3秒定时器, 不强制移除
                    var _md = _bubble.querySelector('.markdown-body');
                    // ★ 流式已完成, 不再重复全局渲染(避免覆盖流式结果)
                    if (_md) {
                        _triggerPostRender(_md);
                        // ★ 全量清扫: 除当前气泡外, 任何历史气泡的残留光标类(typing/gen-active/streaming)
                        //   一次清干净 — _streamState[chatId] 被新流覆盖/中止路径漏清时, 旧气泡会永久发光
                        document.querySelectorAll('.bubble.assistant.typing, .bubble.assistant.gen-active, .bubble.streaming').forEach(function(_sb) {
                            if (_sb !== _bubble) _sb.classList.remove('typing', 'gen-active', 'streaming');
                        });
                        _bubble.classList.remove('typing', 'gen-active', 'streaming');
                        // ★ 无正文空气泡美化 (非流式)
                        if (window._ensureEmptyBubbleHint) window._ensureEmptyBubbleHint(_bubble, pendingMsg);
                    }
                    // ★ 追加生成的图片到气泡(如果有)
                    console.log('[ImageModel] render: generatedImages count=', pendingMsg.generatedImages ? pendingMsg.generatedImages.length : 0, 'bubble=', !!_bubble);
                    if (pendingMsg.generatedImages && pendingMsg.generatedImages.length > 0) {
                        var _existingImg = _bubble.querySelector('.generated-images-container');
                        if (!_existingImg) {
                            var _imgCont = document.createElement('div');
                            _imgCont.className = 'generated-images-container';
                            _imgCont.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
                            _bubble.appendChild(_imgCont);
                            // ★ 清除图像生成占位符
                            var _ph = _bubble.querySelector('#image-placeholder');
                            if (_ph) _ph.remove();
                            // ★ 异步渲染每张图片,避免卡死
                            pendingMsg.generatedImages.forEach(function(_imgData, _idx) {
                                setTimeout(function() {
                                    var _wrap = document.createElement('div');
                                    _wrap.style.cssText = 'position:relative;cursor:pointer;';
                                    var _imgEl = document.createElement('img');
                                    _imgEl.src = _imgData.startsWith('data:') ? _imgData : _imgData;
                                    _imgEl.decoding = 'async';
                                    var _maxW = pendingMsg.generatedImages.length > 1 ? '160px' : '320px';
                                    _imgEl.style.cssText = 'max-width:' + _maxW + ';width:100%;border-radius:8px;display:block;';
                                    _imgEl.setAttribute('loading', 'lazy');
                                    _wrap.appendChild(_imgEl);
                                    _imgCont.appendChild(_wrap);
                                }, _idx * 50);
                            });
                        }
                    }
                    // ★ 渲染生成的音频/音乐（与图片一样放在气泡末尾，避免被工具调用覆盖）
                    if (pendingMsg._audioResults && pendingMsg._audioResults.length > 0) {
                        pendingMsg._audioResults.forEach(function(_ar) {
                            var _audioWrap = document.createElement('div');
                            _audioWrap.style.cssText = 'margin:8px 0;padding:8px;border:1px solid var(--border-color,#e5e7eb);border-radius:8px;background:var(--bg-secondary,#f9fafb);';
                            _audioWrap.innerHTML = '<div style="font-weight:600;margin-bottom:6px;font-size:13px;">' + _ar.label + '</div>' +
                                '<audio controls style="width:100%;max-width:400px;"><source src="' + _ar.url + '" type="audio/mpeg"></audio>' +
                                '<br><a href="' + _ar.url + '" target="_blank" download style="font-size:12px;">⬇️ 下载</a>';
                            _bubble.appendChild(_audioWrap);
                        });
                    }
                    // ★ 渲染 web_fetch 访问的链接列表
                    if (pendingMsg._webFetchUrls && pendingMsg._webFetchUrls.length > 0) {
                        _renderWebFetchUrls(_bubble, pendingMsg._webFetchUrls);
                    }
                    // ★ 就地收尾: 补操作按钮(重新生成/继续/还原) + 页脚(耗时/token/缓存)
                    //   (原由 finally 的 loadChat 全量重建承担 — 免重建后滚动不再跳变)
                    if (window.finalizeBubbleUI) {
                        var _fIdx = chats[chatId].messages.indexOf(pendingMsg);
                        window.finalizeBubbleUI(_bubble, pendingMsg.content || '', _fIdx, pendingMsg.usage, pendingMsg.time);
                    }
                }
            }
            // ★ 确保最后一条用户消息有编辑按钮(sendMessage 时 isLast=false,缺失)
            if (currentChatId === chatId) {
                var _userRows = $.chatMessagesContainer.querySelectorAll('.message-row.user');
                var _lastUserRow = _userRows[_userRows.length - 1];
                if (_lastUserRow && !_lastUserRow.querySelector('.edit-btn')) {
                    var _userBubble = _lastUserRow.querySelector('.bubble.user');
                    var _userText = _userBubble ? (_userBubble.querySelector('.markdown-body')?.textContent || '') : '';
                    var _editBtn = document.createElement('div');
                    _editBtn.className = 'msg-action-btn edit-btn';
                    _editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3l4 4L7 21H3v-4L17 3z"/><path d="M15 5l4 4"/></svg>';
                    _editBtn.onclick = function(e) {
                        e.stopPropagation();
                        var _msgs = chats[chatId].messages;
                        var _idx = _msgs.findIndex(function(m) { return m.role === 'user' && m.text === _userText; });
                        if (_idx === -1) _idx = _msgs.length - 1;
                        var _sys = _msgs.filter(function(m) { return m.role === 'system' && !m.temporary && !m.timestamp; });
                        var _ts = _msgs.find(function(m) { return m.timestamp; });
                        var _others = _msgs.slice(0, _idx).filter(function(m) { return m.role !== 'system' || m.temporary || m.timestamp; });
                        chats[chatId].messages = _sys.concat(_others).concat(_ts ? [_ts] : []);
                        saveChatsDebounced();
                        loadChat(chatId);
                        if ($.userInput) {
                            $.userInput.value = _userText || '';
                            window.autoResize($.userInput);
                        }
                    };
                    var _existingActions = _lastUserRow.querySelector('.msg-actions');
                    if (_existingActions) {
                        _existingActions.insertBefore(_editBtn, _existingActions.firstChild);
                    }
                }
            }
            // ★ 子代理完成报告处理:触发队列中的下一个通知
            if (window._agentNotifyQueue && window._agentNotifyQueue.length > 0) {
                setTimeout(function() { window._processAgentNotifyQueue(); }, 1000);
            }
            // ★ 保存聊天到 localStorage (确保图片等数据持久化,工具路径和直接路径都需要)
            saveChats(true);  // ★ 强制服务器保存+广播到其他设备
            var defaultTitle = text ? text.slice(0, 10) : (files.length ? '文件消息' : '新对话');
            if (!skipUserAdd && chats[chatId].title === defaultTitle) {
                autoGenerateTitle(chatId);
            }
            // ★ Agent 模式: 主动建议(不阻塞主流程)
            if (getAgentMode() === 'agent' && localStorage.getItem('agentProactive') === 'true') {
                var lastContent = typeof pendingMsg.content === 'string' ? pendingMsg.content : '';
                if (lastContent) {
                    // 延迟执行,让 UI 先完成渲染
                    setTimeout(function() {
                        generateProactiveSuggestions(chatId, lastContent);
                    }, 1500);
                }
            }
        } catch (e) {
            clearTimeout(timeoutId);
            var isUserAbort = userAbortMap[chatId];  // 检查是否用户主动停止
            if (isUserAbort) {
                delete userAbortMap[chatId];  // 清理标记
                throw new Error('用户停止');  // 不重试,直接结束
            }

            // ★ 智能降级: 模型不支持工具调用 → 移除 tools 重试
            if (e.message && e.message.includes('does not support tools')) {
                console.warn('[AutoDowngrade] 模型不支持工具调用,降级为普通模式');
                var _curModel = getVal('modelSelect') || '';
                var _noToolList = JSON.parse(localStorage.getItem('noToolModels') || '[]');
                // 提取核心模型名(去掉 :tag 后缀),存储为通用模式
                var _coreModel = (_curModel || '').replace(/:.*$/, '').toLowerCase();
                if (_noToolList.indexOf(_coreModel) === -1 && _coreModel) {
                    _noToolList.push(_coreModel);
                    localStorage.setItem('noToolModels', JSON.stringify(_noToolList));
                }
                // 从 body 中移除 tools/tool_choice(无论是否有,都清理掉)
                delete body.tools;
                delete body.tool_choice;
                // 清理消息历史中的 tool_calls(若之前有成功执行过工具)
                for (var _mi = 0; _mi < body.messages.length; _mi++) {
                    var _mm = body.messages[_mi];
                    if (_mm.role === 'assistant') {
                        delete _mm.tool_calls;
                    }
                }
                // 清理 pendingMsg（保留推理内容，重试后正文追加到推理下方）
                if (pendingMsg) {
                    pendingMsg.content = '';
                }
                showToast('⚠️ 模型不支持工具调用,已切换为普通问答模式', 'warning', 4000);
                try { abortMain.abort(); } catch(e) {}
                var _downgradeCtrl = new AbortController();
                abortControllerMap[chatId] = _downgradeCtrl;
                clearTimeout(timeoutId);
                var _downgradeTimeout = timeout;
                var _downgradeTimer = setTimeout(function() { _downgradeCtrl.abort(); }, _downgradeTimeout);
                return attemptRequestWithFreshAbort(attempt, _downgradeCtrl, _downgradeTimer);
            }

            // ★ 智能调整 max_tokens: 从 API 错误信息中提取有效范围并自动修正
            // 格式1: DeepSeek "...must be in range [1, 131072]"
            // 格式2: LongCat "...is not less or equal to 131072"
            var maxTokensMatch = e.message?.match(/max_tokens.*?\[(\d+),\s*(\d+)\]/)
                || e.message?.match(/is not less or equal to (\d+)/);
            if (maxTokensMatch) {
                // ★ 范围格式 [min, max] 取 match[2](上限); "not less or equal to X" 取 match[1]
                var maxVal = parseInt(maxTokensMatch[2]) || parseInt(maxTokensMatch[1]);
                var curMaxTokens = parseInt(getVal('maxTokens')) || 4096;
                if (curMaxTokens > maxVal) {
                    console.warn('[AutoAdjust] max_tokens ' + curMaxTokens + ' -> ' + maxVal);
                    let m = getVal('modelSelect') || '';
                    modelMaxOutputTokens[m] = maxVal;
                    localStorage.setItem('modelMaxOutputTokens', JSON.stringify(modelMaxOutputTokens));
                    setVal('maxTokens', maxVal);
                    setVal('maxTokensInput', maxVal);
                    body.max_tokens = maxVal;
                    showToast('max_tokens 自动调整为 ' + maxVal, 'warning', 3000);
                    try { abortMain.abort(); } catch(e) {}
                    var retryCtrl = new AbortController();
                    abortControllerMap[chatId] = retryCtrl;
                    clearTimeout(timeoutId);
                    var retryTimeoutId = setTimeout(function() { retryCtrl.abort(); }, timeout);
                    return attemptRequestWithFreshAbort(attempt, retryCtrl, retryTimeoutId);
                }
            }

            var isUpstreamError = e.message === 'UPSTREAM_ERROR' || e.message.includes('upstream') || e.message.includes('bad response');
            var isHTTP2Error = (e.name === 'TypeError' && (e.message.includes('fetch') || e.message.includes('Failed to') || e.message.includes('net::') || e.message.includes('ERR_')))
                || e.message.includes('HTTP2') || e.message.includes('h2') || e.message.includes('protocol error') || e.message.includes('protocol_error');
            var isNetError = e.name === 'AbortError' || e.message.includes('timeout') || e.message.includes('aborted') || isUpstreamError || isHTTP2Error;

            // ★ 400/404 错误智能重试: 解析错误原因，尝试修复后重试
            var is400Error = e.message && (e.message.startsWith('HTTP 400') || e.message.includes('HTTP 400:') || e.message.startsWith('HTTP 404') || e.message.includes('HTTP 404:') || e.message.startsWith('HTTP 422') || e.message.includes('HTTP 422:'));
            if (is400Error && attempt < maxRetries) {
                var _errBody = '';
                var _errJson = null;
                try {
                    _errBody = e.message.replace(/^HTTP (40[04]|422):\s*/, '');
                    _errJson = JSON.parse(_errBody);
                } catch(_parseErr) { /* ignore parse errors */ }

                var _errMsg = (_errJson && (_errJson.error && _errJson.error.message || _errJson.message)) || _errBody || '';
                var _errType = (_errJson && _errJson.error && _errJson.error.type) || '';
                var _shouldRetry = false;
                var _retryAction = '';

                // ★ 持久化 400 错误详情到气泡，便于用户查看
                if (_errMsg && pendingMsg && currentBubble) {
                    var _errCode = e.message.includes('404') ? '404' : (e.message.includes('422') ? '422' : '400');
                    var _errDetail = '🔴 **HTTP ' + _errCode + ' 错误**\n```\n' + _errMsg.substring(0, 500) + '\n```';
                    if (!pendingMsg._400errors) pendingMsg._400errors = [];
                    pendingMsg._400errors.push({ time: Date.now(), msg: _errMsg, action: 'analyzing' });
                    // 在气泡底部追加错误详情（最多保留最近3条）
                    var _errFooter = currentBubble.querySelector('.error-detail');
                    if (!_errFooter && currentBubble.querySelector('.markdown-body')) {
                        _errFooter = document.createElement('div');
                        _errFooter.className = 'error-detail';
                        _errFooter.style.cssText = 'margin-top:8px;padding:8px 12px;border-radius:6px;background:#fef2f2;border:1px solid #fecaca;font-size:0.8rem;color:#991b1b;max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;';
                        currentBubble.querySelector('.markdown-body').after(_errFooter);
                    }
                    if (_errFooter) {
                        _errFooter.innerHTML = pendingMsg._400errors.slice(-3).map(function(e) {
                            var _errCode = e.msg && e.msg.includes('404') ? '404' : '400';
                            return '<div style="margin:4px 0">🔴 <b>' + _errCode + ' @ ' + new Date(e.time).toLocaleTimeString() + '</b><br>' + escapeHtml(e.msg.substring(0, 400)) + '</div>';
                        }).join('<hr style="border-color:#fecaca;margin:4px 0">');
                    }
                }

                // 检测可恢复的 400 错误类型
                // ★ 先检查 max_tokens 超限（必须在 token/context 之前，否则会被错误归类为 trim_context）
                // ★ 注意匹配顺序: LongCat 报 "max_tokens: 389120 is not less or equal to 131072",
                //   通用模式 /max_tokens.*?(\d{4,})/ 会先抓到发送值 389120 而非限制值 131072,
                //   必须把"限制值"模式排在前面。
                var _maxTokensLimit = _errMsg.match(/max tokens\s*[>≥]\s*(\d+)/i)
                    || _errMsg.match(/is not less or equal to\s*(\d+)/i)
                    || _errMsg.match(/max_tokens.*?(?:≤|<=\s*|<)\s*(\d+)/i)
                    || _errMsg.match(/does not support max tokens.*?[>≥]\s*(\d+)/i)
                    || _errMsg.match(/support max tokens.*?(\d{4,})/i)
                    || _errMsg.match(/max_tokens.*?(\d{4,})/i);
                if (_maxTokensLimit || _errMsg.includes('max_tokens') || _errMsg.includes('max completion') || _errMsg.includes('does not support max tokens')) {
                    _shouldRetry = true;
                    _retryAction = 'adjust_max_tokens';
                    if (_maxTokensLimit) {
                        // 从错误消息中提取确切限制值并持久化
                        var _limitVal = parseInt(_maxTokensLimit[1]);
                        if (_limitVal > 0) {
                            var _curMax2 = parseInt(getVal('maxTokens')) || 4096;
                            // ★ 持久化：更新缓存 + localStorage，刷新后不丢失
                            var _curModel3 = getVal('modelSelect') || '';
                            modelMaxOutputTokens[_curModel3] = _limitVal;
                            try { localStorage.setItem('modelMaxOutputTokens', JSON.stringify(modelMaxOutputTokens)); } catch(e) {}
                            // 立即修正
                            setVal('maxTokens', _limitVal);
                            setVal('maxTokensInput', _limitVal);
                            body.max_completion_tokens = _limitVal;
                            body.max_tokens = _limitVal;
                            console.warn('[400-Retry] max_tokens 超限，自动修正并记住:', _curMax2, '→', _limitVal, '(已持久化)');
                        }
                    }
                } else if (_errType === 'context_length_exceeded' || (_errMsg.includes('too long') && _errMsg.includes('context')) || _errMsg.includes('maximum context length')) {
                    // 真正的上下文过长 → 裁剪消息历史重试
                    _shouldRetry = true;
                    _retryAction = 'trim_context';
                } else if (_errMsg.includes('system') && (_errMsg.includes('prompt') || _errMsg.includes('too long'))) {
                    // system prompt 过长 → 截断 system prompt 重试
                    _shouldRetry = true;
                    _retryAction = 'trim_system';
                } else if (_errMsg.includes('invalid function arguments json string') || _errMsg.includes('tool result') && _errMsg.includes('not found') || _errMsg.includes('tool_calls') && _errMsg.includes('must be followed by tool messages') || _errMsg.includes('tool') && _errMsg.includes('must be a response to') && _errMsg.includes('tool_calls')) {
                    // ★ 工具调用受损 → 修复或丢弃该工具调用（不删全部 tools）
                    _shouldRetry = true;
                    _retryAction = 'fix_tool_args';
                } else if (_errMsg.includes('tool') && (_errMsg.includes('not support') || _errMsg.includes('disabled') || _errMsg.includes('No endpoints found'))) {
                    // 模型完全不支持工具 → 移除全部 tools
                    _shouldRetry = true;
                    _retryAction = 'remove_tools';
                } else if (_errMsg.includes('Content Exists Risk') || _errMsg.includes('content filter') || _errMsg.includes('safety') || _errMsg.includes('sensitive')) {
                    // 内容安全过滤 — 尝试精简消息体
                    // ★ 如果是图片敏感(image is sensitive)，走专门的重试策略
                    if (_errMsg.includes('image') && _errMsg.includes('sensitive')) {
                        _shouldRetry = true;
                        _retryAction = 'strip_images';
                    } else {
                        var _noSys = !body.messages.some(function(m){return m.role==='system';});
                        var _noTools = !body.tools || body.tools.length === 0;
                        if (_noSys && _noTools && body.messages.length <= 6) {
                            // 已是最简形式,问题在用户输入本身
                            _shouldRetry = false;
                            showToast('⚠️ 内容安全过滤: 消息内容被接口拒绝,请修改提问方式后重试', 'error', 8000);
                        } else {
                            _shouldRetry = true;
                            _retryAction = 'safety_filter';
                        }
                    }
                } else if (_errMsg.includes('parameter') || _errType === 'invalid_request_error' || e.message.includes('422')) {
                    // 通用参数错误 / 422 Unprocessable → 清理参数 + 减半工具重试
                    _shouldRetry = true;
                    _retryAction = (_errMsg.includes('tool') || e.message.includes('422')) ? 'remove_tools' : 'clean_params';
                } else if (attempt === 0) {
                    // 第一次遇到未知 400 → 重试一次（可能临时故障）
                    _shouldRetry = true;
                    _retryAction = 'generic_retry';
                }

                if (_shouldRetry) {
                    console.warn('[400-Retry] 检测到 400 错误，尝试修复:', _retryAction, '| 原因:', _errMsg.substring(0, 120));
                    // ★ 同时用 console.error 打印完整错误（红色醒目 + DevTools 持久）
                    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                    console.error('[HTTP 400 完整错误] ' + _retryAction);
                    console.error(_errMsg);
                    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

                    if (_retryAction === 'trim_context') {
                        // 裁剪消息历史：保留 system + 最后 N 条消息
                        var _sysMsgs = body.messages.filter(function(m) { return m.role === 'system'; });
                        var _nonSysMsgs = body.messages.filter(function(m) { return m.role !== 'system'; });
                        var _keepCount = Math.max(2, Math.floor(_nonSysMsgs.length * 0.5));
                        body.messages = _sysMsgs.concat(_nonSysMsgs.slice(-_keepCount));
                        // ★ 同时降低 max_tokens 防止输出超限 (OpenRouter 报 "in the output")
                        if (_errMsg.includes('in the output') || _errMsg.includes('output')) {
                            var _curOut = body.max_completion_tokens || body.max_tokens || 4096;
                            if (_curOut > 4096) {
                                body.max_completion_tokens = 4096;
                                body.max_tokens = 4096;
                            }
                        }
                        showToast('⚠️ 上下文过长，已自动裁剪消息历史后重试...', 'warning', 10000);
                    } else if (_retryAction === 'adjust_max_tokens') {
                        // ★ 如果错误消息已提取到精确限制值，直接用；否则保守缩减
                        var _curMax = body.max_completion_tokens || body.max_tokens || 4096;
                        if (!_maxTokensLimit) {
                            body.max_completion_tokens = Math.floor(_curMax * 0.7);
                            body.max_tokens = Math.floor(_curMax * 0.7);
                        }
                        // _maxTokensLimit 存在时：值已在上面精确设置，无需再改
                        showToast('⚠️ max_tokens 超限，已调整为 ' + (body.max_completion_tokens || body.max_tokens) + ' 后重试...', 'warning', 10000);
                    } else if (_retryAction === 'trim_system') {
                        // 截断 system 消息到 2000 字符
                        for (var _smi = 0; _smi < body.messages.length; _smi++) {
                            if (body.messages[_smi].role === 'system' && typeof body.messages[_smi].content === 'string') {
                                var _sc = body.messages[_smi].content;
                                if (_sc.length > 2000) {
                                    body.messages[_smi].content = _sc.substring(0, 2000) + '\n\n[System prompt truncated to fit context limit]';
                                }
                            }
                        }
                        showToast('⚠️ System prompt 过长，已截断后重试...', 'warning', 8000);
                    } else if (_retryAction === 'fix_tool_args') {
                        // ★ 修复破损的工具调用 JSON，而非删掉全部工具
                        var _fixed = false;
                        var _discardedIds = {}; // ★ 记录被丢弃的 tool_call_id，精确删除对应 tool 结果
                        for (var _tmi = 0; _tmi < body.messages.length; _tmi++) {
                            var _tmsg = body.messages[_tmi];
                            if (_tmsg.role === 'assistant' && _tmsg.tool_calls) {
                                for (var _tcj = 0; _tcj < _tmsg.tool_calls.length; _tcj++) {
                                    var _tcall = _tmsg.tool_calls[_tcj];
                                    if (_tcall.function && typeof _tcall.function.arguments === 'string') {
                                        try { JSON.parse(_tcall.function.arguments); } catch(e) {
                                            // ★ 尝试修复截断/未转义引号的 JSON
                                            var _raw2 = _tcall.function.arguments;
                                            try {
                                                _raw2 = repairToolArguments(_raw2);
                                                JSON.parse(_raw2);
                                                _tcall.function.arguments = _raw2;
                                                _fixed = true;
                                                console.log('[fix_tool_args] 修复 tool_call arguments:', _tcall.function.name);
                                            } catch(e2) {
                                                // 无法修复 → 删除这个 tool_call，记录 id
                                                if (_tcall.id) _discardedIds[_tcall.id] = true;
                                                _tmsg.tool_calls.splice(_tcj, 1);
                                                _tcj--;
                                                _fixed = true;
                                                console.log('[fix_tool_args] 丢弃破损 tool_call:', _tcall.function.name, _tcall.id || '');
                                            }
                                        }
                                    }
                                }
                                // 如果清理后 tool_calls 为空，删除整个字段
                                if (_tmsg.tool_calls.length === 0) {
                                    delete _tmsg.tool_calls;
                                }
                            }
                        }
                        // ★ 同时处理 Anthropic 格式的 tool_result 空 ID
                        for (var _tmi2 = 0; _tmi2 < body.messages.length; _tmi2++) {
                            var _tmsg2 = body.messages[_tmi2];
                            if (_tmsg2.role === 'user' && Array.isArray(_tmsg2.content)) {
                                var _newContent = [];
                                for (var _tci2 = 0; _tci2 < _tmsg2.content.length; _tci2++) {
                                    var _tblock = _tmsg2.content[_tci2];
                                    if (_tblock.type === 'tool_result' && (!_tblock.tool_use_id || _tblock.tool_use_id === '')) {
                                        // 尝试向前查找 tool_use id
                                        for (var _tli2 = _tmi2 - 1; _tli2 >= 0; _tli2--) {
                                            var _prev2 = body.messages[_tli2];
                                            if (_prev2.role === 'assistant' && Array.isArray(_prev2.content)) {
                                                for (var _pci2 = _prev2.content.length - 1; _pci2 >= 0; _pci2--) {
                                                    if (_prev2.content[_pci2].type === 'tool_use' && _prev2.content[_pci2].id) {
                                                        _tblock.tool_use_id = _prev2.content[_pci2].id;
                                                        _fixed = true;
                                                        console.log('[fix_tool_args] 修复 Anthropic tool_use_id:', _tblock.tool_use_id);
                                                        break;
                                                    }
                                                }
                                                if (_tblock.tool_use_id) break;
                                            }
                                        }
                                        // 仍然为空 → 丢弃该 tool_result 块
                                        if (!_tblock.tool_use_id || _tblock.tool_use_id === '') {
                                            _fixed = true;
                                            console.log('[fix_tool_args] 丢弃空 tool_use_id 的 tool_result');
                                            continue; // 不加入 newContent
                                        }
                                    }
                                    _newContent.push(_tblock);
                                }
                                if (_newContent.length !== _tmsg2.content.length) {
                                    _tmsg2.content = _newContent;
                                    // 如果该消息变为空，标记删除
                                    if (_newContent.length === 0) {
                                        _tmsg2._remove = true;
                                    }
                                }
                            }
                        }
                        // 删除标记的消息
                        body.messages = body.messages.filter(function(m) { return !m._remove; });
                        // ★ 只清理对应被丢弃 tool_call 的 tool 结果（保留其他成功的结果）
                        var _hasDiscarded = Object.keys(_discardedIds).length > 0;
                        if (_hasDiscarded) {
                            body.messages = body.messages.filter(function(m) {
                                if (m.role === 'tool' && _discardedIds[m.tool_call_id]) {
                                    console.log('[fix_tool_args] 清理对应 tool 结果:', m.tool_call_id);
                                    return false;
                                }
                                return true;
                            });
                        }
                        // ★ 同时清理孤立的 tool_calls（有有效 JSON 参数但缺少对应 tool 结果）
                        var _orphanToolIds = {};
                        for (var _oj = 0; _oj < body.messages.length; _oj++) {
                            if (body.messages[_oj].role === 'tool' && body.messages[_oj].tool_call_id) {
                                _orphanToolIds[body.messages[_oj].tool_call_id] = true;
                            }
                        }
                        // ★ v2.6: 找到最后一个 assistant 消息的索引，不过滤其 tool_calls（工具仍在执行）
                        var _lastAsstIdx = -1;
                        for (var _lai0 = body.messages.length - 1; _lai0 >= 0; _lai0--) {
                            if (body.messages[_lai0].role === 'assistant' && body.messages[_lai0].tool_calls) {
                                _lastAsstIdx = _lai0;
                                break;
                            }
                        }
                        var _removedOrphans = 0;
                        for (var _ok = 0; _ok < body.messages.length; _ok++) {
                            if (_ok === _lastAsstIdx) continue;  // ★ 跳过最后一轮
                            if (body.messages[_ok].role === 'assistant' && body.messages[_ok].tool_calls) {
                                var _beforeCount = body.messages[_ok].tool_calls.length;
                                body.messages[_ok].tool_calls = body.messages[_ok].tool_calls.filter(function(tc) {
                                    return tc.id && _orphanToolIds[tc.id];
                                });
                                _removedOrphans += _beforeCount - body.messages[_ok].tool_calls.length;
                                if (body.messages[_ok].tool_calls.length === 0) {
                                    delete body.messages[_ok].tool_calls;
                                }
                            }
                        }
                        if (_removedOrphans > 0) {
                            _fixed = true;
                            console.log('[fix_tool_args] 清理 ' + _removedOrphans + ' 个孤立 tool_calls（无对应 tool 消息）');
                        }
                        // ★ 同时清理孤立 tool 消息：收集剩余有效的 tool_call_id
                        var _validTcIds = {};
                        for (var _vk = 0; _vk < body.messages.length; _vk++) {
                            if (body.messages[_vk].role === 'assistant' && body.messages[_vk].tool_calls) {
                                body.messages[_vk].tool_calls.forEach(function(tc) { if (tc.id) _validTcIds[tc.id] = true; });
                            }
                        }
                        body.messages = body.messages.filter(function(m) {
                            if (m.role === 'tool' && m.tool_call_id && !_validTcIds[m.tool_call_id]) {
                                console.log('[fix_tool_args] 清理孤立 tool 结果:', m.tool_call_id);
                                _fixed = true;
                                return false;
                            }
                            return true;
                        });
                        showToast('⚠️ 工具调用异常，已自动修复后重试...', 'warning', 8000);
                    } else if (_retryAction === 'remove_tools') {
                        delete body.tools;
                        delete body.tool_choice;
                        // 清理 assistant 消息中的 tool_calls
                        for (var _mi2 = 0; _mi2 < body.messages.length; _mi2++) {
                            if (body.messages[_mi2].role === 'assistant') delete body.messages[_mi2].tool_calls;
                        }
                        // ★ 关键: 同时删除所有 tool 角色消息，否则孤立的 tool_call_id 会再次 400
                        body.messages = body.messages.filter(function(m) { return m.role !== 'tool'; });
                        // ★ 持久化: 记住此模型不支持工具
                        var _noToolList = JSON.parse(localStorage.getItem('noToolModels') || '[]');
                        var _curModelLower = (getVal('modelSelect') || '').toLowerCase();
                        if (_curModelLower && _noToolList.indexOf(_curModelLower) === -1) {
                            _noToolList.push(_curModelLower);
                            localStorage.setItem('noToolModels', JSON.stringify(_noToolList));
                        }
                        showToast('⚠️ 此模型不支持工具调用，已切换为普通模式', 'warning', 8000);

                        // ★ 联网搜索回退: 工具不可用时，自动用预注入模式补搜索
                        if (typeof handleSearchFlow === 'function' && getChecked('searchToggle') && typeof text !== 'undefined') {
                            try {
                                var _searchCtrl = new AbortController();
                                var _searchTimer = setTimeout(function() { _searchCtrl.abort(); }, 8000);
                                var _sr = await handleSearchFlow(chatId, text, true, queryText || text, historySummary, _searchCtrl.signal, currentBubble, null);
                                clearTimeout(_searchTimer);
                                if (_sr && _sr.optimized && !_searchCtrl.signal.aborted) {
                                    // 注入搜索结果到系统提示词(放在已有 system 消息最前面)
                                    var _sysIdx = -1;
                                    for (var _si = 0; _si < body.messages.length; _si++) {
                                        if (body.messages[_si].role === 'system') { _sysIdx = _si; break; }
                                    }
                                    if (_sysIdx >= 0) {
                                        body.messages[_sysIdx].content = _sr.optimized + '\n\n' + body.messages[_sysIdx].content;
                                    } else {
                                        body.messages.unshift({ role: 'system', content: _sr.optimized });
                                    }
                                    showToast('🔍 已自动联网搜索并注入上下文', 'success', 5000);
                                }
                            } catch(_se) {
                                console.warn('[Search-Fallback] 搜索回退失败:', _se.message);
                            }
                        }
                    } else if (_retryAction === 'strip_images') {
                        // ★ 图片敏感: 从所有消息中移除 image_url 内容，只保留文本
                        var _siStripped = 0;
                        for (var _sii = 0; _sii < body.messages.length; _sii++) {
                            var _smsg = body.messages[_sii];
                            if (Array.isArray(_smsg.content)) {
                                var _origLen = _smsg.content.length;
                                _smsg.content = _smsg.content.filter(function(_c) {
                                    if (_c.type === 'image_url') { _siStripped++; return false; }
                                    return true;
                                });
                                // 如果只剩一项文本，还原为字符串格式
                                if (_smsg.content.length === 1 && _smsg.content[0].type === 'text') {
                                    _smsg.content = _smsg.content[0].text;
                                }
                            }
                        }
                        console.log('[strip_images] 移除 ' + _siStripped + ' 个敏感图片后重试');
                        showToast('⚠️ 图片被安全过滤，已移除 ' + _siStripped + ' 张图片后重试...', 'warning', 6000);
                    } else if (_retryAction === 'safety_filter') {
                        // ★ RS直连回退: 不做任何精简, 直接重试
                        if (window.__rsFallbackRetry) {
                            window.__rsFallbackRetry = false;
                            console.log('[safety_filter] RS回退直连, 保留完整消息直接重试');
                        } else {
                            // ★ DeepSeek Content Exists Risk: 激进精简策略
                        // 已知触发因素: 长篇system prompt,大量工具描述,多轮tool_call历史
                        // 策略: 移除system prompt → 裁剪对话历史 → 清除工具消息 → 仅保留最后几轮纯文本对话
                        var _sfStripped = 0;
                        // 1. 完全移除 system 消息（包含工具描述等触发内容）
                        body.messages = body.messages.filter(function(m) { return m.role !== 'system'; });
                        // 2. 移除所有 tool_calls 和 tool 消息（DeepSeek 过敏历史工具交互）
                        body.messages = body.messages.filter(function(m) {
                            if (m.role === 'tool') { _sfStripped++; return false; }
                            if (m.role === 'assistant' && m.tool_calls) {
                                // 移除 tool_calls 但保留文本内容（如果有）
                                delete m.tool_calls;
                                if (!m.content || (typeof m.content === 'string' && m.content.trim() === '')) {
                                    _sfStripped++; return false;
                                }
                            }
                            return true;
                        });
                        // 3. 裁剪到最近 6 条消息（保持对话连贯性）
                        if (body.messages.length > 6) {
                            _sfStripped += body.messages.length - 6;
                            body.messages = body.messages.slice(-6);
                        }
                        // 4. 移除 tools 参数（减少触发可能性）
                        delete body.tools;
                        delete body.tool_choice;
                        // 5. 缩减 max_tokens 避免输出过长触发风险
                        if (body.max_tokens && body.max_tokens > 4096) body.max_tokens = 4096;
                        console.log('[safety_filter] 激进精简完成, 移除 ' + _sfStripped + ' 条消息, 剩余 ' + body.messages.length + ' 条');
                        showToast('⚠️ 内容安全过滤, 已精简上下文(' + body.messages.length + '条消息)后重试...', 'warning', 6000);
                        } // end else (non-RS-fallback safety_filter)
                    } else if (_retryAction === 'clean_params') {
                        // 清理可能有问题的参数
                        delete body.top_p;
                        delete body.frequency_penalty;
                        delete body.presence_penalty;
                        delete body.logit_bias;
                        delete body.stop;
                        showToast('⚠️ 参数异常，已清理后重试...', 'warning', 8000);
                    } else {
                        // generic_retry: 显示完整错误详情，持续 12 秒便于排查
                        var _shortMsg = _errMsg.substring(0, 200);
                        console.error('[400-Detail]', _errMsg);
                        showToast('🔴 HTTP 400: ' + _shortMsg + ' (' + (attempt + 1) + '/' + maxRetries + ' 重试中...)', 'error', 12000);
                    }

                    // 清理 pendingMsg 以便重试
                    if (pendingMsg) {
                        pendingMsg.content = '';
                        pendingMsg.reasoning = '';
                    }

                    var _delay400 = Math.min(1000 * Math.pow(2, attempt), 8000);
                    await new Promise(function(r) { return setTimeout(r, _delay400); });
                    try { abortCtrl.abort(); } catch(e) {}
                    var _retryCtrl400 = new AbortController();
                    abortControllerMap[chatId] = _retryCtrl400;
                    clearTimeout(timeoutIdVal);
                    var _retryTimeout400 = setTimeout(function() { _retryCtrl400.abort(); }, timeout);
                    return attemptRequestWithFreshAbort(attempt + 1, _retryCtrl400, _retryTimeout400);
                }
            }

            if (isNetError && attempt < maxRetries) {
                var delay = Math.min(1000 * Math.pow(2, attempt), 8000);
                showToast(`网络超时,${attempt + 1}/${maxRetries},${(delay/1000).toFixed(0)}s后重试...`, 'warning', 3000);
                await new Promise(r => setTimeout(r, delay));
                // ★ 重试前先杀死旧请求,避免新旧请求并发
                try { abortCtrl.abort(); } catch(e) {}
                var newAbortCtrl = new AbortController();
                abortControllerMap[chatId] = newAbortCtrl;
                clearTimeout(timeoutIdVal);
                var newTimeoutVal = timeout;
                var newTimeoutId = setTimeout(() => newAbortCtrl.abort(), newTimeoutVal);
                return attemptRequestWithFreshAbort(attempt + 1, newAbortCtrl, newTimeoutId);
            }
            throw e;
        }
    }

    try {
        await attemptRequestWithFreshAbort(0, abortMain, timeoutId);
    } catch (e) {
        // ★ 死循环检测: 硬中止错误 → 展示原因/消耗/建议, 不再重试(重试只会继续烧 token)
        if (e && e.loopGuard) {
            var _lgModelName = getVal('modelSelect') || '未知';
            e.message = '❌ ' + e.message + '。模型: ' + _lgModelName +
                ' | 本轮已消耗: ' + (sessionUsage.completionTokens || 0) + ' output tokens / ' +
                (sessionUsage.promptTokens || 0) + ' input tokens';
            handleError(e, chatId, pendingMsg, currentBubble);
            // 追加详情区块(触发原因/建议)
            try {
                var _lgErrDetail = document.createElement('div');
                _lgErrDetail.className = 'error-detail';
                _lgErrDetail.style.cssText = 'margin-top:8px;padding:8px 10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;font-size:12px;color:#9ca3af;line-height:1.7;word-break:break-all;';
                _lgErrDetail.innerHTML =
                    '⚠️ <b>死循环检测触发</b>: ' + escapeHtml(e.loopGuard.reason) + '<br>' +
                    '模型: ' + escapeHtml(_lgModelName) +
                    ' | 耗时: ' + Math.round((Date.now() - startTime) / 1000) + 's' +
                    ' | 本轮 tokens: ' + ((sessionUsage.completionTokens || 0) + (sessionUsage.promptTokens || 0)) + '<br>' +
                    '建议: ① 切换更强模型重试 ② 清空上下文重新发送 ③ 如为误报可在 设置→Agent 模式 关闭「死循环检测」';
                var _lgBubble = currentBubble || (activeBubbleMap && activeBubbleMap[chatId]);
                if (_lgBubble) {
                    var _lgBody = _lgBubble.querySelector('.markdown-body');
                    (_lgBody || _lgBubble).appendChild(_lgErrDetail);
                }
            } catch(_lgDispErr) {}
            return;
        }
        // ★ 智能错误恢复: image_url 格式错误 → 自动切换为分析工具模式重试
        if (e.message && (e.message.includes('unknown variant') || e.message.includes('image_url'))) {
            var retried = await autoDetectAndRetryImageUrlError(e.message, chatId, pendingMsg, currentBubble);
            if (retried) return;
        }
        // ★ 智能降级(外层兜底): 模型不支持工具调用
        if (e.message && e.message.includes('does not support tools')) {
            var _ocModel = getVal('modelSelect') || '';
            var _ocList = JSON.parse(localStorage.getItem('noToolModels') || '[]');
            var _ocCore = (_ocModel || '').replace(/:.*$/, '').toLowerCase();
            if (_ocList.indexOf(_ocCore) === -1 && _ocCore) {
                _ocList.push(_ocCore);
                localStorage.setItem('noToolModels', JSON.stringify(_ocList));
            }
            // 删掉失败的助手消息,重新发送
            if (chatId && chats[chatId]) {
                var _ocMsgs = chats[chatId].messages;
                for (var _oci = _ocMsgs.length - 1; _oci >= 0; _oci--) {
                    if (_ocMsgs[_oci].role === 'assistant' && _ocMsgs[_oci].partial) {
                        _ocMsgs.splice(_oci, 1);
                        break;
                    }
                }
                saveChats();
            }
            showToast('⚠️ 模型不支持工具调用,已切换模式,请重新发送', 'warning', 8000);
            // 不清除 pendingMsg,让用户看到气泡
            if (currentBubble) {
                currentBubble.classList.remove('typing', 'gen-active', 'streaming');
                var _ocMb = currentBubble.querySelector('.markdown-body');
                if (_ocMb) _ocMb.innerHTML = '⚠️ 该模型不支持工具调用,已自动降级为普通模式。请重新发送。';
            }
            if (pendingMsg) {
                delete pendingMsg.partial;
                pendingMsg.content = '⚠️ 该模型不支持工具调用,已自动降级为普通模式。请重新发送。';
            }
            return; // 不走到 handleError
        }
        // ★ 402 余额不足自动降级: 提取可负担的 token 数，降低 max_tokens 后重试
        if (e.message && /402|credits|insufficient|can only afford/i.test(e.message)) {
            var _affordable = null;
            var _creditsMatch402 = e.message.match(/can only afford (\d+)/i);
            if (_creditsMatch402) _affordable = parseInt(_creditsMatch402[1]);
            if (_affordable && _affordable > 256 && requestedTokens > _affordable) {
                var _reduced402 = Math.floor(_affordable * 0.9);
                console.log('[402降级] 原 max_tokens=' + requestedTokens + ' → ' + _reduced402 + ' (可负担: ' + _affordable + ')');
                requestedTokens = _reduced402;
                body.max_tokens = _reduced402;
                if (pendingMsg) { pendingMsg.content = ''; pendingMsg.reasoning = ''; if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; } }
                cleanupStreamState(chatId);
                if (currentBubble) {
                    currentBubble.classList.remove('typing', 'gen-active', 'streaming');
                    var _mb402 = currentBubble.querySelector('.markdown-body');
                    if (_mb402) _mb402.innerHTML = '';
                }
                showToast('余额不足，已自动降低 max_tokens 至 ' + _reduced402 + '，重试中...', 'warning', 3000);
                try { abortMain.abort(); } catch(_e402) {}
                var _retryCtrl402 = new AbortController();
                abortControllerMap[chatId] = _retryCtrl402;
                var _retryTimeout402 = setTimeout(function() { _retryCtrl402.abort(); }, timeout);
                try {
                    await attemptRequestWithFreshAbort(0, _retryCtrl402, _retryTimeout402);
                } catch(_retryErr402) {
                    handleError(_retryErr402, chatId, pendingMsg, currentBubble);
                }
                return;
            }
        }
        // ★ 503/auth_unavailable 瞬态错误自动重试 (CLIProxyAPI 认证临时不可用,token 刷新/提供商轮换可能恢复)
        if (e.message && (/503/.test(e.message)) && (/auth_unavailable|service_unavailable|no auth available/.test(e.message))) {
            var _503Key = '_503retry_' + chatId;
            var _503Count = (window[_503Key] || 0);
            if (_503Count < 3) {
                window[_503Key] = _503Count + 1;
                console.warn('[503-Retry] 检测到 auth_unavailable，自动重试 (' + (_503Count + 1) + '/3):', e.message);
                showToast('⚠️ 服务暂时不可用 (auth_unavailable)，正在自动重试 (' + (_503Count + 1) + '/3)...', 'warning', 3000);
                if (pendingMsg) { pendingMsg.content = ''; pendingMsg.reasoning = ''; if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; } }
                cleanupStreamState(chatId);
                if (currentBubble) {
                    currentBubble.classList.remove('typing', 'gen-active', 'streaming');
                    var _mb503 = currentBubble.querySelector('.markdown-body');
                    if (_mb503) _mb503.innerHTML = '';
                }
                try { abortMain.abort(); } catch(_e503) {}
                var _retryCtrl503 = new AbortController();
                abortControllerMap[chatId] = _retryCtrl503;
                clearTimeout(timeoutId);
                var _retryTimeout503 = setTimeout(function() { _retryCtrl503.abort(); }, timeout);
                var _503Delay = 2000 * Math.pow(1.5, _503Count); // 2s, 3s, 4.5s
                await new Promise(function(_r503) { setTimeout(_r503, _503Delay); }); // ★ 退避等待上游恢复
                try {
                    await attemptRequestWithFreshAbort(0, _retryCtrl503, _retryTimeout503);
                } catch(_retryErr503) {
                    handleError(_retryErr503, chatId, pendingMsg, currentBubble);
                }
                return;
            }
            // 重试次数用尽，清理计数
            delete window[_503Key];
        }
        handleError(e, chatId, pendingMsg, currentBubble);
    } finally {
        // ★ 停止按钮修复: 若已有新请求接管当前聊天, 跳过所有状态清理(防止新请求被误停)
        if (window._msgReqGen && window._msgReqGen[chatId] !== _myReqGen) {
            console.log('[sendMessage] 请求#' + _myReqGen + '已过期, 新请求#' + window._msgReqGen[chatId] + '接管, 跳过finally清理');
            return;
        }
        // 清理临时消息(保留子代理通知)
        chats[chatId].messages = chats[chatId].messages.filter(m => !m.temporary || m._agentNotification);
        // ★ 死循环检测: 释放会话级 guard(已被 _myReqGen 保护, 不会误删新请求实例)
        if (window.__loopGuardMap && window.__loopGuardMap[chatId]) {
            delete window.__loopGuardMap[chatId];
        }
        delete isTypingMap[chatId];
        if (window._activeStreamChatId === chatId) window._activeStreamChatId = null;  // ★ 清除活动流标记
        if (typeof renderChatHistory === 'function') renderChatHistory();  // 清除后台指示器
        // ★ agent模式:AI生成结束,关闭队列轮询 + 处理下一条
        // AI生成结束:处理队列下一条消息
        if (window._queuePollTimer) {
            clearInterval(window._queuePollTimer);
            window._queuePollTimer = null;
        }
        // ★ 推入消息: 当前回复结束后自动触发新一轮 (模型会看到推入的用户消息)
        // 但用户主动停止时不自动续接 (userAbortMap 在下方被删除, 此处提前判断)
        if (window._hasInjectedMessage && !userAbortMap[chatId]) {
            window._hasInjectedMessage = false;
            setTimeout(function() {
                // sendMessage(true) = skipUserAdd, 推入的消息已在历史中, 模型会看到并回复
                if (!isTypingMap[chatId] && typeof window.sendMessage === 'function') {
                    window.sendMessage(true);
                }
            }, 500);
        } else {
            window._hasInjectedMessage = false;  // 清除标记, 避免残留
            setTimeout(function() { window._drainQueue(); }, 300);
        }
        // ★ 子代理完成自动回复: 如果之前因子代理忙而设置了这个标记,现在触发主代理回复
        //   (严格分隔: 只发送到设置标记时对应的聊天 _pendingAgentReplyChatId,
        //   防止用户切走后整合消息发进其他聊天)
        if (window._pendingAgentReply && !userAbortMap[chatId]) {
            var _intendedChat = window._pendingAgentReplyChatId || null;
            window._pendingAgentReply = false;
            window._pendingAgentReplyChatId = null;
            setTimeout(function() {
                if (typeof window.sendMessage !== 'function') return;
                if (_intendedChat && _intendedChat !== currentChatId) {
                    // ★ 用户已切到其他聊天: 同域则切回目标聊天再发送(与直接路径一致),跨域则跳过
                    var _sameDomain = (typeof isAgentToolsActive === 'function') && (typeof isAgentChat === 'function') &&
                        (isAgentToolsActive() === isAgentChat(_intendedChat));
                    if (_sameDomain && chats[_intendedChat]) {
                        console.log('[sendMessage] 子代理回复目标聊天非当前,切回: ' + _intendedChat);
                        loadChat(_intendedChat).then(function() {
                            if (!isTypingMap[_intendedChat] && typeof window.sendMessage === 'function') {
                                window.sendMessage(true, '请整合子代理结果并告知用户进展');
                            }
                        });
                    } else {
                        // 跨域: 用户已离开目标聊天所在模式 → 跳过(整合消息已留在目标聊天历史)
                        console.log('[sendMessage] 子代理回复跨域,跳过发送: intended=' + _intendedChat + ' current=' + currentChatId);
                    }
                    return;
                }
                if (!isTypingMap[chatId] && typeof window.sendMessage === 'function') {
                    console.log('[sendMessage] 子代理回复标记触发,发送整合消息');
                    window.sendMessage(true, '请整合子代理结果并告知用户进展');
                }
            }, 800);
        }
        // ★ 停止流渲染 RAF 循环
        cleanupStreamState(chatId);
        delete abortControllerMap[chatId];
        delete searchAbortControllerMap[chatId];
        delete activeBubbleMap[chatId];
        delete userAbortMap[chatId];  // 清理用户中止标记
        window._agentNotifyProcessing = false;
        // ★ 主动检查是否有积压的子代理通知需要处理
        if (window._hasPendingSubAgentNotify || (Array.isArray(window._agentNotifyQueue) && window._agentNotifyQueue.length > 0)) {
            window._hasPendingSubAgentNotify = false;
            setTimeout(function() { window._processAgentNotifyQueue(); }, 500);
        }
        if (currentChatId === chatId) {
            if ($.sendBtn) $.sendBtn.classList.remove('hidden');
            if ($.stopBtn) $.stopBtn.classList.remove('visible');
        }
        // ★ 免全量重建: 流正常完成时已在 completion 块就地收尾(操作按钮/页脚/mermaid),
        //   此处不再 loadChat 重建整个消息列表(长对话每轮回复省下数百次 DOM 重建 + 动画)
        //   出错/中止等异常路径保留 loadChat, 保证 DOM 与历史一致
        if (currentChatId === chatId && !window._streamCompletedOk) loadChat(chatId);
        // ★ 计划面板兜底：回复结束时，将仍为 running 的任务标记为 failed
        // ★ 但若仍有活跃子代理在运行，跳过兜底（子代理完成后会自动更新计划状态）
        if (window._agentPlan && window._agentPlan.tasks && window._agentPlan.status === 'running') {
            var _hasActiveSubAgents = false;
            if (window._tasks && typeof window._tasks === 'object') {
                for (var __tk in window._tasks) {
                    var __t = window._tasks[__tk];
                    if (__t && __t.agents) {
                        for (var __ak in __t.agents) {
                            if (__t.agents[__ak].status === 'running') { _hasActiveSubAgents = true; break; }
                        }
                    }
                    if (_hasActiveSubAgents) break;
                }
            }
            if (_hasActiveSubAgents) {
                console.log('[FlowPanel] 跳过兜底: 仍有活跃子代理运行中，计划面板保持显示');
            } else {
                var _hasStuck = false;
                window._agentPlan.tasks.forEach(function(pt) {
                    if (pt.status === 'running') { pt.status = 'failed'; pt.note = '回复中断，任务未完成'; _hasStuck = true; }
                    if (pt.status === 'pending') { pt.status = 'skipped'; _hasStuck = true; }
                });
                if (_hasStuck) {
                    window.renderPlanTasks(window._agentPlan.tasks);
                    window._agentPlan.status = 'completed';
                    console.log('[FlowPanel] 兜底: 标记 ' + window._agentPlan.tasks.filter(function(t){return t.status==='failed'||t.status==='skipped'}).length + ' 个卡住的任务');
                    setTimeout(function() { window.dismissFlowPanel(); }, 3000);
                }
            }
        }
        // ★ 已完成/已关闭计划面板的最终清理
        if (window._agentPlan && window._agentPlan.status === 'completed') {
            console.log('[FlowPanel] 响应结束,清理已完成计划面板');
            window.dismissFlowPanel();
        }
        // ★ AI 自主记忆: 对话结束后延迟提取(避开主请求避免抢额度→429)
        if (!window.__autoMemoryPending) {
            window.__autoMemoryPending = true;
            setTimeout(function() {
                window._autoSaveMemoriesFromChat(chatId).catch(function(){});
                window.__autoMemoryPending = false;
            }, 5000);  // ★ 5秒延迟,避免与下一轮主请求同时到达API
        }
        if (Object.keys(isTypingMap).length === 0) localStorage.removeItem('ongoingChats');
        else saveOngoingChatsSnapshot();
    }
};
