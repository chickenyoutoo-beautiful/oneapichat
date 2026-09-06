const assert = require('assert');
const fs = require('fs');

const css = fs.readFileSync('public/css/theme-studio.css', 'utf8');

assert(
    css.includes('html:not(.dark)[data-theme-page="chat"][data-chat-theme="minimal"] .sidebar-newchat-btn'),
    'Minimal light theme must override primary action colors'
);
assert(
    css.includes('background: rgba(255, 255, 255, 0.72) !important'),
    'Minimal light new-chat control must restore the original outlined surface'
);
assert(
    css.includes('html:not(.dark)[data-theme-page="chat"][data-chat-theme="minimal"] #authHeaderBtn'),
    'Minimal light account pill must have an independent neutral treatment'
);
assert(
    css.includes('background: rgba(255, 255, 255, 0.84) !important'),
    'Minimal light account pill must restore its white surface'
);
assert(
    css.includes('background: linear-gradient(135deg, #3b82f6, #2563eb) !important'),
    'Minimal light send action must keep the familiar blue gradient'
);
assert(
    css.includes('--oac-code-bg: #f3f6fa'),
    'Minimal light code blocks must use a light editor surface'
);
assert(
    css.includes('--oac-code-text: #273244'),
    'Minimal light code blocks must use dark readable text'
);
assert(
    css.includes('html:not(.dark)[data-theme-page="chat"][data-chat-theme="minimal"] pre .hljs'),
    'Minimal light syntax containers must inherit the readable code color'
);

console.log('✅ minimal_theme_color_regression.test.js: all assertions passed');
