---
name: bilibili-content-discovery
description: B站内容发现与推荐。当用户想找B站上的视频/专栏/UP主时，自动搜索并整理。Use when user wants to discover Bilibili content.
version: 1.0.0
metadata:
  oneapichat:
    tools: [get_current_time, bilibili_search, bilibili_video_info, bilibili_user_profile, bilibili_comment_list]
    priority: high
    emoji: "📺"
    triggers:
      - B站
      - bilibili
      - b站
      - 哔哩
      - 视频推荐
      - UP主
      - 番剧
---

# B站内容发现

帮助用户在B站上发现和了解内容，包括视频推荐、UP主查询、热门内容搜索。

## ⏰ 时间感知

**先调用 `get_current_time`** 获取当前时间。搜索结果标注视频发布时间，超过1年的视频标注"📅{年份}"。优先推荐最近发布的视频（按发布时间排序，不只看播放量）。搜索时加当前年份关键词确保找到最新内容。

## 何时使用

- 用户想找某类视频/教程（"B站有什么好的Python教程"）
- 用户想了解某个UP主（"XX UP主怎么样"）
- 用户分享B站链接想了解内容概要
- 用户想看某个话题的热门讨论

## 步骤

### 1. 视频/内容搜索
用 `bilibili_search` 按关键词搜索，默认搜视频（search_type: "video"），用户找文章时搜专栏（search_type: "article"）。

### 2. 查看详情
对感兴趣的视频用 `bilibili_video_info` 获取完整信息（播放量/弹幕/分P/简介）。

### 3. 查UP主
用 `bilibili_user_profile` 获取UP主信息（粉丝数/投稿/签名）。

### 4. 看评论
用 `bilibili_comment_list` 获取热门评论了解社区反馈。

### 5. 推荐整理
按以下格式返回：

```
📺 {搜索主题} B站精选

1. [{UP主}] {视频标题}
   ▶ 播放{xxx} | 💬 {xxx}评论 | 🏷 {标签}
   📎 https://www.bilibili.com/video/{bvid}
   简介: {description前150字}

2. ...
```

## 技巧

1. 用户说"推荐"时应多搜几个关键词，找到最热门/最相关的内容
2. 查视频时看播放量和评论数判断质量
3. 教程类内容优先看分P数量（多P=系列教程）
4. 弹幕数高的视频通常更有趣/有争议
5. 同时搜专栏（search_type: "article"）可以发现深度内容
