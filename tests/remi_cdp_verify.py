#!/usr/bin/env python3
"""蕾米小窗 v2 实机 CDP 验证: 打开/隐藏守卫/缩放手柄/缩放落盘/视口内钳制/拖动.
用法: python3 tests/remi_cdp_verify.py [url]
注意: 交互前必须等 0.28s 开窗动画播完, resize 分发后等 rAF 周期再读坐标.
输出: 每项 ✓/✗, 全部通过 exit 0"""
import json, sys, time, urllib.request
import websocket

CDP = "http://127.0.0.1:9222"
URL = sys.argv[1] if len(sys.argv) > 1 else "https://naujtrats.xyz/oneapichat/?_t=1785762482"

def get_ws():
    with urllib.request.urlopen(CDP + "/json/list") as r:
        for page in json.load(r):
            if page.get("type") == "page":
                return page["webSocketDebuggerUrl"]
    req = urllib.request.Request(CDP + "/json/new", data=b"{}", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)["webSocketDebuggerUrl"]

ws = websocket.create_connection(get_ws(), timeout=30, header=["Origin: http://localhost"])
mid = 0
def send(method, params=None):
    global mid
    mid += 1
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == mid:
            return msg.get("result", {})

def evaluate(expr):
    r = send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
    val = r.get("result", {}).get("value")
    if r.get("exceptionDetails"):
        print("  ⚠ eval exception:", r["exceptionDetails"].get("exception", {}).get("description", "")[:200])
    return val

send("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
send("Page.enable")
send("Runtime.enable")
send("Page.navigate", {"url": URL})
time.sleep(6)  # 等登录态 + 聊天加载

ok = True
def check(name, cond, detail=""):
    global ok
    ok = ok and bool(cond)
    print(("✓ " if cond else "✗ ") + name + ((" — " + detail) if detail else ""))

WAIT_ANIM = "await new Promise(r=>setTimeout(r,450));"  # 开窗动画 0.28s 播完

# 1) 打开小窗 + [hidden] 守卫 (display:flex 不得压过隐藏态) + 手柄/流体样式
r = evaluate("(async function(){ " + WAIT_ANIM + """
  if (window.openRemiZoom) window.openRemiZoom();
  await new Promise(r=>setTimeout(r,450));
  var w = document.getElementById('remi-zoom-window');
  var h = document.querySelector('.remi-zoom-resize');
  var i = document.getElementById('remi-zoom-img');
  var ic = i ? getComputedStyle(i) : null;
  return {
    open: !!w && !w.hidden,
    visible: !!w && getComputedStyle(w).display !== 'none',
    handle: !!h,
    cursor: h ? getComputedStyle(h).cursor : '',
    imgFluid: !!ic && ic.maxWidth === '100%' && ic.maxHeight === '100%'
  };
})()""")
check("小窗打开可见", r and r["open"] and r["visible"])
check("缩放手柄存在", r and r["handle"])
check("手柄 nwse-resize 光标", r and r["cursor"] == "nwse-resize", str(r and r["cursor"]))
check("图片流体缩放 (max 100%)", r and r["imgFluid"])

# 2) 关闭 → hidden 守卫 (关闭后 display:none, 证明 flex+[hidden] 正常)
r = evaluate("""
(function(){
  if (window.closeRemiZoom) window.closeRemiZoom();
  var w = document.getElementById('remi-zoom-window');
  return { hidden: !!w && w.hidden, display: w ? getComputedStyle(w).display : '' };
})()""")
check("关闭后 display:none ([hidden] 守卫生效)", r and r["hidden"] and r["display"] == "none", str(r))
evaluate("if (window.openRemiZoom) window.openRemiZoom();")

# 3) 真实指针事件缩放: 手柄按下→拖 +140/+100→松开 → 尺寸变化 + 落盘 + 结束钳回可视区
r = evaluate("(async function(){ " + WAIT_ANIM + """
  var w = document.getElementById('remi-zoom-window');
  var h = document.querySelector('.remi-zoom-resize');
  if (!w || !h) return null;
  // 先重置到确定尺寸 (上次运行可能已把最大值落盘), 保证缩放增量可断言
  w.style.width = '260px'; w.style.height = '260px';
  var before = { w: w.offsetWidth, h: w.offsetHeight };
  h.setPointerCapture = function(){};  // 合成事件无活动指针, 打桩
  var r0 = h.getBoundingClientRect();
  var cx = r0.left + r0.width/2, cy = r0.top + r0.height/2;
  h.dispatchEvent(new PointerEvent('pointerdown', {clientX: cx, clientY: cy, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true}));
  h.dispatchEvent(new PointerEvent('pointermove', {clientX: cx + 140, clientY: cy + 100, pointerType: 'mouse', bubbles: true, cancelable: true}));
  h.dispatchEvent(new PointerEvent('pointerup',   {clientX: cx + 140, clientY: cy + 100, pointerType: 'mouse', bubbles: true, cancelable: true}));
  await new Promise(r=>setTimeout(r,50));   // 结束钳制是同步的, 50ms 仅保险
  var after = { w: w.offsetWidth, h: w.offsetHeight };
  var saved = localStorage.getItem('remiZoomSize');
  var rect = w.getBoundingClientRect();
  return { before: before.w + 'x' + before.h, after: after.w + 'x' + after.h, saved: saved,
           inViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1,
           resizingClass: w.classList.contains('remi-zoom-resizing') };
})()""")
check("缩放后尺寸增大", r and r["after"] != r["before"], str(r and (r["before"], r["after"])))
saved_ok = False
if r and r["saved"]:
    try:
        s = json.loads(r["saved"])
        aw, ah = r["after"].split("x")
        saved_ok = s["width"] == int(aw) and s["height"] == int(ah)
    except Exception:
        saved_ok = False
check("缩放大小持久化 remiZoomSize", saved_ok, str(r and r["saved"]))
check("缩放后仍在视口内", r and r["inViewport"], str(r and r["inViewport"]))
check("缩放结束 resizing 类已清理", r and not r["resizingClass"])

# 4) 头部拖动回归
r = evaluate("(async function(){ " + WAIT_ANIM + """
  var w = document.getElementById('remi-zoom-window');
  var hd = document.querySelector('.remi-zoom-header');
  if (!w || !hd) return null;
  hd.setPointerCapture = function(){};
  var r0 = hd.getBoundingClientRect();
  var cx = r0.left + 60, cy = r0.top + r0.height/2;
  hd.dispatchEvent(new PointerEvent('pointerdown', {clientX: cx, clientY: cy, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true}));
  hd.dispatchEvent(new PointerEvent('pointermove', {clientX: cx - 300, clientY: cy + 200, pointerType: 'mouse', bubbles: true, cancelable: true}));
  hd.dispatchEvent(new PointerEvent('pointerup',   {clientX: cx - 300, clientY: cy + 200, pointerType: 'mouse', bubbles: true, cancelable: true}));
  var rect = w.getBoundingClientRect();
  return { left: Math.round(rect.left), top: Math.round(rect.top), pos: localStorage.getItem('remiZoomPos'),
           inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight };
})()""")
check("拖动后位置持久化 remiZoomPos", r and r["pos"] and '"left"' in r["pos"], str(r and r["pos"]))
check("拖动结束整体在视口内", r and r["inViewport"], str(r and (r["left"], r["top"])))

# 5) 视口缩小到小于窗口 (模拟旋转/键盘) → 尺寸收缩 + 位置拉回 (rAF 钳制是异步的, 等 100ms)
r = evaluate("(async function(){ " + WAIT_ANIM + """
  var w = document.getElementById('remi-zoom-window');
  var before = { w: w.offsetWidth, h: w.offsetHeight };
  window.innerWidth = 300; window.innerHeight = 300;
  window.dispatchEvent(new Event('resize'));
  await new Promise(r=>setTimeout(r,100));   // 等 rAF 回调执行完
  window.innerWidth = 1440; window.innerHeight = 900;
  var rect = w.getBoundingClientRect();
  return { before: before.w + 'x' + before.h, after: w.offsetWidth + 'x' + w.offsetHeight,
           inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= 1440 && rect.bottom <= 900 };
})()""")
check("视口缩小尺寸收缩 (300x300)", r and r["after"] != r["before"], str(r and (r["before"], r["after"])))
check("收缩后仍在视口内", r and r["inViewport"])

# 6) 玻璃背景仅悬停浮现: 静止全透明 → 真实鼠标移入 → 玻璃+标题浮现 → 移开恢复
#    (未登录遮罩会挡住真实鼠标 hit-test, 先隐藏, 结束后恢复)
r = evaluate("(async function(){ " + WAIT_ANIM + """
  var o = document.getElementById('authOverlay');
  if (o) o.style.visibility = 'hidden';
  window.__restoreOverlay = function(){ if (o) o.style.visibility = ''; };
  var w = document.getElementById('remi-zoom-window');
  w.style.left = '300px'; w.style.top = '300px'; w.style.bottom = 'auto';
  w.style.width = '300px'; w.style.height = '300px';
  var r0 = w.getBoundingClientRect();
  window.__zoomCenter = { x: Math.round(r0.left + r0.width / 2), y: Math.round(r0.top + r0.height / 2) };
  return 'ready';
})()""")
send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 10, "y": 10})  # 先把真实鼠标移开
time.sleep(0.4)  # 等玻璃 transition (0.25s)
r = evaluate("""(function(){
  var w = document.getElementById('remi-zoom-window');
  var cs = getComputedStyle(w);
  return { bg: cs.backgroundColor, blur: cs.backdropFilter,
           header: getComputedStyle(w.querySelector('.remi-zoom-header')).opacity };
})()""")
check("静止时背景全透明", r and r["bg"] == "rgba(0, 0, 0, 0)", str(r and r["bg"]))
check("静止时无毛玻璃模糊", r and r["blur"] == "none", str(r and r["blur"]))
check("静止时标题隐藏", r and r["header"] == "0", str(r and r["header"]))

c = evaluate("window.__zoomCenter")
send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": c["x"], "y": c["y"]})  # 真实悬停
time.sleep(0.4)
r = evaluate("""(function(){
  var w = document.getElementById('remi-zoom-window');
  var cs = getComputedStyle(w);
  return { bg: cs.backgroundColor, blur: cs.backdropFilter,
           header: getComputedStyle(w.querySelector('.remi-zoom-header')).opacity };
})()""")
check("悬停时玻璃浮现 (真透明)", r and r["bg"] == "rgba(255, 255, 255, 0.4)", str(r and r["bg"]))
check("悬停时恢复毛玻璃模糊", r and r["blur"] == "blur(16px) saturate(1.5)", str(r and r["blur"]))
check("悬停时标题浮现", r and r["header"] == "1", str(r and r["header"]))

send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 10, "y": 10})  # 移开
time.sleep(0.4)
r = evaluate("""(function(){
  var cs = getComputedStyle(document.getElementById('remi-zoom-window'));
  var h = getComputedStyle(document.querySelector('.remi-zoom-header')).opacity;
  return { bg: cs.backgroundColor, header: h };
})()""")
check("移开后恢复全透明", r and r["bg"] == "rgba(0, 0, 0, 0)" and r["header"] == "0")
evaluate("window.__restoreOverlay && window.__restoreOverlay()")

print("\n" + ("✅ 蕾米小窗 CDP 实机验证全部通过" if ok else "❌ 存在失败项"))
sys.exit(0 if ok else 1)
