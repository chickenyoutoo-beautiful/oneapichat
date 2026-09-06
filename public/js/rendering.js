// rendering.js — 消息/工具渲染 v1.0 (Phase 6)
// appendMessage / showWelcome / 工具调用卡片 / 状态行

// ==== 消息渲染 ====
// ==================== 消息渲染 ====================
function showWelcome() {
    let container = $.chatMessagesContainer;
    if (!container) return;

    var _isAgent = (typeof isAgentToolsActive === 'function' && isAgentToolsActive());
    if (_isAgent) {
        // ★ OneAPIChat Agent Workspace：项目专属欢迎标识与工作区入口
        var _wm = window.WorkspaceManager;
        var curWs = _wm ? _wm.getCurrentWorkspace() : { name: 'oneapichat', path: '/var/www/html/oneapichat' };
        var curMode = (typeof getAgentMode === 'function') ? getAgentMode() : 'agent';
        var modeLabels = { 'plan': 'Plan 模式', 'agent': 'Agent 模式', 'yolo': 'YOLO 模式' };

        var html = '<div class="dsh-welcome-hero oac-agent-hero" data-agent-welcome="true">' +
            '<div class="oac-hero-eyebrow">ONEAPICHAT · AGENT WORKSPACE</div>' +
            '<div class="dsh-hero-brand">' +
                '<div class="dsh-whale-icon oac-orbit-mark" aria-hidden="true">' +
                    '<svg viewBox="0 0 42 42"><path class="oac-orbit-ring" d="M8.5 25.5c-3.3-7.4 1.4-15.9 9.7-17.4 7.9-1.4 15.2 4.5 15.3 12.4.1 7.2-5.8 13.1-13 13.1-2.2 0-4.3-.6-6.1-1.6L7 35l2.5-7.1c-.4-.8-.7-1.6-1-2.4Z"/><path class="oac-orbit-path" d="M14 23.5c3.2-5.9 10.7-8.4 17-5.2"/><circle cx="14" cy="23.5" r="2.3"/><circle cx="31" cy="18.3" r="2.3"/></svg>' +
                '</div>' +
                '<div class="oac-hero-copy">' +
                    '<div class="dsh-hero-title-row"><span class="dsh-hero-title">让想法在工作区里发生</span></div>' +
                    '<div class="oac-hero-subtitle">选择目录与执行模式，开始一次可落地的协作</div>' +
                '</div>' +
            '</div>' +
            '<div class="dsh-hero-capsules">' +
                '<button type="button" class="dsh-hero-capsule" onclick="window.WorkspaceManager && window.WorkspaceManager.toggleDropdown(event)">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>' +
                    '<span id="dshHeroWsName">' + curWs.name + '</span>' +
                    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
                '</button>' +
                '<button type="button" class="dsh-hero-capsule" onclick="window._toggleAgentModeMenu && window._toggleAgentModeMenu(event)">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>' +
                    '<span id="dshHeroModeName">' + (modeLabels[curMode] || 'Agent 模式') + '</span>' +
                    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
                '</button>' +
            '</div>' +
        '</div>';
        container.innerHTML = html;
        container.classList.add('agent-welcome-active');
        return;
    }

    container.classList.remove('agent-welcome-active');
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
    // 保护规则：任何包含多词、描述性文本、标题、来源（如 [Wikimedia Commons...] 或 [新闻报道]）的
    // 常规超链接坚决保留为可点击超链接，绝不强转为图片！只有纯图片占位 [图片](url) 且非网页 URL 才转换。
    markdownText = String(markdownText || '').replace(/(^|[^!])\[([^\]\n]{1,160})\]\((https?:\/\/[^)\s]+)\)/g, function(match, before, label, url) {
        var trimmedLabel = label.trim();
        var isPureImagePlaceholder = /^(?:图片|原图|image|photo)$/i.test(trimmedLabel);
        var isWebPage = /\/(wiki|item|detail|article|post|view|index)\//i.test(url) || /\.(html?|php|jsp|asp)(\?|$)/i.test(url);
        var imagePath = false;
        try { imagePath = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)(\?|$)/i.test(new URL(url).pathname); } catch(e) {}
        var imageUrl = /^http:\/\//i.test(url) ? url.replace(/^http:\/\//i, 'https://') : url;
        if (isPureImagePlaceholder && imagePath && !isWebPage) {
            return before + '![' + label + '](' + imageUrl + ')';
        }
        return match;
    });
    return markdownText.replace(/(^|\s)(https?:\/\/[^\s<>]+)($|\s)/g, (match, before, rawUrl, after) => {
        // Markdown 加粗结尾、中文标点等不是 URL 的组成部分，避免链接误吞 "**、。"。
        var suffix = '';
        var url = rawUrl;
        var suffixMatch = url.match(/(\*\*|__|[，。；：！？、）】》]+)$/u);
        if (suffixMatch) {
            suffix = suffixMatch[0];
            url = url.slice(0, -suffix.length);
        }
        if (/!\[.*?\]\(/.test(match) || /\[.*?\]\(/.test(match)) return match;
        try {
            var u = new URL(url);
            var isWebPage = /\/(wiki|item|detail|article|post|view|index)\//i.test(u.pathname) || /\.(html?|php|jsp|asp)(\?|$)/i.test(u.pathname);
            // ★ 必须是真实图片直链且非百科/文章网页，才渲染为图片
            if (!isWebPage && /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)(\?|$)/i.test(u.pathname)) {
                var imageUrl = /^http:\/\//i.test(url) ? url.replace(/^http:\/\//i, 'https://') : url;
                return before + `![image](${imageUrl})` + suffix + after;
            }
            let label = u.hostname;
            if (u.pathname && u.pathname !== '/') {
                label += u.pathname.slice(0, 20) + (u.pathname.length > 20 ? '...' : '');
            }
            return before + `[${label}](${url})` + suffix + after;
        } catch {
            return match;
        }
    });
}

// ★ 外部图片容错卡片与防盗链降级中枢
function _imageSourcePage(img, src) {
    if (!img) return '';
    var explicit = img.getAttribute('data-source-url') || '';
    if (explicit) return explicit;
    var scope = img.closest ? img.closest('p, li, blockquote, .markdown-body') : null;
    if (scope && scope.querySelectorAll) {
        var links = scope.querySelectorAll('a[href]');
        for (var i = 0; i < links.length; i++) {
            var href = links[i].href || links[i].getAttribute('href') || '';
            if (!href || href === src || /images\.weserv\.nl/i.test(href)) continue;
            if (/\/(wiki|item|detail|article|post|view|index)\//i.test(href) || /wiki\./i.test(href)) return href;
        }
    }
    return '';
}

function _knownImageSourcePage(src) {
    try {
        var u = new URL(src, location.href);
        // BWIKI patchwiki 直链经常失效/变更哈希；跳到对应 Wiki 首页至少稳定可访问，
        // 绝不能再让按钮指向已确认 404 的伪直链。
        if (/patchwiki\.biligame\.com$/i.test(u.hostname)) {
            var parts = u.pathname.split('/').filter(Boolean);
            var project = parts[1] || '';
            return project ? 'https://wiki.biligame.com/' + encodeURIComponent(project) + '/首页' : 'https://wiki.biligame.com/';
        }
        if (/upload\.wikimedia\.org$/i.test(u.hostname)) {
            var filename = decodeURIComponent(u.pathname.split('/').pop() || '').replace(/^\d+px-/, '');
            return filename ? 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(filename) : 'https://commons.wikimedia.org/';
        }
    } catch(e) {}
    return '';
}

function attachImageFallbacks(root) {
    if (!root || !root.querySelectorAll) return;
    var imgs = root.querySelectorAll ? root.querySelectorAll('.markdown-body img:not([data-img-fallback-bound])') : [];
    if (root.tagName === 'IMG' && !root.hasAttribute('data-img-fallback-bound')) imgs = [root];
    imgs.forEach(function(img) {
        img.setAttribute('data-img-fallback-bound', '1');
        if (!img.getAttribute('referrerpolicy')) img.setAttribute('referrerpolicy', 'no-referrer');
        if (!img.getAttribute('loading')) img.setAttribute('loading', 'lazy');
        var originalSrc = img.currentSrc || img.getAttribute('src') || '';
        var sourcePage = _imageSourcePage(img, originalSrc) || _knownImageSourcePage(originalSrc);
        if (sourcePage) img.setAttribute('data-source-url', sourcePage);
        img.addEventListener('error', function() {
            var src = this.currentSrc || this.getAttribute('src') || originalSrc;
            if (!src) return;
            // 第一次失败先尝试可靠的公共图片代理；代理失败后才展示来源页卡片。
            if (!this.dataset.proxyRetried && !/images\.weserv\.nl/i.test(src)) {
                this.dataset.proxyRetried = '1';
                this.setAttribute('src', 'https://images.weserv.nl/?url=' + encodeURIComponent(src));
                return;
            }
            if (this.dataset.fallbackApplied) return;
            this.dataset.fallbackApplied = '1';
            var alt = (this.getAttribute('alt') || '').trim();
            if (!alt || alt === 'image' || alt === '图片') {
                try { alt = decodeURIComponent(new URL(originalSrc || src, location.href).pathname.split('/').pop() || '查看图片来源'); }
                catch(e) { alt = '查看图片来源'; }
            }
            var target = this.getAttribute('data-source-url') || sourcePage || _knownImageSourcePage(originalSrc || src);
            var card;
            if (target) {
                card = document.createElement('a');
                card.href = target;
                card.target = '_blank';
                card.rel = 'noopener noreferrer';
                card.title = '图片直链不可用，点击打开可访问的来源页面：' + target;
            } else {
                card = document.createElement('div');
                card.title = '图片直链不可用，且未找到可靠来源页';
            }
            card.className = 'oac-external-image-card';
            card.innerHTML = '<span class="oac-img-icon">🖼️</span>' +
                '<span class="oac-img-info">' +
                    '<span class="oac-img-title">' + (escapeHtml(alt) || '外部图片') + '</span>' +
                    '<span class="oac-img-action">' + (target ? '图片直链已失效 · 点击打开来源页面 ↗' : '图片直链已失效 · 暂无可靠来源页面') + '</span>' +
                '</span>';
            if (this.parentNode) this.parentNode.replaceChild(card, this);
        });
    });
}
window.attachImageFallbacks = attachImageFallbacks;

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

/** 以图生图 — 下载参考图 → 加入 pendingFiles → 发送时自动附加 */
async function _useAsReference(meta) {
    if (!meta || !meta.url) return;
    try {
        if (typeof showToast === 'function') showToast('⏳ 正在加载参考图...');
        // ★ 下载参考图并转为 base64,加入 pendingFiles
        var _refUrl = meta.url;
        var _isDataUrl = _refUrl.startsWith('data:');
        var _content, _name = '参考图.png', _size = 0;

        if (_isDataUrl) {
            _content = _refUrl;
            _size = Math.round(atob(_refUrl.split(',')[1]).length * 0.75);
        } else {
            // HTTP(S) URL → 下载
            var _fetchFn = window.proxyFetch || fetch;
            var _resp = await _fetchFn(_refUrl);
            if (!_resp.ok) throw new Error('下载失败: ' + _resp.status);
            var _blob = await _resp.blob();
            _size = _blob.size;
            _name = _refUrl.split('/').pop().split('?')[0] || '参考图.png';
            _content = await new Promise(function(resolve, reject) {
                var fr = new FileReader();
                fr.onload = function() { resolve(fr.result); };
                fr.onerror = reject;
                fr.readAsDataURL(_blob);
            });
        }

        // ★ 加入 pendingFiles (与手动上传的图片同等待遇)
        var _fileObj = {
            name: _name,
            content: _content,
            serverUrl: _isDataUrl ? '' : _refUrl,
            isImage: true,
            type: _content.match(/^data:(image\/[\w+]+);/)?.[1] || 'image/png',
            size: _size,
            _isReferenceImage: true  // 标记为参考图
        };
        if (!window.pendingFiles) window.pendingFiles = [];
        // 清除旧的参考图(只保留一张)
        window.pendingFiles = window.pendingFiles.filter(function(f) { return !f._isReferenceImage; });
        window.pendingFiles.push(_fileObj);

        // ★ 更新 UI 显示
        if (typeof updateFilePreviewUI === 'function') updateFilePreviewUI();

        // 聚焦输入框并提示
        var input = document.getElementById('userInput') || document.querySelector('textarea[placeholder]');
        if (input) {
            input.focus();
            input.placeholder = '🎨 参考图已附加，描述你想要的变换后发送...';
            if (typeof input.scrollIntoView === 'function') {
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        if (typeof showToast === 'function') showToast('🎨 参考图已附加到输入区，输入描述后发送即可');
    } catch(e) {
        console.error('[useAsReference] 失败:', e);
        if (typeof showToast === 'function') showToast('❌ 加载参考图失败: ' + e.message);
    }
}

/** 创建变体 — 调用图生图 API (generateImageI2I) */
async function _regenerateImage(meta) {
    if (!meta || !meta.prompt) {
        if (typeof showToast === 'function') showToast('❌ 缺少提示词信息，无法重新生成');
        return;
    }
    try {
        if (typeof showToast === 'function') showToast('🔄 正在生成变体...');
        // ★ 拼接修改指令到提示词
        var _finalPrompt = meta.prompt;
        if (meta.instructions) {
            _finalPrompt = meta.prompt + '\n\n【修改要求】' + meta.instructions;
        }
        // ★ 使用图生图 API (传入参考图 URL)
        var _opts = {
            model: meta.model,
            aspect_ratio: meta.aspect_ratio,
            n: 1
        };
        var result = await window.generateImageI2I(_finalPrompt, meta.url, _opts);
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

// ★ 统一生成图片容器就地渲染函数 (供 appendMessage 及工具调用实时注入复用)
window.renderGeneratedImagesIntoBubble = function(bubble, images) {
    if (!bubble) return;
    var allImages = Array.isArray(images) ? images : (images ? [images] : []);
    if (typeof dedupeImageList === 'function') allImages = dedupeImageList(allImages);
    if (!allImages.length) return;

    var imgContainer = bubble.querySelector(':scope > .gen-image-container');
    if (!imgContainer) {
        imgContainer = document.createElement('div');
        imgContainer.className = 'gen-image-container';
        bubble.appendChild(imgContainer);
    }
    // 清理可能遗留的占位符
    var ph = bubble.querySelector('#image-placeholder');
    if (ph) ph.remove();

    allImages.forEach(function(imgData, idx) {
        var meta = getImageMeta(imgData);
        var cleanUrl = cleanImageUrl(meta.url);
        if (!cleanUrl) return;

        // DOM 级去重：若容器中已存在相同 src 的图片，则不重复插入
        var existingImgs = imgContainer.querySelectorAll('img.gen-image');
        for (var e = 0; e < existingImgs.length; e++) {
            if (existingImgs[e].src === cleanUrl || cleanImageUrl(existingImgs[e].src) === cleanUrl) {
                return;
            }
        }

        var wrapper = document.createElement('div');
        wrapper.className = 'gen-image-wrapper';
        var img = document.createElement('img');
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
            var retryCount = parseInt(this.dataset.retryCount || '0', 10);
            if (retryCount < 2 && cleanUrl && cleanUrl.indexOf('data:') !== 0) {
                this.dataset.retryCount = String(retryCount + 1);
                var retryUrl = cleanUrl + (cleanUrl.indexOf('?') === -1 ? '?' : '&') +
                    '_img_retry=' + Date.now();
                var self = this;
                setTimeout(function() { self.src = retryUrl; }, 800 * (retryCount + 1));
                return;
            }
            this.style.display = 'none';
            if (wrapper.querySelector('.gen-image-error')) return;
            var fallback = document.createElement('div');
            fallback.style.cssText = 'padding:10px;border-radius:8px;background:#fef3c7;border:1px solid #f59e0b;margin:4px 0;color:#92400e;font-size:0.75rem;text-align:center;';
            fallback.className = 'gen-image-error';
            fallback.textContent = '\u26a0\ufe0f \u56fe\u7247\u52a0\u8f7d\u5931\u8d25\uff0c\u70b9\u51fb\u91cd\u8bd5';
            fallback.style.cursor = 'pointer';
            fallback.onclick = function() {
                fallback.remove();
                img.style.display = '';
                img.dataset.retryCount = '0';
                img.src = cleanUrl + (cleanUrl.indexOf('?') === -1 ? '?' : '&') + '_img_retry=' + Date.now();
            };
            wrapper.appendChild(fallback);
        };
        wrapper.appendChild(img);
        // 悬停显示放大图标与操作栏
        var actionBar = document.createElement('div');
        actionBar.className = 'img-action-bar';
        // 下载按钮
        var dlBtn = document.createElement('button');
        dlBtn.className = 'img-action-btn';
        dlBtn.title = '\u4e0b\u8f7d\u56fe\u7247';
        dlBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        dlBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            _downloadImage(meta.url, 'generated_' + (idx + 1) + '.png');
        });
        actionBar.appendChild(dlBtn);
        // 复制按钮
        var copyBtn = document.createElement('button');
        copyBtn.className = 'img-action-btn';
        copyBtn.title = '\u590d\u5236\u5230\u526a\u8d34\u677f';
        copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        copyBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            _copyImageToClipboard(meta.url);
        });
        actionBar.appendChild(copyBtn);
        // 以图生图按钮
        var i2iBtn = document.createElement('button');
        i2iBtn.className = 'img-action-btn';
        i2iBtn.title = '\u4ee5\u56fe\u751f\u56fe';
        i2iBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
        i2iBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            _useAsReference(meta);
        });
        actionBar.appendChild(i2iBtn);
        // 重新生成按钮
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
};

// ★ 收集当前聊天所有生成图片
function collectChatImages(chatId) {
    var imgs = [];
    if (!chats[chatId] || !chats[chatId].messages) return imgs;
    chats[chatId].messages.forEach(function(msg) {
        if (msg.generatedImages && msg.generatedImages.length > 0) {
            msg.generatedImages.forEach(function(img) { imgs.push(img); });
        }
        if (msg.generatedImage) imgs.push(msg.generatedImage);
    });
    return typeof dedupeImageList === 'function' ? dedupeImageList(imgs) : imgs;
}

// ★ 画布模式 — Codex 风格：大图 + 缩略图条 + 指令修改
function showImageLightbox(images, startIdx) {
    var existing = document.querySelector('.img-lightbox');
    if (existing) existing.dispatchEvent(new Event('lightbox:close'));

    var _requestedImage = images && images[startIdx || 0];
    var _requestedKey = typeof getImageIdentityKey === 'function' ? getImageIdentityKey(_requestedImage) : getImageUrl(_requestedImage);
    images = typeof dedupeImageList === 'function' ? dedupeImageList(images) : (images || []);
    if (!images.length) return;
    var idx = images.findIndex(function(item) {
        return (typeof getImageIdentityKey === 'function' ? getImageIdentityKey(item) : getImageUrl(item)) === _requestedKey;
    });
    if (idx < 0) idx = 0;
    var scale = 1, minScale = 1, maxScale = 8;
    var renderedScale = 1, offsetX = 0, offsetY = 0, renderedOffsetX = 0, renderedOffsetY = 0;
    var isDragging = false, dragStartX = 0, dragStartY = 0, dragOriginX = 0, dragOriginY = 0;
    var dragPointerId = null, transformRaf = 0;
    var previousActive = document.activeElement;
    var previousOverflow = document.body.style.overflow;
    var closed = false;
    var filmstripMax = 8;
    var panelExpanded = true;
    var isSvgPreview = images.length === 1 && images[0] && typeof images[0] === 'object' && images[0].__svgMarkup;

    // ════ 主容器 — 柔和渐变背景 ════
    var overlay = document.createElement('div');
    overlay.className = 'img-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '图片画布');
    overlay.tabIndex = -1;
    // 颜色完全交给主题 CSS 变量，画布随亮暗模式和 DSH/经典/极简等主题同步。
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;';

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
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;cursor:default;will-change:transform;transform:translate3d(0,0,0) scale(1);box-shadow:0 20px 60px rgba(0,0,0,0.4);';
    img.draggable = false;
    img.addEventListener('dragstart', function(e) { e.preventDefault(); });
    imgArea.appendChild(img);
    var svgPreview = null;
    if (isSvgPreview) {
        img.style.display = 'none';
        svgPreview = document.createElement('div');
        svgPreview.className = 'canvas-svg-preview';
        svgPreview.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:auto;';
        imgArea.appendChild(svgPreview);
    }

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'canvas-nav-btn canvas-nav-next';
    nextBtn.setAttribute('aria-label', '下一张');
    nextBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><polyline points="9 6 15 12 9 18"/></svg>';
    nextBtn.addEventListener('click', function(e) { e.stopPropagation(); switchTo(idx + 1); });
    imgArea.appendChild(nextBtn);
    mainArea.appendChild(imgArea);

    // ★ 右侧信息面板 — 提示词/模型/比例/时间/备注
    var infoPanel = document.createElement('div');
    infoPanel.className = 'canvas-info-panel';

    var infoSection = function(title, content, opts) {
        opts = opts || {};
        var sec = document.createElement('div');
        sec.className = 'canvas-info-section' + (opts.cls ? ' ' + opts.cls : '');
        var label = document.createElement('div');
        label.className = 'canvas-info-label';
        label.textContent = title;
        sec.appendChild(label);
        var val = document.createElement(opts.editable ? 'textarea' : 'div');
        val.className = opts.editable ? 'canvas-info-textarea' : 'canvas-info-value';
        if (opts.editable) {
            val.rows = 3;
            val.placeholder = '添加备注...';
        }
        if (typeof content === 'string') val.textContent = content;
        else if (content) val.appendChild(content);
        sec.appendChild(val);
        return { section: sec, valueEl: val };
    };

    // 提示词
    var promptSection = infoSection('提示词', '');
    promptSection.section.classList.add('prompt-section');
    infoPanel.appendChild(promptSection.section);

    // 模型 + 比例 (同一行)
    var metaRow = document.createElement('div');
    metaRow.className = 'canvas-meta-row';
    var modelSection = infoSection('模型', '');
    var ratioSection = infoSection('比例', '');
    metaRow.appendChild(modelSection.section);
    metaRow.appendChild(ratioSection.section);
    infoPanel.appendChild(metaRow);

    // 时间
    var timeSection = infoSection('生成时间', '');
    infoPanel.appendChild(timeSection.section);

    // 备注 (可编辑)
    var notesSection = infoSection('备注', '', { editable: true, cls: 'notes-section' });
    infoPanel.appendChild(notesSection.section);

    // ★ 保存备注按钮
    var saveNotesBtn = document.createElement('button');
    saveNotesBtn.type = 'button';
    saveNotesBtn.className = 'canvas-save-notes-btn';
    saveNotesBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span>保存备注</span>';
    saveNotesBtn.addEventListener('click', function() {
        var _curMeta = getImageMeta(images[idx]);
        var _notes = notesSection.valueEl.value.trim();
        // 更新数据模型中的 notes
        if (typeof images[idx] === 'object') {
            images[idx].notes = _notes;
            // 同步到 chats 消息中
            if (currentChatId && chats[currentChatId]) {
                chats[currentChatId].messages.forEach(function(msg) {
                    if (msg.generatedImages) {
                        msg.generatedImages.forEach(function(gi) {
                            if (typeof gi === 'object' && gi.url === _curMeta.url) {
                                gi.notes = _notes;
                            }
                        });
                    }
                });
                slimSaveChats();
            }
        }
        saveNotesBtn.classList.add('saved');
        saveNotesBtn.querySelector('span').textContent = '已保存';
        setTimeout(function() {
            saveNotesBtn.classList.remove('saved');
            saveNotesBtn.querySelector('span').textContent = '保存备注';
        }, 1500);
    });
    infoPanel.appendChild(saveNotesBtn);

    // ★ 面板折叠按钮 (移动端)
    var panelToggle = document.createElement('button');
    panelToggle.type = 'button';
    panelToggle.className = 'canvas-panel-toggle';
    panelToggle.setAttribute('aria-label', '切换信息面板');
    panelToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>';
    panelToggle.addEventListener('click', function() {
        panelExpanded = !panelExpanded;
        infoPanel.classList.toggle('collapsed', !panelExpanded);
        panelToggle.classList.toggle('expanded', panelExpanded);
    });
    topBar.appendChild(panelToggle);

    mainArea.appendChild(infoPanel);
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



    // ════ 图片内悬浮控制坞 — 不再占据画布下半区 ════
    var bottomArea = document.createElement('div');
    bottomArea.className = 'canvas-bottom-area canvas-overlay-dock';

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
    if (isSvgPreview) filmstrip.style.display = 'none';
    // 挂载到图片承载区内部，以 absolute 悬浮，不参与主画布高度计算。
    imgArea.appendChild(bottomArea);

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

    // ════ 丝滑缩放与拖拽：连续缩放、鼠标位置锚定、Pointer Capture、边界约束 ════
    function getTransformTarget() { return isSvgPreview ? svgPreview : img; }

    function clampPan() {
        var target = getTransformTarget();
        if (!target || scale <= 1.001) { offsetX = 0; offsetY = 0; return; }
        var baseW = target.offsetWidth || imgArea.clientWidth;
        var baseH = target.offsetHeight || imgArea.clientHeight;
        var maxX = Math.max(0, (baseW * scale - imgArea.clientWidth) / 2);
        var maxY = Math.max(0, (baseH * scale - imgArea.clientHeight) / 2);
        offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
        offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
    }

    function updateZoomLabel() {
        var imageLabel = (idx + 1) + ' / ' + images.length + (images.length > 1 ? ' 张图片' : '');
        counter.textContent = imageLabel + (scale > 1.005 ? '  ·  ' + Math.round(scale * 100) + '%' : '');
    }

    function renderTransformFrame() {
        transformRaf = 0;
        var target = getTransformTarget();
        if (!target) return;
        var easing = isDragging ? 1 : 0.24;
        renderedScale += (scale - renderedScale) * easing;
        renderedOffsetX += (offsetX - renderedOffsetX) * easing;
        renderedOffsetY += (offsetY - renderedOffsetY) * easing;
        if (Math.abs(scale - renderedScale) < 0.001) renderedScale = scale;
        if (Math.abs(offsetX - renderedOffsetX) < 0.15) renderedOffsetX = offsetX;
        if (Math.abs(offsetY - renderedOffsetY) < 0.15) renderedOffsetY = offsetY;
        target.style.transform = 'translate3d(' + renderedOffsetX.toFixed(2) + 'px,' + renderedOffsetY.toFixed(2) + 'px,0) scale(' + renderedScale.toFixed(4) + ')';
        target.style.transformOrigin = 'center center';
        imgArea.classList.toggle('is-zoomed', renderedScale > 1.005);
        imgArea.classList.toggle('is-dragging', isDragging);
        target.style.cursor = isDragging ? 'grabbing' : (renderedScale > 1.005 ? 'grab' : 'zoom-in');
        updateZoomLabel();
        if (renderedScale !== scale || renderedOffsetX !== offsetX || renderedOffsetY !== offsetY) {
            transformRaf = requestAnimationFrame(renderTransformFrame);
        }
    }

    function applyTransform(immediate) {
        clampPan();
        if (immediate) {
            renderedScale = scale;
            renderedOffsetX = offsetX;
            renderedOffsetY = offsetY;
        }
        if (!transformRaf) transformRaf = requestAnimationFrame(renderTransformFrame);
    }

    function zoomAt(clientX, clientY, nextScale, immediate) {
        var rect = imgArea.getBoundingClientRect();
        var px = clientX - (rect.left + rect.width / 2);
        var py = clientY - (rect.top + rect.height / 2);
        var oldScale = scale;
        nextScale = Math.max(minScale, Math.min(maxScale, nextScale));
        if (Math.abs(nextScale - oldScale) < 0.0001) return;
        var ratio = nextScale / oldScale;
        offsetX = px - (px - offsetX) * ratio;
        offsetY = py - (py - offsetY) * ratio;
        scale = nextScale;
        if (scale <= 1.001) { scale = 1; offsetX = 0; offsetY = 0; }
        applyTransform(!!immediate);
    }

    function resetTransform(immediate) {
        scale = 1; offsetX = 0; offsetY = 0;
        applyTransform(!!immediate);
    }

    imgArea.addEventListener('wheel', function(e) {
        if (e.target.closest && e.target.closest('.canvas-overlay-dock, .canvas-nav-btn')) return;
        e.preventDefault(); e.stopPropagation();
        var delta = Math.max(-120, Math.min(120, e.deltaY));
        var factor = Math.exp(-delta * 0.0022);
        zoomAt(e.clientX, e.clientY, scale * factor, false);
    }, { passive: false });

    imgArea.addEventListener('pointerdown', function(e) {
        if (e.button !== 0 || scale <= 1.005) return;
        if (e.target.closest && e.target.closest('.canvas-overlay-dock, .canvas-nav-btn')) return;
        e.preventDefault();
        isDragging = true;
        dragPointerId = e.pointerId;
        dragStartX = e.clientX; dragStartY = e.clientY;
        dragOriginX = offsetX; dragOriginY = offsetY;
        try { imgArea.setPointerCapture(e.pointerId); } catch(_captureErr) {}
        applyTransform(true);
    });
    imgArea.addEventListener('pointermove', function(e) {
        if (!isDragging || e.pointerId !== dragPointerId) return;
        e.preventDefault();
        offsetX = dragOriginX + (e.clientX - dragStartX);
        offsetY = dragOriginY + (e.clientY - dragStartY);
        applyTransform(true);
    });
    function endPointerDrag(e) {
        if (!isDragging || (e && e.pointerId !== dragPointerId)) return;
        isDragging = false;
        if (e) { try { imgArea.releasePointerCapture(e.pointerId); } catch(_releaseErr) {} }
        dragPointerId = null;
        applyTransform(true);
    }
    imgArea.addEventListener('pointerup', endPointerDrag);
    imgArea.addEventListener('pointercancel', endPointerDrag);
    imgArea.addEventListener('lostpointercapture', function() { if (isDragging) endPointerDrag(); });

    imgArea.addEventListener('dblclick', function(e) {
        if (e.target.closest && e.target.closest('.canvas-overlay-dock, .canvas-nav-btn')) return;
        e.preventDefault();
        if (scale > 1.05) resetTransform(false);
        else zoomAt(e.clientX, e.clientY, 2, false);
    });

    // ★ 未放大时保留单指横滑切图；放大后 Pointer Events 接管拖拽。
    var touchStartX = 0, touchStartY = 0, touchMoved = false;
    imgArea.addEventListener('touchstart', function(e) {
        if (scale > 1.005 || e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchMoved = false;
    }, { passive: true });
    imgArea.addEventListener('touchmove', function(e) {
        if (scale > 1.005 || e.touches.length !== 1) return;
        var dx = Math.abs(e.touches[0].clientX - touchStartX);
        var dy = Math.abs(e.touches[0].clientY - touchStartY);
        if (dx > 10 && dx > dy) touchMoved = true;
    }, { passive: true });
    imgArea.addEventListener('touchend', function(e) {
        if (scale > 1.005 || !touchMoved || images.length < 2) return;
        var endX = e.changedTouches[0].clientX;
        var diff = endX - touchStartX;
        if (Math.abs(diff) > 50) switchTo(diff < 0 ? idx + 1 : idx - 1);
    }, { passive: true });

    function switchTo(ni) {
        idx = (ni + images.length) % images.length;
        updateView();
    }

    function updateView() {
        scale = 1; renderedScale = 1; offsetX = 0; offsetY = 0; renderedOffsetX = 0; renderedOffsetY = 0;
        var m = getImageMeta(images[idx]);
        if (isSvgPreview) {
            svgPreview.innerHTML = images[idx].__svgMarkup || '';
            var svgNode = svgPreview.querySelector('svg');
            if (svgNode) {
                svgNode.style.display = 'block';
                svgNode.style.maxWidth = '100%';
                svgNode.style.maxHeight = '100%';
                svgNode.style.width = 'auto';
                svgNode.style.height = 'auto';
            }
            img.style.display = 'none';
        } else {
            img.style.display = '';
            img.src = cleanImageUrl(m.url);
        }
        img.alt = (idx + 1) + ' / ' + images.length;
        counter.textContent = (idx + 1) + ' / ' + images.length + (images.length > 1 ? ' 张图片' : '');
        download.href = cleanImageUrl(m.url);
        download.download = isSvgPreview ? 'mermaid-diagram.svg' : 'image_' + (idx + 1) + '.png';
        // 清除浮层内容
        editPromptDisplay.textContent = '';
        editTextarea.value = '';
        // ★ 填充信息面板数据
        if (promptSection && promptSection.valueEl) promptSection.valueEl.textContent = m.prompt || '(无提示词)';
        if (modelSection && modelSection.valueEl) modelSection.valueEl.textContent = m.model || '—';
        if (ratioSection && ratioSection.valueEl) ratioSection.valueEl.textContent = m.aspect_ratio || '1:1';
        if (timeSection && timeSection.valueEl) {
            if (m.timestamp) {
                var _d = new Date(m.timestamp);
                timeSection.valueEl.textContent = _d.toLocaleDateString('zh-CN') + ' ' + _d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            } else {
                timeSection.valueEl.textContent = '—';
            }
        }
        if (notesSection && notesSection.valueEl) notesSection.valueEl.value = m.notes || '';
        applyTransform();
        renderFilmstrip();
    }

    function closeLightbox() {
        if (closed) return;
        closed = true;
        if (transformRaf) { cancelAnimationFrame(transformRaf); transformRaf = 0; }
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
        if (e.key === '+' || e.key === '=') { var _zr = imgArea.getBoundingClientRect(); zoomAt(_zr.left + _zr.width / 2, _zr.top + _zr.height / 2, scale * 1.2, false); }
        if (e.key === '-') { var _zr2 = imgArea.getBoundingClientRect(); zoomAt(_zr2.left + _zr2.width / 2, _zr2.top + _zr2.height / 2, scale / 1.2, false); }
        if (e.key === '0') resetTransform(false);
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

    var summary = '';
    if (args && typeof args === 'object') {
        if (args.command) summary = args.command;
        else if (args.file_path || args.path) summary = args.file_path || args.path;
        else if (args.query || args.keywords || args.q) summary = args.query || args.keywords || args.q;
        else if (args.url) summary = args.url;
        else summary = JSON.stringify(args).substring(0, 70);
    } else {
        summary = String(args || '').substring(0, 70);
    }

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
        '<span class="tool-call-card-icon" style="color:' + statusColor + ';display:flex;align-items:center;">' + iconHtml + '</span>' +
        '<span style="font-weight:700;font-size:12px;flex-shrink:0;color:#60a5fa;"># ' + escapeHtml(toolName) + '</span>' +
        (summary ? '<span style="font-size:11px;opacity:0.85;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">· ' + escapeHtml(summary) + '</span>' : '<span style="flex:1;"></span>') +
        (durationStr ? '<span style="font-size:10px;opacity:0.6;flex-shrink:0;">' + durationStr + '</span>' : '') +
        '<span style="font-size:10px;color:' + statusColor + ';flex-shrink:0;font-weight:600;padding:1px 6px;border-radius:4px;background:rgba(' + (isError ? '239,68,68' : '16,185,129') + ',0.15);">' + statusText + '</span>' +
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

    // ★ 欢迎页淡出过渡：普通欢迎页与 Agent Workspace Hero 共用同一退出路径。
    // 先移除 Agent 空态标记，避免首条消息插入后容器仍按欢迎页布局居中。
    var welcome = container.querySelector(':scope > .welcome-container, :scope > .dsh-welcome-hero[data-agent-welcome="true"]');
    if (welcome) {
        container.classList.remove('agent-welcome-active');
        welcome.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
        welcome.style.opacity = '0';
        welcome.style.transform = 'translateY(-6px) scale(0.98)';
        setTimeout(function() { welcome.remove(); }, 220);
    }

    var row = document.createElement('div');
    row.className = `message-row ${role}`;
    if (msgIndex >= 0 && currentChatId && chats[currentChatId] && chats[currentChatId].messages) {
        var _rowMessage = chats[currentChatId].messages[msgIndex];
        if (_rowMessage && _rowMessage.id) row.dataset.messageId = String(_rowMessage.id);
    }

    var avatar = document.createElement('div');
    avatar.className = `avatar ${role}`;
    if (role === 'user') {
        avatar.textContent = '我';
    } else {
        var avatarImg = document.createElement('img');
        avatarImg.className = 'avatar-remi-gif remi-character-asset mood-idle';
        avatarImg.src = './src/remi-official/02.gif';
        avatarImg.alt = '蕾米埃尔';
        avatarImg.title = '蕾米 · 待机中';
        avatarImg.draggable = false;
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
        var summaryText = '推理过程';
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

    // Partial/resumed assistants use the same CSS typing state as newly-created bubbles.
    // A separate msg-loading-indicator DOM node used to render a second, heavier row of
    // three dots after refresh while ResumeStream also restored the typing class.
    if (partial && role === 'assistant') {
        bubble.classList.add('typing');
    }

    // 如果有生成的图片,显示在内容下方
    var allImages = generatedImages || (generatedImage ? [generatedImage] : []);
    if (generatedImage) allImages = allImages.concat([generatedImage]);
    if (typeof dedupeImageList === 'function') allImages = dedupeImageList(allImages);
    if (allImages.length > 0) {
        window.renderGeneratedImagesIntoBubble(bubble, allImages);
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

    // 操作按钮 — 采用紧随消息内容的幽灵工具条
    var actions = document.createElement('div');
    actions.className = 'msg-actions ' + (role === 'user' ? 'user-actions' : 'assistant-actions');

    // 复制按钮(构建逻辑抽到 _buildCopyButton, 供流结束就地收尾复用)
    actions.appendChild(_buildCopyButton(bubble, text));

    if (role === 'user') {
        // 编辑按钮 — 所有用户消息都显示
        var editBtn = document.createElement('div');
        editBtn.className = 'msg-action-btn edit-btn';
        editBtn.setAttribute('title', '编辑此条消息并重新发送');
        editBtn.setAttribute('aria-label', '编辑');
        editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L7 21H3v-4L17 3z"/><path d="M15 5l4 4"/></svg>';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            var msgs = chats[currentChatId].messages;
            var idx = msgs.findIndex(m => m.role === 'user' && m.text === text && JSON.stringify(m.files) === JSON.stringify(files));
            if (idx === -1) return;
            var sys = msgs.filter(m => m.role === 'system' && !m.temporary && !m.timestamp);
            var timestamp = msgs.find(m => m.timestamp);
            var others = msgs.slice(0, idx).filter(m => m.role !== 'system' || m.temporary || m.timestamp);
            var remaining = [...sys, ...others, ...(timestamp ? [timestamp] : [])];
            if (typeof window.truncateChatMessages === 'function') {
                window.truncateChatMessages(currentChatId, remaining);
            } else {
                chats[currentChatId].messages = remaining;
                saveChatsDebounced();
                loadChat(currentChatId);
            }
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

    // ★ 底部统计已移至独立使用统计模块，气泡内不再渲染单次耗时与 token 统计
    row.appendChild(avatar);
    row.appendChild(wrapper);
    // ★ 淡入动画(历史加载大量消息时用 _suppressRowAnim 抑制, 避免数百次过渡卡顿)
    container.appendChild(row);
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
    attachImageFallbacks(row);

    return bubble;
}

// ==================== 消息操作按钮/页脚构建(appendMessage 与流结束就地收尾共用) ====================

// ★ 复制按钮 (带优雅 Check 对勾与 Tooltip 反馈)
function _buildCopyButton(bubble, text) {
    var copyBtn = document.createElement('div');
    copyBtn.className = 'msg-action-btn copy-msg-btn';
    copyBtn.setAttribute('title', '复制内容');
    copyBtn.setAttribute('aria-label', '复制内容');
    var copySvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    var checkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    copyBtn.innerHTML = copySvg;
    copyBtn.onclick = (e) => {
        e.stopPropagation();
        // ★ 动态读取气泡当前文本,而非闭包里初始的 text 变量
        var _bubbleText = bubble.querySelector('.markdown-body')?.textContent || bubble.textContent || text;
        copyMessageContent(_bubbleText);
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = checkSvg;
        copyBtn.setAttribute('title', '已复制');
        setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.innerHTML = copySvg;
            copyBtn.setAttribute('title', '复制内容');
        }, 1500);
    };
    return copyBtn;
}

// ★ assistant 消息的 重新生成/继续生成/还原 按钮(基于位置判断最后一条, 不用 content 匹配)
function _buildAssistantActionButtons(bubble, text, msgIndex) {
    var frag = document.createDocumentFragment();
    var _msgsArr = chats[currentChatId]?.messages || [];
    var _isLastAsst = false;
    if (msgIndex >= 0 && _msgsArr[msgIndex] && _msgsArr[msgIndex].role === 'assistant') {
        var _hasAsstAfter = false;
        for (var _ai = msgIndex + 1; _ai < _msgsArr.length; _ai++) {
            if (_msgsArr[_ai].role === 'assistant' && !_msgsArr[_ai].partial) {
                _hasAsstAfter = true; break;
            }
        }
        _isLastAsst = !_hasAsstAfter;
    } else {
        // msgIndex 缺省时默认视作最新助手消息
        _isLastAsst = true;
    }

    // ★ 重新生成按钮 (所有助手回复均支持重新生成，精准定位到该轮之前)
    var regenBtn = document.createElement('div');
    regenBtn.className = 'msg-action-btn regenerate-btn';
    regenBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
    regenBtn.setAttribute('title', '重新生成回复');
    regenBtn.setAttribute('aria-label', '重新生成回复');
    regenBtn.onclick = async (e) => {
        e.stopPropagation();
        var msgs = chats[currentChatId].messages;
        var idx = msgIndex;
        if (idx < 0 || idx >= msgs.length || msgs[idx].role !== 'assistant') {
            idx = msgs.findIndex(m => m.role === 'assistant' && (m.content === text || (text && m.content && m.content.indexOf(text.substring(0, 30)) === 0)));
        }
        if (idx === -1) idx = msgs.length - 1;
        if (idx < 0) return;
        var sys = msgs.filter(m => m.role === 'system' && !m.temporary && !m.timestamp);
        var timestamp = msgs.find(m => m.timestamp);
        var others = msgs.slice(0, idx).filter(m => m.role !== 'system' || m.temporary || m.timestamp);
        var lastUser = msgs.slice(0, idx).filter(m => m.role === 'user').pop();
        var remaining = [...sys, ...others, ...(timestamp ? [timestamp] : [])];
        if (typeof window.truncateChatMessages === 'function') {
            window.truncateChatMessages(currentChatId, remaining);
        } else {
            chats[currentChatId].messages = remaining;
            saveChatsDebounced();
            loadChat(currentChatId);
        }
        if (lastUser) await sendMessage(true, lastUser.text, lastUser.files);
    };
    frag.appendChild(regenBtn);

    if (_isLastAsst) {
        // ★ 最新一条额外附带 "继续生成" 按钮
        var continueBtn = document.createElement('div');
        continueBtn.className = 'msg-action-btn continue-btn';
        continueBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/><line x1="12" y1="15" x2="12" y2="21"/></svg>';
        continueBtn.setAttribute('title', '继续展开详述');
        continueBtn.setAttribute('aria-label', '继续展开详述');
        continueBtn.onclick = async (e) => {
            e.stopPropagation();
            if (typeof window.sendMessage === 'function') {
                await window.sendMessage(true, '请继续展开，提供更详细、更全面的回答。');
            }
        };
        frag.appendChild(continueBtn);
    } else {
        // ★ 历史回复附带 "还原/分支到此处" 按钮
        var restoreBtn = document.createElement('div');
        restoreBtn.className = 'msg-action-btn restore-btn';
        restoreBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/><line x1="9" y1="12" x2="21" y2="12"/><path d="M3 12a9 9 0 0 1 9-9"/></svg>';
        restoreBtn.setAttribute('title', '从此回复回退重试（丢弃后续）');
        restoreBtn.setAttribute('aria-label', '从此回复回退重试');
        restoreBtn.onclick = async (e) => {
            e.stopPropagation();
            if (!confirm('还原对话到此位置？\n\n此操作将删除该回复之后的所有对话内容，不可撤销。')) return;
            var msgs = chats[currentChatId].messages;
            var idx = msgIndex;
            if (idx < 0 || idx >= msgs.length) {
                idx = msgs.findIndex(m => m.role === 'assistant' && m.content === text);
            }
            if (idx === -1) return;
            var remaining = msgs.slice(0, idx + 1);
            if (typeof window.truncateChatMessages === 'function') {
                window.truncateChatMessages(currentChatId, remaining);
            } else {
                chats[currentChatId].messages = remaining;
                saveChatsDebounced();
                loadChat(currentChatId);
            }
        };
        frag.appendChild(restoreBtn);
    }
    return frag.children.length ? frag : null;
}

// ★ 构建消息页脚 HTML: 统计已解耦移至独立使用统计模块，气泡内保留空返回
function _buildMsgFooterHtml(usage, time) {
    return '';
}

// ★ 流结束就地收尾: 给已存在的气泡补操作按钮
//   (替代 finally 里的 loadChat 全量重建 — 免重建后页面不再跳变)
window.finalizeBubbleUI = function(bubble, text, msgIndex, usage, time) {
    if (!bubble) return;
    var _remiLoader = bubble.querySelector('.remi-typing-indicator');
    if (_remiLoader) _remiLoader.remove();
    bubble.classList.remove('typing', 'gen-active', 'streaming');
    // 明确投递完成事件，避免仅依靠 MutationObserver 时序导致蕾米停留在奋笔疾书。
    if (typeof window.remiReact === 'function') window.remiReact('turn/completed', { source: 'finalizeBubbleUI' });
    var wrapper = bubble.closest('.message-content-wrapper');
    if (!wrapper) return;
    // 操作按钮: 已存在则只补 assistant 专属按钮(重新生成/继续/还原)
    var actions = wrapper.querySelector('.msg-actions');
    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'msg-actions assistant-actions';
        actions.appendChild(_buildCopyButton(bubble, text));
        wrapper.appendChild(actions);
    }
    if (!actions.querySelector('.regenerate-btn, .continue-btn, .restore-btn')) {
        var asstBtns = _buildAssistantActionButtons(bubble, text, msgIndex);
        if (asstBtns) actions.appendChild(asstBtns);
    }
    // 确保移除气泡内任何历史 message-footer 元素
    var oldFooter = bubble.querySelector('.message-footer');
    if (oldFooter) oldFooter.remove();
    attachImageFallbacks(bubble);

    // ★ 异步记录到独立使用统计看板
    if (usage && typeof window.recordUsageStats === 'function') {
        try {
            var _curEffort = localStorage.getItem('thinkingIntensity') || '';
            var _curM = (typeof currentModel !== 'undefined' ? currentModel : '');
            if (!_curEffort && _curM) {
                var _mMatch = _curM.match(/-(off|minimal|low|medium|high|xhigh|max)$/i);
                if (_mMatch) _curEffort = _mMatch[1].toLowerCase();
            }
            window.recordUsageStats({
                usage: usage,
                durationMs: time,
                textLength: (text || '').length,
                chatId: (typeof currentChatId !== 'undefined' ? currentChatId : ''),
                model: _curM,
                provider: (typeof baseUrlProvider !== 'undefined' ? baseUrlProvider : 'custom'),
                effort: _curEffort || '未记录'
            });
        } catch (e) {
            console.warn('[UsageStats] recordUsageStats in finalizeBubbleUI warning:', e);
        }
    }
};

// ★ HTML 代码实时预览弹窗 (Sandbox iframe)
window.showHtmlPreviewModal = function(rawCode) {
    if (!rawCode) return;
    var overlay = document.createElement('div');
    overlay.className = 'html-preview-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(15,23,42,0.65);backdrop-filter:blur(6px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;animation:fadeIn 0.2s ease;';

    var card = document.createElement('div');
    card.className = 'html-preview-card';
    card.style.cssText = 'background:var(--bg-primary,#ffffff);border:1px solid rgba(255,255,255,0.15);box-shadow:0 20px 40px rgba(0,0,0,0.3);border-radius:14px;width:92%;max-width:960px;height:84vh;display:flex;flex-direction:column;overflow:hidden;';

    var header = document.createElement('div');
    header.style.cssText = 'padding:10px 16px;background:var(--bg-secondary,#f8fafc);border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;user-select:none;';
    header.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;color:#334155;">' +
        '<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:#10b981;color:#fff;border-radius:4px;font-size:11px;">▶</span>' +
        '<span>HTML 实时运行预览 (安全沙箱)</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
        '<button class="html-preview-newtab" style="padding:4px 10px;font-size:12px;background:#e2e8f0;border:none;border-radius:6px;cursor:pointer;color:#334155;transition:background 0.2s;">新标签打开</button>' +
        '<button class="html-preview-close" style="padding:4px 8px;font-size:16px;background:transparent;border:none;cursor:pointer;color:#64748b;line-height:1;border-radius:4px;">✕</button>' +
        '</div>';

    var iframe = document.createElement('iframe');
    iframe.style.cssText = 'flex:1;width:100%;border:none;background:#ffffff;';
    iframe.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms allow-same-origin');
    
    // 注入 HTML 内容
    iframe.srcdoc = rawCode;

    card.appendChild(header);
    card.appendChild(iframe);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var closeBtn = header.querySelector('.html-preview-close');
    closeBtn.onclick = function() { overlay.remove(); };
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var newtabBtn = header.querySelector('.html-preview-newtab');
    newtabBtn.onclick = function() {
        try {
            var blob = new Blob([rawCode], { type: 'text/html;charset=utf-8' });
            var blobUrl = URL.createObjectURL(blob);
            var w = window.open(blobUrl, '_blank');
            if (!w) {
                var win = window.open('', '_blank');
                if (win) { win.document.write(rawCode); win.document.close(); }
            }
        } catch(err) {
            var win2 = window.open('', '_blank');
            if (win2) { win2.document.write(rawCode); win2.document.close(); }
        }
    };

    var escHandler = function(e) {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
};

function attachCodeCopyButtons(container) {
    if (!container) return;
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.code-actions')) return;
        var code = (pre.querySelector('code') ? pre.querySelector('code').textContent : pre.innerText).trim();
        var isHtml = /^(<!DOCTYPE|<html|<HTML|<svg[\s>])/i.test(code) || (code.indexOf('<') >= 0 && code.indexOf('>') >= 0 && (code.indexOf('style') >= 0 || code.indexOf('script') >= 0 || code.indexOf('div') >= 0 || code.indexOf('body') >= 0 || code.indexOf('h1') >= 0 || code.indexOf('p>') >= 0));

        var actions = document.createElement('div');
        actions.className = 'code-actions';

        if (isHtml) {
            var runBtn = document.createElement('div');
            runBtn.className = 'code-run-btn';
            runBtn.setAttribute('title', '运行/预览此HTML');
            runBtn.setAttribute('aria-label', '运行/预览此HTML');
            runBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
            runBtn.onclick = function(e) {
                e.stopPropagation();
                if (typeof window.showHtmlPreviewModal === 'function') {
                    window.showHtmlPreviewModal(code);
                } else {
                    try { var win = window.open('', '_blank'); win.document.write(code); win.document.close(); }
                    catch(err) { alert('无法打开新窗口'); }
                }
            };
            actions.appendChild(runBtn);
        }

        var copyBtn = document.createElement('div');
        copyBtn.className = 'code-copy-btn';
        copyBtn.setAttribute('title', '复制代码');
        copyBtn.setAttribute('aria-label', '复制代码');
        var copySvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        var checkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        copyBtn.innerHTML = copySvg;
        copyBtn.onclick = function(e) {
            e.stopPropagation();
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(code).catch(() => {});
            } else {
                try {
                    var ta = document.createElement('textarea');
                    ta.value = code;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                } catch(e) {}
            }
            copyBtn.classList.add('copied');
            copyBtn.innerHTML = checkSvg;
            copyBtn.setAttribute('title', '已复制');
            setTimeout(function() {
                copyBtn.classList.remove('copied');
                copyBtn.innerHTML = copySvg;
                copyBtn.setAttribute('title', '复制代码');
            }, 1500);
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
                if (block.children && block.children.length) block.textContent = block.textContent || '';
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
