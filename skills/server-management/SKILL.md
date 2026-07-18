---
name: server-management
description: 服务器运维管理。系统信息/进程/磁盘/网络/文件/Docker一站式管理。Use for server monitoring, diagnostics, file operations, process management.
version: 1.0.0
metadata:
  oneapichat:
    tools: [server_sys_info, server_ps, server_disk, server_network, server_docker, server_exec, server_python, server_file_read, server_file_write, server_file_edit, server_file_search, server_file_grep, server_file_op, server_db_query]
    priority: medium
    emoji: "🖥"
    triggers: [服务器, 系统状态, 进程, 磁盘, 内存, CPU, 网络, Docker, 部署, 日志, 文件管理, 排查, 故障, server, 运维]
---

# 服务器运维管理

服务器状态监控、故障排查、文件管理和Docker操作一站式解决方案。

## 何时使用

- 查看服务器运行状态(CPU/内存/磁盘/进程)
- 排查服务故障(查日志/进程/端口)
- 管理文件(搜索/读取/编辑/移动)
- Docker容器管理
- 执行Shell/Python脚本
- 数据库查询

## 分类操作

### 📊 状态监控
```
server_sys_info → 系统概览(CPU/内存/负载/运行时间)
server_ps → 进程列表(可过滤进程名)
server_disk → 磁盘使用情况
server_network → 网络诊断(ping/curl/端口检测)
```

### 📁 文件管理
```
server_file_search → 按文件名搜索
server_file_grep → 按内容搜索(grep)
server_file_read → 读取文件内容
server_file_write → 写入/创建文件
server_file_edit → 精确字符串替换
server_file_op → cp/mv/rm/mkdir 文件操作
```

### 🐳 Docker
```
server_docker docker ps → 查看容器状态
server_docker docker logs {name} → 查看容器日志
server_docker docker restart {name} → 重启容器
```

### 🔧 执行
```
server_exec → 执行Shell命令(需审批)
server_python → 执行Python脚本
server_db_query → 查询SQLite数据库
```

## 故障排查流程

1. `server_sys_info` — 先看整体
2. `server_ps` — 检查关键进程是否运行
3. `server_disk` — 确认磁盘未满
4. `server_network` — 检查网络连通性
5. 按需查日志: `server_file_grep` 搜索错误
6. `server_docker` — 如涉及容器

## 输出格式

```
🖥 服务器状态
- 负载: 0.5/1.2/0.8
- 内存: 4.2G/8G (52%)
- 磁盘: 45G/100G (45%)
- 运行时间: 15天

⚠️ 发现: nginx进程未运行 → server_docker restart nginx 可修复
```

## 技巧

1. 先诊断后操作——不要盲目重启
2. `server_file_grep` 搜日志比 `server_file_read` 读全文更高效
3. 危险操作(rm -rf/关机)用 `server_exec` 前先确认路径
4. 数据库查询用 `server_db_query` 而非 `server_exec sqlite3`
