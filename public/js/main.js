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

    const config = {
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





window.onProviderChange = function(){};

// ==================== SRC (StarRailCopilot) 操控工具 ====================
const SRC_API_BASE = '/src';

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

// 使用 visualViewport API 检测键盘弹出(支持平板和手机)

// 带重试的 fetch 函数
async function fetchWithRetry(url, options, maxRetries = 3, retryDelay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);

            // 检查响应状态
            if (!response.ok) {
                // 永远不要尝试读取响应体,因为可能已经被 streamResponse 读取
                // 根据 MiniMax API 文档,直接使用状态码信息
                const status = response.status;
                const statusText = response.statusText;

                // 特殊处理 529 错误(服务过载)
                if (status === 529) {
                    console.warn(`HTTP 529 服务过载 (尝试 ${attempt}/${maxRetries})`);

                    if (attempt < maxRetries) {
                        // 计算退避延迟(指数退避)
                        const delay = retryDelay * Math.pow(2, attempt - 1);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    } else {
                        throw new Error(`服务过载,请稍后重试 (HTTP 529)`);
                    }
                }

                // 其他错误直接抛出
                throw new Error(`HTTP ${status}: ${statusText}`);
            }

            return response;

        } catch (error) {
            lastError = error;

            // 特殊处理 529 错误的重试
            if (error.message.includes('529') || error.message.includes('过载')) {
                if (attempt === maxRetries) {
                    throw new Error(`请求失败,重试 ${maxRetries} 次后仍然失败: ${error.message}`);
                }

                // 计算退避延迟
                const delay = retryDelay * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            // 非 529 错误直接抛出
            throw error;
        }
    }

    throw lastError;
}
function setupKeyboardDetection() {
    // 优先使用 visualViewport API
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            const viewport = window.visualViewport;
            // 如果视口宽度没变但高度减少了,说明键盘弹出了
            const heightDiff = lastInnerHeight - viewport.height;
            keyboardActive = heightDiff > 50; // 高度减少超过50px认为是键盘
            lastInnerHeight = viewport.height;
        });
        window.visualViewport.addEventListener('scroll', () => {
            // 滚动时也可能伴随键盘操作
        });
    } else {
        // 回退方案:监听 window 的 resize 事件
        window.addEventListener('resize', () => {
            const heightDiff = lastInnerHeight - window.innerHeight;
            keyboardActive = heightDiff > 50;
            lastInnerHeight = window.innerHeight;
        });
    }

    // 监听输入框聚焦/失焦事件(通用)- 特别针对配置面板
    document.addEventListener('focusin', (e) => {
        if (e.target.matches('input, textarea, select')) {
            keyboardActive = true;
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
            const focused = document.querySelector('input:focus, textarea:focus, select:focus');
            if (!focused) {
                keyboardActive = false;
            }
            // 检查配置面板内是否还有聚焦
            if (!focused || !$.configPanel?.contains(focused)) {
                configPanelInteracting = false;
            }
        }, 150);
    });
}
// currentChatId now in core.js

// chats now in core.js
let pendingFiles = [];
let isTypingMap = {};
let abortControllerMap = {};
let searchAbortControllerMap = {};
let userAbortMap = {};
let activeBubbleMap = {};
let userScrolled = false;
let isAutoScrolling = false;  // 防止自动滚动时干扰 userScrolled
let streamingScrollLock = false;

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
        const keys = Array.isArray(path) ? path : path.split('.');
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
        const msg = Safe.string(error?.message).toLowerCase();
        if (msg.includes('network') || msg.includes('fetch')) return new AppError('网络错误', 'NETWORK', error);
        if (msg.includes('timeout') || msg.includes('aborted')) return new AppError('请求超时', 'TIMEOUT', error);
        if (msg.includes(' unauthorized') || msg.includes('401') || msg.includes('403')) return new AppError('API Key无效', 'AUTH', error);
        if (msg.includes('429')) return new AppError('请求过于频繁', 'RATE_LIMIT', error);
        if (msg.includes('500') || msg.includes('502')) return new AppError('服务器错误', 'SERVER', error);
        return new AppError(Safe.string(error?.message, '未知错误'), 'UNKNOWN', error);
    },
    show(error, bubble = null) {
        const appError = this.categorize(error);
        console.error('[Error]', appError.code, appError.message);
        showToast(appError.message, 'error', 4000);
        if (bubble) {
            bubble.classList.remove('typing');
            const div = document.createElement('div');
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
        const now = Date.now();
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
    delete isTypingMap[chatId];
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
    // ★ 中断所有正在运行的工具调用
    if (window.__toolAbortControllers) {
        Object.keys(window.__toolAbortControllers).forEach(function(k) {
            if (k.startsWith(chatId)) {
                try { window.__toolAbortControllers[k].abort(); } catch(e) {}
                delete window.__toolAbortControllers[k];
            }
        });
    }
    // ★ 用户停止后也要处理队列
    if (window._agentNotifyQueue && window._agentNotifyQueue.length > 0 && typeof window._processAgentNotifyQueue === 'function') {
        setTimeout(function() { window._processAgentNotifyQueue(); }, 500);
    }
}

window.stopGeneration = function () {
    if (currentChatId) {
        stopGenerationForChat(currentChatId);
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
    }
};

function buildHistorySummary(chatId, maxLength = MAX_HISTORY_LENGTH) {
    const messages = chats[chatId]?.messages || [];
    const recent = messages.slice(-10);
    const summary = recent.map(m => {
        if (m.role === 'user') return `用户: ${(m.text || '').slice(0, 300)}`;
        if (m.role === 'assistant') return `助手: ${(m.content || '').slice(0, 300)}`;
        return '';
    }).filter(Boolean).join('\n');
    return summary.slice(0, maxLength) || '无历史记录';
}

// 改进:更全面的时间关键词检测,按需返回时间消息(不保存)
function createTemporaryTimestampIfNeeded(text) {
    // 扩展时间关键词列表,覆盖常见时间相关表达
    const timeKeywords = [
        '现在时间', '当前时间', '现在几点', '几点钟', '时间', 'date', 'time', 'now',
        '今天', '明天', '昨天', '星期', '周', '几号', '几月', '哪年', '今年', '去年', '明年',
        'weather', '天气', '新闻', 'news', '实时', '最新', '动态'
    ];
    const lowerText = text.toLowerCase();
    if (timeKeywords.some(kw => lowerText.includes(kw))) {
        const now = new Date();
        var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];var pad=function(n){return n<10?'0'+n:n};var off=-Math.round(now.getTimezoneOffset()/60);var tz='GMT'+(off>=0?'+':'')+off;var ts=days[now.getDay()]+' '+now.getFullYear()+'-'+months[now.getMonth()]+'-'+pad(now.getDate())+' '+pad(now.getHours())+':'+pad(now.getMinutes())+':'+pad(now.getSeconds())+' '+tz;
        var timeContent = '[' + ts + '] 系统当前时间,回答时间相关问题时请以此为准。';
        return { role: 'system', content: timeContent, temporary: true };
    }
    return null;
}


function getSmartSearchKeywords() {
    return [
        // 明确要求搜索的词
        '搜索', '搜一下', '搜一搜', '帮我搜', '网上搜',
        // 新闻/实时类
        '最新', '新闻', '实时', '今日', '今天天气', '当前天气',
        // 明确需要查信息的
        '帮我查', '查一下', '帮我找', '帮我看看',
        // 非常具体的搜索意图词
        '怎么选购', '哪款好', '哪个值得', '多少钱', '价格多少',
        '最新消息', '最新动态', '最新资讯', '刚出的', '刚发布',
        // 下载/安装类的需要看最新版本
        '最新版', '最新版本', '下载安装',
        // 强烈暗示需要外部信息的
        '排行榜', '排名', '评测', '对比评测',
        '现在几点', '现在时间', '今日日期',
        // 百科类
        '百科', '维基'
    ];
}

function getImageKeywords() {
    return ['图片', '照片', '截图', '图', '壁纸', 'gif', 'image', 'photo', 'picture', 'pic'];
}

async function determineSearchType(text, history, signal, forcedType) {
    if (forcedType) return forcedType;
    const hasImageIntent = getImageKeywords().some(kw => text.toLowerCase().includes(kw));
    const baseType = getVal('searchType') || 'auto';
    if (baseType === 'auto') {
        if (hasImageIntent || getChecked('aiSearchTypeToggle')) {
            return hasImageIntent ? 'images' : await aiChooseSearchType(text, history, signal);
        }
        return 'web';
    }
    return baseType;
}

async function handleSearchFlow(chatId, text, forceSearch, queryText, history, signal, bubble, forcedType) {
    let shouldSearch = false;
    let aiDecision = null;
    let finalType = forcedType;
    let searchResults = null;
    let searchError = null;

    const smartKeywords = getSmartSearchKeywords();

    if (forceSearch) {
        shouldSearch = true;
        if (!finalType) finalType = forcedType || 'web';
        updateBubbleSearchStatus(bubble, `🔍 强制搜索 (${finalType})`);
        if (getChecked('searchShowPromptToggle')) showToast(`🔍 强制搜索 (${finalType})`, 'info');
    } else if (getChecked('searchToggle')) {
        const aiJudge = getChecked('aiSearchJudgeToggle');
        if (aiJudge) {
            updateBubbleSearchStatus(bubble, '🤖 AI 判断是否需要搜索...');
            if (getChecked('searchShowPromptToggle')) showToast('🤖 AI智能判断是否需要搜索...', 'info', 2000);
            aiDecision = await aiShouldSearch(text, history, signal);
            if (aiDecision === true) {
                shouldSearch = true;
                updateBubbleSearchStatus(bubble, '🤖 AI 判断:需要联网搜索');
                if (getChecked('searchShowPromptToggle')) showToast('🤖 AI判断:需要联网搜索', 'info');
                if (getChecked('aiSearchTypeToggle')) {
                    updateBubbleSearchStatus(bubble, '🤖 AI 正在判断搜索类型...');
                    if (getChecked('searchShowPromptToggle')) showToast('🤖 AI正在判断搜索类型...', 'info', 2000);
                    finalType = await aiChooseSearchType(text, history, signal);
                    updateBubbleSearchStatus(bubble, `🤖 AI 选择:${finalType}搜索`);
                    if (getChecked('searchShowPromptToggle')) showToast(`🤖 AI选择:${finalType}搜索`, 'info');
                }
            } else if (aiDecision === false) {
                shouldSearch = false;
                updateBubbleSearchStatus(bubble, '🤖 AI 判断:无需联网搜索');
                if (getChecked('searchShowPromptToggle')) showToast('🤖 AI判断:无需联网搜索', 'info');
            } else {
                updateBubbleSearchStatus(bubble, '🤖 AI 判断:无法确定,使用关键词匹配');
                if (getChecked('searchShowPromptToggle')) showToast('🤖 AI判断:无法确定,使用关键词匹配', 'warning');
            }
        }
        if (!aiJudge || aiDecision === null) {
            shouldSearch = smartKeywords.some(k => text.includes(k));
        }
        if (shouldSearch && !finalType) {
            finalType = await determineSearchType(text, history, signal, null);
            const hasImageIntent = getImageKeywords().some(kw => text.toLowerCase().includes(kw));
            if (finalType === 'web' && hasImageIntent && getChecked('searchShowPromptToggle')) {
                showToast('💡 检测到您可能需要图片,可尝试使用 /image 命令', 'info', 5000);
            }
        }
    }

    if (shouldSearch && finalType) {
        const typeIcons = { web: '🔍', news: '📰', images: '🖼️' };
        const typeNames = { web: '网页', news: '新闻', images: '图片' };
        updateBubbleSearchStatus(bubble, `${typeIcons[finalType] || '🔍'} 正在搜索${typeNames[finalType] || ''}中...`);
        if (getChecked('searchShowPromptToggle')) showToast(`🔍 正在搜索${typeNames[finalType] || ''}中...`, 'info');

        const searchQuery = forceSearch ? queryText : (aiDecision === true ? await generateSearchQuery(text, history, signal) : text);
        try {
            searchResults = await performWebSearch(searchQuery, signal, finalType);
            // 直接使用原始结果,不再优化
            const optimized = formatRawResults(searchResults);
            updateBubbleSearchStatus(bubble, '📝 搜索完成,正在生成回答...');
            if (getChecked('searchShowPromptToggle')) showToast('📝 搜索完成,正在生成回答...', 'info');
            return { searchPerformed: true, searchResults, optimized, searchError: null, searchType: finalType };
        } catch (e) {
            searchError = e.message;
            updateBubbleSearchStatus(bubble, `❌ 搜索失败:${e.message}`, true);
            if (getChecked('searchShowPromptToggle')) showToast(`❌ 联网搜索失败: ${e.message}`, 'error', 5000);
            return { searchPerformed: true, searchResults: null, optimized: null, searchError, searchType: finalType };
        }
    }

    return { searchPerformed: false, searchResults: null, optimized: null, searchError: null, searchType: finalType };
}

// 检查对话历史中是否有图片(用于自动切换到 VL-01 视觉模型)
// 注意:这里只检查历史中是否有图片,不影响当前消息的发送
function hasImagesInChat(chatId) {
    const msgs = chats[chatId]?.messages || [];
    return msgs.some(m => m.files?.some(f => f.isImage || f.type?.startsWith('image/')));
}

// 检查最新一条用户消息是否包含图片
function currentMessageHasImage(chatId) {
    const msgs = chats[chatId]?.messages || [];
    // 找到最后一条用户消息
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.role === 'user') {
            return m.files?.some(f => f.isImage || f.type?.startsWith('image/')) || false;
        }
    }
    return false;
}

// ★ 缓存的结果注入: 在 buildApiMessages 后调用,将历史图片分析结果注入上下文
function injectCachedImageAnalyses(chatId, apiMessages) {
    try {
        if (!chatId || !chats[chatId] || !apiMessages || !apiMessages.length) return;
        var cache = chats[chatId].imageAnalyses;
        if (!cache || !cache.length) return;
        // 检查最近几条消息是否已经有图片分析上下文(避免重复注入)
        var recentContent = apiMessages.slice(-3).map(function(m) { return m.content || ''; }).join(' ');
        var pattern = /【图片\d+分析结果】|以下是对用户上传图片的自动分析结果|图片分析缓存/g;
        if (pattern.test(recentContent)) return;
        // 注入缓存
        var analysisText = '\n\n【图片分析缓存(历史)】以下是对用户之前上传图片的描述,如需引用请直接使用,无需重新分析:\n\n' +
            cache.map(function(a, idx) { return '【图片' + (idx + 1) + '】\n' + a; }).join('\n\n---\n\n');
        var sysIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
        if (sysIdx !== -1) {
            apiMessages[sysIdx].content += analysisText;
        } else {
            apiMessages.unshift({ role: 'system', content: analysisText });
        }
    } catch(e) {
        console.warn('[injectCachedImageAnalyses] 失败:', e.message);
    }
}

function buildApiMessages(chatId) {
    const apiMessagesUnfiltered = [];
    // ★ 提前声明,供后续原生视觉判断使用
    var _curModelName = (getVal('modelSelect') || '').toLowerCase();
    // 只检查当前消息是否包含图片,避免历史图片触发视觉模型
    const currentHasImage = pendingFiles.length > 0 && pendingFiles.some(f => f.isImage || f.type?.startsWith('image/')) || !!window.__currentMessageHasImages;

    // ★ 模型配置:根据模型类型决定 system 消息处理方式
    // MiniMax/部分模型不支持多条 system 消息,需要合并为一条
    var _needMergeSystem = false;
    var _curModelLower = (getVal('modelSelect') || '').toLowerCase();
    // MiniMax 系列:合并 system 消息
    if (_curModelLower.indexOf('minimax') !== -1) _needMergeSystem = true;
    // QwQ 等思考模型:合并 system 消息
    if (_curModelLower.indexOf('qwq') !== -1) _needMergeSystem = true;
    if (_needMergeSystem) {
        const sysMsgs = [];
        for (const msg of chats[chatId].messages) {
            if (msg.role === 'system' && !msg.temporary) {
                sysMsgs.push(msg.content);
            }
        }
        const merged = sysMsgs.length > 0 ? sysMsgs.join('\n\n') : (getVal('systemPrompt') || DEFAULT_CONFIG.system);
        // ★ 追加工作空间信息
        var _wsInfo = '\n\n## 🗂 工作空间\n' +
            '你必须使用 server_file_write 工具保存所有生成的项目文件到工作空间。\n' +
            '- 完整项目: 写入到 /var/www/html/oneapichat/workspace/projects/<项目名>/\n' +
            '- 脚本: /var/www/html/oneapichat/workspace/scripts/<文件名>\n' +
            '- 数据: /var/www/html/oneapichat/workspace/data/<文件名>\n' +
            '- 报告: /var/www/html/oneapichat/workspace/reports/<文件名>\n' +
            '- 临时文件: /var/www/html/oneapichat/workspace/tmp/<文件名>\n' +
            '文件写入成功后,server_file_write 工具会自动返回在线访问链接,你直接使用该链接即可,不要自己拼接URL。\n' +
            '对于 HTML 项目,务必写入 index.html 文件,确保目录名和文件名准确。\n' +
            '如果要查看已有项目,使用 server_file_read 读取 /var/www/html/oneapichat/workspace/projects.json 索引。\n' +
            '你始终记得你生成过哪些项目,不要重复生成。如果用户问"我之前的项目在哪",根据 projects.json 索引给出链接。';
        apiMessagesUnfiltered.push({ role: 'system', content: merged + _wsInfo });
    } else {
        for (const msg of chats[chatId].messages) {
            if (msg.role === 'system' && !msg.temporary) {
                apiMessagesUnfiltered.push({ role: 'system', content: msg.content });
            }
        }

        if (apiMessagesUnfiltered.length === 0) {
            var defaultSystemContent = getVal('systemPrompt') || DEFAULT_CONFIG.system;
            // ★ 追加工作空间信息
            var _wsInfo = '\n\n## 🗂 工作空间\n' +
                '你必须使用 server_file_write 工具保存所有生成的项目文件到工作空间。\n' +
                '- 完整项目: 写入到 /var/www/html/oneapichat/workspace/projects/<项目名>/\n' +
                '- 脚本: /var/www/html/oneapichat/workspace/scripts/<文件名>\n' +
                '- 数据: /var/www/html/oneapichat/workspace/data/<文件名>\n' +
                '- 报告: /var/www/html/oneapichat/workspace/reports/<文件名>\n' +
                '- 临时文件: /var/www/html/oneapichat/workspace/tmp/<文件名>\n' +
                '文件写入成功后,server_file_write 工具会自动返回在线访问链接,你在回复中直接使用该链接即可,不要自己拼接URL。\n' +
                '对于 HTML 项目,务必写入 index.html 文件,确保目录名和文件名准确。\n' +
                '如果要查看已有项目,使用 server_file_read 读取 /var/www/html/oneapichat/workspace/projects.json 索引。\n' +
                '你始终记得你生成过哪些项目,不要重复生成。如果用户问"我之前的项目在哪",根据 projects.json 索引给出链接。';
            defaultSystemContent += _wsInfo;
            apiMessagesUnfiltered.push({ role: 'system', content: defaultSystemContent });
            if (!chats[chatId].messages.some(m => m.role === 'system' && !m.temporary)) {
                chats[chatId].messages.unshift({ role: 'system', content: defaultSystemContent });
            }
        }

        // ★ 注入子代理推送消息到 system context (不显示在聊天界面)
        if (chats[chatId]._agentMessages && chats[chatId]._agentMessages.length > 0) {
            var _agentCtx = '## 子代理推送消息\n' + chats[chatId]._agentMessages.slice(-10).map(function(m) {
                return '[' + new Date(m.time).toLocaleTimeString('zh-CN') + '] ' + (m.source ? '(' + m.source + ') ' : '') + m.text;
            }).join('\n');
            var sysIdx = apiMessagesUnfiltered.findIndex(function(m) { return m.role === 'system'; });
            if (sysIdx >= 0) {
                apiMessagesUnfiltered[sysIdx].content = apiMessagesUnfiltered[sysIdx].content + '\n\n' + _agentCtx;
            }
        }
    }

    // ★ 修复: 统一清理消息内容中的 [object Object] 残留
    // ★ 注入工具调用上限到 system prompt
    var _maxRoundsAll = parseInt(localStorage.getItem('agentMaxToolRounds')) || 50;
    var _toolLimitHint = '\n\n## 工具调用限制\n本轮对话最多调用 ' + _maxRoundsAll + ' 次工具。请合理规划调用次数。如果接近上限,请优先给出已有结果而不是继续调用。';
    var _sysIdx = apiMessagesUnfiltered.findIndex(function(m) { return m.role === 'system'; });
    if (_sysIdx >= 0) {
        apiMessagesUnfiltered[_sysIdx].content += _toolLimitHint;
    }



    function cleanObjectObject(val) {
        if (typeof val === 'string') {
            if (val === '[object Object]') return '';
            return val.replace(/\[object Object\]/g, '');
        }
        if (val && typeof val === 'object') {
            const extracted = val.text || val.content || val.value || '';
            if (extracted) return '' + extracted;
            if (Array.isArray(val)) {
                return val.map(c => typeof c === 'object' ? (c.text || c.content || '') : String(c)).filter(Boolean).join('');
            }
            try { return JSON.stringify(val); } catch(e) { return ''; }
        }
        return val === undefined || val === null ? '' : String(val);
    }

    const msgs = chats[chatId].messages;
    for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        // ★ 跳过内部消息(不发送给 API,仅用于内部逻辑)
        if (msg._internal) continue;
        if (msg.role === 'system') continue;
        if (msg.role === 'user') {
            const files = msg.files;
            // ★ 所有带图片的用户消息都传递 image_url,确保后续追问也能看到图片
            var msgHasImage = files && files.length > 0 && files.some(function(f) { return f.isImage || (f.type && f.type.startsWith('image/')); });
            var prev = window._forceVisionFormat;
            if (msgHasImage || (i === msgs.length - 1 && currentHasImage)) {
                window._forceVisionFormat = true;
            }
            apiMessagesUnfiltered.push({ role: 'user', content: buildUserContent(msg.text, files) });
            window._forceVisionFormat = prev;
        } else if (msg.role === 'assistant' && !msg.partial) {
            apiMessagesUnfiltered.push({ role: 'assistant', content: cleanObjectObject(msg.content) || '(empty)' });
        } else if (msg.temporary) {
            // ★ 模型适配: 部分模型不支持过多 system 消息,将临时消息合并到最近的非 system 消息
            // MiniMax/QwQ 等:系统消息支持有限
            var _needMergeTemp = _needMergeSystem;
            if (_needMergeTemp) {
                // 找到前面最近的非 system 消息,追加内容
                let lastIdx = apiMessagesUnfiltered.length - 1;
                if (lastIdx >= 0 && apiMessagesUnfiltered[lastIdx].role !== 'system') {
                    apiMessagesUnfiltered[lastIdx].content += '\n\n' + (cleanObjectObject(msg.content) || '');
                } else {
                    apiMessagesUnfiltered.push({ role: 'user', content: cleanObjectObject(msg.content) || '(empty)' });
                }
            } else {
                apiMessagesUnfiltered.push({ role: msg.role, content: cleanObjectObject(msg.content) || '(empty)' });
            }
        }
    }

    // 只有当前消息有图片时才使用视觉模型
    if (currentHasImage) {
        apiMessagesUnfiltered._useVisionModel = true;
    }

    // ★ 最终安全过滤: 移除任何 content 为空/null/undefined/非字符串 的消息
    var filtered = {};
    var apiMessages = [];
    for (var _fi = 0; _fi < apiMessagesUnfiltered.length; _fi++) {
        var _m = apiMessagesUnfiltered[_fi];
        if (!_m || !_m.role) { console.log('[buildApiMessages] 跳过无效消息', _fi, _m); continue; }
        if (_m.content === undefined || _m.content === null) { console.log('[buildApiMessages] 跳过空content', _fi, _m.role); continue; }
        // content 可能是字符串或数组 (多模态)
        if (typeof _m.content === 'string' && _m.content.length === 0) { console.log('[buildApiMessages] 跳过空字符串', _fi, _m.role); continue; }
        apiMessages.push(_m);
    }
    return apiMessages;
}

function adjustMaxTokens(model, requestedTokens, estimated) {
    // ★ 优先使用模型配置中的上下文长度和安全余量
    var _cfgSafety = _getModelCfg().getSafetyMargin(model);
    var _safetyMargin = _cfgSafety || MAX_TOKENS_SAFETY_MARGIN;
    var _cfgCtx = _getModelCfg().getContextWindow(model);
    var maxContext = modelContextLength[model] || _cfgCtx || 1000000;
    var _cfgMaxOut = _getModelCfg().getMaxOutputTokens(model);
    var maxOutput = modelMaxOutputTokens[model] || _cfgMaxOut || maxContext;
    var maxAllowed = maxContext - estimated - _safetyMargin;
    if (maxAllowed < 256) return null;
    return Math.min(requestedTokens, maxAllowed, maxOutput);
}

// ★ 后端 SSE 处理器:接收 SSE 流式事件,转换为 streamResponse 兼容格式
// SSE 格式: "event: TYPE\ndata: JSON\n\n"
// 解析时需要识别 "event:" 行来确定事件类型
window._backendSSEHandler = async function(sseResponse, chatId, pendingMsg, msgId) {
    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType = 'chunk';
    let fullText = '';
    let reasoningText = '';
    let toolCalls = [];
    let usage = null;
    let finished = false;

    // 定期保存到 localStorage._savedPartial(防刷新丢失)
    if (pendingMsg._streamSaveTimer) clearInterval(pendingMsg._streamSaveTimer);
    pendingMsg._streamSaveTimer = setInterval(function() {
        if (fullText || reasoningText) {
            try {
                localStorage.setItem('_savedPartial', JSON.stringify({
                    chatId: chatId, msgId: msgId,
                    content: fullText, reasoning: reasoningText,
                    time: Date.now()
                }));
            } catch(e) {}
        }
    }, 2000);

    while (!finished) {
        let readResult;
        try {
            readResult = await reader.read();
        } catch(e) { break; }
        const { done, value } = readResult;
        if (value) buffer += decoder.decode(value, { stream: true });
        if (done) { finished = true; }

        // 处理 SSE 数据:SSE 格式为 "event: TYPE\ndata: JSON\n\n"
        // 每条消息由 "event:xxx\ndata:xxx\n\n" 组成,lines 会包含多行
        const lines = buffer.split('\n');
        // 最后一行是可能不完整的下一条消息,保留在 buffer
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;

            // 检测 "event: TYPE" 行 - 设置当前事件类型
            if (line.startsWith('event: ')) {
                currentEventType = line.substring(6).trim();
                continue;
            }

            // 检测 "data: JSON" 行 - 用当前事件类型解析
            if (!line.startsWith('data: ')) continue;
            const dataStr = line.substring(6).trim();
            if (!dataStr || dataStr === '[DONE]') continue;

            try {
                const event = JSON.parse(dataStr);

                if (currentEventType === 'content' || event.type === 'content') {
                    const delta = event.delta || event.content || '';
                    if (delta) {
                        fullText += delta;
                        applyStreamRender(chatId, fullText);
                    }
                } else if (currentEventType === 'reasoning' || event.type === 'reasoning') {
                    const rd = event.delta || event.reasoning || '';
                    if (rd) {
                        reasoningText += rd;
                        var cb = activeBubbleMap[chatId];
                        if (cb) {
                            var det = cb.querySelector('details.reasoning-details');
                            if (!det) {
                                det = document.createElement('details');
                                det.className = 'reasoning-details';
                                det.open = true;
                                det.innerHTML = '<summary>深度思考</summary><div class="reasoning-content"></div>';
                                var mb2 = cb.querySelector('.markdown-body');
                                if (mb2) cb.insertBefore(det, mb2);
                            }
                            det.querySelector('.reasoning-content').textContent = reasoningText;
                            // 思考增长直接强制跟底(绕过 autoScrollToBottom 的距离阈值)
                            requestAnimationFrame(function() {
                                if ($.chatBox && !userScrolled) {
                                    $.chatBox.scrollTop = $.chatBox.scrollHeight;
                                }
                            });
                        }
                    }
                } else if (currentEventType === 'tool_call' || event.type === 'tool_call') {
                    if (event.delta && event.delta.function) {
                        // ★ 修复: 增量合并 tool_calls delta
                        var _tcFunc = event.delta.function;
                        var _existingTC = null;
                        if (event.delta.index !== undefined) {
                            _existingTC = toolCalls.find(function(t) { return t.index === event.delta.index; });
                        }
                        if (_existingTC) {
                            if (_tcFunc.name) _existingTC.function.name = _tcFunc.name;
                            if (_tcFunc.arguments) _existingTC.function.arguments += _tcFunc.arguments;
                        } else {
                            toolCalls.push(event.delta);
                        }
                    } else if (event.function || event.name) {
                        // 完整工具调用格式
                        toolCalls.push(event);
                    }
                    // 工具调用出现时直接强制跟底
                    requestAnimationFrame(function() {
                        if ($.chatBox && !userScrolled) {
                            $.chatBox.scrollTop = $.chatBox.scrollHeight;
                        }
                    });
                } else if (currentEventType === 'done' || event.type === 'done') {
                    if (event.tool_calls) toolCalls = event.tool_calls;
                    if (event.usage) usage = event.usage;
                    finished = true;
                } else if (currentEventType === 'error' || event.type === 'error') {
                    console.error('[SSE] error:', event.error);
                    finished = true;
                    // ★ 错误时也保留已输出的内容,不要留空气泡
                    if (fullText && pendingMsg) {
                        pendingMsg.content = fullText;
                        pendingMsg.reasoning = reasoningText;
                        delete pendingMsg.partial;
                    }
                } else if (currentEventType === 'start') {
                    console.log('[SSE] stream started, msg_id:', event.msg_id);
                }
            } catch(e) { console.warn('[SSE] parse error:', e.message, 'line:', line.slice(0, 80)); }
        }
        if (done) {
            // 处理 buffer 中剩余的不完整数据(理论上应该为空)
            if (buffer.trim()) {
                console.log('[SSE] done, buffer remains:', buffer.slice(0, 100));
            }
            break;
        }
    }

    // 清理 timer + RAF 流渲染状态
    if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
    cleanupStreamState(chatId);

    // 清理 savedPartial 和 msg_id 标记
    try { localStorage.removeItem('_savedPartial'); } catch(e) {}
    try { localStorage.removeItem('_lastStreamMsgId_' + chatId); } catch(e) {}

    return { fullText, reasoningText, usage, toolCalls };
};

async function streamResponse(res, chatId, pendingMsg, reasoningDelay, contentDelay) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let reasoningText = '';
    let hasContent = false;
    let usage = null;
    let placeholderCleared = false;
    let parseErrors = 0;
    // ★ 流式内容定期保存到 localStorage(防止刷新丢失)
    // 把 timer 挂在 pendingMsg 上,方便外部清理
    if (pendingMsg._streamSaveTimer) clearInterval(pendingMsg._streamSaveTimer);
    pendingMsg._streamSaveTimer = setInterval(function() {
        if (pendingMsg.content || pendingMsg.reasoning) {
            try {
                localStorage.setItem('_savedPartial', JSON.stringify({
                    chatId: chatId,
                    content: pendingMsg.content || '',
                    reasoning: pendingMsg.reasoning || '',
                    time: Date.now()
                }));
            } catch(e) {}
        }
    }, 2000);
    // 工具调用相关
    let toolCalls = [];
    let currentToolCall = null;
    let toolCallContent = '';
    let inToolCall = false;
    let toolCallCompleted = false; // ★ 标记:是否已保存完成的tool call,阻止重放覆盖

    while (true) {
        let readResult;
        try {
            readResult = await reader.read();
        } catch (readErr) {
            // 读取流数据异常,尝试用 buffer 中已有内容
            console.warn('[STREAM] 流读取异常:', readErr.message);
            break;
        }
        const { done, value } = readResult;
        if (done) {
            // 流结束:处理 buffer 中剩余的数据
            if (value) { buffer += decoder.decode(value, { stream: true }); }
            if (buffer.trim()) {
                var lastLines = buffer.split('\n');
                for (var li = 0; li < lastLines.length; li++) {
                    var l = lastLines[li].trim();
                    if (!l) continue;
                    var ljson = '';
                    if (l.startsWith('data: ') && l !== 'data: [DONE]') ljson = l.substring(6);
                    else if (l.startsWith('{')) ljson = l;
                    if (!ljson) continue;
                    try {
                        var jd = JSON.parse(ljson);
                        var dd = jd.choices?.[0]?.delta || jd.choices?.[0]?.message;
                        // content为空但reasoning有内容时,使用reasoning作为显示内容
                        if (dd && dd.content && String(dd.content).trim()) {
                            fullText += dd.content;
                        } else if (dd && dd.reasoning_content && String(dd.reasoning_content).trim()) {
                            fullText += String(dd.reasoning_content);
                        }
                        if (dd && dd.reasoning_content && String(dd.reasoning_content).trim()) reasoningText += String(dd.reasoning_content);
                        if (dd && dd.reasoning_details) {
                            if (!pendingMsg._reasoningDetails) pendingMsg._reasoningDetails = [];
                            for (var rdi=0;rdi<dd.reasoning_details.length;rdi++) {
                                if (dd.reasoning_details[rdi].text) {
                                    reasoningText += dd.reasoning_details[rdi].text;
                                    pendingMsg._reasoningDetails.push({type: 'reasoning.text', text: dd.reasoning_details[rdi].text});
                                }
                            }
                        }
                        if (jd.usage) usage = jd.usage;
                    } catch(e2) {}
                }
            }
            // Done分支: 对fullText做最后一次思考标签清理(避免流式结束后的残留)
            if (fullText) {
                var _dAllThink = '';
                var _dTmp = fullText;
                // 格式1: <think>...</think> (Ollama deepseek-r1 等)
                var _dThink = fullText;
                var _dMt = _dThink.match(/<think>([\s\S]*?)<\/think>/g);
                if (_dMt) {
                    for (var _di = 0; _di < _dMt.length; _di++) {
                        _dAllThink += _dMt[_di].replace(/<\/?think>/g, '');
                    }
                    fullText = fullText.replace(/<think>[\s\S]*?<\/think>/g, '');
                }
                // 格式2: MiniMax (think)...(endthink)
                var _dMatchThink2 = _dTmp.match(/\(think\)([\s\S]*?)(?:\(endthink\)|$)/g);
                if (_dMatchThink2) {
                    for (var _dmi = 0; _dmi < _dMatchThink2.length; _dmi++) {
                        _dAllThink += _dMatchThink2[_dmi].replace(/\(endthink\)/g, '').replace(/\(think\)/g, '');
                    }
                    fullText = fullText.replace(/\(think\)[\s\S]*?(?:\(endthink\)|$)/g, '').replace(/\(think\)\s*/g, '');
                }
                if (_dAllThink.trim() && !reasoningText) {
                    reasoningText = _dAllThink.trim();
                }
                // ★ 确保 pendingMsg.reasoning 与最终 reasoningText 同步
                if (reasoningText && reasoningText !== pendingMsg.reasoning) {
                    pendingMsg.reasoning = reasoningText;
                }
            }
            // console.log('[STREAM] Done, final fullText:', fullText?.length, 'bytes');  // 调试用,正常运行时静默
            // 残留buffer原始内容(前200字节)
            if (buffer && buffer.trim()) {
                var bufPreview = buffer.substring(0, 200);
                console.log('[BUF-HEX] buffer start:', bufPreview);
                console.log('[BUF-HEX] starts with {?', buffer.trim().startsWith('{'), '| data:?', buffer.trim().startsWith('data:'), '| first char:', buffer.trim().charCodeAt(0));
            }
            break;
        }
        const decoded = decoder.decode(value, { stream: true });
        buffer += decoded;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            // 支持两种格式: SSE (data: {...}) 和 裸JSON ({...})
            var jsonStr = '';
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                jsonStr = line.substring(6);
            } else if (line.trim().startsWith('{')) {
                jsonStr = line.trim();
            }
            if (jsonStr) {
                try {
                    // 跳过空行或无效JSON
                    if (!jsonStr.trim()) continue;

                    // 尝试解析JSON,如果失败则跳过这行
                    let data;
                    try {
                        data = JSON.parse(jsonStr);
                    } catch (parseErr) {
                        // 如果解析失败,尝试找到有效的JSON部分
                        const match = jsonStr.match(/\{[\s\S]*\}/);
                        if (match) {
                            try {
                                data = JSON.parse(match[0]);
                            } catch {
                                parseErrors++;
                                console.warn('[JSON解析错误]', parseErr.message, '原文:', jsonStr.slice(0, 100));
                                continue;
                            }
                        } else {
                            parseErrors++;
                            console.warn('[JSON解析错误]', parseErr.message, '原文:', jsonStr.slice(0, 100));
                            continue;
                        }
                    }

                    const delta = data.choices?.[0]?.delta;
                    // 如果 delta 为空,跳过此条数据
                    if (!delta) {
                        console.warn('[流式解析] delta 为空,跳过');
                        continue;
                    }

                    // ★ MiniMax 兼容: 当 delta 中只有空的 role/reasoning_content 时跳过
                    // MiniMax 返回 { role: "", reasoning_content: "" } 的空chunk,不包含有效内容
                    if ((delta.content === undefined || delta.content === null) &&
                        delta.role !== undefined &&
                        (delta.role === '' || delta.role === 'assistant') &&
                        (delta.reasoning_content === '' || (delta.reasoning_content !== undefined && delta.reasoning_content !== null && delta.reasoning_content === '')) &&
                        !(delta.reasoning_details && delta.reasoning_details.length) &&
                        !(delta.tool_calls && delta.tool_calls.length)) {
                        // 空chunk跳过 (MiniMax偶尔发送)
                        continue;
                    }

                    // 处理工具调用
                    if (delta.tool_calls && delta.tool_calls.length > 0) {
                        for (const tc of delta.tool_calls) {
                            if (tc.index !== undefined && tc.index > 0 && currentToolCall) {
                                // 新的tool_call开始,保存之前的(仅当有有效内容时)
                                // ★ 重置 toolCallCompleted 标志,以支持多工具调用
                                toolCallCompleted = false;
                                if (typeof currentToolCall.function.arguments === 'object') {
                                    currentToolCall.function.arguments = JSON.stringify(currentToolCall.function.arguments);
                                }
                                const currentArgs = typeof currentToolCall.function.arguments === 'string'
                                    ? currentToolCall.function.arguments
                                    : JSON.stringify(currentToolCall.function.arguments || '');
                                // 只保存有实际内容的tool call(跳过空/碎片)
                                const hasValidContent = currentArgs.length > 2 &&
                                    (currentArgs.includes('query') || currentArgs.includes('prompt') || currentToolCall.function?.name);
                                if (hasValidContent) {
                                    toolCalls.push(currentToolCall);
                                }
                                currentToolCall = null;
                            }
                            if (!currentToolCall) {
                                // ★ 重点: 新的tool_call开始时重置 completed 标志
                                // 因为同一个流中可能有多个连续的 tool_call 序列(DS V4 重放后跟新tool_call)
                                var _prevTCId = currentToolCall ? currentToolCall.id : null;
                                if (tc.id && _prevTCId && tc.id !== _prevTCId) {
                                    toolCallCompleted = false;
                                }
                                currentToolCall = {
                                    id: tc.id || `call_${Date.now()}_${toolCalls.length}`,
                                    type: 'function',
                                    function: {
                                        name: tc.function?.name || '',
                                        // arguments初始化:严格判断undefined/null,保留空字符串和其他所有值
                                        arguments: tc.function?.arguments === undefined ? '' : tc.function.arguments
                                    }
                                };
                            } else if (tc.function?.name) {
                                currentToolCall.function.name = tc.function.name;
                            }
                            // 如果有新的arguments,更新它
                            if (tc.function?.arguments !== undefined) {
                                if (typeof tc.function.arguments === 'object') {
                                    // 对象是完整的arguments,直接替换
                                    currentToolCall.function.arguments = tc.function.arguments;
                                } else if (typeof tc.function.arguments === 'string') {
                                    const newArg = tc.function.arguments;
                                    const isCompleteJSON = (newArg.trim().startsWith('{') && newArg.trim().endsWith('}')) ||
                                                           (newArg.trim().startsWith('[') && newArg.trim().endsWith(']'));

                                    if (typeof currentToolCall.function.arguments === 'string') {
                                        // 检查是否完全相同(避免Grok重复发送完整JSON)
                                        if (newArg === currentToolCall.function.arguments) {
                                        } else if (isCompleteJSON && currentToolCall.function.arguments.trim() !== '') {
                                            // 当前有内容且新来的是完整JSON,应该是替换而非拼接
                                            // ★ 修复: 如果已有完成的tool call,忽略这个完整JSON替换
                                            if (toolCallCompleted) {
                                            } else {
                                                currentToolCall.function.arguments = newArg;
                                            }
                                        } else {
                                            // ★ 修复: DeepSeek V4 Pro/Flash 在增量拼接完完整JSON后,
                                            // 会再发一遍同样的字符作为单独delta,导致无效累积
                                            // 检查 current 是否已经是闭合的有效JSON,如果是则跳过所有后续追加
                                            const curTrimmed = currentToolCall.function.arguments.trim();
                                            const looksComplete = (curTrimmed.startsWith('{') && curTrimmed.endsWith('}')) ||
                                                                  (curTrimmed.startsWith('[') && curTrimmed.endsWith(']'));
                                            if (looksComplete) {
                                                // 已闭合成完整JSON,验证有效性
                                                let isValid = false;
                                                try { JSON.parse(curTrimmed); isValid = true; } catch(e) {}
                                                if (isValid) {
                                                    // ★ 修复: 立即保存到toolCalls并标记完成,防止后续重放覆盖
                                                    if (!toolCallCompleted) {
                                                        const savedCall = JSON.parse(JSON.stringify(currentToolCall));
                                                        savedCall.function.arguments = JSON.parse(curTrimmed);
                                                        toolCalls.push(savedCall);
                                                        toolCallCompleted = true;
                                                        currentToolCall = null;
                                                    }
                                                } else {
                                                    currentToolCall.function.arguments += newArg;
                                                }
                                            } else {
                                                // 否则是增量片段,累加
                                                currentToolCall.function.arguments += newArg;
                                                // ★ 事后检查: 累加后如果变成完整有效JSON,立即保存
                                                if (!toolCallCompleted) {
                                                    const afterTrim = currentToolCall.function.arguments.trim();
                                                    if ((afterTrim.startsWith('{') && afterTrim.endsWith('}')) ||
                                                        (afterTrim.startsWith('[') && afterTrim.endsWith(']'))) {
                                                        try {
                                                            const parsed = JSON.parse(afterTrim);
                                                            const savedCall = JSON.parse(JSON.stringify(currentToolCall));
                                                            savedCall.function.arguments = parsed;
                                                            toolCalls.push(savedCall);
                                                            toolCallCompleted = true;
                                                            currentToolCall = null;
                                                        } catch(e) {}
                                                    }
                                                }
                                            }
                                        }
                                    } else {
                                        // 原来是对象(初始化时的 {}),新来的是字符串片段
                                        currentToolCall.function.arguments = newArg;
                                    }
                                }
                            }
                        }
                        inToolCall = true;

                        // ★ 修复: 同一个 chunk 中可能同时包含 tool_calls 和 reasoning_content
                        // 不要直接 continue,先检查是否有 reasoning_content 需要处理
                        var _tcHasReasoning = (delta.reasoning_content !== undefined && delta.reasoning_content !== null && delta.reasoning_content !== '');
                        var _tcHasReasoningDetails = delta.reasoning_details && Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0;
                        if (!_tcHasReasoning && !_tcHasReasoningDetails) {
                            continue;
                        }
                    }

                    // 工具调用中的content(如果有)
                    if (inToolCall && delta.content !== undefined && delta.content !== null) {
                        toolCallContent += delta.content;
                        continue;
                    }

                    // 工具调用结束 - 只在明确没有tool_calls且没有reasoning时结束
                    if (inToolCall && !(delta.tool_calls && delta.tool_calls.length > 0) && currentToolCall && delta.content === undefined && delta.reasoning_content === undefined && !(delta.reasoning_details && delta.reasoning_details.length)) {
                        // 工具调用结束,清除placeholder
                        inToolCall = false;
                    }

                    // MiniMax reasoning_split 模式下,思考内容在 reasoning_details 数组中
                    const hasReasoningDetails = delta.reasoning_details && Array.isArray(delta.reasoning_details);
                    // 普通 reasoning_content (排除空字符串MiniMax空chunk)
                    const hasReasoningContent = delta.reasoning_content !== undefined && delta.reasoning_content !== null && delta.reasoning_content !== '';

                    if (!placeholderCleared && (hasReasoningContent || hasReasoningDetails || delta.content !== undefined)) {
                        const currentBubble = activeBubbleMap[chatId];
                        if (currentBubble && document.body.contains(currentBubble)) {
                            currentBubble.querySelector('.search-status')?.remove();
                        }
                        placeholderCleared = true;
                    }

                    // reasoning_details 数组格式 (MiniMax reasoning_split 模式)
                    if (hasReasoningDetails) {
                        for (const detail of delta.reasoning_details) {
                            if (detail && typeof detail.text === 'string') {
                                reasoningText += detail.text;
                            }
                        }
                        pendingMsg.reasoning = reasoningText;
                        if (currentChatId === chatId) {
                            const currentBubble = activeBubbleMap[chatId];
                            if (currentBubble) {
                                let details = currentBubble.querySelector('details.reasoning-details');
                                if (!details) {
                                    details = document.createElement('details');
                                    details.className = 'reasoning-details';
                                    details.open = true;
                                    details.innerHTML = `<summary>深度思考</summary><div class="reasoning-content"></div>`;
                                    const markdownBody = currentBubble.querySelector('.markdown-body');
                                    currentBubble.insertBefore(details, markdownBody);
                                }
                                details.querySelector('.reasoning-content').textContent = reasoningText;
                            }
                        }
                        // ★ 思考内容滚动追踪 - RAF节流,避免每token都触发scroll
                        if (!userScrolled) {
                            var _now2 = performance.now();
                            if (!window._lastThinkingScroll || _now2 - window._lastThinkingScroll > 32) {
                                window._lastThinkingScroll = _now2;
                                $.chatBox.scrollTop = $.chatBox.scrollHeight;
                            }
                        }
                        // 无延迟: 立即渲染
                    } else if (hasReasoningContent) {
                        // 普通字符串格式 reasoning_content
                        reasoningText += String(delta.reasoning_content);
                        pendingMsg.reasoning = reasoningText;
                        if (currentChatId === chatId) {
                            const currentBubble = activeBubbleMap[chatId];
                            if (currentBubble) {
                                let details = currentBubble.querySelector('details.reasoning-details');
                                if (!details) {
                                    details = document.createElement('details');
                                    details.className = 'reasoning-details';
                                    details.open = true;
                                    details.innerHTML = `<summary>深度思考</summary><div class="reasoning-content"></div>`;
                                    const markdownBody = currentBubble.querySelector('.markdown-body');
                                    currentBubble.insertBefore(details, markdownBody);
                                }
                                details.querySelector('.reasoning-content').textContent = reasoningText;
                            }
                        }
                        // ★ 思考内容滚动追踪 - RAF节流
                        if (!userScrolled) {
                            var _now3 = performance.now();
                            if (!window._lastThinkingScroll || _now3 - window._lastThinkingScroll > 32) {
                                window._lastThinkingScroll = _now3;
                                $.chatBox.scrollTop = $.chatBox.scrollHeight;
                            }
                        }
                    }

                    const rawContent = delta.content ?? delta.text ?? delta.message?.content;
                    // 处理各种可能的数据类型,避免对象被错误地转为 [object Object]
                    let textContent = null;
                    if (rawContent !== undefined && rawContent !== null) {
                        if (typeof rawContent === 'string') {
                            textContent = rawContent;
                        } else if (typeof rawContent === 'object' && rawContent !== null) {
                            // ★ 修复: 不用 || 链式取值(空字符串 "" 是 falsy,会让 || 跳到下一项对象)
                            const st = (v) => (v !== null && v !== undefined && typeof v === 'string') ? v : null;
                            const ex = st(rawContent.text) || st(rawContent.content) || st(rawContent.value);
                            if (ex !== null) {
                                textContent = ex;
                            } else if (Array.isArray(rawContent)) {
                                textContent = rawContent.map(c =>
                                    typeof c === 'object' ? (st(c.text) || st(c.content) || st(c.value) || '') : String(c)
                                ).filter(Boolean).join('');
                            } else {
                                textContent = Object.values(rawContent).find(v => typeof v === 'string' && v) || '';
                            }
                        } else {
                            textContent = String(rawContent);
                        }
                    }

                    if (textContent && textContent.length > 0) {
                        // ★ 如果模型已经通过 reasoning_content 提供了思考(如 llama.cpp deepseek format),
                        //   则 content 中不应再包含 <think> 标签,将它们剥离避免重复显示
                        if (reasoningText && textContent.includes('<think>')) {
                            textContent = textContent.replace(/<think>([\s\S]*?)(?:<\/think>|$)/g, '').replace(/<\/think>/g, '').trim();
                            if (!textContent) continue;
                        }
                        fullText += textContent;
                        fullText = fullText.replace(/\[object Object\]/g, '');

                        // ★ 实时提取所有<think>和(think)块到思考区
                        var _t = fullText;
                        var _allThink = '';
                        // 提取 <think>...</think> 标签
                        var _matches = _t.match(/<think>([\s\S]*?)(?:<\/think>|$)/g);
                        if (_matches) {
                            for (var _mi = 0; _mi < _matches.length; _mi++) {
                                _allThink += _matches[_mi].replace(/<\/?think>/g, '');
                            }
                            _t = _t.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '');
                        }
                        // 提取 MiniMax (think) 和 (endthink) 格式 (MiniMax M2.7)
                        var _t2 = _t;
                        var _matches2 = _t2.match(/\(think\)([\s\S]*?)(?:\(endthink\)|$)/g);
                        if (_matches2) {
                            for (var _mi2 = 0; _mi2 < _matches2.length; _mi2++) {
                                _allThink += _matches2[_mi2].replace(/\(endthink\)/g, '').replace(/\(think\)/g, '');
                            }
                            _t = _t.replace(/\(think\)[\s\S]*?(?:\(endthink\)|$)/g, '');
                        }
                        // 也处理只有开头的 (think) 后面没有关闭标签的情况
                        _t = _t.replace(/\(think\)\s*/g, '');
                        if (_allThink.trim()) {
                            reasoningText = _allThink.trim();
                            pendingMsg.reasoning = reasoningText;
                        }
                        pendingMsg.content = _t.trim() || (_allThink.trim() ? '' : fullText);
                        var _displayText = _t.trim();
                        // ★ 如果正文为空但思考有内容,不显示原始 (think) 标签
                        if (!_displayText && _allThink.trim()) {
                            _displayText = '';
                        } else if (!_displayText) {
                            _displayText = '';
                        }

                        if (currentChatId === chatId) {
                            var currentBubble = activeBubbleMap[chatId];
                            if (currentBubble) {
                                if (!hasContent) {
                                    // 不移除 typing，改加生成活跃标记让光晕持续
                                    currentBubble.classList.add('gen-active');
                                    hasContent = true;
                                }
                                // 实时更新思考区
                                if (reasoningText) {
                                    var _det3 = currentBubble.querySelector('details.reasoning-details');
                                    if (!_det3) {
                                        _det3 = document.createElement('details');
                                        _det3.className = 'reasoning-details';
                                        _det3.open = true;
                                        _det3.innerHTML = '<summary>深度思考</summary><div class="reasoning-content"></div>';
                                        var _mb2 = currentBubble.querySelector('.markdown-body');
                                        if (_mb2) currentBubble.insertBefore(_det3, _mb2);
                                    }
                                    _det3.querySelector('.reasoning-content').textContent = reasoningText;
                                }
                                // 流式渲染正文: 统一走节流管道
                                var _renderText = typeof _t !== 'undefined' ? _t : fullText;
                                applyStreamRender(chatId, _renderText);
                                // AI流式回复时,如果用户没有主动滚动上查,则跟随滚动
                                var _isFirstContent = !window._streamContentRendered;
                                if (_isFirstContent) {
                                    window._streamContentRendered = true;
                                }
                                if (!userScrolled) {
                                    $.chatBox.scrollTop = $.chatBox.scrollHeight;
                                }
                            }
                        }
                    // 无延迟: 立即渲染
                    }

                    if (data.usage) usage = data.usage;
                } catch (e) {
                    parseErrors++;
                    console.warn('[流式解析错误]', line?.slice(0, 100), e.message);
                }
            }
        }
    }

    // ★ 修复: 保存最后一个tool_call(去重)
    // DeepSeek V4 会在第一次增量拼接完整JSON后,再逐字符发一遍重放,
    // 重放会触发新INIT覆盖currentToolCall,所以流结束时可能只剩碎片字符(如"}")
    if (currentToolCall && !toolCallCompleted) {
        // 如果是对象,先转为JSON字符串
        if (typeof currentToolCall.function.arguments === 'object') {
            currentToolCall.function.arguments = JSON.stringify(currentToolCall.function.arguments);
        }
        // 如果是字符串,尝试解析为对象
        if (typeof currentToolCall.function.arguments === 'string') {
            let argsStr = currentToolCall.function.arguments.trim();

            // ★ 修复: 忽略单字符/碎片(DeepSeek V4重放产物)
            if (argsStr.length <= 2 && (argsStr === '}' || argsStr === ']' || argsStr === '')) {
                currentToolCall = null;
            } else {
                // 检查是否包含[object Object]前缀
                if (argsStr.startsWith('[object Object]')) {
                    argsStr = argsStr.substring('[object Object]'.length);
                }

                // 尝试解析,如果失败可能是多个JSON拼接或截断,提取第一个
                try {
                    currentToolCall.function.arguments = JSON.parse(argsStr);
                } catch (e) {
                    // 尝试修复截断的JSON:补全缺失的引号和括号
                    var fixedStr = argsStr;
                    var quoteCount = (fixedStr.match(/"/g) || []).length;
                    if (quoteCount % 2 !== 0) fixedStr += '"';
                    var openBraces = (fixedStr.match(/\{/g) || []).length;
                    var closeBraces = (fixedStr.match(/\}/g) || []).length;
                    while (closeBraces < openBraces) { fixedStr += '}'; closeBraces++; }

                    try {
                        currentToolCall.function.arguments = JSON.parse(fixedStr);
                    } catch (e2) {
                        var firstBrace = argsStr.indexOf('{');
                        var lastBrace = argsStr.lastIndexOf('}');
                        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                            var firstJson = argsStr.substring(firstBrace, lastBrace + 1);
                            try {
                                currentToolCall.function.arguments = JSON.parse(firstJson);
                            } catch (e3) {
                                currentToolCall.function.arguments = { query: argsStr };
                            }
                        } else {
                            currentToolCall.function.arguments = { query: argsStr };
                        }
                    }
                }
                // ★ 去重: 检查是否已存在于 toolCalls 中
                var _tcName = currentToolCall.function?.name;
                var _tcArgs = typeof currentToolCall.function?.arguments === 'object' ? JSON.stringify(currentToolCall.function.arguments) : String(currentToolCall.function?.arguments || '');
                var _isDuplicate = toolCalls.some(function(existingTc) {
                    return existingTc.function?.name === _tcName &&
                           JSON.stringify(existingTc.function?.arguments) === _tcArgs;
                });
                if (!_isDuplicate) {
                    toolCalls.push(currentToolCall);
                }
            }
        }
    }

    // ★ 全局去重: 移除同名同参数的重复 tool_calls
    if (toolCalls.length > 1) {
        var _uniqueTCs = [];
        var _seen = {};
        for (var _tci = 0; _tci < toolCalls.length; _tci++) {
            var _tcItem = toolCalls[_tci];
            var _tcKey = (_tcItem.function?.name || '') + '|' + JSON.stringify(_tcItem.function?.arguments || {});
            if (!_seen[_tcKey]) {
                _seen[_tcKey] = true;
                _uniqueTCs.push(_tcItem);
            }
        }
        if (_uniqueTCs.length < toolCalls.length) {
            console.log('[去重]', 'toolCalls', toolCalls.length, '→', _uniqueTCs.length);
            toolCalls = _uniqueTCs;
        }
    }

    // 如果全部解析失败且无任何内容,给用户提示
    if (!fullText && !reasoningText && !toolCalls.length && parseErrors > 0) {
        const currentBubble = activeBubbleMap[chatId];
        if (currentBubble && document.body.contains(currentBubble)) {
            currentBubble.querySelector('.markdown-body').innerHTML = `<span style="color:#ef4444">⚠️ 部分响应解析失败,可能是 API 返回格式不兼容。</span>`;
            currentBubble.classList.remove('typing', 'gen-active');
        }
    }
    if (toolCalls.length > 0) {
    }
    // MiniMax <think>标签:提取到思考区,正文只显示正文
    // 保存原始内容给API重试
    if (fullText && fullText.includes('<think>')) {
        pendingMsg._rawContent = fullText;
    }
    // 流结束时关闭思考区折叠
    if (reasoningText && currentChatId === chatId) {
        var _cb2 = activeBubbleMap[chatId];
        if (_cb2) {
            var _det4 = _cb2.querySelector('details.reasoning-details');
            if (_det4) _det4.open = true;
        }
    }
    // ★ 流式已经实时渲染了数学公式,不需要再次渲染
    // ★ 流结束时,如果 pendingMsg 中有生成的图片,渲染到气泡
    if (currentChatId === chatId) {
        var _streamBubble = activeBubbleMap[chatId];
        if (_streamBubble && pendingMsg.generatedImages && pendingMsg.generatedImages.length > 0) {
            if (!_streamBubble.querySelector('.generated-images-container')) {
                var _imgContStream = document.createElement('div');
                _imgContStream.className = 'generated-images-container';
                _imgContStream.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
                _streamBubble.appendChild(_imgContStream);
                // ★ 异步渲染每张图片,避免大批 base64 阻塞主线程
                pendingMsg.generatedImages.forEach(function(_imgData, _idx) {
                    setTimeout(function() {
                        var _wrapStream = document.createElement('div');
                        _wrapStream.style.cssText = 'position:relative;cursor:pointer;';
                        var _imgElStream = document.createElement('img');
                        _imgElStream.src = _imgData;
                        _imgElStream.decoding = 'async';
                        _imgElStream.style.cssText = 'max-width:' + (pendingMsg.generatedImages.length > 1 ? '160px' : '320px') + ';width:100%;border-radius:8px;display:block;';
                        _imgElStream.setAttribute('loading', 'lazy');
                        _imgElStream.addEventListener('click', function() { showImageLightbox(pendingMsg.generatedImages, _idx); });
                        _wrapStream.appendChild(_imgElStream);
                        _imgContStream.appendChild(_wrapStream);
                    }, _idx * 50); // 每张间隔50ms,给主线程喘息
                });
            }
        }
    }
    // 有思考但无正文:确保气泡有内容显示(思考已在折叠框,这里只确保气泡不空)
    if (!fullText && reasoningText) {
        pendingMsg.content = reasoningText;
    }

    // ★ MiniMax/模型兼容: 从 content 中解析文本格式的工具调用
    // 支持三种格式: <minimax:tool_call> XML, [TOOL_CALL] 括号格式
    if (!toolCalls.length && fullText && (fullText.includes('<minimax:tool_call>') || fullText.includes('[TOOL_CALL]'))) {
        console.log('[ToolCall] 检测到文本格式工具调用,开始解析...');

        // 格式1: <minimax:tool_call><invoke name="xxx"><parameter name="x">v</parameter></invoke></minimax:tool_call>
        const xmlRegex = /<minimax:tool_call>([\s\S]*?)<\/minimax:tool_call>/g;
        let xmlMatch;
        while ((xmlMatch = xmlRegex.exec(fullText)) !== null) {
            const invokeMatch = xmlMatch[1].match(/<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/);
            if (invokeMatch) {
                const funcName = invokeMatch[1];
                const args = {};
                const paramRegex = /<parameter name="([^"]+)">([^<]*)<\/parameter>/g;
                let pMatch;
                while ((pMatch = paramRegex.exec(invokeMatch[2])) !== null) {
                    const paramName = pMatch[1];
                    let paramValue = pMatch[2].trim();
                    try { paramValue = JSON.parse(paramValue); } catch(e) {}
                    args[paramName] = paramValue;
                }
                toolCalls.push({ id: 'call_mm_' + Date.now() + '_' + toolCalls.length, type: 'function', function: { name: funcName, arguments: JSON.stringify(args) } });
                console.log('[ToolCall] XML格式 提取:', funcName, args);
            }
        }

        // 格式2: [TOOL_CALL]\n{tool => "web_search", args => {--query "xxx"}}\n[/TOOL_CALL]
        const tcRegex = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"([^"]+)"[^}]*args\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\}[\s\S]*?\[\/TOOL_CALL\]/g;
        let tcMatch;
        while ((tcMatch = tcRegex.exec(fullText)) !== null) {
            const funcName = tcMatch[1];
            const argsBlock = tcMatch[2];
            const args = {};
            const paramRegex = /--(\w+)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/g;
            let pMatch;
            while ((pMatch = paramRegex.exec(argsBlock)) !== null) {
                const paramName = pMatch[1];
                const paramValue = pMatch[2] !== undefined ? pMatch[2] : (pMatch[3] !== undefined ? pMatch[3] : pMatch[4]);
                args[paramName] = paramValue;
            }
            toolCalls.push({ id: 'call_mm_' + Date.now() + '_' + toolCalls.length, type: 'function', function: { name: funcName, arguments: JSON.stringify(args) } });
            console.log('[ToolCall] TOOL_CALL格式 提取:', funcName, args);
        }

        // 清理: 移除所有工具调用标记,保留前面的思考文本
        fullText = fullText.replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, '').trim();
        fullText = fullText.replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g, '').trim();
        if (!fullText && reasoningText) { fullText = reasoningText; }
    }

    return { fullText, reasoningText, usage, toolCalls };
}

async function handleNonStream(res, chatId, pendingMsg, currentBubble) {
    // 首先检查响应状态
    if (!res.ok) {
        // 对于错误响应,不要尝试读取 body
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    let data;
    try {
        let rawText = await res.text();
        if (rawText.startsWith('data: ') || rawText.includes('\ndata: ')) {
            // SSE格式非流式响应:提取所有data:行内容
            let allContent = '';
            let lines = rawText.split('\n');
            for (let l of lines) {
                if (l.startsWith('data: ') && l !== 'data: [DONE]') {
                    try {
                        let chunk = JSON.parse(l.substring(6));
                        let c = chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content;
                        if (c) allContent += c;
                    } catch(e2) {}
                }
            }
            data = { choices: [{ message: { content: allContent } }] };
        } else {
            try {
                data = JSON.parse(rawText);
            } catch(e3) { throw new Error('响应格式错误: ' + e3.message); }
        }

    } catch (e) {
        // 如果 JSON 解析失败,可能是响应格式问题
        // 注意:我们不能再读取 .text(),因为 body 可能已经被消耗
        console.error('[非流式响应JSON解析失败]', e.message);
        throw new Error(`响应格式错误: ${e.message}`);
    }

    // 检查 API 错误信息
    if (data.error) {
        throw new Error(`API 错误: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const choice = data.choices?.[0];
    if (!choice) {
        throw new Error('API 返回无有效 choices');
    }

    const msg = choice.message || {};
    const st = (v) => (v !== null && v !== undefined && typeof v === 'string') ? v : null;
    let fullText = '';
    var _generatedImages = [];  // ★ 提前声明,供 content 数组提取图片使用
    if (msg.content !== undefined && msg.content !== null) {
        if (typeof msg.content === 'string') {
            fullText = msg.content;
        } else if (typeof msg.content === 'object') {
            const ex = st(msg.content.text) || st(msg.content.content) || st(msg.content.value);
            if (ex !== null) {
                fullText = ex;
            } else if (Array.isArray(msg.content)) {
                // ★ 从数组中提取文本和图片 URL（修复 GPT Image 模型图片不可见）
                var _textParts = [];
                for (var _ci = 0; _ci < msg.content.length; _ci++) {
                    var _cpart = msg.content[_ci];
                    if (_cpart && typeof _cpart === 'object') {
                        // 提取 image_url 类型的图片
                        if (_cpart.type === 'image_url' && _cpart.image_url && _cpart.image_url.url) {
                            _generatedImages.push(_cpart.image_url.url);
                        }
                        // 提取文本
                        var _t = st(_cpart.text) || st(_cpart.content) || st(_cpart.value);
                        if (_t) _textParts.push(_t);
                    } else if (typeof _cpart === 'string') {
                        _textParts.push(_cpart);
                    }
                }
                fullText = _textParts.join('');
            } else {
                fullText = Object.values(msg.content).find(v => typeof v === 'string' && v) || '';
            }
        } else {
            fullText = String(msg.content);
        }
    }
    fullText = (fullText || '').replace(/\[object Object\]/g, '');
    // ★ 提取图像模型生成的图片 (msg.images 数组 + content 中已提取的)
    console.log('[ImageModel] handleNonStream: msg.images=', msg.images ? 'present' : 'absent',
        'msg.content type=', typeof msg.content, 'length=', (typeof msg.content === 'string' ? msg.content.length : 'N/A'));
    if (msg.images && Array.isArray(msg.images)) {
        console.log('[ImageModel] msg.images count:', msg.images.length);
        msg.images.forEach(function(img) {
            console.log('[ImageModel] image item keys:', Object.keys(img), 'url present:', !!(img.image_url && img.image_url.url));
            if (img.image_url && img.image_url.url) _generatedImages.push(img.image_url.url);
            else if (img.url) _generatedImages.push(img.url);
            else if (typeof img === 'string') _generatedImages.push(img);
        });
    }
    // 备用: content 中的 base64 图片
    if (_generatedImages.length === 0 && fullText) {
        var _b64matches = fullText.match(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]{100,}/g);
        if (_b64matches) _generatedImages = _b64matches;
    }
    // 备用: 检查整个 data 对象中是否有图片相关字段
    if (_generatedImages.length === 0) {
        if (data.image_url) _generatedImages.push(data.image_url);
        if (data.url && data.url.startsWith('data:image')) _generatedImages.push(data.url);
    }
    console.log('[ImageModel] extracted images:', _generatedImages.length);
    // ★ 同步到 pendingMsg,供后续渲染使用
    if (_generatedImages.length > 0) {
        if (!pendingMsg.generatedImages) pendingMsg.generatedImages = [];
        for (var _gi = 0; _gi < _generatedImages.length; _gi++) {
            if (pendingMsg.generatedImages.indexOf(_generatedImages[_gi]) === -1) {
                pendingMsg.generatedImages.push(_generatedImages[_gi]);
                if (_gi === 0) pendingMsg.generatedImage = _generatedImages[_gi];
                // ★ 上传到服务器,确保刷新后图片不消失 (直接生成路径,同步等待)
                var _imgHns = _generatedImages[_gi];
                if (_imgHns && !_imgHns.startsWith(window.location.origin) && !_imgHns.startsWith('/oneapichat')) {
                    try {
                        var _srvUrlHns = await uploadImageToServer(_imgHns);
                        if (_srvUrlHns) {
                            console.log('[ImageModel] 图片已上传到服务器:', _srvUrlHns);
                            pendingMsg.generatedImages[_gi] = _srvUrlHns;
                            if (pendingMsg.generatedImage === _imgHns) pendingMsg.generatedImage = _srvUrlHns;
                            _generatedImages[_gi] = _srvUrlHns;  // ★ 同时更新返回数组
                        }
                    } catch(e) {
                        console.warn('[ImageModel] 上传直接生成图片失败:', e.message);
                    }
                }
            }
        }
        // ★ 图片已保存为服务器URL,立即持久化到 localStorage 防止刷新丢失
        slimSaveChats();
    }
    let reasoningText = '';
    let toolCalls = msg.tool_calls || [];

    // ★ MiniMax/模型兼容: 从 content 中解析文本格式的工具调用
    // 支持三种格式: <minimax:tool_call> XML, [TOOL_CALL] 括号格式
    if (!toolCalls.length && fullText && (fullText.includes('<minimax:tool_call>') || fullText.includes('[TOOL_CALL]'))) {
        console.log('[ToolCall非流式] 检测到文本格式工具调用,开始解析...');

        // 格式1: <minimax:tool_call><invoke name="xxx"><parameter name="x">v</parameter></invoke></minimax:tool_call>
        const xmlRegex = /<minimax:tool_call>([\s\S]*?)<\/minimax:tool_call>/g;
        let xmlMatch;
        while ((xmlMatch = xmlRegex.exec(fullText)) !== null) {
            const invokeMatch = xmlMatch[1].match(/<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/);
            if (invokeMatch) {
                const funcName = invokeMatch[1];
                const args = {};
                const paramRegex = /<parameter name="([^"]+)">([^<]*)<\/parameter>/g;
                let pMatch;
                while ((pMatch = paramRegex.exec(invokeMatch[2])) !== null) {
                    const paramName = pMatch[1];
                    let paramValue = pMatch[2].trim();
                    try { paramValue = JSON.parse(paramValue); } catch(e) {}
                    args[paramName] = paramValue;
                }
                toolCalls.push({ id: 'call_mm_' + Date.now() + '_' + toolCalls.length, type: 'function', function: { name: funcName, arguments: JSON.stringify(args) } });
                console.log('[ToolCall非流式] XML格式 提取:', funcName, args);
            }
        }

        // 格式2: [TOOL_CALL]\n{tool => "web_search", args => {--query "xxx"}}\n[/TOOL_CALL]
        const tcRegex = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"([^"]+)"[^}]*args\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\}[\s\S]*?\[\/TOOL_CALL\]/g;
        let tcMatch;
        while ((tcMatch = tcRegex.exec(fullText)) !== null) {
            const funcName = tcMatch[1];
            const argsBlock = tcMatch[2];
            const args = {};
            const paramRegex = /--(\w+)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/g;
            let pMatch;
            while ((pMatch = paramRegex.exec(argsBlock)) !== null) {
                const paramName = pMatch[1];
                const paramValue = pMatch[2] !== undefined ? pMatch[2] : (pMatch[3] !== undefined ? pMatch[3] : pMatch[4]);
                args[paramName] = paramValue;
            }
            toolCalls.push({ id: 'call_mm_' + Date.now() + '_' + toolCalls.length, type: 'function', function: { name: funcName, arguments: JSON.stringify(args) } });
            console.log('[ToolCall非流式] TOOL_CALL格式 提取:', funcName, args);
        }

        fullText = fullText.replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, '').trim();
        fullText = fullText.replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g, '').trim();
    }

    const usage = data.usage;

    // 处理 reasoning_details(MiniMax 特有格式)
    if (msg.reasoning_details && Array.isArray(msg.reasoning_details)) {
        reasoningText = msg.reasoning_details.map(d => d.text || '').join('');
    } else if (msg.reasoning_content) {
        reasoningText = msg.reasoning_content;
    } else if (msg.reasoning) {
        reasoningText = msg.reasoning;
    }
    // 兜底确保 reasoningText 是字符串(不再覆盖上面的提取结果)
    if (!reasoningText) {
        const rc = msg.reasoning_content ?? msg.reasoning;
        if (rc !== null && rc !== undefined) reasoningText = String(rc);
    }
    if (typeof reasoningText !== 'string') reasoningText = '';

    // ★ 从 fullText 中提取思考和推理内容
    var _ht = fullText;
    var _htAllThink = '';
    // 格式1: 标准HTML <think>...</think> 标签 (Ollama deepseek-r1/qwq 等本地模型)
    var _htMatchesThink = _ht.match(/<think>([\s\S]*?)<\/think>/g);
    if (_htMatchesThink) {
        for (var _hti1 = 0; _hti1 < _htMatchesThink.length; _hti1++) {
            _htAllThink += _htMatchesThink[_hti1].replace(/<\/?think>/g, '');
        }
        fullText = fullText.replace(/<think>[\s\S]*?<\/think>/g, '');
    }
    // 格式2: MiniMax (think)...(endthink)
    var _htMatches2 = _ht.match(/\(think\)([\s\S]*?)(?:\(endthink\)|$)/g);
    if (_htMatches2) {
        for (var _hti2 = 0; _hti2 < _htMatches2.length; _hti2++) {
            _htAllThink += _htMatches2[_hti2].replace(/\(endthink\)/g, '').replace(/\(think\)/g, '');
        }
        fullText = fullText.replace(/\(think\)[\s\S]*?(?:\(endthink\)|$)/g, '').replace(/\(think\)\s*/g, '');
    }
    if (_htAllThink.trim() && !reasoningText) {
        reasoningText = _htAllThink.trim();
    }
    // ★ 流结束: 取消未执行的节流渲染,直接用最终内容
    if (typeof _streamRenderTimer !== 'undefined' && _streamRenderTimer[chatId]) { clearTimeout(_streamRenderTimer[chatId]); _streamRenderTimer[chatId] = null; }

    pendingMsg.content = fullText.replace(/\[object Object\]/g, '');
    pendingMsg.reasoning = reasoningText;
    delete pendingMsg.partial;  // ★ 标记消息已完成,防止被下次 sendMessage 清理

    if (currentChatId === chatId && currentBubble) {
        try {
        currentBubble.classList.remove('typing', 'gen-active');
        const markdownBody = currentBubble.querySelector('.markdown-body');
        if (markdownBody) {
            markdownBody.innerHTML = '';
            if (reasoningText) {
                var _det = document.createElement('details');
                _det.className = 'reasoning-details';
                _det.open = true;
                _det.innerHTML = '<summary>💭 深度思考</summary><div class="reasoning-content">' + reasoningText.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
                markdownBody.appendChild(_det);
            }
            if (fullText) {
                const contentEl = document.createElement('div');
                contentEl.innerHTML = _renderMarkdownWithMath(fullText);
                markdownBody.appendChild(contentEl);
                _triggerPostRender(contentEl);
            }
            // ★ 操作按钮由 appendMessage 统一管理,不重复创建
            // ★ 流式完成:滚到底部(图表可能已延迟渲染导致高度变化)
            setTimeout(function _scrollAfterRender() {
                if (!userScrolled) $.chatBox.scrollTop = $.chatBox.scrollHeight;
            }, 200);
            // ★ 非流式响应完成:如果有生成的图片,渲染到气泡
            if (pendingMsg.generatedImages && pendingMsg.generatedImages.length > 0 && !currentBubble.querySelector('.generated-images-container')) {
                // ★ 清除工具执行时留下的占位符
                var _oldPh = currentBubble.querySelector('#image-placeholder');
                if (_oldPh) _oldPh.remove();
                var _imgContNs = document.createElement('div');
                _imgContNs.className = 'generated-images-container';
                _imgContNs.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
                currentBubble.appendChild(_imgContNs);
                // ★ 异步渲染每张图片
                pendingMsg.generatedImages.forEach(function(_imgData, _idx) {
                    setTimeout(function() {
                        var _wrapNs = document.createElement('div');
                        _wrapNs.style.cssText = 'position:relative;cursor:pointer;';
                        var _imgElNs = document.createElement('img');
                        _imgElNs.src = _imgData;
                        _imgElNs.decoding = 'async';
                        _imgElNs.style.cssText = 'max-width:' + (pendingMsg.generatedImages.length > 1 ? '160px' : '320px') + ';width:100%;border-radius:8px;display:block;';
                        _imgElNs.setAttribute('loading', 'lazy');
                        _imgElNs.addEventListener('click', function() { showImageLightbox(pendingMsg.generatedImages, _idx); });
                        _imgElNs.onerror = function() { this.style.display = 'none'; };
                        _wrapNs.appendChild(_imgElNs);
                        _imgContNs.appendChild(_wrapNs);
                    }, _idx * 50);
                });
            }
        }
        } catch(_bubbleErr) {
            console.error('[handleNonStream] bubble render error:', _bubbleErr.message, _bubbleErr.stack);
        }
    }

    return { fullText, reasoningText, usage, toolCalls, generatedImages: _generatedImages };
}

function handleError(e, chatId, pendingMsg, currentBubble) {
    // ★ 清除流式保存定时器 + RAF渲染循环
    if (pendingMsg && pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
    cleanupStreamState(chatId);
    // ★ 通知模式解锁
    window._agentNotifyProcessing = false;
    const hasContent = pendingMsg && pendingMsg.content && typeof pendingMsg.content === 'string' && pendingMsg.content.trim() !== '';
    const hasReasoning = pendingMsg && pendingMsg.reasoning && typeof pendingMsg.reasoning === 'string' && pendingMsg.reasoning.trim() !== '';
    if (!hasContent && !hasReasoning) {
        const chatMessages = (chats && chats[chatId]) ? chats[chatId].messages : null;
        if (chatMessages) {
            const idx = chatMessages.findIndex(m => m.partial);
            if (idx !== -1) chatMessages.splice(idx, 1);
        }
    } else {
        if (pendingMsg) {
            delete pendingMsg.partial;
            try { localStorage.removeItem('_savedPartial'); } catch(e) {}
            pendingMsg.content = pendingMsg.content || '';
            pendingMsg.reasoning = pendingMsg.reasoning || '';
        }
    }
    saveChats();
    if (currentChatId === chatId && currentBubble) {
        currentBubble.classList.remove('typing', 'gen-active');
        // 配置面板编辑时不显示错误,避免频繁报错
        if (!configPanelInteracting) {
            var errorMsg = e.name === 'AbortError' ? '⚠️ 请求已停止或超时。' : ('❌ 错误: ' + escapeHtml(e.message || ''));
            currentBubble.querySelector('.markdown-body').innerHTML = errorMsg;
        } else {
            currentBubble.querySelector('.markdown-body').innerHTML = '';
        }
    } else if (currentChatId === chatId) {
        loadChat(chatId);
    }
    if (!configPanelInteracting) {
        showToast(`请求失败: ${e.message}`, 'error');
    }
}

// ==================== 自动错误恢复功能 ====================
// 当检测到模型不支持 image_url 格式时,自动将其标记为文本模型并重试
window.autoDetectAndRetryImageUrlError = async function(errorMessage, chatId, pendingMsg, currentBubble) {
    // 检测是否是 image_url 格式错误
    if (!errorMessage.includes("unknown variant") && !errorMessage.includes("image_url")) {
        return false;
    }
    // 获取当前模型
    const currentModel = getVal('modelSelect') || '';

    if (!currentModel) {
        return false;
    }

    // 将模型添加到文本模型列表
    try {
        const autoTextModels = JSON.parse(localStorage.getItem('autoDetectedTextModels') || '[]');
        if (!autoTextModels.includes(currentModel)) {
            autoTextModels.push(currentModel);
            localStorage.setItem('autoDetectedTextModels', JSON.stringify(autoTextModels));
        }
    } catch (e) {
        console.error('[AutoRecovery] 保存文本模型列表失败:', e);
    }

    // 显示提示
    showToast('模型 ' + currentModel + ' 不支持图片格式,已自动切换到工具调用模式', 'warning', 3000);

    // 清理当前错误消息
    if (currentBubble) {
        currentBubble.classList.remove('typing', 'gen-active');
        currentBubble.querySelector('.markdown-body').innerHTML = '⚠️ 模型不支持图片格式,正在重新发送...';
    }

    // 从聊天历史中移除最后的助手消息
    if (chatId && chats[chatId]) {
        const msgs = chats[chatId].messages;
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant' && msgs[i].partial) {
                msgs.splice(i, 1);
                break;
            }
        }
        saveChats();
    }

    // 重新发送之前的用户消息
    if (chatId && chats[chatId]) {
        const lastUser = [...chats[chatId].messages].reverse().find(m => m.role === 'user' && !m.temporary);
        if (lastUser) {

            setTimeout(async () => {
                try {
                    // ★ 自动重发(图片已由文本模型列表屏蔽,走 analyze_image 工具)
                    await sendMessage(true, lastUser.text, lastUser.files);
                } catch (e) {
                    console.error('[AutoRecovery] 重发失败:', e);
                }
            }, 1000);

            return true;
        }
    }

    return false;
};

// ★ 消息队列 → js/queue.js (Phase 8 拆分)

window.sendMessage = async function (skipUserAdd, userTextForRegen, userFilesForRegen) {
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

    const chatId = currentChatId;
    if (!chatId) return;
    if (isTypingMap[chatId]) {
        // ★ AI 正在生成:所有模式都推入队列
        if (!skipUserAdd) {
            var _inputEl = $.userInput;
            var _qText = userTextForRegen || (_inputEl ? _inputEl.value.trim() : '');
            if (_qText || (pendingFiles && pendingFiles.length > 0)) {
                var safeFiles = (pendingFiles || []).map(function(f) {
                    return { name: f.name, isImage: !!f.isImage, type: f.type, size: f.size };
                });
                var _qId = ++window._queueIdCounter;
                window._messageQueue.push({ id: _qId, text: _qText, files: safeFiles });
                
                pendingFiles = [];
                if (_inputEl) { _inputEl.value = ''; window.autoResize(_inputEl); }
                window._saveQueue();
                window._updateQueueUI();
                showToast('⏳ 已推入消息队列 (共' + window._messageQueue.length + '条)', 'info', 2000);
            }
            return;
        }
        // 系统内队列调用:忙时不做任何事,等 finally
        // 由 finally 中的 _drainQueue 处理
        return;
    }

    const input = $.userInput;
    let text = skipUserAdd ? userTextForRegen : input?.value.trim() || '';
    var files = skipUserAdd ? userFilesForRegen : pendingFiles;

    // ★ 新消息: 重置滚动状态 + 滚动到底部
    if (!skipUserAdd) { userScrolled = false; setTimeout(function() { if ($.chatBox) $.chatBox.scrollTop = $.chatBox.scrollHeight; }, 30); }

    // ★ 内部触发时 (skipUserAdd=true): text 可能为 null/undefined, 统一降级
    if (!text && skipUserAdd) { text = ''; }
    if (!skipUserAdd && !text && !files.length) {
        stopGenerationForChat(chatId);
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
        return;
    }

    // 按需生成临时时间戳消息(基于关键词)
    const temporaryTimestamp = createTemporaryTimestampIfNeeded(text);

    // 移除旧的临时消息
    chats[chatId].messages = chats[chatId].messages.filter(m => !m.temporary);
    // ★ 发送消息时重置滚动状态,并锁定流式跟随
    userScrolled = false;
    streamingScrollLock = false;
    window._streamContentRendered = false;
    const partialIdx = chats[chatId].messages.findIndex(m => m.partial);
    if (partialIdx !== -1) chats[chatId].messages.splice(partialIdx, 1);

    // 停止旧请求(不设置用户停止标记,以便新请求可以正常重试)
    abortExistingRequest(chatId);

    const abortMain = new AbortController();
    abortControllerMap[chatId] = abortMain;
    const abortSearch = new AbortController();
    searchAbortControllerMap[chatId] = abortSearch;

    isTypingMap[chatId] = true;
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
    const historySummary = buildHistorySummary(chatId);

    // 添加用户消息
    // 保存当前消息是否包含图片(在 clearAllFiles 之前)
    const currentMessageHasImages = files && files.length > 0 && files.some(f => f.isImage || f.type?.startsWith('image/'));
    // ★ 保存标记供 buildApiMessages 使用(pendingFiles 即将被清空)
    window.__currentMessageHasImages = currentMessageHasImages;

    // 立即清空输入框,让用户知道消息已发送
    if (input) {
        input.value = '';
        window.autoResize(input);
    }

    // 如果有图片,不自动分析,让AI自主决定是否调用分析工具
    // 图片会作为附件发送给AI,AI可以自主选择是否使用 analyze_image 工具

    if (!skipUserAdd) {
        chats[chatId].messages.push({ role: 'user', text, files: files.map(f => ({ name: f.name, content: f.content, serverUrl: f.serverUrl || '', size: f.size, type: f.type || (f.isImage ? 'image/' : '') })) });
        // ★ 用户消息发出后立即保存,确保未开新会话时数据不丢
        slimSaveChats();
        if (chats[chatId].title === '新对话') {
            chats[chatId].title = text ? text.slice(0, 10) : (files.length ? '文件消息' : '新对话');
        }
        if (currentChatId === chatId) loadChat(chatId);
        // 输入框已在前面清空
        clearAllFiles();
    } else if (window._isQueueMessage) {
        // ★ 队列消息:插入聊天记录并立即渲染到界面
        var _qFiles = (files && files.length > 0) ? files.map(function(f) {
            return { name: f.name, content: f.content || null, serverUrl: f.serverUrl || '', size: f.size || 0, type: f.type || (f.isImage ? 'image/' : '') };
        }) : [];
        chats[chatId].messages.push({ role: 'user', text: text, files: _qFiles });
        slimSaveChats();
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
    const pendingMsg = { role: 'assistant', content: '', reasoning: '', partial: true };
    chats[chatId].messages.push(pendingMsg);
    let currentBubble = null;
    if (currentChatId === chatId) {
        currentBubble = appendMessage('assistant', '', null, null, null, 0, false);
        if (currentBubble) currentBubble.classList.add('typing');
        activeBubbleMap[chatId] = currentBubble;
        setTimeout(function() { autoScrollToBottom('sendMessage'); }, 50);
    }

    // 执行搜索
    const _modelMiniMax2 = (getVal('modelSelect') || '').toLowerCase().includes('minimax');
    // ★ 修复: MiniMax 也启用工具调用模式,让模型通过 tool_calls 决定何时搜索
    const useToolCall = getChecked('searchToolCallToggle') || (files.length > 0 && files.some(f => f.isImage || f.type?.startsWith('image/')));
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
        const threshold = parseInt(getVal('compressThreshold')) || 10;
        const nonSys = chats[chatId].messages.filter(m => m.role !== 'system' && !m.partial && !m.temporary).length;
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
        const _isMm = (getVal('modelSelect') || '').toLowerCase().includes('minimax');
        if (_isMm) {
            const sysIdx = apiMessages.findIndex(m => m.role === 'system');
            if (sysIdx !== -1) {
                apiMessages[sysIdx].content += '\n\n' + temporaryTimestamp.content;
            } else {
                // 没有 system 消息,找到 user 消息前面插入
                const userIdx = apiMessages.findIndex(m => m.role === 'user');
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
            const sysIndex = apiMessages.findIndex(m => m.role === 'system');
            if (sysIndex !== -1) {
                apiMessages.splice(sysIndex + 1, 0, temporaryTimestamp);
            } else {
                apiMessages.unshift(temporaryTimestamp);
            }
        }
    }

    // ★ MiniMax: 工具提示注入到 system 消息（而非 user 消息，避免模型误以为是用户指令）
    const __isMiniMaxModel = (getVal('modelSelect') || '').toLowerCase().includes('minimax');
    if (__isMiniMaxModel && getChecked('searchToggle')) {
        const toolHint = '你可以使用 web_search 搜索最新信息,使用 web_fetch 抓取网页详情。';
        var _sysIdx2 = apiMessages.findIndex(function(m) { return m.role === 'system'; });
        if (_sysIdx2 >= 0 && typeof apiMessages[_sysIdx2].content === 'string') {
            if (!apiMessages[_sysIdx2].content.includes('web_search')) {
                apiMessages[_sysIdx2].content += '\n\n' + toolHint;
            }
        }
    }

    // ★ Agent 模式: 合并 agent 系统提示词 + 记忆/人格/身份信息
    if (isAgentToolsActive()) {
        var agentPrompt = localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt;
        // ★ 注入工具调用上限(模型一开始就知道最多调用几次)
        var _maxRounds = parseInt(localStorage.getItem('agentMaxToolRounds')) || 50;
        agentPrompt += '\n\n## 工具调用限制\n本轮对话最多调用 ' + _maxRounds + ' 次工具。请合理规划,避免浪费配额。如果接近上限,优先给出已有结果而不是继续调用。';
        // ★ plan_update 使用提示（精简版，已有则不重复注入）
        if (agentPrompt.indexOf('plan_update') === -1) {
            agentPrompt += '\n\n## 计划管理\n复杂任务(≥3步)先用 plan_update(action="create") 创建计划面板，执行中更新状态，完成后 plan_update(action="complete")。简单任务无需计划。';
        }
        if (agentPrompt) {
            // 追加到第一条 system 消息
            var sysIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
            var sysContent = agentPrompt;
            // 尝试从内存缓存获取人格/身份/记忆并注入
            try {
                var _cachedPersona = window.__agentPersonaCache || window.__cloudPersona;
                var _cachedIdentity = window.__agentIdentityCache || window.__cloudIdentity;
                var _cachedUser = window.__cloudUser;
                var _cachedMemories = window.__agentMemoryCache;
                var _cloudMemories = window.__cloudMemories;
                var _inject = '';
                // 人格
                if (_cachedPersona && _cachedPersona.name) {
                    _inject += '\n\n## 人格设定\n- AI名称: ' + _cachedPersona.name + '\n';
                    if (_cachedPersona.style) _inject += '- 风格: ' + _cachedPersona.style + '\n';
                    if (_cachedPersona.emoji) _inject += '- 标志: ' + _cachedPersona.emoji + '\n';
                }
                // AI 身份
                if (_cachedIdentity) {
                    _inject += '\n## AI身份\n';
                    if (_cachedIdentity.name) _inject += '- 名称: ' + _cachedIdentity.name + '\n';
                    if (_cachedIdentity.style) _inject += '- 风格: ' + _cachedIdentity.style + '\n';
                    if (_cachedIdentity.emoji) _inject += '- 标志: ' + _cachedIdentity.emoji + '\n';
                }
                // 用户信息
                if (_cachedUser && (_cachedUser.name || _cachedUser.notes)) {
                    _inject += '\n## 用户信息\n';
                    if (_cachedUser.name) _inject += '- 称呼: ' + _cachedUser.name + '\n';
                    if (_cachedUser.notes) _inject += '- 备注: ' + _cachedUser.notes + '\n';
                }
                // 引擎记忆
                if (_cachedMemories && _cachedMemories.length > 0) {
                    _inject += '\n## 长期记忆\n';
                    var _mc = 0;
                    for (var _mi = 0; _mi < _cachedMemories.length && _mc < 15; _mi++) {
                        var _me = _cachedMemories[_mi];
                        if (_me && _me.key) {
                            _inject += '- [' + _me.key + '] ' + (_me.content || '') + '\n';
                            _mc++;
                        }
                    }
                }
                // 云端记忆 (memory_api.php)
                if (_cloudMemories && !_cachedMemories) {
                    _inject += '\n' + _cloudMemories;
                }
                if (_inject) sysContent += _inject;
            } catch(e) {
                console.warn('[AgentMemory] 注入缓存失败:', e);
            }
            if (sysIdx !== -1) {
                apiMessages[sysIdx].content = apiMessages[sysIdx].content + '\n\n' + sysContent;
            } else {
                apiMessages.unshift({ role: 'system', content: sysContent });
            }
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

    // 选择模型
    let model = getVal('modelSelect') || DEFAULT_CONFIG.model;
    // 图片由 analyze_image 工具处理,不切换模型(analyze_image 会调用 MCP 桥接)
    // 保持使用当前文本模型即可
    if (searchResult.searchPerformed && searchResult.searchResults?.length) {
        const searchModel = getVal('searchModel');
        if (searchModel && searchModel !== '加载中...') model = searchModel;
    }

    // 估算tokens(排除base64图片数据,处理数组格式)
    const totalText = apiMessages.map(m => {
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
    const estimated = estimateTokens(totalText);
    // ★ 完全按用户配置,不按模型自动调整
    let requestedTokens = parseInt(getVal('maxTokens')) || 4096;

    // 构建请求体
    // ★ MiniMax M3 Anthropic 兼容（暂时禁用，OpenAI 端点已稳定）
    var _useAnthropicFormat = false; // (getVal('modelSelect') || '').toLowerCase().includes('minimax-m3');
    var _aSysContent = '';
    if (_useAnthropicFormat) {
        // 提取 system 消息
        var _nonSysMsgs = [];
        for (var _ami = 0; _ami < apiMessages.length; _ami++) {
            var _am = apiMessages[_ami];
            if (_am.role === 'system') {
                _aSysContent += (_aSysContent ? '\n\n' : '') + (typeof _am.content === 'string' ? _am.content : '');
            } else {
                _nonSysMsgs.push(JSON.parse(JSON.stringify(_am))); // 深拷贝避免修改原数据
            }
        }
        // 转换消息格式
        for (var _ami2 = 0; _ami2 < _nonSysMsgs.length; _ami2++) {
            var _am2 = _nonSysMsgs[_ami2];
            if (_am2.role === 'user') {
                // ★ 跳过已转换的 Anthropic 格式消息（含 tool_result 或 tool_use 块）
                var _alreadyAnthropic = Array.isArray(_am2.content) && _am2.content.some(function(c) { return c.type === 'tool_result' || c.type === 'tool_use'; });
                if (_alreadyAnthropic) continue; // 已经是 Anthropic 格式，跳过
                if (typeof _am2.content === 'string') {
                    _am2.content = [{ type: 'text', text: _am2.content }];
                } else if (Array.isArray(_am2.content)) {
                    _am2.content = _am2.content.map(function(c) {
                        if (c.type === 'image_url') {
                            return { type: 'image', source: { type: 'url', url: c.image_url.url } };
                        }
                        if (c.type === 'video_url') return { type: 'video', source: { type: 'url', url: c.video_url.url } };
                        return c;
                    });
                }
            } else if (_am2.role === 'assistant' && _am2.tool_calls) {
                var _blocks = [];
                if (typeof _am2.content === 'string' && _am2.content.trim()) {
                    _blocks.push({ type: 'text', text: _am2.content });
                }
                for (var _tci = 0; _tci < _am2.tool_calls.length; _tci++) {
                    var _tc = _am2.tool_calls[_tci];
                    var _input = {};
                    try { _input = JSON.parse(_tc.function.arguments || '{}'); } catch(e) {}
                    _blocks.push({ type: 'tool_use', id: _tc.id || 'toolu_' + Date.now(), name: _tc.function.name, input: _input });
                }
                _am2.content = _blocks;
                delete _am2.tool_calls;
            } else if (_am2.role === 'tool') {
                _am2.role = 'user';
                var _tid = _am2.tool_call_id || '';
                // ★ 修复空 tool_call_id: 从前面最近的 assistant tool_use 中查找
                if (!_tid) {
                    for (var _tli = _ami2 - 1; _tli >= 0; _tli--) {
                        var _prev = _nonSysMsgs[_tli];
                        if (_prev.role === 'assistant' && _prev.content && Array.isArray(_prev.content)) {
                            for (var _pci = _prev.content.length - 1; _pci >= 0; _pci--) {
                                if (_prev.content[_pci].type === 'tool_use' && _prev.content[_pci].id) {
                                    _tid = _prev.content[_pci].id;
                                    break;
                                }
                            }
                            if (_tid) break;
                        }
                    }
                }
                // 终极兜底：生成唯一 ID
                if (!_tid) _tid = 'toolu_fallback_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                _am2.content = [{ type: 'tool_result', tool_use_id: _tid, content: typeof _am2.content === 'string' ? _am2.content : JSON.stringify(_am2.content) }];
                delete _am2.tool_call_id;
            }
        }
        apiMessages = _nonSysMsgs;
    }

    // 统一获取模型选择并转小写
    const currentModel = getVal('modelSelect') || '';
    const modelLower = currentModel.toLowerCase();

    var body = {
        model,
        messages: apiMessages,
        stream: ((window.isProxyEnabled() && !modelLower.includes('minimax') && !_useAnthropicFormat) ? false : getChecked('streamToggle')),
        temperature: parseFloat(getVal('temperature')) || 0.7,
        max_tokens: requestedTokens
    };

    // ★ MiniMax M3: thinking 和 token 控制（Anthropic 格式跳过，由格式自身处理）
    if (!_useAnthropicFormat && (modelLower.includes('m3') || modelLower.includes('minimax-m3'))) {
        var _tm = localStorage.getItem('thinkingMode') || 'adaptive';
        var _hasTools = body.tools && body.tools.length > 0;
        if (_hasTools || _tm === 'disabled') {
            body.thinking = { type: 'disabled' };
        } else {
            body.thinking = { type: 'adaptive' };
            body.reasoning_split = true;
        }
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
    }

    // MiniMax M2: 启用 reasoning_split 以分离思考内容
    const isMiniMaxModel = modelLower.includes('minimax');
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
    const i2iTool = IMAGE_I2I_TOOL_DEFINITION;

    // 构建工具列表
    const imageTools = [IMAGE_TOOL_DEFINITION, ANALYZE_IMAGE_TOOL];
    if (i2iTool) imageTools.push(i2iTool);
    imageTools.push(VIDEO_UNDERSTANDING_TOOL);
    imageTools.push(VIDEO_EDIT_TOOL);

    // 构建工具列表:根据搜索开关和工具模式动态选择
    const searchOn = getChecked('searchToggle');
    const toolMode = effectiveToolCall;
    if (toolMode) {
        // ★ 工具分类: A类(始终可用) | B类(Agent模式启用后额外可用) | C类(始终在列表中)
        var tools = [];

        // ===== A 类工具: 始终可用(无论是否 Agent 模式) =====
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
        // 文件读取/搜索(基础操作,不限制)
        tools.push(SERVER_FILE_READ_TOOL);
        tools.push(SERVER_FILE_SEARCH_TOOL);
        tools.push(SERVER_FILE_GREP_TOOL);
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
        tools.push(CHAOXING_EXAM_LIST_TOOL);
        tools.push(CHAOXING_EXAM_START_TOOL);
        tools.push(CHAOXING_EXAM_STATUS_TOOL);
        tools.push(CHAOXING_EXAM_STOP_TOOL);

        // ===== autonomous_mode: Agent/临时授权模式可用 =====
        if (_effectiveAgent) {
            tools.push(AUTONOMOUS_MODE_TOOL);
        }
        // ===== SRC/WIN 工具: 仅完整 Agent 模式可用 (临时授权不暴露Windows宿主工具) =====
        if (agentModeActive) {
            if (typeof SRC_TOOLS !== 'undefined') SRC_TOOLS.forEach(function(t) { tools.push(t); });
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
                'src_status': 'SRC_STATUS_TOOL',
                'src_dashboard': 'SRC_DASHBOARD_TOOL',
                'src_start': 'SRC_START_TOOL',
                'src_stop': 'SRC_STOP_TOOL',
                'src_get_config': 'SRC_GET_CONFIG_TOOL',
                'src_set_config': 'SRC_SET_CONFIG_TOOL',
                'src_get_logs': 'SRC_GET_LOGS_TOOL',
                'src_get_tasks': 'SRC_GET_TASKS_TOOL',
                'src_toggle_task': 'SRC_TOGGLE_TASK_TOOL',
                'src_check_upgrade': 'SRC_CHECK_UPGRADE_TOOL',
                'src_do_upgrade': 'SRC_DO_UPGRADE_TOOL',
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
                'cr_storage_info': 'CR_STORAGE_INFO_TOOL', 'cr_overview': 'CR_OVERVIEW_TOOL'
            };
            for (var _fti = 0; _fti < tools.length; _fti++) {
                var _ft = tools[_fti];
                var _ftName = _ft.function?.name || '';
                var _toggleKey = _toolFuncNameToToggleKey[_ftName];
                if (_toggleKey) {
                    if (window.isToolEnabled(_toggleKey)) {
                        // ★ Agent 模式关闭时,过滤掉 Agent 专属工具(除非有当前对话的临时授权 OR ask_agent 也在列表中)
                        var _agentOn = isAgentToolsActive() || (window._tempAgentGranted && window._tempAgentChatId === chatId);
                        // ★ ask_agent 存在时,提前放出核心 Agent 工具(避免授权后无工具可用)
                        var _hasAskAgent = tools.some(function(t) { return t.function?.name === 'ask_agent'; });
                        if (!_agentOn && AGENT_ONLY_KEYS.indexOf(_toggleKey) >= 0) {
                            if (_hasAskAgent) {
                                _filteredTools.push(_ft);  // ask_agent 同行 → 全部 Agent 工具放行
                            }
                            // 无 ask_agent → 过滤
                        } else {
                            _filteredTools.push(_ft);
                        }
                    }
                } else if (_ftName.startsWith('impl_') || _ftName.startsWith('custom_')) {
                    // 自定义技能: 用 CUSTOM_SKILL_ 前缀检查
                    if (window.isToolEnabled('CUSTOM_SKILL_' + _ftName)) {
                        _filteredTools.push(_ft);
                    }
                } else {
                    // 未知工具默认启用
                    _filteredTools.push(_ft);
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
            // ★ MiniMax M3: 限制工具数量避免 400
            if (modelLower.includes('m3') || modelLower.includes('minimax-m3')) {
                if (tools.length > 50) {
                    console.log('[M3] 工具数 ' + tools.length + ' > 50, 截断');
                    tools = tools.slice(0, 50);
                }
            }
            // ★ Anthropic 格式需要转换 tools
            if (_useAnthropicFormat) {
                body.tools = tools.map(function(t) {
                    return {
                        name: t.function.name,
                        description: t.function.description || '',
                        input_schema: t.function.parameters || { type: 'object', properties: {} }
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
        delete body.tool_choice;
        delete body.stream_options;
        body._anthropicUrl = getVal('baseUrl').replace(/\/v1$/, '') + '/anthropic/v1/messages';
        // ★ 预检清除空 tool_use_id 的 tool_result（防止 400）
        for (var _prei = 0; _prei < body.messages.length; _prei++) {
            var _prem = body.messages[_prei];
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
    var _hasCreatedSubAgent = false;

    // ★ Agent 模式: 思考深度处理 - 使用模型配置判断是否支持 reasoning_effort
    if (_effectiveAgent) {
        var _mcSupportsReasonEffort = _getModelCfg().supportsReasonEffort(modelName);
        var thinkingDepth = localStorage.getItem('agentThinkingDepth') || 'standard';
        if (thinkingDepth === 'deep' && _mcSupportsReasonEffort) {
            body.reasoning_effort = 'high';
        } else if (thinkingDepth === 'shallow' && _mcSupportsReasonEffort) {
            body.reasoning_effort = 'low';
        } else if (thinkingDepth === 'standard') {
            delete body.reasoning_effort;
        }
    }

    // ★ 模型配置:集中清理 body 中模型不支持的参数
    _getModelCfg().sanitizeBody(modelName, body);

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
    const timeout = _isImageModel ? 900000 : _timeoutSec * 1000;
    const timeoutId = setTimeout(() => abortMain.abort(), timeout);
    const startTime = Date.now();

    // 网络错误重试配置
    const maxRetries = 3;
    // Agent 模式使用自定义最大工具调用轮次
    var maxToolCalls = parseInt(localStorage.getItem('agentMaxToolRounds')) || 50;
    let toolCallCount = 0;

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
                            // 修复非法 JSON
                            raw = raw.replace(/[\x00-\x1f]/g, ' ');
                            var qc = (raw.match(/"/g) || []).length;
                            if (qc % 2 !== 0) raw += '"';
                            var ob = (raw.match(/\{/g) || []).length;
                            var cb = (raw.match(/\}/g) || []).length;
                            while (cb < ob) { raw += '}'; cb++; }
                            try { JSON.parse(raw); } catch(e2) {
                                // 彻底放弃,用空对象
                                raw = '{}';
                            }
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
                        _tc.function.arguments = '{}';
                    }
                }
            }
        }
    }

    /** 解析 Anthropic API 响应（支持流式 SSE + 非流式 JSON） */
    async function _parseAnthropicResponse(res, chatId, pendingMsg, currentBubble) {
        var _fullText = '';
        var _reasoningText = '';
        var _toolCalls = [];
        var _usage = null;

        // ★ 流式 SSE 解析
        var _contentType = res.headers.get('content-type') || '';
        if (_contentType.includes('text/event-stream') || _contentType.includes('stream')) {
            var _reader = res.body.getReader();
            var _decoder = new TextDecoder();
            var _buf = '';
            var _currentBlockIdx = -1;
            var _currentBlockType = '';
            var _toolUseIdx = -1;
            var _toolUseMap = {}; // index → {id, name, input_json}
            var _done = false;

            while (!_done) {
                var _rr = await _reader.read();
                if (_rr.done) break;
                _buf += _decoder.decode(_rr.value, {stream: true});
                var _lines = _buf.split('\n');
                _buf = _lines.pop() || '';

                var _event = '';
                for (var _li = 0; _li < _lines.length; _li++) {
                    var _ln = _lines[_li].trim();
                    if (!_ln) continue;
                    if (_ln.startsWith('event: ')) { _event = _ln.substring(7); continue; }
                    if (!_ln.startsWith('data: ')) continue;
                    var _js = _ln.substring(6);
                    try {
                        var _d = JSON.parse(_js);

                        if (_event === 'message_start' || !_event) {
                            if (_d.message && _d.message.usage) {
                                _usage = { prompt_tokens: _d.message.usage.input_tokens || 0, completion_tokens: 0, total_tokens: _d.message.usage.input_tokens || 0 };
                            }
                        } else if (_event === 'content_block_start') {
                            var _cb = _d.content_block;
                            if (_cb) {
                                _currentBlockIdx = _d.index;
                                _currentBlockType = _cb.type;
                                if (_cb.type === 'tool_use') {
                                    _toolUseIdx = _d.index;
                                    _toolUseMap[_d.index] = { id: _cb.id || ('toolu_' + Date.now() + '_' + _d.index), name: _cb.name, input_json: '' };
                                }
                            }
                        } else if (_event === 'content_block_delta') {
                            var _delta = _d.delta;
                            if (_delta) {
                                if (_delta.type === 'text_delta') {
                                    _fullText += _delta.text;
                                    pendingMsg.content = _fullText;
                                    if (currentChatId === chatId) applyStreamRender(chatId, _fullText);
                                } else if (_delta.type === 'thinking_delta') {
                                    _reasoningText += _delta.thinking;
                                    pendingMsg.reasoning = _reasoningText;
                                } else if (_delta.type === 'input_json_delta') {
                                    if (_toolUseIdx >= 0 && _toolUseMap[_toolUseIdx]) {
                                        _toolUseMap[_toolUseIdx].input_json += _delta.partial_json || '';
                                    }
                                }
                            }
                        } else if (_event === 'content_block_stop') {
                            if (_toolUseIdx >= 0 && _toolUseMap[_toolUseIdx]) {
                                var _tu = _toolUseMap[_toolUseIdx];
                                var _input = {};
                                try { _input = JSON.parse(_tu.input_json); } catch(e) {}
                                _toolCalls.push({ id: _tu.id, type: 'function', function: { name: _tu.name, arguments: JSON.stringify(_input) } });
                                _toolUseIdx = -1;
                            }
                        } else if (_event === 'message_delta') {
                            if (_d.delta && _d.delta.stop_reason) {
                                _done = true;
                            }
                            if (_d.usage) {
                                if (_usage) _usage.completion_tokens = _d.usage.output_tokens || 0;
                                else _usage = { prompt_tokens: 0, completion_tokens: _d.usage.output_tokens || 0, total_tokens: _d.usage.output_tokens || 0 };
                            }
                        } else if (_event === 'message_stop') {
                            _done = true;
                        } else if (_event === 'ping') {
                            // heartbeat, ignore
                        }
                        _event = '';
                    } catch(e) {}
                }
            }
            try { _reader.releaseLock(); } catch(e) {}
            return { fullText: _fullText, reasoningText: _reasoningText, usage: _usage, toolCalls: _toolCalls };
        }

        // ★ 非流式 JSON 解析
        try {
            var _data = await res.json();
            if (_data.usage) {
                _usage = { prompt_tokens: _data.usage.input_tokens || 0, completion_tokens: _data.usage.output_tokens || 0, total_tokens: (_data.usage.input_tokens || 0) + (_data.usage.output_tokens || 0) };
            }
            if (_data.content && Array.isArray(_data.content)) {
                for (var _ci = 0; _ci < _data.content.length; _ci++) {
                    var _block = _data.content[_ci];
                    if (_block.type === 'text') { _fullText += _block.text; }
                    else if (_block.type === 'thinking') { _reasoningText += _block.thinking; }
                    else if (_block.type === 'tool_use') {
                        _toolCalls.push({ id: _block.id || ('toolu_' + Date.now()), type: 'function', function: { name: _block.name, arguments: JSON.stringify(_block.input || {}) } });
                    }
                }
            }
            if (_fullText) { pendingMsg.content = _fullText; if (currentChatId === chatId) applyStreamRender(chatId, _fullText); }
            if (_reasoningText) { pendingMsg.reasoning = _reasoningText; }
        } catch(e) {
            throw new Error('Anthropic 响应解析失败: ' + e.message);
        }
        return { fullText: _fullText, reasoningText: _reasoningText, usage: _usage, toolCalls: _toolCalls };
    }

    async function attemptRequestWithFreshAbort(attempt, abortCtrl, timeoutIdVal) {
        try {
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
            var _reqUrl = _useAnthropicFormat ? (body._anthropicUrl || (getVal('baseUrl').replace(/\/v1$/, '') + '/anthropic/v1/messages')) : getVal('baseUrl') + '/chat/completions';
            if (_useAnthropicFormat) delete body._anthropicUrl;
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
                for (var _viFix = 0; _viFix < body.messages.length; _viFix++) {
                    var _mFix = body.messages[_viFix];
                    if (!_mFix.content && _mFix.content !== 0) {
                        console.warn('[FIX] messages[' + _viFix + '] missing content, role=' + _mFix.role);
                        _mFix.content = '(empty)';
                    }
                    if (_mFix.role === 'tool' && !_mFix.tool_call_id) {
                        // ★ 向前查找匹配的 tool_calls ID（不能用随机 fake ID）
                        for (var _tli2 = _viFix - 1; _tli2 >= 0; _tli2--) {
                            var _prevM = body.messages[_tli2];
                            if (_prevM.role === 'assistant' && _prevM.tool_calls) {
                                for (var _ttj = _prevM.tool_calls.length - 1; _ttj >= 0; _ttj--) {
                                    if (_prevM.tool_calls[_ttj].id) {
                                        _mFix.tool_call_id = _prevM.tool_calls[_ttj].id;
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

            // ★ 可恢复流式: 开关打开时走后端引擎
            // ★ 但工具调用的递归延续强制走直连，避免多层后端流式嵌套
            // ★ MiniMax 模型强制流式（非流式工具调用容易超时/中断）
            var useStream = _isImageModel ? false : (_useAnthropicFormat ? getChecked('streamToggle') : ((window.isProxyEnabled() && !modelLower.includes('minimax')) ? false : getChecked('streamToggle')));
            var _rsEnabled = (localStorage.getItem('__enableResumeStream') === '1');
            var _isContinuation = (toolCallCount > 0);
            var _useRS = _rsEnabled && !_isContinuation;
            if (_useRS) {
                // ★ WebSocket 模式：发送到后端网关，由网关管理 LLM 流
                var _rsResult = await window._wsSendChat(
                    body.messages,
                    { model: body.model, apiKey: getVal('apiKey'), baseUrl: getVal('baseUrl'),
                      temp: body.temperature, tokens: body.max_tokens, tools: body.tools },
                    chatId, pendingMsg
                );
                if (_rsResult && _rsResult.fullText === '__WS_PENDING__') {
                    // WebSocket 已发送，等待异步 token 通过 onmessage 渲染
                    clearTimeout(timeoutIdVal);
                    return;  // ★ 不继续走下面的 HTTP 流路径
                }
                // WebSocket 未连接：回退普通 HTTP 流
                _useRS = false;
            }

            if (!_useRS) {
            // ★ 图像模型: 显示生成进度 (生成图片可能需要 1-15 分钟)
            var _imgPlaceholder = null;
            var _imgTimerInterval = null;
            if (_isImageModel && currentBubble) {
                _imgPlaceholder = document.createElement('div');
                _imgPlaceholder.id = 'image-placeholder';
                _imgPlaceholder.style.cssText = 'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:12px;padding:40px 20px;text-align:center;margin:12px 0;color:white;animation:pulse 2s infinite;';
                _imgPlaceholder.innerHTML = '<div style="font-size:32px;margin-bottom:12px;">🎨</div><div style="font-size:18px;font-weight:600;">正在生成图片...</div><div id="img-gen-timer" style="font-size:13px;margin-top:8px;opacity:0.8;">已等待 0s</div><div style="font-size:11px;margin-top:8px;opacity:0.6;">图像生成最多需要 15 分钟</div>';
                currentBubble.querySelector('.markdown-body')?.appendChild(_imgPlaceholder);
                var _imgStart = Date.now();
                _imgTimerInterval = setInterval(function() {
                    var el = document.getElementById('img-gen-timer');
                    if (el) el.textContent = '已等待 ' + Math.floor((Date.now() - _imgStart) / 1000) + 's';
                }, 1000);
            }

            const _fetchFn = window.isProxyEnabled() ? window.proxyFetch : fetch;
            var _headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getVal('apiKey') };
            const res = await _fetchFn(_reqUrl, {
                method: 'POST',
                headers: _headers,
                body: JSON.stringify(body),
                signal: abortCtrl.signal
            });

            // ★ 图像模型: 不清除进度条, 等图片实际渲染后再清除
            clearTimeout(timeoutIdVal);
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

            const model = getVal('modelSelect') || '';
            const isMiniMax = model.toLowerCase().includes('minimax');

            // ★ Anthropic 格式响应处理
            if (_useAnthropicFormat) {
                try {
                    var _aResult = await _parseAnthropicResponse(res, chatId, pendingMsg, currentBubble);
                    usage = _aResult.usage;
                    toolCalls = _aResult.toolCalls || [];
                    if (_aResult.reasoningText && !pendingMsg.reasoning) pendingMsg.reasoning = _aResult.reasoningText;
                } catch(_aErr) {
                    throw _aErr;
                }
            } else if (useStream) {
                try {
                    const result = await streamResponse(res, chatId, pendingMsg, 3, 2);
                    usage = result.usage;
                    toolCalls = result.toolCalls || [];
                    // ★ 成本追踪: 累加 token 用量
                    if (usage) {
                        var _pt = usage.prompt_tokens || usage.input_tokens || 0;
                        var _ct = usage.completion_tokens || usage.output_tokens || 0;
                        sessionUsage.promptTokens += _pt;
                        sessionUsage.completionTokens += _ct;
                        sessionUsage.prefixCacheHits += usage.prompt_cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
                        // Feature 7: 增强缓存追踪
                        var _cHit = usage.prompt_cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
                        var _totalCache = (_pt || _ct);
                        if (_cHit > 0) {
                            sessionUsage.cacheHitTokens += _cHit;
                            sessionUsage.cacheMissTokens += (_totalCache > _cHit) ? (_totalCache - _cHit) : 0;
                        }
                        // 估算费用 (基于 DeepSeek V4 定价: $0.5/M input, $2/M output)
                        var pt = _pt / 1000000;
                        var ct = _ct / 1000000;
                        sessionUsage.totalCost += pt * 0.5 + ct * 2;
                    }
                    // ★ 确保 reasoning 从结果同步到 pendingMsg(流式期间可能未完全同步)
                    if (result.reasoningText && !pendingMsg.reasoning) {
                        pendingMsg.reasoning = result.reasoningText;
                    }
                } catch (streamErr) {
                    // ★ HTTP2/网络错误降级: 非流式重试一次
                    const isStreamNetErr = streamErr.name === 'TypeError' ||
                        (streamErr.message && (streamErr.message.includes('fetch') || streamErr.message.includes('net::') || streamErr.message.includes('ERR_') || streamErr.message.includes('network')));
                    if (isStreamNetErr) {
                        console.warn('[STREAM] 流式读取失败,尝试非流式降级:', streamErr.message);
                        showToast('流式中断,切换非流式重试...', 'warning', 2000);
                        // 重新构造非流式请求体(清除stream标记)
                        var _nsBody = JSON.parse(JSON.stringify(body));
                        if (_nsBody.stream !== undefined) _nsBody.stream = false;
                        const _nsFetchFn = window.isProxyEnabled() ? window.proxyFetch : fetch;
                        const _nsRes = await _nsFetchFn(_reqUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getVal('apiKey')}` },
                            body: JSON.stringify(_nsBody),
                            signal: abortCtrl.signal
                        });
                        clearTimeout(timeoutIdVal);
                        if (!_nsRes.ok) throw new Error(`HTTP ${_nsRes.status}: ${await _nsRes.text()}`);
                        const _nsResult = await handleNonStream(_nsRes, chatId, pendingMsg, currentBubble);
                        usage = _nsResult.usage;
                        if (usage) {
                            var _pt2 = usage.prompt_tokens || usage.input_tokens || 0;
                            var _ct2 = usage.completion_tokens || usage.output_tokens || 0;
                            sessionUsage.promptTokens += _pt2;
                            sessionUsage.completionTokens += _ct2;
                            sessionUsage.prefixCacheHits += usage.prompt_cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
                            var _cHit2 = usage.prompt_cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
                            if (_cHit2 > 0) {
                                sessionUsage.cacheHitTokens += _cHit2;
                                sessionUsage.cacheMissTokens += (_pt2 + _ct2 > _cHit2) ? (_pt2 + _ct2 - _cHit2) : 0;
                            }
                            var pt2 = _pt2 / 1000000;
                            var ct2 = _ct2 / 1000000;
                            sessionUsage.totalCost += pt2 * 0.5 + ct2 * 2;
                        }
                        toolCalls = _nsResult.toolCalls || [];
                        if (_nsResult.generatedImages && _nsResult.generatedImages.length > 0) {
                            if (!pendingMsg.generatedImages) pendingMsg.generatedImages = [];
                            for (var _gii2 = 0; _gii2 < _nsResult.generatedImages.length; _gii2++) {
                                if (pendingMsg.generatedImages.indexOf(_nsResult.generatedImages[_gii2]) === -1) {
                                    pendingMsg.generatedImages.push(_nsResult.generatedImages[_gii2]);
                                    if (_gii2 === 0 && !pendingMsg.generatedImage) pendingMsg.generatedImage = _nsResult.generatedImages[_gii2];
                                    // ★ 上传到服务器,确保刷新后图片不消失
                                    var _imgSf = _nsResult.generatedImages[_gii2];
                                    if (_imgSf && !_imgSf.startsWith(window.location.origin) && !_imgSf.startsWith('/oneapichat')) {
                                        (function(_origSf, _sfIdx) {
                                            uploadImageToServer(_origSf).then(function(srvUrl) {
                                                if (srvUrl) {
                                                    var _pSf = pendingMsg.generatedImages.indexOf(_origSf);
                                                    if (_pSf !== -1) pendingMsg.generatedImages[_pSf] = srvUrl;
                                                    if (pendingMsg.generatedImage === _origSf) pendingMsg.generatedImage = srvUrl;
                                                    var _cSf = chats[chatId] && chats[chatId].messages ? chats[chatId].messages.findIndex(function(m) { return m === pendingMsg; }) : -1;
                                                    if (_cSf !== -1) {
                                                        var _cmSf = chats[chatId].messages[_cSf];
                                                        if (_cmSf.generatedImages && _cmSf.generatedImages[_sfIdx] === _origSf) _cmSf.generatedImages[_sfIdx] = srvUrl;
                                                        if (_cmSf.generatedImage === _origSf) _cmSf.generatedImage = srvUrl;
                                                    }
                                                }
                                            }).catch(function(e) {
                                                console.warn('[ImageModel] 上传流式降级图片失败:', e.message);
                                            });
                                        })(_imgSf, _gii2);
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
                    console.error('[sendMessage] handleNonStream crashed:', _hnsErr.message, _hnsErr.stack);
                    // 兜底: 保证气泡至少可见,如果有提取到的图片也可以渲染
                    result = { fullText: '', reasoningText: '', usage: null, toolCalls: [], generatedImages: pendingMsg.generatedImages || [] };
                    // ★ 确保 pendingMsg 有基本内容,防止刷新后消息消失
                    if (!pendingMsg.content) pendingMsg.content = '(图片生成中发生内部错误,但图片已保存)';
                    if (currentBubble) {
                        currentBubble.classList.remove('typing', 'gen-active');
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
                usage = result.usage;
                if (usage) {
                    var _pt3 = usage.prompt_tokens || usage.input_tokens || 0;
                    var _ct3 = usage.completion_tokens || usage.output_tokens || 0;
                    sessionUsage.promptTokens += _pt3;
                    sessionUsage.completionTokens += _ct3;
                    sessionUsage.prefixCacheHits += usage.prompt_cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
                    var _cHit3 = usage.prompt_cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
                    if (_cHit3 > 0) {
                        sessionUsage.cacheHitTokens += _cHit3;
                        sessionUsage.cacheMissTokens += (_pt3 + _ct3 > _cHit3) ? (_pt3 + _ct3 - _cHit3) : 0;
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
                            // ★ 去重: handleNonStream 内部可能已渲染,避免重复
                            if (pendingMsg.generatedImages.indexOf(_imgData) === -1) {
                                pendingMsg.generatedImages.push(_imgData);
                                if (_idx === 0 && !pendingMsg.generatedImage) pendingMsg.generatedImage = _imgData;
                                // ★ 上传到服务器,确保刷新后图片不消失 (与 tool call 路径行为一致)
                                if (_imgData && !_imgData.startsWith(window.location.origin) && !_imgData.startsWith('/oneapichat')) {
                                    (function(_origUrl, _di) {
                                        uploadImageToServer(_origUrl).then(function(srvUrl) {
                                            if (srvUrl) {
                                                var _posDi = pendingMsg.generatedImages.indexOf(_origUrl);
                                                if (_posDi !== -1) pendingMsg.generatedImages[_posDi] = srvUrl;
                                                if (pendingMsg.generatedImage === _origUrl) pendingMsg.generatedImage = srvUrl;
                                                // ★ 同步到 chats
                                                var _cmi = chats[chatId] && chats[chatId].messages ? chats[chatId].messages.findIndex(function(m) { return m === pendingMsg; }) : -1;
                                                if (_cmi !== -1) {
                                                    var _cmsg = chats[chatId].messages[_cmi];
                                                    if (_cmsg.generatedImages && _cmsg.generatedImages[_di] === _origUrl) _cmsg.generatedImages[_di] = srvUrl;
                                                    if (_cmsg.generatedImage === _origUrl) _cmsg.generatedImage = srvUrl;
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
                const validToolCalls = toolCalls.filter(tc => tc && tc.function && tc.function.name && (typeof tc.function.arguments === 'object' || (typeof tc.function.arguments === 'string' && tc.function.arguments.length > 2)));
                const normalizedToolCalls = validToolCalls.map(tc => {
                    var argStr = typeof tc.function.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function.arguments || {});
                    // ★ 修复: 确保 arguments 是合法 JSON 字符串(和 executeToolCallForRetry 相同的修复)
                    var qc = (argStr.match(/"/g) || []).length;
                    if (qc % 2 !== 0) argStr += '"';
                    var ob = (argStr.match(/\{/g) || []).length;
                    var cb = (argStr.match(/\}/g) || []).length;
                    while (cb < ob) { argStr += '}'; cb++; }
                    // 清理非法控制字符和未转义换行
                    argStr = argStr.replace(/[\x00-\x1f]/g, ' ').replace(/\n(?![^"\\]*(?:\\.[^"\\]*)*")/g, '\\n');
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

                    return {
                        id: tcId,
                        type: 'function',
                        function: {
                            name: tc.function.name,
                            arguments: argStr
                        }
                    };
                });
                const assistantMsg = {
                    role: 'assistant',
                    content: (typeof pendingMsg.content === 'string' && pendingMsg.content.trim())
                        ? pendingMsg.content
                        : (pendingMsg.reasoning || ' '),
                    tool_calls: normalizedToolCalls
                };
                if (pendingMsg.reasoning && typeof pendingMsg.reasoning === 'string') {
                    assistantMsg.reasoning_content = pendingMsg.reasoning;
                }
                // MiniMax reasoning_split:回传reasoning_details
                if (pendingMsg._reasoningDetails && Array.isArray(pendingMsg._reasoningDetails)) {
                    assistantMsg.reasoning_details = pendingMsg._reasoningDetails;
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

// 执行每个工具调用并添加结果(只对有有效内容的tool call执行)
                var _allWebFetchUrls = [];
                for (const tc of normalizedToolCalls) {
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
                        if (typeof showToolStatus === 'function') showToolStatus(tc.function?.name || '...', '', 'aborted');
                        body.messages.push({
                            role: 'tool',
                            tool_call_id: tc.id || '',
                            content: '[用户已中断操作]'
                        });
                        continue;
                    }

                    if (typeof showToolStatus === 'function') showToolStatus(tc.function?.name || '...', _argPreview, 'running');

                    // ★ 传递工具调用的 abort 信号,让 fetch 也能被中断
                    var _toolAbortCtrl = new AbortController();
                    var _toolAbortKey = chatId + '_tool_' + Date.now();
                    window.__toolAbortControllers = window.__toolAbortControllers || {};
                    window.__toolAbortControllers[_toolAbortKey] = _toolAbortCtrl;
                    
                    // 如果用户中止,同时 abort 工具请求
                    if (userAbortMap[chatId]) {
                        _toolAbortCtrl.abort();
                    }
                    
                    const toolResult = await executeToolCallForRetry(tc, _toolAbortCtrl.signal);
                    
                    // 清理控制器
                    delete window.__toolAbortControllers[_toolAbortKey];
                    if (typeof showToolStatus === 'function') showToolStatus(tc.function?.name || '...', '', toolResult.error ? 'error' : 'success');
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
                    const resultContent = toolResult.error || toolResult.result || '(empty)';

                    // 确保content是字符串
                    var contentStr = typeof resultContent === 'string'
                        ? resultContent
                        : (resultContent ? JSON.stringify(resultContent) : '(empty)');

                    body.messages.push({
                        role: 'tool',
                        tool_call_id: tc.id || '',
                        content: contentStr
                    });

                    // 更新UI
                    if (currentChatId === chatId) {
                        const currentBubble = activeBubbleMap[chatId];
                        if (currentBubble) {
                            let status = currentBubble.querySelector('.search-status');
                            if (status) {
                                if (tc.function.name === 'web_search') {
                                    status.textContent = `✅ 搜索完成: ${resultContent.substring(0, 100)}...`;
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
                            }
                            // 如果生成了图片,确保存入消息对象
                            if ((tc.function.name === 'generate_image' || tc.function.name === 'generate_image_i2i') && (pendingMsg.generatedImage || pendingMsg.generatedImages)) {
                                const msgIdx = chats[chatId].messages.findIndex(m => m === pendingMsg);
                                if (msgIdx !== -1) {
                                    if (pendingMsg.generatedImage) chats[chatId].messages[msgIdx].generatedImage = pendingMsg.generatedImage;
                                    if (pendingMsg.generatedImages) chats[chatId].messages[msgIdx].generatedImages = pendingMsg.generatedImages;
                                }
                            }
                        }
                    }
                }

                // ★ 工具执行循环结束,隐藏状态浮条
                if (typeof showToolStatus === 'function') showToolStatus(null, null, null);
                // ★ 保存 web_fetch 访问的 URL 列表到 pendingMsg
                if (_allWebFetchUrls.length > 0) {
                    pendingMsg._webFetchUrls = _allWebFetchUrls;
                }

                // ★ Agent 模式下:创建子代理后引导模型自主总结,自然结束本轮
                if (_hasCreatedSubAgent) {
                    if (!validToolCalls || !Array.isArray(validToolCalls)) {
                        console.log('[Agent] 已创建子代理,跳过等待逻辑');
                    } else {
                    var onlyCreatedSubAgents = validToolCalls.every(function(tc) {
                        return tc.function && (tc.function.name === 'delegate_task' || tc.function.name === 'engine_agent_create');
                    });
                    if (onlyCreatedSubAgents) {
                        // 本轮只创建了子代理,允许模型继续规划(可能还要创建更多)
                        console.log('[Agent] 本轮只创建了子代理(' + validToolCalls.length + '个),允许继续');
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
                        streamingScrollLock = false;
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

                // ★ 重置前先杀死旧的 AbortController
                try { abortMain.abort(); } catch(e) {}
                const newAbortCtrl = new AbortController();
                abortControllerMap[chatId] = newAbortCtrl;
                clearTimeout(timeoutId);
                const newTimeoutVal = _isImageModel ? 900000 : parseInt(getVal('requestTimeout')) * 1000;
                const newTimeoutId = setTimeout(() => newAbortCtrl.abort(), newTimeoutVal);

                // 继续循环获取下一个响应
                return attemptRequestWithFreshAbort(attempt, newAbortCtrl, newTimeoutId);
            }

            // 无工具调用,正常完成
            delete pendingMsg.partial;
            // ★ 流结束释放滚动锁定
            streamingScrollLock = false;
            // ★ 清除保存的 partial 标记(已完成,刷新不会丢失)
            try { localStorage.removeItem('_savedPartial'); } catch(e) {}
            // ★ 清除流式保存定时器
            if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
            pendingMsg.time = Date.now() - startTime;
            pendingMsg.usage = usage;
            saveChats();  // 立即保存,不用 debounce
            // ★ 修复: 不使用 loadChat(全量重渲染),仅更新现有气泡内容
            if (currentChatId === chatId) {
                var _bubble = activeBubbleMap[chatId];
                console.log('[ImageModel] completion: chatId match=', (currentChatId === chatId), 'bubble exists=', !!_bubble, 'hasImages=', !!(pendingMsg.generatedImages && pendingMsg.generatedImages.length > 0));
                if (_bubble) {
                    var _md = _bubble.querySelector('.markdown-body');
                    if (_md && pendingMsg.content) {
                        _md.innerHTML = _renderMarkdownWithMath(pendingMsg.content);
                        _triggerPostRender(_md);
                        _bubble.classList.remove('typing');
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
                    // ★ 渲染 web_fetch 访问的链接列表
                    if (pendingMsg._webFetchUrls && pendingMsg._webFetchUrls.length > 0) {
                        _renderWebFetchUrls(_bubble, pendingMsg._webFetchUrls);
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
            saveChats();
            const defaultTitle = text ? text.slice(0, 10) : (files.length ? '文件消息' : '新对话');
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
            const isUserAbort = userAbortMap[chatId];  // 检查是否用户主动停止
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
                // 清理 pendingMsg
                if (pendingMsg) {
                    pendingMsg.content = '';
                    pendingMsg.reasoning = '';
                }
                showToast('⚠️ 模型不支持工具调用,已切换为普通问答模式', 'warning', 4000);
                try { abortMain.abort(); } catch(e) {}
                var _downgradeCtrl = new AbortController();
                abortControllerMap[chatId] = _downgradeCtrl;
                clearTimeout(timeoutId);
                var _downgradeTimeout = parseInt(getVal('requestTimeout')) * 1000;
                var _downgradeTimer = setTimeout(function() { _downgradeCtrl.abort(); }, _downgradeTimeout);
                return attemptRequestWithFreshAbort(attempt, _downgradeCtrl, _downgradeTimer);
            }

            // ★ 智能调整 max_tokens: 从 API 错误信息中提取有效范围并自动修正
            const maxTokensMatch = e.message?.match(/max_tokens.*?\[(\d+),\s*(\d+)\]/);
            if (maxTokensMatch) {
                const maxVal = parseInt(maxTokensMatch[2]);
                const curMaxTokens = parseInt(getVal('maxTokens')) || 4096;
                if (curMaxTokens > maxVal) {
                    console.warn('[AutoAdjust] max_tokens ' + curMaxTokens + ' -> ' + maxVal);
                    const m = getVal('modelSelect') || '';
                    modelMaxOutputTokens[m] = maxVal;
                    localStorage.setItem('modelMaxOutputTokens', JSON.stringify(modelMaxOutputTokens));
                    setVal('maxTokens', maxVal);
                    setVal('maxTokensInput', maxVal);
                    body.max_tokens = maxVal;
                    showToast('max_tokens 自动调整为 ' + maxVal, 'warning', 3000);
                    try { abortMain.abort(); } catch(e) {}
                    const retryCtrl = new AbortController();
                    abortControllerMap[chatId] = retryCtrl;
                    clearTimeout(timeoutId);
                    const retryTimeoutId = setTimeout(function() { retryCtrl.abort(); }, parseInt(getVal('requestTimeout')) * 1000);
                    return attemptRequestWithFreshAbort(attempt, retryCtrl, retryTimeoutId);
                }
            }

            const isUpstreamError = e.message === 'UPSTREAM_ERROR' || e.message.includes('upstream') || e.message.includes('bad response');
            const isHTTP2Error = (e.name === 'TypeError' && (e.message.includes('fetch') || e.message.includes('Failed to') || e.message.includes('net::') || e.message.includes('ERR_')))
                || e.message.includes('HTTP2') || e.message.includes('h2') || e.message.includes('protocol error') || e.message.includes('protocol_error');
            const isNetError = e.name === 'AbortError' || e.message.includes('timeout') || e.message.includes('aborted') || isUpstreamError || isHTTP2Error;

            // ★ 400/404 错误智能重试: 解析错误原因，尝试修复后重试
            const is400Error = e.message && (e.message.startsWith('HTTP 400') || e.message.includes('HTTP 400:') || e.message.startsWith('HTTP 404') || e.message.includes('HTTP 404:'));
            if (is400Error && attempt < maxRetries) {
                var _errBody = '';
                var _errJson = null;
                try {
                    _errBody = e.message.replace(/^HTTP 40[04]:\s*/, '');
                    _errJson = JSON.parse(_errBody);
                } catch(_parseErr) { /* ignore parse errors */ }

                var _errMsg = (_errJson && (_errJson.error && _errJson.error.message || _errJson.message)) || _errBody || '';
                var _errType = (_errJson && _errJson.error && _errJson.error.type) || '';
                var _shouldRetry = false;
                var _retryAction = '';

                // ★ 持久化 400 错误详情到气泡，便于用户查看
                if (_errMsg && pendingMsg && currentBubble) {
                    var _errDetail = '🔴 **HTTP ' + (e.message.includes('404') ? '404' : '400') + ' 错误**\n```\n' + _errMsg.substring(0, 500) + '\n```';
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
                var _maxTokensLimit = _errMsg.match(/max tokens\s*[>≥]\s*(\d+)/i) || _errMsg.match(/max_tokens.*?(\d{4,})/i);
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
                } else if (_errMsg.includes('invalid function arguments json string') || _errMsg.includes('tool result') && _errMsg.includes('not found')) {
                    // ★ 单个工具调用的 JSON 破损 → 修复或丢弃该工具调用（不删全部 tools）
                    _shouldRetry = true;
                    _retryAction = 'fix_tool_args';
                } else if (_errMsg.includes('tool') && (_errMsg.includes('not support') || _errMsg.includes('disabled') || _errMsg.includes('No endpoints found'))) {
                    // 模型完全不支持工具 → 移除全部 tools
                    _shouldRetry = true;
                    _retryAction = 'remove_tools';
                } else if (_errMsg.includes('parameter') || _errType === 'invalid_request_error') {
                    // 通用参数错误 → 尝试清理 body 重试
                    _shouldRetry = true;
                    _retryAction = 'clean_params';
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
                        for (var _tmi = 0; _tmi < body.messages.length; _tmi++) {
                            var _tmsg = body.messages[_tmi];
                            if (_tmsg.role === 'assistant' && _tmsg.tool_calls) {
                                for (var _tcj = 0; _tcj < _tmsg.tool_calls.length; _tcj++) {
                                    var _tcall = _tmsg.tool_calls[_tcj];
                                    if (_tcall.function && typeof _tcall.function.arguments === 'string') {
                                        try { JSON.parse(_tcall.function.arguments); } catch(e) {
                                            // 尝试修复截断的 JSON
                                            var _raw2 = _tcall.function.arguments;
                                            _raw2 = _raw2.replace(/[\x00-\x1f]/g, ' ');
                                            var _qc = (_raw2.match(/"/g) || []).length;
                                            if (_qc % 2 !== 0) _raw2 += '"';
                                            var _ob = (_raw2.match(/\{/g) || []).length;
                                            var _cb = (_raw2.match(/\}/g) || []).length;
                                            while (_cb < _ob) { _raw2 += '}'; _cb++; }
                                            try {
                                                JSON.parse(_raw2);
                                                _tcall.function.arguments = _raw2;
                                                _fixed = true;
                                                console.log('[fix_tool_args] 修复 tool_call arguments:', _tcall.function.name);
                                            } catch(e2) {
                                                // 无法修复 → 删除这个 tool_call
                                                _tmsg.tool_calls.splice(_tcj, 1);
                                                _tcj--;
                                                _fixed = true;
                                                console.log('[fix_tool_args] 丢弃破损 tool_call:', _tcall.function.name);
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
                        // ★ 清理孤立的 tool 消息（OpenAI 格式）
                        if (_fixed) {
                            body.messages = body.messages.filter(function(m) {
                                return m.role !== 'tool';
                            });
                        }
                        showToast('⚠️ 工具调用参数异常，已自动修复后重试...', 'warning', 8000);
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
                    var _retryTimeout400 = setTimeout(function() { _retryCtrl400.abort(); }, parseInt(getVal('requestTimeout')) * 1000);
                    return attemptRequestWithFreshAbort(attempt + 1, _retryCtrl400, _retryTimeout400);
                }
            }

            if (isNetError && attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
                showToast(`网络超时,${attempt + 1}/${maxRetries},${(delay/1000).toFixed(0)}s后重试...`, 'warning', 3000);
                await new Promise(r => setTimeout(r, delay));
                // ★ 重试前先杀死旧请求,避免新旧请求并发
                try { abortCtrl.abort(); } catch(e) {}
                const newAbortCtrl = new AbortController();
                abortControllerMap[chatId] = newAbortCtrl;
                clearTimeout(timeoutIdVal);
                const newTimeoutVal = parseInt(getVal('requestTimeout')) * 1000;
                const newTimeoutId = setTimeout(() => newAbortCtrl.abort(), newTimeoutVal);
                return attemptRequestWithFreshAbort(attempt + 1, newAbortCtrl, newTimeoutId);
            }
            throw e;
        }
    }

    try {
        await attemptRequestWithFreshAbort(0, abortMain, timeoutId);
    } catch (e) {
        // ★ 智能错误恢复: image_url 格式错误 → 自动切换为分析工具模式重试
        if (e.message && (e.message.includes('unknown variant') || e.message.includes('image_url'))) {
            const retried = await autoDetectAndRetryImageUrlError(e.message, chatId, pendingMsg, currentBubble);
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
                currentBubble.classList.remove('typing', 'gen-active');
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
                    currentBubble.classList.remove('typing', 'gen-active');
                    var _mb402 = currentBubble.querySelector('.markdown-body');
                    if (_mb402) _mb402.innerHTML = '';
                }
                showToast('余额不足，已自动降低 max_tokens 至 ' + _reduced402 + '，重试中...', 'warning', 3000);
                try { abortMain.abort(); } catch(_e402) {}
                var _retryCtrl402 = new AbortController();
                abortControllerMap[chatId] = _retryCtrl402;
                var _retryTimeout402 = setTimeout(function() { _retryCtrl402.abort(); }, parseInt(getVal('requestTimeout')) * 1000);
                try {
                    await attemptRequestWithFreshAbort(0, _retryCtrl402, _retryTimeout402);
                } catch(_retryErr402) {
                    handleError(_retryErr402, chatId, pendingMsg, currentBubble);
                }
                return;
            }
        }
        handleError(e, chatId, pendingMsg, currentBubble);
    } finally {
        // 清理临时消息(保留子代理通知)
        chats[chatId].messages = chats[chatId].messages.filter(m => !m.temporary || m._agentNotification);
        delete isTypingMap[chatId];
        // ★ agent模式:AI生成结束,关闭队列轮询 + 处理下一条
        // AI生成结束:处理队列下一条消息
        if (window._queuePollTimer) {
            clearInterval(window._queuePollTimer);
            window._queuePollTimer = null;
        }
        setTimeout(function() { window._drainQueue(); }, 300);
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
        if (currentChatId === chatId) loadChat(chatId);
        // ★ 计划面板兜底：回复结束时，将仍为 running 的任务标记为 failed
        if (window._agentPlan && window._agentPlan.tasks && window._agentPlan.status === 'running') {
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
        // ★ AI 自主记忆: 对话结束后自动提取重要信息
        if (!window.__autoMemoryPending) {
            window.__autoMemoryPending = true;
            setTimeout(function() {
                window._autoSaveMemoriesFromChat(chatId);
                window.__autoMemoryPending = false;
            }, 2000);
        }
        if (Object.keys(isTypingMap).length === 0) localStorage.removeItem('ongoingChats');
        else saveOngoingChatsSnapshot();
    }
};

