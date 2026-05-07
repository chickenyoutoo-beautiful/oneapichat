# OneAPIChat

**多模型 AI 聊天平台，支持 Agent 模式**

🚀 **在线演示**: https://naujtrats.xyz/oneapichat

---

🌐 **Language / 语言 / 言語**: [English](./README.md) | [中文](./README.zh-CN.md) | [日本語](./README.ja-JP.md)

---

一个自托管的多模型 AI 聊天平台，对接 MiniMax、DeepSeek 等多种模型接口，支持 Agent 自主任务、联网搜索、SSE 流式响应、多用户管理、聊天记录导入导出等完整功能。

---

## 🌟 特性

### 🤖 多模型支持
- 兼容 OpenAI API 格式，可对接任意模型 endpoint
- 内置 **MiniMax**、**DeepSeek** 等模型支持
- 模型路由与自动切换
- 每个模型可独立配置 API Base URL 和 Key

### 🧠 Agent 模式
- 自主子 Agent 派发与管理
- 工具调用：联网搜索、代码执行、文件操作
- 持久化 Agent 状态与通知系统
- Cron 定时任务触发器

### 🔍 联网搜索
- 智能搜索判断 — AI 自动决定何时联网
- 多搜索引擎：Brave Search、Google Custom Search、Tavily
- 搜索结果自动整理与摘要

### 📡 SSE 流式响应
- 基于 Server-Sent Events 实时流式输出
- Python 后端引擎 + SQLite 持久化
- 页面刷新后进度可恢复

### 👥 多用户多终端
- 用户隔离，API Key 加密存储
- 聊天记录导入/导出
- 独立配置每用户参数

### 🎨 界面特色
- 深色/浅色模式
- Markdown 渲染 + 代码高亮
- 桌面端和移动端自适应

---

## 🚀 快速开始

### 环境要求
- PHP 8.0+（代理层）
- Python 3.10+（后端引擎）
- OneAPI 或 OpenAI 兼容 API Key

### 一键部署

```bash
chmod +x deploy.sh && ./deploy.sh
```

然后浏览器打开 `http://localhost:8080`

### 手动部署

**1. 克隆仓库**
```bash
git clone https://github.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch.git
cd Webui-aichat-supportwebsearch
```

**2. 安装 Python 依赖**
```bash
pip install fastapi uvicorn aiofiles python-multipart
```

**3. 启动后端引擎**
```bash
python3 engine_server.py &
```

**4. 启动 PHP 服务器**
```bash
php -S localhost:8080
```

---

## 📁 项目结构

```
.
├── index.html          # 主聊天界面
├── main.js             # 核心前端逻辑
├── style.css           # 样式文件
├── engine_api.php      # PHP 代理层
├── engine_server.py     # Python 后端（Agent/Cron/SSE）
├── fetch.php           # 网页抓取工具
├── deploy.sh           # 跨平台部署脚本
├── LICENSE             # MIT 许可证
└── README.md           # 本文件
```

---

## ⚙️ 配置说明

### API 配置
1. 打开设置面板
2. 填入 API Key 和 Base URL
3. 选择要使用的模型

### Agent 模式
在设置中启用 Agent 模式，解锁子 Agent 派发、工具调用和 Cron 定时任务。

---

## 📄 许可证

MIT License — 见 [LICENSE](./LICENSE)

---

## 🙏 致谢

感谢开源社区和所有库贡献者。
