"""
OneAPIChat Memory System — SQLite Database Layer
User-isolated SQLite databases with FTS5 full-text search + knowledge graph.
"""
import sqlite3, threading, uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

MEMORY_DB_DIR: Optional[Path] = None
_connections: dict = {}

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS facts (
    id TEXT PRIMARY KEY, entity TEXT NOT NULL, relation TEXT NOT NULL,
    target TEXT NOT NULL, content TEXT NOT NULL, source TEXT DEFAULT 'manual',
    confidence REAL DEFAULT 1.0, importance INTEGER DEFAULT 5,
    tags TEXT DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    expires_at TEXT, is_active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL,
    conversation_id TEXT, message_count INTEGER DEFAULT 0,
    token_count INTEGER DEFAULT 0, emotional_tone TEXT DEFAULT 'neutral',
    tags TEXT DEFAULT '[]', importance INTEGER DEFAULT 5,
    created_at TEXT NOT NULL, occurred_at TEXT
);
CREATE TABLE IF NOT EXISTS personality (
    id INTEGER PRIMARY KEY AUTOINCREMENT, layer TEXT NOT NULL,
    key TEXT NOT NULL, value TEXT NOT NULL, category TEXT,
    is_immutable INTEGER DEFAULT 0, preset_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(layer, key)
);
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
    entity, relation, target, content, content='facts', content_rowid='rowid'
);
CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
    title, summary, tags, content='episodes', content_rowid='rowid'
);
CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity, is_active);
CREATE INDEX IF NOT EXISTS idx_facts_importance ON facts(importance, is_active);
CREATE INDEX IF NOT EXISTS idx_episodes_created ON episodes(created_at);
CREATE INDEX IF NOT EXISTS idx_personality_layer ON personality(layer, key);
"""

FTS_TRIGGERS = """
CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
    INSERT INTO facts_fts(rowid, entity, relation, target, content)
    VALUES (new.rowid, new.entity, new.relation, new.target, new.content);
END;
CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
    INSERT INTO facts_fts(facts_fts, rowid, entity, relation, target, content)
    VALUES ('delete', old.rowid, old.entity, old.relation, old.target, old.content);
END;
CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
    INSERT INTO facts_fts(facts_fts, rowid, entity, relation, target, content)
    VALUES ('delete', old.rowid, old.entity, old.relation, old.target, old.content);
    INSERT INTO facts_fts(rowid, entity, relation, target, content)
    VALUES (new.rowid, new.entity, new.relation, new.target, new.content);
END;
CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
    INSERT INTO episodes_fts(rowid, title, summary, tags)
    VALUES (new.rowid, new.title, new.summary, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS episodes_ad AFTER DELETE ON episodes BEGIN
    INSERT INTO episodes_fts(episodes_fts, rowid, title, summary, tags)
    VALUES ('delete', old.rowid, old.title, old.summary, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS episodes_au AFTER UPDATE ON episodes BEGIN
    INSERT INTO episodes_fts(episodes_fts, rowid, title, summary, tags)
    VALUES ('delete', old.rowid, old.title, old.summary, old.tags);
    INSERT INTO episodes_fts(rowid, title, summary, tags)
    VALUES (new.rowid, new.title, new.summary, new.tags);
END;
"""


def init_memory_db_dir(engine_dir: Path):
    global MEMORY_DB_DIR
    MEMORY_DB_DIR = engine_dir / "memory_db"
    MEMORY_DB_DIR.mkdir(parents=True, exist_ok=True)


def _db_path(user_id: str) -> Path:
    if MEMORY_DB_DIR is None:
        raise RuntimeError("memory_db not initialized — call init_memory_db_dir() first")
    safe_id = user_id.replace("/", "_").replace("\\", "_")
    return MEMORY_DB_DIR / f"memory_{safe_id}.db"


def get_conn(user_id: str) -> sqlite3.Connection:
    key = f"{threading.get_ident()}:{user_id}"
    if key not in _connections:
        conn = sqlite3.connect(str(_db_path(user_id)), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        _connections[key] = conn
        _init_schema(conn)
    return _connections[key]


def _init_schema(conn: sqlite3.Connection):
    conn.executescript(SCHEMA_SQL)
    cur = conn.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND name='facts_ai'")
    if cur.fetchone() is None:
        conn.executescript(FTS_TRIGGERS)
    conn.commit()


def close_all():
    for conn in list(_connections.values()):
        try: conn.close()
        except: pass
    _connections.clear()


# ── Fact CRUD ──

def save_fact(user_id: str, fact: dict) -> dict:
    conn = get_conn(user_id)
    now = datetime.now(timezone.utc).isoformat()
    fid = fact.get("id") or str(uuid.uuid4())
    existing = conn.execute(
        "SELECT id FROM facts WHERE entity=? AND relation=? AND target=? AND is_active=1",
        (fact["entity"], fact["relation"], fact["target"])).fetchone()
    if existing:
        fid = existing["id"]
        conn.execute("""UPDATE facts SET content=?, importance=?, confidence=?, tags=?,
            updated_at=?, source=COALESCE(?, source) WHERE id=?""",
            (fact.get("content", fact["target"]), fact.get("importance", 5),
             fact.get("confidence", 1.0), fact.get("tags", "[]"), now,
             fact.get("source"), fid))
    else:
        conn.execute("""INSERT INTO facts (id, entity, relation, target, content, source,
            confidence, importance, tags, created_at, updated_at, expires_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (fid, fact["entity"], fact["relation"], fact["target"],
             fact.get("content", fact["target"]), fact.get("source", "manual"),
             fact.get("confidence", 1.0), fact.get("importance", 5),
             fact.get("tags", "[]"), fact.get("created_at", now), now,
             fact.get("expires_at")))
    conn.commit()
    fact["id"], fact["updated_at"] = fid, now
    return fact


def list_facts(user_id: str, limit=50, offset=0) -> list:
    rows = get_conn(user_id).execute(
        "SELECT * FROM facts WHERE is_active=1 ORDER BY importance DESC, updated_at DESC LIMIT ? OFFSET ?",
        (limit, offset)).fetchall()
    return [dict(r) for r in rows]


def delete_fact(user_id: str, fact_id: str) -> bool:
    conn = get_conn(user_id)
    conn.execute("UPDATE facts SET is_active=0 WHERE id=?", (fact_id,))
    conn.commit()
    return conn.total_changes > 0


def get_fact(user_id: str, fact_id: str) -> Optional[dict]:
    row = get_conn(user_id).execute(
        "SELECT * FROM facts WHERE id=? AND is_active=1", (fact_id,)).fetchone()
    return dict(row) if row else None


def count_facts(user_id: str) -> int:
    return get_conn(user_id).execute("SELECT COUNT(*) FROM facts WHERE is_active=1").fetchone()[0]


# ── Episode CRUD ──

def save_episode(user_id: str, episode: dict) -> dict:
    conn = get_conn(user_id)
    now = datetime.now(timezone.utc).isoformat()
    eid = episode.get("id") or str(uuid.uuid4())
    conn.execute("""INSERT OR REPLACE INTO episodes (id, title, summary, conversation_id,
        message_count, token_count, emotional_tone, tags, importance, created_at, occurred_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (eid, episode["title"], episode["summary"], episode.get("conversation_id"),
         episode.get("message_count", 0), episode.get("token_count", 0),
         episode.get("emotional_tone", "neutral"), episode.get("tags", "[]"),
         episode.get("importance", 5), episode.get("created_at", now),
         episode.get("occurred_at", now)))
    conn.commit()
    episode["id"] = eid
    return episode


def list_episodes(user_id: str, limit=20, offset=0) -> list:
    rows = get_conn(user_id).execute(
        "SELECT * FROM episodes ORDER BY occurred_at DESC LIMIT ? OFFSET ?",
        (limit, offset)).fetchall()
    return [dict(r) for r in rows]


def delete_episode(user_id: str, episode_id: str) -> bool:
    conn = get_conn(user_id)
    conn.execute("DELETE FROM episodes WHERE id=?", (episode_id,))
    conn.commit()
    return conn.total_changes > 0


# ── Personality CRUD ──

def save_personality(user_id: str, layer: str, key: str, value: str,
                     category="", is_immutable=0, preset_id="") -> dict:
    conn = get_conn(user_id)
    now = datetime.now(timezone.utc).isoformat()
    conn.execute("""INSERT INTO personality (layer, key, value, category, is_immutable,
        preset_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(layer, key) DO UPDATE SET value=excluded.value,
        category=excluded.category, is_immutable=excluded.is_immutable,
        preset_id=excluded.preset_id, updated_at=excluded.updated_at""",
        (layer, key, value, category, is_immutable, preset_id, now, now))
    conn.commit()
    return {"layer": layer, "key": key, "value": value, "updated_at": now}


def load_personality(user_id: str, layer="") -> list:
    conn = get_conn(user_id)
    if layer:
        rows = conn.execute("SELECT * FROM personality WHERE layer=? ORDER BY key", (layer,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM personality ORDER BY layer, key").fetchall()
    return [dict(r) for r in rows]


def load_personality_as_dict(user_id: str, layer="") -> dict:
    return {r["key"]: r["value"] for r in load_personality(user_id, layer)}


def delete_personality_key(user_id: str, layer: str, key: str) -> bool:
    conn = get_conn(user_id)
    row = conn.execute("SELECT is_immutable FROM personality WHERE layer=? AND key=?", (layer, key)).fetchone()
    if row and row["is_immutable"]: return False
    conn.execute("DELETE FROM personality WHERE layer=? AND key=?", (layer, key))
    conn.commit()
    return conn.total_changes > 0


def clear_personality_layer(user_id: str, layer: str, keep_immutable=True):
    conn = get_conn(user_id)
    if keep_immutable:
        conn.execute("DELETE FROM personality WHERE layer=? AND is_immutable=0", (layer,))
    else:
        conn.execute("DELETE FROM personality WHERE layer=?", (layer,))
    conn.commit()


# ── FTS5 Search ──

def search_facts_fts(user_id: str, query: str, limit=10) -> list:
    conn = get_conn(user_id)
    fts_query = " OR ".join(f'"{w}"' for w in query.split() if w)
    if not fts_query: return []
    try:
        rows = conn.execute("""SELECT f.*, rank FROM facts_fts
            JOIN facts f ON f.rowid = facts_fts.rowid
            WHERE facts_fts MATCH ? AND f.is_active=1 ORDER BY rank LIMIT ?""",
            (fts_query, limit)).fetchall()
    except sqlite3.OperationalError: return []
    return [dict(r) for r in rows]


def search_episodes_fts(user_id: str, query: str, limit=5) -> list:
    conn = get_conn(user_id)
    fts_query = " OR ".join(f'"{w}"' for w in query.split() if w)
    if not fts_query: return []
    try:
        rows = conn.execute("""SELECT e.*, rank FROM episodes_fts
            JOIN episodes e ON e.rowid = episodes_fts.rowid
            WHERE episodes_fts MATCH ? ORDER BY rank LIMIT ?""",
            (fts_query, limit)).fetchall()
    except sqlite3.OperationalError: return []
    return [dict(r) for r in rows]


# ── Entity Graph ──

def get_related_facts(user_id: str, entity: str, limit=10) -> list:
    rows = get_conn(user_id).execute(
        "SELECT * FROM facts WHERE (entity=? OR target=?) AND is_active=1 ORDER BY importance DESC LIMIT ?",
        (entity, entity, limit)).fetchall()
    return [dict(r) for r in rows]


def get_fact_relations(user_id: str, entity: str) -> dict:
    facts = get_related_facts(user_id, entity, 100)
    rels = {}
    for f in facts:
        rels.setdefault(f["relation"], []).append(
            {"target": f["target"], "content": f["content"], "id": f["id"]})
    return rels


def get_all_entities(user_id: str) -> list:
    rows = get_conn(user_id).execute(
        "SELECT DISTINCT entity FROM facts WHERE is_active=1 UNION SELECT DISTINCT target FROM facts WHERE is_active=1"
    ).fetchall()
    return [r[0] for r in rows]


# ── Maintenance ──

def cleanup_expired_facts(user_id: str):
    conn = get_conn(user_id)
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE facts SET is_active=0 WHERE expires_at IS NOT NULL AND expires_at < ? AND is_active=1", (now,))
    conn.commit()


def get_stats(user_id: str) -> dict:
    conn = get_conn(user_id)
    return {
        "facts": conn.execute("SELECT COUNT(*) FROM facts WHERE is_active=1").fetchone()[0],
        "episodes": conn.execute("SELECT COUNT(*) FROM episodes").fetchone()[0],
        "personality_keys": conn.execute("SELECT COUNT(*) FROM personality").fetchone()[0],
    }
