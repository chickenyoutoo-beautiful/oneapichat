# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-05-26

### 🧠 Agent 三模式系统
- **Plan** 只读模式：仅搜索/读取，消息注入普通聊天
- **Agent** 交互模式：文件操作+命令，AI 可操作需用户审批
- **YOLO** 自主模式：所有操作自动批准（需物理 confirm 切换）
- Agent 对话独立化：不混入普通聊天历史，每次进入创建独立聊天
- 进入 Agent 模式自动携带对话上下文
- Agent 通知机制：基于 execId + sendMessage，防止并发重复激活

### 🔒 安全增强
- `autonomous_mode` 工具：Agent 模式 + 物理 confirm 双重确认
- `ask_agent` 工具：AI 请求启用 + 用户 confirm + 自动中止旧请求
- 用户菜单：个人中心 + 退出
- 多用户 API Key 加密存储，独立配置隔离
- CORS 动态匹配，移除硬编码 IP

### 🎨 UI 优化
- 全屏进入/退出动效（Plan 蓝 / Agent 紫 / YOLO 红）
- 触屏设备：单击弹菜单选模式，双击直接开关
- 命令面板：SVG 图标 + 毛玻璃样式
- PWA 支持：安装到桌面 + 离线缓存
- iOS Safari 键盘收起修复
- 侧边栏统一控制

### 🔧 平台 & 部署
- **Windows 支持** — `deploy.ps1` PowerShell 一键部署脚本
- 自动安装 PHP 8.3 + Python 3.12（winget / 官网下载）
- 跨平台 Python 路径处理（`Path(__file__).parent` 替代硬编码）
- `import fcntl` 加 try/except 兼容 Windows
- `download.php` 使用 `sys_get_temp_dir()` 替代硬编码 `/tmp/`
- Docker 多架构镜像（`linux/amd64` + `linux/arm64`）
- Dockerfile 完整重构 — supervisor 管理 nginx + PHP-FPM + engine
- 一键部署脚本 v2.0 — 支持 `curl | bash` 自动克隆安装
- GitHub Actions Release Workflow：推送 tag 自动构建

### ⚡ SSE 流式架构
- **SSE 流式后端** — Feature Flag 控制，Python FastAPI + SQLite 存储
- **ChatStore** — SQLite 消息持久化层，支持流式写入
- **心跳推送** — 引擎通过 SSE 推送到前端，支持后台通知
- SSE 事件解析：支持 content/reasoning/tool_call/done/error 事件类型
- 发送消息时自动重置滚动状态和流式跟随锁定

### 🔍 联网搜索
- Brave / Google / Tavily 多引擎支持
- AI 自动判断是否需要搜索
- 联网搜索按钮可开关，UI 整合进高级设置

### 🛠 刷课模块修复
- 刷课账号以学习通手机号为唯一标准，跨聊天账号共享进度
- `start_course` 跳过已完成课程，ON CONFLICT 不再重置 status
- 视频/答题计数修复：video_count=0 章节不参与完成计数
- `_update_course_stats` 自动更新课程 status=completed
- `video_logs` 表缺列修复（ALTER TABLE 添加 video_name 和 watched_at）
- 停止操作重置数据库中 in_progress 课程
- 错误日志改进：识别 traceback 连续段落，修复 KeyError 崩溃

### 📦 项目清理
- 删除全部测试文件和残留备份
- `.gitignore` 清理：排除 `.vs/`、`__pycache__`、`*.backup`、`users/`、`chat.php`、`rag/`（API Key）
- AGPL-3.0（主项目）+ MIT（刷课模块）双许可证声明
- 多语言 README（EN / ZH / JP）重写

---

## [1.0.0] - 2026-05-08

### Added
- **Docker 部署支持** — 完整多阶段构建，支持 linux/amd64 + linux/arm64
- **docker-compose 一键部署** — `docker compose up -d` 即可运行
- **一键部署脚本** — 适配 Ubuntu/Debian/CentOS/macOS，自动检测系统和安装方式
- **GitHub Actions Release Workflow** — 推送 tag 自动构建并发布 Docker 镜像到 GHCR
