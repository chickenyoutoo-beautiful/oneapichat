const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('public/js/core.js', 'utf8');
const marker = '// ★ 全局状态 — 多模块共享，必须在所有模块之前定义';
const start = src.indexOf(marker);
const end = src.indexOf('// ★ Agent 模式常量', start);
assert(start >= 0 && end > start, 'global chat state block must exist');
const block = src.slice(start, end);

const store = { chats: JSON.stringify({ c1: { messages: [] } }) };
const sandbox = {
  window: {},
  localStorage: {
    getItem(key) { return store[key] || null; },
    setItem(key, value) { store[key] = String(value); }
  }
};
vm.createContext(sandbox);
vm.runInContext(block + `
window.__beforeSame = window.chats === chats;
window.chats.c1.messages.push({ role: 'user', text: 'sync' });
window.__lexicalCount = chats.c1.messages.length;
chats = { c2: { messages: [{ role: 'assistant', content: 'ok' }] } };
window.__replacementSeen = !!window.chats.c2 && window.chats.c2.messages.length === 1;
window.chats = { c3: { messages: [] } };
window.__setterSeen = !!chats.c3;
`, sandbox);

assert.strictEqual(sandbox.window.__beforeSame, true, 'window.chats must initially reference lexical chats');
assert.strictEqual(sandbox.window.__lexicalCount, 1, 'SSE writes through window.chats must reach lexical chats');
assert.strictEqual(sandbox.window.__replacementSeen, true, 'lexical chats replacement must be visible through window.chats');
assert.strictEqual(sandbox.window.__setterSeen, true, 'window.chats assignment must replace lexical chats');
console.log('multidevice_chat_store_binding.test.js: all assertions passed');
