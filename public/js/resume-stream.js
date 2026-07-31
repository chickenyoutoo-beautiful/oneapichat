// resume-stream.js — 可恢复流式模块 v2 (Phase 9 拆分自 main.js)
// ResumeStream.create / ResumeStream.resume — 刷新不丢 chunks

// ═══════════════════════════════════════════════════════════
// 可恢复流式模块 v2 — 极简设计，有 sid 就连，连不上拉倒
// ═══════════════════════════════════════════════════════════
window.ResumeStream = (function() {
    var _active = {};
    var _base = window.location.origin;

    function _saveState(sid, cid, msgId) {
        try {
            localStorage.setItem('_rs_sid', sid);
            localStorage.setItem('_rs_cid', cid);
            localStorage.setItem('_rs_ts', Date.now());
            if (msgId) localStorage.setItem('_rs_msgid', msgId);
        } catch(e) {}
    }

    function _cancelStream(sid) {
        if (!sid) return;
        // ★ 通知引擎后台生成线程停止(设置cancel标记), 否则用户停止后引擎仍继续生成
        try {
            fetch('/engine/chat/stream/' + encodeURIComponent(sid), { method: 'DELETE' }).catch(function(){});
        } catch(e) {}
    }

    function _getStopSignal(chatId) {
        try {
            if (typeof abortControllerMap !== 'undefined' && abortControllerMap && abortControllerMap[chatId] && abortControllerMap[chatId].signal) {
                return abortControllerMap[chatId].signal;
            }
        } catch(e) {}
        return null;
    }

    function _isUserStopped(chatId) {
        // userAbortMap 是顶层 let(全局词法作用域), 不是 window 属性, 用安全引用判断
        try {
            return !!(typeof userAbortMap !== 'undefined' && userAbortMap && userAbortMap[chatId]);
        } catch(e) { return false; }
    }

    async function _readSSE(sid, chatId, pendingMsg, isResume, stopSignal) {
        var url = '/engine/chat/stream/' + encodeURIComponent(sid);
        var resp;
        try {
            resp = await fetch(url, stopSignal ? { signal: stopSignal } : undefined);
        } catch(e) {
            // ★ 停止键: fetch被中止时返回aborted标记, 阻止main.js回退直连再次请求
            if (_isUserStopped(chatId)) {
                _cancelStream(sid);
                return {fullText:'', reasoningText:'', usage:null, toolCalls:[], completed:false, aborted:true};
            }
            return null;
        }
        if (!resp.ok) { return null; }
        // ★ 停止键: 响应已返回但已被中止(JSON快路径/未开始读取时)也要立即退出
        if (_isUserStopped(chatId) || (stopSignal && stopSignal.aborted)) {
            _cancelStream(sid);
            return {fullText:'', reasoningText:'', usage:null, toolCalls:[], completed:false, aborted:true};
        }

        // ★ 已完成流返回JSON(非SSE) — 直接解析,避免TCP分片导致done事件丢失
        var _ct = resp.headers.get('content-type')||'';
        if (_ct.includes('json')) {
            try {
                var _jd = await resp.json();
                if (_jd && (_jd.full_text || (_jd.tool_calls && _jd.tool_calls.length > 0))) {
                    console.log('[RS] JSON快路径恢复, full_text长度:', (_jd.full_text||'').length);
                    var _rsnJson = _jd.reasoning_text || '';
                    var _ftJson = _jd.full_text || '';
                    // ★ 清理内联 (think)...(endthink) 标签（引擎可能未提取 — MiniMax等内联思考格式）
                    var _tJson = _ftJson.match(/\(think\)([\s\S]*?)\(endthink\)/g);
                    if (_tJson) {
                        for (var _tj = 0; _tj < _tJson.length; _tj++) {
                            _rsnJson += _tJson[_tj].replace(/\(endthink\)/g, '').replace(/\(think\)/g, '');
                        }
                        _ftJson = _ftJson.replace(/\(think\)[\s\S]*?\(endthink\)/g, '');
                    }
                    // 未闭合 (think) 兜底
                    var _openJson = _ftJson.match(/\(think\)([\s\S]*?)$/);
                    if (_openJson && _openJson[1].length < 2000 && _openJson[1].length > 5) {
                        _rsnJson += _openJson[1];
                        _ftJson = _ftJson.replace(/\(think\)[\s\S]*$/, '');
                    }
                    // 去重: 正文前缀与思考重复
                    if (_rsnJson && _ftJson && _ftJson.indexOf(_rsnJson.trim()) === 0) {
                        _ftJson = _ftJson.substring(_rsnJson.trim().length).trim();
                    }
                    return {fullText: _ftJson.trim(), reasoningText: _rsnJson.trim(),
                            usage: _jd.usage||null, toolCalls: _jd.tool_calls||[], completed: true};
                }
            } catch(e) { console.warn('[RS] JSON parse error:', e.message); }
            return null;
        }

        var reader;
        try { reader = resp.body.getReader(); } catch(e) { return null; }
        if (isResume) { showToast('🔄 续接流式...', 'info'); }

        var buf='', full='', reasoning='', tcList=[], usage=null, done=false, streamCompleted=false, readerEof=false, streamError=null, aborted=false;
        var _decoder = new TextDecoder();  // ★ 复用解码器，避免 UTF-8 多字节字符跨 chunk 损坏

        var timer = setInterval(function(){
            try { localStorage.setItem('_rs_ts', Date.now()); } catch(e) {}
            if (full||reasoning) {
                try { localStorage.setItem('_savedPartial', JSON.stringify({chatId:chatId, content:full, reasoning:reasoning, time:Date.now()})); } catch(e) {}
            }
        }, 500);

        while (!done) {
            // ★ 停止键: 每轮读取前检查中止状态, 立即中断而不等模型思考完
            if (_isUserStopped(chatId) || (stopSignal && stopSignal.aborted)) {
                aborted = true;
                break;
            }
            if (Date.now() - (pendingMsg._rsStart || Date.now()) > 300000) break;
            var rr;
            try { rr = await reader.read(); } catch(e) {
                if (_isUserStopped(chatId) || (stopSignal && stopSignal.aborted)) aborted = true;
                break;
            }
            done = rr.done;
            if (rr.done) readerEof = true;  // ★ 记录是否收到EOF(引擎正常关闭连接)
            if (rr.value) buf += _decoder.decode(rr.value, {stream:true});
            var lines = buf.split('\n'); buf = lines.pop()||'';
            var ev = '';
            for (var i=0; i<lines.length; i++) {
                var ln = lines[i].trim();
                if (!ln) continue;
                if (ln.startsWith('event: ')) { ev = ln.substring(7); continue; }
                if (!ln.startsWith('data: ')) continue;
                var js = ln.substring(6); if (!js) continue;
                try {
                    var d = JSON.parse(js);
                    // ★ 引擎有2种SSE格式：_generate_resumable用event行(_ev)，_stream_openai_to_sse用JSON的type字段
                    var _evType = ev || (d.type || '');
                    if (_evType === 'content') {
                        var dl = d.delta||'';
                        if (dl) {
                            full+=dl;
                            pendingMsg.content=full;
                            // ★ 实时剔除闭合的 <think>/</think> 和 (think)/(endthink) 块
                            var _display = full;
                            // 格式1: <think>...</think> (大小写不敏感)
                            var _tRe1 = /<think>([\s\S]*?)<\/think>/gi;
                            if (_tRe1.test(full)) {
                                _display = full.replace(_tRe1, '');
                            }
                            // 格式2: MiniMax (think)...(endthink) (大小写不敏感)
                            var _tRe2 = /\(think\)([\s\S]*?)\(endthink\)/gi;
                            var _mtRS2 = _display.match(_tRe2);
                            if (_mtRS2) {
                                // ★ 去重: 如果之前 unclosed handler 已部分提取，closed handler 只追加新增部分
                                var _prevReasoningLen = reasoning.length;
                                for (var _mti3 = 0; _mti3 < _mtRS2.length; _mti3++) {
                                    var _extracted = _mtRS2[_mti3].replace(/\(endthink\)/gi, '').replace(/\(think\)/gi, '');
                                    // 检查是否与已提取的 reasoning 重叠
                                    if (reasoning && reasoning.length >= _extracted.length &&
                                        reasoning.substring(reasoning.length - _extracted.length) === _extracted) {
                                        // 完全相同 → unclosed 已提前全量提取, 跳过
                                    } else if (reasoning && reasoning.length > 0 && _extracted.indexOf(reasoning) === 0) {
                                        // 新提取的以旧 reasoning 为前缀 → 只追加新增部分
                                        reasoning = _extracted;
                                    } else if (reasoning && reasoning.length > 0 && _extracted.length > reasoning.length &&
                                               _extracted.substring(0, reasoning.length) === reasoning) {
                                        // 新提取的包含旧 reasoning → 替换为完整版
                                        reasoning = _extracted;
                                    } else {
                                        reasoning += _extracted;
                                    }
                                }
                                _display = _display.replace(_tRe2, '');
                                pendingMsg.reasoning = reasoning;
                            }
                            // 未闭合的 (think) — 流式传输中暂存不破坏正文
                            var _tRe3 = /\(think\)([\s\S]*?)$/i;
                            var _openRS2 = _display.match(_tRe3);
                            if (_openRS2 && _openRS2[1].length > 5 && _openRS2[1].length < 3000) {
                                reasoning += _openRS2[1];
                                _display = _display.replace(_tRe3, '');
                                pendingMsg.reasoning = reasoning;
                            }
                            // ★ 创建/更新思考块 DOM（从 content 中提取的 reasoning）
                            if (reasoning && currentChatId === chatId) {
                                var _bubRS = activeBubbleMap[chatId];
                                if (_bubRS) {
                                    var _detRS = _bubRS.querySelector('details.reasoning-details');
                                    if (!_detRS) {
                                        _detRS = document.createElement('details');
                                        _detRS.className = 'reasoning-details';
                                        _detRS.open = true;
                                        _detRS.innerHTML = '<summary>思考过程</summary><div class="reasoning-content"></div>';
                                        var _mbRS = _bubRS.querySelector('.markdown-body');
                                        if (_mbRS) _bubRS.insertBefore(_detRS, _mbRS);
                                    }
                                    var _rcRS = _detRS.querySelector('.reasoning-content');
                                    if (_rcRS) _rcRS.textContent = reasoning;
                                }
                            }
                            // ★ MiniMax 实时去重: 正文可能包含思考内容前缀
                            if (reasoning && _display.indexOf(reasoning) === 0) {
                                _display = _display.substring(reasoning.length).replace(/^[\s\n]+/, '');
                            } else if (reasoning && reasoning.length > 30 && _display.length > reasoning.length * 0.5) {
                                for (var _oi = Math.min(reasoning.length, 500); _oi > 30; _oi--) {
                                    if (_display.indexOf(reasoning.substring(0, _oi)) === 0) {
                                        _display = _display.substring(_oi).replace(/^[\s\n]+/, '');
                                        break;
                                    }
                                }
                            }
                            applyStreamRender(chatId, _display);
                        }
                    } else if (_evType === 'reasoning') {
                        var rd = d.delta||'';
                        if (rd) {
                            reasoning+=rd;
                            pendingMsg.reasoning=reasoning;
                            // ★ 实时创建/更新思考块 DOM（匹配 HTTP 直连路径的行为）
                            if (currentChatId === chatId) {
                                var _bub2 = activeBubbleMap[chatId];
                                if (_bub2) {
                                    var _det = _bub2.querySelector('details.reasoning-details');
                                    if (!_det) {
                                        _det = document.createElement('details');
                                        _det.className = 'reasoning-details';
                                        _det.open = true;
                                        _det.innerHTML = '<summary>思考过程</summary><div class="reasoning-content"></div>';
                                        var _mb2 = _bub2.querySelector('.markdown-body');
                                        if (_mb2) _bub2.insertBefore(_det, _mb2);
                                    }
                                    var _rc = _det.querySelector('.reasoning-content');
                                    if (_rc) _rc.textContent = reasoning;
                                }
                            }
                        }
                    } else if (_evType === 'tool_call' || d.function) {
                        // ★ 引擎现在发送合并后的{partial:true,tools:[...]}或单独的{function:...}
                        if (d.tools && Array.isArray(d.tools)) {
                            tcList = d.tools;  // 合并版,直接替换
                        } else if (d.function) {
                            tcList.push(d);
                        }
                    } else if (_evType === 'done' || d.full_text !== undefined) {
                        // ★ 优先用已累积的 full（可能比引擎 full_text 更完整）
                        if (d.full_text && d.full_text.length > full.length) full = d.full_text;
                        if (d.reasoning_text && d.reasoning_text.length > reasoning.length) reasoning = d.reasoning_text;
                        if (d.tool_calls) tcList=d.tool_calls;
                        if (d.usage) usage=d.usage;
                        done=true;
                        streamCompleted=true;  // ★ 真正收到done事件才算完成
                    } else if (_evType === 'error' || d.error) {
                        console.warn('[RS] stream error:', d.error);
                        streamError = d.error || 'stream error';
                        done=true;
                    } else if (d.delta && !d.full_text) {
                        // ★ 未知 type 但有 delta → 按 content 处理
                        var dl2 = d.delta||'';
                        if (dl2) { full+=dl2; pendingMsg.content=full; applyStreamRender(chatId, full); }
                    }
                    ev='';
                } catch(e) {}
            }
        }
        clearInterval(timer);
        if (aborted) {
            // ★ 用户停止: 通知引擎取消后台生成 + 返回aborted标记(不回退直连)
            _cancelStream(sid);
            try { cleanupStreamState(chatId); } catch(e) {}
            return {fullText:full, reasoningText:reasoning, usage:usage, toolCalls:[], completed:false, aborted:true};
        }
        // ★ 刷新缓冲区:流结束后处理buf中残留的SSE数据(跨chunk拆分)
        if (buf && buf.trim()) {
            var _remLines = buf.split('\n');
            var _remEv = '';
            for (var _rli = 0; _rli < _remLines.length; _rli++) {
                var _rln = _remLines[_rli].trim();
                if (!_rln) continue;
                if (_rln.startsWith('event: ')) { _remEv = _rln.substring(7); continue; }
                if (!_rln.startsWith('data: ')) continue;
                var _rjs = _rln.substring(6); if (!_rjs) continue;
                try {
                    var _rd = JSON.parse(_rjs);
                    var _revType = _remEv || (_rd.type || '');
                    if (_revType === 'done' || _rd.full_text !== undefined) {
                        if (_rd.full_text && _rd.full_text.length > full.length) full = _rd.full_text;
                        if (_rd.reasoning_text && _rd.reasoning_text.length > reasoning.length) reasoning = _rd.reasoning_text;
                        if (_rd.tool_calls) tcList = _rd.tool_calls;
                        if (_rd.usage) usage = _rd.usage;
                        streamCompleted = true;
                        console.log('[RS] 缓冲区中捕获延迟done事件');
                    } else if (_revType === 'content') {
                        var _rdl = _rd.delta || '';
                        if (_rdl) full += _rdl;
                    } else if (_revType === 'reasoning') {
                        var _rdr = _rd.delta || '';
                        if (_rdr) reasoning += _rdr;
                    } else if (_revType === 'tool_call' || _rd.function) {
                        if (_rd.tools && Array.isArray(_rd.tools)) { tcList = _rd.tools; }
                        else if (_rd.function) { tcList.push(_rd); }
                    }
                    _remEv = '';
                } catch(e) {}
            }
        }
        // ★ 清理 <think> 和 (think) 标签：提取思考内容到 reasoning，从正文移除
        if (full) {
            var _allThinkRS = '';
            // 格式1: <think>...</think> (DeepSeek r1 等)
            var _thinkMatch = full.match(/<think>([\s\S]*?)<\/think>/g);
            if (_thinkMatch) {
                for (var _ti = 0; _ti < _thinkMatch.length; _ti++) {
                    _allThinkRS += _thinkMatch[_ti].replace(/<\/?think>/g, '');
                }
                full = full.replace(/<think>[\s\S]*?<\/think>/g, '');
            }
            // 格式2: MiniMax (think)...(endthink)
            var _mtRS = full.match(/\(think\)([\s\S]*?)\(endthink\)/g);
            if (_mtRS) {
                for (var _mti = 0; _mti < _mtRS.length; _mti++) {
                    _allThinkRS += _mtRS[_mti].replace(/\(endthink\)/g, '').replace(/\(think\)/g, '');
                }
                full = full.replace(/\(think\)[\s\S]*?\(endthink\)/g, '');
            }
            // 未闭合 (think) 兜底
            var _openRS = full.match(/\(think\)([\s\S]*?)$/);
            if (_openRS && _openRS[1].length < 2000 && _openRS[1].length > 5) {
                _allThinkRS += _openRS[1];
                full = full.replace(/\(think\)[\s\S]*$/, '');
            }
            if (_allThinkRS.trim() && !reasoning) reasoning = _allThinkRS.trim();
            full = full.trim();

            // ★ MiniMax去重: 思考内容可能在正文中重复出现
            if (reasoning && full && full.length > 20) {
                var _rt2 = reasoning.trim();
                var _ft2 = full.trim();
                if (_rt2 && _ft2.indexOf(_rt2) === 0) {
                    full = _ft2.substring(_rt2.length).trim();
                } else if (_rt2 && _ft2.length > _rt2.length * 0.5) {
                    // 部分前缀重叠
                    for (var _oi = Math.min(_rt2.length, 500); _oi > 50; _oi--) {
                        if (_ft2.indexOf(_rt2.substring(0, _oi)) === 0) {
                            full = _ft2.substring(_oi).trim(); break;
                        }
                    }
                }
                // 正文中间内嵌思考
                if (_rt2.length > 30 && full && full.length > 0) {
                    var _rtPos = full.substring(0, Math.min(full.length, 1000)).indexOf(_rt2);
                    if (_rtPos > 0 && _rtPos < 500) {
                        full = (full.substring(0, _rtPos) + full.substring(_rtPos + _rt2.length)).trim();
                    }
                }
                // 开头的 (think) 标签残留
                if (full && /^\(think\)/i.test(full)) {
                    full = full.replace(/^\(think\)\s*/i, '').trim();
                }
            }
        }
        try { cleanupStreamState(chatId); } catch(e) {}
        // ★ 僵尸流修复: 引擎可能缓存了chunks但没写done事件(进程崩溃/超时/etc)
        // reader已EOF且有内容 → 虽然没有done事件,内容仍是完整的,应持久化
        if (!streamCompleted && readerEof && (full || tcList.length > 0)) {
            console.log('[RS] Stream EOF without done event — treating as complete (fullText=' + (full||'').length + ' chars, toolCalls=' + tcList.length + ')');
            streamCompleted = true;
        }
        // ★ 标记是否正常完成(收到done事件) — 未完成/错误的内容不应持久化
        return {fullText:full, reasoningText:reasoning, usage:usage, toolCalls:tcList, completed:streamCompleted, error:streamError};
    }

    // ★ 工具调用续接: 恢复的流返回tool_calls → 执行工具 → 交还sendMessage继续循环
    // 解决刷新后tool_calls被丢弃导致的输出中断+400问题(DeepSeek等)
    async function _resumeToolHandoff(toolCalls, pm, chatId, isCurrentChat) {
        try {
            if (!window.executeToolCallForRetry) {
                console.warn('[RS resume] executeToolCallForRetry 未加载,无法续接工具调用');
                return false;
            }
            // 标准化tool_calls(轻量版,与main.js normalize保持一致)
            var normalized = toolCalls.filter(function(tc){ return tc && tc.function && tc.function.name; }).map(function(tc){
                var argStr = typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments || {});
                try { JSON.parse(argStr); } catch(_eArgs) {
                    argStr = argStr.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
                    var _qc = (argStr.match(/"/g)||[]).length; if (_qc % 2 !== 0) argStr += '"';
                    var _ob = (argStr.match(/\{/g)||[]).length, _cb = (argStr.match(/\}/g)||[]).length;
                    while (_cb < _ob) { argStr += '}'; _cb++; } while (_ob < _cb) { argStr = '{' + argStr; _ob++; }
                    try { JSON.parse(argStr); } catch(_e2){ argStr = '{}'; }
                }
                var tcId = (tc.id || '').replace(/[^a-zA-Z0-9_\-]/g, '');
                if (!tcId || tcId.length > 64) tcId = 'tc_' + Date.now();
                var _norm = { id: tcId, type: tc.type || 'function', function: { name: tc.function.name, arguments: argStr } };
                // ★ 保留Gemini thought_signature(Google API要求回传否则400)
                if (tc.thought_signature) _norm.thought_signature = tc.thought_signature;
                if (tc.function.thought_signature) _norm.function.thought_signature = tc.function.thought_signature;
                return _norm;
            });
            pm.tool_calls = normalized;
            console.log('[RS resume] 工具续接: 执行 ' + normalized.length + ' 个工具调用');

            // 执行每个工具并追加结果到聊天历史
            var _body = { messages: [] };
            for (var _ti = 0; _ti < normalized.length; _ti++) {
                var tc = normalized[_ti];
                var toolRes = { error: null, result: null };
                try {
                    toolRes = await window.executeToolCallForRetry(tc, null, {
                        body: _body, pendingMsg: pm, chatId: chatId,
                        currentChatId: currentChatId, activeBubbleMap: activeBubbleMap, chats: chats
                    }) || { error: null, result: null };
                } catch(_te) { toolRes = { error: String(_te && _te.message || _te), result: null }; }
                var contentStr = toolRes.error || toolRes.result || '(empty)';
                contentStr = typeof contentStr === 'string' ? contentStr : JSON.stringify(contentStr);
                chats[chatId].messages.push({ role: 'tool', tool_call_id: tc.id || '', content: contentStr, _toolResult: true });
            }

            // ★ 最终化当前气泡(移除typing动画) — sendMessage会创建下一轮的新气泡
            if (isCurrentChat) {
                var _bub = activeBubbleMap[chatId];
                if (_bub) {
                    _bub.classList.remove('typing');
                    var _md = _bub.querySelector('.markdown-body');
                    if (_md && window._triggerPostRender) window._triggerPostRender(_md);
                }
            }

            slimSaveChats();
            saveChats();
            if (isCurrentChat) loadChat(chatId);

            // ★ 交还sendMessage继续工具循环(重建body.messages,处理Anthropic/链式/RS续传)
            if (typeof window.sendMessage === 'function') {
                console.log('[RS resume] 工具执行完毕,交还sendMessage继续循环');
                // 异步启动,不阻塞resume返回
                window.sendMessage(true).catch(function(_se){ console.warn('[RS resume] sendMessage续接错误:', _se.message); });
            }
            return true;
        } catch(_he) {
            console.warn('[RS resume] 工具续接异常:', _he.message);
            return false;
        }
    }

    return {
        // ★ 停止键: 取消当前chat的活跃可恢复流(通知引擎后台线程停止生成)
        cancelActive: function(chatId) {
            var sid = '';
            var cid = '';
            try { sid = localStorage.getItem('_rs_sid') || ''; } catch(e) {}
            try { cid = localStorage.getItem('_rs_cid') || ''; } catch(e) {}
            if (cid && cid !== 'pending' && chatId && cid !== chatId) return;
            _cancelStream(sid);
        },
        create: async function(messages, config, chatId, pendingMsg) {
            if (_active[chatId]) return null;
            _active[chatId]=true;
            var _stopSignal = _getStopSignal(chatId);   // ★ 停止键: 捕获当前请求的中止信号
            try {
                var _msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                var token = localStorage.getItem('authToken')||'';
                // ★ 传递代理配置到引擎，让子代理/可恢复流也走代理
                var _proxyEnabled = (window.isProxyEnabled && window.isProxyEnabled()) || false;
                var _proxyUrl = _proxyEnabled ? (window.getProxyUrl ? window.getProxyUrl() : '') : '';
                // ★ 用相对URL避免代理拦截同源请求
                // ★ 停止键: 创建阶段也接上中止信号(15s超时 + 用户停止), 避免停止后仍等创建完成
                var _createCtrl = new AbortController();
                var _createTimeout = setTimeout(function(){ _createCtrl.abort(); }, 15000);
                if (_stopSignal && typeof _stopSignal.addEventListener === 'function') {
                    _stopSignal.addEventListener('abort', function(){ _createCtrl.abort(); }, { once: true });
                }
                var cr = await fetch('/oneapichat/api/engine_api.php?action=chat_create', {
                    method:'POST',
                    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
                    body:JSON.stringify({
                        messages:messages, model:config.model, api_key:config.apiKey||'',
                        base_url:config.baseUrl||'', chat_id:chatId, msg_id: _msgId,
                        temperature:config.temp||0.7, max_tokens:config.tokens||4096,
                        tools:(config.tools&&config.tools.length)?config.tools:undefined,
                        proxy_enabled: _proxyEnabled, proxy_url: _proxyUrl,
                        // ★ Anthropic格式支持: 传递标志+端点URL,引擎走Anthropic Messages API流式
                        anthropic_format: config.anthropicFormat ? true : false,
                        anthropic_url: config.anthropicUrl || ''
                    }),
                    signal: _createCtrl.signal
                });
                clearTimeout(_createTimeout);
                if (!cr.ok) { return null; }
                var cd = await cr.json();
                var sid = cd.stream_id;
                var msgId = cd.msg_id || _msgId;
                if (!sid) { console.error('[RS] chat_create: no stream_id in response'); /*_clean_removed*/; return null; }
                console.log('[RS] stream created:', sid, 'msgId:', msgId);
                _saveState(sid, chatId, msgId);
                var _result = await _readSSE(sid, chatId, pendingMsg, false, _stopSignal);
                console.log('[RS] _readSSE result:', _result ? 'OK' : 'NULL');
                return _result;
            } catch(e) { /*_clean_removed*/; return null; }
            finally { delete _active[chatId]; }
        },

        // ★ 续接：尝试连接引擎流，连不上就返回 false
        // 可选 sid/msgId 参数（从引擎 active_tasks 恢复时传入）
        resume: async function(chatId, optSid, optMsgId) {
            var sid = optSid || '';
            if (!sid) {
                try { sid = localStorage.getItem('_rs_sid')||''; } catch(e) {}
            }
            if (!sid || sid.indexOf('pending_')===0) { console.warn('[RS resume] No valid sid:', sid); return false; }

            var scid = localStorage.getItem('_rs_cid')||'';
            if (scid && scid !== 'pending' && scid !== chatId) chatId = scid;

            var ts = parseInt(localStorage.getItem('_rs_ts')||'0');
            if (Date.now() - ts > 3600000) { console.warn('[RS resume] TTL expired for sid:', sid); return false; }

            if (_active[chatId]) { console.log('[RS resume] Already active for chat:', chatId); return false; }
            console.log('[RS resume] Starting resume: chatId=' + chatId + ' sid=' + sid + ' (msgs before cleanup=' + chats[chatId].messages.length + ')');
            _active[chatId] = true;
            var _isCurrentChat = (currentChatId === chatId);
            try {
                if (!chats[chatId]) { console.warn('[RS resume] Chat not found:', chatId); return false; }
                // ★ 强制清理旧partial+旧resume数据(避免新旧气泡并存)
                var _beforeClean = chats[chatId].messages.length;
                var _msgs = chats[chatId].messages;
                // 找到最后一个user消息的位置
                var _lastUserIdx = -1;
                for (var _lui = _msgs.length - 1; _lui >= 0; _lui--) {
                    if (_msgs[_lui].role === 'user') { _lastUserIdx = _lui; break; }
                }
                // 移除最后一个user之后的所有assistant(含旧resume: _recovered或partial)
                if (_lastUserIdx >= 0) {
                    var _removed = 0;
                    for (var _ri = _msgs.length - 1; _ri > _lastUserIdx; _ri--) {
                        if (_msgs[_ri].role === 'assistant') {
                            _msgs.splice(_ri, 1);
                            _removed++;
                        }
                    }
                    if (_removed > 0) console.log('[RS resume] 清理了最后user之后的 ' + _removed + ' 条旧assistant(含旧resume)');
                }
                // 再清理所有残余partial(兜底)
                chats[chatId].messages = chats[chatId].messages.filter(function(m) { return !m.partial; });
                if (chats[chatId].messages.length !== _beforeClean) {
                    console.log('[RS resume] 清理了 ' + (_beforeClean - chats[chatId].messages.length) + ' 条旧数据');
                }
                // ★ 无条件清理DOM并重渲染(即使非当前chat也清理容器)
                if (_isCurrentChat) {
                    loadChat(chatId);
                } else if ($.chatMessagesContainer && currentChatId) {
                    slimSaveChats();
                }
                console.log('[RS resume] After loadChat cleanup — msgs count:', chats[chatId].messages.length);
                await new Promise(function(r) { setTimeout(r, 150); });
                var msgs = chats[chatId].messages;
                var pm = msgs.find(function(m){return m.partial;});
                if (!pm) {
                    pm = {role:'assistant',content:'',reasoning:'',partial:true,_recovered:true};
                    var sp = JSON.parse(localStorage.getItem('_savedPartial')||'null');
                    if (sp && sp.content) pm.content = sp.content;
                    if (sp && sp.reasoning) pm.reasoning = sp.reasoning;
                    msgs.push(pm);
                }
                // ★ 标记正在生成(控制按钮/UI状态)
                isTypingMap[chatId] = true;
                // ★ 重置滚动状态: 确保流式生成期间自动跟随底部
                userScrolled = false;
                streamingScrollLock = false;
                // ★ 更新按钮状态: 流式生成中应显示停止键
                if (_isCurrentChat) {
                    if ($.sendBtn) $.sendBtn.classList.add('hidden');
                    if ($.stopBtn) { $.stopBtn.classList.remove('hidden'); $.stopBtn.classList.add('visible'); }
                    window._updateQueueUI();
                    // ★ 初始滚动到底部
                    setTimeout(function() { if ($.chatBox) $.chatBox.scrollTop = $.chatBox.scrollHeight; }, 50);
                }
                // ★ 手动追加 assistant 气泡到 DOM 作为流式渲染目标
                if (_isCurrentChat && typeof appendMessage === 'function') {
                    var _bub = appendMessage('assistant', pm.content || '', null, pm.reasoning || '', null, null, true);
                    if (_bub) {
                        _bub.classList.add('typing');
                        activeBubbleMap[chatId] = _bub;
                    }
                }
                console.log('[RS resume] Before _readSSE — msgs count:', chats[chatId].messages.length);
                var result = await _readSSE(sid, chatId, pm, true, _getStopSignal(chatId));
                console.log('[RS resume] After _readSSE — msgs count:', chats[chatId].messages.length);
                console.log('[RS resume] _readSSE returned:', result ? ('fullText=' + (result.fullText||'').substring(0,80) + ' toolCalls=' + (result.toolCalls||[]).length) : 'NULL');
                isTypingMap[chatId] = false;
                await new Promise(function(r) { setTimeout(r, 50); });
                if (result && result.completed && (result.fullText || result.toolCalls.length > 0)) {
                    delete pm.partial;
                    pm.content = result.fullText || pm.content || '';
                    pm.reasoning = result.reasoningText || '';
                    pm.usage = result.usage;
                    pm.time = Date.now();  // ★ 关键: 设置time防止被隐形截断检测误删
                    // ★ 清除 _savedPartial: _readSSE的定时器可能已重新写入,
                    // 防止下方 loadChat 的旧版恢复逻辑读取它创建重复消息
                    try { localStorage.removeItem('_savedPartial'); } catch(e) {}

                    // ★ 工具调用续接: 恢复的流返回tool_calls时,执行工具并交还sendMessage继续循环
                    if (result.toolCalls && result.toolCalls.length > 0) {
                        var _handedOff = await _resumeToolHandoff(result.toolCalls, pm, chatId, _isCurrentChat);
                        if (_handedOff) return true;
                    }

                    console.log('[RS resume] SUCCESS — msgs count:', msgs.length, 'last 3 roles:', msgs.slice(-3).map(function(m){return m.role + (m.partial?'(partial)':'')}).join(', '));
                    slimSaveChats();
                    saveChats();
                    // ★ 无论是否当前chat都刷新: 清除旧气泡+渲染完成消息
                    if (_isCurrentChat) loadChat(chatId);
                    return true;
                }
                // ★ 流未完成 — 保持 partial 状态,丢弃临时气泡
                console.warn('[RS resume] 流未正常完成,保持partial');
                var fi = msgs.findIndex(function(m){return m.partial && m._recovered;});
                if (fi !== -1) msgs.splice(fi, 1);
                // ★ 未完成也刷新DOM: 清除残留的截断气泡
                if (_isCurrentChat) loadChat(chatId);
                return false;
            } catch(e) {
                console.warn('[RS resume] error:', e.message);
                isTypingMap[chatId] = false;
                // ★ 异常也刷新DOM
                if (_isCurrentChat) loadChat(chatId);
                return false;
            }
            finally {
                delete _active[chatId];
            }
        }
    };
})();
const ResumeStream = window.ResumeStream;
