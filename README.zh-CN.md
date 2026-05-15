# OneAPIChat

**自托管 AI 聊天平台 — 多模型 · Agent 模式 · SSE 流式输出**

🚀 **在线演示**: [naujtrats.xyz/oneapichat](https://naujtrats.xyz/oneapichat)

---

🌐 **多语言**: [English](./README.md) | [中文](./README.zh-CN.md) | [日本語](./README.ja-JP.md)

---

一个现代化的自托管 AI 聊天界面，对接任意 OpenAI 兼容 API。支持自主 Agent 模式（工具调用）、实时 SSE 流式响应、联网搜索、多用户管理，界面简洁且响应式适配移动端。

| 🧠 **多模型** | 🔧 **Agent 模式** | 🔍 **联网搜索** | 📡 **SSE 流式** |
|---------------|-------------------|-----------------|------------------|
| MiniMax、DeepSeek、OpenAI + 任意兼容 API | 自主子 Agent + 工具调用 | Brave、Google、Tavily | 逐 Token 实时输出 |

---

## 目录

- [功能概览](#-功能概览)
- [快速开始](#-快速开始)
- [部署方式](#-部署方式)
  - [一键脚本](#一键脚本)
  - [Docker](#docker)
  - [手动部署](#手动部署)
- [配置说明](#%EF%B8%8F-配置说明)
- [项目结构](#-项目结构)
- [刷课模块（超星自动化）](#-刷课模块超星自动化)
- [许可协议](#-许可协议)

---

## 📸 功能概览

### 🤖 多模型支持
兼容 OpenAI API 格式，可对接任意模型 endpoint。内置 **MiniMax**、**DeepSeek**、**OpenAI**、**Anthropic** 等模型配置，每个模型可独立设置 API Base URL 和 Key。支持模型路由与自动切换。

### 🧠 Agent 模式
启用 Agent 模式后，AI 可自主执行任务——派发子 Agent、联网搜索、执行代码、操作文件。包含持久化 Agent 状态、通知系统和 Cron 定时调度。

### 🔍 智能联网搜索
AI 自动判断是否需要联网获取实时信息。支持 **Brave Search**、**Google Custom Search**、**Tavily** 多个搜索引擎，结果自动整理与摘要。

### 📡 SSE 实时流式
基于 Server-Sent Events 的逐 Token 流式输出，延迟极低。页面刷新后可恢复对话进度。

### 👥 多用户多终端
用户隔离，API Key 加密存储。支持聊天记录 JSON 导入/导出，每用户独立配置。桌面端和移动端完美适配。

### 🎨 精致界面
深色/浅色模式一键切换，Markdown 渲染 + KaTeX 数学公式 + 代码语法高亮，支持文件上传。

---

## 🚀 快速开始

### 环境要求
- **PHP 8.0+**（代理层）
- **Python 3.10+**（后端引擎）
- 任意 OpenAI 兼容 API Key

---

## ☁️ 部署方式

### 一键脚本（Linux / macOS）

```bash
curl -fsSL https://raw.githubusercontent.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch/main/deploy.sh | bash
```

自动检测操作系统（Ubuntu、Debian、CentOS、macOS）和安装方式（Docker 或原生）。

### Docker（任意平台）

```bash
# 快速启动
docker run -d -p 8080:8080 --name oneapichat \
  ghcr.io/chickenyoutoo-beautiful/webui-aichat-supportwebsearch:latest

# 或使用 docker-compose
curl -fsSL https://raw.githubusercontent.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

同时支持 `linux/amd64` 和 `linux/arm64`，树莓派、群晖 NAS、威联通等设备均可运行。

### 手动部署

```bash
# 1. 克隆仓库
git clone https://github.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch.git
cd Webui-aichat-supportwebsearch

# 2. 安装 Python 依赖
pip install fastapi uvicorn aiofiles python-multipart

# 3. 启动后端引擎
python3 engine_server.py &

# 4. 启动 PHP 服务器
php -S localhost:8080
```

浏览器打开 [http://localhost:8080](http://localhost:8080) 即可使用。

---

## ⚙️ 配置说明

### 添加 API Key
1. 打开界面中的设置面板
2. 填入 API Key 和 Base URL
3. 选择要使用的模型

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENGINE_PORT` | `8766` | 后端引擎端口 |
| `ENGINE_HOST` | `0.0.0.0` | 引擎监听地址 |
| `LOG_LEVEL` | `INFO` | 日志级别 |

### 支持模型
- **MiniMax** — `MiniMax/xxx`
- **DeepSeek** — `DeepSeek/xxx`
- **OpenAI** — `gpt-4o`、`gpt-4o-mini` 等
- **Anthropic** — 通过自定义 endpoint 接入 `claude-3-5-sonnet`
- 任意 **OpenAI 兼容 API** — 设置自定义 Base URL 即可

---

## 📁 项目结构

```
.
├── index.html              # 主聊天界面（单页应用）
├── login.html              # 登录页
├── profile.html            # 用户设置页
├── main.js                 # 核心前端逻辑
├── css/
│   ├── style.css           # 自定义样式
│   └── tailwind-index.min.css
├── js/
│   ├── models.js           # 模型配置
│   └── translations.js     # 国际化字符串
├── engine_server.py        # Python 后端（FastAPI）
├── engine_api.php          # PHP 代理层
├── engine_watchdog.sh      # 自动重启守护脚本
├── auth.php                # 用户认证
├── config.php              # API Key 与 endpoint 配置
├── chat.php                # 聊天记录查看
├── deploy.sh               # 跨平台部署脚本
├── Dockerfile              # Docker 镜像
├── docker-compose.yml      # Docker Compose 配置
├── nginx.conf              # Nginx 配置
├── docs/                   # 文档目录
├── LICENSE                 # AGPL-3.0
└── NOTICE                  # 许可说明
```

---

## 📖 刷课模块（超星自动化）

*这是一个可选的附加功能——平台完全无需此模块即可正常使用。*

OneAPIChat 附带了一个**超星（学习通）自动化刷课**的 Web 界面，作为独立模块集成。支持功能：

- 查看课程完成进度
- 启动/停止自动刷课任务
- 配置播放倍速与刷课模式
- 可选题库配置

部署后访问 `/chaoxing.html` 即可使用。

如需通过 GitHub Actions 云端运行，详见 `.github/workflows/` 下的 Action 配置。

---

## 📄 许可协议

| 组件 | 许可 | 说明 |
|------|------|------|
| **OneAPIChat（主项目）** | **AGPL-3.0** | [LICENSE](./LICENSE) |
| **刷课模块**（超星自动化） | **GPL-3.0** | [LICENSES/GPL-3.0.txt](./LICENSES/GPL-3.0.txt) — 继承自 [Samueli924/chaoxing](https://github.com/Samueli924/chaoxing) |
| **One-API**（接口管理依赖） | **MIT** | [songquanpeng/one-api](https://github.com/songquanpeng/one-api) |

详见 [`NOTICE`](./NOTICE)。

---

## 🙏 致谢

- [songquanpeng/one-api](https://github.com/songquanpeng/one-api) — API 管理网关
- [Samueli924/chaoxing](https://github.com/Samueli924/chaoxing) — 超星刷课引擎（GPL-3.0）
- [KaTeX](https://katex.org/) — 数学公式渲染
- [Mermaid](https://mermaid.js.org/) — 图表渲染
- 所有开源贡献者
