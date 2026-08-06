const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'main.js'),
    'utf8'
);

// 提取 setupKeyboardDetection 函数源码(括号配平, 独立于 main.js 其他顶层代码)
function extractFunction(src, name) {
    const start = src.indexOf('function ' + name + '() {');
    assert.ok(start >= 0, 'function ' + name + ' not found');
    const bodyStart = src.indexOf('{', start);
    let depth = 0;
    let i = bodyStart;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    return src.slice(start, i + 1);
}

// visualViewport 模拟: 可手动改高度/缩放, 事件默认不自动触发(模拟 iOS 事件丢失)
class FakeViewport {
    constructor() {
        this.width = 390;
        this.height = 780;
        this.offsetTop = 0;
        this.scale = 1;
        this._listeners = {};
    }
    addEventListener(type, fn) {
        (this._listeners[type] = this._listeners[type] || []).push(fn);
    }
    fire(type) {
        (this._listeners[type] || []).forEach(fn => fn({ type }));
    }
    // 正常派发 resize 事件
    resizeTo(height) { this.height = height; this.fire('resize'); }
    // ★ 直接改值但不派发事件 —— 模拟 iOS Safari 键盘收起时事件丢失
    silentResizeTo(height) { this.height = height; }
}

function boot() {
    const styles = {};
    let writeCount = 0;
    const classSet = new Set();
    const docListeners = {};
    const timers = { rafs: [], timeouts: [], intervals: [] };
    const viewport = new FakeViewport();

    let activeElement = null;
    const fakeInput = {
        matches(sel) { return sel.indexOf('textarea') !== -1; }
    };

    const document = {
        hidden: false,
        documentElement: {
            style: {
                setProperty(k, v) { styles[k] = v; writeCount++; }
            },
            classList: {
                toggle(c, on) { if (on) classSet.add(c); else classSet.delete(c); }
            }
        },
        activeElement: null,
        addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
        querySelector() { return null; }
    };
    Object.defineProperty(document, 'activeElement', {
        get: () => activeElement,
        set: v => { activeElement = v; },
        configurable: true
    });

    const fakeWindow = {
        visualViewport: viewport,
        __keyboardDetectionBound: false,
        addEventListener() {},
        matchMedia: () => ({ matches: true })   // 移动端: 注册看门狗+pointerup
    };

    const context = {
        console,
        window: fakeWindow,
        document,
        navigator: { maxTouchPoints: 5 },
        requestAnimationFrame: fn => { timers.rafs.push(fn); return timers.rafs.length; },
        setTimeout: (fn) => { timers.timeouts.push(fn); return timers.timeouts.length; },
        setInterval: (fn) => { timers.intervals.push(fn); return timers.intervals.length; },
        clearTimeout() {},
        clearInterval() {},
        keyboardActive: false,
        lastInnerHeight: 0,
        lastInnerWidth: 0,
        $: { configPanel: null }
    };
    vm.createContext(context);
    vm.runInContext(extractFunction(mainSource, 'setupKeyboardDetection') + '\n;setupKeyboardDetection();', context);

    // 按序执行所有已排队的 rAF 与定时器(含 settle/final 回稳), 直到队列清空
    function flushAll() {
        for (let guard = 0; guard < 20; guard++) {
            const rafs = timers.rafs.splice(0);
            const timeouts = timers.timeouts.splice(0);
            if (!rafs.length && !timeouts.length) break;
            rafs.forEach(fn => fn());
            timeouts.forEach(fn => fn());
        }
    }
    // 仅执行已排队的 rAF(模拟事件刚发生的那一帧)
    function flushRafsOnly() {
        timers.rafs.splice(0).forEach(fn => fn());
    }
    function runWatchdog() {
        timers.intervals.forEach(fn => fn());
        flushAll();
    }
    function focusInput() {
        activeElement = fakeInput;
        (docListeners['focusin'] || []).forEach(fn => fn({ target: fakeInput }));
        flushAll();
    }
    function clearFocus() {
        activeElement = null;
        (docListeners['focusout'] || []).forEach(fn => fn({}));
        flushAll();
    }

    return {
        viewport, styles, classSet, docListeners, flushAll, flushRafsOnly, runWatchdog, focusInput, clearFocus,
        get vvh() { return styles['--vvh']; },
        get kbHeight() { return styles['--keyboard-height']; },
        get keyboardOpenClass() { return classSet.has('keyboard-open'); },
        get writeCount() { return writeCount; }
    };
}

// ── 场景 1: 页面加载, 无焦点 → --vvh = 完整可视高度 ──
(function testInitialLoadFullHeight() {
    const h = boot();
    h.flushAll();
    assert.strictEqual(h.vvh, '780px', '初始 --vvh 应为完整可视高度 780px, 实际 ' + h.vvh);
    assert.strictEqual(h.keyboardOpenClass, false);
})();

// ── 场景 2: 键盘弹起 → --vvh 收缩为可视高度, 输入框被顶起 ──
(function testKeyboardOpenShrinksVvh() {
    const h = boot();
    h.flushAll();
    h.focusInput();
    h.viewport.resizeTo(400);   // 键盘弹起: 可视高度 780 → 400
    h.flushAll();
    assert.strictEqual(h.vvh, '400px', '键盘弹起时 --vvh 应为 400px, 实际 ' + h.vvh);
    assert.strictEqual(h.keyboardOpenClass, true, '应挂 keyboard-open class');
    assert.strictEqual(h.kbHeight, '380px', '--keyboard-height 应为 380px');
})();

// ── 场景 3 ★核心回归: 键盘收起但输入框保留焦点 + 无任何事件(点键盘「完成」/下滑) ──
//   旧代码 --vvh 永远卡在 400px → 输入框下方空出一大截; 看门狗必须在 1s 内自愈
(function testDismissNoEventWatchdogHeals() {
    const h = boot();
    h.flushAll();
    h.focusInput();
    h.viewport.resizeTo(400);
    h.flushAll();
    assert.strictEqual(h.vvh, '400px');

    // ★ iOS 不派发 resize 事件: 直接改高度, 焦点保留
    h.viewport.silentResizeTo(780);
    assert.strictEqual(h.vvh, '400px', '事件丢失瞬间 --vvh 仍停留在键盘弹起高度(模拟卡死状态)');

    h.runWatchdog();   // 1s 看门狗 tick
    assert.strictEqual(h.vvh, '780px', '看门狗必须恢复完整高度, 实际 ' + h.vvh);
    assert.strictEqual(h.keyboardOpenClass, false, 'keyboard-open class 应被移除');
    assert.strictEqual(h.kbHeight, '0px');
})();

// ── 场景 4: 焦点保留 + 事件丢失, 用户第一次点按(pointerup)也能立即恢复 ──
(function testPointerupRecovers() {
    const h = boot();
    h.flushAll();
    h.focusInput();
    h.viewport.resizeTo(400);
    h.flushAll();
    h.viewport.silentResizeTo(780);
    assert.strictEqual(h.vvh, '400px');
    (h.docListeners['pointerup'] || []).forEach(fn => fn({}));
    h.flushAll();
    assert.strictEqual(h.vvh, '780px', 'pointerup 后应恢复完整高度, 实际 ' + h.vvh);
})();

// ── 场景 5: 失焦(点页面空白) → focusout 路径恢复(键盘随失焦收起, 高度回到 780) ──
(function testBlurRecovers() {
    const h = boot();
    h.flushAll();
    h.focusInput();
    h.viewport.resizeTo(400);
    h.flushAll();
    h.viewport.silentResizeTo(780);   // 键盘随失焦收起(即使事件丢失也无妨)
    h.clearFocus();
    assert.strictEqual(h.vvh, '780px', '失焦后应恢复完整高度, 实际 ' + h.vvh);
})();

// ── 场景 6: 缩放稳定后不再冻结(旧逻辑 scale≠1 直接 return → 永久冻结) ──
(function testStableZoomAppliesScaledHeight() {
    const h = boot();
    h.flushAll();
    h.viewport.scale = 1.25;
    h.viewport.resizeTo(675);   // 844/1.25 ≈ 675 CSS px
    h.flushAll();
    assert.strictEqual(h.vvh, '675px', '缩放稳定后 --vvh 应跟随可视 CSS 高度 675px, 实际 ' + h.vvh);
})();

// ── 场景 7: 缩放进行中(scale 逐帧变化)本帧立即跳过, 缩放稳定后收敛到最终可视高度 ──
(function testPinchGestureSkipsFramesThenApplies() {
    const h = boot();
    h.flushAll();
    h.viewport.scale = 1.1;
    h.viewport.resizeTo(709);
    h.flushRafsOnly();   // 事件当帧: scale 变化 → 跳过, 布局不动
    assert.strictEqual(h.vvh, '780px', '缩放变化帧不应立即改动布局');
    h.flushAll();        // 回稳定时器(120/420ms)后跟随缩放后的可视 CSS 高度
    assert.strictEqual(h.vvh, '709px', '缩放稳定后应应用最终可视高度, 实际 ' + h.vvh);
    // 再次缩放并最终稳定 → 收敛到新值
    h.viewport.scale = 1.2;
    h.viewport.resizeTo(650);
    h.flushAll();
    assert.strictEqual(h.vvh, '650px', '连续缩放后应收敛到 650px, 实际 ' + h.vvh);
})();

// ── 场景 8: 脏检查 — 状态未变化时看门狗轮询不产生任何 DOM 写入 ──
(function testWatchdogDirtyCheckNoWrites() {
    const h = boot();
    h.flushAll();
    h.focusInput();
    h.viewport.resizeTo(400);
    h.flushAll();
    h.viewport.silentResizeTo(780);
    h.runWatchdog();   // 恢复
    assert.strictEqual(h.vvh, '780px');
    const before = h.writeCount;
    h.runWatchdog();   // 状态无变化
    h.runWatchdog();
    assert.strictEqual(h.writeCount, before, '状态未变化时看门狗不得写 DOM (脏检查失效)');
})();

console.log('keyboard_viewport: 8/8 场景通过');
