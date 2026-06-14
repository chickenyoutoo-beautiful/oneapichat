# OneAPIChat 项目架构指南

> 每次修改项目后，Agent 必须更新此文件（特别是「最近变更」章节）。

## 最近变更

- **2026-06-13**: 🔧 综合修复轮次 — ①RS+代理引擎侧URL映射 ②duplicate tool_call_id全局去重 ③MiniMax思考`(think)`标签大小写不敏感提取 ④max_tokens自动减小regex补充 ⑤`_engine_get` POST支持修复 ⑥`_generate_resumable`代理URL映射 ⑦`buildApiMessages`孤tool_call同步清理源消息
- **2026-06-12**: 🔒 强制认证 — `chat.php`+`engine_api.php`新增auth中间件,非public action返回401
- **2026-06-12**: 🔧 输入框溢出+MiniMax思考 — ①`.input-clip`裁剪容器+`background-color:inherit` ②`_backendSSEHandler`+RS双路径`(think)`提取+去重
- **2026-06-12**: 🔧 MCP mmx路由修复 — MCP server新增`/mmx`端点直接CLI调用,支持9个子命令
- **2026-06-12**: 🍪 超星cookie-first登录 — `api_get_courses.py/exam_api.py/start_exam.py`先试用Cookie获取课程,失效才登录
- **2026-06-12**: 🖥️ browser click/type三级降级 — 正常→force→evaluate派发DOM事件
- **2026-06-12**: 🔍 搜索引擎全走服务器代理 — Brave/Google/DuckDuckGo/Tavily统一走`engine_api.php?action=search_proxy`
- **2026-06-11**: 🤖 Skills系统+网页抓取增强
- **2026-06-10**: 🐛 RAG+Mermaid+MiniMax markdown修复
- **2026-06-08**: 🐛 RS刷新+刷课模块修复
- **2026-06-06**: 📦 Phase 0-9 代码拆分 + 🔒 安全升级 + ⚡ 懒加载

## 项目概览

多模型 AI 聊天客户端，深度集成超星学习通自动化、Agent 子代理系统、视频编辑、Cloudreve 云盘。

- **域名**: `https://naujtrats.xyz/oneapichat/`
- **许可证**: GPL-3.0
- **主分支**: `main`

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 原生 JS SPA（单文件 ~20K 行）、Tailwind CSS、KaTeX、Mermaid、Service Worker PWA |
| 后端 API | PHP 8.3 + php-fpm，JSON 文件存储 |
| 引擎 | Python FastAPI（端口 8766）、SQLite + JSON 文件存储 |
| 自动化 | Python 子进程（超星刷课/考试）、Flask + Celery（端口 8082） |
| 服务器 | Nginx 反向代理、Let's Encrypt SSL、Ubuntu WSL2 |

## 目录结构

```
/var/www/html/oneapichat/
├── api/              # PHP API 端点（认证、聊天、配置、引擎代理等 20+ 文件）
├── public/           # 前端静态资源
│   ├── index.html    # 主聊天 SPA 入口
│   ├── chaoxing.html # 超星刷课/考试面板
│   ├── js/core.js    # ★ 核心运行时 — 全局常量、DOM工具、加密、Cookie (Phase 0)
│   ├── js/main.js    # 主应用逻辑（~5,600 行，聊天/Agent/UI/工具执行）
│   ├── js/models.js  # 模型定义
│   ├── css/style.css # 主样式表
│   └── lib/lib/      # 第三方库（KaTeX、marked、mermaid、xlsx 等）
├── python/           # Python 后端
│   ├── engine_server.py # ★ 核心引擎（FastAPI, Agent, 流式, SSE, 视频, 浏览器）
│   ├── chaoxing/     # ★ 超星/考试模块（刷课、答题、考试、字体解密）
│   │   ├── main.py   # 超星自动化主入口
│   │   ├── scripts/  # 考试浏览器自动化脚本
│   │   └── learning_records.db  # 学习记录
│   └── engine/       # 引擎模块（浏览器、事件、策略、重试）
├── users/            # 用户数据（users.json, sessions.json, 配置, 记忆）
├── chat_data/        # 聊天历史 JSON 文件
├── .engine/          # 引擎运行时（SQLite 聊天 DB、Agent/Cron 状态）
├── uploads/          # 用户上传文件
├── deploy/           # 部署脚本、Docker、Nginx 配置
├── docs/             # 文档（README, CHANGELOG, LICENSE）
├── config/           # 配置文件（.mmx_config.json）
└── workspace/        # Agent 工作目录
```

## 服务端口与路由

| 路径 | 后端 | 端口 | 说明 |
|---|---|---|---|
| `/oneapichat/` | Nginx 静态 + PHP-FPM | 80/443 | 主应用 |
| `/engine/` | Python FastAPI | 8766 | Agent 引擎、SSE、流式 |
| `/rag/` | RAG 服务 | 8765 | 知识库检索 |
| `/mcp/` | Node.js MCP | 18788 | MCP 协议服务 |
| `/src/`, `/srcwebui/` | Flask | 8082 | 星穹铁道自动化 |
| `/py/` | Flask | 8082 (远程) | Python 后端 |

## 关键 PHP API

| 文件 | 功能 |
|---|---|
| `api/auth.php` | 用户认证（注册/登录/Token/邮箱验证） |
| `api/chat.php` | 聊天 CRUD + 用户配置同步 |
| `api/config.php` | 用户设置保存/加载 |
| `api/chaoxing_api.php` | 超星自动化枢纽（课程列表、刷课、考试） |
| `api/engine_api.php` | ★ 引擎代理（Agent/工作流/SSE 广播/浏览器/文件/MiniMax） |
| `api/proxy.php` | API 代理中继 |
| `api/upload.php` | 文件上传 |
| `api/fetch.php` | URL 抓取代理 |
| `api/memory_api.php` | 跨会话记忆系统 |
| `api/cloudreve_api.php` | Cloudreve 云盘桥接 |

## 核心 JS 模块

| 文件 | 行数 | 内容 |
|---|---|---|
| `js/core.js` | 309 | ★ 全局常量、数学公式保护、跨域Cookie、安全Fetch、DOM工具、加密、工具函数 |
| `js/image-gen.js` | 490 | 图像生成（generateImage / generateImageI2I / OpenRouter GPT Image） |
| `js/markdown.js` | 490 | 流式渲染（applyStreamRender）、MarkdownRenderer缓存、ChartRenderer/Mermaid |
| `js/main.js` | 3,116 | 主应用逻辑（聊天、Agent、工具执行） |
| `js/stream-handler.js` | 1,238 | 流式/非流式响应处理 (Phase 10 拆分) |
| `js/tools.js` | 1,502 | 工具定义、toolRegistry、工具分类和中文标签 |
| `js/commands.js` | 210 | /斜杠命令解析与分派 (Phase 9 拆分) |
| `js/resume-stream.js` | 158 | 可恢复流式续接模块 (Phase 9 拆分) |
| `js/models.js` | ~300 | 模型配置适配 |

- **聊天流**: `sendMessage()` → `attemptRequestWithFreshAbort()` → SSE/非流式处理
- **ResumeStream**: 可恢复流模块 — 刷新后从引擎续接（`ResumeStream.create/resume/resumeByStreamId`）
- **SSE 事件总线**: `connectSSEChannel()` → 跨浏览器实时同步（`/engine/events`）
- **Agent 审批**: `requestToolApproval()` → YOLO 自动 > 临时授权 > Plan 拒绝 > 弹窗
- **任务恢复**: `_recoverActiveTasks()` → 刷新后从 SQLite 恢复活跃流
- **消息队列**: `window._messageQueue` → localStorage 持久化 + 500ms 节流
- **402 降级**: 自动提取可负担 token 数，降低 `max_tokens` 后重试
- **临时权限**: `_tempAgentGranted` → ask_agent 单次授权 + 绿灯呼吸动画

## 引擎 API（engine_server.py）

| 端点 | 方法 | 功能 |
|---|---|---|
| `/engine/health` | GET | 健康检查 |
| `/engine/chat/create` | POST | 创建可恢复流 → 返回 `stream_id` |
| `/engine/chat/stream/{id}` | GET | 消费 SSE 流（断线续传） |
| `/engine/events` | GET | ★ 用户级 SSE 通道（跨浏览器实时推送） |
| `/engine/events/broadcast` | POST | 广播事件到同用户其他连接 |
| `/engine/tasks/active` | GET | 获取活跃任务（跨浏览器恢复） |
| `/engine/agent/*` | CRUD | Agent 管理（创建/运行/状态/停止/通知） |
| `/engine/cron/*` | CRUD | 定时任务管理 |
| `/engine/workflow/*` | CRUD | 工作流管理 |
| `/engine/file_*` | CRUD | 文件操作（read/write/search/op） |
| `/engine/heartbeat` | GET/POST | 心跳 + 推送 |
| `/engine/mmx` | POST | MiniMax 多模态（TTS/图片/视频/搜索） |
| `/engine/browser_*` | CRUD | 浏览器自动化 |
| `/engine/video_edit` | POST | 视频编辑管道 |

## 系统服务

| 服务 | 状态 |
|---|---|
| `php8.3-fpm` | active |
| `nginx` | active |
| `oneapichat-engine.service` | Python 引擎（8766） |
| `oneapichat-py.service` | Flask 后端（8082） |
| `chromium-cdp.service` | 浏览器自动化 |

**守护脚本**: `/var/www/html/oneapichat/engine_watchdog.sh`（每分钟 cron 检查引擎健康）

## 数据存储

| 位置 | 内容 | 格式 |
|---|---|---|
| `users/users.json` | 用户账户 | JSON |
| `users/sessions.json` | 会话 Token | JSON（30 天过期） |
| `chat_data/user_*_*.json` | 聊天历史 | JSON（per-user + per-chat） |
| `.engine/chat_*.db` | 流式进度 + 活跃任务 | SQLite |
| `.engine/memory/` | Agent 记忆/人格 | JSON |
| `python/chaoxing/learning_records.db` | 超星课程进度 | SQLite |
| `uploads/` | 用户文件 | 文件系统 |

## 已知问题与注意事项

1. `public/` 下 `lib/`、`resource/`、`src/` 多一层嵌套（`lib/lib/` 等），项目根有符号链接指向内层
2. `index_root.html` 为独立入口（已从 git 恢复），通过根符号链接访问
3. `python/chaoxing/search_question.py` → 根 `api/search_question.py` 通过符号链接访问
4. 密钥硬编码：AES 密钥 `naujtrats-secret` 在 `api/init.php` 和 `main.js` 中
5. 会话 Cookie 域 `.naujtrats.xyz` 用于跨子域共享
6. `keepalive: false` 用于配置保存 fetch（因 body 可能超 64KB）
7. 引擎重启时旧的 `_resumable` 内存状态丢失，但 SQLite `active_tasks` 表保留
