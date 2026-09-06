const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runTests() {
    const renderingSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'rendering.js'), 'utf8');
    const dialogsSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'dialogs.js'), 'utf8');
    const themeStudioSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'theme-studio.css'), 'utf8');
    const parentIndexSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
    const indexRootSrc = fs.readFileSync(path.join(__dirname, '..', 'index_root.html'), 'utf8');

    assert(renderingSrc.includes("container.classList.add('agent-welcome-active');"), 'Agent showWelcome 必须在容器上标记 agent-welcome-active');
    assert(renderingSrc.includes("container.classList.remove('agent-welcome-active');"), 'showWelcome 与 appendMessage 必须能移除 agent-welcome-active');
    assert(dialogsSrc.includes("container.classList.remove('agent-welcome-active');"), 'loadChat 清空 DOM 时必须同步移除 agent-welcome-active');

    assert(themeStudioSrc.includes('#chatMessagesContainer.agent-welcome-active'), 'theme-studio.css 必须为 Agent 空态提供专属样式规则');
    assert(themeStudioSrc.includes('justify-content: center !important;'), 'Agent 空态必须使用聊天区可用高度垂直居中');
    assert(themeStudioSrc.includes('min-height: 100% !important;'), 'Agent 空态容器必须撑满 100% 可视高度以消除底部大块空白');

    // 移动端体验增强：回到底部按钮、模型下拉宽度与用户头像卡片
    assert(themeStudioSrc.includes('#scrollToBottomBtn'), 'theme-studio.css 必须定义 #scrollToBottomBtn 最终样式');
    assert(themeStudioSrc.includes('calc(env(safe-area-inset-bottom, 0px) + 82px)'), '回到底部按钮必须上移且避开输入框与安全区');
    assert(themeStudioSrc.includes('max-width: min(58vw, 260px) !important;'), '普通模式移动端模型选择器必须允许弹性宽度');
    assert(themeStudioSrc.includes('#oneapiUserDropdown'), 'theme-studio.css 必须统一样式到 #oneapiUserDropdown');

    const managerDir = path.join(__dirname, '..', '..', 'manager');
    const managerIndex = path.join(managerDir, 'index.html');
    assert(fs.existsSync(managerDir), '/var/www/html/manager 目录必须存在');
    assert(fs.existsSync(managerIndex), '/var/www/html/manager/index.html 兼容软链接必须存在');

    const managerSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'manager.html'), 'utf8');
    assert(managerSrc.includes('initBackTarget'), 'manager.html 必须包含智能返回来源解析');
    assert(managerSrc.includes("fromParam === 'home'"), 'manager.html 必须支持 from=home 参数显式锁定返回主页');
    assert(managerSrc.includes("fallback = '/'"), 'manager.html 默认返回必须是网站主页 /');

    assert(parentIndexSrc.includes('href="/manager.html?from=home"'), '主页必须携带 ?from=home 参数');
    assert(indexRootSrc.includes('href="/manager.html?from=home"'), 'index_root.html 必须携带 ?from=home 参数');
    console.log('✅ mobile_welcome_and_manager_route.test.js: 全部断言通过');
}

runTests();
