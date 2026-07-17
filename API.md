# OneAPIChat API 文档

> **Base URL**: `https://naujtrats.xyz/oneapichat/api/v1`
>
> OpenAI 兼容的 REST API。支持 ChatBox、NextChat、LobeChat 等第三方客户端直接接入。

---

## 认证

所有请求需携带 API Key：

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
| `/tools` | GET | ✅ | 内置工具定义列表 |
| `/tools/call` | POST | ✅ | 执行内置工具 |

---

## 1. Chat Completions

```
POST /chat/completions
```

### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `model` | string | ✅ | 模型 ID，通过 `/models` 查询 |
| `messages` | array | ✅ | `[{role, content}]`，role: system/user/assistant/tool |
| `stream` | boolean | | `true` SSE流式 / `false` JSON（默认） |
| `temperature` | number | | 0–2，默认用户设置值 |
| `max_tokens` | integer | | 最大输出 token 数 |
| `top_p` | number | | 核采样 0–1 |
| `stop` | string/array | | 停止词 |
| `tools` | array | | 函数定义，OpenAI function calling 格式 |
| `tool_choice` | string | | `auto` / `none` / `required` |

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

### 流式示例

```bash
curl -N https://naujtrats.xyz/oneapichat/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"讲个笑话"}],"stream":true}'
```

### 流式响应 (SSE)

```
data: {"id":"...","choices":[{"index":0,"delta":{"role":"assistant","content":"为"},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{"content":"什么"},"finish_reason":null}]}

...

data: {"id":"...","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### 函数调用

```bash
curl https://naujtrats.xyz/oneapichat/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role":"user","content":"北京天气？"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "获取城市天气",
        "parameters": {
          "type": "object",
          "properties": {"city": {"type":"string","description":"城市"}},
          "required": ["city"]
        }
      }
    }],
    "tool_choice": "auto"
  }'
```

`finish_reason: "tool_calls"` 时，`message.tool_calls` 包含模型请求的函数。执行后将结果作为 `role: "tool"` 追加到 `messages` 继续请求。

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

> 首个模型是你的默认模型，后续从 Provider 动态获取。

---

## 3. Tools List

```
GET /tools
```

```bash
curl https://naujtrats.xyz/oneapichat/api/v1/tools \
  -H "Authorization: Bearer oac-xxxxxxxx..."
```

### 响应

```json
{
  "object": "list",
  "data": [
    {
      "type": "function",
      "function": {
        "name": "web_search",
        "description": "搜索互联网获取实时信息。",
        "parameters": {
          "type": "object",
          "properties": {
            "query": {"type":"string","description":"搜索关键词"},
            "max_results": {"type":"integer","description":"最大结果数，默认5"}
          },
          "required": ["query"]
        }
      }
    }
  ]
}
```

### 内置工具清单（共 27 个）

| 工具名 | 说明 | 后端 |
|--------|------|------|
| `web_search` | 互联网搜索（Tavily→Brave→DuckDuckGo） | PHP 直接调用 |
| `web_fetch` | 网页内容抓取+文本提取 | PHP 直接调用 |
| `generate_image` | AI 图片生成 | MiniMax mmx CLI |
| `engine_push` | 复制文件到共享目录 | PHP 本地操作 |
| `server_sys_info` | 系统信息（CPU/内存/磁盘） | Python 引擎 |
| `server_file_read` | 读取文件 | Python 引擎 |
| `server_file_write` | 写入/覆盖文件 | Python 引擎 |
| `server_file_append` | 追加内容到文件 | Python 引擎 |
| `server_file_search` | 按文件名搜索 | Python 引擎 |
| `server_file_grep` | 文件内容搜索 | Python 引擎 |
| `server_file_edit` | 文件内容替换 | Python 引擎 |
| `server_file_op` | 文件操作 (cp/mv/rm/mkdir) | Python 引擎 |
| `server_exec` | 执行 Shell 命令 ⚠️ | Python 引擎 |
| `server_python` | 执行 Python 脚本 | Python 引擎 |
| `server_ps` | 进程列表 | Python 引擎 |
| `server_disk` | 磁盘使用情况 | Python 引擎 |
| `server_network` | 网络诊断 | Python 引擎 |
| `server_docker` | Docker 管理 | Python 引擎 |
| `server_db_query` | SQLite 数据库查询 | Python 引擎 |
| `browser_navigate` | 浏览器导航 | Playwright CDP |
| `browser_screenshot` | 浏览器截图 | Playwright CDP |
| `browser_click` | 浏览器点击 | Playwright CDP |
| `browser_type` | 浏览器输入 | Playwright CDP |
| `browser_get_content` | 浏览器内容提取 | Playwright CDP |
| `browser_get_snapshot` | 浏览器无障碍快照 | Playwright CDP |
| `platform_extract` | 平台内容提取 (B站等) | Python 引擎 |
| `run_skill` | 运行已保存技能 | Python 引擎 |
| `video_edit` | 视频编辑 | FFmpeg/MoviePy |

所有工具均支持 `POST /tools/call` + `GET /mcp/api/tools/call`。

---

## 4. Tool Execution

直接执行 OneAPIChat 内置工具，无需通过 Chat Completions 循环。

```
POST /tools/call
```

### 请求

| 参数 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `name` | string | ✅ | 工具名称 |
| `arguments` | object | ✅ | 工具参数 |

### 示例

```bash
# 联网搜索
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"web_search","arguments":{"query":"今天天气","max_results":3}}'

# 读取文件
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"server_file_read","arguments":{"path":"/var/www/html/oneapichat/README.md","max_lines":20}}'

# 执行命令
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"server_exec","arguments":{"cmd":"uptime"}}'

# 生成图片
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"generate_image","arguments":{"prompt":"sunset over mountains"}}'

# 抓取网页
curl https://naujtrats.xyz/oneapichat/api/v1/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oac-xxxxxxxx..." \
  -d '{"name":"web_fetch","arguments":{"urls":["https://example.com"]}}'
```

### 响应

```json
{
  "results": [
    {"title": "...", "url": "https://...", "content": "..."}
  ],
  "status": "ok",
  "provider": "tavily"
}
```

错误时：

```json
{
  "results": [],
  "status": "error",
  "error": "All search providers failed"
}
```

---

## 5. MCP 工具接口

通过 Nginx 代理到 Node.js MCP 服务（端口 18788），无需 API Key。

```
GET  /mcp/api/tools       — 工具列表（MCP inputSchema 格式）
POST /mcp/api/tools/call   — 执行工具
```

```bash
# 列出工具
curl https://naujtrats.xyz/mcp/api/tools

# 调用工具
curl https://naujtrats.xyz/mcp/api/tools/call \
  -X POST -H "Content-Type: application/json" \
  -d '{"name":"web_search","arguments":{"query":"weather"}}'
```

MCP 响应格式：

```json
{
  "tools": [
    {
      "name": "web_search",
      "description": "搜索互联网获取实时信息。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {"type": "string", "description": "搜索关键词"},
          "max_results": {"type": "integer", "description": "最大结果数"}
        },
        "required": ["query"]
      }
    }
  ]
}
```

---

## 错误码

| HTTP | 类型 | 说明 |
|:----:|------|------|
| 400 | `invalid_request_error` | 缺少必填参数、JSON 格式错误 |
| 401 | `authentication_error` | API Key 无效或未提供 |
| 402 | `server_error` | 账户未配置 Provider |
| 429 | `rate_limit_error` | 请求频率过高 |
| 500 | `server_error` | 上游 Provider 返回错误 |
| 502 | `server_error` | 网络连接错误 |

```json
{
  "error": {
    "message": "可读描述",
    "type": "authentication_error",
    "code": "INVALID_API_KEY"
  }
}
```

> Provider 错误原样透传，方便排查 API Key 或余额问题。

---

## 代码示例

### Python

```python
import requests, json

API_BASE = "https://naujtrats.xyz/oneapichat/api/v1"
API_KEY = "oac-xxxxxxxx..."
H = {"Authorization": f"Bearer {API_KEY}"}

# ── 聊天（非流式）──
def chat(messages, model="deepseek-chat", tools=None):
    body = {"model": model, "messages": messages}
    if tools: body["tools"] = tools
    r = requests.post(f"{API_BASE}/chat/completions", headers=H, json=body)
    return r.json()["choices"][0]["message"]["content"]

# ── 聊天（流式）──
def chat_stream(messages, model="deepseek-chat"):
    r = requests.post(f"{API_BASE}/chat/completions", headers=H,
        json={"model": model, "messages": messages, "stream": True}, stream=True)
    for line in r.iter_lines():
        if line.startswith(b"data: ") and line != b"data: [DONE]":
            d = json.loads(line[6:]).get("choices",[{}])[0].get("delta",{})
            if d.get("content"): print(d["content"], end="", flush=True)

# ── 模型列表 ──
list_models = lambda: [m["id"] for m in requests.get(f"{API_BASE}/models", headers=H).json()["data"]]

# ── 工具列表 ──
def list_tools():
    return requests.get(f"{API_BASE}/tools", headers=H).json()["data"]

# ── 执行工具 ──
def call_tool(name, **kwargs):
    r = requests.post(f"{API_BASE}/tools/call", headers=H,
        json={"name": name, "arguments": kwargs})
    return r.json()

# ── 带工具调用的完整循环 ──
def chat_with_tools(messages, model="deepseek-chat"):
    tools = list_tools()
    while True:
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
                messages.append({"role":"tool","tool_call_id":tc["id"],"content":json.dumps(result)})


# ── 使用示例 ──
if __name__ == "__main__":
    # 简单聊天
    print(chat([{"role":"user","content":"Hello!"}]))

    # 搜索
    print(call_tool("web_search", query="Python tutorial", max_results=3))

    # 带工具的对话
    msgs = [{"role":"user","content":"搜索今天的新闻"}]
    print(chat_with_tools(msgs))
```

### JavaScript / Node.js

```javascript
const API_BASE = "https://naujtrats.xyz/oneapichat/api/v1";
const API_KEY = "oac-xxxxxxxx...";
const H = { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` };

// ── 聊天（非流式）──
async function chat(messages, model = "deepseek-chat", tools) {
    const body = { model, messages };
    if (tools) body.tools = tools;
    const r = await fetch(`${API_BASE}/chat/completions`, { method: "POST", headers: H, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()).choices[0].message.content;
}

// ── 聊天（流式）──
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

// ── 模型列表 ──
async function listModels() {
    return (await (await fetch(`${API_BASE}/models`, { headers: H })).json()).data.map(m => m.id);
}

// ── 工具列表 ──
async function listTools() {
    return (await (await fetch(`${API_BASE}/tools`, { headers: H })).json()).data;
}

// ── 执行工具 ──
async function callTool(name, args = {}) {
    const r = await fetch(`${API_BASE}/tools/call`, {
        method: "POST", headers: H, body: JSON.stringify({ name, arguments: args })
    });
    return r.json();
}

// ── 带工具调用的对话 ──
async function chatWithTools(messages, model = "deepseek-chat") {
    const tools = await listTools();
    while (true) {
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
}
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

**配置示例（ChatBox）**：

| 字段 | 值 |
|------|-----|
| API 模式 | OpenAI 兼容 |
| API 地址 | `https://naujtrats.xyz/oneapichat/api/v1` |
| API 密钥 | `oac-xxxxxxxx...` |
| 模型 | 从 `/models` 获取，如 `deepseek-chat` |

---

## 注意事项

1. **模型可用性**：取决于 OneAPIChat 中配置的 Provider。确保 API Key / Base URL 正确。
2. **速率限制**：Nginx `limit_req burst=20`，高并发需求联系管理员。
3. **System Prompt**：请求不含 `role: system` 时自动注入自定义提示词。要跳过则显式传入。
4. **函数调用**：需模型支持 tools（DeepSeek V4、GPT-4o 等）。`GET /tools` 获取内置工具，`POST /tools/call` 直接执行。
5. **Provider 错误透传**：上游返回的 401/429 等错误完整透传。
6. **API Key 安全**：拥有完整聊天权限，泄露后可撤销。

---

## 更新日志

- **2026-07-17**: 初始版本 — `/v1/chat/completions`（流式 + 非流式 + 函数调用）、`/v1/models`、`/v1/tools`、`/v1/tools/call`（工具执行）、`/mcp/api/tools`（MCP 适配）、Nginx 清洁 URL
