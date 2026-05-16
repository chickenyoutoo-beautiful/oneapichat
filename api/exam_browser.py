#!/usr/bin/env python3
"""
超星考试浏览器自动化模块 —— 处理 CLIENT_FORM_SIGN 等需要 JS 执行的考试
使用 Playwright 无头浏览器模拟真实浏览器操作
"""
import json, re, time, logging, sys, os
from typing import Optional

logger = logging.getLogger('ExamBrowser')

# 题库搜索器
def _get_tiku():
    try:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from api.answer import Tiku as _Tiku
        t = _Tiku()
        t = t.get_tiku_from_config()
        if t: t.init_tiku()
        return t
    except:
        return None


class BrowserExam:
    """基于 Playwright 的考试自动化"""

    def __init__(self, account, tiku=None):
        self.account = account
        self.tiku = tiku or _get_tiku()
        self._playwright = None
        self._browser = None
        self._page = None

    def _ensure_browser(self):
        """初始化 Playwright 浏览器"""
        if self._browser:
            return
        from playwright.sync_api import sync_playwright
        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch(headless=True)
        self._page = self._browser.new_page()

    def close(self):
        """关闭浏览器"""
        if self._browser:
            self._browser.close()
        if self._playwright:
            self._playwright.stop()

    def login(self):
        """登录超星"""
        self._ensure_browser()
        # 复用已有的 session cookies
        from api.base import Chaoxing, Account, init_session
        api = Chaoxing(account=self.account)
        result = api.login()
        if not result['status']:
            raise Exception(f"登录失败: {result.get('msg')}")

        s = init_session()
        # 将 session cookies 注入浏览器
        cookies = []
        for cookie in s.cookies:
            cookies.append({
                'name': cookie.name,
                'value': cookie.value,
                'domain': cookie.domain or '.chaoxing.com',
                'path': cookie.path or '/',
            })
        self._page.context.add_cookies(cookies)
        return True

    def start_exam(self, course_id, class_id, exam_id, cpi, enc_task, exam_answer_id):
        """在浏览器中开始考试并返回第一题"""
        self._ensure_browser()
        page = self._page

        # 访问考试开始页面
        start_url = (
            f"https://mooc1-api.chaoxing.com/exam-ans/exam/phone/start?"
            f"courseId={course_id}&classId={class_id}&examId={exam_id}"
            f"&source=0&examAnswerId={exam_answer_id}&cpi={cpi}"
            f"&keyboardDisplayRequiresUserAction=1&faceDetection=0&jt=0"
            f"&code=&vx=0&examsignal=1"
        )
        logger.info(f"浏览器打开考试: {start_url[:100]}...")
        page.goto(start_url, wait_until='networkidle', timeout=30000)

        # 等待页面加载，检查错误
        time.sleep(2)
        body = page.content()
        if '无权限访问' in body:
            raise Exception("无权限访问考试")
        if '安全验证' in body:
            logger.info("检测到安全验证页面，等待 JS 执行...")

        # 查找并点击"开始考试"按钮
        start_btn = page.locator('#start, button:has-text("开始考试"), a:has-text("开始考试")').first
        if start_btn.is_visible():
            logger.info("点击「开始考试」...")
            start_btn.click()
            page.wait_for_load_state('networkidle', timeout=30000)
            time.sleep(3)
        else:
            # 可能直接进入了考试页面
            logger.info("未找到开始按钮，可能已直接进入考试")

        # 检查是否在考试答题页面
        return self._get_current_question(page)

    def _get_current_question(self, page):
        """从当前页面提取题目"""
        body = page.content()
        from bs4 import BeautifulSoup
        html = BeautifulSoup(body, 'lxml')

        enc_el = html.select_one('input#enc')
        if enc_el:
            self._enc = enc_el['value']
            logger.info(f"获取到 enc: {self._enc[:20]}...")

        qnode = html.select_one('div.questionWrap.singleQuesId.ans-cc-exam')
        if not qnode:
            qnode = html.select_one('div.questionWrap')
        if not qnode:
            # 尝试等待题目加载
            page.wait_for_selector('div.questionWrap', timeout=10000)
            html = BeautifulSoup(page.content(), 'lxml')
            qnode = html.select_one('div.questionWrap')

        if qnode:
            from api.exam_auto import parse_question, QuestionType
            try:
                q = parse_question(qnode)
                logger.info(f"第1题: [{q.type.name}] {q.value[:50]}...")
                return q
            except Exception as e:
                logger.warning(f"题目解析失败: {e}")
                return None

        # 检查是否已到题目列表页
        error = html.select_one('p.blankTips')
        if error:
            raise Exception(f"考试错误: {error.text.strip()}")
        return None

    def answer_question(self, question, answer):
        """在浏览器中填写答案"""
        page = self._page
        from api.exam_auto import QuestionType

        qid = question.id
        if question.type == QuestionType.单选题:
            page.locator(f'input[name="answer{qid}"][value="{answer}"]').click()
        elif question.type == QuestionType.多选题:
            for opt in answer:
                page.locator(f'input[name="answers{qid}"][value="{opt}"]').click()
        elif question.type == QuestionType.判断题:
            val = 'true' if answer else 'false'
            page.locator(f'input[name="answer{qid}"][value="{val}"]').click()
        elif question.type == QuestionType.填空题:
            for i, val in enumerate(answer, 1):
                page.locator(f'textarea[name="answer{qid}{i}"]').fill(val)

    def next_question(self):
        """点击下一题"""
        page = self._page
        next_btn = page.locator('a:has-text("下一题"), button:has-text("下一题"), .nextTopic').first
        if next_btn.is_visible():
            next_btn.click()
            page.wait_for_load_state('networkidle', timeout=15000)
            time.sleep(2)
            return self._get_current_question(page)
        return None

    def submit_exam(self):
        """交卷"""
        page = self._page
        submit_btn = page.locator('a:has-text("交卷"), button:has-text("交卷"), #handExam').first
        if submit_btn.is_visible():
            logger.info("点击交卷...")
            submit_btn.click()
            # 确认对话框
            page.on('dialog', lambda d: d.accept())
            time.sleep(3)
            logger.info("考试已提交")

    def search_answer(self, question):
        """搜索答案"""
        if not self.tiku:
            return None
        try:
            from api.exam_auto import QuestionType
            result = self.tiku.search(question.value.strip())
            if result:
                return result.get('answer')
        except:
            pass
        return None

    def run(self, course_id, class_id, exam_id, cpi, enc_task,
            exam_answer_id=None, auto_submit=True):
        """全自动执行考试"""
        result = {"exam_id": exam_id, "total": 0, "answered": 0, "submitted": False}

        try:
            # 1. 登录
            self.login()

            # 2. 获取答题ID（如果未提供）
            if exam_answer_id is None:
                from api.exam_auto import ChaoxingExam
                from api.base import init_session
                er = ChaoxingExam(self.account, session=init_session())
                er.get_meta(exam_id, course_id, class_id, cpi, enc_task)
                exam_answer_id = er.exam_answer_id

            # 3. 浏览器开始考试
            q = self.start_exam(course_id, class_id, exam_id, cpi, enc_task, exam_answer_id)
            if not q:
                raise Exception("无法获取第一题")
            questions = [q]
            result["total"] = len(questions)

            # 4. 答题循环
            while True:
                current = questions[-1]
                answer = self.search_answer(current)
                if answer:
                    current.answer = answer
                    logger.info(f"第{len(questions)}题 答案: {answer}")
                    if auto_submit:
                        self.answer_question(current, answer)
                        result["answered"] += 1
                else:
                    logger.warning(f"第{len(questions)}题 未找到答案")

                # 拉取下一题
                try:
                    next_q = self.next_question()
                    if next_q:
                        questions.append(next_q)
                        result["total"] = len(questions)
                    else:
                        break
                except:
                    break

            # 5. 交卷
            if auto_submit and result["answered"] > 0:
                self.submit_exam()
                result["submitted"] = True
                logger.info("✅ 浏览器考试已完成并交卷")

        finally:
            self.close()

        return result
