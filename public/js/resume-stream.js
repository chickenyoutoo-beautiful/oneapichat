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
        if ((resp.headers.get('content-type')||'').includes('json')) { return null; }

        var reader;
        try { reader = resp.body.getReader(); } catch(e) { return null; }
        if (isResume) { showToast('🔄 续接流式...', 'info'); }

        var buf='', full='', reasoning='', tcList=[], usage=null, done=false;

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
            if (rr.value) buf += new TextDecoder().decode(rr.value, {stream:true});
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
                    // ★ 严格按 ev 类型分发，防止 reasoning delta 被 fallback 当作 content
                    if (ev === 'content') {
                        var dl = d.delta||'';
                        if (dl) { full+=dl; pendingMsg.content=full; applyStreamRender(chatId, full); }
                    } else if (ev === 'reasoning') {
                        var rd = d.delta||'';
                        if (rd) { reasoning+=rd; pendingMsg.reasoning=reasoning; }
                    } else if (ev === 'tool_call' || d.function) {
                        tcList.push(d.function?d:d);
                    } else if (ev === 'done' || d.full_text !== undefined) {
                        full=d.full_text||full; reasoning=d.reasoning_text||reasoning;
                        if (d.tool_calls) tcList=d.tool_calls;
                        if (d.usage) usage=d.usage;
                        done=true;
                    } else if (ev === 'error' || d.error) {
                        console.warn('[RS] stream error:', d.error);
                        done=true;
                    } else if (d.delta && !d.full_text) {
                        // ★ 无 ev 或未知 ev 时的兜底：当作 content 处理
                        var dl2 = d.delta||'';
                        if (dl2) { full+=dl2; pendingMsg.content=full; applyStreamRender(chatId, full); }
                    }
                    ev='';
                } catch(e) {}
            }
        }
        clearInterval(timer);
        try { cleanupStreamState(chatId); } catch(e) {}
        return {fullText:full, reasoningText:reasoning, usage:usage, toolCalls:tcList};
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
            if (!sid || sid.indexOf('pending_')===0) return false;

            var scid = localStorage.getItem('_rs_cid')||'';
            if (scid && scid !== 'pending' && scid !== chatId) chatId = scid;

            var ts = parseInt(localStorage.getItem('_rs_ts')||'0');
            // ★ TTL 放宽到 60min（引擎 _resumable 也是 30min，但 StreamBuffer 磁盘持久化更长）
            if (Date.now() - ts > 3600000) return false;

            if (_active[chatId]) return false;
            _active[chatId] = true;
            try {
                if (!chats[chatId]) return false;
                var msgs = chats[chatId].messages;
                var pm = msgs.find(function(m){return m.partial;});
                if (!pm) {
                    pm = {role:'assistant',content:'',reasoning:'',partial:true,_recovered:true};
                    var sp = JSON.parse(localStorage.getItem('_savedPartial')||'null');
                    if (sp && sp.content) pm.content = sp.content;
                    if (sp && sp.reasoning) pm.reasoning = sp.reasoning;
                    msgs.push(pm);
                }
                var result = await _readSSE(sid, chatId, pm, true);
                if (result && (result.fullText || result.toolCalls.length > 0)) {
                    delete pm.partial;
                    pm.content = result.fullText || pm.content || '';
                    pm.reasoning = result.reasoningText || '';
                    pm.usage = result.usage;
                    if (currentChatId === chatId) loadChat(chatId);
                    saveChats();
                    return true;
                }
                // 续接失败：清理临时消息
                var fi = msgs.findIndex(function(m){return m.partial && m._recovered;});
                if (fi !== -1) msgs.splice(fi, 1);
                return false;
            } catch(e) { return false; }
            finally { delete _active[chatId]; }
        }
    };
})();
const ResumeStream = window.ResumeStream;
