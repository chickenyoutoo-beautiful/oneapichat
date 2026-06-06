// rendering.js — 消息/工具渲染 v1.0 (Phase 6)
// appendMessage / showWelcome / 工具调用卡片 / 状态行

// ==== 消息渲染 ====
// ==================== 消息渲染 ====================
function showWelcome() {
let container = $.chatMessagesContainer;
    if (!container) return;
    var letters = 'Hi, Nice to meet you!'.split('');
    var html = '<div class="welcome-container"><div class="brand">';
    for (var i = 0; i < letters.length; i++) {
        var cls = (letters[i] === ',' || letters[i] === '!') ? 'wl-dot' : 'wl';
        html += '<span class="' + cls + '" style="--d:' + (i * 0.06) + 's">' + letters[i] + '</span>';
    }
    html += '</div><p class="text-sm">开始新的对话 · NAUJTRATS</p></div>';
    container.innerHTML = html;
}

function copyMessageContent(content) {
    navigator.clipboard.writeText(compressNewlines(content, 2));
}

// ★ 流式响应完成后重新生成最后一条回复
window.regenLastAssistant = async function(text) {
    if (!currentChatId || !chats[currentChatId]) return;
    var msgs = chats[currentChatId].messages;
    var idx = -1;
    for (var ri = msgs.length - 1; ri >= 0; ri--) {
        if (msgs[ri].role === 'assistant') { idx = ri; break; }
    }
    if (idx === -1) return;
    var sys = msgs.filter(function(m) { return m.role === 'system' && !m.temporary && !m.timestamp; });
    var timestamp = null;
    for (var ti = 0; ti < msgs.length; ti++) {
        if (msgs[ti].timestamp) { timestamp = msgs[ti]; break; }
    }
    var others = msgs.slice(0, idx).filter(function(m) { return m.role !== 'system' || m.temporary || m.timestamp; });
    chats[currentChatId].messages = sys.concat(others).concat(timestamp ? [timestamp] : []);
    saveChatsDebounced();
    loadChat(currentChatId);
    var lastUser = null;
    for (var ui = idx - 1; ui >= 0; ui--) {
        if (msgs[ui].role === 'user') { lastUser = msgs[ui]; break; }
    }
    if (lastUser) await sendMessage(true, lastUser.text, lastUser.files);
};


function autoLinkURLs(markdownText) {
    // ★ 统一将所有裸 URL 转为可点击的 markdown 链接,不再区分图片
    return markdownText.replace(/(^|\s)(https?:\/\/[^\s<>]+)($|\s)/g, (match, before, url, after) => {
        if (/!\[.*?\]\(/.test(match) || /\[.*?\]\(/.test(match)) return match;
        try {
            var u = new URL(url);
            let label = u.hostname;
            if (u.pathname && u.pathname !== '/') {
                label += u.pathname.slice(0, 20) + (u.pathname.length > 20 ? '...' : '');
            }
            return before + `[${label}](${url})` + after;
        } catch {
            return match;
        }
    });
}

function showImageLightbox(images, startIdx) {
    // 移除已有灯箱
    var existing = document.querySelector('.img-lightbox');
    if (existing) existing.remove();

    var idx = startIdx || 0;
    var overlay = document.createElement('div');
    overlay.className = 'img-lightbox';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;';

    var img = document.createElement('img');
    img.style.cssText = 'max-width:90vw;max-height:80vh;object-fit:contain;border-radius:4px;cursor:grab;transition:transform 0.15s ease;';

    var counter = document.createElement('div');
    counter.style.cssText = 'color:#fff;margin-bottom:12px;font-size:14px;';

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:12px;margin-top:12px;';

    // ════ 缩放状态 ════
    var scale = 1;
    var minScale = 1;
    var maxScale = 5;
    // 拖拽平移状态
    var isDragging = false;
    var dragStartX = 0, dragStartY = 0;
    var offsetX = 0, offsetY = 0;

    function applyTransform() {
        img.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
        if (scale > 1) {
            img.style.cursor = 'grabbing';
            img.style.maxWidth = 'none';
            img.style.maxHeight = 'none';
            img.style.width = 'auto';
            img.style.height = 'auto';
        } else {
            img.style.cursor = 'grab';
            img.style.maxWidth = '90vw';
            img.style.maxHeight = '80vh';
        }
    }

    function updateView() {
        scale = 1;
        offsetX = 0;
        offsetY = 0;
        img.src = cleanImageUrl(images[idx]);
        counter.textContent = (idx + 1) + ' / ' + images.length;
        applyTransform();
    }

    // ════ 鼠标滚轮缩放 ════
    img.addEventListener('wheel', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var delta = e.deltaY > 0 ? -0.1 : 0.1;
        var newScale = Math.max(minScale, Math.min(maxScale, scale + delta));
        newScale = Math.round(newScale * 10) / 10;
        scale = newScale;
        applyTransform();
    }, { passive: false });

    // ════ 拖拽平移 ════
    img.addEventListener('mousedown', function(e) {
        if (scale <= 1) return;
        e.preventDefault();
        isDragging = true;
        dragStartX = e.clientX - offsetX;
        dragStartY = e.clientY - offsetY;
        img.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        offsetX = e.clientX - dragStartX;
        offsetY = e.clientY - dragStartY;
        applyTransform();
    });
    document.addEventListener('mouseup', function() {
        isDragging = false;
        if (scale > 1) img.style.cursor = 'grabbing';
    });

    // 左右切换
    if (images.length > 1) {
        var prev = document.createElement('button');
        prev.textContent = '\u25c0';
        prev.style.cssText = 'position:absolute;left:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer;z-index:10000;';
        prev.addEventListener('click', function(e) { e.stopPropagation(); idx = (idx - 1 + images.length) % images.length; updateView(); });
        overlay.appendChild(prev);

        var next = document.createElement('button');
        next.textContent = '\u25b6';
        next.style.cssText = 'position:absolute;right:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer;z-index:10000;';
        next.addEventListener('click', function(e) { e.stopPropagation(); idx = (idx + 1) % images.length; updateView(); });
        overlay.appendChild(next);
    }

    // ════ 缩放按钮 ════
    var zoomInBtn = document.createElement('button');
    zoomInBtn.innerHTML = '+'; zoomInBtn.title = '放大';
    zoomInBtn.style.cssText = 'background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:4px 12px;font-size:16px;font-weight:bold;cursor:pointer;line-height:1;';
    zoomInBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        scale = Math.min(maxScale, Math.round((scale + 0.2) * 10) / 10);
        applyTransform();
    });
    actions.appendChild(zoomInBtn);

    var zoomOutBtn = document.createElement('button');
    zoomOutBtn.innerHTML = '\u2212'; zoomOutBtn.title = '缩小';
    zoomOutBtn.style.cssText = 'background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:4px 12px;font-size:16px;font-weight:bold;cursor:pointer;line-height:1;';
    zoomOutBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        scale = Math.max(minScale, Math.round((scale - 0.2) * 10) / 10);
        applyTransform();
    });
    actions.appendChild(zoomOutBtn);

    var resetBtn = document.createElement('button');
    resetBtn.textContent = '1:1'; resetBtn.title = '重置缩放';
    resetBtn.style.cssText = 'background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;';
    resetBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        scale = 1; offsetX = 0; offsetY = 0;
        applyTransform();
    });
    actions.appendChild(resetBtn);

    // 下载按钮
    var download = document.createElement('a');
    download.textContent = '\u2b07 \u4e0b\u8f7d';
    download.style.cssText = 'background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:6px 16px;font-size:13px;cursor:pointer;text-decoration:none;';
    download.addEventListener('click', function(e) {
        e.stopPropagation();
        var a = document.createElement('a');
        a.href = images[idx];
        a.download = 'image_' + (idx + 1) + '.png';
        a.click();
    });
    actions.appendChild(download);

    // 关闭
    var close = document.createElement('button');
    close.textContent = '\u2715';
    close.style.cssText = 'position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:36px;height:36px;font-size:18px;cursor:pointer;z-index:10000;';
    close.addEventListener('click', function() { overlay.remove(); });
    overlay.appendChild(close);

    overlay.appendChild(counter);
    overlay.appendChild(img);
    overlay.appendChild(actions);

    // 点击背景关闭
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.remove();
    });

    // 键盘导航
    function keyHandler(e) {
        if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); }
        if (images.length > 1 && e.key === 'ArrowLeft') { idx = (idx - 1 + images.length) % images.length; updateView(); }
        if (images.length > 1 && e.key === 'ArrowRight') { idx = (idx + 1) % images.length; updateView(); }
        if (e.key === '+' || e.key === '=') { scale = Math.min(maxScale, Math.round((scale + 0.2) * 10) / 10); applyTransform(); }
        if (e.key === '-') { scale = Math.max(minScale, Math.round((scale - 0.2) * 10) / 10); applyTransform(); }
        if (e.key === '0') { scale = 1; offsetX = 0; offsetY = 0; applyTransform(); }
    }
    document.addEventListener('keydown', keyHandler);

    updateView();
    document.body.appendChild(overlay);
}


// ==== 工具调用渲染 ====
// ==================== 工具调用渲染 (Feature 3) ====================
/**
 * 创建可折叠的工具调用卡片
 * @param {string} toolName - 工具名称
 * @param {object} args - 调用参数
 * @param {object} result - 调用结果
 * @param {number} durationMs - 执行耗时(毫秒)
 * @returns {HTMLElement}
 */
function createToolCallCard(toolName, args, result, durationMs, execDetails) {
    var card = document.createElement('div');
    card.className = 'tool-call-card';

    var meta = (window.toolRegistry && toolRegistry.has(toolName)) ? toolRegistry.get(toolName) : null;
    var capHint = meta ? meta.capabilities.slice(0, 2).join(', ') : '';
    var toolHint = meta ? meta.searchHint : '';

    var typeIcons = {
        'web_search': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8a3 3 0 0 0-3 3"/></svg>',
        'web_fetch': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
        'server_exec': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
        'delegate_task': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
    };
    var iconHtml = typeIcons[toolName] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/></svg>';

    var summary = (meta && meta.getSummary) ? meta.getSummary(args) : (toolName + ': ' + JSON.stringify(args).substring(0, 60));

    var resultText = '';
    if (result) {
        if (typeof result === 'string') resultText = result;
        else if (result.result) resultText = result.result;
        else if (result.error) resultText = result.error;
        else if (result.output) resultText = result.output;
        else resultText = JSON.stringify(result).substring(0, 300);
    }

    var durationStr = '';
    if (durationMs !== undefined && durationMs !== null) {
        if (durationMs < 1000) durationStr = durationMs + 'ms';
        else if (durationMs < 60000) durationStr = (durationMs / 1000).toFixed(1) + 's';
        else durationStr = Math.floor(durationMs / 60000) + 'm ' + Math.floor((durationMs % 60000) / 1000) + 's';
    }

    var isError = result && result.error;
    var statusColor = isError ? '#ef4444' : (durationStr ? '#059669' : '#6366f1');
    var statusText = isError ? '失败' : '成功';

    var html = '<details class="tool-call-details">' +
        '<summary class="tool-call-summary" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 0;">' +
            '<span class="tool-call-icon" style="color:' + statusColor + ';flex-shrink:0;">' + iconHtml + '</span>' +
            '<span class="tool-call-name" style="font-weight:600;font-size:12px;">' + escapeHtml(toolName) + '</span>' +
            '<span style="font-size:11px;color:#9ca3af;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(summary) + '</span>' +
            (durationStr ? '<span style="font-size:10px;color:#6b7280;flex-shrink:0;">' + durationStr + '</span>' : '') +
            '<span style="font-size:10px;color:' + statusColor + ';flex-shrink:0;font-weight:500;">' + statusText + '</span>' +
            '<span class="tool-call-chevron" style="margin-left:4px;color:#9ca3af;flex-shrink:0;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></span>' +
        '</summary>' +
        '<div class="tool-call-body" style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:8px;font-size:11px;">';

    if (execDetails && execDetails.command) {
        html += '<details class="tool-exec-details" open>' +
            '<summary class="tool-exec-summary" style="cursor:pointer;font-weight:500;color:#374151;margin-bottom:4px;">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" style="vertical-align:middle;">' +
                '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg> ' + escapeHtml(execDetails.command) +
            '</summary>' +
            '<pre class="tool-exec-output" style="margin:4px 0 0 16px;padding:6px 8px;background:#1e1e2e;color:#cdd6f4;border-radius:6px;font-family:monospace;font-size:10px;line-height:1.5;max-height:200px;overflow-y:auto;">' +
            escapeHtml((execDetails.output || execDetails.error || '').substring(0, 5000)) + '</pre>' +
            (execDetails.exitCode !== undefined ? '<div style="margin:4px 0 0 16px;font-size:10px;color:' + (execDetails.exitCode === 0 ? '#059669' : '#ef4444') + ';">退出码: ' + execDetails.exitCode + '</div>' : '') +
            '</details>';
    }

    html += '<details class="tool-args-details" style="margin-top:4px;">' +
        '<summary class="tool-args-summary" style="cursor:pointer;font-size:10px;color:#9ca3af;">参数</summary>' +
        '<pre class="tool-call-args" style="margin:4px 0 0 16px;padding:6px;background:#f3f4f6;border-radius:4px;font-size:10px;max-height:120px;overflow:auto;">' + escapeHtml(JSON.stringify(args, null, 2).substring(0, 2000)) + '</pre>' +
        '</details>';

    if (resultText) {
        var displayResult = resultText.length > 500 ? resultText.substring(0, 500) : resultText;
        var isLongResult = resultText.length > 500;
        html += '<details class="tool-result-details" style="margin-top:4px;" ' + (isError ? 'open' : '') + '>' +
            '<summary class="tool-result-summary" style="cursor:pointer;font-size:10px;color:' + (isError ? '#ef4444' : '#059669') + ';">' + (isError ? '错误' : '结果') + (isLongResult ? ' (' + resultText.length + ' 字符)' : '') + '</summary>' +
            '<pre class="tool-call-result" style="margin:4px 0 0 16px;padding:6px;background:' + (isError ? '#fef2f2' : '#f0fdf4') + ';border-radius:4px;font-size:10px;max-height:200px;overflow:auto;white-space:pre-wrap;color:' + (isError ? '#dc2626' : '#374151') + ';">' + escapeHtml(displayResult) + '</pre>' +
            (isLongResult ? '<button onclick="this.previousElementSibling.textContent=' + JSON.stringify(escapeHtml(resultText.substring(0, 10000))) + ';this.remove()" style="margin:4px 0 0 16px;font-size:10px;color:#6366f1;border:none;background:none;cursor:pointer;">展开全部</button>' : '') +
            '</details>';
    }

    html += '</div></details>';
    card.innerHTML = html;
    return card;
}
function appendToolCallMessage(toolName, args, result, durationMs, chatId) {
    var card = createToolCallCard(toolName, args, result, durationMs);
    var container = $.chatMessagesContainer;
    if (!container) return;

    var row = document.createElement('div');
    row.className = 'message-row assistant tool-call-row';

    var avatar = document.createElement('div');
    avatar.className = 'avatar assistant';
    avatar.textContent = 'N';

    var wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';

    var bubble = document.createElement('div');
    bubble.className = 'bubble assistant tool-call-bubble';
    bubble.appendChild(card);

    wrapper.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(wrapper);
    container.appendChild(row);

    // 自动滚动
    if (isAutoScrolling) scrollToBottom();

    return row;
}

// ★ 渲染 web_fetch 访问的链接列表 - 放在气泡底部
function _renderWebFetchUrls(bubble, urls) {
    if (!bubble || !urls || !urls.length) return;
    if (bubble.querySelector('.webfetch-urls-container')) return;

    var container = document.createElement('div');
    container.className = 'webfetch-urls-container';
    container.style.cssText = 'margin-top:8px;border-top:1px solid #e5e7eb;padding-top:6px;';

    var summary = document.createElement('summary');
    summary.style.cssText = 'cursor:pointer;font-size:11px;color:#6b7280;user-select:none;';
    summary.textContent = '🌐 已抓取网页 (' + urls.length + ')';

    var details = document.createElement('details');
    details.style.cssText = 'font-size:11px;';
    details.appendChild(summary);

    var list = document.createElement('ol');
    list.style.cssText = 'margin:4px 0 0 0;padding-left:18px;list-style-position:outside;';

    urls.forEach(function(u, i) {
        var li = document.createElement('li');
        li.style.cssText = 'margin-bottom:2px;line-height:1.3;';
        var link = document.createElement('a');
        link.href = u;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.cssText = 'color:#3b82f6;text-decoration:none;font-size:11px;word-break:break-all;';
        link.textContent = u;
        li.appendChild(link);
        list.appendChild(li);
    });

    details.appendChild(list);
    container.appendChild(details);
    bubble.appendChild(container);
}

function appendMessage(role, text, files = null, reasoning = null, usage = null, time = 0, isLast = false, generatedImage = null, generatedImages = null, partial = false) {
// ★ 防御性清理:确保参数都是字符串且不含 [object Object]
    var safeStr = (val) => {
        if (val === null || val === undefined) return '';
        if (typeof val !== 'string') val = String(val);
        return val.replace(/\[object Object\]/gi, '');
    };
    text = safeStr(text);
    reasoning = typeof reasoning === 'string' ? reasoning.replace(/\[object Object\]/gi, '') : '';
    // ★ 如果已有独立显示的生成图片,去除回复文本中对应的图片链接(避免重复和点击跳转报错)
    var _urls = (generatedImages || []).concat(generatedImage ? [generatedImage] : []).filter(Boolean);
    if (_urls.length > 0 && text) {
        _urls.forEach(function(u) {
            if (!u) return;
            text = text.split(u).join('');
        });
    }

    var container = $.chatMessagesContainer;
    if (!container) return null;

    // ★ 欢迎页淡出过渡
    if (container.children.length === 1 && container.children[0].classList.contains('welcome-container')) {
        var welcome = container.children[0];
        welcome.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        welcome.style.opacity = '0';
        welcome.style.transform = 'scale(0.95)';
        setTimeout(function() { welcome.remove(); }, 300);
    }

    var row = document.createElement('div');
    row.className = `message-row ${role}`;

    var avatar = document.createElement('div');
    avatar.className = `avatar ${role}`;
    avatar.textContent = role === 'user' ? '我' : 'N';

    var wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';

    var bubble = document.createElement('div');
    bubble.className = `bubble ${role}`;

    // 思考过程 (Feature 3: 可折叠推理过程)
    if (role === 'assistant' && reasoning) {
        var details = document.createElement('details');
        details.className = 'reasoning-details';
        // 默认折叠,如果推理内容较短(<200字)则展开
        var reasoningLen = (reasoning || '').length;
        details.open = reasoningLen < 200;
        var summaryText = '🤔 推理过程' + (reasoningLen >= 200 ? ' (' + reasoningLen + '字符)' : '');
        details.innerHTML = `<summary>${summaryText}</summary><div class="reasoning-content">${compressNewlines(reasoning, 2)}</div>`;
        bubble.appendChild(details);
    }

    // 用户文件
    if (role === 'user' && files?.length) {
        var fileList = document.createElement('div');
        fileList.className = 'file-list';
        files.forEach(f => {
            if (f.isVideo || (f.type && f.type.startsWith('video/')))  {
                var _vsrc = f.serverUrl || f.content || '';
                if (_vsrc && _vsrc.startsWith('/')) _vsrc = window.location.origin + _vsrc;
                if (_vsrc) {
                    var vid = document.createElement('video');
                    vid.controls = true;
                    vid.preload = 'metadata';
                    vid.style.cssText = 'max-width:100%;max-height:300px;border-radius:8px;margin-top:4px';
                    var src = document.createElement('source');
                    src.src = _vsrc;
                    src.type = f.type || 'video/mp4';
                    vid.appendChild(src);
                    fileList.appendChild(vid);
                }
            } else if (f.isImage || f.type?.startsWith('image/')) {
                var _isrc = f.serverUrl || f.content || '';
                if (_isrc && _isrc.startsWith('/')) _isrc = window.location.origin + _isrc;
                var img = document.createElement('img');
                img.className = 'file-image-preview';
                img.src = _isrc;
                img.alt = f.name;
                img.title = f.name;
                img.loading = 'lazy';
                // 点击放大
                img.style.cursor = 'pointer';
                img.onclick = () => {
                    var modal = document.createElement('div');
                    modal.className = 'image-modal';
                    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:1000;display:flex;align-items:center;justify-content:center;';
                    var modalImg = document.createElement('img');
                    modalImg.src = f.content;
                    modalImg.style.maxWidth = '90%';
                    modalImg.style.maxHeight = '90%';
                    modalImg.style.objectFit = 'contain';
                    modal.appendChild(modalImg);
                    modal.onclick = (e) => {
                        if (e.target === modal) modal.remove();
                    };
                    document.body.appendChild(modal);
                };
                fileList.appendChild(img);
            } else {
                // 非图片文件:显示下载链接
                var url = URL.createObjectURL(new Blob([f.content], { type: 'text/plain' }));
                var fileItem = document.createElement('span');
                fileItem.className = 'file-item';
                fileItem.innerHTML = `<svg class="file-icon" viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M2 1.5C2 0.67 2.67 0 3.5 0h5.88c.4 0 .78.16 1.06.44l3.12 3.12c.28.28.44.66.44 1.06V14.5c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5v-13zM3.5 1c-.28 0-.5.22-.5.5v13c0 .28.22.5.5.5h9c.28 0 .5-.22.5-.5V4.62L10.38 1H3.5z"/><path d="M9 1v3.5c0 .28.22.5.5.5H13v1H9.5C8.67 6 8 5.33 8 4.5V1h1z"/></svg><a href="${url}" download="${escapeHtml(f.name)}">${escapeHtml(f.name)}</a>`;
                fileList.appendChild(fileItem);
            }
        });
        bubble.appendChild(fileList);
    }

    // 主要内容
    var contentDiv = document.createElement('div');
    contentDiv.className = 'markdown-body';

    if (role === 'user') {
        contentDiv.innerHTML = escapeHtml((typeof text === 'string' ? text.replace(/\[object Object\]/g, '') : '') || '').replace(/\n/g, '<br>');
    } else {
        var display = compressNewlines(typeof text === 'string' ? text.replace(/\[object Object\]/g, '') : '', 2);
        // 将 Markdown 图片语法 ![]() 转为可点击链接(避免加载失效图片)
        display = display.replace(/!\[(.*?)\]\((.*?)\)/g, '[图片 $1]($2)');
        if (window.marked) {
            display = autoLinkURLs(display);
            // ★ 使用保护渲染: _protectMath → marked → _restoreMath (含 KaTeX)
            contentDiv.innerHTML = _renderMarkdownWithMath(display);
            // ★ 延迟Mermaid渲染(appendMessage自身有内联处理,不与_triggerPostRender冲突)
            setTimeout(() => {
                // 查找所有 language-mermaid 的代码块(来自 ```mermaid)
                var mermaidCodes = contentDiv.querySelectorAll('pre code[class*="mermaid"]');
                mermaidCodes.forEach(codeBlock => {
                    var pre = codeBlock.parentNode;
                    var mermaidDiv = document.createElement('div');
                    mermaidDiv.className = 'mermaid';
                    // 修复中文引号(常见导致 Mermaid 语法错误的原因)
                    var code = codeBlock.textContent;
                    // 0. Auto-convert "line" diagram type to "xychart-beta"
                    if (/^line\b/.test(code.trim())) {
                        code = 'xychart-beta' + code.trim().slice(4);
                    }
                    // 1. Fix Chinese quotes
                    code = code.replace(/[""]/g, '"');
                    // 2. Fix xychart-beta y-axis label issue
                    code = code.replace(/y-axis\s+([\d.]+)\s*-->\s*([\d.]+)\s+"[^"]*"/g, 'y-axis $1 --> $2');
                    // 3. Normalize line data (comma separated)
                    if (code.includes('xychart-beta')) {
                        code = code.replace(/line\s+"([^"]+)"\s+([\d.\s,]+)/g, (m, label, nums) => {
                            var formatted = nums.trim().split(/\s+/).join(', ');
                            return `line "${label}" ${formatted}`;
                        });
                    }
                    mermaidDiv.textContent = code;
                    mermaidDiv.setAttribute('data-original-code', code);
                    pre.parentNode.replaceChild(mermaidDiv, pre);
                });
                var _toRender = contentDiv.querySelectorAll('.mermaid');
                // ★ 过滤已渲染的(.mermaid 内已有 svg 的跳过)
                _toRender = Array.from(_toRender).filter(function(d) { return !d.querySelector('svg'); });
                if (window.mermaid && _toRender.length > 0) {
                    requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                    // 检查容器是否仍在DOM中
                    if (!contentDiv.isConnected || !contentDiv.parentElement) return;
                    mermaid.run({
                        nodes: _toRender,
                        suppressErrors: true
                    }).then(() => {
                        // 渲染成功后检查:是否产生了有效的SVG而非CSS文本
                        contentDiv.querySelectorAll('.mermaid').forEach(div => {
                            if (!div.isConnected) return;
                            var hasSVG = div.querySelector('svg');
                            var hasBadOutput = div.textContent.includes('#mermaid') && div.textContent.includes('font-family');
                            if (hasBadOutput && !hasSVG) {
                                // Mermaid输出了CSS而非SVG,说明渲染失败
                                var originalCode = div.getAttribute('data-original-code') || div.textContent;
                                div.style.cssText = 'padding:12px;border-radius:8px;background:#fef3c7;border:1px solid #f59e0b;margin:8px 0;color:#92400e;font-size:0.85rem;overflow-x:auto;';
                                div.innerHTML = `<strong>⚠️ 图表渲染失败(Mermaid 可能不支持此语法):</strong><br>
                                    <pre style="white-space:pre-wrap;word-break:break-all;background:#fff3cd;padding:8px;border-radius:4px;margin:8px 0;font-size:0.8rem;">${escapeHtml(originalCode.slice(0, 500))}</pre>
                                    <span style="font-size:0.8rem">提示:Mermaid line/gantt 等图表可能需要不同语法,请尝试使用其他图表类型</span>`;
                            }
                        });
                    }).catch(err => {
                        console.warn('Mermaid 渲染失败', err);
                        contentDiv.querySelectorAll('.mermaid').forEach(div => {
                            if (!div.isConnected) return;
                            var originalCode = div.getAttribute('data-original-code') || div.textContent;
                            // 检查是否是 UnsupportedDiagramError / UnknownDiagramError
                            var isUnsupported = err && (err.message?.includes('No diagram type detected') || err.message?.includes('UnsupportedDiagramError'));

                            if (isUnsupported) {
                                // 对于不支持的图表类型,静默降级为代码块,不显示错误提示
                                var pre = document.createElement('pre');
                                pre.className = 'mermaid-code';
                                pre.style.cssText = 'background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:8px;overflow-x:auto;font-size:0.85rem;';
                                pre.textContent = originalCode;
                                div.parentNode.replaceChild(pre, div);
                            } else {
                                // 其他错误显示简洁提示
                                div.style.cssText = 'padding:10px;border-radius:8px;background:#fef3c7;border:1px solid #f59e0b;margin:8px 0;color:#92400e;font-size:0.85rem;';
                                div.innerHTML = `<strong>⚠️ 图表渲染失败</strong><br>
                                    <pre style="white-space:pre-wrap;word-break:break-all;background:#fff3cd;padding:6px;border-radius:4px;margin:6px 0;font-size:0.8rem;">${escapeHtml(originalCode.slice(0, 300))}</pre>`;
                            }
                        });
                    });
                    });
                    });
                }
                // 原有功能:代码复制和高亮
                attachCodeCopyButtons(bubble);
                applySyntaxHighlighting(bubble);
            }, 0);
        } else {
            // 未加载 marked 时降级为纯文本
            contentDiv.innerHTML = `<pre>${escapeHtml(display)}</pre>`;
            setTimeout(() => {
                attachCodeCopyButtons(bubble);
                applySyntaxHighlighting(bubble);
            }, 0);
        }
    }
    bubble.appendChild(contentDiv);

    // ★ 如果消息仍在生成中(partial),显示加载动画
    if (partial && role === 'assistant') {
        var loadingEl = document.createElement('div');
        loadingEl.className = 'msg-loading-indicator';
        loadingEl.innerHTML = '<span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span>';
        bubble.appendChild(loadingEl);
    }

    // 如果有生成的图片,显示在内容下方
    var allImages = generatedImages || (generatedImage ? [generatedImage] : []);
    if (allImages.length > 0) {
        var imgContainer = document.createElement('div');
        imgContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
        allImages.forEach(function(imgData, idx) {
            var wrapper = document.createElement('div');
            wrapper.style.cssText = 'position:relative;cursor:pointer;';
            var img = document.createElement('img');
            var cleanUrl = cleanImageUrl(imgData);
            img.src = cleanUrl;
            var maxW = allImages.length > 1 ? '160px' : '320px';
            img.style.cssText = 'max-width:' + maxW + ';width:100%;border-radius:8px;display:block;';
            img.setAttribute('loading', 'lazy');
            // ★ 点击放大预览
            img.addEventListener('click', function() { showImageLightbox(allImages, idx); });
            img.onerror = function() {
                this.style.display = 'none';
                var fallback = document.createElement('div');
                fallback.style.cssText = 'padding:10px;border-radius:8px;background:#fef3c7;border:1px solid #f59e0b;margin:4px 0;color:#92400e;font-size:0.75rem;text-align:center;';
                fallback.textContent = '\u26a0\ufe0f \u56fe\u7247\u52a0\u8f7d\u5931\u8d25';
                wrapper.appendChild(fallback);
            };
            wrapper.appendChild(img);
            // 悬停显示放大图标
            var hint = document.createElement('div');
            hint.style.cssText = 'position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.5);color:#fff;border-radius:4px;padding:2px 6px;font-size:11px;opacity:0;transition:opacity 0.2s;pointer-events:none;';
            hint.textContent = '\ud83d\udd0d';
            wrapper.addEventListener('mouseenter', function() { hint.style.opacity = '1'; });
            wrapper.addEventListener('mouseleave', function() { hint.style.opacity = '0'; });
            wrapper.appendChild(hint);
            imgContainer.appendChild(wrapper);
        });
        bubble.appendChild(imgContainer);
    }

    wrapper.appendChild(bubble);

    // 操作按钮 — 放在气泡内部,自然对齐气泡右边缘
    var actions = document.createElement('div');
    actions.className = 'msg-actions';

    // 复制按钮
    var copyBtn = document.createElement('div');
    copyBtn.className = 'msg-action-btn copy-msg-btn';
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.onclick = (e) => {
        e.stopPropagation();
        // ★ 修复: 动态读取气泡当前文本,而非闭包里初始的 text 变量
        var _bubbleText = bubble.querySelector('.markdown-body')?.textContent || bubble.textContent || text;
        copyMessageContent(_bubbleText);
        copyBtn.style.background = '#bbf7d0';
        setTimeout(() => copyBtn.style.background = '', 300);
    };
    actions.appendChild(copyBtn);

    if (role === 'user') {
        // 编辑按钮 — 所有用户消息都显示
        var editBtn = document.createElement('div');
            editBtn.className = 'msg-action-btn edit-btn';
            editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3l4 4L7 21H3v-4L17 3z"/><path d="M15 5l4 4"/></svg>';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                var msgs = chats[currentChatId].messages;
                var idx = msgs.findIndex(m => m.role === 'user' && m.text === text && JSON.stringify(m.files) === JSON.stringify(files));
                if (idx === -1) return;
                var sys = msgs.filter(m => m.role === 'system' && !m.temporary && !m.timestamp);
                var timestamp = msgs.find(m => m.timestamp);
                var others = msgs.slice(0, idx).filter(m => m.role !== 'system' || m.temporary || m.timestamp);
                chats[currentChatId].messages = [...sys, ...others, ...(timestamp ? [timestamp] : [])];
                saveChatsDebounced();
                loadChat(currentChatId);
                if ($.userInput) {
                    $.userInput.value = text || '';
                    window.autoResize($.userInput);
                }
                pendingFiles = files ? files.map(f => ({ ...f })) : [];
                updateFilePreviewUI();
            };
            actions.appendChild(editBtn);
        } else {
            // ★ 生成中隐藏操作按钮，避免和思考动画重叠
            if (partial) { /* 不渲染操作按钮 */ }
            else {
            // ★ 判断是否是最后一条 assistant 消息
            var _allAsst = (chats[currentChatId]?.messages || []).filter(m => m.role === 'assistant' && !m.partial);
            var _isLastAsst = _allAsst.length > 0 && _allAsst[_allAsst.length - 1] === chats[currentChatId]?.messages.find(m => m.role === 'assistant' && m.content === text);

            if (_isLastAsst) {
                // ★ 最后一条: 重新生成按钮
                var regenBtn = document.createElement('div');
                regenBtn.className = 'msg-action-btn regenerate-btn';
                regenBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
                regenBtn.title = '重新生成回复';
                regenBtn.onclick = async (e) => {
                    e.stopPropagation();
                    var msgs = chats[currentChatId].messages;
                    var idx = msgs.findIndex(m => m.role === 'assistant' && m.content === text);
                    if (idx === -1) return;
                    var sys = msgs.filter(m => m.role === 'system' && !m.temporary && !m.timestamp);
                    var timestamp = msgs.find(m => m.timestamp);
                    var others = msgs.slice(0, idx).filter(m => m.role !== 'system' || m.temporary || m.timestamp);
                    chats[currentChatId].messages = [...sys, ...others, ...(timestamp ? [timestamp] : [])];
                    saveChatsDebounced();
                    loadChat(currentChatId);
                    var lastUser = msgs.slice(0, idx).filter(m => m.role === 'user').pop();
                    if (lastUser) await sendMessage(true, lastUser.text, lastUser.files);
                };
                actions.appendChild(regenBtn);
            } else {
                // ★ 旧回复: 还原按钮 — 回到此位置，忽略之后的内容
                var restoreBtn = document.createElement('div');
                restoreBtn.className = 'msg-action-btn restore-btn';
                restoreBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/><line x1="9" y1="12" x2="21" y2="12"/><path d="M3 12a9 9 0 0 1 9-9"/></svg>';
                restoreBtn.title = '还原到此处（忽略后续对话）';
                restoreBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (!confirm('还原对话到此位置？\n\n此操作将删除该回复之后的所有对话内容，不可撤销。')) return;
                    var msgs = chats[currentChatId].messages;
                    var idx = msgs.findIndex(m => m.role === 'assistant' && m.content === text);
                    if (idx === -1) return;
                    // 保留此消息及之前的所有消息（包括 system）
                    chats[currentChatId].messages = msgs.slice(0, idx + 1);
                    saveChatsDebounced();
                    loadChat(currentChatId);
                };
                actions.appendChild(restoreBtn);
            }
            }
    }

    if (actions.children.length) wrapper.appendChild(actions);

    // 底部统计(改用SVG图标)
    // ★ 防止历史脏数据: time > 1天(86400000ms)视为绝对时间戳,不显示
    var _validTime = (time > 0 && time < 86400000);
    if (role === 'assistant' && (usage || _validTime)) {
        var footer = document.createElement('div');
        footer.className = 'message-footer';
        let foot = '';
        if (_validTime) {
            foot += '<svg class="msg-foot-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/></svg> ' + (time / 1000).toFixed(1) + 's';
            if (usage) foot += ' <span class="msg-foot-sep"></span> ';
        }
        if (usage) {
            var ct = Number(usage.completion_tokens) || 0; var pt = Number(usage.prompt_tokens) || 0; var tokens = Number(usage.total_tokens) || (ct + pt) || 0;
            // ★ 兜底: 从其他命名字段提取 token 数
            if (!tokens && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
                tokens = (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0);
            }
            if (!tokens && usage.inputTokenCount) tokens = Number(usage.inputTokenCount) + (Number(usage.outputTokenCount) || 0) || 0;
            if (tokens > 0) {
                if (foot.length > 0) foot += ' <span class="msg-foot-sep"></span> ';
                foot += '<svg class="msg-foot-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="9.5,2 4,9 7.5,9 6.5,14 12,7 8.5,7"/></svg> ' + tokens;
            }
            // ★ 统一提取缓存命中信息,兼容多模型格式
            var cacheHit = null, cacheMiss = null;
            // DeepSeek 原生: prompt_cache_hit/miss_tokens
            if (usage.prompt_cache_hit_tokens !== undefined) {
                cacheHit = Number(usage.prompt_cache_hit_tokens) || 0;
                cacheMiss = Number(usage.prompt_cache_miss_tokens) || 0;
            }
            // OpenAI / oneapi 标准: prompt_tokens_details.cached_tokens
            if (!cacheHit && usage.prompt_tokens_details) {
                var _cached = Number(usage.prompt_tokens_details.cached_tokens) || Number(usage.prompt_tokens_details.cached) || 0;
                if (_cached > 0) { cacheHit = _cached; cacheMiss = (pt || ct) - cacheHit; if (cacheMiss < 0) cacheMiss = 0; }
            }
            // Anthropic Claude: cache_read_input_tokens / cache_creation_input_tokens
            if (!cacheHit && (usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined)) {
                cacheHit = Number(usage.cache_read_input_tokens) || 0;
                cacheMiss = Number(usage.cache_creation_input_tokens) || 0;
            }
            // Grok/xAI 及其他: cached_tokens 直接在 usage 顶层
            if (!cacheHit && Number(usage.cached_tokens) > 0) {
                cacheHit = Number(usage.cached_tokens) || 0;
                cacheMiss = (pt || ct) - cacheHit;
                if (cacheMiss < 0) cacheMiss = 0;
            }
            if (cacheHit !== null && cacheHit > 0) {
                var cacheTotal = cacheHit + cacheMiss;
                if (foot.length > 0) foot += ' <span class="msg-foot-sep"></span> ';
                foot += '<svg class="msg-foot-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5 6h6M5 9h4M5 12h6"/></svg> ';
                foot += cacheTotal > 0 ? ((cacheHit / cacheTotal) * 100).toFixed(1) + '%缓存命中(' + cacheHit + '/' + cacheTotal + ')' : '缓存未启用';
            }
        }
        footer.innerHTML = foot;
        bubble.appendChild(footer);
    }

    row.appendChild(avatar);
    row.appendChild(wrapper);
    // ★ 淡入动画
    row.style.opacity = '0';
    row.style.transform = 'translateY(10px)';
    row.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    container.appendChild(row);
    requestAnimationFrame(function() {
        row.style.opacity = '1';
        row.style.transform = 'translateY(0)';
    });

    // 不在这里滚动,streaming 时会自然跟随

    return bubble;
}

function attachCodeCopyButtons(container) {
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.code-actions')) return;
        var code = pre.innerText.trim();
        var isHtml = /^(<!DOCTYPE|<html|<HTML|<svg[\s>])/.test(code) || (code.indexOf('<') >= 0 && code.indexOf('>') >= 0 && (code.indexOf('style') >= 0 || code.indexOf('script') >= 0 || code.indexOf('div') >= 0 || code.indexOf('body') >= 0 || code.indexOf('h1') >= 0 || code.indexOf('p>') >= 0));

        var actions = document.createElement('div');
        actions.className = 'code-actions';

        if (isHtml) {
            var runBtn = document.createElement('div');
            runBtn.className = 'code-run-btn';
            runBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
            runBtn.title = '\u8fd0\u884c\u6b64HTML';
            runBtn.onclick = function(e) {
                e.stopPropagation();
                try { var win = window.open('', '_blank'); win.document.write(code); win.document.close(); }
                catch(err) { alert('\u65e0\u6cd5\u6253\u5f00\u65b0\u7a97\u53e3'); }
            };
            actions.appendChild(runBtn);
        }

        var copyBtn = document.createElement('div');
        copyBtn.className = 'code-copy-btn';
        copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        copyBtn.onclick = function(e) {
            e.stopPropagation();
            navigator.clipboard.writeText(code);
            copyBtn.style.background = '#bbf7d0';
            setTimeout(function() { copyBtn.style.background = ''; }, 300);
        };
        actions.appendChild(copyBtn);

        pre.insertBefore(actions, pre.firstChild);
    });
}
function applySyntaxHighlighting(container) {
    if (window.hljs) {
        // 静默 highlight.js 的安全警告(代码块中含 HTML 标签时触发,非真安全问题)
        var _warn = console.warn;
        console.warn = function() {};
        container.querySelectorAll('pre code:not([class*="mermaid"])').forEach(function(block) {
            try { hljs.highlightElement(block); } catch(e) {}
        });
        console.warn = _warn;
    }
}

