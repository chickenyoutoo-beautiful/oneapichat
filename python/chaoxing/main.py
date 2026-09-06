# -*- coding: utf-8 -*-
import argparse
import configparser
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from chaoxing.logger import logger
from chaoxing.base import Chaoxing, Account
from chaoxing.exceptions import LoginError, FormatError, JSONDecodeError,MaxRollBackError
from chaoxing.answer import Tiku
from chaoxing.tracker import LearningTracker
from urllib3 import disable_warnings,exceptions
import os
import json
import time

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
        if cli_args.exam:
            # 考试模式：优先按课程列表过滤，若未配置或无匹配则自动使用全部课程
            if course_list:
                course_task = [c for c in all_course if str(c.get("courseId")) in [str(x) for x in course_list]]
            if not course_task:
                course_task = all_course
            _study_mode = False
        elif not course_list:
            if sys.stdin.isatty():
                print("*" * 10 + "课程列表" + "*" * 10)
                for course in all_course:
                    print(f"ID: {course['courseId']} 课程名: {course['title']}")
                print("*" * 28)
                try:
                    course_list = input("请输入想要学习的课程列表,以逗号分隔,例: 2151141,189191,198198\n").split(",")
                except Exception as e:
                    raise FormatError("输入格式错误") from e
            else:
                raise FormatError("配置中未设置课程列表(course_list)，请在刷课页面选择课程后点开始")
        else:
            for course in all_course:
                if str(course.get("courseId")) in [str(x) for x in course_list]:
                    course_task.append(course)
            if not course_task:
                course_task = all_course
        # 开始遍历要学习的课程列表
        logger.info(f"课程列表过滤完毕，当前课程任务数量: {len(course_task)}")
        blocked_course_summaries = []
        # 纯考试模式跳过学习循环
        _study_mode = not cli_args.exam
        for course in course_task:
            # ★ 不再跳过"已完成"课程：课程可能新增内容，需重新检测
            # 章节级别的计数器保护（MIN）和完成条件（AND）已能正确处理
            # 纯考试模式：跳过学习内容
            if not _study_mode:
                continue
            logger.info(f"开始学习课程: {course['title']}")
            tracker.start_course(course['courseId'], course['title'], course.get('teacher', ''))
            # 获取当前课程的所有章节
            point_list = chaoxing.get_course_point(course["courseId"], course["clazzId"], course["cpi"])

            # 为了支持课程任务回滚，采用下标方式遍历任务点
            __point_index = 0
            # 服务端可能需要几秒才把最后一次上报写回任务卡。复核未通过时必须
            # 留在当前章节重试，不能只打印“保持进行中”却递增索引跳到下一章。
            chapter_retry_counts = {}
            max_chapter_retries = 8

            def chapter_retry_delay(retry_count):
                return min(30, 5 * retry_count)

            course_blocked = False
            course_block_reason = ""
            course_blocked_points = []
            while __point_index < len(point_list["points"]):
                point = point_list["points"][__point_index]
                logger.info(f'当前章节: {point["title"]}')
                # 获取当前章节的所有任务点
                jobs = []
                job_info = None
                jobs, job_info = chaoxing.get_job_list(course["clazzId"], course["courseId"], course["cpi"], point["id"])

                chapter_id = f"{course['courseId']}_{job_info.get('knowledgeid', point['id'])}"

                # ★ 不跳过已完成章节：课程可能新增内容，需重新检测
                # 计数器保护见 tracker.py（video_done/work_done 不超 count）
                # ★ video_count 包含 video + audio（音频任务也走 study_video）
                tracker.update_chapter(chapter_id, course['courseId'], point['title'], status='running',
                    video_count=sum(1 for j in jobs if j.get('type') in ('video', 'audio')),
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


                # 空列表只有在任务卡成功解析时才表示该章节已无未完成任务。
                if not jobs:
                    if job_info.get('fetch_ok'):
                        tracker.update_chapter(chapter_id, course['courseId'], point['title'], status='completed')
                        chapter_retry_counts.pop(chapter_id, None)
                        __point_index += 1
                    else:
                        tracker.update_chapter(chapter_id, course['courseId'], point['title'], status='running')
                        retry_count = chapter_retry_counts.get(chapter_id, 0) + 1
                        chapter_retry_counts[chapter_id] = retry_count
                        if retry_count <= max_chapter_retries:
                            retry_delay = chapter_retry_delay(retry_count)
                            logger.warning(
                                f"任务卡解析失败，{retry_delay}秒后重试当前章节 "
                                f"({retry_count}/{max_chapter_retries}): {point['title']}"
                            )
                            time.sleep(retry_delay)
                        else:
                            course_block_reason = f"{point['title']} — 任务卡连续解析失败 {max_chapter_retries} 次"
                            tracker.update_chapter(
                                chapter_id, course['courseId'], point['title'], status='blocked',
                                blocked_reason=course_block_reason,
                            )
                            course_blocked_points.append(course_block_reason)
                            logger.error(
                                f"任务卡连续解析失败，已标记阻塞并继续下一章节: {point['title']}"
                            )
                            chapter_retry_counts.pop(chapter_id, None)
                            __point_index += 1
                    continue
                # 遍历所有任务点
                non_retryable_failures = []
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
                            video_ok = chaoxing.study_video(
                                course, job, job_info, _speed=speed, _type="Video",
                                _resume=chapter_retry_counts.get(chapter_id, 0) == 0,
                            )
                            failure = getattr(chaoxing, 'last_task_failure', None)
                            if not video_ok and failure and not failure.get('retryable', True):
                                non_retryable_failures.append(failure)
                        except JSONDecodeError as e:
                            logger.warning("当前任务非视频任务，正在尝试音频任务解码")
                            isAudio = True
                        if isAudio:
                            try:
                                audio_ok = chaoxing.study_video(
                                    course, job, job_info, _speed=speed, _type="Audio",
                                    _resume=chapter_retry_counts.get(chapter_id, 0) == 0,
                                )
                                failure = getattr(chaoxing, 'last_task_failure', None)
                                if not audio_ok and failure and not failure.get('retryable', True):
                                    non_retryable_failures.append(failure)
                            except JSONDecodeError as e:
                                logger.warning(f"出现异常任务 -> 任务章节: {course['title']} 任务ID: {job['jobid']}, 已跳过")
                    # 文档任务
                    elif job["type"] == "document":
                        logger.trace(f"识别到文档任务, 任务章节: {course['title']} 任务ID: {job['jobid']}")
                        chaoxing.study_document(course, job)
                    # 测验任务
                    elif job["type"] == "workid":
                        logger.trace(f"识别到章节检测任务, 任务章节: {course['title']}")
                        work_ok = chaoxing.study_work(course, job,job_info)
                        failure = getattr(chaoxing, 'last_task_failure', None)
                        if not work_ok and failure and not failure.get('retryable', True):
                            non_retryable_failures.append(failure)
                    # 阅读任务
                    elif job["type"] == "read":
                        logger.trace(f"识别到阅读任务, 任务章节: {course['title']}")
                        chaoxing.strdy_read(course, job,job_info)
                    else:
                        logger.warning(f"暂不支持的任务类型，保留为未完成: {job.get('type')} {job.get('name', '')}")
                # 最终以超星服务端复查为准，不能把“本地遍历结束”当成完成。
                remaining_jobs = jobs
                verify_info = {}
                for _verify_round in range(3):
                    time.sleep(2)
                    remaining_jobs, verify_info = chaoxing.get_job_list(
                        course["clazzId"], course["courseId"], course["cpi"], point["id"])
                    if verify_info.get('fetch_ok') and not remaining_jobs:
                        break
                if verify_info.get('fetch_ok') and not remaining_jobs:
                    tracker.update_chapter(
                        chapter_id, course['courseId'], point['title'], status='completed',
                        video_done=sum(1 for j in jobs if j.get('type') in ('video', 'audio')),
                        work_done=sum(1 for j in jobs if j.get('type') == 'workid'),
                    )
                    logger.info(f"服务器复核通过，章节完成: {point['title']}")
                    chapter_retry_counts.pop(chapter_id, None)
                    __point_index += 1
                else:
                    tracker.update_chapter(chapter_id, course['courseId'], point['title'], status='running')
                    remaining_types = ','.join(j.get('type', '?') for j in remaining_jobs) or '任务卡解析失败'
                    if non_retryable_failures:
                        unique_reasons = []
                        for failure in non_retryable_failures:
                            detail = f"{failure.get('task', '?')}: {failure.get('reason', '不可重试')}"
                            if detail not in unique_reasons:
                                unique_reasons.append(detail)
                        course_block_reason = f"{point['title']} — " + "；".join(unique_reasons)
                        tracker.update_chapter(
                            chapter_id, course['courseId'], point['title'], status='blocked',
                            blocked_reason=course_block_reason,
                        )
                        course_blocked_points.append(course_block_reason)
                        logger.warning(
                            f"当前章节需要人工处理，已标记为阻塞并继续后续章节（不会标记完成）: "
                            f"{course_block_reason}"
                        )
                        chapter_retry_counts.pop(chapter_id, None)
                        __point_index += 1
                        continue
                    retry_count = chapter_retry_counts.get(chapter_id, 0) + 1
                    chapter_retry_counts[chapter_id] = retry_count
                    if retry_count <= max_chapter_retries:
                        retry_delay = chapter_retry_delay(retry_count)
                        logger.warning(
                            f"服务器仍有未完成任务，{retry_delay}秒后重试当前章节，"
                            f"不会跳过 ({retry_count}/{max_chapter_retries}): "
                            f"{point['title']} [{remaining_types}]"
                        )
                        time.sleep(retry_delay)
                        continue
                    course_block_reason = f"{point['title']} [{remaining_types}] 重试{max_chapter_retries}次后仍未通过"
                    tracker.update_chapter(
                        chapter_id, course['courseId'], point['title'], status='blocked',
                        blocked_reason=course_block_reason,
                    )
                    course_blocked_points.append(course_block_reason)
                    logger.error(
                        f"当前章节重试{max_chapter_retries}次后仍未通过，已标记阻塞并继续下一章节: "
                        f"{point['title']} [{remaining_types}]"
                    )
                    chapter_retry_counts.pop(chapter_id, None)
                    __point_index += 1
                    continue
            if course_blocked:
                logger.error(f"课程因未完成章节暂停，请稍后重新开始以从该章节继续复核: {course['title']}")
            if course_blocked_points or course_blocked:
                reasons = list(course_blocked_points)
                if course_blocked and course_block_reason and course_block_reason not in reasons:
                    reasons.append(course_block_reason)
                blocked_course_summaries.append({
                    "course": course['title'],
                    "reason": "；".join(reasons) or "存在未完成章节",
                })
                if course_blocked_points and not course_blocked:
                    logger.warning(
                        f"课程其余章节扫描完成，但保留 {len(course_blocked_points)} 个阻塞任务点: "
                        f"{course['title']}"
                    )
        # ── 考试模式 ──────────────────────────────────
        if cli_args.exam:
            try:
                from chaoxing.exam_auto import ChaoxingExam
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
                        except Exception: pass
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
                        except Exception: pass

                # 逐场执行考试
                for exam_info in _exam_tasks:
                    try:
                        logger.info(f"处理考试: [{exam_info['exam_id']}]")
                        result = None
                        need_browser = False
                        
                        # 先尝试 API 模式
                        try:
                            result = exam_runner.run(
                                exam_id=exam_info['exam_id'],
                                course_id=exam_info['course_id'],
                                class_id=exam_info['class_id'],
                                cpi=exam_info['cpi'],
                                enc_task=exam_info.get('enc_task', 0),
                                auto_submit=auto_submit,
                            )
                        except Exception as api_err:
                            err_msg = str(api_err)
                            if any(k in err_msg for k in ('客户端APP', '安全验证', 'CLIENT_FORM', '无法开始')):
                                logger.info(f"  API 模式失败，自动切换浏览器模式...")
                                need_browser = True
                            else:
                                raise  # 其他错误直接抛出
                        
                        # 如果需要浏览器模式（或命令行指定了 --exam-browser）
                        if need_browser or cli_args.exam_browser:
                            try:
                                logger.info(f"  启动浏览器考试...")
                                from chaoxing.exam_browser import BrowserExam
                                b_exam = BrowserExam(account, tiku=tiku)
                                b_result = b_exam.run(
                                    course_id=exam_info['course_id'],
                                    class_id=exam_info['class_id'],
                                    exam_id=exam_info['exam_id'],
                                    cpi=exam_info['cpi'],
                                    enc_task=exam_info.get('enc_task', 0),
                                    auto_submit=auto_submit,
                                )
                                if b_result.get('submitted'):
                                    result = b_result
                            except Exception as be:
                                logger.warning(f"  浏览器模式失败: {be}")
                        
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
        if blocked_course_summaries:
            logger.warning(f"课程扫描结束：{len(blocked_course_summaries)}门课程仍有阻塞任务，不会标记为全部完成")
            for blocked in blocked_course_summaries:
                logger.warning(f"未完成课程: {blocked['course']} — {blocked['reason']}")
        else:
            logger.info("所有课程学习任务已完成")
    except BaseException as e:
        import traceback
        logger.error(f"错误: {type(e).__name__}: {e}")
        logger.error(traceback.format_exc())
        raise e
