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
    // ★ 手动选择优先
    var _manual = getVal('compressModel') || localStorage.getItem('compressModel') || '';
    if (_manual && _manual !== 'auto') return _manual;
    // 自动选择
    var currentModel = getVal('modelSelect') || DEFAULT_CONFIG.model;
    var ctxLen = getModelContextLength(currentModel);
    if (ctxLen >= 131072) return currentModel;
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
async function compressContextIfNeeded(chatId, force) {
    chatId = chatId || currentChatId;
    if (!chatId || !chats[chatId]) return false;
    if (!force && chats[chatId]?._compressFailed) return false;
    if (!force && !getChecked('compressToggle')) return false;

    var msgs = chats[chatId].messages || [];
    var currentModel = getVal('modelSelect') || DEFAULT_CONFIG.model;
    var contextLimit = getModelContextLength(currentModel);
    var estimatedTokens = estimateMessagesTokenCount(msgs);
    var thresholdPct = parseInt(getVal('compressThreshold')) || 10;

    // 检测是否达到 context 的 80%
    var limit80 = Math.floor(contextLimit * 0.8);
    var sysMessages = msgs.filter(function(m) { return m.role === 'system' && !m.temporary; });
    var partial = msgs.filter(function(m) { return m.partial; });
    var nonPartial = msgs.filter(function(m) { return m.role !== 'system' && !m.partial && !m.temporary; });

    if (!force) {
        if (estimatedTokens < limit80 && nonPartial.length <= thresholdPct) return false;
    } else {
        // 强制压缩: 消息过少则无需压缩
        if (nonPartial.length <= 2) return false;
    }

    showCompressSpinner();

    try {
        if (!force && nonPartial.length <= thresholdPct && estimatedTokens < limit80) {
            hideCompressSpinner();
            return false;
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

        // 构建摘要（★ 保留工具调用信息，防止压缩后模型产生幻觉）
        let conv = ''
        for (var si = 0; si < toSummarize.length; si++) {
            var m = toSummarize[si];
            if (m.role === 'tool_card') {
                continue;
            } else if (m.role === 'user') {
                conv += '用户: ' + (m.text || m.content || '').substring(0, 2000) + '\n';
            } else if (m.role === 'tool') {
                // ★ 保留工具执行结果的关键信息
                var _tContent = (typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''));
                conv += '[工具结果] ' + _tContent.substring(0, 500) + '\n';
            } else {
                var _assistantText = (m.content || '').substring(0, 2000);
                // ★ 保留工具调用信息
                if (m.tool_calls && m.tool_calls.length > 0) {
                    _assistantText += '\n[调用了以下工具: ' + m.tool_calls.map(function(tc) {
                        return tc.function ? tc.function.name : '?';
                    }).join(', ') + ']';
                }
                conv += '助手: ' + _assistantText + '\n';
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
        // ★ LongCat 清洗: 压缩请求也可能走 LongCat (当主模型是 LongCat 时)
        if (typeof window.sanitizeForLongCat === 'function') {
            compressBody.messages = window.sanitizeForLongCat(compressBody.messages);
        }

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
var _titleRetryTimers = window._titleRetryTimers || (window._titleRetryTimers = {});
var _titleRetryAttempts = window._titleRetryAttempts || (window._titleRetryAttempts = {});

function _hasMeaningfulChatContent(chat) {
    if (!chat) return false;
    // ★ 索引/按需加载模式：消息在服务器端持久化存在，必须视为有内容，严禁误判为草稿！
    if (chat._localIndex || chat._indexOnly || (typeof chat.msgCount === 'number' && chat.msgCount > 0)) {
        return true;
    }
    // 已被用户或系统生成自定义标题（非占位符）的会话，视为有意义会话
    if (chat.title && !_isPlaceholderTitle(chat.title)) return true;
    if (!Array.isArray(chat.messages)) return false;
    return chat.messages.some(function(m) {
        if (!m) return false;
        // 跳过系统提示词、临时消息、未附带文本的日期前缀消息
        if (m.role === 'system' || m.temporary) return false;
        if (m._datePrefix && !m.text && !m.content) return false;
        // 仅当对象没有 role 且只有 timestamp/time 时作为纯时间戳伪消息跳过
        if (!m.role && (m.timestamp || m.time)) return false;
        if (m.role === 'user') return !!String(m.text || m.content || '').trim() || !!(m.files && m.files.length);
        if (m.role === 'assistant') return !!String(m.content || m.reasoning || '').trim() || !!(m.tool_calls && m.tool_calls.length) || !!(m.generatedImages && m.generatedImages.length) || !!m.generatedImage;
        if (m.role === 'tool') return !!String(m.content || '').trim();
        return !!String(m.text || m.content || '').trim();
    });
}
window._hasMeaningfulChatContent = _hasMeaningfulChatContent;
window._isEmptyDraftChat = _isEmptyDraftChat;

function _isEmptyDraftChat(id) {
    if (!id || !chats[id]) return false;
    if (isAgentChat(id)) return false;
    if (typeof isTypingMap !== 'undefined' && isTypingMap[id]) return false;
    // 正在浏览的当前会话不作为背景多余草稿清理
    if (typeof currentChatId !== 'undefined' && id === currentChatId) return false;
    var chat = chats[id];
    if (chat._localIndex || chat._indexOnly || (typeof chat.msgCount === 'number' && chat.msgCount > 0)) return false;
    if (chat.title && !_isPlaceholderTitle(chat.title)) return false;
    return !_hasMeaningfulChatContent(chat);
}

function _isPlaceholderTitle(title) {
    title = String(title || '').trim();
    return !title || title === '新对话' || title === 'Agent' || title === 'Agent 会话' || title === '文件消息';
}

function _pruneEmptyDraftChats() {
    var ids = Object.keys(chats).filter(_isEmptyDraftChat).sort(function(a, b) {
        return (chats[b].updated_at || 0) - (chats[a].updated_at || 0);
    });
    if (ids.length <= 1) return ids[0] || null;
    var keepId = (typeof currentChatId !== 'undefined' && _isEmptyDraftChat(currentChatId)) ? currentChatId : (ids[0] || null);
    var pruned = false;
    ids.forEach(function(id) {
        if (id === keepId) return;
        delete chats[id];
        pruned = true;
        // ★ 严禁在清理本地多余空草稿时写入 _deletedChatIds 或向服务端发送 _syncDeleteToServer！
        // 只有用户显式点击删除按钮（window.deleteChat）才打墓碑并删除服务器数据。
    });
    if (pruned) {
        slimSaveChats();
    }
    return keepId;
}

function _scheduleTitleRetry(chatId) {
    if (!chatId || !chats[chatId]) return;
    // 索引模式消息尚未加载到本地，等 loadChat 之后再生成标题
    if (chats[chatId]._localIndex || chats[chatId]._indexOnly) return;
    if (!_hasMeaningfulChatContent(chats[chatId])) return;
    if (_titleRetryTimers[chatId]) return;
    var attempt = (_titleRetryAttempts[chatId] || 0) + 1;
    _titleRetryAttempts[chatId] = attempt;
    var delay = Math.min(120000, 5000 * Math.pow(2, Math.min(attempt - 1, 5)));
    _titleRetryTimers[chatId] = setTimeout(function() {
        delete _titleRetryTimers[chatId];
        if (!chats[chatId] || !_hasMeaningfulChatContent(chats[chatId])) return;
        autoGenerateTitle(chatId, true);
    }, delay);
}

async function autoGenerateTitle(chatId, isRetry) {
    if (!chats[chatId] || !_hasMeaningfulChatContent(chats[chatId])) return false;
    if (chats[chatId]._titleGenerating) return false;
    var msgs = chats[chatId].messages.filter(m => m.role !== 'system' && !m.partial);
    if (msgs.length < 2) { _scheduleTitleRetry(chatId); return false; }
    chats[chatId]._titleGenerating = true;
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
    if (!model || (!_titleApiKey && !_isLocalTitle)) {
        chats[chatId]._titleGenerating = false;
        _scheduleTitleRetry(chatId);
        return false;
    }
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
        // 标题属于会话元数据，不需要逐字动画。逐字保存会制造几十次服务器写入和
        // 多端广播，并在动画开始时把当前标题短暂清空，导致其他设备看到“无标题”。
        if (!chats[chatId]) return;
        chats[chatId].title = finalTitle;
        // 只有新创建的会话或原本没有合法时间戳的会话才设为当前时间，历史时间戳严格保留
        var _curTitleTs = typeof getChatTimestamp === 'function' ? getChatTimestamp(chats[chatId], chatId) : Number(chats[chatId].updated_at || 0);
        if (!_curTitleTs || _curTitleTs <= 0) {
            chats[chatId].updated_at = Date.now();
        }
        renderChatHistory();
        updateHeaderTitle();
        delete _titleRetryAttempts[chatId];
        if (_titleRetryTimers[chatId]) { clearTimeout(_titleRetryTimers[chatId]); delete _titleRetryTimers[chatId]; }
        delete chats[chatId]._titleGenerating;
        if (typeof window._saveAndBroadcast === 'function') window._saveAndBroadcast(chatId);
        else saveChats(true);
        return true;
    } catch (e) {
        if (chats[chatId]) delete chats[chatId]._titleGenerating;
        console.warn('[autoGenerateTitle] 标题生成失败，将延迟重试:', e.message);
        _scheduleTitleRetry(chatId);
        return false;
    }
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

function saveChats(forceServer, targetChatId) {
    // ★ 捕获变更所属会话，避免保存完成时用户已切换会话而广播错 chat_id。
    var _broadcastChatId = targetChatId || currentChatId;
    // ★ 立即保存到 localStorage (图片等关键数据不能等 idle callback)
    slimSaveChats();

    // ★ 当前会话先写独立小文件（即时主存储），再异步维护 all.json 汇总备份。
    var _singlePromise = _broadcastChatId && typeof saveSingleChatToServer === 'function' ? saveSingleChatToServer(_broadcastChatId, !!forceServer) : Promise.resolve(false);
    var _promise = Promise.resolve(_singlePromise).then(function() { return saveChatsToServer(forceServer); });
    if (_promise && typeof _promise.then === 'function') {
        _promise.then(function() {
            if (_broadcastChatId && typeof window._broadcastChatUpdate === 'function') {
                window._broadcastChatUpdate(_broadcastChatId, { force: !!forceServer, finished: !!forceServer });
            }
        }).catch(function() {
            // 即使服务器保存失败也要广播（本地数据已保存）
            if (_broadcastChatId && typeof window._broadcastChatUpdate === 'function') {
                window._broadcastChatUpdate(_broadcastChatId, { force: !!forceServer, finished: !!forceServer });
            }
        });
    } else {
        // 节流返回 false 时仍只广播调用时锁定的目标会话。
        if (_broadcastChatId && typeof window._broadcastChatUpdate === 'function') {
            window._broadcastChatUpdate(_broadcastChatId, { force: !!forceServer, finished: !!forceServer });
        }
    }
}

// ★ 强制保存到服务器并广播(用于多端同步关键节点)
window._saveAndBroadcast = function(chatId) {
    if (chatId && chats[chatId] && typeof window._ensureChatMessageIds === 'function') {
        window._ensureChatMessageIds(chats[chatId], chatId);
    }
    slimSaveChats();
    var traceId = '';
    try { if (window.SyncTrace && SyncTrace.enabled()) traceId = SyncTrace.id('save-broadcast:' + chatId); } catch(e) {}
    if (traceId) SyncTrace.log('save_broadcast_begin', { trace_id: traceId, chat_id: chatId, msg_count: chats[chatId] && Array.isArray(chats[chatId].messages) ? chats[chatId].messages.length : 0 });
    var single = typeof saveSingleChatToServer === 'function' ? saveSingleChatToServer(chatId, true) : Promise.resolve(false);
    return Promise.resolve(single).then(function(saved) {
        if (traceId) SyncTrace.log('save_broadcast_saved', { trace_id: traceId, chat_id: chatId, saved: !!saved });
        // all.json 仅作为后台汇总备份，不再阻塞用户消息落盘与广播。
        saveChatsToServer(true).catch(function(){});
        if (chatId && typeof window._broadcastChatUpdate === 'function') {
            return window._broadcastChatUpdate(chatId, { force: true, trace_id: traceId });
        }
        return false;
    }).catch(function(err) {
        if (traceId) SyncTrace.log('save_broadcast_failed', { trace_id: traceId, chat_id: chatId, error: err && err.message || String(err) });
        return false;
    });
};

// ★ 会话权威截断/分支（用于编辑重发、还原对话、重新生成）
// 必须严格单调递增 revision 并立即单文件落盘广播，彻底防止刷新后服务端旧消息复活
window.truncateChatMessages = function(chatId, remainingMessages) {
    if (!chatId || !chats[chatId]) return;
    var chat = chats[chatId];
    chat.messages = Array.isArray(remainingMessages) ? remainingMessages : [];
    chat.updated_at = Date.now();
    chat.revision = Math.max(Number(chat.revision || 0) + 1, chat.messages.length + 1);
    chat._truncatedAt = Date.now();
    slimSaveChats();
    if (typeof window._saveAndBroadcast === 'function') {
        window._saveAndBroadcast(chatId);
    } else if (typeof saveSingleChatToServer === 'function') {
        saveSingleChatToServer(chatId, true).catch(function(){});
    }
    if (currentChatId === chatId && typeof loadChat === 'function') {
        loadChat(chatId);
    }
};

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
                // ★ 截断超长消息内容（1MB 上限，基本不会触发）
                if (msg.content && msg.content.length > 1000000) {
                    msg.content = msg.content.slice(0, 1000000) + '\n\n...(内容过长已截断)';
                }
                // ★ 截断 web_fetch URL 列表 (最多保留10条)
                if (msg._webFetchUrls && msg._webFetchUrls.length > 10) {
                    msg._webFetchUrls = msg._webFetchUrls.slice(0, 10);
                }
                // ★ 剥离内联 base64 图片数据（保留 URL，清除 data: 前缀的原始数据）
                // 兼容新旧格式: 旧格式是字符串URL, 新格式是对象 {url, prompt, model, aspect_ratio, timestamp}
                if (msg.generatedImage) {
                    var _imgUrl = typeof msg.generatedImage === 'string' ? msg.generatedImage : (msg.generatedImage.url || '');
                    if (_imgUrl.startsWith('data:')) {
                        msg.generatedImage = '';
                    }
                }
                if (msg.generatedImages && msg.generatedImages.length > 0) {
                    msg.generatedImages = msg.generatedImages.map(function(gi) {
                        if (!gi) return null;
                        // 新格式: 对象 {url, ...}
                        if (typeof gi === 'object' && gi.url) {
                            return gi.url.startsWith('data:') ? null : gi;
                        }
                        // 旧格式: 字符串 URL
                        return gi.startsWith('data:') ? null : gi;
                    }).filter(Boolean);
                }
                // ★ 剥离用户上传文件中的 base64 content（保留元数据 + 适中小图片）
                if (msg.files && msg.files.length > 0) {
                    msg.files = msg.files.map(function(f) {
                        var isMedia = f.isImage || f.isVideo || (f.type && (f.type.startsWith('image/') || f.type.startsWith('video/')));
                        if (isMedia && f.content && f.content.length > 200000) {
                            // 大图片(>200KB base64): 只保留元数据, 刷新后无法恢复 base64
                            return { name: f.name, type: f.type || (f.isImage ? 'image/png' : 'video/mp4'), size: f.size, isImage: f.isImage, isVideo: f.isVideo, content: '', serverUrl: f.serverUrl || '', serverPath: f.serverPath || '' };
                        }
                        // 中小图片: 保留 base64 (刷新后 xAI 仍可用)
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
function slimSaveChats(syncServer) {
    // ★ DB模式: localStorage只存元数据索引,完整数据走服务器SQLite
    //    元数据索引 ~1KB/聊天, 100个聊天也仅~100KB — 永不超过配额
    var _slim = compressChatsForStorage(chats);
    var _json = JSON.stringify(_slim);
    var _size = _json.length;

    if (_size < 3500000) {
        // ★ 小数据: localStorage直接存完整数据(快速路径,无需服务器)
        try {
            localStorage.setItem('chats', _json);
            localStorage.removeItem('_chats_db_mode');
            return true;
        } catch(e) { /* fall through to DB mode */ }
    }

    // ★ DB模式: 数据>3.5MB → 所有聊天只存索引，完整消息以服务器数据库为准。
    // Agent 会话往往包含大量工具调用和长输出；保留其完整内容会让“索引模式”
    // 仍然超过浏览器配额，并在每次保存时反复失败。
    console.log('[slimSaveChats] DB模式: ' + _size + ' chars → 索引本地 + 全量服务器');
    try {
        var _index = {};
        var _keys = Object.keys(_slim);
        for (var _i = 0; _i < _keys.length; _i++) {
            var _c = _slim[_keys[_i]];
            _index[_keys[_i]] = {
                title: _c.title || '新对话',
                updated_at: _c.updated_at || '',
                userId: _c.userId || '',
                msgCount: (_c.messages || []).length,
                _localIndex: true
            };
        }
        var _idxJson = JSON.stringify(_index);
        localStorage.setItem('chats', _idxJson);
        localStorage.setItem('_chats_db_mode', '1');
        console.log('[slimSaveChats] 索引大小:', _idxJson.length, 'chars, 聊天数:', Object.keys(_index).length);
    } catch(e) {
        // 极端情况: 降级仅保留最近聊天标题
        console.warn('[slimSaveChats] 索引写入失败, 极限降级:', e.message);
        try {
            var _mini = {};
            var _allIds = Object.keys(chats).sort(function(a, b) {
                var ta = typeof getChatTimestamp === 'function' ? getChatTimestamp(chats[a], a) : (Number(chats[a].updated_at) || 0);
                var tb = typeof getChatTimestamp === 'function' ? getChatTimestamp(chats[b], b) : (Number(chats[b].updated_at) || 0);
                return tb - ta;
            });
            _allIds.slice(0, 30).forEach(function(id) {
                _mini[id] = { title: chats[id].title || '新对话', updated_at: chats[id].updated_at || '' };
            });
            localStorage.setItem('chats', JSON.stringify(_mini));
        } catch(e2) {
            console.error('[slimSaveChats] ❌ 所有降级均失败:', e2.message);
        }
    }

    // 仅在明确要求时才触发全量服务器备份；普通本地存储绝不发起昂贵的全量备份
    if (syncServer && typeof saveChatsToServer === 'function') {
        saveChatsToServer(true);
    }
    return true;
}

// ★ 统一权威时间戳解析函数 (数字/ISO字符串/消息时间/ID时间戳安全解析, 绝不返回 NaN)
function getChatTimestamp(chat, id) {
    if (!chat && id && typeof chats !== 'undefined' && chats[id]) chat = chats[id];
    if (!chat) {
        if (id) {
            var mId = String(id).match(/_(\d{13})/);
            if (mId) {
                var nid = Number(mId[1]);
                if (nid > 1000000000000 && nid < 2500000000000) return nid;
            }
        }
        return 0;
    }
    var val = chat.updated_at != null && chat.updated_at !== '' ? chat.updated_at : (chat.time || chat.created_at || 0);
    if (typeof val === 'number' && val > 0) {
        return val < 100000000000 ? Math.round(val * 1000) : Math.round(val);
    }
    if (typeof val === 'string' && val.trim() !== '') {
        var num = Number(val);
        if (!isNaN(num) && num > 0) {
            return num < 100000000000 ? Math.round(num * 1000) : Math.round(num);
        }
        var parsed = Date.parse(val);
        if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    if (Array.isArray(chat.messages) && chat.messages.length > 0) {
        for (var i = chat.messages.length - 1; i >= 0; i--) {
            var m = chat.messages[i];
            if (m && typeof m === 'object') {
                var mt = m.timestamp || m.time || m.created_at;
                if (typeof mt === 'number' && mt > 1000000000000) return Math.round(mt);
                if (typeof mt === 'string') {
                    var mp = Date.parse(mt);
                    if (!isNaN(mp) && mp > 0) return mp;
                }
            }
        }
    }
    var targetId = id || chat.id || chat.chat_id;
    if (targetId) {
        var mId2 = String(targetId).match(/_(\d{13})/);
        if (mId2) {
            var nid2 = Number(mId2[1]);
            if (nid2 > 1000000000000 && nid2 < 2500000000000) return nid2;
        }
    }
    return 0;
}
window.getChatTimestamp = getChatTimestamp;

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
    if (!list) { console.log('[renderChatHistory] list元素不存在'); return; }
    _pruneEmptyDraftChats();
    Object.keys(chats).forEach(function(id) {
        if (!isAgentChat(id) && _hasMeaningfulChatContent(chats[id]) && _isPlaceholderTitle(chats[id].title)) {
            _scheduleTitleRetry(id);
        }
    });
    // ★ 严格分隔: Agent 视图(agent/yolo 模式)只显示 Agent 会话,普通视图只显示普通聊天
    //   _agent_main(当前会话) + _agent_old_*(归档会话) 归 Agent 域,chat_* 归普通域
    var _isAgentView = isAgentToolsActive();
    // ★ 子代理会话默认隐藏,用户可在配置栏开启(所有模式下均生效)
    var _showSubAgent = localStorage.getItem('showSubAgentSessions') === 'true';
    // ★ 登录用户只显示自己账号的聊天记录
    var _uid = localStorage.getItem('authUserId') || '';
    // ★ 过滤函数: 子代理/内部测试会话仅在 Agent 视图且开关开启时显示，普通视图绝不显示
    var _filterChat = function(id) {
        var _isAgent = isAgentChat(id);
        if (_isAgent) {
            // 处于普通聊天视图时，彻底拦截所有 Agent 域会话
            if (!_isAgentView) return false;
            // 处于 Agent 视图时，主会话(_agent_main)、归档(_agent_old_*)、Claude Code(claude_*)、Codex(codex_*)正常显示
            var _agentMainId = (typeof AGENT_CHAT_ID !== 'undefined') ? AGENT_CHAT_ID : '_agent_main';
            var _isDirectAgentItem = (id === _agentMainId || id.indexOf('_agent_old_') === 0 || id.indexOf('claude_') === 0 || id.indexOf('codex_') === 0);
            if (!_isDirectAgentItem) {
                // 子代理/测试会话需开启开关
                return _showSubAgent && (!_uid || !chats[id].userId || chats[id].userId === _uid);
            }
            return !_uid || !chats[id].userId || chats[id].userId === _uid;
        }
        // 普通会话：仅在普通视图下显示；空白草稿像 DSH 一样不进入历史列表。
        if (_isAgentView) return false;
        if (_isEmptyDraftChat(id)) return false;
        return !_uid || !chats[id].userId || chats[id].userId === _uid;
    };
    var _chatIds = Object.keys(chats).filter(_filterChat);
    if (_chatIds.length === 0 && _uid) {
        var _cached = localStorage.getItem('chats');
        if (_cached) {
            try {
                var _parsed = JSON.parse(_cached);
                if (_parsed && typeof _parsed === 'object') {
                    var _restoredAny = false;
                    Object.keys(_parsed).forEach(function(_pk) {
                        if (!chats[_pk]) {
                            chats[_pk] = _parsed[_pk];
                            _restoredAny = true;
                        }
                    });
                    if (_restoredAny) {
                        _chatIds = Object.keys(chats).filter(_filterChat);
                    }
                }
            } catch(e) {}
        }
    }
    // ★ 按更新时间排序,最新的在最上面 (统一纯数字比较, 绝无 NaN 导致乱跳)
    _chatIds.sort(function(a, b) {
        var ta = getChatTimestamp(chats[a], a);
        var tb = getChatTimestamp(chats[b], b);
        if (ta !== tb) return tb - ta;
        // ★ 时间相同时按聊天ID降序稳定排序,避免刷新后乱跳
        return String(b).localeCompare(String(a));
    });
    // ★ 史诗级 v2: 分组与折叠渲染
    // 从 localStorage 读取折叠状态
    var _collapsedGroups = {};
    try {
        _collapsedGroups = JSON.parse(localStorage.getItem('_historyCollapsedGroups') || '{}');
    } catch(e) {}

    window.toggleHistoryGroup = function(gKey) {
        try {
            var map = JSON.parse(localStorage.getItem('_historyCollapsedGroups') || '{}');
            map[gKey] = !map[gKey];
            localStorage.setItem('_historyCollapsedGroups', JSON.stringify(map));
            renderChatHistory();
        } catch(e) {}
    };

    var _now = new Date();
    var _dayStart = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate()).getTime();
    var _ydayStart = _dayStart - 86400000;
    var _groups = [];
    var _groupMap = {};

    function _historyGroupSvg(kind) {
        var _common = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
        var _icons = {
            'folder-code': '<svg ' + _common + '><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="10 13 8 15 10 17"/><polyline points="14 13 16 15 14 17"/></svg>',
            'layers': '<svg ' + _common + '><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
            'globe': '<svg ' + _common + '><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
            'user': '<svg ' + _common + '><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
            'folder': '<svg ' + _common + '><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
            'claude': '<svg ' + _common + '><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/><path d="M10 13h5M10 17h5"/></svg>',
            'codex': '<svg ' + _common + '><rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="8 9 5.5 12 8 15"/><polyline points="16 9 18.5 12 16 15"/><line x1="13" y1="8" x2="11" y2="16"/></svg>',
            'calendar': '<svg ' + _common + '><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
            'calendar-clock': '<svg ' + _common + '><path d="M8 2v4M16 2v4M3 10h18"/><path d="M19 14.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8.5"/><circle cx="18" cy="18" r="3"/><path d="M18 16.5V18l1 1"/></svg>',
            'archive': '<svg ' + _common + '><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>'
        };
        return _icons[kind] || _icons.folder;
    }

    function _stripImportedSessionPrefix(title) {
        return String(title || '').replace(/^\s*(?:\[(?:claude|codex)\]|【(?:claude|codex)】)\s*/i, '');
    }

    function _addToGroup(gKey, gName, id, orderWeight, iconKind) {
        if (!_groupMap[gKey]) {
            _groupMap[gKey] = { key: gKey, name: gName, icon: iconKind || '', items: [], weight: orderWeight || 100 };
            _groups.push(_groupMap[gKey]);
        }
        _groupMap[gKey].items.push(id);
    }

    if (_isAgentView) {
        // ★ DSH 架构：Agent 模式下按工作区 (Workspace) 区分并组织会话
        var _wm = window.WorkspaceManager;
        var _wsList = _wm ? _wm.getWorkspaces() : [{ id: 'oneapichat', name: 'oneapichat', icon: 'folder-code' }];
        var _curWs = _wm ? _wm.getCurrentWorkspace() : { id: 'oneapichat', name: 'oneapichat' };
        var _wsMap = {};
        _wsList.forEach(function(w, idx) {
            var isCurrent = w.id === _curWs.id;
            _wsMap[w.id] = {
                ws: w,
                key: 'ws_' + w.id,
                name: w.name + (isCurrent ? ' (当前)' : ''),
                icon: w.icon || 'folder',
                weight: isCurrent ? 1 : (idx + 2)
            };
        });

        // 确保当前激活工作区无论是否有历史会话都先建好分组
        if (_wsMap[_curWs.id]) {
            _addToGroup(_wsMap[_curWs.id].key, _wsMap[_curWs.id].name, null, 1, _wsMap[_curWs.id].icon);
        }

        _chatIds.forEach(function(id) {
            if (id.indexOf('claude_') === 0) {
                _addToGroup('claude_imports', 'Claude Code 会话', id, 200, 'claude');
            } else if (id.indexOf('codex_') === 0) {
                _addToGroup('codex_imports', 'Codex 会话', id, 210, 'codex');
            } else {
                var targetWsId = (_wm && typeof _wm.getChatWorkspaceId === 'function') ? _wm.getChatWorkspaceId(id) : null;
                if (!targetWsId || !_wsMap[targetWsId]) {
                    targetWsId = 'oneapichat'; // 缺省默认归属主工作区
                }
                var gMeta = _wsMap[targetWsId] || { key: 'ws_other', name: '其它工作区', icon: 'folder', weight: 100 };
                _addToGroup(gMeta.key, gMeta.name, id, gMeta.weight, gMeta.icon);
            }
        });

        // 清理由于提前建分组产生的 null 项
        _groups.forEach(function(g) {
            g.items = g.items.filter(Boolean);
        });

        // 过滤掉非当前工作区且没有任何会话的空预设分组
        _groups = _groups.filter(function(g) {
            if (g.items.length > 0) return true;
            return g.key === ('ws_' + _curWs.id);
        });

        _groups.sort(function(a, b) { return a.weight - b.weight; });
    } else {
        _chatIds.forEach(function(id) {
            var _t = getChatTimestamp(chats[id], id);
            var _g = _t >= _dayStart ? '今天' : (_t >= _ydayStart ? '昨天' : '更早');
            var _w = _t >= _dayStart ? 1 : (_t >= _ydayStart ? 2 : 3);
            _addToGroup('norm_' + _g, _g, id, _w, _g === '今天' ? 'calendar' : (_g === '昨天' ? 'calendar-clock' : 'archive'));
        });
        _groups.sort(function(a, b) { return a.weight - b.weight; });
    }

    list.innerHTML = _groups.map(function(grp) {
        var _isCollapsed = !!_collapsedGroups[grp.key];
        var _itemsHtml = grp.items.map(function(id) {
            var _isBgRunning = isTypingMap[id] && id !== currentChatId;
            var _bgDot = _isBgRunning ? '<span class="bg-running-dot" title="后台生成中" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3b82f6;margin-right:6px;animation:bg-pulse 1.2s ease-in-out infinite;flex-shrink:0;"></span>' : '';
            var _active = id === currentChatId;
            // ★ _agent_main 是 Agent 模式当前主会话,不渲染删除按钮
            //   (删除会写 _deletedChatIds 墓碑,而 setAgentMode/createNewChat 又持续重建本地副本 → 服务器永不回同步)
            var _delBtn = (id === AGENT_CHAT_ID)
                ? ''
                : '<button onclick="window.deleteChat(event, \'' + id + '\')" class="chat-history-del" title="删除对话"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>';
            // ★ Agent 视图: 一级分组已经表达会话来源，单条标题不再重复携带 Emoji/Claude/Codex 前缀。
            var _title = chats[id].title || '';
            if (_isAgentView && id !== AGENT_CHAT_ID && isAgentChat(id)) {
                _title = _title.replace(/^📦\s*/, '').replace(/^🤖\s*/, '');
            }
            if (id.indexOf('claude_') === 0 || id.indexOf('codex_') === 0) {
                _title = _stripImportedSessionPrefix(_title);
            }
            return `
            <div onclick="window.loadChat('${id}')" class="chat-history-item${_active ? ' active' : ''}" title="${escapeHtml(_title)}">
                <span class="chat-history-title truncate">${_bgDot}${escapeHtml(_title)}</span>
                ${_delBtn}
            </div>`;
        }).join('');
        var _chevronIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
        return '<div class="chat-history-group' + (_isCollapsed ? ' collapsed' : '') + '">' +
            '<div class="chat-history-group-header" onclick="window.toggleHistoryGroup(\'' + grp.key + '\')">' +
                '<div class="chat-history-group-title-wrap">' +
                    '<span class="chat-history-group-chevron">' + _chevronIcon + '</span>' +
                    '<span class="chat-history-group-icon chat-history-group-kind-icon">' + _historyGroupSvg(grp.icon) + '</span>' +
                    '<span class="chat-history-group-label">' + escapeHtml(grp.name) + '</span>' +
                '</div>' +
                '<span class="chat-history-group-count">' + grp.items.length + '</span>' +
            '</div>' +
            '<div class="chat-history-group-items">' + _itemsHtml + '</div>' +
        '</div>';
    }).join('');
}

const RAG_ENABLED = localStorage.getItem('ragEnabled') !== 'false';
const RAG_API = '/oneapichat/api/rag_proxy.php';
window.RAG_ENABLED = RAG_ENABLED;

/** 立即同步删除到服务器（绕过频率限制，确保刷新不复活） */
async function _syncDeleteToServer(id) {
    var token = localStorage.getItem('authToken');
    if (!token) return false;
    var url = SERVER_API_BASE + '/chat.php?chat_id=' + encodeURIComponent(id);
    try {
        var resp = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
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
    try {
        if (window.ResumeStream) {
            if (typeof window.ResumeStream.cancelActive === 'function') window.ResumeStream.cancelActive(id);
            if (typeof window.ResumeStream.complete === 'function') window.ResumeStream.complete(id);
        }
    } catch(_resumeDeleteError) {}
    // ★ 子代理会话：同步清理 localStorage 聊天记录
    if (id && id.indexOf('_agent_sub_') === 0) {
        var _agentName = id.substring('_agent_sub_'.length);
        localStorage.removeItem('agent_chat_' + _agentName);
    }
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

    // ★ 多端同步 (2026-08-02): 广播 chat:deleted 事件, 其他在线端立即删除本地副本并标记,
    //   防止其他端内存中的旧 chats 通过 POST all 把已删会话写回服务器
    //   (服务器端另有 deleted 墓碑机制兜底最终一致性)
    if (typeof window._broadcastEvent === 'function') {
        window._broadcastEvent('chat:deleted', { chat_id: id });
    }

    // ★ 只检查当前用户且与当前模式同域的聊天数量(严格分隔:普通视图只统计普通聊天,Agent 视图只统计 Agent 会话)
    var _uid = localStorage.getItem('authUserId') || '';
    var _delAgentView = isAgentToolsActive();
    var myKeys = Object.keys(chats).filter(function(k) {
        if (isAgentChat(k) !== _delAgentView) return false;
        return !_uid || !chats[k].userId || chats[k].userId === _uid;
    });
    // ★ 删除后切换到同域最近会话;无则新建(普通模式建普通聊天,Agent 模式建新 _agent_main)
    if (myKeys.length) {
        myKeys.sort(function(a,b) {
            var ta = typeof getChatTimestamp === 'function' ? getChatTimestamp(chats[a], a) : (Number(chats[a].updated_at) || 0);
            var tb = typeof getChatTimestamp === 'function' ? getChatTimestamp(chats[b], b) : (Number(chats[b].updated_at) || 0);
            return tb - ta;
        });
        loadChat(myKeys[0]);
    }
    else createNewChat();
    renderChatHistory();
};

window.createNewChat = function () {
    // DSH 风格：普通模式始终只有一个空白草稿。重复点击“新建”只回到它，不再堆积空会话。
    if (getAgentMode() === 'off') {
        var _emptyIds = Object.keys(chats).filter(_isEmptyDraftChat).sort(function(a, b) {
            var ta = typeof getChatTimestamp === 'function' ? getChatTimestamp(chats[a], a) : (Number(chats[a].updated_at) || 0);
            var tb = typeof getChatTimestamp === 'function' ? getChatTimestamp(chats[b], b) : (Number(chats[b].updated_at) || 0);
            return tb - ta;
        });
        var _draftId = _emptyIds[0] || null;
        _emptyIds.slice(1).forEach(function(_emptyId) { delete chats[_emptyId]; });
        if (_draftId) {
            chats[_draftId].updated_at = Date.now();
            loadChat(_draftId);
            renderChatHistory();
            updateHeaderTitle();
            return _draftId;
        }
    }
    // ★ Agent 模式 /new: 归档旧 _agent_main 为子代理会话
    //   只要 Agent 模式下主会话有内容就归档(不论当前打开的是哪个聊天),
    //   防止在归档会话/其他聊天中按 /new 时旧主会话被静默覆盖丢失
    if (getAgentMode() !== 'off' && chats['_agent_main'] && chats['_agent_main'].messages.length > 1) {
        var _archiveId = '_agent_old_' + Date.now();
        var _oldTitle = chats['_agent_main'].title || 'Agent 会话';
        // 提取对话摘要作为标题
        var _firstUser = chats['_agent_main'].messages.find(function(m) { return m.role === 'user'; });
        if (_firstUser) {
            _oldTitle = (_firstUser.text || _firstUser.content || 'Agent').substring(0, 30);
        }
        chats[_archiveId] = JSON.parse(JSON.stringify(chats['_agent_main']));
        chats[_archiveId].title = '📦 ' + _oldTitle;
        chats[_archiveId]._archivedAgent = true;
        // 清理旧 agent_main
        delete chats['_agent_main'];
        showToast('📦 旧 Agent 会话已归档: ' + _oldTitle, 'info', 3000);
    }
    // ★ Agent 模式: 创建新 _agent_main
    if (getAgentMode() !== 'off') {
        var _uid2 = localStorage.getItem('authUserId') || '';
        var _sysPrompt = localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt;
        chats['_agent_main'] = {
            title: 'Agent 会话',
            userId: _uid2,
            updated_at: Date.now(),
            messages: [{ role: 'system', content: _sysPrompt }]
        };
        // ★ 防御: 清除历史遗留的 _agent_main 删除墓碑(否则服务器端永远跳过该 id 的同步)
        if (_deletedChatIds && _deletedChatIds['_agent_main']) {
            delete _deletedChatIds['_agent_main'];
            try { localStorage.setItem('_deletedChatIds', JSON.stringify(_deletedChatIds)); } catch(e) {}
        }
        saveChats();
        loadChat('_agent_main');
        renderChatHistory();
        updateHeaderTitle();
        return;
    }
    // ★ 普通模式 /new
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
    if (typeof _deletedChatIds !== 'undefined' && _deletedChatIds[id]) {
        delete _deletedChatIds[id];
        try { localStorage.setItem('_deletedChatIds', JSON.stringify(_deletedChatIds)); } catch(e) {}
    }
    slimSaveChats();
    loadChat(id);
    renderChatHistory();
    updateHeaderTitle();
    return id;
};

window.loadChat = async function (id) {
    if (!chats[id]) { console.warn('[loadChat] 聊天不存在:', id); return; }
    if (!Array.isArray(chats[id].messages)) chats[id].messages = [];
    // ★ 索引/按需模式：点击或恢复当前会话时，仅拉取这一条会话完整正文。
    // 不能再等待 16MB all.json；否则超时后只剩标题索引，刷新表现为消息被吞。
    var _needsHydration = !!(chats[id]._localIndex || chats[id]._indexOnly || ((chats[id].msgCount || 0) > 0 && chats[id].messages.length === 0));
    if (_needsHydration && typeof window.loadSingleChatFromServer === 'function') {
        var _existingTs = typeof getChatTimestamp === 'function' ? getChatTimestamp(chats[id], id) : (Number(chats[id].updated_at) || 0);
        var _hydratedChat = await window.loadSingleChatFromServer(id);
        if (_hydratedChat && Array.isArray(_hydratedChat.messages)) {
            var _localShell = chats[id];
            var _hydratedTs = typeof getChatTimestamp === 'function' ? getChatTimestamp(_hydratedChat, id) : (Number(_hydratedChat.updated_at) || 0);
            chats[id] = Object.assign({}, _localShell, _hydratedChat);
            delete chats[id]._localIndex;
            delete chats[id]._indexOnly;
            chats[id].msgCount = chats[id].messages.length;
            // 严格保持时间戳稳定：只读加载绝不因 hydration 改写真实更新时间，杜绝点击时位置突变跳动
            if (_existingTs > 0) {
                chats[id].updated_at = _existingTs;
            } else if (_hydratedTs > 0) {
                chats[id].updated_at = _hydratedTs;
            }
            slimSaveChats(false);
        }
    }
    // 历史/索引模式可能带回不完整消息对象，先修正形状再执行 length/filter。
    chats[id].messages = chats[id].messages.filter(function(msg) {
        if (!msg || typeof msg !== 'object') return false;
        if (msg.role === 'assistant' && msg.tool_calls != null && !Array.isArray(msg.tool_calls)) msg.tool_calls = [];
        if (msg.role === 'tool' && msg.content != null && typeof msg.content !== 'string') {
            try { msg.content = JSON.stringify(msg.content); } catch(e) { msg.content = String(msg.content); }
        }
        return true;
    });
    try {
    // ★ 会话切换：先保存旧会话队列与计划状态
    var _oldChatId = currentChatId;
    if (_oldChatId && _oldChatId !== id) {
        if (window._messageQueue && !window._agentModeSwitching && typeof window._saveQueue === 'function') {
            window._saveQueue(undefined, _oldChatId);  // 明确保存到旧会话
        }
        if (typeof window.savePlanState === 'function') {
            window.savePlanState(_oldChatId);
        }
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
    // ★ 工作区联动：同步恢复该会话绑定的工作区 (DSH Workspace)
    if (window.WorkspaceManager && typeof window.WorkspaceManager.syncWithCurrentChat === 'function') {
        window.WorkspaceManager.syncWithCurrentChat(id);
    }
    var _todoBook = chats[id] && chats[id]._vibeTodos;
    if (_todoBook && Array.isArray(_todoBook.todos) && _todoBook.todos.length > 0) {
        window._todoBooks = window._todoBooks || {};
        window._todoBooks[id] = _todoBook;
        var _todoDone = _todoBook.todos.filter(function(t){ return t.status === 'completed'; }).length;
        var _todoPct = _todoBook.todos.length ? Math.round(_todoDone / _todoBook.todos.length * 100) : 0;
        var _hasUnfinished = _todoPct < 100 && _todoBook.todos.some(function(t){ return t.status === 'pending' || t.status === 'in_progress'; });
        if (_hasUnfinished && typeof window._renderTodoHud === 'function') {
            window._renderTodoHud(_todoBook.todos, _todoPct, { isRestore: true });
        } else if (typeof window._renderTodoHud === 'function') {
            window._renderTodoHud([], 0);
        }
    } else if (typeof window._renderTodoHud === 'function') {
        window._renderTodoHud([], 0);
    }
    // ★ 任务计划流面板联动：切换会话或刷新页面时，自动恢复该会话的 Plan 面板
    if (typeof window.restorePlanForChat === 'function') {
        window.restorePlanForChat(id);
    }
    try { sessionStorage.setItem('_oneapiLastChatId', id); } catch(e) {}
    // 可恢复状态必须在清理 partial 之前接管 typing 标记，否则刷新时目标气泡
    // 会先被 loadChat 删除，只能等下一个 token 才重新出现。
    var _hasResumeState = false;
    // ★ 子代理会话只读，跳过可恢复流续接
    if (chats[id] && chats[id]._agentSub) {
        _hasResumeState = false;
    } else try {
        _hasResumeState = localStorage.getItem('_streamStopped_' + id) !== '1' &&
            window.ResumeStream && typeof window.ResumeStream.hasPending === 'function' &&
            window.ResumeStream.hasPending(id);
        if (_hasResumeState) isTypingMap[id] = true;
    } catch(e) {}
    // ★ 刷新恢复保护：DB 模式本地只有索引时，先把 ResumeStream 的运行快照
    // 注入聊天历史，再渲染 DOM。否则 hydrate 只能找到空数组，正在生成的气泡会完全消失。
    if (_hasResumeState && window.ResumeStream && typeof window.ResumeStream.peek === 'function') {
        try {
            var _rsHydrateState = window.ResumeStream.peek(id);
            if (_rsHydrateState) {
                var _resumeMsgs = chats[id].messages;
                var _resumeMsg = _resumeMsgs.find(function(m) {
                    if (!m || m.role !== 'assistant') return false;
                    return (!!_rsHydrateState.msgId && m._rsMsgId === _rsHydrateState.msgId) ||
                        (!!_rsHydrateState.sid && m._rsStreamId === _rsHydrateState.sid);
                });
                if (!_resumeMsg) {
                    _resumeMsg = {
                        role: 'assistant',
                        content: _rsHydrateState.content || '',
                        reasoning: _rsHydrateState.reasoning || '',
                        tool_calls: Array.isArray(_rsHydrateState.toolCalls) ? _rsHydrateState.toolCalls : [],
                        partial: true,
                        _recovered: true,
                        _rsMsgId: _rsHydrateState.msgId || '',
                        _rsStreamId: _rsHydrateState.sid || '',
                        time: Date.now()
                    };
                    _resumeMsgs.push(_resumeMsg);
                } else {
                    _resumeMsg.content = _rsHydrateState.content || _resumeMsg.content || '';
                    _resumeMsg.reasoning = _rsHydrateState.reasoning || _resumeMsg.reasoning || '';
                    if (_rsHydrateState.msgId) _resumeMsg._rsMsgId = _rsHydrateState.msgId;
                    if (_rsHydrateState.sid) _resumeMsg._rsStreamId = _rsHydrateState.sid;
                    _resumeMsg.partial = true;
                    _resumeMsg._recovered = true;
                }
                console.log('[loadChat] 已从 ResumeStream 快照恢复生成中消息:', id,
                    'contentLen=' + String(_resumeMsg.content || '').length);
            }
        } catch (_resumeHydrateError) {
            console.warn('[loadChat] ResumeStream 快照注入失败:', _resumeHydrateError.message);
        }
    }
    // ★ 旧版/极早刷新兜底：若 ResumeStream 状态尚未写入，但 beforeunload 已保存了当前流，
    // 先恢复气泡，并把 stream 身份迁移到 legacy 键供 ResumeStream 接管。
    if (!_hasResumeState) {
        try {
            var _savedPartialFallback = JSON.parse(localStorage.getItem('_savedPartial') || 'null');
            if (_savedPartialFallback && _savedPartialFallback.chatId === id &&
                (Date.now() - (_savedPartialFallback.time || 0) < 60000) &&
                (_savedPartialFallback.content || _savedPartialFallback.reasoning ||
                    (_savedPartialFallback.toolCalls && _savedPartialFallback.toolCalls.length))) {
                if (_savedPartialFallback.streamId) {
                    localStorage.setItem('_rs_sid', _savedPartialFallback.streamId);
                    localStorage.setItem('_rs_cid', id);
                    localStorage.setItem('_rs_msgid', _savedPartialFallback.msgId || '');
                    localStorage.setItem('_rs_ts', String(_savedPartialFallback.time || Date.now()));
                    _hasResumeState = window.ResumeStream && window.ResumeStream.hasPending(id);
                    if (_hasResumeState) isTypingMap[id] = true;
                }
                var _fallbackHasMsg = chats[id].messages.some(function(m) {
                    return m && m.role === 'assistant' &&
                        ((_savedPartialFallback.msgId && m._rsMsgId === _savedPartialFallback.msgId) ||
                         (_savedPartialFallback.streamId && m._rsStreamId === _savedPartialFallback.streamId));
                });
                if (!_fallbackHasMsg) {
                    chats[id].messages.push({
                        role: 'assistant',
                        content: _savedPartialFallback.content || '',
                        reasoning: _savedPartialFallback.reasoning || '',
                        tool_calls: Array.isArray(_savedPartialFallback.toolCalls) ? _savedPartialFallback.toolCalls : [],
                        partial: true,
                        _recovered: true,
                        _rsMsgId: _savedPartialFallback.msgId || '',
                        _rsStreamId: _savedPartialFallback.streamId || '',
                        time: _savedPartialFallback.time || Date.now()
                    });
                }
                console.log('[loadChat] 已从 _savedPartial 兜底恢复生成中消息:', id);
            }
        } catch (_savedPartialError) {
            console.warn('[loadChat] _savedPartial 兜底恢复失败:', _savedPartialError.message);
        }
    }
    // ★ 初始加载或切换后：同步临时授权状态(确保横幅正确显示/隐藏)
    if (window._tempAgentGranted && window._tempAgentChatId === id) {
        if (typeof _updateTempGrantBanner === 'function') _updateTempGrantBanner(true);
    } else if (window._tempAgentGranted && window._tempAgentChatId !== id) {
        if (typeof _updateTempGrantBanner === 'function') _updateTempGrantBanner(false);
    }
    // ★ 并行对话: 保存旧队列→加载新队列, 不阻断旧对话
    if (_oldChatId && _oldChatId !== id) {
        if (typeof window._saveQueue === 'function') {
            window._saveQueue(undefined, _oldChatId);  // 明确保存到旧会话
        }
        window._isQueueProcessing = false;
        window._isQueueMessage = false;
        window._messageQueue = [];
        var _restored = typeof window._loadQueue === 'function' ? window._loadQueue(undefined, id) : false;
        if (!_restored && typeof window._clearPersistedQueue === 'function') {
            window._clearPersistedQueue(id);
        }
        if (typeof window._updateQueueUI === 'function') {
            window._updateQueueUI();
        }
        // ★ 核心修复：切换会话时绝不自动排干发送旧队列，杜绝跨会话误发与旧设备冷启动自发消息！
        // 队列状态已同步到 UI 待发送栏，由用户在当前会话中明确感知并决定。
        // ★ setAgentMode 触发的切换：清除标记
        if (window._agentModeSwitching) {
            window._agentModeSwitching = false;
        }
    }
    var container = $.chatMessagesContainer;
    if (!container) return;

    // ★ 彻底清空DOM: innerHTML + removeChild双重保险
    while (container.firstChild) container.removeChild(container.firstChild);
    // 会话重绘先退出 Agent 空态；若当前仍为空，showWelcome() 会重新添加。
    container.classList.remove('agent-welcome-active');
    // ★ 清除旧程序滚动标记(防止旧会话的 __lastAutoScrollTarget 误匹配新位置导致吸附失效)
    if (typeof window.clearFollowState === 'function') window.clearFollowState();
    var prefix = container.classList.contains('paragraph-prefix-dot') ? 'dot' : (container.classList.contains('paragraph-prefix-dash') ? 'dash' : 'none');
    applyParagraphPrefix(prefix);

    // ★ 清理残留 partial 消息 — 但保留当前正在生成中的(后台并行)
    if (chats[id] && chats[id].messages) {
        var _before = chats[id].messages.length;
        chats[id].messages = chats[id].messages.filter(function(m) {
            if (!m.partial) return true;
            // 有稳定流身份或持久快照的 partial 是可恢复事实，不能因本地 typing 标志尚未
            // 初始化而删除；只有完全无身份、无内容的孤儿占位才可清理。
            if (isTypingMap[id] || _hasResumeState || m._rsMsgId || m._rsStreamId || m._recovered) return true;
            var _hasPartialData = !!((m.content && String(m.content).trim()) || (m.reasoning && String(m.reasoning).trim()) || (Array.isArray(m.tool_calls) && m.tool_calls.length));
            return _hasPartialData;
        });
        if (chats[id].messages.length !== _before) {
            console.log('[loadChat] 清理了 ' + (_before - chats[id].messages.length) + ' 条残留 partial, 剩余 ' + chats[id].messages.length + ' 条');
        }
    }
    // ★ 删除残留的 typing DOM 气泡（非本地生成时清理）
    if (container && !isTypingMap[id]) {
        var _typingBubbles = container.querySelectorAll('.bubble.assistant.typing');
        _typingBubbles.forEach(function(b) { b.remove(); });
    }

    // 旧 WebSocket 网关已停用，残留的全局 stream id 既不绑定 chatId，又会在清空 DOM 后
    // 阻塞/早退。统一清理并由按 msg_id 持久化的 ResumeStream/SSE 接管恢复。
    try { localStorage.removeItem('_wsStreamId'); } catch(e) {}
    try { localStorage.removeItem('_wsChunkCount'); } catch(e) {}

    // ★ 恢复刷新前未完成的流式消息(仅在开关关闭时使用旧方案兜底)
    // ★ 先检查是否被用户主动停止 — 如果是则跳过续接
    if (localStorage.getItem('_streamStopped_' + id) === '1') {
        try { localStorage.removeItem('_streamStopped_' + id); } catch(e) {}
        try { localStorage.removeItem('_savedPartial'); } catch(e) {}
        console.log('[loadChat] 用户主动停止过，跳过续接');
    } else {
    var savedPartial = null;
    if (localStorage.getItem('__enableResumeStream') === '0') {
    try {
        savedPartial = JSON.parse(localStorage.getItem('_savedPartial') || 'null');
        if (savedPartial && savedPartial.chatId === id && (savedPartial.content || savedPartial.reasoning)) {
            console.log('[loadChat] _savedPartial recovery: adding partial with contentLen=' + ((savedPartial.content||'').length) + ' to chat ' + id + ' (msgs before=' + chats[id].messages.length + ')');
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
    } // end else (not stopped)

    // ★ Agent 模式: 加载记忆/人格/身份,注入 system prompt
    if (id === AGENT_CHAT_ID) {
        _injectAgentMemoryIntoSystem(id);
    }

    // ★ 过滤显示:system 消息、内部消息和工具结果不显示给用户
    var rawDisplayMsgs = chats[id].messages.filter(function(m) {
        if (m._internal) return false;
        if (m._toolResult) return false;  // ★ 工具结果不渲染到UI
        if (m.role === 'tool') return false;  // ★ 角色为 tool 的消息不渲染
        return m.role !== 'system';
    });

    // ★ 核心修复：折叠/聚合同一轮多轮工具调用产生的连续 assistant 消息
    // 防止一次提问经历多次 web_search 后在界面上裂变渲染出 3~4 个重复破碎的 AI 气泡！
    var displayMsgs = [];
    for (var di = 0; di < rawDisplayMsgs.length; di++) {
        var curM = rawDisplayMsgs[di];
        if (curM.role === 'assistant') {
            // 检查前面紧邻的一条是否也是普通 assistant（属于同一轮问答迭代）
            var prevM = displayMsgs.length > 0 ? displayMsgs[displayMsgs.length - 1] : null;
            if (prevM && prevM.role === 'assistant') {
                // 深度融合：合并 tool_calls、generatedImages，正文取最新或更完整的内容
                var fused = Object.assign({}, prevM);
                // 合并 tool_calls 并去重
                var existingCalls = Array.isArray(fused.tool_calls) ? fused.tool_calls.slice() : [];
                var newCalls = Array.isArray(curM.tool_calls) ? curM.tool_calls : [];
                var callIds = {};
                existingCalls.forEach(function(c) { if (c && c.id) callIds[c.id] = true; });
                newCalls.forEach(function(c) {
                    if (c && (!c.id || !callIds[c.id])) {
                        existingCalls.push(c);
                        if (c.id) callIds[c.id] = true;
                    }
                });
                fused.tool_calls = existingCalls;

                // 内容融合：若新消息已有完整正文且包含旧消息内容，直接使用新消息；否则按流式融合
                var prevText = String(prevM.content || '').trim();
                var curText = String(curM.content || '').trim();
                if (curText && prevText) {
                    if (curText.indexOf(prevText) === 0) {
                        fused.content = curText;
                    } else if (prevText.indexOf(curText) === 0) {
                        fused.content = prevText;
                    } else if (typeof window.mergeAssistantStreamText === 'function') {
                        fused.content = window.mergeAssistantStreamText(prevText, curText);
                    } else {
                        fused.content = curText;
                    }
                } else {
                    fused.content = curText || prevText;
                }

                // 推理过程
                if (curM.reasoning || prevM.reasoning) {
                    fused.reasoning = curM.reasoning || prevM.reasoning;
                }
                // 状态、用量、耗时取最新
                fused.usage = curM.usage || prevM.usage;
                fused.time = curM.time || prevM.time;
                fused.partial = !!(curM.partial);

                displayMsgs[displayMsgs.length - 1] = fused;
                continue;
            }
        }
        displayMsgs.push(curM);
    }
    if (!displayMsgs.length) {
        showWelcome();
    } else {
        // ★ 性能: DocumentFragment 批量插入 + 大列表抑制逐条淡入动画(数百条消息不再逐条触发布局)
        var _loadFrag = document.createDocumentFragment();
        window._appendTarget = _loadFrag;
        window._suppressRowAnim = displayMsgs.length > 25;
        displayMsgs.forEach((m, i) => {
            try {
            // ★ 原始消息索引(用于判断是否最后一条assistant)
            var _origIdx = chats[id].messages.indexOf(m);
            // ★ 修复: 清理已保存的 [object Object] 与 (empty) 假占位符残留
            if (typeof m.content === 'string') {
                if (m.content === '[object Object]') {
                    m.content = '';
                } else {
                    m.content = m.content.replace(/\[object Object\]/g, '').replace(/\(empty\)/gi, '').trim();
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
            if (m.role === 'tool_card') {
                // 旧版 tool_card 格式已收敛由 assistant.tool_calls 统一时间线渲染，不再渲染独立空行
            } else if (m.role === 'user') {
                // ★ 保留推入标记 (消息在模型生成中途被推入时显示角标)
                appendMessage('user', m.text || m.content || '', m.files || null, null, null, null, i === displayMsgs.length - 1, null, null, false, _origIdx, !!m._injected);
            } else {
                // ★ DSH 风格智能体操作时间线 (超过2项自动折叠收纳)'
                var toolDisplayHtml = '';
                if (m.tool_calls && m.tool_calls.length > 0) {
                    var badgesHtml = '';
                    m.tool_calls.forEach(function(tc) {
                        var _tn = tc.function && tc.function.name ? tc.function.name : 'unknown';
                        var _argsObj = {};
                        try { _argsObj = JSON.parse(tc.function.arguments || '{}'); } catch(e) {}
                        var _summary = '';
                        if (_argsObj.command) _summary = _argsObj.command;
                        else if (_argsObj.file_path || _argsObj.path) _summary = _argsObj.file_path || _argsObj.path;
                        else if (_argsObj.query || _argsObj.keywords || _argsObj.q) _summary = _argsObj.query || _argsObj.keywords || _argsObj.q;
                        else if (_argsObj.url) _summary = _argsObj.url;
                        else if (_argsObj.prompt) _summary = _argsObj.prompt.substring(0, 45);
                        else _summary = JSON.stringify(_argsObj).substring(0, 45);

                        var _icon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
                        if (_tn.indexOf('search') !== -1 || _tn.indexOf('fetch') !== -1) {
                            _icon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
                        } else if (_tn.indexOf('file') !== -1 || _tn.indexOf('read') !== -1 || _tn.indexOf('write') !== -1) {
                            _icon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
                        } else if (_tn.indexOf('image') !== -1) {
                            _icon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
                        } else if (_tn.indexOf('agent') !== -1 || _tn.indexOf('delegate') !== -1) {
                            _icon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><line x1="9" y1="15" x2="15" y2="15"/></svg>';
                        }

                        badgesHtml += '<div class="dsh-step-badge">' +
                            '<span class="dsh-step-icon">' + _icon + '</span>' +
                            '<span class="dsh-step-name"># ' + escapeHtml(_tn) + '</span>' +
                            (_summary ? '<span class="dsh-step-desc">· ' + escapeHtml(_summary) + '</span>' : '') +
                            '<span class="dsh-step-check"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' +
                            '</div>';
                    });

                    if (m.tool_calls.length > 2) {
                        toolDisplayHtml = '<details class="dsh-timeline-group">' +
                            '<summary class="dsh-timeline-group-summary">' +
                                '<span class="dsh-timeline-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>' +
                                '<span class="dsh-timeline-title">Agent 执行了 ' + m.tool_calls.length + ' 步操作</span>' +
                                '<span class="dsh-timeline-badge">已完成</span>' +
                            '</summary>' +
                            '<div class="dsh-steps-timeline">' + badgesHtml + '</div>' +
                            '</details>';
                    } else {
                        toolDisplayHtml = '<div class="dsh-steps-timeline">' + badgesHtml + '</div>';
                    }
                }
                var _cleanContent = typeof m.content === 'string' ? m.content.replace(/\(empty\)/gi, '').trim() : (m.content || '');
                var displayText = _cleanContent ? compressNewlines(_cleanContent, 2) : '';
                if (toolDisplayHtml) {
                    displayText = toolDisplayHtml + (displayText ? '\n\n' + displayText : '');
                }
                if (displayText.trim() || (m.generatedImages && m.generatedImages.length) || m.generatedImage || m.reasoning || m.partial) {
                    var _bubble = appendMessage('assistant', displayText, null, m.reasoning, m.usage, m.time, i === displayMsgs.length - 1, m.generatedImage || null, m.generatedImages || null, !!m.partial, _origIdx);
                    if (_bubble && m._webFetchUrls && m._webFetchUrls.length > 0) {
                        _renderWebFetchUrls(_bubble, m._webFetchUrls);
                    }
                }
            }
            } catch(e) {
                console.warn('[loadChat] 跳过损坏消息', i, m?.role, e.message);
            }
        });
        window._appendTarget = null;
        window._suppressRowAnim = false;
        // ★ 批量插入完成后再挂载到容器(一次布局, 而非逐条)
        container.appendChild(_loadFrag);
        if (typeof window.attachImageFallbacks === 'function') {
            window.attachImageFallbacks(container);
        }
    }

    var _isTypingActive = !!isTypingMap[id];
    if (_isTypingActive && displayMsgs.length) {
        // 工具结果卡片可能是最后一个可见节点，不能据此认定流式目标不存在。
        // 直接选择最后一个 assistant 气泡，刷新首帧即可挂载工具运行状态。
        var _assistantBubbles = container.querySelectorAll('.bubble.assistant');
        var _targetBubble = _assistantBubbles.length ? _assistantBubbles[_assistantBubbles.length - 1] : null;
        var _lastMsg = displayMsgs[displayMsgs.length - 1];
        // ★ 核心修复: 只有当最新一条消息确实是进行中状态 (partial/未闭合/正在生成) 时才作为活跃气泡打上 typing 类
        //   若消息已完成 (非 partial 且已有完整内容)，绝不误打 typing/加载三点
        if (_targetBubble && _lastMsg && (_lastMsg.partial || _lastMsg._recovered || !_lastMsg.content || !_lastMsg.content.trim())) {
            activeBubbleMap[id] = _targetBubble;
            _targetBubble.classList.add('typing', 'gen-active');
            if (!_lastMsg.content || !_lastMsg.content.trim()) {
                if (window.ModelStatus && typeof window.ModelStatus.ensureTypingIndicator === 'function') {
                    window.ModelStatus.ensureTypingIndicator(_targetBubble);
                }
            }
        } else {
            delete activeBubbleMap[id];
            if (_targetBubble) {
                _targetBubble.classList.remove('typing', 'gen-active', 'streaming');
                if (window.ModelStatus && typeof window.ModelStatus.removeTypingIndicator === 'function') {
                    window.ModelStatus.removeTypingIndicator(_targetBubble);
                }
            }
        }
    } else {
        delete activeBubbleMap[id];
    }

    if (_hasResumeState && window.ResumeStream) {
        // 同步 hydration 先画已有快照/工具状态；网络续接随后异步启动。
        try { window.ResumeStream.hydrate(id); } catch(e) {}
        setTimeout(function() {
            if (currentChatId === id && window.ResumeStream && typeof window.ResumeStream.resume === 'function') {
                window.ResumeStream.resume(id).catch(function(err) {
                    console.warn('[loadChat] ResumeStream resume failed:', err && err.message || err);
                });
            }
        }, 0);
    }

    renderChatHistory();
    updateHeaderTitle();

    if (typeof window.updateSendStopButtons === 'function') {
        window.updateSendStopButtons(!!isTypingMap[id]);
    } else {
        var _agSend = document.getElementById('agentSendBtn');
        var _agStop = document.getElementById('agentStopBtn');
        if (isTypingMap[id]) {
            if ($.sendBtn) $.sendBtn.classList.add('hidden');
            if ($.stopBtn) { $.stopBtn.classList.remove('hidden'); $.stopBtn.classList.add('visible'); }
            if (_agSend) _agSend.classList.add('hidden');
            if (_agStop) _agStop.classList.remove('hidden');
        } else {
            if ($.sendBtn) $.sendBtn.classList.remove('hidden');
            if ($.stopBtn) $.stopBtn.classList.remove('visible');
            if (_agSend) _agSend.classList.remove('hidden');
            if (_agStop) _agStop.classList.add('hidden');
        }
    }

    if (isMobile()) {
        $.sidebar?.classList.remove('mobile-open');
        $.configPanel?.classList.remove('mobile-open');
        $.sidebarMask?.classList.remove('active');
    }

    // 加载完成后自动滚动(loadChat 模式不受距离限制)
    autoScrollToBottom('loadChat');
    // ★ 标记历史工具调用行的批次 + 折叠
    setTimeout(function() {
        var _rows = $.chatMessagesContainer?.querySelectorAll('.tool-call-row');
        if (!_rows || _rows.length < 2) return;
        var _batchIdx = 0;
        _rows.forEach(function(r, i) {
            var _prev = i > 0 ? _rows[i-1] : null;
            var _isNew = !_prev || !_prev.hasAttribute('data-tool-batch') || _prev.getAttribute('data-tool-batch') !== r.parentNode?.getAttribute?.('data-batch') || !_prev.nextElementSibling?.isSameNode?.(r);
            if (!_prev || !_prev.hasAttribute('data-tool-batch') || _prev.nextElementSibling !== r) {
                _batchIdx++;
                r.setAttribute('data-tool-idx', '0');
            } else {
                r.setAttribute('data-tool-idx', (parseInt(_prev.getAttribute('data-tool-idx')||'0')+1).toString());
                r.style.display = 'none';
            }
            r.setAttribute('data-tool-batch', _batchIdx.toString());
        });
        // 给每个批次第一条加按钮
        _rows.forEach(function(r) {
            if (r.getAttribute('data-tool-idx') !== '0' || r.querySelector('.tool-toggle-btn')) return;
            var _batch = [r]; var _n2 = r.nextElementSibling;
            while (_n2 && _n2.getAttribute('data-tool-batch') === r.getAttribute('data-tool-batch')) { _batch.push(_n2); _n2 = _n2.nextElementSibling; }
            if (_batch.length < 2) return;
            var _bub = r.querySelector('.tool-call-bubble');
            if (!_bub) return;
            var _btn = document.createElement('button');
            _btn.className = 'tool-toggle-btn';
            _btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
            _btn.title = '展开全部 (' + (_batch.length-1) + ' more)';
            _btn.onclick = function(e2) {
                e2.stopPropagation();
                var _anyHidden = _batch[1].style.display === 'none';
                for (var _bi = 1; _bi < _batch.length; _bi++) {
                    _batch[_bi].style.display = _anyHidden ? '' : 'none';
                    if (_anyHidden) _batch[_bi].style.animation = 'toolFadeIn 0.3s ease';
                }
                this.style.transform = _anyHidden ? 'rotate(180deg)' : '';
                this.title = _anyHidden ? '折叠' : '展开全部 (' + (_batch.length-1) + ' more)';
                if (_anyHidden && $.chatBox && !userScrolled) { followToBottom($.chatBox); }
            };
            _bub.appendChild(_btn);
        });
    }, 500);
    } catch(e) {
        console.error('[loadChat] 加载聊天失败:', id, e.message);
        showWelcome();
    }
};

function updateHeaderTitle() {
    if ($.chatTitle && currentChatId && chats[currentChatId]) {
        $.chatTitle.textContent = chats[currentChatId].title || '新对话';
    }
}
