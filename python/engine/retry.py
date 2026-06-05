#!/usr/bin/env python3
"""
重试机制 (Retry)

参考 DeepSeek-TUI 的 JobRetryMetadata 设计：
- 指数退避：backoff_base_ms=500
- 最大尝试次数：max_attempts=3
- 状态机：Queued → Running → Paused → Completed/Failed/Cancelled

用法:
    retrier = RetryEngine(max_attempts=3, backoff_base_ms=500)
    result = await retrier.execute("task-1", my_async_func, arg1="xxx")
"""

from __future__ import annotations

import asyncio
import json
import math
import random
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, Optional


# ── 任务状态 ──────────────────────────────────────────

class RetryStatus(Enum):
    """重试任务状态"""
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# ── 重试状态机 ────────────────────────────────────────

_RETRY_TRANSITIONS: dict[RetryStatus, set[RetryStatus]] = {
    RetryStatus.QUEUED: {RetryStatus.RUNNING, RetryStatus.PAUSED, RetryStatus.CANCELLED},
    RetryStatus.RUNNING: {RetryStatus.COMPLETED, RetryStatus.FAILED, RetryStatus.PAUSED, RetryStatus.CANCELLED},
    RetryStatus.PAUSED: {RetryStatus.RUNNING, RetryStatus.CANCELLED},
    RetryStatus.COMPLETED: set(),
    RetryStatus.FAILED: {RetryStatus.RUNNING},  # 允许从失败重试
    RetryStatus.CANCELLED: set(),
}


# ── 重试元数据 ────────────────────────────────────────

@dataclass
class RetryAttempt:
    """单次重试记录"""
    attempt: int
    started_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None
    duration_ms: float = 0.0
    error: Optional[str] = None
    success: bool = False
    backoff_ms: float = 0.0

    def finish(self, error: Optional[str] = None) -> None:
        self.completed_at = time.time()
        self.duration_ms = (self.completed_at - self.started_at) * 1000
        self.success = error is None
        self.error = error


@dataclass
class RetryMetadata:
    """完整重试任务元数据"""
    task_id: str
    status: RetryStatus = RetryStatus.QUEUED
    max_attempts: int = 3
    backoff_base_ms: float = 500.0
    backoff_max_ms: float = 30000.0
    jitter: bool = True
    attempts: list[RetryAttempt] = field(default_factory=list)
    result: Any = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    timeout: Optional[float] = None  # 单次执行超时（秒）

    @property
    def current_attempt(self) -> int:
        return len(self.attempts)

    @property
    def is_terminal(self) -> bool:
        return self.status in (RetryStatus.COMPLETED, RetryStatus.FAILED, RetryStatus.CANCELLED)

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "status": self.status.value,
            "max_attempts": self.max_attempts,
            "backoff_base_ms": self.backoff_base_ms,
            "current_attempt": self.current_attempt,
            "attempts": [
                {
                    "attempt": a.attempt,
                    "duration_ms": round(a.duration_ms, 1),
                    "success": a.success,
                    "error": a.error,
                    "backoff_ms": round(a.backoff_ms, 1),
                }
                for a in self.attempts
            ],
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


# ── 退避计算 ──────────────────────────────────────────

def calculate_backoff(
    attempt: int,
    base_ms: float = 500.0,
    max_ms: float = 30000.0,
    jitter: bool = True,
) -> float:
    """指数退避时间计算

    Args:
        attempt: 当前尝试次数（从 0 开始）
        base_ms: 基础退避时间（毫秒）
        max_ms: 最大退避时间（毫秒）
        jitter: 是否添加随机抖动

    Returns:
        退避时间（毫秒）
    """
    delay = base_ms * (2 ** attempt)
    delay = min(delay, max_ms)
    if jitter:
        delay = delay * (0.5 + random.random() * 0.5)  # 50%~100% 随机
    return delay


# ── 重试引擎 ──────────────────────────────────────────

class RetryEngine:
    """重试执行引擎

    异步执行函数，失败自动重试（指数退避）。
    支持暂停、取消、状态查询。
    """

    def __init__(
        self,
        max_attempts: int = 3,
        backoff_base_ms: float = 500.0,
        backoff_max_ms: float = 30000.0,
        jitter: bool = True,
    ):
        self._default_max_attempts = max_attempts
        self._default_backoff_base_ms = backoff_base_ms
        self._default_backoff_max_ms = backoff_max_ms
        self._default_jitter = jitter
        self._tasks: dict[str, RetryMetadata] = {}
        self._active_futures: dict[str, asyncio.Future] = {}
        self._pause_events: dict[str, asyncio.Event] = {}

    # ── 属性 ──────────────────────────────────────────

    @property
    def max_attempts(self) -> int:
        return self._default_max_attempts

    @max_attempts.setter
    def max_attempts(self, value: int) -> None:
        self._default_max_attempts = value

    # ── 核心执行 ─────────────────────────────────────

    async def execute(
        self,
        task_id: str,
        func: Callable[..., Awaitable[Any]],
        *args,
        max_attempts: Optional[int] = None,
        backoff_base_ms: Optional[float] = None,
        backoff_max_ms: Optional[float] = None,
        jitter: Optional[bool] = None,
        timeout: Optional[float] = None,
        **kwargs,
    ) -> tuple[bool, Any, Optional[str]]:
        """执行可重试的异步函数

        Args:
            task_id: 任务标识符
            func: 要执行的异步函数
            max_attempts: 最大尝试次数（覆盖默认值）
            backoff_base_ms: 退避基数（覆盖默认值）
            timeout: 单次执行超时（秒）

        Returns:
            (success, result_or_None, error_or_None)
        """
        meta = RetryMetadata(
            task_id=task_id,
            max_attempts=max_attempts or self._default_max_attempts,
            backoff_base_ms=backoff_base_ms or self._default_backoff_base_ms,
            backoff_max_ms=backoff_max_ms or self._default_backoff_max_ms,
            jitter=jitter if jitter is not None else self._default_jitter,
            timeout=timeout,
        )
        self._tasks[task_id] = meta
        self._active_futures[task_id] = asyncio.get_event_loop().create_future()

        try:
            return await self._execute_with_retry(meta, func, *args, **kwargs)
        finally:
            self._tasks.pop(task_id, None)
            self._active_futures.pop(task_id, None)
            self._pause_events.pop(task_id, None)

    async def _execute_with_retry(
        self,
        meta: RetryMetadata,
        func: Callable[..., Awaitable[Any]],
        *args,
        **kwargs,
    ) -> tuple[bool, Any, Optional[str]]:
        meta.status = RetryStatus.RUNNING

        for attempt_num in range(meta.max_attempts):
            # 跳过检查
            if meta.status == RetryStatus.CANCELLED:
                return False, None, "任务已被取消"

            # 暂停检查
            if meta.status == RetryStatus.PAUSED:
                pause_event = self._pause_events.get(meta.task_id)
                if pause_event:
                    await pause_event.wait()
                meta.status = RetryStatus.RUNNING

            attempt = RetryAttempt(attempt=attempt_num + 1)
            meta.attempts.append(attempt)
            meta.updated_at = time.time()

            # 退避（非首次尝试）
            if attempt_num > 0:
                backoff = calculate_backoff(
                    attempt_num - 1,
                    base_ms=meta.backoff_base_ms,
                    max_ms=meta.backoff_max_ms,
                    jitter=meta.jitter,
                )
                attempt.backoff_ms = backoff
                # 退避期间检查取消
                try:
                    await asyncio.wait_for(
                        self._sleep_with_cancel(backoff / 1000.0, meta.task_id),
                        timeout=backoff / 1000.0 + 1,
                    )
                except asyncio.CancelledError:
                    return False, None, "任务被取消"

            # 执行
            try:
                if meta.timeout:
                    result = await asyncio.wait_for(
                        func(*args, **kwargs),
                        timeout=meta.timeout,
                    )
                else:
                    result = await func(*args, **kwargs)

                attempt.finish()
                meta.result = result
                meta.status = RetryStatus.COMPLETED
                meta.updated_at = time.time()
                return True, result, None

            except asyncio.CancelledError:
                attempt.finish(error="任务被取消")
                meta.status = RetryStatus.CANCELLED
                meta.updated_at = time.time()
                return False, None, "任务被取消"

            except Exception as e:
                error_msg = f"{type(e).__name__}: {str(e)}"
                attempt.finish(error=error_msg)
                meta.error = error_msg

                # 看是否还有重试机会
                is_last = (attempt_num + 1 >= meta.max_attempts)
                if is_last:
                    meta.status = RetryStatus.FAILED
                    meta.updated_at = time.time()
                    return False, None, error_msg

                # 否则继续重试
                continue

        # 默认失败
        meta.status = RetryStatus.FAILED
        meta.updated_at = time.time()
        return False, None, meta.error or "未知失败"

    async def _sleep_with_cancel(self, seconds: float, task_id: str) -> None:
        """睡眠并检查取消"""
        try:
            await asyncio.sleep(seconds)
        except asyncio.CancelledError:
            meta = self._tasks.get(task_id)
            if meta:
                meta.status = RetryStatus.CANCELLED
            raise

    # ── 同步执行（线程安全包装）────────────────────────

    def execute_sync(
        self,
        task_id: str,
        func: Callable[..., Any],
        *args,
        max_attempts: Optional[int] = None,
        **kwargs,
    ) -> tuple[bool, Any, Optional[str]]:
        """同步执行重试（内部跑事件循环）"""
        async def _run():
            return await self.execute(
                task_id, func, *args,
                max_attempts=max_attempts, **kwargs,
            )

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        if loop.is_running():
            # 已在事件循环中，使用 run_coroutine_threadsafe
            future = asyncio.run_coroutine_threadsafe(_run(), loop)
            return future.result(timeout=300)
        else:
            return loop.run_until_complete(_run())

    # ── 任务控制 ─────────────────────────────────────

    def pause(self, task_id: str) -> bool:
        """暂停任务"""
        meta = self._tasks.get(task_id)
        if not meta:
            return False
        if RetryStatus.PAUSED not in _RETRY_TRANSITIONS.get(meta.status, set()):
            return False
        meta.status = RetryStatus.PAUSED
        meta.updated_at = time.time()
        if task_id not in self._pause_events:
            self._pause_events[task_id] = asyncio.Event()
        self._pause_events[task_id].clear()
        return True

    def resume(self, task_id: str) -> bool:
        """恢复已暂停的任务"""
        meta = self._tasks.get(task_id)
        if not meta or meta.status != RetryStatus.PAUSED:
            return False
        meta.status = RetryStatus.RUNNING
        meta.updated_at = time.time()
        event = self._pause_events.get(task_id)
        if event:
            event.set()
        return True

    def cancel(self, task_id: str) -> bool:
        """取消任务"""
        meta = self._tasks.get(task_id)
        if not meta or meta.is_terminal:
            return False
        meta.status = RetryStatus.CANCELLED
        meta.error = "用户手动取消"
        meta.updated_at = time.time()
        # 尝试取消活跃的 Future
        fut = self._active_futures.get(task_id)
        if fut and not fut.done():
            fut.cancel()
        return True

    # ── 查询 ──────────────────────────────────────────

    def get_status(self, task_id: str) -> Optional[RetryMetadata]:
        return self._tasks.get(task_id)

    def list_tasks(self, status: Optional[RetryStatus] = None) -> list[RetryMetadata]:
        if status:
            return [t for t in self._tasks.values() if t.status == status]
        return list(self._tasks.values())

    def list_active(self) -> list[RetryMetadata]:
        return [t for t in self._tasks.values()
                if t.status in (RetryStatus.QUEUED, RetryStatus.RUNNING, RetryStatus.PAUSED)]

    def summary(self) -> dict:
        return {
            "total": len(self._tasks),
            "active": len(self.list_active()),
            "by_status": {
                s.value: len([t for t in self._tasks.values() if t.status == s])
                for s in RetryStatus
            },
        }

    def to_dict(self) -> dict:
        return {
            "config": {
                "default_max_attempts": self._default_max_attempts,
                "default_backoff_base_ms": self._default_backoff_base_ms,
                "default_backoff_max_ms": self._default_backoff_max_ms,
                "default_jitter": self._default_jitter,
            },
            "state": self.summary(),
            "tasks": {tid: meta.to_dict() for tid, meta in self._tasks.items()},
        }


# ── 包装器装饰器 ─────────────────────────────────────

def with_retry(
    max_attempts: int = 3,
    backoff_base_ms: float = 500.0,
    backoff_max_ms: float = 30000.0,
    jitter: bool = True,
    timeout: Optional[float] = None,
):
    """重试装饰器（用于异步函数）"""
    engine = RetryEngine(
        max_attempts=max_attempts,
        backoff_base_ms=backoff_base_ms,
        backoff_max_ms=backoff_max_ms,
        jitter=jitter,
    )

    def decorator(func):
        async def wrapper(*args, **kwargs):
            task_id = f"{func.__name__}_{int(time.time() * 1000000)}"
            success, result, error = await engine.execute(
                task_id, func, *args, timeout=timeout, **kwargs,
            )
            if success:
                return result
            raise RuntimeError(f"重试失败({max_attempts}次): {error}")
        return wrapper
    return decorator


# ── 工厂函数 ──────────────────────────────────────────

def create_retry_engine(
    max_attempts: int = 3,
    backoff_base_ms: float = 500.0,
) -> RetryEngine:
    """创建重试引擎"""
    return RetryEngine(
        max_attempts=max_attempts,
        backoff_base_ms=backoff_base_ms,
    )
