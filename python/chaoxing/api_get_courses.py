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
    from chaoxing.config import resolve_user_config
    import shutil

    parser = argparse.ArgumentParser()
    parser.add_argument('--user-id', default='')
    parser.add_argument('--config', default='')
    parser.add_argument('--force-login', action='store_true', help='强制重新登录，不复用旧 Cookie')
    args = parser.parse_args()

    actual_config_path = resolve_user_config(user_id=args.user_id, explicit_path=args.config)

    config = ConfigParser()
    if actual_config_path and os.path.isfile(actual_config_path) and os.path.getsize(actual_config_path) > 0:
        config.read(actual_config_path, encoding='utf8')
        # 尝试自愈运行时镜像（如果 /tmp/AutomaticCB 目录可写且目标不存在）
        if args.user_id:
            runtime_cfg = os.path.join(tempfile.gettempdir(), 'AutomaticCB', f'config_{args.user_id}.ini')
            if not os.path.isfile(runtime_cfg) and os.path.abspath(actual_config_path) != os.path.abspath(runtime_cfg):
                try:
                    os.makedirs(os.path.dirname(runtime_cfg), exist_ok=True)
                    shutil.copyfile(actual_config_path, runtime_cfg)
                except Exception:
                    pass

    if not config.has_section("common"):
        _fail(f"配置文件缺失 [common] 节: {actual_config_path or 'config.ini'} (文件可能为空或损坏)")

    username = config.get("common", "username", fallback="")
    password = config.get("common", "password", fallback="")

    if not username or not password:
        _fail("未配置账号密码，请在设置中填写超星账号和密码")

    account = Account(username, password)
    chaoxing = Chaoxing(account=account)

    # 非强制登录时，优先尝试用已有 Cookie 获取课程（避免重复登录触发验证码）
    if not args.force_login:
        courses = chaoxing.get_course_list()
        if courses is not None and len(courses) > 0:
            print(json.dumps({"courses": courses}), flush=True)
            sys.exit(0)

    # 强制登录或 Cookie 失效，重新登录
    result = chaoxing.login()
    if not result["status"]:
        _fail(result.get("msg", "登录失败"))
    courses = chaoxing.get_course_list()
    if not courses:
        # 登录成功但依然取不到课程：多为风控/验证码/接口异常，明确报错而非静默空列表
        _fail("登录成功但课程列表为空，可能触发验证码或风控，请先用浏览器登录一次超星学习通（https://i.chaoxing.com）再刷新")
    print(json.dumps({"courses": courses}), flush=True)

except SystemExit:
    raise
except Exception as e:
    _fail(f"脚本异常: {str(e)}")
