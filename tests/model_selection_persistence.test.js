const assert = require('assert');
const fs = require('fs');

const catalogCode = fs.readFileSync('public/js/models-catalog.js', 'utf8');
const utilsCode = fs.readFileSync('public/js/utils.js', 'utf8');
const configCode = fs.readFileSync('public/js/config.js', 'utf8');
const initCode = fs.readFileSync('public/js/init.js', 'utf8');
const coreCode = fs.readFileSync('public/js/core.js', 'utf8');

global.window = {};
eval(catalogCode);
const catalog = window.ModelsCatalog;

// 1. 验证不同大小写、自定义模型 ID 在 renderModelOptionsHtml 中都能被正确保留和选中
const xaiHtml = catalog.renderModelOptionsHtml([], 'xai', 'grok-4.5');
assert(xaiHtml.includes('value="grok-4.5" selected'), 'xai selected grok-4.5 must be selected in html');

const deepseekHtml = catalog.renderModelOptionsHtml([], 'deepseek', 'deepseek-reasoner');
assert(deepseekHtml.includes('value="deepseek-reasoner" selected'), 'deepseek selected deepseek-reasoner must be selected in html');

// 验证异构模型跨厂商隔离：当切换到 mimo 时，历史 deepseek-v4-flash 绝不能出现在 mimo 列表里
const mimoHtml = catalog.renderModelOptionsHtml([], 'mimo', 'deepseek-v4-flash');
assert(!mimoHtml.includes('deepseek-v4-flash'), 'mimo catalog must not contain cross-provider deepseek-v4-flash');
assert(mimoHtml.includes('value="mimo-v2-flash" selected'), 'mimo catalog should fallback to select first mimo model');

// 验证自定义模型在 custom 模式下正确追加
const customModelHtml = catalog.renderModelOptionsHtml([], 'custom', 'my-custom-fine-tuned-model');
assert(customModelHtml.includes('value="my-custom-fine-tuned-model" selected'), 'custom model must be appended and selected in custom mode');

// 动态中转列表的模型选择必须不被历史全局 deepseek 模型插入或覆盖
const dynamicCustomHtml = catalog.renderModelOptionsHtml([{ id: 'grok-4.5' }, { id: 'gemini-3.6-flash-high' }], 'custom', 'grok-4.5');
assert(dynamicCustomHtml.includes('value="grok-4.5" selected'), 'dynamic custom selected model must remain selected');
assert(!dynamicCustomHtml.includes('deepseek-v4-flash'), 'dynamic custom list must not inject stale deepseek model');

// 2. 验证 utils.js / config.js / init.js 均有防丢失保护
assert(utilsCode.includes('_matchedOpt = true'), 'utils.js must have robust option matching');
assert(configCode.includes('_matchedOpt2 = true'), 'config.js must have robust option matching');
assert(initCode.includes('_matchedInit = true'), 'init.js must have robust option matching');
assert(configCode.includes('__fetchModelsSeq'), 'fetchModels must isolate provider request generations');
assert(configCode.includes('_fetchModelsIsStale()'), 'fetchModels must reject stale provider responses');
assert(utilsCode.includes('__fetchModelsController.abort()'), 'provider change must cancel prior model request');
assert(!coreCode.includes("id === 'modelSelect' && DEFAULT_CONFIG"), 'getVal must not fabricate a default model for empty modelSelect');
assert(initCode.includes("localStorage.setItem('model', _pm)"), 'initializeConfig must persist the saved provider model directly');

console.log('model_selection_persistence.test.js: all assertions passed!');
