# agent_endpoints.py — Agent 记忆/人格/身份/心跳 + 浏览器端点 v1.0 (提取自 engine_server.py)

import time
import asyncio
from datetime import datetime
from pathlib import Path
from fastapi import Query, Request, HTTPException
from engine.agent_memory import read_memory_json, write_memory_json

def register_agent_endpoints(app, engine_dir, tool_registry):
    """注册 Agent 记忆/人格/身份/心跳 + 浏览器路由"""
    MEMORY_DIR = engine_dir / "memory"
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)

    def _read_memory_json(filename: str, user_id: str = "") -> dict:
        return read_memory_json(MEMORY_DIR, filename, user_id)

    def _write_memory_json(filename: str, data: dict, user_id: str = "") -> bool:
        return write_memory_json(MEMORY_DIR, filename, data, user_id)

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
    def _startup_browser():
        """启动时注册浏览器工具,并异步初始化浏览器连接(不阻塞启动)"""
        # 注册浏览器工具到全局注册表(同步操作,不阻塞)
        try:
            from engine.tool_registry import register_browser_tools
            register_browser_tools(tool_registry)
            print("[引擎] 浏览器工具已注册")
        except Exception as e:
            print(f"[引擎] 浏览器工具注册失败: {e}")
        # 浏览器连接放到后台任务,不阻塞启动
        try:
            import asyncio
            async def _lazy_init_browser():
                try:
                    from engine.browser import get_browser_manager
                    bm = get_browser_manager()
                    await bm.connect()
                    print("[引擎] 浏览器管理器已初始化")
                except Exception as e:
                    print(f"[引擎] 浏览器管理器初始化失败(可忽略): {e}")
            asyncio.ensure_future(_lazy_init_browser())
        except Exception as e:
            print(f"[引擎] 浏览器后台初始化失败: {e}")
    
    
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
