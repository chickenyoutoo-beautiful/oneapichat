const fs = require('fs');
const assert = require('assert');

const toolsExec = fs.readFileSync('public/js/tools-exec.js', 'utf8');
const notify = fs.readFileSync('public/js/agent-notify.js', 'utf8');
const agent = fs.readFileSync('public/js/agent.js', 'utf8');
const serverTools = fs.readFileSync('python/engine/server_tools.py', 'utf8');

assert(toolsExec.includes("_executeWithPermissionRetry('file_search', args, chatId, 'filesystem.search')"), 'glob/file_search must retry after grant');
assert(serverTools.includes('"code": "PERMISSION_REQUIRED"') && serverTools.includes('"capability": "filesystem.search"'), 'search denial must return structured permission error');
assert(notify.includes('var _hasLocalStream = !!('), 'stream toast must distinguish local active stream');
assert(agent.includes('var _ownerChatId = window._subAgentOwnerChats && window._subAgentOwnerChats[agentName]'), 'orphan result must recover owner chat');
assert(toolsExec.includes('window._subAgentOwnerChats[tName] = chatId'), 'delegate must persist owner chat');
console.log('agent permission completion regression: PASS');
