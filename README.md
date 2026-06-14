# OneAPIChat

**Self-hosted multi-model AI chat platform with autonomous agent system, resumable streaming, and learning automation.**

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/badge/release-v2.0.0-green)](https://github.com/chickenyoutoo-beautiful/oneapichat/releases)

🌐 **Language**: [English](./README.md) | [中文](./docs/README.zh-CN.md) | [日本語](./docs/README.ja-JP.md)

---

## Overview

OneAPIChat is a self-contained, single-server AI conversation platform designed for deep customization and autonomous task execution. It connects to any OpenAI-compatible API endpoint and extends the conversation loop with tool-calling, multi-agent delegation, browser automation, and persistent streaming.

### Architecture

```
Browser (SPA) → Nginx → PHP 8.3 (API) → Python FastAPI (Engine)
                    ↳ SSE Streaming (Resumable)
                    ↳ WebSocket (Cross-device sync)
```

### Key Features

| Category | Capability |
|---|---|
| **Model Support** | MiniMax, DeepSeek, Grok, OpenAI + any compatible API |
| **Agent System** | Multi-agent delegation, role-based tool scoping, parallel execution |
| **Streaming** | Resumable SSE with SQLite persistence — refresh without data loss |
| **Tool System** | 54 tools: web search, file I/O, browser automation, image gen, TTS, cron |
| **Chaoxing** | Automated course playback, exam assistance, progress tracking |
| **Multi-User** | AES-256-GCM encrypted auth, per-user data isolation, server-side config sync |
| **Browser** | Playwright-based CDP automation with three-level click fallback |
| **Proxy** | Built-in HTTP/SOCKS5 proxy relay for API calls |

---

## Quick Start

### Requirements

- Ubuntu/Debian (or WSL2)
- PHP 8.3 + php-fpm
- Python 3.11+ with `pip`
- Nginx (or PHP built-in server for development)
- Optional: Chromium/Chrome (for browser automation)

### Installation

```bash
# 1. Clone
git clone https://github.com/chickenyoutoo-beautiful/oneapichat.git /var/www/html/oneapichat

# 2. Permissions
sudo chown -R www-data:www-data /var/www/html/oneapichat

# 3. Python dependencies
cd /var/www/html/oneapichat/python
pip install -r requirements.txt

# 4. Nginx config
sudo cp deploy/nginx-oneapichat.conf /etc/nginx/sites-enabled/
sudo nginx -s reload

# 5. Start engine
python engine_server.py &

# 6. Access
open https://your-domain/oneapichat/
```

### Windows

Download `oneapichat-v2.0.0-windows.tar.gz` from [Releases](https://github.com/chickenyoutoo-beautiful/oneapichat/releases), extract, and run `start.bat`. Requires PHP 8.3 and Python 3.11 in PATH.

---

## Project Structure

```
oneapichat/
├── api/                  # PHP endpoints (auth, chat, engine proxy, chaoxing)
├── public/               # SPA frontend (Vanilla JS, Tailwind CSS)
│   └── js/               # 28 modules: agent, tools, stream-handler, etc.
├── python/               # Python FastAPI engine
│   ├── engine_server.py  # Main engine (SSE, Agent, Workflow, Cron)
│   ├── engine/           # Core modules (browser, store, cron, workflow)
│   └── chaoxing/         # Chaoxing automation
├── users/                # User data (JSON file-based)
├── chat_data/            # Chat history (per-user JSON)
├── .engine/              # Engine runtime (SQLite, agent state, cron)
├── uploads/              # User uploads and generated media
├── deploy/               # Nginx configs, Docker files
└── docs/                 # Documentation
```

---

## Configuration

### API Keys

Configure in the Settings panel (gear icon) or via `config.ini`:

- **Main API**: Any OpenAI-compatible endpoint + key
- **MiniMax**: Token Plan API key (for TTS, image gen, search)
- **Search**: Brave / Google / Tavily API keys
- **Vision**: MiniMax Vision API or compatible

### Agent Modes

| Mode | Behavior |
|---|---|
| **Plan** | Creates execution plan, asks for approval per step |
| **Agent** | Autonomous execution, approval for high-risk tools only |
| **YOLO** | Full autonomy, no approval prompts |

---

## Development

```bash
# Frontend
cd public/
npx tailwindcss -i css/tailwind.css -o css/tailwind-index.min.css --watch

# Engine
cd python/
uvicorn engine_server:app --reload --port 8766

# PHP
php -S localhost:8080 -t public/
```

---

## License

GPL-3.0 — See [LICENSE](LICENSE)
