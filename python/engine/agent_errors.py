"""Stable, provider-neutral error contracts for the OneAPIChat agent runtime.

The runtime routes behavior by code. Human-readable messages are deliberately
not part of retry/failover decisions. This mirrors the error discipline used by
DeepSeek Harness while remaining JSON-compatible with the existing browser UI.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Optional


class ErrorCode(str, Enum):
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    BAD_REQUEST = "BAD_REQUEST"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    CANCELLED = "CANCELLED"
    TIMEOUT = "TIMEOUT"
    NETWORK = "NETWORK"
    RATE_LIMIT = "RATE_LIMIT"
    QUOTA = "QUOTA"
    INVALID_CREDENTIAL = "INVALID_CREDENTIAL"
    MISSING_CREDENTIAL = "MISSING_CREDENTIAL"
    CONTEXT_WINDOW_EXCEEDED = "CONTEXT_WINDOW_EXCEEDED"
    CONTENT_FILTERED = "CONTENT_FILTERED"
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    EMPTY_RESPONSE = "EMPTY_RESPONSE"
    INVALID_TOOL_ARGUMENTS = "INVALID_TOOL_ARGUMENTS"
    TOOL_NOT_FOUND = "TOOL_NOT_FOUND"
    TOOL_REJECTED = "TOOL_REJECTED"
    TOOL_TIMEOUT = "TOOL_TIMEOUT"
    TOOL_EXECUTION_FAILED = "TOOL_EXECUTION_FAILED"
    SESSION_NOT_FOUND = "SESSION_NOT_FOUND"
    SESSION_CONFLICT = "SESSION_CONFLICT"
    INTERNAL = "INTERNAL"


_SECRET_PATTERNS = (
    re.compile(r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;]+"),
    re.compile(r"(?i)((?:api[_-]?key|token|password|secret)\s*[:=]\s*['\"]?)[^'\"\s,;}]+"),
    re.compile(r"\b(?:sk|cpa)-[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\boac-[a-fA-F0-9]{20,}\b"),
)


def redact_secrets(value: Any) -> Any:
    """Return a detached copy with credential-shaped fields and strings redacted."""
    secret_keys = {
        "api_key", "apikey", "api-key", "authorization", "token", "access_token",
        "refresh_token", "password", "secret", "client_secret", "cookie",
        "x-api-key", "proxy_password",
    }
    if isinstance(value, Mapping):
        result = {}
        for key, item in value.items():
            key_text = str(key)
            key_lower = key_text.lower()
            if key_lower in secret_keys or any(
                marker in key_lower for marker in ("api_key", "apikey", "password", "secret", "token")
            ):
                result[key_text] = "[REDACTED]" if item not in (None, "") else item
            else:
                result[key_text] = redact_secrets(item)
        return result
    if isinstance(value, (list, tuple)):
        return [redact_secrets(item) for item in value]
    if isinstance(value, str):
        text = value
        for pattern in _SECRET_PATTERNS:
            text = pattern.sub(lambda match: (match.group(1) if match.lastindex else "") + "[REDACTED]", text)
        return text
    return value


@dataclass
class AgentRuntimeError(Exception):
    code: ErrorCode | str
    message: str
    status: int = 500
    retryable: bool = False
    details: dict[str, Any] = field(default_factory=dict)
    provider_retry_after_ms: Optional[int] = None
    request_id: Optional[str] = None

    def __post_init__(self) -> None:
        self.code = ErrorCode(self.code) if not isinstance(self.code, ErrorCode) else self.code
        self.message = str(redact_secrets(self.message))
        self.details = redact_secrets(self.details or {})
        super().__init__(self.message)

    @property
    def provider(self) -> Optional[str]:
        value = self.details.get("provider") if isinstance(self.details, dict) else None
        return str(value) if value else None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code.value,
            "message": self.message,
            "retryable": bool(self.retryable),
        }
        if self.details:
            payload["details"] = self.details
        if self.provider_retry_after_ms is not None:
            payload["provider_retry_after_ms"] = int(self.provider_retry_after_ms)
        if self.request_id:
            payload["request_id"] = self.request_id
        return payload


_CONTEXT_PATTERNS = (
    "context length", "context window", "maximum context", "too many tokens",
    "exceeds the available context", "prompt is too long", "max context",
)
_QUOTA_PATTERNS = ("insufficient_quota", "quota exceeded", "billing", "balance is insufficient", "余额不足")
_CREDENTIAL_PATTERNS = ("invalid api key", "incorrect api key", "authentication", "unauthorized", "invalid credential")
_RATE_PATTERNS = ("rate limit", "too many requests", "429")
_TIMEOUT_PATTERNS = ("timed out", "timeout", "deadline exceeded", "stream idle")
_NETWORK_PATTERNS = (
    "eof", "connection reset", "econnreset", "socket hang up", "connection aborted",
    "remote disconnected", "network error", "temporary failure in name resolution",
)
_FILTER_PATTERNS = ("content filter", "content policy", "safety", "blocked by policy")


def _contains(message: str, patterns: tuple[str, ...]) -> bool:
    lowered = message.lower()
    return any(pattern in lowered for pattern in patterns)


def classify_provider_error(
    exc: BaseException | str,
    *,
    status: Optional[int] = None,
    response_body: Any = None,
    request_id: Optional[str] = None,
    retry_after_ms: Optional[int] = None,
    provider: Optional[str] = None,
) -> AgentRuntimeError:
    """Normalize provider/transport failures into stable, routable error codes."""
    raw_message = str(exc)
    if response_body not in (None, ""):
        if isinstance(response_body, (dict, list)):
            try:
                body_text = json.dumps(response_body, ensure_ascii=False)
            except Exception:
                body_text = str(response_body)
        else:
            body_text = str(response_body)
        if body_text and body_text not in raw_message:
            raw_message = f"{raw_message}: {body_text[:2000]}"
    message = str(redact_secrets(raw_message))

    detected_status = status
    if detected_status is None:
        detected_status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
        response = getattr(exc, "response", None)
        detected_status = detected_status or getattr(response, "status_code", None)
    try:
        detected_status = int(detected_status) if detected_status is not None else None
    except (TypeError, ValueError):
        detected_status = None

    code = ErrorCode.INTERNAL
    normalized_status = detected_status or 500
    retryable = False
    if _contains(message, _CONTEXT_PATTERNS):
        code, normalized_status = ErrorCode.CONTEXT_WINDOW_EXCEEDED, 400
    elif _contains(message, _QUOTA_PATTERNS) or detected_status == 402:
        code, normalized_status = ErrorCode.QUOTA, detected_status or 402
    elif _contains(message, _CREDENTIAL_PATTERNS) or detected_status in (401, 403):
        code, normalized_status = ErrorCode.INVALID_CREDENTIAL, detected_status or 401
    elif _contains(message, _RATE_PATTERNS) or detected_status == 429:
        code, normalized_status, retryable = ErrorCode.RATE_LIMIT, 429, True
    elif _contains(message, _FILTER_PATTERNS):
        code, normalized_status = ErrorCode.CONTENT_FILTERED, detected_status or 400
    elif _contains(message, _TIMEOUT_PATTERNS):
        code, normalized_status, retryable = ErrorCode.TIMEOUT, 504, True
    elif _contains(message, _NETWORK_PATTERNS):
        code, normalized_status, retryable = ErrorCode.NETWORK, 502, True
    elif detected_status in (408, 425, 500, 502, 503, 504):
        code, normalized_status, retryable = ErrorCode.PROVIDER_UNAVAILABLE, detected_status, True
    elif detected_status == 404:
        code, normalized_status = ErrorCode.MODEL_UNAVAILABLE, 404
    elif detected_status is not None and 400 <= detected_status < 500:
        code, normalized_status = ErrorCode.BAD_REQUEST, detected_status

    details = {"provider": provider} if provider else {}
    return AgentRuntimeError(
        code, message, normalized_status, retryable, details=details,
        provider_retry_after_ms=retry_after_ms, request_id=request_id,
    )


def as_error_payload(exc: BaseException | AgentRuntimeError) -> tuple[int, dict[str, Any]]:
    error = exc if isinstance(exc, AgentRuntimeError) else classify_provider_error(exc)
    return error.status, {"ok": False, "error": error.to_dict()}
