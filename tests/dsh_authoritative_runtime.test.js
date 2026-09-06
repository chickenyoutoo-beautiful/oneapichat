const assert = require('assert');
const fs = require('fs');

const notify = fs.readFileSync('public/js/agent-notify.js', 'utf8');
const resume = fs.readFileSync('public/js/resume-stream.js', 'utf8');
const apiMessages = fs.readFileSync('public/js/api-messages.js', 'utf8');
const phpBridge = fs.readFileSync('api/engine_api.php', 'utf8');
const engine = fs.readFileSync('python/engine_server.py', 'utf8');
const store = fs.readFileSync('python/engine/store.py', 'utf8');

// Observer is a projection only: it must not execute tools or trigger the next LLM round.
assert(resume.includes("if (pm && pm._remoteObserver)"));
assert(resume.includes("skip _resumeToolHandoff tool execution"));
assert(resume.includes("if (window._remoteTypingMap && window._remoteTypingMap[chatId])"));

// A background server refresh must never destroy a live streaming projection.
assert(notify.includes("var _isLiveGenerating = !!(typeof isTypingMap !== 'undefined' && isTypingMap[cid]"));
assert(notify.includes("cid === currentChatId && !_isLiveGenerating"));

// Invalid empty assistant turns must not be sent back to providers.
assert(apiMessages.includes("if (!_cleanedContent && (!msg.tool_calls || !msg.tool_calls.length)) continue"));

// The PHP bridge and Python engine both enforce stable request identity / single producer.
assert(phpBridge.includes("'msg_req_' . substr(hash('sha256'"));
assert(engine.includes("stream_create_attached_existing"));
assert(engine.includes("find_running_task(user_id, chat_id=runtime_chat_id, msg_id=msg_id)"));
assert(store.includes("def find_running_task"));

console.log('dsh_authoritative_runtime.test.js: all assertions passed');
