// queue.js — 消息队列 v1.0 (Phase 8 拆分自 main.js)
// 持久化队列(不打断当前生成) / 排队发送 / 折叠UI

// ── 队列状态 ──
window._messageQueue = [];
window._queueIdCounter = 0;
window._isQueueProcessing = false;

/* 持久化 key — 按模式 + 会话隔离 */
window._getQueueKey = function() {
    var _prefix = (getAgentMode() !== 'off') ? 'oc_queue_a_' : 'oc_queue_n_';
    return _prefix + (currentChatId || 'default');
};

/** 持久化队列到 localStorage */
window._saveQueue = function() {
    try {
        var _key = window._getQueueKey();
        if (window._messageQueue.length === 0) {
            localStorage.removeItem(_key);
            return;
        }
        var data = window._messageQueue.map(function(item) {
            var safeFiles = (item.files || []).map(function(f) {
                return { name: f.name, isImage: !!f.isImage, type: f.type, size: f.size };
            });
            return { id: item.id, text: item.text, files: safeFiles, chatId: item.chatId || '' };
        });
        localStorage.setItem(_key, JSON.stringify(data));
    } catch(e) {
        console.warn('[Queue] save failed:', e);
    }
};

/** 页面加载时从 localStorage 恢复队列 */
window._loadQueue = function() {
    try {
        var _key = window._getQueueKey();
        var raw = localStorage.getItem(_key);
        if (!raw) { console.log('[Queue] load: no data for key=' + _key); return false; }
        var data = JSON.parse(raw);
        if (!Array.isArray(data)) return false;
        window._messageQueue = data;
        var maxId = 0;
        data.forEach(function(item) { if (item.id > maxId) maxId = item.id; });
        window._queueIdCounter = maxId;
        return true;
    } catch(e) {
        console.warn('[Queue] load failed:', e);
        return false;
    }
};

/** 清理持久化队列 */
window._clearPersistedQueue = function() {
    try { localStorage.removeItem(window._getQueueKey()); } catch(e) {}
};

/** 推入消息到队列 (不打断当前生成) */
window.pushToMsgQueue = function() {
    var input = $.userInput;
    var text = input ? input.value.trim() : '';
    if (!text && (!pendingFiles || pendingFiles.length === 0)) return;

    var safeFiles = (pendingFiles || []).map(function(f) {
        return { name: f.name, isImage: !!f.isImage, type: f.type, size: f.size };
    });

    var qItem = {
        id: ++window._queueIdCounter,
        text: text,
        files: safeFiles,
        chatId: currentChatId || ''
    };
    window._messageQueue.push(qItem);

    if (input) { input.value = ''; window.autoResize(input); }
    clearAllFiles();
    window._saveQueue();
    window._updateQueueUI();
    showToast('📥 已加入消息队列 (共' + window._messageQueue.length + '条)', 'info', 2000);

    if (!isTypingMap[currentChatId]) {
        window._drainQueue();
    }
};

/** 排干队列 — 逐一发送排队消息 */
window._drainQueue = async function() {
    if (window._isQueueProcessing) return;
    if (window._messageQueue.length === 0) {
        window._isQueueProcessing = false;
        window._clearPersistedQueue();
        window._updateQueueUI();
        return;
    }
    if (isTypingMap[currentChatId]) return;

    window._isQueueProcessing = true;
    var item = window._messageQueue.shift();
    if (window._messageQueue.length === 0) {
        window._clearPersistedQueue();
    } else {
        window._saveQueue();
    }

    if (item.chatId && item.chatId !== currentChatId && chats[item.chatId]) {
        var _prevChatId = currentChatId;
        currentChatId = item.chatId;
        try {
            await window.sendMessage(true, item.text, []);
        } finally {
            currentChatId = _prevChatId;
        }
        window._isQueueMessage = false;
        window._isQueueProcessing = false;
        return;
    }

    var queueFiles = item.files ? item.files.map(function(f) {
        return { name: f.name, content: null, isImage: !!f.isImage, type: f.type, size: f.size };
    }) : [];

    window._isQueueMessage = true;
    try {
        await window.sendMessage(true, item.text, queueFiles);
    } catch(e) {
        console.warn('[Queue] sendMessage error:', e);
    }
    window._isQueueMessage = false;
    window._isQueueProcessing = false;
    window._updateQueueUI();

    setTimeout(function() {
        if (window._messageQueue.length > 0 && !isTypingMap[currentChatId]) {
            window._drainQueue();
        }
    }, 500);
};

/** 处理 document 点击: 点浮窗外则折叠队列 */
window._handleQueueDocClick = function(e) {
    var qBar = getEl('queueBar');
    if (!qBar || qBar.classList.contains('hidden')) return;
    if (qBar.classList.contains('collapsed')) return;
    if (qBar.contains(e.target)) return;
    qBar.classList.add('collapsed');
};

/** 切换折叠/展开 */
window._toggleQueueCollapse = function() {
    var qBar = getEl('queueBar');
    if (qBar) qBar.classList.toggle('collapsed');
};

/** 清空所有队列消息 */
window._clearAllQueue = function() {
    window._messageQueue = [];
    window._clearPersistedQueue();
    window._updateQueueUI();
    showToast('🗑️ 消息队列已清空', 'info', 1500);
};

/** 移除单条队列消息 */
window._removeQueueItem = function(id) {
    window._messageQueue = window._messageQueue.filter(function(item) { return item.id !== id; });
    window._saveQueue();
    window._updateQueueUI();
};

window._updateQueueUI = function() {
    var qBar = getEl('queueBar');
    var qBadge = getEl('queueBarBadge');
    var qList = getEl('queueMsgList');
    var qSummary = getEl('queueCollapsedSummary');
    var qCount = window._messageQueue.length;

    var showBar = qCount > 0;
    if (qBar) qBar.classList.toggle('hidden', !showBar);

    if (qBadge) {
        qBadge.textContent = qCount || '';
        qBadge.classList.toggle('hidden', qCount === 0);
    }

    if (qSummary) {
        if (qCount === 0) {
            qSummary.textContent = '';
        } else if (qCount === 1) {
            var _firstText = (window._messageQueue[0] && window._messageQueue[0].text || '').substring(0, 20);
            qSummary.textContent = '— ' + _firstText + (window._messageQueue[0].text && window._messageQueue[0].text.length > 20 ? '...' : '');
        } else {
            var _first2 = (window._messageQueue[0] && window._messageQueue[0].text || '').substring(0, 15);
            qSummary.textContent = '— ' + _first2 + '... 等' + qCount + '条';
        }
    }

    if (!qList) return;
    if (qCount === 0) { qList.innerHTML = ''; return; }

    var html = '';
    window._messageQueue.forEach(function(item, idx) {
        var text = (item.text || '').substring(0, 80);
        if ((item.text || '').length > 80) text += '...';
        var fileIcon = '';
        if (item.files && item.files.length > 0) {
            fileIcon = '<span class="queue-msg-file">' +
                '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>' +
                item.files.length + '</span>';
        }
        html += '<div class="queue-msg-item" title="' + (item.text || '').replace(/"/g,'&quot;') + '">' +
            '<span class="queue-msg-idx">' + (idx + 1) + '</span>' +
            '<span class="queue-msg-text">' + escapeHtml(text || '(空消息)') + '</span>' +
            fileIcon +
            '<button class="queue-msg-remove" onclick="window._removeQueueItem(' + item.id + ')" title="移除此消息">✕</button>' +
            '</div>';
    });
    qList.innerHTML = html;
};
