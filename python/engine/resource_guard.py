"""Ownership guard for process-global integrations that cannot be safely multi-tenant."""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import threading
from pathlib import Path

from engine.agent_errors import AgentRuntimeError, ErrorCode


class ResourceOwnerGuard:
    def __init__(self, project_root: str | Path, engine_dir: str | Path):
        self.project_root = Path(project_root)
        self.path = Path(engine_dir) / "resource_owners.json"
        self._lock = threading.RLock()
        self._owners = self._load()
        if not self._owners:
            owner = os.getenv("ONEAPICHAT_ENGINE_OWNER", "").strip() or self._oldest_user()
            if owner:
                self._owners = {"src": owner, "global_runtime_admin": owner}
                self._save()

    def _oldest_user(self) -> str:
        db_path = self.project_root / "users" / "oneapichat.db"
        if not db_path.exists():
            return ""
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=3)
            try:
                row = conn.execute("SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1").fetchone()
                return str(row[0]) if row and row[0] else ""
            finally:
                conn.close()
        except Exception:
            return ""

    def _load(self) -> dict[str, str]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return {str(k): str(v) for k, v in data.items() if k and v} if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(self.path.parent), suffix=".owners.tmp")
        try:
            os.fchmod(fd, 0o600)
            os.write(fd, json.dumps(self._owners, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            os.fsync(fd)
            os.close(fd)
            fd = -1
            os.replace(tmp, self.path)
            os.chmod(self.path, 0o600)
        finally:
            if fd >= 0:
                os.close(fd)
            try:
                os.unlink(tmp)
            except OSError:
                pass

    def owner(self, resource: str) -> str:
        with self._lock:
            return self._owners.get(str(resource), "")

    def require(self, resource: str, user_id: str) -> None:
        owner = self.owner(resource)
        if not user_id or not owner or str(user_id) != owner:
            raise AgentRuntimeError(
                ErrorCode.FORBIDDEN,
                f"resource '{resource}' is restricted to its configured owner",
                status=403,
            )
