# -*- coding: utf-8 -*-
import os
import os.path
import pickle
import tempfile
from requests.cookies import RequestsCookieJar
from chaoxing.config import GlobalConst as gc


def save_cookies(_session):
    """
    保存 Cookie 到磁盘。
    采用原子写入（tempfile + chmod 0660 + os.replace）：
    1. 避免写入中断导致 pickle 损坏；
    2. 解决 www-data 与 naujtrats 跨用户读写权限问题：
       即使目标文件之前由另一用户创建，只要对目标目录有写权限，os.replace
       也能无缝原子替换目标 inode 并重置权限为 0660。
    """
    cookie_path = gc.COOKIES_PATH
    if not cookie_path:
        return

    cookie_dir = os.path.dirname(os.path.abspath(cookie_path))
    if cookie_dir and not os.path.exists(cookie_dir):
        try:
            os.makedirs(cookie_dir, mode=0o775, exist_ok=True)
        except Exception:
            pass

    tmp_path = None
    try:
        tmp_fd, tmp_path = tempfile.mkstemp(prefix='.cookies-', suffix='.tmp', dir=cookie_dir)
        with os.fdopen(tmp_fd, 'wb') as f:
            pickle.dump(_session.cookies, f)
        try:
            os.chmod(tmp_path, 0o660)
        except Exception:
            pass
        os.replace(tmp_path, cookie_path)
        try:
            os.chmod(cookie_path, 0o660)
        except Exception:
            pass
    except Exception as e:
        # 清理可能残留的临时文件
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
        # 回退直接写入方案
        try:
            with open(cookie_path, 'wb') as f:
                pickle.dump(_session.cookies, f)
            try:
                os.chmod(cookie_path, 0o660)
            except Exception:
                pass
        except Exception as e_direct:
            raise PermissionError(
                f"保存超星 Cookie 失败 (uid={os.geteuid()}, path={cookie_path}): {e_direct} (atomic error: {e})"
            ) from e_direct


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
