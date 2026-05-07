#!/usr/bin/env python3
"""获取课程列表（供PHP API调用）"""
import json, sys, os

# 切换到脚本所在目录运行
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

os.environ["COLUMNS"] = "120"
sys.path.insert(0, script_dir)

import logging
logging.disable(logging.CRITICAL)

from configparser import ConfigParser
from api.base import Chaoxing, Account

config = ConfigParser()
config.read(os.path.join(script_dir, "config.ini"), encoding="utf8")
username = config.get("common", "username")
password = config.get("common", "password")

account = Account(username, password)
chaoxing = Chaoxing(account=account)
result = chaoxing.login()
if not result["status"]:
    print(json.dumps({"error": result["msg"]}), flush=True)
    sys.exit(1)
courses = chaoxing.get_course_list()
print(json.dumps({"courses": courses}), flush=True)
