/**
 * electron_main.js — OneAPIChat 桌面客户端主进程 (瘦客户端模式)
 *
 * 架构: Electron Shell → 加载远程服务器页面 (https://naujtrats.xyz/oneapichat/)
 * 服务器: 运行 PHP API + Python 引擎 + MCP 服务 (零改动)
 * 客户端: 仅 Electron + preload，无需本地后端
 *
 * 功能:
 *   - 首次启动: 配置服务器地址
 *   - 主窗口: 加载服务器页面
 *   - 系统托盘: 最小化/恢复
 *   - 外部链接: 系统默认浏览器打开
 *   - 菜单栏: 切换服务器/开发者工具
 */

const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

// ── 自动更新配置 ────────────────────────────────────
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// ── 路径常量 ────────────────────────────────────────
const APP_ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const ICON_PATH = path.join(PUBLIC_DIR, 'resource', 'icon-512.png');
const APP_NAME = 'OneAPIChat';

// ── 默认服务器地址 ──────────────────────────────────
const DEFAULT_SERVER = 'https://naujtrats.xyz/oneapichat/';

// ── 全局状态 ────────────────────────────────────────
let mainWindow = null;
let tray = null;
let currentServerUrl = DEFAULT_SERVER;

// ── 配置读写 ────────────────────────────────────────
function getConfigPath() {
  return path.join(app.getPath('userData'), 'client-config.json');
}

function loadConfig() {
  const cfgPath = getConfigPath();
  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (cfg.serverUrl && /^https?:\/\//i.test(cfg.serverUrl)) {
        return cfg.serverUrl;
      }
    }
  } catch (e) { /* 忽略 */ }
  return DEFAULT_SERVER;
}

function saveConfig(serverUrl) {
  try {
    const dir = app.getPath('userData');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getConfigPath(), JSON.stringify({ serverUrl }, null, 2), 'utf-8');
  } catch (e) { /* 忽略 */ }
}

// ── 首次启动设置对话框 ──────────────────────────────
function showFirstRunDialog() {
  // 如果已有配置文件，跳过
  if (fs.existsSync(getConfigPath())) return;

  const result = dialog.showMessageBoxSync({
    type: 'question',
    title: APP_NAME + ' — 服务器配置',
    message: '欢迎使用 OneAPIChat 桌面客户端！',
    detail: [
      '请确认后端服务器的地址：',
      '',
      '默认: ' + DEFAULT_SERVER,
      '',
      '如需修改，请稍后在「文件 → 切换服务器」中设置。',
    ].join('\n'),
    buttons: ['使用默认地址', '自定义地址...'],
    defaultId: 0,
    cancelId: 0,
  });

  if (result === 1) {
    showServerUrlDialog();
  } else {
    saveConfig(DEFAULT_SERVER);
  }
}

function showServerUrlDialog() {
  const input = dialog.showInputBoxSync({
    title: APP_NAME + ' — 设置服务器地址',
    label: '请输入 OneAPIChat 服务器的完整 URL:',
    value: currentServerUrl,
    placeholder: 'https://naujtrats.xyz/oneapichat/',
    type: 'text',
    width: 550,
  });

  if (input && /^https?:\/\//i.test(input.trim())) {
    currentServerUrl = input.trim().replace(/\/?$/, '/'); // 确保末尾有 /
    saveConfig(currentServerUrl);
    return true;
  }
  return false;
}

// ── 主窗口 ──────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 420,
    minHeight: 600,
    icon: ICON_PATH,
    show: false,
    backgroundColor: '#ffffff',
    title: APP_NAME,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 注入服务器地址到 preload
  global.__serverUrl = currentServerUrl;

  // 加载远程服务器页面
  mainWindow.loadURL(currentServerUrl);

  // 页面加载完成后注入服务器地址
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      if (window.desktopAPI) {
        window.desktopAPI.serverUrl = ${JSON.stringify(currentServerUrl)};
      }
    `).catch(() => {});
  });

  // 更新窗口标题为页面标题
  mainWindow.webContents.on('page-title-updated', (_e, title) => {
    if (title && title !== 'about:blank') {
      mainWindow.setTitle(title + ' · 桌面版');
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // ★ 修复输入框焦点丢失: 窗口聚焦时恢复 webContents 焦点
  mainWindow.on('focus', () => {
    mainWindow.webContents.focus();
  });
  mainWindow.on('show', () => {
    mainWindow.webContents.focus();
  });

  // 防止页面导航后输入框失焦
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.focus();
  });

  // ★ 最小化到托盘（而非任务栏）
  mainWindow.on('minimize', (event) => {
    if (tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // 关闭到托盘（而非退出）
  mainWindow.on('close', (event) => {
    if (tray && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接 → 系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      // 检查是否是同服务器链接
      const serverOrigin = new URL(currentServerUrl).origin;
      const linkOrigin = new URL(url).origin;
      if (linkOrigin !== serverOrigin) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    }
    return { action: 'allow' };
  });
}

// ── 系统托盘 ────────────────────────────────────────
function createTray() {
  if (!fs.existsSync(ICON_PATH)) return;

  tray = new Tray(ICON_PATH);
  tray.setToolTip(APP_NAME + ' 桌面版');

  const updateTrayMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: '切换服务器',
        click: () => {
          if (showServerUrlDialog()) {
            reloadMainWindow();
          }
        },
      },
      { type: 'separator' },
      {
        label: '开发者工具',
        click: () => {
          if (mainWindow) mainWindow.webContents.toggleDevTools();
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  updateTrayMenu();
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function reloadMainWindow() {
  if (mainWindow) {
    mainWindow.loadURL(currentServerUrl);
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.executeJavaScript(`
        if (window.desktopAPI) {
          window.desktopAPI.serverUrl = ${JSON.stringify(currentServerUrl)};
        }
      `).catch(() => {});
    });
  }
}

// ── 应用菜单 ────────────────────────────────────────
function createAppMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '切换服务器...',
          click: () => {
            if (showServerUrlDialog()) reloadMainWindow();
          },
        },
        { type: 'separator' },
        {
          label: '开发者工具',
          accelerator: process.platform === 'darwin' ? 'Cmd+Shift+I' : 'Ctrl+Shift+I',
          click: () => { if (mainWindow) mainWindow.webContents.toggleDevTools(); },
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 ' + APP_NAME,
          click: () => {
            dialog.showMessageBox(mainWindow || undefined, {
              type: 'info',
              title: '关于 ' + APP_NAME,
              message: APP_NAME + ' 桌面版 v' + app.getVersion(),
              detail: [
                '远程服务器: ' + currentServerUrl,
                '',
                '多模型 AI 聊天客户端 · 桌面瘦客户端',
                '服务器运行完整后端（PHP + Python + Node.js）',
                '客户端通过 HTTPS 安全连接远程服务器。',
                '',
                'Electron: ' + process.versions.electron,
                'Chrome: ' + process.versions.chrome,
              ].join('\n'),
            });
          },
        },
        { type: 'separator' },
        {
          label: '项目地址 (GitHub)',
          click: () => shell.openExternal('https://github.com/chickenyoutoo-beautiful/oneapichat'),
        },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about', label: '关于' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC 处理 ────────────────────────────────────────
function setupIPC() {
  ipcMain.on('app:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });
  ipcMain.on('app:maximize', () => {
    if (mainWindow) {
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    }
  });
  ipcMain.on('app:switch-server', () => {
    if (showServerUrlDialog()) reloadMainWindow();
  });
}

// ── 自动更新 ────────────────────────────────────────
function setupAutoUpdater() {
  // 检查更新事件
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] 正在检查更新...');
  });

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: '发现新版本',
      message: `OneAPIChat v${info.version} 可用`,
      detail: '是否下载并安装更新？\n\n更新将在下次启动时应用。',
      buttons: ['下载更新', '稍后提醒'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] 已是最新版本');
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) {
      mainWindow.setProgressBar(progress.percent / 100);
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.setProgressBar(-1);
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: '更新已下载',
      message: '更新已下载完成，下次启动时自动安装。',
      detail: '点击"立即重启"立即应用更新。',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] 更新出错:', err.message);
  });

  // 启动后 5 秒开始检查更新
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

// ── 应用启动 ────────────────────────────────────────
app.whenReady().then(() => {
  setupIPC();

  // 读取配置
  currentServerUrl = loadConfig();

  // 首次启动
  showFirstRunDialog();
  currentServerUrl = loadConfig(); // 重新读取（可能已更新）

  createAppMenu();
  createTray();
  createMainWindow();
  setupAutoUpdater();
});

// ── 应用退出 ────────────────────────────────────────
app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    createMainWindow();
  }
});
