const fs = require('fs');
const assert = require('assert');
const php = fs.readFileSync('api/chat.php', 'utf8');
assert(php.includes("preg_match('/^_+agent_/'"), 'legacy agent ids must be recognized');
assert(php.includes("preg_match('/^(unknown|undefined|null|n\\/a|未知模型)$/i'"), 'placeholder model names must be normalized');
assert(php.includes("'历史模型（未标注）'"), 'missing metadata must not be reported as unknown model');
console.log('legacy model fallback regression checks passed');
