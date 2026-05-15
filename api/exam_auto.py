#!/usr/bin/env python3
"""
OneAPIChat 考试自动化模块
基于 CxKitty (guowang23333/CxKitty-) 的考试协议解析适配
使用本项目的 Chaoxing session 和 Tiku 搜题引擎
"""
import json
import random
import re
import time
import logging
from datetime import datetime
from enum import Enum
from typing import Optional

from bs4 import BeautifulSoup
from bs4.element import NavigableString

from api.base import init_session
from api.answer import Tiku as _Tiku

def _get_tiku():
    """获取 Tiku 实例（兼容独立函数调用）"""
    try:
        t = _Tiku()
        t = t.get_tiku_from_config()
        if t: t.init_tiku()
        return t
    except:
        return None
# 移除题目文本中的转义字符
def remove_escape_chars(text: str) -> str:
    if not text: return ""
    text = text.replace("\\n", "\n").replace("\\r", "\r").replace("\\t", "\t")
    import html
    text = html.unescape(text)
    return text.strip()

logger = logging.getLogger('Exam')

# ── 接口 URL ────────────────────────────────────────────
PAGE_EXAM_COVER   = "https://mooc1-api.chaoxing.com/exam-ans/exam/phone/task-exam"
PAGE_EXAM_QUESTION = "https://mooc1-api.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew"
PAGE_EXAM_PREVIEW  = "https://mooc1-api.chaoxing.com/exam-ans/exam/phone/preview"
API_START_START    = "https://mooc1-api.chaoxing.com/exam-ans/exam/phone/start"
API_SUBMIT_ANSWER  = "https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionSubmitTestNew"
API_ANSWER_SHEET   = "https://mooc1-api.chaoxing.com/exam-ans/exam/phone/loadAnswerStatic"
API_EXAM_LIST      = "https://mooc1-api.chaoxing.com/exam-ans/exam/phone/task-list"


class QuestionType(Enum):
    单选题 = 0
    多选题 = 1
    填空题 = 2
    判断题 = 3


class ExamError(Exception): pass
class ExamIsCommitted(ExamError): pass
class ExamNotStart(ExamError): pass
class ExamAccessDenied(ExamError): pass
class ExamInvalidParams(ExamError): pass
class ExamTimeout(ExamError): pass
class ExamSubmitTooEarly(ExamError): pass
class ExamCodeDenied(ExamError): pass
class FaceDetectionError(ExamError): pass
class ChaptersNotComplete(ExamError): pass


class QuestionModel:
    """题目数据模型"""
    def __init__(self, id: int, value: str, qtype: QuestionType,
                 options=None, answer=None):
        self.id = id
        self.value = value
        self.type = qtype
        self.options = options or {}
        self.answer = answer

    def __repr__(self):
        return f"<Q#{self.id} {self.type.name}: {self.value[:30]}...>"


def parse_question(question_node) -> QuestionModel:
    """从 beautifulsoup 节点解析单道题目"""
    qid = int(question_node.select_one("input[name='questionId']")["value"])
    qtype = QuestionType(int(question_node.select_one("input[name^='type']")["value"]))
    options = None

    # 解析题干
    qv_node = question_node.select_one("div.tit")
    qv = ""
    cls = question_node.get("class", [])
    if "answerMain" in cls:
        for tag in list(qv_node.children)[4:]:
            if isinstance(tag, NavigableString):
                qv += tag.strip()
            elif tag.name == "p":
                qv += f"\n{tag.text.strip()}"
    elif "allAnswerList" in cls:
        for idx, tag in enumerate(list(qv_node.children)[2:]):
            if isinstance(tag, NavigableString):
                t = tag.strip()
                if idx == 0 and re.match(r"^\d+\.", t):
                    _, temp = t.split(".", 1)
                    if temp: qv = temp; break
                else: qv += t
            elif tag.name == "p":
                qv += "\n" + tag.text.strip()
    else:
        raise ExamError("题目解析异常")
    qv = remove_escape_chars(qv)

    # 分题型解析
    if qtype in (QuestionType.单选题, QuestionType.多选题):
        options = {}
        for opt_node in question_node.select("div.answerList.radioList"):
            key = opt_node["name"]
            val = "".join(s.strip() for s in opt_node.select_one("cc").strings)
            options[key] = remove_escape_chars(val)
        answer = question_node.select_one("input[id^='answer']")["value"] or None
    elif qtype == QuestionType.填空题:
        answer = []
        options = []
        for blank_node in question_node.select("div.completionList.objectAuswerList"):
            options.append(blank_node.select_one("span.grayTit").text)
            answer.append(blank_node.select_one("textarea.blanktextarea").text)
    elif qtype == QuestionType.判断题:
        raw = question_node.select_one("input[id^='answer']")["value"]
        answer = True if raw == "true" else False if raw == "false" else None
    else:
        raise NotImplementedError(f"不支持题型: {qtype}")

    return QuestionModel(qid, qv, qtype, options, answer)


def construct_question_form(question: QuestionModel) -> dict:
    """构建答题表单"""
    form = {f"type{question.id}": question.type.value, "questionId": question.id}
    if question.type == QuestionType.单选题:
        form[f"answer{question.id}"] = question.answer
    elif question.type == QuestionType.多选题:
        form[f"answers{question.id}"] = question.answer
    elif question.type == QuestionType.判断题:
        form[f"answer{question.id}"] = "true" if question.answer else "false"
    elif question.type == QuestionType.填空题:
        blank_num = ""
        for i, val in enumerate(question.answer, 1):
            form[f"answer{question.id}{i}"] = val
            blank_num += f"{i},"
        form[f"blankNum{question.id}"] = blank_num
    return form


class ChaoxingExam:
    """学习通考试自动化"""

    def __init__(self, account, tiku=None, session=None):
        self.account = account
        self.tiku = tiku or _get_tiku()
        self.session = session

        # 考试状态
        self.exam_id = 0
        self.course_id = 0
        self.class_id = 0
        self.cpi = 0
        self.enc_task = 0
        self.exam_answer_id = 0
        self.enc = ""
        self.remain_time = 0
        self.enc_remain_time = 0
        self.last_update_time = 0
        self.title = ""
        self.exam_student = ""

    def _build_session(self):
        """复用已登录 session（调用方须先通过 Chaoxing.login() 登录）"""
        if self.session is None:
            from api.base import init_session as _init
            self.session = _init()
        return self.session

    # ── 课程考试列表 ───────────────────────────────
    def list_exams(self, course_id: int, class_id: int, cpi: int) -> list[dict]:
        """获取课程的考试列表（SSR HTML页面，与CxKitty一致）"""
        s = self._build_session()
        exams = []
        try:
            resp = s.get(API_EXAM_LIST, params={
                "courseId": course_id, "classId": class_id, "cpi": cpi,
            }, timeout=15)
            resp.raise_for_status()
            html = BeautifulSoup(resp.text, "lxml")
            # 考试列表以 <li> 元素呈现，data 属性包含 URL 参数
            exam_items = html.find_all("li") if html.body else []
            if exam_items:
                from urllib.parse import urlparse, parse_qs
                for li in exam_items:
                    data_url = li.get("data", "")
                    if not data_url:
                        continue
                    params = parse_qs(urlparse(data_url).query)
                    exam_id = params.get("taskRefId", params.get("taskrefId", ["0"]))[0]
                    if not exam_id or exam_id == "0":
                        continue
                    # 提取标题和状态
                    text = li.get_text(strip=True)
                    import re as _re
                    # 格式: 标题（日期范围）状态剩余... or 标题状态
                    m = _re.match(r'(.+?)（.+?）(待做|未开始|已完成|已交|未交)?|(.+?)(待做|未开始|已完成|已交|未交)', text)
                    if m:
                        if m.group(3):
                            title = m.group(3).strip()
                            status = m.group(4) or "未知"
                        else:
                            title = m.group(1).strip()
                            status = m.group(2) or "未知"
                    else:
                        title = text
                        status = "未知"
                    # 分数由 _fetch_score 单独抓取
                    score = "0"
                    exams.append({
                        "exam_id": int(exam_id),
                        "title": title,
                        "status": status,
                        "course_id": course_id,
                        "class_id": class_id,
                        "cpi": cpi,
                        "enc_task": params.get("enc_task", ["0"])[0],
                        "score": score,
                    })
            logger.info(f"课程考试: {len(exams)} 个")
            # 已完成考试：抓取分数（无论列表页是否显示时间）
            for e in exams:
                if e["status"] == "已完成":
                    e["score"] = self._fetch_score(s, e)
        except Exception as e:
            logger.debug(f"考试列表获取失败: {e}")
        return exams

    # ── 抓取已完成考试的分数 ──────────────────────
    def _fetch_score(self, s, exam):
        """从考试结果页抓取分数"""
        try:
            resp = s.get(
                "https://mooc1-api.chaoxing.com/exam-ans/exam/phone/look",
                params={
                    "taskrefId": exam["exam_id"],
                    "courseId": exam["course_id"],
                    "classId": exam["class_id"],
                    "cpi": exam["cpi"],
                    "redo": 1,
                }, timeout=10, allow_redirects=False)
            if resp.status_code == 200:
                html = BeautifulSoup(resp.text, "lxml")
                body = html.body
                if body:
                    body_text = body.get_text()
                    if "已删除" in body_text:
                        exam["status"] = "已删除"
                        return "-"
                    # 尝试匹配分数格式: XX分, XX.X分
                    import re as _re
                    m = _re.search(r'(\d+\.?\d*)\s*分', body_text)
                    if m:
                        return m.group(1)
                    # 尝试 span/div 元素
                    for el in body.find_all(["span", "div", "p"]):
                        t = el.get_text(strip=True)
                        if "分" in t and len(t) < 20:
                            m2 = _re.search(r'(\d+\.?\d*)', t)
                            if m2:
                                return m2.group(1)
        except Exception as e:
            logger.debug(f"分数获取失败: {e}")
        return "0"

    # ── 拉取元数据 ────────────────────────────────
    def get_meta(self, exam_id, course_id, class_id, cpi, enc_task):
        """拉取考试封面元数据（必须在 start 前执行）"""
        self.exam_id = exam_id
        self.course_id = course_id
        self.class_id = class_id
        self.cpi = cpi
        self.enc_task = enc_task

        s = self._build_session()
        resp = s.get(PAGE_EXAM_COVER, params={
            "redo": 1, "taskrefId": exam_id, "courseId": course_id,
            "classId": class_id, "userId": str(self.account.user_id or ""),
            "role": "", "source": 0, "enc_task": enc_task, "cpi": cpi,
            "vx": 0, "examsignal": 1,
        }, allow_redirects=False)
        resp.raise_for_status()

        if resp.status_code == 302:
            loc = resp.headers.get("Location", "")
            if "/exam-ans/exam/phone/look" in loc:
                raise ExamIsCommitted("考试已完成")
            raise ExamError("重定向异常")

        html = BeautifulSoup(resp.text, "lxml")

        err = html.select_one("h2.color6.fs36.textCenter.marBom60.line64")
        if err:
            msg = err.text.strip()
            if "尚未开始" in msg: raise ExamNotStart(msg)
            if "章节任务点未完成" in msg: raise ChaptersNotComplete(msg)
            raise ExamError(msg)

        self.exam_answer_id = int(html.select_one("input#testUserRelationId")["value"])
        self.title = html.select_one("span.overHidden2").text
        logger.info(f"考试封面: [{self.title}] 答题ID={self.exam_answer_id}")

    # ── 开始考试 ──────────────────────────────────
    def start(self, code: str = "") -> QuestionModel:
        """开始考试，返回第一题"""
        s = self._build_session()
        resp = s.get(API_START_START, params={
            "courseId": self.course_id, "classId": self.class_id,
            "examId": self.exam_id, "source": 0,
            "examAnswerId": self.exam_answer_id, "cpi": self.cpi,
            "keyboardDisplayRequiresUserAction": 1,
            "imei": _imei(), "faceDetection": 0, "jt": 0,
            "code": code,
        }, allow_redirects=False)
        resp.raise_for_status()

        if resp.status_code == 200:
            html = BeautifulSoup(resp.text, "lxml")
            err = html.select_one("p.blankTips,li.msg")
            if err:
                msg = err.text.strip()
                if "验证码错误" in msg: raise ExamCodeDenied(msg)
                raise ExamError(msg)
        elif resp.status_code == 302:
            loc = resp.headers["Location"]
            # 从重定向 URL 中提取 enc 参数
            from urllib.parse import urlparse, parse_qs
            self.enc = parse_qs(urlparse(loc).query).get("enc", [""])[0]
            logger.info(f"考试开始成功: [{self.title}]")
            return self.fetch(0)
        raise ExamError(f"开始考试失败 (HTTP {resp.status_code})")

    # ── 拉取单题 ──────────────────────────────────
    def fetch(self, index: int) -> QuestionModel:
        """拉取指定索引的题目"""
        s = self._build_session()
        resp = s.get(PAGE_EXAM_QUESTION, params={
            "courseId": self.course_id, "classId": self.class_id,
            "tId": self.exam_id, "id": self.exam_answer_id,
            "source": 0, "p": 1, "isphone": "true",
            "tag": int(self.enc_remain_time == 0), "cpi": self.cpi,
            "imei": _imei(), "start": index, "enc": self.enc,
            "remainTimeParam": self.enc_remain_time,
            "relationAnswerLastUpdateTime": self.last_update_time,
        })
        resp.raise_for_status()
        html = BeautifulSoup(resp.text, "lxml")

        err = html.body.select_one("p.blankTips")
        if err:
            msg = err.text.strip()
            if "已经提交" in msg: raise ExamIsCommitted(msg)
            if "无效参数" in msg: raise ExamInvalidParams(msg)
            if "无权限" in msg: raise ExamAccessDenied(msg)
            raise ExamError(msg)

        form = html.select_one("form#submitTest")
        self.enc = form.select_one("input#enc")["value"]
        self.enc_remain_time = int(form.select_one("input#encRemainTime")["value"])
        self.remain_time = int(form.select_one("input#remainTime")["value"])
        self.last_update_time = int(form.select_one("input#encLastUpdateTime")["value"])
        self.exam_student = html.select_one("input#ExamWaterMark")["value"]

        qnode = form.select_one("div.questionWrap.singleQuesId.ans-cc-exam")
        question = parse_question(qnode)
        logger.info(f"拉取第{index+1}题: [{question.type.name}] {question.value[:40]}...")
        return question

    # ── 拉取全部题目（整卷）────────────────────────
    def fetch_all(self) -> list[QuestionModel]:
        """拉取整卷预览，返回所有题目"""
        s = self._build_session()
        resp = s.get(PAGE_EXAM_PREVIEW, params={
            "courseId": self.course_id, "classId": self.class_id,
            "source": 0, "imei": _imei(), "start": 0, "cpi": self.cpi,
            "examRelationId": self.exam_id,
            "examRelationAnswerId": self.exam_answer_id,
            "remainTimeParam": self.enc_remain_time,
            "relationAnswerLastUpdateTime": self.last_update_time,
            "enc": self.enc,
        })
        resp.raise_for_status()
        html = BeautifulSoup(resp.text, "lxml")

        err = html.body.select_one("p.blankTips")
        if err:
            msg = err.text.strip()
            if "已经提交" in msg: raise ExamIsCommitted(msg)
            raise ExamError(msg)

        form = html.body.select_one("form#submitTest")
        self.enc = form.select_one("input#enc")["value"]
        self.enc_remain_time = int(form.select_one("input#encRemainTime")["value"])
        self.remain_time = int(form.select_one("input#remainTime")["value"])
        self.last_update_time = int(form.select_one("input#encLastUpdateTime")["value"])

        qnodes = html.body.select("div.questionWrap.singleQuesId.ans-cc-exam")
        questions = [parse_question(n) for n in qnodes]
        logger.info(f"拉取整卷共 {len(questions)} 题")
        return questions

    # ── 搜索答案 ──────────────────────────────────
    def search_answer(self, question: QuestionModel) -> Optional[str]:
        """通过 Tiku 搜题引擎查找答案"""
        if not self.tiku:
            logger.warning("未配置题库，跳过搜题")
            return None

        # 构建搜题信息
        q_info = {
            "question": question.value,
            "type": question.type.value,
            "options": question.options,
        }
        try:
            result = self.tiku.query(q_info)
            if result and result.get("answer"):
                return result["answer"]
        except Exception as e:
            logger.warning(f"搜题失败: {e}")
        return None

    # ── 提交单题答案 ──────────────────────────────
    def submit(self, index: int, question: QuestionModel, final: bool = False) -> dict:
        """提交答案或交卷"""
        s = self._build_session()
        sig = _exam_signature(
            uid=str(self.account.user_id or ""),
            qid=question.id if question else 0,
        )
        params = {
            "classId": self.class_id, "courseId": self.course_id,
            "cpi": self.cpi, "testPaperId": self.exam_id,
            "testUserRelationId": self.exam_answer_id,
            "tempSave": "false" if final else "true",
            "qid": question.id if question else "",
            "version": 1, **sig,
        }
        data = {
            "courseId": self.course_id, "testPaperId": self.exam_id,
            "testUserRelationId": self.exam_answer_id,
            "classId": self.class_id, "type": 0, "isphone": "true",
            "imei": _imei(), "remainTime": self.remain_time,
            "tempSave": "false" if final else "true",
            "timeOver": "false", "encRemainTime": self.enc_remain_time,
            "encLastUpdateTime": self.last_update_time, "enc": self.enc,
            "userId": str(self.account.user_id or ""), "source": 0,
            "start": index, "enterPageTime": self.last_update_time,
        }
        if question:
            data.update(construct_question_form(question))

        resp = s.post(API_SUBMIT_ANSWER, params=params, data=data)
        resp.raise_for_status()
        j = resp.json()
        if j.get("status") != "success":
            msg = j.get("msg", "未知错误")
            if final: raise ExamError(f"交卷失败: {msg}")
            raise ExamError(f"提交失败: {msg}")

        if not final:
            parts = j.get("data", "").split("|")
            if len(parts) >= 3:
                self.last_update_time = int(parts[0])
                self.enc_remain_time = int(parts[1])
                self.enc = parts[2]
        logger.info(f"{'交卷' if final else '提交'}第{index+1}题成功")
        return j

    # ── 运行考试流程 ──────────────────────────────
    def run(self, exam_id, course_id, class_id, cpi, enc_task,
            auto_submit: bool = True) -> dict:
        """全自动执行考试
        Returns: 结果统计
        """
        result = {"exam_id": exam_id, "title": "", "total": 0, "answered": 0, "submitted": False}

        # 1. 获取元数据
        self.get_meta(exam_id, course_id, class_id, cpi, enc_task)
        result["title"] = self.title

        # 2. 开始考试（拉取第一题）
        first_q = self.start()
        questions = [first_q]

        # 3. 逐题拉取
        try:
            while True:
                idx = len(questions)
                q = self.fetch(idx)
                questions.append(q)
        except ExamInvalidParams:
            pass  # 拉取完毕
        except (ExamIsCommitted, ExamError) as e:
            logger.info(f"拉取终止: {e}")
            return result

        result["total"] = len(questions)
        logger.info(f"共 {len(questions)} 题，开始答题...")

        # 4. 逐题搜索答案并提交
        for idx, q in enumerate(questions):
            answer = self.search_answer(q)
            if answer:
                q.answer = answer
                logger.info(f"第{idx+1}题 答案: {answer}")
                if auto_submit:
                    self.submit(idx, q)
                    result["answered"] += 1
            else:
                logger.warning(f"第{idx+1}题 未找到答案，跳过")
                if auto_submit:
                    # 留空提交（保持原始答案）
                    self.submit(idx, q)

        # 5. 交卷
        if auto_submit and result["answered"] > 0:
            self.submit(0, questions[0], final=True)
            result["submitted"] = True
            logger.info("✅ 考试已完成并交卷")

        return result


# ── 工具函数 ─────────────────────────────────────────────
def _imei() -> str:
    """生成随机 IMEI"""
    return "86" + "".join(str(random.randint(0, 9)) for _ in range(13))


def _exam_signature(uid: str, qid: int, x: int = None, y: int = None) -> dict:
    """生成考试提交签名参数"""
    if x is None: x = random.randint(100, 1000)
    if y is None: y = random.randint(100, 1000)
    t = int(datetime.now().timestamp() * 1000)
    raw = f"{uid}{qid}{x}{y}{t}"
    import hashlib
    sig = hashlib.md5(raw.encode()).hexdigest()
    return {"x": x, "y": y, "t": t, "sign": sig}
