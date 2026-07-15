# -*- coding: utf-8 -*-
import os.path
import pickle
from requests.cookies import RequestsCookieJar
from chaoxing.config import GlobalConst as gc


def save_cookies(_session):
    with open(gc.COOKIES_PATH, 'wb') as f:
        pickle.dump(_session.cookies, f)


def use_cookies():
    """加载已保存的 Cookie。文件不存在/损坏/为空时返回空 CookieJar"""
    if os.path.exists(gc.COOKIES_PATH) and os.path.getsize(gc.COOKIES_PATH) > 0:
        try:
            with open(gc.COOKIES_PATH, 'rb') as f:
                _cookies = pickle.load(f)
            if isinstance(_cookies, RequestsCookieJar):
                return _cookies
        except Exception:
            pass  # 文件损坏, 返回空 CookieJar
    return RequestsCookieJar()