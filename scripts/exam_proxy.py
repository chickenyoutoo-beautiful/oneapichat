#!/usr/bin/env python3
"""超星考试透明代理 — 转发浏览器 Cookie，修改 HTML 绕过 appExamClientSign"""
import http.server, socketserver, requests, re, sys

PROXY_PORT = 8899
TARGET_HOST = "mooc1-api.chaoxing.com"

class ExamProxy(http.server.BaseHTTPRequestHandler):
    def _forward(self, method='GET'):
        path = self.path
        url = f"https://{TARGET_HOST}{path}"
        
        # 转发浏览器 headers（包括 Cookie）
        fwd = {}
        for k in ['User-Agent','Accept','Accept-Language','Referer','Cookie','Content-Type']:
            v = self.headers.get(k, '')
            if v: fwd[k] = v
        
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
