# OneAPIChat REST API v1

> **Base URL**: `https://naujtrats.xyz/oneapichat/api/v1`
>
> OpenAI 兼容的 REST API。69 个 MCP 工具、流式/非流式对话、函数调用。
> 支持 ChatBox、NextChat、LobeChat、deepseek-chat 等第三方客户端直接接入。

---

## 认证

所有 `/api/v1/*` 端点需携带 API Key：

```
Authorization: Bearer <your-api-key>
```

### 获取 API Key

1. 登录 [OneAPIChat](https://naujtrats.xyz/oneapichat/)
2. 设置面板 → 「API 密钥」→ 「创建新密钥」
3. **立即复制保存**（关闭弹窗后无法再次查看）

> 格式：`oac-<48hex>`，共 52 字符。泄露后可撤销。

---

## 端点概览

| 端点 | 方法 | 认证 | 说明 |
|------|------|:--:|------|
| `/chat/completions` | POST | ✅ | 对话补全（流式/非流式/函数调用） |
| `/models` | GET | ✅ | 可用模型列表 |
| `/tools` | GET | ✅ | 全部 69 个工具定义（OpenAI function calling 格式） |
| `/tools/call` | POST | ✅ | 执行任意工具（透明代理到 MCP Server） |
| `/conversations` | GET/POST/DELETE | ✅ | 对话历史同步 |
| `/upload` | POST/GET | ⚠️ | 文件上传/图片列表（Auth-Token 认证，非 API Key） |
| `/skills` | GET | ✅ | 全部 12 个技能定义（run_skill enum 约束） |

### MCP 协议端点（无需 API Key）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp/api/tools` | POST | 全部 69 个工具列表（MCP inputSchema 格式） |
| `/mcp/api/tools/call` | POST | 通用工具执行 |
| `/mcp/bilibili/tools` | POST | B站 7 工具列表 |
| `/mcp/bilibili/tools/call` | POST | B站工具执行 |
| `/mcp/health` | GET | MCP 服务健康检查 |

---

## 1. Chat Completions

```
POST /chat/completions
```

### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `model` | string | ✅ | 模型 ID，通过 `/models` 查询 |
| `messages` | array | ✅ | `[{role, content}]`, role: system/user/assistant/tool |
| `stream` | boolean | | `true` SSE流式 / `false` JSON（默认） |
| `temperature` | number | | 0–2，默认用户设置值 |
| `max_tokens` | integer | | 最大输出 token 数 |
| `top_p` | number | | 核采样 0–1 |
| `stop` | string/array | | 停止词 |
| `tools` | array | | 函数定义（OpenAI function calling 格式） |
| `tool_choice` | string | | `auto` / `none` / `required` |

> **自动注入工具**：请求不含 `tools` 时，服务器自动注入全部 69 个可用工具。显式传 `tools: []` 则不注入。

### 非流式示例

```bash
curl https://naujtrats.xyz/oneapichat/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "system", "content": "你是一个有用的助手。"},
      {"role": "user", "content": "你好！"}
    ],
    "temperature": 0.7,
    "max_tokens": 2048
  }'
```

### 非流式响应

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1721234567,
  "model": "deepseek-chat",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "你好！我是 DeepSeek..."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 50,
    "total_tokens": 75
  }
}
```

### 流式示例（SSE）

```bash
curl -N https://naujtrats.xyz/oneapichat/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"讲个笑话"}],"stream":true}'
```

### 流式响应

```
data: {"id":"...","choices":[{"index":0,"delta":{"role":"assistant","content":"为"},"finish_reason":null}]}
data: {"id":"...","choices":[{"index":0,"delta":{"content":"什么"},"finish_reason":null}]}
...
data: {"id":"...","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

### 函数调用（Tool Calling）

```bash
# Step 1: 发送带工具的请求
curl https://naujtrats.xyz/oneapichat/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role":"user","content":"搜索今天的AI新闻并抓取第一篇"}],
    "tool_choice": "auto"
  }'
# → finish_reason: "tool_calls" → message.tool_calls

# Step 2: 执行工具
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"web_search","arguments":{"query":"AI news today","max_results":1}}'

# Step 3: 将结果追加到 messages 继续对话
curl https://naujtrats.xyz/oneapichat/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role":"user","content":"搜索今天的AI新闻并抓取第一篇"},
      {"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"web_search","arguments":"{\"query\":\"AI news today\"}"}}]},
      {"role":"tool","tool_call_id":"call_1","content":"{\"results\":[{\"title\":\"...\",\"url\":\"...\",\"content\":\"...\"}]}"}
    ]
  }'
```

---

## 2. Models List

```
GET /models
```

```bash
curl https://naujtrats.xyz/oneapichat/api/v1/models \
  -H "Authorization: Bearer oac-xxxxxxxx..."
```

```json
{
  "object": "list",
  "data": [
    {"id":"deepseek-chat","object":"model","created":1721234567,"owned_by":"user"},
    {"id":"deepseek-reasoner","object":"model","created":1721234567,"owned_by":"deepseek"}
  ]
}
```

---

## 3. Tools List

```
GET /tools
```

动态从 MCP Server 加载全部 69 个工具，始终保持同步。

```bash
curl https://naujtrats.xyz/oneapichat/api/v1/tools \
  -H "Authorization: Bearer oac-xxxxxxxx..."
```

```json
{
  "object": "list",
  "count": 69,
  "data": [
    {
      "type": "function",
      "function": {
        "name": "web_search",
        "description": "搜索互联网获取实时信息。",
        "parameters": { "type": "object", "properties": {...}, "required": [...] }
      }
    },
    ...
  ]
}
```

### 工具分类索引

| 分类 | 数量 | 前缀/工具名 |
|------|:--:|------|
| 🔍 搜索与获取 | 3 | `web_search`, `web_fetch`, `platform_extract` |
| 🎨 图像 | 3 | `generate_image`, `generate_image_i2i`, `analyze_image` |
| 📺 B站 | 7 | `bilibili_search`, `bilibili_video_info`, `bilibili_article_read`, `bilibili_user_profile`, `bilibili_comment_list`, `bilibili_dynamic_list`, `bilibili_qr_login` |
| 📊 办公文档 | 4 | `generate_ppt`, `generate_docx`, `generate_xlsx`, `generate_pdf` |
| 🎬 视频 | 2 | `video_understanding`, `video_edit` |
| 📚 超星学习通 | 12 | `chaoxing_login`, `chaoxing_list_courses`, `chaoxing_auto`, `chaoxing_status`, `chaoxing_stop`, `chaoxing_stats`, `chaoxing_overview`, `chaoxing_auth`, `chaoxing_qr_login`, `chaoxing_exam_list`, `chaoxing_exam_start`, `chaoxing_exam_status`, `chaoxing_exam_stop` |
| ☁️ Cloudreve | 14 | `cr_list_files`, `cr_search_files`, `cr_create_folder`, `cr_rename`, `cr_move`, `cr_copy`, `cr_delete`, `cr_list_shares`, `cr_create_share`, `cr_delete_share`, `cr_storage_info`, `cr_overview`, `cr_login`, `cr_user_info` |
| 💻 服务器 | 15 | `server_sys_info`, `server_file_read`, `server_file_write`, `server_file_search`, `server_file_grep`, `server_file_edit`, `server_file_op`, `server_exec`, `server_python`, `server_ps`, `server_disk`, `server_network`, `server_docker`, `server_db_query`, `server_file_append` |
| 🌐 浏览器 | 6 | `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_get_content`, `browser_get_snapshot` |
| 🎵 MiniMax | 8 | `mmx_chat`, `mmx_image`, `mmx_speech`, `mmx_music`, `mmx_voices`, `mmx_vision`, `mmx_quota`, `mmx_video` |
| 🤖 Agent/编排 | 5 | `delegate_task`, `delegate_workflow`, `plan_update`, `ask_agent`, `autonomous_mode` |
| 🎮 星穹铁道 | 8 | `src_status`, `src_dashboard`, `src_start`, `src_stop`, `src_get_tasks`, `src_toggle_task`, `src_get_config`, `src_set_config` |
| 🪟 Windows | 7 | `win_info`, `win_processes`, `win_kill`, `win_start`, `win_restart`, `win_file`, `win_screenshot` |

---

## 4. Tool Execution

直接执行任意工具，无需通过 Chat Completions 循环。所有 69 个工具均支持。

```
POST /tools/call
```

### 请求格式

| 参数 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `name` | string | ✅ | 工具名称（见上方分类表） |
| `arguments` | object | ✅ | 工具参数（参考 `/tools` 返回的 schema） |

### 示例

```bash
# 联网搜索
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"web_search","arguments":{"query":"今天天气","max_results":3}}'

# B站搜索
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"bilibili_search","arguments":{"keyword":"Python教程","limit":5}}'

# 超星扫码登录
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"chaoxing_qr_login","arguments":{"action":"qr"}}'

# 生成 Word 文档
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"generate_docx","arguments":{"title":"报告","content":"[{\"type\":\"h1\",\"text\":\"标题\"},{\"type\":\"p\",\"text\":\"正文内容\"}]"}}'

# Cloudreve 搜索文件
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"cr_search_files","arguments":{"keyword":"photo","path":"/"}}'

# MiniMax 图片生成
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"generate_image","arguments":{"prompt":"sunset over mountains"}}'

# 读取文件
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"server_file_read","arguments":{"path":"/var/www/html/oneapichat/README.md","max_lines":20}}'
```

### 响应

成功时：
```json
{
  "result": {
    "results": [...],
    "status": "ok",
    "provider": "tavily"
  }
}
```

错误时：
```json
{
  "error": "MCP service unreachable — tool: some_tool"
}
```

---

## 5. MCP 协议接口

MCP Server（Node.js, port 18788）统一管理全部工具。可通过 Nginx 细腰直接访问（无需 API Key）。

```
POST /mcp/api/tools/call
```

```bash
# 执行任意工具
curl https://naujtrats.xyz/mcp/api/tools/call \
  -X POST -H "Content-Type: application/json" \
  -d '{"name":"web_search","arguments":{"query":"weather"}}'

# 列出全部工具
curl https://naujtrats.xyz/mcp/api/tools \
  -X POST -H "Content-Type: application/json"

# 健康检查
curl https://naujtrats.xyz/mcp/health
```

---

## 6. Skills API

```
GET /skills
```

返回全部 12 个技能，每个技能以 `run_skill` 工具定义呈现（`skill_name` enum 约束），第三方客户端可直接注入到 tools 数组。

```bash
curl https://naujtrats.xyz/oneapichat/api/v1/skills \
  -H "Authorization: Bearer oac-xxxxxxxx..."
```

```json
{
  "object": "list",
  "count": 13,
  "data": [
    {
      "type": "function",
      "function": {
        "name": "run_skill",
        "description": "运行技能「deep-search」: 深度多源搜索...",
        "parameters": {
          "properties": {
            "skill_name": { "type": "string", "enum": ["deep-search"] },
            "query": { "type": "string", "description": "原始用户问题" }
          }
        }
      }
    }
  ]
}
```

> 数据末尾附通用 `run_skill` 定义（`enum` 包含全部技能名），模型可一次调用匹配任意技能。

---

## 7. 技能系统（内部）

12 个 AI 技能（ClawHub 兼容格式），自动根据用户问题匹配。

### 技能列表

| 技能 | 触发场景 | 核心工具 |
|------|---------|----------|
| `deep-search` | 深度/多源搜索 | web_search, bilibili_search, web_fetch |
| `multi-agent-orchestration` | 复杂并行任务 | plan_update, delegate_task, engine_agent_* |
| `chaoxing-automation` | 超星刷课考试 | chaoxing_auto, chaoxing_status 等14个 |
| `content-creation` | 图片/PPT/视频创作 | generate_image, generate_ppt, video_edit |
| `server-management` | 服务器运维 | server_exec, server_docker 等15个 |
| `cloud-file-manager` | 云盘文件管理 | cr_list_files, cr_search_files 等14个 |
| `bilibili-content-discovery` | B站内容推荐 | bilibili_search, bilibili_video_info |
| `game-redemption-codes` | 游戏兑换码 | bilibili_search(优先), web_search |
| `windows-automation` | Windows远程控制 | win_* 7个工具 |
| `browser-automation` | 浏览器自动操作 | browser_* 6个工具 |
| `web-research` | 网络调研 | web_search, web_fetch |

```bash
# 技能匹配
curl "https://naujtrats.xyz/oneapichat/api/skills_api.php?action=match&query=原神兑换码"
# → {"matched":[{"name":"game-redemption-codes","score":10,...}]}
```

---

## 8. 文件上传

```
POST /api/upload.php
```

多模态对话时上传图片。认证方式不同于 API v1 — 使用 **Auth-Token**（从 Cookie `auth_token` 或 Header `Auth-Token` 获取）。

### 请求

```
POST /oneapichat/api/upload.php
Content-Type: multipart/form-data

image=@file.jpg
```

也可通过 URL query 传 auth：
```
POST /oneapichat/api/upload.php?auth_token=<token>
```

### 响应

```json
{
  "url": "/oneapichat/uploads/2026-07/file.jpg",
  "size": 12345
}
```

> 文件保存在 `uploads/` 目录，返回相对路径。完整 URL 需拼接 Base URL。

### 图片列表

```
GET /oneapichat/api/upload.php?auth_token=<token>
```

```json
[
  {"name": "file.jpg", "url": "/oneapichat/uploads/2026-07/file.jpg", "size": 12345}
]
```

---

## 9. SSE 错误格式

Provider 返回错误时，**不会**以标准 HTTP 错误码响应，而是作为 SSE 数据事件返回：

```
data: {"error":{"message":"Provider error","type":"server_error","code":"UPSTREAM_ERROR"}}

data: [DONE]
```

**客户端必须**解析 SSE body 中的 `error` 字段，而非仅依赖 HTTP 状态码。

常见错误码：

| code | 说明 |
|------|------|
| `PROVIDER_NOT_CONFIGURED` | 账户未配置 API Provider |
| `UPSTREAM_ERROR` | 上游 API 错误（透传） |
| `STREAM_ERROR` | 流式传输中断 |
| `INVALID_API_KEY` | API Key 无效 |
| `MISSING_MODEL` / `MISSING_MESSAGES` | 缺少必填参数 |

### 错误响应格式

所有 API v1 错误遵循统一格式：

```json
{
  "error": {
    "message": "人类可读描述",
    "type": "server_error | authentication_error | invalid_request_error",
    "code": "ERROR_CODE"
  }
}
```

---

## 10. Provider 路由

不同模型通过 `/models` 返回的 `owned_by` 字段区分 Provider：

| owned_by | Provider | 说明 |
|----------|----------|------|
| `user` | 账户默认 Provider | DeepSeek / OpenAI 兼容 |
| `deepseek` | DeepSeek | 独立路由 |
| `nvidia` | NVIDIA NIM | integrate.api.nvidia.com |
| `minimax` | MiniMax | Token Plan API |
| `grok` | Grok | X.AI |

模型 ID 与 Provider 的映射在 OneAPIChat 设置面板中配置。API 调用时无需指定 Provider — 服务端根据模型名自动路由。

---

## 11. 视觉模型

支持图片输入的模型列表通过 `/models` 返回的 `capabilities` 字段标识：

```json
{
  "id": "deepseek-chat",
  "capabilities": ["chat"]
}
{
  "id": "gpt-4o",
  "capabilities": ["chat", "vision"]
}
```

| capability | 说明 |
|------------|------|
| `chat` | 纯文本对话 |
| `vision` | 支持 `image_url` 多模态输入 |

带 `vision` capability 的模型，在 messages 中可通过以下方式传图片：

```json
{"role": "user", "content": [
  {"type": "text", "text": "描述这张图片"},
  {"type": "image_url", "image_url": {"url": "https://..."}}
]}
```

非视觉模型需先将图片上传（`/api/upload.php`），再用 `web_fetch` 或 `analyze_image` 工具分析。

---

## 12. Tool Schema 规范

自动注入工具时，以下条件的工具会被**过滤掉**（不发给模型）：

1. `parameters.type` !== `"object"` — 必须是对象
2. `parameters.properties` 为空或非数组 — 至少有一个属性
3. `parameters` 整体为空数组 `[]` 或 `null`

**正确示例**：
```json
{
  "type": "function",
  "function": {
    "name": "my_tool",
    "parameters": {
      "type": "object",
      "properties": {"query": {"type": "string"}},
      "required": ["query"]
    }
  }
}
```

> `required` 为空数组时会被自动移除（部分 Provider 会拒绝）。

---

## 错误码
|:----:|------|------|
| 400 | `invalid_request_error` | 缺少必填参数、JSON 格式错误 |
| 401 | `authentication_error` | API Key 无效或未提供 |
| 402 | `server_error` | 账户未配置 Provider |
| 429 | `rate_limit_error` | 请求频率过高 |
| 500 | `server_error` | 上游 Provider 返回错误 |
| 502 | `server_error` | MCP/引擎/网络连接错误 |

---

## 代码示例

### Python — 完整 Agent 循环

```python
import requests, json

API_BASE = "https://naujtrats.xyz/oneapichat/api/v1"
API_KEY = "oac-xxxxxxxx..."
H = {"Authorization": f"Bearer {API_KEY}"}

def chat(messages, model="deepseek-chat", tools=None, stream=False):
    """非流式/流式对话"""
    body = {"model": model, "messages": messages}
    if tools is not None: body["tools"] = tools
    if stream:
        r = requests.post(f"{API_BASE}/chat/completions", headers=H,
            json={**body, "stream": True}, stream=True)
        for line in r.iter_lines():
            if line.startswith(b"data: ") and line != b"data: [DONE]":
                d = json.loads(line[6:]).get("choices",[{}])[0].get("delta",{})
                if d.get("content"): print(d["content"], end="", flush=True)
        return
    r = requests.post(f"{API_BASE}/chat/completions", headers=H, json=body)
    return r.json()["choices"][0]["message"]["content"]

def list_models():
    return [m["id"] for m in requests.get(f"{API_BASE}/models", headers=H).json()["data"]]

def list_tools():
    """获取全部 69 个工具定义"""
    return requests.get(f"{API_BASE}/tools", headers=H).json()["data"]

def call_tool(name, **kwargs):
    """执行任意工具"""
    r = requests.post(f"{API_BASE}/tools/call", headers=H,
        json={"name": name, "arguments": kwargs})
    return r.json()

def chat_with_tools(messages, model="deepseek-chat", max_rounds=10):
    """带工具调用的完整 Agent 循环"""
    tools = list_tools()
    for _ in range(max_rounds):
        r = requests.post(f"{API_BASE}/chat/completions", headers=H,
            json={"model": model, "messages": messages, "tools": tools})
        choice = r.json()["choices"][0]
        if choice["finish_reason"] == "stop":
            return choice["message"].get("content", "")
        if choice["finish_reason"] == "tool_calls":
            messages.append(choice["message"])
            for tc in choice["message"]["tool_calls"]:
                fn = tc["function"]
                result = call_tool(fn["name"], **json.loads(fn["arguments"]))
                messages.append({"role":"tool","tool_call_id":tc["id"],"content":json.dumps(result,ensure_ascii=False)})
    return "Max rounds exceeded"

# ── 使用示例 ──
if __name__ == "__main__":
    # 简单对话
    print(chat([{"role":"user","content":"Hello!"}]))
    # 搜索
    print(call_tool("web_search", query="Python tutorial", max_results=3))
    # B站搜索
    print(call_tool("bilibili_search", keyword="Vue3教程", limit=3))
    # Agent 循环
    msgs = [{"role":"user","content":"搜索今天的AI新闻并抓取第一篇"}]
    print(chat_with_tools(msgs))
```

### JavaScript / Node.js

```javascript
const API_BASE = "https://naujtrats.xyz/oneapichat/api/v1";
const API_KEY = "oac-xxxxxxxx...";
const H = { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` };

// 对话（非流式）
async function chat(messages, model = "deepseek-chat", tools) {
    const body = { model, messages };
    if (tools !== undefined) body.tools = tools;
    const r = await fetch(`${API_BASE}/chat/completions`, { method: "POST", headers: H, body: JSON.stringify(body) });
    return (await r.json()).choices[0].message.content;
}

// 对话（流式 SSE）
async function chatStream(messages, model = "deepseek-chat") {
    const r = await fetch(`${API_BASE}/chat/completions`, {
        method: "POST", headers: H,
        body: JSON.stringify({ model, messages, stream: true })
    });
    const reader = r.body.getReader(), decoder = new TextDecoder();
    let buf = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        for (const line of buf.split("\n")) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
                const c = JSON.parse(line.slice(6)).choices[0].delta.content;
                if (c) process.stdout.write(c);
            }
        }
        buf = buf.includes("\n") ? buf.slice(buf.lastIndexOf("\n") + 1) : buf;
    }
}

// 模型列表
async function listModels() {
    return (await (await fetch(`${API_BASE}/models`, { headers: H })).json()).data.map(m => m.id);
}

// 工具列表（69 个）
async function listTools() {
    return (await (await fetch(`${API_BASE}/tools`, { headers: H })).json()).data;
}

// 执行任意工具
async function callTool(name, args = {}) {
    const r = await fetch(`${API_BASE}/tools/call`, {
        method: "POST", headers: H, body: JSON.stringify({ name, arguments: args })
    });
    return r.json();
}

// 带工具调用的 Agent 循环
async function chatWithTools(messages, model = "deepseek-chat", maxRounds = 10) {
    const tools = await listTools();
    for (let i = 0; i < maxRounds; i++) {
        const r = await fetch(`${API_BASE}/chat/completions`, {
            method: "POST", headers: H, body: JSON.stringify({ model, messages, tools })
        });
        const choice = (await r.json()).choices[0];
        if (choice.finish_reason === "stop") return choice.message.content;
        if (choice.finish_reason === "tool_calls") {
            messages.push(choice.message);
            for (const tc of choice.message.tool_calls) {
                const fn = tc.function;
                const result = await callTool(fn.name, JSON.parse(fn.arguments));
                messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
            }
        }
    }
    return "Max rounds exceeded";
}

// ── 使用示例 ──
// chat([{role:"user",content:"Hello"}]).then(console.log);
// callTool("web_search", { query: "today news", max_results: 5 }).then(console.log);
// callTool("bilibili_search", { keyword: "Next.js", limit: 3 }).then(console.log);
```

### cURL — 一键 Agent

```bash
#!/bin/bash
API_KEY="oac-xxxxxxxx..."
API="https://naujtrats.xyz/oneapichat/api/v1"

# 对话（非流式）
curl -s "$API/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}]}' | jq .

# 执行工具
curl -s "$API/tools/call" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"web_search","arguments":{"query":"weather"}}' | jq .

# 模型列表
curl -s "$API/models" -H "Authorization: Bearer $API_KEY" | jq .
```

---

## 第三方客户端配置

| 客户端 | 配置路径 |
|--------|----------|
| [ChatBox](https://chatboxai.app/) | 设置 → 模型提供方 → OpenAI 兼容 |
| [NextChat](https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web) | 设置 → 自定义接口 |
| [LobeChat](https://lobechat.com/) | 设置 → 语言模型 → OpenAI 兼容 |
| [OpenCat](https://opencat.app/) | 添加 OpenAI 兼容提供商 |
| [Cherry Studio](https://cherry-ai.com/) | 设置 → 模型服务 → OpenAI 兼容 |
| deepseek-chat (desktop) | 设置 → API 地址 → 自定义 |

**配置示例**：

| 字段 | 值 |
|------|-----|
| API 模式 | OpenAI 兼容 |
| API 地址 | `https://naujtrats.xyz/oneapichat/api/v1` |
| API 密钥 | `oac-xxxxxxxx...` |
| 模型 | `/models` 返回的首个模型，如 `deepseek-chat` |

---

## 架构说明

```
第三方客户端
    │
    ▼
Nginx (naujtrats.xyz)
    │
    ├── /oneapichat/api/v1/*  ──→  PHP-FPM (tools/call.php, chat/completions.php, …)
    │                                    │
    │                                    ├── 4 个特殊工具 (PHP 原生)
    │                                    │   web_search, web_fetch, generate_image, engine_push
    │                                    │
    │                                    └── 65 个通用工具 ──→  MCP Server (:18788)
    │                                                              │
    │                                                              ├── Node.js handlers
    │                                                              ├── Python bridge (bilibili/chaoxing)
    │                                                              ├── MiniMax CLI
    │                                                              └── Engine proxy → Python FastAPI (:8766)
    │
    └── /mcp/*  ──→  MCP Server (:18788) [直接代理, 无需 API Key]
```

---

## 更新日志

- **2026-07-19**: 🏗️ API 重构 — `tools/call.php` MCP 透明代理全部 69 工具（替换硬编码路由）、`tools.php` 动态加载 MCP tool list、API.md 完整改写（工具分类表 + Python/JS Agent 循环示例）
- **2026-07-19**: 🔐 超星学习通扫码登录 + 文档生成工具 + 链式输出优化
- **2026-07-17**: 初始版本 — `/v1/chat/completions`（流式+非流式+函数调用）、`/v1/models`、`/v1/tools`、`/v1/tools/call`、MCP 适配、Nginx 清洁 URL
