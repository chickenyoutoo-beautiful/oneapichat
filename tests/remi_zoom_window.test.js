// remi_zoom_window.test.js — 蕾米放大小窗 v2: 可缩放 + 稳定性加固
// 验证: 缩放数学/最小最大钳制/大小持久化/打开恢复大小/视口钳制(位置+尺寸)/
//       CSS [hidden] 守卫/handle 样式/HTML 手柄与 draggable=false
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const jsSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'model-status.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// 提取 model-status.js 第 5 节 (蕾米放大小窗) 源码
function extractZoomSection() {
    const startMark = '// 5) 蕾米放大小窗';
    const start = jsSrc.indexOf(startMark);
    assert.ok(start >= 0, '找不到放大小窗代码段');
    const endMark = 'setTimeout(updateAvatarVisibility, 1200);';
    const end = jsSrc.indexOf(endMark) + endMark.length;
    return jsSrc.slice(start, end);
}

// ── 极简 DOM 桩: 窗口/头部/手柄/关闭按钮/body/容器 ──
function makeClassList() {
    const set = {};
    return {
        add(c) { set[c] = true; },
        remove(c) { delete set[c]; },
        contains(c) { return !!set[c]; },
        _set: set
    };
}

function FakeEl(opts) {
    opts = opts || {};
    this.id = opts.id || '';
    this.hidden = !!opts.hidden;
    this.parentElement = opts.parentElement || null;
    this.style = {};
    this.textContent = '';
    this.title = '';
    this._handlers = {};
    this.classList = makeClassList();
    this._offsetW = opts.offsetWidth !== undefined ? opts.offsetWidth : 220;
    this._offsetH = opts.offsetHeight !== undefined ? opts.offsetHeight : 240;
    this._defaultTop = opts.defaultTop !== undefined ? opts.defaultTop : 100;
    const self = this;
    // offsetWidth/offsetHeight 跟随 style 变化, 供缩放数学读取
    Object.defineProperty(this, 'offsetWidth', {
        get() { return parseFloat(self.style.width) || self._offsetW; }
    });
    Object.defineProperty(this, 'offsetHeight', {
        get() { return parseFloat(self.style.height) || self._offsetH; }
    });
    this.getBoundingClientRect = function () {
        return {
            left: parseFloat(self.style.left) || 16,
            top: parseFloat(self.style.top) || self._defaultTop,
            width: parseFloat(self.style.width) || self._offsetW,
            height: parseFloat(self.style.height) || self._offsetH
        };
    };
    this.setPointerCapture = function () {};
    this.setAttribute = function () {};
    this.querySelector = function () { return null; };
    const children = opts.children || {};
    this.querySelector = function (sel) { return children[sel] || null; };
    this.querySelectorAll = function () { return []; };
    this.addEventListener = function (type, fn) {
        (this._handlers[type] = this._handlers[type] || []).push(fn);
    };
    this.fire = function (type, ev) {
        ev = ev || {};
        if (!ev.stopPropagation) ev.stopPropagation = function () {};
        if (!ev.preventDefault) ev.preventDefault = function () {};
        if (!ev.target) ev.target = this;
        const list = this._handlers[type] || [];
        for (let i = 0; i < list.length; i++) list[i].call(this, ev);
    };
}

function boot() {
    const vp = { width: 1280, height: 800 };
    const store = {};
    const body = new FakeEl({});
    const win = new FakeEl({ id: 'remi-zoom-window', hidden: true, parentElement: body });
    const header = new FakeEl({});
    const handle = new FakeEl({});
    const close = new FakeEl({});
    const zoomImg = new FakeEl({});
    const zoomTitle = new FakeEl({});
    win.querySelector = s => ({ '.remi-zoom-header': header, '.remi-zoom-resize': handle }[s] || null);

    const ids = {
        'remi-zoom-window': win,
        'remi-zoom-close': close,
        'remi-zoom-img': zoomImg,
        'remi-zoom-title': zoomTitle
    };
    const documentStub = {
        body,
        getElementById(id) { return ids[id] || null; },
        querySelector() { return null; },
        addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
        _handlers: {},
        createElement() { return new FakeEl({}); }
    };
    const windowStub = {
        get innerWidth() { return vp.width; },   // live getter, 测试可改 vp
        get innerHeight() { return vp.height; },
        visualViewport: { addEventListener() {} },
        addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
        _handlers: {},
        fire(type, ev) {
            const list = this._handlers[type] || [];
            for (let i = 0; i < list.length; i++) list[i].call(this, ev);
        }
    };
    const container = new FakeEl({});
    const localStorageStub = {
        getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem(k, v) { store[k] = String(v); },
        removeItem(k) { delete store[k]; },
        _store: store
    };
    const timers = [];
    const context = {
        console,
        document: documentStub,
        window: windowStub,
        localStorage: localStorageStub,
        container,
        setMood: function () {},
        updateAvatarVisibility: function () {},   // setTimeout 实参求值需要
        requestAnimationFrame(fn) { fn(); return 0; },   // 同步执行, 便于断言
        setTimeout(fn) { timers.push(fn); return timers.length; },
        setInterval() { return 0; }
    };
    vm.createContext(context);
    vm.runInContext(extractZoomSection(), context);
    return {
        vp, store, body, win, header, handle, close, zoomImg, zoomTitle,
        windowStub, documentStub, container, context, timers
    };
}

function ev(x, y) {
    return { clientX: x, clientY: y, pointerType: 'mouse', button: 0 };
}

// ── T1: 缩放基础 — 等比缩放 (dx 主导), 左上角锚定 ──
(function testResizeBasic() {
    const b = boot();
    b.handle.fire('pointerdown', ev(100, 100));
    assert.strictEqual(b.win.style.left, '16px', '缩放开始应锚定当前 left');
    assert.strictEqual(b.win.style.top, '100px', '缩放开始应锚定当前 top (防 bottom 定位跳位)');
    assert.strictEqual(b.win.style.bottom, 'auto', '缩放开始应清除 bottom 定位');
    b.handle.fire('pointermove', ev(180, 160));
    // dx=+80 主导 → scale=(220+80)/220=1.3636 → 宽 300, 高 240*1.3636=327 (等比, 非独立)
    assert.strictEqual(b.win.style.width, '300px', '宽度应随 dx=+80 增长 (220+80)');
    assert.strictEqual(b.win.style.height, '327px', '高度应按同一等比系数同步 (240×1.3636)');
    assert.ok(b.win.classList.contains('remi-zoom-resizing'), '缩放中应挂 resizing 类');
    console.log('✓ testResizeBasic');
})();

// ── T2: 等比钳制 — 缩放比同时满足两轴上下限 (96-420 / 112-560) ──
(function testResizeClamp() {
    const b = boot();
    b.handle.fire('pointerdown', ev(100, 100));
    b.handle.fire('pointermove', ev(3000, 3000));
    // scaleMax = min(420/220, 560/240) = 1.9091 → 宽 420, 高 240×1.9091=458
    assert.strictEqual(b.win.style.width, '420px', '超上限应钳到 420');
    assert.strictEqual(b.win.style.height, '458px', '高度应随同一上限等比 (240×1.9091)');
    b.handle.fire('pointermove', ev(-5000, -5000));
    // scaleMin = max(96/220, 112/240) = 0.4667 → 宽 103, 高 112
    assert.strictEqual(b.win.style.width, '103px', '低于下限应钳到等比最小宽 (220×0.4667)');
    assert.strictEqual(b.win.style.height, '112px', '高度应钳到等比最小高 (240×0.4667)');
    console.log('✓ testResizeClamp');
})();

// ── T3: 缩放结束持久化大小 (remiZoomSize, 等比) + resizing 类清理 ──
(function testResizePersist() {
    const b = boot();
    b.handle.fire('pointerdown', ev(100, 100));
    b.handle.fire('pointermove', ev(250, 240));
    b.handle.fire('pointerup', ev(250, 240));
    // dx=+150 主导 → scale=370/220=1.6818 → 高 240×1.6818=404
    assert.strictEqual(b.store.remiZoomSize, '{"width":370,"height":404}', 'pointerup 应保存等比缩放后大小');
    assert.ok(!b.win.classList.contains('remi-zoom-resizing'), '结束后应移除 resizing 类');
    console.log('✓ testResizePersist');
})();

// ── T4: 打开时恢复自定义大小 + 越界保存值钳制 ──
(function testOpenRestoresSize() {
    const b = boot();
    b.store.remiZoomPos = JSON.stringify({ left: 100, top: 200 });
    b.store.remiZoomSize = JSON.stringify({ width: 350, height: 400 });
    b.context.window.openRemiZoom();
    assert.strictEqual(b.win.style.width, '350px', '打开应恢复保存的宽度');
    assert.strictEqual(b.win.style.height, '400px', '打开应恢复保存的高度');
    assert.strictEqual(b.win.style.left, '100px', '打开应恢复保存的位置');
    assert.ok(!b.win.hidden, '打开后窗口应可见');

    // 越界保存值 (1000x10) → 钳制到 420/112
    const b2 = boot();
    b2.store.remiZoomSize = JSON.stringify({ width: 1000, height: 10 });
    b2.context.window.openRemiZoom();
    assert.strictEqual(b2.win.style.width, '420px', '过大的保存宽度应钳制');
    assert.strictEqual(b2.win.style.height, '112px', '过小的保存高度应钳制');
    console.log('✓ testOpenRestoresSize');
})();

// ── T5: 视口变化 → 位置钳回可视区 (静止态整体可见) ──
(function testViewportClampPosition() {
    const b = boot();
    b.context.window.openRemiZoom();   // 视口监听只在打开态生效
    // 窗口 300x300, 拖到右侧超出视口
    b.win.style.width = '300px';
    b.win.style.height = '300px';
    b.win.style.left = '1000px';   // 右边缘 1300 > 1280-8
    b.win.style.top = '900px';     // 底部越界
    b.windowStub.fire('resize');
    assert.strictEqual(b.win.style.left, '972px', '应钳回 1280-300-8=972');
    assert.strictEqual(b.win.style.top, '492px', '应钳回 800-300-8=492');
    assert.strictEqual(b.win.style.bottom, 'auto', '钳制后应切 top/left 定位');
    console.log('✓ testViewportClampPosition');
})();

// ── T6: 视口缩小 → 尺寸临时收缩 (键盘/旋转场景) ──
(function testViewportShrinkSize() {
    const b = boot();
    b.context.window.openRemiZoom();   // 视口监听只在打开态生效
    b.win.style.width = '420px';
    b.win.style.height = '560px';
    b.vp.width = 320;
    b.vp.height = 400;
    b.windowStub.fire('resize');
    assert.strictEqual(b.win.style.width, '304px', '宽应收缩到 320-16');
    assert.strictEqual(b.win.style.height, '384px', '高应收缩到 400-16');
    assert.strictEqual(b.store.remiZoomSize, undefined, '自动收缩不应持久化 (仅用户主动缩放落盘)');
    console.log('✓ testViewportShrinkSize');
})();

// ── T7: 拖动回归 — 位移跟随 + 屏外 56px 可抓回钳制 + 位置持久化 ──
(function testDragRegression() {
    const b = boot();
    b.header.fire('pointerdown', ev(100, 100));
    b.header.fire('pointermove', ev(300, 200));
    assert.strictEqual(b.win.style.left, '216px', '拖动应跟随 dx=+200');
    assert.strictEqual(b.win.style.top, '200px', '拖动应跟随 dy=+100');
    assert.strictEqual(b.win.style.bottom, 'auto', '拖动应切换 top/left 定位');
    // 拖出屏外 → 至少留 56px 可抓回
    b.header.fire('pointermove', ev(-5000, -5000));
    assert.strictEqual(b.win.style.left, '-156px', '左侧应允许部分在屏外 (8-220+56)');
    assert.strictEqual(b.win.style.top, '8px', '顶部应钳到 8');
    b.header.fire('pointerup', ev(-5000, -5000));
    const pos = JSON.parse(b.store.remiZoomPos);
    assert.strictEqual(pos.left, 8, '松开后应整体拉回可视区 (静止态不再允许部分在屏外)');
    assert.ok(!b.win.classList.contains('remi-zoom-dragging'), '结束后应移除 dragging 类');
    console.log('✓ testDragRegression');
})();

// ── T8: Esc 关闭 + 关闭状态清理 ──
(function testEscapeCloses() {
    const b = boot();
    b.context.window.openRemiZoom();
    const keyEv = { key: 'Escape', stopPropagation() {} };
    for (const fn of b.documentStub._handlers.keydown || []) fn(keyEv);
    assert.ok(b.win.hidden, 'Esc 应关闭小窗');
    assert.ok(!b.documentStub.body.classList.contains('remi-zoom-open'), '关闭应移除 body 类');
    assert.strictEqual(b.store.remiZoomOpen, undefined, '关闭应清除打开状态标记');
    console.log('✓ testEscapeCloses');
})();

// ── T9: CSS — [hidden] 守卫 (display:flex 不得压过隐藏态) ──
(function testCssHiddenGuard() {
    assert.ok(cssSrc.includes('.remi-zoom-window[hidden] { display: none !important; }'),
        'display:flex 后必须有 [hidden] 守卫, 否则 win.hidden 开关失效');
    assert.ok(/\.remi-zoom-window\s*\{[\s\S]*?display:\s*flex/.test(cssSrc), '窗口应为 flex 列布局');
    assert.ok(/\.remi-zoom-window\s*\{[\s\S]*?flex-direction:\s*column/.test(cssSrc), '窗口应为列布局');
    assert.ok(!cssSrc.includes('.remi-zoom-body img { width: 168px'), '移动端不应再有固定图片尺寸');
    console.log('✓ testCssHiddenGuard');
})();

// ── T10: CSS — 缩放手柄样式 + 图片流体缩放 ──
(function testCssResizeHandle() {
    const handleBlock = cssSrc.match(/\.remi-zoom-resize\s*\{[^}]*\}/);
    assert.ok(handleBlock, '应有 .remi-zoom-resize 规则');
    assert.ok(handleBlock[0].includes('cursor: nwse-resize'), '手柄应为斜向缩放光标');
    assert.ok(handleBlock[0].includes('touch-action: none'), '手柄应禁用触摸滚动');
    const imgBlock = cssSrc.match(/\.remi-zoom-body img\s*\{[^}]*\}/);
    assert.ok(imgBlock && imgBlock[0].includes('max-width: 100%') && imgBlock[0].includes('max-height: 100%'),
        '图片应随窗口流体缩放');
    assert.ok(imgBlock && imgBlock[0].includes('-webkit-user-drag: none'), '图片应禁止原生拖拽幽灵');
    const dragSel = cssSrc.includes('.remi-zoom-window.remi-zoom-dragging,\n.remi-zoom-window.remi-zoom-resizing');
    assert.ok(dragSel, 'dragging/resizing 应共享同款投影高亮');
    // ★ 动画重启回归守卫: 交互类不得含 animation:none — 移除类时 remi-zoom-in 会重新播放,
    //   getBoundingClientRect 读到 0.85x 缩放坐标 → 钳制数学全错 + 持久化小数位置
    const dragBlock = cssSrc.match(/\.remi-zoom-window\.remi-zoom-dragging,\s*\n\.remi-zoom-window\.remi-zoom-resizing\s*\{[^}]*\}/);
    assert.ok(dragBlock, '应能找到 dragging/resizing 合并规则');
    assert.ok(!dragBlock[0].includes('animation'), '交互类不得重启动画 (animation 属性)');
    console.log('✓ testCssResizeHandle');
})();

// ── T11: HTML — 手柄节点 + 图片禁拖 ──
(function testHtmlStructure() {
    assert.ok(htmlSrc.includes('class="remi-zoom-resize"'), 'index.html 应包含缩放手柄节点');
    assert.ok(htmlSrc.includes('title="拖动调整大小"'), '手柄应有调整大小提示');
    const avatarTag = htmlSrc.match(/<img id="remi-zoom-img"[^>]*>/);
    assert.ok(avatarTag && avatarTag[0].includes('remi-character-asset'), '小窗应使用高还原蕾米角色素材');
    assert.ok(avatarTag && avatarTag[0].includes('draggable="false"'), '蕾米素材应禁用原生拖拽');
    console.log('✓ testHtmlStructure');
})();

// ── T12: 玻璃背景仅悬停/触摸浮现 (v3) — 静止全透明, hover/active 才显示 ──
(function testCssHoverGlass() {
    const base = cssSrc.match(/\.remi-zoom-window\s*\{[^}]*\}/);
    assert.ok(base && base[0].includes('background: transparent'), '静止态背景应全透明');
    assert.ok(base && base[0].includes('backdrop-filter: none'), '静止态应无毛玻璃模糊');
    assert.ok(base && base[0].includes('box-shadow: none'), '静止态应无阴影');
    const hover = cssSrc.match(/\.remi-zoom-window:hover,\s*\n\.remi-zoom-window:active\s*\{[^}]*\}/);
    assert.ok(hover, '应有 hover/active 玻璃浮现规则');
    assert.ok(hover[0].includes('rgba(255, 255, 255, 0.4)'), '玻璃透明度必须明显低于 1 (0.92 在平色内容上是纯色)');
    assert.ok(!hover[0].includes('0.92'), '不得退回近不透明背景');
    assert.ok(hover[0].includes('blur(16px) saturate(1.5)'), '悬停应恢复毛玻璃模糊+饱和');
    assert.ok(cssSrc.includes('.dark .remi-zoom-window:hover'), '暗色模式玻璃应同样条件浮现');
    assert.ok(cssSrc.includes('rgba(17, 24, 39, 0.45)'), '暗色玻璃透明度同样明显低于 1');
    // 移动端更小下限 (84×96) + 默认 170px
    const mobile = cssSrc.match(/left: 10px;[\s\S]*?min-width: 84px;[\s\S]*?min-height: 96px;/);
    assert.ok(mobile, '移动端应支持缩小到 84×96');
    assert.ok(/left: 10px;[\s\S]*?width: 170px;/.test(cssSrc), '移动端默认宽度应 170px (原 200 太大)');
    // 标题/缩放手柄随玻璃一起浮现
    const hidden = cssSrc.match(/\.remi-zoom-header,\s*\n\.remi-zoom-resize::after\s*\{[^}]*\}/);
    assert.ok(hidden && hidden[0].includes('opacity: 0'), '标题/手柄静止态应隐藏');
    const reveal = cssSrc.match(/\.remi-zoom-window:hover \.remi-zoom-header,[\s\S]*?opacity: 1;\s*\}/);
    assert.ok(reveal, '悬停/按压时标题与手柄应随玻璃浮现');
    console.log('✓ testCssHoverGlass');
})();

console.log('\n✅ remi_zoom_window 全部通过 (12 组)');
