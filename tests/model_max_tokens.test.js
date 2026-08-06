const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'models.js'),
    'utf8'
);

function makeStorage(seed) {
    const values = seed || {};
    return {
        values,
        get length() { return Object.keys(values).length; },
        key(index) { return Object.keys(values)[index] || null; },
        getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
        setItem(key, value) { values[key] = String(value); },
        removeItem(key) { delete values[key]; }
    };
}

function boot(sharedValues) {
    const localStorage = makeStorage(sharedValues);
    const context = { console, localStorage };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'models.js' });
    return { context, localStorage };
}

// ★ LongCat 回归: /models 元数据报 389120 (0.95×409600), 但静态配置上限 128000。
//   学习值必须被静态配置封顶, 否则 ModelCap 失效 → 400 "is not less or equal to 128000"。
(function testLongCatOverrideCapped() {
    const { context } = boot({ modelMaxOutputTokens: JSON.stringify({ 'LongCat-2.0': 389120 }) });
    const got = context.window.MODEL_CONFIGS.getMaxOutputTokens('LongCat-2.0');
    assert.strictEqual(got, 128000, 'LongCat 学习值 389120 必须被静态配置封顶为 128000');
})();

(function testLongCatNoOverride() {
    const { context } = boot({});
    const got = context.window.MODEL_CONFIGS.getMaxOutputTokens('LongCat-2.0');
    assert.strictEqual(got, 128000, 'LongCat 无学习值时返回静态上限 128000');
})();

// 学习值比静态配置低(API 错误揭示真实限制) → 学习值生效(收紧方向不受影响)
(function testLearnedValueLowerWins() {
    const { context } = boot({ modelMaxOutputTokens: JSON.stringify({ 'deepseek-v4-flash': 8192 }) });
    const got = context.window.MODEL_CONFIGS.getMaxOutputTokens('deepseek-v4-flash');
    assert.strictEqual(got, 8192, '学习值低于静态配置时应生效');
})();

// 未知/自定义模型回退通配符配置: maxOutputTokens 与 contextWindow 一致 (131072),
// 不再被钳到 4096。AutoAdjust 学习值会在 getMaxOutputTokens 中自动收紧 (Math.min)。
(function testUnknownModelFallback() {
    const { context } = boot({ modelMaxOutputTokens: JSON.stringify({ other: 999999 }) });
    const got = context.window.MODEL_CONFIGS.getMaxOutputTokens('some-random-model');
    assert.strictEqual(got, 131072, '未知模型回退通配符上限 131072 (不再钳到 4096)');
})();

// 自定义 GPT 模型: 学习值低于通配符上限时, 学习值生效 (AutoAdjust 收紧)
(function testCustomModelLearnedValue() {
    const { context } = boot({ modelMaxOutputTokens: JSON.stringify({ 'my-custom-gpt': 8192 }) });
    const got = context.window.MODEL_CONFIGS.getMaxOutputTokens('my-custom-gpt');
    assert.strictEqual(got, 8192, '自定义模型学习值 8192 应生效');
})();

// 自定义 GPT 模型: 学习值高于通配符上限时, 被通配符上限钳住
(function testCustomModelCapped() {
    const { context } = boot({ modelMaxOutputTokens: JSON.stringify({ 'my-custom-gpt': 999999 }) });
    const got = context.window.MODEL_CONFIGS.getMaxOutputTokens('my-custom-gpt');
    assert.strictEqual(got, 131072, '自定义模型学习值 999999 应被通配符上限 131072 钳住');
})();

// 学习值恰好等于静态值
(function testLearnedValueEqual() {
    const { context } = boot({ modelMaxOutputTokens: JSON.stringify({ 'LongCat-2.0': 128000 }) });
    const got = context.window.MODEL_CONFIGS.getMaxOutputTokens('LongCat-2.0');
    assert.strictEqual(got, 128000);
})();

console.log('model max_tokens override capping (LongCat 400 regression): ok');
