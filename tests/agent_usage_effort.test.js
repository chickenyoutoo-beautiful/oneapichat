const fs = require('fs');
const assert = require('assert');

const main = fs.readFileSync('public/js/main.js', 'utf8');
const php = fs.readFileSync('api/chat.php', 'utf8');

assert(main.includes('pendingMsg.effort = _thinkingIntensity;'), 'initial assistant message must persist selected thinking intensity');
assert(main.includes("effort: pendingMsg.effort || _thinkingIntensity || ''"), 'Agent chained messages must inherit thinking intensity');
assert(main.includes("model: pendingMsg.model || body.model || modelName || ''"), 'Agent chained messages must retain model metadata');
assert(php.includes("$effort = $msg['effort'] ?? $msg['reasoning_effort'] ?? $msg['thinking_level'] ?? '';"), 'usage API must read persisted effort fields');
assert(php.includes("'effort' => $effort"), 'usage detail must return normalized effort');
assert(!php.includes("'effort' => !empty($msg['reasoning']) ? '高' : '未记录'"), 'usage API must not infer all effort from reasoning presence');

console.log('agent usage effort regression checks passed');
