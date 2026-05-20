#!/usr/bin/env python3
"""
审批策略引擎 (ExecPolicy)

参考 DeepSeek-TUI 的 execpolicy crate 设计，提供规则分层、最长前缀匹配、
决策类型、三个策略域（exec / file / network）和规则持久化。

规则分层:
    BuiltinDefault(0) < Agent(1) < User(2)

决策类型:
    Skip — 无需审批，自动执行
    NeedsApproval(reason) — 需要用户确认
    Forbidden(reason) — 禁止执行

用法:
    policy = ExecPolicy()
    policy.add_rule("exec", "npm install *", ExecDecision.SKIP, priority=2)
    policy.add_rule("exec", "npm uninstall *", ExecDecision.NEEDS_APPROVAL("需要卸载包"), priority=1)
    decision = policy.evaluate("exec", "npm install axios")
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from enum import IntEnum
from pathlib import Path
from typing import Optional


# ── Priority 层级 ─────────────────────────────────────

class Priority(IntEnum):
    """规则优先级层级"""
    BUILTIN_DEFAULT = 0
    AGENT = 1
    USER = 2


# ── 决策类型 ──────────────────────────────────────────

@dataclass(frozen=True)
class ExecDecision:
    """执行决策结果"""
    kind: str  # "skip" | "needs_approval" | "forbidden"
    reason: str = ""
    matched_rule: Optional[str] = None
    matched_priority: int = 0

    @classmethod
    def skip(cls, matched_rule: str = "", priority: int = 0) -> ExecDecision:
        return cls(kind="skip", matched_rule=matched_rule, matched_priority=priority)

    @classmethod
    def needs_approval(cls, reason: str = "", matched_rule: str = "", priority: int = 0) -> ExecDecision:
        return cls(kind="needs_approval", reason=reason, matched_rule=matched_rule, matched_priority=priority)

    @classmethod
    def forbidden(cls, reason: str = "", matched_rule: str = "", priority: int = 0) -> ExecDecision:
        return cls(kind="forbidden", reason=reason, matched_rule=matched_rule, matched_priority=priority)

    def to_dict(self) -> dict:
        return {"kind": self.kind, "reason": self.reason,
                "matched_rule": self.matched_rule, "matched_priority": self.matched_priority}

    def __bool__(self) -> bool:
        return self.kind == "skip"

    @property
    def is_allowed(self) -> bool:
        return self.kind == "skip"

    @property
    def is_approval_needed(self) -> bool:
        return self.kind == "needs_approval"


# ── 规则对象 ──────────────────────────────────────────

@dataclass
class ExecRule:
    """单条策略规则"""
    domain: str          # "exec" | "file" | "network"
    pattern: str         # 匹配模式，支持 * 通配符
    decision: ExecDecision
    priority: Priority = Priority.USER
    description: str = ""
    enabled: bool = True

    def matches(self, target: str) -> bool:
        """最长前缀匹配 + 通配符支持"""
        if not self.enabled:
            return False
        return _pattern_match(self.pattern, target)

    def to_dict(self) -> dict:
        return {
            "domain": self.domain,
            "pattern": self.pattern,
            "decision": self.decision.to_dict(),
            "priority": self.priority.value,
            "description": self.description,
            "enabled": self.enabled,
        }

    @classmethod
    def from_dict(cls, d: dict) -> ExecRule:
        dec = d["decision"]
        decision = ExecDecision(
            kind=dec["kind"],
            reason=dec.get("reason", ""),
            matched_rule=d.get("pattern", ""),
            matched_priority=d.get("priority", 0),
        )
        return cls(
            domain=d["domain"],
            pattern=d["pattern"],
            decision=decision,
            priority=Priority(d.get("priority", Priority.USER.value)),
            description=d.get("description", ""),
            enabled=d.get("enabled", True),
        )


def _pattern_match(pattern: str, target: str) -> bool:
    """简单的通配符匹配，支持 * 匹配任意字符（最长前缀语义）"""
    # 完全匹配
    if pattern == target:
        return True
    # 通配符匹配
    if "*" in pattern:
        parts = pattern.split("*")
        # pattern = "npm install *" → starts with "npm install "
        if len(parts) == 2 and parts[1] == "":
            return target.startswith(parts[0])
        # pattern = "*/dangerfile.py"
        if len(parts) == 2 and parts[0] == "":
            return target.endswith(parts[1])
        # 完全通配
        if pattern == "*":
            return True
        # 一般情况：简单前后通配
        if pattern.startswith("*") and not pattern.endswith("*"):
            return target.endswith(pattern[1:])
        if pattern.endswith("*") and not pattern.startswith("*"):
            return target.startswith(pattern[:-1])
        if pattern.startswith("*") and pattern.endswith("*"):
            return pattern[1:-1] in target
    return False


# ── 默认内置规则 ──────────────────────────────────────

DEFAULT_EXEC_RULES: list[ExecRule] = [
    # Exec 域 — 安全命令 Skip
    ExecRule("exec", "ls *", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "列表目录"),
    ExecRule("exec", "cat *", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "查看文件"),
    ExecRule("exec", "echo *", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "回显"),
    ExecRule("exec", "pwd", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "当前路径"),
    ExecRule("exec", "whoami", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "当前用户"),
    ExecRule("exec", "date", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "日期"),
    ExecRule("exec", "uptime", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "运行时间"),
    ExecRule("exec", "df *", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "磁盘信息"),
    ExecRule("exec", "free *", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "内存信息"),
    ExecRule("exec", "ps *", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "进程列表"),
    ExecRule("exec", "git status", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "Git 状态"),
    ExecRule("exec", "git log *", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "Git 日志"),
    ExecRule("exec", "pip list", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "Python 包列表"),
    ExecRule("exec", "python3 --version", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "Python 版本"),
    ExecRule("exec", "node --version", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "Node 版本"),
    ExecRule("exec", "docker ps *", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "Docker 进程"),
    ExecRule("exec", "docker images", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "Docker 镜像"),

    # Exec 域 — 危险命令 Forbidden
    ExecRule("exec", "rm -rf /*", ExecDecision.forbidden("禁止删除根目录"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "rm -rf /", ExecDecision.forbidden("禁止删除根目录"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "dd *", ExecDecision.forbidden("dd 命令可能破坏磁盘数据"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "mkfs*", ExecDecision.forbidden("格式化操作为危险操作"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "shutdown*", ExecDecision.forbidden("禁止关机"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "reboot*", ExecDecision.forbidden("禁止重启"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "init 0*", ExecDecision.forbidden("禁止关机"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "init 6*", ExecDecision.forbidden("禁止重启"), Priority.BUILTIN_DEFAULT),

    # Exec 域 — 需要审批
    ExecRule("exec", "rm *", ExecDecision.needs_approval("删除操作需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "rmdir *", ExecDecision.needs_approval("删除目录需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "chmod *", ExecDecision.needs_approval("修改权限需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "chown *", ExecDecision.needs_approval("修改所有者需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "sudo *", ExecDecision.needs_approval("需要 sudo 权限的操作需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "curl * | sh", ExecDecision.needs_approval("管道执行远程脚本需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "wget * -O *", ExecDecision.needs_approval("下载并保存文件需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "kill *", ExecDecision.needs_approval("终止进程需要确认"), Priority.BUILTIN_DEFAULT),

    # Exec 域 — 需要审批（安装/修改类）
    ExecRule("exec", "npm install * -g", ExecDecision.needs_approval("全局安装 npm 包需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "pip install *", ExecDecision.needs_approval("安装 Python 包需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "apt*install*", ExecDecision.needs_approval("安装系统包需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("exec", "apt-get install *", ExecDecision.needs_approval("安装系统包需要确认"), Priority.BUILTIN_DEFAULT),

    # File 域
    ExecRule("file", "/etc/passwd", ExecDecision.needs_approval("读取密码文件需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("file", "/etc/shadow", ExecDecision.forbidden("禁止读取 Shadow 文件"), Priority.BUILTIN_DEFAULT),
    ExecRule("file", "/root/*", ExecDecision.needs_approval("访问 root 目录需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("file", "*/ssh/*", ExecDecision.needs_approval("访问 SSH 配置需要确认"), Priority.BUILTIN_DEFAULT),

    # Network 域
    ExecRule("network", "192.168.*", ExecDecision.needs_approval("访问内网地址需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("network", "10.*", ExecDecision.needs_approval("访问内网地址需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("network", "172.16.*", ExecDecision.needs_approval("访问内网地址需要确认"), Priority.BUILTIN_DEFAULT),
    ExecRule("network", "127.0.0.1", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "本地回环"),
    ExecRule("network", "localhost", ExecDecision.skip(), Priority.BUILTIN_DEFAULT, "本地主机"),
]


# ── 策略引擎 ──────────────────────────────────────────

class ExecPolicy:
    """审批策略引擎

    规则分层: BuiltinDefault(0) < Agent(1) < User(2)
    最长前缀匹配: 优先级高者优先，同优先级下更优匹配胜出
    """

    def __init__(self, rules_file: str | Path = ""):
        self._rules_file = Path(rules_file) if rules_file else None
        self._rules: list[ExecRule] = list(DEFAULT_EXEC_RULES)

        if self._rules_file and self._rules_file.exists():
            self.load()

    def add_rule(self, domain: str, pattern: str, decision: ExecDecision,
                 priority: int | Priority = Priority.USER,
                 description: str = "") -> ExecRule:
        """添加一条规则"""
        if not isinstance(priority, Priority):
            priority = Priority(priority)
        rule = ExecRule(domain=domain, pattern=pattern, decision=decision,
                        priority=priority, description=description)
        self._rules.append(rule)
        self._save()
        return rule

    def remove_rule(self, domain: str, pattern: str, priority: int | Priority | None = None) -> bool:
        """移除一条规则"""
        if priority is not None and not isinstance(priority, Priority):
            priority = Priority(priority)
        to_remove = []
        for i, r in enumerate(self._rules):
            if r.domain == domain and r.pattern == pattern:
                if priority is None or r.priority == priority:
                    to_remove.append(i)
        for i in reversed(to_remove):
            self._rules.pop(i)
        if to_remove:
            self._save()
        return len(to_remove) > 0

    def evaluate(self, domain: str, target: str) -> ExecDecision:
        """评估一个操作是否允许执行

        Args:
            domain: "exec" | "file" | "network"
            target: 要评估的目标字符串（命令/文件路径/网络地址）

        Returns:
            ExecDecision: skip / needs_approval / forbidden
        """
        matched: list[ExecRule] = []
        best_pattern_len = -1

        for rule in self._rules:
            if rule.domain != domain:
                continue
            if rule.matches(target):
                pattern_len = len(rule.pattern) + rule.priority.value * 1000  # 层级权重
                if pattern_len > best_pattern_len:
                    matched = [rule]
                    best_pattern_len = pattern_len
                elif pattern_len == best_pattern_len:
                    matched.append(rule)

        # 按优先级降序: 最高优先级优先
        matched.sort(key=lambda r: (r.priority.value, len(r.pattern)), reverse=True)

        if not matched:
            # 没有匹配的规则 → 默认需要审批（安全优先）
            return ExecDecision.needs_approval(f"未匹配到 {domain} 规则，需要审批")

        # 最优先规则的决策
        best = matched[0]
        if best.decision.kind == "skip":
            return ExecDecision.skip(matched_rule=best.pattern, priority=best.priority.value)
        elif best.decision.kind == "forbidden":
            return ExecDecision.forbidden(
                reason=best.decision.reason or f"规则 '{best.pattern}' 禁止此操作",
                matched_rule=best.pattern,
                priority=best.priority.value
            )
        else:
            return ExecDecision.needs_approval(
                reason=best.decision.reason or f"规则 '{best.pattern}' 要求审批",
                matched_rule=best.pattern,
                priority=best.priority.value
            )

    def evaluate_exec(self, command: str) -> ExecDecision:
        """评估 shell 命令"""
        return self.evaluate("exec", command.strip())

    def evaluate_file(self, filepath: str) -> ExecDecision:
        """评估文件操作"""
        return self.evaluate("file", filepath.strip())

    def evaluate_network(self, address: str) -> ExecDecision:
        """评估网络访问"""
        return self.evaluate("network", address.strip())

    @property
    def rules(self) -> list[ExecRule]:
        """获取当前所有规则"""
        return list(self._rules)

    def rules_by_domain(self, domain: str) -> list[ExecRule]:
        """按域获取规则"""
        return [r for r in self._rules if r.domain == domain]

    def list_rules(self, domain: str = "") -> list[dict]:
        """获取规则摘要列表"""
        src = self.rules_by_domain(domain) if domain else self._rules
        return [r.to_dict() for r in src]

    # ── 持久化 ────────────────────────────────────────

    def load(self, filepath: str | Path = "") -> None:
        """从 JSON 文件加载规则"""
        path = Path(filepath) if filepath else self._rules_file
        if not path or not path.exists():
            return
        raw = json.loads(path.read_text(encoding="utf8"))
        self._rules = [ExecRule.from_dict(r) for r in raw]

    def save(self, filepath: str | Path = "") -> None:
        """保存规则到 JSON 文件"""
        path = Path(filepath) if filepath else self._rules_file
        if not path:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps([r.to_dict() for r in self._rules],
                                   ensure_ascii=False, indent=2),
                        encoding="utf8")

    def _save(self) -> None:
        """自动保存（如果有关联文件）"""
        if self._rules_file:
            self.save()

    def reset_to_defaults(self) -> None:
        """重置为默认规则"""
        self._rules = list(DEFAULT_EXEC_RULES)
        self._save()


# ── 工厂函数 ──────────────────────────────────────────

def create_exec_policy(rules_file: str = "") -> ExecPolicy:
    """创建策略引擎实例，自动加载持久化规则"""
    return ExecPolicy(rules_file=rules_file)
