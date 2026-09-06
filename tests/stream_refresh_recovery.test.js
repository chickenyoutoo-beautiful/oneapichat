const assert = require('assert');
const fs = require('fs');

const dialogs = fs.readFileSync('public/js/dialogs.js', 'utf8');
const resume = fs.readFileSync('public/js/resume-stream.js', 'utf8');
const init = fs.readFileSync('public/js/init.js', 'utf8');
const main = fs.readFileSync('public/js/main.js', 'utf8');

assert(dialogs.includes("window.ResumeStream.peek(id)"));
assert(dialogs.includes("_resumeMsg = {"));
assert(dialogs.includes("_resumeMsg.partial = true;"));
assert(dialogs.includes("已从 ResumeStream 快照恢复生成中消息"));
assert(resume.includes("function _hydrateState(chatId)"));
assert(resume.includes("return !!(st && st.phase !== 'completed' && st.phase !== 'error')"));
assert(init.includes('time: Date.now(),'));
assert(main.includes("saveSingleChatToServer(chatId, false).catch(function() {});"));
assert(!main.includes("await saveChatsToServer(true);"), 'RS creation must not await low-priority full backup');

const peekAt = dialogs.indexOf('window.ResumeStream.peek(id)');
const renderAt = dialogs.indexOf('var displayMsgs = chats[id].messages.filter');
assert(peekAt > 0 && renderAt > peekAt, 'resume snapshot must be injected before DOM rendering');

console.log('stream_refresh_recovery.test.js: all assertions passed');
