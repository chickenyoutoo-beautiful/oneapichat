"""Validated DSH-style tool execution pipeline.

Stages: pre-execute/approval -> timeout-wrapped execute -> post-execute -> result
observation. Canonical JSON is stored in the runtime event log while presentation
metadata remains a pure view hint for the browser.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from engine.agent_errors import AgentRuntimeError, ErrorCode, redact_secrets
from engine.tool_registry import ApprovalKind, ToolDef, ToolRegistry


@dataclass
class ToolExecutionContext:
    user_id: str
    session_id: str = ""
    call_id: str = field(default_factory=lambda: f"call_{uuid.uuid4().hex}")
    agent_id: str = ""
    mode: str = "agent"
    approved: bool = False
    cancel_event: threading.Event = field(default_factory=threading.Event)
    metadata: dict[str, Any] = field(default_factory=dict)

    def throw_if_cancelled(self) -> None:
        if self.cancel_event.is_set():
            raise AgentRuntimeError(ErrorCode.CANCELLED, "tool execution cancelled", status=499)


@dataclass(frozen=True)
class ToolExecutionResult:
    call_id: str
    name: str
    ok: bool
    value: Any = None
    error: Optional[dict[str, Any]] = None
    meta: dict[str, Any] = field(default_factory=dict)
    presentation: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        result = {
            "call_id": self.call_id,
            "name": self.name,
            "ok": self.ok,
            "value": redact_secrets(self.value),
            "meta": redact_secrets(self.meta),
            "presentation": redact_secrets(self.presentation),
        }
        if self.error is not None:
            result["error"] = redact_secrets(self.error)
        return result


def _type_matches(value: Any, expected: str) -> bool:
    mapping = {
        "object": lambda item: isinstance(item, dict),
        "array": lambda item: isinstance(item, list),
        "string": lambda item: isinstance(item, str),
        "number": lambda item: isinstance(item, (int, float)) and not isinstance(item, bool),
        "integer": lambda item: isinstance(item, int) and not isinstance(item, bool),
        "boolean": lambda item: isinstance(item, bool),
        "null": lambda item: item is None,
    }
    checker = mapping.get(expected)
    return checker(value) if checker else True


def validate_json_schema(value: Any, schema: Optional[dict[str, Any]], path: str = "$", *, code: ErrorCode = ErrorCode.INVALID_TOOL_ARGUMENTS) -> None:
    """Validate the JSON Schema subset used by OneAPIChat and MCP tools."""
    if not schema:
        return
    expected = schema.get("type")
    if isinstance(expected, list):
        if not any(_type_matches(value, item) for item in expected):
            raise AgentRuntimeError(code, f"{path}: expected one of {expected}", status=400)
    elif isinstance(expected, str) and not _type_matches(value, expected):
        raise AgentRuntimeError(code, f"{path}: expected {expected}", status=400)
    if "enum" in schema and value not in schema["enum"]:
        raise AgentRuntimeError(code, f"{path}: value is not in enum", status=400)
    if "const" in schema and value != schema["const"]:
        raise AgentRuntimeError(code, f"{path}: value does not match const", status=400)
    if isinstance(value, dict):
        required = schema.get("required") or []
        for key in required:
            if key not in value:
                raise AgentRuntimeError(code, f"{path}.{key}: required field missing", status=400)
        properties = schema.get("properties") or {}
        for key, item in value.items():
            child_schema = properties.get(key)
            if child_schema:
                validate_json_schema(item, child_schema, f"{path}.{key}", code=code)
            elif schema.get("additionalProperties") is False:
                raise AgentRuntimeError(code, f"{path}.{key}: additional property not allowed", status=400)
    if isinstance(value, list) and schema.get("items"):
        for index, item in enumerate(value):
            validate_json_schema(item, schema["items"], f"{path}[{index}]", code=code)
    if isinstance(value, str):
        if schema.get("minLength") is not None and len(value) < int(schema["minLength"]):
            raise AgentRuntimeError(code, f"{path}: string is too short", status=400)
        if schema.get("maxLength") is not None and len(value) > int(schema["maxLength"]):
            raise AgentRuntimeError(code, f"{path}: string is too long", status=400)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if schema.get("minimum") is not None and value < schema["minimum"]:
            raise AgentRuntimeError(code, f"{path}: below minimum", status=400)
        if schema.get("maximum") is not None and value > schema["maximum"]:
            raise AgentRuntimeError(code, f"{path}: above maximum", status=400)


class ToolExecutionPipeline:
    def __init__(
        self,
        registry: ToolRegistry,
        *,
        runtime_store=None,
        max_workers: int = 16,
    ):
        self.registry = registry
        self.runtime_store = runtime_store
        self.executor = ThreadPoolExecutor(max_workers=max(1, int(max_workers)), thread_name_prefix="tool")
        self._pre_hooks: list[Callable[[ToolDef, dict[str, Any], ToolExecutionContext], Any]] = []
        self._post_hooks: list[Callable[[ToolDef, Any, ToolExecutionContext], Any]] = []
        self._result_hooks: list[Callable[[ToolExecutionResult, ToolExecutionContext], Any]] = []
        self._tool_locks: dict[str, threading.RLock] = {}
        self._locks_guard = threading.RLock()

    def add_pre_hook(self, hook: Callable[[ToolDef, dict[str, Any], ToolExecutionContext], Any]) -> Callable[[], None]:
        self._pre_hooks.append(hook)
        return lambda: self._pre_hooks.remove(hook) if hook in self._pre_hooks else None

    def add_post_hook(self, hook: Callable[[ToolDef, Any, ToolExecutionContext], Any]) -> Callable[[], None]:
        self._post_hooks.append(hook)
        return lambda: self._post_hooks.remove(hook) if hook in self._post_hooks else None

    def add_result_hook(self, hook: Callable[[ToolExecutionResult, ToolExecutionContext], Any]) -> Callable[[], None]:
        self._result_hooks.append(hook)
        return lambda: self._result_hooks.remove(hook) if hook in self._result_hooks else None

    def _lock_for(self, name: str) -> threading.RLock:
        with self._locks_guard:
            return self._tool_locks.setdefault(name, threading.RLock())

    @staticmethod
    def _normalize_args(arguments: Any) -> dict[str, Any]:
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments or "{}")
            except json.JSONDecodeError as exc:
                raise AgentRuntimeError(
                    ErrorCode.INVALID_TOOL_ARGUMENTS,
                    f"invalid JSON arguments: {exc.msg}",
                    status=400,
                    details={"line": exc.lineno, "column": exc.colno},
                ) from exc
        if not isinstance(arguments, dict):
            raise AgentRuntimeError(ErrorCode.INVALID_TOOL_ARGUMENTS, "tool arguments must be an object", status=400)
        return json.loads(json.dumps(arguments, ensure_ascii=False, allow_nan=False))

    @staticmethod
    def _invoke_handler(handler: Callable[..., Any], args: dict[str, Any], context: ToolExecutionContext) -> Any:
        try:
            signature = inspect.signature(handler)
            positional = [
                parameter for parameter in signature.parameters.values()
                if parameter.kind in (parameter.POSITIONAL_ONLY, parameter.POSITIONAL_OR_KEYWORD)
            ]
            result = handler(args, context) if len(positional) >= 2 else handler(args)
        except (TypeError, ValueError):
            result = handler(args, context)
        if inspect.isawaitable(result):
            result = asyncio.run(result)
        return result

    def _append_event(self, session_id: str, event_type: str, data: dict[str, Any]) -> None:
        if not self.runtime_store or not session_id:
            return
        try:
            self.runtime_store.append_event(session_id, event_type, data)
        except Exception:
            # Tool execution should not be converted to failure by optional telemetry.
            pass

    def execute(
        self,
        name: str,
        arguments: Any,
        context: ToolExecutionContext,
        *,
        handler: Optional[Callable[..., Any]] = None,
    ) -> ToolExecutionResult:
        started = time.monotonic()
        tool = self.registry.get(name)
        if tool is None or not tool.enabled:
            raise AgentRuntimeError(ErrorCode.TOOL_NOT_FOUND, f"tool not found: {name}", status=404)
        args = self._normalize_args(arguments)
        validate_json_schema(args, tool.parameters)
        context.throw_if_cancelled()

        if tool.approval == ApprovalKind.REQUIRED and not context.approved:
            raise AgentRuntimeError(ErrorCode.TOOL_REJECTED, f"tool requires explicit approval: {name}", status=403)

        for hook in list(self._pre_hooks):
            decision = hook(tool, args, context)
            if isinstance(decision, dict):
                if decision.get("allow") is False:
                    raise AgentRuntimeError(
                        ErrorCode.TOOL_REJECTED,
                        str(decision.get("reason") or "tool rejected by policy"),
                        status=403,
                    )
                if isinstance(decision.get("arguments"), dict):
                    args = decision["arguments"]
                    validate_json_schema(args, tool.parameters)
            elif decision is False:
                raise AgentRuntimeError(ErrorCode.TOOL_REJECTED, "tool rejected by policy", status=403)

        self._append_event(context.session_id, "tool/call", {
            "call_id": context.call_id,
            "name": tool.name,
            "arguments": json.dumps(redact_secrets(args), ensure_ascii=False, separators=(",", ":")),
        })
        actual_handler = handler or tool.handler
        if actual_handler is None:
            error = AgentRuntimeError(ErrorCode.TOOL_NOT_FOUND, f"tool has no server handler: {name}", status=501)
            self._append_event(context.session_id, "tool/result", {
                "call_id": context.call_id, "name": name, "error": error.to_dict(),
            })
            raise error

        lock = self._lock_for(name)

        def run_handler():
            context.throw_if_cancelled()
            if tool.is_concurrency_safe:
                return self._invoke_handler(actual_handler, args, context)
            with lock:
                return self._invoke_handler(actual_handler, args, context)

        future = self.executor.submit(run_handler)
        try:
            value = future.result(timeout=max(0.001, int(tool.timeout_ms) / 1000))
            context.throw_if_cancelled()
            for hook in list(self._post_hooks):
                replacement = hook(tool, value, context)
                if replacement is not None:
                    value = replacement
            validate_json_schema(value, tool.output_schema, code=ErrorCode.TOOL_EXECUTION_FAILED)
            duration_ms = int((time.monotonic() - started) * 1000)
            result = ToolExecutionResult(
                call_id=context.call_id,
                name=tool.name,
                ok=True,
                value=value,
                meta={"duration_ms": duration_ms, "tool_version": 1},
                presentation=tool.presentation or {},
            )
            self._append_event(context.session_id, "tool/result", {
                "call_id": context.call_id,
                "name": name,
                "result": redact_secrets(value),
                "meta": result.meta,
                "presentation": result.presentation,
            })
        except FutureTimeout as exc:
            context.cancel_event.set()
            future.cancel()
            error = AgentRuntimeError(
                ErrorCode.TOOL_TIMEOUT,
                f"tool timed out after {int(tool.timeout_ms)}ms: {name}",
                status=504,
                retryable=tool.is_read_only,
            )
            result = ToolExecutionResult(
                call_id=context.call_id,
                name=tool.name,
                ok=False,
                error=error.to_dict(),
                meta={"duration_ms": int((time.monotonic() - started) * 1000)},
                presentation=tool.presentation or {},
            )
            self._append_event(context.session_id, "tool/result", {
                "call_id": context.call_id, "name": name, "error": error.to_dict(), "meta": result.meta,
            })
        except AgentRuntimeError as error:
            result = ToolExecutionResult(
                call_id=context.call_id,
                name=tool.name,
                ok=False,
                error=error.to_dict(),
                meta={"duration_ms": int((time.monotonic() - started) * 1000)},
                presentation=tool.presentation or {},
            )
            self._append_event(context.session_id, "tool/result", {
                "call_id": context.call_id, "name": name, "error": error.to_dict(), "meta": result.meta,
            })
        except Exception as exc:
            error = AgentRuntimeError(
                ErrorCode.TOOL_EXECUTION_FAILED,
                str(exc),
                status=500,
                retryable=tool.is_read_only,
            )
            result = ToolExecutionResult(
                call_id=context.call_id,
                name=tool.name,
                ok=False,
                error=error.to_dict(),
                meta={"duration_ms": int((time.monotonic() - started) * 1000)},
                presentation=tool.presentation or {},
            )
            self._append_event(context.session_id, "tool/result", {
                "call_id": context.call_id, "name": name, "error": error.to_dict(), "meta": result.meta,
            })

        for hook in list(self._result_hooks):
            try:
                hook(result, context)
            except Exception:
                pass
        return result
