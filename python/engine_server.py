#!/usr/bin/env python3
"""
OneAPIChat 后台引擎 - 心跳 / Cron / 子代理
"""
import asyncio
import json
import os
import sys
import time
import threading
import uuid
import subprocess
import requests
import re
from datetime import datetime, timedelta
from pathlib import Path
import sqlite3
import tempfile
import glob

# ── 代理配置 ────────────────────────────────────────────
def _load_proxy_config():
    """从用户配置中加载代理设置,配置 requests 全局代理"""
    try:
        # 读取 localStorage 持久化的配置
        import glob as _glob
        config_files = _glob.glob(os.path.join(PROJECT_ROOT, 'chat_data/config_user_*.json'))
        for cf in config_files:
            try:
                with open(cf, 'r') as f:
                    cfg = json.load(f)
                if cfg.get('proxyEnabled') == '1' and cfg.get('proxyUrl'):
                    proxy_url = cfg['proxyUrl']
                    # ★ 公网地址映射为内网直连
                    if 'proxy.naujtrats.xyz:8888' in proxy_url:
                        proxy_url = 'http://192.168.195.213:10808'
                    elif 'proxy.naujtrats.xyz:8889' in proxy_url:
                        proxy_url = 'http://192.168.195.22:10808'
                    os.environ['HTTP_PROXY'] = proxy_url
                    os.environ['HTTPS_PROXY'] = proxy_url
                    os.environ['ALL_PROXY'] = proxy_url
                    print(f'[Engine] 代理已启用: {proxy_url}')
                    return proxy_url
            except Exception:
                pass
    except Exception as e:
        print(f'[Engine] 代理配置加载失败: {e}')
    return None

# Cross-platform: fcntl is Unix-only
try:
    import fcntl
    HAS_FCNTL = True
except ImportError:
    HAS_FCNTL = False

# ── Project root detection ────────────────────────────
PROJECT_ROOT = str(Path(__file__).parent.parent.resolve())

# ★ _PROXY_URL 依赖 PROJECT_ROOT，必须在 PROJECT_ROOT 之后初始化
_PROXY_URL = _load_proxy_config()

# ── 全局 Session (带代理) ──────────────────────────────
_http_session = requests.Session()
if _PROXY_URL:
    _http_session.proxies = {'http': _PROXY_URL, 'https': _PROXY_URL}

def _get_proxies():
    """获取请求代理字典"""
    if _PROXY_URL:
        return {'http': _PROXY_URL, 'https': _PROXY_URL}
    return None
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, str(Path(__file__).parent.resolve()))
sys.path.insert(0, os.path.join(tempfile.gettempdir(), 'pylib'))

try:
    from fastapi import FastAPI, Query, HTTPException, Request, WebSocket, WebSocketDisconnect
    from fastapi.responses import StreamingResponse, JSONResponse
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except Exception:
    print("[引擎] 需要安装 fastapi/uvicorn: pip install fastapi uvicorn --break-system-packages")
    sys.exit(1)

# ── 引擎层模块 ────────────────────────────────────────────
from engine.exec_policy import ExecPolicy, ExecDecision, Priority
from engine.speculation import SpeculationEngine, SpeculationState
from engine.retry import RetryEngine, RetryStatus
from engine.tool_registry import ToolRegistry, ToolDef, Capability, ApprovalKind, get_global_registry
from engine.event_frame import EventFlowBuilder, EventType, EventLog
from engine.store import EngineStore, ChatStore, get_ns as _store_get_ns, get_chat_store as _store_get_chat_store
from engine.rag_engine import (rag_list_collections, rag_create_collection, rag_delete_collection,
                                rag_upload_document, rag_search, rag_list_documents, rag_delete_document,
                                _get_embedding, _load_json, _save_json, RAG_DIR)
from engine.video_edit import (SUBTITLE_FONTS, DEFAULT_FONT, generate_srt as _video_generate_srt,
    str_to_rgb, color_to_ass, ypos_to_alignment, hex_to_rgba, draw_rounded_rect, init_video_context,
    _apply_subtitle, _apply_filter, _apply_transition, _apply_tts,
    _apply_voice_to_video, _apply_crop, _apply_reverse, _apply_mute,
    _apply_bgm, _apply_enhance, _apply_gif, _apply_silent_cut,
    _apply_subtitle_style, _apply_ffmpeg_filter, _apply_ffmpeg_transition, _apply_compose,
    _apply_stt, _apply_stt_to_timeline)
from engine.cron import _run_cron_job, _start_cron_job as _cron_start, _stop_cron_job as _cron_stop
from engine.agent_roles import AGENT_ROLES, filter_tools_by_role as _filter_tools_by_role, cleanup_old_agents as _cleanup_old_agents
from engine.server_tools import register_server_tools
from engine.agent_endpoints import register_agent_endpoints
from engine.crypto import load_encryption_key, get_aes_key, decrypt_xor
from engine.agent_memory import read_memory_json, write_memory_json
from engine.workflow import create_workflow, run_workflow, list_workflows, status_workflow, delete_workflow, get_roles as _wf_get_roles



app = FastAPI(title="OneAPIChat Engine")
app.add_middleware(CORSMiddleware, allow_origins=[
    "https://naujtrats.xyz",
    "https://www.naujtrats.xyz",
    "https://localmodels.naujtrats.xyz",
], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

ENGINE_DIR = Path(PROJECT_ROOT) / ".engine"
ENGINE_DIR.mkdir(parents=True, exist_ok=True)
STREAM_DIR = ENGINE_DIR / "streams"
STREAM_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR = Path(tempfile.gettempdir())
init_video_context(PROJECT_ROOT, TEMP_DIR, _http_session)

# ── 引擎层全局实例 ──────────────────────────────────────────
exec_policy = ExecPolicy(rules_file=str(ENGINE_DIR / "exec_policy.json"))
speculation_engine = SpeculationEngine()
retry_engine = RetryEngine(max_attempts=3, backoff_base_ms=500)
tool_registry = get_global_registry()
event_log = EventLog()

if exec_policy._rules_file and not exec_policy._rules_file.exists():
    exec_policy.save()

# ==================== 存储实例 (EngineStore 由 engine.store 导入) ====================
cron_store = EngineStore(ENGINE_DIR / "cron.json")
agent_store = EngineStore(ENGINE_DIR / "agents.json")
heartbeat_store = EngineStore(ENGINE_DIR / "heartbeat.json")

# SUBTITLE_FONTS / DEFAULT_FONT → engine.video_edit (imported above)

# 视频工具函数全部迁移到 engine.video_edit (通过 import 直接引用)









# _apply_* 视频函数全部迁移到 engine.video_edit (通过 import 直接引用)

# ═══════════════════════════════════════════════════════
# 新增视频处理功能 (2026-05-28)
# ═══════════════════════════════════════════════════════









# -- 存储工厂函数 (包装 engine.store, 自动注入 ENGINE_DIR) --
def get_ns(suffix: str, user_id: str = "") -> EngineStore:
    """获取用户隔离的 store 实例"""
    return _store_get_ns(ENGINE_DIR, suffix, user_id)

def get_chat_store(user_id: str = "") -> ChatStore:
    """获取用户隔离的 ChatStore 单例"""
    return _store_get_chat_store(ENGINE_DIR, user_id)

# ==================== 心跳 ====================
@app.get("/engine/health")
def engine_health():
    return {"status": "ok", "time": datetime.now().isoformat()}

@app.get("/engine/heartbeat")
def heartbeat(user_id: str = Query("")):
    """客户端心跳上报"""
    store = get_ns("heartbeat", user_id)
    client = "web"
    data = store.get()
    data[client] = {
        "last_seen": time.time(),
        "time": datetime.now().isoformat()
    }
    store.set(data)
    # 返回待处理的消息
    pending = data.get("pending_messages", [])
    result = {"ok": True, "pending": pending}
    if pending:
        data["pending_messages"] = []
        store.set(data)
    return result

@app.get("/engine/heartbeat/push")
def heartbeat_push(msg: str = Query(...), user_id: str = Query("")):
    """向客户端推送消息(通过心跳带回 + SSE实时推送)"""
    store = get_ns("heartbeat", user_id)
    data = store.get()
    pending = data.get("pending_messages", [])
    entry = {"msg": msg, "time": datetime.now().isoformat()}
    pending.append(entry)
    data["pending_messages"] = pending
    store.set(data)
    # Also push via SSE for instant delivery
    _broadcast_to_user(user_id, 'heartbeat:push', entry)
    return {"ok": True}

# ==================== 子代理并发锁 ====================
# per-user 的写锁,防止并行子代理写入冲突
_agent_store_locks: dict = {}
_agent_store_lock_lock = threading.Lock()

def _get_agent_store_lock(user_id: str) -> threading.Lock:
    """获取用户级别的写锁(线程安全)"""
    with _agent_store_lock_lock:
        if user_id not in _agent_store_locks:
            _agent_store_locks[user_id] = threading.Lock()
        return _agent_store_locks[user_id]

# ==================== Cron 任务 (后台逻辑→engine.cron) ====================

@app.get("/engine/cron/list")
def cron_list(user_id: str = Query("")):
    store = get_ns("cron", user_id)
    return store.get()

@app.get("/engine/cron/create")
def cron_create(
    name: str = Query(...),
    interval: int = Query(...),
    action: str = Query(...),
    user_id: str = Query("")
):
    # ★ 防护: 拒绝空值或前端透传的 undefined 字符串
    if not action or not action.strip() or action.strip().lower() == 'undefined':
        return {"ok": False, "error": "action 参数无效(空值或 undefined)"}
    if interval < 10:
        return {"ok": False, "error": "interval 不能小于10秒"}
    store = get_ns("cron", user_id)
    jobs = store.get()
    jobs[name] = {
        "name": name, "interval": interval, "action": action.strip(),
        "enabled": True, "created": datetime.now().isoformat()
    }
    store.set(jobs)
    _cron_start(name, user_id, get_ns)
    return {"ok": True, "job": name}

@app.get("/engine/cron/delete")
def cron_delete(name: str = Query(...), user_id: str = Query("")):
    _cron_stop(name, user_id, get_ns)
    store = get_ns("cron", user_id)
    store.delete(name)
    return {"ok": True}



# ==================== 子代理 ====================


@app.get("/engine/agent/list")
def agent_list(user_id: str = Query("")):
    store = get_ns("agents", user_id)
    agents = store.get()
    cleaned = _cleanup_old_agents(agents)
    if cleaned:
        store.set(agents)
    return agents

@app.get("/engine/agent/create")
def agent_create(
    name: str = Query(...),
    prompt: str = Query(...),
    role: str = Query("general"),
    model: str = Query(""),
    api_key: str = Query(""),
    base_url: str = Query(""),
    user_id: str = Query(""),
    proxy_url: str = Query(""),
    proxy_enabled: str = Query("")
):
    store = get_ns("agents", user_id)
    agents = store.get()
    # 自动清理过时子代理
    _cleanup_old_agents(agents)
    # 验证角色名
    if role not in AGENT_ROLES:
        role = "general"
    # ★ 注入当前时间到 prompt,让子代理知道真实时间,避免搜出过时信息
    now_cn = datetime.now().strftime("%Y年%m月%d日 %H:%M")
    tz_str = "Asia/Shanghai (UTC+8)"
    time_tag = f"\n\n[系统] 当前真实时间: {now_cn} (时区: {tz_str}), 所有搜索关键词应包含最新年份日期。"
    agent_data = {
        "name": name,
        "prompt": prompt + time_tag,
        "role": role,
        "status": "idle",
        "created": datetime.now().isoformat(),
        "proxy_url": proxy_url or "",
        "proxy_enabled": proxy_enabled or ""
    }
    agents[name] = agent_data
    store.set(agents)
    return {"ok": True, "agent": name, "role": role}

@app.get("/engine/agent/run")
def agent_run(name: str = Query(...), user_id: str = Query(""), message: str = Query(""), from_ask: str = Query("")):
    """运行子代理(调用AI完成指定任务)
    message - 追加的消息内容(用于agent_ask)
    from_ask - 如果是agent_ask触发,消息追加到prompt后"""
    store = get_ns("agents", user_id)
    agents = store.get()
    agent = agents.get(name)
    if not agent:
        raise HTTPException(404, f"Agent {name} not found")
    # ★ 防止重复运行: 已完成/运行中的代理不允许再次启动
    _current_status = agent.get("status", "")
    if _current_status in ("running", "completed"):
        return {"ok": False, "error": f"Agent 已在运行或已完成 (status={_current_status})，请勿重复启动"}
    # 如果from_ask,把消息追加到agent的prompt
    if from_ask and message:
        agent["prompt"] = agent.get("prompt", "") + f"\n\n用户消息: {message}"

    from openai import OpenAI
    # ★ 所有 agent 统一从主聊天配置同步
    main_config = _get_main_chat_config(user_id)
    api_key = main_config.get("api_key", "") or os.getenv("OPENAI_API_KEY", "")
    base_url = main_config.get("base_url", "") or os.getenv("OPENAI_BASE_URL", "") or "https://api.minimaxi.com/v1"
    model = main_config.get("model", "") or "MiniMax-M2.7"
    if "api.minimaxi.com" in base_url and "minimax" not in model.lower():
        model = "MiniMax-M2.7"
    if not api_key:
        return {"error": "未配置API Key,请在聊天设置中配置后重试"}

    # ★ 根据角色选择工具集(最小权限原则)
    agent_role = agent.get("role", "general")

    # ★ 应用子代理的代理配置（用 http_client 而非全局 env 避免并发竞争）
    _agent_proxy_url = agent.get("proxy_url", "")
    _agent_proxy_enabled = agent.get("proxy_enabled", "")
    _agent_http_client = None
    if _agent_proxy_enabled == '1' and _agent_proxy_url:
        # 公网地址映射为内网
        if 'proxy.naujtrats.xyz:8888' in _agent_proxy_url:
            _agent_proxy_url = 'http://192.168.195.213:10808'
        elif 'proxy.naujtrats.xyz:8889' in _agent_proxy_url:
            _agent_proxy_url = 'http://192.168.195.22:10808'
        import httpx as _httpx
        _agent_http_client = _httpx.Client(proxy=_agent_proxy_url)
    elif _PROXY_URL:
        import httpx as _httpx
        _agent_http_client = _httpx.Client(proxy=_PROXY_URL)
        os.environ['ALL_PROXY'] = _PROXY_URL
        print(f'[Agent {name}] 代理已启用(全局配置): {_PROXY_URL}')
    else:
        for k in ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']:
            os.environ.pop(k, None)

    role_config = AGENT_ROLES.get(agent_role, AGENT_ROLES["general"])
    TOOLS = _filter_tools_by_role(agent_role)

    # ★ 角色级别模型选择:cheap 角色用轻量模型节省开销
    if role_config["model_tier"] == "cheap":
        # 尝试用 deepseek-chat 或站内最便宜的模型
        cheap_model = main_config.get("cheap_model", "") or os.getenv("CHEAP_MODEL", "")
        if cheap_model:
            model = cheap_model
        elif "minimaxi" in model.lower():
            model = "MiniMax-M2.7"  # MiniMax 本身已经是便宜模型
        # 对于 explorer/planner 减少 max_tokens 节省token
    max_agent_rounds = role_config["max_rounds"]

    def _execute_tool(tool_name, args):
        """执行子代理工具调用"""
        if tool_name == "web_search":
            query = args.get("query", "")
            if not query:
                return "错误:缺少 query 参数"
            try:
                # 从主聊配置读取搜索 Provider 和对应的 API Key
                search_provider = "tavily"  # 默认
                search_api_key = ""
                try:
                    config_path = os.path.join(PROJECT_ROOT, f"chat_data/config_user_{user_id}.json")
                    with open(config_path) as f:
                        raw_cfg = json.load(f)
                    # 读取搜索 Provider (用户可能在配置中选择 brave/google/tavily/duckduckgo)
                    raw_provider = raw_cfg.get("searchProvider", "") or ""
                    if raw_provider and raw_provider != "not-needed":
                        search_provider = raw_provider
                    # 读取对应 Provider 的 API Key
                    provider_key_fields = {
                        "tavily": "searchApiKeyTavily",
                        "brave": "searchApiKeyBrave",
                        "google": "searchApiKeyGoogle",
                    }
                    key_field = provider_key_fields.get(search_provider, "searchApiKey")
                    stored = raw_cfg.get(key_field, "") or raw_cfg.get("searchApiKey", "") or ""
                    if stored:
                        decrypted = _decrypt_xor(stored)
                        if decrypted:
                            search_api_key = decrypted
                except Exception:
                    pass

                # DuckDuckGo 不需要 API Key,直接转发
                if search_provider == "duckduckgo":
                    try:
                        from duckduckgo_search import DDGS
                        with DDGS() as ddgs:
                            ddgs_results = list(ddgs.text(query, max_results=8))
                        if not ddgs_results:
                            return f'搜索 "{query}" 无结果。请更换关键词重试。'
                        lines = []
                        for res in ddgs_results[:8]:
                            title = res.get("title", "")
                            url = res.get("href", res.get("link", ""))
                            content = res.get("body", res.get("snippet", ""))[:200].replace("\n", " ")
                            content = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', content)
                            lines.append(f"- [{title}]({url})\n  {content}")
                        return f"搜索结果 (provider: {search_provider}, query: {query}):\n" + "\n\n".join(lines) + "\n\n注: 如需查看详情请使用 web_fetch 工具抓取网页内容。"
                    except ImportError:
                        # duckduckgo_search 未安装,回退至 Tavily
                        search_provider = "tavily"
                    except Exception as e:
                        return f"搜索出错 ({search_provider}): {str(e)}\n请稍后重试或更换关键词。"

                # Tavily 搜索 (失败时自动回退到 MiniMax CLI 搜索)
                def _try_tavily(q):
                    if not search_api_key:
                        return None
                    try:
                        r = _http_session.post(
                            "https://api.tavily.com/search",
                            json={
                                "api_key": search_api_key,
                                "query": q,
                                "search_depth": "advanced",
                                "max_results": 10,
                                "include_answer": True
                            },
                            timeout=20
                        )
                        if r.status_code != 200:
                            return None  # 401/429/500 → 回退
                        data = r.json()
                        results = data.get("results", [])
                        answer = data.get("answer", "") or ""
                        if not results:
                            if answer:
                                return f"搜索结果 (query: {q}):\n[摘要] {answer[:500]}\n\n注: 未搜索到具体网页结果,以上为 AI 摘要。"
                            return None  # 空结果 → 回退
                        lines = []
                        for res in results[:8]:
                            title = res.get("title", "")
                            url = res.get("url", "")
                            content = res.get("content", "")[:200].replace("\n", " ")
                            content = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', content)
                            lines.append(f"- [{title}]({url})\n  {content}")
                        return f"搜索结果 (provider: tavily, query: {q}):\n" + "\n\n".join(lines) + "\n\n注: 如需查看详情请使用 web_fetch 工具抓取网页内容。"
                    except Exception:
                        return None

                # MiniMax CLI 搜索回退
                def _try_minimax_search(q):
                    try:
                        import subprocess as _subprocess
                        # ★ 自动给搜索词追加当前日期,提升搜索相关性
                        today_str = datetime.now().strftime("%Y年%m月%d日")
                        if today_str[:4] not in q:
                            q = q + f" {today_str}"
                        r = _subprocess.run(
                            ["mmx", "search", "query", "--q", q, "--output", "json"],
                            capture_output=True, text=True, timeout=30
                        )
                        if r.returncode != 0:
                            return None
                        data = json.loads(r.stdout)
                        organic = data.get("organic", [])
                        if not organic:
                            return None
                        lines = []
                        for res in organic[:8]:
                            title = res.get("title", "")
                            url = res.get("link", "")
                            content = res.get("snippet", res.get("body", ""))[:200].replace("\n", " ")
                            content = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', content)
                            lines.append(f"- [{title}]({url})\n  {content}")
                        return f"搜索结果 (provider: minimax, query: {q}):\n" + "\n\n".join(lines) + "\n\n注: 如需查看详情请使用 web_fetch 工具抓取网页内容。"
                    except Exception as _mmx_e2:
                        return None

                if search_provider == "tavily":
                    result = _try_tavily(query)
                    if result:
                        return result
                    # Tavily 失败 → 回退 MiniMax CLI
                    mmx_result = _try_minimax_search(query)
                    if mmx_result:
                        return mmx_result
                    return f'搜索 "{query}" 无结果。请更换关键词重试。'

                # Brave 搜索
                if search_provider == "brave":
                    if not search_api_key:
                        return f"搜索出错: 未找到 Brave API Key (请先在设置中配置搜索API Key)"
                    headers = {"Accept": "application/json", "X-Subscription-Token": search_api_key}
                    r = _http_session.get(
                        f"https://api.search.brave.com/res/v1/web/search?q={requests.utils.quote(query)}&count=8&safesearch=off",
                        headers=headers, timeout=15
                    )
                    data = r.json()
                    results = data.get("web", {}).get("results", [])
                    if not results:
                        return f'搜索 "{query}" 无结果。请更换关键词重试。'
                    lines = []
                    for res in results[:8]:
                        title = res.get("title", "")
                        url = res.get("url", "")
                        content = res.get("description", "")[:200].replace("\n", " ")
                        content = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', content)
                        lines.append(f"- [{title}]({url})\n  {content}")
                    return f"搜索结果 (provider: {search_provider}, query: {query}):\n" + "\n\n".join(lines) + "\n\n注: 如需查看详情请使用 web_fetch 工具抓取网页内容。"

                # 兜底: 不支持的 provider (如 minimax) 统一先用 MiniMax CLI 搜索
                print(f"[web_search] 走兜底, search_provider={search_provider}, query={query[:50]}", flush=True)
                try:
                    mmx_result = _try_minimax_search(query)
                    print(f"[web_search] _try_minimax_search 结果: {str(mmx_result)[:100] if mmx_result else 'None'}", flush=True)
                    if mmx_result:
                        return mmx_result
                except Exception as _mmx_e:
                    print(f"[web_search] _try_minimax_search 异常: {_mmx_e}", flush=True)
                # MiniMax 也无结果时,再试试 Tavily
                print(f"[web_search] 尝试 Tavily 兜底", flush=True)
                tavily_result = _try_tavily(query)
                print(f"[web_search] _try_tavily 结果: {str(tavily_result)[:100] if tavily_result else 'None'}", flush=True)
                if tavily_result:
                    return tavily_result
                print(f"[web_search] 全部搜索失败,返回无结果", flush=True)
                return f'搜索 "{query}" 无结果。请更换关键词重试。'
            except Exception as e:
                return f"搜索出错: {str(e)}\n请稍后重试或更换关键词。"
        elif tool_name == "web_fetch":
            urls = []
            if args.get("url"): urls.append(args["url"])
            if args.get("urls"): urls.extend(args["urls"][:3])
            results = []
            for url in urls:
                try:
                    # 使用增强提取器(支持平台特定 + 通用HTML解析)
                    from engine.web_extract import web_extractor as _wex
                    import asyncio as _asyncio
                    bm = None
                    try:
                        from engine.browser import ensure_browser_connected
                        bm = _asyncio.run(ensure_browser_connected())
                    except Exception:
                        pass
                    ext_result = _asyncio.run(_wex.extract(url, _http_session, bm))
                    if ext_result and ext_result.content and len(ext_result.content) > 50:
                        text = ext_result.content
                    else:
                        # 回退到简单HTTP请求
                        r = _http_session.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
                        raw = r.text
                        raw = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', raw)
                        raw = re.sub(r'<[^>]+>', ' ', raw)
                        raw = re.sub(r'\s+', ' ', raw).strip()
                        text = raw[:20000]
                    results.append(f"[{url}]: {text}")
                except Exception as e:
                    results.append(f"[{url}]: 错误 - {str(e)}")
            return "\n\n".join(results) if results else "未提供URL"
        elif tool_name == "run_skill":
            skill_name = args.get("skill_name", "")
            skill_params = args.get("params", {})
            if not skill_name:
                return "错误: 缺少 skill_name 参数"
            try:
                from engine.skills import get_skill, render_prompt
                skill = get_skill(user_id, skill_name)
                if not skill:
                    return f"技能 '{skill_name}' 不存在。可用技能请查看系统提示词。"
                prompt = render_prompt(skill.get("prompt_template", ""), skill_params)
                if not prompt:
                    return "技能提示词模板为空"
                # 将渲染后的提示词作为当前对话的上下文返回
                return (
                    f"[技能: {skill.get('label', skill_name)}]\n"
                    f"已为以下任务生成定制提示词。请按照以下指示完成任务:\n\n"
                    f"---\n{prompt}\n---\n\n"
                    f"可用工具: {', '.join(skill.get('tools', []))}"
                )
            except Exception as e:
                return f"run_skill 错误: {str(e)}"
        elif tool_name == "platform_extract":
            url = args.get("url", "")
            if not url:
                return "错误: 缺少 url 参数"
            try:
                from engine.web_extract import web_extractor as _wex
                import asyncio as _asyncio
                bm = None
                try:
                    from engine.browser import ensure_browser_connected
                    bm = _asyncio.run(ensure_browser_connected())
                except Exception:
                    pass
                result = _asyncio.run(_wex.extract(url, _http_session, bm))
                if result and result.content:
                    output = result.content
                    if result.structured:
                        output += "\n\n[结构化数据]\n" + json.dumps(result.structured, ensure_ascii=False, indent=2)[:5000]
                    return output
                return f"无法从 {url} 提取内容"
            except Exception as e:
                return f"platform_extract 错误: {str(e)}"
        elif tool_name == "engine_push":
            import re, hashlib, shutil as _shutil
            msg = args.get("msg", "")
            file_path = args.get("file", "")

            # Step 1: clean Markdown pollution from URLs in msg
            def _clean_url(u):
                u = re.sub(r'[*_~`]+$', '', u)
                u = re.sub(r'^[)\]]+', '', u)
                m = re.search(r'\]\(\s*(https?://\S+?)\s*\)', u)
                if m:
                    u = m.group(1)
                return u

            if msg:
                msg = re.sub(r'https?://\S+', lambda m: _clean_url(m.group(0)), msg)

            # Step 2: handle file parameter — copy to shared dir, generate download URL
            if file_path and os.path.isfile(file_path):
                shared_dir = os.path.join(PROJECT_ROOT, 'uploads', 'shared')
                os.makedirs(shared_dir, exist_ok=True)
                fname = os.path.basename(file_path)
                shared_name = f"push_{hashlib.md5(fname.encode()).hexdigest()[:8]}.pptx"
                shared_path = os.path.join(shared_dir, shared_name)
                _shutil.copy2(file_path, shared_path)
                dl_url = f"https://naujtrats.xyz/oneapichat/uploads/shared/{shared_name}"
                msg = (msg + "\n\n" + dl_url) if msg else dl_url

            if msg:
                push_store = get_ns("heartbeat", user_id)
                data = push_store.get()
                pending = data.get("pending_messages", []) if data else []
                pending.append({"msg": msg, "time": datetime.now().isoformat()})
                if data is None:
                    data = {}
                data["pending_messages"] = pending
                push_store.set(data)
            return "消息已推送到用户"
        elif tool_name == "server_sys_info":
            import shutil
            mem = subprocess.run("free -h | head -2", shell=True, capture_output=True, text=True).stdout
            disk = subprocess.run("df -h / | tail -1", shell=True, capture_output=True, text=True).stdout
            return f"内存:\n{mem}\n磁盘:\n{disk}"
        elif tool_name == "server_file_append":
            path = args.get("path", "")
            content = args.get("content", "")
            if not path or not content:
                return "错误:缺少 path 或 content 参数"
            try:
                allowed_prefix = str(TEMP_DIR) + "/"
                if not path.startswith(allowed_prefix):
                    return f"错误:只允许写入 {allowed_prefix} 目录"
                safe_path = os.path.normpath(path)
                if not safe_path.startswith(allowed_prefix):
                    return "错误:路径不合法"
                os.makedirs(os.path.dirname(safe_path), exist_ok=True)
                mode = "a"  # 追加模式
                with open(safe_path, mode, encoding="utf-8") as f:
                    f.write(content + "\n\n")
                fname = os.path.basename(safe_path)
                dl_url = "/oneapichat/download.php?file=" + fname
                # 读取当前文件总大小
                total = len(open(safe_path, encoding="utf-8").read())
                return f"内容已追加到: {safe_path}\n下载链接: {dl_url}\n当前文件大小: {total} 字符"
            except Exception as e:
                return f"追加失败: {str(e)}"
        elif tool_name == "server_file_write":
            path = args.get("path", "")
            content = args.get("content", "")
            if not path or not content:
                return "错误:缺少 path 或 content 参数"
            try:
                allowed_prefix = str(TEMP_DIR) + "/"
                if not path.startswith(allowed_prefix):
                    return f"错误:只允许写入 {allowed_prefix} 目录"
                safe_path = os.path.normpath(path)
                if not safe_path.startswith(allowed_prefix):
                    return "错误:路径不合法"
                os.makedirs(os.path.dirname(safe_path), exist_ok=True)
                with open(safe_path, "w", encoding="utf-8") as f:
                    f.write(content)
                fname = os.path.basename(safe_path)
                dl_url = "/oneapichat/download.php?file=" + fname
                return f"文件已保存: {safe_path}\n下载链接: {dl_url}\n大小: {len(content)} 字符"
            except Exception as e:
                return f"写入失败: {str(e)}"
        elif tool_name == "server_file_read":
            path = args.get("path", "")
            if not path:
                return "错误:缺少 path 参数"
            try:
                if not os.path.isfile(path):
                    return f"文件不存在: {path}"
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read(10000)
                return f"{path} 的内容 ({len(content)} 字符):\n\n{content}"
            except Exception as e:
                return f"读取失败: {str(e)}"
        elif tool_name == "browser_navigate":
            try:
                import asyncio
                from engine.browser import ensure_browser_connected
                bm = asyncio.run(ensure_browser_connected())
                result = asyncio.run(bm.navigate(args.get("url", "")))
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                return f"浏览器导航失败: {str(e)}"
        elif tool_name == "browser_screenshot":
            try:
                import asyncio
                from engine.browser import ensure_browser_connected
                bm = asyncio.run(ensure_browser_connected())
                result = asyncio.run(bm.screenshot())
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                return f"浏览器截图失败: {str(e)}"
        elif tool_name == "browser_click":
            try:
                import asyncio
                from engine.browser import ensure_browser_connected
                bm = asyncio.run(ensure_browser_connected())
                result = asyncio.run(bm.click(args.get("selector", "")))
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                return f"浏览器点击失败: {str(e)}"
        elif tool_name == "browser_type":
            try:
                import asyncio
                from engine.browser import ensure_browser_connected
                bm = asyncio.run(ensure_browser_connected())
                result = asyncio.run(bm.type_text(args.get("selector", ""), args.get("text", "")))
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                return f"浏览器输入失败: {str(e)}"
        elif tool_name == "browser_get_content":
            try:
                import asyncio
                from engine.browser import ensure_browser_connected
                bm = asyncio.run(ensure_browser_connected())
                result = asyncio.run(bm.get_content())
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                return f"浏览器获取内容失败: {str(e)}"
        elif tool_name == "browser_get_snapshot":
            try:
                import asyncio
                from engine.browser import ensure_browser_connected
                bm = asyncio.run(ensure_browser_connected())
                result = asyncio.run(bm.get_snapshot())
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                return f"浏览器获取结构失败: {str(e)}"
        elif tool_name == "video_edit":
            try:
                import json as _json
                action = args.get("action", "")
                params = args.get("params", {})
                input_path = args.get("input_path", "")
                output_path = args.get("output_path", "/tmp/video_output.mp4")
                if not input_path:
                    return "错误: 未提供输入视频路径"
                if not os.path.exists(input_path):
                    return f"错误: 输入文件不存在: {input_path}"
                if action == "info":
                    cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", input_path]
                    r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                    return r.stdout
                elif action == "trim":
                    start = params.get("start", 0)
                    end = params.get("end", None)
                    from moviepy import VideoFileClip
                    clip = VideoFileClip(input_path)
                    if end:
                        clip = clip.subclipped(start, end)
                    else:
                        clip = clip.subclipped(start)
                    clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
                    clip.close()
                    return f"裁剪完成: {output_path}"
                elif action == "speed":
                    factor = float(params.get("factor", 1.0))
                    from moviepy import VideoFileClip
                    from moviepy import vfx
                    clip = VideoFileClip(input_path)
                    clip = clip.with_effects([vfx.MultiplySpeed(factor)])
                    clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
                    clip.close()
                    return f"调速完成 (x{factor}): {output_path}"
                elif action == "resize":
                    width = params.get("width", 0)
                    height = params.get("height", 0)
                    from moviepy import VideoFileClip
                    from moviepy import vfx
                    clip = VideoFileClip(input_path)
                    if width and height:
                        clip = clip.resized((width, height))
                    elif width:
                        clip = clip.resized(width=width)
                    elif height:
                        clip = clip.resized(height=height)
                    clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
                    clip.close()
                    return f"缩放完成: {output_path}"
                elif action == "audio":
                    from moviepy import VideoFileClip
                    clip = VideoFileClip(input_path)
                    audio_output = output_path or input_path + ".mp3"
                    if clip.audio:
                        clip.audio.write_audiofile(audio_output)
                    clip.close()
                    return f"音频提取完成: {audio_output}"
                elif action == "concat":
                    files = params.get("files", [])
                    if not files:
                        return "错误: concat 需要 files 数组参数"
                    from moviepy import concatenate_videoclips
                    clips = [VideoFileClip(f) for f in files]
                    final = concatenate_videoclips(clips, method="compose")
                    final.write_videofile(output_path, codec="libx264", audio_codec="aac")
                    for c in clips: c.close()
                    final.close()
                    return f"拼接完成 ({len(files)}个视频): {output_path}"
                elif action == "overlay":
                    overlay_path = params.get("overlay_path", "")
                    if not overlay_path or not os.path.exists(overlay_path):
                        return "错误: overlay 需要 overlay_path 参数指向存在的文件"
                    x = params.get("x", 10)
                    y = params.get("y", 10)
                    scale = params.get("scale", 0.3)
                    from moviepy import CompositeVideoClip
                    clip = VideoFileClip(input_path)
                    ov = VideoFileClip(overlay_path).resized(scale)
                    ov = ov.with_position((x, y))
                    final = CompositeVideoClip([clip, ov])
                    final.write_videofile(output_path, codec="libx264", audio_codec="aac")
                    clip.close(); ov.close(); final.close()
                    return f"画中画完成: {output_path}"
                elif action == "text":
                    return _apply_subtitle(input_path, output_path, params)
                elif action == "rotate":
                    angle = float(params.get("angle", 90))
                    from moviepy import vfx
                    clip = VideoFileClip(input_path)
                    clip = clip.with_effects([vfx.Rotate(angle)])
                    clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
                    clip.close()
                    return f"旋转完成 ({angle}°): {output_path}"
                elif action in ("filter", "video_filter"):
                    return _apply_ffmpeg_filter(input_path, output_path, params)
                elif action in ("transition", "video_transition"):
                    return _apply_ffmpeg_transition(input_path, output_path, params)
                elif action == "crop":
                    return _apply_crop(input_path, output_path, params)
                elif action == "reverse":
                    return _apply_reverse(input_path, output_path, params)
                elif action == "mute":
                    return _apply_mute(input_path, output_path, params)
                elif action == "bgm":
                    return _apply_bgm(input_path, output_path, params)
                elif action == "enhance":
                    return _apply_enhance(input_path, output_path, params)
                elif action == "gif":
                    return _apply_gif(input_path, output_path, params)
                elif action == "silent_cut":
                    return _apply_silent_cut(input_path, output_path, params)
                elif action == "stt":
                    return _apply_stt(input_path, output_path, params)
                elif action == "stt_to_timeline":
                    return _apply_stt_to_timeline(input_path, output_path, params)
                elif action == "style":
                    return _apply_subtitle_style(input_path, output_path, params)
                elif action == "tts":
                    return _apply_tts(params)
                elif action == "voice":
                    # voice: 将 TTS 生成的音频混入视频
                    audio_path = params.get("audio_path", "")
                    if not audio_path:
                        # 如果没有 audio_path,先调 TTS 生成
                        tts_result = _apply_tts(params)
                        if "失败" in tts_result or "异常" in tts_result:
                            return tts_result
                        audio_path = tts_result.split(": ")[1].split(" ")[0] if ": " in tts_result else "/tmp/tts_output.mp3"
                    return _apply_voice_to_video(input_path, audio_path, output_path, params)
                elif action == "compose":
                    return _apply_compose(input_path, output_path, params)
                else:
                    return f"未知操作: {action}, 支持: compose/crop/reverse/mute/bgm/enhance/gif/silent_cut/stt/stt_to_timeline/style/trim/concat/speed/resize/overlay/text/rotate/audio/filter/video_filter/transition/video_transition/tts/voice/frames/info"
            except ImportError as _e:
                return f"缺少依赖: {str(_e)}, 请先安装: pip install moviepy --break-system-packages"
            except Exception as _e:
                return f"视频剪辑失败: {str(_e)}"

        elif tool_name == "generate_ppt":
            try:
                title = args.get("title", "Presentation")
                pages = args.get("pages", [])
                theme_name = args.get("theme", "default")
                filename = args.get("filename", "")
                if not pages:
                    return "错误: 需要 pages 参数"
                from ppt_engine.build import build_pptx
                import shutil
                safe_name = (filename or 'output').replace('/', '_').replace('\\', '_')
                tmp_path = f"/tmp/ppt_{safe_name}.pptx"
                output = build_pptx(tmp_path, title, pages, theme_name)
                # Copy to web-accessible uploads dir
                web_dir = os.path.join(PROJECT_ROOT, 'uploads', 'shared')
                os.makedirs(web_dir, exist_ok=True)
                web_path = os.path.join(web_dir, f"ppt_{safe_name}.pptx")
                shutil.copy2(output, web_path)
                file_size_kb = os.path.getsize(web_path) // 1024
                web_url = f"https://naujtrats.xyz/oneapichat/uploads/shared/ppt_{safe_name}.pptx"
                return (
                    f"✅ PPT已生成\n"
                    f"📥 下载链接: {web_url}\n"
                    f"📦 大小: {file_size_kb} KB | 页数: {len(pages)}\n"
                    f"⚠️ 请直接复制上面的完整链接给用户，不要截断或省略。"
                )
        # ★ 通用转发: 子代理调用未知工具时自动转发到主引擎 API
        elif tool_name.startswith("server_") or tool_name == "engine_cron_list" or tool_name == "engine_cron_create" or tool_name == "engine_cron_delete":
            try:
                _engine_url = "http://127.0.0.1:8766/engine/" + {
                    "server_exec": "exec", "server_python": "python", "server_file_read": "file/read",
                    "server_file_write": "file/write", "server_file_search": "file_search",
                    "server_sys_info": "sys/info", "server_ps": "ps", "server_disk": "disk",
                    "server_network": "network", "server_docker": "docker", "server_db_query": "db_query",
                    "server_file_op": "file_op", "server_file_append": "file_append",
                    "engine_push": "agent/heartbeat"
                }.get(tool_name, tool_name)
                _params = {};
                for _k, _v in args.items(): _params[_k] = str(_v);
                _r = _http_session.get(_engine_url, params=_params, timeout=30);
                _d = _r.json();
                return json.dumps(_d, ensure_ascii=False)
            except Exception as _e:
                return f"工具执行失败: {str(_e)}"
        # 遇到未知工具时 not-sub-tool, 先尝试通过 engine/heartbeat 转发给主系统
        try:
            _engine_url = "http://127.0.0.1:8766/engine/agent/heartbeat?user_id=" + str(user_id) + "&tool_name=" + str(tool_name) + "&args=" + str(json.dumps(args))
            _r = _http_session.get(_engine_url, timeout=10)
            if _r.ok:
                _d = _r.json()
                if _d.get("ok") or _d.get("result"):
                    return json.dumps(_d.get("result", _d), ensure_ascii=False)
        except Exception:
            pass
        return f"[警告: 当前环境不支持 {tool_name} 工具] 跳过此操作,请用 web_search/web_fetch 替代"

    def _run():
        _lock = _get_agent_store_lock(user_id)
        _lock.acquire()
        try:
            current_agents = store.get()
            if name not in current_agents:
                current_agents[name] = agent
            current_agents[name]["status"] = "running"
            current_agents[name]["result"] = ""
            current_agents[name]["_started_at"] = time.time()
            store.set(current_agents)
        finally:
            _lock.release()

        MAX_EXECUTION_SECONDS = 600  # 30分钟强制超时
        try:
            client = OpenAI(api_key=api_key, base_url=base_url, timeout=120,
                            http_client=_agent_http_client)
            messages = [{"role": "user", "content": agent.get("prompt", "")}]
            max_rounds = max_agent_rounds
            result_parts = []
            start_time = time.time()

            for round_num in range(max_rounds):
                # 检查总执行时间
                if time.time() - start_time > MAX_EXECUTION_SECONDS:
                    raise TimeoutError(f"子代理执行超过{MAX_EXECUTION_SECONDS//60}分钟,自动终止")

                resp = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=TOOLS,
                    tool_choice="auto",
                    temperature=0.3,
                    max_tokens=2048,
                    timeout=120
                )
                msg = resp.choices[0].message
                # 用 model_dump 获取所有字段(包括 reasoning_content)
                msg_dict = msg.model_dump()
                if msg.content:
                    cleaned = msg.content
                    # 剔除 <think>...</think> 思考块
                    if '<think>' in cleaned or '</think>' in cleaned:
                        cleaned = re.sub(r'<think>.*?</think>', '', cleaned, flags=re.DOTALL).strip()
                    result_parts.append(cleaned)
                if not msg.tool_calls:
                    break  # 模型完成了

                # 获取 reasoning_content(DeepSeek 需要传回)
                asst_msg = {"role": "assistant", "content": msg.content}
                rc_val = msg_dict.get('reasoning_content', '') or msg_dict.get('reasoning', '')
                if not rc_val:
                    rc_val = (getattr(msg, 'model_extra', None) or {}).get('reasoning_content', '')
                if rc_val:
                    # DeepSeek 要求传回 reasoning_content(但不显示给用户)
                    asst_msg["reasoning_content"] = rc_val
                # 构建 tool_calls
                if hasattr(msg.tool_calls, 'model_dump'):
                    asst_msg["tool_calls"] = msg.tool_calls.model_dump()
                else:
                    asst_msg["tool_calls"] = [{"id": tc.id, "type": tc.type, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in msg.tool_calls]
                messages.append(asst_msg)

                for tc in msg.tool_calls:
                    tool_name = tc.function.name
                    try:
                        tool_args = json.loads(tc.function.arguments)
                    except json.JSONDecodeError as _je:
                        # ★ 工具参数解析失败时降级为"跳过并通知"
                        result_parts.append(f"[工具: {tool_name}] 参数解析失败: 跳过")
                        messages.append({"role": "tool", "tool_call_id": tc.id, "content": f"[错误] {tool_name} 参数解析失败: {str(_je)}, 请检查参数格式后重试"})
                        continue
                    try:
                        result = _execute_tool(tool_name, tool_args)
                    except Exception as _te:
                        result = f"[工具执行异常] {tool_name}: {str(_te)[:200]}"
                    # ★ 日志追踪: 工具名称 + 结果概要
                    result_preview = str(result)[:80].replace('\n', ' ')
                    print(f"[子代理:{name}] 工具调用: {tool_name} -> {result_preview}", flush=True)
                    # ★ 全局净化：移除所有控制字符和 unicode surrogate
                    if isinstance(result, str):
                        result = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', result)
                        if len(result) > 8000:
                            result = result[:8000] + '...(截断)'
                    # ★ 工具结果保存到 result_parts(用于最终 agent 结果),截断到 2000 字符供 AI 分析
                    result_parts.append(f"[工具: {tool_name}] {str(result)[:2000]}")
                    # ★ put 结果时再做一次安全包装
                    safe_content = str(result) if result else '(empty)'
                    messages.append({"role": "tool", "tool_call_id": tc.id, "content": safe_content})
                    # ★ 实时写入 partial result(带锁+重读,防止覆盖其他代理)
                    _lock.acquire()
                    try:
                        current = store.get()
                        current[name] = current.get(name, {})
                        current[name]["result"] = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', "\n".join(result_parts))
                        current[name]["status"] = "running"
                        current[name]["_started_at"] = current.get(name, {}).get("_started_at", time.time())
                        store.set(current)
                    finally:
                        _lock.release()

                # ★ 最终保存(带锁+重读)
            _lock.acquire()
            try:
                current = store.get()
                current[name] = current.get(name, {})
                final_result = "\n".join(result_parts)
                current[name]["result"] = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', final_result)
                current[name]["status"] = "completed"
                store.set(current)
            finally:
                _lock.release()
        except Exception as e:
            _lock.acquire()
            try:
                current = store.get()
                current[name] = current.get(name, {})
                current[name]["error"] = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', str(e))
                current[name]["status"] = "failed"
                store.set(current)
            finally:
                _lock.release()
        # ★ 通知引擎:此代理已完成,需要主代理处理
        # ★ 从 store 重新读取最新状态(不能用 agents 变量, _run 只写 store 不写 agents)
        _latest = store.get()
        _latest_agent = _latest.get(name, agents.get(name, {}))
        notify_store = get_ns("agent_notifications", user_id)
        notifs = notify_store.get()
        if not isinstance(notifs, list):
            notifs = []
        notifs.append({
            "agent": name,
            "status": _latest_agent.get("status", "unknown"),
            "result": _latest_agent.get("result", ""),
            "error": _latest_agent.get("error", ""),
            "time": datetime.now().isoformat(),
            "processed": False
        })
        # 裁剪超过50条的历史通知(防止内存泄漏)
        if len(notifs) > 50:
            notifs = notifs[-50:]
        notify_store.set(notifs)
        # Broadcast agent status change via SSE
        _broadcast_to_user(user_id, 'agent:status', {
            'agent': name,
            'status': _latest_agent.get('status', 'unknown'),
            'result_preview': (_latest_agent.get('result', '') or '')[:200],
            'time': notifs[-1]['time']
        })

    t = threading.Thread(target=_run, name=f"agent_{user_id}_{name}", daemon=True)
    t.start()
    return {"ok": True, "agent": name, "status": "running"}

@app.get("/engine/agent/status")
def agent_status(name: str = Query(...), user_id: str = Query("")):
    store = get_ns("agents", user_id)
    agents = store.get()
    agent = agents.get(name)
    if not agent:
        raise HTTPException(404, f"Agent {name} not found")
    return agent

# ==================== 主聊配置读取(所有 agent 同步主聊)====================
import base64

def _load_encryption_key() -> str:
    return load_encryption_key(PROJECT_ROOT)
ENCRYPTION_KEY = _load_encryption_key()  # ★ 必须在 _get_aes_key/_decrypt_xor 前初始化
def _get_aes_key() -> bytes:
    return get_aes_key(ENCRYPTION_KEY)
def _decrypt_xor(encoded: str) -> str:
    _aes = _get_aes_key() if (encoded and encoded.startswith("v2:")) else None
    return decrypt_xor(encoded, ENCRYPTION_KEY, _aes)
def _get_main_chat_config(user_id: str) -> dict:
    """从主聊天配置读取 api_key / base_url / model
    自动 XOR 解密 apiKey,优先主聊配置,无值则返回空字符串。
    """
    result = {"api_key": "", "base_url": "", "model": ""}
    if not user_id:
        return result
    config_path = os.path.join(PROJECT_ROOT, f"chat_data/config_user_{user_id}.json")
    try:
        with open(config_path) as f:
            cfg = json.load(f)
        stored_key = cfg.get("apiKey", "") or ""
        # 优先 XOR 解密,解密失败则用原始值
        if stored_key:
            decrypted = _decrypt_xor(stored_key)
            result["api_key"] = decrypted if decrypted else stored_key
        result["base_url"] = cfg.get("baseUrl", "") or ""
        result["model"] = cfg.get("model", "") or ""
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    except Exception as e:
        print(f"[引擎] 读取主聊配置失败: {e}")
    return result


# ★ 服务器操控工具 → engine/server_tools.py
register_server_tools(app)
@app.get("/engine/agent/stop")
def agent_stop(name: str = Query(...), user_id: str = Query("")):
    """停止子代理(标记为 stopped)"""
    store = get_ns("agents", user_id)
    agents = store.get()
    agent = agents.get(name)
    if not agent:
        return {"ok": False, "error": "Agent not found"}
    agents[name]["status"] = "stopped"
    store.set(agents)
    return {"ok": True, "agent": name, "status": "stopped"}

@app.get("/engine/agent/delete")
def agent_delete(name: str = Query(...), user_id: str = Query("")):
    """删除子代理(从列表中移除)"""
    store = get_ns("agents", user_id)
    agents = store.get()
    if name not in agents:
        return {"ok": False, "error": "Agent not found"}
    del agents[name]
    store.set(agents)
    return {"ok": True, "agent": name, "deleted": True}

@app.get("/engine/agent/notifications")
def agent_notifications(user_id: str = Query("")):
    """获取未处理的子代理完成通知(主代理调用)"""
    store = get_ns("agent_notifications", user_id)
    notifs = store.get()
    if not isinstance(notifs, list):
        store.set([])
        notifs = []
    unprocessed = [n for n in notifs if not n.get("processed", False)]
    return {"notifications": unprocessed, "count": len(unprocessed)}

@app.get("/engine/agent/notifications/mark")
def agent_notifications_mark(user_id: str = Query("")):
    """标记所有通知为已处理"""
    store = get_ns("agent_notifications", user_id)
    notifs = store.get()
    if not isinstance(notifs, list):
        store.set([])
        return {"ok": True}
    for n in notifs:
        n["processed"] = True
    store.set(notifs)
    return {"ok": True}
    return {"ok": True, "workflow": name, "steps": len(parsed_steps)}

    return {"ok": True, "workflow": name, "status": "running"}

    return wf_store.get()

    return wf

    return {"ok": True}

    return {"roles": [{"id": k, "label": v["label"], "desc": v["desc"]} for k, v in AGENT_ROLES.items()]}



# ==================== 工作流引擎 (核心逻辑→engine.workflow) ====================

@app.get("/engine/workflow/create")
def workflow_create(name: str = Query(...), steps: str = Query(...), user_id: str = Query("")):
    return create_workflow(name, steps, user_id, get_ns)

@app.get("/engine/workflow/run")
def workflow_run(name: str = Query(...), user_id: str = Query("")):
    return run_workflow(name, user_id, get_ns, _get_main_chat_config, AGENT_ROLES, _filter_tools_by_role)

@app.get("/engine/workflow/list")
def workflow_list(user_id: str = Query("")):
    return list_workflows(user_id, get_ns)

@app.get("/engine/workflow/status")
def workflow_status(name: str = Query(...), user_id: str = Query("")):
    return status_workflow(name, user_id, get_ns)

@app.get("/engine/workflow/delete")
def workflow_delete(name: str = Query(...), user_id: str = Query("")):
    return delete_workflow(name, user_id, get_ns)

@app.get("/engine/workflow/roles")
def workflow_roles(user_id: str = Query("")):
    return _wf_get_roles(AGENT_ROLES)

# ==================== 引擎层 API ====================

@app.get("/engine/v2/exec-policy/evaluate")
def exec_policy_evaluate(
    domain: str = Query("exec"),
    target: str = Query(...),
    user_id: str = Query("")
):
    """评估一个操作是否需要审批"""
    policy = exec_policy
    decision = policy.evaluate(domain, target)
    return {
        "ok": True,
        "domain": domain,
        "target": target,
        "decision": decision.kind,
        "reason": decision.reason,
        "matched_rule": decision.matched_rule,
        "matched_priority": decision.matched_priority,
    }


@app.get("/engine/v2/exec-policy/rules")
def exec_policy_rules(
    domain: str = Query(""),
    user_id: str = Query("")
):
    """获取策略规则列表"""
    return {"ok": True, "rules": exec_policy.list_rules(domain), "count": len(exec_policy.rules)}


@app.get("/engine/v2/exec-policy/add")
def exec_policy_add(
    domain: str = Query("exec"),
    pattern: str = Query(...),
    decision_kind: str = Query("skip"),
    reason: str = Query(""),
    priority: int = Query(2),
    description: str = Query(""),
    user_id: str = Query("")
):
    """添加策略规则"""
    if decision_kind == "skip":
        decision = ExecDecision.skip()
    elif decision_kind == "forbidden":
        decision = ExecDecision.forbidden(reason or "禁止操作")
    else:
        decision = ExecDecision.needs_approval(reason or "需要审批")
    rule = exec_policy.add_rule(domain, pattern, decision, priority=priority, description=description)
    return {"ok": True, "rule": rule.to_dict()}


@app.get("/engine/v2/exec-policy/remove")
def exec_policy_remove(
    domain: str = Query("exec"),
    pattern: str = Query(...),
    priority: int = Query(-1),
    user_id: str = Query("")
):
    """移除策略规则"""
    p = Priority(priority) if priority >= 0 else None
    removed = exec_policy.remove_rule(domain, pattern, p)
    return {"ok": removed}


@app.get("/engine/v2/exec-policy/reset")
def exec_policy_reset(user_id: str = Query("")):
    """重置为默认规则"""
    exec_policy.reset_to_defaults()
    return {"ok": True, "rules": len(exec_policy.rules)}


# ── 推测执行 API ─────────────────────────────────────

@app.get("/engine/v2/speculate")
def speculate(
    prompt: str = Query(...),
    user_id: str = Query("")
):
    """推测指令需要的工具调用"""
    result = speculation_engine.predict(prompt)
    return {
        "ok": True,
        "suggested_tools": [
            {"tool_name": t.tool_name, "confidence": t.confidence,
             "estimated_duration_ms": t.estimated_duration_ms}
            for t in result.suggested_tools
        ],
        "estimated_savings_ms": result.estimated_savings_ms,
    }


@app.get("/engine/v2/speculate/confirm")
def speculate_confirm(user_id: str = Query("")):
    """确认推测结果（命中）"""
    speculation_engine.confirm()
    return {"ok": True, "state": speculation_engine.state.value}


@app.get("/engine/v2/speculate/abort")
def speculate_abort(
    reason: str = Query("用户中止"),
    user_id: str = Query("")
):
    """中止推测"""
    speculation_engine.abort(reason=reason)
    return {"ok": True, "state": speculation_engine.state.value}


@app.get("/engine/v2/speculate/status")
def speculate_status(user_id: str = Query("")):
    """推测引擎状态"""
    return {"ok": True, **speculation_engine.summary()}


@app.get("/engine/v2/speculate/toggle")
def speculate_toggle(
    enabled: bool = Query(True),
    yolo: bool = Query(False),
    user_id: str = Query("")
):
    """切换推测引擎"""
    if enabled:
        speculation_engine.enable(yolo_mode=yolo)
    else:
        speculation_engine.disable()
    return {"ok": True, "enabled": enabled, "yolo_mode": yolo}


# ── 重试机制 API ─────────────────────────────────────

@app.get("/engine/v2/retry/status")
def retry_status(
    task_id: str = Query(""),
    user_id: str = Query("")
):
    """查询重试任务状态"""
    if task_id:
        meta = retry_engine.get_status(task_id)
        if not meta:
            return {"ok": False, "error": "Task not found (may have completed)"}
        return {"ok": True, "task": meta.to_dict()}
    return {"ok": True, **retry_engine.summary()}


@app.get("/engine/v2/retry/list")
def retry_list(
    status: str = Query(""),
    user_id: str = Query("")
):
    """列出重试任务"""
    if status:
        try:
            s = RetryStatus(status)
            tasks = retry_engine.list_tasks(s)
        except ValueError:
            tasks = retry_engine.list_active()
    else:
        tasks = retry_engine.list_active()
    return {"ok": True, "tasks": [t.to_dict() for t in tasks], "count": len(tasks)}


@app.get("/engine/v2/retry/config")
def retry_config(
    max_attempts: int = Query(3),
    backoff_base_ms: int = Query(500),
    user_id: str = Query("")
):
    """配置重试参数"""
    retry_engine.max_attempts = max_attempts
    retry_engine._default_backoff_base_ms = backoff_base_ms
    return {"ok": True, "max_attempts": max_attempts, "backoff_base_ms": backoff_base_ms}


# ── 工具注册表 API ───────────────────────────────────

@app.get("/engine/v2/tools/list")
def tools_list(
    capability: str = Query(""),
    approval: str = Query(""),
    tag: str = Query(""),
    role: str = Query(""),
    user_id: str = Query("")
):
    """列出工具（支持按能力/审批要求/标签/角色过滤）"""
    if role:
        tools = tool_registry.to_openai_tools(role=role)
        return {"ok": True, "tools": tools, "count": len(tools), "format": "openai"}

    filters = {}
    if capability:
        try:
            filters["capabilities"] = [Capability[capability]]
        except KeyError:
            pass
    if approval:
        try:
            filters["approval"] = ApprovalKind(approval)
        except ValueError:
            pass
    if tag:
        tools = tool_registry.list_by_tag(tag)
    elif filters:
        tools = tool_registry.filter(**filters)
    else:
        tools = tool_registry.list_enabled()
    return {"ok": True, "tools": [t.to_dict() for t in tools], "count": len(tools)}


@app.get("/engine/v2/tools/openai")
def tools_openai(
    role: str = Query(""),
    user_id: str = Query("")
):
    """导出工具为 OpenAI tool format"""
    return {"ok": True, "tools": tool_registry.to_openai_tools(role=role)}


@app.get("/engine/v2/tools/summary")
def tools_summary(user_id: str = Query("")):
    """工具注册表摘要"""
    return {"ok": True, **tool_registry.summary()}


# ── 事件帧 API ───────────────────────────────────────

_session_flows: dict = {}


@app.get("/engine/v2/events/create")
def events_create(
    session_id: str = Query(""),
    user_id: str = Query("")
):
    """创建新的事件流会话"""
    builder = EventFlowBuilder(session_id=session_id)
    _session_flows[builder.session_id] = builder
    return {"ok": True, "session_id": builder.session_id}


@app.get("/engine/v2/events/emit")
def events_emit(
    event_type: str = Query(...),
    data: str = Query("{}"),
    session_id: str = Query(""),
    user_id: str = Query("")
):
    """发送一个事件帧"""
    try:
        etype = EventType(event_type)
        parsed = json.loads(data)
    except (ValueError, json.JSONDecodeError) as e:
        return {"ok": False, "error": str(e)}

    builder = _session_flows.get(session_id)
    if not builder:
        builder = EventFlowBuilder(session_id=session_id)
        _session_flows[session_id] = builder

    frame = builder.emit(etype, parsed)
    event_log.record(frame)
    return {"ok": True, "event_id": frame.event_id, "sequence": frame.sequence}


@app.get("/engine/v2/events/stream")
def events_stream(
    session_id: str = Query(""),
    user_id: str = Query("")
):
    """获取事件流（JSON Lines）"""
    builder = _session_flows.get(session_id)
    if not builder:
        return {"ok": False, "error": "Session not found"}
    return {"ok": True, "events": builder.to_events_list(), "summary": builder.summary()}


@app.get("/engine/v2/events/log")
def events_log(
    event_type: str = Query(""),
    session_id: str = Query(""),
    limit: int = Query(50),
    user_id: str = Query("")
):
    """查询事件日志"""
    etype = EventType(event_type) if event_type else None
    results = event_log.query(event_type=etype, session_id=session_id, limit=limit)
    return {"ok": True, "events": [e.to_dict() for e in results], "count": len(results)}


# ==================== 启动时恢复Cron + 修复Stuck代理 ====================
@app.on_event("startup")
async def startup():
    # 恢复全局 cron (无user_id)
    jobs = cron_store.get()
    for name, job in jobs.items():
        if job.get("enabled"):
            _cron_start(name, "", get_ns)
            print(f"[引擎] Cron 已恢复(全局): {name}")
    # 恢复各用户的 cron
    for f in ENGINE_DIR.glob("user_*_cron.json"):
        try:
            uid = f.stem.split("_", 1)[1].rsplit("_", 1)[0]
            user_jobs = json.loads(f.read_text(encoding="utf8"))
            for name, job in user_jobs.items():
                if job.get("enabled"):
                    _cron_start(name, uid, get_ns)
                    print(f"[引擎] Cron 已恢复(用户{uid}): {name}")
        except Exception:
            pass

    # ★ 修复引擎重启后遗留的 "running" 状态子代理
    from pathlib import Path as _Path
    for f in ENGINE_DIR.glob("*_agents.json"):
        try:
            data = json.loads(f.read_text(encoding="utf8"))
            changed = False
            for name, agent in data.items():
                if agent.get("status") == "running":
                    agent["status"] = "failed"
                    agent["error"] = "引擎重启,正在运行的子代理已终止"
                    changed = True
                    print(f"[引擎] 修复stuck代理: {f.stem}/{name} (running→failed)")
            if changed:
                f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf8")
        except Exception:
            pass

    # ★ 启动定期清理任务(每5分钟检查stuck代理)
    def _periodic_cleanup():
        while True:
            time.sleep(300)  # 5分钟
            try:
                now = time.time()
                for f in ENGINE_DIR.glob("*_agents.json"):
                    try:
                        data = json.loads(f.read_text(encoding="utf8"))
                        changed = False
                        for name, agent in list(data.items()):
                            started = agent.get("_started_at", 0)
                            status = agent.get("status", "")
                            # running超30分钟 → failed
                            if status == "running" and started and (now - started) > 1800:
                                agent["status"] = "failed"
                                agent["error"] = "子代理执行超时(超过30分钟)"
                                changed = True
                                print(f"[引擎] 超时清理: {f.stem}/{name}")
                            # completed/failed超24小时 → 删除
                            if status in ("completed", "failed"):
                                created_str = agent.get("created", "")
                                if not created_str:
                                    continue
                                try:
                                    created = datetime.fromisoformat(created_str).timestamp()
                                    if (now - created) > 86400:  # 24小时
                                        if "result" in agent and len(agent.get("result", "")) > 10000:
                                            # 结果很大的,只保留摘要
                                            agent["result"] = agent["result"][:500] + f"\n\n[自动截断: 原结果共{len(agent['result'])}字符]"
                                            changed = True
                                        else:
                                            del data[name]
                                            changed = True
                                            print(f"[引擎] 自动删除过期代理: {f.stem}/{name}")
                                except Exception:
                                    pass
                        if changed:
                            f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf8")
                    except Exception:
                        pass
            except Exception:
                pass

    t = threading.Thread(target=_periodic_cleanup, name="periodic_cleanup", daemon=True)
    t.start()
    print("[引擎] 定期清理线程已启动(每5分钟)")

# ==================== 前端心跳注入 ====================
_heartbeat_html = """
<script>
// OneAPIChat Engine 心跳
(function(){
    var ENGINE_URL = window.location.origin + '/oneapichat/';
    var HEARTBEAT_INTERVAL = 15000; // 15秒
    var CUSTOM_PROMPT = '';
    var token = (typeof localStorage !== 'undefined') ? localStorage.getItem('authToken') : '';

    setInterval(function(){
        var token = (typeof localStorage !== 'undefined') ? localStorage.getItem('authToken') : '';
        var authSuffix = token ? '&auth_token=' + encodeURIComponent(token) : '';
        fetch(ENGINE_URL + 'engine_api.php?action=heartbeat' + authSuffix)
            .then(function(r){ return r.json(); })
            .then(function(d){
                if(d.pending && d.pending.length > 0){
                    for(var i=0; i<d.pending.length; i++){
                        var msg = d.pending[i].msg || d.pending[i];
                        // 插入为system消息
                        if(window.chatHistory && window.currentChatId){
                            window.chatHistory[window.currentChatId].push({
                                role: 'system',
                                content: '【引擎通知】' + msg
                            });
                        }
                    }
                }
            })
            .catch(function(){});
    }, HEARTBEAT_INTERVAL);
})();
</script>
"""

# ==================== 启动 ====================
# ==================== 流式聊天后端 (SSE) ====================
import threading
import queue

def _stream_openai_to_sse(request_data: dict, chat_id: str, msg_id: str, user_id: str):
    """在后台线程中将 OpenAI 流式响应转为 SSE，实时保存进度到 SQLite"""
    from openai import OpenAI
    store = get_chat_store(user_id)
    store.init_progress(msg_id, chat_id, request_data.get('model', ''))
    full_text = ''
    reasoning_text = ''
    tool_calls = []
    usage = None
    error = ''
    seq = 0

    def sse_event(data_str: str, event_type: str = 'chunk'):
        return f"event: {event_type}\ndata: {data_str}\n\n"

    try:
        # ★ 代理配置: 请求级优先（公网域名→内网IP映射）
        _httpc = None
        _rp = request_data.get('proxy_url', '')
        if request_data.get('proxy_enabled') and _rp:
            # ★ 公网地址映射为内网（与 proxy.php 逻辑一致）
            if 'proxy.naujtrats.xyz:8888' in _rp:
                _rp = 'http://192.168.195.213:10808'
            elif 'proxy.naujtrats.xyz:8889' in _rp:
                _rp = 'http://192.168.195.22:10808'
            import httpx; _httpc = httpx.Client(proxy=_rp)
        elif _PROXY_URL:
            import httpx; _httpc = httpx.Client(proxy=_PROXY_URL)
        client = OpenAI(api_key=request_data.get('api_key', ''),
                        base_url=request_data.get('base_url', '').strip().rstrip('/') or None,
                        http_client=_httpc)
        model = request_data.get('model', 'deepseek-chat')
        messages = request_data.get('messages', [])
        # ★ 去重 tool_call_id: MiniMax/DeepSeek 拒绝同一请求中重复的 tool_call id
        seen_tc_ids_s2 = set()
        for m in messages:
            if isinstance(m, dict) and m.get('role') == 'assistant' and 'tool_calls' in m:
                unique_calls = []
                for tc in m['tool_calls']:
                    tc_id = tc.get('id', '') if isinstance(tc, dict) else ''
                    if tc_id and tc_id not in seen_tc_ids_s2:
                        seen_tc_ids_s2.add(tc_id)
                        unique_calls.append(tc)
                if unique_calls:
                    m['tool_calls'] = unique_calls
                else:
                    del m['tool_calls']
        _dup_tool_msgs_s2 = 0
        _seen_tool_ids_s2 = set()
        for m in messages:
            if isinstance(m, dict) and m.get('role') == 'tool' and m.get('tool_call_id'):
                _tid = m['tool_call_id']
                if _tid in _seen_tool_ids_s2:
                    m['_remove'] = True
                    _dup_tool_msgs_s2 += 1
                else:
                    _seen_tool_ids_s2.add(_tid)
        if _dup_tool_msgs_s2 > 0:
            messages[:] = [m for m in messages if not m.get('_remove')]
        # ★ 清理空 tool_calls:[] 数组 — DeepSeek API 拒绝 empty array
        for m in messages:
            if isinstance(m, dict) and m.get('role') == 'assistant' and 'tool_calls' in m:
                if not m['tool_calls'] or len(m['tool_calls']) == 0:
                    del m['tool_calls']
        tools = request_data.get('tools', None)
        stream_params = {'model': model, 'messages': messages, 'stream': True}
        if tools:
            stream_params['tools'] = tools
        if request_data.get('reasoning'):
            stream_params['reasoning'] = request_data.get('reasoning')
        # 发送初始事件
        yield sse_event(json.dumps({'type': 'start', 'msg_id': msg_id}))

        stream = client.chat.completions.create(**stream_params)
        # ★ MiniMax/DeepSeek 内联思考标签提取状态机（含跨chunk边界保护）
        _think_buf_s2 = ''
        _in_think_s2 = False
        _chunk_carry_s2 = ''
        _TAG_MAX2 = 10
        _TAGS2 = ('(think)', '(endthink)', '<think>', '</think>')
        for chunk in stream:
            delta = chunk.choices[0].delta
            seq += 1

            content_delta = delta.content or ''
            if content_delta:
                # ★ 拼接上一chunk尾部缓冲以检测跨边界标签
                _c2 = _chunk_carry_s2 + content_delta
                _chunk_carry_s2 = ''
                _display_c = ''
                _pos = 0
                while _pos < len(_c2):
                    if _in_think_s2:
                        _end_idx = _c2.find('(endthink)', _pos)
                        if _end_idx != -1:
                            _think_buf_s2 += _c2[_pos:_end_idx]
                            reasoning_text += _think_buf_s2
                            store.write_chunk(msg_id, 'reasoning', _think_buf_s2)
                            yield sse_event(json.dumps({'type': 'reasoning', 'delta': _think_buf_s2, 'seq': seq}))
                            _think_buf_s2 = ''
                            _in_think_s2 = False
                            _pos = _end_idx + 10
                        else:
                            _think_buf_s2 += _c2[_pos:]
                            reasoning_text += _c2[_pos:]
                            store.write_chunk(msg_id, 'reasoning', _c2[_pos:])
                            yield sse_event(json.dumps({'type': 'reasoning', 'delta': _c2[_pos:], 'seq': seq}))
                            _pos = len(_c2)
                    else:
                        _start_idx = _c2.find('(think)', _pos)
                        if _start_idx != -1:
                            _display_c += _c2[_pos:_start_idx]
                            _pos = _start_idx + 7
                            _in_think_s2 = True
                        else:
                            _display_c += _c2[_pos:]
                            _pos = len(_c2)
                # ★ 跨chunk边界保护: 尾部可能是不完整标签前缀
                if _display_c and not _in_think_s2:
                    _tail_start2 = max(0, len(_display_c) - _TAG_MAX2)
                    for _ti2 in range(_tail_start2, len(_display_c)):
                        _tail2 = _display_c[_ti2:]
                        if any(tag.startswith(_tail2) for tag in _TAGS2):
                            _chunk_carry_s2 = _tail2
                            _display_c = _display_c[:_ti2]
                            break
                if _display_c:
                    full_text += _display_c
                    store.write_chunk(msg_id, 'content', _display_c)
                    yield sse_event(json.dumps({'type': 'content', 'delta': _display_c, 'seq': seq}))

            # 思考增量（reasoning_content 字段 — DeepSeek 等）
            reasoning_delta = delta.reasoning_content or ''
            if reasoning_delta:
                reasoning_text += reasoning_delta
                store.write_chunk(msg_id, 'reasoning', reasoning_delta)
                yield sse_event(json.dumps({'type': 'reasoning', 'delta': reasoning_delta, 'seq': seq}))

            # Tool calls
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    tc_dict = {'id': tc.id, 'type': tc.type,
                                'function': {'name': tc.function.name,
                                             'arguments': tc.function.arguments or ''}}
                    tool_calls.append(tc_dict)
                    yield sse_event(json.dumps({'type': 'tool_call', 'delta': tc_dict, 'seq': seq}))

            # Usage
            if chunk.usage:
                try:
                    usage = chunk.usage.model_dump()
                except Exception:
                    try:
                        usage = json.loads(chunk.usage.model_dump_json())
                    except Exception:
                        usage = dict(chunk.usage)

        # 流结束 — 刷新跨chunk缓冲 + 安全网清理内联标签
        if _chunk_carry_s2:
            full_text += _chunk_carry_s2
        if _in_think_s2 and _think_buf_s2:
            reasoning_text += _think_buf_s2
        import re as _re_tmp2
        _inlines2 = _re_tmp2.findall(r'\(think\)([\s\S]*?)\(endthink\)', full_text)
        if _inlines2:
            reasoning_text += ''.join(_inlines2)
            full_text = _re_tmp2.sub(r'', full_text)
        _open_m2 = _re_tmp2.search(r'\(think\)([\s\S]*?)$', full_text)
        if _open_m2 and len(_open_m2.group(1)) < 3000:
            reasoning_text += _open_m2.group(1)
            full_text = _re_tmp2.sub(r'', full_text)
        store.finish_stream(msg_id, full_text.strip(), reasoning_text.strip(), tool_calls, usage)
        yield sse_event(json.dumps({'type': 'done', 'full_text': full_text.strip(), 'reasoning_text': reasoning_text.strip(),
                                     'tool_calls': tool_calls, 'usage': usage}))

    except Exception as e:
        error = str(e)
        print(f"[stream] error: {error}")
        store.finish_stream(msg_id, full_text, reasoning_text, tool_calls, usage, error)
        yield sse_event(json.dumps({'type': 'error', 'error': error}))

def _run_stream(request_data: dict, chat_id: str, msg_id: str, user_id: str, result_queue):
    """后台线程运行器,逐块转发SSE事件,不缓存"""
    try:
        for chunk in _stream_openai_to_sse(request_data, chat_id, msg_id, user_id):
            result_queue.put(('chunk', chunk))
        result_queue.put(('done', None))
    except Exception as e:
        result_queue.put(('error', str(e)))

@app.post("/engine/chat/stream")
async def chat_stream(request: Request, user_id: str = Query("")):
    """
    后端流式聊天端点:
    - 接收消息，转发给 OpenAI，流式返回 SSE
    - 实时将进度保存到 SQLite（刷新恢复）
    """
    try:
        body = await request.json()
    except Exception:
        return {"error": "invalid JSON body"}

    chat_id = body.get('chat_id') or ''
    msg_id = body.get('msg_id') or f"msg_{int(time.time()*1000)}"
    request_data = body.get('request', {})

    if not request_data.get('api_key'):
        return {"error": "api_key required"}

    # 启动后台线程执行流式请求（避免 FastAPI 线程阻塞）
    result_queue = queue.Queue()
    t = threading.Thread(target=_run_stream, args=(request_data, chat_id, msg_id, user_id, result_queue), daemon=True)
    t.start()

    async def event_generator():
        # 前端通过 EventSource 接收 SSE
        while True:
            try:
                status, data = result_queue.get(timeout=60)
                if status == 'error':
                    yield f"event: error\ndata: {json.dumps({'error': data})}\n\n"
                    break
                elif status == 'done':
                    break
                elif status == 'chunk':
                    yield data
                    await asyncio.sleep(0.001)
            except queue.Empty:
                yield f"event: timeout\ndata: {json.dumps({'error': 'stream timeout'})}\n\n"
                break

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/engine/chat/progress/{msg_id}")
async def chat_progress(msg_id: str, user_id: str = Query("")):
    """查询流式进度（用于刷新恢复）"""
    store = get_chat_store(user_id)
    return store.get_progress(msg_id)


# ═══════════════════════════════════════════════════════════════
# 可恢复流式系统 — 流在后端线程独立运行，前端断线重连无感续接
# ═══════════════════════════════════════════════════════════════

_resumable = {}           # {stream_id: {queue, chunks, finished, created}}
_resumable_lock = threading.Lock()
_RESUMABLE_TTL = 1800      # 30 分钟超时


# ═══════════════════════════════════════════════════════════════
# StreamBuffer — 磁盘持久化流缓冲（引擎重启不丢 chunks）
# ═══════════════════════════════════════════════════════════════

class StreamBuffer:
    """msg_id 粒度的流缓冲，chunks 持久化到 JSON 文件"""
    __slots__ = ('msg_id', 'path', 'chunks', 'content', '_last_save')

    def __init__(self, msg_id: str):
        self.msg_id = msg_id
        self.path = STREAM_DIR / f"{msg_id}.json"
        self.chunks: list = []
        self.content: str = ''
        self._load()

    def _load(self):
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text())
                self.chunks = data.get("chunks", [])
                self.content = data.get("content", "")
            except Exception:
                pass

    def _save(self):
        try:
            self.path.write_text(json.dumps({
                "chunks": self.chunks, "content": self.content,
                "ts": time.time()
            }, ensure_ascii=False))
        except Exception as e:
            print(f"[StreamBuffer] save error: {e}")

    def append(self, sse_payload: str):
        self.chunks.append(sse_payload)
        if len(self.chunks) % 5 == 0:
            self._save()

    def since(self, offset: int):
        if offset >= len(self.chunks):
            return []
        return self.chunks[offset:]

    def done(self):
        self._save()


_stream_buffers: dict = {}  # {msg_id: StreamBuffer}
_stream_buffers_lock = threading.Lock()


def _get_stream_buffer(msg_id: str) -> StreamBuffer:
    with _stream_buffers_lock:
        if msg_id not in _stream_buffers:
            _stream_buffers[msg_id] = StreamBuffer(msg_id)
        return _stream_buffers[msg_id]


def _generate_resumable(request: dict, stream_id: str):
    """后台线程: 调用 OpenAI 流式 API，逐 chunk 写入缓存和队列"""
    from openai import OpenAI
    q = _resumable[stream_id]['queue']
    full = ''
    reasoning = ''
    tool_calls = []
    usage = None

    # 关联磁盘缓冲（从 stream_id 提取 msg_id，或使用 stream_id 本身）
    msg_id = _resumable[stream_id].get('msg_id', stream_id)
    buf = _get_stream_buffer(msg_id)

    def _emit(ev_type, data):
        sse = f"event: {ev_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        _resumable[stream_id]['chunks'].append(sse)
        buf.append(sse)
        q.put(sse)  # queue.Queue is thread-safe

    try:
        print(f"[_generate_resumable] Starting stream {stream_id} with model={request.get('model','?')} base_url={request.get('base_url','?')[:50]}", flush=True)
        # ★ 代理配置: 请求级优先 → 全局 env 回退（公网域名→内网IP映射）
        _http_client = None
        _req_proxy = request.get('proxy_url', '')
        if request.get('proxy_enabled') and _req_proxy:
            # ★ 公网地址映射为内网（与 proxy.php 逻辑一致）
            if 'proxy.naujtrats.xyz:8888' in _req_proxy:
                _req_proxy = 'http://192.168.195.213:10808'
            elif 'proxy.naujtrats.xyz:8889' in _req_proxy:
                _req_proxy = 'http://192.168.195.22:10808'
            import httpx
            _http_client = httpx.Client(proxy=_req_proxy)
        elif _PROXY_URL:
            import httpx
            _http_client = httpx.Client(proxy=_PROXY_URL)
        client = OpenAI(
            api_key=request.get('api_key', ''),
            base_url=request.get('base_url', '').strip().rstrip('/') or None,
            http_client=_http_client
        )
        messages = request.get('messages', [])
        # ★ 去重 tool_call_id: MiniMax/DeepSeek 拒绝同一请求中重复的 tool_call id
        #  检查范围: 1) assistant 消息的 tool_calls[].id  2) tool 消息的 tool_call_id
        seen_tc_ids = set()
        for m in messages:
            if isinstance(m, dict) and m.get('role') == 'assistant' and 'tool_calls' in m:
                unique_calls = []
                for tc in m['tool_calls']:
                    tc_id = tc.get('id', '') if isinstance(tc, dict) else ''
                    if tc_id and tc_id not in seen_tc_ids:
                        seen_tc_ids.add(tc_id)
                        unique_calls.append(tc)
                    elif tc_id:
                        print(f"[_generate_resumable] 去重 assistant tool_call id: {tc_id}", flush=True)
                if unique_calls:
                    m['tool_calls'] = unique_calls
                else:
                    del m['tool_calls']
        # ★ 去重 tool 消息的 tool_call_id（MiniMax 也检查 tool 消息中的重复）
        _dup_tool_msgs = 0
        _seen_tool_ids = set()
        for m in messages:
            if isinstance(m, dict) and m.get('role') == 'tool' and m.get('tool_call_id'):
                _tid = m['tool_call_id']
                if _tid in _seen_tool_ids:
                    m['_remove'] = True
                    _dup_tool_msgs += 1
                    print(f"[_generate_resumable] 去重 tool 消息 tool_call_id: {_tid}", flush=True)
                else:
                    _seen_tool_ids.add(_tid)
        if _dup_tool_msgs > 0:
            messages[:] = [m for m in messages if not m.get('_remove')]
            print(f"[_generate_resumable] 移除 {_dup_tool_msgs} 条重复 tool 消息", flush=True)
        # ★ 清理空 tool_calls:[] 数组 — DeepSeek API 拒绝 empty array
        # ★ 确保 reasoning_content 传递给后续请求(DeepSeek thinking模式要求)
        _has_any_reasoning = any(
            isinstance(m, dict) and m.get('role') == 'assistant' and (m.get('reasoning_content') or m.get('reasoning'))
            for m in messages
        )
        for m in messages:
            if isinstance(m, dict) and m.get('role') == 'assistant' and 'tool_calls' in m:
                if not m['tool_calls'] or len(m['tool_calls']) == 0:
                    del m['tool_calls']
            # DeepSeek: 若对话中有过reasoning, 所有assistant消息都需带reasoning_content
            if _has_any_reasoning and isinstance(m, dict) and m.get('role') == 'assistant':
                if 'reasoning_content' not in m:
                    m['reasoning_content'] = m.get('reasoning', '')
        params = {
            'model': request.get('model', 'deepseek-chat'),
            'messages': messages,
            'stream': True,
            'temperature': request.get('temperature', 0.7),
            'max_tokens': request.get('max_tokens', 4096),
        }
        if request.get('tools'):
            params['tools'] = request['tools']

        print(f"[_generate_resumable] Calling API...", flush=True)
        # ★ 诊断: 打印消息摘要检测重复 tool_call_id
        _tc_diag = {}
        for _mi, _mm in enumerate(messages):
            _tc_ids = []
            if isinstance(_mm, dict) and _mm.get('role') == 'assistant' and 'tool_calls' in _mm:
                _tc_ids = [tc.get('id','?') for tc in _mm['tool_calls'] if isinstance(tc, dict)]
            elif isinstance(_mm, dict) and _mm.get('role') == 'tool' and _mm.get('tool_call_id'):
                _tc_ids = [_mm['tool_call_id']]
            if _tc_ids:
                for _tid in _tc_ids:
                    if _tid in _tc_diag:
                        print(f"[_generate_resumable] ⚠️ DUPLICATE tool_call_id '{_tid}' at msg[{_mi}] (first at msg[{_tc_diag[_tid]}])", flush=True)
                    else:
                        _tc_diag[_tid] = _mi
            _role = _mm.get('role','?') if isinstance(_mm, dict) else '?'
            _content_preview = ''
            if isinstance(_mm, dict) and _mm.get('content'):
                _c = _mm['content']
                _content_preview = (str(_c)[:60] + '...') if len(str(_c)) > 60 else str(_c)[:60]
            print(f"[_generate_resumable] msg[{_mi}] role={_role} tc_ids={_tc_ids} content={_content_preview}", flush=True)
        _tc_by_index = {}  # ★ 按index合并增量tool_call delta
        _tc_order = []     # 保持顺序
        # ★ MiniMax/DeepSeek 内联思考标签提取状态机（流式分块处理，含跨chunk边界保护）
        _think_buf = ''      # 暂存 (think)...(endthink) 跨chunk不完整块
        _in_think = False    # 是否在 (think) 块内
        _chunk_carry = ''    # ★ 跨chunk边界保护: 上一chunk尾部可能是不完整标签前缀
        _TAG_MAX = 10        # max(len('(endthink)'), len('</think>'), len('(think)'), len('<think>'))
        _TAGS = ('(think)', '(endthink)', '<think>', '</think>')
        for chunk in client.chat.completions.create(**params):
            delta = chunk.choices[0].delta
            c = (delta.content or '')
            r = getattr(delta, 'reasoning_content', '') or ''
            if c:
                # ★ 拼接上一chunk的尾部缓冲以检测跨边界标签
                c = _chunk_carry + c
                _chunk_carry = ''
                _display_c = ''
                _pos = 0
                while _pos < len(c):
                    if _in_think:
                        _end_idx = c.find('(endthink)', _pos)
                        if _end_idx != -1:
                            _think_buf += c[_pos:_end_idx]
                            reasoning += _think_buf
                            _emit('reasoning', {'delta': _think_buf})
                            _think_buf = ''
                            _in_think = False
                            _pos = _end_idx + 10  # len('(endthink)') = 10
                        else:
                            _think_buf += c[_pos:]
                            reasoning += c[_pos:]
                            _emit('reasoning', {'delta': c[_pos:]})
                            _pos = len(c)
                    else:
                        _start_idx = c.find('(think)', _pos)
                        if _start_idx != -1:
                            _display_c += c[_pos:_start_idx]  # 标签前的内容作为正文
                            _pos = _start_idx + 7  # len('(think)') = 7
                            _in_think = True
                        else:
                            _display_c += c[_pos:]
                            _pos = len(c)
                # ★ 跨chunk边界保护: 尾部可能是不完整标签前缀，截留到下一chunk
                if _display_c and not _in_think:
                    _tail_start = max(0, len(_display_c) - _TAG_MAX)
                    for _ti in range(_tail_start, len(_display_c)):
                        _tail = _display_c[_ti:]
                        if any(tag.startswith(_tail) for tag in _TAGS):
                            _chunk_carry = _tail
                            _display_c = _display_c[:_ti]
                            break
                if _display_c:
                    full += _display_c
                    _emit('content', {'delta': _display_c})
            if r:
                reasoning += r
                _emit('reasoning', {'delta': r})
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = getattr(tc, 'index', 0)
                    if idx not in _tc_by_index:
                        _tc = {
                            'id': tc.id or '',
                            'type': 'function',
                            'function': {'name': '', 'arguments': ''}
                        }
                        _tc_by_index[idx] = _tc
                        _tc_order.append(idx)
                    else:
                        _tc = _tc_by_index[idx]
                    # 合并: id取第一次的
                    if tc.id and not _tc['id']:
                        _tc['id'] = tc.id
                    # 合并: name取非空的
                    if tc.function and tc.function.name:
                        _tc['function']['name'] = tc.function.name
                    # 合并: arguments增量拼接
                    if tc.function and tc.function.arguments:
                        arg = tc.function.arguments
                        cur = _tc['function']['arguments']
                        if not cur:
                            _tc['function']['arguments'] = arg
                        elif arg != cur and not cur.endswith(arg):
                            # ★ 去重: 避免重复拼接相同片段
                            _tc['function']['arguments'] = cur + arg
                # ★ 发出合并后的快照(前端实时展示)
                _merged = [_tc_by_index[i] for i in _tc_order]
                _emit('tool_call', {'partial': True, 'tools': _merged})
            if hasattr(chunk, 'usage') and chunk.usage:
                try: usage = chunk.usage.model_dump()
                except Exception: pass

        # ★ 最终合并的tool_calls（去重: 按id去重，保留首次出现）
        _seen_tc_order_ids = set()
        _unique_tool_calls = []
        _tc_dup_count = 0
        for i in _tc_order:
            tc = _tc_by_index.get(i)
            if not tc: continue
            tc_id = tc.get('id', '')
            if tc_id and tc_id not in _seen_tc_order_ids:
                _seen_tc_order_ids.add(tc_id)
                _unique_tool_calls.append(tc)
            elif tc_id:
                _tc_dup_count += 1
                print(f"[_generate_resumable] 去重 done tool_call id: {tc_id} (index={i})", flush=True)
        tool_calls = _unique_tool_calls
        if _tc_dup_count > 0:
            print(f"[_generate_resumable] 移除 {_tc_dup_count} 个重复 tool_call", flush=True)
        # 确保每个有id
        for i, tc in enumerate(tool_calls):
            if not tc['id']:
                tc['id'] = f'call_{i}_{int(time.time()*1000)}'
        # ★ 刷新流式状态机缓冲（跨chunk尾部残留 + 未闭合think块）
        if _chunk_carry:
            full += _chunk_carry
        if _in_think and _think_buf:
            reasoning += _think_buf
        # ★ 安全网: 清理 full 中残留的 (think)...(endthink) 标签（流式状态机未覆盖的边界情况）
        import re as _re_tmp
        _inlines = _re_tmp.findall(r'\(think\)([\s\S]*?)\(endthink\)', full)
        if _inlines:
            reasoning += ''.join(_inlines)
            full = _re_tmp.sub(r'', full)
        # 未闭合 (think) 兜底
        _open_m = _re_tmp.search(r'\(think\)([\s\S]*?)$', full)
        if _open_m and len(_open_m.group(1)) < 3000:
            reasoning += _open_m.group(1)
            full = _re_tmp.sub(r'', full)
        done_data = {'full_text': full.strip(), 'reasoning_text': reasoning.strip(),
                     'tool_calls': tool_calls, 'usage': usage}
        _emit('done', done_data)
        _resumable[stream_id]['finished'] = True
        buf.done()
        _complete_task_from_stream(stream_id, 'completed')
        try: q.put(None)
        except Exception: pass

    except Exception as e:
        _emit('error', {'error': str(e)})
        _resumable[stream_id]['finished'] = True
        buf.done()
        _complete_task_from_stream(stream_id, 'failed')
        try: q.put(None)
        except Exception: pass


@app.post("/engine/chat/create")
async def chat_create(request: Request, user_id: str = Query("")):
    """创建可恢复流 — 接收消息，返回 stream_id，后台线程调 OpenAI"""
    try: body = await request.json()
    except Exception: return JSONResponse({"error": "invalid JSON"}, status_code=400)
    if not body.get('api_key'):
        return JSONResponse({"error": "api_key required"}, status_code=400)

    sid = f"stream_{uuid.uuid4().hex[:12]}"
    q = queue.Queue()

    with _resumable_lock:
        _resumable[sid] = {'queue': q, 'chunks': [], 'finished': False, 'created': time.time()}
        # 清理过期
        now = time.time()
        for k in list(_resumable.keys()):
            v = _resumable[k]
            if not v.get('finished') and now - v.get('created', 0) > _RESUMABLE_TTL:
                try: v['queue'].put_nowait(None)
                except Exception: pass
                del _resumable[k]

    threading.Thread(target=_generate_resumable, args=(body, sid), daemon=True).start()

    # Register task for cross-browser recovery
    task_id = f"task_{uuid.uuid4().hex[:12]}"
    chat_id = body.get("chat_id", "")
    msg_id = body.get("msg_id", f"msg_{int(time.time()*1000)}")
    model = body.get("model", "")
    if user_id and chat_id:
        try:
            store = get_chat_store(user_id)
            store.register_task(task_id, sid, chat_id, msg_id, user_id, model, body)
            # Store task_id in the resumable entry for completion tracking
            with _resumable_lock:
                if sid in _resumable:
                    _resumable[sid]['task_id'] = task_id
                    _resumable[sid]['user_id'] = user_id
                    _resumable[sid]['msg_id'] = msg_id
                    _resumable[sid]['chat_id'] = chat_id
                    _resumable[sid]['chat_id'] = chat_id
        except Exception as e:
            print(f"[chat_create] task register error: {e}")

    # ★ 多端同步: 广播流开始事件到其他浏览器/设备
    if user_id and chat_id:
        _broadcast_to_user(user_id, 'chat:stream_started', {
            'chat_id': chat_id, 'stream_id': sid,
            'model': model, 'ts': time.time()
        })

    return {"stream_id": sid, "task_id": task_id, "msg_id": msg_id}


@app.get("/engine/chat/stream")
async def chat_stream_offset(
    msg_id: str = Query(""),
    since: int = Query(0),
    stream_id: str = Query(""),
    user_id: str = Query(""),
):
    """
    统一 SSE 流端点（支持 offset 断点续传）：
    - msg_id + since: 从磁盘补发 since 之后的 chunks，再连接实时流
    - stream_id: 兼容旧 ResumeStream（直接消费 live stream）
    """
    # 兼容旧路径
    if stream_id and not msg_id:
        s = _resumable.get(stream_id)
        if not s:
            return JSONResponse({"error": "stream not found", "finished": True}, status_code=404)
        buf = _get_stream_buffer(s.get('msg_id', stream_id))
    elif msg_id:
        buf = _get_stream_buffer(msg_id)
    else:
        return JSONResponse({"error": "msg_id or stream_id required"}, status_code=400)

    async def gen():
        # 阶段1: 补发 since 之后的缓存 chunks
        if since > 0:
            missed = buf.since(since)
            for i, c in enumerate(missed):
                yield c
                await asyncio.sleep(0.001)
        elif since == 0 and buf.chunks:
            for c in buf.chunks:
                yield c
                await asyncio.sleep(0.001)

        # 阶段2: 连接实时流（如果还在生成中）
        if stream_id:
            s = _resumable.get(stream_id)
        else:
            s = None
            with _resumable_lock:
                for _sid, _v in _resumable.items():
                    if _v.get('msg_id') == msg_id and not _v.get('finished'):
                        s = _v
                        break
        if s and not s.get('finished'):
            # ★ 多消费者广播：用索引轮询 s['chunks']（避免 q.get() 瓜分 chunk）
            _live_idx = len(s['chunks'])  # 从缓存之后开始
            while not s.get('finished'):
                _cur_len = len(s['chunks'])
                while _live_idx < _cur_len:
                    yield s['chunks'][_live_idx]
                    _live_idx += 1
                    await asyncio.sleep(0.001)
                if s.get('finished'):
                    break
                await asyncio.sleep(0.05)
            # ★ 发送finished=true后可能残留的chunks(含done事件)
            _cur_len = len(s['chunks'])
            while _live_idx < _cur_len:
                yield s['chunks'][_live_idx]
                _live_idx += 1
                await asyncio.sleep(0.001)

    return StreamingResponse(gen(), media_type="text/event-stream",
                            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})


@app.get("/engine/chat/stream/{stream_id}")
async def chat_stream_get(stream_id: str):
    """消费 SSE 流 — 已完成流返回JSON，活跃流回放chunks+实时推送"""
    s = _resumable.get(stream_id)
    if not s:
        return JSONResponse({"error": "stream not found", "finished": True}, status_code=404)

    # ★ 流已完成:直接返回JSON(避免SSE的TCP分片导致done事件丢失)
    if s.get('finished'):
        cached = list(s['chunks'])
        for c in reversed(cached):
            if 'event: done' in c or '"full_text"' in c:
                try:
                    _parts = c.split('\ndata: ', 1)
                    if len(_parts) > 1:
                        _data = json.loads(_parts[1].strip())
                        return JSONResponse(_data)
                except Exception:
                    pass
                break
        return JSONResponse({"full_text": "", "tool_calls": [], "finished": True})

    async def gen():
        yield f"event: start\ndata: {json.dumps({'stream_id': stream_id})}\n\n"
        idx = 0
        cached = list(s['chunks'])
        for c in cached:
            yield c
            idx += 1
            await asyncio.sleep(0.001)
        if not s.get('finished'):
            # ★ 多消费者广播：用索引轮询 s['chunks'] 而非 q.get()
            while not s.get('finished'):
                current_len = len(s['chunks'])
                while idx < current_len:
                    yield s['chunks'][idx]
                    idx += 1
                    await asyncio.sleep(0.001)
                if s.get('finished'):
                    break
                await asyncio.sleep(0.05)
        # ★ 发送finished=true后可能残留的chunks(done事件可能在最后一次poll和finished之间写入)
        current_len = len(s['chunks'])
        while idx < current_len:
            yield s['chunks'][idx]
            idx += 1
            await asyncio.sleep(0.001)

    return StreamingResponse(gen(), media_type="text/event-stream",
                            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})


@app.delete("/engine/chat/stream/{stream_id}")
async def chat_stream_delete(stream_id: str):
    """清理指定流"""
    _resumable.pop(stream_id, None)
    return {"cleaned": True}


def _complete_task_from_stream(stream_id: str, status: str):
    """流结束时标记任务状态并广播"""
    try:
        with _resumable_lock:
            entry = _resumable.get(stream_id, {})
        task_id = entry.get('task_id', '')
        uid = entry.get('user_id', '')
        chat_id = entry.get('chat_id', '')
        if task_id and uid:
            store = get_chat_store(uid)
            store.complete_task(task_id, status)
            # Broadcast to all user's browsers
            _broadcast_to_user(uid, 'chat:stream_done', {
                'task_id': task_id, 'chat_id': chat_id,
                'status': status, 'ts': time.time()
            })
    except Exception as e:
        print(f"[_complete_task] error: {e}")


@app.get("/engine/tasks/active")
async def active_tasks(user_id: str = Query("")):
    """获取用户活跃任务（用于跨浏览器刷新恢复）"""
    if not user_id:
        return JSONResponse({"ok": True, "tasks": []})
    store = get_chat_store(user_id)
    tasks = store.get_active_tasks(user_id)
    return {"ok": True, "tasks": tasks}


# ═══════════════════════════════════════════════════════════════
# SSE 事件总线 — 用户级实时推送通道（跨浏览器同步）
# ═══════════════════════════════════════════════════════════════

_user_event_queues: dict = {}  # {user_id: [asyncio.Queue, ...]}
_user_event_queues_lock = threading.Lock()
_user_agent_modes: dict = {}  # ★ 多端同步: 存储每个用户的 agent 模式状态


def _broadcast_to_user(user_id: str, event_type: str, data: dict):
    """向指定用户的所有活跃 SSE 连接推送事件"""
    if not user_id:
        return
    sse_payload = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
    with _user_event_queues_lock:
        queues = list(_user_event_queues.get(user_id, []))
    for q in queues:
        try:
            asyncio.run_coroutine_threadsafe(q.put(sse_payload), asyncio.get_event_loop())
        except Exception:
            pass


@app.get("/engine/events")
async def user_events_stream(user_id: str = Query(""), agent_mode: str = Query("")):
    """用户级持久 SSE 通道。浏览器连接后接收实时事件推送"""
    if not user_id:
        return JSONResponse({"error": "user_id required"}, status_code=400)

    # ★ 多端同步: 存储客户端上报的 agent 模式
    # ★ 关键: 'off' 不能覆盖另一个设备上报的活跃模式(agent/plan/yolo)
    if agent_mode:
        _existing = _user_agent_modes.get(user_id, {})
        _existing_mode = _existing.get('mode', '')
        _existing_ts = _existing.get('ts', 0)
        # 允许更新条件: 1) 新模式非off 2) 无现有模式 3) 现有模式已过期(>30s无心跳视为过期)
        if agent_mode != 'off' or not _existing_mode or _existing_mode == 'off' or (time.time() - _existing_ts > 30):
            _user_agent_modes[user_id] = {'mode': agent_mode, 'ts': time.time()}
    current_mode = _user_agent_modes.get(user_id, {}).get('mode', '')

    q = asyncio.Queue()
    with _user_event_queues_lock:
        _user_event_queues.setdefault(user_id, []).append(q)

    async def event_gen():
        try:
            yield f"event: connected\ndata: {json.dumps({'user_id': user_id, 'ts': time.time(), 'agent_mode': current_mode})}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=30)
                    yield payload
                except asyncio.TimeoutError:
                    yield f"event: heartbeat\ndata: {json.dumps({'hb': True})}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            with _user_event_queues_lock:
                queues = _user_event_queues.get(user_id, [])
                if q in queues:
                    queues.remove(q)

    return StreamingResponse(event_gen(), media_type="text/event-stream",
                            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})


@app.post("/engine/events/broadcast")
async def events_broadcast(request: Request, user_id: str = Query("")):
    """接收前端发来的广播请求，转发给同用户的其他连接"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    event_type = body.get("event_type", "")
    data = body.get("data", {})
    if not event_type or not user_id:
        return JSONResponse({"ok": False, "error": "event_type and user_id required"}, status_code=400)
    # ★ 多端同步: 存储 agent 模式变更到服务端
    if event_type == 'agent:mode_changed' and data.get('mode'):
        _user_agent_modes[user_id] = {'mode': data['mode'], 'ts': data.get('ts', time.time())}
    _broadcast_to_user(user_id, event_type, data)
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
# WebSocket 网关 — 持久连接，后端管理 AI 流，多端同步
# ═══════════════════════════════════════════════════════════════

class WSConnectionManager:
    """管理用户级别的 WebSocket 连接池"""
    def __init__(self):
        self.connections: dict = {}  # {user_id: [WebSocket, ...]}
        self._lock = threading.Lock()

    def add(self, user_id: str, ws: WebSocket):
        with self._lock:
            self.connections.setdefault(user_id, []).append(ws)

    def remove(self, user_id: str, ws: WebSocket):
        with self._lock:
            if user_id in self.connections:
                try:
                    self.connections[user_id].remove(ws)
                except ValueError:
                    pass

    async def broadcast(self, user_id: str, data: dict):
        """向用户的所有连接广播消息"""
        with self._lock:
            conns = list(self.connections.get(user_id, []))
        for ws in conns:
            try:
                await ws.send_json(data)
            except Exception:
                pass

    def user_online(self, user_id: str) -> bool:
        with self._lock:
            return len(self.connections.get(user_id, [])) > 0


ws_mgr = WSConnectionManager()


class ChatStream:
    """一个 AI 对话流 — 后端管理 LLM 调用，广播 token 到所有 WS 连接"""
    def __init__(self, stream_id: str, user_id: str, chat_id: str, msg_id: str, request: dict):
        self.sid = stream_id
        self.user_id = user_id
        self.chat_id = chat_id
        self.msg_id = msg_id
        self.request = request
        self.chunks: list = []  # 已产生的 token chunks
        self.finished = False
        self.error = None

    async def run(self):
        """调用 LLM API，逐 token 广播并缓存"""
        from openai import OpenAI
        try:
            # ★ 代理配置: 请求级优先
            _httpc = None
            _rp = self.request.get('proxy_url', '')
            if self.request.get('proxy_enabled') and _rp:
                import httpx; _httpc = httpx.Client(proxy=_rp)
            elif _PROXY_URL:
                import httpx; _httpc = httpx.Client(proxy=_PROXY_URL)
            client = OpenAI(
                api_key=self.request.get('api_key', ''),
                base_url=self.request.get('base_url', '').strip().rstrip('/') or None,
                http_client=_httpc
            )
            params = {
                'model': self.request.get('model', 'deepseek-chat'),
                'messages': self.request.get('messages', []),
                'stream': True,
                'temperature': self.request.get('temperature', 0.7),
                'max_tokens': self.request.get('max_tokens', 4096),
            }
            if self.request.get('tools'):
                params['tools'] = self.request['tools']

            for chunk in client.chat.completions.create(**params):
                delta = chunk.choices[0].delta
                c = delta.content or ''
                r = getattr(delta, 'reasoning_content', '') or ''
                tc_data = None
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        tc_data = {
                            'index': getattr(tc, 'index', 0),
                            'id': tc.id or f'call_{len(self.chunks)}',
                            'function': {'name': tc.function.name or '', 'arguments': tc.function.arguments or ''}
                        }
                if c:
                    self.chunks.append({'type': 'content', 'delta': c})
                    await ws_mgr.broadcast(self.user_id, {'event': 'content', 'data': {'delta': c, 'stream_id': self.sid}})
                if r:
                    self.chunks.append({'type': 'reasoning', 'delta': r})
                    await ws_mgr.broadcast(self.user_id, {'event': 'reasoning', 'data': {'delta': r, 'stream_id': self.sid}})
                if tc_data:
                    self.chunks.append({'type': 'tool_call', 'data': tc_data})
                    await ws_mgr.broadcast(self.user_id, {'event': 'tool_call', 'data': tc_data})
                if hasattr(chunk, 'usage') and chunk.usage:
                    try:
                        u = chunk.usage.model_dump()
                        self.chunks.append({'type': 'usage', 'data': u})
                    except Exception:
                        pass

            self.finished = True
            await ws_mgr.broadcast(self.user_id, {
                'event': 'done', 'data': {'stream_id': self.sid, 'finished': True}
            })
        except Exception as e:
            self.error = str(e)
            self.finished = True
            await ws_mgr.broadcast(self.user_id, {
                'event': 'error', 'data': {'stream_id': self.sid, 'error': str(e)}
            })

    def get_snapshot(self, since: int = 0) -> list:
        """获取 since 之后的 chunks（用于断线重连）"""
        if since >= len(self.chunks):
            return []
        return self.chunks[since:]


# 活跃流注册表 {stream_id: ChatStream}
_active_streams: dict = {}
_active_streams_lock = threading.Lock()


@app.websocket("/engine/ws/{user_id}")
async def ws_chat(ws: WebSocket, user_id: str):
    """WebSocket 聊天网关 — 持久连接，收发 AI 消息"""
    await ws.accept()
    ws_mgr.add(user_id, ws)
    try:
        while True:
            msg = await ws.receive_json()
            action = msg.get('action', '')

            if action == 'chat':
                # 创建新的 AI 流
                sid = f"ws_{uuid.uuid4().hex[:12]}"
                chat_id = msg.get('chat_id', '')
                msg_id = msg.get('msg_id', '')
                request = msg.get('request', {})
                stream = ChatStream(sid, user_id, chat_id, msg_id, request)
                with _active_streams_lock:
                    _active_streams[sid] = stream
                # 通知客户端流已创建
                await ws.send_json({'event': 'stream_created', 'data': {'stream_id': sid, 'msg_id': msg_id}})
                # 后台执行 LLM 调用
                asyncio.create_task(stream.run())

            elif action == 'resume':
                # 续接已有流：补发 missed chunks
                sid = msg.get('stream_id', '')
                since = msg.get('since', 0)
                with _active_streams_lock:
                    stream = _active_streams.get(sid)
                if stream:
                    missed = stream.get_snapshot(since)
                    for chunk in missed:
                        await ws.send_json({'event': chunk['type'], 'data': chunk.get('data', chunk.get('delta', '')), 'stream_id': sid})
                    if stream.finished:
                        await ws.send_json({'event': 'done', 'data': {'stream_id': sid, 'finished': True}})
                    else:
                        await ws.send_json({'event': 'resumed', 'data': {'stream_id': sid, 'since': len(stream.chunks)}})
                else:
                    await ws.send_json({'event': 'error', 'data': {'error': 'stream not found', 'stream_id': sid}})

            elif action == 'ping':
                await ws.send_json({'event': 'pong', 'data': {}})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] Error for user {user_id}: {e}")
    finally:
        ws_mgr.remove(user_id, ws)


# 定期清理过期流（30 分钟）
def _cleanup_old_streams():
    while True:
        time.sleep(300)
        now = time.time()
        with _active_streams_lock:
            for sid in list(_active_streams.keys()):
                s = _active_streams[sid]
                if s.finished and hasattr(s, '_created_at'):
                    if now - s._created_at > 1800:
                        del _active_streams[sid]

threading.Thread(target=_cleanup_old_streams, daemon=True).start()


# ★ Agent 端点 + 浏览器工具 → engine/agent_endpoints.py
register_agent_endpoints(app, ENGINE_DIR, tool_registry)
@app.post("/engine/video_edit")
async def video_edit_endpoint(request: Request):
    """视频剪辑 HTTP 端点"""
    try:
        body = await request.json()
        action = body.get("action", "")
        params = body.get("params", {})
        input_path = body.get("input_path", "")
        output_path = body.get("output_path", "/tmp/video_output.mp4")
        if not input_path:
            return JSONResponse({"error": "未提供 input_path"}, status_code=400)
        # ★ 自动转换相对路径为绝对路径(支持上传文件的 URL 格式)
        if not os.path.exists(input_path) and input_path.startswith("/"):
            # 处理 /oneapichat/uploads/... 格式
            if input_path.startswith("/oneapichat/"):
                input_path = PROJECT_ROOT + "/" + input_path.replace("/oneapichat/", "", 1)
            elif input_path.startswith("/uploads/"):
                input_path = PROJECT_ROOT + input_path
            elif input_path.startswith("http"):
                return JSONResponse({"error": "不支持远程URL,请先用 server_exec + curl 下载到服务器"}, status_code=400)
            else:
                input_path = PROJECT_ROOT + input_path
        if not os.path.exists(input_path) and action not in ("tts", "voice"):
            return JSONResponse({"error": f"文件不存在: {input_path}"}, status_code=404)
        if action == "info":
            cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", input_path]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            return {"result": r.stdout}
        elif action == "trim":
            start = params.get("start", 0)
            end = params.get("end", None)
            from moviepy import VideoFileClip
            clip = VideoFileClip(input_path)
            if end: clip = clip.subclipped(start, end)
            else: clip = clip.subclipped(start)
            clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
            clip.close()
            return {"result": f"裁剪完成: {output_path}"}
        elif action == "speed":
            factor = float(params.get("factor", 1.0))
            from moviepy import VideoFileClip, vfx
            clip = VideoFileClip(input_path)
            clip = clip.with_effects([vfx.MultiplySpeed(factor)])
            clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
            clip.close()
            return {"result": f"调速完成 (x{factor}): {output_path}"}
        elif action == "resize":
            width = params.get("width", 0); height = params.get("height", 0)
            from moviepy import VideoFileClip
            clip = VideoFileClip(input_path)
            if width and height: clip = clip.resized((width, height))
            elif width: clip = clip.resized(width=width)
            elif height: clip = clip.resized(height=height)
            clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
            clip.close()
            return {"result": f"缩放完成: {output_path}"}
        elif action == "audio":
            from moviepy import VideoFileClip
            clip = VideoFileClip(input_path)
            audio_output = output_path + ".mp3" if not output_path.endswith(".mp3") else output_path
            if clip.audio: clip.audio.write_audiofile(audio_output)
            clip.close()
            return {"result": f"音频提取完成: {audio_output}"}
        elif action == "concat":
            files = params.get("files", [])
            if not files: return JSONResponse({"error": "concat 需要 files 数组"}, status_code=400)
            from moviepy import VideoFileClip, concatenate_videoclips
            clips = [VideoFileClip(f) for f in files]
            final = concatenate_videoclips(clips, method="compose")
            final.write_videofile(output_path, codec="libx264", audio_codec="aac")
            for c in clips: c.close()
            final.close()
            return {"result": f"拼接完成: {output_path}"}
        elif action == "overlay":
            overlay_path = params.get("overlay_path", "")
            if not overlay_path or not os.path.exists(overlay_path):
                return JSONResponse({"error": "overlay_path 无效"}, status_code=400)
            x, y = params.get("x", 10), params.get("y", 10)
            scale = params.get("scale", 0.3)
            from moviepy import VideoFileClip, CompositeVideoClip
            clip = VideoFileClip(input_path)
            ov = VideoFileClip(overlay_path).resized(scale).with_position((x, y))
            final = CompositeVideoClip([clip, ov])
            final.write_videofile(output_path, codec="libx264", audio_codec="aac")
            clip.close(); ov.close(); final.close()
            return {"result": f"画中画完成: {output_path}"}
        elif action == "text":
            result = _apply_subtitle(input_path, output_path, params)
            return {"result": result}
        elif action == "rotate":
            angle = float(params.get("angle", 90))
            from moviepy import VideoFileClip, vfx
            clip = VideoFileClip(input_path)
            clip = clip.with_effects([vfx.Rotate(angle)])
            clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
            clip.close()
            return {"result": f"旋转完成 ({angle}°): {output_path}"}
        elif action in ("filter", "video_filter"):
            return {"result": _apply_ffmpeg_filter(input_path, output_path, params)}
        elif action in ("transition", "video_transition"):
            return {"result": _apply_ffmpeg_transition(input_path, output_path, params)}
        elif action == "tts":
            return {"result": _apply_tts(params)}
        elif action == "voice":
            audio_path2 = params.get("audio_path", "")
            if not audio_path2:
                tts_result2 = _apply_tts(params)
                if "失败" in tts_result2 or "异常" in tts_result2:
                    return {"error": tts_result2}
                audio_path2 = tts_result2.split(": ")[1].split(" ")[0] if ": " in tts_result2 else "/tmp/tts_output.mp3"
            return {"result": _apply_voice_to_video(input_path, audio_path2, output_path, params)}
        elif action == "compose":
            return {"result": _apply_compose(input_path, output_path, params)}
        elif action == "crop":
            return {"result": _apply_crop(input_path, output_path, params)}
        elif action == "reverse":
            return {"result": _apply_reverse(input_path, output_path, params)}
        elif action == "mute":
            return {"result": _apply_mute(input_path, output_path, params)}
        elif action == "bgm":
            return {"result": _apply_bgm(input_path, output_path, params)}
        elif action == "enhance":
            return {"result": _apply_enhance(input_path, output_path, params)}
        elif action == "gif":
            return {"result": _apply_gif(input_path, output_path, params)}
        elif action == "silent_cut":
            return {"result": _apply_silent_cut(input_path, output_path, params)}
        elif action == "stt":
            return {"result": _apply_stt(input_path, output_path, params)}
        elif action == "stt_to_timeline":
            return {"result": _apply_stt_to_timeline(input_path, output_path, params)}
        elif action == "style":
            return {"result": _apply_subtitle_style(input_path, output_path, params)}
        elif action == "frames":
            # 提取关键帧并返回 base64 数组
            count = int(params.get("count", 3))
            duration = float(params.get("duration", 10))
            scale = int(params.get("scale", 640))
            interval = max(1, int(duration / count))
            import base64 as b64
            cmd = ["ffmpeg", "-y", "-i", input_path, "-vframes", str(count),
                   "-vf", f"fps=1/{interval},scale={scale}:-1",
                   "-f", "image2pipe", "-q:v", "3", "-vcodec", "mjpeg", "-"]
            r = subprocess.run(cmd, capture_output=True, timeout=120)
            if r.returncode != 0 or len(r.stdout) < 100:
                return JSONResponse({"error": f"截图失败: {r.stderr.decode()[:200]}"}, status_code=500)
            frames = []
            pos = 0; buf = r.stdout
            while pos < len(buf) - 4:
                soi = buf.find(b'\xff\xd8', pos)
                if soi < 0: break
                eoi = buf.find(b'\xff\xd9', soi)
                if eoi < 0: break
                jpg = buf[soi:eoi+2]
                frames.append("data:image/jpeg;base64," + b64.b64encode(jpg).decode())
                pos = eoi + 2
            return {"result": json.dumps({"frames": frames, "count": len(frames)})}
        else:
            return JSONResponse({"error": f"未知操作: {action}"}, status_code=400)
    except ImportError as e:
        return JSONResponse({"error": f"缺少依赖: {str(e)}"}, status_code=503)
    except Exception as e:
        return JSONResponse({"error": f"视频剪辑失败: {str(e)}"}, status_code=500)

# ═══════════════════════════════════════════════════════════════
# RAG (Retrieval Augmented Generation) API — 知识库检索
# ═══════════════════════════════════════════════════════════════

@app.get("/engine/rag/collections")
async def rag_collections(user_id: str = Query("")):
    return rag_list_collections(user_id)

@app.post("/engine/rag/collections")
async def rag_create_col(request: Request, user_id: str = Query("")):
    body = await request.json()
    name = body.get("name", "")
    if not name:
        return {"error": "集合名称不能为空"}
    return rag_create_collection(name, user_id)

@app.delete("/engine/rag/collections")
async def rag_delete_col(request: Request, user_id: str = Query("")):
    body = await request.json()
    name = body.get("name", "")
    if not name:
        return {"error": "集合名称不能为空"}
    return rag_delete_collection(name, user_id)

@app.get("/engine/rag/knowledge")
async def rag_knowledge(collection: str = Query("default"), user_id: str = Query("")):
    return rag_list_documents(collection, user_id)

@app.post("/engine/rag/upload")
async def rag_upload(request: Request, user_id: str = Query("")):
    try:
        import base64 as _b64
        body = await request.json()
        collection = body.get("collection", "default")
        filename = body.get("filename", "upload.txt")
        content = body.get("content", "")
        # 支持 base64 编码的二进制文件（PDF/DOCX/XLSX等）
        if not content and body.get("content_base64"):
            try:
                content = _b64.b64decode(body["content_base64"]).decode("utf-8", errors="replace")
            except Exception:
                content = ""
        chunk_size = int(body.get("chunk_size", 512))
        chunk_overlap = int(body.get("chunk_overlap", 50))
        api_key = body.get("api_key", "")
        base_url = body.get("base_url", "")
        embed_model = body.get("embed_model", "")

        if not content:
            return {"error": "文档内容不能为空"}

        return rag_upload_document(collection, filename, content, user_id,
                                   chunk_size, chunk_overlap, api_key, base_url, embed_model)
    except Exception as e:
        return {"error": str(e)}

@app.get("/engine/rag/search")
async def rag_search_endpoint(q: str = Query(""), collection: str = Query("default"),
                               top_k: int = Query(5), user_id: str = Query(""),
                               api_key: str = Query(""), base_url: str = Query(""),
                               embed_model: str = Query("")):
    if not q:
        return {"results": [], "error": "查询不能为空"}
    return rag_search(q, collection, top_k, user_id, api_key, base_url, embed_model)

@app.post("/engine/rag/search")
async def rag_search_post(request: Request, user_id: str = Query("")):
    body = await request.json()
    q = body.get("q", body.get("query", ""))
    collection = body.get("collection", "default")
    top_k = int(body.get("top_k", 5))
    api_key = body.get("api_key", "")
    base_url = body.get("base_url", "")
    embed_model = body.get("embed_model", "")
    if not q:
        return {"results": [], "error": "查询不能为空"}
    return rag_search(q, collection, top_k, user_id, api_key, base_url, embed_model)

@app.delete("/engine/rag/knowledge")
async def rag_delete_doc(request: Request, user_id: str = Query("")):
    doc_id = request.query_params.get("doc_id", "")
    collection = request.query_params.get("collection", "default")
    # 也支持 JSON body
    if not doc_id:
        try:
            body = await request.json()
            doc_id = body.get("doc_id", "")
            collection = body.get("collection", collection)
        except Exception:
            pass
    if not doc_id:
        return {"error": "doc_id 不能为空"}
    return rag_delete_document(doc_id, collection, user_id)

@app.get("/engine/rag/embed_config")
async def rag_embed_config(request: Request):
    """返回嵌入模型配置（从 config 读取）"""
    import json as _json
    config_path = os.path.join(os.path.dirname(__file__), "..", "config", ".mmx_config.json")
    cfg = {}
    if os.path.exists(config_path):
        try:
            with open(config_path) as f:
                cfg = _json.load(f)
        except Exception:
            pass
    collection = request.query_params.get("collection", "default")
    # 读取集合级 mode 配置
    coll_mode = cfg.get("rag_modes", {}).get(collection, cfg.get("rag_mode", "hybrid"))
    return {
        "embed_model": cfg.get("embed_model", "text-embedding-3-small"),
        "embed_api_base": cfg.get("api_base", cfg.get("base_url", "")),
        "embed_api_key": cfg.get("api_key", cfg.get("mmx_api_key", ""))[:8] + "***" if cfg.get("api_key") else "",
        "mode": coll_mode,
        "chunk_size": 512,
        "chunk_overlap": 50
    }

@app.post("/engine/rag/embed_config")
async def rag_embed_config_post(request: Request):
    """保存嵌入配置并重新嵌入已有文档"""
    import json as _json
    from pathlib import Path as _Path

    config_path = os.path.join(os.path.dirname(__file__), "..", "config", ".mmx_config.json")
    config_p = _Path(config_path)

    collection = request.query_params.get("collection", "default")
    embed_model = request.query_params.get("embed_model", "")
    mode = request.query_params.get("mode", "hybrid")

    # 读取/更新配置
    cfg = _load_json(config_p) if config_p.exists() else {}

    if embed_model:
        cfg["embed_model"] = embed_model
    # 按集合保存 mode
    if "rag_modes" not in cfg:
        cfg["rag_modes"] = {}
    cfg["rag_modes"][collection] = mode

    with open(config_path, "w") as f:
        _json.dump(cfg, f, indent=2, ensure_ascii=False)

    # 重新嵌入已有文档
    embedded = 0
    if embed_model:
        user_id = request.query_params.get("user_id", "")
        docs_file = RAG_DIR / (f"docs_{user_id}_{collection}.json" if user_id else f"docs_{collection}.json")
        data = _load_json(docs_file)
        api_key = cfg.get("api_key", "") or cfg.get("mmx_api_key", "")
        api_base = cfg.get("api_base", "") or cfg.get("base_url", "")
        for doc in data.get("documents", []):
            for chunk in doc.get("chunks", []):
                try:
                    emb = _get_embedding(chunk["text"], api_key, api_base, embed_model)
                    if emb:
                        chunk["embedding"] = emb
                        embedded += 1
                except Exception:
                    pass
        if embedded > 0:
            _save_json(docs_file, data)

    return {"success": True, "embedded": embedded, "embed_model": embed_model, "mode": mode}

@app.get("/engine/rag/list_models")
async def rag_list_models():
    return {"models": ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"]}


# ═══════════════════════════════════════════════════════════════
# Platform Extract API — 平台特定网页内容提取
# ═══════════════════════════════════════════════════════════════

@app.get("/engine/platform_extract")
async def platform_extract(url: str = Query(""), user_id: str = Query("")):
    """从支持的平台(B站等)提取结构化内容"""
    if not url:
        return {"ok": False, "error": "缺少 url 参数"}
    try:
        from engine.web_extract import web_extractor as _wex
        bm = None
        try:
            from engine.browser import ensure_browser_connected
            bm = await ensure_browser_connected()
        except Exception:
            pass
        result = await _wex.extract(url, _http_session, bm)
        return {
            "ok": True,
            "result": result.content,
            "title": result.title,
            "platform": result.platform,
            "structured": result.structured,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════
# Skills API — 可复用提示词模板系统
# ═══════════════════════════════════════════════════════════════

@app.get("/engine/skills/list")
async def skills_list(user_id: str = Query("")):
    """列出用户的所有技能"""
    from engine.skills import list_skills
    return {"skills": list_skills(user_id)}


@app.post("/engine/skills/create")
async def skills_create(request: Request, user_id: str = Query("")):
    """创建新技能"""
    try:
        body = await request.json()
        from engine.skills import create_skill
        return create_skill(user_id, body)
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/engine/skills/update")
async def skills_update(request: Request, user_id: str = Query("")):
    """更新技能"""
    try:
        body = await request.json()
        name = body.get("name", "")
        from engine.skills import update_skill
        return update_skill(user_id, name, {k: v for k, v in body.items() if k != "name"})
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/engine/skills/delete")
async def skills_delete(name: str = Query(""), user_id: str = Query("")):
    """删除技能"""
    if not name:
        return {"ok": False, "error": "缺少 name 参数"}
    from engine.skills import delete_skill
    return delete_skill(user_id, name)


@app.post("/engine/skills/run")
async def skills_run(request: Request, user_id: str = Query("")):
    """执行技能: 注入参数 → 返回渲染后的提示词供 Agent 使用"""
    try:
        body = await request.json()
        skill_name = body.get("skill_name", "")
        params = body.get("params", {})
        if not skill_name:
            return {"ok": False, "error": "缺少 skill_name 参数"}

        from engine.skills import get_skill, render_prompt, extract_params

        skill = get_skill(user_id, skill_name)
        if not skill:
            return {"ok": False, "error": f"技能 '{skill_name}' 不存在"}

        prompt = render_prompt(skill.get("prompt_template", ""), params)
        if not prompt:
            return {"ok": False, "error": "技能提示词模板为空"}

        # 返回渲染后的提示词和工具列表, 由调用方(Agent系统的 _execute_tool)创建子代理执行
        return {
            "ok": True,
            "prompt": prompt,
            "tools": skill.get("tools", []),
            "model_tier": skill.get("model_tier", "smart"),
            "max_rounds": int(skill.get("max_rounds", 10)),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════
# ═══════════════════════════════════════════════════════════════
# SRC (StarRailCopilot) REST API — 完整集成端点
# 前端 src-manager.js → /engine/src/* → 控制 StarRailCopilot
# ═══════════════════════════════════════════════════════════════

SRC_DIR = "/home/naujtrats/StarRailCopilot"
SRC_INSTALLED = os.path.isdir(SRC_DIR)

if SRC_INSTALLED and SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

# Patch SRC config path resolution (SRC resolves ./config/ relative to cwd, not SRC_DIR)
def _patch_src_path():
    try:
        from module.config import utils as _src_cfg_utils
        _orig_filepath = _src_cfg_utils.filepath_config
        def _patched_filepath(filename, mod_name='alas'):
            if mod_name == 'alas':
                return os.path.join(SRC_DIR, 'config', f'{filename}.json')
            return os.path.join(SRC_DIR, 'config', f'{filename}.{mod_name}.json')
        _src_cfg_utils.filepath_config = _patched_filepath
    except Exception:
        pass

_patch_src_path()

# Thread-safe ProcessManager cache
_src_lock = threading.Lock()
_src_pm_cache = {}

# Task descriptions
SRC_TASK_DESCRIPTIONS = {
    'Alas': '完整调度器，按优先级依次执行所有已启用的任务',
    'Restart': '重启游戏客户端',
    'Dungeon': '刷副本：拟造花萼、侵蚀隧洞、凝滞虚影等，消耗开拓力',
    'Ornament': '刷内圈遗器：差分宇宙·千面xx，消耗开拓力或沉浸器',
    'DailyQuest': '完成每日实训任务，领取活跃度奖励',
    'BattlePass': '领取无名勋礼（大月卡）奖励',
    'Assignment': '收派委托（派遣角色获取材料）',
    'DataUpdate': '更新游戏内数据：信用点、星琼、燃料等资源统计',
    'Freebies': '领取免费奖励：邮件、兑换码、助战奖励',
    'Weekly': '刷历战余响（周本），消耗开拓力',
    'Rogue': '刷模拟宇宙（差分宇宙），可设置祝福/奇物/事件策略',
    'Daemon': '后台托管模式：自动启停模拟器+游戏，循环清体力',
    'PlannerScan': '角色养成规划扫描：读取角色/光锥材料需求',
}

SRC_TASK_GROUPS = [
    {'name': 'Main', 'label': '基础', 'tasks': ['Alas', 'Restart']},
    {'name': 'Daily', 'label': '日常', 'tasks': ['Dungeon', 'Ornament', 'DailyQuest', 'BattlePass', 'Assignment', 'DataUpdate', 'Freebies']},
    {'name': 'Weekly', 'label': '周常', 'tasks': ['Weekly', 'Rogue']},
    {'name': 'Tool', 'label': '工具', 'tasks': ['Daemon', 'PlannerScan']},
]

SRC_DEFAULT_CONFIG = 'src'


def _src_get_config(config_name=None):
    """Lazy-load AzurLaneConfig for a given instance name."""
    if not SRC_INSTALLED:
        return None
    name = config_name or SRC_DEFAULT_CONFIG
    try:
        from module.config.config import AzurLaneConfig
        return AzurLaneConfig(name)
    except Exception:
        return None


def _src_ensure_state():
    """Initialize SRC State multiprocessing.Manager."""
    if not SRC_INSTALLED:
        return
    try:
        from module.webui.setting import State
        if State.manager is None:
            State.init()
    except Exception:
        pass


def _src_have_pm(config_name=None):
    name = config_name or SRC_DEFAULT_CONFIG
    return name in _src_pm_cache


def _src_get_pm(config_name=None):
    """Get or create ProcessManager. Returns None if unavailable."""
    if not SRC_INSTALLED:
        return None
    name = config_name or SRC_DEFAULT_CONFIG
    with _src_lock:
        if name not in _src_pm_cache:
            try:
                _src_ensure_state()
                from module.webui.process_manager import ProcessManager
                _src_pm_cache[name] = ProcessManager.get_manager(name)
            except Exception:
                return None
        return _src_pm_cache.get(name)


def _src_config_dict(config):
    """Extract safe dict from AzurLaneConfig."""
    if config is None:
        return {}
    try:
        return config.data if hasattr(config, 'data') else {}
    except Exception:
        return {}


def _src_task_status(config, task_name):
    """Extract task scheduler status from config data."""
    data = _src_config_dict(config)
    task_data = data.get(task_name, {})
    scheduler = task_data.get('Scheduler', {})
    return {
        'name': task_name,
        'enable': scheduler.get('Enable', False),
        'command': scheduler.get('Command', task_name),
        'next_run': str(scheduler.get('NextRun', '')),
        'description': SRC_TASK_DESCRIPTIONS.get(task_name, ''),
    }


def _src_safe_int(v, default=0):
    try: return int(v)
    except (TypeError, ValueError): return default


def _src_stored_value(config, path_key, default=0):
    """Safe read from config stored data."""
    if config is None:
        return default
    try:
        from module.config.deep import deep_get
        return deep_get(config.data, keys=path_key, default=default)
    except Exception:
        return default


# ── Endpoints ──

@app.get("/engine/src/status")
async def src_status(config_name: str = Query("src")):
    if not SRC_INSTALLED:
        return {"ok": True, "status": "not_installed", "alive": False, "state": 0,
                "state_label": "not_installed", "config_name": config_name,
                "message": f"StarRailCopilot 未安装。git clone 到 {SRC_DIR}"}
    try:
        if not _src_have_pm(config_name):
            return {"ok": True, "config_name": config_name,
                    "alive": False, "state": 2, "state_label": "stopped"}
        pm = _src_get_pm(config_name)
        if pm is None:
            return {"ok": True, "config_name": config_name,
                    "alive": False, "state": 0, "state_label": "unavailable"}
        alive = pm.alive
        state = pm.state
        labels = {1: 'running', 2: 'stopped', 3: 'error', 4: 'updating'}
        return {"ok": True, "config_name": config_name,
                "alive": alive, "state": state,
                "state_label": labels.get(state, 'unknown')}
    except Exception as e:
        return {"ok": False, "error": str(e), "alive": False, "state": 0, "state_label": "error"}


@app.get("/engine/src/ping")
async def src_ping():
    return {"ok": True, "installed": SRC_INSTALLED, "dir": SRC_DIR}


@app.get("/engine/src/dashboard")
async def src_dashboard(config_name: str = Query("src")):
    if not SRC_INSTALLED:
        return {"ok": True, "resources": {}, "message": "SRC 未安装"}
    try:
        config = _src_get_config(config_name)
        resources = {}
        stored_paths = {
            'trailblaze_power': ('Dungeon.DungeonStorage.TrailblazePower',),
            'daily_activity': ('DailyQuest.DailyStorage.DailyActivity',),
            'credit': ('DataUpdate.DataUpdateStorage.Credit',),
            'stellar_jade': ('DataUpdate.DataUpdateStorage.StallerJade',),
            'fuel': ('Dungeon.DungeonStorage.Fuel',),
            'reserved_power': ('Dungeon.DungeonStorage.Reserved',),
            'immersifier': ('Dungeon.DungeonStorage.Immersifier',),
            'echo_of_war': ('Weekly.WeeklyStorage.EchoOfWar',),
            'simulated_universe': ('Rogue.RogueStorage.SimulatedUniverse',),
            'battle_pass_level': ('BattlePass.BattlePassStorage.BattlePassLevel',),
        }
        for key, path in stored_paths.items():
            val = _src_stored_value(config, list(path) + ['value'], None)
            total = _src_stored_value(config, list(path) + ['total'], None)
            t = _src_stored_value(config, list(path) + ['time'], '')
            resources[key] = {
                'value': _src_safe_int(val) if val is not None else 0,
                'total': _src_safe_int(total) if total is not None else None,
                'time': str(t) if t else '',
            }
        return {"ok": True, "resources": resources, "updated_at": str(datetime.now())}
    except Exception as e:
        return {"ok": False, "error": str(e), "resources": {}}


@app.get("/engine/src/tasks")
async def src_tasks(config_name: str = Query("src")):
    if not SRC_INSTALLED:
        return {"ok": True, "groups": [], "tasks": [], "message": "SRC 未安装"}
    try:
        config = _src_get_config(config_name)
        groups_out = []
        all_tasks = []
        for group in SRC_TASK_GROUPS:
            tasks = [_src_task_status(config, t) for t in group['tasks']]
            groups_out.append({'name': group['name'], 'label': group['label'], 'tasks': tasks})
            all_tasks.extend(tasks)
        return {"ok": True, "groups": groups_out, "tasks": all_tasks}
    except Exception as e:
        return {"ok": False, "error": str(e), "groups": [], "tasks": []}


@app.post("/engine/src/run")
async def src_run(request: Request):
    if not SRC_INSTALLED:
        return {"ok": False, "error": "SRC 未安装，无法启动"}
    try:
        data = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    except Exception:
        data = {}
    config_name = data.get('config_name', SRC_DEFAULT_CONFIG)
    task = data.get('task', 'Alas')
    valid_tasks = [t for g in SRC_TASK_GROUPS for t in g['tasks']]
    if task not in valid_tasks:
        return {"ok": False, "error": f"未知任务: {task}", "valid_tasks": valid_tasks}
    try:
        pm = _src_get_pm(config_name)
        if pm is None:
            return {"ok": False, "error": "SRC 后端不可用（ProcessManager 初始化失败）"}
        if pm.alive:
            return {"ok": False, "error": "已有任务在运行，请先停止"}
        import inflection
        func = inflection.underscore(task) if task != 'Alas' else 'alas'
        pm.start(func)
        return {"ok": True, "config_name": config_name, "task": task, "func": func}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/engine/src/stop")
async def src_stop(request: Request):
    if not SRC_INSTALLED:
        return {"ok": False, "error": "SRC 未安装"}
    try:
        data = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    except Exception:
        data = {}
    config_name = data.get('config_name', SRC_DEFAULT_CONFIG)
    try:
        if not _src_have_pm(config_name):
            return {"ok": False, "error": "没有运行中的任务"}
        pm = _src_get_pm(config_name)
        if pm is None or not pm.alive:
            return {"ok": False, "error": "没有运行中的任务"}
        pm.stop()
        return {"ok": True, "config_name": config_name, "message": "已停止"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/engine/src/config/{config_name}")
async def src_get_config(config_name: str):
    if not SRC_INSTALLED:
        return {"ok": True, "data": {}, "config_name": config_name, "message": "SRC 未安装"}
    try:
        config = _src_get_config(config_name)
        if config is None:
            try:
                from module.config.utils import read_file, filepath_config
                raw = read_file(filepath_config(config_name))
                if raw:
                    return {"ok": True, "config_name": config_name, "data": raw}
            except Exception:
                pass
            return {"ok": False, "error": "配置不存在", "config_name": config_name}
        return {"ok": True, "config_name": config_name, "data": _src_config_dict(config)}
    except Exception as e:
        return {"ok": False, "error": str(e), "config_name": config_name}


@app.put("/engine/src/config/{config_name}")
async def src_set_config(config_name: str, request: Request):
    if not SRC_INSTALLED:
        return {"ok": False, "error": "SRC 未安装"}
    try:
        data = await request.json()
    except Exception:
        return {"ok": False, "error": "Invalid JSON body"}
    updates = data.get('updates', [])
    if not updates and 'path' in data:
        updates = [{'path': data['path'], 'value': data['value']}]
    if not updates:
        return {"ok": False, "error": "Missing path/value or updates"}
    try:
        config = _src_get_config(config_name)
        if config is None:
            return {"ok": False, "error": "配置不存在"}
        from module.config.deep import deep_set
        applied = []
        for upd in updates:
            path = upd['path']
            value = upd['value']
            deep_set(config.data, keys=path, value=value)
            config.modified[path] = value
            applied.append({'path': path, 'value': value})
        config.save()
        return {"ok": True, "applied": applied}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/engine/src/logs")
async def src_logs(config_name: str = Query("src"), limit: int = Query(50)):
    if not SRC_INSTALLED:
        return {"ok": True, "lines": ["[SRC] StarRailCopilot 未安装"], "count": 1}
    try:
        if not _src_have_pm(config_name):
            return {"ok": True, "lines": [], "count": 0, "note": "未启动"}
        pm = _src_get_pm(config_name)
        if pm is None:
            return {"ok": True, "lines": [], "count": 0}
        renderables = getattr(pm, 'renderables', []) or []
        entries = []
        for r in renderables[-limit:]:
            try:
                if hasattr(r, 'markup'): entries.append(str(r.markup))
                elif hasattr(r, 'text'): entries.append(r.text)
                else: entries.append(str(r))
            except Exception:
                entries.append(str(r))
        return {"ok": True, "lines": entries, "count": len(entries)}
    except Exception as e:
        return {"ok": False, "error": str(e), "lines": []}


@app.get("/engine/src/configs")
async def src_configs():
    """List available SRC config instances."""
    if not SRC_INSTALLED:
        return {"ok": True, "instances": []}
    try:
        from module.config.utils import alas_instance
        return {"ok": True, "instances": alas_instance()}
    except Exception as e:
        return {"ok": False, "error": str(e), "instances": []}


@app.get("/engine/src/args/{task_name}")
async def src_args(task_name: str):
    """Get argument schema for a task."""
    if not SRC_INSTALLED:
        return {"ok": False, "error": "SRC 未安装"}
    try:
        from module.config.utils import read_file
        args_file = os.path.join(SRC_DIR, 'module', 'config', 'argument', 'args.json')
        all_args = read_file(args_file)
        if isinstance(all_args, str):
            all_args = json.loads(all_args)
        task_args = all_args.get(task_name, {})
        if not task_args:
            return {"ok": False, "error": f'任务 "{task_name}" 不存在'}
        return {"ok": True, "task": task_name, "args": task_args}
    except Exception as e:
        return {"ok": False, "error": str(e), "args": {}}


if __name__ == "__main__":
    port = int(os.getenv("ENGINE_PORT", "8766"))
    print(f"[引擎] 启动 http://0.0.0.0:{port}")
    print(f"[引擎] Cron 任务: {list(cron_store.get().keys())}")
    print(f"[引擎] 子代理: {list(agent_store.get().keys())}")
    uvicorn.run(app, host="0.0.0.0", port=port)
