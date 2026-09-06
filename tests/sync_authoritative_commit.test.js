const assert = require('assert');
const fs = require('fs');

const main = fs.readFileSync('public/js/main.js', 'utf8');
const notify = fs.readFileSync('public/js/agent-notify.js', 'utf8');
const resume = fs.readFileSync('public/js/resume-stream.js', 'utf8');
const dialogs = fs.readFileSync('public/js/dialogs.js', 'utf8');
const core = fs.readFileSync('public/js/core.js', 'utf8');
const engine = fs.readFileSync('python/engine_server.py', 'utf8');
const php = fs.readFileSync('api/chat.php', 'utf8');

assert(main.includes('window._saveAndBroadcast(chatId);  // 锁定真正完成的后台会话'));
assert(main.includes("code: 'RS_TRANSPORT_DETACHED'"));
assert(main.includes('后端任务继续执行并将在重连后投影完成态'));
assert(!resume.includes("showToast('🔄 续接流式...'"));
assert(!resume.includes("showToast('连接短暂中断，正在自动续接…'"));
assert(resume.includes('只有这个显式用户动作标志允许向后端 DELETE'));
assert(resume.includes("_createPayload.client_source = window._sseSourceId || '';"));
assert(dialogs.includes('旧 WebSocket 网关已停用'));
assert(!dialogs.includes("while ((!window._wsClient || window._wsClient.readyState !== WebSocket.OPEN)"));
assert(core.includes("Object.defineProperty(window, 'currentChatId'"));
assert(notify.includes('function _mergeServerChatPreservingLive'));
assert(notify.includes('sync_blocked_older_revision'));
assert(notify.includes('_expectedRemoteRevision'));
assert(notify.includes('普通 404 只表示当前快照尚未出现/已迁移'));
assert(engine.includes('chat_projection_store.commit_assistant'));
assert(engine.includes('Commit-before-broadcast'));
assert(engine.includes("persisted_status = status if projection.get('ok') or not chat_id else 'recoverable'"));
assert(php.includes('function onechat_merge_chat_records'));
assert(php.includes('不再让 glob 字典序决定新旧版本谁覆盖谁'));

console.log('sync_authoritative_commit.test.js: all assertions passed');
