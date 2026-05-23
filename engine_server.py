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
import subprocess
import requests
import re
from datetime import datetime, timedelta
from pathlib import Path
import sqlite3
import tempfile

# Cross-platform: fcntl is Unix-only
try:
    import fcntl
    HAS_FCNTL = True
except ImportError:
    HAS_FCNTL = False

# ── Project root detection ────────────────────────────
PROJECT_ROOT = str(Path(__file__).parent.resolve())
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, os.path.join(tempfile.gettempdir(), 'pylib'))

try:
    from fastapi import FastAPI, Query, HTTPException, Request
    from fastapi.responses import StreamingResponse
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except:
    print("[引擎] 需要安装 fastapi/uvicorn: pip install fastapi uvicorn --break-system-packages")
    sys.exit(1)

# ── 引擎层模块 ────────────────────────────────────────────
from engine.exec_policy import ExecPolicy, ExecDecision, Priority
from engine.speculation import SpeculationEngine, SpeculationState
from engine.retry import RetryEngine, RetryStatus
from engine.tool_registry import ToolRegistry, ToolDef, Capability, ApprovalKind, get_global_registry
from engine.event_frame import EventFlowBuilder, EventType, EventLog


app = FastAPI(title="OneAPIChat Engine")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

ENGINE_DIR = Path(PROJECT_ROOT) / ".engine"
ENGINE_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR = Path(tempfile.gettempdir())

# ── 引擎层全局实例 ──────────────────────────────────────────
exec_policy = ExecPolicy(rules_file=str(ENGINE_DIR / "exec_policy.json"))
speculation_engine = SpeculationEngine()
retry_engine = RetryEngine(max_attempts=3, backoff_base_ms=500)
tool_registry = get_global_registry()
event_log = EventLog()

if exec_policy._rules_file and not exec_policy._rules_file.exists():
    exec_policy.save()

# ==================== 存储 ====================
class EngineStore:
    """JSON文件存储(带文件锁防止并发写入冲突)"""
    def __init__(self, path, user_id=""):
        self.path = Path(path)
        if user_id:
            self.path = self.path.parent / f"user_{user_id}_{self.path.name}"
        if not self.path.exists():
            self.path.write_text('{}', encoding='utf8')

    def get(self):
        return json.loads(self.path.read_text(encoding='utf8'))

    def set(self, data):
        """带文件锁的原子写入,防止并发写冲突"""
        tmp = self.path.with_suffix('.tmp')
        import tempfile
        fd, tmp_path = tempfile.mkstemp(dir=str(self.path.parent), suffix='.tmp')
        try:
            os.write(fd, json.dumps(data, ensure_ascii=False, indent=2).encode('utf8'))
            os.close(fd)
            # 原子替换
            os.replace(tmp_path, str(self.path))
        except:
            os.close(fd)
            try: os.unlink(tmp_path)
            except: pass
            raise

    def update(self, key, value):
        d = self.get()
        d[key] = value
        self.set(d)

    def delete(self, key):
        d = self.get()
        d.pop(key, None)
        self.set(d)

cron_store = EngineStore(ENGINE_DIR / "cron.json")
agent_store = EngineStore(ENGINE_DIR / "agents.json")
heartbeat_store = EngineStore(ENGINE_DIR / "heartbeat.json")

def get_ns(suffix: str, user_id: str = "") -> EngineStore:
    """获取用户隔离的 store 实例"""
    return EngineStore(ENGINE_DIR / f"{suffix}.json", user_id=user_id)



# ==================== ChatStore (SQLite 消息持久化) ====================

class ChatStore:
    """SQLite 消息存储，支持流式进度保存"""
    def __init__(self, user_id: str = ""):
        self.user_id = user_id
        db_name = f"chat_{user_id}.db" if user_id else "chat.db"
        self.db_path = ENGINE_DIR / db_name
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self._progress_cache = {}  # msg_id -> latest progress (in-memory)

    def _conn(self):
        return sqlite3.connect(str(self.db_path), timeout=30)

    def _init_db(self):
        conn = self._conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL, msg_id TEXT UNIQUE NOT NULL,
                role TEXT NOT NULL, content TEXT, reasoning TEXT,
                tool_calls TEXT, model TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_stream_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                msg_id TEXT UNIQUE NOT NULL, chat_id TEXT NOT NULL, model TEXT,
                full_text TEXT DEFAULT '', reasoning_text TEXT DEFAULT '',
                tool_calls TEXT DEFAULT '[]', usage TEXT, finished INTEGER DEFAULT 0,
                error TEXT DEFAULT '', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_msg_chat ON chat_messages(chat_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_progress_msg ON chat_stream_progress(msg_id)")
        conn.commit()
        conn.close()

    def init_progress(self, msg_id: str, chat_id: str, model: str):
        try:
            conn = self._conn()
            conn.execute("""
                INSERT OR REPLACE INTO chat_stream_progress (msg_id, chat_id, model, finished, updated_at)
                VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
            """, (msg_id, chat_id, model))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ChatStore] init error: {e}")

    def write_chunk(self, msg_id: str, chunk_type: str, chunk_text: str):
        if msg_id not in self._progress_cache:
            self._progress_cache[msg_id] = {'full_text': '', 'reasoning_text': ''}
        cache = self._progress_cache[msg_id]
        if chunk_type == 'content':
            cache['full_text'] += chunk_text
        elif chunk_type == 'reasoning':
            cache['reasoning_text'] += chunk_text
        # 每 20 个字符写一次 DB
        if len(cache['full_text']) % 20 < len(chunk_text) or chunk_type == 'reasoning':
            self._flush(msg_id, cache['full_text'], cache['reasoning_text'])

    def _flush(self, msg_id: str, full_text: str, reasoning_text: str):
        try:
            conn = self._conn()
            conn.execute("""
                UPDATE chat_stream_progress SET full_text=?, reasoning_text=?, updated_at=CURRENT_TIMESTAMP
                WHERE msg_id=?
            """, (full_text, reasoning_text, msg_id))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ChatStore] flush error: {e}")

    def finish_stream(self, msg_id: str, full_text: str, reasoning_text: str,
                      tool_calls: list, usage: dict, error: str = ""):
        try:
            conn = self._conn()
            conn.execute("""
                UPDATE chat_stream_progress SET
                    full_text=?, reasoning_text=?,
                    tool_calls=?, usage=?, finished=1, error=?, updated_at=CURRENT_TIMESTAMP
                WHERE msg_id=?
            """, (full_text, reasoning_text, json.dumps(tool_calls, ensure_ascii=False),
                  json.dumps(usage or {}, ensure_ascii=False), error, msg_id))
            conn.commit()
            conn.close()
            self._progress_cache.pop(msg_id, None)
        except Exception as e:
            print(f"[ChatStore] finish error: {e}")

    def get_progress(self, msg_id: str) -> dict:
        try:
            conn = self._conn()
            row = conn.execute("""
                SELECT full_text, reasoning_text, tool_calls, usage, finished, error
                FROM chat_stream_progress WHERE msg_id=?
            """, (msg_id,)).fetchone()
            conn.close()
            if row:
                return {'full_text': row[0] or '', 'reasoning_text': row[1] or '',
                        'tool_calls': json.loads(row[2] or '[]'), 'usage': json.loads(row[3] or '{}'),
                        'finished': bool(row[4]), 'error': row[5] or ''}
            return {}
        except:
            return {}

_chat_stores = {}
def get_chat_store(user_id: str = "") -> ChatStore:
    if user_id not in _chat_stores:
        _chat_stores[user_id] = ChatStore(user_id)
    return _chat_stores[user_id]

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
    """向客户端推送消息(通过心跳带回)"""
    store = get_ns("heartbeat", user_id)
    data = store.get()
    pending = data.get("pending_messages", [])
    pending.append({"msg": msg, "time": datetime.now().isoformat()})
    data["pending_messages"] = pending
    store.set(data)
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

# ==================== Cron 任务 ====================
_cron_threads = {}

@app.get("/engine/cron/list")
def cron_list(user_id: str = Query("")):
    store = get_ns("cron", user_id)
    return store.get()

@app.get("/engine/cron/create")
def cron_create(
    name: str = Query(...),
    interval: int = Query(...),  # 秒
    action: str = Query(...),     # 要执行的 shell 命令
    user_id: str = Query("")
):
    store = get_ns("cron", user_id)
    jobs = store.get()
    jobs[name] = {
        "name": name,
        "interval": interval,
        "action": action,
        "enabled": True,
        "created": datetime.now().isoformat()
    }
    store.set(jobs)
    _start_cron_job(name, user_id)
    return {"ok": True, "job": name}

@app.get("/engine/cron/delete")
def cron_delete(name: str = Query(...), user_id: str = Query("")):
    _stop_cron_job(name, user_id)
    store = get_ns("cron", user_id)
    store.delete(name)
    return {"ok": True}

def _run_cron_job(name, interval, action, user_id):
    """后台执行 cron 任务"""
    key = f"{user_id}_{name}"
    store = get_ns("cron", user_id)
    while True:
        job = store.get().get(name)
        if not job or not job.get("enabled"):
            break
        try:
            result = subprocess.run(
                action, shell=True, capture_output=True, text=True, timeout=300, encoding='utf-8', errors='replace'
            )
            log_entry = {
                "time": datetime.now().isoformat(),
                "exit_code": result.returncode,
                "stdout": result.stdout[-500:] if result.stdout else "",
                "stderr": result.stderr[-500:] if result.stderr else ""
            }
            # Cron完成后推送通知(优先 stdout,其次 stderr,兜底推送完成消息)
            push_store = get_ns("heartbeat", user_id)
            push_data = push_store.get()
            pending = push_data.get("pending_messages", [])
            if result.stdout.strip():
                pending.append({"msg": f"[Cron] {name}: {result.stdout.strip()[-200:]}", "time": datetime.now().isoformat()})
            elif result.stderr.strip():
                pending.append({"msg": f"[Cron] {name} 出错: {result.stderr.strip()[-200:]}", "time": datetime.now().isoformat()})
            else:
                pending.append({"msg": f"[Cron] {name} 已完成 (exit: {result.returncode})", "time": datetime.now().isoformat()})
            push_data["pending_messages"] = pending
            push_store.set(push_data)
            jobs = store.get()
            if name in jobs:
                jobs[name]["last_run"] = log_entry
                jobs[name]["next_run"] = time.time() + interval
                store.set(jobs)
        except subprocess.TimeoutExpired:
            jobs = store.get()
            if name in jobs:
                jobs[name]["last_run"] = {"time": datetime.now().isoformat(), "error": "timeout"}
                store.set(jobs)
        except Exception as e:
            jobs = store.get()
            if name in jobs:
                jobs[name]["last_run"] = {"time": datetime.now().isoformat(), "error": str(e)}
                store.set(jobs)

        # 等待下一轮
        for _ in range(interval):
            time.sleep(1)
            job = store.get().get(name)
            if not job or not job.get("enabled"):
                return

def _start_cron_job(name, user_id=""):
    store = get_ns("cron", user_id)
    key = f"{user_id}_{name}"
    job = store.get().get(name)
    if not job:
        return
    if key in _cron_threads and _cron_threads[key].is_alive():
        return
    t = threading.Thread(target=_run_cron_job, args=(name, job["interval"], job["action"], user_id), daemon=True)
    t.start()
    _cron_threads[key] = t

def _stop_cron_job(name, user_id=""):
    store = get_ns("cron", user_id)
    key = f"{user_id}_{name}"
    jobs = store.get()
    if name in jobs:
        jobs[name]["enabled"] = False
        store.set(jobs)
    _cron_threads.pop(key, None)

# ==================== Agent 角色系统 ====================
# 每个角色有不同工具权限,实现最小权限原则
AGENT_ROLES = {
    "explorer": {
        "label": "🔍 搜索专员",
        "desc": "只读搜索,适合查资料、抓网页。不可修改文件或执行命令",
        "tools": ["web_search", "web_fetch", "engine_push", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "cheap",
        "max_rounds": 10
    },
    "planner": {
        "label": "📐 规划师",
        "desc": "制定方案、分析策略。不做执行,只出方案",
        "tools": ["web_search", "engine_push", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "smart",
        "max_rounds": 8
    },
    "developer": {
        "label": "⚡ 开发者",
        "desc": "读写文件、执行命令、搜索、浏览器操控。全能执行角色",
        "tools": ["web_search", "web_fetch", "engine_push", "server_exec", "server_python", "server_file_read", "server_file_write", "server_file_append", "browser_navigate", "browser_screenshot", "browser_click", "browser_type", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "smart",
        "max_rounds": 30
    },
    "verifier": {
        "label": "✅ 验证者",
        "desc": "检查结果、找问题。只读,不可修改",
        "tools": ["web_search", "web_fetch", "server_file_read", "engine_push", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "smart",
        "max_rounds": 15
    },
    "general": {
        "label": "🌐 全能代理",
        "desc": "所有工具可用(默认角色)",
        "tools": ["web_search", "web_fetch", "engine_push", "server_exec", "server_python", "server_file_read", "server_file_write", "server_file_append", "server_sys_info", "browser_navigate", "browser_screenshot", "browser_click", "browser_type", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "smart",
        "max_rounds": 30
    }
}

def _filter_tools_by_role(role: str) -> list:
    """根据角色过滤工具列表,实现最小权限"""
    ALL_TOOLS_DEF = [
        {
            "type": "function",
            "function": {
                "name": "web_fetch",
                "description": "抓取一个网页URL的内容,返回提取后的文本。支持批量抓取(最多3个URL同时)。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "要抓取的URL"},
                        "urls": {"type": "array", "items": {"type": "string"}, "description": "批量抓取多个URL(最多3个)"}
                    },
                    "required": []
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "engine_push",
                "description": "向用户推送一条通知消息,消息会通过心跳机制到达前端。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "msg": {"type": "string", "description": "推送消息内容"}
                    },
                    "required": ["msg"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "server_sys_info",
                "description": "获取服务器系统信息(内存、磁盘、CPU等)。",
                "parameters": {"type": "object", "properties": {}, "required": []}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "server_file_write",
                "description": "将内容写入服务器文件。除非用户要求保存文件，否则不要用这个工具，直接用文字回复即可。路径限制在临时目录开头。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "文件路径，如 tempfile/myfile.md"},
                        "content": {"type": "string", "description": "写入的文件内容"}
                    },
                    "required": ["path", "content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "搜索互联网,返回标题+链接+摘要。用于查找最新信息、攻略等。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "搜索关键词"}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "server_file_append",
                "description": "向已存在的文件追加内容(末尾换行追加)。如果文件不存在则自动创建。用于边搜索边写入攻略,不用等到最后一次性保存。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "文件路径,如 tempfile/外卖省钱攻略.md"},
                        "content": {"type": "string", "description": "要追加的内容"}
                    },
                    "required": ["path", "content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "server_file_read",
                "description": "读取服务器文件内容。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "文件路径"}
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "server_exec",
                "description": "在服务器上执行 shell 命令并返回输出。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "cmd": {"type": "string", "description": "要执行的 shell 命令"},
                        "timeout": {"type": "number", "description": "超时时间(秒),默认60"}
                    },
                    "required": ["cmd"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "server_python",
                "description": "执行 Python 脚本代码,返回输出。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "script": {"type": "string", "description": "Python 代码"},
                        "timeout": {"type": "number", "description": "超时时间(秒),默认30"}
                    },
                    "required": ["script"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_navigate",
                "description": "在浏览器中打开一个网页。会替换当前页面内容。用于查看网页、登录页面、查看实时内容等。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "要打开的完整 URL"}
                    },
                    "required": ["url"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_screenshot",
                "description": "对当前浏览器页面截图，返回一张图片。用于查看页面视觉状态。",
                "parameters": {"type": "object", "properties": {}}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_click",
                "description": "在浏览器页面中点击指定选择器的元素。必须先 browser_navigate 打开页面再操作。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "selector": {"type": "string", "description": "CSS 选择器"}
                    },
                    "required": ["selector"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_type",
                "description": "在浏览器页面的输入框中输入文字。会清空再输入。必须先 browser_navigate 打开页面再操作。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "selector": {"type": "string", "description": "输入框的 CSS 选择器"},
                        "text": {"type": "string", "description": "要输入的文字内容"}
                    },
                    "required": ["selector", "text"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_get_content",
                "description": "获取当前浏览器页面的可见文本内容。用于阅读文章、查看搜索结果等。最多返回50000字符。",
                "parameters": {"type": "object", "properties": {}}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_get_snapshot",
                "description": "获取当前浏览器页面的可访问性结构树(类似于页面元素大纲)。用于理解页面布局、按钮位置等。",
                "parameters": {"type": "object", "properties": {}}
            }
        }
    ]
    role_config = AGENT_ROLES.get(role, AGENT_ROLES["general"])
    allowed = set(role_config["tools"])
    return [t for t in ALL_TOOLS_DEF if t["function"]["name"] in allowed]

# ==================== 子代理 ====================

def _cleanup_old_agents(agents: dict) -> int:
    """清理过时/失败/已完成的子代理,返回清理数量"""
    now = datetime.now()
    cutoff = now - timedelta(hours=12)  # 超过12小时的completed/failed清理
    to_delete = []
    for name, agent in list(agents.items()):
        created_str = agent.get("created", "")
        if not created_str:
            continue
        try:
            created = datetime.fromisoformat(created_str)
        except:
            continue
        status = agent.get("status", "")
        age = now - created
        # completed/failed 超过12小时
        if status in ("completed", "failed") and age > timedelta(hours=12):
            to_delete.append(name)
        # idle 超过1小时(创建了但从未运行)
        elif status == "idle" and age > timedelta(hours=1):
            to_delete.append(name)
    for name in to_delete:
        del agents[name]
    return len(to_delete)

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
    user_id: str = Query("")
):
    store = get_ns("agents", user_id)
    agents = store.get()
    # 自动清理过时子代理
    _cleanup_old_agents(agents)
    # 验证角色名
    if role not in AGENT_ROLES:
        role = "general"
    agent_data = {
        "name": name,
        "prompt": prompt,
        "role": role,
        "status": "idle",
        "created": datetime.now().isoformat()
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
                # 用主聊配置的 Tavily API Key
                tavily_key = ""
                try:
                    main_cfg = _get_main_chat_config(user_id)
                    # 从原始 JSON 中读取存储的 Tavily key
                    config_path = f"chat_data/config_user_{user_id}.json"
                    with open(config_path) as f:
                        raw_cfg = json.load(f)
                    stored = raw_cfg.get("searchApiKeyTavily", "") or raw_cfg.get("searchApiKey", "") or ""
                    if stored:
                        decrypted = _decrypt_xor(stored)
                        if decrypted:
                            tavily_key = decrypted
                except:
                    pass

                if not tavily_key:
                    return f"搜索出错: 未找到 Tavily API Key (请先在设置中配置搜索API Key)"

                r = requests.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": tavily_key,
                        "query": query,
                        "search_depth": "basic",
                        "max_results": 8,
                        "include_answer": False
                    },
                    timeout=15
                )
                data = r.json()
                results = data.get("results", [])
                if not results:
                    return f'搜索 "{query}" 无结果。请更换关键词重试。'

                lines = []
                for res in results[:8]:
                    title = res.get("title", "")
                    url = res.get("url", "")
                    content = res.get("content", "")[:200].replace("\n", " ")
                    content = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', content)
                    lines.append(f"- [{title}]({url})\n  {content}")
                return f"搜索结果 (query: {query}):\n" + "\n\n".join(lines) + "\n\n注: 如需查看详情请使用 web_fetch 工具抓取网页内容。"
            except Exception as e:
                return f"搜索出错: {str(e)}\n请稍后重试或更换关键词。"
        elif tool_name == "web_fetch":
            urls = []
            if args.get("url"): urls.append(args["url"])
            if args.get("urls"): urls.extend(args["urls"][:3])
            results = []
            for url in urls:
                try:
                    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
                    # ★ 修复:过滤控制字符+null字节,防止JSON序列化崩溃
                    raw = r.text
                    # 移除控制字符(保留换行和制表符)
                    raw = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', raw)
                    # 移除HTML标签,只保留文本
                    raw = re.sub(r'<[^>]+>', ' ', raw)
                    # 合并空白
                    raw = re.sub(r'\s+', ' ', raw).strip()
                    text = raw[:3000]  # 限制长度
                    results.append(f"[{url}]: {text}")
                except Exception as e:
                    results.append(f"[{url}]: 错误 - {str(e)}")
            return "\n\n".join(results) if results else "未提供URL"
        elif tool_name == "engine_push":
            msg = args.get("msg", "")
            if msg:
                push_store = get_ns("heartbeat", user_id)
                data = push_store.get()
                pending = data.get("pending_messages", [])
                pending.append({"msg": msg, "time": datetime.now().isoformat()})
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
                _r = requests.get(_engine_url, params=_params, timeout=30);
                _d = _r.json();
                return json.dumps(_d, ensure_ascii=False)
            except Exception as _e:
                return f"工具执行失败: {str(_e)}"
        return "未知工具"

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
            client = OpenAI(api_key=api_key, base_url=base_url, timeout=120)
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
                    tool_args = json.loads(tc.function.arguments)
                    result = _execute_tool(tool_name, tool_args)
                    # ★ 全局净化：移除所有控制字符和 unicode surrogate
                    if isinstance(result, str):
                        result = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', result)
                        if len(result) > 8000:
                            result = result[:8000] + '...(截断)'
                    result_parts.append(f"[工具: {tool_name}] {str(result)[:500]}")
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
        notify_store = get_ns("agent_notifications", user_id)
        notifs = notify_store.get()
        if not isinstance(notifs, list):
            notifs = []
        notifs.append({
            "agent": name,
            "status": agents[name]["status"],
            "result": agents[name].get("result", ""),
            "error": agents[name].get("error", ""),
            "time": datetime.now().isoformat(),
            "processed": False
        })
        # 裁剪超过50条的历史通知(防止内存泄漏)
        if len(notifs) > 50:
            notifs = notifs[-50:]
        notify_store.set(notifs)

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

ENCRYPTION_KEY = 'naujtrats-secret'

def _decrypt_xor(encoded: str) -> str:
    """XOR 解密(复刻前端 decrypt 函数)"""
    if not encoded:
        return ""
    try:
        bin_bytes = base64.b64decode(encoded)
        key_bytes = ENCRYPTION_KEY.encode('utf-8')
        result = bytearray(len(bin_bytes))
        for i in range(len(bin_bytes)):
            result[i] = bin_bytes[i] ^ key_bytes[i % len(key_bytes)]
        return result.decode('utf-8')
    except Exception:
        return None

def _get_main_chat_config(user_id: str) -> dict:
    """从主聊天配置读取 api_key / base_url / model
    自动 XOR 解密 apiKey,优先主聊配置,无值则返回空字符串。
    """
    result = {"api_key": "", "base_url": "", "model": ""}
    if not user_id:
        return result
    config_path = f"chat_data/config_user_{user_id}.json"
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



# ==================== 服务器操控工具 ====================
@app.get("/engine/exec")
def engine_exec(
    cmd: str = Query(...),
    timeout: int = Query(60),
    cwd: str = Query(""),
    user_id: str = Query("")
):
    """执行 shell 命令,返回 stdout/stderr/exit_code"""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=min(timeout, 300),
            cwd=cwd or None
        )
        return {
            "ok": True,
            "exit_code": result.returncode,
            "stdout": result.stdout[:8000] if result.stdout else "",
            "stderr": result.stderr[:2000] if result.stderr else ""
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"命令超时({timeout}秒)", "exit_code": -1}
    except Exception as e:
        return {"ok": False, "error": str(e), "exit_code": -1}

@app.get("/engine/python")
def engine_python(
    script: str = Query(...),
    timeout: int = Query(30),
    user_id: str = Query("")
):
    """执行 Python 脚本,返回输出"""
    import tempfile
    tf = tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, dir=str(TEMP_DIR))
    try:
        tf.write(script)
        tf.close()
        result = subprocess.run(
            ['python3', tf.name], capture_output=True, text=True,
            timeout=min(timeout, 120)
        )
        return {
            "ok": True,
            "exit_code": result.returncode,
            "stdout": result.stdout[:8000] if result.stdout else "",
            "stderr": result.stderr[:2000] if result.stderr else ""
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"脚本超时({timeout}秒)", "exit_code": -1}
    except Exception as e:
        return {"ok": False, "error": str(e), "exit_code": -1}
    finally:
        try: os.unlink(tf.name)
        except: pass

@app.get("/engine/file/read")
def engine_file_read(
    path: str = Query(...),
    max_lines: int = Query(200),
    user_id: str = Query("")
):
    """读取服务器上的文件内容"""
    try:
        p = Path(path).resolve()
        if not p.exists():
            return {"ok": False, "error": f"文件不存在: {path}"}
        if p.is_dir():
            items = []
            for item in sorted(p.iterdir()):
                t = "[DIR]" if item.is_dir() else "[FILE]"
                size = item.stat().st_size if item.is_file() else 0
                items.append(f"{t} {item.name} ({size} bytes)")
            return {"ok": True, "content": "\n".join(items[:max_lines])}
        content = p.read_text(encoding='utf8', errors='replace')
        lines = content.split('\n')
        total = len(lines)
        shown = lines[:max_lines]
        text = '\n'.join(shown)
        if total > max_lines:
            text += f'\n\n... (共 {total} 行,仅显示前 {max_lines} 行)'
        return {"ok": True, "content": text, "total_lines": total, "size": p.stat().st_size}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/engine/file/write")
def engine_file_write(
    path: str = Query(...),
    content: str = Query(...),
    append: bool = Query(False),
    user_id: str = Query("")
):
    """写入文件(默认覆盖,append=True 追加)"""
    try:
        # 安全检查:只允许写入 /tmp 和 /var/www/html/oneapichat
        resolved = Path(path).resolve()
        allowed = [TEMP_DIR.resolve(), Path(PROJECT_ROOT).resolve()]
        if not any(str(resolved).startswith(str(d)) for d in allowed):
            return {"ok": False, "error": f"写入权限受限,只允许 {[str(d) for d in allowed]}"}
        mode = 'a' if append else 'w'
        with open(resolved, mode, encoding='utf8') as f:
            f.write(content)
        return {"ok": True, "path": str(resolved), "written": len(content)}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/engine/sys/info")
def engine_sys_info(user_id: str = Query("")):
    """获取系统信息"""
    try:
        import platform
        disk = os.popen("df -h / | tail -1").read().strip()
        mem = os.popen("free -h | grep Mem").read().strip()
        cpu = os.popen("uptime").read().strip()
        ps_count = len(os.popen("ps aux --no-headers").read().strip().split('\n'))
        return {
            "ok": True,
            "hostname": platform.node(),
            "os": f"{platform.system()} {platform.release()}",
            "python": platform.python_version(),
            "cpu_uptime": cpu,
            "memory": mem,
            "disk": disk,
            "processes": ps_count,
            "time": datetime.now().isoformat()
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/engine/ps")
def engine_ps(user_id: str = Query("")):
    """列出服务器进程"""
    try:
        result = subprocess.run(["ps", "aux", "--sort=-%cpu"], capture_output=True, text=True, timeout=15)
        lines = result.stdout.split("\n")
        header = lines[:1]
        body = lines[1:21]
        return {"ok": True, "stdout": "\n".join(header + body), "total": len(lines) - 1}
    except Exception as e:
        return {"error": str(e)}


@app.get("/engine/disk")
def engine_disk():
    """磁盘使用情况"""
    try:
        result = subprocess.run(["df", "-h"], capture_output=True, text=True, timeout=10)
        return {"ok": True, "stdout": result.stdout}
    except Exception as e:
        return {"error": str(e)}


@app.get("/engine/docker")
def engine_docker(action: str = Query("ps"), user_id: str = Query("")):
    """Docker 操作"""
    try:
        if action == "ps":
            cmd = ["docker", "ps", "-a", "--format", "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"]
        elif action == "images":
            cmd = ["docker", "images"]
        elif action == "stats":
            cmd = ["docker", "stats", "--no-stream"]
        else:
            return {"error": f"Unknown action: {action}"}
        result = subprocess.run(["sudo"] + cmd, capture_output=True, text=True, timeout=15)
        return {"ok": True, "stdout": result.stdout, "stderr": result.stderr}
    except FileNotFoundError:
        return {"error": "Docker not available"}
    except Exception as e:
        return {"error": str(e)}


@app.get("/engine/db_query")
def engine_db_query(sql: str = Query(...), user_id: str = Query("")):
    """执行数据库查询"""
    import sqlite3
    try:
        db_path = str(Path(PROJECT_ROOT) / "api" / "learning_records.db")
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute(sql)
        rows = c.fetchall()
        cols = [desc[0] for desc in c.description] if c.description else []
        conn.close()
        return {"ok": True, "columns": cols, "rows": rows[:50], "total": len(rows)}
    except Exception as e:
        return {"error": str(e)}


@app.get("/engine/network")
def engine_network(target: str = Query(...), action: str = Query("ping"), timeout: int = Query(10)):
    """网络诊断"""
    try:
        if action == "ping":
            cmd = ["ping", "-c", "3", "-W", "3", target]
        elif action == "curl":
            cmd = ["curl", "-s", "--max-time", str(timeout), "-k", target]
        elif action == "port":
            result = subprocess.run(["ss", "-tlnp"], capture_output=True, text=True, timeout=10)
            lines = [l for l in result.stdout.split("\n") if target in l]
            return {"ok": True, "stdout": "\n".join(lines[:10])}
        else:
            return {"error": f"Unknown action: {action}"}
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5)
        return {"ok": True, "stdout": result.stdout[:2000], "stderr": result.stderr[:500]}
    except Exception as e:
        return {"error": str(e)}


@app.get("/engine/file_search")
def engine_file_search(pattern: str = Query(...), path: str = Query(PROJECT_ROOT), max_results: int = Query(30)):
    """搜索文件"""
    try:
        cmd = ["find", path, "-name", pattern, "-type", "f", "!", "-path", "*/node_modules/*", "!", "-path", "*/.git/*", "!", "-path", "*/__pycache__/*"]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        files = [f for f in result.stdout.strip().split("\n") if f][:max_results]
        return {"ok": True, "files": files, "total": len(files)}
    except Exception as e:
        return {"error": str(e)}


@app.get("/engine/file_op")
def engine_file_op(action: str = Query(...), src: str = Query(...), dst: str = Query("")):
    """文件操作"""
    import os as _os, shutil
    try:
        allowed = [str(TEMP_DIR), PROJECT_ROOT]
        def safe(p):
            return any(p.startswith(pre) for pre in allowed)
        if not safe(src) or (dst and not safe(dst)):
            return {"error": f"只允许操作 {TEMP_DIR} 和 {PROJECT_ROOT} 目录"}
        if action in ("cp", "copy"):
            shutil.copy2(src, dst)
        elif action in ("mv", "move"):
            shutil.move(src, dst)
        elif action == "rm":
            if _os.path.isdir(src):
                shutil.rmtree(src)
            else:
                _os.remove(src)
        elif action == "mkdir":
            _os.makedirs(src, exist_ok=True)
        else:
            return {"error": f"Unknown action: {action}"}
        return {"ok": True, "action": action}
    except Exception as e:
        return {"error": str(e)}


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

# ==================== 工作流引擎 ====================
# 工作流 = 有向无环图,子代理按顺序执行,前一步的输出可传给后一步

@app.get("/engine/workflow/create")
def workflow_create(
    name: str = Query(...),
    steps: str = Query(...),  # JSON数组: [{"role":"explorer","prompt":"搜索xx"},...]
    user_id: str = Query("")
):
    """创建工作流
    steps 示例: [{"role":"explorer","prompt":"搜索2026年AI新闻","output_key":"news"},{"role":"planner","prompt":"基于上一步结果制定方案","output_key":"plan"}]
    """
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    try:
        parsed_steps = json.loads(steps)
    except:
        return {"error": "steps 必须为有效 JSON 数组"}
    if not isinstance(parsed_steps, list) or len(parsed_steps) == 0:
        return {"error": "steps 必须为非空数组"}
    for i, step in enumerate(parsed_steps):
        if "role" not in step or "prompt" not in step:
            return {"error": f"第{i+1}步缺少 role 或 prompt"}
        if step["role"] not in AGENT_ROLES:
            step["role"] = "general"
        step.setdefault("output_key", f"step_{i}")

    workflows[name] = {
        "name": name,
        "steps": parsed_steps,
        "status": "created",
        "current_step": 0,
        "results": {},
        "errors": [],
        "created": datetime.now().isoformat()
    }
    wf_store.set(workflows)
    return {"ok": True, "workflow": name, "steps": len(parsed_steps)}

@app.get("/engine/workflow/run")
def workflow_run(
    name: str = Query(...),
    user_id: str = Query("")
):
    """运行工作流(异步后台执行)"""
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    wf = workflows.get(name)
    if not wf:
        return {"error": "工作流不存在"}
    if wf["status"] == "running":
        return {"error": "工作流正在运行中"}

    def _run_workflow():
        wf_store = get_ns("workflows", user_id)
        workflows = wf_store.get()
        wf = workflows.get(name)
        if not wf:
            return
        wf["status"] = "running"
        wf["current_step"] = 0
        wf["results"] = {}
        wf["errors"] = []
        wf_store.set(workflows)

        for i, step in enumerate(wf["steps"]):
            wf_store = get_ns("workflows", user_id)
            workflows = wf_store.get()
            wf = workflows.get(name)
            if not wf or wf["status"] == "cancelled":
                return

            # 替换 prompt 中的变量引用 {prev_output_key}
            prompt = step["prompt"]
            for key, val in wf["results"].items():
                prompt = prompt.replace("{" + key + "}", str(val)[:2000])

            # 创建临时子代理执行当前步骤
            step_agent_name = f"wf_{name}_step{i}_{datetime.now().strftime('%H%M%S')}"
            step_role = step.get("role", "general")

            # 用主配置创建子代理
            main_config = _get_main_chat_config(user_id)
            step_api_key = main_config.get("api_key", "") or os.getenv("OPENAI_API_KEY", "")
            if not step_api_key:
                wf["status"] = "failed"
                wf["errors"].append({"step": i, "error": "未配置API Key"})
                wf_store.set(workflows)
                return

            try:
                from openai import OpenAI
                client = OpenAI(api_key=step_api_key, timeout=120)
                step_tools = _filter_tools_by_role(step_role)
                messages = [{"role": "user", "content": prompt}]
                step_max_rounds = AGENT_ROLES.get(step_role, AGENT_ROLES["general"])["max_rounds"]
                step_result_parts = []
                step_model = main_config.get("model", "") or "MiniMax-M2.7"
                if "api.minimaxi.com" in step_model and "minimax" not in step_model.lower():
                    step_model = "MiniMax-M2.7"
                if AGENT_ROLES.get(step_role, {}).get("model_tier") == "cheap":
                    cheap_m = main_config.get("cheap_model", "")
                    if cheap_m:
                        step_model = cheap_m

                for round_num in range(step_max_rounds):
                    resp = client.chat.completions.create(
                        model=step_model,
                        messages=messages,
                        tools=step_tools if step_tools else None,
                        tool_choice="auto" if step_tools else None,
                        temperature=0.3,
                        max_tokens=2048,
                        timeout=120
                    )
                    msg = resp.choices[0].message
                    if msg.content:
                        cleaned = msg.content
                        if '<think>' in cleaned:
                            cleaned = re.sub(r'<think>.*?</think>', '', cleaned, flags=re.DOTALL).strip()
                        step_result_parts.append(cleaned)
                    if not msg.tool_calls:
                        break
                    asst_msg = {"role": "assistant", "content": msg.content}
                    msg_dict = msg.model_dump()
                    if hasattr(msg.tool_calls, 'model_dump'):
                        asst_msg["tool_calls"] = msg.tool_calls.model_dump()
                    else:
                        asst_msg["tool_calls"] = [{"id": tc.id, "type": tc.type, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in msg.tool_calls]
                    messages.append(asst_msg)
                    for tc in msg.tool_calls:
                        tool_name = tc.function.name
                        tool_args = json.loads(tc.function.arguments)
                        result_text = f"[步骤{i}:{step_role}] 调用 {tool_name}"
                        step_result_parts.append(f"[工具: {tool_name}]")
                        messages.append({"role": "tool", "tool_call_id": tc.id, "content": "工具已调用"})
                    # 保存中间进度
                    wf_store = get_ns("workflows", user_id)
                    workflows = wf_store.get()
                    wf = workflows.get(name, {})
                    wf["results"][step.get("output_key", f"step_{i}")] = "\n".join(step_result_parts)
                    wf["current_step"] = i
                    workflows[name] = wf
                    wf_store.set(workflows)

                step_output = "\n".join(step_result_parts)
            except Exception as e:
                step_output = f"[错误] 步骤{i}执行失败: {str(e)}"
                wf_store = get_ns("workflows", user_id)
                workflows = wf_store.get()
                wf = workflows.get(name, {})
                wf["errors"].append({"step": i, "error": str(e)})
                workflows[name] = wf
                wf_store.set(workflows)

            # 保存步骤结果
            wf_store = get_ns("workflows", user_id)
            workflows = wf_store.get()
            wf = workflows.get(name, {})
            wf["results"][step.get("output_key", f"step_{i}")] = step_output
            wf["current_step"] = i + 1
            workflows[name] = wf
            wf_store.set(workflows)

            # 工具调用通知
            push_store = get_ns("heartbeat", user_id)
            push_data = push_store.get()
            pending = push_data.get("pending_messages", [])
            pending.append({"msg": f"[工作流 {name}] 步骤{i+1}/{len(wf['steps'])} 完成 ({step_role})", "time": datetime.now().isoformat()})
            push_data["pending_messages"] = pending
            push_store.set(push_data)

        # 全部完成
        wf_store = get_ns("workflows", user_id)
        workflows = wf_store.get()
        wf = workflows.get(name, {})
        has_errors = len(wf.get("errors", [])) > 0
        wf["status"] = "failed" if has_errors else "completed"
        workflows[name] = wf
        wf_store.set(workflows)

        # 推送完成通知
        push_store = get_ns("heartbeat", user_id)
        push_data = push_store.get()
        pending = push_data.get("pending_messages", [])
        status = "完成" if wf["status"] == "completed" else "失败"
        pending.append({"msg": f"[工作流] {name} 执行{status}({len(wf['steps'])}步)", "time": datetime.now().isoformat()})
        push_data["pending_messages"] = pending
        push_store.set(push_data)

    t = threading.Thread(target=_run_workflow, name=f"wf_{user_id}_{name}", daemon=True)
    t.start()
    return {"ok": True, "workflow": name, "status": "running"}

@app.get("/engine/workflow/list")
def workflow_list(user_id: str = Query("")):
    wf_store = get_ns("workflows", user_id)
    return wf_store.get()

@app.get("/engine/workflow/status")
def workflow_status(name: str = Query(...), user_id: str = Query("")):
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    wf = workflows.get(name)
    if not wf:
        return {"error": "工作流不存在"}
    return wf

@app.get("/engine/workflow/delete")
def workflow_delete(name: str = Query(...), user_id: str = Query("")):
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    if name not in workflows:
        return {"ok": False, "error": "不存在"}
    del workflows[name]
    wf_store.set(workflows)
    return {"ok": True}

@app.get("/engine/workflow/roles")
def workflow_roles(user_id: str = Query("")):
    """返回可用角色列表(供前端下拉选择)"""
    return {"roles": [{"id": k, "label": v["label"], "desc": v["desc"]} for k, v in AGENT_ROLES.items()]}


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
            _start_cron_job(name, "")
            print(f"[引擎] Cron 已恢复(全局): {name}")
    # 恢复各用户的 cron
    for f in ENGINE_DIR.glob("user_*_cron.json"):
        try:
            uid = f.stem.split("_", 1)[1].rsplit("_", 1)[0]
            user_jobs = json.loads(f.read_text(encoding="utf8"))
            for name, job in user_jobs.items():
                if job.get("enabled"):
                    _start_cron_job(name, uid)
                    print(f"[引擎] Cron 已恢复(用户{uid}): {name}")
        except:
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
        except:
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
                                except:
                                    pass
                        if changed:
                            f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf8")
                    except:
                        pass
            except:
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
        client = OpenAI(api_key=request_data.get('api_key', ''),
                        base_url=request_data.get('base_url', '').strip().rstrip('/') or None)
        model = request_data.get('model', 'deepseek-chat')
        messages = request_data.get('messages', [])
        tools = request_data.get('tools', None)
        stream_params = {'model': model, 'messages': messages, 'stream': True}
        if tools:
            stream_params['tools'] = tools
        if request_data.get('reasoning'):
            stream_params['reasoning'] = request_data.get('reasoning')
        # 发送初始事件
        yield sse_event(json.dumps({'type': 'start', 'msg_id': msg_id}))

        stream = client.chat.completions.create(**stream_params)
        for chunk in stream:
            delta = chunk.choices[0].delta
            seq += 1

            # 内容增量
            content_delta = delta.content or ''
            if content_delta:
                full_text += content_delta
                store.write_chunk(msg_id, 'content', content_delta)
                yield sse_event(json.dumps({'type': 'content', 'delta': content_delta, 'seq': seq}))

            # 思考增量
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
                except:
                    try:
                        usage = json.loads(chunk.usage.model_dump_json())
                    except:
                        usage = dict(chunk.usage)

        # 流结束
        store.finish_stream(msg_id, full_text, reasoning_text, tool_calls, usage)
        yield sse_event(json.dumps({'type': 'done', 'full_text': full_text, 'reasoning_text': reasoning_text,
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
    except:
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


# ==================== Agent 记忆/人格/身份/心跳 系统 ====================

MEMORY_DIR = ENGINE_DIR / "memory"
MEMORY_DIR.mkdir(parents=True, exist_ok=True)

def _get_memory_file(filename: str, user_id: str = "") -> Path:
    """获取用户隔离的记忆文件路径"""
    if user_id:
        return MEMORY_DIR / f"user_{user_id}_{filename}"
    return MEMORY_DIR / filename


def _read_memory_json(filename: str, user_id: str = "") -> dict:
    """读取记忆文件,返回 dict"""
    fp = _get_memory_file(filename, user_id)
    try:
        return json.loads(fp.read_text(encoding="utf8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write_memory_json(filename: str, data: dict, user_id: str = "") -> bool:
    """原子写入记忆文件"""
    fp = _get_memory_file(filename, user_id)
    tmp = fp.with_suffix('.tmp')
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf8")
        tmp.replace(fp)
        return True
    except Exception as e:
        print(f"[AgentMemory] 写入失败 {filename}: {e}")
        return False


# ── 人格 API ──────────────────────────────────────

@app.post("/engine/agent/persona/save")
async def agent_persona_save(request: Request, user_id: str = Query("")):
    """保存 Agent 人格定义"""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "无效的 JSON 请求体")
    if not body or not isinstance(body, dict):
        raise HTTPException(400, "body 必须为非空 JSON 对象")
    body["updated_at"] = datetime.now().isoformat()
    if not body.get("created_at"):
        body["created_at"] = body["updated_at"]
    ok = _write_memory_json("agent_persona.json", body, user_id)
    return {"ok": ok, "updated_at": body["updated_at"]}


@app.get("/engine/agent/persona/load")
def agent_persona_load(user_id: str = Query("")):
    """加载 Agent 人格定义"""
    data = _read_memory_json("agent_persona.json", user_id)
    if not data:
        data = {"name": "AI助手", "style": "简洁、直接、实用", "preferences": {"language": "zh-CN", "response_style": "concise"}, "updated_at": ""}
    return {"ok": True, "persona": data}


# ── 记忆 API ──────────────────────────────────────

@app.post("/engine/agent/memory/save")
async def agent_memory_save(request: Request, user_id: str = Query("")):
    """保存一条记忆条目"""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "无效的 JSON 请求体")
    if not body or not isinstance(body, dict):
        raise HTTPException(400, "body 必须为非空 JSON 对象")
    key = body.get("key", "")
    content = body.get("content", "")
    tags = body.get("tags", [])
    if not key or not content:
        raise HTTPException(400, "key 和 content 不能为空")
    data = _read_memory_json("agent_memory.json", user_id)
    if "entries" not in data:
        data["entries"] = []
    found = False
    for entry in data["entries"]:
        if entry.get("key") == key:
            entry["content"] = content
            entry["tags"] = tags if isinstance(tags, list) else []
            entry["updated_at"] = datetime.now().isoformat()
            found = True
            break
    if not found:
        data["entries"].append({"key": key, "content": content, "tags": tags if isinstance(tags, list) else [], "created_at": datetime.now().isoformat(), "updated_at": datetime.now().isoformat()})
    data["updated_at"] = datetime.now().isoformat()
    if not data.get("created_at"):
        data["created_at"] = data["updated_at"]
    data["version"] = data.get("version", 1)
    ok = _write_memory_json("agent_memory.json", data, user_id)
    return {"ok": ok, "key": key, "entries_count": len(data["entries"])}


@app.get("/engine/agent/memory/load")
def agent_memory_load(query: str = Query(""), user_id: str = Query("")):
    """加载记忆,支持关键词模糊匹配"""
    data = _read_memory_json("agent_memory.json", user_id)
    entries = data.get("entries", [])
    if query:
        q = query.lower()
        matched = [e for e in entries if q in e.get("key", "").lower() or q in e.get("content", "").lower() or any(q in (tag or "").lower() for tag in e.get("tags", []))]
        return {"ok": True, "entries": matched, "total": len(matched), "query": query}
    return {"ok": True, "entries": entries, "total": len(entries)}


# ── 用户身份 API ──────────────────────────────────

@app.post("/engine/agent/identity/save")
async def agent_identity_save(request: Request, user_id: str = Query("")):
    """保存用户身份信息"""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "无效的 JSON 请求体")
    if not body or not isinstance(body, dict):
        raise HTTPException(400, "body 必须为非空 JSON 对象")
    body["updated_at"] = datetime.now().isoformat()
    if not body.get("created_at"):
        body["created_at"] = body["updated_at"]
    if not body.get("name") and user_id:
        body["name"] = f"User({user_id[:12]})"
    ok = _write_memory_json("agent_identity.json", body, user_id)
    return {"ok": ok, "updated_at": body["updated_at"]}


@app.get("/engine/agent/identity/load")
def agent_identity_load(user_id: str = Query("")):
    """加载用户身份信息"""
    data = _read_memory_json("agent_identity.json", user_id)
    if not data:
        data = {"name": "", "timezone": "Asia/Shanghai", "language": "zh-CN", "notes": ""}
    return {"ok": True, "identity": data}


# ── 心跳 API ──────────────────────────────────────

@app.post("/engine/agent/heartbeat")
async def agent_heartbeat(request: Request, user_id: str = Query("")):
    """更新 Agent 心跳状态"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    state = body.get("state", "active")
    mood = body.get("mood", "neutral")
    data = _read_memory_json("agent_heartbeat.json", user_id)
    data["state"] = state
    data["mood"] = mood
    data["last_seen"] = time.time()
    data["updated_at"] = datetime.now().isoformat()
    data["conversation_count"] = data.get("conversation_count", 0) + (1 if state == "active" else 0)
    if body.get("chat_id"):
        data["last_active_chat"] = body["chat_id"]
    if body.get("pending_tasks"):
        data["pending_tasks"] = body["pending_tasks"]
    ok = _write_memory_json("agent_heartbeat.json", data, user_id)
    return {"ok": ok, "state": state, "last_seen": data["last_seen"]}


@app.get("/engine/agent/heartbeat/status")
def agent_heartbeat_status(user_id: str = Query("")):
    """读取 Agent 心跳状态"""
    data = _read_memory_json("agent_heartbeat.json", user_id)
    if not data:
        data = {"state": "idle", "last_seen": 0, "conversation_count": 0}
    now = time.time()
    last_seen = data.get("last_seen", 0)
    if last_seen and (now - last_seen) > 300:
        data["state"] = "idle"
    data["_age_seconds"] = int(now - last_seen) if last_seen else -1
    return {"ok": True, "heartbeat": data}


@app.get("/engine/agent/memory/delete")
def agent_memory_delete(key: str = Query(...), user_id: str = Query("")):
    """删除一条记忆条目"""
    data = _read_memory_json("agent_memory.json", user_id)
    entries = data.get("entries", [])
    before = len(entries)
    data["entries"] = [e for e in entries if e.get("key") != key]
    removed = before - len(data["entries"])
    if removed > 0:
        data["updated_at"] = datetime.now().isoformat()
        _write_memory_json("agent_memory.json", data, user_id)
    return {"ok": True, "removed": removed}


# ==================== 浏览器工具 ====================

@app.on_event("startup")
async def _startup_browser():
    """启动时初始化浏览器连接并注册浏览器工具"""
    # 注册浏览器工具到全局注册表
    try:
        from engine.tool_registry import register_browser_tools
        register_browser_tools(tool_registry)
        print("[引擎] 浏览器工具已注册")
    except Exception as e:
        print(f"[引擎] 浏览器工具注册失败: {e}")
    # 连接浏览器
    try:
        from engine.browser import get_browser_manager
        bm = get_browser_manager()
        await bm.connect()
        print("[引擎] 浏览器管理器已初始化")
    except Exception as e:
        print(f"[引擎] 浏览器管理器初始化失败(可忽略): {e}")


@app.get("/engine/browser/status")
async def browser_status():
    """浏览器连接状态"""
    from engine.browser import get_browser_manager
    bm = get_browser_manager()
    try:
        if not bm._connected:
            await bm.connect()
        return {"ok": True, "connected": True, "cdp": bm.cdp_url}
    except Exception as e:
        return {"ok": False, "connected": False, "error": str(e)}


@app.post("/engine/browser/navigate")
async def browser_navigate(request: Request):
    body = await request.json()
    url = body.get("url", "")
    if not url:
        return {"ok": False, "error": "缺少 url 参数"}
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.navigate(url)
    return result


@app.get("/engine/browser/screenshot")
async def browser_screenshot():
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.screenshot()
    return result


@app.post("/engine/browser/click")
async def browser_click(request: Request):
    body = await request.json()
    selector = body.get("selector", "")
    if not selector:
        return {"ok": False, "error": "缺少 selector 参数"}
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.click(selector)
    return result


@app.post("/engine/browser/type")
async def browser_type(request: Request):
    body = await request.json()
    selector = body.get("selector", "")
    text = body.get("text", "")
    if not selector:
        return {"ok": False, "error": "缺少 selector 参数"}
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.type_text(selector, text)
    return result


@app.get("/engine/browser/content")
async def browser_content():
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.get_content()
    return result


@app.get("/engine/browser/snapshot")
async def browser_snapshot():
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.get_snapshot()
    return result


@app.post("/engine/browser/js")
async def browser_js(request: Request):
    body = await request.json()
    code = body.get("code", "")
    if not code:
        return {"ok": False, "error": "缺少 code 参数"}
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.execute_js(code)
    return result


@app.post("/engine/browser/page/new")
async def browser_page_new():
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.new_page()
    return result


@app.post("/engine/browser/page/close")
async def browser_page_close():
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.close_page()
    return result


if __name__ == "__main__":
    port = int(os.getenv("ENGINE_PORT", "8766"))
    print(f"[引擎] 启动 http://0.0.0.0:{port}")
    print(f"[引擎] Cron 任务: {list(cron_store.get().keys())}")
    print(f"[引擎] 子代理: {list(agent_store.get().keys())}")
    uvicorn.run(app, host="0.0.0.0", port=port)
