#!/usr/bin/env python3
"""Render difficult public pages and extract their main readable content.

Fast HTTP fetching remains the first path. This helper is deliberately a fallback:
it uses a real Chromium context for JavaScript-rendered pages and returns clean text,
not a browser screenshot or a way to defeat CAPTCHAs.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import re
import socket
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def normalize_text(value: str) -> str:
    value = re.sub(r"[\t\r\f\v ]+", " ", value or "")
    lines = []
    for line in value.splitlines():
        line = re.sub(r"[ ]{2,}", " ", line).strip()
        if line and (not lines or line != lines[-1]):
            lines.append(line)
    return "\n".join(lines).strip()


def absolute_url(value: str, base: str) -> str:
    value = (value or "").strip()
    if not value or value.startswith(("data:", "javascript:", "mailto:", "#")):
        return ""
    return urljoin(base, value)


def candidate_score(node) -> float:
    text = normalize_text(node.get_text("\n", strip=True))
    if len(text) < 120:
        return -1
    paragraphs = len(node.find_all("p"))
    headings = len(node.find_all(["h1", "h2", "h3"]))
    links = sum(len(a.get_text(" ", strip=True)) for a in node.find_all("a"))
    link_ratio = links / max(len(text), 1)
    return len(text) + paragraphs * 180 + headings * 100 - link_ratio * len(text) * 1.5


def is_public_request(url: str, cache: dict[str, bool]) -> bool:
    parsed = urlparse(url)
    if parsed.scheme in ("data", "blob", "about") or not parsed.hostname:
        return True
    host = parsed.hostname.strip(".").lower()
    if host in ("localhost",) or host.endswith(".localhost") or host.endswith(".local"):
        return False
    if host in cache:
        return cache[host]
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)}
        result = bool(addresses) and all(not ipaddress.ip_address(addr).is_private and not ipaddress.ip_address(addr).is_loopback and not ipaddress.ip_address(addr).is_link_local and not ipaddress.ip_address(addr).is_reserved and not ipaddress.ip_address(addr).is_unspecified for addr in addresses)
    except Exception:
        result = False
    cache[host] = result
    return result


def html_to_readable(html: str, url: str, title: str = "") -> str:
    soup = BeautifulSoup(html or "", "lxml")
    for tag in soup(["script", "style", "noscript", "template", "svg", "canvas", "iframe", "nav", "footer", "header", "aside", "form"]):
        tag.decompose()

    # Prefer schema.org articleBody when a site exposes it.
    for node in BeautifulSoup(html or "", "lxml").select('[itemprop="articleBody"]'):
        body = normalize_text(node.get_text("\n", strip=True))
        if len(body) >= 240:
            return ((title.strip() + "\n\n") if title.strip() else "") + body[:50000]

    selectors = [
        "article", "main", '[role="main"]', '[itemprop="articleBody"]',
        ".article-content", ".article-body", ".post-content", ".entry-content",
        ".content", "#article", "#content",
    ]
    candidates = []
    for selector in selectors:
        candidates.extend(soup.select(selector))
    node = max(candidates, key=candidate_score, default=None)
    if node is None or candidate_score(node) < 0:
        node = soup.body or soup

    for br in node.find_all("br"):
        br.replace_with("\n")
    for heading in node.find_all(["h1", "h2", "h3", "h4"]):
        level = min(int(heading.name[1]), 4)
        heading.insert_before("\n" + ("#" * level) + " ")
        heading.append("\n")
    for anchor in node.find_all("a"):
        href = absolute_url(anchor.get("href", ""), url)
        label = normalize_text(anchor.get_text(" ", strip=True))
        if href and label:
            anchor.replace_with(f"[{label}]({href})")
    for image in node.find_all("img"):
        src = absolute_url(image.get("src") or image.get("data-src") or "", url)
        if src:
            alt = normalize_text(image.get("alt") or "图片")
            image.replace_with(f"\n![{alt}]({src})\n")
        else:
            image.decompose()

    text = normalize_text(node.get_text("\n", strip=True))
    if title.strip() and title.strip() not in text[:300]:
        text = title.strip() + "\n\n" + text
    return text[:50000]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--proxy", default="")
    parser.add_argument("--referer", default="")
    parser.add_argument("--timeout", type=int, default=12)
    args = parser.parse_args()

    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
    except Exception as exc:
        print(json.dumps({"error": "Playwright unavailable: " + str(exc)}, ensure_ascii=False))
        return 2

    try:
        with sync_playwright() as pw:
            launch_args = [
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-first-run",
                "--no-default-browser-check",
            ]
            browser_path = "/usr/bin/chromium-browser"
            launch_kwargs = {"headless": True, "args": launch_args}
            if args.proxy:
                launch_kwargs["proxy"] = {"server": args.proxy}
            try:
                browser = pw.chromium.launch(executable_path=browser_path, **launch_kwargs)
            except Exception:
                browser = pw.chromium.launch(**launch_kwargs)
            context = browser.new_context(
                user_agent=UA,
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
                viewport={"width": 1365, "height": 900},
                extra_http_headers={"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8", **({"Referer": args.referer} if args.referer else {})},
            )
            context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            page = context.new_page()
            page.set_default_timeout(max(3000, args.timeout * 1000))
            request_host_cache = {}
            def guarded_route(route):
                if is_public_request(route.request.url, request_host_cache):
                    route.continue_()
                else:
                    route.abort("blockedbyclient")
            page.route("**/*", guarded_route)
            try:
                page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout * 1000)
            except PlaywrightTimeoutError:
                # A partially loaded article can still be useful.
                pass
            try:
                page.wait_for_load_state("networkidle", timeout=min(5000, args.timeout * 500))
            except Exception:
                pass
            try:
                page.evaluate("window.scrollTo(0, Math.min(document.body.scrollHeight, 1800))")
            except Exception:
                pass
            html = page.content()
            title = page.title() or ""
            result = html_to_readable(html, args.url, title)
            body_text = normalize_text(page.locator("body").inner_text(timeout=3000))
            browser.close()

        challenge = bool(re.search(r"just a moment|checking your browser|cf-chl|captcha|verify you are human", (title + "\n" + body_text).lower()))
        if len(result) < 80 and challenge:
            print(json.dumps({"error": "anti_bot_challenge", "title": title}, ensure_ascii=False))
            return 3
        if len(result) < 80:
            print(json.dumps({"error": "页面没有可提取正文", "title": title}, ensure_ascii=False))
            return 4
        print(json.dumps({"content": result, "title": title, "mode": "playwright"}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)[:400]}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
