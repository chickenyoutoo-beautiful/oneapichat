#!/usr/bin/env python3
"""
OneAPIChat 引擎层 (engine)
- exec_policy: 审批策略引擎
- speculation: 推测执行
- retry: 重试机制
- tool_registry: 统一工具注册表
- event_frame: 事件帧系统
"""

from engine.exec_policy import ExecPolicy, ExecDecision, Priority, create_exec_policy
from engine.speculation import SpeculationEngine, create_speculation_engine, SpeculationState, SpeculationStats
from engine.retry import RetryEngine, RetryStatus, with_retry, create_retry_engine
from engine.tool_registry import ToolRegistry, ToolDef, Capability, ApprovalKind, get_global_registry, create_tool_registry
from engine.event_frame import EventFlowBuilder, EventType, EventFrame, EventLog, create_event_flow, create_event_log
from engine.browser import BrowserManager, get_browser_manager, ensure_browser_connected

__all__ = [
    "ExecPolicy", "ExecDecision", "Priority", "create_exec_policy",
    "SpeculationEngine", "create_speculation_engine", "SpeculationState", "SpeculationStats",
    "RetryEngine", "RetryStatus", "with_retry", "create_retry_engine",
    "ToolRegistry", "ToolDef", "Capability", "ApprovalKind", "get_global_registry", "create_tool_registry",
    "EventFlowBuilder", "EventType", "EventFrame", "EventLog", "create_event_flow", "create_event_log",
    "BrowserManager", "get_browser_manager", "ensure_browser_connected",
]
