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

    async function _readSSE(sid, chatId, pendingMsg, isResume) {
        var url = _base + '/engine/chat/stream/' + encodeURIComponent(sid);
        var resp;
        try { resp = await fetch(url); } catch(e) { return null; }
        if (!resp.ok) { return null; }

        // ★ 已完成流返回JSON(非SSE) — 直接解析,避免TCP分片导致done事件丢失
        var _ct = resp.headers.get('content-type')||'';
        if (_ct.includes('json')) {
            try {
                var _jd = await resp.json();
                if (_jd && (_jd.full_text || (_jd.tool_calls && _jd.tool_calls.length > 0))) {
                    console.log('[RS] JSON快路径恢复, full_text长度:', (_jd.full_text||'').length);
                    return {fullText: _jd.full_text||'', reasoningText: _jd.reasoning_text||'',
                            usage: _jd.usage||null, toolCalls: _jd.tool_calls||[], completed: true};
                }
            } catch(e) { console.warn('[RS] JSON parse error:', e.message); }
            return null;
        }

        var reader;
        try { reader = resp.body.getReader(); } catch(e) { return null; }
        if (isResume) { showToast('🔄 续接流式...', 'info'); }

        var buf='', full='', reasoning='', tcList=[], usage=null, done=false, streamCompleted=false, readerEof=false;
        var _decoder = new TextDecoder();  // ★ 复用解码器，避免 UTF-8 多字节字符跨 chunk 损坏

        var timer = setInterval(function(){
            try { localStorage.setItem('_rs_ts', Date.now()); } catch(e) {}
            if (full||reasoning) {
                try { localStorage.setItem('_savedPartial', JSON.stringify({chatId:chatId, content:full, reasoning:reasoning, time:Date.now()})); } catch(e) {}
            }
        }, 500);

        while (!done) {
            if (Date.now() - (pendingMsg._rsStart || Date.now()) > 300000) break;
            var rr;
            try { rr = await reader.read(); } catch(e) { break; }
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
                            // ★ 实时剔除 <think> 块用于显示
                            var _display = full;
                            if (full.indexOf('<think>') !== -1) {
                                _display = full.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '');
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
                        tcList.push(d.function?d:d);
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
                        tcList.push(_rd.function ? _rd : _rd);
                    }
                    _remEv = '';
                } catch(e) {}
            }
        }
        // ★ 清理 <think> 标签：提取思考内容到 reasoning，从正文移除
        if (full) {
            var _thinkMatch = full.match(/<think>([\s\S]*?)<\/think>/g);
            if (_thinkMatch) {
                var _thinkText = '';
                for (var _ti = 0; _ti < _thinkMatch.length; _ti++) {
                    _thinkText += _thinkMatch[_ti].replace(/<\/?think>/g, '');
                }
                full = full.replace(/<think>[\s\S]*?<\/think>/g, '');
                if (_thinkText.trim() && !reasoning) reasoning = _thinkText.trim();
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
        return {fullText:full, reasoningText:reasoning, usage:usage, toolCalls:tcList, completed:streamCompleted};
    }

    return {
        create: async function(messages, config, chatId, pendingMsg) {
            if (_active[chatId]) return null;
            _active[chatId]=true;
            try {
                var _msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                var token = localStorage.getItem('authToken')||'';
                // ★ 传递代理配置到引擎，让子代理/可恢复流也走代理
                var _proxyEnabled = (window.isProxyEnabled && window.isProxyEnabled()) || false;
                var _proxyUrl = _proxyEnabled ? (window.getProxyUrl ? window.getProxyUrl() : '') : '';
                var cr = await fetch(_base+'/oneapichat/api/engine_api.php?action=chat_create', {
                    method:'POST',
                    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
                    body:JSON.stringify({
                        messages:messages, model:config.model, api_key:config.apiKey||'',
                        base_url:config.baseUrl||'', chat_id:chatId, msg_id: _msgId,
                        temperature:config.temp||0.7, max_tokens:config.tokens||4096,
                        tools:(config.tools&&config.tools.length)?config.tools:undefined,
                        proxy_enabled: _proxyEnabled, proxy_url: _proxyUrl
                    }),
                    signal:AbortSignal.timeout(15000)
                });
                if (!cr.ok) { return null; }
                var cd = await cr.json();
                var sid = cd.stream_id;
                var msgId = cd.msg_id || _msgId;
                if (!sid) { console.error('[RS] chat_create: no stream_id in response'); /*_clean_removed*/; return null; }
                console.log('[RS] stream created:', sid, 'msgId:', msgId);
                _saveState(sid, chatId, msgId);
                var _result = await _readSSE(sid, chatId, pendingMsg, false);
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
            console.log('[RS resume] Starting resume: chatId=' + chatId + ' sid=' + sid);
            _active[chatId] = true;
            var _isCurrentChat = (currentChatId === chatId);
            try {
                if (!chats[chatId]) { console.warn('[RS resume] Chat not found:', chatId); return false; }
                // ★ 强制清理旧partial数据(无论是否当前chat)
                var _beforeClean = chats[chatId].messages.length;
                chats[chatId].messages = chats[chatId].messages.filter(function(m) { return !m.partial; });
                if (chats[chatId].messages.length !== _beforeClean) {
                    console.log('[RS resume] 清理了 ' + (_beforeClean - chats[chatId].messages.length) + ' 条旧partial数据');
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
                // ★ 手动追加 assistant 气泡到 DOM 作为流式渲染目标
                if (_isCurrentChat && typeof appendMessage === 'function') {
                    var _bub = appendMessage('assistant', pm.content || '', null, pm.reasoning || '', null, null, true);
                    if (_bub) {
                        _bub.classList.add('typing');
                        activeBubbleMap[chatId] = _bub;
                    }
                }
                console.log('[RS resume] Before _readSSE — msgs count:', chats[chatId].messages.length);
                var result = await _readSSE(sid, chatId, pm, true);
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
                    console.log('[RS resume] SUCCESS — msgs count:', msgs.length, 'last 3 roles:', msgs.slice(-3).map(function(m){return m.role + (m.partial?'(partial)':'')}).join(', '));
                    // ★ 清除 _savedPartial: _readSSE的定时器可能已重新写入,
                    // 防止下方 loadChat 的旧版恢复逻辑读取它创建重复消息
                    try { localStorage.removeItem('_savedPartial'); } catch(e) {}
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
