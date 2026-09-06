const assert = require('assert');
const fs = require('fs');

const css = fs.readFileSync('public/css/theme-studio.css', 'utf8');
const js = fs.readFileSync('public/js/theme-studio.js', 'utf8');

assert(css.includes('--oac-bg: #f8fafc'), 'DSH light canvas must use cool white');
assert(css.includes('--oac-bg-deep: #f1f5f9'), 'DSH light secondary canvas must use cool slate');
assert(css.includes('--oac-text: #1e293b'), 'DSH light typography must use neutral slate');
assert(css.includes('background: #eef3fb !important'), 'DSH light user bubble must use a pale blue-gray surface');
assert(css.includes('color: #334155 !important'), 'DSH light user bubble must use readable slate text');
assert(css.includes('--oac-code-bg: #f3f6fa'), 'DSH light code blocks must use a light editor surface');
assert(css.includes('html:not(.dark)[data-theme-page="chat"][data-chat-theme="dsh"] .sidebar-newchat-btn'), 'DSH light navigation controls must be independently softened');
assert(css.includes('linear-gradient(145deg, #273449, #1f2a3c)'), 'DSH dark user bubble must use neutral blue-gray');
assert(!css.includes('#f4f0e9'), 'DSH parchment canvas must not return');
assert(!css.includes('#41372f'), 'DSH brown message text must not return');
assert(js.includes("accent: '#4f46e5'"), 'DSH runtime accent must be indigo');
assert(js.includes("swatches: ['#f8fafc', '#4f46e5', '#93c5fd']"), 'DSH preview swatches must match restored palette');
assert(!js.includes("accent: '#9a6748'"), 'DSH brown runtime accent must not return');

console.log('✅ dsh_theme_palette_regression.test.js: all assertions passed');
