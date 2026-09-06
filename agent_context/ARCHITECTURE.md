# OneAPIChat 架构地图

## 请求路径
浏览器 SPA → 同源 PHP/engine bridge → Python FastAPI engine → provider/MCP。

## 持久化
- 聊天历史：chat_data/ 与前端本地缓存。
- 流进度：.engine/streams/ 与按用户 chat SQLite。
- Agent 运行时：.engine/runtime.db 的事件、任务、目标、子代理和投影。
- 用户人格/记忆：.engine/memory/，按用户隔离。

## 恢复原则
事件或快照先落盘，再通过 SSE 或 HTTP 暴露；客户端以 session、chat、msg 和 cursor 去重，不能用一个全局 stream id 代表多个会话。

## 代码 Agent 能力
优先走统一 tool registry/pipeline；读文件、搜索、编辑、写入、测试和 git 操作要有明确的工作区边界、审批、超时、取消和结果验证。

## 常见故障定位
1. 先查 /engine/health 与 /engine/tasks/active。
2. 再查 .engine/streams/<msg_id>.json 和 chat_<user>.db。
3. 最后查浏览器 ResumeStream 状态与 SSE 连接。
