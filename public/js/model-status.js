// model-status.js — 蕾米纯程序桌宠状态控制器
// 使用 HTML/CSS 矢量部件与状态动画表示模型/Agent 状态，不再依赖 GIF：
// 借鉴 jackuh105/remielle-dsh-plugin 的事件投影思想：
// idle / thinking / working / creating / waiting / celebrate / failed
// 只复用 Apache-2.0 状态机设计，不使用其受限 GIF/PNG 角色素材。
(function () {
    if (window.__remiStatusLoaded) return;
    window.__remiStatusLoaded = true;

    var MOODS = { idle: 1, thinking: 1, working: 1, creating: 1, waiting: 1, celebrate: 1, failed: 1, satisfied: 1, stuck: 1, done: 1, doneAlt: 1 };
    var ASSET_BASE = './src/remi-official/';
    var MOOD_ASSETS = {
        idle: '02.gif', thinking: '05.gif', working: '01.gif', creating: '03.gif',
        waiting: '05.gif', celebrate: '06.gif', failed: '04.gif'
    };
    var MOOD_CLASSES = 'mood-idle mood-thinking mood-working mood-creating mood-waiting mood-celebrate mood-failed mood-satisfied mood-stuck mood-done mood-doneAlt remi-trick-peek remi-trick-bounce';

    function applyMoodToAvatar(el, mood) {
        if (!el) return;
        var normalized = canonicalMood(mood);
        el.classList.remove.apply(el.classList, MOOD_CLASSES.split(' '));
        el.classList.add('mood-' + normalized);
        if (el.tagName === 'IMG' && MOOD_ASSETS[normalized]) {
            var nextSrc = ASSET_BASE + MOOD_ASSETS[normalized];
            if (el.getAttribute('src') !== nextSrc) el.setAttribute('src', nextSrc);
        }
        el.setAttribute('aria-label', LABELS[mood] || LABELS.idle);
        el.setAttribute('title', LABELS[mood] || LABELS.idle);
    }
    var LABELS = {
        idle: '蕾米 · 待机中',
        thinking: '蕾米 · 思考中',
        satisfied: '蕾米 · 搞定啦',
        working: '蕾米 · 工具执行中',
        creating: '蕾米 · 奋笔疾书中',
        waiting: '蕾米 · 等待你的确认',
        celebrate: '蕾米 · 完成啦！',
        failed: '蕾米 · 执行失败了',
        stuck: '蕾米 · 遇到难题了',
        done: '蕾米 · 完成！',
        doneAlt: '蕾米 · 完成！'
    };

    var currentMood = 'idle';
    var moodSeq = 0;
    var moodTimer = null;
    var activeBubble = null;
    var lastAvatarRow = null;
    var lastCelebrateAt = 0;
    var idleTrickTimer = null;
    var CELEBRATE_COOLDOWN = 12000;

    function canonicalMood(mood) {
        if (mood === 'done' || mood === 'doneAlt' || mood === 'satisfied') return 'celebrate';
        if (mood === 'stuck') return 'failed';
        return mood;
    }

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
        if (tg && MOODS[mood]) applyMoodToAvatar(tg, mood);
        var titleSpan = document.querySelector('#thinkingIndicator .thinking-title span');
        if (titleSpan) {
            var titleMap = {
                idle: '待机中',
                thinking: '思考中',
                satisfied: '搞定啦',
                working: '工具执行中',
                creating: '创作中',
                waiting: '等待确认',
                celebrate: '完成！',
                failed: '执行失败',
                stuck: '遇到难题',
                done: '完成！',
                doneAlt: '完成！'
            };
            titleSpan.textContent = titleMap[mood] || '思考中';
        }
        // 不依赖 activeBubble：DSH 主题会隐藏历史头像，且图片工具状态可能先于气泡 class 变更。
        // 始终同步当前最后一枚助手头像，保证侧边/放大悬浮窗和真实生成状态一致。
        var avatarImg = null;
        if (activeBubble) {
            var row = activeBubble.closest ? activeBubble.closest('.message-row') : null;
            avatarImg = row ? row.querySelector('.avatar.assistant .avatar-remi-gif') : null;
        }
        if (!avatarImg && container) {
            var allAvatarImgs = container.querySelectorAll('.message-row.assistant .avatar.assistant .avatar-remi-gif');
            avatarImg = allAvatarImgs.length ? allAvatarImgs[allAvatarImgs.length - 1] : null;
        }
        if (avatarImg) applyMoodToAvatar(avatarImg, mood);
        // ★ 放大小窗同步：即使气泡头像暂时不可见，也直接更新悬浮窗图片
        var zoomImg = document.getElementById('remi-zoom-img');
        if (zoomImg) applyMoodToAvatar(zoomImg, mood);
        var zoomTitle = document.getElementById('remi-zoom-title');
        if (zoomTitle && LABELS[mood]) zoomTitle.textContent = LABELS[mood];
    }

    function setMood(mood, source, stickyMs) {
        mood = canonicalMood(mood);
        if (!MOODS[mood]) return;
        // 审批是最高优先级：等待用户期间，普通 DOM 变化不得把表情抢回思考/创作。
        if (window._approvalPending && mood !== 'waiting' && mood !== 'failed') mood = 'waiting';
        // 庆祝动作设冷却，避免一轮多个工具完成时不断闪烁。
        if (mood === 'celebrate') {
            var now = Date.now();
            if (now - lastCelebrateAt < CELEBRATE_COOLDOWN && source !== 'force') mood = 'idle';
            else lastCelebrateAt = now;
        }
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
        if (raw === (el.dataset.remiText || '') && el.querySelector('.remi-status-gif')) return;

        var mood = moodFromText(raw) || 'working';
        el.dataset.remiText = raw;
        el.textContent = '';

        var img = document.createElement('img');
        img.className = 'remi-status-gif remi-character-asset';
        img.alt = '蕾米埃尔';
        img.draggable = false;
        applyMoodToAvatar(img, mood);

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

    // 使用真实 DOM 三圆点，不再依赖容易被全局伪元素规则污染的 ::after。
    function ensureTypingIndicator(bubble) {
        if (!bubble || bubble.querySelector('.remi-typing-indicator')) return;
        var md = bubble.querySelector('.markdown-body');
        if (!md) return;
        // 等待器只能挂载到当前 activeBubbleMap 对应的空占位气泡，绝不能回挂历史正文气泡。
        var ownerChatId = bubble.dataset ? bubble.dataset.chatId : '';
        var mappedBubble = ownerChatId && window.activeBubbleMap ? window.activeBubbleMap[ownerChatId] : null;
        if (mappedBubble && mappedBubble !== bubble) return;
        if (mdBodyText(md).trim().length > 0) return;
        var loader = document.createElement('span');
        loader.className = 'remi-typing-indicator';
        loader.setAttribute('role', 'status');
        loader.setAttribute('aria-label', '正在等待模型输出');
        loader.innerHTML = '<i></i><i></i><i></i>';
        md.appendChild(loader);
    }

    function removeTypingIndicator(bubble) {
        if (!bubble) return;
        var loader = bubble.querySelector('.remi-typing-indicator');
        if (loader) loader.remove();
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
        } else if (text && text.trim().length > 0 || bubble.querySelector('.gen-image-container, .generated-images-container, img.gen-image')) {
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
            if (!r.querySelector('.avatar.assistant .avatar-remi-gif')) continue;
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
                    ensureTypingIndicator(node);
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
                    ensureTypingIndicator(t);
                    setMood('thinking', 'bubble-class');
                } else if (t.dataset && t.dataset.remiWasActive === '1') {
                    removeTypingIndicator(t);
                    finalizeBubble(t);
                } else {
                    removeTypingIndicator(t);
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
                setMood(statusMood === 'thinking' ? 'working' : statusMood, 'bubble-status');
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

    // DSH 风格行为层：审批弹窗是真实 waiting 事件，而不是依靠中文文本猜测。
    var approvalObserver = new MutationObserver(function () {
        var pending = !!document.querySelector('.approval-overlay');
        if (pending) {
            window._approvalPending = true;
            setMood('waiting', 'approval', 0);
        } else if (window._approvalPending) {
            window._approvalPending = false;
            setMood(activeBubble && bubbleIsActive(activeBubble) ? 'thinking' : 'idle', 'approval-resolved', 0);
        }
    });
    approvalObserver.observe(document.body, { childList: true, subtree: false });

    // 空闲微动作：只改变纯 CSS 部件，且不覆盖工作/等待/失败状态。
    function scheduleIdleTrick() {
        if (idleTrickTimer) clearTimeout(idleTrickTimer);
        idleTrickTimer = setTimeout(function () {
            idleTrickTimer = null;
            if (currentMood !== 'idle' || document.hidden) { scheduleIdleTrick(); return; }
            var avatars = document.querySelectorAll('.remi-character-asset');
            var trick = Math.random() < 0.5 ? 'remi-trick-peek' : 'remi-trick-bounce';
            for (var i = 0; i < avatars.length; i++) avatars[i].classList.add(trick);
            setTimeout(function () {
                for (var j = 0; j < avatars.length; j++) avatars[j].classList.remove(trick);
                scheduleIdleTrick();
            }, 1200);
        }, 7000 + Math.random() * 7000);
    }
    scheduleIdleTrick();

    // 供主聊天、工具执行、恢复流直接投递结构化事件。
    window.remiReact = function (eventName, detail) {
        detail = detail || {};
        var map = {
            'turn/start': 'thinking', 'reasoning': 'thinking', 'tool/call': 'working',
            'output': 'creating', 'approval/asked': 'waiting', 'turn/completed': 'celebrate',
            'turn/error': 'failed', 'turn/blocked': 'waiting', 'turn/idle': 'idle'
        };
        var mood = map[eventName];
        if (!mood) return;
        var sticky = mood === 'celebrate' ? 5000 : (mood === 'failed' ? 7000 : 0);
        setMood(mood, detail.source || eventName, sticky);
    };

    // 5) 蕾米放大小窗: 点击可见头像 → 左下角弹窗放大细节; 小窗打开期间小头像隐藏
    var remiZoomOpen = false;

    // 当前聊天内可见的蕾米头像 (最新助手消息)
    function getVisibleAvatarImg() {
        var imgs = container.querySelectorAll('.message-row.assistant .avatar.assistant .avatar-remi-gif');
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
        if (zoomImg) {
            if (typeof applyMoodToAvatar === 'function') applyMoodToAvatar(zoomImg, currentMood);
            else if (img && img.getAttribute && zoomImg.setAttribute) zoomImg.setAttribute('src', img.getAttribute('src'));
        }
        if (zoomTitle) {
            if (typeof LABELS !== 'undefined') zoomTitle.textContent = LABELS[currentMood] || LABELS.idle;
            else if (img && img.title) zoomTitle.textContent = img.title;
        }
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
        if (t && t.closest && t.closest('.avatar-remi-gif')) {
            openRemiZoom();
        }
    });
    // 双击头像/小窗触发一次庆祝彩蛋；单击仍只负责打开小窗。
    container.addEventListener('dblclick', function (e) {
        if (e.target && e.target.closest && e.target.closest('.avatar-remi-gif')) setMood('celebrate', 'force', 3200);
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

    // 默认头像模式：刷新时不自动弹出大窗；用户点击头像后才进入桌宠小窗模式。
    // 清理旧版本残留的“保持打开”标记，避免首次进入页面直接遮挡聊天。
    try { localStorage.removeItem('remiZoomOpen'); } catch(e) {}

    // 6) 暴露调试/外部调用接口
    window.setRemiMood = setMood;
    window.getRemiMood = function () { return currentMood; };
    window.openRemiZoom = openRemiZoom;
    window.closeRemiZoom = closeRemiZoom;
    setTimeout(updateAvatarVisibility, 300);
    setTimeout(updateAvatarVisibility, 1200);
})();
