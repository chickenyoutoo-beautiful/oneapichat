const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runHygieneTests() {
    console.log('[Test] Running Console Hygiene and Load Order suite...');

    // 1. 验证 tools/build-index.py 中 core.js 位于第一位
    {
        const buildScript = fs.readFileSync('tools/build-index.py', 'utf8');
        assert.ok(buildScript.includes('("js/core.js", True, "")'), 'build-index.py 必须包含 js/core.js');
        const match = buildScript.match(/CORE_MODULES\s*=\s*\[([\s\S]*?)\]/);
        assert.ok(match, 'CORE_MODULES 应被定义');
        const firstEntry = match[1].trim().split('\n')[0];
        assert.ok(firstEntry.includes('js/core.js'), 'js/core.js 必须是 CORE_MODULES 的第一项以保证优先初始化');
    }

    // 2. 验证 public/index.html 中 core.js 排在业务模块最前面
    {
        const indexHtml = fs.readFileSync('public/index.html', 'utf8');
        const corePos = indexHtml.indexOf('src="./js/core.js');
        const mainPos = indexHtml.indexOf('src="./js/main.js');
        assert.ok(corePos !== -1, 'index.html 中必须包含 core.js');
        assert.ok(mainPos !== -1, 'index.html 中必须包含 main.js');
        assert.ok(corePos < mainPos, 'core.js 必须在 main.js 之前加载');
    }

    // 3. 扫描 public/js 确保已消除已知的危险打印
    {
        const files = fs.readdirSync('public/js').filter(f => f.endsWith('.js'));
        for (const f of files) {
            const content = fs.readFileSync(path.join('public/js', f), 'utf8');
            // 确保没有把上游 400 完整错误四连打
            assert.ok(!content.includes('[HTTP 400 完整错误]'), f + ' 不应包含旧版 HTTP 400 完整错误日志');
            // 确保没有未脱敏的 netdisk_login 参数日志
            assert.ok(!content.includes('[netdisk_login] 处理器被调用, args:'), f + ' 不应打印未脱敏的网盘登录 args');
            // 确保没有未脱敏的 buildApiMessages 消息内容输出
            assert.ok(!content.includes("tc_ids=' + JSON.stringify(_tcIds)"), f + ' 不应输出消息正文片段');
        }
    }

    // 4. 验证 RAG 系统未登录防 401 守卫
    {
        const ragSrc = fs.readFileSync('public/js/rag-system.js', 'utf8');
        assert.ok(ragSrc.includes('function _ragHasAuth()'), 'rag-system.js 必须定义 _ragHasAuth');
        assert.ok(ragSrc.includes('if (!_ragHasAuth())'), 'rag-system.js 必须在 initRAGPanel 中判断 _ragHasAuth');
    }

    console.log('✅ All Console Hygiene tests passed successfully!');
}

runHygieneTests();
