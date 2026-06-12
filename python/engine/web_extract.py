"""
OneAPIChat Web Extraction Engine — 平台特定网页内容提取器
支持 Bilibili 等平台的视频信息提取 + 通用 HTML 解析
"""
from __future__ import annotations

import re
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


@dataclass
class ExtractResult:
    url: str
    title: str = ""
    content: str = ""
    structured: Optional[dict] = None
    platform: str = "generic"
    error: str = ""


# ═══════════════════════════════════════════════════════════
# HTML → Text 提取 (移植自 fetch.php)
# ═══════════════════════════════════════════════════════════

def extract_html_to_text(html: str, base_url: str = "") -> str:
    """将 HTML 提取为干净的 Markdown 文本。保留链接、图片和标题结构。"""
    if not html:
        return ""

    # 移除 script / style / noscript / iframe / svg
    for tag in ['script', 'style', 'noscript', 'iframe', 'svg']:
        html = re.sub(rf'<{tag}[^>]*>.*?</{tag}>', ' ', html, flags=re.S | re.I)

    # 移除注释
    html = re.sub(r'<!--.*?-->', ' ', html, flags=re.S)

    # 移除 footer / header / nav
    for tag in ['footer', 'nav', 'header']:
        html = re.sub(rf'<{tag}[^>]*>.*?</{tag}>', ' ', html, flags=re.S | re.I)

    # 保留链接: <a href="...">text</a> → [text](url)
    def _link_replacer(m):
        href = m.group(1)
        text = re.sub(r'<[^>]+>', '', m.group(2) or '').strip()
        if not text:
            text = href
        if not re.match(r'^https?://', href) and base_url:
            href = base_url.rstrip('/') + '/' + href.lstrip('/')
        return f' [{text}]({href}) '

    html = re.sub(
        r'<a[^>]*href=["\']([^"\'#][^"\']*)["\'][^>]*>(.*?)</a>',
        _link_replacer, html, flags=re.S | re.I
    )

    # 保留图片: <img src="..." alt="..."> → ![alt](src)
    def _img_replacer(m):
        src = m.group(1)
        if re.match(r'^(data:|//)', src, re.I):
            return ' '
        if not re.match(r'^https?://', src) and base_url:
            src = base_url.rstrip('/') + '/' + src.lstrip('/')
        alt_match = re.search(r'alt=["\']([^"\']*)["\']', m.group(0), re.I)
        alt = alt_match.group(1).strip() if alt_match else '图片'
        return f'\n![{alt}]({src})\n'

    html = re.sub(r'<img[^>]*src=["\']([^"\']+)["\'][^>]*>', _img_replacer, html, flags=re.S | re.I)

    # 换行标签
    html = re.sub(r'<(br|hr)\s*/?>', '\n', html, flags=re.I)
    html = re.sub(r'</(p|div|li|h[1-6]|tr|section|article|header)>', '\n', html, flags=re.I)

    # 标题加前缀
    def _heading_replacer(m):
        level = int(m.group(1))
        text = re.sub(r'<[^>]+>', '', m.group(2) or '').strip()
        return '\n' + '#' * level + ' ' + text + '\n'

    html = re.sub(r'<h([1-6])[^>]*>(.*?)</h\1>', _heading_replacer, html, flags=re.S | re.I)

    # 去除剩余标签
    html = re.sub(r'<[^>]+>', ' ', html)

    # 解码 HTML 实体
    import html as _html
    html = _html.unescape(html)

    # 清理空白
    html = re.sub(r'\n\s*\n\s*\n', '\n\n', html)
    html = re.sub(r'[ \t]{2,}', ' ', html)
    html = re.sub(r'^\s+|\s+$', '', html, flags=re.M)

    return html.strip()


# ═══════════════════════════════════════════════════════════
# 平台提取器
# ═══════════════════════════════════════════════════════════

class PlatformExtractor(ABC):
    """平台提取器基类"""

    @abstractmethod
    def can_handle(self, url: str) -> bool:
        """如果此提取器可以处理该 URL 则返回 True"""
        ...

    @abstractmethod
    async def extract(self, url: str, http_session, browser_manager=None) -> ExtractResult:
        """提取内容, 返回 ExtractResult"""
        ...


class BilibiliExtractor(PlatformExtractor):
    """Bilibili 视频/专栏/动态提取器"""

    # Bilibili URL 模式
    URL_PATTERNS = [
        r'bilibili\.com/video/(BV[a-zA-Z0-9]+|av\d+)',
        r'bilibili\.com/read/(cv\d+)',
        r'b23\.tv/([a-zA-Z0-9]+)',
    ]

    def can_handle(self, url: str) -> bool:
        return 'bilibili.com' in url or 'b23.tv' in url

    def _extract_video_id(self, url: str) -> Optional[tuple[str, str]]:
        """返回 (type, id)。type 为 'bv', 'av', 或 'cv'"""
        # BV 号
        m = re.search(r'/(BV[a-zA-Z0-9]+)', url)
        if m:
            return ('bv', m.group(1))
        # av 号
        m = re.search(r'/av(\d+)', url)
        if m:
            return ('av', f'av{m.group(1)}')
        # cv 号 (专栏)
        m = re.search(r'/read/(cv\d+)', url)
        if m:
            return ('cv', m.group(1))
        return None

    async def _fetch_api(self, vid_type: str, vid: str, http_session) -> Optional[dict]:
        """通过 Bilibili API 获取视频/专栏信息"""
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.bilibili.com/',
        }
        try:
            if vid_type == 'bv' or vid_type == 'av':
                # 视频信息 API
                resp = http_session.get(
                    f'https://api.bilibili.com/x/web-interface/view?{vid_type}id={vid}',
                    headers=headers, timeout=10
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get('code') == 0 and data.get('data'):
                        return data['data']
            elif vid_type == 'cv':
                # 专栏 API
                resp = http_session.get(
                    f'https://api.bilibili.com/x/article/viewinfo?id={vid[2:]}',
                    headers=headers, timeout=10
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get('code') == 0 and data.get('data'):
                        return data['data']
        except Exception as e:
            logger.warning(f'[BilibiliExtractor] API 请求失败: {e}')
        return None

    async def _render_page(self, url: str, browser_manager) -> Optional[str]:
        """通过 Playwright 渲染页面并提取初始状态"""
        if not browser_manager:
            return None
        try:
            await browser_manager.navigate(url)
            # 提取 Vue 初始状态
            js_code = """
            (function() {
                try { return JSON.stringify(window.__INITIAL_STATE__); } catch(e) {}
                return '';
            })()
            """
            state_json = await browser_manager.execute_js(js_code)
            if state_json:
                # execute_js 可能返回 str 或已解析的 dict
                if isinstance(state_json, dict):
                    return json.dumps(state_json)
                return str(state_json) if state_json else ""
            # 回退：获取可见文本
            return await browser_manager.get_content()
        except Exception as e:
            logger.warning(f'[BilibiliExtractor] Playwright 渲染失败: {e}')
        return None

    async def extract(self, url: str, http_session, browser_manager=None) -> ExtractResult:
        result = ExtractResult(url=url, platform='bilibili')

        vid_info = self._extract_video_id(url)
        if not vid_info:
            # 无法提取视频ID, 回退到通用提取
            result.content = f"[Bilibili URL] {url}\n无法自动提取视频信息, 请手动查看页面。"
            return result

        vid_type, vid = vid_info

        # 1. 尝试 API
        api_data = await self._fetch_api(vid_type, vid, http_session)
        if api_data:
            if vid_type in ('bv', 'av'):
                stat = api_data.get('stat', {})
                owner = api_data.get('owner', {})
                result.title = api_data.get('title', '')
                result.structured = {
                    'title': result.title,
                    'description': (api_data.get('desc', '') or '')[:500],
                    'author': owner.get('name', ''),
                    'stats': {
                        'views': stat.get('view', 0),
                        'likes': stat.get('like', 0),
                        'coins': stat.get('coin', 0),
                        'favorites': stat.get('favorite', 0),
                        'danmaku': stat.get('danmaku', 0),
                        'comments': stat.get('reply', 0),
                        'shares': stat.get('share', 0),
                    },
                    'duration': api_data.get('duration', 0),
                    'tags': [t.get('tag_name', '') for t in (api_data.get('tName', '') or [])],
                    'url': url,
                }
                result.content = (
                    f"[Bilibili 视频] {result.title}\n"
                    f"UP主: {result.structured['author']}\n"
                    f"播放: {result.structured['stats']['views']} | "
                    f"点赞: {result.structured['stats']['likes']} | "
                    f"弹幕: {result.structured['stats']['danmaku']} | "
                    f"评论: {result.structured['stats']['comments']}\n"
                    f"时长: {result.structured['duration'] // 60}分{result.structured['duration'] % 60}秒\n"
                    f"简介: {result.structured['description'][:300]}\n"
                    f"链接: {url}"
                )
            else:
                result.title = api_data.get('title', '')
                result.content = f"[Bilibili 专栏] {result.title}\n{api_data.get('summary', '')[:500]}\n链接: {url}"
            return result

        # 2. API 失败 → Playwright 渲染
        if browser_manager:
            state = await self._render_page(url, browser_manager)
            if state:
                try:
                    # state 可能是 str 或已解析的 dict
                    if isinstance(state, str):
                        ssr_data = json.loads(state)
                    else:
                        ssr_data = state
                    # 尝试提取视频数据
                    video_data = ssr_data.get('videoData') or ssr_data.get('videoInfo') or {}
                    if video_data:
                        result.title = video_data.get('title', '')
                        result.content = f"[Bilibili 视频 (渲染)] {result.title}\n链接: {url}"
                    else:
                        result.content = f"[Bilibili 页面] {url}\n渲染内容: {state[:2000]}"
                except json.JSONDecodeError:
                    result.content = f"[Bilibili 页面渲染] {url}\n{state[:2000]}"
                return result

        # 3. 都失败
        result.content = f"[Bilibili] 无法获取 {url} 的内容。API 和浏览器渲染均不可用。"
        return result


class GeneralExtractor(PlatformExtractor):
    """通用网页提取器 — 使用增强的 HTML→Text 解析"""

    def can_handle(self, url: str) -> bool:
        return True  # 兜底

    async def _fetch_html(self, url: str, http_session) -> Optional[tuple[str, str]]:
        """返回 (html, effective_url)。使用不同 UA 重试。"""
        user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ]
        for ua in user_agents:
            try:
                resp = http_session.get(
                    url,
                    headers={
                        'User-Agent': ua,
                        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    },
                    timeout=15,
                    allow_redirects=True,
                )
                if resp.status_code < 400:
                    # 检测编码
                    resp.encoding = resp.apparent_encoding or 'utf-8'
                    return (resp.text, resp.url)
            except Exception:
                continue
        return None

    async def _render_with_browser(self, url: str, browser_manager) -> Optional[str]:
        """通过 Playwright 渲染 JS 页面"""
        if not browser_manager:
            return None
        try:
            await browser_manager.navigate(url)
            return await browser_manager.get_content()
        except Exception:
            return None

    async def extract(self, url: str, http_session, browser_manager=None) -> ExtractResult:
        result = ExtractResult(url=url, platform='generic')

        # 1. 尝试直接 HTTP 获取
        fetch_result = await self._fetch_html(url, http_session)
        if fetch_result:
            html, effective_url = fetch_result
            text = extract_html_to_text(html, effective_url)
            if len(text.strip()) > 100:
                result.content = text[:20000]
                # 尝试提取标题
                title_m = re.search(r'<title[^>]*>([^<]+)</title>', html, re.I)
                if title_m:
                    result.title = title_m.group(1).strip()
                return result

        # 2. 静态获取失败 → 浏览器渲染
        if browser_manager:
            content = await self._render_with_browser(url, browser_manager)
            if content and len(content.strip()) > 50:
                result.content = content[:20000]
                return result

        # 3. 都失败
        result.error = '无法获取页面内容'
        result.content = f"[错误] 无法获取 {url} 的内容。网站可能需要登录或有反爬保护。"
        return result


# ═══════════════════════════════════════════════════════════
# 提取器注册表
# ═══════════════════════════════════════════════════════════

class WebExtractor:
    """按优先级管理平台提取器"""

    def __init__(self):
        self._extractors: list[PlatformExtractor] = []
        self._general = GeneralExtractor()

    def register(self, extractor: PlatformExtractor):
        """注册提取器(先注册的优先级更高)"""
        self._extractors.append(extractor)

    async def extract(self, url: str, http_session, browser_manager=None) -> ExtractResult:
        """按优先级匹配提取器并提取内容"""
        for ext in self._extractors:
            if ext.can_handle(url):
                return await ext.extract(url, http_session, browser_manager)
        return await self._general.extract(url, http_session, browser_manager)


# 全局单例
web_extractor = WebExtractor()
web_extractor.register(BilibiliExtractor())
