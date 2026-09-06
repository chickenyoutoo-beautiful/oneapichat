"""Bounded, query-aware self-description and context admission."""
from __future__ import annotations
import re
from pathlib import Path
from typing import Any
DEFAULT_FILES = (("project", "PROJECT.md"), ("architecture", "ARCHITECTURE.md"), ("rules", "OPERATING_RULES.md"), ("change_policy", "CHANGE_POLICY.md"))
def _read(path: Path, limit: int) -> str:
    try:
        return path.read_text(encoding="utf-8")[:limit]
    except (OSError, UnicodeError):
        return ""
def load_self_description(root: str | Path, per_file_limit: int = 12000) -> dict[str, Any]:
    base = Path(root) / "agent_context"
    sections = []
    for key, filename in DEFAULT_FILES:
        text = _read(base / filename, per_file_limit)
        if text:
            sections.append({"id": key, "file": filename, "content": text})
    return {"version": 1, "root": str(Path(root)), "sections": sections}
def _terms(query: str) -> set[str]:
    return {x.lower() for x in re.findall(r"[\w\u4e00-\u9fff]{2,}", query or "")}
def admit_self_context(root: str | Path, query: str = "", budget: int = 14000) -> dict[str, Any]:
    snapshot = load_self_description(root)
    terms = _terms(query)
    ranked = []
    for section in snapshot["sections"]:
        score = sum(section["content"].lower().count(term) for term in terms)
        ranked.append((score, section))
    ranked.sort(key=lambda item: (-item[0], item[1]["id"]))
    selected, used = [], 0
    for score, section in ranked:
        if selected and terms and score == 0:
            continue
        remaining = max(0, budget - used)
        if remaining <= 0:
            break
        content = section["content"][:remaining]
        selected.append({**section, "score": score, "content": content})
        used += len(content)
    text = "\n\n".join(f"## {item['id']} ({item['file']})\n{item['content']}" for item in selected)
    return {"version": 1, "query": query, "budget": budget, "used": used, "sections": selected, "text": text}
def self_summary(root: str | Path) -> dict[str, Any]:
    snapshot = load_self_description(root, per_file_limit=2000)
    return {"version": snapshot["version"], "root": snapshot["root"], "sections": [{"id": s["id"], "file": s["file"], "chars": len(s["content"])} for s in snapshot["sections"]]}
