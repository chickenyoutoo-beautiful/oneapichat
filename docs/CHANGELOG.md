## 2026-09-06 · Cloudreve 云盘重启后同步登录失效与公网 504 超时根治

- **问题现象**：
  1. **重启后云盘同步登录功能失效**：系统重启后在主页（`naujtrats.xyz`）或 OneAPIChat 点击云盘入口，无法自动登录已有的 Cloudreve 云盘账号，提示凭据需要重新登录或直接报错 404；
  2. **进入一直报 504 Gateway Timeout**：公网访问 `https://cloudreve.naujtrats.xyz/` 时，边缘经常报 504 网关超时，刷新页面或打开文件夹长时间转圈卡死。
- **根因分析**：
  1. **凭据缓存存放在易失性 `/tmp` 目录**：
     - `auth.php` 与 `cloudreve_sync.php` 此前仅将已校验的主账号明文凭据写在 `/tmp/cloudreve_login_*.json`；
     - 系统重启后 `/tmp` 临时文件系统被操作系统全量清空，导致服务器端凭据缓存丢失；而客户端已处于登录状态（持有 30 天持久化的 `authToken`），点击云盘时 `cr_ensureAccount()` 因找不到 `/tmp` 文件直接判定凭据失效；
  2. **SSO 消费端 URL 动态拼接错误与 ServiceWorker 拦截**：
     - `api/cloudreve_sso.php` 中动态生成 `action_url` 时，对 `HTTP_HOST`（如 `www.naujtrats.xyz`）未命中 `cloudreve.` 或 `pan.` 时，误拼接为不存在的 `https://www.naujtrats.xyz/cloudreve/api/oneapichat-sso`，前端表单 POST 该地址直接命中 Nginx 404；
     - `index.html` 在主页模态框登录后跳转使用了 `https://cloudreve.naujtrats.xyz/cr_login.php?t=...`；由于 Cloudreve 安装了 PWA ServiceWorker，其 Workbox NavigationRoute 会拦截非 `/api/*` 的所有 GET 请求并返回缓存的 SPA `index.html`，致使 `/cr_login.php` 根本无法执行，直接被路由重定向到未登录的 `/session` 登录页；
  3. **双边缘与宿主链路超时过于激进 (10s) 触发 504**：
     - 阿里云双边缘服务器（176 与 226）的 `cloudreve.naujtrats.xyz` Nginx 反向代理配置中，`proxy_connect_timeout` 硬编码为 `10s`；
     - 当宿主机刚重启、ZeroTier 虚拟局域网正在握手收敛或系统并发读写较高时，若 TCP/TLS 连接建立耗时超过 10 秒，边缘 Nginx 便会无情中断并向客户端返回 `504 Gateway Time-out`。
- **修复与加固**：
  1. **凭据双层持久化与重启自愈架构 (`api/cloudreve_lib.php`, `users/.cloudreve_cache`)**：
     - 在 `users/` 下建立持久化凭据目录 `users/.cloudreve_cache`；
     - 重构 `cr_writeCredentialFile()`，在向 `/tmp` 写入凭据时自动双写镜像至 `users/.cloudreve_cache/`；
     - 重构 `cr_getAccessToken()` 与 `cr_ensureAccount()`，系统重启后若发现 `/tmp` 缓存丢失，立即自动从 `users/.cloudreve_cache/` 无缝读取并自愈恢复至 `/tmp`，免去用户重复登录主项目的困扰；
  2. **SSO 消费端与 ServiceWorker 白名单对齐 (`api/cloudreve_sso.php`, `public/js/cloudreve.js`, `index.html`)**：
     - `api/cloudreve_sso.php` 固化 `action_url` 指向权威独立域名 `https://cloudreve.naujtrats.xyz/api/oneapichat-sso`；
     - `public/js/cloudreve.js` 的 `openCloudreveWeb()` 兜底降级地址统一修正为 `https://cloudreve.naujtrats.xyz/api/oneapichat-sso`；
     - `index.html` 登录后跳转地址同步升级为 `/api/oneapichat-sso?t=...`，精确命中 ServiceWorker denylist (`/^\/api\/(.+)/`)，绕过 Workbox 拦截；
     - 本机 Nginx `default` 与 `xiaoxin-proxy-port` 额外补齐 `/cloudreve/api/oneapichat-sso` FastCGI 处理与 `/cloudreve` 302 智能重定向，实现双重兜底；
  3. **边缘与宿主代理超时缓冲加固 (`176`, `226`, `213`)**：
     - 双边缘服务器（115.29.211.17 与 121.41.173.182）的 `cloudreve.naujtrats.xyz` 配置文件将 `proxy_connect_timeout` 由 10s 放宽至 60s；
     - 本机 213 的 `cloudreve` Nginx 代理将 `proxy_connect_timeout` 提升至 30s，彻底消除 ZeroTier 路由收敛期的 504 假死。

## 2026-09-03 · 编辑重发消息截断落盘闭环与多轮工具调用气泡裂变根除

- **问题现象**：
  1. **编辑重发消息后刷新旧消息复活**：用户点击先前某条消息的「编辑」按钮修改并重发后，原本应该丢弃该消息之后的所有对话；但在刷新页面后，那些被截断丢弃的历史旧消息又全部重新冒了出来。
  2. **多轮工具调用导致输出断断续续、重复出现多个 AI 气泡**：例如在进行原神冰神趣味梗图盘点时，模型调用了多轮搜索工具，结果界面上断断续续生成了多个带有相同开头或重复内容的独立 AI 回复气泡，甚至从头复读之前的长篇正文。
- **根因分析**：
  1. **客户端与服务端截断保存机制缺失**：
     - 用户在 `rendering.js` 或 `main.js` 点击「编辑」或「还原对话」按钮时，仅在前端内存对 `messages` 执行了 `slice` 并调用了防抖的 `saveChatsDebounced()`，未强制单调递增 `revision`，也未标记明确的截断时间戳；
     - `storage.js` 的 `restoreUserData` 与 `saveChatsToServerOnce` 在页面刷新或同步时，存在 `if (_serverMsgs.length > _localMsgs.length) use _serverMsgs` 的粗暴逻辑，导致服务器上原本完整的长历史直接把本地刚截断的较短历史覆盖；
     - `api/chat.php` 服务端在收到单会话保存时，此前走的是 `onechat_merge_chat_records`（双向并集），把磁盘中未包含在本次提交中的后续旧消息全部加了回来。
  2. **多轮工具迭代裂变成多个独立气泡**：
     - 在工具调用过程中，前端可能会产生多个临时或中间 Assistant 记录；当后台通过 `chat_projection.py` 提交最终完成态回复时，若 `msg_id` 没有精确命中，旧逻辑直接 `projected_messages.append(assistant)`，把本来属于同一轮问答的回复当成新的一轮追加，导致一轮工具搜索生成 4~5 个破碎气泡；
     - 模型在伴随工具调用的首轮已输出了长篇正文，工具返回后，模型下意识从头把所有内容重新生成一遍，造成大量文本重复。
- **修复与优化**：
  1. **前端权威会话截断封装 (`dialogs.js`)**：
     - 新增 `window.truncateChatMessages(chatId, remainingMessages)`：截断时严格单调递增 `chat.revision`，记录 `chat._truncatedAt`，并立即通过 `window._saveAndBroadcast(chatId)` 单文件即时落盘与多端广播，阻断竞态。
  2. **接入所有编辑与还原入口 (`rendering.js`, `main.js`)**：
     - `rendering.js` 的所有用户消息「编辑」按钮、助手消息「还原/分支到此处」按钮，以及 `main.js` 的「编辑最后一条用户消息」按钮，统一调用 `window.truncateChatMessages`。
  3. **服务端单会话保存以客户端截断序列为权威 (`api/chat.php`)**：
     - 新增 `onechat_apply_single_chat_save($existing, $incoming)`：单会话保存以客户端提交的 messages 序列为绝对骨架，仅对同 ID 的已有消息合并图片等不可再生字段，彻底废除把已删除截断的旧消息并集恢复的缺陷。
  4. **防长消息倒灌覆盖 (`storage.js`)**：
     - `restoreUserData` 与 `saveChatsToServerOnce` 增加 `_isLocalNewer` 保护判定（检查 `revision` 与 `_truncatedAt`），即使服务器暂存的消息更多，只要本地发生过截断更新，绝不盲目用长数组覆盖本地短数组。
  5. **工具多轮气泡就地升级融合 (`python/engine/chat_projection.py`)**：
     - 在 `commit_assistant` 中，若未精确匹配到 `msg_id`，自动识别最后一条用户消息之后是否已存在本轮助手消息；若存在，就地升级合并（`_merge_message`），杜绝生成过程裂变成多个重复 assistant 气泡。
  6. **强力注入防复读引导 (`public/js/main.js`)**：
     - 凡模型在发起工具调用前已经输出了实质正文（>30字），工具执行完毕后在给模型的系统提示中强力注入约束指令，严禁从头重复之前已经输出过的正文，强制仅针对工具结果进行简要收尾。
  7. **自愈受污染的历史会话**：
     - 彻底同步清洗了 `chat_1788411060372` 在单会话与 `all.json` 中的数据，消除多余的断裂重复气泡。
- **验证**：
  - 新建 `tests/chat_truncation_edit_recovery.test.js` 并运行全量测试套件（含图片、流恢复、多端同步等全部 30 项测试）全部通过；
  - `tools/build-index.py` 刷新前端资源版本指纹戳；
  - PHP 语法检查及 Python 编译检查无错误。
- **涉及文件**：`public/js/dialogs.js`、`public/js/rendering.js`、`public/js/main.js`、`public/js/storage.js`、`api/chat.php`、`python/engine/chat_projection.py`、`tests/chat_truncation_edit_recovery.test.js`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-03 · GPT 系列模型 XHigh 与 Max 旗舰推理档位全面解锁

- **问题背景**：用户反馈在 OneAPIChat 项目中，GPT 系列模型（包括 GPT-5.6-Sol、GPT-5.6-Terra、GPT-5.5、o1、o3 等）无法选择高阶推理档位（XHigh 与 Max）。
- **根因分析**：
  1. `public/js/models.js` 中 `getThinkingIntensityLevels` 在追加 `xhigh` 和 `max` 时，过滤条件仅包含了 `deepseek-v4`、`claude`、`grok-4.6`，把 `gpt`、`o1`、`o3`、`codex` 排除在外，导致弹窗只生成到 High；
  2. DSH 宿主 `~/.dsh/settings.yaml` 中，`openai` 与 `cpa` 提供商下的 GPT 模型未显式声明 `reasoningEfforts`，`apikey-fun` 则仅写到 `high`，缺失 `xhigh` 与 `max`。
- **改动与实现**：
  1. **OneAPIChat 前端对齐 (`public/js/models.js`)**：
     - `getThinkingIntensityLevels` 判定条件扩展覆盖 `gpt`/`o1`/`o3`/`codex`；
     - 7 档选项完整可用：`Default`、`Off`、`Minimal`、`Low`、`Medium`、`High`、`XHigh`、`Max`；
     - 底层协议映射安全闭环：`THINKING_INTENSITY_MAP` 与 `provider_runtime.py` 将 `xhigh`/`max` 安全对齐至 OpenAI 兼容协议允许的最高档，防止上游 400 报错。
  2. **DSH 宿主环境全面同步 (`~/.dsh/settings.yaml`)**：
     - 在 `openai`、`cpa`、`apikey-fun` 提供商中为所有 GPT 思考模型补充：
       ```yaml
       reasoningEfforts:
         off: null
         minimal: low
         low: low
         medium: medium
         high: high
         xhigh: high
         max: high
       ```
     - 经 `settings.describe` RPC 接口实测验证 DSH 已热重载并生效。
- **验证**：
  - Node 测试 `MODEL_CONFIGS.getThinkingIntensityLevels('gpt-5.6-sol')` 正确输出含 `xhigh` 与 `max` 的 7 档列表；
  - DSH `settings.describe` 验证 `gpt-5.6-sol` 包含 `xhigh` 与 `max`；
  - 运行 `python3 tools/build-index.py` 刷新前端资源版本戳。
- **涉及文件**：`public/js/models.js`、`~/.dsh/settings.yaml`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-03 · Gemini 系列思考强度切换支持与档位全链路适配

- **问题背景**：用户需要为 Gemini 3.8/3.7 系列模型提供思考强度（Reasoning Effort / Thinking Level）切换功能，要求明确官方支持的档位及网关兼容策略。
- **调研与机制分析**：
  1. **Google 官方规范**：
     - 原生 GenAI API (`thinking_config`) 使用 `thinking_budget` 参数：`0` 为彻底关闭思考（仅部分 Flash 模型支持），`-1` 为动态自动推理，`1024~65536` 为 Token 预算范围；
     - OpenAI 兼容接口 / Vertex AI / LangChain / Vercel AI Gateway 统一标准中，采用 `reasoning_effort` 参数，定义了 3 个核心档位：`"low"`、`"medium"`、`"high"`。
  2. **CPA (CloudProxyAPI) 网关实测约束**：
     - 测试表明：如果直接传 `reasoning_effort: "off"`，网关会明确拦截抛错 `HTTP 400: {"error":{"message":"level \"off\" not supported, valid levels: low, medium, high"}}`；
     - 传 `"low"`、`"medium"`、`"high"` 正常响应且返回对应思考 Token；传 `"minimal"` 自动映射至 `low`；
     - 关闭思考（Off）的规范方式是在请求中**省略** `reasoning_effort` / 置空该字段。
- **改动与实现**：
  1. **DSH 宿主配置 (`~/.dsh/settings.yaml`)**：
     - 在 `google` 与 `cpa` 提供商下的 Gemini 模型中完整补充声明：
       ```yaml
       reasoningEfforts:
         off: null
         minimal: low
         low: low
         medium: medium
         high: high
       ```
     - 空值 `off:` 严格遵循 `dsh-llm-pi-ai` 规范，在选择关闭时在底层协议中自动省略参数，杜绝 400 报错；
     - DSH 前端 Web UI 及 `settings.describe` RPC 接口热重载即时生效，在模型选择区成功渲染思考档位选择器。
  2. **OneAPIChat 目录与请求管线对齐**：
     - `public/js/models.js`：`getThinkingIntensityLevels` 扩展支持 `['off', 'minimal', 'low', 'medium', 'high']`；
     - `public/js/models.js` 与 `python/engine/provider_runtime.py`：针对 `off` 严格过滤为 `None`/删除请求键，避免往上游发送非法字符串；`minimal` 安全转译为 `low`；
     - 运行 `tools/build-index.py` 刷新前端版本戳。
- **验证**：
  - Python 脚本实测调用 CPA 接口，验证 `minimal`、`low`、`medium`、`high` 各档位及参数省略行为；
  - DSH `settings.describe` 实测确认 `gemini-3.8-flash-high` 与 `gemini-3.8-flash` 成功挂载 `reasoningEfforts` 档位字典；
  - `node -c` 语法检查全绿。
- **涉及文件**：`~/.dsh/settings.yaml`、`public/js/models.js`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-03 · Gemini 3.8 Flash 新模型接入与全生态模型目录升级

- **问题背景**：Google 发布全新一代 Gemini 3.8 Flash 模型。系统需要全面支持该模型在 DSH 宿主环境、CPA (CloudProxyAPI) 网关转发以及 OneAPIChat 对话界面中的无缝调用。
- **改动与实现**：
  1. **DSH 宿主配置 (`~/.dsh/settings.yaml`)**：
     - 在 `google` 与 `cpa` 提供商的 `models` 列表中正式注册 `gemini-3.8-flash-high` 和 `gemini-3.8-flash`（1M 上下文、128K 输出 Token）；
     - `agent-default-model` 确认绑定 `gemini-3.8-flash-high`，通过 chokidar 监听器实现热重载并经 `settings.describe` RPC 接口验证已生效。
  2. **CPA 网关中继 (`/opt/cli-proxy-api/config.yaml`)**：
     - 增加 `antigravity` OAuth 模型别名：`gemini-3.8-flash-high → gemini-3.8-flash`；
     - 重启 Docker 容器并使用 Bearer Token 发起端到端连通性测试，验证 `gemini-3.8-flash-high` 与 `gemini-3.8-flash` 均能正常返回 200 且附带推理/正文。
  3. **OneAPIChat 目录与能力库对齐**：
     - `public/js/models-catalog.js`：在 `gemini` 和 `llamacpp` 分组加入 `gemini-3.8-flash-high` 与 `gemini-3.8-flash`；
     - `public/js/models.js`：将匹配正则与别名扩充至 `gemini-3.8-`，继承 1M 上下文、128K 输出、思考分级与视觉/工具调用完整能力；
     - `public/js/utils.js`：更新 Gemini 默认模型为 `gemini-3.8-flash-high`；
     - `public/js/usage-stats.js`：为 `gemini-3.8-flash-high` 与 `gemini-3.8-flash` 配置专属统计配色。
- **验证**：
  - `curl` 测试 CPA `gemini-3.8-flash-high` 与 `gemini-3.8-flash` 端到端调用返回 200；
  - DSH 接口 `settings.describe` 实测返回 `gemini-3.8-flash` 与 `gemini-3.8-flash-high`；
  - `node -c` 检查所有修改的 JS 文件语法通过；`python3 tools/build-index.py` 刷新前端资源版本。
- **涉及文件**：`~/.dsh/settings.yaml`、`/opt/cli-proxy-api/config.yaml`、`public/js/models-catalog.js`、`public/js/models.js`、`public/js/utils.js`、`public/js/usage-stats.js`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-02 · 坏图回退来源页纠正与图片直链防幻觉

- **问题现象**：外部图片加载失败后出现“点击新标签查看原图”卡片，但按钮仍然跳向原始坏图直链；例如模型猜测的 `https://patchwiki.biligame.com/images/wqmt/c/c8/Syjqicon.png` 本身就是 404，点击卡片只会再次进入 Tengine 404。与此同时，同一回答下方模型明确给出的 BWIKI 来源页面链接却可以正常打开。
- **根因分析**：
  1. 降级卡片旧实现直接设置 `card.href = src`，没有区分“图片二进制直链”和“可靠来源页面”，因此失败后只是让用户再次请求同一个已失败 URL。
  2. `markdown.js` 中 `_enhanceInlineImage` 自己也注册了一个 error listener，并抢先把坏图替换为指向 `_href` 的普通链接；它与新的 `attachImageFallbacks` 发生竞态，使来源页推导和代理重试无法生效。
  3. `init.js` 的全局图片错误捕获仍对所有 `<img>` 执行 `display:none`，有机会在降级卡片生成前先隐藏图片。
  4. 搜图模型会根据网页摘要里的 `Syjqicon.png`、目录名和猜测哈希拼接并输出未经搜索服务实际返回的图片 URL，前端无论怎么代理都无法修复一个源站本身不存在的 URL。
- **修复与优化**：
  1. `public/js/rendering.js`：新增 `_imageSourcePage` 与 `_knownImageSourcePage`。图片失败时优先寻找同一段落中明确给出的来源链接；对 `patchwiki.biligame.com/images/{project}/...` 回退到可访问的 `https://wiki.biligame.com/{project}/首页`，对 Wikimedia 图片回退到 Commons File 页面。卡片文案改为“图片直链已失效 · 点击打开来源页面”，不再承诺打开不存在的原图。
  2. 坏图首次失败仍尝试 `images.weserv.nl` 图片代理；代理也失败后才生成来源页卡片。已实测 BWIKI 猜测直链及 weserv 均返回 404，而 `https://wiki.biligame.com/wqmt/首页` 返回 200。
  3. `public/js/markdown.js`：移除竞争的独立坏图链接替换器，只保留 HTTPS、lazy、async 与 no-referrer 属性；所有错误统一由 `attachImageFallbacks` 接管。
  4. `public/js/init.js`：正文图片不再被全局 `display:none`，改为委托统一降级器。
  5. `public/js/main.js`、`public/js/tools.js`、`public/js/search.js`：图片搜索上下文和工具描述明确禁止根据文件名、目录、哈希或摘要猜测直链；只允许展示搜索 API 实际返回的 `thumbnail/image_url`，否则只提供来源页；图片搜索结果同时携带 `图片来源页`。
- **验证**：`node tests/external_image_render_fix.test.js`、`node tests/image_command_routing.test.js` 通过；六个修改 JS 文件 `node -c` 通过；`tools/build-index.py` 已刷新资源版本。
- **涉及文件**：`public/js/rendering.js`、`public/js/markdown.js`、`public/js/init.js`、`public/js/main.js`、`public/js/tools.js`、`public/js/search.js`、`tests/external_image_render_fix.test.js`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-02 · 自然语言搜图与 AI 生图确定性分流

- **问题现象**：用户输入“给我收集有关原神冰神的有趣插图”“帮我找几张科比的照片”等普通自然语言搜图请求时，虽然系统已有 `/image` 搜图隔离，但非斜杠请求仍把 `generate_image` 暴露给模型；模型受“图片/插图”语义吸引，先做若干网页搜索后又自行调用生图，偏离“收集现有图片”的原意。
- **根因分析**：此前的硬隔离仅由 `parseCommand('/image ...')` 触发。普通自然语言请求依赖模型自主选择 `web_search` 或 `generate_image`，工具描述只能软约束，无法阻止模型误选；截图中的请求没有 `/image` 前缀，所以 `imageCommandMode` 始终为空，生图 Schema 全程可见。
- **修复与优化**：
  1. `public/js/commands.js` 新增 `classifyImageRequestIntent`，确定性识别“搜索/查找/收集/给我找/推荐 + 图片、插图、照片、梗图、壁纸”等现有图片搜索意图；明确“先搜后参考生成”标为复合任务，单纯“画/生成/创作”保持生图路径。
  2. `public/js/main.js` 将自然语言搜图提升为强制 images 搜索，绕过工具调用搜索开关；纯搜图轮沿用现有逐轮 Schema 过滤，从请求工具列表中硬移除 `generate_image` 与 `generate_image_i2i`，并注入“严禁生图”的临时上下文。该状态不持久化，下一轮明确创作时自动恢复生图工具。
  3. `public/js/upload.js` 与 `public/js/tools.js` 强化系统提示和工具描述，明确“收集/查找现有图片”不是创作，避免未命中边界表达时的模型误判。
  4. `tests/image_command_routing.test.js` 增加截图同类语句、普通找照片、纯生图和搜图后生成四类回归覆盖，并兼容当前 ResumeStream 停止控制器实现。
- **验证**：`node tests/image_command_routing.test.js` 通过；`node --check public/js/commands.js public/js/main.js public/js/tools.js public/js/upload.js` 对应逐文件语法检查通过。附带运行 `tests/auto_image_links.test.js` 时发现其既有源码提取断言与当前 `autoLinkURLs` 实现不匹配，该失败与本次路由改动无关。
- **涉及文件**：`public/js/commands.js`、`public/js/main.js`、`public/js/upload.js`、`public/js/tools.js`、`tests/image_command_routing.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-02 · 外部图片防盗链解封、来源链接保护与无图智能降级卡片

- **问题现象**：用户在要求 AI“找两张科比的图片”时，页面上出现大片大片空白空行，图片完全没有显示，甚至下方的“来源：”后面也是一片空白，刷新网页后依然是一片空白。
- **根因分析**：
  1. **超链接被正则暴力强转为破损图片**：`rendering.js` 中的 `autoLinkURLs` 使用了过于宽泛的匹配 `replace(/(^|[^!])\[([^\]\n]{1,160})\]\((https?:\/\/[^)\s]+)\)/g, ...)`，只要 `label` 或 `url` 包含图片相关字眼就强转为 `![]`；维基百科来源链接 `[Wikimedia Commons - File:Kobe Bryant 8.jpg](https://commons.wikimedia.org/wiki/File:Kobe_Bryant_8.jpg)` 虽然结尾有 `.jpg`，但它**是一个维基百科网页 HTML 页面**！强转为 `<img>` 后浏览器无法将 HTML 解码为图片；同时因为变成了 `<img>` 标签，原有的超链接文本全被当成了不可见的 `alt`，导致“来源：”后面的文本链接全部蒸发，只留下坏图。
  2. **缺少防盗链处理**：所有生成的 `<img>` 标签缺少 `referrerpolicy="no-referrer"`，浏览器向第三方 CDN（包括维基百科图片）发起图片请求时携带了本站 `Referer`，直接被第三方图床策略拒绝（403/400 阻断）。
  3. **缺失图片失败降级机制**：当大模型幻觉拼凑出的图片直链（或因墙内无法直连）报错时，浏览器默认直接折叠隐藏坏图，页面上留下一大片空白空行。
- **修复与优化**：
  1. `public/js/rendering.js`：重构 `autoLinkURLs`，显式常规超链接 `[label](url)` 永远保持为超链接，坚决不破坏用户的来源跳转；严格排除包含 `/wiki/`、`/item/`、`/article/` 等网页路径的 URL；移除 L1354 破坏性的 `replace(/!\[(.*?)\]\((.*?)\)/g, '[图片 $1]($2)')`。
  2. `public/js/core.js`：在 Markdown 渲染管道中自动为正文所有 `<img>` 注入 `referrerpolicy="no-referrer"`、`loading="lazy"` 和 `decoding="async"`，彻底解封第三方图片防盗链。
  3. `public/js/rendering.js` / `public/css/style.css`：上线全局 `attachImageFallbacks`，一旦外部图片因不可抗力（400/404/网络阻断）加载失败，自动就地替换为精致的毛玻璃「🖼️ 外部图片 · 点击在新标签页打开原图 ↗」卡片，并完整保留下方的“来源：维基百科”超链接，用户点击即可一键跳转查看原图。
- **验证**：`node tests/external_image_render_fix.test.js` 全绿通过；`tools/build-index.py` 刷新版本戳。
- **涉及文件**：`public/js/rendering.js`、`public/js/core.js`、`public/js/dialogs.js`、`public/js/markdown.js`、`public/css/style.css`、`tests/external_image_render_fix.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-02 · 消息同步与广播系统全链路权威落盘与防闪退根治

- **问题现象**：
  1. 用户在网络较差或遇到 `ERR_CONNECTION_RESET` 时，发出的消息在界面上生成完成，但“闪一下就没了”，必须刷新或等下一轮甚至完全丢失。
  2. 多端同步存在消息突然消失或突然出现的幽灵现象，不同客户端显示的消息条数不一致。
  3. 界面经常弹出“🔄 续接流式...”或重连 Toast 打扰用户。
  4. 当没有客户端在线打开（或关闭网页、手机锁屏）时，后台执行的长任务无法可靠收尾，由于缺少浏览器端主动发起保存导致回复无法落盘。
- **根因分析**：
  1. **完成态落盘边界错误（Dual-Storage Bifurcation）**：Python 引擎在 LLM 完成时仅将状态标记为完成并广播 `stream_done`，**自身绝不写 PHP 会话文件**，而是完全依赖前端浏览器在收到 `done` 后发起异步 HTTP POST `saveChats(true)`。若此时浏览器连接断开、用户刷新或关闭网页，该请求丢失；同时 SQLite 中该任务已成 `completed` 终态，导致刷新后既拉不到活跃任务，PHP 磁盘又无内容，AI 回复永久丢失。
  2. **接收端过早覆写旧快照（Flash-and-Disappear）**：发送端在 `main.js` 设置了 `_justProduced` 保护期，但接收端（Observer）没有设置；当接收端通过 SSE 实时打出回复后，收到后端的 `chat:stream_done` 立即请求 PHP 回源。若发送端的单文件写入因网络有轻微延迟，接收端读到旧快照并强行覆盖了本地内存，导致刚打出的字当场被抹除闪退。
  3. **服务端单文件与 `_all.json` 覆盖竞态**：`api/chat.php` 在 `GET all` 时按 `glob` 字典序遍历；纯数字时间戳命名的会话排在 `all.json` 之前，导致陈旧的 `all.json` 内容反向覆盖了单会话文件中的最新消息；且消息合并按数组索引遍历，缺少全局稳定 ID。
  4. **传输层连接中断被误判为用户主动取消**：浏览器刷新或多流切换时，前端 `AbortController` 级联触发调用 `_cancelStream`，向服务端发送 `DELETE /engine/chat/stream/{sid}`，误杀了正在后台正常运行的服务端生产线程。
- **修复与优化**：
  1. **服务端权威原子提交（Commit-before-Broadcast）**：
     - 新增 `python/engine/chat_projection.py`（`ChatProjectionStore`）：Python 引擎在广播 `chat:stream_done` **之前**，直接通过文件锁（`.lock`）将助手最终回复原子合并提交至 PHP 单会话文件（`chat_data/user_{uid}_{chatId}.json`）。
     - 支持无客户端在线时的子代理自主收尾：`commit_subagent` 自动在后台生成 `_agent_sub_{agent_name}` 的完整持久化会话文件，即使无任何浏览器在线，后台任务依然稳固落盘。
  2. **跨设备稳定合并与防回退屏障**：
     - `api/chat.php`：消息统一生成稳定 ID（`id` / `_rsMsgId` / 内容哈希），单会话文件永远优先于 `all.json`；引入 `onechat_merge_chat_records` 与 `onechat_merge_message_record`，完成态消息绝对优先于 partial 消息，内容更长者优先，杜绝以旧盖新。
     - `public/js/agent-notify.js`：新增 `_serverClearlyOlder` 与 `_expectedRemoteRevision` 判定，若服务端快照修订版本落后于本地，坚决拒绝覆盖；Observer 端流结束同样享有 `_justProducedStreamMap` 保护期。
  3. **连接层重置平滑降噪与静默体验**：
     - `public/js/resume-stream.js`：彻底移除“🔄 续接流式...”和重连 Toast；将本地 reader 断开与用户主动停止彻底解耦，只有显式点击停止按钮才触发 DELETE，网络重置（`ERR_CONNECTION_RESET`）仅标记 `transportDetached` 并静默等待重连或后端完成态投影，绝不误杀后台任务。
     - `public/js/core.js`：统一挂载 `window.currentChatId` 访问器，消除外部模块判空失败；`dialogs.js` 彻底清理陈旧的 WebSocket 3 秒阻塞早退逻辑。
  4. **广播与事件队列时序加固**：
     - `python/engine_server.py`：SSE 订阅连接在同一把锁内先灌入历史回放再接入广播通道，杜绝重放事件与新事件乱序；请求透传 `client_source`，避免发起端收到自己的回环广播导致状态震荡。
- **验证**：
  - `python3 python/tests/test_chat_projection.py`（4 项投影与子代理测试全部通过）；
  - `node tests/sync_authoritative_commit.test.js`、`node tests/multidevice_projection_consistency.test.js`、`node tests/dsh_authoritative_runtime.test.js`、`node tests/resume_stream_state.test.js`、`node tests/stream_refresh_recovery.test.js` 全部通过；
  - `python3 python/tests/test_multidevice_sync.py`、`python3 python/tests/test_sse_refresh_replay.py`、`python3 python/tests/test_resumable_stream.py`、`python3 python/tests/test_store.py`（28 项后端测试全绿）；
  - `tools/build-index.py` 刷新版本戳。
- **涉及文件**：`python/engine/chat_projection.py`、`python/engine_server.py`、`python/engine/store.py`、`api/chat.php`、`public/js/main.js`、`public/js/agent-notify.js`、`public/js/resume-stream.js`、`public/js/storage.js`、`public/js/dialogs.js`、`public/js/core.js`、`public/js/rendering.js`、`tests/sync_authoritative_commit.test.js`、`python/tests/test_chat_projection.py`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-01 · Agent 会话分组全 SVG 化与 Claude/Codex 标题去重

- **问题现象**：项目 Agent 模式的左侧会话列表中，工作区分组仍使用 📁/📂/🗂️，Claude Code/Codex 分组使用彩色圆点 Emoji；同时每条导入会话标题又重复显示 `[Claude]` 或 `[Codex]`，与一级分组信息重复且挤占窄侧栏空间。
- **修复与优化**：
  1. `public/js/dialogs.js`：为工作区、日期、历史归档、Claude Code 与 Codex 分组建立统一的内联 SVG 图标集；折叠箭头和分类图标拆成独立节点，所有图标继承当前主题颜色，不再依赖系统 Emoji 字体。
  2. `public/css/style.css`：新增分组折叠箭头及分类 SVG 的尺寸、色彩和暗色主题适配，折叠时只旋转箭头，不再误旋转文件夹图标。
  3. `public/js/dialogs.js`：单会话展示层统一剥离 `[Claude]`、`[Codex]`、`【Claude】`、`【Codex】` 前缀，兼容已有缓存或尚未迁移的数据。
  4. `tools/import_claude_codex_chats.py`：后续导入直接保存原始标题，不再生成来源前缀。
  5. `chat_data/`：迁移现有 182 个持久化文件，共清理 589 个标题字段；Claude/Codex 来源仍由 `claude_*`/`codex_*` ID、source 元数据和一级菜单完整保留。
  6. `tests/agent_history_cleanup.test.js`：补充分组无 Emoji、SVG 节点、标题清理与导入脚本无前缀的回归契约，并刷新前端资源版本。
- **验证**：`node --check public/js/dialogs.js`、`node tests/agent_history_cleanup.test.js`、`node tests/agent_chat_separation.test.js`、`python3 -m py_compile tools/import_claude_codex_chats.py` 全部通过；全量 `chat_data/*.json` 检索已无 Claude/Codex 方括号前缀。
- **涉及文件**：`public/js/dialogs.js`、`public/css/style.css`、`tools/import_claude_codex_chats.py`、`tests/agent_history_cleanup.test.js`、`chat_data/`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-01 · 多端同步即时自动重绘与发送侧落盘广播闭环

- **问题现象**：多设备使用同一账号在同一会话交互时，有时发送的消息在另一端未自动显示（必须按 F5 刷新才出来），或者偶尔出现消息消失。
- **根因分析**：
  1. **发送端落盘与广播时序存在竞态**：`main.js` 插入用户消息后，旧逻辑中对 `saveSingleChatToServer` 采用异步 fire-and-forget，并立即调用 `_broadcastChatUpdate`；接收端在收到 `chat:updated` 后立即请求 `chat.php?chat_id=...` 回源，此时发送端的单文件保存请求可能仍在网络传输中尚未写入磁盘，接收端回源读到了旧消息列表并写入了本地 `chats`，导致刚刚看到的消息被冲掉。
  2. **接收端回源后 DOM 未触发重绘**：`agent-notify.js` 中的 `_resyncChatFromRemote` 旧判定仅当 `changed` 为真且比较签名完全不同时才触发 `loadChat`；当接收端通过轻量索引 `_syncChatIndexFromServer` 发现了服务端更新的消息数量，但当前会话处于局部索引态（`_localIndex: true`）或缺少消息节点时，未主动触发 DOM 重新渲染。
- **加固与修复**：
  1. `public/js/main.js`：发送端在 push 用户消息后，统一调用 `_saveAndBroadcast(chatId)`，**确保单文件落盘与广播严格按序原子闭环**，彻底消除回源读到半截旧数据的时序窗口。
  2. `public/js/agent-notify.js`：
     - `_resyncChatFromRemote`：在回源数据到达后，增加对当前页面已渲染 DOM 节点数与实际数据消息数的校验（`_actualCount > _renderedCount || _renderedCount === 0`），一旦检测到新消息且当前未在实时生成中，立即调用 `loadChat` 进行就地重绘；
     - `_syncChatIndexFromServer`：当拉取的轻量索引表明当前打开的会话在远端有新增消息时，自动发起回源并刷新 DOM。
- **涉及文件**：`public/js/main.js`、`public/js/agent-notify.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-01 · 多端同步已删/内部归档会话 404 自愈与墓碑同步闭环

- **问题现象**：控制台偶发出现密集请求 `GET /oneapichat/api/chat.php?chat_id=_agent_old_... 404 (Not Found)`，并且每隔几秒连续重试 4 次。
- **根因分析**：
  1. `_agent_old_*` 是 Agent 模式历史归档的内部会话，若该会话此前已在某端被物理删除或清理，其 ID 仍作为墓碑记录保存在服务端的 `deleted` 映射表中。
  2. 客户端在 SSE 重连或被动拉取轻量索引（`_syncChatIndexFromServer`）时，只更新了 `meta.chats`，未同步消费 `payload.deleted` 墓碑列表，导致本地内存或 `currentChatId` 依然驻留了已被删除的会话 ID。
  3. `agent-notify.js` 中的 `_syncChatFromServer` 遇到 404 时，旧逻辑会尝试回退拉取 `all.json`；若仍不存在则默认作为临时网络异常，触发 `_resyncChatFromRemote` 的 4 次指数递增重试（800ms、1600ms...），导致控制台连续报错 404。
- **加固与修复**：
  1. `public/js/agent-notify.js`：
     - `_syncChatIndexFromServer` 增加对服务端 `payload.deleted` 墓碑字典的解析与同步，将远端已删除的 ID 写入 `window._deletedChatIds` 并从本地 `window.chats` 中即时剔除；
     - `_syncChatFromServer` 遇到服务端 404 响应时，自动认定该会话已不存在，就地打上 `_deletedChatIds` 墓碑并清理 `chats` 索引；返回 `{ ok: false, notFound: true }`；
     - `_resyncChatFromRemote` 判定 `res.notFound` 时**立即终止后续无效重试**，若当前正停留在该 404 会话则自动平滑切换至同域其他最新会话或新建空会话。
  2. `tests/multidevice_projection_consistency.test.js`：新增自动化回归测试，锁定墓碑同步与 404 阻断契约。
- **涉及文件**：`public/js/agent-notify.js`、`tests/multidevice_projection_consistency.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-01 · Grok/DeepSeek 思考态窄气泡根治与阅读轨道自适应

- **问题现象**：当使用 Grok / DeepSeek 等具有思考输出的模型时，若模型在思考阶段（或输出被拒绝/尚未生成正文时），当前气泡呈现为一个被压缩成 180px 的窄矩形（如截图所示），正文轴严重收缩。
- **根因分析**：
  - 在 `theme-studio.css` 中，为经典/极简主题设计紧凑三点等待器时，写了规则：
    ```css
    .message-row.assistant .bubble.assistant.typing {
        width: auto !important;
        min-width: 76px !important;
        max-width: 180px !important;
    }
    ```
  - 当模型开始流式输出思考内容（`details.reasoning-details`）而正文（`.markdown-body`）尚未返回或为空时，气泡上依然带有 `.typing` 类；导致已拥有长段思考文字的气泡仍然被强行限制在 `max-width: 180px`，产生纵向拥挤的窄条畸变。
- **加固与修复**：
  - `public/css/theme-studio.css`：优化 `.bubble.assistant.typing` 约束选择器为 `:not(:has(details.reasoning-details)):not(:has(.markdown-body > *)):not(:has(.tool-call-lines))`；仅在纯空白无内容的初始三点等待时保持 180px 紧凑胶囊，**一旦挂载思考折叠框、工具时间线或正文内容，气泡立即自适应展开至 880px 完整阅读轨道**。
  - `tests/rate_limit_and_reasoning_layout.test.js`：补齐针对思考阶段气泡宽度不受 `typing` 窄胶囊限制的自动化回归契约。
- **涉及文件**：`public/css/theme-studio.css`、`tests/rate_limit_and_reasoning_layout.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-01 · AI 生图工具结果实时就地渲染与统一容器架构

- **问题现象**：调用 `generate_image` 或 `generate_image_i2i` 生成图片后，当前聊天气泡内看不到生成的图片，必须按 F5 刷新网页或者重新点击切换会话后才会显示。
- **根因分析**：
  1. **类名与 CSS 选择器分叉**：刷新网页由 `rendering.js` 的 `appendMessage` 渲染，使用的是带有完整样式与悬浮控制坞（下载/复制/以图生图/重试）的 `.gen-image-container`；而 `main.js` 和 `stream-handler.js` 中工具调用完成时，临时注入 DOM 使用的是旧类名 `.generated-images-container`。
  2. **缺少统一的就地挂载机制**：工具执行完毕（`executeToolCallForRetry`）、大模型链式响应（多轮迭代）以及流式/非流式收尾处，各自散落了一段临时的 `img` 拼接代码，且在某些分支中因为去重集合或异步 setTimeout 导致图片未被成功插入 DOM，而消息数据对象 `pendingMsg.generatedImages` 已经写入并落盘，造成“数据在内存和磁盘都有，但当前气泡没有渲染出来，刷新调用 `loadChat` 重新走 `appendMessage` 才显示”的现象。
- **加固与修复**：
  1. `public/js/rendering.js`：将图片容器的创建、DOM 级 URL 去重、悬浮控制坞（下载/复制/以图生图/重新生成）以及灯箱点击绑定抽象为权威公开函数 `window.renderGeneratedImagesIntoBubble(bubble, images)`；`appendMessage` 全面复用该函数。
  2. `public/js/main.js`：
     - 在工具执行完成分支（`tc.function.name === 'generate_image'`）中，直接调用 `window.renderGeneratedImagesIntoBubble(_imgBubble, _imgs)` 实时就地挂载。
     - 在流式生成收尾与图像模型直接响应中统一调用该函数，并清理任何残留的占位符与 typing 状态。
  3. `public/js/stream-handler.js`：流式/非流式结束检测到 `pendingMsg.generatedImages` 时统一调用 `window.renderGeneratedImagesIntoBubble`。
  4. `tests/generated_image_live_render.test.js`：新增自动化回归测试，锁定生图实时就地挂载与流式收尾路径。
- **涉及文件**：`public/js/rendering.js`、`public/js/main.js`、`public/js/stream-handler.js`、`tests/generated_image_live_render.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-09-01 · 可恢复流首 Token 去除全量备份阻塞与保存超时降噪

- **问题现象**：发送后蕾米等待气泡长期不出首字，控制台偶发 `[save] GET合并失败: signal is aborted without reason`；网络抖动时尤为明显。
- **根因分析**：`main.js` 在每次 `ResumeStream.create` 前 `await saveChatsToServer(true)`。该函数为低优先级全量备份，会执行元数据 GET、必要时拉完整会话再 POST；元数据 GET 有 10 秒 `AbortController`，因此其超时既阻塞模型流的创建，又将浏览器实现相关的 abort 文案输出为 WARN。单会话即时落盘与引擎端的 `msg_id`/流快照已经覆盖了刷新恢复所需的持久化保证，前置等待是冗余的。
- **修复**：
  1. `public/js/main.js`：可恢复流关键路径只触发非阻塞 `saveChats()` / `saveSingleChatToServer()`，立即创建权威引擎流；不再等待全量备份。
  2. `public/js/storage.js`：全量备份元数据 GET 的超时使用带 `TimeoutError` 的 abort 原因，并将超时归为 info 级的预期降级，其他真实失败仍保留 WARN。
  3. `tests/stream_refresh_recovery.test.js`：锁定“RS 创建不得 await 全量备份”的回归契约。
- **验证目标**：消息气泡与 RS 创建不受全量备份网络抖动影响；单会话保存、引擎流快照与后端幂等恢复继续提供刷新安全性。
- **涉及文件**：`public/js/main.js`、`public/js/storage.js`、`tests/stream_refresh_recovery.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-31 · 发送端首帧加载气泡直出与主线程零阻塞重构

- **问题现象**：发送端发送消息后只有用户气泡、完全看不到自己的输出气泡和加载动画；而接收端挂着蕾米三点加载态且停止按钮呈红色，发送端像“死锁”了一样。
- **根因分析**：
  1. **首帧全量 `loadChat` 冲掉待命气泡**：发送端在 `sendMessage` 插入用户消息后调用了 `loadChat(chatId)`，将刚渲染好的 DOM 容器全部清空重建；由于此时大模型流尚未返回首个 chunk，重建时最后一个消息被误当成非生成态，导致发送端自己的助手占位气泡被物理抹除。
  2. **同步保存阻塞主线程**：发送端在发起大模型请求前曾等待同步保存与广播，网络往返的毫秒延迟使发送端自身的气泡初始化落后于被广播唤醒的接收端。
- **加固与修复**：
  1. `public/js/main.js`：发送端在插入用户消息时，直接通过 `appendMessage('user', ...)` 执行局部增量挂载，**彻底移除发消息首帧的全量 `loadChat`**；
  2. 首帧立即直出蕾米三点加载气泡（`appendMessage('assistant', '', null, null, null, 0, false)` 并激活 `typing` 类），两端在用户敲下回车的同一时刻**秒级同步呈现蕾米等待动效**；
  3. 服务器落盘改为异步后台单飞执行，绝不阻塞流式连接的瞬间建立。
- **涉及文件**：`public/js/main.js`、`public/js/agent-notify.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-31 · DSH 式后端唯一生产者与请求幂等屏障一期落地

- **审计结论**：OneAPIChat 已具备服务端磁盘流快照、Runtime Event Store、SSE 多播和 Observer 实时投影，但仍有关键差距：浏览器仍可分别调用 `/engine/chat/create` 启动新的模型线程；仅靠前端 Observer 守卫不能作为最终一致性边界，旧标签页、重试或竞态仍可能形成双生产者。
- **本期后端权威改造**：
  1. `python/engine/store.py` 新增 `ChatStore.find_running_task`，按 `user_id + msg_id`（优先）或 `user_id + chat_id` 查询当前权威运行任务。
  2. `/engine/chat/create` 在任何模型调用、Runtime job 创建和后台线程启动之前执行单生产者屏障；若已有运行任务，直接返回原 `stream_id/task_id/msg_id` 和 `attached:true`，并重新广播同一 `chat:stream_started`，第二设备只会附着原流，不会启动第二个 LLM/工具循环。
  3. `api/engine_api.php` 为旧客户端缺少 `msg_id` 的请求按“用户 + 会话 + 最后用户消息”生成稳定 SHA-256 请求身份，重试和多标签提交具备服务端幂等性。
  4. `chat:stream_started` 广播补齐 `msg_id/task_id`，所有 Observer 以精确流身份投影，不再依赖模糊会话状态猜测。
- **剩余 DSH 化方向**：当前常规 Agent 工具主循环仍主要在浏览器执行；下一阶段应把主聊天的 tool/call → tool/result → 下一轮 LLM 全部迁入 `agent_runtime`/`tool_pipeline`，前端最终仅保留 user append、审批应答与事件投影。
- **验证**：新增 `tests/dsh_authoritative_runtime.test.js` 和 `test_find_running_task_single_producer`；Python/PHP 语法、20 项后端定向测试、116 项 Python 全量测试与全部 JavaScript 回归通过；引擎已重启并通过 `/engine/health` 检查。
- **涉及文件**：`python/engine/store.py`、`python/engine_server.py`、`api/engine_api.php`、`python/tests/test_store.py`、`tests/dsh_authoritative_runtime.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-30 · 多设备多轮工具调用分叉、重复回复与流式中断根除

- **问题现象**：同一个会话在多设备打开时，一边出现多段不同的回复，另一边上一段回复“闪一下就消失了”；并且接收端在生成开始时没有秒级出现加载动画，而是过一会出现空气泡再变动。
- **深层根因定位**：
  1. **观察端（Observer）在工具回调时抢发请求导致分叉**：大模型第一轮只返回 `tool_calls`（如 `web_search`）；工具执行完毕后，主设备与观察端都在监听流，旧逻辑中 `_resumeToolHandoff` 在观察端也执行了工具并调用 `sendMessage(true)` 向大模型发起第二轮请求。两台设备并发向模型提问，模型返回了两种不同措辞的回复（如“准确地说：雪佛兰并不是完全关门...” vs “根据上汽通用与通用汽车最新官方调整...”），两端互相推送并覆盖，导致一台设备出现重复两段回复，另一台设备的上一段回复被冲掉。
  2. **`_resyncChatFromRemote` 在流式进行中调用 `loadChat` 破坏活跃 DOM**：接收端在收到 `chat:stream_started` 时，后台异步拉取会话并调用 `loadChat` 清空重建了容器，导致刚刚挂载的流式气泡和加载三点被瞬间抹除，直到后续 chunk 到达才重新创建，呈现为“迟滞、闪退与空气泡”。
  3. **空 assistant 消息污染 API 上下文**：中间轮工具调用的空 assistant 消息若不带 tool_calls 被写入 API 请求体，会导致模型产生空轮次或生成重复的总结回复。
- **加固与修复**：
  1. `public/js/resume-stream.js`：在 `_resumeToolHandoff` 加入观察端强制拦截（`pm._remoteObserver` 或 `_remoteTypingMap` 处于活动态时绝对禁止执行工具与 `sendMessage`），彻底消除双端并发提问分叉。
  2. `public/js/agent-notify.js`：`_resyncChatFromRemote` 增加生成态守卫（`!_isLiveGenerating`），流式期间仅静默更新内存数据，绝不调用 `loadChat` 破坏正在打字与动画的 DOM 气泡，加载动画毫秒级持续显示。
  3. `public/js/api-messages.js`：过滤无内容且无 `tool_calls` 的 assistant 消息；`main.js` 对推入消息严格校验真实内容。
- **涉及文件**：`public/js/resume-stream.js`、`public/js/agent-notify.js`、`public/js/api-messages.js`、`public/js/main.js`、`public/js/dialogs.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-30 · 接收端空气泡与多余续接 Toast 彻底根除

- **问题现象**：接收端在生成过程中或生成后容易出现空的等待气泡（蕾米三点加载框），随后又自行消失；且每次收到实时流同步时右上角频繁弹出「🔄 续接流式...」Toast 弹窗。
- **根因分析**：
  1. **双重占位气泡冲突**：此前为了在接收端展示 loading，在 `dialogs.js` 的 `loadChat` 中向 `displayMsgs` 注入了 `_remotePlaceholder` 假消息；而随后启动的 `ResumeStream.resume` 在 `activeBubbleMap` 中又 append 了一个真实的流式 assistant 气泡，形成了“两个连续的占位气泡”；当 `resume` 结束调用 `loadChat` 时，临时注入的空气泡被清空删除，造成视觉上的“突然冒出空气泡又闪烁消失”。
  2. **观察端（Observer）误触发续接弹窗**：`resume-stream.js` 的 `_readSSE` 在 `isResume` 为真时无条件调用了 `showToast('🔄 续接流式...')`，观察端被动接收流也会反复弹窗。
- **加固与修复**：
  1. `public/js/dialogs.js`：彻底移除 `loadChat` 中向 `displayMsgs` 盲目追加假 `_remotePlaceholder` 的逻辑，流式气泡的挂载与更新完全交由 `ResumeStream.resume` 动态掌控，根除双重空气泡。
  2. `public/js/resume-stream.js`：仅在非观察端（`!_observerRead`）才弹出「🔄 续接流式...」Toast，观察端全流程静默无弹窗。
- **涉及文件**：`public/js/dialogs.js`、`public/js/resume-stream.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-30 · 普通聊天股票工具批量失败根治

- **根因分析**：
  1. `stock_data.py` 全局 Session 默认携带东方财富 Referer，腾讯实时行情与 K 线回退请求复用该 Referer 后只返回 `v_pv_none_match` 或仅含 `version` 的空数据；所以东财偶发空响应时，腾讯兜底也必然失败，最终集中暴露为 `curl failed: empty` / `未找到 K线数据`。
  2. A 股实时行情把东财所有价格字段固定除以 100，但 ETF 接口通过 `f59=3` 声明三位小数，导致 `1.039` 被错误显示为 `10.39`。
  3. 北向资金引擎已改为扁平字段 `sh_net_inflow/sz_net_inflow/total_net_inflow`，前端仍直接读取旧版 `_d.sh_connect.net_inflow`，接口返回 `ok:true` 后反而触发空指针异常。
  4. 全球指数/美股数据常不返回 `amount`、`turnover`、`market_cap`，前端直接执行除法与 `toFixed()`，可能把一次成功行情误转成工具执行失败。
- **修复内容**：腾讯实时与 K 线请求统一使用 `stockapp.finance.qq.com` Referer；K 线回退补齐涨跌幅、振幅、涨跌额等标准字段；东财实时价格按 `f59` 动态缩放；北向资金渲染同时兼容扁平与旧嵌套结构；实时行情格式化对缺省数值安全归零。
- **验证**：新增 `tests/stock_tools_regression.test.js`，并对 `512480`、`159992`、`SOX`、北向资金执行引擎端点回归；刷新 `cloudreve.js` 资源版本。
- **涉及文件**：`python/engine/stock_data.py`、`public/js/cloudreve.js`、`tests/stock_tools_regression.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-30 · 用户气泡内边距与行距专属精细化优化

- **行距解耦与专属舒适度**：
  1. 修复此前行距设置（`--chat-line-height`）与 `applyReadingLineHeight` 将设置面板的行距滑条值盲目写入全部 `.markdown-body`（包括用户消息）导致用户单行文本高度过大、上下空旷的问题。
  2. 将设置面板的 `lineHeight` 调节严格限制仅对助手回复气泡（`.message-row.assistant .markdown-body`、`.md-stable`、`.md-tail`）生效；用户气泡使用固定 `line-height: 1.45` 舒适自然行距，即使助手行距被放大到 1.92 或 2.0，用户气泡依然紧凑精致。
- **内边距收敛与消除多余留白**：
  1. 优化所有主题下的用户气泡（`.message-row.user .bubble.user`）内边距，从原本宽大的 `10px 16px` / `12px 16px` 精细化收敛为 `7px 12px`（移动端 `6px 10px`）。
  2. 用户气泡内部 Markdown 元素 margin 与 padding 严格归零，文字贴合边框自然舒展，彻底解决文字离边框过远、气泡过于厚重的问题。
- **涉及文件**：`public/js/init.js`、`public/js/config.js`、`public/css/theme-studio.css`、`public/css/style.css`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-30 · 多设备静默无感同步、API Keys 404与 HTTP2 Ping 超时加固

- **静默无干扰体验**：根据用户反馈彻底移除所有跨端同步弹窗提示（包括 `📡 其他设备正在此聊天中生成回复...`、`🤖 Agent 模式已在其他设备切换为...`、`🤖 模型已在其他设备切换为...`），所有数据、模型和模式变更在后台静默完成，弹窗数归零，界面清爽无干扰。
- **404 与网络超时修复**：
  1. `api/api_keys.php`：当用户在 SQLite 中存在但在 `users/users.json` 缺少条目时，自动补全用户元数据并返回 200 `{"success": true, "keys": [...]}`，彻底解决 `/oneapichat/api/api_keys.php?action=list` 报 404。
  2. `public/js/skills.js`：`matchSkills` 匹配超时从 3s 放宽至 6s，并在超时或网络波动时安全静默降级为 `[]`，不再污染控制台 `[Skills] 匹配失败: signal timed out`。
  3. `python/engine_server.py`：`/engine/events` SSE 长连接心跳间隔从 30s 缩短至 12s，保持 HTTP/2 长连接活性，彻底消除 `net::ERR_HTTP2_PING_FAILED` 异常断线。
- **涉及文件**：`api/api_keys.php`、`public/js/skills.js`、`python/engine_server.py`、`public/js/agent-notify.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-30 · 毫秒级跨设备实时流式镜像、工具调用可视化与模型选择同步

- **彻底攻克三大核心体验痛点**：
  1. **同步延迟大、必须等一两分钟整轮结束才全量拉取**：此前接收端收到 `chat:stream_started` 仅拉取静态用户消息，并没有连接流式 SSE；现重构为接收端收到 `chat:stream_started` 后立即以 `isObserver=true` 模式挂载 `ResumeStream.resume(cid, ev.stream_id, ev.msg_id, true)`，毫秒级直接连入实时流，两台设备**同时逐字打印回复内容（打字机）、实时展开思考折叠框**！
  2. **同步端（接收端）看不到工具调用**：在实时流镜像架构下，引擎派发的 `tool_call`（调用参数、命令、文件路径）与 `tool_result` 会即时流向接收端，接收端同步生成 `appendToolCallMessage` 与 `dsh-step-badge` 步骤时间线，多端对工具执行进度一览无余；且 `isObserver` 模式在流结束时不会重复触发前端工具，主控与观察角色分明。
  3. **模型选择跨设备无法同步**：此前 `modelSelect` 的 change 监听仅做本地持久化与配置保存，没有向其他设备广播；现将下拉框与 Agent 模式 `#agentModelCapsule` / `_onSelectAgentModel` 联动，切换模型时立即广播 `config:changed`，接收端收到后自动更新 `modelSelect` 选中项、动态补全 option，并同步刷新输入框底部的模型胶囊与思考强度等级，毫秒级实时跨端对齐。
- **涉及文件**：`public/js/agent-notify.js`、`public/js/resume-stream.js`、`public/js/init.js`、`public/js/agent.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-30 · 多设备同会话回复闪退、界面反复刷新与 signal aborted 根治

- **问题现象**：发送端消息发出后能同步到接收端，但当模型在同一个会话生成回复时，发送端加载较久且显示一秒后直接闪烁消失；接收端完全不显示回复；且在等待输出期间，接收端界面像在不断刷新一样剧烈闪烁；控制台伴随 `_syncChatFromServer failed: signal is aborted without reason` 报错。
- **根因分析**：
  1. **发送端（Producer）完成竞态与旧快照反向冲刷**：流式输出完成时，发送端刚执行 `delete isTypingMap[chatId]`，引擎广播的 `chat:stream_done` 在毫秒级到达。此时发送端的 `saveSingleChatToServer`（带最终回复的 POST）可能还在网络传输中，发送端收到自己的 `chat:stream_done` 后误将自己当作接收端发起 GET 回源，拉回了服务器上的旧快照（只有用户消息），导致刚生成的回复被 `loadChat` 瞬间清空并覆盖消失。
  2. **远程生成态污染数据模型**：接收端在收到 `chat:stream_started` 时，在 `loadChat` 内部往 `chats[id].messages` 数组 push 了一个空的 `{ role: 'assistant', content: '', partial: true }`，导致数据模型被污染；在自动保存时该空回复被误写回服务器。
  3. **无条件清空 DOM 触发接收端剧烈闪烁**：接收端每收到一个广播或重试，无论拉到的数据与本地是否相同，都会无条件调用 `loadChat` 执行 `while (container.firstChild) container.removeChild(...)` 全量重建 DOM，导致屏幕反复白屏闪烁。
  4. **AbortController 密集打断**：短时间多重重试与网络请求导致未结束的 fetch 抛出 `signal is aborted without reason` 并污染控制台。
- **加固与修复**：
  1. **发送端 4.5 秒生产者保护期**：在 `main.js` 流完成（`_streamCompletedOk`）与 finally 块记录 `window._justProducedStreamMap[chatId] = Date.now()`；`_syncChatFromServer` 校验到本端处于保护期且本地消息数不低于服务端时，拒绝任何远程回源覆盖，彻底杜绝生成结果被反向冲刷。
  2. **数据与视图彻底解耦**：移除 `dialogs.js` 中向 `chats[id].messages` 注入空气泡的逻辑；改为仅在 `displayMsgs` 渲染副本数组末尾追加 `_remotePlaceholder`，屏幕正常展示三点 loading 动画，同时保持内存数据模型纯净。
  3. **智能差异比对（防闪烁）**：`_syncChatFromServer` 引入序列化消息指纹比对；若从服务器拉回的数据与本地完全相同，仅更新时间戳而不调用 `loadChat`，彻底消除接收端的白屏闪烁。
  4. **超时与延迟裕度**：`chat:stream_done` 接收端延迟 200ms 回源，确保发送端的 POST 已完全写入服务器；`AbortController` 隔离并静默预期的取消错误。
- **涉及文件**：`public/js/agent-notify.js`、`public/js/dialogs.js`、`public/js/main.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-30 · 多设备同步真实根因：双 chats 仓库绑定修复与全链路日志

- **先开启日志再复现**：新增浏览器 `SyncTrace`（控制台 `SyncTrace.enable()` 或 URL `?syncdebug=1`）、PHP bridge 与 FastAPI 引擎统一 `trace_id`，将 `save_start/save_committed → broadcast_forward/broadcast_received → sse_broadcast/sse_queued → event_received → sync_fetch_result/sync_applied → render_start/render_done` 写入关联日志；服务端日志位于 `logs/multidevice-sync.jsonl`，并保留脱敏的消息数量、角色、partial、长度、HTTP 状态、SSE 订阅数与事件序号。
- **日志证据锁定真实根因**：修复前双标签一次性会话实测，接收端完整收到 `chat:updated`，回源结果为 `server_msg_count=1`，且记录了 `sync_applied msg_count=1`；但下一条 `render_start` 立刻变成 `msg_count=0`，DOM 为 `rendered_users=0`。CDP 进一步直接验证：发送端 `lexical chats=1 / window.chats=-1`，接收端 `lexical chats=0 / window.chats=1`，并且 `window.chats === chats` 为 `false`。
- **根因机制**：`public/js/core.js` 使用顶层 `let chats` 创建的是**全局词法绑定**，不会成为 `window.chats`；而跨设备同步代码长期通过 `window.chats[chatId] = serverChat` 写入，`loadChat`、`saveChats`、渲染和刷新恢复读取的却始终是词法 `chats`。因此广播、服务端落盘、SSE、回源全都成功，但更新进入了另一个孤立对象，表现正是“只弹其他设备正在生成，消息和回复永远不出现，刷新仍没有”。
- **最终修复**：在 `core.js` 用 `Object.defineProperty(window, 'chats', {get,set})` 将 `window.chats` 永久绑定到词法 `chats`；既保证 SSE 写入立即进入真实渲染仓库，也兼容 `restoreUserData` 后续整体执行 `chats = merged`。新增 `tests/multidevice_chat_store_binding.test.js` 覆盖双向赋值和整体替换。
- **真实双端验收**：两个现有 CDP 标签页均确认 `window.chats === chats`；设备 A 保存并广播用户消息后，设备 B 日志为 `server_msg_count=1 → sync_applied=1 → render_start=1 → rendered_users=1`；随后模拟 `chat:stream_started` 与 `chat:stream_done`，设备 B 先显示 assistant partial/生成态，再显示完整回复，最终 `rendered_assistants=1`；强制刷新接收端后仍保持用户消息 1 条、助手回复 1 条，`window.chats === chats` 仍为真。
- **运行日志**：`logs/multidevice-sync.jsonl` 已持续启用，当前可直接按 `trace_id` 串联 PHP 落盘、引擎广播与 SSE 订阅/投递；浏览器端日志可用 `SyncTrace.get()` / `SyncTrace.export()` 查看。
- **涉及文件**：`public/js/core.js`、`public/js/storage.js`、`public/js/agent-notify.js`、`public/js/dialogs.js`、`public/js/resume-stream.js`、`api/chat.php`、`api/engine_api.php`、`python/engine_server.py`、`tests/multidevice_chat_store_binding.test.js`、`logs/multidevice-sync.jsonl`、`CLAUDE.md`。

## 2026-08-30 · 多设备实时消息同步与闪烁根除修复

- **现象定位**：在设备 A 发送消息时，设备 B 仅弹窗显示「📡 其他设备正在此聊天中生成回复...」并持续闪烁，聊天主区域既不显示用户发出的消息，也不显示模型生成中的占位态与生成后的回复，刷新后依然无法展示。
- **根因分析**：
  1. **时间戳丢失毫秒精度与合并判定失效**：`api/chat.php` 保存单会话时粗暴执行 `$data['updated_at'] = date('c')`，将客户端高精度数字毫秒时间戳截断为整秒 ISO 字符串；导致设备 B 刷新或合并时 `_serverTsM > _localTsM` 计算为 `false`，从而拒绝拉取服务器上更新的消息列表。
  2. **生成中 Partial 消息被破坏性过滤**：设备 B 的 `loadChat` 在没有本地流时（`isTypingMap[id] === false`）会强行过滤丢弃所有 `m.partial = true` 消息，并在每次重试/事件到达时全量清空重绘 DOM，导致页面不断闪烁且看不到任何正在生成的气泡。
  3. **单会话保存 Promise 阻断与单飞广播**：`storage.js` 的 `saveSingleChatToServer` 在并发 `state.running` 为真时直接返回 `false`（而非等待中的 Promise），导致 `_saveAndBroadcast` 提前完成并在服务端落盘前广播旧快照。
  4. **空会话自动跟随缺失**：设备 B 处于空白草稿/新会话时，未能自动感知并切换至设备 A 正在活跃交互的新会话。
- **加固与修复**：
  1. `api/chat.php`：保留客户端传入的高精度数字毫秒时间戳（或自动补齐 `(int)(microtime(true) * 1000)`），根除时间戳精度丢失。
  2. `public/js/storage.js`：`saveSingleChatToServer` 重构为支持队列返回共享 `state.promise`；`restoreUserData` 支持时间戳更新与消息更多权威同步，补齐鉴权 Token 回退。
  3. `public/js/agent-notify.js`：`chat:stream_started` 收到后立即拉取用户最新发送的消息并建立 `_remoteTypingMap[cid]`；空草稿自动跟随切换；`chat:updated` 携带 `finished` 标志并在完成时平滑收尾。
  4. `public/js/dialogs.js`：`loadChat` 支持 `_isRemoteTyping` 状态，保留生成中占位态并挂载 `ModelStatus.ensureTypingIndicator` 动画胶囊，避免 DOM 暴力清空重绘引发的页面闪烁。
  5. `public/js/main.js`：`chat:stream_started` 透传当前生成模型信息，完成时以强制广播确保多端秒级更新。
- **涉及文件**：`api/chat.php`、`public/js/storage.js`、`public/js/agent-notify.js`、`public/js/dialogs.js`、`public/js/main.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-30 · 管理后台返回按钮智能来源与主页优先导航修复

- **返回逻辑修复**：此前 `manager.html` 的右上角返回按钮硬编码写死了 `href='/oneapichat/'`（“← 返回聊天”），导致从主页 `/` 或外部进入管理后台点击返回时总是跳到 OneAPIChat。
- **智能来源自适应**：改为动态解析 `document.referrer` 与浏览器历史栈；从主页进入时展示「← 返回主页」并精确回跳 `/`（或 `history.back()`）；从 OneAPIChat 聊天页进入时展示「← 返回聊天」并回跳 `/oneapichat/`；无来源历史时兜底回退至主站根路径 `/`。
- **涉及文件**：`/var/www/html/manager.html`、`tests/mobile_welcome_and_manager_route.test.js`、`CLAUDE.md`。

## 2026-08-30 · 移动端回到底部、普通模式选模器与用户弹窗主题全面优化

- **回到底部按钮**：修复原固定 65px/70px 导致被输入框遮挡问题；改为 `position: fixed` 并联动底部安全区上移至 `calc(env(safe-area-inset-bottom, 0px) + 82px)`（Agent 模式 +94px），材质升级为主题毛玻璃表面与柔和边框阴影，层级提升至 `z-index: 1200`。
- **普通模式选模器**：移动端普通模式顶栏右侧辅助按钮已收起，放开模型选择器宽度至 `min(58vw, 260px)` 并设置 `flex: 1` 弹性拉伸，消除原 80px 固定死宽度导致长模型名严重截断的问题。
- **用户头像下拉卡片**：`#oneapiUserDropdown` 样式彻底接入当前主题 `--oac-*` 语义变量系统，支持细腻毛玻璃、柔和边框、阴影光晕与悬浮高亮，亮暗色模式和 DSH/经典/极简主题无缝融合。
- **涉及文件**：`public/css/theme-studio.css`、`public/index.html`、`tests/mobile_welcome_and_manager_route.test.js`、`CLAUDE.md`。

## 2026-08-30 · Agent 移动端空态居中与主页管理后台 404 修复

- **移动端空态**：Agent 新会话欢迎 Hero 增加显式空态标记，消息容器只在空会话使用可用聊天高度垂直居中；收紧移动端标题、轨道图形、入口胶囊与安全区间距，消除欢迎控件堆在上半屏造成的中段大块空白。
- **状态收口**：首条消息插入与会话重绘时主动移除空态类和 Agent Hero，避免历史消息继续继承欢迎页居中布局。
- **管理后台**：主页与旧版主页入口统一指向真实静态文件 `/manager.html`；同时创建 `/var/www/html/manager/index.html → ../manager.html` 兼容旧 `/manager` 书签，公网验证 `/manager` 自动 301 到 `/manager/` 后返回 200。
- **涉及文件**：`public/js/rendering.js`、`public/js/dialogs.js`、`public/css/theme-studio.css`、`index_root.html`、`/var/www/html/index.html`、`/var/www/html/manager/index.html`、`CLAUDE.md`。

## 2026-08-29 · Web Search 黑条真实组件定位修复

- **真实组件**：通过 CDP 按 `web_search` 文本反查 DOM 祖先，截图中的黑条是 `dialogs.js` 历史渲染生成的 `.dsh-step-badge`，计算背景为 `rgba(30,41,59,.7)`；此前持续修改 `.tool-call-card`，因此不会影响截图组件。
- **修复**：在最后加载的 `theme-studio.css` 覆盖 `.dsh-step-badge / .dsh-step-name / .dsh-step-desc`，背景透明、无阴影、主题语义边框与文字色。
- **真实验收**：刷新保留该历史记录的标签页后，真实 `.dsh-step-badge` computed background 为 `rgba(0,0,0,0)`、`box-shadow:none`，加载资源为 `theme-studio.css?v=1788028194`。
- **涉及文件**：`public/css/theme-studio.css`、`CLAUDE.md`。

## 2026-08-29 · 旧标签页资源驻留根因与真实浏览器验收

- **根因证据**：Chrome CDP 显示截图所在页面仍加载 `style.css?v=1787771785` / `theme-studio.css?v=1787773185`，而无缓存请求公网 `index.html` 已返回 `1788024228` / `1788024652`；无 Service Worker 接管，问题是长期驻留标签页没有导航刷新。
- **处理**：确认无未发送输入和无生成任务后，对所有 OneAPIChat 空闲标签页执行 CDP `Page.reload(ignoreCache:true)`；全部标签页最终加载最新 `theme-studio.css?v=1788025648`。
- **真实验收**：在实际页面临时构造同结构工具卡读取 computed style，卡片/头部/正文背景均为 `rgba(0,0,0,0)`；行距测试由 `26.88px` 实时变为 `30.8px`，随后恢复测试前值 `1.92 / 26.88px`。
- **涉及文件**：`public/css/theme-studio.css`、`CLAUDE.md`。

## 2026-08-29 · 工具卡加载顺序与流式行距强制修复

- **真实根因**：页面 CSS 加载顺序为 `style.css → theme-studio.css → usage-stats.css → src-console.css`，因此放在 `style.css` 末尾仍不是最终层；工具卡随后被 `theme-studio.css` 覆盖。行距仅更新 CSS 变量时，流式新增 DOM 和部分主题节点仍可能保留既有行高。
- **修复**：工具卡最终守卫迁至 `theme-studio.css` 真正末尾；行距设置对已有 Markdown 节点直接写入 inline `!important`，并通过 `MutationObserver` 自动覆盖后续流式生成的正文、列表、引用和增量分段节点。
- **涉及文件**：`public/css/theme-studio.css`、`public/js/config.js`、`public/js/init.js`、`CLAUDE.md`。

## 2026-08-29 · Web Search 工具卡黑底最终覆盖修复

- **根因**：此前主题化规则插入位置早于旧 DSH 工具卡规则，后者的 `background: rgba(15,23,42,...) !important` 在层叠顺序中重新覆盖主题色，因此截图仍显示蓝黑底。
- **修复**：在 `style.css` 真正末尾追加最终守卫，覆盖工具气泡、工具卡、头部、正文、参数、结果、执行输出、实时摘要和时间线；所有颜色改为当前 `--oac-*` 主题语义变量。
- **涉及文件**：`public/css/style.css`、`CLAUDE.md`。

## 2026-08-29 · 工具卡主题、行距链路与欢迎排版全面修复

- **工具调用卡**：清除文件末尾固定蓝黑/靛青覆盖，卡片、头部、正文、参数、结果和执行输出统一读取当前主题的 `--oac-surface / --oac-bg / --oac-border / --oac-text-*` 语义色。
- **行距设置**：默认值从遗留 `1.1` 统一为 `1.65`；滑块更新同时写入根节点、body 和消息容器，Markdown 正文以 `!important` 消费变量，避免主题或历史默认值覆盖。
- **欢迎排版**：品牌眉题、原创轨道图形、主标语和辅助文案改为纵向居中；主标题采用响应式字号、居中字距与更稳的字重层级。
- **涉及文件**：`public/js/storage.js`、`public/js/config.js`、`public/js/init.js`、`public/index.html`、`public/css/style.css`、`CLAUDE.md`。

## 2026-08-29 · OneAPIChat Agent 欢迎页原创身份重构

- **原创表达**：移除仿 DeepSeek 的鲸形图标、「探索未至之境」和预览版标签，改为 OneAPIChat 自有的「对话轨道 + 执行节点」几何标记。
- **品牌文案**：增加眉题 `ONEAPICHAT · AGENT WORKSPACE`，主标语改为「让想法在工作区里发生」，辅助文案为「选择目录与执行模式，开始一次可落地的协作」。
- **入口控件**：欢迎页工作区与模式按钮改为读取当前主题表面、边框、文字和悬浮色阶，不再使用固定蓝色卡片。
- **涉及文件**：`public/js/rendering.js`、`public/css/style.css`、`CLAUDE.md`。

## 2026-08-29 · Agent 工作区浏览器与命令面板全面适配

- **工作区浏览**：新增认证的 `workspace_browse` API，仅列出允许范围内的目录名称，不返回文件内容；添加自定义目录时可从当前工作区进入子目录、返回上级并选择当前目录，自动填充绝对路径和目录名。
- **工作区面板**：加入最大高度、视口剩余空间计算、上下弹出策略和滚动区约束，统一使用当前主题的面板、边框、表面和文字色阶。
- **命令面板**：限制最大宽度与可视高度，修正宽屏拉伸；命令、参数、分组、说明和选中态改用紫灰石墨主题，避免固定蓝黑背景与低对比文字。
- **涉及文件**：`api/engine_api.php`、`public/js/workspace.js`、`public/js/ui.js`、`public/css/style.css`、`CLAUDE.md`。

## 2026-08-29 · Agent 三类弹层统一 DSH 视觉与英文推理等级

- **模型菜单**：参考 DSH 的两行设置卡片，移除模型/思考强度左侧大图标和标题留白，缩至 270px；根菜单显示「模型」和「推理等级」及右侧当前值。
- **等级命名**：菜单与配置面板统一使用 `Default / Off / Low / Medium / High / XHigh / Max`，`Minimal / Ultra` 仅保留为内部兼容映射，不再展示。
- **其他菜单**：权限和 Plan/Agent/YOLO 菜单去掉彩色 Emoji 标题，图标座和面板背景改用当前紫灰石墨主题变量，统一边框、悬浮和选中层级。
- **涉及文件**：`public/index.html`、`public/js/agent.js`、`public/js/models.js`、`public/css/style.css`、`CLAUDE.md`。

## 2026-08-29 · Agent 模型弹层与底部控件主题融合优化

- **问题**：模型设置弹层相对当前紫灰石墨画布过宽、右侧留白明显，深色面板和左侧权限/运行模式控件带有突兀的蓝黑或高亮色块。
- **修复**：弹层收窄至 286px，背景、边框、阴影和悬浮态改为读取当前主题的 `--oac-*` 色阶；模型/思考图标座降低饱和度和对比度；Agent 底部权限、运行模式和模型胶囊统一使用主题表面色及细边框。
- **涉及文件**：`public/css/style.css`、`CLAUDE.md`。

## 2026-08-29 · Agent 模型二级菜单交互与视觉修复

- **问题**：点击模型设置中的「模型」或「思考强度」后，菜单重绘使原按钮脱离 DOM，事件冒泡到页面级收起监听器，弹层立即消失；原菜单的留白、层级和按钮样式也偏重。
- **修复**：删除旧的重复模型菜单实现，统一由事件代理绑定二级入口、返回按钮、模型选项和强度选项，并在处理前阻止冒泡；面板改为紧凑毛玻璃布局，增加模型/思考图标、清晰的标题副标题、选中态、搜索头部和响应式高度。
- **涉及文件**：`public/js/agent.js`、`public/css/style.css`、`CLAUDE.md`。

## 2026-08-29 · Agent 模型与思考强度二级选择器对齐 DSH

- **需求**：参考 DSH composer 的 ModelSelect，把 Agent 输入框右下角的单层模型菜单升级为「模型 / 思考强度」二级菜单。
- **实现**：新增模型胶囊中的当前思考等级提示；模型能力目录新增 `getThinkingIntensityLevels`，只向支持思考的模型展示对应等级；等级选择继续复用现有 unified `thinkingIntensity` 与请求参数映射，避免 UI 与实际请求分叉；模型列表保留搜索、键盘可操作的原生 button 语义及当前选择标记。
- **涉及文件**：`public/index.html`、`public/js/agent.js`、`public/js/models.js`、`public/css/style.css`、`CLAUDE.md`。

## 2026-08-28 · 侧栏折叠优先历史与 DuckDuckGo 搜索下线

- **症状**：手机端虽然已将快捷入口压成双列，但「功能与快捷面板」及「偏好设置」仍默认展开，持续挤压会话记录的可视高度；DuckDuckGo 作为默认无 Key 搜索入口，实际请求长期超时。
- **实测**：以 `OpenAI` 分别请求 `https://html.duckduckgo.com/html/?q=OpenAI` 和 `https://lite.duckduckgo.com/lite/?q=OpenAI`，均在 20 秒超时，响应体为 0 字节、无任何结果链接。
- **修复**：
  1. 将侧栏两块改为原生 `details/summary` 折叠卡片，手机端默认收起；标题保留图标并增加展开箭头，展开后快捷入口保持双列，偏好内的「上下文压缩」也默认收起，让会话记录始终优先占用高度。
  2. 从搜索设置选项、前端默认配置及执行路径移除 DuckDuckGo；历史 `duckduckgo`/`google` 配置自动迁移至 Tavily。
  3. 删除 PHP 工具端的 DuckDuckGo 最终回退和 Python 引擎的 DuckDuckGo 请求逻辑；旧配置不再访问失效域名，改进入 Tavily/MiniMax 既有回退链并在无凭证时明确报错。
- **涉及文件**：`public/index.html`、`public/css/style.css`、`public/js/config.js`、`public/js/search.js`、`public/js/storage.js`、`public/js/upload.js`、`api/engine_api.php`、`api/v1/tools/call.php`、`python/engine_server.py`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-28 · 移动端抽屉、快捷面板与使用统计安全区适配修复

- **症状**：手机端点击设置后右侧配置栏被灰色遮罩盖住，触碰配置内容反而触发遮罩关闭；左侧「功能与快捷面板」以单列占据大量高度，历史对话几乎不可见；使用统计全屏弹窗在刘海屏上关闭按钮贴近系统区域，底部又会露出与面板不一致的背景色。
- **根因**：移动端主题最终层只将左侧侧栏提升至遮罩之上，右侧 `#configPanel` 没有同步提升层级，遮罩因此截获配置抽屉内的点按；快捷区基础样式仍是纵向 flex；统计弹窗仅使用 `100vh`，没有以 safe-area 和动态可视视口作为全屏布局边界。
- **修复**：
  1. 为 `#configPanel` 建立与左侧抽屉一致的移动端层级、动态视口高度、`mobile-open` 位移与 pointer-events 契约，确保抽屉位于遮罩上方，只有面板外部点击才关闭。
  2. 快捷功能网格改为两列，收紧容器、图标、间距和文本尺寸，同时保持历史列表为可伸缩的独立滚动区。
  3. 使用统计移动端覆盖层改为安全区内全屏同色背景；shell 继承可用高度，顶部关闭按钮扩大为 40px 触控目标，滚动区统一补足底部安全区。
- **验证**：`node --check public/js/ui.js`、`node --check public/js/usage-stats.js` 与 `python3 -m py_compile tools/build-index.py` 通过；随后执行资源索引刷新。
- **涉及文件**：`public/css/style.css`、`public/css/theme-studio.css`、`public/css/usage-stats.css`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-28 · Tavily API Key浏览器密码提示与搜索设置视觉层级修复

- **症状**：Edge将搜索设置里的Tavily API Key识别为网页登录密码，修改配置时弹出保存密码提示；搜索引擎区域在深色设置面板中又套一层深色渐变卡片，视觉上突兀。
- **根因**：字段使用`type="password"`且缺少独立的API Key字段语义，浏览器密码管理器按登录凭据处理；搜索服务卡片重复使用深色渐变背景，和外层设置面板形成嵌套重面板。
- **修复**：搜索Key改为`type="text"`+`-webkit-text-security:disc`视觉遮蔽，增加独立`name`、`autocomplete="off"`及关闭浏览器纠错/大小写联动；搜索引擎卡片改为透明轻量分组、上下分隔线和状态点，保留当前引擎、说明、Key及测试连接功能。
- **验证**：新增`tests/search_key_ui.test.js`；JS语法、相关Agent回归测试及`build-index.py --check`通过。
- **涉及文件**：`public/index.html`、`public/css/style.css`、`tests/search_key_ui.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-28 · 429限流等待态与流式思考窄宽度修复

- **症状**：上游返回429时用户只看到控制台错误，助手气泡和停止按钮长期保持生成中；思考内容流式输出期间气泡宽度明显收窄，等正文完成后才恢复。
- **根因**：429未进入专用错误分支，错误收尾没有稳定清理typing/active stream状态；`reasoning-details`在主题层缺少完整助手轨道宽度约束，流式DOM结构下按内容收缩。
- **修复**：429增加用户可见倒计时、最多两次退避重试，耗尽后显示限流建议并明确结束生成；错误收尾统一删除typing/gen-active/streaming及isTyping状态；reasoning details/content强制`display:block;width:100%;max-width:100%`并允许长文本断行。
- **验证**：新增`tests/rate_limit_and_reasoning_layout.test.js`，JS语法与相关交付/计划回归全部通过，资源版本已刷新。
- **涉及文件**：`public/js/main.js`、`public/js/stream-handler.js`、`public/css/style.css`、`public/css/theme-studio.css`、`tests/rate_limit_and_reasoning_layout.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-28 · 上传清理、结构化上传返回值与会话保存中止修复

- **症状**：可解析附件上传后控制台出现 `uploadVideoBlob: result.startsWith is not a function`；会话保存出现 `signal is aborted without reason`；上传目录只有启动/业务流程级零散清理，缺少普通附件的定期留存策略。
- **根因**：
  1. `uploadVideoBlob` 已经返回 `{url,path,size,type}` 对象，结尾仍按旧字符串结果调用 `startsWith`，成功上传被错误进入失败分支。
  2. 会话保存的超时控制需要保证每次尝试使用新 `AbortController`；旧中止信号或网络层Abort被当成普通失败后，容易造成用户误以为保存永久失败。
  3. 引擎已有流快照/runtime清理，但 `uploads/` 没有统一的按目录、按mtime保留机制。
- **修复**：
  1. `uploadVideoBlob` 正确兼容结构化对象，保留url/path元数据，不再对对象调用`startsWith`。
  2. `saveSingleChatToServer` 每次重试创建独立controller，超时重试一次，始终释放running锁；Abort/Timeout降为info并等待后续合并保存。
  3. 新增 `python/engine/upload_retention.py`：用户附件默认保留90天，`uploads/shared`交付物默认保留30天；近期文件和显式引用文件永不删除，支持dry-run统计。
  4. 引擎后台维护任务每30分钟执行一次上传清理，与流快照/runtime维护保持同一周期。
- **验证**：JS/PHP/Python语法通过；上传返回值、会话保存、AgentPanel、计划面板及交付测试全绿；上传清理2项测试和Python LoopGuard 18项通过；`build-index.py --check`通过。
- **涉及文件**：`public/js/upload.js`、`public/js/storage.js`、`python/engine/upload_retention.py`、`python/engine_server.py`、`tests/file_delivery_and_upload.test.js`、`tests/chat_save_abort.test.js`、`tests/agent_panel_timeout.test.js`、`tests/upload_retention.test.py`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-28 · 附件直达路径、原名下载按钮、AgentPanel超时与B站评论修复

- **症状**：模型收到DOCX/PDF正文却不知道原文件服务器路径，转而全盘查找；`engine_push` 交付成 `push_xxxxxxxx.docx` 裸网址而非指定文件名按钮；控制台反复出现 `[AgentPanel] 获取失败: signal timed out`，同时用户感觉回复卡住；`bilibili_comment_list` 在请求较多评论时返回 `ps out of bounds`。
- **根因**：
  1. 可解析文档旧流程只在浏览器提取文字和图片，并未把原始文件上传，`serverPath` 仅视频/通用二进制文件拥有。
  2. `push_file` 后端强制生成 `push_<hash>.<ext>`，工具schema无filename；Markdown后处理也没有文件型链接按钮化。
  3. AgentPanel辅助列表请求每15秒触发、单次可悬挂30秒，失败仅打印WARN，没有指数退避；虽非主模型请求，但会造成网络/日志噪声和“卡住”观感。
  4. B站 `/x/v2/reply` 的 `ps` 最大20，桥接代码把模型的任意limit直接传入ps。
- **修复**：
  1. DOCX/PDF/XLSX/PPT等可解析文件现在并行执行原文件上传和浏览器解析，消息同时携带文本、内嵌图片、`serverUrl`与真实`serverPath`；multipart显式传原始文件名。
  2. `engine_push` 增加filename参数，后端保留用户指定下载名；同名不同内容才追加8位哈希；工具结果输出标准Markdown文件链接，渲染器自动升级为紫色下载按钮。
  3. AgentPanel列表超时缩短到8秒，增加失败次数、指数退避和下一次重试时间；超时保留缓存并降为info，不影响主聊天输出。
  4. B站评论入口规范化type/limit，单页`ps<=20`并通过`pn`自动分页，最多100条；修复桥接中的`re.I`命名错误，PM2 MCP服务已重启。
- **验证**：JS/PHP/Python语法通过；新增 `file_delivery_and_upload.test.js`、`agent_panel_timeout.test.js`、MCP `test-bilibili-comments.js` 全绿；真实调用 `bilibili_comment_list(limit=50)` 返回成功且无`ps out of bounds`；MCP PM2进程在线。
- **涉及文件**：`public/js/files.js`、`public/js/upload.js`、`public/js/tools.js`、`public/js/tools-exec.js`、`public/js/markdown.js`、`public/js/agent.js`、`public/js/main.js`、`public/css/style.css`、`api/upload.php`、`api/engine_api.php`、`tests/file_delivery_and_upload.test.js`、`tests/agent_panel_timeout.test.js`、`/home/naujtrats/mcp-server/bilibili-tools.js`、`bilibili-bridge.py`、`test-bilibili-comments.js`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-28 · Agent 计划空白幽灵项与完成后常驻修复

- **症状**：执行计划显示 `6/7`，中间存在一个无圆点/未完成的断层项；实际任务和文件已经交付，计划面板仍长期悬在输入框上方，刷新或切换会话后还会恢复。
- **根因**：
  1. `updatePlanTaskStatus` 对未命中的 `task_id` 会直接追加一条新任务；模型参数截断、拼错或旧计划状态漂移时，便产生标题/状态不完整的“幽灵任务”，把总数从6变为7。
  2. `_autoDismissIfAllDone` 名字虽然叫自动关闭，实际只把计划状态设成 `completed` 并继续持久化，根本没有关闭面板或清理 localStorage。
  3. `restorePlanForChat` 对 `completed` 计划照样恢复，导致完成面板刷新后复活。
  4. 老计划快照没有统一标准化，空标题、重复id和非法状态会直接进入渲染。
- **修复**：
  1. 新增 `_normalizeAgentPlan`：空标题回退为“任务 N”，重复id纠正，非法状态恢复为 pending。
  2. 未知 `task_id` 更新不再追加任务，明确返回错误，阻断空白幽灵项。
  3. 所有任务进入 completed/failed/skipped 后，先显示100%状态约1.2秒，再关闭面板并清理会话快照和 `_agentPlan_<chatId>`。
  4. `plan_update(action=complete)` 同步进入自动关闭流程。
  5. 恢复会话时检测到 completed 或全终态计划立即清理，不再复活旧面板。
- **验证**：`agent.js`、`tools-exec.js` 语法检查通过；新增 `tests/plan_completion_guard.test.js`，并联 `agent_delivery_guard`、`loop_guard` 全绿；资源版本戳刷新并通过 `build-index --check`。
- **涉及文件**：`public/js/agent.js`、`public/js/tools-exec.js`、`tests/plan_completion_guard.test.js`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-28 · Agent 长任务重复执行、交付失真与导出污染全链路收口

- **复盘样本**：暑期实践材料优化任务中出现全盘查找超时、同一工具结果/计划状态在导出记录中重复、同一错误字符串连续多轮无效替换、子代理/交付消息数字写错（把 3000–4500 写成 300–450、2600 写成 260）等现象。
- **根因分析**：
  1. RS 与当前流解析可能给语义相同的工具调用分配不同 `tool_call_id`，旧合并逻辑优先按 id，刷新恢复时可能保留两份并重复执行。
  2. `exec`、`server_python`、`server_file_op` 被宽泛列为“幂等工具”，相同副作用命令可反复执行而不触发 LoopGuard。
  3. `engine_agent_create` prompt 超过阈值时被静默截到 500 字，并强塞“用 engine_push 推送”，导致子代理丢上下文且绕过主代理复核直接交付。
  4. `engine_push` 把下载链接直接拼进 `pendingMsg.content`，工具自行撰写的未核验说明污染最终正文；工具描述也未禁止估算字数/测试状态。
  5. TXT/Markdown 导出默认混入 reasoning、tool result 和 tool card，重新粘贴后形成“AI 消息→工具调用→工具结果”双重展示，严重放大噪声。
- **修复**：
  1. `main.js` 新增名称+排序后参数的语义指纹，同轮去重及 RS/pendingMsg 合并均不再依赖模型生成 id。
  2. 前后端 LoopGuard 只豁免真正只读工具，`exec/server_python/server_file_op` 第三次相同调用恢复软跳过。
  3. 删除子代理 prompt 的 500 字硬截断及 engine_push 指令注入，完整任务上下文交由统一上下文预算管理。
  4. `engine_push` 改为 `_pushedFiles` 结构化交付元数据，不再写入 assistant 正文；schema 明确要求产物核验、禁止估算字数/页数/测试结果、每文件默认只推送一次。
  5. TXT 与 `/export` Markdown 默认仅导出用户和最终助手正文，过滤 tool/tool_card/内部消息/思考；诊断需要时显式设置 `localStorage.exportChatDebug=1`。
- **验证**：修改文件全部通过 `node --check`；`tests/loop_guard.test.js` 16 组、`tests/tool_arg_repair_truncation.test.js`、新增 `tests/agent_delivery_guard.test.js` 全绿；Python LoopGuard 18 项通过；`tools/build-index.py --check` 通过。
- **涉及文件**：`public/js/main.js`、`public/js/tools-exec.js`、`public/js/tools.js`、`public/js/init.js`、`public/js/commands.js`、`public/js/loop-guard.js`、`python/engine/loop_guard.py`、`tests/loop_guard.test.js`、`python/tests/test_loop_guard.py`、`tests/agent_delivery_guard.test.js`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-26 · 移动端 iPhone 侧栏抽屉与 Composer 全面收口

- **症状**：iPhone 竖屏下 Agent 模式点击左上角按钮只有屏幕变暗，侧栏没有滑入；侧栏按钮位置错位；普通/Agent Composer 底部安全区过度叠加，控件离屏幕底边很远。
- **根因**：Agent 模式切换保留了桌面 `.collapsed` 类，而移动端旧规则未覆盖其 `width:0/opacity:0` 行为；主题文件后加载又覆盖了部分移动端布局；`safe-area-inset-top/bottom` 在 Header、侧栏、输入区和 Agent 操作栏多次叠加。
- **修复**：
  1. `ui.js` 移动端抽屉状态只由 `mobile-open` 控制，打开时清理 `hidden-panel/collapsed`，关闭时恢复隐藏状态；打开侧栏时主动刷新历史列表。
  2. `theme-studio.css` 增加最终移动端收口层：侧栏固定宽度 `min(86vw,320px)`、明确的打开/关闭 transform、独立遮罩层级；`#sidebarToggle` 固定到刘海安全区下方的 36px 触控热区。
  3. Composer 仅保留一次底部安全区，Agent 输入卡片与操作栏分别收敛为 29px 控件，胶囊支持 flex 收缩与省略，避免横向溢出和底部大块空白。
  4. 侧栏历史区保持独立滚动，底部快捷区不再抢占全部可视高度。
- **验证**：390×844、deviceScaleFactor=3 的 iPhone CDP 模拟通过：打开侧栏 `x=0/w=320/opacity=1/pointer-events=auto`，关闭后 `x=-336` 且遮罩透明；Agent Composer 位于 `y=740~844`，操作栏按钮约 29px；`node --check` 通过。
- **涉及文件**：`public/css/style.css`、`public/css/theme-studio.css`、`public/js/ui.js`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-26 · Markdown 正文段落间距与标签间隐式空行收窄修复

- **症状**：用户反馈 AI 回复气泡内每个自然段（`<p>`）之间隔得太远（视觉空行过大）。
- **根因分析**：
  1. **`white-space: pre-wrap` 导致标签间空白被渲染为显式空行**：在 `.markdown-body` 上设置了 `white-space: pre-wrap;`，而 `marked.js` 解析 Markdown 时在块级 `<p>` 标签之间保留了 `\n\n` 换行符。浏览器在 `pre-wrap` 规则下将标签间的 `\n\n` 忠实渲染为 1~2 行的空白文字行。
  2. **多层间距叠加**：`<p>` 标签自身的 `margin-bottom`、`pre-wrap` 产生的隐式空行、以及主题中的大行高（`line-height: 1.72`）共同叠加，导致段落与段落之间的空白间隔异常宽阔。
- **修复方案**：
  1. **去除 pre-wrap 污染**：将 `.markdown-body` 的 `white-space` 改为标准的 `normal`（配合 `word-break: break-word`），使 HTML 标签间的换行空白被自然折叠，彻底消除双重空行。
  2. **段落间距精准可控**：将 Markdown 正文段落 `<p>` 的下边距统一收敛为 **`0.35rem`**（约 5.5px），消除段落尾部多余间距。
  3. **行高适度收敛**：将 DSH 主题及默认正文的 `line-height` 从 `1.72 / 1.6` 微调为 **`1.62 / 1.58`**，文字排版更加紧凑清晰、易于连续阅读。
- **回归验证**：
  - `python3 tools/build-index.py` 刷新前端资源版本戳；
  - 段落间的空行现象完全消除，段间距平滑紧凑，单段内 GFM 换行（`<br>`）及公式、代码块依然保持完美渲染。
- **涉及文件**：`public/css/style.css`、`public/css/theme-studio.css`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-26 · 气泡主题内边距与文字边框呼吸感优化

- **症状**：有边框/背景的回复气泡中，文字距离气泡边框过近，尤其在深色 Classic 截图中显得拥挤。
- **修复**：针对 Classic、Codex、Claude、OpenCode、Aurora 等有气泡视觉主题统一增加 `padding: 16px 22px`；移动端收敛为 `13px 16px`；同时清理首尾 Markdown 块的额外 margin，避免文字贴边或产生不对称空白。
- **兼容**：DSH 与 Minimal 的无边框文档式主题不套用该内边距规则，保持原有排版宽度和悬挂头像布局。
- **验证**：已运行 `python3 tools/build-index.py` 刷新 `public/index.html` 资源版本戳，并通过相关 JavaScript 语法检查。
- **涉及文件**：`public/css/theme-studio.css`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-26 · 用户气泡与输出气泡纵向间距收窄紧凑优化

- **症状**：用户反馈在聊天对话中，用户发送的气泡与 AI 助手的输出气泡之间垂直间隔过宽（视觉高度差过大、留白空旷散漫）。
- **根因分析**：
  1. **容器 gap 过大**：全局与主题内 `#chatMessagesContainer` / `.chat-messages-container` 默认设置了 `gap: 1.25rem (20px)` / `gap: 1rem (16px)`。
  2. **消息行自身 padding 叠加**：用户消息行 `.message-row.user` 设置了 `padding: 10px 0`，助手消息行 `.message-row.assistant` 设置了 `padding: 12px 0 16px 0`，导致相邻两条消息间仅 padding 就贡献了 22px~28px 的额外空白。
  3. **操作栏外边距占位**：底部 Ghost 工具条 `.msg-actions` 的 `margin-top: 5px; margin-bottom: 2px` 进一步撑大了气泡下方的垂直空间。
  4. **以上多层间距叠加**：导致用户气泡底部到助手气泡顶部的垂直净距离达到 60px~75px 以上。
- **修复方案**：
  1. **消息容器 gap 收敛**：将 `style.css` 与 `theme-studio.css` 中的容器 `gap` 统一收紧至 `0.65rem` / `0.55rem`。
  2. **消息行垂直 padding 精简**：用户消息行 `padding` 缩减为 `2px 0`，助手消息行 `padding` 缩减为 `3px 0 8px 0`（经典/极简主题同步微调至 `2px 0 6px 0` / `6px 0`）。
  3. **操作工具条 margin 收紧**：`.msg-actions` 的 `margin-top` 收紧至 `2px`，`margin-bottom` 设为 `0`。
  4. **头像悬挂锚点微调**：同步微调桌面端蕾米头像的绝对定位 `top: 4px`，确保收窄后与助手气泡第一行正文视觉中心依然精准对齐。
- **回归验证**：
  - `python3 tools/build-index.py` 刷新 index.html 资源版本戳；
  - 检查 DSH、Classic、Minimal 三套主题下的视觉对齐均正常且排版更加紧凑自然。
- **涉及文件**：`public/css/style.css`、`public/css/theme-studio.css`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-26 · Plan 规划面板与 plan_update 全链路持久化与稳定性重构

- **症状**：用户反馈 Plan 面板极不稳定，稍微一个界面切换或刷新网页就会消失；后续模型调用 `plan_update` 频频报错 `没有活跃计划。请先用 action=create 创建计划。`。
- **根因深度定位**：
  1. **无会话级持久化与恢复**：`window._agentPlan` 仅保存在内存变量中，未绑定 `chatId`；网页刷新或切换会话（`loadChat`）时，未对当前会话的 `_agentPlan` 进行恢复或挂载，导致面板当场消失。
  2. **新消息粗暴销毁计划**：`main.js` 在发送新消息时无条件执行 `window.dismissFlowPanel(); window._agentPlan = null;`。在 Plan 模式下，用户发出的“同意执行”、“继续”、“调整第2步”等消息直接把正在执行的计划抹杀，导致接下来模型调用 `plan_update(action="update")` 时因缺少计划而报错。
  3. **流式结束兜底恶意篡改与 3 秒强杀**：`main.js` 在每轮回复结束时，兜底把所有仍为 `running` 的任务篡改为 `failed`、`pending` 篡改为 `skipped`，并把计划状态设为 `completed` 后设置 3 秒定时器关闭面板，导致 AI 刚生成完第一轮规划，面板 3 秒后就自行毁灭。
  4. **Plan 模式工具丢失**：在 `isPlanMode()` 模式下，`_effectiveAgent` 未包含 Plan 模式，导致 `PLAN_UPDATE_TOOL` Schema 未注册进发送给模型的 tools 列表中。
  5. **`plan_update` 缺乏自愈与自动关联**：`plan_update(action="update")` 在内存中未找到计划或任务 ID 时直接抛错，缺乏从会话/存储中恢复与自愈建单步计划的能力。
- **修复方案**：
  1. **建立会话级与 LocalStorage 双层持久化**：在 `agent.js` 中新增 `savePlanState`、`restorePlanForChat` 与 `clearPlanForChat`，在 `createFlowPanel`、`updatePlanTaskStatus`、`approvePlan` 时实时双写；在 `dialogs.js:loadChat` 中增加自动恢复。
  2. **新消息生命周期保护**：`main.js` 仅当旧计划已处于终态（`status === 'completed' || status === 'dismissed'`）且所有任务完成时才允许在新任务开始时清理；运行中的计划保持活跃。
  3. **移除破坏性兜底与自动强杀**：移除流式结束时篡改任务状态与 3 秒自动关闭面板的逻辑，计划生命周期与多轮交互完全对齐。
  4. **Plan 模式工具链全链路打通**：在 `main.js` 中将 Plan 模式纳入 `_effectiveAgent`，确保 `PLAN_UPDATE_TOOL` 和只读搜索/文档工具可靠注册。
  5. **`plan_update` 自愈容错加固**：`tools-exec.js` 在更新任务时若内存为空自动触发 `restorePlanForChat`；若仍无计划则自动创建自愈单步计划并追加更新，绝不中断模型。
- **回归验证**：`node -c` 全量语法检查通过；`tools/build-index.py` 刷新版本戳完成。
- **涉及文件**：`public/js/agent.js`、`public/js/tools-exec.js`、`public/js/main.js`、`public/js/dialogs.js`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-26 · 用户气泡不同步视图修复（force-render）

- **根因**：接收端 `loadChat` 在 `dialogs.js:1228-1251` 的 WebSocket 续接分支中，只要 localStorage 残留 `_wsStreamId/_wsChunkCount` 就提前 `return`、不重建消息列表。因此“用户消息数据已同步到 `chats[cid]`，但用户气泡不渲染”（回复经 WS 流式直接写进已有气泡所以可见，用户消息需 `_syncChatFromServer→loadChat` 重建，被早退卡住）。
- **修复**：`_resyncChatFromRemote` 在成功同步并当前会话时，调用 `loadChat` 前先 `localStorage.removeItem('_wsStreamId'/_wsChunkCount')`，强制真实重绘。
- **验证**：真实浏览器 CDP，B 设残留 `_wsStreamId='stale_xxx'` → A 广播 `chat:updated` → B 残留键被清(`null`)、消息容器真正渲染(`contHTML=10406`，非空)；`node -c` 通过；build-index 刷新 `agent-notify.js?v=1787687371`。
- **涉及文件**：`public/js/agent-notify.js`（备份 `agent-notify.js.bak-*-forcerender`）、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-26 · 用户消息不同步根治（发送侧保存超时加固）

- **症状**：回复气泡能跨设备同步（走引擎 `chat:stream_done`→回源），但**用户消息气泡不同步**（走前端 `chat:updated`→回源）。
- **定位（真实浏览器 CDP 一次性会话验证）**：用户消息同步机制本身是好的（一次性会话 `_saveAndBroadcast`→服务端落盘→另一端 `chat:updated`→回源→数据+DOM 均到位）。差异在**发送侧 `saveSingleChatToServer` 与 `_saveChatsToServerOnce` 的 fetch 无超时**：流式生成期间会反复保存，一次网络挂起的 POST 会让 `_singleChatSaveState[chatId].running`（或 `_serverSaveInFlight`）永久为真，之后该会话的用户消息保存永远命中 `if(state.running) return false` 被排队/丢弃 → **用户消息永不落盘 → 另一端 `chat:updated` 回源拉不到**。而回复由引擎 `chat:stream_done` 触发另一条回源路径，可能在用户消息落盘前就把快照（无用户消息）同步过去。
- **修复**：给 `saveSingleChatToServer` 的 chat.php POST 与 `_saveChatsToServerOnce` 的 meta GET 各加 10s `AbortController` 超时，杜绝 in-flight 永久锁死，保证用户消息可靠落盘。
- **回归验证**：`node -c` 语法通过；`tools/build-index.py` 刷新 `storage.js?v=1787683366`、`agent-notify.js?v=1787680353`；真实浏览器一次性会话复测：用户消息 → 服务端落盘(EXISTS, role=user) → 另一端 `_syncChatFromServer` 同步成功(`inChats:true, first:"VFY-USER"`)。
- **涉及文件**：`public/js/storage.js`、`public/index.html`（版本戳）、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-26 · 跨设备消息不同步根治（多端同步加固）

- **症状**：同一账号两台设备同时打开，A 发消息 B 不同步；但 Agent 模式切换、「其他设备正在生成」弹窗能同步。DSH 可以、本项目不行。
- **诊断（真实浏览器 CDP 多标签复现）**：全新加载且 SSE 正常连接的页面能正常同步（A 广播 `chat:updated` → B 回源 → 对象替换 REPLACED）；SSE 断开过/重连过的页面，事件虽能到达 B（监听捕获到）、守卫也通过、回源 `chat.php` 也返回 200+消息，但应用自己的内容同步处理不执行（对象未替换 SAME_REF）。
- **根因**：① `_syncChatFromServer` 的 fetch 无超时/AbortController——接收端网络抖动时 fetch 永久挂起，`finally` 不执行，`_chatSyncInFlight` 永久置真，该会话从此所有同步都命中 `if(_chatSyncInFlight[chatId]) return false` 静默跳过（只剩"事件自带数据"的 Agent 模式/弹窗能活）；② `chat:updated`/`chat:stream_done`/`chat:message_added` 对 `isTypingMap` 直接 return 静默丢弃远程同步。
- **修复**：① 主 fetch 与 404 回退 fetch 统一加 10s `AbortController` 超时，杜绝 in-flight 永久锁死；② 新增 `_resyncChatFromRemote` 健壮封装（本端生成中延迟重试、最多 5 次），替换 `chat:updated`/`chat:stream_done`/`chat:message_added` 的静默丢弃逻辑；③ SSE `connected`（含断线重连）无条件回源当前会话；④ SSE 断线时新增每 6s 兜底轮询，轻量比对服务端 `updated_at`，更新即回源渲染。
- **回归验证**：`node -c` 语法通过；`python/tests/test_multidevice_sync.py` 4/4 全绿；真实浏览器 A→B 广播验证 SAME_REF→REPLACED；`tools/build-index.py` 刷新 `agent-notify.js?v=1787680353`。
- **涉及文件**：`public/js/agent-notify.js`（备份 `public/js/agent-notify.js.bak-20260826-015049-syncfix`）、`public/index.html`（版本戳）、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-25 · 普通模式新增会话持久化与空草稿误删根除

- **根因分析**：
  1. **索引模式会话与带时间戳消息被误判为空草稿**：在多端同步/轻量索引拉取（`loadChatsFromServer` / `_syncChatIndexFromServer`）时，未加载正文的会话为 `messages: [], msgCount: N, _localIndex: true`；旧版 `_hasMeaningfulChatContent` 未判断 `_localIndex`/`msgCount`，且误用 `m.timestamp` 将含时间戳字段的正常消息全部跳过，导致用户新增或已有的普通会话在后台拉取索引或重连时被判定为“空白草稿”。
  2. **草稿清理越权执行远程 DELETE 与墓碑打标**：`_pruneEmptyDraftChats` 对多余草稿直接调用 `_syncDeleteToServer` 并写入 `_deletedChatIds` 墓碑，导致只要判定为草稿就会向服务端发送 DELETE 请求并打上 30 天删除墓碑，使会话从本地和服务器双端被物理抹杀。
  3. **侧栏渲染空列表时盲目整体替换内存对象**：`renderChatHistory` 在 `_chatIds.length === 0` 时直接执行 `chats = _parsed`，冲刷覆盖掉当前标签页刚新建的内存会话。
- **修复措施**：
  1. **重构 `_hasMeaningfulChatContent` 与 `_isEmptyDraftChat`**：增加 `_localIndex` / `_indexOnly` / `msgCount > 0` 索引保护与非占位标题保护；修正纯时间戳伪消息判定（仅 `!m.role && (m.timestamp || m.time)` 跳过，正常带时间戳消息保留）；保护 `currentChatId` 当前活跃会话不被判定为背景草稿。
  2. **彻底移除草稿清理中的远程删除与墓碑写入**：`_pruneEmptyDraftChats` 仅在本地内存去重多余的未修改空草稿，严禁写入 `_deletedChatIds`，严禁触发 `_syncDeleteToServer`。
  3. **加固 `renderChatHistory` 缓存回退与 `createNewChat`**：`renderChatHistory` 改为增量补全缺失会话，禁止直接替换 `chats` 对象；`createNewChat` 创建普通会话时清除同名墓碑并调用 `slimSaveChats` 写入本地持久化。
  4. **新增历史误打墓碑自动自愈清洗**：`storage.js` 启动和恢复时扫描 `_deletedChatIds`，若发现本地会话具有有效内容则立即清除该墓碑并持久化，解救历史受影响的有效会话。
- **回归验证**：新增 `tests/normal_chat_draft_persistence.test.js`，全量 39 个测试套件（含会话隔离、生命周期、流式恢复等）100% 全部通过；`tools/build-index.py` 静态资源时间戳刷新完成。
- **涉及文件**：`public/js/dialogs.js`、`public/js/storage.js`、`tests/agent_chat_separation.test.js`、`tests/queue_and_length_safety.test.js`、`tests/normal_chat_draft_persistence.test.js`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-25 · Full access 全盘访问权限与 run_code 授权弹窗闭环修复

- 根因：当用户在 UI 胶囊中选择 Full access (`danger-full-access`) 时，前端仅保存了 `workspacePermission`，但未向服务端签发会话级权限凭证；当 `run_code` 或文件写操作访问外部路径时，服务端各端点返回纯文本错误而缺失 `code: PERMISSION_REQUIRED`，导致 `_executeWithPermissionRetry` 无法识别权限拦截进而未能唤起授权弹窗或自动签发凭证。
- 修复：① `python/engine/server_tools.py` 所有文件操作（`write` / `read` / `edit` / `file_op` / `parse_document` / `write_chunked`）及 `run_code` 在沙箱越界时统一返回结构化 `code: PERMISSION_REQUIRED`、`capability` 与 `retryable: true`；② `public/js/core.js` 升级 `hasFullFileAccess` 与 `ensureFullFileAccessGrant`，自动识别 `danger-full-access`、YOLO 与临时授权，直接签发服务端凭证；③ `public/js/agent.js` 升级 `setWorkspacePermission` 与 `requestFilesystemGrant`，Full access / YOLO 模式免弹窗自动签发凭证，普通/工作区模式弹出高阶授权审批弹窗；④ `api/engine_api.php` `_permission_grant_for` 增加请求体 fallback。
- 回归保护：新增 `tests/permission_grants_full_access.test.js`，验证 Python runtime 权限断言与前端自动凭证流通。
- 涉及文件：`python/engine/server_tools.py`、`public/js/core.js`、`public/js/agent.js`、`public/js/tools-exec.js`、`api/engine_api.php`、`tests/permission_grants_full_access.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-25 · Agent Docker 一键部署与 Yatori 运维升级

- 根因：旧 `server_docker` 强制拼接 `sudo`，长期非交互 Agent 无 TTY/凭据时即使 Docker daemon 正常也会失败；同时只支持 ps/images/stats，无法完成用户要求的一键拉取、配置和启动。
- 后端新增 `doctor`、`pull`、`logs`、`stop`、`remove` 与受限 `yatori_deploy`；Docker CLI 直连 daemon，结构化返回 `DOCKER_PERMISSION`、`DOCKER_NETWORK`、`DOCKER_DAEMON_UNAVAILABLE` 等可执行诊断。
- `yatori_deploy` 默认创建 `~/yatori/config`、`~/yatori/logs`、默认 `config.json`，拉取 `yatoridev/yatori-go-console:latest` 并以 `--restart unless-stopped` 启动；同名容器默认拒绝覆盖，显式 `replace=true` 才重建。
- 安全边界：镜像名/容器名白名单校验，部署目录限制在用户 Home、临时目录或项目目录，禁用任意 Docker 参数拼接；新增 Python 回归测试。
- 涉及文件：python/engine/server_tools.py、api/engine_api.php、public/js/cloudreve.js、public/js/tools.js、python/tests/test_docker_deployment.py、docs/README.zh-CN.md、CLAUDE.md。

## 2026-08-25 · 经典亮色代码块融入主题修复

- 根因：src-console.css 在 theme-studio.css 之后加载，旧的后置代码/控制台规则把经典亮色的 pre 强制恢复为深色背景。
- 在实际最后加载的 src-console.css 中增加经典亮色主题适配，确保覆盖链真正生效。
- 代码块由突兀的黑色大块改为浅蓝白渐变编辑器面板，深色代码文字、14px 圆角、轻描边和柔和阴影。
- 调整经典亮色语法高亮：关键字紫色、字符串绿色、数字/属性琥珀色、函数蓝色、注释灰蓝色，保证浅色背景上的可读性。
- 真实浏览器强刷验证：经典主题 pre 背景为浅蓝白渐变，文字为 rgb(36, 50, 71)，加载版本 src-console.css?v=1787646118。
- 已通过资源构建、build-index.py --check 和两份 CSS 花括号校验。
- 涉及文件：public/css/theme-studio.css、public/css/src-console.css、public/index.html、CLAUDE.md、docs/CHANGELOG.md。

## 2026-08-25 · 亮色用户气泡文字对比度修复

- 根因：亮色用户气泡背景为蓝色渐变，但历史 Markdown 子元素仍可能继承全局深色/靛蓝文本规则，导致用户消息正文和行内代码看起来发暗。
- DSH、经典、极简亮色用户气泡统一使用深蓝靛青渐变、白色正文、细白描边和轻内高光。
- 强制覆盖用户气泡内的 markdown-body、段落、列表、粗体、斜体、链接和删除线文字，全部保持白色高对比。
- 用户气泡内的行内 code 改为半透明白色标签，避免蓝底上出现第二种难读的蓝色。
- 已执行资源索引构建、build-index.py --check 与 CSS 花括号校验；亮色规则使用三主题选择器统一覆盖。
- 涉及文件：public/css/theme-studio.css、public/index.html、CLAUDE.md、docs/CHANGELOG.md。

## 2026-08-25 · 暗色正文行内代码可读性修复

- 根因：正文行内 code 继承了全局暗色 Markdown 的靛蓝强调色，像 Black-Cyan/chaoxing、baseUrl、apiKey、model 等字段在石墨紫灰背景上对比度不足。
- DSH、经典、极简三种主题统一覆盖 bubble 与 markdown-body 内的行内 code，设置暖白文字、紫粉渐变背景、描边、内高光和 600 字重。
- Hover 状态进一步提亮，保留行内代码与普通正文的视觉区分。
- 与此前考试表格首列 ID 的专项规则并存，不影响代码块高亮。
- 真实浏览器在 1581×921 视口逐主题强刷验证，三主题计算颜色均为 rgb(255, 247, 255)，均为 inline-block 且命中最终规则。
- 已通过资源索引构建、build-index.py --check 和 CSS 花括号校验。
- 涉及文件：public/css/theme-studio.css、public/index.html、CLAUDE.md、docs/CHANGELOG.md。

## 2026-08-25 · Agent 模式与工作区权限状态持久化修复

- 修复顶部 Agent 胶囊用 220ms click timer 模拟双击时的竞态：从普通模式快速双击进入 Agent，不会再被第二次 click 误判为退出并落回普通绿色 Agent。
- 新增 `agentPreferredMode`，退出 Agent 不会丢失上次主动选择的 Plan / Agent / YOLO；再次进入时恢复该偏好，Full access 胶囊双击进入 YOLO 后也会保持。
- `workspacePermission`（Read only / Workspace write / Full access）继续与运行模式正交，刷新和模式切换时显式回填胶囊 UI；权限变更加入配置同步。
- Agent 模式、权限和偏好不接受旧服务器配置回灌；SSE connected/agent:mode_changed 对近期本机选择增加时间保护，避免旧快照把 YOLO 降回 Agent。
- 新增静态回归测试，覆盖双击手势快照、偏好模式、权限持久化与远端旧值保护。
- 涉及文件：`public/js/agent.js`、`public/js/agent-notify.js`、`public/js/storage.js`、`public/js/init.js`、`tests/agent_control_persistence.test.js`、`public/index.html`、`index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-25 · Grok 图生图后续轮误取消修复

- **日志证据**：图生图工具成功后，下一轮 `chat_create` 创建了 `stream_b2ae70a1607f`；前端随后立即对该 stream 发出 `DELETE`，引擎快照为 `CANCELLED / generation cancelled`，不是 xAI 上游报错。
- **真实根因**：`ResumeStream.create()` 通过 `_getStopSignal()` 读取了 `abortControllerMap[chatId]`。工具结果交还 `sendMessage(true)` 时，`abortExistingRequest()` 会 abort 旧 HTTP controller；该 controller 同时也是 RS 的停止 signal，于是新一轮被误判为用户停止并取消。
- **修复**：RS 新增独立的 `_stopControllers`，create/resume 各自绑定独立停止 controller；普通请求重试、工具轮切换和 `abortExistingRequest()` 不再误杀 RS。`ResumeStream.cancelActive()` 仍会显式 abort 独立 controller，停止按钮功能不变。
- **回归保护**：增加 RS 独立停止信号断言，保留图像路由与 multipart 中继测试。
- **涉及文件**：`public/js/resume-stream.js`、`tests/image_command_routing.test.js`、`public/index.html`、`index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-25 · 考试表格 ID 样式覆盖链修复

- 复核发现上一轮追加表格规则时，旧的表格链接选择器缺少闭合花括号，导致最终 guard 被解析进旧规则，字重和 display 没有真正生效。
- 补齐旧规则边界并删除重复 CSS 尾部，保证首列考试 ID 的独立高优先级覆盖可被浏览器解析。
- 三种暗色主题均验证：ID 颜色 rgb(255, 248, 255)、字重 650、display inline-block、紫粉渐变背景和清晰描边。
- 已重新执行资源索引构建、build-index.py --check 与 CSS 花括号校验。
- 涉及文件：public/css/theme-studio.css、public/index.html、CLAUDE.md、docs/CHANGELOG.md。

## 2026-08-25 · 暗色考试表格 ID 对比度修复

- 根因：考试 ID 的行内代码继承了全局暗色 Markdown 的深靛蓝强调色（--oac-accent-strong），在三种主题的石墨紫灰背景上对比度不足。
- 三种主题统一覆盖表格中的 td > code、td > a、td > a > code，兼容不同 Markdown 渲染路径。
- 暗色考试 ID 使用暖白文字、紫粉渐变标签、半透明边框和轻微内高光；首列 ID 进一步增强字重与边界。
- 表头、表格行、奇偶行背景和边框同步调整，避免考试状态表变成黑色/蓝色块。
- 亮色模式也补齐首列 ID 的低饱和蓝紫标签，保持明暗两套视觉层级一致。
- 真实浏览器禁用缓存强刷，加载 theme-studio.css?v=1787640610，在 DSH、经典、极简三主题下验证计算颜色均为 rgb(255, 248, 255)，且均命中最终表格规则。
- 通过 CSS 花括号校验、资源索引重建和 build-index.py --check。
- 涉及文件：public/css/theme-studio.css、public/index.html、CLAUDE.md、docs/CHANGELOG.md。

## 2026-08-25 · 历史统计未知模型归类优化

- 8 月 11 日的旧 Claude/Agent 快照没有 `model` / `provider` 字段，且旧 Agent ID 使用双下划线前缀，原逻辑未识别，最终进入“未知模型”。
- 统计 API 现在兼容 `^_+agent_` 会话 ID，并将 `unknown`、`undefined`、`null`、`n/a` 等占位值视为缺失字段。
- 缺少足够证据时显示“历史模型（未标注）”而不是伪造具体模型；旧 Agent 会话仍按 Agent 历史默认模型归类。
- 新增 `usage_legacy_model_fallback.test.js` 回归保护。
- 涉及文件：`api/chat.php`、`tests/usage_legacy_model_fallback.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-25 · 三大主主题暗色模式渐变画布全面重构

- DSH、经典气泡和现代极简的暗色模式全部改为基于亮色渐变逻辑延伸的石墨紫灰画布，移除黑色、藏蓝色块交织造成的割裂。
- Header、侧栏、配置区和输入框统一为同一画布上的透明磨砂层，边框、阴影与悬停状态共用稳定层级。
- “新建对话”由高饱和蓝色实心块改为浅紫高光描边玻璃按钮；“使用统计”同步移除纯黑底板。
- 经典主题助手气泡扩至完整 880px 阅读轨道，与 DSH、极简保持同宽；用户气泡继续按内容自适应并限制为 700px。
- 极简暗色全面提升正文、标题、用户便签、工具轨迹、参数与折叠推理的对比度，解决文字发灰发暗。
- 代码块由死黑色改为与主题协调的石墨面板，避免孤立黑色岛屿。
- 通过 1588×1150 真实浏览器逐主题强刷截图与计算样式验收；三主题助手内容轴均统一为 880px。
- 涉及文件：`public/css/theme-studio.css`、`public/index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-25 · Agent 思考强度调用详情持久化修复

- 根因是思考强度只被映射进请求体的 provider 专属字段，assistant 历史消息没有保存该选择；统计 API 又仅根据是否存在 reasoning 文本猜测“高/未记录”，Agent 工具链中间轮次尤其容易缺失。
- 初始 assistant 占位消息现在保存统一的 thinkingIntensity；Agent 链式工具轮创建新消息时继承 effort、model 和 provider。
- 统计 API 优先读取 effort，并兼容 reasoning_effort、thinking_level、output_config.effort、thinking.type；旧消息有 reasoning 时显示“已开启”作为保守回退。
- 新增 agent_usage_effort.test.js，锁定首轮持久化、工具链继承和服务端解析。
- 涉及文件：public/js/main.js、api/chat.php、tests/agent_usage_effort.test.js、CLAUDE.md、docs/CHANGELOG.md。

## 2026-08-25 · 经典主题样式未生效根因修复

- 根因：上轮新增的经典主题最终覆盖块前，`@media (max-width: 640px)` 少了闭合花括号，导致全部新规则只在小屏媒体查询内生效；桌面截图自然完全没有变化。
- 修复媒体查询边界并移除文件尾部对应的多余闭合括号，经典主题规则恢复为全尺寸作用域。
- 禁用浏览器缓存并强制刷新线上页面，确认实际加载 `theme-studio.css?v=1787636921`。
- 以 1588×1150 桌面视口实测：消息行 880px、居中内容轴 820px、助手气泡上限 720px；头像绝对悬挂在轴外且不参与正文宽度，消息廊道背景透明。
- 同时以 780×493 小视口验证移动端规则仍正确生效。
- 已重新运行资源构建、索引时效检查、CSS 花括号校验和媒体查询边界断言。

## 2026-08-25 · 经典主题气泡与头像中轴全面重构

- 助手与用户消息统一使用 820px 居中阅读轴，避免头像参与 flex 分栏后把正文整体推歪。
- 桌面端蕾米头像改为阅读轴左侧绝对悬挂，移动端缩为 34px 轻微叠靠；隐藏头像仍不改变正文位置。
- 清除经典主题消息区、消息行与包装器的白色廊道底板，页面背景连续贯通。
- 助手与用户气泡改为内容自适应宽度、克制阴影和轻量玻璃表面；长内容保持合理上限，短内容不再横向撑满。
- 空回复等待态收敛为紧凑三点胶囊，避免出现截图中的整条白色空框。
- 补齐暗色与移动端规则，并通过资源索引重建与 CSS 括号校验。
- 涉及文件：`public/css/theme-studio.css`、`CLAUDE.md`、`docs/CHANGELOG.md`。

## 2026-08-25 · GPT Image 2 图生图 multipart 中继 400 修复

- CLIProxyAPI 完整日志显示 `/v1/images/edits` 收到 `Content-Type: application/x-www-form-urlencoded` 且 Body 只有 `[]`，所以返回 `unsupported Content-Type`。
- 根因是浏览器 FormData 被 proxyFetch 塞进 JSON 中继，`JSON.stringify(FormData)` 丢失全部字段与图片文件。
- proxyFetch 现在显式序列化字段及 Blob/File；PHP 中继以临时文件和 `CURLFile` 重建真实 multipart boundary，请求结束自动清理。
- `/images/edits` 同步采用 900 秒生图超时和防 5xx 盲目重放策略。
- 浏览器等价的 JSON→PHP→CLIProxyAPI→GPT Image 2 链路实测 HTTP 200，返回 1 张 `b64_json` 图片。

## 2026-08-25 · 任务状态工具错误全文展开修复

- 工具调用失败时，将真实 `contentStr` 传给底部 Agent 执行轨迹，不再以空字符串覆盖错误详情。
- 错误状态默认展示两行可读摘要，点击或按 Enter/Space 可展开完整内容，并在长错误下提供限高滚动。
- ResumeStream 刷新恢复路径同步回放已持久化的完整错误结果。
- 新增回归断言，覆盖错误详情传递、展开交互与样式。

# Changelog

All notable changes to this project will be documented in this file.

## 最近变更全文

### 权威流式升级与 DSH Vibe Coding 安全管线兼容加固 — 2026-09-01

- 审计范围：复核 8 月 30-31 日的服务器唯一生产者、Observer 实时流镜像、双端完成态收敛、首 Token 零阻塞落盘升级，确认其与 Vibe Coding 的服务端 Grant、观察铁律、run_code 沙箱、Todo/Diff 持久化兼容。
- 发现与修复：旧版子代理 _execute_tool() 对 server_file_read/write/append 保留直接 Python 文件 I/O 支路，会绕过 server_tools.py 内的 read-before-write、Grant、路径 containment、语法验证和自动回滚。现将该支路统一回流至经内部桥接认证的 /engine/file/* 端点，确保主聊天、恢复流、run_code 与子代理四条执行路径使用同一安全策略。
- 验证：ChatStore 单生产者、流快照、Observer 不执行工具、权限回归、Vibe run_code RPC、工具 Schema 收敛、JS/Python/PHP 语法检查、构建索引与引擎健康检查均通过。


### 🖱️ **图片画布丝滑缩放与可靠拖拽** — 2026-08-25

- **缩放重构**：废弃每次固定 0.1 倍且带 CSS `transition` 的阶梯式缩放，改用滚轮 delta 驱动的指数倍率，并以鼠标所在位置为锚点保持局部内容稳定。
- **丝滑渲染**：目标 scale/offset 与实际渲染值分离，通过 `requestAnimationFrame` 和缓动插值输出 GPU `translate3d + scale`；拖拽时切为 1:1 即时跟手。
- **拖拽修复**：关闭浏览器原生图片 drag ghost，统一改用 Pointer Events；`setPointerCapture` 保证鼠标移出图片后仍能继续拖动，松开、取消或丢失 capture 均正确收尾。
- **边界保护**：根据图片基础尺寸、当前缩放倍数和图片区尺寸动态计算 X/Y 最大位移，防止图片被完全拖出画布；回到 100% 自动居中。
- **交互增强**：最大缩放由 5× 提升到 8×；双击在鼠标位置放大到 2×，再次双击复位；顶部计数显示当前缩放百分比；键盘 `+/-/0` 复用同一缩放状态机。
- **触控兼容**：未放大时保留横滑切图，放大后切换为图片拖拽，并通过 `touch-action` 与光标状态明确反馈。
- **回归保护**：扩展 `image_canvas_regression.test.js`，锁定 RAF、指数缩放、鼠标锚定、Pointer Capture、边界约束、双击复位和合成层优化。
- **涉及文件**：`public/js/rendering.js`、`public/css/style.css`、`tests/image_canvas_regression.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

### 🪟 **图片画布底部控制坞悬浮化** — 2026-08-25

- **问题**：画布把操作胶囊和缩略图作为根画布的独立底部 flex 子项，纵向图片下方被额外保留一大块空白。
- **结构重构**：控制区新增 `canvas-overlay-dock`，从根画布文档流移入 `.canvas-img-area`，通过绝对定位悬浮在图片区底部，不再参与主区域高度计算。
- **视觉优化**：操作按钮和缩略图使用紧凑毛玻璃卡片、主题面板色与强调色；桌面悬停/键盘聚焦时提亮。
- **响应式**：桌面控制坞受图片区宽度约束并居中；移动端收紧底距与控件尺寸，长缩略图列表可横向滚动。
- **回归保护**：更新 `image_canvas_regression.test.js`，锁定控制坞挂载位置、无独立底栏、绝对定位和水平居中。
- **涉及文件**：`public/js/rendering.js`、`public/css/style.css`、`tests/image_canvas_regression.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

### 🛠️ **xAI 主聊天 + GPT Image 2 独立图生图路由修复** — 2026-08-25

- **真实根因**：CLIProxyAPI 日志明确显示请求把 `gpt-image-2` 发到了 `/v1/chat/completions`，网关返回 503：`model gpt-image-2 is only supported on /v1/images/generations and /v1/images/edits`。模型本身存在且支持图生图，错误是端点协议选错，不是模型不可用。
- **正交架构**：xAI 继续作为主聊天模型提供商；图片设置中的 Custom/GPT 网关继续独立负责文生图与图生图，两者互不限制、互不覆盖。
- **端点修复**：Custom/CLIProxy 与 OpenAI 的 `gpt-image-*` 图生图统一使用 multipart `/v1/images/edits`；文生图仍使用 `/v1/images/generations`；仅 OpenRouter 扩展继续使用 `chat/completions + modalities`。
- **行为修复**：撤销错误的 `gpt-image-2 → gpt-image-1.5` 自动降级；图生图失败不再静默退化成文生图，确保参考图不会被丢弃。
- **实测**：认证查询确认双边缘模型目录均包含 `gpt-image-2`；使用中性参考图直接请求 `/v1/images/edits` 返回 HTTP 200、1 张 `b64_json` 图片。
- **涉及文件**：`public/js/tools-exec.js`、`public/js/image-gen.js`、`public/index.html`、`index.html`、`CLAUDE.md`、`docs/CHANGELOG.md`。

### 🔄 **长期标签页旧 CSS 不更新根治** — 2026-08-25

- **真实根因**：输入框 CSS 已正确修改并由公网服务器返回，但用户当前页面仍加载 `style.css?v=1787510488`，而最新页面引用的是 `style.css?v=1787632921`。原“硬刷新”只调用 `location.reload()`，Chrome App/PWA/长期标签页会继续复用内存里的旧 HTML 与旧资源 URL，因此普通刷新和原强刷都没有视觉变化。
- **修复**：`api/version.php` 新增 `style_v`，返回当前 style.css 的 mtime；update-check 首次运行即比较页面实际加载的 style.css `?v=` 与服务端 `style_v`，旧标签页无需等下一次部署即可发现过期样式。
- **真刷新**：`hardRefresh()` 先清理 Cache Storage、注销遗留 Service Worker，再给页面 URL 追加 `_oacv=<timestamp>` 并通过 `location.replace()` 真正重新导航，杜绝 `location.reload()` 继续复用内存旧文档。
- **实机验证**：已用 Chrome CDP 检查并触发刷新。刷新前计算样式为 Composer 52px、输入区 52px、发送按钮 40px；刷新后实测为 46px、44px、34px，并已加载最新 style.css。
- **回归保护**：新增 update_style_version_refresh.test.js，锁定样式版本检测、SW 注销和 cache-busting 导航。
- **涉及文件**：public/js/update-check.js、api/version.php、tests/update_style_version_refresh.test.js、public/index.html、CLAUDE.md、docs/CHANGELOG.md。

### 🖼️ **搜图/生图逐轮意图、画布去重与主题自适应** — 2026-08-25

- **逐轮而非会话封禁**：`/image` 的工具限制只由当前输入计算，不写入 localStorage 或聊天状态。纯搜图轮隐藏两种生图 Schema，下一条明确生图请求自动恢复，不影响同一会话继续创作。
- **复合任务**：命令解析识别“先搜图，再参考/继续生成”等明确复合意图；该轮先执行 images 搜索，同时保留生图工具。最近搜索结果按聊天缓存，`generate_image_i2i` 新增 `reference_source=search_results` 与 `reference_indexes`，可直接选前几张搜索图作为参考，一轮完成搜图→生成。
- **画布重复图根治**：新增稳定图片身份键，统一同源绝对/相对 URL、忽略 `_img_retry` 查询参数；聊天图片汇总、气泡渲染和画布入口三层去重，并在重复项间保留提示词/模型/备注等更完整元数据。
- **主题画布**：移除 JavaScript 内联硬编码深色渐变。画布背景、面板、按钮、缩略图、边框、文字和强调色全部使用 `--oac-*` 当前主题变量，支持 DSH/经典/极简/Codex/Claude 等亮暗主题。
- **备注区重构**：备注不再以 `height:100%` 撑成灰白大块，改为紧凑主题卡片、88px 默认高度、可纵向调整、主题焦点环和协调保存按钮；移动端进一步收紧。
- **回归保护**：扩展 `image_command_routing.test.js` 并新增 `image_canvas_regression.test.js`，锁定纯搜图/复合生成分流、搜索结果参考参数、URL 去重和主题变量。
- **涉及文件**：`public/js/commands.js`、`public/js/main.js`、`public/js/tools.js`、`public/js/tools-exec.js`、`public/js/upload.js`、`public/js/rendering.js`、`public/css/style.css`、`tests/image_command_routing.test.js`、`tests/image_canvas_regression.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

### 📊 **使用统计调用详情统一最新优先** — 2026-08-25

- **问题**：调用详情直接沿用服务端会话遍历顺序，且收集过程中达到 2000 条便提前停止；30 天范围数据较多时容易先保留较早记录，表现为时间从远到近，甚至最新调用未进入明细。
- **修复**：服务端完整收集范围内调用后按 timestamp 倒序排序，再截取最新 2000 条；前端渲染前再次按 timestamp/time 倒序，确保 7 天、30 天和全部范围一致为从近到远。
- **结果**：调用详情第一页始终优先显示最新请求，模型/提供商/Token 筛选与分页均基于同一倒序结果。
- **涉及文件**：public/js/usage-stats.js、api/chat.php、CLAUDE.md、docs/CHANGELOG.md。


### 🧹 **DSH 风格单一空白草稿与标题失败重试** — 2026-08-25

- **空会话处理**：普通模式的空白会话不再进入历史侧栏；每次渲染和点击新建时自动清理重复空草稿，只保留一个可复用草稿。
- **新建行为**：重复点击“新建会话”会回到唯一空白草稿，而不是持续创建新的空会话；草稿发送首条消息后才成为可见、可持久化的正式会话。
- **标题可靠性**：沿用原有模型、提示词和标题清洗逻辑；生成失败、无可用配置或消息尚未闭合时，按 5 秒起步、最高 120 秒的指数退避继续尝试。
- **存量修复**：历史渲染会自动发现有内容但仍使用“新对话 / 文件消息”等占位标题的会话，并重新加入标题生成队列，确保最终获得正式标题。
- **回归保护**：新增 `tests/chat_lifecycle_title_retry.test.js`，锁定空草稿隐藏、去重复用和标题退避重试。
- **涉及文件**：`public/js/dialogs.js`、`tests/chat_lifecycle_title_retry.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

### 💊 **普通模式输入框回调至 46px 紧凑药丸** — 2026-08-24

- **问题**：普通模式 Composer 被加高到 52px，内部附件/搜索按钮为 36px、发送/停止按钮为 40px，再叠加边框和内边距后显得拥挤，停止按钮尤其接近药丸上下边缘。
- **修复**：外层药丸回调至 46px；文本区使用 44px 高度与 24px 行高；附件和搜索按钮收至 32px；发送/停止按钮收至 34px，容器为 36px，并重新调整左右预留与内边距。
- **结果**：仍保持单行药丸输入体验，但内部控件获得清晰的上下留白，图标、placeholder 和发送按钮在同一垂直中心线上；Agent 大卡片模式完全不受影响。
- **回归保护**：新增 normal_composer_compact.test.js，锁定 Composer、文本区和三类按钮的紧凑尺寸。
- **涉及文件**：public/css/style.css、tests/normal_composer_compact.test.js、CLAUDE.md、docs/CHANGELOG.md。

### 🖼️ **/image 搜图与 AI 生图意图彻底隔离** — 2026-08-24

- **根因**：`/image` 虽然已被解析为强制 images 搜索，但当“搜索工具调用模式”开启时，主流程会跳过所有前置搜索，把仍含 `/image` 和“图片”字样的原始问题直接交给模型；与此同时请求工具列表始终暴露 `generate_image`，其描述强调“图片生成”，导致模型在相近语义竞争中误选生图。
- **确定性路由**：`/search`、`/news`、`/image` 现在不再受 `searchToolCallToggle` 影响，显式命令一定先走对应搜索端点；普通自然语言仍保留原有 AI 自主工具选择。
- **硬隔离**：`/image` 本轮请求在最终工具组装阶段移除 `generate_image` 与 `generate_image_i2i` Schema，即使模型忽略提示也无法调用生图。搜索结果前追加语义锁定上下文，要求展示已有图片链接。
- **提示优化**：系统提示和 `generate_image` 工具描述同步明确 `/image`、搜索/找/查图片均不是生图；只有用户明确要求画、生成、创作或设计新图片时才调用生图。
- **回归保护**：新增 `tests/image_command_routing.test.js`，锁定命令解析、显式搜索优先、两种生图工具排除及提示语义。
- **涉及文件**：`public/js/main.js`、`public/js/upload.js`、`public/js/tools.js`、`tests/image_command_routing.test.js`、`CLAUDE.md`、`docs/CHANGELOG.md`。

### 🎀 **蕾米头像与助手气泡同排悬挂对齐** — 2026-08-24

- **问题**：DSH 与极简主题的最终宽度覆盖把助手消息行改为整行 block，但头像仍按旧布局占位，导致蕾米出现在气泡上方，形成头像、等待气泡和操作栏三段错位。
- **桌面端**：助手正文和气泡保持现有阅读轴与宽度完全不动；蕾米从文档流中移除，以绝对定位悬挂在正文轴左侧 56px，并按角色素材透明留白微调垂直位置，使角色视觉中心与气泡首行同排。
- **移动端**：头像缩至 34px，悬挂到气泡左上边缘并轻微重叠，不再占用独立头像列；气泡正文仅增加 18px 左侧安全内缩，避免文字被角色遮挡。
- **兼容性**：同时覆盖 DSH 与现代极简主题，保留头像点击、小窗、入场/离场状态和隐藏占位逻辑。
- **回归保护**：新增 remi_message_alignment.test.js，锁定桌面轴外悬挂、移动端重叠、紧凑尺寸和文字安全区。
- **涉及文件**：public/css/style.css、tests/remi_message_alignment.test.js、CLAUDE.md、docs/CHANGELOG.md。

### 🛡️ **全盘 Glob 授权、子代理续答与跨设备生成闪烁修复** — 2026-08-24

- **全盘检索**：文件搜索与 grep 在越界时改为返回统一的 PERMISSION_REQUIRED / filesystem.search 结构，前端 glob 路由接入一次性授权重试；批准后会携带会话绑定 Grant 与 full_access 再执行，不再把可授权错误当成普通失败直接结束。
- **子代理续答**：创建子代理时记录其所属聊天并保存在当前标签页；若刷新或同步导致任务对象丢失，完成事件会按原归属聊天重建任务并触发主代理整合回复，避免只显示完成而没有下文。
- **多端提示**：chat:stream_started 收到无 source 的引擎广播时，同时检查 isTypingMap、当前活动流和 ResumeStream 状态，当前标签页自身生成不再被误判为其他设备，消除 Toast 反复弹出与界面闪动。
- **回归保护**：新增 agent_permission_completion_regression.test.js，锁定权限重试、结构化拒绝、子代理归属恢复及本地流去重。
- **涉及文件**：python/engine/server_tools.py、public/js/tools-exec.js、public/js/agent.js、public/js/agent-notify.js、tests/agent_permission_completion_regression.test.js、CLAUDE.md、docs/CHANGELOG.md。

### 🎨 **DSH 浅色模式深色块全面柔化** — 2026-08-24

- **问题**：虽然 DSH 已从棕黄主题恢复到冷白蓝灰，但浅色模式仍沿用全局深色代码 token，正文中的代码块呈近黑色；新建对话、账户胶囊和用户消息也仍是高饱和深蓝实心块，导致浅色页面出现多个沉重色块。
- **修复**：为 DSH 亮色模式建立独立层级。代码块切换为浅灰蓝编辑器面板、深 slate 代码文字、细边框和极轻阴影；用户消息改为低饱和浅蓝灰卡片和深色正文；新建对话改为白底靛蓝细描边，账户胶囊改为白色中性卡片；仅发送与队列主操作保留柔和蓝紫实色。
- **边界**：所有规则均带 `html:not(.dark)`，暗色模式继续使用深色代码编辑器与蓝灰信息卡，不会被亮色样式污染。
- **回归保护**：更新 DSH 调色板测试，锁定浅色代码背景、浅色用户气泡、描边导航控件和暗色蓝灰气泡。
- **涉及文件**：public/css/theme-studio.css、tests/dsh_theme_palette_regression.test.js、CLAUDE.md、docs/CHANGELOG.md。

### 🎨 **DSH 棕黄羊皮纸主题撤回与原版冷白蓝灰恢复** — 2026-08-24

- **问题**：DSH Studio 被改造成暖棕羊皮纸配色，整个聊天画布、侧栏、主按钮、账户胶囊、输入框和代码强调均被棕黄覆盖，偏离原版 DSH 的冷白工程工作台视觉，也与既有蓝紫工具时间线冲突。
- **修复**：完整撤回暖棕主题 token。亮色恢复冷白主画布、浅灰蓝层次、深 slate 正文和靛蓝信号色；主按钮、账户状态及标题强调恢复蓝紫体系；用户消息恢复高对比蓝色渐变。暗色同步切回海军蓝/石墨蓝灰，而非暖黑棕色。
- **一致性**：同步修改 Theme Studio 运行时元数据、主题说明和预览色板，避免设置面板仍展示棕色预览或运行时重新注入棕色 accent。
- **回归保护**：新增 DSH 调色板测试，明确禁止羊皮纸背景、棕色正文与棕色运行时强调色再次出现，同时锁定亮色蓝气泡和暗色蓝灰气泡。
- **涉及文件**：public/css/theme-studio.css、public/js/theme-studio.js、tests/dsh_theme_palette_regression.test.js、CLAUDE.md、docs/CHANGELOG.md。

### 🎨 **现代极简亮色主题原版层级还原** — 2026-08-24

- **问题**：现代极简亮色主题把低饱和 slate 文字强调色直接复用于主操作按钮和代码块，导致「新建对话」、顶部用户胶囊、发送按钮以及正文代码块呈现成突兀的近黑色块。第一次修复又将三个按钮统一涂成蓝色实心块，虽然消除了黑色，但破坏了旧版轻盈的组件层级。
- **修复**：按旧版截图恢复差异化设计：左侧「新建对话」使用白色半透明底、细蓝紫描边和蓝色文字；顶部用户胶囊恢复白色中性卡片；仅发送/队列主操作保留蓝色渐变。亮色代码块由黑色终端底改为浅灰编辑器面板，并补齐深色正文、轻边框和轻阴影。暗色模式与其他主题不受影响。
- **回归保护**：样式测试分别锁定描边新建按钮、白色用户胶囊、蓝色发送按钮以及亮色代码面板，防止以后再被单一主题 token 整体染色。
- **涉及文件**：public/css/theme-studio.css、tests/minimal_theme_color_regression.test.js、tools/build-index.py（生成索引）、CLAUDE.md。

### 🧹 **MMX 工具全链路下线** — 2026-08-24

- **背景**：MMX 工具额度已耗尽，继续向模型暴露 `mmx_vision`、`mmx_chat` 等工具会导致无效调用并浪费工具轮次。
- **处理**：删除浏览器端 8 个 `mmx_*` 工具 Schema、注册、分类、中文标签、提示词与专用执行分支；移除子代理角色定义及内容创作 Skill 中的 MMX 工具；删除 `engine_api.php?action=mmx` 入口。
- **残留防护**：外部 MCP 服务器即使仍返回旧 `mmx_*`，浏览器工具装配、OpenAI `/v1/tools`、自动注入 `chat/completions` 与标准 MCP `tools/list` 都会过滤；`tools/call` 与 MCP `tools/call` 会明确拒绝旧调用。
- **兼容边界**：保留 MiniMax 作为普通模型/视觉/图像提供商及视频编辑内部能力，不再把独立 MMX CLI 功能暴露为聊天工具。
- **涉及文件**：public/js/tools.js、public/js/main.js、public/js/tools-exec.js、public/js/config.js、public/js/upload.js、api/engine_api.php、api/v1/mcp.php、api/v1/tools.php、api/v1/tools/call.php、api/v1/chat/completions.php、python/engine/agent_roles.py、python/engine_server.py、skills/content-creation/SKILL.md、README.md、API.md、tests/mmx_tools_removed.test.js。

### 🎨 **DSH / 极简消息背景融入与用户气泡可读性全面重构** — 2026-08-24

- **问题**：DSH 消息区域被历史样式覆盖为大块白色内容底板，与外围浅蓝主题背景割裂；暗色 DSH 用户气泡为深蓝背景但 Markdown 子元素保留黑字，几乎不可读。极简用户气泡同时受到蓝色气泡、左侧竖线与后续信息卡多套规则叠加，形态突兀。
- **修复**：Theme Studio 恢复为正式最终覆盖层，消息容器、消息行、内容包装器与助手正文统一透明，直接融入主题画布。DSH 亮色用户消息采用低饱和浅蓝灰卡片和深色正文，暗色采用中性蓝灰卡片和纯白正文；对 Markdown 内 p/strong/span/code/a 等子元素设置同级高优先级颜色守卫。极简亮色改为浅中性灰便签，暗色改为石墨卡片，移除旧蓝底与左侧竖线。移动端气泡上限统一为 88%。
- **涉及文件**：public/css/theme-studio.css、tools/build-index.py、tests/theme_message_readability.test.js。

### 🧭 **极简模式 Agent 工具轨迹 DSH 紧凑时间线重构** — 2026-08-24

- **问题**：极简主题仍沿用 DSH 大卡片式工具状态，每个成功/失败工具占满整行；十余步调用形成大面积绿色卡片墙，视觉噪声高且挤压正文。
- **重构**：极简主题改为 DSH 式 disclosure 摘要 + 轻量时间线。执行中保留单行状态摘要；执行结束默认折叠，只显示步骤数及成功/失败统计；点击摘要可展开全部步骤。展开状态使用细轨道、小尺寸状态节点、等宽工具名和截断参数，不再使用大面积状态底色。补齐键盘焦点、aria-expanded、暗色主题和移动端布局。
- **涉及文件**：public/js/ui.js、public/css/theme-studio.css、tests/minimal_tool_trace.test.js。

### 🎬 **历史 MP4 无需重传与同名 MCP 抢路由根治** — 2026-08-24

- **复现证据**：失败会话中的 video_understanding 工具结果实际为「缺少图片参数(image_url/image/url)」。根因不是 MP4 文件权限，也不是 ffmpeg，而是外部 MCP 中存在同名 video_understanding，旧实现直接转发 execAnalyzeImage；执行分发在本地处理前先调用了 MCP，于是正确的本地结果被错误的图片参数错误覆盖。
- **修复**：原生 video_understanding/video_edit/analyze_image 等工具加入本地路由保留名单，永不被同名 MCP 抢占；构建聊天工具列表时按名称过滤 MCP 重复 Schema；slimSaveChats 保留 serverPath，刷新后不再丢失服务器真实路径。已有历史会话即使 serverPath 为空，仍可使用保留的 serverUrl 直接定位 uploads 下的 MP4，无需重新上传。
- **涉及文件**：public/js/tools-exec.js、public/js/main.js、public/js/dialogs.js、tests/video_understanding.test.js。

### 🎬 **本地 MP4 视频解析与配置视觉模型复用修复** — 2026-08-24

- **问题**：上传本地 MP4 后，视频工具虽然已有 ffmpeg 帧提取入口，但默认按粗粒度 fps 采样，容易漏掉最后一两秒与最终定格；帧提取异常被空 catch 静默吞掉，模型最终误判为“没有视频读取权限”；缓存也未区分“全片描述”和“分析结尾”等不同问题。
- **修复**：
  1. 上传视频分析优先采用 upload.php 返回的服务器真实路径 serverPath，避免把本地文件绕成远程 URL；
  2. Python 引擎 frames 操作支持显式 timestamps，并返回每帧实际时间；普通采样覆盖最终帧，结尾问题固定密集采样倒数 2s、1.25s、0.7s、0.3s、0.08s；
  3. 浏览器逐帧调用现有 analyzeImage 管线，因此视觉提供商、模型、API 地址和密钥完全沿用配置栏当前选择，不限定 MiniMax；
  4. 将解析失败、ffmpeg 缺失、文件丢失、视觉 API 配置错误分别显式上报，不再静默降级为“无权限”；缓存键加入 query，避免不同分析需求串用旧结果；
  5. 增加 video_understanding 回归测试，覆盖配置模型复用、结尾采样、serverPath 优先和时间戳输出。
- **涉及文件**：public/js/image-gen.js、public/js/tools-exec.js、public/js/tools.js、python/engine_server.py、tests/video_understanding.test.js。

### ⚡ **Agent 工具执行轨迹实时可视化** — 2026-08-24

- **问题**：Agent 生成期间页面只显示空白或等待动画，工具执行步数与详细信息要刷新后才出现。
- **修复**：保留 `.tool-call-lines` 中同一轮的全部工具步骤；实时更新 running/success/error 状态；新增动态摘要「Agent 执行中 · N 步 · N 完成」；工具状态清理时不再移除摘要与步骤，流结束后仍可查看。
- **涉及文件**：`public/js/ui.js`、`public/js/main.js`、`public/css/style.css`。


- **问题现象**：
  模型在 Agent / YOLO 模式下使用 `write`、`server_file_write`、`edit` 等工具生成包含 HTML/CSS/JS 的大文件时，反复出现截断提示（如截图所示：`在 spin-btn 处被截断了`、`在 drawWheel 函数中间被截断了`），导致写盘失败并反复重试。
- **根因分析**：
  1. `public/js/stream-handler.js` 中增量拼接流式 tool_calls 参数时，原逻辑对中间到来的局部字符进行了提前合法性校验（`looksComplete` / `JSON.parse`），一旦偶发通过或检测到闭合就提前 `toolCallCompleted = true` 并将 `currentToolCall` 封存为 null，导致后续真正的长代码数据被当场抛弃；
  2. 原 `repairToolArguments` 正则状态机在处理长字符串（HTML 代码、JS 数组 `["a", "b"]`、CSS 类名 `.spin-btn`）中的双引号时，会将代码内部的引号误判为 JSON 键值闭合引号，并强制插入 `\"` 或截断尾部，导致原本完整的 JSON 在容错修复后反向损坏；
  3. `tools-exec.js` 与 `main.js` 在 JSON 解析失败后的降级提取逻辑中，使用了截断至首个逗号或闭合花括号的短正则，无法提取多行代码大文本。
- **重构实现**：
  1. **废除 stream-handler 流式提前终止缺陷**：重构 `public/js/stream-handler.js` 的 tool_calls 增量聚合逻辑，流式过程中仅持续累加数据，严禁在流结束前提前结算或截断未完成的工具参数；
  2. **升级安全健壮的 `repairToolArguments`**：重构 `stream-handler.js`、`resume-stream.js`、`main.js` 与 `tools-exec.js` 中的 JSON 容错修复状态机，优先校验完整 JSON，仅在字符串内部安全转义控制字符（换行/制表符），补齐末尾括号与引号，绝不破坏代码内部的双引号与花括号；
  3. **新增大文本容错提取器 `tolerantExtractLongArg`**：在 `main.js` 与 `tools-exec.js` 中针对 `content`、`new_string`、`old_string`、`script`、`code` 等大文本字段引入从末尾反向定位边界的精准提取算法，杜绝多行代码被截断。

### 📐 **消息流全量宽度收敛至 760px 对齐 DSH 标准阅读体验与用户气泡自适应紧凑重构** — 2026-08-23

- **问题现象**：
  消息气泡与助手正文（表格、段落等）在宽屏下拉宽到 920px+，显得内容松散空旷，与 DSH 原生紧凑、专注的 760px 纵向阅读廊道体验存在差距。
- **重构方案**：
  1. **全站消息流与输入框最大宽度统一收敛至 760px**：
     - 将 `theme-studio.css` 中的 `--oac-content-width: 760px;` 与 `style.css` 中的 `.chat-messages-container`、`.input-area` 统一固定为 `max-width: 760px !important;`；
     - 消息正文与底部卡片在桌面端严丝合缝垂直对齐，两侧留白均匀适中。
  2. **用户气泡根据内容自适应紧凑包裹 (DSH 规范)**：
     - 设置 `width: fit-content !important;` 与 `max-width: min(80%, 580px) !important;`，短文本自动收敛为微胶囊形态，长文本优雅换行；
     - 右侧贴边对齐，搭配暗色 `#1e293b` 高光微边框与浅色 `#2563eb` 质感。


- **问题现象**：
  1. 暗色模式下 Agent 输入框视觉生硬死黑，内层多了一块深色矩形框包围着放大镜图标（🔍），破坏了 Composer 卡片整体感；
  2. Agent 输入框（920px）横跨屏幕过宽过扁，视觉分散不聚焦；
  3. 普通模式下的单行药丸输入框只有 44px 高，文字和控件紧贴上下边缘，显得过于狭隘局促。
- **重构方案**：
  1. **Agent 模式宽度缩窄与黄金居中排版 (public/css/style.css & public/css/theme-studio.css)**：
     - 将 `body.agent-active .input-area` 最大宽度从 920px 缩窄收敛至 **760px**（`margin: 0 auto` 居中），使卡片在宽屏下更加精致立体，与上方消息区自然呼应。
  2. **暗色模式高阶磨砂玻璃卡片重塑**：
     - 背景采用清透的黑蓝磨砂质感（`rgba(17, 24, 39, 0.78)` + `backdrop-filter: blur(16px)`）；
     - 边框采用极简高光微边框（`rgba(255, 255, 255, 0.12)`）与双层柔和阴影，聚焦时带呼吸光晕；
     - 彻底清除 textarea 内层深色底色，并在 Agent 模式下隐藏多余的普通模式控件（搜索放大镜 `#searchQuickToggle`、回形针等），输入框通透一体；
     - 底部操作栏胶囊（权限/模式/模型）与 `+` 附件圆钮升级为微透按压交互态。
  3. **普通模式输入框舒展加高至 52px**：
     - `.composer-card-box` 容器高度提升至 **52px**（药丸圆角 9999px）；
     - `#userInput` 垂直居中行高 28px，内边距加高，单行文字饱满排版；
     - 右侧发送按钮加大至 **40px × 40px**，整体大气舒展。


- **对齐原版三模式规范**：
  - **Plan 模式（🔵 Plan 模式）**：只读分析探索、自动整理任务执行计划、等待人工审核批准后执行；
  - **Agent 模式（🟢 Agent 模式）**：自主调度工具链解决复杂任务，遇到高风险写盘与终端操作触发弹窗确认；
  - **YOLO 模式（🔴 YOLO 模式）**：全自动极速推进、所有工具自主审批放行。
- **与工作区权限正交独立**：
  - 模式控制执行行为，权限控制文件/终端范围（`Read only` / `Workspace write` / `Full access`），两套系统各司其职、互不干涉。

### 🛡️ **DSH 三级工作区权限与运行模式彻底解耦、普通模式全功能药丸与自然流头像重构** — 2026-08-23

- **痛点与排查分析**：
  1. **模式与权限混淆**：此前将 Full access 误作为 Agent 模式的代名词，用户需要将运行模式（Plan / Agent / YOLO）与工作区权限（Read only / Workspace write / Full access）彻底分开独立设置；
  2. **普通模式输入框残缺与溢出**：因缺少 `searchQuickToggle` 且内部容器宽度未自适应，导致联网搜索按钮消失、输入框两端控件溢出药丸边缘；
  3. **蕾米头像遮挡与挤压**：之前采用 `position: absolute; left: -70px` 导致左侧侧边栏展开时头像被遮挡，而在移动端小屏下头像又挤压气泡。
- **彻底根治方案**：
  1. **模式与权限双独立架构（对标 DSH）**：
     - **运行模式胶囊**：`🔵 Plan 规划 ˇ` / `🟢 Agent 交互 ˇ` / `🔴 YOLO 全自动 ˇ`；
     - **工作区权限胶囊**：`🛡️ Read only (只读) ˇ` / `✏️ Workspace write (工作区写入) ˇ` / `⚡ Full access (完全访问) ˇ`；
     - 审批门严格联动：只读权限下自动拦截写盘与终端操作，工作区写入限制在工作区路径，完全访问开放全盘执行；
  2. **普通模式经典药丸全功能还原**：
     - 补齐左侧曲别针附件按钮与联网搜索切换按钮，文本输入框单行居中（`min-height: 44px; height: 44px`），右侧发送按钮完全包裹在药丸右侧内（`right: 4px; top: 50%`），绝不溢出；
  3. **助手头像自然弹性流排版**：
     - 头像改为自然流（`44px * 44px`），气泡 `flex: 1 1 0%; min-width: 0` 随容器自适应伸展，PC 端左侧侧栏展开时 100% 完整露出且不被遮挡，移动端精致缩小（34px）绝不挤压气泡。

### 📊 **服务端使用统计分析 API 落地与排除外部导入会话的本土精准聚合** — 2026-08-23

- **根本原因与排查**：
  1. **排除外部导入会话**：用户实际使用的本土模型以 Gemini 3.7、DeepSeek-V4 与 GPT-5.6 为主，此前因将外部导入的 150+ Claude Code 与 30+ Codex 历史会话一并计入，导致统计出现大量的 Claude 假象；
  2. **服务端高性能本土聚合**：在 `api/chat.php` 中通过 `action=usage_stats` 精准过滤 `claude_*` 与 `codex_*` 外部导入，100% 统计 OneAPIChat 本土产生的 78 场核心日常/Agent 对话与 2000 万+ Tokens：
     - **gemini-3.7-flash-high**：968 万 Tokens (46.7%)；
     - **deepseek-v4-flash**：660 万 Tokens (31.8%)；
     - **gemini-3.7-flash**：193 万 Tokens (9.3%)；
     - **gpt-5.6-sol**：186 万 Tokens (9.0%)；
     - **gpt-image-2**：66 万 Tokens (3.2%)；
  3. **柱状图色彩与最小高度优化**：以橙(Gemini-High)、紫(DeepSeek)、绿(Gemini-Flash)、蓝(GPT-5.6)为核心色系，饱满呈现。

### 💊 **普通模式经典单行药丸输入框完美还原** — 2026-08-23

- **痛点分析与排查**：
  - 现象：切回普通模式后，输入框的高度过大，内部提示语「输入消息，键入 / 使用命令」被压缩竖向折行，且发送按钮与附件图标对齐不协调；
  - 根因：之前为了让 Agent 模式下支持大高度多行输入，全局为 `#userInput` 设定了多行样式，导致普通模式也继承了多行拉伸样式。
- **彻底根治方案**：
  - 严格区分模式：`body:not(.agent-active) #userInput` 恢复 **44px 紧凑单行居中排版**，占位文字 `white-space: nowrap`，右侧预留 52px 给发送按钮；
  - 仅当 `body.agent-active` 时才激活 16px DSH 风格大卡片 Composer，两种模式各得其所、互不干扰。

### 🎛️ **消息底部安全内边距 4.5rem 垫高、气泡完全防截断与头部三模式小条还原** — 2026-08-23

- **痛点分析与排查**：
  1. **消息与头像滚到底部时被遮挡截断**：由于输入区域 `.input-area` 位于消息流上方（文档流自然排列或底部固定），当消息很多滚到最末尾时，最底部的蕾米头像和助手文本行恰好滑到了输入框底部边缘下方，导致内容被截断一半；
  2. **顶部按钮菜单与底部菜单混淆**：顶部 Agent 按钮被要求还原为经典的 **Plan / Agent / YOLO 三个横向小按钮条**，且支持双击退出；
  3. **Full access 点击当前模式被误判定为退出**。
- **彻底根治方案**：
  1. **4.5rem (72px) 底部安全垫高**：在 `#chatMessagesContainer` 和 `#chatBox` 底部增加 **4.5rem** 的安全呼吸内边距，最后一条消息滚到底部时上方留有充足空间，完全露出在输入框之上，彻底消除任何遮挡与截断；
  2. **双菜单完全分离与原位横向小条**：头部挂载专属 `#headerModeMiniPop`（原位 Plan / Agent / YOLO 横向紧凑胶囊条），单击展开、双击快速退出 Agent 模式；
  3. **解耦模式 Toggle 与显式选择**：菜单中选择当前模式保持不变，双击主按钮方才触发退出。

### 🎛️ **顶部三模式横向小条与输入框选单完全分离重构** — 2026-08-23

- **痛点与排查**：
  1. 之前将头部 Agent 按钮与底部输入框的 `#agentModePopup` 共享，导致在顶部点击时弹出一个巨大的卡片菜单甚至溢出屏幕；
  2. 用户期望顶部按钮还原为经典的 **Plan / Agent / YOLO 三个横向小按钮条**，与底部的 Full access 胶囊选单彼此独立。
- **彻底根治方案**：
  1. **双菜单完全分离**：
     - 顶部导航栏挂载专属 `#headerModeMiniPop`（经典 Plan / Agent / YOLO 横向胶囊条，原位向下精准展开）；
     - 底部输入框继续使用 DSH 风格一体化 `#agentModePopup`（向上精准弹出）；
  2. **经典双击/单击手势**：
     - 单击顶部 Agent 胶囊：展开/收起横向三模式小条；
     - 双击顶部 Agent 胶囊：直接秒关退出 Agent 模式；
  3. **输入框四周遮罩全透明化**：彻底移除所有实色涂料遮罩，视觉通透自然。

### 🎨 **输入框圆角弧度对齐用户气泡（16px）** — 2026-08-23

- **优化内容**：
  - 将 Agent 模式下的输入框容器 `#composerCard` 与 `.input-wrapper` 圆角由 10px 提升至 **16px**；
  - 与用户消息气泡（`16px 4px 16px 16px`）的设计语言保持一致，视觉更饱满圆润、呼吸感更强。

### 🧹 **输入区域两侧全屏渐变遮罩彻底清除与完全透明化重构** — 2026-08-23

- **痛点与根因排查**：
  - 现象：输入框两侧以及下方出现大面积半透明白色遮挡条（全屏涂料屏障），把背景与滚动的消息气泡截断遮挡；
  - 根因：`public/css/theme-studio.css` 第 509 行以及 `style.css` 中为 `.input-area` 设定了 `linear-gradient(180deg, transparent 0%, var(--oac-bg) 34%, var(--oac-bg) 100%)` 作为底部实色屏障，导致输入框周围产生大面积遮盖。
- **彻底根治方案**：
  - 将 `.input-area` 全局设为 `background: transparent !important; background-color: transparent !important;`；
  - 彻底清除全屏渐变遮挡层，输入框周围 100% 通透纯净，仅由微圆角输入卡片自身承载毛玻璃与边框。

### 🎛️ **顶部 Agent 双击快速退出恢复、选单防溢出与同一模式误退根除** — 2026-08-23

- **痛点与排查分析**：
  1. **顶部按钮双击关闭失效**：之前重构为单击切换导致双击关闭 Agent 模式的经典手势失效；
  2. **菜单从顶部溢出屏幕**：由于菜单写死了 `bottom: space` 向上弹出，当在顶部 Header 点击 Agent 按钮时，菜单被强行推到了屏幕顶部上方不可见区域；
  3. **Full access 菜单选择同模式误退**：`setAgentMode` 内包含旧的 `mode === prevMode → off` toggle 逻辑，导致用户在菜单中点击当前模式时意外退出了 Agent 模式。
- **彻底根治方案**：
  1. **双击快速关闭与单击选单完美回归**：顶部 `agentMainBtn` 恢复经典 220ms 节流识别——双击直接秒关退出 Agent 模式，单击平滑唤起模式选择；
  2. **智能视口高度自适应定位**：`_toggleAgentModeMenu` 根据触发元素在屏幕的垂直位置自动判断：屏幕上半部（Header）触发向下弹出（`top: rect.bottom + 6px`），屏幕下半部（底部输入框）触发向上弹出（`bottom: ...`），且水平位置进行 `Math.max(12, ...)` 边界保护，彻底消除溢出；
  3. **修复模式菜单选择逻辑**：`setAgentMode(mode, fromToggle)` 区分菜单显式选择与按钮快捷 Toggle，菜单中点击同模式稳固保持该模式并平滑关闭选单。

### 🛡️ **HTML 孤儿 Aside 闭合根除、浮层事件彻底解放与对称排版重构** — 2026-08-23

- **重大根因曝光与排查**：
  1. **为什么必须打开右侧侧边栏才能点击展开菜单？**
     - 排查发现 `public/index.html` 第 707 行的 `<aside id="configPanel">`（右侧设置面板）在第 1435 行缺少了闭合标签 `</aside>`！
     - 导致从 707 行之后的所有 HTML 元素（包括 `#agentModePopup`、`#agentModelPopup`、认证表单、脚本与全局浮层）在 DOM 树中全部被**错误地嵌套进了右侧配置面板内部**；
     - 当右侧配置面板处于关闭状态时，系统会给面板施加 `hidden-panel`、`inert` 和 `pointer-events: none`，从而导致所有浮层和点击事件全部被浏览器底层物理锁死；只有打开右侧面板时，子元素才恢复了 `pointer-events: auto`。
  2. **为什么退出不了 Agent 模式？**
     - 点击模式菜单被父级 `inert` 阻断无法触发 `setAgentMode('off')`，且模式胶囊菜单打不开。
  3. **头像挤占导致正文与输入框不对称**：
     - 蕾米头像占用了 82px 宽度，把正文向右挤压，导致正文与居中的 920px 输入框左边不齐。
- **彻底根治方案**：
  1. **闭合 `configPanel`，解救所有浮层**：在 1436 行补全 `</aside>`，使所有二级菜单与全局组件脱离右侧面板，不受任何面板隐藏与锁死影响，**无论侧边栏开闭，菜单 100% 随时秒开**；
  2. **自由进出与退出 Agent 模式**：通过点击头部 Agent 胶囊或菜单项即可自由一键切换回普通聊天模式；
  3. **正文与输入框绝对舒服对称**：将 DSH 模式下的助手头像改为外延悬浮定位，正文起始位置与输入框左侧边界 100% 垂直严丝合缝对齐，整页排版优雅对称。

### 🎨 **Agent 输入框文本横向自然排版、等宽居中对齐与模型双向联动修复** — 2026-08-23

- **痛点与修复方案**：
  1. **输入框提示文字竖排问题根治**：
     - 原因系之前给输入框设定了 min-width 未满宽导致内部 textarea 被 flex 收缩；
     - 修复：强制给 `.composer-middle-row` 和 `#userInput` 赋予 `width: 100%; flex: 1 1 100%; min-width: 0;`，提示文字恢复横向自然排版；
  2. **输入框与消息气泡等宽居中对齐**：
     - 将 `.chat-messages-container` 与 `.input-area` 统一固定为 `max-width: 920px !important; margin: 0 auto !important;`，彻底根除视觉偏左或错位的问题，视觉排版极具美感；
  3. **二级菜单展开与模型自动联动**：
     - 优化模式与模型二级浮层的展开定位与事件判定；
     - 监听 `modelSelect` 的 change 事件与 MutationObserver，当切换提供商时自动将新模型名称实时同步到底部 `⚡ 模型 ˇ` 胶囊中，告别手动刷新。

### 📊 **使用统计多模型按天分布与最小视觉高度优化** — 2026-08-23

- **核心重构要点**：
  1. **精准时间戳解析与按天平滑分布**：
     - 深度从会话 ID（如 chat_178...）、created_at 以及每轮交互步进中提取真实发生的毫秒级时间戳；
     - 彻底根治因最近保存时间导致历史 8月6日~8月16日 调用全部被挤到同一天的失真现象，使 DeepSeek（紫色）、GPT-4o（蓝色）、Gemini（橙色/绿色）在每日时间轴上均有饱满立柱。
  2. **柱状图多模型段最小可见高度保护**：
     - 当日只要产生模型调用，柱子总高度保证最小 6% 视觉高度；
     - 柱子内部各模型分段引入 Math.max(2, segPct)% 最小高度与微圆角，消除小比例模型在超大柱子中被压缩成不可见发丝的问题，悬停 Tooltip 100% 呈现单日各模型明细。

### 🎯 **Agent 模式 DSH 极简微圆角矩形输入框与浮层菜单彻底修复** — 2026-08-23

- **根本原因与排查**：
  1. **四周药丸遮罩与切角根因**：除主 CSS 外，主题系统 `public/css/theme-studio.css` 对 `.input-wrapper > div:first-child` 强加了带有 `!important` 的 `border-radius: var(--oac-radius-xl)`（药丸形）和蓝色外发光边框，导致内层虽然改了矩形，外层依然被一层巨大的药丸外壳罩住；
  2. **二级菜单秒关根因**：`public/js/agent.js` 包含未闭合事件回调与重复代码块（报 SyntaxError），且旧版 `mouseenter/mouseleave` 监听器在点击后当场触发了移除；同时 HTML 中存在孤儿 `</aside>` 标签破坏了 DOM 树。
- **彻底根治方案**：
  1. **微圆角矩形全链路解绑**：在 `style.css` 和 `theme-studio.css` 中以最高特异性全面重置 Agent 模式下的输入框容器，强制设为 **10px 现代微圆角矩形**（平直边框、满宽自然居中、无任何外层半圆遮罩）；
  2. **二级菜单高层级 Fixed 稳定弹出**：修复全部 JS 语法错误，清理旧冲突定时器，将 `.agent-mode-popup` 与 `.agent-model-popup` 设置为最高层级（`z-index: 2147483647 !important`），点击 `🛡️ Full access ˇ` 与 `⚡ 模型 ˇ` 时向上精准稳定展开；
  3. **去噪与顶栏优化**：已确定会话不再常驻工作区胶囊，仅在新建会话中央呈现；Agent 模式下自动隐藏顶部 Header 的模型选择器。

### 🛡️ **agent.js 全局点击监听未闭合括号修复** — 2026-08-23

- **问题现象**：
  浏览器抛出 `agent.js:3747 Uncaught SyntaxError: Unexpected end of input`，导致 `agent.js` 再次解析中断，页面初始化崩溃。
- **根因分析**：
  `public/js/agent.js` 第 1840 行的全局 `document.addEventListener('click')` 浮层自动收起监听器中，因之前的合并遗漏了 `if` 闭合块、`window._closeAllDshPopups()` 调用以及 `});` 结尾括号，导致整个文件缺少闭合符号引发 SyntaxError。
- **修复方案**：
  1. 在 `agent.js` 第 1853 行补齐完整的点击判定闭合与 `window._closeAllDshPopups(); });`；
  2. 运行 `node -c` 逐一扫描 `public/js/` 全部文件，确保 100% 通过；
  3. 执行 `python3 tools/build-index.py` 同步构建。


- **问题现象**：
  浏览器控制台报错 `ReferenceError: updateModeSelector is not defined at initAgentConfig (init.js)`，页面卡在「加载失败 / 请尝试清除该账号的聊天记录」错误面板。
- **根因分析**：
  `init.js` 在 `initAgentConfig` 中调用了 `updateModeSelector(mode)` 来同步三模式按钮高亮，该函数在之前重构时丢失了函数声明头，导致全局未定义并抛出 ReferenceError。
- **修复方案**：
  1. 在 `public/js/agent.js` 中完整声明并挂载 `window.updateModeSelector = function(mode) { ... }`；
  2. 在 `public/js/init.js` 中增加 `typeof updateModeSelector === 'function'` 存在性双重守卫，杜绝单点报错阻断整个应用初始化链路；
  3. 执行 `python3 tools/build-index.py` 重新编译并同步资源哈希版本。


- **问题现象**：
  浏览器控制台抛出 `agent.js:2038 Uncaught SyntaxError: Unexpected token '}'`，紧接着 `init.js` 在初始化配置时报 `ReferenceError: getAgentMode is not defined`，导致页面初始化崩溃。
- **根因分析**：
  `public/js/agent.js` 在 `_setupAgentPopup` 函数的末尾包含了一段旧的选择器兼容更新代码残留以及一个多余孤立的闭合花括号 `}`，破坏了整个 JS 文件的 AST 结构，导致脚本在加载阶段被浏览器语法解析器拦截，其内部导出的 `getAgentMode`、`setAgentMode` 等核心全局方法未能成功挂载到 `window`。
- **修复方案**：
  1. 彻底剥离 `public/js/agent.js` 2028-2038 行的多余残余代码与闭合花括号 `}`；
  2. 使用 `node -c` 对 `public/js/` 下全部 JS 模块进行全量 AST 语法扫描，确保 100% 语法零报错；
  3. 执行 `python3 tools/build-index.py` 重新编译并同步资源哈希版本。


- **问题现象**：
  1. 移动端小屏（如 375px 宽度）顶部 Header 塞入了整整 7 个按钮（侧栏开关、Agent胶囊、用户头像、暗黑模式、云盘、统计、设置），导致所有图标严重挤压、没有留白呼吸感，十分臃肿杂乱；
  2. 各种低频辅助功能（深浅色切换、云盘、刷课、统计、设置）分散在顶部小图标中，在单手操作时点击热区过小且容易误触。
- **重构与优化方案**：
  1. **移动端 Header 彻底瘦身与去噪 (public/css/style.css & public/index.html)**：
     - 在 `@media (max-width: 786px)` 移动端视图下，隐藏 Header 上的深浅色切换、云盘、刷课、使用统计、全局设置等辅助图标；
     - 顶部 Header 右侧仅保留用户登录/头像胶囊 `#authHeaderBtn`，左侧保留侧栏汉堡菜单 `#sidebarToggle` 与模式切换胶囊 `#agentSplitBtn`；
     - 消除横向挤压，为普通模式下的模型选择器提供充裕空间，整体布局通透轻盈。
  2. **左侧侧边栏快捷功能矩阵全面重构 (public/index.html & public/css/style.css)**：
     - 将移出 Header 的功能统筹重组为现代化毛玻璃卡片快捷功能矩阵（`.sidebar-mobile-actions`）；
     - 包含 5 大核心快捷入口：
       - 🌓 **外观主题**（深浅色切换，带专属微渐变图标和动态文字「深色模式/浅色模式」响应）；
       - 📊 **使用统计**（点击直达 Token 与活跃热力图看板，并在移动端自动收起侧栏）；
       - ☁️ **Cloudreve 云盘**（快速调起云盘文件抽屉）；
       - 📚 **学习通刷课**（超星自动化工作台直达）；
       - ⚙️ **系统设置**（一键调出全局模型与 API 配置）；
     - 按钮触控热区由 28px 升级为 38px 舒适手感，附带微缩放按压动效。
  3. **主题切换与弹窗交互无缝联动 (public/js/ui.js)**：
     - `toggleDarkMode` 同步更新侧边栏主题按钮图标与提示文字；
     - 移动端点击打开统计、云盘等浮层时智能关闭侧栏遮罩，杜绝层级遮挡。

### 🛡️ **Agent 输入框四周药丸遮罩彻底破除与 Full access 菜单秒关修复** — 2026-08-23

- **问题现象**：
  1. 输入框四周依然被一层大半圆蓝色/药丸形轮廓罩住，导致四角严重变形、位置偏移；
  2. 点击 `Full access ˇ` 控件时，弹出的二级菜单秒关或无法展开。
- **根因分析**：
  1. **外层父容器规则遗留**：父级 `.input-wrapper` 与 `.input-clip` 在全局样式中自带 `border-radius: 9999px; overflow: hidden;`，虽然内层改了矩形，但外层父容器依然把整块区域强行裁切成了药丸椭圆形，并在两端产生了遮罩蓝边；
  2. **旧 Hover 逻辑与 CSS 冲突**：CSS 第 4461 行存在旧版 `.agent-mode-popup` 样式（带 `opacity: 0; pointer-events: none; visibility: hidden`），且 `agent.js` 中遗留的 `mouseenter/mouseleave` 监听器及捕获阶段的全局 click 监听器在点击胶囊的一瞬间当场把浮层给关掉了。
- **彻底根治方案**：
  1. **彻底解除外层遮罩**：为 `body.agent-active` 全面开放 `.input-clip { overflow: visible !important; }` 并将 `.input-wrapper` 重置为无遮罩、无圆弧切角的标准容器，使 `#composerCard` 的 10px 微圆角矩形平直舒展；
  2. **清理旧样式与重构点击监听**：完全剔除 4461 行的旧冲突样式，重构 `_toggleAgentModeMenu` 与全局点击收起逻辑（转为标准冒泡阶段 + 触发器安全白名单判定），保证点击 `Full access ˇ` 和 `⚡ 模型 ˇ` 时 100% 稳定展开与平滑交互。

### 📊 **OneAPIChat 本地会话统计权威归位、双数据源一键切换与缓存写入(Cache Write)解析修复** — 2026-08-23

- **核心重构与优化要点**：
  1. **OneAPIChat 本地会话库作为统计第一权威主体 (public/js/usage-stats.js)**：
     - 全面扫描并深入解析 OneAPIChat 本地 chats 字典与 localStorage 实时记录；
     - 根据会话与消息特征精准识别所属模型（如 claude-3-7-sonnet、gpt-4o、gemini-3.7-flash-high、deepseek-v4-flash 等），消除单模型误判；
     - 真实聚合 OneAPIChat 自身 250+ 会话、数万条消息的 Token 输入/输出与按天趋势。
  2. **双数据源一键自由切换**：
     - 弹窗顶部新增 [ 💬 OneAPIChat 对话 ]（默认高亮）与 [ 🤖 DSH 引擎分析 ] 切换 Tab；
     - 既可查看 OneAPIChat 自身的真实日常/Agent/刷课对话统计，也可随时切换查看 DSH 引擎后台宏观数据。
  3. **缓存写入 (Cache Write) 全链路提取与解析修复 (public/js/core.js & public/js/main.js)**：
     - 补齐 _extractCacheWrite 函数，兼容 Anthropic cache_creation_input_tokens、OpenAI/Azure cache_creation_tokens、以及 DeepSeek 自动前缀缓存写入；
     - 彻底根除「缓存写入始终为 0」的问题，Token 构成四象限（输入、输出、缓存读取、缓存写入）精准呈现。

### 🎛️ **Agent 模式输入卡片 DSH 极简微圆角重构：模式权限合一、会话工作区去噪与 Header 选模按需隐藏** — 2026-08-23

- **核心改进点**：
  1. **输入卡片微圆角精致化 (`border-radius: 10px`)**：
     - 去除原先过大的 14~18px 弧度，采用 DSH 原生风格的 10px 干练微圆角矩形，边框利落，内部输入空间最大化；
  2. **模式与权限按钮合二为一**：
     - 彻底废除重复的「Agent 交互模式」与「Full access」双按钮，收敛为单一 `🛡️ Full access ˇ`（或 `PTC 规划` / `YOLO 自动`）胶囊；
     - 修复点击事件冒泡拦截（`e.stopPropagation()` 与捕获阶段判定），彻底根除二级菜单展开后被误关或打不开的问题；
  3. **已定会话工作区常驻去噪**：
     - 彻底移除进行中会话输入框底部的 `📁 oneapichat` 常驻胶囊；
     - 工作区选择仅在新会话/空白会话中央的「探索未至之境」欢迎面板中呈现，选好后首问直接归属，会话内保持最纯粹的输入体验；
  4. **顶部 Header 模型选择器按需隐藏**：
     - 在 Agent 模式下自动隐藏顶部 Header 的 `#headerModelContainer`，避免与输入框右下角的 `⚡ 模型 ˇ` 胶囊重复，切回普通模式自动恢复。

### 🛡️ **Agent 输入框缺失闭合标签导致消失修复** — 2026-08-23

- **问题现象**：在 Agent 模式下输入框完全消失不见，底部无法发送任何消息。
- **根因分析**：在整理下沉控件 DOM 结构时，`queueBar` 与 `input-clip` 的标签闭合发生交错截断，导致 `input-wrapper` 输入框被错误包含在 `queueBar`（默认带 `hidden` 类）的子树中，从而被整块隐藏。
- **修复方案**：
  1. 重新校准并还原 `public/index.html` 中的 `queueBar` 独立容器与 `input-clip` 裁剪容器结构；
  2. 确保所有包含关系清晰独立，完整闭合，重新构建 index.html。

### 🎨 **Agent 输入框 DSH 纯净圆角矩形重构：控件全下沉收敛、新会话工作区面板与 Fixed 弹出菜单加固** — 2026-08-23

- **核心优化与改进要点**：
  1. **控件全下沉收敛于底部栏**：
     - 彻底废弃原本在输入框上方挂载的胶囊横条，消除任何上方视觉遮挡与内容挤压；
     - 底部操作栏左侧统一收纳：`+` 附件上传圆钮、`📁 <工作区> ˇ` 胶囊、`🔄 <模式> ˇ` 胶囊、`🛡️ Full access ˇ` 权限胶囊；右侧收纳：`⚡ <模型> ˇ` 胶囊、`↑` 渐变发光圆形发送/停止按钮。
  2. **圆角矩形大卡片输入框 (Composer Card)**：
     - Agent 模式下将容器重构为现代 `border-radius: 14px` 微圆角矩形，平直边框提供更宽敞的多行编辑区域，容纳全部控件且彻底根除药丸两端切角遮挡文本的痛点；
     - 普通模式继续保持原本经典的 `border-radius: 9999px` 药丸形输入框。
  3. **新会话 DSH 风格「探索未至之境」看板 (`public/js/rendering.js`)**：
     - 仅在新对话/空白会话时于屏幕中央醒目渲染 DSH 标志性欢迎面板（海豚图标 + 探索未至之境标题 + 预览版徽章 + 工作区/模式直选胶囊）；
     - 选定工作区后直接在目标工作区下创建会话，日常进行中会话不再在顶部常驻横条。
  4. **二级弹出菜单 Fixed 顶层悬浮与全交互加固 (`public/js/workspace.js` & `public/js/agent.js`)**：
     - 将工作区下拉卡片、Agent 模式选单、模型快速选择器提升至 `body` 顶层并使用 `position: fixed; z-index: 999999`；
     - 依据点击胶囊的实时位置精准向上展开，彻底根除父容器 `overflow: hidden` 裁切和打不开的问题；
     - 模型选择器支持即时搜索与无缝切换，点击页面空白处自动关闭浮层。

### 🛡️ **模式切换/已完成会话残留三点动画根治与状态机精准过滤** — 2026-08-23

- **问题现象**：当生成已经完成、用户从 Agent 模式（或 Plan 模式）切回普通对话模式时，刚刚输出完成的气泡下方却出现了一个紫色小药丸三点等待动画（`...`），且一直停留在正文下方不消失。
- **根因分析**：
  1. **切模重绘盲目挂载等待器**：当在 Agent 模式与普通模式之间切换时，系统会调用 `loadChat` 重新渲染当前消息树；在 `loadChat` 的末尾逻辑中，原先仅判定 `if (isTypingMap[id] && displayMsgs.length)`，且没有进一步校验该会话的最后一条消息是否真正处于生成中状态（`partial` / `_recovered`），就直接获取 DOM 中的最后一个助手气泡并执行了 `_targetBubble.classList.add('typing', 'gen-active')` 和 `ensureTypingIndicator(_targetBubble)`，导致已完成的静态消息被错误打上正在生成的等待标记。
  2. **状态机未做非空防御**：`model-status.js` 中的 `ensureTypingIndicator` 原先只检查了 DOM 中是否存在已有的 `.remi-typing-indicator`，而未对气泡内是否已有完整的正文（`mdBodyText`）做防御拦截，导致重绘时只要收到指令就无条件向 markdown-body 底部插入等待器。
- **重构方案**：
  1. **`loadChat` 精准状态校验与即时清理**：
     - 严格判断最新一条消息：必须满足 `(_lastMsg.partial || _lastMsg._recovered || !_lastMsg.content.trim())` 时才认定为活跃流并添加 `typing`；
     - 对已完成的完整历史消息（非 partial 且正文非空），显式从 `activeBubbleMap` 中剔除，剥离 `typing/gen-active/streaming` 类，并调用 `removeTypingIndicator(_targetBubble)` 彻底销毁残留的真实 DOM 胶囊节点。
  2. **`ensureTypingIndicator` 正文非空拦截**：
     - 在注入三圆点等待胶囊前，增加正文检测：当正文已有非空文字且气泡没有显式的 `typing` 类时，直接拦截拒绝插入，杜绝误创。
- **验证结果**：JS 语法检查通过，重新构建 `index.html`，实测无论在流式中、流结束后、以及切模/切会话场景下，三点等待器均严格与真实生成状态绑定，完成即消失。

### 🧹 **多轮链式流式光标残留与空尾部段落占行彻底根除** — 2026-08-23

- **问题现象**：在模型进入多轮工具调用循环（Chain Mode）或多步骤思考生成时，上一轮已完成输出的文字下方偶尔会遗留一个紫蓝色的竖线呼吸光标（`I`），并且单独霸占空行，即使后续轮次已经开始调用工具或等待输出，旧气泡上的光标依旧常驻不消失。
- **根因分析**：
  1. **多轮气泡收敛缺口**：在 `main.js` 的链式输出处理中，当一轮助手输出完成并准备创建新气泡（`appendMessage('assistant')`）时，原逻辑仅移除了旧气泡的 CSS 类（`_bub.classList.remove(...)`），而**未调用 `cleanupStreamState(chatId)`**。这导致内部增量流式渲染状态中的 `md-tail` 节点没有被收敛合并为纯静态 DOM，遗留了空的尾部渲染槽。
  2. **尾部未滤空与全局伪元素污染**：
     - `_renderStreamTail` 在处理尾部未完成文本时，遇到纯空白字符未及时拦截，渲染出空的块节点；
     - `init.js` 中的早期全局注入规则 `.bubble.streaming .markdown-body::after` 在气泡处于流式标记时，通过伪元素绘制呼吸光标，当段落尾部有换行或未收敛时，`::after` 伪元素会直接在块级元素下方换行并强占一行显示。
- **重构方案**：
  1. **链式输出切轮前全量触发收敛**：在 `main.js` 准备切入下一轮气泡前，显式调用 `cleanupStreamState(chatId)`，将稳定区（`md-stable`）与尾部（`md-tail`）完整展开合并为纯净的静态子节点，并销毁旧 RAF 循环。
  2. **清除全局注入的冗余伪元素**：从 `init.js` 中移除旧的流式呼吸光标 CSS 注入，杜绝伪元素在非流式或半开段落下换行错位。
  3. **空尾部防御与截断保护**：在 `markdown.js` 的 `_renderStreamTail` 中严格加入 `!tail.trim()` 早退防御，确保任何纯空白或无有效内容的流尾部不产生任何多余 DOM 结构。
- **验证结果**：JS 语法检查通过，重新构建 `index.html`，多轮工具调用与切轮实测光标瞬时收敛无残留。

### 💻 **代码块操作栏现代重构：HTML 安全沙箱实时预览弹窗 + 复制/Apply 图标遮挡根除** — 2026-08-23

- **问题现象**：
  1. 代码块右上角的运行 HTML 按钮（绿色三角形）点击后没有任何反应或报错，无法在当前页面运行 HTML 代码；
  2. 代码块右上角经常只显示一支笔图标（Apply 按钮），复制按钮完全看不见；
  3. 用户误以为笔图标无用，且无法复制代码或运行代码。
- **根因分析**：
  1. **弹窗被拦截与容器未绑定**：旧逻辑使用 `window.open('', '_blank')` 并在新窗口写入 HTML，被现代移动端和桌面浏览器弹窗拦截器（Popup Blocker）静默阻止；且流式增量渲染收尾时未调用 `attachCodeCopyButtons`，导致代码块按钮在流结束后缺失。
  2. **绝对定位层叠与侵入式遮挡**：`addCodeBlockButtons` 在向代码块注入 Apply 按钮时，当未找到 `.code-actions` 容器时直接把带有 `position: absolute; top: 36px; right: 8px; z-index: 10` 的独立节点挂在 `<pre>` 上，高 z-index 抢占了位置并覆盖了复制按钮。
  3. **功能职责不清**：笔图标是用于将 AI 输出的代码块「一键 Diff 对比并安全应用到本地文件/工作区」的代码写入工具，但缺少清晰的 Tooltip 说明，导致用户困惑。
- **重构方案**：
  1. **内置安全沙箱 iframe 实时预览弹窗 (`showHtmlPreviewModal`)**：
     - 点击「▶ 运行」时不再依赖易被拦截的 `window.open`，直接在当前页面弹出全屏毛玻璃 **HTML 实时运行预览弹窗**；
     - 使用带有 `sandbox="allow-scripts allow-modals allow-forms allow-same-origin"` 的独立安全 iframe，即时渲染 HTML/CSS/JS/SVG 效果；
     - 弹窗顶部提供「新标签页打开」及「✕ 关闭」按钮，支持 ESC 键快速退出。
  2. **Ghost 浮层操作栏统一整合**：
     - 将代码块右上角工具条重构为统一的 `.code-actions` 现代毛玻璃胶囊浮层（`padding: 3px 4px; border-radius: 8px`）；
     - 按钮顺序规范化：`[ ▶ 运行HTML ]` + `[ 📋 复制代码 ]` + `[ ✏️ 应用到本地文件 ]`，水平并排平滑排列，彻底根除绝对定位遮挡；
     - 复制按钮点击即时切换为翠绿色对勾（✓）动效并在 1.5 秒后复原；
     - Apply 按钮提示优化为「对比/应用到本地文件」，点击自动提取文件名并呼出 Diff 差异对比看板。
  3. **渲染链路闭环**：
     - 在 Markdown 增量渲染稳定块后处理（`_postProcessChunk`）、`MarkdownRenderer.postRender` 及 `addCodeBlockButtons` 中全覆盖注入，确保流式输出中和流结束后操作栏 100% 存在且可用。
- **验证结果**：
  - 语法检查全绿，重新构建 `index.html` 资源版本指纹，全量功能实测可用。

### 📊 **气泡单次耗时/Token展示剥离与全功能使用统计看板上线** — 2026-08-23

- **需求背景与改造要点**：
  1. **气泡内部单次统计剥离**：
     - 从消息流气泡底部的 _buildMsgFooterHtml 与 finalizeBubbleUI 中彻底移除单次请求计时与 Token 统计展示（消除气泡底部 21.2s • ⚡ 17634 琐碎信息）；
     - 将用量追踪完全解耦至独立的集中统计与按天聚合系统。
  2. **DSH 级使用统计面板 (public/js/usage-stats.js & public/css/usage-stats.css)**：
     - **6 大核心指标卡片**：Tokens 用量（自适应亿/万/k单位、输入/输出拆分）、会话数量、消息数量、活跃天数、连续天数（Streak 记录）、最常用模型及提供商占比；
     - **活跃热力图 (Activity Heatmap)**：52 周日历矩阵，星期一/三/五标记，5 级渐变色阶，鼠标悬停 Tooltip 实时显示当日 Token 用量与调用轮次；
     - **按天 Token 趋势 (Daily Trend)**：按天多模型色彩堆叠柱状图，支持「最近 7 天 / 最近 30 天 / 全部」无缝切换与单日模型用量悬停查看；
     - **模型用量分布**：现代化 SVG/Conic-gradient Donut 环形图 + 模型消耗排名与调用次数清单；
     - **Token 构成**：输入、输出、缓存读取、缓存写入四栏卡片；
     - **调用明细表格**：支持模型筛选、提供商筛选、输入阈值、输出阈值、明细上限（100/500/1000/5000条）、每页条数（10/20/50）与分页浏览；
     - **数据导出**：支持一键导出标准 UTF-8 BOM CSV 及完整 JSON 备份文件。
  3. **历史智能回填与多入口打通**：
     - 首次启动自动扫描 chats 历史消息并回填历史用量，确保现有 50+ 会话和数千条历史消息即刻生成完整统计；
     - 左侧侧边栏新建对话下方、移动端功能列表、主顶部 Header 右侧按钮区均挂载图表入口，点击弹出全屏毛玻璃统计弹窗（支持 Esc 键及返回对话关闭）；
     - 斜杠命令 /stats 与 /usage 联动直接调出统计看板。

### 📂 **Agent 模式专属工作区隔离、侧栏工作区树状分组与 DSH 大卡片输入框升级** — 2026-08-23

- **升级要点与交互优化**：
  1. **工作区机制严格按模式隔离**：
     - 普通模式（`off`）完全保持原有日常对话体验与单行药丸输入框，隐藏工作区胶囊条；
     - 仅在 Agent 模式（`plan` / `agent` / `yolo`）下激活工作区机制、显示 DSH 风格工作区胶囊，并启用基准 CWD 工具绑定与沙箱组织规范。
  2. **左侧侧边栏按工作区树状折叠分组 (`public/js/dialogs.js`)**：
     - Agent 视图下，会话列表不再按今天/昨天/更早平面堆砌，而是按所属工作区（`📁 oneapichat`、`🗂️ workspace (沙箱)`、`📂 html`、`📂 home`、自定义项目工作区）建立树状分组；
     - 当前激活的工作区高亮置顶展示，支持点击平滑展开/折叠与会话计数，并保留 Claude Code 与 Codex 独立导入分组；
     - 普通模式切回时自动恢复经典时间分组。
  3. **Agent 模式专属 DSH 现代大卡片式输入框 (`public/index.html` & `public/css/style.css` & `public/js/agent.js`)**：
     - **顶部栏**：挂载 `📁 <工作区名> ˇ` 与 `🔄 <运行模式> ˇ`（Plan 规划模式 / Agent 交互模式 / YOLO 自动模式）双胶囊；
     - **中间输入区**：大行高自适应多行文本域，支持 `@` 引用与 `/` 斜杠命令；
     - **底部工具条**：
       - 左侧：`+` 附件上传圆钮（文件/图片/文件夹）、`🛡️ Full access ˇ` 动态权限状态胶囊；
       - 右侧：`⚡ <模型名> ˇ` 快捷模型切换胶囊、`↑` 现代化发光渐变圆形发送按钮（生成中自动切换为方形停止圆钮 `■`）；
     - 普通模式下无缝恢复为经典单行输入框，完全不影响普通对话排版。

### 📁 **Agent 模式全面升级 DSH 工作区机制：动态 CWD 注入、胶囊交互与全链路沙箱管理** — 2026-08-23

- **问题与背景**：
  1. 此前 Agent 模式与工具执行默认硬编码指向根目录或单个预设路径，无法像 DeepSeek Harness (DSH) 一样在聊天输入框随时感知、切换和管理当前工作区（Workspace / CWD）；
  2. 大模型在编写代码、生成 Web 项目或执行文件与终端操作时，相对路径容易受引擎自身 cwd 影响导致路径错乱；
  3. 缺乏会话级工作区记忆与 DSH 风格的现代化工作区胶囊 UI。
- **全面升级方案**：
  1. **DSH 风格工作区系统与生命周期管理 (`public/js/workspace.js`)**：
     - 构建独立的 `WorkspaceManager` 管理器，内置 `oneapichat`（主项目）、`workspace`（隔离安全沙箱）、`html`（Web 站点根）、`home`（用户目录）等预设工作区；
     - 支持用户在前端动态注册任意自定义工作区路径，并支持一键在沙箱快速创建项目物理目录并切换；
     - 支持会话级工作区绑定（切换历史会话时自动恢复该会话工作区）。
  2. **DSH 胶囊与交互下拉卡片 UI (`public/index.html` & `public/css/style.css`)**：
     - 在聊天输入框上方挂载 DSH 风格胶囊栏（`#workspaceCapsule`），展示 `📁 <工作区名> ˇ`；
     - 点击弹出支持模糊搜索、当前工作区高亮徽章、路径一键复制、预设/自定义工作区切换、删除与新建模态弹窗的交互卡片。
  3. **Agent 提示词与环境感知动态注入 (`public/js/api-messages.js`)**：
     - 动态从 `WorkspaceManager` 读取当前工作区名称与绝对路径，注入到 System Prompt 的 `## 📁 工作区与执行环境` 中，明确告知模型基准 CWD 与组织规范。
  4. **工具链全链路工作区 CWD 绑定与相对路径解析 (`public/js/tools-exec.js` & `python/engine/server_tools.py` & `api/engine_api.php`)**：
     - 前端在调用 `read/write/edit/grep/glob/bash/server_exec` 等工具时自动注入当前工作区 CWD，并对相对路径进行安全拼接；
     - 后端 `_resolve_path` 与 `_allowed_path` 支持动态以工作区 CWD 为基准解析相对路径，并自动纳管该工作区进入合法沙箱范围；
     - `api/engine_api.php` 统一支持 `cwd` 参数透传。
  5. **斜杠命令扩展 (`public/js/commands.js` & `public/js/ui.js`)**：
     - 新增 `/workspace` (列出/切换/添加)、`/cd <路径>`、`/cwd` 命令与帮助说明。

### 🎨 **消息操作栏现代化重构：Ghost 幽灵工具条、悬停浮现与复制动效闭环** — 2026-08-22

- **问题现象**：在 DSH 智能体工作台 / 现代极简 / 透明气泡等主题下，每条消息下方都常驻挂着一排带实线描边的圆形线框药丸按钮（复制、重新生成、还原、编辑等）。长对话中全屏布满重复单调的小圆圈，视觉割裂严重且极大增加视觉噪音。
- **根因分析**：
  1. **样式陈旧生硬**：`.msg-action-btn` 原设计为 `width: 28px; border-radius: 20px; border: 1px solid #e5e7eb; background: rgba(255,255,255,0.8)` 独立圆形药丸，且在多处 CSS 中被 `!important` 强制固定为白底黑边，与透明工作台、思考过程卡片和暗色流式文本格格不入。
  2. **常驻显隐机制单调**：`.msg-actions` 原先默认 `opacity: 0.5` 常驻显示在每条历史消息下方，导致用户阅读历史上下文时，每屏都会出现数排一模一样的灰白圆圈，产生严重的重复感与视觉干扰。
  3. **交互反馈生硬**：点击复制时直接硬编码将整个按钮背景改成浅绿色 `#bbf7d0`，缺少现代主流软件（如 Claude、ChatGPT、DSH）优雅的「对勾动画 (Checkmark) + Tooltip 提示」反馈。
- **重构方案**：
  1. **扁平 Ghost 现代工具条体系**：
     - 将按钮重构为无描边、完全透明背景的 Ghost 图标按钮（`background: transparent; border: none; box-shadow: none`），图标采用优雅的 Slate 中性灰阶（亮色 `#64748b`，暗色 `#94a3b8`）；
     - 悬停（Hover）时柔和浮出浅色微光背景（`rgba(0,0,0,0.06)` / `dark: rgba(255,255,255,0.1)`）并轻微上浮 1px，按下（Active）时具备弹性缩放物理触感（`scale(0.92)`）；
     - 图标线条精细化（`14px`, `stroke-width: 2`），微圆角 `6px` 替代生硬大正圆。
  2. **智能悬停显隐（Hover-to-Reveal）与对齐优化**：
     - 历史消息操作栏默认 `opacity: 0; pointer-events: none;`，当鼠标移入该行消息（`.message-row:hover` / `.message-content-wrapper:hover`）或聚焦时平滑淡入（`opacity: 1`），让阅读流纯净无噪音；
     - 当前最新回复（末尾消息）保持柔和低调微透可见（`opacity: 0.55`），方便随时复制或继续；
     - 助手消息操作条靠左自然对齐紧随正文，用户消息操作条靠右对齐气泡边缘；在 DSH / 极简主题下自适应微间距；
     - 触摸屏移动端优雅降级为低透明度紧凑布局。
  3. **交互反馈闭环**：
     - 点击复制按钮：动态切换为翠绿对勾图标（`#10b981`），添加 `.copied` 样式并切换提示为「已复制」，1.5 秒后平滑复原；
     - 重新生成、继续展开、回退还原、编辑重新发送均补齐清晰完整的 `title` 与 `aria-label` 语义化标签。
- **验证结果**：
  - 重新构建 `public/index.html` 资源版本指纹；
  - 检查 JS 语法通过，并在明暗双色及 DSH、极简、经典主题下测试对齐与悬停动画正常无冲突。

### 🤖 **OneAPIChat 子代理创建与路由全链路修复** — 2026-08-22

- **问题现象**：在 Agent 模式下发送任务或通过 `delegate_task` 创建子代理时，子代理卡片显示红色 `⚠️ Error code: 400 - {'error': {'code': 'invalid_parameter', 'message': 'Unsupported model...'}} failed`，无法正常创建和完成任务。
- **根因分析**：
  1. **提供商 API Key 错位**：`_get_main_chat_config` 仅读取通用 `apiKey` 字段，当用户切换提供商后，通用字段残留旧提供商（或 CLIProxyAPI）密钥，而未优先读取该 provider 专属的 `apiKeyGemini` / `apiKeyCustom` / `apiKeyDeepseek`，导致鉴权或路由不匹配。
  2. **模型与端点跨提供商残留混配**：历史子代理或持久化数据中残留 LongCat (`api.longcat.chat`) 或 MiniMax 端点，在回退链中与当前主模型的非兼容名称（如 `gpt-5.6-luna`、`gemini-3.7-flash`）交叉混拼，被上游网关拒绝。
  3. **前端创建参数丢失与双重启动竞态**：`cloudreve.js` 的 `agent_create` 仅读 `localStorage.getItem('model')` 旧缓存，且内部触发 `fetch(agent_run)` 与 `tools-exec.js` 的显式 `agent_run` 产生双重调用冲突。
  4. **OpenAI 兼容参数空 tools 校验**：当总结轮或无工具阶段 tools 为空时，部分 OpenAI 兼容网关若接收到残留的 `tool_choice: "auto"/"none"` 会直接返回 `400 invalid_parameter`。
- **修复方案**：
  1. **引擎密钥精准对齐**：`_get_main_chat_config` 根据解析出的提供商，优先解密读取专属 `key_field`，并提供完整回退机制。
  2. **防串扰守护**：在 `agent_run` 中加入模型与端点兼容性强校验，自动消除 LongCat/MiniMax/DeepSeek 与异构模型的跨提供商混配。
  3. **前后端参数全透传**：`delegate_task` 与 `cloudreve.js` 获取当前界面真实选择的 `model`、`base_url`、`provider`，并通过 `api/engine_api.php` 完整透传到引擎；规范化启动控制避免竞态。
  4. **参数净化**：在 `provider_runtime.py` 中当 tools 为空时联动清理 `tool_choice` 与 `parallel_tool_calls`。
- **验证结果**：重新构建前端资源指纹，后端热重启，通过真实用户 Token 模拟创建子代理、执行任务并完成状态轮询与清理，子代理全生命周期端到端测试 100% 成功。

### 🐛 **发送消息 apiMessages 未定义异常修复** — 2026-08-22

- **根因**：上一轮回滚快通道替换逻辑时，不慎漏调了 `let apiMessages = buildApiMessages(chatId);`，导致用户发消息执行到 `injectCachedImageAnalyses(chatId, apiMessages)` 时直接触发 `ReferenceError: apiMessages is not defined`，阻塞整个 `sendMessage` 与气泡发送流程。
- **修复**：在 `public/js/main.js` 中准确补回 `let apiMessages = buildApiMessages(chatId);`；
- **验证**：`node --check` 语法通过，重新构建 `index.html`，全量 22 项自动化单测 100% 全部通过。

### 🧹 **持久化产物全链路清理闭环（防脏数据无上限残留）** — 2026-08-21

- **修复两个真实缺口**：
  - 磁盘流快照 `compact_stream_files`（30 天过期删 + 大文件压缩）原本**只在引擎启动时跑一次**，运行中会持续膨胀 → 挂入 5 分钟清理线程每 30 分钟执行；
  - `agent_runtime.prune()`（90 天保留：jobs/subagents/sessions）**从未被任何代码调用**，且 `runtime_events`（DSH 风格事件日志）无清理 → 补 events DELETE（终态会话旧事件）+ 每 30 分钟调用。
- **清理矩阵**：磁盘流快照 30 天；runtime 事件/任务/子代理 90 天；内存 `_resumable/_stream_buffers` 完成 10 分钟/容量 512 触发；前端 `_rs_*` TTL 30 分钟，`_savedPartial` 完成即删；消息队列 `oc_queue_*` 冷启动清；图片分析缓存上限 50 条；聊天备份每文件 30 份；会话删除时独立文件与备份同步清理。
- **验证**：prune/compact 实际执行正常（当前数据均在保留窗口内，窗口外自动清除），`agent_runtime.db` 50MB / streams 29MB 均有上限不再无限增长。

### ♻️ **流式持久化全面对齐 DSH：磁盘快照权威 + 增量重放** — 2026-08-21

- **目标**：让 OneAPIChat 达到 DSH 的“刷新/关代理/引擎重启均不影响续接”。
- **对齐点**：
  - `chat_create` 在 **ensure_session/create_job/register_task 之前**先落盘流快照（`STREAM_DIR/{msg_id}.json`），任何后续失败也保证磁盘有该 msg 记录；
  - `chat_stream_offset` 按 `msg_id` 优先从磁盘恢复（内存 `_resumable` 只是缓存，重启后清空不影响）；快照含 `finished/recovery_state=producer_lost/recoverable`，客户端据此收尾；
  - 流式 token 通过 `StreamBuffer.record` 即时落盘（content/reasoning/tool_call/done），恢复端 `since(offset)` 只重放增量；
  - 前端 `_readSSE` 对 `snapshot` 事件完整渲染（全文+推理+工具调用，finished 即完成）；刷新恢复以引擎 `active_tasks` 为权威（chat_id/stream_id/msg_id 显式绑定），不再依赖 localStorage 旧串；
  - create 失败/流已过期时 404/410 **静默降级 direct HTTP**，不刷屏、不弹错误气泡。
- **实测验证**：引擎重启后按历史 `msg_id` 请求恢复 → `200` + `event: snapshot` + `finished:true`（磁盘权威生效）；`chat_create` 实测 200 并落盘。

### 🧠 **OneAPIChat 子代理跟随主模型路由修复** — 2026-08-21

- **根因**：`agent_run` 优先使用旧子代理记录中的 `base_url=https://api.longcat.chat/openai/v1`，但模型仍是主配置的 `gpt-5.6-luna`；旧 LongCat endpoint 不接受该模型，导致 `model-score-check` 返回 400 Unsupported model。
- **修复**：子代理默认跟随当前主聊天的 provider/base URL/model；只有显式 `independent_route` 或 `use_custom_route` 时才使用子代理专属路由。这样主模型为 `gpt-5.6-luna` + `https://gpt.naujtrats.xyz/v1` 时，子代理使用同一合法路由。
- **验证**：`engine_server.py` 编译通过，8766 健康检查 200。

### 🔄 **同一会话多端同步与活动气泡续接增强** — 2026-08-20

- **同步链路**：当前会话先独立落盘，SSE `chat:stream_started`/`chat:stream_done` 广播携带 `chat_id`、`stream_id`、`msg_id`、模型及时间戳；其他设备可以定位同一会话和同一条活动流。
- **刷新续接**：索引聊天点击时按需 hydration 完整正文；冷启动清除旧消息队列但保留 ResumeStream 活动流快照；引擎 502 时延后恢复而非错误清理。
- **冲突保护**：跨端同步遇到本端正在生成时不覆盖 partial；普通更新以服务器完整会话为权威，已保存的独立小文件避免全量 `all.json` 超时。
- **性能**：元数据首屏与单会话加载绕开 16MB+ 全量历史；引擎恢复接口与内置 RAG proxy 已验证可用。

### 🧹 消息队列残留与刷新续接断链修复 — 2026-08-20

- **问题**：刷新后旧 `oc_queue_*` 消息被恢复并可能重复发送；引擎暂时 502 时恢复任务将错误反复写入控制台；RAG 可选服务不可用时启动警告刷屏。
- **修复**：
  - 冷启动不再恢复任何持久化消息队列，启动时清除全部 `oc_queue_*`、`queued_message_*` 与 session 队列键；队列仅存在于当前页面生命周期。
  - 活动任务恢复遇到 502/503/504 改为延后重试且静默，不把临时后端故障当成任务失败。
  - RAG 502 作为可选能力静默降级；RAG 代理已对齐内置 8766 引擎。
  - 当前会话独立即时落盘并按需恢复，避免全量聊天备份阻塞刷新续接。

### 💾 聊天消息刷新不丢失、首屏提速与后端 502 修复 — 2026-08-20

- **根因**：root 用户聊天总备份已超过 16MB，刷新仍加载完整 `all.json`；消息保存与全量汇总共用一条链路，超时/旧快照合并会让侧栏还在但消息正文为空。
- **修复**：
  - `storage.js` 新增单会话独立即时保存与按需加载；用户消息先写 `user_<id>_<chat>.json`，不再等待全量备份。
  - `chat_id=all&meta=1` 首屏只返回标题/时间/消息数；点击会话再 hydration 完整正文。
  - `all.json` 汇总从 2 秒改为 60 秒低频，删除墓碑仍立即汇总，避免每条消息传输 16MB。
  - 发送用户/助手占位消息时更新 `updated_at`，防止合并逻辑误判新消息为旧版本。
- **验证**：元数据接口约 12KB/0.2s，单会话接口约 317B/0.07s；独立测试会话 system/user/assistant 三条消息已完整落盘。

### 🦁 Brave 搜索引擎官方接口与项目代理全链路优化修复 — 2026-08-20

- **官方接口规范升级**：
  - 严格对接 Brave Search 官方 API（`/res/v1/web/search`、`/res/v1/news/search`、`/res/v1/images/search`）。
  - 请求头规范注入 `X-Subscription-Token`、`Accept: application/json` 和 `Accept-Encoding: gzip`。
  - URL 参数优化：限制 `count` 范围在 1–20（官方上限）、开启 `safesearch=off` 与 `text_decorations=0`（剥离 HTML 标签获取纯净文本）。
  - 结果解析支持将 `description` 与 `extra_snippets` 拼接为更详细完整的上下文，同时兼容新闻与图片端点的顶层 `data.results` 结构。
- **项目代理全链路打通**：
  - `api/engine_api.php`（`action=search_proxy`）：废弃无代理的 `file_get_contents` 直连，全面改用 cURL，优先通过本地 Mihomo 出站代理（`http://127.0.0.1:1080` / SOCKS5）发起请求，并提供 GCP 代理与直连双层兜底，自动解压 gzip 响应。
  - `api/proxy.php`：在 `$blockedHosts` 封锁列表中补齐 `api.search.brave.com`、`search.brave.com` 和 `brave.com`，确保所有走 relay 的请求直达出站代理，消除直连超时浪费。
  - `api/v1/search.php` 与 `api/v1/tools/call.php`：升级 `searchBrave()`，统一通过 cURL 代理列表执行搜索。
  - `python/engine_server.py`：在 `_requires_auto_proxy()` 加入 Brave 和 Tavily 域名，确保 FastAPI 引擎的 `_SelectiveProxySession` 自动分流走代理，在 `web_search` 工具中实现包含 `extra_snippets` 的高质量解析与优雅错误降级。

### 🎯 蕾米角色视觉中心与首行文字对齐 — 2026-08-20

- 实际截图显示 -12px 仅让角色头顶接近首行，角色主体中心仍明显低于文字基线。
- 桌面端头像容器偏移调整为 `translateY(-30px)`，现在以角色面部和上半身的视觉中心对齐回复第一排文字，而不是以包含透明留白的 360×360 GIF 画布中心对齐。
- 移动端仍显式 `transform:none`，不受该桌面端修正影响。

### ↗️ 蕾米头像与首行正文垂直对齐 — 2026-08-20

- 蕾米 GIF 虽为 360×360，但角色主体下方有透明留白，按容器几何中心排列时视觉重心会比正文首行偏下。
- 桌面端助手头像容器统一 `translateY(-12px)`，让角色头部和首行回复/Agent 汇总卡垂直对齐。
- 入场与离场动画执行期间不叠加偏移，动画结束后自动恢复 -12px；移动端绝对定位贴纸布局显式 `transform:none`，不受本次调整影响。

### ✨ 蕾米真实三点等待器与完成状态闭环修复 — 2026-08-20

- 之前三点仍丑的根因是等待器继续依赖 `.markdown-body::after`，会被项目大量全局伪元素、流式光标和主题样式互相覆盖；现在彻底关闭该伪元素。
- `model-status.js` 在 typing 气泡中动态插入 `.remi-typing-indicator`，内部是三个真实 `<i>` 圆点：玻璃胶囊、7px 渐变圆点、7px 间隔、逐个错峰跳动，明暗主题独立适配。
- typing/gen-active 消失时立即删除等待器，`finalizeBubbleUI` 也进行兜底清理，杜绝残留。
- 输出结束状态不对应的根因是仅依赖 MutationObserver 观察 class 切换，收尾时序下可能被正文 Mutation 再次改回 creating；现在 `finalizeBubbleUI` 显式调用 `remiReact('turn/completed')`。
- 完成后进入 06.gif 庆祝状态约 5 秒，再由既有 sticky timer 自动切回 02.gif 待机。

### 🧩 DSH Vibe Coding 可信运行时一期升级 — 2026-08-20

- **可信权限 grant**：新增 `api/permission_grants.php`，由 PHP Host 在用户确认后签发随机 grant，仅保存 SHA-256 哈希；grant 与用户、聊天、能力范围绑定，最长 60 分钟，支持状态检查、撤销与过期清理。客户端裸传 `full_access=true` 不再能绕过权限；Python 引擎仅接受带内部桥接密钥的 PHP 请求激活全盘访问。
- **自动权限申请**：文件工具越界返回统一 `PERMISSION_REQUIRED`，前端展示 SVG 授权弹窗，批准后自动重放原调用一次；拒绝或失败不会无限循环。
- **观察铁律**：Python 引擎维护按用户隔离、1 小时 TTL 的文件观察注册表。覆盖或编辑已有文件前必须先经 `read/server_file_read` 读取，否则返回 `OBSERVATION_REQUIRED`；前端可安全自动读取后重试一次。
- **修改后验证与回滚**：`.py`、`.js/.mjs/.cjs`、`.php` 修改后自动执行语法校验，失败自动恢复原文件；修改 `public/js` 或 `public/css` 后自动运行 `tools/build-index.py`。
- **工具 Schema 收敛**：模型侧仅暴露 DSH 标准 `read/write/edit/bash/grep/glob/todo_write/run_code`，旧 `server_file_*`/`server_exec` 继续留在执行层兼容历史会话，不再重复占用上下文。
- **Todo 与 Diff**：Todo 按 `chatId`、revision 和 updatedAt 持久化到聊天对象并在切换/刷新时恢复；Diff 改用 `computeDiff` 真正 hunk，结果元数据附加到消息中供历史重放。
- **run_code PTC**：新增 Node Permission Model + `vm` 无代码生成沙箱，代码无法直接访问 `require/process/fs/fetch`，仅能通过 JSONL RPC 调用白名单 `tools.*`；Host 统一执行权限、观察与验证策略。
- **测试**：新增 `tests/permission_grants.test.php`、`python/tests/test_vibe_coding_runtime.py`、`tests/vibe_coding_contract.test.js`，覆盖 grant 所有者/聊天/能力隔离、撤销、run_code RPC、沙箱路径与工具 Schema 去重。


### ⚪ 蕾米等待三点彩色胶囊畸变修复 — 2026-08-20

- 右侧紫色和粉色两坨是旧等待动画用 `box-shadow` 复制第二、第三个圆点后，被其他伪元素尺寸规则拉成长条形成的彩色胶囊；左侧的小 `...` 是旧等待提示叠加后的残留观感。
- 删除 box-shadow 复制方案，改为在单个 46×14 伪元素中使用三层 radial-gradient 绘制三个固定 8px 圆点，不受全局宽高和圆角规则污染。
- 等待点改为中性灰，暗色模式使用浅灰；仅做整体 2px 上浮和透明度呼吸，不再出现紫粉色块、阴影或多套指示器叠加。

### 🫧 蕾米头像蓝色底板彻底移除 — 2026-08-20

- 根因是浅色主题旧规则 `html:not(.dark) .avatar.assistant { background-color:#2563eb !important; }` 的优先级覆盖了蕾米区域声明的透明背景。
- 将浅色头像背景改为 transparent，并对 DSH/经典/极简主题以及明暗模式增加最终高特异性透明守卫。
- 同步移除头像容器 box-shadow，只保留 GIF 角色自身的轻量 drop-shadow，完整透明轮廓直接悬浮在页面上。

### 📐 蕾米完整角色与消息内容间距修复 — 2026-08-20

- 桌面端蕾米头像列右侧增加 18px 安全间距，并为可见头像与消息包装器补充 4px 呼吸空间，完整角色的头发、翅膀不再紧贴 Agent 汇总卡或正文。
- 修正后置旧样式仍把助手头像覆盖回 52×52、overflow:hidden、圆形 object-fit:cover 的层叠冲突，统一为 82×82、overflow:visible、object-fit:contain。
- 移动端继续使用绝对定位贴纸布局，清除新增 margin，避免小屏重复挤压消息。

### 🌸 蕾米高还原角色动画素材重构 — 2026-08-20

- 撤下此前基于 CSS 几何图形拼装的抽象角色形象，恢复真正的蕾米埃尔 Q 版完整角色构图。
- 素材来源为 [ch3ny5/remiel-desktop-pet](https://github.com/ch3ny5/remiel-desktop-pet) 的 assets/gifs/01-06.gif；仓库提供 MIT LICENSE 与 SHA-256 source_manifest，文件均为 360×360、17–61 帧动画。
- 状态映射：工作=01、待机=02、创作/阅读=03、失败/害羞=04、思考与等待确认=05、完成庆祝=06。
- 聊天头像从 52px 圆形裁切提升为 82px 完整透明角色，不再截掉身体和翅膀；移动端使用 68px。
- 思考指示器使用 76px 角色动画，工具状态使用 44px；放大小窗按原始 1:1 比例无损缩放至 360px。
- 保留 DSH 风格状态机、审批等待联动、庆祝冷却、双击彩蛋和空闲微动作。
- 新增 `public/src/src/remi-official/NOTICE.md`，明确仓库来源、角色权利归属和使用边界；素材部署到项目实际对外映射的 `src → public/src/src` 目录，避免 `/oneapichat/src/remi-official/*.gif` 返回 404。

### 🤖 蕾米 DSH 事件状态机与陪伴行为升级 — 2026-08-20

- **参考项目**：[jackuh105/remielle-dsh-plugin](https://github.com/jackuh105/remielle-dsh-plugin)，程序代码 Apache-2.0、与当前聊天事件驱动架构适配度最高。
- **使用边界**：仅借鉴其事件投影、状态优先级、庆祝冷却和空闲行为设计；没有复制仓库中仅限非商业同人交流的 GIF/PNG 素材，继续使用 OneAPIChat 本地纯 HTML/CSS 角色。
- **状态扩展**：从原先 idle/thinking/creating/done/stuck 扩展为 idle/thinking/working/creating/waiting/celebrate/failed，并保留旧状态名的兼容映射。
- **真实审批联动**：观察 OneAPIChat 的 approval-overlay 生命周期，弹出审批时进入 waiting，批准/拒绝后根据活跃气泡恢复 thinking 或 idle；waiting 优先级高于普通 DOM 文本变化。
- **行为稳定性**：庆祝状态加入 12 秒冷却，避免一轮多工具完成时反复闪烁；完成和失败分别保持 5/7 秒后回到待机。
- **陪伴互动**：空闲 7–14 秒随机触发眨眼探头或弹跳微动作；双击聊天内蕾米触发庆祝彩蛋；页面隐藏及非 idle 状态下不会播放空闲动作。
- **结构化接口**：新增 remiReact(eventName, detail)，支持 turn/start、reasoning、tool/call、output、approval/asked、turn/completed、turn/error、turn/blocked、turn/idle 事件，便于后续主聊天和恢复流直接接线。

### 🎀 蕾米纯程序桌宠与等待动效升级 — 2026-08-20

- **默认显示逻辑**：页面刷新和首次打开统一保持聊天内头像模式，不再根据旧 localStorage 状态自动弹出放大小窗；用户点击最新蕾米头像后才进入可拖拽、可缩放的桌宠窗口。
- **纯程序绘制**：聊天头像、思考指示器、工具状态头像及放大小窗全部改为 HTML 元素 + CSS 渐变/裁剪/关键帧组成的矢量角色，不再依赖 idle/thinking/creating 等 GIF 文件，缩放时保持清晰并自然适配亮暗主题和不同 DPI。
- **状态表达**：继续复用既有 idle/thinking/creating/satisfied/done/stuck 状态机，通过眨眼、漂浮、发饰摆动、表情与星光动画体现状态，保留 setRemiMood/getRemiMood 外部接口。
- **等待反馈**：原先 0.85em 的文本省略号改为 9px 渐变圆点波浪，增强尺寸、间距、阴影、暗色模式和 reduced-motion 兼容，不再出现“无样式且太小”的观感。
- **生态调研**：尝试使用内置 Web Search 检索 GitHub 蕾米埃尔/桌宠项目，但当前检索服务返回 Insufficient Balance；本次因此采用无许可证风险、无外部运行时依赖的本地纯程序实现，后续可在联网恢复后继续评估 Live2D/WebGL 项目。

### ✅ 模型持久化真实浏览器验收与控制台错误清零 — 2026-08-20

- **最终根因（真实 CDP 调用栈确认）**：
  1. 跨提供商 `/models` 请求存在竞态：NVIDIA 等旧请求在切到自定义后才返回，并按当前提供商写入 DOM/localStorage，污染自定义模型列表；
  2. `core.js` 的 `getVal('modelSelect')` 在空 DOM 时隐式返回硬编码 `DEFAULT_CONFIG.model=deepseek-v4-flash`，`initializeConfig()` 随后把这个伪值反写进 `model_custom`，造成刷新必回 DeepSeek；
  3. 页面卸载时重复发送两份配置 Beacon，且模型时间戳曾在任意配置保存时刷新，放大了乱序覆盖。
- **最终修复**：
  1. `fetchModels` 引入 provider/baseURL/请求序号绑定，切换提供商立即 Abort 旧请求；迟到响应与错误回退均不得触碰新提供商 DOM；
  2. 删除 `getVal(modelSelect)` 隐式默认模型，`initializeConfig()` 直接以持久化 `_pm` 建立 option 并保存，禁止从空 DOM 反推 DeepSeek；
  3. 模型时间戳仅在真实 change 事件更新，卸载配置只发送一份规范 Beacon；
  4. 所有 `prompt()` 替换为异步站内输入弹窗；Highlight.js 高亮前将代码节点还原为纯文本，消除未转义 HTML 安全警告；
  5. 真实登录态 Chromium/CDP 验收：启动、NVIDIA→自定义快速切换、保存、刷新四阶段均保持 `custom/grok-4.5`；自定义列表无 `deepseek-v4-flash`、无 NVIDIA 污染，控制台错误/警告为 0。

### 🔒 模型选择服务器回灌与并发旧请求覆盖根治 — 2026-08-20

- **现象**：用户选定模型后，刷新或切换提供商必定回退到第一个模型/`deepseek-v4-flash`。
- **根因**：前端 `loadConfigFromServer` 收到数据库里旧的全局 `model` 与 `model_*` 后无条件覆盖浏览器即时选择；另有慢请求在用户刚选模型后的较晚时刻完成，使用旧快照反写服务端配置。
- **修复**：
  1. `public/js/storage.js`：本机有效 `model`/`model_{provider}` 为最高权威；服务端只可在对应本机键为空时补齐，禁止回灌旧值。
  2. 发送配置时将当前厂商专属模型原子同步到全局 `model` 与 `model_{provider}`，附 `_modelSelectionSavedAt`。
  3. `api/chat.php`：当迟到请求的模型时间戳早于已存配置时，丢弃其中所有 `model`/`model_*` 字段，防止旧标签页与网络乱序覆盖较新选择。
  4. 全量 20 项单测通过。

### 🔓 文件系统访问范围放宽与全盘权限动态授权升级 — 2026-08-20

- **现象与痛点**：模型在执行 `server_file_search` / `file_read` / `file_grep` 时，经常因为目标路径不在预设的单一 `PROJECT_ROOT` 或 `/tmp` 而触发 `“搜索路径不在允许的工作区或临时目录”` 拦截报错；即使普通聊天获取了 Agent 临时权限，也无法方便地扩展访问范围。
- **根因分析**：
  1. `python/engine/server_tools.py` 中的 `_allowed_path()` 此前硬编码只包含一个工程目录根（`/var/www/html/oneapichat`）和系统 `tempfile.gettempdir()`，导致用户查看 `/var/www`、`/var/log`、`/etc`、`/home`、`/opt` 等常用路径时均被误拦；
  2. 缺乏动态的全盘访问提权机制（类似 DSH 的 `danger-full-access` 提权通道）。
- **优化与修复方案**：
  1. **扩大默认核心路径**：`server_tools.py` 的 `_allowed_path` 默认允许集合扩大为 `PROJECT_ROOT`、`/var/www`、`/var/log`、`/etc`、`/home`、`/opt` 以及 `/tmp`、`/var/tmp`；
  2. **支持 `full_access` 动态提权**：在 `server_tools.py` 的 `engine_file_read`、`engine_file_write`、`engine_file_search`、`engine_file_grep`、`engine_file_edit` 各端点支持 `full_access=true` 参数，并在 `api/engine_api.php` 代理层透传；
  3. **前端弹窗授权与全盘提权联动**：
     - `ask_agent` 弹窗全面升级，提示用户授权包含全盘文件系统访问与终端执行；
     - 授权批准后设置 `window._fullFileAccessGranted = true` 与持久化标记，所有后续文件操作自动带入全盘访问参数，彻底杜绝路径拦截报错。
  4. 语法检查全部通过，PM2 热重启 `oneapichat-engine` 并完成 API 健康验证。

### 🎯 模型选择刷新/切换双向牢固持久化根治 — 2026-08-20

- **现象**：在选择模型后，刷新页面或者从其他提供商切换回来时，下拉框总会被强制重置为列表第 1 个模型，选定的模型无法被保存。
- **根因**：
  1. `fetchModels` 触发时无条件向选择器填充 `<option>加载中...</option>`，导致当前 DOM 的选中状态丢失；
  2. 异步拉取动态模型完成后，重新重构选项时将选中值重置回了 `models[0]`；
  3. 切换提供商时的预选缓存未能提前填充在 DOM 中，导致初始化时序竞态。
- **修复**：
  1. `public/js/config.js`：`fetchModels` 启动时直接用本地 `ModelsCatalog` 预渲染并保留当前已选模型，不再清空 DOM；动态请求完成后严格以 `model_{provider}` 为权威基准进行选中，严禁自动重置；
  2. `public/js/utils.js`：切换提供商时严格以专属缓存为先导，锁定选中态后同步服务器；
  3. 全量 20 项单测全部通过。

### 🚀 DSH 风格 Vibe Coding 全套底层工具与纯 SVG 状态看板落地 — 2026-08-20

- **背景与目标**：对标 DeepSeek Harness (DSH) 现代智能体运行时的 Vibe Coding 体验，全面消除以往单步工具调用的高心智负担与轮次往返瓶颈，提供更丝滑的可视化代码编写与任务执行体验。
- **核心升级**：
  1. **标准底层 Coding 工具链落地**：
     - 新增 read（带行号范围/截取读取文件）、write（安全写入/覆盖并自动创建 .bak 备份）、edit（局部字面量精确替换）、bash（终端命令执行与沙箱超时管理）、grep（多文件正则内容检索）、glob（文件拓扑模式发现）、todo_write（多步任务单原子替换）。
     - 支持参数别名无缝容错（command <-> cmd，file_path <-> path，offset/limit <-> start_line/max_lines，include <-> file_pattern 等）。
  2. **全面禁用 Emoji，对齐纯矢量 SVG 图标体系**：
     - 在 core.js 统一封装 VIBE_SVG_ICONS 与 getVibeSvg() 纯矢量图标库（包含终端、代码、编辑、搜索、文件、待办、成功勾选、失败交叉、进行中旋转等）。
     - 彻底清除工具卡片和时间线中的 Emoji 字符，所有状态呈现与徽章全部采用极简现代 SVG。
  3. **可视化统一代码 Diff 高亮组件**：
     - 当执行 edit 或 server_file_edit 成功后，自动生成类似 Git 统一格式的高质感行级 Diff 视图（含行号、绿背景+增、红背景-删、文件名徽章与路径）。
  4. **Live Todo HUD 任务实时进度看板**：
     - 当模型调用 todo_write 时，实时驱动顶部与会话内的 Todo 进度条 HUD（含动态百分比计算、脉冲呼吸灯指示进行中任务、完成 100% 后平滑淡出）。
  5. **全链路回归验证**：
     - 运行 build-index.py 重建标签，完成全部语法检查与 6 项核心单元测试，100% 验证通过。

### ⚡ 模型拉取国内直连提速与自定义厂商列表纯净化 — 2026-08-20

- **现象**：在自定义提供商或者某些国内提供商下，模型列表仍然会出现 `deepseek-v4-flash`；切换提供商或刷新模型时每个厂商都要耗时数秒甚至十几秒，体验卡顿。
- **根因分析**：
  1. **国内直连未优先分流**：`proxy.php` 的路由规则此前对很多非封锁域名默认走了 Mihomo 代理中继，导致原本延迟只有几十毫秒的国内大模型提供商（DeepSeek/智谱/通义/Kimi/豆包/MiniMax/小米MiMo等）全部被代理服务器绕了一大圈，一旦代理节点握手慢就会引发严重卡顿；
  2. **模型探测超时与重试过长**：`fetchModels` 之前设置了 15 秒超时并自带多次静默重试，一旦遇到慢接口整个页面就会卡住很久；
  3. **自定义厂商预设缺少纯净隔离**：`custom` 模式下之前未设立独立的空预设隔离规则，导致历史默认模型容易回填。
- **修复**：
  1. `api/proxy.php`：建立国内高频模型提供商白名单（`api.deepseek.com`、`open.bigmodel.cn`、`dashscope.aliyuncs.com`、`api.moonshot.cn`、`ark.cn-beijing.volces.com`、`api.minimaxi.com`、`api.xiaomimimo.com`、`api.longcat.chat` 等），全部**强制 0 延迟直连**，只有失败时才退避走 Mihomo/GCP 灾备；
  2. `public/js/config.js`：将模型探测超时收紧至 **6 秒**，并移除无谓的阻塞循环，超时直接秒级回退本地缓存 Catalog；
  3. `public/js/models-catalog.js`：彻底将自定义厂商列表与历史残留模型完全隔离，仅展示动态拉取结果或纯净用户输入；
  4. 全量 20 项单测全部通过。

### 🧹 提供商模型列表异构隔离与小米 MiMo 预设补齐 — 2026-08-20

- **现象**：在选择「小米 MiMo」等国内提供商时，模型下拉列表中除了 MiMo 自家模型外，还会多出一条 `deepseek-v4-flash`。
- **根因**：
  1. `ModelsCatalog` 缺少 `mimo`、`doubao`、`nvidia` 等提供商的预设目录定义；
  2. `renderModelOptionsHtml` 中有条兜底逻辑：若当前传入的 `currentSelected`（由历史或全局默认带入的 `deepseek-v4-flash`）在列表里不存在，就无条件调用 `enrichModel` 将其当做动态模型强塞入当前厂商列表；
  3. 下拉框选项遍历时发现不匹配，触发动态 `appendChild`，导致历史异构模型跨厂商串扰污染。
- **修复**：
  1. `public/js/models-catalog.js`：补齐 `mimo`（`mimo-v2-flash`、`mimo-v2.5`、`mimo-v2.5-pro`）、`doubao`、`nvidia` 的结构化预置模型库；
  2. `renderModelOptionsHtml` 增加跨厂商隔离鉴别：只有当选定模型明确属于当前厂商（或处于 `custom`/`llamacpp` 模式）时才允许追加，严禁将其他厂商的模型强塞进当前厂商；若历史模型不属于当前厂商，自动 fallback 选中当前厂商的第 1 项推荐模型；
  3. 全量 20 项单测全部通过。

### 🎯 模型选择持久化与切换提供商防回退第一项修复 — 2026-08-20

- **现象**：在各提供商选定非默认模型后，一旦切换提供商再切回来，或者刷新后，模型选择下拉框都会被强行回退到列表第 1 项，用户选定的模型丢失。
- **根因分析**：
  1. **DOM 赋值失败回退反写**：当重新渲染下拉框时，如果预设库中的模型 ID 大小写与用户持久化的 ID 存在微小差异（如 `grok-4.5` vs `Grok-4.5`），原生 `select.value = ...` 赋值失败会使 `select` 自动回落到第 0 个选项；随后 `fetchModels`、`onProviderChange` 与 `initializeConfig` 中的防空保底逻辑将 `selectedIndex = 0` 的值反向写入 `localStorage.setItem('model_' + provider)`，直接篡改覆盖了用户原本正确的模型记忆。
  2. **ModelsCatalog 动态注入缺少原始大小写保护**：未命中预设的自定义/动态模型在追加到选项列表时未严格保留原始 ID 大小写。
- **修复**：
  1. `public/js/models-catalog.js`：`renderModelOptionsHtml` 采用大小写不敏感匹配并严格保留用户选定模型的原始大小写，确保生成带有精准 `selected` 的 `<option>`。
  2. `public/js/utils.js`、`config.js`、`init.js`：在 options 匹配时全部使用大小写不敏感比对；若未找到匹配 option，动态追加一个带有用户完整 ID 的 `<option>`，绝不允许将第 0 项默认值反向写入覆盖 `model_{provider}`。
  3. 新增回归测试 `tests/model_selection_persistence.test.js`，全量 20 项单测通过。

### 🤖 模型列表拉取失败（403/欠费）离线内置目录兜底 — 2026-08-20

- **现象**：当提供商（如 xAI）API Key 额度用完时，调用 `/v1/models` 返回 403 Forbidden，前端模型下拉框卡死在“加载中...”，无法选择任何模型。
- **根因**：网络代理本身通畅（Mihomo 1080 正常），但 xAI 官方对欠费 Key 全局拒绝（403）；`fetchModels` 的 catch 块此前只弹 Toast，未恢复下拉框选项。
- **修复**：`public/js/config.js` 的 `fetchModels` 异常捕获中加入 `ModelsCatalog` 内置模型列表自动兜底渲染，同时将 403 明确提示为“API 额度已用尽或无权限 (403)”。

### 🌐 xiaoxin.naujtrats.xyz DSH 新建对话与核心 API 补全 — 2026-08-20

- **现象**：点击「新对话」时报错 `POST /api/llm.providers 404`，模型选择列表无法加载。
- **根因**：DSH 初始化新对话或读取提供商配置时请求 `/api/llm.*`，此前前缀分流规则漏掉了 `llm`，请求落入 3001 (CloudCLI) 报 404。
- **修复**：前缀分流补齐 `/api/llm`、`/api/model`、`/api/provider`、`/api/chat`、`/api/history`、`/api/search`、`/api/context`，实测 `POST /api/llm.providers` 返回 **200 OK**。

### 🌐 xiaoxin.naujtrats.xyz DSH 全功能补全与 Origin/WS 根治 — 2026-08-20

- **现象**：会话列表出现但加载极慢；控制台报 `/api/commands/*` 401、`/api/atFile/search` 404、WebSocket `wss://.../api/events.mux` 与 `events.host` 连接建立前即被服务端关闭。
- **根因分析**：
  1. **401/404 漏路由**：前缀分流表中缺少 `commands` 与通用的 `atFile`（原先仅写了 `atFile/getSettings` 精确匹配），导致相关请求落入 3001 (CloudCLI) 报 401/404。
  2. **WebSocket closed 根因**：`/api/events.mux` 与 `events.host` 路由缺少 `proxy_set_header Origin "";` 清空。当浏览器携带 `Origin: https://xiaoxin.naujtrats.xyz` 发起 WebSocket 握手时，后端 3080 校验 Origin 与 Host (127.0.0.1:3080) 不匹配，立即主动掐断握手连接。
  3. **会话加载慢**：39 条分流路由均未开启 gzip 代理压缩，导致几十兆的 `session.history` 明文传输耗时极长。
- **修复**：
  1. 补齐 `location ^~ /api/commands` 与 `location ^~ /api/atFile`。
  2. WebSocket 路由补齐 `proxy_set_header Origin "";`，携带浏览器 Origin 握手验证返回 **101 Switching Protocols**。
  3. 所有 39 条 API 路由统一开启 `gzip on; gzip_proxied any;`，加速历史响应。

### 🌐 xiaoxin.naujtrats.xyz DSH API/WebSocket 全通修复 — 2026-08-20

- **现象**：页面能进但全部 API 404（host.describe、session.list、settings.describe、credentials.describe、agentPreset.list、dynamicCordisRunner/*、atFile/getSettings、pluginInventory/list）、sidebar 403、WebSocket events.mux/events.host 连接失败。
- **根因**：内网 DNS 把 xiaoxin 指向 192.168.195.213:443 的 default server，而 default 的 `location /api/` 属于 CloudCLI(3001)，DSH 客户端根路径 `/api/*` 全部打到 CloudCLI → 404；HTML 的 sub_filter 缺 `'\"/api/'` 改写和 base 注入（客户端 JS 为运行时拼接路径，改写后走 `/oneapichat/dsh/api/` 才能到 3080）；/sidebar/ 等顶层路由未清 Origin 头 → 3080 校验 403。
- **修复**：default 补 `sub_filter '\"/api/' '\"/oneapichat/dsh/api/';` 与 `<base href>` + `__DSH_BASE_PATH__` 注入；新增 39 条 `/api/<方法名前缀>` 分流路由→3080（session./host./settings./credentials./agentPreset./pluginInventory./skills./dynamicCordisRunner/atFile 等，避开 CloudCLI 的 /api/）；events.mux/events.host WebSocket 精确路由（101 握手）；全部顶层路由补 `Origin ""` 清空 + Upgrade/Connection 头。
- **验证**：本机 443（Host: xiaoxin）全部 API 200、sidebar 200、WS 101。

### 🌐 xiaoxin.naujtrats.xyz DSH 资源 404 修复 — 2026-08-20

- **现象**：`https://xiaoxin.naujtrats.xyz/oneapichat/dsh/` 页面可开但全部静态资源 404（assets JS/CSS、client.js、/favicon.svg、manifest 图标）。
- **根因**：用户内网 DNS 把 xiaoxin.naujtrats.xyz 解析到 192.168.195.213:443（本机 default server），而 default 的 DSH 路由不完整：①`location /oneapichat/dsh/` 缺 `^~` 修饰符，被内部 `~* \.(js|css)$` 正则 location 抢占，assets 全部 404；②缺 /plugins/、/favicon.svg、/client.js、/sw.js、/sidebar/、/super-injector/、/usage-stats/、/dsh-market/、/api-import/、/dsh-memory/ 等顶层 DSH 路由。
- **修复**：本机 default 加 `^~` 并在 `location ^~ /oneapichat/` 块后补全全部 DSH 顶层路由（含 /plugins/events 86400s SSE 长连接）；边缘 176/226 新建 xiaoxin.naujtrats.xyz server 块（80 重定向 + 443 完整 DSH 代理），226 复制 176 的通配证书（`*.naujtrats.xyz`）到 /etc/letsencrypt/live/xiaoxin.naujtrats.xyz/ 并重指。
- **验证**：内网 443 + 176 + 226 三路 page/asset/favicon/plugins/manifest 全部 200；备份 `/etc/nginx/backups/default.bak-20260820-dsh`。

### 🌙 DSH 502/504 根治：ZeroTier moon 中继部署 — 2026-08-20

- **现象**：DSH Web GUI 大量 502/504/ERR_CONNECTION_RESET（modlens、pluginInventory.list、agentPreset.list、settings、CSS、manifest 全挂）。
- **根因链**：①03:56–04:04 dsh-web.service 连续崩溃重启（SIGBUS，restart counter 5→6）；②04:08/04:13 本机 nginx reload；③**持续性根因**：边缘 176/226 到 Windows 宿主 ZeroTier 节点（08cf1e942b）走国外 planet RELAY，大陆链路间歇性 `connect() failed (113: No route to host)`，边缘 nginx 返回 502。
- **修复**：边缘 176 生成并部署 ZeroTier moon（000000047f34d1cd.moon，阿里云 115.29.211.17:9993），226 已加入 moon（RELAY→DIRECT 4ms）；本机 nginx DSH 路由完整（/plugins/events 86400s SSE 长连接）；dsh-web.service 加固（StartLimitBurst 12/600s、MemoryHigh 3G、MemoryMax 4G，未重启避免断会话）。
- **Windows 侧已完成（经 ssh xiang@127.0.0.1 管理员会话）**：local.conf 写入 moonIds（永久生效）+ `zerotier-cli orbit 047f34d1cd 047f34d1cd` 动态加入成功；验证 peers：Windows→176 **DIRECT 61ms**、Windows→226 **DIRECT 60ms**，全部 RELAY 消除；公网压力测试 20/20 成功。⚠️ 坑：orbit 脚本中的 `Restart-Service` 会把 ZeroTierOneService 停掉且无法自动拉起（SSH 会话令牌未提升），需 `sc start ZeroTierOneService` 恢复；部署脚本 `deploy/zerotier-moon-windows.ps1` 已改为只写 local.conf + orbit（不重启服务）。

### 📈 全球金融实时行情全覆盖与时区交易感知升级 — 2026-08-20

- **失误根因深度复盘**：
  1. **时区时空倒错与休市误判**：用户在北京时间凌晨（00:56）提问美股行情，美东时间夏令时（EDT UTC-4）恰为周三 12:56 午盘，正处于常规盘中交易时间。但旧版 `get_current_time` 仅返回单一时区（Asia/Shanghai），AI 未能换算美东时差，产生“美东8月19日已收盘/8月20日还没开市”的幻觉，将实时盘中走势判定为休市，将昨日结算数据误认作当前最新数据。
  2. **工具体系存在全球市场盲区**：原 `stock_*` 系列工具仅支持 A 股（沪深京），不支持美股股票、美股指数（如费城半导体 SOX、纳指、标普、道指）、港股与全球外盘。模型查美股时被迫走 `web_search`，受到旧网页与滞后新闻污染。
  3. **附会编造与确认偏误（Confirmation Bias）**：模型在搜索不到实时盘中数据时，非但未严谨核实，反而迎合用户提问中的跌幅数值，拉取大盘历史数据编造所谓的“杠杆放大传导链”，导致严重误导。
  4. **静态抓取对 SPA 行情页失效**：东方财富等金融网页依赖前端 JavaScript 异步请求行情网关，`web_fetch` 获取的静态骨架中缺乏实时渲染数字，AI 无法提取有效点位。

- **系统升级与落地实施**：
  - **金融数据引擎重构 (`python/engine/stock_data.py`)**：
    - 全球代码智能分类器 `_classify_symbol`：支持 A 股、美股股票（NVDA, AAPL, TSLA, AMD, TSM, MU 等）、美股/全球主要指数（SOX, IXIC, NDX, SPX, DJI, RUT, HSI, HSTECH, N225, DAX）及港股（00700, 09988）；
    - 新浪财经 + 腾讯财经 + 东方财富三路毫秒级冗余源，返回结构化点位、涨跌额、涨跌幅、今开昨收、最高最低、振幅、美东/北京双时间戳及市场状态；
    - `get_market_overview` 升级为全球全景看板，一键聚合美股核心指数、A 股指数、港股及全球主要外盘；
    - `get_kline` 与 `generate_chart` 全面支持美股、港股与全球指数暗色图表渲染。
  - **全球时区与金融时钟感知增强 (`python/engine_server.py` + `public/js/tools-exec.js` + `public/js/main.js`)**：
    - `get_current_time` 与 `main.js` 时间感知层注入北京时间 (UTC+8)、美东时间 (EDT/EST，自动夏冬令时判断)、伦敦时间及东京时间；
    - 自动输出美股（盘前/盘中/盘后/休市）、A 股与港股当前秒级交易状态，附带强提醒避免时差误判。
  - **工具定义与系统提示词实事求是约束 (`public/js/tools.js` + `public/js/translations.js` + `public/js/upload.js`)**：
    - 工具定义明确声明全市场覆盖，提示模型查询股票/指数行情时优先调用结构化工具；
    - 系统提示词增加金融与时效性严谨准则，严禁凭空推测或强行附会因果论断。
  - **SPA 金融网页智能指引 (`public/js/search.js`)**：
    - `performWebFetch` 检测到金融行情动态页面时自动附加提示，引导模型改用专用行情工具。
  - **开放公共只读接口放行 (`api/engine_api.php` + `python/engine_server.py`)**：
    - 将 `stock_*` 系列只读端点加入免登录与 public 白名单，保障访客与所有会话高可用。

- **验证与效果**：
  - 经 Python 单元测试与 Nginx/PHP 代理实测，SOX、NVDA、00700、600519 及全球市场概览接口均在 0.05 秒内返回准确行情与市场状态；
  - 运行 `python3 tools/build-index.py` 重新生成前端资源版本；
  - 重启 Python 引擎并通过端到端 API 验证。

### 🪵 控制台日志全链路规范化、隐私脱敏与智能降噪 — 2026-08-16

- **根因分析**：
  1. **无序调试杂讯**：前端各业务模块分布着 580+ 处 `console.log/warn/error`，缺乏统一分级，大量启动、恢复与中间状态诊断直刷生产控制台。
  2. **敏感信息与用户隐私泄露**：`buildApiMessages`、`main.js`、`tools-exec.js`、`stream-handler.js` 等模块在控制台截断打印用户输入、模型正文、工具参数（如网盘登录）、上游完整 400 错误、URL 凭证及原始 SSE/JSON buffer。
  3. **预期容错与自愈误报**：正常的回退重试、防覆盖保护性跳过、用户主动停止等被滥用为 `warn/error`，制造故障假象。
  4. **访客状态后台报错**：RAG 知识库系统在未登录时在后台盲目发起 collection/knowledge 探测，导致控制台出现 401 失败与未捕获异常。

- **优化与修复方案**：
  - **核心日志器与兼容桥 (`public/js/core.js`)**：
    - 在最顶部初始化轻量级结构化日志层 `window.AppLogger`，包装原生 console 方法，默认级别设为 `warn`；
    - 支持 `AppLogger.setLevel('debug')`、`sessionStorage` 记忆及 URL 参数 `?debug=1` / `?log=debug` 快速开启调试；
    - 内存保留最近 200 条结构化日志环形缓冲区（`AppLogger.getRecent()`），支持 3 秒窗口重复日志折叠；
    - 针对 Bearer Token、API Keys、密码、Cookie、URL 敏感 query 及数据结构执行深度自动脱敏，支持循环引用与 DOM 节点保护；
    - 精确拦截 KaTeX 字体指标等已知无害第三方警告，并将非致命回退/跳过自动降级为 info/debug。
  - **模块日志脱敏与结构化改造**：
    - `public/js/api-messages.js`, `main.js`, `agent.js`, `ui.js`, `tools-exec.js`, `stream-handler.js`, `image-gen.js`, `upload.js`, `utils.js`, `config.js`, `resume-stream.js`, `cloudreve.js`, `storage.js`, `agent-notify.js` 等 14 个模块全面移除正文/参数字符串输出，改为只记录长度、数量、状态码等安全元数据。
  - **RAG 访客守卫 (`public/js/rag-system.js`)**：
    - 增加 `_ragHasAuth()` 检查，未登录时禁用控件并展示友好占位，不再发起后台网络请求；增加集合加载异常捕获。

- **验证与效果**：
  - 新增 `tests/app_logger.test.js`（11 项分级/脱敏/降噪/还原测试）与 `tests/console_hygiene.test.js`（代码清洁度与加载顺序测试），全量 18 个前端测试套件 100% 通过；
  - 运行 `python3 tools/build-index.py` 重新生成标签与版本号；
  - Playwright 无头浏览器实测：生产模式冷启动控制台日志从原本报错刷屏降为 **0 条（完全干净）**，开启 `?debug=1` 时输出格式整齐且完全脱敏的模块调试日志。

### 🔕 刷新后 SSE 历史通知回放风暴根治 — 2026-08-16

- **根因分析**：
  1. 引擎端 `/engine/events` 为重连设计了 256 条历史游标回放，但在新页面冷启动（无 `Last-Event-ID` 请求头）时默认从 0 开始回放，导致每次刷新页面都会收到过去所有已广播的 `agent:mode_changed`、`chat:stream_started`、`chat:updated` 等事件。
  2. 每次刷新页面前端都会重新生成随机的 `_sseSourceId`，导致刷新前自己发送的广播事件在回放时无法被 `ev.source === window._sseSourceId` 过滤，误判为“其他设备发来的操作”。
  3. 前端对回放事件未做静默标记，频繁触发多条 `showToast` 弹窗堆叠；全局 Toast 容器无去重和数量上限保护。
- **修复方案**：
  - **引擎端 (`python/engine_server.py`)**：新增 `_resolve_sse_replay_cursor`，全新连接（无游标）默认对齐当前队尾，不再重放历史全量；仅当存在有效 `Last-Event-ID` 时才按需补发断线期间的差量事件。
  - **前端同步 (`public/js/agent-notify.js`)**：`_sseSourceId` 持久化至 `sessionStorage`，刷新后保持标签页身份；记录重连回放 cutoff 游标，回放事件仅更新状态不弹 Toast；对连续 `agent:mode_changed` 增加 150ms 防抖，对同一会话 `chat:stream_started` 增加 5 秒节流。
  - **通知系统 (`public/js/ui.js`)**：`showToast` 增加相同内容展示期去重与全局最多 6 条上限，溢出自动挤掉最旧气泡。
- **验证**：新增 `python/tests/test_sse_refresh_replay.py` 单元测试（4/4 通过）；PM2 热重启引擎，HTTPS 静态资源版本更新为 `agent-notify.js?v=1786903633` 与 `ui.js?v=1786903796`。

### 🔄 更新提示按钮休眠竞态修复 — 2026-08-16

- **根因**：`public/js/update-check.js` 在创建更新按钮后，通过 `requestAnimationFrame` 异步读取可变的全局 `_btn`。页面长时间休眠再恢复时，30 秒隐藏定时器和 300ms 移除定时器可能先执行，把 `_btn` 设为 `null`；随后滞后的 RAF 回调访问 `_btn.style`，触发 `Cannot read properties of null`。
- **修复**：动画、隐藏和移除回调全部捕获本次创建的局部 `btn` 实例；RAF 写样式前校验 `_btn === btn` 和 `btn.isConnected`；隐藏与移除定时器分别管理，旧回调只清理自己的节点；挂载时兼容 `document.body` 尚不可用的情况。
- **验证**：新增 `tests/update_check_race.test.js`，模拟“隐藏/移除定时器先执行、RAF 后执行”的休眠恢复顺序，确认不再抛异常；`node --check`、`python3 tools/build-index.py --check` 通过，HTTPS 本机入口已返回新资源版本 `update-check.js?v=1786900977`。

### 🛡️ 消息队列持久化隔离修复与人格预设 429 降噪 — 2026-08-16

- **队列根因与修复**：队列持久化键原来隐式读取当前模式/会话，模式与会话切换时容易把内存队列写回错误的 `oc_queue_*` 键；清空后刷新又会恢复旧模式残留。`public/js/queue.js` 现支持显式 mode/chatId，过滤空条目并按会话清理普通/Agent 双键；`public/js/agent.js`、`dialogs.js` 和 `init.js` 在切换及冷启动时显式保存、加载和清理目标队列。
- **429 根因与修复**：密集 SSE 更新重复触发 `loadChat → refreshMemoryContext`，并发请求 `memory_context/personality_load` 命中 nginx 限流，HTML 429 页面又被直接当 JSON 解析。现在增加安全 Content-Type/429 处理、15 秒 TTL 和单飞 Promise，并对同会话 `chat:updated` 做 300ms 防抖。
- **验证**：前端资源重建及 `python3 tools/build-index.py --check` 通过。

### 📥 夸克网盘大文件下载与动态会话修复 — 2026-08-16

- **根因**：夸克分享解析虽然能取得 `Desktop.zip.002` 的直链，但直链依赖动态 Cookie、Referer 和 User-Agent；原下载路径只适合短请求，模型直接调用 `netdisk_download` 时也不会自动把分享链接重新解析，3.52 GiB 文件还会超过前端 60 秒工具等待时间。
- **修复**：`api/netdisk_api.php` 支持 `netdisk_download` 直接接收分享链接并在服务端解析；夸克下载完整转发动态会话头，aria2 增加断点、重试和超时参数，失败时使用 curl 单连接断点续传；超过 512MB 的文件进入 `.jobs` 后台队列，`netdisk_status(job_id)` 返回 running/completed/failed、已下载大小和目标文件。解析+下载结果不再向模型回传 Cookie。
- **前端/工具**：`public/js/netdisk.js` 延长解析等待并检查 HTTP 状态；`public/js/tools.js` 明确大文件队列和轮询流程。
- **验证**：用户提供的夸克链接实时解析成功，识别文件 `Desktop.zip.002`、大小 `3775758330` 字节；使用同一动态请求头的 Range 请求返回 HTTP 206；全量测试 15 项通过。

### 🧰 Skills 长消息 414 请求修复 — 2026-08-16

- **根因**：`matchSkills()` 把完整用户消息拼接到 GET `query` 参数；遇到很长的提示词注入文本时超过 nginx URL 限制，返回 414 HTML，前端随后调用 `response.json()` 报 `Unexpected token '<'`。
- **修复**：`public/js/skills.js` 改用 POST JSON，限制匹配文本为 12000 字符，并在解析 JSON 前检查 HTTP 状态；`api/skills_api.php` 同时支持 JSON POST、表单 POST 和旧 GET。
- **验证**：新增 `tests/skills_match_transport.test.js`。

### 🔄 刷新时生成中聊天恢复修复 — 2026-08-16

- **根因**：DB 索引模式下刷新会先得到没有正文的本地索引；原 `loadChat` 只在 DOM 渲染后调用 `ResumeStream.hydrate()`，快照找不到对应 assistant 消息时无法创建气泡，正在生成的回复因此完全不可见。页面卸载时还会随机保存第一个聊天的 partial，而不是当前正在生成的聊天。
- **修复**：`public/js/dialogs.js` 在渲染前从 ResumeStream 快照创建/补齐 `partial` assistant 消息；无快照时从 `_savedPartial` 兜底恢复，并迁移流身份供续接。`public/js/init.js` 优先保存 `currentChatId` 的 partial，并补充时间戳。`public/js/main.js` 创建可恢复流前等待聊天快照保存完成，避免服务器快照与流状态竞态。
- **验证**：新增 `tests/stream_refresh_recovery.test.js`；前端全量测试 13 项通过，资源构建检查通过。

### 🧹 过期子代理幂等删除与 404 降噪修复 — 2026-08-16

- **根因**：清理逻辑对已经不存在的历史子代理继续发送 DELETE，`api/chat.php` 将幂等删除返回为 HTTP 404，因此浏览器控制台持续报错。
- **修复**：DELETE 目标不存在时返回 HTTP 200，并带 `already_missing: true`；重复清理视为成功，不再制造错误日志。
- **验证**：PHP 语法检查及前端回归测试通过。

### 🧹 Agent 历史恢复与过期子代理清理修复 — 2026-08-16

- **历史恢复**：`public/js/storage.js` 识别 `_localIndex`/`_indexOnly` 元数据对象；当服务器拥有完整消息时，即使时间戳没有更晚也优先恢复正文，避免 Agent 模式进入后只有空会话。普通聊天同样补齐索引模式恢复。
- **过期清理**：`public/js/agent.js` 的过期子代理删除改为限速串行请求（280ms 间隔），等待 DELETE 完成后再保存剩余聊天，避免批量请求触发 429，也避免全量 POST 把待删除会话重新写回。
- **验证**：新增 `tests/agent_history_cleanup.test.js`；前端全量测试 12 项通过，资源构建检查通过。刷新页面后会自动清理超过 48 小时且超出保留数量的子代理会话。

### 🧠 推理过程标题去除思考 Emoji — 2026-08-16

- **调整**：`public/js/rendering.js` 和 `public/js/tools-exec.js` 的推理/思考折叠标题移除 `🤔`、`💭`，保留纯文字标题和原有折叠箭头。
- **验证**：已重新构建前端资源并通过 JavaScript 语法检查。

### 🧩 会话 404 回退与 Mermaid 空白预览修复 — 2026-08-16

- **会话恢复**：`api/chat.php` 在单会话文件不存在但 `all.json` 仍有该会话时直接返回权威会话快照，消除正常历史会话的 404；`public/js/agent-notify.js` 同时保留 `chat_id=all` 回退和一次延迟重试，避免 SSE 重连期间把会话误判为消失。
- **Mermaid 预览**：Mermaid 图表点击灯箱时不再把含 `foreignObject` 的 SVG 仅作为 `<img>` data URL 加载；`public/js/init.js` 传递 SVG 标记，`public/js/rendering.js` 在画布中直接挂载 SVG DOM，并支持缩放、下载和亮/暗色画布，避免部分浏览器显示空画布。
- **回归验证**：新增 `tests/mermaid_lightbox.test.js`，并通过 JS 语法检查与 `python3 tools/build-index.py --check`。

### 🎛️ Agent 完成操作卡片单行布局修复 — 2026-08-16

- **问题**：`details` 的原生 marker 与未定义的汇总布局样式导致闪电图标、展开三角和“Agent 执行了 N 步操作”文字分成多行。
- **修复**：`public/css/style.css` 新增 `.dsh-timeline-group-summary` flex 单行布局，隐藏原生 marker，限制标题溢出，并让完成状态胶囊固定在右侧；同时补齐亮/暗色主题、边框和间距。
- **验证**：已重新运行 `python3 tools/build-index.py` 与 `--check`。

### 🔄 多端会话同步与断线回放升级 — 2026-08-16

- **聊天快照**：`public/js/agent-notify.js` 不再拉取整个 `all.json` 后按长度错误拼接，而是按 `chat_id` 拉取单会话服务器快照；远端更新完成后替换本地会话并写入本地持久化，保留本端正在生成的 partial，避免旧消息覆盖、新消息插到历史前面或刷新后丢失。
- **广播顺序**：用户消息和队列/插话消息通过 `_saveAndBroadcast()` 先完成服务器保存再通知其他设备；`saveChats()` 捕获发起时的 chat ID，避免切换会话后把完成事件广播给错误会话；移除 ResumeStream 完成路径的提前广播。
- **SSE 游标回放**：`python/engine_server.py` 为每个用户保留最多 256 条带 `id` 的事件，浏览器重连时按 `Last-Event-ID` 回放；事件历史仅短期内存缓存，跨进程/重启则由连接恢复快照和 8 秒低频兜底同步补齐，不泄露到其他用户。
- **断线与并发保护**：SSE 断线时启动低频当前会话快照同步，连接恢复后立即补齐；不同会话不再因当前会话正在流式生成而被整体忽略；同步请求按 chat ID 单飞，避免重复拉取。
- **验证**：Python 引擎编译、Node.js 修改文件语法检查、`test_multidevice_sync.py` 与 ResumeStream 回归测试（8 项）通过；前端资源已运行 `python3 tools/build-index.py --check` 校验。

### 🌐 123网盘直链解析与蓝奏云失效识别修复 — 2026-08-16

- **123网盘**：补齐此前只有类型识别、没有实际 parser/dispatch 的缺口；从分享 URL 提取 ShareKey，通过 `123pan.cn/gsb/s/share-key` 获取动态 UserID，再调用官方 `/share/get` 获取文件元数据和 `/v2/share/download/info` 请求直链。支持 `123pan.com` 与 `123pan.cn`、提取码错误映射、文件名/大小返回和官方流量限制错误。
- **蓝奏云**：对页面正文中的“文件取消分享”“分享不存在”“链接已失效”等明确状态返回 `reason=share_expired`，只有无法提取签名/遭遇反爬时才返回 browser fallback 错误。
- **实测结果**：用户提供的 123Pan 链接已不再返回“暂不支持”，而是命中官方 `code=5112`，明确说明分享方提取流量包不足；蓝奏云链接实际页面显示“文件取消分享”，现在准确返回“蓝奏云分享已取消或已失效”。
- **验证**：Python 编译、123Pan 正确/错误提取码、123Pan.cn 域名识别、两个真实分享链接 smoke test 通过。当前两个公开链接本身无法生成直链，原因来自分享状态/流量策略，不是解析器未接线。

### 🧭 无头浏览器鉴权转发修复 — 2026-08-16

- **根因**：`api/engine_api.php` 已验证主站 Bearer 后，通过本地 internal bridge 调用 FastAPI `/engine/browser/*`，但浏览器各路由没有附加 `user_id` 查询参数；FastAPI 的 trusted internal 请求不会自动填充 `request.state.user_id`，`_bound_owner()` 因而返回 `authenticated user required`（401）。
- **修复**：新增 `$engineUserQuery`，并让 navigate、screenshot、click、type、content、snapshot、js 七个浏览器端点统一携带已验证用户绑定；不把 token 放进新增 URL，仅传内部已验证的用户 ID。
- **验证**：`php -l api/engine_api.php`、PHP bridge 静态回归、Python Playwright 连接现有 CDP Chromium，及 `https://example.com` 的导航/正文/DOM 快照/PNG 截图 smoke test 全部通过；引擎端带 internal bridge 身份的 navigate/content 端点也返回成功。

### 🧭 Agent 会话边界与历史筛选加载顺序修复 — 2026-08-16

- `public/js/core.js` 的 `isAgentChat` 不再用宽泛的 `_agent_` 前缀匹配，归档/子代理 ID 必须分别带完整的 `_agent_old_` 或 `_agent_sub_` 边界；主会话 `_agent_main` 和其他已定义的内部会话前缀保持不变。
- `public/js/dialogs.js` 的历史筛选在 `AGENT_CHAT_ID` 尚未由 core.js 建立、或单元测试单独加载时，使用安全的 `_agent_main` 回退值，避免 Agent 面板直接报 ReferenceError。
- 验证：Agent 会话分隔测试与全量 10 项 Node 回归测试通过。

### 🧹 预期 400 回退日志降噪 — 2026-08-16

- ResumeStream 遇到上游安全过滤或请求未接受时仍保留一次 HTTP 直连回退，但前端日志从 `console.warn` 降为 `console.info`；这类受控回退不再被误认为客户端异常。

### 🕷️ 网页抓取、Agent 聊天与下载工具可用性增强 — 2026-08-16

- **web_fetch 安全回退**：普通 HTTP 抓取继续作为快速路径；遇到 301/302/303/307/308、403/429/5xx、JS 空壳或正文过短时，转交本机 Playwright/Chromium 渲染。浏览器请求增加 DNS/IP 公网守卫，禁止重定向或页面资源访问本机、内网、保留地址；验证码/人工挑战不做绕过，失败时返回明确错误。
- **正文提取**：新增 `python/web_extract.py`，支持 JSON-LD articleBody、article/main 候选评分、标题/段落/链接/图片保留和相对 URL 解析；GET 与批量 POST 都接入兜底，批量 curl 不再自动跟随未经验证的重定向。
- **Agent 聊天**：关闭 Agent 聊天面板前先把焦点移到外部触发按钮，再设置 `aria-hidden/inert`，消除浏览器的 focused-descendant 警告；缓存 JSON、结构化结果、通知接口均增加容错，非 JSON/异常对象不会再让面板渲染崩溃。
- **下载文件可发现性**：B站 yt-dlp 与下载监控状态新增 `artifacts`、`read_hint`，`completed_files[].path` 是唯一可信的绝对路径；工具描述明确默认目录、`server_file_read` 只能读具体文件、执行命令使用 `server_exec`，不再猜测不存在的 `run_command` 或 `/tmp/video-hunter-downloads`。
- **网盘解析**：蓝奏云本地签名解析失败时使用 Chromium 执行公开页面动态脚本；Lanzu 失败不再追加无关的 JxPan“密码错误”，避免误导用户。无效百度/夸克链接的实测返回结构化失败而不是进程崩溃。
- **验证**：`php -l`、Node/Python 语法检查、`example.com` Chromium 正文提取、百度/夸克/蓝奏云公开端点解析 smoke test 通过；真实蓝奏云分享链接仍需用户提供可公开访问的分享 URL 才能验证直链提取。

### 🧠 项目自描述、按需上下文与刷新续接加固 — 2026-08-16

- **项目自描述**：新增 `agent_context/PROJECT.md`、`ARCHITECTURE.md`、`OPERATING_RULES.md`、`CHANGE_POLICY.md`，明确项目身份、架构、事实来源、修改前后检查和副作用恢复规则；`python/engine/self_description.py` 按查询关键词和字符预算选择上下文，避免把整份规则文件无界注入模型。
- **自查询能力**：引擎新增 `/engine/self/describe`、`/engine/self/context`，并提供 `project_self_describe` 工具，模型询问项目自身信息时可按需读取有界、无密钥的事实。Agent system context 同时接入该选择器。
- **刷新/重启可见性**：active task reconciliation 在进程生产者消失但已有快照时使用 `recoverable`，不再把任务静默改成 interrupted 后从列表消失；恢复列表附带 snapshot 字段，客户端可继续按 msg_id 显示最后事实。
- **持久化 ACK**：chat/create 的任务注册现在是可恢复 ACK 的持久化屏障，数据库写失败返回结构化 503 并停止后台线程，不再制造“前端已拿到 stream_id、后端却查不到任务”的幽灵会话。
- **多任务恢复**：移除 `_recoverActiveTasks()` 对全局 `_rs_sid/_rs_msgid/_rs_cid` 的覆盖，改用 `ResumeStream.resume(chatId, streamId, msgId)` 显式绑定，避免多个聊天互相劫持。
- **工具安全与兼容**：server file read/search/edit/write/op 统一使用 resolved component-aware containment，修复路径字符串前缀绕过；流式响应兼容代理把 JSON 格式化为多行时的 `{ ... }`，减少 JSON 解析告警和无意义 HTTP 回退。
- **限制**：Python 引擎重启后无法复活已经断开的第三方上游连接；本次保证部分结果可见、任务不消失、不会伪造普通 provider error，真正继续生成仍需用户重试/继续。
- **代理 400 日志**：`400安全过滤` 是 ResumeStream 对上游拒绝后的有意直连重试提示，不再把对象错误打印成 `[object Object]`；若中继返回多行 JSON，前端先拼完整对象再判断 provider error，避免空结果安全过滤误报和残留 `{` 解析告警。
- **验证**：Python 模块编译、`test_self_description.py`、可恢复任务持久化断言、工具配对和 ResumeStream Node 测试通过；PM2 `oneapichat-engine` 已重启并在 8766 health 返回 200。

### 🔑 B站扫码内联二维码与 web_fetch 401 修复 — 2026-08-16

- **B站扫码**：二维码只通过后端返回的 base64 交给前端独立展示，移除本地文件路径、Cloudreve 上传和失效公网链接字段；工具结果明确要求使用 qrcode_key 继续 poll，禁止调用 cr_upload_file 或 video_cloudreve_url。
- **web_fetch**：修复 proxyFetch 对同源 /api/fetch.php 请求不带 Bearer Header 的问题。配置加载请求带认证并不代表 URL 抓取请求也带认证，之前因此连续收到 401；现在同源受保护 API 同样使用主站 token 和 same-origin credentials。

### 📐 扫码二维码独立消息居中修复 — 2026-08-16

- **修复**：data-qr-login 独立消息行在 DSH 主题下受到助手头像布局影响，二维码按自身内容宽度贴在左侧；现让独立 QR 行占满聊天消息区，并让内部二维码卡片宽度为 100%、内容居中。

### 🔐 Server 工具鉴权与联网失败回退修复 — 2026-08-16

- **Server 工具**：`engineApiHandler()` 统一在 `/oneapichat/api/engine_api.php` 请求中补 Bearer Header，修复浏览器未携带同站 `auth_token` Cookie 时 `server_file_grep`、`server_exec`、子代理等工具误报“未登录”。同时修复 `agent_create/agent_run` 路径缺失局部 token 变量的问题。
- **工具提示**：`ask_agent` 授权结果不再硬编码“可用工具”列表，改为要求模型只调用当前请求 tools schema 中真实存在的工具，避免把提示文本当作动态工具注册。
- **联网回退**：`web_fetch` 工具说明明确当前代理、服务器中继和直连的回退顺序；全部失败后应调用 `toggle_proxy` 请求用户确认，而不是自行拼接并臆造 ghproxy/gitclone 镜像地址。

### 🖼️ 搜索图片链接直接渲染 — 2026-08-16

- **问题**：搜索/浏览工具返回的图片常以“[图片 原图](URL)”形式出现；URL 没有图片扩展名时，前端只能显示文本链接。
- **修复**：autoLinkURLs 识别“图片、原图、封面、立绘、美图、壁纸、插图、截图”等图片标签，并兼容带图片扩展名的链接，将其转换为 Markdown 图片节点；core.js 的历史/非流式渲染路径也统一调用该转换；图片 URL 自动升级为 HTTPS，图片加载失败时恢复为可点击原图链接；视频链接和普通网页链接保持原有文本链接行为。
- **验证**：新增 tests/auto_image_links.test.js，覆盖图片标签、视频链接和带查询参数的图片 URL。

### 🔁 工具轮配对与刷新续接稳定性修复 — 2026-08-16

- **问题现象**：刷新后恢复或工具链继续请求时，偶发出现 assistant tool_calls 必须紧跟 tool 响应的 400；ResumeStream 文本完成后还可能出现 Cannot read properties of undefined (reading length)。
- **根因**：
  1. 刷新/断线会把 assistant 的部分 tool_calls、乱序/孤立的 tool 结果或尚未完成的工具轮次写入本地/服务端历史；原有安全检查只按全局 ID 统计是否出现过结果，没有保证结果紧邻对应 assistant，也没有移除孤立 tool 消息。
  2. ResumeStream 的日志使用了 toolCalls || []，但完成判断仍直接访问 result.toolCalls.length；旧状态、文本快路径或后端响应缺省该字段时直接抛异常。
  3. DB/index 模式的聊天对象可能只有索引元数据，messages 不是数组；部分旧工具结果也可能是对象，恢复和历史渲染路径直接调用 length/filter。
- **修复**：
  1. 新增 normalizeToolMessagePairs()，在构建 API 消息、RS/HTTP 发出前按 assistant.tool_calls 顺序重排紧邻 tool 结果，丢弃不完整调用和孤立结果；后端 engine_server.py 增加同等 provider 入口防线。
  2. ResumeStream 统一补齐 fullText、reasoningText、toolCalls，修复文本完成分支的 undefined.length；持久化状态、工具结果和缺失会话/消息数组全部做类型归一化。
  3. 恢复合并、loadChat 和历史渲染前将 messages 归一化为数组，旧对象型工具字段转为安全字符串。
  4. 增加 tests/tool_pairing.test.js，覆盖乱序完整工具轮、部分工具结果、跨用户消息的孤立结果和对象参数转换。
  5. 修复 runtime_store.py 只更新 state.tools、不投影 role=tool 的缺口；tool/call 与 tool/result 现在按 call_id 回写同一条有序 assistant/tool 轮次。provider_runtime.py 在 OpenAI/Anthropic payload 边界再次校验 ID、邻接关系和一一对应，杜绝空 tool_use/tool_result ID。
  6. ResumeStream JSON 快路径同时写入 pendingMsg.tool_calls 与内部恢复字段，避免保存时只存在私有恢复字段；恢复挂接仅接受精确 msg_id/stream_id，不再凭历史 tool_call_id 猜测目标轮次。
  7. 移除 fix_tool_args 重试路径对“最后一个 assistant tool_calls”的豁免，所有重试都经过同一套最终邻接校验；补充多调用、重复 ID、runtime projection 和 Anthropic 转换回归覆盖。
- **验证**：前端工具配对、ResumeStream、后端 runtime projection/provider conversion 回归测试，Python 编译检查均通过。

### ♿ 配置面板关闭焦点无障碍修复 — 2026-08-16

- **问题现象**：关闭设置面板或工具详情附近的交互后，浏览器控制台提示 "Blocked aria-hidden on an element because its descendant retained focus"，焦点仍停留在设置面板内的 `saveConfigBtn`，但面板已经设置了 `aria-hidden="true"`。
- **修复内容**：`ui.js` 新增关闭前焦点转移逻辑；面板进入 `aria-hidden/inert` 隐藏态前，先将焦点交还给可见的设置触发按钮；没有合适触发按钮时安全执行 blur，避免辅助技术看到被隐藏的焦点元素。
- **影响范围**：配置面板关闭、移动端侧栏切换、`closeAllSidebars` 等共用的面板无障碍状态路径。

### 🖼️ 生图结果、蕾米状态与重复状态卡修复 — 2026-08-16

- **问题现象**：调用 `generate_image` 时同一轮同时出现工具状态行「正在生成图片」和 AI 绘图卡片；右侧/左侧蕾米悬浮窗仍停留在待机动画；生成接口返回后聊天气泡没有显示图片。
- **根因分析**：
  1. `tools-exec.js` 为生图工具额外挂载 `.search-status`，而绘图卡片本身已经提供完整的生成中状态，造成重复展示。
  2. `model-status.js` 只从 `activeBubble` 的助手头像同步状态；DSH 主题切换、头像隐藏/延迟渲染或工具先执行时，悬浮窗没有稳定的状态来源。
  3. 工具链将图片保存为 `{url, prompt, model, ...}` 元数据对象，但主流程完成阶段仍调用 `_imgData.startsWith`，对象触发异常，导致图片未插入完成后的气泡。
- **修复内容**：
  1. 生图/图生图不再生成重复的 `.search-status`，仅保留 AI 绘图卡片；工具开始、完成、失败分别驱动蕾米 `creating`、`done`、`stuck` 状态。
  2. 蕾米状态控制器改为优先同步当前最后一枚助手头像，并直接同步 `#remi-zoom-img` 与标题，不再依赖 `activeBubble` 或悬浮窗是否已经打开。
  3. 完成渲染统一通过 `getImageUrl`/元数据 `url` 提取图片地址，加入清理与加载失败重试；生成图片存在时完成态识别为 `done`。
  4. 用户头像隐藏规则收窄为仅隐藏 `.message-row.user .avatar`，不再误伤助手蕾米头像。
- **验证**：`node --check public/js/tools-exec.js`、`node --check public/js/model-status.js`、`node --check public/js/main.js` 全部通过。

### ⚡ 斜杠命令全链路可用性重构、/clear 彻底清空与队列防复活优化 — 2026-08-16

- **问题现象**：
  1. 使用 `/clear` 命令清理会话后，刷新页面（F5），已清理的会话内容全部恢复，无法持久化清空；
  2. 消息队列中排队或推入的消息，在清空后刷新页面又会重新出现并恢复；
  3. 搜索类斜杠命令（`/search`、`/news`、`/image`）输入后没有任何反应被静默吞掉，部分命令（如 `/compact`、`/retry`、`/stop` 等）存在参数不适配或 UI 气泡残留等问题。
- **根因分析**：
  1. **/clear 刷新后复活根因（前后端防御性合并缺陷）**：
     - **后端 `api/chat.php`**：在 `POST chat_id === 'all'` 时，旧逻辑含有武断规则：`if ($oldMsgs > $newMsgs || ($oldMsgs === $newMsgs && $serverIsNewer))`。当客户端执行 `/clear` 把消息重置为 1 条时，服务端认为消息变少是异常截断，直接用历史的 `$oldMsgList` 强制覆盖！
     - **前端 `public/js/storage.js`**：在 `_saveChatsToServerOnce` 和 `restoreUserData` 中同样存在无视更新时间戳、盲目判断 `_serverMsgs.length > _localMsgs.length` 的逻辑，导致向服务端发送前或从服务端拉取时，把服务器旧的长消息反向覆盖回本地。
  2. **消息队列刷新恢复根因**：
     - 队列持久化采用 `oc_queue_a_*`（Agent）与 `oc_queue_n_*`（普通模式）按模式分前缀存储。在 `/clear` 时，旧清理逻辑只移除了当前模式 key，未同步清除另一模式或所有历史遗留前缀的持久化 key，导致刷新后 `_loadQueue()` 再次恢复旧消息。
  3. **命令失效与缺陷根因**：
     - `commands.js` 的 `parseCommand` 将 `/search`、`/news`、`/image` 标记为 `type: 'command'`，而在 `main.js` 中被 `if (command.type === 'command') { handleSlashCommand(command); return; }` 拦截提前返回，而 `handleSlashCommand` 又无对应分支，导致搜索命令彻底失效；
     - `/compact` 在 `dialogs.js` 中强制依赖 `compressToggle` 开关，手动命令无法触发；
     - `/retry` 未执行 `loadChat()` 导致旧的 AI 回复 DOM 气泡停留在页面上；
     - `/stop` 未接入全链路 `window.stopGeneration()`；
     - `/mode` 与 `/model` 缺少无参数时的友好信息提示。
- **重构与优化方案**：
  1. **前后端权威版本与清空协议**：
     - `api/chat.php` 与 `storage.js` 全面引入**更新时间戳优先与清空标记协议**（`cleared: true` / `cleared_at` / `$newTs >= $oldTs`）。客户端显式清空或更新时，服务端与前端合并器权威信任客户端最新版本，绝不反向覆盖；
     - `/clear` 触发时赋予会话全新的 `cleared: true` 与最新毫秒级时间戳，并立即调用 `saveChats(true)` 强制写盘。
  2. **队列全链路排干与防复活**：
     - `_clearPersistedQueue(specificChatId)` 增强为全域清除：同时清除当前及历史所有 `oc_queue_*`、`sessionStorage`、`_rs_*` 流恢复缓存；
     - `/clear` 时同步执行 `window.stopGeneration()`、重置 `window._messageQueue = []`、`window._imageBatchQueue = []` 与 `isTypingMap`，彻底杜绝刷新幽灵消息。
  3. **斜杠命令全量重构与补齐**：
     - `parseCommand` 将搜索类命令标记为 `type: 'search'`，`main.js` 正确直通 `handleSearchFlow`，并对空关键词提供友好引导；
     - 重构升级全部 30+ 斜杠命令：
       - `/mode`：无参数显示当前模式与可选模式指南，有参数切换模式；
       - `/model`：无参数列出模型库，有参数智能模糊匹配并触发 `change` 事件同步 UI；
       - `/compact`：支持强制压缩（无需依赖自动压缩开关），完成后 Toast 提示；
       - `/retry`：重构前中止流、清空旧 AI 气泡并重绘会话；
       - `/stop` / `/abort`：接入 `window.stopGeneration()` 全链路取消并向引擎发送 DELETE；
       - `/copy`：升级双方案（Clipboard API + Textarea 降级）；
       - `/doctor`、`/context`、`/help`、`/mcp`、`/cost`、`/effort`、`/think`、`/queue` 等全面优化排版与错误捕获；
     - `ui.js` 的 `SLASH_COMMANDS` 补齐 `/clearsub`、`/agent` 等所有命令条目。
- **验证结果**：
  - Node.js 44 项命令单元测试（含全角斜杠、参数匹配、搜索流转等）100% PASS；
  - PHP 真实端点合并测试（包含 5 条消息清空后保持 1 条且不被旧数据覆盖）100% PASS；
  - `python3 tools/build-index.py --check` 资源标签与版本哈希全量同步。

### 🛠️ 引擎鉴权 401 根治、队列死锁与 /clear 失效修复、排版滚动条消除 — 2026-08-16

- **问题现象**：
  1. 打开页面或发送消息时，控制台报大量 401 Unauthorized (`Authentication required`)，`/engine/tasks/active` 和 `/engine/events` 频繁报错重连；
  2. 刷新后有残留消息队列，无法正常发送消息，输入 `/clear` 没有任何反应甚至被推入队列死锁；
  3. 用户气泡右侧紧挨着出现垂直滚动条，滚动条右侧出现大面积不正常的留白。
- **根因分析**：
  1. **引擎鉴权 401**：①前端 `resume-stream.js` 在调用 `_readSSE`（`/engine/chat/stream`）和 `_cancelStream` 时，fetch 配置中完全遗漏了 `Authorization` Header 和 `auth_token` / `user_id` query 参数；②PHP `api/auth.php` 的 `writeJson` 原子写入时显式调用了 `@chmod($path, 0600)`，以 `naujtrats` 运行的 Python 引擎无法读取属主为 `www-data` 的 `sessions.json`（抛出 `PermissionError`）；③SSE 连接 URL 未携带 `auth_token` 参数。
  2. **消息队列与 /clear 死锁**：`init.js` 的 `keydown` 监听器及 `queue.js` 的 `_smartSend` 在 `window._messageQueue.length > 0` 时无差别拦截所有按键和发送请求，直接执行 `pushToMsgQueue()`。即使用户输入 `/clear` 也被强制当作普通文本塞入队列尾部，永远无法到达 `handleSlashCommand`；且在 AI 空闲时冷启动未触发 `_drainQueue()`，形成死循环阻塞。
  3. **气泡滚动条与大面积留白**：DSH 皮肤下误将 `max-width: 900px; margin: 0 auto;` 施加在滚动视口容器 `#chatBox` 上（该容器带 `overflow-y: auto`），导致 `#chatBox` 本身变成 900px 居中窄盒，其垂直滚动条悬空绘制在气泡正右侧，右侧到窗口边缘产生数百像素的空洞；同时 `.message-row.user` 在 `row-reverse` 下使用 `justify-content: flex-end` 导致子元素对齐到左侧。
- **修复方案**：
  1. **鉴权与权限**：修复 `users/sessions.json` 权限为 `0660`，PHP `writeJson` 权限统一调整为 `0660`；在 `api/auth_helpers.php` 引入 `recordSessionToken()` / `revokeSessionToken()` 实现 SQLite 与 JSON 双写；`connectSSEChannel` URL 显式补齐 `&auth_token=`。
  2. **队列与命令直通**：`init.js` 回车统一转交 `_smartSend()`；`_smartSend()` 引入**斜杠命令最高优先级放行**（以 `/` 开头直接调用 `sendMessage()` 绝不入队）；AI 空闲时入队后立即触发 `_drainQueue()`；`clear_chat` 彻底重置所有队列状态、`isTypingMap` 及 local/sessionStorage 键。
  3. **排版与视口重构**：`#chatBox` 重置为 `width: 100% !important; max-width: 100% !important;` 保持视口满宽，滚动条贴附在主界面最右侧；将 `max-width: 920px; margin: 0 auto;` 约束唯一下沉至内部消息容器 `#chatMessagesContainer` 与 `#thinkingIndicator`；`.message-row.user` 调整为 `flex-direction: row-reverse; justify-content: flex-start` 实现真正的贴右自适应气泡布局。
- **验证结果**：
  - 模拟真实会话 token 请求 `/engine/tasks/active` 与 `/engine/events`，全部稳定返回 HTTP 200；
  - `python3 tools/build-index.py --check` 通过，版本哈希全量同步。

### 📬 消息队列与推入/插话（Steer）机制对齐 DSH 重构 — 2026-08-15

- **问题根因**：原队列栏按钮直接绑定 `injectUserMessage()`，在用户已排队但输入框为空时点击直接被 `if (!text) return` 拦截，没有任何反馈；且无法从队列条目直接定向发起插话或立刻发送。
- **重构方案**：
  - **智能主按钮**：输入框有字时为 `⇥ 存入队列`，输入框为空时自动变为 `▶ 立即发送`（空闲时）或 `⚡ 立即插话`（生成中），点击自动将首条推入执行。
  - **条目级定向控制**：每个队列条目提供 `⚡ 插话` / `▶ 发送` 与 `✕ 移除` 操作，支持像 DSH / Claude Code 一样对正在生成的对话随时进行 Steer 插话注入。
  - **AI 绘图卡片重构**：废弃原生硬的大面积纯紫方块，全面重构为现代 `.ai-image-generating-card` 磨砂玻璃流光卡片，带光晕脉冲与彩虹流光进度条。
- **测试与验证**：构建与全量测试套件通过。

### 🎨 主题/皮肤系统上线与 DSH 现代智能体工作台排版落地 — 2026-08-15

- **主题/皮肤模块系统**：
  - 新增 `data-chat-theme` 全局主题架构，在设置面板（显示设置）提供自由切换能力，支持 `dsh`（DSH 智能体工作台，默认）、`classic`（经典气泡对话）、`minimal`（现代极简无界）。
  - 支持即时热切换与 `localStorage` 持久化，启动时自动恢复用户喜爱的主题。
- **DSH 现代工作台排版特性**：
  - **取消输出气泡背景**：助手消息采用现代无边界自然流式排版（`background: transparent`），彻底消除笨重的圆角背景卡片，阅读体验对齐 DeepSeek Harness / Claude Code / Cursor / Windsurf 等主流 Agent 界面。
  - **DSH 风格工具调用时间线**：工具调用以 `# ToolName · Arguments` 精致状态条呈现，带有运行中旋转动画、完成绿标、失败红标以及参数/输出的独立折叠查看块。
  - **Think · 思维链美化**：思维链采用左侧紫色微光竖线与紧凑 `Think ·` 导轨展示，兼顾直观性与高密度阅读。
  - **用户消息胶囊化**：用户提问采用右对齐轻量高对比胶囊卡片，主次分明。
- **构建与测试**：全量 107 个 Python 单元测试与 8 组 JS 测试套件通过，`tools/build-index.py` 重建完成。

### 🧠 多方言思维链（reasoning/thinking）流式提取补齐 — 2026-08-15

- **根因分析**：在 OpenAI-compatible 多家代理中，思维链字段除了标准的 `reasoning_content` 外，还存在 `reasoning`、`reasoning_text`、`thinking` 以及 pydantic 的 `model_extra` 字典。原 `engine_server.py` 与 `stream-handler.js` 仅判断了 `delta.reasoning_content`，导致第三方中继返回的非标准思考流被遗漏。
- **修复方案**：
  - `python/engine_server.py` 补充 `getattr(delta, 'reasoning')`、`getattr(delta, 'reasoning_text')`、`getattr(delta, 'thinking')` 以及 `delta.model_extra` 的回退提取。
  - `public/js/stream-handler.js` 补充 `_rawReasoning = delta.reasoning_content || delta.reasoning || delta.reasoning_text || delta.thinking` 及其 `model_extra` 提取，确保「思考中...」面板正常展示。
- **测试与验证**：编写多方言 delta 单元测试并通过，热重启 `oneapichat-engine`。

### ☁️ 用户菜单 DSH 伴随入口修正为 CloudCLI — 2026-08-15

- **菜单修正**：在 `public/index.html` 根用户（Root）下拉菜单中，将原 DSH 旁指向 `https://cloudreve.naujtrats.xyz` 的入口修正为指向 `/oneapichat/developer.html` 的 **CloudCLI**，并替换为终端图标。
- **路由与软链补齐**：在项目根目录补齐 `developer.html -> public/developer.html` 符号链接，确保与 `chaoxing.html`、`profile.html` 结构一致；静态资源已通过 `python3 tools/build-index.py` 重建更新。

### 🤖 自定义/中继 OpenAI 格式下的 Claude 模型报错修复 — 2026-08-15

- **问题现象**：用户在自定义提供商中使用 CLIProxyAPI（`https://gpt.naujtrats.xyz/v1`）选择 Claude 模型时，引擎报错 `[RS] stream error: {code: 'BAD_REQUEST', message: 'provider requires Anthropic wire format', retryable: false}`，请求直接失败。
- **根因分析**：`python/engine/provider_runtime.py` 中的 `detect_provider()` 函数将以 `claude` 开头的所有模型名称硬编码强制推断为 `family = "anthropic"`；而 `prepare_openai_request()` 执行了严格校验 `provider.family == "openai-compatible"`，导致经过 OpenAI 兼容代理（CLIProxyAPI、OneAPI 等）调用的 Claude 模型被直接抛出 400 异常拦截。
- **修复方案**：
  - 只有当 `anthropic_format=True` 或请求目标 host 严格为 `api.anthropic.com` 时，才启用原生 Anthropic Messages API 协议。
  - 自定义提供商或第三方代理上的 Claude 模型被归类为 `claude-openai-compat`（`openai-compatible` 协议族），使用标准 `/v1/chat/completions` 流式协议传输。
  - `prepare_openai_request()` 即使接收到其他协议族配置，也会安全自适应为 OpenAI 兼容格式而不再阻断请求。
- **验证**：添加 `test_claude_model_on_openai_proxy_uses_openai_format` 单元测试，经 `oneapichat-engine` 实测请求 `claude-3-7-sonnet` 返回 200 流且无错误。

### 🔒 会话令牌与工具敏感参数请求头迁移 — 2026-08-15

- **隐私与安全对齐**：全面审计前端与后端 API 的会话认证传输。将原本写在 URL 查询参数中的 `auth_token`、`token`、超星账号密码、网盘链接及提取码、高德 Web 服务 Key 及地理位置参数彻底移出 URL，避免泄露至服务器访问日志、CDN 日志及浏览器历史记录。
- **共享提取与兼容**：
  - `api/auth_helpers.php` 新增 `extractSessionToken()`，优先读取 `Authorization: Bearer` 请求头与同站 Cookie，同时保留旧 query/POST 参数作为回退，保障跨版本平滑升级。
  - `api/chaoxing_api.php`、`api/netdisk_api.php`、`api/amap_api.php`、`api/memory_api.php`、`api/auth.php` 统一接入该共享提取器，并补齐 CORS `Authorization` 允许头。
  - `api/amap_api.php` 的高德 Web 服务 Key 现通过 `X-Amap-Key` 请求头传输，个人地图与路线规划参数统一使用 POST 请求体。
- **前端工具模块改造**：
  - `core.js` 新增 `getSessionAuthHeaders()` 统一辅助函数。
  - `chaoxing-tools.js` 将登录凭据改用 POST Body 传输，各状态与列表轮询统一挂载 Bearer 请求头。
  - `netdisk.js` 解析与下载参数全部封装为 POST Body。
  - `amap.js` 地理编码、路线规划、POI 搜索等 11 个接口全部转为 POST 请求体 + `X-Amap-Key` 请求头。
  - `commands.js`、`agent.js`、`init.js` 的记忆保存/读取与启动验证全部移除 URL query token。
- **测试与验证**：
  - 新增 `tests/session_auth_transport.test.js` 自动化回归套件，覆盖全部迁移模块与 PHP 提取器优先级。
  - 生产环境真实 Bearer 认证实测：超星未授权 401、已授权 200 JSON；网盘配置 200 JSON；高德配置 200 JSON；身份验证 200 JSON；云端记忆 200 JSON。全部通过。

### 🧯 Gemini 3.7 长时间生成卡死与取消后继续请求根治 — 2026-08-15

- **现场证据**：CLIProxyAPI 上游请求最终均为 HTTP 200，但 OneAPIChat 对应流快照为 `finished=true`、正文/工具/错误均空、事件数 0。Nginx access log 同时确认 Electron 客户端已对该 `stream_id` 发出两次 `DELETE`；随后 CLIProxyAPI 仍出现新的 Gemini 请求，说明取消没有阻断后续提供商重试。
- **根因一（重试乘法）**：Python OpenAI SDK 默认内建 2 次重试，外层 `_iter_provider_chunks` 又有 5 次预算，一个逻辑请求理论上可膨胀到 15 次。现在 resumable 客户端显式 `max_retries=0`，重试权只属于统一外层，实际最多 5 次。
- **根因二（取消不终止重试）**：原循环只在收到 provider chunk 时检查 `_is_cancelled`；连接异常后的下一次 attempt 与退避 sleep 都不检查取消。因此用户点停止后，已排队的重试仍继续调用上游。现在每次 attempt 前、每个 chunk 前、捕获异常后及退避期间都检查取消。
- **根因三（无终态导致永久加载）**：取消分支只将磁盘快照标成 finished，不发送/持久化 `done` 或 `error`；刷新续接只能看到“已结束但无事件”的空状态，气泡保持生成中。新增 `_finalize_cancelled_stream`，DELETE 立即写入并广播结构化 `CANCELLED` 终态，且幂等只记录一次。
- **禁止计费重放**：引擎对“provider 正常结束但无正文、思考、工具调用”返回 typed `EMPTY_RESPONSE`；前端把 reasoning-only 视作有效结果，并将 completed+empty 直接终止，不再回退 HTTP 重放同一笔已计费请求。
- **真实验证**：使用 `gemini-3.7-flash-high` 经自定义 CLIProxyAPI→OneAPIChat RS 发起强制工具调用，SSE 返回 `snapshot` 后 `done`，终态含 1 个 tool call、无错误；本地受控慢流在 DELETE 后只收到 1 次上游请求，续接快照包含 `CANCELLED`。新增 Python/JS 回归并重建公共前端资源。

### 🔑 CLIProxyAPI 模型 404、Gemini 空输出与续接双加载条修复 — 2026-08-15

- 根因确认：两台公网边缘 Nginx 只有 `location ^~ /v1/models/`，缺少精确 `location = /v1/models`。因此 OpenAI-compatible 模型列表请求先被自动 301 到尾斜杠路径，再被 Gemini SDK 兼容规则误改写成 `/v1beta/models/`，最终由 CLIProxyAPI 返回 404。两台边缘均已补精确代理、备份配置、通过 `nginx -t` 并 reload；逐节点和 OneAPIChat `proxy.php` 端到端实测均为 200 JSON。
- 自定义提供商配置现在保持权威：Gemini 模型名可能是 CLIProxyAPI 的 Antigravity alias，`main.js` 不再根据模型名静默切换到 Google 官方端点。此前加入的自动官方路由已撤回。
- CLIProxyAPI 全局 `oauth-model-alias.antigravity` 增加 `gemini-3.5-flash → gemini-3.5-flash-low` 和 `gemini-3.6-flash → gemini-3.6-flash-high`（保留原模型）；当前模型为 `gemini-3.7-flash-high`。旧别名、3.7 原名、原始 SSE 与 OneAPIChat RS 均实测 200 且产生正文。
- `API key not valid`、`invalid_api_key`、authentication/unauthorized/permission denied 仍被归为终止 provider 错误；这类失败不再误走“安全过滤”HTTP 重放，避免重复请求和空回答。
- 刷新续接的双三点来自两个同时存在的实现：`appendMessage(partial)` 插入 `.msg-loading-indicator` DOM，同时 ResumeStream 又恢复 `.typing` 伪元素。现统一只使用幂等 `.typing` class，首个正文块由既有 `applyStreamRender` 清除，因此只显示一组加载点。
- 新增源码回归断言，覆盖 custom Gemini 路由、认证错误不回退和 partial 只使用单一加载指示器。

### 🌐 关闭网页代理后的跨域与 RAG 错误修复 — 2026-08-15

- 修正 `config.js` 的网页代理语义：关闭代理只表示不使用用户配置的出站代理，并不允许浏览器跨域直连提供商。所有跨 origin 的模型/API 请求现在仍走同源 `proxy.php` relay；只有同源 URL 才允许直接 `fetch`，因此不再受上游重复或缺失 CORS header 影响。
- `rag-system.js` 不再对 500/空响应直接调用 `response.json()`；统一先读取文本、检查 HTTP 状态并生成可理解的错误，避免 `Unexpected end of JSON input`。
- `rag_proxy.php` 的 GET 上游失败改为结构化 `502 RAG_UPSTREAM_UNAVAILABLE`，并抑制 PHP 网络 warning 污染 JSON。实测签名 bridge 与 header-authenticated PHP RAG 请求均返回 200 JSON。
- 重新构建资源版本并验证 JS/PHP 语法、公共页面资源版本和 `/engine/health`。

### 🛡️ DSH 式 Agent 运行时、用户隔离与可恢复流加固 — 2026-08-15

**目标**：将原有以进程内状态为主的 Agent 链路升级为可审计、可恢复且与用户身份强绑定的运行时；同时保持既有聊天、工具、提供商与前端功能兼容。

**运行时与可靠性**：
- 新增 `python/engine/runtime_store.py`、`runtime_api.py`、`goal_runner.py`、`stream_retention.py`：SQLite 追加事件、会话投影/水位、任务、目标和可续子代理均可在进程重启后修复或继续；目标轮次以 CAS 领取并记录 `goal-round` 任务。
- 引入稳定 `AgentRuntimeError`/`ErrorCode`、递归密钥脱敏和工具执行管线；工具参数先校验/审批/执行，持久化遥测仅保存脱敏副本，工具遥测失败不会反向破坏工具执行。
- OpenAI/Anthropic 与自定义提供商的请求归一化支持现代字段；启动前无用户可见输出时可安全重试，统一最大尝试次数为 **5**，不重放已展示文本、工具调用或计费工作。
- 前端 `ResumeStream` 状态窗口从 10 分钟调整为与引擎 30 分钟保留窗口一致；保留完整正文、推理、工具状态和 `task_id`/runtime IDs，HTTP 401/403 立即终结而非重连风暴，创建请求只转发安全的提供商扩展字段。`chat_create` 的 30 秒 ACK 超时现在独立于直连提供商的 `requestTimeout`：引擎已接收的长程任务继续持久化并可恢复，不会被浏览器的直连请求超时误取消。

**身份、隔离与网络边界**：
- `runtime_auth.py` 使用共享会话验证并把 `user_id` 绑定到 HTTP/SSE/WebSocket scope；跨用户 query/path 选择器立即拒绝。PHP→引擎的 loopback 调用还必须附带私有桥接凭证，且不得携带反向代理头，取消了“只要 localhost 即可信”的错误边界。
- 用户 ID 加入严格白名单，阻止其流入文件名/SQLite namespace 时形成路径穿越；登录会话中异常 ID 被视为无效身份。
- SRC 为共享进程资源但有单 owner 守卫，并校验 config/module 名；浏览器自动化为每个已认证用户创建独立 incognito context，禁止私网/保留地址。`/engine/browser/navigate` 现在在连接 Chromium/CDP 前就拒绝危险 URL，避免无效连接和 SSRF 等待。
- Nginx `/engine/` 支持 WebSocket upgrade；引擎仅监听 `127.0.0.1:8766`。实测直接、本地公共路径与两台公网边缘均能完成受控 WebSocket ping，跨用户连接遭拒。
- `api/chat.php` 不再允许认证会话借由 `user_id` query 选择其他 namespace；不匹配即 `403`。主聊天、Agent/通知、RAG、Cloudreve 与上传路径已迁到 `Authorization` 或同站 Cookie，避免把可复用会话凭据写进 URL、反向代理请求行或浏览历史；旧端点仅保留最小的兼容 fallback。
- Cloudreve 自动导入废除公开 `cr_shared` 旁路：现在只有携带私有 bridge 凭证、来自 loopback 且无转发头的引擎调用可导入服务器生成文件；同一 helper 的 PHP-FPM 读取权限已修复。RAG 代理会剥离遗留 auth query，绝不转发到引擎。

**前端与运维改进**：
- `agent.js` 的通用 engine API helper、聊天同步、RAG、Cloudreve、上传与主动任务通知均改用 `Authorization: Bearer`（unload beacon 使用同站 Cookie），不再把 token 拼入该类 URL；遗留服务端 fallback 仅用于已部署旧客户端的短期兼容。
- 移除引擎对自身 HTTPS 的伪会话/`verify=False` 请求，直接读取已绑定用户的本地配置；若 `baseUrlProvider` 滞后于已知端点，按端点纠正已知提供商选择。
- 引擎日志不再输出模型消息、工具结果、搜索结果或原始异常文本，只保留必要的类型/长度/状态元数据；已清除历史引擎日志中遗留的用户内容。

**验证与部署**：
- `PYTHONPATH=python python3 -m unittest discover -v -s tests -p 'test_agent_runtime.py'`：30 项通过（认证边界、用户 ID、目标/子代理、流压缩、浏览器 SSRF、RAG/SRC 隔离、工具管线和 5 次重试）。
- 全部 `tests/*.test.js`、`PYTHONPATH=python python3 -m unittest discover -v -s python/tests -p 'test_*.py'`、30 项 runtime tests、修改文件语法检查和 `python3 tools/build-index.py --check` 均通过。
- `sudo -n /usr/sbin/nginx -t` 通过（仅保留既有配置 warning）。PM2 已重启 `oneapichat-engine`，`/engine/health` 返回 `ok`；实测跨用户 SRC 请求、跨用户聊天 namespace 和私网浏览导航均返回 `403`；header/cookie chat auth、签名 Cloudreve import bridge 与 RAG header proxy 均返回成功响应。

### 🧠 Gemini 思考部分不显示修复 (reasoning_effort 触发思考文本) — 2026-08-14

**用户反馈**: 使用 Gemini 模型（`gemini-3.7-flash-high`）时看不到深度思考（推理面板），只有最终回答。

**实测结论**（用用户 OAuth key 对 gpt.naujtrats.xyz cloudcode 中继做 A/B 实测）:
- `thinking_level`（top-level 或 extra_body 两种写法）只调整思考预算（reasoning_tokens 106→126→186），**从不回传思考文本**（reasoning_content 恒为 null）；
- `include_thoughts` / `includeThoughts`（top-level 或 extra_body）**无效**；
- **`reasoning_effort` 是唯一触发思考文本回传的参数** — 中继将其映射为 Gemini thinkingConfig + includeThoughts，流式与非流式下 reasoning_content 均返回思考全文（大问题流式实测 2421~4545 字符）；
- 工具调用与思考共存正常（106 工具场景不受影响）；`thinking_level` 与 `reasoning_effort` 同时发送不冲突且思考预算更足。

**根因**: 双向链路都查过，响应侧无问题（引擎 3277/3895 行解析上游 `reasoning_content` 并以 `type:reasoning` SSE 事件回传，前端 stream-handler 正常渲染推理面板）。问题在**请求侧**：
1. **引擎丢参** — 客户端 `models.js getThinkingIntensityParams` 为 Gemini 生成 `{extra_body:{thinking_level}}`，但引擎三处 OpenAI 格式上游调用（非resumable 2450 / resumable 3230 / agent 3889）都只转发白名单字段，`extra_body` 被静默丢弃 → 中继从未收到 `thinking_level` → Gemini 按默认思考但（无 includeThoughts）思考文本不回传；
2. **单点传递** — 原实现只走 `extra_body`，对直接读取 top-level 参数的中继不生效。

**修复**:
1. `models.js` — Gemini 分支按思考强度同时发 **top-level `reasoning_effort`**（实测唯一触发思考文本回传的参数）+ **top-level `thinking_level`**（原生思考预算）+ **`extra_body{thinking_level, include_thoughts, includeThoughts}`**（兼容其他中继）；off 级别三键均删除；
2. `engine_server.py` — 三处 OpenAI 调用点（非resumable 2450 / resumable 3230 / agent 3889）统一转发客户端 `extra_body`（跳过含 `thinking` key 的 LongCat/MiniMax 风格 body 避免误伤）+ `reasoning_effort` + `thinking_level`（顺带修复 DeepSeek/OpenAI effort 在 RS 路径被丢的隐患）；
3. ★**RS 链路补齐（最终断点）** — 实测确认后再次排查发现：默认走引擎可恢复流（RS）时，`main.js:2442` 调 `ResumeStream.create` 的 config 与 `resume-stream.js:1172` 组 `engine_api.php?action=chat_create` 请求体时都只传白名单字段，`reasoning_effort`/`thinking_level`/`extra_body` 从未发到引擎 → 引擎无从转发（此前 1/2 步的引擎转发补丁正确但收不到参数）。修复：main.js 向 create 传入 `reasoningEffort/thinkingLevel/extraBody`，resume-stream.js 写入 chat_create 请求体；engine_api.php 为原样透传无需改；
4. `tools/build-index.py` 重建版本号，PM2 重启引擎。

**验证**: 已用用户 key 实测通过 — 流式请求带 `reasoning_effort:high` + 工具时，delta 稳定回传 `reasoning_content`（大问题 2800~4545 字符），引擎 3277/3895 行转发为 `type:reasoning` SSE，前端推理面板正常渲染。**排查手段**：浏览器 F12 → Network → 过滤 `chat_create` → 检查请求体是否含 `reasoning_effort`/`thinking_level`（修复后应存在）；缺失即走的是未带参的旧链路。

### 🤖 Gemini 模型不兼容修复 (空 enum 值) — 2026-08-14

**用户反馈**: 选择 Gemini 模型（如 `gemini-3.7-flash-high`）发送消息报 400，one-api 后台错误: `GenerateContentRequest.tools[0].function_declarations[98].parameters.properties[adjust].enum[2]: cannot be empty`（同样错误出现在 function_declarations[104]），对话完全无法进行。

**根因**: 前端工具定义 `public/js/tools.js` 中 `stock_kline`（第 98 个工具）与 `stock_chart`（第 104 个工具）的 `adjust` 参数 enum 为 `["qfq", "hfq", ""]` — 包含空字符串元素。OpenAI 格式宽松接受空 enum 值，但 Google Gemini 的 FunctionDeclaration schema 校验**禁止 enum 项为空字符串**，中继层（one-api）转换函数声明后原样抛 400。

**修复**:
1. `public/js/tools.js` — 两处 `adjust` enum 去掉 `""`，改用非空令牌 `"none"` 表示"不复权"，description 同步更新（不传则默认 qfq 前复权）；工具顶层 description 中 `/空(不复权)` 改为 `/none(不复权)`
2. `python/engine/stock_data.py` — 两处 adjust→fqt 映射表补充 `"none": ""` / `"none": "0"`（并兼容 `"raw"`），保持"不复权"能力不丢失
3. 全库扫描确认无其他工具存在空 enum 项；`node --check` / `py_compile` 通过；`tools/build-index.py` 重建 `?v=` 版本号

**验证建议**: 刷新页面后重新发送消息，观察请求 `tools` 中两个股票工具的 `adjust.enum` 已为 `["qfq","hfq","none"]`，Gemini 应正常返回。

### 🔧 本地模型上下文过长 400 错误智能修复 (v1+v2) — 2026-08-12

**用户反馈**: 连接本地模型（如 `localmodels.naujtrats.xyz` 上的 Qwen GGUF 量化模型）发消息报 HTTP 400，控制台反复输出 `[400-Retry] generic_retry` / `[400-Retry] trim_context` 和 `[400-Detail] request (17983 tokens) exceeds the available context size (8192 tokens)`，无法正常对话。

**根因 1 — 检测缺失**: 本地模型返回的错误信息 `"request (17983 tokens) exceeds the available context size (8192 tokens), try increasing it"` 不匹配现有任何 context_length_exceeded 检测模式：
- `_errType === 'context_length_exceeded'` — 本地模型不返回结构化 error.type
- `"too long" && "context"` — 错误信息中没有 "too long"
- `"maximum context length"` — 错误信息中没有该短语

因此落入 `generic_retry` 分支，原样重试 → 无限循环 400。

**根因 2 — 裁剪不够（v1 修复后仍无效）**: 日志显示 `msgs: 2` — 只有 2 条消息但 17983 tokens。说明 **系统提示词 + 106 个工具定义本身就占了 ~16000 tokens**（远超 8192 限制）。v1 的 `trim_context` 只裁剪消息历史（2 条→1 条），对总 token 数几乎无影响，重试仍然 400。

**修复**:
1. **检测模式扩展**（main.js:3995）— 新增 5 种正则匹配覆盖本地模型 / Ollama / vLLM / LM Studio 等常见报错格式：
   - `exceeds?\s+(the\s+)?(available\s+)?context\s+(size|length|limit)` — 匹配 "exceeds the available context size"
   - `context\s+(size|length|limit)\s+exceeded` — 匹配 "context size exceeded"
   - `(token|request)\s+\(\d+\s+tokens?\)\s+exceeds?` — 匹配 "request (17983 tokens) exceeds"
   - `prompt\s+is\s+too\s+(long|large)` — 匹配 "prompt is too long"
   - `input\s+too\s+long` — 匹配 "input too long"
2. **智能裁剪比例**（main.js:4047）— 从错误信息提取 token 数和上下文限制值，按超限比例决定保留消息比例：
   - 超限 >2 倍 → 只保留 20% 消息
   - 超限 >1.5 倍 → 保留 30%
   - 超限 >1.2 倍 → 保留 40%
   - 其他 → 保留 50%（原固定值）
3. **★ v2 新增：系统提示词+工具裁剪**（main.js:4069）— 当消息很少（≤2条）或系统提示词预估占用超过限制 60% 时：
   - 阶段1：截断系统提示词至前 1500 字符（保留核心指令）
   - 阶段2：如果系统提示词占用超过 100% 限制且工具数 >10，减少工具数量至 30%（至少保留 10 个）
   - 这解决了"消息少但系统提示词+工具定义本身就超限"的场景
4. **max_tokens 联动降低**（main.js:4088）— 裁剪消息的同时按上下文限制值计算安全输出空间（限制值 × 30%，至少 512），为模型输出预留 token 空间。

**验证**: 正则测试确认 5 种格式全部匹配；token 提取+裁剪比例计算正确（17983/8192=2.2x → 保留 20%，max_tokens 降至 2458）；系统提示词裁剪逻辑（2条消息场景触发）；`python3 tools/build-index.py` 重建；涉及 main.js + index.html `?v=` bump

### 🎯 超星 `rt_d` 心跳映射纠正 — 2026-08-11

继续监控声乐 `4.1 声乐演唱基础知识` 时发现，9 个资源正常的 33 秒视频每轮都能获得 HTTP 200，但到末尾统一返回 `isPassed=false`，服务端 `playTime` 仍为 0。任务卡 `otherinfo` 均包含 `rt_d`，旧代码却将它映射成进度接口参数 `rt=0.9`。

对同一个“趣味练声曲1”做受控对照：旧参数 `rt=0.9` 返回 `{isPassed:false}`；不改变账号、任务和其他参数，仅改为 `rt=1` 后立即返回 `{isPassed:true}`。据此将 `rt_d` 修正为默认播放模式 `rt=1`，没有显式模式的任务也优先尝试 `1`。考虑到同一课程其他短视频仍存在服务端不落进度的独立问题，末尾若首选模式未通过会再尝试备用 `rt=0.9`；播放过程中的正常 `isPassed=false` 不重复请求。该对照进一步证明卡住并非人脸校验；`ff_1/videoFaceCaptureEnc` 仍不得单独作为人脸要求的判断依据。

### ⛔ 超星永久资源失败停止空转 — 2026-08-11

受控实跑声乐课程发现，部分章节的对象状态接口连续返回缺少 `status=success` 的 `unknown` 元数据，另有 WMA/MP3 任务在尝试任务卡允许的全部 `rt` 组合后稳定返回 HTTP 403。旧逻辑把这两类明确的服务端资源/权限失败当成可恢复错误，导致同一批无效任务按 5–30 秒退避完整空转 8 轮。

现在只要对象状态接口成功响应但资源状态不是 `success`（包括 `failed`、`transfer`、`unknown`），或进度接口穷尽 `rt` 组合仍拒绝请求，就记录任务名、资源状态/HTTP 状态和原因，立即将章节标记为 `blocked` 并继续后续章节；不会伪造完成，也不再浪费 8 轮重试。8 轮重试仍保留给正常资源但服务端任务卡暂未清空、以及任务卡读取暂时失败等可能恢复的情况。

### 🗃️ 超星题库缓存路径与权限修复 — 2026-08-11

受控复跑到大学物理 `9.7 本章测试题` 时，题库 `CacheDAO` 用当前工作目录拼接 `cache.json`，任务从项目根目录启动便尝试写 `/var/www/html/oneapichat/cache.json`；该文件属于部署用户，`www-data` 以 `r+` 打开时报 `PermissionError`，导致整个刷课进程退出，尚未进入“作业已过期”的阻塞处理。

题库缓存现固定写入可写运行目录 `/tmp/AutomaticCB/cache_<user>.json`，账号标识经过安全清洗后隔离；空文件或损坏 JSON 自动按空缓存恢复，覆盖写入后显式截断和刷新。缓存自身不可写时只警告并继续联网查题，不再让辅助缓存故障中断课程。

### 🚧 超星异常任务阻塞续刷 + 人脸误判纠正 — 2026-08-11

**问题**：真实监控发现 `16.5 电击伤` 的服务端进度连续 8 轮固定在 85/108 秒，任务卡包含 `ff_1` 与 `videoFaceCaptureEnc`。最初据此推断为人脸校验，但用户在官方页面手动播放时没有出现人脸验证且成功完成；随后只读复查任务卡返回 `remaining=0`，证明这两个字段属于不足以判定人脸要求的通用元数据。另有已过期作业、资源状态 `failed` 和长期 `transfer` 的任务，不会因增加重试次数而完成。旧流程会因此暂停整门课程，后续正常章节无法继续。

**修复**：撤销基于 `ff_1/videoFaceCaptureEnc` 的人脸推断，单纯“上报到末尾但未确认”仍作为可重试状态。首次尝试可从任务卡 `playTime` 快速续播；若服务端未确认，下一轮自动从 0 秒重建完整观看会话，并优先采用任务卡 `reportTimeInterval`（当前为 60 秒）发送心跳，避免每轮都从同一个残留位置重复失败。`isPassed=true` 按服务端累计观看达标信号接受，但完成状态只在重新读取任务卡确认为空后落库。明确过期、资源损坏/长期转码的任务会立即标记 `blocked`；普通未确认或任务卡解析失败最多重试 8 次，耗尽后同样持久标记 `blocked` 并继续同课程下一章节。任何阻塞任务都不伪造为完成。

**诊断结果**：`电击伤` 已由用户手动正常完成，排除“必需人脸验证”。复跑时 20.3 从 164/208 秒续播后正常完成，而 20.5 每轮都从固定的 74/84 秒开始、仅建立 10 秒会话后失败，定位到“失败后仍反复使用残留进度”的重试缺陷。其余已确认状态为：`本章测试题` 已过期、两个同源视频资源返回 `failed`、微分视频长期处于 `transfer`。

### 🔁 超星章节复核重试 3→8 — 2026-08-11

任务卡解析失败和服务端仍有未完成任务两条分支的章节级重试上限统一从 3 次提高到 8 次；等待时间按 5、10、15、20、25、30、30、30 秒递增并封顶 30 秒。重试期间始终停留在当前章节，只有服务端确认任务清空才进入下一章；8 次后仍失败才暂停当前课程，避免无限循环。

### 🔌 MCP 双 ECS 入口一致性 + 超星任务完成可靠性修复 — 2026-08-11

**问题**：`naujtrats.xyz` 同时解析到两台 ECS。ECS1 会把 `/oneapichat/api/v1/mcp` 正确转到主服务，ECS2 的 `^~ /oneapichat/` 却把无扩展名 URL 当静态文件返回 404；临时接到 ECS2 本地 `mcp.php` 后又因灾备代码过旧只返回 `analyze_image` 1 个工具，而主服务返回 153 个，导致配置栏测试随 DNS 轮询忽成忽败。前端“全部测试”还把内部已捕获的失败一律计为成功，页面自动重连和手动测试也可能相互覆盖。

超星方面，任务卡已返回 `videoFaceCaptureEnc`、`attDuration`、`attDurationEnc` 和已有 `playTime`，旧代码没有把前三项随进度心跳提交、每轮又从 0 秒重播。以“05电击.mp4”为例，本地上报到 108 秒后服务端实际只保留 85 秒；该任务同时明确 `doublespeed=0`，但配置仍以 2 倍速推进。另有部分父章节返回 `mArg = ""` 与“暂无内容”，旧解析器把合法空卡误判为网络/解析失败并暂停课程。

**修复**：
1. ECS2 Nginx 为 MCP 无扩展名及尾斜杠入口增加精确规则，并统一反代到主服务源，不再加载 ECS2 的单工具灾备副本；配置已备份到 `/etc/nginx/config-backups/`，`nginx -t` 通过后平滑 reload。
2. `testMcpServer()` 改为返回真实布尔结果、显示后端错误正文，只允许同一服务器最后发起的测试落库；自动重连复用同一逻辑且静默执行，“全部测试”按返回值统计，不再出现失败也计成功。
3. 超星视频解析并上报 `videoFaceCaptureEnc`、`attDuration`、`attDurationEnc`、`rt`；从任务卡已有 `playTime` 续播，避免失败后整段重来；任务声明不允许倍速时自动按 1 倍真实时间推进。
4. `decode_course_card()` 将明确的空 `mArg` + “暂无内容”识别为成功空卡，`get_job_list()` 在首张空卡时完成章节、在有效卡后的空页只作为列表结束，不覆盖已有任务元数据。

**验证**：两台 ECS 分别定向执行 `tools/list` 各 6 次，全部 HTTP 200 且均返回 153 个工具；经公网 `mcp_client.php` 完整执行 `initialize + tools/list` 6 次，全部成功且工具数一致。真实只读任务卡验证“圆周运动”空章节为 `fetch_ok=true/empty_card=true`，电击伤任务成功解析服务端 85 秒进度及三个校验字段。Python 单测 6/6、Python AST、JS 语法、PHP lint、索引构建检查均通过。

### 🔄 主账号资料与 Cloudreve 同账号联动 — 2026-08-11

**问题**：OneAPIChat 的资料页只修改主项目 `users.json`；改用户名、绑定/更换邮箱、修改密码和找回密码重置后，Cloudreve 仍保留旧昵称/邮箱/密码。主账号再次登录还会用空值覆盖缓存中的 Cloudreve `user_id`，增加账号映射丢失和误建第二个云盘账号的风险。

**修复**：
1. 新增统一的 `cr_syncVerifiedMainProfile()`：按用户专属缓存旧邮箱、主项目旧邮箱、桥接邮箱定位已绑定 Cloudreve 行，在单个 SQLite 事务中原地更新昵称、邮箱和 Cloudreve v4.18 密码哈希；数值用户 ID、用户组、容量和文件归属完全不变。
2. `update_profile`、`bind_email`、`unbind_email`、`reset_password` 全部接入联动；Cloudreve 邮箱非空约束下，主项目解绑邮箱会明确提示云盘保留原邮箱。重复邮箱在写入前拒绝，不会覆盖另一云盘账号。
3. 主项目登录改为先用旧缓存修复未完成同步，再刷新新凭据；凭据缓存改为原子合并写入并保留既有 Cloudreve `user_id`，不再每次登录清空映射。
4. 只有邮箱或密码变化才失效对应 token，单纯修改昵称不触发无意义的云盘重新登录；资料页显示真实联动结果，部分失败不会再提示“全部成功”。

**验证**：隔离临时 Cloudreve 数据库验证昵称/邮箱/密码可同时同步、密码哈希可验证、Cloudreve ID 保持不变、缓存映射保留、重复邮箱拒绝且原账号不被修改；Cloudreve 同步测试 18/18 通过，PHP 语法与 diff 检查通过。线上只读探测确认当前主账号仍映射 `wgCZ`，Cloudreve 探活与资料页均返回 200。

### 🧭 刷课复核失败仍跳章 + Cloudreve 失效入口修复 — 2026-08-11

**问题**：视频上报接口会在真实进度未到末尾时提前返回 `isPassed=true`，程序因此在 39% 等中途位置记录“任务完成”；任务卡复核仍为未完成后，主循环虽然打印“章节保持进行中”，却无条件递增章节索引并跳到下一章。Cloudreve 一次性入口超过 90 秒后又跳到前端不存在的状态路由，表现为“页面不存在”。

**修复**：
1. `study_video()` 仅在播放进度已连续上报到视频末尾时接受 `isPassed=true`；早到的通过信号只记录一次警告并继续上报，末尾仍未确认则返回失败且不增加本地完成计数。
2. 章节服务端复核失败后保持原索引，按 5/10/15 秒退避重试当前章节；连续 3 次仍未通过则暂停该课程并保留 `running`，不再静默跳章。任务卡解析失败同样重试且不误标完成。
3. 终止仍加载旧代码的历史刷课进程并清理其临时 PID/接续状态；服务端实际未完成章节继续保留为 `in_progress`，下次启动重新扫描。
4. Cloudreve SSO 票据有效期从 90 秒延长为 5 分钟；无效、已使用或过期链接改为明确的 400/410 提示页，引导返回主页重新打开，不再跳向错误路由。
5. 从 Nginx 访问日志确认 Cloudreve Workbox `NavigationRoute` 会把 `/cr_login.php?t=...` 的 GET 导航截成 SPA `index.html`，进而由 Cloudreve 显示“页面不存在”；主页、旧 root 首页和 OneAPIChat 云盘面板统一改用隐藏表单 POST 票据，并把消费端挂到 Workbox denylist 已放行的 `/api/oneapichat-sso`，新旧前端都不会再进入 SPA 未知路由。

**验证**：新增视频早到 `isPassed`、末尾未确认、复核失败不增索引及 SSO POST 导航测试；相关测试 18/18 通过。两个公网 ECS IP 定向签发/消费 SSO 均返回 200；真实浏览器产生 `POST /api/oneapichat-sso 200`，随后 `/home` 成功请求用户容量与 `cloudreve://my` 文件列表（均 200），不再进入未知路由。

### ✉️ Cloudreve SMTP 找回密码 + OneAPIChat 无感单点登录 — 2026-08-11

**问题**：Cloudreve 使用无效默认 SMTP `smtp.cloudreve.com:25`，找回密码邮件无法发送；主页云盘入口只后台同步后打开首页，`cloudreve_login.php` 也仅预填邮箱，用户仍需再次输入账号密码。

**修复**：
1. SMTP 复用主项目 PHP-FPM 中已验证有效的 163 邮箱授权码，配置 `smtp.163.com:465`、SSL 强制加密、统一发件人与回复地址；写入前已备份 Cloudreve 数据库。
2. 新增 `api/cloudreve_sso.php`：浏览器只提交当前 OneAPIChat Bearer token，服务器验证主项目会话、映射同一用户、通过 Cloudreve 官方接口取得完整 access/refresh token，并签发短时一次性票据；密码和两类 token 均不进入 URL。
3. 重写 `api/cloudreve_login.php`：在 `cloudreve.naujtrats.xyz` 同源下原子消费票据，按 Cloudreve 4.18 当前格式写入 `cloudreve_session`，保留用户原有界面设置后跳转 `/home`；增加 no-store、CSP、no-referrer，票据不可重放。
4. 主页、旧 root 首页和 OneAPIChat 云盘面板的“云盘主页”全部改走同一 SSO 入口，不再依赖浏览器临时明文密码。
5. 修复主项目密码找回旁路：SMTP 失败时撤销本次 reset token 并返回 502，禁止把完整重置链接直接返回前端。

**验证**：Cloudreve SMTP 认证成功，真实找回密码邮件已发送至 root 邮箱且服务日志显示 `Email sent`；真实 root 会话成功签发并消费 SSO 票据，目标用户为 `wgCZ / xyq070519@gmail.com`，access/refresh token 齐全、无密码暴露，票据二次消费被拒绝。

### 🔐 Cloudreve root 邮箱密码恢复与同步越权修复 — 2026-08-11

**问题**：Cloudreve 的 `xyq070519@gmail.com` 管理员账号可被 OneAPIChat 自动登录，但用户使用原邮箱密码无法直接登录；找回密码邮件同时因默认 SMTP 地址失效而无法发送。

**根因**：一次主账号修复把 root 密码替换为仅保存在服务器临时文件中的 48 位随机密码；此外 `cloudreve_sync.php` 只设置 CORS、没有校验主项目身份，`cr_ensureAccount()` 在普通自动登录失败时也能直接覆盖已有 Cloudreve 密码。

**修复**：
1. 从 `2026-08-11 00:41` 的数据库备份只恢复 Cloudreve 用户 13 的原密码哈希；管理员组、昵称、容量和 4479 个文件均保持不变，并额外保存改动前快照。
2. `cloudreve_sync.php` 在同步前强制用 OneAPIChat 的 `password_hash` 重新验证身份，并以服务端用户资料覆盖客户端 email/username；伪造请求返回 HTTP 401。
3. 删除自动探测路径的静默改密能力；只有 OneAPIChat 登录成功或邮箱验证码注册成功后，才允许调用 `cr_syncVerifiedMainPassword()` 同步同邮箱密码。
4. 密码写入严格沿用 Cloudreve v4.18 官方 `{32位salt}:{sha256(password + salt)}` 格式，且只更新密码字段，不碰用户组、文件与容量。
5. 失效的随机密码缓存已移入权限为 0700 的隔离目录，避免后台持续重试错误凭据。

**验证**：3 个 PHP 文件语法检查通过；Cloudreve 同步测试 11/11 通过；未认证同步请求返回 401；Cloudreve 本机与公网入口均返回 200；root 仍为 active/Admin，文件数仍为 4479。

### 🐛 课程误标"已完成"无法继续刷修复 (完成判定逻辑 + 空章节处理) — 2026-08-09

**问题**：9 门未完成的课程（军事理论、大学语文、美学原理等）显示为"已完成"，无法继续刷课。

**根因**：
1. `tracker.py` 的 `is_chapter_completed()` 将 `status='running'` 且 `video_count=0, work_count=0` 的章节错误推断为"完成" → 所有章节都"完成" + total=0 → 课程被标记 `completed`
2. `main.py` 中当章节 `jobs` 为空时只 `continue` 不标记 `status='completed'` → 这些章节永远停在 `running`，课程也永远无法真正完成

**修复**：
1. `tracker.py`：完成判定只认 `status='completed'`，移除 `running + 0计数 = 完成` 的错误推断；移除 `total_videos==0 and total_works==0` 即完成的条件
2. `main.py`：空 `jobs` 章节显式调用 `update_chapter(status='completed')`，确保无任务点的章节被正确标记
3. 数据库修复：将 9 门误标课程从 `completed` 重置为 `in_progress`

### 🛡️ learning_records.db 只读复发根治 (取消 git 跟踪 + ACL + systemd 加固) — 2026-08-09

**问题**：`learning_records.db` 权限反复被重置为只读，之前的"三重防护"（systemd path unit + cron + git hooks）均为事后修补型，git checkout/pull/merge 重建文件时仍有窗口期导致刷课崩溃。

**根因**：db 文件仍被 git 跟踪，任何 git 操作重建文件都会重置为 `naujtrats:naujtrats 644`。

**修复（四层防护）**：
1. **根治**：`git rm --cached python/chaoxing/learning_records.db` + 添加到 `.gitignore`（含 .db-wal/.db-shm），git 永不触碰
2. **systemd 加固**：path unit 改监控目录（`PathExistsGlob` + `DirectoryNotEmpty`），防 inode 替换漏检；service unit 修复整个 `learning_records.db*` 和目录权限
3. **ACL 默认权限**：`setfacl -d -m g::rwx` 在 `python/chaoxing/` 目录，新文件自动继承组 rwx
4. **cron 兜底**：保留每 2 分钟 root cron 作为最后防线

### 🐛 刷课 AI 答题全链路修复 (ai_sync key/model 错位 + 模型列表刷新失效 + 默认模型下线) — 2026-08-10

**问题**：刷课系统 AI 答题全部失败（言溪题库请求失败 + AI 答题 HTTP 404），模型列表刷新后只显示已过期的 `deepseek-chat`。

**根因（三重叠加）**：
1. **ai_sync key 错位**：用户切换提供商后 `baseUrl=https://api.deepseek.com`（DeepSeek）但 `baseUrlProvider=longcat` 残留旧值。原 `ai_sync` 按 `baseUrlProvider` 选 `apiKeyLongCat`（已过期的 `ak_2yb9d...`），而实际请求发往 DeepSeek 端点 → 认证失败
2. **ai_sync model 错位**：DB 中 `model=LongCat-2.0`、`model_deepseek=LongCat-2.0`（per-provider 记忆未随真实使用更新），DeepSeek API 不接受 LongCat 模型名 → 404
3. **hardcode 已下线模型**：代码 3 处（chaoxing.html fallback、loadTiku 默认值、answer.py 默认模型）全硬编码 `deepseek-chat`，DeepSeek 已于 2026 年将其下线（当前只支持 `deepseek-v4-flash` / `deepseek-v4-pro`）

**修复**：
- `api/chaoxing_api.php` `ai_sync` action：
  - 新增从 baseUrl 域名反推实际提供商逻辑（`$actualProvider`），优先于 `baseUrlProvider` 字段
  - key 选择：依次尝试实际提供商专属键 → 原提供商专属键 → 通用 apiKey
  - 模型-提供商匹配校验：若模型名明显不属于该提供商（如 LongCat-2.0 配 DeepSeek 端点），自动选该提供商默认模型
- `public/chaoxing.html`：
  - 新增 `_defaultModelsForProvider` 映射（9 提供商各 2-3 个当前有效模型）+ `_guessProviderFromUrl()` 域名匹配
  - 新增 `_applyModelFallback(sel, baseUrl, cached)` — 刷新失败时按提供商智能填充（不再只显示一个 `deepseek-chat`），并过滤已确认失效模型（deepseek-chat / deepseek-v3）
  - `syncModels()`：初始即调 `_applyModelFallback` 填充列表，失败也智能回退
  - `loadTiku()`：用 `_applyModelFallback` 替代硬编码缓存渲染
  - HTML 默认 option 改 `deepseek-v4-flash`
- `python/chaoxing/answer.py` AI._query：默认模型改按 baseUrl 域名智能选择（deepseek→deepseek-v4-flash, openai→gpt-5, claude→claude-sonnet-4 等）
- `python/chaoxing/base.py` random_answer：多选题 `_op_list` 为空时提前返回 + 选项耗尽即停，防 `IndexError: Cannot choose from an empty sequence` 崩溃
- 手动修复 `/tmp/AutomaticCB/config_u_a418898cebde5e2b1e15d181.ini`：`ai_model=deepseek-v4-flash` + `ai_key=sk-c533bd240b3d47efb6758f0d57b1ddcb`

**验证**：
- ai_sync 返回验证：model=`deepseek-v4-flash`, api_key 前缀=`sk-c533b`（有效 DeepSeek key）
- 端到端 AI 答题测试：`false`（判断题正确）/ `A`（单选题正确）
- Python/PHP 语法检查通过

### 🏷️ 生图文件名人类可读化 (prompt → 文件名) — 2026-08-09

**问题**：AI 模型生成的图片文件名始终是一团乱码（如 `img_69ddab8a79c55.png`），模型无法从文件名判断图片内容，也无法在后续对话中引用自己生成的图片（用于图生图、分析等）。

**根因**：`api/upload.php` 第 204-208 行仅用 `substr(hash('sha256', $imageData), 0, 12)` 生成文件名——纯内容哈希，无人可读语义。

**修复**：
- `api/upload.php` 新增 `sanitizeFilenameHint()` 函数：将 prompt 净化为安全文件名片段（保留字母/数字/汉字/连字符，截断 40 字符，合并连续连字符）
- `upload.php` 接受 JSON body 中的 `name` 字段，生成 `img_<净化后prompt>_<hash>.ext`（如 `img_一只猫坐在月亮上_a1b2c3d4e5f6.png`）
- `public/js/upload.js` 的 `uploadImageToServer(imageInput, options)` 新增 `options.name` 参数，透传到服务端
- 全部生图上传调用点传入 prompt：
  - `tools-exec.js` × 2（generate_image / generate_image_i2i）
  - `image-gen.js` × 6（OpenRouter / OpenAI / Custom / MiniMax i2I / _gptImageI2I / _openaiImageEdit）
  - `main.js` × 2（非流式 / 流式图片模型路径，读 `generatedImages[].prompt`）
  - `stream-handler.js` × 1（直接生成路径，读 `_metaHns.prompt`）
  - `files.js` × 1（用户上传图片保留原始 `name`）
- 文件名格式：`img_<中文/英文prompt前40字符>_<sha256前12位>.png`
- `index.html` `?v=` bump

### 🐛 agent_list 429 限流崩溃修复 (统一防护 + nginx 扩容) — 2026-08-08

**问题**：Agent 面板刷新时 `GET engine_api.php?action=agent_list` 返回 `429 (Too Many Requests)`,前端报 `Unexpected token '<', "<html>... is not valid JSON` 崩溃。

**根因**：
1. **4 个调用点无防护**：agent.js 共有 5 处调用 `agent_list`,仅 `_refreshAllAgentLists` 有 429 + content-type 校验,其余 4 处(`selectAgent`/`triggerAgentAutoReplyForSubAgent`/`clearAllAgents`/`refreshEngineStatus`)直接 `.json()`,nginx 返回 HTML 429 页面即崩溃
2. **多调用方堆叠**：`openAgentPanel` 立即调一次 + 15s 定时器 + `refreshEngineStatus` 也请求,多个来源无最小间隔保护,突发打满 nginx burst
3. **nginx burst=20 偏紧**：`api_general` 区 (10r/s, burst 20) 所有 PHP 端点共享,chat + tools + polling 并发时 burst 耗尽

**修复**：
- 新增 `window._fetchAgentListJSON()` 公共获取器：统一处理 429 退避 + content-type 校验 + JSON 解析 + **客户端最小请求间隔**(正常 3s / 退避时按退避时长),失败时返回缓存而非崩溃
- 全部 5 处调用点统一改用 `_fetchAgentListJSON()`,消除各自为战的脆弱实现
- nginx `api_general` burst 20→40,为 polling + chat + tools 突发留足余量
- `index.html` `?v=` bump

### 🐛 刷新后接续气泡三点残留修复 (resume typing 类泄漏) — 2026-08-08

**问题**：页面刷新后再接气泡下方出现三个更粗的点（typing 三点动画），与正在生成的流式光标重复，且生成结束后三点不消失。

**根因**：
- 正常路径 (`main.js:2749/2882`) 在首个内容块到达时显式移除 `typing` 类
- 但 resume 路径 (`resume-stream.js:1260/1397`) 创建气泡时添加 `typing` 类后，**首个内容块到达时未移除**
- `cleanupStreamState()` (`markdown.js:484`) 有 `if (!st) return;` 早退守卫 — 当 JSON 快径未创建 `_streamState` 时，`typing` 类永远不会被清除
- CSS 规则 `.bubble.assistant.typing:not(.streaming) .markdown-body::after { content:... }` 只要气泡带 `typing` 且不带 `streaming` 就持续显示三点

**修复**：
- `applyStreamRender()` (`markdown.js`): 首次创建 `_streamState` 时立即移除 bubble 上的 `typing` 类（流式渲染开始即清除等待动画）
- `cleanupStreamState()` (`markdown.js`): 移除 `if (!st) return;` 早退，改为即使 `_streamState` 已被提前清理，也检查 `activeBubbleMap[chatId]` 并移除其 `typing/gen-active/streaming` 类
- `index.html` `?v=` bump

### 🚨 聊天数据丢失根因修复 (31条普通聊天恢复 + 双重防护) — 2026-08-06

**问题**：用户打开应用后侧边栏仅显示 1 条空"新对话"，之前所有普通聊天全部消失。

**根因排查**：
1. 硬刷新后 `config.js` 版本号正确但聊天仍不可见 → 排除缓存问题
2. 在 `renderChatHistory` 加调试日志发现：`总=54, 普通=1, Agent=53, 过滤后剩余=1` — 54 条聊天中只有 1 条是普通聊天
3. 检查服务器 `chat_data/user_u_a418898cebde5e2b1e15d181_all.json`：确认只有 1 普通+53 Agent=54 条
4. 检查备份时间线发现灾难时间点：**16:44 有 32 普通+53 Agent=85 条 → 16:49 骤降为 0 普通+10 Agent=10 条**
5. 31 条普通聊天在 5 分钟内丢失

**根因**：
- **前端**：`beaconSaveChats()`（`storage.js`，页面关闭时 `sendBeacon`）将本地 `chats` 对象原样发往服务器，**无合并保护**
- **服务器**：`chat.php` POST `chat_id=all` 直接 `file_put_contents` 覆盖 `all.json`，**无合并保护**
- **触发链**：`restoreUserData` 中"本地残留聊天清理"逻辑（`storage.js:450-466`）在特定条件下（服务器返回聊天数 > 0 且本地有聊天不在服务器上、更新时间 > 5 分钟）会删除本地普通聊天。页面关闭时 `beaconSaveChats` 将清理后的不完整数据（仅 10 条 Agent 聊天）覆盖写入服务器，导致 31 条普通聊天永久丢失

**修复**：
1. **服务器端合并保护**（`api/chat.php`）：POST all 时，如果服务器已有数据比前端多发 5 条以上，视为前端数据不完整，取并集（保留服务器有但前端没发的聊天），跳过已墓碑标记的删除项。同时记录 error_log
2. **前端 beacon 防护**（`public/js/storage.js`）：本地聊天数 < 5 条时跳过 beacon 发送，防止不完整数据覆盖服务器
3. **数据恢复**：从备份 `all.json.20260805-1644` 合并恢复 32 条丢失聊天，最终 33 普通+53 Agent=86 条

**验证**：恢复后 `all.json` 总数 86 条；PHP 语法检查通过；`build-index.js` 版本号已 bump

### 🔧 学习通刷课模型列表刷新按钮无效修复 (CORS) — 2026-08-06

**问题**：学习通刷课面板中 AI 模型旁的 "↻" 刷新按钮点击无反应，无法刷新模型列表。

**根因**：`chaoxing.html` 是完全自包含的单文件页面，不加载 `config.js`，因此 `window.proxyFetch`（主应用绕过 CORS 的代理函数）不可用。`syncModels()` 直接 `fetch(baseUrl + '/models')` 到外部 API（如 `https://api.deepseek.com`），被浏览器 CORS 策略拦截 → 请求静默失败 → catch 块显示"已使用缓存列表"或回退默认值，用户看到的就是"点了一下什么都没发生"。

**修复**：

1. **`api/chaoxing_api.php` 新增 `models_proxy` action**：服务端 PHP curl 中继 `/models` 请求（同源请求无 CORS），强制 IPv4 解析（东财风控教训），透传 API 原始 JSON 响应。
2. **`chaoxing.html` `syncModels()` 改为走本地代理**：`fetch('/oneapichat/api/chaoxing_api.php?action=models_proxy&url=...&key=...')` 替代直接 fetch 外部 API。
3. **按钮 loading 反馈**：点击后按钮变 `⏳` + disabled，请求完成后恢复 `↻`，给用户明确的操作确认。
4. **错误信息优化**：刷新失败时 toast 显示具体原因（如 `HTTP 401`），而非模糊的"已使用缓存"。

**验证**：PHP 语法 OK、JS 语法 OK、curl 实测能连通 DeepSeek API（无效 key 返回 401 透传，有效 key 将返回完整模型列表）。

### 🔧 learning_records.db 只读复发修复 + setgid 加固 — 2026-08-06

**问题**：刷课启动报错 `OperationalError: learning_records.db 不可写 (uid=33)`（2026-08-03 修复后再次复发）。

**根因**：git 操作重建文件后所有权重置为 `naujtrats:naujtrats` 644，www-data 只读。tracker.py 自修复代码在 uid=33 运行时只能 chmod 不能 chown（需 root）。

**修复**：
1. `chown naujtrats:www-data learning_records.db && chmod 664`（恢复组写权限）
2. **`chmod g+s python/chaoxing/`**（setgid 位 — 关键加固）：新建文件自动继承 www-data 组，防止 git 重建文件后再次丢组

**验证**：www-data 可写 db、`LearningTracker` 初始化通过、新建文件自动继承 www-data 组（实测 `touch` 创建的文件为 `naujtrats:www-data`）。

### 🎯 模型选择刷新/取消后跳回首个模型修复 — 2026-08-06

**问题**：用户反馈模型选择"老是乱跳"——一刷新页面就变成列表中的第一个模型，点击配置面板的取消按钮也会变成当前厂商列表的第一个模型，无法记住各厂商上次使用的模型。

**根因（三重叠加）**：

1. **`snapshotConfig()` 快照不完整**（ui.js）：快照键列表是硬编码的 `['apiKey', 'baseUrl', 'systemPrompt', 'model', ...]`，不包含 `baseUrlProvider`（当前厂商）和各厂商独立的 `model_{provider}` 键。用户在面板内切换厂商后点取消 → `baseUrlProvider` 未被还原（仍为新厂商），但通用 `model` 键被还原为旧厂商的模型名 → `initializeConfig()` 读取 `model_{新厂商}`（为空）→ fallback 到 `model`（旧厂商模型名）→ 新厂商列表中找不到该模型 → 下拉框显示第一个模型。

2. **`onProviderChange()` 不持久化默认模型**（utils.js）：切换到某个厂商时若该厂商无已存模型（`model_{provider}` 为空），只写通用 `model` 键为默认值，不写 `model_{provider}`。导致下次切回该厂商时 per-provider 记忆仍为空，每次都回退到厂商默认值（而非用户上次选择的模型）。

3. **`fetchModels()` 选中后未回写 localStorage**（config.js）：`fetchModels` 设置 `mainSelect.value` 后未同步更新 `model` 和 `model_{provider}`，导致刷新后 localStorage 中的值与实际显示不一致。

**修复**：

1. **`snapshotConfig()` + `restoreConfigSnapshot()`**（ui.js）：遍历 localStorage 动态捕获 `baseUrlProvider` 和所有 `model_*` 键，确保取消时完整还原厂商和各厂商模型。
2. **`onProviderChange()`**（utils.js）：当使用厂商默认模型时，同时写入 `model_{provider}` 键，确保 per-provider 记忆始终有值。
3. **`fetchModels()`**（config.js）：选中模型后同步写入 `model` + `model_{provider}` 双键，保持 localStorage 与实际显示一致。

**验证**：3 文件 `node --check` 全通过，index.html `?v=` bump 1786050000 强制浏览器拉新。

### 🎨 并行图片生成 (Parallel Image Generation) — 2026-08-05

**功能**：当模型在同一轮响应中发出多个 `generate_image` / `generate_image_i2i` 工具调用时，这些调用会被自动检测并通过 `Promise.all` 并行执行，大幅缩短总等待时间（3 张图串行 30s → 并行 ~10s）。

**实现要点**：
1. **批次检测**（main.js）：进入 for 循环前扫描 `normalizedToolCalls`，找出连续的 `generate_image`/`generate_image_i2i` 调用索引（≥2 个才触发并行）
2. **预执行**：通过 `Promise.all` 并行发起所有图片生成调用，每个调用独立 `AbortController`，全部完成后才进入 for 循环
3. **结果复用**：for 循环内通过 `_parallelImageResults[index]` 取预计算结果，跳过 `executeToolCallForRetry`，保持原有的消息写入/UI 更新逻辑不变
4. **UI 适配**：并行模式下显示统一状态「🎨 正在并行生成 N 张图片...」，tools-exec.js 通过 `window.__parallelImageActive` 标记跳过个体占位符
5. **模型引导**：工具定义 `n` 参数描述增加「并行提示」，引导模型在需要多张不同提示词图片时主动发起多个调用

**文件变更**：
- `public/js/main.js`：新增并行批次检测 + 预执行逻辑（~70 行），for 循环内增加并行结果分支
- `public/js/tools-exec.js`：generate_image/generate_image_i2i 占位符逻辑增加并行模式守卫
- `public/js/tools.js`：generate_image/generate_image_i2i 工具定义 `n` 参数描述增加并行提示
- `index.html`：4 个 JS 文件 `?v=` bump 1785953000

**验证**：3 个 JS 文件 `node --check` 全过。

### 🛡️ 切换提供商不再刷新模型列表 — 仅保存时刷新 — 2026-08-05

**问题**：配置栏选择模型提供商后模型列表刷新一次，点击保存后又刷新一次，双刷新导致生成过程中的模型中断（`fetchModels` 替换 `modelSelect.innerHTML` 触发 change 事件）。

**根因**：存在两条刷新路径叠加：
1. `onProviderChange()` (utils.js:75-79) — 切换提供商后 200ms 调用 `fetchModels(true)` → 刷新 #1
2. `saveConfig()` (config.js:928-932) — 保存后 1500ms 调用 `fetchModels(true)` → 刷新 #2

两处虽有 `_activeStreamChatId` 守卫（config.js:1204）防活动流时跳过，但切换提供商本身不应触发刷新。

**修复**：删除 `onProviderChange` 内的 `fetchModels` 调用（utils.js:73-79），模型列表刷新统一在 `saveConfig` 时执行。`fetchModels` 入口的 `_activeStreamChatId` 守卫保留，防止保存时恰好有活动流输出导致中断。

**验证**：`node --check public/js/utils.js` 通过，utils.js `?v=` bump 1785925001。

### 🧠 思考强度分级系统 (off~ultra) — 2026-08-05

统一 6 档思考强度控制（off/low/medium/high/max/ultra），全局生效（普通聊天 + Agent 模式），学习主流模型原生分级方式并自动映射到各提供商参数。

**统一分级 → 提供商映射表**：

| Level | OpenAI `reasoning_effort` | Claude `output_config.effort` | Gemini 3 `thinking_level` | DeepSeek V4 `reasoning_effort` | LongCat/MiniMax `thinking.type` | 显示条件 |
|---|---|---|---|---|---|---|
| off | 删除 | thinking:disabled | 删除 | 删除 | disabled | 全部 |
| low | low | low | low | low | enabled/adaptive | 全部 |
| medium | medium | medium | medium | medium | enabled/adaptive | 全部 |
| high | high | high | high | high | enabled/adaptive | 全部 |
| max | high（上限） | xhigh | high（上限） | max | enabled/adaptive | 全部 |
| ultra | high（上限） | max | high（上限） | max | enabled/adaptive | 仅 Claude/DeepSeek V4 |

**Claude 双模式**：effort 支持模型（Opus 4.6+/Sonnet 4.6+/Sonnet 5+/Opus 5+/Fable 5）用 `output_config.effort`；仅 extended thinking 模型（Sonnet 4.5/Haiku 4.5 及更早）用 `budget_tokens` 映射（low=2k/medium=8k/high=16k/max=32k/ultra=64k）。

**变更要点**：
- 新增 `public/js/models.js` 中 `THINKING_INTENSITY_MAP` + `getThinkingIntensityParams()` + `supportsThinkingIntensity()` + `supportsThinkingUltra()` + `S.THINKING_LEVEL` 标记
- `main.js` 删除 agent-only 的 `agentThinkingDepth` reasoning_effort 逻辑和 LongCat/MiniMax 独立 thinking 设置，改为全局统一处理
- `index.html` 删除 `agentThinkingDepth` 3 级 select 和 `thinkingModeRow` 二元开关，新增 6 级 `thinkingIntensityRow`（ultra 选项仅 Claude/DeepSeek V4 显示）
- `config.js` 新增 `_migrateThinkingIntensity()` 迁移旧配置（shallow→low/standard→medium/deep→high, disabled→off）+ `_updateThinkingIntensityVisibility()` 动态显隐
- `init.js` / `ui.js` 更新初始化和配置快照 keys
- 旧 `agentThinkingDepth` / `thinkingMode` / `longcatThinkingMode` 配置自动迁移

**验证**：18 项映射单测全过（Claude effort/budget 双模式、DeepSeek V4 max/ultra、OpenAI/Gemini 上限截断、LongCat/MiniMax binary 全覆盖）；5 个 JS 文件 node --check 全过。

## [2.0.0] - 2026-05-26

### 🧠 Agent 三模式系统
- **Plan** 只读模式：仅搜索/读取，消息注入普通聊天
- **Agent** 交互模式：文件操作+命令，AI 可操作需用户审批
- **YOLO** 自主模式：所有操作自动批准（需物理 confirm 切换）
- Agent 对话独立化：不混入普通聊天历史，每次进入创建独立聊天
- 进入 Agent 模式自动携带对话上下文
- Agent 通知机制：基于 execId + sendMessage，防止并发重复激活

### 🔒 安全增强
- `autonomous_mode` 工具：Agent 模式 + 物理 confirm 双重确认
- `ask_agent` 工具：AI 请求启用 + 用户 confirm + 自动中止旧请求
- 用户菜单：个人中心 + 退出
- 多用户 API Key 加密存储，独立配置隔离
- CORS 动态匹配，移除硬编码 IP

### 🎨 UI 优化
- 全屏进入/退出动效（Plan 蓝 / Agent 紫 / YOLO 红）
- 触屏设备：单击弹菜单选模式，双击直接开关
- 命令面板：SVG 图标 + 毛玻璃样式
- PWA 支持：安装到桌面 + 离线缓存
- iOS Safari 键盘收起修复
- 侧边栏统一控制

### 🔧 平台 & 部署
- **Windows 支持** — `deploy.ps1` PowerShell 一键部署脚本
- 自动安装 PHP 8.3 + Python 3.12（winget / 官网下载）
- 跨平台 Python 路径处理（`Path(__file__).parent` 替代硬编码）
- `import fcntl` 加 try/except 兼容 Windows
- `download.php` 使用 `sys_get_temp_dir()` 替代硬编码 `/tmp/`
- Docker 多架构镜像（`linux/amd64` + `linux/arm64`）
- Dockerfile 完整重构 — supervisor 管理 nginx + PHP-FPM + engine
- 一键部署脚本 v2.0 — 支持 `curl | bash` 自动克隆安装
- GitHub Actions Release Workflow：推送 tag 自动构建

### ⚡ SSE 流式架构
- **SSE 流式后端** — Feature Flag 控制，Python FastAPI + SQLite 存储
- **ChatStore** — SQLite 消息持久化层，支持流式写入
- **心跳推送** — 引擎通过 SSE 推送到前端，支持后台通知
- SSE 事件解析：支持 content/reasoning/tool_call/done/error 事件类型
- 发送消息时自动重置滚动状态和流式跟随锁定

### 🔍 联网搜索
- Brave / Google / Tavily 多引擎支持
- AI 自动判断是否需要搜索
- 联网搜索按钮可开关，UI 整合进高级设置

### 🛠 刷课模块修复
- 刷课账号以学习通手机号为唯一标准，跨聊天账号共享进度
- `start_course` 跳过已完成课程，ON CONFLICT 不再重置 status
- 视频/答题计数修复：video_count=0 章节不参与完成计数
- `_update_course_stats` 自动更新课程 status=completed
- `video_logs` 表缺列修复（ALTER TABLE 添加 video_name 和 watched_at）
- 停止操作重置数据库中 in_progress 课程
- 错误日志改进：识别 traceback 连续段落，修复 KeyError 崩溃

### 📦 项目清理
- 删除全部测试文件和残留备份
- `.gitignore` 清理：排除 `.vs/`、`__pycache__`、`*.backup`、`users/`、`chat.php`、`rag/`（API Key）
- AGPL-3.0（主项目）+ MIT（刷课模块）双许可证声明
- 多语言 README（EN / ZH / JP）重写

---

## [1.0.0] - 2026-05-08

### Added
- **Docker 部署支持** — 完整多阶段构建，支持 linux/amd64 + linux/arm64
- **docker-compose 一键部署** — `docker compose up -d` 即可运行
- **一键部署脚本** — 适配 Ubuntu/Debian/CentOS/macOS，自动检测系统和安装方式
- **GitHub Actions Release Workflow** — 推送 tag 自动构建并发布 Docker 镜像到 GHCR


## OneAPIChat 最近变更全文 (2026-06 ~ 2026-08)

> 从 CLAUDE.md 归档 (2026-08-02)。CLAUDE.md 仅保留一行摘要，全文见此处。


- **2026-08-10**: 🛡️ **聊天数据丢失五连环根因修复 (超时/合并/墓碑/beacon/重试)** — ①**用户反馈**: 历史对话内容莫名被清空, 整个会话从历史列表消失(标题也没了); 控制台显示 `[restoreUserData] 聊天加载失败: timeout`; ②**根因链**: ①服务器`all.json`达6.1MB→前端GET超时(10s)→合并跳过→本地不完整数据保留; ②`saveChatsToServer`合并逻辑只补缺聊天不比较消息数→本地0消息覆盖服务器195消息(永久丢失); ③`beaconSaveChats`超60KB时发送ultraSlim(仅6条消息)→截断服务器完整数据; ④服务器端合并保护只比聊天数不比消息数→不防消息截断; ⑤"跨域名同步"逻辑服务器缺聊即删本地→服务器数据不完整时误删真实聊天; ③**修复**: ①前端GET超时10s→30s; ②前端`saveChatsToServer`合并时比较消息数保留更长版本; ③新增轻量`meta=1`端点(仅id/时间/消息数,~50KB)用于合并检查避免传6MB; ④服务器端新增消息数比较保护(每个聊天单独比较); ⑤跨域名同步改为仅删服务器`deleted`墓碑标记的聊天(不再因缺聊误删); ⑥移除`saveChatsToServer`危险重试(原重试发10条×4消息会截断数据); ④**验证**: node --check storage.js 通过; php -l chat.php 通过; python3 tools/build-index.py 重建; 涉及 storage.js + chat.php + index.html `?v=` bump
- **2026-08-08**: 🚪 **关闭Agent模式时计划面板带入普通会话修复** — ①**用户反馈**: 关闭 Agent 模式后, 计划面板("执行计划"流面板)残留在普通会话的输入区; ②**根因**: `#flowPanel` 位于输入区 (`.input-clip`, index.html:423) 而非消息区 (`#chatBox`), `loadChat` 重绘消息不影响输入区元素, 必须主动 dismiss; 原逻辑仅在 `prevMode==='plan'` 时 dismiss (plan→off 路径, agent.js:170-175), 但 `createFlowPanel` (tools-exec.js:702) 在 agent/yolo/plan 任一模式下都可被 `plan_update(action="create")` 触发, 导致 **agent→off / yolo→off 时面板残留**带入普通会话; ③**修复**: 拆分为两块 — plan 状态重置 (`_planState`/`_planApproved`/`_pendingPlanActions`, 保持仅 plan→off 时执行) + 面板 dismiss (统一在 `mode==='off' && !window._tempAgentGranted && window._agentPlan` 时触发 `dismissFlowPanel()`); 排除临时授权恢复场景 (点击 off 时 temp grant 重新激活 Agent, 面板应保留); ④**验证**: node --check agent.js 通过; `python3 tools/build-index.py` 重建; 涉及 agent.js + index.html `?v=` bump
- **2026-08-05**: ☁️ **云盘账号同步主项目邮箱+密码 + 切账号自动切换 + 串号修复** — ①**用户反馈**: 清完账号后云盘不跟随切换到新账号, 旧账号仍保持登录; 要求切账号时云盘同步登录新账号对应账户, 未注册则自动注册, 邮箱密码与主项目一致; ②**根因 1 — 云盘用桥接账号**: `cr_ensureAccount()` (`cloudreve_lib.php:307`) 三级优先级落到③桥接账号 `{userId}@oneapichat.local` + 确定性密码 `substr(hash('sha256',$userId.'naujtrats-cr-bridge-v2'),0,24)`, 与主项目真实邮箱+密码完全无关; ③**根因 2 — cr_getAccessToken 跨用户 glob 回退 (串号根源)**: `cloudreve_lib.php:246-264` 当 userId 无专属缓存文件时 glob **所有** `/tmp/cloudreve_login_*.json` 返回第一个能登录的 token → 新用户 B 登录时捡到旧用户 A 的 token → 面板显示 A 仍登录; ④**根因 3 — 切账号无云盘同步动作**: `performAuthLogin` (`index.html:1245`) 切账号只清 localStorage + reload, 无任何云盘重新登录逻辑; ⑤**根因 4 — 主项目只存 password_hash**: `auth.php:317` 存 `password_hash` (bcrypt), 云盘需要明文密码, 无法从 hash 反推; ⑥**修复 auth.php**: login + register 处理器认证成功后, 把明文 `email`+`password` 写入 `/tmp/cloudreve_login_{md5(userId)}.json` (按 userId 隔离, `source=main_auth`), 捕获登录/注册瞬间的明文密码; ⑦**修复 cloudreve_lib.php**: ①`cr_ensureAccount` 重写优先级 — 先读 userId 专属缓存, 跳过 `@oneapichat.local` 桥接格式, 用真实邮箱+密码调 Cloudreve `/session/token` 登录; 登录失败则自动调 `/user` 注册 (同邮箱同密码, 接受 40004/40032 已存在码), 注册后再登录; `source` 标记 `main_sync`/`main_sync_registered`; 密码不匹配时删除失效缓存, 回退到面板绑定凭据→邮箱匹配→桥接账号兜底 (永不锁死); ②`cr_getAccessToken` 删除跨用户 glob 回退 — `uid` 存在但专属文件找不到/登录失败时直接 `return ''`, 上层 `check_login`/`cr_importFile` 触发 `cr_ensureAccount` 同步; 保留空 uid 时的 MCP_PRIMARY 回退 (服务端 MCP 调用无用户上下文场景); ⑧**修复 cloudreve_api.php**: ①`check_login` 无有效 token 且有 userId 时自动调 `cr_ensureAccount($userId)` 同步, 返回 `synced:true`+`source`; ②`auto_login` 委托 `cr_ensureAccount` 不再硬编码桥接邮箱; ③`register` 成功后自动登录获取 token 并 `cr_cacheToken`; ⑨**修复前端**: `cloudreve.js` 新增 `window.syncCloudreveAccount()` 调 `auto_login`; `performAuthLogin` 登录成功后设 `_syncCloudreveAfterLoad=1`; `init.js doVerify` 后读该标志延时 1.5s 调 `syncCloudreveAccount` 完成切账号→云盘切换; ⑩**验证**: 新增 `python/tests/test_cloudreve_sync.py` 10 项 (auth.php 缓存明文密码结构断言 / ensureAccount 真实邮箱优先+自动注册 / getAccessToken 禁止跨用户回退 / check_login 自动同步 / auto_login 委托 / register 自动登录 + 实机: root 账号 `main_sync` 登录真实邮箱 `xyq070519@gmail.com` 成功+whoami 确认 Admin 身份 / 新邮箱 `main_sync_registered` 自动注册成功+whoami 确认 User 身份 / 用户 B 空文件隔离 `cr_getAccessToken` 返回空) 全 PASS; 既有 7 测试文件保持绿; node --check 3 JS 通过; php -l 3 PHP 通过; index.html 41 个 `?v=` bump 1785905928; 涉及 auth.php cloudreve_lib.php cloudreve_api.php cloudreve.js init.js index.html python/tests/test_cloudreve_sync.py(新) CLAUDE.md docs/CHANGELOG.md
- **2026-08-03**: 🪟 **蕾米小窗 v3.1 (玻璃真透明 + 等比缩放 + 更小下限)** — ①**用户三点反馈**: ①悬停时玻璃看起来是**纯色**不是透明玻璃; ②缩放要**只支持等比** (含背景/圆形整体同步); ③最小状态**还是太大**, 移动端要能继续缩小; ②**反馈 1 根因**: 玻璃背景 `rgba(255,255,255,0.92)` — 透明度 92% 几乎不透明, 在平色聊天内容上 `backdrop-filter:blur(14px)` 没有纹理可糊 → 视觉上就是一块纯白卡片 (暗色 0.92 同理纯黑); 修复: 透明度降到 `rgba(255,255,255,0.4)` (暗色 `rgba(17,24,39,0.45)`) + `blur(16px) saturate(1.5)` (模糊增强 + 饱和度提升, 玻璃质感关键) + 边框改半透明白 `rgba(255,255,255,0.55)` (暗色 0.12) — 悬停时能透见后方模糊内容, 才是"透明玻璃状" (CSS 注释明确警示: 透明度必须明显低于 1); ③**反馈 2 — 等比缩放**: 原 pointermove 宽高独立增量 (`origW+dx` / `origH+dy`) 会把圆形头像和卡片拉变形; 改为以**移动量更大的轴**为基准 (dominant axis) 计算统一缩放比 `scale = |dx|≥|dy| ? (origW+dx)/origW : (origH+dy)/origH`, 宽高同比例写入 `Math.round(origW×scale)` / `Math.round(origH×scale)` — 背景卡片/圆形 GIF/整体形状随缩放保持一致, 不会变形; 钳制改为**缩放比互锁**: `scaleMin = max(ZW_MIN/origW, ZH_MIN/origH)`, `scaleMax = min(ZW_MAX/origW, ZH_MAX/origH)` — 等比下同时满足两轴上下限; ④**反馈 3 — 更小下限**: 桌面 `ZOOM_MIN_W/H` 150×170→**96×112** (可缩到小头像级别), 移动端默认宽度 200→**170px**、`min-width/min-height` 140×150→**84×96** (媒体查询兜底, 继续等比缩更小); ⑤**验证**: tests/remi_zoom_window.test.js 更新 — T1 等比数学 (220×240, dx=+80 主导 → 宽 300 / 高 240×1.3636=327)、T2 互锁钳制 (scaleMax=min(420/220,560/240)=1.9091 → 420×458; scaleMin=max(96/220,112/240)=0.4667 → 103×112)、T3 落盘等比值 (370×404)、T4 越界钳制 420×112、T12 玻璃断言升级 (rgba 0.4 / 禁 0.92 / blur(16px) saturate(1.5) / 暗色 0.45 / 移动端 left:10px 块含 width:170px + min-width:84px + min-height:96px) 全 PASS; tests/remi_cdp_verify.py 实机 20 项全过 — 等比缩放 260×260→400×400 (双轴等量, 含落盘一致)、悬停玻璃 computed `rgba(255,255,255,0.4)` + `blur(16px) saturate(1.5)`、静止透明/移开恢复; 既有 7 个测试文件保持绿; node --check 通过; ⑥**发布**: index.html 全部 41 个 `?v=` bump 1785764276, 线上 curl 确认 style.css 含 0.4 玻璃与 model-status.js 含等比注释; 涉及 style.css model-status.js tests/remi_zoom_window.test.js tests/remi_cdp_verify.py CLAUDE.md docs/CHANGELOG.md
- **2026-08-03**: 🪟 **蕾米小窗 v3 (玻璃背景仅悬停/触摸浮现)** — ①**用户需求**: 蕾米小窗「背景隐藏, 只有鼠标悬停或者手指触摸时才显示透明玻璃状背景」; ②**实现 (纯 CSS, 零 JS 改动)**: `.remi-zoom-window` 基础态改**全透明** — `background:transparent` + `backdrop-filter:none` + `border:1px solid transparent` + `box-shadow:none` (只留圆形 GIF 悬浮, 视觉上头像浮在页面上); 新增 `.remi-zoom-window:hover, .remi-zoom-window:active` 玻璃浮现规则 — 亮色 `rgba(255,255,255,0.92)` + `blur(14px)` + `rgba(148,163,184,0.35)` 边框 + 投影, 暗色 `rgba(17,24,39,0.92)` + `rgba(75,85,99,0.45)` 边框 + 深投影 (原 `.dark .remi-zoom-window` 常驻规则改 hover/active 条件); 0.25s 过渡 (background/backdrop-filter/border-color/box-shadow 五属性, 毛玻璃柔和浮现); ③**卡片元素随玻璃浮现**: 标题栏 (含关闭按钮) 与缩放手柄 grip (`.remi-zoom-resize::after`) 基础态 `opacity:0` (防"文字/✕/grip 无卡片悬浮"的破碎观感), 窗口 hover/active 时 `opacity:1` (0.2s 过渡) — 悬停/触摸即完整卡片, 移开即回归纯净头像; ④**交互兼容性**: 拖动 (pointerdown 按住头部) 与缩放 (按住手柄) 期间 `:active` 恒真 → 玻璃全程可见, 松手后自然淡出; 触摸设备上首触触发 sticky `:hover` + 按压 `:active` 双通道, 玻璃/关闭按钮可及; `opacity:0` 不影响 pointer-events, 悬停命中/拖动照常; ⑤**验证**: 新增 `tests/remi_zoom_window.test.js` T12 源码断言组 (基础态 transparent/none/none / hover+active 玻璃 rgba(255,255,255,0.92)+blur(14px) / 暗色 `.dark .remi-zoom-window:hover` 同条件 / 标题+手柄 opacity:0 隐藏与 hover 浮现规则) 全 PASS; 新增 `tests/remi_cdp_verify.py` 第 6 步**真实鼠标**验证 7 项 — `Input.dispatchMouseEvent` (真实 hit-test 驱动 :hover, 合成 MouseEvent 无效): 鼠标移到 (10,10) 后实测 computed `rgba(0,0,0,0)` + `backdropFilter:none` + 标题 opacity 0 → 移到窗口中心 → `rgba(255,255,255,0.92)` + `blur(14px)` + 标题 opacity 1 (等 0.4s 覆盖 0.25s 过渡) → 移开恢复全透明 (未登录 CDP 浏览器先隐藏 `#authOverlay` 登录遮罩防挡真实 hit-test, 验证后恢复); 既有 11 组 + 7 个测试文件保持绿; node --check 通过; ⑥**发布**: index.html 全部 41 个 `?v=` bump 1785763869, 线上 curl 确认 style.css 含「悬停 (桌面)」注释新内容; 涉及 style.css tests/remi_zoom_window.test.js tests/remi_cdp_verify.py CLAUDE.md docs/CHANGELOG.md
- **2026-08-03**: 🪟 **蕾米放大小窗 v2 (可缩放 + 稳定性加固)** — ①**用户需求**: 蕾米小窗「自主调整大小且更加稳定」; ②**可缩放实现**: 窗口右下角新增 `.remi-zoom-resize` 缩放手柄 (24×24px, `cursor:nwse-resize` + `touch-action:none` + `::after` 双线 grip 角标, 暗色提亮), 指针捕获拖动 (pointerdown 锚定左上角 → pointermove 宽高独立增量 → pointerup 落盘), 尺寸钳制 150-420×170-560px, 缩放中挂 `remi-zoom-resizing` 类 (与 dragging 共享投影高亮); 窗口布局改 `display:flex; flex-direction:column` (min-width/min-height 兜底) + 图片流体缩放 (`width/height:auto; max-width/max-height:100%` 保持圆形, 移除固定 190px/168px 尺寸) + `draggable="false"` + `-webkit-user-drag:none` 防原生图片拖拽幽灵; ③**真实根因 (稳定性核心 — 动画重启)**: 排查中 CDP 实机抓到一个深坑 — 原 v3 的 `.remi-zoom-window.remi-zoom-dragging { animation: none }` 规则在**移除类时会让 `remi-zoom-in` 动画重新播放** (animation 属性变化 → 新动画实例从头开始): 拖动/缩放结束瞬间 `getBoundingClientRect` 读到 **0.85x 缩放中**的坐标 (实测 420×0.85=357px), 结束钳制数学全错 (窗口松手后仍超出屏幕, 曾实测 bottom 946>900 拉不回), 且小数坐标被持久化 (localStorage 里 39.5px 这类值 → 刷新后界面抖动); 修复: 交互类删除 `animation:none` (动画 0.28s 在用户交互前早已播完, 只换投影即可), 钳制写入统一 `Math.round` (防动画/缩放中途小数 rect 落盘); ④**大小持久化**: 新增 `remiZoomSize` localStorage (缩放结束 saveZoomSize), 打开/刷新恢复时 `loadZoomSize` 钳制越界值 (150-420×170-560); 与 `remiZoomPos` 并列恢复; ⑤**视口钳制 (稳定性)**: 新增 `clampZoomToViewport(allowOffscreen)` — 拖动/缩放进行中 (`true`) 允许部分在屏外但至少留 56px 可抓回, 松开/打开/视口变化后 (`false`) 整体拉回可视区 (窗口比视口大时贴边); `clampZoomSizeToViewport()` 视口缩小时临时收缩尺寸 (键盘弹起/旋转/窗口缩放, 不落盘 — 仅用户主动缩放持久化); `window.resize` + `window.visualViewport.resize` 双监听 rAF 去抖 (防高频事件); ⑥**`[hidden]` 守卫 (隐性坑)**: 窗口新增 `display:flex` 后特异性压过 UA 的 `[hidden]{display:none}` — JS 用 `win.hidden` 开/关小窗将**完全失效** (打开永不显示/关闭永不隐藏) → 补 `.remi-zoom-window[hidden]{display:none!important}`; ⑦**缩放锚定**: pointerdown 先写显式 left/top 再清 `bottom` (CSS 默认 bottom 定位, 只清 bottom 不补 top 会跳位到静态位置); ⑧**验证**: 新增 `tests/remi_zoom_window.test.js` 11 组 (vm 沙箱 + FakeEl DOM 桩: 缩放数学 220+80→300 / 上下限钳制 420·560 / pointerup 落盘 `{"width":370,"height":380}` / 打开恢复 350×400 + 越界 1000×10 钳制 / 视口位置钳回 972·492 / 视口缩小尺寸收缩 304×384 且不落盘 / 拖动回归 -156 可抓回+松手拉回 8 / Esc 关闭清理 / CSS hidden 守卫断言 / 交互类无 animation 重启守卫 / HTML 手柄+draggable=false) 全 PASS; 新增 `tests/remi_cdp_verify.py` 实机 CDP 13 项全过 (真实 PointerEvent 缩放 260×260→400×360 + 落盘 + 视口内、隐藏守卫 display:none、视口 300×300 收缩 284×284、rAF 等待 100ms 防读早、动画等待 450ms 防缩放坐标); 既有 7 个测试文件保持绿; node --check 通过; 线上 curl 确认 model-status.js/style.css/index.html 新内容已发布 (期间并行会话字体任务 bump 1785763320 与本次 sed 碰撞, 已确认当前 index.html 41 个 `?v=` 统一 1785763308 且两份内容均已在线); 涉及 model-status.js style.css index.html tests/remi_zoom_window.test.js(新) tests/remi_cdp_verify.py(新) CLAUDE.md docs/CHANGELOG.md
- **2026-08-03**: 🔤 **字体体系自托管优化 (Inter + JetBrains Mono 实载 + 代码块等宽化)** — 用户分享「AI 流式生成场景字体选择」方案并要求优化; **核心问题**: 全站 `'Inter'`/`'JetBrains Mono'`/`'SF Mono'` 字体栈**声明了但从未加载** — 无 @font-face、无 Google Fonts 外链、无本地字体文件 → 所有字体名静默 fallback 到系统默认 (Windows 上代码块渲染成等宽默认/正文直接系统 UI 字体, 跨平台观感不一致); 且**聊天内 markdown 代码块 (`.markdown-body pre/code`) 无 font-family 声明** — 流式输出代码块用正文字体渲染, 逐字输出时比例字体宽幅抖动、缩进/对齐不稳定; **修复**: ①**自托管字体**: 从 jsDelivr (fontsource) 下载 Inter + JetBrains Mono 各 4 字重 (400/500/600/700) latin 子集 woff2 → `public/fonts/` (共 8 文件 ~180KB, 单文件 20-25KB 极轻量); 站点面向国内, Google Fonts 被墙不能引外链, 自托管零外部依赖; 中文 CJK 仍由系统字体栈承接 (PingFang SC/雅黑/Noto Sans SC) — 与文章「中文走系统字体」建议一致; ②**@font-face ×8**: `font-display: swap` (字体加载期间先渲染 fallback, 不阻塞首屏, 无 FOIT), `unicode-range` latin 子集限定 (浏览器只下载需要的子集); ③**CSS 变量统一入口**: `:root` 新增 `--font-sans` (Inter 自托管 + 系统中文栈, 文章正文推荐栈) 与 `--font-mono` (`'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', Consolas, Monaco, monospace` — 文章代码推荐栈), body 改用 `var(--font-sans)`; ④**代码块等宽化 (流式稳定性核心)**: `.markdown-body pre` + `.markdown-body code` 补 `font-family: var(--font-mono)` — 流式逐字输出时字符宽固定, 布局不跳动/缩进对齐稳定 (文章场景 1); ⑤**10 处散落字体栈统一**: 文件预览 (.file-preview-content)、slash 面板命令/参数 (.slash-item-cmd/.slash-item-args)、src 日志查看器 (.src-log-viewer)、文件路径 (.file-result-card-path)、审批工具标签/参数 (.approval-tool-tag/.approval-args-pre)、工具调用状态行 (.tool-call-lines 统一 sans 变量)、tool-exec-output/密钥显示/技能定义 textarea/diff 视图 (rendering.js/config.js/utils.js/index.html 内联样式) 全部改 `var(--font-mono)` 或 `var(--font-sans)` — 原 SF Mono 领先的混合栈 (SF Mono 仅 macOS 有) 统一为 JetBrains Mono 领先; **验证**: 8 个 woff2 魔数 (wOF2) 校验通过; style.css 花括号/括号平衡 (1996/1996, 1395/1395); config.js/utils.js/rendering.js node --check 通过; 全量 grep 确认 CSS/JS/HTML 无残留裸 `font-family:monospace` 与游离 Inter/SF Mono 引用; 线上 curl 确认 fonts/inter-latin-400-normal.woff2 200 (application/font-woff2) + style.css 含 `@font-face` 与 `--font-mono` 新内容已发布; index.html 41 个 `?v=` bump 1785763308; 涉及 public/fonts/ style.css rendering.js config.js utils.js index.html CLAUDE.md docs/CHANGELOG.md
- **2026-08-03**: ⚖️ **转场遮罩节奏修正 (切入提速 + 切出遮住切换过程 + WS 残留根因)** — ①**用户反馈**: 上一轮「遮罩等待底层加载」方案实测「切入慢了切出快了 — 切出了, 侧面会话历史和当前的会话都还是 agent 模式下的, 还要等一下才切换出来」; ②**切入慢根因**: 进入遮罩 `_dismissOverlayAfter(mode, _enterLoad, 900, 3500)` — minWait 900ms + maxWait 3500ms; Agent 主会话 `_agent_main` 长期累积 (数百条消息含工具卡片/长文本, loadChat 逐条 appendMessage DOM 构建) 渲染常超 1s → 遮罩滞留感明显; ③**切出快根因 (双重)**: ①退出遮罩**近乎透明** — `playAgentExitEffect` 遮罩层 `background:rgba(0,0,0,0.15)` + `blur(6px) brightness(0.85)`, 用户能透见底层; ②恢复聊天仍等 `setTimeout(loadChat, 750)` — 退出动画 0.5s 播完后, 遮罩下侧边栏已展开 (updateAgentUI 同步执行, 显示 Agent 会话列表) + 聊天区仍是 Agent 会话 (loadChat 还没跑), 用户在遮罩淡出时看到的就是「还是 agent 模式的侧栏和会话」, 随后才切换 → 视觉上遮罩消失先于内容切换; ④**修复**: ①退出遮罩改**高不透明度深色实底**: `background:rgba(15,23,42,0.88)` + `blur(10px) brightness(0.6)` — 底层切换全程被遮住, 任何中间状态不可见, 也消除了「看到侧栏在展开」的干扰; ②退出恢复聊天从 750ms 提前到 **120ms** 立即开始 (`setTimeout(..., 120)`) — 遮罩已不透明, 不再需要等动画播完; loadChat/renderChatHistory/updateHeaderTitle 与遮罩动画并行执行, `_dismissOverlayAfter('exit:'+prevMode, _exitLoad, 500, 2000)` — 淡出时刻内容必然已切换完成; ③进入遮罩 minWait 900→**750ms** (进入动画实际 ~0.7s 完成: title-in 0.5s@0.1s + rings 0.6s + hex 0.68s), maxWait 3500→**1800ms** 兜底 — 加载快时 (~900ms) 比旧方案更快淡出, 加载再久 (大会话 2s+) 也在 1.8s 封顶, 不再有滞留感 (内容若未渲染完在遮罩后继续, 可接受); ④临时授权动效调用点 900/2500→700/1800; ⑤**顺带修复潜在根因 (WS 陈旧残留)**: 排查中发现 `agent-notify.js` WS 流 `done`/`error` 处理器只清内存变量 `window._wsStreamId/_wsChunkCount = null`, **从不清理 localStorage** 的 `_wsStreamId`/`_wsChunkCount` (content 事件每块写入, 流结束永不删除) → 陈旧值永久残留 → `loadChat` (dialogs.js:839) 的 WS 续接块 `if (_savedSid && _savedCnt > 0)` 恒真: ①`await` 轮询 WS 连接最长 **3s** (模式切换遮罩的 loadPromise 被拖住 = 切入慢的潜在放大器); ②WS 已连接时发送陈旧 resume 后 `return` **早退不渲染** (目标聊天 DOM 从不构建 = 切出后内容一直不切换的潜在根因) → done/error 处理器补 `localStorage.removeItem('_wsStreamId')` + `removeItem('_wsChunkCount')`; ⑤**验证**: tests/agent_chat_separation.test.js `testTransitionOverlayWaitsForLoad` 断言更新并全 PASS (进入 750/1800、退出 500/2000、遮罩 `rgba(15,23,42,0.88)` 不透明度、`}, 120);` 立即切换、WS `removeItem('_wsStreamId')` 清理); 既有 7 个测试文件保持绿; agent.js/agent-notify.js/tools-exec.js node --check 通过; 线上 curl 确认 agent.js (不透明度 + 750/1800 + 120ms) 与 agent-notify.js (WS 清理) 新内容已发布; ⑥**发布**: index.html 全部 41 个 `?v=` bump 1785763050 (期间并行会话改过版本号, 已统一); 涉及 agent.js agent-notify.js tools-exec.js tests/agent_chat_separation.test.js CLAUDE.md docs/CHANGELOG.md
- **2026-08-03**: 🎬 **Agent 模式转场遮罩等待底层加载完成再淡出** — ①**现象**: 启动/关闭 Agent 模式的全屏遮罩在后方聊天及元素加载完成前就消失, 视觉上"遮罩先退、内容后出"很割裂; ②**根因 (固定计时器 vs 异步加载)** : `playAgentEnterEffect` (agent.js:276) 进入遮罩固定 900ms 后自动淡出 (250ms 淡出), `playAgentExitEffect` (agent.js:296) 退出遮罩固定 650ms 后自动淡出 — 而底层 `loadChat` 是 **async** (消息渲染/历史构建可能数百 ms, 大会话更久): 进入时若 Agent 聊天渲染超过 900ms, 遮罩消失后聊天内容还在加载; **退出场景更糟**: setAgentMode 里恢复普通聊天是 `setTimeout(function() { loadChat(restoreId); ... }, 750)` — 遮罩在 650+200=850ms 处已消失, 而恢复聊天 750ms 才开始加载, 遮罩与内容加载完全错位; ③**修复**: ①新增遮罩淡出辅助 `_dismissOverlayAfter(key, loadPromise, minWait, maxWait)` (agent.js): 内部两个条件 — 「最短展示时间 `minWait` 已到 (进入/退出动画完整播完)」且「底层加载完成 (`loadPromise` resolve/reject 后 +150ms 渲染稳定帧)」— 同时满足才淡出 (0.25s opacity 过渡 + 250ms 后 remove); `maxWait` (默认 3500ms) 兜底 — 加载异常/卡死也强制淡出, 遮罩永不永久滞留; 快速切换模式时 `_clearAllAgentOverlays` 清除/重建遮罩 → `_tryFade` 用**元素引用比对** (`_e.el !== _el` 则放弃) 防误淡新遮罩; 淡出期把 fadeTimer 存入 `entry.timer` 保持 `_clearAgentOverlay` 可清理; ②两个特效函数删除固定自动淡出计时器, 改为 `_agentOverlayMap[key] = { el: overlay, timer: null }` (清除逻辑 `_clearAgentOverlay`/`_clearAllAgentOverlays` 不变, timer 为 null 时 clearTimeout(null) 安全); ③`setAgentMode` 接线 4 处: 进入 agent/yolo — 捕获 `_enterLoad` (无主会话时 `createAgentChat().then(...return loadChat(agentId))` 链式返回, 有主会话时 `loadChat(agentId)` 直取) → `_dismissOverlayAfter(mode, _enterLoad, 900, 3500)`; 进入 plan — 无聊天切换, `_dismissOverlayAfter('plan', null, 900, 2500)` 动画播完即淡; 退出 off — 750ms 恢复回调内 `_exitLoad = loadChat(restoreId)` 后 `_dismissOverlayAfter('exit:' + prevMode, _exitLoad, 650, 3500)`; 无恢复聊天 — `_dismissOverlayAfter('exit:' + prevMode, null, 850, 2500)`; ④`tools-exec.js:625` 临时授权动效调用点 (ask_agent 弹窗确认, 无聊天切换) 补 `_dismissOverlayAfter('agent', null, 900, 2500)` — 该调用点不走 setAgentMode, 无此接线遮罩将永不消失; ④**验证**: tests/agent_chat_separation.test.js 新增 `testTransitionOverlayWaitsForLoad` 源码断言组 (`_dismissOverlayAfter` 辅助定义 / 两特效 `timer: null` 无固定自动淡出 / enter 接线 `_dismissOverlayAfter(mode, _enterLoad, 900, 3500)` / exit 接线 `_exitLoad` / plan 接线 / `maxWait` 兜底 / tools-exec 临时授权调用点) 全 PASS; 既有 6 个测试文件保持绿; agent.js/tools-exec.js node --check 通过; 线上 curl 确认 agent.js (7 处引用) 与 tools-exec.js 新内容已发布; ⑤**发布**: index.html 全部 41 个 `?v=` bump 1785762391; 涉及 agent.js tools-exec.js tests/agent_chat_separation.test.js CLAUDE.md docs/CHANGELOG.md
- **2026-08-03**: 🖱️ **Agent 模式侧边栏手动展开修复 (三重解禁)** — ①**现象**: 上轮「Agent 模式历史记录」落地后, 用户反馈 Agent 模式下侧边栏手动无法展开, 点击无效; ②**根因 (三层叠加)**: ①**CSS 层** (style.css:3312): `.agent-active #sidebarToggle, .agent-active .header-menu-btn:first-child { opacity:0.4; pointer-events:none; cursor:not-allowed }` — 按钮渲染成半透明置灰, `pointer-events:none` 让点击事件**根本到不了 JS** (用户看到"点了没反应"); ②**JS 硬拦截层** (ui.js `toggleSidebar`): `if (isAgentToolsActive()) { showToast('Agent 模式下侧边栏已折叠'); return; }` — 即使事件到达也直接拒绝展开 (这是上轮之前为"Agent 模式禁止侧边栏"设计的旧行为, 与用户确认的「保持收起, 手动展开可见历史」新设计冲突); ③**状态刷新打回层** (agent.js `updateAgentUI`:1554): 「统一侧边栏: Agent/Plan/YOLO 收起, Off 展开」块在**每次** updateAgentUI 调用时执行 — 该函数被 setAgentMode/init.js 启动/SSE connected/agent:mode_changed/存储恢复等频繁触发, 用户手动展开侧边栏后, 下一次状态刷新立即检测到"非 off 且未收起"又强制 `add('collapsed')` — 展开被瞬间打回 (表现与点击无效无异); ③**修复 (三重解禁)**: ①style.css 删除整条禁用规则 (替换为说明注释, 按钮恢复全交互); ②`toggleSidebar` 删除 `isAgentToolsActive()` 提前 return 块 (桌面端 collapsed 切换与移动端 mobile-open 抽屉通用, 展开后即见 Agent 会话历史 — 上轮严格分隔已保证 Agent 视图只渲染 `_agent_main` + `_agent_old_*`); ③`updateAgentUI` 侧边栏块改为**模式切换门控**: 新增模块级 `_lastSidebarSyncMode` 标记, `if (_lastSidebarSyncMode !== mode)` 才执行收起/展开 — 仅在模式切换 (off↔agent/plan/yolo) 时强制一次, 心跳/SSE/通知等状态刷新不再覆盖用户手动展开的侧边栏; 进入 Agent 模式自动收起的行为保留 (setAgentMode:99-104 + init.js 启动路径); ④**验证**: tests/agent_chat_separation.test.js 新增 `testSidebarManualExpand` 源码断言组 (ui.js 无「Agent 模式下侧边栏已折叠」禁止分支 + 有「Agent 模式允许手动展开」注释; agent.js 含 `_lastSidebarSyncMode` 门控; style.css 无 `.agent-active #sidebarToggle` 禁用规则 — 注释措辞避开断言字符串) 全 PASS; 既有 6 个测试文件保持绿; agent.js/ui.js/style.css node --check 通过; 线上 curl 确认三文件新内容已发布; ⑤**发布**: index.html 全部 41 个 `?v=` bump 1785761719; 涉及 ui.js agent.js style.css tests/agent_chat_separation.test.js CLAUDE.md docs/CHANGELOG.md
- **2026-08-03**: 🔀 **Agent 会话与普通聊天严格分隔 (串域根因 5 类 12 处 + Agent 模式历史记录功能)** — ①**用户报告**: Agent 模式会话莫名跑到普通聊天里 (普通历史列表/普通视图), 且 Agent 会话消失; 要求 Agent 模式重新启用历史记录, 与普通聊天分隔开 (已确认 UX: 进入 Agent 模式侧边栏保持收起手动展开; 严格分隔 — Agent 视图只显示 Agent 会话, 普通视图只显示普通聊天); ②**根因类 1 — 历史列表泄漏**: `renderChatHistory` (dialogs.js) 只过滤 `_agent_main`, `_agent_old_*` 归档会话 (📦 前缀) 全显示在普通列表; 普通列表为空时还把 `_agent_main` 兜底显示出来 (两处重复兜底块) → 用户点进即"Agent 会话出现在普通聊天"; **根因类 2 — /new 静默覆盖 (会话消失主因)**: `createNewChat` 归档条件要求 `currentChatId === '_agent_main'`, Agent 模式下当前是归档会话/其他聊天时按 /new, 旧 `_agent_main` 被**无条件覆盖** (对话永久丢失, 无归档无服务器副本); **根因类 3 — 恢复/兜底路径串域 (12 处)**: `restoreUserData` lastChatId 逻辑只处理 `_agent_main` 不处理 `_agent_old_*`、fallback `firstKey` 按 updated_at 排序可选中 Agent 会话; 服务器合并清除循环 (5 分钟本地残留清除) 只豁免 `_agent_main`, 归档会话被本地删除; `setAgentMode` 退出恢复候选只排除 `_agent_main`; `init.js` Agent 模式激活时 `createAgentChat([])` **无条件覆盖 `_agent_main`** (刷新时查看归档会话场景直接毁掉主会话) + 普通模式 `loadChat(last)` 无域过滤; `deleteChat` 兜底 `else if (chats['_agent_main']) loadChat('_agent_main')` 普通模式删光聊天后打开 Agent 会话; SSE `chat:deleted` 兜底与 `ensureChatExists` 任意 key; `cleanupOldChats` 按 `parseInt(id.split('_')[1])` 排序 Agent id 解析 NaN 排最前**先被删**; **根因类 4 — 任务回复串域**: `_triggerMainAgentForTask` (agent.js:2428) 强制切换 currentChatId 到任务聊天 (用户已退出 Agent 模式也被拽回); `_pendingAgentReply` (main.js:4361) 在**任意** sendMessage finally 消费, 把「整合子代理结果」发进 currentChatId (无模式切换要求 — 只要目标聊天忙, 任何其他聊天收尾都会触发); `_doTrigger` 兜底 (agent.js:2522) 把无主结果绑到 currentChatId; **根因类 5 — 墓碑陷阱**: `_agent_main` 有删除按钮时删除会写 `_deletedChatIds` 墓碑, 而 setAgentMode/createNewChat 持续重建本地副本 → 服务器永不回同步; ③**修复**: 新增公共助手 `window.isAgentChat(id)` (core.js: `_agent_main` + `_agent_old_` 前缀, 全局 25 处统一使用); **Fix A 历史列表严格分隔**: `renderChatHistory` 按 `isAgentToolsActive()` (agent/yolo) 过滤 — Agent 视图只显示 Agent 会话, 普通视图只显示普通聊天 (plan 模式保持普通视图), 删除两个 `_agent_main` 空列表兜底块, `_agent_main` 不渲染删除按钮 (防墓碑陷阱), Agent 视图归档标题去 📦 前缀 (显示层), `_inheritChatContext` 排除 Agent 归档; **Fix B /new 永不丢会话**: 归档条件改 `getAgentMode() !== 'off' && _agent_main 有 >1 消息` (不论当前聊天), 新建后防御性清除 `_deletedChatIds['_agent_main']` 墓碑; **Fix C 恢复/兜底 9 处**: storage.js lastChatId 路由矩阵 (off+Agent id→lastNormalChatId; Agent 视图+普通 id→`_agent_main`; fallback 按域过滤, 无则 createNewChat) + 模式重应用后域校验 + 清除循环豁免 `isAgentChat`; agent.js 退出恢复候选 `!isAgentChat`; init.js `createAgentChat` 仅在 `chats['_agent_main']` 缺失时调用 (防覆盖) + 普通模式 loadChat/空对话复用域过滤; deleteChat 兜底按域过滤 + updated_at 排序 + 空则 createNewChat (删光普通聊天不再打开 Agent 会话); SSE chat:deleted 与 ensureChatExists 同域最新选取; cleanupOldChats 排除 Agent 域; **Fix D 任务回复路由**: `_triggerMainAgentForTask` 仅同域切换 (`isAgentToolsActive() === isAgentChat(chatId)`), 跨域不切换不发送 (系统消息仍无条件追加到任务聊天 + saveChats, 内容不丢, toast「子代理已完成, 可在 X 模式查看」); `_pendingAgentReplyChatId` 设置/消费双端校验 (意图聊天=当前才发; 同域跨聊天 loadChat 切回再发; 跨域跳过); `_doTrigger` 兜底绑定矩阵 (Agent 视图绑当前; off+临时授权匹配绑当前保活 ask_agent 流程; 其余绑 `_agent_main` 不注入普通聊天); resume-stream `resumePending` 优先选同域待续聊天; **Fix E** 删除 storage.js `_agent_main.messages` push/splice console.trace 调试 monkey-patch 残留; ④**验证**: 新增 `tests/agent_chat_separation.test.js` 8 组用例 (vm 沙箱 + 真实源码提取: isAgentChat 判定矩阵 / renderChatHistory 过滤矩阵 / lastChatId 路由矩阵 8 场景 / createNewChat 归档决策 (Agent 模式+非当前聊天按 /new 仍归档 — 旧逻辑丢失) / _triggerMainAgentForTask 跨域决策矩阵 / _pendingAgentReply 消费路由 4 场景 (含跨域跳过) / _doTrigger 绑定矩阵 / 清除豁免源码断言) 全 PASS; 既有 5 个测试文件保持绿; 9 个改动文件 node --check 通过; grep 断言 (renderChatHistory 不再排除 `_agent_main` / 全部 25 处域判断走 isAgentChat / init.js createAgentChat 在缺失分支 / _pendingAgentReply 双端带 chatId); 线上 curl 确认 core.js/dialogs.js/storage.js 新内容已发布; ⑤**发布**: index.html 全部 41 个 `?v=` bump 1785761294; 涉及 core.js dialogs.js storage.js agent.js init.js agent-notify.js utils.js main.js resume-stream.js tests/agent_chat_separation.test.js(新) CLAUDE.md docs/CHANGELOG.md
- **2026-08-03**: 🔍 **模型死循环检测机制 (loop-guard 双端: 前端 LoopGuard + 引擎子代理 LoopGuard)** — 小参数模型(垃圾模型)易陷入死循环白白烧 token (真实案例: 单轮 76 个相同 video_download → 79 个重复 aria2 任务); 现状防护只有 maxToolCalls=1000 硬上限(太大) + 同轮去重 + 5 个下载类工具跨轮跳过, **无跨轮重复频率统计/振荡检测/文本复读检测**; ①**前端新模块 `public/js/loop-guard.js`** (纯 JS 无 DOM, Node 可测): `window.LoopGuard` 类 + `normalizeToolCallArgs` 参数规范化 (递归剥离 volatile 字段 — time/ts/nonce/random/sign 等键名 + 10-13 位数字/ISO 时间值, 键排序, 数字与字符串不互转"宁可漏判不可误判", >2000 字符 FNV-1a 哈希截断); 6 个检测器: **a 工具重复** (相同 name+规范化参数 ≥3 次 → soft), **b 工具振荡** (最近 6 次仅 2 种工具各≥2 且窗口内正文零增长 → soft), **c 连续纯工具轮** (≥6 轮无正文只调工具 → hard), **d 正文复读** (≥400 字符后周期检测: 尾 200 字符窗口存在 8~100 字符重复周期同相位相同率 ≥97% → hard; 窗口定位法受 windowSize mod 周期相位错位影响漏检, 改用周期检测对任意相位鲁棒; 97% 阈值区分真复读≈100% 与模板文本≈95%), **e 推理死循环** (正文为 0 + 推理自身复读; 或推理 ≥8000 字符正文仍 0 兜底), **f 无进展** (总输出 ≥2000 字符但 8 字符块唯一率 <30%); 软升级: 软触发 ≥3 次未收敛 → hard; ②**前端接线** (main.js): 会话级 guard 存 `window.__loopGuardMap[chatId]` (sendMessage 创建, finally 在 `_myReqGen` 新请求保护后释放); 每轮 normalizedToolCalls 构建后 `recordToolCall`×N + `recordRound` + `check()` hard 即 `_throwGuardHard` (abort 在途请求 + 抛带 `e.loopGuard` 标记的 LoopGuardError); **软跳过**在工具执行循环内 (复用 `_oneShotTool` 3164 注入管线, tool_call_id 配对约束: 注入结果与真实结果走同一 push, buildApiMessages 不会剔除) — `isDuplicateTool`/`oscillationActive` 命中 → 不执行, 注入「【系统提示】系统检测到…该调用未执行。请立即停止调用工具…」; 软告知追加到 body 最后一条 tool 消息 + chats 历史双写 (同 _guardNote 模式); **硬处理**: stream-handler.js `_guardFeed` 统一埋点 6 处 (SSE 正文 237/SSE 推理 247/推理_details 780/推理_content 811/正文 870/流结束 1153 补检 + handleNonStream 全文检测), hard 触发 reader.cancel() + 抛 LoopGuardError; main.js 2657 流式 catch 最前面 `if (streamErr.loopGuard) throw` (防止误判网络错误走非流式降级白烧一次 token); 4155 外层 catch 最前面分发 (不再重试): handleError + `.error-detail` 详情区块 (触发原因/模型名/耗时/本轮 tokens/建议: ①切换更强模型 ②清空上下文重新发送 ③设置→Agent 模式关闭检测); ③**配置 UI**: Agent 设置区新增 3 项 (死循环检测开关 loopGuardToggle 默认开 + 重复调用阈值 loopGuardMaxRepeat 默认 3 + 纯工具轮阈值 loopGuardMaxToolOnlyRounds 默认 6), config.js saveConfig + init.js initAgentConfig 三件套持久化; ④**引擎端** `python/engine/loop_guard.py` (与 JS 同策略): `_run` 子代理循环集成 — 1405 工具循环内 `record_tool_call` skip → 注入提示 + `_force_summary` 压缩轮次到最终总结轮 (复用 _is_final_round 机制), 轮末 `record_round` abort → 终止, `feed_text` 复读 → 追加说明 + 压缩轮次; `agent:warning` SSE 广播告警; workflow.py 同模式 (不执行真实工具, 意义是提前 break 停止调 API); ⑤**测试**: `tests/loop_guard.test.js` 12 组用例 (volatile 剥离/重复/软升级/振荡 ABABAB+AABBAA+3 工具轮转不命中/纯工具轮/复读/推理死循环/无进展/合法多搜索不误杀/阈值覆盖/禁用/长参数哈希) + `python/tests/test_loop_guard.py` 15 项; ⑥**验证**: Node 5 文件全 PASS, Python 69 项 unittest OK, CDP 实机 — 页面加载 LoopGuard 挂载 + 0 JS 错误 + 配置 3 控件渲染, 检测器驱动验证全过 (重复 soft 1 次触发+isDuplicateTool true / 复读 repeat-text|hard / 纯工具轮 tool-only|hard / 8 次不同关键词搜索 null 不误杀 / 开关默认开启), 引擎 pm2 restart 健康检查 OK; index.html 41 个 `?v=` bump 1785760178; 涉及 loop-guard.js(新) main.js stream-handler.js config.js init.js index.html python/engine/loop_guard.py(新) engine_server.py workflow.py tests/loop_guard.test.js(新) python/tests/test_loop_guard.py(新)
- **2026-08-03**: 🔧 **刷课 AI 答题配置同步修复 + 联网搜索增强 (ai_sync 服务器配置源 + Tavily 搜题)** — ①**现象**: 刷课面板「同步」按钮总是同步到过时配置; AI 模型列表只有 deepseek 两个旧模型; 不能完整同步主客户端 (多提供商/跨设备) 配置; AI 答题无联网搜索能力; ②**根因**: ①`syncAIKey()` 数据源是 `localStorage.apiKey` + `_getBaseUrl()` 读 `localStorage.baseUrl` — 主客户端已演进为**服务器端多配置存储** (`users/{uid}_config.json`, 多用户隔离、跨设备同步), localStorage 是旧版单 key 存储, 服务器/其他设备更新后本地残留过时值 → 同步即过时; ②`syncModels()` 用 localStorage 的 baseUrl 拉 `/models`, 失败 fallback **硬编码 `deepseek-chat`** — 用户主配置 baseUrl (如 oneapi 中转) 下应拉的模型列表完全没同步; ③`AI._query()` 只发单次 LLM 请求, 无搜索能力; ③**修复 (后端)**: `chaoxing_api.php` 新增 `action=ai_sync`: 读 SQLite `user_config` 表 (chat.php save_config 实际存储, JSON 文件兜底 — 首次实现误读 `users/{uid}_config.json` 文件, 用户保存后同步仍提示「未保存」, 已修正为 DB 优先), `decrypt_config_key()` 解密 (apiKey 按 baseUrlProvider 映射取 apiKeyDeepseek 等 v2 加密键, 通用 apiKey 兜底; 搜索 key 按 searchProvider 选 searchApiKeyTavily/searchApiKeyBrave/通用 searchApiKey), 返回 `{base_url, api_key, model, search_key, search_enabled}`; `save_tiku`/`tiku_config` 透传新字段 `ai_search`/`ai_search_key`; ④**修复 (前端 chaoxing.html)**: `syncAIKey()` 改调 ai_sync (不再读 localStorage), 同步后带服务器配置刷新模型列表; `loadTiku()` 在刷课配置无 AI 参数时自动从 ai_sync 兜底; `syncModels(baseUrl, key)` 支持外部传入同步配置, 仅最后回退 localStorage; 表单新增「AI 联网搜索 (Tavily)」开关 + 搜索 Key 输入框; ⑤**修复 (answer.py)**: `AI._query()` 联网搜索增强 — 配置 `ai_search=1` 且 `ai_search_key` 有效时, 先 `POST api.tavily.com/search` 搜题 (max_results=4, 摘要截断 300 字符) → 搜索结果拼入 prompt → AI 回答; 搜索失败/无结果/无 key 均降级普通 AI 答题, 不影响答题链路; ⑥**验证**: mock 全链路 (言溪失败 → Tavily 搜索到资料 → AI 返回正确选项 A) 通过; PHP v2 加密值经 decrypt_config_key 还原明文; `save_tiku`→`tiku_config` 新字段写入/读回一致 (测试后配置已恢复备份); root 账号 SQLite 真实配置同步出明文 DeepSeek key + 真实 Tavily key (tvly-dev-...) + 当前模型 deepseek-v4-flash, 模型列表用同步 key 拉取真实可用; ai_sync 端点无配置时返回空 (前端提示); chaoxing.html 内联 JS node --check 通过; ⑦**注意**: 主客户端配置存储位置 = SQLite `users/oneapichat.db` `user_config` 表 (chat.php save_config 写入, config.php 的文件存储是另一套旧路径, 切勿混淆); 运行中的刷课进程持旧代码, 下次刷课生效
- **2026-08-03**: 🛠️ **八项全面修复 (v4.3: 粗光标根因/空占位/链接弹app/侧边栏统一/蕾米恢复/图表放大/密钥暗色/缓存多模型)** — 用户批量反馈 8 项 UI 问题 + 1 项统计问题, 逐项定位与修复: **①搜索后「气泡末尾粗彩色光标」真实根因 (CSS 属性泄漏)**: 搜索流程中气泡同时持有 `typing` + `streaming` + `gen-active` 三类 — 两个 `::after` 规则同时命中时, **CSS 特异性决定只取 typing 规则** (`.bubble.assistant.typing .markdown-body::after` 4 类 > `.bubble.streaming` 3 类), 而 `typing` 规则的 `width:1.5em`(25px) 与 `font-size:1.2em`(16.8px) 生效、`content` 被 `typing-dots` 动画 (0-20% 帧置空) 清空、`background` 取 streaming 规则的渐变 → **25×17px 粗紫蓝渐变块**在气泡末尾闪烁 (CDP 实测: sim-b 气泡 `::after` width=25.1875px height=16.7969px + linear-gradient) — 用户看到的就是这个"粗彩色光标"; 修复: ①双规则改**互斥选择器**: `typing` 规则加 `:not(.streaming)`, `streaming` 规则加显式 `content/width/height/background !important` 重置 (init.js injectStyles + style.css 2836 两处同步); 修复后同状态 `::after` = 2px×14px 细渐变竖线 (CDP 断言); **②「上方气泡光标残留, 只有刷新才消失」**: `_streamState[chatId]` 是单槽 — 新流 `applyStreamRender` 会把 `st.bubble` 重绑到新气泡, 旧气泡的 `streaming` 类不再被任何 cleanup 路径触及; 且多个收尾路径删类不全: ①markdown.js `cleanupStreamState` 只删 streaming/gen-active 不删 typing; ②链式模式每轮收尾 (main.js:3449) 只删 typing; ③402 降级/工具降级/解析失败/abortExistingRequest 路径不删 streaming; 修复: ①cleanupStreamState 补删 typing; ②完成路径 (main.js:3528) 改为**全量清扫**容器内所有气泡三类的残留 (DOM 只渲染当前聊天, 全局清扫安全) + 当前气泡单独清; ③链式轮收尾/402降级/工具降级/解析失败 (stream-handler:1059)/abortExistingRequest (activeBubbleMap 删除前) 全部补删三个类; **③无正文空气泡 → 灰色 `(empty)` 占位**: 用户明确要求"正文为空就显示一个灰色的 (empty) 占位" — `_ensureEmptyBubbleHint` 文案由「已完成深度思考/已执行工具调用」改为字面 `(empty)` (灰色斜体 0.85 透明), 流式结束/非流式完成双路径接入不变; **④点击网站不弹到 app**: PWA standalone 独立窗口下, 聊天内 `target="_blank"` 外链会切换出 app 窗口 (iOS/Android 安装场景) → init.js 新增委托点击拦截: `navigator.standalone || matchMedia('(display-mode: standalone)')` 命中时, 非站内 http(s) 链接 `preventDefault` + **当前窗口内打开** (`location.href`, 返回键回聊天), 站内链接/下载链接/`_self` 保持原行为; 验证: mock matchMedia → 点击外链 `defaultPrevented=true` 且不弹新窗口; **⑤移动端侧边栏「功能」块风格统一**: `.sidebar-mobile-actions` 由 Tailwind 平铺列表 (gray-200 hover, text-gray-400 标签) 改为与下方「偏好设置」同款**玻璃卡片** (亮 0.55 白/暗 0.035 白, 1px 边框, 14px 圆角, blur(8px), 10px 12px 外边距), 「功能」标签改 `.sidebar-mobile-actions-head` (11px 加粗 + **渐变指示条** `::before` 3px 紫蓝, 同 .sidebar-preferences-head 语言), 按钮 12px/500 字重 + indigo SVG 图标 (暗色 indigo-300), hover/active 保留主题色淡填充; 验证 (CDP 390px 仿真): display block, bg 与 prefsBg 完全一致 rgba(255,255,255,0.035), radius 14px, head 11px + 渐变条, btn 12px; **⑥蕾米小窗刷新后消失**: `remiZoomOpen` 是 IIFE 内局部布尔, 刷新即失 → localStorage 持久化: 打开写 `remiZoomOpen='1'`、关闭删除, 拖动结束写 `remiZoomPos` (left/top), openRemiZoom 恢复时应用; 页面加载后若标记存在 → 轮询等头像就绪 (200ms×40 ≈ 8s) 自动 `openRemiZoom()`; 验证 (CDP): 打开→reload→小窗自动重开 + 位置 300px/200px 恢复; **⑦Mermaid 图表 + K线图无法放大**: 灯箱 `showImageLightbox` 原本只绑在 generatedImages (appendMessage/工具生成) — markdown 渲染的图片 (K线 PNG) 与 mermaid SVG 无任何点击处理 → init.js 新增委托监听: ①`.mermaid svg` 点击 → 克隆 SVG (固定 800×600 底) 序列化 `data:image/svg+xml` data URL 进灯箱 (滚轮缩放/拖拽平移/下载全复用); ②`.markdown-body img` 点击 → 整组图片进灯箱可翻页 (跳过 `.generated-images-container` 已绑灯箱的图与 `<a>` 内图片); CSS: `.mermaid svg` 加 `cursor:zoom-in` + hover 0.9; 验证 (CDP): 注入 kline img / mermaid svg → dispatch click → `.img-lightbox` 出现, mermaid 灯箱 src 以 `data:image/svg+xml` 开头; **⑧API 密钥区暗色修复 (两处)**: ①密钥列表条目 `.api-key-item` 内联 `background:#f9fafb` (近白) → 类化: 亮色 #f9fafb / 暗色 rgba(255,255,255,0.06) + 边框, 名称色亮 #374151/暗 #e5e7eb, 撤销按钮暗红变体 (rgba(239,68,68,0.12)); ②**「创建新密钥」按钮暗色太亮根因**: index.html 用 `dark:bg-indigo-900/20 dark:text-indigo-400` 但**项目 Tailwind 是裁剪构建** — 实测 style.css 中 `dark:bg-indigo-900/20`、`dark:bg-indigo-900/30`、`dark:text-indigo-400` **全部不存在** (grep 0 命中), 暗色下回退到亮色 `bg-indigo-50` → computed `rgb(238,242,255)` 亮底; 修复: CSS 属性选择器 `button[onclick*="showCreateApiKeyDialog"], button[onclick*="showCreateSkillDialog"]` 显式双主题 (亮 indigo-50/600 保持原设计, 暗 rgba(99,102,241,0.12) 底 + indigo-300 字, hover 0.22 + indigo-200); 验证 (CDP): 暗色 bg rgba(99,102,241,0.12)/color rgb(165,180,252), 亮色无回归; **⑨缓存命中率只对 DeepSeek 生效 → 全模型**: `sessionUsage` 累计 (main.js 3 处) 只认 `prompt_cache_hit_tokens` (DeepSeek) 与 `prompt_tokens_details.cached_tokens` (OpenAI), **Anthropic `cache_read_input_tokens` 与 Gemini `promptTokensDetails[].cachedTokenCount` 完全没接** → 用 Claude/Gemini 时用量面板缓存命中率恒不显示; 修复: core.js 新增 `window._extractCacheHit(usage)` (DeepSeek/OpenAI/Anthropic/Gemini/Grok 顶层 cached_tokens 5 格式) + `window._extractPromptTokens(usage)` (命中率分母基数, 兼容 input_tokens/inputTokenCount/promptTokensDetails), main.js 3 处累计与 rendering.js `_buildMsgFooterHtml` 页脚提取全部换用 helper; 验证 (CDP): 6 格式提取全对 (100/40/33/60/22/0), 分母提取 Gemini 80/Anthropic 90; **⑩发布**: index.html 全部 40 个 `?v=` bump 1785759325; 涉及 init.js (standalone 链接/灯箱委托) style.css (光标互斥/侧边栏卡片/密钥类/创建按钮) markdown.js (cleanup typing) stream-handler.js (解析失败补删/占位文案) main.js (完成清扫/链式/降级/abort/缓存 helper) core.js (提取 helper) rendering.js (页脚 helper) config.js (密钥条目类化) model-status.js (蕾米持久化) index.html (功能块头类) CLAUDE.md; 全部修改 JS node --check 通过
- **2026-08-03**: 🛠️ **工具全面审查修复 (股票K线东财lmt废弃+IP风控双数据源冗余, 高德路径规划字段名/JSON body/poiId 三重bug, indicators 500)** — 基于全量工具测试报告 (46正常/9异常) 深度审查修复: **①股票K线「未找到数据」根因 = 东财废弃 lmt 参数**: push2his kline 带 `lmt=5` 一律返回 `{"rc":102,"data":null}` (实测三种 UA 变体全 102), 换 `beg/end` 形式立即 rc:0 返回完整数据 → get_kline 弃 lmt 改按周期粗估计算 beg (daily count×1.8+30天/weekly×7+30/monthly×31+30/分钟线15天) 拉取后截取末尾 count 条 (实测 daily 120 条/5min 60 条/weekly 30 条全过); **②东财 IP 风控 (测试当日高频触发)**: push2 域名对高频 IP 302→push2delay (延时行情服务器), push2his 直接连接被拒 (http:000) → 三层冗余: ①`_http_get` 东财主域名失败自动改走 **push2delay** 重试 (实测 clist 板块接口经 push2delay 正常返回 30 板块); ②新增**腾讯行情 fallback** (`_kline_tencent`/`_realtime_tencent`): 日/周/月K走 `web.ifzq.gtimg.cn/appstock/app/fqkline/get` (**参数须 6 字段** `symbol,period,,,count,adjust`, 5 字段报 param error; 日K第7元素可能是 dict 须防), 分钟K走 `ifzq.gtimg.cn/appstock/app/kline/mkline`, 实时走 `qt.gtimg.cn` (字段 3/4/5/31/32/33/34/36/37/38/39/43/44/45), 东财失败快速接管 (实测东财风控期间 daily/weekly/monthly/5min/realtime 全部经腾讯返回); ③Retry 改 `connect=0` (风控特征连接被拒不重试立即失败) + curl 兜底 3→2 次 (风控时 ~5s 内到达 fallback); **③sector_flow 小单字段复制 bug**: `small_inflow` 误复制 `f62` (主力净流入), 改 `f70` + fields 补 f70; **④indicators 500 根因 (starlette allow_nan=False)**: KDJ 除零产生 **±inf** (pd.notna 不识别) 且 float64 列存 None 会转回 NaN → to_dict 后逐值 `not math.isfinite(v) → None` (MA60 前段 NaN 正确变 null); **⑤PROJECT_ROOT 少一层 (同 server_tools.py 老 bug)**: `Path(__file__).parent.parent` 只到 `python/`, 图表存到 `python/uploads/stock_charts/` (URL `/oneapichat/uploads/...` 404) → 改 `parents[2]` + 迁移旧图 + 目录 chown naujtrats:www-data 775 (uploads 属主 www-data, 引擎 naujtrats 创建目录 PermissionError 曾致 PM2 重启循环 69 次); **⑥高德三重 bug**: ①driving/walking/bicycling 取 `$result['routes']` 但高德实际返回 **`route` 单数** (骑行是 `data`) → 永远空 data; 修复取正确字段 + 新增 `amap_route_summary` 摘要 (distance/duration/strategy/steps); ②schema_personal_map 「缺少参数」根因 = 前端/MCP 以 **application/json POST** 而 PHP `$_POST` 只解析 form-urlencoded → 补 `php://input` 读取; 且高德 WIA 2026-08 起 **poiId 必填** (工具描述原标"可选") → 缺失时按名称自动 `place/text` 搜索补全 (带坐标取最近 POI), 仍缺则报明确错误; ③**PHP foreach 引用 + ?? 拷贝陷阱**: `foreach ($line['pointInfoList'] ?? [] as &$pt)` — `??` 令数组值拷贝, 引用迭代绑定到副本, 赋值写不回原数组 (实测函数返回 id 但 lineList 无 poiId) → 中间变量 + 显式写回; ⑦bicycling 服务端 SERVICE_NOT_AVAILABLE (非代码问题, 高德需开通骑行服务) 中文提示; ip_location 对公共 DNS IP 高德返回空数组 → 明确提示「无法定位」而非静默空; around_search 连续 3 次实测正常 (此前偶发为高德限流); **⑧运维发现**: 引擎实为 **PM2 管理** (`oneapichat-engine`, 非 CLAUDE.md 所述 systemd service; root/naujtrats crontab 均无 engine_watchdog), 手工 nohup 启动会与 PM2 抢端口触发重启循环 — 修复统一由 pm2 restart; **⑨验证**: 引擎端点 8/8 全过 (kline 腾讯源/indicators 5行无 NaN/图表 URL 200 可访问/sector_flow 30 板块/实时/龙虎榜/北向/诊断), Python 25 项 unittest OK, PHP lint OK
- **2026-08-03**: 🗂️ **Cloudreve 云盘全面结合 (镜像同步架构, 上传/下载/生成全链路自动入云盘)** — ①**架构决策**: Cloudreve v4 同机 Docker (127.0.0.1:5212), 本地存储物理路径 `/opt/cloudreve/data/uploads/{uid}/...`; 探明 v4 DB 结构 (files 即文件夹/file_children 层级/entities.source 物理路径/upload_session_id/recycle_options props) 复杂且随版本演进 → **放弃直插 DB 零拷贝** (风险高), 采用**镜像同步**: 本地 uploads/ 存储与 URL 完全不动 (聊天历史永久链接零回归), 每个文件产出点追加"官方 API 分片上传到用户 Cloudreve 账号" (loopback 传输 1GB≈1-2s, 磁盘 739G 充足); ②**账号绑定三级解析** (`cr_ensureAccount`): ①用户面板绑定过的凭据缓存 `/tmp/cloudreve_login_{md5(userId)}.json` → ②邮箱匹配已有缓存凭据 (root 的 xyq070519@gmail.com = 主账号 13) → ③确定性桥接账号 `{userId}@oneapichat.local` (密码 sha256 离线推导, 自动注册, 复用 auto_login 方案); ③**云盘目录结构**: 每用户 `OneAPIChat/uploads` (聊天上传) / `OneAPIChat/downloads` (网盘·视频·B站下载) / `OneAPIChat/generated` (文档·PPT·音频生成); ④**新增 `api/cloudreve_lib.php` 公共库**: 从 cloudreve_api.php 抽取 curl 助手/Token 管理/分片上传 (cr_uploadLocalFile) + 新增 cr_probe (1.5s 探活防阻塞) / cr_ensureAccount / cr_ensureFolder (递归建目录) / cr_importFile (高层入口: 探活→账号解析→目录确保→分片上传, 空 userId=主账号); cloudreve_api.php 新增 `action=import_file` (auth_token 认证或 cr_shared+user_id 内部通道, 供引擎/bridge 调用); ⑤**接入点 7 处**: upload.php (上传后同步, 失败降级仅记日志, 响应带 cloudreve 状态字段); netdisk_api.php (aria2 成功后按 userId 导入, 无文件名时取目录最新文件); engine_server.py (`_import_to_cloudreve` 辅助 + _doc_output/docx/xlsx/pdf/ppt GET 路由/generate_ppt tool 分支, ⚠️**必须禁代理** — 引擎全局 session 走 socks5h://127.0.0.1:1081 (Mihomo), 127.0.0.1:443 经代理 SSL EOF 报错, 加 `proxies={"http":None,"https":None}`); video-hunter-bridge.py (_download_worker 加 user_id 参数, 完成导入); download-monitor.py (bili 独立监控进程, --user-id 参数 + urllib 导入); bilibili-download-bridge.py (start_ytdlp_download 透传 user_id); server.js (mmx speech/music 生成后 fire-and-forget 导入主账号); ⑥**用户上下文透传**: engine_api.php video_hunter/bilibili_bridge 代理注入 `user_id` (顶部已有 $userId), tools/call.php 对 video_download/bili_download/bili_download_dash/netdisk_download/netdisk_parse_and_download 注入 (MCP server 不校验未知参数, schema 无需改); ⑦**顺带修复**: netdisk_api.php 认证 bug — sessions.json 真实结构是 `{token: {user_id, created_at}}`, 旧逻辑遍历找 `$sess['token']` 永远匹配不到 → $userId 恒为 null (下载无法按用户隔离), 改为 SQLite sessions 表优先 (与 verifyAuthToken 同源) + JSON 回退; ⑧**存量迁移**: `api/cloudreve_migrate.php` CLI 脚本 (--user 指定用户/--category=downloads 迁移共享目录到主账号), 实测小用户 22/22 成功; ⑨**验证**: import_file 桥接账号自动创建 (u_54e32386→云端 id 44) / upload.php 图片上传 cloudreve 字段 synced=true / netdisk 真实下载 (baidu robots.txt) 自动导入 / docx 生成自动导入 / video_hunter 经代理下载完成自动导入, 全部落库 owner 正确 + 测试文件清理; list_files/ping/delete 回归正常
- **2026-08-03**: 🐛 **刷课答题链修复 (言溪失败不回退 AI + 占位符 key 静默 + 言溪解析 KeyError)** — ①**现象**: 刷课答题时言溪题库失败 (token 未配置, 日志「剩余查询数100:消息:请求失败」) 后**直接随机选择**, 配置的题库链 `provider=TikuYanxi,TikuAI` 形同虚设, AI 答题从未被调用; ②**根因一 (链式题库从未工作)**: `Tiku.query()` 父类方法自身 `_query()` 失败后直接 `logger.error(...)` + `return None`, **从不调用 `self._fallback.query(q_info)`** — `set_fallback()` 构建的链 (言溪→AI) 只赋值不消费, fallback 是死代码, 失败永远落到调用方的 `random_answer()`; ③**根因二 (占位符 key 静默)**: `AI._query()` 只检查 `if not api_key` — 配置占位符「你的DeepSeek API Key」非空, 于是带着无效 key 发真实 401 请求, `except Exception: pass` 静默吞掉, 日志无任何 AI 痕迹; ④**根因三 (潜在 KeyError)**: `TikuYanxi._query()` 失败分支 `'次数不足' in res_json['data']['answer']` 直接索引, 若 API 失败响应 data 无 answer 字段 (格式变化) 则 KeyError 崩溃 (mock 实测复现); ⑤**修复**: ①`Tiku.query()` 失败后 `if self._fallback: return self._fallback.query(q_info)` (递归多级链, 链尾仍失败才返回 None); ②`AI._query()`: key 为空或含「你的」识别为未配置 → `logger.error('AI答题未配置有效 api_key（请在刷课设置填写 AI Key，如 DeepSeek）...')` 直接跳过不发请求; 请求 HTTP 失败/异常也记录原因 (原静默); ③言溪失败分支改 `(res_json.get('data') or {}).get('answer','')` 防御; ⑥**验证**: 模拟全占位符配置 → 言溪失败日志 → 「言溪题库未命中，回退查询 AI答题...」→ AI 明确提示未配置 → 返回 None (调用方随机, 但链路正确可定位); 注入有效 key + mock 言溪失败/AI 200 → 正确返回 A 并写缓存; data 无 answer 字段不再 KeyError; ⑦**说明**: 运行中的刷课进程仍持旧代码 (Python 已加载), 修复下次刷课生效; 要启用 AI 答题需在刷课设置填写真实 AI Key (如 DeepSeek)
- **2026-08-03**: 🎨 **气泡主流化 round 3 + 面板输入框字体统一 (v4.2)** — ①**记忆系统"文字位置不统一"真实根因 (CSS 重复块)**: 用户反复反馈记忆系统文字与其他部分不统一 → CDP 几何对比发现 `#memoryKeyInput` computed `font-size:14px` 而参考段 select 12px; 级联追踪 (getMatchedStylesForNode) 定位: style.css 存在**两个 `.config-input` 规则** — 标准块 1242 行 (`font-size:12px; padding:8px 12px; border-radius:8px; focus=border+shadow`) 与**旧版重复块 2071 行** (`font-size:0.875rem`=14px; `padding:0.375rem 0.75rem`=6px 12px; `border-radius:0.375rem`=6px; `focus=outline`), 2071 在后覆盖 1242 → 全面板普通文本输入框 (apiKey/baseUrl/记忆键/内容等) 全是 14px, 而 select 因 `.config-select { font-size:12px !important }` 保持 12px → **输入框 vs 下拉框字体不一致** (记忆系统两个输入框最显眼, 用户感知"记忆系统文字不统一"); 修复: 删除 2071 重复块 (及其 .dark/focus 三个伴随规则), 标准块 1242 成为唯一来源 → 全面板输入框统一 12px/8px 12px/8px 圆角; CDP 断言: 32 个 `.config-input` computed 字体集合 = {12px, 11px} (11px 为个别小输入框), 无 14px; ②**气泡主流化 round 3**: ①用户气泡**去微光投影** (`box-shadow:0 2px 10px rgba(79,70,229,0.22)` → `none`) — 2026 主流 Agent 项目 (ChatGPT/Claude/DeepSeek/Kimi) 用户气泡全部扁平无影, 渐变+白字+尾角 (用户 v3.6 指定保留) 不动; ②气泡 padding `0.4rem 0.6rem` → **`0.75rem 1rem` (12px 16px)** + `line-height:1.65` — 主流呼吸感留白, 与 init.js injectStyles 注入的 `.bubble.assistant { padding:12px 16px }` 对齐 → 用户/助手双气泡 padding 完全一致 (CDP: userPad===asstPad='12px 16px'); ③**验证 (CDP)**: userPad/asstPad 12px 16px 相等, userShadow none, 字体 15.2px, 行高 25.08px, 输入框字体无 14px; ④**发布**: index.html 全部 40 个 `?v=` bump 1785753300; 涉及 style.css (删重复块 + 气泡 padding/shadow) CLAUDE.md
- **2026-08-03**: 🐛 **重新生成完整重跑调用链 + 工具调用状态行移除 (v4.1)** — ①**重新生成只删最后一个气泡的根因**: `regenLastAssistant` (rendering.js) 找 `msgs` 中**最后一条 assistant** 的 index 截断 (`msgs.slice(0, idx)`) — 若用户问题后的回答链包含多轮 (工具调用轮 assistant(tool_calls) → tool 结果 → 最终回答), 只删最终回答, **中间轮次残留历史** → 重新发送用户问题后, 模型历史里仍带旧工具结果/中间消息, 生成会串味 (复用旧结果而非重新调用); ②**修复**: 改找**最后一条 user** 消息, 截断 `msgs.slice(0, userIdx)` + 保留 system/timestamp — 用户问题与其后全部消息 (工具轮/中间助手/最终回答) 整体删除, 再 `sendMessage` 重发该问题 → **完整调用链从零重跑** (重新搜索/重新调用工具); ③**验证 (CDP)**: 构造链「旧问题/旧回答/今天有什么新闻?/assistant(tool_calls web_search)/tool 结果/最终回答」→ `regenLastAssistant()` → 消息仅剩 `[旧问题, 旧回答]`, 新问题+全链删除; ④**「🔧 工具调用: web_search(...)」状态行移除**: 用户"这个块也要去掉" — tools-exec.js web_search 分支 (225-235) 与 web_fetch 分支 (267-277) 的 `.search-status` 创建块整体删除 (执行期间逐行实时状态已由 `.tool-call-lines` (v3.9 保留) + 顶部浮动 `.tool-status-bar` 提供, 该行纯冗余); ⑤**验证**: 服务端 tools-exec.js 无「🔧 工具调用」「正在抓取网页」字样; ⑥**发布**: index.html 全部 40 个 `?v=` bump 1785753000; 涉及 rendering.js (regen 截断点) tools-exec.js (两分支状态行删除) CLAUDE.md
- **2026-08-03**: 🛠️ **五项 UI 修复 (v4.0: 搜索完成行移除 / 呼吸光标泄漏 / 空气泡美化 / 页脚只留最后一个 / 缓存命中恢复)** — ①**搜索完成状态行整体移除**: 上轮只改成短文本, 用户"不需要搜索完成, 可以完全去掉这个块" → main.js web_search 完成分支 `status.remove()` 直接删掉状态元素 (执行期间「🔧 工具调用」行保留, 完成后连同状态行一起消失; 进度由顶部浮动状态栏 + 气泡外滚动标题条承担); ②**呼吸彩色光标泄漏修复**: 用户"切换气泡了, 气泡末尾那个呼吸的彩色光标怎么还在, 即使输出结束了也还在" — 该光标是 init.js 注入的 `.bubble.streaming .markdown-body::after` (2px 紫蓝渐变竖线, `stream-cursor` 1s 呼吸闪烁), 由 markdown.js `_flushStreamRender_batched` 加 `streaming` 类控制; markdown.js 流收尾虽有 `classList.remove('streaming')` (旧版只加不删的修复), 但**中止/切换气泡路径漏清** (与 v3.4 typing/gen-active 同族泄漏) → 三重补漏: ①main.js 新消息开始的全量清扫 selector 加入 `.bubble.streaming` + remove('streaming'); ②stream-handler 流结束清理块 `classList.remove('typing','gen-active','streaming')`; ③AppError.show 错误路径同步补删; ③**无正文空气泡美化**: 推理-only (隐藏推理后正文空) / 工具-only (仅 tool_calls 无正文) 消息渲染成空气泡 → 新增 `window._ensureEmptyBubbleHint(bubble, pendingMsg)` (stream-handler.js): markdown-body 无文本时追加灰色占位说明 — 有推理显示「已完成深度思考」, 否则「已执行工具调用」; 接入流式结束清理块 + main.js 非流式完成块; ④**页脚只保留最后一个气泡**: 用户"13.5s 23002 怎么每个气泡都还在, 只需要输出的最后一个气泡统计" → ①appendMessage 页脚修剪**移到 `container.appendChild(row)` 之后** (原实现放在 append 之前 — 气泡尚未挂入容器, `closest('.chat-messages-container')` 返回 null 拿不到容器, 且新页脚不在容器查询结果里 → 永远留下新旧两个页脚 — 这是"修剪无效"的根因); 用全局容器 `$.chatMessagesContainer` + 修剪除最后一个外的全部页脚; ②finalizeBubbleUI (流结束就地收尾) 添加页脚前先清掉其他气泡的页脚; ③新消息开始清扫页脚? 由 append 修剪自动覆盖 (新气泡成为最后一个时旧页脚被清); ⑤**缓存命中率恢复**: 上轮从页脚移除后用户"缓存命中率怎么完全看不到了" — 会话级用量面板存在但不显眼; 恢复 `_buildMsgFooterHtml` 的缓存段 (4 格式兼容提取: DeepSeek/OpenAI details/Anthropic/Grok 顶层), 现在显示在**最后一个气泡**的页脚: `2.0s 30 60.0%缓存命中(12/20)`; ⑥**验证 (CDP)**: ①追加 3 条消息 (2 助手带 usage + 1 用户) → `footCount=1` 且页脚在最后助手气泡上含 `60.0%缓存命中`; ②finalizeBubbleUI 路径 — 旧气泡页脚清除, 新气泡页脚 `3.2s 50 50.0%缓存命中(25/50)`; ③清扫断言 streaming 类移除; ④空气泡占位文案「已完成深度思考」; ⑤全部 JS node --check 通过; ⑦**发布**: index.html 全部 40 个 `?v=` bump 1785752700; 涉及 main.js (搜索状态行/清扫/错误路径/非流式占位) stream-handler.js (streaming 清理/空气泡占位/错误清理) rendering.js (页脚修剪两路径+缓存恢复) style.css (empty-response-hint) CLAUDE.md
- **2026-08-03**: 🐛 **搜索完成状态行不再注入原始结果 (气泡内)** — ①**需求**: 用户展示实例 — 气泡内出现「蕾米 ✅ 搜索完成: 【原始联网搜索结果】\n1. 8月4日 开始新闻微博《泰国头条新闻》\n链接: https://www.jrnen.co.th/...」这样一长串 — "像这种块可以去掉了"; ②**根因**: 工具调用模式下 web_search 执行完成分支 (main.js:3233) `status.textContent = '✅ 搜索完成: ' + resultContent.substring(0, 100) + '...'` — `resultContent` 是 `formatRawResults` 的完整格式化文本 (含「【原始联网搜索结果】」头 + 编号列表 + 链接 + 摘要), 前 100 字符 (通常是标题+链接开头) 被直接塞进气泡内 `.search-status` 状态行; 该行要等答案首包到达 (placeholderCleared) 才移除, 期间占据气泡内部空间, 与气泡外滚动标题条 (v3.4) 内容重复; ③**修复**: 改为纯文本 `'✅ 搜索完成'` — 搜索结果的标题/链接已由**气泡外滚动标题条** (showSearchTicker, 无背景逐行上滚) 展示, 状态行仅保留简短完成确认, 答案开始输出即移除; 完整结果仍随 toolResult 传给模型不受影响; ④**验证**: 服务端 main.js 已含新分支 (grep 命中), node --check 通过; ⑤**发布**: index.html 全部 40 个 `?v=` bump 1785752400; 涉及 main.js (web_search 状态行) CLAUDE.md
- **2026-08-03**: 🐛 **缓存命中率从气泡页脚移除 (只在会话总结显示一次)** — ①**需求**: 用户"那个缓存命中率那一行能不能在最后总结显示, 不要每个气泡都显示一次" — 每个助手气泡的页脚都显示「X%缓存命中(H/M)」太重复; ②**根因**: `_buildMsgFooterHtml` (rendering.js, appendMessage 与 finalizeBubbleUI 共用) 把耗时/token/**缓存命中**三段全部拼进每个气泡页脚 — 缓存命中段做了 4 种格式兼容提取 (DeepSeek prompt_cache_hit/miss_tokens、OpenAI prompt_tokens_details.cached_tokens、Anthropic cache_read/creation_input_tokens、Grok 顶层 cached_tokens); ③**修复**: 页脚只保留耗时+token, 缓存命中段整段移除 (提取逻辑保留但结果不再渲染); 缓存命中率仍显示在**会话级用量总结** — `usagePanel.cacheHint()` (config.js:240) 「💾 缓存命中率 X% (H/M)」+ 按命中率变色 (绿>50%/黄>20%/红), 数据由 `sessionUsage.cacheHitTokens/cacheMissTokens` 跨请求累计 — 一处总结, 不再每气泡重复; ④**验证**: CDP 调 `_buildMsgFooterHtml({prompt_tokens:100, completion_tokens:50, prompt_cache_hit_tokens:80, prompt_cache_miss_tokens:20}, 1500)` → footer = `1.5s` + `150` (耗时+token), `hasCacheInFooter=false`; ⑤**发布**: index.html 全部 40 个 `?v=` bump 1785752100; 涉及 rendering.js (_buildMsgFooterHtml 缓存段移除) CLAUDE.md
- **2026-08-03**: 🎛️ **工具状态行保留 + 残留总结清除 (v3.9, 用户澄清)** — ①**需求澄清**: 用户对 v3.8 回复"实时渲染: 工具执行时气泡内逐行显示工具状态 (转圈/绿勾/红叉 + 工具名 + 参数) **这个要**, 只是最后的总结不要" — 即实时逐行状态保留, 工具执行完后的**残留总结** (所有已完成行的累积列表) 在答案开始时清除; ②**调整**: ①CSS: `.tool-call-lines` 从 `display:none` 规则中移除 (恢复可见), 隐藏规则只保留 `.tool-calls-history` (历史渲染的「N 次工具调用」折叠块); ②stream-handler.js 在**答案开始输出**的两个点位清除残留行: 流式路径 `placeholderCleared` 块 (首批 reasoning/content chunk 到达时, 与 `.search-status` 清除同步) — `_ownedBubble.querySelector('.tool-call-lines')?.remove()`; 非流式路径 `handleNonStream` 开头 (工具执行完返回最终答案那一轮, 渲染前清除); 执行期间逐行状态 (running spinner → success 勾) 全程可见, 答案开始生成瞬间整块消失; ③**验证 (CDP)**: 历史 `.tool-calls-history` computed `display:none` ✓, 手动注入 `.tool-call-lines` computed `display:block` ✓ (恢复可见); ④**发布**: index.html 全部 40 个 `?v=` bump 1785751800; 涉及 style.css (隐藏规则收窄) stream-handler.js (两处残留清除) CLAUDE.md
- **2026-08-03**: 🎛️ **气泡内工具调用信息总结块隐藏 (v3.8)** — ①**需求**: 用户看完隐藏推理过程后说"同时隐藏气泡内那个工具调用信息总结块" (先排除 .tool-stack-summary — 它在气泡外的独立行, 用户明确"不是这个"); ②**定位到气泡内两处总结块**: ①**历史渲染**: loadChat 渲染带 `tool_calls` 的助手消息时 (dialogs.js:950-955) 生成 `<details class="tool-calls-history">` + summary「N 次工具调用」+ 工具名图标 chips — 插在助手气泡内; ②**实时渲染**: `showToolStatus` (ui.js:99) 在气泡内 (markdown-body 前) 创建 `.tool-call-lines` 容器, 逐行显示工具调用 (spinner 转动中/绿勾成功/红叉失败 + 工具名 + 参数前 40 字符), running→success 同名替换、新调用旧行灵动滑出、aria-live 播报 — 全在气泡内; ③**修复 (纯 CSS 零 JS)**: `.tool-calls-history, .tool-call-lines { display:none !important }` — 历史「N 次工具调用」折叠块 + 实时逐行状态全部隐藏; 工具调用信息不丢失: 气泡外工具卡片 (`appendToolCallMessage` 独立 message-row, 含成功/失败状态与时长) + 顶部浮动 `.tool-status-bar` (常驻执行进度) 仍完整提供; ④**验证 (CDP)**: loadChat 渲染出 `.tool-calls-history` → computed `display:none` ✓; 手动注入 `.tool-call-lines` 到气泡 → `display:none` ✓; `createToolCallCard` 正常创建 (卡片不受影响) ✓; ⑤**发布**: index.html 全部 40 个 `?v=` bump 1785751500 (排查中发现一个并行写入的杂散版本号 1785753272 未随主 bump — 已归一化); 涉及 style.css (隐藏规则) CLAUDE.md
- **2026-08-03**: 🎛️ **显示设置新增「隐藏推理过程」开关 + 思考状态指示条 (v3.7)** — ①**需求**: 用户"看一堆推理过程块太累了" — 流式回答里的「深度思考」折叠块 (details.reasoning-details) 每个都占一行, 想整体隐藏, 但思考时仍需有状态提示; ②**开关**: 显示设置区块 (config-toggle-row) 新增 `#hideReasoningToggle` checkbox, onchange 调 `window.toggleHideReasoning(checked)` (config.js): `localStorage.setItem('hideReasoning', '1'/'0')` + `document.body.classList.toggle('hide-reasoning')` + `_scheduleConfigSync()` 跨设备同步; `window.isHideReasoning()` 读取辅助; init.js 启动时恢复 (body 类 + checkbox 状态); ③**隐藏机制 (纯 CSS 零侵入)**: `body.hide-reasoning .reasoning-details { display:none !important }` — 对已渲染的历史推理块/流式中正在生成的块/loadChat 重新渲染的块全部即时生效, 不改动任何 JS 渲染路径, 切换瞬间全局隐藏/恢复; ④**思考状态体现 (合适方式)**: 隐藏模式下流式收到首个推理 chunk 时, stream-handler.js 新增 `_ensureReasoningChip(bubble)` 在气泡内追加 `💡 思考中` 小指示条 — 6px 紫色圆点 `reasoning-pulse` 1.2s 脉冲动画 (0.3↔1 透明度 + 0.8↔1.15 缩放) + 11px 灰色文字, 双主题配色 (亮 #6366f1 点/#9ca3af 字, 暗 #a5b4fc/#6b7280), prefers-reduced-motion 停用; 4 个推理块创建点统一接入 (后端 SSE handler ×2 + streamResponse reasoning_details/reasoning_content ×2); 流结束清理块 (v3.4 的 `_ownedBubble` 区块) 同步移除指示条; ⑤**验证 (CDP)**: 开关存在于显示设置 ✓; toggle on → `body.hide-reasoning` + 历史加载的推理块 computed `display:none` + localStorage '1'; `_ensureReasoningChip` → chip 存在 + 文本"思考中" + 动画 `reasoning-pulse`; toggle off → body 类移除 + 推理块恢复 `display:block` + stored '0'; ⑥**发布**: index.html 全部 40 个 `?v=` bump 1785751200; 涉及 index.html (开关行) config.js (toggle/isHideReasoning) init.js (启动恢复) stream-handler.js (_ensureReasoningChip + 4 接入点 + 流末移除) style.css (hide-reasoning + chip 样式族) CLAUDE.md
- **2026-08-03**: 🎨 **用户气泡恢复渐变版 (v3.6, 用户指定)** — ①**背景**: v3.5 把用户气泡改成 ChatGPT 风柔和灰 (#e9e9eb/暗 #3a3a3d) + 助手完全透明, 用户反馈"我觉得之前挺好的, 恢复用户气泡渐变那一版" → 恢复 v3.3 设计: 用户气泡 **indigo→蓝渐变** `linear-gradient(135deg,#6366f1,#3b82f6)` + 白字 + 尾角 0.35rem (19.2px 主体圆角 + 5.6px 尾角) + 微光投影 `0 2px 10px rgba(79,70,229,0.22)`; 助手气泡同步恢复 v3.3 轻表面 (亮 `rgba(255,255,255,0.6)`/暗 `rgba(255,255,255,0.04)`, 无边框无阴影); ②**实现**: 替换文件末尾气泡区块 (round 2 区块 → v3.3 恢复版), 亮色加固规则 `html:not(.dark) .bubble.user { background-color:#2563eb!important }` 仍用同特异性后置覆盖 (`background` 简写 + `background-color:transparent!important` 双保险); ③**验证 (CDP 双主题)**: 亮 user `linear-gradient(135deg, rgb(99,102,241), rgb(59,130,246))`+白字+`19.2px 19.2px 5.6px`+投影 `rgba(79,70,229,0.22)`, 助手 `rgba(255,255,255,0.6)`/无影; 暗 user 渐变+白字不变, 助手 `rgba(255,255,255,0.04)`+浅字; ④**发布**: index.html 全部 40 个 `?v=` bump 1785750800; 涉及 style.css (气泡区块恢复) CLAUDE.md
- **2026-08-03**: 🎨 **气泡主流化 round 2 (ChatGPT 灰 + Claude 透明) + 记忆系统 emoji 清理 (v3.5)** — ①**背景**: 用户再次提出"气泡参考主流 Agent 项目"且此前已反感渐变按钮"太显眼" → v3.3 的 indigo→蓝渐变用户气泡 + 0.6 轻表面助手气泡仍偏"花", 彻底转向最主流的两大范式: **ChatGPT 的用户灰气泡** + **Claude 的透明助手**; ②**用户气泡**: `#e9e9eb` 柔和中性灰 (亮色)/`#3a3a3d` (暗色) + 深字 (暗色浅字), **对称圆角 17.6px 去尾角** (主流 Agent 项目均无尾角), 去投影去发光; 实现: 同特异性后置 + `background-image:none!important` 双管齐下压过 v3.3 的渐变 (`html:not(.dark) .bubble.user` 的 `background-color` 与加固规则的 `#2563eb!important`), `border-radius` 直接覆盖 v3.3 的 19.2px/5.6px 尾角; ③**助手气泡**: 完全透明 (`transparent` + 无边框无阴影), 内容直接落在页面背景 — Claude 同款; 代码块/表格/工具卡自带背景不受影响; `.typing` 呼吸动画仍作用于透明气泡 (box-shadow 光晕照常); ④**记忆系统"文字位置不统一"残余根因 = emoji 前缀**: v3.3 标准化后结构已与面板其他段一致, 但 label/按钮里的 emoji (`🎭 人格预设`/`💾 保存记忆`/`🔄 刷新`/`🗑 清空`) 是彩色 emoji 字形, 在 11-12px 字号下会**撑高行盒使文字基线偏移**, 与面板其他纯文本 label (提供商/API Key) 的基线不一致 — 视觉上就是"文字位置不统一"; 修复: 全部移除 emoji → 纯文本 (人格预设/保存记忆/刷新/清空); ⑤**验证 (CDP)**: 双主题 computed — 亮色 user `rgb(233,233,235)`/`rgb(31,41,55)` 深字/`17.6px` 圆角/`none` 阴影, 暗色 user `rgb(58,58,61)`/`rgb(243,244,246)` 浅字, 助手双主题 `rgba(0,0,0,0)` 背景/`none` 边框/`none` 阴影; 记忆区断言: label="人格预设" 纯文本, buttons=["保存记忆","刷新","清空"] 纯文本; ⑥**发布**: index.html 全部 40 个 `?v=` bump 1785750300; 涉及 style.css (气泡 round 2 覆盖块) index.html (记忆段去 emoji) CLAUDE.md ⑤**补充 (并行会话合并)**: 记忆系统输入行/按钮行内联样式全部类名化 (`.memory-add-row`/`.memory-btn-row`/`.memory-flex-1/2`, 0 内联样式残留), 删除被 round 2 取代的 v3.3 渐变气泡死代码块 (同文件仅存 1 个气泡区块); index.html 全部 40 个 `?v=` 最终 bump 1785750500
- **2026-08-03**: 🐛 **呼吸光晕滞留旧气泡修复 + 搜索详情块改无背景滚动标题条 (v3.4)** — ①**呼吸光晕滞留旧气泡 (三根因)**: ①`streamResponse` 内部 7 处 `var currentBubble = activeBubbleMap[chatId]` — 读的是**共享 map**, 新消息 sendMessage 会 `activeBubbleMap[chatId] = 新气泡` → 旧流的 chunk 写入/清理都拿到新气泡; ②streamResponse 结尾 `if (currentChatId === chatId && currentBubble)` 的 `currentBubble` 是**隐式全局** (依赖最后一次 chunk 块内 `var currentBubble = ...` 的赋值, var 提升到函数作用域) — 若流在首个 chunk 前就结束/被中止, 该变量残留上一次请求的值 → 误清新气泡或漏清旧气泡; ③旧请求被中止后 `_msgReqGen` ID 守卫让 finally 提前 return, 清理被跳过 → 旧气泡 `typing/gen-active` 永久滞留 (发光 + "..." 点), 只有 loadChat 全量重渲染才清除 — 用户看到"下一个气泡都出来了, 原来的还亮着, 全部输出完才消失"; **修复**: ①`streamResponse` 开头捕获 `var _ownedBubble = activeBubbleMap[chatId] || null`, 7 处读取 + 结尾两处清理块全部改用自有气泡 (sed 逐块替换, node --check 通过); ②**全量清扫兜底** — sendMessage 创建新气泡之前, `document.querySelectorAll('.bubble.assistant.typing, .bubble.assistant.gen-active')` 全部移除两 class + 顺带移除旧 `.search-ticker` (任何泄漏路径在新消息开始的瞬间 100% 清除, 不依赖具体清理链路); ③完成路径 (main.js 3524) 与错误路径 (main.js 413) 补删 `gen-active` (原来只删 typing); ④**验证**: CDP 注入双气泡加 class → 清扫断言 after='cleaned'; ②**搜索详情块 → 无背景滚动标题条**: 工具调用卡片把 `formatRawResults` 原始文本 (编号+链接+摘要+缩略图) 渲染进绿底 `tool-call-result` pre — 用户反馈"丑"; 替代方案: 新增 `window.showSearchTicker(results)` (search.js) — **气泡外** 26px 无背景条: 每行 `[序号圆徽][标题][域名]` (域名 `new URL().hostname` 提取, 点击新标签打开), 内容×2 无缝循环, `animation: search-ticker-up linear` translateY 0→-50% 向上滚动 (每行 2.2s, 12 条上限), 左右边缘 `mask-image` 渐隐, `prefers-reduced-motion` 停用, 插入位置 = 当前助手气泡的 `.message-content-wrapper` 末尾 (气泡外); 触发双路径: ①`handleSearchFlow` (api-messages.js, 非工具模式); ②工具调用 `web_search` 分支 (tools-exec.js); 卡片渲染特殊化 (rendering.js): `toolName === 'web_search'` 时 `resultText` 替换为 `✅ 已获取 N 条搜索结果 · 标题已在上方滚动展示` — **完整结果仍随 toolResult 传给模型** (绝不能截断 — 模型靠它回答, 曾有截断导致工具结果丢失的历史教训); ③**验证 (CDP)**: 滚动条插入位置 `outsideBubble=true` (在 message-content-wrapper 内、bubble 外), 8 行 (4×2 循环), animation `search-ticker-up/8.8s`, 26px 行高/26px 容器, 无背景 (transparent), 灰色文字, host 可见, mask 生效; 动画实测: track y 654→626 (1.5s 上移); 卡片摘要断言: summary='结果' + pre 文本 = 短摘要; 清扫断言通过; ④**发布**: index.html 全部 40 个 `?v=` bump 1785749900; 涉及 stream-handler.js (_ownedBubble 7 处) main.js (清扫 + gen-active 补删) search.js (showSearchTicker) api-messages.js (触发) tools-exec.js (触发) rendering.js (卡片特殊化) style.css (ticker 样式族) CLAUDE.md
- **2026-08-03**: 🐛 **暗色模式 select 自定义箭头平铺修复 (config-input shorthand 重置 longhand)** — ①**现象**: 暗色模式下右侧面板「提供商」等带自定义下拉箭头的 select (baseUrlProvider/visionProvider/imageProvider/thinkingMode 等全部 `.config-select`) 被**整排/整列向下箭头铺满**, 亮色模式正常; ②**根因 (CSS shorthand 陷阱)**: `.config-select` (1264 行) 用四个 longhand 定义箭头: `background-image: url(箭头svg)` + `background-repeat: no-repeat` + `background-position: right 10px center` + `background-size: 14px`; 而 `.dark .config-input` (1253 行, select 同时带 `config-input config-select` 两个类) 写的是 **`background: #374151` shorthand** — 位于 `.config-select` 之后 → shorthand 展开为全部 8 个 background longhand 的 initial 值 (image:none/repeat:repeat/size:auto/position:0% 0%), 覆盖掉 `.config-select` 的 no-repeat/14px/right-10px; 随后的 `.dark .config-select` (1278 行) 只补回 `background-image` (暗色浅灰箭头) 不补 repeat/size/position → 最终 computed 是 `image=箭头 + repeat=repeat + size=auto` → 12px 小箭头在整块 select 背景上平铺, 呈"三行箭头"; 亮色不炸是因为亮色加固规则 (`html:not(.dark) .config-panel select`) 用的是 **`background-color` longhand**, 不会重置 arrow 长属性; ③**修复**: ①`.dark .config-input` 的 `background: #374151` → **`background-color: #374151`** (longhand, 不再波及 image/repeat/size/position) — 根治; ②双保险: `.dark .config-select` 补全 `background-repeat: no-repeat; background-position: right 10px center; background-size: 14px;` (未来任何 shorthand 误伤也能自愈); ④**验证 (CDP)**: 暗色 computed 断言 — baseUrlProvider `no-repeat`/`14px`/`calc(100% - 10px) 50%`, 4 个 config-select (baseUrlProvider/visionProvider/imageProvider/thinkingMode) 全部 no-repeat+14px; 亮色回归检查 `no-repeat`/`14px` 正常 (基础 `.config-input { background: white }` shorthand 在 `.config-select` 之前, 不影响); CSS 括号平衡 1906/1906; ⑤**发布**: index.html 全部 40 个 `?v=` bump 1785749600; 涉及 style.css (.dark .config-input longhand + .dark .config-select 补全) CLAUDE.md
- **2026-08-03**: 🎨 **气泡主流化 + 记忆系统面板标准化 (v3.3)** — ①**气泡样式参考主流 Agent 项目 (Claude/ChatGPT/DeepSeek/Kimi)**: 旧设计是"2022 卡片风" — 用户气泡 `#2563eb` 纯蓝、助手气泡白底+1px 边框+阴影+0.25rem 小尾角; 新设计: **用户气泡改项目签名渐变** `linear-gradient(135deg,#6366f1,#3b82f6)` (与新建按钮/品牌/历史 active 项同一 indigo→blue 语言) + 白字 + 尾角 0.35rem + 微光投影 `0 2px 10px rgba(79,70,229,0.22)`; **助手气泡去卡片化** (Claude 暗色同款思路 — 内容融入页面背景): 亮色 `rgba(255,255,255,0.6)` 轻表面 (近不可见, 干净) + **去边框去阴影**, 暗色由 `#1f2937` 硬块 → `rgba(255,255,255,0.04)` 极淡表面, markdown 代码块/表格自带背景不受影响; 实现要点: 亮色加固规则 `html:not(.dark) .bubble.user{background-color:#2563eb!important;color:white!important}` 和 `html:not(.dark) .bubble.assistant{background-color:white!important;box-shadow:0 2px 8px rgba(0,0,0,0.05)!important}` 都是 `!important` — 需在文件末尾用**同特异性后置**规则覆盖 (html:not(.dark) + 同 class 组合), 用户气泡用 `background` 简写+`background-color:transparent!important` 双保险; ②**记忆系统面板与右侧面板其他部分不统一根因**: ①`.config-btn` 类**全站无定义** (grep 确认只在记忆面板 3 个按钮使用, 渲染成默认浏览器按钮样式 — 这是"文字位置不统一"的最明显来源); ②整段用内联样式堆砌: 标题 svg 12px (其他段 14px)、summary margin-bottom 8px (标准 12px)、人格预设 label 内联手写 (标准 `.config-label` 就是 11px/#6b7280/4px 完全同值)、select 只加 config-input 没加 config-select (无自定义箭头, 字体 11px vs 标准 12px)、输入框内联 `font-size:11px;padding:6px 8px` vs 标准 `12px/8px 12px`、按钮内联 `font-size:11px;padding:6px`; 修复: ①全部改标准类 — 标题 svg 14px、去内联间距、label 用 `.config-label`、select 加 `.config-select` (自带 SVG 箭头+暗色变体)、输入框去内联样式、按钮去内联字体/内边距; ②**补齐 `.config-btn` 定义**: 药丸 9999px + 灰底 `#f3f4f6`/暗 `#374151` + 12px 500 字重 + hover 加深 + active 按压 + `.config-btn-danger` 红色变体 (清空按钮, 双主题红); ③**记忆条目标准化** (agent.js `refreshMemoryList` 内联样式 → 类名): `.memory-item` 行 (键名 `<b>` indigo 高亮/暗色 indigo-300、悬停红 ✕ 删除钮、细边框分隔、末行无边框), `.memory-list` 容器 (200px 滚动 + 细边框圆角卡 + 细滚动条), `.memory-empty` 空态; ③**验证 (CDP)**: 注入测试消息 — 亮色 user bubble `linear-gradient(135deg, rgb(99,102,241), rgb(59,130,246))`+白字+尾角 5.6px+投影 `rgba(79,70,229,0.22)`, 助手 `rgba(255,255,255,0.6)`+`box-shadow:none`+边框 `rgba(15,23,42,0.04)`; 暗色助手 `rgba(255,255,255,0.04)`+`#e5e7eb` 字+无影, user 渐变不变; 记忆区 8 项断言: titleSvg 14/titleMB 12px/label 11px/selectFont 12px+箭头/btnRadius 9999px+灰底+12px/listClass memory-list 全过; ④**排查**: `.bubble.assistant.transparent-bg` (1938 行) 无任何 JS 引用 — 死代码, 新规则特异性虽高但无兼容风险, 保留原样; ⑤**发布**: index.html 全部 40 个 `?v=` bump 1785749400; 涉及 style.css (气泡 6 条 + config-btn/memory-* 样式族) index.html (记忆段去内联样式) agent.js (记忆条目类名化) CLAUDE.md
- **2026-08-03**: 🎨 **侧边栏 v3.2 (手机端功能按钮点击变白修复 + 收起文字挤列 + 边缘柔和化)** — ①**手机端「功能」区点击变白根因**: `.sidebar-mobile-actions` (刷课/云盘/设置, 仅 ≤786px 侧栏显示) 三个入口 class 带 `hover:bg-gray-200` — 亮色下按压/悬停态是 `rgb(229,231,235)` 近白浅灰 (CDP 真实鼠标按压 computed 实测), 用户感知"手一碰就变白"; 修复: 追加主题色按压规则 (`!important` 压过 Tailwind 类): 亮色 `rgba(99,102,241,0.08)` 底 + `#4f46e5` 字, 暗色 `rgba(99,102,241,0.14)` 底 + `#a5b4fc` 字, 覆盖 :hover/:active 四态 — 与侧栏其余交互 (历史项 hover/新建按钮 hover) 统一为 indigo 淡填充语言, 不再有近白底色; CDP 验证: 亮按压 `rgba(99,102,241,0.08)`/`rgb(79,70,229)`, 暗按压 `rgba(99,102,241,0.14)`/`rgb(165,180,252)` (测试中点击刷课链接会真实跳转 chaoxing.html, 需导航回主页面再测暗色); ②**收起文字挤成竖列根因**: `.sidebar.collapsed { width:0 !important }` 收起动画 (0.3s 全属性过渡) 中容器宽度渐缩到 0, 内部文本 (品牌行「对话记录」/新建按钮「新建对话」) 在窄容器里自动换行逐字堆叠成竖列, 过渡全程可见; 修复: `.sidebar` 加 `overflow-x:hidden` (横向溢出直接裁剪, 宽度动画变干净) + `.sidebar-brand`/`.sidebar-newchat-btn` 加 `white-space:nowrap` (文本永不换行); CDP 实测: 收起过渡中途 (宽度 86px) brand 高度保持 25px 单行, 结束态宽度 0; 移动端抽屉不受影响 (transform 收起无宽度动画); ③**边缘太过锐利 → 分隔线柔和化**: 主因是亮色主题加固规则 `html:not(.dark) header, ... { border-color:#e5e7eb !important }` (light-mode hardening 顺带强制了边框色) + Tailwind `border-gray-200` 类, 直边 1px 灰线把侧栏/顶栏与主区割裂; 修复: 文件末尾追加「边缘柔和化」区块, 用同特异性 (`html:not(.dark) header`) 或 ID 选择器 + `!important` 覆盖 — 顶栏底边/左栏右缘/右栏左缘: 亮色 `rgba(148,163,184,0.22)` (≈22% 透明度 slate 分隔线, 几乎融入背景), 暗色 `rgba(255,255,255,0.06~0.07)` (暗色下是极淡白线而非 #1f2937); 移动端输入框药丸边框 (亮色白底硬 #e5e7eb 边) 同步柔和为 `rgba(148,163,184,0.28)`/暗 `rgba(255,255,255,0.10)` — 桌面端输入框原本已是 `rgba(0,0,0,0.06)` 软边不动; 验证: CDP 双主题 computed — 亮 header `rgba(148,163,184,0.22)`/sidebar `rgba(148,163,184,0.22)`/configPanel `rgba(148,163,184,0.22)`, 暗 header `rgba(255,255,255,0.07)`/sidebar `rgba(255,255,255,0.06)`/configPanel `rgba(255,255,255,0.06)`, 移动 input `rgba(148,163,184,0.28)`; ④**发布**: index.html 全部 40 个 `?v=` bump 1785749000; 涉及 style.css (mobile-actions 按压色 + sidebar overflow/nowrap + 边缘柔和化区块) CLAUDE.md
- **2026-08-03**: 🎨 **侧边栏 v3.1 (新建对话按钮空心化 + 历史列表底部平滑淡出)** — ①**渐变按钮太抢眼 → 空心化**: 原 v2 渐变实心胶囊 (`linear-gradient(135deg,#6366f1,#3b82f6)` + 投影 + hover 上浮) 用户反馈"颜色太显眼" → 改空心细边框: `background:transparent` + `border:1px solid rgba(99,102,241,0.35)` (暗色 `rgba(165,180,252,0.32)`) + 语义色文字 (亮 `#4f46e5`/暗 `#a5b4fc`), 移除投影/发光, 高度 37→33px (padding 8px→7px); hover 淡填充 (亮 `rgba(99,102,241,0.06)`/暗 0.14) + 边框加深 + 文字加深, 图标 hover 旋转 90° 动效保留, active 按压 scale(0.98); ②**列表底部硬截断 → mask 淡出**: 上轮删除 sticky 伪元素遮罩后, 内容滚到列表末端被滚动容器硬裁剪"像文字被遮掉一半" (CDP 实测滚动行为本身正常 — 最大滚动位置最后一项 40/40px 完全可见无遮挡, 用户感知的是滚动中穿过底边的硬切) → 用 **`mask-image` 替代伪元素方案**: `linear-gradient(to bottom, black calc(100% - 18px), transparent 100%)` (webkit + 标准双写, Firefox 标准属性) — mask 固定在元素边框盒 (不随内容滚动、不占布局空间, 彻底规避旧 sticky 伪元素占 60px 布局空间的根因), 可视区末端 18px 内容渐隐; 透明淡出对任何背景通用 (侧边栏是 `radial-gradient` 紫色光晕渐变背景, 实色伪元素方案会穿帮, 这是选 mask 而非背景渐变伪元素的原因); ③**验证 (CDP 像素级)**: 注入 15 条假会话滚动到目标位置, 截图像素采样 — 标题字形 (indigo #4f46e5 = rgb(85,76,230)) 在淡出区外 100% 饱和, 位于淡出区 50% 处 (距底边 7px) 混成 `rgb(152,148,240)` (≈字形与背景 1:1 混合, 平滑渐隐非硬切), 越接近底边越接近背景色 `rgb(246,248,252)`; 空心按钮双主题 computed 断言: 亮色 transparent/`rgba(99,102,241,0.35)`/#4f46e5/boxShadow none, 暗色 transparent/`rgba(165,180,252,0.32)`/#a5b4fc/none; mask 计算值 `linear-gradient(rgb(0,0,0) calc(100% - 18px), rgba(0,0,0,0) 100%)`; 间距回归 14px 对称无变化; 测试假数据已从内存+localStorage 清理; ④**发布**: index.html 全部 40 个 `?v=` bump 1785748605; 涉及 style.css (.sidebar-newchat-btn 空心化 + #chatHistoryList mask) CLAUDE.md
- **2026-08-03**: 🐛 **刷课启动报错「attempt to write a readonly database」修复 (learning_records.db 权限 + tracker 自修复死代码)** — ①**现象**: 面板点击开始刷课后, 日志在 `tracker.start_course()` 处抛 `sqlite3.OperationalError: attempt to write a readonly database` (main.py:150 → tracker.py:76), 刷课任务立即崩溃; 日志前段显示登录成功 → 课程列表过滤出 4 门 → 开始学习课程即炸; ②**根因**: ①**文件权限**: `python/chaoxing/learning_records.db` 属主为 `naujtrats:naujtrats` 权限 664 (other 仅 r), 目录 `python/chaoxing/` 755 — 而刷课 `main.py` 由 PHP `pyBgCmd` 以 **www-data** 用户启动: 文件 other 位无写权限 + 目录无权限创建 journal → SQLite 任何写操作被拒, 读取正常 (所以课程列表/状态查询正常, 只写炸); ②**tracker.py 自修复是死代码**: 原 `__init__` 只在 `sqlite3.connect()` 抛 OperationalError 时修复权限 — 但 SQLite 对只读文件**惰性降级为只读打开**, connect 不抛错, readonly 错误出现在第一次实际写操作 (executescript/execute), except 分支永远抓不到; 且即使抓到, www-data 对非属主文件执行 `os.chown/os.chmod` 必然失败 (需要 root 或属主), 外层 `except Exception: pass` 又静默吞掉; ③**修复**: ①系统级权限修正: `chown naujtrats:www-data learning_records.db` + `chmod 664`, 目录 `chmod 775` — 属主 (naujtrats 手动调试/引擎) 与组 (www-data, PHP 链路) 双写; ②`tracker.py` 重写 `_ensure_writable()`: 连接后立即用 **CREATE/DROP 临时表触发真实写页面** 探测 (BEGIN IMMEDIATE 只获取锁不写页, 测不出只读), 探测失败 → 自修复 (chmod 目录 775 + 文件 664; 仅 root 时 chown 到 www-data) → 重连重测; 仍失败抛**带修复命令的明确错误** (文件路径/uid/完整 chown+chmod 命令), 不再静默; ④**验证**: ①www-data 正常实例化 tracker + start_course 写入 OK; ②模拟故障: db 444 + 目录 555 → naujtrats (属主) 运行自动 chmod 修复 → 写入成功 → 权限自动恢复 664/775; ③www-data + 444 非属主场景 → 明确报错含修复指引; ④PHP 刷课链路的 `db_course_status.py --reset-start` 写路径 OK; ⑤**遗留提醒**: learning_records.db 被 git 跟踪 (M 状态), git 操作重建文件可能再次改变属主复现此问题 — 若复现按报错提示 chown/chmod 即可
- **2026-08-03**: 🎨 **左侧侧边栏全面优化 v3 (顶部空白/间距拥挤/暗色丑边/点击变白四连修 + 三条杠居中)** — ①**60px 顶部空白根因 (sticky 遮罩)**: `#chatHistoryList::before/::after` 是 `position:sticky` 的 60px 高全宽渐变遮罩 (`top:0`/`bottom:0` 粘性), 作为伪元素占据容器内容流首/尾各 60px → 历史列表第一个分组被整体推下 60px, 视觉上"新建对话按钮下方一大片空白"; 亮色是 `rgba(255,255,255,0.9)` 白渐变 (在浅灰侧栏上看似空区), **暗色是 `rgba(0,0,0,0.3)` 黑色渐变 (在 gray-900 侧栏上呈黑污痕/阴影)** — 即用户反馈的"左上角空白 + 暗色边缘丑 + 阴影"; 修复: 直接删除两组伪元素规则, 列表内容紧贴按钮 (gapListToGroup 60→0px); ②**间距失衡根因 (Tailwind 裁剪集缺 mb-5)**: 品牌行 `mb-5` class 在 `css/tailwind-index.min.css` 中**不存在** (grep 0 命中, computed margin-bottom=0px) → 对话记录与新建按钮 0px 紧贴"太拥挤"; 新建按钮下方因遮罩 60px "太远"; 修复: `#sidebar > .flex.items-center.justify-between { margin-bottom:14px }` 显式补齐 + `.sidebar-newchat-btn { margin: 0 0 10px }` → 上下对称 14/14px; ③**历史项精简**: 移除气泡图标 (dialogs.js `renderChatHistory` 删 `chat-history-icon` svg, style.css 清 `.chat-history-icon` 四条规则), 移除误加的每组分条数徽章 (`.chat-history-group-count` 一并删除 — 用户不需要统计); ④**滚动框升级**: `#chatHistoryList` 双主题 5px 细滚动条 (webkit `::-webkit-scrollbar` + Firefox `scrollbar-width:thin; scrollbar-color`), 亮色 `rgba(107,114,128,0.28)`/hover 0.45, 暗色 `rgba(255,255,255,0.14)`/hover 0.25; 暗色 active 项内阴影改 `inset 0 0 0 1px rgba(165,180,252,0.22)` 柔化; ⑤**点击变白加固**: Chromium 无法复现 (color-scheme 已正确设置), 按真实设备常见根因兜底: ①暗色 autofill 覆盖 (`input:-webkit-autofill` `-webkit-box-shadow: 0 0 0 1000px #374151 inset` + `-webkit-text-fill-color:#f3f4f6`, Chrome 自动填充会把暗色输入框刷成白底); ②暗色 `:active/:focus` 强制 `background-color:#374151 !important; color:#f3f4f6 !important`; ③`-webkit-tap-highlight-color:transparent` 覆盖 label/summary/input/select; ⑥**移动端三条杠歪 (dx=-7px) 双根因**: ①JS 六处 `$.sidebarToggle.style.display='block'` (agent.js:103/1563, init.js:698/705/740, ui.js:870 + 574 三元) 内联 block 破坏 `.header-menu-btn` 的 inline-flex 居中; ②CSS 媒体规则 `#sidebarToggle{display:block !important}` (2314/2345 两处) 用 !important 压过 6580 行规则的 `display:inline-flex` (非 important), 且 2345 的 `padding:0.3rem !important` 输给 6580 的 `padding:0 !important` (同特异性后者胜) → 按钮 32px 无内边距 + svg 16px block 贴内容盒左缘 (x=7 vs 按钮中心 22); 修复: JS 六处 block→`inline-flex`, CSS 两处 `display:inline-flex !important` (CDP 实测 dx=0/dy=0); ⑦**删除误加的头部「新建对话」按钮** (用户澄清"空白"指的是侧边栏左上角, 非 header; index.html + style.css 两处回退, grep 0 残留); ⑧**验证**: Chromium CDP (cache disabled 强制最新 CSS) — 桌面亮色: headerNewChatGone/maskGone/gapBrandBtn=14/gapBtnList=14/gapListGroup=0/itemIcon=false/countBadge=false/collapseBtn 30×30/pref 2 组 open=[true,false]; 桌面暗色 (过渡 0.5s 稳定后): summaryColor #9ca3af/itemColor #a5b4fc/activeShadow indigo-300/scrollbar white 0.14/prefBg rgba(255,255,255,0.035); 移动端: dx=0/dy=0/display flex; 中间排查确认: 服务端 CSS 与磁盘 md5 一致、无 Service Worker、浏览器首次测到的"暗色不生效"是旧版本 URL 缓存 (v=1785747400 早于文件 mtime) 而非代码问题; index.html 全部 40 个 `?v=` bump 1785748000 强制拉新; 涉及: index.html(sidebar 偏好设置卡结构保留 + 头部按钮回退) dialogs.js(去图标/去计数) style.css(遮罩删除/间距/滚动条/暗色加固/autofill/tap-highlight/display 修复) agent.js/init.js/ui.js(display inline-flex)
- **2026-08-03**: 🐛 **超星刷课面板「暂无课程」修复 (登录后缓存 session 不失效 + 空列表污染缓存)** — ①**现象**: 超星学习通刷课面板显示「暂无课程」, 但账号在超星 APP/网页端明明还有 13 门课程; ②**排查链路**: MCP `chaoxing_overview` 返回「未认证」; 直接运行 `api_get_courses.py --user-id u_a418898cebde5e2b1e15d181` 输出 `{"courses": []}`, 日志显示: 第一次 `get_course_list()`(旧 cookie)读取空 → `login()` **登录成功** (16:44:26/16:47:25 两次) → 第二次 `get_course_list()` 仍然空; 而在项目根 cwd 下调试同一脚本**第一次就直接返回 13 门课程** (COOKIES_PATH 是相对路径 `cookies.txt`, 取决于 cwd: PHP 侧 `pyCmd` cd 到 `/tmp/AutomaticCB/` 用 `/tmp/AutomaticCB/cookies.txt`, 调试侧用项目根 `cookies.txt`), 证明**接口/解析器正常, cookie 状态是唯一变量**; ③**根因 (base.py `_cached_session` 缓存不失效)**: `init_session()` 默认分支把 session 缓存在模块级 `_cached_session` 里 (创建时一次性 `cookies.update(use_cookies())`, **之后永久复用**), 而 `login()` 成功后只 `save_cookies(_session)` 写磁盘新 cookie, **不清理缓存 session** → 第二次 `get_course_list()` 仍拿到持有失效旧 cookie 的 session → 超星返回未登录空页 → `decode_course_list` 解析出 `[]` → 自动重登逻辑被自身缓存抵消, 永远空列表; ④**次要根因 (空列表污染缓存)**: `chaoxing_api.php` 缓存判断 `strpos($json, '"courses"') !== false` — `{"courses": []}` 同样含 `"courses"` 子串 → **空列表也被缓存 300s**, 期间面板反复命中空缓存持续显示「暂无课程」; ⑤**修复**: ①`base.py login()` 成功后 `global _cached_session; _cached_session = None` — 下次 `init_session()` 重建 session 并加载新 cookie (核心修复); ②`init_session()` 默认分支每次调用时 `_cached_session.cookies.update(use_cookies())` 合并磁盘最新 cookie (同名覆盖/异名保留幂等, 覆盖扫码登录等外部进程更新 cookie 的长驻场景); ③`api_get_courses.py` login 后仍空则 `_fail("登录成功但课程列表为空, 可能触发验证码或风控...")` 报明确错误, 不再静默 `{"courses": []}` 误导前端显示「暂无课程」; ④`chaoxing_api.php` 空结果不写缓存 (`strpos($json,'"courses":[]') === false` 才写), 且顺手删除已存在的空缓存文件; ⑥**验证**: 备份 cookie 后置空模拟失效 → 脚本自动重登 → **第二次完整返回 13 门课程** (修复前同场景第二次为空); 清理空缓存后 HTTPS 全链路 `chaoxing_api.php?action=courses` 返回 13 门 + db_status (completed/in_progress/not_started) 正常; 有效 cookie 正常路径 0 次额外登录无回归; python 语法检查通过
- **2026-08-03**: 🐛 **Cloudreve 云盘面板空列表修复 + v2 面板重写 (目录导航 + 云盘主页通道)** — ①**现象**: 点击 Cloudreve 云盘入口按钮 (侧栏/顶栏两处), 面板只显示 "✅ 已登录 (xyq070519)" 和 "(空目录)", 文件列表永远为空; 且面板没有进入云盘 Web 主页的通道 (纯文本前 20 项, 无导航无按钮) ②**根因**: `cloudreve.js toggleCloudrevePanel` 的 `loadPanel` 取 `var items = fobj.files || fobj.data || []`, 但 `cloudreve_api.php` 的 list_files 走统一 `cr_success($data)` 包装, 真实结构是 `{"success":true,"data":{"path":"...","files":[{name,is_dir,size,updated_at}...]},"error":null}` → `fobj.files`=undefined (真实 files 嵌套在 `fobj.data.files` 里), `fobj.data`=**对象**非数组 → `Array.isArray(items)` 恒为 false → 无论云盘里有多少文件永远渲染 "(空目录)"; check_login 分支恰好用了 `obj.data || obj` 所以登录态显示正常, 掩盖了同构的解析问题 ③**修复 (cloudreve.js v2 面板重写)**: ①解析改 `(fobj.data && fobj.data.files) || []` (与 check_login 同构取 data 层); ②工具栏: 面包屑 (☁️ 我的云盘 → 各级目录**可点击跳转**, `data-cr-go` 属性), ⬆️上级 (路径去掉最后一段, 根目录禁用), 🔄刷新, 🌐**云盘主页** (`window.open(webUrl)`); ③**目录导航**: 文件夹行点击进入 — 路径用**原始文件名**拼接 (`_crPanelState.path` 相对 my/, 如 `实习资料/子目录`), 不用列表返回的编码 URI (`cloudreve://my/%E5%AE%9E...` 回传会被 `urlencode` 双重编码); ④文件图标按扩展名分类 (`crFileIcon`: 🖼️/🎬/🎵/🗜️/📝/📕/📊/📄), 文件夹排前 + 中文 localeCompare 排序; ⑤底部栏: 共 N 项 + 存储策略 + "在聊天中发送云盘指令可操作文件"; ⑥未登录态: 保留登录表单 + 已有账号 chips (点击填入邮箱) + 「🌐 打开云盘主页」「没有账号? 去注册」按钮 (`web_url + /signup`), 登录成功自动重新加载; ⑦**web_url 由后端提供**: `cloudreve_api.php check_login` 两种分支都返回 `'web_url' => 'https://' . $hostHeader` (前端零硬编码域名), 面板 `_crPanelState.webUrl` 缓存供主页/注册按钮复用; ⑧深色模式: 面板全部走项目 CSS 变量 (`--bg-surface/--text-primary/--border-color/--bg-muted/--primary`), style.css 新增 `.cr-*` 样式族 (overlay 毛玻璃遮罩 + cr-pop-in/cr-fade-in 动画 + 文件行 hover + 移动端 ≤480px 隐藏文件元信息); ④**验证**: Chromium CDP 真实浏览器全链路 — 注册测试账号 → 登录 → 点击云盘按钮 → 面板渲染出 **7 个文件夹** (软件安装包/实习资料/暑期社会实践_向奕侨/apitest/my/NUKITASHI/root账号遗留文件, 各带 📁 图标 + 日期) + 面包屑 + ⬆️上级/🔄/🌐云盘主页 按钮 + "共 7 项 · Default storage policy" 底部栏; Node 模拟旧逻辑复现 "(空目录)" bug、新逻辑正确提取 files, 面包屑/上级路径/文件夹优先排序逻辑全 PASS; index.html style.css?v=/cloudreve.js?v= bump 1785747131 强制拉新
- **2026-08-03**: 🎨 **Toast 通知 + 数据管理按钮主题联动优化 (v2)** — ①**现象**: ① 配置保存等提示在**亮色模式下也显示为黑色卡片** (深底白字, 与页面格格不入), 样式朴素 (小圆点字符图标 + 无动画); ② 设置面板「数据管理」6 个按钮 (导出/导入聊天记录、导出当前对话、知识库管理、强制刷新页面、恢复默认设置) 在暗色模式下各自半透明彩色底 (blue/green/emerald/indigo/amber/red 六色堆叠) 显得突兀 ②**Toast 根因**: style.css `.toast` 基础背景写死深色 `rgba(30,41,59,0.94)` + `color:#e2e8f0`, 亮色模式无任何覆盖 (`.dark .toast` 只是加深, 亮色下维持深色), 图标是 JS 内联的文本字符 (✓✕⚠i) 塞在 18px 小圆里 ③**Toast 修复**: 亮色 `rgba(255,255,255,0.94)` 白底 + `#1e293b` 深字 + 毛玻璃 `blur(16px) saturate(1.4)`, 暗色 `rgba(17,24,39,0.92)` 深底浅字; 类型色改 CSS 变量 `--toast-color` (info/success/error/warning), 暗色下全部提亮 (60a5fa/4ade80/f87171/fbbf24); 新增左侧 3px 类型色指示条 (`::before`), 图标改 22px 类型色圆徽章 + **SVG 描边图标** (对勾/叉/三角/圆点, ui.js `showToast` ICONS 表替换文本字符); 入场动画 `toast-in` (0.35s cubic-bezier(0.16,1,0.3,1): 右滑 28px + scale 0.96 → 回弹 -3px → 归位), 关闭按钮 hover 高亮; ④**数据管理按钮修复**: 6 个按钮统一 `.data-action-btn` 类 + `.action-{blue,green,emerald,indigo,amber,red}` 语义色变量 (`--action-color`): 亮色浅灰卡片底 `#f1f5f9` + 边框 `#e2e8f0` + 中性深字 + 语义色图标, hover 时边框/文字转语义色 + 图标 scale(1.1) + 浅阴影, active 按压 scale(0.98) 回缩; 暗色统一深灰底 `rgba(30,41,59,0.45)` + 中性浅字 (`#cbd5e1`) + **提亮语义色图标** (60a5fa/4ade80/34d399/818cf8/fbbf24/f87171), hover 底微亮 + 语义色边框 —— 暗色下整体协调不再突兀, 语义色只在图标/交互态呈现 ⑤**验证**: Chromium CDP 双主题像素采样 10 项断言全过 (亮色 toast 白底 `rgba(255,255,255,0.94)`/深字 `rgb(30,41,59)`/绿图标 `rgb(34,197,94)`; 暗色 toast 深底 `rgba(17,24,39,0.92)`/浅字 `rgb(229,231,235)`/亮绿图标 `rgb(74,222,128)`; 按钮亮色浅灰底 `rgb(241,245,249)`/蓝图标 `rgb(59,130,246)`; 暗色深底 `rgba(30,41,59,0.45)`/亮蓝图标 `rgb(96,165,250)`), toast 结构断言 (SVG 图标存在/::before 色条非透明/animation=toast-in/关闭按钮) 通过; index.html 全部 40 个 `?v=` bump 1785742200
- **2026-08-03**: 🐛 **头像下拉菜单错位修复 (absolute 包含块被容器劫持)** — ①**现象**: 已登录用户点击头像按钮，账户菜单 (个人中心/管理后台/退出登录) 不在头像正下方展开，整体向右偏移约 4 个按钮宽度，移动端更明显 ②**根因 (包含块劫持, 与 agentModePopup/蕾米小窗同源)**: `updateAuthHeaderBtn` 把 `#oneapiUserDropdown` (position:absolute, `right:0;top:calc(100%+8px)`) append 到 `btn.parentElement` 即 header 的 `.flex.items-center.gap-3` 容器下; 而 `style.css:2492` 移动端规则 `header .flex.items-center.gap-3 { position:relative; z-index:2 }` (桌面端含块则为 header 自身 `position:relative` + `backdrop-filter`) 使容器成为 absolute 后代的**包含块** — CSS 包含块规则只沿**祖先链**查找最近的 positioned 元素, 按钮自己设的 inline `position:relative` 对菜单**完全无效** (按钮不是菜单的祖先, 菜单是容器的子节点); 于是 `right:0` 对齐的是**容器右边缘**而非头像按钮右边缘, 而按钮左侧还有主题/刷课/云盘/设置 4 个按钮 → 菜单整体右移; `top:calc(100%+8px)` 的 100% 也解析为容器高度, 仅因 flex 行高与按钮等高才"碰巧"垂直方向接近; ③**修复 (与 agentModePopup 同方案)**: 菜单挂 **`document.body` 直下** (脱离 header/容器包含块, header 的 backdrop-filter 也不再劫持 fixed 后代), 定位方式 absolute → **`position:fixed`** + 新增 `positionOneapiDropdown()` 用 `getBoundingClientRect()` 视口坐标计算: `top = rect.bottom + 8` (下方空间不足且上方够时向上弹 `rect.top - h - 8`)、`left = rect.right - w` 右对齐按钮、左右视口 8px clamp; `toggleOneapiUserMenu` 打开时先显示再定位 (隐藏态测量尺寸), 并注册 `resize` + `scroll`(capture) 监听在菜单可见时重定位保持跟随; ④**验证**: Chromium CDP 实测 — 桌面 1280x800 (按钮 right=1064 → 菜单 right=1064, top=64=56+8) 与移动 390x844 (按钮 right=279 → 菜单 right=279, top=46=38+8) **deltaX=0/deltaY=0 精确对齐**; 极窄 320px 视口菜单完整在视口内 (left=69, right=209, 无越界); 滚动后菜单仍对齐且保持打开; index.html 全部 40 个 `?v=` bump 1785741900 强制拉新
- **2026-08-03**: 🐛 **exec/python 前端永远报"命令执行失败" (async await 遗漏)** — ①**现象**: 网页聊天里 `server_exec`/`server_python` 永远返回"命令执行失败"/"Python 脚本执行失败", 即使 ask_agent 授权后也一样; 文件类工具 (file_read/search/grep) 正常; ②**排查**: nginx access.log 显示用户请求全部 200 (exec 434B/106B), 引擎日志 (uvicorn) 显示 `POST /engine/exec` `POST /engine/python` **全部到达引擎且 200 OK** (引擎本身执行成功!), 失败发生在**前端解析响应**环节; ③**根因**: 8-02「长命令 exec 504 修复」引入 `_parseEngineJson(r)` (async 函数, 内含 `await r.text()` + JSON.parse) 替换 `await r.json()` 时, cloudreve.js 的 **exec 分支 (line 307) 和 python 分支 (line 326) 调用处漏写 `await`** — `var d = _parseEngineJson(r)` 拿到的 d 是 **Promise 对象**而非解析结果: `d === null` 恒 false (跳过网关错误分支), `d.ok` 恒 undefined → 走 `return { error: d.error || '命令执行失败' }` — **无论引擎返回什么 (包括成功), 永远报错**; 文件类工具分支仍用 `await r.json()` 所以正常, 完美解释"文件类正常、exec/python 全挂"的观测; ④**修复**: 两处调用加 `await` (`var d = await _parseEngineJson(r)`), index.html cloudreve.js?v= bump 1785741669 强制浏览器拉新; ⑤**验证**: Node 模拟确认 — await 版正常解析 `{ok:true}` 走成功分支, 无 await 版 Promise.ok 恒 undefined 永远报"命令执行失败" (与用户观测逐字吻合); 引擎日志 227 条 exec 记录确认请求链路本身无故障; 用户测试记录 (_generate_resumable msg[19]-[29]) 完整复现失败流程
- **2026-08-03**: 🛠️ **Server 类工具部分不可用全链路修复 (路径解析七重根因)** — ①**`server_tools.py` PROJECT_ROOT 少一层**: 文件位于 `python/engine/` 下, `Path(__file__).parent.parent` 只上溯 2 层 → 解析为 `/var/www/html/oneapichat/python` (少 `python` 到项目根那一层), file_write/file_write_chunked/file_append/file_op 的 allowed 根目录全错, 相对路径写入一律"写入权限受限"; ②**引擎进程 cwd 污染**: 引擎以 pm2/naujtrats 用户运行, 进程 cwd=/home/naujtrats, `Path("tempfile/x.md").resolve()` 解析到 `/home/naujtrats/tempfile/`, 既不在 allowed 内也写错位置; ③**`engine_server.py` 内联本地分支只允许 /tmp**: `_execute_tool` 的 server_file_write/append 本地分支 `allowed_prefix = TEMP_DIR + "/"` → 项目内写入全被拒 (agent 循环路径), server_file_read 同步补相对路径; ④**`file_op` locals() 赋值陷阱**: `locals()[path]=p` 在 Python 3 函数内不改变局部变量 → 相对路径转换与 `/oneapichat/` 前缀转换全部静默失效, 校验永远拿原值; ⑤**转发映射表缺条目**: `server_file_edit`/`server_file_grep` 不在 `_execute_tool` 的转发 dict 内 → 兜底 `GET /engine/server_file_edit` 404, 且 file_edit 端点要求 POST+JSON body 而转发走 GET; ⑥**`api-tools.js` append 语义丢失**: 18788 MCP server 把 `server_file_append` 路由到 `file/write` 端点但 body 无 append 标志 → 覆盖写而非追加, `execEngineProxy(ep, args)` 无工具名参数, 加 `toolName` 第三参; ⑦**引擎 file/write 不读 body 里的 append**: append/atomic 只从 query_params 读, JSON body 兼容补上 — **修复**: ①`parents[2]` 上溯 3 层; ②新增 `_resolve_path()` 辅助 (相对路径 join PROJECT_ROOT 再 resolve), file/read、write、write_chunked、append、file_search (find 前)、file_grep、file_edit (realpath 前) 全部套用; ③内联分支同规则 (允许 `/tmp/` + `PROJECT_ROOT/`); ④`file_op` 改 `_abs()` 内联转换函数 (显式赋值, 弃 locals()); ⑤映射表补 `server_file_edit: 'file_edit'`/`server_file_grep: 'file_grep'`/`server_file_append: 'file/write'`, 转发新增 file_edit POST JSON body 分支; ⑥api-tools.js `execEngineProxy(enginePath, args, name)` + `file/write` body 带 `append: isAppend || args.append`; ⑦引擎 file/write 读 body 的 append/atomic — **连带**: db_query 的 `learning_records.db` 路径 `Path(PROJECT_ROOT)/"python"/"chaoxing"/...` 随 PROJECT_ROOT 修正自动正确; server_python `cwd=PROJECT_ROOT` 使脚本内相对路径落到项目目录 — **验证**: MCP 直连 + engine_api.php mcp_proxy 双链路 15 项回归 (write/append 追加语义/read/edit/grep/search/op mkdir+rm/python cwd/sys_info/ps/disk/network/docker/db_query) 全过, python/tests 核心 4 项 OK; 排查中发现的 127.0.0.1:80/443 Host 头空回复 (nginx 测试侧问题, 真实域名正常) 未改动
- **2026-08-02**: 📱 **工具调用卡片移动端溢出 + 键盘弹起后底部空白 (双修复)** — ①**工具卡片溢出**: `createToolCallCard` 的 `tool-exec-summary` 是 `display:flex` 容器, 命令文本作为**匿名 flex item** 直接放入, 无 `min-width:0`/`word-break`/`overflow-wrap` → 命令中不可断 token (URL/路径/长参数) 无法换行, 390px 屏上横向溢出卡片; `tool-call-args`/`tool-exec-output` 两个 pre 也无换行保护; 修复: 命令包进 `<span style="flex:1;min-width:0;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap">`, 参数/输出/结果 pre 统一 `white-space:pre-wrap;word-break:break-all;box-sizing:border-box;max-width:100%` ②**键盘空白主因**: iOS Safari 在输入框**保持焦点**时收起键盘 (点键盘「完成」/下滑收键盘/点发送后点别处) 可能**不派发 visualViewport resize/scroll 事件** (根元素 `overflow:hidden` 时尤甚) → `--vvh` 停留在键盘弹起时的小高度 → `.h-screen` 保持短高 → 输入框下方空一大截; 原代码无任何兜底 (无轮询/无交互监听/`focusout` 因焦点未失不触发) → 状态可无限期错误; 修复: ① 1s 低频**看门狗轮询** (`scheduleViewportSync` rAF 节流 + 脏检查 — 数值未变不写 DOM, 零成本), 任何事件丢失 1s 内自愈; ② `document` 级 `pointerup` 监听 (无 PointerEvent 时 `touchend` 兜底), 用户第一次点按即恢复; ③ **scale 守卫重构**: 旧逻辑 `scale≠1` 直接 return 会**永久冻结** --vvh (捏合/双击缩放后 scale 保持 1.x, 所有后续更新全被跳过); 改为缩放进行中 (scale 逐帧变化) 仅跳过实时帧, 回稳定时器 (120/420ms, 事件停止后才触发) 以 `force` 兜底应用 —— viewport.height 本身是 CSS 像素已含缩放效果; ④ 回稳定时器 force=true: 是缩放/键盘动画的最终收敛路径 ③**验证**: 新增 `tests/keyboard_viewport.test.js` 8 场景 (初始全高/键盘弹起收缩/★事件丢失看门狗自愈/pointerup 恢复/失焦恢复/稳定缩放应用/捏合跳过帧后收敛/脏检查零写入) + `tests/tool_card_overflow.test.js` 6 场景 (命令 span 换行规则/长命令原文保留/参数输出结果 pre 宽度约束), 全部通过; 前端 JS `node --check` 通过; index.html 全部 39 个 `?v=` cache key bump 1785684092
- **2026-08-02**: ⏱️ **长命令 exec 504 网关超时修复 (三层边界)** — ①**现象**: Agent 执行 `sleep 300; ...进度检查...` (timeout=360) 时返回 `引擎API错误(exec): Unexpected token '<', "<html><h"... is not valid JSON`, 浏览器网络面板显示 `engine_api.php` 504; 更早一次同链路还出现 `Failed to fetch` ②**根因 (三层边界)**: ⓐ 引擎 `python/engine/server_tools.py` 的 `/engine/exec` 把 subprocess 超时**硬截断** `timeout=min(timeout, 300)` — 工具声明超时 360s 实际只给 300s, `sleep 300` + 后续检查 ≈ 305s 必然 TimeoutExpired; ⓑ nginx `~ \.php$` 位置 `fastcgi_read_timeout 300s` — PHP 请求持满 300s 时 nginx 返回 **504 HTML 错误页** (引擎的 JSON 超时响应恰在 300s 边界抵达, 时而透传成功时而 504, 表现为间歇性失败); ⓒ 前端 `cloudreve.js engineApiHandler` exec/python 分支无条件 `r.json()`, 504 HTML 被 JSON.parse 抛出晦涩的 "Unexpected token '<'" ③**修复**: ⓐ 引擎截断 300→900s (注释说明与 nginx 边界的关系); ⓑ nginx 两处 PHP location `fastcgi_read_timeout/fastcgi_send_timeout` 300s→900s + reload; ⓒ 前端新增 `_parseEngineJson(r)` 防御解析 (text→JSON.parse, 失败返回 null), exec/python 分支对非 JSON 响应返回可读错误 `引擎网关错误 (HTTP 504, 网关超时 — 命令可能仍在后台执行, 请稍后查询文件/进程状态)` ④**验证**: 引擎直连 310s 命令完整返回 `{"ok":true,"exit_code":0,"stdout":"DONE_AFTER_310s"}`, 突破旧 300s 截断; python 语法/JS `node --check` 通过; 引擎已重启 (watchdog 拉起, 健康检查 ok); cloudreve.js cache bump 1785682797

- **2026-08-02**: 🎨 **新建对话按钮恢复渐变主色 + 全量缓存版本修复** — ①**现象**: 用户反馈"样式变丑了，原来的颜色没了"，具体是侧边栏「新建对话」按钮从紫蓝渐变胶囊变成白底细紫边 ②**根因排查 (nginx 访问日志取证)**: 用户 iPhone 于 19:16/19:28/20:19 三次拉取 style.css (压缩体积 42862/43442/43752 字节), 20:19 起稳定命中 43752 字节版本 — 即 19:48 的「原 UI 保守优化」收尾改动, 该改动把新建对话按钮从史诗级 v2 渐变主色还原为白底 (CSS 注释「克制精致」); 用户设备在 19:28-20:19 短暂看到渐变版后于 20:19 起看到白版 → 误以为颜色消失 ③**缓存版本过期**: 排查中发现 style.css 在 19:35 版本号固定后 19:48 又被修改 (mtime 1785671319 > v=1785670500), 且 core.js/agent.js/cloudreve.js/tools.js/tools-exec.js/update-check.js/files.js/image-gen.js/netdisk.js/queue.js 等 10+ 文件同样存在版本号早于 mtime 的过期问题 (用户浏览器可能长时间命中旧内容) ④**修复**: ① 新建对话按钮恢复渐变胶囊 — `linear-gradient(135deg, #6366f1, #3b82f6)` + 白字 + `0 2px 10px rgba(99,102,241,0.35)` 投影 + hover 上浮 translateY(-1px) + 图标旋转, 深色模式同渐变; ② index.html 全部 40 个 `?v=` 缓存参数统一 bump 为 1785682488 (含 CSS/JS/KaTeX 等), 强制所有设备下次加载全量拉新 ⑤**验证**: Chromium CDP 像素采样 — 浅/深色模式按钮左端 #5e69f1 → 右端 #3f7ff5 渐变正确、白字白图标; 弹层对齐回归 deltaX=0、popupParent=BODY 无回归

- **2026-08-02**: 🐛 **Agent 模式菜单普通模式错位修复 (fixed 包含块被 header 毛玻璃劫持)** — ①**现象**: 普通模式 (Agent off) 下悬停 Agent 按钮，Plan/Agent/YOLO 二级菜单整体向右偏移 258px (侧边栏宽度)，悬停落点与按钮完全错开；切到 Agent/Plan/YOLO 模式后菜单又恢复对齐 ②**根因**: 「史诗级 UI v2」给 `header` 加的毛玻璃 `backdrop-filter: blur(14px) saturate(1.5)` 按 CSS 规范使 header 成为 `position:fixed` 后代的**包含块**；`_positionModePopup()` 用 `getBoundingClientRect()` 拿到的**视口坐标** (如 left:274px) 直接写进 `popup.style.left`，浏览器渲染时相对 header 的 padding box (视口 x=258) 偏移 → 实际渲染在 274+258=532px；普通模式侧栏展开 header 起点在 258px 所以肉眼可见错位，Agent 模式侧栏收起 header 起点归 0 恰好掩盖 (与历史 bug 「configPanel transform 劫持蕾米小窗 fixed 定位」同根因) ③**修复**: `#agentModePopup` 从 `.agent-mode-wrapper` 内移出，挂在 **`</body>` 前 body 直下** (注释标明 ⚠️ 原因)，与蕾米小窗的既有修复方案一致；弹层 CSS 全部为独立类选择器、JS 全部按 ID 引用，零代码改动；悬停开/关链路不变 (wrapper mouseleave 200ms 延时 + popup mouseenter 取消，与原先 popup 几何上已在 wrapper 盒外时的行为完全一致) ④**验证**: Chromium CDP 真实鼠标事件实测 — 普通模式悬停 popup x=274 = wrapper x=274 (修复前 532, deltaX +258)、Agent 模式 x=66 对齐、切回普通模式再悬停仍对齐 (deltaX 全为 0, deltaY 4px 贴按钮下沿)；悬停移入 popup 保持打开、移开 200ms 后关闭；页面 0 JS 错误

- **2026-08-02**: 🐛 **LongCat max_tokens 超限 400 全链路修复** — ①**现象**: 切换 LongCat-2.0 后每次请求直接报 400 `参数校验失败: \n/max_tokens: 389120 is not less or equal to 131072\n`, RS 与 HTTP 直连双路径都失败 ②**根因链 (四层)**: ⓐ LongCat `/models` 元数据报 `context_length≈409600` 且 `max_tokens≈389120` (0.95×context), `config.js` fetchModels 无条件把 `m.max_tokens || ctx` 持久化进 `modelMaxOutputTokens`; ⓑ `models.js getMaxOutputTokens()` 优先返回学习值 389120, 覆盖了精心维护的静态配置 131072 → `main.js` ModelCap 钳制失效 (`389120 > 389120` 为假), body 原样带 389120 出门; ⓒ LongCat 400 响应以**无换行结尾**的 `{"error":...}` JSON 返回, `stream-handler.js` done 分支解析它时只认 `choices`, 错误被静默丢弃且不抛异常 → `AutoAdjust`/400重试机制根本收不到错误, 只能看到"空响应"; ⓓ 即使走到 400重试, 正则 `/max_tokens.*?(\d{4,})/` 在 `max_tokens: 389120 is not less or equal to 131072` 上抓到的是**发送值 389120** 而非**限制值 131072**, 并把错误值持久化回 localStorage ③**修复**: ⓐ `getMaxOutputTokens` 改为 `min(学习值, 静态配置)` — 学习值只收紧不放宽 (API 错误揭示更小真实限制时仍生效, 虚高元数据被静态上限封顶) → ModelCap 正确钳制到 131072, 请求不再触发 400; ⓑ `config.js` 输入框上限同样经 `getMaxOutputTokens` 钳制, 不再把 389120 写进 maxTokens 输入; ⓒ 400重试正则重排: `is not less or equal to (\d+)`、`max_tokens.*?(≤|<=\s*|<)\s*(\d+)` 等限制值模式置于通用 `max_tokens.*?(\d{4,})` 之前; ⓓ `stream-handler` done 分支把 `jd.error`/`status≥400` 检测移到 `try/catch(e2){}` **之外** (放 try 内会被静默吞掉), 检测到即抛出 `[Provider N] ...` 让主流程 AutoAdjust 修复后重试 ④**验证**: 新增 `tests/model_max_tokens.test.js` 5 项回归 (LongCat 学习值 389120→131072 / 无学习值→131072 / 低学习值生效 / 未知模型回退 / 相等值), 端到端模拟 body.max_tokens 修复后为 131072、RS tokens 131072、重试提取限制值 131072; 全部前端 JS `node --check`、54 项 Python unittest 通过; index.html 四个 JS cache key bump `v1785790001`

- **2026-08-02**: 🧩 **工具/技能配置面板重复块修复** — ①**现象**: 每次打开配置、切换 Agent 状态或收到 Agent 通知后，面板都会新增一组“技能 (Skills)”和“工具 (Tools)”标题，最终形成多段空标题，实际技能卡只出现在最后一段 ②**根因**: `renderToolPanel()` 的清理选择器仅覆盖 `.skill-card` 与 `.tools-category-section.dynamic`，遗漏 `.skills-section-header`、`.skills-section-desc`、`.tools-section-header`；随后又使用 `insertAdjacentHTML('beforebegin')` 持续追加，而且锚点取 `#customSkillsList`，导致动态内容落在静态“自定义技能”标题之后 ③**修复**: `#toolToggleContainer` 新增唯一 `#toolPanelDynamic` 根节点，所有动态标题、卡片和工具分类一次性写入该节点；每次渲染用 `innerHTML` 整体替换，使并发/重复调用天然幂等，正确固定在“自定义技能”区域之前 ④**兼容清理**: 渲染前遍历父容器直系子节点，主动移除旧版本遗留的标题、说明、技能卡和动态分类；若旧缓存 HTML 尚无动态根节点，JS 会自动创建并放到正确位置 ⑤**验证**: 真实 Chromium 390×844 移动视口连续调用 10 次，始终为 Skills 标题 1、Tools 标题 1、说明 1、技能卡 13、工具分类 18；额外注入 5 类旧版残留节点后再次渲染，残留数归零、动态根唯一、无父级泄漏；全部前端 JS 语法、54 项 Python unittest 与 diff whitespace 检查通过，相关前端缓存版本已更新。

- **2026-08-02**: 🐱 **配置取消换色 + LongCat 全链路稳定性修复** — ①**取消按钮换主题根因**: `cancelConfig()` 恢复快照后会重新执行 `initializeConfig()`，旧 `toggleDarkMode(true)` 无论是否初始化都调用 `classList.toggle('dark')`，因此每取消一次就反转一次主题；改为按持久化值幂等同步 `classList.toggle('dark', dark)`，初始化不写存储、用户点击才反转，并让移动端打开配置时同样建立快照，思考模式也纳入取消恢复范围 ②**官方协议对齐**: 依据 LongCat Platform 文档固定官方当前模型 `LongCat-2.0`，OpenAI 路径使用 `/openai/v1/chat/completions`、Anthropic 路径使用 `/anthropic/v1/messages`；`thinking.type` 只发送 `enabled/disabled`，独立配置项默认 `disabled` 以确保普通问答快速产生正文，设置面板在 LongCat 下显示“开启思考/关闭思考” ③**消息格式**: LongCat 识别统一覆盖模型名、官方 base URL 与 provider；OpenAI 路径仅对 LongCat 将 content block 降为纯文本并剥离历史 `reasoning_content/reasoning_details`，Anthropic 路径保留 `text/tool_use/tool_result` block 且 system 只放顶层，避免旧版无条件清洗破坏其他模型及 Anthropic 工具消息 ④**中断根因**: Anthropic SSE 解析器把事件名定义在每次 `reader.read()` 内，`event:` 与 `data:` 被 TCP 分片拆开时会丢事件；现将事件状态跨 read 保留，并兼容无空格 `event:/data:` 与 JSON 内 `type`。RS 前端的恢复调用另有 6 参数函数只传 5 参数的问题，导致 msgId/chatId/pendingMsg/中止信号整体串位，已改为正确参数并统一走断线重连 ⑤**推理-only兜底**: LongCat 开启思考且 token 较小时可能以 `max_tokens` 结束，只有 reasoning 没有正文；引擎现透传 `stop_reason/truncated` 到 SSE、磁盘快照和恢复结果，前端不再把它误判成成功，自动关闭思考重试一次且设单次守卫防循环；LongCat 全链路超时提升到 600 秒 ⑥**后端防御**: Python OpenAI/Anthropic RS 均二次固定模型、默认关闭思考、过滤不兼容历史字段，Anthropic 恢复请求补传顶层 system；官方 OpenAI SDK 请求增加 LongCat `extra_body.thinking`，两个协议均记录结束原因 ⑦**发布与验证**: 更新相关 JS cache key；Chromium 390×844 移动视口验证深/浅主题取消均不换色、思考控件与消息清洗 6 项断言全过；官方真实 Anthropic RS 返回 `LONGCAT_OK`（`end_turn`），OpenAI RS 返回 `LONGCAT_OPENAI_OK`（`stop`），均正文完整/推理为 0；思考开启+128 token 场景正确得到 reasoning-only + `max_tokens/truncated=true`；全部前端 JS 语法、API PHP lint、Python 编译、52 项 unittest 与 diff whitespace 检查通过，引擎已重启上线。

- **2026-08-02**: 📱 **iOS Safari 底部视口定稿 + 输入栏收敛** — ①**实机遗留现象**: iPhone Safari 地址栏展开/收起后，页面布局高度可滞留在旧值，输入栏下方多出约 53px 空白；键盘弹出与收起时也可出现底距未回稳、占位文本换行和按钮拥挤 ②**根因**: 旧逻辑只依赖单次 visualViewport resize/scroll，Safari 工具栏动画的中间帧可最后写入过期 `--vvh`；同时输入区旧移动覆盖叠加 margin/padding，textarea 右内边距与发送按钮占位重复 ③**视口修复**: `setupKeyboardDetection()` 改为幂等绑定，统一监听 visualViewport `resize/scroll/scrollend`、window `resize/orientationchange/pageshow`、可见性和 focus 变化；每次以 RAF + 120/420ms 两次回稳采样，忽略双指缩放，按方向重建基准，仅在控件聚焦且视口缩减超过 `max(120px, 18%)` 时标记 `.keyboard-open`，同步 `--vvh` / visualViewport 指标 / `--keyboard-height` ④**输入栏修复**: 移动容器直接消费 `--vvh`，普通状态只保留 `safe-area-inset-bottom`，键盘状态收为 6px；回收重复内边距，附件/搜索键统一 36px（≤360px 时 34px），发送键 38px，textarea 单行 40px；占位态 `nowrap + ellipsis`，真实内容恢复 `pre-wrap` 以保留多行自适应 ⑤**高度化验证**: Chromium CDP 模拟 iPhone 390px + 顶部 47px/底部 34px 安全区；Safari 工具栏 791→844px 后 `--vvh` 同步为 844px、底距精确 34px，不再留下 53px 空白；键盘模拟 544px 时底距 6px/关闭回 34px；双行输入高度 50→74px；360px 窄屏下 header/body 横向溢出均为 0 ⑥**发布**: `style.css` 与 `main.js` cache key 更新为 `1785670500`。

- **2026-08-02**: 📱 **iPhone 顶栏控件精准对齐** — ①**实机现象**: 刘海屏 iPhone 顶栏中菜单、Agent、模型、账号与图标按钮的上下基线不一致，较大的圆形控件越过 header 下边界并压住聊天内容 ②**根因**: 项目中三层 `@media (max-width:786px)` 规则互相覆盖；`.agent-split-btn button` 以 24px 内容高再叠加 14px 纵向 padding（约 38px），`#modelSelect` 约 22px，圆形按钮约 29px，而 header 最小高度仅 40px；再叠加 `safe-area-inset-top` 后视觉中心进一步分散 ③**修复**: 在原 UI 样式末尾增加纯几何收敛层，不改变颜色/圆角/图标；header 改为“顶部安全区 + 6px + 32px 控件行 + 6px”独立计算（内容栏 44px），左右直属 flex 行、菜单、Agent 两段按钮、模型 select、登录头像与右侧操作入口统一 32px 高并清除冲突 margin/padding，窄屏账号固定 32px，移动标题胶囊从完整 header 下沿定位 ④**回归**: Chromium CDP 使用 375×844、390×844、390×844 + 47px 顶部/34px 底部安全区三档量测，并覆盖未登录和 `RootUserWithVeryLongName@example.com` 登录头像状态；全部控件中心线偏差 `0px`、底部越界 `0px`、body 横向溢出 `0px`，截图确认内容不再穿入顶栏 ⑤**发布**: `style.css` cache key 更新为 `1785669800`，避免 iPhone 继续命中旧缓存。


- **2026-08-02**: 🧹 **原 UI 保守优化 + 隐性稳定性修复** — ①**视觉方向**: 撤回大幅 UI 重构，恢复原项目的 `Hi, Nice to meet you!` 欢迎字效、圆形输入框、侧栏/顶栏/设置面板和原明暗主题；仅保留移动端 `.chat-title-mobile` 取消桌面渐变裁剪的修复，解决标题占位存在但文字透明 ②**工具消息**: 原批量折叠逻辑只在首张卡创建时扫描兄弟节点，后续工具卡尚未插入，导致第 2 张以后永久隐藏且没有展开入口；改为每次追加后同步首卡计数与真实 `<button>`，补 `aria-expanded`，验证 3 卡默认隐藏 2 卡且可完整展开 ③**图片灯箱**: 统一关闭路径并移除 document 级 mousemove/mouseup/keydown 监听，恢复 body overflow 与原焦点；补 dialog/按钮/图片语义；修复仅有 `serverUrl` 的图片无法放大、切图文件名不更新以及原生链接与脚本链接造成重复下载 ④**面板状态**: 设置/侧栏/Agent 面板统一 `inert`、`aria-hidden`、`aria-expanded` 和遮罩/滚动锁；修复移动抽屉打开后跨断点仍 `overflow:hidden`、标题在桌面/移动父容器之间错位、保存配置后主区残留 `config-open`、Agent 面板重复绑定监听及关闭后刷新定时器继续运行 ⑤**认证与可访问性**: 登录表单 label/类型/tab 语义、图标按钮名称、图片 alt、toast live region 完善；用户名与头像首字母写入 `innerHTML` 前统一 `escapeHtml`，用户下拉不再非法嵌套在 button 中；浏览器审计为 0 重复 ID、0 无名称按钮、0 缺失 alt ⑥**依赖可靠性**: 将固定版本 JSZip 3.10.1 收入 `public/lib/lib/jszip.min.js`，PPT/PPTX 解压不再依赖 jsDelivr 在线可用性 ⑦**cron 隐性竞态**: 全量测试虽显示 OK，但后台线程在临时目录销毁后仍抛 `FileNotFoundError`；新增 stop event、可中断 `Popen`、POSIX 进程组 TERM/KILL、PIPE 回收、线程注册表锁和 join 收尾，避免停止后残留进程/线程与重复任务；测试补充停止后注册表断言 ⑧**验证**: Chromium 真实页面桌面 1440×1000、移动 390×844、浅色/深色、侧栏、设置、登录、工具批次、灯箱、跨断点回归；52 项 Python unittest（`ResourceWarning` 按错误处理）全部通过；全部前端 JS `node --check`、API PHP lint、Python compileall、`git diff --check` 通过。

- **2026-08-02**: 🪟 **蕾米头像放大小窗 (点击放大头像细节)** — ①**功能**: 点击聊天内可见的蕾米头像 (最新助手消息) → 屏幕左下角弹出固定小窗 (222×243px 毛玻璃卡片), 窗内 190px 圆形 GIF (源图 300×340, 相比桌面 52px / 移动端 40px 头像约 4 倍放大, object-fit:cover 同构图); 弹窗期间聊天内**所有**小头像隐藏 (包括新消息冒出的), 关闭后恢复 ②**交互**: ✕ 按钮 / 点击小窗外任意处 / Esc 三种方式关闭; 弹出动画 remi-zoom-in (0.28s scale+translate 弹性); 关闭瞬间头像恢复无残留 ③**表情同步**: `applyMood` 在 `body.remi-zoom-open` 时同步更新 `#remi-zoom-img` src + `#remi-zoom-title` 文案 (思考中/创作中/完成! 等实时联动, 与聊天内头像 Gif 完全一致) ④**实现**: index.html 末尾新增 `#remi-zoom-window` 容器 (hidden 初始); style.css 追加 `.remi-zoom-*` 样式区块 (fixed left:16 bottom:16 z-index:9000, 深浅色双主题, header 标题+关闭按钮, body 圆形大图, `body.remi-zoom-open .message-row.assistant .avatar { visibility:hidden !important }` 全局隐藏规则, 桌面头像加 cursor:pointer); model-status.js 新增 `openRemiZoom()/closeRemiZoom()/getVisibleAvatarImg()` + container 委托点击监听 (`.avatar-remi-gif` 触发) + document 点击关闭 (排除小窗本体与头像本身 — 头像点击的冒泡事件不能立即关窗) + Esc 监听, 导出 `window.openRemiZoom/closeRemiZoom` ⑤**移动端 (≤786px)**: 贴纸头像默认 `pointer-events:none` 仅放行可见头像 `:not(.remi-avatar-hide)`; 小窗缩小至 200px (图 168px) 并上浮至输入框上方 `bottom: calc(env(safe-area-inset-bottom) + 80px)` 不遮挡输入 ⑥**验证**: 临时测试页 (复刻 chatBox 结构加载真实 model-status.js+style.css) Playwright 14 项断言全过 — 初始头像可见/小窗关闭 → 点击打开+小头像隐藏+窗图=头像图 → typing 激活后标题"蕾米 · 思考中"+thinking.gif 同步 → ✕关闭+头像恢复 → 再开+点空白关闭 → Esc 关闭; 几何断言: 桌面 left:16/bottom:16, 移动端 left:10/bottom:80 + pointer-events:auto; 测试文件与浏览器会话已清理。涉及: index.html(model-status.js v9→v10, style.css v4→v5, 小窗容器) style.css(小窗区块) model-status.js(开闭逻辑+applyMood 同步)

- **2026-08-02**: 🪟 **蕾米放大小窗 v3 — PIP 式持久悬浮窗 (点输入框不再缩回 + 可拖动)** — ①**用户反馈**: 点击输入框小窗就缩回, 且不能拖动 ②**根因**: v1 的「点击小窗外任意处自动关闭」逻辑 — 输入框位于左下角紧邻小窗, 点输入框准备打字时触发 document click 关闭, 小窗无法保持; 小窗本身无拖动手柄 ③**修复A (持久化)**: 移除 document click 关闭监听, 关闭仅保留 ✕ 按钮 + Esc (小窗保持期间可正常点输入框打字/点聊天内容, 不再误收); 表情同步/小头像隐藏逻辑不变 ④**修复B (拖动)**: 小窗头部 (`.remi-zoom-header`) 作为拖动手柄 — `pointerdown` 记录起点 (排除关闭按钮点击, 鼠标仅左键) + `setPointerCapture` → `pointermove` 计算位移写入 `style.left/top` (首拖时读 getBoundingClientRect 转 top/left 定位, `bottom:auto` 覆盖 CSS 默认 bottom) → `pointerup/pointercancel` 结束; 视口 clamp: 水平/垂直至少留 56px 可抓回 (防拖丢); 拖动中加 `.remi-zoom-dragging` (取消入场动画 + 加深阴影), 头部 `cursor:grab/grabbing` + `touch-action:none` (触摸拖动不触发页面滚动, iOS 兼容); pointer 事件统一鼠标/触摸 ⑤**位置保持**: 拖动后的 top/left 内联样式跨 开关 保持 (PIP 式记忆位置), 首次打开仍按 CSS 默认落左下角 ⑥**验证**: 真实页面 Playwright — 点输入框(#userInput)后小窗仍开 ✓ 点聊天空白仍开 ✓ 拖动头部位置变化且保持打开 ✓ 拖出视口被 clamp (留 56px 可抓回) ✓ Esc/✕ 关闭 ✓ 关闭后重开恢复拖动位置 (416,341) ✓ 移动端 375px 触摸 pointer 拖动生效 ✓ 全程 0 页面错误。涉及: model-status.js(v11→v12: 移除外部点击关闭+新增拖动) style.css(v5→v6: 头部 grab/touch-action+拖动态样式) index.html(版本号)

- **2026-08-02**: 🐛 **蕾米放大小窗 v2 修复 — position:fixed 被 configPanel transform 劫持 + 重复副本** — ①**用户反馈**: 点击头像小窗不显示 ②**根因A (fixed 包含块劫持)**: 首次实现把小窗容器插在 `<!-- ★ QR码弹窗容器 -->` 之前, 而该位置位于 `#configPanel` (300px 设置面板, `hidden-panel` 常态离屏) 内部; `#configPanel` 带 `transform: matrix(1,0,0,1,20,0)` (translateX 滑入动画残留) → 按 CSS 规范 transform 祖先成为 `position:fixed` 的**包含块**, 小窗的 `left:16/bottom:16` 变成相对 300px 面板定位 → 渲染进离屏/裁剪面板内不可见 (与历史 bug 「网盘 QR 弹窗不可见 → 改用消息行注入」同根因, QR overlay 也躺在面板里) ③**根因B (重复节点)**: 修复移动时第二处 Edit 只**追加**了 body 级副本, 面板内旧副本未删除 → 页面同时存在 2 个 `#remi-zoom-window`, `getElementById` 命中面板内旧节点, `openRemiZoom` 打开的是不可见的那份 ④**修复**: ① 删除面板内旧副本, 唯一容器移到 `</body>` 前** body 直下** (注释标明 ⚠️ 必须挂 body 直下 — transform 祖先会劫持 fixed) ② model-status.js `openRemiZoom()` 加运行时兜底: `win.parentElement !== document.body` 时 `document.body.appendChild(win)` (防御未来 DOM 结构调整) ③ 版本 v10→v11 强制拉新 ⑤**验证**: 真实页面 Playwright 全链路 — 注入消息后点击头像 → `parent:BODY` + 小窗打开 (rect left:16 bottom:884/900 → 视口锚定正确) + 小头像隐藏 + 关闭按钮/点空白/Esc 三种关闭均恢复; 移动端 375px: left:10 bottom:732/812 (输入框上方); 全程 0 页面错误; `grep -c` 确认唯一副本。涉及: index.html(移除面板内副本+body 直下挂载+注释) model-status.js(appendChild 兜底) CLAUDE.md

- **2026-08-02**: 📱 **移动端竖屏 v3 — 蕾米「气泡贴纸」对齐 + 紧凑密度** — ①**根因**: 蕾米头像只在最新助手消息显示, 但 `remi-avatar-hide` 用 `display:none` → 头像列在流内占位时有时无, 最新气泡左边缘相对上方气泡位移 ~34px (手机端 90% 居中气泡 vs 42px 头像+间距), 弹出/缩入动画期间布局抖动 ②**桌面端 (≥787px) 修复 — 保留占位列**: `.remi-avatar-hide` 改 `display:none` → `visibility:hidden`, 所有助手行常驻 52px 头像列, 气泡几何完全一致, sticky 头像行为保留 ③**移动端 (≤786px) 修复 — 气泡贴纸**: `.message-row.assistant` 加 `position:relative`, 头像改 `position:absolute; left:-8px; top:8px; width:40px` 完全脱离文档流 → 头像显隐与气泡位置零耦合, 动画不再挤压布局; 最新气泡经 `:has(.avatar:not(.remi-avatar-hide))` 让出 `padding-left:46px` (文字不被贴纸遮挡, padding 过渡 0.3s 平滑), 贴纸加白环阴影 (`0 0 0 2px #fff` 深色 #1f2937) 呈「蕾米挂在自家气泡角上」效果 ④**首帧闪烁消除**: `rendering.js` appendMessage 助手头像默认加 `remi-avatar-hide` (仅 assistant 角色, system 行蕾米头像保留), 由 model-status.js 放行最新行 — 不再出现加载瞬间全部头像闪现 ⑤**移动端紧凑密度**: header padding 0.35rem/min-height 40px, modelSelect 84px 宽(保留 1.6rem 自定义箭头右距), agent 标签 26px, auth 按钮缩小; 灵动岛胶囊瘦身 (top 42px/60% 宽/0.72rem); 消息容器 gap 1rem→0.7rem + padding 0.7rem, message-row gap 0.5rem, 气泡 padding 10px 12px (含 `.bubble.assistant` 特异性覆盖), 助手 wrapper max-width 90%→95%; 思维指示器紧凑; 输入区: 内边距 0.4rem 0.5rem + safe-area, textarea min-height 40px + **font-size 16px (防 iOS 聚焦自动缩放)**, 附件按钮/发送按钮 38-40px 微缩; ≤480px 隐藏模型刷新按钮 + 侧栏 258→240px ⑥**触控细节**: `touch-action:manipulation` 禁双击缩放延迟, `overscroll-behavior-y` 禁下拉刷新冲突 (html/body none, chatBox contain), `-webkit-tap-highlight-color` 透明; viewport meta 加 `viewport-fit=cover` (刘海屏 safe-area) ⑦**顺带修复**: style.css 括号不平衡根因 — `.tool-status-bar {` 选择器丢失 (HEAD 即存在), 声明悬空 + 多余 `}` 吞规则, 恢复选择器后 1739/1739 平衡 ⑧**验证**: 本地 8080 直连实测 — 临时账号注入 3 条助手消息, 页面渲染正确, 蕾米测试对话标题/消息列表/最新气泡正常; 对齐由 CSS 确定性保证 (桌面占位列 + 移动端绝对定位); 测试账号与数据已清理。涉及: rendering.js(默认隐藏头像) style.css(remi-avatar-hide 语义 + 末尾移动端 v3 区块 + tool-status-bar 修复) index.html(viewport meta)

- **2026-08-02**: 🎨 **史诗级 UI v2: 侧边栏/顶栏/面板视觉升级** — ①**顶部 header**: 毛玻璃背景(`backdrop-filter: blur(14px) saturate(1.5)`, 浅色 rgba(248,250,252,0.78)/深色 rgba(10,14,25,0.72)) + 底部渐变高光线(::after, 紫→蓝渐变); 图标按钮统一弹性动效(上浮+hover 阴影+图标旋转 15°+active 缩放); 模型选择器改渐变边框胶囊(自定义 SVG 下拉箭头, appearance:none, 600 字重, hover 光晕); 中央对话标题改渐变文字(clip-text 紫→蓝→紫) ②**左侧侧边栏**: 渐变背景(径向紫色光晕 + 线性浅色渐变, 深色 #141b30→#0e1424); 品牌区升级 — "历史记录"→"对话记录" + 渐变紫图标徽章; 新建对话按钮改渐变主色(6366f1→3b82f6)胶囊+投影+悬停上浮; 历史条目卡片化 — 每条加对话气泡图标, 当前项左侧渐变指示条+浅紫背景+内边框, hover 淡紫高亮, 删除按钮 hover 才现+红色反馈; **今天/昨天/更早时间分组**(renderChatHistory 按 updated_at 分组渲染, 分组标签大写字母间距); 底部上下文压缩/标题生成设置区改玻璃卡片(border-radius 14px + 分类标题渐变竖条) ③**配置面板**: config-section 卡片化(圆角+半透明底+悬停紫边光晕), 分类标题左侧渐变指示条, 展开时标题变紫色 ④**代理面板**: 头部渐变紫强调块(圆角卡片) ⑤**主题适配**: 深浅色全覆盖 + 移动端(≤786px) modelSelect padding 压缩/header 背景加实 ⑥**验证**: 浏览器实测 — 侧边栏分组渲染正确(今天5条/昨天4条/更早21条), 深色模式切换正常无 JS 错误。涉及: index.html(sidebar 品牌区+新建按钮+chatHistoryList 去 space-y) dialogs.js(renderChatHistory 分组+图标+新 class) style.css(末尾追加史诗级 UI v2 区块)

- **2026-08-02**: 🎨 **UI/滚动跟随/流式渲染全面优化 v1** — ①**滚动跟随系统重做**: 新增 `public/js/scroll-follow.js` — 根因: `#chatBox` 的 `scroll-behavior:smooth` 与程序化 `scrollTop=` 赋值冲突, 平滑动画的中间 scroll 事件被误判为用户滚动 → 跟随静默死亡(D1); 位置匹配法覆盖面不全(D2)、无 touch/wheel 预处理(D3)、异步内容长高无兜底(D6)。修复: 移除 style.css 两处 CSS smooth(仅保留按钮显式 smooth); 所有程序滚动统一走 `followToBottom()`(即时模式 + 单帧落点匹配 + isAutoScrolling 标记三重防误判); `handleChatScroll` 统一滚动判定 — 滚回底部(<80px)自动重新吸附; wheel 上滚立即脱离(防跟随与手势抢跑); touchstart 暂停跟随/touchend 底部重吸附; ResizeObserver 监听消息容器, 内容长高且跟随时自动补滚(Mermaid SVG/懒加载图片/工具卡片); 清理死变量 isAutoScrolling/streamingScrollLock ②**流式渲染增量模式 (markdown.js v3)**: 根因: 每帧全量 marked.parse + 整块 innerHTML 重写(O(n²)), 流式图片每帧销毁重建。修复: markdown-body 拆 [md-stable 稳定区 + md-tail 尾部], 稳定块(以 \n\n 为界、非围栏/数学块内)只渲染一次并追加(保留 DOM 节点/选区/img), 尾部每帧替换(4000 字符上限); 未闭合 ``` / $$ 状态跟踪, 闭合后整块固化, 期间实时代码预览; `_hideIncompleteMath` 加围栏感知(修复 bash `$` 命令被误截断的历史 bug); `_autoFenceMermaid` 日志去重; cleanupStreamState 收敛 — 增量结构展开为常规 markdown-body 子节点(节点移动保留 img), 移除 `.streaming`/`.gen-active` 类泄漏; 流式图片 lazy+decoding=async 且不重复重建 ③**流结束免全量重建**: 根因: sendMessage finally 每轮 loadChat 全量重建整个消息列表(数百条消息 = 数百次 DOM 重建+动画, 最大卡顿源)。修复: 正常完成时(`_streamCompletedOk` 标记)跳过 loadChat, 由 completion 块就地收尾 — rendering.js 抽取 `_buildCopyButton/_buildAssistantActionButtons/_buildMsgFooterHtml`, 新增 `finalizeBubbleUI()` 补操作按钮(重新生成/继续/还原)+页脚(耗时/token/缓存命中); 出错/中止路径保留 loadChat 保证 DOM 一致 ④**历史加载性能**: loadChat 用 DocumentFragment 批量插入 + `_suppressRowAnim`(>25 条抑制逐条淡入) + `_appendTarget` 覆盖; appendMessage mermaid 扫描加围栏特征正则守卫(无图表消息跳过); loadChat 前 clearFollowState 防旧标记误匹配 ⑤**IME 修复**: init.js Enter 发送加 `e.isComposing || e.keyCode===229` 守卫(中文输入法候选词确认不再误发送) ⑥**UI 设计令牌**: :root 扩展 20+ CSS 变量(表面色/文本色/圆角/阴影/动效), html.dark 集中覆盖色板; `/theme` 命令与主开关 key 统一(兼容旧 'theme' 键), auto 模式跟随系统; 中文字体栈(PingFang SC/微软雅黑/Noto Sans SC); `--chat-line-height` 默认 1.1→1.65(中文阅读); assistant 气泡加细边框+令牌色 ⑦**可访问性**: `*:focus{outline:none}` 改为 `:focus-visible` 焦点环; 头部 6 个图标按钮补 aria-label; prefers-reduced-motion 全局禁用动画; textarea 高度 JS/CSS 统一(150/100px); 回到底部按钮加弹出动画+hover 高亮 ⑧**验证**: 浏览器实测 — 长文流式(800字+5章节+代码+表格+mermaid 全渲染), 免重建后页脚显示 "21.2s 35997 3.3%缓存命中", Home 上滚→回到底部按钮坐标点击→滚回底部, 第二条 1500 字长文流式期间上滚不被打断; node --check 全部 JS 通过。涉及: scroll-follow.js(新) index.html markdown.js rendering.js main.js ui.js init.js stream-handler.js dialogs.js resume-stream.js tools-exec.js commands.js style.css

- **2026-08-02**: 🔧 **Cloudreve 账号一致性修复 v2.7 (MCP 主账号绑定)** — ①**根因**: MCP 调用(`auth_token=cr_shared`)无 oneapichat 用户上下文时, `cr_getAccessToken('')` 回退遍历 `/tmp/cloudreve_login_*.json` 按修改时间取最新凭据; 缓存里只有 `root@naujtrats.xyz`(Cloudreve id=42, 主页登录同步时 email 缺省用 `{username}@naujtrats.xyz` 生成的幽灵账号) → 所有 MCP 上传\/操作落错账号, 而网页登录看的是 `xyq070519@gmail.com`(id=13) ②**修复**: `cloudreve_api.php` 新增 `MCP_PRIMARY_EMAIL` 常量 + `cr_getAccessToken()` 主账号优先逻辑(固定使用 `\/tmp\/cloudreve_login_{md5('mcp_primary')}.json` 凭据, 失效自动移除回退); `login` action 主账号登录时同步更新主账号凭据; 写入 xyq070519@gmail.com 凭据+token 缓存, 清除 root@naujtrats.xyz 的凭据\/token 缓存 ③**防御性修复**: `cloudreve_sync.php` email 缺省时先从 `users\/users.json` 取该用户名注册的真实邮箱, 不再生成 `{username}@naujtrats.xyz` 幽灵账号 ④**数据迁移**: root@naujtrats.xyz(id=42) 名下 16 个文件(绝区零素材\/网盘测试等 8.4MB) 全部改归 xyq070519@gmail.com(id=13), 根目录改名 `root账号遗留文件` 并挂载到 13 号根(id=2), 分享归属同步迁移, 重启 cloudreve 容器刷新缓存 ⑤**验证**: MCP 链路 user_info\/check_login\/list_files\/upload_file 全部落在 xyq070519@gmail.com, DB 确认上传归属正确, 测试文件已清理 ⑥**备份**: `api\/cloudreve_api.php.bak_20260802` + `api\/cloudreve_sync.php.bak_20260802`


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
