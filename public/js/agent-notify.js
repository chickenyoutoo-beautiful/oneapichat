// agent-notify.js — Agent 通知与轮询 v1.0 (Phase 4)
// Agent 通知队列 / 聊天室实时更新 / Feature 4

// ==================== Agent 通知与轮询系统 ====================
// ==================== 代理聊天室实时更新 (Feature 4) ====================
var _agentPollTimer = null;
var _agentPanelRefreshTimer = null;
const _agentChatPollTimer = null;
let _selectedAgentName = null;
const _lastAgentListJson = '';

async function _agentFetchJson(url, options, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, timeoutMs || 30000);
    var opts = Object.assign({}, options || {});
    opts.signal = controller.signal;
    try {
        var response = await fetch(url, opts);
        var contentType = response.headers.get('content-type') || '';
        if (!response.ok) {
            var errorText = '';
            try { errorText = await response.text(); } catch(e) {}
            var error = new Error('HTTP ' + response.status + (errorText ? ': ' + errorText.substring(0, 300) : ''));
            error.status = response.status;
            throw error;
        }
        if (contentType.toLowerCase().indexOf('application/json') === -1) {
            throw new Error('Expected JSON response, got ' + (contentType || 'unknown content type'));
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 开始代理聊天室实时更新
 * - 代理列表每3秒轮询
 * - 选中代理的聊天内容自动同步
 * - 新消息通知红点
 * - 代理运行中脉冲动画
 */
window.startAgentRealtimeUpdates = function() {
    // 启动现有轮询(15s)
    // 延迟到 restoreUserData 完成后启动

    // 新增: 3秒快速轮询代理列表
    if (!_agentPanelRefreshTimer) {
        _agentPanelRefreshTimer = setInterval(function() {
            if (!getAuthToken()) return;
            window._refreshAllAgentLists();
            // 如果有选中代理,自动同步聊天内容
            if (_selectedAgentName) {
                window.syncAgentChat(_selectedAgentName);
            }
        }, 3000);
    }

    // 红点通知脉冲
    var dot = getEl('agentNotifDot');
    if (dot) {
        dot.classList.add('pulse');
    }

    // 给所有运行中的代理添加脉冲动画
    _applyRunningAgentAnimation();
};

window.stopAgentRealtimeUpdates = function() {
    window.stopAgentNotificationPolling();
    if (_agentPanelRefreshTimer) {
        clearInterval(_agentPanelRefreshTimer);
        _agentPanelRefreshTimer = null;
    }
};

/**
 * 同步选中代理的聊天内容
 */
window.syncAgentChat = function(agentName) {
    if (!agentName || !_selectedAgentName) return;
    if (agentName !== _selectedAgentName) return;

    var msgArea = getEl('agentChatMessages');
    if (!msgArea) return;

    var key = 'agent_chat_' + agentName;
    var msgs = JSON.parse(localStorage.getItem(key) || '[]');
    if (msgs.length > 0) {
        var html = msgs.map(function(m, idx) {
            var roleClass = m.role === 'user' ? 'role-user' : 'role-assistant';
            var timeStr = m.time ? new Date(m.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) : '';
            var content = (m.content || '');
            var isError = content.indexOf('失败:') === 0 || content.indexOf('错误:') === 0;
            var contentPreview = content.substring(0, 3000);
            var bubbleStyle = isError ? 'border-left:3px solid #ef4444;' : '';
            var label = m.role === 'user' ? '你' : (idx === msgs.length - 1 ? '✅ ' + escapeHtml(agentName) + ' · 最终结果' : escapeHtml(agentName));
            return '<div class="agent-chat-bubble ' + roleClass + '" style="' + bubbleStyle + '">' +
                '<div class="text-xs text-gray-400 mb-1">' + label + (timeStr ? ' · ' + timeStr : '') + '</div>' +
                '<div class="text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300">' + escapeHtml(contentPreview) + '</div>' +
                '</div>';
        }).join('');

        if (msgArea.innerHTML !== html) {
            msgArea.innerHTML = html;
            msgArea.scrollTop = msgArea.scrollHeight;
        }
    }
};

/**
 * 为运行中的代理应用脉冲动画
 */
function _applyRunningAgentAnimation() {
    var runningDots = document.querySelectorAll('.agent-sub-dot.running');
    runningDots.forEach(function(dot) {
        if (!dot.style.animation) {
            dot.style.animation = 'agent-pulse 1.5s ease-in-out infinite';
        }
    });
}

// 在 _renderAgentList 后触发动画
(function() {
    var _origRender = window._renderAgentList;
    if (_origRender) {
        var _wrapped = function(agents, container) {
            _origRender(agents, container);
            setTimeout(_applyRunningAgentAnimation, 100);
        };
        window._renderAgentList = _wrapped;
    }
})();

function ensureChatExists() {
    // ★ 严格分隔: 当前聊天缺失或不在当前模式域内时,只加载同域最新聊天
    var _agentView = (typeof isAgentToolsActive === 'function') ? isAgentToolsActive() : false;
    var _currentOk = currentChatId && chats[currentChatId] && (isAgentChat(currentChatId) === _agentView);
    if (!_currentOk) {
        var _uid = localStorage.getItem('authUserId') || '';
        var keys = Object.keys(chats).filter(function(id) {
            if (isAgentChat(id) !== _agentView) return false;
            return !_uid || !chats[id].userId || chats[id].userId === _uid;
        }).sort(function(a, b) {
            var ta = typeof getChatTimestamp === 'function' ? getChatTimestamp(chats[a], a) : (Number(chats[a].updated_at) || 0);
            var tb = typeof getChatTimestamp === 'function' ? getChatTimestamp(chats[b], b) : (Number(chats[b].updated_at) || 0);
            return tb - ta;
        });
        if (keys.length > 0) {
            loadChat(keys[0]);
        } else {
            createNewChat();
        }
    }
}

window.startAgentNotificationPolling = function() {
    if (_agentPollTimer) return;
    ensureChatExists();
    _agentPollTimer = setInterval(window.checkAgentNotifications, 30000);  // ★ P0: SSE即时推送,轮询降级为30s后备
    window.checkAgentNotifications();
};

window.stopAgentNotificationPolling = function() {
    if (_agentPollTimer) { clearInterval(_agentPollTimer); _agentPollTimer = null; }
};

// ═══════════════════════════════════════════════════════════════
// SSE 事件总线 — 实时跨浏览器同步
// ═══════════════════════════════════════════════════════════════

var _sseChannel = null;
// 同一标签页刷新后保持 source id，避免把自己刷新前广播的事件识别成“其他设备”。
var _storedSSESourceId = '';
try { _storedSSESourceId = sessionStorage.getItem('_oacSseSourceId') || ''; } catch(e) {}
window._sseSourceId = _storedSSESourceId || ('browser_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
try { sessionStorage.setItem('_oacSseSourceId', window._sseSourceId); } catch(e) {}
var _lastChatSyncBroadcast = 0;
var _sseCatchupTimer = null;
var _sseReplayCutoff = 0;
var _remoteAgentModeTimer = null;
var _remoteAgentModePending = null;
var _remoteStreamToastAt = Object.create(null);
var _lastSSEEventId = 0;
var _missingChatConfirmations = Object.create(null);

function _acceptOrderedSSEEvent(event) {
    var eventId = parseInt(event && event.lastEventId ? event.lastEventId : '0', 10) || 0;
    if (!eventId) return true;
    if (eventId <= _lastSSEEventId) return false;
    _lastSSEEventId = eventId;
    return true;
}

function _isReplayedSSEEvent(event) {
    var eventId = parseInt(event && event.lastEventId ? event.lastEventId : '0', 10) || 0;
    return eventId > 0 && _sseReplayCutoff > 0 && eventId <= _sseReplayCutoff;
}

window.connectSSEChannel = function() {
    var uid = localStorage.getItem('authUserId') || '';
    if (!uid) return;
    var token = (typeof getAuthToken === 'function' ? getAuthToken() : null) || localStorage.getItem('authToken') || '';
    if (_sseChannel) { try { _sseChannel.close(); } catch(e) {} }
    // ★ 多端同步: 上报当前 agent 模式,让引擎同步给其他设备
    var currentMode = (typeof getAgentMode === 'function') ? getAgentMode() : 'off';
    var _connectTraceId = '';
    try { if (window.SyncTrace && SyncTrace.enabled()) _connectTraceId = SyncTrace.id('sse-connect'); } catch(e) {}
    var url = window.location.origin + '/engine/events?user_id=' + encodeURIComponent(uid) + '&agent_mode=' + encodeURIComponent(currentMode) + '&source=' + encodeURIComponent(window._sseSourceId || '') + (_connectTraceId ? '&sync_trace=' + encodeURIComponent(_connectTraceId) : '') + (token ? '&auth_token=' + encodeURIComponent(token) : '');
    if (_connectTraceId) SyncTrace.log('sse_connect_start', { trace_id: _connectTraceId, uid: uid, source: window._sseSourceId || '', mode: currentMode });
    _sseChannel = new EventSource(url);
    _sseChannel.onerror = function() {
        window._sseDisconnected = true;
        try { if (window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('sse_error', { trace_id: _connectTraceId, ready_state: _sseChannel && _sseChannel.readyState }); } catch(e) {}
        // EventSource 会自动重连；断线期间用低频快照兜底，避免丢失完成/错误事件。
        if (!_sseCatchupTimer) {
            _sseCatchupTimer = setInterval(function() {
                var cid = currentChatId;
                var _detached = !!(window._rsTransportDetached && cid && window._rsTransportDetached[cid]);
                if (cid && (_detached || !(typeof isTypingMap !== 'undefined' && isTypingMap[cid]))) {
                    _syncChatFromServer(cid).then(function(ok) {
                        if (!ok) return;
                        if (cid === currentChatId && typeof loadChat === 'function') loadChat(cid);
                    });
                }
            }, 8000);
        }
    };

    _sseChannel.addEventListener('connected', function(e) {
        console.log('[SSE] Channel connected');
        window._sseDisconnected = false;
        // ★ 多端同步: 检查引擎返回的 agent_mode(来自其他设备)
        try {
            var evData = JSON.parse(e.data);
            try { if (window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('sse_connected', {
                trace_id: _connectTraceId, cursor: evData.cursor, replay: !!evData.replay,
                replay_count: evData.replay_count || 0, source: window._sseSourceId || ''
            }); } catch(_traceErr) {}
            // 重连时 connected.cursor 是随后回放批次的上界；回放事件可同步数据，但不重复弹 Toast。
            _sseReplayCutoff = evData.replay ? (parseInt(evData.cursor || '0', 10) || 0) : 0;
            // connected 已携带服务端最终模式，但重连快照可能早于本机刚完成的选择。
            if (typeof evData.agent_mode === 'string' && evData.agent_mode && evData.agent_mode !== currentMode) {
                var prevMode = localStorage.getItem('agentMode') || 'off';
                var remoteTs = evData.ts || evData.updated_at || evData.mode_ts || 0;
                var canApply = typeof window._shouldApplyRemoteAgentMode !== 'function' || window._shouldApplyRemoteAgentMode(remoteTs);
                if (canApply && evData.agent_mode !== prevMode) {
                    console.log('[SSE] Syncing final agent mode from server:', evData.agent_mode);
                    localStorage.setItem('agentMode', evData.agent_mode);
                    if (typeof updateAgentUI === 'function') updateAgentUI();
                    if (typeof renderToolPanel === 'function') renderToolPanel();
                } else if (!canApply) {
                    console.log('[SSE] Ignoring stale final agent mode:', evData.agent_mode);
                }
                if (canApply) currentMode = evData.agent_mode;
            }
        } catch(_sce) {}
        // 自动重连用游标回放补事件；完整刷新则以服务器快照补齐，不重放旧通知。
        if (_sseCatchupTimer) { clearInterval(_sseCatchupTimer); _sseCatchupTimer = null; }
        // 每次连接/重连先补服务器轻量会话索引，使其他设备刚创建的会话立即出现在侧栏。
        _syncChatIndexFromServer();
        if (currentChatId) {
            // ★ 修复: 空白草稿或未保存会话不发起服务端回源(避免刚打开新会话时无谓报 404)
            var _currChat = window.chats && window.chats[currentChatId];
            var _checker = window._hasMeaningfulChatContent || (typeof _hasMeaningfulChatContent === 'function' ? _hasMeaningfulChatContent : null);
            var _isDraft = _currChat && !_currChat._localIndex && !_currChat._indexOnly && !(_currChat.msgCount > 0) &&
                (_checker ? !_checker(_currChat) : (!_currChat.messages || _currChat.messages.length <= 1));
            if (!_isDraft) {
                _resyncChatFromRemote(currentChatId);
            }
        }
        // ★ 兜底安全网: 启动(幂等)SSE 断线轮询, 保证任何情况下都能补到最新消息。
        if (typeof _startRemoteChatWatch === 'function') _startRemoteChatWatch();
    });

    // ★ 多端同步: 轻量拉取服务器会话索引。单会话事件只能更新本地已知 ID；
    // 另一设备新建 Agent 归档/普通会话时，本设备此前不知道其 ID，必须先合并 meta 索引。
    var _chatIndexSyncInFlight = false;
    async function _syncChatIndexFromServer() {
        if (_chatIndexSyncInFlight) return false;
        _chatIndexSyncInFlight = true;
        try {
            var token = (typeof getAuthToken === 'function' ? getAuthToken() : null) || localStorage.getItem('authToken') || '';
            if (!token) return false;
            var apiBase = (typeof SERVER_API_BASE !== 'undefined' ? SERVER_API_BASE : '/oneapichat/api');
            var resp = await fetch(apiBase + '/chat.php?chat_id=all&meta=1', {
                cache: 'no-store', headers: { Authorization: 'Bearer ' + token }
            });
            if (!resp.ok) return false;
            var payload = await resp.json();
            var meta = payload && payload.chats ? payload.chats : {};
            var remoteDeleted = payload && payload.deleted ? payload.deleted : {};
            var changed = false;
            if (!window.chats) window.chats = {};
            // 同步服务端墓碑，清理本地残留的已删除会话
            if (remoteDeleted && typeof remoteDeleted === 'object') {
                window._deletedChatIds = window._deletedChatIds || {};
                Object.keys(remoteDeleted).forEach(function(did) {
                    window._deletedChatIds[did] = true;
                    if (window.chats[did]) {
                        delete window.chats[did];
                        changed = true;
                    }
                });
                try { localStorage.setItem('_deletedChatIds', JSON.stringify(window._deletedChatIds)); } catch(e) {}
            }
            Object.keys(meta).forEach(function(cid) {
                if (window._deletedChatIds && window._deletedChatIds[cid]) return;
                var m = meta[cid] || {};
                var local = window.chats[cid];
                if (!local) {
                    window.chats[cid] = {
                        title: m.title || '新对话', updated_at: m.updated_at || 0,
                        revision: m.revision || m.msg_count || 0,
                        msgCount: m.msg_count || 0, userId: localStorage.getItem('authUserId') || '',
                        messages: [], _localIndex: true
                    };
                    changed = true;
                    return;
                }
                var localTs = typeof local.updated_at === 'number' ? local.updated_at : Date.parse(local.updated_at) || 0;
                var remoteTs = typeof m.updated_at === 'number' ? m.updated_at : Date.parse(m.updated_at) || 0;
                if (remoteTs >= localTs) {
                    if (m.title && local.title !== m.title) { local.title = m.title; changed = true; }
                    if (remoteTs > localTs) { local.updated_at = m.updated_at; changed = true; }
                    local.revision = Math.max(Number(local.revision || 0), Number(m.revision || m.msg_count || 0));
                    local.msgCount = m.msg_count || local.msgCount || 0;
                }
            });
            if (changed) {
                try { if (typeof slimSaveChats === 'function') slimSaveChats(); } catch(e) {}
                if (typeof renderChatHistory === 'function') renderChatHistory();
                if (typeof updateHeaderTitle === 'function') updateHeaderTitle();
                // 如果当前打开的会话刚刚从远端索引更新了消息数且当前界面为空/缺失，触发当前会话回源渲染
                if (currentChatId && meta[currentChatId]) {
                    var _curMeta = meta[currentChatId];
                    var _curChatLocal = window.chats[currentChatId];
                    var _isCurGenerating = !!(typeof isTypingMap !== 'undefined' && isTypingMap[currentChatId]);
                    if (!_isCurGenerating && _curChatLocal && (_curChatLocal._localIndex || (_curMeta.msg_count > (_curChatLocal.messages ? _curChatLocal.messages.length : 0)))) {
                        _resyncChatFromRemote(currentChatId);
                    }
                }
            }
            return changed;
        } catch(e) {
            console.warn('[SSE] _syncChatIndexFromServer failed:', e.message);
            return false;
        } finally {
            _chatIndexSyncInFlight = false;
        }
    }
    window._syncChatIndexFromServer = _syncChatIndexFromServer;

    function _messageStableId(message, index) {
        if (!message || typeof message !== 'object') return 'invalid:' + index;
        if (message.id || message.message_id || message._rsMsgId) return String(message.id || message.message_id || message._rsMsgId);
        var raw = [message.role || '', message.text || message.content || '', message.tool_call_id || '', index].join('|');
        var hash = 2166136261;
        for (var i = 0; i < raw.length; i++) { hash ^= raw.charCodeAt(i); hash = Math.imul(hash, 16777619); }
        return 'legacy:' + (hash >>> 0).toString(36);
    }

    function _mergeMessageView(base, incoming) {
        var result = Object.assign({}, base || {}, incoming || {});
        if (base && base.generatedImage && !result.generatedImage) result.generatedImage = base.generatedImage;
        if (typeof window._mergeGeneratedImageFields === 'function') window._mergeGeneratedImageFields(result, base || {});
        if (typeof window._mergeGeneratedImageFields === 'function') window._mergeGeneratedImageFields(result, incoming || {});
        if (incoming && !incoming.partial) { delete result.partial; delete result._recovered; }
        return result;
    }

    function _mergeServerChatPreservingLive(localChat, serverChat, observerMessageId) {
        if (!localChat) return JSON.parse(JSON.stringify(serverChat));
        var localMessages = Array.isArray(localChat.messages) ? localChat.messages : [];
        var serverMessages = Array.isArray(serverChat.messages) ? serverChat.messages : [];
        var liveMessages = localMessages.filter(function(message) {
            if (!message || message.role !== 'assistant') return false;
            return !!(message._remoteObserver || message.partial || (observerMessageId && _messageStableId(message, 0) === observerMessageId));
        });
        var mergedMessages = [];
        var positions = Object.create(null);
        serverMessages.forEach(function(message, index) {
            var cloned = JSON.parse(JSON.stringify(message));
            var key = _messageStableId(cloned, index);
            cloned.id = cloned.id || key;
            positions[key] = mergedMessages.length;
            mergedMessages.push(cloned);
        });
        localMessages.forEach(function(message, index) {
            var key = _messageStableId(message, index);
            if (positions[key] !== undefined) {
                mergedMessages[positions[key]] = _mergeMessageView(mergedMessages[positions[key]], message);
            } else if (message.role === 'user' || liveMessages.indexOf(message) !== -1) {
                positions[key] = mergedMessages.length;
                mergedMessages.push(message);
            }
        });
        var merged = Object.assign({}, localChat, serverChat, { messages: mergedMessages });
        merged.revision = Math.max(Number(localChat.revision || 0), Number(serverChat.revision || 0), mergedMessages.length);
        merged.updated_at = Math.max(Number(localChat.updated_at || 0), Number(serverChat.updated_at || 0));
        return merged;
    }

    // ★ 多端同步: 拉取单个会话的服务器权威版本，避免 all.json 大包和错误的“前面追加”合并
    var _chatSyncInFlight = Object.create(null);
    async function _syncChatFromServer(chatId, retryDelay, traceId) {
        if (!chatId || _chatSyncInFlight[chatId]) {
            try { if (traceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('sync_skipped_inflight', { trace_id: traceId, chat_id: chatId, in_flight: !!_chatSyncInFlight[chatId] }); } catch(e) {}
            return false;
        }

        // ★ 发送端(Producer)权威保护: 正在流式生成或刚完成生成的 4 秒内拒绝任何远程回源覆盖
        var _now = Date.now();
        var _resumeState = window.ResumeStream && typeof window.ResumeStream.peek === 'function' ? window.ResumeStream.peek(chatId) : null;
        var _isObserverStreaming = !!(_resumeState && _resumeState._observer);
        var _isLocalProducerStreaming = !!(
            window._activeStreamChatId === chatId ||
            (!_isObserverStreaming && ((typeof isTypingMap !== 'undefined' && isTypingMap[chatId]) ||
                (window.ResumeStream && typeof window.ResumeStream.hasState === 'function' && window.ResumeStream.hasState(chatId))))
        );
        var _justProduced = window._justProducedStreamMap && window._justProducedStreamMap[chatId] && (_now - window._justProducedStreamMap[chatId] < 8000);

        var localChat = window.chats[chatId];
        var localMsgs = (localChat && Array.isArray(localChat.messages)) ? localChat.messages : [];

        // ★ 空白草稿防御：本地新建尚未提交到服务端的纯草稿会话，不发起服务端网络请求
        var _meaningfulChecker = window._hasMeaningfulChatContent || (typeof _hasMeaningfulChatContent === 'function' ? _hasMeaningfulChatContent : null);
        var _isLocalDraft = localChat && !localChat._localIndex && !localChat._indexOnly && !(localChat.msgCount > 0) &&
            (_meaningfulChecker ? !_meaningfulChecker(localChat) : (localMsgs.length <= 1 && (!localMsgs[0] || localMsgs[0].role === 'system')));
        if (_isLocalDraft && !_justProduced) {
            return { ok: true, isDraft: true };
        }

        if (_isLocalProducerStreaming) {
            try { if (traceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('sync_blocked_local_stream', { trace_id: traceId, chat_id: chatId, local_msg_count: localMsgs.length }); } catch(e) {}
            return false;
        }

        _chatSyncInFlight[chatId] = true;
        try {
            var token = (typeof getAuthToken === 'function' ? getAuthToken() : null) || localStorage.getItem('authToken') || '';
            if (!token) return false;
            var apiBase = (typeof SERVER_API_BASE !== 'undefined' ? SERVER_API_BASE : '/oneapichat/api');
            var url = apiBase + '/chat.php?chat_id=' + encodeURIComponent(chatId) + (traceId ? '&sync_trace=' + encodeURIComponent(traceId) : '');
            try { if (traceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('sync_fetch_start', { trace_id: traceId, chat_id: chatId, retry: !!retryDelay, current_chat_id: currentChatId || '' }); } catch(e) {}

            var _ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var _tmo = _ctrl ? setTimeout(function() { if (_ctrl) _ctrl.abort(); }, 12000) : null;
            var resp;
            try {
                resp = await fetch(url, { cache: 'no-store', headers: { Authorization: 'Bearer ' + token }, signal: _ctrl ? _ctrl.signal : undefined });
            } finally {
                if (_tmo) clearTimeout(_tmo);
            }
            var serverChat = null;
            if (resp.status === 404) {
                // 旧数据可能只存在 all.json，单会话文件不存在不等于会话消失。
                var _ctrl2 = (typeof AbortController !== 'undefined') ? new AbortController() : null;
                var _tmo2 = _ctrl2 ? setTimeout(function() { if (_ctrl2) _ctrl2.abort(); }, 10000) : null;
                var allResp;
                try {
                    allResp = await fetch(apiBase + '/chat.php?chat_id=all', {
                        cache: 'no-store', headers: { Authorization: 'Bearer ' + token }, signal: _ctrl2 ? _ctrl2.signal : undefined
                    });
                } finally {
                    if (_tmo2) clearTimeout(_tmo2);
                }
                if (allResp.ok) {
                    var allData = await allResp.json();
                    serverChat = allData && allData.chats ? allData.chats[chatId] : null;
                }
                if (!serverChat) {
                    // 普通 404 只表示当前快照尚未出现/已迁移，不能自行创造删除事实。只有
                    // chat:deleted 或服务端 meta.deleted 墓碑才允许移除会话。
                    _missingChatConfirmations[chatId] = (_missingChatConfirmations[chatId] || 0) + 1;
                    var _knownDeleted = !!(window._deletedChatIds && window._deletedChatIds[chatId]);
                    if (_knownDeleted) return { ok: false, notFound: true, deleted: true };
                    // ★ 确认缺失或本地无实质内容时返回 notFound 阻断无意义的循环重试
                    var _hasContent = _meaningfulChecker ? _meaningfulChecker(localChat) : (localMsgs.length > 0);
                    if (!_hasContent || _missingChatConfirmations[chatId] >= 1) {
                        return { ok: false, notFound: true, missing: true, missingCount: _missingChatConfirmations[chatId] };
                    }
                    return { ok: false, missing: true, missingCount: _missingChatConfirmations[chatId] };
                }
            } else {
                if (!resp.ok) return false;
                serverChat = await resp.json();
            }
            if (!serverChat || !Array.isArray(serverChat.messages)) return false;
            delete _missingChatConfirmations[chatId];
            if (typeof window._ensureChatMessageIds === 'function') {
                window._ensureChatMessageIds(serverChat, chatId);
                if (localChat) window._ensureChatMessageIds(localChat, chatId);
            }
            var serverMsgs = serverChat.messages;

            // ★ 本端刚完成生成且本地拥有完整回复时，若服务器返回的消息比本地更少，说明最终提交仍在传播，坚决不覆盖！
            if (_justProduced && localMsgs.length > serverMsgs.length) {
                try { if (traceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('sync_blocked_producer_newer', { trace_id: traceId, chat_id: chatId, local_count: localMsgs.length, server_count: serverMsgs.length }); } catch(e) {}
                return false;
            }

            var _serverLast = serverMsgs.length ? serverMsgs[serverMsgs.length - 1] : null;
            var _localCountBefore = localMsgs.length;
            try { if (traceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('sync_fetch_result', {
                trace_id: traceId, chat_id: chatId, status: resp.status,
                server_msg_count: serverMsgs.length, local_msg_count: _localCountBefore,
                server_updated_at: serverChat.updated_at || '', last_role: _serverLast && _serverLast.role || '',
                last_partial: !!(_serverLast && _serverLast.partial), last_size: _serverLast ? String(_serverLast.content || _serverLast.text || '').length : 0
            }); } catch(e) {}

            // ★ 差异检测：判断内容是否真正改变，避免无意义的 DOM 清空重建（彻底杜绝界面反复刷新闪烁）
            var _localSign = JSON.stringify(localMsgs.map(function(m) {
                return { role: m.role, text: m.text || '', content: m.content || '', partial: !!m.partial };
            }));
            var _serverSign = JSON.stringify(serverMsgs.map(function(m) {
                return { role: m.role, text: m.text || '', content: m.content || '', partial: !!m.partial };
            }));
            var _hasMeaningfulChange = (_localSign !== _serverSign) || (localChat && localChat.title !== serverChat.title);

            // Observer 流进行中时允许补齐远端用户消息，但保留当前活跃 assistant 对象；
            // 非流式状态也按稳定 message id 合并，绝不让消息数更少/修订更旧的快照整树覆盖。
            var _serverRevision = Math.max(Number(serverChat.revision || 0), serverMsgs.length);
            var _localRevision = Math.max(Number(localChat && localChat.revision || 0), localMsgs.length);
            var _expectedRemoteRevision = Number(localChat && localChat._expectedRemoteRevision || 0);
            if (_expectedRemoteRevision && _serverRevision < _expectedRemoteRevision) {
                return { ok: false, stale: true, expectedRevision: _expectedRemoteRevision, serverRevision: _serverRevision };
            }
            var _serverUpdated = Number(serverChat.updated_at || 0);
            var _localUpdated = Number(localChat && localChat.updated_at || 0);
            var _serverClearlyOlder = !!(localChat && (_serverRevision < _localRevision ||
                (_serverRevision === _localRevision && _serverUpdated > 0 && _localUpdated > _serverUpdated)));
            if (_serverClearlyOlder) {
                try { if (traceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('sync_blocked_older_revision', { trace_id: traceId, chat_id: chatId, local_revision: _localRevision, server_revision: _serverRevision, local_updated_at: _localUpdated, server_updated_at: _serverUpdated }); } catch(e) {}
                return { ok: false, stale: true };
            }
            window.chats[chatId] = _mergeServerChatPreservingLive(localChat, serverChat, _resumeState && _resumeState.msgId || '');
            delete window.chats[chatId]._expectedRemoteRevision;
            if (window._rsTransportDetached && _serverRevision >= _expectedRemoteRevision) delete window._rsTransportDetached[chatId];
            if (localChat && localChat.userId && !window.chats[chatId].userId) {
                window.chats[chatId].userId = localChat.userId;
            }
            try { if (typeof slimSaveChats === 'function') slimSaveChats(); } catch(e) {}
            try { if (traceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('sync_applied', { trace_id: traceId, chat_id: chatId, msg_count: serverMsgs.length, changed: _hasMeaningfulChange, current_chat_id: currentChatId || '' }); } catch(e) {}
            console.log('[SSE] _syncChatFromServer OK: chatId=' + chatId + ' msgs=' + serverMsgs.length + ' changed=' + _hasMeaningfulChange);
            return { ok: true, changed: _hasMeaningfulChange, msgCount: serverMsgs.length };
        } catch(e) {
            var _isAbort = e && (e.name === 'AbortError' || /aborted|timeout/i.test(String(e.message || '')));
            if (!_isAbort) {
                try { if (traceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('sync_fetch_failed', { trace_id: traceId, chat_id: chatId, error: e && e.message || String(e), name: e && e.name || '' }); } catch(_traceErr) {}
                console.warn('[SSE] _syncChatFromServer failed:', e.message);
            }
            return false;
        } finally {
            _chatSyncInFlight[chatId] = false;
        }
    }

    // ★ 多端同步健壮封装: 回源会话并仅在内容变更时重绘; 避免重复重建引发闪烁
    function _resyncChatFromRemote(cid, attempt, traceId) {
        if (!cid) return Promise.resolve(false);
        attempt = attempt || 0;
        traceId = traceId || (function() { try { return window.SyncTrace && SyncTrace.enabled() ? SyncTrace.id('resync:' + cid) : ''; } catch(e) { return ''; } })();
        try { if (traceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('resync_begin', { trace_id: traceId, chat_id: cid, attempt: attempt, current_chat_id: currentChatId || '' }); } catch(e) {}
        return _syncChatFromServer(cid, false, traceId).then(function(res) {
            var ok = res && (res === true || res.ok);
            var changed = res && res.changed;
            if (ok) {
                var _isLiveGenerating = !!(typeof isTypingMap !== 'undefined' && isTypingMap[cid] && !(window._rsTransportDetached && window._rsTransportDetached[cid]));
                // 流式进行中时，DOM 正在由实时流打字机（ResumeStream/main.js）顺畅绘制，
                // 严禁在此期间全量清空重建 DOM，否则会将正在动画中的气泡清空并引发闪烁/空气泡！
                // ★ 关键修复：当内容确实改变（如接收端收到发送端发出的新消息/生成完毕的完整回复）且不在本端实时生成中时，
                // 必须立即调用 loadChat(currentChatId) 刷新 DOM，使新消息/回复无需手动按 F5 刷新即刻呈现！
                if (cid === currentChatId && !_isLiveGenerating && typeof loadChat === 'function') {
                    var _renderedCount = document.querySelectorAll('#chatMessagesContainer .message-row').length;
                    var _actualCount = (window.chats[cid] && Array.isArray(window.chats[cid].messages)) ? window.chats[cid].messages.length : 0;
                    if (changed || _renderedCount === 0 || _actualCount > _renderedCount) {
                        try { localStorage.removeItem('_wsStreamId'); } catch(e) {}
                        try { localStorage.removeItem('_wsChunkCount'); } catch(e) {}
                        try { if (traceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('render_start', { trace_id: traceId, chat_id: cid, current_chat_id: currentChatId || '', msg_count: _actualCount }); } catch(e) {}
                        loadChat(currentChatId);
                        setTimeout(function() {
                            try {
                                if (!traceId || !window.SyncTrace || !SyncTrace.enabled()) return;
                                var renderedUsers = document.querySelectorAll('#chatMessagesContainer .bubble.user, #chatMessagesContainer .message.user, #chatMessagesContainer [data-role="user"]').length;
                                var renderedAssistants = document.querySelectorAll('#chatMessagesContainer .bubble.assistant, #chatMessagesContainer .message.assistant, #chatMessagesContainer [data-role="assistant"]').length;
                                SyncTrace.log('render_done', { trace_id: traceId, chat_id: cid, current_chat_id: currentChatId || '', rendered_users: renderedUsers, rendered_assistants: renderedAssistants, html_size: ($.chatMessagesContainer && $.chatMessagesContainer.innerHTML || '').length });
                            } catch(e) {}
                        }, 0);
                    }
                }
                if (typeof renderChatHistory === 'function') renderChatHistory();
                return true;
            }
            if (res && (res.notFound || res.isDraft)) {
                // 会话已不存在或为本地空白草稿，放弃后续无效重试
                return false;
            }
            var _typing = (typeof isTypingMap !== 'undefined' && isTypingMap[cid]);
            var _observer = !!(window.ResumeStream && window.ResumeStream.peek && window.ResumeStream.peek(cid) && window.ResumeStream.peek(cid)._observer);
            try { if (traceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('resync_not_applied', { trace_id: traceId, chat_id: cid, attempt: attempt, local_typing: !!_typing, observer: _observer }); } catch(e) {}
            // Observer 允许在流中重试补用户消息；生产端则等待本地提交完成，避免自我覆盖。
            if ((!_typing || _observer) && attempt < 6) {
                setTimeout(function() { _resyncChatFromRemote(cid, attempt + 1, traceId); }, Math.min(5000, 500 * Math.pow(2, attempt)));
            }
            return false;
        });
    }

    // ★ 兜底安全网: 仅当 SSE 断线时, 每 6s 轻量比对当前会话服务端 updated_at, 更新则回源渲染。
    var _remoteWatchTimer = null;
    var _remoteWatchSeen = Object.create(null);
    function _startRemoteChatWatch() {
        if (_remoteWatchTimer) return;
        _remoteWatchTimer = setInterval(function() {
            if (!window._sseDisconnected) return;   // SSE 正常时不轮询, 事件已足够
            var cid = currentChatId;
            if (!cid) return;
            if (typeof isTypingMap !== 'undefined' && isTypingMap[cid] && !(window._rsTransportDetached && window._rsTransportDetached[cid])) return;
            if (!window.chats || !window.chats[cid]) return;
            _syncChatIndexFromServer().then(function() {
                var after = window.chats && window.chats[cid];
                if (!after) return;
                var key = cid + ':' + String(after.updated_at || '');
                if (_remoteWatchSeen[cid] === key) return;   // 无变化
                var hadPrior = (_remoteWatchSeen[cid] !== undefined);
                _remoteWatchSeen[cid] = key;
                if (hadPrior) _resyncChatFromRemote(cid);
            });
        }, 6000);
    }

    _sseChannel.addEventListener('config:changed', function(e) {
        try {
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId) return;
            console.log('[SSE] Config changed from another browser, reloading');
            if (typeof loadConfigFromServer === 'function') {
                loadConfigFromServer().then(function() {
                    if (ev.model) {
                        var _p = ev.provider || localStorage.getItem('baseUrlProvider') || 'custom';
                        localStorage.setItem('model', ev.model);
                        localStorage.setItem('model_' + _p, ev.model);
                        var sel = document.getElementById('modelSelect');
                        if (sel) {
                            var hasOpt = Array.from(sel.options).some(function(o){ return o.value === ev.model; });
                            if (!hasOpt) {
                                var opt = document.createElement('option');
                                opt.value = ev.model; opt.textContent = ev.model;
                                sel.appendChild(opt);
                            }
                            sel.value = ev.model;
                        }
                    }
                    if (typeof window._syncAgentModelCapsule === 'function') window._syncAgentModelCapsule();
                    if (typeof updateModeSelector === 'function') updateModeSelector();
                    if (typeof _updateThinkingIntensityVisibility === 'function') _updateThinkingIntensityVisibility();
                }).catch(function(){});
            }
        } catch(_sce) {}
    });

    _sseChannel.addEventListener('chat:stream_done', function(e) {
        try {
            if (!_acceptOrderedSSEEvent(e)) return;
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId) return;
            // ★ 关键修复: 引擎广播的 chat:stream_done 没有 source 字段，
            // 会触发同一浏览器的 _syncChatFromServer 覆盖正在流式生成的消息数组，
            // 导致 pm 引用孤立 + 刷新后旧截断气泡残留。
            var cid = ev.chat_id || currentChatId;
            if (!cid) return;
            if (window._rsTransportDetached) delete window._rsTransportDetached[cid];
            var _eventTraceId = ev.trace_id || (function(){ try { return window.SyncTrace && SyncTrace.enabled() ? SyncTrace.id('event:stream_done:' + cid) : ''; } catch(e) { return ''; } })();
            try { if (_eventTraceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('event_received', { trace_id: _eventTraceId, event_type: 'chat:stream_done', event_id: e.lastEventId || '', chat_id: cid, source: ev.source || '', status: ev.status || '', current_chat_id: currentChatId || '' }); } catch(_traceErr) {}
            console.log('[SSE] Stream done from another device, syncing chat:', cid);
            var _currentRemote = window._remoteTypingMap && window._remoteTypingMap[cid];
            if (_currentRemote && ev.stream_id && _currentRemote.streamId && _currentRemote.streamId !== ev.stream_id) {
                console.log('[SSE stream_done] 忽略过期的旧流完成事件 stream_id=' + ev.stream_id + ' current=' + _currentRemote.streamId);
                return;
            }
            if (window._remoteTypingMap && window._remoteTypingMap[cid]) delete window._remoteTypingMap[cid];
            var isObserverStreaming = !!(window.ResumeStream && window.ResumeStream.peek && window.ResumeStream.peek(cid) && window.ResumeStream.peek(cid)._observer);
            // 收到后端终态即回收任意本地 reader/脱离态；任务已经完成，不再依赖当前标签。
            if (typeof isTypingMap !== 'undefined') isTypingMap[cid] = false;
            if (window._activeStreamChatId === cid) window._activeStreamChatId = null;
            // ★ 观察端生命周期收敛：收到 stream_done 时，若本端是 Observer 且正在连接流，
            // 立即停止观察端打字态，避免残留红色停止键与挂起的虚假生成态。
            if (isObserverStreaming && typeof isTypingMap !== 'undefined') {
                isTypingMap[cid] = false;
                var _obsBub = (typeof activeBubbleMap !== 'undefined' && activeBubbleMap[cid]) ? activeBubbleMap[cid] : null;
                if (_obsBub) {
                    _obsBub.classList.remove('typing', 'gen-active', 'streaming');
                    if (window.ModelStatus && typeof window.ModelStatus.removeTypingIndicator === 'function') {
                        window.ModelStatus.removeTypingIndicator(_obsBub);
                    }
                }
                if (currentChatId === cid) {
                    if (typeof window.updateSendStopButtons === 'function') {
                        window.updateSendStopButtons(false);
                    } else {
                        var _sBtn = document.getElementById('sendBtn');
                        var _stBtn = document.getElementById('stopBtn');
                        if (_sBtn) _sBtn.classList.remove('hidden');
                        if (_stBtn) { _stBtn.classList.remove('visible'); _stBtn.classList.add('hidden'); }
                    }
                }
            }
            // done 已经带持久化修订，先把本地保护水位提升到该版本，再回源最终投影。
            if (window.chats && window.chats[cid]) {
                window.chats[cid]._expectedRemoteRevision = Math.max(Number(window.chats[cid]._expectedRemoteRevision || 0), Number(ev.revision || 0));
            }
            // 后端现在先提交会话再广播 done；若旧部署/网络传播仍短暂落后，修订屏障与指数重试会保留本地完整回复。
            setTimeout(function() {
                _resyncChatFromRemote(cid, 0, _eventTraceId);
            }, 120);
        } catch(_sce) {}
    });

    // ★ 多端删除同步 (2026-08-02): 其他端删除会话时, 立即移除本地副本 + 删除标记,
    //   防止本地旧 chats 被 saveChatsToServer 写回服务器(配合服务器 deleted 墓碑双保险)
    _sseChannel.addEventListener('chat:deleted', function(e) {
        try {
            if (!_acceptOrderedSSEEvent(e)) return;
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId) return;
            var cid = ev.chat_id;
            if (!cid || !window.chats || !window.chats[cid]) return;
            console.log('[SSE] Chat deleted from another device:', cid);
            window._deletedChatIds = window._deletedChatIds || {};
            window._deletedChatIds[cid] = true;
            try { localStorage.setItem('_deletedChatIds', JSON.stringify(window._deletedChatIds)); } catch(err) {}
            delete window.chats[cid];
            if (typeof slimSaveChats === 'function') slimSaveChats();
            if (typeof renderChatHistory === 'function') renderChatHistory();
            // 当前打开的会话被其他端删除 → 切换到同域其他会话(严格分隔:不跨域加载)
            if (currentChatId === cid) {
                var _delAgentView = (typeof isAgentToolsActive === 'function') ? isAgentToolsActive() : false;
                var _delUid = localStorage.getItem('authUserId') || '';
                var _keys = Object.keys(window.chats || {}).filter(function(id) {
                    if (isAgentChat(id) !== _delAgentView) return false;
                    return !_delUid || !window.chats[id].userId || window.chats[id].userId === _delUid;
                }).sort(function(a, b) {
                    var ta = typeof getChatTimestamp === 'function' ? getChatTimestamp(window.chats[a], a) : (Number((window.chats[a] || {}).updated_at) || 0);
                    var tb = typeof getChatTimestamp === 'function' ? getChatTimestamp(window.chats[b], b) : (Number((window.chats[b] || {}).updated_at) || 0);
                    return tb - ta;
                });
                if (_keys.length && typeof window.loadChat === 'function') window.loadChat(_keys[0]);
                else if (typeof window.createNewChat === 'function') window.createNewChat();
            }
        } catch(err) { /* 静默 */ }
    });

    var _chatSyncDebounceTimers = {};
    _sseChannel.addEventListener('chat:updated', function(e) {
        try {
            if (!_acceptOrderedSSEEvent(e)) return;
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId) return;
            // ★ 关键修复: 同 chat:stream_done，流式生成期间引擎广播会覆盖本地消息数组
            var cid = ev.chat_id || currentChatId;
            if (!cid) return;
            var _eventTraceId = ev.trace_id || (function(){ try { return window.SyncTrace && SyncTrace.enabled() ? SyncTrace.id('event:chat_updated:' + cid) : ''; } catch(e) { return ''; } })();
            try { if (_eventTraceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('event_received', { trace_id: _eventTraceId, event_type: 'chat:updated', event_id: e.lastEventId || '', chat_id: cid, source: ev.source || '', finished: !!ev.finished, current_chat_id: currentChatId || '' }); } catch(_traceErr) {}
            console.log('[SSE] Chat updated from another device:', cid);
            if (ev.finished && window._remoteTypingMap && window._remoteTypingMap[cid]) {
                delete window._remoteTypingMap[cid];
            }
            // 未知 ID 说明另一设备刚创建/归档了会话；先合并轻量索引再同步正文。
            if (!window.chats || !window.chats[cid]) _syncChatIndexFromServer();

            // ★ 修复：严禁后台事件静默篡改 currentChatId 导致当前正在浏览的空草稿被夺舍！
            // 仅对用户当前正在浏览的会话进行回源重绘；其他会话只更新侧边栏索引。
            if (cid === currentChatId) {
                if (_chatSyncDebounceTimers[cid]) clearTimeout(_chatSyncDebounceTimers[cid]);
                _chatSyncDebounceTimers[cid] = setTimeout(function() {
                    delete _chatSyncDebounceTimers[cid];
                    _resyncChatFromRemote(cid, 0, _eventTraceId);
                }, 300);
            } else {
                if (typeof renderChatHistory === 'function') renderChatHistory();
            }
        } catch(_sce) {}
    });

    // ★ 多端同步: 其他设备发送了新消息
    _sseChannel.addEventListener('chat:message_added', function(e) {
        try {
            if (!_acceptOrderedSSEEvent(e)) return;
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId) return;
            // ★ 关键修复: 流式生成期间不处理远程消息同步，防止覆盖本地消息数组
            var cid = ev.chat_id || currentChatId;
            if (!cid) return;
            console.log('[SSE] New message from another device, chat:', cid);
            if (!window.chats || !window.chats[cid]) _syncChatIndexFromServer();
            _resyncChatFromRemote(cid);
        } catch(_sce) {}
    });

    // ★ 多端同步: Agent 模式在其他设备上变更了
    _sseChannel.addEventListener('agent:mode_changed', function(e) {
        try {
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId || _isReplayedSSEEvent(e)) return;
            _remoteAgentModePending = ev.mode || 'off';
            if (_remoteAgentModeTimer) clearTimeout(_remoteAgentModeTimer);
            // 多个模式事件短时间到达时只应用最终状态，避免 off/agent Toast 交替堆叠。
            _remoteAgentModeTimer = setTimeout(function() {
                var newMode = _remoteAgentModePending || 'off';
                _remoteAgentModePending = null;
                _remoteAgentModeTimer = null;
                console.log('[SSE] Agent mode changed from another device:', newMode);
                var prevMode = localStorage.getItem('agentMode') || 'off';
                var remoteTs = ev.ts || ev.updated_at || ev.mode_ts || 0;
                var canApply = typeof window._shouldApplyRemoteAgentMode !== 'function' || window._shouldApplyRemoteAgentMode(remoteTs);
                if (!canApply) {
                    console.log('[SSE] Ignoring stale remote agent mode:', newMode);
                    return;
                }
                if (newMode !== prevMode) {
                    localStorage.setItem('agentMode', newMode);
                    if (newMode !== 'off') localStorage.setItem('agentPreferredMode', newMode);
                    if (typeof updateAgentUI === 'function') updateAgentUI();
                    if (typeof renderToolPanel === 'function') renderToolPanel();
                }
            }, 150);
        } catch(_sce) {}
    });

    // ★ 多端同步: 其他设备开始了流式生成
    _sseChannel.addEventListener('chat:stream_started', function(e) {
        try {
            if (!_acceptOrderedSSEEvent(e)) return;
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId || _isReplayedSSEEvent(e)) return;
            var cid = ev.chat_id || '';
            if (!cid) return;
            var _eventTraceId = ev.trace_id || (function(){ try { return window.SyncTrace && SyncTrace.enabled() ? SyncTrace.id('event:stream_started:' + cid) : ''; } catch(e) { return ''; } })();
            try { if (_eventTraceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('event_received', { trace_id: _eventTraceId, event_type: 'chat:stream_started', event_id: e.lastEventId || '', chat_id: cid, source: ev.source || '', stream_id: ev.stream_id || '', current_chat_id: currentChatId || '' }); } catch(_traceErr) {}
            console.log('[SSE] Stream started in another device, chat:', cid);
            var _now = Date.now();
            var _hasLocalStream = !!(
                (typeof isTypingMap !== 'undefined' && isTypingMap[cid]) ||
                window._activeStreamChatId === cid ||
                (window._justProducedStreamMap && window._justProducedStreamMap[cid] && (_now - window._justProducedStreamMap[cid] < 4500)) ||
                (window.ResumeStream && typeof window.ResumeStream.hasState === 'function' && window.ResumeStream.hasState(cid))
            );
            if (!_hasLocalStream) {
                // 记录远程设备正在生成状态
                window._remoteTypingMap = window._remoteTypingMap || {};
                window._remoteTypingMap[cid] = { startedAt: Date.now(), model: ev.model || '', streamId: ev.stream_id || '' };

                // ★ 修复：严禁后台事件静默将 currentChatId 篡改为远程 cid！
                // 仅当用户当前真正打开的就是 cid 时，才启动 Observer 实时流与回源补齐
                if (currentChatId === cid) {
                    if (ev.stream_id && window.ResumeStream && typeof window.ResumeStream.resume === 'function') {
                        var _isProducerGenerating = !!(window._justProducedStreamMap && window._justProducedStreamMap[cid] && (Date.now() - window._justProducedStreamMap[cid] < 4500));
                        var _isAlreadyResuming = !!(typeof isTypingMap !== 'undefined' && isTypingMap[cid] && !_isProducerGenerating);
                        if (!_isAlreadyResuming && !_isProducerGenerating) {
                            console.log('[SSE] Connecting live observer stream immediately:', ev.stream_id, 'for chat:', cid);
                            window.ResumeStream.resume(cid, ev.stream_id, ev.msg_id, true).catch(function(err) {
                                console.info('[SSE] Observer live stream ended or detached:', err && err.message || err);
                            });
                        }
                    }
                    // 后台并发补齐用户消息历史 (流式期间不调用 loadChat，避免抹除正在跳动的加载气泡)
                    _resyncChatFromRemote(cid, 0, _eventTraceId);
                } else if (typeof renderChatHistory === 'function') {
                    renderChatHistory();
                }
            }
        } catch(_sce) {}
    });

    // ★ 多设备工具状态实时同步 (Observer 端实时呈现工具调用步骤与进度)
    _sseChannel.addEventListener('agent:tool_status', function(e) {
        try {
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId) return;
            var cid = ev.chat_id || currentChatId;
            if (cid && cid === currentChatId && typeof showToolStatus === 'function') {
                showToolStatus(ev.tool || '...', ev.preview || '', ev.status || 'running', cid, ev.tool_call_id || '');
            }
        } catch(_te) {}
    });

    _sseChannel.addEventListener('agent:status', function(e) {
        try {
            var ev = JSON.parse(e.data);
            // ★ 失败时即时Toast,不等轮询
            if (ev.status === 'failed' || ev.status === 'error') {
                showToast('❌ 子代理 ' + (ev.agent || '') + ' 执行失败', 'error', 5000);
            }
            if (typeof window.checkAgentNotifications === 'function') {
                window.checkAgentNotifications();
            }
        } catch(_sce) {}
    });

    // ★ P0: 即时子代理结果推送 — SSE携带完整数据,无需轮询
    _sseChannel.addEventListener('agent:result', function(e) {
        try {
            var ev = JSON.parse(e.data);
            var agentName = ev.agent || '';
            var status = ev.status || 'completed';
            var result = ev.result || '';
            var error = ev.error || '';
            var structured = ev.structured || null;

            if (typeof window.pushAgentResultToTaskWithStructured === 'function') {
                window.pushAgentResultToTaskWithStructured(agentName, status, result, error, structured);
            } else if (typeof window.pushAgentResultToTask === 'function') {
                if (window._tasks && typeof window._tasks === 'object') {
                    for (var _tId in window._tasks) {
                        var _t = window._tasks[_tId];
                        if (_t && _t.agents && _t.agents[agentName]) {
                            window.pushAgentResultToTask(_tId, agentName, status, result, error);
                            break;
                        }
                    }
                }
            }

            if (result) {
                var agentKey = 'agent_chat_' + agentName;
                var agentMsgs = JSON.parse(localStorage.getItem(agentKey) || '[]');
                agentMsgs.push({ role: 'assistant', content: result, time: Date.now() });
                if (agentMsgs.length > 50) agentMsgs = agentMsgs.slice(-50);
                localStorage.setItem(agentKey, JSON.stringify(agentMsgs));
            }

            // ★ 同步到 chats 对象供侧边栏显示
            try {
                var _subChatId = '_agent_sub_' + agentName;
                if (!chats[_subChatId]) {
                    chats[_subChatId] = {
                        title: '🤖 ' + agentName,
                        userId: localStorage.getItem('authUserId') || '',
                        updated_at: Date.now(),
                        messages: [],
                        _agentSub: true
                    };
                }
                var _loaded = JSON.parse(localStorage.getItem('agent_chat_' + agentName) || '[]');
                chats[_subChatId].messages = _loaded.map(function(m) {
                    return { role: m.role, content: m.content, time: m.time };
                });
                chats[_subChatId].updated_at = Date.now();
                if (typeof saveChats === 'function') saveChats();
                if (typeof renderChatHistory === 'function') renderChatHistory();
            } catch(_syncErr) { console.warn('[AgentNotify] 同步侧边栏失败:', _syncErr); }

            // ★ 失败时显示Toast通知
            if (status === 'failed' || status === 'error') {
                var errMsg = error || result || '未知错误';
                showToast('❌ 子代理 ' + agentName + ' 执行失败: ' + errMsg.substring(0, 100), 'error', 6000);
            }
        } catch(_sce) {}
    });

    // ★ P1: 子代理实时步骤进度
    _sseChannel.addEventListener('agent:step', function(e) {
        try {
            var ev = JSON.parse(e.data);
            var agentName = ev.agent || '';
            var tool = ev.tool || '';
            var step = ev.step || 0;
            var maxSteps = ev.max_steps || 0;
            if (window._tasks && typeof window._tasks === 'object') {
                for (var _tId in window._tasks) {
                    var _t = window._tasks[_tId];
                    if (_t && _t.agents && _t.agents[agentName]) {
                        _t.agents[agentName]._lastTool = tool;
                        _t.agents[agentName]._step = step;
                        _t.agents[agentName]._maxSteps = maxSteps;
                        break;
                    }
                }
            }
            // ★ 更新子代理运行状态条 (实时显示当前工具和步骤)
            if (typeof window._updateSubAgentStatusBar === 'function') window._updateSubAgentStatusBar();
        } catch(_s) {}
    });

    _sseChannel.addEventListener('heartbeat:push', function(e) {
        try {
            var ev = JSON.parse(e.data);
            var msg = ev.msg || '';
            if (msg) showToast(msg, 'info', 4000);
        } catch(_sce) {}
    });

};

window._broadcastEvent = function(eventType, data) {
    try {
        var uid = localStorage.getItem('authUserId');
        var token = (typeof getAuthToken === 'function' ? getAuthToken() : null) || localStorage.getItem('authToken') || '';
        if (!uid || !token) return Promise.resolve(false);
        if (!data) data = {};
        data.source = window._sseSourceId;
        var traceId = data.trace_id || '';
        try { if (!traceId && window.SyncTrace && SyncTrace.enabled()) traceId = SyncTrace.id('broadcast:' + eventType + ':' + (data.chat_id || '')); } catch(e) {}
        if (traceId) data.trace_id = traceId;
        var payload = JSON.stringify({ event_type: eventType, data: data });
        var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
        if (traceId) headers['X-OneAPIChat-Trace'] = traceId;
        if (traceId) SyncTrace.log('broadcast_send', { trace_id: traceId, event_type: eventType, chat_id: data.chat_id || '', source: data.source || '', bytes: payload.length });
        // ★ 使用 fetch+keepalive 替代 sendBeacon（Blob Content-Type 兼容性更好）
        return fetch('/oneapichat/api/engine_api.php?action=events_broadcast', {
            method: 'POST',
            headers: headers,
            body: payload,
            keepalive: true
        }).then(function(resp) {
            if (traceId) SyncTrace.log('broadcast_response', { trace_id: traceId, event_type: eventType, chat_id: data.chat_id || '', status: resp.status, ok: resp.ok });
            return resp.ok;
        }).catch(function(e) {
            if (traceId) SyncTrace.log('broadcast_failed', { trace_id: traceId, event_type: eventType, chat_id: data.chat_id || '', error: e && e.message || String(e) });
            console.warn('[SSE] broadcast failed:', e.message);
            return false;
        });
    } catch(e) { return Promise.resolve(false); }
};

window._broadcastChatUpdate = function(chatId, options) {
    var now = Date.now();
    var isForce = options === true || (typeof options === 'object' && options && options.force);
    var isFinished = typeof options === 'object' && options ? !!options.finished : false;
    var traceId = typeof options === 'object' && options ? (options.trace_id || '') : '';
    if (!isForce && now - _lastChatSyncBroadcast < 500) {
        try { if (traceId && window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('broadcast_throttled', { trace_id: traceId, event_type: 'chat:updated', chat_id: chatId, elapsed: now - _lastChatSyncBroadcast }); } catch(e) {}
        return Promise.resolve(false);
    }
    _lastChatSyncBroadcast = now;
    var _chat = window.chats && window.chats[chatId];
    return window._broadcastEvent('chat:updated', {
        chat_id: chatId, ts: now, finished: isFinished, trace_id: traceId,
        revision: _chat ? Math.max(Number(_chat.revision || 0), Array.isArray(_chat.messages) ? _chat.messages.length : 0) : 0,
        updated_at: _chat && _chat.updated_at || 0
    });
};

// ═══════════════════════════════════════════════════════════════
// WebSocket 流式网关 — 无感续接 + 多端同步
// 开关: 默认启用，只有 __enableResumeStream === '0' 时关闭
// ═══════════════════════════════════════════════════════════════

window._wsClient = null;
window._wsStreamId = null;
window._wsChunkCount = 0;
window._wsReconnecting = false;

window._wsConnect = function() {
    var uid = localStorage.getItem('authUserId') || '';
    if (!uid) return;
    if (window._wsClient && window._wsClient.readyState === WebSocket.OPEN) return;

    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = proto + '//' + location.host + '/engine/ws/' + uid;
    console.log('[WS] Connecting:', url);
    try {
        window._wsClient = new WebSocket(url);
    } catch(e) {
        console.warn('[WS] Connection failed:', e.message);
        return;
    }

    window._wsClient.onopen = function() {
        console.log('[WS] Connected');
        // 续接活跃流
        if (window._wsStreamId && window._wsChunkCount > 0) {
            window._wsClient.send(JSON.stringify({
                action: 'resume',
                stream_id: window._wsStreamId,
                since: window._wsChunkCount
            }));
        }
    };

    window._wsClient.onmessage = function(e) {
        try {
            var msg = JSON.parse(e.data);
            var ev = msg.event, d = msg.data || {};

            if (ev === 'stream_created') {
                window._wsStreamId = d.stream_id;
                window._wsChunkCount = 0;
                console.log('[WS] ✅ Stream created:', d.stream_id);
            } else if (ev === 'content') {
                window._wsChunkCount++;
                var chatId = currentChatId;
                var pm = chats[chatId]?.messages?.find(function(m){return m.partial;});
                if (pm) {
                    pm.content = (pm.content||'') + (d.delta||'');
                    applyStreamRender(chatId, pm.content);
                    try { localStorage.setItem('_wsStreamId', window._wsStreamId); } catch(e) {}
                    try { localStorage.setItem('_wsChunkCount', window._wsChunkCount); } catch(e) {}
                }
            } else if (ev === 'reasoning') {
                // 思考内容累积到 pending message
            } else if (ev === 'tool_call') {
                // ★ 多端同步看到工具调用
                var pm2 = chats[currentChatId]?.messages?.find(function(m){return m.partial;});
                if (pm2) {
                    if (!pm2.tool_calls) pm2.tool_calls = [];
                    pm2.tool_calls.push(d);
                }
            } else if (ev === 'done') {
                console.log('[WS] ✅ Stream done');
                var pm3 = chats[currentChatId]?.messages?.find(function(m){return m.partial;});
                if (pm3) {
                    delete pm3.partial;
                }
                if (currentChatId) {
                    var bubble = activeBubbleMap[currentChatId];
                    if (bubble) bubble.classList.remove('typing', 'gen-active');
                    delete isTypingMap[currentChatId];
                }
                saveChats();
                window._wsStreamId = null;
                window._wsChunkCount = 0;
                // ★ 流结束必须同时清除 localStorage 残留 — 否则 loadChat 的 WS 续接块
                //   会读到陈旧 stream_id 触发最长 3s 等待 + 早退不渲染(模式切换遮罩变慢/内容不切换)
                try { localStorage.removeItem('_wsStreamId'); } catch(e) {}
                try { localStorage.removeItem('_wsChunkCount'); } catch(e) {}
            } else if (ev === 'error') {
                console.warn('[WS] ❌ Stream error:', d.error);
                window._wsStreamId = null;
                window._wsChunkCount = 0;
                try { localStorage.removeItem('_wsStreamId'); } catch(e) {}
                try { localStorage.removeItem('_wsChunkCount'); } catch(e) {}
            }
        } catch(ex) {}
    };

    window._wsClient.onclose = function() {
        console.log('[WS] Disconnected');
        window._wsClient = null;
        // 5 秒后重连
        if (!window._wsReconnecting) {
            window._wsReconnecting = true;
            setTimeout(function() {
                window._wsReconnecting = false;
                if (localStorage.getItem('__enableResumeStream') !== '0') {
                    window._wsConnect();
                }
            }, 5000);
        }
    };

    window._wsClient.onerror = function() {
        // onclose will fire after this
    };
};

// ★ WebSocket 发送聊天消息
window._wsSendChat = async function(messages, config, chatId, pendingMsg) {
    console.log('[WS] _wsSendChat called');
    // 等待连接就绪（最多 5 秒）
    var _waitStart = Date.now();
    while (!window._wsClient || window._wsClient.readyState === WebSocket.CONNECTING) {
        if (Date.now() - _waitStart > 5000) return null;
        await new Promise(function(r) { setTimeout(r, 100); });
    }
    if (window._wsClient.readyState !== WebSocket.OPEN) {
        console.log('[WS] Not connected (state=' + window._wsClient.readyState + ')');
        return null;
    }
    console.log('[WS] Sending chat via WebSocket');
    window._wsClient.send(JSON.stringify({
        action: 'chat',
        chat_id: chatId,
        msg_id: 'msg_' + Date.now(),
        request: {
            messages: messages,
            model: config.model,
            api_key: config.apiKey || '',
            base_url: config.baseUrl || '',
            temperature: config.temp || 0.7,
            max_tokens: config.tokens || 4096,
            tools: (config.tools && config.tools.length) ? config.tools : undefined
        }
    }));
    // WebSocket 是异步的，返回空结果让 sendMessage 等待 WS 事件
    return { fullText: '__WS_PENDING__', reasoningText: '', toolCalls: [] };
};

// ★ 页面加载时连接 WebSocket
// ★ HTTP/2 → nginx WebSocket 升级有兼容问题, SSE 已覆盖实时推送
window._wsInit = function() {
    console.log('[WS] SSE only mode (HTTP/2 WS not supported), skipping WebSocket');
    return;
    // 恢复上次的流状态
    try {
        window._wsStreamId = localStorage.getItem('_wsStreamId') || null;
        window._wsChunkCount = parseInt(localStorage.getItem('_wsChunkCount') || '0');
    } catch(e) {}
    window._wsConnect();
};

// ★ 刷新后从引擎恢复活跃任务（跨浏览器/刷新后继续接收流）
window._recoverActiveTasks = async function() {
    // ★ 防重入: init.js和storage.js都会调用,只执行一次
    if (window.__recoveringActive) { console.log('[recoverTasks] Skipped: already recovering'); return; }
    window.__recoveringActive = true;
    try {
        var uid = localStorage.getItem('authUserId') || '';
        var token = (typeof getAuthToken === 'function' ? getAuthToken() : null) || localStorage.getItem('authToken') || '';
        if (!uid || !token) { console.log('[recoverTasks] Skipped: no uid/token'); return; }
        var result = await _agentFetchJson('/engine/tasks/active?user_id=' + encodeURIComponent(uid), {
            headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
        }, 30000);
        var tasks = (result && result.tasks) || [];
        if (tasks.length === 0) { console.log('[recoverTasks] No active tasks'); return; }
        console.log('[recoverTasks] Found', tasks.length, 'active tasks from engine');
        for (var i = 0; i < tasks.length; i++) {
            var task = tasks[i];
            if (task.chat_id && !chats[task.chat_id]) {
                chats[task.chat_id] = {
                    id: task.chat_id, title: '恢复中的会话', messages: [],
                    createdAt: Date.now(), updatedAt: Date.now(), userId: uid, _recoveredFromBackend: true
                };
                try { slimSaveChats(); } catch(e) {}
            }
            if (task.chat_id && chats[task.chat_id]) {
                // 多任务恢复必须按 chat_id 绑定 sid/msg_id；不能写入全局 localStorage
                // 槽位，否则第二个任务会劫持第一个任务的取消/续接。
                // ResumeStream.resume 的显式参数是本次恢复的唯一身份来源。
                // Try resuming the stream
                try {
                    console.log('[recoverTasks] Attempting resume: chatId=' + task.chat_id + ' sid=' + task.stream_id + ' msgId=' + task.msg_id);
                    var resumed = await ResumeStream.resume(task.chat_id, task.stream_id, task.msg_id);
                    if (resumed) {
                        console.log('[recoverTasks] Resumed stream', task.stream_id, 'status=' + (task.status || 'running'));
                        window._backendRecovered = true;
                        window._pendingRecovery = null;
                    } else {
                        console.warn('[recoverTasks] Resume returned false for sid=' + task.stream_id);
                        window._recoverTaskRetries = window._recoverTaskRetries || {};
                        var _retryCnt = (window._recoverTaskRetries[task.task_id] || 0) + 1;
                        window._recoverTaskRetries[task.task_id] = _retryCnt;
                        var _isExpired = task.created_at && (Date.now() - new Date(task.created_at).getTime() > 1800000);
                        if (_retryCnt >= 2 || _isExpired || task.status === 'recoverable') {
                            console.warn('[recoverTasks] Abandoning inactive backend task:', task.task_id);
                            try {
                                _agentFetchJson('/engine/tasks/' + encodeURIComponent(task.task_id) + '/abandon?user_id=' + encodeURIComponent(uid), {
                                    method: 'POST',
                                    headers: { 'Authorization': 'Bearer ' + token }
                                }).catch(function() {});
                            } catch(_ae) {}
                            delete window._recoverTaskRetries[task.task_id];
                        } else {
                            console.warn('[recoverTasks] Keeping active backend task for retry:', task.task_id);
                        }
                    }
                } catch(_rte) {
                    console.warn('[recoverTasks] resume error:', _rte.message, _rte.stack);
                }
            }
        }
    } catch(e) {
        // 引擎重启/暂不可达不是恢复失败，不应每次启动污染控制台；下一次正常启动再恢复。
        if (e && (e.status === 502 || e.status === 503 || e.status === 504 || /HTTP 50[234]/.test(e.message || ''))) {
            console.info('[recoverTasks] engine temporarily unavailable; recovery deferred');
        } else {
            console.warn('[recoverTasks] Error:', e.message);
        }
    } finally {
        window.__recoveringActive = false;  // ★ 确保任何路径(包括early return)都重置
    }
};

window.checkAgentNotifications = function() {
    var token = getAuthToken();
    if (!token) {
        // 还没登录,延迟重试
        setTimeout(window.checkAgentNotifications, 3000);
        return;
    }

    // 先获取引擎心跳(cron通知等)
    _agentFetchJson(_apiBase + '?action=heartbeat&t=' + Date.now(), {
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    }, 30000)
        .then(function(data) {
            if (!data || data.error) return;
            // ★ cron 结果仅错误时通知（成功的例行任务不打扰用户）
            if (data.cron_results && Array.isArray(data.cron_results)) {
                data.cron_results.forEach(function(r) {
                    if (r.error) {
                        window.showAgentNotification('error', '[' + (r.name || 'Cron') + '] ' + r.error);
                    }
                    // 成功的不弹 toast，静默记录
                });
            }
            // ★ pending 消息静默合并到 agent 消息区，不弹 toast
            if (data.pending && Array.isArray(data.pending)) {
                data.pending.forEach(function(m) {
                    var msg = m.msg || m.text || '';
                    if (msg) {
                        window.appendAgentSystemMessage(msg, m.source || 'system');
                    }
                });
            }
        }).catch(function() {});

    // ★ 同时获取子代理完成通知(新功能)
    _agentFetchJson(_apiBase + '?action=agent_notifications&t=' + Date.now(), {
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    }, 30000)
        .then(function(data) {
            if (!data || data.count === 0) return;
            var notifs = data.notifications || [];
            console.log('[AgentNotify] 收到', data.count, '条未处理通知:', notifs.map(function(n) { return n.agent; }));

            // 红点提示
            var dot = getEl('agentNotifDot');
            if (dot) {
                if (data.count > 0) dot.classList.add('show');
                else dot.classList.remove('show');
            }

            notifs.forEach(function(n) {
                var agentName = n.agent || '未知代理';

                // 保存到代理专属聊天(供面板查看)
                var fullResult = n.result || n.error || '';
                if (fullResult) {
                    var agentKey = 'agent_chat_' + agentName;
                    var agentMsgs = JSON.parse(localStorage.getItem(agentKey) || '[]');
                    agentMsgs.push({ role: 'assistant', content: fullResult, time: Date.now() });
                    if (agentMsgs.length > 50) agentMsgs = agentMsgs.slice(-50);
                    localStorage.setItem(agentKey, JSON.stringify(agentMsgs));
                }

                // ★ 基于任务系统的子代理结果推送
                // 遍历所有活跃任务,把子代理结果推送到它所属的任务
                var pushedToTask = false;
                if (window._tasks && typeof window._tasks === 'object') {
                    for (var _tId in window._tasks) {
                        var _t = window._tasks[_tId];
                        if (_t && _t.agents && _t.agents[agentName]) {
                            window.pushAgentResultToTask(_tId, agentName, n.status || 'completed', n.result || '', n.error || '');
                            pushedToTask = true;
                            break;
                        }
                    }
                }
                
                if (!pushedToTask) {
                    console.log('[AgentNotify] 子代理 ' + agentName + ' 未找到所属任务,tasks=', Object.keys(window._tasks || {}).join(','), ', tasks内容=', JSON.stringify(Object.keys(window._tasks || {}).map(function(id){return {id:id,agents:Object.keys(window._tasks[id].agents||{})}})));
                    // ★ 兼容旧系统:找不到所属任务,放进兼容队列
                    if (!window._pendingSubAgentResultsData) window._pendingSubAgentResultsData = {};
                    window._pendingSubAgentResultsData[agentName] = {
                        status: n.status || 'completed',
                        result: n.result || '',
                        error: n.error || ''
                    };
                    // ★ 无论是否Agent模式,都触发子代理自动回复(普通聊天+Agent聊天统一处理)
                    window.triggerAgentAutoReplyForSubAgent(agentName);
                }
            });

            // ★ 注意:不再在这里立即 mark
            // ★ processAgentNotifyQueue 会在处理完成后自行调用 agent_notifications_mark
        }).catch(function() {});
};

/** 浮窗式代理通知（右上角弹出，不占聊天位置） */
function _showAgentToast(type, message, source) {
    var _container = document.getElementById('agent-toast-container');
    if (!_container) {
        _container = document.createElement('div');
        _container.id = 'agent-toast-container';
        _container.style.cssText = 'position:fixed;top:70px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(_container);
    }
    var _toast = document.createElement('div');
    _toast.className = 'agent-toast';
    _toast.style.cssText = 'pointer-events:auto;';
    var _icon = type === 'error' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        : type === 'success' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';
    var _srcLabel = source ? escapeHtml(source) : '';
    _toast.innerHTML = '<div style="display:flex;align-items:flex-start;gap:10px;background:rgba(255,255,255,0.96);backdrop-filter:blur(12px);border:1px solid rgba(0,0,0,0.08);border-radius:12px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.08);max-width:380px;font-size:13px;">' +
        '<div style="flex-shrink:0;margin-top:1px;">' + _icon + '</div>' +
        '<div style="flex:1;min-width:0;">' +
            (_srcLabel ? '<div style="font-weight:700;color:#6366f1;font-size:11px;margin-bottom:2px;">' + _srcLabel + '</div>' : '') +
            '<div style="color:#374151;line-height:1.5;word-break:break-word;">' + escapeHtml(message).replace(/\n/g, '<br>') + '</div>' +
        '</div>' +
    '</div>';
    _container.appendChild(_toast);
    // 入场动画
    _toast.style.opacity = '0';
    _toast.style.transform = 'translateX(40px)';
    _toast.style.transition = 'all 0.3s cubic-bezier(0.16,1,0.3,1)';
    requestAnimationFrame(function() { _toast.style.opacity = '1'; _toast.style.transform = 'translateX(0)'; });
    // 自动消失
    var _dur = type === 'error' ? 5000 : 3000;
    setTimeout(function() {
        _toast.style.opacity = '0';
        _toast.style.transform = 'translateX(40px)';
        setTimeout(function() { if (_toast.parentNode) _toast.remove(); }, 300);
    }, _dur);
    // 限制最多 5 个
    var _all = _container.querySelectorAll('.agent-toast');
    if (_all.length > 5) _all[0].remove();
}

window.showAgentNotification = function(type, message) {
    if (!message) return;
    _showAgentToast(type, message);
};

window.appendAgentSystemMessage = function(text, source) {
    if (!text) return;
    _showAgentToast('info', text, source);
    // ★ 保存到聊天数据中供 system prompt 读取
    var chatId = currentChatId;
    if (chatId && chats[chatId]) {
        if (!chats[chatId]._agentMessages) chats[chatId]._agentMessages = [];
        chats[chatId]._agentMessages.push({ text: text, time: Date.now(), source: source });
        if (chats[chatId]._agentMessages.length > 20) chats[chatId]._agentMessages = chats[chatId]._agentMessages.slice(-20);
    }
};

// 已移至 restoreUserData 完成后延迟启动


// MARKER_CACHE_TEST_v2

// ★ DEBUG: 控制台诊断函数 — 输入 __dumpImages() 查看图片持久化状态
window.__dumpImages = function() {
    console.log('=== 图片持久化诊断 ===');
    console.log('currentChatId:', currentChatId);
    if (currentChatId && chats[currentChatId]) {
        var msgs = chats[currentChatId].messages;
        console.log('当前聊天消息数:', msgs.length);
        for (var i = 0; i < msgs.length; i++) {
            var m = msgs[i];
            if (m.generatedImages && m.generatedImages.length > 0) {
                console.log('  消息[' + i + '] role=' + m.role + ' 图片数=' + m.generatedImages.length + ' partial=' + !!m.partial);
                for (var j = 0; j < m.generatedImages.length; j++) {
                    var u = m.generatedImages[j];
                    var imageUrl = typeof u === 'string' ? u : (u && u.url ? String(u.url) : '');
                    console.log('    [' + j + '] image_meta', { urlLength: imageUrl.length, isDataUrl: imageUrl.startsWith('data:'), hasMetadata: !!(u && typeof u === 'object') });
                }
            }
        }
        var hasImages = msgs.some(function(m) { return m.generatedImages && m.generatedImages.length > 0; });
        console.log('聊天中有图片:', hasImages);
    } else {
        console.log('无当前聊天');
    }

    // 检查 localStorage
    try {
        var stored = JSON.parse(localStorage.getItem('chats') || '{}');
        console.log('localStorage chats 键数:', Object.keys(stored).length);
        if (currentChatId && stored[currentChatId]) {
            var smsgs = stored[currentChatId].messages || [];
            for (var si = 0; si < smsgs.length; si++) {
                var sm = smsgs[si];
                if (sm.generatedImages && sm.generatedImages.length > 0) {
                    console.log('  localStorage消息[' + si + '] 图片数=' + sm.generatedImages.length);
                }
            }
        }
    } catch(e) {
        console.error('localStorage 读取失败:', e.message);
    }
    console.log('=== 诊断完成 ===');
};

// ★ DEBUG: 强制立即保存并输出状态
window.__forceSave = function() {
    console.log('强制保存前状态:');
    window.__dumpImages();
    slimSaveChats();
    console.log('强制保存后状态:');
    window.__dumpImages();
};
