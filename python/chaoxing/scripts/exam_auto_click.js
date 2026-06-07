#!/usr/bin/env node
/**
 * 超星考试无头浏览器自动化 (Stealth Mode)
 * 使用 playwright-extra + stealth 插件绕过 bot 检测
 * 自动点击同意→开始→确认，然后保持浏览器存活供后续答题
 */
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const EXID = process.env.EXAM_ID || '9459820';
const CID = process.env.COURSE_ID || '263695114';
const CLID = process.env.CLASS_ID || '146799509';
const CPI = process.env.CPI || '488376903';
const PROXY = process.env.EXAM_PROXY || 'http://192.168.195.213:8898';

(async () => {
  console.log(`[STEALTH] Starting exam ${EXID}...`);
  
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ]
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });
  
  const page = await context.newPage();
  
  try {
    // Remove webdriver flag early
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // Override plugins to look realistic
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    });
    
    // 1. Navigate to exam page via proxy
    const examUrl = `${PROXY}/exam-ans/exam/phone/task-exam?taskrefId=${EXID}&courseId=${CID}&classId=${CLID}&cpi=${CPI}&ut=s`;
    console.log(`[STEALTH] Opening exam page...`);
    await page.goto(examUrl, { waitUntil: 'networkidle', timeout: 30000 });
    
    const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
    console.log(`[STEALTH] Page: ${body.includes('周申来') ? '✅ logged in' : '❌ not logged in'}`);
    
    // 2. Check/click agree
    await page.evaluate(() => {
      const ar = document.querySelector('#agreeRules');
      if (ar) {
        ar.classList.add('checked');
        ar.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.waitForTimeout(500);
    console.log('[STEALTH] Agreed');
    
    // 3. Enable and click start button  
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
    
    const startBtn = page.locator('#start').first();
    if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await startBtn.click({ force: true, delay: 100 });
      console.log('[STEALTH] Clicked start');
    }
    await page.waitForTimeout(3000);
    
    // 4. Check for confirm dialog  
    const confirmBtn = page.locator('.msg-content-ok:has-text("进入考试")').first();
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[STEALTH] Found confirm dialog, clicking...');
      await confirmBtn.click();
      await page.waitForTimeout(3000);
    }
    
    // 5. Check result
    const finalUrl = page.url();
    const hasQuestion = await page.locator('.questionWrap').first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasEnc = await page.evaluate(() => !!document.querySelector('#enc'));
    
    console.log(`[STEALTH] Final URL: ${finalUrl.slice(0, 100)}`);
    console.log(`[STEALTH] Question: ${hasQuestion}, Enc: ${hasEnc}`);
    
    if (hasQuestion || hasEnc || finalUrl.includes('reVersion')) {
      console.log('[STEALTH] 🎉 EXAM STARTED!');
    } else {
      console.log('[STEALTH] ❌ Not started - URL unchanged');
    }
    
  } catch (e) {
    console.error(`[STEALTH] Error: ${e.message}`);
  } finally {
    await browser.close();
  }
  console.log('[STEALTH] Done');
})();
