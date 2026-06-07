// agent-notify.js — Agent 通知与轮询 v1.0 (Phase 4)
// Agent 通知队列 / 聊天室实时更新 / Feature 4

// ==================== Agent 通知与轮询系统 ====================
// ==================== 代理聊天室实时更新 (Feature 4) ====================
var _agentPollTimer = null;
var _agentPanelRefreshTimer = null;
const _agentChatPollTimer = null;
let _selectedAgentName = null;
const _lastAgentListJson = '';

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
        var html = msgs.map(function(m) {
            var roleClass = m.role === 'user' ? 'role-user' : 'role-assistant';
            var timeStr = m.time ? new Date(m.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) : '';
            var contentPreview = (m.content || '').substring(0, 3000);
            return '<div class="agent-chat-bubble ' + roleClass + '">' +
                '<div class="text-xs text-gray-400 mb-1">' + (m.role === 'user' ? '你' : escapeHtml(agentName)) + (timeStr ? ' · ' + timeStr : '') + '</div>' +
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
    if (!currentChatId || !chats[currentChatId]) {
        var keys = Object.keys(chats);
        if (keys.length > 0) {
            loadChat(keys[keys.length - 1]);
        } else {
            createNewChat();
        }
    }
}

window.startAgentNotificationPolling = function() {
    if (_agentPollTimer) return;
    ensureChatExists();
    _agentPollTimer = setInterval(window.checkAgentNotifications, 15000);
    window.checkAgentNotifications();
};

window.stopAgentNotificationPolling = function() {
    if (_agentPollTimer) { clearInterval(_agentPollTimer); _agentPollTimer = null; }
};

// ═══════════════════════════════════════════════════════════════
// SSE 事件总线 — 实时跨浏览器同步
// ═══════════════════════════════════════════════════════════════

var _sseChannel = null;
window._sseSourceId = 'browser_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
var _lastChatSyncBroadcast = 0;

window.connectSSEChannel = function() {
    var uid = localStorage.getItem('authUserId') || '';
    if (!uid) return;
    if (_sseChannel) { try { _sseChannel.close(); } catch(e) {} }
    // ★ 多端同步: 上报当前 agent 模式,让引擎同步给其他设备
    var currentMode = (typeof getAgentMode === 'function') ? getAgentMode() : 'off';
    var url = window.location.origin + '/engine/events?user_id=' + encodeURIComponent(uid) + '&agent_mode=' + encodeURIComponent(currentMode);
    _sseChannel = new EventSource(url);

    _sseChannel.addEventListener('connected', function(e) {
        console.log('[SSE] Channel connected');
        // ★ 多端同步: 检查引擎返回的 agent_mode(来自其他设备)
        try {
            var evData = JSON.parse(e.data);
            if (evData.agent_mode && evData.agent_mode !== 'off' && evData.agent_mode !== currentMode) {
                var prevMode = localStorage.getItem('agentMode') || 'off';
                if (evData.agent_mode !== prevMode) {
                    console.log('[SSE] Syncing agent mode from another device:', evData.agent_mode);
                    localStorage.setItem('agentMode', evData.agent_mode);
                    if (typeof updateAgentUI === 'function') updateAgentUI();
                    if (typeof renderToolPanel === 'function') renderToolPanel();
                }
            }
        } catch(_sce) {}
    });

    // ★ 多端同步: 从服务器拉取最新聊天数据并合并到本地
    async function _syncChatFromServer(chatId, retryDelay) {
        try {
            var token = localStorage.getItem('authToken') || '';
            if (!token || !chatId) return false;
            // ★ 服务端聊天数据统一存储在 all 文件中,需拉取全部再提取
            var url = window.location.origin + '/oneapichat/api/chat.php?chat_id=all&auth_token=' + encodeURIComponent(token);
            var resp = await fetch(url);
            if (!resp.ok) return false;
            var data = await resp.json();
            var serverChats = (data && data.chats) ? data.chats : {};
            var serverChat = serverChats[chatId];
            if (!serverChat || !serverChat.messages) {
                // ★ 服务器还没数据(可能保存未完成),延迟后重试一次
                if (!retryDelay) {
                    console.log('[SSE] _syncChatFromServer: chat not found on server, retrying in 1.5s');
                    await new Promise(function(r) { setTimeout(r, 1500); });
                    return _syncChatFromServer(chatId, true);
                }
                return false;
            }

            if (!window.chats) window.chats = {};
            if (!window.chats[chatId]) {
                window.chats[chatId] = JSON.parse(JSON.stringify(serverChat));
            } else {
                // ★ 合并: 用服务器数据替换消息数组,保留本地partial消息
                var serverMsgs = serverChat.messages || [];
                var localMsgs = window.chats[chatId].messages || [];
                window.chats[chatId].messages = serverMsgs;
                window.chats[chatId].title = serverChat.title || window.chats[chatId].title;
                window.chats[chatId].updated_at = serverChat.updated_at || window.chats[chatId].updated_at;
                // 保留本地 partial 消息（正在流式生成中,服务器尚未有）
                for (var li = 0; li < localMsgs.length; li++) {
                    if (localMsgs[li].partial && localMsgs[li].role === 'assistant') {
                        var found = false;
                        for (var si = serverMsgs.length - 1; si >= 0; si--) {
                            if (serverMsgs[si].role === 'assistant' && !serverMsgs[si].partial &&
                                serverMsgs[si].content && localMsgs[li].content &&
                                serverMsgs[si].content.indexOf(localMsgs[li].content.substring(0, 50)) === 0) {
                                found = true; break;
                            }
                        }
                        if (!found && localMsgs[li]._recovered !== false) {
                            window.chats[chatId].messages.push(localMsgs[li]);
                        }
                    }
                }
            }
            console.log('[SSE] _syncChatFromServer OK: chatId=' + chatId + ' msgs=' + window.chats[chatId].messages.length);
            return true;
        } catch(e) {
            console.warn('[SSE] _syncChatFromServer failed:', e.message);
            return false;
        }
    }

    _sseChannel.addEventListener('config:changed', function(e) {
        try {
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId) return;
            console.log('[SSE] Config changed from another browser, reloading');
            loadConfigFromServer().catch(function(){});
        } catch(_sce) {}
    });

    _sseChannel.addEventListener('chat:stream_done', function(e) {
        try {
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId) return;
            console.log('[SSE] Stream done from another device, syncing chat:', ev.chat_id);
            // ★ 先从服务器拉取最新数据，再渲染
            _syncChatFromServer(ev.chat_id || currentChatId).then(function(ok) {
                if (ev.chat_id === currentChatId && !isTypingMap[currentChatId]) {
                    loadChat(currentChatId);
                }
                updateChatList();
            });
        } catch(_sce) {}
    });

    _sseChannel.addEventListener('chat:updated', function(e) {
        try {
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId) return;
            console.log('[SSE] Chat updated from another device:', ev.chat_id);
            // ★ 先从服务器拉取最新数据，再渲染
            var cid = ev.chat_id || currentChatId;
            _syncChatFromServer(cid).then(function(ok) {
                if (cid === currentChatId && !isTypingMap[currentChatId]) {
                    console.log('[SSE] Reloading current chat after server sync');
                    loadChat(currentChatId);
                }
                updateChatList();
            });
        } catch(_sce) {}
    });

    // ★ 多端同步: 其他设备发送了新消息
    _sseChannel.addEventListener('chat:message_added', function(e) {
        try {
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId) return;
            console.log('[SSE] New message from another device, chat:', ev.chat_id);
            var cid = ev.chat_id || currentChatId;
            _syncChatFromServer(cid).then(function(ok) {
                if (cid === currentChatId && !isTypingMap[currentChatId]) {
                    loadChat(currentChatId);
                }
                updateChatList();
            });
        } catch(_sce) {}
    });

    // ★ 多端同步: Agent 模式在其他设备上变更了
    _sseChannel.addEventListener('agent:mode_changed', function(e) {
        try {
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId) return;
            var newMode = ev.mode || 'off';
            console.log('[SSE] Agent mode changed from another device:', newMode);
            var prevMode = localStorage.getItem('agentMode') || 'off';
            if (newMode !== prevMode) {
                localStorage.setItem('agentMode', newMode);
                if (typeof updateAgentUI === 'function') updateAgentUI();
                // 同步工具面板
                if (typeof renderToolPanel === 'function') renderToolPanel();
                showToast('🤖 Agent 模式已在其他设备切换为: ' + newMode, 'info', 3000);
            }
        } catch(_sce) {}
    });

    // ★ 多端同步: 其他设备开始了流式生成
    _sseChannel.addEventListener('chat:stream_started', function(e) {
        try {
            var ev = JSON.parse(e.data);
            if (ev.source === window._sseSourceId) return;
            console.log('[SSE] Stream started in another device, chat:', ev.chat_id);
            // 如果打开的正是这个聊天,显示一个提示
            if (ev.chat_id === currentChatId && !isTypingMap[currentChatId]) {
                showToast('📡 其他设备正在此聊天中生成回复...', 'info', 3000);
            }
        } catch(_sce) {}
    });

    _sseChannel.addEventListener('agent:status', function(e) {
        try {
            var ev = JSON.parse(e.data);
            if (typeof window.checkAgentNotifications === 'function') {
                window.checkAgentNotifications();
            }
        } catch(_sce) {}
    });

    _sseChannel.addEventListener('heartbeat:push', function(e) {
        try {
            var ev = JSON.parse(e.data);
            var msg = ev.msg || '';
            if (msg) showToast(msg, 'info', 4000);
        } catch(_sce) {}
    });

    _sseChannel.onerror = function() {
        console.warn('[SSE] Connection error, EventSource will auto-reconnect');
    };
};

window._broadcastEvent = function(eventType, data) {
    try {
        var uid = localStorage.getItem('authUserId');
        var token = localStorage.getItem('authToken');
        if (!uid || !token) return;
        if (!data) data = {};
        data.source = window._sseSourceId;
        var payload = JSON.stringify({ event_type: eventType, data: data });
        // ★ 使用 fetch+keepalive 替代 sendBeacon（Blob Content-Type 兼容性更好）
        fetch('/oneapichat/api/engine_api.php?action=events_broadcast&auth_token=' + encodeURIComponent(token) + '&user_id=' + encodeURIComponent(uid), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
        }).catch(function(e) {
            console.warn('[SSE] broadcast failed:', e.message);
        });
    } catch(e) {}
};

window._broadcastChatUpdate = function(chatId) {
    var now = Date.now();
    if (now - _lastChatSyncBroadcast < 500) return;  // ★ 500ms throttle for real-time sync
    _lastChatSyncBroadcast = now;
    window._broadcastEvent('chat:updated', { chat_id: chatId, ts: now });
};

// ═══════════════════════════════════════════════════════════════
// WebSocket 流式网关 — 无感续接 + 多端同步
// 开关: __enableResumeStream === '1'
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
            } else if (ev === 'error') {
                console.warn('[WS] ❌ Stream error:', d.error);
                window._wsStreamId = null;
                window._wsChunkCount = 0;
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
                if (localStorage.getItem('__enableResumeStream') === '1') {
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
    var uid = localStorage.getItem('authUserId') || '';
    var token = localStorage.getItem('authToken') || '';
    if (!uid || !token) return;
    try {
        var resp = await fetch('/engine/tasks/active?user_id=' + encodeURIComponent(uid));
        if (!resp.ok) return;
        var result = await resp.json();
        var tasks = (result && result.tasks) || [];
        if (tasks.length === 0) return;
        console.log('[recoverTasks] Found', tasks.length, 'active tasks from engine');
        for (var i = 0; i < tasks.length; i++) {
            var task = tasks[i];
            if (task.chat_id && chats[task.chat_id]) {
                // ★ 恢复 stream_id 到 localStorage（ResumeStream.resume 依赖 _rs_sid）
                if (task.stream_id) {
                    try { localStorage.setItem('_rs_sid', task.stream_id); } catch(e) {}
                }
                if (task.msg_id) {
                    try { localStorage.setItem('_rs_msgid', task.msg_id); } catch(e) {}
                }
                try { localStorage.setItem('_rs_cid', task.chat_id); } catch(e) {}
                try { localStorage.setItem('_rs_ts', Date.now()); } catch(e) {}
                // Try resuming the stream
                try {
                    console.log('[recoverTasks] Attempting resume: chatId=' + task.chat_id + ' sid=' + task.stream_id + ' msgId=' + task.msg_id);
                    var resumed = await ResumeStream.resume(task.chat_id, task.stream_id, task.msg_id);
                    if (resumed) {
                        console.log('[recoverTasks] Resumed stream', task.stream_id);
                        window._backendRecovered = true;
                        window._pendingRecovery = null;
                    } else {
                        console.warn('[recoverTasks] Resume returned false for sid=' + task.stream_id);
                    }
                } catch(_rte) {
                    console.warn('[recoverTasks] resume error:', _rte.message, _rte.stack);
                }
            }
        }
    } catch(e) {
        console.warn('[recoverTasks] Error:', e.message);
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
    fetch(_apiBase + '?action=heartbeat&auth_token=' + token + '&t=' + Date.now(), { signal: AbortSignal.timeout(900000) })
        .then(function(r) { return r.json(); })
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
    fetch(_apiBase + '?action=agent_notifications&auth_token=' + token + '&t=' + Date.now(), { signal: AbortSignal.timeout(900000) })
        .then(function(r) { return r.json(); })
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
                    if (isAgentToolsActive()) {
                        window.triggerAgentAutoReplyForSubAgent(agentName);
                    }
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
                    console.log('    [' + j + '] ' + (u ? u.substring(0, 80) : 'null') + ' (startsWith data: ' + (u && u.startsWith('data:')) + ')');
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

