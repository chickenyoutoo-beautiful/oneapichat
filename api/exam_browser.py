#!/usr/bin/env python3
"""
超星考试浏览器自动化 — 通过 agent-browser CLI 驱动无头 Chromium
处理 CLIENT_FORM_SIGN 等需要 JS 执行的考试

架构说明：
1. 连接已存在的 Chromium CDP (port 18800)
2. 打开考试开始页面并注入 bypass JS
3. 绕过 captcha 弹窗和 CLIENT_FORM_SIGN 手机端签名
4. 若考试能通过 bypass 成功开始 → 使用 API 获取题目→搜题→自动答题→交卷
5. 若 bypass 失败（captcha/signature 服务器验证未通过）→ 返回错误，提示 OCS 油猴方案

关键 bypass 机制：
- checkClientSignatureSupport → return 1（让 startExamSignature 被调用）
- showCXCaptcha → 直接调 callback（跳过验证码）
- jsBridge.postNotification 拦截 CLIENT_FORM_SIGN → 直接叫回调函数
- startExamSignature / submitExamSignature → 直接调 callback 传假签名
"""
import json, re, time, subprocess, logging, sys, os, random
from datetime import datetime
from urllib.parse import urlparse, parse_qs, urlencode

logger = logging.getLogger('ExamBrowser')
AB = 'agent-browser'

CDP_PORT = 18800

# ── bypass JS ──────────────────────────────────────────────
BYPASS_JS = r"""
(function() {
    console.log('[ExamBypass] Injecting hooks');

    // 1. Force signature check to return 1 so startExamSignature is invoked
    window.checkClientSignatureSupport = function() { return 1; };

    // 2. Bypass captcha popup
    if (typeof showCXCaptcha === 'function') {
        window.showCXCaptcha = function(callBack) {
            var el = document.getElementById('captchavalidate');
            if (el) el.value = 'bypass_' + Date.now();
            if (typeof callBack === 'function') setTimeout(callBack, 50);
        };
    }

    // 3. Hook jsBridge to intercept CLIENT_FORM_SIGN
    if (window.jsBridge && window.jsBridge.postNotification) {
        var _origPost = window.jsBridge.postNotification;
        window.jsBridge.postNotification = function(type, payload) {
            if (type === 'CLIENT_FORM_SIGN' && payload && payload.typeFlag) {
                try {
                    var tf = typeof payload.typeFlag === 'string' ? JSON.parse(payload.typeFlag) : payload.typeFlag;
                    if (tf && tf.funckey && typeof window[tf.funckey] === 'function') {
                        setTimeout(function() {
                            window[tf.funckey]('1', '1', '', '1', '1', '1', '1');
                        }, 100);
                    }
                } catch(e) {}
                return;
            }
            // Block all jsBridge calls that would error without the native app
            var blocked = [
                'CLIENT_FACE_RECOGNITION_BLINK', 'CLIENT_SNAPSHOT', 'CLIENT_FACE_COLLECTION',
                'CLIENT_MONITOR_TOP_VIEW', 'CLIENT_EXAM_LIVE_CONTROL', 'CLIENT_TIMER_SCHEDULE',
                'CLIENT_SCREEN_MONITOR', 'CLIENT_WEB_LIFECYCLE', 'CLIENT_LIMIT_KEYBOARD',
                'CLIENT_EXIT_LEVEL', 'CLIENT_REFRESH_STATUS', 'CLIENT_SCREEN_MONITOR_STATUS',
                'CLIENT_OPEN_URL'
            ];
            if (blocked.indexOf(type) !== -1) return;
            return _origPost.apply(this, arguments);
        };
    }

    // 4. Mock native app APIs
    if (typeof window.AppUtils === 'undefined') {
        window.AppUtils = {
            isChaoXingStudy: function() { return false; },
            isNewVersionNew: function() { return true; },
            openUrl: function() {},
            execRefresh: function() {}
        };
    }

    // 5. Block popups
    window.alert = function(){};
    window.confirm = function(){ return true; };

    // 6. Auto-check agreement
    (function() {
        var el = document.getElementById('agreeRules');
        if (el) el.className = 'check checked';
    })();

    console.log('[ExamBypass] All hooks installed');
})();
"""

SUBMIT_BYPASS_JS = r"""
(function() {
    // Bypass hooks for exam answer page
    if (typeof checkClientSignatureSupport === 'function') {
        window.checkClientSignatureSupport = function() { return 0; };
    }
    if (typeof submitExamSignature === 'function') {
        window.submitExamSignature = function(callback, qid) {
            if (typeof callback === 'function') {
                setTimeout(function() { callback(1, '1', '0', '0', '', '0', '0'); }, 50);
            }
        };
    }
    window.alert = function(){};
    window.confirm = function(){ return true; };
})();
"""


def _ab(*args, timeout=30):
    """Execute agent-browser command connected to running CDP"""
    try:
        cmd = [AB, '--cdp', str(CDP_PORT)] + list(args)
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        out = (r.stdout + r.stderr).strip()
        if r.returncode != 0 and '✗' in out:
            logger.debug(f"agent-browser warning: {out[:200]}")
        return out
    except subprocess.TimeoutExpired:
        logger.warning(f"agent-browser timeout: {args}")
        return ''
    except FileNotFoundError:
        raise RuntimeError("agent-browser 未安装。请运行: npm i -g agent-browser")


def _eval(js, timeout=15):
    """Evaluate JavaScript in the active tab via agent-browser"""
    return _ab('eval', js, timeout=timeout)


def _sleep(sec):
    time.sleep(sec)


class BrowserExam:
    """浏览器驱动的超星考试自动化"""

    def __init__(self, account, tiku=None):
        self.account = account
        self.tiku = tiku
        self.current_tab = None

    # ── tab management ─────────────────────────────
    def _switch_to_chaoxing_tab(self):
        """Find and switch to a Chaoxing tab, or open a new one"""
        tabs_out = _ab('tab', 'list')
        for line in tabs_out.split('\n'):
            m = re.match(r'\[(t\d+)\]\s+(.*?)\s*-\s*(https?://\S+)', line.strip())
            if m and 'chaoxing.com' in m.group(3):
                tid = m.group(1)
                _ab('tab', tid)
                self.current_tab = tid
                return tid
        return None

    def _inject_bypass(self, js_code=BYPASS_JS):
        """Inject bypass JavaScript into current page"""
        _eval(js_code)
        _sleep(0.5)

    # ── main exam flow ─────────────────────────────────
    def run(self, exam_id, course_id, class_id, cpi, enc_task,
            auto_submit=True):
        """
        全自动浏览器考试流程

        1. 尝试 API 模式（exam_auto.py）
        2. 如果 API 返回 CLIENT_FORM_SIGN 错误，尝试浏览器 bypass
        3. 浏览器注入 bypass → 点击开始 → 获取题目 → 搜题 → 答题 → 交卷
        """
        result = {
            "exam_id": exam_id,
            "course_id": course_id,
            "class_id": class_id,
            "total": 0,
            "answered": 0,
            "submitted": False,
            "title": "",
            "_error": "",
        }

        try:
            from api.exam_auto import ChaoxingExam
            exam_api = ChaoxingExam(self.account, tiku=self.tiku)
        except ImportError:
            logger.warning("exam_auto.py 未找到")
            result["_error"] = "exam_auto.py not found"
            return result

        # ─── Phase 1: Try API mode first ───
        try:
            logger.info(f"[API] 尝试 API 模式考试: exam_id={exam_id}")
            api_result = exam_api.run(
                exam_id=exam_id, course_id=course_id,
                class_id=class_id, cpi=cpi, enc_task=enc_task,
                auto_submit=auto_submit
            )
            if api_result.get("submitted"):
                logger.info(f"[API] ✅ API 模式成功! 共{api_result['total']}题, 答{api_result['answered']}题")
                return api_result
            logger.info(f"[API] API 模式未提交({api_result.get('submitted')}), 可能需浏览器模式")
        except Exception as e:
            err_msg = str(e)
            logger.info(f"[API] API 模式失败: {type(e).__name__}: {err_msg[:100]}")

        # ─── Phase 2: Browser bypass mode ───
        logger.info(f"[Browser] 启动浏览器模式 exam_id={exam_id}")

        try:
            # Step 2a: Open the exam start page in browser
            start_url = (
                f"https://mooc1-api.chaoxing.com/exam-ans/exam/phone/start?"
                f"courseId={course_id}&classId={class_id}&examId={exam_id}"
                f"&source=0&cpi={cpi}&keyboardDisplayRequiresUserAction=1"
                f"&faceDetection=0&jt=0&code=&vx=0&examsignal=1"
                f"&enc_task={enc_task}"
            )
            # Switch to existing tab or open new
            if self._switch_to_chaoxing_tab():
                logger.info("[Browser] 使用已有超星标签页")
                _ab('eval', f"window.location.href = '{start_url}';")
            else:
                _ab('open', start_url)
            _sleep(4)

            # Step 2b: Inject bypass JS
            self._inject_bypass()

            # Step 2c: Click start
            _eval("window.enterCount = 0;")
            _eval("""
                var el = document.getElementById('agreeRules');
                if (el) el.className = 'check checked';
            """)
            _eval("""
                try {
                    if (typeof enter === 'function') {
                        enter();
                        'enter() called';
                    } else {
                        var btn = document.getElementById('start');
                        if (btn) {
                            var evt = new Event('tap', {bubbles: true});
                            btn.dispatchEvent(evt);
                            'tap event dispatched';
                        } else { 'start button not found'; }
                    }
                } catch(e) { 'Error: ' + e.message; }
            """)
            _sleep(5)

            current_url = _ab('get', 'url')
            logger.info(f"[Browser] URL after click: {current_url[:120]}")

            # Step 2d: Check if we got redirected to answer page
            html_check = _eval("document.body.innerHTML.substring(0, 1000)")
            if '无权限' in html_check:
                logger.warning("[Browser] 无权限访问，考试可能尚未开始或已过期")
                result["_error"] = "browser_no_permission"
                result["submitted"] = False
                return result

            if '安全验证' in html_check:
                logger.warning("[Browser] 安全验证无法通过（captcha/signature 服务器拒绝）")
                logger.warning("[Browser] 此考试需要 OCS/jsBridge 原生签名，纯浏览器无法绕过。")
                result["_error"] = "CLIENT_FORM_SIGN: captcha/signature bypass failed"
                return result

            # Step 2e: Check if we're on the answer page
            is_answer_page = bool(
                'reVersionTestStartNew' in current_url
                or 'questionWrap' in html_check
                or 'singleQuesId' in html_check
            )

            if not is_answer_page:
                logger.warning("[Browser] 无法进入答题页面（可能仍卡在开始页面）")
                result["_error"] = "browser_start_failed: could not reach answer page"
                return result

            logger.info("[Browser] ✅ 成功进入答题页面!")

            # Step 2f: If we reached the answer page, try to get enc from it
            enc_value = _eval("(document.getElementById('enc') || {}).value || ''")
            remain_time = _eval("(document.getElementById('encRemainTime') || {}).value || '0'")
            last_update = _eval("(document.getElementById('encLastUpdateTime') || {}).value || '0'")

            if enc_value:
                logger.info(f"[Browser] Got enc from browser page: {enc_value[:20]}...")

                # Use API with these params
                try:
                    exam_api.get_meta(exam_id, course_id, class_id, cpi, enc_task)
                    exam_api.enc = enc_value
                    exam_api.enc_remain_time = int(remain_time)
                    exam_api.last_update_time = int(last_update)
                    exam_api.remain_time = int(_eval("(document.getElementById('remainTime') || {}).value || '0'"))

                    # Fetch first question
                    first_q = exam_api.fetch(0)
                    questions = [first_q]
                    try:
                        while True:
                            idx = len(questions)
                            q = exam_api.fetch(idx)
                            questions.append(q)
                    except Exception:
                        pass

                    result["total"] = len(questions)
                    result["title"] = exam_api.title

                    # Answer questions
                    for idx, q in enumerate(questions):
                        answer = exam_api.search_answer(q)
                        if answer:
                            q.answer = answer
                            logger.info(f"Q{idx+1}/{len(questions)} 答案: {answer[:50]}")
                            if auto_submit:
                                exam_api.submit(idx, q)
                                result["answered"] += 1
                        else:
                            logger.warning(f"Q{idx+1} 未找到答案")
                            if auto_submit:
                                exam_api.submit(idx, q)

                    if auto_submit and result["answered"] > 0:
                        exam_api.submit(0, questions[0], final=True)
                        result["submitted"] = True
                        logger.info("✅ 考试提交成功!")

                except Exception as api_e:
                    logger.warning(f"[Browser] API 答题阶段失败: {api_e}")
                    result["_error"] = f"browser_api_failed: {api_e}"

        except Exception as e:
            logger.error(f"[Browser] 浏览器模式异常: {e}")
            import traceback
            logger.error(traceback.format_exc())
            result["_error"] = f"browser_error: {e}"

        logger.info(f"[Browser] 完成: {result}")
        return result
