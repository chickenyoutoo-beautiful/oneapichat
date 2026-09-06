const assert = require('assert');
const fs = require('fs');

const dialogs = fs.readFileSync('public/js/dialogs.js', 'utf8');
const main = fs.readFileSync('public/js/main.js', 'utf8');

assert(dialogs.includes('function _hasMeaningfulChatContent(chat)'));
assert(dialogs.includes('function _pruneEmptyDraftChats()'));
assert(dialogs.includes('if (_isEmptyDraftChat(id)) return false;'));
assert(dialogs.includes('Object.keys(chats).filter(_isEmptyDraftChat)'));
assert(dialogs.includes('重复点击“新建”只回到它'));
assert(dialogs.includes('_scheduleTitleRetry(chatId)'));
assert(dialogs.includes('Math.min(120000, 5000 * Math.pow(2'));
assert(dialogs.includes('标题生成失败，将延迟重试'));
assert(dialogs.includes("if (!isAgentChat(id) && _hasMeaningfulChatContent(chats[id]) && _isPlaceholderTitle(chats[id].title))"));
assert(main.includes('autoGenerateTitle(chatId);'));

console.log('chat_lifecycle_title_retry.test.js: all assertions passed');
