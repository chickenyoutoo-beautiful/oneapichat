---
name: browser-automation
description: 浏览器自动化。网页导航/截图/点击/输入/内容提取。Use for web browser automation including navigation, screenshots, clicking, typing, and content extraction.
version: 1.0.0
metadata:
  oneapichat:
    tools: [browser_navigate, browser_screenshot, browser_click, browser_type, browser_get_content, browser_get_snapshot]
    priority: medium
    emoji: "🌐"
    triggers: [浏览器, 打开网页, 访问网站, 自动填表, 网页截图, 爬取页面, browser, 登录网站, 自动操作, 网页自动化]
---

# 浏览器自动化

远程控制Chromium浏览器: 导航/截图/点击/输入/内容提取。

## 何时使用

- 需要访问需要登录的网站
- 网页内容需要JS渲染才能看到
- 自动填表/提交操作
- 截取完整网页截图
- 提取动态加载的网页内容

## 工具

| 工具 | 功能 |
|------|------|
| `browser_navigate` | 导航到URL |
| `browser_screenshot` | 页面截图(可视区/全页) |
| `browser_click` | 点击元素(selector/text/坐标) |
| `browser_type` | 输入文字到输入框 |
| `browser_get_content` | 提取可读文本 |
| `browser_get_snapshot` | 获取DOM结构快照 |

## 工作流

### 网页信息提取
```
1. browser_navigate(url) → 打开页面
2. browser_screenshot → 截图确认加载成功
3. browser_get_content → 提取文本
4. browser_get_snapshot → 获取DOM结构(用于定位元素)
```

### 自动填表
```
1. browser_navigate(url) → 打开目标页面
2. browser_get_snapshot → 找到输入框selector
3. browser_type(selector, text) → 填写表单
4. browser_click(submit_button) → 提交
5. browser_screenshot → 确认结果
```

### 动态内容抓取
```
1. browser_navigate(url) → 打开页面
2. 等待JS渲染(browser_screenshot确认)
3. browser_get_content → 提取完整内容
4. 如需翻页: browser_click(next_button) → 重复步骤2-3
```

## 技巧

1. `browser_get_snapshot` 先看DOM再定位——避免盲目点击
2. 点击后等1-2秒再截图(给页面加载时间)
3. `browser_get_content` 自动移除script/style标签，只返回可读文本
4. 登录类操作先用截图确认当前状态
