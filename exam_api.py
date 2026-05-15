#!/usr/bin/env python3
"""
OneAPIChat 考试 CLI API
供 PHP 前端调用的考试相关命令
"""
import json
import sys
import os
import argparse

# 确保 api 模块可导入
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from api.base import Chaoxing, Account, init_session
from api.answer import get_tiku_from_config
from api.logger import logger
import logging
logging.disable(logging.CRITICAL)  # Suppress debug logs for API mode


def cmd_list(args):
    """列出指定用户的考试"""
    from api.exam_auto import ChaoxingExam

    # 读取用户配置
    config_path = f"/tmp/AutomaticCB/config_{args.user_id}.ini"
    if not os.path.exists(config_path):
        print(json.dumps({"error": "用户配置不存在"}))
        return

    import configparser
    cfg = configparser.ConfigParser()
    cfg.read(config_path, encoding="utf8")
    username = cfg.get("common", "username", fallback="")
    password = cfg.get("common", "password", fallback="")

    if not username or not password:
        print(json.dumps({"error": "未配置学习通账号"}))
        return

    account = Account(username, password)
    tiku = get_tiku_from_config()

    try:
        api = Chaoxing(account=account, tiku=tiku)
        login_result = api.login()
        if not login_result["status"]:
            print(json.dumps({"error": f"登录失败: {login_result.get('msg', '?')}"}))
            return

        courses = api.get_course_list()
        exam_runner = ChaoxingExam(account, tiku=tiku)
        all_exams = []

        for course in courses:
            try:
                exams = exam_runner.list_exams(
                    course["courseId"], course["clazzId"], course["cpi"]
                )
                for e in exams:
                    e["course_title"] = course["title"]
                    e["course_id"] = course["courseId"]
                    e["class_id"] = course["clazzId"]
                    e["cpi"] = course["cpi"]
                all_exams.extend(exams)
            except Exception as e:
                logger.warning(f"课程 {course['title']} 获取考试失败: {e}")

        print(json.dumps({"exams": all_exams, "total": len(all_exams)}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


def main():
    parser = argparse.ArgumentParser(description="OneAPIChat 考试工具")
    parser.add_argument("command", choices=["list", "run", "status"])
    parser.add_argument("--user-id", default="", help="用户ID")
    parser.add_argument("--exam-id", type=int, default=0, help="考试ID")
    parser.add_argument("--course-id", default="", help="课程ID")
    parser.add_argument("--class-id", default="", help="班级ID")
    parser.add_argument("--cpi", type=int, default=0, help="CPI")
    parser.add_argument("--enc-task", type=int, default=0, help="enc_task")
    parser.add_argument("--auto-submit", action="store_true", default=True, help="自动提交")
    parser.add_argument("--no-submit", action="store_true", help="不自动提交")
    args = parser.parse_args()

    if args.command == "list":
        cmd_list(args)
    else:
        print(json.dumps({"error": f"命令 {args.command} 未实现"}))


if __name__ == "__main__":
    main()
