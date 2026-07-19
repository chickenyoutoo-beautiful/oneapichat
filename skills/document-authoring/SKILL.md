---
name: document-authoring
description: 调研驱动文档创作。B站搜索+网页搜集→整理分析→生成专业文档(Word/PPT/Excel/PDF)。中文内容B站优先，输出正式报告。Use when the user needs research reports, presentations with data, spreadsheets, or structured documents.
version: 2.0.0
metadata:
  oneapichat:
    tools: [get_current_time, web_search, web_fetch, bilibili_search, bilibili_video_info, bilibili_article_read, generate_docx, generate_ppt, generate_xlsx, generate_pdf]
    priority: high
    emoji: "📝"
    triggers:
      - 写报告
      - 做报告
      - 写文档
      - 整理成
      - 生成文档
      - 生成PPT
      - 做表格
      - 做Excel
      - 生成PDF
      - 调研报告
      - 分析报告
      - 写总结
      - 汇报
      - 整理资料
      - 文档
      - Word
      - 制表
      - 数据整理
      - 行业分析
      - 竞品分析
      - 做成PPT
      - 做成文档
      - 输出为
      - 写到
      - 生成报告
---

# 调研驱动文档创作

联网搜集信息 → 结构化整理 → 生成专业办公文档。一站式完成从调研到交付。

**★ B站搜索优先**: 中文教程/评测/攻略 B站视频和专栏比网页搜索更新、更详细。

## ⏰ 时间感知策略

**强制规则**: 调研开始前先调用 `get_current_time` 获取当前精确时间，文档封面和页脚必须标注生成日期。

1. **搜索时效**: 搜索关键词必须包含当前年份(2026)。行业/市场类追加当前月份
2. **数据标注**: 所有引用数据标注来源+日期。超过1个月的数据标注"⚠️数据截至{日期}"
3. **报告时间戳**: 文档封面/页脚标注"生成日期: {当前日期}" + "数据采集时间: {当前日期}"
4. **过时拒绝**: 全部数据源超过1个月→生成前告知用户"数据可能已过时"。绝不用知识库陈旧数据填充报告

## 何时使用

- 用户要求"查一下XX并做成PPT/文档/表格"
- 用户需要行业分析报告、竞品分析、技术调研
- 用户提供零散信息要求整理成结构化文档
- 用户需要数据汇总表格 (Excel)
- 用户需要正式文档输出 (PDF/Word)

## 搜集阶段 — B站优先

| 内容类型 | 优先渠道 | 原因 |
|---------|---------|------|
| 教程/操作指南 | `bilibili_search` (video) | 实操演示, 最新版本 |
| 产品评测/对比 | `bilibili_search` + `bilibili_article_read` | UP主深度测评 |
| 行业分析/趋势 | `bilibili_search` + `web_search` | 专业UP主 + 行业报告 |
| 技术文档/API | `web_search` (官方/GitHub) | 权威文档 |
| 数据/统计 | `web_search` + `web_fetch` | 权威数据源 |
| 游戏攻略/CDK | `bilibili_search` | 最新最快 |

### 搜集流程
1. **并行搜索**: `bilibili_search("关键词")`(★优先) + `web_search("关键词 site:权威站")`
2. **深入提取**: `bilibili_video_info(bvid)` + `bilibili_article_read(cvid)` + `web_fetch(url)`
3. **多源验证**: 至少 2-3 个独立来源交叉验证关键数据
4. **结构化整理**: 去重 → 分类 → 形成大纲

## 工具选择

| 需求 | 工具 | 内容格式 |
|------|------|---------|
| Word 文档 | `generate_docx` | `[{type:"h1"/"h2"/"p"/"bullet", text:"..."}]` |
| PPT 演示 | `generate_ppt` | `pages: [{title:"", content:""}]` |
| Excel 表格 | `generate_xlsx` | `headers:[], rows:[[]]` |
| PDF 文档 | `generate_pdf` | `[{type:"h1"/"h2"/"p"/"bullet", text:"..."}]` |

## 工作流

### 模式 A：用户有明确数据/大纲
1. 确认内容结构 (用户提供或 AI 建议)
2. 直接调用对应文档工具生成
3. 返回下载链接给用户

### 模式 B：用户只有主题 — 调研驱动
1. **搜索阶段**: `bilibili_search` + `web_search` + `web_fetch` 搜集多源信息
2. **整理阶段**: 分析、去重、结构化 → 在思考中形成文档大纲
3. **生成阶段**: 调用对应工具生成文档
4. **交付阶段**: 返回下载链接 + 内容摘要

### 模式 C：表格数据
1. 确定字段 (headers)
2. `web_search` 或 `bilibili_search` 搜集数据
3. 整理为 rows 二维数组
4. `generate_xlsx` 生成表格

## 内容格式详解

### Word/PDF (`generate_docx` / `generate_pdf`)
```json
[
  {"type": "h1", "text": "大标题"},
  {"type": "h2", "text": "二级标题"},
  {"type": "p", "text": "正文段落..."},
  {"type": "bullet", "text": "要点1\n要点2\n要点3"}
]
```

### PPT (`generate_ppt`)
```json
[
  {"title": "封面标题", "content": "副标题/日期"},
  {"title": "内容页标题", "content": "要点1\n要点2\n要点3"},
  {"title": "数据展示", "content": "关键数据: ..."}
]
```

### Excel (`generate_xlsx`)
```json
{
  "headers": ["名称", "数值", "备注"],
  "rows": [["项目A", 100, "说明"], ["项目B", 200, "说明"]]
}
```

## 格式选择指南

| 场景 | 推荐格式 | 理由 |
|------|---------|------|
| 正式报告/方案 | PDF | 格式固定，专业 |
| 可编辑文档 | Word | 方便修改协作 |
| 演示汇报 | PPT | 视觉化呈现 |
| 数据表格 | Excel | 排序筛选分析 |
| 技术文档 | Word/PDF | 层次清晰 |

## 技巧

1. **先搜后写**: 对于不熟悉的主题，先 `bilibili_search` + `web_search` 搜集足够信息再动笔
2. **多源验证**: 至少 2-3 个来源交叉验证关键数据
3. **层级清晰**: h1→h2→p→bullet 层次不要超过 4 级
4. **数据表格化**: 比较类信息优先用 Excel，一目了然
5. **PPT 简洁**: 每页 3-5 个要点，不要大段文字
6. **B站辅助**: 需要视频教程或评测时，用 `bilibili_search` 寻找视频资源
7. **来源标注**: 文档末尾附信息来源链接，提升可信度
