# OneAPIChat

**全栈多模型 AI 创作与自动化平台 — All-in-One Docker、60+ MCP 工具链、Agent 编排系统、超星学习通全自动化、Cloudreve 云盘与模型代理网关**

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/badge/release-v4.1.0-green)](https://github.com/chickenyoutoo-beautiful/oneapichat/releases)
[![Docker](https://img.shields.io/badge/Docker-All--in--One-blue?logo=docker)](https://github.com/chickenyoutoo-beautiful/oneapichat/releases/tag/v4.1.0)

🌐 **语言 / Language**: [中文](./README.md) | [English](./docs/README.en.md)

---

## 🌟 核心特性全景

```text
               ┌────────────────────────────────────────────────────────┐
               │              宿主机 / 反向代理 (可选 SSL)                │
               └───────────────────────────┬────────────────────────────┘
                                           │ :8080 (或 :80)
                                           ▼
┌────────────────────────────────── Docker 容器 ──────────────────────────────────┐
│                                                                                │
│   ┌────────────────────────────────────────────────────────────────────────┐   │
│   │                      Nginx 统一反代与动静网关                           │   │
│   │  - 静态资源托管 & 动静分离                                             │   │
│   │  - 全局自适应 CORS 与 WebSocket / SSE 长连接透传                       │   │
│   │  - 自动域名识别 / 端口自适应                                           │   │
│   └──────┬──────────────┬──────────────┬──────────────┬────────────────────┘   │
│          │              │              │              │                        │
│          │ /oneapichat/ │ /engine/     │ /cloudreve/  │ /cpa/ & /v0/           │
│          ▼              ▼              ▼              ▼                        │
│     PHP 8.2-FPM    FastAPI Engine   Cloudreve       CLIProxyAPI (CPA)         │
│     (认证/会话API) (流式对话/Agent) (云盘v4/Aria2)  (模型中继/面板)          │
│     unix socket     :8766          :5212          :8317                        │
│          │              │              │              │                        │
│          └──────┬───────┴──────────────┴──────────────┘                        │
│                 ▼                                                              │
│     [ Supervisor 守护进程 + Permissions Healer 权限看门狗 ]                    │
│     (持续监控进程健康，每 60 秒自愈学习记录 SQLite 与 Cookies 读写权限)        │
└────────────────────────────────────────────────────────────────────────────────┘
```

| 维度 | 核心特性与支撑能力 |
|---|---|
| 🐳 **All-in-One 容器** | **全栈打包**：单容器同时纳管 Web 主站、FastAPI 引擎、超星刷课、Cloudreve 云盘、CPA 代理网关与 Nginx。<br>**离线可移植**：仅 317MB 离线包，`build.sh` / `export.sh` / `import.sh` 一键跨机迁移。 |
| 🤖 **多模型与深度思考** | **全主流支持**：Gemini 3.8/3.7、OpenAI o1/o3/GPT-5、Claude、DeepSeek、xAI 及任意 OpenAI 兼容端点。<br>**7 档思考强度**：Default / Off / Minimal / Low / Medium / High / XHigh / Max 原生透传。<br>**多模态理解**：高分辨率图像 OCR、视觉分析与本地 MP4 关键帧密集提取理解。 |
| 🎯 **Agent 智能体** | **三运行模式**：Plan 模式（规划后审批）、Agent 模式（自主执行高危审批）、YOLO 模式（全自动免确认）。<br>**三级正交权限**：🛡️ Read only (只读) / ✏️ Workspace write (工作区写入) / ⚡ Full access (全盘完全访问)。<br>**自主工程管线**：多子代理并行调度、长任务进度 HUD、死锁与死循环自愈防御。 |
| 🔧 **工具生态 (60+ Tools)** | **联网与信息**：自然语言智能搜索（Tavily/Brave/Google）、网页清洗提取、AI 生图与图生图。<br>**文档与办公**：自动化生成 PPT 演示文稿、Word (.docx)、Excel (.xlsx) 与 PDF。<br>**系统与运维**：安全沙箱 Shell 执行、文件读写、Docker 容器运维、浏览器自动化 (CDP)。<br>**生活与行情**：高德地图路线规划、全球主要股票与指数实时行情分析。 |
| 📚 **超星学习通全自动化** | **刷课自愈**：多倍速播放、自动选课、章节连续自适应学习、断点记录持久化。<br>**AI 搜题**：言溪题库 + DeepSeek 多层级互补答题。<br>**考试辅助**：考试列表拉取、可选性开考控制、自动暂停刷课防风控。<br>**登录防御**：支持手机验证码与扫码登录 (QR)，Cookie 采用原子替换与属主接管，彻底杜绝权限死锁。 |
| ☁️ **Cloudreve 个人云盘** | **无缝单点登录 (SSO)**：与主站账户自动打通，持久化缓存自愈，重启免重登。<br>**云文件管理**：Web 端嵌入式文件管理器、目录递归检索、大文件断点续传、直链与外部分享。 |
| 🔄 **跨设备实时镜像** | **权威单生产者**：服务端原子落盘，毫秒级 SSE Observer 流镜像打字机。<br>**跨端即时对齐**：模型选择、思考强度、工具步骤多端毫秒同步；空白草稿免回源防 404 熔断。 |
| 🎨 **主题工坊 (Theme Studio)** | **自适应主题**：DSH 极简紫灰、经典玻璃、极简冷白等现代主题，支持深浅模式一键切换。<br>**阅读排版**：760px 黄金居中廊道、助手行距与气泡间距实时滑动调节。<br>**全景使用统计**：真实模型驱动的 Token 消耗分析、排行热力图与按天趋势柱状图。 |

---

## 🚀 快速开始与部署方式

### 方式一：Docker Compose 全栈一键部署（最推荐）

OneAPIChat 提供预置的 All-in-One Docker 编排配置，所有子服务开箱即用。

#### 1. 克隆仓库并进入部署目录
```bash
git clone https://github.com/chickenyoutoo-beautiful/oneapichat.git
cd oneapichat/deploy
```

#### 2. 配置环境变量
```bash
cp .env.example .env
# 可按需编辑 .env 配置域名绑定与端口（默认端口 8080）
nano .env
```

`.env` 常用配置示例：
```ini
# 宿主机映射端口
PORT=8080

# 绑定自定义域名（留空则自动通配支持 IP、localhost 与任意来源）
DOMAIN=chat.yourdomain.com

# 外部反代是否启用 SSL
SSL_ENABLED=true

# CPA 代理管理密钥
CPA_API_KEY=cpa-your-secret-key
```

#### 3. 启动全栈容器
```bash
docker compose up -d
```

启动完成后，容器内部会自动完成权限自愈与服务引导，即可通过浏览器访问：
- **OneAPIChat 主站**：`http://<服务器IP或域名>:8080/`
- **超星刷课平台**：`http://<服务器IP或域名>:8080/oneapichat/chaoxing.html`
- **Cloudreve 云盘**：`http://<服务器IP或域名>:8080/cloudreve/`（或直连 `:5212`）
- **CPA 代理管理面板**：`http://<服务器IP或域名>:8080/cpa/`（或直连 `:8317/management.html`）
- **CPA OpenAI 接口**：`http://<服务器IP或域名>:8080/v0/v1/chat/completions`

---

### 方式二：无网络/全新机器离线一键移植包

若您需要在无 Docker 构建环境、海外网络受限或全新服务器上极速部署，可直接使用离线移植包：

1. **从 Release 下载离线包**：
   前往 [GitHub Releases](https://github.com/chickenyoutoo-beautiful/oneapichat/releases/tag/v4.1.0) 下载 `oneapichat-bundle-v4.1.0.tar.gz`（约 317MB）。
   *(或者在本机执行 `./deploy/export.sh` 现场生成最新移植包)*

2. **在目标服务器上一键解压并启动**：
   ```bash
   tar -xzf oneapichat-bundle-v4.1.0.tar.gz
   cd oneapichat-bundle-*
   ./import.sh
   ```
   脚本将自动导入本地 Docker 镜像层、创建标准数据持久化目录并一键拉起容器，无需在线下载任何镜像依赖。

---

### 方式三：外部反向代理与域名绑定配置（Nginx）

如果您希望在宿主机使用已有 Nginx 绑定域名并配置 HTTPS 证书，请使用以下推荐配置：

```nginx
server {
    listen 80;
    server_name chat.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name chat.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/chat.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.yourdomain.com/privkey.pem;

    client_max_body_size 4096M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 必须开启：支持 SSE 流式打字与 WebSocket 长连接
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 7200s;
        proxy_send_timeout 7200s;
    }
}
```

---

### 方式四：源码本地开发部署

#### 环境要求
- Linux / macOS / WSL2
- PHP 8.2+ 与 php-fpm、curl、mbstring、sqlite3 扩展
- Python 3.11+
- Nginx
- Node.js 18+

#### 启动步骤
```bash
git clone https://github.com/chickenyoutoo-beautiful/oneapichat.git /var/www/html/oneapichat
cd /var/www/html/oneapichat

# 1. 安装 Python 依赖
pip install -r python/requirements.txt

# 2. 初始化配置文件
cp config.ini.template config.ini

# 3. 启动 Python 引擎
python3 python/engine_server.py &

# 4. 配置 Nginx 站点并访问 http://localhost/oneapichat/
```

---

## 🔒 权限控制与各级自愈机制

针对 Linux 宿主机常见的 **UID/GID 冲突**、`Permission denied: cookies_u_*.pkl` 以及 SQLite 锁互锁问题，系统实现了三重自愈防御：

1. **容器入口权限自愈 (`entrypoint.sh`)**：
   - 启动时自动将数据卷（`users/`、`chat_data/`、`uploads/`、`chaoxing/`、`cloudreve/`、`cpa/`）递归修正为 `www-data:www-data`。
   - 所有存储目录设置 SGID (`chmod 2775`)，配合 `umask 0002`，保障所有子进程创建的新文件自动继承属组并具备读写权限。
2. **后台权限看门狗 (`perms-healer.sh`)**：
   - 由 Supervisor 以 root 用户独立常驻，每 60 秒轮询保障学习记录数据库 `learning_records.db*` 与超星 Cookies 的 `664`/`2775` 权限。
3. **代码层原子写入与属主接管**：
   - 超星 Cookies 写入采用 `mkstemp` + `chmod 0660` + `os.replace` 原子替换，无论由哪种用户创建均可被当前进程无缝接管。

---

## 📦 数据持久化挂载结构

在宿主机的 `./data` 目录中，数据结构如下：
- `data/users/`：用户账户、认证 Token 与个人偏好
- `data/chat_data/`：会话历史记录与单会话归档文件
- `data/uploads/`：用户上传的附件、文档与 AI 生成的图片
- `data/chaoxing_records/`：超星刷课记录 SQLite 数据库
- `data/automatic_cb/`：刷课日志与运行时配置
- `data/cloudreve/`：Cloudreve 云盘数据库 (`cloudreve.db`) 与配置
- `data/cloudreve_uploads/`：云盘用户上传的文件内容
- `data/cpa_auths/`：CPA 代理网关认证授权凭证
- `data/logs/`：Nginx、PHP、FastAPI 引擎与代理日志

跨机器移植时，只需保留或同步整个 `data/` 目录即可完整保留全部数据！

---

## 🌐 开放 API 接入 (OpenAI 兼容)

OneAPIChat 内置标准 OpenAI 兼容 REST API，可直接接入 ChatBox、NextChat、LobeChat、Cherry Studio 等第三方客户端：

```bash
# 对话端点
curl https://your-domain/oneapichat/api/v1/chat/completions \
  -H "Authorization: Bearer oac-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "你好，请介绍一下你自己"}]
  }'

# 工具调用端点
curl https://your-domain/oneapichat/api/v1/tools/call \
  -H "Authorization: Bearer oac-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "web_search",
    "arguments": {"query": "最新人工智能资讯", "num_results": 3}
  }'
```

详细 API 契约参阅 [API.md](./API.md)。

---

## 📱 移动端与桌面客户端

- **Android 原生客户端**：基于 Capacitor 构建，支持原生状态栏融入与手势回退，安装包位于 Releases 中。
- **桌面客户端**：基于 Electron 构建（支持 Windows / Linux / macOS）。
- **Web PWA**：支持浏览器直接“添加到主屏幕”，秒变独立应用体验。

---

## 📄 许可协议

本项目基于 [GPL-3.0 License](LICENSE) 开源。
