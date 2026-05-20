#!/usr/bin/env python3
"""
统一工具注册表 (ToolRegistry)

每个工具自描述 capabilities，支持多重分类：
- ReadOnly / WritesFiles / ExecutesCode / Network / Sandboxable / RequiresApproval
- 审批要求：Auto / Suggest / Required
- 动态工具注册/移除
- 按 capability 过滤
- 导出为 OpenAI tool format

用法:
    registry = ToolRegistry()
    registry.register(tool)
    exec_tools = registry.filter(capabilities=[Capability.ExecutesCode])
    openai_tools = registry.to_openai_format()
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from enum import Enum, auto
from typing import Any, Optional


# ── Capabilities ──────────────────────────────────────

class Capability(Enum):
    """工具能力标记"""
    ReadOnly = auto()
    WritesFiles = auto()
    ExecutesCode = auto()
    Network = auto()
    Sandboxable = auto()
    RequiresApproval = auto()

    def __str__(self) -> str:
        return self.name

    def __repr__(self) -> str:
        return f"Capability.{self.name}"


# ── 审批要求 ──────────────────────────────────────────

class ApprovalKind(Enum):
    """工具审批要求"""
    AUTO = "auto"        # 自动执行，无需审批
    SUGGEST = "suggest"  # 建议用户允许，但用户可一键确认
    REQUIRED = "required"  # 必须用户明确确认

    def __str__(self) -> str:
        return self.value


# ── 工具定义 ──────────────────────────────────────────

@dataclass
class ToolDef:
    """工具注册定义"""
    name: str
    description: str
    capabilities: set[Capability] = field(default_factory=set)
    approval: ApprovalKind = ApprovalKind.AUTO
    parameters: dict[str, Any] = field(default_factory=lambda: {
        "type": "object",
        "properties": {},
        "required": [],
    })
    handler: Optional[callable] = None  # 工具执行函数
    enabled: bool = True
    tags: list[str] = field(default_factory=list)  # 自定义标签

    @property
    def is_read_only(self) -> bool:
        return Capability.ReadOnly in self.capabilities

    @property
    def is_destructive(self) -> bool:
        """是否有破坏性"""
        return any(c in self.capabilities for c in (
            Capability.WritesFiles, Capability.ExecutesCode
        ))

    @property
    def needs_approval(self) -> bool:
        return self.approval == ApprovalKind.REQUIRED

    def to_openai_dict(self) -> dict:
        """转换为 OpenAI tool format"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "capabilities": [c.name for c in self.capabilities],
            "approval": self.approval.value,
            "enabled": self.enabled,
            "tags": self.tags,
            "has_handler": self.handler is not None,
        }


# ── 内置工具定义 ──────────────────────────────────────

def _default_tools() -> list[ToolDef]:
    """默认注册的工具列表"""
    return [
        ToolDef(
            name="web_search",
            description="搜索互联网，返回标题+链接+摘要。用于查找最新信息、攻略等。",
            capabilities={Capability.ReadOnly, Capability.Network},
            approval=ApprovalKind.AUTO,
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                },
                "required": ["query"],
            },
            tags=["搜索", "网络"],
        ),
        ToolDef(
            name="web_fetch",
            description="抓取一个网页URL的内容，返回提取后的文本。支持批量抓取（最多3个URL同时）。",
            capabilities={Capability.ReadOnly, Capability.Network},
            approval=ApprovalKind.AUTO,
            parameters={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要抓取的URL"},
                    "urls": {"type": "array", "items": {"type": "string"}, "description": "批量抓取多个URL（最多3个）"},
                },
            },
            tags=["网络", "抓取"],
        ),
        ToolDef(
            name="engine_push",
            description="向用户推送一条通知消息，消息会通过心跳机制到达前端。",
            capabilities={Capability.ReadOnly},
            approval=ApprovalKind.AUTO,
            parameters={
                "type": "object",
                "properties": {
                    "msg": {"type": "string", "description": "推送消息内容"},
                },
                "required": ["msg"],
            },
            tags=["通知"],
        ),
        ToolDef(
            name="server_sys_info",
            description="获取服务器系统信息（内存、磁盘、CPU等）。",
            capabilities={Capability.ReadOnly, Capability.ExecutesCode},
            approval=ApprovalKind.SUGGEST,
            parameters={
                "type": "object",
                "properties": {},
            },
            tags=["系统"],
        ),
        ToolDef(
            name="server_file_read",
            description="读取服务器文件内容。",
            capabilities={Capability.ReadOnly, Capability.Sandboxable},
            approval=ApprovalKind.SUGGEST,
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"},
                },
                "required": ["path"],
            },
            tags=["文件"],
        ),
        ToolDef(
            name="server_file_write",
            description="将内容写入服务器文件。除非用户要求保存文件，否则不宜使用此工具。",
            capabilities={Capability.WritesFiles, Capability.Sandboxable, Capability.RequiresApproval},
            approval=ApprovalKind.REQUIRED,
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径，如 tempfile/myfile.md"},
                    "content": {"type": "string", "description": "写入的文件内容"},
                },
                "required": ["path", "content"],
            },
            tags=["文件", "写入"],
        ),
        ToolDef(
            name="server_file_append",
            description="向已存在的文件追加内容（末尾换行追加）。如果文件不存在则自动创建。",
            capabilities={Capability.WritesFiles, Capability.Sandboxable, Capability.RequiresApproval},
            approval=ApprovalKind.SUGGEST,
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径，如 tempfile/note.md"},
                    "content": {"type": "string", "description": "要追加的内容"},
                },
                "required": ["path", "content"],
            },
            tags=["文件", "追加"],
        ),
        ToolDef(
            name="server_exec",
            description="在服务器上执行 shell 命令并返回输出。",
            capabilities={Capability.ExecutesCode, Capability.RequiresApproval},
            approval=ApprovalKind.REQUIRED,
            parameters={
                "type": "object",
                "properties": {
                    "cmd": {"type": "string", "description": "要执行的 shell 命令"},
                    "timeout": {"type": "number", "description": "超时时间(秒)，默认60"},
                },
                "required": ["cmd"],
            },
            tags=["执行", "shell"],
        ),
        ToolDef(
            name="server_python",
            description="执行 Python 脚本代码，返回输出。",
            capabilities={Capability.ExecutesCode, Capability.RequiresApproval},
            approval=ApprovalKind.REQUIRED,
            parameters={
                "type": "object",
                "properties": {
                    "script": {"type": "string", "description": "Python 代码"},
                    "timeout": {"type": "number", "description": "超时时间(秒)，默认30"},
                },
                "required": ["script"],
            },
            tags=["执行", "python"],
        ),
    ]


# ── 工具注册表 ────────────────────────────────────────

class ToolRegistry:
    """统一工具注册表

    管理所有可用工具的定义、能力分类、审批要求。
    支持动态注册/移除，按能力过滤，导出多种格式。
    """

    def __init__(self):
        self._tools: dict[str, ToolDef] = {}
        # 注册默认工具
        for t in _default_tools():
            self._tools[t.name] = t

    # ── 注册/移除 ────────────────────────────────────

    def register(self, tool: ToolDef) -> ToolDef:
        """注册一个工具（覆盖同名）"""
        self._tools[tool.name] = tool
        return tool

    def register_from_dict(self, d: dict) -> ToolDef:
        """从字典创建并注册工具"""
        caps = set()
        for c_name in d.get("capabilities", []):
            try:
                caps.add(Capability[c_name])
            except KeyError:
                pass
        appr_str = d.get("approval", "auto")
        approval = next((a for a in ApprovalKind if a.value == appr_str), ApprovalKind.AUTO)
        tool = ToolDef(
            name=d["name"],
            description=d.get("description", ""),
            capabilities=caps,
            approval=approval,
            parameters=d.get("parameters", {"type": "object", "properties": {}}),
            enabled=d.get("enabled", True),
            tags=d.get("tags", []),
        )
        return self.register(tool)

    def unregister(self, name: str) -> bool:
        """移除一个工具"""
        return self._tools.pop(name, None) is not None

    def rename(self, old_name: str, new_name: str) -> bool:
        """重命名工具"""
        if old_name not in self._tools or new_name in self._tools:
            return False
        tool = self._tools.pop(old_name)
        tool.name = new_name
        self._tools[new_name] = tool
        return True

    # ── 启用/禁用 ───────────────────────────────────

    def enable(self, name: str) -> bool:
        tool = self._tools.get(name)
        if not tool:
            return False
        tool.enabled = True
        return True

    def disable(self, name: str) -> bool:
        tool = self._tools.get(name)
        if not tool:
            return False
        tool.enabled = False
        return True

    # ── 查询 ─────────────────────────────────────────

    def get(self, name: str) -> Optional[ToolDef]:
        return self._tools.get(name)

    def has(self, name: str) -> bool:
        return name in self._tools

    def list_all(self) -> list[ToolDef]:
        return list(self._tools.values())

    def list_enabled(self) -> list[ToolDef]:
        return [t for t in self._tools.values() if t.enabled]

    def list_by_tag(self, tag: str) -> list[ToolDef]:
        return [t for t in self._tools.values() if tag in t.tags and t.enabled]

    # ── 过滤 ─────────────────────────────────────────

    def filter(self, capabilities: Optional[list[Capability]] = None,
               approval: Optional[ApprovalKind] = None,
               tags: Optional[list[str]] = None,
               only_enabled: bool = True) -> list[ToolDef]:
        """按条件过滤工具列表"""
        result = self.list_enabled() if only_enabled else self.list_all()

        if capabilities:
            cap_set = set(capabilities)
            result = [t for t in result if cap_set.intersection(t.capabilities)]

        if approval:
            result = [t for t in result if t.approval == approval]

        if tags:
            tag_set = set(tags)
            result = [t for t in result if tag_set.intersection(t.tags)]
        return result

    def read_only(self) -> list[ToolDef]:
        """获取所有只读工具"""
        return self.filter(capabilities=[Capability.ReadOnly])

    def destructive(self) -> list[ToolDef]:
        """获取所有破坏性工具"""
        return self.filter(capabilities=[
            Capability.WritesFiles, Capability.ExecutesCode,
        ])

    def needs_approval(self) -> list[ToolDef]:
        """获取所有需要审批的工具"""
        return self.filter(approval=ApprovalKind.REQUIRED)

    # ── 导出 ─────────────────────────────────────────

    def to_openai_format(self, role: str = "") -> list[dict]:
        """导出为 OpenAI tool format

        Args:
            role: 角色名，如果不为空则只返回此角色允许的工具

        Returns:
            OpenAI API 可接受的 tools 参数
        """
        tools = self.list_enabled()
        if role:
            from engine_server import AGENT_ROLES
            role_config = AGENT_ROLES.get(role, AGENT_ROLES["general"])
            allowed = set(role_config["tools"])
            tools = [t for t in tools if t.name in allowed]
        return [t.to_openai_dict() for t in tools]

    def to_openai_tools(self, role: str = "") -> list[dict]:
        """别名：导出为 OpenAI tools 格式的列表"""
        return self.to_openai_format(role)

    def summary(self) -> dict:
        return {
            "total": len(self._tools),
            "enabled": len(self.list_enabled()),
            "disabled": len([t for t in self._tools.values() if not t.enabled]),
            "by_capability": {
                c.name: len([t for t in self._tools.values() if c in t.capabilities])
                for c in Capability
            },
            "by_approval": {
                a.value: len([t for t in self._tools.values() if t.approval == a])
                for a in ApprovalKind
            },
            "tools": {name: t.to_dict() for name, t in self._tools.items()},
        }

    def to_dict(self) -> dict:
        return self.summary()

    # ── 持久化 ─────────────────────────────────────

    def save(self, filepath: str) -> None:
        """保存工具注册表到 JSON"""
        data = {
            name: {
                **t.to_dict(),
                "parameters": t.parameters,
            }
            for name, t in self._tools.items()
        }
        Path(filepath).parent.mkdir(parents=True, exist_ok=True)
        Path(filepath).write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf8",
        )

    def load(self, filepath: str) -> int:
        """从 JSON 加载工具注册表"""
        from pathlib import Path
        path = Path(filepath)
        if not path.exists():
            return 0
        data = json.loads(path.read_text(encoding="utf8"))
        count = 0
        for name, d in data.items():
            self.register_from_dict({**d, "name": name})
            count += 1
        return count


# ── 全局单例 ──────────────────────────────────────────

_GLOBAL_REGISTRY: Optional[ToolRegistry] = None


def get_global_registry() -> ToolRegistry:
    """获取全局工具注册表单例"""
    global _GLOBAL_REGISTRY
    if _GLOBAL_REGISTRY is None:
        _GLOBAL_REGISTRY = ToolRegistry()
    return _GLOBAL_REGISTRY


def create_tool_registry() -> ToolRegistry:
    """创建新的工具注册表"""
    return ToolRegistry()
