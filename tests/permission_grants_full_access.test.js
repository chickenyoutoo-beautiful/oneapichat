const fs = require('fs');
function assert(c, m) { if (!c) throw new Error(m); }

const core = fs.readFileSync('public/js/core.js', 'utf8');
const agent = fs.readFileSync('public/js/agent.js', 'utf8');
const exec = fs.readFileSync('public/js/tools-exec.js', 'utf8');
const serverTools = fs.readFileSync('python/engine/server_tools.py', 'utf8');

// 1. core.js hasFullFileAccess must consider workspacePermission = 'danger-full-access'
assert(core.includes("perm === 'danger-full-access'"), 'core.js hasFullFileAccess must auto-detect danger-full-access');
assert(core.includes("ensureFullFileAccessGrant"), 'core.js must export ensureFullFileAccessGrant');

// 2. agent.js requestFilesystemGrant must auto-resolve without modal when perm is danger-full-access
assert(agent.includes("perm === 'danger-full-access'"), 'agent.js requestFilesystemGrant must auto-grant for danger-full-access');

// 3. tools-exec.js must ensure full access grant on _executeWithPermissionRetry and run_code
assert(exec.includes("ensureFullFileAccessGrant"), 'tools-exec.js must ensure grant before executing permission-bound actions');

// 4. server_tools.py must return PERMISSION_REQUIRED with code and capability
assert(serverTools.includes('"code": "PERMISSION_REQUIRED"'), 'server_tools.py must return PERMISSION_REQUIRED code on sandbox violation');

console.log('permission_grants_full_access: PASS');
