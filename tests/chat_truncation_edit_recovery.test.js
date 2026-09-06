const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dialogs = fs.readFileSync('public/js/dialogs.js', 'utf8');
const rendering = fs.readFileSync('public/js/rendering.js', 'utf8');
const main = fs.readFileSync('public/js/main.js', 'utf8');
const storage = fs.readFileSync('public/js/storage.js', 'utf8');
const php = fs.readFileSync('api/chat.php', 'utf8');

// 1. dialogs.js 必须暴露 window.truncateChatMessages，且递增 revision 和 updated_at
assert(dialogs.includes('window.truncateChatMessages = function'), '必须声明 window.truncateChatMessages');
assert(dialogs.includes('chat.revision = Math.max(Number(chat.revision || 0) + 1'), 'truncate 必须递增 revision');
assert(dialogs.includes('chat._truncatedAt = Date.now()'), 'truncate 必须记录 _truncatedAt');
assert(dialogs.includes('window._saveAndBroadcast(chatId)'), 'truncate 必须立即单文件落盘并广播');

// 2. rendering.js 与 main.js 的编辑/还原/重新生成按钮必须接入 truncateChatMessages
assert(rendering.includes('window.truncateChatMessages(currentChatId, remaining)'), '用户消息编辑与还原必须调用 truncateChatMessages');
assert(main.includes('window.truncateChatMessages(chatId, remaining)'), '最后一条用户消息编辑必须调用 truncateChatMessages');

// 3. storage.js 的 restoreUserData 和 saveChatsToServerOnce 绝不能仅看 _serverMsgs.length > _localMsgs.length
assert(storage.includes('!_isLocalNewer2 && _serverTs2 > _localTs2 && _serverMsgs.length > _localMsgs.length'), '全量备份不能覆盖本地截断更新会话');
assert(storage.includes('!_isLocalNewerA && _serverMsgs.length > _localMsgs.length'), 'Agent 会话恢复不能覆盖本地截断更新会话');
assert(storage.includes('!_isLocalNewerM && _sc.messages.length > _mc.messages.length'), '普通会话恢复不能覆盖本地截断更新会话');

// 4. api/chat.php 的单会话保存必须使用 onechat_apply_single_chat_save，不能把已截断的旧消息并集恢复
assert(php.includes('function onechat_apply_single_chat_save'), 'chat.php 必须实现 onechat_apply_single_chat_save');
assert(php.includes('$data = onechat_apply_single_chat_save($existingChat, $data)'), '单会话保存必须使用 onechat_apply_single_chat_save');

console.log('chat_truncation_edit_recovery.test.js: all assertions passed');
