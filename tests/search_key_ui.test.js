const assert = require('assert');
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/css/style.css', 'utf8');

assert(html.includes('id="searchApiKey"') && html.includes('type="text"'), '搜索API Key不应使用password类型');
assert(html.includes('autocomplete="off"'), '搜索API Key应关闭浏览器自动填充');
assert(html.includes('name="search_api_key"'), '搜索API Key缺少独立字段名');
assert(html.includes('-webkit-text-security:disc'), '搜索API Key缺少视觉遮蔽');
assert(css.includes('.search-provider-card {') && css.includes('background: transparent;'), '搜索配置卡片未扁平化');
assert(css.includes('.search-provider-card .search-provider-eyebrow::before'), '搜索服务缺少轻量视觉标识');

console.log('✅ search_key_ui.test.js: all assertions passed');
