"""
OneAPIChat Memory System — FastAPI endpoint registration.
Called from engine_server.py at startup.
"""
from fastapi import Query, Request, HTTPException
from engine.memory_db import init_memory_db_dir
from engine.memory_engine import (
    init_memory_engine, engine_save_fact, engine_delete_fact, engine_save_episode,
    hybrid_search, build_context, engine_cleanup, list_facts, list_episodes,
    delete_episode,
)
from engine.personality import (
    apply_preset, get_personality_context, list_presets,
    validate_against_constitution, update_narrative, update_cache, update_state,
)
from engine.memory_db import (
    save_personality, load_personality, delete_personality_key, get_stats,
)


def register_memory_endpoints(app, engine_dir):
    """Register new memory system endpoints on the FastAPI app."""
    engine_dir_path = engine_dir
    init_memory_engine(engine_dir_path)

    # ── Memory Engine: Facts ──────────────────────────

    @app.post("/engine/memory/fact/save")
    async def mem_fact_save(request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "无效的 JSON 请求体")
        if not body.get("entity") or not body.get("relation") or not body.get("target"):
            raise HTTPException(400, "entity, relation, target 不能为空")
        result = engine_save_fact(user_id, dict(body))
        return {"ok": True, "fact": result}

    @app.get("/engine/memory/fact/list")
    def mem_fact_list(user_id: str = Query(""), limit: int = Query(50), offset: int = Query(0)):
        facts = list_facts(user_id, limit=limit, offset=offset)
        return {"ok": True, "facts": facts, "total": len(facts)}

    @app.post("/engine/memory/fact/delete")
    async def mem_fact_delete(request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "无效的 JSON 请求体")
        fid = body.get("id", "")
        if not fid:
            raise HTTPException(400, "缺少 id")
        ok = engine_delete_fact(user_id, fid)
        return {"ok": ok}

    # ── Memory Engine: Episodes ───────────────────────

    @app.post("/engine/memory/episode/save")
    async def mem_episode_save(request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "无效的 JSON 请求体")
        if not body.get("title") or not body.get("summary"):
            raise HTTPException(400, "title, summary 不能为空")
        result = engine_save_episode(user_id, dict(body))
        return {"ok": True, "episode": result}

    @app.get("/engine/memory/episode/list")
    def mem_episode_list(user_id: str = Query(""), limit: int = Query(20), offset: int = Query(0)):
        episodes = list_episodes(user_id, limit=limit, offset=offset)
        return {"ok": True, "episodes": episodes, "total": len(episodes)}

    @app.post("/engine/memory/episode/delete")
    async def mem_episode_delete(request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "无效的 JSON 请求体")
        eid = body.get("id", "")
        if not eid:
            raise HTTPException(400, "缺少 id")
        ok = delete_episode(user_id, eid)
        return {"ok": ok}

    # ── Memory Engine: Hybrid Search ──────────────────

    @app.get("/engine/memory/hybrid_search")
    def mem_hybrid_search(
        user_id: str = Query(""),
        q: str = Query(""),
        limit: int = Query(10),
        layers: str = Query(""),
        threshold: float = Query(0.0),
    ):
        layer_list = layers.split(",") if layers else None
        result = hybrid_search(user_id, query=q, layers=layer_list, limit=limit, threshold=threshold)
        return {"ok": True, **result}

    # ── Memory Engine: Context Builder ────────────────

    @app.get("/engine/memory/context")
    def mem_context(
        user_id: str = Query(""),
        q: str = Query(""),
        max_facts: int = Query(15),
        max_episodes: int = Query(5),
    ):
        context = build_context(user_id, query=q, max_facts=max_facts, max_episodes=max_episodes)
        return {"ok": True, "context": context}

    # ── Memory Engine: Extraction ─────────────────────

    @app.post("/engine/memory/extract")
    async def mem_extract(request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "无效的 JSON 请求体")
        messages = body.get("messages", [])
        if not messages:
            raise HTTPException(400, "缺少 messages")
        from engine.memory_engine import engine_extract_from_conversation
        result = engine_extract_from_conversation(user_id, messages)
        return {"ok": True, **result}

    # ── Memory Engine: Stats ──────────────────────────

    @app.get("/engine/memory/stats")
    def mem_stats(user_id: str = Query("")):
        return {"ok": True, "stats": get_stats(user_id)}

    # ── Memory Engine: Migrate ────────────────────────

    @app.post("/engine/memory/v1/migrate")
    async def mem_migrate(request: Request, user_id: str = Query("")):
        """Trigger migration from old JSON files for a user."""
        try:
            from engine.memory_migration import migrate_user
            result = migrate_user(user_id)
            return {"ok": True, "migration": result}
        except ImportError:
            return {"ok": False, "error": "memory_migration.py not found"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── Personality: Presets ──────────────────────────

    @app.get("/engine/personality/presets")
    def pers_presets():
        return {"ok": True, "presets": list_presets()}

    @app.post("/engine/personality/set_preset")
    async def pers_set_preset(request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "无效的 JSON 请求体")
        preset_id = body.get("preset", "default")
        try:
            result = apply_preset(user_id, preset_id)
            return {"ok": True, **result}
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.get("/engine/personality/load")
    def pers_load(user_id: str = Query("")):
        ctx = get_personality_context(user_id)
        return {"ok": True, "personality": ctx}

    @app.post("/engine/personality/save")
    async def pers_save(request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "无效的 JSON 请求体")
        layer = body.get("layer", "")
        key = body.get("key", "")
        value = body.get("value", "")
        if not layer or not key:
            raise HTTPException(400, "缺少 layer 或 key")
        is_immutable = int(body.get("is_immutable", 0))
        result = save_personality(user_id, layer, key, value,
                                  body.get("category", ""), is_immutable,
                                  body.get("preset_id", ""))
        return {"ok": True, "personality": result}

    @app.post("/engine/personality/validate")
    async def pers_validate(request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "无效的 JSON 请求体")
        content = body.get("content", "")
        result = validate_against_constitution(user_id, content)
        return {"ok": True, **result}

    # ── Personality: Layer Updates ────────────────────

    @app.post("/engine/personality/narrative")
    async def pers_narrative_update(request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "无效 JSON")
        result = update_narrative(user_id, body.get("key", ""), body.get("value", ""))
        return {"ok": True, "personality": result}

    @app.post("/engine/personality/cache")
    async def pers_cache_update(request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "无效 JSON")
        result = update_cache(user_id, body.get("key", ""), body.get("value", ""))
        return {"ok": True, "personality": result}

    @app.post("/engine/personality/state")
    async def pers_state_update(request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "无效 JSON")
        result = update_state(user_id, body.get("key", ""), body.get("value", ""))
        return {"ok": True, "personality": result}

    # ── Cleanup ───────────────────────────────────────

    @app.post("/engine/memory/cleanup")
    async def mem_cleanup(request: Request, user_id: str = Query("")):
        engine_cleanup(user_id)
        return {"ok": True}

    print("[MemoryEndpoints] Registered — 18 endpoints for memory + personality")
