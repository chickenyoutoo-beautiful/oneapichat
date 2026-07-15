#!/usr/bin/env python3
"""获取课程列表（供PHP API调用）"""
import json, sys, os, argparse, tempfile

def _fail(msg: str):
    """输出错误并退出（确保 PHP 能解析到 error）"""
    print(json.dumps({"error": msg}), flush=True)
    sys.exit(1)

# 不切换目录，保持 PHP cd 到的 /tmp/AutomaticCB/ 作为工作目录
# (/tmp/AutomaticCB/ 有 config.ini 和 cookies.txt 等运行时文件)
script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # /var/www/html/oneapichat/python/
os.environ["COLUMNS"] = "120"
# 确保 chaoxing 模块可导入（python/ + /tmp/AutomaticCB/ 都加入路径）
sys.path.insert(0, os.path.join(tempfile.gettempdir(), 'AutomaticCB'))
sys.path.insert(0, script_dir)

import logging
logging.disable(logging.CRITICAL)

try:
    from configparser import ConfigParser
    from chaoxing.base import Chaoxing, Account

    parser = argparse.ArgumentParser()
    parser.add_argument('--user-id', default='')
    args = parser.parse_args()

    # 优先用用户级 config（/tmp/AutomaticCB/config_<hash>.ini）
    # 如果不存在或为空则降级到共享 config.ini
    if args.user_id:
        user_config_path = os.path.join(tempfile.gettempdir(), 'AutomaticCB', f'config_{args.user_id}.ini')
    else:
        user_config_path = None

    config = ConfigParser()
    if user_config_path and os.path.exists(user_config_path) and os.path.getsize(user_config_path) > 0:
        config.read(user_config_path, encoding='utf8')
    else:
        config.read(os.path.join(script_dir, 'config.ini'), encoding='utf8')

    if not config.has_section("common"):
        _fail(f"配置文件缺失 [common] 节: {user_config_path or 'config.ini'} (文件可能为空或损坏)")

    username = config.get("common", "username", fallback="")
    password = config.get("common", "password", fallback="")

    if not username or not password:
        _fail("未配置账号密码，请在设置中填写超星账号和密码")

    account = Account(username, password)
    chaoxing = Chaoxing(account=account)

    # ★ 先尝试用已有 Cookie 获取课程（避免重复登录触发验证码）
    courses = chaoxing.get_course_list()
    if courses is not None and len(courses) > 0:
        print(json.dumps({"courses": courses}), flush=True)
        sys.exit(0)

    # Cookie 失效，重新登录
    result = chaoxing.login()
    if not result["status"]:
        _fail(result.get("msg", "登录失败"))
    courses = chaoxing.get_course_list()
    print(json.dumps({"courses": courses}), flush=True)

except SystemExit:
    raise
except Exception as e:
    _fail(f"脚本异常: {str(e)}")
