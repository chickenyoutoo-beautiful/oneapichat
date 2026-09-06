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
