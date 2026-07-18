---
name: multi-agent-orchestration
description: 复杂多步骤任务编排。使用计划面板+子代理并行+定时任务+工作流。Use for complex multi-step tasks requiring parallel agents, planning, and orchestration.
version: 1.0.0
metadata:
  oneapichat:
    tools: [plan_update, delegate_task, delegate_workflow, engine_agent_create, engine_agent_list, engine_agent_status, engine_agent_ask, engine_agent_stop, engine_agent_delete, engine_cron_create, engine_cron_list, engine_cron_delete, run_skill, ask_agent, autonomous_mode, engine_push]
    priority: high
    emoji: "🤖"
    triggers: [并行, 多任务, 同时做, 复杂任务, 分步骤, 代理, Agent, 自动化, 定时, 计划, 编排, 多线, 并发, 批量, 多个任务]
---

# 多Agent并行任务编排

协调多个子代理、定时任务和计划面板，高效完成复杂多步骤工作。

## 何时使用

- 任务需要3个以上步骤且可并行
- 用户说"同时做A和B和C"
- 需要批量处理(如批量爬取多个网站)
- 需要定时执行的任务
- 复杂任务需要先规划再执行

## 编排模式

### 模式1: 计划驱动 (3+步骤)
```
1. plan_update(action="create") → 拆解任务创建计划面板
2. 按计划逐步执行，每步更新: plan_update(action="update", task_id="X", status="running")
3. 全部完成: plan_update(action="complete")
```

### 模式2: 子代理并行 (独立任务)
```
1. engine_agent_create → 为每个独立任务创建子代理
   - agent_1: "搜索B站Python教程并整理TOP10"
   - agent_2: "在GitHub搜索Python热门项目"
2. engine_agent_list → 确认全部创建成功
3. engine_agent_ask → 向各代理发送任务指令(并行触发)
4. engine_agent_status → 轮询完成状态
5. engine_agent_delete → 清理完成的代理
```

### 模式3: 工作流代理 (有依赖关系)
```
delegate_workflow → 创建有依赖关系的工作流
{
  "steps": [
    {"id": "search", "depends": [], "task": "搜索资料"},
    {"id": "analyze", "depends": ["search"], "task": "分析搜索结果"},
    {"id": "report", "depends": ["analyze"], "task": "生成报告"}
  ]
}
```

### 模式4: 定时任务
```
engine_cron_create → 创建定时任务(如每小时检查一次)
engine_cron_list → 查看所有定时任务
engine_cron_delete → 删除不需要的定时任务
```

### 模式5: 技能调度
```
run_skill → 调用已安装的技能(如deep-search)
多个技能可串联: search → analyze → create
```

## 决策流程图

```
任务复杂度?
├─ 简单(1-2步) → 直接执行
├─ 中等(3-5步,有依赖) → 模式1(计划面板)
├─ 中等(3-5个独立子任务) → 模式2(子代理并行)
├─ 复杂(6+步,多种依赖) → 模式3(工作流)
└─ 重复性任务 → 模式4(定时任务)
```

## 输出格式

```
🤖 任务编排计划
📋 总任务数: 5 | 并行组: 2

Group A (并行):
  🟢 task_1: 搜索B站教程 → engine_agent_create("bilibili-search")
  🟢 task_2: 搜索GitHub → engine_agent_create("github-search")

Group B (依赖A):
  ⏳ task_3: 分析整合 → 等待A完成
  ⏳ task_4: 生成报告 → 等待A完成

Group C (依赖B):
  ⏳ task_5: 推送通知 → engine_push
```

## 技巧

1. 独立任务一定并行——不要串行等待
2. 子代理创建后立即 `ask` 发送任务，不要逐个等待
3. 用 `engine_agent_status` 轮询而非盲目等待
4. 计划面板对用户可见——创建计划后用户能看到进度
5. 完成后清理: `engine_agent_delete` + `plan_update(action="complete")`
6. 定时任务记得设置合理的执行频率，避免API配额浪费
