#!/usr/bin/env python3
"""CDP 截图/求值工具: python3 tests/cdp_shot.py <url> <out.png> [--mobile] [--eval "js"] [--wait-ms N]"""
import json, sys, time, base64, urllib.request
import websocket

CDP = "http://127.0.0.1:9222"

def get_ws():
    with urllib.request.urlopen(CDP + "/json/list") as r:
        for page in json.load(r):
            if page.get("type") == "page":
                return page["webSocketDebuggerUrl"]
    # fallback: create new target
    req = urllib.request.Request(CDP + "/json/new", data=b"{}", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)["webSocketDebuggerUrl"]

def main():
    url = sys.argv[1]
    out = sys.argv[2]
    mobile = "--mobile" in sys.argv
    wait_ms = 2500
    evals = []
    if "--eval" in sys.argv:
        evals = sys.argv[sys.argv.index("--eval") + 1: sys.argv.index("--eval") + 3]
    if "--wait-ms" in sys.argv:
        wait_ms = int(sys.argv[sys.argv.index("--wait-ms") + 1])

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

    send("Emulation.setDeviceMetricsOverride", {
        "width": 390 if mobile else 1440,
        "height": 844 if mobile else 900,
        "deviceScaleFactor": 2 if mobile else 1,
        "mobile": mobile,
    })
    send("Page.enable")
    send("Runtime.enable")
    send("Page.navigate", {"url": url})
    time.sleep(wait_ms / 1000)
    if evals:
        res = send("Runtime.evaluate", {"expression": evals[0], "returnByValue": True})
        print(json.dumps(res.get("result", {}), ensure_ascii=False))
    shot = send("Page.captureScreenshot", {"format": "png"})
    data = shot["result"]["data"]
    with open(out, "wb") as f:
        f.write(base64.b64decode(data))
    print(f"saved {out}")
    ws.close()

if __name__ == "__main__":
    main()
