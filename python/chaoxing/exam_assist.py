#!/usr/bin/env python3
"""
考试助手 — 在本地电脑上运行，用真实浏览器处理验证码
用法:
  python3 exam_assist.py login                  # 登录学习通（保存 cookies）
  python3 exam_assist.py list                   # 列出考试
  python3 exam_assist.py start --exam-id 9459820 # 开考（弹出浏览器，手动过验证码后自动答题）
  
流程:
  1. 自动打开浏览器到考试页面
  2. 你手动勾选同意 + 过拼图验证码
  3. 检测到进入考试后，自动获取题目并搜索答案提交
"""
import sys, os, json, time, argparse, configparser

API_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(API_DIR))

# 抑制日志
from loguru import logger as _lr
_lr.remove()
_lr.add(lambda _: None)

# 按需导入
def _get_api():
    from chaoxing.base import Chaoxing, Account, init_session
    from chaoxing.answer import Tiku
    from chaoxing.exam_auto import ChaoxingExam
    return Chaoxing, Account, init_session, Tiku, ChaoxingExam

CFG_PATH = os.path.join(API_DIR, 'config.ini')

def get_account():
    cfg = configparser.ConfigParser()
    cfg.read(CFG_PATH, encoding='utf8')
    u = cfg.get('common', 'username', fallback='')
    p = cfg.get('common', 'password', fallback='')
    return u, p

def cmd_login(args):
    u, p = get_account()
    if not u or not p:
        print('请先在 config.ini 配置账号密码')
        return
    Chaoxing, Account, init_session, _, _ = _get_api()
    acc = Account(u, p)
    api = Chaoxing(account=acc)
    lr = api.login()
    if lr['status']:
        s = init_session()
        # 保存 cookies 到文件
        cookies = []
        for c in s.cookies:
            cookies.append({'name': c.name, 'value': c.value, 'domain': c.domain, 'path': c.path})
        with open('/tmp/chaoxing_cookies.json', 'w') as f:
            json.dump(cookies, f)
        print(f'✅ 登录成功! cookies 已保存 ({len(cookies)} 个)')
    else:
        print(f'❌ 登录失败: {lr.get("msg", "?")}')

def cmd_list(args):
    u, p = get_account()
    Chaoxing, Account, init_session, _, ChaoxingExam = _get_api()
    acc = Account(u, p)
    api = Chaoxing(account=acc)
    lr = api.login()
    if not lr['status']:
        print(f'登录失败: {lr.get("msg","")}')
        return
    s = init_session()
    from chaoxing.exam_auto import ChaoxingExam
    exam = ChaoxingExam(acc, session=s)
    courses = api.get_course_list()
    all_exams = []
    for course in courses:
        try:
            exams = exam.list_exams(course['courseId'], course['clazzId'], course['cpi'])
            for e in exams:
                e['course_title'] = course['title']
            all_exams.extend(exams)
        except Exception:
            pass
    print(f'\n{"ID":<8} {"课程":<22} {"考试名称":<25} {"状态":<6} 时间')
    print('-' * 100)
    for e in all_exams:
        st = e.get('start_time','') or '-'
        et = e.get('end_time','') or '-'
        tr = f"{st} ~ {et}" if st != '-' else '-'
        print(f"{str(e['exam_id']):<8} {(e.get('course_title','')or'')[:20]:<22} {(e.get('title','')or'')[:23]:<25} {e.get('status','?'):<6} {tr}")
    print(f'\n共 {len(all_exams)} 场')
    print(json.dumps(all_exams, ensure_ascii=False, indent=2))

def cmd_start(args):
    """主流程: 打开浏览器 → 等待手动过验证码 → 自动答题"""
    exam_id = args.exam_id
    if not exam_id:
        print('请指定 --exam-id')
        return
    
    u, p = get_account()
    Chaoxing, Account, init_session, Tiku, ChaoxingExam = _get_api()
    
    # 登录
    acc = Account(u, p)
    api = Chaoxing(account=acc)
    print('登录...')
    lr = api.login()
    if not lr['status']:
        print(f'❌ 登录失败: {lr.get("msg","")}')
        return
    
    s = init_session()
    
    # 获取考试信息
    print('获取考试信息...')
    exam_api = ChaoxingExam(acc, session=s)
    courses = api.get_course_list()
    exam_info = None
    for course in courses:
        try:
            exams = exam_api.list_exams(course['courseId'], course['clazzId'], course['cpi'])
            for e in exams:
                if e['exam_id'] == exam_id:
                    exam_info = e
                    exam_info['course_id'] = course['courseId']
                    exam_info['class_id'] = course['clazzId']
                    exam_info['cpi'] = course['cpi']
                    break
        except Exception:
            pass
        if exam_info: break
    
    if not exam_info:
        print(f'❌ 未找到考试 {exam_id}')
        return
    
    print(f'📝 考试: {exam_info.get("title","")} (状态: {exam_info.get("status","")})')
    
    # 设置题库
    tiku = Tiku()
    try:
        tiku = tiku.get_tiku_from_config()
        tiku.init_tiku()
        print(f'📚 题库: {tiku.name if tiku and hasattr(tiku,"name") else "已配置"}')
    except Exception:
        pass
    
    # 打开 Playwright 浏览器
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('❌ 需要安装 playwright: pip install playwright && playwright install chromium')
        return
    
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,  # 显示浏览器窗口
            args=['--no-sandbox', '--disable-dev-shm-usage'],
        )
        context = browser.new_context(
            viewport={'width': 430, 'height': 932},
            user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.6778.135 Mobile Safari/537.36',
            locale='zh-CN', has_touch=True, is_mobile=True,
        )
        page = context.new_page()
        page.set_default_timeout(60000)
        
        # 反检测
        page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(Event.prototype, 'isTrusted', { get: () => true });
            window.showCXCaptcha = function(cb) {
                if(typeof cb==='function') cb('bypass',Date.now(),'','','','','');
            };
        """)
        
        # 注入 cookies
        cookie_file = '/tmp/chaoxing_cookies.json'
        if os.path.exists(cookie_file):
            with open(cookie_file) as f:
                cookies = json.load(f)
            for c in cookies:
                try:
                    context.add_cookies([c])
                except Exception: pass
        else:
            # 从 session 注入
            for cookie in s.cookies:
                try:
                    context.add_cookies([{
                        'name': cookie.name, 'value': cookie.value,
                        'domain': cookie.domain or '.chaoxing.com',
                        'path': cookie.path or '/',
                    }])
                except Exception: pass
        
        # 打开考试页
        url = (f"https://mooc1-api.chaoxing.com/exam-ans/exam/phone/task-exam"
               f"?taskrefId={exam_id}&courseId={exam_info['course_id']}"
               f"&classId={exam_info['class_id']}&cpi={exam_info['cpi']}"
               f"&ut=s&enc_task={exam_info.get('enc_task', 0)}")
        
        print(f'\n🌐 浏览器已打开，请在浏览器窗口中:')
        print(f'   1. 勾选 "我已阅读并同意"')
        print(f'   2. 点击 "开始考试"')
        print(f'   3. 完成拼图验证码')
        print(f'\n   完成后脚本将自动答题交卷!')
        print(f'   等待中...')
        
        page.goto(url, wait_until='domcontentloaded', timeout=30000)
        page.wait_for_timeout(2000)
        
        # 轮询等待验证码通过
        max_wait = 300  # 最多等 5 分钟
        entered = False
        for i in range(max_wait):
            time.sleep(1)
            try:
                enc = page.evaluate("() => document.getElementById('enc')?.value || ''")
                if enc:
                    entered = True
                    print(f'\n✅ 已进入考试! (等待 {i+1}s)')
                    
                    # 获取额外信息
                    info = page.evaluate("""
                        () => ({
                            enc: document.getElementById('enc')?.value || '',
                            encRemainTime: document.getElementById('encRemainTime')?.value || '0',
                            remainTime: document.getElementById('remainTime')?.value || '0',
                            testUserRelationId: document.getElementById('testUserRelationId')?.value || '',
                        })
                    """)
                    
                    print(f'   enc: {info["enc"][:30]}...')
                    
                    # 开始答题
                    print('拉取题目...')
                    api_exam = ChaoxingExam(acc, session=s)
                    api_exam.exam_id = exam_id
                    api_exam.course_id = exam_info['course_id']
                    api_exam.class_id = exam_info['class_id']
                    api_exam.cpi = exam_info['cpi']
                    api_exam.enc = info['enc']
                    api_exam.enc_remain_time = int(info.get('encRemainTime', 0))
                    api_exam.last_update_time = 0
                    api_exam.exam_answer_id = int(info.get('testUserRelationId', 0))
                    api_exam.enc_task = exam_info.get('enc_task', 0)
                    
                    # 拉取全部题目
                    questions = []
                    try:
                        questions = api_exam.fetch_all()
                    except Exception:
                        pass
                    if not questions:
                        try:
                            questions.append(api_exam.fetch(0))
                            while True:
                                idx = len(questions)
                                questions.append(api_exam.fetch(idx))
                        except Exception:
                            pass
                    
                    print(f'📄 共 {len(questions)} 道题')
                    
                    # 答题
                    answered = 0
                    for idx, q in enumerate(questions):
                        answer = api_exam.search_answer(q)
                        if answer:
                            q.answer = answer
                            print(f'  第{idx+1}题 ✅ 答案: {str(answer)[:40]}')
                        else:
                            print(f'  第{idx+1}题 ⚠️ 未找到答案')
                        try:
                            api_exam.submit(idx, q)
                            answered += 1
                        except Exception as e:
                            print(f'  第{idx+1}题 提交失败: {e}')
                    
                    # 交卷
                    if answered > 0 and questions:
                        try:
                            api_exam.submit(0, questions[0], final=True)
                            print(f'\n✅ 交卷成功! {answered}/{len(questions)}')
                        except Exception as e:
                            print(f'❌ 交卷失败: {e}')
                    
                    break
                
                # 检查是否被重定向或显示错误
                if i % 10 == 0:
                    print(f'  ...等待验证码 ({i+1}s)', end='\r')
                    
            except Exception as e:
                if i % 10 == 0:
                    print(f'  ...页面检测中 ({i+1}s)', end='\r')
        
        if not entered:
            print(f'\n⏰ 等待超时 ({max_wait}s)，未检测到进入考试')
        
        input('\n按 Enter 关闭浏览器...')
        browser.close()

def main():
    p = argparse.ArgumentParser(description='考试助手')
    p.add_argument('action', choices=['login', 'list', 'start'])
    p.add_argument('--exam-id', type=int, default=0)
    args = p.parse_args()
    
    if args.action == 'login': cmd_login(args)
    elif args.action == 'list': cmd_list(args)
    elif args.action == 'start': cmd_start(args)

if __name__ == '__main__':
    main()
