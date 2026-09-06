const assert = require('assert');
const fs = require('fs');

const mainJs = fs.readFileSync('public/js/main.js', 'utf8');

// 测试 tolerantToolInput
const fnMatch = mainJs.match(/function tolerantToolInput\(toolName, raw\)\s*\{([\s\S]*?)\n\}/);
assert(fnMatch, 'Could not find tolerantToolInput');
const tolerantToolInput = new Function('toolName', 'raw', fnMatch[1]);

// 1. 测试标准代码内容
const normalJson = JSON.stringify({
    file_path: "/var/www/html/wheel.html",
    content: '<!DOCTYPE html>\n<html>\n<style>\n.spin-btn { color: red; }\n</style>\n<script>\nconst prizes = ["一等奖", "二等奖"];\nfunction drawWheel() {\n  console.log("spin-btn");\n}\n</script>'
});
const r1 = tolerantToolInput('write', normalJson);
assert(r1 && r1.file_path === '/var/www/html/wheel.html');
assert(r1.content.includes('drawWheel'));

// 2. 测试含有未转义内部引号与破损结构的 JSON
const brokenCase = '{"file_path": "index.html", "content": "<script> const list = [\"a\", \"b\"]; function drawWheel() { return \"spin-btn\"; } </script>"}';
const r2 = tolerantToolInput('write', brokenCase);
assert(r2 && r2.file_path === 'index.html');
assert(r2.content.includes('spin-btn'));
assert(r2.content.includes('drawWheel'));

// 3. 测试截断情况 (write 在 drawWheel 处被截断)
const truncCase = '{"file_path": "index.html", "content": "<style>.spin-btn {color: red;}</style><script>function drawWheel() { console.log(';
const r3 = tolerantToolInput('write', truncCase);
assert(r3 && r3.file_path === 'index.html');
assert(r3.content.includes('drawWheel'));

console.log('✅ tool_arg_repair_truncation.test.js: all assertions passed');
