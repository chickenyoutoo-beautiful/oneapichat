# OneAPIChat

**全栈多模型 AI 创作与自动化平台 — All-in-One Docker、60+ MCP 工具链、Agent 编排系统、超星学习通全自动化、Cloudreve 云盘与模型代理网关**

🚀 **在线演示**: [naujtrats.xyz/oneapichat](https://naujtrats.xyz/oneapichat)

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/badge/release-v4.1.0-green)](https://github.com/chickenyoutoo-beautiful/oneapichat/releases)
[![Docker](https://img.shields.io/badge/Docker-All--in--One-blue?logo=docker)](https://github.com/chickenyoutoo-beautiful/oneapichat/releases/tag/v4.1.0)

---

🌐 **多语言**: [English](../README.md) | [中文](./README.zh-CN.md)

---

OneAPIChat 是一个现代化的自托管多模型 AI 创作与自动化平台。它不仅提供了高度灵活的 AI 对话与深度思考体验，更通过 All-in-One Docker 容器化方案将 **自主 Agent（动态工具生态）**、**可恢复流式通信 (SSE)**、**超星学习通刷课/考试全自动化**、**Cloudreve v4 个人云盘** 和 **CLIProxyAPI (CPA) 代理网关** 深度熔接为统一整体。

| 🧠 **多模型与思考** | 🤖 **Agent 智能体** | 🐳 **全栈容器化** | 📚 **超星全自动化** | ☁️ **Cloudreve 云盘** |
|---|---|---|---|---|
| Gemini 3.8/3.7、GPT-5/o3、Claude、DeepSeek、xAI (7档思考切换) | Plan / Agent / YOLO 三模式 + 三级正交权限 | All-in-One 镜像 + 317MB 离线可移植包 | 视频多倍速、AI搜题、考试辅助、Cookie属主接管 | 单点登录 (SSO)、嵌入式文件管理、断点续传 |

---

## 目录

- [📸 核心功能全景](#-核心功能全景)
- [☁️ 部署与使用方式](#%EF%B8%8F-部署与使用方式)
  - [方式一：Docker Compose 全栈部署 (推荐)](#方式一docker-compose-全栈部署-推荐)
  - [方式二：无网络/全新机器离线一键移植包](#方式二无网络全新机器离线一键移植包)
  - [方式三：外部反代与域名绑定 (Nginx)](#方式三外部反代与域名绑定-nginx)
  - [方式四：源码本地开发运行](#方式四源码本地开发运行)
- [🔒 权限与各级自愈机制](#-权限与各级自愈机制)
- [📦 数据持久化目录](#-数据持久化目录)
- [🌐 开放 API 接入 (OpenAI 兼容)](#-开放-api-接入-openai-兼容)
- [📱 移动端与桌面客户端](#-移动端与桌面客户端)
- [📄 许可协议](#-许可协议)

---

## 📸 核心功能全景

### 🤖 1. 全生态多模型与 7 档精细思考切换
- **全主流协议打通**：原生支持 Google Gemini 3.8/3.7 系列、OpenAI o1/o3/GPT-5 系列、Anthropic Claude、DeepSeek、xAI 及任意标准 OpenAI 兼容 API。
- **7 档深度思考控制**：在输入框右下角直选 `Default` / `Off` / `Minimal` / `Low` / `Medium` / `High` / `XHigh` / `Max`，底层根据模型提供商（Gemini thinking_config vs OpenAI reasoning_effort）自动适配，彻底杜绝 400 报错。
- **多模态与多媒体**：支持超大图高精度 OCR 识别、图生图编辑（`/images/edits`），以及本地 MP4 视频关键帧时间戳密集采样与视觉理解。

### 🎯 2. 经典 Agent 三模式与三级正交权限
- **运行模式**：
  - **Plan 模式**：模型先拟定执行计划，每一步均需用户审批确认后执行（蓝色胶囊）。
  - **Agent 模式**：自主规划并执行常用工具，遇到高危系统操作时弹出审批（绿色胶囊）。
  - **YOLO 模式**：全自动全速免审批执行，适合流水线与自动化编排（红色胶囊）。
- **工作区权限**：
  - **🛡️ Read only (只读)**：仅允许查看文件与检索信息。
  - **✏️ Workspace write (工作区写入)**：允许向当前工作区读写文件与产出交付物。
  - **⚡ Full access (全盘访问)**：完全放开底层文件系统与运维权限。

### 🔧 3. 60+ 生产级工具生态
- **联网搜索与采集**：自然语言逐轮意图分流，智能决定联网搜索或纯 AI 回复，搜索结果去重与优雅降级卡片。
- **办公文档一键生成**：一句话生成精美排版的 PPT 幻灯片、Word 文档 (.docx)、Excel 统计表 (.xlsx) 与 PDF 交付物。
- **系统与服务器运维**：Shell 命令执行、Docker 容器诊断与管理 (`server_docker`)、代码沙箱执行。
- **浏览器自动化**：基于 Playwright CDP 的网页无头导航、元素点击与全页快照捕获。

### 📚 4. 超星学习通自动化系统
- **课程自动化**：课程列表拉取、多倍速视频学习、章节自动切换、防作弊检测打卡。
- **AI 智能搜题**：言溪题库 + DeepSeek 智能语义回退，答题精准度大幅提升。
- **考试全生命周期**：可选性开考指定科目，开考自动暂停刷课防风控，考试结束自动恢复。
- **权限自愈与防死锁**：Cookie 写入采用 `tempfile.mkstemp` + `os.replace` 原子替换与属主接管，彻底杜绝跨用户互锁。

### ☁️ 5. Cloudreve v4 个人云盘集成
- **单点登录 (SSO)**：主站登录后一键跳转进入云盘，持久化缓存自动自愈，容器重启后免重新登录。
- **嵌入式文件管理器**：在聊天侧边栏直接唤起云盘文件列表，支持递归目录检索、大文件分片上传与外链分享。

### 🔄 6. 跨设备实时流式镜像与多端同步
- **服务端唯一生产者**：服务端原子写入磁盘快照，杜绝弱网吞消息与闪退。
- **Observer 实时流镜像**：另一台设备打开同一会话时，毫秒级同步模型打字机与工具执行时间线。
- **空白草稿免回源防 404**：本地新建草稿未落盘前不发起服务端无谓请求，404 状态立即熔断重试。

### 🎨 7. 主题工坊 (Theme Studio)
- **多套现代外观**：DSH 极简紫灰、经典玻璃轻卡片、极简冷白等。
- **阅读轨道排版**：760px 黄金居中阅读廊道，行距与气泡间距即时滑块可调。
- **全景使用统计**：精准还原历史会话的真实 Token 用量、多模型分布占比与按天趋势柱状图。

---

## ☁️ 部署与使用方式

### 方式一：Docker Compose 全栈部署 (推荐)

一键启动 Web 主站、FastAPI 引擎、超星刷课、Cloudreve 云盘、CPA 代理网关与 Nginx：

```bash
# 1. 克隆代码库
git clone https://github.com/chickenyoutoo-beautiful/oneapichat.git
cd oneapichat/deploy

# 2. 配置环境变量
cp .env.example .env
# 可按需配置域名绑定与映射端口（默认 8080）
nano .env

# 3. 启动容器
docker compose up -d
```

启动完成后即可直接访问：
- **OneAPIChat 主站**：`http://<服务器IP或域名>:8080/`
- **超星刷课平台**：`http://<服务器IP或域名>:8080/oneapichat/chaoxing.html`
- **Cloudreve 云盘**：`http://<服务器IP或域名>:8080/cloudreve/`（或直连 `:5212`）
- **CPA 代理管理面板**：`http://<服务器IP或域名>:8080/cpa/`（或直连 `:8317/management.html`）
- **CPA OpenAI 兼容端点**：`http://<服务器IP或域名>:8080/v0/v1/chat/completions`

---

### 方式二：无网络/全新机器离线一键移植包

在没有构建网络环境或全新海外/国内服务器上，直接使用自包含便携包：

1. 从 [GitHub Releases](https://github.com/chickenyoutoo-beautiful/oneapichat/releases/tag/v4.1.0) 下载 `oneapichat-bundle-v4.1.0.tar.gz`（约 317MB）。
   *(或在已有环境运行 `./deploy/export.sh` 现场生成)*
2. 解压并一键导入启动：
   ```bash
   tar -xzf oneapichat-bundle-v4.1.0.tar.gz
   cd oneapichat-bundle-*
   ./import.sh
   ```

---

### 方式三：外部反代与域名绑定 (Nginx)

若宿主机已有 Nginx 并需要配置域名与 HTTPS 证书，反代配置如下：

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

### 方式四：源码本地开发运行

```bash
git clone https://github.com/chickenyoutoo-beautiful/oneapichat.git /var/www/html/oneapichat
cd /var/www/html/oneapichat

# 1. 安装 Python 依赖
pip install -r python/requirements.txt

# 2. 复制配置模板
cp config.ini.template config.ini

# 3. 启动后台引擎
python3 python/engine_server.py &

# 4. 配置并启动 Nginx / PHP-FPM
```

---

## 🔒 权限与各级自愈机制

为了彻底根除 Linux 权限死锁与 Permission Denied：
1. **启动自愈**：`entrypoint.sh` 启动时递归将持久化目录所有权赋予 `www-data:www-data`，全量目录设置 SGID (`2775`) 与 `umask 0002`，保障子进程创建的文件自动具有组读写权限。
2. **后台看门狗**：`perms-healer.sh` 由 Supervisor 以 root 身份常驻，每 60 秒轮询保障超星数据库与 Cookies 的读写权限。
3. **原子替换属主接管**：Cookies 文件改写使用 `tempfile.mkstemp` + `os.replace`，无缝突破原有用户权限限制并接管所有权。

---

## 📦 数据持久化目录

在宿主机挂载的 `./data` 结构如下：
- `data/users/`：用户账户、Token 与设置
- `data/chat_data/`：会话历史与单会话归档
- `data/uploads/`：聊天附件与 AI 生图文件
- `data/chaoxing_records/`：超星刷课 SQLite 数据库
- `data/automatic_cb/`：超星运行时任务与日志
- `data/cloudreve/`：Cloudreve 云盘数据库 (`cloudreve.db`) 与配置
- `data/cloudreve_uploads/`：云盘文件存储
- `data/cpa_auths/`：CPA 代理网关凭据与配置
- `data/logs/`：Nginx、PHP、FastAPI 引擎与代理日志

---

## 🌐 开放 API 接入 (OpenAI 兼容)

```bash
# 对话端点
curl https://your-domain/oneapichat/api/v1/chat/completions \
  -H "Authorization: Bearer oac-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "你好，请介绍一下你自己"}]
  }'
```

详见 [API.md](../API.md)。

---

## 📱 移动端与桌面客户端

- **Android 原生客户端**：基于 Capacitor 深度定制，支持状态栏融入与手势返回，安装包见 Releases。
- **桌面客户端**：基于 Electron 构建，支持 Windows、Linux 与 macOS。
- **Web PWA**：支持浏览器“添加到主屏幕”，秒变独立全屏应用体验。

---

## 📄 许可协议

本项目基于 [GPL-3.0 License](../LICENSE) 开源。
