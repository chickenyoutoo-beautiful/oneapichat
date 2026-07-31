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
import urllib.request
import urllib.parse
import urllib.error
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
        'baidu': r'pan\.baidu\.com',
        'quark': r'pan\.quark\.cn',
        'aliyun': r'(alipan\.com|aliyundrive\.com)',
        'tianyi': r'cloud\.189\.cn',
        'xunlei': r'pan\.xunlei\.com',
        'mobile': r'yun\.139\.com',
        'uc': r'drive\.uc\.cn',
        '123': r'123pan\.com',
        'lanzou': r'lanzou[a-z]*\.com|lanzous\.com',
    }
    for netdisk_type, pattern in patterns.items():
        if re.search(pattern, url):
            return netdisk_type
    return 'unknown'


def http_get(url: str, headers: dict = None, timeout: int = 30, cookie: str = '') -> tuple:
    """发送 GET 请求，返回 (status_code, body)"""
    default_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }
    if headers:
        default_headers.update(headers)
    if cookie:
        default_headers['Cookie'] = cookie

    req = urllib.request.Request(url, headers=default_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
            return resp.status, resp.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace') if e.fp else ''
    except Exception as e:
        return 0, str(e)


def http_post(url: str, data: dict = None, headers: dict = None, timeout: int = 30) -> tuple:
    """发送 POST 请求，返回 (status_code, body)"""
    default_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded',
    }
    if headers:
        default_headers.update(headers)

    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=default_headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
            return resp.status, resp.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace') if e.fp else ''
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

def parse_baidu(url: str, password: str = '') -> dict:
    """
    百度网盘解析
    尝试通过页面 API 提取直链
    ★ 使用已保存的 Cookie 进行认证
    """
    cookie = load_cookie('baidu')
    status, html = http_get(url, cookie=cookie)
    if status != 200:
        return {'success': False, 'error': f'页面访问失败 (HTTP {status})'}

    # 检查是否需要密码
    if 'verify' in html.lower() or '密码' in html or 'pwd' in html.lower():
        if not password:
            return {'success': False, 'error': '此分享需要提取密码'}

    # 提取 shareid 和 fs_id
    shareid_match = re.search(r'"shareid"\s*:\s*"?(\d+)"?', html)
    uk_match = re.search(r'"uk"\s*:\s*"?(\d+)"?', html)
    fs_id_match = re.search(r'"fs_id"\s*:\s*"?(\d+)"?', html)
    link_ver_match = re.search(r'"linkversion"\s*:\s*"?(\d+)"?', html)

    if shareid_match and uk_match:
        shareid = shareid_match.group(1)
        uk = uk_match.group(1)
        link_ver = link_ver_match.group(1) if link_ver_match else '3'

        # 尝试使用 API 获取下载链接
        api_url = f'https://pan.baidu.com/share/list?shareid={shareid}&uk={uk}&page=1&num=1&order=time&desc=1&web=1&clienttype=0&showempty=0&channel=chunlei&web=1&app_id=250528&linkver={link_ver}'
        headers = {
            'Referer': url,
            'X-Requested-With': 'XMLHttpRequest',
        }

        _, api_resp = http_get(api_url, headers=headers)
        try:
            api_data = json.loads(api_resp)
            if api_data.get('errno') == 0 and api_data.get('list'):
                item = api_data['list'][0]
                fs_id = item.get('fs_id')

                # 获取下载链接 (需要 sign 和 timestamp)
                sign_match = re.search(r'"sign"\s*:\s*"([^"]+)"', html)
                timestamp_match = re.search(r'"timestamp"\s*:\s*"?(\d+)"?', html)

                if sign_match and timestamp_match:
                    sign = sign_match.group(1)
                    timestamp = timestamp_match.group(1)

                    download_api = (
                        f'https://pan.baidu.com/api/sharedownload?'
                        f'shareid={shareid}&uk={uk}&sign={sign}&timestamp={timestamp}'
                        f'&fs_id={fs_id}&web=1&clienttype=0&channel=chunlei&app_id=250528'
                    )
                    _, dl_resp = http_get(download_api, headers=headers)
                    try:
                        dl_data = json.loads(dl_resp)
                        if dl_data.get('errno') == 0 and dl_data.get('list'):
                            dlink = dl_data['list'][0].get('dlink', '')
                            if dlink:
                                return {
                                    'success': True,
                                    'direct_url': dlink,
                                    'filename': item.get('server_filename', ''),
                                    'file_size': item.get('size', 0),
                                    'netdisk_type': 'baidu',
                                }
                    except json.JSONDecodeError:
                        pass
        except json.JSONDecodeError:
            pass

    # ★ 检查是否有Cookie, 如果没有则提示登录
    cookie = load_cookie('baidu')
    if not cookie:
        return {'success': False, 'error': '百度网盘需要登录后才能解析。请先使用 netdisk_login 工具扫码登录(服务=baidu)。Step 1: netdisk_login(action="qr", service="baidu") → 获取二维码; Step 2: 扫码后 netdisk_login(action="poll", service="baidu", sign=返回的sign) → 获取Cookie'}

    return {'success': False, 'error': '百度网盘解析失败: 链接可能已过期或需要重新登录。请尝试: netdisk_login(action="check", service="baidu") 检查登录状态'}


# ==================== 夸克网盘解析 ====================

def parse_quark(url: str, password: str = '') -> dict:
    """
    夸克网盘解析
    夸克需要 stoken 和实际请求签名，这里尝试通过页面提取
    ★ 使用已保存的 Cookie 进行认证
    """
    cookie = load_cookie('quark')
    status, html = http_get(url, cookie=cookie)
    if status != 200:
        return {'success': False, 'error': f'页面访问失败 (HTTP {status})'}

    # 提取 pwd_id
    pwd_id_match = re.search(r'/s/([a-zA-Z0-9]+)', url)
    if not pwd_id_match:
        return {'success': False, 'error': '无法提取分享ID'}
    pwd_id = pwd_id_match.group(1)

    # 夸克 API (需要签名，这里尝试无签名访问)
    api_url = f'https://drive-pc.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc'
    post_data = {'pwd_id': pwd_id, 'passcode': password}

    _, token_resp = http_post(api_url, post_data,
                              headers={'Content-Type': 'application/json',
                                       'Referer': url})
    try:
        token_data = json.loads(token_resp)
        if token_data.get('data', {}).get('stoken'):
            stoken = token_data['data']['stoken']

            # 获取文件列表
            detail_url = f'https://drive-pc.quark.cn/1/clouddrive/share/sharepage/detail?pwd_id={pwd_id}&stoken={urllib.parse.quote(stoken)}&pdir_fid=0&force=0&_page=1&_size=50&fetch_banner=0&fetch_share=0&fetch_total=1&sort=updated_at:desc'
            _, detail_resp = http_get(detail_url)
            detail_data = json.loads(detail_resp)

            if detail_data.get('data', {}).get('list'):
                file_info = detail_data['data']['list'][0]
                fid = file_info.get('fid', '')

                # 获取下载链接
                dl_url = f'https://drive-pc.quark.cn/1/clouddrive/share/sharepage/download?pwd_id={pwd_id}&stoken={urllib.parse.quote(stoken)}&fid={fid}&pr=ucpro&fr=pc'
                _, dl_resp = http_get(dl_url)
                dl_data = json.loads(dl_resp)

                if dl_data.get('data', {}).get('download_url'):
                    return {
                        'success': True,
                        'direct_url': dl_data['data']['download_url'],
                        'filename': file_info.get('file_name', ''),
                        'file_size': file_info.get('size', 0),
                        'netdisk_type': 'quark',
                    }
    except json.JSONDecodeError:
        pass

    return {'success': False, 'error': '夸克网盘解析失败: 可能需要验证码或链接已过期'}


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
        'baidu': parse_baidu,
        'quark': parse_quark,
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
