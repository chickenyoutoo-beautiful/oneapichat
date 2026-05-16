#!/usr/bin/env python3
"""
超星考试浏览器自动化 — 通过 Playwright Node.js 驱动无头 Chromium
处理 CLIENT_FORM_SIGN 等需要 JS 执行的考试
"""
import os, subprocess, logging

logger = logging.getLogger('ExamBrowser')

PW_SCRIPT = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'exam_playwright.js')
NODE_PATH = '/home/naujtrats/.npm-global/lib/node_modules'

class BrowserExam:
    """基于 Playwright 的考试自动化"""
    
    def __init__(self, account, tiku=None):
        self.account = account
        self.tiku = tiku
    
    def run(self, exam_id, course_id, class_id, cpi, enc_task, auto_submit=True):
        result = {"exam_id": exam_id, "total": 0, "answered": 0, "submitted": False}
        
        if not os.path.exists(PW_SCRIPT):
            logger.warning(f"Playwright 脚本不存在: {PW_SCRIPT}")
            return result
        
        env = {
            **os.environ,
            'NODE_PATH': NODE_PATH,
            'DISPLAY': os.environ.get('DISPLAY', ':99'),
            'HOME': os.environ.get('HOME', '/home/naujtrats'),
            'CX_USERNAME': self.account.username,
            'CX_PASSWORD': self.account.password,
            'EXAM_ID': str(exam_id),
            'COURSE_ID': str(course_id),
            'CLASS_ID': str(class_id),
            'CPI': str(cpi),
        }
        
        try:
            logger.info(f"启动 Playwright 考试: exam={exam_id}")
            r = subprocess.run(
                ['node', PW_SCRIPT], env=env,
                capture_output=True, text=True, timeout=600
            )
            for line in r.stdout.strip().split('\n'):
                if line.strip():
                    logger.info(f"  [PW] {line}")
            for line in r.stderr.strip().split('\n')[-10:]:
                if line.strip():
                    logger.warning(f"  [PW] {line}")
            
            if r.returncode == 0:
                # Try to parse result from stdout
                for line in r.stdout.split('\n'):
                    if '"submitted":true' in line or 'EXAM COMPLETED' in line:
                        result["submitted"] = True
                        result["answered"] = 1
                        break
            else:
                logger.warning(f"Playwright 异常退出: code={r.returncode}")
        except subprocess.TimeoutExpired:
            logger.warning("浏览器考试超时（10分钟）")
        except FileNotFoundError:
            logger.warning("Node.js 未安装，无法运行 Playwright")
        except Exception as e:
            logger.warning(f"浏览器考试异常: {e}")
        
        return result
