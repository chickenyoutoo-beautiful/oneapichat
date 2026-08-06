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
    var _lastCheck = 0;

    // ★ 硬刷新: 清空 Cache Storage(含可能的 SW 缓存) + 标记 + reload
    window.hardRefresh = async function () {
        try {
            if ('caches' in window) {
                var keys = await caches.keys();
                await Promise.all(keys.map(function (k) { return caches.delete(k); }));
            }
        } catch (e) {}
        try { localStorage.setItem('oac_force_refresh', Date.now()); } catch (e) {}
        location.reload();
    };

    function hideBtn() {
        if (!_btn) return;
        _btn.style.opacity = '0';
        _btn.style.transform = 'translateY(8px)';
        setTimeout(function () { if (_btn) { _btn.remove(); _btn = null; } }, 300);
    }

    function showUpdateBtn() {
        if (_btn) return;
        _btn = document.createElement('button');
        _btn.id = 'updateRefreshBtn';
        _btn.type = 'button';
        _btn.textContent = '🔄 新版本可用 · 点击刷新';
        _btn.title = '检测到页面已更新, 点击强制刷新加载最新版本';
        _btn.style.cssText =
            'position:fixed;right:16px;bottom:120px;z-index:3000;' +
            'padding:10px 18px;border:none;border-radius:999px;' +
            'font-size:13px;font-weight:600;color:#fff;cursor:pointer;' +
            'background:linear-gradient(135deg,#6366f1,#3b82f6);' +
            'box-shadow:0 6px 20px -6px rgba(99,102,241,0.6);' +
            'opacity:0;transform:translateY(8px);' +
            'transition:opacity .25s,transform .25s;';
        _btn.onclick = function () { window.hardRefresh(); };
        document.body.appendChild(_btn);
        requestAnimationFrame(function () {
            _btn.style.opacity = '1';
            _btn.style.transform = 'translateY(0)';
        });
        setTimeout(hideBtn, BTN_LIFETIME);
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
                    _initialHash = d.hash;      // 首次加载记录基准指纹
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
