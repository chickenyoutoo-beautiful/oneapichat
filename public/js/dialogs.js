// dialogs.js — 对话管理 v1.0 (Phase 3 拆分自 main.js)
// 聊天CRUD / 标题生成 / 上下文压缩 / 历史渲染

// ==================== 对话管理 ====================
function saveOngoingChatsSnapshot() {
    localStorage.setItem('ongoingChats', JSON.stringify(Object.keys(isTypingMap).filter(id => isTypingMap[id])));
}

async function restoreOngoingChats() {
    var ongoing = JSON.parse(localStorage.getItem('ongoingChats') || '[]');
    for (const id of ongoing) {
        if (chats[id]) {
            var lastUser = [...chats[id].messages].reverse().find(m => m.role === 'user');
            if (lastUser) await sendMessage(true, lastUser.text, lastUser.files);
        }
    }
    localStorage.removeItem('ongoingChats');
}

/** 获取当前模型的 context 长度 */
function getModelContextLength(modelName) {
    if (!modelName) modelName = getVal('modelSelect') || DEFAULT_CONFIG.model;
    var key = modelName.toLowerCase().trim();
    var fromLocal = modelContextLength[key];
    if (fromLocal && !isNaN(fromLocal)) return parseInt(fromLocal);
    // 尝试从 models.js / MODEL_CONFIGS 获取
    if (window.MODEL_CONFIGS && typeof window.MODEL_CONFIGS.getContext === 'function') {
        try {
            var ctx = window.MODEL_CONFIGS.getContext(modelName);
            if (ctx && !isNaN(ctx)) return parseInt(ctx);
        } catch(e) {}
    }
    // 默认 128K
    return 131072;
}

/** 估算消息 token 数 (粗略,7bit/char) */
function estimateTokenCount(text) {
    if (!text) return 0;
    // 英文 ~1 token/4 chars, 中文 ~1 token/2 chars
    var en = (text.match(/[a-zA-Z0-9\s.,!?;:'"()\[\]{}\/\\@#$%^&*+=<>~`\-|_]/g) || []).length;
    var cn = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
    return Math.ceil(en / 4) + Math.ceil(cn / 1.5);
}

/** 计算消息数组的总 token 估算 */
function estimateMessagesTokenCount(msgs) {
    if (!msgs || !msgs.length) return 0;
    var total = 0;
    for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        total += estimateTokenCount(m.content || m.text || '');
        // 角色标记开销
        total += 4;
        // system message 额外开销
        if (m.role === 'system') total += 16;
    }
    // 格式开销 (role + metadata 等)
    total += msgs.length * 8;
    return total;
}

/**
 * 智能选择压缩模型
 * 如果当前模型 context >= 128K, 用模型自身压缩
 * 否则使用 deepseek-chat
 */
function selectCompressModel() {
    var currentModel = getVal('modelSelect') || DEFAULT_CONFIG.model;
    var ctxLen = getModelContextLength(currentModel);
    if (ctxLen >= 131072) {
        return currentModel;
    }
    return 'deepseek-chat';
}

/**
 * 显示/隐藏压缩进度 SVG spinner
 */
function showCompressSpinner() {
    var el = document.getElementById('compressSpinner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'compressSpinner';
        el.className = 'compress-spinner';
        var container = $.chatMessagesContainer || document.getElementById('chatMessagesContainer');
        if (container) {
            container.appendChild(el);
        }
    }
    el.innerHTML = '<div class="compress-spinner-inner">' +
        '<svg class="compress-spinner-svg" viewBox="0 0 50 50" width="24" height="24">' +
        '<circle cx="25" cy="25" r="20" fill="none" stroke="#e5e7eb" stroke-width="4"/>' +
        '<circle cx="25" cy="25" r="20" fill="none" stroke="#6366f1" stroke-width="4" stroke-dasharray="90 150" stroke-linecap="round">' +
        '<animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="0.8s" repeatCount="indefinite"/>' +
        '</circle></svg>' +
        '<span>压缩上下文中...</span></div>';
    el.style.display = '';
}

function hideCompressSpinner() {
    var el = document.getElementById('compressSpinner');
    if (el) el.style.display = 'none';
}

/**
 * ★ 智能上下文压缩 (替换旧版):
 * 1. 检测是否达到 context 80%
 * 2. 自动选择压缩模型
 * 3. 保留 system prompt + 第一条用户消息 + 最近 N 条消息
 * 4. 显示 SVG spinner
 */
async function compressContextIfNeeded(chatId) {
    if (chats[chatId]?._compressFailed) return;
    if (!getChecked('compressToggle')) return;

    var msgs = chats[chatId].messages;
    var currentModel = getVal('modelSelect') || DEFAULT_CONFIG.model;
    var contextLimit = getModelContextLength(currentModel);
    var estimatedTokens = estimateMessagesTokenCount(msgs);
    var thresholdPct = parseInt(getVal('compressThreshold')) || 10;

    // 检测是否达到 context 的 80%
    var limit80 = Math.floor(contextLimit * 0.8);
    if (estimatedTokens < limit80) {
        // 还没到 80%, 按原消息数量阈值检查
        var sysMessages = msgs.filter(function(m) { return m.role === 'system' && !m.temporary; });
        var partial = msgs.filter(function(m) { return m.partial; });
        var nonPartial = msgs.filter(function(m) { return m.role !== 'system' && !m.partial && !m.temporary; });
        if (nonPartial.length <= thresholdPct) return;
    }

    showCompressSpinner();

    try {
        var sysMessages = msgs.filter(function(m) { return m.role === 'system' && !m.temporary; });
        var partial = msgs.filter(function(m) { return m.partial; });
        var nonPartial = msgs.filter(function(m) { return m.role !== 'system' && !m.partial && !m.temporary; });

        if (nonPartial.length <= thresholdPct && estimatedTokens < limit80) {
            hideCompressSpinner();
            return;
        }

        // ★ 智能压缩策略:
        // 保留: system prompt + 第一条用户消息 + 最近 N 条消息
        var firstUserIndex = -1;
        for (var i = 0; i < nonPartial.length; i++) {
            if (nonPartial[i].role === 'user') {
                firstUserIndex = i;
                break;
            }
        }

        var keep = Math.max(4, Math.floor(thresholdPct / 2));
        var toSummarize = [];
        var toKeepNonPartial = [];

        if (firstUserIndex >= 0) {
            // 保留第一条用户消息
            toKeepNonPartial.push(nonPartial[firstUserIndex]);
            // 保留最近 keep 条
            var recentStart = Math.max(firstUserIndex + 1, nonPartial.length - keep);
            for (var j = recentStart; j < nonPartial.length; j++) {
                toKeepNonPartial.push(nonPartial[j]);
            }
            // 中间的摘录
            for (var k = firstUserIndex + 1; k < recentStart; k++) {
                toSummarize.push(nonPartial[k]);
            }
        } else {
            // 没有用户消息,保留最近 keep 条
            toKeepNonPartial = nonPartial.slice(-keep);
            toSummarize = nonPartial.slice(0, nonPartial.length - keep);
        }

        if (toSummarize.length === 0 && estimatedTokens < limit80) {
            hideCompressSpinner();
            return;
        }

        // 构建摘要
        let conv = ''
        for (var si = 0; si < toSummarize.length; si++) {
            var m = toSummarize[si];
            if (m.role === 'user') {
                conv += '用户: ' + (m.text || m.content || '').substring(0, 2000) + '\n';
            } else {
                conv += '助手: ' + (m.content || '').substring(0, 2000) + '\n';
            }
        }

        var compressPrompt = '总结以下对话的核心内容,保留关键信息和你作为助手的推理结论:\n' + conv

        // ★ 自动选择压缩模型
        var compressModel = selectCompressModel();

        var compressBody = {
            model: compressModel,
            messages: [{ role: 'user', content: compressPrompt }],
            temperature: 0.3,
            max_tokens: 800
        };
        compressBody.extra_body = { thinking: { type: 'disabled' } };

        var res = await fetch(getVal('baseUrl') + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + getVal('apiKey')
            },
            body: JSON.stringify(compressBody)
        });
        var data = await res.json();
        var summary = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '';

        if (!summary) {
            hideCompressSpinner();
            if (chats[chatId]) chats[chatId]._compressFailed = true;
            return;
        }

        var summaryMsg = { role: 'system', content: '[智能摘要] ' + summary, temporary: true }
        var newMessages = sysMessages.concat([summaryMsg]).concat(toKeepNonPartial).concat(partial);
        chats[chatId].messages = newMessages;
        saveChats();
        if (currentChatId === chatId) loadChat(chatId);

        showToast('\u2705 \u5df2\u538b\u7f29\u4e0a\u4e0b\u6587 (\u4f7f\u7528 ' + compressModel + ')', 'success', 3000);
    } catch (e) {
        console.warn('[compressContext] \u538b\u7f29\u5931\u8d25:', e.message);
        if (chats[chatId]) chats[chatId]._compressFailed = true;
        showToast('\u4e0a\u4e0b\u6587\u538b\u7f29\u5931\u8d25,\u5df2\u8df3\u8fc7\u3002', 'error', 4000);
    } finally {
        hideCompressSpinner();
    }
}
async function autoGenerateTitle(chatId) {
    var msgs = chats[chatId].messages.filter(m => m.role !== 'system' && !m.partial);
    if (msgs.length < 2) return;
    let recent = ''
    for (const m of msgs.slice(0, 4)) {
        if (m.role === 'user') recent += '用户: ' + buildUserContent(m.text, m.files) + '\n';
        else recent += '助手: ' + m.content + '\n';
    }
    // ★ 标题生成: 优先用 titleModel, 没设置就用当前主模型, 实在没有再 fallback
    var model = getVal('titleModel') || getVal('modelSelect') || 'deepseek-v4-flash';
    // ★ 用当前 API 生成标题,对不兼容的 API 做参数清理
    var _titleBaseUrl = getVal('baseUrl');
    var _titleApiKey = getVal('apiKey');
    var _isLocalTitle = _titleBaseUrl.includes('localmodels') || _titleBaseUrl.includes('localhost') || _titleBaseUrl.includes('127.0.0.1');
    var _isMiniMax = _titleBaseUrl.includes('minimaxi.com');
    if (!model) return;
    if (!_titleApiKey && !_isLocalTitle) return;
    try {
        var body = {
            model,
            messages: [{
                role: 'user',
                content: recent + '\n---\n给这段对话起一个标题(不超过' + TITLE_MAX_LENGTH + '字):'
            }],
            temperature: 0,
            max_tokens: 500
        };
        // 关闭思考模式(DeepSeek/OpenAI 兼容),MiniMax/llamacpp 不支持这些参数
        if (!_isMiniMax && !_isLocalTitle) {
            body.extra_body = body.extra_body || {};
            body.extra_body.thinking = { type: "disabled" };
        }
        body.reasoning_split = false;
        // ★ 标题生成也走代理(否则国内直连超时)
        var _titleFetch = (typeof window.proxyFetch === 'function') ? window.proxyFetch : fetch;
        var res = await _titleFetch(_titleBaseUrl + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(_isLocalTitle ? {} : { Authorization: 'Bearer ' + _titleApiKey }) },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        var rawTitle = (data.choices[0].message.content || data.choices[0].message.reasoning_content || '').trim();
        if (!rawTitle || rawTitle.length < 2) {
            rawTitle = (data.choices[0].message.reasoning_content || '').trim();
        }
        // ★ 如果 content 太长(>200字),说明可能包含了思考/废话,取最后一句
        if (rawTitle.length > 200) {
            var _lines = rawTitle.split(/\n/);
            var _last = _lines[_lines.length - 1] || rawTitle.slice(-50);
            rawTitle = _last.trim();
        }
        // 清理 think 标签
        rawTitle = rawTitle.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        // 清理 Markdown 粗体/斜体格式 (Grok/MiniMax 喜欢加 **粗体** 或 *斜体*)
        rawTitle = rawTitle.replace(/\*{1,3}([^*]+?)\*{1,3}/g, '$1').trim();
        // 清理残余星号
        rawTitle = rawTitle.replace(/^\*+\s*|\s*\*+$/g, '').trim();
        var finalTitle = rawTitle;
        if (!finalTitle) {
            var reasoning = data.choices[0].message.reasoning_content || '';
            // 从 reasoning 里提取最后一句作为标题
            var cleanReasoning = reasoning.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            var lines = cleanReasoning.split(/\n|。/);
            for (let i = lines.length - 1; i >= 0; i--) {
                var line = lines[i].trim().replace(/^\*+\s*|\s*\*+$/g, '').trim();
                if (line.length >= 2 && line.length <= TITLE_MAX_LENGTH + 5 &&
                    !/^(我们|只|你|输出|生成|返回|请|需要|应该|可以|内容|对话|标题|用户|助手|根据|这段|好的)/.test(line)) {
                    finalTitle = line;
                    break;
                }
            }
            if (!finalTitle) finalTitle = cleanReasoning.replace(/\*{1,3}([^*]+?)\*{1,3}/g, '$1').replace(/^\*+\s*|\s*\*+$/g, '').trim();
        }
        finalTitle = finalTitle
            .replace(/[""''《》「」]/g, '')
            .replace(/^(标题[::]?\s*|我.*?[,,]\s*|根据.*?[,,]\s*|对话标题[::]?\s*|好的?\s*[,,]?\s*)/i, '')
            .replace(/[。,、!?!?,;;\n].*$/s, '')
            .replace(/^[：:;；\s]+|[：:;；\s]+$/g, '')
            .trim();
        if (!finalTitle || finalTitle.length < 1 || /^(我们|只|你|输出|生成|返回|请|需要|应该)/.test(finalTitle)) {
            var firstUserMsg = msgs.find(m => m.role === 'user');
            finalTitle = firstUserMsg ? firstUserMsg.text.slice(0, TITLE_MAX_LENGTH) : '新对话';
        }
        if (finalTitle.length > TITLE_MAX_LENGTH) finalTitle = finalTitle.slice(0, TITLE_MAX_LENGTH);
        typeTitle(chatId, finalTitle);
    } catch (e) { /* 静默失败 */ }
}

async function typeTitle(chatId, finalTitle, index = 0) {
    if (currentChatId !== chatId) {
        if (!chats[chatId]) return;
        chats[chatId].title = finalTitle;
        saveChatsDebounced();
        renderChatHistory();
        updateHeaderTitle();
        return;
    }
    if (index === 0) {
        if (!chats[chatId]) return;
        chats[chatId].title = '';
        saveChatsDebounced();
        renderChatHistory();
        updateHeaderTitle();
    }
    if (index < finalTitle.length) {
        chats[chatId].title = finalTitle.substring(0, index + 1);
        saveChatsDebounced(100);
        renderChatHistory();
        updateHeaderTitle();
        await new Promise(r => setTimeout(r, 10));
        typeTitle(chatId, finalTitle, index + 1);
    } else {
        chats[chatId].title = finalTitle;
        saveChatsDebounced();
        renderChatHistory();
        updateHeaderTitle();
    }
}

function saveChats() {
    // ★ 立即保存到服务器(不延迟,异步不阻塞)
    saveChatsToServer();

    // ★ 立即保存到 localStorage (图片等关键数据不能等 idle callback)
    slimSaveChats();

    // ★ 跨浏览器同步（低频率，仅 saveChats 触发）
    if (currentChatId && typeof window._broadcastChatUpdate === 'function') {
        window._broadcastChatUpdate(currentChatId);
    }
}

// 压缩聊天记录(现在只做浅拷贝,不删除任何图片数据)
function compressChatsForStorage(chatsObj) {
    // ★ 精简副本:保留图片等完整数据,仅在 localStorage 超出配额时降级
    var slim = {}
    var chatIds = Object.keys(chatsObj).sort(function(a, b) {
        var ta = String(chatsObj[a].updated_at || '');
        var tb = String(chatsObj[b].updated_at || '');
        return tb.localeCompare(ta); // 最新的排前面
    });

    // 保留最近 N 个聊天的完整数据（包括 Agent 聊天，刷新后不丢失）
    var MAX_CHATS = 50
    chatIds.forEach((id, idx) => {
        var chat = chatsObj[id];
        // 保留所有聊天的完整消息,不做截断
        slim[id] = JSON.parse(JSON.stringify(chat));
        if (slim[id].messages) {
            slim[id].messages = slim[id].messages.map(function(msg) {
                // 截断超长消息内容
                if (msg.content && msg.content.length > 10000) {
                    msg.content = msg.content.slice(0, 10000) + '...(内容已截断)';
                }
                // ★ 截断 web_fetch URL 列表 (最多保留10条)
                if (msg._webFetchUrls && msg._webFetchUrls.length > 10) {
                    msg._webFetchUrls = msg._webFetchUrls.slice(0, 10);
                }
                // ★ 剥离内联 base64 图片数据（保留 URL，清除 data: 前缀的原始数据）
                if (msg.generatedImage && msg.generatedImage.startsWith('data:')) {
                    msg.generatedImage = '';
                }
                if (msg.generatedImages && msg.generatedImages.length > 0) {
                    msg.generatedImages = msg.generatedImages.map(function(gi) {
                        return (gi && typeof gi === 'string' && gi.startsWith('data:')) ? '' : gi;
                    }).filter(Boolean);
                }
                // ★ 剥离用户上传文件中的 base64 content（仅保留元数据）
                if (msg.files && msg.files.length > 0) {
                    msg.files = msg.files.map(function(f) {
                        var isMedia = f.isImage || f.isVideo || (f.type && (f.type.startsWith('image/') || f.type.startsWith('video/')));
                        if (isMedia && f.content && f.content.length > 500) {
                            // 保留元数据，清除 base64 内容（刷新后应从 serverUrl 恢复）
                            return { name: f.name, type: f.type || (f.isImage ? 'image/png' : 'video/mp4'), size: f.size, isImage: f.isImage, isVideo: f.isVideo, content: '', serverUrl: f.serverUrl || '' };
                        }
                        // ★ 清除 Office 文档内嵌图片（base64 太大，刷新后需重新上传才能看到图片）
                        if (f.extractedImages && f.extractedImages.length > 0) {
                            delete f.extractedImages;
                            delete f.hasEmbeddedImages;
                        }
                        // 非媒体文件也截断过大的 content
                        if (f.content && f.content.length > 50000) {
                            var _newF = Object.assign({}, f);
                            _newF.content = '';
                            return _newF;
                        }
                        return f;
                    });
                }
                return msg;
            });
        }
    });
    return slim;
}
function slimSaveChats() {
    // ★ 三级降级策略：正常压缩 → 裁剪旧聊天 → 最简模式
    var _slim = compressChatsForStorage(chats);
    var _json = JSON.stringify(_slim);
    var _size = _json.length;
    console.log('[slimSaveChats] 压缩后大小:', _size, 'chars, 聊天数:', Object.keys(_slim).length);

    if (_size < 4500000) {
        try {
            localStorage.setItem('chats', _json);
            return true;
        } catch(e) { /* 继续降级 */ }
    }

    console.warn('[slimSaveChats] 数据过大(' + _size + '), 降级: 仅保留最近20个聊天');
    try {
        var _ids = Object.keys(_slim).sort(function(a, b) {
            return (_slim[b].updated_at || 0) - (_slim[a].updated_at || 0);
        });
        var _recent = {}
        _ids.slice(0, 20).forEach(function(id) { _recent[id] = _slim[id]; });
        var _json2 = JSON.stringify(_recent);
        console.log('[slimSaveChats] Level2 大小:', _json2.length, 'chars');
        if (_json2.length < 4500000) {
            localStorage.setItem('chats', _json2);
            return true;
        }
    } catch(e) {}

    console.warn('[slimSaveChats] 仍过大, 降级: 极限精简');
    try {
        var _ids2 = Object.keys(_slim).sort(function(a, b) {
            return (_slim[b].updated_at || 0) - (_slim[a].updated_at || 0);
        });
        var _minimal = {}
        _ids2.slice(0, 10).forEach(function(id) {
            var _c = JSON.parse(JSON.stringify(_slim[id]));
            if (_c.messages) {
                _c.messages = _c.messages.map(function(msg) {
                    delete msg.generatedImage;
                    delete msg.generatedImages;
                    delete msg.files;
                    delete msg._webFetchUrls;
                    if (typeof msg.content === 'string' && msg.content.length > 500) {
                        msg.content = msg.content.substring(0, 500) + '...[截断]';
                    }
                    if (typeof msg.reasoning === 'string' && msg.reasoning.length > 500) {
                        msg.reasoning = msg.reasoning.substring(0, 500) + '...[截断]';
                    }
                    return msg;
                });
            }
            _minimal[id] = _c;
        });
        var _json3 = JSON.stringify(_minimal);
        console.log('[slimSaveChats] Level3 大小:', _json3.length, 'chars');
        localStorage.setItem('chats', _json3);
        return true;
    } catch(e) {
        console.error('[slimSaveChats] ❌ 所有降级均失败:', e.message);
        return false;
    }
}

let _saveDebounceTimer = null;
function saveChatsDebounced(wait = 300) {
    if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = setTimeout(() => {
        _saveDebounceTimer = null;
        saveChats();
    }, wait);
}

function renderChatHistory() {
    var list = getEl('chatHistoryList');
    if (!list) return;
    // ★ 登录用户只显示自己账号的聊天记录
    var _uid = localStorage.getItem('authUserId') || '';
    var _chatIds = Object.keys(chats).filter(function(id) {
        // ★ 过滤: 排除 agent 独立聊天
        if (id === AGENT_CHAT_ID || id === '_agent_main') return false;
        return !_uid || !chats[id].userId || chats[id].userId === _uid;
    });
    // ★ 兜底: 如果过滤后为空但有userId,从 localStorage 重新加载
    if (_chatIds.length === 0 && _uid) {
        var _cached = localStorage.getItem('chats');
        if (_cached) {
            try {
                var _parsed = JSON.parse(_cached);
                if (_parsed && Object.keys(_parsed).length > 0) {
                    chats = _parsed;
                    _chatIds = Object.keys(chats).filter(function(id) {
                        if (id === AGENT_CHAT_ID || id === '_agent_main') return false;
                        return !_uid || !chats[id].userId || chats[id].userId === _uid;
                    });
                }
            } catch(e) {}
        }
    }
    // ★ 按更新时间排序,最新的在最上面
    _chatIds.sort(function(a, b) {
        var ta = chats[a].updated_at || chats[a].time || 0;
        var tb = chats[b].updated_at || chats[b].time || 0;
        if (ta !== tb) return tb - ta;
        // ★ 时间相同时按聊天ID降序稳定排序,避免刷新后乱跳
        return a < b ? 1 : (a > b ? -1 : 0);
    });
    list.innerHTML = _chatIds.map(id => `
        <div onclick="window.loadChat('${id}')" class="group flex items-center justify-between p-2 rounded-xl cursor-pointer transition ${id === currentChatId ? 'bg-white dark:bg-gray-800 shadow-sm text-blue-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'}">
            <span class="truncate text-sm">${escapeHtml(chats[id].title)}</span>
            <button onclick="window.deleteChat(event, '${id}')" class="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500"><svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
        </div>
    `).join('');
}

const RAG_ENABLED = localStorage.getItem('ragEnabled') !== 'false';
const RAG_API = '/oneapichat/api/rag_proxy.php';
window.RAG_ENABLED = RAG_ENABLED;

/** 立即同步删除到服务器（绕过频率限制，确保刷新不复活） */
async function _syncDeleteToServer(id) {
    var token = localStorage.getItem('authToken');
    if (!token) return false;
    var url = SERVER_API_BASE + '/chat.php?chat_id=' + encodeURIComponent(id) + '&auth_token=' + token;
    try {
        var resp = await fetch(url, { method: 'DELETE' });
        if (resp.ok) {
            console.log('[deleteChat] 服务器删除成功:', id);
            delete _deletedChatIds[id];
            try { localStorage.setItem('_deletedChatIds', JSON.stringify(_deletedChatIds)); } catch(e) {}
            return true;
        } else {
            console.warn('[deleteChat] 服务器删除失败(' + resp.status + '), 保留删除标记:', id);
            return false;
        }
    } catch(e) {
        console.warn('[deleteChat] 服务器删除请求失败, 保留删除标记:', e.message);
        return false;
    }
}

window.deleteChat = async function (e, id) {
    e.stopPropagation();
    if (!confirm('删除对话?')) return;
    if (abortControllerMap[id]) abortControllerMap[id].abort();
    if (searchAbortControllerMap[id]) searchAbortControllerMap[id].abort();
    delete abortControllerMap[id];
    delete searchAbortControllerMap[id];
    delete isTypingMap[id];
    delete activeBubbleMap[id];
    delete userAbortMap[id];
    _deletedChatIds[id] = true;
    delete chats[id];

    // ★ 立即持久化到本地（防止刷新复活）
    try { localStorage.setItem('_deletedChatIds', JSON.stringify(_deletedChatIds)); } catch(e) {
        try { localStorage.removeItem('chats'); } catch(e2) {}
        try { localStorage.setItem('_deletedChatIds', JSON.stringify(_deletedChatIds)); } catch(e3) {}
    }
    slimSaveChats(); // 先保存本地

    // ★ 后台同步删除到服务器（不阻塞 UI）
    _syncDeleteToServer(id).catch(function(){});

    // ★ 只检查当前用户的聊天数量,忽略其他用户的残留
    var _uid = localStorage.getItem('authUserId') || '';
    var myKeys = Object.keys(chats).filter(function(k) {
        return !_uid || !chats[k].userId || chats[k].userId === _uid;
    });
    if (myKeys.length) loadChat(myKeys[myKeys.length - 1]);
    else createNewChat();
    renderChatHistory();
};

window.createNewChat = function () {
    var id = 'chat_' + Date.now();
    var uid = localStorage.getItem('authUserId') || '';
    chats[id] = {
        title: '新对话',
        userId: uid,
        updated_at: Date.now(),
        messages: [
            { role: 'system', content: getVal('systemPrompt') || DEFAULT_CONFIG.system }
        ]
    };
    saveChats();
    loadChat(id);
    renderChatHistory();
    updateHeaderTitle();
};

window.loadChat = async function (id) {
    if (!chats[id]) { console.warn('[loadChat] 聊天不存在:', id); return; }
    // ★ 会话切换：先保存旧会话队列
    var _oldChatId = currentChatId;
    if (_oldChatId && _oldChatId !== id && window._messageQueue && !window._agentModeSwitching) {
        window._saveQueue();  // 普通切换：保存旧队列
    }
    // ★ 临时授权跟随会话：切走时隐藏,切回时恢复
    if (_oldChatId && _oldChatId !== id) {
        if (window._tempAgentGranted && id === window._tempAgentChatId) {
            // 切回有临时授权的会话 → 恢复指示灯
            if (typeof _updateTempGrantBanner === 'function') _updateTempGrantBanner(true);
        } else if (window._tempAgentGranted && _oldChatId === window._tempAgentChatId) {
            // 切离有临时授权的会话 → 隐藏指示灯(保留权限)
            if (typeof _updateTempGrantBanner === 'function') _updateTempGrantBanner(false);
        }
    }
    // 切换 currentChatId
    currentChatId = id;
    localStorage.setItem('lastChatId', id);
    // ★ 初始加载或切换后：同步临时授权状态(确保横幅正确显示/隐藏)
    if (window._tempAgentGranted && window._tempAgentChatId === id) {
        if (typeof _updateTempGrantBanner === 'function') _updateTempGrantBanner(true);
    } else if (window._tempAgentGranted && window._tempAgentChatId !== id) {
        if (typeof _updateTempGrantBanner === 'function') _updateTempGrantBanner(false);
    }
    // 加载新会话队列
    if (_oldChatId && _oldChatId !== id) {
        window._isQueueProcessing = false;
        window._isQueueMessage = false;
        window._messageQueue = [];
        var _restored = window._loadQueue();  // _getQueueKey 现在用新的 currentChatId ✅
        if (!_restored) {
            window._clearPersistedQueue();
        }
        window._updateQueueUI();
        if (_restored) {
            setTimeout(function() {
                if (window._messageQueue.length > 0 && !isTypingMap[currentChatId]) {
                    window._drainQueue();
                }
            }, 500);
        }
        // ★ setAgentMode 触发的切换：清除标记
        if (window._agentModeSwitching) {
            window._agentModeSwitching = false;
        }
    }
    var container = $.chatMessagesContainer;
    if (!container) return;

    var prefix = container.classList.contains('paragraph-prefix-dot') ? 'dot' : (container.classList.contains('paragraph-prefix-dash') ? 'dash' : 'none');
    container.innerHTML = '';
    applyParagraphPrefix(prefix);

    // ★ 清理所有残留 partial 消息
    if (chats[id] && chats[id].messages) {
        var _before = chats[id].messages.length;
        chats[id].messages = chats[id].messages.filter(function(m) { return !m.partial; });
        if (chats[id].messages.length !== _before) {
            console.log('[loadChat] 清理了 ' + (_before - chats[id].messages.length) + ' 条残留 partial');
        }
    }
    // ★ 删除残留的 typing DOM 气泡（sendMessage 创建但流已完成的）
    if (container) {
        var _typingBubbles = container.querySelectorAll('.bubble.assistant.typing');
        _typingBubbles.forEach(function(b) { b.remove(); });
    }

    // ★ WebSocket 续接：恢复上次未完成的流
    if (localStorage.getItem('__enableResumeStream') === '1') {
        try {
            var _savedSid = localStorage.getItem('_wsStreamId') || '';
            var _savedCnt = parseInt(localStorage.getItem('_wsChunkCount') || '0');
            if (_savedSid && _savedCnt > 0) {
                // 等待 WS 连接（_wsInit 已调用但可能还在连接中）
                var _w = 0;
                while ((!window._wsClient || window._wsClient.readyState !== WebSocket.OPEN) && _w < 3000) {
                    await new Promise(function(r) { setTimeout(r, 100); });
                    _w += 100;
                }
                if (window._wsClient && window._wsClient.readyState === WebSocket.OPEN) {
                    chats[id].messages = chats[id].messages.filter(function(m) { return !m.partial; });
                    var _rsPm = { role:'assistant', content:'', reasoning:'', partial:true, _recovered:true }
                    chats[id].messages.push(_rsPm);
                    window._wsClient.send(JSON.stringify({
                        action: 'resume', stream_id: _savedSid, since: _savedCnt
                    }));
                    window._wsStreamId = _savedSid;
                    window._wsChunkCount = _savedCnt;
                    console.log('[WS] Resume:', _savedSid, 'since:', _savedCnt);
                    window._backendRecovered = true;
                    return;
                }
            }
        } catch(e) {}
        if (chats[id] && chats[id].messages) {
            chats[id].messages = chats[id].messages.filter(function(m) { return !m.partial; });
        }
    }

    // ★ 恢复刷新前未完成的流式消息(仅在开关关闭时使用旧方案兜底)
    var savedPartial = null;
    if (localStorage.getItem('__enableResumeStream') !== '1') {
    try {
        savedPartial = JSON.parse(localStorage.getItem('_savedPartial') || 'null');
        if (savedPartial && savedPartial.chatId === id && (savedPartial.content || savedPartial.reasoning)) {
            // ★ 在恢复前先清理旧的 partial 消息(避免重复)
            chats[id].messages = chats[id].messages.filter(function(m) {
                return !m.partial;
            });
            var _recTime = savedPartial.time || Date.now();
            chats[id].messages.push({
                role: 'assistant',
                content: savedPartial.content || '',
                reasoning: savedPartial.reasoning || '',
                partial: true,
                time: _recTime,
                _recovered: true
            });
        }
    } catch(e) {}
    // ★ 标记待恢复:仅当流式确实在进行中(有内容且最近)才触发自动续生
    if (savedPartial && savedPartial.chatId === id && (savedPartial.content || savedPartial.reasoning)) {
        var _age = Date.now() - (savedPartial.time || 0);
        var _hasContent = (savedPartial.content && savedPartial.content.length > 0) || (savedPartial.reasoning && savedPartial.reasoning.length > 0);
        if (_hasContent && _age < 30000) {
            window._pendingRecovery = savedPartial;
        } else {
            console.log('[loadChat] 跳过过期或不完整的partial恢复, age=' + (_age/1000).toFixed(1) + 's');
        }
    }
    // ★ 立即清理，避免下次重复恢复
    try { localStorage.removeItem('_savedPartial'); } catch(e) {}
    window._pendingRecovery = null;
    } // end if toggle OFF

    // ★ Agent 模式: 加载记忆/人格/身份,注入 system prompt
    if (id === AGENT_CHAT_ID) {
        _injectAgentMemoryIntoSystem(id);
    }

    // ★ 过滤显示:system 消息和内部消息不显示给用户
    var displayMsgs = chats[id].messages.filter(function(m) {
        if (m._internal) return false;
        return m.role !== 'system';
    });
    if (!displayMsgs.length) {
        showWelcome();
    } else {
        displayMsgs.forEach((m, i) => {
            // ★ 修复: 清理已保存的 [object Object] 残留
            if (typeof m.content === 'string') {
                if (m.content === '[object Object]') {
                    m.content = '';
                } else {
                    m.content = m.content.replace(/\[object Object\]/g, '');
                }
            } else if (m.content && typeof m.content === 'object') {
                var extracted = m.content.text || m.content.content || m.content.value || '';
                if (extracted) {
                    m.content = '' + extracted;
                } else if (Array.isArray(m.content)) {
                    m.content = m.content.map(c => typeof c === 'object' ? (c.text || c.content || '') : String(c)).filter(Boolean).join('');
                } else {
                    m.content = JSON.stringify(m.content);
                }
            } else if (m.content === undefined || m.content === null) {
                m.content = '';
            }
            if (m.role === 'user') {
                appendMessage('user', m.text || '', m.files || null, null, null, null, i === displayMsgs.length - 1);
            } else {
                // ★ 修复: 对带工具调用的消息,在文本前追加工具调用可视化说明
                var toolDisplayHtml = '';
                if (m.tool_calls && m.tool_calls.length > 0) {
                    toolDisplayHtml = '<div class="tool-calls-history" style="font-size:12px;padding:8px 10px;margin-bottom:8px;background:#f0f4ff;border-radius:8px;border-left:3px solid #6366f1;">';
                    m.tool_calls.forEach(function(tc) {
                        var toolIcon = '🔧';
                        if (tc.function && tc.function.name) {
                            if (tc.function.name === 'web_search') toolIcon = '🔍';
                            else if (tc.function.name === 'web_fetch') toolIcon = '🌐';
                            else if (tc.function.name === 'generate_image' || tc.function.name === 'generate_image_i2i') toolIcon = '🎨';
                            else if (tc.function.name.indexOf('agent') !== -1) toolIcon = '🤖';
                            else if (tc.function.name.indexOf('cron') !== -1) toolIcon = '⏰';
                            else if (tc.function.name.indexOf('server_') !== -1) toolIcon = '🖥️';
                            toolDisplayHtml += '<div class="tool-call-item" style="padding:2px 0;">' + toolIcon + ' ' + escapeHtml(tc.function.name) + '</div>';
                        }
                    });
                    // 如果有工具结果,显示简短结果
                    if (m.tool_results && m.tool_results.length > 0) {
                        m.tool_results.forEach(function(tr, ti) {
                            var resultText = typeof tr === 'string' ? tr : (tr.content || tr.result || '');
                            if (resultText && resultText.length > 120) resultText = resultText.slice(0, 120) + '...';
                            if (resultText && toolDisplayHtml) {
                                toolDisplayHtml += '<div class="tool-result-item" style="padding:1px 0 1px 16px;color:#666;font-size:11px;">→ ' + escapeHtml(resultText).replace(/\n/g, '<br>') + '</div>';
                            }
                        });
                    }
                    toolDisplayHtml += '</div>';
                }
                var displayText = compressNewlines(m.content, 2);
                if (toolDisplayHtml) {
                    displayText = toolDisplayHtml + displayText;
                }
                var _bubble = appendMessage('assistant', displayText, null, m.reasoning, m.usage, m.time, i === displayMsgs.length - 1, m.generatedImage || null, m.generatedImages || null, !!m.partial);
                // ★ 恢复时也渲染 web_fetch 链接列表
                if (_bubble && m._webFetchUrls && m._webFetchUrls.length > 0) {
                    _renderWebFetchUrls(_bubble, m._webFetchUrls);
                }
            }
        });
    }

    if (isTypingMap[id] && displayMsgs.length) {
        activeBubbleMap[id] = container.lastElementChild?.querySelector('.bubble.assistant');
    } else {
        delete activeBubbleMap[id];
    }

    renderChatHistory();
    updateHeaderTitle();

    if (isTypingMap[id]) {
        if ($.sendBtn) $.sendBtn.classList.add('hidden');
        if ($.stopBtn) {
            $.stopBtn.classList.remove('hidden');
            $.stopBtn.classList.add('visible');
        }
    } else {
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
    }

    if (isMobile()) {
        $.sidebar?.classList.remove('mobile-open');
        $.configPanel?.classList.remove('mobile-open');
        $.sidebarMask?.classList.remove('active');
    }

    // 加载完成后自动滚动(loadChat 模式不受距离限制)
    autoScrollToBottom('loadChat');
};

function updateHeaderTitle() {
    if ($.chatTitle && currentChatId && chats[currentChatId]) {
        $.chatTitle.textContent = chats[currentChatId].title || '新对话';
    }
}


