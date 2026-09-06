import configparser
import requests
from pathlib import Path
import json
from chaoxing.logger import logger
import random
from urllib3 import disable_warnings,exceptions
import os, sys
import re

def resource_path(relative_path: str) -> str:
    if hasattr(sys, '_MEIPASS'):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

# 关闭警告
disable_warnings(exceptions.InsecureRequestWarning)

class CacheDAO:
    """
    @Author: SocialSisterYi
    @Reference: https://github.com/SocialSisterYi/xuexiaoyi-to-xuexitong-tampermonkey-proxy
    """
    def __init__(self, file: str = "cache.json"):
        # 题库缓存属于运行时数据，不能跟随当前工作目录写到项目根目录。
        # Web 任务固定落在 /tmp/AutomaticCB，并按主账号隔离，避免 www-data
        # 因源码目录权限不足而让整门课程异常退出。
        runtime_dir = Path(os.environ.get("CHAOXING_RUNTIME_DIR", "/tmp/AutomaticCB"))
        runtime_dir.mkdir(parents=True, exist_ok=True)
        user_id = re.sub(r"[^A-Za-z0-9_.-]", "_", os.environ.get("CHAOXING_USER_ID", "default"))
        cache_name = f"cache_{user_id}.json" if file == "cache.json" else Path(file).name
        self.cacheFile = runtime_dir / cache_name
        if not self.cacheFile.is_file():
            self.cacheFile.write_text("{}", encoding="utf8")
        self.fp = self.cacheFile.open("r+", encoding="utf8")

    def close(self):
        if getattr(self, "fp", None) and not self.fp.closed:
            self.fp.close()

    def __del__(self):
        self.close()

    def getCache(self, question: str):
        self.fp.seek(0)
        try:
            data = json.load(self.fp)
        except (json.JSONDecodeError, ValueError):
            data = {}
        if isinstance(data, dict):
            return data.get(question)

    def addCache(self, question: str, answer: str):
        self.fp.seek(0)
        try:
            data: dict = json.load(self.fp)
        except (json.JSONDecodeError, ValueError):
            data = {}
        data[question] = answer
        self.fp.seek(0)
        json.dump(data, self.fp, ensure_ascii=False, indent=4)
        self.fp.truncate()
        self.fp.flush()


class Tiku:
    CONFIG_PATH = resource_path("config.ini")  # 默认配置文件路径
    DISABLE = False     # 停用标志
    SUBMIT = False      # 提交标志

    def __init__(self) -> None:
        self._name = None
        self._api = None
        self._conf = None
        self._fallback = None

    @property
    def name(self):
        return self._name
    
    @name.setter
    def name(self, value):
        self._name = value

    @property
    def api(self):
        return self._api
    
    @api.setter
    def api(self, value):
        self._api = value

    @property
    def token(self):
        return self._token

    @token.setter
    def token(self,value):
        self._token = value

    def init_tiku(self):
        # 仅用于题库初始化，应该在题库载入后作初始化调用，随后才可以使用题库
        # 尝试根据配置文件设置提交模式
        if not self._conf:
            self.config_set(self._get_conf())
        if not self.DISABLE:
            # 设置提交模式
            self.SUBMIT = True if self._conf['submit'] == 'true' else False
            # 调用自定义题库初始化
            self._init_tiku()
        
    def _init_tiku(self):
        # 仅用于题库初始化，例如配置token，交由自定义题库完成
        pass

    def config_set(self,config):
        self._conf = config

    def _get_conf(self):
        """
        从默认配置文件查询配置，如果未能查到，停用题库
        """
        try:
            config = configparser.ConfigParser()
            config.read(self.CONFIG_PATH, encoding="utf8")
            return config['tiku']
        except KeyError or FileNotFoundError:
            logger.info("未找到tiku配置，已忽略题库功能")
            self.DISABLE = True
            return None

    def set_fallback(self, fallback_tiku):
        self._fallback = fallback_tiku

    def query(self,q_info:dict):
        if self.DISABLE:
            return None

        # 预处理，去除【单选题】这样与标题无关的字段
        # 此处需要改进！！！
        # Prefix removed upstream, no crop needed here

        # 先过缓存
        cache_dao = None
        try:
            cache_dao = CacheDAO()
            answer = cache_dao.getCache(q_info['title'])
        except OSError as e:
            logger.warning(f"题库缓存不可用，继续联网查题: {e}")
            answer = None
        if answer:
            logger.info(f"从缓存中获取答案：{q_info['title']} -> {answer}")
            return answer.strip()
        else:
            answer = self._query(q_info)
            if answer:
                answer = answer.strip()
                if cache_dao:
                    try:
                        cache_dao.addCache(q_info['title'], answer)
                    except OSError as e:
                        logger.warning(f"题库答案缓存失败，不影响本次答题: {e}")
                logger.info(f"从{self.name}获取答案：{q_info['title']} -> {answer}")
                return answer
            # ★ 自身查询失败 → 沿 fallback 链继续（如言溪失败自动降级 AI 答题），
            #   链尾仍失败才返回 None（调用方回退到随机选择）
            if self._fallback:
                logger.info(f"{self.name}未命中，回退查询 {self._fallback.name}...")
                return self._fallback.query(q_info)
            logger.error(f"从{self.name}获取答案失败：{q_info['title']}")
        return None
    def _query(self,q_info:dict):
        """
        查询接口，交由自定义题库实现
        """
        pass

    def get_tiku_from_config(self):
        """从配置文件加载题库，支持链式"""
        if not self._conf:
            self.config_set(self._get_conf())
        if self.DISABLE:
            return self
        try:
            providers_str = self._conf['provider']
            if not providers_str:
                raise KeyError
        except KeyError:
            logger.error("未找到题库配置，已忽略题库功能")
            self.DISABLE = True
            return self

        aliases = {'TikuAI': 'AI'}
        names = [aliases.get(p.strip(), p.strip()) for p in providers_str.split(',') if p.strip()]

        main_cls = globals().get(names[0])
        if not main_cls:
            logger.error(f"未找到题库类: {names[0]}")
            self.DISABLE = True
            return self

        main_tiku = main_cls()
        main_tiku.config_set(self._conf)
        cur = main_tiku
        for pname in names[1:]:
            cls = globals().get(pname)
            if cls:
                fb = cls()
                fb.config_set(self._conf)
                cur.set_fallback(fb)
                cur = fb
                logger.info(f"题库链: {names[0]} → {' → '.join(names[1:])}")
        return main_tiku
    def jugement_select(self,answer:str) -> bool:
        """
        这是一个专用的方法，要求配置维护两个选项列表，一份用于正确选项，一份用于错误选项，以应对题库对判断题答案响应的各种可能的情况
        它的作用是将获取到的答案answer与可能的选项列对比并返回对应的布尔值
        """
        if self.DISABLE:
            return False
        true_list = self._conf['true_list'].split(',')
        false_list = self._conf['false_list'].split(',')
        # 对响应的答案作处理
        answer = answer.strip()
        if answer in true_list:
            return True
        elif answer in false_list:
            return False
        else:
            # 无法判断，随机选择
            logger.error(f'无法判断答案 -> {answer} 对应的是正确还是错误，请自行判断并加入配置文件重启脚本，本次将会随机选择选项')
            return random.choice([True,False])
    
    def get_submit_params(self):
        """
        这是一个专用方法，用于根据当前设置的提交模式，响应对应的答题提交API中的pyFlag值
        """
        # 留空直接提交，1保存但不提交
        if self.SUBMIT:
            return ""
        else:
            return "1"

# 按照以下模板实现更多题库

class TikuYanxi(Tiku):
    # 言溪题库实现
    def __init__(self) -> None:
        super().__init__()
        self.name = '言溪题库'
        self.api = 'https://tk.enncy.cn/query'
        self._token = None
        self._token_index = 0   # token队列计数器
        self._times = 100   # 查询次数剩余，初始化为100，查询后校对修正

    def _query(self,q_info:dict):
        res = requests.get(
            self.api,
            params={
                'question':q_info['title'],
                'token':self._token
            },
            verify=True
        )
        if res.status_code == 200:
            res_json = res.json()
            if not res_json['code']:
                # 如果是因为TOKEN次数到期，则更换token
                _data = res_json.get('data') or {}
                _answer_msg = str(_data.get('answer', ''))
                if self._times == 0 or '次数不足' in _answer_msg:
                    logger.info(f'TOKEN查询次数不足，将会更换并重新搜题')
                    self._token_index += 1
                    self.load_token()
                    # 重新查询
                    return self._query(q_info)
                logger.error(f'{self.name}查询失败:\n剩余查询数{_data.get("times",f"{self._times}(仅参考)")}:\n消息:{res_json.get("message","")}')
                return None
            self._times = res_json["data"].get("times",self._times)
            return res_json['data']['answer'].strip()
        else:
            logger.error(f'{self.name}查询失败:\n{res.text}')
        return None
    
    def load_token(self): 
        token_list = self._conf['tokens'].split(',')
        if self._token_index == len(token_list):
            # TOKEN 用完
            logger.error('TOKEN用完，请自行更换再重启脚本')
            raise Exception(f'{self.name} TOKEN 已用完，请更换')
        self._token = token_list[self._token_index]

    def _init_tiku(self):
        self.load_token()




class AI(Tiku):
    def __init__(self):
        super().__init__()
        self.name = 'AI答题'
    def _query(self, q_info: dict):
        import requests as _req
        base_url = self._conf.get('ai_base_url', 'https://api.deepseek.com')
        model = self._conf.get('ai_model', '')
        api_key = self._conf.get('ai_key', '')
        # ★ 按提供商智能选择默认模型（不再硬编码已失效的 deepseek-chat）
        if not model:
            _u = base_url.lower()
            if 'deepseek' in _u:
                model = 'deepseek-v4-flash'
            elif 'openai' in _u or 'chatgpt' in _u:
                model = 'gpt-5'
            elif 'anthropic' in _u or 'claude' in _u:
                model = 'claude-sonnet-4-20250514'
            elif 'gemini' in _u or 'googleapis' in _u:
                model = 'gemini-2.5-flash'
            elif 'longcat' in _u:
                model = 'LongCat-2.0'
            elif 'x.ai' in _u or 'grok' in _u:
                model = 'grok-4.20-0309'
            else:
                model = 'deepseek-v4-flash'
        # ★ 空 key 或配置占位符（「你的…」）视为未配置：不发起无效请求，明确提示
        if not api_key or '你的' in api_key:
            logger.error('AI答题未配置有效 api_key（请在刷课设置填写 AI Key，如 DeepSeek），本次跳过 AI 答题')
            return None
        title = q_info.get('title', '')
        options = q_info.get('options', '')
        q_type = q_info.get('type', 'single')
        type_map = {'single': '单选题', 'multiple': '多选题', 'judgement': '判断题', 'completion': '填空题'}
        # ★ 联网搜索增强：ai_search=1 且 ai_search_key 有效时，先 Tavily 搜题再交给 AI
        search_hint = ''
        search_enabled = str(self._conf.get('ai_search', '0')) in ('1', 'true', 'True')
        search_key = self._conf.get('ai_search_key', '')
        if search_enabled and search_key and '你的' not in search_key:
            try:
                sr = _req.post('https://api.tavily.com/search',
                    json={'api_key': search_key, 'query': title, 'max_results': 4, 'search_depth': 'basic'},
                    timeout=15, verify=True)
                if sr.status_code == 200:
                    results = (sr.json() or {}).get('results', [])
                    if results:
                        search_hint = '以下为联网搜索到的相关资料，请结合它们作答：\n' + '\n'.join(
                            f"- {r.get('title','')}: {r.get('content','')[:300]}" for r in results[:4])
                        logger.info(f'AI答题联网搜索到 {len(results)} 条资料')
                    else:
                        logger.info('AI联网搜索无结果，跳过')
                else:
                    logger.error(f'AI联网搜索失败 HTTP {sr.status_code}: {sr.text[:120]}')
            except Exception as e:
                logger.error(f'AI联网搜索异常: {e}')
        prompt = '你是一个专业的在线教育答题助手。请回答以下' + type_map.get(q_type, '未知题型') + '。\n题目：' + title
        if search_hint:
            prompt += '\n' + search_hint
        if options:
            prompt += '\n选项：\n' + options
        if q_type == 'single':
            prompt += '\n请只输出选项字母（如A）'
        elif q_type == 'multiple':
            prompt += '\n请只输出选项字母组合（如ABC），按字母顺序'
        elif q_type == 'judgement':
            prompt += '\n请只输出 true 或 false'
        try:
            resp = _req.post(base_url.rstrip('/') + '/v1/chat/completions',
                headers={'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'},
                json={'model': model, 'messages': [{'role': 'user', 'content': prompt}], 'temperature': 0.1, 'max_tokens': 128},
                timeout=30, verify=True)
            if resp.status_code == 200:
                return resp.json()['choices'][0]['message']['content'].strip()
            logger.error(f'AI答题请求失败 HTTP {resp.status_code}: {resp.text[:120]}')
        except Exception as e:
            logger.error(f'AI答题请求异常: {e}')
        return None
