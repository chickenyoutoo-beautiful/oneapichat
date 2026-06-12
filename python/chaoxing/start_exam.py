#!/usr/bin/env python3
"""
服务端启动考试 — 自动登录 → 开始考试 → 获取所有题目
返回 JSON 给 exam_frame.php 渲染
"""
import sys, os, json, argparse, traceback

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--exam-id', required=True, type=int)
    p.add_argument('--course-id', required=True)
    p.add_argument('--class-id', required=True)
    p.add_argument('--cpi', required=True)
    p.add_argument('--enc-task', default='0')
    args = p.parse_args()

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, base_dir)
    os.chdir(sys.path[0])

    from loguru import logger as _lr
    _lr.remove()
    _lr.add(lambda _: None)

    import configparser
    cfg = configparser.ConfigParser()
    cfg.read(os.path.join(base_dir, 'config.ini'), encoding='utf8')
    username = cfg.get('common', 'username', fallback='')
    password = cfg.get('common', 'password', fallback='')

    from chaoxing.base import Chaoxing, Account, init_session
    from chaoxing.exam_auto import ChaoxingExam, ExamAccessDenied, ExamIsCommitted, ExamNotStart
    from chaoxing.answer import Tiku

    acc = Account(username, password)
    api = Chaoxing(account=acc)
    # ★ 先尝试用已有 Cookie（避免重复登录触发验证码）
    s = init_session()
    # 用 cookie session 快速验证课程是否可访问
    try:
        test_courses = api.get_course_list()
        if not test_courses:
            lr = api.login()
            if not lr['status']:
                print(json.dumps({"error": f"登录失败: {lr.get('msg','')}"}))
                return
            s = init_session()
    except Exception:
        lr = api.login()
        if not lr['status']:
            print(json.dumps({"error": f"登录失败: {lr.get('msg','')}"}))
            return
        s = init_session()
    tiku = Tiku()
    try:
        tiku = tiku.get_tiku_from_config()
        tiku.init_tiku()
    except Exception:
        pass

    exam = ChaoxingExam(acc, tiku=tiku, session=s)

    try:
        # 1. 获取元数据
        exam.get_meta(args.exam_id, args.course_id, args.class_id, args.cpi, args.enc_task)
        title = exam.title

        # 2. 开始考试
        first_q = exam.start()
        questions = [first_q]

        # 3. 拉取剩余题目
        try:
            while True:
                idx = len(questions)
                questions.append(exam.fetch(idx))
        except Exception:
            pass

        # 4. 格式化为 JSON
        result = []
        for q in questions:
            result.append({
                "id": q.id,
                "title": q.value,
                "type": q.type.value if hasattr(q.type, 'value') else 0,
                "type_name": q.type.name if hasattr(q.type, 'name') else '未知',
                "options": q.options if isinstance(q.options, str) else 
                    "\n".join([f"{k}. {v}" for k, v in q.options.items()]) if isinstance(q.options, dict) else str(q.options or ''),
            })

        print(json.dumps({
            "success": True,
            "title": title,
            "enc": exam.enc,
            "total": len(result),
            "questions": result,
        }, ensure_ascii=False))

    except ExamAccessDenied as e:
        print(json.dumps({"error": f"需要安全验证: {e}"}))
    except ExamIsCommitted as e:
        print(json.dumps({"error": f"考试已提交: {e}"}))
    except ExamNotStart as e:
        print(json.dumps({"error": f"考试尚未开始: {e}"}))
    except Exception as e:
        print(json.dumps({"error": f"{type(e).__name__}: {str(e)[:100]}"}))

if __name__ == '__main__':
    main()
