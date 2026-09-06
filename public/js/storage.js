// storage.js — 数据持久化 v1.0 (Phase 5 拆分自 main.js)
// beaconSave / serverSync / restoreUserData / getDefaultConfig

let _lastServerBackup = 0;
const SERVER_BACKUP_INTERVAL = 60000; // 单会话即时落盘；16MB all.json 仅每分钟低频汇总
let _deletedChatIds = {}; // ★ 跟踪已删除的聊天ID,合并时排除
let _serverSaveInFlight = null;
let _serverSaveQueued = false;
let _serverSaveForceQueued = false;

// Keep bearer credentials out of URLs (which can reach browser history, proxies and logs).
// Beacon requests cannot set headers, so the API falls back to its same-site auth cookie.
function _chatStorageAuthHeaders(extra) {
    var headers = Object.assign({}, extra || {});
    var token = localStorage.getItem('authToken') ||
        (typeof getCookie === 'function' ? getCookie('auth_token') : '');
    if (token && !headers.Authorization) headers.Authorization = 'Bearer ' + token;
    return headers;
}
// 从 localStorage 恢复(刷新后不丢失)
try {
    var _savedDel = JSON.parse(localStorage.getItem('_deletedChatIds') || '{}');
    _deletedChatIds = _savedDel;
    if (_deletedChatIds && typeof _deletedChatIds === 'object') {
        var _cleanedTombstone = false;
        for (var _tCid in _deletedChatIds) {
            if (typeof chats !== 'undefined' && chats[_tCid] && typeof _hasMeaningfulChatContent === 'function' && _hasMeaningfulChatContent(chats[_tCid])) {
                console.log('[storage] 清除有效会话的误打删除墓碑:', _tCid);
                delete _deletedChatIds[_tCid];
                _cleanedTombstone = true;
            }
        }
        if (_cleanedTombstone) {
            try { localStorage.setItem('_deletedChatIds', JSON.stringify(_deletedChatIds)); } catch(e) {}
        }
    }
} catch(e) {}

// 运行中的流/工具恢复日志只属于当前浏览器标签生命周期，不能作为“配置”
// 上传后再由服务器旧值覆盖，否则刷新恰好会拿到另一台设备的过期 stream_id。
function _isTransientRuntimeStorageKey(key) {
    return key === '_savedPartial' || key === '_rs_state_v3' ||
        key.indexOf('_rs_') === 0 || key.indexOf('_wsStream') === 0 ||
        key.indexOf('_streamStopped_') === 0 || key.indexOf('_lastStreamMsgId_') === 0 ||
        key.indexOf('oc_queue_') === 0 || key.indexOf('queued_message_') === 0;
}
window._isTransientRuntimeStorageKey = _isTransientRuntimeStorageKey;

// ★ sendBeacon 版本: 页面关闭时可靠地保存聊天记录到服务器
//   使用 navigator.sendBeacon,浏览器保证请求在页面关闭后继续发送
function beaconSaveChats() {
    try {
        var token = localStorage.getItem('authToken');
        if (!token) return;
        // ★ 防数据丢失: 本地聊天数过少时跳过 beacon 发送(2026-08-06)
        //   场景: restoreUserData 清理逻辑误删普通聊天后, 页面关闭时 beacon 会将不完整数据覆盖服务器
        //   策略: 本地<5条时不发 beacon(服务器端也有合并保护, 双重保险)
        if (Object.keys(chats).length < 5) {
            console.warn('[beaconSaveChats] 本地仅'+Object.keys(chats).length+'条,跳过发送防止覆盖服务器');
            return;
        }
        var url = SERVER_API_BASE + '/chat.php';
        // sendBeacon 不能可靠发送超过约 64KB 的请求。严禁为了满足该限制而删除
        // generatedImages 或截断消息后再写入 chat_id=all：那会把精简副本当成权威历史，
        // 在消息数相同时直接覆盖服务器图片。大数据由常规、串行的 fetch 保存负责。
        var payload = JSON.stringify({ chat_id: 'all', chats: chats, title: '聊天备份' });
        if (new Blob([payload]).size > 60000) {
            console.log('[beaconSaveChats] 完整聊天超过60KB，跳过卸载保存（等待常规同步）');
            return;
        }
        var blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
    } catch(e) {
        console.warn('[beaconSaveChats] 失败:', e.message);
    }
}

// ★ sendBeacon 版本: 页面关闭时可靠地保存配置到服务器
function beaconSaveConfig() {
    try {
        var token = localStorage.getItem('authToken');
        if (!token) return;
        var config = {};
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k || k === 'chats' || k === 'lastChatId' || k === 'deviceId' ||
                k === 'ongoingChats' || k === 'authToken' || k === 'authUsername' ||
                k === 'authUserId' || k === 'dark' || k === 'modelContextLength' ||
                k === 'agentModeLocalTs' || k === 'modelMaxOutputTokens' || k === 'autoDetectedTextModels' ||
                k === '_test' || _isTransientRuntimeStorageKey(k)) continue;
            var v = localStorage.getItem(k);
            if (v !== null && v !== undefined) config[k] = v;
        }
        var _provider = localStorage.getItem('baseUrlProvider') || 'custom';
        var _providerModel = localStorage.getItem('model_' + _provider) || '';
        if (_providerModel && !/^(加载中|请输入|获取失败|loading)/i.test(_providerModel)) {
            config.model = _providerModel;
            config['model_' + _provider] = _providerModel;
        }
        config._modelSelectionSavedAt = localStorage.getItem('_modelSelectionSavedAt') || '0';
        var url = SERVER_API_BASE + '/chat.php?action=save_config';
        var blob = new Blob([JSON.stringify(config)], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
    } catch(e) {}
}

// ★ 防抖配置同步: 配置变更后 2 秒自动推送到服务器,避免每次滑动都发请求
window._configRestored = false; // ★ 防止 restoreUserData 完成前覆盖服务器配置
window._scheduleConfigSync = function() {
    if (!window._configRestored) return; // ★ 等待 restoreUserData 完成
    if (window.__configSyncTimer) clearTimeout(window.__configSyncTimer);
    window.__configSyncTimer = setTimeout(function() {
        if (localStorage.getItem('authToken') && typeof saveConfigToServer === 'function') {
            saveConfigToServer();
        }
    }, 2000);
};

// 合并同一条消息的图片字段。多端同步的原则是取并集，绝不因另一端字段为空而删除。
function _mergeGeneratedImageFields(target, source) {
    if (!target || !source) return target;
    function clone(v) {
        try { return JSON.parse(JSON.stringify(v)); } catch(e) { return v; }
    }
    function key(v) {
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object') return v.url || v.image_url || JSON.stringify(v);
        return String(v || '');
    }
    if (!target.generatedImage && source.generatedImage) {
        target.generatedImage = clone(source.generatedImage);
    }
    var combined = [];
    var seen = {};
    [target.generatedImages, source.generatedImages].forEach(function(list) {
        if (!Array.isArray(list)) return;
        list.forEach(function(item) {
            var k = key(item);
            if (!k || seen[k]) return;
            seen[k] = true;
            combined.push(clone(item));
        });
    });
    if (combined.length) target.generatedImages = combined;
    return target;
}
window._mergeGeneratedImageFields = _mergeGeneratedImageFields;

// 单会话即时主存储：用户消息/流式内容优先写入独立小文件，避免 16MB all.json 保存或加载超时导致刷新丢消息。
var _singleChatSaveState = {};

function _ensureChatMessageIds(chat, chatId) {
    if (!chat || !Array.isArray(chat.messages)) return chat;
    chat.messages.forEach(function(message, index) {
        if (!message || typeof message !== 'object') return;
        if (message.id) return;
        var stable = message._rsMsgId || message.message_id || '';
        if (!stable && window.crypto && typeof window.crypto.randomUUID === 'function') {
            stable = 'msg_' + window.crypto.randomUUID().replace(/-/g, '');
        }
        if (!stable) stable = 'msg_' + String(chatId || 'chat') + '_' + Date.now().toString(36) + '_' + index.toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        message.id = stable;
    });
    var currentRevision = Number(chat.revision || 0);
    chat.revision = Math.max(Number.isFinite(currentRevision) ? currentRevision : 0, chat.messages.length);
    return chat;
}
window._ensureChatMessageIds = _ensureChatMessageIds;

async function saveSingleChatToServer(chatId, force) {
    if (!chatId || !chats[chatId] || _deletedChatIds[chatId]) return false;
    var token = localStorage.getItem('authToken') || (typeof getAuthToken === 'function' ? getAuthToken() : '') || (typeof getCookie === 'function' ? getCookie('auth_token') : '');
    if (!token) return false;
    var state = _singleChatSaveState[chatId] || (_singleChatSaveState[chatId] = { running: false, queued: false, force: false, promise: null });
    if (state.running) {
        state.queued = true;
        state.force = state.force || !!force;
        return state.promise || Promise.resolve(false);
    }
    state.running = true;
    state.promise = (async function() {
        try {
            do {
                state.queued = false;
                _ensureChatMessageIds(chats[chatId], chatId);
                var snapshot = JSON.parse(JSON.stringify(chats[chatId]));
                if (!snapshot.updated_at) snapshot.updated_at = Date.now();
                snapshot.revision = Math.max(Number(snapshot.revision || 0), Array.isArray(snapshot.messages) ? snapshot.messages.length : 0);
                var _syncTraceId = '';
                try { if (window.SyncTrace && SyncTrace.enabled()) _syncTraceId = SyncTrace.id('save:' + chatId); } catch(e) {}
                var payload = Object.assign({ chat_id: chatId }, snapshot);
                if (_syncTraceId) payload._sync_trace_id = _syncTraceId;
                if (_syncTraceId) SyncTrace.log('save_start', {
                    trace_id: _syncTraceId, chat_id: chatId, force: !!force,
                    msg_count: Array.isArray(snapshot.messages) ? snapshot.messages.length : 0,
                    updated_at: snapshot.updated_at,
                    last_role: Array.isArray(snapshot.messages) && snapshot.messages.length ? snapshot.messages[snapshot.messages.length - 1].role : '',
                    last_partial: Array.isArray(snapshot.messages) && snapshot.messages.length ? !!snapshot.messages[snapshot.messages.length - 1].partial : false,
                    last_size: Array.isArray(snapshot.messages) && snapshot.messages.length ? String(snapshot.messages[snapshot.messages.length - 1].content || snapshot.messages[snapshot.messages.length - 1].text || '').length : 0
                });
                // ★ 修复(多端同步-发送侧): 保存必须带超时。流式生成期间会反复保存, 一次挂起的 POST
                //   会把 _singleChatSaveState[chatId].running 永久锁死, 之后该会话的用户消息保存永远
                //   命中 if(state.running) return false → 用户消息永不落盘 → 另一设备同步不到。
                var resp = null;
                var _saveErr = null;
                // 每次尝试创建全新的 controller；绝不跨重试复用已 aborted 的 signal。
                // 第一次超时允许短退避重试一次，网络抖动不再直接丢掉本轮会话快照。
                for (var _saveAttempt = 0; _saveAttempt < 2; _saveAttempt++) {
                    var _sctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
                    var _timedOut = false;
                    var _stmo = _sctrl ? setTimeout(function(_ctrl) {
                        _timedOut = true;
                        try {
                            _ctrl.abort(typeof DOMException !== 'undefined' ? new DOMException('chat save timeout', 'TimeoutError') : 'chat save timeout');
                        } catch(_eAbort) { try { _ctrl.abort(); } catch(_eAbort2) {} }
                    }, 12000, _sctrl) : null;
                    try {
                        var _saveHeaders = _chatStorageAuthHeaders({ 'Content-Type': 'application/json' });
                        if (_syncTraceId) _saveHeaders['X-OneAPIChat-Trace'] = _syncTraceId;
                        resp = await fetch(SERVER_API_BASE + '/chat.php', {
                            method: 'POST',
                            headers: _saveHeaders,
                            body: JSON.stringify(payload),
                            keepalive: false,
                            signal: _sctrl ? _sctrl.signal : undefined
                        });
                        _saveErr = null;
                        break;
                    } catch(_attemptErr) {
                        _saveErr = _attemptErr;
                        var _isAbort = _timedOut || _attemptErr.name === 'AbortError' || _attemptErr.name === 'TimeoutError' || /aborted|timeout/i.test(String(_attemptErr.message || ''));
                        if (!_isAbort || _saveAttempt >= 1) break;
                        await new Promise(function(resolve) { setTimeout(resolve, 350); });
                    } finally {
                        if (_stmo) clearTimeout(_stmo);
                    }
                }
                if (_saveErr) throw _saveErr;
                if (!resp || !resp.ok) throw new Error('HTTP ' + (resp ? resp.status : 'no response'));
                var _saveAck = null;
                try { _saveAck = await resp.json(); } catch(_ackErr) {}
                if (_saveAck && chats[chatId]) {
                    if (Number(_saveAck.revision || 0) > Number(chats[chatId].revision || 0)) chats[chatId].revision = Number(_saveAck.revision);
                    if (Number(_saveAck.updated_at || 0) > Number(chats[chatId].updated_at || 0)) chats[chatId].updated_at = Number(_saveAck.updated_at);
                }
                if (_syncTraceId) SyncTrace.log('save_success', {
                    trace_id: _syncTraceId, chat_id: chatId, status: resp.status,
                    revision: _saveAck && _saveAck.revision || snapshot.revision || 0,
                    queued_after: !!state.queued
                });
            } while (state.queued);
            return true;
        } catch(e) {
            var _saveMsg = String(e && e.message || e || 'unknown');
            try { if (window.SyncTrace && SyncTrace.enabled()) SyncTrace.log('save_failed', { chat_id: chatId, error: _saveMsg, name: e && e.name || '' }); } catch(_traceErr) {}
            if (e && (e.name === 'AbortError' || e.name === 'TimeoutError' || /aborted|timeout/i.test(_saveMsg))) {
                console.info('[saveSingleChatToServer] 保存超时，已释放锁并等待下次合并保存:', chatId);
            } else {
                console.warn('[saveSingleChatToServer] 保存失败:', chatId, _saveMsg);
            }
            return false;
        } finally {
            state.running = false;
            state.force = false;
            state.promise = null;
        }
    })();
    return state.promise;
}
window.saveSingleChatToServer = saveSingleChatToServer;

async function loadSingleChatFromServer(chatId) {
    if (!chatId) return null;
    var token = localStorage.getItem('authToken') || (typeof getCookie === 'function' ? getCookie('auth_token') : '');
    if (!token) return null;
    // 新会话刚创建时，侧栏索引可能先于单会话文件落盘；短暂 404 只视为可恢复竞态。
    // 采用递增退避，避免 loadChat 与保存请求同时发生时在控制台制造重复 404。
    var lastStatus = 0;
    for (var attempt = 0; attempt < 3; attempt++) {
        var controller = null;
        var timer = null;
        try {
            controller = new AbortController();
            timer = setTimeout(function(_ctrl) { try { _ctrl.abort(); } catch(e) {} }, 15000, controller);
            var resp = await fetch(SERVER_API_BASE + '/chat.php?chat_id=' + encodeURIComponent(chatId), {
                cache: 'no-store', signal: controller.signal, headers: _chatStorageAuthHeaders()
            });
            lastStatus = resp.status;
            if (timer) clearTimeout(timer);
            if (resp.ok) {
                var chat = await resp.json();
                return chat && Array.isArray(chat.messages) ? chat : null;
            }
            if (resp.status !== 404 || attempt >= 2) break;
        } catch(e) {
            if (timer) clearTimeout(timer);
            if (attempt >= 2) {
                console.info('[loadSingleChatFromServer] hydration failed:', chatId, e.message);
                return null;
            }
        }
        await new Promise(function(resolve) { setTimeout(resolve, 180 * (attempt + 1)); });
    }
    // 404 可能是删除/尚未提交，不再用 warn 污染控制台；loadChat 会保留本地索引壳。
    if (lastStatus && lastStatus !== 404) {
        console.info('[loadSingleChatFromServer] hydration unavailable:', chatId, lastStatus);
    }
    return null;
}
window.loadSingleChatFromServer = loadSingleChatFromServer;

// 对服务器保存做单飞/合并：旧快照不能在新快照之后完成并反向覆盖。
async function saveChatsToServer(force) {
    if (_serverSaveInFlight) {
        _serverSaveQueued = true;
        _serverSaveForceQueued = _serverSaveForceQueued || !!force;
        return _serverSaveInFlight;
    }
    _serverSaveInFlight = _saveChatsToServerOnce(force);
    try {
        return await _serverSaveInFlight;
    } finally {
        _serverSaveInFlight = null;
        if (_serverSaveQueued) {
            var queuedForce = _serverSaveForceQueued;
            _serverSaveQueued = false;
            _serverSaveForceQueued = false;
            setTimeout(function() { saveChatsToServer(queuedForce); }, 0);
        }
    }
}

async function _saveChatsToServerOnce(force) {
    try {
        var now = Date.now();
        // ★ 只有删除墓碑需要强制汇总；普通 force 调用由独立单会话文件保证实时性，不能反复推送 16MB all.json。
        var _hasPendingDeletes = Object.keys(_deletedChatIds).length > 0;
        var _forceAllBackup = !!force && _hasPendingDeletes;
        if (!_forceAllBackup && !_hasPendingDeletes && now - _lastServerBackup < SERVER_BACKUP_INTERVAL) return false;
        _lastServerBackup = now;

        var token = localStorage.getItem('authToken');
        if (!token) return false;
        var url = SERVER_API_BASE + '/chat.php';
        var authHeaders = _chatStorageAuthHeaders();

        // ★ 合并:先读服务器已有数据,再合并本地聊天,防止多窗口覆盖
        // ★ 防丢失:如果本地聊天数过少,视为异常,不强制覆盖服务器
        // ★ Agent 主聊(_agent_main)同步到服务器(含 system prompt,供第三方设备恢复)
        var _localCount = 0;
        var mergedChats = {};
        for (var _cid in chats) {
            // ★ 跳过已标记删除的聊天（防止复活）
            if (_deletedChatIds[_cid]) continue;
            // ★ 完整同步所有聊天（含 Agent 会话及归档的子代理会话）
            mergedChats[_cid] = JSON.parse(JSON.stringify(chats[_cid]));
            _localCount++;
        }
        // ★ 保留完整图片数据(不压缩,服务器备份需要完整 base64)
        console.log('[save] 本地聊天数:', Object.keys(mergedChats).length);
        var _serverChats = {};  // 用于防误覆盖检查
        var _getOk = false;    // GET是否成功
        try {
            // ★ 使用轻量元数据端点做合并检查 (避免传输6MB完整数据导致超时)
            var getUrl = url + '?chat_id=all&meta=1';
            console.log('[save] GET meta snapshot');
            // ★ 超时保护: 合并检查 GET 若挂起会阻塞后续保存流程
            var _gctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var _getTimedOut = false;
            var _gtmo = _gctrl ? setTimeout(function() {
                _getTimedOut = true;
                try {
                    _gctrl.abort(typeof DOMException !== 'undefined'
                        ? new DOMException('chat backup metadata timeout', 'TimeoutError')
                        : 'chat backup metadata timeout');
                } catch(_abortErr) { try { _gctrl.abort(); } catch(_ignoredAbort) {} }
            }, 10000) : null;
            var getResp;
            try {
                getResp = await fetch(getUrl, { headers: authHeaders, signal: _gctrl ? _gctrl.signal : undefined });
            } finally {
                if (_gtmo) clearTimeout(_gtmo);
            }
            console.log('[save] GET响应:', getResp.status);
            _getOk = getResp.ok;
            if (getResp.ok) {
                var serverData = await getResp.json();
                var _serverMeta = serverData.chats || {};
                console.log('[save] 已删IDs:', Object.keys(_deletedChatIds).join(','));
                console.log('[save] 服务器聊天数:', Object.keys(_serverMeta).length);
                var added = 0;
                var needFullFetch = false;
                for (var scid in _serverMeta) {
                    if (_deletedChatIds[scid]) continue;
                    var _meta = _serverMeta[scid];
                    var _serverMsgCount = _meta.msg_count || 0;
                    if (!mergedChats[scid]) {
                        // 服务器有本地没有且非索引模式 → 需要完整数据
                        if (localStorage.getItem('_chats_db_mode') !== '1') {
                            needFullFetch = true;
                        }
                        added++;
                    } else {
                        // ★ 防数据丢失与清空保护: 仅当本地持有的会话属于加载态、未被清空且服务端时间戳明确更新时才拉取完整数据
                        var _localChat = mergedChats[scid];
                        var _isLoadedLocally = _localChat && Array.isArray(_localChat.messages) && !_localChat._localIndex && _localChat.messages.length > 0;
                        var _localTs = _localChat ? (typeof _localChat.updated_at === 'number' ? _localChat.updated_at : Date.parse(_localChat.updated_at) || 0) : 0;
                        var _serverTs = typeof _meta.updated_at === 'number' ? _meta.updated_at : Date.parse(_meta.updated_at) || 0;
                        var _isClearedLocally = _localChat && !!(_localChat.cleared || _localChat.cleared_at);
                        if (_isLoadedLocally && !_isClearedLocally && _serverTs > _localTs && _serverMsgCount > _localChat.messages.length) {
                            needFullFetch = true;
                        }
                    }
                }
                // ★ 仅在需要时才拉取完整数据 (大部分情况下本地已是最新, 无需传输6MB)
                if (needFullFetch) {
                    console.log('[save] 需要拉取完整数据 (服务器有更新)');
                    var fullResp = await fetch(url + '?chat_id=all', { headers: authHeaders });
                    if (fullResp.ok) {
                        var fullData = await fullResp.json();
                        _serverChats = fullData.chats || {};
                        // 重新执行合并 (使用完整数据)
                        for (var scid2 in _serverChats) {
                            if (_deletedChatIds[scid2]) continue;
                            if (!mergedChats[scid2]) {
                                mergedChats[scid2] = _serverChats[scid2];
                            } else {
                                var _localChat2 = mergedChats[scid2];
                                var _serverChat2 = _serverChats[scid2];
                                var _localMsgs = _localChat2.messages;
                                var _serverMsgs = _serverChat2.messages;
                                var _localTs2 = typeof _localChat2.updated_at === 'number' ? _localChat2.updated_at : Date.parse(_localChat2.updated_at) || 0;
                                var _serverTs2 = typeof _serverChat2.updated_at === 'number' ? _serverChat2.updated_at : Date.parse(_serverChat2.updated_at) || 0;
                                var _localRev2 = Number(_localChat2.revision || 0);
                                var _serverRev2 = Number(_serverChat2.revision || 0);
                                var _localTrunc2 = Number(_localChat2._truncatedAt || 0);
                                var _isLocalNewer2 = (_localRev2 > _serverRev2) || (_localTrunc2 > 0 && _localTrunc2 >= _serverTs2) || (_localTs2 >= _serverTs2);
                                var _isCleared2 = !!(_localChat2.cleared || _localChat2.cleared_at);
                                if (_serverMsgs && (!_localMsgs || (!_isCleared2 && !_isLocalNewer2 && _serverTs2 > _localTs2 && _serverMsgs.length > _localMsgs.length))) {
                                    var _oldLocalMsgs = _localMsgs || [];
                                    mergedChats[scid2].messages = JSON.parse(JSON.stringify(_serverMsgs));
                                    for (var _mi = 0; _mi < Math.min(_oldLocalMsgs.length, mergedChats[scid2].messages.length); _mi++) {
                                        _mergeGeneratedImageFields(mergedChats[scid2].messages[_mi], _oldLocalMsgs[_mi]);
                                    }
                                    mergedChats[scid2].updated_at = _serverChats[scid2].updated_at;
                                } else if (_serverMsgs && _localMsgs) {
                                    for (var _mi2 = 0; _mi2 < Math.min(_serverMsgs.length, _localMsgs.length); _mi2++) {
                                        _mergeGeneratedImageFields(_localMsgs[_mi2], _serverMsgs[_mi2]);
                                    }
                                }
                            }
                        }
                    }
                } else {
                    console.log('[save] 本地已是最新, 跳过完整数据拉取');
                }
                console.log('[save] 合并新增:', added);
            }
        } catch(e) {
            var _getMergeMsg = String(e && e.message || e || 'unknown');
            var _getWasAbort = _getTimedOut || (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) || /aborted|timeout/i.test(_getMergeMsg);
            // 全量备份只是低优先级的防灾汇总；网络超时不应作为控制台 WARN 干扰
            // 正在生成的用户，也绝不能影响单会话即时落盘和 RS 首 token。
            if (_getWasAbort) {
                console.info('[save] GET合并检查超时，跳过本次低优先级全量备份');
            } else {
                console.warn('[save] GET合并失败:', _getMergeMsg);
            }
        }

        // ★ 防误覆盖:GET失败或服务器数据远多于本地时,跳过保存
        if (!_getOk) {
            console.warn('[save] GET失败,跳过保存防止覆盖');
            return false;
        }
        if (Object.keys(_serverChats).length >= 3 && _localCount <= 2) {
            console.warn('[save] 本地仅'+_localCount+'条,服务器有'+Object.keys(_serverChats).length+'条,跳过保存');
            return false;
        }

        var response = await fetch(url, {
            method: 'POST',
            headers: _chatStorageAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ chat_id: 'all', chats: mergedChats, title: '聊天备份' }),
            keepalive: false
        });

        if (response.ok) {
            _deletedChatIds = {}; // 清除已同步的删除标记
            try { localStorage.removeItem('_deletedChatIds'); } catch(e) {}
            return true;
        }
        return false;
    } catch (e) {
        console.warn('[saveChatsToServer] 备份失败:', e.message);
        // ★ 不再发送精简版重试 — 发送10条×4消息会覆盖服务器完整数据,造成不可逆丢失
        //   依赖下一次 saveChatsDebounced(300ms) 自动重试完整数据
        return false;
    }
}

// ★ 将完整配置保存到服务器(按用户隔离)
async function saveConfigToServer() {
    var token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        var config = {};
        var allKeys = [];
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k || k === 'chats' || k === 'lastChatId' || k === 'deviceId' ||
                k === 'ongoingChats' || k === 'authToken' || k === 'authUsername' ||
                k === 'authUserId' || k === 'dark' || k === 'modelContextLength' ||
                k === 'modelMaxOutputTokens' || k === 'autoDetectedTextModels' ||
                k === 'useAnthropicFormat' || k === 'agentModeLocalTs' || k === '_test' || _isTransientRuntimeStorageKey(k)) continue;
            allKeys.push(k);
        }
        allKeys.forEach(function(k) {
            var v = localStorage.getItem(k);
            if (v !== null && v !== undefined) config[k] = v;
        });
        // ★ 发送时强制让当前厂商专属模型与全局模型同源，杜绝异步 DOM 或旧值把 model 写成别的厂商模型。
        var _activeProvider = localStorage.getItem('baseUrlProvider') || 'custom';
        var _activeProviderModel = localStorage.getItem('model_' + _activeProvider) || '';
        if (_activeProviderModel && !/^(加载中|请输入|获取失败|loading)/i.test(_activeProviderModel)) {
            config.model = _activeProviderModel;
            config['model_' + _activeProvider] = _activeProviderModel;
        }
        // 模型时间戳只在用户真实切换模型时更新；普通配置保存沿用原值，避免旧标签页伪装成最新模型选择。
        config._modelSelectionSavedAt = localStorage.getItem('_modelSelectionSavedAt') || '0';
        console.log('[save] 保存', Object.keys(config).length, '个配置项到服务器');
        var url = SERVER_API_BASE + '/chat.php?action=save_config';
        var saved = false;
        try {
            var resp = await fetch(url, { method: 'POST', headers: _chatStorageAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(config), keepalive: false });
            if (resp.ok) saved = true;
        } catch(e1) { console.warn('[save] 保存失败:', e1.message); }
        if (!saved) {
            try {
                var resp2 = await fetch(url, { method: 'POST', headers: _chatStorageAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(config), keepalive: true });
                if (resp2.ok) saved = true;
            } catch(e2) { console.warn('[save] 重试保存也失败:', e2.message); }
        }
        console.log(saved ? '[save] 配置保存完成' : '[save] 配置保存失败(已重试)');

    } catch(e) {
        console.warn('[save] 配置保存失败:', e.message);
    }
}

// ★ 从服务器加载配置
// ★ 新用户默认配置
function getDefaultConfig() {
    return {
        // 官方 DeepSeek API；不使用项目自建 gpt.naujtrats.xyz 网关
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-flash-vision-exp',
        // 原生视觉模型：图片随主请求发送，不再调用独立视觉分析工具
        visionModel: 'deepseek-v4-flash-vision-exp',
        // 原生视觉请求走官方 DeepSeek API，不走独立 MCP 图片分析
        visionApiUrl: 'https://api.deepseek.com/v1',
        visionApiKey: '',
        imageModel: 'image-01',
        imageBaseUrl: 'https://api.minimaxi.com/v1',
        imageApiKey: '',
        imageApiKeyOpenai: '',
        imageBaseUrlOpenai: 'https://api.openai.com/v1',
        imageApiKeyCustom: '',
        imageBaseUrlCustom: '',
        imageProvider: 'minimax',
        apiKey: '',
        temp: '0.7',
        tokens: '8192',
        stream: 'true',
        requestTimeout: '120',
        markdownGFM: 'true',
        markdownBreaks: 'false',
        lineHeight: '1.65',
        fontSize: '14',
        enableSearch: 'false',
        searchProvider: 'tavily',
        searchTimeout: '30',
        maxSearchResults: '3',
        aiSearchJudge: 'true',
        aiSearchJudgeModel: 'deepseek-chat',
        searchAppendToSystem: 'true'
    };
}

async function loadConfigFromServer() {
    console.log('[loadConfigFromServer] 开始加载');
    var token = localStorage.getItem('authToken');
    if (!token) { console.log('[loadConfigFromServer] 无token'); return; }
    console.log('[loadConfigFromServer] token有效,请求配置');
    try {
        var resp = await fetch(SERVER_API_BASE + '/chat.php?action=get_config', { cache: 'no-store', headers: _chatStorageAuthHeaders() });
        console.log('[loadConfigFromServer] 响应状态:', resp.status);
        if (!resp.ok) { console.log('[loadConfigFromServer] 响应异常,跳过'); return; }
        var config = await resp.json();
        console.log('[loadConfigFromServer] 服务器配置键数:', config ? Object.keys(config).length : 0);
        if (!config || Object.keys(config).length === 0) {
            console.log('[loadConfigFromServer] 服务器无配置数据');
            return;
        }
        // 静默写入所有键,只在出错时记录
        // ★ 跳过无效值:含中文/英文提示语的模型名、明显错误数据
        var _invalidModel = function(v) {
            if (!v || typeof v !== 'string') return true;
            // 过滤提示语(加载中、请输入API Key、空字符串、未设置)
            if (/^[\s\S]*(加载|请输入|请先|未设置|默认|选择|请选择)/.test(v)) return true;
            // 过滤纯 placeholder
            if (v.length < 2) return true;
            return false;
        };
        for (var k in config) {
            if (_isTransientRuntimeStorageKey(k)) continue;
            // model 字段写入前额外校验:不接受提示语或过短的值
            if ((k === 'model' || k.indexOf('model_') === 0) && _invalidModel(config[k])) {
                console.log('[loadConfigFromServer] 跳过无效模型:', k, config[k]);
                continue;
            }
            // Agent 运行模式/权限/偏好是本机交互状态：服务器只负责保存，不能用旧快照回灌覆盖。
            if (config[k] !== null && config[k] !== undefined && k !== 'dark' && k !== 'agentMode' && k !== 'agentPreferredMode' && k !== 'agentModeLocalTs' && k !== 'workspacePermission' && k !== 'useAnthropicFormat') {
                var _val = config[k];
                // ★ 清理模型名中的 "models/" / "publishers/" 前缀 (Google API 等返回的格式)
                if ((k === 'model' || k.indexOf('model_') === 0) && typeof _val === 'string') {
                    _val = _val.replace(/^(models|publishers)\//, '');
                }
                // ★ 模型选择是用户本机即时操作的权威状态：云端只能在本机该键为空时补齐，绝不能回灌旧值覆盖刚选模型。
                //    这是修复“刷新/切换厂商后被重置到第一个模型”的最后一道防线。
                if (k === 'model' || k.indexOf('model_') === 0) {
                    var _localModel = localStorage.getItem(k) || '';
                    if (_localModel && !_invalidModel(_localModel)) {
                        console.log('[loadConfigFromServer] 保留本机模型选择:', k, _localModel);
                        continue;
                    }
                }
                // ★ 不覆盖本地已设置的 baseUrlProvider(防止服务器旧值覆盖用户刚切换的厂商)
                if (k === 'baseUrlProvider' && localStorage.getItem(k)) {
                    console.log('[loadConfigFromServer] 跳过 baseUrlProvider(本地已有值):', localStorage.getItem(k));
                    continue;
                }
                // ★ 视觉 Key 配置: 本地为空时始终使用服务器值 (服务器是权威来源)
                //    URL 字段保留本地非默认值 (防止覆盖用户刚修改的)
                if (k === 'visionApiKeyXAI' || k === 'visionApiKeyOpenAI' || k === 'visionApiKey') {
                    var _localKey = localStorage.getItem(k);
                    if (!_localKey || _localKey.length < 4) {
                        // 本地 key 为空, 强制使用服务器值
                        console.log('[loadConfigFromServer] 本地 key 为空, 使用服务器值:', k);
                    } else {
                        console.log('[loadConfigFromServer] 保留本地 key:', k);
                        continue;
                    }
                }
                try { localStorage.setItem(k, _val); } catch(e) { console.warn('[loadConfigFromServer] 写入失败:', k); }
            }
        }
        console.log('[loadConfigFromServer] 写入完成,共', Object.keys(config).length, '项');
        // ★ 服务器配置写入 localStorage 后,重新填充 UI 表单(确保服务器值正确显示)
        if (typeof initializeConfig === 'function') initializeConfig();
        if (typeof loadSearchConfig === 'function') loadSearchConfig();
    } catch(e) {
        console.warn('[loadConfigFromServer] 失败:', e.message);
    }
}

async function loadChatsFromServer() {
    try {
        // ★ 兼容跨域 cookie(从 www 过来时 localStorage 暂无 token)
        var token = localStorage.getItem('authToken') || getCookie('auth_token');
        var deviceId = localStorage.getItem('deviceId');
        if (!token && !deviceId) return null;
        // 首屏只请求轻量元数据；16MB+ 的 all.json 完整正文改为当前会话/点击会话按需读取。
        var url = SERVER_API_BASE + '/chat.php?chat_id=all&meta=1';
        if (!token) {
            url += '&device_id=' + deviceId;
        }
        // 元数据响应通常很小，保留超时仅防异常连接
        var controller = new AbortController();
        var timer = setTimeout(function() { controller.abort(); }, 30000);
        try {
            var response = await fetch(url, { cache: 'no-store', signal: controller.signal, headers: token ? _chatStorageAuthHeaders() : {} });
            clearTimeout(timer);
            if (response.ok) {
                var result = await response.json();
                // 元数据转换成索引聊天对象；消息正文由 loadChat 按需 hydration。
                if (result.chats && result.meta) {
                    var indexed = {};
                    Object.keys(result.chats).forEach(function(cid) {
                        var m = result.chats[cid] || {};
                        indexed[cid] = { title: m.title || '新对话', updated_at: m.updated_at || 0, msgCount: m.msg_count || 0, messages: [], _localIndex: true };
                    });
                    result.chats = indexed;
                }
                if (result.chats) return result;
            }
            return null;
        } catch(e) {
            clearTimeout(timer);
            throw e;
        }
    } catch (e) {
        console.warn('[loadChatsFromServer] 恢复失败:', e.message);
        return null;
    }
}

// ★ 登录后的数据恢复:从服务器加载当前账号的配置和聊天记录
async function restoreUserData() {
    console.log('[restoreUserData] 开始恢复用户数据');
    // 在任何异步配置/聊天合并前冻结用户刷新前正在查看的会话。
    // sessionStorage 按标签页隔离，不会被其他设备的配置同步或旧流状态覆盖。
    var _preferredChatId = null;
    try {
        _preferredChatId = sessionStorage.getItem('_oneapiLastChatId') || localStorage.getItem('lastChatId');
    } catch(e) {
        _preferredChatId = localStorage.getItem('lastChatId');
    }
    // 保留新鲜的恢复凭据。旧逻辑在 ResumeStream/active-task 检查前无条件删除，
    // 使“刷新续接”在初始化第一步就失效；这里只清理明确过期的数据。
    try {
        var _resumeTs = parseInt(localStorage.getItem('_rs_ts') || '0');
        var _resumeBook = JSON.parse(localStorage.getItem('_rs_state_v3') || 'null');
        var _hasFreshBook = false;
        if (_resumeBook && _resumeBook.chats) {
            Object.keys(_resumeBook.chats).forEach(function(_rid) {
                var _rst = _resumeBook.chats[_rid];
                if (!_rst || Date.now() - (_rst.updatedAt || 0) > 600000) delete _resumeBook.chats[_rid];
                else _hasFreshBook = true;
            });
            localStorage.setItem('_rs_state_v3', JSON.stringify(_resumeBook));
        }
        if (!_hasFreshBook && (!_resumeTs || Date.now() - _resumeTs > 600000)) {
            localStorage.removeItem('_savedPartial');
            localStorage.removeItem('_rs_sid');
            localStorage.removeItem('_rs_cid');
            localStorage.removeItem('_rs_msgid');
            localStorage.removeItem('_rs_ts');
        }
    } catch(e) {}
    // ★ 优先读 localStorage,其次跨域 cookie(从其他域名过来时)
    var token = localStorage.getItem('authToken') || getCookie('auth_token');
    if (!token && typeof getAuthToken === 'function') token = getAuthToken();
    console.log('[restoreUserData] token:', token ? 'present' : 'null');
    if (!token) { console.log('[restoreUserData] 无token,跳过'); return; }

    var uid = localStorage.getItem('authUserId') || '';

    // ★ 安全隔离: 检查本地 chats 是否有不属于当前用户的数据
    //     (修复 bfcache/竞态条件导致切换账号后旧数据残留)
    if (uid) {
        var foreignChatIds = [];
        for (var _cid in chats) {
            var _cUid = chats[_cid].userId;
            // 如果有 userId 标记且不等于当前用户 → 标记为外来数据
            if (_cUid && _cUid !== uid) {
                foreignChatIds.push(_cid);
            }
        }
        if (foreignChatIds.length > 0) {
            console.log('[restoreUserData] 发现', foreignChatIds.length, '个不属于当前用户的对话,清除:', foreignChatIds);
            for (var _fi = 0; _fi < foreignChatIds.length; _fi++) {
                delete chats[foreignChatIds[_fi]];
            }
            slimSaveChats();
        }
    }

    // 0. 迁移旧聊天记录:给没有 userId 的打上当前用户标签
    if (uid) {
        var migrated = 0;
        for (var _cid in chats) {
            if (!chats[_cid].userId) {
                chats[_cid].userId = uid;
                migrated++;
            }
        }
        if (migrated > 0) {
            slimSaveChats();
            console.log('[restoreUserData] 迁移了', migrated, '个旧聊天记录');
        }
    }

    // ★ 并行加载配置和聊天记录
    console.log('[restoreUserData] 并行加载配置和聊天记录...');
    var _serverChats = null;
    await Promise.all([
        (async function() {
            try { await Promise.race([loadConfigFromServer(), new Promise(function(resolve){setTimeout(resolve, 8000)})]); } catch(e) { console.warn('[restoreUserData] 配置加载失败:', e.message); }
        })(),
        (async function() {
            try {
                var _serverResult = await Promise.race([
                    loadChatsFromServer(),
                    new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, 30000); })
                ]);
                // ★ loadChatsFromServer 现在返回完整响应 {chats, deleted}
                _serverChats = (_serverResult && _serverResult.chats) ? _serverResult.chats : _serverResult;
                var _serverDeleted = (_serverResult && _serverResult.deleted) ? _serverResult.deleted : {};
                if (_serverChats && typeof _serverChats === 'object' && Object.keys(_serverChats).length > 0) {
                    // ★ 合并:本地优先(最新数据),服务器补充缺失项
                    var merged = {};
                    for (var _cid2 in chats) {
                        merged[_cid2] = JSON.parse(JSON.stringify(chats[_cid2]));
                    }
                    var added = 0;
                    // ★ 跨域名同步: 仅删除服务器明确墓碑标记的聊天(2026-08-10 修复)
                    //   旧逻辑: 服务器不存在就删本地 → 服务器数据不完整时误删真实聊天(数据丢失根因之一)
                    //   新逻辑: 仅当服务器 deleted 墓碑中存在该 id 且本地更新时间早于墓碑时间时才删除
                    if (_serverChats && Object.keys(_serverChats).length > 0 && Object.keys(_serverDeleted).length > 0) {
                        for (var _lcid in merged) {
                            // ★ Agent 域聊天(主会话/归档会话)不参与本地残留清除 — 删除经 DELETE+墓碑传播
                            if (isAgentChat(_lcid)) continue;
                            if (_deletedChatIds && _deletedChatIds[_lcid]) continue;
                            // ★ 仅当服务器有明确墓碑标记时才删除(服务器已确认该聊天被删除)
                            if (!_serverChats[_lcid] && _serverDeleted[_lcid]) {
                                var _lc = merged[_lcid];
                                var _tombTs = _serverDeleted[_lcid];
                                // 墓碑时间(毫秒) vs 本地更新时间 — 本地更新于墓碑之前 → 确认为旧聊天, 删除
                                var _localTs = typeof _lc.updated_at === 'number' ? _lc.updated_at : Date.parse(_lc.updated_at) || 0;
                                var _tombMs = typeof _tombTs === 'number' ? _tombTs : Date.parse(_tombTs) || 0;
                                if (_localTs <= _tombMs) {
                                    console.log('[restoreUserData] 移除已删除聊天(服务器墓碑):', _lcid, _lc.title);
                                    delete merged[_lcid];
                                    delete chats[_lcid];
                                }
                            }
                        }
                    }
                    for (var _scid in _serverChats) {
                        // ★ Agent 域聊天: 智能合并(取更新鲜/权威的版本，尊重本地清空)
                        if (isAgentChat(_scid)) {
                            if (!merged[_scid]) {
                                // 本地无此 Agent 聊天 → 从服务器恢复
                                merged[_scid] = JSON.parse(JSON.stringify(_serverChats[_scid]));
                                console.log('[restoreUserData] Agent 聊天从服务器恢复:', _scid);
                            } else {
                                var _localChatA = merged[_scid];
                                var _serverChatA = _serverChats[_scid];
                                var _localMsgs = _localChatA.messages || [];
                                var _serverMsgs = _serverChatA.messages || [];
                                var _localTsA = typeof _localChatA.updated_at === 'number' ? _localChatA.updated_at : Date.parse(_localChatA.updated_at) || 0;
                                var _serverTsA = typeof _serverChatA.updated_at === 'number' ? _serverChatA.updated_at : Date.parse(_serverChatA.updated_at) || 0;
                                var _localRevA = Number(_localChatA.revision || 0);
                                var _serverRevA = Number(_serverChatA.revision || 0);
                                var _localTruncA = Number(_localChatA._truncatedAt || 0);
                                var _isLocalNewerA = (_localRevA > _serverRevA) || (_localTruncA > 0 && _localTruncA >= _serverTsA) || (_localTsA >= _serverTsA);
                                var _isClearedA = !!(_localChatA.cleared || _localChatA.cleared_at);
                                var _isIndexOnlyA = !!(_localChatA._localIndex || _localChatA._indexOnly);

                                // DB/index 模式下本地只有标题和 msgCount，没有消息正文；
                                // 普通模式下若本地明确更新/截断，绝不使用服务器旧长数组覆盖
                                if (!_isClearedA && (_isIndexOnlyA ? _serverMsgs.length > 0 : (!_isLocalNewerA && _serverMsgs.length > _localMsgs.length && _serverTsA > _localTsA))) {
                                    merged[_scid].messages = JSON.parse(JSON.stringify(_serverMsgs));
                                    delete merged[_scid]._localIndex;
                                    delete merged[_scid]._indexOnly;
                                    for (var _ami = 0; _ami < Math.min(_localMsgs.length, merged[_scid].messages.length); _ami++) {
                                        _mergeGeneratedImageFields(merged[_scid].messages[_ami], _localMsgs[_ami]);
                                    }
                                    merged[_scid].updated_at = _serverChats[_scid].updated_at || Date.now();
                                    console.log('[restoreUserData] Agent 聊天从服务器同步(更新且更多消息):', _scid, _localMsgs.length, '→', _serverMsgs.length);
                                } else {
                                    for (var _ami2 = 0; _ami2 < Math.min(_localMsgs.length, _serverMsgs.length); _ami2++) {
                                        _mergeGeneratedImageFields(_localMsgs[_ami2], _serverMsgs[_ami2]);
                                    }
                                }
                            }
                            continue;
                        }
                        if (_deletedChatIds && _deletedChatIds[_scid]) continue; // 跳过已删除
                        var _sc = _serverChats[_scid];
                        if (!merged[_scid]) {
                            merged[_scid] = _sc;
                            added++;
                        } else {
                            var _mc = merged[_scid];
                            var _localTsM = typeof _mc.updated_at === 'number' ? _mc.updated_at : Date.parse(_mc.updated_at) || 0;
                            var _serverTsM = typeof _sc.updated_at === 'number' ? _sc.updated_at : Date.parse(_sc.updated_at) || 0;
                            var _localRevM = Number(_mc.revision || 0);
                            var _serverRevM = Number(_sc.revision || 0);
                            var _localTruncM = Number(_mc._truncatedAt || 0);
                            var _isLocalNewerM = (_localRevM > _serverRevM) || (_localTruncM > 0 && _localTruncM >= _serverTsM) || (_localTsM >= _serverTsM);
                            var _isClearedM = !!(_mc.cleared || _mc.cleared_at);

                            // ★ 修复: 当本地未清空且本地未更新/未截断，且服务器确实更新时才使用服务器数据
                            if (_sc.messages && _mc.messages) {
                                var _isIndexOnlyM = !!(_mc._localIndex || _mc._indexOnly);
                                if (!_isClearedM && (_isIndexOnlyM ? _sc.messages.length > 0 : (!_isLocalNewerM && _sc.messages.length > _mc.messages.length && _serverTsM > _localTsM))) {
                                    // DB/index 模式只有元数据，服务器完整消息优先恢复
                                    delete _mc._localIndex;
                                    delete _mc._indexOnly;
                                    // 先保存本地消息中的图片数据
                                    var _localImages = {};
                                    for (var _li = 0; _li < _mc.messages.length; _li++) {
                                        var _lm = _mc.messages[_li];
                                        if (_lm.generatedImages && _lm.generatedImages.length > 0) {
                                            _localImages[_li] = _lm.generatedImages.slice();
                                        }
                                        if (_lm.generatedImage) {
                                            _localImages['_single_' + _li] = _lm.generatedImage;
                                        }
                                    }
                                    // 使用服务器消息
                                    _mc.messages = _sc.messages;
                                    _mc.updated_at = _sc.updated_at || _localTsM;
                                    if (_sc.title && _mc.title !== _sc.title) _mc.title = _sc.title;
                                    // 恢复本地图片数据到原消息位置。不能用图片键数量作为消息下标上限，
                                    // 否则第 76/137 条消息上的图片会被漏掉。
                                    Object.keys(_localImages).forEach(function(_imageKey) {
                                        var _imageIndex = _imageKey.indexOf('_single_') === 0 ?
                                            parseInt(_imageKey.substring(8), 10) : parseInt(_imageKey, 10);
                                        if (!Number.isFinite(_imageIndex) || !_mc.messages[_imageIndex]) return;
                                        if (_imageKey.indexOf('_single_') === 0) {
                                            _mc.messages[_imageIndex].generatedImage = _localImages[_imageKey];
                                        } else {
                                            _mc.messages[_imageIndex].generatedImages = _localImages[_imageKey];
                                        }
                                    });
                                } else if (_sc.messages.length === _mc.messages.length) {
                                    // 消息数相同 — 保留本地图片数据,不从服务器覆盖
                                }
                            } else if (_sc.messages && !_mc.messages) {
                                _mc.messages = _sc.messages;
                            }
                            // ★ 时间轴权威修复：服务器 meta 是当前会话索引的唯一时间来源。
                            // 本地缓存可能保留旧版批量污染时间戳（全部变成今天），不能再用
                            // “本地时间更大”阻止服务器纠正；只更新元数据，不覆盖本地正文。
                            if (getChatTimestamp && _sc.updated_at) {
                                var _serverTimelineTs = getChatTimestamp(_sc, _scid);
                                if (_serverTimelineTs > 0) _mc.updated_at = _serverTimelineTs;
                            }
                            // 图片数据恢复
                            if (_sc.messages && _mc.messages) {
                                var _minLen = Math.min(_sc.messages.length, _mc.messages.length);
                                for (var _smi = 0; _smi < _minLen; _smi++) {
                                    var _sm = _sc.messages[_smi];
                                    var _mm = _mc.messages[_smi];
                                    if (_sm && _mm) {
                                        _mergeGeneratedImageFields(_mm, _sm);
                                    }
                                }
                            }
                        }
                    }
                    // DB/index 模式返回的聊天对象可能只有元数据；统一补齐消息数组，
                    // 同时把旧版本对象形态的工具字段收敛为当前 wire 形状。
                    Object.keys(merged).forEach(function(_nid) {
                        var _nc = merged[_nid];
                        if (!_nc || typeof _nc !== 'object') _nc = merged[_nid] = { title: '新对话' };
                        if (!Array.isArray(_nc.messages)) _nc.messages = [];
                        _nc.messages = _nc.messages.filter(function(_nm) {
                            if (!_nm || typeof _nm !== 'object') return false;
                            if (_nm.role === 'assistant' && _nm.tool_calls != null && !Array.isArray(_nm.tool_calls)) _nm.tool_calls = [];
                            if (_nm.role === 'tool' && _nm.content != null && typeof _nm.content !== 'string') {
                                try { _nm.content = JSON.stringify(_nm.content); } catch(e) { _nm.content = String(_nm.content); }
                            }
                            return true;
                        });
                    });
                    chats = merged;
                    // 清理仅属于旧标签页的运行态标记。含正文、推理、工具或图片的消息是
                    // 有效历史，只做“最终化”；只有完全空的占位气泡才移除。
                    var _cleanedPartial = 0;
                    for (var _cid in chats) {
                        if (chats[_cid] && chats[_cid].messages) {
                            var _before = chats[_cid].messages.length;
                            // ★ 诊断: 记录过滤前的partial消息状态
                            var _partialsBefore = chats[_cid].messages.filter(function(m){return m.partial;});
                            if (_partialsBefore.length > 0) {
                                console.log('[restoreUserData] chat ' + _cid + ' has ' + _partialsBefore.length + ' partials:',
                                    _partialsBefore.map(function(m){return 'role='+m.role+' contentLen='+(m.content||'').length+' partial='+m.partial+' _recovered='+!!m._recovered;}));
                            }
                            for (var _di = chats[_cid].messages.length - 1; _di >= 0; _di--) {
                                var _dm = chats[_cid].messages[_di];
                                if (!_dm || (_dm.role !== 'assistant')) continue;
                                var _hasDurableData = !!(
                                    (typeof _dm.content === 'string' && _dm.content.trim()) ||
                                    _dm.reasoning || _dm.tool_calls || _dm.generatedImage ||
                                    (Array.isArray(_dm.generatedImages) && _dm.generatedImages.length) ||
                                    (_dm.files && _dm.files.length)
                                );
                                if ((_dm.partial || _dm._recovered) && !_hasDurableData) {
                                    chats[_cid].messages.splice(_di, 1);
                                    continue;
                                }
                                if (_dm.partial || _dm._recovered) {
                                    delete _dm.partial;
                                    delete _dm._recovered;
                                    delete _dm._rsMsgId;
                                    delete _dm._rsStreamId;
                                    _dm.time = _dm.time || chats[_cid].updated_at || Date.now();
                                }
                            }
                            _cleanedPartial += Math.max(0, _before - chats[_cid].messages.length);
                        }
                    }
                    if (_cleanedPartial > 0) console.log('[restoreUserData] 清理了 ' + _cleanedPartial + ' 条空的运行态占位消息');
                    // ★ 避免 quota exceeded:使用 slimSaveChats 写入(自动压缩+截断大图片)
                    try { slimSaveChats(); } catch(e) {
                        console.warn('[restoreUserData] 写入localStorage失败,尝试精简:', e.message);
                        // 极简模式:只保留标题骨架
                        try {
                            var mini = {};
                            Object.keys(chats).slice(-5).forEach(function(id) {
                                mini[id] = { title: chats[id].title || '新对话', updated_at: chats[id].updated_at || '', messages: [] };
                            });
                            localStorage.setItem('chats', JSON.stringify(mini));
                        } catch(e2) {
                            console.error('[restoreUserData] 极简保存也失败');
                        }
                    }
                    renderChatHistory();
                    console.log('[restoreUserData] 合并: 本地', Object.keys(chats).length - added, '个, 服务器补充', added, '个');
                } else {
                    console.log('[restoreUserData] 服务器无聊天记录,保留本地');
                }
            } catch(e) { console.warn('[restoreUserData] 聊天加载失败:', e.message); }
        })()
    ]);

    // ★ 配置和聊天都加载完后初始化
    console.log('[restoreUserData] 初始化配置');
    initializeConfig();
    // ★ 模型配置:预填充已知不支持工具的模型到 noToolModels 列表
    try {
        var _existingNoTool = JSON.parse(localStorage.getItem('noToolModels') || '[]');
        // 硬编码已知不支持工具的模型(即使 models.js 未加载也能生效)
        var _builtinNoTools = [
            'deepseek-reasoner', 'deepseek-r1', 'qwq', 'qwq-',
            'grok-3-reasoning', 'grok-3-reasoner',
            // 图像生成模型不支持工具调用
            'gpt-5.4-image', 'gpt-4o-image', 'image-01', 'image-02',
            'dall-e', 'dalle', 'imagen', 'flux', 'midjourney',
            'stable-diffusion', 'stable-diffusion-xl', 'sdxl'
        ];
        for (var _bni = 0; _bni < _builtinNoTools.length; _bni++) {
            var _bn = _builtinNoTools[_bni].toLowerCase();
            if (_existingNoTool.indexOf(_bn) === -1) {
                _existingNoTool.push(_bn);
            }
        }
        // 从 models.js 自动加载更多
        if (window.MODEL_CONFIGS) {
            var _allConfigs = window.MODEL_CONFIGS.getAllConfigs();
            for (var _ci = 0; _ci < _allConfigs.length; _ci++) {
                var _m = _allConfigs[_ci];
                if (_m && _m[0] && _m[0] !== '*' && window.MODEL_CONFIGS.isNoToolsBuiltin(_m[0])) {
                    for (var _mj = 0; _mj < _m.length; _mj++) {
                        var _n = _m[_mj].toLowerCase();
                        if (_existingNoTool.indexOf(_n) === -1 && _n !== '*') {
                            _existingNoTool.push(_n);
                        }
                    }
                }
            }
        }
        localStorage.setItem('noToolModels', JSON.stringify(_existingNoTool));
    } catch(e) { console.warn('[ModelCfg] 初始化 no-tool 列表失败:', e.message); }
    // ★ 核心逻辑: 只在真正没有任何对话时才新建
    // ★ 恢复 Agent 主聊:即使服务器合并时排除了 _agent_main,也要确保加载前存在
    var _agentMainId = '_agent_main';
    if (!chats[_agentMainId]) {
        // 看看 localStorage 是否有缓存的 agent system prompt (表示之前是 agent 模式)
        var _agentWasActive = localStorage.getItem('agentMode') && localStorage.getItem('agentMode') !== 'off';
        // 看看服务器数据里有没有 agent 主聊
        if (_serverChats && _serverChats[_agentMainId]) {
            chats[_agentMainId] = JSON.parse(JSON.stringify(_serverChats[_agentMainId]));
            if (!chats[_agentMainId].messages) chats[_agentMainId].messages = [];
            console.log('[restoreUserData] 从服务器恢复了 Agent 主聊');
        } else if (_agentWasActive) {
            // 之前是 agent 模式但数据丢了,重新创建 (用缓存的 system prompt)
            var _agentSys = localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt;
            var _uid = localStorage.getItem('authUserId') || '';
            chats[_agentMainId] = {
                title: 'Agent',
                userId: _uid,
                updated_at: Date.now(),
                messages: [
                    { role: 'system', content: _agentSys }
                ]
            };
            console.log('[restoreUserData] 恢复了 Agent 主聊(system prompt)');
        }
        // 保存一下
        try { slimSaveChats(); } catch(e) {}
    }
    var chatKeys = Object.keys(chats);
    if (chatKeys.length === 0 && _serverChats && typeof _serverChats === 'object' && Object.keys(_serverChats).length > 0) {
        // 服务器有数据但本地被清空了,用服务器数据恢复
        console.log('[restoreUserData] 本地无记录,从服务器恢复', Object.keys(_serverChats).length, '个对话');
        chats = JSON.parse(JSON.stringify(_serverChats));
        try { slimSaveChats(); } catch(e) {}
        renderChatHistory();
        chatKeys = Object.keys(chats);
    }
    // ★ 双重检查: 合并后仍然为空才新建
    if (chatKeys.length === 0) {
        console.log('[restoreUserData] 无聊天记录,自动新建');
        createNewChat();
    } else {
        // 恢复上次打开的对话
        var lastId = _preferredChatId || localStorage.getItem('lastChatId');
        // ★ 严格分隔: 上次打开的聊天必须与当前模式同域
        //   普通视图 + Agent 聊天(主会话/归档) → 回到上次普通聊天
        //   Agent 视图 + 普通聊天 → 回到 Agent 主会话
        var _agentView = isAgentToolsActive();
        if (!_agentView && lastId && isAgentChat(lastId)) {
            lastId = localStorage.getItem('lastNormalChatId') || null;
        } else if (_agentView && lastId && !isAgentChat(lastId)) {
            lastId = AGENT_CHAT_ID;
        }
        if (lastId && chats[lastId]) {
            loadChat(lastId);
        } else {
            // ★ 只从与当前模式同域的聊天中选最新(agent 主聊已在上方补回)
            var firstKey = chatKeys.filter(function(id) {
                return isAgentChat(id) === _agentView;
            }).sort(function(a,b) {
                var ta = typeof getChatTimestamp === 'function' ? getChatTimestamp(chats[a], a) : (Number(chats[a].updated_at) || 0);
                var tb = typeof getChatTimestamp === 'function' ? getChatTimestamp(chats[b], b) : (Number(chats[b].updated_at) || 0);
                return tb - ta;
            })[0];
            if (firstKey) loadChat(firstKey);
            else createNewChat();
        }
    }
    // ★ 恢复刷新前输入框中的文本
    try {
        var _savedText = localStorage.getItem('_savedInputText');
        if (_savedText) {
            var _input = getEl('chatInput');
            if (_input) {
                _input.value = _savedText;
                // 自动聚焦并移动光标到末尾
                _input.focus();
                _input.selectionStart = _input.selectionEnd = _savedText.length;
                // 触发输入事件,让UI更新发送按钮状态
                _input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            localStorage.removeItem('_savedInputText');
        }
    } catch(e) {}


    console.log('[restoreUserData] 恢复完成 — _agent_main msgs=' + (chats['_agent_main'] && chats['_agent_main'].messages ? chats['_agent_main'].messages.length : 'N/A'));
    console.log('[restoreUserData] 恢复完成');
    // ★ 允许配置同步（在此之前 _scheduleConfigSync 会被拦截）
    window._configRestored = true;
    // ★ 启动引擎状态自动刷新
    if (typeof window._startEngineAutoRefresh === 'function') {
        setTimeout(function() { window._startEngineAutoRefresh(); }, 2000);
    }
    // ★ 清理空的视频分析缓存（之前因权限/内存问题写入的空缓存）
    try {
        for (var _cid in chats) {
            if (chats[_cid].videoAnalyses) {
                var _cleaned = false;
                for (var _ck in chats[_cid].videoAnalyses) {
                    if (!chats[_cid].videoAnalyses[_ck].frames || chats[_cid].videoAnalyses[_ck].frames.length === 0) {
                        delete chats[_cid].videoAnalyses[_ck];
                        _cleaned = true;
                    }
                }
                if (_cleaned) slimSaveChats();
            }
        }
    } catch(e) {}
    // ★ 延迟启动 Agent 通知轮询, 避免和主数据加载竞争 abort
    setTimeout(function() { window.startAgentNotificationPolling(); }, 2000);
    // Connect SSE real-time channel for cross-browser sync
    // ★ WebSocket 先连接（让 resume 可用）
    window._wsInit();
    setTimeout(function() { window.connectSSEChannel(); }, 1000);

    // ★ 恢复引擎侧活跃任务（跨浏览器/刷新后继续接收流）
    setTimeout(function() { window._recoverActiveTasks(); }, 1500);

    // ★ Agent 模式恢复:如果刷新前 agentMode 是激活的,自动恢复
    var _agentModeSaved = localStorage.getItem('agentMode');
    if (_agentModeSaved && _agentModeSaved !== 'off') {
        var _currentMode = getAgentMode();
        if (_currentMode !== _agentModeSaved) {
            // 直接写 localStorage 和恢复，绕过 setAgentMode 的同模式退出逻辑
            localStorage.setItem('agentMode', _agentModeSaved);
            // 启用工具
            AGENT_TOOL_KEYS.forEach(function(k) { window.setToolEnabled(k, true); });
            updateAgentUI();
            if (typeof renderToolPanel === 'function') renderToolPanel();
            console.log('[Agent] 刷新后恢复模式:', _agentModeSaved);
            // ★ 严格分隔: 恢复 Agent 模式后确保当前聊天属于 Agent 域
            if (currentChatId && !isAgentChat(currentChatId) && chats[AGENT_CHAT_ID]) {
                loadChat(AGENT_CHAT_ID);
            }
        }
    }
}

// ★ 登出前保存:确保当前账号的配置和聊天存到服务器
function saveUserDataBeforeLogout() {
    console.log('[logout] 开始保存用户数据');
    // 配置保存(keepalive 确保页面关闭后请求完成)
    var token = localStorage.getItem('authToken');
    if (!token) { console.log('[logout] 无token,跳过'); return; }

    // 直接构建并发送配置(同步读取localStorage,异步发送,keepalive保证送达)
    try {
        var config = {};
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k || k === 'chats' || k === 'lastChatId' || k === 'deviceId' ||
                k === 'ongoingChats' || k === 'authToken' || k === 'authUsername' ||
                k === 'authUserId' || k === 'dark' || k === 'modelContextLength' ||
                k === 'modelMaxOutputTokens' || k === 'autoDetectedTextModels' ||
                k === '_test' || _isTransientRuntimeStorageKey(k)) continue;
            var v = localStorage.getItem(k);
            if (v !== null && v !== undefined) config[k] = v;
        }
        console.log('[logout] 配置项:', Object.keys(config).length);
        // ★ 使用 sendBeacon 确保页面卸载前请求送达(比 fetch 可靠)
        var _saveBlob = new Blob([JSON.stringify(config)], { type: 'application/json' });
        var _saveUrl = SERVER_API_BASE + '/chat.php?action=save_config';
        navigator.sendBeacon(_saveUrl, _saveBlob);
        console.log('[logout] sendBeacon 已发送');
    } catch(e) { console.warn('[logout] 配置保存错误:', e.message); }

    // 聊天保存(使用 sendBeacon,保证页面关闭时请求送达)
    if (typeof chats !== 'undefined' && chats && Object.keys(chats).length > 0) {
        try {
            console.log('[logout] 保存聊天:', Object.keys(chats).length, '个');
            beaconSaveChats();
        } catch(e) { console.warn('[logout] 聊天保存错误:', e.message); }
    }
    console.log('[logout] 保存已触发');
}

const AI_JUDGE_TIMEOUT = 5000;
const MAX_HISTORY_LENGTH = 2000;
const TITLE_MAX_LENGTH = 20;
const MAX_TOKENS_SAFETY_MARGIN = 1000;
const STREAM_DELAY = 2;
