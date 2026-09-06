// core.js — 核心运行时 v1.0 (Phase 0 拆分自 main.js)
// 全局常量、数学公式保护、跨域Cookie、安全Fetch、DOM工具、加密、工具函数

// ==== APP_LOGGER_BOOTSTRAP_START ====
// 统一浏览器日志：生产默认仅显示 warn/error；调试日志保留在内存环形缓冲区。
// 临时调试：AppLogger.setLevel('debug')，或在 URL 添加 ?log=debug / ?debug=1。
(function initOneApiChatLogger(global) {
    'use strict';
    if (!global || (global.AppLogger && global.AppLogger.__oneApiChatLogger)) return;

    var targetConsole = global.console || {};
    var methodNames = ['debug', 'log', 'info', 'warn', 'error'];
    var originalConsole = {};
    var nativeConsole = {};
    methodNames.forEach(function(name) {
        var fn = targetConsole[name];
        originalConsole[name] = fn;
        nativeConsole[name] = typeof fn === 'function'
            ? Function.prototype.bind.call(fn, targetConsole)
            : function() {};
    });

    var LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
    var STORAGE_KEY = 'oc_log_level';
    var RECENT_LIMIT = 200;
    var DEDUPE_LIMIT = 400;
    var MAX_STRING_INPUT = 12000;
    var MAX_STRING_OUTPUT = 4000;
    var MAX_DEPTH = 4;
    var MAX_KEYS = 40;
    var MAX_ARRAY = 40;
    var state = {
        level: 'warn',
        dedupeWindow: 3000,
        recent: [],
        dedupe: new Map(),
        bridgeInstalled: false,
        emitted: 0,
        folded: 0,
        suppressed: 0
    };

    function normalizeLevel(value) {
        value = String(value || '').trim().toLowerCase();
        if (value === 'verbose') value = 'debug';
        if (value === 'none' || value === 'off') value = 'silent';
        return Object.prototype.hasOwnProperty.call(LEVELS, value) ? value : '';
    }

    function readQueryValue(name) {
        try {
            var search = global.location && global.location.search ? global.location.search : '';
            var match = search.match(new RegExp('(?:^|[?&])' + name + '=([^&]*)', 'i'));
            return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
        } catch(e) { return ''; }
    }

    function readStoredLevel() {
        try {
            return global.sessionStorage ? normalizeLevel(global.sessionStorage.getItem(STORAGE_KEY)) : '';
        } catch(e) { return ''; }
    }

    function resolveInitialLevel() {
        var explicit = normalizeLevel(global.__ONEAPICHAT_LOG_LEVEL__);
        if (explicit) return explicit;
        var queryLevel = normalizeLevel(readQueryValue('log'));
        if (queryLevel) return queryLevel;
        if (readQueryValue('debug') === '1') return 'debug';
        return readStoredLevel() || 'warn';
    }

    function truncateString(value) {
        var text = String(value);
        var originalLength = text.length;
        if (text.length > MAX_STRING_INPUT) text = text.substring(0, MAX_STRING_INPUT);
        if (text.length > MAX_STRING_OUTPUT) text = text.substring(0, MAX_STRING_OUTPUT);
        if (originalLength > text.length) text += '…[truncated ' + (originalLength - text.length) + ' chars]';
        return text;
    }

    function redactString(value) {
        var text = truncateString(value);
        text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+\/=-]{6,}/gi, '$1[REDACTED]');
        text = text.replace(/(https?:\/\/[^\/\s:@]+:)[^@\s\/]+@/gi, '$1[REDACTED]@');
        text = text.replace(/([?&](?:auth(?:_?token)?|access_?token|refresh_?token|api_?key|apikey|key|password|passwd|secret|code)=)[^&#\s]*/gi, '$1[REDACTED]');
        text = text.replace(/(["'](?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|apikey|auth[_-]?token|access[_-]?token|refresh[_-]?token|password|passwd|secret|credential|session(?:_id)?|content|prompt|messages|args|arguments|body|response(?:text)?|提取码)["']\s*:\s*)(["'])(.*?)\2/gi, function(_m, prefix, quote) {
            return prefix + quote + '[REDACTED]' + quote;
        });
        text = text.replace(/(\b(?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|apikey|auth[_-]?token|access[_-]?token|refresh[_-]?token|password|passwd|secret|credential|session(?:_id)?|content|prompt|messages|args|arguments|body|response(?:text)?|提取码)\b\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]');
        return text;
    }

    function isSensitiveKey(key) {
        return /^(?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|apikey|key|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|credential|session(?:_id)?|content|prompt|messages|args|arguments|body|response(?:text)?|提取码)$/i.test(String(key || ''));
    }

    function safeValue(value, depth, seen) {
        if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
        if (value === undefined) return '[undefined]';
        if (typeof value === 'string') return redactString(value);
        if (typeof value === 'bigint') return String(value) + 'n';
        if (typeof value === 'symbol') return String(value);
        if (typeof value === 'function') return '[Function ' + (value.name || 'anonymous') + ']';
        if (depth >= MAX_DEPTH) return '[MaxDepth]';

        if (value instanceof Error) {
            return {
                name: redactString(value.name || 'Error'),
                message: redactString(value.message || ''),
                stack: redactString(value.stack || '')
            };
        }

        if (seen.indexOf(value) !== -1) return '[Circular]';
        seen.push(value);
        try {
            if (Array.isArray(value)) {
                var arr = value.slice(0, MAX_ARRAY).map(function(item) { return safeValue(item, depth + 1, seen); });
                if (value.length > MAX_ARRAY) arr.push('[+' + (value.length - MAX_ARRAY) + ' items]');
                return arr;
            }

            var proto;
            try { proto = Object.getPrototypeOf(value); } catch(e) { return '[Uninspectable Object]'; }
            if (proto !== Object.prototype && proto !== null) {
                if (value && value.nodeType && value.nodeName) return '[DOM ' + String(value.nodeName).toUpperCase() + ']';
                if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
                return '[' + ((value && value.constructor && value.constructor.name) || 'Object') + ']';
            }

            var out = {};
            var keys;
            try { keys = Object.keys(value).sort(); } catch(e2) { return '[Uninspectable Object]'; }
            keys.slice(0, MAX_KEYS).forEach(function(key) {
                if (isSensitiveKey(key)) {
                    out[key] = '[REDACTED]';
                    return;
                }
                try {
                    var descriptor = Object.getOwnPropertyDescriptor(value, key);
                    out[key] = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
                        ? safeValue(descriptor.value, depth + 1, seen)
                        : '[Accessor]';
                } catch(e3) {
                    out[key] = '[Uninspectable]';
                }
            });
            if (keys.length > MAX_KEYS) out.__truncatedKeys = keys.length - MAX_KEYS;
            return out;
        } finally {
            seen.pop();
        }
    }

    function sanitizeArgs(argsLike) {
        return Array.prototype.slice.call(argsLike || []).map(function(value) {
            try { return safeValue(value, 0, []); } catch(e) { return '[Uninspectable]'; }
        });
    }

    function normalizeNamespace(value) {
        var text = String(value || 'App').replace(/[\r\n\t\[\]]+/g, ' ').trim();
        return (text || 'App').substring(0, 48);
    }

    function parseNamespace(args, forcedNamespace) {
        var namespace = normalizeNamespace(forcedNamespace || 'App');
        if (!forcedNamespace && typeof args[0] === 'string') {
            var match = args[0].match(/^\s*\[([^\]]{1,48})\]\s*/);
            if (match) {
                namespace = normalizeNamespace(match[1]);
                args[0] = args[0].substring(match[0].length);
            }
        }
        return namespace;
    }

    function messageText(args) {
        return args.map(function(value) {
            if (typeof value === 'string') return value;
            try { return JSON.stringify(value); } catch(e) { return String(value); }
        }).join(' ').substring(0, 1200);
    }

    function classify(level, args) {
        var text = messageText(args);
        if (/No character metrics for .* in style/.test(text)
            || /Element previously highlighted\. To highlight again/.test(text)) {
            return { level: 'debug', suppressed: true };
        }

        if (level === 'warn') {
            var finalFailure = /(?:也失败|最终失败|重试(?:也)?失败|重试耗尽|不可重试|已达上限|所有降级均失败|仍未加载|无法回退|放弃|fatal|unrecoverable|permanent)/i.test(text);
            if (!finalFailure && /(?:用户已停止|已忽略|保护性跳过|自动跳过|软跳过|跳过发送|防止覆盖|等待.*加载|未加载.*等待|自动(?:修复|修正|调整|降级))/i.test(text)) {
                return { level: 'debug', suppressed: false };
            }
            if (!finalFailure && /(?:回退(?:到|使用)|fallback|后重试|重试中|自动重试|将自动重试|准备重试|reconnect|retrying|尝试.*(?:代理|备用))/i.test(text)) {
                return { level: 'info', suppressed: false };
            }
        }
        return { level: level, suppressed: false };
    }

    function dedupeKey(level, namespace, args) {
        return level + '|' + namespace + '|' + messageText(args);
    }

    function trimDedupe(now) {
        if (state.dedupe.size <= DEDUPE_LIMIT) return;
        state.dedupe.forEach(function(value, key) {
            if (now - value.lastAt > state.dedupeWindow * 4) state.dedupe.delete(key);
        });
        if (state.dedupe.size <= DEDUPE_LIMIT) return;
        var removeCount = state.dedupe.size - DEDUPE_LIMIT;
        state.dedupe.forEach(function(_value, key) {
            if (removeCount-- > 0) state.dedupe.delete(key);
        });
    }

    function remember(level, namespace, args, suppressed) {
        var now = Date.now();
        var key = dedupeKey(level, namespace, args);
        var previous = state.dedupe.get(key);
        var canFold = level !== 'error' && previous && (now - previous.lastAt) < state.dedupeWindow;
        if (canFold) {
            previous.lastAt = now;
            previous.entry.count += 1;
            state.folded += 1;
            return { emit: false, entry: previous.entry };
        }

        var entry = {
            ts: now,
            level: level,
            namespace: namespace,
            args: args,
            count: 1,
            suppressed: !!suppressed
        };
        state.recent.push(entry);
        if (state.recent.length > RECENT_LIMIT) state.recent.splice(0, state.recent.length - RECENT_LIMIT);
        if (level !== 'error') state.dedupe.set(key, { lastAt: now, entry: entry });
        trimDedupe(now);
        return { emit: true, entry: entry };
    }

    function shouldOutput(level) {
        return LEVELS[level] <= LEVELS[state.level] && state.level !== 'silent';
    }

    function output(level, namespace, args) {
        var prefix = '[OneAPIChat][' + level.toUpperCase() + '][' + namespace + ']';
        var outputArgs = args.slice();
        if (typeof outputArgs[0] === 'string') outputArgs[0] = prefix + (outputArgs[0] ? ' ' + outputArgs[0] : '');
        else outputArgs.unshift(prefix);
        var method = level === 'debug' ? 'log' : level;
        nativeConsole[method].apply(null, outputArgs);
        state.emitted += 1;
    }

    function emit(level, argsLike, forcedNamespace) {
        level = normalizeLevel(level) || 'info';
        var args = sanitizeArgs(argsLike);
        var namespace = parseNamespace(args, forcedNamespace);
        var classification = classify(level, args);
        var remembered = remember(classification.level, namespace, args, classification.suppressed);
        if (classification.suppressed) {
            state.suppressed += 1;
            return;
        }
        if (!remembered.emit || !shouldOutput(classification.level)) return;
        output(classification.level, namespace, args);
    }

    function installConsoleBridge() {
        if (state.bridgeInstalled) return;
        targetConsole.debug = function() { emit('debug', arguments); };
        targetConsole.log = function() { emit('debug', arguments); };
        targetConsole.info = function() { emit('info', arguments); };
        targetConsole.warn = function() { emit('warn', arguments); };
        targetConsole.error = function() { emit('error', arguments); };
        state.bridgeInstalled = true;
    }

    function restoreConsole() {
        methodNames.forEach(function(name) {
            if (originalConsole[name] !== undefined) targetConsole[name] = originalConsole[name];
        });
        state.bridgeInstalled = false;
    }

    function setLevel(level, persist) {
        var normalized = normalizeLevel(level);
        if (!normalized) throw new Error('Unsupported log level: ' + level);
        state.level = normalized;
        if (persist !== false) {
            try {
                if (global.sessionStorage) global.sessionStorage.setItem(STORAGE_KEY, normalized);
            } catch(e) {}
        }
        return state.level;
    }

    function resetLevel() {
        try {
            if (global.sessionStorage) global.sessionStorage.removeItem(STORAGE_KEY);
        } catch(e) {}
        state.level = 'warn';
        return state.level;
    }

    function cloneRecent(entry) {
        try { return JSON.parse(JSON.stringify(entry)); }
        catch(e) { return { ts: entry.ts, level: entry.level, namespace: entry.namespace, count: entry.count }; }
    }

    function child(namespace) {
        namespace = normalizeNamespace(namespace);
        return {
            debug: function() { emit('debug', arguments, namespace); },
            info: function() { emit('info', arguments, namespace); },
            warn: function() { emit('warn', arguments, namespace); },
            error: function() { emit('error', arguments, namespace); }
        };
    }

    state.level = resolveInitialLevel();
    global.AppLogger = {
        __oneApiChatLogger: true,
        debug: function() { emit('debug', arguments); },
        info: function() { emit('info', arguments); },
        warn: function() { emit('warn', arguments); },
        error: function() { emit('error', arguments); },
        child: child,
        create: child,
        setLevel: setLevel,
        getLevel: function() { return state.level; },
        resetLevel: resetLevel,
        enableDebug: function() { return setLevel('debug'); },
        disableDebug: function() { return setLevel('warn'); },
        getRecent: function(options) {
            options = options || {};
            return state.recent.filter(function(entry) {
                return (!options.level || entry.level === options.level)
                    && (!options.namespace || entry.namespace === options.namespace)
                    && (options.includeSuppressed !== false || !entry.suppressed);
            }).map(cloneRecent);
        },
        clearRecent: function() { state.recent.length = 0; state.dedupe.clear(); },
        getStats: function() {
            return { emitted: state.emitted, folded: state.folded, suppressed: state.suppressed, buffered: state.recent.length };
        },
        dump: function(filter) {
            var items = state.recent.slice();
            if (filter) {
                var f = String(filter).toLowerCase();
                items = items.filter(function(it) {
                    return (it.level && it.level.toLowerCase().indexOf(f) !== -1)
                        || (it.namespace && it.namespace.toLowerCase().indexOf(f) !== -1)
                        || messageText(it.args).toLowerCase().indexOf(f) !== -1;
                });
            }
            if (typeof targetConsole.table === 'function') {
                var rows = items.map(function(it) {
                    return {
                        time: new Date(it.ts).toTimeString().split(' ')[0],
                        level: (it.level || '').toUpperCase(),
                        namespace: it.namespace || 'App',
                        count: it.count || 1,
                        message: messageText(it.args)
                    };
                });
                targetConsole.table(rows);
            } else {
                items.forEach(function(it) {
                    output(it.level, it.namespace, it.args);
                });
            }
            return '共展示 ' + items.length + ' 条日志';
        },
        export: function() {
            return JSON.stringify({
                app: 'OneAPIChat',
                exportedAt: new Date().toISOString(),
                level: state.level,
                stats: { emitted: state.emitted, folded: state.folded, suppressed: state.suppressed, buffered: state.recent.length },
                logs: state.recent.map(cloneRecent)
            }, null, 2);
        },
        help: function() {
            var lines = [
                '🛠️ OneAPIChat 控制台日志排查指南:',
                '  - AppLogger.getLevel(): 查看当前日志级别 (默认 warn)',
                '  - AppLogger.setLevel("debug"): 临时开启全部调试日志',
                '  - AppLogger.enableDebug() / disableDebug(): 快速开/关调试',
                '  - AppLogger.dump("模块名"): 表格化查看指定模块最近日志',
                '  - AppLogger.export(): 导出已脱敏的近期日志 JSON',
                '  - URL 参数: ?debug=1 (自动开启调试) 或 ?log=info/debug'
            ];
            nativeConsole.info.call(null, lines.join('\n'));
            return '提示已输出';
        },
        installConsoleBridge: installConsoleBridge,
        restoreConsole: restoreConsole
    };

    // 全局未捕获异常与 Promise 拒绝安全脱敏收敛
    if (typeof global.addEventListener === 'function') {
        global.addEventListener('error', function(ev) {
            var filename = ev.filename || '';
            if (/chrome-extension:\/\/|moz-extension:\/\/|safari-extension:\/\//i.test(filename)) return;
            var err = ev.error || new Error(ev.message || 'Script error');
            emit('error', ['[Uncaught]', err]);
        });
        global.addEventListener('unhandledrejection', function(ev) {
            var reason = ev.reason;
            var err = reason instanceof Error ? reason : new Error(String(reason || 'Unhandled Promise Rejection'));
            emit('error', ['[UnhandledRejection]', err]);
        });
    }

    installConsoleBridge();
})(window);
// ==== APP_LOGGER_BOOTSTRAP_END ====

// ==== extracted from main.js L11-L13 ====
// ★ 提前声明全局状态变量 — 避免 init 阶段引用时未定义
window.isTypingMap = window.isTypingMap || {};

// ══════════════════════════════════════════════════════════════════
// 🎨 全局主题/皮肤系统（基础引导；完整注册表与自定义能力由 theme-studio.js 接管）
// ══════════════════════════════════════════════════════════════════
function applyChatTheme(theme) {
    theme = theme || localStorage.getItem('chatThemeStyle') || 'dsh';
    if (!['dsh', 'classic', 'minimal', 'codex', 'claude', 'opencode', 'aurora'].includes(theme)) theme = 'dsh';
    document.documentElement.setAttribute('data-chat-theme', theme);
    if (document.body) document.body.setAttribute('data-chat-theme', theme);
    localStorage.setItem('chatThemeStyle', theme);
    var sel = document.getElementById('chatThemeStyle');
    if (sel && sel.value !== theme) sel.value = theme;
}
window.applyChatTheme = applyChatTheme;
window.onChatThemeChange = function(val) {
    applyChatTheme(val);
    if (typeof window._scheduleConfigSync === 'function') window._scheduleConfigSync();
};
// 立即应用默认主题
try { applyChatTheme(); } catch(e) {}
window.isAutoScrolling = window.isAutoScrolling || false;
window.activeBubbleMap = window.activeBubbleMap || {};
window.userScrolled = false;
window.prevWidth = window.prevWidth || window.innerWidth;
window.configPanelInteracting = false;

// ==================== 全局常量 ====================
const _apiBase = window.location.origin + '/oneapichat/api/engine_api.php';


// ==== extracted from main.js L14-L30 ====
// ==================== 已知不支持工具调用的模型(硬编码,不依赖 models.js) ====================
(function() {
    try {
        var _existing = JSON.parse(localStorage.getItem('noToolModels') || '[]');
        var _add = ['deepseek-r1', 'deepseek-reasoner', 'qwq', 'qwq-'];
        let _changed = false;
        for (var _i = 0; _i < _add.length; _i++) {
            if (_existing.indexOf(_add[_i]) === -1) {
                _existing.push(_add[_i]);
                _changed = true;
            }
        }
        if (_changed) {
            localStorage.setItem('noToolModels', JSON.stringify(_existing));
        }
    } catch(e) {}
})();

// ==== extracted from main.js L32-L114 ====
// ==================== 数学公式保护/渲染 ====================
// ★ 用唯一 token 替换 LaTeX 公式, marked 处理后用 KaTeX 渲染替换回来
//   Token 格式: MATHBxN 或 MATHIxN (B=block, I=inline, N=序号)
//   这些 token 不包含任何特殊字符, marked 不会破坏它们
let _mathStore = {};
let _mathCounter = 0;

function _protectMath(text) {
    _mathStore = {};
    _mathCounter = 0;
    if (!text || typeof text !== 'string') return text || '';

    // 块公式: $$...$$ 和 \[...\]
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, function(match, formula) {
        var id = 'MATHBx' + (_mathCounter++);
        _mathStore[id] = { type: 'block', formula: formula.trim() };
        return id;
    });
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, function(match, formula) {
        var id = 'MATHBx' + (_mathCounter++);
        _mathStore[id] = { type: 'block', formula: formula.trim() };
        return id;
    });

    // 行内公式: $...$ 和 \(...\)
    text = text.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, function(match, formula) {
        var id = 'MATHIx' + (_mathCounter++);
        _mathStore[id] = { type: 'inline', formula: formula.trim() };
        return id;
    });
    text = text.replace(/\\\(([^)]+?)\\\)/g, function(match, formula) {
        var id = 'MATHIx' + (_mathCounter++);
        _mathStore[id] = { type: 'inline', formula: formula.trim() };
        return id;
    });

    return text;
}

function _restoreMath(html) {
    if (!html || _mathCounter === 0) return html;

    // ★ 按 ID 长度降序排列，防止 MATHBx1 错误匹配 MATHBx10 (前缀碰撞)
    const sortedIds = Object.keys(_mathStore).sort((a, b) => b.length - a.length);
    for (const id of sortedIds) {
        const info = _mathStore[id];
        let rendered;
        try {
            if (window.katex) {
                rendered = katex.renderToString(info.formula, {
                    throwOnError: false,
                    displayMode: info.type === 'block',
                    strict: false
                });
            } else {
                rendered = info.type === 'block'
                    ? `<p style="text-align:center">$$${info.formula}$$</p>`
                    : `$${info.formula}$`;
            }
        } catch(e) {
            rendered = info.type === 'block'
                ? `<p style="text-align:center">$$${info.formula}$$</p>`
                : `$${info.formula}$`;
        }
        // Token 不含特殊字符, 直接全局替换 (marked 不会修改纯文本 token)
        html = html.split(id).join(rendered);
    }
    return html;
}

// ★ 一站式: 保护 → marked 渲染 → 恢复数学公式
function _renderMarkdownWithMath(text) {
    if (!text) return '';
    if (!window.marked) return escapeHtml(text).replace(/\n/g, '<br>');
    // ★ 统一经过图片/URL 自动识别：历史消息与非流式渲染也要把图片链接显示为图片。
    if (typeof autoLinkURLs === 'function') text = autoLinkURLs(text);
    // ★ 预处理: 自动包裹未加围栏的 mermaid 代码块
    if (typeof _autoFenceMermaid === 'function') text = _autoFenceMermaid(text);
    var protected = _protectMath(text);
    var html = marked.parse(protected);
    // ★ 表格自修复(模型把多值用 \| 挤进单格): 渲染后重新分配到空格子
    if (typeof _repairMarkdownTables === 'function') html = _repairMarkdownTables(html);
    let tempHtml = _restoreMath(html);
    tempHtml = tempHtml.replace(/(?<!["'=])(https?:\/\/[^\s<>"']+)(?!["'])/gi, function(url) {
        var cleanUrl = url.replace(/[.,;:!?)\]]+$/, '');
        return '<a href="' + cleanUrl + '" target="_blank" rel="noopener">' + cleanUrl + '</a>';
    });
    tempHtml = tempHtml.replace(/<a /g, '<a target="_blank" rel="noopener" ');
    // 为所有正文内嵌外部图片添加防盗链绕过 referrerpolicy 与异步加载优化
    tempHtml = tempHtml.replace(/<img\b(?![^>]*\breferrerpolicy=)/gi, '<img referrerpolicy="no-referrer" loading="lazy" decoding="async" ');
    return tempHtml;
}

// ==== extracted from main.js L444-L460 ====
// ★ 跨域登录状态同步(naujtrats.xyz / www 共享登录)
function getCookie(name) {
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : '';
}
// ★ 登录状态同步 (自动适配域名/IP/localhost)
function _getCookieDomain() {
    var host = window.location.hostname;
    if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        return '';
    }
    var parts = host.split('.');
    if (parts.length >= 2) {
        return ';domain=.' + parts.slice(-2).join('.');
    }
    return '';
}
function setCookie(name, value, days) {
    var expires = days ? ';max-age=' + (days * 86400) : '';
    var domainStr = _getCookieDomain();
    var secureStr = window.location.protocol === 'https:' ? ';Secure' : '';
    document.cookie = name + '=' + encodeURIComponent(value) + ';path=/' + domainStr + secureStr + expires;
    // 针对非根域或未匹配父域的环境做一次局部 path cookie 写入双保险
    if (domainStr) {
        document.cookie = name + '=' + encodeURIComponent(value) + ';path=/' + secureStr + expires;
    }
}
function removeCookie(name) {
    var domainStr = _getCookieDomain();
    var secureStr = window.location.protocol === 'https:' ? ';Secure' : '';
    if (domainStr) {
        document.cookie = name + '=;path=/' + domainStr + secureStr + ';max-age=0';
    }
    document.cookie = name + '=;path=/;max-age=0' + secureStr;
}

// ★ 获取 auth_token(兼容 deviceId fallback),优先读跨域 cookie
function getAuthToken() {
    return getCookie('auth_token') || localStorage.getItem('authToken') || localStorage.getItem('deviceId') || '';
}

// ★ OneAPIChat 内部 API 统一使用 Bearer header；避免 session token 出现在 URL、日志和历史记录。
function getSessionAuthHeaders(extra) {
    var headers = Object.assign({}, extra || {});
    var token = getAuthToken();
    if (token && !headers.Authorization) headers.Authorization = 'Bearer ' + token;
    return headers;
}

// ★ 多设备同步链路诊断（默认关闭；控制台执行 SyncTrace.enable() 或 URL ?syncdebug=1 开启）
(function initSyncTrace(global) {
    var STORAGE_KEY = 'oc_sync_trace_enabled';
    var enabled = false;
    try {
        enabled = sessionStorage.getItem(STORAGE_KEY) === '1' || /(?:^|[?&])syncdebug=1(?:&|$)/.test(location.search || '');
    } catch(e) {}
    var seq = 0;
    var entries = [];
    function sanitize(value) {
        if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
        if (typeof value === 'string') return value.substring(0, 240);
        if (Array.isArray(value)) return value.slice(0, 16).map(sanitize);
        if (typeof value === 'object') {
            var out = {};
            Object.keys(value).slice(0, 24).forEach(function(k) {
                if (/token|key|secret|password|content|text|message|body|prompt|args|files/i.test(k)) return;
                out[k] = sanitize(value[k]);
            });
            return out;
        }
        return String(value);
    }
    function id(prefix) {
        seq += 1;
        return String(prefix || 'sync') + ':' + Date.now().toString(36) + ':' + seq.toString(36) + ':' + Math.random().toString(36).slice(2, 7);
    }
    function log(stage, data) {
        if (!enabled) return null;
        var entry = {
            ts: Date.now(),
            source: global._sseSourceId || '',
            stage: String(stage || ''),
            data: sanitize(data || {})
        };
        entries.push(entry);
        if (entries.length > 1000) entries.splice(0, entries.length - 1000);
        try { console.info('[SyncTrace]', entry.stage, entry); } catch(e) {}
        return entry;
    }
    global.SyncTrace = {
        enable: function() { enabled = true; try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch(e) {} return true; },
        disable: function() { enabled = false; try { sessionStorage.removeItem(STORAGE_KEY); } catch(e) {} return true; },
        enabled: function() { return enabled; },
        id: id,
        log: log,
        clear: function() { entries.length = 0; },
        get: function() { return JSON.parse(JSON.stringify(entries)); },
        export: function() { return JSON.stringify(entries, null, 2); }
    };
})(window);

// ★ 清除登录态(cookie + localStorage)
function clearAuthToken() {
    removeCookie('auth_token');
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUsername');
    localStorage.removeItem('authUserId');
    localStorage.removeItem('authRole');
}

// 登录成功后同步到跨域 cookie
function syncAuthToken(token) {
    if (token) {
        localStorage.setItem('authToken', token);
        setCookie('auth_token', token, 30);
    }
}

// ==== extracted from main.js L487-L488 ====
const MOBILE_BREAKPOINT = 786;
const MAX_FILE_SIZE = 4096 * 1024 * 1024;

// ★ 统一提取缓存命中 (读取) token 数 — 兼容所有主流模型的 usage 格式
//   DeepSeek:  usage.prompt_cache_hit_tokens
//   OpenAI:    usage.prompt_tokens_details.cached_tokens
//   Anthropic: usage.cache_read_input_tokens
//   Gemini:    usage.promptTokensDetails[].cachedTokenCount
//   Grok/xAI:  usage.cached_tokens (顶层)
window._extractCacheHit = function(usage) {
    if (!usage || typeof usage !== 'object') return 0;
    if (Number(usage.prompt_cache_hit_tokens) > 0) return Number(usage.prompt_cache_hit_tokens) || 0;
    if (usage.prompt_tokens_details) {
        var _c = Number(usage.prompt_tokens_details.cached_tokens) || Number(usage.prompt_tokens_details.cached) || 0;
        if (_c > 0) return _c;
    }
    if (Number(usage.cache_read_input_tokens) > 0) return Number(usage.cache_read_input_tokens) || 0;
    if (Array.isArray(usage.promptTokensDetails)) {
        var _sum = 0;
        usage.promptTokensDetails.forEach(function(d) {
            if (d && Number(d.cachedTokenCount) > 0) _sum += Number(d.cachedTokenCount);
        });
        if (_sum > 0) return _sum;
    }
    if (Number(usage.cached_tokens) > 0) return Number(usage.cached_tokens) || 0;
    return 0;
};

// ★ 统一提取缓存写入 token 数 — 兼容 Anthropic / OpenAI / DeepSeek / Gemini 规范
//   Anthropic: usage.cache_creation_input_tokens (显式写入)
//   DeepSeek:  usage.prompt_cache_miss_tokens (未命中即写入缓存)
//   OpenAI:    usage.prompt_tokens_details.cache_creation_tokens / usage.cache_write_tokens
//   Gemini/GPT/Claude/DeepSeek 自动前缀缓存: 未命中输入 max(0, pt - cHit) 即为本轮缓存写入
window._extractCacheWrite = function(usage, modelName, promptTokens, cacheHit) {
    if (!usage || typeof usage !== 'object') return 0;
    if (Number(usage.cache_creation_input_tokens) > 0) return Number(usage.cache_creation_input_tokens) || 0;
    if (Number(usage.prompt_cache_miss_tokens) > 0) return Number(usage.prompt_cache_miss_tokens) || 0;
    if (Number(usage.cache_write_tokens) > 0) return Number(usage.cache_write_tokens) || 0;
    if (usage.prompt_tokens_details && Number(usage.prompt_tokens_details.cache_creation_tokens) > 0) {
        return Number(usage.prompt_tokens_details.cache_creation_tokens) || 0;
    }
    if (Number(usage.cache_creation_tokens) > 0) return Number(usage.cache_creation_tokens) || 0;
    if (Number(usage.cache_creation_input) > 0) return Number(usage.cache_creation_input) || 0;

    // 隐式自动前缀缓存 (Prompt Caching) 计算
    var _pt = Number(promptTokens || (window._extractPromptTokens ? window._extractPromptTokens(usage) : (usage.prompt_tokens || usage.input_tokens || 0))) || 0;
    var _cHit = Number(cacheHit !== undefined ? cacheHit : (window._extractCacheHit ? window._extractCacheHit(usage) : 0)) || 0;
    var _m = String(modelName || '').toLowerCase();
    var _isCachingModel = /(gemini|gpt|claude|deepseek|grok|qwen|o1|o3|codex)/i.test(_m);

    if (_cHit > 0) {
        return Math.max(0, _pt - _cHit);
    } else if (_isCachingModel && _pt >= 1024) {
        return _pt;
    }
    return 0;
};
// ★ 统一提取提示词 token 数 (缓存命中率的基数)
window._extractPromptTokens = function(usage) {
    if (!usage || typeof usage !== 'object') return 0;
    var _pt = Number(usage.prompt_tokens) || 0;
    if (_pt > 0) return _pt;
    if (Number(usage.input_tokens) > 0) return Number(usage.input_tokens);
    if (Number(usage.inputTokenCount) > 0) return Number(usage.inputTokenCount);
    if (usage.promptTokensDetails && Array.isArray(usage.promptTokensDetails)) {
        var _s = 0;
        usage.promptTokensDetails.forEach(function(d) { if (d && Number(d.tokenCount) > 0) _s += Number(d.tokenCount); });
        if (_s > 0) return _s;
    }
    return 0;
};

// ==== extracted from main.js L542-L544 ====
const SEARCH_PROXY = 'https://search.naujtrats.xyz'; // GCP代理(国内绕过GFW)
const FETCH_PROXY = '/oneapichat/api/fetch.php';  // ★ 网页内容抓取代理
var ENCRYPTION_KEY = 'naujtrats-secret';  // 默认值 (服务端密钥通过 _loadEncryptionKeyFromServer 覆盖)
var __encryptionKeyLoaded = false;

// 从服务端加载加密密钥(与 config.ini 同步，缓存到 sessionStorage)
async function _loadEncryptionKeyFromServer() {
    if (__encryptionKeyLoaded) return;
    var _cached = sessionStorage.getItem('__encKey');
    if (_cached) { ENCRYPTION_KEY = _cached; __aesKey = null; __encryptionKeyLoaded = true; return; }
    var _token = getAuthToken();
    if (!_token) { __encryptionKeyLoaded = true; return; }  // 未登录 → 使用默认密钥
    try {
        var _resp = await fetch(_apiBase + '?action=get_encryption_key&auth=' + encodeURIComponent(_token));
        if (_resp.ok) {
            var _data = await _resp.json();
            if (_data.encryption_key && _data.encryption_key !== ENCRYPTION_KEY) {
                ENCRYPTION_KEY = _data.encryption_key;
                __aesKey = null;  // ★ 清除 PBKDF2 缓存(新密钥需要重新派生)
                sessionStorage.setItem('__encKey', _data.encryption_key);
            }
        }
    } catch(_e) { /* 网络错误→使用默认密钥 */ }
    __encryptionKeyLoaded = true;
}

// ==== extracted from main.js L548-L565 ====
const API_PROVIDERS = {
    deepseek:  { label: 'DeepSeek',       baseUrl: 'https://api.deepseek.com',                      keyLS: 'apiKeyDeepseek', baseKey: 'apiKeyDeepseek' },
    openai:    { label: 'OpenAI',         baseUrl: 'https://api.openai.com/v1',                      keyLS: 'apiKeyOpenAI',   baseKey: 'apiKeyOpenAI' },
    xai:       { label: 'xAI (Grok)',     baseUrl: 'https://api.x.ai/v1',                            keyLS: 'apiKeyXAI',      baseKey: 'apiKeyXAI' },
    antthropic:{ label: 'Anthropic',      baseUrl: 'https://api.anthropic.com/v1',                   keyLS: 'apiKeyAnth',     baseKey: 'apiKeyAnth' },
    minimax:   { label: 'MiniMax',        baseUrl: 'https://api.minimaxi.com/v1',                    keyLS: 'apiKeyMiniMax',  baseKey: 'apiKeyMiniMax' },
    gemini:    { label: 'Google Gemini',  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyLS: 'apiKeyGemini', baseKey: 'apiKeyGemini' },
    zhipu:     { label: '智谱 (GLM)',    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',            keyLS: 'apiKeyZhipu',    baseKey: 'apiKeyZhipu' },
    qwen:      { label: '通义千问',       baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyLS: 'apiKeyQwen',  baseKey: 'apiKeyQwen' },
    moonshot:  { label: '月之暗面 (Kimi)', baseUrl: 'https://api.moonshot.cn/v1',                    keyLS: 'apiKeyMoonshot', baseKey: 'apiKeyMoonshot' },
    doubao:    { label: '字节豆包',       baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',        keyLS: 'apiKeyDoubao',   baseKey: 'apiKeyDoubao' },
    mimo:      { label: '小米 MiMo',       baseUrl: 'https://api.xiaomimimo.com/v1',                  keyLS: 'apiKeyMiMo',     baseKey: 'apiKeyMiMo' },
    openrouter:{ label: 'OpenRouter',     baseUrl: 'https://openrouter.ai/api/v1',                  keyLS: 'apiKeyOpenRouter', baseKey: 'apiKeyOpenRouter' },
    llamacpp:  { label: '本地模型 (llama.cpp)', baseUrl: 'https://localmodels.naujtrats.xyz/v1',   keyLS: 'apiKeyLlamaCpp',  baseKey: 'apiKeyLlamaCpp' },
    nvidia:    { label: 'NVIDIA NIM',     baseUrl: 'https://integrate.api.nvidia.com/v1',              keyLS: 'apiKeyNvidia',   baseKey: 'apiKeyNvidia' },
    longcat:   { label: 'LongCat',        baseUrl: 'https://api.longcat.chat/openai/v1',              keyLS: 'apiKeyLongCat',  baseKey: 'apiKeyLongCat' },
    custom:    { label: '自定义',         baseUrl: '',                                                 keyLS: 'apiKeyCustom',  baseKey: 'apiKeyCustom' },
};
let _currentProvider = '';


// ==== extracted from main.js L2483-L2495 ====
const getEl = id => document.getElementById(id);
const getVal = id => {
    var el = getEl(id);
    if (!el) return undefined;
    var val = el.value;
    // 输入框为空时用 DEFAULT_CONFIG 的默认值(仅非敏感配置)
    if (!val && id === 'baseUrl' && DEFAULT_CONFIG && DEFAULT_CONFIG.url) return DEFAULT_CONFIG.url;
    // modelSelect 为空必须如实返回空值；隐藏回退会把 DOM 初始化失败伪装成默认模型并覆盖用户选择。
    return val;
};
const getChecked = id => getEl(id)?.checked || false;
const setVal = (id, val) => { const el = getEl(id); if (el) el.value = (val === undefined || val === null) ? '' : val; };
const setChecked = (id, val) => { const el = getEl(id); if (el) el.checked = val; };

// ==== AES-256-GCM 加密 (v2 — 替代 XOR) ====
// 密钥缓存：避免每次操作都运行 PBKDF2
var __aesKey = null;
async function _getAesKey() {
    if (__aesKey) return __aesKey;
    var _enc = new TextEncoder();
    var _km = await crypto.subtle.importKey('raw', _enc.encode(ENCRYPTION_KEY), 'PBKDF2', false, ['deriveKey']);
    __aesKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: _enc.encode('oneapichat-aes-v2'), iterations: 100000, hash: 'SHA-256' },
        _km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    return __aesKey;
}

// ★ 注意: encrypt/decrypt 现在是 async — 所有调用方必须 await
async function encrypt(text) {
    if (!text) return text;
    try {
        var _aesKey = await _getAesKey();
        var _iv = crypto.getRandomValues(new Uint8Array(12));
        var _enc = new TextEncoder();
        var _ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: _iv }, _aesKey, _enc.encode(text));
        // _ct 末尾 16 字节是 GCM auth tag (Web Crypto 自动追加)
        var _combined = new Uint8Array(_iv.length + _ct.byteLength);
        _combined.set(_iv);
        _combined.set(new Uint8Array(_ct), _iv.length);
        return 'v2:' + btoa(Array.from(_combined, function(b) { return String.fromCharCode(b); }).join(''));
    } catch(_e) {
        console.error('[AES-GCM] encrypt error:', _e.message);
        return text; // 加密失败 → 明文存储 (比丢失好)
    }
}

async function decrypt(encoded) {
    if (!encoded) return encoded;
    // v2: AES-256-GCM (新格式)
    if (encoded.indexOf('v2:') === 0) {
        try {
            var _aesKey2 = await _getAesKey();
            var _raw = encoded.slice(3);
            var _binStr = atob(_raw);
            var _bytes = new Uint8Array(_binStr.length);
            for (var _i = 0; _i < _binStr.length; _i++) _bytes[_i] = _binStr.charCodeAt(_i);
            var _iv2 = _bytes.slice(0, 12);
            var _ct2 = _bytes.slice(12);
            var _decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _iv2 }, _aesKey2, _ct2);
            return new TextDecoder().decode(_decrypted);
        } catch(_e2) {
            console.error('[AES-GCM] decrypt error:', _e2.message);
            return encoded; // 损坏数据 → 返回原始值
        }
    }
    // 旧版 XOR 解密 (向后兼容 — 下次保存时自动升级到 v2)
    try {
        var _bin2 = atob(encoded);
        var _bytes2 = new Uint8Array(_bin2.length);
        for (var _j = 0; _j < _bin2.length; _j++) _bytes2[_j] = _bin2.charCodeAt(_j);
        var _xorKey = new TextEncoder().encode(ENCRYPTION_KEY);
        var _res2 = new Uint8Array(_bytes2.length);
        for (var _k = 0; _k < _bytes2.length; _k++) _res2[_k] = _bytes2[_k] ^ _xorKey[_k % _xorKey.length];
        return new TextDecoder().decode(_res2);
    } catch(_e3) {
        return encoded;
    }
}

function compressNewlines(text, max = 1) {
    return text ? text.replace(/\r\n/g, '\n').replace(new RegExp(`\n{${max + 1},}`, 'g'), '\n'.repeat(max)) : text;
}

function estimateTokens(text) {
    if (!text) return 0;
    var ch = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    var other = text.length - ch;
    var words = text.split(/\s+/).filter(Boolean).length;
    return Math.ceil(ch * 2 + other * 0.25 + words * 1.3);
}

// ==== extracted from main.js L2588-L2611 ====
const debounce = (fn, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), wait);
    };
};

const throttle = (fn, limit) => {
    let inThrottle;
    return (...args) => {
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ════════════════════════════════════════════════════
//  懒加载脚本系统 (代码分割)
// ════════════════════════════════════════════════════
const __loadedScripts = {};
const __scriptLoadQueue = [];
const __idleCallbackScheduled = false;

/** 动态加载脚本(去重 + 回调) */
function lazyLoadScript(src, onload) {
    if (__loadedScripts[src]) {
        if (onload) onload();
        return;
    }
    // 检查 DOM 中是否已有该脚本
    var existing = document.querySelector('script[data-src="' + src + '"], script[src="' + src + '"]');
    if (existing) {
        __loadedScripts[src] = true;
        if (onload) onload();
        return;
    }
    // ★ 立即标记,防止竞态(ensureScript + requestIdleCallback 重复加载)
    __loadedScripts[src] = 'loading';
    var s = document.createElement('script');
    s.setAttribute('data-src', src);
    s.src = src;
    s.onload = function() {
        __loadedScripts[src] = true;
        if (onload) onload();
    };
    s.onerror = function() {
        console.warn('[LazyLoad] Failed:', src);
        delete __loadedScripts[src];  // 允许重试
        if (!s.__retried) {
            s.__retried = true;
            setTimeout(function() { document.head.appendChild(s); }, 2000);
        }
    };
    document.head.appendChild(s);
}

/** 空闲时批量加载脚本(rIC 降级到 setTimeout) */
function _loadScriptsOnIdle(scripts) {
    var loader = function() {
        for (var i = 0; i < scripts.length; i++) {
            lazyLoadScript(scripts[i]);
        }
    };
    if (window.requestIdleCallback) {
        requestIdleCallback(loader, { timeout: 3000 });
    } else {
        setTimeout(loader, 200);  // 首屏渲染后 200ms 开始加载
    }
}

/** 确保脚本已加载(返回 Promise) */
function ensureScript(src) {
    if (__loadedScripts[src] === true) return Promise.resolve();
    return new Promise(function(resolve) {
        lazyLoadScript(src, function() {
            __loadedScripts[src] = true;
            resolve();
        });
    });
}

/** DSH-style client plugin discovery and capability lookup. */
window.OneAPIChatPlugins = (function() {
    var plugins = {};
    var discovered = false;
    var discoveryPromise = null;

    function register(plugin) {
        if (!plugin || !plugin.id) return null;
        plugins[plugin.id] = Object.assign({}, plugins[plugin.id] || {}, plugin);
        return plugins[plugin.id];
    }

    register({
        id: 'oneapichat.tools.compat',
        capabilities: ['openai-tools', 'mcp', 'dsh-tool-contract', 'tool-execution'],
        enabled: true,
        client: { entrypoint: '/oneapichat/js/tools-exec.js', global: 'executeToolCallForRetry', lazy: false }
    });

    function discover(force) {
        if (discovered && !force) return Promise.resolve(list());
        if (discoveryPromise && !force) return discoveryPromise;
        var controller = new AbortController();
        var timer = setTimeout(function() { controller.abort(); }, 10000);
        var _pHeaders = { 'Accept': 'application/json' };
        var _pToken = (typeof getAuthToken === 'function' ? getAuthToken() : null) || localStorage.getItem('authToken') || '';
        if (_pToken) _pHeaders.Authorization = 'Bearer ' + _pToken;
        discoveryPromise = fetch('/engine/runtime/plugins', {
            cache: 'no-store', signal: controller.signal, headers: _pHeaders
        }).then(function(response) {
            if (!response.ok) throw new Error('plugin discovery HTTP ' + response.status);
            var contentType = response.headers.get('content-type') || '';
            if (contentType.toLowerCase().indexOf('application/json') === -1) throw new Error('plugin discovery returned non-JSON');
            return response.json();
        }).then(function(data) {
            (data.plugins || []).forEach(register);
            discovered = true;
            return list();
        }).catch(function(error) {
            console.warn('[Plugins] discovery fallback:', error.message);
            return list();
        }).finally(function() {
            clearTimeout(timer);
            discoveryPromise = null;
        });
        return discoveryPromise;
    }

    function list() {
        return Object.keys(plugins).sort().map(function(id) { return plugins[id]; });
    }

    function resolve(idOrCapability) {
        if (plugins[idOrCapability] && plugins[idOrCapability].enabled !== false) return plugins[idOrCapability];
        var ids = Object.keys(plugins);
        for (var i = 0; i < ids.length; i++) {
            var plugin = plugins[ids[i]];
            if (plugin.enabled !== false && (plugin.capabilities || []).indexOf(idOrCapability) !== -1) return plugin;
        }
        return null;
    }

    async function ensure(idOrCapability) {
        var plugin = resolve(idOrCapability);
        if (!plugin) {
            await discover(false);
            plugin = resolve(idOrCapability);
        }
        if (!plugin) throw new Error('Unknown plugin/capability: ' + idOrCapability);
        var client = plugin.client || {};
        if (client.global && window[client.global]) return plugin;
        if (client.entrypoint) await ensureScript(client.entrypoint);
        if (client.global && !window[client.global]) throw new Error('Plugin global missing: ' + client.global);
        return plugin;
    }

    return { register:register, discover:discover, list:list, resolve:resolve, ensure:ensure };
})();

/** 确保 Tier 2 模块已加载(按插件 id 或 capability) */
function ensureModule(key) {
    return window.OneAPIChatPlugins.ensure(key);
}

// ==== extracted from main.js L2613-L2645 ====
// 判断是否应该使用视觉模型格式
// ════════════════════════════════════════════════════
//  模型配置适配层 - 通过 js/models.js 加载
//  为每个模型提供专属参数、能力、格式支持
// ════════════════════════════════════════════════════

/** 获取当前选中模型的名称(小写) */
function _getCurModel() {
    return (getVal('modelSelect') || (DEFAULT_CONFIG && DEFAULT_CONFIG.model) || '').toLowerCase();
}

/** 获取当前模型的专属配置 */
function _getModelCfg(modelName) {
    var name = modelName || _getCurModel();
    if (window.MODEL_CONFIGS) return window.MODEL_CONFIGS;
    // 降级:返回一个空对象(不影响现有逻辑)
    return {
        getConfig: function(){return {};},
        supports: function(){return false;},
        getBannedParams: function(){return [];},
        getBannedBodyKeys: function(){return [];},
        getContextWindow: function(){return 1000000;},
        getMaxOutputTokens: function(){return 4096;},
        getToolCallFormat: function(){return 'openai';},
        getReasoningMode: function(){return null;},
        isNoToolsBuiltin: function(){return false;},
        sanitizeBody: function(n,b){return b;},
        supportsStream: function(){return true;},
        supportsTools: function(){return true;},
        supportsVision: function(){return false;},
        supportsReasonEffort: function(){return false;},
    };
}

// ★ DOM 元素缓存 — init.js 依赖，必须在所有模块之前定义
var $ = window.$ || {
    chatBox: null, chatMessagesContainer: null, userInput: null,
    sendBtn: null, stopBtn: null, filePreviewContainer: null, fileInput: null,
    scrollToBottomBtn: null, chatTitle: null, sidebar: null, configPanel: null,
    sidebarMask: null, sidebarToggle: null, searchQuickToggle: null
};


// ★ 全局状态 — 多模块共享，必须在所有模块之前定义
let currentChatId = null;
let chats = JSON.parse(localStorage.getItem("chats") || "{}");
// `let chats` 是全局词法绑定，不会自动成为 window.chats。多设备同步模块历史上
// 写入 window.chats，渲染/存储模块却读取词法 chats，形成两个完全不同的会话仓库：
// SSE 回源日志显示同步成功，但 loadChat 仍看到 0 条消息。用访问器把两者永久绑定，
// 同时兼容 restoreUserData 后续执行 `chats = merged` 的整体替换。
try {
    Object.defineProperty(window, 'chats', {
        configurable: true,
        enumerable: true,
        get: function() { return chats; },
        set: function(value) { chats = value && typeof value === 'object' ? value : {}; }
    });
    // 与 chats 相同，currentChatId 是全局词法绑定。队列/工作区/同步模块读取
    // window.currentChatId 时必须拿到同一个值，不能悄悄退回 default 或旧会话。
    Object.defineProperty(window, 'currentChatId', {
        configurable: true,
        enumerable: true,
        get: function() { return currentChatId; },
        set: function(value) { currentChatId = value || null; }
    });
} catch(e) {
    window.chats = chats;
    window.currentChatId = currentChatId;
}

// ★ Agent 模式常量 — agent.js 依赖，必须在 core.js 中
const AGENT_CHAT_ID = '_agent_main';
let lastNormalChatId = localStorage.getItem('lastNormalChatId') || null;

// ★ 判断聊天是否属于 Agent 域（主会话 _agent_main、归档 _agent_old_*、子代理 _agent_sub_*、目标会话 _goal_*、内部续生/测试 _continue_* / _runtime_* / _smoke_*）
//   历史列表严格分隔、恢复路径、任务路由统一使用，禁止各处内联判断
window.isAgentChat = function(id) {
    if (!id || typeof id !== 'string') return false;
    return id === AGENT_CHAT_ID ||
        id.indexOf('_agent_old_') === 0 ||
        id.indexOf('_agent_sub_') === 0 ||
        id.indexOf('_goal_') === 0 ||
        id.indexOf('_continue_') === 0 ||
        id.indexOf('_runtime_') === 0 ||
        id.indexOf('_smoke_') === 0 ||
        id.indexOf('_internal_') === 0 ||
        id.indexOf('_sub_') === 0 ||
        id.indexOf('claude_') === 0 ||
        id.indexOf('codex_') === 0;
};

// ★ 搜索按钮状态 (agent.js → 迁至 core.js 避免懒加载导致 ReferenceError)
function getSearchButtonIcon(checked) {
    return checked
        ? '<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 10l-4 4m0-4l4 4"/></svg>'
        : '<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>';
}
function updateSearchButtonState(checked) {
    var btn = getEl('searchQuickToggle');
    if (!btn) return;
    btn.innerHTML = getSearchButtonIcon(checked);
    btn.classList.toggle('text-blue-600', checked);
    btn.classList.toggle('dark:text-blue-400', checked);
    btn.setAttribute('aria-pressed', checked ? 'true' : 'false');
    btn.title = checked ? '关闭联网搜索' : '开启联网搜索';
}

function createSearchToggleButton() {
    var btn = getEl('searchQuickToggle');
    if (btn) {
        btn.onclick = function(e) {
            e.preventDefault();
            var toggle = getEl('searchToggle');
            if (toggle) {
                toggle.checked = !toggle.checked;
                toggle.dispatchEvent(new Event('change'));
            }
        };
        updateSearchButtonState(getChecked('searchToggle'));
        return;
    }
    var wrapper = document.querySelector('#composerMiddleRow') || document.querySelector('.composer-middle-row') || document.querySelector('.input-wrapper .flex');
    if (!wrapper) return;
    btn = document.createElement('button');
    btn.id = 'searchQuickToggle';
    btn.type = 'button';
    btn.className = 'composer-search-btn p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition';
    btn.setAttribute('aria-label', '切换联网搜索');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = getSearchButtonIcon(false);
    btn.onclick = function(e) {
        e.preventDefault();
        var toggle = getEl('searchToggle');
        if (toggle) {
            toggle.checked = !toggle.checked;
            toggle.dispatchEvent(new Event('change'));
        }
    };
    var fileLabel = wrapper.querySelector('label[for="fileInput"]');
    if (fileLabel) {
        fileLabel.insertAdjacentElement('afterend', btn);
    } else {
        wrapper.prepend(btn);
    }
    updateSearchButtonState(getChecked('searchToggle'));
}

// ═══════════════════════════════════════════════════════════════
//  OneAPIChat Vibe Coding — 纯 SVG 矢量图标库与渲染体系 (禁用 Emoji)
// ═══════════════════════════════════════════════════════════════
window.VIBE_SVG_ICONS = {
    terminal: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{class}"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    fileRead: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{class}"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
    fileEdit: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{class}"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    fileWrite: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{class}"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
    grep: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{class}"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    glob: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{class}"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    todoList: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{class}"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    diff: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{class}"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>',
    checkCircle: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="{class}"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    check: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="{class}"><polyline points="20 6 9 17 4 12"/></svg>',
    xCircle: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{class}"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    spinner: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="vibe-spin {class}"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>',
    circleDotted: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3" stroke-linecap="round" stroke-linejoin="round" class="{class}"><circle cx="12" cy="12" r="9"/></svg>',
    bolt: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="{class}"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    shield: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{class}"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    code: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{class}"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    play: '<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{class}"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
};

window.getVibeSvg = function(name, opts) {
    opts = opts || {};
    var size = opts.size || 14;
    var cls = opts.className || '';
    var template = window.VIBE_SVG_ICONS[name] || window.VIBE_SVG_ICONS.bolt;
    return template.replace(/\{size\}/g, String(size)).replace(/\{class\}/g, cls);
};

// 会话绑定的全盘文件访问权限。严禁仅依赖全局布尔值，避免切换聊天后权限串线。
window.hasFullFileAccess = function(chatId) {
    var target = chatId || window.currentChatId || (typeof currentChatId !== 'undefined' ? currentChatId : null);
    var hasValidGrant = !!(window._fullFileAccessGrantId && window._fullFileAccessExpiresAt > Math.floor(Date.now() / 1000) && target && window._fullFileAccessChatId === target);
    if (hasValidGrant) return true;
    var perm = typeof window.getWorkspacePermission === 'function' ? window.getWorkspacePermission() : '';
    if (perm === 'danger-full-access' || (typeof isYoloMode === 'function' && isYoloMode()) || (window._tempAgentGranted && window._tempAgentChatId === target)) {
        return true;
    }
    return false;
};
window.ensureFullFileAccessGrant = async function(chatId) {
    var target = chatId || window.currentChatId || (typeof currentChatId !== 'undefined' ? currentChatId : null);
    if (!target) return false;
    if (window._fullFileAccessGrantId && window._fullFileAccessExpiresAt > Math.floor(Date.now() / 1000) && window._fullFileAccessChatId === target) {
        return true;
    }
    var perm = typeof window.getWorkspacePermission === 'function' ? window.getWorkspacePermission() : '';
    if (perm === 'danger-full-access' || (typeof isYoloMode === 'function' && isYoloMode()) || (window._tempAgentGranted && window._tempAgentChatId === target)) {
        return await window.grantFullFileAccess(target, ['filesystem.read','filesystem.search','filesystem.write','filesystem.move','terminal.exec']);
    }
    return false;
};
window.grantFullFileAccess = async function(chatId, capabilities) {
    if (!chatId) return false;
    var token = typeof getAuthToken === 'function' ? getAuthToken() : (localStorage.getItem('authToken') || '');
    var headers = {'Content-Type':'application/json'};
    if (token) headers.Authorization = 'Bearer ' + token;
    var response = await fetch('/oneapichat/api/engine_api.php?action=permission_grant_create', {
        method:'POST', headers:headers,
        body:JSON.stringify({chat_id:chatId, capabilities:capabilities || ['filesystem.read','filesystem.search','filesystem.write','filesystem.move','terminal.exec'], ttl_seconds:1800})
    });
    var data = await response.json();
    if (!response.ok || !data.ok || !data.grant_id) return false;
    window._fullFileAccessGrantId = data.grant_id;
    window._fullFileAccessChatId = chatId;
    window._fullFileAccessExpiresAt = Number(data.expires_at || 0);
    try { sessionStorage.setItem('_fullFileAccessGrantId', data.grant_id); } catch(e) {}
    try { sessionStorage.setItem('_fullFileAccessChatId', chatId); } catch(e) {}
    try { sessionStorage.setItem('_fullFileAccessExpiresAt', String(data.expires_at || 0)); } catch(e) {}
    return true;
};
window.revokeFullFileAccess = async function(chatId) {
    if (chatId && window._fullFileAccessChatId !== chatId) return false;
    var grantId = window._fullFileAccessGrantId || '';
    var targetChat = window._fullFileAccessChatId || chatId || '';
    var token = typeof getAuthToken === 'function' ? getAuthToken() : (localStorage.getItem('authToken') || '');
    if (grantId && targetChat) {
        var headers = {'Content-Type':'application/json'};
        if (token) headers.Authorization = 'Bearer ' + token;
        try { await fetch('/oneapichat/api/engine_api.php?action=permission_grant_revoke&grant_id=' + encodeURIComponent(grantId) + '&chat_id=' + encodeURIComponent(targetChat), {method:'POST',headers:headers,body:JSON.stringify({grant_id:grantId,chat_id:targetChat})}); } catch(e) {}
    }
    window._fullFileAccessGrantId = null;
    window._fullFileAccessChatId = null;
    window._fullFileAccessExpiresAt = 0;
    try { sessionStorage.removeItem('_fullFileAccessGrantId'); } catch(e) {}
    try { sessionStorage.removeItem('_fullFileAccessChatId'); } catch(e) {}
    try { sessionStorage.removeItem('_fullFileAccessExpiresAt'); } catch(e) {}
    return true;
};

// ★ 全局统一的发送/停止按钮状态机 (支持普通模式 sendBtn 与 Agent 模式 agentSendBtn 严格双向联动)
window.updateSendStopButtons = function(isGenerating) {
    var sBtn = (window.$ && window.$.sendBtn) || document.getElementById('sendBtn');
    var stBtn = (window.$ && window.$.stopBtn) || document.getElementById('stopBtn');
    var agSend = document.getElementById('agentSendBtn');
    var agStop = document.getElementById('agentStopBtn');

    if (isGenerating) {
        if (sBtn) sBtn.classList.add('hidden');
        if (stBtn) { stBtn.classList.remove('hidden'); stBtn.classList.add('visible'); }
        if (agSend) agSend.classList.add('hidden');
        if (agStop) { agStop.classList.remove('hidden'); agStop.classList.add('visible'); }
    } else {
        if (sBtn) sBtn.classList.remove('hidden');
        if (stBtn) { stBtn.classList.remove('visible'); stBtn.classList.add('hidden'); }
        if (agSend) agSend.classList.remove('hidden');
        if (agStop) { agStop.classList.remove('visible'); agStop.classList.add('hidden'); }
    }
};


