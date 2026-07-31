---
name: netdisk-parser
description: 网盘分享链接解析+下载。支持百度网盘、夸克网盘、阿里云盘、天翼云盘、迅雷网盘、移动网盘、UC网盘、123网盘、蓝奏云等主流网盘。解析分享链接获取直链, 使用aria2多线程下载到服务器。Use for downloading files from shared netdisk links.
version: 2.0.0
metadata:
  oneapichat:
    tools: [netdisk_parse, netdisk_download, netdisk_parse_and_download, netdisk_status, netdisk_login]
    priority: high
    emoji: "📂"
    triggers: [网盘, 百度网盘, 夸克网盘, 阿里云盘, 天翼云盘, 迅雷网盘, 蓝奏云, 下载网盘, 解析链接, pan.baidu, pan.quark, alipan, cloud.189, lanzou, 网盘解析, 网盘下载, 提取码, 分享链接, 网盘文件, 第三方网盘]
---

# 📂 网盘解析与下载 (v2.0)

主流网盘分享链接解析 + 多线程下载到服务器。

## ⚠️ 重要: 首次使用必须先登录！

大多数网盘需要登录Cookie才能解析。请按以下步骤操作：

## 🔑 扫码登录流程（百度/夸克/阿里）

### 第一步: 检查登录状态
```
netdisk_login(action="check", service="baidu")
→ 返回 {"valid": false, "need_login": true} 则需要登录
→ 返回 {"valid": true} 则已登录, 可直接解析
```

### 第二步: 生成二维码
```
netdisk_login(action="qr", service="baidu")
→ 返回 qr_image_base64 (可直接显示在聊天中)
→ 返回 sign (用于后续poll)
```

### 第三步: 展示二维码并等待扫码
将 `qr_image_base64` 作为图片展示给用户, 让用户用对应的手机APP扫码:
- 百度网盘 → 百度APP / 百度网盘APP
- 夸克网盘 → 夸克APP
- 阿里云盘 → 阿里云盘APP

### 第四步: 轮询扫码状态
```
netdisk_login(action="poll", service="baidu", sign="第二步返回的sign")
→ 返回 {"ok": true, "status": "logged_in"} 则登录成功
→ 返回 {"ok": false, "status": "timeout"} 则超时, 需要重新生成二维码
```

## 支持的网盘

| 网盘 | 域名 | 登录方式 | 状态 |
|------|------|----------|------|
| 百度网盘 | pan.baidu.com | 扫码登录 | ✅ 已测试通过 |
| 夸克网盘 | pan.quark.cn | 扫码登录 | ⚠️ 需网络可达 |
| 阿里云盘 | alipan.com | 扫码登录 | ⚠️ API需更新 |
| 天翼云盘 | cloud.189.cn | - | ⚠️ 部分支持 |
| 迅雷网盘 | pan.xunlei.com | - | ⚠️ 部分支持 |
| 蓝奏云 | lanzou.com | 无需登录 | ✅ 最稳定 |

## 工作流

### 完整流程（登录 → 解析 → 下载）
```
1. netdisk_login(action="check", service="baidu")
   → need_login=true 则继续

2. netdisk_login(action="qr", service="baidu")
   → 获取 qr_image_base64 和 sign

3. [展示二维码给用户扫码]

4. netdisk_login(action="poll", service="baidu", sign="返回的sign")
   → Cookie自动保存到 .baidu_cookie

5. netdisk_parse(url="https://pan.baidu.com/s/xxx", password="提取码")
   → 返回 direct_url

6. netdisk_download(url=direct_url, threads=16)
   → 文件下载到服务器
```

### 解析并下载（一步完成）
```
netdisk_parse_and_download(url="https://pan.baidu.com/s/xxx", password="abcd", threads=16)
→ 自动解析+下载到服务器 uploads/downloads/ 目录
```

## 参数说明

### netdisk_login
- `action` (必填): check=检查状态, qr=生成二维码, poll=轮询状态
- `service` (必填): baidu|quark|aliyun
- `sign` (poll时必填): 百度qr返回的sign
- `qr_token` (poll时必填): 夸克qr返回的qr_token
- `ck_code` (poll时必填): 阿里qr返回的ck_code

### netdisk_parse
- `url` (必填): 网盘分享链接
- `password` (可选): 提取码/密码

### netdisk_download
- `url` (必填): 文件直链URL
- `filename` (可选): 保存文件名
- `output_dir` (可选): 下载目录, 默认 uploads/downloads
- `threads` (可选): 下载线程数, 默认16, 最大32

## 注意事项

1. 百度网盘必须先登录才能解析分享链接
2. Cookie保存后长期有效, 不需要每次登录
3. 夸克和阿里云盘需要服务器网络可达
4. 蓝奏云不需要登录, 解析最稳定
5. 大文件建议使用 threads=32 加速
