#!/usr/bin/env python3
"""调试：完整查看 start 后返回的 HTML 内容"""
import sys, os, json, re

API_DIR = '/var/www/html/oneapichat'
sys.path.insert(0, API_DIR)

exam_id = "9459820"
course_id = "263695114"
class_id = "146799509"
cpi = "488376903"
enc_task = "dfb69177e925652bc5cef2630350b1c1"

import configparser
cfg = configparser.ConfigParser()
cfg.read('/tmp/AutomaticCB/config_u_87ee22f333e5173a71c46dd3.ini', encoding='utf8')

from api.base import Chaoxing, Account, init_session
acc = Account(cfg.get('common','username'), cfg.get('common','password'))
api = Chaoxing(account=acc)
lr = api.login()
print(f"Login: {lr['status']}")
sess = init_session()

# Step 1: Get cover page to get testUserRelationId
resp = sess.get(
    "https://mooc1-api.chaoxing.com/exam-ans/exam/phone/task-exam",
    params={
        "redo": 1, "taskrefId": exam_id,
        "courseId": course_id, "classId": class_id,
        "userId": sess.cookies.get('_uid', ''),
        "role": "", "source": 0,
        "enc_task": enc_task, "cpi": cpi,
        "vx": 0, "examsignal": 1,
    }, allow_redirects=False, timeout=15
)
print(f"Cover: {resp.status_code}")

from bs4 import BeautifulSoup
html = BeautifulSoup(resp.text, 'lxml')
test_uid = html.select_one("input#testUserRelationId")['value']
print(f"testUserRelationId: {test_uid}")

# Step 2: Call start API
resp2 = sess.get(
    "https://mooc1-api.chaoxing.com/exam-ans/exam/phone/start",
    params={
        "courseId": course_id, "classId": class_id,
        "examId": exam_id, "source": 0,
        "examAnswerId": test_uid, "cpi": cpi,
        "keyboardDisplayRequiresUserAction": 1,
        "imei": "86" + "".join(__import__('random').choices('0123456789', k=13)),
        "faceDetection": 0, "jt": 0,
        "code": "", "vx": 0, "examsignal": 1,
        "userId": sess.cookies.get('_uid', ''),
        "enc_task": enc_task,
    }, allow_redirects=False, timeout=15
)
print(f"Start: {resp2.status_code}")
print(f"Start headers: {dict(resp2.headers)}")

html2 = BeautifulSoup(resp2.text, 'lxml')

# Check for enc
enc_elem = html2.select_one("input#enc")
if enc_elem:
    print(f"\n✅ enc found: {enc_elem['value']}")
else:
    print("\n❌ No enc found")
    
# Check for hidden inputs
for inp in html2.select("input[type='hidden']"):
    name = inp.get('id', inp.get('name', '?'))
    val = inp.get('value', '')
    print(f"  hidden #{name}: {val[:60]}")

# Check form
form = html2.select_one("form#submitTest")
if form:
    print(f"\nForm exists")
    for inp in form.select("input"):
        name = inp.get('name', inp.get('id', '?'))
        val = inp.get('value', '')
        print(f"  form input: {name}={val[:80]}")

# Check questions
questions = html2.select("div.questionWrap.singleQuesId.ans-cc-exam")
print(f"\nQuestions found: {len(questions)}")

# Check for error
err = html2.select_one("p.blankTips,li.msg,h2.color6")
if err:
    print(f"Error: {err.text.strip()}")

# Also try fetching directly
print("\n=== Trying reVersionTestStartNew directly ===")
resp3 = sess.get(
    "https://mooc1-api.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew",
    params={
        "courseId": course_id, "classId": class_id,
        "tId": exam_id, "id": test_uid,
        "source": 0, "p": 1, "isphone": "true",
        "cpi": cpi,
        "enc": "",
        "start": 0,
    }, timeout=15
)
print(f"reVersion: {resp3.status_code}")
body3 = resp3.text
if "无权限" in body3:
    print("❌ 无权限访问!")
    # Extract the error context
    idx = body3.find("无权限")
    print(f"  Context: {body3[max(0,idx-100):idx+200]}")
elif "enc" in body3:
    m = re.search(r'id="enc"[^>]*value="([^"]*)"', body3)
    if m:
        print(f"✅ enc: {m.group(1)}")
else:
    print(f"  Body snippet: {body3[:500]}")

# Save full responses for inspection
with open('/tmp/exam_start_response.html', 'w') as f:
    f.write(resp2.text)
with open('/tmp/exam_reversion_response.html', 'w') as f:
    f.write(resp3.text)
print("\nSaved responses to /tmp/exam_*_response.html")
