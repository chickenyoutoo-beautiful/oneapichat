const assert = require('assert');
const fs = require('fs');

const resume = fs.readFileSync('public/js/resume-stream.js', 'utf8');
const notify = fs.readFileSync('public/js/agent-notify.js', 'utf8');

// Observer must use the same live tool-status projection as the producer.
assert(resume.includes('function _renderObserverToolTimeline'));
assert(resume.includes("showToolStatus(tc.function.name, preview, settled ? 'success' : 'running'"));
assert(resume.includes("showToolStatus('', '', null, chatId, '')"));

// Observer completion settles live UI without racing a full redraw; stream_done performs final projection.
assert(resume.includes('观察端刚看到的完整流也是本地较新投影'));
assert(resume.includes('stream_done 会在服务端会话提交完成后触发最终回源'));
assert(!resume.includes('if (isCurrent) setTimeout(function(){ loadChat(chatId); }, 0)'));

// agent:tool_status event listener broadcasts tool progress in real-time.
assert(notify.includes("addEventListener('agent:tool_status'"));
assert(notify.includes("showToolStatus(ev.tool || '...'"));
assert(notify.includes('_resyncChatFromRemote(cid, 0, _eventTraceId)'));
assert(notify.includes('if (res && res.notFound)'), '404 远端会话必须阻断无效重试');
assert(notify.includes('window._deletedChatIds[did] = true;'), '索引同步必须消费服务端墓碑');

console.log('multidevice_projection_consistency.test.js: all assertions passed');
