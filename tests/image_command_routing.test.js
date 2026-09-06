const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const root = require('path').resolve(__dirname, '..');
const commands = fs.readFileSync(root + '/public/js/commands.js', 'utf8');
const main = fs.readFileSync(root + '/public/js/main.js', 'utf8');
const upload = fs.readFileSync(root + '/public/js/upload.js', 'utf8');
const tools = fs.readFileSync(root + '/public/js/tools.js', 'utf8');
const imageGen = fs.readFileSync(root + '/public/js/image-gen.js', 'utf8');
const toolsExec = fs.readFileSync(root + '/public/js/tools-exec.js', 'utf8');
const config = fs.readFileSync(root + '/public/js/config.js', 'utf8');
const proxyPhp = fs.readFileSync(root + '/api/proxy.php', 'utf8');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(commands, sandbox);

const parsed = sandbox.window.parseCommand('/image 蕾米莉亚 壁纸');
assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed)), {
  type: 'search', cmd: 'force_search', query: '蕾米莉亚 壁纸', kind: 'images', imageMode: 'search_only'
});
const mixed = sandbox.window.parseCommand('/image 搜索水墨武侠图片，然后参考搜索结果生成一张海报');
assert.strictEqual(mixed.imageMode, 'search_and_generate');
const plainGenerate = sandbox.window.parseCommand('/image 搜索高清风景图');
assert.strictEqual(plainGenerate.imageMode, 'search_only');
assert.strictEqual(sandbox.window.parseCommand('/image').query, '');

const naturalSearch = sandbox.window.classifyImageRequestIntent('给我收集有关原神冰神的有趣插图，例如蜜雪冰城雪王');
assert.deepStrictEqual(JSON.parse(JSON.stringify(naturalSearch)), {
  kind: 'images', imageMode: 'search_only', query: '给我收集有关原神冰神的有趣插图，例如蜜雪冰城雪王'
});
assert.strictEqual(sandbox.window.classifyImageRequestIntent('帮我找几张科比的照片').imageMode, 'search_only');
assert.strictEqual(sandbox.window.classifyImageRequestIntent('画一张原神冰神与雪王的联动海报'), null,
  '单纯创作请求必须保留生图能力');
assert.strictEqual(sandbox.window.classifyImageRequestIntent('搜索冰神图片，然后参考搜索结果生成海报').imageMode, 'search_and_generate');

assert(main.includes("if (forceSearch || (!useToolCall && getChecked('searchToggle')))"),
  '显式搜索命令必须绕过 searchToolCallToggle 直接执行');
assert(main.includes("forcedType === 'images'"), '必须识别显式图片搜索');
assert(main.includes("imageCommandMode === 'search_only'"),
  '只有纯搜图轮才移除生图工具');
assert(main.includes("imageCommandMode === 'search_and_generate'"),
  '复合搜图再生成必须保留生图能力');
assert(main.includes('classifyImageRequestIntent'), '普通自然语言搜图必须先经过确定性意图分类');
assert(main.includes('【图片搜索任务】'), '纯搜图上下文必须锁定已有图片搜索语义');
assert(main.includes('【图片搜索复合任务】'), '复合任务上下文必须允许参考搜索结果生图');
assert(upload.includes('自然语言中的“搜索/查找/收集/给我找几张图片'),
  '系统提示必须覆盖普通自然语言搜图，而不只识别 /image');
assert(tools.includes('reference_source'), '图生图工具必须支持选择搜索结果作为参考来源');
assert(tools.includes('reference_indexes'), '图生图工具必须支持选择搜索结果序号');
assert(tools.includes('用户说搜索、查找、收集、推荐'),
  '生图工具描述必须禁止把自然语言搜图误判为创作');

assert(imageGen.includes("if (_is_gpt_image && (_i2i_provider === 'openai' || _i2i_provider === 'custom'))"),
  'OpenAI/Custom 的 GPT Image 图生图必须走原生 edits 分支');
assert(imageGen.includes("var apiUrl = baseUrl + '/images/edits';"),
  'GPT Image 图生图必须使用 /v1/images/edits');
assert(imageGen.includes("if (_is_gpt_image && _i2i_provider === 'openrouter')"),
  '仅 OpenRouter GPT Image 使用 chat/completions 扩展');
assert(!imageGen.includes("gpt-image-2 不可用，兼容回退到 gpt-image-1.5"),
  '不得把用户配置的 gpt-image-2 自动降级为 image-1.5');
assert(!imageGen.includes("图生图失败,降级为文生图"),
  '图生图失败不得静默丢弃参考图并退化成文生图');
assert(toolsExec.includes("localStorage.getItem('imageModel_' + _activeImageProvider)"),
  '图像模型必须来自独立图片提供商配置，而不是 xAI 等主聊天提供商');
assert(config.includes("options.body instanceof FormData"),
  'proxyFetch 必须识别 FormData，不能把 multipart body JSON 化成空对象');
assert(config.includes("dataBase64: btoa(_formBinary)"),
  '浏览器中继必须无损序列化 multipart 文件');
assert(proxyPhp.includes("new CURLFile($tmpPath, $contentType, $safeFilename)"),
  'PHP 中继必须重建 CURLFile 与真实 multipart boundary');
assert(proxyPhp.includes("images/(?:generations|edits)"),
  '图片 edits 请求必须采用生图长超时和防重放策略');

const resumeStream = fs.readFileSync(root + '/public/js/resume-stream.js', 'utf8');
assert(resumeStream.includes('var _stopControllers = {};'),
  'RS 必须拥有独立的用户停止控制器');
assert(resumeStream.includes('_resumeStopController.signal'),
  '恢复流必须使用独立停止信号，不能复用主请求 AbortController');
assert(/\b(?:stopController|controller)\.abort\(\)/.test(resumeStream),
  '显式停止时仍必须取消 RS 后台流');

console.log('image command routing regression tests passed');
