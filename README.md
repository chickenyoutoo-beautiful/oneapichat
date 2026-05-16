# OneAPIChat

**Self-hosted AI Chat Platform — Multi-Model, Agent-Powered, SSE Streaming, Exam Automation**

🚀 **Live Demo**: [naujtrats.xyz/oneapichat](https://naujtrats.xyz/oneapichat)

---

🌐 **Language**: [English](./README.md) | [中文](./README.zh-CN.md) | [日本語](./README.ja-JP.md)

---

A modern, self-hosted AI chat interface that connects to any OpenAI-compatible API. Features autonomous Agent mode with dynamic tool registration, real-time SSE streaming, web search integration, multi-user support, and a clean responsive UI.

| 🧠 **Multi-Model** | 🤖 **Agent Mode** | 🔍 **Web Search** | 📡 **SSE Streaming** | 📝 **Exam Module** |
|---------------------|-------------------|-------------------|----------------------|---------------------|
| MiniMax, DeepSeek, OpenAI + any compatible API | Autonomous agents with dynamic tool registration | Brave, Google, Tavily engines | Real-time token-by-token output | Chaoxing exam automation with selective start |

---

## Table of Contents

- [Screenshots & Features](#-screenshots--features)
- [Quick Start](#-quick-start)
- [Deployment](#-deployment)
  - [One-Click Script](#one-click-script)
  - [Docker](#docker)
  - [Manual Setup](#manual-setup)
- [Configuration](#%EF%B8%8F-configuration)
- [Project Structure](#-project-structure)
- [刷课 Module (Chaoxing Automation)](#-刷课-module-chaoxing-automation)
- [License](#-license)

---

## 📸 Screenshots & Features

### 🤖 Multi-Model Support
Connect to any OpenAI-compatible endpoint. Built-in profiles for **MiniMax**, **DeepSeek**, **OpenAI**, and **Anthropic** with custom base URLs per model. Model routing and automatic fallback.

### 🧠 Agent Mode
Enable Agent mode for autonomous task execution — the AI can spawn sub-agents, search the web, execute code, and manage files. **v3.0 introduces dynamic tool registration** — tools auto-render in the UI panel, no HTML editing required. New tools include exam automation (list, start, monitor, stop), course overview, and login state detection. Persistent agent state, notification system, and cron-based scheduling.

### 🔍 Web Search with Smart Judgment
The AI automatically decides when to search the web for real-time information. Supports **Brave Search**, **Google Custom Search**, and **Tavily**. Results are automatically organized and summarized.

### 📝 Chaoxing Exam Automation
New in v3.0: full exam lifecycle management. **Selective exam start** — choose specific exams to take instead of all at once. **Auto-pause study** to avoid anti-cheat detection. **Real-time progress** with start/end time display. **Independent logging** — exam and study logs never mix. Auto-resume study after exam completion.

### 📡 SSE Real-Time Streaming
Server-Sent Events power token-by-token streaming for instant response display. Progress survives page refresh — pick up where you left off.

### 👥 Multi-User & Multi-Device
User isolation with encrypted API key storage. Chat history import/export in JSON format. Per-user configuration. Works seamlessly on desktop and mobile.

### 🎨 Clean UI
Dark/light mode toggle, Markdown rendering with KaTeX math formula support, code syntax highlighting, file upload support, and responsive design.

---

## 🚀 Quick Start

### Prerequisites
- **PHP 8.0+** (proxy layer)
- **Python 3.10+** (backend engine)
- An API key from any OpenAI-compatible provider

---

## ☁️ Deployment

### One-Click Script (Linux / macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/chickenyoutoo-beautiful/oneapichat/main/deploy.sh | bash
```

Automatically detects your OS (Ubuntu, Debian, CentOS, macOS) and install method (Docker or native).

### Docker (Any Platform)

```bash
# Quick run
docker run -d -p 8080:8080 --name oneapichat \
  ghcr.io/chickenyoutoo-beautiful/oneapichat:latest

# Or with docker-compose
curl -fsSL https://raw.githubusercontent.com/chickenyoutoo-beautiful/oneapichat/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

Supports `linux/amd64` and `linux/arm64` — works on Raspberry Pi, Synology NAS, and QNAP devices.

### Manual Setup

```bash
# 1. Clone the repository
git clone https://github.com/chickenyoutoo-beautiful/oneapichat.git
cd oneapichat

# 2. Install Python dependencies
pip install fastapi uvicorn aiofiles python-multipart

# 3. Start the backend engine
python3 engine_server.py &

# 4. Start PHP server
php -S localhost:8080
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

---

## ⚙️ Configuration

### Adding API Keys
1. Open the settings panel in the UI
2. Enter your API key and base URL
3. Select your model

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGINE_PORT` | `8766` | Backend engine port |
| `ENGINE_HOST` | `0.0.0.0` | Engine bind address |
| `LOG_LEVEL` | `INFO` | Logging level |

### Supported Models
- **MiniMax** — `MiniMax/...`
- **DeepSeek** — `DeepSeek/...`
- **OpenAI** — `gpt-4o`, `gpt-4o-mini`, etc.
- **Anthropic** — `claude-3-5-sonnet` via custom endpoint
- Any **OpenAI-compatible API** — set a custom base URL

---

## 📁 Project Structure

```
.
├── index.html              # Main chat UI (SPA)
├── login.html              # Login page
├── profile.html            # User profile
├── main.js                 # Core frontend logic
├── css/
│   ├── style.css           # Custom styles
│   └── tailwind-index.min.css
├── js/
│   ├── models.js           # Model configuration
│   └── translations.js     # i18n strings
├── engine_server.py        # Python backend (FastAPI)
├── engine_api.php          # PHP proxy layer
├── engine_watchdog.sh      # Auto-restart watchdog
├── auth.php                # Authentication
├── config.php              # API key & endpoint config
├── chat.php                # Chat history viewer
├── deploy.sh               # Cross-platform deploy script
├── Dockerfile              # Docker image
├── docker-compose.yml      # Docker Compose config
├── nginx.conf              # Nginx configuration
├── docs/                   # Documentation
├── LICENSE                 # AGPL-3.0
└── NOTICE                  # License details
```

---

## 📖 刷课 Module (Chaoxing Automation)

*This is an optional add-on — the platform works fully without it.*

OneAPIChat includes a web interface for **Chaoxing (超星/学习通) course automation** — an independent module integrated for convenience.

### Study (刷课)
- Viewing course completion progress
- Starting/stopping automated course watching
- Configurable playback speed
- Optional question bank integration
- Per-user tracking and statistics

### Exam (考试) — New in v3.0
- **Selective exam start** — check which exams to take, don't fire all at once
- **Start/end time display** per exam
- **Auto-pause study** on exam start to avoid anti-cheat detection
- **Auto-resume study** after exam completion
- **Independent logging** — exam and study logs never interfere
- **Tool engine integration** — 5 exam tools registered for AI agent use
- **Login state detection** — AI checks auth status before asking for credentials

Access the web UI at `/chaoxing.html` after deployment.

For GitHub Actions-based cloud operation, see the workflow at `.github/workflows/`.

---

## 📄 License

| Component | License | Source |
|-----------|---------|--------|
| **OneAPIChat (main project)** | **AGPL-3.0** | [LICENSE](./LICENSE) |
| **刷课 module** (chaoxing automation) | **GPL-3.0** | [LICENSES/GPL-3.0.txt](./LICENSES/GPL-3.0.txt) — derived from [Samueli924/chaoxing](https://github.com/Samueli924/chaoxing) |
| **One-API** (interface management dependency) | **MIT** | [songquanpeng/one-api](https://github.com/songquanpeng/one-api) |

See [`NOTICE`](./NOTICE) for the full licensing breakdown.

---

## 🙏 Acknowledgments

- [songquanpeng/one-api](https://github.com/songquanpeng/one-api) — API management gateway
- [Samueli924/chaoxing](https://github.com/Samueli924/chaoxing) — Chaoxing automation engine (GPL-3.0)
- [KaTeX](https://katex.org/) — Math formula rendering
- [Mermaid](https://mermaid.js.org/) — Diagram rendering
- All open-source contributors
