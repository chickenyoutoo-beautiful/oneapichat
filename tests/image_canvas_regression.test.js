const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upload = fs.readFileSync(root + '/public/js/upload.js', 'utf8');
const rendering = fs.readFileSync(root + '/public/js/rendering.js', 'utf8');
const css = fs.readFileSync(root + '/public/css/style.css', 'utf8');

const start = upload.indexOf('function getImageUrl');
const end = upload.indexOf('/**\n * ★ 统一提取图片元数据', start);
assert(start >= 0 && end > start, '找不到图片去重辅助函数');
const sandbox = { window: { location: { origin: 'https://example.test' } }, URL, Map };
vm.createContext(sandbox);
vm.runInContext(upload.slice(start, end), sandbox);

const list = [
  '/oneapichat/uploads/a.png',
  { url: 'https://example.test/oneapichat/uploads/a.png', prompt: '完整提示词' },
  { url: '/oneapichat/uploads/a.png?_img_retry=123' },
  { url: '/oneapichat/uploads/b.png' }
];
const deduped = sandbox.window.dedupeImageList(list);
assert.strictEqual(deduped.length, 2, '同源绝对/相对 URL 与重试参数必须去重');
assert.strictEqual(deduped[0].prompt, '完整提示词', '重复项应保留更完整元数据');

assert(rendering.includes('images = typeof dedupeImageList'), '画布入口必须先去重');
assert(rendering.includes('return typeof dedupeImageList'), '聊天图片集合必须去重');
assert(!rendering.includes('background:linear-gradient(135deg,#1e2030'), '画布不得继续硬编码暗色背景');
assert(css.includes('--canvas-bg: color-mix'), '画布必须使用主题变量');
assert(css.includes('var(--oac-accent'), '画布必须跟随当前主题强调色');
assert(css.includes('.canvas-info-section.notes-section .canvas-info-textarea'), '备注区域必须有独立协调样式');
assert(rendering.includes("bottomArea.className = 'canvas-bottom-area canvas-overlay-dock'"), '底部控件必须标记为悬浮控制坞');
assert(rendering.includes('imgArea.appendChild(bottomArea)'), '控制坞必须挂到图片区而非画布底部文档流');
assert(!rendering.includes('overlay.appendChild(bottomArea)'), '不得继续让底部控件占据独立布局高度');
assert(css.includes('.canvas-bottom-area.canvas-overlay-dock'), '悬浮控制坞必须使用绝对定位样式');
assert(css.includes('transform: translateX(-50%)'), '悬浮控制坞必须水平居中');
assert(rendering.includes('requestAnimationFrame(renderTransformFrame)'), '缩放必须使用 RAF 连续渲染');
assert(rendering.includes('Math.exp(-delta * 0.0022)'), '滚轮缩放必须使用连续指数倍率');
assert(rendering.includes('zoomAt(e.clientX, e.clientY'), '缩放必须围绕鼠标位置锚定');
assert(rendering.includes('setPointerCapture(e.pointerId)'), '鼠标拖拽必须使用 Pointer Capture');
assert(rendering.includes("imgArea.addEventListener('pointermove'"), '必须监听 Pointer Move 拖动图片');
assert(rendering.includes('function clampPan()'), '拖拽必须限制在可视边界内');
assert(rendering.includes("imgArea.addEventListener('dblclick'"), '必须支持双击放大或复位');
assert(rendering.includes('img.draggable = false'), '必须关闭浏览器原生图片拖拽');
assert(!rendering.includes('document.removeEventListener(\'mousemove\', handleMouseMove)'), '不得残留旧 mousemove 拖拽清理逻辑');
assert(css.includes('.canvas-img-area.is-dragging'), '拖拽状态必须提供抓取光标反馈');
assert(css.includes('will-change: transform'), '图片变换必须启用合成层优化');

console.log('image canvas regression tests passed');
