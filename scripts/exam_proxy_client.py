#!/usr/bin/env python3
"""
使用代理访问超星考试 — 处理 appExamClientSign / 无权限访问
"""
import sys, os, json, re, time, random
from urllib.parse import urlencode
import requests

PROXY = "http://127.0.0.1:8899"
TARGET_HOST = "mooc1-api.chaoxing.com"

# 从已有的登录用户的 coookies 目录中提取
CONFIG_DIR = '/tmp/AutomaticCB'
API_DIR = '/var/www/html/oneapichat'
sys.path.insert(0, API_DIR)

exam_id = "9459820"
course_id = "263695114"
class_id = "146799509"
cpi = "488376903"
enc_task = "dfb69177e925652bc5cef2630350b1c1"

def get_active_session():
    """从已有的登录 session 中获取 cookies 并创建 requests session"""
    import configparser, glob
    configs = sorted(glob.glob(f'{CONFIG_DIR}/config_u_*.ini'), key=os.path.getmtime, reverse=True)
    if not configs:
        print("No configs found")
        return None
    
    from api.base import Chaoxing, Account, init_session
    cfg = configparser.ConfigParser()
    cfg.read(configs[0], encoding='utf8')
    
    acc = Account(cfg.get('common','username'), cfg.get('common','password'))
    api = Chaoxing(account=acc)
    lr = api.login()
    if not lr['status']:
        print(f"Login failed: {lr}")
        return None
    
    sess = init_session()
    
    # Also try to get cookies from existing cookies.txt
    cookie_path = f'{CONFIG_DIR}/cookies.txt'
    if os.path.exists(cookie_path):
        try:
            with open(cookie_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        parts = line.split('\t')
                        if len(parts) >= 7:
                            sess.cookies.set(parts[5], parts[6], domain=parts[0])
        except:
            pass
    
    return sess, api, acc

def proxy_get(path, params=None, session=None):
    """通过代理 GET 请求"""
    url = f"{PROXY}{path}"
    if params:
        qs = urlencode(params)
        url = f"{url}?{qs}"
    
    if session:
        # Pass cookies from session to proxy via headers
        cookie_str = '; '.join(f"{k}={v}" for k, v in session.cookies.get_dict().items())
        headers = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
            'Cookie': cookie_str,
        }
    else:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
        }
    
    resp = requests.get(url, headers=headers, timeout=30, allow_redirects=True)
    return resp

def examine_exam_cover(session):
    """通过代理获取考试封面页"""
    params = {
        "redo": 1,
        "taskrefId": exam_id,
        "courseId": course_id,
        "classId": class_id,
        "userId": session.cookies.get('_uid', ''),
        "role": "",
        "source": 0,
        "enc_task": enc_task,
        "cpi": cpi,
        "vx": 0,
        "examsignal": 1,
    }
    resp = proxy_get("/exam-ans/exam/phone/task-exam", params, session)
    print(f"[COVER] Status: {resp.status_code}")
    
    # Check if redirected to /exam-ans/exam/phone/look (already submitted)
    if resp.url != resp.request.url or resp.status_code in (301, 302):
        print(f"[COVER] Redirected to: {resp.url}")
    
    # Parse HTML for key values
    from bs4 import BeautifulSoup
    html = BeautifulSoup(resp.text, 'lxml')
    
    test_user_rel_id = html.select_one("input#testUserRelationId")
    if test_user_rel_id:
        print(f"[COVER] testUserRelationId: {test_user_rel_id['value']}")
    
    # Check for error messages
    err = html.select_one("h2.color6.fs36.textCenter.marBom60.line64")
    if err:
        print(f"[COVER] Error: {err.text.strip()}")
        return None
    
    # Check appExamClientSign
    sign_input = html.select_one("input#appExamClientSign")
    if sign_input:
        print(f"[COVER] appExamClientSign: {sign_input['value']}")
    
    # Get the start URL from JavaScript
    body = resp.text
    start_url_match = re.search(r'var url = "([^"]+)"', body)
    if start_url_match:
        start_url = start_url_match.group(1)
        print(f"[COVER] Start URL: {start_url}")
        return start_url
    
    return resp.text

def proxy_start_exam(start_url, session):
    """通过代理开始考试"""
    resp = proxy_get(start_url, session=session)
    print(f"[START] Status: {resp.status_code}")
    print(f"[START] URL: {resp.url}")
    
    if resp.status_code == 302:
        loc = resp.headers.get('Location', '')
        print(f"[START] Redirect: {loc}")
        # Follow redirect
        resp = session.get(loc, timeout=15)
        print(f"[START] After redirect: {resp.status_code}")
    
    from bs4 import BeautifulSoup
    html = BeautifulSoup(resp.text, 'lxml')
    
    # Check enc
    enc_input = html.select_one("input#enc")
    if enc_input:
        enc = enc_input['value']
        print(f"[START] enc: {enc}")
        return enc, resp.text
    
    # Check form
    form = html.select_one("form#submitTest")
    if form:
        print("[START] Form found (no enc) - need to fetch questions")
        return None, resp.text
    
    # Check error
    err = html.select_one("p.blankTips,li.msg,h2.color6")
    if err:
        print(f"[START] Error: {err.text.strip()}")
    
    print(f"[START] Body snippet: {resp.text[:500]}")
    return None, resp.text

def proxy_fetch_questions(enc, session):
    """通过代理拉取题目"""
    if not enc:
        print("[FETCH] No enc, skipping")
        return None
    
    params = {
        "courseId": course_id,
        "classId": class_id,
        "tId": exam_id,
        "id": 169226913,  # testUserRelationId
        "source": 0,
        "p": 1,
        "isphone": "true",
        "cpi": cpi,
        "enc": enc,
        "start": 0,
    }
    
    path = f"/exam-ans/exam/test/reVersionTestStartNew"
    resp = proxy_get(path, params, session)
    print(f"[FETCH] Status: {resp.status_code}")
    
    # Check for "无权限"
    body = resp.text
    if '无权限' in body:
        print(f"[FETCH] ⛔ 无权限访问! Body snippet: {body[:500]}")
        return None
    
    from bs4 import BeautifulSoup
    html = BeautifulSoup(body, 'lxml')
    
    err = html.select_one("p.blankTips")
    if err:
        print(f"[FETCH] Error: {err.text.strip()}")
        return None
    
    form = html.select_one("form#submitTest")
    if form:
        new_enc = form.select_one("input#enc")
        if new_enc:
            print(f"[FETCH] enc: {new_enc['value']}")
    
    # Count questions
    questions = html.select("div.questionWrap.singleQuesId.ans-cc-exam")
    print(f"[FETCH] Found {len(questions)} questions")
    
    return resp.text

def main():
    sess_info = get_active_session()
    if not sess_info:
        print("FAILED: No active session")
        return
    
    sess, api, acc = sess_info
    print(f"[INFO] Session cookies: {dict(sess.cookies)}")
    
    # Step 1: Get exam cover
    print("\n=== Step 1: Exam Cover ===")
    start_url = examine_exam_cover(sess)
    if not start_url:
        print("FAILED: Could not get exam cover")
        return
    
    # Step 2: Start exam
    print("\n=== Step 2: Start Exam ===")
    enc, body = proxy_start_exam(start_url, sess)
    if enc:
        print(f"\n=== Step 3: Fetch Questions ===")
        questions_html = proxy_fetch_questions(enc, sess)
    else:
        print(f"Body from start: {body[:500]}")
    
    print("\n=== DONE ===")

if __name__ == '__main__':
    main()
