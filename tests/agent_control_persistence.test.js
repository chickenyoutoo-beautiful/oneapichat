const fs = require('fs');
const assert = require('assert');

const agent = fs.readFileSync('public/js/agent.js', 'utf8');
const notify = fs.readFileSync('public/js/agent-notify.js', 'utf8');
const storage = fs.readFileSync('public/js/storage.js', 'utf8');
const init = fs.readFileSync('public/js/init.js', 'utf8');

assert(agent.includes("var _clickGestureMode = 'off';"), 'double-click handler must snapshot gesture mode');
assert(agent.includes("if (_clickGestureMode === 'off')"), 'enter gesture must use the pre-click mode');
assert(agent.includes('getPreferredAgentMode()'), 're-entry must restore preferred mode');
assert(agent.includes("localStorage.setItem('agentPreferredMode', mode)"), 'active mode selection must persist');
assert(agent.includes("localStorage.setItem('workspacePermission', perm)"), 'workspace permission must persist');
assert(agent.includes('window._shouldApplyRemoteAgentMode'), 'remote mode writes need stale-value protection');
assert(notify.includes('_shouldApplyRemoteAgentMode(remoteTs)'), 'SSE mode updates must honor local timestamp guard');
assert(storage.includes("k !== 'workspacePermission'"), 'server config restore must not overwrite local permission');
assert(storage.includes("k !== 'agentPreferredMode'"), 'server config restore must not overwrite local mode preference');
assert(storage.includes("k === 'agentModeLocalTs'"), 'local mode timestamp must stay local-only');
assert(init.includes('_updatePermissionUI(window.getWorkspacePermission())'), 'startup must restore permission capsule UI');

console.log('agent control persistence regression: PASS');
