# OneAPIChat

**自托管多模型 AI 聊天平台 — 69 个 MCP 工具、Agent 子代理、可恢复流式、超星学习通自动化**

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/badge/release-v2.1.0-green)](https://github.com/chickenyoutoo-beautiful/oneapichat/releases)

🌐 **Language**: [中文](./README.md) | [English](./docs/README.en.md)

---

## 功能亮点

| 分类 | 能力 |
|---|---|
| 🤖 **模型支持** | DeepSeek / MiniMax / Grok / OpenAI / Anthropic + 任意兼容 API |
| 🔧 **工具系统** | **69 个 MCP 工具** — 搜索、B站、超星、Cloudreve、MiniMax、浏览器、服务器、文档生成 |
| 🎯 **Agent 系统** | 多 Agent 委派、角色工具隔离、并行执行、计划/Agent/YOLO 三模式 |
| 📡 **可恢复流式** | SSE + SQLite 持久化 — 刷新页面不丢数据 |
| 📚 **超星学习通** | 自动刷课 + 考试辅助 + 扫码登录(QR) + 进度追踪 |
| 🎨 **AI 创作** | 图片生成、PPT/Word/Excel/PDF 文档生成、视频编辑 |
| 🔐 **多用户** | AES-256-GCM 加密认证、用户数据隔离、跨设备配置同步 |
| 🌐 **REST API** | OpenAI 兼容 `/v1/chat/completions` + `/v1/tools/call` — 第三方客户端即插即用 |
| 🖥️ **浏览器自动化** | Playwright CDP 三级点击回退 |
| 🔄 **跨设备同步** | SSE 事件广播 + 消息队列持久化 |

---

## 快速开始

### 环境要求

- Ubuntu/Debian (或 WSL2)
- PHP 8.3 + php-fpm
- Python 3.11+
- Nginx
- Node.js (MCP Server)
- 可选: Chromium (浏览器自动化)

### 安装

```bash
git clone https://github.com/chickenyoutoo-beautiful/oneapichat.git /var/www/html/oneapichat
cd /var/www/html/oneapichat

# 权限
sudo chown -R www-data:www-data .

# Python 依赖
cd python && pip install -r requirements.txt && cd ..

# MCP Server
cd ../mcp-server && npm install && cd ../oneapichat

# Nginx
sudo cp deploy/nginx-oneapichat.conf /etc/nginx/sites-enabled/
sudo nginx -s reload

# 启动服务
python python/engine_server.py &          # 引擎 (8766)
node mcp-server/server.js &               # MCP (18788)

# 访问
open https://your-domain/oneapichat/
```

---

## 架构

```
浏览器 (SPA) ──→ Nginx ──→ PHP 8.3 (API)
                │              ├── chat/completions (OpenAI 兼容)
                │              ├── tools/call → MCP Server (:18788)
                │              │                  ├── Node.js handlers
                │              │                  ├── Python bridge
                │              │                  └── MiniMax CLI
                │              └── engine_api → Python FastAPI (:8766)
                │                                 ├── Agent/Workflow/Cron
                │                                 ├── 文档生成 (PPT/Word/Excel/PDF)
                │                                 ├── 文件 I/O
                │                                 └── 浏览器自动化
                └── SSE Streaming ←→ 跨设备同步
```

---

## 工具分类 (69 tools)

| 分类 | 数量 | 工具 |
|------|:--:|------|
| 🔍 搜索与获取 | 3 | web_search, web_fetch, platform_extract |
| 🎨 图像 | 3 | generate_image, generate_image_i2i, analyze_image |
| 📺 B站 | 7 | bilibili_search, bilibili_video_info, bilibili_article_read, bilibili_user_profile, bilibili_comment_list, bilibili_dynamic_list, bilibili_qr_login |
| 📊 办公文档 | 4 | generate_ppt, generate_docx, generate_xlsx, generate_pdf |
| 🎬 视频 | 2 | video_understanding, video_edit |
| 📚 超星学习通 | 13 | chaoxing_login, chaoxing_qr_login, chaoxing_auto, chaoxing_status 等 |
| ☁️ Cloudreve | 14 | cr_list_files, cr_search_files, cr_create_share 等 |
| 💻 服务器 | 15 | server_exec, server_file_read, server_docker 等 |
| 🌐 浏览器 | 6 | browser_navigate, browser_screenshot 等 |
| 🎵 MiniMax | 8 | mmx_chat, mmx_image, mmx_speech, mmx_music 等 |
| 🤖 Agent | 5 | delegate_task, plan_update, ask_agent 等 |

---

## API 接入

OneAPIChat 提供 OpenAI 兼容的 REST API，支持 ChatBox、NextChat、LobeChat 等第三方客户端。

```bash
# 获取 API Key
# 设置面板 → API 密钥 → 创建新密钥 (格式: oac-<48hex>)

# 对话
curl https://your-domain/oneapichat/api/v1/chat/completions \
  -H "Authorization: Bearer oac-xxx..." \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}]}'

# 执行工具
curl https://your-domain/oneapichat/api/v1/tools/call \
  -H "Authorization: Bearer oac-xxx..." \
  -H "Content-Type: application/json" \
  -d '{"name":"bilibili_search","arguments":{"keyword":"教程","limit":3}}'
```

详见 [API.md](./API.md)

---

## Agent 模式

| 模式 | 行为 |
|---|---|
| **Plan** | 创建执行计划，逐步请求审批 |
| **Agent** | 自主执行，仅高风险工具需审批 |
| **YOLO** | 完全自主，无需审批 |

---

## 配置

在设置面板（齿轮图标）配置：

- **主 API**: 任意 OpenAI 兼容端点 + Key
- **MiniMax**: Token Plan API Key (TTS、图片生成、搜索)
- **搜索引擎**: Tavily / Brave / Google / DuckDuckGo
- **网络代理**: HTTP/SOCKS5 代理中继

---

## 开发

```bash
# 前端
cd public/
npx tailwindcss -i css/tailwind.css -o css/tailwind-index.min.css --watch

# 引擎
cd python/
uvicorn engine_server:app --reload --port 8766

# MCP Server
node mcp-server/server.js

# PHP
php -S localhost:8080 -t public/
```

---

## 目录结构

```
oneapichat/
├── api/                  # PHP 端点 (auth, chat, engine proxy, tools/call)
│   └── v1/               # REST API v1 (OpenAI 兼容)
├── public/               # SPA 前端 (Vanilla JS, Tailwind CSS)
│   └── js/               # 核心模块 (agent, tools, stream-handler)
├── python/               # Python FastAPI 引擎
│   ├── engine_server.py  # 主引擎 (SSE, Agent, Workflow, Cron)
│   ├── engine/           # 核心模块
│   └── chaoxing/         # 超星自动化
├── mcp-server/           # Node.js MCP Server (69 tools)
├── users/                # 用户数据
├── chat_data/            # 聊天历史
├── uploads/              # 上传 & 生成文件
├── deploy/               # Nginx/Docker 部署
└── docs/                 # 文档
```

---

## License

GPL-3.0 — See [LICENSE](LICENSE)
