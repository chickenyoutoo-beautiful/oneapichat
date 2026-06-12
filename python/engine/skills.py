"""
OneAPIChat Skills System — 可复用的参数化提示词模板
技能作为可通过 run_skill 工具调用的子代理执行
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

SKILLS_DIR = Path(__file__).resolve().parent.parent.parent / ".engine" / "skills"
SKILLS_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class SkillDef:
    name: str                     # 技能名称(英文ID)
    label: str = ""               # 中文标签
    description: str = ""         # LLM 视角描述(何时调用)
    prompt_template: str = ""     # 带 {param_name} 占位符的提示词
    parameters: dict = None       # OpenAI JSON Schema
    tools: list[str] = None       # 该技能允许的工具
    model_tier: str = "smart"     # cheap | smart
    max_rounds: int = 10
    created: str = ""
    enabled: bool = True

    def __post_init__(self):
        if self.parameters is None:
            self.parameters = {"type": "object", "properties": {}, "required": []}
        if self.tools is None:
            self.tools = ["web_search", "web_fetch"]
        if not self.created:
            self.created = time.strftime("%Y-%m-%d %H:%M:%S")


def _skill_file(user_id: str) -> Path:
    """每个用户一个 JSON 文件"""
    uid = re.sub(r'[^a-zA-Z0-9_-]', '', user_id) if user_id else "default"
    return SKILLS_DIR / f"skills_{uid}.json"


def _load_skills(user_id: str) -> dict:
    """加载用户技能列表"""
    path = _skill_file(user_id)
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return {"skills": []}


def _save_skills(user_id: str, data: dict):
    """保存用户技能列表"""
    path = _skill_file(user_id)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def list_skills(user_id: str) -> list[dict]:
    """列出用户的所有技能"""
    data = _load_skills(user_id)
    return data.get("skills", [])


def get_skill(user_id: str, name: str) -> Optional[dict]:
    """获取指定技能"""
    for s in list_skills(user_id):
        if s.get("name") == name:
            return s
    return None


def create_skill(user_id: str, skill: dict) -> dict:
    """创建技能。返回 (ok, skill 或 error)"""
    data = _load_skills(user_id)
    skills = data.get("skills", [])

    # 验证
    name = (skill.get("name") or "").strip()
    if not name:
        return {"ok": False, "error": "技能名称不能为空"}
    if not re.match(r'^[a-zA-Z][a-zA-Z0-9_]*$', name):
        return {"ok": False, "error": "技能名称只能包含字母、数字和下划线,以字母开头"}

    # 检查重复
    for s in skills:
        if s.get("name") == name:
            return {"ok": False, "error": f"技能 '{name}' 已存在"}

    sd = SkillDef(
        name=name,
        label=skill.get("label", name),
        description=skill.get("description", ""),
        prompt_template=skill.get("prompt_template", ""),
        parameters=skill.get("parameters", {"type": "object", "properties": {}, "required": []}),
        tools=skill.get("tools", ["web_search", "web_fetch"]),
        model_tier=skill.get("model_tier", "smart"),
        max_rounds=int(skill.get("max_rounds", 10)),
    )

    skills.append(sd.__dict__)
    data["skills"] = skills
    _save_skills(user_id, data)
    return {"ok": True, "skill": sd.__dict__}


def update_skill(user_id: str, name: str, updates: dict) -> dict:
    """更新技能"""
    data = _load_skills(user_id)
    skills = data.get("skills", [])
    for i, s in enumerate(skills):
        if s.get("name") == name:
            for key in ["label", "description", "prompt_template", "parameters",
                        "tools", "model_tier", "max_rounds", "enabled"]:
                if key in updates:
                    s[key] = updates[key]
            data["skills"] = skills
            _save_skills(user_id, data)
            return {"ok": True, "skill": s}
    return {"ok": False, "error": f"技能 '{name}' 不存在"}


def delete_skill(user_id: str, name: str) -> dict:
    """删除技能"""
    data = _load_skills(user_id)
    skills = data.get("skills", [])
    original = len(skills)
    data["skills"] = [s for s in skills if s.get("name") != name]
    if len(data["skills"]) < original:
        _save_skills(user_id, data)
        return {"ok": True}
    return {"ok": False, "error": f"技能 '{name}' 不存在"}


def render_prompt(template: str, params: dict) -> str:
    """将 {param_name} 占位符替换为参数值"""
    def _replacer(m):
        key = m.group(1)
        return str(params.get(key, m.group(0)))
    return re.sub(r'\{(\w+)\}', _replacer, template)


def extract_params(template: str) -> list[str]:
    """从提示词模板中提取参数名列表"""
    return list(set(re.findall(r'\{(\w+)\}', template)))
