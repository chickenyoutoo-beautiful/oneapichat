#!/usr/bin/env python3
import warnings
warnings.filterwarnings("ignore")
import urllib3
urllib3.disable_warnings()
"""通用的超星 API 抓取工具 — 用多个账号尝试"""
import sys, os, json, argparse

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--url', required=True)
    args = p.parse_args()

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, base_dir)
    os.chdir(sys.path[0])

    from loguru import logger as _lr
    _lr.remove()
    _lr.add(lambda _: None)

    # 账号列表（去重）
    import configparser
    cfg = configparser.ConfigParser()
    cfg.read(os.path.join(base_dir, 'config.ini'), encoding='utf8')
    
    raw = [
        (cfg.get('common', 'username', fallback=''), cfg.get('common', 'password', fallback='')),
        ('18268652161', '5887415157ab'),
        ('19118593666', 'Startjuan190139'),
    ]
    seen = set()
    ACCOUNTS = []
    for u, p in raw:
        if u and p and u not in seen:
            seen.add(u)
            ACCOUNTS.append((u, p))

    import requests
    from api.cipher import AESCipher

    for username, password in ACCOUNTS:
        try:
            session = requests.Session()
            session.verify = False
            session.headers.update({
                'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.6778.135 Mobile Safari/537.36',
            })

            cipher = AESCipher()
            lr = session.post('https://passport2.chaoxing.com/fanyalogin', data={
                'fid': '-1', 'uname': cipher.encrypt(username),
                'password': cipher.encrypt(password),
                'refer': 'https://i.chaoxing.com', 't': True, 'forbidotherlogin': 0,
            }, timeout=15)
            ld = lr.json()
            if not ld.get('status'):
                continue

            # 不跟随重定向，直接获取
            resp = session.get(args.url, timeout=30, allow_redirects=False)
            
            if resp.status_code == 200:
                body = resp.text
                if True:  # accept any 200 response
                    print(body)
                    return
                elif resp.headers.get('Location'):
                    resp2 = session.get(resp.headers['Location'], timeout=30, allow_redirects=True)
                    if '学号' in resp2.text or '答题时长' in resp2.text:
                        print(resp2.text)
                        return
            elif resp.status_code == 302:
                loc = resp.headers.get('Location', '')
                if 'login' not in loc:
                    resp2 = session.get(loc, timeout=30, allow_redirects=True)
                    if '学号' in resp2.text or '答题时长' in resp2.text:
                        print(resp2.text)
                        return
        except:
            continue

    sys.exit(1)

if __name__ == '__main__':
    main()
