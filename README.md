# OneAPIChat

**Multi-Model AI Chat Platform with Agent Support**

🚀 **Live Demo**: https://naujtrats.xyz/oneapichat

---

🌐 **Language / 语言 / 言語**: [English](./README.md) | [中文](./README.zh-CN.md) | [日本語](./README.ja-JP.md)

---

A self-hosted AI chat platform that connects to multiple model providers (MiniMax, DeepSeek, OpenAI-compatible APIs), featuring an Agent mode with autonomous tool-calling, web search, SSE streaming, and multi-user support.

---

## 🌟 Features

### 🤖 Multi-Model Support
- Connect to any OpenAI API-compatible endpoint
- Built-in support for **MiniMax**, **DeepSeek**, and more
- Model routing and fallbacks
- Custom API base URLs and keys per model

### 🧠 Agent Mode
- Autonomous sub-agent spawning and management
- Tool calling: web search, code execution, file operations
- Persistent agent state and notification system
- Cron-scheduled task triggers

### 🔍 Web Search
- Smart search judgment — AI decides when to search
- Multiple engines: Brave Search, Google Custom Search, Tavily
- Search result auto-organization and summarization

### 📡 SSE Streaming
- Real-time streaming responses via Server-Sent Events
- Backend Python engine with SQLite persistence
- Progress resumable after page refresh

### 👥 Multi-User & Multi-Terminal
- User isolation with encrypted API keys
- Chat history import/export
- Configurable per-user settings

### 🎨 UI/UX
- Dark/Light mode
- Markdown rendering with syntax highlighting
- Responsive design for desktop and mobile

---

## 🚀 Quick Start

### Prerequisites
- PHP 8.0+ (for the proxy layer)
- Python 3.10+ (for the backend engine)
- OneAPI or OpenAI-compatible API key

### One-Command Deploy

```bash
chmod +x deploy.sh && ./deploy.sh
```

Then open `http://localhost:8080` in your browser.

### Manual Setup

**1. Clone the repository**
```bash
git clone https://github.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch.git
cd Webui-aichat-supportwebsearch
```

**2. Install Python dependencies**
```bash
pip install fastapi uvicorn aiofiles python-multipart
```

**3. Start the backend engine**
```bash
python3 engine_server.py &
```

**4. Start PHP server**
```bash
php -S localhost:8080
```

---

## 📁 Project Structure

```
.
├── index.html          # Main chat UI
├── main.js              # Core frontend logic
├── style.css            # Styles
├── engine_api.php       # PHP proxy layer
├── engine_server.py     # Python backend (Agent/Cron/SSE)
├── fetch.php            # Web fetch utility
├── deploy.sh            # Cross-platform deploy script
├── LICENSE              # GPL-3.0 License
└── README.md            # This file
```

---

## ⚙️ Configuration

### API Configuration
1. Open the settings panel
2. Enter your API key and base URL
3. Select your model

### Agent Mode
Enable Agent mode in settings to unlock sub-agent spawning, tool calling, and cron tasks.

---

## 📖 刷课 · AutomaticCB 使用说明

本平台集成了**学习通自动化刷课脚本**，支持通过 GitHub Actions 云端无人值守刷课。

### 🚀 快速开始

**第一步：Fork 本仓库**

点击本仓库右上角 **Fork** 按钮，将仓库 fork 到你的 GitHub 账号下。

**第二步：设置 GitHub Secrets**

刷课账号信息**必须**通过 GitHub Secrets 传入（禁止明文写在代码中）：

1. 进入你 fork 的仓库 → **Settings** → 左侧 **Secrets and variables** → **Actions** → **New repository secret**
2. 添加以下三个 secret：

| Secret 名称 | 值 | 说明 |
|-------------|-----|------|
| `CHAOXING_USERNAME` | 学习通手机号 | 登录账号 |
| `CHAOXING_PASSWORD` | 学习通密码 | 登录密码 |
| `CHAOXING_COURSE_ID` | 课程 ID | 学习通课程 ID，多个用逗号分隔 |

**第三步：开启 GitHub Actions**

1. 进入仓库 → **Actions** 页面
2. 如果提示 "Workflows must be enabled within the repository settings to run"，点击 **I understand my workflows, go ahead and enable them**
3. 点击左侧 **刷课** workflow → 右侧 **Run workflow** → 选择 `main` 分支 → 点击 **Run workflow**

**第四步：查看刷课进度**

点击 workflow run 详情 → **Run main.py** 步骤展开日志，即可看到刷课实时进度。

### ⏰ 定时自动刷课（可选）

如果需要每天定时自动执行，编辑 `.github/workflows/main.yml`，取消以下注释：

```yaml
on:
  push:
    branches: [ main ]
  schedule:
    - cron: "0 8 * * *"   # 每天北京时间 8:00 自动运行
```

### 📋 本地运行

```bash
# 安装依赖
pip install -r requirements.txt

# 手动运行
python main.py -u 你的手机号 -p 你的密码 -l 课程ID
```

### ⚠️ 注意事项

- 仓库默认**公开**，Secrets 不会被泄露（GitHub 已做保护）
- 如担心账号安全，可在仓库 Settings → **Change visibility** 中将仓库设为 **Private**
- 禁止将本项目用于商业用途
- 基于 [Samueli924/chaoxing](https://github.com/Samueli924/chaoxing) 开发，遵循 GPL-3.0 协议

---

## 📄 License

**GPL-3.0 License**

This project is licensed under the GNU General Public License v3.0.

This project incorporates **刷课 · AutomaticCB** (学习通自动化刷课脚本), which is also licensed under [GPL-3.0](https://github.com/Samueli924/chaoxing). Any derivative works that include this code must also be released under GPL-3.0.

---

## 🙏 Acknowledgments

- [Samueli924/chaoxing](https://github.com/Samueli924/chaoxing) — 学习通自动化刷课脚本 (GPL-3.0)
- All open-source library contributors
