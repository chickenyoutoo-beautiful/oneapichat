// core.js — 核心运行时 v1.0 (Phase 0 拆分自 main.js)
// 全局常量、数学公式保护、跨域Cookie、安全Fetch、DOM工具、加密、工具函数

// ==== extracted from main.js L1-L10 ====
// 抑制 KaTeX 字体指标警告(中文字符如123不影响渲染)
(function(){
    var _origWarn = console.warn;
    console.warn = function() {
        if (arguments[0] && typeof arguments[0] === 'string' && arguments[0].indexOf('No character metrics') >= 0) return;
        return _origWarn.apply(console, arguments);
    };
})();

// ==== extracted from main.js L11-L13 ====
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

    for (const [id, info] of Object.entries(_mathStore)) {
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
    var protected = _protectMath(text);
    var html = marked.parse(protected);
    // ★ 自动将纯文本 URL 转为可点击链接（marked v15 不自动 linkify, 跳过 <pre> 内部）
    let tempHtml = _restoreMath(html);
    // 用占位符保护 <pre> 块, 避免正则破坏代码高亮的 class 属性
    var _preBlocks = [];
    tempHtml = tempHtml.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, function(m) {
        _preBlocks.push(m);
        return '%%PRE' + (_preBlocks.length - 1) + '%%';
    });
    tempHtml = tempHtml.replace(/(?<!["'=])(https?:\/\/[^\s<>"']+)(?!["'])/gi, function(url) {
        var cleanUrl = url.replace(/[.,;:!?)\]]+$/, '');
        return '<a href="' + cleanUrl + '" target="_blank" rel="noopener">' + cleanUrl + '</a>';
    });
    tempHtml = tempHtml.replace(/<a /g, '<a target="_blank" rel="noopener" ');
    // 还原 <pre> 块
    tempHtml = tempHtml.replace(/%%PRE(\d+)%%/g, function(_, i) { return _preBlocks[parseInt(i)]; });
    // ★ 代码高亮: hljs.highlight() 字符串 API, 稳定不受 DOM 状态影响
    if (typeof hljs !== 'undefined') {
        tempHtml = tempHtml.replace(/<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/gi, function(_, lang, code) {
            var _decoded = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
            try {
                var _result = hljs.highlight(_decoded, { language: lang, ignoreIllegals: true });
                return '<pre><code class="hljs language-' + lang + '">' + _result.value + '</code></pre>';
            } catch(e) {
                return '<pre><code class="hljs language-' + lang + '">' + code + '</code></pre>';
            }
        });
    }
    return tempHtml;
}

// ==== extracted from main.js L444-L460 ====
// ★ 跨域登录状态同步(naujtrats.xyz / www 共享登录)
function getCookie(name) {
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : '';
}
function setCookie(name, value, days) {
    var expires = days ? ';max-age=' + (days * 86400) : '';
    document.cookie = name + '=' + encodeURIComponent(value) + ';path=/;domain=.naujtrats.xyz;Secure' + expires;
}
function removeCookie(name) {
    document.cookie = name + '=;path=/;domain=.naujtrats.xyz;max-age=0;Secure';
}

// ★ 获取 auth_token(兼容 deviceId fallback),优先读跨域 cookie
function getAuthToken() {
    return getCookie('auth_token') || localStorage.getItem('authToken') || localStorage.getItem('deviceId') || '';
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
    opencode:  { label: 'OpenCode',       baseUrl: 'https://api.opencode.ai/v1',                      keyLS: 'apiKeyOpenCode',  baseKey: 'apiKeyOpenCode' },
    llamacpp:  { label: '本地模型 (llama.cpp)', baseUrl: 'https://localmodels.naujtrats.xyz/v1',   keyLS: 'apiKeyLlamaCpp',  baseKey: 'apiKeyLlamaCpp' },
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
    if (!val && id === 'modelSelect' && DEFAULT_CONFIG && DEFAULT_CONFIG.model) return DEFAULT_CONFIG.model;
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

/** 确保 Tier 2 模块已加载(按 key 名) */
function ensureModule(key) {
    var src = (window.__LAZY_TIER2 || {})[key];
    return src ? ensureScript(src) : Promise.reject('Unknown module: ' + key);
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

// ★ Agent 模式常量 — agent.js 依赖，必须在 core.js 中
const AGENT_CHAT_ID = '_agent_main';
let lastNormalChatId = localStorage.getItem('lastNormalChatId') || null;

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
}

function createSearchToggleButton() {
    if (getEl('searchQuickToggle')) return;
    var wrapper = document.querySelector('.input-wrapper .flex');
    if (!wrapper) return;
    var btn = document.createElement('button');
    btn.id = 'searchQuickToggle';
    btn.type = 'button';
    btn.className = 'p-2 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition';
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
