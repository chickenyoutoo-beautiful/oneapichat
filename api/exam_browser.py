#!/usr/bin/env python3
"""
超星考试浏览器自动化 — 通过 agent-browser CLI 驱动无头 Chromium
处理 CLIENT_FORM_SIGN 等需要 JS 执行的考试
依赖: npm i -g agent-browser && agent-browser install
"""
import json, re, time, subprocess, logging, sys, os

logger = logging.getLogger('ExamBrowser')
AB = 'agent-browser'

def _cmd(*args, timeout=30):
    """执行 agent-browser 命令"""
    try:
        r = subprocess.run([AB] + list(args), capture_output=True, text=True, timeout=timeout)
        return (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return ''
    except FileNotFoundError:
        raise RuntimeError("agent-browser 未安装。请运行: npm i -g agent-browser && agent-browser install")

def _sleep(sec):
    time.sleep(sec)

class BrowserExam:
    def __init__(self, account, tiku=None):
        self.account = account
        self.tiku = tiku

    def run(self, exam_id, course_id, class_id, cpi, enc_task, auto_submit=True):
        result = {"exam_id": exam_id, "total": 0, "answered": 0, "submitted": False}
        try:
            # 注入 cookies 并打开考试
            start_url = (
                f"https://mooc1-api.chaoxing.com/exam-ans/exam/phone/start?"
                f"courseId={course_id}&classId={class_id}&examId={exam_id}"
                f"&source=0&cpi={cpi}&keyboardDisplayRequiresUserAction=1"
                f"&faceDetection=0&jt=0&code=&vx=0&examsignal=1"
            )
            logger.info(f"浏览器打开考试: {exam_id}")
            _cmd('open', start_url)
            _sleep(4)

            # 抓取页面
            snap = _cmd('snapshot', '-i')
            logger.info(f"页面内容: {snap[:500]}")

            # 点击开始
            if '开始考试' in snap:
                refs = re.findall(r'@e\d+', snap)
                for r in refs:
                    lines = [l for l in snap.split('\n') if r in l]
                    if lines and '开始考试' in lines[0]:
                        logger.info(f"点击: {r}")
                        _cmd('click', r)
                        _sleep(3)
                        try:
                            _cmd('dialog', 'accept')
                        except:
                            pass
                        _sleep(2)
                        break

            # 答题循环
            q_count = 0
            max_q = 50
            while q_count < max_q:
                snap = _cmd('snapshot', '-i')
                
                if '交卷成功' in snap or '考试结束' in snap:
                    logger.info(f"考试完成: {q_count} 题")
                    break
                if '无权限' in snap:
                    raise RuntimeError("无权限访问")
                if '时间已到' in snap:
                    logger.info("时间到，已自动交卷")
                    result["submitted"] = True
                    break

                # 找下一题按钮
                for r in re.findall(r'@e\d+', snap):
                    lines = [l for l in snap.split('\n') if r in l]
                    if lines and ('下一题' in lines[0] or 'next' in lines[0].lower()):
                        _cmd('click', r)
                        _sleep(2)
                        q_count += 1
                        break
                else:
                    # 尝试交卷
                    for r in re.findall(r'@e\d+', snap):
                        lines = [l for l in snap.split('\n') if r in l]
                        if lines and ('交卷' in lines[0] or 'submit' in lines[0].lower()):
                            if auto_submit:
                                _cmd('click', r)
                                _sleep(2)
                                try:
                                    _cmd('dialog', 'accept')
                                except:
                                    pass
                                _sleep(3)
                                result["submitted"] = True
                            break
                    break

            result["total"] = q_count
            logger.info(f"浏览器考试结束: {result}")

        finally:
            _cmd('close')
        
        return result
