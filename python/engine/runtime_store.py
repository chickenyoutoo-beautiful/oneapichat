"""Durable, event-sourced runtime primitives inspired by DeepSeek Harness.

This module is intentionally framework-neutral. FastAPI routes live in runtime_api.py;
chat and subagent runners append lifecycle events here. The existing mutable chat
JSON remains a compatibility projection while this store becomes the durable source
for turn, job, goal, and child-agent state.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from engine.agent_errors import AgentRuntimeError, ErrorCode, redact_secrets


RUNTIME_FORMAT_VERSION = 1
PROJECTION_STATE_VERSION = 1
KNOWN_EVENT_TYPES = {
    "turn/start", "turn/end", "step/start", "step/end", "user/message",
    "assistant/chunk", "assistant/message", "tool/call", "tool/result",
    "todo/write", "request/header", "request/context", "session/end-seed",
    "goal/change", "job/change", "subagent/change", "session/error",
}
TERMINAL_JOB_STATES = {"completed", "failed", "cancelled", "interrupted"}
TERMINAL_SUBAGENT_STATES = {"completed", "failed", "cancelled", "interrupted", "deleted"}


def _json_detach(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))
    except (TypeError, ValueError) as exc:
        raise AgentRuntimeError(
            ErrorCode.BAD_REQUEST,
            f"runtime data must be lossless JSON: {exc}",
            status=400,
        ) from exc


def _json_dump(value: Any) -> str:
    return json.dumps(_json_detach(value), ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _json_load(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def _now() -> float:
    return time.time()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


@dataclass(frozen=True)
class RuntimeEvent:
    session_id: str
    seq: int
    time: float
    type: str
    data: dict[str, Any]
    ignorable: bool = False
    surface_op: Optional[dict[str, Any] | str] = None
    source_event_seqs: tuple[int, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "session_id": self.session_id,
            "seq": self.seq,
            "time": self.time,
            "type": self.type,
            "data": _json_detach(self.data),
        }
        if self.ignorable:
            result["ignorable"] = True
        if self.surface_op is not None:
            result["surface_op"] = _json_detach(self.surface_op)
        if self.source_event_seqs:
            result["source_event_seqs"] = list(self.source_event_seqs)
        return result


class AgentRuntimeStore:
    """SQLite event log plus projections, jobs, goals, and subagent descriptors."""

    def __init__(self, engine_dir: str | Path):
        self.engine_dir = Path(engine_dir)
        self.engine_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.engine_dir / "agent_runtime.db"
        self._write_lock = threading.RLock()
        self._conditions: dict[str, threading.Condition] = {}
        self._conditions_lock = threading.RLock()
        self._delta_lock = threading.RLock()
        self._delta_buffers: dict[str, dict[str, Any]] = {}
        self._goal_activation: dict[str, str] = {}
        self._init_db()
        self.repair_interrupted_sessions()
        self.recover_incomplete_work()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _secure_files(self) -> None:
        for suffix in ("", "-wal", "-shm"):
            path = Path(str(self.db_path) + suffix)
            try:
                if path.exists():
                    os.chmod(path, 0o600)
            except OSError:
                pass

    def _init_db(self) -> None:
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS runtime_sessions (
                        session_id TEXT PRIMARY KEY,
                        version INTEGER NOT NULL,
                        user_id TEXT NOT NULL,
                        chat_id TEXT NOT NULL,
                        parent_session_id TEXT,
                        origin TEXT NOT NULL DEFAULT 'chat',
                        delegation_depth INTEGER NOT NULL DEFAULT 0,
                        provider TEXT NOT NULL DEFAULT '',
                        model TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL DEFAULT 'idle',
                        last_seq INTEGER NOT NULL DEFAULT -1,
                        created_at REAL NOT NULL,
                        updated_at REAL NOT NULL,
                        UNIQUE(user_id, chat_id),
                        FOREIGN KEY(parent_session_id) REFERENCES runtime_sessions(session_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_runtime_sessions_user_updated
                        ON runtime_sessions(user_id, updated_at DESC);

                    CREATE TABLE IF NOT EXISTS runtime_events (
                        session_id TEXT NOT NULL,
                        seq INTEGER NOT NULL,
                        time REAL NOT NULL,
                        type TEXT NOT NULL,
                        ignorable INTEGER NOT NULL DEFAULT 0,
                        data_json TEXT NOT NULL,
                        surface_json TEXT,
                        source_event_seqs_json TEXT,
                        PRIMARY KEY(session_id, seq),
                        FOREIGN KEY(session_id) REFERENCES runtime_sessions(session_id) ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_runtime_events_time ON runtime_events(time);

                    CREATE TABLE IF NOT EXISTS runtime_projections (
                        session_id TEXT PRIMARY KEY,
                        state_version INTEGER NOT NULL,
                        watermark INTEGER NOT NULL DEFAULT -1,
                        state_json TEXT NOT NULL,
                        updated_at REAL NOT NULL,
                        FOREIGN KEY(session_id) REFERENCES runtime_sessions(session_id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS runtime_jobs (
                        job_id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        session_id TEXT,
                        kind TEXT NOT NULL,
                        status TEXT NOT NULL,
                        payload_json TEXT NOT NULL DEFAULT '{}',
                        result_json TEXT,
                        error_json TEXT,
                        cancel_requested INTEGER NOT NULL DEFAULT 0,
                        reported INTEGER NOT NULL DEFAULT 0,
                        created_at REAL NOT NULL,
                        started_at REAL,
                        finished_at REAL,
                        updated_at REAL NOT NULL,
                        FOREIGN KEY(session_id) REFERENCES runtime_sessions(session_id) ON DELETE SET NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_runtime_jobs_owner
                        ON runtime_jobs(user_id, session_id, updated_at DESC);

                    CREATE TABLE IF NOT EXISTS runtime_goals (
                        goal_id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        session_id TEXT NOT NULL,
                        revision INTEGER NOT NULL,
                        objective TEXT NOT NULL,
                        phase TEXT NOT NULL,
                        rounds_started INTEGER NOT NULL DEFAULT 0,
                        max_goal_rounds INTEGER NOT NULL DEFAULT 8,
                        blocked_reason_json TEXT,
                        created_at REAL NOT NULL,
                        updated_at REAL NOT NULL,
                        FOREIGN KEY(session_id) REFERENCES runtime_sessions(session_id) ON DELETE CASCADE
                    );
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_goals_active_session
                        ON runtime_goals(session_id) WHERE phase IN ('active','paused','blocked');

                    CREATE TABLE IF NOT EXISTS runtime_subagents (
                        agent_id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        parent_session_id TEXT,
                        child_session_id TEXT NOT NULL,
                        label TEXT NOT NULL,
                        role TEXT NOT NULL DEFAULT 'general',
                        provider TEXT NOT NULL DEFAULT '',
                        model TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL,
                        prompt TEXT NOT NULL,
                        inbox_json TEXT NOT NULL DEFAULT '[]',
                        result_json TEXT,
                        error_json TEXT,
                        cancel_requested INTEGER NOT NULL DEFAULT 0,
                        created_at REAL NOT NULL,
                        started_at REAL,
                        finished_at REAL,
                        updated_at REAL NOT NULL,
                        FOREIGN KEY(parent_session_id) REFERENCES runtime_sessions(session_id) ON DELETE SET NULL,
                        FOREIGN KEY(child_session_id) REFERENCES runtime_sessions(session_id) ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_runtime_subagents_parent
                        ON runtime_subagents(user_id, parent_session_id, updated_at DESC);
                    """
                )
            finally:
                conn.close()
            self._secure_files()

    def _condition(self, session_id: str) -> threading.Condition:
        with self._conditions_lock:
            condition = self._conditions.get(session_id)
            if condition is None:
                condition = threading.Condition()
                self._conditions[session_id] = condition
            return condition

    def _notify(self, session_id: str) -> None:
        condition = self._condition(session_id)
        with condition:
            condition.notify_all()

    def ensure_session(
        self,
        user_id: str,
        chat_id: str,
        *,
        parent_session_id: Optional[str] = None,
        origin: str = "chat",
        delegation_depth: int = 0,
        provider: str = "",
        model: str = "",
    ) -> dict[str, Any]:
        user_id = str(user_id or "").strip()
        chat_id = str(chat_id or "").strip()
        if not user_id or not chat_id:
            raise AgentRuntimeError(ErrorCode.BAD_REQUEST, "user_id and chat_id are required", status=400)
        now = _now()
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute(
                    "SELECT * FROM runtime_sessions WHERE user_id=? AND chat_id=?", (user_id, chat_id)
                ).fetchone()
                if row:
                    conn.execute(
                        """UPDATE runtime_sessions SET provider=CASE WHEN ?<>'' THEN ? ELSE provider END,
                           model=CASE WHEN ?<>'' THEN ? ELSE model END, updated_at=? WHERE session_id=?""",
                        (provider, provider, model, model, now, row["session_id"]),
                    )
                    conn.commit()
                    return self._session_dict(dict(row) | {"provider": provider or row["provider"], "model": model or row["model"], "updated_at": now})
                session_id = _new_id("session")
                conn.execute(
                    """INSERT INTO runtime_sessions
                       (session_id,version,user_id,chat_id,parent_session_id,origin,delegation_depth,
                        provider,model,status,last_seq,created_at,updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,'idle',-1,?,?)""",
                    (
                        session_id, RUNTIME_FORMAT_VERSION, user_id, chat_id, parent_session_id,
                        origin, max(0, int(delegation_depth)), provider or "", model or "", now, now,
                    ),
                )
                projection = self._initial_projection(session_id, user_id, chat_id)
                conn.execute(
                    "INSERT INTO runtime_projections(session_id,state_version,watermark,state_json,updated_at) VALUES (?,?,?,?,?)",
                    (session_id, PROJECTION_STATE_VERSION, -1, _json_dump(projection), now),
                )
                conn.commit()
                return self.get_session(session_id, user_id=user_id)
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()

    def fork_session(
        self,
        user_id: str,
        parent_session_id: str,
        label: str,
        *,
        provider: str = "",
        model: str = "",
    ) -> dict[str, Any]:
        parent = self.get_session(parent_session_id, user_id=user_id)
        chat_id = f"_agent_sub_{uuid.uuid4().hex[:16]}"
        return self.ensure_session(
            user_id,
            chat_id,
            parent_session_id=parent_session_id,
            origin="subagent",
            delegation_depth=int(parent.get("delegation_depth", 0)) + 1,
            provider=provider,
            model=model,
        ) | {"label": label}

    @staticmethod
    def _session_dict(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "session_id": row["session_id"],
            "version": int(row.get("version", RUNTIME_FORMAT_VERSION)),
            "user_id": row["user_id"],
            "chat_id": row["chat_id"],
            "parent_session_id": row.get("parent_session_id"),
            "origin": row.get("origin", "chat"),
            "delegation_depth": int(row.get("delegation_depth", 0)),
            "provider": row.get("provider", ""),
            "model": row.get("model", ""),
            "status": row.get("status", "idle"),
            "last_seq": int(row.get("last_seq", -1)),
            "created_at": float(row.get("created_at", 0)),
            "updated_at": float(row.get("updated_at", 0)),
        }

    def get_session(self, session_id: str, *, user_id: Optional[str] = None) -> dict[str, Any]:
        conn = self._conn()
        try:
            if user_id:
                row = conn.execute(
                    "SELECT * FROM runtime_sessions WHERE session_id=? AND user_id=?", (session_id, user_id)
                ).fetchone()
            else:
                row = conn.execute("SELECT * FROM runtime_sessions WHERE session_id=?", (session_id,)).fetchone()
        finally:
            conn.close()
        if not row:
            raise AgentRuntimeError(ErrorCode.SESSION_NOT_FOUND, "runtime session not found", status=404)
        return self._session_dict(dict(row))

    def find_session(self, user_id: str, chat_id: str) -> Optional[dict[str, Any]]:
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM runtime_sessions WHERE user_id=? AND chat_id=?", (user_id, chat_id)
            ).fetchone()
        finally:
            conn.close()
        return self._session_dict(dict(row)) if row else None

    def list_sessions(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM runtime_sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT ?",
                (user_id, max(1, min(int(limit), 200))),
            ).fetchall()
        finally:
            conn.close()
        return [self._session_dict(dict(row)) for row in rows]

    @staticmethod
    def _initial_projection(session_id: str, user_id: str, chat_id: str) -> dict[str, Any]:
        return {
            "state_version": PROJECTION_STATE_VERSION,
            "session_id": session_id,
            "user_id": user_id,
            "chat_id": chat_id,
            "watermark": -1,
            "status": "idle",
            "turn": None,
            "step": None,
            "messages": [],
            "tools": [],
            "todos": [],
            "goal": None,
            "jobs": {},
            "subagents": {},
            "streaming": {"content": "", "reasoning": ""},
            "usage": {},
            "request_header": None,
            "error": None,
            "updated_at": _now(),
        }

    @staticmethod
    def _normalize_message(data: dict[str, Any], default_role: str) -> dict[str, Any]:
        message = data.get("message") if isinstance(data.get("message"), dict) else {}
        result = dict(message)
        result.setdefault("id", data.get("message_id") or _new_id("message"))
        result.setdefault("role", default_role)
        if "content" not in result:
            result["content"] = data.get("content", "")
        result.setdefault("time", data.get("time") or _now())
        if data.get("reasoning") and not result.get("reasoning"):
            result["reasoning"] = data["reasoning"]
        if data.get("tool_calls") and not result.get("tool_calls"):
            result["tool_calls"] = data["tool_calls"]
        return _json_detach(result)

    @staticmethod
    def _tool_call_message(call_id: str, data: dict[str, Any]) -> dict[str, Any]:
        raw_args = data.get("arguments", "")
        if not isinstance(raw_args, str):
            raw_args = json.dumps(raw_args or {}, ensure_ascii=False, separators=(",", ":"))
        return {
            "id": call_id,
            "type": "function",
            "function": {
                "name": str(data.get("name") or ""),
                "arguments": raw_args or "{}",
            },
        }

    @classmethod
    def _ensure_tool_call_message(cls, state: dict[str, Any], call_id: str, data: dict[str, Any]) -> dict[str, Any]:
        messages = state.setdefault("messages", [])
        assistant = None
        for message in reversed(messages):
            if isinstance(message, dict) and message.get("role") == "assistant":
                assistant = message
                break
        if assistant is None:
            assistant = {"role": "assistant", "content": "", "tool_calls": []}
            messages.append(assistant)
        calls = assistant.get("tool_calls")
        if not isinstance(calls, list):
            calls = []
            assistant["tool_calls"] = calls
        for call in calls:
            if isinstance(call, dict) and str(call.get("id") or "") == call_id:
                return assistant
        calls.append(cls._tool_call_message(call_id, data))
        return assistant

    @classmethod
    def _upsert_tool_result_message(cls, state: dict[str, Any], call_id: str, data: dict[str, Any]) -> None:
        if not call_id:
            return
        result = data.get("result") if "result" in data else data.get("content")
        if result is None and data.get("error") is not None:
            result = data.get("error")
        if not isinstance(result, str):
            result = json.dumps(result if result is not None else "", ensure_ascii=False, separators=(",", ":"))
        messages = state.setdefault("messages", [])
        for message in messages:
            if isinstance(message, dict) and message.get("role") == "tool" and str(message.get("tool_call_id") or "") == call_id:
                message["content"] = result
                return
        messages.append({"role": "tool", "tool_call_id": call_id, "content": result})

    def _apply_projection(self, state: dict[str, Any], event: RuntimeEvent) -> dict[str, Any]:
        state = _json_detach(state)
        if not isinstance(state.get("messages"), list):
            state["messages"] = []
        if not isinstance(state.get("tools"), list):
            state["tools"] = []
        event_type = event.type
        data = event.data
        state["watermark"] = event.seq
        state["updated_at"] = event.time

        if event_type == "turn/start":
            state["turn"] = data.get("turn") or data.get("turn_id") or event.seq
            state["status"] = "running"
            state["error"] = None
        elif event_type == "step/start":
            state["step"] = data.get("step") or data.get("step_id") or event.seq
        elif event_type == "user/message":
            state["messages"].append(self._normalize_message(data, "user"))
        elif event_type == "assistant/chunk":
            state["streaming"]["content"] += str(data.get("content_delta") or data.get("text") or "")
            state["streaming"]["reasoning"] += str(data.get("reasoning_delta") or "")
        elif event_type == "assistant/message":
            state["messages"].append(self._normalize_message(data, "assistant"))
            state["streaming"] = {"content": "", "reasoning": ""}
            if isinstance(data.get("usage"), dict):
                state["usage"] = _json_detach(data["usage"])
        elif event_type == "tool/call":
            call_id = str(data.get("call_id") or data.get("id") or _new_id("call"))
            state["tools"].append({
                "call_id": call_id,
                "name": str(data.get("name") or ""),
                "arguments": data.get("arguments", ""),
                "status": "running",
                "seq": event.seq,
            })
            # Keep the compatibility projection provider-valid: tool/call events
            # belong to the latest assistant turn and must be represented in its
            # assistant.tool_calls array before the matching result is projected.
            self._ensure_tool_call_message(state, call_id, data)
        elif event_type == "tool/result":
            call_id = str(data.get("call_id") or data.get("tool_call_id") or "")
            found = False
            for tool in reversed(state["tools"]):
                if tool.get("call_id") == call_id:
                    tool["status"] = "failed" if data.get("error") else "completed"
                    tool["result"] = data.get("result") if "result" in data else data.get("content")
                    tool["error"] = data.get("error")
                    tool["result_seq"] = event.seq
                    found = True
                    break
            if not found:
                state["tools"].append({
                    "call_id": call_id,
                    "name": str(data.get("name") or ""),
                    "status": "failed" if data.get("error") else "completed",
                    "result": data.get("result") if "result" in data else data.get("content"),
                    "error": data.get("error"),
                    "result_seq": event.seq,
                })
            # Project the result into the ordered OpenAI message stream instead of
            # keeping it only in state.tools. This closes the crash-between-events
            # gap during refresh/reconstruction.
            self._upsert_tool_result_message(state, call_id, data)
        elif event_type == "todo/write":
            state["todos"] = _json_detach(data.get("todos") or [])
        elif event_type == "request/header":
            state["request_header"] = _json_detach(data)
        elif event_type == "goal/change":
            state["goal"] = _json_detach(data.get("goal") or data)
        elif event_type == "job/change":
            job = _json_detach(data.get("job") or data)
            if job.get("job_id"):
                state["jobs"][job["job_id"]] = job
        elif event_type == "subagent/change":
            child = _json_detach(data.get("subagent") or data)
            if child.get("agent_id"):
                state["subagents"][child["agent_id"]] = child
        elif event_type == "session/error":
            state["error"] = _json_detach(data.get("error") or data)
        elif event_type == "step/end":
            state["step"] = None
        elif event_type == "turn/end":
            reason = data.get("reason") or {}
            kind = reason.get("kind") if isinstance(reason, dict) else str(reason)
            if kind in {"completed", "max-tokens"}:
                state["status"] = "completed"
            elif kind in {"aborted", "cancelled"}:
                state["status"] = "cancelled"
            elif kind == "blocked":
                state["status"] = "blocked"
            elif kind == "interrupted":
                state["status"] = "interrupted"
            else:
                state["status"] = "failed" if kind == "error" else (kind or "completed")
            state["turn"] = None
            state["step"] = None
            state["streaming"] = {"content": "", "reasoning": ""}

        if len(state["messages"]) > 500:
            removed = len(state["messages"]) - 500
            state["messages"] = state["messages"][-500:]
            state["truncated_messages"] = int(state.get("truncated_messages", 0)) + removed
        if len(state["tools"]) > 1000:
            state["tools"] = state["tools"][-1000:]
        if len(state["jobs"]) > 200:
            keep = list(state["jobs"].items())[-200:]
            state["jobs"] = dict(keep)
        if len(state["subagents"]) > 200:
            keep = list(state["subagents"].items())[-200:]
            state["subagents"] = dict(keep)
        return state

    def append_event(
        self,
        session_id: str,
        event_type: str,
        data: Optional[dict[str, Any]] = None,
        *,
        ignorable: bool = False,
        surface_op: Optional[dict[str, Any] | str] = None,
        source_event_seqs: Optional[list[int] | tuple[int, ...]] = None,
        event_time: Optional[float] = None,
    ) -> RuntimeEvent:
        if event_type not in KNOWN_EVENT_TYPES and not ignorable:
            raise AgentRuntimeError(
                ErrorCode.BAD_REQUEST,
                f"unknown non-ignorable runtime event type: {event_type}",
                status=400,
            )
        detached = _json_detach(data or {})
        surface = _json_detach(surface_op) if surface_op is not None else None
        sources = tuple(int(value) for value in (source_event_seqs or ()))
        event_time = float(event_time or _now())
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                session = conn.execute(
                    "SELECT user_id,chat_id,last_seq FROM runtime_sessions WHERE session_id=?", (session_id,)
                ).fetchone()
                if not session:
                    raise AgentRuntimeError(ErrorCode.SESSION_NOT_FOUND, "runtime session not found", status=404)
                seq = int(session["last_seq"]) + 1
                event = RuntimeEvent(
                    session_id=session_id,
                    seq=seq,
                    time=event_time,
                    type=event_type,
                    data=detached,
                    ignorable=ignorable,
                    surface_op=surface,
                    source_event_seqs=sources,
                )
                conn.execute(
                    """INSERT INTO runtime_events
                       (session_id,seq,time,type,ignorable,data_json,surface_json,source_event_seqs_json)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    (
                        session_id, seq, event_time, event_type, 1 if ignorable else 0,
                        _json_dump(detached), _json_dump(surface) if surface is not None else None,
                        _json_dump(list(sources)) if sources else None,
                    ),
                )
                projection_row = conn.execute(
                    "SELECT state_json FROM runtime_projections WHERE session_id=?", (session_id,)
                ).fetchone()
                projection = _json_load(projection_row["state_json"], self._initial_projection(session_id, session["user_id"], session["chat_id"])) if projection_row else self._initial_projection(session_id, session["user_id"], session["chat_id"])
                projection = self._apply_projection(projection, event)
                conn.execute(
                    """INSERT INTO runtime_projections(session_id,state_version,watermark,state_json,updated_at)
                       VALUES (?,?,?,?,?)
                       ON CONFLICT(session_id) DO UPDATE SET
                         state_version=excluded.state_version,watermark=excluded.watermark,
                         state_json=excluded.state_json,updated_at=excluded.updated_at""",
                    (session_id, PROJECTION_STATE_VERSION, seq, _json_dump(projection), event_time),
                )
                conn.execute(
                    "UPDATE runtime_sessions SET last_seq=?,status=?,updated_at=? WHERE session_id=?",
                    (seq, projection.get("status", "idle"), event_time, session_id),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
                self._secure_files()
        self._notify(session_id)
        return event

    def append_stream_delta(
        self,
        session_id: str,
        *,
        content_delta: str = "",
        reasoning_delta: str = "",
        flush: bool = False,
    ) -> Optional[RuntimeEvent]:
        if not content_delta and not reasoning_delta and not flush:
            return None
        now = _now()
        with self._delta_lock:
            buffer = self._delta_buffers.setdefault(
                session_id,
                {"content": "", "reasoning": "", "first": now, "last": now},
            )
            buffer["content"] += content_delta or ""
            buffer["reasoning"] += reasoning_delta or ""
            buffer["last"] = now
            total = len(buffer["content"]) + len(buffer["reasoning"])
            should_flush = flush or total >= 4096 or now - float(buffer["first"]) >= 0.25
            if not should_flush:
                return None
            payload = {
                "content_delta": buffer["content"],
                "reasoning_delta": buffer["reasoning"],
            }
            self._delta_buffers.pop(session_id, None)
        if not payload["content_delta"] and not payload["reasoning_delta"]:
            return None
        return self.append_event(session_id, "assistant/chunk", payload)

    def flush_stream_delta(self, session_id: str) -> Optional[RuntimeEvent]:
        return self.append_stream_delta(session_id, flush=True)

    def list_events(
        self,
        session_id: str,
        *,
        user_id: Optional[str] = None,
        after: int = -1,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        self.get_session(session_id, user_id=user_id)
        conn = self._conn()
        try:
            rows = conn.execute(
                """SELECT * FROM runtime_events WHERE session_id=? AND seq>?
                   ORDER BY seq ASC LIMIT ?""",
                (session_id, int(after), max(1, min(int(limit), 5000))),
            ).fetchall()
        finally:
            conn.close()
        result = []
        for row in rows:
            event = RuntimeEvent(
                session_id=row["session_id"],
                seq=int(row["seq"]),
                time=float(row["time"]),
                type=row["type"],
                ignorable=bool(row["ignorable"]),
                data=_json_load(row["data_json"], {}),
                surface_op=_json_load(row["surface_json"], None),
                source_event_seqs=tuple(_json_load(row["source_event_seqs_json"], [])),
            )
            result.append(event.to_dict())
        return result

    def wait_for_events(
        self,
        session_id: str,
        *,
        user_id: Optional[str] = None,
        after: int = -1,
        timeout: float = 15.0,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        events = self.list_events(session_id, user_id=user_id, after=after, limit=limit)
        if events:
            return events
        condition = self._condition(session_id)
        with condition:
            condition.wait(timeout=max(0.05, min(float(timeout), 60.0)))
        return self.list_events(session_id, user_id=user_id, after=after, limit=limit)

    def get_projection(self, session_id: str, *, user_id: Optional[str] = None) -> dict[str, Any]:
        session = self.get_session(session_id, user_id=user_id)
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT state_json FROM runtime_projections WHERE session_id=?", (session_id,)
            ).fetchone()
        finally:
            conn.close()
        projection = _json_load(row["state_json"], self._initial_projection(session_id, session["user_id"], session["chat_id"])) if row else self._initial_projection(session_id, session["user_id"], session["chat_id"])
        projection["session"] = session
        return projection

    def repair_interrupted_sessions(self) -> int:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT session_id FROM runtime_sessions WHERE status='running'"
            ).fetchall()
        finally:
            conn.close()
        repaired = 0
        for row in rows:
            session_id = row["session_id"]
            try:
                projection = self.get_projection(session_id)
                if projection.get("step") is not None:
                    self.append_event(session_id, "step/end", {"reason": {"kind": "interrupted"}})
                self.append_event(session_id, "turn/end", {"reason": {"kind": "interrupted"}})
                repaired += 1
            except Exception:
                continue
        return repaired

    def recover_incomplete_work(self) -> dict[str, int]:
        now = _now()
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                jobs = conn.execute(
                    """UPDATE runtime_jobs SET status='interrupted',finished_at=?,updated_at=?,
                       error_json=? WHERE status IN ('queued','running')""",
                    (now, now, _json_dump({"code": "INTERRUPTED", "message": "engine restarted"})),
                ).rowcount
                subagents = conn.execute(
                    """UPDATE runtime_subagents SET status='interrupted',finished_at=?,updated_at=?,
                       error_json=? WHERE status IN ('queued','running')""",
                    (now, now, _json_dump({"code": "INTERRUPTED", "message": "engine restarted"})),
                ).rowcount
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        return {"jobs": int(jobs), "subagents": int(subagents)}

    # ------------------------- Jobs -------------------------
    def create_job(
        self,
        user_id: str,
        kind: str,
        payload: Optional[dict[str, Any]] = None,
        *,
        session_id: Optional[str] = None,
    ) -> dict[str, Any]:
        if session_id:
            self.get_session(session_id, user_id=user_id)
        now = _now()
        job_id = _new_id(kind.replace("/", "-")[:32] or "job")
        safe_payload = redact_secrets(payload or {})
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute(
                    """INSERT INTO runtime_jobs
                       (job_id,user_id,session_id,kind,status,payload_json,created_at,updated_at)
                       VALUES (?,?,?,?, 'queued', ?, ?, ?)""",
                    (job_id, user_id, session_id, kind, _json_dump(safe_payload), now, now),
                )
                conn.commit()
            finally:
                conn.close()
        job = self.get_job(job_id, user_id=user_id)
        if session_id:
            self.append_event(session_id, "job/change", {"job": job})
        return job

    @staticmethod
    def _job_dict(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
        row = dict(row)
        return {
            "job_id": row["job_id"], "user_id": row["user_id"], "session_id": row.get("session_id"),
            "kind": row["kind"], "status": row["status"],
            "payload": _json_load(row.get("payload_json"), {}),
            "result": _json_load(row.get("result_json"), None),
            "error": _json_load(row.get("error_json"), None),
            "cancel_requested": bool(row.get("cancel_requested", 0)),
            "reported": bool(row.get("reported", 0)),
            "created_at": float(row.get("created_at", 0)),
            "started_at": float(row["started_at"]) if row.get("started_at") is not None else None,
            "finished_at": float(row["finished_at"]) if row.get("finished_at") is not None else None,
            "updated_at": float(row.get("updated_at", 0)),
        }

    def get_job(self, job_id: str, *, user_id: Optional[str] = None) -> dict[str, Any]:
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM runtime_jobs WHERE job_id=?" + (" AND user_id=?" if user_id else ""),
                (job_id, user_id) if user_id else (job_id,),
            ).fetchone()
        finally:
            conn.close()
        if not row:
            raise AgentRuntimeError(ErrorCode.NOT_FOUND, "job not found", status=404)
        return self._job_dict(row)

    def list_jobs(self, user_id: str, *, session_id: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            if session_id:
                rows = conn.execute(
                    "SELECT * FROM runtime_jobs WHERE user_id=? AND session_id=? ORDER BY updated_at DESC LIMIT ?",
                    (user_id, session_id, max(1, min(int(limit), 500))),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM runtime_jobs WHERE user_id=? ORDER BY updated_at DESC LIMIT ?",
                    (user_id, max(1, min(int(limit), 500))),
                ).fetchall()
        finally:
            conn.close()
        return [self._job_dict(row) for row in rows]

    def update_job(
        self,
        job_id: str,
        status: str,
        *,
        result: Any = None,
        error: Any = None,
        user_id: Optional[str] = None,
    ) -> dict[str, Any]:
        now = _now()
        status = str(status)
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT * FROM runtime_jobs WHERE job_id=?", (job_id,)).fetchone()
                if not row or (user_id and row["user_id"] != user_id):
                    raise AgentRuntimeError(ErrorCode.NOT_FOUND, "job not found", status=404)
                if row["status"] in TERMINAL_JOB_STATES:
                    conn.rollback()
                    return self._job_dict(row)
                started_at = row["started_at"] or (now if status == "running" else None)
                finished_at = now if status in TERMINAL_JOB_STATES else None
                conn.execute(
                    """UPDATE runtime_jobs SET status=?,result_json=?,error_json=?,started_at=COALESCE(started_at,?),
                       finished_at=COALESCE(finished_at,?),updated_at=? WHERE job_id=?""",
                    (
                        status,
                        _json_dump(redact_secrets(result)) if result is not None else row["result_json"],
                        _json_dump(redact_secrets(error)) if error is not None else row["error_json"],
                        started_at, finished_at, now, job_id,
                    ),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        job = self.get_job(job_id, user_id=user_id)
        if job.get("session_id"):
            self.append_event(job["session_id"], "job/change", {"job": job})
        return job

    def request_job_cancel(self, job_id: str, *, user_id: str, reason: str = "") -> dict[str, Any]:
        now = _now()
        with self._write_lock:
            conn = self._conn()
            try:
                row = conn.execute(
                    "SELECT * FROM runtime_jobs WHERE job_id=? AND user_id=?", (job_id, user_id)
                ).fetchone()
                if not row:
                    raise AgentRuntimeError(ErrorCode.NOT_FOUND, "job not found", status=404)
                if row["status"] not in TERMINAL_JOB_STATES:
                    conn.execute(
                        "UPDATE runtime_jobs SET cancel_requested=1,updated_at=?,error_json=? WHERE job_id=?",
                        (now, _json_dump({"code": "CANCEL_REQUESTED", "message": reason or "cancel requested"}), job_id),
                    )
                    conn.commit()
            finally:
                conn.close()
        return self.get_job(job_id, user_id=user_id)

    # ------------------------- Goals -------------------------
    def create_goal(
        self,
        user_id: str,
        session_id: str,
        objective: str,
        *,
        max_goal_rounds: int = 8,
    ) -> dict[str, Any]:
        self.get_session(session_id, user_id=user_id)
        objective = str(objective or "").strip()
        if not objective:
            raise AgentRuntimeError(ErrorCode.BAD_REQUEST, "goal objective is required", status=400)
        now = _now()
        goal_id = _new_id("goal")
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute(
                    """INSERT INTO runtime_goals
                       (goal_id,user_id,session_id,revision,objective,phase,rounds_started,max_goal_rounds,created_at,updated_at)
                       VALUES (?,?,?,1,?,'active',0,?,?,?)""",
                    (goal_id, user_id, session_id, objective, max(1, min(int(max_goal_rounds), 1000)), now, now),
                )
                conn.commit()
            except sqlite3.IntegrityError as exc:
                raise AgentRuntimeError(ErrorCode.CONFLICT, "session already has an active goal", status=409) from exc
            finally:
                conn.close()
        self._goal_activation[goal_id] = "armed"
        goal = self.get_goal(goal_id=goal_id, user_id=user_id)
        self.append_event(session_id, "goal/change", {"goal": goal})
        return goal

    @staticmethod
    def _goal_dict(row: sqlite3.Row | dict[str, Any], activation: str = "disarmed") -> dict[str, Any]:
        row = dict(row)
        return {
            "goal_id": row["goal_id"], "user_id": row["user_id"], "session_id": row["session_id"],
            "revision": int(row["revision"]), "objective": row["objective"], "phase": row["phase"],
            "rounds_started": int(row.get("rounds_started", 0)),
            "max_goal_rounds": int(row.get("max_goal_rounds", 8)),
            "blocked_reason": _json_load(row.get("blocked_reason_json"), None),
            "created_at": float(row.get("created_at", 0)), "updated_at": float(row.get("updated_at", 0)),
            "activation": activation,
        }

    def get_goal(
        self,
        *,
        goal_id: Optional[str] = None,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        if not goal_id and not session_id:
            raise AgentRuntimeError(ErrorCode.BAD_REQUEST, "goal_id or session_id is required", status=400)
        clauses = ["goal_id=?"] if goal_id else ["session_id=?"]
        params: list[Any] = [goal_id or session_id]
        if user_id:
            clauses.append("user_id=?")
            params.append(user_id)
        conn = self._conn()
        try:
            row = conn.execute(
                f"SELECT * FROM runtime_goals WHERE {' AND '.join(clauses)} ORDER BY updated_at DESC LIMIT 1",
                tuple(params),
            ).fetchone()
        finally:
            conn.close()
        if not row:
            return None
        return self._goal_dict(row, self._goal_activation.get(row["goal_id"], "disarmed"))

    def list_goals(
        self,
        *,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
        phase: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if user_id:
            clauses.append("user_id=?")
            params.append(user_id)
        if session_id:
            clauses.append("session_id=?")
            params.append(session_id)
        if phase:
            clauses.append("phase=?")
            params.append(phase)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        params.append(max(1, min(int(limit), 1000)))
        conn = self._conn()
        try:
            rows = conn.execute(
                f"SELECT * FROM runtime_goals{where} ORDER BY updated_at ASC LIMIT ?", tuple(params)
            ).fetchall()
        finally:
            conn.close()
        return [self._goal_dict(row, self._goal_activation.get(row["goal_id"], "disarmed")) for row in rows]

    def update_goal(
        self,
        user_id: str,
        goal_id: str,
        revision: int,
        action: str,
        *,
        objective: Optional[str] = None,
        max_goal_rounds: Optional[int] = None,
        blocked_reason: Optional[dict[str, Any] | str] = None,
    ) -> dict[str, Any]:
        action = str(action or "").lower()
        now = _now()
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute(
                    "SELECT * FROM runtime_goals WHERE goal_id=? AND user_id=?", (goal_id, user_id)
                ).fetchone()
                if not row:
                    raise AgentRuntimeError(ErrorCode.NOT_FOUND, "goal not found", status=404)
                if int(row["revision"]) != int(revision):
                    raise AgentRuntimeError(
                        ErrorCode.CONFLICT,
                        "goal revision conflict",
                        status=409,
                        details={"expected": int(row["revision"]), "received": int(revision)},
                    )
                phase = row["phase"]
                new_objective = row["objective"]
                new_max = int(row["max_goal_rounds"])
                blocked_json = row["blocked_reason_json"]
                if action == "edit":
                    if objective is not None:
                        new_objective = str(objective).strip()
                    if max_goal_rounds is not None:
                        new_max = max(1, min(int(max_goal_rounds), 1000))
                elif action == "pause":
                    phase = "paused"
                    self._goal_activation[goal_id] = "disarmed"
                elif action == "resume":
                    phase = "active"
                    blocked_json = None
                    self._goal_activation[goal_id] = "armed"
                elif action == "complete":
                    phase = "complete"
                    self._goal_activation[goal_id] = "disarmed"
                elif action == "blocked":
                    phase = "blocked"
                    blocked_json = _json_dump(blocked_reason or {"message": "blocked"})
                    self._goal_activation[goal_id] = "disarmed"
                elif action == "start-round":
                    if phase != "active":
                        raise AgentRuntimeError(ErrorCode.CONFLICT, "goal is not active", status=409)
                    conn.execute(
                        "UPDATE runtime_goals SET rounds_started=rounds_started+1 WHERE goal_id=?", (goal_id,)
                    )
                    self._goal_activation[goal_id] = "disarmed"
                elif action == "arm":
                    self._goal_activation[goal_id] = "armed"
                elif action == "disarm":
                    self._goal_activation[goal_id] = "disarmed"
                else:
                    raise AgentRuntimeError(ErrorCode.BAD_REQUEST, f"unsupported goal action: {action}", status=400)
                conn.execute(
                    """UPDATE runtime_goals SET revision=revision+1,objective=?,phase=?,max_goal_rounds=?,
                       blocked_reason_json=?,updated_at=? WHERE goal_id=?""",
                    (new_objective, phase, new_max, blocked_json, now, goal_id),
                )
                conn.commit()
                session_id = row["session_id"]
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        goal = self.get_goal(goal_id=goal_id, user_id=user_id)
        assert goal is not None
        self.append_event(session_id, "goal/change", {"goal": goal})
        return goal

    # ------------------------- Subagents -------------------------
    def create_subagent(
        self,
        user_id: str,
        parent_session_id: str,
        label: str,
        prompt: str,
        *,
        role: str = "general",
        provider: str = "",
        model: str = "",
    ) -> dict[str, Any]:
        child = self.fork_session(user_id, parent_session_id, label, provider=provider, model=model)
        agent_id = _new_id("subagent")
        now = _now()
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute(
                    """INSERT INTO runtime_subagents
                       (agent_id,user_id,parent_session_id,child_session_id,label,role,provider,model,status,prompt,
                        created_at,updated_at)
                       VALUES (?,?,?,?,?,?,?,?, 'idle', ?, ?, ?)""",
                    (
                        agent_id, user_id, parent_session_id, child["session_id"], label,
                        role or "general", provider or "", model or "", str(prompt or ""), now, now,
                    ),
                )
                conn.commit()
            finally:
                conn.close()
        subagent = self.get_subagent(agent_id, user_id=user_id)
        self.append_event(parent_session_id, "subagent/change", {"subagent": subagent})
        return subagent

    @staticmethod
    def _subagent_dict(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
        row = dict(row)
        return {
            "agent_id": row["agent_id"], "user_id": row["user_id"],
            "parent_session_id": row.get("parent_session_id"), "child_session_id": row["child_session_id"],
            "label": row["label"], "role": row.get("role", "general"),
            "provider": row.get("provider", ""), "model": row.get("model", ""),
            "status": row["status"], "prompt": row.get("prompt", ""),
            "inbox": _json_load(row.get("inbox_json"), []),
            "result": _json_load(row.get("result_json"), None),
            "error": _json_load(row.get("error_json"), None),
            "cancel_requested": bool(row.get("cancel_requested", 0)),
            "created_at": float(row.get("created_at", 0)),
            "started_at": float(row["started_at"]) if row.get("started_at") is not None else None,
            "finished_at": float(row["finished_at"]) if row.get("finished_at") is not None else None,
            "updated_at": float(row.get("updated_at", 0)),
        }

    def get_subagent(self, agent_id: str, *, user_id: Optional[str] = None) -> dict[str, Any]:
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM runtime_subagents WHERE agent_id=?" + (" AND user_id=?" if user_id else ""),
                (agent_id, user_id) if user_id else (agent_id,),
            ).fetchone()
        finally:
            conn.close()
        if not row:
            raise AgentRuntimeError(ErrorCode.NOT_FOUND, "subagent not found", status=404)
        return self._subagent_dict(row)

    def list_subagents(
        self,
        user_id: str,
        *,
        parent_session_id: Optional[str] = None,
        include_descendants: bool = False,
    ) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            if parent_session_id and not include_descendants:
                rows = conn.execute(
                    "SELECT * FROM runtime_subagents WHERE user_id=? AND parent_session_id=? ORDER BY created_at ASC",
                    (user_id, parent_session_id),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM runtime_subagents WHERE user_id=? ORDER BY created_at ASC", (user_id,)
                ).fetchall()
        finally:
            conn.close()
        items = [self._subagent_dict(row) for row in rows]
        if parent_session_id and include_descendants:
            sessions = {parent_session_id}
            result = []
            changed = True
            while changed:
                changed = False
                for item in items:
                    if item["parent_session_id"] in sessions and item not in result:
                        result.append(item)
                        sessions.add(item["child_session_id"])
                        changed = True
            return result
        return items

    def update_subagent(
        self,
        agent_id: str,
        status: str,
        *,
        user_id: Optional[str] = None,
        result: Any = None,
        error: Any = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> dict[str, Any]:
        now = _now()
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT * FROM runtime_subagents WHERE agent_id=?", (agent_id,)).fetchone()
                if not row or (user_id and row["user_id"] != user_id):
                    raise AgentRuntimeError(ErrorCode.NOT_FOUND, "subagent not found", status=404)
                if row["status"] in TERMINAL_SUBAGENT_STATES and status not in {"idle", "queued", "running"}:
                    conn.rollback()
                    return self._subagent_dict(row)
                started_at = row["started_at"] or (now if status == "running" else None)
                finished_at = now if status in TERMINAL_SUBAGENT_STATES else None
                conn.execute(
                    """UPDATE runtime_subagents SET status=?,result_json=?,error_json=?,provider=?,model=?,prompt=?,
                       cancel_requested=CASE WHEN ? IN ('idle','queued','running') THEN 0 ELSE cancel_requested END,
                       started_at=COALESCE(started_at,?),finished_at=?,updated_at=? WHERE agent_id=?""",
                    (
                        status,
                        _json_dump(redact_secrets(result)) if result is not None else row["result_json"],
                        _json_dump(redact_secrets(error)) if error is not None else row["error_json"],
                        str(provider) if provider is not None else row["provider"],
                        str(model) if model is not None else row["model"],
                        str(prompt) if prompt is not None else row["prompt"],
                        status, started_at, finished_at, now, agent_id,
                    ),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        subagent = self.get_subagent(agent_id, user_id=user_id)
        if subagent.get("parent_session_id"):
            self.append_event(subagent["parent_session_id"], "subagent/change", {"subagent": subagent})
        return subagent

    def enqueue_subagent_message(self, agent_id: str, user_id: str, content: str) -> dict[str, Any]:
        content = str(content or "").strip()
        if not content:
            raise AgentRuntimeError(ErrorCode.BAD_REQUEST, "subagent message is empty", status=400)
        now = _now()
        message = {"id": _new_id("message"), "content": content, "time": now}
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute(
                    "SELECT * FROM runtime_subagents WHERE agent_id=? AND user_id=?", (agent_id, user_id)
                ).fetchone()
                if not row:
                    raise AgentRuntimeError(ErrorCode.NOT_FOUND, "subagent not found", status=404)
                inbox = _json_load(row["inbox_json"], [])
                inbox.append(message)
                conn.execute(
                    "UPDATE runtime_subagents SET inbox_json=?,updated_at=? WHERE agent_id=?",
                    (_json_dump(inbox[-100:]), now, agent_id),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        return {"ok": True, "message": message, "subagent": self.get_subagent(agent_id, user_id=user_id)}

    def pop_subagent_messages(self, agent_id: str, user_id: str) -> list[dict[str, Any]]:
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute(
                    "SELECT inbox_json FROM runtime_subagents WHERE agent_id=? AND user_id=?", (agent_id, user_id)
                ).fetchone()
                if not row:
                    raise AgentRuntimeError(ErrorCode.NOT_FOUND, "subagent not found", status=404)
                inbox = _json_load(row["inbox_json"], [])
                conn.execute(
                    "UPDATE runtime_subagents SET inbox_json='[]',updated_at=? WHERE agent_id=?",
                    (_now(), agent_id),
                )
                conn.commit()
                return inbox
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()

    def request_subagent_cancel(self, agent_id: str, user_id: str, reason: str = "") -> dict[str, Any]:
        now = _now()
        with self._write_lock:
            conn = self._conn()
            try:
                row = conn.execute(
                    "SELECT * FROM runtime_subagents WHERE agent_id=? AND user_id=?", (agent_id, user_id)
                ).fetchone()
                if not row:
                    raise AgentRuntimeError(ErrorCode.NOT_FOUND, "subagent not found", status=404)
                if row["status"] not in TERMINAL_SUBAGENT_STATES:
                    conn.execute(
                        "UPDATE runtime_subagents SET cancel_requested=1,error_json=?,updated_at=? WHERE agent_id=?",
                        (_json_dump({"code": "CANCEL_REQUESTED", "message": reason or "cancel requested"}), now, agent_id),
                    )
                    conn.commit()
            finally:
                conn.close()
        return self.get_subagent(agent_id, user_id=user_id)

    # ------------------------- Maintenance -------------------------
    def prune(self, *, retention_days: int = 90) -> dict[str, int]:
        cutoff = _now() - max(1, int(retention_days)) * 86400
        with self._write_lock:
            conn = self._conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                jobs = conn.execute(
                    "DELETE FROM runtime_jobs WHERE status IN ('completed','failed','cancelled','interrupted') AND updated_at<?",
                    (cutoff,),
                ).rowcount
                subagents = conn.execute(
                    "DELETE FROM runtime_subagents WHERE status IN ('completed','failed','cancelled','interrupted','deleted') AND updated_at<?",
                    (cutoff,),
                ).rowcount
                sessions = conn.execute(
                    """DELETE FROM runtime_sessions WHERE status IN ('completed','failed','cancelled','interrupted')
                       AND updated_at<? AND session_id NOT IN (SELECT session_id FROM runtime_goals WHERE phase!='complete')""",
                    (cutoff,),
                ).rowcount
                # ★ DSH 风格事件日志清理：终态会话的旧事件一并删除，避免 runtime_events 无上限增长。
                #   活跃(running/待定)会话的事件保留，供刷新/续接使用。
                events = conn.execute(
                    """DELETE FROM runtime_events WHERE time<? AND session_id IN (
                        SELECT session_id FROM runtime_sessions
                        WHERE status IN ('completed','failed','cancelled','interrupted','deleted')
                    )""",
                    (cutoff,),
                ).rowcount
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        return {"jobs": int(jobs), "subagents": int(subagents), "sessions": int(sessions), "events": int(events)}

    def stats(self, user_id: Optional[str] = None) -> dict[str, Any]:
        conn = self._conn()
        try:
            where = " WHERE user_id=?" if user_id else ""
            params = (user_id,) if user_id else ()
            sessions = conn.execute(f"SELECT COUNT(*) FROM runtime_sessions{where}", params).fetchone()[0]
            jobs = conn.execute(f"SELECT COUNT(*) FROM runtime_jobs{where}", params).fetchone()[0]
            subagents = conn.execute(f"SELECT COUNT(*) FROM runtime_subagents{where}", params).fetchone()[0]
            if user_id:
                events = conn.execute(
                    """SELECT COUNT(*) FROM runtime_events e JOIN runtime_sessions s ON s.session_id=e.session_id
                       WHERE s.user_id=?""",
                    (user_id,),
                ).fetchone()[0]
            else:
                events = conn.execute("SELECT COUNT(*) FROM runtime_events").fetchone()[0]
        finally:
            conn.close()
        try:
            bytes_on_disk = self.db_path.stat().st_size
        except OSError:
            bytes_on_disk = 0
        return {
            "format_version": RUNTIME_FORMAT_VERSION,
            "sessions": int(sessions), "events": int(events), "jobs": int(jobs),
            "subagents": int(subagents), "bytes": int(bytes_on_disk),
        }


_RUNTIME_STORE: Optional[AgentRuntimeStore] = None
_RUNTIME_LOCK = threading.RLock()


def get_agent_runtime_store(engine_dir: str | Path) -> AgentRuntimeStore:
    global _RUNTIME_STORE
    with _RUNTIME_LOCK:
        if _RUNTIME_STORE is None:
            _RUNTIME_STORE = AgentRuntimeStore(engine_dir)
        return _RUNTIME_STORE
