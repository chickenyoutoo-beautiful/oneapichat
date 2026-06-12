#!/usr/bin/env python3
"""
OneAPIChat 浏览器工具 (Browser Automation)

通过 Playwright 连接已运行的 Chromium (CDP: http://127.0.0.1:9222)
提供导航、截图、点击、输入、获取内容/结构、执行JS等能力。

用法:
    from engine.browser import browser_manager
    await browser_manager.connect()
    await browser_manager.navigate("https://example.com")
    screenshot = await browser_manager.screenshot()
"""

from __future__ import annotations

import base64
import logging
import asyncio
from typing import Optional

logger = logging.getLogger(__name__)

# ── CDP 配置 ──────────────────────────────────────────
CDP_URL = "http://127.0.0.1:9222"
BROWSER_VIEWPORT = {"width": 1280, "height": 720}


class BrowserManager:
    """浏览器管理器 - 通过 CDP 连接现有 Chromium 实例"""

    def __init__(self, cdp_url: str = CDP_URL):
        self.cdp_url = cdp_url
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None
        self._connected = False

    async def connect(self) -> bool:
        """连接到已运行的 Chromium (CDP)"""
        if self._connected and self._page:
            return True

        try:
            import aiohttp
            from playwright.async_api import async_playwright

            # ★ 获取 WebSocket URL (绕开 connect_over_cdp 与 snap Chromium v148 的尾斜杠不兼容)
            ws_url = None
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(f"{self.cdp_url}/json/version") as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            ws_url = data.get("webSocketDebuggerUrl", "")
            except Exception:
                pass

            if not ws_url:
                raise RuntimeError(f"无法从 CDP 获取 WebSocket URL: {self.cdp_url}/json/version")

            self._playwright = await async_playwright().start()
            # connect_over_cdp 也可接受 WebSocket URL 直连
            self._browser = await self._playwright.chromium.connect_over_cdp(ws_url)

            # 获取已有的 context 或创建新的
            contexts = self._browser.contexts
            if contexts:
                self._context = contexts[0]
            else:
                self._context = await self._browser.new_context(
                    viewport=BROWSER_VIEWPORT,
                    locale="zh-CN",
                )

            # 获取已有的 page 或创建新的
            pages = self._context.pages
            if pages:
                self._page = pages[0]
            else:
                self._page = await self._context.new_page()

            self._connected = True
            logger.info(f"[Browser] 已连接到 Chromium (CDP: {self.cdp_url})")
            return True

        except Exception as e:
            logger.error(f"[Browser] 连接失败: {e}")
            self._connected = False
            raise

    async def disconnect(self):
        """断开连接"""
        try:
            if self._playwright:
                await self._playwright.stop()
        except Exception:
            pass
        finally:
            self._playwright = None
            self._browser = None
            self._context = None
            self._page = None
            self._connected = False

    async def _ensure_page(self):
        """确保页面已连接"""
        if not self._connected or not self._page:
            await self.connect()

    # ── 页面管理 ──────────────────────────────────────

    async def new_page(self) -> dict:
        """创建新页面"""
        await self._ensure_page()
        self._page = await self._context.new_page()
        return {"ok": True, "pages": len(self._context.pages)}

    async def close_page(self) -> dict:
        """关闭当前页面"""
        await self._ensure_page()
        pages = self._context.pages
        if len(pages) <= 1:
            return {"ok": False, "error": "只剩一个页面, 无法关闭"}
        await self._page.close()
        # 切换到另一个页面
        remaining = self._context.pages
        if remaining:
            self._page = remaining[0]
        return {"ok": True, "pages": len(remaining)}

    async def list_pages(self) -> list:
        """列出所有页面标题"""
        await self._ensure_page()
        result = []
        for i, p in enumerate(self._context.pages):
            try:
                title = await p.title()
                url = p.url
                result.append({"index": i, "title": title, "url": url})
            except Exception:
                result.append({"index": i, "title": "(unavailable)", "url": ""})
        return result

    # ── 导航 ──────────────────────────────────────────

    async def navigate(self, url: str, timeout: int = 30000) -> dict:
        """导航到 URL"""
        await self._ensure_page()
        try:
            await self._page.goto(url, wait_until="domcontentloaded", timeout=timeout)
            title = await self._page.title()
            return {
                "ok": True,
                "url": self._page.url,
                "title": title,
            }
        except Exception as e:
            # 超时后可能部分加载, 获取已有内容
            try:
                title = await self._page.title()
                return {
                    "ok": True,
                    "url": self._page.url,
                    "title": title,
                    "warning": f"页面加载未完全完成: {str(e)}",
                }
            except Exception:
                return {"ok": False, "error": f"导航失败: {str(e)}"}

    # ── 截图 ──────────────────────────────────────────

    async def screenshot(self) -> dict:
        """截图并返回 base64 Data URI"""
        await self._ensure_page()
        try:
            png_bytes = await self._page.screenshot(
                type="png",
                full_page=False,
            )
            b64 = base64.b64encode(png_bytes).decode("ascii")
            data_uri = f"data:image/png;base64,{b64}"
            url = self._page.url
            title = await self._page.title()
            return {
                "ok": True,
                "image": data_uri,
                "url": url,
                "title": title,
                "width": BROWSER_VIEWPORT["width"],
                "height": BROWSER_VIEWPORT["height"],
            }
        except Exception as e:
            return {"ok": False, "error": f"截图失败: {str(e)}"}

    # ── 点击 ──────────────────────────────────────────

    async def click(self, selector: str) -> dict:
        """点击元素 — 三级降级:正常 → force → evaluate 派发 DOM 事件"""
        await self._ensure_page()
        # 第一级:正常点击(需要元素可见)
        try:
            await self._page.click(selector, timeout=4000)
            return {"ok": True, "selector": selector, "method": "normal"}
        except Exception as e1:
            # 第二级:force click(绕过可见性检查)
            try:
                await self._page.click(selector, timeout=4000, force=True)
                return {"ok": True, "selector": selector, "method": "force"}
            except Exception as e2:
                # 第三级:evaluate 直接派发 DOM 事件(终极方案,绕过所有 Playwright 检查)
                try:
                    result = await self._page.evaluate(
                        """(sel) => {
                            const el = document.querySelector(sel);
                            if (!el) return {ok: false, error: '元素不存在'};
                            // 强制让元素可见
                            el.style.display = el.style.display || 'block';
                            el.style.visibility = 'visible';
                            el.style.opacity = '1';
                            el.style.pointerEvents = 'auto';
                            // 派发 click 事件
                            el.click();
                            ['mousedown', 'mouseup', 'click'].forEach(evt => {
                                el.dispatchEvent(new MouseEvent(evt, {bubbles: true, cancelable: true, view: window}));
                            });
                            return {ok: true};
                        }""",
                        selector,
                    )
                    if result.get("ok"):
                        return {"ok": True, "selector": selector, "method": "evaluate"}
                    return {"ok": False, "error": f"evaluate 失败: {result.get('error', '未知')}"}
                except Exception as e3:
                    return {
                        "ok": False,
                        "error": f"点击失败(三级降级均失败): 正常={e1!s} | force={e2!s} | evaluate={e3!s}",
                    }

    # ── 输入 ──────────────────────────────────────────

    async def type_text(self, selector: str, text: str) -> dict:
        """输入文字 — 三级降级:正常 → force → evaluate 派发 input 事件"""
        await self._ensure_page()
        # 第一级:正常 fill(需要元素可见可编辑)
        try:
            await self._page.fill(selector, text, timeout=4000)
            return {"ok": True, "selector": selector, "text_length": len(text), "method": "normal"}
        except Exception as e1:
            # 第二级:force fill(绕过可见性检查)
            try:
                await self._page.fill(selector, text, timeout=4000, force=True)
                return {"ok": True, "selector": selector, "text_length": len(text), "method": "force"}
            except Exception as e2:
                # 第三级:evaluate + native setter + 派发 input 事件(终极方案)
                try:
                    result = await self._page.evaluate(
                        """([sel, txt]) => {
                            const el = document.querySelector(sel);
                            if (!el) return {ok: false, error: '元素不存在'};
                            // 强制可见可编辑
                            el.style.display = el.style.display || 'block';
                            el.style.visibility = 'visible';
                            el.style.opacity = '1';
                            el.style.pointerEvents = 'auto';
                            el.removeAttribute('readonly');
                            el.removeAttribute('disabled');
                            el.focus();
                            // 用 native setter 绕过 React/Vue 的 value 拦截
                            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                                const proto = el.tagName === 'INPUT'
                                    ? window.HTMLInputElement.prototype
                                    : window.HTMLTextAreaElement.prototype;
                                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                                if (setter) setter.call(el, txt);
                                else el.value = txt;
                            } else if (el.isContentEditable) {
                                el.innerText = txt;
                            } else {
                                el.textContent = txt;
                            }
                            // 派发 input/change 事件,让框架能监听到
                            el.dispatchEvent(new Event('input', {bubbles: true}));
                            el.dispatchEvent(new Event('change', {bubbles: true}));
                            return {ok: true, value: el.value || el.innerText || el.textContent};
                        }""",
                        [selector, text],
                    )
                    if result.get("ok"):
                        return {
                            "ok": True,
                            "selector": selector,
                            "text_length": len(text),
                            "method": "evaluate",
                            "value_set": (result.get("value", "") or "")[:100],
                        }
                    return {"ok": False, "error": f"evaluate 失败: {result.get('error', '未知')}"}
                except Exception as e3:
                    return {
                        "ok": False,
                        "error": f"输入失败(三级降级均失败): 正常={e1!s} | force={e2!s} | evaluate={e3!s}",
                    }

    # ── 获取内容 ──────────────────────────────────────

    async def get_content(self) -> dict:
        """获取页面可见文本"""
        await self._ensure_page()
        try:
            # 获取innerText(比textContent更干净)
            text = await self._page.evaluate("document.body.innerText || ''")
            text = text[:50000]  # 限制长度
            url = self._page.url
            title = await self._page.title()
            return {
                "ok": True,
                "content": text,
                "url": url,
                "title": title,
                "length": len(text),
            }
        except Exception as e:
            return {"ok": False, "error": f"获取内容失败: {str(e)}"}

    # ── 获取 Aria 树 ──────────────────────────────────

    async def get_snapshot(self) -> dict:
        """获取页面结构树 (通过JS遍历DOM获取简化结构)"""
        await self._ensure_page()
        try:
            # 先尝试 Playwright 的 accessibility snapshot
            try:
                snapshot = await self._page.accessibility.snapshot()
                if snapshot:
                    url = self._page.url
                    title = await self._page.title()
                    return {
                        "ok": True,
                        "snapshot": snapshot,
                        "url": url,
                        "title": title,
                    }
            except Exception:
                pass

            # 降级: 用 JS 获取页面结构
            js_code = '''
            (function() {
                function getTree(el, depth) {
                    if (depth > 5) return null;
                    var tag = el.tagName ? el.tagName.toLowerCase() : '';
                    if (tag === 'script' || tag === 'style' || tag === 'noscript') return null;
                    var children = [];
                    for (var i = 0; i < el.children.length; i++) {
                        var child = getTree(el.children[i], depth + 1);
                        if (child) children.push(child);
                    }
                    var result = { tag: tag };
                    if (el.id) result.id = el.id;
                    var cls = el.className;
                    if (cls && typeof cls === 'string') result.class = cls.substring(0, 100);
                    var text = (el.innerText || '').trim().substring(0, 80);
                    if (text && children.length === 0) result.text = text;
                    var href = el.getAttribute && el.getAttribute('href');
                    if (href) result.href = href.substring(0, 200);
                    var src = el.getAttribute && el.getAttribute('src');
                    if (src) result.src = src.substring(0, 200);
                    if (el.role) result.role = el.role;
                    if (el.getAttribute && el.getAttribute('aria-label')) result.label = el.getAttribute('aria-label');
                    result.children = children;
                    return result;
                }
                return getTree(document.body, 0);
            })()
            '''
            structure = await self._page.evaluate(js_code)
            url = self._page.url
            title = await self._page.title()
            return {
                "ok": True,
                "snapshot": structure,
                "url": url,
                "title": title,
                "note": "DOM structure (accessibility unavailable)",
            }
        except Exception as e:
            return {"ok": False, "error": f"获取结构失败: {str(e)}"}

    # ── 执行 JS ───────────────────────────────────────

    async def execute_js(self, code: str) -> dict:
        """在页面中执行 JavaScript 代码"""
        await self._ensure_page()
        try:
            result = await self._page.evaluate(code)
            return {
                "ok": True,
                "result": str(result)[:10000],
            }
        except Exception as e:
            return {"ok": False, "error": f"JS 执行失败: {str(e)}"}

    # ── 工具调用 ──────────────────────────────────────

    async def call_tool(self, tool_name: str, **kwargs) -> dict:
        """通过工具名称调用对应功能（用于统一路由）"""
        tool_map = {
            "navigate": self.navigate,
            "screenshot": self.screenshot,
            "click": self.click,
            "type": self.type_text,
            "get_content": self.get_content,
            "get_snapshot": self.get_snapshot,
            "execute_js": self.execute_js,
            "new_page": self.new_page,
            "close_page": self.close_page,
            "list_pages": self.list_pages,
        }
        handler = tool_map.get(tool_name)
        if not handler:
            return {"ok": False, "error": f"未知浏览器工具: {tool_name}"}
        return await handler(**kwargs)


# ── 全局单例 ──────────────────────────────────────────

_browser_manager: Optional[BrowserManager] = None


def get_browser_manager() -> BrowserManager:
    """获取全局 BrowserManager 单例"""
    global _browser_manager
    if _browser_manager is None:
        _browser_manager = BrowserManager()
    return _browser_manager


async def ensure_browser_connected() -> BrowserManager:
    """确保浏览器已连接"""
    bm = get_browser_manager()
    if not bm._connected:
        await bm.connect()
    return bm
