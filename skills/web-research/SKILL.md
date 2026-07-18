---
name: web-research
description: 网络调研与信息搜集。当用户需要深入了解某个话题或做调研时，系统搜索+抓取+整理。中文/教程/评测优先B站。Use for research, fact-checking, topic deep-dives.
version: 2.0.0
metadata:
  oneapichat:
    tools: [web_search, web_fetch, bilibili_search, bilibili_video_info, bilibili_article_read, generate_docx, generate_pdf]
    priority: medium
    emoji: "🔍"
    triggers:
      - 调研
      - 研究
      - 查一下
      - 搜索
      - 最新
      - research
      - 了解
      - 怎么回事
---

# 网络调研与信息搜集

系统化地进行网络信息搜集，多源交叉验证，生成结构化的调研报告。

**★ B站优先**: 中文内容、教程、评测、游戏攻略、科技热点 → 优先 `bilibili_search`，B站视频/专栏比搜索引擎更新更详细。

## 何时使用

- 用户要求"查一下XX"、"XX是怎么回事"
- 用户需要了解某个话题的最新信息
- 用户在做决策前需要参考多渠道信息
- 需要验证某个说法/新闻的真实性

## 步骤

### 1. 制定搜索计划
根据用户问题拆解为 2-4 个搜索关键词，覆盖不同角度。

### 2. 多源搜索（看话题选渠道）

| 话题类型 | 第一搜索 | 补充 |
|---------|---------|------|
| 教程/How-to | `bilibili_search` | web_search |
| 产品评测/体验 | `bilibili_search` | web_fetch 电商站 |
| 技术文档/API | `web_search` (GitHub/官方) | — |
| 新闻/热点 | `web_search` + 权威媒体 | bilibili_search |
| 游戏/CDK | `bilibili_search` | web_search |
| 学术/专业 | `web_search` | rag_search |

- `bilibili_search("关键词")` — 中文社区/教程/评测优先
- `web_search("关键词")` — 补充英文/官方/技术文档
- 至少获取 5+ 条来源

### 3. 深入抓取
对最有价值的 2-3 个链接:
- 网页 → `web_fetch` 获取全文
- B站视频 → `bilibili_video_info` 提取详情
- B站专栏 → `bilibili_article_read` 获取全文

### 4. 交叉验证
不同来源的信息对比，标注一致和矛盾之处。

### 5. 输出报告

```
📊 {主题} 调研报告

🔑 核心发现:
1. {关键发现1} [来源: {url}]
2. {关键发现2}

📺 B站来源 ({N}条):
| 序号 | 标题 | UP主 | 播放 | 要点 |
|-----|------|------|------|------|
| 1 | ... | ... | ... | ... |

📰 网页来源 ({M}条):
| 序号 | 标题 | 来源 | 日期 | 可信度 |
|-----|------|------|------|--------|
| 1 | ... | 官网 | ... | 高 |

⚠️ 注意事项:
- 如有矛盾信息，注明
- 标注未经验证的说法
```

## 调研→文档管线
正式报告: 调研结果 → `generate_docx`(可编辑) 或 `generate_pdf`(正式)

## 技巧

1. 搜索时加当前年份获取最新信息
2. 中文问题优先搜B站（社区讨论更活跃，教程更新更实操）
3. 技术问题可搜GitHub/知乎等专业站点
4. 时效性强的问题（新闻/价格）多找几个来源对比
5. B站评论区常有补充信息和时效验证
