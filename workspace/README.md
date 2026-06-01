# 🗂 Agent 工作空间

模型生成的所有项目、脚本、报告和数据都存放在此目录。

## 目录结构

```
workspace/
├── projects/     ← 模型生成的完整项目（如 AISniper OS）
├── scripts/      ← 工具脚本、自动化脚本
├── data/         ← 数据文件、JSON、CSV
├── reports/      ← 分析报告、Markdown 文档
├── tmp/          ← 临时文件（可随时清理）
└── projects.json ← 项目索引（自动维护）
```

## 访问方式

- 项目在线预览：`/oneapichat/workspace/projects/<项目名>/index.html`
- 文件直接访问：`/oneapichat/workspace/<路径>`
- Nginx 已配置此目录为静态文件服务
