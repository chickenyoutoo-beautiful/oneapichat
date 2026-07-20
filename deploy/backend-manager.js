/**
 * backend-manager.js — OneAPIChat 桌面版后端进程生命周期管理
 *
 * 管理三个后端服务:
 *   1. PHP 内置服务器 (localhost:8080) — API 层
 *   2. Python FastAPI 引擎  (localhost:8766) — 核心引擎/SSE/Agent
 *   3. Node.js MCP 服务器   (localhost:18788) — 工具执行
 *
 * 用法:
 *   const mgr = new BackendManager({ appDir, resourcesDir, isDev });
 *   mgr.on('progress', ({service, status, message}) => { ... });
 *   await mgr.startAll();
 *   // ... app runs ...
 *   await mgr.stopAll();
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

class BackendManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.appDir       — 应用代码目录(php/api/python 所在)
   * @param {string} opts.resourcesDir — 打包后的 resources 目录(运行时二进制在此)
   * @param {boolean} opts.isDev       — 开发模式(使用系统 PATH 上的命令)
   * @param {string} opts.dataDir      — 用户数据目录(users/ chat_data/ .engine/ uploads/)
   */
  constructor(opts = {}) {
    super();
    this.appDir = opts.appDir || path.join(__dirname, '..');
    this.resourcesDir = opts.resourcesDir || process.resourcesPath || this.appDir;
    this.isDev = opts.isDev !== undefined ? opts.isDev : !require('electron').app.isPackaged;
    this.dataDir = opts.dataDir || require('electron').app.getPath('userData');
    this.processes = new Map();  // name → ChildProcess
    this.ports = { php: 8080, engine: 8766, mcp: 18788 };
    this._started = false;
  }

  /* ── 运行时可执行文件检测 ─────────────────────── */

  _runtimePath(name, exeName) {
    if (this.isDev) {
      // 开发模式: 使用系统 PATH
      return exeName;
    }
    // 生产模式: 使用捆绑的运行时
    const bundled = path.join(this.resourcesDir, 'runtimes', name, exeName);
    if (fs.existsSync(bundled)) return bundled;
    // 回退到系统 PATH
    return exeName;
  }

  get phpExe() { return this._runtimePath('php', 'php.exe'); }
  get pythonExe() { return this._runtimePath('python', process.platform === 'win32' ? 'python.exe' : 'python3'); }
  get nodeExe() { return this._runtimePath('node', process.platform === 'win32' ? 'node.exe' : 'node'); }

  /* ── 端口检测与分配 ────────────────────────── */

  _portInUse(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(true));
      server.once('listening', () => { server.close(); resolve(false); });
      server.listen(port, '127.0.0.1');
    });
  }

  async _findPort(startPort) {
    let port = startPort;
    while (await this._portInUse(port)) {
      port++;
      if (port > startPort + 100) throw new Error(`No available port near ${startPort}`);
    }
    return port;
  }

  /* ── 健康检查轮询 ──────────────────────────── */

  _healthCheck(url, timeoutMs = 30000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const poll = () => {
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`Health check timeout for ${url}`));
        }
        http.get(url, (res) => {
          // 任意 2xx/3xx/4xx 都说明服务在监听(401/404 也算 alive)
          resolve(true);
        }).on('error', () => {
          setTimeout(poll, 300);
        });
      };
      poll();
    });
  }

  /* ── 进程启动 ───────────────────────────────── */

  _spawn(name, command, args, opts = {}) {
    this.emit('progress', { service: name, status: 'starting', message: `正在启动 ${name}...` });

    const env = { ...process.env, ...(opts.env || {}) };
    const child = spawn(command, args, {
      cwd: opts.cwd || this.appDir,
      env,
      stdio: opts.stdio || 'pipe',
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    child.on('error', (err) => {
      this.emit('progress', { service: name, status: 'error', message: `${name} 启动失败: ${err.message}` });
    });

    child.on('exit', (code, signal) => {
      if (!this._stopping) {
        this.emit('progress', { service: name, status: 'exited', message: `${name} 异常退出 (code=${code}, signal=${signal})` });
      }
    });

    // 收集日志输出
    if (child.stdout) {
      child.stdout.on('data', (d) => this.emit('log', { service: name, text: d.toString() }));
    }
    if (child.stderr) {
      child.stderr.on('data', (d) => this.emit('log', { service: name, text: d.toString() }));
    }

    this.processes.set(name, child);
    return child;
  }

  /* ── 各服务启动 ────────────────────────────── */

  async _startPhp() {
    const port = await this._findPort(this.ports.php);
    this.ports.php = port;

    // PHP 内置服务器: 文档根设为项目根目录
    // 路由脚本处理 /oneapichat/ 前缀 → 直接映射到对应文件
    const routerScript = path.join(this.appDir, 'deploy', 'php-router.php');
    const docRoot = this.appDir; // 项目根即文档根

    const args = ['-S', `127.0.0.1:${port}`, '-t', docRoot];
    // 如果路由器脚本存在则使用
    if (fs.existsSync(routerScript)) {
      args.push(routerScript);
    }

    // 创建数据目录
    const dirs = ['users', 'chat_data', '.engine', 'uploads'];
    for (const d of dirs) {
      const p = path.join(this.dataDir, d);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    }

    // 创建 config.ini（如果不存在）
    const configIni = path.join(this.appDir, 'config.ini');
    if (!fs.existsSync(configIni)) {
      fs.writeFileSync(configIni,
        `[common]\nencryption_key = naujtrats-secret\n\n[tiku]\n;; 题库配置\n`);
    }

    this._spawn('PHP', this.phpExe, args, {
      cwd: this.appDir,
      env: {
        APP_DATA_DIR: this.dataDir,
        APP_IS_DESKTOP: '1',
      },
    });

    await this._healthCheck(`http://127.0.0.1:${port}/api/init.php`, 15000);
    this.emit('progress', { service: 'PHP', status: 'ready', message: `PHP 已就绪 (端口 ${port})` });
  }

  async _startEngine() {
    const port = await this._findPort(this.ports.engine);
    this.ports.engine = port;

    const engineScript = path.join(this.appDir, 'python', 'engine_server.py');
    if (!fs.existsSync(engineScript)) {
      this.emit('progress', { service: 'Engine', status: 'warning', message: 'Python 引擎文件未找到，跳过' });
      return;
    }

    this._spawn('Engine', this.pythonExe, [engineScript], {
      cwd: this.appDir,
      env: {
        ENGINE_PORT: String(port),
        ENGINE_HOST: '127.0.0.1',
        APP_DATA_DIR: this.dataDir,
        APP_IS_DESKTOP: '1',
        PYTHONUNBUFFERED: '1',
      },
    });

    await this._healthCheck(`http://127.0.0.1:${port}/engine/health`, 20000);
    this.emit('progress', { service: 'Engine', status: 'ready', message: `引擎已就绪 (端口 ${port})` });
  }

  async _startMcp() {
    const port = await this._findPort(this.ports.mcp);
    this.ports.mcp = port;

    // 优先使用 resources 中的 mcp-server，其次使用应用目录中的
    let mcpDir = path.join(this.resourcesDir, 'mcp-server');
    if (!fs.existsSync(path.join(mcpDir, 'server.js'))) {
      mcpDir = path.join(this.appDir, 'deploy', 'mcp-server');
    }
    if (!fs.existsSync(path.join(mcpDir, 'server.js'))) {
      this.emit('progress', { service: 'MCP', status: 'warning', message: 'MCP 服务器未找到，部分工具不可用' });
      return;
    }

    this._spawn('MCP', this.nodeExe, ['server.js'], {
      cwd: mcpDir,
      env: {
        MCP_PORT: String(port),
        MCP_HOST: '127.0.0.1',
        MCP_LOG_DIR: path.join(this.dataDir, 'logs'),
      },
    });

    // MCP 服务器没有 health endpoint，等待端口监听
    await this._healthCheck(`http://127.0.0.1:${port}/mcp/api/tools`, 15000)
      .catch(() => {
        this.emit('progress', { service: 'MCP', status: 'warning', message: 'MCP 服务器启动超时，继续运行...' });
        return;
      });
    this.emit('progress', { service: 'MCP', status: 'ready', message: `MCP 已就绪 (端口 ${port})` });
  }

  /* ── 公共 API ───────────────────────────────── */

  async startAll() {
    if (this._started) return;
    this._started = true;
    this._stopping = false;

    this.emit('progress', { service: 'system', status: 'starting', message: '正在启动后端服务...' });

    // 并行启动所有服务
    const results = await Promise.allSettled([
      this._startPhp(),
      this._startEngine(),
      this._startMcp(),
    ]);

    const errors = results.filter(r => r.status === 'rejected');
    if (errors.length === 3) {
      throw new Error(`所有后端服务启动失败: ${errors.map(e => e.reason.message).join('; ')}`);
    }
    if (errors.length > 0) {
      this.emit('progress', {
        service: 'system',
        status: 'warning',
        message: `${errors.length} 个服务启动失败，部分功能不可用`,
      });
    }

    this.emit('progress', { service: 'system', status: 'ready', message: '所有服务已就绪' });

    return {
      phpPort: this.ports.php,
      enginePort: this.ports.engine,
      mcpPort: this.ports.mcp,
      dataDir: this.dataDir,
    };
  }

  async stopAll() {
    this._stopping = true;
    const names = Array.from(this.processes.keys());
    for (const name of names) {
      const child = this.processes.get(name);
      if (child && !child.killed) {
        this.emit('progress', { service: name, status: 'stopping', message: `正在停止 ${name}...` });
        try {
          // 优雅关闭: 先发 SIGTERM，等待3秒，再 SIGKILL
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true });
          } else {
            child.kill('SIGTERM');
            setTimeout(() => {
              if (!child.killed) child.kill('SIGKILL');
            }, 3000);
          }
        } catch (e) {
          // 忽略
        }
      }
    }
    this.processes.clear();
    this._started = false;
  }
}

module.exports = BackendManager;
