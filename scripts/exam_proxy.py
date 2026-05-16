#!/usr/bin/env python3
"""超星考试透明代理 — 转发浏览器 Cookie，修改 HTML 绕过 appExamClientSign"""
import http.server, socketserver, requests, re, sys

PROXY_PORT = 8899
TARGET_HOST = "mooc1-api.chaoxing.com"

# ── 启动时从 Python 获取登录 cookies ──
def _load_session_cookies():
    """通过 Python API 登录并获取 cookies"""
    try:
        import configparser, glob as _g
        configs = sorted(_g.glob('/tmp/AutomaticCB/config_u_*.ini'), key=os.path.getmtime, reverse=True)
        if not configs: return {}
        cfg = configparser.ConfigParser()
        cfg.read(configs[0], encoding='utf8')
        sys.path.insert(0, '/var/www/html/oneapichat')
        from api.base import Account, Chaoxing, init_session
        acc = Account(cfg.get('common','username'), cfg.get('common','password'))
        api = Chaoxing(account=acc)
        lr = api.login()
        if lr['status']:
            s = init_session()
            cookies = {}
            for c in s.cookies:
                if c.domain and '.chaoxing.com' in c.domain:
                    cookies[c.name] = c.value
            print(f"[PROXY] Loaded {len(cookies)} session cookies")
            return cookies
    except Exception as e:
        print(f"[PROXY] Cookie load failed: {e}")
    return {}

class ExamProxy(http.server.BaseHTTPRequestHandler):
    _session_cookies = None
    
    @classmethod
    def get_cookies(cls):
        if cls._session_cookies is None:
            cls._session_cookies = _load_session_cookies()
        return cls._session_cookies
    
    def _forward(self, method='GET'):
        path = self.path
        url = f"https://{TARGET_HOST}{path}"
        
        fwd = {}
        for k in ['User-Agent','Accept','Accept-Language','Referer','Content-Type']:
            v = self.headers.get(k, '')
            if v: fwd[k] = v
        
        # 浏览器 cookie 优先，无则用 Python session cookies
        browser_cookie = self.headers.get('Cookie', '')
        if browser_cookie and 'passport2' not in browser_cookie and '_uid' in browser_cookie:
            fwd['Cookie'] = browser_cookie
        else:
            session_cookies = ExamProxy.get_cookies()
            if session_cookies:
                fwd['Cookie'] = '; '.join(f'{k}={v}' for k,v in session_cookies.items())
        
        body = b''
        if method == 'POST':
            cl = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(cl) if cl > 0 else b''
        
        try:
            if method == 'POST':
                resp = requests.post(url, data=body, headers=fwd, allow_redirects=True, timeout=15)
            else:
                resp = requests.get(url, headers=fwd, allow_redirects=False, timeout=15)
            
            if resp.status_code in (301, 302):
                self.send_response(302)
                self.send_header('Location', resp.headers.get('Location', ''))
                self.end_headers()
                return
            
            ct = resp.headers.get('Content-Type', '')
            content = resp.content
            
            # 修改 HTML
            if b'text/html' in ct.encode() or resp.text[:100].strip().startswith('<!'):
                text = resp.text
                text = re.sub(r'id="appExamClientSign"\s*value="[^"]*"', 'id="appExamClientSign" value="false"', text)
                text = re.sub(r'id="chaoXingAppSignVersion"\s*value="[^"]*"', 'id="chaoXingAppSignVersion" value="0"', text)
                text = re.sub(r'id="captchaCheck"\s*value="[^"]*"', 'id="captchaCheck" value="0"', text)
                text = text.replace('id="appExamClientSign"  value="true"', 'id="appExamClientSign" value="false"')
                content = text.encode()
                print(f"[PROXY] Modified {path[:60]}")
            
            self.send_response(resp.status_code)
            self.send_header('Content-Type', ct)
            self.send_header('Content-Length', len(content))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            print(f"[PROXY] Error: {e}")
            self.send_response(502)
            self.end_headers()

    do_GET = lambda self: self._forward('GET')
    do_POST = lambda self: self._forward('POST')
    log_message = lambda *a: None  # suppress logs

def start():
    server = socketserver.TCPServer(('0.0.0.0', PROXY_PORT), ExamProxy)
    print(f"Exam proxy on port {PROXY_PORT}")
    server.serve_forever()

if __name__ == '__main__':
    start()
