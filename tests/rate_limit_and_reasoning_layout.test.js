const assert = require('assert');
const fs = require('fs');

const main = fs.readFileSync('public/js/main.js', 'utf8');
const stream = fs.readFileSync('public/js/stream-handler.js', 'utf8');
const style = fs.readFileSync('public/css/style.css', 'utf8');
const theme = fs.readFileSync('public/css/theme-studio.css', 'utf8');

assert(main.includes('var is429Error ='), '缺少429专用识别');
assert(main.includes('请求过于频繁，') && main.includes('正在稍后重试'), '429没有用户可见提示');
assert(main.includes("e.code = 'RATE_LIMIT'"), '429没有结构化错误码');
assert(main.includes("e.message = '请求过于频繁，服务商暂时限流。"), '429耗尽后没有明确结束文案');
assert(main.includes("showToast('请求过于频繁，"), '429没有倒计时提示');
assert(stream.includes('错误收尾必须同时解除所有生成态'), '错误收尾没有解除生成态说明');
assert(stream.includes("delete isTypingMap[chatId]"), '错误收尾未清理typing状态');
assert(style.includes('.message-row.assistant .bubble.assistant details.reasoning-details'), '思考块缺少助手轨道宽度规则');
assert(style.includes('width: 100% !important') && style.includes('overflow-wrap: anywhere'), '思考块宽度/长文本保护缺失');
assert(theme.includes('html[data-theme-page="chat"] details.reasoning-details') && theme.includes('width: 100% !important'), '主题层覆盖会重新收缩思考块');
assert(theme.includes('.message-row.assistant .bubble.assistant.typing:not(:has(details.reasoning-details))'), 'typing 等待态不得把已出现思考块的气泡限制为窄胶囊');

console.log('✅ rate_limit_and_reasoning_layout.test.js: all assertions passed');
