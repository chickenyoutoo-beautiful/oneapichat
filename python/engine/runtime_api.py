"""FastAPI surface for the durable OneAPIChat agent runtime."""
from __future__ import annotations

import asyncio
import inspect
import json
import time
from typing import Any, Optional

from fastapi import Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from engine.agent_errors import AgentRuntimeError, ErrorCode, as_error_payload
from engine.runtime_store import AgentRuntimeStore, KNOWN_EVENT_TYPES


def _json_response_error(error: BaseException) -> JSONResponse:
    status, payload = as_error_payload(error)
    return JSONResponse(payload, status_code=status, headers={"Cache-Control": "no-store"})


def register_runtime_endpoints(app, runtime: AgentRuntimeStore, tool_registry=None, goal_dispatcher=None) -> None:
    """Register event, projection, job, goal, subagent, and capability endpoints."""

    @app.exception_handler(AgentRuntimeError)
    async def _runtime_error_handler(_request: Request, exc: AgentRuntimeError):
        return _json_response_error(exc)

    @app.get("/engine/runtime/health")
    def runtime_health(user_id: str = Query("")):
        return {"ok": True, "runtime": runtime.stats(user_id or None), "time": time.time()}

    @app.get("/engine/runtime/capabilities")
    def runtime_capabilities(user_id: str = Query("")):
        tools = []
        if tool_registry is not None:
            try:
                tools = tool_registry.to_dict().get("tools", [])
            except Exception:
                try:
                    tools = [item.to_dict() for item in tool_registry.list_all()]
                except Exception:
                    tools = []
        return {
            "ok": True,
            "protocol": "oneapichat-agent-runtime/1",
            "dsh_semantics": {
                "event_source": True,
                "projection_watermark": True,
                "jobs": True,
                "goal_cas": True,
                "continuable_subagents": True,
                "stable_error_codes": True,
                "tool_pipeline": True,
            },
            "event_types": sorted(KNOWN_EVENT_TYPES),
            "tools": tools,
        }

    @app.get("/engine/runtime/plugins")
    def runtime_plugins(user_id: str = Query("")):
        """DSH-inspired plugin inventory for host/client capability discovery."""
        return {
            "ok": True,
            "revision": 1,
            "plugins": [
                {
                    "id": "oneapichat.runtime.core",
                    "name": "Agent Runtime Core",
                    "version": "1.0.0",
                    "side": "host",
                    "capabilities": ["sessions", "events", "projections", "jobs", "goals", "subagents"],
                    "enabled": True,
                },
                {
                    "id": "oneapichat.tools.compat",
                    "name": "Tool Compatibility Layer",
                    "version": "1.0.0",
                    "side": "host-client",
                    "capabilities": ["openai-tools", "mcp", "dsh-tool-contract"],
                    "enabled": True,
                    "client": {
                        "entrypoint": "/oneapichat/js/tools-exec.js",
                        "global": "executeToolCallForRetry",
                        "lazy": False,
                    },
                },
                {
                    "id": "oneapichat.providers",
                    "name": "Multi-provider LLM Adapters",
                    "version": "1.0.0",
                    "side": "host",
                    "capabilities": ["deepseek", "openai-compatible", "anthropic", "gemini-compatible"],
                    "enabled": True,
                },
            ],
        }

    @app.post("/engine/runtime/sessions")
    async def runtime_session_create(request: Request, user_id: str = Query("")):
        body = await request.json()
        session = runtime.ensure_session(
            user_id,
            str(body.get("chat_id") or ""),
            parent_session_id=body.get("parent_session_id"),
            origin=str(body.get("origin") or "chat"),
            delegation_depth=int(body.get("delegation_depth") or 0),
            provider=str(body.get("provider") or ""),
            model=str(body.get("model") or ""),
        )
        return {"ok": True, "session": session}

    @app.get("/engine/runtime/sessions")
    def runtime_session_list(user_id: str = Query(""), limit: int = Query(50)):
        return {"ok": True, "sessions": runtime.list_sessions(user_id, limit=limit)}

    @app.get("/engine/runtime/sessions/{session_id}")
    def runtime_session_get(session_id: str, user_id: str = Query("")):
        return {"ok": True, "session": runtime.get_session(session_id, user_id=user_id)}

    @app.get("/engine/runtime/sessions/{session_id}/events")
    def runtime_events(
        session_id: str,
        user_id: str = Query(""),
        after: int = Query(-1),
        limit: int = Query(1000),
    ):
        events = runtime.list_events(session_id, user_id=user_id, after=after, limit=limit)
        return {
            "ok": True,
            "session_id": session_id,
            "events": events,
            "watermark": events[-1]["seq"] if events else after,
        }

    @app.post("/engine/runtime/sessions/{session_id}/events")
    async def runtime_event_append(session_id: str, request: Request, user_id: str = Query("")):
        runtime.get_session(session_id, user_id=user_id)
        body = await request.json()
        event = runtime.append_event(
            session_id,
            str(body.get("type") or ""),
            body.get("data") if isinstance(body.get("data"), dict) else {},
            ignorable=bool(body.get("ignorable", False)),
            surface_op=body.get("surface_op"),
            source_event_seqs=body.get("source_event_seqs") or [],
        )
        return {"ok": True, "event": event.to_dict()}

    @app.get("/engine/runtime/sessions/{session_id}/projection")
    def runtime_projection(session_id: str, user_id: str = Query("")):
        return {"ok": True, "projection": runtime.get_projection(session_id, user_id=user_id)}

    @app.get("/engine/runtime/sessions/{session_id}/stream")
    async def runtime_event_stream(
        request: Request,
        session_id: str,
        user_id: str = Query(""),
        after: int = Query(-1),
    ):
        runtime.get_session(session_id, user_id=user_id)

        async def generate():
            cursor = int(after)
            initial = runtime.get_projection(session_id, user_id=user_id)
            yield "event: projection\ndata: " + json.dumps(initial, ensure_ascii=False) + "\n\n"
            while True:
                if await request.is_disconnected():
                    break
                events = await asyncio.to_thread(
                    runtime.wait_for_events,
                    session_id,
                    user_id=user_id,
                    after=cursor,
                    timeout=15.0,
                    limit=1000,
                )
                if not events:
                    yield f"event: ping\ndata: {json.dumps({'time': time.time()})}\n\n"
                    continue
                for event in events:
                    cursor = max(cursor, int(event["seq"]))
                    yield "event: session/event\ndata: " + json.dumps(event, ensure_ascii=False) + "\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-store",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @app.get("/engine/runtime/jobs")
    def runtime_jobs_list(
        user_id: str = Query(""),
        session_id: Optional[str] = Query(None),
        limit: int = Query(100),
    ):
        return {"ok": True, "jobs": runtime.list_jobs(user_id, session_id=session_id, limit=limit)}

    @app.get("/engine/runtime/jobs/{job_id}")
    def runtime_job_get(job_id: str, user_id: str = Query("")):
        return {"ok": True, "job": runtime.get_job(job_id, user_id=user_id)}

    @app.post("/engine/runtime/jobs/{job_id}/cancel")
    async def runtime_job_cancel(job_id: str, request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            body = {}
        job = runtime.request_job_cancel(job_id, user_id=user_id, reason=str(body.get("reason") or ""))
        return {"ok": True, "job": job}

    async def _dispatch_goal(goal: Optional[dict[str, Any]]) -> None:
        if not goal_dispatcher or not goal or goal.get("phase") != "active":
            return
        result = goal_dispatcher(goal)
        if inspect.isawaitable(result):
            await result

    @app.post("/engine/runtime/goals")
    async def runtime_goal_create(request: Request, user_id: str = Query("")):
        body = await request.json()
        goal = runtime.create_goal(
            user_id,
            str(body.get("session_id") or ""),
            str(body.get("objective") or ""),
            max_goal_rounds=int(body.get("max_goal_rounds") or 8),
        )
        await _dispatch_goal(goal)
        return {"ok": True, "goal": goal}

    @app.get("/engine/runtime/goals")
    def runtime_goals_list(
        user_id: str = Query(""), session_id: Optional[str] = Query(None),
        phase: Optional[str] = Query(None), limit: int = Query(100),
    ):
        return {"ok": True, "goals": runtime.list_goals(
            user_id=user_id, session_id=session_id, phase=phase, limit=limit,
        )}

    @app.get("/engine/runtime/goals/current")
    def runtime_goal_current(
        user_id: str = Query(""),
        session_id: str = Query(...),
    ):
        return {"ok": True, "goal": runtime.get_goal(session_id=session_id, user_id=user_id)}

    @app.post("/engine/runtime/goals/{goal_id}")
    async def runtime_goal_update(goal_id: str, request: Request, user_id: str = Query("")):
        body = await request.json()
        goal = runtime.update_goal(
            user_id,
            goal_id,
            int(body.get("revision") or 0),
            str(body.get("action") or ""),
            objective=body.get("objective"),
            max_goal_rounds=body.get("max_goal_rounds"),
            blocked_reason=body.get("blocked_reason"),
        )
        if str(body.get("action") or "") in {"resume", "arm", "edit"}:
            await _dispatch_goal(goal)
        return {"ok": True, "goal": goal}

    @app.post("/engine/runtime/subagents")
    async def runtime_subagent_create(request: Request, user_id: str = Query("")):
        body = await request.json()
        parent_session_id = str(body.get("parent_session_id") or body.get("session_id") or "")
        if not parent_session_id:
            raise AgentRuntimeError(ErrorCode.BAD_REQUEST, "parent_session_id is required", status=400)
        subagent = runtime.create_subagent(
            user_id,
            parent_session_id,
            str(body.get("label") or body.get("description") or "subagent"),
            str(body.get("prompt") or ""),
            role=str(body.get("role") or "general"),
            provider=str(body.get("provider") or ""),
            model=str(body.get("model") or ""),
        )
        return {"ok": True, "subagent": subagent}

    @app.get("/engine/runtime/subagents")
    def runtime_subagents_list(
        user_id: str = Query(""),
        parent_session_id: Optional[str] = Query(None),
        descendants: bool = Query(False),
    ):
        return {
            "ok": True,
            "subagents": runtime.list_subagents(
                user_id,
                parent_session_id=parent_session_id,
                include_descendants=descendants,
            ),
        }

    @app.get("/engine/runtime/subagents/{agent_id}")
    def runtime_subagent_get(agent_id: str, user_id: str = Query("")):
        return {"ok": True, "subagent": runtime.get_subagent(agent_id, user_id=user_id)}

    @app.post("/engine/runtime/subagents/{agent_id}/followup")
    async def runtime_subagent_followup(agent_id: str, request: Request, user_id: str = Query("")):
        body = await request.json()
        return runtime.enqueue_subagent_message(agent_id, user_id, str(body.get("content") or body.get("message") or ""))

    @app.post("/engine/runtime/subagents/{agent_id}/interrupt")
    async def runtime_subagent_interrupt(agent_id: str, request: Request, user_id: str = Query("")):
        try:
            body = await request.json()
        except Exception:
            body = {}
        subagent = runtime.request_subagent_cancel(agent_id, user_id, str(body.get("reason") or ""))
        return {"ok": True, "subagent": subagent}

    @app.post("/engine/runtime/maintenance/prune")
    async def runtime_prune(request: Request, user_id: str = Query("")):
        body = await request.json()
        # Auth middleware protects this route. Pruning is global because rows are
        # already owner-isolated and the operation only removes expired terminal data.
        result = runtime.prune(retention_days=int(body.get("retention_days") or 90))
        return {"ok": True, "removed": result}
