import configparser
import requests
from pathlib import Path
import json
from api.logger import logger
import random
from urllib3 import disable_warnings,exceptions
import os, sys

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
        self.cacheFile = Path(resource_path(file))
        if not self.cacheFile.is_file():
            self.cacheFile.open("w", encoding="utf8").write("{}")
        self.fp = self.cacheFile.open("r+", encoding="utf8")

    def getCache(self, question: str):
        self.fp.seek(0)
        data = json.load(self.fp)
        if isinstance(data, dict):
            return data.get(question)

    def addCache(self, question: str, answer: str):
        self.fp.seek(0)
        data: dict = json.load(self.fp)
        data[question] = answer
        self.fp.seek(0)
        json.dump(data, self.fp, ensure_ascii=False, indent=4)


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
        q_info['title'] = q_info['title'][6:]   # 暂时直接用裁切解决

        # 先过缓存
        cache_dao = CacheDAO()
        answer = cache_dao.getCache(q_info['title'])
        if answer:
            logger.info(f"从缓存中获取答案：{q_info['title']} -> {answer}")
            return answer.strip()
        else:
            answer = self._query(q_info)
            if answer:
                answer = answer.strip()
                cache_dao.addCache(q_info['title'], answer)
                logger.info(f"从{self.name}获取答案：{q_info['title']} -> {answer}")
                return answer
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
            verify=False
        )
        if res.status_code == 200:
            res_json = res.json()
            if not res_json['code']:
                # 如果是因为TOKEN次数到期，则更换token
                if self._times == 0 or '次数不足' in res_json['data']['answer']:
                    logger.info(f'TOKEN查询次数不足，将会更换并重新搜题')
                    self._token_index += 1
                    self.load_token()
                    # 重新查询
                    return self._query(q_info)
                logger.error(f'{self.name}查询失败:\n剩余查询数{res_json["data"].get("times",f"{self._times}(仅参考)")}:\n消息:{res_json["message"]}')
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
        model = self._conf.get('ai_model', 'deepseek-chat')
        api_key = self._conf.get('ai_key', '')
        if not api_key:
            return None
        title = q_info.get('title', '')
        options = q_info.get('options', '')
        q_type = q_info.get('type', 'single')
        type_map = {'single': '单选题', 'multiple': '多选题', 'judgement': '判断题', 'completion': '填空题'}
        prompt = '你是一个专业的在线教育答题助手。请回答以下' + type_map.get(q_type, '未知题型') + '。\n题目：' + title
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
                timeout=30, verify=False)
            if resp.status_code == 200:
                return resp.json()['choices'][0]['message']['content'].strip()
        except:
            pass
        return None
