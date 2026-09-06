const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function createSandbox(initialOptions = {}) {
    const rawEvents = [];
    const windowListeners = {};
    const originalFns = {
        debug(...args) { rawEvents.push({ level: 'debug', args }); },
        log(...args) { rawEvents.push({ level: 'log', args }); },
        info(...args) { rawEvents.push({ level: 'info', args }); },
        warn(...args) { rawEvents.push({ level: 'warn', args }); },
        error(...args) { rawEvents.push({ level: 'error', args }); }
    };

    const fakeConsole = {
        debug: originalFns.debug,
        log: originalFns.log,
        info: originalFns.info,
        warn: originalFns.warn,
        error: originalFns.error,
        table(...args) { rawEvents.push({ level: 'table', args }); }
    };

    const sessionStore = new Map(Object.entries(initialOptions.sessionStorage || {}));
    const localStore = new Map(Object.entries(initialOptions.localStorage || {}));

    const sandbox = {
        console: fakeConsole,
        window: null,
        addEventListener(event, handler) {
            windowListeners[event] = windowListeners[event] || [];
            windowListeners[event].push(handler);
        },
        sessionStorage: {
            getItem(k) { return sessionStore.has(k) ? sessionStore.get(k) : null; },
            setItem(k, v) { sessionStore.set(k, String(v)); },
            removeItem(k) { sessionStore.delete(k); },
            clear() { sessionStore.clear(); }
        },
        localStorage: {
            getItem(k) { return localStore.has(k) ? localStore.get(k) : null; },
            setItem(k, v) { localStore.set(k, String(v)); },
            removeItem(k) { localStore.delete(k); },
            clear() { localStore.clear(); }
        },
        location: {
            origin: 'https://naujtrats.xyz',
            search: initialOptions.search || '',
            pathname: '/oneapichat/'
        },
        document: {
            documentElement: { setAttribute() {} },
            body: { setAttribute() {} },
            getElementById() { return null; }
        },
        Date,
        Map,
        Error,
        JSON,
        Object,
        Array,
        String,
        Number,
        Boolean,
        RegExp,
        Function,
        __ONEAPICHAT_LOG_LEVEL__: initialOptions.explicitLevel
    };
    sandbox.window = sandbox;

    const coreSrc = fs.readFileSync('public/js/core.js', 'utf8');
    const ctx = vm.createContext(sandbox);
    vm.runInContext(coreSrc, ctx);

    return { sandbox, ctx, rawEvents, fakeConsole, originalFns, windowListeners };
}

function runTests() {
    console.log('[Test] Running AppLogger suite...');

    // 1. 默认状态与单例
    {
        const { sandbox } = createSandbox();
        assert.ok(sandbox.AppLogger, 'AppLogger 应挂载在全局');
        assert.strictEqual(sandbox.AppLogger.getLevel(), 'warn', '默认级别应为 warn');
        assert.strictEqual(sandbox.AppLogger.__oneApiChatLogger, true);
    }

    // 2. 生产模式下 log/debug 被静默但进入 recent 缓冲区
    {
        const { sandbox, rawEvents } = createSandbox();
        sandbox.console.log('[Task] 开始后台任务 123');
        sandbox.console.debug('[Stream] chunk 1');
        assert.strictEqual(rawEvents.length, 0, 'warn 级别下 log/debug 不应直接输出到 console');

        const recent = sandbox.AppLogger.getRecent();
        assert.strictEqual(recent.length, 2, 'debug/log 应记录在环形缓冲区');
        assert.strictEqual(recent[0].namespace, 'Task');
        assert.strictEqual(recent[0].level, 'debug');
    }

    // 3. 动态切换日志级别与 sessionStorage 记忆
    {
        const { sandbox, rawEvents } = createSandbox();
        sandbox.AppLogger.setLevel('debug');
        assert.strictEqual(sandbox.AppLogger.getLevel(), 'debug');
        assert.strictEqual(sandbox.sessionStorage.getItem('oc_log_level'), 'debug');

        sandbox.console.log('[Agent] 决策完成', { plan: 'step1' });
        assert.strictEqual(rawEvents.length, 1, '切为 debug 级别后 log 应正常输出');
        assert.strictEqual(rawEvents[0].level, 'log');
        assert.ok(String(rawEvents[0].args[0]).includes('[OneAPIChat][DEBUG][Agent]'));
    }

    // 4. URL ?debug=1 自动进入 debug 级别
    {
        const { sandbox } = createSandbox({ search: '?debug=1' });
        assert.strictEqual(sandbox.AppLogger.getLevel(), 'debug', '?debug=1 时应自动初始化为 debug');
    }

    // 5. URL ?log=info 自动进入 info 级别
    {
        const { sandbox, rawEvents } = createSandbox({ search: '?log=info' });
        assert.strictEqual(sandbox.AppLogger.getLevel(), 'info');
        sandbox.console.info('[Init] 系统初始化完成');
        assert.strictEqual(rawEvents.length, 1, 'info 日志在 info 级别下输出');
    }

    // 6. 敏感信息自动脱敏 (Bearer, API Keys, Passwords, Cookie, URL tokens)
    {
        const { sandbox } = createSandbox();
        sandbox.AppLogger.setLevel('debug');
        sandbox.console.warn('[Auth] 请求头包含: Bearer sk-ant-api03-secret-token-value-123456');
        sandbox.console.warn('[Proxy] 目标URL: https://api.openai.com/v1/chat?api_key=sk-1234567890abcdef&model=gpt-4');
        sandbox.console.warn('[Config] 敏感对象:', {
            apiKey: 'sk-998877665544332211',
            password: 'super-secret-pass',
            auth_token: 'tok_abcdef123456',
            safeField: 'normal-value'
        });

        const recent = sandbox.AppLogger.getRecent();
        const str0 = JSON.stringify(recent[0].args);
        assert.ok(!str0.includes('sk-ant-api03-secret-token-value-123456'), 'Bearer token 应被脱敏');
        assert.ok(str0.includes('Bearer [REDACTED]'));

        const str1 = JSON.stringify(recent[1].args);
        assert.ok(!str1.includes('sk-1234567890abcdef'), 'URL query 中的 key 应被脱敏');
        assert.ok(str1.includes('api_key=[REDACTED]'));

        const obj2 = recent[2].args[1];
        assert.strictEqual(obj2.apiKey, '[REDACTED]');
        assert.strictEqual(obj2.password, '[REDACTED]');
        assert.strictEqual(obj2.auth_token, '[REDACTED]');
        assert.strictEqual(obj2.safeField, 'normal-value');
    }

    // 7. 循环引用与不可枚举对象安全
    {
        const { sandbox } = createSandbox();
        sandbox.AppLogger.setLevel('debug');
        const circular = { name: 'root' };
        circular.self = circular;
        assert.doesNotThrow(() => {
            sandbox.console.warn('[Memory] 循环对象检查:', circular);
        });
        const recent = sandbox.AppLogger.getRecent();
        assert.strictEqual(recent[0].args[1].self, '[Circular]');
    }

    // 8. 预期回退/保护性跳过自动降级 (从 warn 降为 info/debug)
    {
        const { sandbox, rawEvents } = createSandbox();
        // 生产默认 warn，预期回退被归类为 info/debug，因而不打扰控制台
        sandbox.console.warn('[storage] 本地仅0条,跳过发送防止覆盖服务器');
        sandbox.console.warn('[search] 搜索无结果,回退到服务端代理重试中');
        assert.strictEqual(rawEvents.length, 0, '保护性跳过与回退在 warn 级别下应被降噪');

        const recent = sandbox.AppLogger.getRecent();
        assert.strictEqual(recent[0].level, 'debug');
        assert.strictEqual(recent[1].level, 'info');
    }

    // 9. 最终失败保留 warn / error
    {
        const { sandbox, rawEvents } = createSandbox();
        sandbox.console.warn('[search] 服务端代理也失败，无法回退');
        sandbox.console.error('[Engine] 请求失败: 500 Internal Server Error');
        assert.strictEqual(rawEvents.length, 2, '真正的最终失败与 error 应正常输出');
        assert.strictEqual(rawEvents[0].level, 'warn');
        assert.strictEqual(rawEvents[1].level, 'error');
    }

    // 10. KaTeX 字体指标等已知第三方干扰静默
    {
        const { sandbox, rawEvents } = createSandbox();
        sandbox.AppLogger.setLevel('debug');
        sandbox.console.warn('KaTeX: No character metrics for "测" in style "Main-Regular"');
        assert.strictEqual(rawEvents.length, 0, 'KaTeX 指标警告应完全静默');
        const stats = sandbox.AppLogger.getStats();
        assert.strictEqual(stats.suppressed, 1);
    }

    // 11. 控制台还原支持 (restoreConsole)
    {
        const { sandbox, rawEvents, originalFns } = createSandbox();
        assert.strictEqual(typeof sandbox.console.warn, 'function');
        sandbox.AppLogger.restoreConsole();
        assert.strictEqual(sandbox.console.warn, originalFns.warn, 'restoreConsole 应还原原始 console 方法');

        sandbox.console.warn('raw-warn-without-prefix');
        assert.strictEqual(rawEvents.length, 1);
        assert.strictEqual(rawEvents[0].args[0], 'raw-warn-without-prefix', '还原后不应再附带 [OneAPIChat] 前缀');
    }

    // 12. dump(), export(), help() 工具函数测试
    {
        const { sandbox, rawEvents } = createSandbox();
        sandbox.console.log('[Stream] connected');
        sandbox.console.warn('[Search] fallback');
        
        // dump
        const dumpRes = sandbox.AppLogger.dump('Stream');
        assert.ok(dumpRes.includes('共展示 1 条日志'));
        assert.ok(rawEvents.some(r => r.level === 'table'), 'dump 应调用 console.table');

        // export
        const exportJson = JSON.parse(sandbox.AppLogger.export());
        assert.strictEqual(exportJson.app, 'OneAPIChat');
        assert.strictEqual(exportJson.logs.length, 2);

        // help
        sandbox.AppLogger.help();
        assert.ok(rawEvents.some(r => r.level === 'info' && String(r.args[0]).includes('OneAPIChat 控制台日志排查指南')));
    }

    // 13. 全局未捕获异常与 Promise 拒绝捕获
    {
        const { sandbox, rawEvents, windowListeners } = createSandbox();
        assert.ok(windowListeners.error && windowListeners.error.length > 0, '应注册 error 监听');
        assert.ok(windowListeners.unhandledrejection && windowListeners.unhandledrejection.length > 0, '应注册 unhandledrejection 监听');

        // 模拟普通运行时异常
        windowListeners.error[0]({ message: 'TypeError: cannot read null', filename: 'https://naujtrats.xyz/main.js' });
        assert.strictEqual(rawEvents.length, 1);
        assert.strictEqual(rawEvents[0].level, 'error');

        // 模拟扩展插件异常（应被静默）
        windowListeners.error[0]({ message: 'Extension context invalidated', filename: 'chrome-extension://abcdef/content.js' });
        assert.strictEqual(rawEvents.length, 1, '浏览器插件异常不应产生控制台错误');
    }

    console.log('✅ All AppLogger tests passed successfully!');
}

runTests();
