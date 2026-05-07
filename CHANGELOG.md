# Changelog

All notable changes to this project will be documented in this file.

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