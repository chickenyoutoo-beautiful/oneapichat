"""
OneAPIChat Memory Engine — Hybrid search (vector + BM25 + graph) with chromadb + fastembed.
"""
import time, math, json, threading
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
import numpy as np

from engine.memory_db import (
    init_memory_db_dir, get_conn, save_fact, list_facts, delete_fact, get_fact,
    save_episode, list_episodes, delete_episode,
    save_personality, load_personality, load_personality_as_dict,
    search_facts_fts, search_episodes_fts,
    get_related_facts, get_fact_relations, get_all_entities,
    cleanup_expired_facts, get_stats, close_all as close_all_db,
)

CHROMA_DIR: Optional[Path] = None
_chroma_client = None
_ef = None
_lock = threading.Lock()

SEARCH_WEIGHTS = {
    "vector": 0.40, "bm25": 0.30, "graph": 0.20,
    "importance": 0.05, "recency": 0.05,
}
HALF_LIFE_DAYS = 30


def init_memory_engine(engine_dir: Path):
    """Initialize memory engine (call once at startup)."""
    global CHROMA_DIR, _chroma_client, _ef
    init_memory_db_dir(engine_dir)
    CHROMA_DIR = engine_dir / "chroma"
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    import chromadb
    _chroma_client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    from chromadb.utils import embedding_functions
    _ef = embedding_functions.DefaultEmbeddingFunction()
    print("[MemoryEngine] Initialized — chromadb + fastembed ready")


def _get_client():
    if _chroma_client is None:
        raise RuntimeError("init_memory_engine() not called")
    return _chroma_client


def _get_col(user_id: str, kind: str):
    client = _get_client()
    name = f"mem_{kind}_{user_id}"
    try:
        return client.get_collection(name)
    except Exception:
        return client.create_collection(name, metadata={"hnsw:space": "cosine"})


def _embed(text: str) -> list:
    result = _ef([text])
    return result[0].tolist() if hasattr(result[0], 'tolist') else list(result[0])


def _chroma_sync(user_id: str, kind: str, item_id: str, text: str, metadata: dict):
    try:
        col = _get_col(user_id, kind)
        emb = _embed(text)
        col.upsert(ids=[item_id], embeddings=[emb], metadatas=[metadata], documents=[text[:2000]])
    except Exception as e:
        print(f"[MemoryEngine] chroma upsert warning ({kind}/{item_id}): {e}")


def _chroma_delete(user_id: str, kind: str, item_id: str):
    try:
        _get_col(user_id, kind).delete(ids=[item_id])
    except Exception as e:
        print(f"[MemoryEngine] chroma delete warning: {e}")


def _chroma_search(user_id: str, kind: str, query: str, limit=10) -> list:
    """Returns [(id, score, metadata), ...]"""
    try:
        col = _get_col(user_id, kind)
        emb = _embed(query)
        results = col.query(query_embeddings=[emb], n_results=limit, include=["metadatas", "distances"])
        if not results.get("ids") or not results["ids"][0]:
            return []
        items = []
        for i, item_id in enumerate(results["ids"][0]):
            dist = results["distances"][0][i] if results.get("distances") else 1.0
            score = 1.0 - min(dist, 2.0) / 2.0
            meta = results["metadatas"][0][i] if results.get("metadatas") else {}
            items.append((item_id, score, meta))
        return items
    except Exception as e:
        print(f"[MemoryEngine] chroma search warning: {e}")
        return []


def hybrid_search(user_id: str, query: str = "", layers=None, limit=10, threshold=0.0) -> dict:
    """Unified hybrid search with RRF merge."""
    if layers is None:
        layers = ["facts", "episodes"]
    all_scores = {}
    now = datetime.now(timezone.utc)

    if not query:
        results = []
        if "facts" in layers:
            for f in list_facts(user_id, limit=limit):
                results.append({"id": f["id"], "layer": "facts", "item": f, "score": f.get("importance", 5) / 10.0})
        if "episodes" in layers:
            for e in list_episodes(user_id, limit=limit):
                results.append({"id": e["id"], "layer": "episodes", "item": e, "score": e.get("importance", 5) / 10.0})
        results.sort(key=lambda x: x["score"], reverse=True)
        return {"results": results[:limit], "total": len(results), "query": query}

    # Vector search
    for layer in layers:
        for item_id, score, meta in _chroma_search(user_id, layer, query, limit):
            if item_id not in all_scores:
                all_scores[item_id] = {"id": item_id, "layer": layer, "scores": {}}
            all_scores[item_id]["scores"]["vector"] = score

    # BM25 search
    if "facts" in layers:
        for f in search_facts_fts(user_id, query, limit):
            fid = f["id"]
            if fid not in all_scores:
                all_scores[fid] = {"id": fid, "layer": "facts", "scores": {}, "item": f}
            else:
                all_scores[fid]["item"] = f
            rank = abs(f.get("rank", 10))
            all_scores[fid]["scores"]["bm25"] = 1.0 / (1.0 + math.log(1 + rank))

    if "episodes" in layers:
        for e in search_episodes_fts(user_id, query, limit):
            eid = e["id"]
            if eid not in all_scores:
                all_scores[eid] = {"id": eid, "layer": "episodes", "scores": {}, "item": e}
            else:
                all_scores[eid]["item"] = e
            rank = abs(e.get("rank", 10))
            all_scores[eid]["scores"]["bm25"] = 1.0 / (1.0 + math.log(1 + rank))

    # Entity graph traversal
    if "facts" in layers:
        entities_in_query = _extract_entity_mentions(query, user_id)
        for entity in entities_in_query[:3]:
            for f in get_related_facts(user_id, entity, limit=5):
                fid = f["id"]
                if fid not in all_scores:
                    all_scores[fid] = {"id": fid, "layer": "facts", "scores": {}, "item": f}
                else:
                    all_scores[fid]["item"] = f
                all_scores[fid]["scores"]["graph"] = all_scores[fid]["scores"].get("graph", 0) + 0.5

    # Compute final scores
    results = []
    w = SEARCH_WEIGHTS
    for item_id, entry in all_scores.items():
        scores = entry["scores"]
        item = entry.get("item")
        if item is None:
            item = get_fact(user_id, item_id) if entry["layer"] == "facts" else None
            if item is None: continue

        final = 0.0
        if "vector" in scores: final += scores["vector"] * w["vector"]
        if "bm25" in scores: final += scores["bm25"] * w["bm25"]
        if "graph" in scores: final += min(scores["graph"], 1.0) * w["graph"]

        importance = item.get("importance", 5)
        final += (importance / 10.0) * w["importance"]

        updated_str = item.get("updated_at") or item.get("created_at") or item.get("occurred_at", "")
        if updated_str:
            try:
                updated = datetime.fromisoformat(updated_str.replace("Z", "+00:00"))
                age_days = (now - updated).total_seconds() / 86400.0
                final += math.pow(0.5, age_days / HALF_LIFE_DAYS) * w["recency"]
            except Exception: pass

        if final >= threshold:
            results.append({
                "id": item_id, "layer": entry["layer"], "item": item,
                "score": round(final, 4),
                "scores": {k: round(v, 4) for k, v in scores.items()},
            })

    results.sort(key=lambda x: x["score"], reverse=True)
    return {"results": results[:limit], "total": len(results), "query": query}


def _extract_entity_mentions(query: str, user_id: str) -> list:
    entities = get_all_entities(user_id)
    ql = query.lower()
    matched = [e for e in entities if e.lower() in ql]
    matched.sort(key=len, reverse=True)
    return matched


def build_context(user_id: str, query: str = "", max_facts=15, max_episodes=5, include_personality=True) -> str:
    """Build system-prompt-ready context block from all memory layers."""
    parts = []

    if include_personality:
        persona = load_personality_as_dict(user_id)
        if persona:
            lines = ["## 人格设定"]
            for k, v in persona.items():
                lines.append(f"- {k}: {v}")
            parts.append("\n".join(lines))

    if query:
        sr = hybrid_search(user_id, query=query, layers=["facts"], limit=max_facts)
        facts = [r["item"] for r in sr["results"]]
    else:
        facts = list_facts(user_id, limit=max_facts)

    if facts:
        lines = ["## 长期记忆", "以下是与用户相关的记忆信息:"]
        for f in facts:
            key = f.get("relation", f.get("key", "info"))
            content = f.get("content", "")
            lines.append(f"- [{key}] {content}")
        parts.append("\n".join(lines))

    episodes = list_episodes(user_id, limit=max_episodes)
    if episodes:
        lines = ["## 最近对话摘要"]
        for e in episodes:
            lines.append(f"- {e.get('title', '对话')}: {e.get('summary', '')[:200]}")
        parts.append("\n".join(lines))

    return "\n\n".join(parts)


def engine_save_fact(user_id: str, fact: dict) -> dict:
    result = save_fact(user_id, fact)
    text = f"{fact['entity']} {fact['relation']} {fact['target']}: {fact.get('content', fact['target'])}"
    try:
        _chroma_sync(user_id, "facts", result["id"], text, {
            "entity": fact["entity"], "relation": fact["relation"],
            "importance": str(fact.get("importance", 5)),
        })
    except Exception as e: print(f"[MemoryEngine] chroma sync warning: {e}")
    return result


def engine_delete_fact(user_id: str, fact_id: str) -> bool:
    result = delete_fact(user_id, fact_id)
    if result:
        try: _chroma_delete(user_id, "facts", fact_id)
        except: pass
    return result


def engine_save_episode(user_id: str, episode: dict) -> dict:
    result = save_episode(user_id, episode)
    text = f"{episode['title']}: {episode.get('summary', '')}"
    try:
        _chroma_sync(user_id, "episodes", result["id"], text, {
            "title": episode["title"],
            "emotional_tone": episode.get("emotional_tone", "neutral"),
        })
    except Exception as e: print(f"[MemoryEngine] chroma sync warning: {e}")
    return result


def engine_extract_from_conversation(user_id: str, messages: list) -> dict:
    conv_text = "\n".join(
        f"{'用户' if m.get('role') == 'user' else 'AI'}: {str(m.get('content', ''))[:300]}"
        for m in messages[-20:] if m.get('role') in ('user', 'assistant'))
    return {
        "conversation_text": conv_text,
        "message_count": len(messages),
        "ready_for_extraction": len([m for m in messages if m.get('role') == 'user']) >= 3,
    }


def engine_cleanup(user_id: str):
    cleanup_expired_facts(user_id)


def engine_close():
    close_all_db()
