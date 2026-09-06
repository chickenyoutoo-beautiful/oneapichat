// queue.js — 消息队列 v1.0 (Phase 8 拆分自 main.js)
// 持久化队列(不打断当前生成) / 排队发送 / 折叠UI

// ── 队列状态 ──
window._messageQueue = [];
window._queueIdCounter = 0;
window._isQueueProcessing = false;

/* 持久化 key — 按模式 + 会话隔离 */
window._getQueueKey = function(explicitMode, explicitChatId) {
    var mode = explicitMode !== undefined ? explicitMode : (typeof getAgentMode === 'function' ? getAgentMode() : (localStorage.getItem('agentMode') || 'off'));
    var _prefix = (mode !== 'off') ? 'oc_queue_a_' : 'oc_queue_n_';
    var cid = explicitChatId !== undefined ? explicitChatId : (window.currentChatId || 'default');
    return _prefix + cid;
};

/** 持久化队列到 localStorage */
window._saveQueue = function(explicitMode, explicitChatId) {
    try {
        var _key = window._getQueueKey(explicitMode, explicitChatId);
        if (!window._messageQueue || window._messageQueue.length === 0) {
            localStorage.removeItem(_key);
            return;
        }
        // 过滤空消息
        var validItems = window._messageQueue.filter(function(item) {
            return item && (item.text || (item.files && item.files.length));
        });
        if (validItems.length === 0) {
            localStorage.removeItem(_key);
            window._messageQueue = [];
            return;
        }
        var data = validItems.map(function(item) {
            var safeFiles = (item.files || []).map(function(f) {
                return { name: f.name, isImage: !!f.isImage, type: f.type, size: f.size };
            });
            return { id: item.id, text: item.text, files: safeFiles, chatId: item.chatId || (explicitChatId || window.currentChatId || '') };
        });
        localStorage.setItem(_key, JSON.stringify(data));
    } catch(e) {
        console.warn('[Queue] save failed:', e);
    }
};

/** 页面加载时从 localStorage 恢复队列 */
window._loadQueue = function(explicitMode, explicitChatId) {
    try {
        var _key = window._getQueueKey(explicitMode, explicitChatId);
        var raw = localStorage.getItem(_key);
        if (!raw) return false;
        var data = JSON.parse(raw);
        if (!Array.isArray(data) || data.length === 0) {
            localStorage.removeItem(_key);
            return false;
        }
        var validData = data.filter(function(item) {
            return item && (item.text || (item.files && item.files.length));
        });
        if (validData.length === 0) {
            localStorage.removeItem(_key);
            return false;
        }
        window._messageQueue = validData;
        var maxId = 0;
        validData.forEach(function(item) { if (item.id > maxId) maxId = item.id; });
        window._queueIdCounter = maxId;
        return true;
    } catch(e) {
        console.warn('[Queue] load failed:', e);
        return false;
    }
};

/** 清理持久化队列 (按特定会话、当前会话或全部清理) */
window._clearPersistedQueue = function(specificChatId, clearAllSessions) {
    try {
        var targetCid = specificChatId || window.currentChatId || 'default';
        localStorage.removeItem('oc_queue_a_' + targetCid);
        localStorage.removeItem('oc_queue_n_' + targetCid);
        localStorage.removeItem(window._getQueueKey());
        if (clearAllSessions) {
            var keysToRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf('oc_queue_') === 0) {
                    keysToRemove.push(k);
                }
            }
            keysToRemove.forEach(function(k) { localStorage.removeItem(k); });
        }
        sessionStorage.removeItem('_messageQueue');
    } catch(e) {}
};

/** 智能发送：如果队列非空，走队列；否则直接发送 */
window._smartSend = function() {
    var input = $.userInput;
    var userText = input ? input.value.trim() : '';

    // ★ 1. 斜杠命令（/clear, /clearsub, /help, /model 等）最高优先级，绝不进队列
    if (userText.startsWith('/')) {
        window.sendMessage();
        return;
    }

    // ★ 2. 图片过多时自动分批入队
    if (pendingFiles && pendingFiles.length > 0) {
        var _imgFiles = pendingFiles.filter(function(f) { return f.isImage || (f.type && f.type.startsWith('image/')); });
        var _provider = (getVal?.('provider') || localStorage.getItem('provider') || '').toLowerCase();
        var _modelStr = (getVal?.('modelSelect') || localStorage.getItem('model') || '').toLowerCase();
        var _isXai = _provider === 'xai' || _modelStr.indexOf('grok') !== -1;
        var _maxImages = _isXai ? 10 : 20;
        if (_imgFiles.length > _maxImages) {
            _splitAndQueueImages(_maxImages);
            return;
        }
    }

    // ★ 3. 如果 AI 正在生成中，推入消息队列
    if (isTypingMap[currentChatId]) {
        window.pushToMsgQueue();
        return;
    }

    // ★ 4. AI 空闲时：如果队列有残留消息，将新消息入队后立即触发排干；如果队列无消息，直接发送
    if (window._messageQueue && window._messageQueue.length > 0) {
        if (userText || (pendingFiles && pendingFiles.length > 0)) {
            window.pushToMsgQueue();
        }
        setTimeout(function() { window._drainQueue(); }, 50);
    } else {
        window.sendMessage();
    }
};

/** ★ 图片分批：将多余图片拆成多个消息, 用内存队列直接发送 (不经过 localStorage, 保留 base64 数据)
 *  策略: 前 N-1 批只让模型识别/记忆图片(不操作), 最后一批才执行用户原始指令
 */
window._splitAndQueueImages = function(maxImages) {
    var input = $.userInput;
    var userText = input ? input.value.trim() : '';
    var allFiles = pendingFiles.slice();
    var imageFiles = allFiles.filter(function(f) { return f.isImage || (f.type && f.type.startsWith('image/')); });
    var nonImageFiles = allFiles.filter(function(f) { return !f.isImage && !(f.type && f.type.startsWith('image/')); });
    var batches = [];
    for (var i = 0; i < imageFiles.length; i += maxImages) {
        batches.push(imageFiles.slice(i, i + maxImages));
    }
    var totalBatches = batches.length;
    // ★ 内存队列: 保留完整文件数据 (含 base64 content), 不经过 localStorage
    if (!window._imageBatchQueue) window._imageBatchQueue = [];
    for (var bi = 0; bi < totalBatches; bi++) {
        var batchFiles = batches[bi];
        var batchText;
        var isLast = (bi === totalBatches - 1);
        var isFirst = (bi === 0);
        if (totalBatches === 1) {
            batchText = userText;
            batchFiles = batchFiles.concat(nonImageFiles);
        } else if (isFirst) {
            batchText = '[图片分批识别] 这是第 1/' + totalBatches + ' 批图片（共 ' + imageFiles.length + ' 张）。' +
                '请识别并记忆这些图片的内容，但不要开始任何操作。后续还有更多图片，全部发送完毕后会给你具体指令。' +
                (userText ? '\n\n用户最终指令（请先记住，不要执行）: ' + userText : '');
            batchFiles = batchFiles.concat(nonImageFiles);
        } else if (isLast) {
            batchText = '[图片分批识别] 这是最后一批（第 ' + (bi + 1) + '/' + totalBatches + ' 张）。' +
                '所有 ' + imageFiles.length + ' 张图片已发送完毕。\n\n请根据之前识别的所有图片内容，执行用户指令: ' + userText;
        } else {
            batchText = '[图片分批识别] 这是第 ' + (bi + 1) + '/' + totalBatches + ' 批图片。' +
                '请继续识别并记忆，不要开始操作。还有后续图片。';
        }
        window._imageBatchQueue.push({
            text: batchText,
            files: batchFiles,  // ★ 完整文件对象, 含 content/serverUrl
            chatId: currentChatId || '',
            _batchInfo: { batch: bi + 1, total: totalBatches, isLast: isLast, isFirst: isFirst }
        });
    }
    if (input) { input.value = ''; window.autoResize(input); }
    clearAllFiles();
    showToast('📸 已自动分为 ' + totalBatches + ' 批发送（每批最多 ' + maxImages + ' 张），模型先识别后操作', 'info', 5000);
    if (!isTypingMap[currentChatId]) {
        setTimeout(function() { window._drainImageBatchQueue(); }, 300);
    }
};

/** ★ 排干图片批队列: 逐一发送, 每批等前一批完成后再发下一批 */
window._drainImageBatchQueue = async function() {
    if (!window._imageBatchQueue || window._imageBatchQueue.length === 0) return;
    if (isTypingMap[currentChatId]) {
        setTimeout(function() { window._drainImageBatchQueue(); }, 1000);
        return;
    }
    var item = window._imageBatchQueue.shift();
    var _prevQueueMessage = window._isQueueMessage;
    window._isQueueMessage = true;
    try {
        await window.sendMessage(true, item.text, item.files);
    } catch(e) {
        console.warn('[ImageBatch] sendMessage error:', e);
    }
    window._isQueueMessage = _prevQueueMessage;
    if (window._imageBatchQueue.length > 0) {
        setTimeout(function() { window._drainImageBatchQueue(); }, 500);
    }
};

/** 推入消息到队列 (不打断当前生成) — 保留原队列行为供 smartSend 使用 */
/** 立即将某条队列中的消息发送或插话 (Steer / Send) */
window._sendQueueItemNow = async function(id) {
    var idx = window._messageQueue.findIndex(function(item) { return item.id === id; });
    if (idx === -1) return;
    var item = window._messageQueue.splice(idx, 1)[0];
    window._saveQueue();
    window._updateQueueUI();
    if (item && (item.text || (item.files && item.files.length))) {
        if (isTypingMap[currentChatId]) {
            // AI 正在生成中: 立即作为插话推入对话
            var safeFiles = (item.files || []).map(function(f) {
                return { name: f.name, content: f.content, serverUrl: f.serverUrl || '', serverPath: f.serverPath || '', size: f.size, type: f.type || (f.isImage ? 'image/' : '') };
            });
            var userMsg = {
                role: 'user',
                text: item.text,
                _injected: true,
                files: safeFiles
            };
            if (chats[currentChatId]) {
                chats[currentChatId].messages.push(userMsg);
                appendMessage('user', item.text, userMsg.files, null, null, null, false, null, null, false, -1, true);
                slimSaveChats();
                window._hasInjectedMessage = true;
                showToast('⚡ 已插话推入对话，模型将在当前回复后继续处理', 'info', 2500);
            }
        } else {
            // AI 空闲: 直接发送
            await window.sendMessage(true, item.text, item.files || []);
        }
    }
};

/** 队列主按钮智能分发 */
window.handleQueueButtonAction = function() {
    var input = $.userInput;
    var hasInput = input && input.value.trim().length > 0;
    if (hasInput) {
        window.pushToMsgQueue();
    } else if (window._messageQueue.length > 0) {
        window._sendQueueItemNow(window._messageQueue[0].id);
    }
};

/** 推入消息到队列 (不打断当前生成) */
window.pushToMsgQueue = function() {
    var input = $.userInput;
    var text = input ? input.value.trim() : '';
    if (!text && (!pendingFiles || pendingFiles.length === 0)) {
        showToast('请输入消息或附加文件后再推入队列', 'info', 1500);
        return;
    }

    var safeFiles = (pendingFiles || []).map(function(f) {
        return { name: f.name, isImage: !!f.isImage, type: f.type, size: f.size, content: f.content, serverUrl: f.serverUrl || '', serverPath: f.serverPath || '' };
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
    showToast('📬 消息已加入待发送队列 (' + window._messageQueue.length + ')', 'info', 2000);

    if (!isTypingMap[currentChatId]) {
        setTimeout(function() { window._drainQueue(); }, 300);
    }
};

/**
 * 推入对话 (按钮点击, Claude Code 风格)
 * - AI 空闲: 直接发送
 * - AI 生成中: 消息立即注入对话历史并渲染为可见气泡 (带推入标记),
 *   不打断当前流, 流结束后自动触发新一轮 (模型会看到新消息)
 *   ★ 注意: 按钮点击 = 用户明确要立即推入, 不进队列堆栈
 */
window.injectUserMessage = function() {
    var input = $.userInput;
    var text = input ? input.value.trim() : '';
    if (!text && (!pendingFiles || pendingFiles.length === 0)) return;

    var safeFiles = (pendingFiles || []).map(function(f) {
        return { name: f.name, isImage: !!f.isImage, type: f.type, size: f.size };
    });

    // ★ AI 空闲: 直接发送 (与普通发送一致)
    if (!isTypingMap[currentChatId]) {
        if (input) { input.value = ''; window.autoResize(input); }
        clearAllFiles();
        window.sendMessage(true, text, safeFiles);
        return;
    }

    // ★ AI 生成中: 注入对话历史 (立即可见, 不进队列堆栈)
    var chatId = currentChatId;
    var _now = new Date();
    var _daysZh = ['周日','周一','周二','周三','周四','周五','周六'];
    var _dateStr = _now.getFullYear() + '年' + (_now.getMonth()+1) + '月' + _now.getDate() + '日 ' + _daysZh[_now.getDay()];
    var _datePrefix = '[日期: ' + _dateStr + '] ';

    var userMsg = {
        role: 'user',
        text: text,
        _datePrefix: _datePrefix,
        _injected: true,  // ★ 标记为推入消息 (渲染时显示标记, 流结束后自动触发新一轮)
        files: safeFiles.map(function(f) {
            return { name: f.name, content: f.content, serverUrl: f.serverUrl || '', serverPath: f.serverPath || '', size: f.size, type: f.type || (f.isImage ? 'image/' : '') };
        })
    };
    chats[chatId].messages.push(userMsg);

    // ★ 立即渲染用户气泡 (不重新渲染整个聊天, 避免干扰流式输出)
    if (currentChatId === chatId) {
        appendMessage('user', text, userMsg.files, null, null, null, false, null, null, false, -1, true);
        setTimeout(function() { autoScrollToBottom('inject'); }, 30);
    }

    slimSaveChats();
    if (typeof window._broadcastChatUpdate === 'function') {
        window._broadcastChatUpdate(chatId);
    }

    // 清空输入
    if (input) { input.value = ''; window.autoResize(input); }
    clearAllFiles();

    // ★ 标记有推入消息等待处理 (流结束后 finally 块会检测并自动触发新一轮)
    window._hasInjectedMessage = true;

    showToast('📨 已推入对话，模型将在当前回复后继续处理', 'info', 2500);
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
    // ★ 并行对话: 仅当当前会话正在生成时才等待(不阻塞其他会话)
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

    // ★ 分批图片队列: 保留完整文件数据 (content/serverUrl)
    var queueFiles;
    if (item._batchInfo) {
        queueFiles = item.files || [];
    } else {
        queueFiles = item.files ? item.files.map(function(f) {
            return { name: f.name, content: null, isImage: !!f.isImage, type: f.type, size: f.size };
        }) : [];
    }

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
    window._isQueueProcessing = false;
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
        var isGenerating = !!(isTypingMap[currentChatId]);
        var actionBtnLabel = isGenerating
            ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:inline;vertical-align:-1px;margin-right:2px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>插话'
            : '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="display:inline;vertical-align:-1px;margin-right:2px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>发送';
        var actionBtnTitle = isGenerating ? '立即插话到当前生成中' : '立即发送此消息';
        html += '<div class="queue-msg-item" title="' + (item.text || '').replace(/"/g,'&quot;') + '">' +
            '<span class="queue-msg-idx">' + (idx + 1) + '</span>' +
            '<span class="queue-msg-text">' + escapeHtml(text || '(空消息)') + '</span>' +
            fileIcon +
            '<div class="queue-msg-item-actions">' +
                '<button class="queue-msg-send-btn" onclick="window._sendQueueItemNow(' + item.id + ')" title="' + actionBtnTitle + '">' + actionBtnLabel + '</button>' +
                '<button class="queue-msg-remove" onclick="window._removeQueueItem(' + item.id + ')" title="移除此消息">✕</button>' +
            '</div>' +
            '</div>';
    });
    qList.innerHTML = html;
};
