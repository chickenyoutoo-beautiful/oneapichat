const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'rendering.js'),
    'utf8'
);

// 提取 createToolCallCard 函数源码(括号配平)
function extractFunction(src, name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, 'function ' + name + ' not found');
    const bodyStart = src.indexOf('{', start);
    let depth = 0;
    let i = bodyStart;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    return src.slice(start, i + 1);
}

function boot() {
    // 最小 document: createToolCallCard 只用到 createElement + innerHTML 存取
    const elements = [];
    const document = {
        createElement() {
            const el = {
                className: '',
                innerHTML: '',
                setAttribute() {},
                addEventListener() {},
                querySelector() { return null; }   // 折叠逻辑走不到, 无需真 DOM
            };
            elements.push(el);
            return el;
        }
    };
    const context = {
        console,
        document,
        window: {},
        escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    };
    vm.createContext(context);
    vm.runInContext(extractFunction(source, 'createToolCallCard'), context);
    return { context, elements };
}

// ── 工具调用卡片: execDetails.command 必须包在可换行 span 内(移动端长命令不再横向溢出) ──
(function testExecCommandWrappedWithBreakRules() {
    const { context, elements } = boot();
    const card = context.window ? null : null;
    const args = { cmd: 'echo hi' };
    const result = { output: 'hi' };
    const execDetails = {
        command: 'ffmpeg -i "https://example.com/very/long/url/segment" -c copy out.mp4',
        output: 'ok',
        exitCode: 0
    };
    const el = context.createToolCallCard('server_exec', args, result, 1234, execDetails);
    const html = el.innerHTML;
    assert.ok(html.indexOf('tool-exec-summary') !== -1, '应渲染 exec 摘要');
    // ★ 命令文本必须包在 flex:1 + min-width:0 + overflow-wrap:anywhere 的 span 内
    assert.ok(
        html.indexOf('flex:1;min-width:0;overflow-wrap:anywhere;word-break:break-word') !== -1,
        '命令 span 必须带 flex:1/min-width:0/overflow-wrap:anywhere'
    );
    assert.ok(html.indexOf('ffmpeg -i "https://example.com/very/long/url/segment"') !== -1, '命令原文应在 span 内');
    // ★ summary 不应再是命令文本直接作为裸文本节点
    const bareText = html.match(/<svg[^>]*><\/svg> (?!<span>)/);
    assert.strictEqual(bareText, null, '命令不应作为匿名 flex 文本节点直接渲染');
})();

// ── 长命令原文保留(escape 后), 不被截断 ──
(function testLongCommandPreserved() {
    const { context } = boot();
    const longCmd = 'python3 /var/www/html/oneapichat/python/engine_server.py --host 0.0.0.0 --port 8766 ' +
        '--config /var/www/html/oneapichat/config/very-long-config-file-name-with-many-characters.json ' +
        '--debug --reload';
    const el = context.createToolCallCard('server_exec', {}, { output: 'started' }, 99, { command: longCmd, exitCode: 0 });
    assert.ok(el.innerHTML.indexOf('very-long-config-file-name-with-many-characters') !== -1, '长命令原文应完整保留');
})();

// ── 参数 pre 换行保护: 长 JSON 参数在移动端不横向撑爆卡片 ──
(function testArgsPreWraps() {
    const { context } = boot();
    const longArgs = { url: 'https://pan.quark.cn/s/abcdefghijklmnopqrstuvwxyz1234567890?pwd=abcd', note: 'very long argument value that should never overflow horizontally on mobile' };
    const el = context.createToolCallCard('netdisk_parse', longArgs, null, 0, null);
    const argsHtml = el.innerHTML;
    assert.ok(
        argsHtml.indexOf('white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere') !== -1,
        '参数 pre 应带换行保护'
    );
    assert.ok(argsHtml.indexOf('max-width:100%') !== -1, '参数 pre 应限制 max-width:100%');
})();

// ── exec 输出 pre: 换行保护 + 宽度约束 ──
(function testExecOutputPreWraps() {
    const { context } = boot();
    const el = context.createToolCallCard('server_exec', {}, { output: 'x'.repeat(300) }, 5, {
        command: 'ls',
        output: 'file_' + 'a'.repeat(120) + '_' + 'b'.repeat(120),
        exitCode: 0
    });
    const html = el.innerHTML;
    assert.ok(html.indexOf('tool-exec-output') !== -1, '应渲染 exec 输出');
    assert.ok(html.indexOf('white-space:pre-wrap;word-break:break-all') !== -1, 'exec 输出 pre 应换行保护');
    assert.ok(html.indexOf('box-sizing:border-box;max-width:100%') !== -1, 'exec 输出 pre 应限制宽度');
})();

// ── 结果 pre: 宽度约束(已有 pre-wrap, 补 max-width) ──
(function testResultPreWidthConstraint() {
    const { context } = boot();
    const el = context.createToolCallCard('web_search', { q: 'x' }, { result: 'y'.repeat(400) }, 8, null);
    assert.ok(el.innerHTML.indexOf('box-sizing:border-box;max-width:100%') !== -1, '结果 pre 应限制宽度');
})();

console.log('tool_card_overflow: 6/6 场景通过');
