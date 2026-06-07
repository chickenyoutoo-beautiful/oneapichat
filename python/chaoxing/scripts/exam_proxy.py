#!/usr/bin/env python3
"""超星考试全透明代理 - 带自动重新登录"""
import http.server, socketserver, requests, re, sys, os, threading, logging
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..'))
from chaoxing.base import init_session, Account, Chaoxing
import configparser

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(name)s | %(levelname)s | %(message)s')
logger = logging.getLogger('Proxy')
PROXY_PORT = 8898

# 全局 session，定期刷新
SESSION_LOCK = threading.Lock()
def refresh_session():
    global SESS
    try:
        cfg = configparser.ConfigParser()
        cfg.read(os.path.join(os.path.dirname(__file__), '..', 'config.ini'))
        acc = Account(cfg.get('common', 'username'), cfg.get('common', 'password'))
        api = Chaoxing(account=acc)
        r = api.login()
        SESS = init_session()
        logger.info(f"Session refreshed: login={r.get('status')}, cookies={len(list(SESS.cookies))}")
    except Exception as e:
        logger.warning(f"Session refresh failed: {e}")

# 初始化 session
SESS = init_session()
refresh_session()

INJECT_JS = """
<script>
Object.defineProperty(Event.prototype, 'isTrusted', { get: () => true });
Object.defineProperty(navigator, 'webdriver', { get: () => false });
(() => {
    try {
        function tryEnter() {
            var ar = document.querySelector('#agreeRules');
            if (ar && !ar.classList.contains('checked')) {
                ar.classList.add('checked');
                ar.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (typeof enter === 'function') {
                setTimeout(function() { try { enter(); } catch(e) {} }, 500);
            } else if (typeof screenMonitorStartAction === 'function') {
                setTimeout(function() { try { screenMonitorStartAction(); } catch(e) {} }, 500);
            } else {
                setTimeout(tryEnter, 1500);
            }
        }
        setTimeout(tryEnter, 2000);
    } catch(e) {}
})();
</script>
"""

class P(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            path = self.path
            for host in ['mooc1-api.chaoxing.com', 'mooc-res2.chaoxing.com']:
                url = f'https://{host}{path}'
                with SESSION_LOCK:
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
                if b'text/html' in ct.encode():
                    t = r.text
                    t = re.sub(r'id="appExamClientSign"\s*value="[^"]*"', 'id="appExamClientSign" value="false"', t)
                    t = re.sub(r'id="chaoXingAppSignVersion"\s*value="[^"]*"', 'id="chaoXingAppSignVersion" value="0"', t)
                    t = re.sub(r'id="captchaCheck"\s*value="[^"]*"', 'id="captchaCheck" value="0"', t)
                    if '</body>' in t:
                        t = t.replace('</body>', INJECT_JS + '\n</body>')
                    else:
                        t += INJECT_JS
                    content = t.encode()
                self.send_response(200)
                self.send_header('Content-Type', ct)
                self.end_headers()
                self.wfile.write(content)
                return
            self.send_response(404)
            self.end_headers()
        except Exception as e:
            logger.warning(f"Proxy error: {e}")
            self.send_response(502)
            self.end_headers()
    do_POST = do_GET

if __name__ == '__main__':
    logger.info(f"Starting proxy on port {PROXY_PORT}...")
    with socketserver.TCPServer(("0.0.0.0", PROXY_PORT), P) as httpd:
        logger.info(f"Proxy on port {PROXY_PORT} (with auto-enter injection)")
        httpd.serve_forever()
