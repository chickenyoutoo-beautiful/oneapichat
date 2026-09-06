"""Authentication boundary for the public FastAPI engine.

Browser requests are authenticated against the same session store as the PHP API.
Loopback PHP bridge calls additionally require a private, constant-time-verified
credential and must not carry reverse-proxy headers. The middleware binds user_id
to the authenticated identity so callers cannot select another user's namespace.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import parse_qsl, urlencode

from engine.agent_errors import AgentRuntimeError, ErrorCode


SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
INTERNAL_HEADER = "x-oneapichat-internal"
# Runtime storage uses user ids in filenames and SQLite owner columns. Only accept the
# identifier format emitted by the account service, never arbitrary path fragments.
USER_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def is_valid_user_id(value: Any) -> bool:
    return bool(USER_ID_PATTERN.fullmatch(str(value or "")))


def require_scope_owner(scope: dict[str, Any], requested_user: str = "") -> str:
    """Return the authenticated scope owner and reject path/query owner mismatches."""
    owner = str(scope.get("state", {}).get("user_id") or "")
    requested = str(requested_user or "")
    if not owner or not is_valid_user_id(owner):
        raise AgentRuntimeError(ErrorCode.UNAUTHORIZED, "Authentication required", status=401)
    if requested and not is_valid_user_id(requested):
        raise AgentRuntimeError(ErrorCode.BAD_REQUEST, "Invalid user_id", status=400)
    if requested and requested != owner:
        raise AgentRuntimeError(ErrorCode.FORBIDDEN, "Resource belongs to another user", status=403)
    return owner


def get_internal_bridge_secret(project_root: str | Path) -> str:
    """Load or provision the local PHP/engine bridge credential without logging it."""
    path = Path(project_root) / ".engine" / "internal_bridge.key"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        fd = os.open(path, flags, 0o640)
        try:
            os.write(fd, (secrets.token_urlsafe(48) + "\n").encode("ascii"))
            os.fsync(fd)
        finally:
            os.close(fd)
    try:
        os.chmod(path, 0o640)
    except OSError:
        pass
    try:
        import grp
        os.chown(path, -1, grp.getgrnam("www-data").gr_gid)
    except (ImportError, KeyError, OSError, PermissionError):
        pass
    try:
        value = path.read_text(encoding="ascii").strip()
    except OSError:
        return ""
    return value if len(value) >= 32 else ""


def _header_map(scope: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for raw_key, raw_value in scope.get("headers", []):
        try:
            key = raw_key.decode("latin1").lower()
            value = raw_value.decode("latin1")
        except Exception:
            continue
        result[key] = value
    return result


def _timestamp(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    try:
        return float(text)
    except ValueError:
        pass
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except Exception:
        return 0.0


class SessionAuthenticator:
    """Verify OneAPIChat session tokens with a small, revocation-aware cache."""

    def __init__(self, project_root: str | Path, cache_ttl_seconds: int = 5):
        self.project_root = Path(project_root)
        self.db_path = self.project_root / "users" / "oneapichat.db"
        self.json_path = self.project_root / "users" / "sessions.json"
        self.cache_ttl_seconds = max(1, int(cache_ttl_seconds))
        self._cache: dict[str, tuple[str, float, float]] = {}
        self._lock = threading.RLock()

    def _source_version(self) -> float:
        version = 0.0
        for path in (self.db_path, self.json_path):
            try:
                version = max(version, path.stat().st_mtime_ns)
            except OSError:
                pass
        return version

    @staticmethod
    def _cache_key(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8", errors="ignore")).hexdigest()

    def verify(self, token: str) -> Optional[str]:
        token = (token or "").strip()
        if len(token) < 20 or len(token) > 512:
            return None
        now = time.time()
        source_version = self._source_version()
        cache_key = self._cache_key(token)
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached and cached[1] > now and cached[2] == source_version:
                return cached[0] or None

        user_id = self._verify_sqlite(token, now) or self._verify_json(token, now)
        with self._lock:
            self._cache[cache_key] = (user_id or "", now + self.cache_ttl_seconds, source_version)
            if len(self._cache) > 4096:
                self._cache = {key: value for key, value in self._cache.items() if value[1] > now}
        return user_id

    def _verify_sqlite(self, token: str, now: float) -> Optional[str]:
        if not self.db_path.exists():
            return None
        try:
            conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, timeout=3)
            try:
                row = conn.execute(
                    "SELECT user_id, created_at FROM sessions WHERE token = ? LIMIT 1", (token,)
                ).fetchone()
            finally:
                conn.close()
            if not row:
                return None
            created_at = _timestamp(row[1])
            if not created_at or now - created_at >= SESSION_TTL_SECONDS:
                return None
            user_id = str(row[0] or "")
            return user_id if is_valid_user_id(user_id) else None
        except Exception:
            return None

    def _verify_json(self, token: str, now: float) -> Optional[str]:
        try:
            data = json.loads(self.json_path.read_text(encoding="utf-8"))
            info = data.get(token) if isinstance(data, dict) else None
            if not isinstance(info, dict):
                return None
            created_at = _timestamp(info.get("created_at"))
            if not created_at or now - created_at >= SESSION_TTL_SECONDS:
                return None
            user_id = str(info.get("user_id") or "")
            return user_id if is_valid_user_id(user_id) else None
        except Exception:
            return None


class EngineAuthMiddleware:
    """ASGI middleware covering both HTTP and WebSocket engine routes."""

    def __init__(
        self,
        app,
        *,
        project_root: str | Path,
        public_paths: Optional[Iterable[str]] = None,
    ):
        self.app = app
        self.authenticator = SessionAuthenticator(project_root)
        self.internal_secret = get_internal_bridge_secret(project_root)
        self.public_paths = set(public_paths or {"/engine/health"})
        self.disabled = os.getenv("ONEAPICHAT_ENGINE_AUTH_DISABLED", "").lower() in {"1", "true", "yes"}

    def _is_public(self, path: str, method: str) -> bool:
        if method == "OPTIONS":
            return True
        return path in self.public_paths

    def _is_trusted_local(self, scope: dict[str, Any], headers: dict[str, str]) -> bool:
        client = scope.get("client") or ("", 0)
        host = str(client[0] or "")
        try:
            is_loopback = ipaddress.ip_address(host).is_loopback
        except ValueError:
            is_loopback = host == "localhost"
        # Loopback alone is not an authorization boundary: local SSRF can originate from
        # PHP. Require a private bridge credential as well as absence of proxy headers.
        supplied = headers.get(INTERNAL_HEADER, "")
        return bool(
            is_loopback
            and not headers.get("x-forwarded-for")
            and self.internal_secret
            and supplied
            and hmac.compare_digest(supplied, self.internal_secret)
        )

    @staticmethod
    def _extract_token(scope: dict[str, Any], headers: dict[str, str]) -> str:
        authorization = headers.get("authorization", "")
        if authorization.lower().startswith("bearer "):
            return authorization[7:].strip()
        cookie_header = headers.get("cookie", "")
        if cookie_header:
            try:
                cookies = SimpleCookie()
                cookies.load(cookie_header)
                morsel = cookies.get("auth_token")
                if morsel:
                    return morsel.value.strip()
            except Exception:
                pass
        try:
            query = dict(parse_qsl(scope.get("query_string", b"").decode("utf-8"), keep_blank_values=True))
            return str(query.get("auth_token") or "").strip()
        except Exception:
            return ""

    @staticmethod
    def _bind_user(scope: dict[str, Any], user_id: str) -> None:
        if not is_valid_user_id(user_id):
            raise AgentRuntimeError(ErrorCode.UNAUTHORIZED, "Invalid authenticated user", status=401)
        pairs = parse_qsl(scope.get("query_string", b"").decode("utf-8"), keep_blank_values=True)
        existing = [value for key, value in pairs if key == "user_id" and value]
        if any(value != user_id for value in existing):
            raise AgentRuntimeError(
                ErrorCode.FORBIDDEN,
                "user_id does not match the authenticated session",
                status=403,
                details={"requested_user_id": existing[-1]},
            )
        pairs = [(key, value) for key, value in pairs if key != "user_id"]
        pairs.append(("user_id", user_id))
        scope["query_string"] = urlencode(pairs, doseq=True).encode("utf-8")
        scope.setdefault("state", {})["user_id"] = user_id
        scope["state"]["authenticated"] = True

    @staticmethod
    async def _reject(scope: dict[str, Any], send, error: AgentRuntimeError) -> None:
        if scope.get("type") == "websocket":
            await send({"type": "websocket.close", "code": 4401 if error.status == 401 else 4403})
            return
        body = json.dumps({"ok": False, "error": error.to_dict()}, ensure_ascii=False).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": error.status,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"cache-control", b"no-store"),
            ],
        })
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope: dict[str, Any], receive, send) -> None:
        if scope.get("type") not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        path = str(scope.get("path") or "")
        method = str(scope.get("method") or "GET").upper()
        if not path.startswith("/engine/") or self.disabled or self._is_public(path, method):
            await self.app(scope, receive, send)
            return

        headers = _header_map(scope)
        if self._is_trusted_local(scope, headers):
            try:
                requested_users = [
                    value for key, value in parse_qsl(
                        scope.get("query_string", b"").decode("utf-8"), keep_blank_values=True
                    ) if key == "user_id" and value
                ]
            except Exception:
                requested_users = ["invalid"]
            if any(not is_valid_user_id(value) for value in requested_users):
                await self._reject(
                    scope, send, AgentRuntimeError(ErrorCode.BAD_REQUEST, "Invalid user_id", status=400)
                )
                return
            scope.setdefault("state", {})["trusted_internal"] = True
            await self.app(scope, receive, send)
            return

        token = self._extract_token(scope, headers)
        user_id = self.authenticator.verify(token)
        if not user_id:
            await self._reject(
                scope,
                send,
                AgentRuntimeError(ErrorCode.UNAUTHORIZED, "Authentication required", status=401),
            )
            return
        try:
            self._bind_user(scope, user_id)
        except AgentRuntimeError as error:
            await self._reject(scope, send, error)
            return
        await self.app(scope, receive, send)
