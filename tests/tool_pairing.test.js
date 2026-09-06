const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api-messages.js'), 'utf8');
const context = { console };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'api-messages.js' });
const normalize = context.normalizeToolMessagePairs;
assert.strictEqual(typeof normalize, 'function');

const callA = { id: 'call_a', type: 'function', function: { name: 'read', arguments: { path: 'a' } } };
const callB = { id: 'call_b', type: 'function', function: { name: 'read', arguments: '{}' } };

let result = normalize([
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: '', tool_calls: [callA, callB] },
  { role: 'tool', tool_call_id: 'call_b', content: 'B' },
  { role: 'tool', tool_call_id: 'call_a', content: 'A' }
], 'test');
assert.deepStrictEqual(Array.from(result, m => m.role), ['user', 'assistant', 'tool', 'tool']);
assert.deepStrictEqual(Array.from(result.slice(2), m => m.tool_call_id), ['call_a', 'call_b']);
assert.strictEqual(typeof result[1].tool_calls[0].function.arguments, 'string');

result = normalize([
  { role: 'assistant', content: '', tool_calls: [callA, callB] },
  { role: 'tool', tool_call_id: 'call_a', content: 'A' }
], 'test');
assert.deepStrictEqual(Array.from(result, m => m.role), ['assistant', 'tool']);
assert.deepStrictEqual(Array.from(result[0].tool_calls, m => m.id), ['call_a']);

result = normalize([
  { role: 'assistant', content: '', tool_calls: [callA] },
  { role: 'user', content: 'next' },
  { role: 'tool', tool_call_id: 'call_a', content: 'late' }
], 'test');
assert.deepStrictEqual(Array.from(result, m => m.role), ['assistant', 'user']);
assert.strictEqual(result[0].tool_calls, undefined);

console.log('tool_pairing.test.js: all assertions passed');
