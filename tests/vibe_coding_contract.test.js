const fs = require('fs');
function assert(c,m){if(!c)throw new Error(m)}
const tools = fs.readFileSync('public/js/tools.js','utf8');
const main = fs.readFileSync('public/js/main.js','utf8');
const exec = fs.readFileSync('public/js/tools-exec.js','utf8');
assert(/name:\s*"run_code"/.test(tools),'run_code schema missing');
assert(/RUN_CODE_TOOL/.test(main),'run_code not exposed');
assert(!/tools\.push\(SERVER_FILE_READ_TOOL\)/.test(main),'legacy read schema still exposed');
assert(!/tools\.push\(SERVER_EXEC_TOOL\)/.test(main),'legacy exec schema still exposed');
assert(/_vibeTodos/.test(exec),'Todo chat persistence missing');
assert(/computeDiff/.test(exec),'real diff integration missing');
console.log('vibe coding contract: PASS');
