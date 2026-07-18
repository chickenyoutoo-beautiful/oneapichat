---
name: content-creation
description: 内容创作一站式。图片生成/文档/PPT制作/视频剪辑/语音合成/音乐生成。B站搜灵感+文档工具输出。Use for AI-powered content creation including images, slides, videos, audio.
version: 2.0.0
metadata:
  oneapichat:
    tools: [generate_image, generate_image_i2i, analyze_image, generate_ppt, generate_docx, generate_xlsx, generate_pdf, video_edit, video_understanding, mmx_image, mmx_video, mmx_speech, mmx_music, mmx_chat, mmx_vision, bilibili_search, web_search]
    priority: medium
    emoji: "🎨"
    triggers: [生成图片, 画图, 做PPT, 做文档, 做Word, 做Excel, 生成PDF, 视频剪辑, 语音合成, TTS, 配乐, 音乐, AI绘画, AI视频, 幻灯片, 文生图, 图生图, 海报, 插画, 创作, 生成视频, 做视频, 配音, 字幕, 图转图, 设计, 风格参考]
---

# 内容创作一站式

AI驱动的多媒体内容创作: 图片/文档/PPT/视频/音频全链路。

## 何时使用

- 用户要生成图片/插画/海报
- 用户要做PPT/幻灯片/Word文档/Excel表格/PDF
- 用户要剪辑视频/添加字幕
- 用户要文字转语音(TTS)
- 用户要生成背景音乐
- 用户要分析图片/视频内容

## 灵感搜集 — B站优先

创作前先搜参考:
- `bilibili_search("设计风格 教程")` — 视频教程最直观
- `bilibili_search("PPT模板 推荐")` — 排版参考
- `bilibili_search("{主题} 海报设计")` — 视觉风格
- 网页 → `web_search` 补充国外设计资源

## 工具选择指南

| 需求 | 工具 | 说明 |
|------|------|------|
| 文生图 | `generate_image` | 从文字生成图片 |
| 图生图 | `generate_image_i2i` | 基于参考图生成变体 |
| 图片分析 | `analyze_image` 或 `mmx_vision` | 理解图片内容 |
| 视频分析 | `video_understanding` | 理解视频内容 |
| 视频剪辑 | `video_edit` | 裁剪/加字幕/转格式 |
| PPT制作 | `generate_ppt` | 生成演示文稿 |
| Word文档 | `generate_docx` | 生成Word文档(.docx) |
| Excel表格 | `generate_xlsx` | 生成电子表格(.xlsx) |
| PDF文档 | `generate_pdf` | 生成PDF文档 |
| 语音合成 | `mmx_speech` | 文字→语音 |
| 音乐生成 | `mmx_music` | 生成背景音乐 |
| 对话生图 | `mmx_image` | MiniMax直出图片 |

## 工作流

### 图片生成
1. 确认需求: 风格/尺寸/数量
2. `generate_image` 或 `mmx_image` — 传入详细prompt
3. 如需变体: `generate_image_i2i` 基于结果再生成

### 文档生成
1. 了解文档类型和内容需求
2. 组织内容为结构化格式 (h1/h2/p/bullet)
3. 调用 `generate_docx` / `generate_ppt` / `generate_xlsx` / `generate_pdf`
4. 如需调研数据支撑 → 先 `web_search` + `bilibili_search` 搜集信息

### PPT制作
1. 了解主题和受众
2. `generate_ppt` — 传入大纲和风格要求
3. 等待生成完成后返回文件

### 视频处理
1. `video_understanding` — 先理解视频内容
2. `video_edit` — 裁剪/字幕/特效
3. 返回处理后的视频

## 技巧

1. 图片prompt要具体: 风格+主体+背景+光线+画质
2. PPT先给大纲确认再生成，避免返工
3. 视频剪辑先看 `video_understanding` 结果定位关键帧
4. 多张图片用 `n` 参数一次生成，不要逐张调用
5. B站搜索教程/参考比网页搜索更直观(视频演示)
