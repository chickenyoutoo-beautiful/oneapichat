// agent.js — Agent 子系统 v1.0 (Phase 2 拆分自 main.js)
// 三模式系统 / 记忆人格心跳 / 审批门 / 任务计划流面板 / Session管理

// ==================== 三模式系统 (Plan / Agent / YOLO) ====================

// ★ Plan 模式审批状态机
// _planState: 'exploring'(只读探索) | 'reviewing'(等待用户审批) | 'executing'(已批准执行中)
window._planState = 'exploring';
window._planApproved = false;  // 用户是否已批准当前计划
window._pendingPlanActions = [];  // 审批前暂存的写操作（备用）

/** 获取当前 Agent 模式: 'off' | 'plan' | 'agent' | 'yolo' */
function getAgentMode() {
    var val = localStorage.getItem('agentMode');
    // 从旧版布尔格式迁移
    if (val === 'true') { localStorage.setItem('agentMode', 'agent'); return 'agent'; }
    if (val === 'false' || val === null || val === undefined) { localStorage.setItem('agentMode', 'off'); return 'off'; }
    if (['off','plan','agent','yolo'].indexOf(val) === -1) { localStorage.setItem('agentMode', 'off'); return 'off'; }
    return val;
}

// ★ 记住用户上一次主动选择的运行模式。off 只是退出，不应抹掉下次进入的模式。
function getPreferredAgentMode() {
    var preferred = localStorage.getItem('agentPreferredMode');
    if (['plan','agent','yolo'].indexOf(preferred) !== -1) return preferred;
    var current = getAgentMode();
    if (['plan','agent','yolo'].indexOf(current) !== -1) {
        localStorage.setItem('agentPreferredMode', current);
        return current;
    }
    return 'agent';
}

function _markLocalAgentModeChange(mode) {
    var ts = Date.now();
    try {
        localStorage.setItem('agentModeLocalTs', String(ts));
        if (mode !== 'off') localStorage.setItem('agentPreferredMode', mode);
    } catch (e) {}
    window._agentModeLocalTs = ts;
}

// SSE/重连快照可能携带旧值；本机刚选择模式后短暂锁定，避免旧事件把 YOLO 降回 Agent。
window._shouldApplyRemoteAgentMode = function(remoteTs) {
    var localTs = parseInt(localStorage.getItem('agentModeLocalTs') || '0', 10) || 0;
    var incomingTs = parseInt(remoteTs || '0', 10) || 0;
    if (incomingTs && localTs && incomingTs < localTs) return false;
    return !localTs || (Date.now() - localTs >= 4000);
};

/** 设置 Agent 模式并更新 UI */
function setAgentMode(mode, fromToggle) {
    if (['off','plan','agent','yolo'].indexOf(mode) === -1) mode = 'off';
    var prevMode = getAgentMode();

    // ★ 仅在通过双击主按钮或显式切换触发时，才允许 toggle 回 off；在菜单中选择已选模式时保持该模式不变
    if (fromToggle && mode !== 'off' && mode === prevMode) {
        mode = 'off';
    }

    // ★ 保存/恢复临时授权状态(进出 Agent 模式时不丢失)
    if (mode !== 'off' && !window.__savedTempGrant) {
        window.__savedTempGrant = !!window._tempAgentGranted;
        window.__savedTempChatId = window._tempAgentChatId;
    }
    if (mode !== 'off') {
        _updateTempGrantBanner(false);  // Agent 模式用自己的指示灯
    }
    if (mode === 'off' && window.__savedTempGrant) {
        window._tempAgentGranted = true;
        window._tempAgentChatId = window.__savedTempChatId;
        window.__savedTempGrant = false;
        window.__savedTempChatId = null;
        _updateTempGrantBanner(true);
    }

    // ★ 消息队列隔离：切换模式前保存当前队列，切换后恢复目标模式队列
    var _newIsAgent = (mode !== 'off');
    var _prevIsAgent = (prevMode !== 'off');
    // ★ 动画互斥锁: 如果有动画正在播放,立即清除
    if (window._agentAnimLock) {
        _clearAllAgentOverlays();
        clearTimeout(window._agentAnimLock);
    }

    // ★ 消息队列隔离：模式切换时先保存旧队列（显式使用 prevMode）
    if (_newIsAgent !== _prevIsAgent) {
        console.log('[Queue] mode switch: prev=' + prevMode + ' new=' + mode + ' chatId=' + currentChatId + ' items=' + (window._messageQueue ? window._messageQueue.length : 0));
        if (typeof window._saveQueue === 'function') {
            window._saveQueue(prevMode, currentChatId);
        }
        window._agentModeSwitching = true;
    }

    localStorage.setItem('agentMode', mode);  // ★ 必须在后续 loadChat 之前设置
    _markLocalAgentModeChange(mode);
    window._scheduleConfigSync();

    // ★ 重置队列状态（loadChat 会根据新 currentChatId 加载正确队列）
    if (_newIsAgent !== _prevIsAgent) {
        window._isQueueProcessing = false;
        window._isQueueMessage = false;
        window._messageQueue = [];
    }

    // ★ 整页转场动效(先判断目标模式,再判断来源模式)
    if (mode === 'agent' || mode === 'yolo') {
        playAgentEnterEffect(mode);
        window._agentAnimLock = setTimeout(function() { window._agentAnimLock = null; }, 950);
    } else if (mode === 'plan') {
        // ★ Plan: 蓝色进入特效
        playAgentEnterEffect('plan');
        // ★ Plan 模式无聊天切换(停留在当前聊天): 动画播完即淡出
        _dismissOverlayAfter('plan', null, 900, 2500);
        window._agentAnimLock = setTimeout(function() { window._agentAnimLock = null; }, 700);
    } else if (mode === 'off' && (prevMode === 'agent' || prevMode === 'yolo' || prevMode === 'plan')) {
        // ★ 切回 off: 退出特效(仅当从非 off 模式切换时)
        playAgentExitEffect(prevMode);
        window._agentAnimLock = setTimeout(function() { window._agentAnimLock = null; }, 700);
        // ★ 关闭 Agent 模式时清除会话自动批准
        if (window._sessionAutoApprove) {
            window._sessionAutoApprove = false;
            var _btn = document.getElementById('sessionAutoApproveBtn');
            if (_btn) _btn.classList.remove('active');
        }
    }

    updateAgentUI();
    if (mode === 'agent' || mode === 'yolo') {
        // Agent/YOLO 模式开启时自动启用 Agent 专属工具
        AGENT_TOOL_KEYS.forEach(function(k) { window.setToolEnabled(k, true); });

        // ★ Agent 模式: 自动收起左侧栏, 切换到新 agent 聊天
        var wasCollapsed = $.sidebar?.classList.contains('collapsed');
        if (!wasCollapsed) {
            $.sidebar?.classList.add('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'inline-flex';
        }
        // 保存当前普通聊天 ID(归档 Agent 会话不算普通聊天)
        if (currentChatId && !isAgentChat(currentChatId)) {
            lastNormalChatId = currentChatId;
            localStorage.setItem('lastNormalChatId', lastNormalChatId);
        }
        var agentId = '_agent_main';
        var _enterLoad = null;
        if (!chats[agentId]) {
            _enterLoad = createAgentChat().then(function() {
                _inheritChatContext(agentId);
                return loadChat(agentId);
            });
        } else {
            if (chats[agentId].messages && chats[agentId].messages.length <= 1) {
                _inheritChatContext(agentId);
            }
            _enterLoad = loadChat(agentId);
        }
        // ★ 遮罩等 Agent 聊天加载/渲染完成后再淡出(loadChat 是 async);
        //   maxWait 1800 兜底 — 大会话渲染再久也不让遮罩长时间滞留(用户反馈切入太慢)
        _dismissOverlayAfter(mode, _enterLoad, 750, 1800);
    } else if (mode === 'off') {
        // ★ 普通模式: 关闭所有 Agent 专属工具
        AGENT_TOOL_KEYS.forEach(function(k) { window.setToolEnabled(k, false); });
        // 恢复侧边栏
        var wasCollapsed = $.sidebar?.classList.contains('collapsed');
        if (wasCollapsed) {
            $.sidebar?.classList.remove('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
        }
        // 切回普通模式: 恢复上次普通聊天(归档 Agent 会话不算普通聊天)
        var restoreId = lastNormalChatId;
        if (!restoreId || !chats[restoreId]) {
            restoreId = Object.keys(chats).filter(function(id) {
                return !isAgentChat(id) && chats[id] && chats[id].messages && chats[id].messages.length > 0;
            }).sort(function(a,b) {
                return (chats[b].updated_at || 0) - (chats[a].updated_at || 0);
            })[0];
        }
        if (restoreId && chats[restoreId]) {
            // ★ 立即恢复普通聊天(遮罩已不透明, 切换全程在遮罩后完成 —
            //   原等 750ms 才 loadChat, 半透明遮罩下用户全程看见未切换的 Agent 会话/侧边栏)
            setTimeout(function() {
                var _exitLoad = loadChat(restoreId);
                renderChatHistory();
                updateHeaderTitle();
                // ★ 遮罩等普通聊天加载完成后再淡出(loadChat 是 async)
                _dismissOverlayAfter('exit:' + prevMode, _exitLoad, 500, 2000);
            }, 120);
        } else {
            // ★ 无恢复聊天: 动画播完即淡出
            _dismissOverlayAfter('exit:' + prevMode, null, 700, 1800);
        }
    }
    // plan 模式: 不碰侧边栏和聊天切换, 消息注入普通聊天
    if (mode === 'plan') {
        AGENT_TOOL_KEYS.forEach(function(k) { window.setToolEnabled(k, false); });
        // ★ 初始化 Plan 审批状态机
        window._planState = 'exploring';
        window._planApproved = false;
        window._pendingPlanActions = [];
    }
    // ★ 从 Plan 模式切走时清理计划状态
    if (mode !== 'plan' && prevMode === 'plan') {
        window._planState = 'exploring';
        window._planApproved = false;
        window._pendingPlanActions = [];
    }
    // ★ 切回普通模式时关闭计划面板(面板位于输入区, 不受 loadChat 影响, 必须主动清理)
    //   计划可能在 agent/yolo/plan 任一模式下创建, 故 off 时统一Dismiss
    //   ★ 排除临时授权恢复场景(点击 off 时 temp grant 会重新激活 Agent, 面板应保留)
    if (mode === 'off' && !window._tempAgentGranted && window._agentPlan) {
        window.dismissFlowPanel();
    }
    // 模式切换不弹 toast(已有横幅和绿点提示)
    if (typeof renderToolPanel === 'function') renderToolPanel();

    // ★ 多端同步: 广播 agent 模式变更到其他浏览器/设备
    if (typeof window._broadcastEvent === 'function') {
        window._broadcastEvent('agent:mode_changed', { mode: mode, ts: Date.now() });
    }
}

/** 循环切换模式: off → plan → agent → yolo → off */
function cycleAgentMode() {
    var modes = ['off', 'plan', 'agent', 'yolo'];
    var current = getAgentMode();
    var idx = modes.indexOf(current);
    if (idx === -1 || idx >= modes.length - 1) idx = 0;
    else idx++;
    setAgentMode(modes[idx]);
}

/** 判断 Agent 工具是否激活 (agent 或 yolo 模式) */
function isAgentToolsActive() {
    var mode = getAgentMode();
    return mode === 'agent' || mode === 'yolo';
}

/** 判断是否审批模式 (plan 或 agent 模式) */
function isApprovalMode() {
    var mode = getAgentMode();
    return mode === 'plan' || mode === 'agent';
}

/** 判断是否 YOLO 自动批准模式 */
function isYoloMode() {
    return getAgentMode() === 'yolo';
}

/** 判断是否 Plan 只读模式 */
function isPlanMode() {
    return getAgentMode() === 'plan';
}

// ★ Agent 模式整页转场动效
// overlay 管理:防止快速切换时动画叠加
let _agentOverlayMap = {}; // mode -> { el, timer }

function _clearAgentOverlay(mode) {
    var entry = _agentOverlayMap[mode];
    if (!entry) return;
    clearTimeout(entry.timer);
    if (entry.el && entry.el.parentNode) {
        entry.el.remove();
    }
    delete _agentOverlayMap[mode];
}

function _clearAllAgentOverlays() {
    Object.keys(_agentOverlayMap).forEach(function(m) { _clearAgentOverlay(m); });
    // 清除所有遗留的 agent-transition-overlay(兜底)
    document.querySelectorAll('.agent-transition-overlay').forEach(function(el) { el.remove(); });
}

// ★ 遮罩淡出辅助: 等待「最短展示时间 + 底层聊天加载完成」后再淡出
//   遮罩不再固定计时器自动消失 — 启动/关闭模式时底层 loadChat 是 async,
//   大会话渲染可能超过原固定 900/650ms, 遮罩先消失聊天后加载会显得割裂;
//   loadPromise 可空(无加载任务时按最短时间淡出); maxWait 兜底防加载异常导致遮罩永久滞留;
//   快速切换模式时遮罩被清除/重建 → 通过元素引用比对放弃本次淡出
function _dismissOverlayAfter(key, loadPromise, minWait, maxWait) {
    var _entry = _agentOverlayMap[key];
    if (!_entry || !_entry.el) return;
    var _el = _entry.el;
    var _settled = false;   // 底层加载完成(或兜底超时)
    var _minDone = false;   // 最短展示时间已到(动画完整播完)
    var _tryFade = function() {
        if (!_settled || !_minDone) return;
        var _e = _agentOverlayMap[key];
        if (!_e || _e.el !== _el) return;  // 已被清除/替换(快速切换) → 放弃
        var el = _el;
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.25s ease';
        var _ft = setTimeout(function() { if (el.parentNode) el.remove(); delete _agentOverlayMap[key]; }, 250);
        _e.timer = _ft;   // 淡出期仍可被 _clearAgentOverlay 清理
        _e.el = null;
    };
    // 最短展示时间: 让进入/退出动画完整播完
    setTimeout(function() { _minDone = true; _tryFade(); }, minWait || 900);
    // 底层聊天加载完成: 再等一小帧(150ms)让渲染稳定(布局回流/图片占位)
    var _p = loadPromise;
    if (_p && typeof _p.then === 'function') {
        var _onSettle = function() { _settled = true; setTimeout(_tryFade, 150); };
        _p.then(_onSettle, _onSettle);
    } else {
        _settled = true;
    }
    // 兜底: 加载异常/卡死时强制淡出
    setTimeout(function() { _settled = true; _tryFade(); }, maxWait || 3500);
}

function playAgentEnterEffect(mode) {
    _clearAllAgentOverlays();
    var isPlan = mode === 'plan';
    var isYolo = mode === 'yolo';
    var c1 = isYolo ? [239,68,68] : isPlan ? [59,130,246] : [99,102,241];
    var c2 = isYolo ? [245,158,11] : isPlan ? [96,165,250] : [168,85,247];
    var glow = 'rgba(' + c1.join(',') + ',';
    var glow2 = 'rgba(' + c2.join(',') + ',';
    var titleGrad = isYolo ? '#ef4444,#f97316,#eab308' : isPlan ? '#3b82f6,#60a5fa,#93c5fd' : '#6366f1,#a855f7,#ec4899';
    var titleWord = isYolo ? 'YOLO' : isPlan ? 'PLAN' : 'AGENT';
    var subtitle = isYolo ? 'AUTONOMOUS' : isPlan ? 'READ-ONLY' : 'ENHANCED';
    var hexStroke = 'rgba(' + c1.join(',') + ',0.12)';

    // 预载艺术字
    if (!document.getElementById('agent-font-link')) {
        var fl = document.createElement('link');
        fl.id = 'agent-font-link';
        fl.rel = 'stylesheet';
        fl.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800;900&display=swap';
        document.head.appendChild(fl);
    }
    var overlay = document.createElement('div');
    overlay.className = 'agent-transition-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;pointer-events:none;';
    overlay.innerHTML = '' +
        // 1. 背景模糊(跟随模式颜色)
        '<div style="position:absolute;inset:0;backdrop-filter:blur(12px) saturate(100%);-webkit-backdrop-filter:blur(12px) saturate(100%);background:' + (isYolo ? 'rgba(254,242,242,0.22)' : isPlan ? 'rgba(239,246,255,0.22)' : 'rgba(238,242,255,0.22)') + ';opacity:0;animation:agent-mask-in 0.25s ease forwards;will-change:opacity;transform:translateZ(0);"></div>' +
        // 2. 六边形网格(加速)
        '<div style="position:absolute;inset:0;opacity:0;background-image:url(\'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="52"><path d="M30 0L60 15v22L30 52 0 37V15z" fill="none" stroke="' + hexStroke + '" stroke-width="1"/></svg>') + '\');background-size:60px 52px;animation:agent-hex-in 0.6s 0.08s ease forwards;will-change:transform;"></div>' +
        // 3. 多层光环(加速)
        '<div style="position:absolute;top:50%;left:50%;width:0;height:0;border-radius:50%;box-shadow:0 0 0 0 ' + glow + '0.3),0 0 0 0 ' + glow + '0.1);animation:agent-pulse-rings 0.6s cubic-bezier(0.16,1,0.3,1) forwards;will-change:transform;"></div>' +
        // 4. 光线(减少数量+加速)
        '<div style="position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;">' +
            Array.from({length: 3}, function(_, i) {
                return '<div style="position:absolute;top:' + (15 + i*30) + '%;left:-100%;width:200%;height:1px;background:linear-gradient(90deg,transparent,' + glow + '0.3),' + glow2 + '0.15),transparent);animation:agent-line-' + (i%2===0?'right':'left') + ' 0.4s ' + (0.05+i*0.04) + 's ease forwards;"></div>';
            }).join('') +
        '</div>' +
        // 5. 中心文字(缩小+去内层模糊)
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;pointer-events:none;">' +
            '<div style="opacity:0;animation:agent-mask-in 0.3s 0.08s ease forwards;will-change:opacity;">' +
                '<div style="font-family:\'Orbitron\',\'Inter\',system-ui,sans-serif;font-size:64px;font-weight:900;letter-spacing:4px;line-height:1;text-align:center;opacity:0;animation:agent-title-in 0.5s 0.1s cubic-bezier(0.16,1,0.3,1) forwards;">' +
                    titleWord.split('').map(function(letter, i) {
                        var grad = 'background:linear-gradient(135deg,' + titleGrad + ');-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;';
                        var shadow = 'filter:drop-shadow(0 0 ' + (12+i*2) + 'px ' + glow + '0.3));';
                        return '<span style="' + grad + shadow + '">' + letter + '</span>';
                    }).join('') +
                '</div>' +
                '<div style="font-family:\'Orbitron\',\'Inter\',system-ui,sans-serif;font-size:14px;font-weight:600;letter-spacing:12px;color:' + glow2 + '0.35);opacity:0;animation:agent-subtitle-in 0.4s 0.2s ease forwards;margin-top:8px;text-align:center;width:100%;">' + subtitle + '</div>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);
    // ★ 不再固定 900ms 自动淡出 — 由 setAgentMode 在 Agent 聊天加载完成后驱动(_dismissOverlayAfter)
    _agentOverlayMap[mode] = { el: overlay, timer: null };
}

function playAgentExitEffect(mode) {
    _clearAgentOverlay('exit:' + mode);
    // ★ 退出: 暗色淡出,柔和醒目
    var exitWord = 'OFF';

    var overlay = document.createElement('div');
    overlay.className = 'agent-transition-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;pointer-events:none;';
    overlay.innerHTML = '' +
        // ★ 遮罩改为高不透明度(深色实底): 退出期间底层会话切换在遮罩后完成,
        //   原 15% 黑+6px 模糊近乎透明, 用户能透见尚未切换的 Agent 会话与侧边栏, 视觉割裂
        '<div style="position:absolute;inset:0;backdrop-filter:blur(10px) brightness(0.6);-webkit-backdrop-filter:blur(10px) brightness(0.6);background:rgba(15,23,42,0.88);animation:agent-exit-mask 0.5s ease forwards;will-change:opacity;transform:translateZ(0);"></div>' +
        '<div style="position:absolute;top:50%;left:50%;width:250vw;height:250vw;border-radius:50%;border:2px solid rgba(255,255,255,0.1);transform:translate(-50%,-50%);animation:agent-ring-collapse 0.5s cubic-bezier(0.5,0,0.8,0.4) forwards;"></div>' +
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">' +
            '<div style="font-family:system-ui,sans-serif;font-size:42px;font-weight:600;letter-spacing:5px;color:rgba(255,255,255,0.7);opacity:0;animation:agent-exit-text 0.5s ease forwards;">' + exitWord + '</div>' +
        '</div>';
    document.body.appendChild(overlay);
    var exitKey = 'exit:' + mode;
    // ★ 不再固定 650ms 自动淡出 — 由 setAgentMode 在恢复聊天加载完成后驱动(_dismissOverlayAfter)
    _agentOverlayMap[exitKey] = { el: overlay, timer: null };
}

// 兼容旧版 toggleAgentMode
window.toggleAgentMode = function() {
    var curMode = getAgentMode();
    // 只切换 on/off:off → agent, agent/plan/yolo → off
    var newMode = (curMode === 'off' || !curMode) ? 'agent' : 'off';
    setAgentMode(newMode);
};

/**
 * 创建主代理聊天 (始终复用 _agent_main,不新建)
 * @returns {Promise}
 */
function createAgentChat() {
    return new Promise(function(resolve) {
        var uid = localStorage.getItem('authUserId') || '';
        var agentSys = localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt;
        var agentId = '_agent_main';
        chats[agentId] = {
            title: 'Agent',
            userId: uid,
            updated_at: Date.now(),
            messages: [
                { role: 'system', content: agentSys || 'You are an AI assistant in Agent mode.' }
            ]
        };
        resolve();
    });
}

/** ★ 从当前普通聊天继承上下文到 Agent 聊天,实现任务接续 */
function _inheritChatContext(agentId) {
    try {
        // 找到最近活跃的普通聊天（归档 Agent 会话不算普通聊天）
        var normalChats = Object.keys(chats).filter(function(id) {
            return !isAgentChat(id) && chats[id] && chats[id].messages && chats[id].messages.length > 0;
        }).sort(function(a, b) {
            return (chats[b].updated_at || 0) - (chats[a].updated_at || 0);
        });
        var sourceId = currentChatId && !isAgentChat(currentChatId) ? currentChatId : normalChats[0];
        if (!sourceId || !chats[sourceId]) return;

        var sourceMsgs = chats[sourceId].messages;
        // 取最近 20 条非 system 消息
        var recentMsgs = [];
        for (var i = sourceMsgs.length - 1; i >= 0 && recentMsgs.length < 20; i--) {
            var m = sourceMsgs[i];
            if (m.role === 'system' || m.temporary || m._internal) continue;
            recentMsgs.unshift(m);
        }
        if (recentMsgs.length === 0) return;

        // 在 system prompt 后插入上下文摘要
        if (!chats[agentId].messages || chats[agentId].messages.length === 0) {
            chats[agentId].messages = [{ role: 'system', content: 'You are an AI assistant in Agent mode.' }];
        }
        var sysMsg = chats[agentId].messages[0];
        var contextLines = ['[上下文 - 从普通聊天继承]'];
        recentMsgs.forEach(function(m) {
            var prefix = m.role === 'user' ? '用户' : 'AI';
            var text = (m.text || m.content || '').substring(0, 300);
            if (text) contextLines.push(prefix + ': ' + text);
        });
        sysMsg.content = (sysMsg.content || '') + '\n\n' + contextLines.join('\n');
        console.log('[Agent] 已继承普通聊天上下文, 消息数:', recentMsgs.length);
    } catch(e) {
        console.warn('[Agent] 继承上下文失败:', e.message);
    }
}

// ==================== 代理面板控制 ====================
// ==================== Agent 记忆/人格/身份/心跳 系统 ====================

/** 获取引擎 API 基础 URL */
function _agentEngineUrl() {
    return window.location.origin + '/oneapichat/';
}

/** 获取当前 auth token */
function _agentGetAuthToken() {
    try { return localStorage.getItem('authToken') || ''; } catch(e) { return ''; }
}

function _agentAuthHeaders(extra) {
    var headers = Object.assign({}, extra || {});
    var token = _agentGetAuthToken();
    if (token && !headers.Authorization) headers.Authorization = 'Bearer ' + token;
    return headers;
}

/** 向引擎发送 POST 请求 */
async function _agentApiPost(action, data) {
    var token = _agentGetAuthToken();
    var url = _agentEngineUrl() + 'engine_api.php?action=' + action;
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    try {
        var resp = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });
        return await resp.json();
    } catch(e) {
        console.warn('[AgentMemory] POST ' + action + ' failed:', e);
        return { ok: false };
    }
}

/** 向引擎发送 GET 请求 */
async function _agentApiGet(action, params) {
    var token = _agentGetAuthToken();
    var url = _agentEngineUrl() + 'engine_api.php?action=' + action;
    if (params) {
        for (var k in params) {
            url += '&' + k + '=' + encodeURIComponent(params[k]);
        }
    }
    var headers = { 'Accept': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    try {
        var resp = await fetch(url, { headers: headers });
        return await resp.json();
    } catch(e) {
        console.warn('[AgentMemory] GET ' + action + ' failed:', e);
        return { ok: false };
    }
}

// ── 人格 ──────────────────────────────────────────

/** 保存 Agent 人格 */
window.saveAgentPersona = async function(persona) {
    if (!persona || typeof persona !== 'object') return { ok: false };
    return await _agentApiPost('agent_persona_save', persona);
};

/** 加载 Agent 人格 */
window.loadAgentPersona = async function() {
    return await _agentApiGet('agent_persona_load');
};

// ── 记忆 ──────────────────────────────────────────

/** 保存一条记忆 */
window.saveAgentMemory = async function(key, content, tags) {
    if (!key || !content) return { ok: false };
    return await _agentApiPost('agent_memory_save', { key: key, content: content, tags: tags || [] });
};

/** 加载记忆(支持关键词搜索) */
window.loadAgentMemory = async function(query) {
    var params = {};
    if (query) params.query = query;
    return await _agentApiGet('agent_memory_load', params);
};

/** 删除记忆 */
window.deleteAgentMemory = async function(key) {
    return await _agentApiGet('agent_memory_delete', { key: key });
};

// ── 用户身份 ──────────────────────────────────────

/** 保存用户身份 */
window.saveAgentIdentity = async function(identity) {
    if (!identity || typeof identity !== 'object') return { ok: false };
    return await _agentApiPost('agent_identity_save', identity);
};

/** 加载用户身份 */
window.loadAgentIdentity = async function() {
    return await _agentApiGet('agent_identity_load');
};

// ── 心跳 ──────────────────────────────────────────

/** 更新 Agent 心跳 */
window.agentHeartbeat = async function(state, mood, chatId) {
    var data = { state: state || 'active', mood: mood || 'neutral' };
    if (chatId) data.chat_id = chatId;
    return await _agentApiPost('agent_heartbeat', data);
};

/** 读取心跳状态 */
window.agentHeartbeatStatus = async function() {
    return await _agentApiGet('agent_heartbeat_status');
};

// ── System Prompt 注入 ────────────────────────────

// ── 云端记忆/身份加载 (memory_api.php) ─────────────

/** 从 memory_api.php 加载用户记忆缓存 */
window._loadCloudMemories = async function() {
    var token = getAuthToken();
    if (!token) return null;
    try {
        var resp = await fetch('/oneapichat/api/memory_api.php?action=smart_context&limit=15', {
            headers: getSessionAuthHeaders()
        });
        var data = await resp.json();
        if (data && data.context) {
            window.__cloudMemories = data.context;
            window.__cloudMemoryCount = data.total || 0;
            return data;
        }
    } catch(e) {}
    window.__cloudMemories = '';
    return null;
};

/** 从 memory_api.php 加载身份信息 (与SOUL/USER/IDENTITY对应) */
window._loadCloudIdentity = async function() {
    var token = getAuthToken();
    if (!token) return null;
    try {
        var resp = await fetch('/oneapichat/api/memory_api.php?action=search_memories&q=' + encodeURIComponent('身份'), {
            headers: getSessionAuthHeaders()
        });
        var data = await resp.json();
        if (data && data.memories) {
            // 查找 identity_ 前缀的记忆
            var identity = {};
            var persona = {};
            var user = {};
            data.memories.forEach(function(m) {
                if (m.key === 'identity_ai_name') identity.name = m.content;
                else if (m.key === 'identity_ai_style') identity.style = m.content;
                else if (m.key === 'identity_ai_emoji') identity.emoji = m.content;
                else if (m.key === 'identity_user_name') user.name = m.content;
                else if (m.key === 'identity_user_notes') user.notes = m.content;
                else if (m.key === 'persona_name') persona.name = m.content;
                else if (m.key === 'persona_style') persona.style = m.content;
            });
            window.__cloudPersona = Object.keys(persona).length > 0 ? persona : null;
            window.__cloudIdentity = Object.keys(identity).length > 0 ? identity : null;
            window.__cloudUser = Object.keys(user).length > 0 ? user : null;
        }
    } catch(e) {}
};

// ── 记忆管理 UI ─────────────────────────────────

window.refreshMemoryList = async function() {
    var token = localStorage.getItem('authToken');
    var listEl = document.getElementById('memoryList');
    if (!listEl || !token) return;
    try {
        // ★ v2: 使用新事实列表端点
        var resp = await fetch('/oneapichat/api/engine_api.php?action=memory_fact_list&limit=50', { headers: _agentAuthHeaders() });
        var data = await resp.json();
        var facts = (data.ok && data.facts) ? data.facts : [];
        if (facts.length === 0) {
            listEl.innerHTML = '<div class="memory-empty">暂无记忆</div>';
        } else {
            listEl.innerHTML = facts.map(function(f) {
                var rel = escapeHtml(f.relation || 'fact');
                var c = escapeHtml((f.content || '').substring(0, 60));
                var fid = f.id || '';
                return '<div class="memory-item">' +
                    '<span class="memory-item-text"><b>' + rel + '</b>: ' + c + '</span>' +
                    '<button onclick="window.deleteMemoryEntry(\'' + fid.replace(/'/g, "\\'") + '\')" class="memory-item-del" title="删除记忆">✕</button>' +
                '</div>';
            }).join('');
        }
    } catch(e) {
        listEl.innerHTML = '<div class="memory-empty" style="color:#ef4444;">加载失败</div>';
    }
    window._loadCloudMemories();
    window._loadCloudIdentity();
    if (window.refreshMemoryContext) window.refreshMemoryContext();
};

window.addMemoryEntry = async function() {
    var keyEl = document.getElementById('memoryKeyInput');
    var contentEl = document.getElementById('memoryContentInput');
    var key = (keyEl?.value || '').trim();
    var content = (contentEl?.value || '').trim();
    if (!key || !content) { showToast('请输入键和内容', 'warning'); return; }
    var token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        // ★ v2: 使用新端点,将 key+content 映射为 fact 的 entity+relation+target
        var resp = await fetch('/oneapichat/api/engine_api.php?action=memory_fact_save', {
            method: 'POST',
            headers: _agentAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ entity: 'user', relation: key, target: content, content: content, importance: 5, source: 'manual' })
        });
        var data = await resp.json();
        if (data.ok) {
            keyEl.value = ''; contentEl.value = '';
            showToast('记忆已保存', 'success');
            window.refreshMemoryList();
        } else {
            showToast(data.error || '保存失败', 'error');
        }
    } catch(e) { showToast('保存失败', 'error'); }
};

window.deleteMemoryEntry = async function(factId) {
    if (!confirm('删除此记忆?')) return;
    var token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        var resp = await fetch('/oneapichat/api/engine_api.php?action=memory_fact_delete', {
            method: 'POST',
            headers: _agentAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ id: factId })
        });
        var data = await resp.json();
        if (data.ok) {
            showToast('已删除', 'success');
            window.refreshMemoryList();
        }
    } catch(e) { showToast('删除失败', 'error'); }
};

window.clearAllMemories = async function() {
    if (!confirm('确定清空所有记忆?此操作不可撤销!')) return;
    var token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        // ★ v2: 获取所有事实并逐个删除
        var resp = await fetch('/oneapichat/api/engine_api.php?action=memory_fact_list&limit=200', { headers: _agentAuthHeaders() });
        var data = await resp.json();
        var facts = (data.ok && data.facts) ? data.facts : [];
        for (var i = 0; i < facts.length; i++) {
            await fetch('/oneapichat/api/engine_api.php?action=memory_fact_delete', {
                method: 'POST',
                headers: _agentAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ id: facts[i].id })
            });
        }
        showToast('已清空 ' + facts.length + ' 条记忆', 'success');
        window.refreshMemoryList();
    } catch(e) { showToast('清空失败', 'error'); }
};

// ── AI 自主记忆保存 ───────────────────────────

/** 对话结束后自动提取重要信息保存为记忆 */
window._autoSaveMemoriesFromChat = async function(chatId) {
    var token = localStorage.getItem('authToken');
    if (!token || !chatId || !chats[chatId]) return;
    var msgs = chats[chatId].messages;
    if (msgs.length < 3) return; // 太短的对话不提取

    // 取最后5条非system消息作为分析素材
    var recent = msgs.filter(function(m) { return m.role !== 'system' && !m.temporary && !m._internal; }).slice(-6);
    if (recent.length < 2) return;

    var conversation = recent.map(function(m) {
        return (m.role === 'user' ? '用户: ' : 'AI: ') + (m.text || m.content || '').substring(0, 200);
    }).join('\n');

    // ★ 使用当前模型(兼容所有OpenAI格式的API)
    var key = localStorage.getItem('apiKey') || '';
    var baseUrl = localStorage.getItem('baseUrl') || (typeof DEFAULT_CONFIG !== 'undefined' ? DEFAULT_CONFIG.url : 'https://api.deepseek.com');
    if (!key || !baseUrl) return;
    var _provider = localStorage.getItem('baseUrlProvider') || 'custom';
    // ★ Gemini 免费层速率限制极低(2-3 RPM), 记忆提取额外请求必然触发429，直接跳过
    if (_provider === 'gemini' || baseUrl.indexOf('generativelanguage.googleapis.com') >= 0) return;
    // 本地模型通常兼容deepseek-chat,直接用; 其他provider用当前模型
    var model = (_provider === 'llamacpp') ? 'deepseek-chat'
        : (localStorage.getItem('model') || localStorage.getItem('model_' + _provider) || 'deepseek-chat');
    // ★ LongCat 仅支持 LongCat-2.0, 强制修正
    if (_provider === 'longcat' || (baseUrl && baseUrl.indexOf('api.longcat.chat') >= 0)) {
        model = 'LongCat-2.0';
    }

    // ★ 跟随用户设置的流式/非流式开关
    var _stream = localStorage.getItem('stream') !== 'false';

    try {
        var resp = await window.proxyFetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: '你是记忆提取助手。分析对话,提取值得长期记住的信息。\n\n规则:\n1. 只提取用户明确告知的偏好、个人信息、决策、计划\n2. 忽略闲聊、问时间天气、临时问答\n3. 用JSON格式输出: [{"key":"简短英文键","content":"中文内容"}]\n4. 如果没有任何值得记住的,输出空数组 []\n5. 每个content不超过80字\n6. 最多提取3条' },
                    { role: 'user', content: '请从以下对话提取值得长期记住的信息:\n' + conversation }
                ],
                temperature: 0.1,
                max_tokens: 300,
                stream: _stream
            })
        });
        if (!resp.ok) return;

        // ★ 根据流式/非流式解析响应
        var text = '';
        if (_stream) {
            // 流式: 解析 SSE, 拼接所有 content chunk
            var reader = resp.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';
            while (true) {
                var { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                var lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (var li = 0; li < lines.length; li++) {
                    var line = lines[li].trim();
                    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                        try {
                            var chunk = JSON.parse(line.substring(6));
                            var delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
                            if (delta && delta.content) text += delta.content;
                        } catch(e) {}
                    }
                }
            }
        } else {
            // 非流式: 直接解析 JSON
            var data = await resp.json();
            text = data.choices?.[0]?.message?.content || '';
        }
        // 提取JSON
        var jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return;
        var items = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(items) || items.length === 0) return;

        // ★ 保存每条记忆到新旧两个系统(过渡期双写)
        var saved = 0;
        for (var i = 0; i < items.length; i++) {
            if (!items[i].key || !items[i].content) continue;
            var fact = { entity: 'user', relation: items[i].key, target: items[i].content, content: items[i].content, importance: 6, source: 'auto_extract' };
            // 新系统 (SQLite + chromadb)
            try {
                await fetch('/oneapichat/api/engine_api.php?action=memory_fact_save', {
                    method: 'POST', headers: _agentAuthHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify(fact)
                });
            } catch(e) {}
            // 旧系统 (PHP JSON, 兼容)
            try {
                await fetch('/oneapichat/api/memory_api.php?action=save_memory', {
                    method: 'POST',
                    headers: getSessionAuthHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ key: items[i].key, content: items[i].content })
                });
            } catch(e) {}
            saved++;
        }
        if (saved > 0) {
            console.log('[自动记忆] 已保存 ' + saved + ' 条');
            window._loadCloudMemories();
            if (window.refreshMemoryList) window.refreshMemoryList();
        }
    } catch(e) { console.warn('[自动记忆] 失败:', e.message); }
};

// ── AI 自主询问身份 ───────────────────────────

/** 检查并自动在Agent聊天中询问身份 */
window._autoAskIdentity = async function() {
    var token = localStorage.getItem('authToken');
    if (!token) return;
    // 检查是否已有身份信息
    try {
        var resp = await fetch('/oneapichat/api/memory_api.php?action=search_memories&q=identity_user_name', {
            headers: getSessionAuthHeaders()
        });
        var data = await resp.json();
        var hasIdentity = data.memories && data.memories.some(function(m) { return m.key === 'identity_user_name'; });
        if (hasIdentity) return; // 已有身份,不需要问
    } catch(e) { return; }

    // 在Agent聊天中注入身份询问消息
    if (isAgentToolsActive() && currentChatId === AGENT_CHAT_ID) {
        window.__autoIdentityAsked = true;
        setTimeout(function() {
            showIdentityCard();
        }, 1000);
    }
};

// ★ 身份卡片 - 漂亮弹窗代替丑陋系统消息
window.showIdentityCard = function() {
    var container = document.querySelector('.chat-messages') || document.getElementById('chat-messages');
    if (!container) return;

    // 移除已有的
    var old = container.querySelector('.identity-card-wrapper');
    if (old) old.remove();

    var wrapper = document.createElement('div');
    wrapper.className = 'identity-card-wrapper';
    wrapper.style.cssText = 'display:flex;justify-content:center;padding:16px 0;animation:identitySlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1);';
    wrapper.innerHTML = '<div class="identity-card" style="max-width:420px;width:100%;background:linear-gradient(135deg,#667eea0e,#764ba20e);border:1px solid #667eea22;border-radius:16px;padding:20px 24px;box-shadow:0 4px 24px rgba(102,126,234,0.08);">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">' +
        '<span style="font-size:24px;">👋</span>' +
        '<div style="font-weight:600;font-size:15px;color:#667eea;">你好! 设置身份信息</div>' +
        '</div>' +
        '<div style="color:#6b7280;font-size:13px;line-height:1.6;margin-bottom:16px;">' +
        '告诉我你希望我怎么称呼你、以及我该以什么风格和你对话。' +
        '<br>例如:<span style="color:#667eea;font-weight:500;">"叫我奕侨,回复简洁直接"</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button onclick="var e=event.target.closest(\'.identity-card-wrapper\');e.style.transition=\'all 0.25s\';e.style.opacity=\'0\';e.style.transform=\'translateY(-10px)\';setTimeout(function(){e.remove()},250)" style="flex:1;padding:8px 12px;border-radius:10px;border:1px solid #e5e7eb;background:transparent;color:#6b7280;cursor:pointer;font-size:13px;transition:all 0.15s;" onmouseover="this.style.background=\'#f3f4f6\'" onmouseout="this.style.background=\'transparent\'">稍后再说</button>' +
        '<button onclick="window._handleIdentityQuick(\'调用我Ai助手\');var e=event.target.closest(\'.identity-card-wrapper\');e.style.transition=\'all 0.25s\';e.style.opacity=\'0\';e.style.transform=\'translateY(-10px)\';setTimeout(function(){e.remove()},250)" style="flex:1;padding:8px 12px;border-radius:10px;border:none;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.15s;" onmouseover="this.style.opacity=\'0.9\'" onmouseout="this.style.opacity=\'1\'">快速跳过</button>' +
        '</div></div>';
    container.appendChild(wrapper);
    // 滚动到底部
    setTimeout(function() { wrapper.scrollIntoView({behavior:'smooth',block:'nearest'}); }, 100);
};

// 身份快捷设置
window._handleIdentityQuick = function(name) {
    var input = document.querySelector('#agent-chat-input, .chat-input') || document.querySelector('textarea');
    if (input && typeof window.sendMessage === 'function') {
        // 作为内部消息静默发送
        var msgs = chats[currentChatId]?.messages;
        if (msgs) {
            msgs.push({role:'user',text:'请称呼我' + name + '。我已经设置好了,从现在开始按这个身份对话。',_internal:true});
        }
    }
};

/**
 * ★ 记忆v2: 统一内存上下文对象 (替代旧的8个全局变量)
 */
window.__memoryContext = {
    contextBlock: null,   // 预格式化的 system prompt 块
    persona: null,        // 人格信息
    identity: null,       // 用户身份
    facts: [],            // 事实列表
    episodes: [],         // 最近对话
    presetId: null,       // 当前人格预设ID
    lastUpdated: null,
};

// ★ 安全 JSON 请求辅助函数（拦截 429、5xx 和非 JSON HTML 响应，防止 Unexpected token '<' 报错）
async function _safeFetchEngineJson(url, options) {
    try {
        var resp = await fetch(url, options);
        if (resp.status === 429) {
            // 限流静默降级
            return { ok: false, error: 'rate_limit', status: 429 };
        }
        var contentType = resp.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            return { ok: false, error: 'invalid_content_type', status: resp.status };
        }
        return await resp.json();
    } catch(e) {
        return { ok: false, error: e.message || 'fetch_failed' };
    }
}

// 内存上下文并发锁与 TTL 缓存
var _inFlightMemoryPromise = null;
var _lastMemoryFetchTime = 0;
var MEMORY_CACHE_TTL_MS = 15000; // 15秒缓存，避免多端事件并发打爆 nginx

/**
 * ★ 记忆v2: 刷新统一内存上下文 (带防并发、TTL缓存与429静默降级)
 */
window.refreshMemoryContext = async function(force) {
    var token = localStorage.getItem('authToken');
    if (!token) return;

    var now = Date.now();
    if (!force && (now - _lastMemoryFetchTime < MEMORY_CACHE_TTL_MS) && window.__memoryContext.lastUpdated) {
        return;
    }

    if (_inFlightMemoryPromise) {
        return _inFlightMemoryPromise;
    }

    _inFlightMemoryPromise = (async function() {
        try {
            // 1. 加载记忆上下文
            var data = await _safeFetchEngineJson('/oneapichat/api/engine_api.php?action=memory_context', {
                signal: AbortSignal.timeout(10000),
                headers: _agentAuthHeaders()
            });
            if (data && data.ok && data.context) {
                window.__memoryContext.contextBlock = data.context;
                window.__memoryContext.lastUpdated = Date.now();
                _lastMemoryFetchTime = Date.now();
            }

            // 2. 加载人格预设信息
            var pdata = await _safeFetchEngineJson('/oneapichat/api/engine_api.php?action=personality_load', {
                signal: AbortSignal.timeout(8000),
                headers: _agentAuthHeaders()
            });
            if (pdata && pdata.ok && pdata.personality) {
                window.__memoryContext.persona = pdata.personality.constitution || {};
                window.__memoryContext.identity = pdata.personality.narrative || {};
                window.__memoryContext.presetId = pdata.personality.preset_id;
            }
        } catch(e) {
            // 优雅降级
        } finally {
            _inFlightMemoryPromise = null;
        }
    })();

    return _inFlightMemoryPromise;
};

/**
 * ★ 记忆v2: 加载人格预设列表
 */
window.loadPersonalityPresets = async function() {
    try {
        var data = await _safeFetchEngineJson('/oneapichat/api/engine_api.php?action=personality_presets', {
            signal: AbortSignal.timeout(5000)
        });
        return (data && data.ok) ? data.presets : [];
    } catch(e) { return []; }
};

/**
 * ★ 记忆v2: 设置人格预设
 */
window.setPersonalityPreset = async function(presetId) {
    if (!presetId) return;
    // ★ 立即保存到 localStorage 确保刷新不丢失
    localStorage.setItem('personalityPreset', presetId);
    var token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        var resp = await fetch('/oneapichat/api/engine_api.php?action=personality_set_preset', {
            method: 'POST',
            headers: _agentAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ preset: presetId })
        });
        var data = await resp.json();
        if (data.ok) {
            showToast('人格已设为: ' + presetId, 'success');
            if (window.refreshMemoryContext) window.refreshMemoryContext();
            if (window.refreshMemoryList) window.refreshMemoryList();
        }
    } catch(e) { console.warn('[Personality] set preset failed:', e); }
};

/**
 * ★ 恢复上次选择的人格(从localStorage)
 */
window.restorePersonalityPreset = async function() {
    var saved = localStorage.getItem('personalityPreset');
    if (saved) {
        var sel = document.getElementById('personalityPreset');
        if (sel) sel.value = saved;
        // 异步加载引擎端人格上下文
        if (window.refreshMemoryContext) window.refreshMemoryContext();
    }
};

/**
 * 在 Agent 聊天加载时,从引擎加载记忆/人格/身份并注入 system prompt
 * ★ v2: 优先使用新记忆端点,旧端点作为回退
 */
async function _injectAgentMemoryIntoSystem(chatId) {
    if (chatId !== AGENT_CHAT_ID) return;
    var chat = chats[chatId];
    if (!chat || !chat.messages) return;

    try {
        // ★ v2: 先尝试统一的 memory/context 端点
        await window.refreshMemoryContext();
        var ctxBlock = window.__memoryContext.contextBlock;

        if (ctxBlock) {
            // 使用新版上下文块
            var sysIdx = chat.messages.findIndex(function(m) { return m.role === 'system'; });
            if (sysIdx !== -1) {
                var existingContent = chat.messages[sysIdx].content;
                // 移除旧的记忆注入块
                existingContent = existingContent.replace(/\n*## 人格设定[\s\S]*?(\n## (?!人格)|$)/, '');
                existingContent = existingContent.replace(/\n*## 长期记忆[\s\S]*?(\n## (?!长期)|$)/, '');
                existingContent = existingContent.replace(/\n*## 用户信息[\s\S]*?(\n## (?!用户)|$)/, '');
                existingContent = existingContent.replace(/\n*## 最近对话摘要[\s\S]*?$/, '');
                existingContent = existingContent.trim();
                chat.messages[sysIdx].content = existingContent + '\n\n' + ctxBlock;
            }
            // 同时设置旧缓存兼容
            window.__agentPersonaCache = window.__memoryContext.persona;
            window.__agentIdentityCache = window.__memoryContext.identity;
            window.__agentMemoryCache = window.__memoryContext.facts;
            return;
        }
    } catch(e) {
        console.warn('[Memory v2] context load failed, falling back to legacy:', e);
    }

    // ★ 回退到旧端点
    try {
        var [personaRes, identityRes, memoryRes] = await Promise.all([
            window.loadAgentPersona(),
            window.loadAgentIdentity(),
            window.loadAgentMemory()
        ]);

        window.__agentPersonaCache = null;
        window.__agentIdentityCache = null;
        window.__agentMemoryCache = null;

        var sysIdx = chat.messages.findIndex(function(m) { return m.role === 'system'; });
        let memoryBlock = '';

        if (personaRes && personaRes.ok && personaRes.persona) {
            window.__agentPersonaCache = personaRes.persona;
            var p = personaRes.persona;
            if (p.name) {
                memoryBlock += '\n\n## 人格设定\n';
                memoryBlock += '- AI名称: ' + (p.name || 'AI助手') + '\n';
                if (p.style) memoryBlock += '- 风格: ' + p.style + '\n';
                if (p.preferences) {
                    var prefs = p.preferences;
                    if (prefs.language) memoryBlock += '- 语言: ' + prefs.language + '\n';
                    if (prefs.response_style) memoryBlock += '- 回复风格: ' + prefs.response_style + '\n';
                }
            }
        }

        if (identityRes && identityRes.ok && identityRes.identity) {
            window.__agentIdentityCache = identityRes.identity;
            var id = identityRes.identity;
            if (id.name || id.notes) {
                memoryBlock += '\n## 用户信息\n';
                if (id.name) memoryBlock += '- 称呼: ' + id.name + '\n';
                if (id.notes) memoryBlock += '- 备注: ' + id.notes + '\n';
                memoryBlock += '- 时区: ' + (id.timezone || 'Asia/Shanghai') + '\n';
                memoryBlock += '- 语言: ' + (id.language || 'zh-CN') + '\n';
            }
        }

        if (memoryRes && memoryRes.ok && memoryRes.entries && memoryRes.entries.length > 0) {
            window.__agentMemoryCache = memoryRes.entries;
            memoryBlock += '\n## 长期记忆\n以下是你与用户的长期记忆(记住这些信息以便后续对话):\n';
            var count = 0;
            for (var i = 0; i < memoryRes.entries.length && count < 20; i++) {
                var e = memoryRes.entries[i];
                memoryBlock += '- [' + e.key + '] ' + e.content + '\n';
                count++;
            }
            if (memoryRes.entries.length > 20) {
                memoryBlock += '- ...(还有 ' + (memoryRes.entries.length - 20) + ' 条记忆)\n';
            }
        }

        if (sysIdx !== -1) {
            var existingContent = chat.messages[sysIdx].content;
            existingContent = existingContent.replace(/\n*## 人格设定[\s\S]*?## 用户信息[\s\S]*?## 长期记忆[\s\S]*?(?=\n## |$)/, '');
            existingContent = existingContent.replace(/\n*## 人格设定[\s\S]*?## 长期记忆[\s\S]*?(?=\n## |$)/, '');
            existingContent = existingContent.replace(/\n*## 人格设定[\s\S]*?(?=\n## |$)/, '');
            existingContent = existingContent.trim();
            if (memoryBlock) {
                chat.messages[sysIdx].content = existingContent + memoryBlock;
            }
        }
    } catch(e) {
        console.warn('[AgentMemory] 注入失败:', e);
    }
}

// ── Agent 心跳定时器 ────────────────────────────

/** 启动 Agent 心跳定时器(每30秒上报一次) */
let _agentHeartbeatTimer = null;

function _startAgentHeartbeatIfNeeded() {
    if (!isAgentToolsActive()) {
        if (_agentHeartbeatTimer) {
            clearInterval(_agentHeartbeatTimer);
            _agentHeartbeatTimer = null;
        }
        return;
    }
    if (_agentHeartbeatTimer) return; // 已启动

    // 首次立即上报
    window.agentHeartbeat('active', 'neutral', currentChatId);

    _agentHeartbeatTimer = setInterval(function() {
        if (!isAgentToolsActive()) {
            clearInterval(_agentHeartbeatTimer);
            _agentHeartbeatTimer = null;
            return;
        }
        window.agentHeartbeat('active', 'neutral', currentChatId);
    }, 30000);
}

// 在 setAgentMode 后启动心跳 + 关闭popup
(function() {
    var origSetAgentMode = window.setAgentMode;
    window.setAgentMode = function(mode, fromToggle) {
        origSetAgentMode(mode, fromToggle);
        // ★ 选完关闭 popup(桌面端hover也适用)
        var popup = getEl('agentModePopup');
        if (popup) popup.classList.remove('show');
        _startAgentHeartbeatIfNeeded();
    };
})();


// ★ 会话级自动批准开关
window.toggleSessionAutoApprove = function() {
    window._sessionAutoApprove = !window._sessionAutoApprove;
    var btn = document.getElementById('sessionAutoApproveBtn');
    if (btn) {
        btn.classList.toggle('active', window._sessionAutoApprove);
        btn.title = window._sessionAutoApprove ? '✅ 会话自动批准已开启 — 点击关闭' : '会话自动批准 — 本轮免弹窗';
    }
    if (window._sessionAutoApprove) {
        showToast('✅ 会话自动批准已开启: 本轮工具调用免弹窗', 'success', 3000);
    } else {
        showToast('⛔ 会话自动批准已关闭,恢复审批弹窗', 'info', 2000);
    }
};

window.openAgentPanel = function() {
    var ap = $.agentPanel || getEl('agentPanel');
    var cp = $.configPanel || getEl('configPanel');
    if (!ap) return;

    if (isMobile()) {
        // 移动端:关配置面板,用遮罩
        if (cp && typeof window.closeConfigPanel === 'function') window.closeConfigPanel();
        else if (cp) cp.classList.remove('mobile-open');
        ap.style.display = '';
        ap.classList.remove('hidden-panel');
        ap.inert = false;
        ap.setAttribute('aria-hidden', 'false');
        document.querySelectorAll('button[onclick*="toggleAgentPanel"]').forEach(function(btn) { btn.setAttribute('aria-expanded', 'true'); });
        $.sidebarMask?.classList.add('active');
        lockBodyScroll(true);
        window.refreshAgentPanel();
        // 启动定时刷新
        startAgentPanelRefresh();
        return;
    }

    // 桌面端:先关配置面板
    if (cp && !cp.classList.contains('hidden-panel')) {
        if (typeof window.closeConfigPanel === 'function') window.closeConfigPanel();
        else cp.classList.add('hidden-panel');
    }
    // 确保 display 可见,然后移除隐藏类
    ap.style.display = '';
    // 使用 requestAnimationFrame 确保布局正确
    requestAnimationFrame(function() {
        ap.classList.remove('hidden-panel');
    });
    ap.inert = false;
    ap.setAttribute('aria-hidden', 'false');
    document.querySelectorAll('button[onclick*="toggleAgentPanel"]').forEach(function(btn) { btn.setAttribute('aria-expanded', 'true'); });
    // 清除非通知红点
    var dot = getEl('agentNotifDot');
    window.refreshAgentPanel();
    startAgentPanelRefresh();
};

window.closeAgentPanel = function() {
    var ap = $.agentPanel || getEl('agentPanel');
    if (!ap) return;

    // 先移走面板内焦点，再设置 aria-hidden/inert，避免浏览器无障碍警告。
    if (typeof window._moveFocusOutOfPanel === 'function') {
        window._moveFocusOutOfPanel(ap);
    } else if (ap.contains(document.activeElement) && document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
    }

    if (isMobile()) {
        ap.classList.add('hidden-panel');
        ap.inert = true;
        ap.setAttribute('aria-hidden', 'true');
        document.querySelectorAll('button[onclick*="toggleAgentPanel"]').forEach(function(btn) { btn.setAttribute('aria-expanded', 'false'); });
        $.sidebarMask?.classList.remove('active');
        lockBodyScroll(false);
        if (_agentPanelRefreshTimer) {
            clearInterval(_agentPanelRefreshTimer);
            _agentPanelRefreshTimer = null;
        }
        return;
    }

    ap.classList.add('hidden-panel');
    ap.inert = true;
    ap.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('button[onclick*="toggleAgentPanel"]').forEach(function(btn) { btn.setAttribute('aria-expanded', 'false'); });
    if (_agentPanelRefreshTimer) {
        clearInterval(_agentPanelRefreshTimer);
        _agentPanelRefreshTimer = null;
    }
    // 过渡结束后隐藏 display(否则 CSS transition 不生效)
    setTimeout(function() {
        if (ap.classList.contains('hidden-panel')) {
            ap.style.display = 'none';
        }
    }, 350);
};

// 启动代理面板定时刷新
function startAgentPanelRefresh() {
    if (_agentPanelRefreshTimer) clearInterval(_agentPanelRefreshTimer);
    _agentPanelRefreshTimer = setInterval(function() {
        var ap = $.agentPanel || getEl('agentPanel');
        if (!ap || ap.classList.contains('hidden-panel')) {
            clearInterval(_agentPanelRefreshTimer);
            _agentPanelRefreshTimer = null;
            return;
        }
        // ★ 429 退避:若上次被限流,延长等待
        var backoff = window._agentListBackoff || 0;
        if (backoff > 1000) {
            window._agentListBackoff = Math.max(backoff - 1500, 1000); // 每轮递减
            return;
        }
        // 刷新代理列表
        window.refreshAgentPanel();
        // 如果选中了代理,复用已缓存的数据更新聊天内容(不再重复请求)
        if (_selectedAgentName && window._agentListCache) {
            var agents = window._agentListCache;
            var a = agents[_selectedAgentName];
            var msgArea = getEl('agentChatMessages');
            if (msgArea) {
                if (!a) { return; }
                // ★ 只在 agent 状态变化时更新,避免闪烁
                var prevStatus = msgArea.getAttribute('data-status') || '';
                if (a.status === prevStatus && prevStatus === 'completed') return;
                msgArea.setAttribute('data-status', a.status || '');
                if (a.status === 'running') {
                    var partial = a.result || '';
                    if (partial) {
                        msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant">' +
                            '<div class="text-xs text-green-500 font-medium mb-1">运行中</div>' +
                            '<div class="text-xs whitespace-pre-wrap text-gray-600 dark:text-gray-300" style="font-size:11px;max-height:200px;overflow-y:auto;">' + escapeHtml(partial.substring(0, 2000)) + '</div></div>';
                    } else {
                        msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant"><div class="text-xs text-green-500 font-medium">运行中...</div></div>';
                    }
                } else if (a.result) {
                    if (prevStatus !== 'completed') {
                        msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant">' +
                            '<div class="text-xs text-gray-400 mb-1">' + escapeHtml(_selectedAgentName) + '</div>' +
                            '<div class="text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300">' + escapeHtml(a.result.substring(0, 3000)) + '</div></div>';
                        var key = 'agent_chat_' + _selectedAgentName;
                        localStorage.setItem(key, JSON.stringify([{ role: 'assistant', content: a.result, time: Date.now() }]));
                    }
                }
            }
        }

    }, 15000); // ★ 15s 一轮,避免触发 nginx 限流
}

window.toggleAgentPanel = function() {
    var ap = $.agentPanel || getEl('agentPanel');
    if (!ap) return;
    if (ap.classList.contains('hidden-panel')) {
        window.openAgentPanel();
    } else {
        window.closeAgentPanel();
    }
};

window._agentListCache = {};
window._agentListFetchFailures = 0;
window._agentListNextRetryAt = 0;

function _isAgentListTimeoutError(e) {
    return !!e && (e.name === 'TimeoutError' || e.name === 'AbortError' || /timed out|timeout/i.test(String(e.message || '')));
}

window._renderAgentList = function(agents, container) {
    if (!container) return;
    var names = Object.keys(agents);
    if (names.length === 0) {
        container.innerHTML = '<div class="text-xs text-gray-400 p-2">暂无子代理</div>';
        return;
    }
    // ★ 角色颜色映射
    var roleColors = {'explorer':'#27AE60','planner':'#F39C12','developer':'#E74C3C','verifier':'#9B59B6','general':'#4A90D9'};
    var roleLabels = {'explorer':'🔍搜','planner':'📐规','developer':'⚡开','verifier':'✅验','general':'🌐全'};
    container.innerHTML = names.map(function(name) {
        var a = agents[name];
        // ★ 解析_structured字段(存储时是JSON字符串)
        if (a._structured && typeof a._structured === 'string') {
            try { a._structured = JSON.parse(a._structured); } catch(e) {}
        }
        var dotClass = a.status === 'running' ? 'running' : a.status === 'completed' ? 'completed' : a.status === 'failed' ? 'offline' : 'idle';
        var safeName = escapeHtml(name);
        var statusColor = a.status==='completed'?'#6366f1' : a.status==='failed'?'#ef4444' : a.status==='running'?'#10b981' : '#9ca3af';
        var role = a.role || 'general';
        var roleColor = roleColors[role] || '#9ca3af';
        var roleLabel = roleLabels[role] || role;

        // ★ 增强信息: 进度/工具/错误详情
        var extraInfo = '';
        if (a.status === 'running') {
            var stepInfo = '';
            if (typeof a._step !== 'undefined' && a._step > 0) {
                stepInfo = ' (' + a._step + '/' + (a._maxSteps || '?') + '步)';
            }
            var toolInfo = a._lastTool ? ' 🔧' + a._lastTool : '';
            extraInfo = '<span class="text-xs text-green-500" style="font-size:10px;">⏳运行中' + stepInfo + toolInfo + '</span>';
        } else if (a.status === 'failed') {
            var errPreview = (a.error || a.result || '').substring(0, 80);
            extraInfo = '<div class="text-xs text-red-500 mt-0.5" style="font-size:10px;line-height:1.3;">⚠️ ' + escapeHtml(errPreview) + '</div>';
        } else if (a.result) {
            var summary = (a._structured && a._structured.summary) ? a._structured.summary : a.result.substring(0, 60);
            extraInfo = '<div class="text-xs text-gray-400 truncate mt-0.5" style="font-size:10px;">' + escapeHtml(summary) + '</div>';
        } else {
            extraInfo = '<span class="text-xs text-gray-400" style="font-size:10px;">' + (a.status || 'idle') + '</span>';
        }

        return '<div class="agent-sub-item' + (a.status==='failed'?' agent-sub-item-failed':'') + '" onclick="window.selectAgentChat(\'' + safeName + '\')">' +
            '<div class="flex items-center gap-2 min-w-0 flex-1">' +
                '<span class="agent-sub-dot ' + dotClass + '"></span>' +
                '<div class="min-w-0 flex-1">' +
                    '<span class="text-xs font-medium truncate block">' + safeName + '</span>' +
                    '<div class="flex gap-1 items-center mt-0.5">' +
                        '<span class="text-xs" style="color:' + roleColor + ';font-weight:500;">' + roleLabel + '</span>' +
                        extraInfo +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="flex items-center gap-1 flex-shrink-0">' +
                '<span class="text-xs" style="color:' + statusColor + ';font-weight:500;font-size:10px;">' + (a.status || 'idle') + '</span>' +
                '<button onclick="event.stopPropagation();window.deleteAgent(\'' + safeName + '\');" class="p-1 text-gray-400 hover:text-red-500 transition" title="删除子代理"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>' +
            '</div>' +
        '</div>';
    }).join('');
};

/**
 * ★ 公共 agent_list 获取器 — 统一处理 429 退避 + content-type 校验 + JSON 解析 + 客户端去重
 * 所有需要 agent_list 数据的调用方都应使用此函数,避免各自重复防护逻辑导致 429 崩溃
 * @returns {Promise<object|null>} agents 对象,失败时返回缓存或 null
 */
window._fetchAgentListJSON = async function() {
    var token = getAuthToken();
    if (!token) return null;
    // ★ 客户端最小请求间隔:防多调用方堆叠触发 nginx 429
    var now = Date.now();
    if (now < (window._agentListNextRetryAt || 0)) return window._agentListCache || null;
    var minInterval = (window._agentListBackoff && window._agentListBackoff > 1000) ? window._agentListBackoff : 3000;
    if (now - (window._agentListLastReq || 0) < minInterval) {
        return window._agentListCache || null;
    }
    window._agentListLastReq = now;
    try {
        // agent_list 只是侧栏辅助信息，不能用一个30秒悬挂请求拖慢主聊天输出。
        var r = await fetch(_apiBase + '?action=agent_list', { signal: AbortSignal.timeout(8000), headers: _agentAuthHeaders() });
        // ★ 429 退避:nginx 限流时返回 HTML,不能直接 json()
        if (r.status === 429) {
            window._agentListBackoff = Math.min((window._agentListBackoff || 1000) * 2, 60000);
            console.warn('[AgentPanel] 429 限流,退避 ' + window._agentListBackoff + 'ms');
            return window._agentListCache || null;
        }
        window._agentListBackoff = 1000; // 成功后重置
        window._agentListFetchFailures = 0;
        window._agentListNextRetryAt = 0;
        var ctype = r.headers.get('content-type') || '';
        if (!ctype.includes('json')) {
            throw new Error('引擎返回非 JSON 数据 (HTTP ' + r.status + ')');
        }
        var agents = await r.json();
        if (typeof agents !== 'object' || agents === null || Array.isArray(agents)) {
            throw new Error('引擎返回无效数据');
        }
        window._agentListCache = agents;
        window._agentListCacheTime = now;
        return agents;
    } catch(e) {
        window._agentListFetchFailures = (window._agentListFetchFailures || 0) + 1;
        var _retryMs = Math.min(60000, 3000 * Math.pow(2, Math.min(window._agentListFetchFailures - 1, 4)));
        window._agentListNextRetryAt = Date.now() + _retryMs;
        if (_isAgentListTimeoutError(e)) {
            // 面板刷新超时是非关键辅助请求：保留缓存、退避重试，不向控制台制造持续 WARN，
            // 更不能影响主聊天流的 typing/输出状态。
            console.info('[AgentPanel] 列表刷新超时，保留缓存并在 ' + _retryMs + 'ms 后重试');
        } else {
            console.warn('[AgentPanel] 获取失败:', e.message);
        }
        return window._agentListCache || null;
    }
};

window._refreshAllAgentLists = async function(_opts) {
    _opts = _opts || {};
    var token = getAuthToken();
    if (!token) return;
    // ★ 调用方已持有 agents 数据,直接渲染不发请求
    if (_opts._inheritedAgents) {
        var inherited = _opts._inheritedAgents;
        window._agentListCache = inherited;
        window._agentListCacheTime = Date.now();
        window._renderAgentList(inherited, getEl('agentSubList'));
        window._renderAgentList(inherited, getEl('engineAgentList'));
        var dptuiInh = getEl('agentSubListDptui');
        if (dptuiInh && dptuiInh !== getEl('agentSubList')) window._renderAgentList(inherited, dptuiInh);
        return;
    }
    // ★ 防止并发重复请求:已有 in-flight 请求时静默跳过
    if (window._agentListInFlight) return;
    window._agentListInFlight = true;
    try {
        var agents = await window._fetchAgentListJSON();
        if (!agents) {
            var msg = '加载失败: 无数据';
            var lists = ['agentSubList', 'agentSubListDptui', 'engineAgentList'];
            lists.forEach(function(id) {
                var el = getEl(id);
                if (el) el.innerHTML = '<div class="text-xs text-gray-500 p-2" style="font-size:10px;">' + escapeHtml(msg) + '</div>';
            });
            return;
        }
        window._renderAgentList(agents, getEl('agentSubList'));
        window._renderAgentList(agents, getEl('engineAgentList'));
        var dptuiContainer = getEl('agentSubListDptui');
        if (dptuiContainer && dptuiContainer !== getEl('agentSubList')) window._renderAgentList(agents, dptuiContainer);
    } catch(e) {
        // 显示错误但不中断,保留上次缓存
        var msg2 = '加载失败: ' + e.message;
        var lists2 = ['agentSubList', 'agentSubListDptui', 'engineAgentList'];
        lists2.forEach(function(id) {
            var el = getEl(id);
            if (el) el.innerHTML = '<div class="text-xs text-gray-500 p-2" style="font-size:10px;">' + escapeHtml(msg2) + '</div>';
        });
        if (window._agentListCacheTime && Date.now() - window._agentListCacheTime > 30000) {
            window._agentListCache = {};
        }
        console.warn('[AgentPanel] 刷新失败:', e.message);
    } finally {
        window._agentListInFlight = false;
    }
};

window.refreshAgentPanel = window._refreshAllAgentLists;

/** 更新 Agent 面板中的费用/用量显示 */
function updateAgentUsageDisplay() {
    var usageEl = getEl('agentUsageDisplay');
    if (!usageEl) return;
    var cost = sessionUsage.totalCost.toFixed(4);
    var pt = sessionUsage.promptTokens;
    var ct = sessionUsage.completionTokens;
    var cacheHits = sessionUsage.prefixCacheHits;
    var toolCalls = sessionUsage.toolCalls;
    // 使用增强可视化
    usageEl.innerHTML = usageVisualizer.fullDisplay();
}

/** 实时用量更新 (轻量级,仅更新数字不刷新全组件) */
function updateUsageLive() {
    // 保留给未来实时更新使用
}

/** 重置会话用量统计 */
function resetSessionUsage() {
    sessionUsage = { promptTokens: 0, completionTokens: 0, totalCost: 0, prefixCacheHits: 0, toolCalls: 0, approvalsGranted: 0, approvalsRejected: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
    toolCallStats.reset();
    // 清除会话级别审批记忆
    sessionStorage.removeItem('approvalRemembered');
    updateAgentUsageDisplay();
}

function _agentDisplayText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
}

window.selectAgentChat = function(agentName) {
    _selectedAgentName = agentName;
    getEl('agentChatTitle').innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg> ' + escapeHtml(agentName);
    var msgArea = getEl('agentChatMessages');
    // 从 localStorage 读取该代理的聊天记录
    var key = 'agent_chat_' + agentName;
    var msgs = [];
    try {
        var cachedMsgs = JSON.parse(localStorage.getItem(key) || '[]');
        msgs = Array.isArray(cachedMsgs) ? cachedMsgs : [];
    } catch (e) {
        localStorage.removeItem(key);
    }
    if (msgs.length === 0) {
        var token = getAuthToken();
        if (!token) { msgArea.innerHTML = '<div class="text-xs text-gray-400">请先登录</div>'; return; }
        msgArea.innerHTML = '<div class="text-xs text-gray-400">获取中...</div>';
        window._fetchAgentListJSON().then(function(agents) {
            if (!agents) { msgArea.innerHTML = '<div class="text-xs text-gray-400">加载失败(限流中)</div>'; return; }
            var a = agents[agentName];
            if (!a) { msgArea.innerHTML = '<div class="text-xs text-gray-400">代理不存在(可能已被删除)</div>'; return; }
                if (a.status === 'running') {
                    var stepInfo = '';
                    if (typeof a._step !== 'undefined' && a._step > 0) stepInfo = ' · 步骤 ' + a._step + '/' + (a._maxSteps || '?');
                    var toolInfo = a._lastTool ? ' · 🔧' + a._lastTool : '';
                    var partial = _agentDisplayText(a.result || '');
                    if (partial) {
                        msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant">' +
                            '<div class="text-xs text-green-500 font-medium mb-1">⏳ 运行中' + stepInfo + toolInfo + '</div>' +
                            '<div class="text-xs whitespace-pre-wrap text-gray-600 dark:text-gray-300" style="font-size:11px;max-height:300px;overflow-y:auto;">' + escapeHtml(partial.substring(0, 2000)) + '</div>' +
                            '<div class="text-xs text-gray-400 mt-1">实时更新中...</div></div>';
                    } else {
                        msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant">' +
                            '<div class="text-xs text-green-500 font-medium">⏳ 正在初始化...</div>' +
                            '<div class="text-xs text-gray-400 mt-1">子代理启动后将显示实时进度</div></div>';
                    }
                    return;
                }
                if (a.status === 'failed') {
                    var errText = _agentDisplayText(a.error || a.result || '未知错误');
                    msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant" style="border-left:3px solid #ef4444;">' +
                        '<div class="text-xs text-red-500 font-medium mb-1">❌ 执行失败</div>' +
                        '<div class="text-xs text-red-600 dark:text-red-400 mb-2" style="font-size:11px;">' + escapeHtml(errText.substring(0, 500)) + '</div>' +
                        '<div class="text-xs text-gray-400">💡 建议: 检查错误信息后重新创建子代理, 或让主代理直接处理</div></div>';
                    var ms = [{ role: 'assistant', content: '失败: ' + errText, time: Date.now() }];
                    localStorage.setItem(key, JSON.stringify(ms));
                    return;
                }
                if (a.result) {
                        var rEl = getEl('agentChatMessages');
                        if (rEl) {
                            var structured = a._structured || null;
                            var resultHtml = '<div class="agent-chat-bubble role-assistant">' +
                                '<div class="text-xs text-gray-400 mb-1">' + escapeHtml(agentName) + ' · ✅完成</div>';
                            if (structured && structured.summary) {
                                resultHtml += '<div class="text-xs font-medium text-gray-800 dark:text-gray-200 mb-2" style="font-size:11px;">📋 ' + escapeHtml(_agentDisplayText(structured.summary)) + '</div>';
                            }
                            resultHtml += '<div class="text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300">' + escapeHtml(_agentDisplayText(a.result).substring(0, 3000)) + '</div>' +
                                '</div>';
                            rEl.innerHTML = resultHtml;
                        }
                        var ms2 = [{ role: 'assistant', content: _agentDisplayText(a.result), time: Date.now() }];
                        localStorage.setItem(key, JSON.stringify(ms2));
                    }
                }).catch(function(err) {
                    msgArea.innerHTML = '<div class="text-xs text-red-400 p-2">加载失败: ' + escapeHtml(err.message) + '</div>';
                });
        return;
    } else {
        msgArea.innerHTML = msgs.map(function(m) {
            var roleClass = m.role === 'user' ? 'role-user' : 'role-assistant';
            return '<div class="agent-chat-bubble ' + roleClass + '">' +
                '<div class="text-xs text-gray-400 mb-1">' + (m.role === 'user' ? '你' : escapeHtml(agentName)) + ' · ' + new Date(m.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) + '</div>' +
                '<div class="text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300">' + escapeHtml(m.content || '') + '</div>' +
                '</div>';
        }).join('');
    }
};

window.mainAgentReply = function() {
    var statusEl = getEl('agentReplyStatus');
    if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.textContent = '正在触发主代理思考...';
    }
    var token = getAuthToken();
    if (!token) { if (statusEl) statusEl.textContent = '❌ 未登录'; return; }
    fetch(_apiBase + '?action=agent_notifications', { signal: AbortSignal.timeout(30000), headers: _agentAuthHeaders() })
        .then(function(r) {
            var ct = r.headers.get('content-type') || '';
            if (!r.ok || !ct.includes('json')) throw new Error('通知接口返回异常 (HTTP ' + r.status + ')');
            return r.json();
        })
        .then(function(data) {
            if (!data || data.count === 0) {
                if (statusEl) statusEl.textContent = '没有新的子代理结果';
                return;
            }
            // ★ 保存结果数据并通过标准流程处理(由 triggerAgentAutoReplyForSubAgent 统一管理队列和 mark)
            (data.notifications || []).forEach(function(n) {
                if (!window._pendingSubAgentResultsData) window._pendingSubAgentResultsData = {};
                window._pendingSubAgentResultsData[n.agent] = {
                    status: n.status || 'completed',
                    result: n.result || '',
                    error: n.error || ''
                };
                if (isAgentToolsActive()) {
                    window.triggerAgentAutoReplyForSubAgent(n.agent);
                }
            });
            if (statusEl) statusEl.textContent = '✅ ' + data.count + ' 条结果已转发给主代理';
        }).catch(function() {
            if (statusEl) statusEl.textContent = '❌ 请求失败';
        });
};

// ★ ask_agent 临时权限指示灯 — agent 按钮上的圆点呼吸绿光
function _updateTempGrantBanner(active) {
    var dot = document.querySelector('.agent-split-btn .agent-dot');
    if (!dot) return;
    if (active) {
        dot.classList.add('temp-grant');
    } else {
        dot.classList.remove('temp-grant');
    }
}

// ★ 侧边栏模式同步标记: 仅模式切换时强制收起/展开一次,
//   避免状态刷新(心跳/SSE/通知)反复调用 updateAgentUI 覆盖用户手动展开的侧边栏
var _lastSidebarSyncMode = null;
function updateAgentUI() {
    var mode = getAgentMode();
    var isActive = mode !== 'off';  // ★ plan/agent/yolo 都算激活
    // 更新三模式选择器按钮
    updateModeSelector(mode);
    // ★ 更新主按钮上的文字
    var mainBtn = document.getElementById('agentMainBtn');
    if (mainBtn) {
        var lbl = mainBtn.querySelector('.agent-btn-label');
        if (lbl) {
            var texts = { 'off': 'Agent', 'plan': 'Plan', 'agent': 'Agent', 'yolo': 'YOLO' };
            lbl.textContent = texts[mode] || 'Agent';
        }
    }
    // Header Agent 按钮圆点
    var splitBtn = getEl('agentSplitBtn');
    if (splitBtn) {
        splitBtn.classList.toggle('active', isActive);
    }
    // 圆点颜色 — 仅在非 Agent 模式+临时授权时跳过(temp-grant CSS 处理绿色呼吸)
    // Agent/Plan/YOLO 模式下始终设置对应颜色(不受临时授权影响)
    var dot = splitBtn ? splitBtn.querySelector('.agent-dot') : null;
    if (dot) {
        dot.style.removeProperty('background');
        dot.style.removeProperty('box-shadow');
        // ★ 跳过条件: 仅在非 Agent 模式 + 有临时授权时(让 temp-grant CSS 接管)
        var _skipForTemp = (mode === 'off' && window._tempAgentGranted);
        if (!_skipForTemp && mode !== 'off') {
            var dotColors = { 'plan': '#3b82f6', 'agent': '#22c55e', 'yolo': '#ef4444' };
            dot.style.setProperty('background', dotColors[mode] || dotColors['off'], 'important');
            var dotShadow = { 'plan': '0 0 6px rgba(59,130,246,0.6)', 'agent': '0 0 6px rgba(34,197,94,0.6)', 'yolo': '0 0 6px rgba(239,68,68,0.6)' };
            dot.style.setProperty('box-shadow', dotShadow[mode] || 'none', 'important');
        }
        // off 模式 + 无临时授权: 清除 inline style,让 CSS 默认样式接管
    }
    // 配置面板开关
    var configToggle = getEl('agentModeToggle');
    if (configToggle) {
        configToggle.checked = isActive;
    }
    // SVG 图标定义(不依赖 emoji)
    var _svgIcons = {
        'off': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
        'plan': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
        'agent': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="3"/></svg>',
        'yolo': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L4 21h16L12 3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };
    // 聊天区 Agent 模式标签
    var agentLabel = getEl('agentModeLabel');
    if (agentLabel) {
        var labelTexts = { 'off': 'Agent', 'plan': 'Plan', 'agent': 'Agent', 'yolo': 'YOLO' };
        agentLabel.innerHTML = _svgIcons[mode] + ' ' + (labelTexts[mode] || 'Agent');
    }
    // 输入框上方模式提示（5秒后自动消失）
    var banner = getEl('agentBanner');
    if (banner) {
        if (mode === 'off') {
            banner.classList.add('hidden');
            // 清除自动消失定时器
            if (window.__bannerTimer) { clearTimeout(window.__bannerTimer); window.__bannerTimer = null; }
        } else {
            banner.classList.remove('hidden');
            var tips = { 'plan': 'Plan 规划 · 先出计划后审批执行', 'agent': 'Agent 交互 · AI可操作需审批', 'yolo': 'YOLO 自动 · 所有操作自动批准' };
            var bannerClasses = { 'plan': 'banner-plan', 'agent': 'banner-agent', 'yolo': 'banner-yolo' };
            banner.className = 'agent-banner ' + (bannerClasses[mode] || '');
            banner.innerHTML = '<span class="agent-banner-icon">' + _svgIcons[mode] + '</span>' +
                '<span class="agent-banner-text">' + (tips[mode] || '') + '</span>';
            // ★ 5秒后自动消失
            if (window.__bannerTimer) clearTimeout(window.__bannerTimer);
            window.__bannerTimer = setTimeout(function() {
                var _b = getEl('agentBanner');
                if (_b && !_b.matches(':hover')) _b.classList.add('hidden');
                window.__bannerTimer = null;
            }, 5000);
        }
    }
    // 更新 Agent 面板中的模式标识
    var modeDisplay = getEl('agentModeDisplay');
    if (modeDisplay) {
        var modeSymbolSvg = _svgIcons[mode] || _svgIcons['off'];
        modeDisplay.innerHTML = modeSymbolSvg + ' ' + mode.charAt(0).toUpperCase() + mode.slice(1);
    }
    // ★ Agent/YOLO 模式下自动启用工具调用,隐藏工具调用开关
    var toolCallToggle = getEl('searchToolCallToggle');
    var toolCallRow = toolCallToggle ? toolCallToggle.closest('.config-toggle-row') : null;
    if (isActive) {
        if (toolCallToggle && !toolCallToggle.checked) {
            toolCallToggle.checked = true;
            localStorage.setItem('searchToolCall', 'true');
        }
        if (toolCallRow) {
            toolCallRow.style.opacity = '0.5';
            toolCallRow.style.pointerEvents = 'none';
            toolCallRow.title = 'Agent 模式下自动启用工具调用';
        }
        // 启动心跳轮询 + 实时更新
        window.startAgentRealtimeUpdates();
    } else {
        if (toolCallRow) {
            toolCallRow.style.opacity = '1';
            toolCallRow.style.pointerEvents = 'auto';
            toolCallRow.title = '';
        }
    }
    // 更新 body class 用于 CSS 控制
    // ★ 侧边栏初始状态: Agent/Plan/YOLO 收起, Off 展开
    //   (仅模式切换时强制执行一次 — 用户在 Agent 模式手动展开的侧边栏不被状态刷新覆盖)
    if (_lastSidebarSyncMode !== mode) {
        _lastSidebarSyncMode = mode;
        if (mode === 'off') {
            if ($.sidebar?.classList.contains('collapsed')) {
                $.sidebar.classList.remove('collapsed');
                if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
            }
        } else {
            if ($.sidebar && !$.sidebar.classList.contains('collapsed')) {
                $.sidebar.classList.add('collapsed');
                if ($.sidebarToggle) $.sidebarToggle.style.display = 'inline-flex';
            }
        }
    }
    document.body.classList.toggle('agent-active', isActive);

    // ★ 智能更新 DSH 风格 Agent Composer 卡片式输入框与胶囊
    var inputWrap = document.getElementById('inputWrapper');
    var agentTop = document.getElementById('agentComposerTop');
    var agentBottom = document.getElementById('agentComposerBottom');
    var input = $.userInput || getEl('userInput');

    if (isActive) {
        if (inputWrap) inputWrap.classList.add('agent-composer-active');
        if (agentTop) agentTop.classList.remove('hidden');
        if (agentBottom) agentBottom.classList.remove('hidden');
        if (input) input.placeholder = '输入指令，或使用 / 查看命令，@ 引用文件...';

        // ★ 运行模式胶囊 (经典 Plan / Agent / YOLO 三模式)
        var modeCapName = document.getElementById('agentModeCapsuleName');
        var modeCapIcon = document.getElementById('agentModeCapsuleIcon');
        if (modeCapName) {
            var modeNames = { 'plan': 'Plan 模式', 'agent': 'Agent 模式', 'yolo': 'YOLO 模式' };
            modeCapName.textContent = modeNames[mode] || 'Agent 模式';
        }
        if (modeCapIcon) {
            var modeIcons = {
                'plan': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path><rect x="9" y="3" width="6" height="4" rx="1"></rect><path d="M9 14l2 2 4-4"></path></svg>',
                'agent': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v4m0 2v6" stroke-linecap="round"></path><circle cx="12" cy="8" r="1.5" fill="currentColor" stroke="none"></circle></svg>',
                'yolo': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"></polygon></svg>'
            };
            modeCapIcon.innerHTML = modeIcons[mode] || modeIcons['agent'];
        }

        // ★ 工作区权限胶囊 (DSH: Read only / Workspace write / Full access 彻底独立)
        window._updatePermissionUI && window._updatePermissionUI();

        // 更新模型胶囊显示
        var modelCapName = document.getElementById('agentModelCapsuleName');
        var curModelSel = document.getElementById('modelSelect');
        if (modelCapName && curModelSel) {
            var opt = curModelSel.options[curModelSel.selectedIndex];
            var mName = opt ? (opt.text || opt.value) : (curModelSel.value || 'AI 模型');
            modelCapName.textContent = mName;
        }

        // 刷新工作区胶囊
        if (window.WorkspaceManager && typeof window.WorkspaceManager.renderUI === 'function') {
            window.WorkspaceManager.renderUI();
        }
    } else {
        if (inputWrap) inputWrap.classList.remove('agent-composer-active');
        if (agentTop) agentTop.classList.add('hidden');
        if (agentBottom) agentBottom.classList.add('hidden');
        if (input) input.placeholder = '输入消息，键入 / 使用命令';
    }

    // 重绘左侧历史侧边栏（Agent模式下按工作区分组，普通模式下按时间分组）
    if (typeof renderChatHistory === 'function') {
        renderChatHistory();
    }

    // 过滤命令列表
    _updateCommandFilter(mode);
}

// ==========================================================================
//  DSH 工作区权限管理 (Read only / Workspace write / Full access)
// ==========================================================================
window.getWorkspacePermission = function() {
    var perm = localStorage.getItem('workspacePermission');
    if (['read-only', 'workspace-write', 'danger-full-access'].indexOf(perm) === -1) {
        perm = 'danger-full-access';
        try { localStorage.setItem('workspacePermission', perm); } catch (e) {}
    }
    return perm;
};

window.setWorkspacePermission = function(perm) {
    if (['read-only', 'workspace-write', 'danger-full-access'].indexOf(perm) === -1) {
        perm = 'danger-full-access';
    }
    localStorage.setItem('workspacePermission', perm);
    window._updatePermissionUI(perm);
    if (perm === 'danger-full-access') {
        var _curChat = window.currentChatId || (typeof currentChatId !== 'undefined' ? currentChatId : null);
        if (_curChat && typeof window.grantFullFileAccess === 'function') {
            window.grantFullFileAccess(_curChat, ['filesystem.read','filesystem.search','filesystem.write','filesystem.move','terminal.exec']).catch(function(){});
        }
    }
    // 权限选择与模式选择一样：立即保存在本机，并进入账号配置同步队列。
    if (typeof window._scheduleConfigSync === 'function') window._scheduleConfigSync();
    if (window.showToast) {
        var names = {
            'read-only': '🛡️ 已设为 Read only (只读分析)',
            'workspace-write': '✏️ 已设为 Workspace write (工作区写入)',
            'danger-full-access': '⚡ 已设为 Full access (全盘完全访问)'
        };
        window.showToast(names[perm] || '已更新权限', 'success', 1500);
    }
};

window._updatePermissionUI = function(perm) {
    if (!perm) perm = window.getWorkspacePermission();
    var capName = document.getElementById('agentPermCapsuleName');
    var capIcon = document.getElementById('agentPermCapsuleIcon');
    var names = {
        'read-only': 'Read only',
        'workspace-write': 'Workspace write',
        'danger-full-access': 'Full access'
    };
    var icons = {
        'read-only': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
        'workspace-write': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
        'danger-full-access': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"></polygon></svg>'
    };
    if (capName) capName.textContent = names[perm] || 'Full access';
    if (capIcon) capIcon.innerHTML = icons[perm] || icons['danger-full-access'];
};

// ★ 权限弹出菜单
window._togglePermMenu = function(e) {
    if (e) {
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof e.preventDefault === 'function') e.preventDefault();
    }
    var popup = document.getElementById('agentPermPopup');
    var trigger = (e && e.currentTarget) ? e.currentTarget : document.getElementById('agentPermCapsule');
    if (!popup || !trigger) return;

    var isHidden = popup.style.display === 'none' || popup.classList.contains('hidden') || !popup.classList.contains('open');
    window._closeAllDshPopups('perm');

    if (isHidden) {
        var rect = trigger.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.zIndex = '2147483647';
        var bottomSpace = window.innerHeight - rect.top + 8;
        popup.style.bottom = bottomSpace + 'px';
        var leftPos = Math.max(12, Math.min(rect.left, window.innerWidth - 280));
        popup.style.left = leftPos + 'px';
        popup.style.top = 'auto';
        popup.style.right = 'auto';
        popup.style.display = 'flex';
        popup.classList.remove('hidden');
        popup.classList.add('open');
    } else {
        popup.style.display = 'none';
        popup.classList.remove('open');
        popup.classList.add('hidden');
    }
};

// ★ DSH 风格全局浮层统一关闭器
window._closeAllDshPopups = function(except) {
    if (except !== 'workspace' && window.WorkspaceManager && typeof window.WorkspaceManager.closeDropdown === 'function') {
        window.WorkspaceManager.closeDropdown();
    }
    if (except !== 'perm') {
        var permPop = document.getElementById('agentPermPopup');
        if (permPop) {
            permPop.style.display = 'none';
            permPop.classList.remove('open');
            permPop.classList.add('hidden');
        }
    }
    if (except !== 'mode') {
        var modePop = document.getElementById('agentModePopup');
        if (modePop) {
            modePop.style.display = 'none';
            modePop.classList.remove('open');
            modePop.classList.add('hidden');
        }
    }
    if (except !== 'model') {
        var modelPop = document.getElementById('agentModelPopup');
        if (modelPop) {
            modelPop.classList.add('hidden');
            modelPop.style.display = 'none';
        }
        var modelTrigger = document.getElementById('agentModelCapsule');
        if (modelTrigger) modelTrigger.setAttribute('aria-expanded', 'false');
    }
};

// 点击页面任意空白处自动收起浮层
document.addEventListener('click', function(e) {
    var modePop = document.getElementById('agentModePopup');
    var permPop = document.getElementById('agentPermPopup');
    var modelPop = document.getElementById('agentModelPopup');
    var wsPop = document.getElementById('workspaceDropdown');

    if (e.target && e.target.closest && (
        e.target.closest('#agentPermCapsule') ||
        e.target.closest('#agentModeCapsule') ||
        e.target.closest('#agentModelCapsule') ||
        e.target.closest('#workspaceCapsule') ||
        e.target.closest('.dsh-hero-capsule') ||
        e.target.closest('.agent-mode-popup') ||
        e.target.closest('.agent-model-popup') ||
        e.target.closest('.ws-dropdown-card')
    )) {
        return; // 点击在菜单内部或触发器上，不关闭
    }
    window._closeAllDshPopups();
});

// ★ 辅助事件处理: Agent 模式胶囊菜单 (智能向下或向上自适应弹出，防溢出屏幕)
window._toggleAgentModeMenu = function(e) {
    if (e) {
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof e.preventDefault === 'function') e.preventDefault();
    }

    var popup = getEl('agentModePopup') || document.getElementById('agentModePopup');
    var trigger = (e && e.currentTarget) ? e.currentTarget : (getEl('agentModeCapsule') || getEl('agentMainBtn') || document.getElementById('agentModeCapsule'));
    if (!popup || !trigger) return;

    var isHidden = popup.style.display === 'none' || popup.classList.contains('hidden') || !popup.classList.contains('open');
    window._closeAllDshPopups('mode');

    if (isHidden) {
        var rect = trigger.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.zIndex = '2147483647';

        var POP_HEIGHT = 160;
        var spaceBelow = window.innerHeight - rect.bottom;

        // 如果在屏幕上半部分（比如顶部Header处），向下弹出；如果在屏幕下半部分（底部输入框），向上弹出
        if (spaceBelow >= POP_HEIGHT + 10) {
            popup.style.top = (rect.bottom + 6) + 'px';
            popup.style.bottom = 'auto';
        } else {
            popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
            popup.style.top = 'auto';
        }

        var leftPos = Math.max(12, Math.min(rect.left, window.innerWidth - 280));
        popup.style.left = leftPos + 'px';
        popup.style.right = 'auto';
        popup.style.display = 'flex';
        popup.classList.remove('hidden');
        popup.classList.add('open');
    } else {
        popup.style.display = 'none';
        popup.classList.remove('open');
        popup.classList.add('hidden');
    }
};

// ★ DSH 风格模型席位：模型与推理等级分两级进入，等级依据当前模型能力动态生成。
// 发送链路继续复用 unified thinkingIntensity，避免 UI 选择与请求参数分叉。
(function() {
    var _effortLabels = {
        default: 'Default', off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max', ultra: 'Ultra'
    };
    var _effortDescriptions = {
        default: 'Use the model provider default', off: 'Reasoning disabled', minimal: 'Minimal reasoning budget', low: 'Faster responses for simple tasks', medium: 'Balanced speed and depth',
        high: 'More reasoning for complex tasks', xhigh: 'Extended reasoning budget', max: 'Maximum available reasoning', ultra: 'Highest level when supported'
    };
    function _currentAgentModel() {
        var sel = document.getElementById('modelSelect');
        return sel ? (sel.value || '') : '';
    }
    function _agentEfforts(model) {
        var mc = window.MODEL_CONFIGS;
        if (!model || !mc) return [];
        if (typeof mc.getThinkingIntensityLevels === 'function') return mc.getThinkingIntensityLevels(model);
        if (typeof mc.supportsThinkingIntensity !== 'function' || !mc.supportsThinkingIntensity(model)) return [];
        return ['off', 'low', 'medium', 'high'];
    }
    function _effortName(level) { return _effortLabels[level] || level || '默认'; }
    function _renderAgentModelMenu(popup, pane, query) {
        var sel = document.getElementById('modelSelect');
        if (!sel) return;
        var model = _currentAgentModel();
        var levels = _agentEfforts(model);
        var selectedEffort = localStorage.getItem('thinkingIntensity') || 'default';
        if (levels.length && selectedEffort !== 'default' && levels.indexOf(selectedEffort) < 0) selectedEffort = 'medium';
        var options = Array.from(sel.options).filter(function(o) { return o.value; });
        var modelLabel = (sel.options[sel.selectedIndex] || {}).text || model || '未选择';
        var html = '';
        if (pane === 'root') {
            html = '<div class="agent-model-root-list agent-model-settings-list">' +
                '<button type="button" class="agent-model-root-item" data-agent-model-pane="model"><span class="agent-model-setting-label">模型</span><span class="agent-model-setting-value">' + escapeHtml(modelLabel) + '</span><span class="agent-model-root-chevron">›</span></button>';
            if (levels.length) html += '<button type="button" class="agent-model-root-item" data-agent-model-pane="effort"><span class="agent-model-setting-label">推理等级</span><span class="agent-model-setting-value">' + escapeHtml(_effortName(selectedEffort)) + '</span><span class="agent-model-root-chevron">›</span></button>';
            html += '</div>';
        } else if (pane === 'effort') {
            html = '<div class="agent-model-pop-header"><button type="button" class="agent-model-back" data-agent-model-back="1" aria-label="返回模型设置"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button><div class="agent-model-pane-heading"><strong>推理等级</strong><span>' + escapeHtml(modelLabel) + '</span></div></div><div class="agent-model-pop-list agent-effort-list">';
            ['default'].concat(levels).forEach(function(level) {
                html += '<button type="button" class="agent-model-pop-item agent-effort-item ' + (level === selectedEffort ? 'active' : '') + '" data-agent-effort="' + level + '"><span class="agent-model-item-title">' + _effortName(level) + '</span><span class="agent-model-item-val">' + _effortDescriptions[level] + '</span>' + (level === selectedEffort ? '<span class="agent-model-check-icon">✓</span>' : '') + '</button>';
            });
            html += '</div>';
        } else {
            var q = String(query || '').toLowerCase().trim();
            html = '<div class="agent-model-pop-header agent-model-search-header"><button type="button" class="agent-model-back" data-agent-model-back="1" aria-label="返回模型设置"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button><div class="agent-model-search-box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="text" id="agentModelSearchInp" class="agent-model-search-inp" placeholder="搜索模型" value="' + escapeHtml(q) + '"></div></div><div class="agent-model-pop-list custom-scrollbar">';
            var matched = options.filter(function(o) { return !q || o.value.toLowerCase().indexOf(q) >= 0 || (o.text || '').toLowerCase().indexOf(q) >= 0; });
            if (!matched.length) html += '<div class="agent-model-empty">无匹配模型</div>';
            matched.forEach(function(opt) {
                var active = opt.value === model;
                html += '<button type="button" class="agent-model-pop-item ' + (active ? 'active' : '') + '" data-agent-model-value="' + escapeHtml(opt.value) + '"><span class="agent-model-item-title">' + escapeHtml(opt.text || opt.value) + '</span><span class="agent-model-item-val">' + escapeHtml(opt.value) + '</span>' + (active ? '<span class="agent-model-check-icon">✓</span>' : '') + '</button>';
            });
            html += '</div>';
        }
        popup.innerHTML = html;
        var search = document.getElementById('agentModelSearchInp');
        if (search) { search.oninput = function() { _renderAgentModelMenu(popup, 'model', this.value); }; search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
        popup.querySelectorAll('[data-agent-model-pane]').forEach(function(el) { el.onclick = function(event) { event.preventDefault(); event.stopPropagation(); _renderAgentModelMenu(popup, el.dataset.agentModelPane, ''); }; });
        popup.querySelectorAll('[data-agent-model-back]').forEach(function(el) { el.onclick = function(event) { event.preventDefault(); event.stopPropagation(); _renderAgentModelMenu(popup, 'root', ''); }; });
        popup.querySelectorAll('[data-agent-model-value]').forEach(function(el) { el.onclick = function(event) { event.preventDefault(); event.stopPropagation(); window._onSelectAgentModel(el.dataset.agentModelValue); }; });
        popup.querySelectorAll('[data-agent-effort]').forEach(function(el) { el.onclick = function(event) { event.preventDefault(); event.stopPropagation(); window._onSelectAgentEffort(el.dataset.agentEffort); }; });
    }
    window._toggleModelSelectPopup = function(e) {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        var popup = document.getElementById('agentModelPopup');
        var trigger = (e && e.currentTarget) || document.getElementById('agentModelCapsule');
        if (!popup || !trigger) return;
        var open = !popup.classList.contains('hidden') && popup.style.display !== 'none';
        window._closeAllDshPopups('model');
        if (open) { popup.classList.add('hidden'); popup.style.display = 'none'; return; }
        _renderAgentModelMenu(popup, 'root', '');
        var rect = trigger.getBoundingClientRect();
        popup.style.position = 'fixed'; popup.style.zIndex = '2147483647'; popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        popup.style.top = 'auto'; popup.style.left = Math.max(12, Math.min(rect.left - 100, window.innerWidth - 320)) + 'px'; popup.style.right = 'auto'; popup.style.display = 'flex'; popup.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
    };
    window._onSelectAgentEffort = function(level) {
        var model = _currentAgentModel();
        if (level !== 'default' && _agentEfforts(model).indexOf(level) < 0) return;
        localStorage.setItem('thinkingIntensity', level);
        var input = document.getElementById('thinkingIntensity');
        if (input) input.value = level;
        if (typeof window._scheduleConfigSync === 'function') window._scheduleConfigSync();
        window._syncAgentModelCapsule();
        window._closeAllDshPopups();
        if (window.showToast) showToast('已切换思考强度: ' + _effortName(level), 'success', 1500);
    };
})();

// ★ 模型变更自动双向同步
window._syncAgentModelCapsule = function() {
    var sel = document.getElementById('modelSelect');
    var capName = document.getElementById('agentModelCapsuleName');
    var effortName = document.getElementById('agentModelCapsuleEffort');
    var trigger = document.getElementById('agentModelCapsule');
    if (!sel || !capName) return;
    var opt = sel.options[sel.selectedIndex];
    var text = opt ? (opt.text || opt.value) : (sel.value || 'AI 模型');
    capName.textContent = text;
    var model = sel.value || '';
    var supports = window.MODEL_CONFIGS && typeof window.MODEL_CONFIGS.supportsThinkingIntensity === 'function' && window.MODEL_CONFIGS.supportsThinkingIntensity(model);
    var level = localStorage.getItem('thinkingIntensity') || 'medium';
    var labels = {off:'关闭', minimal:'极简', low:'低', medium:'中', high:'高', xhigh:'极高', max:'最高', ultra:'极致'};
    var supportedLevels = window.MODEL_CONFIGS && typeof window.MODEL_CONFIGS.getThinkingIntensityLevels === 'function'
        ? window.MODEL_CONFIGS.getThinkingIntensityLevels(model) : [];
    if (supports && supportedLevels.indexOf(level) < 0) level = supportedLevels.indexOf('medium') >= 0 ? 'medium' : (supportedLevels[0] || '');
    if (effortName) { effortName.textContent = supports && level ? '· ' + (labels[level] || level) : ''; effortName.hidden = !supports; }
    if (trigger) { trigger.title = supports ? '模型与思考强度 (点击切换)' : '当前模型 (点击切换)'; trigger.setAttribute('aria-expanded', 'false'); }
};

window._onSelectAgentModel = function(modelVal) {
    if (!modelVal) return;
    var sel = document.getElementById('modelSelect');
    if (sel) {
        var hasOpt = Array.from(sel.options).some(function(o){ return o.value === modelVal; });
        if (!hasOpt) {
            var opt = document.createElement('option');
            opt.value = modelVal; opt.textContent = modelVal;
            sel.appendChild(opt);
        }
        sel.value = modelVal;
        sel.dispatchEvent(new Event('change'));
    }
    var curP = (typeof getEl === 'function' && getEl('baseUrlProvider')?.value) || localStorage.getItem('baseUrlProvider') || 'custom';
    localStorage.setItem('model', modelVal);
    localStorage.setItem('model_' + curP, modelVal);
    localStorage.setItem('_modelSelectionSavedAt', String(Date.now()));
    window._syncAgentModelCapsule();
    window._closeAllDshPopups();
    if (window.showToast) showToast('已切换模型: ' + modelVal, 'success', 1500);
};

// 页面就绪后绑定 modelSelect 监听器与胶囊点击
document.addEventListener('DOMContentLoaded', function() {
    var sel = document.getElementById('modelSelect');
    if (sel) {
        sel.addEventListener('change', window._syncAgentModelCapsule);
        var obs = new MutationObserver(window._syncAgentModelCapsule);
        obs.observe(sel, { childList: true, subtree: true });
    }
    window._syncAgentModelCapsule();
});

window._toggleAccessInfo = function(e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (window.showToast) {
        var curMode = getAgentMode();
        var msg = curMode === 'yolo'
            ? '🛡️ YOLO 模式：拥有全盘文件系统与终端执行自主权限'
            : (curMode === 'plan' ? '🛡️ Plan 模式：只读分析与计划模式' : '🛡️ Agent 模式：支持全盘文件操作与命令执行，关键操作请求确认');
        showToast(msg, 'info', 3000);
    }
};

// ★ 根据模式过滤命令 (普通模式禁用 Agent 命令)
function _updateCommandFilter(mode) {
    var agentCmds = ['mode', 'model'];
    var isAgent = mode !== 'off';
    SLASH_COMMANDS.forEach(function(c) {
        if (agentCmds.indexOf(c.cmd) !== -1) {
            c._disabled = !isAgent;
        }
    });
}

/** 更新三模式选择器的 UI 状态 */
window._setupAgentPopup = function() {
    var mainBtn = document.getElementById('agentMainBtn');
    if (!mainBtn) return;
    function updateBtnLabel() {
        var el = mainBtn.querySelector('.agent-btn-label');
        if (!el) return;
        var mode = getAgentMode();
        var texts = { 'off': 'Agent', 'plan': 'Plan', 'agent': 'Agent', 'yolo': 'YOLO' };
        el.textContent = texts[mode] || 'Agent';
    }
    updateBtnLabel();
    if (mainBtn._agentPopupBound) return;
    mainBtn._agentPopupBound = true;

    // ★ 恢复经典头部三模式横向小条与独立交互：单击切换选单，双击秒关退出
    window._closeHeaderModePop = function() {
        var miniPop = document.getElementById('headerModeMiniPop');
        if (miniPop) miniPop.classList.add('hidden');
    };

    window._toggleHeaderModePop = function(e) {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        var miniPop = document.getElementById('headerModeMiniPop');
        if (!miniPop) return;
        var isHidden = miniPop.classList.contains('hidden');
        window._closeAllDshPopups();
        if (isHidden) {
            var curMode = getAgentMode();
            var btns = miniPop.querySelectorAll('.header-mode-btn');
            btns.forEach(function(b) {
                b.classList.toggle('active', b.getAttribute('data-mode') === curMode);
            });
            miniPop.classList.remove('hidden');
        } else {
            miniPop.classList.add('hidden');
        }
    };

    var _clickTimer = null;
    var _clickGestureMode = 'off';
    mainBtn.addEventListener('click', function(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }

        // 只把同一手势开始时的状态用于双击判定，不能读取第一击异步切换后的新状态。
        // 这样从 off 双击进入 Agent 时，第二击不会把刚进入的模式误关掉。
        if (_clickTimer) {
            clearTimeout(_clickTimer);
            _clickTimer = null;
            window._closeHeaderModePop();
            if (_clickGestureMode !== 'off') {
                setAgentMode('off', true);
                if (window.showToast) showToast('已退出 Agent 模式', 'info', 1500);
            } else {
                setAgentMode(getPreferredAgentMode());
            }
            _clickGestureMode = 'off';
            return;
        }

        // 第一次点击：延迟等待判断是否为双击；模式偏好由 localStorage 持久保存。
        _clickGestureMode = getAgentMode();
        _clickTimer = setTimeout(function() {
            _clickTimer = null;
            var m = getAgentMode();
            if (_clickGestureMode === 'off') {
                setAgentMode(getPreferredAgentMode());
            } else if (m !== 'off') {
                // 激活状态下单击：展示头部专属三模式横向小按钮条 (与下方输入框菜单完全分离)
                window._toggleHeaderModePop(e);
            }
            _clickGestureMode = 'off';
        }, 220);
    });

    document.addEventListener('click', function(e) {
        if (e.target && !e.target.closest('#headerAgentModeWrapper')) {
            window._closeHeaderModePop();
        }
    });
};

// ★ Full access 胶囊双击：直接进入 YOLO 全自动，不再需要二次手动选择
window._activateYoloFromCapsule = function(e) {
    if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    var popup = document.getElementById('agentModePopup');
    if (popup) {
        popup.style.display = 'none';
        popup.classList.remove('open');
        popup.classList.add('hidden');
    }
    if (typeof window.setAgentMode === 'function') window.setAgentMode('yolo');
    else if (typeof setAgentMode === 'function') setAgentMode('yolo');
    if (window.showToast) window.showToast('已进入 YOLO 全自动模式', 'success', 1500);
};

/** 更新模式选择器按钮状态 (兼容旧选择器与全局调用) */
window.updateModeSelector = function(mode) {
    var selector = typeof getEl === 'function' ? getEl('agentModeSelector') : document.getElementById('agentModeSelector');
    if (selector) {
        var btns = selector.querySelectorAll('.mode-btn');
        btns.forEach(function(btn) {
            var btnMode = btn.getAttribute('data-mode');
            btn.classList.toggle('active', btnMode === mode);
        });
    }
};
function updateModeSelector(mode) {
    if (typeof window.updateModeSelector === 'function') {
        window.updateModeSelector(mode);
    }
}

// ==================== 审批门 (Approval Gate v2) ====================
// 参考 DeepSeek-TUI 的 execpolicy 设计

/**
 * 获取工具的审批级别 (优先使用注册表,回退旧逻辑)
 */
function getToolApprovalLevel(toolName) {
  // 优先从注册表获取
  if (window.toolRegistry && toolRegistry.has(toolName)) {
    return toolRegistry.getApprovalLevel(toolName);
  }
  // 回退: 检查是否在旧的高危列表中
  var oldHighRisk = ['server_file_write','server_file_op','server_exec','server_python','server_docker','engine_cron_create','engine_cron_delete'];
  var oldMediumRisk = ['delegate_task','engine_agent_create','server_db_query','autonomous_mode'];
  if (oldHighRisk.indexOf(toolName) !== -1) return 'required';
  if (oldMediumRisk.indexOf(toolName) !== -1) return 'suggest';
  return 'auto';
}

/** 判断是否是高危工具(需要审批) */
function isHighRiskTool(toolName) {
    return getToolApprovalLevel(toolName) === 'required';
}

/** 判断是否是只读工具 (无需审批) */
function isReadOnlyTool(toolName) {
  if (window.toolRegistry && toolRegistry.has(toolName)) {
    return toolRegistry.isReadOnly(toolName);
  }
  // 回退旧逻辑
  var readOnlyTools = ['web_search','web_fetch','rag_search','server_file_read','server_file_search','server_sys_info','server_ps','server_disk','server_network','server_db_query','engine_agent_status','engine_agent_list','engine_cron_list','engine_push','ask_agent','autonomous_mode'];
  return readOnlyTools.indexOf(toolName) !== -1;
}

/** 判断命令是否危险(需要审批) */
function isDangerousCommand(cmd) {
    if (!cmd || typeof cmd !== 'string') return false;
    var dangerPatterns = ['rm ', 'dd ', 'mkfs', 'shutdown', 'reboot', 'kill ', '>:'];
    var lower = cmd.toLowerCase();
    for (var i = 0; i < dangerPatterns.length; i++) {
        if (lower.indexOf(dangerPatterns[i]) !== -1) return true;
    }
    return false;
}

/**
 * 请求用户批准高危操作
 * @param {string} toolName - 工具名称
 * @param {object} args - 工具参数
 * @returns {Promise<boolean>} true=批准, false=拒绝
 */
/**
 * 检查是否有 '始终允许此工具' 规则
 */
function getAlwaysAllowRules() {
  try { return JSON.parse(localStorage.getItem('approvalAlwaysAllowRules') || '{}'); } catch(e) { return {}; }
}

/**
 * 检查工具是否在 '始终允许' 规则中
 */
function isAlwaysAllowed(toolName) {
  var rules = getAlwaysAllowRules();
  return !!rules[toolName];
}

/**
 * 添加 '始终允许此工具' 规则
 */
function addAlwaysAllowRule(toolName) {
  var rules = getAlwaysAllowRules();
  rules[toolName] = true;
  try { localStorage.setItem('approvalAlwaysAllowRules', JSON.stringify(rules)); } catch(e) {}
}

/**
 * 移除 '始终允许此工具' 规则
 */
function removeAlwaysAllowRule(toolName) {
  var rules = getAlwaysAllowRules();
  delete rules[toolName];
  try { localStorage.setItem('approvalAlwaysAllowRules', JSON.stringify(rules)); } catch(e) {}
}

window.requestFilesystemGrant = function(chatId, capability, path) {
    var targetChat = chatId || window.currentChatId || (typeof currentChatId !== 'undefined' ? currentChatId : null);
    var perm = typeof window.getWorkspacePermission === 'function' ? window.getWorkspacePermission() : '';
    // 如果当前已经是 Full access (全盘完全访问) 或 YOLO 模式，自动签发全盘授权凭证，不阻断、不卡死
    if (perm === 'danger-full-access' || (typeof isYoloMode === 'function' && isYoloMode()) || (window._tempAgentGranted && window._tempAgentChatId === targetChat)) {
        var autoCaps = ['filesystem.read','filesystem.search','filesystem.write','filesystem.move','terminal.exec'];
        if (typeof window.grantFullFileAccess === 'function' && targetChat) {
            return window.grantFullFileAccess(targetChat, autoCaps);
        }
        return Promise.resolve(true);
    }
    // 否则弹出可视化授权审批弹窗
    return new Promise(function(resolve) {
        var overlay = document.createElement('div');
        overlay.className = 'approval-overlay';
        overlay.style.zIndex = '2147483647';
        var shield = typeof window.getVibeSvg === 'function' ? window.getVibeSvg('shield', {size:28,className:'text-amber-500'}) : '';
        overlay.innerHTML = '<div class="approval-modal-v2">' +
            '<div class="approval-modal-header"><div class="approval-modal-icon">' + shield + '</div>' +
            '<div class="approval-modal-title">文件系统权限申请</div>' +
            '<div class="approval-modal-subtitle">目标路径超出当前工作区沙箱</div></div>' +
            '<div class="approval-modal-body"><div class="approval-tool-row"><span class="approval-tool-tag">' + escapeHtml(capability || 'filesystem.write') + '</span></div>' +
            '<pre class="approval-args-pre">' + escapeHtml(path || '/') + '</pre>' +
            '<div class="approval-tool-hint">批准后将在当前会话中开通全盘读写与终端权限（有效期30分钟）。</div></div>' +
            '<div class="approval-modal-actions"><button class="approval-btn-deny" data-deny>拒绝</button><button class="approval-btn-allow" data-allow>批准全盘访问</button></div></div>';
        document.body.appendChild(overlay);
        var done = function(value) { if (overlay.parentNode) overlay.remove(); resolve(value); };
        overlay.querySelector('[data-deny]').onclick = function(){ done(false); };
        overlay.querySelector('[data-allow]').onclick = async function(){
            try {
                var caps = ['filesystem.read','filesystem.search','filesystem.write','filesystem.move','terminal.exec'];
                done(await window.grantFullFileAccess(targetChat, caps));
            } catch(e) { done(false); }
        };
        overlay.onclick = function(e){ if (e.target === overlay) done(false); };
    });
};

/**
 * 请求用户批准高危操作 (增强版)
 * 参考 DeepSeek-TUI execpolicy 设计模式
 * @param {string} toolName - 工具名称
 * @param {object} args - 工具参数
 * @returns {Promise<boolean>} true=批准, false=拒绝
 */
function requestToolApproval(toolName, args) {
    return new Promise(function(resolve) {
        var mode = getAgentMode();
        var perm = typeof window.getWorkspacePermission === 'function' ? window.getWorkspacePermission() : 'danger-full-access';

        // ★ DSH 权限维度检查: 若当前为只读权限 (Read only), 严格拒绝写盘与终端执行
        if (perm === 'read-only' && !isReadOnlyTool(toolName)) {
            sessionUsage.approvalsRejected++;
            if (window.showToast) window.showToast('🛡️ 只读权限 (Read only) 限制：已阻止执行写入或终端操作', 'warn', 3000);
            resolve(false);
            return;
        }

        // YOLO 模式: 自动批准所有操作
        if (mode === 'yolo') {
            sessionUsage.approvalsGranted++;
            resolve(true);
            return;
        }

        // ★ ask_agent 单次授权: 本轮对话自动批准所有工具（无需弹窗）
        if (window._tempAgentGranted && window._tempAgentChatId === currentChatId) {
            sessionUsage.approvalsGranted++;
            resolve(true);
            return;
        }

        // ★ 会话级自动批准: 用户手动开启后,本轮对话所有工具自动批准(无需弹窗)
        if (window._sessionAutoApprove) {
            sessionUsage.approvalsGranted++;
            resolve(true);
            return;
        }

        // Plan 模式: 只读工具自动批准,写操作根据审批状态决定
        if (mode === 'plan') {
            // 只读工具始终自动批准(探索阶段也需要搜索/读取)
            if (isReadOnlyTool(toolName)) {
                sessionUsage.approvalsGranted++;
                resolve(true);
                return;
            }
            // 写操作: 已批准执行态 → 自动批准
            if (window._planApproved && window._planState === 'executing') {
                sessionUsage.approvalsGranted++;
                resolve(true);
                return;
            }
            // 写操作: 未批准 → 拒绝并提示等待审批
            sessionUsage.approvalsRejected++;
            resolve(false);
            return;
        }

        // Agent 模式: 检查 '始终允许此工具' 规则
        if (isAlwaysAllowed(toolName)) {
            sessionUsage.approvalsGranted++;
            resolve(true);
            return;
        }

        // 只读工具自动批准 (Feature 6)
        if (isReadOnlyTool(toolName)) {
            sessionUsage.approvalsGranted++;
            resolve(true);
            return;
        }

        // 检查是否已记住此工具(会话级别)
        var remembered = {};
        try { remembered = JSON.parse(sessionStorage.getItem('approvalRemembered') || '{}'); } catch(e) {}
        var cmdPart = (args && args.cmd) ? args.cmd.substring(0, 50) : '';
        if (args && args.name && !cmdPart) cmdPart = args.name.substring(0, 50);
        var rememberKey = toolName + '_' + (cmdPart || '');
        if (remembered[rememberKey] !== undefined) {
            var approved = remembered[rememberKey];
            if (approved) { sessionUsage.approvalsGranted++; } else { sessionUsage.approvalsRejected++; }
            resolve(approved);
            return;
        }

        // Agent 模式: 显示审批弹窗
        // 参数预览(截断避免过长)
        var argsPreview = '';
        try {
            if (typeof args === 'object' && args !== null) {
                var previewParts = [];
                for (var k in args) {
                    var v = typeof args[k] === 'string' ? args[k].substring(0, 100) : JSON.stringify(args[k]).substring(0, 100);
                    previewParts.push(k + ': ' + v);
                }
                argsPreview = previewParts.join('\n');
            } else {
                argsPreview = String(args).substring(0, 200);
            }
        } catch(e) {
            argsPreview = '无法预览参数';
        }

        // 检测是否需要额外的危险警告
        var extraWarning = '';
        if (toolName === 'server_exec') {
            var cmd = (args && args.cmd) || '';
            if (isDangerousCommand(cmd)) {
                extraWarning = '⚠️ 此命令包含危险操作,请谨慎确认!';
            }
        }
        // 从注册表获取工具描述
        var toolHint = '';
        if (window.toolRegistry && toolRegistry.has(toolName)) {
          toolHint = toolRegistry.getSearchHint(toolName);
        }

        // 创建审批弹窗 (现代化居中弹出 + SVG 图标)
        var overlay = document.createElement('div');
        overlay.className = 'approval-overlay';
        overlay.innerHTML = '<div class="approval-modal-v2">' +
            '<div class="approval-modal-header">' +
                '<div class="approval-modal-icon">' +
                    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
                '</div>' +
                '<div class="approval-modal-title">操作审批</div>' +
                '<div class="approval-modal-subtitle">确认允许执行此操作</div>' +
            '</div>' +
            '<div class="approval-modal-body">' +
                (extraWarning ? '<div class="approval-warning"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ' + extraWarning + '</div>' : '') +
                '<div class="approval-tool-row">' +
                    '<span class="approval-tool-tag">' + escapeHtml(toolName) + '</span>' +
                    (toolHint ? '<span class="approval-tool-hint">' + escapeHtml(toolHint) + '</span>' : '') +
                '</div>' +
                '<details class="approval-args-details">' +
                    '<summary class="approval-args-summary">' +
                        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><circle cx="12" cy="12" r="3"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/></svg> 参数详情' +
                    '</summary>' +
                    '<pre class="approval-args-pre">' + escapeHtml(argsPreview) + '</pre>' +
                '</details>' +
            '</div>' +
            '<div class="approval-modal-options">' +
                '<label class="approval-option"><input type="checkbox" id="approvalRememberCheck"><span class="approval-checkmark"></span> 本次会话记住</label>' +
                '<label class="approval-option"><input type="checkbox" id="approvalAlwaysAllowCheck"><span class="approval-checkmark"></span> 始终允许此类型</label>' +
            '</div>' +
            '<div class="approval-modal-actions">' +
                '<button class="approval-btn-deny" id="approvalRejectBtn">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> 拒绝' +
                '</button>' +
                '<button class="approval-btn-allow" id="approvalConfirmBtn">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> 批准' +
                '</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        // ★ 暂停请求超时计时器 (避免等待审批时超时)
        if (window._activeRequestTimeoutId) { clearTimeout(window._activeRequestTimeoutId); }
        window._approvalPending = true;
        // ★ 审批弹窗自身超时: 2 分钟后自动拒绝
        var _approvalTimeout = setTimeout(function() {
            if (document.body.contains(overlay)) {
                sessionUsage.approvalsRejected++;
                _resolveApproval(false);
                showToast('⚠️ 审批超时，已自动拒绝', 'warning', 3000);
            }
        }, 120000);

        // 弹窗动画: 先出场再交互
        requestAnimationFrame(function() { overlay.classList.add('active'); });
        // ★ 点击遮罩层忽略 — 必须通过明确点击「批准」或「拒绝」按钮来做出决定
        // 防止误触背景导致意外拒绝
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                // 轻微抖动提示,不关闭弹窗
                var modal = overlay.querySelector('.approval-modal-v2');
                if (modal) {
                    modal.style.animation = 'none';
                    void modal.offsetWidth;
                    modal.style.animation = 'approval-shake 0.3s ease';
                }
            }
        });


        // 按钮事件
        var confirmBtn = overlay.querySelector('#approvalConfirmBtn');
        var rejectBtn = overlay.querySelector('#approvalRejectBtn');

        var _resolveApproval = function(approved) {
            clearTimeout(_approvalTimeout);
            window._approvalPending = false;
            overlay.remove();
            // ★ 恢复请求超时 (5 分钟，给后续操作足够时间)
            if (window._activeRequestTimeoutId) clearTimeout(window._activeRequestTimeoutId);
            window._activeRequestTimeoutId = setTimeout(function() {
                try { abortControllerMap[currentChatId]?.abort(); } catch(e) {}
            }, 300000);
            resolve(approved);
        };

        confirmBtn.onclick = function() {
            var remember = overlay.querySelector('#approvalRememberCheck');
            if (remember && remember.checked) {
                remembered[rememberKey] = true;
                try { sessionStorage.setItem('approvalRemembered', JSON.stringify(remembered)); } catch(e) {}
            }
            var alwaysAllow = overlay.querySelector('#approvalAlwaysAllowCheck');
            if (alwaysAllow && alwaysAllow.checked) {
                addAlwaysAllowRule(toolName);
            }
            sessionUsage.approvalsGranted++;
            _resolveApproval(true);
        };

        rejectBtn.onclick = function() {
            var remember = overlay.querySelector('#approvalRememberCheck');
            if (remember && remember.checked) {
                remembered[rememberKey] = false;
                try { sessionStorage.setItem('approvalRemembered', JSON.stringify(remembered)); } catch(e) {}
            }
            sessionUsage.approvalsRejected++;
            _resolveApproval(false);
        };
    });
}

// ★ Agent 主动建议功能
async function generateProactiveSuggestions(chatId, lastResponse) {
    if (!chatId || !lastResponse) return;
    var isActive = isAgentToolsActive();
    var proactive = localStorage.getItem('agentProactive') === 'true';  // default false
    if (!isActive || !proactive) return;

    var bubble = activeBubbleMap[chatId];
    if (!bubble) return;

    try {
        var recentHistory = chats[chatId].messages.slice(-4).map(function(m) {
            return (m.role === 'user' ? '用户: ' : 'AI: ') + (typeof m.content === 'string' ? m.content.substring(0, 200) : '');
        }).join('\n');

        var suggestionPrompt = {
            role: 'user',
            content: '基于最近对话:\n' + recentHistory + '\n\n请给出2-3个简短、具体的后续行动建议(每行一个,用-开头,每个不超过50字)。只返回建议列表。'
        };

        var model = getVal('modelSelect') || DEFAULT_CONFIG.model;
        var resp = await window.proxyFetch((localStorage.getItem('baseUrl') || DEFAULT_CONFIG.url) + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (localStorage.getItem('apiKey') || DEFAULT_CONFIG.key)
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: '你是一个AI助手的建议模块。基于最近对话,给出后续行动的简短建议。简洁,每条不超过50字。' },
                    suggestionPrompt
                ],
                stream: false,
                temperature: 0.7,
                max_tokens: 300
            })
        });

        if (!resp.ok) return;
        var data = await resp.json();
        var content = data.choices?.[0]?.message?.content || '';
        var suggestions = content.split('\n').filter(function(l) {
            return l.trim().startsWith('-') || l.trim().match(/^\d+\./);
        }).map(function(l) {
            return l.replace(/^[-\s\d.]+/, '').trim();
        }).filter(function(s) { return s.length > 3; }).slice(0, 3);

        if (suggestions.length === 0) return;

        var markdownBody = bubble.querySelector('.markdown-body');
        if (!markdownBody) return;

        var suggestionsDiv = document.createElement('div');
        suggestionsDiv.className = 'agent-suggestions';
        var label = document.createElement('div');
        label.className = 'agent-suggestions-label';
        label.textContent = '💡 后续建议:';
        suggestionsDiv.appendChild(label);

        suggestions.forEach(function(s) {
            var btn = document.createElement('button');
            btn.className = 'agent-suggestion-btn';
            btn.textContent = s.substring(0, 40);
            btn.onclick = function() {
                var input = $.userInput;
                if (input) {
                    input.value = s;
                    window.autoResize(input);
                    input.focus();
                }
            };
            suggestionsDiv.appendChild(btn);
        });

        markdownBody.appendChild(suggestionsDiv);
    } catch(e) {
        // 静默失败,不干扰主对话
    }
}

// ★ 引擎健康检查
window.deleteCron = async function(name) {
    if (!confirm('确定要删除 cron 任务 "' + name + '" 吗?')) return;
    try {
        var r = await fetch(_apiBase + '?action=cron_delete&name=' + encodeURIComponent(name), { signal: AbortSignal.timeout(30000), headers: _agentAuthHeaders() });
        var d = await r.json();
        if (d.ok) {
            window.refreshEngineStatus();
        } else {
            alert('删除失败: ' + (d.error || '未知错误'));
        }
    } catch(e) {
        alert('删除请求失败: ' + e.message);
    }
};

/* ===== 任务级子代理消息队列系统 =====
 *
 * 设计:
 * - 每个用户消息 = 一个 Task，有唯一 taskId
 * - 主代理在 Task 内创建子代理，子代理的结果推入该 Task 的队列
 * - 当 Task 内所有子代理都完成（或超时），统一触发主代理回复
 * - 不同 Task 之间完全隔离，不会混淆
 */
window._currentTaskId = 0;        // 自增任务ID
window._tasks = {};               // { taskId: Task对象 }

/** 创建一个新任务（用户发消息时调用 */
window.createTask = function(userMessage, chatId) {
    var taskId = 'task_' + (++window._currentTaskId);
    var task = {
        id: taskId,
        userMessage: userMessage || '',
        chatId: chatId || currentChatId,
        createdAt: Date.now(),
        agents: {},       // { name: { status, role, createdAt } }
        subResults: {},   // { name: { status, result, error } }
        mainResponded: false,
        timeout: null,
        timeoutMinutes: 10
    };
    window._tasks[taskId] = task;
    console.log('[Task] 创建任务 ' + taskId + ', message_length=' + (userMessage || '').length);
    return taskId;
};

/** 向任务添加一个子代理（主代理创建子代理时调用） */
window.addAgentToTask = function(taskId, agentName, role) {
    var task = window._tasks[taskId];
    if (!task) { console.warn('[Task] addAgent: 任务不存在', taskId); return false; }
    task.agents[agentName] = {
        status: 'running',
        role: role || 'general',
        createdAt: Date.now()
    };
    console.log('[Task] ' + taskId + ' + 子代理: ' + agentName + ' (' + (role || 'general') + ')');
    // ★ 显示子代理运行状态条
    if (typeof window._updateSubAgentStatusBar === 'function') window._updateSubAgentStatusBar();
    return true;
};

/** 向任务推入子代理结果（子代理完成时调用） */
window.pushAgentResultToTask = function(taskId, agentName, status, result, error) {
    var task = window._tasks[taskId];
    if (!task) {
        // 找不到 task: 可能是旧系统,转给旧的 triggerAgentAutoReplyForSubAgent
        if (typeof window._legacyTrigger === 'function') window._legacyTrigger(agentName);
        return;
    }
    var normalizedStatus = status || 'completed';
    // 将 engine 的状态标准化：running/idle → completed, error → failed
    if (normalizedStatus === 'idle' || normalizedStatus === 'running') normalizedStatus = 'completed';
    task.subResults[agentName] = { status: normalizedStatus, result: result || '', error: error || '' };
    if (task.agents[agentName]) {
        task.agents[agentName].status = normalizedStatus;
    }
    console.log('[Task] ' + taskId + ' 子代理完成: ' + agentName + ' = ' + (status || 'completed'));

    // ★ 失败时Toast通知(覆盖轮询路径)
    if (normalizedStatus === 'failed' || normalizedStatus === 'error') {
        var _errPreview = (error || result || '').substring(0, 120);
        showToast('❌ 子代理 ' + agentName + ' 失败: ' + _errPreview, 'error', 6000);
    }

    // ★ 立即同步到计划面板（无论任务是否全部完成）
    if (window._agentPlan && window._agentPlan.tasks && normalizedStatus !== 'running') {
        var _planUpdated = false;
        window._agentPlan.tasks.forEach(function(pt) {
            // 尝试多种匹配方式
            var _match = pt.id === agentName ||
                pt.title.indexOf(agentName) >= 0 ||
                (pt.title.toLowerCase().indexOf(agentName.toLowerCase().replace(/_/g, '')) >= 0);
            if (_match && (pt.status === 'running' || pt.status === 'pending')) {
                pt.status = (normalizedStatus === 'failed' || normalizedStatus === 'error') ? 'failed' : 'completed';
                window.updatePlanTaskStatus(pt.id, pt.status);
                _planUpdated = true;
                console.log('[FlowPanel] 子代理 ' + agentName + ' 完成 → 计划任务 ' + pt.id + ' → ' + pt.status);
            }
        });
        // ★ 如果没有任何匹配但有计划在运行: 标记第一个 running 任务为失败（兜底）
        if (!_planUpdated && normalizedStatus === 'failed') {
            var _firstRunning = null;
            window._agentPlan.tasks.forEach(function(pt) {
                if (!_firstRunning && pt.status === 'running') _firstRunning = pt;
            });
            if (_firstRunning) {
                _firstRunning.status = 'failed';
                _firstRunning.note = '子代理 ' + agentName + ' 执行失败';
                window.updatePlanTaskStatus(_firstRunning.id, 'failed');
                console.log('[FlowPanel] 兜底: 标记 ' + _firstRunning.id + ' 为失败 (agent=' + agentName + ')');
            }
        }
        window._autoDismissIfAllDone();
    }

    // 检查该任务是否所有子代理都完成了
    window._checkTaskCompletion(taskId);
    // ★ 更新子代理运行状态条
    if (typeof window._updateSubAgentStatusBar === 'function') window._updateSubAgentStatusBar();
};

/** ★ P0: 推送子代理结果(含结构化数据),由SSE agent:result事件直接调用 */
window.pushAgentResultToTaskWithStructured = function(agentName, status, result, error, structured) {
    if (window._tasks && typeof window._tasks === 'object') {
        for (var _tId in window._tasks) {
            var _t = window._tasks[_tId];
            if (_t && _t.agents && _t.agents[agentName] && !_t.mainResponded) {
                var ns = status || 'completed';
                if (ns === 'idle' || ns === 'running') ns = 'completed';
                _t.subResults[agentName] = {
                    status: ns,
                    result: result || '',
                    error: error || '',
                    _structured: structured || null
                };
                if (_t.agents[agentName]) _t.agents[agentName].status = ns;
                console.log('[SSE] agent:result 推送 ' + agentName + ' 到任务 ' + _tId);
                window._checkTaskCompletion(_tId);
                // ★ 更新子代理运行状态条
                if (typeof window._updateSubAgentStatusBar === 'function') window._updateSubAgentStatusBar();
                return true;
            }
        }
    }
    // 若任务对象因刷新/多端同步丢失，先按创建时记录的归属聊天恢复，
    // 避免完成结果被错误塞进 Agent 主会话后只显示“完成”却没有后续整合回复。
    var _ownerChatId = window._subAgentOwnerChats && window._subAgentOwnerChats[agentName];
    if (_ownerChatId && chats[_ownerChatId]) {
        var _recoveredTaskId = window.createTask('[系统] 子代理 ' + agentName + ' 完成', _ownerChatId);
        var _recoveredTask = window._tasks[_recoveredTaskId];
        _recoveredTask.agents[agentName] = { status: status || 'completed', role: 'general', createdAt: Date.now() };
        _recoveredTask.subResults[agentName] = { status: status || 'completed', result: result || '', error: error || '', _structured: structured || null };
        window._triggerMainAgentForTask(_recoveredTaskId);
        return true;
    }
    // 降级: 存入pending队列
    if (!window._pendingSubAgentResultsData) window._pendingSubAgentResultsData = {};
    window._pendingSubAgentResultsData[agentName] = {
        status: status || 'completed',
        result: result || '',
        error: error || '',
        _structured: structured || null
    };
    // ★ 无论是否Agent模式,都触发子代理自动回复(普通聊天+Agent聊天统一处理)
    window.triggerAgentAutoReplyForSubAgent(agentName);
    // ★ 更新子代理运行状态条
    if (typeof window._updateSubAgentStatusBar === 'function') window._updateSubAgentStatusBar();
    return false;
};

/** 检查任务是否所有子代理都已完成 */
window._checkTaskCompletion = function(taskId) {
    var task = window._tasks[taskId];
    if (!task) return;
    if (task.mainResponded) { console.log('[Task] ' + taskId + ' main已回复过,跳过'); return; }
    
    var agentNames = Object.keys(task.agents);
    if (agentNames.length === 0) { console.log('[Task] ' + taskId + ' 无子代理,跳过'); return; }
    
    // 检查是否所有子代理都完成了（completed/failed/error，running/idle不算）
    var allDone = agentNames.every(function(name) {
        return task.agents[name].status === 'completed' || task.agents[name].status === 'failed' || task.agents[name].status === 'error';
    });
    
    console.log('[Task] ' + taskId + ' allDone=' + allDone + ' agents=' + JSON.stringify(agentNames.map(function(n){return n+':'+task.agents[n].status})));
    
    if (!allDone) {
        // 还有子代理在运行,设一个超时保护
        if (!task.timeout) {
            task.timeout = setTimeout(function() {
                // 超时: 强制触发已有结果
                console.log('[Task] ' + taskId + ' 超时,强制触发主代理回复');
                window._triggerMainAgentForTask(taskId);
            }, task.timeoutMinutes * 60 * 1000);
        }
        return;
    }
    
    // 清除超时
    if (task.timeout) { clearTimeout(task.timeout); task.timeout = null; }
    // ★ 所有子代理已完成 → 显示"已完成"提示
    if (typeof window._showSubAgentStatusBarDone === 'function') window._showSubAgentStatusBarDone();
    // 触发主代理回复
    window._triggerMainAgentForTask(taskId);
};

/** 触发主代理回复（收集该任务的所有子代理结果,合成通知） */
window._triggerMainAgentForTask = function(taskId) {
    var task = window._tasks[taskId];
    if (!task || task.mainResponded) return;
    task.mainResponded = true;

    var agentNames = Object.keys(task.agents);
    var results = [];
    var hasFailed = false;
    agentNames.forEach(function(name) {
        var stored = task.subResults[name];
        if (stored) {
            var statusLabel = stored.status === 'completed' ? '✅完成' :
                             stored.status === 'failed' ? '❌失败' : '🔄超时';
            if (stored.status === 'failed' || stored.status === 'error') hasFailed = true;

            // ★ P0: 检查结构化数据,有则格式化,无则保持旧格式
            var structured = stored._structured;
            if (structured && typeof structured === 'object' && structured.summary) {
                var parts = [];
                parts.push('### 📋 ' + name + ' ' + statusLabel);
                parts.push('');
                parts.push('**摘要**: ' + (structured.summary || '无摘要'));

                if (structured.findings && structured.findings.length > 0) {
                    parts.push('');
                    parts.push('**关键发现**:');
                    structured.findings.forEach(function(f) {
                        var confIcon = f.confidence === 'high' ? '🔴' : f.confidence === 'medium' ? '🟡' : '🟢';
                        parts.push('- ' + confIcon + ' **' + (f.key || '') + '**: ' + (f.value || '') +
                                  (f.source ? ' (来源: ' + f.source + ')' : ''));
                    });
                }

                if (structured.actions_taken && structured.actions_taken.length > 0) {
                    parts.push('');
                    parts.push('**执行的操作**:');
                    structured.actions_taken.forEach(function(a) { parts.push('- ' + a); });
                }

                if (structured.errors && structured.errors.length > 0) {
                    parts.push('');
                    parts.push('**错误**:');
                    structured.errors.forEach(function(e) { parts.push('- ⚠️ ' + e); });
                }

                var detail = (stored.result || '').substring(0, 3000);
                if (detail) {
                    parts.push('');
                    parts.push('**原始详情**:');
                    parts.push(detail);
                }

                results.push(parts.join('\n'));
            } else {
                // 旧格式(无结构化数据)
                var detail = (stored.error || stored.result || '').substring(0, 6000);
                results.push(statusLabel + ' ' + name + '\n' + detail);
            }
        } else {
            results.push('⏰超时 ' + name + ' (无返回)');
        }
    });
    var ctx = results.join('\n\n---\n\n');

    var chatId = task.chatId;
    if (chatId && chats[chatId] && typeof window.sendMessage === 'function') {
        if (!chats[chatId].messages) chats[chatId].messages = [];
        var sysMsg = '以下子代理已返回结果,请据此整合回复用户:\n\n' + ctx;
        if (hasFailed) {
            sysMsg += '\n\n### ⚠️ 有子代理执行失败\n' +
                '如果任务尚未完成，请针对失败的子代理重新创建新的子代理来补救。\n' +
                '新子代理的 task 应包含更明确的关键词，prompt 应更详细以避免再次失败。\n' +
                '如果所有子代理都失败了，直接用自己搜索工具完成任务。';
        }
        sysMsg += '\n\n### 🔒 规则\n' +
            '1. 仔细阅读上面的子代理结果,用简洁的语言告知用户进展和结论\n' +
            '2. 如果子代理结果是错误/空的,诚实告知用户并主动重试或自行搜索\n' +
            '3. 计划面板中如有失败任务,可以用 plan_update 更新为 failed 后重新创建子代理\n' +
            '4. 【重要】你现在正在和用户对话,请直接回复用户,不要调用任何工具\n' +
            '5. 这是系统级通知,不要在回复中提及内部术语';
        chats[chatId].messages = chats[chatId].messages.filter(function(m) { return !m._internal; });
        chats[chatId].messages.push({ role: 'system', content: sysMsg, _internal: true, temporary: false });
        saveChats();

        window.__internalAgentContext = null;

        // ★ 切换到任务所在聊天 — 仅当任务聊天与当前模式同域(严格分隔):
        //   Agent 域任务只在 Agent 视图切换,普通聊天任务(plan/临时授权)只在非 Agent 视图切换;
        //   跨域时既不切换也不发送 — 系统消息已无条件追加到任务聊天(saveChats 已执行),内容不丢
        var _canSwitch = (typeof isAgentToolsActive === 'function') ? (isAgentToolsActive() === isAgentChat(chatId)) : true;
        if (currentChatId !== chatId && !_canSwitch) {
            console.log('[Task] 跨域任务完成,不切换不发送: chatId=' + chatId + ' mode=' + getAgentMode());
            showToast('子代理已完成，可在 ' + (isAgentChat(chatId) ? 'Agent' : '普通') + ' 模式查看', 'info', 3000);
        } else {
            if (currentChatId !== chatId) {
                console.log('[Task] 切换到任务所在聊天: ' + chatId);
                currentChatId = chatId;
                localStorage.setItem('lastChatId', chatId);
                // 异步加载聊天UI(不阻塞发送)
                if (typeof window.loadChat === 'function') {
                    setTimeout(function() { window.loadChat(chatId); }, 100);
                }
            }

            // ★ 等 AI 空闲后再发送(如果忙则设置标记,在 finally 中触发)
            var _sendSummary = function() {
                if (!isTypingMap[chatId]) {
                    window.sendMessage(true, '请整合子代理结果并告知用户进展');
                    console.log('[Task] ' + taskId + ' 已触发主代理回复');
                    return true;
                }
                // AI 忙:设置标记,等当前 turn 的 finally 块触发
                console.log('[Task] ' + taskId + ' 主代理忙,设置 pendingAgentReply 标记');
                window._pendingAgentReply = true;
                window._pendingAgentReplyChatId = chatId;
                return false;
            };
            _sendSummary();
        }
    }
    
    // 延迟标记引擎端通知已处理 + 清理
    setTimeout(function() {
        var token = getAuthToken();
        if (token) {
            fetch(_apiBase + '?action=agent_notifications_mark', { signal: AbortSignal.timeout(30000), headers: _agentAuthHeaders() }).catch(function() {});
        }
        // 清理任务: mainResponded后30秒删除
        setTimeout(function() {
            delete window._tasks[taskId];
            console.log('[Task] 清理 ' + taskId);
        }, 30000);
    }, 5000);
};

/** 从任务ID获取当前正在运行的子代理列表 */
window.getRunningAgentsForTask = function(taskId) {
    var task = window._tasks[taskId];
    if (!task) return [];
    return Object.keys(task.agents).filter(function(name) {
        return task.agents[name].status === 'running';
    });
};

// ==================== 子代理运行状态条 ====================

/**
 * 更新子代理运行状态条 (有子代理运行时显示,全部完成后自动消失)
 * 显示信息: 运行中数量/总数 + 当前工具 + 步骤进度
 */
window._updateSubAgentStatusBar = function() {
    var bar = getEl('subAgentStatusBar');
    if (!bar) return;

    // 收集所有任务中正在运行的子代理
    var allRunning = [];
    var allTotal = 0;
    if (window._tasks && typeof window._tasks === 'object') {
        for (var _tId in window._tasks) {
            var _t = window._tasks[_tId];
            if (!_t || !_t.agents) continue;
            var _names = Object.keys(_t.agents);
            _names.forEach(function(_n) {
                allTotal++;
                if (_t.agents[_n].status === 'running') {
                    allRunning.push({
                        name: _n,
                        role: _t.agents[_n].role,
                        tool: _t.agents[_n]._lastTool || '',
                        step: _t.agents[_n]._step || 0,
                        maxSteps: _t.agents[_n]._maxSteps || 0
                    });
                }
            });
        }
    }

    if (allRunning.length === 0) {
        // 没有运行中的子代理 → 隐藏状态条
        if (!bar.classList.contains('hidden')) {
            bar.classList.add('hidden');
        }
        return;
    }

    // 有子代理在运行 → 显示状态条
    bar.classList.remove('hidden');

    // 更新计数
    var countEl = getEl('subAgentStatusCount');
    if (countEl) {
        countEl.textContent = allRunning.length + '/' + allTotal;
    }

    // 更新详情文本 (显示第一个运行中的子代理信息)
    var detailEl = getEl('subAgentStatusDetail');
    if (detailEl) {
        var _first = allRunning[0];
        var _parts = [];
        if (allRunning.length === 1) {
            _parts.push('「' + _first.name + '」');
        } else {
            _parts.push('「' + _first.name + '」等 ' + allRunning.length + ' 个');
        }
        if (_first.tool) {
            _parts.push('正在执行: ' + _first.tool);
        }
        if (_first.step > 0 && _first.maxSteps > 0) {
            _parts.push('步骤 ' + _first.step + '/' + _first.maxSteps);
        }
        // 如果有多个运行中的,追加其他名称
        if (allRunning.length > 1) {
            var _others = allRunning.slice(1, 4).map(function(a) { return a.name; }).join(', ');
            if (_others) _parts.push('其他: ' + _others);
            if (allRunning.length > 4) _parts.push('...');
        }
        detailEl.textContent = _parts.join(' · ');
    }
};

/** 子代理全部完成时的短暂"完成"提示 */
window._showSubAgentStatusBarDone = function() {
    var bar = getEl('subAgentStatusBar');
    if (!bar) return;
    bar.classList.remove('hidden');
    bar.classList.add('done');
    var textEl = bar.querySelector('.sub-agent-status-text');
    if (textEl) textEl.textContent = '子代理已完成';
    var detailEl = getEl('subAgentStatusDetail');
    if (detailEl) detailEl.textContent = '结果已推送,正在整合...';
    var countEl = getEl('subAgentStatusCount');
    if (countEl) countEl.textContent = '✓';
    // 2秒后隐藏
    setTimeout(function() {
        bar.classList.add('hidden');
        bar.classList.remove('done');
        if (textEl) textEl.textContent = '子代理运行中';
        if (countEl) countEl.textContent = '0/0';
    }, 2000);
};

// triggerAgentAutoReplyForSubAgent: 被 mainAgentReply 按钮和新通知系统调用
// 作为 pushAgentResultToTask 的降级：当没有 task 时，创建临时 task 然后触发回复
window.triggerAgentAutoReplyForSubAgent = function(agentName) {
    // ★ 从引擎获取最新结果(不依赖 localStorage 缓存)
    var token = getAuthToken();
    if (token) {
        window._fetchAgentListJSON().then(function(agents) {
            if (!agents) return;
            var a = agents[agentName];
            if (a) {
                    // 更新 pending 数据
                    if (!window._pendingSubAgentResultsData) window._pendingSubAgentResultsData = {};
                    window._pendingSubAgentResultsData[agentName] = {
                        status: a.status || 'completed',
                        result: a.result || '',
                        error: a.error || '',
                        _structured: (typeof a._structured === 'string') ? (function(){try{return JSON.parse(a._structured)}catch(e){return null}})() : (a._structured || null)
                    };
                }
                _doTrigger(agentName);
            }).catch(function() { _doTrigger(agentName); });
    } else {
        _doTrigger(agentName);
    }
};

function _doTrigger(agentName) {
    // 尝试找到包含此 agent 的 task
    if (window._tasks && typeof window._tasks === 'object') {
        for (var _tId in window._tasks) {
            var _t = window._tasks[_tId];
            if (_t && _t.agents && _t.agents[agentName] && !_t.mainResponded) {
                if (_t.agents[agentName].status === 'running') {
                    _t.agents[agentName].status = 'completed';
                }
                var stored = (window._pendingSubAgentResultsData || {})[agentName];
                if (stored && !_t.subResults[agentName]) {
                    _t.subResults[agentName] = { status: stored.status || 'completed', result: stored.result || '', error: stored.error || '', _structured: stored._structured || null };
                }
                window._checkTaskCompletion(_tId);
                return;
            }
        }
    }
    // 降级: 无 task → 创建新 task 然后直接触发回复
    // ★ 严格分隔: Agent 视图绑当前聊天(Agent 域); off 模式仅临时授权流程绑回当前聊天,
    //   其余一律绑到 Agent 主会话,防止无主子代理结果注入普通聊天
    var _triggerChatId = currentChatId;
    var _agentActive = (typeof isAgentToolsActive === 'function') && isAgentToolsActive();
    var _tempOk = window._tempAgentGranted && window._tempAgentChatId === currentChatId;
    if (!_agentActive && !_tempOk) {
        _triggerChatId = AGENT_CHAT_ID;
    }
    var taskId = window.createTask('[系统] 子代理 ' + agentName + ' 完成', _triggerChatId);
    var task = window._tasks[taskId];
    var stored = (window._pendingSubAgentResultsData || {})[agentName];
    task.agents[agentName] = { status: 'completed', role: 'general', createdAt: Date.now() };
    if (stored) {
        task.subResults[agentName] = { status: stored.status || 'completed', result: stored.result || '', error: stored.error || '', _structured: stored._structured || null };
    }
    window._triggerMainAgentForTask(taskId);
}

window._legacyTrigger = window.triggerAgentAutoReplyForSubAgent;
window._agentNotifyQueue = [];
window._pendingSubAgentResultsData = {};  // 保留兼容
window._subAgentOwnerChats = window._subAgentOwnerChats || {};
try { window._subAgentOwnerChats = Object.assign(window._subAgentOwnerChats, JSON.parse(sessionStorage.getItem('_subAgentOwnerChats') || '{}')); } catch(e) {}

// ==================== Agent 任务计划流面板 (会话持久化与状态机) ====================

/** 当前活跃的计划数据: null | { tasks: [{id,title,description,status,note}], createdAt, status, currentTaskId, chatId } */
window._agentPlan = null;
window._flowPanelDismissTimer = null;

/** 统一计划任务字段，修复旧快照中的空标题/非法状态/重复 id。 */
window._normalizeAgentPlan = function(plan, chatId) {
    if (!plan || !Array.isArray(plan.tasks)) return null;
    var validStatus = { pending:1, running:1, completed:1, failed:1, skipped:1 };
    var seen = {};
    plan.tasks = plan.tasks.map(function(task, idx) {
        task = task && typeof task === 'object' ? task : {};
        var id = String(task.id || ('task_' + (idx + 1))).trim() || ('task_' + (idx + 1));
        if (seen[id]) id = id + '_' + (idx + 1);
        seen[id] = true;
        var title = String(task.title || task.description || task.note || ('任务 ' + (idx + 1))).trim();
        var status = validStatus[task.status] ? task.status : 'pending';
        return {
            id: id,
            title: title,
            description: String(task.description || '').trim(),
            status: status,
            note: String(task.note || '').trim()
        };
    });
    plan.chatId = plan.chatId || chatId || null;
    plan.status = plan.status || 'running';
    return plan.tasks.length ? plan : null;
};

/** 同步保存计划状态到会话与持久化存储 */
window.savePlanState = function(targetChatId) {
    var cid = targetChatId || (window._agentPlan && window._agentPlan.chatId) || (typeof currentChatId !== 'undefined' ? currentChatId : null);
    if (!cid || !window._agentPlan) return;
    try {
        window._agentPlan.chatId = cid;
        if (typeof chats !== 'undefined' && chats && chats[cid]) {
            chats[cid]._agentPlan = JSON.parse(JSON.stringify(window._agentPlan));
            if (typeof slimSaveChats === 'function') slimSaveChats();
        }
        localStorage.setItem('_agentPlan_' + cid, JSON.stringify(window._agentPlan));
    } catch(e) {
        console.warn('[FlowPanel] 保存计划状态失败:', e);
    }
};

/** 从会话或持久化存储恢复指定会话的计划面板 */
window.restorePlanForChat = function(chatId) {
    if (!chatId) return false;
    var plan = null;
    if (typeof chats !== 'undefined' && chats && chats[chatId] && chats[chatId]._agentPlan) {
        plan = chats[chatId]._agentPlan;
    }
    if (!plan) {
        try {
            var localStr = localStorage.getItem('_agentPlan_' + chatId);
            if (localStr) plan = JSON.parse(localStr);
        } catch(e) {}
    }
    plan = window._normalizeAgentPlan(plan, chatId);
    if (plan && plan.status !== 'dismissed') {
        window._agentPlan = plan;
        // 已完成计划不应在刷新/切换会话后永久复活；旧快照自动清理。
        if (plan.status === 'completed' || plan.tasks.every(function(t) { return t.status === 'completed' || t.status === 'failed' || t.status === 'skipped'; })) {
            window.clearPlanForChat(chatId);
            window.dismissFlowPanel({ preserveData: true, silent: true });
            return false;
        }
        window.createFlowPanel(plan, { isRestore: true });
        console.log('[FlowPanel] 已成功恢复会话 ' + chatId + ' 的计划面板, 任务数=' + plan.tasks.length);
        return true;
    } else {
        window._agentPlan = null;
        window.dismissFlowPanel({ preserveData: true, silent: true });
        return false;
    }
};

/** 清除指定会话的计划数据 */
window.clearPlanForChat = function(chatId) {
    var cid = chatId || (typeof currentChatId !== 'undefined' ? currentChatId : null);
    if (window._agentPlan && (!window._agentPlan.chatId || window._agentPlan.chatId === cid)) {
        window._agentPlan = null;
    }
    if (typeof chats !== 'undefined' && chats && cid && chats[cid]) {
        delete chats[cid]._agentPlan;
        if (typeof slimSaveChats === 'function') slimSaveChats();
    }
    if (cid) {
        try { localStorage.removeItem('_agentPlan_' + cid); } catch(e) {}
    }
};

/** 创建并显示流程面板 */
window.createFlowPanel = function(plan, opts) {
    opts = opts || {};
    var cid = plan && plan.chatId || (typeof currentChatId !== 'undefined' ? currentChatId : null);
    plan = window._normalizeAgentPlan(plan, cid);
    if (!plan) return;
    if (window._flowPanelDismissTimer) { clearTimeout(window._flowPanelDismissTimer); window._flowPanelDismissTimer = null; }
    plan.chatId = cid;
    window._agentPlan = plan;

    // 同步持久化
    if (!opts.isRestore) {
        window.savePlanState(cid);
    }

    var panel = getEl('flowPanel');
    if (!panel) return;

    // ★ 隐藏 Agent 模式横幅，避免被面板顶上去
    var banner = getEl('agentBanner');
    if (banner) banner.classList.add('hidden');

    // 重置动画和显隐样式
    panel.style.opacity = '';
    panel.style.transform = '';
    panel.style.marginBottom = '';
    panel.style.maxHeight = '';
    panel.style.padding = '';
    panel.classList.remove('hidden');

    // 检查是否有折叠偏好
    var isCollapsed = localStorage.getItem('_flowPanelCollapsed') === '1';
    if (isCollapsed && opts.isRestore) {
        panel.classList.add('collapsed');
    } else {
        panel.classList.remove('collapsed');
    }

    // 强制回流后渲染（确保 CSS transition 触发）
    void panel.offsetWidth;

    // 渲染任务列表
    window.renderPlanTasks(plan.tasks);

    // 滚动聊天区域使面板可见
    if (!opts.isRestore) {
        setTimeout(function() {
            if ($.chatBox) {
                var panelBottom = panel.getBoundingClientRect().bottom;
                var chatBottom = $.chatBox.getBoundingClientRect().bottom;
                if (panelBottom > chatBottom - 60) {
                    $.chatBox.scrollTop = $.chatBox.scrollHeight;
                }
            }
        }, 100);
    }

    console.log('[FlowPanel] ' + (opts.isRestore ? '恢复' : '创建') + '计划，共 ' + plan.tasks.length + ' 个任务');
};

/** 渲染所有任务项到流程列表 (时间线设计) */
window.renderPlanTasks = function(tasks) {
    var list = getEl('flowTaskList');
    if (!list) return;

    if (!tasks || tasks.length === 0) {
        list.innerHTML = '<div class="text-xs text-gray-400 dark:text-gray-500 p-3 text-center">暂无任务</div>';
        return;
    }

    tasks = tasks.filter(function(task) { return task && typeof task === 'object'; });
    let html = '';
    tasks.forEach(function(task, idx) {
        var status = task.status || 'pending';
        var dotHtml = window._flowTaskDotHtml(status);
        var descHtml = task.description ? '<div class="flow-task-desc">' + escapeHtml(task.description) + '</div>' : '';
        var noteHtml = task.note ? '<div class="flow-task-note">' + escapeHtml(task.note) + '</div>' : '';
        var isLast = (idx === tasks.length - 1);

        html += '<div class="flow-task-item status-' + status + (isLast ? ' flow-task-last' : '') + '" data-task-id="' + escapeHtml(task.id) + '">' +
            '<div class="flow-task-dot">' + dotHtml + '</div>' +
            '<div class="flow-task-content">' +
                '<div class="flow-task-title">' + escapeHtml(task.title) + '</div>' +
                descHtml + noteHtml +
            '</div>' +
        '</div>';
    });

    list.innerHTML = html;

    window._updateFlowProgress(tasks);

    var toggleIcon = document.querySelector('#flowPanelToggleBtn svg');
    if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
};

/** 生成时间线圆点内 SVG */
window._flowTaskDotHtml = function(status) {
    switch (status) {
        case 'pending':
            return ''; /* 空心圆点 — CSS 显示背景 */
        case 'running':
            return '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="5" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 0 20"/></svg>';
        case 'completed':
            return '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7"/></svg>';
        case 'failed':
            return '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';
        case 'skipped':
            return '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"><path d="M6 12h12"/></svg>';
        default:
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>';
    }
};

/** 更新单个任务的状态（DOM 就地更新 + 数据同步 + 高亮动画 + 会话持久化） */
window.updatePlanTaskStatus = function(taskId, newStatus, note, targetChatId) {
    if (!window._agentPlan) {
        var cid = targetChatId || (typeof currentChatId !== 'undefined' ? currentChatId : null);
        if (cid && typeof window.restorePlanForChat === 'function') {
            window.restorePlanForChat(cid);
        }
    }
    if (!window._agentPlan || !window._agentPlan.tasks) return;

    // 更新数据
    var found = false;
    window._agentPlan.tasks.forEach(function(t) {
        if (t.id === taskId) {
            t.status = newStatus;
            if (note) t.note = note;
            if (newStatus === 'running') window._agentPlan.currentTaskId = taskId;
            found = true;
        }
    });

    // 未命中计划任务时拒绝制造“幽灵任务”。旧逻辑会把截断/拼错的 task_id
    // 直接追加到列表，造成中间空项、计数增加且永远无法自然完成。
    if (!found && taskId) {
        console.warn('[FlowPanel] 忽略未知 task_id:', taskId);
        return false;
    }

    // 立即保存持久化状态
    window.savePlanState(targetChatId);

    // 更新 DOM
    var list = getEl('flowTaskList');
    if (!list) return;

    try {
        var item = list.querySelector('.flow-task-item[data-task-id="' + CSS.escape(taskId) + '"]');
    } catch(e) {
        // CSS.escape 不可用时回退到全量渲染
        window.renderPlanTasks(window._agentPlan.tasks);
        return;
    }

    if (!item) {
        // DOM 元素不存在（可能面板已关闭），全量刷新
        window.renderPlanTasks(window._agentPlan.tasks);
        return;
    }

    // 更新状态类
    ['status-pending','status-running','status-completed','status-failed','status-skipped'].forEach(function(cls) {
        item.classList.remove(cls);
    });
    item.classList.add('status-' + newStatus);

    // 更新圆点
    var dotEl = item.querySelector('.flow-task-dot');
    if (dotEl) {
        dotEl.innerHTML = window._flowTaskDotHtml(newStatus);
    }

    // 更新备注（如果有 note 字段更新）
    var taskData = null;
    window._agentPlan.tasks.forEach(function(t) { if (t.id === taskId) taskData = t; });
    var taskNote = (taskData && taskData.note) || note;
    if (taskNote) {
        var noteEl = item.querySelector('.flow-task-note');
        if (noteEl) {
            noteEl.textContent = taskNote;
        } else {
            var contentEl = item.querySelector('.flow-task-content');
            if (contentEl) {
                var newNote = document.createElement('div');
                newNote.className = 'flow-task-note';
                newNote.textContent = taskNote;
                contentEl.appendChild(newNote);
            }
        }
    }

    // 更新进度
    window._updateFlowProgress(window._agentPlan.tasks);

    // 高亮动画
    item.style.transition = 'background 0.25s ease, border-left-color 0.25s ease';
    if (newStatus === 'completed') {
        item.style.background = 'rgba(34,197,94,0.08)';
    } else if (newStatus === 'failed') {
        item.style.background = 'rgba(239,68,68,0.08)';
    } else if (newStatus === 'running') {
        item.style.background = 'rgba(99,102,241,0.1)';
    }
    setTimeout(function() {
        if (item && item.parentNode) {
            item.style.background = '';
        }
    }, 800);

    console.log('[FlowPanel] 任务 "' + taskId + '" → ' + newStatus);
    return true;
};

/** 更新进度计数器和进度条 */
window._updateFlowProgress = function(tasks) {
    if (!tasks) return;
    var total = tasks.length;
    var done = 0;
    tasks.forEach(function(t) {
        if (t.status === 'completed' || t.status === 'failed' || t.status === 'skipped') done++;
    });

    var progressEl = getEl('flowPanelProgress');
    if (progressEl) progressEl.textContent = done + '/' + total;

    var fillEl = getEl('flowProgressFill');
    if (fillEl) {
        var pct = total > 0 ? Math.round(done / total * 100) : 0;
        fillEl.style.width = pct + '%';
        // ★ 动态渐变色: 0%→50%→100% 从紫→蓝紫→绿，平滑过渡
        var r, g, b;
        if (pct <= 50) {
            var t = pct / 50;
            r = Math.round(99 + t * (139 - 99));
            g = Math.round(102 + t * (92 - 102));
            b = Math.round(241 + t * (246 - 241));
        } else {
            var t2 = (pct - 50) / 50;
            r = Math.round(139 + t2 * (16 - 139));
            g = Math.round(92 + t2 * (185 - 92));
            b = Math.round(246 + t2 * (129 - 246));
        }
        fillEl.style.background = 'linear-gradient(90deg, #6366f1, rgb(' + r + ',' + g + ',' + b + '), #10b981)';
        fillEl.style.backgroundSize = '200% 100%';
        fillEl.style.backgroundPosition = (100 - pct) + '% 0';
    }
};

/** 关闭流程面板 */
window.dismissFlowPanel = function(opts) {
    opts = opts || {};
    var panel = getEl('flowPanel');
    if (!panel) {
        if (!opts.preserveData) window._agentPlan = null;
        return;
    }

    if (!opts.preserveData) {
        if (window._agentPlan) {
            window._agentPlan.status = 'dismissed';
            window.savePlanState();
            window._agentPlan = null;
        }
    }

    if (opts.silent) {
        panel.classList.add('hidden');
        panel.classList.remove('collapsed');
        return;
    }

    // 添加关闭动画
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(-10px) scale(0.97)';
    panel.style.marginBottom = '0';
    panel.style.maxHeight = '0';
    panel.style.padding = '0';

    setTimeout(function() {
        panel.classList.add('hidden');
        panel.classList.remove('collapsed');
        // 恢复样式以便下次打开
        panel.style.opacity = '';
        panel.style.transform = '';
        panel.style.marginBottom = '';
        panel.style.maxHeight = '';
        panel.style.padding = '';
        // ★ 恢复 Agent 横幅
        var banner = getEl('agentBanner');
        if (banner && getAgentMode() !== 'off') banner.classList.remove('hidden');
        if (!opts.preserveData) {
            // 清空任务列表
            var list = getEl('flowTaskList');
            if (list) list.innerHTML = '';
            // 重置进度
            var progressEl = getEl('flowPanelProgress');
            if (progressEl) progressEl.textContent = '0/0';
            var fillEl = getEl('flowProgressFill');
            if (fillEl) fillEl.style.width = '0%';
        }
    }, 300);

    console.log('[FlowPanel] 面板已关闭' + (opts.preserveData ? ' (保留数据)' : ''));
};

// ==================== Plan 模式审批控制 ====================\n
/** 用户同意计划 → 进入执行态 */
window.approvePlan = function() {
    if (getAgentMode() !== 'plan') return;
    window._planApproved = true;
    window._planState = 'executing';
    if (window._agentPlan) {
        window._agentPlan.planState = 'executing';
        window._agentPlan.approved = true;
        window.savePlanState();
    }
    console.log('[Plan] 用户已批准计划，进入执行态');
    // 移除审批横幅
    var banner = getEl('planApprovalBanner');
    if (banner) {
        banner.style.opacity = '0';
        banner.style.transform = 'translateY(-8px)';
        banner.style.transition = 'all 0.3s ease';
        setTimeout(function() { banner.remove(); }, 300);
    }
    // 更新横幅提示
    var agentBanner = getEl('agentBanner');
    if (agentBanner) {
        agentBanner.classList.remove('hidden');
        agentBanner.className = 'agent-banner banner-plan';
        agentBanner.innerHTML = '<span class=\"agent-banner-icon\">' +
            '<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 2L2 7l10 5 10-5-10-5z\"/><path d=\"M2 17l10 5 10-5\"/><path d=\"M2 12l10 5 10-5\"/></svg></span>' +
            '<span class=\"agent-banner-text\">Plan 执行中 — 计划已批准，AI 正在执行</span>';
    }
    // 触发模型继续执行（通过 resolve 暂存的 tool call）
    if (window._pendingPlanActions && window._pendingPlanActions.length > 0) {
        window._pendingPlanActions.forEach(function(action) { action.resolve(true); });
        window._pendingPlanActions = [];
    }
};

/** 用户要求修改计划 → 回到探索态，通知模型修改 */
window.rejectPlan = function() {
    if (getAgentMode() !== 'plan') return;
    window._planApproved = false;
    window._planState = 'reviewing';
    if (window._agentPlan) {
        window._agentPlan.planState = 'reviewing';
        window._agentPlan.approved = false;
        window.savePlanState();
    }
    console.log('[Plan] 用户要求修改计划');
    // 通知模型（通过注入系统消息触发重新规划）
    var chatId = currentChatId;
    if (chats[chatId] && chats[chatId].messages) {
        chats[chatId].messages.push({
            role: 'system',
            content: '[Plan 审批] 用户要求修改计划。请根据用户反馈重新调整计划，然后再次调用 plan_update(action="create") 提交新计划。',
            _timestamp: Date.now()
        });
    }
    // 移除审批横幅
    var banner = getEl('planApprovalBanner');
    if (banner) banner.remove();
    // 更新状态
    if (window._agentPlan) window._agentPlan.status = 'exploring';
};

/** 用户取消计划 → 关闭面板，回到探索态 */
window.cancelPlan = function() {
    if (getAgentMode() !== 'plan') return;
    window._planApproved = false;
    window._planState = 'exploring';
    console.log('[Plan] 用户取消计划');
    // 通知模型取消
    var chatId = currentChatId;
    if (chats[chatId] && chats[chatId].messages) {
        chats[chatId].messages.push({
            role: 'system',
            content: '[Plan 审批] 用户取消了计划。请停止当前规划，回到普通对话。',
            _timestamp: Date.now()
        });
    }
    // 关闭面板 + 移除审批横幅
    window.dismissFlowPanel();
    var banner = getEl('planApprovalBanner');
    if (banner) banner.remove();
    window._agentPlan = null;
    window.clearPlanForChat(chatId);
};

/** 折叠/展开流程面板 */
window._toggleFlowPanelCollapse = function() {
    var panel = getEl('flowPanel');
    if (!panel) return;
    var collapsed = panel.classList.toggle('collapsed');
    try { localStorage.setItem('_flowPanelCollapsed', collapsed ? '1' : '0'); } catch(e) {}
};

/** 生成结束时智能收敛面板（非审批态时自动轻量折叠，避免大卡片死占屏幕遮挡气泡） */
window._autoCollapsePlanOnFinish = function() {
    var panel = getEl('flowPanel');
    if (!panel || panel.classList.contains('hidden')) return;
    if (typeof getAgentMode === 'function' && getAgentMode() === 'plan' && window._planState === 'reviewing') return;
    if (typeof window._autoDismissIfAllDone === 'function' && window._autoDismissIfAllDone()) return;
    panel.classList.add('collapsed');
};

/** 所有任务终态后完成并自动关闭；短暂保留100%状态供用户确认。 */
window._autoDismissIfAllDone = function(opts) {
    opts = opts || {};
    if (!window._agentPlan || !window._agentPlan.tasks || window._agentPlan.tasks.length === 0) return false;

    var allTerminal = window._agentPlan.tasks.every(function(t) {
        return t.status === 'completed' || t.status === 'failed' || t.status === 'skipped';
    });
    if (!allTerminal) return false;

    var cid = window._agentPlan.chatId || (typeof currentChatId !== 'undefined' ? currentChatId : null);
    console.log('[FlowPanel] 所有任务已进入终态，准备关闭');
    window._agentPlan.status = 'completed';
    window._agentPlan.currentTaskId = null;
    window.renderPlanTasks(window._agentPlan.tasks);
    window.savePlanState(cid);

    if (window._flowPanelDismissTimer) clearTimeout(window._flowPanelDismissTimer);
    window._flowPanelDismissTimer = setTimeout(function() {
        window._flowPanelDismissTimer = null;
        window.dismissFlowPanel({ preserveData: true });
        window.clearPlanForChat(cid);
    }, opts.immediate ? 0 : 1200);
    return true;
};

// 10秒冷却常量
const SUB_AGENT_COOLDOWN_MS = 10000;

// ==================== Session 管理 (Feature 5) ====================

// ★ fetchWithRetry → utils.js

/**
 * 清理确认对话框 (替代原生 confirm)
 * @param {string} title - 标题
 * @param {string} message - 消息
 * @param {string} confirmText - 确认按钮文字
 * @returns {Promise<boolean>}
 */
function showConfirmDialog(title, message, confirmText) {
    return new Promise(function(resolve) {
        var overlay = document.createElement('div');
        overlay.className = 'approval-overlay';
        // ★ 点击遮罩关闭 = 取消
        overlay.addEventListener('click', function(e) { if (e.target === overlay) { overlay.remove(); resolve(false); } });
        overlay.innerHTML = '<div class="approval-modal confirm-dialog">' +
            '<div class="approval-title">' + escapeHtml(title) + '</div>' +
            '<div class="confirm-message">' + escapeHtml(message) + '</div>' +
            '<div class="approval-buttons">' +
            '<button class="approval-reject" id="confirmCancelBtn">取消</button>' +
            '<button class="approval-confirm" id="confirmOkBtn">' + (confirmText || '确认') + '</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        // ★ ESC 关闭
        var escHandler = function(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); resolve(false); } };
        document.addEventListener('keydown', escHandler);

        overlay.querySelector('#confirmOkBtn').onclick = function() {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
            resolve(true);
        };
        overlay.querySelector('#confirmCancelBtn').onclick = function() {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
            resolve(false);
        };
    });
}

/**
 * 清理确认对话框 + 子代理聊天记录清理
 */
window.deleteAgent = async function(name) {
    if (!name) return;
    // ★ 先清缓存避免瞬间闪烁
    if (_selectedAgentName === name) { _selectedAgentName = null; }
    // 立即从本地列表移除
    if (window._agentListCache && window._agentListCache[name]) {
        delete window._agentListCache[name];
    }
    // 清理所有相关状态
    var key = 'agent_chat_' + name;
    localStorage.removeItem(key);
    ['_agentNotifyQueue','_pendingSubAgentResults'].forEach(function(arr) {
        if (window[arr] && Array.isArray(window[arr])) {
            window[arr] = window[arr].filter(function(item) { return (item.agentName || item) !== name; });
        }
    });
    if (window._pendingSubAgentResultsData) { delete window._pendingSubAgentResultsData[name]; }
    // ★ 清理 chats 中的子代理会话条目（侧边栏）
    var _subChatId = '_agent_sub_' + name;
    if (chats[_subChatId]) {
        var _wasActive = (currentChatId === _subChatId);
        delete chats[_subChatId];
        if (typeof saveChats === 'function') saveChats();
        if (typeof renderChatHistory === 'function') renderChatHistory();
        // 如果当前正在查看该子代理会话，切到 _agent_main
        if (_wasActive && typeof loadChat === 'function') {
            if (chats['_agent_main']) loadChat('_agent_main');
            else if (typeof createAgentChat === 'function') createAgentChat([]);
        }
    }
    // 立即更新 UI
    window._renderAgentList(window._agentListCache || {}, getEl('agentSubList'));
    window._renderAgentList(window._agentListCache || {}, getEl('engineAgentList'));
    // 异步删除 (不阻塞 UI)
    var token = getAuthToken();
    if (!token) return;
    fetch(_apiBase + '?action=agent_delete&name=' + encodeURIComponent(name), { signal: AbortSignal.timeout(30000), headers: _agentAuthHeaders() })
        .then(function() {
            return fetch(_apiBase + '?action=agent_notifications_mark', { signal: AbortSignal.timeout(30000), headers: _agentAuthHeaders() });
        })
        .then(function() { window._refreshAllAgentLists(); })
        .catch(function(e) { console.warn('[deleteAgent] 异步清理失败:', e.message); });
};

/**
 * 清理所有子代理
 */
/**
 * 定期/自动/手动清理过期的子代理会话
 * @param {number} maxAgeHours - 最大保留小时数 (0 表示全部清理，默认 24 小时)
 * @param {number} maxKeep - 最大保留数量 (默认 10 个)
 */
window.cleanupSubAgentSessions = async function(maxAgeHours = 24, maxKeep = 10) {
    if (!window.chats) return 0;
    var now = Date.now();
    var maxAgeMs = maxAgeHours * 3600 * 1000;
    
    var subKeys = Object.keys(chats).filter(function(k) {
        if (typeof k !== 'string') return false;
        return k.indexOf('_agent_sub_') === 0 ||
            k.indexOf('_goal_') === 0 ||
            k.indexOf('_continue_') === 0 ||
            k.indexOf('_runtime_') === 0 ||
            k.indexOf('_smoke_') === 0 ||
            k.indexOf('_internal_') === 0;
    });
    if (subKeys.length === 0) return 0;
    
    // 按最后更新时间升序排列 (最旧的在前面)
    subKeys.sort(function(a, b) {
        var tA = (chats[a] && (chats[a].updated_at || chats[a].created_at)) || 0;
        var tB = (chats[b] && (chats[b].updated_at || chats[b].created_at)) || 0;
        return tA - tB;
    });
    
    var toDelete = [];
    if (maxAgeHours === 0) {
        toDelete = subKeys.slice();
    } else {
        var keepKeys = subKeys.slice(-maxKeep);
        subKeys.forEach(function(k) {
            var chat = chats[k];
            var t = (chat && (chat.updated_at || chat.created_at)) || 0;
            if (now - t > maxAgeMs || !keepKeys.includes(k)) {
                toDelete.push(k);
            }
        });
    }
    
    if (toDelete.length === 0) return 0;
    
    // 先逐个删除服务器记录，再保存剩余聊天；避免并发请求触发 429，
    // 也避免 saveChats 的全量 POST 在 DELETE 完成前把旧子代理重新写回去。
    var deletedServer = 0;
    for (var _di = 0; _di < toDelete.length; _di++) {
        var k = toDelete[_di];
        delete chats[k];
        try {
            localStorage.removeItem('agent_chat_' + k.replace('_agent_sub_', ''));
            localStorage.removeItem('oc_queue_a_' + k);
            localStorage.removeItem('oc_queue_n_' + k);
        } catch(e) {}
        var _deleteOk = false;
        for (var _deleteAttempt = 0; _deleteAttempt < 4 && !_deleteOk; _deleteAttempt++) {
            try {
                var _deleteResp = await fetch('/oneapichat/api/chat.php?chat_id=' + encodeURIComponent(k), {
                    method: 'DELETE',
                    headers: getSessionAuthHeaders()
                });
                _deleteOk = _deleteResp.ok || _deleteResp.status === 404;
                if (!_deleteOk && _deleteResp.status === 429) {
                    await new Promise(function(resolve) { setTimeout(resolve, 1000 * (_deleteAttempt + 1)); });
                }
            } catch(e) {
                if (_deleteAttempt < 3) await new Promise(function(resolve) { setTimeout(resolve, 1000); });
            }
        }
        if (_deleteOk) deletedServer++;
        if (_di + 1 < toDelete.length) {
            await new Promise(function(resolve) { setTimeout(resolve, 280); });
        }
    }

    if (typeof saveChats === 'function') await saveChats();
    if (typeof renderChatHistory === 'function') renderChatHistory();
    console.log('[SubAgent] 已清理 ' + toDelete.length + ' 个过期子代理会话，本地/服务器删除确认 ' + deletedServer + ' 个');
    return toDelete.length;
};

window.clearAllAgents = async function() {
    var confirmed = await showConfirmDialog('清理所有子代理', '确定要删除所有子代理吗?\n\n此操作不可撤销,同时会删除所有子代理的聊天记录。', '全部删除');
    if (!confirmed) return;
    try {
        var agents = await window._fetchAgentListJSON();
        if (!agents) { alert('加载代理列表失败(限流中),请稍后重试'); return; }
        var names = Object.keys(agents);
        var deleted = 0;
        for (var i = 0; i < names.length; i++) {
            try {
                await fetchWithRetry('/oneapichat/api/engine_api.php?action=agent_delete&name=' + encodeURIComponent(names[i]), { headers: _agentAuthHeaders() });
                var key = 'agent_chat_' + names[i];
                localStorage.removeItem(key);
                deleted++;
            } catch(e) {
                console.warn('[clearAllAgents] 删除失败:', names[i], e.message);
            }
        }
        window.refreshEngineStatus();
        window._refreshAllAgentLists();
        // ★ 清理所有子代理会话条目（侧边栏）
        var _subKeys = Object.keys(chats).filter(function(k) { return k.indexOf('_agent_sub_') === 0; });
        _subKeys.forEach(function(k) { delete chats[k]; });
        if (_subKeys.length > 0) {
            if (typeof saveChats === 'function') saveChats();
            if (typeof renderChatHistory === 'function') renderChatHistory();
        }
        alert('已清理 ' + deleted + ' 个子代理' + (_subKeys.length > 0 ? ' 及 ' + _subKeys.length + ' 个侧边栏会话' : ''));
    } catch(e) {
        alert('清理失败: ' + e.message);
    }
};

// ★ 引擎状态自动刷新（每 15 秒）
window._engineAutoRefreshTimer = null;
window._startEngineAutoRefresh = function() {
    if (window._engineAutoRefreshTimer) return;
    window.refreshEngineStatus();
    window._engineAutoRefreshTimer = setInterval(function() {
        var _panel = getEl('configPanel');
        // 仅在配置面板可见时刷新
        if (_panel && !_panel.classList.contains('hidden-panel')) {
            window.refreshEngineStatus();
        }
    }, 15000);
};

window.refreshEngineStatus = async function() {
    var dot = getEl('engineHealthDot');
    var text = getEl('engineHealthText');
    var btn = document.querySelector('.engine-refresh-btn');
    if (!dot || !text) return;

    // 按钮 loading 动画
    if (btn) btn.classList.add('loading');
    dot.className = 'engine-status-dot offline';
    text.textContent = '检查中...';

    try {
        var resp = await fetch(_apiBase + '?action=health', { signal: AbortSignal.timeout(10000), headers: _agentAuthHeaders() });
        var _healthType = resp.headers.get('content-type') || '';
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        if (_healthType.toLowerCase().indexOf('application/json') === -1) throw new Error('引擎返回非 JSON 响应');
        var data = await resp.json();

        if (data.ok || data.status === 'ok' || data.status === 'running') {
            dot.className = 'engine-status-dot online';
            text.textContent = '引擎在线';
        } else {
            dot.className = 'engine-status-dot offline';
            text.textContent = '引擎异常: ' + (data.message || '未知');
        }
    } catch(e) {
        dot.className = 'engine-status-dot offline';
        text.textContent = '引擎离线 (' + e.message + ')';
    } finally {
        if (btn) btn.classList.remove('loading');
    }

    // 加载 cron 列表
    var cronList = getEl('engineCronList');
    if (cronList) {
        try {
            var cronResp = await fetch(_apiBase + '?action=cron_list', { signal: AbortSignal.timeout(30000), headers: _agentAuthHeaders() });
            var _cronType = cronResp.headers.get('content-type') || '';
            if (!cronResp.ok) throw new Error('HTTP ' + cronResp.status);
            if (_cronType.toLowerCase().indexOf('application/json') === -1) throw new Error('Cron 返回非 JSON 响应');
            var cronData = await cronResp.json();
            // 引擎返回 {job_name: {...}} 格式,转换为数组
            var cronJobs = Object.keys(cronData).map(function(k) { return cronData[k]; });
            var runningJobs = cronJobs.filter(function(j) { return j.enabled; });
            if (runningJobs.length > 0) {
                cronList.innerHTML = runningJobs.map(function(j) {
                    var next = j.next_run ? new Date(j.next_run * 1000).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '--';
                    var name = escapeHtml(j.name);
                    return '<div class="engine-status-item"><div style="display:flex;align-items:center;justify-content:space-between;flex:1;"><div><span class="engine-status-dot running"></span><span style="font-size:11px;">' + name + '<br><span style="color:#9ca3af;">下次 ' + next + ' · 每' + j.interval + 's</span></span></div>' +
                    '<button onclick="deleteCron(\'' + name + '\')" class="engine-cron-delete" title="删除">✕</button></div></div>';
                }).join('');
            } else {
                cronList.innerHTML = '<div class="engine-empty-hint">暂无活跃 cron 任务</div>';
            }
        } catch(e) {
            cronList.innerHTML = '<div class="engine-empty-hint">加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    }

    // 加载子代理列表(统一使用 _renderAgentList)
    var agentList = getEl('engineAgentList');
    if (agentList && Object.keys(window._agentListCache || {}).length > 0) {
        window._renderAgentList(window._agentListCache, agentList);
    } else if (agentList) {
        var agentData2 = await window._fetchAgentListJSON();
        if (agentData2) {
            window._renderAgentList(agentData2, agentList);
        } else {
            agentList.innerHTML = '<div class="engine-empty-hint">加载失败(限流中)</div>';
        }
    }
};

// ★ createSearchToggleButton 已移入 core.js (Tier 0, 避免懒加载导致 ReferenceError)

window.syncTokenFromRange = function () {
    setVal('maxTokensInput', getVal('maxTokens'));
    localStorage.setItem('tokens', getVal('maxTokens'));
    window._scheduleConfigSync();
};

window.syncTokenFromInput = function () {
    let v = parseInt(getVal('maxTokensInput')) || 4096;
    var _curModel = getVal('modelSelect') || '';
    var _modelMax = window._getModelMaxTokens(_curModel);
    v = Math.min(_modelMax, Math.max(256, v));
    setVal('maxTokensInput', v);
    setVal('maxTokens', v);
    // ★ 同步更新滑块和输入框的 max 属性
    var _slider = getEl('maxTokens');
    var _input = getEl('maxTokensInput');
    if (_slider) _slider.max = _modelMax;
    if (_input) _input.max = _modelMax;
    localStorage.setItem('tokens', String(v));
    if (localStorage.getItem('authToken')) saveConfigToServer();
};

/** 获取当前模型的最大 token 数 */
window._getModelMaxTokens = function(model) {
    try {
        if (window.MODEL_CONFIGS) {
            var _max = window.MODEL_CONFIGS.getMaxOutputTokens(model);
            if (_max && _max > 0) return _max;
            var _ctx = window.MODEL_CONFIGS.getContextWindow(model);
            if (_ctx && _ctx > 0) return _ctx;
        }
    } catch(e) {}
    return 1000000;
};

window.updateParam = (type, val) => {
    if (type === 'temp') {
        var span = getEl('tempValue');
        if (span) span.innerText = val;
        localStorage.setItem('temp', val);
        window._scheduleConfigSync();
    }
    // 不自动保存,滑动时只更新显示
};

// ═══════════════════════════════════════════════════════════════
//  OneAPIChat Vibe Coding — Live Todo 看板与 HUD 渲染系统 (纯 SVG, 禁用 Emoji)
// ═══════════════════════════════════════════════════════════════
window.clearTodoForChat = function(chatId) {
    var cid = chatId || (typeof currentChatId !== 'undefined' ? currentChatId : null);
    if (window._todoBooks && cid) {
        delete window._todoBooks[cid];
    }
    if (typeof chats !== 'undefined' && chats && cid && chats[cid]) {
        delete chats[cid]._vibeTodos;
        if (typeof slimSaveChats === 'function') slimSaveChats();
    }
    var existingHud = document.getElementById('vibeTodoHud');
    if (existingHud) {
        existingHud.style.display = 'none';
        if (existingHud._dismissTimer) {
            clearTimeout(existingHud._dismissTimer);
            existingHud._dismissTimer = null;
        }
    }
};

window._renderTodoHud = function(todos, percent, opts) {
    opts = opts || {};
    var existingHud = document.getElementById('vibeTodoHud');
    if (!Array.isArray(todos) || todos.length === 0) {
        if (existingHud) {
            existingHud.style.display = 'none';
            if (existingHud._dismissTimer) {
                clearTimeout(existingHud._dismissTimer);
                existingHud._dismissTimer = null;
            }
        }
        return;
    }

    var inProgressItem = todos.find(function(t) { return t.status === 'in_progress'; });
    var completedCount = todos.filter(function(t) { return t.status === 'completed'; }).length;
    var totalCount = todos.length;
    var isAllCompleted = totalCount > 0 && completedCount === totalCount;

    // 历史恢复时如果任务已全部完成，直接不打扰用户
    if (opts.isRestore && isAllCompleted) {
        if (existingHud) existingHud.style.display = 'none';
        return;
    }

    var hud = existingHud;
    if (!hud) {
        hud = document.createElement('div');
        hud.id = 'vibeTodoHud';
        hud.className = 'vibe-todo-hud';
        var inputClip = document.querySelector('.input-clip') || document.getElementById('chatBox');
        if (inputClip && inputClip.parentNode) {
            inputClip.parentNode.insertBefore(hud, inputClip);
        } else {
            document.body.appendChild(hud);
        }
    }
    hud.style.display = 'block';
    hud.style.opacity = '1';

    var todoIcon = (typeof window.getVibeSvg === 'function') ? window.getVibeSvg('todoList', { size: 15, className: 'text-indigo-400 inline-block mr-1.5' }) : '';
    var spinIcon = (typeof window.getVibeSvg === 'function') ? window.getVibeSvg('spinner', { size: 14, className: 'text-blue-400 mr-1.5 inline-block' }) : '';
    var checkIcon = (typeof window.getVibeSvg === 'function') ? window.getVibeSvg('checkCircle', { size: 14, className: 'text-emerald-400 mr-1.5 inline-block' }) : '';
    var dotIcon = (typeof window.getVibeSvg === 'function') ? window.getVibeSvg('circleDotted', { size: 14, className: 'text-gray-400 mr-1.5 inline-block' }) : '';

    var itemsHtml = todos.map(function(t) {
        var statusIcon = t.status === 'completed' ? checkIcon : (t.status === 'in_progress' ? spinIcon : dotIcon);
        var statusCls = 'vibe-todo-item-' + t.status;
        return '<div class="vibe-todo-row ' + statusCls + '">' +
            '<span class="vibe-todo-item-icon">' + statusIcon + '</span>' +
            '<span class="vibe-todo-item-text">' + escapeHtml(t.content) + '</span>' +
        '</div>';
    }).join('');

    hud.innerHTML =
        '<div class="vibe-todo-hud-header">' +
            '<div class="vibe-todo-hud-title">' +
                todoIcon +
                '<span class="vibe-todo-hud-label font-medium text-xs">Vibe 任务进度 (' + completedCount + '/' + totalCount + ')</span>' +
            '</div>' +
            '<div class="vibe-todo-hud-actions">' +
                '<div class="vibe-todo-hud-badge font-mono text-xs font-semibold">' + percent + '%</div>' +
                '<button type="button" class="vibe-todo-hud-close" aria-label="关闭任务面板" title="收起">&times;</button>' +
            '</div>' +
        '</div>' +
        '<div class="vibe-todo-progress-track">' +
            '<div class="vibe-todo-progress-bar" style="width: ' + percent + '%;"></div>' +
        '</div>' +
        (inProgressItem ? '<div class="vibe-todo-active-step">' + spinIcon + '<span class="text-xs font-medium">正在执行: ' + escapeHtml(inProgressItem.content) + '</span></div>' : '') +
        '<div class="vibe-todo-items-list">' + itemsHtml + '</div>';

    var closeBtn = hud.querySelector('.vibe-todo-hud-close');
    if (closeBtn) {
        closeBtn.onclick = function(e) {
            e.stopPropagation();
            if (hud._dismissTimer) {
                clearTimeout(hud._dismissTimer);
                hud._dismissTimer = null;
            }
            hud.style.opacity = '0';
            setTimeout(function() {
                hud.style.display = 'none';
                hud.style.opacity = '';
            }, 250);
        };
    }

    // 如果任务 100% 达成，展示 1.5 秒后自动收起
    if (percent === 100 && !hud._dismissTimer) {
        hud._dismissTimer = setTimeout(function() {
            hud.style.opacity = '0';
            setTimeout(function() {
                hud.style.display = 'none';
                hud.style.opacity = '';
                hud._dismissTimer = null;
            }, 300);
        }, 1500);
    } else if (percent < 100 && hud._dismissTimer) {
        clearTimeout(hud._dismissTimer);
        hud._dismissTimer = null;
        hud.style.opacity = '';
    }
};
