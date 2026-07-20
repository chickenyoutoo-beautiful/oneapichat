/**
 * preload.js — OneAPIChat 桌面客户端 preload 脚本 (瘦客户端模式)
 *
 * 通过 contextBridge 安全地向渲染进程注入桌面能力:
 *   - 桌面环境检测
 *   - 服务器 URL 配置
 *   - 系统默认浏览器打开外部链接
 *   - 原生通知（适配 Electron Notification API）
 */

const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  /* ── 环境标志 ───────────────────────────── */
  isElectron: true,
  isDesktop: true,

  /* ── 服务器配置 ─────────────────────────── */
  // 由主进程在窗口创建前注入
  serverUrl: '',

  /* ── 原生能力 ───────────────────────────── */
  // 在系统默认浏览器中打开外部链接
  openExternal(url) {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  },

  // 显示原生通知
  showNotification(title, body) {
    // 使用 HTML5 Notification API（Electron 已适配）
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  },

  // 请求通知权限
  requestNotificationPermission() {
    if (typeof Notification !== 'undefined') {
      return Notification.requestPermission();
    }
    return Promise.resolve('denied');
  },

  /* ── IPC 通信 ───────────────────────────── */
  // 发送消息到主进程
  send(channel, ...args) {
    const allowed = ['app:minimize', 'app:maximize', 'app:close', 'app:switch-server'];
    if (allowed.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },

  // 监听主进程消息
  on(channel, callback) {
    const allowed = ['app:server-changed', 'app:before-quit'];
    if (allowed.includes(channel)) {
      const listener = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
    return () => {};
  },
});
