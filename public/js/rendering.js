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
    // ★ 找到最后一条用户消息, 删除它之后的全部消息 (工具调用轮/中间助手消息/最终回答)
    //   重新生成 = 完整重跑用户问题之后的调用链, 而不是只删最后一个气泡
    var userIdx = -1;
    for (var ri = msgs.length - 1; ri >= 0; ri--) {
        if (msgs[ri].role === 'user') { userIdx = ri; break; }
    }
    if (userIdx === -1) return;
    var lastUser = msgs[userIdx];
    var sys = msgs.filter(function(m) { return m.role === 'system' && !m.temporary && !m.timestamp; });
    var timestamp = null;
    for (var ti = 0; ti < msgs.length; ti++) {
        if (msgs[ti].timestamp) { timestamp = msgs[ti]; break; }
    }
    var others = msgs.slice(0, userIdx).filter(function(m) { return m.role !== 'system' || m.temporary || m.timestamp; });
    chats[currentChatId].messages = sys.concat(others).concat(timestamp ? [timestamp] : []);
    saveChatsDebounced();
    loadChat(currentChatId);
    if (lastUser) await sendMessage(true, lastUser.text, lastUser.files);
};


function autoLinkURLs(markdownText) {
    // ★ 图片 URL → ![](url) 渲染为图片; 其他 URL → [label](url) 文本链接
    return markdownText.replace(/(^|\s)(https?:\/\/[^\s<>]+)($|\s)/g, (match, before, url, after) => {
        if (/!\[.*?\]\(/.test(match) || /\[.*?\]\(/.test(match)) return match;
        try {
            var u = new URL(url);
            // ★ 图片扩展名 → 渲染为图片
            if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)(\?|$)/i.test(u.pathname)) {
                return before + `![image](${url})` + after;
            }
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

// ★ 图片快速操作辅助函数 — 供气泡操作栏和灯箱调用

/** 下载图片 */
function _downloadImage(url, filename) {
    if (!url) return;
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'image.png';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { a.remove(); }, 100);
}

/** 复制图片到剪贴板 */
async function _copyImageToClipboard(url) {
    if (!url) return;
    try {
        var resp = await fetch(url);
        var blob = await resp.blob();
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
        ]);
        if (typeof showToast === 'function') showToast('✅ 图片已复制到剪贴板');
    } catch(e) {
        console.warn('[copyImage] 失败:', e.message);
        // 降级: 复制 URL
        try {
            await navigator.clipboard.writeText(url);
            if (typeof showToast === 'function') showToast('📋 图片链接已复制');
        } catch(e2) {
            if (typeof showToast === 'function') showToast('❌ 复制失败: ' + e.message);
        }
    }
}

/** 以图生图 — 设参考图 + 聚焦输入框 */
function _useAsReference(meta) {
    if (!meta || !meta.url) return;
    // 存储参考图到全局变量
    window._i2iReferenceImage = meta.url;
    // 聚焦输入框并提示
    var input = document.getElementById('userInput') || document.querySelector('textarea[placeholder]');
    if (input) {
        input.focus();
        input.placeholder = '🎨 描述你想要的变换（以图生图）...';
        if (typeof input.scrollIntoView === 'function') {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    if (typeof showToast === 'function') showToast('🎨 已设为参考图，输入描述后发送即可');
}

/** 重新生成 — 用原参数重新调用 generate_image */
async function _regenerateImage(meta) {
    if (!meta || !meta.prompt) {
        if (typeof showToast === 'function') showToast('❌ 缺少提示词信息，无法重新生成');
        return;
    }
    try {
        if (typeof showToast === 'function') showToast('🔄 正在生成变体...');
        // ★ 如果有修改指令，拼接到提示词中
        var _finalPrompt = meta.prompt;
        if (meta.instructions) {
            _finalPrompt = meta.prompt + '\n\n【修改要求】' + meta.instructions;
        }
        var result = await window.generateImage(_finalPrompt, {
            model: meta.model,
            aspect_ratio: meta.aspect_ratio,
            n: 1
        });
        if (result) {
            var url = typeof result === 'string' ? result : (Array.isArray(result) ? result[0] : null);
            if (url) {
                var _newMeta = window.buildImageMeta(url, meta.prompt, {
                    model: meta.model,
                    aspect_ratio: meta.aspect_ratio,
                    notes: meta.instructions ? '变体: ' + meta.instructions.substring(0, 50) : ''
                });
                if (currentChatId && chats[currentChatId]) {
                    var _msgs = chats[currentChatId].messages;
                    var _lastMsg = _msgs[_msgs.length - 1];
                    if (_lastMsg && _lastMsg.role === 'assistant') {
                        if (!_lastMsg.generatedImages) _lastMsg.generatedImages = [];
                        _lastMsg.generatedImages.push(_newMeta);
                        slimSaveChats();
                        loadChat(currentChatId);
                    }
                }
                if (typeof showToast === 'function') showToast('✅ 变体生成完成');
            }
        }
    } catch(e) {
        console.error('[regenerateImage] 失败:', e);
        if (typeof showToast === 'function') showToast('❌ 生成失败: ' + e.message);
    }
}

// ★ 收集当前聊天所有生成图片
function collectChatImages(chatId) {
    var imgs = [];
    if (!chats[chatId] || !chats[chatId].messages) return imgs;
    chats[chatId].messages.forEach(function(msg) {
        if (msg.generatedImages && msg.generatedImages.length > 0) {
            msg.generatedImages.forEach(function(img) { imgs.push(img); });
        }
        if (msg.generatedImage && (!msg.generatedImages || msg.generatedImages.indexOf(msg.generatedImage) === -1)) {
            imgs.push(msg.generatedImage);
        }
    });
    return imgs;
}

// ★ 画布模式 — Codex 风格：大图 + 缩略图条 + 指令修改
function showImageLightbox(images, startIdx) {
    var existing = document.querySelector('.img-lightbox');
    if (existing) existing.dispatchEvent(new Event('lightbox:close'));

    var idx = startIdx || 0;
    var scale = 1, minScale = 1, maxScale = 5;
    var isDragging = false, dragStartX = 0, dragStartY = 0, offsetX = 0, offsetY = 0;
    var previousActive = document.activeElement;
    var previousOverflow = document.body.style.overflow;
    var closed = false;
    var filmstripMax = 8;
    var panelExpanded = true;

    // ════ 主容器 — 柔和渐变背景 ════
    var overlay = document.createElement('div');
    overlay.className = 'img-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '图片画布');
    overlay.tabIndex = -1;
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg,#1e2030 0%,#1a1c2e 40%,#15172a 100%);z-index:9999;display:flex;flex-direction:column;';

    // ════ 顶部栏 — 极简 ════
    var topBar = document.createElement('div');
    topBar.className = 'canvas-topbar';
    var counter = document.createElement('span');
    counter.className = 'canvas-counter';
    topBar.appendChild(counter);

    var topActions = document.createElement('div');
    topActions.style.cssText = 'display:flex;gap:6px;';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'canvas-icon-btn';
    close.setAttribute('aria-label', '关闭画布');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    close.addEventListener('click', closeLightbox);
    topActions.appendChild(close);
    topBar.appendChild(topActions);
    overlay.appendChild(topBar);

    // ════ 中部 — 大图区 + 信息面板 ════
    var mainArea = document.createElement('div');
    mainArea.className = 'canvas-main-area';

    // 大图区
    var imgArea = document.createElement('div');
    imgArea.className = 'canvas-img-area';
    var prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'canvas-nav-btn canvas-nav-prev';
    prevBtn.setAttribute('aria-label', '上一张');
    prevBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>';
    prevBtn.addEventListener('click', function(e) { e.stopPropagation(); switchTo(idx - 1); });
    imgArea.appendChild(prevBtn);

    var img = document.createElement('img');
    img.className = 'canvas-img';
    img.alt = '预览图片';
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;cursor:grab;transition:transform 0.15s ease;box-shadow:0 20px 60px rgba(0,0,0,0.4);';
    imgArea.appendChild(img);

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'canvas-nav-btn canvas-nav-next';
    nextBtn.setAttribute('aria-label', '下一张');
    nextBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><polyline points="9 6 15 12 9 18"/></svg>';
    nextBtn.addEventListener('click', function(e) { e.stopPropagation(); switchTo(idx + 1); });
    imgArea.appendChild(nextBtn);
    mainArea.appendChild(imgArea);

    overlay.appendChild(mainArea);

    // ★ 修改指令浮层 — 默认隐藏，点击按钮后弹出
    var editPopover = document.createElement('div');
    editPopover.className = 'canvas-edit-popover';
    editPopover.style.display = 'none';

    var editHeader = document.createElement('div');
    editHeader.className = 'canvas-edit-header';
    editHeader.innerHTML = '<span>修改指令</span>';
    var editCloseBtn = document.createElement('button');
    editCloseBtn.type = 'button';
    editCloseBtn.className = 'canvas-edit-close';
    editCloseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    editCloseBtn.addEventListener('click', function() { editPopover.style.display = 'none'; });
    editHeader.appendChild(editCloseBtn);
    editPopover.appendChild(editHeader);

    var editPromptDisplay = document.createElement('div');
    editPromptDisplay.className = 'canvas-edit-prompt';
    editPopover.appendChild(editPromptDisplay);

    var editTextarea = document.createElement('textarea');
    editTextarea.className = 'canvas-edit-textarea';
    editTextarea.rows = 4;
    editTextarea.placeholder = '告诉 AI 你想怎么改，例如：\n把背景改成日落、换成水彩风格、让人物笑起来...';
    editPopover.appendChild(editTextarea);

    var editApplyBtn = document.createElement('button');
    editApplyBtn.className = 'canvas-edit-apply-btn';
    editApplyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg><span>生成变体</span>';
    editApplyBtn.addEventListener('click', function() {
        var _meta = getImageMeta(images[idx]);
        var _instruct = editTextarea.value.trim();
        if (!_instruct) {
            editTextarea.focus();
            editTextarea.style.borderColor = '#ef4444';
            setTimeout(function() { editTextarea.style.borderColor = ''; }, 1500);
            return;
        }
        editPopover.style.display = 'none';
        closeLightbox();
        _regenerateImage({
            url: _meta.url,
            prompt: _meta.prompt,
            model: _meta.model,
            aspect_ratio: _meta.aspect_ratio,
            instructions: _instruct
        });
    });
    editPopover.appendChild(editApplyBtn);
    overlay.appendChild(editPopover);



    // ════ 底部 — 浮动操作栏 + 缩略图条 ════
    var bottomArea = document.createElement('div');
    bottomArea.className = 'canvas-bottom-area';

    // 浮动操作胶囊
    var actions = document.createElement('div');
    actions.className = 'canvas-action-capsule';
    var download = document.createElement('a');
    download.className = 'canvas-capsule-btn';
    download.setAttribute('aria-label', '下载');
    download.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    download.addEventListener('click', function(e) { e.stopPropagation(); });
    actions.appendChild(download);
    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'canvas-capsule-btn';
    copyBtn.setAttribute('aria-label', '复制');
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        _copyImageToClipboard(getImageUrl(images[idx]));
    });
    actions.appendChild(copyBtn);
    var i2iBtn = document.createElement('button');
    i2iBtn.type = 'button';
    i2iBtn.className = 'canvas-capsule-btn';
    i2iBtn.setAttribute('aria-label', '以图生图');
    i2iBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    i2iBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        closeLightbox();
        _useAsReference(getImageMeta(images[idx]));
    });
    actions.appendChild(i2iBtn);
    // 创建变体按钮 — 弹出修改指令浮层
    var variantBtn = document.createElement('button');
    variantBtn.type = 'button';
    variantBtn.className = 'canvas-capsule-btn';
    variantBtn.setAttribute('aria-label', '创建变体');
    variantBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>';
    variantBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var _meta = getImageMeta(images[idx]);
        editPromptDisplay.textContent = _meta.prompt || '(无提示词)';
        editTextarea.value = '';
        editPopover.style.display = 'flex';
        setTimeout(function() { editTextarea.focus(); }, 100);
    });
    actions.appendChild(variantBtn);
    bottomArea.appendChild(actions);

    // 缩略图条
    var filmstrip = document.createElement('div');
    filmstrip.className = 'canvas-filmstrip';
    var filmstripTrack = document.createElement('div');
    filmstripTrack.className = 'canvas-filmstrip-track';
    filmstrip.appendChild(filmstripTrack);
    bottomArea.appendChild(filmstrip);
    overlay.appendChild(bottomArea);

    function renderFilmstrip() {
        filmstripTrack.innerHTML = '';
        var showCount = Math.min(images.length, filmstripMax);
        for (var fi = 0; fi < showCount; fi++) {
            var thumb = document.createElement('div');
            thumb.className = 'canvas-filmstrip-thumb' + (fi === idx ? ' active' : '');
            var thumbImg = document.createElement('img');
            thumbImg.src = cleanImageUrl(getImageUrl(images[fi]));
            thumbImg.alt = '';
            thumbImg.loading = 'lazy';
            thumb.appendChild(thumbImg);
            (function(ti) { thumb.addEventListener('click', function() { switchTo(ti); }); })(fi);
            filmstripTrack.appendChild(thumb);
        }
        if (images.length > filmstripMax) {
            var more = document.createElement('div');
            more.className = 'canvas-filmstrip-more';
            more.textContent = '+' + (images.length - filmstripMax);
            more.addEventListener('click', function() { filmstripMax = images.length; renderFilmstrip(); });
            filmstripTrack.appendChild(more);
        }
    }

    // 缩放/拖拽
    img.addEventListener('wheel', function(e) {
        e.preventDefault(); e.stopPropagation();
        scale = Math.max(minScale, Math.min(maxScale, Math.round((scale + (e.deltaY > 0 ? -0.1 : 0.1)) * 10) / 10));
        applyTransform();
    }, { passive: false });
    img.addEventListener('mousedown', function(e) {
        if (scale <= 1) return;
        e.preventDefault(); isDragging = true;
        dragStartX = e.clientX - offsetX; dragStartY = e.clientY - offsetY;
        img.style.cursor = 'grabbing';
    });
    function handleMouseMove(e) { if (!isDragging) return; offsetX = e.clientX - dragStartX; offsetY = e.clientY - dragStartY; applyTransform(); }
    function handleMouseUp() { isDragging = false; if (scale > 1) img.style.cursor = 'grabbing'; }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    function applyTransform() {
        img.style.transform = 'translate(' + offsetX + 'px,' + offsetY + 'px) scale(' + scale + ')';
        if (scale > 1) { img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; }
        else { img.style.maxWidth = '100%'; img.style.maxHeight = '100%'; }
    }

    function switchTo(ni) {
        idx = (ni + images.length) % images.length;
        updateView();
    }

    function updateView() {
        scale = 1; offsetX = 0; offsetY = 0;
        var m = getImageMeta(images[idx]);
        img.src = cleanImageUrl(m.url);
        img.alt = (idx + 1) + ' / ' + images.length;
        counter.textContent = (idx + 1) + ' / ' + images.length + (images.length > 1 ? ' 张图片' : '');
        download.href = cleanImageUrl(m.url);
        download.download = 'image_' + (idx + 1) + '.png';
        // 清除浮层内容
        editPromptDisplay.textContent = '';
        editTextarea.value = '';
        applyTransform();
        renderFilmstrip();
    }

    function closeLightbox() {
        if (closed) return;
        closed = true;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('keydown', keyHandler);
        document.body.style.overflow = previousOverflow;
        overlay.remove();
        if (previousActive && typeof previousActive.focus === 'function') {
            try { previousActive.focus({ preventScroll: true }); } catch(e) {}
        }
    }
    overlay.addEventListener('lightbox:close', closeLightbox, { once: true });

    function keyHandler(e) {
        if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); return; }
        if (e.key === 'ArrowLeft') { switchTo(idx - 1); }
        if (e.key === 'ArrowRight') { switchTo(idx + 1); }
        if (e.key === '+' || e.key === '=') { scale = Math.min(maxScale, Math.round((scale + 0.2) * 10) / 10); applyTransform(); }
        if (e.key === '-') { scale = Math.max(minScale, Math.round((scale - 0.2) * 10) / 10); applyTransform(); }
        if (e.key === '0') { scale = 1; offsetX = 0; offsetY = 0; applyTransform(); }
    }
    document.addEventListener('keydown', keyHandler);

    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeLightbox(); });

    updateView();
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    close.focus({ preventScroll: true });
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

    var typeIcons = {
        'web_search': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8a3 3 0 0 0-3 3"/></svg>',
        'web_fetch': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
        'server_exec': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
        'delegate_task': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
    };
    var iconHtml = typeIcons[toolName] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/></svg>';

    var summary = toolName + ': ' + JSON.stringify(args).substring(0, 60);

    var resultText = '';
    if (result) {
        if (typeof result === 'string') resultText = result;
        else if (result.result) resultText = String(result.result);
        else if (result.error) resultText = String(result.error);
        else if (result.output) resultText = String(result.output);
        else resultText = JSON.stringify(result).substring(0, 300);
    }
    // ★ web_search: 详情块改为滚动标题条展示, 卡片只保留一行简短摘要 (完整结果仍随 toolResult 传给模型)
    if (toolName === 'web_search' && result && !(result && result.error)) {
        var _searchLine = (resultText || '').split('\n').filter(function(l) { return /^\d+\.\s/.test(l); });
        resultText = '✅ 已获取 ' + _searchLine.length + ' 条搜索结果 · 标题已在上方滚动展示';
    }

    var durationStr = '';
    if (durationMs !== undefined && durationMs !== null && durationMs > 0) {
        if (durationMs < 1000) durationStr = durationMs + 'ms';
        else if (durationMs < 60000) durationStr = (durationMs / 1000).toFixed(1) + 's';
        else durationStr = Math.floor(durationMs / 60000) + 'm' + Math.floor((durationMs % 60000) / 1000) + 's';
    }

    var isError = !!(result && result.error);
    var statusColor = isError ? '#ef4444' : '#059669';
    var statusText = isError ? '失败' : '成功';

    var html = '<button type="button" class="tool-call-card-header" aria-expanded="false">' +
        '<span class="tool-call-card-icon" style="color:' + statusColor + ';">' + iconHtml + '</span>' +
        '<span style="font-weight:600;font-size:12px;flex-shrink:0;">' + escapeHtml(toolName) + '</span>' +
        '<span style="font-size:11px;color:#9ca3af;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">' + escapeHtml(summary) + '</span>' +
        (durationStr ? '<span style="font-size:10px;color:#9ca3af;flex-shrink:0;">' + durationStr + '</span>' : '') +
        '<span style="font-size:10px;color:' + statusColor + ';flex-shrink:0;font-weight:500;">' + statusText + '</span>' +
        '<span class="tool-call-card-chevron"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></span>' +
    '</button>' +
    '<div class="tool-call-card-body">';

    if (execDetails && execDetails.command) {
        html += '<details class="tool-exec-details">' +
            '<summary class="tool-exec-summary" style="cursor:pointer;font-weight:500;color:#374151;margin-bottom:4px;display:flex;align-items:flex-start;gap:4px;min-width:0;">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>' +
                '<span style="flex:1;min-width:0;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap;line-height:1.45;">' + escapeHtml(execDetails.command) + '</span>' +
            '</summary>' +
            '<pre class="tool-exec-output" style="margin:4px 0 0 16px;padding:6px 8px;background:#1e1e2e;color:#cdd6f4;border-radius:6px;font-family:var(--font-mono);font-size:10px;line-height:1.5;max-height:200px;overflow:auto;box-sizing:border-box;max-width:100%;white-space:pre-wrap;word-break:break-all;">' +
            escapeHtml((execDetails.output || execDetails.error || '').substring(0, 5000)) + '</pre>' +
            (execDetails.exitCode !== undefined ? '<div style="margin:4px 0 0 16px;font-size:10px;color:' + (execDetails.exitCode === 0 ? '#059669' : '#ef4444') + ';">退出码: ' + execDetails.exitCode + '</div>' : '') +
            '</details>';
    }

    html += '<details class="tool-args-details" style="margin-top:4px;">' +
        '<summary class="tool-args-summary" style="cursor:pointer;font-size:10px;color:#9ca3af;display:flex;align-items:center;gap:3px;">' +
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34"/><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"/></svg>参数</summary>' +
        '<pre class="tool-call-args" style="margin:4px 0 0 16px;padding:6px;background:#f3f4f6;border-radius:4px;font-size:10px;max-height:120px;overflow:auto;box-sizing:border-box;max-width:100%;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;">' + escapeHtml(JSON.stringify(args, null, 2).substring(0, 2000)) + '</pre>' +
        '</details>';

    if (resultText) {
        var displayResult = resultText.length > 500 ? resultText.substring(0, 500) : resultText;
        var isLongResult = resultText.length > 500;
        html += '<details class="tool-result-details" style="margin-top:4px;" ' + (isError ? 'open' : '') + '>' +
            '<summary class="tool-result-summary" style="cursor:pointer;font-size:10px;color:' + (isError ? '#ef4444' : '#059669') + ';display:flex;align-items:center;gap:3px;">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 10 13 20 5"/><line x1="21" y1="12" x2="12" y2="19"/></svg>' + (isError ? '错误' : '结果') + (isLongResult ? ' (' + resultText.length + ' 字符)' : '') + '</summary>' +
            '<pre class="tool-call-result" style="margin:4px 0 0 16px;padding:6px;background:' + (isError ? '#fef2f2' : '#f0fdf4') + ';border-radius:4px;font-size:10px;max-height:200px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;box-sizing:border-box;max-width:100%;color:' + (isError ? '#dc2626' : '#374151') + ';">' + escapeHtml(displayResult) + '</pre>' +
            (isLongResult ? '<button onclick="var p=this.previousElementSibling;p.style.maxHeight=\'none\';p.textContent=p.getAttribute(\'data-full\')||p.textContent;this.remove()" style="margin:4px 0 0 16px;font-size:10px;color:#6366f1;border:none;background:none;cursor:pointer;">展开全部 (' + resultText.length + ' 字符)</button>' : '') +
            '</details>';
    }

    html += '</div>';
    card.innerHTML = html;

    var cardHeader = card.querySelector('.tool-call-card-header');
    if (cardHeader) {
        cardHeader.addEventListener('click', function() {
            var expanded = card.classList.toggle('expanded');
            cardHeader.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        });
    }

    // ★ 注入全文到 pre 的 data-full 属性（textContent 不解析 HTML，存原文安全）
    if (resultText && resultText.length > 500) {
        var _preEl = card.querySelector('.tool-call-result');
        if (_preEl) {
            _preEl.setAttribute('data-full', resultText.substring(0, 10000));
        }
    }

    return card;
}
function appendToolCallMessage(toolName, args, result, durationMs, chatId, execDetails) {
    var card = createToolCallCard(toolName, args, result, durationMs, execDetails);
    var container = $.chatMessagesContainer;
    if (!container) return;

    var row = document.createElement('div');
    row.className = 'message-row assistant tool-call-row';

    var wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';

    var bubble = document.createElement('div');
    bubble.className = 'bubble assistant tool-call-bubble';
    bubble.appendChild(card);

    wrapper.appendChild(bubble);
    row.appendChild(wrapper);
    container.appendChild(row);
    // ★ 标记相邻工具调用行属于同一批次
    row.setAttribute('data-tool-batch', '1');
    var _prevRow = row.previousElementSibling;
    if (_prevRow && _prevRow.hasAttribute('data-tool-batch')) {
        row.setAttribute('data-tool-idx', (parseInt(_prevRow.getAttribute('data-tool-idx') || '0') + 1).toString());
        row.style.display = 'none'; // 默认折叠
    } else {
        row.setAttribute('data-tool-idx', '0');
    }
    // 每追加一条都同步首行的批次按钮。旧逻辑只在第一条创建时向后扫描，
    // 当第二条尚未存在时永远不会生成按钮，导致后续工具行永久隐藏。
    _syncToolBatchToggle(row);

    // ★ 滚动跟随已统一由 scroll-follow.js 管理(此处的 isAutoScrolling 为死代码, 已移除)

    return row;
}

function _syncToolBatchToggle(row) {
    if (!row) return;
    var first = row;
    while (first.previousElementSibling && first.previousElementSibling.hasAttribute('data-tool-batch')) {
        first = first.previousElementSibling;
    }
    var rows = [];
    var cursor = first;
    while (cursor && cursor.hasAttribute('data-tool-batch')) {
        rows.push(cursor);
        cursor = cursor.nextElementSibling;
    }

    var bubble = first.querySelector('.tool-call-bubble');
    if (!bubble) return;
    var btn = bubble.querySelector(':scope > .tool-toggle-btn');
    if (rows.length < 2) {
        if (btn) btn.remove();
        return;
    }

    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tool-toggle-btn';
        btn.innerHTML = '<span class="tool-toggle-count"></span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var currentRows = [];
            var node = first;
            while (node && node.hasAttribute('data-tool-batch')) {
                currentRows.push(node);
                node = node.nextElementSibling;
            }
            var shouldExpand = currentRows.slice(1).some(function(item) { return item.style.display === 'none'; });
            currentRows.slice(1).forEach(function(item) {
                if (shouldExpand) {
                    item.style.display = '';
                    item.classList.remove('tool-collapsing');
                    item.style.animation = 'toolExpandIn 0.28s cubic-bezier(0.4,0,0.2,1) forwards';
                } else {
                    item.style.display = 'none';
                    item.classList.remove('tool-collapsing');
                    item.style.animation = '';
                }
            });
            btn.classList.toggle('expanded', shouldExpand);
            btn.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
            btn.setAttribute('aria-label', (shouldExpand ? '收起' : '展开') + '其余 ' + (currentRows.length - 1) + ' 条工具调用');
            btn.title = btn.getAttribute('aria-label');
            if (shouldExpand && $.chatBox && !userScrolled) followToBottom($.chatBox);
        });
        bubble.appendChild(btn);
    }

    var count = btn.querySelector('.tool-toggle-count');
    if (count) count.textContent = '+' + (rows.length - 1);
    var expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.setAttribute('aria-label', (expanded ? '收起' : '展开') + '其余 ' + (rows.length - 1) + ' 条工具调用');
    btn.title = btn.getAttribute('aria-label');
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

function appendMessage(role, text, files = null, reasoning = null, usage = null, time = 0, isLast = false, generatedImage = null, generatedImages = null, partial = false, msgIndex = -1, injected = false) {
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

    // ★ loadChat 批量加载时通过 _appendTarget 传入 DocumentFragment(免逐条布局抖动)
    var container = window._appendTarget || $.chatMessagesContainer;
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
    if (role === 'user') {
        avatar.textContent = '我';
    } else {
        var avatarImg = document.createElement('img');
        avatarImg.className = 'avatar-remi-gif';
        avatarImg.src = './src/remi/idle.gif';
        avatarImg.alt = '蕾米';
        avatarImg.title = '蕾米 · 待机中';
        avatar.appendChild(avatarImg);
        // ★ 默认隐藏: 仅最新助手消息由 model-status.js 放行显示 (消除首帧全显闪烁, 布局零跳动)
        avatar.classList.add('remi-avatar-hide');
    }

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
        var summaryText = '🤔 推理过程';
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
                    modal.setAttribute('role', 'dialog');
                    modal.setAttribute('aria-modal', 'true');
                    modal.setAttribute('aria-label', '文件图片预览');
                    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:1000;display:flex;align-items:center;justify-content:center;';
                    var modalImg = document.createElement('img');
                    // serverUrl 文件通常没有内联 content，复用已解析的可用地址。
                    modalImg.src = _isrc;
                    modalImg.alt = f.name || '图片预览';
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
            // ★ 性能: 无代码围栏特征的消息跳过整个 Mermaid 扫描/调度(长对话历史加载大提速)
            var _hasFenceHint = /```|~~~|mermaid|gantt|sequenceDiagram|flowchart|graph\s*[TDLR]|classDiagram|stateDiagram|erDiagram|journey|mindmap|timeline|gitgraph|xychart|sankey|block-beta|\bdot\b/i.test(display);
            setTimeout(() => {
                if (!_hasFenceHint) {
                    // 无图表特征: 跳过 mermaid 扫描, 直接做复制按钮/高亮
                    attachCodeCopyButtons(bubble);
                    applySyntaxHighlighting(bubble);
                    return;
                }
                // 查找所有 mermaid 相关代码块(含 gantt/dot 等图表类型)
                var mermaidCodes = contentDiv.querySelectorAll('pre code[class*="mermaid"], pre code[class*="gantt"], pre code[class*="dot"]');
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
                            // ★ 如果 div 已被上面 then() 替换过，跳过
                            if (div.querySelector('svg') === null && !div.querySelector('.mermaid')) {
                                // div 已被清理，跳过
                            }
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
        imgContainer.className = 'gen-image-container';
        allImages.forEach(function(imgData, idx) {
            var wrapper = document.createElement('div');
            wrapper.className = 'gen-image-wrapper';
            var img = document.createElement('img');
            var meta = getImageMeta(imgData);
            var cleanUrl = cleanImageUrl(meta.url);
            img.src = cleanUrl;
            img.alt = '生成图片 ' + (idx + 1);
            var maxW = allImages.length > 1 ? '160px' : '320px';
            img.className = 'gen-image';
            img.style.maxWidth = maxW;
            img.setAttribute('loading', 'lazy');
            // ★ 点击放大预览 — 传入当前聊天所有图片，当前图在全部图片中的索引
            img.addEventListener('click', function() {
                var _allChatImgs = collectChatImages(currentChatId);
                var _meta = getImageMeta(imgData);
                var _globalIdx = _allChatImgs.findIndex(function(item) {
                    return getImageUrl(item) === _meta.url;
                });
                if (_globalIdx === -1) _globalIdx = idx;
                showImageLightbox(_allChatImgs, _globalIdx);
            });
            img.onerror = function() {
                this.style.display = 'none';
                var fallback = document.createElement('div');
                fallback.style.cssText = 'padding:10px;border-radius:8px;background:#fef3c7;border:1px solid #f59e0b;margin:4px 0;color:#92400e;font-size:0.75rem;text-align:center;';
                fallback.className = 'gen-image-error';
                fallback.textContent = '\u26a0\ufe0f \u56fe\u7247\u52a0\u8f7d\u5931\u8d25';
                wrapper.appendChild(fallback);
            };
            wrapper.appendChild(img);
            // 悬停显示放大图标
            var actionBar = document.createElement('div');
            actionBar.className = 'img-action-bar';
            // \u4e0b\u8f7d\u6309\u94ae
            var dlBtn = document.createElement('button');
            dlBtn.className = 'img-action-btn';
            dlBtn.title = '\u4e0b\u8f7d\u56fe\u7247';
            dlBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
            dlBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                _downloadImage(meta.url, 'generated_' + (idx + 1) + '.png');
            });
            actionBar.appendChild(dlBtn);
            // \u590d\u5236\u6309\u94ae
            var copyBtn = document.createElement('button');
            copyBtn.className = 'img-action-btn';
            copyBtn.title = '\u590d\u5236\u5230\u526a\u8d34\u677f';
            copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
            copyBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                _copyImageToClipboard(meta.url);
            });
            actionBar.appendChild(copyBtn);
            // \u4ee5\u56fe\u751f\u56fe\u6309\u94ae
            var i2iBtn = document.createElement('button');
            i2iBtn.className = 'img-action-btn';
            i2iBtn.title = '\u4ee5\u56fe\u751f\u56fe';
            i2iBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
            i2iBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                _useAsReference(meta);
            });
            actionBar.appendChild(i2iBtn);
            // \u91cd\u65b0\u751f\u6210\u6309\u94ae
            var regenBtn = document.createElement('button');
            regenBtn.className = 'img-action-btn';
            regenBtn.title = '\u91cd\u65b0\u751f\u6210';
            regenBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
            regenBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                _regenerateImage(meta);
            });
            actionBar.appendChild(regenBtn);
            wrapper.appendChild(actionBar);
            imgContainer.appendChild(wrapper);
        });
        bubble.appendChild(imgContainer);
    }

    // ★ 推入标记: 消息在模型生成中途被推入时显示一个小角标
    if (injected && role === 'user') {
        var injectedBadge = document.createElement('div');
        injectedBadge.className = 'msg-injected-badge';
        injectedBadge.innerHTML = '📨 推入';
        injectedBadge.title = '此消息在模型生成中途被推入,模型将在当前回复后处理';
        bubble.appendChild(injectedBadge);
        bubble.classList.add('bubble-injected');
    }

    wrapper.appendChild(bubble);

    // 操作按钮 — 放在气泡内部,自然对齐气泡右边缘
    var actions = document.createElement('div');
    actions.className = 'msg-actions';

    // 复制按钮(构建逻辑抽到 _buildCopyButton, 供流结束就地收尾复用)
    actions.appendChild(_buildCopyButton(bubble, text));

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
                var _asstBtns = _buildAssistantActionButtons(bubble, text, msgIndex);
                if (_asstBtns) actions.appendChild(_asstBtns);
            }
    }

    if (actions.children.length) wrapper.appendChild(actions);

    // 底部统计(改用SVG图标) — 构建逻辑在 _buildMsgFooterHtml(供流结束就地收尾复用)
    // ★ 防止历史脏数据: time > 1天(86400000ms)视为绝对时间戳,不显示
    var _validTime = (time > 0 && time < 86400000);
    if (role === 'assistant' && (usage || _validTime)) {
        var footer = document.createElement('div');
        footer.className = 'message-footer';
        footer.innerHTML = _buildMsgFooterHtml(usage, time);
        bubble.appendChild(footer);
    }

    row.appendChild(avatar);
    row.appendChild(wrapper);
    // ★ 淡入动画(历史加载大量消息时用 _suppressRowAnim 抑制, 避免数百次过渡卡顿)
    container.appendChild(row);
    // ★ 页脚只保留最后一个助手气泡的统计 (此时行已挂入容器, 修剪才有效)
    if (role === 'assistant' && (usage || _validTime)) {
        var _foots = container.querySelectorAll('.bubble.assistant .message-footer');
        if (_foots.length > 1) {
            for (var _fi = 0; _fi < _foots.length - 1; _fi++) _foots[_fi].remove();
        }
    }
    if (!window._suppressRowAnim) {
        row.style.opacity = '0';
        row.style.transform = 'translateY(10px)';
        row.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
        requestAnimationFrame(function() {
            row.style.opacity = '1';
            row.style.transform = 'translateY(0)';
        });
    }

    // 不在这里滚动,streaming 时会自然跟随

    return bubble;
}

// ==================== 消息操作按钮/页脚构建(appendMessage 与流结束就地收尾共用) ====================

// ★ 复制按钮
function _buildCopyButton(bubble, text) {
    var copyBtn = document.createElement('div');
    copyBtn.className = 'msg-action-btn copy-msg-btn';
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.onclick = (e) => {
        e.stopPropagation();
        // ★ 动态读取气泡当前文本,而非闭包里初始的 text 变量
        var _bubbleText = bubble.querySelector('.markdown-body')?.textContent || bubble.textContent || text;
        copyMessageContent(_bubbleText);
        copyBtn.style.background = '#bbf7d0';
        setTimeout(() => copyBtn.style.background = '', 300);
    };
    return copyBtn;
}

// ★ assistant 消息的 重新生成/继续生成/还原 按钮(基于位置判断最后一条, 不用 content 匹配)
function _buildAssistantActionButtons(bubble, text, msgIndex) {
    var frag = document.createDocumentFragment();
    var _msgsArr = chats[currentChatId]?.messages || [];
    var _isLastAsst = false;
    if (msgIndex >= 0 && _msgsArr[msgIndex] && _msgsArr[msgIndex].role === 'assistant') {
        // 检查此消息之后是否还有其他 assistant 消息(排除partial)
        var _hasAsstAfter = false;
        for (var _ai = msgIndex + 1; _ai < _msgsArr.length; _ai++) {
            if (_msgsArr[_ai].role === 'assistant' && !_msgsArr[_ai].partial) {
                _hasAsstAfter = true; break;
            }
        }
        _isLastAsst = !_hasAsstAfter;
    }
    if (_isLastAsst) {
        // ★ 最后一条: 重新生成按钮
        var regenBtn = document.createElement('div');
        regenBtn.className = 'msg-action-btn regenerate-btn';
        regenBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
        regenBtn.title = '重新生成回复';
        regenBtn.onclick = async (e) => {
            e.stopPropagation();
            var msgs = chats[currentChatId].messages;
            // ★ 用msgIndex定位(比content字符串匹配可靠)
            var idx = msgIndex;
            if (idx < 0 || idx >= msgs.length || msgs[idx].role !== 'assistant') {
                idx = msgs.findIndex(m => m.role === 'assistant' && m.content === text);
            }
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
        frag.appendChild(regenBtn);

        // ★ "继续生成"按钮 — 让模型展开详述
        var continueBtn = document.createElement('div');
        continueBtn.className = 'msg-action-btn continue-btn';
        continueBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/><line x1="12" y1="15" x2="12" y2="21"/></svg>';
        continueBtn.title = '继续展开详述';
        continueBtn.onclick = async (e) => {
            e.stopPropagation();
            if (typeof window.sendMessage === 'function') {
                await window.sendMessage(true, '请继续展开，提供更详细、更全面的回答。');
            }
        };
        frag.appendChild(continueBtn);
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
        frag.appendChild(restoreBtn);
    }
    return frag.children.length ? frag : null;
}

// ★ 构建消息页脚 HTML(耗时/token/缓存命中) — appendMessage 与 finalizeBubbleUI 共用
function _buildMsgFooterHtml(usage, time) {
    var _validTime = (time > 0 && time < 86400000);
    if (!_validTime && !usage) return '';
    let foot = '';
    if (_validTime) {
        foot += '<svg class="msg-foot-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/></svg> ' + (time / 1000).toFixed(1) + 's';
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
        // ★ 统一提取缓存命中信息,兼容多模型格式 (DeepSeek/OpenAI/Anthropic/Gemini/Grok)
        var cacheHit = null, cacheMiss = null;
        cacheHit = window._extractCacheHit ? window._extractCacheHit(usage) : 0;
        if (cacheHit > 0) {
            cacheMiss = (window._extractPromptTokens ? window._extractPromptTokens(usage) : 0) || pt || ct;
            cacheMiss = cacheMiss - cacheHit;
            if (cacheMiss < 0) cacheMiss = 0;
        }
        // ★ 缓存命中信息: 页脚只出现在最后一个气泡, 这里恢复展示 (兼容 4 种模型格式)
        if (cacheHit !== null && cacheHit > 0) {
            var cacheTotal = cacheHit + cacheMiss;
            if (foot.length > 0) foot += ' <span class="msg-foot-sep"></span> ';
            foot += '<svg class="msg-foot-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5 6h6M5 9h4M5 12h6"/></svg> ';
            foot += cacheTotal > 0 ? ((cacheHit / cacheTotal) * 100).toFixed(1) + '%缓存命中(' + cacheHit + '/' + cacheTotal + ')' : '缓存未启用';
        }
    }
    return foot;
}

// ★ 流结束就地收尾: 给已存在的气泡补操作按钮 + 页脚
//   (替代 finally 里的 loadChat 全量重建 — 免重建后页面不再跳变)
window.finalizeBubbleUI = function(bubble, text, msgIndex, usage, time) {
    if (!bubble) return;
    var wrapper = bubble.closest('.message-content-wrapper');
    if (!wrapper) return;
    // 操作按钮: 已存在则只补 assistant 专属按钮(重新生成/继续/还原)
    var actions = wrapper.querySelector('.msg-actions');
    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'msg-actions';
        actions.appendChild(_buildCopyButton(bubble, text));
        wrapper.appendChild(actions);
    }
    if (!actions.querySelector('.regenerate-btn, .continue-btn, .restore-btn')) {
        var asstBtns = _buildAssistantActionButtons(bubble, text, msgIndex);
        if (asstBtns) actions.appendChild(asstBtns);
    }
    // 页脚(耗时/token/缓存命中) — 只在最后一个气泡显示
    if (!bubble.querySelector('.message-footer')) {
        // ★ 先清掉其他气泡的页脚, 只留当前(最新输出)的统计
        var container2 = bubble.closest('.chat-messages-container') || bubble.closest('.message-row')?.parentElement;
        if (container2) {
            container2.querySelectorAll('.bubble.assistant .message-footer').forEach(function(_f) {
                if (_f.closest('.bubble') !== bubble) _f.remove();
            });
        }
        var footHtml = _buildMsgFooterHtml(usage, time);
        if (footHtml) {
            var footer = document.createElement('div');
            footer.className = 'message-footer';
            footer.innerHTML = footHtml;
            bubble.appendChild(footer);
        }
    }
};

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
        container.querySelectorAll('pre code:not([class*="mermaid"]):not([class*="gantt"]):not([class*="dot"])').forEach(function(block) {
            try {
                var _lang = (block.className || '').match(/language-(\S+)/);
                if (_lang && _lang[1] && typeof hljs.getLanguage === 'function' && !hljs.getLanguage(_lang[1])) return;
                hljs.highlightElement(block);
            } catch(e) {}
        });
        console.warn = _warn;
    }
}



// ★ 页面加载后为历史工具调用创建摘要栏
window._renderAllToolStacks = function() {
    var _container = $.chatMessagesContainer;
    if (!_container) return;
    var _allRows = _container.querySelectorAll('.tool-call-row');
    if (_allRows.length < 2) return;
    var _batches = []; var _current = [];
    _allRows.forEach(function(r) {
        var _prev = r.previousElementSibling;
        if (_prev && _prev.classList.contains('tool-call-row')) {
            _current.push(r);
        } else {
            if (_current.length > 0) _batches.push(_current);
            _current = [r];
        }
    });
    if (_current.length > 0) _batches.push(_current);
    _batches.forEach(function(_batch) {
        if (_batch.length < 2) return;
        if (_batch[0].previousElementSibling && _batch[0].previousElementSibling.classList.contains('tool-stack-summary')) return;
        var _names = []; _batch.forEach(function(r) {
            var _spans = r.querySelectorAll('.tool-call-card-header span');
            for (var s = 0; s < _spans.length; s++) {
                if (_spans[s].style && _spans[s].style.fontWeight === '600') { _names.push(_spans[s].textContent); break; }
            }
        });
        if (_names.length < 2) return;
        if (window._toolStackCollapsed == null) window._toolStackCollapsed = true;
        var _summary = document.createElement('div');
        _summary.className = 'tool-stack-summary';
        _summary.innerHTML = '<span class="tool-stack-icon">🔧</span>' +
            '<span class="tool-stack-count">' + _names.length + ' 次工具调用</span>' +
            '<span class="tool-stack-names">' + _names.map(function(n){return '<span class="tool-stack-tag">'+escapeHtml(n)+'</span>';}).join('') + '</span>' +
            '<button class="tool-stack-expand-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>';
        _batch[0].before(_summary);
        function _apply() {
            _batch.forEach(function(r, i) {
                if (i === 0) { r.classList.toggle('tool-stacked', false); return; }
                r.classList.toggle('tool-stacked', window._toolStackCollapsed);
            });
            var _b = _summary.querySelector('.tool-stack-expand-btn');
            if (_b) _b.innerHTML = window._toolStackCollapsed
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 15 12 9 18 15"/></svg>';
        }
        _apply();
        _summary.querySelector('.tool-stack-expand-btn').onclick = function(e) {
            e.stopPropagation();
            window._toolStackCollapsed = !window._toolStackCollapsed;
            _apply();
        };
    });
};
