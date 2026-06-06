"""
OneAPIChat Engine - Agent 记忆/人格/身份 持久化
提取自 engine_server.py
"""
import json
from pathlib import Path


def _get_memory_file(memory_dir: Path, filename: str, user_id: str = "") -> Path:
    """获取用户隔离的记忆文件路径"""
    if user_id:
        return memory_dir / f"user_{user_id}_{filename}"
    return memory_dir / filename


def read_memory_json(memory_dir: Path, filename: str, user_id: str = "") -> dict:
    """读取记忆文件,返回 dict"""
    fp = _get_memory_file(memory_dir, filename, user_id)
    try:
        return json.loads(fp.read_text(encoding="utf8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def write_memory_json(memory_dir: Path, filename: str, data: dict, user_id: str = "") -> bool:
    """原子写入记忆文件"""
    fp = _get_memory_file(memory_dir, filename, user_id)
    tmp = fp.with_suffix('.tmp')
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf8")
        tmp.replace(fp)
        return True
    except Exception as e:
        print(f"[AgentMemory] 写入失败 {filename}: {e}")
        return False
