const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const resumeSource = fs.readFileSync(path.join(root, 'public/js/resume-stream.js'), 'utf8');
const streamSource = fs.readFileSync(path.join(root, 'public/js/stream-handler.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'public/js/main.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'public/js/api-messages.js'), 'utf8');

// The continuation merger must be monotonic and must remove only genuine replay overlap.
const mergerContext = { console };
mergerContext.window = mergerContext;
mergerContext.location = { origin: 'https://example.test' };
mergerContext.setTimeout = setTimeout;
mergerContext.clearTimeout = clearTimeout;
mergerContext.setInterval = setInterval;
mergerContext.clearInterval = clearInterval;
mergerContext.AbortController = AbortController;
mergerContext.fetch = async function() { throw new Error('network not used'); };
mergerContext.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
mergerContext.addEventListener = function() {};
mergerContext.chats = {};
mergerContext.activeBubbleMap = {};
mergerContext.isTypingMap = {};
vm.createContext(mergerContext);
vm.runInContext(resumeSource, mergerContext, { filename: 'resume-stream.js' });
const merge = mergerContext.window.mergeAssistantStreamText;
assert.strictEqual(typeof merge, 'function');
assert.strictEqual(merge('正在搜索公开资料', '根据搜索结果，结论如下'), '正在搜索公开资料\n\n根据搜索结果，结论如下');
assert.strictEqual(merge('前置说明。', '前置说明。后续结论'), '前置说明。后续结论');
assert.strictEqual(merge('前置说明', ''), '前置说明');

// The stream receiver must actually use the merge path (not just declare dead helpers).
assert(streamSource.includes('applyStreamRender(chatId, _mergeRoundContent(_renderText))') ||
       streamSource.includes('applyStreamRender(chatId, _visibleRenderText)'),
       'HTTP stream must render continuation together with pre-tool content');
assert(streamSource.includes('pendingMsg._toolVisibleContent = _mergeRoundContent'),
       'HTTP stream must retain a monotonic visible projection');
assert(resumeSource.includes('_visibleContent(full)'),
       'resumable stream must merge snapshot/done content with pre-tool content');

// The tool loop must establish a base before the next provider request.
assert(mainSource.includes('pendingMsg._toolRoundBaseContent'),
       'tool loop must carry the pre-tool visible content into the next turn');
assert(mainSource.includes('body.messages = buildApiMessages(chatId);'),
       'tool loop must rebuild a provider-valid assistant/tool history');
assert(apiSource.includes("if (msg.role === 'assistant' && !msg.partial)"),
       'wire message construction must exclude only open partial assistant turns');

console.log('web_search_preamble_continuation.test.js: all assertions passed');
