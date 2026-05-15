```markdown
# NAUJTRATS AI Chat Assistant - Code Documentation & User Guide

## 1. Project Overview

**NAUJTRATS AI Chat Assistant** is a feature-rich web-based AI conversation app supporting multi-model integration, file parsing, web search, intelligent context management, and more. Built with a pure frontend architecture, all data is stored locally for privacy, with perfect desktop and mobile compatibility.

### 🎯 Core Features
- **Multi-Model Support**: OpenAI API compatible (DeepSeek, Ollama, etc.)
- **File Parsing**: Text, Word, Excel, PDF, etc. (≤10MB)
- **Smart Search**: AI judgment + DuckDuckGo/Brave/Google (web/news/images)
- **Context Optimization**: Auto-compression + Smart Token adjustment
- **Real-time Streaming**: Word-by-word display with thinking visualization
- **Internationalization**: Multi-language UI + Dynamic prompts
- **Responsive Design**: Mobile gestures + Keyboard adaptation
- **Advanced Interactions**: Message edit/regenerate, Auto-title, Reset to defaults

### 📱 Deployment
- **Single-File**: Just `index.html` + `main.js` + `lib/` folder
- **GitHub Pages**: Upload repo, CDN accelerated
- **Local Run**: Open in browser, no server needed

## 2. Code Structure (v16.8)

### 2.1 Global Configuration
```javascript
const DEFAULT_CONFIG = {
    url: 'https://oneapi.naujtrats.xyz/v1',  // Default API
    model: 'deepseek-chat',
    system: 'You are a helpful assistant...', // Time context aware
    enableSearch: false,                     // Web search
    aiSearchJudge: true,                     // AI judgment (default on)
    // ... Full config in main.js
};
```

### 2.2 Core Modules Breakdown

| Module | Key Functions | Description |
|--------|---------------|-------------|
| **Utils** | `encrypt/decrypt`, `estimateTokens`, `extractFileContent` | Encryption, Token estimation, File parsing (mammoth/XLSX) |
| **UI Mgmt** | `appendMessage`, `toggleDarkMode`, `handleResize` | Message rendering, Theme toggle, Responsive layout |
| **Config** | `saveConfig`, `fetchModels`, `resetToDefault` | Persistence, Model refresh, Reset button |
| **Search** | `aiShouldSearch`, `performWebSearch`, `aiChooseSearchType` | AI judge (true/false), Multi-type search, Result formatting |
| **Messaging** | `sendMessage`, `streamResponse`, `handleSearchFlow` | Full send flow, Streaming parse, Search integration |
| **Chat Mgmt** | `createNewChat`, `loadChat`, `compressContextIfNeeded` | Create/switch/delete, Auto-compress, Title generation |

### 2.3 v16.8 Updates/Optimizations
- **On-Demand Time Injection**: User-specified time baseline (e.g., "Assume 2026")
- **Enhanced Search Judgment**: Keyword fallback + Regex boost
- **i18n Fixes**: Dynamic prompt switching, Translation cache
- **Reset to Defaults Button**: One-click full reset
- **UI Cleanup**: Removed redundants (hideReasoning, etc.)

## 3. User Guide

### 3.1 🚀 Quick Start (5 Minutes)
1. **API Setup**:
   ```
   Settings → API Key + Base URL → Refresh Models
   ```
2. **Chat**:
   - Type question → Enter to send
   - Drag files → Auto-parse & attach
3. **Smart Search**:
   - Enable "Enable Web Search" + "AI Smart Judgment"
   - Example: `What's the weather today?` → Auto-searches

### 3.2 📎 File Upload
```
Supported: .txt .md .js .py .docx .xlsx .csv etc.
Usage: Click 📎 or drag → Preview → Send
Example: [Attachment: data.csv] Analyze sales data
```

### 3.3 🌐 Web Search
```
Auto-Trigger: today/latest/news/weather keywords
Commands:
/search keyword     # Web
/news iPhone 16     # News
/image cats         # Images

Config: Search engine + API Key + Region (cn/us)
Results: 【Raw Web Search Results】 → AI response
```

### 3.4 💬 Message Actions
| Action | Icon | Description |
|--------|------|-------------|
| Copy | 📋 | Copy plain text |
| Edit | ✏️ | Edit & resend user msg |
| Regenerate | 🔄 | Rerun AI response |
| Stop | ⏹️ | Abort generation |

### 3.5 🎛️ Settings Panel
```
Basic: System prompt / Temperature / Tokens
Display: Font size (12-24px) / Line height / Paragraph spacing
Search: AI judge model / Custom prompt / Timeout (5-120s)
Advanced: Custom JSON params / Markdown GFM
```

## 4. Configuration Details

### 4.1 System Prompt (Key)
```
Default includes:
- Knowledge cutoff + Search rules
- Time context priority (user > real-time)
Custom: You are a code reviewer...
```

### 4.2 Advanced Search
```
AI Judge Prompt:
"Rules: Time/news/real-time → true; History/math → false"
Type: web/news/images (AI auto)
Persist: Append to system messages
```

## 5. Technical Details

### 5.1 Data Flow
```
User input → Search judge → [Search → Inject] → API → Stream render
Token Safety: Context estimation + Auto max_tokens
```

### 5.2 Storage & Security
- localStorage: chats/config (encrypted keys)
- Auto-Cleanup: Keep last 10 chats
- XSS: Full escapeHtml

### 5.3 Performance
- Throttling: Scroll/resize
- Lazy-Load: marked/hljs/mammoth/xlsx
- Rate-Control: reasoningDelay/contentDelay

## 6. Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| API Fail | Wrong Key/URL | Verify creds, test curl |
| Search Empty | No Key/Proxy | Setup Brave API or proxy |
| File Parse Fail | Unsupported | Convert to TXT/CSV |
| Token Limit | Long history | Enable compress, clear chat |
| Mobile Lag | Keyboard clash | Update browser, delay=0 |

**Debug**: F12 → Console → `logDebug('test')`

## 7. GitHub Deployment Guide

### 7.1 Repo Structure
```
naujtrats-ai-chat/
├── index.html      # Main page (embeds main.js)
├── main.js         # Core v16.8
├── lib/            # Dependencies
│   ├── marked.min.js
│   ├── highlight.min.js
│   ├── mammoth.browser.min.js
│   └── xlsx.full.min.js
├── README.md       # This doc
└── LICENSE
```

### 7.2 Quick Deploy
1. Fork or upload files
2. **GitHub Pages**: Settings → Pages → Deploy from `main` branch
3. Visit: `https://github.com/chickenyoutoo-beautiful/oneapichat`
4. Customize: Users set API Key locally

### 7.3 Customization
- Edit `DEFAULT_CONFIG.url/model`
- Add lang: `translations.json`
- Themes: CSS vars `--chat-font-size` etc.

## 8. Changelog (v16.8)
```
2026 Updates:
✓ On-demand time + Search enhancements
✓ i18n + Dynamic prompts
✓ Reset defaults button
✓ Cleanup: Removed hideReasoning etc.
```

**Deps**: Serverless, pure CDN/local

## 9. Contributing & Support
- ⭐ Star / Fork repo
- Issues: Bugs/ideas
- PRs: Welcome code improvements

**Privacy**: 100% local, no tracking
**Browsers**: Chrome 100+ / Firefox / Safari

---

**Doc Version**: v16.8 (2026)
**Author**: NAUJTRATS Team
**License**: MIT
```
