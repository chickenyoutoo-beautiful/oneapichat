// update-check.js — 页面更新检测 + 硬刷新 (v1)
// ★ 场景: Chrome App / PWA 安装窗口 / 无地址栏环境没有浏览器刷新按钮,
//   且本项目未注册 Service Worker (sw.js 历史遗留), 旧 JS/CSS 缓存在本地拉不到新版本。
//   方案: 轮询 /oneapichat/api/version.php 对比 index.html 内容指纹 —
//   检测到更新 → 右下角弹出「🔄 新版本可用 · 点击刷新」胶囊按钮 (30s 自动隐藏)
//   设置面板「数据管理」另有常驻「强制刷新页面」按钮 (window.hardRefresh)
(function () {
    if (window.__updateCheckLoaded) return;
    window.__updateCheckLoaded = true;

    var POLL_MS = 60000;        // 轮询间隔
    var BTN_LIFETIME = 30000;   // 提示按钮自动隐藏时长
    var _initialHash = null;
    var _btn = null;
    var _hideTimer = null;
    var _removeTimer = null;
    var _lastCheck = 0;

    // ★ 硬刷新: 清空 Cache Storage + 注销遗留 SW + 给页面 URL 加版本戳。
    // location.reload() 可能继续复用内存中的旧 HTML/CSS；显式换 URL 才能保证
    // PWA/安装窗口/长期标签页真正重新导航到最新资源版本。
    window.hardRefresh = async function () {
        try {
            if ('caches' in window) {
                var keys = await caches.keys();
                await Promise.all(keys.map(function (k) { return caches.delete(k); }));
            }
        } catch (e) {}
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
                var registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map(function (registration) { return registration.unregister(); }));
            }
        } catch (e) {}
        var stamp = Date.now();
        try { localStorage.setItem('oac_force_refresh', stamp); } catch (e) {}
        try {
            var url = new URL(location.href);
            url.searchParams.set('_oacv', String(stamp));
            location.replace(url.toString());
        } catch (e) {
            location.href = location.pathname + '?_oacv=' + stamp + location.hash;
        }
    };

    function hideBtn(targetBtn) {
        var btn = targetBtn || _btn;
        if (!btn) return;
        if (_hideTimer) {
            clearTimeout(_hideTimer);
            _hideTimer = null;
        }
        btn.style.opacity = '0';
        btn.style.transform = 'translateY(8px)';
        if (_removeTimer) clearTimeout(_removeTimer);
        _removeTimer = setTimeout(function () {
            if (btn.isConnected) btn.remove();
            if (_btn === btn) _btn = null;
            _removeTimer = null;
        }, 300);
    }

    function showUpdateBtn() {
        if (_btn && _btn.isConnected) return;
        if (_btn && !_btn.isConnected) _btn = null;
        if (_hideTimer) clearTimeout(_hideTimer);
        if (_removeTimer) clearTimeout(_removeTimer);

        var btn = document.createElement('button');
        _btn = btn;
        btn.id = 'updateRefreshBtn';
        btn.type = 'button';
        btn.textContent = '🔄 新版本可用 · 点击刷新';
        btn.title = '检测到页面已更新, 点击强制刷新加载最新版本';
        btn.style.cssText =
            'position:fixed;right:16px;bottom:120px;z-index:3000;' +
            'padding:10px 18px;border:none;border-radius:999px;' +
            'font-size:13px;font-weight:600;color:#fff;cursor:pointer;' +
            'background:linear-gradient(135deg,#6366f1,#3b82f6);' +
            'box-shadow:0 6px 20px -6px rgba(99,102,241,0.6);' +
            'opacity:0;transform:translateY(8px);' +
            'transition:opacity .25s,transform .25s;';
        btn.onclick = function () { window.hardRefresh(); };
        var mount = document.body || document.documentElement;
        if (!mount) {
            _btn = null;
            return;
        }
        mount.appendChild(btn);
        requestAnimationFrame(function () {
            // 页面休眠/恢复或旧定时器执行时，按钮可能已经被移除或替换。
            if (_btn !== btn || !btn.isConnected) return;
            btn.style.opacity = '1';
            btn.style.transform = 'translateY(0)';
        });
        _hideTimer = setTimeout(function () { hideBtn(btn); }, BTN_LIFETIME);
    }

    function check() {
        var now = Date.now();
        if (now - _lastCheck < 10000) return;   // 节流: 至少间隔 10s
        _lastCheck = now;
        fetch('/oneapichat/api/version.php', { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || !d.ok) return;
                if (_initialHash === null) {
                    _initialHash = d.hash;
                    // 当前文档把自身资源版本写在链接中；若 index 指纹对应的版本已经
                    // 更新，但长期标签页仍加载旧 style.css，首次检查也必须提示刷新。
                    var currentStyle = document.querySelector('link[href*="/css/style.css"],link[href*="./css/style.css"]');
                    var loadedVersion = currentStyle && String(currentStyle.getAttribute('href') || '').match(/[?&]v=(\d+)/);
                    if (loadedVersion && d.style_v && String(d.style_v) !== loadedVersion[1]) showUpdateBtn();
                    return;
                }
                if (d.hash !== _initialHash) showUpdateBtn();
            })
            .catch(function () { /* 网络异常静默 */ });
    }

    // 页面从后台切回 / 重新显示时立即检查
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) check();
    });
    window.addEventListener('pageshow', check);
    setTimeout(check, 1500);          // 首屏延迟检查(若页面本身是旧的, 尽快提示)
    setInterval(check, POLL_MS);      // 常驻轮询
})();
