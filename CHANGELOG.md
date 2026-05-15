# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-05-15

### Added
- **SSE 流式后端** — Feature Flag 控制，Python FastAPI + SQLite 存储，页面刷新可恢复进度
- **ChatStore** — SQLite 消息持久化层，支持流式写入
- **Agent 模式** — 自主子 Agent 派发、工具调用（搜索/代码/文件）、持久化状态
- **Cron 任务系统** — 浏览器端管理定时任务，后台引擎自动调度
- **心跳推送** — 引擎通过 SSE 推送到前端，支持后台通知
- **多用户隔离** — 用户 API Key 加密存储，独立配置
- **联网搜索** — Brave/Google/Tavily 多引擎，AI 自动判断
- **Docker 多架构** — `linux/amd64` + `linux/arm64` 双架构镜像
- **一键部署脚本 v2.0** — 支持 `curl | bash` 自动克隆安装
- **Dockerfile 完整重构** — supervisor 管理 nginx+PHP-FPM+engine

### Fixed
- 部署脚本：PHP 版本自动检测、Unix socket 路径、CentOS/macOS 兼容
- Dockerfile：缺失 supervisor、BuildKit 语法兼容、nginx 配置
- `.gitignore`：清理 `.vs/`、`__pycache__` 等不应追踪的文件
- LICENSE：修正为 AGPL-3.0（主项目）+ GPL-3.0（刷课模块）
- CORS：移除硬编码 IP，改为动态匹配
- 删除全部测试文件和残留备份

---

## [1.0.0] - 2026-05-08

### Added
- **Docker 部署支持** — 完整多阶段构建，支持 linux/amd64 + linux/arm64
- **docker-compose 一键部署** — `docker compose up -d` 即可运行
- **一键部署脚本** — 适配 Ubuntu/Debian/CentOS/macOS，自动检测系统和安装方式
- **GitHub Actions Release Workflow** — 推送 tag 自动构建并发布 Docker 镜像到 GHCR
- **Nginx 配置文件** — 包含 PHP FastCGI、SSE 反向代理、安全头、Gzip 压缩

### Changed
- 项目结构调整为可部署形式（独立于服务器路径）
- 刷课 tracker 账号系统以学习通手机号为唯一标准

### Fixed
- 修复刷课计数 `+1` 逻辑导致 video_count=0 时章节错误标记完成
- 修复多 `u_xxx` 账号数据分散问题

---

## [0.0.0] - 2026-05-04

### Added
- 初始版本上传至 GitHub