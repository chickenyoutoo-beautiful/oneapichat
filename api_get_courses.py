#!/usr/bin/env python3
"""获取课程列表（供PHP API调用）并注册到 DB"""
import json, sys, os, argparse, sqlite3

script_dir = '/tmp/AutomaticCB'
os.chdir(script_dir)
os.environ["COLUMNS"] = "120"
sys.path.insert(0, script_dir)
sys.path.insert(0, '/tmp/pylib')

import logging
logging.disable(logging.CRITICAL)

from configparser import ConfigParser
from api.base import Chaoxing, Account

db_path = '/tmp/AutomaticCB/api/learning_records.db'

parser = argparse.ArgumentParser()
parser.add_argument('--user-id', default='')
args = parser.parse_args()
user_id = args.user_id.strip()

config = ConfigParser()
config.read(os.path.join(script_dir, "config.ini"), encoding="utf8")
username = config.get("common", "username", fallback="")
password = config.get("common", "password", fallback="")

account = Account(username, password)
chaoxing = Chaoxing(account=account)
result = chaoxing.login()
if not result["status"]:
    print(json.dumps({"error": result["msg"]}), flush=True)
    sys.exit(1)
courses = chaoxing.get_course_list()
if not isinstance(courses, list):
    print(json.dumps({"error": "获取课程列表失败", "courses": []}), flush=True)
    sys.exit(1)

# 注册课程到 DB（新用户登录后课程自动进入 DB 跟踪）
if user_id:
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        # 确保表和索引存在
        c.execute("""CREATE TABLE IF NOT EXISTS courses (
            id TEXT, user_id TEXT, status TEXT DEFAULT 'not_started',
            completed_videos INTEGER DEFAULT 0,
            completed_works INTEGER DEFAULT 0,
            total_videos INTEGER DEFAULT 0,
            total_works INTEGER DEFAULT 0,
            PRIMARY KEY (id, user_id)
        )""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_courses_user_id ON courses(user_id)")
        conn.commit()
        for course in courses:
            # 统一使用 courseId（不带 c_ 前缀），与 tracker 写入的 ID 保持一致
            cid = course.get('courseId') or course.get('id') or course.get('key')
            # 去掉可能的 c_ 前缀
            if isinstance(cid, str) and cid.startswith('c_'):
                cid = cid[2:]
            if cid:
                c.execute(
                    "INSERT OR IGNORE INTO courses (id, user_id, status) VALUES (?, ?, 'not_started')",
                    (str(cid), user_id)
                )
        conn.commit()
        conn.close()
    except Exception as e:
        # DB 注册失败不影响主流程
        pass

print(json.dumps({"courses": courses}), flush=True)
