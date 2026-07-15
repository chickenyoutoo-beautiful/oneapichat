// agent.js — Agent 子系统 v1.0 (Phase 2 拆分自 main.js)
// 三模式系统 / 记忆人格心跳 / 审批门 / 任务计划流面板 / Session管理

// ==================== 三模式系统 (Plan / Agent / YOLO) ====================

/** 获取当前 Agent 模式: 'off' | 'plan' | 'agent' | 'yolo' */
function getAgentMode() {
    var val = localStorage.getItem('agentMode');
    // 从旧版布尔格式迁移
    if (val === 'true') { localStorage.setItem('agentMode', 'agent'); return 'agent'; }
    if (val === 'false' || val === null || val === undefined) { localStorage.setItem('agentMode', 'off'); return 'off'; }
    if (['off','plan','agent','yolo'].indexOf(val) === -1) { localStorage.setItem('agentMode', 'off'); return 'off'; }
    return val;
}

/** 设置 Agent 模式并更新 UI */
function setAgentMode(mode) {
    if (['off','plan','agent','yolo'].indexOf(mode) === -1) mode = 'off';
    var prevMode = getAgentMode();

    // ★ 同模式再次点击 = 退出到 off
    if (mode !== 'off' && mode === prevMode) {
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

    // ★ 消息队列隔离：模式切换时先保存旧队列
    if (_newIsAgent !== _prevIsAgent) {
        console.log('[Queue] mode switch: prev=' + prevMode + ' new=' + mode + ' chatId=' + currentChatId + ' items=' + window._messageQueue.length);
        window._saveQueue();  // 保存到旧模式的 key
        window._agentModeSwitching = true;
    }

    localStorage.setItem('agentMode', mode);  // ★ 必须在后续 loadChat 之前设置
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
        window._agentAnimLock = setTimeout(function() { window._agentAnimLock = null; }, 700);
    } else if (mode === 'off' && (prevMode === 'agent' || prevMode === 'yolo' || prevMode === 'plan')) {
        // ★ 切回 off: 退出特效(仅当从非 off 模式切换时)
        playAgentExitEffect(prevMode);
        window._agentAnimLock = setTimeout(function() { window._agentAnimLock = null; }, 700);
    }

    updateAgentUI();
    if (mode === 'agent' || mode === 'yolo') {
        // Agent/YOLO 模式开启时自动启用 Agent 专属工具
        AGENT_TOOL_KEYS.forEach(function(k) { window.setToolEnabled(k, true); });

        // ★ Agent 模式: 自动收起左侧栏, 切换到新 agent 聊天
        var wasCollapsed = $.sidebar?.classList.contains('collapsed');
        if (!wasCollapsed) {
            $.sidebar?.classList.add('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'block';
        }
        // 保存当前普通聊天 ID
        if (currentChatId && currentChatId !== '_agent_main') {
            lastNormalChatId = currentChatId;
            localStorage.setItem('lastNormalChatId', lastNormalChatId);
        }
        var agentId = '_agent_main';
        if (!chats[agentId]) {
            createAgentChat().then(function() {
                _inheritChatContext(agentId);
                loadChat(agentId);
            });
        } else {
            if (chats[agentId].messages && chats[agentId].messages.length <= 1) {
                _inheritChatContext(agentId);
            }
            loadChat(agentId);
        }
    } else if (mode === 'off') {
        // ★ 普通模式: 关闭所有 Agent 专属工具
        AGENT_TOOL_KEYS.forEach(function(k) { window.setToolEnabled(k, false); });
        // 恢复侧边栏
        var wasCollapsed = $.sidebar?.classList.contains('collapsed');
        if (wasCollapsed) {
            $.sidebar?.classList.remove('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
        }
        // 切回普通模式: 恢复上次普通聊天
        var restoreId = lastNormalChatId;
        if (!restoreId || !chats[restoreId]) {
            restoreId = Object.keys(chats).filter(function(id) {
                return id !== '_agent_main' && chats[id] && chats[id].messages && chats[id].messages.length > 0;
            }).sort(function(a,b) {
                return (chats[b].updated_at || 0) - (chats[a].updated_at || 0);
            })[0];
        }
        if (restoreId && chats[restoreId]) {
            // 等退出动画播完再切换（loadChat 内部会设置 currentChatId）
            setTimeout(function() {
                loadChat(restoreId);
                renderChatHistory();
                updateHeaderTitle();
            }, 750);
        }
    }
    // plan 模式: 不碰侧边栏和聊天切换, 消息注入普通聊天
    if (mode === 'plan') {
        AGENT_TOOL_KEYS.forEach(function(k) { window.setToolEnabled(k, false); });
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
    var enterTimer = setTimeout(function() { overlay.style.opacity = '0'; overlay.style.transition = 'opacity 0.25s ease'; var fadeTimer = setTimeout(function() { overlay.remove(); delete _agentOverlayMap[mode]; }, 250); _agentOverlayMap[mode] = { el: overlay, timer: fadeTimer }; }, 900);
    _agentOverlayMap[mode] = { el: overlay, timer: enterTimer };
}

function playAgentExitEffect(mode) {
    _clearAgentOverlay('exit:' + mode);
    // ★ 退出: 暗色淡出,柔和醒目
    var exitWord = 'OFF';

    var overlay = document.createElement('div');
    overlay.className = 'agent-transition-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;pointer-events:none;';
    overlay.innerHTML = '' +
        '<div style="position:absolute;inset:0;backdrop-filter:blur(6px) brightness(0.85);-webkit-backdrop-filter:blur(6px) brightness(0.85);background:rgba(0,0,0,0.15);animation:agent-exit-mask 0.5s ease forwards;will-change:opacity;transform:translateZ(0);"></div>' +
        '<div style="position:absolute;top:50%;left:50%;width:250vw;height:250vw;border-radius:50%;border:2px solid rgba(255,255,255,0.1);transform:translate(-50%,-50%);animation:agent-ring-collapse 0.5s cubic-bezier(0.5,0,0.8,0.4) forwards;"></div>' +
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">' +
            '<div style="font-family:system-ui,sans-serif;font-size:42px;font-weight:600;letter-spacing:5px;color:rgba(255,255,255,0.7);opacity:0;animation:agent-exit-text 0.5s ease forwards;">' + exitWord + '</div>' +
        '</div>';
    document.body.appendChild(overlay);
    var exitKey = 'exit:' + mode;
    var exitTimer = setTimeout(function() { overlay.style.opacity = '0'; overlay.style.transition = 'opacity 0.2s'; var fadeTimer = setTimeout(function() { overlay.remove(); delete _agentOverlayMap[exitKey]; }, 200); _agentOverlayMap[exitKey] = { el: overlay, timer: fadeTimer }; }, 650);
    _agentOverlayMap[exitKey] = { el: overlay, timer: exitTimer };
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
        // 找到最近活跃的普通聊天
        var normalChats = Object.keys(chats).filter(function(id) {
            return id !== '_agent_main' && chats[id] && chats[id].messages && chats[id].messages.length > 0;
        }).sort(function(a, b) {
            return (chats[b].updated_at || 0) - (chats[a].updated_at || 0);
        });
        var sourceId = currentChatId && currentChatId !== '_agent_main' ? currentChatId : normalChats[0];
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

/** 向引擎发送 POST 请求 */
async function _agentApiPost(action, data) {
    var token = _agentGetAuthToken();
    var url = _agentEngineUrl() + 'engine_api.php?action=' + action;
    if (token) url += '&auth_token=' + encodeURIComponent(token);
    try {
        var resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
    if (token) url += '&auth_token=' + encodeURIComponent(token);
    try {
        var resp = await fetch(url);
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
    var token = localStorage.getItem('authToken');
    if (!token) return null;
    try {
        var resp = await fetch('/oneapichat/api/memory_api.php?action=smart_context&limit=15&token=' + encodeURIComponent(token));
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
    var token = localStorage.getItem('authToken');
    if (!token) return null;
    try {
        var resp = await fetch('/oneapichat/api/memory_api.php?action=search_memories&q=身份&token=' + encodeURIComponent(token));
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
        var resp = await fetch('/oneapichat/api/memory_api.php?action=get_memories&token=' + encodeURIComponent(token));
        var data = await resp.json();
        var memories = data.memories || [];
        if (memories.length === 0) {
            listEl.innerHTML = '<div style="font-size:11px;color:#9ca3af;text-align:center;padding:12px;">暂无记忆</div>';
        } else {
            listEl.innerHTML = memories.map(function(m) {
                var k = escapeHtml(m.key || '');
                var c = escapeHtml((m.content || '').substring(0, 60));
                return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;font-size:11px;border-bottom:1px solid #f3f4f6;" class="dark:border-gray-700">' +
                    '<span><b>' + k + '</b>: ' + c + '</span>' +
                    '<button onclick="window.deleteMemoryEntry(\'' + k.replace(/'/g, "\\'") + '\')" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:11px;">✕</button>' +
                '</div>';
            }).join('');
        }
    } catch(e) {
        listEl.innerHTML = '<div style="font-size:11px;color:#ef4444;text-align:center;padding:12px;">加载失败</div>';
    }
    window._loadCloudMemories();
    window._loadCloudIdentity();
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
        var resp = await fetch('/oneapichat/api/memory_api.php?action=save_memory&token=' + encodeURIComponent(token), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key, content: content })
        });
        var data = await resp.json();
        if (data.success) {
            keyEl.value = ''; contentEl.value = '';
            showToast('记忆已保存', 'success');
            window.refreshMemoryList();
        } else {
            showToast(data.error || '保存失败', 'error');
        }
    } catch(e) { showToast('保存失败', 'error'); }
};

window.deleteMemoryEntry = async function(key) {
    if (!confirm('删除记忆: ' + key + '?')) return;
    var token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        var resp = await fetch('/oneapichat/api/memory_api.php?action=delete_memory&token=' + encodeURIComponent(token), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key })
        });
        var data = await resp.json();
        if (data.success) {
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
        var resp = await fetch('/oneapichat/api/memory_api.php?action=get_memories&token=' + encodeURIComponent(token));
        var data = await resp.json();
        var memories = data.memories || [];
        for (var i = 0; i < memories.length; i++) {
            await fetch('/oneapichat/api/memory_api.php?action=delete_memory&token=' + encodeURIComponent(token), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: memories[i].key })
            });
        }
        showToast('已清空 ' + memories.length + ' 条记忆', 'success');
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
                max_tokens: 300
            })
        });
        if (!resp.ok) return;
        var data = await resp.json();
        var text = data.choices?.[0]?.message?.content || '';
        // 提取JSON
        var jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return;
        var items = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(items) || items.length === 0) return;

        // 保存每条记忆
        var saved = 0;
        for (var i = 0; i < items.length; i++) {
            if (!items[i].key || !items[i].content) continue;
            await fetch('/oneapichat/api/memory_api.php?action=save_memory&token=' + encodeURIComponent(token), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: items[i].key, content: items[i].content })
            });
            saved++;
        }
        if (saved > 0) {
            console.log('[自动记忆] 已保存 ' + saved + ' 条');
            window._loadCloudMemories();
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
        var resp = await fetch('/oneapichat/api/memory_api.php?action=search_memories&q=identity_user_name&token=' + encodeURIComponent(token));
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
 * 在 Agent 聊天加载时,从引擎加载记忆/人格/身份并注入 system prompt
 */
async function _injectAgentMemoryIntoSystem(chatId) {
    if (chatId !== AGENT_CHAT_ID) return;
    var chat = chats[chatId];
    if (!chat || !chat.messages) return;

    try {
        // 并行加载记忆、人格、身份
        var [personaRes, identityRes, memoryRes] = await Promise.all([
            window.loadAgentPersona(),
            window.loadAgentIdentity(),
            window.loadAgentMemory()
        ]);

        // ★ 缓存到内存,供 API 调用时注入
        window.__agentPersonaCache = null;
        window.__agentIdentityCache = null;
        window.__agentMemoryCache = null;

        var sysIdx = chat.messages.findIndex(function(m) { return m.role === 'system'; });
        var baseSys = '';

        // 构建记忆注入块
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
            memoryBlock += '\n## 长期记忆\n';
            memoryBlock += '以下是你与用户的长期记忆(记住这些信息以便后续对话):\n';
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

        // 注入:替换或追加到第一条 system 消息
        if (sysIdx !== -1) {
            var existingContent = chat.messages[sysIdx].content;
            // 移除旧的记忆注入块(如果有)
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
    window.setAgentMode = function(mode) {
        origSetAgentMode(mode);
        // ★ 选完关闭 popup(桌面端hover也适用)
        var popup = getEl('agentModePopup');
        if (popup) popup.classList.remove('show');
        _startAgentHeartbeatIfNeeded();
    };
})();


window.openAgentPanel = function() {
    var ap = $.agentPanel || getEl('agentPanel');
    var cp = $.configPanel || getEl('configPanel');
    if (!ap) return;

    if (isMobile()) {
        // 移动端:关配置面板,用遮罩
        if (cp) cp.classList.remove('mobile-open');
        ap.style.display = '';
        ap.classList.remove('hidden-panel');
        $.sidebarMask?.classList.add('active');
        lockBodyScroll(true);
        window.refreshAgentPanel();
        // 启动定时刷新
        startAgentPanelRefresh();
        return;
    }

    // 桌面端:先关配置面板
    if (cp && !cp.classList.contains('hidden-panel')) {
        cp.classList.add('hidden-panel');
    }
    // 确保 display 可见,然后移除隐藏类
    ap.style.display = '';
    // 使用 requestAnimationFrame 确保布局正确
    requestAnimationFrame(function() {
        ap.classList.remove('hidden-panel');
    });
    // 清除非通知红点
    var dot = getEl('agentNotifDot');
    window.refreshAgentPanel();
    startAgentPanelRefresh();
};

window.closeAgentPanel = function() {
    var ap = $.agentPanel || getEl('agentPanel');
    if (!ap) return;

    if (isMobile()) {
        ap.classList.add('hidden-panel');
        $.sidebarMask?.classList.remove('active');
        lockBodyScroll(false);
        if (_agentPanelRefreshTimer) {
            clearInterval(_agentPanelRefreshTimer);
            _agentPanelRefreshTimer = null;
        }
        return;
    }

    ap.classList.add('hidden-panel');
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
        // 刷新代理列表
        window.refreshAgentPanel();
        // 如果选中了代理,同步刷新聊天内容
        if (_selectedAgentName) {
            // ★ 保持选中状态,只更新内容(不覆盖已渲染的聊天历史)
            var token = getAuthToken();
            if (token) {
                fetch(_apiBase + '?action=agent_list&auth_token=' + token, { signal: AbortSignal.timeout(900000) })
                    .then(function(r) { return r.json(); })
                    .then(function(agents) {
                        var a = agents[_selectedAgentName];
                        var msgArea = getEl('agentChatMessages');
                        if (!msgArea) return;
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
                    }).catch(function() { /* 静默 */ });
            }
        }

    }, 5000);
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
        var dotClass = a.status === 'running' ? 'running' : a.status === 'completed' ? 'completed' : a.status === 'failed' ? 'offline' : 'idle';
        var preview = '';
        if (a.result) {
            preview = '<div class="text-xs text-gray-400 truncate mt-0.5" style="font-size:10px;">' + escapeHtml(a.result.substring(0, 50)) + '</div>';
        } else if (a.error) {
            preview = '<div class="text-xs text-red-400 truncate mt-0.5" style="font-size:10px;">' + escapeHtml(a.error.substring(0, 50)) + '</div>';
        }
        var safeName = escapeHtml(name);
        var statusColor = a.status==='completed'?'#6366f1' : a.status==='failed'?'#ef4444' : a.status==='running'?'#10b981' : '#9ca3af';
        var role = a.role || 'general';
        var roleColor = roleColors[role] || '#9ca3af';
        var roleLabel = roleLabels[role] || role;
        return '<div class="agent-sub-item" onclick="window.selectAgentChat(\'' + safeName + '\')">' +
            '<div class="flex items-center gap-2 min-w-0 flex-1">' +
                '<span class="agent-sub-dot ' + dotClass + '"></span>' +
                '<div class="min-w-0 flex-1">' +
                    '<span class="text-xs font-medium truncate block">' + safeName + '</span>' +
                    '<div class="flex gap-1 items-center mt-0.5">' +
                        '<span class="text-xs" style="color:' + roleColor + ';font-weight:500;">' + roleLabel + '</span>' +
                        (preview || '<span class="text-xs text-gray-400" style="font-size:10px;">' + (a.status || 'idle') + '</span>') +
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

window._refreshAllAgentLists = async function() {
    var token = getAuthToken();
    if (!token) return;
    try {
        var r = await fetch(_apiBase + '?action=agent_list&auth_token=' + token, { signal: AbortSignal.timeout(900000) });
        var agents = await r.json();
        // 验证返回的数据是有效对象
        if (typeof agents !== 'object' || agents === null || Array.isArray(agents)) {
            throw new Error('引擎返回无效数据');
        }
        window._agentListCache = agents;
        window._agentListCacheTime = Date.now();
        window._renderAgentList(agents, getEl('agentSubList'));
        window._renderAgentList(agents, getEl('engineAgentList'));
        var dptuiContainer = getEl('agentSubListDptui');
        if (dptuiContainer && dptuiContainer !== getEl('agentSubList')) window._renderAgentList(agents, dptuiContainer);
    } catch(e) {
        // 显示错误但不中断,保留上次缓存
        var msg = '加载失败: ' + e.message;
        var lists = ['agentSubList', 'agentSubListDptui', 'engineAgentList'];
        lists.forEach(function(id) {
            var el = getEl(id);
            if (el) el.innerHTML = '<div class="text-xs text-gray-500 p-2" style="font-size:10px;">' + escapeHtml(msg) + '</div>';
        });
        // 如果缓存超过30秒,清除缓存避免展示过时数据
        if (window._agentListCacheTime && Date.now() - window._agentListCacheTime > 30000) {
            window._agentListCache = {};
        }
        console.warn('[AgentPanel] 刷新失败:', e.message);
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

window.selectAgentChat = function(agentName) {
    _selectedAgentName = agentName;
    getEl('agentChatTitle').innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg> ' + escapeHtml(agentName);
    var msgArea = getEl('agentChatMessages');
    // 从 localStorage 读取该代理的聊天记录
    var key = 'agent_chat_' + agentName;
    var msgs = JSON.parse(localStorage.getItem(key) || '[]');
    if (msgs.length === 0) {
        var token = getAuthToken();
        if (!token) { msgArea.innerHTML = '<div class="text-xs text-gray-400">请先登录</div>'; return; }
        msgArea.innerHTML = '<div class="text-xs text-gray-400">获取中...</div>';
        fetch(_apiBase + '?action=agent_list&auth_token=' + token, { signal: AbortSignal.timeout(900000) })
            .then(function(r) { return r.json(); })
            .then(function(agents) {
                var a = agents[agentName];
                if (!a) { msgArea.innerHTML = '<div class="text-xs text-gray-400">代理不存在(可能已被删除)</div>'; return; }
                if (a.status === 'running') {
                    var partial = a.result || '';
                    if (partial) {
                        msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant">' +
                            '<div class="text-xs text-green-500 font-medium mb-1">🟡 运行中,已生成内容:</div>' +
                            '<div class="text-xs whitespace-pre-wrap text-gray-600 dark:text-gray-300" style="font-size:11px;max-height:300px;overflow-y:auto;">' + escapeHtml(partial.substring(0, 2000)) + '</div>' +
                            '<div class="text-xs text-gray-400 mt-1">轮询刷新中...</div></div>';
                    } else {
                        msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant"><div class="text-xs text-green-500 font-medium">🟢 正在运行中...</div></div>';
                    }
                    return;
                }
                if (a.result) {
                        var rEl = getEl('agentChatMessages');
                        if (rEl) {
                            rEl.innerHTML = '<div class="agent-chat-bubble role-assistant">' +
                                '<div class="text-xs text-gray-400 mb-1">' + escapeHtml(agentName) + '</div>' +
                                '<div class="text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300">' + escapeHtml(a.result.substring(0, 3000)) + '</div>' +
                                '</div>';
                        }
                        var ms = [{ role: 'assistant', content: a.result, time: Date.now() }];
                        localStorage.setItem(key, JSON.stringify(ms));
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
    fetch(_apiBase + '?action=agent_notifications&auth_token=' + token, { signal: AbortSignal.timeout(900000) })
        .then(function(r) { return r.json(); })
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
            var tips = { 'plan': 'Plan 只读 · 仅搜索和读取', 'agent': 'Agent 交互 · AI可操作需审批', 'yolo': 'YOLO 自动 · 所有操作自动批准' };
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
    // ★ 统一侧边栏：Agent/Plan/YOLO 收起, Off 展开
    if (mode === 'off') {
        if ($.sidebar?.classList.contains('collapsed')) {
            $.sidebar.classList.remove('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
        }
    } else {
        if ($.sidebar && !$.sidebar.classList.contains('collapsed')) {
            $.sidebar.classList.add('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'block';
        }
    }
    document.body.classList.toggle('agent-active', isActive);

    // ★ 普通模式: 改输入框提示文字,过滤Agent命令
    var input = $.userInput || getEl('userInput');
    if (input) {
        input.placeholder = mode === 'off' ? '发送消息... / 开头用斜杠命令' : '发送消息给 Agent... / 开头用斜杠命令';
    }
    // 过滤命令列表
    _updateCommandFilter(mode);
}

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
// ★ 悬停模式菜单定位
function _positionModePopup() {
    var popup = getEl('agentModePopup');
    var wrapper = document.querySelector('.agent-mode-wrapper');
    if (!popup || !wrapper) return;

    var rect = wrapper.getBoundingClientRect();

    if (window.matchMedia('(max-width: 640px)').matches) {
        // ★ 移动端: 紧贴按钮下方弹出
        popup.style.top = (rect.bottom + 4) + 'px';
        popup.style.left = rect.left + 'px';
        popup.style.right = 'auto';
        popup.style.bottom = 'auto';
        return;
    }
    var popupRect = popup.getBoundingClientRect();
    var POPUP_HEIGHT = popupRect.height || 40;
    var spaceBelow = window.innerHeight - rect.bottom;

    // 下方空间够就向下弹,否则向上
    if (spaceBelow >= POPUP_HEIGHT + 8) {
        popup.style.top = (rect.bottom + 4) + 'px';
    } else {
        popup.style.top = (rect.top - POPUP_HEIGHT - 4) + 'px';
    }
    popup.style.left = rect.left + 'px';
    popup.style.right = 'auto';
    popup.style.bottom = 'auto';
}

// 页面加载时预定位模式菜单
setTimeout(_positionModePopup, 500);
window.addEventListener('resize', _positionModePopup);
// ★ Agent 模式弹出菜单(鼠标延迟隐藏 + 移动端点击切换)
window._agentPopupTimer = null;
window._setupAgentPopup = function() {
    var wrapper = document.querySelector('.agent-mode-wrapper');
    var popup = getEl('agentModePopup');
    var mainBtn = document.getElementById('agentMainBtn');
    if (!wrapper || !popup || !mainBtn) return;

    function updateBtnLabel() {
        var el = mainBtn.querySelector('.agent-btn-label');
        if (!el) return;
        var mode = getAgentMode();
        var texts = { 'off': 'Agent', 'plan': 'Plan', 'agent': 'Agent', 'yolo': 'YOLO' };
        el.style.transition = 'opacity 0.15s';
        el.style.opacity = '0';
        setTimeout(function() {
            el.textContent = texts[mode] || 'Agent';
            el.style.opacity = '1';
        }, 120);
    }
    updateBtnLabel();

    var isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia('(pointer:coarse)').matches;

    if (isTouch) {
        var tapTimer = null, lastTap = 0;
        mainBtn.addEventListener('click', function(e) {
            e.preventDefault();
            var now = Date.now();
            if (now - lastTap < 400) {
                clearTimeout(tapTimer); lastTap = 0;
                popup.classList.remove('show');
                var curMode = getAgentMode();
                setAgentMode(curMode !== 'off' ? 'off' : 'agent');
                // ★ 双击后立即刷新按钮文字
                var lbl = mainBtn.querySelector('.agent-btn-label');
                if (lbl) {
                    var m = getAgentMode();
                    var ts = { 'off': 'Agent', 'plan': 'Plan', 'agent': 'Agent', 'yolo': 'YOLO' };
                    lbl.textContent = ts[m] || 'Agent';
                    lbl.style.opacity = '1';
                }
                return;
            }
            lastTap = now;
            if (popup.classList.contains('show')) {
                popup.classList.remove('show');
            } else {
                _positionModePopup();
                popup.classList.add('show');
                if (getAgentMode() !== 'off') {
                    var label = mainBtn.querySelector('.agent-btn-label');
                    if (label) {
                        label.style.opacity = '0';
                        setTimeout(function() {
                            label.textContent = '双击关闭';
                            label.style.opacity = '1';
                            setTimeout(function() {
                                label.style.opacity = '0';
                                setTimeout(function() {
                                    var m = getAgentMode();
                                    var ts = { 'off': 'Agent', 'plan': 'Plan', 'agent': 'Agent', 'yolo': 'YOLO' };
                                    label.textContent = ts[m] || 'Agent';
                                    label.style.opacity = '1';
                                }, 100);
                            }, 800);
                        }, 120);
                    }
                }
            }
            tapTimer = setTimeout(function() { lastTap = 0; }, 450);
        });
    } else {
        // ★ 桌面端: 单击切换模式, Agent 激活时双击关闭
        var _desktopClickTimer = null;
        mainBtn.addEventListener('click', function(e) {
            var curMode = getAgentMode();
            if (_desktopClickTimer) {
                // 第二次点击: 直接切换
                clearTimeout(_desktopClickTimer);
                _desktopClickTimer = null;
                if (curMode !== 'off') {
                    setAgentMode('off');
                } else {
                    setAgentMode('agent');
                }
                return;
            }
            // 第一次点击: 延迟执行,等第二次点击
            _desktopClickTimer = setTimeout(function() {
                _desktopClickTimer = null;
                var m = getAgentMode();
                var newMode = (m === 'off' || !m) ? 'agent' : 'off';
                setAgentMode(newMode);
            }, 250);
        });
        wrapper.addEventListener('mouseenter', function() {
            if (window._agentPopupTimer) clearTimeout(window._agentPopupTimer);
            _positionModePopup();
            popup.classList.add('show');
        });
        wrapper.addEventListener('mouseleave', function() {
            window._agentPopupTimer = setTimeout(function() { popup.classList.remove('show'); }, 200);
        });
        popup.addEventListener('mouseenter', function() { if (window._agentPopupTimer) clearTimeout(window._agentPopupTimer); });
        popup.addEventListener('mouseleave', function() { popup.classList.remove('show'); });
    }

    document.addEventListener('click', function(e) {
        if (!popup.classList.contains('show')) return;
        if (!wrapper.contains(e.target) && !popup.contains(e.target)) popup.classList.remove('show');
    });
    document.addEventListener('touchmove', function() { popup.classList.remove('show'); }, { passive: true });
};


function updateModeSelector(mode) {
    mode = mode || getAgentMode();
    // 更新下拉菜单中的模式按钮
    var dropdown = getEl('agentModeDropdown');
    if (dropdown) {
        var opts = dropdown.querySelectorAll('.agent-mode-opt');
        opts.forEach(function(opt) {
            var optMode = opt.getAttribute('data-mode');
            opt.classList.toggle('active', optMode === mode);
        });
    }
    // 也更新旧模式选择器(兼容)
    var selector = getEl('agentModeSelector');
    if (selector) {
        var btns = selector.querySelectorAll('.mode-btn');
        btns.forEach(function(btn) {
            var btnMode = btn.getAttribute('data-mode');
            btn.classList.toggle('active', btnMode === mode);
        });
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

        // Plan 模式: 拒绝所有写操作
        if (mode === 'plan') {
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

        confirmBtn.onclick = function() {
            var remember = overlay.querySelector('#approvalRememberCheck');
            if (remember && remember.checked) {
                remembered[rememberKey] = true;
                try { sessionStorage.setItem('approvalRemembered', JSON.stringify(remembered)); } catch(e) {}
            }
            // Feature 2: 始终允许此类型
            var alwaysAllow = overlay.querySelector('#approvalAlwaysAllowCheck');
            if (alwaysAllow && alwaysAllow.checked) {
                addAlwaysAllowRule(toolName);
            }
            sessionUsage.approvalsGranted++;
            overlay.remove();
            resolve(true);
        };

        rejectBtn.onclick = function() {
            var remember = overlay.querySelector('#approvalRememberCheck');
            if (remember && remember.checked) {
                remembered[rememberKey] = false;
                try { sessionStorage.setItem('approvalRemembered', JSON.stringify(remembered)); } catch(e) {}
            }
            sessionUsage.approvalsRejected++;
            overlay.remove();
            resolve(false);
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
        var r = await fetch(_apiBase + '?action=cron_delete&auth_token=' + getAuthToken() + '&name=' + encodeURIComponent(name), { signal: AbortSignal.timeout(900000) });
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
    console.log('[Task] 创建任务 ' + taskId + ': ' + (userMessage || '').substring(0, 50));
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
    // 所有子代理已完成,触发主代理回复
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
            var detail = (stored.error || stored.result || '').substring(0, 6000);
            results.push(statusLabel + ' ' + name + '\n' + detail);
        } else {
            results.push('⏰超时 ' + name + ' (无返回)');
        }
    });
    var ctx = results.join('\n\n---\n\n');

    var chatId = task.chatId;
    if (chatId && chats[chatId] && typeof window.sendMessage === 'function') {
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
        
        // ★ OpenClaw 风格: 不打断当前生成,等 AI 空闲后再发送
        // 当前 turn 的 finally 中会调 _drainQueue 来处理
        // _drainQueue 会检查 isTypingMap 然后发下一条
        var _sendSummary = function() {
            if (!isTypingMap[chatId]) {
                window.sendMessage(true, '请整合子代理结果并告知用户进展');
                console.log('[Task] ' + taskId + ' 已触发主代理回复');
                return true;
            }
            // AI 忙:把主代理回复推入_enginePendingQueue,等空闲时处理
            // 或者直接让 sendMessage 的 finally 触发
            console.log('[Task] ' + taskId + ' 主代理忙,等当前turn完成');
            return false;
        };
        _sendSummary();
    }
    
    // 延迟标记引擎端通知已处理 + 清理
    setTimeout(function() {
        var token = getAuthToken();
        if (token) {
            fetch(_apiBase + '?action=agent_notifications_mark&auth_token=' + token, { signal: AbortSignal.timeout(900000) }).catch(function() {});
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

// triggerAgentAutoReplyForSubAgent: 被 mainAgentReply 按钮和新通知系统调用
// 作为 pushAgentResultToTask 的降级：当没有 task 时，创建临时 task 然后触发回复
window.triggerAgentAutoReplyForSubAgent = function(agentName) {
    // 尝试找到包含此 agent 的 task
    if (window._tasks && typeof window._tasks === 'object') {
        for (var _tId in window._tasks) {
            var _t = window._tasks[_tId];
            if (_t && _t.agents && _t.agents[agentName] && !_t.mainResponded) {
                // 状态可能还是 running，手动标记为 completed
                if (_t.agents[agentName].status === 'running') {
                    _t.agents[agentName].status = 'completed';
                }
                var stored = (window._pendingSubAgentResultsData || {})[agentName];
                if (stored && !_t.subResults[agentName]) {
                    _t.subResults[agentName] = { status: stored.status || 'completed', result: stored.result || '', error: stored.error || '' };
                }
                window._checkTaskCompletion(_tId);
                return;
            }
        }
    }
    // 降级: 无 task → 创建新 task 然后直接触发回复
    var taskId = window.createTask('[系统] 子代理 ' + agentName + ' 完成', currentChatId);
    var task = window._tasks[taskId];
    var stored = (window._pendingSubAgentResultsData || {})[agentName];
    task.agents[agentName] = { status: 'completed', role: 'general', createdAt: Date.now() };
    if (stored) {
        task.subResults[agentName] = { status: stored.status || 'completed', result: stored.result || '', error: stored.error || '' };
    }
    window._triggerMainAgentForTask(taskId);
};

window._legacyTrigger = window.triggerAgentAutoReplyForSubAgent;
window._agentNotifyQueue = [];
window._pendingSubAgentResultsData = {};  // 保留兼容

// ==================== Agent 任务计划流面板 ====================

/** 当前活跃的计划数据: null | { tasks: [{id,title,description,status,note}], createdAt, status, currentTaskId } */
window._agentPlan = null;

/** 创建并显示流程面板 */
window.createFlowPanel = function(plan) {
    if (!plan || !plan.tasks || plan.tasks.length === 0) return;
    window._agentPlan = plan;

    var panel = getEl('flowPanel');
    if (!panel) return;

    // ★ 隐藏 Agent 模式横幅，避免被面板顶上去
    var banner = getEl('agentBanner');
    if (banner) banner.classList.add('hidden');

    // 重置折叠状态，确保面板完全展开
    panel.classList.remove('collapsed', 'hidden');

    // 强制回流后渲染（确保 CSS transition 触发）
    void panel.offsetWidth;

    // 渲染任务列表
    window.renderPlanTasks(plan.tasks);

    // 滚动聊天区域使面板可见
    setTimeout(function() {
        if ($.chatBox) {
            var panelBottom = panel.getBoundingClientRect().bottom;
            var chatBottom = $.chatBox.getBoundingClientRect().bottom;
            if (panelBottom > chatBottom - 60) {
                $.chatBox.scrollTop = $.chatBox.scrollHeight;
            }
        }
    }, 100);

    console.log('[FlowPanel] 创建计划，共 ' + plan.tasks.length + ' 个任务');
};

/** 渲染所有任务项到流程列表 (时间线设计) */
window.renderPlanTasks = function(tasks) {
    var list = getEl('flowTaskList');
    if (!list) return;

    if (!tasks || tasks.length === 0) {
        list.innerHTML = '<div class="text-xs text-gray-400 dark:text-gray-500 p-3 text-center">暂无任务</div>';
        return;
    }

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

/** 更新单个任务的状态（DOM 就地更新 + 数据同步 + 高亮动画） */
window.updatePlanTaskStatus = function(taskId, newStatus) {
    if (!window._agentPlan || !window._agentPlan.tasks) return;

    // 更新数据
    var found = false;
    window._agentPlan.tasks.forEach(function(t) {
        if (t.id === taskId) {
            t.status = newStatus;
            if (newStatus === 'running') window._agentPlan.currentTaskId = taskId;
            found = true;
        }
    });
    if (!found) return;

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
    if (taskData && taskData.note) {
        var noteEl = item.querySelector('.flow-task-note');
        if (noteEl) {
            noteEl.textContent = taskData.note;
        } else {
            var contentEl = item.querySelector('.flow-task-content');
            if (contentEl) {
                var newNote = document.createElement('div');
                newNote.className = 'flow-task-note';
                newNote.textContent = taskData.note;
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
        // pct=0: indigo #6366f1, pct=50: violet #8b5cf6, pct=100: emerald #10b981
        var r, g, b;
        if (pct <= 50) {
            // 0%→50%: indigo→violet
            var t = pct / 50;
            r = Math.round(99 + t * (139 - 99));
            g = Math.round(102 + t * (92 - 102));
            b = Math.round(241 + t * (246 - 241));
        } else {
            // 50%→100%: violet→emerald
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
window.dismissFlowPanel = function() {
    var panel = getEl('flowPanel');
    if (!panel) { window._agentPlan = null; return; }

    // 如果已完成/已关闭则直接清理不留痕迹
    if (window._agentPlan && window._agentPlan.status !== 'running') {
        // 已终态 — 直接隐藏不清除状态标记
    } else if (window._agentPlan && window._agentPlan.status === 'running') {
        window._agentPlan.status = 'dismissed';
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
        // 清空任务列表
        var list = getEl('flowTaskList');
        if (list) list.innerHTML = '';
        // 重置进度
        var progressEl = getEl('flowPanelProgress');
        if (progressEl) progressEl.textContent = '0/0';
        var fillEl = getEl('flowProgressFill');
        if (fillEl) fillEl.style.width = '0%';
    }, 300);

    console.log('[FlowPanel] 面板已关闭');
};

/** 折叠/展开流程面板 */
window._toggleFlowPanelCollapse = function() {
    var panel = getEl('flowPanel');
    if (!panel) return;
    panel.classList.toggle('collapsed');
};

/** 所有任务终态后自动关闭面板 */
window._autoDismissIfAllDone = function() {
    if (!window._agentPlan || !window._agentPlan.tasks) return;
    if (window._agentPlan.tasks.length === 0) return;

    var allTerminal = window._agentPlan.tasks.every(function(t) {
        return t.status === 'completed' || t.status === 'failed' || t.status === 'skipped';
    });

    if (allTerminal && window._agentPlan.status === 'running') {
        console.log('[FlowPanel] 所有任务已完成，2秒后自动关闭');
        setTimeout(function() {
            if (window._agentPlan && window._agentPlan.status === 'running') {
                // 再次检查（可能已被手动关闭）
                var stillAllDone = window._agentPlan.tasks.every(function(t) {
                    return t.status === 'completed' || t.status === 'failed' || t.status === 'skipped';
                });
                if (stillAllDone) {
                    window._agentPlan.status = 'completed';
                    window.dismissFlowPanel();
                }
            }
        }, 2000);
    }
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
    // 立即更新 UI
    window._renderAgentList(window._agentListCache || {}, getEl('agentSubList'));
    window._renderAgentList(window._agentListCache || {}, getEl('engineAgentList'));
    // 异步删除 (不阻塞 UI)
    var token = getAuthToken();
    if (!token) return;
    fetch(_apiBase + '?action=agent_delete&name=' + encodeURIComponent(name) + '&auth_token=' + token, { signal: AbortSignal.timeout(900000) })
        .then(function() {
            return fetch(_apiBase + '?action=agent_notifications_mark&auth_token=' + token, { signal: AbortSignal.timeout(900000) });
        })
        .then(function() { window._refreshAllAgentLists(); })
        .catch(function(e) { console.warn('[deleteAgent] 异步清理失败:', e.message); });
};

/**
 * 清理所有子代理
 */
window.clearAllAgents = async function() {
    var confirmed = await showConfirmDialog('清理所有子代理', '确定要删除所有子代理吗?\n\n此操作不可撤销,同时会删除所有子代理的聊天记录。', '全部删除');
    if (!confirmed) return;
    try {
        var r = await fetchWithRetry('/oneapichat/api/engine_api.php?action=agent_list&auth_token=' + getAuthToken());
        var agents = await r.json();
        var names = Object.keys(agents);
        var deleted = 0;
        for (var i = 0; i < names.length; i++) {
            try {
                await fetchWithRetry('/oneapichat/api/engine_api.php?action=agent_delete&auth_token=' + getAuthToken() + '&name=' + encodeURIComponent(names[i]));
                var key = 'agent_chat_' + names[i];
                localStorage.removeItem(key);
                deleted++;
            } catch(e) {
                console.warn('[clearAllAgents] 删除失败:', names[i], e.message);
            }
        }
        window.refreshEngineStatus();
        window._refreshAllAgentLists();
        alert('已清理 ' + deleted + ' 个子代理');
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
    if (!dot || !text) return;

    dot.className = 'engine-status-dot offline';
    text.textContent = '检查中...';

    try {
        var resp = await fetch(_apiBase + '?action=health&auth_token=' + getAuthToken(), { signal: AbortSignal.timeout(900000) });
        var data = await resp.json();

        if (data.ok || data.status === 'ok' || data.status === 'running') {
            dot.className = 'engine-status-dot online';
            text.textContent = '🟢 引擎在线';
        } else {
            dot.className = 'engine-status-dot offline';
            text.textContent = '🔴 引擎异常: ' + (data.message || '未知');
        }
    } catch(e) {
        dot.className = 'engine-status-dot offline';
        text.textContent = '🔴 引擎离线 (' + e.message + ')';
    }

    // 加载 cron 列表
    var cronList = getEl('engineCronList');
    if (cronList) {
        try {
            var cronResp = await fetch(_apiBase + '?action=cron_list&auth_token=' + getAuthToken(), { signal: AbortSignal.timeout(900000) });
            var cronData = await cronResp.json();
            // 引擎返回 {job_name: {...}} 格式,转换为数组
            var cronJobs = Object.keys(cronData).map(function(k) { return cronData[k]; });
            var runningJobs = cronJobs.filter(function(j) { return j.enabled; });
            if (runningJobs.length > 0) {
                cronList.innerHTML = runningJobs.map(function(j) {
                    var next = j.next_run ? new Date(j.next_run * 1000).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '--';
                    var name = escapeHtml(j.name);
                    return '<div class="engine-status-item" style="display:flex;align-items:center;justify-content:space-between;"><div><span class="engine-status-dot running"></span><span style="font-size:11px;">' + name + '<br><span style="color:#9ca3af;">下次 ' + next + ' · 每' + j.interval + 's</span></span></div>' +
                    '<button onclick="deleteCron(\'' + name + '\')" class="text-xs text-red-400 hover:text-red-600 transition px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20" title="删除">✕</button></div>';
                }).join('');
            } else {
                cronList.innerHTML = '<div style="font-size:11px;color:#9ca3af;padding:4px;">暂无活跃 cron 任务</div>';
            }
        } catch(e) {
            cronList.innerHTML = '<div style="font-size:11px;color:#9ca3af;padding:4px;">加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    }

    // 加载子代理列表(统一使用 _renderAgentList)
    var agentList = getEl('engineAgentList');
    if (agentList && Object.keys(window._agentListCache || {}).length > 0) {
        window._renderAgentList(window._agentListCache, agentList);
    } else if (agentList) {
        try {
            var agentResp = await fetch(_apiBase + '?action=agent_list&auth_token=' + getAuthToken(), { signal: AbortSignal.timeout(900000) });
            var agentData = await agentResp.json();
            window._agentListCache = agentData;
            window._renderAgentList(agentData, agentList);
        } catch(e) {
            agentList.innerHTML = '<div style="font-size:11px;color:#9ca3af;padding:4px;">加载失败: ' + escapeHtml(e.message) + '</div>';
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


