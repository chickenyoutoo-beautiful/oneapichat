"""Provider-neutral request helpers for chat, tools, and subagents.

The existing wire clients remain in engine_server.py for compatibility. This module
centralizes provider detection, parameter filtering, DeepSeek semantics, usage
accounting, and persistence redaction so every path follows the same contract.
"""
from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from typing import Any, Callable, Optional
from urllib.parse import urlparse

from engine.agent_errors import (AgentRuntimeError, ErrorCode, redact_secrets,
                                 classify_provider_error)


@dataclass(frozen=True)
class ProviderInfo:
    name: str
    family: str
    base_url: str
    model: str
    supports_tools: bool = True
    supports_parallel_tools: bool = True
    supports_reasoning: bool = False
    supports_json_schema: bool = True
    supports_stream_usage: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)


def normalize_base_url(value: str, *, default: str = "https://api.deepseek.com/v1") -> str:
    base = (value or default).strip().rstrip("/")
    if not base:
        return default
    parsed = urlparse(base)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise AgentRuntimeError(ErrorCode.BAD_REQUEST, "invalid provider base URL", status=400)
    return base


def detect_provider(base_url: str = "", model: str = "", *, anthropic_format: bool = False) -> ProviderInfo:
    base = normalize_base_url(base_url)
    host = (urlparse(base).hostname or "").lower()
    model_lower = (model or "").lower()
    # Native Anthropic wire format is only used when explicitly requested or targeting the official Anthropic API.
    if anthropic_format or host == "api.anthropic.com":
        return ProviderInfo(
            "anthropic", "anthropic", base, model,
            supports_tools=True, supports_parallel_tools=True, supports_reasoning=True,
            supports_json_schema=False, supports_stream_usage=True,
        )
    if "deepseek" in host or model_lower.startswith("deepseek"):
        is_reasoner = "reasoner" in model_lower or model_lower.endswith("-r1")
        return ProviderInfo(
            "deepseek", "openai-compatible", base, model,
            supports_tools=not is_reasoner,
            supports_parallel_tools=not is_reasoner,
            supports_reasoning=True,
            supports_json_schema=not is_reasoner,
            supports_stream_usage=True,
            metadata={"reasoner": is_reasoner},
        )
    if "generativelanguage.googleapis.com" in host or "googleapis.com" in host or "gemini" in model_lower:
        return ProviderInfo(
            "gemini", "openai-compatible", base, model,
            supports_tools=True, supports_parallel_tools=True, supports_reasoning=True,
            supports_json_schema=True, supports_stream_usage=True,
        )
    if "x.ai" in host or model_lower.startswith("grok"):
        return ProviderInfo(
            "xai", "openai-compatible", base, model,
            supports_tools=True, supports_parallel_tools=True, supports_reasoning=True,
            supports_json_schema=False, supports_stream_usage=True,
        )
    if "openrouter.ai" in host:
        return ProviderInfo("openrouter", "openai-compatible", base, model)
    if "api.openai.com" in host or model_lower.startswith(("gpt-", "o1", "o3", "o4")):
        return ProviderInfo(
            "openai", "openai-compatible", base, model,
            supports_tools=True, supports_parallel_tools=True,
            supports_reasoning=model_lower.startswith(("o1", "o3", "o4", "gpt-5")),
        )
    if model_lower.startswith("claude"):
        # Claude model accessed through an OpenAI-compatible proxy (e.g. CLIProxyAPI / OneAPI / NewAPI / custom /v1)
        return ProviderInfo(
            "claude-openai-compat", "openai-compatible", base, model,
            supports_tools=True, supports_parallel_tools=True, supports_reasoning=True,
            supports_json_schema=False, supports_stream_usage=True,
        )
    if "minimaxi" in host or "minimax" in model_lower:
        return ProviderInfo(
            "minimax", "openai-compatible", base, model,
            supports_tools=True, supports_parallel_tools=False, supports_reasoning=True,
            supports_json_schema=False,
        )
    if "longcat" in host or "longcat" in model_lower:
        return ProviderInfo(
            "longcat", "openai-compatible", base, model,
            supports_tools=True, supports_parallel_tools=False, supports_reasoning=True,
            supports_json_schema=False,
        )
    return ProviderInfo("custom", "openai-compatible", base, model)


def normalize_reasoning_effort(value: Any, provider: ProviderInfo) -> Optional[str]:
    if value in (None, "", "off", "none", False):
        return None
    effort = str(value).lower().strip()
    aliases = {"minimal": "low", "ultra": "max"}
    effort = aliases.get(effort, effort)
    if provider.name in {"deepseek", "openai", "custom", "openrouter"}:
        # OpenAI o-series/gpt-5 and DeepSeek support extended reasoning levels (low, medium, high, xhigh, max)
        return effort if effort in {"low", "medium", "high", "xhigh", "max"} else "high"
    if provider.name in {"xai", "gemini"}:
        # Gemini / xAI standard wire levels: low, medium, high
        if effort in {"xhigh", "max"}:
            return "high"
        return effort if effort in {"low", "medium", "high"} else "high"
    return None


def safe_request_snapshot(request: dict[str, Any]) -> dict[str, Any]:
    """Persist only restart metadata; credentials and transient client objects are removed."""
    allowed = {
        "model", "base_url", "anthropic_url", "anthropic_format", "messages", "tools",
        "tool_choice", "temperature", "top_p", "max_tokens", "max_completion_tokens",
        "reasoning_effort", "thinking_level", "extra_body", "stream_options", "response_format",
        "chat_id", "msg_id", "provider", "agent_mode", "runtime_session_id",
    }
    snapshot = {key: copy.deepcopy(value) for key, value in request.items() if key in allowed}
    return redact_secrets(snapshot)


def prepare_openai_request(request: dict[str, Any]) -> tuple[ProviderInfo, dict[str, Any]]:
    provider = detect_provider(
        str(request.get("base_url") or ""),
        str(request.get("model") or ""),
        anthropic_format=bool(request.get("anthropic_format")),
    )
    if provider.family != "openai-compatible":
        # When called on the OpenAI preparation path, treat non-native endpoints as OpenAI-compatible
        provider = ProviderInfo(
            provider.name, "openai-compatible", provider.base_url, provider.model,
            supports_tools=provider.supports_tools,
            supports_parallel_tools=provider.supports_parallel_tools,
            supports_reasoning=provider.supports_reasoning,
            supports_json_schema=provider.supports_json_schema,
            supports_stream_usage=provider.supports_stream_usage,
            metadata=provider.metadata
        )
    params: dict[str, Any] = {
        "model": request.get("model"),
        "messages": _normalize_tool_turns_for_provider(request.get("messages") or []),
        "stream": bool(request.get("stream", True)),
    }
    optional = (
        "temperature", "top_p", "max_tokens", "max_completion_tokens", "stop", "seed",
        "frequency_penalty", "presence_penalty", "response_format", "stream_options",
        "modalities", "audio", "prediction", "metadata", "user", "service_tier",
        "store", "logprobs", "top_logprobs", "n", "logit_bias", "web_search_options",
    )
    for key in optional:
        if request.get(key) is not None:
            params[key] = copy.deepcopy(request[key])

    tools = copy.deepcopy(request.get("tools") or [])
    if tools and provider.supports_tools:
        params["tools"] = tools
        choice = request.get("tool_choice")
        if choice is not None:
            params["tool_choice"] = choice
        if provider.supports_parallel_tools and request.get("parallel_tool_calls") is not None:
            params["parallel_tool_calls"] = bool(request.get("parallel_tool_calls"))
    else:
        params.pop("tools", None)
        params.pop("tool_choice", None)
        params.pop("parallel_tool_calls", None)

    effort = normalize_reasoning_effort(request.get("reasoning_effort"), provider)
    if effort:
        params["reasoning_effort"] = effort
    if provider.name == "gemini" and request.get("thinking_level"):
        params["thinking_level"] = request["thinking_level"]
    extra_body = copy.deepcopy(request.get("extra_body") or {})
    reserved = {
        "model", "messages", "stream", "tools", "tool_choice", "parallel_tool_calls",
        "api_key", "base_url", "anthropic_url", "anthropic_format", "system",
        "chat_id", "msg_id", "task_id", "user_id", "proxy_enabled", "proxy_url",
        "runtime_session_id", "runtime_job_id", "provider", "agent_mode", "extra_body",
        "reasoning_effort", "thinking_level", "thinking",
    } | set(optional)
    for key, value in request.items():
        key_text = str(key)
        key_lower = key_text.lower()
        if key_text in reserved or key_text.startswith("_") or value is None:
            continue
        if key_lower in {"authorization", "cookie", "access_token", "refresh_token", "x-api-key"}:
            continue
        if any(marker in key_lower for marker in ("api_key", "password", "secret")):
            continue
        extra_body.setdefault(key_text, copy.deepcopy(value))
    if provider.name == "deepseek" and effort:
        extra_body.setdefault("thinking", {"type": "enabled"})
    if provider.name in {"minimax", "longcat"} and request.get("thinking"):
        extra_body.setdefault("thinking", request["thinking"])
    if extra_body:
        params["extra_body"] = extra_body

    if not provider.supports_json_schema and isinstance(params.get("response_format"), dict):
        response_type = params["response_format"].get("type")
        if response_type == "json_schema":
            params.pop("response_format", None)
    if provider.metadata.get("reasoner"):
        for key in (
            "tools", "tool_choice", "parallel_tool_calls", "temperature", "top_p",
            "frequency_penalty", "presence_penalty", "response_format", "reasoning_effort",
        ):
            params.pop(key, None)
    return provider, params


def prepare_anthropic_request(request: dict[str, Any]) -> tuple[ProviderInfo, dict[str, Any], dict[str, str]]:
    provider = detect_provider(
        str(request.get("anthropic_url") or request.get("base_url") or "https://api.anthropic.com/v1"),
        str(request.get("model") or ""),
        anthropic_format=True,
    )
    messages = []
    system_parts = []
    for message in _normalize_tool_turns_for_provider(request.get("messages") or []):
        if message.get("role") == "system":
            content = message.get("content")
            if isinstance(content, str):
                system_parts.append(content)
            continue
        messages.append(message)
    payload: dict[str, Any] = {
        "model": request.get("model"),
        "messages": messages,
        "max_tokens": int(request.get("max_tokens") or request.get("max_completion_tokens") or 8192),
        "stream": bool(request.get("stream", True)),
    }
    if system_parts:
        payload["system"] = "\n\n".join(system_parts)
    for key in ("temperature", "top_p", "stop_sequences"):
        if request.get(key) is not None:
            payload[key] = copy.deepcopy(request[key])
    if request.get("tools"):
        payload["tools"] = copy.deepcopy(request["tools"])
    if request.get("thinking"):
        payload["thinking"] = copy.deepcopy(request["thinking"])
    headers = {"content-type": "application/json", "accept": "text/event-stream"}
    return provider, payload, headers


def normalize_usage(usage: Any, provider: ProviderInfo | str = "custom") -> dict[str, int]:
    if usage is None:
        return {}
    if hasattr(usage, "model_dump"):
        usage = usage.model_dump()
    elif not isinstance(usage, dict):
        try:
            usage = dict(usage)
        except Exception:
            return {}
    details = usage.get("prompt_tokens_details") or usage.get("input_tokens_details") or {}
    output_details = usage.get("completion_tokens_details") or usage.get("output_tokens_details") or {}
    cache_read = int(
        details.get("cached_tokens")
        or details.get("cache_read_tokens")
        or usage.get("cache_read_input_tokens")
        or 0
    )
    cache_write = int(details.get("cache_write_tokens") or usage.get("cache_creation_input_tokens") or 0)
    prompt_total = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    input_uncached = max(0, prompt_total - cache_read - cache_write)
    output_tokens = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    reasoning_tokens = int(
        output_details.get("reasoning_tokens")
        or usage.get("reasoning_tokens")
        or 0
    )
    result = {
        "input_tokens": input_uncached,
        "output_tokens": output_tokens,
        "cache_read_tokens": cache_read,
        "cache_write_tokens": cache_write,
        "reasoning_tokens": reasoning_tokens,
    }
    result["total_tokens"] = sum(result.values())
    return result


@dataclass
class CanonicalCompletion:
    provider: ProviderInfo
    content: str = ""
    reasoning: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, int] = field(default_factory=dict)
    finish_reason: str = ""

    def as_openai_message(self) -> dict[str, Any]:
        message: dict[str, Any] = {"role": "assistant", "content": self.content or None}
        if self.reasoning:
            message["reasoning_content"] = self.reasoning
        if self.tool_calls:
            message["tool_calls"] = copy.deepcopy(self.tool_calls)
        return message


def _anthropic_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    converted = []
    for tool in tools or []:
        fn = tool.get("function", {}) if tool.get("type") == "function" else tool
        name = str(fn.get("name") or "").strip()
        if not name:
            continue
        converted.append({
            "name": name,
            "description": str(fn.get("description") or ""),
            "input_schema": copy.deepcopy(fn.get("parameters") or fn.get("input_schema") or {"type": "object"}),
        })
    return converted


def _normalize_tool_turns_for_provider(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only complete assistant/tool turns with non-empty IDs."""
    if not isinstance(messages, list):
        return []
    normalized: list[dict[str, Any]] = []
    i = 0
    while i < len(messages):
        message = messages[i]
        if not isinstance(message, dict):
            i += 1
            continue
        calls = message.get("tool_calls")
        if message.get("role") != "assistant" or not isinstance(calls, list) or not calls:
            if message.get("role") != "tool":
                normalized.append(message)
            i += 1
            continue
        valid_calls: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for call in calls:
            if not isinstance(call, dict):
                continue
            call_id = str(call.get("id") or "").strip()
            if not call_id or call_id in seen_ids:
                continue
            seen_ids.add(call_id)
            # Gemini function_call.args must be a JSON object. Historical/imported
            # conversations may contain list/scalar arguments, which CPA otherwise
            # forwards as an invalid protobuf repeated value and returns HTTP 400.
            sanitized_call = copy.deepcopy(call)
            fn = sanitized_call.get("function")
            if not isinstance(fn, dict):
                fn = {}
                sanitized_call["function"] = fn
            raw_args = fn.get("arguments", "{}")
            try:
                parsed_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except Exception:
                parsed_args = {}
            if not isinstance(parsed_args, dict):
                parsed_args = {}
            fn["arguments"] = json.dumps(parsed_args, ensure_ascii=False, separators=(",", ":"))
            valid_calls.append(sanitized_call)
        results: dict[str, dict[str, Any]] = {}
        j = i + 1
        while j < len(messages) and isinstance(messages[j], dict) and messages[j].get("role") == "tool":
            result = messages[j]
            result_id = str(result.get("tool_call_id") or "").strip()
            if result_id and result_id not in results:
                results[result_id] = result
            j += 1
        matched = [call for call in valid_calls if str(call.get("id")) in results]
        if matched:
            cloned = copy.deepcopy(message)
            cloned["tool_calls"] = matched
            normalized.append(cloned)
            normalized.extend(copy.deepcopy(results[str(call.get("id"))]) for call in matched)
        else:
            cloned = copy.deepcopy(message)
            cloned.pop("tool_calls", None)
            normalized.append(cloned)
        i = j
    return normalized


def _anthropic_messages(messages: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    output: list[dict[str, Any]] = []
    system_parts: list[str] = []

    def append(role: str, content: Any) -> None:
        blocks = content if isinstance(content, list) else [{"type": "text", "text": str(content or "")}]
        if output and output[-1]["role"] == role:
            previous = output[-1]["content"]
            if not isinstance(previous, list):
                previous = [{"type": "text", "text": str(previous or "")}]
            output[-1]["content"] = previous + blocks
        else:
            output.append({"role": role, "content": blocks})

    for message in _normalize_tool_turns_for_provider(messages or []):
        role = str(message.get("role") or "user")
        if role == "system":
            if message.get("content"):
                system_parts.append(str(message["content"]))
            continue
        if role == "tool":
            append("user", [{
                "type": "tool_result",
                "tool_use_id": str(message.get("tool_call_id") or ""),
                "content": str(message.get("content") or ""),
            }])
            continue
        if role == "assistant":
            blocks: list[dict[str, Any]] = []
            if message.get("content"):
                blocks.append({"type": "text", "text": str(message["content"])})
            for call in message.get("tool_calls") or []:
                fn = call.get("function") or {}
                raw_args = fn.get("arguments") or "{}"
                try:
                    parsed_args = raw_args if isinstance(raw_args, dict) else __import__("json").loads(raw_args)
                except Exception:
                    parsed_args = {}
                blocks.append({
                    "type": "tool_use",
                    "id": str(call.get("id") or ""),
                    "name": str(fn.get("name") or ""),
                    "input": parsed_args,
                })
            append("assistant", blocks or [{"type": "text", "text": ""}])
            continue
        content = message.get("content")
        if isinstance(content, list):
            blocks = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    blocks.append({"type": "text", "text": str(item.get("text") or "")})
                elif isinstance(item, dict) and item.get("type") == "image_url":
                    image = item.get("image_url") or {}
                    url = image.get("url") if isinstance(image, dict) else image
                    if isinstance(url, str) and url.startswith("data:") and ";base64," in url:
                        header, data = url.split(",", 1)
                        blocks.append({"type": "image", "source": {"type": "base64", "media_type": header[5:].split(";")[0], "data": data}})
            append("user", blocks or [{"type": "text", "text": ""}])
        else:
            append("user", content or "")
    return output, "\n\n".join(system_parts)


def complete_chat(request: dict[str, Any], api_key: str, *, http_client: Any = None, timeout: float = 120) -> CanonicalCompletion:
    """Execute one non-streaming chat request through OpenAI-compatible or Anthropic wire format."""
    provider = detect_provider(
        str(request.get("anthropic_url") or request.get("base_url") or ""),
        str(request.get("model") or ""),
        anthropic_format=bool(request.get("anthropic_format")),
    )
    if not api_key:
        raise AgentRuntimeError(
            ErrorCode.UNAUTHORIZED, "provider API key is not configured", status=401,
            details={"provider": provider.name},
        )
    try:
        if provider.family == "anthropic":
            import httpx
            payload = {
                "model": request.get("model"),
                "max_tokens": int(request.get("max_tokens") or request.get("max_completion_tokens") or 8192),
                "stream": False,
            }
            payload["messages"], system = _anthropic_messages(request.get("messages") or [])
            if system:
                payload["system"] = system
            for key in ("temperature", "top_p"):
                if request.get(key) is not None:
                    payload[key] = request[key]
            tools = _anthropic_tools(request.get("tools") or [])
            if tools:
                payload["tools"] = tools
            if request.get("thinking"):
                payload["thinking"] = copy.deepcopy(request["thinking"])
            base = str(request.get("anthropic_url") or request.get("base_url") or provider.base_url).rstrip("/")
            url = base if base.endswith("/messages") else (base + "/messages" if base.endswith("/v1") else base + "/v1/messages")
            client = http_client or httpx.Client(timeout=timeout, trust_env=False)
            close_client = http_client is None
            try:
                response = client.post(url, json=payload, headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                    "accept": "application/json",
                }, timeout=timeout)
                response.raise_for_status()
                data = response.json()
            finally:
                if close_client:
                    client.close()
            text_parts: list[str] = []
            reasoning_parts: list[str] = []
            calls: list[dict[str, Any]] = []
            for block in data.get("content") or []:
                kind = block.get("type")
                if kind == "text":
                    text_parts.append(str(block.get("text") or ""))
                elif kind in {"thinking", "redacted_thinking"}:
                    reasoning_parts.append(str(block.get("thinking") or block.get("data") or ""))
                elif kind == "tool_use":
                    calls.append({
                        "id": str(block.get("id") or ""),
                        "type": "function",
                        "function": {
                            "name": str(block.get("name") or ""),
                            "arguments": __import__("json").dumps(block.get("input") or {}, ensure_ascii=False),
                        },
                    })
            return CanonicalCompletion(
                provider=provider,
                content="".join(text_parts),
                reasoning="\n".join(part for part in reasoning_parts if part),
                tool_calls=calls,
                usage=normalize_usage(data.get("usage"), provider),
                finish_reason=str(data.get("stop_reason") or ""),
            )

        from openai import OpenAI
        provider, params = prepare_openai_request(dict(request) | {"stream": False})
        client = OpenAI(api_key=api_key, base_url=provider.base_url, timeout=timeout, http_client=http_client)
        response = client.chat.completions.create(**params)
        message = response.choices[0].message
        calls = []
        for call in getattr(message, "tool_calls", None) or []:
            calls.append({
                "id": str(call.id),
                "type": "function",
                "function": {"name": str(call.function.name), "arguments": str(call.function.arguments or "{}")},
            })
        return CanonicalCompletion(
            provider=provider,
            content=str(getattr(message, "content", "") or ""),
            reasoning=str(getattr(message, "reasoning_content", "") or ""),
            tool_calls=calls,
            usage=normalize_usage(getattr(response, "usage", None), provider),
            finish_reason=str(getattr(response.choices[0], "finish_reason", "") or ""),
        )
    except AgentRuntimeError:
        raise
    except Exception as error:
        response = getattr(error, "response", None)
        status = getattr(response, "status_code", None)
        response_body: Any = None
        request_id = None
        retry_after_ms = None
        if response is not None:
            try:
                response_body = response.json()
            except Exception:
                response_body = getattr(response, "text", None)
            headers = getattr(response, "headers", {}) or {}
            request_id = headers.get("x-request-id") or headers.get("request-id")
            retry_after = headers.get("retry-after")
            if retry_after is not None:
                try:
                    retry_after_ms = max(0, int(float(retry_after) * 1000))
                except (TypeError, ValueError):
                    retry_after_ms = None
        raise classify_provider_error(
            error, status=status, response_body=response_body, request_id=request_id,
            retry_after_ms=retry_after_ms, provider=provider.name,
        ) from error


class ProviderAdapterRegistry:
    """Small provider seam used by future runners and plugin adapters."""

    def __init__(self):
        self._adapters: dict[str, Callable[..., Any]] = {}

    def register(self, provider: str, adapter: Callable[..., Any]) -> Callable[[], None]:
        name = str(provider or "").strip().lower()
        if not name:
            raise ValueError("provider name is required")
        previous = self._adapters.get(name)
        self._adapters[name] = adapter

        def dispose() -> None:
            if previous is None:
                self._adapters.pop(name, None)
            else:
                self._adapters[name] = previous

        return dispose

    def get(self, provider: str) -> Callable[..., Any]:
        name = str(provider or "").strip().lower()
        adapter = self._adapters.get(name)
        if adapter is None:
            raise AgentRuntimeError(ErrorCode.MODEL_UNAVAILABLE, f"no adapter registered for {name}", status=404)
        return adapter

    def list_providers(self) -> list[str]:
        return sorted(self._adapters)
