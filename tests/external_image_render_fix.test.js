const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const core = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'core.js'), 'utf8');
const rendering = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'rendering.js'), 'utf8');
const markdown = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'markdown.js'), 'utf8');
const init = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'init.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'main.js'), 'utf8');
const tools = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'tools.js'), 'utf8');
const markedJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'lib', 'marked.min.js'), 'utf8');

const ctx = {
  window: {},
  document: {
    createElement: () => ({ style: {}, appendChild: () => {}, querySelectorAll: () => [] }),
  },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { origin: 'https://example.com', href: 'https://example.com/chat' },
  URL,
  console
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(markedJs, ctx);
vm.runInContext(rendering, ctx);
vm.runInContext(core, ctx);

const input = `为你找到两张来自维基共享资源（Wikimedia Commons）的高清真实历史照片：

### 1. 赛场暴扣挂筐经典瞬间（2005年）
身穿经典紫金 8 号球衣，在比赛中完成大力扣篮后的挂筐抓拍，极具赛场冲击力：

![科比暴扣](https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Kobe_Bryant_8.jpg/800px-Kobe_Bryant_8.jpg)
*来源：[Wikimedia Commons - File:Kobe Bryant 8.jpg](https://commons.wikimedia.org/wiki/File:Kobe_Bryant_8.jpg)*`;

const rendered = ctx._renderMarkdownWithMath(input);

// 1. 验证常规来源网页链接未被篡改成 <img>，而是正确保留为链接
assert(rendered.includes('href="https://commons.wikimedia.org/wiki/File:Kobe_Bryant_8.jpg"'), '来源网页超链接必须正确保留');
assert(rendered.includes('Wikimedia Commons - File:Kobe Bryant 8.jpg'), '超链接标题文本绝不能丢失');
assert(!rendered.includes('<img src="https://commons.wikimedia.org/wiki/File:Kobe_Bryant_8.jpg"'), '网页绝不能被错误转成 img 标签');

// 2. 验证真图片获得防盗链保护
assert(rendered.includes('referrerpolicy="no-referrer"'), '图片标签必须包含 no-referrer 防盗链属性');
assert(rendered.includes('src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Kobe_Bryant_8.jpg/800px-Kobe_Bryant_8.jpg"'), '真实图片必须正常输出 img 标签');

// 3. 验证存在 attachImageFallbacks 函数和来源页推导
assert.strictEqual(typeof ctx.attachImageFallbacks, 'function', '必须暴露 attachImageFallbacks 函数');
assert.strictEqual(typeof ctx._knownImageSourcePage, 'function', '必须暴露已知图床来源页推导函数');
assert.strictEqual(
  ctx._knownImageSourcePage('https://patchwiki.biligame.com/images/wqmt/c/c8/Syjqicon.png'),
  'https://wiki.biligame.com/wqmt/首页',
  'BWIKI 坏图必须跳到可访问的 Wiki 来源页，而不是 404 图片直链'
);
assert.strictEqual(
  ctx._knownImageSourcePage('https://upload.wikimedia.org/wikipedia/commons/9/96/Kobe_Bryant_8.jpg'),
  'https://commons.wikimedia.org/wiki/File:Kobe_Bryant_8.jpg',
  'Wikimedia 坏图必须跳到 Commons File 来源页'
);
assert(rendering.includes("'https://images.weserv.nl/?url=' + encodeURIComponent(src)"), '坏图应先尝试公共图片代理');
assert(rendering.includes('图片直链已失效 · 点击打开来源页面'), '最终降级卡片必须明确打开来源页');
assert(!markdown.includes("_fallback.href = _href"), 'markdown 不能再抢先把坏图替换成 404 原始直链');
assert(init.includes("window.attachImageFallbacks(e.target)"), '全局图片错误应委托给统一来源页降级器');
assert(!init.includes("e.target.style.display = 'none';\n                e.preventDefault();\n            }\n        }, true);"), '正文坏图不能再被全局监听器直接隐藏');
assert(main.includes('只允许展示搜索工具实际返回的 thumbnail/image_url'), '图片搜索系统提示必须禁止模型猜测直链');
assert(tools.includes('绝对禁止根据文件名、目录或哈希猜测/拼接图片直链'), 'web_search 工具描述必须禁止猜测图片 URL');

require('assert').ok(true);
process.stdout.write('external_image_render_fix.test.js: all assertions passed\n');
