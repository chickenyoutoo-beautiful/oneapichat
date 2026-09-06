const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/js/rendering.js', 'utf8');
const start = source.indexOf('function autoLinkURLs');
const end = source.indexOf('\n}\n\n// ★ 图片快速操作辅助函数', start) + 2;
assert(start >= 0 && end > start, 'autoLinkURLs source not found');
const context = { URL };
vm.runInNewContext(source.slice(start, end), context);

assert.strictEqual(
    context.autoLinkURLs('[图片 原神奥黛塔](https://example.test/view?id=1)'),
    '![图片 原神奥黛塔](https://example.test/view?id=1)'
);
assert.strictEqual(
    context.autoLinkURLs('[视频链接](https://example.test/video?id=1)'),
    '[视频链接](https://example.test/video?id=1)'
);
assert.strictEqual(
    context.autoLinkURLs('https://example.test/assets/a.png?x=1'),
    '![image](https://example.test/assets/a.png?x=1)'
);
assert.strictEqual(
    context.autoLinkURLs('[图片 原图](http://example.test/view?id=1)'),
    '![图片 原图](https://example.test/view?id=1)'
);
assert.strictEqual(
    context.autoLinkURLs('[奥黛塔立绘](http://example.test/art?id=2)'),
    '![奥黛塔立绘](https://example.test/art?id=2)'
);
assert.strictEqual(
    context.autoLinkURLs('- 奥黛塔美图 - http://example.test/a.jpg'),
    '- 奥黛塔美图 - ![image](https://example.test/a.jpg)'
);
console.log('auto_image_links.test.js: all assertions passed');
