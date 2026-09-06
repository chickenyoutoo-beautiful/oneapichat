const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync('python/engine_server.py', 'utf8');
const retention = fs.readFileSync('python/engine/upload_retention.py', 'utf8');

assert(source.includes('cleanup_uploads'), '引擎未接入上传清理');
assert(source.includes('user_retention_days=90'), '用户附件90天保留策略缺失');
assert(source.includes('shared_retention_days=30'), 'shared文件30天保留策略缺失');
assert(retention.includes('skipped_referenced'), '清理模块缺少引用文件保护');
assert(retention.includes('dry_run'), '清理模块缺少dry-run能力');

console.log('✅ upload_retention.test.js: all assertions passed');
