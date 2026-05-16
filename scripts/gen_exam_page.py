#!/usr/bin/env python3
"""Generate manual exam HTML with cookie injection"""
import configparser, requests, re, sys, os
sys.path.insert(0, '/var/www/html/oneapichat')

cfg = configparser.ConfigParser()
cfg.read('/tmp/AutomaticCB/config_u_87ee22f333e5173a71c46dd3.ini', encoding='utf8')
from api.base import Account, Chaoxing, init_session
acc = Account(cfg.get('common','username'), cfg.get('common','password'))
api = Chaoxing(account=acc)
lr = api.login()
s = init_session()

exam_id = sys.argv[1] if len(sys.argv) > 1 else '9459820'
course_id = sys.argv[2] if len(sys.argv) > 2 else '263695114'
class_id = sys.argv[3] if len(sys.argv) > 3 else '146799509'
cpi = sys.argv[4] if len(sys.argv) > 4 else '488376903'

r = s.get('https://mooc1-api.chaoxing.com/exam-ans/exam/phone/task-exam', params={
    'taskrefId': exam_id, 'courseId': course_id,
    'classId': class_id, 'cpi': cpi, 'ut': 's'
})
html = r.text

# Modify HTML
html = re.sub(r'id="appExamClientSign"\s*value="[^"]*"', 'id="appExamClientSign" value="false"', html)
html = re.sub(r'id="chaoXingAppSignVersion"\s*value="[^"]*"', 'id="chaoXingAppSignVersion" value="0"', html)
html = re.sub(r'id="captchaCheck"\s*value="[^"]*"', 'id="captchaCheck" value="0"', html)

# Inject cookies via script before other scripts
cookie_script = '<script>'
for c in s.cookies:
    if c.domain and 'chaoxing' in c.domain:
        dom = c.domain or '.chaoxing.com'
        pth = c.path or '/'
        cookie_script += f"document.cookie='{c.name}={c.value};domain={dom};path={pth}';"
cookie_script += '</script>'

html = html.replace('<head>', f'<head>{cookie_script}')

# Also replace all script src to use absolute URLs
html = html.replace('src="//', 'src="https://')

out = '/var/www/html/oneapichat/manual_exam.html'
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)

print(f'Generated {out} ({len(html)} bytes)')
print('Student:', '周申来' in html)
print('Exam:', '考试名称' in html)
