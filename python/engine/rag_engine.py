"""
OneAPIChat RAG Engine — 最小可用知识库检索
文件上传 → 分块 → 嵌入 → 存储 → 余弦搜索
"""
import json
import os
import time
import hashlib
from pathlib import Path
from typing import Optional

RAG_DIR = Path(__file__).resolve().parent.parent.parent / ".engine" / "rag"
RAG_DIR.mkdir(parents=True, exist_ok=True)


def _load_json(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return {}


def _save_json(path: Path, data: dict):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def _get_embedding(text: str, api_key: str = "", base_url: str = "",
                   model: str = "text-embedding-3-small") -> Optional[list]:
    """调用 OpenAI 兼容 embedding API"""
    if not api_key or not base_url:
        # 尝试从配置读取
        config_path = RAG_DIR.parent.parent / "config" / ".mmx_config.json"
        cfg = _load_json(config_path)
        api_key = api_key or cfg.get("api_key", "") or cfg.get("mmx_api_key", "")
        base_url = base_url or cfg.get("api_base", "") or cfg.get("base_url", "")
        model = model or cfg.get("embed_model", "text-embedding-3-small")

    if not api_key or not base_url:
        return None

    import requests
    url = base_url.rstrip("/") + "/embeddings"
    try:
        resp = requests.post(url, json={
            "model": model,
            "input": text[:2048]
        }, headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("data", [{}])[0].get("embedding")
    except Exception as e:
        print(f"[RAG] embedding error: {e}")
    return None


def _cosine_similarity(a: list, b: list) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _chunk_text(text: str, chunk_size: int = 512, overlap: int = 50) -> list:
    """简单固定大小分块（用句号/换行作为自然断点）"""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        # 尝试在自然断点处切割
        if end < len(text):
            for sep in ['\n\n', '\n', '。', '！', '？', '.', '!', '?', '；', ';']:
                pos = text.rfind(sep, start + chunk_size // 2, end)
                if pos > 0:
                    end = pos + 1
                    break
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end - overlap if end < len(text) else len(text)
    return chunks


# ═══════════════════════════════════════════════════════
# RAG API 函数
# ═══════════════════════════════════════════════════════

def rag_list_collections(user_id: str = "") -> dict:
    """列出用户的知识库集合"""
    collections_file = RAG_DIR / (f"collections_{user_id}.json" if user_id else "collections.json")
    data = _load_json(collections_file)
    return {"collections": list(data.get("collections", {}).keys())}


def rag_create_collection(name: str, user_id: str = "") -> dict:
    """创建知识库集合"""
    collections_file = RAG_DIR / (f"collections_{user_id}.json" if user_id else "collections.json")
    data = _load_json(collections_file)
    if "collections" not in data:
        data["collections"] = {}
    if name in data["collections"]:
        return {"error": f"集合 '{name}' 已存在"}
    data["collections"][name] = {"created": time.time(), "doc_count": 0}
    _save_json(collections_file, data)
    return {"ok": True, "collection": name}


def rag_delete_collection(name: str, user_id: str = "") -> dict:
    """删除知识库集合"""
    collections_file = RAG_DIR / (f"collections_{user_id}.json" if user_id else "collections.json")
    data = _load_json(collections_file)
    if name not in data.get("collections", {}):
        return {"error": f"集合 '{name}' 不存在"}
    del data["collections"][name]
    _save_json(collections_file, data)
    # 删除对应文档
    docs_file = RAG_DIR / (f"docs_{user_id}_{name}.json")
    if docs_file.exists():
        docs_file.unlink()
    return {"ok": True, "collection": name}


def rag_upload_document(collection: str, filename: str, content: str,
                        user_id: str = "", chunk_size: int = 512,
                        chunk_overlap: int = 50, api_key: str = "",
                        base_url: str = "", embed_model: str = "") -> dict:
    """上传文档到知识库：分块 → 嵌入 → 存储"""
    if not content.strip():
        return {"error": "文档内容为空"}

    chunks = _chunk_text(content, chunk_size, chunk_overlap)
    if not chunks:
        return {"error": "无法从文档中提取文本块"}

    # 存储文档
    docs_file = RAG_DIR / (f"docs_{user_id}_{collection}.json" if user_id else f"docs_{collection}.json")
    data = _load_json(docs_file)
    if "documents" not in data:
        data["documents"] = []

    doc_id = hashlib.md5(f"{filename}{time.time()}".encode()).hexdigest()[:12]

    # 为每个块生成 embedding
    indexed_chunks = []
    for i, chunk in enumerate(chunks):
        embedding = _get_embedding(chunk, api_key, base_url, embed_model)
        indexed_chunks.append({
            "chunk_id": f"{doc_id}_{i}",
            "text": chunk,
            "embedding": embedding,
            "index": i
        })

    data["documents"].append({
        "doc_id": doc_id,
        "filename": filename,
        "chunks": indexed_chunks,
        "chunk_count": len(indexed_chunks),
        "uploaded_at": time.time()
    })

    # 更新集合计数
    collections_file = RAG_DIR / (f"collections_{user_id}.json" if user_id else "collections.json")
    col_data = _load_json(collections_file)
    if "collections" in col_data and collection in col_data["collections"]:
        col_data["collections"][collection]["doc_count"] = len(data["documents"])
        _save_json(collections_file, col_data)

    _save_json(docs_file, data)
    return {"success": True, "doc_id": doc_id, "chunks": len(indexed_chunks),
            "chunk_count": len(indexed_chunks), "source": filename, "filename": filename,
            "collection": collection}


def rag_search(query: str, collection: str = "default", top_k: int = 5,
               user_id: str = "", api_key: str = "", base_url: str = "",
               embed_model: str = "") -> dict:
    """语义搜索知识库"""
    docs_file = RAG_DIR / (f"docs_{user_id}_{collection}.json" if user_id else f"docs_{collection}.json")
    data = _load_json(docs_file)

    if not data.get("documents"):
        return {"results": [], "total": 0, "message": "知识库为空"}

    query_emb = _get_embedding(query, api_key, base_url, embed_model)
    if not query_emb:
        # 回退到关键词匹配
        return _keyword_search(query, data, top_k)

    # 余弦相似度排序
    scored = []
    for doc in data["documents"]:
        for chunk in doc.get("chunks", []):
            if chunk.get("embedding"):
                sim = _cosine_similarity(query_emb, chunk["embedding"])
                if sim > 0.3:
                    scored.append({
                        "doc_id": doc["doc_id"],
                        "filename": doc["filename"],
                        "chunk_id": chunk["chunk_id"],
                        "text": chunk["text"],
                        "score": round(sim, 4)
                    })

    scored.sort(key=lambda x: x["score"], reverse=True)
    results = scored[:top_k]
    return {"results": results, "total": len(scored), "query": query}


def _keyword_search(query: str, data: dict, top_k: int = 5) -> dict:
    """关键词回退搜索"""
    query_lower = query.lower()
    results = []
    for doc in data.get("documents", []):
        for chunk in doc.get("chunks", []):
            text = chunk["text"]
            if query_lower in text.lower():
                results.append({
                    "doc_id": doc["doc_id"],
                    "filename": doc["filename"],
                    "chunk_id": chunk["chunk_id"],
                    "text": text,
                    "score": 0.5
                })
    return {"results": results[:top_k], "total": len(results), "method": "keyword"}


def rag_list_documents(collection: str = "default", user_id: str = "") -> dict:
    """列出知识库中的文档"""
    docs_file = RAG_DIR / (f"docs_{user_id}_{collection}.json" if user_id else f"docs_{collection}.json")
    data = _load_json(docs_file)
    items = []
    for doc in data.get("documents", []):
        items.append({
            "id": doc["doc_id"],
            "doc_id": doc["doc_id"],
            "source": doc.get("filename", doc.get("source", "")),
            "chunks": doc.get("chunk_count", doc.get("chunks", 0)),
            "chunk_count": doc.get("chunk_count", 0),
            "uploaded_at": doc.get("uploaded_at", 0)
        })
    return {"documents": items, "total": len(items), "collection": collection}


def rag_delete_document(doc_id: str, collection: str = "default", user_id: str = "") -> dict:
    """删除文档"""
    docs_file = RAG_DIR / (f"docs_{user_id}_{collection}.json" if user_id else f"docs_{collection}.json")
    data = _load_json(docs_file)
    original_len = len(data.get("documents", []))
    data["documents"] = [d for d in data.get("documents", []) if d.get("doc_id") != doc_id]
    _save_json(docs_file, data)
    return {"success": True, "ok": True, "removed": original_len - len(data.get("documents", []))}
