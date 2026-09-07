const assert = require('assert');
const fs = require('fs');

const queueJs = fs.readFileSync('public/js/queue.js', 'utf8');
const dialogsJs = fs.readFileSync('public/js/dialogs.js', 'utf8');
const agentNotifyJs = fs.readFileSync('public/js/agent-notify.js', 'utf8');
const storageJs = fs.readFileSync('public/js/storage.js', 'utf8');
const initJs = fs.readFileSync('public/js/init.js', 'utf8');
const mainJs = fs.readFileSync('public/js/main.js', 'utf8');

console.log('Running stale_cache_and_queue_pollution tests...');

// 1. 验证 queue.js 中的 TTL、userId、chatId 防护
assert(queueJs.includes('savedAt: Date.now()'), 'queue.js must store savedAt timestamp');
assert(queueJs.includes('userId: currentUid'), 'queue.js must store userId');
assert(queueJs.includes('now - item.savedAt > 30000'), 'queue.js _loadQueue must expire items older than 30s');
assert(queueJs.includes('item.chatId && targetCid && item.chatId !== targetCid'), 'queue.js _loadQueue must guard cross-chat mismatch');
assert(queueJs.includes('item.userId && currentUid && item.userId !== currentUid'), 'queue.js _loadQueue must guard cross-user mismatch');

// 2. 验证 queue.js _drainQueue 严防跨会话串消息
assert(queueJs.includes('item.chatId && item.chatId !== currentChatId'), 'queue.js _drainQueue must guard against sending to wrong chat');
assert(!queueJs.includes('var _prevChatId = currentChatId;'), 'queue.js _drainQueue must not hijack currentChatId');

// 3. 验证 dialogs.js 会话切换时不自动排干发送旧队列
assert(!dialogsJs.includes('if (_restored && !isTypingMap[currentChatId]) {'), 'dialogs.js must not auto-drain on loadChat');
assert(dialogsJs.includes('window._saveQueue(undefined, _oldChatId)'), 'dialogs.js must save old queue with explicit old chat ID');

// 4. 验证 agent-notify.js 彻底根除空会话篡改夺舍
assert(!agentNotifyJs.includes('_isCurEmpty && cid !== currentChatId'), 'agent-notify.js must not hijack empty draft currentChatId');

// 5. 验证 init.js 和 storage.js 对输入框草稿的会话/用户隔离与冷启动脏缓存清理
assert(initJs.includes('_purgeStaleTransientStorage'), 'init.js must purge stale transient storage on init');
assert(initJs.includes('chatId: currentChatId'), 'init.js beforeunload must bind chatId to saved input text');
assert(storageJs.includes('_savedObj.chatId === currentChatId'), 'storage.js must verify chatId for saved input text');

// 6. 验证 main.js finally 块排干守卫
assert(mainJs.includes('currentChatId === chatId'), 'main.js finally must guard drainQueue with currentChatId === chatId');

console.log('stale_cache_and_queue_pollution.test.js: All assertions passed successfully!');
