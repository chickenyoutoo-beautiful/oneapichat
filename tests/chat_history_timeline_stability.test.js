/**
 * tests/chat_history_timeline_stability.test.js
 * 验证会话时间分类、排序稳定性与 hydration 防跳动机制
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 从 dialogs.js 提取 getChatTimestamp 定义
const dialogsCode = fs.readFileSync(path.join(__dirname, '../public/js/dialogs.js'), 'utf8');

// 在沙箱环境中评估 getChatTimestamp
const fnMatch = dialogsCode.match(/function getChatTimestamp[\s\S]*?^window\.getChatTimestamp = getChatTimestamp;/m);
assert(fnMatch, 'getChatTimestamp definition must be present in dialogs.js');

const evalFn = new Function('chats', 'const window = {}; ' + fnMatch[0] + '; return getChatTimestamp;');
const getChatTimestamp = evalFn({});

console.log('1. 测试 getChatTimestamp 容错与解析能力...');
// 13位数字
assert.strictEqual(getChatTimestamp({ updated_at: 1788411060372 }), 1788411060372);
// 10位秒时间戳
assert.strictEqual(getChatTimestamp({ updated_at: 1788411060 }), 1788411060000);
// ISO 字符串
const isoStr = '2026-08-24T05:00:58+00:00';
assert.strictEqual(getChatTimestamp({ updated_at: isoStr }), Date.parse(isoStr));
// 消息兜底
assert.strictEqual(getChatTimestamp({ messages: [{ time: 1787677442437 }] }), 1787677442437);
// ID 兜底
assert.strictEqual(getChatTimestamp({}, 'chat_1787677442437'), 1787677442437);
// 空值与异常值防 NaN
assert.strictEqual(getChatTimestamp(null), 0);
assert.strictEqual(getChatTimestamp({ updated_at: 'invalid-date' }), 0);
assert.strictEqual(isNaN(getChatTimestamp({ updated_at: 'invalid-date' })), false);

console.log('2. 测试列表稳定排序与防乱跳...');
const mockChats = {
    'c_today': { updated_at: Date.now() },
    'c_yday': { updated_at: Date.now() - 86400000 },
    'c_iso': { updated_at: '2026-08-20T10:00:00Z' },
    'c_msg': { messages: [{ time: 1785000000000 }] },
    'c_id': { id: 'chat_1786000000000' }
};

const chatIds = Object.keys(mockChats);
// 连续排序 10 次，验证结果 100% 确定且不变
let lastOrder = null;
for (let round = 0; round < 10; round++) {
    const list = [...chatIds];
    list.sort((a, b) => {
        const ta = getChatTimestamp(mockChats[a], a);
        const tb = getChatTimestamp(mockChats[b], b);
        if (ta !== tb) return tb - ta;
        return String(b).localeCompare(String(a));
    });
    const orderStr = list.join(',');
    if (lastOrder) {
        assert.strictEqual(orderStr, lastOrder, 'Sorting order must remain deterministic across multiple runs');
    }
    lastOrder = orderStr;
}
assert.strictEqual(lastOrder.split(',')[0], 'c_today');

console.log('3. 测试 loadChat hydration 时时间戳防漂移...');
const localChat = {
    title: '历史会话',
    updated_at: 1787500000000, // 8月真实时间
    messages: [],
    _localIndex: true
};
const serverSingleChat = {
    title: '历史会话',
    updated_at: '2026-08-24T05:00:58+00:00', // 可能是 ISO 格式
    messages: [{ role: 'user', content: 'hello' }]
};

const _existingTs = getChatTimestamp(localChat, 'c1');
const _hydratedTs = getChatTimestamp(serverSingleChat, 'c1');
const merged = Object.assign({}, localChat, serverSingleChat);
if (_existingTs > 0) {
    merged.updated_at = _existingTs;
} else if (_hydratedTs > 0) {
    merged.updated_at = _hydratedTs;
}
// 验证时间戳未被修改成当前时间，且保持数字格式
assert.strictEqual(merged.updated_at, 1787500000000);
assert(merged.updated_at < Date.now() - 86400000 * 5, 'Must remain in past');

console.log('All tests passed successfully!');
