#!/usr/bin/env python3
"""超星考试全透明代理 - 代理所有资源(HTML+JS+CSS)"""
import http.server, socketserver, requests, re, sys, os
sys.path.insert(0, '/var/www/html/oneapichat')
from api.base import init_session

SESS = init_session()
PROXY_HOST = '192.168.195.213:8898'

class P(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            path = self.path
            # Try mooc1-api first, then mooc-res2
            for host in ['mooc1-api.chaoxing.com', 'mooc-res2.chaoxing.com']:
                url = f'https://{host}{path}'
                r = SESS.get(url, headers={'Referer': 'https://mooc1-api.chaoxing.com/'}, allow_redirects=False, timeout=10)
                if r.status_code == 404:
                    continue
                if r.status_code in (301, 302):
                    self.send_response(302)
                    self.send_header('Location', r.headers.get('Location', ''))
                    self.end_headers()
                    return
                ct = r.headers.get('Content-Type', '')
                content = r.content
                # Modify HTML
                if b'text/html' in ct.encode():
                    t = r.text
                    t = re.sub(r'id="appExamClientSign"\s*value="[^"]*"', 'id="appExamClientSign" value="false"', t)
                    t = re.sub(r'id="chaoXingAppSignVersion"\s*value="[^"]*"', 'id="chaoXingAppSignVersion" value="0"', t)
                    t = re.sub(r'id="captchaCheck"\s*value="[^"]*"', 'id="captchaCheck" value="0"', t)
                    # Rewrite resource URLs to proxy
                    t = t.replace('src="//mooc1-api.chaoxing.com', f'src="http://{PROXY_HOST}')
                    t = t.replace('src="//mooc-res2.chaoxing.com', f'src="http://{PROXY_HOST}')
                    t = t.replace("src='//mooc1-api.chaoxing.com", f"src='http://{PROXY_HOST}")
                    t = t.replace("src='//mooc-res2.chaoxing.com", f"src='http://{PROXY_HOST}")
                    t = t.replace('href="//mooc1-api.chaoxing.com', f'href="http://{PROXY_HOST}')
                    t = t.replace('href="//mooc-res2.chaoxing.com', f'href="http://{PROXY_HOST}')
                    content = t.encode()
                self.send_response(200)
                self.send_header('Content-Type', ct)
                self.send_header('Content-Length', len(content))
                self.end_headers()
                self.wfile.write(content)
                return
            self.send_response(404)
            self.end_headers()
        except Exception as e:
            print(f'ERR: {e}', flush=True)
    
    do_POST = lambda self: None
    log_message = lambda *a: None

if __name__ == '__main__':
    print(f'Proxy on port 8898', flush=True)
    socketserver.TCPServer(('0.0.0.0', 8898), P).serve_forever()
