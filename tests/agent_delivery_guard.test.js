const assert = require('assert');
const fs = require('fs');

const main = fs.readFileSync('public/js/main.js', 'utf8');
const toolsExec = fs.readFileSync('public/js/tools-exec.js', 'utf8');
const tools = fs.readFileSync('public/js/tools.js', 'utf8');
const init = fs.readFileSync('public/js/init.js', 'utf8');
const commands = fs.readFileSync('public/js/commands.js', 'utf8');

// RS/HTTP 两条路径合并 tool_calls 时必须按语义参数去重，不能以模型生成 id 为权威。
assert(main.includes('function _semanticToolKey(_tc)'), '缺少工具语义指纹函数');
assert(main.includes('return _semanticToolKey(_tc);'), 'pendingMsg tool_calls 未按语义合并');
assert(!main.includes("if (_tc && _tc.id) return 'id:' + _tc.id;"), '仍以 tool_call id 优先去重');

// 子代理 prompt 不得被硬截到 500 字，也不得强塞 engine_push 指令。
assert(!main.includes("parsed.prompt = parsed.prompt.substring(0, 500)"), '仍会静默截断子代理 prompt');
assert(main.includes('保留完整 engine_agent_create prompt'), '缺少完整 prompt 保护说明');

// engine_push 不得把通知文案直接写进 assistant 正文；只保留结构化交付元数据。
assert(!toolsExec.includes("pendingMsg.content = (pendingMsg.content || '') + '\\n📥 '"), 'engine_push 仍污染 assistant 正文');
assert(toolsExec.includes('pendingMsg._pushedFiles'), 'engine_push 未结构化记录交付文件');
assert(tools.includes('不要自行估算字数、页数、测试结果或格式状态'), 'engine_push schema 未约束未核验描述');

// 默认导出必须排除工具结果/工具卡/内部思考；诊断导出需显式 opt-in。
for (const src of [init, commands]) {
    assert(src.includes("exportChatDebug") && src.includes("m.role === 'tool'") && src.includes("m.role === 'tool_card'"), '导出过滤或 debug 开关缺失');
}

console.log('✅ agent_delivery_guard.test.js: all assertions passed');
