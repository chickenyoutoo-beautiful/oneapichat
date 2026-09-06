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
        "tools": ["web_search", "web_fetch", "platform_extract", "engine_push", "browser_get_content", "browser_get_snapshot",
                   "bilibili_search", "bilibili_video_info", "server_file_search", "server_file_grep", "get_current_time"],
        "model_tier": "cheap",
        "max_rounds": 5
    },
    "planner": {
        "label": "📐 规划师",
        "desc": "制定方案、分析策略。不做执行,只出方案",
        "tools": ["web_search", "engine_push", "browser_get_content", "browser_get_snapshot",
                   "get_current_time"],
        "model_tier": "smart",
        "max_rounds": 8
    },
    "developer": {
        "label": "⚡ 开发者",
        "desc": "读写文件、执行命令、搜索、浏览器操控。全能执行角色",
        "tools": ["web_search", "web_fetch", "platform_extract", "engine_push", "server_exec", "server_python",
                   "server_file_read", "server_file_write", "server_file_append", "video_edit",
                   "server_file_search", "server_file_grep", "server_file_edit", "server_file_op",
                   "browser_navigate", "browser_screenshot", "browser_click", "browser_type",
                   "browser_get_content", "browser_get_snapshot",
                   "get_current_time", "generate_image", "generate_ppt",
                   "cr_list_files", "cr_search_files", "cr_upload_file"],
        "model_tier": "smart",
        "max_rounds": 5
    },
    "verifier": {
        "label": "✅ 验证者",
        "desc": "检查结果、找问题。只读,不可修改",
        "tools": ["web_search", "web_fetch", "platform_extract", "server_file_read", "engine_push",
                   "browser_get_content", "browser_get_snapshot",
                   "server_file_search", "server_file_grep", "get_current_time"],
        "model_tier": "smart",
        "max_rounds": 15
    },
    "general": {
        "label": "🌐 全能代理",
        "desc": "所有工具可用(默认角色)",
        "tools": ["web_search", "web_fetch", "platform_extract", "engine_push", "server_exec", "server_python",
                   "server_file_read", "server_file_write", "server_file_append", "server_sys_info",
                   "server_file_search", "server_file_grep", "server_file_edit", "server_file_op",
                   "video_edit", "browser_navigate", "browser_screenshot", "browser_click",
                   "browser_type", "browser_get_content", "browser_get_snapshot",
                   "get_current_time", "bilibili_search", "bilibili_video_info",
                   "generate_image", "generate_ppt",
                   "cr_list_files", "cr_search_files", "cr_upload_file", "cr_create_folder"],
        "model_tier": "smart",
        "max_rounds": 30
    }
}

# ── 工具定义(子代理用) ──
ALL_TOOLS_DEF = [
    {
        "type": "function",
        "function": {
            "name": "run_skill",
            "description": "运行一个已保存的可复用技能。技能是预设的提示词模板+工具集。当用户任务与已保存技能匹配时调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_name": {"type": "string", "description": "要运行的技能名称"},
                    "params": {"type": "object", "description": "技能参数, 用于填充提示词模板的 {param} 占位符"}
                },
                "required": ["skill_name"]
            }
        }
    },
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
            "name": "platform_extract",
            "description": "从特定平台提取结构化内容。支持 Bilibili 视频/专栏信息(标题、UP主、播放量等)。当用户分享B站等平台链接并想了解内容时调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要提取的平台URL(如B站视频链接)"}
                },
                "required": ["url"]
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
            "description": "在服务器上执行终端命令。参数名必须是 cmd(不要用 command)。",
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
            "description": "执行 Python 脚本。参数名必须是 script(不要用 code)。",
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
    # ★ P0扩展: 文件操作工具
    {
        "type": "function",
        "function": {
            "name": "server_file_search",
            "description": "在服务器文件系统中搜索文件（find命令）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "搜索目录路径"},
                    "pattern": {"type": "string", "description": "文件名匹配模式，如 *.mp4"},
                    "max_depth": {"type": "number", "description": "最大搜索深度，默认5"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "server_file_grep",
            "description": "在服务器文件中搜索文本内容（grep）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "搜索路径"},
                    "pattern": {"type": "string", "description": "正则搜索模式"}
                },
                "required": ["path", "pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "server_file_edit",
            "description": "编辑服务器文件内容。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"},
                    "old_string": {"type": "string", "description": "要替换的文本"},
                    "new_string": {"type": "string", "description": "替换后的文本"}
                },
                "required": ["path", "old_string", "new_string"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "server_file_op",
            "description": "服务器文件操作：复制/移动/删除/创建目录。",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["cp", "mv", "rm", "mkdir"], "description": "操作类型"},
                    "src": {"type": "string", "description": "源路径"},
                    "dst": {"type": "string", "description": "目标路径"}
                },
                "required": ["action", "src"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "获取当前日期时间。搜索时效性内容前应调用。",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "bilibili_search",
            "description": "在B站搜索视频/番剧/用户。",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词"},
                    "type": {"type": "string", "enum": ["video", "bangumi", "user"], "description": "搜索类型"}
                },
                "required": ["keyword"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "bilibili_video_info",
            "description": "获取B站视频详细信息。",
            "parameters": {
                "type": "object",
                "properties": {
                    "bvid": {"type": "string", "description": "BV号"},
                    "aid": {"type": "string", "description": "AV号"}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_image",
            "description": "使用AI生成图片。",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "图片描述"},
                    "size": {"type": "string", "enum": ["1024x1024", "1792x1024", "1024x1792"]}
                },
                "required": ["prompt"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_ppt",
            "description": "生成PPT演示文稿。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "PPT标题"},
                    "pages": {"type": "number", "description": "页数"},
                    "content": {"type": "string", "description": "内容大纲"}
                },
                "required": ["title", "pages"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cr_list_files",
            "description": "列出Cloudreve云盘目录文件。",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "目录路径"}},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cr_search_files",
            "description": "在Cloudreve中搜索文件。",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "关键词"},
                    "path": {"type": "string", "description": "搜索路径"}
                },
                "required": ["keyword"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cr_upload_file",
            "description": "上传文件到Cloudreve。自动分片。",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "源文件路径"},
                    "cloudreve_path": {"type": "string", "description": "目标目录"}
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cr_create_folder",
            "description": "在Cloudreve创建文件夹。",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "文件夹路径"}},
                "required": ["path"]
            }
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
