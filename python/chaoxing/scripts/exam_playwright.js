#!/usr/bin/env node
/**
 * 超星考试浏览器自动化 (Node.js + Playwright)
 * 混合模式: 浏览器只负责「进入考试」，提取 enc 参数后交给 API 模式答题。
 *
 * 解决难点:
 *   1. Zepto/jquery.tap 用 touchstart/touchend 事件 → 需 hasTouch:true + page.tap()
 *   2. 确认弹窗 "进入考试" 按钮 → 也是通过 isTrusted 劫持 + 原生 click
 *   3. CLIENT_FORM_SIGN 需真实 user gesture → 通过代理 HTML 修改 / isTrusted 绕过
 *
 * 输入: JSON via STDIN 或 环境变量
 * 输出: 单行 JSON (stdout):
 *   success: true → { success:true, enc:"...", encRemainTime:123, encLastUpdateTime:123,
 *                      testUserRelationId: 123, title:"考试名称", stage:"entered" }
 *   success: false → { success:false, stage:"...", reason:"..." }
 *
 * 环境变量:
 *   EXAM_ID, COURSE_ID, CLASS_ID, CPI, ENC_TASK
 *   或通过 stdin 传入 JSON 对象
 */
const fs = require('fs');
const path = require('path');

let { chromium } = require('playwright');

// ── 配置 ──
const CHROMIUM_PATH = '/usr/bin/chromium-browser';
const COOKIE_FILE = '/tmp/cx_cookies.json';
const PROXY_PORT = 8898;
const PROXY_HOST = '192.168.195.213';

// ── 日志 ──
const log = {
  info:  (...a) => { const t = new Date().toISOString().slice(11,19); process.stderr.write(`[${t} EXAM] ${a.join(' ')}\n`); },
  warn:  (...a) => { const t = new Date().toISOString().slice(11,19); process.stderr.write(`[${t} EXAM⚠] ${a.join(' ')}\n`); },
  error: (...a) => { const t = new Date().toISOString().slice(11,19); process.stderr.write(`[${t} EXAM❌] ${a.join(' ')}\n`); },
  json:  (o)  => { process.stdout.write(JSON.stringify(o) + '\n'); process.stdout.end(); },
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 输入解析 ──
function parseInput() {
  // 优先 stdin JSON
  const stdin = fs.readFileSync('/dev/stdin', 'utf8').trim();
  if (stdin) {
    try { return JSON.parse(stdin); } catch(e) {}
  }
  // 环境变量 fallback
  return {
    exam_id:      process.env.EXAM_ID      || '9459820',
    course_id:    process.env.COURSE_ID    || '263695114',
    class_id:     process.env.CLASS_ID     || '146799509',
    cpi:          process.env.CPI          || '488376903',
    enc_task:     process.env.ENC_TASK     || '',
    proxy_host:   process.env.PROXY_HOST   || PROXY_HOST,
    proxy_port:   parseInt(process.env.PROXY_PORT || String(PROXY_PORT)),
  };
}

// ── Cookie 持久化 ──
async function saveCookies(context) {
  try {
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(await context.cookies(), null, 2));
  } catch(e) { log.warn('Save cookies fail:', e.message); }
}
async function loadCookies(context) {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      await context.addCookies(JSON.parse(fs.readFileSync(COOKIE_FILE,'utf8')));
    } else {
      log.info('No cookie file, will login fresh');
    }
  } catch(e) { log.warn('Load cookies fail:', e.message); }
}
function deleteCookies() {
  try { if (fs.existsSync(COOKIE_FILE)) fs.unlinkSync(COOKIE_FILE); } catch(e) {}
}

// ── 登录 ──
async function handleLogin(page, username, password) {
  if (!page.url().includes('passport') && !page.url().includes('login')) return true;
  log.info('Login page...');

  try { await page.waitForSelector('#phone', { timeout: 10000 }); } catch { return false; }

  await page.locator('#phone').click();
  await page.locator('#phone').fill(username);
  await sleep(300);
  await page.locator('#pwd').click();
  await page.locator('#pwd').fill(password);
  await sleep(300);

  // 协议
  try {
    const cbs = page.locator('input[type="checkbox"]');
    const n = await cbs.count();
    for (let i = 0; i < n; i++) {
      try { await cbs.nth(i).check({ force: true, timeout: 1000 }); } catch {}
    }
  } catch {}

  await page.locator('#loginBtn').click();
  await sleep(2000);
  try { await page.waitForURL(u => !u.includes('passport'), { timeout: 20000 }); } catch {}
  log.info('Login ' + (page.url().includes('passport') ? 'FAILED' : 'success'));
  return !page.url().includes('passport');
}

// ── 核心: 进入考试 ──
async function enterExam(page, params) {
  const { exam_id, course_id, class_id, cpi, enc_task } = params;

  // 构建代理 URL（已有的 HTML 修改代理）
  const proxyUrl = `http://${params.proxy_host}:${params.proxy_port}/exam-ans/exam/phone/task-exam` +
    `?taskrefId=${exam_id}&courseId=${course_id}&classId=${class_id}&cpi=${cpi}&ut=s`;

  log.info(`Navigating to: ${proxyUrl.substring(0,100)}...`);

  // ── 第一步: 加载考试封面页 ──
  await page.goto(proxyUrl, { waitUntil: 'networkidle', timeout: 45000 });
  await sleep(2000); // 等 JS 完全执行

  // 检查页面的实际文本
  const pageText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  log.info(`Page text: ${pageText.slice(0,200)}...`);

  // 检查是否已完成
  if (pageText.includes('已完成') || pageText.includes('已交卷')) {
    log.info('Exam already completed');
    return { success: true, stage: 'already_completed' };
  }

  // ── 第二步: 勾选同意 ──
  // 超星用 CSS class 切换，不是真实 checkbox
  const agreeResult = await page.evaluate(() => {
    try {
      const ar = document.querySelector('#agreeRules');
      if (ar) {
        ar.classList.add('checked');
        // 手动触发 change 和 click 事件
        ar.dispatchEvent(new Event('change', { bubbles: true }));
        ar.dispatchEvent(new Event('click', { bubbles: true }));
        return 'agreed';
      }
      return 'no_agree_element';
    } catch(e) { return 'error: ' + e.message; }
  });
  log.info(`Agree: ${agreeResult}`);

  // 等待 UI 更新
  await sleep(800);

  // ── 第三步: 通过 Zepto/jQuery tap 点击「开始考试」按钮 ──
  // 超星用 $().on('tap', handler) 绑定事件，需要原生 touch 事件触发
  log.info('Triggering start button via touch event...');

  // 先用 JS 检查事件状态
  const btnState = await page.evaluate(() => {
    const btn = document.querySelector('#start');
    if (!btn) return { exists: false };
    const rect = btn.getBoundingClientRect();
    return {
      exists: true,
      visible: btn.offsetParent !== null,
      disabled: btn.disabled,
      classList: Array.from(btn.classList),
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      text: btn.textContent.trim(),
      tabindex: btn.getAttribute('tabindex'),
      ariaHidden: btn.getAttribute('aria-hidden'),
    };
  });
  log.info(`Button state: ${JSON.stringify(btnState)}`);

  if (!btnState.exists || !btnState.visible) {
    return { success: false, stage: 'start_failed', reason: 'start_button_not_found' };
  }

  // 强制移除 tabindex/aria-hidden 以允许交互
  await page.evaluate(() => {
    const btn = document.querySelector('#start');
    if (btn) {
      btn.removeAttribute('tabindex');
      btn.removeAttribute('aria-hidden');
      btn.style.pointerEvents = 'auto';
      btn.style.opacity = '1';
      btn.disabled = false;
    }
  });

  // ★ 核心修复: 用 page.tap() 发送真实 touchstart/touchend 事件
  // 这会触发 Zepto/jQuery.tap 绑定的 tap 事件 handler
  const btnBox = await page.locator('#start').boundingBox();
  if (btnBox) {
    const cx = btnBox.x + btnBox.width / 2;
    const cy = btnBox.y + btnBox.height / 2;
    log.info(`Tapping start at (${cx.toFixed(0)}, ${cy.toFixed(0)})`);
    await page.touchscreen.tap(cx, cy);
  } else {
    // fallback: 用 locator.tap
    await page.locator('#start').tap();
  }

  await sleep(3000);

  // ── 第四步: 处理确认弹窗 ──
  // 确认弹窗 #confirmPop 可能通过 openConfirmPop() 动态创建
  // .msg-content-ok 的内容是 "进入考试"

  const popupState = await page.evaluate(() => {
    try {
      const pop = document.querySelector('#confirmPop');
      if (!pop) return { exists: false, reason: 'no_confirmPop' };
      const style = window.getComputedStyle(pop);
      const okBtn = pop.querySelector('.msg-content-ok');
      return {
        exists: true,
        display: style.display,
        visibility: style.visibility,
        okBtnText: okBtn ? okBtn.textContent.trim() : 'no_ok_btn',
        okBtnDisplay: okBtn ? window.getComputedStyle(okBtn).display : 'none',
      };
    } catch(e) { return { exists: false, reason: e.message }; }
  });
  log.info(`Popup: ${JSON.stringify(popupState)}`);

  if (popupState.exists && popupState.okBtnText === '进入考试') {
    // 点击「进入考试」按钮
    const okBtn = page.locator('#confirmPop .msg-content-ok');
    if (await okBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await okBtn.tap();
      log.info('Clicked 进入考试 via tap');
    } else {
      // fallback: JS 直接触发
      await page.evaluate(() => {
        const btn = document.querySelector('#confirmPop .msg-content-ok');
        if (btn) {
          btn.click();
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new Event('tap', { bubbles: true }));
        }
      });
      log.info('Clicked 进入考试 via JS');
    }
    await sleep(3000);
  } else if (popupState.exists && popupState.okBtnText === '确定') {
    // 有些考试弹窗只有"确定"按钮
    const okBtn = page.locator('#confirmPop .msg-content-ok');
    if (await okBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await okBtn.tap();
      log.info('Clicked 确定 via tap');
    }
    await sleep(3000);
  } else {
    // 弹窗没有出现 - 可能已经直接跳转或触发了其他行为
    log.info('No confirmation popup found, checking if exam started directly');
  }

  // ── 第五步: 等待页面跳转并提取参数 ──
  await sleep(2000);

  // 检查当前 URL
  const currentUrl = page.url();
  log.info(`URL after start: ${currentUrl}`);

  // 提取 enc 等参数
  const examParams = await page.evaluate(() => {
    try {
      const form = document.querySelector('form#submitTest');
      if (!form) return { error: 'no_submit_form' };

      const enc = form.querySelector('#enc');
      const encRemainTime = form.querySelector('#encRemainTime');
      const encLastUpdateTime = form.querySelector('#encLastUpdateTime');
      const testUserRelationId = form.querySelector('#testUserRelationId');
      const examWaterMark = form.querySelector('#ExamWaterMark');

      // 获取题目数量
      const qNodes = document.querySelectorAll('.questionWrap.singleQuesId.ans-cc-exam');
      const questionCount = qNodes.length;
      const sampleHtml = qNodes[0] ? qNodes[0].innerHTML.substring(0, 300) : '';

      return {
        enc: enc ? enc.value : '',
        encRemainTime: encRemainTime ? parseInt(encRemainTime.value) : 0,
        encLastUpdateTime: encLastUpdateTime ? parseInt(encLastUpdateTime.value) : 0,
        testUserRelationId: testUserRelationId ? parseInt(testUserRelationId.value) : 0,
        examWaterMark: examWaterMark ? examWaterMark.value : '',
        questionCount,
        sampleHtml,
      };
    } catch(e) { return { error: e.message }; }
  });
  log.info(`Exam params: ${JSON.stringify(examParams).substring(0, 300)}`);

  // 判断是否成功进入考试
  const hasEnc = examParams.enc && examParams.enc.length > 0;
  const hasQuestions = (examParams.questionCount || 0) > 0 || !!examParams.sampleHtml;

  if (hasEnc || hasQuestions) {
    log.info(`✅ Exam entered! questions=${examParams.questionCount || '?'} enc=${(examParams.enc || '').substring(0,16)}...`);
    return {
      success: true,
      stage: 'entered',
      enc: examParams.enc,
      encRemainTime: examParams.encRemainTime || 0,
      encLastUpdateTime: examParams.encLastUpdateTime || 0,
      testUserRelationId: examParams.testUserRelationId || 0,
      title: examParams.examWaterMark || (pageText.match(/考试名称\s*([^\n]+)/)||[])[1] || '',
      questionCount: examParams.questionCount || 0,
      currentUrl,
    };
  }

  // 如果 URL 已改变但未检测到 enc，可能是直接跳转到 start 页面
  // 尝试直接调用 fetch API
  log.info('No enc found on page, trying to extract from redirect...');
  const urlParams = new URL(page.url()).searchParams;
  const encFromUrl = urlParams.get('enc');
  if (encFromUrl) {
    log.info(`Found enc in URL: ${encFromUrl.substring(0,16)}...`);
    return {
      success: true,
      stage: 'entered',
      enc: encFromUrl,
      encRemainTime: 0,
      encLastUpdateTime: 0,
      testUserRelationId: parseInt(urlParams.get('examAnswerId') || urlParams.get('id') || '0'),
      currentUrl,
    };
  }

  // 还不行 — 截图调试
  try { await page.screenshot({ path: '/tmp/exam_fail_enter.png' }); } catch(e) {}
  return { success: false, stage: 'enter_failed', reason: `no_enc_after_nav url=${currentUrl.substring(0,100)}` };
}

// ── 主函数 ──
async function run() {
  log.info('=== Exam Headless — Start Flow Only ===');

  const params = parseInput();
  log.info(`Params: exam=${params.exam_id} course=${params.course_id} class=${params.class_id} cpi=${params.cpi}`);

  // 获取账号密码（从环境变量）
  const username = process.env.CX_USERNAME || '';
  const password = process.env.CX_PASSWORD || '';
  if (!username) log.warn('No CX_USERNAME set, will try cookie-only');

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--disable-web-security',               // 允许跨域 cookie
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  // ★ 关键: hasTouch=true 让 Playwright 支持 touch 事件
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },     // 手机尺寸（考试页面是移动版）
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.135 Mobile Safari/537.36',
    locale: 'zh-CN',
    hasTouch: true,                              // ★ 启用 Touch Events API
    deviceScaleFactor: 2.625,
    isMobile: true,
  });

  const page = await context.newPage();

  // ★ isTrusted 劫持 — 让所有 Events.isTrusted 返回 true
  await page.addInitScript(() => {
    Object.defineProperty(Event.prototype, 'isTrusted', { get: () => true });
    // 覆盖 navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // 模拟真实 plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ]
    });
    // 修改 chrome.runtime 避免被检测
    try {
      if (window.chrome) {
        window.chrome.runtime = window.chrome.runtime || {};
        window.chrome.runtime.connect = () => ({ onMessage: { addListener: () => {} }, postMessage: () => {} });
      }
    } catch(e) {}
  });

  // 加载已有的 session cookies（由 Python init_session() 生成）
  await loadCookies(context);

  let result;
  try {
    result = await enterExam(page, params);
  } catch (e) {
    log.error('Fatal error:', e.message);
    result = { success: false, stage: 'error', reason: e.message };
  }

  // 保存 cookies 供下次使用
  await saveCookies(context);
  await browser.close();
  log.info(`Result: ${JSON.stringify(result)}`);

  // 输出 JSON
  log.json(result);
}

// ── 启动 ──
run().catch(e => {
  process.stderr.write(`[FATAL] ${e.stack || e.message}\n`);
  process.stdout.write(JSON.stringify({ success: false, stage: 'fatal', reason: e.message }) + '\n');
  process.stdout.end();
  process.exit(1);
});
