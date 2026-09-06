"""Authoritative OneAPIChat chat-file projection for background streams.

The browser is a projection consumer, not the completion durability boundary.  A provider
stream may finish after every tab has closed, so the engine commits the final assistant
message into the same per-user/per-chat JSON file used by api/chat.php before broadcasting
``chat:stream_done``.
"""
from __future__ import annotations

import copy
import fcntl
import hashlib
import json
import os
import re
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


_SAFE_ID = re.compile(r"[^a-zA-Z0-9_-]")


def _safe_component(value: Any, fallback: str) -> str:
    cleaned = _SAFE_ID.sub("", str(value or ""))[:128]
    return cleaned or fallback


def _timestamp_ms(value: Any) -> int:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0
    return int(numeric * 1000 if numeric < 100_000_000_000 else numeric)


def _message_text(message: dict[str, Any]) -> str:
    value = message.get("text", message.get("content", ""))
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for block in value:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return "\n".join(part for part in parts if part)
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    except Exception:
        return str(value or "")


def _merge_stream_text(base: str, incoming: str) -> str:
    """Merge two snapshots of one assistant turn without losing a preamble.

    A tool-capable model may emit a visible preamble before ``web_search`` and
    a later snapshot may contain only the post-tool continuation. Length-based
    winner selection alone silently drops that preamble during projection.
    """
    base = str(base or "")
    incoming = str(incoming or "")
    if not base:
        return incoming
    if not incoming or incoming == base:
        return base
    if incoming.startswith(base):
        return incoming
    if base.startswith(incoming):
        return base
    for overlap in range(min(len(base), len(incoming)), 7, -1):
        if base[-overlap:] == incoming[:overlap]:
            return base + incoming[overlap:]
    separator = "" if base[-1:].isspace() or incoming[:1].isspace() else "\n\n"
    return base + separator + incoming


def _message_id(message: dict[str, Any], index: int = 0) -> str:
    for key in ("id", "message_id", "_rsMsgId"): 
        candidate = str(message.get(key) or "").strip()
        if candidate:
            return re.sub(r"[^a-zA-Z0-9_.:-]", "", candidate)[:160]
    fingerprint = {
        "role": message.get("role", ""),
        "text": _message_text(message),
        "tool_call_id": message.get("tool_call_id", ""),
        "tool_calls": message.get("tool_calls") or [],
        "files": message.get("files") or [],
        "time": message.get("timestamp", message.get("created_at", message.get("time", ""))),
        "index": index,
    }
    raw = json.dumps(fingerprint, ensure_ascii=False, sort_keys=True, default=str)
    return "legacy_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _ensure_message_ids(chat: dict[str, Any]) -> None:
    messages = chat.get("messages")
    if not isinstance(messages, list):
        chat["messages"] = []
        return
    for index, message in enumerate(messages):
        if isinstance(message, dict):
            message["id"] = _message_id(message, index)


def _merge_message(base: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(base, dict):
        return copy.deepcopy(incoming if isinstance(incoming, dict) else {})
    if not isinstance(incoming, dict):
        return copy.deepcopy(base)

    base_partial = bool(base.get("partial") or base.get("_recovered"))
    incoming_partial = bool(incoming.get("partial") or incoming.get("_recovered"))

    # 1. 终态优先级：完成态消息绝对优先于 partial/未完成消息
    if base_partial and not incoming_partial:
        dominant, subordinate = copy.deepcopy(incoming), base
    elif not base_partial and incoming_partial:
        dominant, subordinate = copy.deepcopy(base), incoming
    else:
        # 2. 两者同为完成态或同为未完成态：内容更长、信息更丰富的优先
        base_len = len(_message_text(base))
        incoming_len = len(_message_text(incoming))
        if incoming_len > base_len:
            dominant, subordinate = copy.deepcopy(incoming), base
        else:
            dominant, subordinate = copy.deepcopy(base), incoming

    merged = copy.deepcopy(dominant)
    # Preserve both sides of a streamed assistant turn across tool calls.
    # When an earlier assistant turn had tool_calls and a visible preamble, and
    # a later continuation finishes the same turn, merge their content chronologically
    # instead of dropping the preamble. But do not prepend in-flight partial chunks
    # of the exact same message stream.
    if str(base.get("role") or "") == "assistant" and str(incoming.get("role") or "") == "assistant":
        is_same_stream_partial = (base_partial != incoming_partial) and (
            base.get("id") == incoming.get("id") or str(base.get("_rsMsgId") or "") == str(incoming.get("_rsMsgId") or "")
        )
        base_has_tools = bool(base.get("tool_calls"))
        inc_has_tools = bool(incoming.get("tool_calls"))
        if (base_has_tools or inc_has_tools or not is_same_stream_partial) and not is_same_stream_partial:
            base_text = _message_text(base).strip()
            inc_text = _message_text(incoming).strip()
            if base_text and inc_text and not inc_text.startswith(base_text) and not base_text.startswith(inc_text):
                merged["content"] = _merge_stream_text(base_text, inc_text)
            if base.get("reasoning") and incoming.get("reasoning"):
                merged["reasoning"] = _merge_stream_text(str(base.get("reasoning") or ""), str(incoming.get("reasoning") or ""))
    # 补充从属方有但主导方没有的非空字段
    for key, value in subordinate.items():
        if key in ("partial", "_recovered"):
            continue
        if key not in merged or merged[key] in (None, "", [], {}):
            merged[key] = copy.deepcopy(value)

    # 只要有一方是已完成状态，结果绝不带有 partial/_recovered
    if not base_partial or not incoming_partial:
        merged.pop("partial", None)
        merged.pop("_recovered", None)

    # 图片合并
    if not merged.get("generatedImage") and subordinate.get("generatedImage"):
        merged["generatedImage"] = copy.deepcopy(subordinate["generatedImage"])
    all_imgs = []
    seen_imgs = set()
    for img_list in (dominant.get("generatedImages") or [], subordinate.get("generatedImages") or []):
        if isinstance(img_list, list):
            for img in img_list:
                img_key = json.dumps(img, sort_keys=True) if isinstance(img, dict) else str(img)
                if img_key and img_key not in seen_imgs:
                    seen_imgs.add(img_key)
                    all_imgs.append(copy.deepcopy(img))
    if all_imgs:
        merged["generatedImages"] = all_imgs

    # 工具调用：取更完整的列表
    if len(subordinate.get("tool_calls") or []) > len(merged.get("tool_calls") or []):
        merged["tool_calls"] = copy.deepcopy(subordinate["tool_calls"])

    return merged


def _merge_chat(base: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    base = copy.deepcopy(base if isinstance(base, dict) else {})
    incoming = copy.deepcopy(incoming if isinstance(incoming, dict) else {})
    _ensure_message_ids(base)
    _ensure_message_ids(incoming)
    base_messages = base.get("messages") or []
    incoming_messages = incoming.get("messages") or []
    base_revision = max(int(base.get("revision") or 0), len(base_messages))
    incoming_revision = max(int(incoming.get("revision") or 0), len(incoming_messages))
    base_updated = _timestamp_ms(base.get("updated_at"))
    incoming_updated = _timestamp_ms(incoming.get("updated_at"))
    prefer_incoming = incoming_revision > base_revision or (
        incoming_revision == base_revision and incoming_updated >= base_updated
    )
    primary, secondary = (incoming, base) if prefer_incoming else (base, incoming)
    merged = copy.deepcopy(primary)
    ordered: list[dict[str, Any]] = []
    positions: dict[str, int] = {}
    for index, message in enumerate(primary.get("messages") or []):
        if not isinstance(message, dict):
            continue
        cloned = copy.deepcopy(message)
        mid = _message_id(cloned, index)
        cloned["id"] = mid
        positions[mid] = len(ordered)
        ordered.append(cloned)
    for index, message in enumerate(secondary.get("messages") or []):
        if not isinstance(message, dict):
            continue
        cloned = copy.deepcopy(message)
        mid = _message_id(cloned, index)
        cloned["id"] = mid
        if mid in positions:
            pos = positions[mid]
            ordered[pos] = _merge_message(ordered[pos], cloned)
        else:
            positions[mid] = len(ordered)
            ordered.append(cloned)
    merged["messages"] = ordered
    merged["revision"] = max(base_revision, incoming_revision, len(ordered))
    merged["updated_at"] = max(base_updated, incoming_updated, int(time.time() * 1000))
    if not merged.get("title"):
        merged["title"] = secondary.get("title") or "新对话"
    return merged


@contextmanager
def _locked(lock_path: Path) -> Iterator[None]:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, raw_tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    tmp_path = Path(raw_tmp)
    try:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
        os.write(fd, data)
        os.fsync(fd)
        os.close(fd)
        fd = -1
        os.chmod(tmp_path, 0o666)
        os.replace(tmp_path, path)
        try:
            directory_fd = os.open(str(path.parent), os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            pass
    finally:
        if fd >= 0:
            os.close(fd)
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass


class ChatProjectionStore:
    """Merge one engine completion into api/chat.php's authoritative single-chat file."""

    def __init__(self, project_root: str | Path):
        self.project_root = Path(project_root)
        self.data_dir = self.project_root / "chat_data"

    def _paths(self, user_id: str, chat_id: str) -> tuple[Path, Path]:
        owner = _safe_component(user_id, "anonymous")
        cid = _safe_component(chat_id, "chat")
        namespace = f"user_{owner}"
        return self.data_dir / f"{namespace}_{cid}.json", self.data_dir / f"{namespace}_all.json"

    def _fallback_chat(self, request_data: dict[str, Any], chat_id: str, user_id: str) -> dict[str, Any]:
        latest_user: dict[str, Any] | None = None
        messages: list[dict[str, Any]] = []
        for index, message in enumerate(request_data.get("messages") or []):
            if not isinstance(message, dict) or message.get("role") not in {"system", "user", "assistant", "tool"}:
                continue
            projected = copy.deepcopy(message)
            projected["id"] = _message_id(projected, index)
            if projected.get("role") == "user":
                latest_user = projected
                projected["text"] = _message_text(projected)
                projected.pop("content", None)
            messages.append(projected)
        title = (_message_text(latest_user)[:28] if latest_user else "新对话") or "新对话"
        return {
            "title": title,
            "userId": user_id,
            "chat_id": chat_id,
            "updated_at": int(time.time() * 1000),
            "revision": len(messages),
            "messages": messages,
        }

    def commit_assistant(
        self,
        *,
        user_id: str,
        chat_id: str,
        msg_id: str,
        request_data: dict[str, Any],
        content: str = "",
        reasoning: str = "",
        tool_calls: list[dict[str, Any]] | None = None,
        usage: dict[str, Any] | None = None,
        error: Any = None,
        stop_reason: str = "",
        truncated: bool = False,
        model: str = "",
    ) -> dict[str, Any]:
        if not user_id or not chat_id or not msg_id:
            return {"ok": False, "error": "missing projection identity"}
        chat_path, all_path = self._paths(user_id, chat_id)
        with _locked(chat_path.with_suffix(chat_path.suffix + ".lock")):
            current = _read_json(chat_path)
            if not current:
                all_data = _read_json(all_path)
                candidate = (all_data.get("chats") or {}).get(chat_id) if isinstance(all_data.get("chats"), dict) else None
                current = copy.deepcopy(candidate) if isinstance(candidate, dict) else self._fallback_chat(request_data, chat_id, user_id)
            final_model = model or str(request_data.get("model") or "")
            effort = str(
                request_data.get("effort")
                or request_data.get("reasoning_effort")
                or request_data.get("thinking_level")
                or ""
            ).strip()
            if not effort and final_model:
                m_effort = re.search(r'-(off|minimal|low|medium|high|xhigh|max)$', final_model.lower())
                if m_effort:
                    effort = m_effort.group(1)
            if not effort:
                r_tokens = ((usage or {}).get("completion_tokens_details") or {}).get("reasoning_tokens")
                if r_tokens and int(r_tokens) > 0:
                    effort = "已开启"
                elif str(reasoning or "").strip():
                    effort = "已开启"

            assistant: dict[str, Any] = {
                "id": msg_id,
                "message_id": msg_id,
                "_rsMsgId": msg_id,
                "role": "assistant",
                "content": str(content or ""),
                "reasoning": str(reasoning or ""),
                "tool_calls": copy.deepcopy(tool_calls or []),
                "usage": copy.deepcopy(usage or {}),
                "model": final_model,
                "time": int(time.time() * 1000),
                "stop_reason": stop_reason or "",
                "truncated": bool(truncated),
            }
            if effort:
                assistant["effort"] = effort
                assistant["reasoning_effort"] = effort
            provider_val = str(request_data.get("provider") or "").strip()
            if provider_val and provider_val != "Array":
                assistant["provider"] = provider_val
            if error:
                assistant["_resumeError"] = error if isinstance(error, str) else json.dumps(error, ensure_ascii=False, default=str)
            if not assistant["tool_calls"]:
                assistant.pop("tool_calls")
            if not assistant["usage"]:
                assistant.pop("usage")
            current_messages = current.get("messages") if isinstance(current.get("messages"), list) else []
            
            # 找到最后一条 user 消息的索引
            last_user_idx = -1
            for index, message in enumerate(current_messages):
                if isinstance(message, dict) and message.get("role") == "user":
                    last_user_idx = index

            replaced = False
            projected_messages: list[dict[str, Any]] = []
            for index, message in enumerate(current_messages):
                if not isinstance(message, dict):
                    continue
                if _message_id(message, index) == msg_id or str(message.get("_rsMsgId") or "") == msg_id:
                    projected_messages.append(_merge_message(message, assistant))
                    replaced = True
                else:
                    projected_messages.append(copy.deepcopy(message))

            # 防同一轮裂变：若未匹配精确 ID，但在最后一条用户消息之后已存在本轮 assistant 消息，
            # 说明经历了多轮工具迭代或刷新恢复，必须就地升级/融合为同一条完成态回复，绝不追加多余重复气泡！
            if not replaced:
                found_turn_assistant = False
                if last_user_idx >= 0:
                    for j in range(len(projected_messages) - 1, last_user_idx, -1):
                        if projected_messages[j].get("role") == "assistant":
                            orig_id = projected_messages[j].get("id")
                            merged_msg = _merge_message(projected_messages[j], assistant)
                            if orig_id:
                                merged_msg["id"] = orig_id
                                merged_msg["message_id"] = orig_id
                                merged_msg["_rsMsgId"] = orig_id
                            projected_messages[j] = merged_msg
                            found_turn_assistant = True
                            replaced = True
                            break
                if not found_turn_assistant:
                    projected_messages.append(assistant)
            incoming = {
                "title": current.get("title") or "新对话",
                "userId": current.get("userId") or user_id,
                "chat_id": chat_id,
                "updated_at": int(time.time() * 1000),
                "revision": max(int(current.get("revision") or 0) + (0 if replaced else 1), len(projected_messages)),
                "messages": projected_messages,
            }
            merged = _merge_chat(current, incoming)
            _atomic_write(chat_path, merged)
        return {
            "ok": True,
            "path": str(chat_path),
            "revision": int(merged.get("revision") or 0),
            "updated_at": int(merged.get("updated_at") or 0),
            "msg_count": len(merged.get("messages") or []),
        }

    def commit_subagent(
        self,
        *,
        user_id: str,
        agent_name: str,
        prompt: str,
        result: str,
        error: str = "",
        status: str = "completed",
    ) -> dict[str, Any]:
        """Even if no browser is open, persist completed subagent tasks as durable chats."""
        if not user_id or not agent_name:
            return {"ok": False, "error": "missing subagent identity"}
        chat_id = f"_agent_sub_{agent_name}"
        chat_path, _ = self._paths(user_id, chat_id)
        now_ms = int(time.time() * 1000)
        with _locked(chat_path.with_suffix(chat_path.suffix + ".lock")):
            current = _read_json(chat_path)
            messages = current.get("messages") if isinstance(current.get("messages"), list) else []
            user_msg_id = f"sub_usr_{agent_name}"
            asst_msg_id = f"sub_asst_{agent_name}_{now_ms}"
            user_found = False
            for m in messages:
                if isinstance(m, dict) and m.get("role") == "user":
                    user_found = True
                    break
            if not user_found and prompt:
                messages.append({
                    "id": user_msg_id,
                    "role": "user",
                    "text": str(prompt),
                    "content": str(prompt),
                    "time": now_ms - 1000,
                })
            assistant_content = str(result or error or "任务已执行完成")
            messages.append({
                "id": asst_msg_id,
                "role": "assistant",
                "content": assistant_content,
                "text": assistant_content,
                "time": now_ms,
                "status": status,
                "_agentNotification": True,
            })
            chat_data = {
                "title": f"🤖 {agent_name}",
                "userId": user_id,
                "chat_id": chat_id,
                "updated_at": now_ms,
                "revision": len(messages),
                "_agentSub": True,
                "messages": messages,
            }
            _atomic_write(chat_path, chat_data)
        return {
            "ok": True,
            "chat_id": chat_id,
            "path": str(chat_path),
            "revision": len(messages),
            "updated_at": now_ms,
        }
