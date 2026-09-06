const fs = require('fs');
const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rendering = fs.readFileSync(root + '/public/js/rendering.js', 'utf8');
const main = fs.readFileSync(root + '/public/js/main.js', 'utf8');
const streamHandler = fs.readFileSync(root + '/public/js/stream-handler.js', 'utf8');

assert(rendering.includes('window.renderGeneratedImagesIntoBubble = function(bubble, images)'), '必须暴露统一图片实时渲染函数');
assert(rendering.includes('window.renderGeneratedImagesIntoBubble(bubble, allImages);'), 'appendMessage 必须调用统一渲染函数');

assert(main.includes('window.renderGeneratedImagesIntoBubble(_imgBubble, _imgs);'), '工具执行完必须立即调用统一渲染函数实时挂载');
assert(main.includes('window.renderGeneratedImagesIntoBubble(_bubble, pendingMsg.generatedImages);'), '流式收尾必须同步实时渲染');

assert(streamHandler.includes('window.renderGeneratedImagesIntoBubble(_streamBubble, pendingMsg.generatedImages);'), 'streamHandler 完成时必须调用统一渲染函数');

console.log('generated_image_live_render.test.js: all assertions passed');
