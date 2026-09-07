const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

function runTest() {
    const managerHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'manager.html'), 'utf8');
    const mihomoHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'mihomo.html'), 'utf8');

    // 1. 静态断言
    assert(!managerHtml.includes("fromParam === 'mihomo'"), 'manager.html 严禁包含 fromParam === mihomo 分支');
    assert(!managerHtml.includes("label = '← 返回节点'"), 'manager.html 严禁显示返回节点');
    assert(!mihomoHtml.includes('href="/manager.html?from=mihomo"'), 'mihomo.html 严禁硬编码携带 ?from=mihomo');
    assert(managerHtml.includes("sessionStorage.setItem('manager_from'"), 'manager.html 必须持久化来源到 sessionStorage');
    assert(mihomoHtml.includes('goBackManager'), 'mihomo.html 必须包含安全返回函数 goBackManager');

    // 2. 模拟真实 DOM & 执行测试
    function createMockManagerEnv(search, referrer, sessionStore = {}) {
        const elements = {
            backLink: {
                textContent: '',
                attributes: {},
                setAttribute(k, v) { this.attributes[k] = v; },
                getAttribute(k) { return this.attributes[k]; }
            },
            mihomoToolCard: {
                href: '/oneapichat/public/mihomo.html'
            }
        };

        const sessionStorage = {
            getItem(k) { return sessionStore[k] || null; },
            setItem(k, v) { sessionStore[k] = String(v); }
        };

        const context = {
            document: {
                getElementById(id) { return elements[id] || null; },
                referrer: referrer || ''
            },
            window: {
                location: {
                    search: search || '',
                    origin: 'https://test.naujtrats.xyz',
                    href: 'https://test.naujtrats.xyz/manager.html' + (search || '')
                },
                history: {
                    length: 2,
                    backCalled: false,
                    back() { this.backCalled = true; }
                }
            },
            sessionStorage,
            URL,
            URLSearchParams
        };

        // 提取 initBackTarget 和 _goBack 的定义代码
        const scriptMatch = managerHtml.match(/function initBackTarget\(\)[\s\S]*?window\._goBack\s*=\s*function\(\)[\s\S]*?\};/);
        assert(scriptMatch, 'manager.html 必须匹配到 initBackTarget 与 _goBack 实现');

        vm.createContext(context);
        vm.runInContext(scriptMatch[0], context);

        return { context, elements, sessionStorage: sessionStore };
    }

    // 场景 A: 从聊天页面进入管理后台 (?from=chat)
    {
        const env = createMockManagerEnv('?from=chat', 'https://test.naujtrats.xyz/oneapichat/');
        env.context.initBackTarget();
        assert.strictEqual(env.elements.backLink.textContent, '← 返回聊天', '从聊天进入时返回文案必须是 ← 返回聊天');
        assert.strictEqual(env.elements.backLink.getAttribute('data-target'), '/oneapichat/', '返回目标必须是 /oneapichat/');
        assert.strictEqual(env.elements.mihomoToolCard.href, '/oneapichat/public/mihomo.html?from=chat', '点击节点管理必须透传 from=chat');
        assert.strictEqual(env.sessionStorage.manager_from, 'chat', 'sessionStorage 必须记录 chat 来源');

        // 测试点击返回
        env.context.window._goBack();
        assert.strictEqual(env.context.window.location.href, '/oneapichat/', '_goBack 必须导航到 /oneapichat/');
    }

    // 场景 B: 在 mihomo.html 中处理返回逻辑
    {
        function createMockMihomoEnv(search, referrer, sessionStore = {}) {
            const elements = {
                backBtn: {
                    href: '/manager.html',
                    attributes: {},
                    setAttribute(k, v) { this.attributes[k] = v; },
                    getAttribute(k) { return this.href; }
                }
            };
            const sessionStorage = {
                getItem(k) { return sessionStore[k] || null; },
                setItem(k, v) { sessionStore[k] = String(v); }
            };
            let backCalled = false;
            const context = {
                document: {
                    getElementById(id) { return elements[id] || null; },
                    referrer: referrer || ''
                },
                window: {
                    location: {
                        search: search || '',
                        origin: 'https://test.naujtrats.xyz',
                        href: 'https://test.naujtrats.xyz/oneapichat/public/mihomo.html' + (search || '')
                    },
                    history: {
                        length: 2,
                        back() { backCalled = true; }
                    }
                },
                sessionStorage,
                URL,
                URLSearchParams,
                getBackCalled() { return backCalled; }
            };

            const scriptMatch = mihomoHtml.match(/function initMihomoBack\(\)[\s\S]*?function goBackManager\([\s\S]*?\}\s*initMihomoBack\(\);/);
            assert(scriptMatch, 'mihomo.html 必须匹配到 initMihomoBack 与 goBackManager 实现');

            vm.createContext(context);
            vm.runInContext(scriptMatch[0], context);

            return { context, elements, getBackCalled: () => context.getBackCalled() };
        }

        // B1: 带着 ?from=chat 访问 mihomo.html，referrer 为管理后台
        const envMihomo = createMockMihomoEnv('?from=chat', 'https://test.naujtrats.xyz/manager.html?from=chat', { manager_from: 'chat' });
        assert.strictEqual(envMihomo.elements.backBtn.href, '/manager.html?from=chat', 'mihomo 返回链接必须带上 ?from=chat');
        envMihomo.context.goBackManager();
        assert.strictEqual(envMihomo.getBackCalled(), true, '有同域 manager 历史栈时必须优先调用 history.back()');

        // B2: 没有 history 时的兜底
        const envMihomoNoHistory = createMockMihomoEnv('?from=chat', '');
        envMihomoNoHistory.context.window.history.length = 1;
        envMihomoNoHistory.context.goBackManager();
        assert.strictEqual(envMihomoNoHistory.context.window.location.href, '/manager.html?from=chat', '无历史栈时必须跳转到带原来源的 /manager.html?from=chat');
    }

    // 场景 C: 从 mihomo 返回管理后台后，按钮必须依然是“← 返回聊天”而非“← 返回节点”
    {
        // 模拟通过链接直接跳回 /manager.html?from=chat
        const envBack = createMockManagerEnv('?from=chat', 'https://test.naujtrats.xyz/oneapichat/public/mihomo.html?from=chat', { manager_from: 'chat' });
        envBack.context.initBackTarget();
        assert.strictEqual(envBack.elements.backLink.textContent, '← 返回聊天', '返回管理后台后按钮文案必须依旧是 ← 返回聊天');
        assert.strictEqual(envBack.elements.backLink.getAttribute('data-target'), '/oneapichat/', '返回目标依然是 /oneapichat/');

        // 模拟极端异常情况：访问 URL 带着旧缓存 ?from=mihomo，referrer 是 mihomo
        const envLegacy = createMockManagerEnv('?from=mihomo', 'https://test.naujtrats.xyz/oneapichat/public/mihomo.html', { manager_from: 'chat' });
        envLegacy.context.initBackTarget();
        assert.strictEqual(envLegacy.elements.backLink.textContent, '← 返回聊天', '即使携带 from=mihomo，也必须自愈恢复为 ← 返回聊天');
        assert.strictEqual(envLegacy.elements.backLink.getAttribute('data-target'), '/oneapichat/', '自愈返回目标必须是 /oneapichat/');
        assert.notStrictEqual(envLegacy.elements.backLink.textContent, '← 返回节点', '绝对不能出现 ← 返回节点');
    }

    // 场景 D: 从主页进入 (?from=home)
    {
        const envHome = createMockManagerEnv('?from=home', 'https://test.naujtrats.xyz/');
        envHome.context.initBackTarget();
        assert.strictEqual(envHome.elements.backLink.textContent, '← 返回主页', '从主页进入时返回文案必须是 ← 返回主页');
        assert.strictEqual(envHome.elements.backLink.getAttribute('data-target'), '/', '返回目标必须是 /');
        assert.strictEqual(envHome.sessionStorage.manager_from, 'home', 'sessionStorage 必须记录 home 来源');
    }

    console.log('✅ manager_mihomo_return_flow.test.js: 4 大核心场景与全链路断言全部通过');
}

runTest();
