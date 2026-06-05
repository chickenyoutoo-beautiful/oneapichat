/* ============================================================
   AISniper OS — Main Application Logic
   ============================================================ */

window.OS = {
  windows: {},
  zIndexCounter: 100,
  activeWindowId: null,
  windowIdCounter: 0,
  bootTime: Date.now(),

  // ============================================================
  // Boot Sequence
  // ============================================================
  init() {
    // Boot -> Login
    setTimeout(() => {
      document.getElementById('boot-screen').classList.add('hidden');
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('login-pass').focus();
    }, 2400);

    // Login -> Desktop
    const tryLogin = () => {
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('desktop').classList.remove('hidden');
      document.getElementById('topbar').classList.remove('hidden');
      this.startClock();
      this.updateUptime();
      setInterval(() => this.updateUptime(), 60000);
    };
    document.getElementById('login-btn').addEventListener('click', tryLogin);
    document.getElementById('login-pass').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryLogin();
    });
    document.getElementById('login-pass').addEventListener('input', (e) => {
      if (e.target.value.length > 0) tryLogin();
    });
  },

  // ============================================================
  // Clock
  // ============================================================
  startClock() {
    const update = () => {
      const now = new Date();
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      const s = now.getSeconds().toString().padStart(2, '0');
      document.getElementById('topbar-clock').textContent = `${days[now.getDay()]} ${months[now.getMonth()]} ${now.getDate()} ${h}:${m}:${s}`;
    };
    update();
    setInterval(update, 1000);
  },

  updateUptime() {
    const elapsed = Date.now() - this.bootTime;
    const min = Math.floor(elapsed / 60000);
    const el = document.getElementById('uptime-display');
    if (el) el.textContent = `${Math.floor(min/60)}h ${min%60}m`;
    const about = document.getElementById('about-uptime');
    if (about) about.textContent = `${min} minute${min !== 1 ? 's' : ''}`;
  },

  // ============================================================
  // Window Manager
  // ============================================================
  openApp(appId) {
    // If already open, focus it
    if (this.windows[appId] && !this.windows[appId].minimized) {
      this.focusWindow(appId);
      return;
    }
    if (this.windows[appId] && this.windows[appId].minimized) {
      this.unminimize(appId);
      return;
    }
    const app = Apps[appId];
    if (!app) { console.warn('Unknown app:', appId); return; }

    const id = `${appId}_${++this.windowIdCounter}`;
    const w = app.defaultSize.w, h = app.defaultSize.h;
    const container = document.getElementById('window-container');
    const x = (container.clientWidth - w) / 2 + (Math.random() - 0.5) * 80;
    const y = (container.clientHeight - h) / 2 + (Math.random() - 0.5) * 60;

    const el = document.createElement('div');
    el.className = 'window';
    el.id = `win_${id}`;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.left = Math.max(20, x) + 'px';
    el.style.top = Math.max(20, y) + 'px';
    el.style.zIndex = ++this.zIndexCounter;
    el.innerHTML = `
      <div class="window-header" data-drag>
        <div class="traffic-lights">
          <button class="tl tl-close" data-action="close" title="Close"><svg width="6" height="6" viewBox="0 0 6 6"><line x1="1" y1="1" x2="5" y2="5"/><line x1="5" y1="1" x2="1" y2="5"/></svg></button>
          <button class="tl tl-min" data-action="minimize" title="Minimize"><svg width="6" height="6" viewBox="0 0 6 6"><line x1="1" y1="3" x2="5" y2="3"/></svg></button>
          <button class="tl tl-max" data-action="maximize" title="Zoom"><svg width="6" height="6" viewBox="0 0 6 6"><polyline points="1,1 5,1 5,5 1,5 1,1" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="0.6"/></svg></button>
        </div>
        <div class="window-title">${app.title}</div>
        <div class="window-actions"></div>
      </div>
      <div class="window-body" data-body></div>
      <div class="window-resizer"></div>
    `;
    container.appendChild(el);
    const body = el.querySelector('[data-body]');
    body.innerHTML = app.content();
    if (app.onMount) app.onMount(body);

    this.windows[id] = { el, appId, app, body, maximized: false, prev: null, minimized: false };
    this.makeDraggable(id);
    this.makeResizable(id);
    this.bindWindowControls(id);
    el.addEventListener('mousedown', () => this.focusWindow(id));

    this.focusWindow(id);
    this.setActiveAppName(app.title);

    // Mark dock as active
    document.querySelectorAll(`.dock-item[data-app="${appId}"]`).forEach(b => b.classList.add('active', 'running'));
  },

  bindWindowControls(id) {
    const win = this.windows[id];
    const el = win.el;
    el.querySelector('[data-action="close"]').addEventListener('click', (e) => {
      e.stopPropagation();
      el.classList.add('closing');
      setTimeout(() => {
        if (win.body._cleanup) win.body._cleanup();
        el.remove();
        delete this.windows[id];
        document.querySelectorAll(`.dock-item[data-app="${win.appId}"]`).forEach(b => {
          if (!Object.values(this.windows).some(w => w.appId === win.appId)) b.classList.remove('active', 'running');
        });
      }, 180);
    });
    el.querySelector('[data-action="minimize"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.minimize(id);
    });
    el.querySelector('[data-action="maximize"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMaximize(id);
    });
  },

  focusWindow(id) {
    const win = this.windows[id];
    if (!win) return;
    win.el.style.zIndex = ++this.zIndexCounter;
    this.activeWindowId = id;
    this.setActiveAppName(win.app.title);
  },

  minimize(id) {
    const win = this.windows[id];
    if (!win) return;
    win.minimized = true;
    win.el.classList.add('minimized');
  },

  unminimize(id) {
    const win = this.windows[id];
    if (!win) return;
    win.minimized = false;
    win.el.classList.remove('minimized');
    this.focusWindow(id);
  },

  toggleMaximize(id) {
    const win = this.windows[id];
    if (!win) return;
    const container = document.getElementById('window-container');
    if (win.maximized) {
      win.el.style.left = win.prev.left;
      win.el.style.top = win.prev.top;
      win.el.style.width = win.prev.w;
      win.el.style.height = win.prev.h;
      win.maximized = false;
    } else {
      win.prev = { left: win.el.style.left, top: win.el.style.top, w: win.el.style.width, h: win.el.style.height };
      win.el.style.left = '0px';
      win.el.style.top = '0px';
      win.el.style.width = container.clientWidth + 'px';
      win.el.style.height = container.clientHeight + 'px';
      win.maximized = true;
    }
  },

  setActiveAppName(name) {
    document.getElementById('active-app-name').textContent = name;
  },

  makeDraggable(id) {
    const win = this.windows[id];
    const header = win.el.querySelector('[data-drag]');
    let startX, startY, startL, startT, isDragging = false;

    const onDown = (e) => {
      if (e.target.closest('.traffic-lights')) return;
      if (win.maximized) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = win.el.getBoundingClientRect();
      startL = rect.left;
      startT = rect.top;
      this.focusWindow(id);
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      const newL = Math.max(-win.el.offsetWidth + 100, Math.min(window.innerWidth - 100, startL + dx));
      const newT = Math.max(0, Math.min(window.innerHeight - 80, startT + dy));
      win.el.style.left = newL + 'px';
      win.el.style.top = newT + 'px';
    };
    const onUp = () => { isDragging = false; };
    header.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    // Double-click header to maximize
    header.addEventListener('dblclick', (e) => {
      if (e.target.closest('.traffic-lights')) return;
      this.toggleMaximize(id);
    });
  },

  makeResizable(id) {
    const win = this.windows[id];
    const handle = win.el.querySelector('.window-resizer');
    let isResizing = false, startX, startY, startW, startH;
    handle.addEventListener('mousedown', (e) => {
      if (win.maximized) return;
      isResizing = true;
      startX = e.clientX; startY = e.clientY;
      startW = win.el.offsetWidth; startH = win.el.offsetHeight;
      this.focusWindow(id);
      e.stopPropagation(); e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const newW = Math.max(400, startW + (e.clientX - startX));
      const newH = Math.max(280, startH + (e.clientY - startY));
      win.el.style.width = newW + 'px';
      win.el.style.height = newH + 'px';
    });
    document.addEventListener('mouseup', () => isResizing = false);
  },

  // ============================================================
  // Top Menu Bar
  // ============================================================
  initTopbar() {
    // Apple menu
    document.getElementById('apple-menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu('apple-menu');
    });
    document.getElementById('apple-sleep').addEventListener('click', () => {
      this.hideAllMenus();
      document.getElementById('desktop').style.filter = 'brightness(0)';
      setTimeout(() => {
        document.getElementById('desktop').style.filter = 'brightness(1)';
        document.getElementById('desktop').style.transition = 'filter 1s';
      }, 100);
    });
    document.getElementById('apple-lockscreen').addEventListener('click', () => {
      this.hideAllMenus();
      document.getElementById('desktop').classList.add('hidden');
      document.getElementById('topbar').classList.add('hidden');
      Object.values(this.windows).forEach(w => w.el.style.display = 'none');
      document.getElementById('login-screen').classList.remove('hidden');
    });
    document.getElementById('apple-shutdown').addEventListener('click', () => {
      this.hideAllMenus();
      document.getElementById('boot-screen').classList.remove('hidden');
      document.getElementById('boot-screen').innerHTML = '<div class="boot-brand" style="color:#fff">Goodbye 👋</div>';
      document.getElementById('desktop').classList.add('hidden');
      document.getElementById('topbar').classList.add('hidden');
    });

    // Spotlight
    const spotlight = document.getElementById('spotlight');
    const spInput = document.getElementById('spotlight-input');
    const spResults = document.getElementById('spotlight-results');
    document.getElementById('search-btn').addEventListener('click', () => {
      spotlight.classList.toggle('hidden');
      spInput.value = '';
      spResults.innerHTML = '';
      if (!spotlight.classList.contains('hidden')) spInput.focus();
    });
    spInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) { spResults.innerHTML = ''; return; }
      const allApps = [
        { id: 'finder', title: 'Finder', sub: 'Application' },
        { id: 'calculator', title: 'Calculator', sub: 'Application' },
        { id: 'settings', title: 'System Settings', sub: 'Application' },
        { id: 'terminal', title: 'Terminal', sub: 'Application' },
        { id: 'shooter', title: 'Space Shooter 3D', sub: 'Game' },
        { id: 'about', title: 'About This Mac', sub: 'System' },
      ];
      const matches = allApps.filter(a => a.title.toLowerCase().includes(q) || a.sub.toLowerCase().includes(q));
      if (matches.length === 0) {
        spResults.innerHTML = '<div class="sp-item"><div class="sp-item-text"><div class="sp-item-sub">No results</div></div></div>';
      } else {
        spResults.innerHTML = matches.map((m, i) => `
          <div class="sp-item${i === 0 ? ' active' : ''}" data-app="${m.id}">
            <div class="sp-item-icon">${this.getAppEmoji(m.id)}</div>
            <div class="sp-item-text">
              <div class="sp-item-title">${m.title}</div>
              <div class="sp-item-sub">${m.sub}</div>
            </div>
          </div>
        `).join('');
        spResults.querySelectorAll('.sp-item').forEach(it => {
          it.addEventListener('click', () => {
            this.openApp(it.dataset.app);
            spotlight.classList.add('hidden');
          });
        });
      }
    });
    spInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const active = spResults.querySelector('.sp-item.active') || spResults.querySelector('.sp-item');
        if (active) { this.openApp(active.dataset.app); spotlight.classList.add('hidden'); }
      } else if (e.key === 'Escape') {
        spotlight.classList.add('hidden');
      }
    });

    // Control Center
    const cc = document.getElementById('control-center');
    document.getElementById('control-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideAllMenus();
      const rect = document.getElementById('control-btn').getBoundingClientRect();
      cc.style.top = (rect.bottom + 8) + 'px';
      cc.style.right = (window.innerWidth - rect.right) + 'px';
      cc.classList.toggle('hidden');
    });

    // CC tile interactions
    document.querySelectorAll('#control-center .cc-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        if (tile.classList.contains('cc-toggle') && !tile.classList.contains('cc-tile-wide')) {
          tile.classList.toggle('active');
        }
        if (tile.dataset.id === 'health') {
          this.openApp('about');
        }
        if (tile.dataset.id === 'theme') {
          document.body.classList.toggle('theme-dark');
        }
        if (tile.dataset.id === 'focus') {
          tile.classList.toggle('active');
        }
      });
    });

    // Wi-Fi button top bar
    document.getElementById('wifi-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideAllMenus();
      const rect = document.getElementById('wifi-btn').getBoundingClientRect();
      cc.style.top = (rect.bottom + 8) + 'px';
      cc.style.right = (window.innerWidth - rect.right) + 'px';
      cc.classList.remove('hidden');
      // Scroll to Wi-Fi
      setTimeout(() => {
        const wifiTile = document.querySelector('[data-id="wifi"]');
        wifiTile?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    });

    // Battery button
    document.getElementById('battery-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideAllMenus();
      const rect = document.getElementById('battery-btn').getBoundingClientRect();
      cc.style.top = (rect.bottom + 8) + 'px';
      cc.style.right = (window.innerWidth - rect.right) + 'px';
      cc.classList.remove('hidden');
    });

    // Topbar clock to show calendar
    document.getElementById('topbar-clock').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleNotifCenter();
    });
  },

  getAppEmoji(id) {
    return { finder: '📁', calculator: '🧮', settings: '⚙️', terminal: '⌨️', shooter: '🚀', about: 'ℹ️' }[id] || '📦';
  },

  hideAllMenus() {
    document.getElementById('apple-menu').classList.add('hidden');
    document.getElementById('control-center').classList.add('hidden');
    document.getElementById('notif-center').classList.add('hidden');
    document.getElementById('spotlight').classList.add('hidden');
    document.getElementById('context-menu').classList.add('hidden');
  },

  toggleMenu(id) {
    const m = document.getElementById(id);
    const wasHidden = m.classList.contains('hidden');
    this.hideAllMenus();
    if (wasHidden) m.classList.remove('hidden');
  },

  toggleNotifCenter() {
    const nc = document.getElementById('notif-center');
    const wasHidden = nc.classList.contains('hidden');
    this.hideAllMenus();
    if (wasHidden) {
      nc.classList.remove('hidden');
      // Position
      nc.style.top = '34px';
    }
  },

  // ============================================================
  // Dock
  // ============================================================
  initDock() {
    document.querySelectorAll('.dock-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const app = btn.dataset.app;
        if (app === 'trash') {
          this.openApp('finder');
          return;
        }
        this.openApp(app);
      });
    });
  },

  // ============================================================
  // Desktop
  // ============================================================
  initDesktop() {
    const desktop = document.getElementById('desktop');
    document.querySelectorAll('.desktop-icon').forEach(icon => {
      icon.addEventListener('dblclick', () => this.openApp(icon.dataset.app));
      icon.addEventListener('click', (e) => {
        document.querySelectorAll('.desktop-icon').forEach(i => i.classList.remove('selected'));
        icon.classList.add('selected');
        e.stopPropagation();
      });
    });

    // Desktop click to deselect
    desktop.addEventListener('click', (e) => {
      if (e.target === desktop || e.target.classList.contains('desktop-icons')) {
        document.querySelectorAll('.desktop-icon').forEach(i => i.classList.remove('selected'));
        this.hideAllMenus();
      }
    });

    // Right click context menu
    desktop.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY);
    });
  },

  showContextMenu(x, y) {
    const menu = document.getElementById('context-menu');
    menu.innerHTML = `
      <div class="menu-item" data-act="new-folder">📁 New Folder</div>
      <div class="menu-sep"></div>
      <div class="menu-item" data-act="change-wallpaper">🖼️ Change Wallpaper…</div>
      <div class="menu-item" data-act="toggle-theme">🌗 Toggle Dark Mode</div>
      <div class="menu-sep"></div>
      <div class="menu-item" data-act="open-finder">📂 Open Finder</div>
      <div class="menu-item" data-act="open-terminal">⌨️ Open Terminal</div>
      <div class="menu-sep"></div>
      <div class="menu-item" data-act="refresh">🔄 Refresh</div>
    `;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.remove('hidden');
    menu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const act = item.dataset.act;
        switch (act) {
          case 'change-wallpaper': this.openApp('settings'); break;
          case 'toggle-theme': document.body.classList.toggle('theme-dark'); break;
          case 'open-finder': this.openApp('finder'); break;
          case 'open-terminal': this.openApp('terminal'); break;
          case 'refresh': location.reload(); break;
          case 'new-folder': this.notify('📁 New Folder', 'Created on desktop'); break;
        }
        menu.classList.add('hidden');
      });
    });
  },

  // ============================================================
  // Notifications
  // ============================================================
  notify(title, msg) {
    const list = document.getElementById('notif-list');
    const card = document.createElement('div');
    card.className = 'notif-card';
    const colors = ['#5af78e','#5ac8fa','#ff9500','#ff5b5b','#bf5af2'];
    card.innerHTML = `
      <div class="notif-dot" style="background:${colors[Math.floor(Math.random()*colors.length)]}"></div>
      <div class="notif-body">
        <div class="notif-title">${title}</div>
        <div class="notif-msg">${msg}</div>
        <div class="notif-time">just now</div>
      </div>
    `;
    list.insertBefore(card, list.firstChild);
  },

  // ============================================================
  // Global Event Listeners
  // ============================================================
  initGlobal() {
    document.addEventListener('click', (e) => {
      // Close menus on outside click
      if (!e.target.closest('.dropdown-menu') && !e.target.closest('#apple-menu-btn')) {
        document.getElementById('apple-menu').classList.add('hidden');
      }
      if (!e.target.closest('.control-center') && !e.target.closest('#control-btn') && !e.target.closest('#wifi-btn') && !e.target.closest('#battery-btn')) {
        document.getElementById('control-center').classList.add('hidden');
      }
      if (!e.target.closest('.spotlight') && !e.target.closest('#search-btn')) {
        document.getElementById('spotlight').classList.add('hidden');
      }
      if (!e.target.closest('.context-menu')) {
        document.getElementById('context-menu').classList.add('hidden');
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Cmd+Space for Spotlight
      if ((e.metaKey || e.ctrlKey) && e.code === 'Space') {
        e.preventDefault();
        const sp = document.getElementById('spotlight');
        sp.classList.toggle('hidden');
        if (!sp.classList.contains('hidden')) document.getElementById('spotlight-input').focus();
      }
      // Cmd+W close window
      if ((e.metaKey || e.ctrlKey) && e.key === 'w' && this.activeWindowId) {
        e.preventDefault();
        const win = this.windows[this.activeWindowId];
        if (win) win.el.querySelector('[data-action="close"]').click();
      }
      // Cmd+M minimize
      if ((e.metaKey || e.ctrlKey) && e.key === 'm' && this.activeWindowId) {
        e.preventDefault();
        this.minimize(this.activeWindowId);
      }
      // Cmd+Q quit
      if ((e.metaKey || e.ctrlKey) && e.key === 'q') {
        e.preventDefault();
        if (this.activeWindowId) {
          const win = this.windows[this.activeWindowId];
          if (win) win.el.querySelector('[data-action="close"]').click();
        }
      }
    });
  },

  // ============================================================
  // Battery animation
  // ============================================================
  initBattery() {
    let pct = 87;
    setInterval(() => {
      pct -= 0.01;
      if (pct < 20) pct = 87;
      const el = document.querySelector('.battery-pct');
      if (el) el.textContent = Math.floor(pct) + '%';
    }, 5000);
  }
};

// ============================================================
// Bootstrap
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  window.OS.init();
  window.OS.initTopbar();
  window.OS.initDock();
  window.OS.initDesktop();
  window.OS.initGlobal();
  window.OS.initBattery();

  // Welcome notification after login
  setTimeout(() => {
    window.OS?.notify?.('🎯 Welcome to AISniper OS', 'Click the dock icons to explore apps. Try Space Shooter 3D!');
  }, 5000);

  // Live system health simulation
  setInterval(() => {
    const cpu = 25 + Math.random() * 30;
    const mem = 50 + Math.random() * 10;
    const cpuEl = document.querySelector('#cc-health-fill');
    if (cpuEl) {
      const h = 80 + Math.random() * 15;
      cpuEl.style.width = h + '%';
      const txt = document.querySelector('#cc-health-text');
      if (txt) txt.textContent = (h > 90 ? 'Excellent' : h > 70 ? 'Good' : 'Fair') + ' · ' + Math.floor(h) + '%';
    }
  }, 3000);
});
