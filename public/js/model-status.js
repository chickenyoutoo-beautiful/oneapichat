// model-status.js — 蕾米状态 GIF 控制器
// 把 Cloudreve 分享的 Q 版蕾米动画嵌入到界面，用来表示模型/Agent 的状态：
//   待机  idle.gif        = 动画A-待机
//   思考  thinking.gif    = 动画B
//   满意  satisfied.gif   = 动画C
//   创作  creating.gif    = 动画D（奋笔疾书）
//   难题  stuck.gif       = 动画E
//   完成  done.gif        = 动画A-胜利（另备 done-alt.gif = 动画D-胜利）
(function () {
    if (window.__remiStatusLoaded) return;
    window.__remiStatusLoaded = true;

    var GIFS = {
        idle: './src/remi/idle.gif',
        thinking: './src/remi/thinking.gif',
        satisfied: './src/remi/satisfied.gif',
        creating: './src/remi/creating.gif',
        stuck: './src/remi/stuck.gif',
        done: './src/remi/done.gif',
        doneAlt: './src/remi/done-alt.gif'
    };
    var LABELS = {
        idle: '蕾米 · 待机中',
        thinking: '蕾米 · 思考中',
        satisfied: '蕾米 · 搞定啦',
        creating: '蕾米 · 奋笔疾书中',
        stuck: '蕾米 · 遇到难题了',
        done: '蕾米 · 完成！',
        doneAlt: '蕾米 · 完成！'
    };

    var currentMood = 'idle';
    var moodSeq = 0;
    var moodTimer = null;
    var activeBubble = null;
    var lastAvatarRow = null;

    function moodFromText(text) {
        if (!text) return null;
        if (/(失败|错误|❌|出错|异常|无法|不可用)/.test(text)) return 'stuck';
        if (/(完成|成功|✅|已生成|已保存|已创建|✓)/.test(text)) return 'done';
        if (/(生成|创作|图生图|绘图|绘制|制作|写|生成中|生成图片)/.test(text)) return 'creating';
        if (/(思考|分析|判断|搜索|推理|读取|规划|理解|检索|抓取|工具调用|深度思考)/.test(text)) return 'thinking';
        return null;
    }

    function applyMood(mood) {
        var tg = document.getElementById('thinkingGif');
        if (tg && GIFS[mood] && mood !== 'idle') {
            if (tg.getAttribute('src') !== GIFS[mood]) {
                tg.setAttribute('src', GIFS[mood]);
            }
        }
        var titleSpan = document.querySelector('#thinkingIndicator .thinking-title span');
        if (titleSpan) {
            var titleMap = {
                idle: '待机中',
                thinking: '思考中',
                satisfied: '搞定啦',
                creating: '创作中',
                stuck: '遇到难题',
                done: '完成！',
                doneAlt: '完成！'
            };
            titleSpan.textContent = titleMap[mood] || '思考中';
        }
        var avatarImg = null;
        if (activeBubble) {
            var row = activeBubble.closest ? activeBubble.closest('.message-row') : null;
            avatarImg = row ? row.querySelector('.avatar.assistant img') : null;
            if (avatarImg) {
                if (avatarImg.getAttribute('src') !== GIFS[mood]) {
                    avatarImg.setAttribute('src', GIFS[mood]);
                }
                avatarImg.setAttribute('title', LABELS[mood] || LABELS.idle);
            }
        }
        // ★ 放大小窗同步: 小窗打开期间跟随头像表情变化
        if (document.body.classList.contains('remi-zoom-open')) {
            var zoomImg = document.getElementById('remi-zoom-img');
            if (zoomImg && avatarImg) zoomImg.setAttribute('src', avatarImg.getAttribute('src'));
            var zoomTitle = document.getElementById('remi-zoom-title');
            if (zoomTitle && LABELS[mood]) zoomTitle.textContent = LABELS[mood];
        }
    }

    function setMood(mood, source, stickyMs) {
        if (!GIFS[mood]) return;
        if (mood === currentMood && source !== 'force') return;
        currentMood = mood;
        moodSeq++;
        applyMood(mood);
        if (moodTimer) { clearTimeout(moodTimer); moodTimer = null; }
        if (stickyMs) {
            var mySeq = moodSeq;
            moodTimer = setTimeout(function () {
                if (moodSeq === mySeq) {
                    setMood('idle', 'timer', 0);
                    activeBubble = null;
                }
            }, stickyMs);
        }
    }

    // 工具状态行装饰：左侧蕾米 GIF + 右侧文字
    function decorateStatus(el) {
        if (!el || !el.classList || !el.classList.contains('search-status')) return;
        var textSpan = el.querySelector('span.remi-status-text');
        var raw = textSpan ? (textSpan.textContent || '') : (el.textContent || '');
        if (raw === (el.dataset.remiText || '') && el.querySelector('img.remi-status-gif')) return;

        var mood = moodFromText(raw) || 'thinking';
        el.dataset.remiText = raw;
        el.textContent = '';

        var img = document.createElement('img');
        img.className = 'remi-status-gif';
        img.setAttribute('src', GIFS[mood]);
        img.setAttribute('alt', '蕾米');
        img.setAttribute('title', LABELS[mood] || LABELS.idle);

        var span = document.createElement('span');
        span.className = 'remi-status-text';
        span.textContent = raw;

        el.appendChild(img);
        el.appendChild(span);
        var thinkInd = document.getElementById('thinkingIndicator');
        if (inActiveBubble(el) || (thinkInd && thinkInd.classList.contains('active'))) {
            setMood(mood, 'status');
        }
    }

    function bubbleIsActive(bubble) {
        return bubble.classList.contains('typing') || bubble.classList.contains('gen-active');
    }

    function inActiveBubble(el) {
        var b = el && el.closest ? el.closest('.bubble.assistant') : null;
        return !!(b && bubbleIsActive(b));
    }

    // 正文文本（排除工具状态行，避免“搜索中”被当成正文输出）
    function mdBodyText(md) {
        if (!md) return '';
        var text = '';
        var nodes = md.childNodes;
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n.nodeType === 3) {
                text += n.textContent;
            } else if (n.nodeType === 1 && n.classList && !n.classList.contains('search-status')) {
                text += n.textContent;
            }
        }
        return text;
    }

    function finalizeBubble(bubble) {
        var md = bubble.querySelector('.markdown-body');
        var status = bubble.querySelector('.search-status');
        var text = mdBodyText(md) + ' ' + ((status && status.textContent) || '');
        if (/(失败|错误|❌|出错|异常|无法)/.test(text)) {
            setMood('stuck', 'bubble-final', 6000);
        } else if (text && text.trim().length > 0) {
            setMood('done', 'bubble-final', 6000);
        } else {
            setMood('idle', 'bubble-final', 0);
            activeBubble = null;
        }
    }

    // 只有最新一条 AI 气泡显示蕾米头像，历史消息隐藏
    function updateAvatarVisibility() {
        if (!container) return;
        var rows = container.querySelectorAll('.message-row.assistant');
        var candidates = [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (r.classList.contains('tool-call-row')) continue;
            if (!r.querySelector('.avatar.assistant img')) continue;
            candidates.push(r);
        }
        if (lastAvatarRow && !document.body.contains(lastAvatarRow)) lastAvatarRow = null;
        var newLast = candidates.length ? candidates[candidates.length - 1] : null;
        for (var k = 0; k < candidates.length; k++) {
            var avatar = candidates[k].querySelector('.avatar.assistant');
            if (!avatar) continue;
            var isLast = candidates[k] === newLast;
            if (isLast) {
                avatar.classList.remove('remi-avatar-hide');
                if (lastAvatarRow !== newLast) {
                    avatar.classList.remove('remi-avatar-leave');
                    avatar.classList.add('remi-avatar-enter');
                    if (avatar._remiEnterTimer) clearTimeout(avatar._remiEnterTimer);
                    avatar._remiEnterTimer = setTimeout(function (a) {
                        a.classList.remove('remi-avatar-enter');
                    }, 420, avatar);
                } else {
                    avatar.classList.remove('remi-avatar-enter');
                }
            } else if (lastAvatarRow && candidates[k] === lastAvatarRow && lastAvatarRow !== newLast) {
                // 旧的最新气泡：先缩入屏幕，动画结束再隐藏
                avatar.classList.remove('remi-avatar-enter');
                avatar.classList.add('remi-avatar-leave');
                if (avatar._remiLeaveTimer) clearTimeout(avatar._remiLeaveTimer);
                avatar._remiLeaveTimer = setTimeout(function (a) {
                    a.classList.remove('remi-avatar-leave');
                    a.classList.add('remi-avatar-hide');
                }, 360, avatar);
            } else {
                avatar.classList.remove('remi-avatar-enter');
                avatar.classList.remove('remi-avatar-leave');
                avatar.classList.add('remi-avatar-hide');
            }
        }
        lastAvatarRow = newLast;
    }

    var container = document.getElementById('chatBox') || document.getElementById('chatMessagesContainer');
    if (!container) return;

    // 1) 监听状态行/新气泡
    var childObserver = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if (m.type !== 'childList') continue;
            if (m.target && m.target.classList && m.target.classList.contains('search-status')) {
                decorateStatus(m.target);
            }
            for (var j = 0; j < (m.addedNodes || []).length; j++) {
                var node = m.addedNodes[j];
                if (node.nodeType !== 1) continue;
                if (node.classList && node.classList.contains('search-status')) {
                    decorateStatus(node);
                }
                if (node.classList && node.classList.contains('bubble') && node.classList.contains('assistant') && bubbleIsActive(node)) {
                    activeBubble = node;
                    setMood('thinking', 'bubble-start');
                    node.dataset.remiWasActive = '1';
                }
                var innerStatus = node.querySelector ? node.querySelector('.search-status') : null;
                if (innerStatus) decorateStatus(innerStatus);
            }
            for (var k = 0; k < (m.removedNodes || []).length; k++) {
                var removed = m.removedNodes[k];
                if (removed.nodeType === 1 && removed.classList && removed.classList.contains('bubble') && removed.classList.contains('assistant') && removed.dataset && removed.dataset.remiWasActive === '1') {
                    if (removed === activeBubble) activeBubble = null;
                    setMood('idle', 'bubble-removed', 0);
                }
            }
        }
        if (window.requestAnimationFrame) {
            requestAnimationFrame(updateAvatarVisibility);
        } else {
            setTimeout(updateAvatarVisibility, 0);
        }
    });
    childObserver.observe(container, { childList: true, subtree: true });

    // 2) 监听气泡 class（typing/gen-active 出现/消失）
    var classObserver = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            var t = m.target;
            if (!t || !t.classList) continue;
            if (t.classList.contains('bubble') && t.classList.contains('assistant')) {
                if (bubbleIsActive(t)) {
                    activeBubble = t;
                    setMood('thinking', 'bubble-class');
                } else if (t.dataset && t.dataset.remiWasActive === '1') {
                    finalizeBubble(t);
                }
                if (t.dataset) t.dataset.remiWasActive = bubbleIsActive(t) ? '1' : '0';
            }
            if (t.id === 'thinkingIndicator') {
                if (t.classList.contains('active')) {
                    setMood('thinking', 'thinkindicator');
                } else if (currentMood === 'thinking' || currentMood === 'creating' || currentMood === 'satisfied') {
                    setMood('idle', 'thinkindicator-hide', 0);
                }
            }
        }
    });
    classObserver.observe(container, { subtree: true, attributeFilter: ['class'], attributeOldValue: true });

    // 3) 思考指示器的步骤文字变化 → 切换表情
    var stepEl = document.getElementById('thinkingStep');
    if (stepEl) {
        var stepObserver = new MutationObserver(function () {
            var mood = moodFromText(stepEl.textContent);
            if (mood) setMood(mood, 'thinking-step');
        });
        stepObserver.observe(stepEl, { childList: true, characterData: true, subtree: true });
    }

    // 4) 监听正文/思考内容变化：顶部状态在“思考”和“奋笔疾书”之间切换
    var textObserver = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var t = mutations[i].target;
            if (!t || !t.classList) continue;
            if (!t.classList.contains('markdown-body') && !t.classList.contains('reasoning-content')) continue;
            var bubble = t.closest ? t.closest('.bubble.assistant') : null;
            if (!bubble || !bubbleIsActive(bubble)) continue;
            var statusEl = bubble.querySelector('.search-status');
            var statusMood = statusEl ? moodFromText(statusEl.textContent) : null;
            if (statusMood) {
                setMood(statusMood, 'bubble-status');
                continue;
            }
            var md = bubble.querySelector('.markdown-body');
            if (mdBodyText(md).trim().length > 0) {
                setMood('creating', 'bubble-output');
            } else {
                setMood('thinking', 'bubble-reasoning');
            }
        }
    });
    textObserver.observe(container, { subtree: true, childList: true, characterData: true });

    // 5) 蕾米放大小窗: 点击可见头像 → 左下角弹窗放大细节; 小窗打开期间小头像隐藏
    var remiZoomOpen = false;

    // 当前聊天内可见的蕾米头像 (最新助手消息)
    function getVisibleAvatarImg() {
        var imgs = container.querySelectorAll('.message-row.assistant .avatar.assistant img');
        for (var i = imgs.length - 1; i >= 0; i--) {
            var avatar = imgs[i].closest ? imgs[i].closest('.avatar') : null;
            if (avatar && !avatar.classList.contains('remi-avatar-hide')) return imgs[i];
        }
        return null;
    }

    function openRemiZoom() {
        if (remiZoomOpen) return;
        var win = document.getElementById('remi-zoom-window');
        if (!win) return;
        // ★ 防御: 挂到 body 直下 — 任何带 transform 的祖先 (如 configPanel) 会劫持
        //   position:fixed 的包含块, 使小窗渲染进面板内不可见
        if (win.parentElement !== document.body) document.body.appendChild(win);
        var img = getVisibleAvatarImg();
        var zoomImg = document.getElementById('remi-zoom-img');
        var zoomTitle = document.getElementById('remi-zoom-title');
        if (img && zoomImg) zoomImg.setAttribute('src', img.getAttribute('src'));
        if (zoomTitle && img && img.title) zoomTitle.textContent = img.title;
        win.hidden = false;
        document.body.classList.add('remi-zoom-open');
        remiZoomOpen = true;
        // ★ 刷新后恢复: 记住打开状态 + 拖动位置 + 自定义大小
        try { localStorage.setItem('remiZoomOpen', '1'); } catch(e) {}
        var savedPos = null;
        try { savedPos = JSON.parse(localStorage.getItem('remiZoomPos') || 'null'); } catch(e) {}
        if (savedPos && savedPos.left !== undefined && savedPos.top !== undefined) {
            win.style.left = savedPos.left + 'px';
            win.style.top = savedPos.top + 'px';
            win.style.bottom = 'auto';
        }
        var savedSize = loadZoomSize();
        if (savedSize) {
            win.style.width = savedSize.width + 'px';
            win.style.height = savedSize.height + 'px';
        }
        // ★ 稳定: 打开时把窗口钳回可视区 (屏幕变小/保存位置失效时不会跑到屏外)
        clampZoomToViewport(false);
    }

    function closeRemiZoom() {
        if (!remiZoomOpen) return;
        remiZoomOpen = false;
        var win = document.getElementById('remi-zoom-window');
        if (win) win.hidden = true;
        document.body.classList.remove('remi-zoom-open');
        try { localStorage.removeItem('remiZoomOpen'); } catch(e) {}
    }

    // 头像点击打开 (头像动态生成, 委托监听)
    container.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.classList && t.classList.contains('avatar-remi-gif')) {
            openRemiZoom();
        }
    });
    // 关闭按钮
    var closeBtn = document.getElementById('remi-zoom-close');
    if (closeBtn) closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeRemiZoom();
    });
    // Esc 关闭 (点击输入框/聊天不再自动关闭 — 小窗保持, 见下方拖动逻辑)
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && remiZoomOpen) closeRemiZoom();
    });

    // ★ 拖动 + 缩放: 按住头部拖动小窗, 拖右下角手柄自由调整大小
    //   (PIP 式悬浮窗, 位置/大小均持久化, 刷新后按原样恢复)
    var zoomWin = document.getElementById('remi-zoom-window');
    if (zoomWin) {
        var ZOOM_MIN_W = 96, ZOOM_MIN_H = 112;   // 最小可缩到小头像级别 (移动端 ~84×96 由 CSS 兜底)
        var ZOOM_MAX_W = 420, ZOOM_MAX_H = 560;
        var ZOOM_EDGE = 56; // 拖动/缩放中允许部分在屏外, 但至少留这么多像素可抓回

        function clampNum(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

        // 大小持久化: 用户缩放后保存, 刷新按原大小恢复
        function loadZoomSize() {
            try {
                var s = JSON.parse(localStorage.getItem('remiZoomSize') || 'null');
                if (s && s.width && s.height) {
                    return {
                        width: clampNum(s.width, ZOOM_MIN_W, ZOOM_MAX_W),
                        height: clampNum(s.height, ZOOM_MIN_H, ZOOM_MAX_H)
                    };
                }
            } catch(e) {}
            return null;
        }
        function saveZoomSize() {
            try {
                localStorage.setItem('remiZoomSize', JSON.stringify({
                    width: Math.round(zoomWin.offsetWidth),
                    height: Math.round(zoomWin.offsetHeight)
                }));
            } catch(e) {}
        }

        // ★ 稳定: 视口内钳制 — false=整体拉回可视区 (打开/视口变化后),
        //   true=允许部分在屏外但至少留 ZOOM_EDGE 可抓回 (拖动/缩放进行中)
        function clampZoomToViewport(allowOffscreen) {
            var rect = zoomWin.getBoundingClientRect();
            var vw = window.innerWidth, vh = window.innerHeight;
            var w = rect.width, h = rect.height;
            var left, top;
            if (allowOffscreen) {
                left = clampNum(rect.left, 8 - w + ZOOM_EDGE, vw - ZOOM_EDGE);
                top = clampNum(rect.top, 8, vh - ZOOM_EDGE);
            } else {
                left = clampNum(rect.left, 8, Math.max(vw - w - 8, 8));
                top = clampNum(rect.top, 8, Math.max(vh - h - 8, 8));
            }
            if (left !== rect.left || top !== rect.top) {
                // Math.round 防小数位置 (动画/缩放中途的 rect 可能带小数, 持久化后界面抖动)
                zoomWin.style.left = Math.round(left) + 'px';
                zoomWin.style.top = Math.round(top) + 'px';
                zoomWin.style.bottom = 'auto';
            }
        }

        // 视口缩小 (键盘弹起/旋转/窗口缩放) 时临时收缩尺寸, 不落盘 (用户主动缩放才持久化)
        function clampZoomSizeToViewport() {
            var vw = window.innerWidth, vh = window.innerHeight;
            var w = zoomWin.offsetWidth, h = zoomWin.offsetHeight;
            var maxW = Math.max(ZOOM_MIN_W, vw - 16), maxH = Math.max(ZOOM_MIN_H, vh - 16);
            if (w > maxW) zoomWin.style.width = maxW + 'px';
            if (h > maxH) zoomWin.style.height = maxH + 'px';
        }

        var zoomHeader = zoomWin.querySelector('.remi-zoom-header');
        if (zoomHeader) {
            var zoomDragging = false;
            var dragStartX = 0, dragStartY = 0, dragOrigLeft = 0, dragOrigTop = 0;
            zoomHeader.addEventListener('pointerdown', function (e) {
                if (e.target.closest && e.target.closest('.remi-zoom-close')) return;
                if (e.pointerType === 'mouse' && e.button !== 0) return; // 仅左键
                zoomDragging = true;
                dragStartX = e.clientX;
                dragStartY = e.clientY;
                var rect = zoomWin.getBoundingClientRect();
                dragOrigLeft = rect.left;
                dragOrigTop = rect.top;
                zoomWin.classList.add('remi-zoom-dragging');
                zoomHeader.setPointerCapture(e.pointerId);
                e.preventDefault();
            });
            zoomHeader.addEventListener('pointermove', function (e) {
                if (!zoomDragging) return;
                zoomWin.style.left = (dragOrigLeft + (e.clientX - dragStartX)) + 'px';
                zoomWin.style.top = (dragOrigTop + (e.clientY - dragStartY)) + 'px';
                zoomWin.style.bottom = 'auto'; // CSS 默认 bottom 定位, 拖动后切换为 top/left
                clampZoomToViewport(true);
            });
            function zoomDragEnd() {
                if (!zoomDragging) return;
                zoomDragging = false;
                zoomWin.classList.remove('remi-zoom-dragging');
                clampZoomToViewport(false); // 结束后整体拉回可视区
                // ★ 持久化拖动位置, 刷新后按原位置恢复
                try {
                    var _rect = zoomWin.getBoundingClientRect();
                    localStorage.setItem('remiZoomPos', JSON.stringify({ left: Math.round(_rect.left), top: Math.round(_rect.top) }));
                } catch(e) {}
            }
            zoomHeader.addEventListener('pointerup', zoomDragEnd);
            zoomHeader.addEventListener('pointercancel', zoomDragEnd);
        }

        // ★ 缩放: 拖右下角手柄自由调整大小 (宽高独立, 图片在主体内流体适配)
        var resizeHandle = zoomWin.querySelector('.remi-zoom-resize');
        if (resizeHandle) {
            var resizing = false;
            var resizeStartX = 0, resizeStartY = 0, resizeOrigW = 0, resizeOrigH = 0;
            resizeHandle.addEventListener('pointerdown', function (e) {
                if (e.pointerType === 'mouse' && e.button !== 0) return; // 仅左键
                resizing = true;
                var rect = zoomWin.getBoundingClientRect();
                // 锚定左上角: 清除 CSS 默认 bottom 定位前先补上显式 top/left, 防止窗口跳位
                zoomWin.style.left = rect.left + 'px';
                zoomWin.style.top = rect.top + 'px';
                zoomWin.style.bottom = 'auto';
                resizeStartX = e.clientX;
                resizeStartY = e.clientY;
                resizeOrigW = zoomWin.offsetWidth;
                resizeOrigH = zoomWin.offsetHeight;
                zoomWin.classList.add('remi-zoom-resizing');
                resizeHandle.setPointerCapture(e.pointerId);
                e.preventDefault();
                e.stopPropagation();
            });
            resizeHandle.addEventListener('pointermove', function (e) {
                if (!resizing) return;
                // ★ 等比缩放: 以移动量更大的轴为基准算统一缩放比, 宽高同比例变化 —
                //   背景卡片/圆形头像/整体形状随缩放保持一致, 不会拉变形
                var dx = e.clientX - resizeStartX, dy = e.clientY - resizeStartY;
                var sx = (resizeOrigW + dx) / resizeOrigW;
                var sy = (resizeOrigH + dy) / resizeOrigH;
                var scale = Math.abs(dx) >= Math.abs(dy) ? sx : sy;
                // 等比下宽高互锁: 缩放比同时满足两个方向的最小/最大约束
                var scaleMin = Math.max(ZOOM_MIN_W / resizeOrigW, ZOOM_MIN_H / resizeOrigH);
                var scaleMax = Math.min(ZOOM_MAX_W / resizeOrigW, ZOOM_MAX_H / resizeOrigH);
                scale = clampNum(scale, scaleMin, scaleMax);
                zoomWin.style.width = Math.round(resizeOrigW * scale) + 'px';
                zoomWin.style.height = Math.round(resizeOrigH * scale) + 'px';
                clampZoomToViewport(true);
            });
            function zoomResizeEnd() {
                if (!resizing) return;
                resizing = false;
                zoomWin.classList.remove('remi-zoom-resizing');
                clampZoomToViewport(false); // 缩放后整体拉回可视区
                saveZoomSize();
            }
            resizeHandle.addEventListener('pointerup', zoomResizeEnd);
            resizeHandle.addEventListener('pointercancel', zoomResizeEnd);
        }

        // ★ 稳定: 视口变化 (键盘弹起/旋转/窗口缩放) 时把窗口收进可视区, 不超出屏幕
        var _zoomClampRaf = 0;
        function onZoomViewportChange() {
            if (!remiZoomOpen || _zoomClampRaf) return;
            _zoomClampRaf = requestAnimationFrame(function () {
                _zoomClampRaf = 0;
                if (!remiZoomOpen) return;
                clampZoomSizeToViewport();
                clampZoomToViewport(false);
            });
        }
        window.addEventListener('resize', onZoomViewportChange);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', onZoomViewportChange);
    }

    // ★ 刷新后恢复小窗: 若上次关闭时小窗是打开的, 页面加载完成后自动重新打开
    //   头像可能在聊天加载后才渲染, 轮询等待头像就绪再开 (最多 ~8s)
    var _remiRestoreTries = 0;
    function _restoreRemiZoom() {
        var _wasOpen = false;
        try { _wasOpen = localStorage.getItem('remiZoomOpen') === '1'; } catch(e) {}
        if (!_wasOpen) return;
        if (remiZoomOpen) return;
        if (getVisibleAvatarImg() || document.querySelector('.avatar-remi-gif')) {
            openRemiZoom();
            return;
        }
        if (_remiRestoreTries++ < 40) setTimeout(_restoreRemiZoom, 200);
    }
    setTimeout(_restoreRemiZoom, 600);

    // 6) 暴露调试/外部调用接口
    window.setRemiMood = setMood;
    window.getRemiMood = function () { return currentMood; };
    window.openRemiZoom = openRemiZoom;
    window.closeRemiZoom = closeRemiZoom;
    setTimeout(updateAvatarVisibility, 300);
    setTimeout(updateAvatarVisibility, 1200);
})();
