#!/usr/bin/env python3
"""
使用 Chrome DevTools Protocol (CDP) 控制浏览器访问超星考试
通过代理修改 HTML 来绕过客户端验证
"""
import json, time, random, sys
import websocket

CDP_WS = "ws://127.0.0.1:18800/devtools/browser/3166a4f4-d1bf-4806-a513-dd9cad85d3d2"

class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=30)
        self.msg_id = 1
    
    def send(self, method, params=None):
        msg = {"id": self.msg_id, "method": method, "params": params or {}}
        self.ws.send(json.dumps(msg))
        self.msg_id += 1
    
    def recv(self, timeout=10):
        self.ws.settimeout(timeout)
        try:
            return json.loads(self.ws.recv())
        except:
            return None
    
    def call(self, method, params=None, expect_result=True):
        self.send(method, params)
        while True:
            resp = self.recv()
            if resp and resp.get("id") == self.msg_id - 1:
                if expect_result:
                    return resp.get("result")
                return resp
            # Handle events
            if resp and resp.get("method"):
                print(f"  [EVENT] {resp['method']}: {str(resp.get('params',{}))[:100]}")
    
    def create_target(self, url):
        """Create a new target (tab) and navigate to URL"""
        result = self.call("Target.createTarget", {
            "url": "about:blank",
            "newWindow": False,
            "background": False
        })
        target_id = result.get("targetId")
        print(f"Created target: {target_id[:30]}")
        
        # Navigate
        self.call("Page.enable", {"targetId": target_id})
        result2 = self.call("Page.navigate", {
            "targetId": target_id,
            "url": url
        })
        print(f"Navigation: {result2}")
        return target_id
    
    def evaluate(self, target_id, js_code):
        """Execute JavaScript in the target"""
        result = self.call("Runtime.evaluate", {
            "targetId": target_id,
            "expression": js_code,
            "returnByValue": True,
        })
        return result
    
    def close(self):
        self.ws.close()

def main():
    PROXY_URL = "http://127.0.0.1:8899/exam-ans/exam/phone/task-exam"
    params = {
        "redo": 1, "taskrefId": "9459820",
        "courseId": "263695114", "classId": "146799509",
        "cpi": "488376903",
        "enc_task": "dfb69177e925652bc5cef2630350b1c1",
        "vx": 0, "examsignal": 1,
    }
    full_url = f"{PROXY_URL}?{chr(38).join(f'{k}={v}' for k,v in params.items())}"
    
    cdp = CDP(CDP_WS)
    
    print("Creating target with proxy URL...")
    target_id = cdp.create_target(full_url)
    
    time.sleep(4)
    
    # Check current URL
    result = cdp.evaluate(target_id, "window.location.href")
    print(f"Current URL: {result}")
    
    # Get page content
    result = cdp.evaluate(target_id, "document.body ? document.body.innerText.substring(0,500) : 'no body'")
    print(f"Page text: {result}")
    
    # Modify hidden inputs
    js = """
    (() => {
        try {
            document.getElementById('appExamClientSign').value = 'false';
            document.getElementById('captchaCheck').value = '0';
            document.getElementById('chaoXingAppSignVersion').value = '0';
            const cb = document.querySelector('#agreeRules, .check');
            if (cb) {
                cb.classList.add('checked');
                cb.style.backgroundPosition = '0px 0px';
            }
            return 'OK';
        } catch(e) { return 'ERR: ' + e.message; }
    })()
    """
    result = cdp.evaluate(target_id, js)
    print(f"Modify inputs: {result}")
    
    # Trigger enter function
    js2 = """
    (() => {
        try {
            if (typeof enter === 'function') {
                enter();
                return 'enter() called';
            } else if (typeof screenMonitorStartAction === 'function') {
                screenMonitorStartAction();
                return 'screenMonitorStartAction() called';
            } else {
                return 'no enter function found';
            }
        } catch(e) { return 'ERR: ' + e.message; }
    })()
    """
    result = cdp.evaluate(target_id, js2)
    print(f"Trigger start: {result}")
    
    time.sleep(5)
    
    # Check URL after navigation
    result = cdp.evaluate(target_id, "window.location.href")
    print(f"After start - URL: {result}")
    
    # Get page text
    result = cdp.evaluate(target_id, "document.body ? document.body.innerText.substring(0,500) : 'no body'")
    print(f"After start - text: {result}")
    
    cdp.close()

if __name__ == '__main__':
    main()
