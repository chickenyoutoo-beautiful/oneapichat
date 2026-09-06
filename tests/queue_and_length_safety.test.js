const assert = require('assert');
const fs = require('fs');

const mainJs = fs.readFileSync('public/js/main.js', 'utf8');
const storageJs = fs.readFileSync('public/js/storage.js', 'utf8');
const chatPhp = fs.readFileSync('api/chat.php', 'utf8');

// 1. 验证 main.js 修复
assert(mainJs.includes("var files = Array.isArray(skipUserAdd ? userFilesForRegen : pendingFiles)"), "files must default to safe array");
assert(!mainJs.includes("!skipUserAdd && !text && !files.length"), "raw files.length without guard must not exist in header");
assert(mainJs.includes("useToolCall = getChecked('searchToolCallToggle') || ((files && files.length > 0)"), "useToolCall must guard files.length");
assert(mainJs.includes("defaultTitle = text ? text.trim().slice(0, TITLE_MAX_LENGTH) : ((files && files.length)") || mainJs.includes("defaultTitle = text ? text.slice(0, 10) : ((files && files.length)"), "defaultTitle must guard files.length");

// 2. 验证 storage.js 修复
assert(storageJs.includes("key.indexOf('oc_queue_') === 0"), "oc_queue_ must be marked transient");
assert(storageJs.includes("key.indexOf('queued_message_') === 0"), "queued_message_ must be marked transient");

// 3. 验证 chat.php 过滤
assert(chatPhp.includes("strpos($k, 'oc_queue_') === 0"), "chat.php must filter oc_queue_ on get_config and save_config");

console.log('queue_and_length_safety.test.js: all assertions passed!');
