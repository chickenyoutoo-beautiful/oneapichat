"""
OneAPIChat Engine - Agent 角色系统 + 工具过滤 + 清理
提取自 engine_server.py
"""
from datetime import datetime, timedelta


# ── Agent 角色定义 ──
AGENT_ROLES = {
    "explorer": {
        "label": "🔍 搜索专员",
        "desc": "只读搜索,适合查资料、抓网页。不可修改文件或执行命令",
        "tools": ["web_search", "web_fetch", "engine_push", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "cheap",
        "max_rounds": 10
    },
    "planner": {
        "label": "📐 规划师",
        "desc": "制定方案、分析策略。不做执行,只出方案",
        "tools": ["web_search", "engine_push", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "smart",
        "max_rounds": 8
    },
    "developer": {
        "label": "⚡ 开发者",
        "desc": "读写文件、执行命令、搜索、浏览器操控。全能执行角色",
        "tools": ["web_search", "web_fetch", "engine_push", "server_exec", "server_python",
                   "server_file_read", "server_file_write", "server_file_append", "video_edit",
                   "browser_navigate", "browser_screenshot", "browser_click", "browser_type",
                   "browser_get_content", "browser_get_snapshot"],
        "model_tier": "smart",
        "max_rounds": 30
    },
    "verifier": {
        "label": "✅ 验证者",
        "desc": "检查结果、找问题。只读,不可修改",
        "tools": ["web_search", "web_fetch", "server_file_read", "engine_push",
                   "browser_get_content", "browser_get_snapshot"],
        "model_tier": "smart",
        "max_rounds": 15
    },
    "general": {
        "label": "🌐 全能代理",
        "desc": "所有工具可用(默认角色)",
        "tools": ["web_search", "web_fetch", "engine_push", "server_exec", "server_python",
                   "server_file_read", "server_file_write", "server_file_append", "server_sys_info",
                   "video_edit", "browser_navigate", "browser_screenshot", "browser_click",
                   "browser_type", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "smart",
        "max_rounds": 30
    }
}

# ── 工具定义(子代理用) ──
ALL_TOOLS_DEF = [
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": "抓取一个网页URL的内容,返回提取后的文本。支持批量抓取(最多3个URL同时)。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要抓取的URL"},
                    "urls": {"type": "array", "items": {"type": "string"}, "description": "批量抓取多个URL(最多3个)"}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "engine_push",
            "description": "向用户推送一条通知消息,消息会通过心跳机制到达前端。",
            "parameters": {
                "type": "object",
                "properties": {"msg": {"type": "string", "description": "推送消息内容"}},
                "required": ["msg"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "联网搜索最新信息。",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "搜索查询"}},
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "server_exec",
            "description": "在服务器上执行终端命令。",
            "parameters": {
                "type": "object",
                "properties": {
                    "cmd": {"type": "string", "description": "命令"},
                    "timeout": {"type": "number", "description": "超时秒数"}
                },
                "required": ["cmd"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "server_python",
            "description": "执行 Python 脚本。",
            "parameters": {
                "type": "object",
                "properties": {
                    "script": {"type": "string", "description": "Python 代码"},
                    "timeout": {"type": "number", "description": "超时秒数"}
                },
                "required": ["script"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "server_file_read",
            "description": "读取服务器文件内容。",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "文件路径"}},
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "server_file_write",
            "description": "写入文件到服务器。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "目标路径"},
                    "content": {"type": "string", "description": "内容"}
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "server_file_append",
            "description": "追加内容到文件。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"},
                    "content": {"type": "string", "description": "追加内容"}
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "server_sys_info",
            "description": "获取服务器系统信息。",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "video_edit",
            "description": "视频编辑操作。",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "description": "操作类型"},
                    "params": {"type": "object", "description": "参数"}
                },
                "required": ["action"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_navigate",
            "description": "浏览器打开URL。",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string", "description": "URL"}},
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_screenshot",
            "description": "浏览器截图。",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_click",
            "description": "浏览器点击元素。",
            "parameters": {
                "type": "object",
                "properties": {"selector": {"type": "string", "description": "CSS选择器"}},
                "required": ["selector"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_type",
            "description": "浏览器输入文字。",
            "parameters": {
                "type": "object",
                "properties": {
                    "selector": {"type": "string", "description": "CSS选择器"},
                    "text": {"type": "string", "description": "输入文字"}
                },
                "required": ["selector", "text"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_get_content",
            "description": "获取浏览器页面内容。",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_get_snapshot",
            "description": "获取浏览器页面快照。",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
]


def filter_tools_by_role(role: str) -> list:
    """根据角色过滤工具列表,实现最小权限"""
    role_config = AGENT_ROLES.get(role, AGENT_ROLES["general"])
    allowed = set(role_config["tools"])
    return [t for t in ALL_TOOLS_DEF if t["function"]["name"] in allowed]


def cleanup_old_agents(agents: dict) -> int:
    """清理过时/失败/已完成的子代理,返回清理数量"""
    now = datetime.now()
    cutoff = now - timedelta(hours=12)
    to_delete = []
    for name, agent in list(agents.items()):
        created_str = agent.get("created", "")
        if not created_str:
            continue
        try:
            created = datetime.fromisoformat(created_str)
        except Exception:
            continue
        status = agent.get("status", "")
        age = now - created
        if status in ("completed", "failed") and age > timedelta(hours=12):
            to_delete.append(name)
        elif status == "idle" and age > timedelta(hours=1):
            to_delete.append(name)
    for name in to_delete:
        del agents[name]
    return len(to_delete)
