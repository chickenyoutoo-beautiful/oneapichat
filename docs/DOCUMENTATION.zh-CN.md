```markdown
# NAUJTRATS AI 聊天助手 - 代码说明与使用文档

## 一、项目概述

**NAUJTRATS AI 聊天助手**是一个功能丰富的Web端AI对话应用，支持多模型接入、文件解析、联网搜索、智能上下文管理等高级特性。采用纯前端架构，所有数据本地存储，隐私安全，支持桌面与移动端完美适配。

### 🎯 核心特性
- **多模型兼容**：OpenAI API 格式，支持 DeepSeek、Ollama 等
- **文件解析**：文本、Word、Excel、PDF 等（≤10MB）
- **智能搜索**：AI 判断 + DuckDuckGo/Brave/Google，支持网页/新闻/图片
- **上下文优化**：自动压缩 + Token 智能调整
- **实时流式**：逐字显示，支持思考过程可视化
- **国际化**：多语言 UI + 动态提示词
- **响应式设计**：移动端手势 + 键盘适配
- **高级交互**：消息编辑/重生、标题自动生成、恢复默认

### 📱 部署方式
- **单文件部署**：只需 `index.html` + `main.js` + `lib/` 目录
- **GitHub Pages**：直接上传仓库，支持 CDN 加速
- **本地运行**：浏览器打开，无需服务器

## 二、代码结构说明 (v16.8)

### 2.1 全局配置
```javascript
const DEFAULT_CONFIG = {
    url: 'https://oneapi.naujtrats.xyz/v1',  // 默认 API
    model: 'deepseek-chat',
    system: '你是一个有用的助手...',         // 支持时间上下文
    enableSearch: false,                      // 联网搜索
    aiSearchJudge: true,                      // AI 判断（默认开启）
    // ... 完整配置见 main.js
};
```

### 2.2 核心模块分解

| 模块 | 关键函数 | 功能描述 |
|------|----------|----------|
| **工具函数** | `encrypt/decrypt`, `estimateTokens`, `extractFileContent` | 加密存储、Token 估算、文件解析（mammoth/XLSX） |
| **UI 管理** | `appendMessage`, `toggleDarkMode`, `handleResize` | 消息渲染、主题切换、响应式布局 |
| **配置系统** | `saveConfig`, `fetchModels`, `resetToDefault` | 配置持久化、模型刷新、恢复默认按钮 |
| **搜索引擎** | `aiShouldSearch`, `performWebSearch`, `aiChooseSearchType` | AI 判断（true/false）、多类型搜索、结果格式化 |
| **消息核心** | `sendMessage`, `streamResponse`, `handleSearchFlow` | 完整发送流程、流式解析、搜索集成 |
| **对话管理** | `createNewChat`, `loadChat`, `compressContextIfNeeded` | 新建/切换/删除、自动压缩、标题生成 |

### 2.3 v16.8 新增/优化
- **按需时间注入**：用户指定时间基准（如"假设现在是2026年"）
- **搜索判断强化**：关键词 fallback + 正则增强
- **国际化修复**：动态提示词切换、翻译缓存
- **恢复默认按钮**：一键重置所有设置
- **UI 精简**：移除冗余选项，优化移动端

## 三、使用指南

### 3.1 🚀 快速上手 (5 分钟)
1. **配置 API**：
   ```
   设置面板 → API Key + Base URL → 刷新模型
   ```
2. **开始聊天**：
   - 输入问题 → Enter 发送
   - 拖拽文件 → 自动解析附加
3. **智能搜索**：
   - 开启"启用联网搜索" + "AI智能判断"
   - 示例：`今天天气？` → 自动搜索

### 3.2 📎 文件上传
```
支持：.txt .md .js .py .docx .xlsx .csv 等
操作：点击📎 或拖拽 → 预览 → 发送
示例：[附件: data.csv] 帮我分析销售数据
```

### 3.3 🌐 联网搜索
```
智能触发：今天/最新/新闻/天气 等关键词
命令：
/search 关键词     # 网页
/news iPhone 16    # 新闻
/image 猫咪        # 图片

配置：搜索引擎 + API Key + 地区(cn/us)
结果：【原始联网搜索结果】 → AI 回答
```

### 3.4 💬 消息交互
| 操作 | 图标 | 描述 |
|------|------|------|
| 复制 | 📋 | 复制纯文本 |
| 编辑 | ✏️ | 修改用户消息重发 |
| 重生 | 🔄 | 重新生成 AI 回复 |
| 停止 | ⏹️ | 中断生成 |

### 3.5 🎛️ 设置面板
```
基础：系统提示词 / 温度 / Token
显示：字体大小(12-24px) / 行高 / 段间距
搜索：AI判断模型 / 提示词自定义 / 超时(5-120s)
高级：自定义JSON参数 / Markdown GFM
```

## 四、配置详解

### 4.1 系统提示词 (关键)
```
默认包含：
- 知识截止提醒 + 联网搜索规则
- 时间上下文优先（用户指定 > 真实时间）
示例自定义：你是一个代码审查专家...
```

### 4.2 搜索高级
```
AI 判断提示词：
"规则：时间/新闻/实时 → true；历史/数学 → false"
类型判断：web/news/images (AI 自动)
永久保存：结果追加到系统消息
```

## 五、技术细节

### 5.1 数据流
```
用户输入 → 搜索判断 → [搜索 → 结果注入] → API 请求 → 流式渲染
Token 安全：上下文估算 + 自动调整 max_tokens
```

### 5.2 存储 & 安全
- localStorage：chats/config (加密 Key)
- 自动清理：保留最近10个对话
- XSS 防护：escapeHtml 全覆盖

### 5.3 性能
- 节流：滚动/resize
- 懒载：marked/hljs/mammoth/xlsx
- 流控：reasoningDelay/contentDelay

## 六、故障排除

| 问题 | 原因 | 解决 |
|------|------|------|
| API 失败 | Key/URL 错 | 检查凭证，测试 `curl` |
| 搜索无果 | 无 Key/代理 | 配置 Brave API 或代理 |
| 文件解析失败 | 格式不支持 | 转 TXT/CSV 重试 |
| Token 超限 | 历史长 | 开启压缩，清空对话 |
| 移动卡顿 | 键盘冲突 | 更新浏览器，调延迟=0 |

**调试**：F12 → Console → `logDebug('test')`

## 七、GitHub 部署指南

### 7.1 仓库结构
```
naujtrats-ai-chat/
├── index.html      # 主页 (嵌入 main.js)
├── main.js         # 核心逻辑 v16.8
├── lib/            # 依赖
│   ├── marked.min.js
│   ├── highlight.min.js
│   ├── mammoth.browser.min.js
│   └── xlsx.full.min.js
├── README.md       # 此文档
└── LICENSE
```

### 7.2 快速部署
1. Fork 本仓库或上传文件
2. **GitHub Pages**：Settings → Pages → Deploy from branch `main`
3. 访问：`https://github.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch`
4. 配置：用户自行填 API Key（本地存储）

### 7.3 自定义
- 修改 `DEFAULT_CONFIG.url/model`
- 添加语言：`translations.json`
- 皮肤：CSS 变量 `--chat-font-size` 等

## 八、更新日志 (v16.8)
```
2026 更新：
✓ 按需时间注入 + 搜索强化
✓ 国际化 + 动态提示词
✓ 恢复默认按钮
✓ 移除冗余：hideReasoning 等
```

**依赖**：无服务器，纯 CDN/本地

## 九、贡献 & 支持
- ⭐ Star / Fork 仓库
- Issues：报告 Bug/建议
- PR：欢迎优化代码

**隐私**：100% 本地，无追踪
**浏览器**：Chrome 100+ / Firefox / Safari

---

**文档版本**：v16.8 (2026)
**作者**：NAUJTRATS 项目组
**许可证**：MIT
```