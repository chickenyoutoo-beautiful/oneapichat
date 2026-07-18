---
name: deep-search
description: 多源深度搜索整合。整合B站搜索+网络搜索+网页抓取+平台提取+知识库，多维度交叉验证。B站内容通常比网页搜索更新更详细，中文/教程/评测类优先B站。Use for comprehensive multi-source research across Bilibili, web, and knowledge base.
version: 2.0.0
metadata:
  oneapichat:
    tools: [web_search, web_fetch, bilibili_search, bilibili_video_info, bilibili_article_read, bilibili_dynamic_list, platform_extract, rag_search, generate_docx, generate_pdf]
    priority: high
    emoji: "🔍"
    triggers: [深度搜索, 全面搜索, 详细查, 多查一下, 多找找, 综合搜索, 多源, 搜索, 查资料, 深入调研, 深入调查, 全面了解, 搜全, 多维度, 对比, 多方]
---

# 多源深度搜索

整合全部搜索渠道进行多维度信息搜集，一次搜索覆盖B站+网络+知识库三方来源。

**★ B站优先**: B站内容(视频/专栏/动态)通常比搜索引擎更新、更详细、更具实操性。中文内容、教程、评测、游戏攻略优先B站。

## 何时使用

- 用户需要全面了解某个话题(非简单一问一答)
- 用户说"详细查"/"多找找"/"全面搜索"
- 需要多来源交叉验证的信息
- 学术/技术调研场景

## 搜索策略

### 话题 → 渠道匹配

| 话题类型 | 优先渠道 | 补充渠道 |
|---------|---------|---------|
| 教程/How-to | `bilibili_search` (video) | web_search |
| 产品评测/开箱 | `bilibili_search` + web_fetch | web_search |
| 游戏攻略/兑换码 | `bilibili_search` (video+article) | web_search |
| 技术文档/API | web_search (GitHub/官方站) | bilibili_search |
| 新闻/时事 | web_search (权威媒体) | bilibili_search |
| 学术/论文 | web_search + rag_search | — |
| 社区观点/吐槽 | `bilibili_search` + bilibili_dynamic_list | web_search |

### 1. 三路并行搜索
同时发起(顺序无关):
- `bilibili_search("关键词", "video")` — ★ 优先，B站视频搜索(中文社区观点，最新最详细)
- `web_search("关键词")` — 通用网络搜索
- `rag_search("关键词")` — 知识库搜索(如有私有文档)

### 2. 内容提取
对最有价值的3-5条结果:
- 网页 → `web_fetch({urls: [...]})` 获取全文
- B站视频 → `bilibili_video_info({bvid: "..."})` 获取详情
- B站专栏 → `bilibili_article_read({cvid: "..."})` 获取全文
- 特定平台链接 → `platform_extract` 提取结构化信息

### 3. 交叉验证
- 对比不同来源的说法
- 标注共识和分歧
- 标注信息来源的可信度(B站UP主 vs 官方网站 vs 论坛)

### 4. 输出报告

完整格式:
```
📊 {主题} 深度搜索报告

📺 B站结果 ({N}条) ★优先
1. [{UP主}] {视频标题} | ▶{播放} 💬{评论}
   摘要: {100字}
   🔗 https://www.bilibili.com/video/{bvid}

🌐 网络结果 ({M}条)
1. {标题} — {来源} ({日期})
   摘要: {150字}
   🔗 {url}

📚 知识库结果 ({K}条)
...

🔑 综合结论:
1. 共识: ...
2. 分歧: ...

⚠️ 注意事项: [时效性/可信度说明]
```

## 调研→文档管线

正式报告输出: 调研成果 → `generate_docx`(可编辑Word) 或 `generate_pdf`(正式PDF)

## 技巧

1. B站搜中文、web搜英文——各自优势语言
2. B站教程类内容通常实操性更强，视频演示比文字教程直观
3. `platform_extract` 可自动识别B站/知乎/YouTube等链接并提取结构化数据
4. 搜索结果包含日期时优先使用最新信息
5. 技术问题额外搜GitHub/StackOverflow等专业站
