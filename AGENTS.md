# OneAPIChat 项目说明

## 项目位置
- **主项目（线上运行）**: `/var/www/html/oneapichat/`
- **Python 实验版**: `/home/naujtrats/oneapichat-py/`
- **独立刷课工具**: `/tmp/AutomaticCB/`

## 技术栈
- **后端**: PHP（主）+ Python（考试自动化模块）
- **浏览器自动化**: Playwright (Python)，chromium-1217
- **代理**: Python HTTP 代理（端口 8898）
- **Node**: v22.22.2，npm 10.9.7
- **Web 服务**: nginx（端口 80/443）+ Apache（端口 8080）

## 运行中的服务
- 80: nginx 反向代理
- 443: nginx HTTPS (naujtrats.xyz)
- 8080: oneapichat (PHP) + 星河影院
- 8081: Express（Basic Auth）
- 8898: exam_proxy.py 超星考试代理
- 9222: Chrome CDP 远程调试
- 18788: MCP Server
- 18789: OpenClaw 网关
- 3306: MySQL
- 27107: MongoDB

## 超星考试模块

### 架构
PHP API (chaoxing_api.php) → Python (main.py)
  ├→ API 模式 (exam_auto.py / ChaoxingExam)
  └→ 浏览器模式 (exam_browser.py / BrowserExam)
        ├→ Headless Chromium (Playwright)
        ├→ 代理模式 (exam_proxy.py :8898)
        └→ CDP 模式 (Chrome :9222)

### 核心文件
- /var/www/html/oneapichat/chaoxing_api.php — PHP API 网关
- /var/www/html/oneapichat/main.py — 主流程
- /var/www/html/oneapichat/api/exam_auto.py — 考试 API 模式，类 ChaoxingExam
- /var/www/html/oneapichat/api/exam_browser.py — 考试浏览器模式，类 BrowserExam
- /var/www/html/oneapichat/api/base.py — 超星 API session
- /var/www/html/oneapichat/api/answer.py — 题库引擎
- /var/www/html/oneapichat/api/tracker.py — SQLite 学习追踪
- /var/www/html/oneapichat/scripts/exam_proxy.py — 透明代理
- /var/www/html/oneapichat/scripts/exam_playwright.js — Node.js Playwright 备用
- /var/www/html/oneapichat/config.ini — 主账号配置
- /tmp/AutomaticCB/config_u_*.ini — 各用户配置

### 账号
- 19118593666（主）— 学生: 向奕侨
- PHONE_REMOVED — 学生: 周申来

### 考试状态
- 9459820: 安全知识竞答 — 待做，有滑块验证码
- 9444807: 艺术哲学 — 5月18日开放
- 9328672: 艺术美学 — 5月18日开放
- 9219915: 漫画艺术欣赏与创作 — 5月18日开放（191账号）
- 9318647: 画说-试卷 — 5月18日开放（191账号）

### 修复记录
1. 浏览器崩溃: exam_browser.py 原用 snap chromium，改用 Playwright 自带 chromium-1217
2. Cookie 域不匹配: 浏览器默认直连超星 URL，代理仅作 fallback
3. 验证码 captchaCheck=0 HTML 注入不够，需图像分析+鼠标模拟

### 已知问题
滑块验证码（captcha-b.chaoxing.com）服务端校验，自动解决需要更精确的缺口位置检测

## 网络
- WSL2 IP: 192.168.195.213
- Windows 宿主机: 192.168.195.22
- 网关: 192.168.1.1
- 域名: naujtrats.xyz
- DNS: 223.5.5.5 / 8.8.8.8
