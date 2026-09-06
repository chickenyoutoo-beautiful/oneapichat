"""
OneAPIChat Engine - 存储层 (JSON + SQLite)
提取自 engine_server.py — EngineStore / ChatStore / 工厂函数
"""
import json
import os
import sqlite3
import tempfile
import threading
import glob
from pathlib import Path

from engine.agent_errors import redact_secrets
from engine.provider_runtime import safe_request_snapshot


class EngineStore:
    """Per-path locked atomic JSON store."""
    _locks = {}
    _locks_guard = threading.RLock()

    def __init__(self, path, user_id=""):
        self.path = Path(path)
        if user_id:
            self.path = self.path.parent / f"user_{user_id}_{self.path.name}"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._locks_guard:
            self._lock = self._locks.setdefault(str(self.path.resolve()), threading.RLock())
        with self._lock:
            if not self.path.exists():
                self.path.write_text('{}', encoding='utf8')
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass

    def get(self):
        with self._lock:
            try:
                data = json.loads(self.path.read_text(encoding='utf8'))
            except (OSError, json.JSONDecodeError):
                data = {}
            return data

    def _set_unlocked(self, data):
        fd, tmp_path = tempfile.mkstemp(dir=str(self.path.parent), suffix='.tmp')
        closed = False
        try:
            os.fchmod(fd, 0o600)
            os.write(fd, json.dumps(data, ensure_ascii=False, indent=2).encode('utf8'))
            os.fsync(fd)
            os.close(fd)
            closed = True
            os.replace(tmp_path, str(self.path))
        except Exception:
            if not closed:
                try: os.close(fd)
                except OSError: pass
            try: os.unlink(tmp_path)
            except OSError: pass
            raise

    def set(self, data):
        """Atomically replace the whole JSON value under a per-path lock."""
        with self._lock:
            self._set_unlocked(data)

    def update(self, key, value):
        with self._lock:
            data = self.get()
            data[key] = value
            self._set_unlocked(data)

    def delete(self, key):
        with self._lock:
            data = self.get()
            data.pop(key, None)
            self._set_unlocked(data)


def get_ns(engine_dir: Path, suffix: str, user_id: str = "") -> EngineStore:
    """获取用户隔离的 store 实例"""
    return EngineStore(engine_dir / f"{suffix}.json", user_id=user_id)


# ==================== ChatStore (SQLite 消息持久化) ====================

class ChatStore:
    """SQLite 消息存储，支持流式进度保存"""
    def __init__(self, engine_dir: Path, user_id: str = ""):
        self.user_id = user_id
        self.engine_dir = Path(engine_dir)
        db_name = f"chat_{user_id}.db" if user_id else "chat.db"
        self.db_path = self.engine_dir / db_name
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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS active_tasks (
                task_id TEXT PRIMARY KEY, stream_id TEXT UNIQUE NOT NULL,
                chat_id TEXT NOT NULL, msg_id TEXT NOT NULL,
                user_id TEXT NOT NULL, model TEXT DEFAULT '',
                status TEXT DEFAULT 'running',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                request_data TEXT DEFAULT '')
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_msg_chat ON chat_messages(chat_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_progress_msg ON chat_stream_progress(msg_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_active_tasks_user ON active_tasks(user_id, status)")
        # Migration guard: retain the newest producer if an old version created duplicate running rows.
        duplicates = conn.execute("""
            SELECT user_id, msg_id FROM active_tasks WHERE status='running'
            GROUP BY user_id, msg_id HAVING COUNT(*) > 1
        """).fetchall()
        for owner, message_id in duplicates:
            keep = conn.execute("""
                SELECT task_id FROM active_tasks WHERE user_id=? AND msg_id=? AND status='running'
                ORDER BY created_at DESC, task_id DESC LIMIT 1
            """, (owner, message_id)).fetchone()
            if keep:
                conn.execute("""
                    UPDATE active_tasks SET status='interrupted', request_data='{}', updated_at=CURRENT_TIMESTAMP
                    WHERE user_id=? AND msg_id=? AND status='running' AND task_id<>?
                """, (owner, message_id, keep[0]))
        conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_active_tasks_single_running_message
            ON active_tasks(user_id, msg_id) WHERE status='running'
        """)
        conn.commit()
        conn.close()
        try:
            os.chmod(self.db_path, 0o600)
        except OSError:
            pass
        self.scrub_task_secrets()
        self.prune_terminal_tasks(retention_days=30)

    def scrub_task_secrets(self) -> int:
        """Remove credentials from legacy active_tasks rows in-place."""
        changed = 0
        conn = None
        try:
            conn = self._conn()
            suspicious = "(request_data LIKE '%api_key%' OR request_data LIKE '%Authorization%' OR request_data LIKE '%token%' OR request_data LIKE '%password%')"
            terminal = conn.execute(
                f"UPDATE active_tasks SET request_data='{{}}' WHERE status!='running' AND {suspicious}"
            )
            changed += max(0, int(terminal.rowcount))
            rows = conn.execute(
                f"SELECT task_id, request_data FROM active_tasks WHERE status='running' AND {suspicious}"
            ).fetchall()
            for task_id, raw in rows:
                try:
                    parsed = json.loads(raw or '{}')
                except Exception:
                    parsed = {}
                safe = redact_secrets(safe_request_snapshot(parsed if isinstance(parsed, dict) else {}))
                conn.execute(
                    "UPDATE active_tasks SET request_data=? WHERE task_id=?",
                    (json.dumps(safe, ensure_ascii=False, separators=(',', ':')), task_id),
                )
                changed += 1
            conn.commit()
        except Exception as e:
            print(f"[ChatStore] scrub_task_secrets error: {e}")
        finally:
            if conn is not None:
                conn.close()
        return changed

    def prune_terminal_tasks(self, retention_days: int = 30) -> int:
        """Delete old terminal task metadata; running tasks are never age-killed here."""
        conn = None
        try:
            conn = self._conn()
            cur = conn.execute("""
                DELETE FROM active_tasks
                WHERE status IN ('completed','failed','cancelled','interrupted')
                  AND updated_at < datetime('now', ?)
            """, (f'-{max(1, int(retention_days))} days',))
            conn.commit()
            return max(0, int(cur.rowcount))
        except Exception as e:
            print(f"[ChatStore] prune_terminal_tasks error: {e}")
            return 0
        finally:
            if conn is not None:
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
        except Exception:
            return {}

    def find_running_task(self, user_id: str, chat_id: str = "", msg_id: str = "") -> dict:
        """Return the authoritative running producer for a message/chat.

        DSH-style single-producer barrier: retries with the same msg_id and
        accidental requests from another browser for the same chat attach to
        the existing server task instead of creating a second LLM/tool loop.
        """
        if not user_id or (not chat_id and not msg_id):
            return {}
        try:
            conn = self._conn()
            conn.row_factory = sqlite3.Row
            clauses = ["user_id=?", "status='running'"]
            params: list = [user_id]
            if msg_id:
                clauses.append("msg_id=?")
                params.append(msg_id)
            elif chat_id:
                clauses.append("chat_id=?")
                params.append(chat_id)
            row = conn.execute(f"""
                SELECT task_id, stream_id, chat_id, msg_id, user_id, model,
                       status, created_at, updated_at
                FROM active_tasks
                WHERE {' AND '.join(clauses)}
                ORDER BY created_at DESC LIMIT 1
            """, tuple(params)).fetchone()
            conn.close()
            return dict(row) if row else {}
        except Exception as e:
            print(f"[ChatStore] find_running_task error: {e}")
            return {}

    def claim_task(self, task_id: str, stream_id: str, chat_id: str,
                   msg_id: str, user_id: str, model: str, request_data: dict) -> dict:
        """Atomically claim the single running producer for user_id + msg_id.

        BEGIN IMMEDIATE plus a partial UNIQUE index makes the claim safe across
        concurrent requests and across engine processes sharing this SQLite DB.
        The caller must start a provider/tool worker only when claimed is true.
        """
        if not task_id or not stream_id or not msg_id or not user_id:
            raise ValueError("task_id, stream_id, msg_id and user_id are required")
        conn = None
        try:
            conn = self._conn()
            conn.row_factory = sqlite3.Row
            conn.execute("BEGIN IMMEDIATE")
            safe_request = safe_request_snapshot(request_data or {})
            try:
                conn.execute("""
                    INSERT INTO active_tasks
                    (task_id, stream_id, chat_id, msg_id, user_id, model, status, request_data)
                    VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
                """, (task_id, stream_id, chat_id, msg_id, user_id, model,
                      json.dumps(safe_request, ensure_ascii=False, separators=(',', ':'))))
                conn.commit()
                return {"claimed": True, "task": {
                    "task_id": task_id, "stream_id": stream_id, "chat_id": chat_id,
                    "msg_id": msg_id, "user_id": user_id, "model": model, "status": "running",
                }}
            except sqlite3.IntegrityError:
                row = conn.execute("""
                    SELECT task_id, stream_id, chat_id, msg_id, user_id, model, status, created_at, updated_at
                    FROM active_tasks WHERE user_id=? AND msg_id=? AND status='running' LIMIT 1
                """, (user_id, msg_id)).fetchone()
                conn.commit()
                if row:
                    return {"claimed": False, "task": dict(row)}
                raise
        except Exception as e:
            if conn is not None:
                try: conn.rollback()
                except Exception: pass
            print(f"[ChatStore] claim_task error: {e}")
            raise RuntimeError("durable task claim failed") from e
        finally:
            if conn is not None:
                conn.close()

    def register_task(self, task_id: str, stream_id: str, chat_id: str,
                      msg_id: str, user_id: str, model: str, request_data: dict):
        """Compatibility wrapper. New producers must use claim_task()."""
        claimed = self.claim_task(task_id, stream_id, chat_id, msg_id, user_id, model, request_data)
        if not claimed.get("claimed"):
            raise RuntimeError("running producer already claimed for msg_id")

    def complete_task(self, task_id: str, status: str = 'completed'):
        try:
            conn = self._conn()
            conn.execute("""
                UPDATE active_tasks SET status=?, request_data='{}', updated_at=CURRENT_TIMESTAMP
                WHERE task_id=?
            """, (status, task_id))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ChatStore] complete_task error: {e}")

    def abandon_task(self, task_id: str, user_id: str = "") -> bool:
        """只允许终止指定用户自己的 running 任务。"""
        try:
            conn = self._conn()
            cur = conn.execute("""
                UPDATE active_tasks SET status='failed', request_data='{}', updated_at=CURRENT_TIMESTAMP
                WHERE task_id=? AND status IN ('running','recoverable') AND (?='' OR user_id=?)
            """, (task_id, user_id, user_id))
            conn.commit()
            changed = cur.rowcount > 0
            conn.close()
            return changed
        except Exception as e:
            print(f"[ChatStore] abandon_task error: {e}")
            return False

    def reconcile_active_tasks(self, user_id: str, live_stream_ids=None,
                               max_runtime_seconds: int = 86400,
                               empty_timeout_seconds: int = 7200) -> list:
        """修正已完成或进程重启遗留任务；绝不按静默时长误杀仍存活的流。"""
        live_stream_ids = set(live_stream_ids or [])
        expired = []
        try:
            conn = self._conn()
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT a.task_id, a.stream_id, a.msg_id, a.status AS current_status,
                       (julianday('now') - julianday(a.created_at)) * 86400 AS age_seconds,
                       p.finished AS progress_finished, p.error AS progress_error,
                       p.full_text, p.reasoning_text, p.tool_calls,
                       (julianday('now') - julianday(p.updated_at)) * 86400 AS progress_age
                FROM active_tasks a
                LEFT JOIN chat_stream_progress p ON p.msg_id=a.msg_id
                WHERE a.user_id=? AND a.status IN ('running', 'recoverable')
            """, (user_id,)).fetchall()
            for row in rows:
                status = ''
                age = row['age_seconds'] or 0
                has_snapshot = bool(row['progress_finished'] is not None and (
                    row['full_text'] or row['reasoning_text'] or row['tool_calls'] or row['progress_error']))
                
                if row['current_status'] == 'recoverable':
                    # 已经处于 recoverable 状态的任务：若生产线程早已消亡且无有效快照，或任务已超过1小时，自动沉降为 interrupted
                    if row['stream_id'] not in live_stream_ids:
                        if not has_snapshot or age > 3600:
                            status = 'interrupted'
                elif row['progress_finished']:
                    status = 'failed' if row['progress_error'] else 'completed'
                elif row['stream_id'] not in live_stream_ids:
                    # 进程重启后生产线程不存在，但已有快照时不能把任务伪装成消失。
                    # recoverable 会继续出现在 active_tasks，前端可展示 partial 并让用户决定下一步。
                    # 若快照完全为空或任务已超过1小时，直接沉降为 interrupted
                    if has_snapshot and age <= 3600:
                        status = 'recoverable'
                    else:
                        status = 'interrupted'
                # A live provider stream owns its timeout/cancellation semantics. Long reasoning
                # or temporarily silent upstreams must not be killed by this reconciliation pass.
                if status and status != row['current_status']:
                    conn.execute("""
                        UPDATE active_tasks SET status=?, updated_at=CURRENT_TIMESTAMP
                        WHERE task_id=?
                    """, (status, row['task_id']))
                    expired.append({'task_id': row['task_id'], 'stream_id': row['stream_id'], 'status': status})
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ChatStore] reconcile_active_tasks error: {e}")
        return expired

    def get_active_tasks(self, user_id: str) -> list:
        try:
            conn = self._conn()
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT a.task_id, a.stream_id, a.chat_id, a.msg_id, a.model, a.status, a.created_at,
                       COALESCE(p.full_text, '') AS snapshot_text,
                       COALESCE(p.reasoning_text, '') AS snapshot_reasoning,
                       COALESCE(p.tool_calls, '[]') AS snapshot_tool_calls,
                       COALESCE(p.finished, 0) AS snapshot_finished,
                       COALESCE(p.error, '') AS snapshot_error
                FROM active_tasks a LEFT JOIN chat_stream_progress p ON p.msg_id=a.msg_id
                WHERE a.user_id=? AND a.status IN ('running','recoverable')
                ORDER BY created_at DESC
            """, (user_id,)).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except Exception as e:
            print(f"[ChatStore] get_active_tasks error: {e}")
            return []


def harden_all_chat_stores(engine_dir: Path, retention_days: int = 30) -> dict:
    """One-time startup migration for every legacy per-user chat database."""
    result = {'databases': 0, 'scrubbed': 0, 'pruned': 0, 'errors': 0}
    for raw_path in glob.glob(str(Path(engine_dir) / 'chat*.db')):
        path = Path(raw_path)
        result['databases'] += 1
        try:
            os.chmod(path, 0o600)
        except OSError:
            result['errors'] += 1
        conn = None
        try:
            conn = sqlite3.connect(str(path), timeout=30)
            has_tasks = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='active_tasks'"
            ).fetchone()
            if not has_tasks:
                continue
            suspicious = "(request_data LIKE '%api_key%' OR request_data LIKE '%Authorization%' OR request_data LIKE '%token%' OR request_data LIKE '%password%')"
            terminal = conn.execute(
                f"UPDATE active_tasks SET request_data='{{}}' WHERE status!='running' AND {suspicious}"
            )
            result['scrubbed'] += max(0, int(terminal.rowcount))
            rows = conn.execute(
                f"SELECT task_id, request_data FROM active_tasks WHERE status='running' AND {suspicious}"
            ).fetchall()
            for task_id, raw in rows:
                try:
                    parsed = json.loads(raw or '{}')
                except Exception:
                    parsed = {}
                safe = safe_request_snapshot(parsed if isinstance(parsed, dict) else {})
                conn.execute(
                    "UPDATE active_tasks SET request_data=? WHERE task_id=?",
                    (json.dumps(redact_secrets(safe), ensure_ascii=False, separators=(',', ':')), task_id),
                )
                result['scrubbed'] += 1
            cur = conn.execute("""
                DELETE FROM active_tasks
                WHERE status IN ('completed','failed','cancelled','interrupted')
                  AND updated_at < datetime('now', ?)
            """, (f'-{max(1, int(retention_days))} days',))
            result['pruned'] += max(0, int(cur.rowcount))
            conn.commit()
        except Exception:
            result['errors'] += 1
        finally:
            if conn is not None:
                conn.close()
        for suffix in ('-wal', '-shm'):
            sidecar = Path(str(path) + suffix)
            try:
                if sidecar.exists():
                    os.chmod(sidecar, 0o600)
            except OSError:
                result['errors'] += 1
    return result


# 单例缓存
_chat_stores = {}

def get_chat_store(engine_dir: Path, user_id: str = "") -> ChatStore:
    """获取用户隔离的 ChatStore (单例)"""
    if user_id not in _chat_stores:
        _chat_stores[user_id] = ChatStore(engine_dir, user_id)
    return _chat_stores[user_id]
