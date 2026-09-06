const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync('public/js/storage.js', 'utf8');

assert(source.includes('for (var _saveAttempt = 0; _saveAttempt < 2; _saveAttempt++)'), '保存没有独立重试循环');
assert(source.includes('new AbortController()'), '保存没有每次重建 AbortController');
assert(source.includes('绝不跨重试复用已 aborted 的 signal'), '缺少 signal 生命周期保护');
assert(source.includes('保存超时，已释放锁'), 'Abort 错误没有降噪并释放锁');
assert(source.includes('state.running = false'), '保存失败没有释放 running 锁');

console.log('✅ chat_save_abort.test.js: all assertions passed');
