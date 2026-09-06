"""Conservative cleanup for OneAPIChat upload artifacts.

Only files older than the retention window are candidates. Recent files are always
kept, and the shared delivery directory has a shorter independent window. The
caller can provide referenced paths so chat history remains authoritative.
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Iterable


DEFAULT_USER_RETENTION_DAYS = 90
DEFAULT_SHARED_RETENTION_DAYS = 30


def cleanup_uploads(
    root: str | Path,
    *,
    referenced: Iterable[str] = (),
    user_retention_days: int = DEFAULT_USER_RETENTION_DAYS,
    shared_retention_days: int = DEFAULT_SHARED_RETENTION_DAYS,
    dry_run: bool = False,
) -> dict[str, int]:
    """Remove stale upload files without touching recent or referenced files."""
    base = Path(root).resolve()
    if not base.is_dir():
        return {"scanned": 0, "deleted": 0, "skipped_recent": 0, "skipped_referenced": 0, "errors": 0}

    protected = {Path(item).resolve() for item in referenced if item}
    now = time.time()
    result = {"scanned": 0, "deleted": 0, "skipped_recent": 0, "skipped_referenced": 0, "errors": 0}

    for path in base.rglob("*"):
        if not path.is_file() or path.name.startswith("."):
            continue
        result["scanned"] += 1
        try:
            resolved = path.resolve()
            if resolved in protected:
                result["skipped_referenced"] += 1
                continue
            relative = resolved.relative_to(base)
            retention = shared_retention_days if relative.parts and relative.parts[0] == "shared" else user_retention_days
            age = now - path.stat().st_mtime
            if age < max(1, int(retention)) * 86400:
                result["skipped_recent"] += 1
                continue
            if not dry_run:
                path.unlink()
            result["deleted"] += 1
        except (OSError, ValueError):
            result["errors"] += 1
    return result
