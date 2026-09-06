const assert = require('assert');
const fs = require('fs');
const agent = fs.readFileSync('public/js/agent.js', 'utf8');

assert(agent.includes('AbortSignal.timeout(8000)'), 'AgentPanel 辅助请求仍使用过长超时');
assert(agent.includes('_agentListNextRetryAt'), 'AgentPanel 缺少失败退避时间');
assert(agent.includes('_agentListFetchFailures'), 'AgentPanel 缺少指数退避计数');
assert(agent.includes('_isAgentListTimeoutError'), 'AgentPanel 缺少超时分类');
assert(agent.includes("console.info('[AgentPanel] 列表刷新超时"), '超时仍被持续记为 WARN');

console.log('✅ agent_panel_timeout.test.js: all assertions passed');
