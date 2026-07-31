"""
stock_data.py — A股数据引擎 v1.0
数据来源: 东方财富 HTTP API (push2.eastmoney.com / push2his.eastmoney.com)
功能: 实时行情 / 历史K线 / 板块资金流 / 龙虎榜 / 北向资金 / 技术指标 / K线图生成

设计:
  - 10秒内存缓存 (避免频繁打东方财富)
  - 所有HTTP请求走 Mihomo SOCKS5 代理 (socks5h://127.0.0.1:1081)
  - 自动重试 (5次, 指数退避)
  - 技术指标: MA/MACD/KDJ/RSI/BOLL 纯 pandas 计算
  - 图表: matplotlib 暗色主题, 输出 PNG 到 uploads/stock_charts/
"""

import json
import os
import time
import threading
from pathlib import Path
from datetime import datetime, timedelta

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ── 配置 ──────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
CHART_DIR = PROJECT_ROOT / "uploads" / "stock_charts"
CHART_DIR.mkdir(parents=True, exist_ok=True)

PROXY = "socks5h://127.0.0.1:1081"
TIMEOUT = 20
CACHE_TTL = 10  # 秒

# ── HTTP Session (带重试) ──────────────────────────────
_session = None
_session_lock = threading.Lock()


# ★ 强制 IPv4: 东方财富 DNS 解析到 IPv6, 但 Mihomo 不支持 IPv6 (ipv6: false)
# Monkey-patch socket.getaddrinfo 强制返回 IPv4 地址
import socket as _orig_socket
_orig_getaddrinfo = _orig_socket.getaddrinfo
def _getaddrinfo_ipv4(host, port, family=0, type=0, proto=0, flags=0):
    """强制 IPv4 解析 (东方财富域名解析到 IPv6 时 Mihomo 代理不通)"""
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
                total=5, backoff_factor=1.5,
                status_forcelist=[500, 502, 503, 504],
                allowed_methods=["GET"],
                raise_on_status=False,
            )
            # pool_maxsize=1 + pool_block=False → 禁用连接复用, 每次新建连接
            # 解决东方财富 push2his 服务器间歇性丢连接的问题
            adapter = HTTPAdapter(max_retries=retry, pool_connections=1, pool_maxsize=1, pool_block=False)
            s.mount("https://", adapter)
            s.mount("http://", adapter)
            s.proxies = {"http": PROXY, "https": PROXY}
            s.headers.update({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://quote.eastmoney.com/",
                "Connection": "close",  # 禁用 keep-alive
            })
            _session = s
    return _session


def _http_get(url: str, **kwargs) -> dict:
    """GET JSON, 自动重试, 返回 dict

    策略: 东方财富域名直接走直连 (国内服务器不需要代理, 且代理常被封)
    其他域名走代理 → 失败回退直连 → 失败回退 curl 子进程
    """
    s = _get_session()
    timeout = kwargs.pop("timeout", TIMEOUT)

    # ★ 东方财富域名: 直连优先 (国内服务器直连更快, 避免代理被封)
    is_eastmoney = "eastmoney.com" in url
    if is_eastmoney:
        try:
            r = s.get(url, timeout=timeout, proxies={"http": None, "https": None}, **kwargs)
            r.raise_for_status()
            data = r.json()
            if data.get("rc") == 0 and not data.get("data"):
                raise ValueError("Empty data from eastmoney")
            return data
        except (requests.exceptions.ConnectionError, ValueError, requests.exceptions.RequestException):
            pass
        # 直连失败回退 curl
        return _http_get_curl(url)

    # 非东方财富: 走代理
    try:
        r = s.get(url, timeout=timeout, **kwargs)
        r.raise_for_status()
        data = r.json()
        if data.get("rc") == 0 and not data.get("data"):
            raise ValueError("Empty data from eastmoney")
        return data
    except (requests.exceptions.ConnectionError, ValueError, requests.exceptions.RequestException):
        pass

    # 兜底: curl 子进程
    return _http_get_curl(url)


def _http_get_curl(url: str) -> dict:
    """curl 子进程兜底 (绕过 requests SOCKS 连接池问题)"""
    import subprocess
    # 禁用 TLS session tickets 避免 "stale session ID" 问题
    # --noproxy '*' + 强制 IPv4: Mihomo 不支持 IPv6, 东方财富 DNS 解析到 IPv6
    base_cmd = [
        "curl", "-s", "--socks5-hostname", "127.0.0.1:1081",
        "--connect-timeout", "10", "--max-time", "25",
        "--tlsv1.2", "--tls-max", "1.2",  # 强制 TLS 1.2 避免 session ticket 问题
        "-4",  # ★ 强制 IPv4 (东方财富域名解析到 IPv6 时 Mihomo 不通)
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "-H", "Referer: https://quote.eastmoney.com/",
        "-H", "Connection: close",
    ]
    try:
        # 最多重试3次 (间隔5秒, 应对东方财富服务端限流/反爬)
        for attempt in range(3):
            result = subprocess.run(
                base_cmd + [url],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0 and result.stdout.strip():
                try:
                    return json.loads(result.stdout)
                except json.JSONDecodeError:
                    pass
            if attempt < 2:
                time.sleep(5)  # 5秒间隔, 避免触发限流
        return {"_error": f"curl failed after retries: {result.stderr[:80] or 'empty'}"}
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


# ── 代码 → secid 转换 ────────────────────────────────
def _to_secid(symbol: str) -> str:
    """将股票代码转为东方财富 secid 格式 (1=上海, 0=深圳)"""
    symbol = symbol.strip()
    # 已经是 secid 格式
    if symbol.startswith(("1.", "0.", "116.", "128.")):
        return symbol
    # 纯数字
    if symbol.isdigit():
        if symbol.startswith(("60", "68", "90", "11", "13")):
            return f"1.{symbol}"  # 上海
        elif symbol.startswith(("00", "30", "20")):
            return f"0.{symbol}"  # 深圳
        elif symbol.startswith("43") or symbol.startswith("83") or symbol.startswith("87"):
            return f"0.{symbol}"  # 北交所(走深圳通道)
    return f"1.{symbol}"  # 默认上海


def _get_market(symbol: str) -> str:
    """判断市场: sh/sz/bj"""
    s = symbol.strip()
    if s.startswith(("60", "68", "90", "11", "13")) or s.startswith("1."):
        return "sh"
    elif s.startswith(("00", "30", "20")) or s.startswith("0."):
        return "sz"
    return "bj"


# ═══════════════════════════════════════════════════════
# 1. 实时行情
# ═══════════════════════════════════════════════════════
def get_realtime(symbol: str) -> dict:
    """获取个股实时行情"""
    secid = _to_secid(symbol)
    cache_key = f"rt:{secid}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    url = (
        f"https://push2.eastmoney.com/api/qt/stock/get?"
        f"secid={secid}&fields=f43,f44,f45,f46,f47,f48,f50,f51,f52,f55,f57,f58,"
        f"f60,f116,f117,f162,f167,f168,f169,f170,f171,f292&ut=fa5fd1943c7b386f172d6893dbbd1180"
    )
    try:
        data = _http_get(url)
        d = data.get("data", {})
        if not d:
            return {"ok": False, "error": f"未找到股票 {symbol}"}

        # 价格字段需要除以100 (东方财富精度系数)
        result = {
            "ok": True,
            "symbol": d.get("f57", symbol),
            "name": d.get("f58", ""),
            "price": round(d.get("f43", 0) / 100, 2) if d.get("f43") else 0,
            "change_pct": round(d.get("f170", 0) / 100, 2) if d.get("f170") else 0,  # 涨跌幅%
            "change_amt": round(d.get("f169", 0) / 100, 2) if d.get("f169") else 0,  # 涨跌额
            "open": round(d.get("f46", 0) / 100, 2) if d.get("f46") else 0,
            "high": round(d.get("f44", 0) / 100, 2) if d.get("f44") else 0,
            "low": round(d.get("f45", 0) / 100, 2) if d.get("f45") else 0,
            "prev_close": round(d.get("f60", 0) / 100, 2) if d.get("f60") else 0,
            "volume": d.get("f47", 0),  # 手
            "amount": d.get("f48", 0),  # 元
            "turnover": round(d.get("f168", 0) / 100, 2) if d.get("f168") else 0,  # 换手率%
            "pe": round(d.get("f162", 0) / 100, 2) if d.get("f162") else None,
            "amplitude": round(d.get("f171", 0) / 100, 2) if d.get("f171") else 0,  # 振幅%
            "market_cap": d.get("f116", 0),  # 总市值
            "float_cap": d.get("f117", 0),  # 流通市值
        }
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        return {"ok": False, "error": f"获取行情失败: {str(e)[:200]}"}


# ═══════════════════════════════════════════════════════
# 2. 历史K线
# ═══════════════════════════════════════════════════════
def get_kline(symbol: str, period: str = "daily", start: str = "", end: str = "",
              adjust: str = "qfq", count: int = 120) -> dict:
    """获取历史K线数据

    period: daily/weekly/monthly 或 5/15/30/60 (分钟)
    adjust: qfq(前复权)/hfq(后复权)/""(不复权)
    """
    secid = _to_secid(symbol)
    klt_map = {"daily": "101", "weekly": "102", "monthly": "103",
               "5": "5", "15": "15", "30": "30", "60": "60"}
    klt = klt_map.get(period, "101")
    fqt = {"qfq": "1", "hfq": "2", "": "0"}.get(adjust, "1")

    cache_key = f"kline:{secid}:{klt}:{fqt}:{start}:{end}:{count}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    # ★ 使用 HTTP 而非 HTTPS: Mihomo 代理对 push2his 的 TLS 握手不稳定
    url = (
        f"http://push2his.eastmoney.com/api/qt/stock/kline/get?"
        f"fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
        f"&klt={klt}&fqt={fqt}&secid={secid}"
    )
    if start and end:
        url += f"&beg={start}&end={end}"
    else:
        # 用 lmt 参数指定条数
        url = url.replace("&klt=", f"&lmt={count}&klt=")

    try:
        data = _http_get(url)
        if data.get("_error"):
            return {"ok": False, "error": data["_error"]}
        raw = data.get("data", {})
        if not raw or not raw.get("klines"):
            return {"ok": False, "error": f"未找到 {symbol} 的K线数据"}

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

        df = pd.DataFrame(rows)
        result = {
            "ok": True,
            "symbol": raw.get("code", symbol),
            "name": raw.get("name", ""),
            "period": period,
            "adjust": adjust,
            "count": len(rows),
            "data": rows,
        }
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        return {"ok": False, "error": f"获取K线失败: {str(e)[:200]}"}


# ═══════════════════════════════════════════════════════
# 3. 板块资金流向
# ═══════════════════════════════════════════════════════
def get_sector_flow(sector_type: str = "2") -> dict:
    """获取行业板块资金流向

    sector_type: 2=行业板块, 3=概念板块
    """
    cache_key = f"sector:{sector_type}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    url = (
        f"https://push2.eastmoney.com/api/qt/clist/get?"
        f"pn=1&pz=50&po=1&np=1&fltt=2&invt=2&"
        f"fid=f3&fs=m:90+t:{sector_type}&"
        f"fields=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f24,f25,f26,f22,f33,f11,f62,f128,f136,f115,f152,f124,f104,f105,f106"
    )
    try:
        data = _http_get(url)
        if data.get("_error"):
            return {"ok": False, "error": data["_error"]}
        items = data.get("data", {}).get("diff", [])
        sectors = []
        for item in items[:30]:  # TOP 30
            sectors.append({
                "code": item.get("f12", ""),
                "name": item.get("f14", ""),
                "change_pct": item.get("f3", 0),
                "main_inflow": item.get("f62", 0),  # 主力净流入
                "main_inflow_pct": item.get("f184", 0),  # 主力净流入率
                "super_large_inflow": item.get("f128", 0),  # 超大单净流入
                "large_inflow": item.get("f136", 0),  # 大单净流入
                "mid_inflow": item.get("f115", 0),  # 中单净流入
                "small_inflow": item.get("f62", 0),  # 小单净流入
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
    """获取龙虎榜数据

    date: YYYYMMDD, 默认今天
    """
    if not date:
        date = datetime.now().strftime("%Y%m%d")

    cache_key = f"dragon:{date}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    # ★ 使用新版 datacenter-web API (push2ex 已废弃/不稳定)
    # 龙虎榜详情接口: 支持按交易日期查询, 返回机构/游资买卖明细
    # 日期格式: YYYY-MM-DD (datacenter-web 需要带连字符)
    date_fmt = f"{date[:4]}-{date[4:6]}-{date[6:]}" if len(date) == 8 else date
    url = (
        f"http://datacenter-web.eastmoney.com/api/data/v1/get?"
        f"sortColumns=SECURITY_CODE&sortTypes=1&pageSize=50&pageNumber=1"
        f"&reportName=RPT_DAILYBILLBOARD_DETAILS"
        f"&columns=SECURITY_CODE,SECURITY_NAME_ABBR,CLOSE_PRICE,CHANGE_RATE,TURNOVERRATE,"
        f"DEAL_AMOUNT_RATIO,BILLBOARD_DEAL_AMT,FREE_MARKET_CAP,EXPLAIN,TRADE_DATE"
        f"&filter=(TRADE_DATE%3D%27{date_fmt}%27)"
    )
    try:
        data = _http_get(url)
        if data.get("_error"):
            return {"ok": False, "error": data["_error"]}
        result_data = data.get("result", {})
        if not result_data or not result_data.get("data"):
            return {"ok": False, "error": f"未找到 {date} 的龙虎榜数据"}
        result_list = []
        for item in result_data.get("data", [])[:50]:
            result_list.append({
                "code": item.get("SECURITY_CODE", ""),
                "name": item.get("SECURITY_NAME_ABBR", ""),
                "close": item.get("CLOSE_PRICE", 0),
                "change_pct": item.get("CHANGE_RATE", 0),
                "turnover": item.get("TURNOVERRATE", 0),
                "deal_amount": item.get("BILLBOARD_DEAL_AMT", 0),
                "deal_ratio": item.get("DEAL_AMOUNT_RATIO", 0),
                "cap": item.get("FREE_MARKET_CAP", 0),
                "reason": item.get("EXPLAIN", ""),
            })
        result = {"ok": True, "date": date, "count": len(result_list),
                  "total": result_data.get("count", 0), "data": result_list}
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        return {"ok": False, "error": f"获取龙虎榜失败: {str(e)[:200]}"}


# ═══════════════════════════════════════════════════════
# 5. 北向资金
# ═══════════════════════════════════════════════════════
def get_north_flow() -> dict:
    """获取北向资金(沪深股通)最新数据

    东方财富API返回每分钟一条CSV: time,沪股通净流入,沪买入,沪卖出,深股通净流入,深买入,深卖出
    最后一条即为最新累计值
    """
    cache_key = "north_flow"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    url = (
        "https://push2.eastmoney.com/api/qt/kamt.rtmin/get?"
        "fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56"
    )
    try:
        data = _http_get(url)
        if data.get("_error"):
            return {"ok": False, "error": data["_error"]}
        d = data.get("data", {})

        # s2n = 沪股通(沪深→港方向的数据), n2s = 深股通
        # 格式: ["time,sh_net,sh_buy,sh_sell,sz_net,sz_buy,sz_sell", ...]
        s2n_list = d.get("s2n", [])
        n2s_list = d.get("n2s", [])

        sh_net = sh_buy = sh_sell = sz_net = sz_buy = sz_sell = 0

        if s2n_list and len(s2n_list) > 0:
            last = s2n_list[-1]
            parts = last.split(",")
            if len(parts) >= 7:
                sh_net = float(parts[1])
                sh_buy = float(parts[2])
                sh_sell = float(parts[3])
                sz_net = float(parts[4])
                sz_buy = float(parts[5])
                sz_sell = float(parts[6])

        result = {
            "ok": True,
            "sh_connect": {
                "net_inflow": sh_net,
                "buy_amount": sh_buy,
                "sell_amount": sh_sell,
            },
            "sz_connect": {
                "net_inflow": sz_net,
                "buy_amount": sz_buy,
                "sell_amount": sz_sell,
            },
            "total_net_inflow": sh_net + sz_net,
        }
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        return {"ok": False, "error": f"获取北向资金失败: {str(e)[:200]}"}


# ═══════════════════════════════════════════════════════
# 6. 个股综合诊断
# ═══════════════════════════════════════════════════════
def get_stock_diagnosis(symbol: str) -> dict:
    """获取个股综合诊断(技术面+资金面汇总)"""
    secid = _to_secid(symbol)
    cache_key = f"diag:{secid}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    url = (
        f"https://push2.eastmoney.com/api/qt/stock/get?"
        f"secid={secid}&fields=f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f116,f117,"
        f"f162,f167,f168,f169,f170,f171,f177,f183,f184,f185,f186,f187,f188,f189,f190,f191"
    )
    try:
        data = _http_get(url)
        if data.get("_error"):
            return {"ok": False, "error": data["_error"]}
        d = data.get("data", {})
        if not d:
            return {"ok": False, "error": f"未找到 {symbol}"}

        result = {
            "ok": True,
            "symbol": d.get("f57", symbol),
            "name": d.get("f58", ""),
            "price": round(d.get("f43", 0) / 100, 2) if d.get("f43") else 0,
            "change_pct": round(d.get("f170", 0) / 100, 2) if d.get("f170") else 0,
            "pe": round(d.get("f162", 0) / 100, 2) if d.get("f162") else None,
            "pb": round(d.get("f167", 0) / 100, 2) if d.get("f167") else None,
            "turnover": round(d.get("f168", 0) / 100, 2) if d.get("f168") else 0,
            "market_cap": d.get("f116", 0),
        }
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        return {"ok": False, "error": f"获取诊断失败: {str(e)[:200]}"}


# ═══════════════════════════════════════════════════════
# 7. 技术指标计算
# ═══════════════════════════════════════════════════════
def calc_indicators(symbol: str, count: int = 120) -> dict:
    """计算技术指标 (MA/MACD/KDJ/RSI/BOLL)"""
    kline = get_kline(symbol, period="daily", count=count)
    if not kline.get("ok"):
        return kline

    df = pd.DataFrame(kline["data"])
    if len(df) < 20:
        return {"ok": False, "error": "数据不足, 至少需要20条K线"}

    close = df["close"]
    high = df["high"]
    low = df["low"]

    # MA
    for n in [5, 10, 20, 60]:
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
    rsv = (close - low_min) / (high_max - low_min) * 100
    df["K"] = rsv.ewm(com=2, adjust=False).mean().round(2)
    df["D"] = df["K"].ewm(com=2, adjust=False).mean().round(2)
    df["J"] = (3 * df["K"] - 2 * df["D"]).round(2)

    # RSI
    for n in [6, 12, 24]:
        delta = close.diff()
        gain = delta.where(delta > 0, 0).rolling(n).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(n).mean()
        rs = gain / loss
        df[f"RSI{n}"] = (100 - 100 / (1 + rs)).round(2)

    # BOLL
    df["BOLL_MID"] = close.rolling(20).mean().round(2)
    std20 = close.rolling(20).std()
    df["BOLL_UP"] = (df["BOLL_MID"] + 2 * std20).round(2)
    df["BOLL_DN"] = (df["BOLL_MID"] - 2 * std20).round(2)

    # 取最近5条
    recent = df.tail(5)
    result = {
        "ok": True,
        "symbol": kline["symbol"],
        "name": kline["name"],
        "data": recent.to_dict(orient="records"),
    }
    return result


# ═══════════════════════════════════════════════════════
# 8. K线图生成
# ═══════════════════════════════════════════════════════
def generate_chart(symbol: str, period: str = "daily", count: int = 60,
                   adjust: str = "qfq", show_indicators: str = "ma,macd,volume") -> dict:
    """生成K线分析图 (PNG), 返回文件路径"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.font_manager as fm

    # 中文字体
    font_candidates = ["Noto Sans CJK JP", "Noto Sans CJK SC", "Noto Serif CJK JP",
                       "WenQuanYi Micro Hei", "Droid Sans Fallback", "DejaVu Sans"]
    available = {f.name for f in fm.fontManager.ttflist}
    font_name = next((f for f in font_candidates if f in available), "DejaVu Sans")
    plt.rcParams["font.sans-serif"] = [font_name, "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False

    # 获取数据
    kline = get_kline(symbol, period=period, count=count, adjust=adjust)
    if not kline.get("ok"):
        return kline

    df = pd.DataFrame(kline["data"])
    if len(df) < 5:
        return {"ok": False, "error": "数据不足"}

    # 计算指标
    close = df["close"]
    df["MA5"] = close.rolling(5).mean()
    df["MA10"] = close.rolling(10).mean()
    df["MA20"] = close.rolling(20).mean()

    exp12 = close.ewm(span=12, adjust=False).mean()
    exp26 = close.ewm(span=26, adjust=False).mean()
    df["DIF"] = exp12 - exp26
    df["DEA"] = df["DIF"].ewm(span=9, adjust=False).mean()
    df["MACD_BAR"] = 2 * (df["DIF"] - df["DEA"])

    # 图表配置
    indicators = show_indicators.split(",")
    has_macd = "macd" in indicators
    has_volume = "volume" in indicators
    has_ma = "ma" in indicators

    # 布局
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

    # K线
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

    # 成交量
    if ax_v is not None:
        vol_colors = [RED if df["close"].iloc[i] >= df["open"].iloc[i] else GREEN for i in xs]
        ax_v.bar(xs, df["volume"], color=vol_colors, width=0.6, alpha=0.85)
        ax_v.set_ylabel("成交量", color=GRAY, fontsize=9)
        style_ax(ax_v)
        if ax_m is not None:
            ax_v.set_xticks([])

    # MACD
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

    # X轴日期
    bottom_ax = ax_m if ax_m is not None else (ax_v if ax_v is not None else ax_k)
    n = len(df)
    step = max(1, n // 8)
    ticks = list(range(0, n, step))
    bottom_ax.set_xticks(ticks)
    bottom_ax.set_xticklabels([df["date"].iloc[i][5:] for i in ticks], fontsize=8)

    fig.text(0.99, 0.01, "数据来源: 东方财富 | OneAPIChat",
             ha="right", va="bottom", color=GRAY, fontsize=7, alpha=0.5)

    # 保存
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
# 9. 市场概览 (指数行情)
# ═══════════════════════════════════════════════════════
def get_market_overview() -> dict:
    """获取主要指数实时行情"""
    cache_key = "market_overview"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    indices = [
        ("1.000001", "上证指数"), ("0.399001", "深证成指"), ("0.399006", "创业板指"),
        ("1.000688", "科创50"), ("1.000016", "上证50"), ("1.000300", "沪深300"),
        ("1.000905", "中证500"), ("0.399005", "中小板指"),
    ]
    secids = ",".join(s for s, _ in indices)
    url = (
        f"https://push2.eastmoney.com/api/qt/ulist.np/get?"
        f"fltt=2&secids={secids}&fields=f2,f3,f4,f12,f14"
    )
    try:
        data = _http_get(url)
        if data.get("_error"):
            return {"ok": False, "error": data["_error"]}
        items = data.get("data", {}).get("diff", [])
        result_list = []
        for item in items:
            result_list.append({
                "code": item.get("f12", ""),
                "name": item.get("f14", ""),
                "price": item.get("f2", 0),
                "change_pct": item.get("f3", 0),
                "change_amt": item.get("f4", 0),
            })
        result = {"ok": True, "data": result_list}
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        return {"ok": False, "error": f"获取市场概览失败: {str(e)[:200]}"}
