"""
OneAPIChat Engine - 存储层 (JSON + SQLite)
提取自 engine_server.py — EngineStore / ChatStore / 工厂函数
"""
import json
import os
import sqlite3
import tempfile
from pathlib import Path


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
        fd, tmp_path = tempfile.mkstemp(dir=str(self.path.parent), suffix='.tmp')
        try:
            os.write(fd, json.dumps(data, ensure_ascii=False, indent=2).encode('utf8'))
            os.close(fd)
            os.replace(tmp_path, str(self.path))
        except Exception:
            os.close(fd)
            try: os.unlink(tmp_path)
            except Exception: pass
            raise

    def update(self, key, value):
        d = self.get()
        d[key] = value
        self.set(d)

    def delete(self, key):
        d = self.get()
        d.pop(key, None)
        self.set(d)


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

    def register_task(self, task_id: str, stream_id: str, chat_id: str,
                      msg_id: str, user_id: str, model: str, request_data: dict):
        try:
            conn = self._conn()
            conn.execute("""
                INSERT OR REPLACE INTO active_tasks
                (task_id, stream_id, chat_id, msg_id, user_id, model, status, request_data)
                VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
            """, (task_id, stream_id, chat_id, msg_id, user_id, model,
                  json.dumps(request_data, ensure_ascii=False)))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ChatStore] register_task error: {e}")

    def complete_task(self, task_id: str, status: str = 'completed'):
        try:
            conn = self._conn()
            conn.execute("""
                UPDATE active_tasks SET status=?, updated_at=CURRENT_TIMESTAMP
                WHERE task_id=?
            """, (status, task_id))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ChatStore] complete_task error: {e}")

    def get_active_tasks(self, user_id: str) -> list:
        try:
            conn = self._conn()
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT task_id, stream_id, chat_id, msg_id, model, status, created_at
                FROM active_tasks WHERE user_id=? AND status='running'
                ORDER BY created_at DESC
            """, (user_id,)).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except Exception as e:
            print(f"[ChatStore] get_active_tasks error: {e}")
            return []


# 单例缓存
_chat_stores = {}

def get_chat_store(engine_dir: Path, user_id: str = "") -> ChatStore:
    """获取用户隔离的 ChatStore (单例)"""
    if user_id not in _chat_stores:
        _chat_stores[user_id] = ChatStore(engine_dir, user_id)
    return _chat_stores[user_id]
