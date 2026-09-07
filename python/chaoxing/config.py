# -*- coding: utf-8 -*-
import os
import re
import sys


def _user_cookie_path():
    """从当前命令参数识别 OneAPIChat 用户，隔离学习通 Cookie。"""
    user_id = os.environ.get('CHAOXING_USER_ID', '')
    if not user_id:
        for idx, arg in enumerate(sys.argv):
            if arg == '--user-id' and idx + 1 < len(sys.argv):
                user_id = sys.argv[idx + 1]
                break
            match = re.search(r'config_(u_[a-zA-Z0-9_-]+)\.ini$', arg)
            if match:
                user_id = match.group(1)
                break
    user_id = re.sub(r'[^a-zA-Z0-9_-]', '', user_id)
    if user_id:
        return f'/var/www/html/oneapichat/users/chaoxing/cookies_{user_id}.pkl'
    return os.environ.get('CHAOXING_COOKIES_PATH', 'cookies.txt')


def resolve_user_config(user_id=None, explicit_path=None):
    """
    智能解析用户 config.ini 路径：
    1. 若指定 explicit_path 且存在有效，优先使用；
    2. 尝试从命令行参数或环境变量识别 user_id；
    3. 检查持久化路径 /var/www/html/oneapichat/users/chaoxing/config_{user_id}.ini；
    4. 检查运行时路径 /tmp/AutomaticCB/config_{user_id}.ini；
    5. 回退到项目根目录 config.ini。
    """
    if explicit_path and os.path.isfile(explicit_path) and os.path.getsize(explicit_path) > 0:
        return explicit_path

    if not user_id:
        user_id = os.environ.get('CHAOXING_USER_ID', '')
    if not user_id:
        for idx, arg in enumerate(sys.argv):
            if arg == '--user-id' and idx + 1 < len(sys.argv):
                user_id = sys.argv[idx + 1]
                break
            match = re.search(r'config_(u_[a-zA-Z0-9_-]+)\.ini$', arg)
            if match:
                user_id = match.group(1)
                break
            if (arg == '-c' or arg == '--config') and idx + 1 < len(sys.argv):
                candidate = sys.argv[idx + 1]
                if os.path.isfile(candidate) and os.path.getsize(candidate) > 0:
                    return candidate

    user_id = re.sub(r'[^a-zA-Z0-9_-]', '', user_id or '')

    candidates = []
    if user_id:
        # 1. 权威持久化目录（永远不会被 /tmp 清理破坏）
        candidates.append(f'/var/www/html/oneapichat/users/chaoxing/config_{user_id}.ini')
        # 2. 运行时目录
        candidates.append(f'/tmp/AutomaticCB/config_{user_id}.ini')

    # 3. 项目根目录 config.ini
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    candidates.append(os.path.join(root_dir, 'config.ini'))
    candidates.append('/var/www/html/oneapichat/config.ini')

    for p in candidates:
        if os.path.isfile(p) and os.path.getsize(p) > 0:
            return p

    return candidates[0] if candidates else '/var/www/html/oneapichat/config.ini'


class GlobalConst:
    AESKey = "u2oh6Vu^HWe4_AES"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
        "Sec-Ch-Ua": '"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"'
    }
    COOKIES_PATH = _user_cookie_path()
    VIDEO_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
        "Referer": "https://mooc1.chaoxing.com/ananas/modules/video/index.html?v=2023-1110-1610",
        "Host": "mooc1.chaoxing.com"
    }
    AUDIO_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
        "Referer": "https://mooc1.chaoxing.com/ananas/modules/audio/index_new.html?v=2023-0428-1705",
        "Host": "mooc1.chaoxing.com"
    }
    THRESHOLD = 3
