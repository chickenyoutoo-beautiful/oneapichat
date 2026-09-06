# OneAPIChat REST API v1

> **Base URL**: `https://naujtrats.xyz/oneapichat/api/v1`
>
> OpenAI 兼容的 REST API。142 个 MCP 工具、流式/非流式对话、函数调用、标准 MCP Streamable HTTP 协议。
> 支持 ChatBox、NextChat、LobeChat、deepseek-chat 等第三方客户端直接接入。
> 支持 OpenClaw、Claude Code、Cursor 等标准 MCP 客户端通过 Streamable HTTP 连接。

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
| `/tools` | GET | ✅ | 全部 142 个工具定义（OpenAI function calling 格式） |
| `/tools/call` | POST | ✅ | 执行任意工具（透明代理到 MCP Server） |
| `/conversations` | GET/POST/DELETE | ✅ | 对话历史同步 |
| `/upload` | POST/GET | ⚠️ | 文件上传/图片列表（Auth-Token 认证，非 API Key） |
| `/skills` | GET | ✅ | 全部 12 个技能定义（run_skill enum 约束） |
| `/mcp` | POST | ❌ | **标准 MCP Streamable HTTP 协议**（JSON-RPC 2.0） |

### OAuth 端点（MCP 客户端自动发现，无需 API Key）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/.well-known/oauth-authorization-server` | GET | OAuth 服务器元数据（OpenClaw 自动发现） |
| `/.well-known/openid-configuration` | GET | OpenID Connect 配置（同上） |
| `/oneapichat/oauth/token` | POST | 获取 Bearer Token（`grant_type=client_credentials`） |
| `/oneapichat/oauth/authorize` | GET | 授权端点（直接返回 code） |
| `/oneapichat/oauth/register` | POST | 动态客户端注册 |

### 内部 MCP 协议端点（无需 API Key，内部服务直连）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp/api/tools` | POST | 全部 142 个工具列表（MCP inputSchema 格式） |
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

> **自动注入工具**：请求不含 `tools` 时，服务器自动注入全部 142 个可用工具。显式传 `tools: []` 则不注入。

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

动态从 MCP Server 加载全部 142 个工具，始终保持同步。

```bash
curl https://naujtrats.xyz/oneapichat/api/v1/tools \
  -H "Authorization: Bearer oac-xxxxxxxx..."
```

```json
{
  "object": "list",
  "count": 142,
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

### 工具分类索引（共 142 个）

| 分类 | 数量 | 前缀/工具名 |
|------|:--:|------|
| ☁️ Cloudreve 云盘 | 18 | `cr_list_files`, `cr_search_files`, `cr_create_folder`, `cr_rename`, `cr_move`, `cr_copy`, `cr_delete`, `cr_list_shares`, `cr_create_share`, `cr_delete_share`, `cr_storage_info`, `cr_overview`, `cr_login`, `cr_user_info`, `cr_check_login`, `cr_register`, `cr_upload`, `cr_upload_file` |
| 💻 服务器管理 | 16 | `server_sys_info`, `server_file_read`, `server_file_write`, `server_file_write_chunked`, `server_file_search`, `server_file_grep`, `server_file_edit`, `server_file_op`, `server_file_append`, `server_exec`, `server_python`, `server_ps`, `server_disk`, `server_network`, `server_docker`, `server_db_query` |
| 🗺️ 高德地图 | 14 | `amap_geo`, `amap_regeocode`, `amap_text_search`, `amap_around_search`, `amap_search_detail`, `amap_direction_walking`, `amap_direction_driving`, `amap_direction_bicycling`, `amap_direction_transit`, `amap_distance`, `amap_ip_location`, `amap_weather`, `amap_district`, `amap_schema_personal_map` |
| 📺 B站/视频 | 14+12 | `bilibili_search`, `bilibili_video_info`, `bilibili_article_read`, `bilibili_user_profile`, `bilibili_comment_list`, `bilibili_dynamic_list`, `bilibili_qr_login`, `bili_download`, `bili_download_dash`, `bili_download_status`, `bili_info`, `bili_search_ex`, `bili_streams` + `video_edit`, `video_understanding`, `video_search`, `video_download`, `video_parse`, `video_list_downloads`, `video_upload_cloudreve`, `video_cloudreve_*` |
| 📚 超星学习通 | 13 | `chaoxing_login`, `chaoxing_list_courses`, `chaoxing_auto`, `chaoxing_status`, `chaoxing_stop`, `chaoxing_stats`, `chaoxing_overview`, `chaoxing_auth`, `chaoxing_qr_login`, `chaoxing_exam_list`, `chaoxing_exam_start`, `chaoxing_exam_status`, `chaoxing_exam_stop` |
| 🎬 视频/下载 | 12 | `video_edit`, `video_understanding`, `video_search`, `video_download`, `video_download_status`, `video_parse`, `video_list_downloads`, `video_upload_cloudreve`, `video_cloudreve_list`, `video_cloudreve_mkdir`, `video_cloudreve_search`, `video_cloudreve_url` |
| 🪟 Windows 远程 | 7 | `win_info`, `win_processes`, `win_kill`, `win_start`, `win_restart`, `win_file`, `win_screenshot` |
| 🌐 浏览器自动化 | 6 | `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_get_content`, `browser_get_snapshot` |
| 📂 网盘解析 | 5 | `netdisk_parse`, `netdisk_download`, `netdisk_parse_and_download`, `netdisk_status`, `netdisk_login` |
| 🤖 Agent/编排 | 5+12 | `delegate_task`, `delegate_workflow`, `plan_update`, `ask_agent`, `autonomous_mode` + `run_skill` (含 12 个技能: deep-search, multi-agent-orchestration, chaoxing-automation, content-creation, server-management, cloud-file-manager, video-hunter, game-redemption-codes, windows-automation, browser-automation, netdisk-parser, amap-maps) |
| 📊 办公文档生成 | 5 | `generate_ppt`, `generate_docx`, `generate_xlsx`, `generate_pdf`, `generate_image` |
| 🔍 搜索与获取 | 3 | `web_search`, `web_fetch`, `platform_extract` |
| 🔧 其他工具 | 6 | `get_current_time`, `analyze_image` (🌐 MCP 服务器端执行，使用数据库 xAI/OpenAI key), `run_skill`, `rag_search`, `engine_push`, `image_gen`, `toggle_proxy` |

---

## 4. Tool Execution

直接执行任意工具，无需通过 Chat Completions 循环。所有 142 个工具均支持。

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

## 5. MCP Streamable HTTP 协议端点（标准）

```
POST /api/v1/mcp
```

**标准 MCP (Model Context Protocol) Streamable HTTP 传输层**，对外暴露 JSON-RPC 2.0 接口。
OpenClaw、Claude Code、Cursor 等标准 MCP 客户端可直接连接，无需 API Key。

### ★ analyze_image 服务器端执行（MCP 专用）

通过 MCP 调用 `analyze_image` 时，**自动在服务器端执行**（不依赖浏览器），使用数据库中保存的 xAI/OpenAI 视觉 key：

```bash
# 通过 MCP 分析图片（使用服务器端 xAI key）
curl -s https://naujtrats.xyz/oneapichat/api/v1/mcp \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
    "name":"analyze_image",
    "arguments":{
      "image_url": "https://naujtrats.xyz/oneapichat/uploads/xxx/img.jpg",
      "focus": "描述这张图片的内容"
    }
  }}'
```

**响应**：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "isError": false,
    "content": [{"type": "text", "text": "图片中有三个大型低温液体储罐..."}]
  }
}
```

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `image_url` | string | ⚠️ | 图片 URL（三选一） |
| `image_path` | string | ⚠️ | 服务器本地路径（三选一） |
| `image_index` | number | ⚠️ | 从聊天历史中获取第 N 张图片（三选一） |
| `focus` | string | | 分析提示词（默认"请详细描述..."） |
| `api_key` | string | | ★ 直接传入 API Key（无认证场景使用） |
| `provider` | string | | 视觉提供商: `"xai"` (默认) / `"openai"` |
| `model` | string | | 模型名: `"grok-4.5"` (默认) / `"gpt-4o"` |

**三种使用方式**：

1. **已认证用户**（传 API Key 或 Session Token）→ 自动从数据库读取 `visionProvider` 配置
2. **无认证 + 传 `user_id`** → `{"arguments": {"user_id": "u_xxx", "image_url": "..."}}`
3. **无认证 + 传 `api_key`** → `{"arguments": {"api_key": "xai-xxx", "provider": "xai", "image_url": "..."}}`

**视觉提供商选择**（已认证用户）：
1. `visionProvider: "xai"` → 使用 `visionApiKeyXAI` 调用 **Grok 视觉 API**
2. `visionProvider: "openai"` → 使用 `visionApiKeyOpenAI` 调用 **OpenAI GPT-4o**
3. `visionProvider: "minimax"` → 使用 `visionApiKey` 调用 **MiniMax VLM**
4. 视觉 key 为空 → **自动回退到主模型**（DeepSeek 等）

> **注意**：中国大陆服务器访问 xAI/OpenAI 需通过本地 **Mihomo 代理**自动路由，无需额外配置。
>
> **★ 无需 API Key**: MCP 端点 (`/api/v1/mcp`) 无需认证即可调用 `analyze_image`——服务器自动检测最近活跃用户并使用其配置的 xAI/OpenAI key。第三方客户端（Claude Code / Cursor / OpenClaw）可直接使用，无需传入任何 key。

### 示例：无认证调用（直接传 API Key）

```bash
curl -s https://naujtrats.xyz/oneapichat/api/v1/mcp \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"analyze_image",
      "arguments":{
        "image_url": "https://example.com/photo.jpg",
        "api_key": "xai-your-key-here",
        "provider": "xai",
        "model": "grok-4.5",
        "focus": "描述这张图片的内容"
      }
    }
  }'
```

### 视觉配置（网页端）

设置面板 → 「视觉理解提供商」：
- **xAI Vision (Grok)**: 需填写 `xAI API Key`（格式 `xai-...`），选择后自动启用代理
- **OpenAI Vision**: 需填写 `OpenAI API Key`（格式 `sk-...`），选择后自动启用代理
- **MiniMax VLM**: 需填写 `MiniMax API Key`，使用 coding-plan-vlm 端点
- **自定义**: 设置自己的 API 地址和模型



### 协议流程

```bash
# 1. 初始化握手
curl -s https://naujtrats.xyz/oneapichat/api/v1/mcp \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-client","version":"1.0"}}}'

# 2. 列出全部 142 个工具
curl -s https://naujtrats.xyz/oneapichat/api/v1/mcp \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 3. 调用工具
curl -s https://naujtrats.xyz/oneapichat/api/v1/mcp \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_current_time","arguments":{}}}'

# 4. Ping 健康检查
curl -s https://naujtrats.xyz/oneapichat/api/v1/mcp \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"ping"}'
```

### 响应格式

**initialize 响应**：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {"tools": {"listChanged": false}},
    "serverInfo": {"name": "oneapichat-mcp", "version": "1.0.0"}
  }
}
```

**tools/call 响应**：
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "isError": false,
    "content": [{"type": "text", "text": "{\"datetime\":\"2026年7月27日...\"}"}]
  }
}
```

### OpenClaw 配置示例

```json
{
  "mcp": {
    "servers": {
      "oneapichat": {
        "url": "https://naujtrats.xyz/oneapichat/api/v1/mcp",
        "transport": "streamable-http",
        "timeout": 30,
        "auth": "oauth"
      }
    }
  }
}
```

> OpenClaw 仅支持 `auth: "oauth"`。服务端已实现最小化 OAuth 服务器（`/.well-known/oauth-authorization-server` + `/oneapichat/oauth/token`），自动签发 Bearer Token。

---

## 5b. 内部 MCP 协议接口（直连）

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
| `deep-search` | 深度/多源搜索/文档生成 | web_search, bilibili_search, web_fetch, generate_ppt/xlsx/docx/pdf |
| `multi-agent-orchestration` | 复杂并行任务 | plan_update, delegate_task, engine_agent_* |
| `chaoxing-automation` | 超星刷课考试 | chaoxing_auto, chaoxing_status 等13个 |
| `content-creation` | 图片/PPT/视频创作 | generate_image, generate_ppt, video_edit |
| `server-management` | 服务器运维 | server_exec, server_docker 等16个 |
| `cloud-file-manager` | Cloudreve 云盘管理 | cr_list_files, cr_search_files 等18个 |
| `video-hunter` | B站视频下载/视频搜索 | bili_download, bili_streams, video_search 等 |
| `game-redemption-codes` | 游戏兑换码 | bilibili_search(优先), web_search |
| `windows-automation` | Windows远程控制 | win_* 7个工具 |
| `browser-automation` | 浏览器自动操作 | browser_* 6个工具 |
| `netdisk-parser` | 网盘链接解析 | netdisk_parse, netdisk_download 等5个 |
| `amap-maps` | 地图/导航/天气 | amap_geo, amap_direction_* 等14个 |

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
    """获取全部 142 个工具定义"""
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

// 工具列表（142 个）
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

### Python — MCP Streamable HTTP 客户端

```python
import requests, json

MCP_URL = "https://naujtrats.xyz/oneapichat/api/v1/mcp"

def mcp_call(method, params=None):
    """发送 JSON-RPC 2.0 请求到 MCP 端点"""
    body = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params:
        body["params"] = params
    r = requests.post(MCP_URL, json=body, headers={"Content-Type": "application/json"})
    return r.json()

# 1. 初始化
resp = mcp_call("initialize", {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "my-client", "version": "1.0"}
})
print("Server:", resp["result"]["serverInfo"])

# 2. 列出全部工具
tools = mcp_call("tools/list")["result"]["tools"]
print(f"Tools: {len(tools)}")  # 142

# 3. 调用工具
result = mcp_call("tools/call", {"name": "get_current_time", "arguments": {}})
print(result["result"]["content"][0]["text"])
```

### JavaScript — MCP Streamable HTTP 客户端

```javascript
const MCP_URL = "https://naujtrats.xyz/oneapichat/api/v1/mcp";

async function mcpCall(method, params = null) {
    const body = { jsonrpc: "2.0", id: 1, method };
    if (params) body.params = params;
    const r = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    return r.json();
}

// 初始化
const init = await mcpCall("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "my-client", version: "1.0" }
});
console.log("Server:", init.result.serverInfo);

// 列出工具
const tools = (await mcpCall("tools/list")).result.tools;
console.log(`Tools: ${tools.length}`);  // 142

// 调用工具
const result = await mcpCall("tools/call", { name: "get_current_time", arguments: {} });
console.log(result.result.content[0].text);
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

| 客户端 | 配置路径 | 协议 |
|--------|----------|------|
| [ChatBox](https://chatboxai.app/) | 设置 → 模型提供方 → OpenAI 兼容 | OpenAI REST |
| [NextChat](https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web) | 设置 → 自定义接口 | OpenAI REST |
| [LobeChat](https://lobechat.com/) | 设置 → 语言模型 → OpenAI 兼容 | OpenAI REST |
| [OpenCat](https://opencat.app/) | 添加 OpenAI 兼容提供商 | OpenAI REST |
| [Cherry Studio](https://cherry-ai.com/) | 设置 → 模型服务 → OpenAI 兼容 | OpenAI REST |
| deepseek-chat (desktop) | 设置 → API 地址 → 自定义 | OpenAI REST |
| [OpenClaw](https://openclaw.dev/) | `mcp.servers.oneapichat.url` | MCP Streamable HTTP |
| Claude Code / Cursor | MCP 配置 (`mcpServers`) | MCP Streamable HTTP |

**OpenAI REST 配置示例**：

| 字段 | 值 |
|------|-----|
| API 模式 | OpenAI 兼容 |
| API 地址 | `https://naujtrats.xyz/oneapichat/api/v1` |
| API 密钥 | `oac-xxxxxxxx...` |
| 模型 | `/models` 返回的首个模型，如 `deepseek-chat` |

**MCP Streamable HTTP 配置示例**（OpenClaw / Claude Code）：

| 字段 | 值 |
|------|-----|
| 传输方式 | `streamable-http` |
| URL | `https://naujtrats.xyz/oneapichat/api/v1/mcp` |
| 认证 | `none`（无需 API Key） |

> **★ 无认证自动用户检测**: MCP 端点无需任何认证即可使用 `analyze_image` 和 `run_skill`——服务器自动查找最近活跃用户并使用其配置。个人服务器（单用户）场景下第三方客户端零配置即可使用全部视觉和技能功能。

---

## 架构说明

```
第三方客户端 (ChatBox/NextChat/LobeChat)
    │
    ▼
Nginx (naujtrats.xyz)
    │
    ├── /oneapichat/api/v1/*  ──→  PHP-FPM (tools/call.php, chat/completions.php, …)
    │                                    │
    │                                    ├── 4 个特殊工具 (PHP 原生)
    │                                    │   web_search, web_fetch, generate_image, engine_push
    │                                    │
    │                                    └── 138 个通用工具 ──→  MCP Server (:18788)
    │                                                              │
    │                                                              ├── Node.js handlers
    │                                                              ├── Python bridge (bilibili/chaoxing)
    │                                                              └── Engine proxy → Python FastAPI (:8766)
    │
    ├── /oneapichat/api/v1/mcp ──→ PHP (mcp.php)
    │       │                          │
    │       │                          ├── analyze_image → ★ 服务器端执行 ★
    │       │                          │   ├── 从数据库读取 xAI/OpenAI key (decrypt_config_key)
    │       │                          │   ├── 从 uploads 目录读取图片
    │       │                          │   └── proxy.php → Mihomo 代理 → api.x.ai
    │       │                          │
    │       │                          └── 其他工具 ──→ MCP Server (:18788)
    │       │
    │       ▲ 标准 MCP Streamable HTTP (JSON-RPC 2.0)
    │       │
    │       └── OpenClaw / Claude Code / Cursor
    │
    └── /mcp/*  ──→  MCP Server (:18788) [直接代理, 无需 API Key]
```

---

## 更新日志

- **2026-07-30**: 🔧 **run_skill 参数映射修复** — 修复 MCP Server `api-tools.js` 中 `skills/run` 端点参数映射错误（发送 `{name, args}` 但引擎期望 `{skill_name, params}`）。修复为正确映射。同时修复 `engine/skills.py` 的 `list_skills()` 不包含 SKILL.md 正文的问题（正文作为 `prompt_template`）。第三方 MCP 客户端现在可以正确调用 `run_skill` 执行技能。
- **2026-07-30**: 🔧 **run_skill schema 修复** — 修复 `run_skill` 工具在 MCP 中 `properties` 为空的问题。引擎 `ToolDef.to_dict()` 新增 `parameters` 字段序列化。MCP Server 新增 `getSkillNames()` 从 `skills/` 目录读取技能列表并注入 `skill_name` enum（12 个技能）。第三方 MCP 客户端现在可以正确看到 `run_skill` 的参数定义和可用技能列表。
- **2026-07-30**: 🆕 **analyze_image MCP 服务器端执行** — MCP 调用 `analyze_image` 时自动在 PHP 服务器端执行，从数据库读取 xAI/OpenAI key (decrypt_config_key 解密)，通过 proxy.php → Mihomo 代理调用 xAI API。第三方 MCP 客户端无需配置 key 即可使用 Grok 视觉分析。新增 `decrypt_config_key()` 共享函数 (auth_helpers.php)。修复 `loadConfigFromServer` 守卫逻辑（本地 key 为空时强制使用服务器值）。修复 `onVisionProviderChange` 切换提供商时 xAI key 未保存的 bug。选择 xAI/OpenAI 时自动启用代理。
- **2026-07-30**: 🔧 **LongCat 视觉修复** — 移除 LongCat 的 `S.VISION` 标记（不支持视觉），图片自动走 `analyze_image` 工具处理
- **2026-07-27**: 🆕 **MCP Streamable HTTP 标准端点** — 新建 `/api/v1/mcp` 实现标准 MCP 协议 (JSON-RPC 2.0: `initialize`/`tools/list`/`tools/call`/`ping`)，内部翻译到 Node.js MCP Server 自定义协议。OpenClaw/Claude Code/Cursor 可直接连接。工具总数从 69 → 142（Cloudreve 18、高德 14、B站 14、视频 12 等新增分类）
- **2026-07-27**: 🔧 工具链扩展 — 新增 cr_upload_file/cr_check_login/cr_register、amap_* 14 个地图工具、netdisk_* 5 个网盘解析工具、video_hunter B站下载工具集
- **2026-07-19**: 🏗️ API 重构 — `tools/call.php` MCP 透明代理全部工具（替换硬编码路由）、`tools.php` 动态加载 MCP tool list、API.md 完整改写（工具分类表 + Python/JS Agent 循环示例）
- **2026-07-19**: 🔐 超星学习通扫码登录 + 文档生成工具 + 链式输出优化
- **2026-07-17**: 初始版本 — `/v1/chat/completions`（流式+非流式+函数调用）、`/v1/models`、`/v1/tools`、`/v1/tools/call`、MCP 适配、Nginx 清洁 URL
