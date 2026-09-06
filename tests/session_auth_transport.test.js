// Session/auth transport regression tests: internal tokens, passwords, map keys and locations must not enter request URLs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function loadModule(name, localValues) {
    const calls = [];
    const ctx = {
        console, URLSearchParams, AbortSignal,
        localStorage: {
            getItem: key => Object.prototype.hasOwnProperty.call(localValues || {}, key) ? localValues[key] : '' ,
            setItem: () => {}
        },
        getSessionAuthHeaders: extra => Object.assign({ Authorization: 'Bearer session-test-token' }, extra || {}),
        fetch: async (url, options) => {
            calls.push({ url, options: options || {} });
            return { ok: true, status: 200, json: async () => ({ success: true, username: 'tester', courses: [] }) };
        },
        setInterval: () => 1, clearInterval: () => {}, showToast: () => {},
        window: null
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js', name), 'utf8'), ctx, { filename: name });
    return { ctx, calls };
}

(async () => {
    const core = fs.readFileSync(path.join(ROOT, 'public/js/core.js'), 'utf8');
    assert(core.includes('function getSessionAuthHeaders(extra)'), 'core must expose a shared session auth header helper');

    const net = loadModule('netdisk.js');
    await net.ctx.netdiskApiHandler('parse', { url: 'https://pan.example/s/abc', password: 'share-code' });
    assert.strictEqual(net.calls.length, 1);
    assert.strictEqual(net.calls[0].url, '/oneapichat/api/netdisk_api.php');
    assert.strictEqual(net.calls[0].options.method, 'POST');
    assert.strictEqual(net.calls[0].options.headers.Authorization, 'Bearer session-test-token');
    assert(!net.calls[0].url.includes('share-code') && !net.calls[0].url.includes('auth_token'), 'netdisk secrets must not be in URL');
    const netBody = new URLSearchParams(net.calls[0].options.body);
    assert.strictEqual(netBody.get('action'), 'parse');
    assert.strictEqual(netBody.get('password'), 'share-code');

    const amap = loadModule('amap.js', { amapKey: 'amap-secret-key' });
    await amap.ctx.amapApiHandler('geo', { address: 'private-address', city: 'Hangzhou' });
    assert.strictEqual(amap.calls.length, 1);
    assert.strictEqual(amap.calls[0].url, '/oneapichat/api/amap_api.php?action=geo');
    assert.strictEqual(amap.calls[0].options.method, 'POST');
    assert.strictEqual(amap.calls[0].options.headers.Authorization, 'Bearer session-test-token');
    assert.strictEqual(amap.calls[0].options.headers['X-Amap-Key'], 'amap-secret-key');
    assert(!amap.calls[0].url.includes('private-address') && !amap.calls[0].url.includes('amap-secret-key'), 'map key/location must not be in URL');
    const amapBody = new URLSearchParams(amap.calls[0].options.body);
    assert.strictEqual(amapBody.get('address'), 'private-address');

    const cx = loadModule('chaoxing-tools.js');
    await cx.ctx.chaoxingToolHandler('login', '', 'student-user', 'student-password');
    assert.strictEqual(cx.calls.length, 1);
    assert.strictEqual(cx.calls[0].url, '/oneapichat/api/chaoxing_api.php?action=login');
    assert.strictEqual(cx.calls[0].options.headers.Authorization, 'Bearer session-test-token');
    assert(!cx.calls[0].url.includes('student-user') && !cx.calls[0].url.includes('student-password'), 'Chaoxing credentials must not be in URL');
    const cxBody = new URLSearchParams(cx.calls[0].options.body);
    assert.strictEqual(cxBody.get('username'), 'student-user');
    assert.strictEqual(cxBody.get('password'), 'student-password');

    for (const name of ['chaoxing-tools.js', 'netdisk.js', 'amap.js']) {
        const src = fs.readFileSync(path.join(ROOT, 'public/js', name), 'utf8');
        assert(!src.includes('&auth_token='), name + ' must not construct auth_token query parameters');
    }

    const php = String.raw`require 'api/init.php'; require 'api/auth_helpers.php'; $_SERVER['HTTP_AUTHORIZATION']='Bearer header-token'; $_COOKIE['auth_token']='cookie-token'; $_GET['auth_token']='legacy-token'; echo extractSessionToken(true);`;
    const extracted = execFileSync('php', ['-r', php], { cwd: ROOT, encoding: 'utf8' }).trim();
    assert.strictEqual(extracted, 'header-token', 'Bearer token must take precedence over cookie/query fallback');

    for (const name of ['chaoxing_api.php', 'netdisk_api.php', 'amap_api.php', 'memory_api.php', 'auth.php']) {
        const src = fs.readFileSync(path.join(ROOT, 'api', name), 'utf8');
        assert(src.includes('extractSessionToken(true)'), name + ' must use shared session extraction');
    }

    const initSrc = fs.readFileSync(path.join(ROOT, 'public/js/init.js'), 'utf8');
    assert(!initSrc.includes("action=verify&token="), 'init.js must not send token in verify URL query');

    console.log('session auth transport/privacy regressions: ok');
})().catch(err => { console.error(err); process.exit(1); });
