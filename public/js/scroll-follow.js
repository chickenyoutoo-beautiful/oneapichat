// scroll-follow.js — 滚动跟随系统 v2
// 解决的问题:
//   1. #chatBox 的 scroll-behavior:smooth 与 scrollTop= 赋值冲突 → 平滑动画中间事件被误判为用户滚动, 跟随静默死亡 (D1)
//   2. 程序化滚动点分散且不记录标记 → 被滚动监听误判 (D2)
//   3. 无 touch/wheel 预处理, 移动端惯性滚动直接永久脱离, 无"滚回底部重新吸附" (D3)
//   4. 异步内容长高(Mermaid SVG/图片/工具卡片)无统一兜底 (D6)
// 设计:
//   - 所有程序化滚动统一走 followToBottom(): 流式期间即时模式(禁用 CSS smooth),
//     用户按钮平滑模式
//   - 程序滚动识别: isAutoScrolling 标记 + 单帧落点匹配(赋值后一帧内位置=目标则忽略)
//     — 避免"宽限期"方案把流式期间的主动上滚误判为程序滚动
//   - 用户滚动: 距底 <80px 自动重新吸附(脱离后滚回底部立即恢复跟随)
//   - ResizeObserver 兜底: 内容长高且正在跟随时自动补滚
//   - 触摸期间暂停跟随(内容不要在手底下跳动), 松手在底部自动恢复吸附

(function () {
    var state = {
        isAutoScrolling: false,   // 程序化滚动进行中(平滑动画期间保持)
        lastTarget: 0,            // 最近一次程序化滚动的目标位置(单帧窗口)
        lastAutoTime: 0,          // 最近一次程序化滚动时间戳(单帧窗口)
        touchActive: false,       // 触摸进行中
        smoothTimer: null,
        resizeObserver: null
    };
    window.__followState = state;

    // ★ 统一程序化滚动入口 — 所有代码不得再直接 scrollTop = scrollHeight
    // opts: { smooth: bool — 平滑滚动(仅用户按钮), force: bool — 跳过触摸暂停检查 }
    window.followToBottom = function (el, opts) {
        el = el || $.chatBox;
        if (!el) return;
        opts = opts || {};
        // 触摸进行中暂停跟随(内容不要在手底下跳动); force 用于 ResizeObserver 等内部兜底
        if (state.touchActive && !opts.force) return;
        state.isAutoScrolling = true;
        var target = el.scrollHeight;
        state.lastTarget = target;
        state.lastAutoTime = performance.now();
        if (opts.smooth) {
            el.scrollTo({ top: target, behavior: 'smooth' });
            // ★ 平滑动画结束(约500ms)后释放标记, 期间中间帧 scroll 事件一律忽略
            if (state.smoothTimer) clearTimeout(state.smoothTimer);
            state.smoothTimer = setTimeout(function () {
                state.isAutoScrolling = false;
                state.lastTarget = 0;
                state.lastAutoTime = 0;
            }, 700);
        } else {
            el.scrollTop = target;
            // ★ 即时模式: 单帧内保留标记+落点(scroll 事件晚于 rAF 到达时为普通用户事件,
            //   到位的重新吸附由 handleChatScroll 的 atBottom 分支处理)
            requestAnimationFrame(function () {
                state.isAutoScrolling = false;
                state.lastTarget = 0;
                state.lastAutoTime = 0;
            });
        }
    };

    // 清除程序滚动标记(会话切换/全量重建时调用, 防止旧标记误匹配新位置)
    window.clearFollowState = function () {
        state.isAutoScrolling = false;
        state.lastTarget = 0;
        state.lastAutoTime = 0;
        if (state.smoothTimer) { clearTimeout(state.smoothTimer); state.smoothTimer = null; }
    };

    // ★ 滚动事件处理器(#chatBox scroll 监听唯一入口, 由 init.js 挂载)
    window.handleChatScroll = function (box) {
        if (!box) return;
        var scrollTop = box.scrollTop, scrollHeight = box.scrollHeight, clientHeight = box.clientHeight;
        // 1) 程序化滚动判定: 标记中 或 单帧窗口内位置=落点
        var isProgrammatic = state.isAutoScrolling
            || (performance.now() - state.lastAutoTime < 100 && state.lastTarget > 0
                && Math.abs(scrollTop + clientHeight - state.lastTarget) < 10);
        if (isProgrammatic) return;
        // 2) 用户滚动
        var atBottom = scrollHeight - scrollTop - clientHeight < 80;
        if (atBottom) {
            // ★ 滚回底部 → 自动重新吸附(脱离跟随的流畅恢复)
            if (userScrolled) userScrolled = false;
            if ($.scrollToBottomBtn) $.scrollToBottomBtn.classList.remove('visible');
        } else {
            userScrolled = true;
            if ($.scrollToBottomBtn) $.scrollToBottomBtn.classList.add('visible');
        }
    };

    // ★ 初始化: 触摸暂停 + ResizeObserver 兜底 (由 init.js 在 cacheDOMElements 后调用)
    window.initScrollFollow = function () {
        var box = $.chatBox;
        if (!box || box._scrollFollowBound) return;
        box._scrollFollowBound = true;
        var _touchAtBottom = false;
        // ★ 滚轮预处理: 向上滚动 = 明确脱离跟随(立即接管, 防止流式跟随与手势抢跑)
        //   向下滚动不处理 — 滚回底部时由 scroll 事件的 atBottom 分支重新吸附
        box.addEventListener('wheel', function (e) {
            if (e.deltaY < 0 && !userScrolled) {
                userScrolled = true;
                if ($.scrollToBottomBtn) $.scrollToBottomBtn.classList.add('visible');
            }
        }, { passive: true });
        box.addEventListener('touchstart', function () {
            state.touchActive = true;
            _touchAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        }, { passive: true });
        box.addEventListener('touchend', function () {
            state.touchActive = false;
            // ★ 松手时在底部 → 重新吸附
            if (_touchAtBottom || box.scrollHeight - box.scrollTop - box.clientHeight < 80) {
                userScrolled = false;
                if ($.scrollToBottomBtn) $.scrollToBottomBtn.classList.remove('visible');
            }
        }, { passive: true });
        // ★ 内容长高兜底: Mermaid SVG / 图片懒加载 / 工具卡片异步插入
        if (typeof ResizeObserver !== 'undefined' && $.chatMessagesContainer) {
            state.resizeObserver = new ResizeObserver(function (entries) {
                for (var i = 0; i < entries.length; i++) {
                    var entry = entries[i];
                    if (entry.target !== $.chatMessagesContainer) continue;
                    if (entry.borderBoxSize && entry.borderBoxSize.length) {
                        var h = entry.borderBoxSize[0].blockSize;
                        var prevH = state._lastContentHeight || 0;
                        if (h > prevH + 4 && !userScrolled && !state.touchActive) {
                            // 跟随中内容长高 → 补滚到底
                            followToBottom($.chatBox, { force: true });
                        }
                        state._lastContentHeight = h;
                    }
                }
            });
            state.resizeObserver.observe($.chatMessagesContainer);
        }
    };
})();
