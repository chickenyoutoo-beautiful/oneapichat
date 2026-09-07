const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api-messages.js'), 'utf8');

function createEnv(chats) {
    const context = {
        console,
        getVal: (k) => '',
        getChecked: (k) => false,
        pendingFiles: [],
        window: {},
        localStorage: { getItem: () => null, setItem: () => {} },
        DEFAULT_CONFIG: { system: 'system prompt' },
        cleanObjectObject: (s) => s || '',
        buildUserContent: (text, files) => text,
        modelContextLength: {},
        modelMaxOutputTokens: {},
        _getModelCfg: () => ({ getSafetyMargin: () => 100, getContextWindow: () => 100000, getMaxOutputTokens: () => 4000 }),
        chats: chats || {}
    };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'api-messages.js' });
    return context;
}

// 场景 1: 纯工具调用（assistant content 为空/null），紧随 tool 消息
{
    const chats = {
        chat_1: {
            messages: [
                { role: 'user', text: '查询天气' },
                { role: 'assistant', content: '', tool_calls: [{ id: 'tc_weather', type: 'function', function: { name: 'web_search', arguments: '{"q":"weather"}' } }] },
                { role: 'tool', tool_call_id: 'tc_weather', content: '晴天，气温25度' }
            ]
        }
    };
    const ctx = createEnv(chats);
    const msgs = ctx.buildApiMessages('chat_1');
    const roles = Array.from(msgs, m => m.role);
    assert.deepStrictEqual(roles, ['system', 'user', 'assistant', 'tool'], '必须完整保留 system, user, assistant, tool 轮次');
    const asstMsg = msgs[2];
    assert.strictEqual(asstMsg.content, null, 'assistant content 必须规范为 null');
    assert.strictEqual(asstMsg.tool_calls.length, 1, 'assistant tool_calls 必须保留');
    assert.strictEqual(asstMsg.tool_calls[0].id, 'tc_weather');
    const toolMsg = msgs[3];
    assert.strictEqual(toolMsg.tool_call_id, 'tc_weather');
    assert.strictEqual(toolMsg.content, '晴天，气温25度', '工具结果必须完整可见');
}

// 场景 2: 工具结果为空字符串，必须兜底为 '(empty)'，绝不能跳过
{
    const chats = {
        chat_2: {
            messages: [
                { role: 'user', text: '执行空输出工具' },
                { role: 'assistant', content: '', tool_calls: [{ id: 'tc_empty', type: 'function', function: { name: 'exec', arguments: '{}' } }] },
                { role: 'tool', tool_call_id: 'tc_empty', content: '' }
            ]
        }
    };
    const ctx = createEnv(chats);
    const msgs = ctx.buildApiMessages('chat_2');
    const roles = Array.from(msgs, m => m.role);
    assert.deepStrictEqual(roles, ['system', 'user', 'assistant', 'tool'], '空输出工具轮次不能被跳过');
    assert.strictEqual(msgs[3].content, '(empty)', '空输出工具必须兜底为 (empty)');
    assert.strictEqual(msgs[2].tool_calls.length, 1);
}

// 场景 3: 多轮连续工具调用
{
    const chats = {
        chat_3: {
            messages: [
                { role: 'user', text: '第一步' },
                { role: 'assistant', content: '我先查一下', tool_calls: [{ id: 'tc_step1', type: 'function', function: { name: 'search', arguments: '{}' } }] },
                { role: 'tool', tool_call_id: 'tc_step1', content: '第一步结果' },
                { role: 'assistant', content: '', tool_calls: [{ id: 'tc_step2', type: 'function', function: { name: 'detail', arguments: '{}' } }] },
                { role: 'tool', tool_call_id: 'tc_step2', content: '第二步结果' }
            ]
        }
    };
    const ctx = createEnv(chats);
    const msgs = ctx.buildApiMessages('chat_3');
    const roles = Array.from(msgs, m => m.role);
    assert.deepStrictEqual(roles, ['system', 'user', 'assistant', 'tool', 'assistant', 'tool'], '多轮连续工具调用必须完整保留');
    assert.strictEqual(msgs[3].content, '第一步结果');
    assert.strictEqual(msgs[4].content, null);
    assert.strictEqual(msgs[5].content, '第二步结果');
}

console.log('tool_output_visibility.test.js: all assertions passed');
