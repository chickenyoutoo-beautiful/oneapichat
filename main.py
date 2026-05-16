# -*- coding: utf-8 -*-
import argparse
import configparser
from api.logger import logger
from api.base import Chaoxing, Account
from api.exceptions import LoginError, FormatError, JSONDecodeError,MaxRollBackError
from api.answer import Tiku
from api.tracker import LearningTracker
from urllib3 import disable_warnings,exceptions
import os
import json

# # 定义全局变量，用于存储配置文件路径
# textPath = './resource/BookID.txt'

# # 获取文本 -> 用于查看学习过的课程ID
# def getText():
#     try: 
#         if not os.path.exists(textPath):
#             with open(textPath, 'x') as file: pass 
#             return []
#         with open(textPath, 'r', encoding='utf-8') as file: content = file.read().split(',')
#         content = {int(item.strip()) for item in content if item.strip()}
#         return list(content)
#     except Exception as e: logger.error(f"获取文本失败: {e}"); return []

# # 追加文本 -> 用于记录学习过的课程ID
# def appendText(text):
#     if not os.path.exists(textPath): return
#     with open(textPath, 'a', encoding='utf-8') as file: file.write(f'{text}, ') 
    

# 关闭警告
disable_warnings(exceptions.InsecureRequestWarning)

def init_config():
    parser = argparse.ArgumentParser(description='Samueli924/chaoxing')  # 命令行传参
    parser.add_argument("-c", "--config", type=str, default=None, help="使用配置文件运行程序")
    parser.add_argument("-u", "--username", type=str, default=None, help="手机号账号")
    parser.add_argument("-p", "--password", type=str, default=None, help="登录密码")
    parser.add_argument("-l", "--list", type=str, default=None, help="要学习的课程ID列表")
    parser.add_argument("-s", "--speed", type=float, default=2.0, help="视频播放倍速(默认1，最大2)")
    parser.add_argument("--exam", action="store_true", help="考试模式：自动完成课程考试")
    parser.add_argument("--exam-no-submit", action="store_true", help="考试模式：搜题但不自动提交")
    parser.add_argument("--exam-ids", type=str, default=None, help="考试模式：仅处理指定考试ID（逗号分隔）")
    parser.add_argument("--exam-json", type=str, default=None, help="考试模式：从JSON文件读取考试列表直接处理")
    parser.add_argument("--exam-browser", action="store_true", help="考试模式：使用无头浏览器（需要 playwright，有 CLIENT_FORM_SIGN 的考试用）")
    args = parser.parse_args()
    if args.config:
        config = configparser.ConfigParser()
        config.read(args.config, encoding="utf8")
        return (args, config.get("common", "username"),
                config.get("common", "password"),
                str(config.get("common", "course_list")).split(",") if config.get("common", "course_list") else None,
                int(config.get("common", "speed")),
                config['tiku']
                )
    else:
        return (args, args.username, args.password, args.list.split(",") if args.list else None, int(args.speed) if args.speed else 1,None)

class RollBackManager:
    def __init__(self) -> None:
        self.rollback_times = 0
        self.rollback_id = ""

    def add_times(self,id:str) -> None:
        if id == self.rollback_id and self.rollback_times == 3:
            raise MaxRollBackError("回滚次数已达3次，请手动检查学习通任务点完成情况")
        elif id != self.rollback_id:
            # 新job
            self.rollback_id = id
            self.rollback_times = 1
        else:  
            self.rollback_times += 1


if __name__ == '__main__':
    try:
        # 避免异常的无限回滚
        RB = RollBackManager()
        # 初始化登录信息
        cli_args, username, password, course_list, speed, tiku_config = init_config()
        # 规范化播放速度的输入值
        speed = min(2.0, max(1.0, speed))
        if (not username) or (not password):
            username = input("请输入你的手机号，按回车确认\n手机号:")
            password = input("请输入你的密码，按回车确认\n密码:")
        account = Account(username, password)
        # 设置题库
        tiku = Tiku()
        tiku.config_set(tiku_config)    # 载入配置
        tiku = tiku.get_tiku_from_config()  # 载入题库
        tiku.init_tiku()    # 初始化题库
        # 实例化超星API
        user_id = os.environ.get("CHAOXING_USER_ID", username or "unknown")
        tracker = LearningTracker(user_id=user_id, phone=username)  # phone 用于跨账号共享数据
        chaoxing = Chaoxing(account=account,tiku=tiku,tracker=tracker)
        # 检查当前登录状态，并检查账号密码
        _login_state = chaoxing.login()
        if not _login_state["status"]:
            raise LoginError(_login_state["msg"])
        # 获取所有的课程列表
        all_course = chaoxing.get_course_list()
        course_task = []
        # 手动输入要学习的课程ID列表（考试模式跳过交互）
        if not course_list:
            if cli_args.exam:
                # 考试模式：直接使用全部课程，不阻塞等待输入
                course_task = all_course
                _study_mode = False
                # 直接跳到考试部分
            else:
                print("*" * 10 + "课程列表" + "*" * 10)
                for course in all_course:
                    print(f"ID: {course['courseId']} 课程名: {course['title']}")
                print("*" * 28)
                try:
                    course_list = input("请输入想要学习的课程列表,以逗号分隔,例: 2151141,189191,198198\n").split(",")
                except Exception as e:
                    raise FormatError("输入格式错误") from e
        # 筛选需要学习的课程（考试模式下 course_task 已直接设为 all_course）
        if not cli_args.exam:
            for course in all_course:
                if course["courseId"] in course_list:
                    course_task.append(course)
            if not course_task:
                course_task = all_course
        # 开始遍历要学习的课程列表
        logger.info(f"课程列表过滤完毕，当前课程任务数量: {len(course_task)}")
        # 纯考试模式跳过学习循环
        _study_mode = not cli_args.exam
        for course in course_task:
            # 检查课程是否已完成，完成则跳过避免卡死
            existing_status = tracker.conn.execute(
                "SELECT status FROM courses WHERE id=? AND user_id=?",
                (course['courseId'], user_id)
            ).fetchone()
            if existing_status and existing_status[0] == 'completed':
                logger.info(f"课程 {course['title']} 已完成，跳过")
                continue
            # 纯考试模式：跳过学习内容
            if not _study_mode:
                continue
            logger.info(f"开始学习课程: {course['title']}")
            tracker.start_course(course['courseId'], course['title'], course.get('teacher', ''))
            # 获取当前课程的所有章节
            point_list = chaoxing.get_course_point(course["courseId"], course["clazzId"], course["cpi"])

            # 为了支持课程任务回滚，采用下标方式遍历任务点
            __point_index = 0
            while __point_index < len(point_list["points"]):
                point = point_list["points"][__point_index]
                logger.info(f'当前章节: {point["title"]}')
                # 获取当前章节的所有任务点
                jobs = []
                job_info = None
                jobs, job_info = chaoxing.get_job_list(course["clazzId"], course["courseId"], course["cpi"], point["id"])
                
                chapter_id = f"{course['courseId']}_{job_info.get('knowledgeid', point['id'])}"
                tracker.update_chapter(chapter_id, course['courseId'], point['title'], status='running',
                    video_count=sum(1 for j in jobs if j.get('type')=='video'),
                    work_count=sum(1 for j in jobs if j.get('type')=='workid'))
                
                # bookID = job_info["knowledgeid"] # 获取视频ID
                
                # 发现未开放章节，尝试回滚上一个任务重新完成一次
                try:
                    if job_info.get('notOpen',False):
                        __point_index -= 1  # 默认第一个任务总是开放的
                        # 针对题库启用情况
                        if not tiku or tiku.DISABLE or not tiku.SUBMIT:
                            # 未启用题库或未开启题库提交，章节检测未完成会导致无法开始下一章，直接退出
                            logger.error(f"章节未开启，可能由于上一章节的章节检测未完成，请手动完成并提交再重试，或者开启题库并启用提交")
                            break
                        RB.add_times(point["id"])
                        continue
                except MaxRollBackError as e:
                    logger.error("回滚次数已达3次，请手动检查学习通任务点完成情况")
                    # 跳过该课程，继续下一课程
                    break


                # 可能存在章节无任何内容的情况
                if not jobs:
                    __point_index += 1
                    continue
                # 遍历所有任务点
                for job in jobs:
                    # 视频任务
                    if job["type"] == "video":
                        # TODO: 目前这个记录功能还不够完善，中途退出的课程ID也会被记录
                        # TextBookID = getText() # 获取学习过的课程ID
                        # if TextBookID.count(bookID) > 0: 
                        #     logger.info(f"课程: {course['title']} 章节: {point['title']} 任务: {job['title']} 已学习过或在学习中，跳过") # 如果已经学习过该课程，则跳过
                        #     break # 如果已经学习过该课程，则跳过
                        # appendText(bookID) # 记录正在学习的课程ID

                        logger.trace(f"识别到视频任务, 任务章节: {course['title']} 任务ID: {job['jobid']}")
                        # 超星的接口没有返回当前任务是否为Audio音频任务
                        isAudio = False
                        try:
                            chaoxing.study_video(course, job, job_info, _speed=speed, _type="Video")
                        except JSONDecodeError as e:
                            logger.warning("当前任务非视频任务，正在尝试音频任务解码")
                            isAudio = True
                        if isAudio:
                            try:
                                chaoxing.study_video(course, job, job_info, _speed=speed, _type="Audio")
                            except JSONDecodeError as e:
                                logger.warning(f"出现异常任务 -> 任务章节: {course['title']} 任务ID: {job['jobid']}, 已跳过")
                    # 文档任务
                    elif job["type"] == "document":
                        logger.trace(f"识别到文档任务, 任务章节: {course['title']} 任务ID: {job['jobid']}")
                        chaoxing.study_document(course, job)
                    # 测验任务
                    elif job["type"] == "workid":
                        logger.trace(f"识别到章节检测任务, 任务章节: {course['title']}")
                        chaoxing.study_work(course, job,job_info)
                    # 阅读任务
                    elif job["type"] == "read":
                        logger.trace(f"识别到阅读任务, 任务章节: {course['title']}")
                        chaoxing.strdy_read(course, job,job_info)
                __point_index += 1
        # ── 考试模式 ──────────────────────────────────
        if cli_args.exam:
            try:
                from api.exam_auto import ChaoxingExam
                exam_runner = ChaoxingExam(account, tiku=tiku)
                auto_submit = not cli_args.exam_no_submit

                # 收集要处理的考试
                _exam_tasks = []
                if cli_args.exam_json and os.path.exists(cli_args.exam_json):
                    # 从 JSON 文件直接读取选中的考试信息
                    with open(cli_args.exam_json, 'r', encoding='utf8') as f:
                        _exam_tasks = json.load(f)
                    logger.info(f"直接处理选中的 {len(_exam_tasks)} 场考试")
                elif cli_args.exam_ids:
                    # 兼容旧方式：按 exam_ids 从所有课程中搜索
                    selected_exam_ids = set()
                    for eid in cli_args.exam_ids.split(','):
                        eid = eid.strip()
                        if eid.isdigit():
                            selected_exam_ids.add(int(eid))
                    logger.info(f"搜索指定考试: {selected_exam_ids}")
                    for course in all_course:
                        try:
                            exams = exam_runner.list_exams(course['courseId'], course['clazzId'], course['cpi'])
                            for e in exams:
                                if e['exam_id'] in selected_exam_ids and e.get('status') not in ('已完成', '已交'):
                                    _exam_tasks.append({
                                        'exam_id': e['exam_id'],
                                        'course_id': e['course_id'],
                                        'class_id': e['class_id'],
                                        'cpi': e['cpi'],
                                        'enc_task': e.get('enc_task', 0),
                                    })
                        except: pass
                else:
                    # 无选择：遍历所有课程
                    for course in all_course:
                        try:
                            exams = exam_runner.list_exams(course['courseId'], course['clazzId'], course['cpi'])
                            for e in exams:
                                if e.get('status') not in ('已完成', '已交'):
                                    _exam_tasks.append({
                                        'exam_id': e['exam_id'],
                                        'course_id': e['course_id'],
                                        'class_id': e['class_id'],
                                        'cpi': e['cpi'],
                                        'enc_task': e.get('enc_task', 0),
                                    })
                        except: pass

                # 逐场执行考试
                for exam_info in _exam_tasks:
                    try:
                        logger.info(f"处理考试: [{exam_info['exam_id']}]")
                        # 先尝试 API 模式
                        if not cli_args.exam_browser:
                            result = exam_runner.run(
                                exam_id=exam_info['exam_id'],
                                course_id=exam_info['course_id'],
                                class_id=exam_info['class_id'],
                                cpi=exam_info['cpi'],
                                enc_task=exam_info.get('enc_task', 0),
                                auto_submit=auto_submit,
                            )
                        else:
                            result = None
                        # 如果没有提交（包括 API 模式返回 None 或异常），尝试浏览器模式
                        if not result or not result.get('submitted'):
                            if cli_args.exam_browser or (
                                result and '可能需要客户端' in str(result.get('_error', ''))):
                                logger.info(f"  尝试浏览器模式...")
                                try:
                                    from api.exam_browser import BrowserExam
                                    b_exam = BrowserExam(account, tiku=tiku)
                                    b_result = b_exam.run(
                                        course_id=exam_info['course_id'],
                                        class_id=exam_info['class_id'],
                                        exam_id=exam_info['exam_id'],
                                        cpi=exam_info['cpi'],
                                        enc_task=exam_info.get('enc_task', 0),
                                        auto_submit=auto_submit,
                                    )
                                    result = b_result if b_result.get('submitted') else result
                                except Exception as be:
                                    logger.warning(f"  浏览器模式也失败: {be}")
                        if result and result.get('submitted'):
                            logger.info(f"  ✅ 考试 {result.get('title', '?')} 已完成并交卷")
                        elif result:
                            logger.info(f"  ⚠️ 考试 {result.get('title', '?')} 处理结果: {result['answered']}/{result['total']} 题已答")
                    except Exception as e:
                        err_type = type(e).__name__
                        logger.warning(f"  ⛔ 考试 [{exam_info.get('exam_id', '?')}] 处理异常: {err_type}: {e}")
                        continue
            except Exception as e:
                logger.warning(f"考试模式初始化失败: {e}")
        logger.info("所有课程学习任务已完成")
    except BaseException as e:
        import traceback
        logger.error(f"错误: {type(e).__name__}: {e}")
        logger.error(traceback.format_exc())
        raise e