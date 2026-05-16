#!/usr/bin/env python3
"""超星考试透明代理 — Session 管理 cookies，修改 HTML"""
import http.server, socketserver, requests, re, sys, os

PROXY_PORT = 8898
TARGET_HOST = "mooc1-api.chaoxing.com"

def _get_session():
    """获取已登录的 requests.Session"""
    import configparser, glob as _g
    configs = sorted(_g.glob('/tmp/AutomaticCB/config_u_*.ini'), key=os.path.getmtime, reverse=True)
    if not configs: return requests.Session()
    cfg = configparser.ConfigParser()
    cfg.read(configs[0], encoding='utf8')
    sys.path.insert(0, '/var/www/html/oneapichat')
    from api.base import Account, Chaoxing, init_session
    acc = Account(cfg.get('common','username'), cfg.get('common','password'))
    api = Chaoxing(account=acc)
    lr = api.login()
    if lr['status']:
        s = init_session()  # Already has cookies from login
        print(f"[PROXY] Session ready")
        return s
    return requests.Session()

class ExamProxy(http.server.BaseHTTPRequestHandler):
    _session = None
    
    @classmethod
    def get_session(cls):
        if cls._session is None:
            cls._session = _get_session()
        return cls._session
    
    def _forward(self, method='GET'):
        path = self.path
        url = f"https://{TARGET_HOST}{path}"
        s = ExamProxy.get_session()
        
        fwd = {}
        for k in ['User-Agent','Accept','Accept-Language','Referer','Content-Type']:
            v = self.headers.get(k, '')
            if v: fwd[k] = v
        
        # Also forward browser cookies for extra auth
        browser_cookie = self.headers.get('Cookie', '')
        if browser_cookie and '_uid' in browser_cookie:
            for c in browser_cookie.split('; '):
                if '=' in c:
                    k, v = c.split('=', 1)
                    s.cookies.set(k, v, domain='.chaoxing.com', path='/')
        
        body = b''
        if method == 'POST':
            cl = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(cl) if cl > 0 else b''
        
        try:
            if method == 'POST':
                resp = s.post(url, data=body, headers=fwd, allow_redirects=True, timeout=15)
            else:
                resp = s.get(url, headers=fwd, allow_redirects=False, timeout=15)
            
            if resp.status_code in (301, 302):
                self.send_response(302)
                self.send_header('Location', resp.headers.get('Location', ''))
                self.end_headers()
                return
            
            ct = resp.headers.get('Content-Type', '')
            content = resp.content
            
            if b'text/html' in ct.encode() or resp.text[:100].strip().startswith('<!'):
                text = resp.text
                text = re.sub(r'id="appExamClientSign"\s*value="[^"]*"', 'id="appExamClientSign" value="false"', text)
                text = re.sub(r'id="chaoXingAppSignVersion"\s*value="[^"]*"', 'id="chaoXingAppSignVersion" value="0"', text)
                text = re.sub(r'id="captchaCheck"\s*value="[^"]*"', 'id="captchaCheck" value="0"', text)
                text = text.replace('id="appExamClientSign"  value="true"', 'id="appExamClientSign" value="false"')
                content = text.encode()
            
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
    log_message = lambda *a: None

def start():
    server = socketserver.TCPServer(('0.0.0.0', PROXY_PORT), ExamProxy)
    print(f"Exam proxy on port {PROXY_PORT}")
    server.serve_forever()

if __name__ == '__main__':
    start()
