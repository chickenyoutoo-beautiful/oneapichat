#!/usr/bin/env python3
"""
OneAPIChat exam_browser.py — v3 修复版
修复:
  1. 更好的验证码检测和处理
  2. 使用 add_init_script 在页面加载前修改安全检测参数
  3. 通过拦截响应绕过 captchaCheck
  4. 更完善的错误报告
"""
import os, sys, json, time, logging, re, socket
from urllib.parse import urlencode

logger = logging.getLogger('ExamBrowser')


class BrowserExam:
    def __init__(self, account, tiku=None, session=None):
        self.account = account
        self.tiku = tiku
        self.session = session

    def enter_exam(self, exam_id, course_id, class_id, cpi, enc_task=''):
        logger.info("尝试 headless Chromium（直接访问超星）...")
        result = self._enter_headless(exam_id, course_id, class_id, cpi, enc_task)
        if result.get('success'):
            return result
        reason = result.get('reason', '') or result.get('stage', '')
        if '安全验证' in reason or 'captcha' in reason.lower():
            logger.info("考试需要安全验证，尝试 CDP 连接真实 Chrome...")
            cdp_result = self._enter_cdp(exam_id, course_id, class_id, cpi, enc_task)
            if cdp_result.get('success'):
                return cdp_result
            result['hint'] = '该考试需要完成拼图验证码，请在真实浏览器中手动验证后重试'
            result['captcha_required'] = True
        return result

    def _inject_bypass_script(self, page):
        """注入反检测和验证码绕过脚本 (CxKitty 风格)"""
        page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(Event.prototype, 'isTrusted', { get: () => true });
            Object.defineProperty(navigator, 'plugins', { get: () => [
                {name:'Chrome PDF Plugin'},{name:'Chrome PDF Viewer'},{name:'Native Client'}
            ]});
            Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
            window.chrome = { runtime: {} };

            // CxKitty 风格: 覆写 showCXCaptcha
            window.showCXCaptcha = function(callBack) {
                if (callBack && typeof callBack === 'function') {
                    callBack('bypass_captcha', Date.now(), '', '', '', '', '');
                }
            };
            window.CXJSBridge = { postNotification: function(){} };

            // MutationObserver: 修改 input value
            var _observer = new MutationObserver(function(muts) {
                muts.forEach(function(m) {
                    m.addedNodes.forEach(function(n) {
                        if (n.nodeType === 1 && n.tagName === 'INPUT') {
                            if (n.id === 'captchaCheck' || n.name === 'captchaCheck') {
                                n.value = '0'; try { n.setAttribute('value', '0'); } catch(e) {}
                            }
                            if (n.id === 'appExamClientSign') {
                                n.value = 'false'; try { n.setAttribute('value', 'false'); } catch(e) {}
                            }
                        }
                    });
                });
            });
            _observer.observe(document.documentElement, {childList: true, subtree: true});
        """)

    def _setup_cxkitty_route(self, page):
        """
        CxKitty 风格: 用 page.route 拦截并修改 HTTP 响应
        在浏览器层面修改安全验证参数和 JS
        """
        # 注入脚本
        cx_bypass = (
            "<script>"
            "(function(){"
            "window.showCXCaptcha=function(cb){if(typeof cb==='function')cb('bypass',Date.now(),'','','','','');};"
            "window.CXJSBridge={postNotification:function(){}};"
            "var cc=document.getElementById('captchaCheck');"
            "if(cc){cc.value='0';cc.setAttribute('value','0');}"
            "var acs=document.getElementById('appExamClientSign');"
            "if(acs){acs.value='false';acs.setAttribute('value','false');}"
            "})();"
            "</script>"
        ).encode('utf-8')

        def _route_handler(route):
            url = route.request.url

            # 拦截 captcha/工具 JS
            if 'CXJSBridge' in url or 'app.utils2' in url or 'pushCommon' in url:
                try:
                    resp = route.fetch()
                    body = resp.body()
                    body = body.replace(b'showCXCaptcha', b'showCXCaptcha_disabled')
                    body = body.replace(b'CXJSBridge', b'CXJSBridge_disabled')
                    route.fulfill(body=body, content_type='application/javascript; charset=utf-8')
                    return
                except Exception:
                    route.continue_()
                    return

            # 拦截考试页面 HTML
            if '/exam-ans/' in url:
                try:
                    resp = route.fetch()
                    body = resp.body()
                    ct = resp.headers.get('content-type', '')
                    if 'text/html' in ct:
                        # 修改安全参数
                        body = body.replace(b'captchaCheck" value="1"', b'captchaCheck" value="0"')
                        body = body.replace(b'captchaCheck"  value="1"', b'captchaCheck" value="0"')
                        body = body.replace(b'appExamClientSign" value="true"', b'appExamClientSign" value="false"')
                        body = body.replace(b'appExamClientSign"  value="true"', b'appExamClientSign" value="false"')
                        body = body.replace(b'chaoXingAppSignVersion" value="311"', b'chaoXingAppSignVersion" value="0"')
                        body = body.replace(b'var needcode = 1;', b'var needcode = 0;')
                        # 注入 bypass
                        head_tag = b'</head>'
                        if head_tag in body:
                            body = body.replace(head_tag, cx_bypass + head_tag, 1)
                        route.fulfill(body=body, content_type='text/html; charset=utf-8')
                        return
                except Exception:
                    route.continue_()
                    return

            route.continue_()

        page.route('**/exam-ans/**', _route_handler)
        page.route('**/js/phone/**', _route_handler)

    def _enter_headless(self, exam_id, course_id, class_id, cpi, enc_task):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return {"success": False, "stage": "playwright_missing"}

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(
                    headless=True,
                    args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox',
                          '--disable-blink-features=AutomationControlled',
                          '--disable-gpu'],
                )
                context = browser.new_context(
                    viewport={"width": 430, "height": 932},
                    user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.6778.135 Mobile Safari/537.36",
                    locale='zh-CN', has_touch=True, is_mobile=True, device_scale_factor=2.625,
                )
                page = context.new_page()
                page.set_default_timeout(30000)

                # 注入 bypass 脚本 + CxKitty route 拦截
                self._inject_bypass_script(page)
                self._setup_cxkitty_route(page)

                self._load_cookies(context)

                # 1. 先访问 i.chaoxing.com 建立 session
                page.goto('https://i.chaoxing.com', wait_until='domcontentloaded', timeout=15000)
                page.wait_for_timeout(500)

                # 2. 访问考试页
                url = (f"https://mooc1-api.chaoxing.com/exam-ans/exam/phone/task-exam"
                       f"?taskrefId={exam_id}&courseId={course_id}&classId={class_id}&cpi={cpi}&ut=s"
                       f"&enc_task={enc_task}")
                logger.info(f"导航到考试页: {url[:80]}...")
                page.goto(url, wait_until='domcontentloaded', timeout=30000)
                page.wait_for_timeout(2000)

                result = self._run_entry_flow(page, exam_id)

                try:
                    screenshot_path = f'/tmp/exam_{exam_id}_headless.png'
                    page.screenshot(path=screenshot_path)
                except Exception:
                    pass

                browser.close()
                return result
        except Exception as e:
            logger.warning(f"浏览器启动失败: {e}")
            return {"success": False, "stage": "browser_launch", "reason": str(e)}

    def _enter_cdp(self, exam_id, course_id, class_id, cpi, enc_task):
        """连接真实 Chrome (CDP)，由用户手动处理验证码"""
        cdp_ports = [9222, 18800, 9229]
        cdp_ws_url = None

        for port in cdp_ports:
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(0.5)
                if s.connect_ex(('127.0.0.1', port)) == 0:
                    import urllib.request, json as _json
                    resp = urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=2)
                    data = _json.loads(resp.read())
                    if 'webSocketDebuggerUrl' in data:
                        cdp_ws_url = data['webSocketDebuggerUrl']
                        logger.info(f"CDP 可用: port={port}")
                        break
                s.close()
            except Exception:
                continue

        if not cdp_ws_url:
            return {"success": False, "stage": "cdp_unavailable",
                    "reason": "无可用 CDP 端点，请用 --remote-debugging-port=9222 启动 Chrome"}

        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.connect_over_cdp(cdp_ws_url)
                ctx = browser.contexts[0] if browser.contexts else browser.new_context()
                page = ctx.new_page() if browser.contexts else browser.new_page()
                page.set_default_timeout(60000)

                self._inject_bypass_script(page)
                self._setup_cxkitty_route(page)

                url = (f"https://mooc1-api.chaoxing.com/exam-ans/exam/phone/task-exam"
                       f"?taskrefId={exam_id}&courseId={course_id}&classId={class_id}&cpi={cpi}&ut=s"
                       f"&enc_task={enc_task}")
                logger.info("CDP: 导航到考试页面...")
                page.goto(url, wait_until='domcontentloaded', timeout=30000)
                page.wait_for_timeout(3000)

                result = self._run_entry_flow(page, exam_id)
                try:
                    page.close()
                except Exception:
                    pass
                return result
        except Exception as e:
            logger.debug(f"CDP 失败: {e}")
            return {"success": False, "stage": "cdp_error", "reason": str(e)}

    def _run_entry_flow(self, page, exam_id):
        try:
            text = page.evaluate("() => document.body.innerText.slice(0, 500)")
        except Exception:
            return {"success": False, "stage": "page_error", "reason": "无法读取页面"}
        logger.info(f"页面内容: {text[:200]}...")

        if '已完成' in text or '已交卷' in text:
            return {"success": True, "stage": "already_completed"}
        if '安全验证' in text:
            return {"success": False, "stage": "enter_failed", "reason": "安全验证不通过",
                    "captcha_required": True}
        if '登录' in text and '密码' in text:
            logger.warning("页面包含登录表单，cookie 可能已过期")
            return {"success": False, "stage": "login_required", "reason": "需要重新登录"}

        # 强制修改 captchaCheck 为 0
        page.evaluate("""
            () => {
                var cc = document.getElementById('captchaCheck');
                if (cc) { cc.value = '0'; cc.setAttribute('value', '0'); }
                var acs = document.getElementById('appExamClientSign');
                if (acs) { acs.value = 'false'; acs.setAttribute('value', 'false'); }
            }
        """)

        # 勾选同意
        try:
            page.evaluate("""
                () => {
                    const ar = document.querySelector('#agreeRules');
                    if (ar) { ar.classList.add('checked'); ar.dispatchEvent(new Event('change', {bubbles:true})); }
                }
            """)
        except Exception:
            pass
        page.wait_for_timeout(500)

        # 检查是否有 enter 函数
        try:
            has_enter = page.evaluate("() => typeof enter === 'function'")
        except Exception:
            has_enter = False

        if has_enter:
            # 直接调用 enter()
            logger.info("调用 enter() 开始考试...")
            page.evaluate("""
                () => {
                    setTimeout(function() {
                        if (typeof enter === 'function') {
                            try { enter(); } catch(e) { console.error('enter error:', e); }
                        }
                    }, 300);
                }
            """)
            page.wait_for_timeout(5000)
        else:
            # 尝试点击开始按钮
            try:
                btn = page.locator('#start')
                if btn.count() > 0:
                    logger.info("点击开始按钮...")
                    page.evaluate("""
                        () => {
                            var b = document.querySelector('#start');
                            if(b) {
                                b.removeAttribute('tabindex');
                                b.style.pointerEvents = 'auto';
                                b.disabled = false;
                                b.click();
                            }
                        }
                    """)
                    page.wait_for_timeout(3000)
                else:
                    page.wait_for_timeout(2000)
            except Exception:
                page.wait_for_timeout(2000)

        # 再次检查 enter 是否可用（可能被点击事件触发）
        try:
            if not has_enter:
                has_enter = page.evaluate("() => typeof enter === 'function'")
                if has_enter:
                    page.evaluate("setTimeout(function() { enter(); }, 300)")
                    page.wait_for_timeout(5000)
        except Exception:
            pass

        # 提取 enc
        enc = ''
        enc_remain = 0
        test_user_id = ''
        page_title = ''
        try:
            enc = page.evaluate("() => window.enc || document.getElementById('enc')?.value || ''")
            enc_remain = page.evaluate("() => parseInt(document.getElementById('encRemainTime')?.value || '0')")
            test_user_id = page.evaluate("() => document.getElementById('testUserRelationId')?.value || ''")
            page_title = page.evaluate("() => document.querySelector('span.overHidden2')?.textContent || document.title || ''")
        except Exception:
            pass

        success = bool(enc)
        logger.info(f"enc: {'找到' if success else '未找到'}, remain: {enc_remain}, uid: {test_user_id}")

        # 检查是否有安全验证失败信息
        if not success:
            try:
                body_text = page.evaluate("() => document.body.innerText")
                if '安全验证' in body_text:
                    return {"success": False, "stage": "enc_not_found",
                            "reason": "安全验证不通过", "captcha_required": True}
            except Exception:
                pass

        return {
            "success": success,
            "stage": "entered" if success else "enc_not_found",
            "enc": enc,
            "encRemainTime": enc_remain,
            "testUserRelationId": test_user_id,
            "title": page_title,
        }

    def run(self, course_id, class_id, exam_id, cpi, enc_task='', auto_submit=True):
        logger.info(f"开始考试: {exam_id}")
        enter_result = self.enter_exam(exam_id, course_id, class_id, cpi, enc_task)

        if not enter_result.get('success'):
            stage = enter_result.get('stage', '')
            reason = enter_result.get('reason', '')
            captcha = enter_result.get('captcha_required', False)
            hint = enter_result.get('hint', '')
            logger.warning(f"进入考试失败: {stage} - {reason}")
            return {
                "exam_id": exam_id,
                "total": 0,
                "answered": 0,
                "submitted": False,
                "error": f"{'[需验证码] ' if captcha else ''}{reason or stage}",
                "captcha_required": captcha,
                "hint": hint,
            }

        # 浏览器已完成 captcha 并拿到 enc，现在用 API 模式答题
        from api.exam_auto import ChaoxingExam
        api_exam = ChaoxingExam(self.account, tiku=self.tiku)
        api_exam.exam_id = exam_id
        api_exam.course_id = course_id
        api_exam.class_id = class_id
        api_exam.cpi = cpi
        api_exam.enc_task = enter_result.get('enc_task', enc_task)
        api_exam.exam_answer_id = enter_result.get('testUserRelationId', '')
        api_exam.enc = enter_result.get('enc', '')
        api_exam.enc_remain_time = enter_result.get('encRemainTime', 0)
        api_exam.last_update_time = enter_result.get('encLastUpdateTime', 0)

        summary = {"exam_id": exam_id, "total": 0, "answered": 0, "submitted": False, "title": enter_result.get('title', '')}
        try:
            questions = api_exam.fetch_all()
        except Exception:
            questions = []
        if not questions:
            try:
                first_q = api_exam.fetch(0)
                questions = [first_q]
                while True:
                    idx = len(questions)
                    q = api_exam.fetch(idx)
                    questions.append(q)
            except Exception:
                pass

        summary['total'] = len(questions)
        for idx, q in enumerate(questions):
            answer = api_exam.search_answer(q)
            if answer:
                q.answer = answer
                logger.info(f"第{idx+1}题 答案: {str(answer)[:40]}")
            if auto_submit:
                try:
                    api_exam.submit(idx, q)
                    summary['answered'] += 1
                except Exception as se:
                    logger.warning(f"第{idx+1}题提交失败: {se}")

        if auto_submit and summary['answered'] > 0 and questions:
            try:
                api_exam.submit(0, questions[0], final=True)
                summary['submitted'] = True
                logger.info("✅ 已交卷")
            except Exception as fe:
                logger.warning(f"交卷失败: {fe}")

        logger.info(f"📊 {summary['answered']}/{summary['total']}")
        return summary

    def _load_cookies(self, context):
        if not self.session:
            return
        try:
            cookies_list = []
            for cookie in self.session.cookies:
                domain = cookie.domain or '.chaoxing.com'
                if not domain.startswith('.'):
                    domain = '.' + domain
                cookies_list.append({
                    'name': cookie.name, 'value': cookie.value,
                    'domain': domain, 'path': cookie.path or '/',
                    'httpOnly': False, 'secure': cookie.secure or False, 'sameSite': 'Lax',
                })
            base = {c['name']: c['value'] for c in cookies_list if c['domain'] == '.chaoxing.com'}
            for sub in ['mooc1-api.chaoxing.com', 'mooc1.chaoxing.com', 'passport2.chaoxing.com']:
                if not any(c['domain'] == sub for c in cookies_list):
                    for name, val in base.items():
                        cookies_list.append({'name': name, 'value': val, 'domain': sub,
                            'path': '/', 'httpOnly': False, 'secure': False, 'sameSite': 'Lax'})
            context.add_cookies(cookies_list)
            logger.info(f"已加载 {len(cookies_list)} cookies")
        except Exception as e:
            logger.warning(f"加载 cookies 失败: {e}")

