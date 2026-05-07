# OneAPIChat

**多模型 AI 聊天平台，支持 Agent 模式**

一个自托管的多模型 AI 聊天平台，对接 MiniMax、DeepSeek 等多种模型接口，支持 Agent 自主任务、联网搜索、SSE 流式响应、多用户管理、聊天记录导入导出等完整功能。

---

## 🌟 特性

### 🤖 多模型支持
- 兼容 OpenAI API 格式，可对接任意模型 endpoint
- 内置 **MiniMax**、**DeepSeek** 等模型支持
- 模型路由与自动切换
- 每个模型可独立配置 API Base URL 和 Key

### 🧠 Agent 模式
- 自主子 Agent 派发与管理
- 工具调用：联网搜索、代码执行、文件操作
- 持久化 Agent 状态与通知系统
- 内置心跳 / Cron 引擎协调后台任务

### 🔍 联网搜索
- AI 自动判断何时需要联网
- 多搜索引擎：DuckDuckGo、Brave Search、Google 自定义搜索
- 搜索类型：网页、新闻、图片
- 支持 `/search`、`/news`、`/image` 强制搜索指令

### 📡 后端 SSE 流式响应
- Python 引擎（`engine_server.py`）监听端口 **8766**，处理 SSE 流
- PHP 代理（`engine_api.php`）桥接前端与后端
- 实时逐 token 打字机效果

### 👥 多用户 / 多终端
- PHP 会话认证
- SQLite 分用户存储聊天历史
- 聊天记录导入导出（JSON 格式）

### 🎨 界面功能
- 深色 / 浅色模式一键切换
- 响应式布局，桌面和移动端均支持
- Markdown 渲染 + 代码语法高亮
- 文件上传（文本、Office 文档、代码、图片等）
- 对话管理（重命名、删除、导出）

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────┐
│  前端  (index.html + JS/CSS)                │
│  单页应用，无需构建步骤                       │
└──────────────┬──────────────────────────────┘
               │ HTTP / SSE
┌──────────────▼──────────────────────────────┐
│  PHP 代理  (engine_api.php)                 │
│  桥接前端 ↔ 后端，处理认证与路由             │
│  端口：标准 HTTP (80/443)                   │
└──────────────┬──────────────────────────────┘
               │ HTTP / SSE
┌──────────────▼──────────────────────────────┐
│  Python 引擎  (engine_server.py)            │
│  SSE 流式响应、Agent 逻辑、工具调用          │
│  端口：8766（可通过 ENGINE_PORT 环境变量修改）│
└─────────────────────────────────────────────┘
```

### 核心文件

| 文件 | 说明 |
|------|------|
| `index.html` | 前端单页应用主入口 |
| `engine_server.py` | Python 后端 — SSE 流、Agent 引擎、心跳 / Cron |
| `engine_api.php` | PHP 代理 — 认证、路由、CORS |
| `engine_watchdog.sh` | 看门狗脚本 — 引擎崩溃时自动重启 |
| `config.php` | API Key 和端点配置 |

---

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone <你的仓库地址> oneapichat
cd oneapichat
```

### 2. 安装依赖

**Python 后端：**

```bash
pip install fastapi uvicorn openai httpx sse-starlette python-dotenv requests
```

**PHP 前端代理**（在你的 Web 服务器上）：

```bash
# 安装 PHP 8+ 和扩展
# 大多数 Linux 发行版：sudo apt install php php-curl php-sqlite3 php-mbstring
```

### 3. 配置并运行

```bash
# 在 config.php 中填入你的 API Key
# ENGINE_PORT=8766 python3 engine_server.py
```

**或使用部署脚本（一键部署）：**

```bash
chmod +x deploy.sh
./deploy.sh
```

> ⚠️ 部署脚本会处理环境搭建、端口绑定和服务注册，适合在干净的 VPS 或开发机上快速启动。

### 4. 浏览器打开

```
http://你的服务器地址/
```

---

## 🌐 跨平台支持

| 平台 | 支持状态 | 备注 |
|------|---------|------|
| **Linux** | ✅ 完整支持 | systemd 服务 + 看门狗脚本 |
| **macOS** | ✅ 完整支持 | 手动运行或用 launchd 管理 |
| **Windows / WSL** | ✅ 支持 | 推荐使用 WSL2 或 Git Bash 运行 shell 脚本 |
| **Windows 原生** | ⚠️ 部分支持 | PHP 代理可用；引擎侧建议在 WSL 中运行 |

---

## ⚙️ 配置说明

### API Key 配置

编辑 `config.php`：

```php
<?php
$config = [
    'minimax_api_key' => '你的-minimax-key',
    'deepseek_api_key' => '你的-deepseek-key',
    'default_model' => 'MiniMax/...',
    // 如有自定义 endpoint 或代理，在这里配置
    'custom_endpoints' => [
        'my-model' => 'https://my-custom-api.example.com/v1',
    ],
];
```

### 环境变量

```bash
ENGINE_PORT=8766      # engine_server.py 监听端口
ENGINE_HOST=0.0.0.0   # 绑定地址
LOG_LEVEL=INFO        # 日志级别
```

### 支持的模型

- **MiniMax** — `MiniMax/...`
- **DeepSeek** — `DeepSeek/...`
- **OpenAI** — `gpt-4o`、`gpt-4o-mini` 等
- **Anthropic** — `claude-3-5-sonnet` 等（通过自定义 endpoint）
- **任意 OpenAI 兼容 API** — 配置自定义 base URL 即可

---

## 📂 项目结构

```
oneapichat/
├── index.html              # 前端主入口（单页应用）
├── login.html              # 登录页
├── profile.html            # 用户资料页
├── chat.php                # 聊天记录页面
├── engine_api.php          # PHP 代理
├── engine_server.py        # Python SSE + Agent 引擎
├── engine_watchdog.sh      # 看门狗（自动重启引擎）
├── config.php              # API Key 和配置
├── auth.php                # 认证逻辑
├── css/
│   ├── style.css           # 主样式
│   └── tailwind.css       # Tailwind 工具类
├── js/
│   └── main.js             # 前端逻辑
├── chat_data/              # SQLite 聊天历史数据库
├── users/                  # 用户账户数据
├── uploads/                # 上传文件存放目录
├── docs/                   # 文档
└── deploy.sh               # 一键部署脚本
```

---

## 🔐 安全注意事项

- **不要将 `config.php`（或任何备份文件）提交到版本控制**
- API Key 仅在后端使用，PHP 代理不会将 Key 暴露给前端
- 引擎默认监听本地回环地址；如需暴露，仅在 PHP 代理之后暴露
- 生产环境请使用 HTTPS（推荐 Let's Encrypt / certbot）

---

## 📄 许可证

MIT License — 详见 [LICENSE](LICENSE)。

---

## 🔗 相关链接

- **GitHub 仓库：** `https://github.com/<your-username>/oneapichat`
- **问题反馈：** `https://github.com/<your-username>/oneapichat/issues`
- **在线演示：** `https://oneapichat.example.com`（替换为你的地址）
