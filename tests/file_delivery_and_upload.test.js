const assert = require('assert');
const fs = require('fs');

const files = fs.readFileSync('public/js/files.js', 'utf8');
const upload = fs.readFileSync('public/js/upload.js', 'utf8');
const exec = fs.readFileSync('public/js/tools-exec.js', 'utf8');
const markdown = fs.readFileSync('public/js/markdown.js', 'utf8');
const tools = fs.readFileSync('public/js/tools.js', 'utf8');
const php = fs.readFileSync('api/engine_api.php', 'utf8');

assert(files.includes('var _docUploadPromise = uploadVideoBlob(file'), '可解析文档未上传原文件');
assert(files.includes('serverPath: _serverPath'), '可解析文档未保存服务器路径');
assert(upload.includes("formData.append('name', file.name)"), 'multipart 未传原始文件名');
assert(upload.includes("typeof result === 'object'"), 'uploadVideoBlob 未兼容结构化上传返回值');
assert(!upload.includes('result.startsWith'), 'uploadVideoBlob 仍对对象调用 startsWith');
assert(tools.includes('filename: { type: "string"'), 'engine_push 缺少 filename 参数');
assert(exec.includes("&filename="), 'engine_push 未向后端传下载文件名');
assert(exec.includes("📥 ["), 'engine_push 未生成 Markdown 文件链接');
assert(markdown.includes('function _enhanceDownloadLinks'), '缺少下载按钮增强器');
assert(markdown.includes('oac-download-link'), '下载链接未升级按钮类');
assert(!php.includes("$fn = 'push_' . substr(md5($srcPath . time())"), 'push_file 仍强制哈希命名');
assert(php.includes('$requestedFilename') && php.includes('$displayName'), 'push_file 未保留指定文件名');

console.log('✅ file_delivery_and_upload.test.js: all assertions passed');
