const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const frontend = ['public/js/tools.js','public/js/main.js','public/js/tools-exec.js','public/js/upload.js'].map(read).join('\n');
assert(!/const\s+MMX_TOOLS\b/.test(frontend), 'MMX_TOOLS schema must be removed');
assert(!/name:\s*[\"']mmx_/.test(frontend), 'frontend must not define MMX tools');
assert(!/action=mmx/.test(frontend), 'frontend must not call the removed MMX endpoint');

const agentRoles = read('python/engine/agent_roles.py');
assert(!/[\"']mmx_(chat|image|speech|vision)[\"']/.test(agentRoles), 'subagents must not expose MMX tools');
const skill = read('skills/content-creation/SKILL.md');
assert(!/\bmmx_[a-z_]+\b/.test(skill), 'content creation skill must not reference MMX tools');
const engineApi = read('api/engine_api.php');
assert(!/case\s+[\"']mmx[\"']/.test(engineApi), 'engine_api MMX action must be removed');

for (const rel of ['api/v1/mcp.php','api/v1/tools.php','api/v1/tools/call.php','api/v1/chat/completions.php','public/js/config.js']) {
  assert(/mmx_/.test(read(rel)), rel + ' must keep an MMX exclusion guard');
}
console.log('MMX tool removal guards verified');
