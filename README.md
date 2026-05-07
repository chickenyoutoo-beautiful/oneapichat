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

## 📄 License

**GPL-3.0 License**

This project is licensed under the GNU General Public License v3.0.

This project incorporates **刷课 · AutomaticCB** (学习通自动化刷课脚本), which is also licensed under [GPL-3.0](https://github.com/Samueli924/chaoxing). Any derivative works that include this code must also be released under GPL-3.0.

---

## 🙏 Acknowledgments

- [Samueli924/chaoxing](https://github.com/Samueli924/chaoxing) — 学习通自动化刷课脚本 (GPL-3.0)
- All open-source library contributors
