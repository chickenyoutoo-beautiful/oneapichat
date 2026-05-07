#!/usr/bin/env python3
"""获取课程列表（供PHP API调用）"""
import json, sys, os, argparse

# 切换到脚本所在目录运行
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

os.environ["COLUMNS"] = "120"
sys.path.insert(0, script_dir)

import logging
logging.disable(logging.CRITICAL)

from configparser import ConfigParser
from api.base import Chaoxing, Account

parser = argparse.ArgumentParser()
parser.add_argument('--user-id', default='')
args = parser.parse_args()

# 优先用用户级 config（/tmp/AutomaticCB/config_u_<hash>.ini）
# 如果不存在则降级到共享 config.ini
if args.user_id:
    user_config_path = f'/tmp/AutomaticCB/config_{args.user_id}.ini'
else:
    user_config_path = None

config = ConfigParser()
if user_config_path and os.path.exists(user_config_path):
    config.read(user_config_path, encoding='utf8')
else:
    config.read(os.path.join(script_dir, 'config.ini'), encoding='utf8')

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
