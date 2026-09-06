const assert = require('assert');
const fs = require('fs');

const ui = fs.readFileSync('public/js/ui.js', 'utf8');
const main = fs.readFileSync('public/js/main.js', 'utf8');
const css = fs.readFileSync('public/css/theme-studio.css', 'utf8');
const baseCss = fs.readFileSync('public/css/style.css', 'utf8');

assert(ui.includes("liveSummary = document.createElement('button')"), 'tool summary must be an accessible disclosure button');
assert(ui.includes("tcContainer.classList.toggle('tool-call-expanded')"), 'tool details must support local expand/collapse');
assert(ui.includes("tcContainer.classList.add('tool-call-settled')"), 'settled tool traces must have a stable state');
assert(ui.includes("settledTitle.textContent = 'Agent 执行记录'"), 'settled summary title must update');
assert(css.includes('[data-chat-theme="minimal"] .tool-call-settled:not(.tool-call-expanded) .tool-call-line'), 'minimal settled details must collapse by default');
assert(css.includes('[data-chat-theme="minimal"] .tool-call-line::before'), 'minimal expanded details must render a timeline rail');
assert(css.includes('.tool-call-live-chevron'), 'summary must expose a chevron affordance');
assert(css.includes('@media (max-width: 640px)'), 'minimal tool trace must include mobile adaptation');

console.log('✅ minimal_tool_trace.test.js: all assertions passed');
// Tool failures keep their complete result and support disclosure instead of a 40-char truncation.
assert(ui.includes("status === 'error' ? (argPreview || '')"));
assert.match(ui, /tool-call-error-expanded/);
assert.match(ui, /点击展开或收起完整错误信息/);
assert(main.includes("toolResult.error ? contentStr : ''"));
assert.match(baseCss, /\.tool-call-error-detail \.tool-call-arg/);
assert.match(baseCss, /max-height: min\(42vh, 360px\)/);

