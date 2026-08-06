#!/usr/bin/env python3
"""
netdisk_parser.py — 通用网盘解析器
支持: 百度网盘、夸克网盘、阿里云盘、天翼云盘、迅雷网盘、移动网盘、UC网盘、123网盘、蓝奏云

用法: python3 netdisk_parser.py <url> [password]
输出: JSON {"success": true/false, "direct_url": "...", "filename": "...", "file_size": "...", "error": "..."}
"""

import sys
import re
import json
import time
import gzip
import zlib
import urllib.request
import urllib.parse
import urllib.error
import http.cookiejar
import ssl
from pathlib import Path

# 忽略 SSL 验证 (某些网盘证书有问题)
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

# ★ Cookie 文件路径 (与 netdisk-login 共享)
# 优先使用绝对路径 (baidu-login.py 实际保存位置), 回退到相对路径
COOKIE_DIR_ABS = Path('/home/naujtrats/mcp-server/netdisk-login')
COOKIE_DIR_REL = Path(__file__).parent.parent.parent / 'mcp-server' / 'netdisk-login'
COOKIE_DIR = COOKIE_DIR_ABS if COOKIE_DIR_ABS.exists() else COOKIE_DIR_REL
BAIDU_COOKIE = COOKIE_DIR / '.baidu_cookie'
QUARK_COOKIE = COOKIE_DIR / '.quark_cookie'
ALIYUN_TOKEN = COOKIE_DIR / '.aliyun_token'


def load_cookie(service: str) -> str:
    """加载指定服务的 Cookie"""
    cookie_files = {
        'baidu': BAIDU_COOKIE,
        'quark': QUARK_COOKIE,
        'aliyun': ALIYUN_TOKEN,
    }
    cf = cookie_files.get(service)
    if cf and cf.exists():
        try:
            return cf.read_text().strip()
        except Exception:
            return ''   # 权限问题等: 视为未登录, 不要崩溃
    return ''


def identify_type(url: str) -> str:
    """识别网盘类型"""
    patterns = {
        'baidu': r'(?:^|[^a-z0-9])pan\.baidu\.com',
        'quark': r'(?:^|[^a-z0-9])pan\.quark\.cn',
        'aliyun': r'(?:^|[^a-z0-9])(alipan\.com|aliyundrive\.com)',
        'tianyi': r'(?:^|[^a-z0-9])cloud\.189\.cn',
        'xunlei': r'(?:^|[^a-z0-9])pan\.xunlei\.com',
        'mobile': r'(?:^|[^a-z0-9])yun\.139\.com',
        'uc': r'(?:^|[^a-z0-9])drive\.uc\.cn',
        '123': r'(?:^|[^a-z0-9])123pan\.com',
        # ilanzou 必须在 lanzou 之前匹配, 否则 "ilanzou.com" 会被 lanzou 模式误命中
        'ilanzou': r'(?:^|[^a-z0-9])ilanzou\.com',
        'lanzou': r'(?:^|[^a-z0-9])lanzou[a-z]*\.com|lanzous\.com',
    }
    for netdisk_type, pattern in patterns.items():
        if re.search(pattern, url):
            return netdisk_type
    return 'unknown'


def _decode_body(resp, body: bytes) -> str:
    """根据响应头 Content-Encoding 解压响应体 (蓝奏云等被WAF/CDN压缩时必需)"""
    enc = (resp.headers.get('Content-Encoding') or '').lower()
    try:
        if 'gzip' in enc:
            body = gzip.decompress(body)
        elif 'deflate' in enc:
            body = zlib.decompress(body)
        elif 'br' in enc:
            import brotli
            body = brotli.decompress(body)
    except Exception:
        pass  # 解压失败则按原始字节处理, 不要崩溃
    return body.decode('utf-8', errors='replace')


def http_get(url: str, headers: dict = None, timeout: int = 30, cookie: str = '') -> tuple:
    """发送 GET 请求，返回 (status_code, body)"""
    default_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
    }
    if headers:
        default_headers.update(headers)
    if cookie:
        default_headers['Cookie'] = cookie

    req = urllib.request.Request(url, headers=default_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
            return resp.status, _decode_body(resp, resp.read())
    except urllib.error.HTTPError as e:
        body = _decode_body(e, e.read()) if e.fp else ''
        return e.code, body
    except Exception as e:
        return 0, str(e)


def http_post(url: str, data: dict = None, headers: dict = None, timeout: int = 30) -> tuple:
    """发送 POST 请求，返回 (status_code, body)"""
    default_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Encoding': 'gzip, deflate',
    }
    if headers:
        default_headers.update(headers)

    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=default_headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
            return resp.status, _decode_body(resp, resp.read())
    except urllib.error.HTTPError as e:
        body = _decode_body(e, e.read()) if e.fp else ''
        return e.code, body
    except Exception as e:
        return 0, str(e)


def http_post_json(url: str, data: dict = None, headers: dict = None, timeout: int = 30) -> tuple:
    """发送 JSON POST 请求 (阿里云盘等需要 application/json)"""
    default_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
    }
    if headers:
        default_headers.update(headers)

    body = json.dumps(data or {}).encode('utf-8') if data is not None else None
    req = urllib.request.Request(url, data=body, headers=default_headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
            return resp.status, _decode_body(resp, resp.read())
    except urllib.error.HTTPError as e:
        body = _decode_body(e, e.read()) if e.fp else ''
        return e.code, body
    except Exception as e:
        return 0, str(e)


# ==================== 蓝奏云解析 ====================

def parse_lanzou(url: str, password: str = '') -> dict:
    """
    蓝奏云解析 — 直接从页面提取直链
    蓝奏云不需要密码即可下载(除非分享者设置)
    """
    status, html = http_get(url)
    if status != 200:
        return {'success': False, 'error': f'页面访问失败 (HTTP {status})'}

    # 方法1: 查找 iframe src
    iframe_match = re.search(r'<iframe\s+[^>]*src="([^"]+)"', html)
    if iframe_match:
        iframe_url = urllib.parse.urljoin(url, iframe_match.group(1))
        _, iframe_html = http_get(iframe_url)

        # 在 iframe 页面中查找签名参数
        sign_match = re.search(r"'sign'\s*:\s*'([^']+)'", iframe_html)
        if not sign_match:
            sign_match = re.search(r'sign\s*=\s*"([^"]+)"', iframe_html)

        if sign_match:
            sign = sign_match.group(1)
            # 构造下载请求
            domain_match = re.search(r'(https?://[^/]+)', iframe_url)
            domain = domain_match.group(1) if domain_match else 'https://www.lanzoux.com'

            post_data = {'sign': sign, 'action': 'downprocess', 'ves': '1'}
            if password:
                post_data['pwd'] = password

            _, down_html = http_post(f'{domain}/ajaxm.php', post_data,
                                     headers={'Referer': iframe_url, 'X-Requested-With': 'XMLHttpRequest'})
            try:
                down_data = json.loads(down_html)
                if down_data.get('zt') == '1' or down_data.get('zt') == 1:
                    dom = down_data.get('dom', '')
                    file_path = down_data.get('url', '')
                    # dom 可能是 "https://域名/" 格式
                    if dom and file_path:
                        direct_url = f'{dom}/file/{file_path}' if not file_path.startswith('http') else file_path
                    else:
                        direct_url = dom

                    filename = ''
                    fn_match = re.search(r'/([^/?]+\.[a-zA-Z0-9]{2,4})', file_path or '')
                    if fn_match:
                        filename = fn_match.group(1)

                    return {
                        'success': True,
                        'direct_url': direct_url,
                        'filename': filename,
                        'netdisk_type': 'lanzou',
                    }
                else:
                    return {'success': False, 'error': down_data.get('inf', '蓝奏云解析失败')}
            except json.JSONDecodeError:
                pass

    # 方法2: 直接从页面源码提取下载链接
    down_match = re.search(r'(https?://[^\s"\'<>]+\.lanzou[a-z]?.com/[^\s"\'<>]+)', html)
    if down_match:
        return {'success': True, 'direct_url': down_match.group(1), 'netdisk_type': 'lanzou'}

    # 方法3: 查找 var (参数) 模式
    var_matches = re.findall(r'var\s+(\w+)\s*=\s*["\']([^"\']+)["\']', html)
    params = {k: v for k, v in var_matches}

    if 'sign' in params or 'websign' in params:
        sign_key = 'sign' if 'sign' in params else 'websign'
        sign_val = params[sign_key]

        # 尝试找到基础 URL
        base_match = re.search(r'(https?://[^"\']+/)', url)
        base = base_match.group(1) if base_match else 'https://www.lanzoux.com'

        post_data = {sign_key: sign_val, 'action': 'downprocess', 'ves': '1'}
        if password:
            post_data['pwd'] = password

        _, down_html = http_post(f'{base}ajaxm.php', post_data)
        try:
            down_data = json.loads(down_html)
            if str(down_data.get('zt')) == '1':
                dom = down_data.get('dom', '')
                file_path = down_data.get('url', '')
                direct_url = f'{dom}/file/{file_path}' if dom and file_path else dom
                return {'success': True, 'direct_url': direct_url, 'netdisk_type': 'lanzou'}
        except json.JSONDecodeError:
            pass

    return {'success': False, 'error': '蓝奏云解析失败: 无法提取下载链接'}


# ==================== 百度网盘解析 ====================

BAIDU_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')


def _baidu_rc4_sign(key: str, data: str) -> str:
    """百度签名算法: base64(rc4(sign3, sign1)) — 与官方 gettemplatevariable sign2 一致"""
    import base64 as _b64
    v = len(key)
    a = [ord(key[q % v]) for q in range(256)]
    p = list(range(256))
    u = 0
    for q in range(256):
        u = (u + p[q] + a[q]) % 256
        p[q], p[u] = p[u], p[q]
    out = []
    i = u = 0
    for q in range(len(data)):
        i = (i + 1) % 256
        u = (u + p[i]) % 256
        p[i], p[u] = p[u], p[i]
        out.append(ord(data[q]) ^ p[(p[i] + p[u]) % 256])
    return _b64.b64encode(bytes(out)).decode()


def parse_baidu(url: str, password: str = '') -> dict:
    """
    百度网盘解析
    ★ 2026-08 方案: 分享直链/加密列表已被官方风控封死, 改走"转存到自己网盘→自己网盘直链":
      1. share/list 取 share_id/uk/fs_id/path
      2. share/transfer (ondup=newcopy) 转存到自己网盘根目录 → to_fs_id
      3. gettemplatevariable → sign1/sign3 → 计算签名(rc4+base64)
      4. /api/download 拿自己网盘的 dlink
      该流程不触发 sharedownload 的加密列表与图形验证码风控。
    """
    cookie = load_cookie('baidu')
    if not cookie:
        return {'success': False, 'error': '百度网盘需要登录后才能解析。请先使用 netdisk_login 工具扫码登录(服务=baidu)。Step 1: netdisk_login(action="qr", service="baidu") → 获取二维码; Step 2: 扫码后 netdisk_login(action="poll", service="baidu", sign=返回的sign) → 获取Cookie'}
    headers = {
        'User-Agent': BAIDU_UA,
        'Referer': url,
        'Cookie': cookie,
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
    }

    # 提取 shorturl
    surl_match = re.search(r'/s/([0-9A-Za-z_-]+)', url)
    if not surl_match:
        return {'success': False, 'error': '无法提取百度网盘分享ID'}
    surl = surl_match.group(1)
    # ★ share/list 用的 shorturl 要去掉 /s/ 后的类型前缀 "1" (如 /s/1dG1NCeH → dG1NCeH)
    surl_list = surl[1:] if surl.startswith('1') else surl

    # 0. 获取 bdstoken (share/list 需要, 否则返回 errno=140)
    status, resp = http_get(
        'https://pan.baidu.com/api/gettemplatevariable?fields=%5B%22bdstoken%22%5D'
        '&channel=chunlei&web=1&app_id=250528&clienttype=0',
        headers=headers,
    )
    bdstoken = ''
    try:
        bdstoken = (json.loads(resp).get('result') or {}).get('bdstoken', '')
    except json.JSONDecodeError:
        pass
    if not bdstoken:
        return {'success': False, 'error': '百度网盘获取 bdstoken 失败, 可能需要重新登录'}
    logid = f'codex{int(time.time()*1000)}'

    # 1. share/list → share_id / uk / fs_id / path
    status, resp = http_get(
        f'https://pan.baidu.com/share/list?web=5&app_id=250528&desc=1&showempty=0'
        f'&page=1&num=20&order=time&shorturl={surl_list}&root=1&view_mode=1'
        f'&channel=chunlei&web=1&bdstoken={bdstoken}&logid={logid}&clienttype=0&dp-logid={int(time.time()*1000)}',
        headers=headers,
    )
    try:
        list_data = json.loads(resp)
    except json.JSONDecodeError:
        return {'success': False, 'error': f'百度网盘接口返回异常 (HTTP {status})'}
    if list_data.get('errno') != 0:
        msg = list_data.get('show_msg') or ''
        if '密码' in msg or 'pwd' in msg.lower():
            return {'success': False, 'error': '此分享需要提取码, 请提供 password 参数'}
        return {'success': False, 'error': f"百度网盘分享无效或已失效: {msg or list_data.get('errno')}"}
    share_id = list_data.get('share_id', '')
    share_uk = list_data.get('uk', '')
    items = list_data.get('list') or []
    if not items:
        return {'success': False, 'error': '百度网盘分享中没有文件'}

    # 支持文件夹: 自动进入第一个文件夹找文件 (share/list 支持 dir)
    item = items[0]
    for _depth in range(4):
        if str(item.get('isdir')) == '1':
            status, resp = http_get(
                f'https://pan.baidu.com/share/list?web=5&app_id=250528&desc=1&showempty=0'
                f'&page=1&num=20&order=time&shorturl={surl_list}&root=0&dir={urllib.parse.quote(item.get("path", ""))}'
                f'&channel=chunlei&web=1&bdstoken={bdstoken}&logid={logid}&clienttype=0&dp-logid={int(time.time()*1000)}',
                headers=headers,
            )
            try:
                sub = json.loads(resp)
                sub_items = sub.get('list') or []
                if not sub_items:
                    break
                item = sub_items[0]
            except json.JSONDecodeError:
                break
        else:
            break
    if str(item.get('isdir')) == '1':
        return {'success': False, 'error': '百度网盘分享中未找到文件'}

    fs_id = item.get('fs_id', '')
    file_path = item.get('path', '')
    file_name = item.get('server_filename', '')
    file_size = item.get('size', 0)
    if not fs_id or not share_id or not share_uk:
        return {'success': False, 'error': '百度网盘文件信息不完整'}

    # 2. 转存到自己网盘 (ondup=newcopy 强制新建副本, 避免复用旧文件/过期dlink)
    status, resp = http_post(
        f'https://pan.baidu.com/share/transfer?shareid={share_id}&from={share_uk}&sekey=undefined'
        f'&channel=chunlei&web=1&app_id=250528&bdstoken={bdstoken}&logid={logid}&clienttype=0&dp-logid={int(time.time()*1000)}',
        {'fsidlist': json.dumps([fs_id]), 'path': '/', 'ondup': 'newcopy'},
        headers=headers,
    )
    try:
        transfer_data = json.loads(resp)
    except json.JSONDecodeError:
        return {'success': False, 'error': f'百度网盘转存接口返回异常 (HTTP {status})'}
    to_fs_id = ''
    to_path = ''
    if transfer_data.get('errno') == 0:
        tr_list = (transfer_data.get('extra') or {}).get('list') or []
        if tr_list:
            to_fs_id = tr_list[0].get('to_fs_id', '')
            to_path = tr_list[0].get('to', '')
    elif transfer_data.get('duplicated'):
        dup_list = transfer_data['duplicated'].get('list') or []
        if dup_list:
            to_fs_id = dup_list[0].get('fsid', '')
            to_path = dup_list[0].get('path', '')
    if not to_fs_id:
        return {'success': False, 'error': f"百度网盘转存失败: {transfer_data.get('show_msg') or transfer_data.get('errno')}"}

    # 3. 计算签名 + 4. /api/download 拿直链
    status, resp = http_get(
        'https://pan.baidu.com/api/gettemplatevariable?fields=%5B%22sign1%22%2C%22sign2%22%2C%22sign3%22%2C%22timestamp%22%5D'
        '&channel=chunlei&web=1&app_id=250528&clienttype=0',
        headers=headers,
    )
    try:
        tpl = (json.loads(resp).get('result') or {})
    except json.JSONDecodeError:
        return {'success': False, 'error': '百度网盘获取签名失败'}
    sign1 = tpl.get('sign1', '')
    sign3 = tpl.get('sign3', '')
    timestamp = tpl.get('timestamp', '')
    if not sign1 or not sign3 or not timestamp:
        return {'success': False, 'error': '百度网盘签名参数缺失'}
    sign = _baidu_rc4_sign(sign3, sign1)

    status, resp = http_get(
        f'https://pan.baidu.com/api/download?channel=chunlei&clienttype=0&web=1&app_id=250528'
        f'&sign={urllib.parse.quote(sign)}&timestamp={timestamp}'
        f'&fidlist={urllib.parse.quote(json.dumps([str(to_fs_id)]))}&type=dlink&vip=1',
        headers=headers,
    )
    try:
        dl_data = json.loads(resp)
    except json.JSONDecodeError:
        return {'success': False, 'error': f'百度网盘获取下载链接失败 (HTTP {status})'}
    dl_list = dl_data.get('dlink') or []
    dlink = dl_list[0].get('dlink', '') if isinstance(dl_list, list) and dl_list else ''
    if not dlink:
        msg = dl_data.get('show_msg') or dl_data.get('errno')
        return {'success': False, 'error': f'百度网盘获取直链失败(文件可能被版权风控标记): {msg}'}

    # 5. 尽力清理转存到自己网盘的副本 (删除可能被安全验证拦截, 失败则保留)
    if to_path:
        try:
            http_post(
                f'https://pan.baidu.com/api/filemanager?opera=delete&async=2&onnest=fail'
                f'&channel=chunlei&web=1&app_id=250528&bdstoken={bdstoken}&logid={logid}&clienttype=0',
                {'filelist': json.dumps([{'path': to_path}])},
                headers=headers,
            )
        except Exception:
            pass

    return {
        'success': True,
        'direct_url': dlink,
        'filename': file_name,
        'file_size': file_size,
        'netdisk_type': 'baidu',
        'method': 'transfer-own-drive',
        'headers': {
            'Cookie': cookie,
            'Referer': 'https://pan.baidu.com/',
            'User-Agent': BAIDU_UA,
        },
    }


# ==================== 夸克网盘解析 ====================

# ★ 夸克接口要求客户端专属UA (网页UA会被风控/拒绝, 转存token校验会报41020)
QUARK_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            '(KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 '
            'Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch')
QUARK_API = 'https://drive-pc.quark.cn/1/clouddrive'


def _make_quark_session(cookie_str: str):
    """创建带Cookie会话(自动捕获服务端下发的 __puus 等轮换Cookie)"""
    jar = http.cookiejar.CookieJar()
    for kv in (cookie_str or '').split('; '):
        if '=' not in kv:
            continue
        k, v = kv.split('=', 1)
        k, v = k.strip(), v.strip()
        if not k or not v:
            continue
        try:
            c = http.cookiejar.Cookie(
                version=0, name=k, value=v,
                port=None, port_specified=False,
                domain='.quark.cn', domain_specified=True, domain_initial_dot=True,
                path='/', path_specified=True, secure=False, expires=None,
                discard=True, comment=None, comment_url=None, rest={}, rfc2109=False,
            )
            jar.set_cookie(c)
        except Exception:
            pass
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def _req(url, data=None, timeout=30):
        h = {
            'User-Agent': QUARK_UA,
            'Referer': 'https://pan.quark.cn/',
            'Accept': 'application/json, text/plain, */*',
        }
        body = None
        if data is not None:
            body = json.dumps(data).encode('utf-8')
            h['Content-Type'] = 'application/json'
        req = urllib.request.Request(url, data=body, headers=h, method='POST' if data is not None else 'GET')
        try:
            resp = opener.open(req, timeout=timeout)
            return resp.status, resp.read().decode('utf-8', errors='replace')
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode('utf-8', errors='replace')
        except Exception as e:
            return 0, str(e)

    def _cookie_str():
        parts = []
        for c in jar:
            if c.domain and 'quark' in c.domain:
                parts.append(f'{c.name}={c.value}')
        return '; '.join(parts)

    return _req, _cookie_str


def parse_quark(url: str, password: str = '') -> dict:
    """
    夸克网盘解析
    ★ 2026-08: 夸克已取消分享页直链接口, 现方案与 gopeed 官方扩展一致:
      1. token → stoken
      2. detail → 找到第一个文件(fid + share_fid_token), 文件夹自动进入
      3. save 转存到自己网盘根目录 → 轮询 task 直到完成
      4. file/download 拿自己网盘的直链
      5. file/delete 清理转存的临时文件
    """
    cookie = load_cookie('quark')
    if not cookie:
        return {'success': False, 'error': '夸克网盘需要登录后才能解析。请先使用 netdisk_login 工具扫码登录(服务=quark)。Step 1: netdisk_login(action="qr", service="quark") → 获取二维码; Step 2: 扫码后 netdisk_login(action="poll", service="quark", qr_token=返回的qr_token) → 保存Cookie'}
    status, html = http_get(url, cookie=cookie)
    if status != 200:
        return {'success': False, 'error': f'页面访问失败 (HTTP {status})'}

    # 提取 pwd_id
    pwd_id_match = re.search(r'/s/([a-zA-Z0-9]+)', url)
    if not pwd_id_match:
        return {'success': False, 'error': '无法提取分享ID'}
    pwd_id = pwd_id_match.group(1)

    # ★ 会话内自动刷新 __puus (直链下载必须带最新值, 否则CDN回调403)
    qk_req, qk_cookie_str = _make_quark_session(cookie)

    # 1. token
    _, token_resp = qk_req(f'{QUARK_API}/share/sharepage/token?pr=ucpro&fr=pc',
                           {'pwd_id': pwd_id, 'passcode': password or ''})
    try:
        token_data = json.loads(token_resp)
    except json.JSONDecodeError:
        return {'success': False, 'error': '夸克网盘接口返回异常'}
    stoken = (token_data.get('data') or {}).get('stoken', '')
    if not stoken:
        msg = token_data.get('message', '')
        return {'success': False, 'error': f'夸克网盘解析失败: {msg or "分享链接无效或已过期"}'}

    # 2. detail + 文件夹导航, 找第一个文件
    def _list_dir(pdir_fid: str):
        detail_url = (
            f'{QUARK_API}/share/sharepage/detail?pwd_id={pwd_id}'
            f'&stoken={urllib.parse.quote(stoken)}&pdir_fid={pdir_fid}&force=0'
            f'&_page=1&_size=50&_sort=file_type%3Aasc%2Cupdated_at%3Adesc&_fetch_total=1&pr=ucpro&fr=pc'
        )
        _, resp = qk_req(detail_url)
        try:
            data = json.loads(resp)
            return (data.get('data') or {}).get('list') or []
        except json.JSONDecodeError:
            return []

    file_info = None
    folder_stack = []
    for _depth in range(4):
        items = _list_dir(folder_stack[-1] if folder_stack else '0')
        found = None
        for it in items:
            if it.get('file_type') != 0:  # 0=文件夹
                found = it
                break
        if found:
            file_info = found
            break
        # 全文件夹: 进入第一个文件夹
        for it in items:
            if it.get('file_type') == 0:
                folder_stack.append(it.get('fid', ''))
                break
        else:
            break

    if not file_info:
        return {'success': False, 'error': '夸克网盘分享中没有找到文件'}
    share_fid = file_info.get('fid', '')
    share_fid_token = file_info.get('share_fid_token', '')
    if not share_fid or not share_fid_token:
        return {'success': False, 'error': '夸克网盘文件缺少转存参数(share_fid_token)'}

    def _make_folder():
        """创建唯一临时文件夹(避免夸克全盘按内容去重复用失效fid)"""
        folder_name = f'qp_{int(time.time()*1000)}_{share_fid[:6]}'
        _, mk_resp = qk_req(
            f'{QUARK_API}/file?pr=ucpro&fr=pc',
            {'file_name': folder_name, 'pdir_fid': '0', 'dir_init_lock': False, 'dir_path': ''},
        )
        try:
            mk = json.loads(mk_resp)
            return (mk.get('data') or {}).get('fid', '')
        except json.JSONDecodeError:
            return ''

    def _save_into(folder_fid):
        """转存分享文件到指定文件夹, 返回任务ID"""
        _, save_resp = qk_req(
            f'{QUARK_API}/share/sharepage/save?pr=ucpro&fr=pc',
            {
                'scene': 'link', 'pdir_fid': '0', 'pwd_id': pwd_id, 'stoken': stoken,
                'fid_list': [share_fid], 'fid_token_list': [share_fid_token],
                'to_pdir_fid': folder_fid,
            },
        )
        try:
            save_data = json.loads(save_resp)
            return (save_data.get('data') or {}).get('task_id', '')
        except json.JSONDecodeError:
            return ''

    def _wait_task(task_id):
        """轮询转存任务, 返回保存后的文件fid"""
        for _ in range(30):
            _, task_resp = qk_req(
                f'{QUARK_API}/task?task_id={task_id}&retry_index=0&pr=ucpro&fr=pc',
            )
            try:
                tdata = (json.loads(task_resp).get('data') or {})
            except json.JSONDecodeError:
                break
            if tdata.get('status') == 2:
                save_as = tdata.get('save_as') or {}
                fids = save_as.get('save_as_select_top_fids') or save_as.get('save_as_top_fids') or []
                if fids:
                    return fids[0]
                break
            time.sleep(1)
        return ''

    def _cleanup(folder_fid):
        """删除临时文件夹并彻底清除回收站记录"""
        try:
            qk_req(
                f'{QUARK_API}/file/delete?pr=ucpro&fr=pc',
                {'action_type': 2, 'exclude_fids': [], 'filelist': [folder_fid]},
            )
        except Exception:
            pass
        time.sleep(1)
        try:
            _, rc_resp = qk_req(
                f'{QUARK_API}/file/recycle/list?pdir_fid=0&force=0&_page=1&_size=50'
                f'&_sort=move_recycle_at%3Adesc&_fetch_total=1&pr=ucpro&fr=pc',
            )
            rc = json.loads(rc_resp)
            records = []
            for it in (rc.get('data') or {}).get('list') or []:
                if it.get('fid') == folder_fid or (it.get('file_name') or '').startswith('qp_'):
                    if it.get('record_id'):
                        records.append(it['record_id'])
            if records:
                qk_req(
                    f'{QUARK_API}/file/recycle/remove?pr=ucpro&fr=pc',
                    {'select_mode': 2, 'record_list': records},
                )
        except Exception:
            pass

    def _download(fid):
        """获取自己网盘文件的直链"""
        _, dl_resp = qk_req(
            f'{QUARK_API}/file/download?pr=ucpro&fr=pc',
            {'fids': [fid]},
        )
        dl_data = json.loads(dl_resp)
        dl_list = dl_data.get('data') or []
        if isinstance(dl_list, list) and dl_list and dl_list[0].get('download_url'):
            return dl_list[0]
        return None

    # 3. 建临时文件夹 → 转存 → 轮询 → 下载 (失败则重建文件夹重试一次)
    item = None
    folder_fid = ''
    for attempt in range(2):
        folder_fid = _make_folder()
        if not folder_fid:
            break
        task_id = _save_into(folder_fid)
        saved_fid = _wait_task(task_id) if task_id else ''
        if saved_fid:
            item = _download(saved_fid)
        if item:
            break
        _cleanup(folder_fid)
        time.sleep(1)

    # 6. 清理临时文件夹
    if folder_fid:
        _cleanup(folder_fid)

    if item:
        # ★ 保存最新Cookie(含刷新后的__puus)供下载使用, 并随结果返回请求头
        fresh_cookie = qk_cookie_str() or cookie
        try:
            COOKIE_DIR.mkdir(parents=True, exist_ok=True)
            QUARK_COOKIE.write_text(fresh_cookie)
            try:
                import grp
                QUARK_COOKIE.chmod(0o640)
                import os as _os
                _os.chown(str(QUARK_COOKIE), -1, grp.getgrnam('www-data').gr_gid)
            except Exception:
                pass
        except Exception:
            pass
        return {
            'success': True,
            'direct_url': item['download_url'],
            'filename': item.get('file_name') or file_info.get('file_name', ''),
            'file_size': item.get('size') or file_info.get('size', 0),
            'netdisk_type': 'quark',
            'headers': {
                'Cookie': fresh_cookie,
                'Referer': 'https://pan.quark.cn/',
                'User-Agent': QUARK_UA,
            },
        }
    return {'success': False, 'error': '夸克网盘获取直链失败(可能空间不足或触发限流)'}


# ==================== 阿里云盘解析 ====================

ALIYUN_API = 'https://api.aliyundrive.com'


def parse_aliyun(url: str, password: str = '') -> dict:
    """
    阿里云盘解析
    ★ 2026-08: 官方已下线分享直链下载接口(aligo库同样实现为NotImplementedError),
      现方案与夸克一致: 转存(复制)到自己网盘 → 取直链 → 清理临时文件。
    流程: refresh_token → access_token → get_share_token → list_by_share →
          file/copy(转存) → file/get_download_url(自己网盘直链) → recyclebin/trash(清理)
    ★ 使用已保存的 .aliyun_token (由 aliyun-login.py 扫码登录生成)
    """
    token_str = load_cookie('aliyun')
    if not token_str:
        return {'success': False, 'error': '阿里云盘需要登录后才能解析。请先使用 netdisk_login 工具扫码登录(服务=aliyun)。Step 1: netdisk_login(action="qr", service="aliyun") → 获取二维码; Step 2: 扫码后 netdisk_login(action="poll", service="aliyun", ck_code=返回的ck_code) → 保存Token'}
    try:
        token_data = json.loads(token_str)
    except json.JSONDecodeError:
        return {'success': False, 'error': '阿里云盘Token文件损坏, 请重新扫码登录'}

    refresh_token = token_data.get('refresh_token', '')
    if not refresh_token:
        return {'success': False, 'error': '阿里云盘缺少 refresh_token, 请重新扫码登录'}

    # 1. refresh_token → access_token
    status, body = http_post_json(
        f'{ALIYUN_API}/v2/account/token',
        {'grant_type': 'refresh_token', 'refresh_token': refresh_token},
    )
    try:
        token_data2 = json.loads(body)
    except json.JSONDecodeError:
        return {'success': False, 'error': f'阿里云盘Token刷新失败 (HTTP {status})'}
    access_token = token_data2.get('access_token', '')
    if not access_token:
        return {'success': False, 'error': f"阿里云盘Token已失效: {token_data2.get('message', '') or '请重新扫码登录'}"}
    default_drive_id = token_data2.get('default_drive_id', '')
    # 保存刷新后的Token
    try:
        COOKIE_DIR.mkdir(parents=True, exist_ok=True)
        ALIYUN_TOKEN.write_text(json.dumps({
            'refresh_token': token_data2.get('refresh_token', refresh_token),
            'access_token': access_token,
            'expires_in': token_data2.get('expires_in', 7200),
            'saved_at': time.time(),
            'nickname': token_data2.get('nick_name', ''),
        }, ensure_ascii=False))
        try:
            import grp, os
            ALIYUN_TOKEN.chmod(0o640)
            os.chown(str(ALIYUN_TOKEN), -1, grp.getgrnam('www-data').gr_gid)
        except Exception:
            pass
    except Exception:
        pass

    # 2. 提取 share_id
    share_id_match = re.search(r'/s/([a-zA-Z0-9]{10,})', url)
    if not share_id_match:
        return {'success': False, 'error': '无法提取阿里云盘分享ID'}
    share_id = share_id_match.group(1)

    auth_headers = {
        'Authorization': f'Bearer {access_token}',
    }

    # 3. 检查分享是否存在 + 获取 share_token (新版接口带 _link)
    status, body = http_post_json(
        f'{ALIYUN_API}/adrive/v3/share_link/get_share_by_anonymous',
        {'share_id': share_id},
        headers=auth_headers,
    )
    try:
        share_info = json.loads(body)
    except json.JSONDecodeError:
        return {'success': False, 'error': f'阿里云盘分享信息获取失败 (HTTP {status})'}
    if share_info.get('has_pwd') and not password:
        return {'success': False, 'error': '此分享需要提取码(密码), 请提供 password 参数'}

    status, body = http_post_json(
        f'{ALIYUN_API}/v2/share_link/get_share_token',
        {'share_id': share_id, 'share_pwd': password or ''},
        headers=auth_headers,
    )
    try:
        share_data = json.loads(body)
    except json.JSONDecodeError:
        return {'success': False, 'error': f'阿里云盘获取分享Token失败 (HTTP {status})'}
    share_token = share_data.get('share_token', '')
    if not share_token:
        msg = share_data.get('message', '') or share_data.get('code', '')
        if '密码' in msg or 'pwd' in msg.lower() or 'Pwd' in msg:
            return {'success': False, 'error': '提取码错误, 请检查 password 参数'}
        return {'success': False, 'error': f'阿里云盘分享Token获取失败: {msg or "分享链接无效或已过期"}'}

    share_headers = {**auth_headers, 'X-Share-Token': share_token}

    # 4. 文件列表(文件夹自动进入, 找第一个文件)
    def _list_share(pdir_fid):
        s, b = http_post_json(
            f'{ALIYUN_API}/adrive/v2/file/list_by_share',
            {'share_id': share_id, 'parent_file_id': pdir_fid, 'limit': 100},
            headers=share_headers,
        )
        try:
            return (json.loads(b).get('items') or [])
        except json.JSONDecodeError:
            return []

    file_info = None
    folder_stack = []
    for _depth in range(4):
        items = _list_share(folder_stack[-1] if folder_stack else 'root')
        found = None
        for it in items:
            if it.get('type') != 'folder':
                found = it
                break
        if found:
            file_info = found
            break
        for it in items:
            if it.get('type') == 'folder':
                folder_stack.append(it.get('file_id', ''))
                break
        else:
            break

    if not file_info:
        return {'success': False, 'error': '阿里云盘分享中没有找到文件'}
    share_file_id = file_info.get('file_id', '')
    file_name = file_info.get('name', '')
    file_size = file_info.get('size', 0)

    # 5. 转存(复制)到自己网盘根目录
    if not default_drive_id:
        return {'success': False, 'error': '阿里云盘缺少 default_drive_id, 请重新登录'}
    status, body = http_post_json(
        f'{ALIYUN_API}/v2/file/copy',
        {
            'file_id': share_file_id,
            'share_id': share_id,
            'to_parent_file_id': 'root',
            'to_drive_id': default_drive_id,
            'auto_rename': True,
        },
        headers=share_headers,
    )
    try:
        copy_data = json.loads(body)
    except json.JSONDecodeError:
        return {'success': False, 'error': f'阿里云盘转存失败 (HTTP {status})'}
    new_file_id = copy_data.get('file_id', '')
    if not new_file_id:
        msg = copy_data.get('message', '') or copy_data.get('code', '')
        return {'success': False, 'error': f'阿里云盘转存失败: {msg or "未知错误"}'}

    # 6. 获取自己网盘的下载直链
    #    ★ get_download_url 对 >100MB 的文件返回空url, 需用 /v2/file/walk + url_expire_sec 兜底
    direct_url = ''
    try:
        status, body = http_post_json(
            f'{ALIYUN_API}/v2/file/get_download_url',
            {'drive_id': default_drive_id, 'file_id': new_file_id, 'expire_sec': 600},
            headers=auth_headers,
        )
        dl_data = json.loads(body)
        direct_url = dl_data.get('url', '') or ''
    except Exception:
        pass
    if not direct_url:
        try:
            status, body = http_post_json(
                f'{ALIYUN_API}/v2/file/walk',
                {'parent_file_id': 'root', 'drive_id': default_drive_id, 'url_expire_sec': 86400, 'limit': 100},
                headers=auth_headers,
            )
            walk_data = json.loads(body)
            for it in (walk_data.get('items') or []):
                if it.get('file_id') == new_file_id and it.get('url'):
                    direct_url = it['url']
                    break
        except Exception:
            pass

    # 7. 清理转存的临时文件(移到回收站)
    try:
        http_post_json(
            f'{ALIYUN_API}/v2/recyclebin/trash',
            {'drive_id': default_drive_id, 'file_id': new_file_id},
            headers=auth_headers,
        )
    except Exception:
        pass

    if not direct_url:
        return {'success': False, 'error': '阿里云盘未返回下载直链(文件可能过大或受限)'}

    return {
        'success': True,
        'direct_url': direct_url,
        'filename': file_name,
        'file_size': file_size,
        'netdisk_type': 'aliyun',
    }


# ==================== 天翼云盘解析 ====================

def parse_tianyi(url: str, password: str = '') -> dict:
    """天翼云盘解析"""
    status, html = http_get(url)
    if status != 200:
        return {'success': False, 'error': f'页面访问失败 (HTTP {status})'}

    # 提取 shareId
    share_id_match = re.search(r'/web/shareId/([a-zA-Z0-9]+)', url)
    if not share_id_match:
        share_id_match = re.search(r'shareId=([a-zA-Z0-9]+)', url)
    if not share_id_match:
        return {'success': False, 'error': '无法提取天翼云分享ID'}

    share_id = share_id_match.group(1)

    # 天翼云 API
    api_url = f'https://cloud.189.cn/api/v2.1/share/getShareInfoByCodeV2?shareCode={share_id}&accessCode={password}'
    _, api_resp = http_get(api_url)

    try:
        api_data = json.loads(api_resp)
        if api_data.get('res_code') == 0 and api_data.get('file_list'):
            file_info = api_data['file_list'][0]
            file_id = file_info.get('id')

            # 获取下载链接
            dl_url = f'https://cloud.189.cn/api/v2.1/share/getFileDownloadUrl.action?fileId={file_id}&shareId={share_id}'
            _, dl_resp = http_get(dl_url)
            dl_data = json.loads(dl_resp)

            if dl_data.get('fileDownloadUrl'):
                return {
                    'success': True,
                    'direct_url': dl_data['fileDownloadUrl'],
                    'filename': file_info.get('name', ''),
                    'file_size': file_info.get('size', 0),
                    'netdisk_type': 'tianyi',
                }
    except json.JSONDecodeError:
        pass

    return {'success': False, 'error': '天翼云盘解析失败: 链接可能需要密码或已过期'}


# ==================== 通用解析入口 ====================

def parse_netdisk(url: str, password: str = '') -> dict:
    """通用网盘解析入口"""
    netdisk_type = identify_type(url)

    parsers = {
        'lanzou': parse_lanzou,
        'ilanzou': parse_lanzou,
        'baidu': parse_baidu,
        'quark': parse_quark,
        'aliyun': parse_aliyun,
        'tianyi': parse_tianyi,
    }

    parser = parsers.get(netdisk_type)
    if parser:
        return parser(url, password)

    return {
        'success': False,
        'error': f'暂不支持的网盘类型: {netdisk_type} (已识别类型: {netdisk_type})',
    }


# ==================== 主入口 ====================

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': '用法: python3 netdisk_parser.py <url> [password]'}))
        sys.exit(1)

    target_url = sys.argv[1]
    pwd = sys.argv[2] if len(sys.argv) > 2 else ''

    result = parse_netdisk(target_url, pwd)
    print(json.dumps(result, ensure_ascii=False))
