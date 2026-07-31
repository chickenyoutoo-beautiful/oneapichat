"""
OneAPIChat Memory System — Migration Tool
Reads old JSON files and imports into new SQLite + chromadb system.
Run: python3 -m engine.memory_migration [user_id]
"""
import json, sys
from pathlib import Path
from datetime import datetime, timezone

# Paths relative to project root
PROJECT_ROOT = Path("/var/www/html/oneapichat")
ENGINE_MEMORY_DIR = PROJECT_ROOT / ".engine" / "memory"
USERS_DIR = PROJECT_ROOT / "users"


def migrate_all():
    """Migrate all users' data."""
    results = {}

    # Find all users from memory files
    user_ids = set()

    # PHP memory files
    for f in USERS_DIR.glob("memories_*.json"):
        uid = f.stem.replace("memories_", "")
        user_ids.add(uid)

    # Engine memory files
    for f in ENGINE_MEMORY_DIR.glob("user_*_agent_memory.json"):
        parts = f.stem.split("_")
        # user_{userId}_agent_memory -> userId may contain underscores
        uid = "_".join(parts[1:-2])
        user_ids.add(uid)

    # Also check for global files
    for f in ENGINE_MEMORY_DIR.glob("agent_*.json"):
        global_uid = "global"
        if global_uid not in results:
            results[global_uid] = migrate_user(global_uid)

    for uid in sorted(user_ids):
        if uid:
            results[uid] = migrate_user(uid)

    return results


def migrate_user(user_id: str) -> dict:
    """Migrate a single user's data. Idempotent — safe to re-run."""
    from engine.memory_db import (
        init_memory_db_dir, save_fact, save_episode, save_personality, get_stats,
    )
    from engine.memory_engine import init_memory_engine, engine_save_fact

    init_memory_db_dir(PROJECT_ROOT / ".engine")

    stats = {"php_memories": 0, "engine_memories": 0, "persona": 0, "identity": 0}

    # 1. Migrate PHP memory_api.php data
    php_file = USERS_DIR / f"memories_{user_id}.json"
    if php_file.exists():
        try:
            data = json.loads(php_file.read_text(encoding="utf-8"))
            for mem in data.get("memories", []):
                fact = {
                    "entity": "user",
                    "relation": mem.get("key", "unknown"),
                    "target": mem.get("content", ""),
                    "content": mem.get("content", ""),
                    "source": "import",
                    "importance": 5,
                    "created_at": mem.get("created_at", datetime.now(timezone.utc).isoformat()),
                    "updated_at": mem.get("updated_at", datetime.now(timezone.utc).isoformat()),
                }
                save_fact(user_id, fact)
                stats["php_memories"] += 1
        except Exception as e:
            print(f"  ⚠ PHP migration error: {e}")

    # 2. Migrate Python engine agent_memory.json
    agent_file = ENGINE_MEMORY_DIR / f"user_{user_id}_agent_memory.json"
    if not agent_file.exists():
        agent_file = ENGINE_MEMORY_DIR / "agent_memory.json"  # global fallback
    if agent_file.exists():
        try:
            data = json.loads(agent_file.read_text(encoding="utf-8"))
            for entry in data.get("entries", []):
                fact = {
                    "entity": "conversation",
                    "relation": entry.get("key", "unknown"),
                    "target": entry.get("content", ""),
                    "content": entry.get("content", ""),
                    "source": "import",
                    "importance": 5,
                    "tags": json.dumps(entry.get("tags", [])),
                    "created_at": entry.get("created_at", datetime.now(timezone.utc).isoformat()),
                    "updated_at": entry.get("updated_at", datetime.now(timezone.utc).isoformat()),
                }
                save_fact(user_id, fact)
                stats["engine_memories"] += 1
        except Exception as e:
            print(f"  ⚠ Engine memory migration error: {e}")

    # 3. Migrate persona
    persona_file = ENGINE_MEMORY_DIR / f"user_{user_id}_agent_persona.json"
    if not persona_file.exists():
        persona_file = ENGINE_MEMORY_DIR / "agent_persona.json"
    if persona_file.exists():
        try:
            data = json.loads(persona_file.read_text(encoding="utf-8"))
            for key, value in data.items():
                if key in ("updated_at", "created_at"):
                    continue
                if key == "preferences" and isinstance(value, dict):
                    for pk, pv in value.items():
                        save_personality(user_id, "constitution", pk, str(pv),
                                        category="preference", preset_id="imported")
                else:
                    save_personality(user_id, "constitution", key, str(value),
                                    category="identity" if key in ("name", "style") else "config",
                                    preset_id="imported")
            stats["persona"] += 1
        except Exception as e:
            print(f"  ⚠ Persona migration error: {e}")

    # 4. Migrate identity
    ident_file = ENGINE_MEMORY_DIR / f"user_{user_id}_agent_identity.json"
    if not ident_file.exists():
        ident_file = ENGINE_MEMORY_DIR / "agent_identity.json"
    if ident_file.exists():
        try:
            data = json.loads(ident_file.read_text(encoding="utf-8"))
            for key, value in data.items():
                if key in ("updated_at", "created_at"):
                    continue
                save_personality(user_id, "narrative", key, str(value),
                                category="identity", preset_id="imported")
            stats["identity"] += 1
        except Exception as e:
            print(f"  ⚠ Identity migration error: {e}")

    # Final stats
    db_stats = get_stats(user_id)
    print(f"  User {user_id}: imported {stats}, DB status: {db_stats}")
    return stats


if __name__ == "__main__":
    import os
    sys.path.insert(0, str(PROJECT_ROOT / "python"))

    if len(sys.argv) > 1:
        uid = sys.argv[1]
        print(f"Migrating user: {uid}")
        result = migrate_user(uid)
        print(f"Done: {result}")
    else:
        print("Migrating all users...")
        results = migrate_all()
        total = {
            "php": sum(r.get("php_memories", 0) for r in results.values()),
            "engine": sum(r.get("engine_memories", 0) for r in results.values()),
            "persona": sum(r.get("persona", 0) for r in results.values()),
            "identity": sum(r.get("identity", 0) for r in results.values()),
        }
        print(f"\n✅ Migration complete: {len(results)} users")
        print(f"   PHP memories: {total['php']}")
        print(f"   Engine memories: {total['engine']}")
        print(f"   Persona: {total['persona']}")
        print(f"   Identity: {total['identity']}")
