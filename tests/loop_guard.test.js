const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'loop-guard.js'),
    'utf8'
);

function boot(cfg) {
    const context = { console };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'loop-guard.js' });
    return { context, LoopGuard: context.window.LoopGuard, normalize: context.window.normalizeToolCallArgs };
}

// ★ 参数规范化: volatile 字段(时间戳/随机数/请求ID)剥离 → 语义相同判同
(function testNormalizeStripsVolatile() {
    const { normalize } = boot();
    assert.strictEqual(
        normalize({ query: 'x', ts: 1234567890123, nonce: 'abc' }),
        normalize({ query: 'x' }),
        'ts/nonce 应被剥离, 语义相同参数判同'
    );
    assert.strictEqual(
        normalize({ b: 2, a: 1 }),
        normalize({ a: 1, b: 2 }),
        '键序不同的等价 JSON 应判同(键排序)'
    );
    assert.notStrictEqual(
        normalize({ query: '电影' }),
        normalize({ query: '音乐' }),
        '不同 query 不应判同'
    );
    // 数字与字符串不互转(保守)
    assert.notStrictEqual(normalize({ q: 5 }), normalize({ q: '5' }));
})();

// ★ 重复检测: 相同工具+参数第 3 次触发 soft, 2 次不触发
(function testRepeatDetection() {
    const { LoopGuard } = boot();
    const g = new LoopGuard();
    g.recordToolCall('web_search', { query: '死循环测试' });
    g.recordToolCall('web_search', { query: '死循环测试' });
    assert.strictEqual(g.softTriggerCount(), 0, '2 次不触发');
    assert.strictEqual(g.lastSoftTrigger(), null);
    g.recordToolCall('web_search', { query: '死循环测试' });
    assert.strictEqual(g.softTriggerCount(), 1, '第 3 次触发 soft');
    assert.ok(g.lastSoftTrigger().reason.includes('重复'), '原因含"重复"');
    // 第 3 次起 isDuplicateTool 命中(执行循环内软跳过)
    assert.strictEqual(g.isDuplicateTool('web_search', { query: '死循环测试' }), true);
})();

// ★ 软升级: 模型无视提示继续复读 → softTriggers 达 3 → check() 硬 soft-escalate
(function testSoftEscalate() {
    const { LoopGuard } = boot();
    const g = new LoopGuard();
    g.recordToolCall('video_download', { url: 'magnet:xxx' });
    g.recordToolCall('video_download', { url: 'magnet:xxx' });
    g.recordToolCall('video_download', { url: 'magnet:xxx' });  // soft#1
    g.recordToolCall('video_download', { url: 'magnet:xxx' });  // soft#2
    assert.strictEqual(g.softTriggerCount(), 2);
    assert.strictEqual(g.check(), null, '2 次软触发未升级');
    g.recordToolCall('video_download', { url: 'magnet:xxx' });  // soft#3
    const chk = g.check();
    assert.ok(chk && chk.level === 'hard' && chk.type === 'soft-escalate', '3 次软触发升级 hard: ' + JSON.stringify(chk));
})();

// ★ 振荡: ABABAB 与 AABBAA 命中, 3 种工具轮转不命中, 窗口内有正文不命中
(function testOscillation() {
    // ABABAB(无正文)
    const g1 = new (boot().LoopGuard)();
    ['A', 'B', 'A', 'B', 'A', 'B'].forEach(n => g1.recordToolCall(n, {}));
    assert.ok(g1.softTriggerCount() >= 1, 'ABABAB 应触发振荡 soft');
    // AABBAA
    const g2 = new (boot().LoopGuard)();
    ['A', 'A', 'B', 'B', 'A', 'A'].forEach(n => g2.recordToolCall(n, {}));
    assert.ok(g2.softTriggerCount() >= 1, 'AABBAA 应触发振荡 soft');
    // 3 种工具轮转
    const g3 = new (boot().LoopGuard)();
    ['A', 'B', 'C', 'A', 'B', 'C'].forEach(n => g3.recordToolCall(n, {}));
    assert.strictEqual(g3.softTriggerCount(), 0, '3 种工具轮转不触发');
    // 窗口内有正文增长(内容长度必须增加, 不能等长; 参数带序号避免重复检测干扰)
    const g4 = new (boot().LoopGuard)();
    g4.feedText('搜索结果 1: 内容一');       // 窗口前有正文
    g4.recordToolCall('A', { q: 1 }); g4.recordToolCall('B', { q: 1 });
    g4.feedText('搜索结果 2: 内容二, 并补充了更多细节信息。');  // 窗口内正文增长
    g4.recordToolCall('A', { q: 2 }); g4.recordToolCall('B', { q: 2 });
    g4.recordToolCall('A', { q: 3 }); g4.recordToolCall('B', { q: 3 });
    assert.strictEqual(g4.softTriggerCount(), 0, '窗口内正文有增长不触发振荡');
})();

// ★ 连续纯工具轮: 6 轮无正文 → hard; 中途有正文清零
(function testToolOnlyRounds() {
    const { LoopGuard } = boot();
    const g = new LoopGuard();
    for (let i = 0; i < 6; i++) g.recordRound(2);
    const chk = g.check();
    assert.ok(chk && chk.level === 'hard' && chk.type === 'tool-only', '连续 6 轮纯工具 hard');
    // 中途有正文清零
    const g2 = new LoopGuard();
    g2.recordRound(2); g2.recordRound(2); g2.recordRound(2);
    g2.feedText('模型开始输出正文了'); g2.recordRound(2);
    assert.strictEqual(g2.check(), null, '有正文后清零');
})();

// ★ 文本复读: 复读触发 hard; 正常长文不触发
(function testRepeatText() {
    const { LoopGuard } = boot();
    const g = new LoopGuard();
    const block = '这是一段复读内容哦,用来测试死循环检测的。';
    g.feedText('正常开头: 用户的问题分析如下。' + block.repeat(30));  // >400 字符
    const chk = g.check();
    assert.ok(chk && chk.level === 'hard' && chk.type === 'repeat-text', '正文复读应触发: ' + JSON.stringify(chk));
    // 正常长文(50 条不同句子)
    const g2 = new LoopGuard();
    let normal = '';
    for (let i = 0; i < 50; i++) normal += '第' + i + '条不同内容的句子,涵盖各方面信息。';
    g2.feedText(normal);
    assert.strictEqual(g2.check(), null, '正常长文不触发');
})();

// ★ 推理死循环: 正文为 0 + 推理复读 → hard; 正文有增长不触发
(function testReasoningLoop() {
    const { LoopGuard } = boot();
    const g = new LoopGuard();
    const r = '推理推理推理思考思考思考再想想想想想想。';
    g.feedReasoning(r.repeat(120));  // 2200+ 字符复读, 正文为空
    const chk = g.check();
    assert.ok(chk && chk.level === 'hard' && chk.type === 'reasoning-loop', '推理死循环应触发');
    // 正文有增长 → 不触发推理死循环
    const g2 = new LoopGuard();
    g2.feedText('已经输出了正文回答。');
    g2.feedReasoning(r.repeat(60));
    assert.strictEqual(g2.check(), null, '有正文输出时不触发推理死循环');
})();

// ★ 无进展: 2000+ 字符但唯一内容不足 30% (有限块混排但无 ≤100 字符周期, 避免 repeat-text 抢先)
(function testNoProgress() {
    const { LoopGuard } = boot();
    const g = new LoopGuard();
    const blocks = [];
    for (let i = 1; i <= 20; i++) blocks.push('B' + String(i).padStart(7, '0'));  // 20 种 8 字符块
    let text = '';
    for (let r = 0; r < 15; r++) for (const b of blocks) text += b;  // 300 块 = 2400 字符, 周期 160 > 100
    g.feedText(text);
    const chk = g.check();
    assert.ok(chk && chk.level === 'hard' && chk.type === 'no-progress', '有限块混排应触发 no-progress: ' + JSON.stringify(chk));
})();

// ★ 正常多轮搜索不误杀: 8 次不同 query + 每轮有正文
(function testLegitMultiSearch() {
    const { LoopGuard } = boot();
    const g = new LoopGuard();
    for (let i = 0; i < 8; i++) {
        g.recordToolCall('web_search', { query: '搜索关键词' + i });
        g.recordRound(1);
        g.feedText('搜索结果 ' + i + ': 这是第' + i + '个关键词的完整结果内容, 包含有效信息若干。' + '补充细节内容'.repeat(i));
    }
    assert.strictEqual(g.check(), null, '不同关键词连续搜索不触发');
    assert.strictEqual(g.softTriggerCount(), 0);
})();

// ★ 阈值覆盖: cfg maxRepeat:5 → 4 次不触发 5 次触发
(function testCfgMaxRepeat() {
    const { LoopGuard } = boot();
    const g = new LoopGuard({ maxRepeat: 5 });
    for (let i = 0; i < 4; i++) g.recordToolCall('server_python', { script: 'print(1)' });
    assert.strictEqual(g.softTriggerCount(), 0, '4 次不触发(maxRepeat=5)');
    g.recordToolCall('server_python', { script: 'print(1)' });
    assert.strictEqual(g.softTriggerCount(), 1, '5 次触发');
})();

// ★ 禁用: enabled:false → 全部检测失效
(function testDisabled() {
    const { LoopGuard } = boot();
    const g = new LoopGuard({ enabled: false });
    const r = '复读复读复读复读复读复读复读复读。';
    g.feedText('正常内容' + r.repeat(30));
    g.recordToolCall('web_search', { query: 'x' });
    g.recordToolCall('web_search', { query: 'x' });
    g.recordToolCall('web_search', { query: 'x' });
    for (let i = 0; i < 6; i++) g.recordRound(2);
    assert.strictEqual(g.check(), null, '禁用时全部返回 null');
    assert.strictEqual(g.softTriggerCount(), 0);
})();

// ★ 长参数哈希路径: 3500 字符重复参数判同
(function testLongArgHash() {
    const { LoopGuard } = boot();
    const g = new LoopGuard();
    const big = 'x'.repeat(3500);
    g.recordToolCall('server_python', { script: big });
    assert.strictEqual(g.isDuplicateTool('server_python', { script: big }), false, '首次不重复');
    // 长参数规范化走哈希后仍稳定
    const { normalize } = boot();
    assert.strictEqual(normalize({ script: big }), normalize({ script: big }), '长参数哈希确定性');
})();

console.log('loop_guard.test.js 全部通过 (' + 12 + ' 组用例)');
