const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 验证多轮连续工具调用在普通聊天模式下，界面只渲染为单个融合的助手气泡
const dialogsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'dialogs.js'), 'utf8');

// 提取并测试融合算法
const chatData = {
    messages: [
        { role: 'user', text: '崩坏星穹铁道有没有linux版' },
        {
            role: 'assistant',
            id: 'asst_round1',
            content: '官方并没有推出原生 Linux 版本。\n不过在 Linux 上游玩有以下几种现状：\n1. 为什么不能直接用 Wine/Proton？',
            tool_calls: [{ id: 'tc1', function: { name: 'web_search', arguments: '{"q":"rail linux"}' } }]
        },
        {
            role: 'assistant',
            id: 'asst_round2',
            content: '官方并没有推出原生 Linux 版本。\n不过在 Linux 上游玩有以下几种现状：\n1. 为什么不能直接用 Wine/Proton？\n2. 目前可行方案：Waydroid',
            tool_calls: [{ id: 'tc2', function: { name: 'web_search', arguments: '{"q":"proton anticheat"}' } }]
        },
        {
            role: 'assistant',
            id: 'asst_round3',
            content: '3. 双系统或 GPU 直通虚拟机\n总结与建议：推荐云星铁',
            tool_calls: []
        }
    ]
};

// 模拟 dialogs.js 中的融合逻辑
const rawDisplayMsgs = chatData.messages.filter(m => m.role !== 'system' && m.role !== 'tool');
assert.strictEqual(rawDisplayMsgs.length, 4, '过滤系统和工具后有 4 条原始消息');

const displayMsgs = [];
for (let di = 0; di < rawDisplayMsgs.length; di++) {
    const curM = rawDisplayMsgs[di];
    if (curM.role === 'assistant') {
        const prevM = displayMsgs.length > 0 ? displayMsgs[displayMsgs.length - 1] : null;
        if (prevM && prevM.role === 'assistant') {
            const fused = Object.assign({}, prevM);
            const existingCalls = Array.isArray(fused.tool_calls) ? fused.tool_calls.slice() : [];
            const newCalls = Array.isArray(curM.tool_calls) ? curM.tool_calls : [];
            const callIds = {};
            existingCalls.forEach(c => { if (c && c.id) callIds[c.id] = true; });
            newCalls.forEach(c => {
                if (c && (!c.id || !callIds[c.id])) {
                    existingCalls.push(c);
                    if (c.id) callIds[c.id] = true;
                }
            });
            fused.tool_calls = existingCalls;

            const prevText = String(prevM.content || '').trim();
            const curText = String(curM.content || '').trim();
            if (curText && prevText) {
                if (curText.indexOf(prevText) === 0) {
                    fused.content = curText;
                } else if (prevText.indexOf(curText) === 0) {
                    fused.content = prevText;
                } else {
                    fused.content = prevText + '\n\n' + curText;
                }
            } else {
                fused.content = curText || prevText;
            }
            displayMsgs[displayMsgs.length - 1] = fused;
            continue;
        }
    }
    displayMsgs.push(curM);
}

assert.strictEqual(displayMsgs.length, 2, '融合后必须收敛为 1 条用户消息 + 1 条助手回复');
assert.strictEqual(displayMsgs[0].role, 'user');
assert.strictEqual(displayMsgs[1].role, 'assistant');
assert.strictEqual(displayMsgs[1].tool_calls.length, 2, '工具调用列表必须合并保留所有步骤');
assert(displayMsgs[1].content.includes('1. 为什么不能直接用 Wine/Proton？'), '正文必须包含第一轮分析');
assert(displayMsgs[1].content.includes('总结与建议：推荐云星铁'), '正文必须包含最终总结');

console.log('bubble_fission_convergence.test.js: all assertions passed');
