"""Retention and compaction for legacy resumable stream snapshots."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any


def _parse_sse(payload: Any) -> tuple[str, dict[str, Any]]:
    if not isinstance(payload, str):
        return "", {}
    event_type = ""
    event_data: dict[str, Any] = {}
    for raw_line in payload.splitlines():
        line = raw_line.strip()
        if line.startswith("event:"):
            event_type = line[6:].strip()
        elif line.startswith("data:"):
            try:
                parsed = json.loads(line[5:].strip())
                event_data = parsed if isinstance(parsed, dict) else {}
            except Exception:
                event_data = {}
    return event_type, event_data


def compact_stream_files(
    stream_dir: str | Path,
    *,
    retention_days: int = 30,
    max_chunks: int = 2048,
    max_replay_bytes: int = 4 * 1024 * 1024,
) -> dict[str, int]:
    root = Path(stream_dir)
    root.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(root, 0o700)
    except OSError:
        pass
    now = time.time()
    cutoff = now - max(1, int(retention_days)) * 86400
    max_chunks = max(64, int(max_chunks))
    max_replay_bytes = max(256 * 1024, int(max_replay_bytes))
    result = {
        "files": 0,
        "deleted": 0,
        "compacted": 0,
        "errors": 0,
        "bytes_before": 0,
        "bytes_after": 0,
    }
    for path in root.glob("*.json"):
        result["files"] += 1
        tmp: Path | None = None
        try:
            before = path.stat().st_size
            mtime = path.stat().st_mtime
            result["bytes_before"] += before
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
            # Parse every snapshot: a high count of small chunks can exceed the replay
            # event cap while remaining well below the byte threshold.
            needs_parse = True
            if not needs_parse:
                result["bytes_after"] += before
                continue
            try:
                data: Any = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                if mtime < cutoff:
                    path.unlink(missing_ok=True)
                    result["deleted"] += 1
                else:
                    result["errors"] += 1
                    result["bytes_after"] += before
                continue
            if not isinstance(data, dict):
                data = {}
            if mtime < cutoff:
                # Streams older than the retention window cannot have a live producer after
                # engine restarts; the event-sourced runtime retains durable terminal state.
                path.unlink(missing_ok=True)
                result["deleted"] += 1
                continue
            chunks = data.get("chunks")
            changed = False
            if isinstance(chunks, list):
                # Legacy snapshots sometimes carried only raw SSE chunks. Rebuild aggregate
                # text before dropping replay history so refresh still restores full output.
                if "content" not in data or "reasoning" not in data:
                    content_parts = []
                    reasoning_parts = []
                    for payload in chunks:
                        event_type, event_data = _parse_sse(payload)
                        if event_type == "content":
                            content_parts.append(str(event_data.get("delta") or ""))
                        elif event_type == "reasoning":
                            reasoning_parts.append(str(event_data.get("delta") or ""))
                        elif event_type == "done":
                            if event_data.get("full_text") is not None:
                                content_parts = [str(event_data.get("full_text") or "")]
                            if event_data.get("reasoning_text") is not None:
                                reasoning_parts = [str(event_data.get("reasoning_text") or "")]
                    if "content" not in data:
                        data["content"] = "".join(content_parts)
                        changed = True
                    if "reasoning" not in data:
                        data["reasoning"] = "".join(reasoning_parts)
                        changed = True
                # Partial growing tool calls cannot be replayed safely. Drop the replay
                # prefix through the last partial so absolute offsets remain contiguous.
                last_partial_index = -1
                for index, payload in enumerate(chunks):
                    event_type, event_data = _parse_sse(payload)
                    if event_type == "tool_call" and event_data.get("partial"):
                        last_partial_index = index
                if last_partial_index >= 0:
                    chunks = chunks[last_partial_index + 1:]
                    data["chunks"] = chunks
                    data["chunk_base_offset"] = int(data.get("chunk_base_offset", 0) or 0) + last_partial_index + 1
                    changed = True
                sizes = [len(item.encode("utf-8", errors="ignore")) if isinstance(item, str) else len(json.dumps(item, ensure_ascii=False).encode("utf-8")) for item in chunks]
                total_bytes = sum(sizes)
                drop = max(0, len(chunks) - max_chunks)
                dropped_bytes = sum(sizes[:drop])
                while drop < len(chunks) and total_bytes - dropped_bytes > max_replay_bytes:
                    dropped_bytes += sizes[drop]
                    drop += 1
                if drop:
                    data["chunks"] = chunks[drop:]
                    data["chunk_base_offset"] = int(data.get("chunk_base_offset", 0) or 0) + drop
                    changed = True
                event_count = max(
                    int(data.get("event_count", 0) or 0),
                    int(data.get("chunk_base_offset", 0) or 0) + len(data.get("chunks") or []),
                )
                replay_bytes = total_bytes - dropped_bytes
                if data.get("event_count") != event_count:
                    data["event_count"] = event_count
                    changed = True
                if data.get("replay_bytes") != replay_bytes:
                    data["replay_bytes"] = replay_bytes
                    changed = True
            if changed:
                data["snapshot_version"] = max(2, int(data.get("snapshot_version", 1) or 1))
                tmp = path.with_suffix(path.suffix + ".compact.tmp")
                payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
                fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                try:
                    with os.fdopen(fd, "w", encoding="utf-8") as handle:
                        handle.write(payload)
                        handle.flush()
                        os.fsync(handle.fileno())
                except Exception:
                    try:
                        os.close(fd)
                    except OSError:
                        pass
                    raise
                os.chmod(tmp, 0o600)
                os.replace(tmp, path)
                try:
                    dir_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
                    try:
                        os.fsync(dir_fd)
                    finally:
                        os.close(dir_fd)
                except OSError:
                    pass
                result["compacted"] += 1
            result["bytes_after"] += path.stat().st_size
        except Exception:
            result["errors"] += 1
            if tmp is not None:
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass
            try:
                result["bytes_after"] += path.stat().st_size
            except OSError:
                pass
    return result
