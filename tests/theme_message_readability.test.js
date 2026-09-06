const assert = require('assert');
const fs = require('fs');
const css = fs.readFileSync('public/css/theme-studio.css', 'utf8');
const build = fs.readFileSync('tools/build-index.py', 'utf8');

assert(build.includes('("js/theme-studio.js", True, "")'), 'Theme Studio runtime must load');
assert(build.includes('("css/theme-studio.css", False, "")'), 'Theme Studio final stylesheet must load');
assert(css.includes('Final chat readability guards — DSH + Minimal'), 'final message theme guards must exist');
assert(css.includes('[data-chat-theme="dsh"] #chatMessagesContainer'), 'DSH message canvas must be transparent');
assert(css.includes('linear-gradient(145deg, #273449, #1f2a3c)'), 'DSH dark user bubble must use readable neutral blue-gray');
assert(css.includes('.message-row.user .bubble.user .markdown-body :where(p,li,strong,em,span,code,a)'), 'nested markdown colors must be guarded');
assert(css.includes('background: #f1f3f5 !important'), 'minimal light user bubble must be neutral');
assert(css.includes('background: #202124 !important'), 'minimal dark user bubble must be neutral dark');
assert(css.includes('max-width: 88% !important'), 'mobile user bubbles must remain responsive');

console.log('✅ theme_message_readability.test.js: all assertions passed');
