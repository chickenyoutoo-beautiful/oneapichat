"""
stock_data.py — 全球与A股金融数据引擎 v2.0
数据来源: 东方财富 / 腾讯财经 / 新浪财经 / 全球行情网关
功能: 
  - 全球市场实时行情 (A股 / 美股 / 港股 / 美股主要指数如SOX/纳斯达克/标普/道琼斯 / 全球主要股指)
  - 历史K线 (日K / 周K / 月K / 分钟K)
  - K线技术分析图 (PNG暗色主题生成, 自动均线+成交量+MACD)
  - 板块资金流 / 龙虎榜 / 北向资金 / 个股综合诊断 / 技术指标计算
  - 全球市场全景概览 (美股三大指数+费半 / A股各大指数 / 港股指数 / 全球外盘)

设计:
  - 10秒内存缓存 (降低外部请求频率)
  - 东方财富/腾讯/新浪三路冗余与自动故障转移
  - 自动识别代码类型 (A股/美股/港股/全球指数) 并提供精确时区与交易开闭盘状态
"""

import json
import math
import os
import re
import time
import threading
from pathlib import Path
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ── 配置 ──────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parents[2].resolve()
CHART_DIR = PROJECT_ROOT / "uploads" / "stock_charts"
CHART_DIR.mkdir(parents=True, exist_ok=True)

PROXY = "socks5h://127.0.0.1:1081"
TIMEOUT = 20
CACHE_TTL = 10  # 秒

# 腾讯行情接口会根据 Referer 返回内容；复用东财 Session 的默认 Referer 会得到
# v_pv_none_match / 仅 version 的空响应，导致 A 股回退链路看似网络成功却无数据。
HEADERS_TX = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://stockapp.finance.qq.com/",
    "Connection": "close",
}

# ── HTTP Session (带重试) ──────────────────────────────
_session = None
_session_lock = threading.Lock()

# 强制 IPv4: 东方财富 DNS 解析到 IPv6, 但 Mihomo 不支持 IPv6
import socket as _orig_socket
_orig_getaddrinfo = _orig_socket.getaddrinfo
def _getaddrinfo_ipv4(host, port, family=0, type=0, proto=0, flags=0):
    return _orig_getaddrinfo(host, port, _orig_socket.AF_INET, type, proto, flags)
_orig_socket.getaddrinfo = _getaddrinfo_ipv4


def _get_session() -> requests.Session:
    global _session
    if _session is not None:
        return _session
    with _session_lock:
        if _session is None:
            s = requests.Session()
            retry = Retry(
                total=3, connect=0, read=0, backoff_factor=0.5,
                status_forcelist=[500, 502, 503, 504],
                allowed_methods=["GET"],
                raise_on_status=False,
            )
            adapter = HTTPAdapter(max_retries=retry, pool_connections=1, pool_maxsize=1, pool_block=False)
            s.mount("https://", adapter)
            s.mount("http://", adapter)
            s.proxies = {"http": PROXY, "https": PROXY}
            s.headers.update({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://quote.eastmoney.com/",
                "Connection": "close",
            })
            _session = s
    return _session


def _http_get(url: str, **kwargs) -> dict:
    """GET JSON, 自动重试, 返回 dict"""
    s = _get_session()
    timeout = kwargs.pop("timeout", TIMEOUT)

    is_eastmoney = "eastmoney.com" in url
    if is_eastmoney:
        try:
            r = s.get(url, timeout=timeout, proxies={"http": None, "https": None}, **kwargs)
            r.raise_for_status()
            data = r.json()
            rc = data.get("rc")
            if rc is not None and (rc != 0 or not data.get("data")):
                raise ValueError(f"eastmoney bad response rc={rc}")
            return data
        except (requests.exceptions.ConnectionError, ValueError, requests.exceptions.RequestException):
            pass
        alt_url = url.replace("push2.eastmoney.com", "push2delay.eastmoney.com") \
                     .replace("push2his.eastmoney.com", "push2delay.eastmoney.com")
        if alt_url != url:
            try:
                r = s.get(alt_url, timeout=timeout, proxies={"http": None, "https": None}, **kwargs)
                r.raise_for_status()
                data = r.json()
                rc = data.get("rc")
                if rc is not None and (rc != 0 or not data.get("data")):
                    raise ValueError(f"eastmoney delay rc={rc}")
                return data
            except (requests.exceptions.ConnectionError, ValueError, requests.exceptions.RequestException):
                pass
        return _http_get_curl(url)

    try:
        r = s.get(url, timeout=timeout, **kwargs)
        r.raise_for_status()
        data = r.json()
        rc = data.get("rc")
        if rc is not None and (rc != 0 or not data.get("data")):
            raise ValueError(f"bad response rc={rc}")
        return data
    except Exception:
        pass

    return _http_get_curl(url)


def _http_get_curl(url: str) -> dict:
    """curl 子进程兜底"""
    import subprocess
    base_cmd = [
        "curl", "-s", "--socks5-hostname", "127.0.0.1:1081",
        "--connect-timeout", "10", "--max-time", "25",
        "--tlsv1.2", "--tls-max", "1.2",
        "-4",
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "-H", "Referer: https://quote.eastmoney.com/",
        "-H", "Connection: close",
    ]
    try:
        for attempt in range(2):
            result = subprocess.run(
                base_cmd + [url],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0 and result.stdout.strip():
                try:
                    return json.loads(result.stdout)
                except json.JSONDecodeError:
                    pass
            if attempt < 1:
                time.sleep(2)
        return {"_error": f"curl failed: {result.stderr[:80] or 'empty'}"}
    except Exception as e:
        return {"_error": f"curl exception: {str(e)[:100]}"}


# ── 内存缓存 ──────────────────────────────────────────
_cache = {}
_cache_lock = threading.Lock()


def _cache_get(key: str):
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.time() - entry["ts"]) < CACHE_TTL:
            return entry["data"]
    return None


def _cache_set(key: str, data):
    with _cache_lock:
        _cache[key] = {"ts": time.time(), "data": data}


# ── 全球指数与市场映射 ────────────────────────────────
GLOBAL_INDEX_MAP = {
    "SOX": {"sina": "gb_$sox", "tx": "usSOX", "name": "费城半导体指数", "type": "US_INDEX"},
    "^SOX": {"sina": "gb_$sox", "tx": "usSOX", "name": "费城半导体指数", "type": "US_INDEX"},
    "PHLX": {"sina": "gb_$sox", "tx": "usSOX", "name": "费城半导体指数", "type": "US_INDEX"},
    "IXIC": {"sina": "gb_ixic", "tx": "us.IXIC", "name": "纳斯达克综合指数", "type": "US_INDEX"},
    "^IXIC": {"sina": "gb_ixic", "tx": "us.IXIC", "name": "纳斯达克综合指数", "type": "US_INDEX"},
    "COMP": {"sina": "gb_ixic", "tx": "us.IXIC", "name": "纳斯达克综合指数", "type": "US_INDEX"},
    "NASDAQ": {"sina": "gb_ixic", "tx": "us.IXIC", "name": "纳斯达克综合指数", "type": "US_INDEX"},
    "NDX": {"sina": "gb_ndx", "tx": "us.NDX", "name": "纳斯达克100指数", "type": "US_INDEX"},
    "^NDX": {"sina": "gb_ndx", "tx": "us.NDX", "name": "纳斯达克100指数", "type": "US_INDEX"},
    "NAS100": {"sina": "gb_ndx", "tx": "us.NDX", "name": "纳斯达克100指数", "type": "US_INDEX"},
    "SPX": {"sina": "gb_inx", "tx": "us.INX", "name": "标普500指数", "type": "US_INDEX"},
    "^GSPC": {"sina": "gb_inx", "tx": "us.INX", "name": "标普500指数", "type": "US_INDEX"},
    "^SPX": {"sina": "gb_inx", "tx": "us.INX", "name": "标普500指数", "type": "US_INDEX"},
    "INX": {"sina": "gb_inx", "tx": "us.INX", "name": "标普500指数", "type": "US_INDEX"},
    "SP500": {"sina": "gb_inx", "tx": "us.INX", "name": "标普500指数", "type": "US_INDEX"},
    "DJI": {"sina": "gb_dji", "tx": "us.DJI", "name": "道琼斯工业指数", "type": "US_INDEX"},
    "^DJI": {"sina": "gb_dji", "tx": "us.DJI", "name": "道琼斯工业指数", "type": "US_INDEX"},
    "DJIA": {"sina": "gb_dji", "tx": "us.DJI", "name": "道琼斯工业指数", "type": "US_INDEX"},
    "RUT": {"sina": "gb_rut", "tx": "us.RUT", "name": "罗素2000指数", "type": "US_INDEX"},
    "^RUT": {"sina": "gb_rut", "tx": "us.RUT", "name": "罗素2000指数", "type": "US_INDEX"},
    "HSI": {"sina": "rt_hkHSI", "tx": "hkHSI", "name": "恒生指数", "type": "HK_INDEX"},
    "^HSI": {"sina": "rt_hkHSI", "tx": "hkHSI", "name": "恒生指数", "type": "HK_INDEX"},
    "HSTECH": {"sina": "rt_hkHSTECH", "tx": "hkHSTECH", "name": "恒生科技指数", "type": "HK_INDEX"},
    "N225": {"sina": "gb_n225", "tx": "usN225", "name": "日经225指数", "type": "GLOBAL_INDEX"},
    "^N225": {"sina": "gb_n225", "tx": "usN225", "name": "日经225指数", "type": "GLOBAL_INDEX"},
    "DAX": {"sina": "gb_dax", "name": "德国DAX指数", "type": "GLOBAL_INDEX"},
    "FTSE": {"sina": "gb_ftse", "name": "英国富时100指数", "type": "GLOBAL_INDEX"},
}


def _calc_market_status(market_type: str) -> str:
    """计算各市场当前交易状态"""
    now_utc = datetime.now(timezone.utc)
    # 美东时间 EDT (UTC-4, 夏令时)
    edt_time = now_utc - timedelta(hours=4)
    weekday_us = edt_time.weekday()
    us_min = edt_time.hour * 60 + edt_time.minute

    # 北京时间 (UTC+8)
    bj_time = now_utc + timedelta(hours=8)
    weekday_bj = bj_time.weekday()
    bj_min = bj_time.hour * 60 + bj_time.minute

    if market_type in ("US_STOCK", "US_INDEX"):
        if weekday_us >= 5:
            return "🔴 休市中 (周末)"
        if 9 * 60 + 30 <= us_min < 16 * 60:
            return "🟢 盘中交易中 (美东 09:30~16:00)"
        elif 4 * 60 <= us_min < 9 * 60 + 30:
            return "🟡 盘前交易中 (美东 04:00~09:30)"
        elif 16 * 60 <= us_min < 20 * 60:
            return "🟡 盘后交易中 (美东 16:00~20:00)"
        else:
            return "🔴 休市中 (夜间闭市)"

    elif market_type in ("A_STOCK", "CN_INDEX"):
        if weekday_bj >= 5:
            return "🔴 休市中 (周末)"
        if (9 * 60 + 30 <= bj_min < 11 * 60 + 30) or (13 * 60 <= bj_min < 15 * 60):
            return "🟢 盘中交易中"
        elif 11 * 60 + 30 <= bj_min < 13 * 60:
            return "🟡 午间休市"
        else:
            return "🔴 已收盘"

    elif market_type in ("HK_STOCK", "HK_INDEX"):
        if weekday_bj >= 5:
            return "🔴 休市中 (周末)"
        if (9 * 60 + 30 <= bj_min < 12 * 60) or (13 * 60 <= bj_min < 16 * 60):
            return "🟢 盘中交易中"
        elif 12 * 60 <= bj_min < 13 * 60:
            return "🟡 午间休市"
        else:
            return "🔴 已收盘"

    return "🟢 正常"


def _classify_symbol(symbol: str) -> dict:
    """智能识别股票代码归属市场"""
    s = symbol.strip()
    s_upper = s.upper()
    if s_upper in GLOBAL_INDEX_MAP:
        meta = GLOBAL_INDEX_MAP[s_upper]
        return {"kind": "GLOBAL_INDEX", "symbol": s_upper, "meta": meta}
    
    # 港股: 5位纯数字 或以 HK 开头
    if (len(s) == 5 and s.isdigit()) or (s_upper.startswith("HK") and s[2:].isdigit()):
        code = s[2:] if s_upper.startswith("HK") else s
        return {"kind": "HK_STOCK", "symbol": f"HK{code}", "raw_code": code}

    # A股: 6位纯数字 或以 sh/sz/bj/1./0. 开头
    if (len(s) == 6 and s.isdigit()) or s.startswith(("sh", "sz", "bj", "SH", "SZ", "BJ", "1.", "0.")):
        return {"kind": "A_STOCK", "symbol": s}

    # 美股股票: 1~6位英文字母 (如 NVDA, AAPL, TSLA, BABA, TSM, MU 等)
    if re.match(r'^[A-Za-z.^]{1,6}$', s) and not s.isdigit():
        return {"kind": "US_STOCK", "symbol": s_upper}

    return {"kind": "UNKNOWN", "symbol": s}


# ── 新浪/腾讯全球与港美股解析 ────────────────────────
def _fetch_sina_us(symbol: str, default_name: str = "") -> dict | None:
    """从新浪财经获取美股/全球指数实时行情"""
    clean_sym = symbol.replace(".", "$").lower()
    url = f"https://hq.sinajs.cn/list=gb_{clean_sym}"
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn"}
    try:
        s = _get_session()
        r = s.get(url, headers=headers, timeout=8, proxies={"http": None, "https": None})
        r.raise_for_status()
        m = re.search(r'="([^"]*)"', r.text)
        if not m or not m.group(1):
            return None
        parts = m.group(1).split(",")
        if len(parts) < 10:
            return None
        name = parts[0] or default_name or symbol
        price = float(parts[1] or 0)
        change_pct = float(parts[2] or 0)
        bj_time = parts[3] if len(parts) > 3 else ""
        change_amt = float(parts[4] or 0)
        open_p = float(parts[5] or 0)
        high_p = float(parts[6] or 0)
        low_p = float(parts[7] or 0)
        high_52w = float(parts[8] or 0) if len(parts) > 8 and parts[8] else None
        low_52w = float(parts[9] or 0) if len(parts) > 9 and parts[9] else None
        vol = float(parts[10] or 0) if len(parts) > 10 and parts[10] else 0
        us_time = parts[25] if len(parts) > 25 and parts[25] else ""
        prev_close = float(parts[26] or 0) if len(parts) > 26 and parts[26] else 0

        m_status = _calc_market_status("US_INDEX" if symbol.upper() in GLOBAL_INDEX_MAP else "US_STOCK")

        return {
            "ok": True,
            "symbol": symbol.upper(),
            "name": name,
            "price": round(price, 4 if price < 1 else 2),
            "change_pct": round(change_pct, 2),
            "change_amt": round(change_amt, 4 if abs(change_amt) < 1 else 2),
            "open": round(open_p, 2),
            "high": round(high_p, 2),
            "low": round(low_p, 2),
            "prev_close": round(prev_close, 2),
            "52w_high": high_52w,
            "52w_low": low_52w,
            "volume": vol,
            "market": "美股/美股指数",
            "market_status": m_status,
            "market_time_edt": us_time,
            "time_beijing": bj_time,
            "currency": "USD",
            "source": "sina",
        }
    except Exception:
        return None


def _fetch_sina_hk(code: str) -> dict | None:
    """从新浪财经获取港股实时行情"""
    url = f"https://hq.sinajs.cn/list=rt_hk{code}"
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn"}
    try:
        s = _get_session()
        r = s.get(url, headers=headers, timeout=8, proxies={"http": None, "https": None})
        r.raise_for_status()
        m = re.search(r'="([^"]*)"', r.text)
        if not m or not m.group(1):
            return None
        p = m.group(1).split(",")
        if len(p) < 15:
            return None
        return {
            "ok": True,
            "symbol": f"HK{code}",
            "name": p[1],
            "price": float(p[6]),
            "change_pct": round(float(p[8]), 2),
            "change_amt": round(float(p[7]), 2),
            "open": float(p[2]),
            "high": float(p[4]),
            "low": float(p[5]),
            "prev_close": float(p[3]),
            "volume": float(p[12]),
            "amount": float(p[11]),
            "market": "港股",
            "market_status": _calc_market_status("HK_STOCK"),
            "time": f"{p[17]} {p[18]}" if len(p) > 18 else "",
            "currency": "HKD",
            "source": "sina",
        }
    except Exception:
        return None


def _fetch_tencent_us(symbol: str) -> dict | None:
    """腾讯美股行情备用"""
    tsym = f"us{symbol.upper()}"
    if symbol.upper() in GLOBAL_INDEX_MAP and GLOBAL_INDEX_MAP[symbol.upper()].get("tx"):
        tsym = GLOBAL_INDEX_MAP[symbol.upper()]["tx"]
    url = f"https://qt.gtimg.cn/q={tsym}"
    try:
        s = _get_session()
        r = s.get(url, headers=HEADERS_TX, timeout=8, proxies={"http": None, "https": None})
        r.raise_for_status()
        m = re.search(r'="([^"]*)"', r.text)
        if not m or not m.group(1):
            return None
        f = m.group(1).split("~")
        if len(f) < 35:
            return None
        name = f[1]
        price = float(f[3] or 0)
        prev_close = float(f[4] or 0)
        open_p = float(f[5] or 0)
        vol = float(f[6] or 0)
        change_amt = float(f[31] or 0)
        change_pct = float(f[32] or 0)
        high_p = float(f[33] or 0)
        low_p = float(f[34] or 0)
        us_time = f[29] if len(f) > 29 else ""
        return {
            "ok": True,
            "symbol": symbol.upper(),
            "name": name,
            "price": round(price, 2),
            "change_pct": round(change_pct, 2),
            "change_amt": round(change_amt, 2),
            "open": round(open_p, 2),
            "high": round(high_p, 2),
            "low": round(low_p, 2),
            "prev_close": round(prev_close, 2),
            "volume": vol,
            "market": "美股/美股指数",
            "market_status": _calc_market_status("US_INDEX" if symbol.upper() in GLOBAL_INDEX_MAP else "US_STOCK"),
            "market_time_edt": us_time,
            "currency": "USD",
            "source": "tencent",
        }
    except Exception:
        return None


# ── A股代码与secid转换 ────────────────────────────────
def _to_tencent_symbol(symbol: str) -> str:
    s = symbol.strip()
    if s.startswith(("sh", "sz")) and s[2:].isdigit():
        return s
    if s.startswith(("60", "68", "90", "11", "13", "50", "51", "52", "56", "58")):
        return f"sh{s}"
    elif s.startswith(("00", "30", "20", "15", "16", "18")):
        return f"sz{s}"
    return ""


def _to_secid(symbol: str) -> str:
    s = symbol.strip()
    if s.startswith(("1.", "0.", "116.", "128.")):
        return s
    if s.isdigit():
        if s.startswith(("60", "68", "90", "11", "13")):
            return f"1.{s}"
        elif s.startswith(("00", "30", "20")):
            return f"0.{s}"
        elif s.startswith(("43", "83", "87")):
            return f"0.{s}"
    return f"1.{s}"


def _realtime_tencent(symbol: str) -> dict | None:
    """腾讯A股实时行情"""
    tsym = _to_tencent_symbol(symbol)
    if not tsym:
        return None
    try:
        s = _get_session()
        r = s.get(f"https://qt.gtimg.cn/q={tsym}", headers=HEADERS_TX, timeout=10, proxies={"http": None, "https": None})
        r.raise_for_status()
        text = r.text
        m = re.search(r'v_[^=]+="([^"]*)"', text)
        if not m:
            return None
        f = m.group(1).split("~")
        if len(f) < 40:
            return None
        price = float(f[3] or 0)
        return {
            "ok": True,
            "symbol": symbol,
            "name": f[1],
            "price": price,
            "change_pct": round(float(f[32] or 0), 2),
            "change_amt": round(float(f[31] or 0), 2),
            "open": float(f[5] or 0),
            "high": float(f[33] or 0),
            "low": float(f[34] or 0),
            "prev_close": float(f[4] or 0),
            "volume": float(f[6] or 0),
            "amount": float(f[37] or 0) * 10000,
            "turnover": round(float(f[38] or 0), 2),
            "pe": float(f[39] or 0) or None,
            "amplitude": round(float(f[43] or 0), 2),
            "market_cap": float(f[45] or 0) * 10000,
            "float_cap": float(f[44] or 0) * 10000,
            "market_status": _calc_market_status("A_STOCK"),
            "source": "tencent",
        }
    except Exception:
        return None


# ═══════════════════════════════════════════════════════
# 1. 实时行情 (全市场支持)
# ═══════════════════════════════════════════════════════
def get_realtime(symbol: str) -> dict:
    """获取股票/指数实时行情 (支持 A股/美股/港股/全球主流指数)"""
    sym = symbol.strip()
    cls = _classify_symbol(sym)
    cache_key = f"rt:{cls['kind']}:{cls['symbol']}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    # 1. 全球指数 (SOX, IXIC, NDX, SPX, DJI, HSI 等)
    if cls["kind"] == "GLOBAL_INDEX":
        meta = cls["meta"]
        # 优先新浪
        sina_code = meta["sina"].replace("gb_", "")
        res = _fetch_sina_us(sina_code, meta["name"])
        if not res and meta.get("tx"):
            res = _fetch_tencent_us(meta["tx"])
        if res:
            res["symbol"] = cls["symbol"]
            res["name"] = meta["name"]
            _cache_set(cache_key, res)
            return res
        return {"ok": False, "error": f"获取指数 {sym} 失败"}

    # 2. 港股 (如 00700, 09988)
    if cls["kind"] == "HK_STOCK":
        res = _fetch_sina_hk(cls["raw_code"])
        if res:
            _cache_set(cache_key, res)
            return res
        return {"ok": False, "error": f"获取港股 {sym} 失败"}

    # 3. 美股股票 (如 NVDA, AAPL, TSLA, AMD, TSM, MU)
    if cls["kind"] == "US_STOCK":
        res = _fetch_sina_us(cls["symbol"])
        if not res:
            res = _fetch_tencent_us(cls["symbol"])
        if res:
            _cache_set(cache_key, res)
            return res
        return {"ok": False, "error": f"获取美股 {sym} 失败"}

    # 4. A股 (东财优先 + 腾讯兜底)
    secid = _to_secid(sym)
    url = (
        f"https://push2.eastmoney.com/api/qt/stock/get?"
        f"secid={secid}&fields=f43,f44,f45,f46,f47,f48,f50,f51,f52,f55,f57,f58,f59,"
        f"f60,f116,f117,f162,f167,f168,f169,f170,f171,f292&ut=fa5fd1943c7b386f172d6893dbbd1180"
    )
    try:
        data = _http_get(url)
        if data.get("_error"):
            raise RuntimeError(data["_error"])
        d = data.get("data", {})
        if not d:
            raise RuntimeError(f"未找到股票 {sym}")

        price_decimals = max(0, min(int(d.get("f59", 2) or 2), 6))
        price_scale = 10 ** price_decimals
        result = {
            "ok": True,
            "symbol": d.get("f57", sym),
            "name": d.get("f58", ""),
            "price": round(d.get("f43", 0) / price_scale, price_decimals) if d.get("f43") else 0,
            "change_pct": round(d.get("f170", 0) / 100, 2) if d.get("f170") else 0,
            "change_amt": round(d.get("f169", 0) / price_scale, price_decimals) if d.get("f169") else 0,
            "open": round(d.get("f46", 0) / price_scale, price_decimals) if d.get("f46") else 0,
            "high": round(d.get("f44", 0) / price_scale, price_decimals) if d.get("f44") else 0,
            "low": round(d.get("f45", 0) / price_scale, price_decimals) if d.get("f45") else 0,
            "prev_close": round(d.get("f60", 0) / price_scale, price_decimals) if d.get("f60") else 0,
            "volume": d.get("f47", 0),
            "amount": d.get("f48", 0),
            "turnover": round(d.get("f168", 0) / 100, 2) if d.get("f168") else 0,
            "pe": round(d.get("f162", 0) / 100, 2) if d.get("f162") else None,
            "amplitude": round(d.get("f171", 0) / 100, 2) if d.get("f171") else 0,
            "market_cap": d.get("f116", 0),
            "float_cap": d.get("f117", 0),
            "market": "A股",
            "market_status": _calc_market_status("A_STOCK"),
            "source": "eastmoney",
        }
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        t = _realtime_tencent(sym)
        if t:
            _cache_set(cache_key, t)
            return t
        return {"ok": False, "error": f"获取行情失败: {str(e)[:200]}"}


# ═══════════════════════════════════════════════════════
# 2. 历史K线 (A股/美股/港股)
# ═══════════════════════════════════════════════════════
def _kline_tencent(symbol: str, period: str = "daily", count: int = 120,
                   adjust: str = "qfq") -> list | None:
    """腾讯 K 线 (A股/美股/港股)"""
    cls = _classify_symbol(symbol)
    if cls["kind"] == "A_STOCK":
        tsym = _to_tencent_symbol(symbol)
    elif cls["kind"] == "HK_STOCK":
        tsym = f"hk{cls['raw_code']}"
    elif cls["kind"] == "GLOBAL_INDEX":
        tsym = cls["meta"].get("tx", "")
    elif cls["kind"] == "US_STOCK":
        tsym = f"us{cls['symbol']}"
    else:
        tsym = ""

    if not tsym:
        return None

    tmap = {"daily": "day", "weekly": "week", "monthly": "month",
            "5": "m5", "15": "m15", "30": "m30", "60": "m60"}
    tperiod = tmap.get(period, "day")
    if tperiod in ("m5", "m15", "m30", "m60"):
        url = f"https://ifzq.gtimg.cn/appstock/app/kline/mkline?param={tsym},{tperiod},,{count}"
        raw_key = tperiod
    else:
        fqt = {"qfq": "qfq", "hfq": "hfq", "": "", "none": "", "raw": ""}.get(adjust, "qfq")
        url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={tsym},{tperiod},,,{count},{fqt}"
        raw_key = "qfq" + tperiod if fqt == "qfq" else ("hfq" + tperiod if fqt == "hfq" else tperiod)
    
    try:
        s = _get_session()
        r = s.get(url, headers=HEADERS_TX, timeout=12, proxies={"http": None, "https": None})
        r.raise_for_status()
        data = r.json()
        node = data["data"][tsym]
        raw = node.get(raw_key) or node.get(tperiod) or []
    except Exception:
        return None
    if not raw:
        return None

    rows = []
    for p in raw:
        try:
            amount = 0.0
            if len(p) > 6:
                v6 = p[6]
                if isinstance(v6, dict):
                    amount = float(v6.get("amount", 0) or 0)
                elif isinstance(v6, (int, float)):
                    amount = float(v6)
                elif isinstance(v6, str) and v6:
                    amount = float(v6)
            open_p = float(p[1])
            close_p = float(p[2])
            high_p = float(p[3])
            low_p = float(p[4])
            prev_close = float(p[8]) if len(p) > 8 and p[8] not in (None, "") else open_p
            change_amt = close_p - prev_close
            change_pct = (change_amt / prev_close * 100) if prev_close else 0.0
            amplitude = ((high_p - low_p) / prev_close * 100) if prev_close else 0.0
            rows.append({
                "date": p[0], "open": open_p, "close": close_p,
                "high": high_p, "low": low_p, "volume": float(p[5]),
                "amount": amount,
                "amplitude": round(amplitude, 2),
                "change_pct": round(change_pct, 2),
                "change_amt": round(change_amt, 4),
                "turnover": 0.0,
            })
        except (ValueError, IndexError, TypeError):
            continue
    return rows[-count:] if count > 0 else rows


def get_kline(symbol: str, period: str = "daily", start: str = "", end: str = "",
              adjust: str = "qfq", count: int = 120) -> dict:
    """获取历史K线数据 (A股/美股/港股/全球指数)"""
    sym = symbol.strip()
    cls = _classify_symbol(sym)
    
    # 非A股走腾讯/备用接口
    if cls["kind"] in ("US_STOCK", "GLOBAL_INDEX", "HK_STOCK"):
        trows = _kline_tencent(sym, period, count, adjust)
        if trows:
            rt = get_realtime(sym)
            return {
                "ok": True,
                "symbol": sym.upper(),
                "name": rt.get("name", sym.upper()),
                "period": period,
                "adjust": adjust,
                "count": len(trows),
                "data": trows,
                "source": "tencent",
            }

    # A股走东财 + 腾讯回退
    secid = _to_secid(sym)
    klt_map = {"daily": "101", "weekly": "102", "monthly": "103",
               "5": "5", "15": "15", "30": "30", "60": "60"}
    klt = klt_map.get(period, "101")
    fqt = {"qfq": "1", "hfq": "2", "": "0", "none": "0", "raw": "0"}.get(adjust, "1")

    cache_key = f"kline:{secid}:{klt}:{fqt}:{start}:{end}:{count}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    url = (
        f"http://push2his.eastmoney.com/api/qt/stock/kline/get?"
        f"fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
        f"&klt={klt}&fqt={fqt}&secid={secid}"
    )
    if start and end:
        url += f"&beg={start}&end={end}"
    else:
        end_dt = datetime.now()
        end = end_dt.strftime("%Y%m%d")
        if klt in ("5", "15", "30", "60"):
            beg = (end_dt - timedelta(days=15)).strftime("%Y%m%d")
        elif klt == "102":
            beg = (end_dt - timedelta(days=count * 7 + 30)).strftime("%Y%m%d")
        elif klt == "103":
            beg = (end_dt - timedelta(days=count * 31 + 30)).strftime("%Y%m%d")
        else:
            beg = (end_dt - timedelta(days=int(count * 1.8) + 30)).strftime("%Y%m%d")
        url += f"&beg={beg}&end={end}"

    try:
        data = _http_get(url)
        if data.get("_error"):
            raise RuntimeError(data["_error"])
        raw = data.get("data", {})
        if not raw or not raw.get("klines"):
            raise RuntimeError(f"未找到 {sym} 的K线数据")

        rows = []
        for line in raw["klines"]:
            p = line.split(",")
            rows.append({
                "date": p[0], "open": float(p[1]), "close": float(p[2]),
                "high": float(p[3]), "low": float(p[4]), "volume": float(p[5]),
                "amount": float(p[6]), "amplitude": float(p[7]),
                "change_pct": float(p[8]), "change_amt": float(p[9]),
                "turnover": float(p[10]),
            })
        if count > 0 and len(rows) > count:
            rows = rows[-count:]

        result = {
            "ok": True,
            "symbol": raw.get("code", sym),
            "name": raw.get("name", ""),
            "period": period,
            "adjust": adjust,
            "count": len(rows),
            "data": rows,
            "source": "eastmoney",
        }
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        trows = _kline_tencent(sym, period, count, adjust)
        if not trows:
            return {"ok": False, "error": f"获取K线失败: {str(e)[:150]}"}
        tname = ""
        trt = get_realtime(sym)
        if trt:
            tname = trt.get("name", "")
        result = {
            "ok": True,
            "symbol": sym,
            "name": tname,
            "period": period,
            "adjust": adjust,
            "count": len(trows),
            "data": trows,
            "source": "tencent",
        }
        _cache_set(cache_key, result)
        return result


# ═══════════════════════════════════════════════════════
# 3. 板块资金流向
# ═══════════════════════════════════════════════════════
def get_sector_flow(sector_type: str = "2") -> dict:
    """获取行业/概念板块资金流向 (2=行业板块, 3=概念板块)"""
    cache_key = f"sector:{sector_type}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    url = (
        f"https://push2.eastmoney.com/api/qt/clist/get?"
        f"pn=1&pz=50&po=1&np=1&fltt=2&invt=2&"
        f"fid=f3&fs=m:90+t:{sector_type}&"
        f"fields=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f24,f25,f26,f22,f33,f11,f62,f184,f128,f136,f115,f70,f152,f124,f104,f105,f106"
    )
    try:
        data = _http_get(url)
        if data.get("_error"):
            return {"ok": False, "error": data["_error"]}
        items = data.get("data", {}).get("diff", [])
        sectors = []
        for item in items[:30]:
            sectors.append({
                "code": item.get("f12", ""),
                "name": item.get("f14", ""),
                "change_pct": item.get("f3", 0),
                "main_inflow": item.get("f62", 0),
                "main_inflow_pct": item.get("f184", 0),
                "super_large_inflow": item.get("f128", 0),
                "large_inflow": item.get("f136", 0),
                "mid_inflow": item.get("f115", 0),
                "small_inflow": item.get("f70", 0),
            })
        result = {"ok": True, "type": "行业" if sector_type == "2" else "概念", "data": sectors}
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        return {"ok": False, "error": f"获取板块资金流失败: {str(e)[:200]}"}


# ═══════════════════════════════════════════════════════
# 4. 龙虎榜
# ═══════════════════════════════════════════════════════
def get_dragon_tiger(date: str = "") -> dict:
    """获取龙虎榜数据 (YYYYMMDD, 默认最新)"""
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    elif len(date) == 8:
        date = f"{date[:4]}-{date[4:6]}-{date[6:]}"

    cache_key = f"lhb:{date}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    url = (
        f"https://datacenter-web.eastmoney.com/api/data/v1/get?"
        f"callback=&reportName=RPT_DAILYBILLBOARD_DETAILS&"
        f"columns=SECURITY_CODE,SECUCODE,SECURITY_NAME_ABBR,TRADE_DATE,CLOSE_PRICE,"
        f"CHANGE_RATE,BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,"
        f"BILLBOARD_DEAL_AMT,ACCUM_AMOUNT,DEAL_NET_RATIO,DEAL_AMOUNT_RATIO,"
        f"TURNOVERRATE,EXPLANATION&"
        f"filter=(TRADE_DATE='{date}')&pageNumber=1&pageSize=50&sortTypes=-1&sortColumns=BILLBOARD_NET_AMT"
    )
    try:
        data = _http_get(url)
        if data.get("_error"):
            return {"ok": False, "error": data["_error"]}
        items = data.get("result", {}).get("data", []) or []
        stocks = []
        for item in items:
            stocks.append({
                "code": item.get("SECURITY_CODE", ""),
                "name": item.get("SECURITY_NAME_ABBR", ""),
                "price": item.get("CLOSE_PRICE", 0),
                "change_pct": item.get("CHANGE_RATE", 0),
                "net_amount": item.get("BILLBOARD_NET_AMT", 0),
                "buy_amount": item.get("BILLBOARD_BUY_AMT", 0),
                "sell_amount": item.get("BILLBOARD_SELL_AMT", 0),
                "turnover": item.get("TURNOVERRATE", 0),
                "reason": item.get("EXPLANATION", ""),
            })
        result = {"ok": True, "date": date, "count": len(stocks), "data": stocks}
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        return {"ok": False, "error": f"获取龙虎榜失败: {str(e)[:200]}"}


# ═══════════════════════════════════════════════════════
# 5. 北向资金
# ═══════════════════════════════════════════════════════
def get_north_flow() -> dict:
    """获取北向资金实时流向"""
    cache_key = "north_flow"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    url = "https://push2.eastmoney.com/api/qt/kamt.rtmin/get?fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56"
    try:
        data = _http_get(url)
        if data.get("_error"):
            return {"ok": False, "error": data["_error"]}
        d = data.get("data", {})
        sh_net = d.get("hk2sh", {}).get("dayNetAmtIn", 0) or 0
        sz_net = d.get("hk2sz", {}).get("dayNetAmtIn", 0) or 0
        result = {
            "ok": True,
            "sh_net_inflow": sh_net,
            "sz_net_inflow": sz_net,
            "total_net_inflow": sh_net + sz_net,
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        return {"ok": False, "error": f"获取北向资金失败: {str(e)[:200]}"}


# ═══════════════════════════════════════════════════════
# 6. 个股综合诊断
# ═══════════════════════════════════════════════════════
def get_stock_diagnosis(symbol: str) -> dict:
    """获取个股综合诊断 (A股/美股/港股)"""
    rt = get_realtime(symbol)
    if not rt.get("ok"):
        return rt
    return {
        "ok": True,
        "symbol": rt.get("symbol", symbol),
        "name": rt.get("name", ""),
        "price": rt.get("price", 0),
        "change_pct": rt.get("change_pct", 0),
        "change_amt": rt.get("change_amt", 0),
        "open": rt.get("open", 0),
        "high": rt.get("high", 0),
        "low": rt.get("low", 0),
        "prev_close": rt.get("prev_close", 0),
        "volume": rt.get("volume", 0),
        "pe": rt.get("pe"),
        "turnover": rt.get("turnover", 0),
        "market": rt.get("market", ""),
        "market_status": rt.get("market_status", ""),
        "time": rt.get("market_time_edt") or rt.get("time_beijing") or "",
    }


# ═══════════════════════════════════════════════════════
# 7. 技术指标计算
# ═══════════════════════════════════════════════════════
def calc_indicators(symbol: str, count: int = 120) -> dict:
    """计算技术指标 (MA/MACD/KDJ/RSI/BOLL)"""
    kline = get_kline(symbol, period="daily", count=count)
    if not kline.get("ok"):
        return kline

    df = pd.DataFrame(kline["data"])
    if len(df) < 10:
        return {"ok": False, "error": "数据不足, 至少需要10条K线"}

    close = df["close"]
    high = df["high"]
    low = df["low"]

    # MA
    for n in [5, 10, 20, 60]:
        if len(df) >= n:
            df[f"MA{n}"] = close.rolling(n).mean().round(2)

    # MACD
    exp12 = close.ewm(span=12, adjust=False).mean()
    exp26 = close.ewm(span=26, adjust=False).mean()
    df["DIF"] = (exp12 - exp26).round(3)
    df["DEA"] = df["DIF"].ewm(span=9, adjust=False).mean().round(3)
    df["MACD"] = (2 * (df["DIF"] - df["DEA"])).round(3)

    # KDJ
    low_min = low.rolling(9).min()
    high_max = high.rolling(9).max()
    rsv = (close - low_min) / (high_max - low_min + 1e-9) * 100
    df["K"] = rsv.ewm(com=2, adjust=False).mean().round(2)
    df["D"] = df["K"].ewm(com=2, adjust=False).mean().round(2)
    df["J"] = (3 * df["K"] - 2 * df["D"]).round(2)

    # RSI
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    for n in [6, 12, 24]:
        avg_gain = gain.rolling(n).mean()
        avg_loss = loss.rolling(n).mean()
        rs = avg_gain / (avg_loss + 1e-9)
        df[f"RSI{n}"] = (100 - (100 / (1 + rs))).round(2)

    # BOLL
    ma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    df["BOLL_MID"] = ma20.round(2)
    df["BOLL_UPPER"] = (ma20 + 2 * std20).round(2)
    df["BOLL_LOWER"] = (ma20 - 2 * std20).round(2)

    recent = df.tail(5).replace({np.nan: None}).to_dict("records")
    return {
        "ok": True,
        "symbol": kline.get("symbol", symbol),
        "name": kline.get("name", ""),
        "latest_indicators": recent[-1],
        "recent_5_days": recent,
        # 前端历史协议直接消费 data；同时保留语义化字段兼容其他调用方。
        "data": recent,
    }


# ═══════════════════════════════════════════════════════
# 8. K线图表生成 (matplotlib 暗色主题)
# ═══════════════════════════════════════════════════════
def generate_chart(symbol: str, period: str = "daily", count: int = 60,
                   adjust: str = "qfq", show_indicators: str = "ma,macd,volume") -> dict:
    """生成K线分析图 (PNG), 支持A股/美股/港股/指数"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.font_manager as fm

    font_candidates = ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "SimHei",
                        "WenQuanYi Micro Hei", "Droid Sans Fallback", "DejaVu Sans"]
    available = {f.name for f in fm.fontManager.ttflist}
    font_name = next((f for f in font_candidates if f in available), "DejaVu Sans")
    plt.rcParams["font.sans-serif"] = [font_name, "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False

    kline = get_kline(symbol, period=period, count=count, adjust=adjust)
    if not kline.get("ok"):
        return kline

    df = pd.DataFrame(kline["data"])
    if len(df) < 5:
        return {"ok": False, "error": "数据不足5条, 无法绘图"}

    close = df["close"]
    df["MA5"] = close.rolling(5).mean()
    df["MA10"] = close.rolling(10).mean()
    df["MA20"] = close.rolling(20).mean()

    exp12 = close.ewm(span=12, adjust=False).mean()
    exp26 = close.ewm(span=26, adjust=False).mean()
    df["DIF"] = exp12 - exp26
    df["DEA"] = df["DIF"].ewm(span=9, adjust=False).mean()
    df["MACD_BAR"] = 2 * (df["DIF"] - df["DEA"])

    indicators = show_indicators.split(",")
    has_macd = "macd" in indicators
    has_volume = "volume" in indicators
    has_ma = "ma" in indicators

    if has_macd and has_volume:
        fig = plt.figure(figsize=(14, 10), facecolor="#0d1117")
        gs = fig.add_gridspec(3, 1, height_ratios=[3, 1, 1], hspace=0.05)
        ax_k = fig.add_subplot(gs[0])
        ax_v = fig.add_subplot(gs[1], sharex=ax_k)
        ax_m = fig.add_subplot(gs[2], sharex=ax_k)
    elif has_volume:
        fig = plt.figure(figsize=(14, 8), facecolor="#0d1117")
        gs = fig.add_gridspec(2, 1, height_ratios=[3, 1], hspace=0.05)
        ax_k = fig.add_subplot(gs[0])
        ax_v = fig.add_subplot(gs[1], sharex=ax_k)
        ax_m = None
    else:
        fig = plt.figure(figsize=(14, 7), facecolor="#0d1117")
        gs = fig.add_gridspec(1, 1)
        ax_k = fig.add_subplot(gs[0])
        ax_v = None
        ax_m = None

    RED = "#f85149"
    GREEN = "#3fb950"
    YELLOW = "#d29922"
    BLUE = "#58a6ff"
    PURPLE = "#bc8cff"
    GRAY = "#8b949e"
    PANEL = "#161b22"
    GRID = "#21262d"

    def style_ax(ax):
        ax.set_facecolor(PANEL)
        ax.tick_params(colors=GRAY, labelsize=8)
        ax.grid(axis="y", alpha=0.15, color=GRAY)
        ax.grid(axis="x", alpha=0.08, color=GRAY)
        for sp in ax.spines.values():
            sp.set_color(GRID)

    name = kline.get("name", symbol)
    fig.suptitle(f'{kline["symbol"]} {name}  K线技术分析',
                 color="white", fontsize=14, fontweight="bold", y=0.98)

    xs = range(len(df))
    for i in range(len(df)):
        o = df["open"].iloc[i]
        c = df["close"].iloc[i]
        h = df["high"].iloc[i]
        l = df["low"].iloc[i]
        color = RED if c >= o else GREEN
        ax_k.vlines(i, l, h, color=color, linewidth=0.6)
        body = abs(c - o)
        if body == 0:
            body = 0.01
        ax_k.bar(i, body, bottom=min(o, c), color=color, width=0.6, linewidth=0)

    if has_ma:
        ax_k.plot(xs, df["MA5"], color=YELLOW, lw=0.8, label="MA5", alpha=0.85)
        ax_k.plot(xs, df["MA10"], color=BLUE, lw=0.8, label="MA10", alpha=0.85)
        ax_k.plot(xs, df["MA20"], color=PURPLE, lw=0.8, label="MA20", alpha=0.85)
        ax_k.legend(loc="upper left", fontsize=7, facecolor=PANEL,
                    edgecolor=GRID, labelcolor="white", framealpha=0.9)

    ax_k.set_ylabel("价格", color=GRAY, fontsize=9)
    style_ax(ax_k)
    if ax_v is not None:
        ax_k.set_xticks([])

    if ax_v is not None:
        vol_colors = [RED if df["close"].iloc[i] >= df["open"].iloc[i] else GREEN for i in xs]
        ax_v.bar(xs, df["volume"], color=vol_colors, width=0.6, alpha=0.85)
        ax_v.set_ylabel("成交量", color=GRAY, fontsize=9)
        style_ax(ax_v)
        if ax_m is not None:
            ax_v.set_xticks([])

    if ax_m is not None:
        macd_colors = [RED if v >= 0 else GREEN for v in df["MACD_BAR"]]
        ax_m.bar(xs, df["MACD_BAR"], color=macd_colors, width=0.6, alpha=0.85)
        ax_m.plot(xs, df["DIF"], color=YELLOW, lw=0.8, label="DIF", alpha=0.85)
        ax_m.plot(xs, df["DEA"], color=BLUE, lw=0.8, label="DEA", alpha=0.85)
        ax_m.axhline(y=0, color=GRAY, lw=0.4, ls="--", alpha=0.5)
        ax_m.legend(loc="upper left", fontsize=7, facecolor=PANEL,
                    edgecolor=GRID, labelcolor="white", framealpha=0.9)
        ax_m.set_ylabel("MACD", color=GRAY, fontsize=9)
        style_ax(ax_m)

    bottom_ax = ax_m if ax_m is not None else (ax_v if ax_v is not None else ax_k)
    n = len(df)
    step = max(1, n // 8)
    ticks = list(range(0, n, step))
    bottom_ax.set_xticks(ticks)
    bottom_ax.set_xticklabels([str(df["date"].iloc[i])[5:] for i in ticks], fontsize=8)

    fig.text(0.99, 0.01, "数据来源: OneAPIChat 金融数据引擎",
             ha="right", va="bottom", color=GRAY, fontsize=7, alpha=0.5)

    ts = int(time.time() * 1000) % 1000000
    safe_name = name.replace("/", "_").replace(" ", "_")
    filename = f"stock_{safe_name}_{symbol}_{ts}.png"
    filepath = CHART_DIR / filename

    plt.savefig(filepath, dpi=120, bbox_inches="tight",
                facecolor=fig.get_facecolor(), pad_inches=0.3)
    plt.close()

    return {
        "ok": True,
        "symbol": kline["symbol"],
        "name": name,
        "chart_path": str(filepath),
        "chart_url": f"/oneapichat/uploads/stock_charts/{filename}",
        "data_points": len(df),
        "period": period,
    }


# ═══════════════════════════════════════════════════════
# 9. 市场全景概览 (美股三大指数+费半 + A股各大指数 + 港股 + 全球外盘)
# ═══════════════════════════════════════════════════════
def get_market_overview() -> dict:
    """获取全球核心指数全景实时行情"""
    cache_key = "market_overview_global"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    now_utc = datetime.now(timezone.utc)
    edt_time = now_utc - timedelta(hours=4)
    bj_time = now_utc + timedelta(hours=8)

    # 1. 美股主要指数
    us_symbols = [
        ("IXIC", "纳斯达克综合指数"),
        ("NDX", "纳斯达克100"),
        ("SPX", "标普500指数"),
        ("DJI", "道琼斯工业指数"),
        ("SOX", "费城半导体指数"),
    ]
    us_data = []
    for s_code, s_name in us_symbols:
        q = get_realtime(s_code)
        if q.get("ok"):
            us_data.append({
                "symbol": s_code,
                "name": q.get("name", s_name),
                "price": q.get("price", 0),
                "change_pct": q.get("change_pct", 0),
                "change_amt": q.get("change_amt", 0),
                "open": q.get("open", 0),
                "high": q.get("high", 0),
                "low": q.get("low", 0),
                "prev_close": q.get("prev_close", 0),
                "status": q.get("market_status", ""),
                "time_edt": q.get("market_time_edt", ""),
            })

    # 2. A股主要指数
    cn_indices = [
        ("1.000001", "上证指数"), ("0.399001", "深证成指"), ("0.399006", "创业板指"),
        ("1.000688", "科创50"), ("1.000016", "上证50"), ("1.000300", "沪深300"),
    ]
    secids = ",".join(s for s, _ in cn_indices)
    url_cn = f"https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids={secids}&fields=f2,f3,f4,f12,f14"
    cn_data = []
    try:
        d_cn = _http_get(url_cn)
        items = d_cn.get("data", {}).get("diff", []) or []
        for it in items:
            cn_data.append({
                "code": it.get("f12", ""),
                "name": it.get("f14", ""),
                "price": it.get("f2", 0),
                "change_pct": it.get("f3", 0),
                "change_amt": it.get("f4", 0),
                "status": _calc_market_status("A_STOCK"),
            })
    except Exception:
        pass

    # 3. 港股主要指数
    hk_data = []
    for hk_code, hk_name in [("HSI", "恒生指数"), ("HSTECH", "恒生科技指数")]:
        q_hk = get_realtime(hk_code)
        if q_hk.get("ok"):
            hk_data.append({
                "symbol": hk_code,
                "name": q_hk.get("name", hk_name),
                "price": q_hk.get("price", 0),
                "change_pct": q_hk.get("change_pct", 0),
                "change_amt": q_hk.get("change_amt", 0),
                "status": q_hk.get("market_status", ""),
            })

    # 4. 全球其他核心外盘
    global_data = []
    for g_code, g_name in [("N225", "日经225指数"), ("DAX", "德国DAX指数")]:
        q_g = get_realtime(g_code)
        if q_g.get("ok"):
            global_data.append({
                "symbol": g_code,
                "name": q_g.get("name", g_name),
                "price": q_g.get("price", 0),
                "change_pct": q_g.get("change_pct", 0),
                "change_amt": q_g.get("change_amt", 0),
                "status": q_g.get("market_status", ""),
            })

    result = {
        "ok": True,
        "beijing_time": bj_time.strftime("%Y-%m-%d %H:%M:%S (UTC+8)"),
        "us_eastern_time": edt_time.strftime("%Y-%m-%d %H:%M:%S EDT (UTC-4)"),
        "us_market_status": _calc_market_status("US_INDEX"),
        "cn_market_status": _calc_market_status("A_STOCK"),
        "hk_market_status": _calc_market_status("HK_STOCK"),
        "us_indices": us_data,
        "cn_indices": cn_data,
        "hk_indices": hk_data,
        "global_indices": global_data,
    }
    _cache_set(cache_key, result)
    return result
