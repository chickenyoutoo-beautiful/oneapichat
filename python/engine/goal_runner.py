"""Durable goal continuation runner backed by legacy multi-tool subagents.

Each goal round is represented as a runtime job. The runner is restart-safe: active goals
are redispatched on engine startup, and deterministic agent names retain prior context.
"""
from __future__ import annotations

import re
import threading
import time
from typing import Any, Callable, Optional

from engine.agent_errors import AgentRuntimeError, ErrorCode


_STATUS_RE = re.compile(r"\[GOAL_STATUS:\s*(complete|continue|blocked)\s*\]", re.IGNORECASE)


class DurableGoalRunner:
    def __init__(
        self,
        runtime,
        *,
        create_agent: Callable[[str, str, str], Any],
        run_agent: Callable[[str, str, str, bool], Any],
        get_agent: Callable[[str, str], Optional[dict[str, Any]]],
        stop_agent: Optional[Callable[[str, str], Any]] = None,
        poll_interval: float = 2.0,
        round_timeout: float = 660.0,
    ):
        self.runtime = runtime
        self.create_agent = create_agent
        self.run_agent = run_agent
        self.get_agent = get_agent
        self.stop_agent = stop_agent
        self.poll_interval = max(0.05, float(poll_interval))
        self.round_timeout = max(1.0, float(round_timeout))
        self._threads: dict[str, threading.Thread] = {}
        self._lock = threading.RLock()

    @staticmethod
    def _agent_name(goal_id: str) -> str:
        safe = re.sub(r"[^a-zA-Z0-9_-]", "_", str(goal_id))
        return ("_goal_" + safe)[-96:]

    @staticmethod
    def _round_prompt(goal: dict[str, Any], round_number: int, *, continuation: bool) -> str:
        objective = str(goal.get("objective") or "").strip()
        prefix = "Continue executing" if continuation else "Begin executing"
        return (
            f"{prefix} this durable autonomous goal.\n\n"
            f"OBJECTIVE: {objective}\n"
            f"GOAL ROUND: {round_number}/{goal.get('max_goal_rounds', 8)}\n\n"
            "Do concrete work now. Use available tools when they are needed, verify the result, and do not merely describe a plan. "
            "Preserve existing functionality and report concise evidence. End your final answer with exactly one status line:\n"
            "[GOAL_STATUS: complete] only when the objective is genuinely achieved;\n"
            "[GOAL_STATUS: continue] when useful work remains; or\n"
            "[GOAL_STATUS: blocked] only for a concrete external blocker."
        )

    @staticmethod
    def _result_status(result: str) -> str:
        matches = _STATUS_RE.findall(str(result or ""))
        return matches[-1].lower() if matches else "continue"

    def dispatch(self, goal: Optional[dict[str, Any]]) -> bool:
        if not goal or goal.get("phase") != "active":
            return False
        goal_id = str(goal.get("goal_id") or "")
        if not goal_id:
            return False
        with self._lock:
            current = self._threads.get(goal_id)
            if current and current.is_alive():
                return False
            thread = threading.Thread(target=self._run_goal, args=(goal_id,), daemon=True, name=f"goal-{goal_id[-8:]}")
            self._threads[goal_id] = thread
            thread.start()
        return True

    def resume_active(self) -> int:
        count = 0
        for goal in self.runtime.list_goals(phase="active", limit=1000):
            if self.dispatch(goal):
                count += 1
        return count

    def _finish_goal(self, goal: dict[str, Any], action: str, *, reason: Optional[dict[str, Any]] = None) -> None:
        try:
            self.runtime.update_goal(
                goal["user_id"], goal["goal_id"], int(goal["revision"]), action,
                blocked_reason=reason,
            )
        except AgentRuntimeError as exc:
            if exc.code != ErrorCode.CONFLICT:
                raise

    def _wait_for_agent(self, name: str, user_id: str, goal_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + self.round_timeout
        while time.monotonic() < deadline:
            goal = self.runtime.get_goal(goal_id=goal_id, user_id=user_id)
            if not goal or goal.get("phase") != "active":
                if self.stop_agent:
                    try:
                        self.stop_agent(name, user_id)
                    except Exception:
                        pass
                return {"status": "cancelled", "error": "goal is no longer active"}
            agent = self.get_agent(name, user_id) or {}
            status = str(agent.get("status") or "").lower()
            if status in {"completed", "failed", "error", "stopped", "cancelled", "interrupted"}:
                return agent
            time.sleep(self.poll_interval)
        if self.stop_agent:
            try:
                self.stop_agent(name, user_id)
            except Exception:
                pass
        return {"status": "failed", "error": "goal round timed out"}

    def _run_goal(self, goal_id: str) -> None:
        consecutive_failures = 0
        try:
            while True:
                goal = self.runtime.get_goal(goal_id=goal_id)
                if not goal or goal.get("phase") != "active":
                    return
                rounds_started = int(goal.get("rounds_started") or 0)
                max_rounds = int(goal.get("max_goal_rounds") or 8)
                if rounds_started >= max_rounds:
                    self._finish_goal(goal, "blocked", reason={
                        "code": "GOAL_ROUND_LIMIT",
                        "message": f"goal did not complete within {max_rounds} autonomous rounds",
                    })
                    return

                goal = self.runtime.update_goal(
                    goal["user_id"], goal_id, int(goal["revision"]), "start-round"
                )
                round_number = int(goal.get("rounds_started") or 0)
                job = self.runtime.create_job(
                    goal["user_id"], "goal-round",
                    {"goal_id": goal_id, "round": round_number, "objective": goal["objective"]},
                    session_id=goal["session_id"],
                )
                self.runtime.update_job(job["job_id"], "running", user_id=goal["user_id"])
                self.runtime.append_event(goal["session_id"], "goal/change", {
                    "kind": "round/start", "goal_id": goal_id, "round": round_number,
                })

                name = self._agent_name(goal_id)
                existing = self.get_agent(name, goal["user_id"])
                if existing and str(existing.get("status") or "").lower() == "running" and self.stop_agent:
                    # A process restart can leave the legacy projection marked running even though
                    # its worker thread vanished. Interrupt that stale run before continuing.
                    try:
                        self.stop_agent(name, goal["user_id"])
                    except Exception:
                        pass
                    existing = self.get_agent(name, goal["user_id"]) or existing
                continuation = bool(existing)
                prompt = self._round_prompt(goal, round_number, continuation=continuation)
                try:
                    if not existing:
                        self.create_agent(name, prompt, goal["user_id"])
                        run_result = self.run_agent(name, goal["user_id"], "", False)
                    else:
                        run_result = self.run_agent(name, goal["user_id"], prompt, True)
                    if isinstance(run_result, dict) and run_result.get("error"):
                        raise AgentRuntimeError(ErrorCode.PROVIDER_UNAVAILABLE, str(run_result["error"]), status=503)
                    agent = self._wait_for_agent(name, goal["user_id"], goal_id)
                    agent_status = str(agent.get("status") or "").lower()
                    if agent_status != "completed":
                        raise AgentRuntimeError(
                            ErrorCode.CANCELLED if agent_status in {"cancelled", "stopped"} else ErrorCode.INTERNAL,
                            str(agent.get("error") or agent.get("result") or "goal round failed"),
                            status=499 if agent_status in {"cancelled", "stopped"} else 500,
                        )
                    result = str(agent.get("result") or "").strip()
                    status = self._result_status(result)
                    consecutive_failures = 0
                    self.runtime.update_job(job["job_id"], "completed", result={
                        "goal_id": goal_id, "round": round_number, "status": status, "content": result,
                    }, user_id=goal["user_id"])
                    self.runtime.append_event(goal["session_id"], "assistant/message", {
                        "content": result, "goal_id": goal_id, "goal_round": round_number,
                        "kind": "goal-round-result",
                    })
                    self.runtime.append_event(goal["session_id"], "goal/change", {
                        "kind": "round/end", "goal_id": goal_id, "round": round_number, "status": status,
                    })
                    latest = self.runtime.get_goal(goal_id=goal_id, user_id=goal["user_id"])
                    if not latest or latest.get("phase") != "active":
                        return
                    if status == "complete":
                        self._finish_goal(latest, "complete")
                        return
                    if status == "blocked":
                        self._finish_goal(latest, "blocked", reason={
                            "code": "AGENT_REPORTED_BLOCKED", "message": result[-2000:] or "goal worker reported a blocker",
                        })
                        return
                    # Continue immediately while the durable goal remains active.
                except Exception as exc:
                    error = exc.to_dict() if isinstance(exc, AgentRuntimeError) else {
                        "code": "GOAL_ROUND_FAILED", "message": str(exc),
                    }
                    try:
                        self.runtime.update_job(job["job_id"], "failed", error=error, user_id=goal["user_id"])
                    except Exception:
                        pass
                    latest = self.runtime.get_goal(goal_id=goal_id, user_id=goal["user_id"])
                    if not latest or latest.get("phase") != "active":
                        return
                    consecutive_failures += 1
                    self.runtime.append_event(goal["session_id"], "goal/change", {
                        "kind": "round/error", "goal_id": goal_id, "round": round_number,
                        "consecutive_failures": consecutive_failures, "error": error,
                    })
                    if consecutive_failures >= 3 or int(latest.get("rounds_started") or 0) >= int(latest.get("max_goal_rounds") or 8):
                        self._finish_goal(latest, "blocked", reason=error)
                        return
                    time.sleep(min(8.0, 2.0 * consecutive_failures))
                    continue
        finally:
            with self._lock:
                current = self._threads.get(goal_id)
                if current is threading.current_thread():
                    self._threads.pop(goal_id, None)
