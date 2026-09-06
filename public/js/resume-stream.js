// resume-stream.js — 可恢复流式模块 v2 (Phase 9 拆分自 main.js)
// ResumeStream.create / ResumeStream.resume — 刷新不丢 chunks

// ═══════════════════════════════════════════════════════════
// 可恢复流式模块 v2 — 极简设计，有 sid 就连，连不上拉倒
// ═══════════════════════════════════════════════════════════
window.ResumeStream = (function() {
    var _active = {};
    // RS 的“用户停止”信号必须独立于 main.js 的 HTTP AbortController。
    // 工具结果交还 sendMessage(true) 时，sendMessage 会 abortExistingRequest() 清理旧 HTTP
    // controller；若两者共用 signal，就会把刚创建的下一条 RS 流误判为用户停止。
    var _stopControllers = {};
    var _base = window.location.origin;
    var _STATE_KEY = '_rs_state_v3';
    // Keep browser recovery state for exactly the engine's resumable-stream window.
    // Engine active_tasks remains authoritative after a full reload, but a shorter client
    // TTL used to abandon healthy LongCat/deep-thinking streams after 10 minutes.
    var _STATE_TTL = 30 * 60 * 1000;
    var _stateBook = null;
    var _stateWriteTimers = {};
    var _transientRetryCount = {};  // ★ 瞬态错误重试计数 per-chatId
    var _MAX_RECONNECT_ATTEMPTS = 24;
    // This guards only the acknowledgement of chat_create. It deliberately does not
    // inherit the direct-provider request timeout: once accepted, the durable engine
    // job must keep running and be recovered rather than silently cancelled.
    var _CREATE_ACK_TIMEOUT_MS = 30000;

    function _normalizeResumeResult(result) {
        if (!result || typeof result !== 'object') {
            return { fullText: '', reasoningText: '', usage: null, toolCalls: [], completed: false };
        }
        result.fullText = typeof result.fullText === 'string' ? result.fullText : (typeof result.full_text === 'string' ? result.full_text : '');
        result.reasoningText = typeof result.reasoningText === 'string' ? result.reasoningText : (typeof result.reasoning_text === 'string' ? result.reasoning_text : '');
        if (result.error && typeof result.error === 'object') {
            var _errObj = result.error;
            result.errorCode = result.errorCode || _errObj.code || '';
            result.errorDetails = result.errorDetails || _errObj.details || null;
            result.error = String(_errObj.message || _errObj.detail || JSON.stringify(_errObj));
        } else if (result.error !== undefined && result.error !== null) {
            result.error = String(result.error);
        }
        if (!Array.isArray(result.toolCalls)) {
            result.toolCalls = Array.isArray(result.tool_calls) ? result.tool_calls : [];
        }
        if (!Array.isArray(result.toolCalls)) result.toolCalls = [];
        return result;
    }

    async function _parseHttpError(response, fallback) {
        var payload = null;
        var text = '';
        try { text = await response.text(); } catch(e) {}
        if (text) {
            try { payload = JSON.parse(text); } catch(e) {}
        }
        var raw = payload && (payload.error || payload.detail || payload.message);
        if (raw && typeof raw === 'object') {
            return {
                message: raw.message || JSON.stringify(raw),
                code: raw.code || payload.code || '',
                details: raw.details || payload.details || null
            };
        }
        return {
            message: String(raw || (payload && payload.message) || text || fallback || ('HTTP ' + response.status)).substring(0, 4000),
            code: String((payload && payload.code) || ''),
            details: payload && payload.details || null
        };
    }

    // ★ 判断是否为可自动重试的瞬态错误(上游临时不可用,可能自行恢复)
    function _isRetriableError(error) {
        if (!error) return false;
        var errStr = typeof error === 'string' ? error : JSON.stringify(error);
        // 503 auth_unavailable — CLIProxyAPI 认证临时不可用(token 刷新/提供商轮换可能恢复)
        if (errStr.indexOf('auth_unavailable') !== -1 && errStr.indexOf('503') !== -1) return true;
        // 503 service_unavailable
        if (errStr.indexOf('503') !== -1 && errStr.indexOf('service_unavailable') !== -1) return true;
        // 429 rate limit
        if (errStr.indexOf('429') !== -1 || errStr.indexOf('rate_limit') !== -1) return true;
        // 502/504 gateway errors
        if (errStr.indexOf('502') !== -1 || errStr.indexOf('504') !== -1) return true;
        // ★ EOF / 连接中断 — 长任务通过代理时常见的瞬态错误(连接被意外关闭)
        if (errStr.indexOf('EOF') !== -1 || errStr.indexOf('ECONNRESET') !== -1 ||
            errStr.indexOf('ECONNREFUSED') !== -1 || errStr.indexOf('ETIMEDOUT') !== -1 ||
            errStr.indexOf('socket hang up') !== -1 || errStr.indexOf('socket_hang_up') !== -1 ||
            errStr.indexOf('aborted') !== -1 || errStr.indexOf('network error') !== -1) return true;
        // 500 internal_server_error — 可能是上游临时故障(结合 EOF 出现时更可能是瞬态)
        if (errStr.indexOf('500') !== -1 && (errStr.indexOf('EOF') !== -1 || errStr.indexOf('internal_server_error') !== -1)) return true;
        return false;
    }

    // ★ 判断是否为连接类错误(需要更长重试延迟和更多重试次数)
    function _isConnectionError(error) {
        if (!error) return false;
        var errStr = typeof error === 'string' ? error : JSON.stringify(error);
        return errStr.indexOf('EOF') !== -1 || errStr.indexOf('ECONNRESET') !== -1 ||
            errStr.indexOf('ECONNREFUSED') !== -1 || errStr.indexOf('ETIMEDOUT') !== -1 ||
            errStr.indexOf('socket hang up') !== -1 || errStr.indexOf('socket_hang_up') !== -1 ||
            errStr.indexOf('aborted') !== -1 || errStr.indexOf('network error') !== -1;
    }

    function _clone(value) {
        try { return JSON.parse(JSON.stringify(value)); } catch(e) { return value; }
    }

    function _cleanEmptyPlaceholder(s) {
        if (!s) return '';
        return String(s).replace(/\(empty\)/gi, '').trim();
    }

    // A tool round can contain visible assistant text before the tool call. The
    // following model round must extend that same bubble, not replace it with
    // only the post-tool response (or append a replayed prefix twice).
    function _mergeAssistantStreamText(base, next) {
        base = _cleanEmptyPlaceholder(base);
        next = _cleanEmptyPlaceholder(next);
        if (!base) return next;
        if (!next || next === base) return base;
        if (next.indexOf(base) === 0) return next;
        if (base.indexOf(next) === 0) return base;

        // Gateways occasionally replay the beginning of the next response. Find
        // the largest suffix/prefix overlap before appending the genuinely new
        // text. A short overlap is intentionally ignored: normal prose often
        // starts with common words and must not be silently removed.
        var max = Math.min(base.length, next.length);
        for (var overlap = max; overlap >= 8; overlap--) {
            if (base.slice(base.length - overlap) === next.slice(0, overlap)) {
                return base + next.slice(overlap);
            }
        }
        return base + (/\s$/.test(base) || /^\s/.test(next) ? '' : '\n\n') + next;
    }
    window.mergeAssistantStreamText = _mergeAssistantStreamText;

    function _loadStateBook() {
        if (_stateBook) return _stateBook;
        var parsed = null;
        try { parsed = JSON.parse(localStorage.getItem(_STATE_KEY) || 'null'); } catch(e) {}
        if (!parsed || parsed.version !== 3 || !parsed.chats || typeof parsed.chats !== 'object') {
            parsed = { version: 3, chats: {} };
        }
        var now = Date.now();
        var uid = '';
        try { uid = localStorage.getItem('authUserId') || ''; } catch(e) {}
        Object.keys(parsed.chats).forEach(function(cid) {
            var st = parsed.chats[cid];
            if (!st || now - (st.updatedAt || 0) > _STATE_TTL || (st.userId && uid && st.userId !== uid)) {
                delete parsed.chats[cid];
                return;
            }
            st.content = typeof st.content === 'string' ? st.content : (st.content == null ? '' : String(st.content));
            st.reasoning = typeof st.reasoning === 'string' ? st.reasoning : (st.reasoning == null ? '' : String(st.reasoning));
            st.toolCalls = Array.isArray(st.toolCalls) ? st.toolCalls : [];
            st.tools = Array.isArray(st.tools) ? st.tools : [];
            st.tools.forEach(function(tool) {
                if (tool && tool.result != null && typeof tool.result !== 'string') {
                    try { tool.result = JSON.stringify(tool.result); } catch(e) { tool.result = String(tool.result); }
                }
            });
        });
        _stateBook = parsed;
        return _stateBook;
    }

    function _writeStateBook() {
        var book = _loadStateBook();
        try {
            localStorage.setItem(_STATE_KEY, JSON.stringify(book));
        } catch(e) {
            // 配额兜底：工具结果已另存聊天历史，恢复日志仅保留必要状态。
            try {
                var slim = { version: 3, chats: {} };
                Object.keys(book.chats).slice(-4).forEach(function(cid) {
                    var st = _clone(book.chats[cid]);
                    if (st.content && st.content.length > 120000) st.content = st.content.substring(0, 120000);
                    if (st.reasoning && st.reasoning.length > 60000) st.reasoning = st.reasoning.substring(0, 60000);
                    (st.tools || []).forEach(function(t) {
                        if (typeof t.result === 'string' && t.result.length > 20000) t.result = t.result.substring(0, 20000) + '\n...(恢复日志已截断)';
                    });
                    slim.chats[cid] = st;
                });
                _stateBook = slim;
                localStorage.setItem(_STATE_KEY, JSON.stringify(slim));
            } catch(_ignored) {}
        }
    }

    function _persistState(st, immediate) {
        if (!st || !st.chatId) return;
        st.updatedAt = Date.now();
        _loadStateBook().chats[st.chatId] = st;
        if (immediate) {
            if (_stateWriteTimers[st.chatId]) clearTimeout(_stateWriteTimers[st.chatId]);
            delete _stateWriteTimers[st.chatId];
            _writeStateBook();
            return;
        }
        if (_stateWriteTimers[st.chatId]) return;
        _stateWriteTimers[st.chatId] = setTimeout(function() {
            delete _stateWriteTimers[st.chatId];
            _writeStateBook();
        }, 120);
    }

    function _getState(chatId) {
        var st = _loadStateBook().chats[chatId];
        if (!st) {
            // 从 v2 单值键无损迁移，兼容升级前已经在运行的流。
            try {
                var legacyCid = localStorage.getItem('_rs_cid') || '';
                var legacySid = localStorage.getItem('_rs_sid') || '';
                var legacyMsgId = localStorage.getItem('_rs_msgid') || '';
                var legacyTs = parseInt(localStorage.getItem('_rs_ts') || '0');
                if (legacySid && legacyCid === chatId && Date.now() - legacyTs <= _STATE_TTL &&
                    localStorage.getItem('_streamStopped_' + chatId) !== '1') {
                    var partial = null;
                    try { partial = JSON.parse(localStorage.getItem('_savedPartial') || 'null'); } catch(e) {}
                    st = {
                        version:3, chatId:chatId, sid:legacySid, msgId:legacyMsgId,
                        userId:localStorage.getItem('authUserId') || '', phase:'streaming',
                        content:partial && partial.chatId === chatId ? (partial.content || '') : '',
                        reasoning:partial && partial.chatId === chatId ? (partial.reasoning || '') : '',
                        toolCalls:partial && partial.chatId === chatId && Array.isArray(partial.toolCalls) ? partial.toolCalls : [],
                        tools:[], createdAt:legacyTs || Date.now(), updatedAt:legacyTs || Date.now()
                    };
                    _persistState(st, true);
                }
            } catch(e) {}
        }
        if (!st) return null;
        var uid = '';
        try { uid = localStorage.getItem('authUserId') || ''; } catch(e) {}
        if ((st.userId && uid && st.userId !== uid) || Date.now() - (st.updatedAt || 0) > _STATE_TTL) {
            delete _loadStateBook().chats[chatId];
            _writeStateBook();
            return null;
        }
        return st;
    }

    function _clearState(chatId) {
        if (!chatId) return;
        var book = _loadStateBook();
        delete book.chats[chatId];
        if (_stateWriteTimers[chatId]) clearTimeout(_stateWriteTimers[chatId]);
        delete _stateWriteTimers[chatId];
        _writeStateBook();
        try {
            var legacyCid = localStorage.getItem('_rs_cid') || '';
            if (!legacyCid || legacyCid === chatId) {
                localStorage.removeItem('_rs_sid');
                localStorage.removeItem('_rs_cid');
                localStorage.removeItem('_rs_msgid');
                localStorage.removeItem('_rs_ts');
            }
        } catch(e) {}
    }

    function _toolId(tc, index) {
        return (tc && tc.id) || ('tool_' + index);
    }

    function _toolPreview(tc) {
        try {
            var raw = tc && tc.function ? tc.function.arguments : '';
            var args = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
            var keys = Object.keys(args);
            return keys.length ? String(args[keys[0]] == null ? '' : args[keys[0]]).substring(0, 80) : '';
        } catch(e) {
            return String(tc && tc.function && tc.function.arguments || '').substring(0, 80);
        }
    }

    function _findPendingMessage(chatId, st) {
        var msgs = chats[chatId] && chats[chatId].messages;
        if (!msgs) return null;
        // 只允许按本轮的持久身份复用 assistant。不能仅凭 tool_call_id
        // 在历史中猜测目标，否则旧流与新流可能共享 ID 并发生跨轮串接。
        var hasIdentity = !!(st.msgId || st.sid);
        if (hasIdentity) {
            for (var exact = msgs.length - 1; exact >= 0; exact--) {
                var candidate = msgs[exact];
                if (!candidate || candidate.role !== 'assistant') continue;
                if (st.msgId && candidate._rsMsgId !== st.msgId) continue;
                if (st.sid && candidate._rsStreamId !== st.sid) continue;
                return candidate;
            }
            // 找不到精确身份时由调用方创建新的 assistant turn，绝不回退到历史 partial。
            return null;
        }
        // 无任何身份的旧状态无法证明属于当前后台流，也不自动挂到历史消息。
        return null;
    }

    function _renderObserverToolTimeline(chatId, pendingMsg, toolCalls, settled) {
        if (currentChatId !== chatId || !pendingMsg || !pendingMsg._remoteObserver) return;
        var bubble = activeBubbleMap[chatId];
        if (!bubble || !Array.isArray(toolCalls)) return;
        var seen = {};
        toolCalls.forEach(function(tc, index) {
            if (!tc || !tc.function || !tc.function.name) return;
            var id = tc.id || ('observer_tool_' + index + '_' + tc.function.name);
            if (seen[id]) return;
            seen[id] = true;
            var args = tc.function.arguments;
            var preview = '';
            try {
                var parsed = typeof args === 'string' ? JSON.parse(args || '{}') : (args || {});
                preview = parsed.command || parsed.file_path || parsed.path || parsed.query || parsed.keywords || parsed.q || parsed.url || '';
            } catch(e) { preview = typeof args === 'string' ? args.substring(0, 80) : ''; }
            if (typeof showToolStatus === 'function') {
                showToolStatus(tc.function.name, preview, settled ? 'success' : 'running', chatId, id);
            }
        });
        if (settled && typeof showToolStatus === 'function') showToolStatus('', '', null, chatId, '');
    }

    function _renderReasoning(chatId, reasoning) {
        if (!reasoning || currentChatId !== chatId) return;
        var bubble = activeBubbleMap[chatId];
        if (!bubble) return;
        var details = bubble.querySelector('details.reasoning-details');
        if (!details) {
            details = document.createElement('details');
            details.className = 'reasoning-details';
            details.open = true;
            details.innerHTML = '<summary>思考过程</summary><div class="reasoning-content"></div>';
            var markdown = bubble.querySelector('.markdown-body');
            if (markdown) bubble.insertBefore(details, markdown);
        }
        var content = details.querySelector('.reasoning-content');
        if (content) content.textContent = reasoning;
    }

    function _hydrateState(chatId) {
        var st = _getState(chatId);
        if (!st || currentChatId !== chatId) return false;
        var pm = _findPendingMessage(chatId, st);
        if (pm) {
            if (st.content !== undefined) pm.content = st.content || pm.content || '';
            if (st.reasoning !== undefined) pm.reasoning = st.reasoning || pm.reasoning || '';
            pm._rsMsgId = st.msgId || pm._rsMsgId;
            pm._rsStreamId = st.sid || pm._rsStreamId;
        }
        if (st.content && activeBubbleMap[chatId] && typeof applyStreamRender === 'function') {
            applyStreamRender(chatId, st.content);
        }
        _renderReasoning(chatId, st.reasoning || '');

        var activeTool = null;
        var records = Array.isArray(st.tools) ? st.tools : [];
        for (var i = 0; i < records.length; i++) {
            if (records[i].status === 'running') { activeTool = records[i]; break; }
        }
        if (!activeTool) {
            for (var j = 0; j < records.length; j++) {
                if (records[j].status === 'pending') { activeTool = records[j]; break; }
            }
        }
        if (!activeTool && st.phase === 'streaming' && Array.isArray(st.toolCalls) && st.toolCalls.length) {
            var partial = st.toolCalls[st.toolCalls.length - 1];
            activeTool = {
                id: _toolId(partial, st.toolCalls.length - 1),
                name: partial.function && partial.function.name || '工具调用',
                preview: _toolPreview(partial)
            };
        }
        if (activeTool && typeof showToolStatus === 'function') {
            showToolStatus(activeTool.name || '工具调用', activeTool.preview || '', 'running', chatId, activeTool.id || '');
        }
        return true;
    }

    // ★ 容错修复工具参数JSON(与 main.js/tools-exec.js 一致): 健壮保留长代码/HTML/CSS/JS中的引号与花括号，安全处理换行与截断
    function _repairToolArguments(raw) {
        if (typeof raw !== 'string') return '{}';
        var trimmed = raw.trim();
        if (!trimmed) return '{}';
        try { JSON.parse(trimmed); return trimmed; } catch (e) {}

        var work = trimmed.replace(/^\{\s*,/, '{').replace(/,\s*\}$/, '}').replace(/,\s*,/g, ',');
        try { JSON.parse(work); return work; } catch (e) {}

        var out = '', inString = false;
        for (var i = 0; i < work.length; i++) {
            var c = work[i];
            if (c === '\\' && inString) {
                out += c;
                if (i + 1 < work.length) { out += work[i + 1]; i++; }
                continue;
            }
            if (c === '"') {
                inString = !inString;
                out += c;
                continue;
            }
            if (inString) {
                if (c === '\n') { out += '\\n'; continue; }
                if (c === '\r') { out += '\\r'; continue; }
                if (c === '\t') { out += '\\t'; continue; }
                if (c.charCodeAt(0) < 32) { out += ' '; continue; }
            }
            out += c;
        }
        try { JSON.parse(out); return out; } catch (e) {}

        var text = out;
        if (inString) text += '"';
        text = text.replace(/,\s*$/, '').replace(/:\s*$/, ': null');

        var stack = [], inStr2 = false;
        for (var j = 0; j < text.length; j++) {
            var ch = text[j];
            if (ch === '\\' && inStr2) { j++; continue; }
            if (ch === '"') { inStr2 = !inStr2; continue; }
            if (!inStr2) {
                if (ch === '{' || ch === '[') stack.push(ch);
                else if (ch === '}' && stack.length && stack[stack.length - 1] === '{') stack.pop();
                else if (ch === ']' && stack.length && stack[stack.length - 1] === '[') stack.pop();
            }
        }
        if (inStr2) text += '"';
        while (stack.length > 0) {
            var open = stack.pop();
            text += (open === '{' ? '}' : ']');
        }
        try { JSON.parse(text); return text; } catch (e) {}
        return text;
    }

    function _saveState(sid, cid, msgId) {
        try {
            localStorage.setItem('_rs_sid', sid);
            localStorage.setItem('_rs_cid', cid);
            localStorage.setItem('_rs_ts', Date.now());
            if (msgId) localStorage.setItem('_rs_msgid', msgId);
        } catch(e) {}
        var st = {
            version: 3,
            chatId: cid,
            sid: sid,
            msgId: msgId || '',
            userId: (function(){ try { return localStorage.getItem('authUserId') || ''; } catch(e) { return ''; } })(),
            phase: 'streaming',
            content: '',
            reasoning: '',
            toolCalls: [],
            tools: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        _persistState(st, true);
        return st;
    }

    function _cancelStream(sid, msgId) {
        if (!sid && !msgId) return;
        // ★ 通知引擎后台生成线程停止(设置cancel标记), 否则用户停止后引擎仍继续生成
        try {
            var token = (typeof getAuthToken === 'function' ? getAuthToken() : null) || localStorage.getItem('authToken') || '';
            var uid = localStorage.getItem('authUserId') || '';
            var cancelSid = sid || 'pending';
            var cancelUrl = '/engine/chat/stream/' + encodeURIComponent(cancelSid);
            var params = [];
            if (msgId) params.push('msg_id=' + encodeURIComponent(msgId));
            if (token) params.push('auth_token=' + encodeURIComponent(token));
            if (uid) params.push('user_id=' + encodeURIComponent(uid));
            if (params.length) cancelUrl += '?' + params.join('&');
            var headers = {};
            if (token) headers['Authorization'] = 'Bearer ' + token;
            fetch(cancelUrl, { method: 'DELETE', headers: headers }).catch(function(){});
        } catch(e) {}
    }

    function _getStopSignal(chatId) {
        if (!chatId) return null;
        var current = _stopControllers[chatId];
        if (!current || current.signal.aborted) {
            current = new AbortController();
            _stopControllers[chatId] = current;
        }
        return current.signal;
    }

    function _releaseStopSignal(chatId, controller) {
        if (!chatId) return;
        if (!controller || _stopControllers[chatId] === controller) delete _stopControllers[chatId];
    }

    function _isUserStopped(chatId) {
        // userAbortMap 是顶层 let(全局词法作用域), 不是 window 属性, 用安全引用判断。
        // AbortController 只负责断开本地 reader；只有这个显式用户动作标志允许向后端 DELETE。
        try {
            return !!(typeof userAbortMap !== 'undefined' && userAbortMap && userAbortMap[chatId]);
        } catch(e) { return false; }
    }

    function _abortLocalReader(chatId) {
        var controller = _stopControllers[chatId];
        if (!controller) return;
        try { controller.abort(); } catch(e) {}
        if (_stopControllers[chatId] === controller) delete _stopControllers[chatId];
    }

    function _updateStreamingState(chatId, pendingMsg, fields, immediate) {
        // 观察端仅做内存/DOM镜像，绝不写入该设备持久状态；否则多标签会互相广播/保存并形成双生产者。
        if (pendingMsg && pendingMsg._remoteObserver) {
            if (fields.content !== undefined) pendingMsg.content = fields.content || '';
            if (fields.reasoning !== undefined) pendingMsg.reasoning = fields.reasoning || '';
            if (fields.toolCalls !== undefined) pendingMsg._rsToolCalls = Array.isArray(fields.toolCalls) ? _clone(fields.toolCalls) : [];
            return;
        }
        var st = _getState(chatId);
        if (!st) return;
        if (fields.content !== undefined) st.content = fields.content || '';
        if (fields.reasoning !== undefined) st.reasoning = fields.reasoning || '';
        if (fields.toolCalls !== undefined) st.toolCalls = Array.isArray(fields.toolCalls) ? _clone(fields.toolCalls) : [];
        if (fields.phase) st.phase = fields.phase;
        if (fields.sid) st.sid = fields.sid;
        if (fields.msgId) st.msgId = fields.msgId;
        if (fields.taskId) st.taskId = fields.taskId;
        if (fields.runtimeSessionId) st.runtimeSessionId = fields.runtimeSessionId;
        if (fields.runtimeJobId) st.runtimeJobId = fields.runtimeJobId;
        if (fields.error !== undefined) st.error = fields.error || '';
        if (pendingMsg) {
            pendingMsg._rsStreamId = st.sid || pendingMsg._rsStreamId;
            pendingMsg._rsMsgId = st.msgId || pendingMsg._rsMsgId;
            pendingMsg.task_id = st.taskId || pendingMsg.task_id;
            pendingMsg.runtime_session_id = st.runtimeSessionId || pendingMsg.runtime_session_id;
            pendingMsg.runtime_job_id = st.runtimeJobId || pendingMsg.runtime_job_id;
        }
        _persistState(st, !!immediate);
    }

    async function _readSSE(sid, msgId, chatId, pendingMsg, isResume, stopSignal) {
        var token = (typeof getAuthToken === 'function' ? getAuthToken() : null) || localStorage.getItem('authToken') || '';
        var uid = localStorage.getItem('authUserId') || '';
        if (!sid && !msgId) {
            console.log('[RS] Skip _readSSE: both sid and msgId are empty');
            return null;
        }
        var params = [
            'stream_id=' + encodeURIComponent(sid || ''),
            'msg_id=' + encodeURIComponent(msgId || ''),
            'since=0',
            'snapshot=1'
        ];
        // 凭据只走 Authorization header，不放入 URL/控制台/代理日志。
        if (uid) params.push('user_id=' + encodeURIComponent(uid));
        var url = '/engine/chat/stream?' + params.join('&');
        var resp;
        try {
            var headers = { 'Accept': 'text/event-stream' };
            if (token) headers['Authorization'] = 'Bearer ' + token;
            var fetchOpt = { cache: 'no-store', headers: headers };
            if (stopSignal) fetchOpt.signal = stopSignal;
            resp = await fetch(url, fetchOpt);
        } catch(e) {
            // ★ 停止键: fetch被中止时返回aborted标记, 阻止main.js回退直连再次请求
            if (_isUserStopped(chatId)) {
                _cancelStream(sid, msgId);
                return {fullText:'', reasoningText:'', usage:null, toolCalls:[], completed:false, aborted:true};
            }
            return null;
        }
        if (!resp.ok) {
            var httpError = await _parseHttpError(resp, 'stream request failed');
            var terminalStatus = resp.status === 401 || resp.status === 403 || resp.status === 404 || resp.status === 410;
            return {
                fullText:'', reasoningText:'', usage:null, toolCalls:[], completed:false,
                error:httpError.message, errorCode:httpError.code, errorDetails:httpError.details,
                status:resp.status, terminal:terminalStatus, authFailure:resp.status === 401 || resp.status === 403
            };
        }
        // ★ 停止键: 响应已返回但已被中止(JSON快路径/未开始读取时)也要立即退出
        if (_isUserStopped(chatId) || (stopSignal && stopSignal.aborted)) {
            _cancelStream(sid, msgId);
            return {fullText:'', reasoningText:'', usage:null, toolCalls:[], completed:false, aborted:true};
        }

        // ★ 已完成流返回JSON(非SSE) — 直接解析,避免TCP分片导致done事件丢失
        var _ct = resp.headers.get('content-type')||'';
        if (_ct.includes('json')) {
            try {
                var _jd = await resp.json();
                if (_jd && (_jd.full_text || _jd.reasoning_text || (Array.isArray(_jd.tool_calls) && _jd.tool_calls.length > 0))) {
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
                    pendingMsg.content = _visibleContent(_ftJson.trim());
                    pendingMsg.reasoning = _visibleReasoning(_rsnJson.trim());
                    pendingMsg._toolVisibleContent = pendingMsg.content;
                    pendingMsg._toolVisibleReasoning = _visibleReasoning(_rsnJson.trim());
                    var _jsonToolCalls = _clone(Array.isArray(_jd.tool_calls) ? _jd.tool_calls : []);
                    pendingMsg._rsToolCalls = _clone(_jsonToolCalls);
                    pendingMsg.tool_calls = _clone(_jsonToolCalls);
                    _updateStreamingState(chatId, pendingMsg, {
                        sid:sid, msgId:msgId, content:_ftJson.trim(), reasoning:_rsnJson.trim(),
                        toolCalls:Array.isArray(_jd.tool_calls) ? _jd.tool_calls : [],
                        phase:_jd.error ? 'error' : (_jd.finished === false ? 'streaming' : 'stream_done'),
                        error:_jd.error || ''
                    }, true);
                    if (_ftJson && typeof applyStreamRender === 'function') applyStreamRender(chatId, _visibleContent(_ftJson.trim()));
                    _renderReasoning(chatId, _rsnJson.trim());
                    _hydrateState(chatId);
                    return {fullText: _ftJson.trim(), reasoningText: _rsnJson.trim(),
                            usage: _jd.usage||null, toolCalls: _clone(_jsonToolCalls),
                            completed: !_jd.error && _jd.finished !== false,
                            error: _jd.error || null, stopReason: _jd.stop_reason || '',
                            truncated: !!_jd.truncated};
                }
            } catch(e) { console.warn('[RS] JSON parse error:', e.message); }
            return null;
        }

        var reader;
        try { reader = resp.body.getReader(); } catch(e) { return null; }
        var _observerRead = !!(pendingMsg && pendingMsg._remoteObserver);

        var buf='', full='', reasoning='', tcList=[], usage=null, done=false, streamCompleted=false, readerEof=false, streamError=null, aborted=false;
        var stopReason='', truncated=false, streamStartedAt=Date.now();
        // SSE 的 event/data 可能被拆进不同网络分片，事件名需跨 read() 保留。
        var ev='';
        var _decoder = new TextDecoder();  // ★ 复用解码器，避免 UTF-8 多字节字符跨 chunk 损坏

        var _observerRead = !!(pendingMsg && pendingMsg._remoteObserver);
        // Keep provider-turn text separate from the visible projection. A
        // web_search handoff can have a preamble already rendered in the same
        // bubble; reconnect/snapshot events must not replace that preamble.
        var _roundBaseContent = pendingMsg && typeof pendingMsg._toolRoundBaseContent === 'string'
            ? pendingMsg._toolRoundBaseContent : '';
        var _roundBaseReasoning = pendingMsg && typeof pendingMsg._toolRoundBaseReasoning === 'string'
            ? pendingMsg._toolRoundBaseReasoning : '';
        var _visibleContent = function(value) {
            return typeof window.mergeAssistantStreamText === 'function'
                ? window.mergeAssistantStreamText(_roundBaseContent, value)
                : (_roundBaseContent + (value || ''));
        };
        var _visibleReasoning = function(value) {
            return typeof window.mergeAssistantStreamText === 'function'
                ? window.mergeAssistantStreamText(_roundBaseReasoning, value)
                : (_roundBaseReasoning + (value || ''));
        };
        var timer = _observerRead ? null : setInterval(function(){
            try { localStorage.setItem('_rs_ts', Date.now()); } catch(e) {}
            if (full || reasoning || tcList.length) {
                try { localStorage.setItem('_savedPartial', JSON.stringify({
                    chatId:chatId, content:full, reasoning:reasoning,
                    toolCalls:tcList, streamId:sid, msgId:msgId || '', time:Date.now()
                })); } catch(e) {}
            }
        }, 500);

        while (!done) {
            // ★ 停止键: 每轮读取前检查中止状态, 立即中断而不等模型思考完
            if (_isUserStopped(chatId) || (stopSignal && stopSignal.aborted)) {
                aborted = true;
                break;
            }
            // Bound an individual reader to the same server retention window. The engine emits
            // ping frames while upstream is thinking, so this deadline is checked promptly.
            if (Date.now() - streamStartedAt > _STATE_TTL) break;
            var rr;
            try { rr = await reader.read(); } catch(e) {
                if (_isUserStopped(chatId) || (stopSignal && stopSignal.aborted)) aborted = true;
                break;
            }
            done = rr.done;
            if (rr.done) readerEof = true;  // ★ 记录是否收到EOF(引擎正常关闭连接)
            if (rr.value) buf += _decoder.decode(rr.value, {stream:true});
            var lines = buf.split('\n'); buf = lines.pop()||'';
            for (var i=0; i<lines.length; i++) {
                var ln = lines[i].trim();
                if (!ln) continue;
                if (ln.startsWith('event:')) { ev = ln.substring(6).trim(); continue; }
                if (!ln.startsWith('data:')) continue;
                var js = ln.substring(5).trim(); if (!js) continue;
                try {
                    var d = JSON.parse(js);
                    // ★ 引擎有2种SSE格式：_generate_resumable用event行(_ev)，_stream_openai_to_sse用JSON的type字段
                    var _evType = ev || (d.type || '');
                    if (_evType === 'snapshot') {
                        if (d.stream_id && (!sid || sid.indexOf('pending_') === 0)) sid = d.stream_id;
                        full = d.full_text || '';
                        reasoning = d.reasoning_text || '';
                        tcList = Array.isArray(d.tool_calls) ? d.tool_calls : [];
                        usage = d.usage || usage;
                        pendingMsg.content = _visibleContent(full);
                        pendingMsg.reasoning = reasoning;
                        pendingMsg._toolVisibleContent = _visibleContent(full);
                        pendingMsg._toolVisibleReasoning = _visibleReasoning(reasoning);
                        pendingMsg._rsToolCalls = _clone(tcList);
                        _updateStreamingState(chatId, pendingMsg, {
                            sid: sid, msgId: msgId, content: full, reasoning: reasoning,
                            toolCalls: tcList,
                            phase: d.error ? 'error' : (d.finished ? 'stream_done' : 'streaming'),
                            error: d.error || ''
                        }, true);
                        // 首包快照必须主动绘制；即使之后长时间没有新 token，刷新页也完整可见。
                        if (full && typeof applyStreamRender === 'function') applyStreamRender(chatId, _visibleContent(full));
                        _renderReasoning(chatId, reasoning);
                        _hydrateState(chatId);
                        if (d.finished) {
                            streamError = d.error || null;
                            stopReason = d.stop_reason || stopReason;
                            truncated = !!d.truncated || truncated;
                            streamCompleted = !streamError;
                            done = true;
                        }
                    } else if (_evType === 'content') {
                        var dl = d.delta||'';
                        if (dl) {
                            full+=dl;
                            pendingMsg.content=_visibleContent(full);
                            pendingMsg._toolVisibleContent = _visibleContent(full);
                            pendingMsg._toolVisibleReasoning = _visibleReasoning(reasoning);
                            _updateStreamingState(chatId, pendingMsg, {content:_visibleContent(full), reasoning:_visibleReasoning(reasoning)}, false);
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
                            pendingMsg._toolVisibleContent = _visibleContent(_display);
                            applyStreamRender(chatId, _visibleContent(_display));
                        }
                    } else if (_evType === 'reasoning') {
                        var rd = d.delta||'';
                        if (rd) {
                            reasoning+=rd;
                            pendingMsg.reasoning=reasoning;
                            _updateStreamingState(chatId, pendingMsg, {content:full, reasoning:reasoning}, false);
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
                        pendingMsg._rsToolCalls = _clone(tcList);
                        _updateStreamingState(chatId, pendingMsg, {content:full, reasoning:reasoning, toolCalls:tcList}, true);
                        _hydrateState(chatId);
                        _renderObserverToolTimeline(chatId, pendingMsg, tcList, false);
                    } else if (_evType === 'done' || d.full_text !== undefined) {
                        // ★ 优先用已累积的 full（可能比引擎 full_text 更完整）
                        if (d.full_text && d.full_text.length > full.length) full = d.full_text;
                        if (d.reasoning_text && d.reasoning_text.length > reasoning.length) reasoning = d.reasoning_text;
                        if (d.tool_calls) tcList=d.tool_calls;
                        if (d.usage) usage=d.usage;
                        stopReason = d.stop_reason || stopReason;
                        truncated = !!d.truncated || truncated;
                        pendingMsg.content = _visibleContent(full);
                        pendingMsg.reasoning = reasoning;
                        pendingMsg._toolVisibleContent = _visibleContent(full);
                        pendingMsg._toolVisibleReasoning = _visibleReasoning(reasoning);
                        pendingMsg._rsToolCalls = _clone(tcList);
                        _updateStreamingState(chatId, pendingMsg, {
                            content:full, reasoning:reasoning, toolCalls:tcList, phase:'stream_done', error:''
                        }, true);
                        if (full && typeof applyStreamRender === 'function') applyStreamRender(chatId, _visibleContent(full));
                        _renderReasoning(chatId, reasoning);
                        _renderObserverToolTimeline(chatId, pendingMsg, tcList, true);
                        done=true;
                        streamCompleted=true;  // ★ 真正收到done事件才算完成
                    } else if (_evType === 'error' || d.error) {
                        console.warn('[RS] stream error:', d.error);
                        streamError = d.error || 'stream error';
                        _updateStreamingState(chatId, pendingMsg, {
                            content:full, reasoning:reasoning, toolCalls:tcList, phase:'error', error:streamError
                        }, true);
                        done=true;
                    } else if (_evType === 'ping') {
                        // 心跳只维持连接，不改变内容；刷新后的首屏已由 snapshot 主动绘制。
                    } else if (d.delta && !d.full_text) {
                        // ★ 未知 type 但有 delta → 按 content 处理
                        var dl2 = d.delta||'';
                        if (dl2) {
                            full+=dl2; pendingMsg.content=_visibleContent(full);
                            _updateStreamingState(chatId, pendingMsg, {content:full, reasoning:reasoning}, false);
                            applyStreamRender(chatId, _visibleContent(full));
                        }
                    }
                } catch(e) {}
                // data 记录到达后才重置；仅收到 event 行时会保留至下一分片。
                ev='';
            }
        }
        if (timer) clearInterval(timer);
        if (aborted) {
            // ★ 用户停止: 通知引擎取消后台生成 + 返回aborted标记(不回退直连)
            _cancelStream(sid, msgId);
            try { cleanupStreamState(chatId); } catch(e) {}
            return {fullText:full, reasoningText:reasoning, usage:usage, toolCalls:[], completed:false, aborted:true};
        }
        // ★ 刷新缓冲区:流结束后处理buf中残留的SSE数据(跨chunk拆分)
        buf += _decoder.decode();
        if (buf && buf.trim()) {
            var _remLines = buf.split('\n');
            var _remEv = ev;
            for (var _rli = 0; _rli < _remLines.length; _rli++) {
                var _rln = _remLines[_rli].trim();
                if (!_rln) continue;
                if (_rln.startsWith('event:')) { _remEv = _rln.substring(6).trim(); continue; }
                if (!_rln.startsWith('data:')) continue;
                var _rjs = _rln.substring(5).trim(); if (!_rjs) continue;
                try {
                    var _rd = JSON.parse(_rjs);
                    var _revType = _remEv || (_rd.type || '');
                    if (_revType === 'done' || _rd.full_text !== undefined) {
                        if (_rd.full_text && _rd.full_text.length > full.length) full = _rd.full_text;
                        if (_rd.reasoning_text && _rd.reasoning_text.length > reasoning.length) reasoning = _rd.reasoning_text;
                        if (_rd.tool_calls) tcList = _rd.tool_calls;
                        if (_rd.usage) usage = _rd.usage;
                        stopReason = _rd.stop_reason || stopReason;
                        truncated = !!_rd.truncated || truncated;
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
        if (streamCompleted || streamError) {
            try { cleanupStreamState(chatId); } catch(e) {}
        }
        // EOF/网络异常不再猜测为“已完成”。统一端点会在重连首包返回聚合快照，
        // 因而可安全重连且不会重复正文或工具调用。
        return {fullText:full, reasoningText:reasoning, usage:usage, toolCalls:tcList,
                completed:streamCompleted, error:streamError, stopReason:stopReason,
                truncated:truncated, disconnected:!streamCompleted && !streamError};
    }

    async function _readWithReconnect(sid, msgId, chatId, pendingMsg, isResume, stopSignal) {
        var started = Date.now();
        var attempt = 0;
        var lastResult = null;
        while (Date.now() - started < _STATE_TTL && attempt < _MAX_RECONNECT_ATTEMPTS) {
            if (_isUserStopped(chatId) || (stopSignal && stopSignal.aborted)) {
                return {fullText:lastResult && lastResult.fullText || '', reasoningText:lastResult && lastResult.reasoningText || '',
                        usage:null, toolCalls:[], completed:false, aborted:true};
            }
            var result = await _readSSE(sid, msgId, chatId, pendingMsg, isResume && attempt === 0, stopSignal);
            if (result) {
                if (lastResult && !result.fullText && lastResult.fullText) result.fullText = lastResult.fullText;
                if (lastResult && !result.reasoningText && lastResult.reasoningText) result.reasoningText = lastResult.reasoningText;
                if (lastResult && (!result.toolCalls || !result.toolCalls.length) && lastResult.toolCalls) result.toolCalls = lastResult.toolCalls;
                lastResult = result;
            }
            var currentState = _getState(chatId);
            var waitingForCreate = result && result.terminal && result.status === 404 &&
                currentState && currentState.sid && currentState.sid.indexOf('pending_') === 0 &&
                Date.now() - started < 15000;
            if (result && !waitingForCreate &&
                (result.completed || result.aborted || result.error || result.terminal)) return result;

            attempt++;
            // 自动重连完全静默；连接状态属于实现细节，不应以“接续流式”提示打扰用户。
            _updateStreamingState(chatId, pendingMsg, {phase:'reconnecting'}, true);
            var delay = Math.min(3000, 250 * Math.pow(2, Math.min(attempt - 1, 4)));
            await new Promise(function(resolve) { setTimeout(resolve, delay); });
            _updateStreamingState(chatId, pendingMsg, {phase:'streaming'}, true);
        }
        return lastResult || {fullText:'', reasoningText:'', usage:null, toolCalls:[], completed:false, error:'resume timeout'};
    }

    function _prepareToolState(chatId, pm, toolCalls) {
        var st = _getState(chatId);
        if (!st) {
            var enabled = false;
            try { enabled = localStorage.getItem('__enableResumeStream') !== '0'; } catch(e) {}
            if (!enabled) return null;
            st = _saveState(pm && pm._rsStreamId || '', chatId, pm && pm._rsMsgId || '');
        }
        var oldById = {};
        (st.tools || []).forEach(function(rec) { if (rec && rec.id) oldById[rec.id] = rec; });
        st.phase = 'tools';
        st.content = pm && pm.content || st.content || '';
        st.reasoning = pm && pm.reasoning || st.reasoning || '';
        st.toolCalls = _clone(toolCalls || []);
        st.tools = (toolCalls || []).map(function(tc, index) {
            var id = _toolId(tc, index);
            var old = oldById[id];
            if (old) {
                old.name = tc.function && tc.function.name || old.name || '工具调用';
                old.preview = _toolPreview(tc);
                old.call = _clone(tc);
                return old;
            }
            return {
                id:id,
                name:tc.function && tc.function.name || '工具调用',
                preview:_toolPreview(tc),
                call:_clone(tc),
                status:'pending',
                attempts:0
            };
        });
        _persistState(st, true);
        _hydrateState(chatId);
        return st;
    }

    function _markToolRunning(chatId, tc, index) {
        var st = _getState(chatId);
        if (!st) return;
        var id = _toolId(tc, index || 0);
        var rec = (st.tools || []).find(function(item) { return item.id === id; });
        if (!rec) {
            rec = {id:id, name:tc.function && tc.function.name || '工具调用', preview:_toolPreview(tc), call:_clone(tc)};
            if (!st.tools) st.tools = [];
            st.tools.push(rec);
        }
        rec.status = 'running';
        rec.startedAt = Date.now();
        rec.attempts = (rec.attempts || 0) + 1;
        st.phase = 'tools';
        _persistState(st, true);
        if (currentChatId === chatId && typeof showToolStatus === 'function') {
            showToolStatus(rec.name, rec.preview || '', 'running', chatId, rec.id);
        }
    }

    function _markToolResult(chatId, tc, index, content, isError) {
        var st = _getState(chatId);
        if (!st) return;
        var id = _toolId(tc, index || 0);
        var rec = (st.tools || []).find(function(item) { return item.id === id; });
        if (!rec) return;
        rec.status = isError ? 'error' : 'success';
        rec.result = String(content == null ? '(empty)' : content);
        rec.finishedAt = Date.now();
        var unfinished = (st.tools || []).some(function(item) { return item.status === 'pending' || item.status === 'running'; });
        st.phase = unfinished ? 'tools' : 'tools_done';
        _persistState(st, true);
        if (currentChatId === chatId && typeof showToolStatus === 'function') {
            showToolStatus(rec.name, isError ? rec.result : '', isError ? 'error' : 'success', chatId, rec.id);
        }
    }

    function _findToolResult(chatId, toolId) {
        var msgs = chats[chatId] && chats[chatId].messages || [];
        for (var i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'tool' && msgs[i].tool_call_id === toolId) return msgs[i];
        }
        return null;
    }

    function _appendToolResultOnce(chatId, toolId, content) {
        var existing = _findToolResult(chatId, toolId);
        if (existing) return existing;
        var msg = { role:'tool', tool_call_id:toolId || '', content:String(content == null ? '(empty)' : content), _toolResult:true };
        chats[chatId].messages.push(msg);
        return msg;
    }

    // ★ 工具调用续接: 恢复的流返回tool_calls → 执行工具 → 交还sendMessage继续循环
    // 解决刷新后tool_calls被丢弃导致的输出中断+400问题(DeepSeek等)
    async function _resumeToolHandoff(toolCalls, pm, chatId, isCurrentChat) {
        try {
            // ★ 观察端只读守卫：观察设备仅做流式镜像与时间线展示，绝不执行工具、绝不交还 sendMessage
            if (pm && pm._remoteObserver) {
                console.log('[RS resume] Observer mode, skip _resumeToolHandoff tool execution');
                return false;
            }
            if (window._remoteTypingMap && window._remoteTypingMap[chatId]) {
                console.log('[RS resume] Remote stream in progress, skip tool execution on observer');
                return false;
            }
            toolCalls = Array.isArray(toolCalls) ? toolCalls : [];
            pm = pm || { role: 'assistant', content: '', reasoning: '' };
            if (!toolCalls.length) return false;
            if (!window.executeToolCallForRetry && window.OneAPIChatPlugins) {
                await window.OneAPIChatPlugins.ensure('tool-execution');
            }
            if (!window.executeToolCallForRetry) {
                console.warn('[RS resume] executeToolCallForRetry 未加载,无法续接工具调用');
                return false;
            }
            // 标准化tool_calls(轻量版,与main.js normalize保持一致)
            var normalized = toolCalls.filter(function(tc){ return tc && tc.function && tc.function.name; }).map(function(tc){
                var argStr = typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments || {});
                try { JSON.parse(argStr); } catch(_eArgs) {
                    try { argStr = _repairToolArguments(argStr); JSON.parse(argStr); } catch(_e2){ argStr = '{}'; }
                }
                var tcId = (tc.id || '').replace(/[^a-zA-Z0-9_\-]/g, '');
                if (!tcId || tcId.length > 64) tcId = 'tc_' + Date.now();
                var _norm = { id: tcId, type: tc.type || 'function', function: { name: tc.function.name, arguments: argStr } };
                // ★ 保留Gemini thought_signature(Google API要求回传否则400)
                if (tc.thought_signature) _norm.thought_signature = tc.thought_signature;
                if (tc.function.thought_signature) _norm.function.thought_signature = tc.function.thought_signature;
                return _norm;
            });
            if (!normalized.length) return false;
            var mergedCalls = [];
            var seenCalls = {};
            (pm.tool_calls || []).concat(normalized).forEach(function(call) {
                var fn = call && call.function || {};
                var key = call && call.id ? 'id:' + call.id :
                    'fn:' + (fn.name || '') + '|' + (typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {}));
                if (seenCalls[key]) return;
                seenCalls[key] = true;
                mergedCalls.push(call);
            });
            pm.tool_calls = mergedCalls;
            delete pm.partial;
            pm._toolRecovery = true;
            _prepareToolState(chatId, pm, normalized);
            // 必须先持久化 assistant.tool_calls，再启动任何工具。刷新发生在 await
            // 期间时，新页面才能立即重建“运行中”并补齐缺失结果。
            slimSaveChats();
            saveChats();
            console.log('[RS resume] 工具续接: 执行 ' + normalized.length + ' 个工具调用');

            // 执行每个工具并追加结果到聊天历史
            var _body = { messages: [] };
            for (var _ti = 0; _ti < normalized.length; _ti++) {
                var tc = normalized[_ti];
                var existingResult = _findToolResult(chatId, tc.id || '');
                var _st = _getState(chatId);
                var savedRec = _st && (_st.tools || []).find(function(item) { return item.id === tc.id; });
                if (existingResult) {
                    _markToolResult(chatId, tc, _ti, existingResult.content || '(empty)', false);
                    continue;
                }
                if (savedRec && (savedRec.status === 'success' || savedRec.status === 'error') && savedRec.result !== undefined) {
                    _appendToolResultOnce(chatId, tc.id || '', savedRec.result);
                    slimSaveChats();
                    continue;
                }

                _markToolRunning(chatId, tc, _ti);
                var toolRes = { error: null, result: null };
                var toolAbort = new AbortController();
                var abortKey = chatId + '_resume_tool_' + (tc.id || _ti);
                window.__toolAbortControllers = window.__toolAbortControllers || {};
                window.__toolAbortControllers[abortKey] = toolAbort;
                try {
                    toolRes = await window.executeToolCallForRetry(tc, toolAbort.signal, {
                        body: _body, pendingMsg: pm, chatId: chatId,
                        currentChatId: currentChatId, activeBubbleMap: activeBubbleMap, chats: chats
                    }) || { error: null, result: null };
                } catch(_te) { toolRes = { error: String(_te && _te.message || _te), result: null }; }
                delete window.__toolAbortControllers[abortKey];
                var contentStr = toolRes.error || toolRes.result || '(empty)';
                contentStr = typeof contentStr === 'string' ? contentStr : JSON.stringify(contentStr);
                if (contentStr.length > 100000) contentStr = contentStr.substring(0, 100000) + '\n\n...(工具结果过长已截断)';
                // 先写恢复日志，再写聊天历史；两个同步 localStorage 节点之间即使刷新，
                // 下一页也能从日志补回结果而不会重复执行已完成工具。
                _markToolResult(chatId, tc, _ti, contentStr, !!toolRes.error);
                _appendToolResultOnce(chatId, tc.id || '', contentStr);
                slimSaveChats();
            }

            var handoffState = _getState(chatId);
            if (handoffState) {
                handoffState.phase = isCurrentChat ? 'continuing' : 'awaiting_open';
                _persistState(handoffState, true);
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

            // ★ 交还sendMessage继续工具循环(重建body.messages,处理Anthropic/链式/RS续传)
            // Preserve the visible pre-tool text as a continuation base. Without
            // this handoff, sendMessage(true) creates a fresh pending message and
            // the next RS stream can make the original bubble appear truncated.
            window.__toolContinuationBaseByChat = window.__toolContinuationBaseByChat || {};
            window.__toolContinuationBaseByChat[chatId] = {
                content: pm.content || '',
                reasoning: pm.reasoning || '',
                message: pm,
                bubble: activeBubbleMap[chatId] || null,
                at: Date.now()
            };
            if (isCurrentChat && typeof window.sendMessage === 'function') {
                console.log('[RS resume] 工具执行完毕,交还sendMessage继续循环 with preserved bubble base');
                // sendMessage(true) 会在 isTypingMap 仍为 true 时把自己视作“忙时队列”
                // 并直接返回。先释放旧恢复轮的 typing 所有权，新请求会同步重新接管。
                isTypingMap[chatId] = false;
                // 下一事件循环再启动，确保 resume.finally 已释放 _active；否则新一轮
                // ResumeStream.create 会误判同一聊天仍在恢复并退回不可续接的直连。
                setTimeout(function() {
                    window.sendMessage(true).catch(function(_se){ console.warn('[RS resume] sendMessage续接错误:', _se.message); });
                }, 0);
            }
            return true;
        } catch(_he) {
            console.warn('[RS resume] 工具续接异常:', _he.message);
            return false;
        }
    }

    if (!window.__resumeStateFlushBound) {
        window.__resumeStateFlushBound = true;
        window.addEventListener('pagehide', function() { _writeStateBook(); });
        window.addEventListener('beforeunload', function() { _writeStateBook(); });
    }

    return {
        // ★ 停止键: 取消当前chat的活跃可恢复流(通知引擎后台线程停止生成)
        cancelActive: function(chatId) {
            _abortLocalReader(chatId);
            var sid = '';
            var msgId = '';
            var cid = '';
            var st = _getState(chatId);
            if (st && st.sid) sid = st.sid;
            if (st && st.msgId) msgId = st.msgId;
            if (!sid) { try { sid = localStorage.getItem('_rs_sid') || ''; } catch(e) {} }
            if (!msgId) { try { msgId = localStorage.getItem('_rs_msgid') || ''; } catch(e) {} }
            try { cid = localStorage.getItem('_rs_cid') || ''; } catch(e) {}
            if (!st && cid && cid !== 'pending' && chatId && cid !== chatId) return;
            _cancelStream(sid, msgId);
        },
        peek: function(chatId) {
            return _getState(chatId);
        },
        hasPending: function(chatId) {
            var st = _getState(chatId);
            return !!(st && st.phase !== 'completed' && st.phase !== 'error');
        },
        hasState: function(chatId) {
            var st = _getState(chatId);
            return !!(st && st.phase !== 'completed' && st.phase !== 'error');
        },
        hydrate: function(chatId) {
            return _hydrateState(chatId);
        },
        prepareTools: function(chatId, pendingMsg, toolCalls) {
            return _prepareToolState(chatId, pendingMsg, toolCalls);
        },
        markToolRunning: function(chatId, tc, index) {
            _markToolRunning(chatId, tc, index);
        },
        markToolResult: function(chatId, tc, index, content, isError) {
            _markToolResult(chatId, tc, index, content, isError);
        },
        complete: function(chatId) {
            _clearState(chatId);
            try {
                var sp = JSON.parse(localStorage.getItem('_savedPartial') || 'null');
                if (!sp || sp.chatId === chatId) localStorage.removeItem('_savedPartial');
            } catch(e) {}
        },
        discard: function(chatId, msgId) {
            _clearState(chatId);
            var list = chats[chatId] && chats[chatId].messages;
            if (list) {
                chats[chatId].messages = list.filter(function(m) {
                    if (!m || m.role !== 'assistant' || (!m.partial && !m._recovered)) return true;
                    if (msgId && m._rsMsgId && m._rsMsgId !== msgId) return true;
                    var durable = !!((m.content && String(m.content).trim()) || m.reasoning || m.tool_calls ||
                        m.generatedImage || (m.generatedImages && m.generatedImages.length));
                    if (durable) {
                        delete m.partial;
                        delete m._recovered;
                        delete m._rsMsgId;
                        delete m._rsStreamId;
                        m.time = m.time || Date.now();
                        return true;
                    }
                    return false;
                });
            }
            try {
                var sp = JSON.parse(localStorage.getItem('_savedPartial') || 'null');
                if (!sp || sp.chatId === chatId) localStorage.removeItem('_savedPartial');
            } catch(e) {}
            isTypingMap[chatId] = false;
            slimSaveChats();
        },
        resumePending: async function(chatId) {
            var target = chatId || currentChatId || '';
            if (target && _getState(target)) return window.ResumeStream.resume(target);
            var states = _loadStateBook().chats;
            var ids = Object.keys(states).sort(function(a, b) {
                return (states[b].updatedAt || 0) - (states[a].updatedAt || 0);
            });
            if (!ids.length) return false;
            // sendMessage 的工具续轮依赖 currentChatId；后台聊天等用户切换过去再恢复。
            // ★ 严格分隔: 优先选与当前模式同域的待续聊天,避免普通模式下恢复 Agent 会话(或反之)
            var _resumeAgentView = (typeof isAgentToolsActive === 'function') && isAgentToolsActive();
            var _sameDomain = ids.filter(function(id) {
                return (typeof isAgentChat === 'function') ? (isAgentChat(id) === _resumeAgentView) : true;
            });
            var _pool = _sameDomain.length ? _sameDomain : ids;
            var chosen = _pool.indexOf(currentChatId) !== -1 ? currentChatId : _pool[0];
            return window.ResumeStream.resume(chosen);
        },
        create: async function(messages, config, chatId, pendingMsg) {
            if (_active[chatId]) return null;
            _active[chatId]=true;
            // 每条 RS 流拥有独立的用户停止控制器；不能读取 main.js 的请求 controller。
            // 新 reader 接管时只关闭旧客户端连接，绝不把传输切换升级成后端任务取消。
            _abortLocalReader(chatId);
            var _stopController = new AbortController();
            _stopControllers[chatId] = _stopController;
            var _stopSignal = _stopController.signal;
            try {
                var _msgId = pendingMsg && pendingMsg.id ? String(pendingMsg.id) : ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
                if (pendingMsg) pendingMsg.id = _msgId;
                var _pendingSid = 'pending_' + _msgId;
                _saveState(_pendingSid, chatId, _msgId);
                pendingMsg._rsStreamId = _pendingSid;
                pendingMsg._rsMsgId = _msgId;
                _updateStreamingState(chatId, pendingMsg, {
                    sid:_pendingSid, msgId:_msgId,
                    content:pendingMsg.content || '', reasoning:pendingMsg.reasoning || '',
                    phase:'creating'
                }, true);
                // 创建请求返回 stream_id 前也有稳定 msg_id。刷新后的页面可直接按
                // msg_id 查询后端，消除“请求已创建但 sid 尚未来得及落盘”的窗口。
                slimSaveChats();
                var token = localStorage.getItem('authToken')||'';
                // ★ 传递代理配置到引擎，让子代理/可恢复流也走代理
                var _proxyEnabled = (window.isProxyEnabled && window.isProxyEnabled()) || false;
                var _proxyUrl = _proxyEnabled ? (window.getProxyUrl ? window.getProxyUrl() : '') : '';
                // ★ 用相对URL避免代理拦截同源请求
                // The create acknowledgement is bounded separately from a provider request.
                // Do not use config.requestTimeout here: the engine owns long-running work
                // after accepting it and the persisted msg_id enables safe recovery.
                var _createCtrl = new AbortController();
                var _configuredAckTimeout = Number(config.resumeCreateTimeoutMs);
                var _createAckTimeout = Number.isFinite(_configuredAckTimeout)
                    ? Math.max(5000, Math.min(60000, _configuredAckTimeout))
                    : _CREATE_ACK_TIMEOUT_MS;
                var _createTimeout = setTimeout(function(){ _createCtrl.abort(); }, _createAckTimeout);
                if (_stopSignal && typeof _stopSignal.addEventListener === 'function') {
                    _stopSignal.addEventListener('abort', function(){ _createCtrl.abort(); }, { once: true });
                }
                var _createPayload = {};
                var _requestBody = config.requestBody && typeof config.requestBody === 'object' ? config.requestBody : {};
                var _blockedRequestKeys = {
                    messages:1, model:1, api_key:1, apiKey:1, base_url:1, chat_id:1, msg_id:1,
                    user_id:1, stream:1, proxy_enabled:1, proxy_url:1, anthropic_url:1, anthropic_format:1
                };
                Object.keys(_requestBody).forEach(function(key) {
                    var lower = String(key).toLowerCase();
                    if (_blockedRequestKeys[key] || key.charAt(0) === '_' ||
                        lower.indexOf('password') !== -1 || lower.indexOf('secret') !== -1 ||
                        lower.indexOf('api_key') !== -1 || lower === 'authorization' ||
                        lower === 'access_token' || lower === 'refresh_token' || lower === 'cookie' || lower === 'x-api-key') return;
                    var value = _requestBody[key];
                    if (value !== undefined) _createPayload[key] = value;
                });
                _createPayload.messages = messages;
                _createPayload.model = config.model;
                _createPayload.api_key = config.apiKey || '';
                _createPayload.base_url = config.baseUrl || '';
                _createPayload.chat_id = chatId;
                _createPayload.msg_id = _msgId;
                _createPayload.client_source = window._sseSourceId || '';
                var _syncTraceId = '';
                try { if (window.SyncTrace && SyncTrace.enabled()) _syncTraceId = SyncTrace.id('stream:' + chatId); } catch(e) {}
                if (_syncTraceId) {
                    _createPayload.trace_id = _syncTraceId;
                    SyncTrace.log('stream_create_send', { trace_id: _syncTraceId, chat_id: chatId, msg_id: _msgId, model: config.model || '', message_count: Array.isArray(messages) ? messages.length : 0 });
                }
                if (_createPayload.temperature === undefined) _createPayload.temperature = config.temp !== undefined ? config.temp : 0.7;
                if (_createPayload.max_tokens === undefined && _createPayload.max_completion_tokens === undefined) {
                    _createPayload.max_tokens = config.tokens || 4096;
                }
                if (config.tools && config.tools.length) _createPayload.tools = config.tools;
                _createPayload.proxy_enabled = _proxyEnabled;
                _createPayload.proxy_url = _proxyUrl;
                _createPayload.anthropic_format = !!config.anthropicFormat;
                _createPayload.anthropic_url = config.anthropicUrl || '';
                if (config.system !== undefined) _createPayload.system = config.system;
                if (config.thinking !== undefined) _createPayload.thinking = config.thinking;
                var _effortVal = config.effort || (pendingMsg && pendingMsg.effort) || config.reasoningEffort || config.thinkingLevel || '';
                if (_effortVal) {
                    _createPayload.effort = _effortVal;
                    if (_createPayload.reasoning_effort === undefined) _createPayload.reasoning_effort = _effortVal;
                }
                if (config.reasoningEffort !== undefined) _createPayload.reasoning_effort = config.reasoningEffort;
                if (config.thinkingLevel !== undefined) _createPayload.thinking_level = config.thinkingLevel;
                if (config.extraBody !== undefined) _createPayload.extra_body = config.extraBody;

                var _createHeaders = {'Content-Type':'application/json','Authorization':'Bearer '+token};
                if (_syncTraceId) _createHeaders['X-OneAPIChat-Trace'] = _syncTraceId;
                var cr = await fetch('/oneapichat/api/engine_api.php?action=chat_create', {
                    method:'POST',
                    headers:_createHeaders,
                    body:JSON.stringify(_createPayload),
                    signal: _createCtrl.signal
                });
                clearTimeout(_createTimeout);
                if (!cr.ok) {
                    var createError = await _parseHttpError(cr, 'chat_create failed');
                    _updateStreamingState(chatId, pendingMsg, {phase:'error', error:createError.message}, true);
                    return {
                        fullText:'', reasoningText:'', usage:null, toolCalls:[], completed:false,
                        error:createError.message, errorCode:createError.code, errorDetails:createError.details,
                        status:cr.status, terminal:cr.status === 401 || cr.status === 403,
                        authFailure:cr.status === 401 || cr.status === 403
                    };
                }
                var cd = await cr.json();
                if (_syncTraceId) SyncTrace.log('stream_create_response', { trace_id: _syncTraceId, chat_id: chatId, status: cr.status, stream_id: cd.stream_id || '', task_id: cd.task_id || '', msg_id: cd.msg_id || _msgId });
                var sid = cd.stream_id;
                var msgId = cd.msg_id || _msgId;
                if (!sid) {
                    console.error('[RS] chat_create: no stream_id in response');
                    _updateStreamingState(chatId, pendingMsg, {phase:'error', error:'chat_create missing stream_id'}, true);
                    return null;
                }
                console.log('[RS] stream created:', sid, 'msgId:', msgId);
                _saveState(sid, chatId, msgId);
                pendingMsg._rsStreamId = sid;
                pendingMsg._rsMsgId = msgId;
                pendingMsg.task_id = cd.task_id || pendingMsg.task_id;
                pendingMsg.runtime_session_id = cd.runtime_session_id || pendingMsg.runtime_session_id;
                pendingMsg.runtime_job_id = cd.runtime_job_id || pendingMsg.runtime_job_id;
                _updateStreamingState(chatId, pendingMsg, {
                    sid:sid, msgId:msgId, taskId:cd.task_id, runtimeSessionId:cd.runtime_session_id,
                    runtimeJobId:cd.runtime_job_id, content:pendingMsg.content || '',
                    reasoning:pendingMsg.reasoning || '', phase:'streaming'
                }, true);
                var _result = _normalizeResumeResult(await _readWithReconnect(sid, msgId, chatId, pendingMsg, false, _stopSignal));
                console.log('[RS] _readSSE result:', _result ? 'OK' : 'NULL');
                return _result;
            } catch(e) {
                try { if (_createTimeout) clearTimeout(_createTimeout); } catch(_ignoredTimeout) {}
                if (_isUserStopped(chatId) || (_stopSignal && _stopSignal.aborted)) {
                    return {fullText:'', reasoningText:'', usage:null, toolCalls:[], completed:false, aborted:true};
                }
                // 请求可能已到达后端，只是创建响应在刷新/网络抖动中丢失。用预先
                // 持久化的 msg_id 探测一次，命中时继续同一条流而不是重复发模型请求。
                try {
                    var recovered = await _readSSE('', _msgId, chatId, pendingMsg, false, _stopSignal);
                    if (recovered && !recovered.terminal) return recovered;
                    // ★ 404/410 = 该流从未成功创建或已过期。不要把这种"流不存在"当作错误刷屏，
                    //   静默交给 main.js 走 direct HTTP 兜底，保证消息仍能发出（避免"falling back"报错观感）。
                    if (recovered && (recovered.status === 404 || recovered.status === 410)) {
                        console.info('[RS] stream not found/expired for ' + _msgId + ', falling back to direct HTTP');
                        return null;
                    }
                } catch(_recoverCreateError) {}
                _updateStreamingState(chatId, pendingMsg, {phase:'error', error:String(e && e.message || e)}, true);
                return null;
            }
            finally {
                delete _active[chatId];
                _releaseStopSignal(chatId, _stopController);
            }
        },

        // ★ 续接：尝试连接引擎流，连不上就返回 false
        // 可选 sid/msgId 参数（从引擎 active_tasks 恢复时传入）
        _legacyResume: async function(chatId, optSid, optMsgId) {
            var sid = optSid || '';
            if (!sid) {
                try { sid = localStorage.getItem('_rs_sid')||''; } catch(e) {}
            }
            if (!sid || sid.indexOf('pending_')===0) { console.warn('[RS resume] No valid sid:', sid); return false; }
            var msgId = optMsgId || '';
            if (!msgId) {
                try { msgId = localStorage.getItem('_rs_msgid') || ''; } catch(e) {}
            }

            var scid = localStorage.getItem('_rs_cid')||'';
            if (scid && scid !== 'pending' && scid !== chatId) chatId = scid;

            var ts = parseInt(localStorage.getItem('_rs_ts')||'0');
            if (Date.now() - ts > _STATE_TTL) { console.warn('[RS resume] TTL expired for sid:', sid); return false; }

            if (_active[chatId]) { console.log('[RS resume] Already active for chat:', chatId); return false; }
            if (!chats[chatId] || !Array.isArray(chats[chatId].messages)) {
                console.warn('[RS resume] Chat missing or messages malformed:', chatId);
                return false;
            }
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
                // ★ 更新按钮状态: 流式生成中应显示停止键
                if (_isCurrentChat) {
                    if (typeof window.updateSendStopButtons === 'function') window.updateSendStopButtons(true);
                    else {
                        if ($.sendBtn) $.sendBtn.classList.add('hidden');
                        if ($.stopBtn) { $.stopBtn.classList.remove('hidden'); $.stopBtn.classList.add('visible'); }
                    }
                    window._updateQueueUI();
                    // ★ 初始滚动到底部
                    setTimeout(function() { if ($.chatBox) followToBottom($.chatBox); }, 50);
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
                var result = _normalizeResumeResult(await _readWithReconnect(sid, msgId, chatId, pm, true, _getStopSignal(chatId)));
                console.log('[RS resume] After _readSSE — msgs count:', chats[chatId].messages.length);
                console.log('[RS resume] _readSSE returned:', result ? ('text_length=' + (result.fullText||'').length + ' tool_calls=' + (result.toolCalls||[]).length) : 'NULL');
                isTypingMap[chatId] = false;
                await new Promise(function(r) { setTimeout(r, 50); });
                if (result && result.completed && (result.fullText || (Array.isArray(result.toolCalls) && result.toolCalls.length > 0))) {
                    delete pm.partial;
                    pm.content = result.fullText || pm.content || '';
                    pm.reasoning = result.reasoningText || '';
                    pm.usage = result.usage;
                    pm.time = Date.now();  // ★ 关键: 设置time防止被隐形截断检测误删
                    // ★ 清除 _savedPartial: _readSSE的定时器可能已重新写入,
                    // 防止下方 loadChat 的旧版恢复逻辑读取它创建重复消息
                    try { localStorage.removeItem('_savedPartial'); } catch(e) {}

                    // ★ 工具调用续接: 恢复的流返回tool_calls时,执行工具并交还sendMessage继续循环
                    if (Array.isArray(result.toolCalls) && result.toolCalls.length > 0) {
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
        },

        // v3：以持久化状态和后端 snapshot 为准恢复，不破坏已经完成的消息/工具结果。
        resume: async function(chatId, optSid, optMsgId, isObserver) {
            var state = _getState(chatId);
            var sid = optSid || (state && state.sid) || '';
            var msgId = optMsgId || (state && state.msgId) || '';
            if (!sid) {
                try { sid = localStorage.getItem('_rs_sid') || ''; } catch(e) {}
            }
            if (!msgId) {
                try { msgId = localStorage.getItem('_rs_msgid') || ''; } catch(e) {}
            }
            if (!state && !optSid) {
                var legacyCid = '';
                try { legacyCid = localStorage.getItem('_rs_cid') || ''; } catch(e) {}
                if (legacyCid && legacyCid !== 'pending') chatId = legacyCid;
                state = _getState(chatId);
            }
            var pendingCreate = !!(sid && sid.indexOf('pending_') === 0);
            if (!sid && !msgId) return false;
            if (!chats[chatId] || !Array.isArray(chats[chatId].messages)) return false;

            var updatedAt = state && state.updatedAt || 0;
            if (!updatedAt) {
                try { updatedAt = parseInt(localStorage.getItem('_rs_ts') || '0'); } catch(e) {}
            }
            if (!isObserver && updatedAt && Date.now() - updatedAt > _STATE_TTL) {
                _clearState(chatId);
                return false;
            }
            if (_active[chatId]) return false;

            // 观察端使用纯内存状态，不调用 _saveState/_persistState，不写 localStorage。
            if (isObserver) {
                state = {
                    sid: sid, chatId: chatId, msgId: msgId, phase: 'streaming',
                    content: '', reasoning: '', toolCalls: [], tools: [], updatedAt: Date.now(),
                    _observer: true
                };
            } else if (!state || (!pendingCreate && state.sid !== sid)) {
                state = _saveState(sid, chatId, msgId);
            } else {
                if (sid) state.sid = sid;
                state.msgId = msgId || state.msgId || '';
                _persistState(state, true);
            }

            _active[chatId] = true;
            // 刷新恢复也使用独立停止信号，避免后续 sendMessage(true) 的 HTTP 清理误杀 RS。
            // 刷新/重连只替换本地 reader，不触碰服务器唯一生产者。
            _abortLocalReader(chatId);
            var _resumeStopController = new AbortController();
            _stopControllers[chatId] = _resumeStopController;
            window._backendRecovered = true;
            var isCurrent = currentChatId === chatId;
            // 工具恢复完成后会同步启动 sendMessage(true)。此时不能在 finally
            // 把新一轮刚设置的 typing 状态清掉，否则按钮和后台状态会瞬间失真。
            var continuationStarted = false;
            try {
                var msgs = chats[chatId].messages;
                var pm = isObserver ? null : _findPendingMessage(chatId, state);
                var savedPartial = null;
                if (!isObserver) {
                    try { savedPartial = JSON.parse(localStorage.getItem('_savedPartial') || 'null'); } catch(e) {}
                }
                if (!pm) {
                    pm = {
                        id: msgId || ('asst_' + Date.now().toString(36)),
                        role:'assistant', content:state.content || '', reasoning:state.reasoning || '',
                        partial:true, _recovered:true, _rsMsgId:msgId, _rsStreamId:sid,
                        _remoteObserver: !!isObserver
                    };
                    if (!isObserver && !pm.content && savedPartial && savedPartial.chatId === chatId) pm.content = savedPartial.content || '';
                    if (!isObserver && !pm.reasoning && savedPartial && savedPartial.chatId === chatId) pm.reasoning = savedPartial.reasoning || '';
                    msgs.push(pm);
                } else {
                    pm.partial = true;
                    pm._recovered = true;
                    pm._rsMsgId = msgId || pm._rsMsgId;
                    pm.id = pm.id || msgId || ('asst_' + Date.now().toString(36));
                    pm._rsStreamId = sid;
                    if (state.content) pm.content = state.content;
                    if (state.reasoning) pm.reasoning = state.reasoning;
                }

                // 只清同一轮的重复占位，绝不删除已经完成的 assistant/tool 配对。
                chats[chatId].messages = msgs.filter(function(m) {
                    if (m === pm) return true;
                    if (m.role !== 'assistant' || (!m.partial && !m._recovered)) return true;
                    if (msgId && m._rsMsgId && m._rsMsgId !== msgId) return true;
                    return false;
                });
                msgs = chats[chatId].messages;

                isTypingMap[chatId] = true;
                userScrolled = false;
                if (isCurrent) {
                    _hydrateState(chatId);
                    var bubble = activeBubbleMap[chatId];
                    if (!bubble || !bubble.querySelector('.markdown-body')) {
                        bubble = appendMessage('assistant', pm.content || '', null, pm.reasoning || '', null, null, true);
                        if (bubble) activeBubbleMap[chatId] = bubble;
                    }
                    if (bubble) {
                        bubble.classList.add('gen-active');
                        // 仅在完全没有正文/思考时挂载三点加载器，一旦有流内容立即展示打字流
                        if (!pm.content && !pm.reasoning) bubble.classList.add('typing');
                    }
                    if (typeof window.updateSendStopButtons === 'function') window.updateSendStopButtons(true);
                    else {
                        if ($.sendBtn) $.sendBtn.classList.add('hidden');
                        if ($.stopBtn) { $.stopBtn.classList.remove('hidden'); $.stopBtn.classList.add('visible'); }
                    }
                    window._updateQueueUI();
                    _hydrateState(chatId);
                    setTimeout(function() { if ($.chatBox) followToBottom($.chatBox); }, 30);
                }

                var result = _normalizeResumeResult(await _readWithReconnect(pendingCreate ? '' : sid, msgId, chatId, pm, true, _resumeStopController.signal));
                if (result && result.aborted) return false;
                if (result && result.completed) {
                    delete _transientRetryCount[chatId]; // ★ 成功完成,清理瞬态错误重试计数
                    delete pm.partial;
                    delete pm._recovered;
                    pm.content = result.fullText || pm.content || '';
                    pm.reasoning = result.reasoningText || pm.reasoning || '';
                    pm.usage = result.usage;
                    pm.time = pm.time || Date.now();
                    if (!isObserver && Array.isArray(result.toolCalls) && result.toolCalls.length) {
                        var handedOff = await _resumeToolHandoff(result.toolCalls, pm, chatId, isCurrent);
                        if (handedOff) {
                            continuationStarted = isCurrent;
                            return true;
                        }
                    }

                    _clearState(chatId);
                    try { localStorage.removeItem('_savedPartial'); } catch(e) {}
                    slimSaveChats();
                    if (!isObserver) saveChats();
                    // 观察端刚看到的完整流也是本地较新投影；在服务端会话提交传播完成前禁止旧快照回卷。
                    if (isObserver) {
                        window._justProducedStreamMap = window._justProducedStreamMap || {};
                        window._justProducedStreamMap[chatId] = Date.now();
                        _renderObserverToolTimeline(chatId, pm, result.toolCalls || pm._rsToolCalls || [], true);
                        var _observerBubble = activeBubbleMap[chatId];
                        if (_observerBubble) {
                            _observerBubble.classList.remove('typing', 'gen-active', 'streaming');
                            if (window.ModelStatus && typeof window.ModelStatus.removeTypingIndicator === 'function') {
                                window.ModelStatus.removeTypingIndicator(_observerBubble);
                            }
                        }
                        // stream_done 会在服务端会话提交完成后触发最终回源。这里保留实时 DOM，
                        // 避免用尚未传播的旧文件立刻全量重绘导致刚完成的回复闪退。
                    } else if (isCurrent) {
                        loadChat(chatId);
                    }
                    return true;
                }

                // 恢复连接失败时保留已有正文，但绝不自动重放用户请求。自动重放会在
                // 刷新后制造“接续状态”，还可能重复工具调用或重复扣费。
                if (result && result.error) {
                    delete _transientRetryCount[chatId];
                    delete pm.partial;
                    delete pm._recovered;
                    pm._resumeError = result.error;
                    pm.time = pm.time || Date.now();
                    _clearState(chatId);
                    slimSaveChats();
                    if (isCurrent) loadChat(chatId);
                }
                return false;
            } catch(e) {
                console.warn('[RS resume] error:', e.message);
                _clearState(chatId);
                return false;
            } finally {
                if (!continuationStarted) isTypingMap[chatId] = false;
                delete _active[chatId];
                _releaseStopSignal(chatId, _resumeStopController);
                if (!continuationStarted && isCurrent && !_getState(chatId)) {
                    if (typeof window.updateSendStopButtons === 'function') window.updateSendStopButtons(false);
                    else {
                        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
                        if ($.stopBtn) $.stopBtn.classList.remove('visible');
                    }
                }
            }
        }
    };
})();
const ResumeStream = window.ResumeStream;
