const assert = require('assert');
const fs = require('fs');

const rendering = fs.readFileSync('public/js/rendering.js', 'utf8');
const markdown = fs.readFileSync('public/js/markdown.js', 'utf8');
const init = fs.readFileSync('public/js/init.js', 'utf8');
const main = fs.readFileSync('public/js/main.js', 'utf8');
const tools = fs.readFileSync('public/js/tools.js', 'utf8');
const search = fs.readFileSync('public/js/search.js', 'utf8');

// Failed image links must not be offered again as the fallback destination.
assert(rendering.includes('function _imageSourcePage(img, src)'));
assert(rendering.includes('function _knownImageSourcePage(src)'));
assert(rendering.includes("'https://wiki.biligame.com/' + encodeURIComponent(project) + '/首页'"));
assert(rendering.includes("'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(filename)"));
assert(!rendering.includes('card.href = src;'));
assert(rendering.includes("card.href = target;"));
assert(rendering.includes('图片直链已失效 · 点击打开来源页面'));

// Only one error owner. Markdown/global handlers may not race the unified fallback.
assert(!markdown.includes('_fallback.href = _href'));
assert(init.includes('window.attachImageFallbacks(e.target)'));

// Models must not fabricate an image URL from filenames/snippets.
assert(main.includes('严禁根据文件名、目录、哈希或摘要自行猜测/拼接图片直链'));
assert(tools.includes('绝对禁止根据文件名、目录或哈希猜测/拼接图片直链'));
assert(search.includes('图片来源页: ${r.url || \'\'}'));

console.log('image_source_fallback_contract.test.js: all assertions passed');
