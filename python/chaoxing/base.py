# -*- coding: utf-8 -*-
import re
import time
import random
import requests
from hashlib import md5
from requests.adapters import HTTPAdapter

from chaoxing.cipher import AESCipher
from chaoxing.logger import logger
from chaoxing.cookies import save_cookies, use_cookies
from chaoxing.process import show_progress
from chaoxing.config import GlobalConst as gc
from chaoxing.decode import (decode_course_list,
                        decode_course_point,
                        decode_course_card,
                        decode_course_folder,
                        decode_questions_info
                        )
from chaoxing.answer import *

def get_timestamp():
    return str(int(time.time() * 1000))


def get_random_seconds():
    return random.randint(30, 90)


_cached_session = None

def init_session(isVideo: bool = False, isAudio: bool = False):
    global _cached_session
    # Video/Audio sessions get fresh instances each time
    if isVideo or isAudio:
        _session = requests.session()
        _session.verify = True
        _session.mount('http://', HTTPAdapter(max_retries=3))
        _session.mount('https://', HTTPAdapter(max_retries=3))
        _session.headers = gc.VIDEO_HEADERS if isVideo else gc.AUDIO_HEADERS
        _session.cookies.update(use_cookies())
        return _session
    # Default session: cache for reuse (keeps auth cookies)
    if _cached_session is None:
        _cached_session = requests.session()
        _cached_session.verify = True
        _cached_session.mount('http://', HTTPAdapter(max_retries=3))
        _cached_session.mount('https://', HTTPAdapter(max_retries=3))
        _cached_session.headers = gc.HEADERS
        _cached_session.cookies.update(use_cookies())
    else:
        # ★ 磁盘 Cookie 可能被本进程 login()/其他进程(扫码登录等)更新，每次合并最新文件 Cookie
        #   (同名 Cookie 覆盖，异名保留，安全幂等)
        _cached_session.cookies.update(use_cookies())
    return _cached_session


class Account:
    username = None
    password = None
    last_login = None
    isSuccess = None
    def __init__(self, _username, _password):
        self.username = _username
        self.password = _password


class Chaoxing:
    def __init__(self, account: Account = None,tiku:Tiku=None, tracker=None):
        self.account = account
        self.cipher = AESCipher()
        self.tiku = tiku
        self._tracker = tracker
        self.last_task_failure = None

    def login(self, captcha_token=None):
        _session = requests.session()
        _session.verify = True
        _url = "https://passport2.chaoxing.com/fanyalogin"
        _data = {"fid": "-1",
                    "uname": self.cipher.encrypt(self.account.username),
                    "password": self.cipher.encrypt(self.account.password),
                    "refer": "https%3A%2F%2Fi.chaoxing.com",
                    "t": True,
                    "forbidotherlogin": 0,
                    "validate": captcha_token or "",
                    "doubleFactorLogin": 0,
                    "independentId": 0,
                }

        logger.trace("正在尝试登录...")
        resp = _session.post(_url, headers=gc.HEADERS, data=_data)
        if resp and resp.json()["status"] == True:
            save_cookies(_session)
            # ★ 失效缓存的默认 session：否则后续 init_session() 仍返回持有旧 Cookie 的 session，
            #   导致「登录成功但课程列表依然为空」的假象（Cookie 已更新到磁盘但缓存 session 不感知）
            global _cached_session
            _cached_session = None
            logger.info("登录成功...")
            return {"status": True, "msg": "登录成功"}
        else:
            msg2 = str(resp.json().get("msg2", ""))
            # ★ 检测是否需要验证码 — 超星有时把验证码缺失伪装成"密码错误"
            if "密码错误" in msg2 or "用户名或密码" in msg2:
                # 二次确认：不带加密检查是否需要验证码
                try:
                    check_url = "https://passport2.chaoxing.com/fanyalogin?uname=" + self.account.username
                    check_resp = _session.get(check_url, headers=gc.HEADERS, timeout=5)
                    if "needCaptcha" in check_resp.text or "captcha" in check_resp.text.lower():
                        return {"status": False, "msg": "需要验证码，请先通过浏览器登录一次超星学习通（https://i.chaoxing.com），登录后Cookie会自动同步。或使用手机验证码登录。"}
                except Exception:
                    pass
            return {"status": False, "msg": msg2}

    def get_fid(self):
        _session = init_session()
        return _session.cookies.get("fid")

    def get_uid(self):
        _session = init_session()
        return _session.cookies.get("_uid")

    def get_course_list(self):
        _session = init_session()
        _url = "https://mooc2-ans.chaoxing.com/mooc2-ans/visit/courselistdata"
        _data = {
            "courseType": 1,
            "courseFolderId": 0,
            "query": "",
            "superstarClass": 0
        }
        logger.trace("正在读取所有的课程列表...")
        # 接口突然抽风，增加headers
        _headers = {
            "Host": "mooc2-ans.chaoxing.com",
            "sec-ch-ua-platform": "\"Windows\"",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
            "Accept": "text/html, */*; q=0.01",
            "sec-ch-ua": "\"Microsoft Edge\";v=\"129\", \"Not=A?Brand\";v=\"8\", \"Chromium\";v=\"129\"",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "sec-ch-ua-mobile": "?0",
            "Origin": "https://mooc2-ans.chaoxing.com",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "empty",
            "Referer": "https://mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction?moocDomain=https://mooc1-1.chaoxing.com/mooc-ans",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6,ja;q=0.5"
        }
        _resp = _session.post(_url,headers=_headers,data=_data)
        # logger.trace(f"原始课程列表内容:\n{_resp.text}")
        logger.info("课程列表读取完毕...")
        course_list = decode_course_list(_resp.text)

        _interaction_url = "https://mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction"
        _interaction_resp = _session.get(_interaction_url)
        course_folder = decode_course_folder(_interaction_resp.text)
        for folder in course_folder:
            _data = {
                "courseType": 1,
                "courseFolderId": folder["id"],
                "query": "",
                "superstarClass": 0
            }
            _resp = _session.post(_url, data=_data)
            course_list += decode_course_list(_resp.text)
        return course_list

    def get_course_point(self, _courseid, _clazzid, _cpi):
        _session = init_session()
        _url = f"https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid={_courseid}&clazzid={_clazzid}&cpi={_cpi}&ut=s"
        logger.trace("开始读取课程所有章节...")
        _resp = _session.get(_url)
        # logger.trace(f"原始章节列表内容:\n{_resp.text}")
        logger.info("课程章节读取成功...")
        return decode_course_point(_resp.text)

    def get_job_list(self, _clazzid, _courseid, _cpi, _knowledgeid):
        _session = init_session()
        job_list = []
        job_info = {"fetch_ok": False, "cards_scanned": 0}
        empty_after_valid = 0
        seen_card_ids = set()
        # 任务卡并不固定只有 3 张。逐张探测，连续两张无法解析后停止；
        # 上限 12 防止接口异常造成无限请求。
        for _possible_num in map(str, range(12)):
            _url = f"https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?clazzid={_clazzid}&courseid={_courseid}&knowledgeid={_knowledgeid}&num={_possible_num}&ut=s&cpi={_cpi}&v=20160407-3&mooc2=1"
            logger.trace("开始读取章节所有任务点...")
            _resp = _session.get(_url)
            _job_list, _job_info = decode_course_card(_resp.text)
            if _job_info.get('notOpen',False):
                # 直接返回，节省一次请求
                logger.info("该章节未开放")
                return [], _job_info
            if not _job_info.get('fetch_ok', False):
                empty_after_valid += 1
                if job_info.get('fetch_ok') and empty_after_valid >= 2:
                    break
                continue
            if _job_info.get('empty_card'):
                # 第一张卡就是空页时，它代表一个合法的无任务章节；已有有效卡
                # 后再遇到空页时，它只代表卡片列表结束，不能覆盖前一张元数据。
                if not job_info.get('fetch_ok'):
                    job_info.update(_job_info)
                    job_info['fetch_ok'] = True
                    job_info['cards_scanned'] = 1
                break
            card_id = str(_job_info.get('cardid', ''))
            if card_id and card_id in seen_card_ids:
                break
            if card_id:
                seen_card_ids.add(card_id)
            empty_after_valid = 0
            job_list += _job_list
            cards_scanned = int(job_info.get('cards_scanned', 0)) + 1
            job_info.update(_job_info)
            job_info['fetch_ok'] = True
            job_info['cards_scanned'] = cards_scanned
            # if _job_list and len(_job_list) != 0:
            #     break
        # logger.trace(f"原始任务点列表内容:\n{_resp.text}")
        logger.info("章节任务点读取成功...")
        return job_list, job_info

    def get_enc(self, clazzId, jobid, objectId, playingTime, duration, userid):
        return md5(
            f"[{clazzId}][{userid}][{jobid}][{objectId}][{playingTime * 1000}][d_yHJ!$pdA~5][{duration * 1000}][0_{duration}]"
            .encode()).hexdigest()

    def video_progress_log(self, _session, _course, _job, _job_info, _dtoken, _duration, _playingTime, _type: str = "Video"):
        self.last_progress_status = None
        if "courseId" in _job['otherinfo']:
            _mid_text = f"otherInfo={_job['otherinfo']}&"
        else:
            _mid_text = f"otherInfo={_job['otherinfo']}&courseId={_course['courseId']}&"
        _success = False
        _rt_from_job = str(_job.get('rt') or '')
        if not _rt_from_job:
            _rt_match = re.search(r'-rt_([1d])(?:-|&|$)', _job.get('otherinfo', ''))
            if _rt_match:
                # 任务卡 rt_d 是默认播放模式，对应日志接口 rt=1。旧代码误映射
                # 为 0.9，会得到 HTTP 200 却始终 isPassed=false，形成 8 轮假重试。
                _rt_from_job = '1'
        _preferred_rt = _rt_from_job or "1"
        _possible_rts = [_preferred_rt] + [rt for rt in ("1", "0.9") if rt != _preferred_rt]
        _last_success_result = None
        for _possible_rt in _possible_rts:
            _extra = ''
            for _key in ('videoFaceCaptureEnc', 'attDuration', 'attDurationEnc'):
                _value = _job.get(_key)
                if _value not in (None, ''):
                    _extra += f"{_key}={_value}&"
            _url = (f"https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/"
                    f"{_course['cpi']}/"
                    f"{_dtoken}?"
                    f"clazzId={_course['clazzId']}&"
                    f"playingTime={_playingTime}&"
                    f"duration={_duration}&"
                    f"clipTime=0_{_duration}&"
                    f"objectId={_job['objectid']}&"
                    f"{_mid_text}"
                    f"jobid={_job['jobid']}&"
                    f"userid={self.get_uid()}&"
                    f"isdrag=3&"
                    f"view=pc&"
                    f"enc={self.get_enc(_course['clazzId'], _job['jobid'], _job['objectid'], _playingTime, _duration, self.get_uid())}&"
                    f"rt={_possible_rt}&"
                    f"dtype={_type}&"
                    f"{_extra}"
                    f"_t={get_timestamp()}")
            resp = _session.get(_url)
            self.last_progress_status = resp.status_code
            if resp.status_code == 200:
                _success = True
                _last_success_result = resp.json()
                # 播放过程中 isPassed=false 是正常状态，不重复发送另一种模式；
                # 到视频末尾仍未通过时再试备用 rt，兼容不同年代的任务卡。
                if _last_success_result.get("isPassed") is True or _playingTime < _duration:
                    return _last_success_result
            elif resp.status_code == 403:
                continue # 如果出现403无权限报错，则继续尝试不同的rt参数
        if _success:
            return _last_success_result
        else:
            # 所有任务卡允许的 rt 组合均被服务端拒绝；章节级重复播放不会
            # 改变权限/资源状态，交给上层标记 blocked 并继续后续章节。
            logger.warning(
                f"任务上报被服务端拒绝(HTTP {self.last_progress_status})，"
                "所有rt组合均失败"
            )
            return False

    def study_video(self, _course, _job, _job_info, _speed: float = 1.0,
                    _type: str = "Video", _resume: bool = True):
        self.last_task_failure = None
        self.last_progress_status = None
        if _type == "Video":
            _session = init_session(isVideo=True)
        else:
            _session = init_session(isAudio=True)
        _session.headers.update()
        _fid = self.get_fid()
        if not _fid:
            logger.warning(f"无法获取fid，跳过视频: {_job.get('name','?')}")
            return False
        _info_url = f"https://mooc1.chaoxing.com/ananas/status/{_job['objectid']}?k={_fid}&flag=normal"
        _video_info = _session.get(_info_url).json()
        if _video_info.get("status") != "success":
            resource_status = str(_video_info.get("status") or "unknown")
            if resource_status == "failed":
                reason = "视频资源处理失败或已损坏，需要课程教师重新上传"
            elif resource_status == "transfer":
                reason = "视频资源仍在转码（若长期不变需课程教师重新转码）"
            else:
                reason = f"视频状态异常: {resource_status}"
            self.last_task_failure = {
                # status 接口已正常返回，但资源不是 success；重试同一个对象不会
                # 修复 failed/transfer/unknown 等服务端资源状态。
                "retryable": False,
                "kind": "video_resource",
                "status": resource_status,
                "task": _job.get("name", "?"),
                "reason": reason,
            }
            logger.warning(f"{reason}，保留为未完成: {_job.get('name','?')}")
            return False
        _dtoken = _video_info["dtoken"]
        _duration = _video_info["duration"]
        _crc = _video_info["crc"]
        _key = _video_info["key"]
        _isPassed = False
        _duration = int(_duration)
        try:
            _playingTime = int(_job.get('playTime', 0) or 0) // 1000 if _resume else 0
        except (TypeError, ValueError):
            _playingTime = 0
        _playingTime = max(0, min(_duration, _playingTime))
        # 任务卡 doublespeed=0 表示该视频不允许倍速。尊重课程设置并按真实
        # 时间上报，避免“本地两倍速结束、服务器只记到 85 秒”的假完成。
        if _speed > 1 and _job.get('doublespeed') in (0, False, '0', 'false'):
            logger.warning(f"课程不允许倍速，已自动使用1倍速: {_job['name']}")
            _speed = 1.0
        logger.info(f"开始任务: {_job['name']}, 总时长: {_duration}秒, 从{_playingTime}秒继续")
        while True:
            _isPassed = self.video_progress_log(_session, _course, _job, _job_info, _dtoken, _duration, _playingTime, _type)
            if not _isPassed:
                progress_status = getattr(self, 'last_progress_status', None)
                reason = f"任务进度上报被服务端拒绝(HTTP {progress_status or 'unknown'})"
                self.last_task_failure = {
                    "retryable": False,
                    "kind": "video_progress_rejected",
                    "status": progress_status,
                    "task": _job.get("name", "?"),
                    "reason": reason,
                }
                logger.warning(f"{reason}，保留为未完成: {_job['name']}")
                return False
            # isPassed 表示服务端累计观看已达标，可能在本次播放尚未到结尾时出现。
            # 上层随后还会重新读取任务卡复核，因此这里接受服务端通过信号；若任务
            # 卡仍未清空，上层会保持当前章节并改用从 0 秒建立完整观看会话重试。
            if _isPassed.get("isPassed") is True:
                if _playingTime < _duration:
                    logger.info(
                        f"服务器确认累计观看达标({_playingTime}/{_duration}秒): {_job['name']}"
                    )
                break
            if _playingTime >= _duration:
                response_summary = {
                    key: _isPassed.get(key)
                    for key in ("isPassed", "status", "msg", "error")
                    if key in _isPassed
                }
                # ff_1/videoFaceCaptureEnc 会出现在普通可手动完成的视频任务中，
                # 不能仅凭这两个通用字段推断“必须人脸验证”。是否可重试只按
                # 服务端明确错误判断；单纯未确认交给章节级重试与 blocked 兜底。
                reason = "已上报到视频末尾但服务器未确认完成"
                self.last_task_failure = {
                    "retryable": True,
                    "kind": "video_unconfirmed",
                    "status": "unconfirmed",
                    "task": _job.get("name", "?"),
                    "reason": reason,
                }
                logger.warning(f"{reason}: {_job['name']}，响应={response_summary}")
                return False
            try:
                _report_interval = int(_job_info.get('reportTimeInterval', 0) or 0)
            except (TypeError, ValueError):
                _report_interval = 0
            _wait_time = _report_interval if _report_interval > 0 else get_random_seconds()
            if _playingTime + _wait_time >= _duration:
                _wait_time = _duration - _playingTime
            # 播放进度条
            show_progress(_job['name'], _playingTime, _wait_time, _duration, _speed)
            _playingTime += _wait_time
        print("\r", end="", flush=True)
        logger.info(f"任务上报返回通过，等待任务卡复核: {_job['name']}")
        if hasattr(self, '_tracker') and self._tracker:
            kid = _job_info.get('knowledgeid', '')
            chapter_id = f"{_course['courseId']}_{kid}"
            self._tracker.log_video(chapter_id, _job.get('name','unknown'), int(_duration))
        return True


    def study_document(self, _course, _job):
        _session = init_session()
        _url = f"https://mooc1.chaoxing.com/ananas/job/document?jobid={_job['jobid']}&knowledgeid={re.findall(r'nodeId_(.*?)-', _job['otherinfo'])[0]}&courseid={_course['courseId']}&clazzid={_course['clazzId']}&jtoken={_job['jtoken']}&_dc={get_timestamp()}"
        _resp = _session.get(_url)
        if _resp.status_code == 200:
            logger.info(f"文档任务已提交，等待服务器复核: {_job.get('name', '?')}")
            return True
        logger.error(f"文档任务提交失败 [{_resp.status_code}]: {_job.get('name', '?')}")
        return False

    def study_work(self, _course, _job,_job_info) -> bool:
        self.last_task_failure = None
        if not self.tiku or self.tiku.DISABLE:
            self.last_task_failure = {
                "retryable": False,
                "kind": "work_disabled",
                "status": "disabled",
                "task": _job.get("jobid", "?"),
                "reason": "题库或自动提交未启用",
            }
            return False
        _ORIGIN_HTML_CONTENT = ""   # 用于配合输出网页源码，帮助修复#391错误

        def random_answer(options:str) -> str:
            answer = ''
            if not options:
                return answer

            if q['type'] == "multiple":
                _op_list = multi_cut(options)
                if not _op_list:
                    return answer   # ★ 防崩溃：选项为空时不再 random.choice 抛 IndexError
                for i in range(random.choices([2,3,4],weights=[0.1,0.5,0.4],k=1)[0]):
                    if not _op_list:
                        break   # ★ 选项耗尽即停
                    _choice = random.choice(_op_list)
                    _op_list.remove(_choice)
                    answer+=_choice[:1] # 取首字为答案，例如A或B
                # 对答案进行排序，否则会提交失败
                answer = "".join(sorted(answer))
            elif q['type'] == "single":
                _opts = options.split('\n')
                _opts = [x for x in _opts if x.strip()]
                if _opts:
                    answer = random.choice(_opts)[:1] # 取首字为答案，例如A或B
            # 判断题处理
            elif q['type'] == "judgement":
                # answer = self.tiku.jugement_select(_answer)
                answer = "true" if random.choice([True,False]) else "false"
            logger.info(f'随机选择 -> {answer}')
            return answer
        
        def multi_cut(answer:str) -> list[str]:
            if '\n' in answer:
                res = [o.strip() for o in answer.split('\n') if o.strip()]
                if res:
                    return res
            cut_char = [',','，','|','\t','#','*','-','_','+','@','~','/','\\','.','&',' ','、']    # 多选答案切割符
            res = []
            for char in cut_char:
                res = answer.split(char)
                if len(res)>1:
                    return res
            logger.warning(f"未能从网页中提取题目信息，以下为相关信息：\n{answer}\n\n{_ORIGIN_HTML_CONTENT}\n")     # 尝试输出网页内容和选项信息
            logger.warning("未能正确提取题目选项信息！请反馈并提供以上信息。")
            return ['A','B','C','D']    # 默认多选题为4个选项


        # 学习通这里根据参数差异能重定向至两个不同接口，需要定向至https://mooc1.chaoxing.com/mooc-ans/workHandle/handle
        _session = init_session()
        headers={
            "Host": "mooc1.chaoxing.com",
            "sec-ch-ua": "\"Microsoft Edge\";v=\"129\", \"Not=A?Brand\";v=\"8\", \"Chromium\";v=\"129\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Dest": "iframe",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6,ja;q=0.5"
        }
        cookies = _session.cookies.get_dict()


        _url = "https://mooc1.chaoxing.com/mooc-ans/api/work"   
        _resp = requests.get(
            _url,
            headers=headers,
            cookies=cookies,
            verify=True,
            params = {
                "api": "1",
                "workId": _job['jobid'].replace("work-",""),
                "jobid": _job['jobid'],
                "originJobId": _job['jobid'],
                "needRedirect": "true",
                "skipHeader": "true",
                "knowledgeid": str(_job_info['knowledgeid']),
                'ktoken': _job_info['ktoken'], 
                "cpi": _job_info['cpi'],
                "ut": "s",
                "clazzId": _course['clazzId'],
                "type": "",
                "enc": _job['enc'],
                "mooc2": "1",
                "courseid": _course['courseId']
            }
        )
        _ORIGIN_HTML_CONTENT = _resp.text   # 用于配合输出网页源码，帮助修复#391错误
        questions = decode_questions_info(_resp.text)   # 加载题目信息

        import re as _re

        # 搜题
        for q in questions['questions']:
            res = self.tiku.query(q)
            answer = ''
            if not res:
                answer = random_answer(q['options'])
            else:
                options_list = multi_cut(q['options'])
                if q['type'] == "multiple":
                    for _a in multi_cut(res):
                        for o in options_list:
                            if _a.upper() in o:
                                answer += o[:1]
                    answer = "".join(sorted(answer))
                elif q['type'] == 'judgement':
                    answer = 'true' if self.tiku.jugement_select(res) else 'false'
                else:
                    clean_res = _re.sub(r'<[^>]+>', '', res).strip()
                    clean_res = _re.sub(r'^[\s\u200b\u200c\u200d<>"\'《》「」【】]+|[\s\u200b\u200c\u200d<>"\'《》「」【】]+$', '', clean_res)
                    for o in options_list:
                        o_clean = _re.sub(r'^[A-Za-z][.、）)]?\s*', '', o)
                        if clean_res == o_clean or clean_res in o or o_clean in clean_res or clean_res in o_clean:
                            answer = o[:1]
                            break
                    if not answer and len(clean_res) == 1 and clean_res.isalpha():
                        upper = clean_res.upper()
                        for o in options_list:
                            if o.startswith(upper):
                                answer = upper
                                break
                answer = answer if answer else random_answer(q['options'])
        # 提交模式  现在与题库绑定
        questions['pyFlag'] = self.tiku.get_submit_params()  

        # 组建提交表单
        for q in questions["questions"]:
            questions.update({
                f'answer{q["id"]}':q['answerField'][f'answer{q["id"]}'],
                f'answertype{q["id"]}':q['answerField'][f'answertype{q["id"]}']
            })


        del questions["questions"]

        res = _session.post(
            'https://mooc1.chaoxing.com/mooc-ans/work/addStudentWorkNew',
            data=questions,
            headers= {
                "Host": "mooc1.chaoxing.com",
                "sec-ch-ua-platform": "\"Windows\"",
                "X-Requested-With": "XMLHttpRequest",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "sec-ch-ua": "\"Microsoft Edge\";v=\"129\", \"Not=A?Brand\";v=\"8\", \"Chromium\";v=\"129\"",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "sec-ch-ua-mobile": "?0",
                "Origin": "https://mooc1.chaoxing.com",
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
                #"Referer": "https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=246831735&workAnswerId=52680423&workId=37778125&api=1&knowledgeid=913820156&classId=107515845&oldWorkId=07647c38d8de4c648a9277c5bed7075a&jobid=work-07647c38d8de4c648a9277c5bed7075a&type=&isphone=false&submit=false&enc=1d826aab06d44a1198fc983ed3d243b1&cpi=338350298&mooc2=1&skipHeader=true&originJobId=work-07647c38d8de4c648a9277c5bed7075a",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6,ja;q=0.5"
            }
        )
        if res.status_code == 200:
            res_json = res.json()
            if res_json['status']:
                logger.info(f'提交答题成功 -> {res_json["msg"]}')
                if hasattr(self, '_tracker') and self._tracker:
                    chapter_id = f"{_course['courseId']}_{_job_info['knowledgeid']}"
                    self._tracker.update_chapter(chapter_id, _course['courseId'], '', work_done=True)
                return True
            else:
                failure_message = str(res_json.get("msg", "未知错误"))
                is_expired = "过期" in failure_message
                self.last_task_failure = {
                    "retryable": not is_expired,
                    "kind": "work_expired" if is_expired else "work_submit",
                    "status": "expired" if is_expired else "failed",
                    "task": _job.get("jobid", "?"),
                    "reason": failure_message,
                }
                logger.error(f'提交答题失败 -> {failure_message}')
                return False
        else:
            failure_message = res.text[:200]
            self.last_task_failure = {
                "retryable": True,
                "kind": "work_http",
                "status": str(res.status_code),
                "task": _job.get("jobid", "?"),
                "reason": failure_message,
            }
            logger.error(f"提交答题失败 -> {failure_message}")
            return False

    def strdy_read(self, _course, _job,_job_info) -> None:
        """
        阅读任务学习，仅完成任务点，并不增长时长
        """
        _session = init_session()
        _resp = _session.get(
            url="https://mooc1.chaoxing.com/ananas/job/readv2",
            params={
                'jobid': _job['jobid'],
                'knowledgeid':_job_info['knowledgeid'],
                'jtoken': _job['jtoken'],
                'courseid': _course['courseId'],
                'clazzid': _course['clazzId']
            }
        )
        if _resp.status_code != 200:
            logger.error(f"阅读任务学习失败 -> [{_resp.status_code}]{_resp.text}")
            return False
        else:
            _resp_json = _resp.json()
            logger.info(f"阅读任务学习 -> {_resp_json['msg']}")
            return bool(_resp_json.get('status', True))
