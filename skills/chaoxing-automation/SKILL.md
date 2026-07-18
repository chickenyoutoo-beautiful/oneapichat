---
name: chaoxing-automation
description: 超星学习通刷课+考试一站式自动化。当用户需要刷课/看视频/做考试时自动管理全流程。Use when user needs automated course watching or exam taking on Chaoxing.
version: 1.0.0
metadata:
  oneapichat:
    tools: [chaoxing_login, chaoxing_list_courses, chaoxing_auto, chaoxing_status, chaoxing_stop, chaoxing_stats, chaoxing_overview, chaoxing_auth, chaoxing_exam_list, chaoxing_exam_start, chaoxing_exam_status, chaoxing_exam_stop]
    priority: high
    emoji: "📚"
    triggers: [刷课, 超星, 学习通, 网课, 挂机, 自动看课, 考试, 答题, chaoxing, 课程]
---

# 超星学习通刷课自动化

一站式管理超星学习通的课程刷取和考试自动化。从登录到完成全流程覆盖。

## 何时使用

- 用户说"帮我刷课"/"开始刷课"/"刷学习通"
- 用户想看课程进度/剩余课程
- 用户要参加超星考试
- 用户想停止正在进行的刷课任务
- 用户问"我还有多少课没刷"

## 流程

### A. 初次使用 — 登录
1. `chaoxing_login` — 检查登录状态，未登录则引导扫码/账号登录
2. `chaoxing_list_courses` — 获取课程列表，展示给用户确认

### B. 开始刷课
1. `chaoxing_auto` — 传入课程ID启动自动化
2. 后台自动: 播放视频 → 答题 → 切换下一节
3. `chaoxing_status` — 随时查看当前进度

### C. 检查进度
```
chaoxing_stats → 返回: 总课程/已完成/剩余/预计时间
chaoxing_overview → 返回: 全部课程概览
```

### D. 停止/控制
```
chaoxing_stop → 停止刷课
```

### E. 考试模式
```
chaoxing_auth → 考试登录(需独立验证)
chaoxing_exam_list → 待考列表
chaoxing_exam_start → 开始考试(自动答题)
chaoxing_exam_status → 考试进度
chaoxing_exam_stop → 停止考试
```

## 输出格式

刷课完成后输出:
```
📚 刷课完成报告
- 课程: {课程名}
- 完成章节: 12/15
- 用时: 45分钟
- 得分: 85分
```

## 技巧

1. 先 `chaoxing_overview` 看全局再决定刷哪门课
2. 刷课中不要重复调用 `chaoxing_auto`——先用 `chaoxing_status` 检查
3. 考试前确保已完成刷课(考试需要前置课程)
4. 同时只能有一门课在刷;多门课需排队
