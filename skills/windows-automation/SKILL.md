---
name: windows-automation
description: Windows本机自动化操控。进程管理/文件操作/截图/程序启停。Use for Windows machine automation including process management, screenshots, file operations.
version: 1.0.0
metadata:
  oneapichat:
    tools: [win_info, win_processes, win_kill, win_start, win_restart, win_file, win_screenshot]
    priority: medium
    emoji: "🪟"
    triggers: [Windows, win, 本机, 桌面, 进程管理, 结束进程, 启动程序, 截图, 电脑, PC, 任务管理器, 远程操控]
---

# Windows本机自动化

远程管理Windows本机: 系统信息/进程控制/文件操作/屏幕截图。

## 何时使用

- 查看本机运行状态
- 结束卡死的程序
- 启动/重启Windows应用
- 截取桌面屏幕
- 管理本机文件

## 工具

| 工具 | 功能 |
|------|------|
| `win_info` | 系统信息(OS版本/内存/磁盘) |
| `win_processes` | 进程列表(可按名过滤) |
| `win_kill` | 结束进程(按名或PID) |
| `win_start` | 启动程序 |
| `win_restart` | 重启程序 |
| `win_file` | 文件操作(读/写/删) |
| `win_screenshot` | 屏幕截图 |

## 工作流

### 排查卡顿
```
1. win_info → 看CPU/内存
2. win_processes → 找高占用进程
3. win_kill → 结束问题进程
4. win_restart → 重新启动
```

### 远程操作
```
1. win_screenshot → 截图确认当前状态
2. win_start → 启动需要的程序
3. win_screenshot → 再次截图确认结果
```

## 技巧

1. 截图在先——操作前先看当前状态
2. `win_kill` 优先用进程名而非PID(名称更稳定)
3. `win_restart` 比 kill+start 更安全
