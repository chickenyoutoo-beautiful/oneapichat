// api-messages.js — API 消息构建 v1.0 (提取自 main.js)
// getSmartSearchKeywords / getImageKeywords / hasImagesInChat / currentMessageHasImage
// injectCachedImageAnalyses / buildApiMessages / adjustMaxTokens

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
