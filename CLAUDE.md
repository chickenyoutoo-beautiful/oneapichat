# OneAPIChat 项目架构指南

> 每次修改项目后，Agent 必须更新此文件（特别是「最近变更」章节）。

## 最近变更

- **2026-07-31**: 🤖 **Codex CLI 安装配置 (DeepSeek-V4-Flash + Responses API)** — ①**安装**: `npm i -g @openai/codex` → codex-cli 0.146.0 (`~/.npm-global/bin/codex`) ②**认证**: 服务器上所有 OpenAI Key 已失效 (401), OneAPI 网关 (oneapi.naujtrats.xyz) 已死 (域名指向 HTML 站); 复用环境变量 `ANTHROPIC_API_KEY` 的 DeepSeek Key ③**官方适配**: DeepSeek 2026-07-31 正式版 V4-Flash 原生支持 Responses API 并针对性适配 Codex (仅 flash 支持, v4-pro 预计 8 月初); 运行官方一键脚本 `bash <(curl -fsSL https://cdn.deepseek.com/api-docs/codex-deepseek-setup.sh)` 选 1 — 写入 `~/.codex/models.json` (模型元数据) + 重写 config.toml (`model=deepseek-v4-flash`, `wire_api="responses"`, `base_url="https://api.deepseek.com/"`, `experimental_bearer_token` 内嵌 Key), MCP 配置保留, 原配置备份到 `~/.codex/backup-deepseek/` ④**版本坑**: codex ≥0.128 移除 `wire_api="chat"` (仅支持 responses), DeepSeek 无 Responses 端点 → 必须用官方适配版 flash; 0.125.0 是最后一个支持 chat 的稳定版 (未采用) ⑤**代理包装器**: `~/.npm-global/bin/codex` 是 bash 包装器 (原 npm shim 改名 `codex-raw`) — 设 `HTTPS_PROXY=socks5h://127.0.0.1:1081` (OpenAI 等境外 API 走 Mihomo) + `NO_PROXY=api.deepseek.com,naujtrats.xyz,...` (DeepSeek/本机直连); 无 NO_PROXY 时 DeepSeek 经 Mihomo 连接失败 + MCP 服务器连不上 ⑥**验证**: `codex exec` 对话 + bash 工具调用 (date) 全链路通过, MCP (oneapichat + cloudcli-browser) 零错误; 注意: 非 tty 下 codex exec 会等 stdin, 需 `</dev/null` ⑦**注意事项**: npm 重装会覆盖 bin/codex 包装器 (codex-raw 保留); `preferred_auth_method="apikey"`, `forced_login_method="api"`

- **2026-07-30**: 🔧 **股票工具全链路修复 (Schema + IPv4 + 龙虎榜API + Nginx)** — ①**Schema 修复**: `stock_north_flow` 和 `stock_market_overview` 的 `properties: {}` 空对象经 PHP `json_decode` 后变成 `[]`, DeepSeek API 拒绝 ("[] is not of type object") → 回复为空. 修复: 所有空 properties 加 `_dummy` 占位符 (MCP Server api-tools.js + 前端 tools.js 两处) ②**IPv4 强制**: 东方财富 DNS 解析到 IPv6, 但 Mihomo 配置 `ipv6: false` → 连接失败. 修复: `stock_data.py` monkey-patch `socket.getaddrinfo` 强制 AF_INET; curl 兜底加 `-4` 参数; push2his 改用 HTTP (HTTPS TLS 握手不稳定) ③**龙虎榜 API 替换**: `push2ex.eastmoney.com/getTopicBKList` 已废弃 (返回 404). 修复: 改用 `datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILS` (HTTP, 日期格式 YYYY-MM-DD) ④**Nginx 连接限制**: `limit_conn conn_per_ip 10` 太低, 代理开启时 proxy.php 中继外部 API 占用连接时间长, 10 个连接很快占满 → 新请求返回 444/空. 修复: 提高到 50 ⑤**缓存刷新**: tools.js → v1785225000, SW v99

- **2026-07-30**: 📈 **A股股票数据功能全链路集成 (9个工具 + 可视化)** — ①**数据源**: 东方财富 HTTP API (push2.eastmoney.com / push2his.eastmoney.com), 走 Mihomo SOCKS5 代理, 10秒内存缓存 ②**数据层**: 新建 `python/engine/stock_data.py` — 9个函数 (get_realtime/get_kline/get_sector_flow/get_dragon_tiger/get_north_flow/get_stock_diagnosis/calc_indicators/generate_chart/get_market_overview) + 技术指标计算 (MA/MACD/KDJ/RSI/BOLL) + matplotlib 暗色主题K线图生成 + requests/curl 双通道容错 (东方财富间歇性丢连接时自动降级到 curl 子进程) ③**引擎端点**: `server_tools.py` 注册 9 个 `@app.get("/engine/stock_*")` 路由 ④**PHP代理**: `engine_api.php` 新增 9 个 `case 'stock_*':` 分支 ⑤**MCP Server**: `api-tools.js` EXTRA_TOOLS 新增 9 个工具定义 + ENGINE_MAP 新增 `stock_*: 'stock_*'` 映射 (工具总数 143→152) ⑥**前端**: `tools.js` 新建 `window.STOCK_TOOLS` 数组(9个工具) + toolRegistry 注册 + `_TOOL_CATEGORIES` 新增 '📈 股票行情' 分类 + `_TOOL_LABELS` 新增9个中文标签; `tools-exec.js` 新增 9 个 `else if (func.name === 'stock_*')` dispatch 分支; `cloudreve.js` `engineApiHandler` 新增 9 个 `if (action === 'stock_*')` 处理 (Markdown 表格格式化 + 图表URL渲染); `main.js` 注入 STOCK_TOOLS ⑦**图表输出**: 暗色主题 GitHub 风格 K线图 (K线+MA5/10/20+成交量+MACD+DIF/DEA), 保存到 `uploads/stock_charts/` ⑧**Skill**: `skills/stock-analysis/SKILL.md` 新建, 包含9种工具使用指南+4个分析工作流+股票代码速查表+时间感知策略, 50个触发词自动匹配

- **2026-07-28**: 🔧 **Agent 模式优化 (Plan/Agent/YOLO 三模式重构)** — ①**Plan 模式重设计**: 从"只读拒绝写操作"改为完整的工作流 — 只读探索 → 生成计划(plan_update create) → 用户审批(横幅: 同意执行/修改计划/取消) → 执行(approved=true) → 完成(complete后重置) ②**新增 Plan 审批状态机**: `_planState`(exploring/reviewing/executing) + `_planApproved` 标志 + `approvePlan()/rejectPlan()/cancelPlan()` 三个控制函数 ③**Plan 模式专用系统提示词**: `main.js` `isPlanMode()` 时注入规划工作流提示(探索→规划→等待审批→执行→完成)，不再使用通用 Agent 提示 ④**审批横幅 UI**: `tools-exec.js` `_createPlanApprovalBanner()` 在 flowPanel 顶部插入蓝底横幅 + 三个按钮(同意执行绿/修改计划蓝/取消灰) ⑤**移除免审按钮**: 与 YOLO 模式功能重复，从 mode popup 中删除，保留 `toggleSessionAutoApprove()` 函数兼容 ⑥**审批流**: Plan 模式下 `requestToolApproval()` 只读工具始终自动批准，写操作检查 `_planApproved` — 已批准+executing 则执行，否则拒绝 ⑦**关键文件**: agent.js(状态机+审批函数) main.js(Plan提示词注入) tools-exec.js(横幅+create/complete处理) index.html(移除免审按钮) style.css(审批横幅样式)

- **2026-07-28**: 🔧 **视觉配置刷新丢失修复** — ①**根因A**: `init.js` 的 `initializeConfig()` 加载了 OpenAI 视觉配置(`visionApiKeyOpenAI`/`visionApiUrlOpenAI`)但未加载 xAI 视觉配置(`visionApiKeyXAI`/`visionApiUrlXAI`),刷新后下拉框显示 xAI 但 xAI 的 Key/URL 字段为空 ②**根因B**: `loadConfigFromServer()` 无条件覆盖视觉相关配置,服务器旧值(如 MiniMax)覆盖本地刚配置的 xAI 设置 ③**根因C**: 页面加载时未根据当前 `visionProvider` 切换字段可见性,导致 xAI 提供商下仍显示 MiniMax 的 Key/URL 字段 ④**修复A**: `initializeConfig()` 新增 xAI 视觉配置加载 ⑤**修复B**: `loadConfigFromServer()` 新增视觉配置守卫(`visionProvider`/`visionApiKeyXAI`/`visionApiUrlXAI`/`visionApiKeyOpenAI`/`visionApiUrlOpenAI`/`visionApiKey`/`visionApiUrl`) ⑥**修复C**: `initializeConfig()` 末尾新增字段可见性切换逻辑 ⑦**缓存**: init.js/storage.js → v1785222000

- **2026-07-28**: 🔧 **analyze_image 多图片修复** — ①**根因**: `tools-exec.js` 的 `analyze_image` handler 只从 `pendingFiles` 或最后一条用户消息的 `files` 中获取图片,用户分多次上传的图片只有最后一张能被找到,导致 `image_index` 无论传何值都返回同一张图 ②**修复**: 新增历史图片收集逻辑 — 当当前消息图片<2张时,遍历聊天历史中所有用户消息的 `files`,去重后合并到 `currentFiles`,使所有上传的图片都能被 `image_index` 访问 ③**工具描述更新**: `tools.js` 的 `ANALYZE_IMAGE_TOOL` 描述明确告知模型"系统会自动收集聊天中所有用户上传的图片" ④**缓存**: tools.js/tools-exec.js → v1785221000

- **2026-07-28**: 🔧 **xAI配置刷新丢失修复** — ①**根因**: `storage.js` 的 `loadConfigFromServer()` 无条件覆盖 `baseUrlProvider`,服务器因 `_scheduleConfigSync` 2秒延迟可能持有旧值(如minimax),刷新时覆盖本地刚切换的xAI设置 ②**修复A**: `loadConfigFromServer()` 新增 `baseUrlProvider` 守卫 — 本地已有值时跳过服务器写入 ③**修复B**: `chat.php` 的 `save_config` 敏感字段保护列表新增全部厂商独立Key (`apiKeyXAI/Gemini/Zhipu/Qwen/Moonshot/Doubao/MiMo/OpenRouter/LlamaCpp/Nvidia/LongCat/Custom`),防止空值覆盖已有Key

- **2026-07-28**: 🔧 **子代理自动回复修复(普通聊天模式)** — ①**根因**: `agent.js:2249` 和 `agent-notify.js:740` 的 `isAgentToolsActive()` 守卫导致普通聊天模式下子代理完成后不触发主代理自动回复 ②**修复A**: 移除两处 `isAgentToolsActive()` 守卫,改为无条件调用 `triggerAgentAutoReplyForSubAgent()` ③**修复B**: `_triggerMainAgentForTask` 新增聊天切换逻辑(当 `currentChatId !== task.chatId` 时自动切换到任务所在聊天) ④**修复C**: 新增 `window._pendingAgentReply` 标记,当主代理忙时设置标记,在 `sendMessage` 的 `finally` 块中检测并触发自动回复 ⑤**缓存**: agent.js/agent-notify.js/main.js → v1785220000

- **2026-07-28**: 🔧 **Agent权限修复 + parse_document文档解析工具** — ①**Agent权限问题**: 普通聊天下开启Agent模式(server_exec等B类工具已注册),但高危工具每次调用都弹审批弹窗,用户体验差。修复: `agent.js` 新增 `window._sessionAutoApprove` 会话级自动批准开关 + `toggleSessionAutoApprove()` 函数, `index.html` Agent模式弹窗新增「免审」按钮, `style.css` 新增 `.agent-popup-separator` 和 `#sessionAutoApproveBtn.active` 样式, 切回off模式时自动清除免审标记 ②**parse_document工具**: 新增服务端文档解析工具(引擎端点 `/engine/parse_document` → `python/engine/server_tools.py`), 支持 DOCX(python-docx提取段落+表格)/XLSX(openpyxl)/PPTX(python-pptx)/PDF(pdftotext)/DOC(OLE2 UTF-16LE解码)/TXT 格式, `api/engine_api.php` 新增 `parse_document` action代理, `mcp-server/api-tools.js` EXTRA_TOOLS新增工具定义 + ENGINE_MAP映射(`parse_document: 'parse_document'`), `tools.js` 新增 `PARSE_DOCUMENT_TOOL` 常量 + toolRegistry注册(approval:AUTO, isReadOnly:true, isAgentOnly:false) + 中文标签'文档解析', `main.js` A类工具列表添加(始终可用不受Agent模式影响), `tools-exec.js` 新增dispatch分支调用 `engineApiHandler('parse_document', args)`, `cloudreve.js` engineApiHandler新增parse_document处理 ③**缓存**: main.js/agent.js/tools.js/tools-exec.js/cloudreve.js → v1785218105, SW v97

- **2026-07-28**: 🔧 **analyze_image 工具链全链路修复 (历史图片无法分析)** — ①**根因A (image_proxy.php 路径bug)**: `api/image_proxy.php` 的 `realpath(__DIR__ . '/../' . ltrim($path, '/'))` — `serverUrl` 形如 `/oneapichat/uploads/user_u_xxx/img_xxx.jpg`, `ltrim` 后保留 `oneapichat/` 前缀, 拼接后变成 `/var/www/html/oneapichat/oneapichat/uploads/...` (不存在!) → 返回 403。修复: 在 realpath 前加 `$path = preg_replace('#^/oneapichat#', '', $path)` 剥离 URL 前缀 ②**根因B (image_proxy.php 调用不存在的 isLoggedIn)**: `api/image_proxy.php` 调用 `isLoggedIn()` 但整个项目无此函数定义 → PHP fatal error → 所有请求返回 500。修复: 改用 `require_once auth_helpers.php` + `$_GET['auth_token']` + `verifyAuthToken()` 标准认证模式 (与 chat.php/upload.php 一致) ③**根因C (JS 不传 auth_token)**: `tools-exec.js` 和 `image-gen.js` 调用 `image_proxy.php` 时未带 `auth_token` 参数 → 即使函数存在也会 401。修复: 三处 fetch 均追加 `&auth_token=' + encodeURIComponent(window.getAuthToken() || '')` ④**根因D (MiniMax路径不走代理)**: `tools-exec.js` 的 `analyze_image` handler — 仅 xAI/OpenAI 分支调用 `image_proxy.php` 获取 base64, MiniMax/MCP 分支直接把 URL 传给 `window.analyzeImage()`, 浏览器下载失败 → "图片下载失败...图片加载失败"。修复: MiniMax 分支也优先用 `image_proxy.php` 获取 base64 (从磁盘读取, 不依赖浏览器下载) ⑤**根因E (analyzeImage 无降级)**: `image-gen.js` 的 `window.analyzeImage()` 直连模式浏览器下载失败后直接抛错。修复: 浏览器下载失败时降级到 `image_proxy.php` 服务端代理 ⑥**根因F (serverUrl 丢失时文件名回退路径错误)**: 重试时 in-memory 文件对象 `serverUrl` 可能为空, 旧代码回退到 `anonymous/` 目录, 但实际文件在 `user_u_xxx/` → 404/403。修复: `tools-exec.js` 新增 serverUrl 恢复逻辑 — 方法1: 从聊天历史其他消息的 files 数组按文件名匹配; 方法2: 从消息正文提取 `🌐 URL:` 模式 ⑦**根因G (视觉 Key 未配置时无限回退)**: `visionApiKey` 为空时, MiniMax 直连模式不设置 Authorization 头 → "login fail"。修复: `image-gen.js` 新增主模型回退 — 视觉 Key 未配置时, 切换到主模型(DeepSeek)的 chat/completions 端点, 用 OpenAI 视觉格式(content 数组)发送图片 ⑧**根因H (MCP API 无法使用 xai 视觉)**: `analyze_image` 是浏览器端工具, 第三方 MCP 客户端无法执行。修复: `api/v1/mcp.php` 新增 `analyzeImageServerSide()` — 拦截 MCP 的 `analyze_image` 调用, 改为 PHP 服务器端执行: 从数据库读取用户配置的 xAI key (decrypt_config_key 解密), 通过 proxy.php 中继调用 xAI API ⑨**auth_helpers.php**: 新增共享函数 `decrypt_config_key()` (从 chat/completions.php 提取), 供 mcp.php 解密用户加密存储的 API Key ⑩**ui.js**: 修复 `onVisionProviderChange` 切换提供商时 xAI key 未保存的 bug; 选择 xAI/OpenAI 时自动启用代理 ⑪**mcp.php analyzeImageWithKey()**: 新增无认证场景支持 — 第三方客户端可直接传入 `api_key` + `provider` 参数调用 xAI 视觉 API, 无需用户认证 ⑫**MCP 无认证 analyze_image 修复**: 当 `$userId` 为空时, 支持通过 `arguments.user_id` 或 `arguments.api_key` 调用视觉 API, 不再回退到浏览器端 MiniMax ⑬**run_skill 参数映射修复**: MCP Server (`api-tools.js`) 的 `skills/run` 端点参数映射错误 — 发送 `{name: args.name, args}` 但引擎期望 `{skill_name, params}`。修复为 `postBody = JSON.stringify({ skill_name: args.skill_name || args.name, params: args.params || args.args || {} })` ⑭**技能模板解析修复**: `engine/skills.py` 的 `list_skills()` 只解析 YAML frontmatter,不包含正文内容。修复: YAML 之后的内容作为 `prompt_template` 字段 ⑮**MCP 无认证自动用户检测**: `api/v1/mcp.php` 新增无认证时自动获取最近活跃用户逻辑 — 从 SQLite sessions 表或 JSON sessions 文件找最近创建的 session, 使用其 user_id 调用 `analyzeImageServerSide()`。第三方 MCP 客户端无需任何认证即可使用 `analyze_image` (xAI 视觉) 和 `run_skill` (12 个技能) ⑯**缓存**: image-gen.js → v1785169400, tools-exec.js → v1785222000, SW v98

- **2026-07-28**: 🔧 **Grok/xAI 视觉修复 (三重根因)** — ①**根因A (核心)**: `utils.js:84-131` 的 `sanitizeForLongCat()` 函数 — 注释写着"对所有模型都执行清洗"，在 `buildApiMessages` 末尾（`api-messages.js:554`）被调用，将所有模型的 `content` 数组强制转为字符串，把 `image_url` 替换为 `[图片]` 文本占位符 → 图片数据根本没发到 API！日志特征: `[sanitize] msg[1] role=user content is ARRAY, converting...` 后跟 `content=[图片]`。修复: 检测数组是否含 `image_url`，含则 `continue` 跳过转换 ②**根因B (加重)**: `main.js:2175-2192` 的"通用防护: 确保 content 始终是字符串" — 同样对所有模型生效，二次摧毁 `image_url`。修复: 新增 `var _isVisionForSafe = _getModelCfg().supportsVision(body.model)` 守卫，视觉模型跳过 ③**根因C (次要)**: `utils.js:227` 的 `detail: 'default'` — OpenAI/xAPI API 只接受 `auto`/`low`/`high`，`"default"` 是非法值；xAI 严格校验返回 400 → 触发 `strip_images` 剥离图片。修复: `detail: 'default'` → `detail: 'auto'` ④**缓存**: main.js → v1785168100, utils.js → v1785168200

- **2026-07-28**: 🔧 **xAI 图片下载失败修复 (URL → base64)** — ①**根因**: 图片数据已正确发送(数组格式修复生效), 但 xAI 服务器尝试从 `www.naujtrats.xyz` 下载图片时连接断开 → 报错 `Failed to download the provided image (image_download_error=image_download_interrupted): the connection dropped while downloading the image` ②**日志特征**: `[BUF-HEX] {"code":"invalid-argument","error":"Failed to download the provided image..."}` ③**修复**: `utils.js` 的 `buildUserContent()` 新增 xAI 检测 — provider=xai 或模型名含 grok 时, 强制使用 base64 data URL 嵌入图片(不依赖外部 URL), 图片随请求体一起传输, 无需 xAI 服务器二次下载 ④**缓存**: utils.js → v1785168500

- **2026-07-28**: 🔧 **多图片请求过大修复 (图片数量限制)** — ①**根因**: 用户一次上传 59 张图片, 全部塞进一个 API 请求, base64 后请求体达 20-30MB, 导致连接断开 (SSL_ERROR_SYSCALL) 和图片下载超时 (image_download_interrupted) ②**修复**: `utils.js` 的 `buildUserContent()` 新增图片数量限制 — xAI/Grok 单次最多 10 张, 其他模型最多 20 张; 超出时截取前 N 张并 toast 提示用户 ③**缓存**: utils.js → v1785168600

- **2026-07-28**: 🔧 **多图片自动分批发送** — ①**根因**: 用户一次上传 59 张图片, 全部塞进一个请求导致连接断开; 之前修复只是截断多余图片, 用户需手动重新发送 ②**修复**: `queue.js` 的 `_smartSend()` 检测图片数量, 超过限制(xAI 10张/其他 20张)时自动调用 `_splitAndQueueImages()` 拆分为多批并入队; 第一批包含原始文本+非图片文件, 后续批标注 "[续传第 N/M 批]"; 队列逐一自动发送, 无需用户手动分批 ③**缓存**: queue.js → v1785168850

- **2026-07-28**: 🔧 **批量图片队列修复 (内存队列 + 强制 base64)** — ①**根因**: 批量图片通过 localStorage 队列发送时, 文件 content 被剥离(localStorage 5MB 限制), 导致 base64 数据丢失, 回退到 URL 模式, xAI 无法下载 → `image_download_interrupted` ②**修复**: 批量图片改用独立内存队列 (`_imageBatchQueue`), 不经过 localStorage, 保留完整 base64 数据; xAI 检测改为从 baseUrl 判断 (`api.x.ai`); xAI 模型强制使用 base64 ③**缓存**: queue.js → v1785168850, utils.js → v1785168900

- **2026-07-28**: 🔧 **xAI 视觉提供商集成 (图片预分析)** — ①**需求**: xAI 无法下载外部图片 URL, 配置独立视觉提供商, 用其模型分析图片后以文本传给主模型 ②**修复**: `index.html` 视觉提供商下拉新增 "xAI Vision (Grok)" 选项 + xAI Key/Url 配置字段; `ui.js` `onVisionProviderChange()` 新增 xAI 分支; `config.js` 保存 xAI 视觉配置; `utils.js` 新增 `_analyzeImagesWithVisionProvider()` 函数 (调用 xAI/OpenAI/MiniMax 视觉 API); `main.js` `sendMessage()` 在 `buildApiMessages` 前调用视觉预分析; `api-messages.js` `buildApiMessages()` 检测 `__visionPreAnalysis` 时替换图片为文本 ③**缓存**: main.js → v1785168200, utils.js → v1785168500, api-messages.js → v1785168200

- **2026-07-28**: 🔧 **analyze_image 工具支持 xAI/OpenAI 视觉提供商** — ①**根因**: `analyze_image` MCP 工具调用 `window.analyzeImage()` 走 MiniMax MCP, 当视觉提供商配置为 xAI 时仍走 MiniMax → 报错 "图片下载失败" ②**修复**: `tools-exec.js` 的 `analyze_image` handler 新增 xAI/OpenAI 分支: 检测到 xAI/OpenAI 提供商时, 强制使用 base64 content (无 base64 则从 serverUrl 下载后转 base64), 走 proxyFetch 调用 xAI/OpenAI 视觉 API ③**缓存**: tools-exec.js → v1785168200, utils.js → v1785168900

- **2026-07-28**: 🔧 **聊天记录图片数据保留修复** — ①**根因**: `slimSaveChats()` 保存聊天时清空所有图片 base64 content (阈值 >500字符), 刷新后历史图片只剩 URL, xAI 无法下载 → 模型追问"图片在哪" ②**修复**: 提升保留阈值到 200000 字符(约 150KB base64), 中小图片刷新后仍保留 base64; 大图片才剥离 ③**缓存**: dialogs.js → v1785168300, utils.js → v1785168900

- **2026-07-28**: 🔧 **多图片分批策略优化 (先识别后操作)** — ①**根因**: 用户希望模型先识别所有图片内容, 不要边传边操作, 全部识别完再统一执行任务 ②**修复**: `_splitAndQueueImages()` 的批次文本策略改为: 第一批含用户指令但明确告知"先记住, 不要执行"; 中间批只说"继续识别记忆"; 最后一批告知"所有图片已发送完毕, 请根据之前识别的所有图片内容执行指令: [用户原始指令]" ③**缓存**: queue.js → v1785168750

- **2026-07-28**: 🔧 **DOCX/PPTX 解压报错修复** — ①**根因**: 上传非 ZIP 格式文件（旧版 .doc 改名为 .docx、或文件损坏）时 JSZip.loadAsync() 抛出 "Can't find end of central directory" 错误，console 显示红色报错 ②**修复**: `files.js` 新增 `_isZipBuffer()` 工具函数检测 PK 魔数头（0x50 0x4B），docx/xlsx 解析前先校验，非有效 ZIP 则跳过 JSZip 直接走降级提取（原始二进制正则提取），避免无意义报错 ③**已有先例**: PPTX 已手工实现相同检测（lines 261-264），现统一为共享函数 ④**缓存**: files.js → v1785168300

- **2026-07-28**: 🔧 **旧版 .doc 二进制格式解析** — ①**根因**: 旧版 `.doc` (Word 97-2003, OLE2 二进制格式) 不是 ZIP 压缩包, 前端 JSZip/mammoth 均无法解析, 之前直接 throw 报错 ②**修复**: 新增 `_extractDocText(ab)` 函数 — 逐双字节 UTF-16LE 解码提取可打印字符, 支持中文 (CJK 0x4E00-0x9FFF)、中文标点 (0x3000-0x303F)、全角字符 (0xFF00-0xFFEF); 含噪音过滤 (可打印率 < 50% 丢弃) + 去重; 方法1结果少时降级用 TextDecoder UTF-16LE 全文解码 ③**局限**: 复杂排版/表格/图片无法还原, 仅提取纯文本; 仍建议用户另存为 .docx 获得最佳效果 ④**缓存**: files.js → v1785168400

- **2026-07-27**: 🔧 **ModelCap max_tokens 智能化修复** — ①**根因**: 用户设置 maxTokens=131072 但 ModelCap 将其砍到 8192 (grok-4.5)，因为所有 Grok 模型 `maxOutputTokens` 硬编码为 8192（过于保守），且 `getMaxOutputTokens()` 不读取 AutoAdjust 学习到的覆盖值 → 每次都要等 API 报错后才能修正 ②**配置修正**: Grok 全系列 8192→131072（新增 grok-4.5 专用配置块排在 grok-4 之前避免子串误匹配）、DeepSeek V3 8192→131072、Claude 4 Opus/Sonnet 8192→64000、Gemini 2.x/3 8192→65536、Qwen 8192→16384、Llama 3/4 8192→32768 ③**智能化**: `models.js` 的 `getMaxOutputTokens()` 优先读取 `modelMaxOutputTokens`（AutoAdjust 从 API 错误中提取并持久化的真实限制），实现"学习一次，永久生效"—首次请求后自动校正，刷新不丢失 ④**设计原则**: `maxOutputTokens`=模型实际硬上限（不浪费用户滑块空间），`defaultMaxTokens`=滑块默认值（保守安全），AutoAdjust 兜底校正

- **2026-07-27**: 🔧 **Cloudreve 云盘面板登录状态修复** — ①**根因**: `check_login` PHP 端返回 `{success:true, data:{logged_in:true, nickname, email}}`，但 `cloudreve.js` 的 `loadPanel()` 读取 `obj.logged_in`（顶层）而非 `obj.data.logged_in`（嵌套）→ `obj.logged_in` 永远为 `undefined` → 即使已登录也始终显示登录表单 ②**症状解释**: 用户输入账号密码后，`login` action 返回顶层 `success:true` → 前端显示"✅ 登录成功!" → 800ms 后 `loadPanel()` 重新检查 → `check_login` 的 `logged_in` 嵌套在 `data` 内，顶层读取为 `undefined` → 立刻变回"未登录"要求重新输入 ③**修复**: `loadPanel()` 新增 `var cr = obj.data || obj` 解包，所有字段（logged_in/nickname/accounts）统一从 `cr` 读取 ④**缓存**: cloudreve.js → v1785165000

- **2026-07-28**: 🔧 **fetchModels 超时修复 + 浏览器缓存问题** — ①**根因**: 浏览器缓存旧版 `config.js?v=1785060016`（没有 `tryDirect`），导致代理智能路由未生效, 所有请求都走 Mihomo; 且 `fetchModels` 仅 8s 超时, Mihomo 冷启动/节点切换时易超时, 被 `catch` 静默吞掉（`AbortError` → return）→ 用户看到"模型列表加载不了"但无错误提示 ②**修复**: `fetchModels` 代理场景超时 8s→15s + 自动重试 1 次（仅对 `AbortError`/`abort` 静默重试）; `index.html` 的 `config.js` 版本号 1785060016→1785167200 强制浏览器拉新文件

- **2026-07-27**: 🔧 **代理系统智能路由优化 + OpenCode 移除** — ①**OpenCode 移除**: 调查发现 `api.opencode.ai` 返回 "Hello, world!" 并非 OpenAI 兼容 API (OpenCode 是开源编程 Agent 而非模型提供商), 其 `modelsUrl: null` 硬编码跳过模型列表 + `models.php` 的 `$excludedProviders` 排除 + 默认模型 `gpt-4o` 无效, 整个条目无法工作; 从 core.js/config.js/utils.js/chat/completions.php/models.php 共 7 处移除 ②**代理慢根因**: 代理开启时 `__relay_only__` 哨兵使所有请求绕经 Mihomo (服务器→Mihomo→海外节点→目标), 但国内 API (DeepSeek/智谱/通义等) 服务器直连更快, 不需要 Mihomo 这一跳; 实测 DeepSeek 经 Mihomo ~2s vs 直连 ~0.5s ③**智能路由**: `proxy.php` 新增 `$tryDirect` 标记 + 封锁域名列表 (googleapis/openai/anthropic/x.ai/openrouter/nvidia); 代理开启时非封锁域名直连优先 + 失败回退 Mihomo, 封锁域名直走 Mihomo; 前端 `config.js` relayBody 新增 `tryDirect: enabled` ④**超时安全网**: `CURLOPT_TIMEOUT` 从 `0`(无限) → 流式 900s/非流式 60s; 新增 `CURLOPT_LOW_SPEED_LIMIT/TIME` (120s 无数据→中止死流); `ignore_user_abort(false)` + write 回调检测 `connection_aborted()` 实现前端 AbortController → 服务端 curl 联动中止 ⑤**SSE keepalive**: 流式响应立即发送 `: connected\n\n` 注释刷新响应头, 防止客户端本地代理缓冲 SSE ⑥**流式重试保护**: 直连失败回退 Mihomo 时, 仅当 `$streamDataSent===0` (未发送数据) 才重试, 避免模型重新生成导致内容重复

- **2026-07-27**: 🔧 **停止按钮延迟bug修复 (新请求被误停)** — ①**根因**: 用户点击停止后, `userAbortMap[chatId]=true` 设置, fetch被abort, 但错误从stream传播到catch/finally存在异步延迟; 用户在此期间发送新消息, 新sendMessage创建新AbortController/气泡/isTyping状态; 旧请求的finally块此时才运行, 无条件删除abortControllerMap/activeBubbleMap/isTypingMap, 并调用loadChat()重新渲染, 直接破坏新请求的状态 → 新消息"刚发出去就停了" ②**修复A**: sendMessage开头新增 `delete userAbortMap[chatId]` 清除旧中止标记, 防止新请求的工具调用被旧flag误判为"已停止"而跳过 ③**修复B**: 新增 `window._msgReqGen[chatId]` 递增请求ID, sendMessage捕获 `_myReqGen`, finally块对比当前ID: 若不一致说明新请求已接管, 直接return跳过所有清理 ④**缓存**: main.js → v1785165910, SW v95

- **2026-07-27**: 🔧 **"推入队列"按钮功能修复 (Claude Code 风格, 保留队列栏列表)** — ①**根因**: 原"推入队列"按钮把消息藏在隐藏队列栏, 用户看不到消息进入对话, 且必须等当前回复完全结束才发出 — 不符合 Claude Code 的"消息立即可见、模型当前回复后自然接续"体验 ②**技术约束**: LLM HTTP 流式请求一旦发出, 无法向正在运行的 token 流注入内容, 所以正确做法是把用户消息注入对话历史并立即渲染, 当前流继续跑, 流结束后自动触发新一轮 ③**实现**: `queue.js` 新增 `injectUserMessage()` 函数 — AI 空闲时直接发送; AI 生成时把消息加入 `chats[chatId].messages` (标记 `_injected: true`) 并立即渲染为可见气泡 (带"📨 推入"角标), 不打断当前流; `main.js` 的 `finally` 块检测 `window._hasInjectedMessage` 标记, 流结束后自动调用 `sendMessage(true)` 开启新一轮 (模型会看到推入消息); 用户主动停止时不自动续接 (`userAbortMap` 检测) ④**行为区分**: **点击"推入队列"按钮** = 消息立即注入对话 (不进队列堆栈); **按 Enter 键** = 消息进队列列表, 随堆栈逐一推出 (原始行为) ⑤**渲染**: `rendering.js` 的 `appendMessage()` 新增 `injected` 参数, 为 true 时在气泡右下角添加"📨 推入"角标 + 气泡左侧蓝色边框; `dialogs.js` 的 `loadChat` 重新渲染时保留 `_injected` 标记 ⑥**CSS**: `style.css` 新增 `.msg-injected-badge` (蓝色角标) 和 `.bubble-injected` (左侧蓝色边框) 样式 ⑦**入口**: `index.html` 按钮保持"推入队列"文本 (onclick=`injectUserMessage()`), `init.js` Enter 键处理保持 `pushToMsgQueue()` (进队列堆栈)

- **2026-07-27**: 🔧 **MCP 工具链全面修复** — ①**mmx_* 路由修复**: `api-tools.js` 中 mmx_ 检查排在 ENGINE_MAP 之前，避免 `__mmx` 被路由到 Python 引擎返回 404 ②**web_search 修复**: 原来直接请求 DuckDuckGo 公共 API（超时/弱），改为新建 `api/v1/search.php` 自动读取用户配置的搜索引擎(Tavily/Brave)+API Key ③**generate_pdf 修复**: fpdf2 `add_font` 第二个参数应为 style(`''`/`'B'`)而非家族名，修正后中文 PDF 正常生成 ④**schema 清洗**: `mcp.php` 的 `tools/list` 用 `fixEmptyArrays()` 递归修复 PHP json_decode 把 `{}` 转 `[]` 的问题 ⑤**cr_copy/cr_move**: 确认正常工作（Cloudreve v4 异步时序问题导致测试误判）⑥**image_gen**: 添加别名映射到 execImageGen ⑦**server_file_write_chunked**: `server_tools.py` 缺少 `JSONResponse` 导入，补充后分块写入正常 ⑧**chaoxing_* (13个)**: 原来走 ENGINE_MAP → Python 引擎不存在的路由返回 404，改为 Node.js 层直接调用 PHP chaoxing_api.php ⑨**win_* (7个)**: 原来走 ENGINE_MAP → Python 引擎不存在的路由返回 404，改为 Node.js 层通过 SSH 调用 Windows 端 `win_bridge.py` 脚本（xiang@127.0.0.1），支持 info/processes/kill/start/restart/file/screenshot

- **2026-07-27**: 🔧 **MCP Streamable HTTP 端点 + OAuth 服务器 (OpenClaw 集成)** — ①**根因**: OpenClaw 配置指向 `/oneapichat/v1/mcp` 但该端点不存在;项目真正的 MCP Server 是端口 18788 的自定义 Node.js 服务(非标准 MCP 协议),通过 nginx `/mcp/` 路由 → 标准 MCP 客户端无法连接 ②**MCP 端点**: 新建 `api/v1/mcp.php` 实现标准 MCP Streamable HTTP 协议 (JSON-RPC 2.0: `initialize`/`tools/list`/`tools/call`/`ping`),内部翻译成 Node.js MCP Server 自定义协议 (`POST /mcp/api/tools` + `/mcp/api/tools/call`,bilibili 工具走 `/mcp/bilibili/*`) ③**OAuth 服务器**: OpenClaw 仅支持 `auth: oauth`(不允许 `none`),故新建 `oauth.php` 实现最小化 OAuth — `/.well-known/oauth-authorization-server` 元数据端点 + `/oneapichat/oauth/token`(签发 `oat-*` bearer token) + `/register` + `/authorize` ④**nginx**: 添加 rewrite `^/oneapichat/api/v1/mcp$` → `mcp.php` + OAuth 端点路由 ⑤**OpenClaw 配置**: URL 改为 `https://naujtrats.xyz/oneapichat/api/v1/mcp`, `auth: oauth` ⑥**验证**: 完整 OAuth 流程通过, 142 个工具全部加载成功

- **2026-07-27**: 🔧 **B站工具链修复 + DeepSeek 流式中断修复** — ①**B站 Python 依赖 root 环境缺失**: MCP server (server.js) 以 **root** 运行, spawn Python 子进程时 `HOME=/root`, 找不到 `/home/naujtrats/.local/lib/python3.12/site-packages/` 下的 `bilibili_api`/`aiohttp`/`yt-dlp`/`curl_cffi`。修复: `sudo pip install --break-system-packages` 将依赖安装到 `/usr/local/lib/python3.12/dist-packages/` (系统级) ②**DeepSeek 流式 SSL_ERROR_SYSCALL**: `chat/completions.php` 的 `$needsProxy` 列表只有 Google/OpenAI/Anthropic, **没有 DeepSeek** → 直连 api.deepseek.com → GFW 间歇性重置长连接 → 流式输出中断。修复: 添加 `api.deepseek.com` 到代理域名列表, 并为 `_sendStream` 增加代理失败回退逻辑 (与 `_sendNonStream` 一致)

- **2026-07-27**: 🔧 **代理系统深度修复** — ①**proxyFetch 逻辑修复**: 代理开启时全部走 proxy.php 中继 (不再尝试直连), 代理关闭时才尝试直连+fallback ②**工具定义修复**: 27 个工具的 `properties: {}` 改为 `properties: {"_dummy": {...}}`, 修复 X.ai/Grok 的 schema 验证错误 (`/properties: [] is not of type "object"`) ③**CORS 问题解决**: 代理开启后所有外部 API 请求自动走 `__relay_only__` 模式, 不再出现跨域错误

- **2026-07-27**: 🔧 **代理系统迁移: 阿里云 → WSL2 本地 Mihomo** — ①**原因**: 阿里云 ECS 禁止代理流量, DPI 干扰导致 TLS 握手被 reset, 且存在封号风险 ②**方案**: 在 WSL2 安装 Mihomo (Clash Meta 内核), 订阅同一机场, 自动选择可用节点 ③**集成**: 修改 `proxy.php` 和 `fetch.php`, 未传 proxy 参数时自动走本地 Mihomo (`socks5h://127.0.0.1:1081`) ④**前端**: `proxyFetch` 不再传 proxy 参数, 由服务端自动代理 ⑤**systemd**: Mihomo 注册为系统服务, 开机自启 ⑥**端口**: Mihomo HTTP=1080, SOCKS5=1081, 外部控制器=9090 ⑦**验证**: OpenAI=401, Anthropic=403, X.ai=401, Google=400 (全部连通)

- **2026-07-26**: 🔧 **百度网盘扫码登录单会话浏览器方案 (第5轮)** — ①**最终根因**: 浏览器页面加载时会**自己调用 getqrcode 获取新 sign**, 所以 `generate_qrcode()` API 返回的 sign 和浏览器页面生成的 sign **完全不同** → 即使用 requests 轮询正确的 channel/unicast, 检测到的也是错误的 sign → 永远匹配不上 ②**正确方案**: 单会话浏览器 — `qr` 启动后台进程打开浏览器 → 从**页面提取 QR**(浏览器正在等待的那个) → 后台进程持续监测页面跳转/BDUSS cookie → `poll` 读取状态文件 ③**实现** (`baidu-login.py`): `generate_qrcode()` → nohup 启动 `_run_background_poll()` 独立进程 → 打开浏览器 → 提取页面 QR 写入 `.baidu_qr_base64.txt` → 等待页面跳转 → 保存 Cookie; `poll_login()` → 读取 `.baidu_login_state.json` 返回状态 ④**关键发现**: 页面自动通过 `channel/unicast` 长轮询(每~30s, errno=1=未扫)检测扫码, 扫码后页面自动跳转 pan.baidu.com 并设置 BDUSS cookie ⑤**验证**: 端到端通过 — `qr` 返回 QR(8466 chars) + 后台进程启动 → `poll` 返回 "等待扫码中..."

- **2026-07-26**: 🔧 **百度网盘扫码登录轮询根本修复 (第4轮)** — ①**真正的根因**: `poll_login()` 接收了 `sign` 参数但完全没使用 — 它用 Playwright 打开**全新**浏览器访问登录页, 页面生成**自己的**QR码(sign=B), 但用户扫描的是 `generate_qrcode()` 返回的QR码(sign=A) → 两个sign完全不匹配 → 永远检测不到扫码 → 180s超时 ②**正确的百度QR登录流程**: `getqrcode` 获取 sign → 用户扫码 → 服务端标记sign已认证 → 客户端通过 `https://passport.baidu.com/channel/unicast?channel_id={sign}` **长轮询**检测(errno:1=未扫, errno:0+channel_v.status:0=已扫, 返回bduss+u) → 用 Playwright 完成登录获取完整Cookie ③**修复** (`baidu-login.py`): 重写 `poll_login()` 为混合方案 — Phase 1 用 `requests` 长轮询 `channel/unicast` 检测扫码(每轮~30s服务端hold), Phase 2 检测到后用 Playwright `_complete_qr_login()` 跳转+提取Cookie; 新增 `_complete_qr_login()` 函数 ④**URL修正**: 正确的轮询URL是 `/channel/unicast` 不是 `/v2/api/channel/unicast` (后者返回405) ⑤**PHP超时修复** (`engine_api.php`): `mcp_proxy` 超时从120s→300s(poll类工具), 防止PHP在poll完成前断开 ⑥**验证**: 7轮轮询全部正确返回errno=1(未扫码), 180s后正确返回timeout; 扫码后errno=0触发Phase 2

- **2026-07-26**: 🔧 **百度网盘扫码登录轮询修复** — ①**根因**: `poll_login` 用Playwright打开**全新**浏览器访问登录页, 等待跳转到pan.baidu.com → 新浏览器没有与QR码sign关联的session/cookie → 永远检测不到扫码 → 轮询卡死超时 ②**正确的百度QR登录流程**: getqrcode获取sign → 用户用百度APP扫码 → 服务端标记sign已认证 → 客户端通过 `channel/unicast?channel_id={sign}` **长轮询**检测 (errno:1=未扫, errno:0+channel_v.status:0=已扫) → 拿到bduss+redirect_u → 调用 `/v3/login/main/qrbdusslogin` 完成认证+获取authsid → 跟随跳转获取最终Cookie ③**修复** (`baidu-login.py`): 重写 `poll_login()` 用requests长轮询 `channel/unicast` API替代Playwright; 新增 `_complete_qr_login()` 完成qrbdusslogin+获取Cookie; 调试输出改走stderr避免污染stdout JSON ④**超时**: MCP server poll动作超时从180s→300s (`api-tools.js`) ⑤**验证**: 长轮询API工作正常(errno:1循环等待, 扫码后errno:0触发认证)
- **2026-07-26**: 🔧 **百度网盘Cookie无效修复 (api_error_2)** — ①**根因**: `poll_login` 创建全新 `requests.Session()` 没有先调用 `getqrcode` 建立基础Cookie (BAIDUID等) → 后续 `qrbdusslogin` 调用和跳转无法正确设置最终Cookie → 保存的BDUSS无效 → `pan.baidu.com/api/loginStatus` 返回 `errno:2` (参数错误) ②**修复** (`baidu-login.py`): `poll_login()` 开头先调用 `getqrcode` 建立session获取BAIDUID; cookie保存列表新增 `PTOKEN/PANPSC/UBI`; 必须BDUSS存在才判定成功 ③**验证**: session建立后正确获取 `['BAIDUID', 'BAIDUID_BFESS']`, 长轮询每轮~30s (真sign时服务端hold连接)
- **2026-07-26**: 🔧 **百度网盘Cookie路径不匹配修复 (api_error_2 持续)** — ①**根因**: `netdisk_parser.py` 的 `COOKIE_DIR` 指向 `/var/www/html/oneapichat/mcp-server/netdisk-login/`, 但 `baidu-login.py` 的 `COOKIE_FILE` 指向 `/home/naujtrats/mcp-server/netdisk-login/.baidu_cookie` → 两个路径完全不同 → 解析器找不到Cookie文件 → 永远提示"需要登录" ②**修复** (`netdisk_parser.py`): `COOKIE_DIR` 改为优先使用绝对路径 `/home/naujtrats/mcp-server/netdisk-login`, 回退到相对路径 ③**验证**: `load_cookie('baidu')` 正确返回 857 字符的Cookie字符串
- **2026-07-26**: 🔧 **百度网盘登录方案重构 (Playwright替代requests)** — ①**根因**: `requests` 库无法正确处理百度跨域Cookie设置 (部分Cookie通过JS设置), 且 `channel/unicast` 返回的 `bduss` 签名在长轮询等待期间过期 (`errInfo.no=310005`) ②**修复** (`baidu-login.py`): 重写 `poll_login()` 用 Playwright 浏览器打开登录页, 页面自动处理QR码生成+轮询+跨域跳转+Cookie设置; 从浏览器提取最终Cookie (包括JS设置的); 同时提取页面QR码返回给前端显示 ③**验证**: Playwright 正确提取QR码图片(base64)和sign, 获取初始Cookie包含 BAIDUID 等 13 个key

- **2026-07-26**: 🔧 **网盘登录QR码不可见修复** — ①**根因**: `netdisk_login` 的QR码仅通过弹窗(`#qr-popup-overlay`)显示, 弹窗可被意外关闭/遮挡/移动端看不到 → 用户"看不到独立二维码" ②**对比**: `bilibili_qr_login` 和 `chaoxing_qr_login` 都使用独立消息行(`data-qr-login`属性)注入聊天, QR码持久可见 ③**修复** (`tools-exec.js:1599`): 新增方式1 — 独立QR行注入聊天消息容器(`#chat-messages`), 包含标题+说明+QR图+提示, 持久可见不可关闭; 保留方式2弹窗作为辅助提醒; 登录成功时隐藏弹窗+更新QR行为✅成功状态 ④**清理逻辑**: 注入前移除旧`[data-qr-login]`行+清理气泡内残留QR图(防重复) ⑤**持久化**: `pendingMsg._hasQrRow=true` 标记 ⑥**缓存**: tools-exec.js → v1785060017

- **2026-07-26**: 🔧 **通用文件上传修复 (.msi/.exe/.zip等二进制文件)** — ①**根因**: 用户上传 `.msi` 文件(Cloudflare WARP)无法上传到Cloudreve — 前端 `files.js` 用 `file.type.startsWith('image/'/'video/')` 判断类型, `.msi` 的 MIME(`application/x-msi`)不匹配 → 走 `extractFileContent()` 文本解析分支而非上传; 后端 `upload.php` 的 `$allowedExts` 仅含图片/视频, `.msi` 被强制改扩展名为 `png`, 且 MIME 验证只接受 `image/*`/`video/*` → 400 错误 → 文件根本不在服务器上 → `cr_upload_file` 找不到文件 ②**真正的缓存根因**: nginx 对 `.js` 文件设置 `Cache-Control: immutable, max-age=604800`(7天) → 浏览器从 disk cache 加载旧版 JS, 新代码根本不运行 ③**前端修复** (`files.js`): 新增二进制文件检测 — 非可解析扩展名(非 txt/docx/xlsx/pdf/...)且非 `text/` MIME 的文件标记 `isBinary=true`, 直接调用 `uploadVideoBlob(file, progress, true)` 上传到服务器, 保留 `serverPath` 供 `cr_upload_file` 使用 ④**前端修复** (`upload.js`): `uploadVideoBlob` 新增第3参数 `isBinary`, 为 true 时 URL 添加 `&target=generic` ⑤**后端修复** (`upload.php`): 新增 `target=generic` 模式 — 跳过图片/MIME验证, 保留原始扩展名, 仅禁止 Web 可执行脚本(php/cgi/pl/pyz), 文件名前缀从 `img_` 改为 `file_` ⑥**消息注入** (`utils.js`): `buildUserContent` 对 `isBinary` 文件跳过 content 附加(避免浪费 token), 但仍注入 serverPath+cr_upload_file 提示 ⑦**nginx 缓存修复**: `/oneapichat/js/` 路径下的 JS 缓存从 7天 immutable 改为 5分钟 must-revalidate; 其他 JS/CSS 从 7天改为 1小时 ⑧**缓存版本**: files.js/upload.js/utils.js → v178515000x, SW v78

- **2026-07-25**: 🔧 **Skill系统整合优化 (注意力修复)** — ①**合并重叠skill**: 删除 bilibili-content-discovery (合并到 video-hunter, 新增 bilibili_user_profile/comment_list/qr_login), 删除 web-research 和 document-authoring (合并到 deep-search v3.0, 新增 generate_ppt/xlsx + 调研→文档管线) ②**修复trigger冲突**: cloud-file-manager 的 triggers 去掉"网盘"/"文件管理"/"上传"/"下载"等大词, 改为 "Cloudreve"/"我的云盘"/"云空间"等精确词; netdisk-parser 独占"网盘"触发 ③**修复YAML解析器**: `skills_api.php` 的 `parseSkillFile()` 重写支持3层嵌套 (metadata.oneapichat.tools/emoji/triggers), 修复了一直存在的 tools/emoji 返回空数组 bug ④**减少prompt膨胀**: `getSkillsSystemPrompt()` 改为精简模式 (只显示技能名+描述+工具数量, 不列出全部工具名), `getMatchedSkillsPrompt()` 只注入TOP3匹配技能 (原全部注入) ⑤**结果**: skill从14→11个, 系统prompt减少~40%, 模型注意力更集中, 不再遗漏B站下载等核心工具

- **2026-07-25**: 🔧 **视频猎手工具链全链路修复** — ①**根因**: video-hunter的15个工具(video_*/bili_*)只在toolRegistry注册(用于UI面板), 但未注入API的tools数组 → 模型看不到这些工具 → "我没有下载B站视频的工具" ②**修复**: `tools.js` 新增 `VIDEO_HUNTER_TOOLS` 数组(15个工具定义), `main.js` 注入API, `tools-exec.js` 新增dispatch调用 `_mcpExecute()`, `engine_api.php` 新增 `video_hunter`/`bilibili_bridge` 代理路由到MCP Server ③**结果**: B站下载(bili_download)、BT磁力(video_download)、DASH流(bili_streams)等15个工具全链路打通

- **2026-07-25**: 🔧 **IIFE作用域bug修复 (第3轮)** — ①**根因**: `VIDEO_HUNTER_TOOLS` 被定义在 `_registerAllTools` IIFE内部 → IIFE结束后变量不可见 → 多次尝试修复: 第一次移到IIFE外部但用 `const` → `const` 不跨脚本共享; 第二次用 `window.` 前缀但改回 `const` → 最终确认必须用 `window.VIDEO_HUNTER_TOOLS = [...]` ②**修复**: `VIDEO_HUNTER_TOOLS`/`NETDISK_TOOLS`/`AMAP_MAPS_TOOLS` 全部改用 `window.` 前缀, 从IIFE内部移到外部 ③**web_fetch修复**: 移除 `_webFetchUrls` 字段(列表类型导致LongCat API报 'list object has no attribute items' 500错误) ④**缓存刷新**: SW v75, JS版本号全部更新

- **2026-07-25**: 🔧 **B站下载Cookie修复** — ①**根因**: `bilibili-download-bridge.py` 的 yt-dlp 使用 `--cookies-from-browser chrome` 读取服务器Chrome Cookie, 但服务器是无头环境没有Chrome; 实际Cookie存在 `.bili_cookie` 文件中(SESSDATA) ②**修复**: 新增 `_get_bili_cookie_file()` 函数从 `.bili_cookie` 读取SESSDATA并生成Netscape Cookie文件格式, 传给 yt-dlp 的 `--cookies` 参数; 同时修复 `get_streams()` 和 `get_video_info()` 传递 Credential 给 bilibili-api-python 以获取高画质流 ③**结果**: 带Cookie后 yt-dlp 能获取4K 60帧HDR流(ID=125, hvc1.2.4.L153.90), bilibili-api-python 能获取19个视频流(之前只有6个)

- **2026-07-25**: 🔧 **yt-dlp下载卡住修复** — ①**根因**: yt-dlp 下载B站视频时卡在 "Downloading webpage", 原因是B站反爬机制和缺少必要参数 ②**修复**: 新增 `--extractor-args bilibili:skip_hdr=true`, `--socket-timeout 30`, `--retries 3`, `--no-playlist` 等反爬参数; 新增 `bili_download_dash` 工具使用 bilibili-api-python + aiohttp 直接下载DASH流(绕过yt-dlp的网页解析); yt-dlp worker 增加30分钟超时和ffmpeg合并进度标记 ③**结果**: yt-dlp 能正常解析B站视频(包括4K HDR格式), DASH下载方案更可靠(直接下载, 无需网页解析)

- **2026-07-25**: 🔧 **DASH下载daemon线程被杀修复** — ①**根因**: `download_dash` 用 daemon 线程在后台下载, 但 MCP server 的 `exec()` 调用完成后 Python 进程退出, daemon 线程也被杀死 → 下载进度永远为0% ②**修复**: 新建独立脚本 `dash-downloader.py`, 用 `subprocess.Popen(start_new_session=True)` 启动独立进程下载, 不受父进程退出影响; `bili_download` 默认使用 DASH 方案(从URL提取bvid), 回退到 yt-dlp ③**aria2进度正则修复**: 支持多种 aria2 输出格式 `[#57a486 2.9GiB/3.0GiB(95%) CN:8 DL:44MiB ETA:2s]` ④**结果**: 4K HDR 视频(3.3GB) 成功下载, 总耗时约100秒

- **2026-07-25**: 🔧 **apply_chat_template 'list object' 根因修复** — ①**根因**: LongCat 后端 apply_chat_template 不支持 `reasoning_content`/`reasoning_details` 等非标准字段, 迭代消息时遇到未知字段会尝试调用 `.items()` 导致 `'list object' has no attribute 'items'` 错误 (通过 `[SEND-DIAG-FULL]` 诊断日志确认 content 全部为字符串, 真正原因是 assistant 消息上的 `reasoning_content` 字段) ②**来源**: 两处设置点 — `api-messages.js:318 buildApiMessages()` (历史消息) + `main.js:2497` 工具调用重试路径的 `[RS-TOOLS] rebuild` (当前 assistant 消息) ③**修复**: 两处都加了 LongCat 检测跳过设置, 且 `main.js` 发送前终极防护循环无条件删除 LongCat 消息的所有非标准字段 ④**缓存**: main.js/api-messages.js → v1785060012, SW v77
- **2026-07-25**: 🔧 **web_fetch LongCat 数组参数修复** — ①**根因**: LongCat 等模型调用 web_fetch 时将 URL 数组直接作为 arguments 传入(而非包装在 `{urls:[...]}` 中), 原代码只检查 `args.urls`/`args.url`, 导致 `args` 本身是数组时走到 "Missing urls parameter" 错误 ②**修复**: `tools-exec.js` web_fetch handler 新增 `Array.isArray(args)` 分支, 直接提取数组中的字符串 URL ③**缓存**: main.js/tools-exec.js → v1785060010
- **2026-07-25**: 🔧 **DeepSeek max_tokens 400 修复** — ①**AutoAdjust 正则修复**: `main.js` 的 `maxTokensMatch` 解析 `[min, max]` 范围时原代码取 `match[1]`(=min=1) 导致 `max_tokens` 被错误砍到 1, 改为取 `match[2]`(=max=131072) ②**模型配置修复**: `models.js` 的 `deepseek-v4-pro`/`deepseek-v4-flash`/`deepseek-reasoner` 三个模型 `maxOutputTokens` 从 1000000 改为 131072 (DeepSeek API 实际上限), 使 ModelCap 在发送前就拦截超限值 ③**根因**: 用户 maxTokens=398592 超过 DeepSeek 上限 131072 → API 返回 400 "max_tokens must be in range [1, 131072]" → AutoAdjust 误取 min 边界设为 1 → 重试后模型几乎无输出 ④**缓存刷新**: main.js/models.js/utils.js → v1784999999, SW v71
- **2026-07-25**: 📂 **网盘解析 MCP 工具集成** — ①**后端代理**: 新建 `api/netdisk_api.php` 统一解析主流网盘链接 (`parse`/`download`/`parse_and_download`/`download_status`/`config` 5个action), 支持百度网盘/夸克网盘/阿里云盘/天翼云盘/迅雷网盘/移动网盘/UC网盘/123网盘/蓝奏云9种网盘 ②**Python引擎**: 新建 `python/netdisk/netdisk_parser.py` 通用解析器, 蓝奏云直链提取(iframe+sign+ajaxm.php)/百度网盘API/夸克API/天翼云API四种解析策略, 含 netdisk-fast-download 回退 ③**MCP注册**: `api-tools.js` EXTRA_TOOLS新增4个工具(`netdisk_parse`/`netdisk_download`/`netdisk_parse_and_download`/`netdisk_status`), ENGINE_MAP新增 `__netdisk/` 映射, execTool新增 `netdisk_` 前缀handler, execEngineProxy新增 `__netdisk/` 代理分支 ④**前端工具**: `tools.js` 新增 NETDISK_TOOLS数组(4个工具定义) + _TOOL_LABELS中文标签 + _TOOL_CATEGORIES'📂 网盘解析'分类, `tools-exec.js` 新增4个dispatch分支调用 `netdiskApiHandler()`, `main.js` 工具注入列表新增 NETDISK_TOOLS ⑤**前端处理器**: 新建 `public/js/netdisk.js` 提供 `netdiskApiHandler()` 统一调用PHP后端, `index.html` 引入脚本 ⑥**Skill**: `skills/netdisk-parser/SKILL.md` 新建, 包含9种网盘支持表+工作流+参数说明, 自动被 skills_api.php 发现并注入到配置栏 ⑦**aria2多线程下载**: 下载使用aria2c 16线程(可配1-32), 文件存入 `uploads/downloads/` 目录

- **2026-07-25**: 🔑 **网盘扫码登录功能** — ①**登录脚本**: 新建 `netdisk-login/baidu-login.py`(百度网盘扫码登录获取BDUSS/STOKEN), `netdisk-login/quark-login.py`(夸克网盘扫码登录获取__pus/__pucc), `netdisk-login/aliyun-login.py`(阿里云盘扫码登录获取refresh_token), `netdisk-login/netdisk-login-handler.py`(统一登录管理器) ②**MCP工具**: 新增 `netdisk_login` 工具(action=check/qr/poll, service=baidu/quark/aliyun), ENGINE_MAP新增 `__netdisk/login` 映射, execNetdiskTool路由到Python登录处理器 ③**前端工具**: `tools.js` 新增 NETDISK_LOGIN_TOOLS数组(1个工具定义) + _TOOL_LABELS'🔑 网盘登录'标签 + _TOOL_CATEGORIES'🔑 网盘登录'分类, `tools-exec.js` 新增dispatch分支调用 `_mcpExecute()`, `main.js` 工具注入列表新增 NETDISK_LOGIN_TOOLS ④**Cookie共享**: `netdisk_parser.py` 新增 `load_cookie()` 函数从 `.baidu_cookie`/`.quark_cookie`/`.aliyun_token` 读取Cookie, `parse_baidu()`/`parse_quark()` 自动使用Cookie认证 ⑤**Skill更新**: `skills/netdisk-parser/SKILL.md` 新增扫码登录工作流章节 ⑥**工具总数**: 从4个增加到5个(新增netdisk_login), 分类从1个增加到2个(📂网盘解析 + 🔑网盘登录) ⑦**修复**: execNetdiskTool中login动作改用spawn+stdin传递JSON(避免shell转义错误), 登录处理器从args中读取实际action, 百度API修复为纯JSON解析

- **2026-07-23**: 🗺️ **高德地图 Skills 集成 (ClawHub @lbs-amap)** — ①**来源**: 从 clawhub.ai 找到高德官方账号 @lbs-amap (GaodeMapOfficial) 发布的 `personal-map` Skill (clawhub.ai/lbs-amap/skills/personal-map), 使用提供的 ClawHub Token (clh_7gkr9Qrc...) 通过 `/api/v1/packages/personal-map/file?path=scripts/amap_personal_map_client.py` 获取完整 687 行 Python 源码 ②**自动生成 14 个工具**: `amap_geo`(地理编码), `amap_regeocode`(逆地理编码), `amap_text_search`(POI搜索), `amap_around_search`(周边搜索), `amap_search_detail`(POI详情), `amap_direction_walking`(步行路线), `amap_direction_driving`(驾车路线), `amap_direction_bicycling`(骑行路线), `amap_direction_transit`(公交路线), `amap_distance`(距离测量), `amap_ip_location`(IP定位), `amap_weather`(天气), `amap_district`(行政区划), `amap_schema_personal_map`(个人地图二维码) ③**后端代理**: 新建 `api/amap_api.php` 统一调用高德 REST API (`https://restapi.amap.com/v3/...`), 支持 14 个 action + config 检查, 通过 `amap_key` 参数或 localStorage `amapKey` 或 `config/amap_config.php` 获取 API Key ④**MCP 集成**: 在 `~/mcp-server/api-tools.js` 的 EXTRA_TOOLS 中注册 14 个工具定义, ENGINE_MAP 新增 `__amap/` 前缀映射, execEngineProxy 新增 `__amap/` 代理分支, execTool 新增 `amap_` 前缀 handler → MCP Server 从 75 → 89 个工具, Claude Code 可直接调用 ⑤**API Key**: 已配置 `config/amap_config.php` (服务器默认 Key: da357025...), 获取地址: https://lbs.amap.com/api/webservice/create-project-and-key

- **2026-07-23**: 🔧 **MCP 工具全量转移 + 星穹铁道清理** — ①**缺失工具转移**: 将前端有但 MCP 没有的 42 个工具全部注册到 `api-tools.js` (超星学习通 12个、引擎/Agent 9个、Windows 7个、星穹铁道 11个、其他 3个) — 含 EXTRA_TOOLS 定义 + ENGINE_MAP 映射 + `execAmapTool()` 函数 ②**星穹铁道清理**: 移除 SRC_TOOLS 数组(11个工具)、`src-manager.js` 引用、`tools-exec.js` 派遣分支、`main.js` 常量定义、`_TOOL_LABELS` 标签; 前端入口按钮从"SRC 星穹铁道"改为"Cloudreve 云盘"(☁️图标) ③**结果**: MCP Server 从 89 → 120 个工具, 星穹铁道前端入口全部移除

- **2026-07-23**: 🔧 可恢复式流式传输(RS)全链路修复(第二轮) — ①**真正的刷新后工具续接根因**: 发现 `init.js` Phase 3 (:_autoRecover) 检测到孤立tool_calls后的恢复动作是错误的 — 原代码调用 `sendMessage(true, userText)` 重建 `[user, assistant(tool_calls)]`(无tool results跟随)→ API返回400 "tool_calls must be followed by tool messages"。修复: 新增 `_executeOrphanedToolCalls(chatId, asstIdx)` 在续接前先执行缺结果的tool_calls并追加到历史,使序列变为 `[user, assistant(tool_calls), tool_result1, ...]`(有效),再交 `sendMessage(true)` 续接 ②**双通道工具续接**: `resume-stream.js` 新增 `_resumeToolHandoff()` 处理"恢复的活跃流返回tool_calls"场景(任务status=running); `init.js` 新增 `_executeOrphanedToolCalls()` 处理"流已完成但工具未执行"场景(status=completed,孤立tool_calls在历史中)。两通道均复用 `window.executeToolCallForRetry` ③**LongCat IndexError修复**: `engine_server.py` 的 `_generate_resumable`(:2481)和 `_stream_openai_to_sse`(:2123)两处 `chunk.choices[0]` 访问前新增空数组守卫,跳过仅含usage的空choices块但继续捕获usage ④**Anthropic格式RS支持**: 引擎新增 `_generate_resumable_anthropic()` 用 `requests` 直调Anthropic Messages API(`stream=True`),前端 `ResumeStream.create` 传递 `anthropic_format`+`anthropic_url`,main.js 移除 `_useRS` 的 `!_useAnthropicFormat` 排除项 ⑤**设计**: 引擎分支点位于 `_generate_resumable` 顶部(`if anthropic_format`),OpenAI路径零改动; Anthropic认证原生用 `x-api-key`+`anthropic-version`,其他(LongCat/DeepSeek)用 `Bearer`; `_recoverActiveTasks` 仅找status=running任务,孤立tool_calls由init.js Phase 3兜底

- **2026-07-22**: 🐱 **LongCat.Chat 提供商集成** — ①**core.js**: `API_PROVIDERS` 新增 `longcat` 条目(baseUrl `https://api.longcat.chat/openai/v1`) ②**config.js**: `fetchModels` 支持提供商自定义 `modelsUrl`; `proxyFetch` 对 `api.longcat.chat` 跳过直连(不支持CORS)走中继 ③**utils.js**: `PROVIDER_DEFAULT_MODELS` 新增 `longcat: 'gpt-4o'` ④**main.js**: `_supportsAnthropic` 新增 `api.longcat.chat` 检测; Anthropic URL构建新增LongCat分支(替换`/openai/v1`→`/anthropic/v1/messages`) ⑤**API v1**: `chat/completions.php` `$providers` 新增 LongCat; `models.php` `$providers`+`$providerKeyMap` 新增 LongCat ⑥**注意**: LongCat `/v1/models`返回404,正确端点为`/openai/v1/models`; API不支持CORS需走proxy.php中继
- **2026-07-22**: 🧠 **记忆系统 v2 方案B重构 (Phase 1-3 完成)** — ①**SQLite+chromadb引擎**: 新建 `memory_db.py`(SQLite FTS5+事实/情节/人格CRUD), `memory_engine.py`(chromadb+fastembed本地嵌入+向量/BM25/图谱混合搜索RRF融合), `memory_endpoints.py`(18个FastAPI端点), `personality.py`(8种预设+四层宪法/叙事/缓存/状态架构) ②**PHP代理**: `engine_api.php` 新增20个记忆/人格代理路由 ③**混合搜索**: 向量×0.4+BM25×0.3+实体图谱×0.2+重要性×0.05+30天半衰期时间衰减×0.05 ④**模型**: chromadb默认all-MiniLM-L6-v2(384维), 通过HF镜像+代理下载, 首次启动~6秒 ⑤**数据迁移**: `memory_migration.py` idempotent从PHP JSON+引擎JSON迁移到新SQLite ⑥**设计**: 旧双系统(PHP memory_api.php+Python agent_memory.py)保留兼容, 新端点 `/engine/memory/*` `/engine/personality/*` 并行运行 — ①**工具扩展**: `agent_roles.py` ALL_TOOLS_DEF从18→35个工具,新增server_file_search/grep/edit/op, get_current_time, bilibili_search/video_info, generate_image/ppt, cr_* (4个Cloudreve), mmx_chat/image/speech/vision; 5个角色工具集同步更新(explorer+5,planner+1,developer+12,verifier+3,general+20) ②**MCP转发**: `engine_server.py` `_execute_tool` 未知工具转发从死代码(agent/heartbeat)→PHP MCP Proxy(`engine_api.php?action=mcp_proxy`), 覆盖bilibili_*/cr_*/src_*/mmx_*/generate_*/chaoxing_*/win_*七类前缀 ③**Skill自动注入**: `engine_server.py` agent_run 启动前加载用户skills列表, 注入到子代理system prompt的"可用技能"章节 ④**P1上下文注入**: 子代理system prompt自动注入用户人格(agent_persona.json)+最近5条记忆(agent_memory.json)+CLAUDE.md项目上下文(前2000字符), 所有加载失败优雅降级 ⑤**P1进度广播**: `engine_server.py` `_run()` 工具执行后广播 `agent:step` SSE事件(agent/tool/step/max_steps/result_preview), `agent-notify.js` 新增监听器更新 `task.agents[name]._lastTool/_step/_maxSteps`
- **2026-07-22**: 🔧 P0子代理内容接入优化 — ①**结构化输出**: `engine_server.py` `_run()` 循环结束后额外调用一次API(无tools), `response_format: json_schema` 整理结果为结构化JSON (summary/findings/actions_taken/errors/raw_output), `model_tier=="cheap"` 跳过,失败优雅降级;结果存入 `agents.json` 的 `_structured` 字段 ②**SSE即时通知**: `engine_server.py` 新增 `agent:result` SSE广播(携带完整结果+结构化数据), `agent-notify.js` 新增 `agent:result` 监听器直接推送到Task系统, 轮询间隔 15s→30s 降级为后备, SSE断开时标记 `_sseDisconnected` ③**结构化上下文注入**: `agent.js` 新增 `pushAgentResultToTaskWithStructured`(SSE直接调用), `_triggerMainAgentForTask` 检测 `_structured` 字段格式化Markdown(摘要+置信度图标发现+操作+错误), 无结构化数据时保留旧纯文本格式, `triggerAgentAutoReplyForSubAgent` 传递 `_structured` 字段 ④**设计**: 双通道架构(结构化调用独立API), `result`字段不变, `_structured` 新增可选, 完全向后兼容
- **2026-07-22**: 🔧 Cloudreve v2.6.3 免登录+智能路径+Skill — ①**cr_check_login 新增**: `cloudreve_api.php` 新增 `check_login` action, 自动检测缓存的token是否有效, 返回登录状态和用户信息; 新对话不再需要每次重新登录 ②**upload_file 相对路径**: 支持 `file_path=uploads/user_xxx/img.mp4` 简写, 自动解析为绝对路径; 模型不再需要用 `server_file_search` (find / → 超时) 找文件 ③**cloudreve-upload Skill**: `.claude/skills/cloudreve-upload/SKILL.md` 新建, 指导模型: 先check_login不重复登录 → 直接在uploads目录找文件(不用find/) → 相对路径上传 → 自动分片; 包含完整示例和故障排除表 ④**MCP工具更新**: cr_login描述标注"优先用cr_check_login", cr_upload_file描述标注支持相对路径 ⑤**前端工具面板修复**: `tools.js` CLOUDREVE_TOOLS从14→18个(新增cr_check_login/cr_upload_file/cr_register/cr_upload), cr_create_folder改用path参数, CN_LABELS补全 ⑥**upload.js返回server路径**: uploadVideoBlob现在返回{url,path,size,type}对象, files.js存储serverPath字段, utils.js buildUserContent将真实服务器路径注入消息 — 模型直接收到文件路径无需搜索 ⑦**tools-exec.js 派遣补全**: 新增cr_check_login/cr_upload_file/cr_register/cr_upload四个工具的执行派遣分支, 修复"Unknown tool"错误
- **2026-07-22**: 🔧 Cloudreve v2.6.2 上传修复+参数兼容 — ①**cr_upload_file 新增**: `cloudreve_api.php` 新增 `upload_file` action, 接受 `file_path`(服务器文件路径)+`cloudreve_path`(目标目录), 通过Cloudreve两步上传API(PUT创建会话+POST分片上传)支持任意二进制文件上传(视频/图片/文档), 自动按Cloudreve返回的chunk_size(25MB)分片, 测试5MB秒传+92MB分4片2秒完成 ②**cr_create_folder 参数兼容**: PHP新增 `path→parent+name` 自动解析(支持 `视频备份` 和 `apitest/子目录` 两种格式), 解决MCP工具定义只有`path`参数但PHP期望`parent`+`name`分离参数导致的"请输入文件夹名称"错误 ③**MCP cr_upload_file 注册**: `api-tools.js` 新增工具定义+路由映射(`__cr/upload_file`), ENGINE_MAP注册, MCP server重启生效 ④**cr_upload 说明更新**: 标注仅支持文本内容(URL长度限制), 大文件引导使用 cr_upload_file
- **2026-07-22**: 🔧 Cloudreve v2.6 稳定性修复 — ①**cr_create_folder 同步验证修复**: `cr_wait_path()` 新增 Phase 2 父目录回退 — 精确URI轮询失败后列父目录查找目标名, 解决Cloudreve v4异步存储导致文件夹创建后轮询永远找不到的问题(原12次retry全部失败→现在parent_list回退3次确认) ②**Token回退改进**: `cr_getAccessToken()` fallback从仅取最新一个登录文件改为遍历所有`/tmp/cloudreve_login_*.json`逐个尝试, 解决MCP调用(userId为空)时缓存token过期/错误用户导致"无法获取token"的问题 ③**工具调用孤过滤竞态修复**: `api-messages.js` `buildApiMessages()` 跳过最后一轮assistant的orphan tool_call过滤, 防止工具结果未到达时tool_calls被过早删除导致级联失败 — 模型反复"工具调用未正确发送"的根因 ④14个工具中13个完全正常,仅`cr_create_folder`异步同步为Cloudreve 4.16存储策略机制限制
- **2026-07-22**: 🔧 v2.6.1 修复 — ①**可恢复流默认关闭**: RS对工具调用支持差(结果无法回传→死循环), `config.js`/`main.js`两处改为 `=== '1'` 才启用(原 `!== '0'` 默认开) ②**localStorage→DB**: `dialogs.js` `slimSaveChats()` 重写, 数据>3.5MB时本地仅存元数据索引(~50KB), 全量走服务器; 不再裁剪旧聊天 ③**流式光标**: `init.js` 细线品牌色渐变呼吸动画替代方块硬闪 ④**缓存刷新**: core/config/dialogs/init/storage/api-messages/main.js → v1784691685, SW v67
- **2026-07-21**: 🔧 Cloudreve v4 MCP 工具集修复 — ①**P0认证绕过**: `cloudreve_api.php` 新增 `$isMcpCall` 检查, `auth_token=cr_shared` 的MCP代理调用直接放行(原 `preg_replace` 清洗会破坏token导致所有操作返回"未认证") ②**P1 Copy端点**: `/file/copy`→`/file/move`+`copy:true`, 匹配v4 API(v4无独立copy端点) ③**P2 Download URL**: `/file/download`→`/file/url`, 匹配v4签名URL生成端点 ④**P4参数映射**: `delete` 接受 `path`(单数) 作为 `paths` 的fallback, 与MCP工具定义一致 ⑤全工具测试通过: ping/login/user_info/list_files/search_files/create_folder/storage_info/overview/list_shares/create_share/delete_share/download_url
- **2026-07-20**: 🖥️ Windows桌面客户端(瘦客户端+GitHub Release) — ①**架构**: Electron壳→HTTPS加载远程服务器页面(https://naujtrats.xyz/oneapichat/), 服务器零改动(PHP/Python/Node.js不变), 客户端仅打包electron_main.js+preload.js+图标, 安装包~80MB ②**首次启动**: 服务器地址配置对话框(默认地址/自定义URL), 保存到`%APPDATA%/OneAPIChat/client-config.json` ③**桌面特性**: 系统托盘(双击恢复/菜单切换服务器/退出), 外部链接→系统默认浏览器, `文件→切换服务器`菜单, 窗口标题自动同步页面title ④**preload.js**: contextBridge注入`window.desktopAPI`(isElectron/serverUrl/openExternal/showNotification/requestNotificationPermission/IPC通信) ⑤**构建发布**: `deploy/package.json` v2.5.0(最小打包files仅electron_main+preload+icon); `.github/workflows/release.yml`推送tag自动构建Windows NSIS安装包+Linux AppImage上传GitHub Release ⑥**backend-manager.js保留**: 为未来本地后端模式预留
- **2026-07-20**: 🕐 时间感知增强(全链路) — ①**get_current_time MCP工具**: 新增内置工具返回datetime/date/time/weekday/timezone/iso/unix_ms/period, 模型按需调用不破坏系统prompt缓存; tools.js注册A类+tools-exec.js dispatch分支 ②**关键词注入升级**: `createTemporaryTimestampIfNeeded` 3层→4层: Tier1精确时间/Tier2事件感知(赛事/NBA等)/Tier3时段感知(上午/晚上等)/Tier4日期感知(24h缓存友好); `_makeTimeStr()`消除重复 ③**Skills升级**: 6个技能新增「⏰ 时间感知策略」章节, 强制搜索前获取时间+关键词含年份/月份+时效性4级标注+过时信息主动告知 (deep-search/web-research/game-redemption-codes/content-creation/document-authoring/bilibili-content-discovery)
- **2026-07-19**: 🔧 第三方客户端工具注入修复 — ①**chat/completions.php**: 自动注入从仅引擎工具(18个)→引擎+MCP合并(46个), 第三方客户端现在可以看到 generate_docx/xlsx/pdf/ppt + bilibili_* + cr_* + mmx_* + chaoxing_qr_login ②**PPT参数修复**: MCP定义 topic/slides→title/pages匹配引擎 ③**RAG参数修复**: query→q匹配引擎 ④**超星QR优化**: login过期返回expired_refreshed(而非静默刷新), 保证用户扫描QR=轮询QR; login超时返回错误提示
- **2026-07-19**: 🔐 超星学习通扫码登录 — ①**QR脚本**: `mcp-server/chaoxing-login.py`独立Python脚本, check/qr/login三动作, login内部集成`_fresh_qr()`+auto-refresh+JSESSIONID修复, 仿B站架构 ②**MCP注册**: `api-tools.js`新增`chaoxing_qr_login`工具定义+`execChaoxingQrLogin()`处理器 ③**前端**: `tools.js`注册定义/registry/label, `main.js`工具数组, `tools-exec.js`独立QR消息行渲染 ④**QR显示修复**: B站+超星两处`<img>`标签从三元运算false分支移到外部(始终渲染), `status==='logged_in'`判断成功态 ⑤**轮询修复**: `getauthstatus/v2`返回text/html头但内容是JSON→手动解析; poll预加载JSESSIONID; type=2时内部刷新QR
- **2026-07-19**: 🌐 API v1 重构 — ①**tools/call.php**: 移除硬编码路由表, MCP Server作通用后端透明代理全部69工具(仅4个特殊工具保留PHP原生) ②**tools.php**: 动态加载MCP tool list, 永不落后于MCP ③**API.md**: 完整重写(架构图+工具分类表+Python/JS Agent循环示例+第三方客户端配置)
- **2026-07-17**: 🔧 工具执行+MCP全量适配 — ①`api/v1/tools/call.php`: 支持全部27个工具(引擎18+特殊4+文件5),所有API Key解密(v2 AES-GCM+XOR),搜索三级降级 ②MCP: `mcp-server/api-tools.js` v2动态加载引擎工具+3个内置,通过HTTP代理路由18个引擎工具 ③所有API端点统一解密: `chat/completions.php`+`models.php`+`tools/call.php`的`_decrypt_config_key()`
- **2026-07-17**: 🌐 公共 REST API — ①**API Key系统**: `auth_helpers.php`新增`verifyApiKey()`/`extractBearerToken()`/`generateApiKey()`,API Key格式`oac-<48hex>`,SHA-256哈希存储 ②**OpenAI兼容端点**: `api/v1/chat/completions.php`支持流式SSE+非流式JSON+函数调用,`api/v1/models.php`返回模型列表 ③**Key管理**: `api/api_keys.php`支持list/create/revoke,前端设置面板新增API密钥管理UI ④**文档**: `API.md`包含完整API参考+curl/Python/JS示例+第三方客户端配置指南 ⑤`init.php`新增`setApiCorsHeaders()`允许跨域访问
- **2026-07-15**: 🔍 Tavily搜索引擎修复 — ①**引擎侧**: `_try_tavily`的`search_depth`从`advanced`改为带key前缀检测(`tvly-dev-`/`tvly-free-`→basic,付费→advanced),添加API Key解密诊断日志和请求状态日志,解密失败时尝试明文存储 ②**前端侧**: Tavily路径改为统一走`fetchWithRetry`(与其他引擎一致),无结果时自动回退MiniMax CLI,出错时通过catch回退 ③`parseSearchResults`新增Tavily特有`detail.error`格式检测(之前只检查`error`字段,导致API错误被静默吞掉返回空结果)
- **2026-07-16**: 🔧 Gemini 根因修复 + 超星修复 — ①**Gemini**: 确诊Google API被GFW封锁导致直连503; `proxyFetch`新增Google域名自动跳直连走中继; 用户proxyUrl改为`proxy.naujtrats.xyz:8888`(proxy.php映射→192.168.195.213:10808); API可用但key配额耗尽(429) ②**超星登录**: `ensureUserConfig`检测0字节重建; `api_get_courses.py`全链路try/except; `cookies.py`返回空CookieJar ③**刷题DB**: `learning_records.db` chown www-data; `tracker.py`权限自修复
- **2026-07-15**: 🔍 Tavily搜索引擎修复 — ①`_try_tavily`:`search_depth`→`basic`+key前缀检测+诊断日志 ②前端统一`fetchWithRetry`+无结果回退MiniMax CLI ③`parseSearchResults`新增`detail.error`检测
- **2026-07-15**: 🔧 Gemini thought_signature修复 + Anthropic格式支持 — ①**Gemini思考模型工具调用修复**: `stream-handler.js`的`streamResponse`和`_backendSSEHandler`、`engine_server.py`的`_stream_openai_to_sse`和`_generate_resumable`和`_run_agent`三处全链路保留`thought_signature`,解决Gemini thinking模型工具调用HTTP 400错误 ②**Anthropic API格式支持**: 新增`useAnthropicFormat`设置开关,消息格式/工具定义/响应解析全链路支持Anthropic Messages API;Claude模型自动启用;Anthropic格式时禁用RS ③HTML新增`anthropicFormatToggle`复选框,`init.js`+`config.js`双路径恢复开关状态
- **2026-06-22**: 🔍 fetch.php代理+429重试+Gemini流修复 — ①`fetch.php`支持`?proxy=`参数,curl走代理穿透GFW ②`proxyFetch` 429指数退避重试(2s/4s/8s,读Retry-After头) ③`fetchModels`扩展过滤`-preview`/`experimental`/`gemini-3.1-*`等限频模型 ④`stream-handler`兼容Gemini流式`[DONE]`/`)]}'`/前导`]`格式
- **2026-06-22**: 🔧 配置跨设备同步修复 — ①新增`_scheduleConfigSync`防抖函数(2秒延迟自动推送配置到服务器) ②接入所有内联handler: 温度/Token滑块、行高/段落间距/字号、Markdown开关、Provider切换、Agent模式、可恢复流/代理/ToolCard开关 ③修复滑块仅更新UI不写localStorage的问题(温度/Token/显示参数)
- **2026-06-22**: 🔧 Agent聊天跨设备同步修复 — `restoreUserData`中`_agent_main`合并逻辑从"本地有任何消息就拒绝服务器"改为"服务器消息更多时使用服务器",与普通聊天合并逻辑一致,解决新设备登录后Agent聊天为空的问题
- **2026-06-22**: 🔧 工具调用详情卡片修复 + engine_push URL净化 — ①卡片开关从`switch.small`改为`config-toggle`统一样式 ②`init.js`+`config.js`双路径恢复开关状态,修复刷新后开关ON但功能不生效的localStorage/checkbox不同步 ③`engine_push` URL净化三层增强: 剥离`**URL**`双侧包裹+末尾`**`附着+generic Markdown污染清洗
- **2026-06-22**: 🔧 engine_push修复 + buildApiMessages诊断修复 — ①`engine_push` file参数完善: 添加`os.chown`到www-data、mtime参与hash保证唯一性、保留原始扩展名 ②`generate_ppt`补充缺失的except块(SyntaxError修复) ③`buildApiMessages`诊断分离assistant/tool命名空间消除误报+源数组去重清理 ④`/tmp/docx_env`重装python-pptx
- **2026-06-13**: 🔧 综合修复轮次 — ①RS+代理引擎侧URL映射 ②duplicate tool_call_id全局去重 ③MiniMax思考`(think)`标签大小写不敏感提取 ④max_tokens自动减小regex补充 ⑤`_engine_get` POST支持修复 ⑥`_generate_resumable`代理URL映射 ⑦`buildApiMessages`孤tool_call同步清理源消息
- **2026-06-12**: 🔒 强制认证 — `chat.php`+`engine_api.php`新增auth中间件,非public action返回401
- **2026-06-12**: 🔧 输入框溢出+MiniMax思考 — ①`.input-clip`裁剪容器+`background-color:inherit` ②`_backendSSEHandler`+RS双路径`(think)`提取+去重
- **2026-06-12**: 🔧 MCP mmx路由修复 — MCP server新增`/mmx`端点直接CLI调用,支持9个子命令
- **2026-06-12**: 🍪 超星cookie-first登录 — `api_get_courses.py/exam_api.py/start_exam.py`先试用Cookie获取课程,失效才登录
- **2026-06-12**: 🖥️ browser click/type三级降级 — 正常→force→evaluate派发DOM事件
- **2026-06-12**: 🔍 搜索引擎全走服务器代理 — Brave/Google/DuckDuckGo/Tavily统一走`engine_api.php?action=search_proxy`
- **2026-06-11**: 🤖 Skills系统+网页抓取增强
- **2026-06-10**: 🐛 RAG+Mermaid+MiniMax markdown修复
- **2026-06-08**: 🐛 RS刷新+刷课模块修复
- **2026-06-06**: 📦 Phase 0-9 代码拆分 + 🔒 安全升级 + ⚡ 懒加载

## 项目概览

多模型 AI 聊天客户端，深度集成超星学习通自动化、Agent 子代理系统、视频编辑、Cloudreve 云盘。

- **域名**: `https://naujtrats.xyz/oneapichat/`
- **许可证**: GPL-3.0
- **主分支**: `main`

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 原生 JS SPA（单文件 ~20K 行）、Tailwind CSS、KaTeX、Mermaid、Service Worker PWA |
| 后端 API | PHP 8.3 + php-fpm，JSON 文件存储 |
| 引擎 | Python FastAPI（端口 8766）、SQLite + JSON 文件存储 |
| 自动化 | Python 子进程（超星刷课/考试）、Flask + Celery（端口 8082） |
| 服务器 | Nginx 反向代理、Let's Encrypt SSL、Ubuntu WSL2 |

## 目录结构

```
/var/www/html/oneapichat/
├── api/              # PHP API 端点（认证、聊天、配置、引擎代理等 20+ 文件）
├── public/           # 前端静态资源
│   ├── index.html    # 主聊天 SPA 入口
│   ├── chaoxing.html # 超星刷课/考试面板
│   ├── js/core.js    # ★ 核心运行时 — 全局常量、DOM工具、加密、Cookie (Phase 0)
│   ├── js/main.js    # 主应用逻辑（~5,600 行，聊天/Agent/UI/工具执行）
│   ├── js/models.js  # 模型定义
│   ├── css/style.css # 主样式表
│   └── lib/lib/      # 第三方库（KaTeX、marked、mermaid、xlsx 等）
├── python/           # Python 后端
│   ├── engine_server.py # ★ 核心引擎（FastAPI, Agent, 流式, SSE, 视频, 浏览器）
│   ├── chaoxing/     # ★ 超星/考试模块（刷课、答题、考试、字体解密）
│   │   ├── main.py   # 超星自动化主入口
│   │   ├── scripts/  # 考试浏览器自动化脚本
│   │   └── learning_records.db  # 学习记录
│   └── engine/       # 引擎模块（浏览器、事件、策略、重试）
├── users/            # 用户数据（users.json, sessions.json, 配置, 记忆）
├── chat_data/        # 聊天历史 JSON 文件
├── .engine/          # 引擎运行时（SQLite 聊天 DB、Agent/Cron 状态）
├── uploads/          # 用户上传文件
├── deploy/           # 部署脚本、Docker、Nginx 配置
├── docs/             # 文档（README, CHANGELOG, LICENSE）
├── config/           # 配置文件（.mmx_config.json）
└── workspace/        # Agent 工作目录
```

## 服务端口与路由

| 路径 | 后端 | 端口 | 说明 |
|---|---|---|---|
| `/oneapichat/` | Nginx 静态 + PHP-FPM | 80/443 | 主应用 |
| `/engine/` | Python FastAPI | 8766 | Agent 引擎、SSE、流式 |
| `/rag/` | RAG 服务 | 8765 | 知识库检索 |
| `/mcp/` | Node.js MCP | 18788 | MCP 协议服务 |
| `/src/`, `/srcwebui/` | Flask | 8082 | 星穹铁道自动化 |
| `/py/` | Flask | 8082 (远程) | Python 后端 |

## 关键 PHP API

| 文件 | 功能 |
|---|---|
| `api/auth.php` | 用户认证（注册/登录/Token/邮箱验证） |
| `api/chat.php` | 聊天 CRUD + 用户配置同步 |
| `api/config.php` | 用户设置保存/加载 |
| `api/chaoxing_api.php` | 超星自动化枢纽（课程列表、刷课、考试） |
| `api/engine_api.php` | ★ 引擎代理（Agent/工作流/SSE 广播/浏览器/文件/MiniMax） |
| `api/proxy.php` | API 代理中继 |
| `api/upload.php` | 文件上传 |
| `api/fetch.php` | URL 抓取代理 |
| `api/memory_api.php` | 跨会话记忆系统 |
| `api/cloudreve_api.php` | Cloudreve 云盘桥接 |

## 核心 JS 模块

| 文件 | 行数 | 内容 |
|---|---|---|
| `js/core.js` | 309 | ★ 全局常量、数学公式保护、跨域Cookie、安全Fetch、DOM工具、加密、工具函数 |
| `js/image-gen.js` | 490 | 图像生成（generateImage / generateImageI2I / OpenRouter GPT Image） |
| `js/markdown.js` | 490 | 流式渲染（applyStreamRender）、MarkdownRenderer缓存、ChartRenderer/Mermaid |
| `js/main.js` | 3,116 | 主应用逻辑（聊天、Agent、工具执行） |
| `js/stream-handler.js` | 1,238 | 流式/非流式响应处理 (Phase 10 拆分) |
| `js/tools.js` | 1,502 | 工具定义、toolRegistry、工具分类和中文标签 |
| `js/commands.js` | 210 | /斜杠命令解析与分派 (Phase 9 拆分) |
| `js/resume-stream.js` | 158 | 可恢复流式续接模块 (Phase 9 拆分) |
| `js/models.js` | ~300 | 模型配置适配 |

- **聊天流**: `sendMessage()` → `attemptRequestWithFreshAbort()` → SSE/非流式处理
- **ResumeStream**: 可恢复流模块 — 刷新后从引擎续接（`ResumeStream.create/resume/resumeByStreamId`）
- **SSE 事件总线**: `connectSSEChannel()` → 跨浏览器实时同步（`/engine/events`）
- **Agent 审批**: `requestToolApproval()` → YOLO 自动 > 临时授权 > Plan 拒绝 > 弹窗
- **任务恢复**: `_recoverActiveTasks()` → 刷新后从 SQLite 恢复活跃流
- **消息队列**: `window._messageQueue` → localStorage 持久化 + 500ms 节流
- **402 降级**: 自动提取可负担 token 数，降低 `max_tokens` 后重试
- **临时权限**: `_tempAgentGranted` → ask_agent 单次授权 + 绿灯呼吸动画

## 引擎 API（engine_server.py）

| 端点 | 方法 | 功能 |
|---|---|---|
| `/engine/health` | GET | 健康检查 |
| `/engine/chat/create` | POST | 创建可恢复流 → 返回 `stream_id` |
| `/engine/chat/stream/{id}` | GET | 消费 SSE 流（断线续传） |
| `/engine/events` | GET | ★ 用户级 SSE 通道（跨浏览器实时推送） |
| `/engine/events/broadcast` | POST | 广播事件到同用户其他连接 |
| `/engine/tasks/active` | GET | 获取活跃任务（跨浏览器恢复） |
| `/engine/agent/*` | CRUD | Agent 管理（创建/运行/状态/停止/通知） |
| `/engine/cron/*` | CRUD | 定时任务管理 |
| `/engine/workflow/*` | CRUD | 工作流管理 |
| `/engine/file_*` | CRUD | 文件操作（read/write/search/op） |
| `/engine/heartbeat` | GET/POST | 心跳 + 推送 |
| `/engine/mmx` | POST | MiniMax 多模态（TTS/图片/视频/搜索） |
| `/engine/browser_*` | CRUD | 浏览器自动化 |
| `/engine/video_edit` | POST | 视频编辑管道 |

## 系统服务

| 服务 | 状态 |
|---|---|
| `php8.3-fpm` | active |
| `nginx` | active |
| `oneapichat-engine.service` | Python 引擎（8766） |
| `oneapichat-py.service` | Flask 后端（8082） |
| `chromium-cdp.service` | 浏览器自动化 |

**守护脚本**: `/var/www/html/oneapichat/engine_watchdog.sh`（每分钟 cron 检查引擎健康）

## 数据存储

| 位置 | 内容 | 格式 |
|---|---|---|
| `users/users.json` | 用户账户 | JSON |
| `users/sessions.json` | 会话 Token | JSON（30 天过期） |
| `chat_data/user_*_*.json` | 聊天历史 | JSON（per-user + per-chat） |
| `.engine/chat_*.db` | 流式进度 + 活跃任务 | SQLite |
| `.engine/memory/` | Agent 记忆/人格 | JSON |
| `python/chaoxing/learning_records.db` | 超星课程进度 | SQLite |
| `uploads/` | 用户文件 | 文件系统 |

## 已知问题与注意事项

1. `public/` 下 `lib/`、`resource/`、`src/` 多一层嵌套（`lib/lib/` 等），项目根有符号链接指向内层
2. `index_root.html` 为独立入口（已从 git 恢复），通过根符号链接访问
3. `python/chaoxing/search_question.py` → 根 `api/search_question.py` 通过符号链接访问
4. 密钥硬编码：AES 密钥 `naujtrats-secret` 在 `api/init.php` 和 `main.js` 中
5. 会话 Cookie 域 `.naujtrats.xyz` 用于跨子域共享
6. `keepalive: false` 用于配置保存 fetch（因 body 可能超 64KB）
7. 引擎重启时旧的 `_resumable` 内存状态丢失，但 SQLite `active_tasks` 表保留

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md
