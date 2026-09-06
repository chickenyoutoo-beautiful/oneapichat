const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const dialogsSrc = fs.readFileSync('public/js/dialogs.js', 'utf8');
const storageSrc = fs.readFileSync('public/js/storage.js', 'utf8');

// 1. 静态断言
assert(dialogsSrc.includes('chat._localIndex || chat._indexOnly'), 'Must recognize index mode as meaningful content');
assert(storageSrc.includes('清除有效会话的误打删除墓碑'), 'storage.js must sanitize false tombstones');

// 2. 沙箱逻辑测试
const sandbox = {
    console,
    JSON,
    Date,
    chats: {},
    currentChatId: null,
    isAgentChat: (id) => typeof id === 'string' && (id === '_agent_main' || id.startsWith('_agent_old_')),
    isTypingMap: {},
    slimSaveChats: () => {},
    localStorage: {
        _store: {},
        getItem(k) { return this._store[k] || null; },
        setItem(k, v) { this._store[k] = String(v); },
        removeItem(k) { delete this._store[k]; }
    }
};
vm.createContext(sandbox);

// 提取并运行相关函数
const helpers = `
${dialogsSrc.slice(dialogsSrc.indexOf('function _hasMeaningfulChatContent'), dialogsSrc.indexOf('async function autoGenerateTitle'))}
`;
vm.runInContext(helpers, sandbox);

// 测试用例 A: 索引模式会话必须被识别为有意义内容，且绝不能判定为草稿
const indexChat = {
    title: '用户真实会话',
    userId: 'u1',
    updated_at: Date.now(),
    msgCount: 3,
    messages: [],
    _localIndex: true
};
sandbox.chats['chat_index_1'] = indexChat;
assert.strictEqual(sandbox._hasMeaningfulChatContent(indexChat), true, 'Index chat must have meaningful content');
assert.strictEqual(sandbox._isEmptyDraftChat('chat_index_1'), false, 'Index chat must not be empty draft');

// 测试用例 B: 带有 timestamp 属性的普通用户/助手消息必须被正确识别
const timestampChat = {
    title: '普通会话',
    userId: 'u1',
    updated_at: Date.now(),
    messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', text: '你好', timestamp: 1724500000000 },
        { role: 'assistant', content: '你好！有什么我可以帮你的？', timestamp: 1724500005000 }
    ]
};
sandbox.chats['chat_normal_1'] = timestampChat;
assert.strictEqual(sandbox._hasMeaningfulChatContent(timestampChat), true, 'Chat with timestamped messages must have meaningful content');
assert.strictEqual(sandbox._isEmptyDraftChat('chat_normal_1'), false, 'Chat with timestamped messages must not be empty draft');

// 测试用例 C: 真实空草稿会被识别，但清理时不碰服务器删除
const emptyDraft1 = {
    title: '新对话',
    userId: 'u1',
    updated_at: 1000,
    messages: [{ role: 'system', content: 'You are helpful' }]
};
const emptyDraft2 = {
    title: '新对话',
    userId: 'u1',
    updated_at: 2000,
    messages: [{ role: 'system', content: 'You are helpful' }]
};
sandbox.chats['chat_empty_1'] = emptyDraft1;
sandbox.chats['chat_empty_2'] = emptyDraft2;
sandbox.currentChatId = 'chat_empty_2';

assert.strictEqual(sandbox._isEmptyDraftChat('chat_empty_1'), true, 'Old unselected empty draft is draft');
// currentChatId 保护
assert.strictEqual(sandbox._isEmptyDraftChat('chat_empty_2'), false, 'Current active chat is protected from draft pruning');

sandbox.currentChatId = 'chat_normal_1';
const keepId = sandbox._pruneEmptyDraftChats();
assert.strictEqual(keepId, 'chat_empty_2', 'Keep newest draft');
assert.strictEqual(sandbox.chats['chat_empty_1'], undefined, 'Old empty draft pruned locally');
assert.strictEqual(sandbox.chats['chat_empty_2'] !== undefined, true, 'Newest draft kept');
assert.strictEqual(sandbox.chats['chat_index_1'] !== undefined, true, 'Index chat preserved');
assert.strictEqual(sandbox.chats['chat_normal_1'] !== undefined, true, 'Normal chat preserved');

console.log('normal_chat_draft_persistence.test.js: all assertions passed!');
