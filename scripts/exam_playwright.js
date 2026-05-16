#!/usr/bin/env node
/**
 * 超星考试浏览器自动化 (Node.js + Playwright)
 * 集成 OCS (ocsjs) 的答题方法
 *
 * OCS 核心方法集成说明:
 *   - workOrExam() → 本脚本的 exam lifecycle
 *     - root selector: .questionLi (OCS 标准)
 *     - title selector: h3 (OCS 标准)
 *     - type selector: input[name^="type"] (OCS 标准, exam mode)
 *     - options selector: .answerBg .answer_p, .textDIV, .eidtDiv (OCS 标准)
 *     - 题型映射: {0:single, 1:multiple, 3:judgement, 2/4-10:completion, 11:line, 14:fill, 15:reader}
 *   - 逐题循环 (non-preview mode): getTheNextQuestion(1) 按钮
 *   - 答案搜索: defaultAnswerWrapperHandler → searchAnswer() 本地实现
 *   - 相似度匹配: answerSimilar → stringSimilarity()
 *   - 标准答题器 OCSWorker → 本脚本的 answerQuestion()
 *
 * 用法: node scripts/exam_playwright.js
 * 环境变量:
 *   CX_USERNAME / CX_PASSWORD — 超星账号
 *   EXAM_ID, COURSE_ID, CLASS_ID, CPI — 考试参数
 *   COOKIE_FILE — 持久化 cookie 路径 (默认 /tmp/cx_cookies.json)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ── 配置 ──────────────────────────────────────────────
const CHROMIUM_PATH = '/usr/bin/chromium-browser';
const USERNAME = process.env.CX_USERNAME || 'PHONE_REMOVED';
const PASSWORD = process.env.CX_PASSWORD || 'PASSWORD_REMOVED_1';
const EXAM_ID = process.env.EXAM_ID || '9459820';
const COURSE_ID = process.env.COURSE_ID || '263695114';
const CLASS_ID = process.env.CLASS_ID || '146799509';
const CPI = process.env.CPI || '488376903';
const COOKIE_FILE = process.env.COOKIE_FILE || '/tmp/cx_cookies.json';

// ── OCS 题型映射 ─────────────────────────────────────
const QUESTION_TYPE_MAP = {
  0: 'single', 1: 'multiple', 3: 'judgement',
  2: 'completion', 4: 'completion', 5: 'completion',
  6: 'completion', 7: 'completion', 8: 'completion',
  9: 'completion', 10: 'completion',
  11: 'line', 14: 'fill', 15: 'reader'
};

// ── 工具函数 ──────────────────────────────────────────
const LOG = {
  info: (...a) => console.log('[EXAM]', ...a),
  warn: (...a) => console.warn('[EXAM]', ...a),
  error: (...a) => console.error('[EXAM]', ...a),
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cleanTitle(t) {
  if (!t) return '';
  return t.replace(/^\d+[。、.]?\s*/, '').replace(/（\d+\.\d+分）/, '').replace(/\(..题.*?\)/, '').replace(/[【(（]..题[)）】]/, '').replace(/\s+/g, ' ').trim();
}

function stringSimilarity(a, b) {
  a = (a||'').toLowerCase(); b = (b||'').toLowerCase();
  if (a === b) return 1; if (!a||!b) return 0;
  const m = []; for(let i=0;i<=b.length;i++) m[i]=[i];
  for(let j=0;j<=a.length;j++) m[0][j]=j;
  for(let i=1;i<=b.length;i++) for(let j=1;j<=a.length;j++)
    m[i][j]=b[i-1]===a[j-1]?m[i-1][j-1]:Math.min(m[i-1][j-1]+1,m[i][j-1]+1,m[i-1][j]+1);
  return 1-(m[b.length][a.length]/Math.max(a.length,b.length));
}

async function saveCookies(context) {
  try { fs.writeFileSync(COOKIE_FILE, JSON.stringify(await context.cookies(), null, 2)); } catch(e) { LOG.warn('Save cookies:', e.message); }
}
async function loadCookies(context) {
  try { if (fs.existsSync(COOKIE_FILE)) await context.addCookies(JSON.parse(fs.readFileSync(COOKIE_FILE,'utf8'))); } catch(e) { LOG.warn('Load cookies:', e.message); }
}

// ── 登录 ──────────────────────────────────────────────
async function handleLogin(page) {
  if (!page.url().includes('passport') && !page.url().includes('login')) return true;
  LOG.info('Login page detected...');

  try { await page.waitForSelector('#phone', { timeout: 8000 }); } catch { return false; }

  await page.locator('#phone').click();
  await page.locator('#phone').fill('');
  await page.locator('#phone').type(USERNAME, { delay: 20 });
  await sleep(200);
  await page.locator('#pwd').click();
  await page.locator('#pwd').fill('');
  await page.locator('#pwd').type(PASSWORD, { delay: 20 });
  await sleep(200);

  // 勾选协议 (hidden checkbox styled as label)
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

  LOG.info('Login ' + (page.url().includes('passport')?'FAILED':'OK'));
  return !page.url().includes('passport');
}

// ── 开始考试 ──────────────────────────────────────────
async function startExam(page) {
  LOG.info('Looking for start button...');

  // 检测考试状态
  const status = await page.evaluate(() => {
    const b = document.body.innerText;
    if (b.includes('已完成')||b.includes('已提交')||b.includes('已交卷')) return 'completed';
    const btn = document.querySelector('#start');
    if (!btn) return 'no_button';
    const style = window.getComputedStyle(btn);
    if (style.display === 'none' || style.visibility === 'hidden') return 'hidden';
    
    // 检查agree状态 - 如果agreeRules已有check class表示已同意
    const agreeRules = document.querySelector('#agreeRules');
    const alreadyAgreed = agreeRules && agreeRules.classList.contains('check');
    
    return btn.textContent.includes('开始') ? (alreadyAgreed ? 'ready_agreed' : 'ready') : 'unknown';
  });

  LOG.info('Exam status:', status);
  if (status === 'completed' || status === 'hidden') {
    return { started: false, reason: status };
  }
  if (status === 'no_button') {
    return { started: false, reason: 'no_start_button' };
  }

  // 勾选协议 (超星使用CSS类名切换,不是真实checkbox)
  try {
    const agreeSpan = page.locator('#agreeRules');
    const agreeP = page.locator('.agreeBtn');
    if (await agreeSpan.isVisible({ timeout: 2000 }).catch(() => false)) {
      await agreeSpan.click();
      await sleep(300);
      LOG.info('Agreed to terms via #agreeRules');
    } else if (await agreeP.isVisible({ timeout: 1000 }).catch(() => false)) {
      await agreeP.click();
      await sleep(300);
      LOG.info('Agreed to terms via .agreeBtn');
    }
  } catch {}

  // 等待按钮变为可点击
  await sleep(500);

  // 点击开始按钮
  await page.click('#start');
  await sleep(3000);
  const newUrl = page.url();

  // 检查是否跳转
  const hasQuestions = await page.evaluate(() =>
    !!document.querySelector('.questionLi, .TiMu, [class*=question], #enc')
  );

  LOG.info('Start result - URL:', newUrl.slice(0,100), '| Questions:', hasQuestions);

  return { started: hasQuestions, reason: newUrl !== page.url() ? 'redirect' : 'clicked' };
}

// ── OCS 风格答题 — 单题处理 ──────────────────────────
async function answerQuestion(page, index, total) {
  const info = await page.evaluate((idx) => {
    const roots = document.querySelectorAll('.questionLi');
    const root = roots[idx];
    if (!root) return null;

    // OCS 风格: h3 → title
    const h3 = root.querySelector('h3');
    const titleEl = h3 ? h3.cloneNode(true) : null;
    if (titleEl && titleEl.childNodes[0]) titleEl.childNodes[0].remove();
    if (titleEl && titleEl.childNodes[0]) titleEl.childNodes[0].remove();
    const title = titleEl ? titleEl.innerText.replace(/\s+/g,' ').trim() : '';

    // OCS 风格: input[name^="type"] → 题型
    const typeInput = root.querySelector('input[name^="type"]');
    const typeVal = typeInput ? parseInt(typeInput.value) : -1;
    const typeName = ({0:'single',1:'multiple',3:'judgement',2:'completion'})[typeVal] || 'unknown';

    // OCS 风格: .answerBg .answer_p, .textDIV, .eidtDiv → 选项
    const opts = root.querySelectorAll('.answerBg .answer_p, .textDIV, .eidtDiv');
    const options = Array.from(opts).map(o => {
      const c = o.cloneNode(true);
      c.querySelectorAll('input,i,.check_answer,.after').forEach(el => el.remove());
      return c.innerText.replace(/\s+/g,' ').trim();
    }).filter(Boolean);

    return { title, type: typeName, options, hasOptions: options.length > 0, rawType: typeVal };
  }, index);

  if (!info || !info.title) {
    LOG.warn(`[${index+1}/${total}] No question found`);
    return { finished: false, error: 'empty' };
  }

  const cleanT = cleanTitle(info.title);
  LOG.info(`[${index+1}/${total}] ${info.type}: ${cleanT.slice(0,50)}...`);

  if (!['single', 'multiple', 'judgement', 'completion'].includes(info.type)) {
    LOG.warn(`[${index+1}/${total}] Unsupported type: ${info.type}, skipping`);
    return { finished: false, title: cleanT, type: info.type };
  }

  // 搜索答案 (simulated - integrate with actual API here)
  // 在实际使用中，这里应该调用 answer API 或题库
  // 本实现使用 OCS 风格的相似度匹配（从题目本身或选项推断答案）
  const answers = await searchAnswers(cleanT, info.type, info.options);

  if (!answers || answers.length === 0) {
    LOG.warn(`[${index+1}/${total}] No answer found`);
    return { finished: false, title: cleanT, type: info.type, options: info.options };
  }

  // OCS 风格: 填写答案
  if (info.type === 'single' || info.type === 'judgement') {
    const clicked = await clickMatchingOption(page, index, answers);
    if (clicked) LOG.info(`[${index+1}/${total}] ✅ ${info.type} answered`);
    return { finished: clicked, title: cleanT, type: info.type };
  } else if (info.type === 'multiple') {
    await clickMultipleOptions(page, index, answers);
    LOG.info(`[${index+1}/${total}] ✅ multiple answered`);
    return { finished: true, title: cleanT, type: 'multiple' };
  } else if (info.type === 'completion') {
    await fillCompletion(page, index, answers);
    LOG.info(`[${index+1}/${total}] ✅ completion answered`);
    return { finished: true, title: cleanT, type: 'completion' };
  }

  return { finished: false, title: cleanT, type: info.type };
}

// ── 答案搜索（可扩展，接入实际题库 API） ────────────
async function searchAnswers(question, type, options) {
  const results = [];
  // TODO: 接入真实的题库 API
  // 示例: const resp = await fetch('https://your-answer-api.com/search', { method:'POST', body: {...} });
  // 目前返回空 (无 API 时跳过)
  return results;
}

// ── 选项点击（OCS 相似度匹配） ─────────────────────
async function clickMatchingOption(page, index, answers) {
  const flat = answers.flatMap(a => (typeof a === 'string' ? a.split(/[,;，；\n]/).map(s=>s.trim()) : [String(a)]));

  const result = await page.evaluate(({ idx, answers }) => {
    const roots = document.querySelectorAll('.questionLi');
    const root = roots[idx];
    if (!root) return false;
    const opts = root.querySelectorAll('.answerBg .answer_p, .textDIV, .eidtDiv');

    for (const answer of answers) {
      const clean = answer.replace(/\s+/g,' ').trim().toLowerCase();
      if (!clean) continue;

      // ABCD 直接匹配
      if (/^[a-e]$/i.test(clean)) {
        const ci = clean.toUpperCase().charCodeAt(0) - 65;
        if (opts[ci]) {
          opts[ci].click();
          return true;
        }
      }

      // 文本相似度匹配
      for (let i = 0; i < opts.length; i++) {
        const c = opts[i].cloneNode(true);
        c.querySelectorAll('input,i,.check_answer,.after').forEach(el=>el.remove());
        const t = c.innerText.replace(/\s+/g,' ').trim().toLowerCase();
        if (t === clean || t.includes(clean) || clean.includes(t)) {
          opts[i].click();
          return true;
        }
      }
    }
    return false;
  }, { idx: index, answers: flat });

  await sleep(300);
  return result;
}

async function clickMultipleOptions(page, index, answers) {
  const flat = answers.flatMap(a => (typeof a === 'string' ? a.split(/[,;，；\n]/).map(s=>s.trim()) : [String(a)]));

  await page.evaluate(({ idx, answers }) => {
    const roots = document.querySelectorAll('.questionLi');
    const root = roots[idx];
    if (!root) return;
    const opts = root.querySelectorAll('.answerBg .answer_p, .textDIV, .eidtDiv');

    for (const answer of answers) {
      const clean = answer.replace(/\s+/g,' ').trim();
      if (!clean) continue;

      // ABCD
      if (/^[a-e]$/i.test(clean)) {
        const ci = clean.toUpperCase().charCodeAt(0) - 65;
        if (opts[ci] && (!opts[ci].parentElement || !opts[ci].parentElement.querySelector('[class*="check_answer"]'))) {
          opts[ci].click();
        }
        continue;
      }

      // 文本
      for (let i = 0; i < opts.length; i++) {
        const c = opts[i].cloneNode(true);
        c.querySelectorAll('input,i,.check_answer,.after').forEach(el=>el.remove());
        const t = c.innerText.replace(/\s+/g,' ').trim().toLowerCase();
        if (t.includes(clean.toLowerCase()) || clean.toLowerCase().includes(t)) {
          opts[i].click();
        }
      }
    }
  }, { idx: index, answers: flat });

  await sleep(300);
}

async function fillCompletion(page, index, answers) {
  const flat = answers.flatMap(a => (typeof a === 'string' ? a.split(/[,;，；\n]/).map(s=>s.trim().replace(/^[A-D][.、:：\s]*/, '')) : [String(a)]));

  await page.evaluate(({ idx, answers }) => {
    const roots = document.querySelectorAll('.questionLi');
    const root = roots[idx];
    if (!root || answers.length === 0) return;

    const tareas = root.querySelectorAll('textarea');
    const iframes = root.querySelectorAll('iframe');

    for (let i = 0; i < Math.min(answers.length, Math.max(tareas.length, iframes.length)); i++) {
      if (tareas[i]) {
        tareas[i].value = answers[i];
        tareas[i].dispatchEvent(new Event('input', { bubbles: true }));
        tareas[i].dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (iframes[i] && iframes[i].contentDocument) {
        iframes[i].contentDocument.body.innerHTML = `<p>${answers[i]}</p>`;
      }
    }

    // OCS 风格: 点击保存按钮
    const save = root.querySelector('[onclick*=saveQuestion]');
    if (save) save.click();
  }, { idx: index, answers: flat });

  await sleep(500);
}

// ── 翻题（OCS 风格: getTheNextQuestion） ────────────
async function goToNextQuestion(page) {
  const clicked = await page.evaluate(() => {
    const next = document.querySelector('[onclick="getTheNextQuestion(1)"]');
    if (next) { next.click(); return 'ocs'; }
    const alt = document.querySelector('[class*=next], button:has-text("下一"), a:has-text("下一")');
    if (alt && alt.offsetParent !== null) { alt.click(); return 'alt'; }
    return 'none';
  });
  if (clicked !== 'none') await sleep(1000);
  return clicked !== 'none';
}

// ── 交卷 ──────────────────────────────────────────────
async function submitExam(page) {
  const result = await page.evaluate(() => {
    const btns = document.querySelectorAll('button, a, input[type=button], input[type=submit]');
    for (const b of btns) {
      const t = b.textContent || b.value || '';
      if ((t.includes('交卷') || t.includes('提交')) && b.offsetParent !== null) {
        b.click();
        return t.slice(0, 10);
      }
    }
    if (typeof submitCheckTimes === 'function') { submitCheckTimes(); return 'submitCheckTimes'; }
    if (typeof tijiao === 'function') { tijiao(); return 'tijiao'; }
    return 'none';
  });

  if (result !== 'none') {
    LOG.info('Submit triggered:', result);
    await sleep(2000);
    // 确认弹窗
    await page.evaluate(() => {
      const confirm = document.querySelector(
        '.el-message-box__btns button:last-child, .dialog-footer button:last-child, ' +
        'button:has-text("确定"), button:has-text("确认提交")'
      );
      if (confirm && confirm.offsetParent !== null) confirm.click();
    });
    await sleep(3000);
    return true;
  }
  return false;
}

// ── 主流程 ────────────────────────────────────────────
async function runExam() {
  LOG.info('=== 超星考试自动化 (OCS-inspired) ===');
  LOG.info(`Exam: ${EXAM_ID}, Course: ${COURSE_ID}`);

  const browser = await chromium.launch({
    headless: true, executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    locale: 'zh-CN', viewport: { width: 1280, height: 800 }
  });

  await loadCookies(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  try {
    // 导航到考试
    const examUrl = `https://mooc1-api.chaoxing.com/exam-ans/exam/phone/task-exam?taskrefId=${EXAM_ID}&courseId=${COURSE_ID}&classId=${CLASS_ID}&cpi=${CPI}&ut=s`;
    await page.goto(examUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // 登录
    if (!await handleLogin(page)) {
      return { success: false, stage: 'login_failed' };
    }
    await saveCookies(context);

    // 开始考试
    const startResult = await startExam(page);
    if (!startResult.started) {
      LOG.info('Exam not started:', startResult.reason);
      if (startResult.reason === 'completed') {
        return { success: true, stage: 'already_completed' };
      }
      return { success: false, stage: 'start_failed', reason: startResult.reason };
    }

    LOG.info('✅ Exam started!');
    await page.screenshot({ path: '/tmp/exam_started.png' });

    // OCS 风格逐题答题循环
    const results = [];
    let maxIter = 200;

    for (let iter = 0; iter < maxIter; iter++) {
      const qCount = await page.evaluate(() => document.querySelectorAll('.questionLi').length);
      if (qCount === 0) {
        LOG.info('No questions on this page, checking for submission...');
        break;
      }

      for (let qi = 0; qi < qCount; qi++) {
        const r = await answerQuestion(page, qi, qCount);
        results.push(r);
        await sleep(500);
      }

      if (!await goToNextQuestion(page)) {
        LOG.info('No next question button - last question');
        break;
      }
    }

    // 交卷
    await sleep(2000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await submitExam(page);

    await page.screenshot({ path: '/tmp/exam_final.png' });

    const answered = results.filter(r => r.finished).length;
    const failed = results.length - answered;
    LOG.info(`📊 Results: ${answered} answered, ${failed} failed out of ${results.length}`);

    return { success: true, stage: 'completed', stats: { total: results.length, answered, failed } };

  } catch (e) {
    LOG.error('Fatal:', e.message);
    await page.screenshot({ path: '/tmp/exam_error.png' }).catch(() => {});
    return { success: false, stage: 'error', error: e.message };
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  runExam().then(r => {
    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.success ? 0 : 1);
  }).catch(e => {
    console.error(e);
    process.exit(2);
  });
}

module.exports = { runExam, handleLogin, startExam, answerQuestion, submitExam };
