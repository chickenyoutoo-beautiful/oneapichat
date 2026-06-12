// stream-handler.js — 流式/非流式响应处理 v1.0 (提取自 main.js)
// _backendSSEHandler / streamResponse / handleNonStream / handleError / autoDetectAndRetryImageUrlError

// ★ 后端 SSE 处理器:接收 SSE 流式事件,转换为 streamResponse 兼容格式
// SSE 格式: "event: TYPE\ndata: JSON\n\n"
// 解析时需要识别 "event:" 行来确定事件类型
window._backendSSEHandler = async function(sseResponse, chatId, pendingMsg, msgId) {
    var reader = sseResponse.body.getReader();
    var decoder = new TextDecoder();
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
        var lines = buffer.split('\n');
        // 最后一行是可能不完整的下一条消息,保留在 buffer
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
            var line = rawLine.trim();
            if (!line) continue;

            // 检测 "event: TYPE" 行 - 设置当前事件类型
            if (line.startsWith('event: ')) {
                currentEventType = line.substring(6).trim();
                continue;
            }

            // 检测 "data: JSON" 行 - 用当前事件类型解析
            if (!line.startsWith('data: ')) continue;
            var dataStr = line.substring(6).trim();
            if (!dataStr || dataStr === '[DONE]') continue;

            try {
                var event = JSON.parse(dataStr);

                if (currentEventType === 'content' || event.type === 'content') {
                    var delta = event.delta || event.content || '';
                    if (delta) {
                        fullText += delta;
                        // ★ MiniMax实时去重: 正文可能包含思考内容前缀, 流式时即清除
                        if (reasoningText && fullText.indexOf(reasoningText) === 0) {
                            fullText = fullText.substring(reasoningText.length).trim();
                        }
                        applyStreamRender(chatId, fullText);
                    }
                } else if (currentEventType === 'reasoning' || event.type === 'reasoning') {
                    var rd = event.delta || event.reasoning || '';
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

    // ★ MiniMax/DeepSeek 思考标签提取与去重（SSE路径）
    if (fullText) {
        var _allThink2 = '';
        // 提取完整 <think>...</think> 标签
        var _mt2 = fullText.match(/<think>([\s\S]*?)<\/think>/g);
        if (_mt2) {
            for (var _mti = 0; _mti < _mt2.length; _mti++) {
                _allThink2 += _mt2[_mti].replace(/<\/?think>/g, '');
            }
            fullText = fullText.replace(/<think>[\s\S]*?<\/think>/g, '');
        }
        // 提取 MiniMax (think)...(endthink) 格式
        var _mt3 = fullText.match(/\(think\)([\s\S]*?)\(endthink\)/g);
        if (_mt3) {
            for (var _mti2 = 0; _mti2 < _mt3.length; _mti2++) {
                _allThink2 += _mt3[_mti2].replace(/\(endthink\)/g, '').replace(/\(think\)/g, '');
            }
            fullText = fullText.replace(/\(think\)[\s\S]*?\(endthink\)/g, '');
        }
        // 未闭合的 (think) 兜底 — 只匹配到行尾避免吞掉正文
        var _open2 = fullText.match(/\(think\)([\s\S]*?)$/);
        if (_open2 && _open2[1].length < 2000) {
            _allThink2 += _open2[1];
            fullText = fullText.replace(/\(think\)[\s\S]*$/, '');
        }
        if (_allThink2.trim() && !reasoningText) {
            reasoningText = _allThink2.trim();
        }
        fullText = fullText.trim();

        // ★ MiniMax去重: 思考内容可能在正文中重复出现，移除正文中的思考前缀
        var _rt2 = (reasoningText || '').trim();
        var _ft2 = (fullText || '').trim();
        if (_rt2 && _ft2 && _rt2.length > 20) {
            // 1) 正文前缀精确匹配
            if (_ft2.indexOf(_rt2) === 0) {
                fullText = _ft2.substring(_rt2.length).trim();
                console.log('[MM-SSE] 从正文移除重复思考前缀(' + _rt2.length + ' chars)');
            // 2) 正文部分前缀匹配（重叠检测）
            } else if (_ft2.length > _rt2.length * 0.5) {
                for (var _oi = Math.min(_rt2.length, 500); _oi > 50; _oi--) {
                    if (_ft2.indexOf(_rt2.substring(0, _oi)) === 0) {
                        fullText = _ft2.substring(_oi).trim();
                        console.log('[MM-SSE] 从正文移除部分重叠思考(overlap=' + _oi + ' chars)');
                        break;
                    }
                }
            }
            // 3) 正文中间内嵌思考文本（位置在前500字符内）
            if (_rt2.length > 30 && fullText && fullText.length > 0) {
                var _rtPos = fullText.substring(0, Math.min(fullText.length, 1000)).indexOf(_rt2);
                if (_rtPos > 0 && _rtPos < 500) {
                    fullText = (fullText.substring(0, _rtPos) + fullText.substring(_rtPos + _rt2.length)).trim();
                    console.log('[MM-SSE] 从正文中间移除内嵌思考(pos=' + _rtPos + ')');
                }
            }
            // 4) 正文开头的 (think) 标签残留清理
            if (fullText && /^\(think\)/i.test(fullText)) {
                fullText = fullText.replace(/^\(think\)\s*/i, '').trim();
            }
        }
    }

    return { fullText, reasoningText, usage, toolCalls };
};

async function streamResponse(res, chatId, pendingMsg, reasoningDelay, contentDelay) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
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
                        // ★ 严格区分 content 和 reasoning，不互相污染
                        if (dd && dd.content && String(dd.content).trim()) {
                            fullText += dd.content;
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
        var decoded = decoder.decode(value, { stream: true });
        buffer += decoded;
        var lines = buffer.split('\n');
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
                        var match = jsonStr.match(/\{[\s\S]*\}/);
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

                    // ★ 捕获 usage（一些API如Grok在常规chunk中返回usage，不只在最后）
                    if (data.usage) usage = data.usage;

                    var delta = data.choices?.[0]?.delta;
                    // 如果 delta 为空,跳过此条数据（但已捕获usage）
                    if (!delta) {
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
                                var currentArgs = typeof currentToolCall.function.arguments === 'string'
                                    ? currentToolCall.function.arguments
                                    : JSON.stringify(currentToolCall.function.arguments || '');
                                // 只保存有实际内容的tool call(跳过空/碎片)
                                var hasValidContent = currentArgs.length > 2 &&
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
                                    var newArg = tc.function.arguments;
                                    var isCompleteJSON = (newArg.trim().startsWith('{') && newArg.trim().endsWith('}')) ||
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
                                            var curTrimmed = currentToolCall.function.arguments.trim();
                                            var looksComplete = (curTrimmed.startsWith('{') && curTrimmed.endsWith('}')) ||
                                                                  (curTrimmed.startsWith('[') && curTrimmed.endsWith(']'));
                                            if (looksComplete) {
                                                // 已闭合成完整JSON,验证有效性
                                                let isValid = false;
                                                try { JSON.parse(curTrimmed); isValid = true; } catch(e) {}
                                                if (isValid) {
                                                    // ★ 修复: 立即保存到toolCalls并标记完成,防止后续重放覆盖
                                                    if (!toolCallCompleted) {
                                                        var savedCall = JSON.parse(JSON.stringify(currentToolCall));
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
                                                    var afterTrim = currentToolCall.function.arguments.trim();
                                                    if ((afterTrim.startsWith('{') && afterTrim.endsWith('}')) ||
                                                        (afterTrim.startsWith('[') && afterTrim.endsWith(']'))) {
                                                        try {
                                                            var parsed = JSON.parse(afterTrim);
                                                            var savedCall = JSON.parse(JSON.stringify(currentToolCall));
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
                    var hasReasoningDetails = delta.reasoning_details && Array.isArray(delta.reasoning_details);
                    // 普通 reasoning_content (排除空字符串MiniMax空chunk)
                    var hasReasoningContent = delta.reasoning_content !== undefined && delta.reasoning_content !== null && delta.reasoning_content !== '';

                    if (!placeholderCleared && (hasReasoningContent || hasReasoningDetails || delta.content !== undefined)) {
                        var currentBubble = activeBubbleMap[chatId];
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
                            var currentBubble = activeBubbleMap[chatId];
                            if (currentBubble) {
                                let details = currentBubble.querySelector('details.reasoning-details');
                                if (!details) {
                                    details = document.createElement('details');
                                    details.className = 'reasoning-details';
                                    details.open = true;
                                    details.innerHTML = `<summary>深度思考</summary><div class="reasoning-content"></div>`;
                                    var markdownBody = currentBubble.querySelector('.markdown-body');
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
                            var currentBubble = activeBubbleMap[chatId];
                            if (currentBubble) {
                                let details = currentBubble.querySelector('details.reasoning-details');
                                if (!details) {
                                    details = document.createElement('details');
                                    details.className = 'reasoning-details';
                                    details.open = true;
                                    details.innerHTML = `<summary>深度思考</summary><div class="reasoning-content"></div>`;
                                    var markdownBody = currentBubble.querySelector('.markdown-body');
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

                    var rawContent = delta.content ?? delta.text ?? delta.message?.content;
                    // 处理各种可能的数据类型,避免对象被错误地转为 [object Object]
                    let textContent = null;
                    if (rawContent !== undefined && rawContent !== null) {
                        if (typeof rawContent === 'string') {
                            textContent = rawContent;
                        } else if (typeof rawContent === 'object' && rawContent !== null) {
                            // ★ 修复: 不用 || 链式取值(空字符串 "" 是 falsy,会让 || 跳到下一项对象)
                            var st = (v) => (v !== null && v !== undefined && typeof v === 'string') ? v : null;
                            var ex = st(rawContent.text) || st(rawContent.content) || st(rawContent.value);
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

                        // ★ 实时提取 <think> 和 (think) 块到思考区
                        // ★ 关键修复: 只用完整闭合标签，不用 $ 兜底（流式中未闭合会导致全部内容被吞）
                        var _t = fullText;
                        var _allThink = '';
                        // 提取完整 <think>...</think> 标签（必须闭合）
                        var _matches = _t.match(/<think>([\s\S]*?)<\/think>/g);
                        if (_matches) {
                            for (var _mi = 0; _mi < _matches.length; _mi++) {
                                _allThink += _matches[_mi].replace(/<\/?think>/g, '');
                            }
                            _t = _t.replace(/<think>[\s\S]*?<\/think>/g, '');
                        }
                        // 提取完整 MiniMax (think)...(endthink) 格式（必须闭合）
                        var _matches2 = _t.match(/\(think\)([\s\S]*?)\(endthink\)/g);
                        if (_matches2) {
                            for (var _mi2 = 0; _mi2 < _matches2.length; _mi2++) {
                                _allThink += _matches2[_mi2].replace(/\(endthink\)/g, '').replace(/\(think\)/g, '');
                            }
                            _t = _t.replace(/\(think\)[\s\S]*?\(endthink\)/g, '');
                        }
                        // ★ 未闭合的 <think> 或 (think) — 正在流式传输中，只暂存到思考区，不破坏正文
                        var _openThink = _t.match(/<think>([\s\S]*?)$/) || _t.match(/\(think\)([\s\S]*?)$/);
                        if (_openThink) {
                            _allThink += _openThink[1];
                            _t = _t.replace(/<think>[\s\S]*$/, '').replace(/\(think\)[\s\S]*$/, '');
                        }
                        if (_allThink.trim()) {
                            reasoningText = _allThink.trim();
                            pendingMsg.reasoning = reasoningText;
                        }
                        pendingMsg.content = _t.trim() || (_allThink.trim() ? '' : fullText);
                        var _displayText = _t.trim();
                        // ★ MiniMax去重: 推理内容泄漏到正文中
                        var _rt = (reasoningText || '').trim();
                        if (_displayText && _rt && _rt.length > 20) {
                            // 1) 正文前缀匹配
                            if (_displayText.indexOf(_rt) === 0) {
                                _displayText = _displayText.substring(_rt.length).trim();
                            // 2) 正文前50%包含推理 → 模糊匹配
                            } else {
                                var _chunk = _displayText.substring(0, Math.floor(_displayText.length * 0.5));
                                for (var _rl = Math.min(_rt.length, 300); _rl > 30; _rl -= 10) {
                                    var _idx = _chunk.indexOf(_rt.substring(0, _rl));
                                    if (_idx >= 0 && _idx < 100) {
                                        _displayText = (_displayText.substring(0, _idx) + _displayText.substring(_idx + _rl)).trim();
                                        break;
                                    }
                                }
                            }
                            if (_displayText !== _t.trim()) pendingMsg.content = _displayText;
                        }
                        // ★ 如果正文为空但思考有内容,不显示空白气泡
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
        var currentBubble = activeBubbleMap[chatId];
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
    // ★ MiniMax思考去重: 思考内容可能在正文中重复出现, 移除正文中的思考前缀
    if (fullText && reasoningText && fullText.length > 20) {
        var _rtTrimmed = reasoningText.trim();
        var _ftTrimmed = fullText.trim();
        if (_rtTrimmed && _ftTrimmed.indexOf(_rtTrimmed) === 0) {
            fullText = _ftTrimmed.substring(_rtTrimmed.length).trim();
            pendingMsg.content = fullText;
            console.log('[MiniMax] 从正文中移除重复的思考内容(' + _rtTrimmed.length + ' chars)');
        } else if (_rtTrimmed && _ftTrimmed.length > _rtTrimmed.length * 0.5 && _ftTrimmed.indexOf(_rtTrimmed.substring(0, 100)) === 0) {
            // 部分匹配: 尝试找分界点
            var _overlap = 0;
            for (var _oi = Math.min(_rtTrimmed.length, 500); _oi > 50; _oi--) {
                if (_ftTrimmed.indexOf(_rtTrimmed.substring(0, _oi)) === 0) {
                    _overlap = _oi; break;
                }
            }
            if (_overlap > 50) {
                fullText = _ftTrimmed.substring(_overlap).trim();
                pendingMsg.content = fullText;
                console.log('[MiniMax] 从正文中移除部分重叠思考内容(overlap=' + _overlap + ' chars)');
            }
        }
        // ★ 更激进: 如果正文前1000字符内嵌了完整思考, 直接去除
        if (_rtTrimmed && _rtTrimmed.length > 30) {
            var _rtPos = _ftTrimmed.substring(0, Math.min(_ftTrimmed.length, 1000)).indexOf(_rtTrimmed);
            if (_rtPos > 0 && _rtPos < 500) {
                fullText = (_ftTrimmed.substring(0, _rtPos) + _ftTrimmed.substring(_rtPos + _rtTrimmed.length)).trim();
                pendingMsg.content = fullText;
                console.log('[MiniMax] 从正文中间移除内嵌的思考内容(pos=' + _rtPos + ')');
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
        var xmlRegex = /<minimax:tool_call>([\s\S]*?)<\/minimax:tool_call>/g;
        let xmlMatch;
        while ((xmlMatch = xmlRegex.exec(fullText)) !== null) {
            var invokeMatch = xmlMatch[1].match(/<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/);
            if (invokeMatch) {
                var funcName = invokeMatch[1];
                var args = {};
                var paramRegex = /<parameter name="([^"]+)">([^<]*)<\/parameter>/g;
                let pMatch;
                while ((pMatch = paramRegex.exec(invokeMatch[2])) !== null) {
                    var paramName = pMatch[1];
                    let paramValue = pMatch[2].trim();
                    try { paramValue = JSON.parse(paramValue); } catch(e) {}
                    args[paramName] = paramValue;
                }
                toolCalls.push({ id: 'call_mm_' + Date.now() + '_' + toolCalls.length, type: 'function', function: { name: funcName, arguments: JSON.stringify(args) } });
                console.log('[ToolCall] XML格式 提取:', funcName, args);
            }
        }

        // 格式2: [TOOL_CALL]\n{tool => "web_search", args => {--query "xxx"}}\n[/TOOL_CALL]
        var tcRegex = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"([^"]+)"[^}]*args\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\}[\s\S]*?\[\/TOOL_CALL\]/g;
        let tcMatch;
        while ((tcMatch = tcRegex.exec(fullText)) !== null) {
            var funcName = tcMatch[1];
            var argsBlock = tcMatch[2];
            var args = {};
            var paramRegex = /--(\w+)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/g;
            let pMatch;
            while ((pMatch = paramRegex.exec(argsBlock)) !== null) {
                var paramName = pMatch[1];
                var paramValue = pMatch[2] !== undefined ? pMatch[2] : (pMatch[3] !== undefined ? pMatch[3] : pMatch[4]);
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

    var choice = data.choices?.[0];
    if (!choice) {
        throw new Error('API 返回无有效 choices');
    }

    var msg = choice.message || {};
    var st = (v) => (v !== null && v !== undefined && typeof v === 'string') ? v : null;
    let fullText = '';
    var _generatedImages = [];  // ★ 提前声明,供 content 数组提取图片使用
    if (msg.content !== undefined && msg.content !== null) {
        if (typeof msg.content === 'string') {
            fullText = msg.content;
        } else if (typeof msg.content === 'object') {
            var ex = st(msg.content.text) || st(msg.content.content) || st(msg.content.value);
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
        var xmlRegex = /<minimax:tool_call>([\s\S]*?)<\/minimax:tool_call>/g;
        let xmlMatch;
        while ((xmlMatch = xmlRegex.exec(fullText)) !== null) {
            var invokeMatch = xmlMatch[1].match(/<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/);
            if (invokeMatch) {
                var funcName = invokeMatch[1];
                var args = {};
                var paramRegex = /<parameter name="([^"]+)">([^<]*)<\/parameter>/g;
                let pMatch;
                while ((pMatch = paramRegex.exec(invokeMatch[2])) !== null) {
                    var paramName = pMatch[1];
                    let paramValue = pMatch[2].trim();
                    try { paramValue = JSON.parse(paramValue); } catch(e) {}
                    args[paramName] = paramValue;
                }
                toolCalls.push({ id: 'call_mm_' + Date.now() + '_' + toolCalls.length, type: 'function', function: { name: funcName, arguments: JSON.stringify(args) } });
                console.log('[ToolCall非流式] XML格式 提取:', funcName, args);
            }
        }

        // 格式2: [TOOL_CALL]\n{tool => "web_search", args => {--query "xxx"}}\n[/TOOL_CALL]
        var tcRegex = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"([^"]+)"[^}]*args\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\}[\s\S]*?\[\/TOOL_CALL\]/g;
        let tcMatch;
        while ((tcMatch = tcRegex.exec(fullText)) !== null) {
            var funcName = tcMatch[1];
            var argsBlock = tcMatch[2];
            var args = {};
            var paramRegex = /--(\w+)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/g;
            let pMatch;
            while ((pMatch = paramRegex.exec(argsBlock)) !== null) {
                var paramName = pMatch[1];
                var paramValue = pMatch[2] !== undefined ? pMatch[2] : (pMatch[3] !== undefined ? pMatch[3] : pMatch[4]);
                args[paramName] = paramValue;
            }
            toolCalls.push({ id: 'call_mm_' + Date.now() + '_' + toolCalls.length, type: 'function', function: { name: funcName, arguments: JSON.stringify(args) } });
            console.log('[ToolCall非流式] TOOL_CALL格式 提取:', funcName, args);
        }

        fullText = fullText.replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, '').trim();
        fullText = fullText.replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g, '').trim();
    }

    var usage = data.usage;

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
        var rc = msg.reasoning_content ?? msg.reasoning;
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
        var markdownBody = currentBubble.querySelector('.markdown-body');
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
                var contentEl = document.createElement('div');
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
    var hasContent = pendingMsg && pendingMsg.content && typeof pendingMsg.content === 'string' && pendingMsg.content.trim() !== '';
    var hasReasoning = pendingMsg && pendingMsg.reasoning && typeof pendingMsg.reasoning === 'string' && pendingMsg.reasoning.trim() !== '';
    if (!hasContent && !hasReasoning) {
        var chatMessages = (chats && chats[chatId]) ? chats[chatId].messages : null;
        if (chatMessages) {
            var idx = chatMessages.findIndex(m => m.partial);
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
    var currentModel = getVal('modelSelect') || '';

    if (!currentModel) {
        return false;
    }

    // 将模型添加到文本模型列表
    try {
        var autoTextModels = JSON.parse(localStorage.getItem('autoDetectedTextModels') || '[]');
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
        var msgs = chats[chatId].messages;
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
        var lastUser = [...chats[chatId].messages].reverse().find(m => m.role === 'user' && !m.temporary);
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
