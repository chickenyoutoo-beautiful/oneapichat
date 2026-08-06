#!/usr/bin/env python3
"""开关统一性验证: python3 tests/toggle_verify.py [--light] [--mobile]"""
import json, sys, time, base64, urllib.request
import websocket

CDP = "http://127.0.0.1:9222"

def get_ws():
    with urllib.request.urlopen(CDP + "/json/list") as r:
        for page in json.load(r):
            if page.get("type") == "page":
                return page["webSocketDebuggerUrl"]
    req = urllib.request.Request(CDP + "/json/new", data=b"{}", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)["webSocketDebuggerUrl"]

EVAL = r"""(() => {
  const cs = (el, p) => el ? getComputedStyle(el).getPropertyValue(p) : 'MISSING';
  const pseudo = (el, p) => el ? getComputedStyle(el, '::before').getPropertyValue(p) : 'MISSING';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; return !!el; };
  if (window.toggleConfigPanel && !document.getElementById('configPanel').classList.contains('open')) window.toggleConfigPanel();
  document.documentElement.classList.remove('dark');
  const mode = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const ct = document.getElementById('markdownGFM');          // .config-toggle 类
  const sw = document.querySelector('#searchToggle + .slider'); // .switch.small 类 (searchToggle 在高级设置)
  // 开启态
  set('markdownGFM', true); set('searchToggle', true);
  const on = {
    ctSize: cs(ct,'width') + 'x' + cs(ct,'height'), ctBg: cs(ct,'background-color'), ctRadius: cs(ct,'border-radius'),
    ctKnob: pseudo(ct,'width') + 'x' + pseudo(ct,'height') + '@' + pseudo(ct,'transform'),
    swSize: cs(sw,'width') + 'x' + cs(sw,'height'), swBg: cs(sw,'background-color'), swRadius: cs(sw,'border-radius'),
    swKnob: pseudo(sw,'width') + 'x' + pseudo(sw,'height') + '@' + pseudo(sw,'transform'),
  };
  // 关闭态
  set('markdownGFM', false); set('searchToggle', false);
  const off = { ctBg: cs(ct,'background-color'), swBg: cs(sw,'background-color') };
  return JSON.stringify({ mode, on, off });
})()"""

def main():
    ws = websocket.create_connection(get_ws(), timeout=30, header=["Origin: http://localhost"])
    mid = 0
    def send(method, params=None):
        nonlocal mid
        mid += 1
        ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == mid:
                return msg

    send("Page.enable")
    send("Runtime.enable")
    send("Page.navigate", {"url": "https://naujtrats.xyz/oneapichat/"})
    time.sleep(4)
    # 暗色: 先加类再求值; 亮色: 直接求值
    if "--light" not in sys.argv:
        send("Runtime.evaluate", {"expression": "document.documentElement.classList.add('dark')"})
        time.sleep(0.5)
    res = send("Runtime.evaluate", {"expression": EVAL, "returnByValue": True})
    val = res.get("result", {}).get("result", {}).get("value")
    print(val if val else json.dumps(res, ensure_ascii=False))
    ws.close()

if __name__ == "__main__":
    main()
