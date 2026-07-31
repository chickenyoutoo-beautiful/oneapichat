---
name: video-hunter
description: 视频资源猎手 — 全网视频搜索(B站+BT磁力+Tavily+web_search) → 解析/下载(aria2+yt-dlp+bilibili-api) → 云盘管理(Cloudreve) 一站式All-in-one video pipeline. Use when user wants to find, download, or store any video.
version: 2.0.0
metadata:
  oneapichat:
    tools: [bili_search_ex, bili_info, bili_streams, bili_download, bili_download_status, video_search, video_parse, video_download, video_download_status, video_list_downloads, video_upload_cloudreve, video_cloudreve_list, video_cloudreve_mkdir, video_cloudreve_search, video_cloudreve_url, web_search, web_fetch, bilibili_search, bilibili_video_info, bilibili_user_profile, bilibili_comment_list, bilibili_qr_login, browser_navigate, browser_get_content, cr_upload_file, cr_list_files, cr_create_folder, cr_search_files]
    priority: critical
    emoji: "🎬"
    triggers: [视频下载, 磁力链接, magnet, torrent, BT下载, 找资源, 下视频, 存云盘, 视频资源, 剧集下载, 电影下载, aria2, 离线下载, 磁力, 种子下载, bilibili, B站, bili, 哔哩, 下载视频, 视频保存, 视频搬运, 视频收藏, 视频推荐, UP主, 番剧]
---

# 🎬 视频猎手 Video Hunter (v2.0)

全网视频资源获取 → 下载 → 云盘管理，**一站式自动化流水线**。

覆盖 **B站 (bilibili-api-python + yt-dlp)** + **BT/磁力 (aria2)** + **全网搜索 (web_search + video_search + bili_search)** + **云盘 (Cloudreve)** 四大渠道。

## 何时使用

- 用户要搜索并下载某个视频（电影/剧集/动漫/教程/课程/B站视频等）
- 用户已有磁力链接或 B 站链接，想下载并保存到云盘
- 用户想看云盘里已有哪些视频
- 用户要监控下载进度
- 大文件下载（aria2/yt-dlp 多线程加速 + 断点续传）
- B站视频搬运/备份到云盘

## 完整工具矩阵

### 🔍 搜索渠道 (4种)

| 工具 | 渠道 | 适用场景 | 可靠性 |
|------|------|----------|--------|
| `web_search` | DuckDuckGo | **首选** — 搜全网磁力链接/视频资源 | ⭐⭐⭐⭐⭐ |
| `web_fetch` | 网页抓取 | 抓取搜索结果页面提取磁力/视频链接 | ⭐⭐⭐⭐⭐ |
| `bili_search_ex` | B站 API (bilibili-api-python) | B站视频搜索，返回 BV 号/播放数/时长 | ⭐⭐⭐⭐⭐ |
| `bilibili_search` | B站 API (Node.js 版) | B站搜索备选 | ⭐⭐⭐⭐ |
| `video_search` | BT磁力聚合 (多站) | 磁力链接搜索（部分站有CF反爬） | ⭐⭐⭐ |
| `browser_navigate` + `browser_get_content` | 浏览器自动化 | 绕过CF反爬，抓取任意视频站 | ⭐⭐⭐⭐ |

### 📥 下载渠道 (3种)

| 工具 | 下载器 | 适用场景 | 特点 |
|------|--------|----------|------|
| `bili_download` | yt-dlp | B站视频下载(多画质) | 自动合并音视频/弹幕 |
| `bili_streams` + `video_download` | bilibili-api + aria2 | B站 DASH 流 + aria2多线程 | 更快，需手动合并 |
| `video_download` | aria2c | 磁力/torrent/HTTP URL | 多线程BT下载 |

### ☁️ 云盘管理 (Cloudreve)

| 工具 | 功能 |
|------|------|
| `video_cloudreve_list` | 浏览目录 |
| `video_cloudreve_mkdir` | 创建文件夹 |
| `video_cloudreve_search` | 搜索文件 |
| `video_upload_cloudreve` | 上传文件(自动分片) |
| `video_cloudreve_url` | 获取下载链接 |

## 工作流

### 流程 A: B站视频 → 下载 → 存云盘（最常用 ✅）

```
用户: 「帮我下载B站这个视频: BV1xx411c7mD」

1. bili_info(bvid="BV1xx411c7mD")
   → 获取标题/UP主/分P信息, 确认下载内容

2. bili_download(url="https://www.bilibili.com/video/BV1xx411c7mD", quality="best")
   → 返回 task_id (yt-dlp 后台下载, 自动合并音视频)

3. 轮询 bili_download_status(task_id="bili_xxx")
   → 进度 10%... 50%... 100% completed

4. video_upload_cloudreve(
     file_path="/tmp/video-hunter-downloads/bilibili/xxx.mkv",
     remote_dir="/my/视频备份"
   )
   → 大文件自动分片上传到 Cloudreve

5. video_cloudreve_url(path="cloudreve://my/视频备份/xxx.mkv")
   → 返回下载链接给用户
```

### 流程 B: 搜索磁力 → 下载 → 存云盘

```
用户: 「帮我找「庆余年 4K」并下载」

1. web_search(query="庆余年 4K 磁力链接 magnet")
   → 搜到多个磁力链接

2. (可选) video_parse(uri="magnet:?xt=urn:btih:abc123...")
   → 预览文件列表, 确认是正确资源

3. video_download(uri="magnet:?xt=urn:btih:abc123...")
   → 启动 aria2 多线程下载, 返回 task_id

4. 轮询 video_download_status(task_id="vh_xxx")
   → 监控进度到 100%

5. video_upload_cloudreve(file_path="/tmp/.../庆余年S01E01.mkv", remote_dir="/my/剧集")
6. video_cloudreve_url(...) → 返回链接
```

### 流程 C: 用户已有磁力/B站链接

```
video_parse / bili_info → 确认内容 → video_download / bili_download → 下载 → 上传云盘
```

### 流程 D: B站 DASH 流 + aria2 极速下载

```
1. bili_streams(bvid="BV1xx411c7mD")
   → 获取视频流URL + 音频流URL (分离)

2. video_download(uri="视频流URL") + video_download(uri="音频流URL")
   → aria2 多线程分别下载

3. (需要时) 用 ffmpeg 合并音视频
```

### 流程 E: 浏览器辅助抓取（CF反爬时）

```
1. browser_navigate(url="https://xxx-torrent-site.com/search?q=xxx")
2. browser_get_content() → 获取页面内容
3. 从内容中提取磁力链接
4. video_download(uri="magnet:...") → 正常下载
```

## 重要说明

### 搜索策略（优先级从高到低）

1. **`web_search("关键词 magnet")`** — 最可靠，DuckDuckGo 覆盖面广
2. **`bili_search_ex(keyword)`** — B站专用，返回结构化数据
3. **`video_search(query)`** — BT磁力聚合，部分站可能被CF拦截
4. **`browser_navigate` + `browser_get_content`** — 终极方案，绕过所有反爬

### B站下载画质说明

- `quality="best"` — 最高画质 (需登录才能下 1080P+)
- `quality="1080p"` — 1080P
- `quality="720p"` — 720P (无需登录)
- `need_login=true` — 使用浏览器 Cookie 下载高画质（需先登录B站）
- 下载格式: MKV (视频+音频自动合并)

### aria2 下载配置

- 监听端口: 6888（BT）
- 默认下载目录: `/tmp/video-hunter-downloads/`
- 内置公共 tracker 列表加速
- 状态持久化: `/tmp/video-hunter-status/{task_id}.json`
- 支持断点续传

### Cloudreve 上传

- 大文件自动分片（chunk_size 由服务端返回）
- Bearer Token 认证
- 存储路径建议:
  - `/my/B站/` — B站视频
  - `/my/电影/` — 电影
  - `/my/剧集/` — 电视剧
  - `/my/教程/` — 教学视频

### 代理配置

- BT站搜索走代理: `http://192.168.195.213:10808`
- yt-dlp 已配置代理
- bilibili-api 直连（B站国内直连更快）

## 典型示例

### 示例 1: 下载 B站视频到云盘
```
用户: 下载这个B站视频 https://www.bilibili.com/video/BV1GJ411x7h7 到云盘

1. bili_info(bvid="BV1GJ411x7h7")
   → 标题: "Never Gonna Give You Up", UP主: 索尼音乐中国, 播放1亿+

2. bili_download(url="https://www.bilibili.com/video/BV1GJ411x7h7", quality="best")
   → task_id: bili_a1b2c3d4e5

3. 轮询 bili_download_status(task_id="bili_a1b2c3d4e5")
   → completed! 文件: /tmp/video-hunter-downloads/bilibili/Never Gonna Give You Up.mkv

4. video_upload_cloudreve(
     file_path="/tmp/video-hunter-downloads/bilibili/Never Gonna Give You Up.mkv",
     remote_dir="/my/B站"
   )
   → 上传完成

5. video_cloudreve_url(path="cloudreve://my/B站/Never Gonna Give You Up.mkv")
   → { url: "https://cloudreve.naujtrats.xyz/api/v4/file/..." }

✅ 完成! 返回下载链接给用户
```

### 示例 2: 搜索磁力并下载
```
用户: 帮我找「计算机组成原理 课程」并下载

1. web_search(query="计算机组成原理 课程 磁力链接 magnet")
   → 找到多个结果

2. 展示给用户选择，或自动选种子最多的:
   「计算机组成原理(唐朔飞)全40集 1080P」 种子数: 128

3. video_parse(uri="magnet:?xt=urn:btih:xxxx...")
   → 确认: 40个视频文件, 总大小 8.5GB

4. video_download(uri="magnet:?xt=urn:btih:xxxx...")
   → task_id: vh_abc123def4

5. 轮询 video_download_status(task_id="vh_abc123def4")
   → 下载中... 35%... 72%... 100%

6. video_cloudreve_mkdir(path="/my/教程/计算机组成原理")
7. video_upload_cloudreve(file_path="...", remote_dir="/my/教程/计算机组成原理")

✅ 全部视频存入云盘
```

### 示例 3: B站搜索 + 批量下载
```
用户: 搜索罗翔刑法课全部视频

1. bili_search_ex(keyword="罗翔 刑法", limit=20)
   → 找到20个相关视频 (BV号/播放数/时长)

2. 逐个或批量下载:
   for each video in results:
     bili_download(url=video["url"], quality="720p")

3. 每个下载完成后:
   video_upload_cloudreve(file_path=..., remote_dir="/my/教程/罗翔刑法")

✅ 全部课程备份到云盘
```

## 故障排查

| 问题 | 解决方案 |
|------|----------|
| `video_search` 返回空 | 改用 `web_search("关键词 magnet")` |
| B站下载画质受限 | `need_login=true` 或先 `bilibili_qr_login` |
| 磁力下载慢 | 检查 tracker 列表，aria2 会自动重试 |
| 云盘上传失败 | 检查 Token 是否有效，`cr_check_login` |
| CF反爬无法搜索 | 用 `browser_navigate` 浏览器抓取 |
| 磁盘空间不足 | `server_disk` 检查，下载目录 `/tmp` |
