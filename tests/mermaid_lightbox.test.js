const assert = require('assert');
const fs = require('fs');

const init = fs.readFileSync('public/js/init.js', 'utf8');
const rendering = fs.readFileSync('public/js/rendering.js', 'utf8');
const notify = fs.readFileSync('public/js/agent-notify.js', 'utf8');
const chatApi = fs.readFileSync('api/chat.php', 'utf8');

assert(init.includes("showImageLightbox([{ url: _svgData, __svgMarkup: _svgClone.outerHTML }], 0)"));
assert(rendering.includes("var isSvgPreview = images.length === 1"));
assert(rendering.includes("svgPreview.innerHTML = images[idx].__svgMarkup || ''"));
assert(rendering.includes("className = 'canvas-svg-preview'"));
assert(notify.includes("apiBase + '/chat.php?chat_id=all'"));
assert(notify.includes("serverChat = allData && allData.chats ? allData.chats[chatId] : null"));
assert(chatApi.includes("$allFilename = $dataDir . $namespace . '_all.json';"));
assert(chatApi.includes("$allContent['chats'][$chatId]"));
assert(chatApi.includes("'already_missing' => true"));
assert(chatApi.includes("DELETE 必须幂等"));

console.log('mermaid_lightbox.test.js: all assertions passed');
