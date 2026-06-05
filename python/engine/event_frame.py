#!/usr/bin/env python3
"""
事件帧系统 (EventFrame)

参考 DeepSeek-TUI 的 EventFrame 设计，提供结构化的事件流系统。

事件类型流:
  ResponseStart → ResponseDelta → ToolCallStart → ExecApprovalRequest →
  ExecCommandBegin → ExecCommandOutputDelta → ExecCommandEnd →
  ToolCallResult → ResponseEnd

支持：
- 事件流 JSON Lines 格式
- SSE 推送
- 事件响应式记录
- 可重放的事件日志
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Optional


# ── 事件类型 ──────────────────────────────────────────

class EventType(str, Enum):
    """所有事件类型的枚举"""
    # 阶段性事件
    PHASE_BEGIN = "phase_begin"
    PHASE_END = "phase_end"

    # LLM 响应事件
    RESPONSE_START = "response_start"
    RESPONSE_DELTA = "response_delta"
    RESPONSE_END = "response_end"

    # Tool call 事件
    TOOL_CALL_START = "tool_call_start"
    TOOL_CALL_RESULT = "tool_call_result"
    TOOL_CALL_END = "tool_call_end"

    # 工具执行/审批事件
    EXEC_APPROVAL_REQUEST = "exec_approval_request"
    EXEC_APPROVAL_RESULT = "exec_approval_result"
    EXEC_COMMAND_BEGIN = "exec_command_begin"
    EXEC_COMMAND_OUTPUT_DELTA = "exec_command_output_delta"
    EXEC_COMMAND_END = "exec_command_end"

    # 推测执行事件
    SPECULATION_START = "speculation_start"
    SPECULATION_CONFIRM = "speculation_confirm"
    SPECULATION_ABORT = "speculation_abort"

    # 错误事件
    ERROR = "error"

    # 元事件
    METADATA = "metadata"
    HEARTBEAT = "heartbeat"

    def __str__(self) -> str:
        return self.value


# ── 事件帧 ────────────────────────────────────────────

@dataclass
class EventFrame:
    """事件帧：系统中最小的可追踪事件单元

    每个 EventFrame 有唯一 ID、时间戳、类型和负载数据。
    支持父子关系（通过 parent_id）来构建事件树。
    """
    event_type: EventType
    data: dict = field(default_factory=dict)
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    parent_id: Optional[str] = None
    session_id: str = ""
    timestamp: float = field(default_factory=time.time)
    sequence: int = 0  # 全局序号

    def to_dict(self) -> dict:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type.value,
            "parent_id": self.parent_id,
            "session_id": self.session_id,
            "timestamp": self.timestamp,
            "timestamp_iso": datetime.fromtimestamp(self.timestamp).isoformat(),
            "sequence": self.sequence,
            "data": self.data,
        }

    def to_json(self) -> str:
        """序列化为 JSON"""
        return json.dumps(self.to_dict(), ensure_ascii=False)

    def to_json_line(self) -> str:
        """JSON Lines 格式"""
        return self.to_json() + "\n"

    def to_sse(self) -> str:
        """SSE 格式"""
        return f"event: {self.event_type.value}\ndata: {json.dumps(self.data, ensure_ascii=False)}\n\n"

    @classmethod
    def from_dict(cls, d: dict) -> EventFrame:
        return cls(
            event_type=EventType(d["event_type"]),
            data=d.get("data", {}),
            event_id=d.get("event_id", str(uuid.uuid4())),
            parent_id=d.get("parent_id"),
            session_id=d.get("session_id", ""),
            timestamp=d.get("timestamp", time.time()),
            sequence=d.get("sequence", 0),
        )


from datetime import datetime


# ── 事件流构建器 ─────────────────────────────────────

class EventFlowBuilder:
    """构建完整的事件流

    提供便捷方法创建标准事件序列，自动管理 ID 和时序。
    """

    def __init__(self, session_id: str = ""):
        self._session_id = session_id or str(uuid.uuid4())
        self._seq = 0
        self._parent_stack: list[str] = []
        self._last_event: Optional[EventFrame] = None
        self._events: list[EventFrame] = []
        self._metadata: dict = {
            "session_id": self._session_id,
            "created_at": datetime.now().isoformat(),
        }

    # ── 属性 ─────────────────────────────────────────

    @property
    def session_id(self) -> str:
        return self._session_id

    @property
    def events(self) -> list[EventFrame]:
        return list(self._events)

    @property
    def last_event(self) -> Optional[EventFrame]:
        return self._last_event

    def set_metadata(self, key: str, value: Any) -> None:
        self._metadata[key] = value

    # ── 核心创建 ─────────────────────────────────────

    def emit(self, event_type: EventType, data: dict = None,
             parent_id: str = None) -> EventFrame:
        """创建一个事件帧"""
        self._seq += 1
        parent = parent_id or (self._parent_stack[-1] if self._parent_stack else None)
        frame = EventFrame(
            event_type=event_type,
            data=data or {},
            session_id=self._session_id,
            sequence=self._seq,
            parent_id=parent,
        )
        self._events.append(frame)
        self._last_event = frame
        return frame

    def push_scope(self, event_type: EventType, data: dict = None) -> EventFrame:
        """创建一个范围开始事件（自动成为后续事件的父级）"""
        frame = self.emit(event_type, data)
        self._parent_stack.append(frame.event_id)
        return frame

    def pop_scope(self, end_event_type: EventType, data: dict = None) -> EventFrame:
        """关闭当前范围"""
        if self._parent_stack:
            self._parent_stack.pop()
        return self.emit(end_event_type, data)

    # ── 标准事件序列 ────────────────────────────────

    def response_start(self, model: str = "", msg_id: str = "") -> EventFrame:
        """LLM 响应开始"""
        return self.emit(EventType.RESPONSE_START, {
            "model": model,
            "msg_id": msg_id,
        })

    def response_delta(self, content: str, reasoning: str = "",
                       seq: int = 0) -> EventFrame:
        """LLM 响应增量"""
        data = {"delta": content, "seq": seq}
        if reasoning:
            data["reasoning"] = reasoning
        return self.emit(EventType.RESPONSE_DELTA, data)

    def response_end(self, full_text: str = "", reasoning_text: str = "",
                     usage: dict = None) -> EventFrame:
        """LLM 响应结束"""
        return self.emit(EventType.RESPONSE_END, {
            "full_text": full_text,
            "reasoning_text": reasoning_text,
            "usage": usage or {},
        })

    def tool_call_start(self, tool_name: str, arguments: dict,
                        tool_call_id: str = "") -> EventFrame:
        """工具调用开始"""
        return self.emit(EventType.TOOL_CALL_START, {
            "tool_name": tool_name,
            "arguments": arguments,
            "tool_call_id": tool_call_id or str(uuid.uuid4())[:8],
        })

    def tool_call_result(self, tool_name: str, result: Any,
                         success: bool = True, duration_ms: float = 0) -> EventFrame:
        """工具调用结果"""
        return self.emit(EventType.TOOL_CALL_RESULT, {
            "tool_name": tool_name,
            "result": str(result)[:2000],
            "success": success,
            "duration_ms": round(duration_ms, 1),
        })

    def tool_call_end(self, tool_name: str = "") -> EventFrame:
        """工具调用结束"""
        return self.emit(EventType.TOOL_CALL_END, {"tool_name": tool_name})

    def exec_approval_request(self, command: str, reason: str = "",
                              tool_name: str = "") -> EventFrame:
        """执行审批请求"""
        return self.emit(EventType.EXEC_APPROVAL_REQUEST, {
            "command": command,
            "reason": reason,
            "tool_name": tool_name,
            "approval_id": str(uuid.uuid4())[:8],
        })

    def exec_approval_result(self, approved: bool, approval_id: str = "",
                             reason: str = "") -> EventFrame:
        """执行审批结果"""
        return self.emit(EventType.EXEC_APPROVAL_RESULT, {
            "approved": approved,
            "approval_id": approval_id,
            "reason": reason,
        })

    def exec_command_begin(self, command: str, tool_name: str = "",
                           cwd: str = "") -> EventFrame:
        """命令开始执行"""
        return self.emit(EventType.EXEC_COMMAND_BEGIN, {
            "command": command,
            "tool_name": tool_name,
            "cwd": cwd,
        })

    def exec_command_output_delta(self, output: str, stream: str = "stdout") -> EventFrame:
        """命令执行输出增量"""
        return self.emit(EventType.EXEC_COMMAND_OUTPUT_DELTA, {
            "output": output,
            "stream": stream,
        })

    def exec_command_end(self, exit_code: int = 0, duration_ms: float = 0,
                         error: str = "") -> EventFrame:
        """命令执行结束"""
        return self.emit(EventType.EXEC_COMMAND_END, {
            "exit_code": exit_code,
            "duration_ms": round(duration_ms, 1),
            "error": error,
        })

    def speculation_start(self, prompt: str = "",
                          predicted_tools: list = None) -> EventFrame:
        """推测执行开始"""
        return self.emit(EventType.SPECULATION_START, {
            "prompt": prompt[:200],
            "predicted_tools": predicted_tools or [],
        })

    def speculation_confirm(self, savings_ms: float = 0) -> EventFrame:
        """推测命中"""
        return self.emit(EventType.SPECULATION_CONFIRM, {
            "savings_ms": round(savings_ms, 1),
        })

    def speculation_abort(self, reason: str = "") -> EventFrame:
        """推测中止"""
        return self.emit(EventType.SPECULATION_ABORT, {"reason": reason})

    def error(self, error_msg: str, error_type: str = "",
              details: dict = None) -> EventFrame:
        """错误事件"""
        return self.emit(EventType.ERROR, {
            "error": error_msg[:1000],
            "error_type": error_type,
            "details": details or {},
        })

    # ── 便捷范围包装 ────────────────────────────────

    def response_scope(self, model: str = "", msg_id: str = "") -> _ScopeGuard:
        """LLM 响应范围上下文管理器"""
        return _ScopeGuard(self, EventType.RESPONSE_START,
                           EventType.RESPONSE_END,
                           {"model": model, "msg_id": msg_id})

    def tool_call_scope(self, tool_name: str, arguments: dict) -> _ScopeGuard:
        """工具调用范围上下文管理器"""
        return _ScopeGuard(
            self, EventType.TOOL_CALL_START, EventType.TOOL_CALL_END,
            {"tool_name": tool_name, "arguments": arguments},
            {"tool_name": tool_name},
        )

    def exec_command_scope(self, command: str, tool_name: str = "") -> _ScopeGuard:
        """命令执行范围上下文管理器"""
        return _ScopeGuard(
            self, EventType.EXEC_COMMAND_BEGIN, EventType.EXEC_COMMAND_END,
            {"command": command, "tool_name": tool_name},
            {},
        )

    # ── 导出 ─────────────────────────────────────────

    def to_json_lines(self) -> str:
        """导出为 JSON Lines 格式"""
        return "".join(e.to_json_line() for e in self._events)

    def to_events_list(self) -> list[dict]:
        """导出为事件列表"""
        return [e.to_dict() for e in self._events]

    def to_sse_stream(self) -> list[str]:
        """导出为 SSE 事件流"""
        return [e.to_sse() for e in self._events]

    def summary(self) -> dict:
        """事件流摘要"""
        type_counts: dict[str, int] = {}
        for e in self._events:
            key = e.event_type.value
            type_counts[key] = type_counts.get(key, 0) + 1
        return {
            "session_id": self._session_id,
            "total_events": len(self._events),
            "duration_since_first": (
                (self._events[-1].timestamp - self._events[0].timestamp)
                if len(self._events) >= 2 else 0
            ),
            "event_types": type_counts,
        }


# ── 范围守卫 ──────────────────────────────────────────

class _ScopeGuard:
    """上下文管理器，用于推/弹范围"""

    def __init__(self, builder: EventFlowBuilder,
                 enter_type: EventType, exit_type: EventType,
                 enter_data: dict = None, exit_data: dict = None):
        self._builder = builder
        self._enter_type = enter_type
        self._exit_type = exit_type
        self._enter_data = enter_data or {}
        self._exit_data = exit_data or {}
        self._frame: Optional[EventFrame] = None

    def __enter__(self) -> EventFrame:
        self._frame = self._builder.push_scope(self._enter_type, self._enter_data)
        return self._frame

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_val:
            self._exit_data["error"] = str(exc_val)
        self._builder.pop_scope(self._exit_type, self._exit_data)


# ── 事件日志 ──────────────────────────────────────────

class EventLog:
    """事件日志：记录、查询、回放事件帧

    支持持久化到文件，按条件查询，统计。
    """

    def __init__(self, filepath: str = ""):
        self._filepath = filepath
        self._events: list[EventFrame] = []
        if filepath:
            self.load(filepath)

    def record(self, frame: EventFrame) -> None:
        """记录一个事件帧"""
        self._events.append(frame)

    def record_from_builder(self, builder: EventFlowBuilder) -> int:
        """记录构建器的所有事件"""
        count = 0
        for e in builder.events:
            self.record(e)
            count += 1
        return count

    def query(self, event_type: Optional[EventType] = None,
              session_id: str = "",
              since: float = 0,
              limit: int = 100) -> list[EventFrame]:
        """按条件查询事件"""
        result = self._events
        if event_type:
            result = [e for e in result if e.event_type == event_type]
        if session_id:
            result = [e for e in result if e.session_id == session_id]
        if since:
            result = [e for e in result if e.timestamp >= since]
        return result[-limit:]

    def last(self, event_type: Optional[EventType] = None) -> Optional[EventFrame]:
        """获取最后一个事件（可选过滤类型）"""
        if event_type:
            matches = [e for e in self._events if e.event_type == event_type]
            return matches[-1] if matches else None
        return self._events[-1] if self._events else None

    def count(self, event_type: Optional[EventType] = None,
              session_id: str = "") -> int:
        result = self._events
        if event_type:
            result = [e for e in result if e.event_type == event_type]
        if session_id:
            result = [e for e in result if e.session_id == session_id]
        return len(result)

    def clear(self) -> None:
        """清空所有事件"""
        self._events.clear()

    # ── 持久化 ─────────────────────────────────────

    def save(self, filepath: str = "") -> None:
        """保存事件日志到 JSON Lines"""
        path = filepath or self._filepath
        if not path:
            return
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf8") as f:
            for e in self._events:
                f.write(e.to_json_line())

    def load(self, filepath: str = "") -> int:
        """从 JSON Lines 加载事件日志"""
        path = filepath or self._filepath
        if not path or not Path(path).exists():
            return 0
        count = 0
        with open(path, "r", encoding="utf8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    frame = EventFrame.from_dict(json.loads(line))
                    self._events.append(frame)
                    count += 1
                except (json.JSONDecodeError, KeyError):
                    pass
        return count

    @property
    def size(self) -> int:
        return len(self._events)


try:
    from pathlib import Path
except ImportError:
    from pathlib import Path


# ── 工厂函数 ──────────────────────────────────────────

def create_event_flow(session_id: str = "") -> EventFlowBuilder:
    """创建事件流构建器"""
    return EventFlowBuilder(session_id)


def create_event_log(filepath: str = "") -> EventLog:
    """创建事件日志"""
    return EventLog(filepath)
