#!/usr/bin/env python3
"""超星考试 HTML 代理 — 拦截并修改 exam start 页面"""
import http.server, socketserver, requests, re, sys, os
from urllib.parse import urlparse, urljoin

PROXY_PORT = 8899
TARGET_HOST = "mooc1-api.chaoxing.com"
COOKIES = {}

class ExamProxy(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path
        url = f"https://{TARGET_HOST}{path}"
        print(f"[PROXY] GET {url[:120]}")
        
        try:
            resp = requests.get(url, cookies=COOKIES, headers={
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
            }, allow_redirects=False, timeout=15)
            
            if resp.status_code in (301, 302):
                loc = resp.headers.get('Location', '')
                self.send_response(302)
                self.send_header('Location', loc)
                self.end_headers()
                return
            
            content = resp.text
            ct = resp.headers.get('Content-Type', 'text/html')
            
            if 'text/html' in ct:
                # 关键修改：关闭客户端签名
                content = content.replace(
                    'value="true" id="appExamClientSign"',
                    'value="false" id="appExamClientSign"'
                )
                content = content.replace(
                    'value="311" id="chaoXingAppSignVersion"',
                    'value="0" id="chaoXingAppSignVersion"'
                )
                content = content.replace(
                    'value="1" id="captchaCheck"',
                    'value="0" id="captchaCheck"'
                )
                content = re.sub(
                    r'name="appExamClientSign" value="[^"]*"',
                    'name="appExamClientSign" value="false"',
                    content
                )
                content = re.sub(
                    r'id="chaoXingAppSignVersion" value="[^"]*"',
                    'id="chaoXingAppSignVersion" value="0"',
                    content
                )
                print(f"[PROXY] Modified HTML for {path[:80]}")
            
            self.send_response(resp.status_code)
            self.send_header('Content-Type', ct)
            self.send_header('Content-Length', len(content.encode()))
            self.end_headers()
            self.wfile.write(content.encode())
        except Exception as e:
            print(f"[PROXY] Error: {e}")
            self.send_response(502)
            self.end_headers()

def start(cookies_str=''):
    global COOKIES
    for c in cookies_str.split('; '):
        if '=' in c:
            k,v = c.split('=',1)
            COOKIES[k] = v
    
    server = socketserver.TCPServer(('', PROXY_PORT), ExamProxy)
    print(f"Exam proxy on http://localhost:{PROXY_PORT}")
    print(f"Navigate browser to: http://localhost:{PROXY_PORT}/exam-ans/exam/phone/task-exam?...")
    server.serve_forever()

if __name__ == '__main__':
    start(sys.argv[1] if len(sys.argv)>1 else '')
