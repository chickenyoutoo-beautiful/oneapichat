const assert = require('assert');
const fs = require('fs');

const storage = fs.readFileSync('public/js/storage.js', 'utf8');
const agent = fs.readFileSync('public/js/agent.js', 'utf8');
const init = fs.readFileSync('public/js/init.js', 'utf8');
const dialogs = fs.readFileSync('public/js/dialogs.js', 'utf8');
const style = fs.readFileSync('public/css/style.css', 'utf8');
const importer = fs.readFileSync('tools/import_claude_codex_chats.py', 'utf8');

assert(storage.includes('var _isIndexOnlyA = !!(_localChatA._localIndex || _localChatA._indexOnly);'));
assert(storage.includes('_isIndexOnlyA') && storage.includes('_serverTsA > _localTsA'));
assert(storage.includes('var _isIndexOnlyM = !!(_mc._localIndex || _mc._indexOnly);'));
assert(agent.includes('await new Promise(function(resolve) { setTimeout(resolve, 280); });'));
assert(agent.includes("if (typeof saveChats === 'function') await saveChats();"));
assert(agent.includes('本地/服务器删除确认'));
assert(agent.includes('isAgentChat') || agent.includes('Agent'));
assert(dialogs.includes("_addToGroup('claude_imports', 'Claude Code 会话', id, 200, 'claude')"));
assert(dialogs.includes("_addToGroup('codex_imports', 'Codex 会话', id, 210, 'codex')"));
assert(dialogs.includes('function _historyGroupSvg(kind)'));
assert(dialogs.includes('chat-history-group-kind-icon'));
assert(!dialogs.includes("'🟣 Claude Code 会话'"));
assert(!dialogs.includes("'🟢 Codex 会话'"));
assert(!dialogs.includes("? '📁 ' :"));
assert(dialogs.includes("replace(/^\\s*(?:\\[(?:claude|codex)\\]|【(?:claude|codex)】)\\s*/i, '')"));
assert(style.includes('.chat-history-group-chevron'));
assert(style.includes('.chat-history-group-kind-icon'));
assert(!importer.includes('f"[Claude] {title}"'));
assert(!importer.includes('f"[Codex] {title'));
assert(importer.includes('"title": title'));
assert(importer.includes("'title': title or 'Codex 会话'"));

console.log('agent_history_cleanup.test.js: all assertions passed');
