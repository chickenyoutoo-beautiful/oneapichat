# OneAPIChat

**Multi-Model AI Chat Platform with Agent Support**

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
- Background task coordination via a built-in heartbeat/cron engine

### 🔍 Web Search
- AI automatically judges when to search the web
- Multiple search engines: DuckDuckGo, Brave Search, Google Custom Search
- Search types: general web, news, images
- `/search`, `/news`, `/image` commands for forced search

### 📡 Backend SSE Streaming
- Python engine (`engine_server.py`) on port **8766** handles SSE streaming
- PHP proxy (`engine_api.php`) bridges frontend and backend
- Real-time token-by-token display

### 👥 Multi-User & Multi-Terminal
- User authentication (PHP-based)
- Per-user chat history stored in SQLite
- Chat history import/export (JSON format)

### 🎨 UI Features
- Dark / Light mode toggle
- Responsive design (desktop + mobile)
- Markdown rendering with syntax highlighting
- File upload (text, Office docs, code, images)
- Conversation management (rename, delete, export)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│  Frontend  (index.html + JS/CSS)            │
│  Single-page app, no build step needed      │
└──────────────┬──────────────────────────────┘
               │ HTTP / SSE
┌──────────────▼──────────────────────────────┐
│  PHP Proxy  (engine_api.php)                │
│  Bridges frontend ↔ backend, handles auth   │
│  Port: standard HTTP (80/443)                │
└──────────────┬──────────────────────────────┘
               │ HTTP / SSE
┌──────────────▼──────────────────────────────┐
│  Python Engine  (engine_server.py)          │
│  SSE streaming, Agent logic, tool calling    │
│  Port: 8766 (configurable via ENGINE_PORT)  │
└─────────────────────────────────────────────┘
```

### Key Files

| File | Role |
|------|------|
| `index.html` | Frontend single-page app |
| `engine_server.py` | Python backend — SSE, Agent engine, heartbeat/cron |
| `engine_api.php` | PHP proxy — auth, routing, CORS |
| `engine_watchdog.sh` | Watchdog script — auto-restarts engine if it crashes |
| `config.php` | API keys and endpoint configuration |

---

## 🚀 Quick Start

### 1. Clone / Navigate

```bash
git clone <your-repo-url> oneapichat
cd oneapichat
```

### 2. Install Dependencies

**Python backend:**

```bash
pip install fastapi uvicorn openai httpx sse-starlette python-dotenv requests
```

**PHP frontend proxy** (on your web server):

```bash
# Install PHP 8+ and extensions if not present
# Most Linux: sudo apt install php php-curl php-sqlite3 php-mbstring
```

### 3. Configure & Run

```bash
# Set your API keys in config.php or as environment variables
# ENGINE_PORT=8766 python3 engine_server.py
```

**Or use the deploy script:**

```bash
chmod +x deploy.sh
./deploy.sh
```

> ⚠️ The deploy script handles environment setup, port binding, and service registration. Run it on a clean VPS or dev machine for a one-command deployment.

### 4. Open in Browser

```
http://your-server/
```

---

## 🌐 Multi-Platform

| Platform | Status | Notes |
|----------|--------|-------|
| **Linux** | ✅ Full support | systemd service + watchdog |
| **macOS** | ✅ Full support | Run engine manually or via launchd |
| **Windows / WSL** | ✅ Supported | Use WSL2 or Git Bash for shell scripts |
| **Windows (native)** | ⚠️ Partial | PHP proxy works; engine Python side best in WSL |

---

## ⚙️ Configuration

### API Keys

Edit `config.php`:

```php
<?php
$config = [
    'minimax_api_key' => 'your-minimax-key',
    'deepseek_api_key' => 'your-deepseek-key',
    'default_model' => 'MiniMax/...',
    // Custom base URLs for proxies or self-hosted models
    'custom_endpoints' => [
        'my-model' => 'https://my-custom-api.example.com/v1',
    ],
];
```

### Environment Variables

```bash
ENGINE_PORT=8766          # Port for engine_server.py
ENGINE_HOST=0.0.0.0        # Bind address
LOG_LEVEL=INFO             # Debug verbosity
```

### Model List

Supported model families (compatible with OpenAI API format):

- **MiniMax** — `MiniMax/...`
- **DeepSeek** — `DeepSeek/...`
- **OpenAI** — `gpt-4o`, `gpt-4o-mini`, etc.
- **Anthropic** — `claude-3-5-sonnet`, etc. (via custom endpoint)
- **Any OpenAI-compatible API** — configure custom base URL

---

## 📂 Project Structure

```
oneapichat/
├── index.html              # Main frontend SPA
├── login.html              # Login page
├── profile.html             # User profile page
├── chat.php                # Chat history page
├── engine_api.php          # PHP proxy
├── engine_server.py        # Python SSE + Agent engine
├── engine_watchdog.sh      # Auto-restart watchdog
├── config.php              # API keys & config
├── auth.php                # Auth logic
├── css/
│   ├── style.css           # Main styles
│   └── tailwind.css        # Tailwind utilities
├── js/
│   └── main.js             # Frontend logic
├── chat_data/              # SQLite chat history
├── users/                  # User accounts
├── uploads/                # Uploaded files
├── docs/                   # Documentation
└── deploy.sh               # One-command deploy script
```

---

## 🔐 Security Notes

- **Never commit `config.php`** (or `config.php.bak`) to version control
- API keys are backend-only; the PHP proxy does not expose keys to the frontend
- Engine runs on localhost by default; expose only behind the PHP proxy
- Use HTTPS in production (certbot / Let's Encrypt recommended)

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🔗 Links

- **GitHub Repo:** `https://github.com/<your-username>/oneapichat`
- **Issues:** `https://github.com/<your-username>/oneapichat/issues`
- **Demo:** `https://oneapichat.example.com` *(replace with your URL)*
