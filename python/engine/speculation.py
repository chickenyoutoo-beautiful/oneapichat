#!/usr/bin/env python3
"""
推测执行 (Speculation)

参考 Claude Code 的 SpeculationState 设计：
- 在 YOLO 模式下，对新指令自动预判需要的工具调用
- 可中途中止（abort）
- 追踪推测边界（CompletionBoundary）
- 节约时间统计

用法:
    spec = SpeculationEngine()
    spec.enable(yolo_mode=True)
    prediction = spec.predict("修改 nginx 配置文件并重启")
    # prediction.suggested_tools = ["server_file_read", "server_exec"]
    # prediction.estimated_savings = ...秒
"""

from __future__ import annotations

import json
import time
import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ── 推测边界 ──────────────────────────────────────────

@dataclass
class CompletionBoundary:
    """推测执行完成边界标记"""
    start_step: int = 0
    end_step: int = 0
    confirmed: bool = False
    aborted: bool = False
    reason: str = ""


# ── 推测工具调用 ──────────────────────────────────────

@dataclass
class SpeculatedToolCall:
    """推测出的工具调用"""
    tool_name: str
    expected_args: dict = field(default_factory=dict)
    confidence: float = 0.0  # 0.0 ~ 1.0
    estimated_duration_ms: int = 0  # 预估执行时长


# ── 推测结果 ──────────────────────────────────────────

@dataclass
class SpeculatedResult:
    """一次推测的结果"""
    prompt: str
    suggested_tools: list[SpeculatedToolCall] = field(default_factory=list)
    abort_reason: str = ""
    completed: bool = False
    estimated_savings_ms: int = 0
    actual_savings_ms: int = 0
    started_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None


# ── 推测状态 ──────────────────────────────────────────

class SpeculationState(Enum):
    IDLE = "idle"
    SPECULATING = "speculating"
    CONFIRMED = "confirmed"
    ABORTED = "aborted"
    COMPLETED = "completed"


# ── 历史统计 ──────────────────────────────────────────

@dataclass
class SpeculationStats:
    """推测执行统计"""
    total_speculations: int = 0
    successful_speculations: int = 0
    aborted_speculations: int = 0
    total_savings_ms: int = 0
    total_wasted_ms: int = 0
    average_confidence: float = 0.0

    def add_success(self, savings_ms: int, confidence: float) -> None:
        self.total_speculations += 1
        self.successful_speculations += 1
        self.total_savings_ms += savings_ms
        self._update_avg_confidence(confidence)

    def add_abort(self, wasted_ms: int, confidence: float) -> None:
        self.total_speculations += 1
        self.aborted_speculations += 1
        self.total_wasted_ms += wasted_ms
        self._update_avg_confidence(confidence)

    def _update_avg_confidence(self, confidence: float) -> None:
        n = self.total_speculations
        self.average_confidence = (
            (self.average_confidence * (n - 1) + confidence) / n
        )

    def to_dict(self) -> dict:
        return {
            "total_speculations": self.total_speculations,
            "successful": self.successful_speculations,
            "aborted": self.aborted_speculations,
            "total_savings_ms": self.total_savings_ms,
            "total_wasted_ms": self.total_wasted_ms,
            "average_confidence": round(self.average_confidence, 3),
            "net_gain_ms": self.total_savings_ms - self.total_wasted_ms,
        }


# ── 工具预测模式 ──────────────────────────────────────

# 常见命令模式 → 推测的工具调用
_TOOL_PREDICTIONS: dict[str, list[tuple[str, float, int]]] = {
    # 文件操作
    "read": [("server_file_read", 0.95, 200),
             ("server_file_read", 0.05, 500)],
    "查看": [("server_file_read", 0.90, 200),
             ("web_fetch", 0.10, 800)],
    "写": [("server_file_write", 0.85, 500),
           ("server_file_append", 0.15, 300)],
    "保存": [("server_file_write", 0.90, 400)],
    "修改": [("server_file_read", 0.50, 200),
             ("server_file_write", 0.50, 500)],
    "创建": [("server_file_write", 0.80, 500),
             ("server_exec", 0.20, 2000)],

    # 搜索
    "搜索": [("web_search", 0.95, 1500),
             ("web_fetch", 0.05, 2000)],
    "查": [("web_search", 0.80, 1500),
           ("server_file_read", 0.20, 200)],
    "找": [("web_search", 0.70, 1500),
           ("server_file_read", 0.30, 300)],
    "搜索一下": [("web_search", 0.98, 1500)],

    # 抓取
    "抓取": [("web_fetch", 0.90, 2000),
             ("web_search", 0.10, 1500)],
    "爬": [("web_fetch", 0.85, 2000),
           ("web_search", 0.15, 1500)],

    # 执行命令
    "运行": [("server_exec", 0.90, 3000),
             ("server_python", 0.10, 2000)],
    "执行": [("server_exec", 0.85, 3000),
             ("server_python", 0.15, 2000)],
    "安装": [("server_exec", 0.90, 10000)],
    "部署": [("server_exec", 0.80, 15000),
             ("server_file_write", 0.20, 2000)],
    "编译": [("server_exec", 0.95, 20000)],

    # Python
    "python": [("server_python", 0.95, 3000)],

    # 系统信息
    "查看系统": [("server_sys_info", 0.95, 500)],
    "系统信息": [("server_sys_info", 0.90, 500)],
    "进程": [("server_exec", 0.80, 1000),
             ("server_python", 0.20, 2000)],
    "磁盘": [("server_exec", 0.90, 500)],
    "内存": [("server_exec", 0.90, 500)],

    # 网络
    "ping": [("server_exec", 0.95, 5000)],
    "网络": [("server_exec", 0.80, 5000),
             ("web_fetch", 0.20, 2000)],

    # Git
    "git": [("server_exec", 0.95, 2000)],

    # Docker
    "docker": [("server_exec", 0.95, 3000)],

    # 推消息
    "通知": [("engine_push", 0.90, 200)],
    "推送": [("engine_push", 0.85, 200)],
}


# ── 推测引擎 ──────────────────────────────────────────

class SpeculationEngine:
    """推测执行引擎

    在 YOLO 模式下对新指令自动预判需要的工具调用，
    可提前启动工具调用以节约时间。
    """

    def __init__(self):
        self._yolo_mode: bool = False
        self._state: SpeculationState = SpeculationState.IDLE
        self._current_result: Optional[SpeculatedResult] = None
        self._stats: SpeculationStats = SpeculationStats()
        self._boundaries: list[CompletionBoundary] = []
        self._enabled: bool = True

    # ── 配置 ──────────────────────────────────────────

    def enable(self, yolo_mode: bool = False) -> None:
        """启用推测执行"""
        self._enabled = True
        self._yolo_mode = yolo_mode

    def disable(self) -> None:
        """禁用推测执行"""
        self._enabled = False
        self._state = SpeculationState.IDLE

    @property
    def yolo_mode(self) -> bool:
        return self._yolo_mode

    @yolo_mode.setter
    def yolo_mode(self, value: bool) -> None:
        self._yolo_mode = value

    @property
    def enabled(self) -> bool:
        return self._enabled

    @enabled.setter
    def enabled(self, value: bool) -> None:
        self._enabled = value

    @property
    def state(self) -> SpeculationState:
        return self._state

    @property
    def stats(self) -> SpeculationStats:
        return self._stats

    # ── 核心预测 ──────────────────────────────────────

    def predict(self, prompt: str) -> SpeculatedResult:
        """根据指令预测需要的工具调用"""
        if not self._enabled:
            result = SpeculatedResult(prompt=prompt)
            result.completed = True
            result.completed_at = time.time()
            return result

        suggested_tools = self._predict_tools(prompt)
        estimated_savings = sum(t.estimated_duration_ms for t in suggested_tools)

        self._state = SpeculationState.SPECULATING
        self._current_result = SpeculatedResult(
            prompt=prompt,
            suggested_tools=suggested_tools,
            estimated_savings_ms=estimated_savings,
        )
        return self._current_result

    def _predict_tools(self, prompt: str) -> list[SpeculatedToolCall]:
        """根据输入文本预测工具调用"""
        suggested: list[SpeculatedToolCall] = []
        prompt_lower = prompt.lower()

        # 基于关键词匹配预测
        for keyword, predictions in _TOOL_PREDICTIONS.items():
            if keyword.lower() in prompt_lower:
                for tool_name, confidence, duration in predictions:
                    suggested.append(SpeculatedToolCall(
                        tool_name=tool_name,
                        confidence=confidence,
                        estimated_duration_ms=duration,
                    ))

        # YOLO 模式下，对不确定的命令也做推测
        if self._yolo_mode and not suggested:
            # 检查是否包含常见的命令性词语
            action_words = ["install", "update", "remove", "delete", "add",
                           "exec", "run", "start", "stop", "restart",
                           "configure", "build", "setup", "init"]
            if any(w in prompt_lower for w in action_words):
                suggested.append(SpeculatedToolCall(
                    tool_name="server_exec",
                    confidence=0.6,
                    estimated_duration_ms=5000,
                ))

        # 排序：置信度高优先
        result = sorted(suggested, key=lambda t: -t.confidence)
        return result[:5]  # 最多推测 5 个工具

    # ── 生命周期管理 ─────────────────────────────────

    def confirm(self) -> None:
        """确认推测（推测命中，开始跟进执行）"""
        if self._state != SpeculationState.SPECULATING:
            return
        self._state = SpeculationState.CONFIRMED
        if self._current_result:
            self._current_result.completed = True
            self._current_result.completed_at = time.time()
            actual = self._current_result.estimated_savings_ms
            self._current_result.actual_savings_ms = actual
            avg_conf = (
                sum(t.confidence for t in self._current_result.suggested_tools)
                / max(len(self._current_result.suggested_tools), 1)
            )
            self._stats.add_success(actual, avg_conf)

            # 记录边界
            self._boundaries.append(CompletionBoundary(
                start_step=len(self._boundaries),
                end_step=len(self._boundaries),
                confirmed=True,
            ))

        self._state = SpeculationState.COMPLETED
        self._current_result = None

    def abort(self, reason: str = "手动中止") -> None:
        """中止当前推测"""
        if self._state != SpeculationState.SPECULATING:
            return
        old_state = self._state
        self._state = SpeculationState.ABORTED
        if self._current_result:
            self._current_result.completed = True
            self._current_result.completed_at = time.time()
            self._current_result.abort_reason = reason
            wasted = self._current_result.estimated_savings_ms
            avg_conf = (
                sum(t.confidence for t in self._current_result.suggested_tools)
                / max(len(self._current_result.suggested_tools), 1)
            )
            self._stats.add_abort(wasted, avg_conf)

            self._boundaries.append(CompletionBoundary(
                start_step=len(self._boundaries),
                end_step=len(self._boundaries),
                aborted=True,
                reason=reason,
            ))

        self._current_result = None

    def reset(self) -> None:
        """重置推测状态"""
        self._state = SpeculationState.IDLE
        self._current_result = None

    # ── 查询 ──────────────────────────────────────────

    @property
    def current_prediction(self) -> Optional[SpeculatedResult]:
        """当前活跃的推测结果"""
        return self._current_result

    @property
    def boundaries(self) -> list[CompletionBoundary]:
        """获取推测边界历史"""
        return list(self._boundaries)

    def has_speculation(self) -> bool:
        """当前是否在推测中"""
        return self._state == SpeculationState.SPECULATING

    def is_aborted(self) -> bool:
        """当前推测是否已被中止"""
        return self._state == SpeculationState.ABORTED

    def summary(self) -> dict:
        """推测引擎摘要"""
        return {
            "enabled": self._enabled,
            "yolo_mode": self._yolo_mode,
            "state": self._state.value,
            "has_active_speculation": self._current_result is not None,
            "stats": self._stats.to_dict(),
            "boundary_count": len(self._boundaries),
        }

    def to_dict(self) -> dict:
        return self.summary()


# ── 工厂函数 ──────────────────────────────────────────

def create_speculation_engine(yolo_mode: bool = False) -> SpeculationEngine:
    """创建推测执行引擎"""
    engine = SpeculationEngine()
    engine.enable(yolo_mode=yolo_mode)
    return engine
