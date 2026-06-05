/* ============================================================
   AISniper OS — Applications
   ============================================================ */

const Apps = {};

/* ============================================================
   Finder
   ============================================================ */
Apps.finder = {
  id: 'finder',
  title: 'Finder',
  defaultSize: { w: 780, h: 520 },
  content() {
    const files = [
      { icon: '📁', name: 'Projects' },
      { icon: '📁', name: 'Documents' },
      { icon: '📁', name: 'Downloads' },
      { icon: '📁', name: 'Pictures' },
      { icon: '📁', name: 'Music' },
      { icon: '📁', name: 'Movies' },
      { icon: '📄', name: 'README.md' },
      { icon: '📊', name: 'Quarterly Report.xlsx' },
      { icon: '🖼️', name: 'Wallpaper.png' },
      { icon: '🎬', name: 'Demo Reel.mp4' },
      { icon: '💻', name: 'main.js' },
      { icon: '📦', name: 'package.json' },
      { icon: '🗒️', name: 'Notes.txt' },
      { icon: '🎨', name: 'design.fig' },
    ];
    return `
      <div class="finder">
        <div class="finder-sidebar">
          <h4>Favorites</h4>
          <div class="sb-item active"><span class="ic">🏠</span> Home</div>
          <div class="sb-item"><span class="ic">💼</span> Work</div>
          <div class="sb-item"><span class="ic">📥</span> Downloads</div>
          <div class="sb-item"><span class="ic">🖼️</span> Pictures</div>
          <h4>iCloud</h4>
          <div class="sb-item"><span class="ic">☁️</span> iCloud Drive</div>
          <div class="sb-item"><span class="ic">🗂️</span> Shared</div>
          <h4>Locations</h4>
          <div class="sb-item"><span class="ic">💻</span> Macintosh HD</div>
          <div class="sb-item"><span class="ic">🌐</span> Network</div>
        </div>
        <div class="finder-main">
          <div class="finder-toolbar">
            <button>◀</button>
            <button>▶</button>
            <button>↑</button>
            <input class="search" placeholder="Search" />
            <button>View</button>
            <button>Group</button>
            <button>Share</button>
          </div>
          <div class="finder-content">
            <div style="font-size:11px;opacity:0.6;margin-bottom:12px;">Home · 14 items · 2.4 GB available</div>
            <div class="finder-grid">
              ${files.map(f => `
                <div class="finder-file">
                  <div class="ff-icon">${f.icon}</div>
                  <div class="ff-name">${f.name}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }
};

/* ============================================================
   Calculator
   ============================================================ */
Apps.calculator = {
  id: 'calculator',
  title: 'Calculator',
  defaultSize: { w: 320, h: 460 },
  content() {
    return `
      <div class="calculator" id="calc-app">
        <div class="calc-display">
          <div class="calc-prev" id="calc-prev"></div>
          <div class="calc-curr" id="calc-curr">0</div>
        </div>
        <div class="calc-grid">
          <button class="calc-btn gray" data-action="clear">AC</button>
          <button class="calc-btn gray" data-action="neg">+/−</button>
          <button class="calc-btn gray" data-action="pct">%</button>
          <button class="calc-btn orange" data-action="op" data-op="÷">÷</button>
          <button class="calc-btn" data-num="7">7</button>
          <button class="calc-btn" data-num="8">8</button>
          <button class="calc-btn" data-num="9">9</button>
          <button class="calc-btn orange" data-action="op" data-op="×">×</button>
          <button class="calc-btn" data-num="4">4</button>
          <button class="calc-btn" data-num="5">5</button>
          <button class="calc-btn" data-num="6">6</button>
          <button class="calc-btn orange" data-action="op" data-op="−">−</button>
          <button class="calc-btn" data-num="1">1</button>
          <button class="calc-btn" data-num="2">2</button>
          <button class="calc-btn" data-num="3">3</button>
          <button class="calc-btn orange" data-action="op" data-op="+">+</button>
          <button class="calc-btn zero" data-num="0">0</button>
          <button class="calc-btn" data-num=".">.</button>
          <button class="calc-btn orange" data-action="eq">=</button>
        </div>
      </div>
    `;
  },
  onMount(body) {
    const prevEl = body.querySelector('#calc-prev');
    const currEl = body.querySelector('#calc-curr');
    const dockPrev = document.querySelector('#dock-calc-prev');
    let curr = '0', prev = '', op = null, justEvaluated = false;

    const update = () => {
      currEl.textContent = curr.length > 12 ? Number(curr).toExponential(6) : curr;
      prevEl.textContent = prev;
      if (dockPrev) dockPrev.textContent = curr.length > 8 ? Number(curr).toExponential(3) : curr;
    };

    const fmt = n => {
      if (n === Infinity || n === -Infinity || isNaN(n)) return 'Error';
      const s = String(n);
      return s.length > 12 ? Number(n).toExponential(6) : s;
    };

    const calc = (a, o, b) => {
      a = parseFloat(a); b = parseFloat(b);
      switch (o) {
        case '+': return a + b;
        case '−': return a - b;
        case '×': return a * b;
        case '÷': return b === 0 ? 'Error' : a / b;
        default: return b;
      }
    };

    body.querySelectorAll('.calc-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const n = btn.dataset.num, action = btn.dataset.action, o = btn.dataset.op;
        body.querySelectorAll('.calc-btn.orange').forEach(b => b.classList.remove('active'));
        if (n !== undefined) {
          if (justEvaluated) { curr = n === '.' ? '0.' : n; justEvaluated = false; }
          else if (n === '.' && curr.includes('.')) return;
          else curr = curr === '0' && n !== '.' ? n : curr + n;
        } else if (action === 'clear') {
          curr = '0'; prev = ''; op = null;
        } else if (action === 'neg') {
          curr = curr.startsWith('-') ? curr.slice(1) : (curr !== '0' ? '-' + curr : curr);
        } else if (action === 'pct') {
          curr = fmt(parseFloat(curr) / 100);
        } else if (action === 'op') {
          if (op && prev) {
            const r = calc(prev, op, curr);
            if (r === 'Error') { curr = 'Error'; prev = ''; op = null; update(); return; }
            prev = `${fmt(prev)} ${op} ${fmt(curr)} =`;
            curr = fmt(r);
          } else {
            prev = `${fmt(curr)} ${o}`;
          }
          op = o; justEvaluated = false; curr = '0';
          btn.classList.add('active');
        } else if (action === 'eq') {
          if (op && prev) {
            const r = calc(prev.split(' ')[0], op, curr);
            prev = `${prev} ${fmt(curr)} =`;
            curr = fmt(r); op = null; justEvaluated = true;
          }
        }
        update();
      });
    });
    // Keyboard support
    const onKey = (e) => {
      const map = { '0':'0','1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9','.':'.' };
      const target = body.querySelector('.calculator');
      if (!target || !body.isConnected) return;
      if (map[e.key] !== undefined) body.querySelector(`[data-num="${map[e.key]}"]`)?.click();
      else if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') {
        const o = e.key === '*' ? '×' : e.key === '/' ? '÷' : e.key;
        body.querySelector(`[data-op="${o}"]`)?.click();
      } else if (e.key === 'Enter' || e.key === '=') body.querySelector('[data-action="eq"]')?.click();
      else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') body.querySelector('[data-action="clear"]')?.click();
      else if (e.key === '%') body.querySelector('[data-action="pct"]')?.click();
      else if (e.key === 'Backspace') curr = curr.length > 1 ? curr.slice(0, -1) : '0', update();
    };
    document.addEventListener('keydown', onKey);
    body._cleanup = () => document.removeEventListener('keydown', onKey);
  }
};

/* ============================================================
   Settings
   ============================================================ */
Apps.settings = {
  id: 'settings',
  title: 'System Settings',
  defaultSize: { w: 820, h: 560 },
  content() {
    return `
      <div class="settings">
        <div class="settings-sidebar">
          <h4>Personalization</h4>
          <div class="st-item active" data-pane="appearance"><div class="ic" style="background:linear-gradient(135deg,#5ac8fa,#007aff)">🎨</div>Appearance</div>
          <div class="st-item" data-pane="wallpaper"><div class="ic" style="background:linear-gradient(135deg,#ff6b6b,#ffa500)">🖼️</div>Wallpaper</div>
          <div class="st-item" data-pane="display"><div class="ic" style="background:linear-gradient(135deg,#5856d6,#af52de)">🖥️</div>Display</div>
          <h4>Network</h4>
          <div class="st-item" data-pane="wifi"><div class="ic" style="background:linear-gradient(135deg,#34c759,#30d158)">📶</div>Wi-Fi</div>
          <div class="st-item" data-pane="bluetooth"><div class="ic" style="background:linear-gradient(135deg,#0a84ff,#5ac8fa)">🔵</div>Bluetooth</div>
          <h4>System</h4>
          <div class="st-item" data-pane="health"><div class="ic" style="background:linear-gradient(135deg,#ff9500,#ffcc00)">❤️</div>System Health</div>
          <div class="st-item" data-pane="storage"><div class="ic" style="background:linear-gradient(135deg,#8e8e93,#c7c7cc)">💾</div>Storage</div>
          <div class="st-item" data-pane="about"><div class="ic" style="background:linear-gradient(135deg,#1d1d1f,#48484a)">ⓘ</div>About</div>
        </div>
        <div class="settings-main" id="settings-main">
          ${settingsPane('appearance')}
        </div>
      </div>
    `;
  },
  onMount(body) {
    const main = body.querySelector('#settings-main');
    body.querySelectorAll('.st-item').forEach(item => {
      item.addEventListener('click', () => {
        body.querySelectorAll('.st-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const pane = item.dataset.pane;
        main.innerHTML = settingsPane(pane);
        bindPane(main, body);
      });
    });
    bindPane(main, body);
  }
};

function settingsPane(pane) {
  switch (pane) {
    case 'appearance':
      return `
        <h2>Appearance</h2>
        <div class="settings-section">
          <div class="settings-row">
            <label>Dark Mode</label>
            <div class="ctrl">
              <div class="toggle-switch" id="dark-toggle"></div>
            </div>
          </div>
          <div class="settings-row">
            <label>Accent Color</label>
            <div class="ctrl theme-picker" id="accent-picker">
              <div class="swatch" style="width:22px;height:22px;border-radius:50%;background:#0a84ff;cursor:pointer;border:2px solid transparent" data-accent="#0a84ff"></div>
              <div class="swatch" style="width:22px;height:22px;border-radius:50%;background:#ff375f;cursor:pointer;border:2px solid transparent" data-accent="#ff375f"></div>
              <div class="swatch" style="width:22px;height:22px;border-radius:50%;background:#ff9f0a;cursor:pointer;border:2px solid transparent" data-accent="#ff9f0a"></div>
              <div class="swatch" style="width:22px;height:22px;border-radius:50%;background:#30d158;cursor:pointer;border:2px solid transparent" data-accent="#30d158"></div>
              <div class="swatch" style="width:22px;height:22px;border-radius:50%;background:#bf5af2;cursor:pointer;border:2px solid transparent" data-accent="#bf5af2"></div>
            </div>
          </div>
          <div class="settings-row">
            <label>Reduce Transparency</label>
            <div class="ctrl"><div class="toggle-switch"></div></div>
          </div>
          <div class="settings-row">
            <label>Increase Contrast</label>
            <div class="ctrl"><div class="toggle-switch"></div></div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-row">
            <label>Sidebar Icon Size</label>
            <div class="ctrl">Medium</div>
          </div>
          <div class="settings-row">
            <label>Highlight Color</label>
            <div class="ctrl">Accent Color</div>
          </div>
        </div>
      `;
    case 'wallpaper':
      return `
        <h2>Wallpaper</h2>
        <div class="settings-section">
          <p style="font-size:12px;opacity:0.7;margin-bottom:10px;">Dynamic wallpapers inspired by macOS</p>
          <div class="wallpaper-picker" id="wp-picker">
            <div class="wp-thumb selected" data-wp="sonoma" style="background:linear-gradient(180deg,#ff9a8b,#ff6a88)"></div>
            <div class="wp-thumb" data-wp="sequoia" style="background:linear-gradient(180deg,#fbc2eb,#a6c1ee)"></div>
            <div class="wp-thumb" data-wp="bigsur" style="background:linear-gradient(180deg,#ff6b6b,#4a90e2)"></div>
            <div class="wp-thumb" data-wp="monterey" style="background:linear-gradient(160deg,#1a4a8e,#0a2a5e)"></div>
            <div class="wp-thumb" data-wp="ventura" style="background:linear-gradient(180deg,#4a90e2,#2c5fa3)"></div>
            <div class="wp-thumb" data-wp="sonoma" data-dark="1" style="background:linear-gradient(180deg,#2c1a2e,#0a0a1e)"></div>
          </div>
        </div>
      `;
    case 'display':
      return `
        <h2>Display</h2>
        <div class="settings-section">
          <div class="settings-row">
            <label>Brightness</label>
            <div class="ctrl" style="width:200px"><input type="range" min="20" max="100" value="80" style="width:100%" id="brightness-range" /></div>
          </div>
          <div class="settings-row">
            <label>True Tone</label>
            <div class="ctrl"><div class="toggle-switch on"></div></div>
          </div>
          <div class="settings-row">
            <label>Night Shift</label>
            <div class="ctrl"><div class="toggle-switch"></div> <span style="font-size:12px;opacity:0.6">Off</span></div>
          </div>
          <div class="settings-row">
            <label>Resolution</label>
            <div class="ctrl">2560 × 1600 (Default)</div>
          </div>
          <div class="settings-row">
            <label>Refresh Rate</label>
            <div class="ctrl">ProMotion (120 Hz)</div>
          </div>
        </div>
      `;
    case 'wifi':
      return `
        <h2>Wi-Fi</h2>
        <div class="settings-section">
          <div class="settings-row">
            <label>Wi-Fi</label>
            <div class="ctrl"><div class="toggle-switch on" id="wifi-toggle"></div></div>
          </div>
          <div style="margin-top:10px">
            <div style="font-size:11px;opacity:0.6;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Network</div>
            <div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(10,132,255,0.1);border-radius:8px;border:0.5px solid rgba(10,132,255,0.3)">
              <div style="font-size:18px;color:#0a84ff">📶</div>
              <div style="flex:1"><div style="font-weight:600">AISniper-5G</div><div style="font-size:11px;opacity:0.6">Connected · Excellent signal</div></div>
              <div style="font-size:11px;color:#0a84ff;font-weight:600">●</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;padding:8px;margin-top:6px">
              <div style="font-size:18px;opacity:0.6">📶</div>
              <div style="flex:1"><div>AISniper-Guest</div><div style="font-size:11px;opacity:0.6">Secured · Good</div></div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;padding:8px">
              <div style="font-size:18px;opacity:0.4">📶</div>
              <div style="flex:1"><div>CafeWiFi</div><div style="font-size:11px;opacity:0.6">Open · Weak</div></div>
            </div>
          </div>
          <div class="settings-row" style="margin-top:14px">
            <label>Network Details</label>
            <div class="ctrl">Router: 192.168.195.1</div>
          </div>
          <div class="settings-row">
            <label>IP Address</label>
            <div class="ctrl">192.168.195.22</div>
          </div>
          <div class="settings-row">
            <label>Speed</label>
            <div class="ctrl">867 Mbps</div>
          </div>
        </div>
      `;
    case 'bluetooth':
      return `
        <h2>Bluetooth</h2>
        <div class="settings-section">
          <div class="settings-row">
            <label>Bluetooth</label>
            <div class="ctrl"><div class="toggle-switch on"></div></div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(10,132,255,0.1);border-radius:8px;margin-top:10px">
            <div style="font-size:18px;color:#0a84ff">🎧</div>
            <div style="flex:1"><div style="font-weight:600">AirPods Pro</div><div style="font-size:11px;opacity:0.6">Connected · 92% battery</div></div>
          </div>
        </div>
      `;
    case 'health':
      return `
        <h2>System Health</h2>
        <div class="settings-section">
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
            <div style="width:54px;height:54px;border-radius:50%;background:conic-gradient(#34c759 0% 92%,#e5e5ea 92% 100%);display:flex;align-items:center;justify-content:center">
              <div style="width:42px;height:42px;border-radius:50%;background:var(--panel-bg-solid);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">92</div>
            </div>
            <div>
              <div style="font-size:18px;font-weight:600">Excellent</div>
              <div style="font-size:12px;opacity:0.6">All systems operational</div>
            </div>
          </div>
          <div class="settings-row"><label>CPU Usage</label><div class="ctrl"><div style="width:120px;height:6px;background:rgba(0,0,0,0.08);border-radius:3px;overflow:hidden"><div style="width:32%;height:100%;background:#34c759"></div></div><span style="font-size:12px;width:40px;text-align:right">32%</span></div></div>
          <div class="settings-row"><label>Memory</label><div class="ctrl"><div style="width:120px;height:6px;background:rgba(0,0,0,0.08);border-radius:3px;overflow:hidden"><div style="width:54%;height:100%;background:#ff9500"></div></div><span style="font-size:12px;width:40px;text-align:right">5.4/16 GB</span></div></div>
          <div class="settings-row"><label>Disk</label><div class="ctrl"><div style="width:120px;height:6px;background:rgba(0,0,0,0.08);border-radius:3px;overflow:hidden"><div style="width:42%;height:100%;background:#5ac8fa"></div></div><span style="font-size:12px;width:40px;text-align:right">212 GB</span></div></div>
          <div class="settings-row"><label>GPU</label><div class="ctrl"><div style="width:120px;height:6px;background:rgba(0,0,0,0.08);border-radius:3px;overflow:hidden"><div style="width:18%;height:100%;background:#bf5af2"></div></div><span style="font-size:12px;width:40px;text-align:right">18%</span></div></div>
          <div class="settings-row"><label>Temperature</label><div class="ctrl"><span style="color:#34c759;font-weight:600">42°C</span> Normal</div></div>
          <div class="settings-row"><label>Uptime</label><div class="ctrl" id="uptime-display">0h 0m</div></div>
        </div>
        <div class="settings-section">
          <div class="settings-row"><label>Last Backup</label><div class="ctrl">2 hours ago</div></div>
          <div class="settings-row"><label>Last Check</label><div class="ctrl">just now</div></div>
        </div>
      `;
    case 'storage':
      return `
        <h2>Storage</h2>
        <div class="settings-section">
          <div style="margin-bottom:14px">
            <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:rgba(0,0,0,0.06)">
              <div style="width:35%;background:#5ac8fa"></div>
              <div style="width:25%;background:#ff9500"></div>
              <div style="width:18%;background:#bf5af2"></div>
              <div style="width:14%;background:#34c759"></div>
              <div style="width:8%;background:#ff375f"></div>
            </div>
            <div style="font-size:12px;margin-top:6px">212 GB used of 512 GB</div>
          </div>
          <div class="settings-row"><span>📷 Photos</span><div class="ctrl" style="font-size:12px">74 GB</div></div>
          <div class="settings-row"><span>🎬 Movies</span><div class="ctrl" style="font-size:12px">53 GB</div></div>
          <div class="settings-row"><span>🎵 Music</span><div class="ctrl" style="font-size:12px">38 GB</div></div>
          <div class="settings-row"><span>📱 Apps</span><div class="ctrl" style="font-size:12px">30 GB</div></div>
          <div class="settings-row"><span>🗑️ Other</span><div class="ctrl" style="font-size:12px">17 GB</div></div>
        </div>
      `;
    case 'about':
      return `
        <h2>About</h2>
        <div class="settings-section">
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
            <div style="width:54px;height:54px;border-radius:14px;background:linear-gradient(135deg,#a78bfa,#ec4899);display:flex;align-items:center;justify-content:center;font-size:28px">🎯</div>
            <div>
              <div style="font-size:18px;font-weight:600">AISniper OS</div>
              <div style="font-size:12px;opacity:0.6">Version 1.0 (Build 24A100)</div>
            </div>
          </div>
          <div class="settings-row"><label>Computer Name</label><div class="ctrl">Sniper's Mac</div></div>
          <div class="settings-row"><label>Chip</label><div class="ctrl">Apple Silicon M-Series (simulated)</div></div>
          <div class="settings-row"><label>Memory</label><div class="ctrl">16 GB</div></div>
          <div class="settings-row"><label>Serial Number</label><div class="ctrl">AISN-2024-001</div></div>
          <div class="settings-row"><label>Hostname</label><div class="ctrl">sniper.local</div></div>
        </div>
        <div class="settings-section">
          <div class="settings-row"><label>System Report</label><div class="ctrl">›</div></div>
          <div class="settings-row"><label>Software Update</label><div class="ctrl" style="color:#34c759">Up to date</div></div>
        </div>
      `;
    default: return '<h2>Not found</h2>';
  }
}

function bindPane(main, body) {
  // Dark mode toggle
  const darkToggle = main.querySelector('#dark-toggle');
  if (darkToggle) {
    if (document.body.classList.contains('theme-dark')) darkToggle.classList.add('on');
    darkToggle.addEventListener('click', () => {
      darkToggle.classList.toggle('on');
      document.body.classList.toggle('theme-dark');
    });
  }
  // Accent picker
  main.querySelectorAll('[data-accent]').forEach(sw => {
    sw.addEventListener('click', () => {
      const c = sw.dataset.accent;
      document.documentElement.style.setProperty('--accent', c);
      main.querySelectorAll('[data-accent]').forEach(s => s.style.outline = '');
      sw.style.outline = '2px solid ' + c;
      sw.style.outlineOffset = '2px';
    });
  });
  // Wallpaper picker
  main.querySelectorAll('[data-wp]').forEach(thumb => {
    thumb.addEventListener('click', () => {
      const wp = thumb.dataset.wp;
      main.querySelectorAll('[data-wp]').forEach(t => t.classList.remove('selected'));
      thumb.classList.add('selected');
      document.body.setAttribute('data-wallpaper', wp);
    });
  });
  // Wi-Fi toggle
  const wifiT = main.querySelector('#wifi-toggle');
  if (wifiT) wifiT.addEventListener('click', () => wifiT.classList.toggle('on'));
}

/* ============================================================
   Terminal
   ============================================================ */
Apps.terminal = {
  id: 'terminal',
  title: 'Terminal — zsh',
  defaultSize: { w: 720, h: 460 },
  content() {
    return `
      <div class="terminal" id="terminal-app">
        <div class="term-line term-info">AISniper OS 1.0 — Terminal [zsh]</div>
        <div class="term-line term-info">Copyright © 2024-2026 AISniper Systems. All rights reserved.</div>
        <div class="term-line">Type 'help' for a list of commands.</div>
        <div class="term-line"></div>
        <div id="term-output"></div>
        <div class="term-input">
          <span class="term-prompt">sniper@aisniper ~ %</span>
          <input id="term-cmd" autocomplete="off" spellcheck="false" />
        </div>
      </div>
    `;
  },
  onMount(body) {
    const input = body.querySelector('#term-cmd');
    const output = body.querySelector('#term-output');
    input.focus();

    const cwd = ['~'];
    const history = [];
    let histIdx = 0;

    const fileSystem = {
      '~': { type: 'dir', children: {
        'Documents': { type: 'dir', children: {
          'notes.txt': { type: 'file', content: 'Welcome to AISniper OS notes!' },
          'todo.md': { type: 'file', content: '- Build cool things\n- Learn something new' }
        }},
        'Downloads': { type: 'dir', children: {} },
        'Projects': { type: 'dir', children: {
          'aisniper': { type: 'dir', children: {
            'index.html': { type: 'file', content: '<!DOCTYPE html>...' },
            'styles.css': { type: 'file', content: '/* AISniper OS */' },
            'app.js': { type: 'file', content: '// Welcome!' }
          }}
        }},
        'Pictures': { type: 'dir', children: {} },
        'readme.txt': { type: 'file', content: 'AISniper OS — Browser Edition\nBuilt with love by Sniper.' }
      }}
    };

    const resolvePath = (path) => {
      if (path === '~' || path === '') return '~';
      if (path.startsWith('~/')) path = path.slice(2);
      if (path === '/') return '~';
      const parts = [...cwd];
      path.split('/').forEach(p => {
        if (p === '..') { if (parts.length > 1) parts.pop(); }
        else if (p !== '.' && p !== '') parts.push(p);
      });
      return parts.join('/');
    };

    const getNode = (path) => {
      const parts = path.split('/').filter(p => p && p !== '~');
      let node = fileSystem['~'];
      for (const p of parts) {
        if (!node || node.type !== 'dir' || !node.children[p]) return null;
        node = node.children[p];
      }
      return node;
    };

    const write = (text, cls = '') => {
      const div = document.createElement('div');
      div.className = 'term-line ' + cls;
      div.textContent = text;
      output.appendChild(div);
      body.querySelector('.terminal').scrollTop = body.querySelector('.terminal').scrollHeight;
    };
    const writeHTML = (html) => {
      const div = document.createElement('div');
      div.className = 'term-line';
      div.innerHTML = html;
      output.appendChild(div);
    };

    const commands = {
      help() {
        write('Available commands:', 'term-info');
        write('  help           Show this help message');
        write('  ls [path]      List directory contents');
        write('  cd <path>      Change directory');
        write('  pwd            Print working directory');
        write('  cat <file>     Display file contents');
        write('  echo <text>    Print text');
        write('  whoami         Print current user');
        write('  date           Show current date');
        write('  clear          Clear screen');
        write('  uname          System information');
        write('  open <app>     Open an application (finder, settings, calculator, shooter)');
        write('  theme <dark|light>  Switch theme');
        write('  wallpaper <name>    Change wallpaper (sonoma, sequoia, bigsur, monterey, ventura)');
        write('  history        Show command history');
        write('  neofetch       System info with ASCII art');
        write('  cowsay <text>  Have a cow say something');
        write('  about          About this OS');
      },
      ls(args) {
        const path = args[0] ? resolvePath(args[0]) : cwd.join('/');
        const node = getNode(path);
        if (!node) return write('ls: ' + path + ': No such file or directory', 'term-error');
        if (node.type === 'file') return write(node.name || path.split('/').pop());
        const items = Object.keys(node.children);
        if (items.length === 0) return write('(empty)');
        write(items.map(i => {
          const isDir = node.children[i].type === 'dir';
          return isDir ? '<span style="color:#5ac8fa;font-weight:600">' + i + '/</span>' : i;
        }).join('  '));
      },
      cd(args) {
        const path = args[0] || '~';
        const newPath = resolvePath(path);
        const node = getNode(newPath);
        if (!node) return write('cd: ' + path + ': No such file or directory', 'term-error');
        if (node.type !== 'dir') return write('cd: not a directory: ' + path, 'term-error');
        cwd.length = 0;
        if (newPath === '~') cwd.push('~');
        else newPath.split('/').filter(p => p).forEach(p => cwd.push(p));
        updatePrompt();
      },
      pwd() { write('/' + cwd.join('/')); },
      cat(args) {
        if (!args[0]) return write('cat: missing file operand', 'term-error');
        const node = getNode(resolvePath(args[0]));
        if (!node) return write('cat: ' + args[0] + ': No such file or directory', 'term-error');
        if (node.type !== 'file') return write('cat: ' + args[0] + ': Is a directory', 'term-error');
        write(node.content);
      },
      echo(args) { write(args.join(' ')); },
      whoami() { write('sniper'); },
      date() { write(new Date().toString()); },
      clear() { output.innerHTML = ''; },
      uname() { write('AISniper OS 1.0.0 darwin arm64'); },
      whois() { write('Sniper — AI Operator · AGI Researcher'); },
      history() { history.forEach((h, i) => write(`  ${i + 1}  ${h}`)); },
      neofetch() {
        writeHTML(`<pre style="color:#bf5af2;font-weight:bold;line-height:1.2">
   ╭─────────────────╮
   │  <span style="color:#5af78e">AISniper</span><span style="color:#5ac8fa">OS</span>     │
   │   <span style="color:#ff9500">1.0</span>            │
   ╰─────────────────╯
        </pre>`);
        write('OS: ' + 'AISniper OS 1.0 (Sequoia-inspired)');
        write('Host: Sniper\'s Browser');
        write('Kernel: WebKit/Blink ' + (navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Firefox'));
        write('Shell: zsh 5.9');
        write('Resolution: ' + window.screen.width + 'x' + window.screen.height);
        write('Theme: ' + (document.body.classList.contains('theme-dark') ? 'Dark' : 'Light'));
        write('Uptime: ' + Math.floor(performance.now() / 1000) + 's');
        write('CPU Cores: ' + navigator.hardwareConcurrency);
      },
      cowsay(args) {
        const text = args.join(' ') || 'Moo!';
        const top = ' ' + '_'.repeat(text.length + 2);
        const mid = '< ' + text + ' >';
        const bot = ' ' + '-'.repeat(text.length + 2);
        write(top);
        write(mid);
        write(bot);
        write('        \\   ^__^');
        write('         \\  (oo)\\_______');
        write('            (__)\\       )\\/\\');
        write('                ||----w |');
        write('                ||     ||');
      },
      about() {
        write('AISniper OS — Browser Edition', 'term-info');
        write('A modern, macOS-inspired desktop environment running in your browser.');
        write('Built with vanilla HTML, CSS, and JavaScript.');
        write('Features: Finder, Calculator, Settings, Terminal, and 3D Space Shooter.');
      },
      open(args) {
        if (!args[0]) return write('open: missing app name', 'term-error');
        const map = { finder:'finder', settings:'settings', calculator:'calculator', calc:'calculator', terminal:'terminal', shooter:'shooter', 'space-shooter':'shooter' };
        const id = map[args[0].toLowerCase()];
        if (!id) return write('open: unknown app: ' + args[0], 'term-error');
        window.OS.openApp(id);
        write('Opening ' + id + '...', 'term-info');
      },
      theme(args) {
        const mode = args[0];
        if (mode === 'dark') document.body.classList.add('theme-dark'), write('Theme: dark', 'term-info');
        else if (mode === 'light') document.body.classList.remove('theme-dark'), write('Theme: light', 'term-info');
        else write('Usage: theme <dark|light>', 'term-warn');
      },
      wallpaper(args) {
        if (!args[0]) return write('Usage: wallpaper <sonoma|sequoia|bigsur|monterey|ventura>', 'term-warn');
        const wp = args[0].toLowerCase();
        if (!['sonoma','sequoia','bigsur','monterey','ventura'].includes(wp)) return write('wallpaper: unknown: ' + wp, 'term-error');
        document.body.setAttribute('data-wallpaper', wp);
        write('Wallpaper set to: ' + wp, 'term-info');
      },
      exit() { write('logout'); },
      sudo(args) {
        write('Password:');
        write('[sudo] password for sniper: ' + '*'.repeat(8), 'term-warn');
        write('Sorry, try again.', 'term-error');
      },
      sudo(args) { write('sudo: permission denied (simulated)', 'term-error'); },
      rm(args) { write('rm: dangerous command disabled in this demo 😄', 'term-warn'); },
      reboot() { write('Rebooting in 3 seconds...', 'term-warn'); setTimeout(() => location.reload(), 3000); },
      shutdown() { write('Shutting down...', 'term-warn'); setTimeout(() => { document.getElementById('desktop').classList.add('hidden'); document.getElementById('topbar').classList.add('hidden'); }, 1500); }
    };

    const updatePrompt = () => {
      const promptEl = body.querySelector('.term-prompt');
      promptEl.textContent = `sniper@aisniper ${cwd.join('/').replace(/^~/, '~')} %`;
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const cmdLine = input.value.trim();
        if (cmdLine) {
          history.push(cmdLine);
          histIdx = history.length;
          const echo = document.createElement('div');
          echo.className = 'term-line';
          echo.innerHTML = `<span class="term-prompt">sniper@aisniper ${cwd.join('/').replace(/^~/, '~')} %</span> ${cmdLine}`;
          output.appendChild(echo);
          const [cmd, ...args] = cmdLine.split(/\s+/);
          const handler = commands[cmd];
          if (handler) {
            try { handler(args); } catch (err) { write('Error: ' + err.message, 'term-error'); }
          } else {
            write(`zsh: command not found: ${cmd}`, 'term-error');
          }
        }
        input.value = '';
        body.querySelector('.terminal').scrollTop = body.querySelector('.terminal').scrollHeight;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (histIdx > 0) histIdx--, input.value = history[histIdx] || '';
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (histIdx < history.length) histIdx++, input.value = history[histIdx] || '';
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault(); output.innerHTML = '';
      } else if (e.key === 'c' && e.ctrlKey) {
        e.preventDefault();
        const echo = document.createElement('div');
        echo.className = 'term-line';
        echo.innerHTML = `<span class="term-prompt">sniper@aisniper ${cwd.join('/').replace(/^~/, '~')} %</span> ${input.value}^C`;
        output.appendChild(echo);
        input.value = '';
      }
    });

    body.addEventListener('click', () => input.focus());
  }
};

/* ============================================================
   Space Shooter 3D
   ============================================================ */
Apps.shooter = {
  id: 'shooter',
  title: 'Space Shooter 3D',
  defaultSize: { w: 900, h: 600 },
  content() {
    return `
      <div class="shooter" id="shooter-app">
        <div class="shooter-overlay" id="shooter-overlay">
          <h1>SPACE SHOOTER</h1>
          <p>Defend the galaxy. Use Arrow Keys / WASD to move, Space to shoot.</p>
          <button id="shooter-start">LAUNCH MISSION</button>
        </div>
        <div class="shooter-hud">
          <div class="hud-top">
            <div class="hud-score">SCORE: <span id="s-score">0</span></div>
            <div class="hud-wave">WAVE: <span id="s-wave">1</span></div>
            <div class="hud-health">HP: <span id="s-hp">100</span></div>
          </div>
          <div class="shooter-controls-hint">
            ← → ↑ ↓ / WASD — move &nbsp; · &nbsp; SPACE — shoot &nbsp; · &nbsp; ESC — pause
          </div>
          <div class="hud-bottom">
            <button class="shoot-btn" id="s-pause">PAUSE</button>
            <button class="shoot-btn" id="s-reset">RESET</button>
          </div>
        </div>
      </div>
    `;
  },
  onMount(body) {
    const container = body.querySelector('#shooter-app');
    const overlay = body.querySelector('#shooter-overlay');
    const scoreEl = body.querySelector('#s-score');
    const waveEl = body.querySelector('#s-wave');
    const hpEl = body.querySelector('#s-hp');
    const startBtn = body.querySelector('#shooter-start');
    const pauseBtn = body.querySelector('#s-pause');
    const resetBtn = body.querySelector('#s-reset');

    // Three.js scene
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 1.5, 6);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.insertBefore(renderer.domElement, container.firstChild);

    // Lights
    const ambient = new THREE.AmbientLight(0x404060, 1.2);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);
    const pointLight = new THREE.PointLight(0x5af78e, 2, 20);
    pointLight.position.set(0, 2, 3);
    scene.add(pointLight);

    // Stars background
    const starGeo = new THREE.BufferGeometry();
    const starVerts = [];
    for (let i = 0; i < 1500; i++) {
      starVerts.push((Math.random() - 0.5) * 200);
      starVerts.push((Math.random() - 0.5) * 200);
      starVerts.push((Math.random() - 0.5) * 200);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, sizeAttenuation: true });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Player ship
    const playerGroup = new THREE.Group();
    const shipBody = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 1.2, 4),
      new THREE.MeshPhongMaterial({ color: 0x5af78e, emissive: 0x2a8a4a, shininess: 80 })
    );
    shipBody.rotation.x = -Math.PI / 2;
    playerGroup.add(shipBody);
    const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.6), new THREE.MeshPhongMaterial({ color: 0x2a8a4a }));
    wingL.position.set(-0.35, 0, 0.2);
    playerGroup.add(wingL);
    const wingR = wingL.clone();
    wingR.position.x = 0.35;
    playerGroup.add(wingR);
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), new THREE.MeshPhongMaterial({ color: 0x000000, emissive: 0x5af78e }));
    cockpit.position.set(0, 0.15, -0.1);
    playerGroup.add(cockpit);
    // Engine flame
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 8), new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, opacity: 0.8 }));
    flame.position.set(0, 0, 0.8);
    flame.rotation.x = Math.PI / 2;
    playerGroup.add(flame);
    playerGroup.position.set(0, 0, 4);
    scene.add(playerGroup);

    // Game state
    const state = {
      running: false, paused: false, score: 0, hp: 100, wave: 1,
      keys: {}, bullets: [], enemies: [], particles: [], spawnTimer: 0, enemySpeed: 0.02,
    };

    const updateHUD = () => {
      scoreEl.textContent = state.score;
      waveEl.textContent = state.wave;
      hpEl.textContent = Math.max(0, state.hp);
    };

    // Player movement
    const playerSpeed = 0.12;
    const movePlayer = () => {
      if (!state.running || state.paused) return;
      const p = playerGroup.position;
      if (state.keys['ArrowLeft'] || state.keys['a'] || state.keys['A']) p.x -= playerSpeed;
      if (state.keys['ArrowRight'] || state.keys['d'] || state.keys['D']) p.x += playerSpeed;
      if (state.keys['ArrowUp'] || state.keys['w'] || state.keys['W']) p.y += playerSpeed;
      if (state.keys['ArrowDown'] || state.keys['s'] || state.keys['S']) p.y -= playerSpeed;
      p.x = Math.max(-4, Math.min(4, p.x));
      p.y = Math.max(-2, Math.min(3, p.y));
      // Tilt effect
      playerGroup.rotation.z = -((state.keys['ArrowLeft']||state.keys['a']) ? 0.3 : 0) + -((state.keys['ArrowRight']||state.keys['d']) ? -0.3 : 0);
    };

    // Shooting
    let shootCooldown = 0;
    const shoot = () => {
      if (shootCooldown > 0 || state.paused || !state.running) return;
      shootCooldown = 8;
      const bullet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8),
        new THREE.MeshBasicMaterial({ color: 0x5af78e })
      );
      bullet.rotation.x = Math.PI / 2;
      bullet.position.copy(playerGroup.position);
      bullet.position.z -= 0.7;
      bullet.userData = { vy: -0.4, life: 60 };
      scene.add(bullet);
      state.bullets.push(bullet);
    };

    // Spawn enemies
    const spawnEnemy = () => {
      const type = Math.random();
      let geom, color, hp, score, size = 0.4;
      if (type < 0.7) {
        geom = new THREE.IcosahedronGeometry(0.4, 0);
        color = 0xff5555; hp = 1; score = 10;
      } else if (type < 0.9) {
        geom = new THREE.OctahedronGeometry(0.5, 0);
        color = 0xffaa00; hp = 2; score = 25; size = 0.5;
      } else {
        geom = new THREE.DodecahedronGeometry(0.7, 0);
        color = 0xff00ff; hp = 4; score = 60; size = 0.7;
      }
      const mat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.4 });
      const enemy = new THREE.Mesh(geom, mat);
      enemy.position.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 4, -30);
      enemy.userData = { hp, score, vy: state.enemySpeed + Math.random() * 0.02, rotX: Math.random() * 0.05, rotY: Math.random() * 0.05, size };
      scene.add(enemy);
      state.enemies.push(enemy);
    };

    // Particles
    const spawnExplosion = (pos, color) => {
      for (let i = 0; i < 20; i++) {
        const p = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 4, 4),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
        );
        p.position.copy(pos);
        p.userData = { vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2, vz: (Math.random() - 0.5) * 0.2, life: 30 };
        scene.add(p);
        state.particles.push(p);
      }
    };

    // Resize
    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    // Key handlers
    const keyDown = (e) => {
      state.keys[e.key] = true;
      if (e.key === ' ' && state.running) { e.preventDefault(); shoot(); }
      if (e.key === 'Escape') { state.paused = !state.paused; pauseBtn.classList.toggle('active', state.paused); }
    };
    const keyUp = (e) => { state.keys[e.key] = false; };
    document.addEventListener('keydown', keyDown);
    document.addEventListener('keyup', keyUp);

    // Game loop
    let animId;
    const gameLoop = () => {
      animId = requestAnimationFrame(gameLoop);
      if (!state.running || state.paused) { renderer.render(scene, camera); return; }
      movePlayer();
      if (shootCooldown > 0) shootCooldown--;

      // Stars drift
      stars.rotation.z += 0.0003;
      starMat.size = 0.3 + Math.sin(performance.now() / 500) * 0.05;

      // Bullets
      for (let i = state.bullets.length - 1; i >= 0; i--) {
        const b = state.bullets[i];
        b.position.z += b.userData.vy;
        b.userData.life--;
        if (b.userData.life <= 0 || b.position.z < -30) {
          scene.remove(b); state.bullets.splice(i, 1);
        }
      }

      // Enemies spawn
      state.spawnTimer++;
      const spawnRate = Math.max(20, 80 - state.wave * 5);
      if (state.spawnTimer > spawnRate) {
        spawnEnemy();
        state.spawnTimer = 0;
      }

      // Enemies move
      for (let i = state.enemies.length - 1; i >= 0; i--) {
        const e = state.enemies[i];
        e.position.z += e.userData.vy;
        e.rotation.x += e.userData.rotX;
        e.rotation.y += e.userData.rotY;
        // Collision with player
        const dx = e.position.x - playerGroup.position.x;
        const dy = e.position.y - playerGroup.position.y;
        const dz = e.position.z - playerGroup.position.z;
        if (Math.sqrt(dx*dx + dy*dy + dz*dz) < 0.7) {
          state.hp -= 20;
          spawnExplosion(e.position, 0xff5555);
          scene.remove(e); state.enemies.splice(i, 1);
          updateHUD();
          if (state.hp <= 0) { gameOver(); return; }
        }
        // Off screen
        else if (e.position.z > 8) {
          scene.remove(e); state.enemies.splice(i, 1);
        }
        // Bullet collision
        else {
          for (let j = state.bullets.length - 1; j >= 0; j--) {
            const b = state.bullets[j];
            const bx = b.position.x - e.position.x;
            const by = b.position.y - e.position.y;
            const bz = b.position.z - e.position.z;
            if (Math.sqrt(bx*bx + by*by + bz*bz) < 0.5) {
              e.userData.hp--;
              scene.remove(b); state.bullets.splice(j, 1);
              if (e.userData.hp <= 0) {
                state.score += e.userData.score;
                spawnExplosion(e.position, e.material.color.getHex());
                scene.remove(e); state.enemies.splice(i, 1);
                if (state.score > state.wave * 200) { state.wave++; state.enemySpeed += 0.005; }
                updateHUD();
              }
              break;
            }
          }
        }
      }

      // Particles
      for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.position.x += p.userData.vx;
        p.position.y += p.userData.vy;
        p.position.z += p.userData.vz;
        p.userData.life--;
        p.material.opacity = p.userData.life / 30;
        if (p.userData.life <= 0) { scene.remove(p); state.particles.splice(i, 1); }
      }

      renderer.render(scene, camera);
    };

    const gameOver = () => {
      state.running = false;
      overlay.innerHTML = `
        <h1 style="background:linear-gradient(90deg,#ff5b5b,#ff9500);-webkit-background-clip:text;-webkit-text-fill-color:transparent">MISSION FAILED</h1>
        <p>Final Score: <strong style="color:#5af78e">${state.score}</strong></p>
        <p>Waves Survived: <strong style="color:#5ac8fa">${state.wave}</strong></p>
        <button id="shooter-restart">RETRY MISSION</button>
      `;
      overlay.style.display = 'flex';
      body.querySelector('#shooter-restart').addEventListener('click', startGame);
    };

    const startGame = () => {
      // Clear previous
      state.bullets.forEach(b => scene.remove(b));
      state.enemies.forEach(e => scene.remove(e));
      state.particles.forEach(p => scene.remove(p));
      state.bullets = []; state.enemies = []; state.particles = [];
      state.score = 0; state.hp = 100; state.wave = 1; state.enemySpeed = 0.02;
      state.spawnTimer = 0; state.running = true; state.paused = false;
      overlay.style.display = 'none';
      updateHUD();
    };

    startBtn.addEventListener('click', startGame);
    pauseBtn.addEventListener('click', () => { if (state.running) { state.paused = !state.paused; pauseBtn.classList.toggle('active', state.paused); }});
    resetBtn.addEventListener('click', () => { state.running = false; startGame(); });

    gameLoop();
    updateHUD();

    // Cleanup
    body._cleanup = () => {
      cancelAnimationFrame(animId);
      document.removeEventListener('keydown', keyDown);
      document.removeEventListener('keyup', keyUp);
      ro.disconnect();
      renderer.dispose();
      state.bullets.forEach(b => scene.remove(b));
      state.enemies.forEach(e => scene.remove(e));
      state.particles.forEach(p => scene.remove(p));
    };
  }
};

/* ============================================================
   About This Mac
   ============================================================ */
Apps.about = {
  id: 'about',
  title: 'About This Mac',
  defaultSize: { w: 480, h: 460 },
  content() {
    return `
      <div class="about-content">
        <div style="width:96px;height:96px;border-radius:22px;background:linear-gradient(135deg,#a78bfa,#ec4899);display:flex;align-items:center;justify-content:center;font-size:48px;box-shadow:0 8px 24px rgba(167,139,250,0.4)">🎯</div>
        <h2>AISniper OS</h2>
        <div class="ver">Version 1.0 (Build 24A100)</div>
        <div class="specs">
          <div class="spec-row"><span>Chip</span><span>Apple Silicon (Simulated)</span></div>
          <div class="spec-row"><span>Memory</span><span>16 GB</span></div>
          <div class="spec-row"><span>Startup Disk</span><span>Macintosh HD</span></div>
          <div class="spec-row"><span>Serial Number</span><span>AISN-2024-001</span></div>
          <div class="spec-row"><span>Hostname</span><span>sniper.local</span></div>
          <div class="spec-row"><span>User</span><span>Sniper (Administrator)</span></div>
          <div class="spec-row"><span>Uptime</span><span id="about-uptime">0 minutes</span></div>
        </div>
        <div style="font-size:11px;opacity:0.5;margin-top:10px">© 2024-2026 AISniper Systems. All rights reserved.</div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button style="background:#0a84ff;color:white;border:0;padding:6px 14px;border-radius:6px;cursor:pointer">More Info…</button>
          <button style="background:rgba(0,0,0,0.06);border:0;padding:6px 14px;border-radius:6px;cursor:pointer">Support</button>
        </div>
      </div>
    `;
  }
};
