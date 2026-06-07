#!/usr/bin/env python3
"""
通过 Python 会话获取超星考试页面（复用已有登录 session）
由 exam_proxy.php 调用，返回修改前的原始 HTML
"""
import sys, os, json, argparse

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--exam-id', required=True)
    p.add_argument('--course-id', required=True)
    p.add_argument('--class-id', required=True)
    p.add_argument('--cpi', required=True)
    args = p.parse_args()

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, base_dir)
    os.chdir(sys.path[0])  # 确保 CWD 正确

    # 抑制日志
    from loguru import logger as _lr
    _lr.remove()
    _lr.add(lambda _: None)

    # 先登录确保有有效 session
    import configparser
    cfg = configparser.ConfigParser()
    cfg.read(os.path.join(base_dir, 'config.ini'), encoding='utf8')
    username = cfg.get('common', 'username', fallback='')
    password = cfg.get('common', 'password', fallback='')

    from chaoxing.base import Chaoxing, Account, init_session
    if username and password:
        acc = Account(username, password)
        api = Chaoxing(account=acc)
        api.login()

    s = init_session()

    url = (f"https://mooc1-api.chaoxing.com/exam-ans/exam/phone/task-exam"
           f"?taskrefId={args.exam_id}&courseId={args.course_id}"
           f"&classId={args.class_id}&cpi={args.cpi}&ut=s")

    resp = s.get(url, headers={
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.6778.135 Mobile Safari/537.36',
    }, timeout=30, allow_redirects=True)

    if resp.status_code == 200:
        print(resp.text)
    else:
        print(f"Error: HTTP {resp.status_code}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
