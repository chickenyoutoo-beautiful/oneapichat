const assert = require('assert');
const fs = require('fs');

const agent = fs.readFileSync('public/js/agent.js', 'utf8');
const exec = fs.readFileSync('public/js/tools-exec.js', 'utf8');

assert(agent.includes('window._normalizeAgentPlan'), '缺少计划快照标准化');
assert(agent.includes("任务 " + "' + (idx + 1)"), '计划空标题没有回退标题');
assert(agent.includes("忽略未知 task_id"), '未知 task_id 仍可能制造幽灵任务');
assert(!agent.includes("window._agentPlan.tasks.push({\n            id: taskId"), '仍会追加未知任务');
assert(agent.includes('window._flowPanelDismissTimer'), '缺少计划自动关闭计时器');
assert(agent.includes('window.clearPlanForChat(cid);'), '自动关闭后未清理持久化计划');
assert(agent.includes('plan.status === \'completed\''), '恢复时未拦截已完成计划复活');
assert(exec.includes('面板将自动关闭'), 'plan_update complete 未触发关闭语义');
assert(exec.includes('为避免产生空白幽灵项'), '未知任务更新没有明确错误');

console.log('✅ plan_completion_guard.test.js: all assertions passed');
