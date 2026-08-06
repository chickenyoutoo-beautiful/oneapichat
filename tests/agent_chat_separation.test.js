// ★ Agent 会话与普通聊天严格分隔回归测试 (2026-08-03)
//   覆盖: isAgentChat 判定 / 历史列表过滤 / lastChatId 恢复路由 / /new 归档决策 /
//         _triggerMainAgentForTask 跨域切换决策 / _pendingAgentReply 消费路由 /
//         _doTrigger 兜底绑定 / 清除循环豁免 / cleanupOldChats 豁免
//   模式: 与既有 tests/*.test.js 一致 — 从真实源文件提取代码块, vm 沙箱 + stub 断言
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public', 'js');

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

// 从 start 起做花括号配平, 返回从 start 到匹配闭合大括号的子串(含)
function braceMatch(src, start, open = '{', close = '}') {
    let depth = 0;
    for (let i = start; i < src.length; i++) {
        if (src[i] === open) depth++;
        else if (src[i] === close) {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error('braceMatch: 未找到闭合 ' + close + ' (start=' + start + ')');
}

function extractBetween(src, startMarker, endMarker) {
    const s = src.indexOf(startMarker);
    assert(s !== -1, '未找到起点: ' + startMarker);
    const e = src.indexOf(endMarker, s + startMarker.length);
    assert(e !== -1, '未找到终点: ' + endMarker);
    return src.slice(s, e);
}

function runVM(code, globals) {
    const ctx = Object.assign({ console, JSON, Date, setTimeout: fn => fn() }, globals || {});
    ctx.window = ctx;
    require('vm').createContext(ctx);
    require('vm').runInContext(code, ctx, { filename: 'test-agent-chat-separation.js' });
    return ctx;
}

// ═══════════════════ 1. isAgentChat (core.js 真实源码) ═══════════════════
(function testIsAgentChat() {
    const src = read('core.js');
    const s = src.indexOf('window.isAgentChat = function');
    assert(s !== -1, 'core.js 找不到 isAgentChat 定义');
    const stmt = src.slice(s, src.indexOf('};', s) + 2);
    const ctx = runVM('var AGENT_CHAT_ID = "_agent_main";\n' + stmt, {});
    const isAgentChat = ctx.window.isAgentChat;
    assert.strictEqual(isAgentChat('_agent_main'), true, '_agent_main 属于 Agent 域');
    assert.strictEqual(isAgentChat('_agent_old_1785750000000'), true, '_agent_old_* 归档属于 Agent 域');
    assert.strictEqual(isAgentChat('chat_1785750000000'), false, 'chat_* 普通聊天不属于 Agent 域');
    assert.strictEqual(isAgentChat('chat_1785750000000_abc'), false, '带随机后缀的普通聊天不属于 Agent 域');
    assert.strictEqual(isAgentChat(null), false, 'null 安全');
    assert.strictEqual(isAgentChat(undefined), false, 'undefined 安全');
    assert.strictEqual(isAgentChat('_agent_old'), false, '前缀不完整不算归档(需下划线)');
    console.log('✓ testIsAgentChat');
})();

// ═══════════════════ 2. renderChatHistory 过滤谓词 (dialogs.js 真实源码) ═══════════════════
(function testHistoryFilter() {
    const src = read('dialogs.js');
    const marker = 'var _chatIds = Object.keys(chats).filter(function(id) {';
    const s = src.indexOf(marker);
    assert(s !== -1, 'dialogs.js 找不到历史过滤块');
    // 从函数体起点配平到闭合 }, 再取其后紧跟的 ");" 完成整个 filter 表达式
    const bodyStart = src.indexOf('{', s);
    const bodyEnd = bodyStart + braceMatch(src, bodyStart).length - 1;  // 函数体闭合 } 的绝对下标
    const expr = src.slice(s + 'var _chatIds = '.length, src.indexOf(');', bodyEnd) + 2);
    const ids = ['_agent_main', '_agent_old_1785750000000', 'chat_1', 'chat_2', 'chat_3'];
    const chats = {
        '_agent_main': { userId: 'u1', updated_at: 5 },
        '_agent_old_1785750000000': { userId: 'u1', updated_at: 4 },
        'chat_1': { userId: 'u1', updated_at: 3 },
        'chat_2': { userId: 'u1', updated_at: 2 },
        'chat_3': { userId: 'u2', updated_at: 1 }  // 其他用户, 应被 userId 过滤
    };
    // 过滤表达式依赖: isAgentChat / _isAgentView / _uid / chats
    function runFilter(_isAgentView, _uid) {
        const ctx = runVM(
            'var _uid = ' + JSON.stringify(_uid) + ';\n' +
            'var _isAgentView = ' + JSON.stringify(_isAgentView) + ';\n' +
            'var result = ' + expr + ';\n' +
            'window.__result = result;',
            { chats, isAgentChat: id => id === '_agent_main' || (typeof id === 'string' && id.indexOf('_agent_old_') === 0) }
        );
        return ctx.window.__result;
    }
    assert.deepStrictEqual([...runFilter(true, 'u1')].sort(), ['_agent_main', '_agent_old_1785750000000'], 'Agent 视图只显示 Agent 域会话');
    assert.deepStrictEqual([...runFilter(false, 'u1')].sort(), ['chat_1', 'chat_2'], '普通视图只显示普通聊天');
    assert.deepStrictEqual([...runFilter(false, '')].sort(), ['chat_1', 'chat_2', 'chat_3'].sort(), '未登录用户不做 userId 过滤但做域过滤');
    console.log('✓ testHistoryFilter');
})();

// ═══════════════════ 3. lastChatId 恢复路由 (storage.js 真实源码) ═══════════════════
(function testLastChatIdRouting() {
    const src = read('storage.js');
    // 从「恢复上次打开的对话」注释到 if(lastId)/else 语句整体结束(配平), 不含外层 else 的闭合 }
    const _routeStart = src.indexOf('// 恢复上次打开的对话');
    const _ifStart = src.indexOf('if (lastId && chats[lastId])', _routeStart);
    const _ifStmt = braceMatch(src, _ifStart);
    const _ifEnd = _ifStart + _ifStmt.length;
    const _afterIf = src.slice(_ifEnd, _ifEnd + 30);
    const _elseStart = _afterIf.indexOf('else {');
    const _elseStmt = _elseStart !== -1 ? braceMatch(src, _ifEnd + _elseStart) : '';
    const block = src.slice(_routeStart, _ifStart) + _ifStmt + _elseStmt;
    const loaded = [];
    const created = [];
    function runRoute(agentView, lastChatId, lastNormalChatId, chatKeys, chats) {
        loaded.length = 0; created.length = 0;
        runVM(block, {
            chats,
            chatKeys,
            localStorage: {
                getItem: k => k === 'lastChatId' ? lastChatId : (k === 'lastNormalChatId' ? lastNormalChatId : null)
            },
            isAgentToolsActive: () => agentView,
            isAgentChat: id => id === '_agent_main' || (typeof id === 'string' && id.indexOf('_agent_old_') === 0),
            AGENT_CHAT_ID: '_agent_main',
            loadChat: id => loaded.push(id),
            createNewChat: () => created.push(1)
        });
        return { loaded: loaded.slice(), created: created.length };
    }
    const mkChats = () => ({
        '_agent_main': { updated_at: 10 },
        '_agent_old_9': { updated_at: 9 },
        'chat_1': { updated_at: 8 },
        'chat_2': { updated_at: 7 }
    });
    // 普通视图 + lastId 是 Agent 主会话 → 回到 lastNormalChatId
    assert.deepStrictEqual(runRoute(false, '_agent_main', 'chat_1', Object.keys(mkChats()), mkChats()).loaded, ['chat_1'], 'off+_agent_main → lastNormalChatId');
    // 普通视图 + lastId 是归档会话 → 同样回到 lastNormalChatId(旧逻辑漏了归档)
    assert.deepStrictEqual(runRoute(false, '_agent_old_9', 'chat_2', Object.keys(mkChats()), mkChats()).loaded, ['chat_2'], 'off+_agent_old_* → lastNormalChatId');
    // 普通视图 + lastId 普通聊天 → 原样恢复
    assert.deepStrictEqual(runRoute(false, 'chat_1', null, Object.keys(mkChats()), mkChats()).loaded, ['chat_1'], 'off+chat_* → 原样');
    // Agent 视图 + lastId 普通聊天 → 回到 Agent 主会话
    assert.deepStrictEqual(runRoute(true, 'chat_1', null, Object.keys(mkChats()), mkChats()).loaded, ['_agent_main'], 'agent视图+chat_* → _agent_main');
    // Agent 视图 + lastId 归档会话 → 原样恢复(Agent 域)
    assert.deepStrictEqual(runRoute(true, '_agent_old_9', null, Object.keys(mkChats()), mkChats()).loaded, ['_agent_old_9'], 'agent视图+_agent_old_* → 原样');
    // 普通视图 + lastId 无效 → fallback 只从普通域选最新(绝不选 Agent 会话)
    assert.deepStrictEqual(runRoute(false, null, null, Object.keys(mkChats()), mkChats()).loaded, ['chat_1'], 'off fallback → 普通域最新');
    // Agent 视图 + lastId 无效 → fallback 只从 Agent 域选最新
    assert.deepStrictEqual(runRoute(true, null, null, Object.keys(mkChats()), mkChats()).loaded, ['_agent_main'], 'agent视图 fallback → Agent 域最新');
    // 普通视图 + 只有 Agent 会话 → 新建普通聊天
    assert.strictEqual(runRoute(false, null, null, ['_agent_main', '_agent_old_9'], { '_agent_main': { updated_at: 10 }, '_agent_old_9': { updated_at: 9 } }).created, 1, 'off+只有Agent会话 → createNewChat');
    console.log('✓ testLastChatIdRouting');
})();

// ═══════════════════ 4. createNewChat 归档决策 (dialogs.js 真实源码) ═══════════════════
(function testCreateNewChatArchive() {
    const src = read('dialogs.js');
    const s = src.indexOf('window.createNewChat = function () {');
    assert(s !== -1, 'dialogs.js 找不到 createNewChat');
    const fnCode = braceMatch(src, s, '{');
    const calls = { archive: 0, newAgent: 0, newNormal: 0 };
    function runCreateNewChat(agentMode, currentChatId, agentMsgs) {
        calls.archive = calls.newAgent = calls.newNormal = 0;
        const chats = {};
        if (agentMsgs !== null) chats['_agent_main'] = { title: 'Agent 会话', userId: 'u1', updated_at: 1, messages: agentMsgs };
        chats['_agent_old_9'] = { title: '📦 旧', userId: 'u1', updated_at: 2, messages: [{ role: 'system', content: 'x' }] };
        runVM(fnCode + '\nwindow.createNewChat();', {
            chats,
            currentChatId,
            getAgentMode: () => agentMode,
            getVal: () => '',
            DEFAULT_CONFIG: { agentSystemPrompt: 'sys', system: 'sys' },
            _deletedChatIds: {},
            localStorage: { getItem: () => null, setItem: () => {} },
            showToast: () => { calls.archive++; },
            saveChats: () => {},
            loadChat: id => { if (id === '_agent_main') calls.newAgent++; },
            renderChatHistory: () => {},
            updateHeaderTitle: () => {},
            isAgentChat: id => id === '_agent_main' || (typeof id === 'string' && id.indexOf('_agent_old_') === 0)
        });
        // 归档后旧 _agent_main 被删除且新 _agent_main 是纯 system 单消息 → 判定归档发生
        if (!chats['_agent_main'] || chats['_agent_main'].messages.length === 1) {
            if (calls.archive > 0 || agentMsgs === null) calls.archive = calls.archive; // toast 已计数
        }
        // 用 chats 状态直接判断: 归档发生时旧消息消失且产生 _agent_old_* 新条目
        const archivedCount = Object.keys(chats).filter(k => k.indexOf('_agent_old_') === 0).length;
        return {
            toast: calls.archive,
            archivedCount,
            mainMsgs: (chats['_agent_main'] || {}).messages ? chats['_agent_main'].messages.length : 0
        };
    }
    const fullAgent = [
        { role: 'system', content: 'sys' },
        { role: 'user', text: '帮我查一下' },
        { role: 'assistant', content: '好的' }
    ];
    // ★ 核心回归: Agent 模式下当前聊天是归档会话(非 _agent_main) → 旧逻辑不归档直接覆盖, 新逻辑必须归档
    let r = runCreateNewChat('agent', '_agent_old_9', fullAgent);
    assert.strictEqual(r.archivedCount, 2, 'Agent模式+其他聊天+有内容 → 归档(产生新 _agent_old_*)');
    assert.strictEqual(r.mainMsgs, 1, '归档后新 _agent_main 只有 system');
    // Agent 模式 + 当前即 _agent_main + 有内容 → 归档
    r = runCreateNewChat('agent', '_agent_main', fullAgent);
    assert.strictEqual(r.archivedCount, 2, 'Agent模式+当前主会话+有内容 → 归档');
    // Agent 模式 + 主会话只有 system(无实质对话) → 不归档
    r = runCreateNewChat('agent', '_agent_main', [{ role: 'system', content: 'sys' }]);
    assert.strictEqual(r.archivedCount, 1, 'Agent模式+无实质对话 → 不归档');
    // 普通模式 → 永不归档(只有 fixture 里的 _agent_old_9, 不新增)
    r = runCreateNewChat('off', 'chat_1', fullAgent);
    assert.strictEqual(r.archivedCount, 1, '普通模式 → 不归档');
    console.log('✓ testCreateNewChatArchive');
})();

// ═══════════════════ 5. _triggerMainAgentForTask 跨域切换决策 (agent.js 真实源码) ═══════════════════
(function testTaskSwitchDecision() {
    const src = read('agent.js');
    const s = src.indexOf('var _canSwitch = (typeof isAgentToolsActive === \'function\') ? (isAgentToolsActive() === isAgentChat(chatId)) : true;');
    assert(s !== -1, 'agent.js 找不到 _canSwitch 决策行');
    const stmt = src.slice(src.lastIndexOf('\n', s) + 1, src.indexOf('\n', s));
    const results = [];
    function runDecision(agentActive, chatId) {
        const ctx = runVM('var chatId = ' + JSON.stringify(chatId) + ';\n' + stmt + '\nwindow.__r = _canSwitch;', {
            isAgentToolsActive: () => agentActive,
            isAgentChat: id => id === '_agent_main' || (typeof id === 'string' && id.indexOf('_agent_old_') === 0)
        });
        results.push(ctx.window.__r);
    }
    // Agent 视图 + Agent 域任务 → 可切换
    runDecision(true, '_agent_main'); runDecision(true, '_agent_old_9');
    // Agent 视图 + 普通聊天任务 → 不可切换(不拽回普通聊天)
    runDecision(true, 'chat_1');
    // off 视图(含 plan) + 普通聊天任务 → 可切换(plan 流程保持)
    runDecision(false, 'chat_1');
    // off 视图 + Agent 域任务 → 不可切换(不拽回 Agent 主会话)
    runDecision(false, '_agent_main'); runDecision(false, '_agent_old_9');
    assert.deepStrictEqual(results, [true, true, false, true, false, false], '跨域切换决策矩阵');
    console.log('✓ testTaskSwitchDecision');
})();

// ═══════════════════ 6. _pendingAgentReply 消费路由 (main.js 真实源码) ═══════════════════
(function testPendingAgentReplyRouting() {
    const src = read('main.js');
    const marker = 'if (window._pendingAgentReply && !userAbortMap[chatId]) {';
    const s = src.indexOf(marker);
    assert(s !== -1, 'main.js 找不到 _pendingAgentReply 消费块');
    const block = braceMatch(src, s);
    const calls = { send: [], load: [] };
    function runConsume(intended, current, agentActive, chatsHas) {
        calls.send.length = 0; calls.load.length = 0;
        const ctx = runVM(
            'var chatId = ' + JSON.stringify(current) + ';\n' +
            'window._pendingAgentReply = true;\n' +
            'window._pendingAgentReplyChatId = ' + JSON.stringify(intended) + ';\n' +
            'var userAbortMap = {};\n' +
            'window.sendMessage = sendMessage;\n' +
            'window.loadChat = loadChat;\n' +
            block + '\n' +
            'window.__state = { flag: window._pendingAgentReply, chat: window._pendingAgentReplyChatId };',
            {
                sendMessage: (skip, msg) => calls.send.push(msg),
                loadChat: id => { calls.load.push(id); return { then: cb => cb() }; },  // 同步 thenable, 避免微任务时序
                currentChatId: current,
                isTypingMap: {},
                console,
                setTimeout: fn => fn(),
                chats: chatsHas ? { [intended]: { messages: [] } } : {},
                isAgentToolsActive: () => agentActive,
                isAgentChat: id => id === '_agent_main' || (typeof id === 'string' && id.indexOf('_agent_old_') === 0)
            }
        );
        return { send: calls.send.slice(), load: calls.load.slice(), flag: ctx.window.__state.flag };
    }
    // 意图聊天 = 当前聊天 → 直接发送
    let r = runConsume('_agent_main', '_agent_main', true, true);
    assert.strictEqual(r.send.length, 1, '意图=当前 → 发送');
    assert.strictEqual(r.send[0], '请整合子代理结果并告知用户进展');
    // 意图聊天 ≠ 当前, 且同域(都在 Agent 域) → 切回后发送
    r = runConsume('_agent_main', 'chat_1', true, true);
    assert.deepStrictEqual(r.load, ['_agent_main'], '跨聊天但同域 → 切回目标聊天');
    assert.strictEqual(r.send.length, 1, '切回后发送');
    // 意图聊天 ≠ 当前, 且同域(都在普通域) → 切回后发送
    r = runConsume('chat_2', 'chat_1', false, true);
    assert.deepStrictEqual(r.load, ['chat_2'], '普通域跨聊天 → 切回目标聊天');
    assert.strictEqual(r.send.length, 1, '切回后发送');
    // ★ 核心回归: 意图 = Agent 主会话, 但当前是普通视图(用户已退出 Agent 模式) → 跳过, 不污染当前聊天
    r = runConsume('_agent_main', 'chat_1', false, true);
    assert.strictEqual(r.send.length, 0, '跨域(Agent意图+off视图) → 跳过发送');
    assert.strictEqual(r.load.length, 0, '跨域 → 不切换');
    // 标志被消费后清除
    assert.strictEqual(r.flag, false, '消费后清除 _pendingAgentReply');
    console.log('✓ testPendingAgentReplyRouting');
})();

// ═══════════════════ 7. _doTrigger 兜底绑定 (agent.js 真实源码) ═══════════════════
(function testDoTriggerBinding() {
    const src = read('agent.js');
    const block = extractBetween(src,
        '// ★ 严格分隔: Agent 视图绑当前聊天(Agent 域); off 模式仅临时授权流程绑回当前聊天,',
        'var taskId = window.createTask(\'[系统] 子代理 \' + agentName + \' 完成\', _triggerChatId);');
    // block 以换行/缩进开头, extractBetween 不含 endMarker(createTask 行), 需补上
    const code = 'var agentName = \'test_agent\';\n' +
        'window.createTask = createTask;\nwindow._tempAgentGranted = _tempAgentGranted;\nwindow._tempAgentChatId = _tempAgentChatId;\n' +
        block +
        'var taskId = window.createTask(\'[系统] 子代理 \' + agentName + \' 完成\', _triggerChatId);\nwindow.__target = _triggerChatId;';
    const targets = [];
    function runDoTrigger(agentActive, currentChatId, tempGranted, tempChatId) {
        targets.push(runVM(code, {
            currentChatId,
            _tempAgentGranted: tempGranted,
            _tempAgentChatId: tempChatId,
            createTask: () => 'task_1',
            isAgentToolsActive: () => agentActive,
            AGENT_CHAT_ID: '_agent_main'
        }).window.__target);
    }
    // Agent 视图 → 绑当前聊天(Agent 域)
    runDoTrigger(true, '_agent_main', false, null);
    // off + 临时授权匹配当前 → 绑当前聊天(临时授权流程保活)
    runDoTrigger(false, 'chat_1', true, 'chat_1');
    // ★ 核心回归: off + 无临时授权 → 绑 _agent_main, 不注入当前普通聊天
    runDoTrigger(false, 'chat_1', false, null);
    // off + 临时授权但授权聊天 ≠ 当前 → 绑 _agent_main
    runDoTrigger(false, 'chat_2', true, 'chat_1');
    assert.deepStrictEqual(targets, ['_agent_main', 'chat_1', '_agent_main', '_agent_main'], '_doTrigger 兜底绑定矩阵');
    console.log('✓ testDoTriggerBinding');
})();

// ═══════════════════ 8. 清除/清理豁免 (源码断言) ═══════════════════
(function testPurgeExemptions() {
    const storageSrc = read('storage.js');
    assert(storageSrc.includes('if (isAgentChat(_lcid)) continue;'), 'storage.js 清除循环必须豁免 Agent 域聊天');
    const utilsSrc = read('utils.js');
    assert(utilsSrc.includes('Object.keys(chats).filter(id => !isAgentChat(id))'), 'utils.js cleanupOldChats 必须排除 Agent 域聊天');
    console.log('✓ testPurgeExemptions');
})();

// ═══════════════════ 9. 侧边栏手动展开三重解禁 (源码断言) ═══════════════════
// Agent 模式侧边栏点击无效的根因: ①CSS .agent-active #sidebarToggle pointer-events:none
// ②toggleSidebar 的 isAgentToolsActive() 提前 return ③updateAgentUI 每次调用强制再收起
(function testSidebarManualExpand() {
    const uiSrc = read('ui.js');
    assert(!uiSrc.includes('Agent 模式下侧边栏已折叠'), 'ui.js toggleSidebar 不得再禁止 Agent 模式展开');
    assert(uiSrc.includes('Agent 模式允许手动展开'), 'ui.js toggleSidebar 应允许 Agent 模式手动展开');
    const agentSrc = read('agent.js');
    assert(agentSrc.includes('_lastSidebarSyncMode'), 'agent.js updateAgentUI 应使用模式切换门控, 避免状态刷新覆盖手动展开');
    const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert(!cssSrc.includes('.agent-active #sidebarToggle'), 'style.css 不得再禁用 Agent 模式侧边栏按钮');
    console.log('✓ testSidebarManualExpand');
})();

// ═══════════════════ 10. 转场遮罩等待底层加载 (源码断言) ═══════════════════
// 启动/关闭 Agent 模式的遮罩原固定 900/650ms 自动消失, 底层 loadChat 是 async —
// 大会话渲染超时则遮罩先消失聊天后加载, 视觉割裂; 修复后遮罩等待加载完成再淡出
(function testTransitionOverlayWaitsForLoad() {
    const agentSrc = read('agent.js');
    assert(agentSrc.includes('function _dismissOverlayAfter'), 'agent.js 应定义 _dismissOverlayAfter 遮罩淡出辅助');
    assert(agentSrc.includes("_agentOverlayMap[mode] = { el: overlay, timer: null }"), '进入特效不得固定 900ms 自动淡出');
    assert(agentSrc.includes("_agentOverlayMap[exitKey] = { el: overlay, timer: null }"), '退出特效不得固定 650ms 自动淡出');
    assert(agentSrc.includes("_dismissOverlayAfter(mode, _enterLoad, 750, 1800)"), '进入 Agent 模式遮罩应等待 _enterLoad(loadChat) 完成且 1800ms 兜底防卡');
    assert(agentSrc.includes("_dismissOverlayAfter('exit:' + prevMode, _exitLoad, 500, 2000)"), '退出模式遮罩应等待恢复聊天 loadChat 完成');
    assert(agentSrc.includes('rgba(15,23,42,0.88)'), '退出遮罩应高不透明度, 防止透见未切换的 Agent 内容');
    assert(agentSrc.includes('}, 120);'), '退出应立刻(120ms)开始恢复聊天, 不再等 750ms');
    assert(agentSrc.includes("_dismissOverlayAfter('plan', null, 900, 2500)"), 'Plan 模式无聊天切换应按固定时间淡出');
    assert(agentSrc.includes('maxWait'), '_dismissOverlayAfter 应有兜底超时防遮罩永久滞留');
    const toolsSrc = read('tools-exec.js');
    assert(toolsSrc.includes("_dismissOverlayAfter('agent', null, 700, 1800)"), '临时授权动效调用点应驱动遮罩淡出(无自动计时器)');
    const notifySrc = read('agent-notify.js');
    assert(notifySrc.includes("localStorage.removeItem('_wsStreamId')"), 'WS 流结束必须清除 localStorage 残留(否则 loadChat 续接块误触发)');
    console.log('✓ testTransitionOverlayWaitsForLoad');
})();

console.log('\n✅ agent_chat_separation 全部通过');
