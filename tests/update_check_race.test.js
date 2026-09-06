const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/js/update-check.js', 'utf8');
const timeouts = [];
const rafCallbacks = [];
const windowListeners = {};
let now = 20000;
let nextTimerId = 1;
const hashes = ['hash-a', 'hash-b'];

function addTimer(fn, ms) {
    const timer = { id: nextTimerId++, fn, ms, cancelled: false };
    timeouts.push(timer);
    return timer.id;
}

const document = {
    hidden: false,
    body: {
        appendChild(node) {
            node.isConnected = true;
        }
    },
    documentElement: null,
    addEventListener() {},
    createElement() {
        return {
            style: {},
            isConnected: false,
            remove() { this.isConnected = false; }
        };
    }
};

const context = {
    console,
    Promise,
    Date: { now: () => now },
    document,
    location: { reload() {} },
    localStorage: { setItem() {} },
    fetch() {
        const hash = hashes.shift() || 'hash-b';
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, hash }) });
    },
    requestAnimationFrame(fn) {
        rafCallbacks.push(fn);
    },
    setTimeout: addTimer,
    clearTimeout(id) {
        const timer = timeouts.find(item => item.id === id);
        if (timer) timer.cancelled = true;
    },
    setInterval() { return 1; },
    caches: { keys: async () => [], delete: async () => true }
};
context.window = context;
context.window.addEventListener = function (name, fn) {
    windowListeners[name] = fn;
};

function flushPromises() {
    return new Promise(resolve => setImmediate(resolve));
}

(async () => {
    vm.runInNewContext(source, context, { filename: 'update-check.js' });

    const initialCheck = timeouts.find(timer => timer.ms === 1500);
    assert(initialCheck, 'initial update check timer should be registered');
    initialCheck.fn();
    await flushPromises();
    await flushPromises();

    now = 40000;
    assert(windowListeners.pageshow, 'pageshow listener should be registered');
    windowListeners.pageshow();
    await flushPromises();
    await flushPromises();

    assert.strictEqual(rafCallbacks.length, 1, 'update button should schedule one animation frame');
    const hideTimer = timeouts.find(timer => timer.ms === 30000);
    assert(hideTimer, 'update button hide timer should be registered');

    // 模拟页面长时间休眠后恢复：定时器先清理按钮，RAF 回调随后执行。
    hideTimer.fn();
    const removeTimer = timeouts.find(timer => timer.ms === 300);
    assert(removeTimer, 'button removal timer should be registered');
    removeTimer.fn();

    assert.doesNotThrow(() => rafCallbacks[0](), 'stale RAF callback must not access a cleared button');
    console.log('update_check_race.test.js: all assertions passed');
})().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
