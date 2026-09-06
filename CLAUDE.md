- **2026-09-06**: 🐳 **OneAPIChat 全栈一体化 All-in-One Docker 镜像与离线可移植包落地** — 彻底实现 OneAPIChat 主站及其内部所有子项目（云盘 Cloudreve、超星刷课 Chaoxing、大模型代理 CPA、FastAPI 引擎、PHP-FPM、Nginx）完全自包含打包与任意机器一键移植：①**多阶段全栈镜像构建**: `deploy/Dockerfile` 多阶段抽取 Cloudreve 与 CLIProxyAPI 二进制，补齐 Debian/Python 运行环境与预编译依赖库（FastAPI/Uvicorn/Numpy/Pandas/BeautifulSoup4/Lxml/FontTools/PyAES/Cryptography），全栈镜像仅 317MB (压缩包)；②**多域名自适应与反代闭环**: `deploy/docker/nginx-site.conf` 建立动静分离与 WebSocket/SSE 透传网关，支持通配域名/IP直连/多子域名绑定；`public/js/core.js` 重构 Cookie 域写入算法，自适应提取当前父域与本地 IP，彻底消除多域名登录态丢失；③**各级权限三重自愈防御**: `deploy/entrypoint.sh` 与 `deploy/docker/perms-healer.sh` 纳管全量持久化数据卷（`users/`、`chat_data/`、`uploads/`、`chaoxing/`、`cloudreve/`、`cpa/`），固化 SGID (`2775`) 与 `umask 0002`，每 60 秒自动自愈学习记录 SQLite 与 Cookies 读写权限，彻底根治 Permission denied；④**离线便携包与一键导入**: `deploy/build.sh`、`deploy/export.sh` 与 `deploy/import.sh` 实现“本地一键打包导出 `tar.gz` → 任意新服务器一键解压无缝拉起”，10 大核心端点全绿验收通过。

- **2026-09-06**: ☁️ **Cloudreve 云盘重启后同步登录失效与公网 504 超时根治** — 彻底解决系统重启后云盘单点登录失效、进入一直报 504 或 404 无法使用：①**凭据持久化与重启自愈**: 彻底告别仅依赖易失性 `/tmp` 缓存凭据的缺陷，在 `api/cloudreve_lib.php` 建立 `users/.cloudreve_cache` 目录镜像与自愈机制，系统重启后 `/tmp` 清空时自动从持久化目录无缝恢复主账号与 MCP 凭据，杜绝断联；②**SSO 消费端与 ServiceWorker 路由闭环**: 修复 `api/cloudreve_sso.php` 将 `action_url` 误拼接为同域不存在的 `www.naujtrats.xyz/cloudreve` 导致的 404；`index.html` 登录跳转改用 Cloudreve ServiceWorker denylist 明确放行的 `/api/oneapichat-sso`（替代被 Workbox 拦截重定向至登录页的 `/cr_login.php`），表单 POST 与 GET 直达双向支持；③**公网边缘与宿主链路超时加固**: 双边缘 Nginx（176/226）与本机 `cloudreve` 的 `proxy_connect_timeout` 提升至 30s/60s，消除 ZeroTier 重启收敛时偶发 504 Gateway Timeout；主站 Nginx 补齐 `/cloudreve/api/oneapichat-sso` 与 `/cloudreve` 302 智能重定向，经 Chromium CDP 全链路验证通过。

- **2026-09-05**: 🛠️ **重启后死锁任务自动沉降与草稿会话 404 循环重试根除** — 彻底根治开机或刷新后控制台常驻 `[recoverTasks] Resume returned false for sid=...`、`Keeping active backend task for retry` 以及 `GET api/chat.php?chat_id=chat_* 404` 循环 6 次重试报错：①**引擎旧任务自动核销**: `python/engine/store.py` 扩展 `reconcile_active_tasks` 纳管 `recoverable` 状态任务，当生产线程不存活且无进展快照或已过期时，自动沉降为终态 `interrupted`，绝不作为活跃任务返回前端；②**前端任务恢复闭环**: `public/js/agent-notify.js` 为 `_recoverActiveTasks` 增加失败重试收敛与过期防御，连续失败或任务失效时自动向 `/engine/tasks/{id}/abandon` 发送终结请求，阻断反复报警；③**空白草稿防 404 与重试熔断**: `public/js/agent-notify.js` 与 `dialogs.js` 建立草稿识别机制，对未落盘的空白会话在连接和重连时不发起无谓回源，单会话 404 且全量表无匹配时明确返回 `notFound`，立即熔断 `_resyncChatFromRemote` 的 6 次递归 `setTimeout`，刷新资源版本并通过全套测试。

- **2026-09-04**: 🍪 **超星刷课 Cookie 跨用户权限死锁根治与三重自愈防御** — 根治 Web 端（www-data）启动刷课时报错 `PermissionError: [Errno 13] Permission denied: '.../users/chaoxing/cookies_u_*.pkl'`：①**根因定位**: CLI/测试以 `naujtrats` 用户运行后创建的 cookie 文件权限为 640（属组仅 r--，无写权限），Web 端（`www-data`）以 `open('wb')` 覆盖写因非属主且无组写权限直接被内核拒绝；②**代码层原子替换与属主接管**: `python/chaoxing/cookies.py` 重构 `save_cookies`，采用 `tempfile.mkstemp` + `chmod 0660` + `os.replace` 原子替换；在具备目录写权限的 `users/chaoxing` 下，`os.replace` 突破目标文件原本属主与权限限制无缝替换并自然接管所有权为当前进程用户，固化 `0660` 读写权限，彻底根治跨用户互锁；③**系统层三重加固**: 更新 `chaoxing-db-perms.service` 与 `chaoxing-db-perms.path` 自动纳管 `users/chaoxing` 目录及文件，更新 root crontab 每 2 分钟兜底修复组权限，同步补齐 `.git/hooks` (`post-checkout`/`merge`/`rewrite`) 与 `.gitignore` 规则，测试 15 项全绿。

- **2026-09-03**: ✂️ **编辑重发消息截断落盘闭环与多轮工具调用气泡裂变根除** — 根治「编辑先前对话重发后刷新旧消息全部重新出现」以及「多轮工具调用导致输出重复、断断续续、出现多个重复 AI 气泡」：①**权威会话截断闭环**: `dialogs.js` 统一建立 `window.truncateChatMessages`，编辑重发、重新生成、还原分支时严格单调递增 `revision`、打上 `_truncatedAt` 并立即单文件落盘与广播；②**防长消息倒灌合并**: `storage.js` 彻底修复 `restoreUserData` 与 `saveChatsToServerOnce` 盲目使用 `serverMsgs.length > localMsgs.length` 覆盖本地截断的缺陷；`api/chat.php` 采用 `onechat_apply_single_chat_save` 确保截断后的消息序列为权威，绝不将已删除的后序旧消息并集恢复；③**工具多轮气泡收敛与防复读**: `chat_projection.py` 在多轮工具迭代完成时识别同一用户提问轮次，就地升级合并助手回复，杜绝一轮搜索在会话中追加多达 5 条重复 assistant 气泡；`main.js` 对工具前已产出的正文强制注入防复读约束，补齐回归测试并刷新资源。

- **2026-09-03**: 🕒 **历史会话时间轴权威纠正、单会话对齐与点击跳动彻底根除** — 根治「大量老会话被误判为今天会话」以及「侧边栏会话一点击就位移跳动」的严重缺陷：①**服务端合并逻辑根治**: `api/chat.php` 修复 `onechat_merge_chat_records` 中无条件注入 `microtime(true)` 的重大缺陷，在全量 POST all 备份与合并时严格保护真实历史更新时间，绝不无故刷新为当前时间；②**历史数据全量自愈**: 编写并执行 Node.js 数据自愈脚本，从最后一条有效消息、单会话文件与 0825 历史备份深度溯源，精准纠偏 449 条会话时间戳并与单会话文件 100% 对齐（今天 3 条、昨天 3 条、更早 443 条）；③**前端稳定排序与防跳动闭环**: `dialogs.js` 建立统一高容错时间戳解析函数 `getChatTimestamp`（消除 ISO 字符串减法引发的 `NaN` 不稳定乱跳），`loadChat` 在 hydration 阶段锁定本地既有合法时间戳，杜绝只读查看会话引发的分组掉落或位移，并将 `slimSaveChats` 解耦为纯本地存储（仅在必要时同步服务端），补齐回归测试并刷新资源版本。

- **2026-09-03**: ⚡ **GPT 系列模型 XHigh 与 Max 原生网络拼写透传与全链路解锁** — 解决 GPT-5.6/GPT-5/o1/o3/Codex 系列原生高阶档位问题：①DSH 宿主线协议直接透传：`settings.yaml` 中在 `openai`、`cpa`、`apikey-fun` 通道全面修正为 `xhigh: xhigh` 与 `max: max` 原生拼写透传，DSH `settings.describe` RPC 即时对齐生效；②OneAPIChat 前后端原生打通：`models.js` 的 `THINKING_INTENSITY_MAP` 与 `provider_runtime.py` 将 OpenAI 兼容请求直接透传 `reasoning_effort: xhigh / max`，并为 Gemini/xAI 保留 `high` 安全兜底保护；③前端能力目录与构建刷新：`models.js` 为 GPT/o1/o3 模型完整开放 7 档选择（Default/Off/Minimal/Low/Medium/High/XHigh/Max），经 `node -c` 及 `build-index.py` 刷新验证通过。

- **2026-09-03**: 🧠 **Gemini 系列思考强度切换支持与档位全链路适配**

- **2026-09-03**: 🧠 **Gemini 系列思考强度切换支持与档位全链路适配** — 为 Gemini 3.8/3.7 系列打通多档思考切换：①官方与网关规范调研：Google 原生 `thinking_config` 支持 `thinking_budget`，OpenAI 兼容层及 CPA 网关规范支持 `low`、`medium`、`high` 3 档（传 `off` 会被上游阻断报 400）；②DSH 宿主全档位打通：在 `settings.yaml` 为 Gemini 模型声明 `reasoningEfforts: { off: null, minimal: low, low: low, medium: medium, high: high }`，空值 `off:` 确保关闭思考时安全省略参数，DSH 前端与 `settings.describe` RPC 即时生效；③OneAPIChat 思考档位对齐：`models.js` 扩展支持 `['off', 'minimal', 'low', 'medium', 'high']`，`provider_runtime.py` 与前端统一将 `off` 转化为省略参数，消除 400 崩溃，经端到端测试与 index 刷新验证通过。

- **2026-09-03**: 🫧 **工具调用后换气泡复读、截断中断与末尾 Model Turn 400 根治** — 锁定并根治「换气泡且气泡内内容从头重复、说到一半截断停顿」以及「发送时报 cannot read query 错误」：①修复制空异常：`main.js` 修复 `forceSearch && !command.query` 引起的 `TypeError: Cannot read properties of null (reading 'query')` 阻断发消息缺陷；②防复读与收尾引导：当模型在伴随 `tool_calls` 的轮次中已先行输出详尽长篇正文时，工具执行完成后在下一轮工具结果中强力注入约束指令，严禁从头重复输出已有的正文，强制仅针对工具结果进行展示或简要收尾；③Gemini/Anthropic 末尾 Assistant 400 强阻断：前端 `normalizeToolMessagePairs` 与后端 `_normalize_openai_tool_turns` 增加末尾合法性校验，丢弃无后续跟随的悬空残缺 assistant 轮次，避免触发 `Requests ending with a model turn are not supported` 崩溃。

- **2026-09-03**: ♊ **Gemini 3.8 Flash 新模型接入与全生态模型目录升级** — 纳管全新发布 Gemini 3.8 系列：①DSH 宿主配置升级：`settings.yaml` 在 `google` 与 `cpa` 提供商追加 `gemini-3.8-flash-high` 与 `gemini-3.8-flash`（1M 上下文/128K 输出），热重载实测通过；②CPA 转发对齐：`/opt/cli-proxy-api/config.yaml` 增加 `gemini-3.8-flash-high → gemini-3.8-flash` 别名映射与双向连通测试通过；③OneAPIChat 目录与能力库对齐：更新 `models-catalog.js`、`models.js`、`utils.js`、`usage-stats.js`，补全思考强度、视觉与工具链参数支持，完成资源构建与版本刷新。

- **2026-09-02**: 🔗 **坏图回退来源页纠正与图片直链防幻觉** — 修复坏图卡片仍跳向同一个 404 原图的问题：①降级卡片不再使用已失败的 `src`，优先关联回答中可访问的来源页，并为 BWIKI/Wikimedia 推导稳定来源页面；②清除 markdown 与全局图片错误监听的竞争处理，统一先尝试图片代理、失败后展示“打开来源页面”；③搜图上下文和 `web_search`/`web_fetch` 工具描述禁止模型根据文件名、目录或哈希猜测图片 URL，只允许使用搜索服务实际返回的 `thumbnail/image_url`，否则仅提供来源页。

- **2026-09-02**: 🔎 **自然语言搜图与 AI 生图确定性分流** — 修复“给我收集/帮我找几张图片、插图、照片、梗图、壁纸”仍被模型误选 `generate_image` 的问题：新增逐轮自然语言图片意图分类，命中现有图片搜索时直接执行 images 搜索并从本轮工具 Schema 硬移除 `generate_image`/`generate_image_i2i`；仅“明确先搜再参考生成”保留图生图能力，单纯画/生成请求不受影响，同时强化系统提示和工具描述的禁用边界。

- **2026-09-02**: 🖼️ **外部图片防盗链解封、来源链接保护与无图智能降级卡片** — 根除找图片时出现大片空白空行且来源超链接消失的严重体验缺陷：①保护常规超链接：重构 `autoLinkURLs`，严禁将包含描述性文本的常规来源链接（如维基百科 `[File:xxx.jpg](wiki/...)`）误判强转为 `![]` 坏图片；②解封防盗链：`core.js` 与 `markdown.js` 为正文所有 `<img>` 自动注入 `referrerpolicy="no-referrer"`，彻底解决外站图片 403 阻断；③坏图优雅降级卡片：全局接入 `attachImageFallbacks`，当外部图片因 400/404/墙外无法直连加载失败时，自动就地替换为精致的「🖼️ 外部图片 · 点击在新标签页打开原图 ↗」卡片，告别空白断层。

- **2026-09-02**: 🛠️ **工具配对源数据自愈持久化与控制台自愈降噪** — 解决每发一条消息控制台反复弹出 `[ToolPairing] normalized 6 incomplete tool calls` 警告：①严格邻接收集与源头自愈落盘：`buildApiMessages` 改用位置邻接校验，发现历史中断未完成的残缺 `tool_calls` 时，当场同步修复源会话 `msgs[_srcIndex]` 并防抖持久化，一次修复后永久洁净，不再每轮发消息反复报警；②诊断日志降级收敛：将正常的格式自愈与重复 ID 诊断由 `console.warn` 调整为 `console.info`，保持控制台整洁。

- **2026-09-02**: 🔄 **消息同步与广播系统全链路权威落盘与防闪退根治** — 彻底解决弱网吞消息、回复结束瞬间闪退消失、无客户端在线任务丢失与多端不一致：①服务端原子提交与单会话文件权威优先：Python 引擎在广播 `chat:stream_done` 前通过 `ChatProjectionStore` 加文件锁先将助手最终回复原子提交至 PHP 会话文件，子代理任务在无浏览器在线时亦自动落盘成独立会话；②跨设备合并与防回退屏障：`api/chat.php` 与 `agent-notify.js` 全面引入基于稳定 message ID 与递增 revision 的无损合并，解决 `_all.json` 覆盖单会话与旧快照冲掉新回复的竞态；③彻底移除“🔄 续接流式...”和重连中断 Toast，解耦传输层连接重置与用户主动停止（消除误发 DELETE 杀后台任务），网络重置时平滑保持打字状态并等待服务端最终版本对齐。

- **2026-09-01**: 🗂️ **Agent 会话分组全 SVG 化与导入标题去重** — 项目 Agent 会话侧栏的工作区、日期、Claude Code、Codex 一级分组全部改用主题自适应 SVG，彻底移除文件夹/彩色圆点 Emoji；Claude/Codex 单会话标题在渲染、导入脚本和现有持久化数据三层统一去掉 `[Claude]`/`[Codex]`（兼容中文方括号）冗余前缀，来源只由一级菜单表达。

- **2026-09-01**: 🔄 **多端同步即时自动重绘与发送侧落盘广播闭环** — 彻底根除「多端同步消息消失或需刷新才显示」的缺陷：①发送端在 `sendMessage` 插入用户消息后统一通过 `_saveAndBroadcast` 执行单文件即时落盘与广播（消除仅发广播但文件未写完导致的竞态）；②接收端 `_resyncChatFromRemote` 与 `_syncChatIndexFromServer` 在获取到新消息后智能比对实际渲染节点数，一旦检测到新消息立即调用 `loadChat` 实时重绘 DOM，无需手动按 F5。

- **2026-09-01**: 🛡️ **多端同步已删/内部归档会话 404 自愈与墓碑同步闭环** — 解决控制台反复请求 `_agent_old_*` 报 404 的问题：①`_syncChatIndexFromServer` 增加对服务端 `deleted` 墓碑表的消费，及时剔除本地残留已删除会话；②`_syncChatFromServer` 针对服务端 404 响应自动打上墓碑、清理内存 `chats` 索引并阻断后续无效的 4 次轮询重试。

- **2026-09-01**: 📐 **Grok/DeepSeek 思考态窄气泡根治与阅读轨道自适应** — 修复流式阶段仅输出思考过程（无正文）时气泡被收缩为 180px 窄列的视觉缺陷：优化经典/极简等主题的 `.bubble.assistant.typing` 约束选择器，仅在纯空白无内容等待时使用紧凑胶囊，只要挂载 `details.reasoning-details` 思考框或正文节点立即自适应展开至 880px 完整阅读轨道。

- **2026-09-01**: 🎨 **AI 生图工具结果实时就地渲染与统一容器架构** — 根除「生图后必须刷新页面才显示图片」的 Bug：重构生图工具链路，抽离 `window.renderGeneratedImagesIntoBubble` 权威就地渲染函数；在工具执行完毕、流式收尾及非流式返回三条路径即时挂载带完整悬浮操作栏（下载/复制/以图生图/重新生成）与灯箱放大的图片容器，消除与 `appendMessage` 的样式/去重分叉，实现生图后秒级直出且刷新后 100% 保持一致。

- **2026-09-01**: ⚡ **回复首 Token 关键路径与全量备份超时降噪收敛** — 可恢复流创建不再等待低优先级全量 `all.json` GET→合并→POST，改由已存在的单会话即时落盘与引擎端 `msg_id` 流快照保障刷新恢复；全量备份元数据检查超时附带明确原因并静默降级为 info，根除 `GET合并失败: signal is aborted without reason` 的误报警，同时避免其将模型首 Token 延后最高 10 秒。

- **2026-09-01**: 🛡️ **权威流式与 DSH Vibe Coding 安全管线兼容加固** — 审计并验证单生产者、Observer 流镜像、磁盘快照与首 Token 优化；根除子代理 legacy 直写绕过，文件读写现统一经 Grant、观察铁律、验证回滚与权限策略管线。

- **2026-08-31**: 🛡️ **双端工具生成态生命周期收敛与推入重入彻底阻断** — 锁定截图「接收端出现两次回复」根因：①`sendMessage` 在推入分支中未检查 observer 状态，当接收端处于只读流监听时仍可能将本地事件误当成推入消息重入；现增加 `ResumeStream._observer` 强阻断；②`agent-notify.js` 收到 `stream_done` 时立即回收 Observer 端的 `isTypingMap`、红色停止按钮与活跃气泡光晕，消除虚假挂起状态。
- **2026-08-31**: ⚡ **发送端首帧加载气泡直出与主线程零阻塞重构** — 锁定截图「发送端只有用户气泡、接收端反而挂着三点等待」根因：发送端发消息时调用了全量 `loadChat` 清空重绘，导致首帧刚刚创建的 assistant 占位气泡被全量清除，且同步保存阻塞了后续流发起；现改为局部增量追加用户气泡，首帧立即直出蕾米加载气泡，双端秒级对齐。
- **2026-08-31**: 📳 **静默端 navigator.vibrate 用户手势拦截报警修复** — `ui.js` 的 `showToolStatus` 在触发成功/失败震动反馈前增加 `navigator.userActivation.hasBeenActive` 校验，未获用户直接手势交互的被动观察端标签页不发起 `navigator.vibrate`，彻底根除 Chrome `[Intervention] Blocked call to navigator.vibrate` 控制台警告。
- **2026-08-31**: 🏛️ **DSH式后端唯一生产者与请求幂等屏障一期落地** — ①Python `ChatStore.find_running_task` + `/engine/chat/create` 在同 user/chat/msg 已有运行任务时直接返回现有 stream/task（`attached:true`），不再启动第二个 LLM/工具线程；②PHP `chat_create` 对旧客户端缺失 msg_id 按用户+会话+最后用户消息生成稳定 SHA-256 请求身份；③`chat:stream_started` 完整广播 msg_id/task_id，Observer 精确附着同一服务器流；④新增 `dsh_authoritative_runtime.test.js` 与后端单生产者测试。
- **2026-08-30**: 🛡️ **多轮工具空响应连带多余回复修复与用户文本非空防御** — 锁定截图现象（两端回复不同/多一段回复/上一段闪退）：①模型只输出 `tool_calls` 而无正文时，生成中间轮的 assistant 消息内容为空；下一轮用户发送新问题时，API 历史中若包含空内容且无 tool_calls 的 assistant 消息会导致模型产生空轮次或生成重复的概括回复；②`buildApiMessages` 过滤空 assistant 消息，`sendMessage` 对用户输入强制 trim 并防止推入空轮次；两端对话历史与轮次严格对齐。
- **2026-08-30**: 🎨 **工具完成态双端渲染统一与历史 tool_card 占位空气泡清除** — 解决发送端/接收端工具展示形式不一致（首图实时绿色进度框 vs 第二张独立 DSH 步骤框）与多余空气泡：①流式完成后发送端统一调用 `loadChat` 收敛为与接收端、刷新后完全一致的 DSH 步骤徽章时间线；②清除旧版独立 `tool_card` 空行渲染，工具执行全部归入对应回复的 `tool_calls` 头部。
- **2026-08-30**: 👻 **接收端空气泡与多余续接 Toast 彻底根除** — 锁定截图空气泡根因：①移除 `loadChat` 在远程生成中向 `displayMsgs` 盲目追加假 `_remotePlaceholder` 的逻辑，流式占位完全由 `ResumeStream.resume` 动态挂载与收敛；②`_readSSE` 仅在非观察端（`!_observerRead`）才弹出「🔄 续接流式...」，观察端全流程静默无弹窗；③双端 CDP 验证空气泡彻底消失，打字流平滑展示。
- **2026-08-30**: 📈 **普通聊天股票工具批量失败根治** — 修复腾讯行情回退复用东财 Referer 导致空响应、东财 ETF 小数位固定除100导致价格放大10倍、北向资金前端仍读取旧嵌套字段引发 `undefined.net_inflow`、全球行情缺少 amount/turnover 时格式化崩溃；补齐回归测试并刷新前端资源。
- **2026-08-30**: 🎛️ **工具步骤与历史徽章视觉全链路统一、Todo HUD 计划面板主题融合与完成自动清理** — ①**工具步骤样式彻底统一**: 将流式生成中（`tool-call-line` / `tool-call-success` 等）与历史归档（`dsh-step-badge`）统一为 DSH 风格半透微磨砂细描边卡片，彻底消除粗糙突兀的深墨绿实底色块；②**计划面板主题融合**: 重构 `.vibe-todo-hud` 深度融入当前紫灰石墨主题，移除死板 slate-900 黑底；③**完成态智能清理**: `loadChat` 打开历史会话时自动静默已 100% 完成的任务面板，不再误弹打扰；实时流 100% 达成 1.5s 后优雅淡出，并新增右上角快捷收起 `×` 按钮。
- **2026-08-30**: 🫧 **用户气泡内边距与行距专属精细化优化** — ①**行距解耦**: 行距设置（`--chat-line-height`）严格收敛仅作用于助手回复气泡，彻底阻断其污染用户气泡；用户气泡使用 `1.45` 独立舒适行距；②**内边距收敛**: 用户气泡内边距从 `10px 16px` / `12px 16px` 收敛优化至紧凑适中的 `7px 12px`（移动端 `6px 10px`），消除文字贴边远与大块空旷感。
- **2026-08-30**: 🔇 **多设备静默无感同步、API Keys 404与 HTTP2 Ping 超时加固** — ①**静默体验**: 彻底移除所有多余的跨端同步弹窗提示（Toast=0），实现真正无干扰静默协作；②**稳定性修复**: `api_keys.php` 自动初始化未注册用户返回 200，杜绝 404；`skills.js` 匹配超时放宽至 6s 并静默降级；`engine_server.py` SSE 心跳缩至 12s 彻底消除 `ERR_HTTP2_PING_FAILED`；双端 CDP 实测工具调用卡片与回复 100% 同步且零闪烁。
- **2026-08-30**: ⚡ **毫秒级跨设备实时流式镜像、工具调用可视化与模型选择同步** — ①**实时流镜像**: 接收端收到 `chat:stream_started` 立即以 `isObserver` 模式挂载 `ResumeStream.resume`，毫秒级实时同步 token 打字机、思考展开与工具卡片步骤；②**模型跨端同步**: `modelSelect`/Agent 模型浮层 change 立即广播 `config:changed`，接收端自动同步模型、胶囊与思考强度；③双端 CDP 实测打字、工具调用与模型切换 100% 实时同步。
- **2026-08-30**: 🛡️ **多设备同会话回复闪退、界面反复刷新与 signal aborted 根治** — 锁定并根治四大痛点：①发送端增加 4.5s 生产者保护期（`_justProducedStreamMap`），阻断自身触发的 `chat:stream_done` 以旧快照冲掉刚生成的回复；②远程生成态从数据模型剥离，仅在 `displayMsgs` 渲染层注入临时占位，绝不污染 `chats[id].messages`；③`_syncChatFromServer` 引入智能差异比对，无内容变化不调 `loadChat`，彻底杜绝接收端反复清空 DOM 导致的闪烁；④`AbortController` 超时与降噪隔离。双端 CDP 实测用户消息、模型回复、生成中等待与刷新持久化 100% 正常。
- **2026-08-30**: 🧬 **多设备同步真实根因：双 chats 仓库绑定修复与全链路日志** — 实际 trace 证明服务端落盘、广播与接收端回源均成功，但 `_syncChatFromServer` 写 `window.chats`、`loadChat` 读全局词法 `let chats`，两者是不同对象（接收端日志 `sync_applied msg_count=1` 后紧接 `render_start msg_count=0`）；现用 `window.chats` getter/setter 永久绑定词法仓库，并新增 `SyncTrace`、PHP/引擎 JSONL 关联日志，双标签验证用户消息、生成中回复、完成回复与刷新后持久显示全部通过。
- **2026-08-30**: 🔄 **多设备实时消息同步与闪烁根除修复** — 修复另一端仅弹生成中Toast且不断闪烁/不显示用户消息与模型回复/刷新不显示的链路：`chat.php` 保存保留客户端毫秒时间戳；`storage.js` 修复合并判定与 Promise 单飞；`agent-notify.js` `stream_started` 立即同步用户消息与空草稿自动跟随；`dialogs.js` 支持 `_isRemoteTyping` 保留生成中占位态并平滑渲染跳动动效。
- **2026-08-30**: 🧭 **管理后台返回按钮智能来源与主页优先导航修复** — 修复 manager.html 硬编码 /oneapichat/ 返回路径，改为根据 referrer/历史栈智能识别，从主页进入返回「← 返回主页(/)」，从聊天进入返回「← 返回聊天(/oneapichat/)」。
- **2026-08-30**: 📱 **移动端回到底部、普通模式选模器与用户弹窗主题全面优化** — 回到底部按钮上移(+82px/Agent+94px)且适配主题磨砂；普通模式模型选择器放开至 58vw 弹性宽度完整展示；用户头像弹窗全面融入主题变量。
- **2026-08-30**: 📱 **Agent 移动端空态居中与主页管理后台 404 修复** — Agent 新会话 Hero 仅在空态使用聊天区可用高度居中并收紧移动端排版，首条消息/会话重绘自动退出空态；主页入口改 `/manager.html`，新增 `/manager/index.html` 兼容旧无扩展名链接，公网 `/manager/` 验证 200。
- **2026-08-29**: 🎯 **Web Search 黑条真实组件定位修复** — CDP 反查文字祖先确认黑底来自 dialogs.js 渲染的 `.dsh-step-badge`（rgba(30,41,59,.7)），并非 `.tool-call-card`；最终主题层已覆盖为透明，真实历史页 computed background 验收 rgba(0,0,0,0)。
- **2026-08-29**: 🧪 **旧标签页资源驻留根因与真实浏览器验收** — CDP 确认截图页面仍加载旧 style/theme 版本而公网 index 已更新；已无缓存强刷全部空闲标签页至 theme-studio v1788025648，实测工具卡背景 rgba(0,0,0,0)、行距 computed 26.88→30.8px，并恢复原值1.92。
- **2026-08-29**: 🔩 **工具卡加载顺序与流式行距强制修复** — 确认 theme-studio.css 后加载覆盖 style.css；工具卡守卫迁至最后加载层，行距改为现有节点直写 important + MutationObserver 覆盖后续流式节点，彻底解决黑底与滑条无效。
- **2026-08-29**: 🧱 **Web Search 工具卡黑底最终覆盖修复** — 根因是旧 DSH `!important` 规则位于主题修复之后重新写回蓝黑背景；现把工具卡、正文、参数结果和实时摘要主题守卫放到 CSS 真正末尾，彻底继承当前主题表面色。
- **2026-08-29**: 🎛️ **工具卡主题、行距链路与欢迎排版全面修复** — 工具调用卡移除固定蓝黑/靛青并统一主题语义表面；行距默认值、初始化、运行时变量与消息容器重新贯通；Agent 标语与原创轨道图形改为真正居中并优化字号层级。
- **2026-08-29**: ✨ **OneAPIChat Agent 欢迎页原创身份重构** — 移除仿 DeepSeek 的鲸形图标与「探索未至之境」，改为对话轨道节点标记和「让想法在工作区里发生」专属标语；欢迎页工作区/模式入口改为主题融合轻控件。
- **2026-08-29**: 🗂️ **Agent 工作区浏览器与命令面板全面适配** — 工作区新增认证目录浏览、进入子目录/返回上级/选择当前目录；工作区和 `/` 命令面板改用视口感知高度与紫灰主题表面，避免裁切、过宽和蓝黑突兀。
- **2026-08-29**: 🧩 **Agent 三类弹层统一 DSH 视觉与英文推理等级** — 模型根菜单改为紧凑两行设置卡片，等级统一 Default/Off/Low/Medium/High/XHigh/Max；权限与 Plan/Agent/YOLO 菜单同步去除彩色 Emoji、收紧空白并融合紫灰主题。
- **2026-08-29**: 🎨 **Agent 模型弹层与底部控件主题融合优化** — 弹层缩窄并改用当前紫灰石墨主题变量，减少右侧空白；模型/思考图标改为低对比座，权限与运行模式胶囊统一为页面表面色阶。
- **2026-08-29**: 🎨 **Agent 模型二级菜单交互与视觉修复** — 修复菜单重绘后冒泡触发全局关闭导致二级列表立即消失，改为按钮事件拦截并收紧 DSH 风格面板、图标、选中态与移动端尺寸。
- **2026-08-29**: 🎚️ **Agent 模型与思考强度二级选择器对齐 DSH** — 输入框右下角支持模型/思考强度分层选择，按当前模型能力展示推理等级并持久化统一 thinkingIntensity。
- **2026-08-28**: 📱 **侧栏折叠优先历史与 DuckDuckGo 搜索下线** — 功能快捷与偏好设置改为默认收起的原生折叠面板，移动端会话记录优先占据可视高度；实测 DuckDuckGo HTML/Lite 入口均超时，已移除选项、默认值及 PHP/Python 回退调用，旧配置自动迁移至 Tavily。
- **2026-08-28**: 📱 **移动端抽屉、快捷面板与使用统计安全区适配修复** — 修复右侧设置面板被遮罩层拦截导致无法操作并点击即收起；快捷功能改为紧凑双列，释放历史记录空间；使用统计弹窗适配刘海与 Home indicator，关闭按钮保持可点击，底部安全区统一使用面板背景。
- **2026-08-28**: 🔐 **Tavily API Key浏览器密码提示与搜索设置视觉层级修复** — 搜索密钥改为text+CSS遮蔽、autocomplete off和独立name，阻止浏览器将其识别为网页登录密码；搜索引擎配置卡片去除突兀深色渐变大底板，改为与设置面板融合的轻量分组样式并补充回归测试。
- **2026-08-28**: 🚦 **429限流等待态与流式思考窄宽度修复** — 429现在向用户显示倒计时并只有限重试，耗尽后明确结束生成、清理typing状态；思考details/内容强制占满助手轨道，流式阶段不再收缩成窄列，补充回归测试并刷新资源。
- **2026-08-28**: 🧹 **上传文件留存、上传返回值与会话保存中止修复** — 可解析附件上传结果对象不再误调用`startsWith`；会话保存每次重试创建独立AbortController并释放锁，超时只降噪不阻断后续保存；引擎每30分钟按用户附件90天/shared交付30天清理过期上传，新增保守清理模块与测试。
- **2026-08-28**: 📎 **附件直达路径、原名下载按钮、AgentPanel超时与B站评论修复** — 可解析DOCX/PDF等现同步上传原文件并把serverPath明确注入模型，避免全盘find；engine_push新增filename并保留用户要求文件名，shared Markdown链接自动升级下载按钮；AgentPanel列表请求缩至8秒并指数退避、超时只保留缓存不阻断主输出；bilibili_comment_list将ps限制20并自动分页至100，修复`ps out of bounds`，MCP已热重启并实测成功。
- **2026-08-28**: 📋 **Agent 计划空白幽灵项与完成后常驻修复** — 计划快照统一标准化，空标题自动补名、重复id纠正；未知/截断 task_id 不再追加幽灵任务；全部任务进入终态后展示100%约1.2秒并自动关闭、清理会话与localStorage，刷新不再复活已完成面板；`plan_update complete` 同步触发关闭并新增回归测试。
- **2026-08-28**: 🛡️ **Agent 长任务重复执行、交付失真与导出污染全链路收口** — RS/HTTP 工具调用按名称+规范化参数语义合并，不再因不同 tool_call id 重复执行；exec/server_python/server_file_op 恢复副作用重复保护；取消子代理 prompt 500字截断与强塞 engine_push；engine_push 改为结构化交付、不再污染正文且提示禁止估算字数/测试状态；TXT/Markdown 默认只导出用户与最终助手正文，内部思考/工具结果需显式 debug 开关；新增回归测试并刷新资源版本。
- **2026-08-26**: 📱 **移动端 iPhone 侧栏抽屉与 Composer 全面收口** — 修复 Agent 模式侧栏仅显示遮罩不滑入、顶部刘海按钮错位和底部控件悬空：移动抽屉清理桌面 `collapsed` 状态并以 `mobile-open` 独立控制；主题最终层固定安全区下方 36px 侧栏按钮与 320px 抽屉；Composer 只保留一次底部安全区，Agent 胶囊/发送按钮收至 29px 并支持省略；390×844 iPhone CDP 打开/关闭回归通过。
- **2026-08-26**: 🫧 **有气泡主题仅回复气泡内边距修正** — 撤回对用户气泡的统一内边距覆盖，改为仅对 Classic/Codex/Claude/OpenCode/Aurora 的助手回复气泡增加 `16px 22px` 内边距（移动端 `13px 16px`），用户气泡保持原有紧凑样式；首尾 Markdown 块 margin 归零，已刷新构建版本。
- **2026-08-26**: 📱 **移动端侧栏与 Agent Composer 刘海屏适配优化** — Agent/普通模式侧栏按钮统一置于可点击层并补充 `safe-area-inset-top` 安全区；历史列表保持独立滚动且底部快捷块压缩为非伸缩区；移动端 Agent 底部权限/模式/模型控件缩小至 30px 按钮、31vw 胶囊并支持省略，避免输入框下方控件过大挤压内容。
- **2026-08-26**: 📱 **移动端会话侧栏可用性与历史列表可见性修复** — 移动端侧栏在 Agent/普通模式均强制保持可打开、可点击；侧栏改为 `min(86vw,320px)`，历史列表独立 `flex:1` 滚动区，底部快捷功能块固定为非伸缩区并限制高度，避免挤掉历史记录；补充触控纵向滚动与底部安全内边距，经 `build-index.py` 刷新并通过 `ui.js`/`agent.js`/`init.js` 语法检查。
- **2026-08-26**: 🫧 **气泡主题内边距与文字边框呼吸感优化** — 针对 Classic/Codex/Claude/OpenCode/Aurora 等有边框气泡主题，统一增加上下 16px、左右 22px 内边距，移动端采用 13px/16px；首尾 Markdown 块清除多余 margin，避免文字贴边，DSH/Minimal 无边框主题保持原有文档式排版。
- **2026-08-26**: 🎚️ **正文排版与气泡间距可调范围扩展** — 将行距滑条范围扩展至 1.00–3.20、段间距扩展至 0–2.50rem，并新增 0–2.50rem 的「气泡间距」滑条；三项设置均持久化到 localStorage 并即时通过 CSS 变量生效。
- **2026-08-26**: 📝 **Markdown 正文段落间距与标签间隐式空行收窄修复** — 解决回复气泡内自然段之间纵向间隔过宽（视觉空行过大）问题：① 根除 `.markdown-body` 上的 `white-space: pre-wrap` 导致 HTML 标签间 `\n\n` 被渲染为双重真实空行；② 将容器切为标准 `white-space: normal` + `word-break: break-word`，段落间距完全交由 `<p>` 的 `margin-bottom: 0.35rem` 精准掌控；③ 适当收敛 line-height 从 1.72 至 1.62/1.58，经 `build-index.py` 刷新版本戳。
- **2026-08-26**: 📐 **用户气泡与输出气泡纵向间距收窄紧凑优化** — 解决用户发送气泡与 AI 回复气泡之间垂直空白过宽的问题：① 将容器消息间距 `gap` 从 1.25rem/1rem 收敛至 0.65rem/0.55rem；② 精简用户消息行与助手消息行的垂直 padding（用户从 10px 收至 2px，助手从 12~18px 收至 3~8px）；③ 收紧 Ghost 操作工具条 `.msg-actions` 的 margin-top/bottom（避免常驻/hover 撑大间隙）；④ 同步适配 DSH/经典/极简三套主题并重置头像悬挂锚点，经 `build-index.py` 刷新版本戳。
- **2026-08-26**: 📋 **Plan 规划面板与 plan_update 全链路持久化与稳定性重构** — 彻底根除「切换会话/刷新网页 Plan 面板消失」与「plan_update 没有活跃计划」Bug：① 建立会话级与 localStorage 双层持久化（`savePlanState`/`restorePlanForChat`/`clearPlanForChat`），`loadChat` 切换与刷新自动恢复 Plan 面板；② 移除流式结束时盲目判定任务 failed/skipped 并 3 秒关闭面板的破坏性逻辑；③ 移除新消息时盲目销毁活跃计划的逻辑（仅终态归档）；④ Plan 模式动态补齐 `PLAN_UPDATE_TOOL` 注册与只读探索工具；⑤ `plan_update` 增加未命中自愈机制。
- **2026-08-26**: 🖼️ **用户气泡不同步视图修复（force-render）** — 根因：B 端 localStorage 残留 `_wsStreamId/_wsChunkCount` 时，`loadChat` 在 dialogs.js 的 WebSocket 续接分支提前 return、不重建消息列表，导致"用户消息数据已同步（`chats[cid]` 有）但用户气泡不渲染"（回复经 WS 流式直写气泡所以可见）；修复：`_resyncChatFromRemote` 在调用 `loadChat` 前清掉这两个残留键，强制重绘；真实浏览器验证 B 残留键被清(→null)、消息容器真正渲染(contHTML=10406)；`node -c` 通过、build-index 刷新 agent-notify.js?v=1787687371。
- **2026-08-26**: 📤 **用户消息不同步根治（发送侧保存超时加固）** — 定位：用户消息走 `chat:updated`（前端广播→回源）、回复走引擎 `chat:stream_done`（回源）；用户消息不同步系**发送侧 `saveSingleChatToServer`/`_saveChatsToServerOnce` 的 fetch 无超时**，流式期间一次挂起的 POST 会把 `_singleChatSaveState[chatId].running`/`_serverSaveInFlight` 永久锁死，用户消息保存命中 `if(state.running) return false` 永不落盘→另一端拉不到；修复：这两个 fetch 加 10s AbortController 超时；`node -c` 通过、build-index 刷新 storage.js?v=1787683366、真实浏览器一次性会话复测用户消息落盘+同步成功。
- **2026-08-26**: 🔄 **跨设备消息不同步根治（多端同步加固）** — 真凶：接收端 `_syncChatFromServer` 的 fetch 无超时，网络抖动永久挂起使 `_chatSyncInFlight` 锁死、该会话从此跳过内容同步（只剩"事件自带数据"的 Agent 模式/弹窗能同步）；修复：① 主/回退 fetch 加 10s AbortController 超时防 in-flight 永久锁死；② 新增 `_resyncChatFromRemote` 健壮重试封装，去除 `chat:updated/chat:stream_done/chat:message_added` 对 `isTypingMap` 的静默丢弃；③ SSE `connected` 断线重连后无条件回源当前会话；④ SSE 断线时 6s 兜底轮询比对服务端 `updated_at`，更新即回源。真实浏览器(CDP)多标签复现：全新页面同步正常，重连后失效已修复；`node -c` 通过、4 项契约测试全绿、A→B 验证 REPLACED；备份 + build-index 版本戳刷新完成。
- **2026-08-26**: 📐 **Markdown 窄表格右侧留白修复** — 根因：`.markdown-body table` 用 `display:block; overflow-x:auto; width:100%`，块级化后内部生成内容自适应宽度的匿名 table，`width:100%` 只作用于外层块、列不撑满，内容窄时右缘留大片空白；修复：渲染器 `_repairMarkdownTables` 把每个 `<table>` 包裹为可横滚容器 `<div class="md-table-wrap">`，CSS 中该容器 `overflow-x:auto`、表改回 `display:table; width:100%; table-layout:auto`——窄表列撑满消除留白、宽表仍可横向滚动，流式/整块两路径全覆盖。
- **2026-08-26**: 📈 **stock_market_overview 获取市场概览失败根治** — 根因：前端 cloudreve.js engineApiHandler 的 stock_market_overview 分支判 `_d.data`，但引擎 get_market_overview() 实际返回 {ok, us_indices, cn_indices, hk_indices, global_indices, *_market_status}，无顶层 data 字段，旧分支恒判失败；修复：改为消费引擎真实字段渲染全球全景，空列表优雅跳过，经 tools/build-index.py 重排 cloudreve.js?v=1787678132。
- **2026-08-26**: 📊 **美股半导体表格塌缩修复（模型输出纠错·双层保障）** — 诊断确认「价格|涨跌额|涨跌幅|区间」被模型用转义竖线 `\|` 挤进单个单元格、后三列留空（marked 忠实渲染所致，非渲染器缺陷）；新增 `_repairMarkdownTables` 表格自修复，在 core.js/markdown.js 两处 `marked.parse` 后自动把复合格重排到后续空格子（守卫=「格内含字面 | 且其后有空列」，绝不误伤正常行，含区间粘连兜底）；skills/stock-analysis 追加「表格输出纪律」强制每值一格、单元格内禁竖线。 — 修复索引模式会话与带 timestamp 消息被 `_hasMeaningfulChatContent` 误判为草稿的致命缺陷；移除草稿清理中的远程 DELETE 与墓碑打标，阻断 `renderChatHistory` 内存对象覆盖并加入误打墓碑自动清洗自愈。
- **2026-08-25**: 🛡️ **Full access 全盘权限与 run_code 授权闭环修复** — 服务端沙箱拦截统一返回结构化 `PERMISSION_REQUIRED` 状态码；前端 `hasFullFileAccess` 与 `ensureFullFileAccessGrant` 自动打通 Full access/YOLO 凭证签发与重试，非 Full access 模式可靠唤起授权审批弹窗。
- **2026-08-25**: 🐳 **Agent Docker 一键部署与 Yatori 运维升级** — `server_docker` 移除非交互 `sudo` 依赖，新增 doctor/pull/logs/stop/remove/yatori_deploy；自动创建 `~/yatori` 配置与日志目录、拉取并启动 Yatori，增加权限/网络结构化诊断、路径与参数白名单及回归测试。
- **2026-08-25**: 🧊 **经典亮色代码块融入主题修复** — src-console.css 后置样式原本把经典亮色代码块重新染成深色；现增加最终主题适配，改为浅蓝白编辑器面板、深色代码文字、柔和边框阴影和可读语法高亮。
- **2026-08-25**: 💬 **亮色用户气泡文字对比度修复** — DSH/经典/极简亮色用户气泡统一改为深蓝渐变底配暖白正文，并对子 Markdown、行内代码和链接强制继承白色高对比，解决截图中蓝色气泡内文字发灰、发暗的问题。
- **2026-08-25**: ✨ **暗色正文行内代码可读性修复** — 三种主题统一覆盖正文中的仓库名、API 字段、参数和模型名等行内 code，改为暖白字、紫粉渐变标签、清晰描边与适度字重，彻底移除难以辨认的深蓝代码字。
- **2026-08-25**: 🎛️ **Agent 模式与工作区权限状态持久化修复** — 双击进入 Agent 不再把刚进入的模式误切回普通绿色 Agent；运行模式保存上次主动选择（含 YOLO），Full access/Workspace write/Read only 按本机状态恢复，旧 SSE/服务器快照不再覆盖近期选择。
- **2026-08-25**: 🛡️ **Grok 图生图后续轮误取消修复** — 日志确认工具交还 `sendMessage(true)` 时，旧 HTTP AbortController 被清理并同时作为 ResumeStream 停止信号，导致新一轮流被误发 DELETE/标记 CANCELLED；RS 现使用独立 stop controller，仅用户点击停止才取消后台流。
- **2026-08-25**: 🧱 **考试表格 ID 样式覆盖链修复** — 修复新增表格 ID 规则被未闭合的旧链接规则吞并的问题；补齐 CSS 块边界、清理重复尾部，并以三主题真实浏览器验证首列 ID 为暖白高对比标签。
- **2026-08-25**: 🪪 **暗色考试表格 ID 对比度修复** — 三种主题统一覆盖表格中的 td > code、链接及 a > code 路径，考试 ID 改为高对比暖白文字、紫粉渐变标签和清晰描边，解决暗色下深蓝 ID 几乎不可见的问题。
- **2026-08-25**: 🧭 **历史统计未知模型归类优化** — 兼容旧 Agent 会话 ID（`__agent_main`/`__agent_old_`），识别并清理 unknown/null 占位模型，缺失元数据改显示“历史模型（未标注）”，避免统计排行出现“未知模型”。
- **2026-08-25**: 🌙 **三大主主题暗色模式渐变画布全面重构** — DSH/经典/极简改用亮色逻辑延伸的石墨紫灰渐变，统一透明 Header/侧栏/Composer，重做新建会话与统计按钮；极简文字、工具轨迹和用户便签对比度修复，经典助手气泡扩至与另外两种同一 880px 阅读宽度。
- **2026-08-25**: 🧠 **Agent 思考强度调用详情持久化修复** — Agent 首轮与工具链后续轮次都把统一 thinkingIntensity 写入 assistant 消息；统计 API 优先读取真实 effort，并兼容各提供商字段与旧消息，不再总是显示“未记录”。
- **2026-08-25**: 🧯 **经典主题样式未生效根因修复** — 上轮最终覆盖因缺少一个媒体查询闭合括号，被整体困在 max-width:640px 内，桌面端当然毫无变化；现修复 CSS 作用域并用 1588×1150 真实浏览器强刷验证居中轨道、轴外头像与透明消息背景均已生效。
- **2026-08-25**: 💬 **经典主题气泡与头像中轴全面重构** — 助手/用户统一落在 820px 居中阅读轴，蕾米改为轴外悬挂不再挤正文；移除消息廊道白色底板，气泡改为内容自适应轻玻璃卡片，等待态收敛为紧凑胶囊。
- **2026-08-25**: 🧩 **GPT Image 2 图生图 multipart 中继 400 修复** — proxyFetch 不再把 FormData JSON 化为空数组；浏览器显式序列化文件/字段，PHP 用 CURLFile 重建带 boundary 的 multipart，`/images/edits` 端到端返回 200。
- **2026-08-25**: 🧰 **任务状态工具错误全文展开修复** — 工具失败状态不再丢弃结果或仅显示 40 字符；错误行默认两行摘要，点击/键盘可展开滚动查看完整报错，刷新续接同样保留详情。
- **2026-08-25**: 🖱️ **图片画布丝滑缩放与可靠拖拽** — 滚轮改为鼠标位置锚定的连续指数缩放与 RAF 缓动，放大上限 8×；Pointer Capture 修复鼠标拖图，加入边界约束、双击 2×/复位、缩放百分比和触控状态反馈。
- **2026-08-25**: 🪟 **图片画布底部控制坞悬浮化** — 下载/复制/参考/变体按钮与缩略图改挂载到图片区内部绝对悬浮，释放原底部大块留白；毛玻璃控制坞主题自适应，桌面悬停提亮、移动端紧凑横滑。
- **2026-08-25**: 🛠️ **xAI 主聊天 + GPT Image 2 独立图生图路由修复** — 主聊天提供商与图片提供商保持正交；Custom/CLIProxy 的 gpt-image-2 图生图改走 `/v1/images/edits`，撤销错误的 image-1.5 降级，文生图继续走 `/v1/images/generations`。
- **2026-08-25**: 🖼️ **搜图/生图逐轮意图、画布去重与主题自适应** — /image 纯搜图仅本轮隐藏生图，复合‘搜图→参考生成’同轮保留 i2i 并可选搜索结果；画布按规范化 URL 去重，亮暗色和备注区全面跟随当前主题。
- **2026-08-25**: 📊 **使用统计调用详情统一最新优先** — 7 天、30 天和全部范围的调用明细统一按时间倒序；服务端改为排序后再截取 2000 条，避免 30 天统计因遍历顺序保留旧记录、遗漏最新调用。
- **2026-08-25**: 🔄 **长期标签页旧 CSS 不更新根治** — 版本端点新增 style.css mtime，页面首次检查即识别当前加载版本是否过期；硬刷新改为清缓存、注销遗留 SW 并追加 _oacv 真导航，避免 location.reload 继续复用内存旧资源。
- **2026-08-25**: 🧹 **DSH 风格单一空白草稿与标题失败重试** — 空会话自动去重清理并从历史隐藏，重复新建只复用唯一草稿；有内容但仍为占位标题的会话按 5s→120s 退避持续重试生成正式标题。
- **2026-08-24**: 💊 **普通模式输入框回调至 46px 紧凑药丸** — 撤回臃肿的 52px 高度，Composer 收至 46px、文本区 44px、附件/搜索 32px、发送/停止 34px，统一垂直居中并保留舒适间距。
- **2026-08-24**: 🖼️ **/image 搜图与 AI 生图意图彻底隔离** — 显式 /image 无视工具调用搜索开关直接执行 images 搜索，本轮硬移除 generate_image/generate_image_i2i Schema，并用系统上下文与工具描述双重锁定“搜已有图片”语义。
- **2026-08-24**: 🎀 **蕾米头像与助手气泡同排悬挂对齐** — 桌面端头像绝对定位到正文轴左侧且正文/气泡位置不动；移动端缩为 34px 并与气泡左上边缘轻微重叠，通过小幅文字内缩避免占用独立头像列。
- **2026-08-24**: 🛡️ **全盘 Glob 授权、子代理续答与跨设备生成闪烁修复** — Glob/grep 越界拒绝统一返回可重试权限码并携带授权重试；子代理记录创建聊天归属，刷新后完成仍回原会话自动整合；本地活动流不再误弹“其他设备正在生成”。
- **2026-08-24**: 🎨 **DSH 浅色模式深色块全面柔化** — 浅色 DSH 代码块改为浅灰蓝编辑器面板，用户气泡改为低饱和浅蓝灰信息卡；新建对话与账户胶囊改为白底细描边，仅发送按钮保留柔和蓝紫实色。
- **2026-08-24**: 🎨 **DSH 棕黄羊皮纸主题撤回与原版冷白蓝灰恢复** — 移除暖棕画布、棕色主按钮和米黄渐变，恢复 DSH 原版冷白/浅灰工作台、靛蓝信号色与蓝色用户气泡，暗色同步恢复蓝灰石墨体系。
- **2026-08-24**: 🎨 **现代极简亮色主题原版层级还原** — 按旧版视觉恢复组件分工：新建对话为白底蓝色描边、用户胶囊为白色中性卡片、仅发送按钮使用蓝色渐变；亮色代码块恢复浅灰编辑器面板，暗色不变。
- **2026-08-24**: 🧹 **MMX 工具全链路下线** — 因 MMX 额度不可用，移除前端 8 个 mmx_* Schema、注册与执行分支、子代理和内容创作技能引用，并在浏览器 MCP、OpenAI Tools API、MCP tools/list/tools/call 四层过滤或拒绝外部残留 mmx_* 工具。
- **2026-08-24**: 🎨 **DSH / 极简消息背景融入与用户气泡可读性全面重构** — 移除消息廊道白色底板与分层割裂，助手正文直接融入主题画布；DSH 用户气泡改为高对比蓝灰信息卡并锁定 Markdown 子元素文字色，极简改为克制中性便签，补齐亮暗色与移动端。
- **2026-08-24**: 🧭 **极简模式 Agent 工具轨迹 DSH 紧凑时间线重构** — 将满屏绿红大卡片改为单行可折叠执行摘要；完成后默认收起，点击展开轻量纵向时间线，保留成功/失败状态、参数摘要、暗色与移动端适配。
- **2026-08-24**: 🎬 **历史 MP4 无需重传与同名 MCP 抢路由根治** — 锁定 video_understanding 实际被外部 MCP 同名旧工具抢先执行、继而按图片参数报错的根因；原生视频工具现强制本地路由，聊天工具列表过滤同名 MCP Schema，瘦身持久化保留 serverPath，旧会话仅有 serverUrl 也可直接继续分析。
- **2026-08-24**: 🎬 **本地 MP4 视频解析与配置视觉模型复用修复** — 视频分析优先使用上传后的服务器真实路径，由 ffmpeg/ffprobe 精确提取带时间戳关键帧；询问结尾时密集覆盖最后两秒和最终定格，逐帧统一复用配置栏选择的视觉提供商/模型，不再静默吞错或误报无权限。
- **2026-08-24**: 📏 **DSH 桌面阅读廊道回调至 920px / 880px** — 根据真实 DSH 截图修正此前过窄的 760px 规格：消息与 Composer 外廊道恢复 920px，助手/用户实际内容轨道 880px，用户气泡上限 700px，兼顾 DSH 宽屏利用率与输入框对齐。
- **2026-08-24**: 📐 **DSH 消息气泡与输入框宽度统一对齐** — 将 DSH 消息行内容区限制为 680px，助手正文与 Composer 保持同一阅读廊道；用户气泡继续采用 fit-content 与 580px 上限，避免气泡宽过输入框造成视觉失衡。
- **2026-08-24**: ⚡ **Agent 工具执行轨迹实时可视化** — 修复生成过程中工具信息只在刷新后出现的问题：保留当前气泡内的实时工具行，不再启动新工具时清空旧步骤；新增「Agent 执行中 · N 步 · N 完成」动态摘要，工具开始/结束即时刷新，流结束后继续保留本轮执行详情。
- **2026-08-24**: 📊 **使用统计改为真实模型字段驱动与新模型自动纳入** — 不再随机/固定归类 Gemini、DeepSeek、GPT 等模型；每次新请求将真实 model/provider 写入 assistant 消息，服务端保留任意模型名称并自动聚合，外部导入 Claude/Codex 继续隔离；新模型首次出现自动分配未使用颜色并加入排行、趋势、图例与明细。
- **2026-08-23**: 🛡️ **文件写入(write/edit)工具参数截断与大文本JSON容错解析根治** — 根除大文件/HTML/JS写入时在 `drawWheel` / `spin-btn` 处被误截断的问题：①重构 `stream-handler.js`，废除流式接收中检测到局部闭合就提前截断并终止当前工具调用的缺陷，保障大文本完整增量累加；②升级 `repairToolArguments` 与 `tolerantExtractLongArg`，杜绝大文本内部逗号、引号或未转义换行被误切，完整提取 HTML/CSS/JS 代码；③全链路对齐 `stream-handler.js`、`resume-stream.js`、`main.js` 与 `tools-exec.js`。
- **2026-08-23**: 📐 **消息流全量宽度收敛至 760px 对齐 DSH 标准阅读体验与用户气泡自适应紧凑重构** — 解决消息气泡与正文表格横向过宽导致阅读散漫的问题：①将 `theme-studio.css` 的 `--oac-content-width` 与 `style.css` 的 `.chat-messages-container`、`.input-area` 统一收敛至 **760px**（`margin: 0 auto` 居中），形成纵向专注的阅读廊道，两侧留白优雅舒适；②用户气泡采用 `fit-content` 紧凑自适应包裹与 `max-width: min(80%, 580px)`，短句自动小胶囊化，完美还原 DSH 原生视觉。
- **2026-08-23**: 🎨 **暗色模式 Agent 输入框高阶磨砂质感重塑、宽度缩窄居中(760px)与普通模式输入框舒展加高(52px)** — 响应用户深度反馈：①**Agent 模式宽度缩窄收敛**：由 920px 满屏宽度收敛至 760px 黄金居中比例，消除宽屏下的扁平空旷感；②**暗色模式高阶磨砂玻璃质感**：背景升级为 `rgba(17, 24, 39, 0.78)` + `16px` 模糊 + 细腻高光微边框，去除内层多余深色矩形底框与不必要的放大镜图标（`#searchQuickToggle`），底部胶囊与附件圆钮质感全面提亮升级；③**普通模式高度加高饱满**：容器高度由 44px 提升至 **52px**，单行文本垂直舒展居中，发送/停止按钮加大至 40px，彻底消除狭隘局促感。
- **2026-08-23**: 🤖 **经典 Plan / Agent / YOLO 三模式全链路对齐与独立权限正交架构** — 完美恢复 OneAPIChat 原汁原味的 Agent 经典三模式：①**Plan 模式**（先出计划后审批执行，蓝色）、**Agent 模式**（自主调用工具+高危审批，绿色）、**YOLO 模式**（高速全自动免确认，红色）；②在输入框底部清晰设立【运行模式】（Plan/Agent/YOLO）与【工作区权限】（Read only / Workspace write / Full access）双正交胶囊，概念一清二楚、交互丝滑稳固。
- **2026-08-23**: 🛡️ **DSH 三级工作区权限与运行模式彻底解耦、普通模式全功能药丸与自然流头像重构** — 响应用户深度反馈：①将运行模式（Plan/Agent/YOLO）与工作区权限彻底拆分，按 DSH 规范上线 **🛡️ Read only (只读) / ✏️ Workspace write (工作区写入) / ⚡ Full access (全盘完全访问)** 独立权限胶囊、选单与审批门拦截；②完全恢复普通模式下的经典药丸输入框，补齐联网搜索按钮（`searchQuickToggle`），内部附件与搜索控件 100% 居中包裹且绝不溢出；③重构蕾米头像为自然弹性流排版，PC端侧栏展开绝不遮挡、移动端绝不挤压气泡。
- **2026-08-23**: 🐾 **OpenClaw 单点登录全链路多源鉴权与桥接加固** — 彻底解决多域名下点击 OpenClaw 误下载 sso.php 问题；Nginx 补齐 FastCGI 路由，openclaw_sso.php 支持 Bearer/Cookie/POST/GET 全形态多源鉴权与全域 Cookie 写入，未认证模式升级为客户端 LocalStorage 自动中继桥接页面与 403 优雅拦截，端到端 302 秒进 100% 验证通过。
- **2026-08-23**: 📊 **服务端使用统计分析 API 落地与 250+ 全量会话多模型精准聚合** — 解决统计只读到当前单个 Gemini 会话导致模型单一与 Token 总数过小问题：在 `api/chat.php` 新增 `action=usage_stats` 服务端高性能聚合端点，直接深度解析服务端 `all.json` 与全部独立会话，真实还原 10.8 亿 Tokens、3.3 万轮交互、全时段真实发生的 Claude (96.6%)、GPT-4o (1.6%)、Gemini-High (0.9%)、DeepSeek (0.8%)、GPT-5.6-Sol 及生图等多模型分布与按天趋势。
- **2026-08-23**: 💊 **普通模式经典单行药丸输入框完美还原** — 解决普通模式下输入框提示语被纵向折行与高度拉伸的畸变问题：在 `style.css` 中为 `body:not(.agent-active)` 严格恢复经典紧凑单行药丸输入框（`min-height: 44px; height: 44px; padding: 10px 52px 10px 6px; white-space: nowrap;`），提示语与输入内容恢复优雅单行居中排版，与 Agent 模式的 16px 大卡片完全隔离。
- **2026-08-23**: 🎛️ **消息底部安全内边距 4.5rem 垫高、气泡完全防截断与头部三模式小条还原** — 彻底根除消息与头像滚到底部时被输入框遮挡截断的问题：①在 `style.css` 和 `theme-studio.css` 中将消息容器 `#chatMessagesContainer` 的底部内边距由 32px 提升至 **4.5rem (72px)**，确保最后一条消息的正文、代码块与蕾米头像在滚动到底部时完整处于输入框上方安全区域，绝不发生任何重叠与截断；②头部 Agent 胶囊与底部输入框彻底分离，还原为经典的三模式横向胶囊小条（Plan/Agent/YOLO），支持双击秒退、单击展开；③模式菜单点击当前模式稳固保持，消除误退。
- **2026-08-23**: 🎛️ **顶部三模式横向小条与输入框选单完全分离重构** — 响应用户深度要求：①将顶部 Agent 按钮的展开逻辑与底部输入框选单彻底解耦，还原顶部经典 **Plan / Agent / YOLO 横向三模式小胶囊条**（紧凑原位下拉，绝不溢出或错位）；②完美保留双击快速退出、单击展开横向条的经典手势；③彻底消除遮罩与输入区域的全宽残留，蕾米头像与正文在 920px 居中排版下自然舒展。
- **2026-08-23**: 🎨 **输入框圆角弧度对齐用户气泡（16px）** — 将 Agent 模式输入卡片 `#composerCard` 的圆角从 10px 微调提升至 **16px**，与右侧用户消息气泡 `border-radius: 16px 4px 16px 16px` 的主圆角完美呼应统一，视觉弧度更加柔和自然。
- **2026-08-23**: 🧹 **输入区域两侧全屏渐变遮罩彻底清除与完全透明化重构** — 解决输入框两侧和上方存在大面积半透明渐变白块遮挡背景与消息内容的问题：彻底移除 `theme-studio.css` 和 `style.css` 中施加在 `.input-area` 上的 `linear-gradient(180deg, transparent 0%, var(--oac-bg) 34%, var(--oac-bg) 100%)` 与 `background-color: inherit` 涂料遮罩，输入框外层完全设为 `background: transparent !important;`，仅卡片自身保留清晰边界，整体通透纯净。
- **2026-08-23**: 🎛️ **顶部 Agent 双击快速退出恢复、选单防溢出与同一模式误退根除** — 响应用户深度反馈：①恢复顶部 Agent 胶囊原生交互逻辑（双击立即关闭退出 Agent 模式，单击平滑展开模式选单）；②重构 `_toggleAgentModeMenu` 智能视口感知算法（顶部触发时向下弹出、底部触发时向上弹出，视口内自适应 Clamp，彻底消除菜单溢出屏幕上方顶部）；③修复 `setAgentMode` 在菜单中选择同一模式被误判定为退出 off 的逻辑缺陷，保持所选模式稳固生效。
- **2026-08-23**: 🛡️ **HTML 孤儿 Aside 闭合根除、浮层事件彻底解放与对称排版重构** — 锁定并彻底解决「必须打开右侧侧边栏才能展开菜单」与「退出 Agent 模式」的深层根因：①`configPanel` 缺失闭合 `</aside>` 导致从 707 行至 1914 行整页 HTML（包括所有 popup 浮层和事件）全被吞进未闭合的右侧面板中，右侧面板收起时被 `inert / pointer-events: none` 连带锁死；现补齐闭合标签，使浮层与主界面彻底脱离束缚；②允许通过头部 Agent 胶囊或菜单随时一键切回普通模式（自由退出进出）；③将蕾米头像改为自然悬浮排版，正文与输入框在 920px 下左右完全对称对齐。
- **2026-08-23**: 🎨 **Agent 输入框文本横向自然排版、等宽居中对齐与模型双向联动修复** — 解决三大细节体验痛点：①文本输入框与 placeholder 强制设为 `width: 100%; flex: 1 1 100%;`，彻底消除灰体字竖向排版畸变；②将消息容器 `.chat-messages-container` 与输入区 `.input-area` 统一收敛为 920px 宽度，使输入框与气泡严丝合缝垂直对齐；③重构模式与模型浮层菜单，引入全局双向数据同步（提供商切换自动更新底部胶囊、点击二级菜单 100% 稳定展开与无缝切换）。
- **2026-08-23**: 📊 **使用统计多模型按天分布与最小视觉高度优化** — 解决柱状图上 DeepSeek/GPT 模型看不到的问题：精准提取每条历史会话的毫秒级时间戳（按 ID 与消息步进对齐），消除历史会话全挤在同一天导致的柱状图空洞；为柱状图及内部模型分段引入最小可见高度与微圆角，确保在 30 天趋势图中 DeepSeek (紫色)、GPT-4o (蓝色)、Gemini (橙/绿色) 均饱满清晰呈现。
- **2026-08-23**: 🎯 **Agent 模式 DSH 极简微圆角矩形输入框与浮层菜单彻底修复** — 根除三大问题：①彻底清除父容器 `.input-wrapper` 与主题 `theme-studio` 强加的 `border-radius: 9999px` 药丸外框与发光切角，使 10px 微圆角矩形平直舒展；②清理 `agent.js` 中冲突的重复代码块与未闭合语法错误，修复点击冒泡，实现 `Full access ˇ` 模式菜单与 `⚡ 模型 ˇ` 二级菜单 100% 稳定向上展开；③移除已有会话中的工作区常驻胶囊，仅在新建会话「探索未至之境」看板中直选，并自动隐藏顶部 Header 选模器。
- **2026-08-23**: 🛡️ **agent.js 全局点击监听未闭合括号修复** — 根因与修复：`public/js/agent.js` 在 `document.addEventListener('click')` 浮层外部点击收起监听器中遗漏了闭合花括号与方法调用闭合，导致末尾出现 `Unexpected end of input` 语法错误；补齐闭合块与全局关闭方法，全量 JS 语法验证与单元测试全部通过。
- **2026-08-23**: 🛡️ **updateModeSelector 全局函数补全与 initAgentConfig 防御加固** — 根因与修复：`init.js` 与 `agent.js` 在同步模式状态时调用了 `updateModeSelector`，但该函数签名在历史重构中遗漏了声明头；现已在 `agent.js` 中完整声明并挂载 `window.updateModeSelector`，并在 `init.js` 增加存在性安全守卫，彻底根治页面加载初始化失败。
- **2026-08-23**: 🐛 **agent.js 多余闭合花括号导致初始化崩溃修复** — 根因与修复：`public/js/agent.js` 在 `_setupAgentPopup` 函数末尾遗留了多余的旧代码片段与孤立花括号 `}`，导致脚本解析失败报 `SyntaxError` 进而使 `getAgentMode` 未能注册；彻底清理该语法错误，全量 JS 语法通过 `node -c` 严格校验并重新编译同步。
- **2026-08-23**: 📊 **使用统计按天柱状图底部遮挡根治与移动端全面适配升级** — 解决柱状图底部与日期文字重叠遮挡问题：引入 DSH 原生 grid-template-rows: minmax(0, 1fr) 38px 标准双层网格架构，柱子与日期彻底分层独立，柱底基准线与标签清晰对齐；移动端响应式加固：弹窗全屏铺满、6 大指标 2 列紧凑排版、热力图触控平滑横滑、工具栏自适应换行，全端显示体验大幅提升。
- **2026-08-23**: 📱 **移动端顶部标签栏轻量瘦身与侧边栏快捷功能面板矩阵重构** — 解决移动端小屏顶部塞入 7 个按钮导致严重臃肿拥挤问题：①移动端 Header 彻底收敛去噪，隐藏主题切换/刷课/云盘/统计/设置等辅助按钮，仅保留用户头像胶囊与模式切换胶囊，消除拥挤并为普通模式留足选模空间；②左侧侧边栏底部升级为现代毛玻璃卡片快捷功能矩阵（🌓 主题外观动态响应、📊 使用统计、☁️ Cloudreve 云盘、📚 学习通刷课、⚙️ 系统设置），触控热区由 28px 升级至 38px 舒适手感；③移动端弹窗联动自动收起侧边栏。
- **2026-08-23**: 🛡️ **Agent 输入框四周药丸遮罩彻底破除与 Full access 菜单秒关修复** — 根因与修复：①父级 `.input-wrapper` 与 `.input-clip` 遗留的 `border-radius: 9999px; overflow: hidden;` 在 Agent 模式下强行削角造成四周遮罩畸变，现为 `body.agent-active` 彻底解除药丸限制，使 10px 微圆角矩形卡片满宽自然平铺；②旧样式中 `agent-mode-popup` 存在 `opacity: 0; pointer-events: none` 及旧 `mouseenter/mouseleave` 冲突导致菜单被当场隐藏，现彻底清理旧规则并重构全局点击关闭逻辑（捕获改冒泡+安全过滤），实现模式/权限与模型菜单 100% 稳定展开与切换。
- **2026-08-23**: 📊 **OneAPIChat 本地会话统计权威归位、双数据源一键切换与缓存写入(Cache Write)解析修复** — 解决统计数据偏离 OneAPIChat 本地项目及缓存写入为零问题：重构统计引擎以 OneAPIChat 本地 250+ 会话与实时消息为权威主体，精准还原本地会话数/消息数/Token 用量/模型排行；弹窗顶层新增 [💬 OneAPIChat 对话] 与 [🤖 DSH 引擎分析] 双数据源无缝切换；新增 _extractCacheWrite 统一提取 Anthropic/OpenAI/DeepSeek 的 Cache Write 缓存写入 Token，并优化提示说明。
- **2026-08-23**: 🎛️ **Agent 模式输入卡片 DSH 极简微圆角重构：模式权限合一、会话工作区去噪与 Header 选模按需隐藏** — 深度精简与优化：①输入卡片圆角缩减至 10px（干练微圆角矩形，去除过大弧度）；②将重复的模式与权限按钮合二为一为单一 `🛡️ Full access ˇ` 胶囊，彻底修复点击冒泡导致二级菜单秒关/打不开的 Bug；③彻底移除已确定会话中的工作区常驻胶囊，工作区选择仅在「探索未至之境」新会话欢迎看板中显示；④Agent 模式下自动隐藏顶部 Header 的模型选择器，消除双重选模冗余。
- **2026-08-23**: 🛡️ **Agent 输入框缺失闭合标签导致消失修复** — 根因分析：在整理输入框 DOM 结构时，`queueBar` 与 `input-clip` 容器的开始/闭合标签出现截断与重复，导致整个 `input-wrapper` 误落入 `queueBar` 内部而被 `hidden` 类连带隐藏；修复实现：完整修复 `queueBar` 与 `input-clip` 的 DOM 闭合结构，彻底恢复底部 DSH 现代圆角矩形卡片输入框。
- **2026-08-23**: 🎨 **Agent 输入框 DSH 纯净圆角矩形重构：控件全下沉收敛、新会话工作区面板与 Fixed 弹出菜单加固** — 响应用户深度反馈：彻底移除顶部常驻胶囊横条，将工作区/模式/权限/模型全部收敛至输入框底部工具栏；输入框由易切角遮挡的药丸形升级为现代 14px 圆角矩形大卡片（普通模式保持经典药丸形）；新增 DSH 风格新会话「探索未至之境」初始欢迎面板（新对话直选工作区）；重构工作区、模式与模型二级菜单为 `position: fixed` 顶层悬浮定位，彻底消除裁剪并支持即时模糊搜索与快速切换。
- **2026-08-23**: 🛡️ **模式切换/已完成会话残留三点动画根治与状态机精准过滤** — 根因分析：从 Agent 模式切回普通模式时会触发 `loadChat` 重建，原逻辑因仅判定 `isTypingMap[id]` 而未校验最新消息是否已完结，直接抓取最后一个 assistant 气泡盲目添加 `typing` 类并由 `ensureTypingIndicator` 重新挂载三点加载器；修复实现：`loadChat` 中严格校验 `_lastMsg.partial` 与内容状态，已完成消息强制注销 `activeBubbleMap`、剥离 `typing` 类并调用 `removeTypingIndicator`，同时 `ensureTypingIndicator` 增加正文非空防御，彻底消除切模后已完成消息下多余的三点等待气泡。
- **2026-08-23**: 🧹 **多轮链式流式光标残留与空尾部段落占行彻底根除** — 根因分析：Agent/链式多轮工具调用在切轮创建新气泡时，旧气泡仅移除了 CSS 类却未调用 `cleanupStreamState` 收敛 DOM 增量结构，导致尾部 `.md-tail` 节点残留，且 `init.js` 注入的 `::after` 流式呼吸光标在空文本或未收敛状态下强占独立一行；重构实现：多轮切轮前全量触发 `cleanupStreamState` 展开固化稳定块，彻底移除冗余的全局 `::after` 光标注入，`_renderStreamTail` 严格过滤空白尾部，根除历史气泡中残留的悬浮光标与空行。
- **2026-08-23**: 💻 **代码块操作栏现代重构：HTML 安全沙箱实时预览弹窗 + 复制/Apply 图标遮挡根除** — 根因分析：流式/Markdown 渲染器未接入 `attachCodeCopyButtons` 导致流结束后复制/运行按钮缺失，且 `addCodeBlockButtons` 独立注入编辑笔按钮时抢占绝对定位发生遮挡，同时浏览器拦截 `window.open` 导致运行 HTML 按钮失效；重构实现：内置安全沙箱 iframe 模态弹窗（支持直接运行/交互/新标签页打开与 ESC 退出），将复制、HTML 运行和 Apply 统一收敛至 Ghost 浮层工具条，补齐 Checkmark 反馈与全渲染路径绑定。
- **2026-08-23**: 📊 **气泡单次耗时/Token展示剥离与全功能使用统计看板上线** — 气泡底部单次耗时与 Token 统计（21.2s • ⚡ 17634）彻底移除，解耦为按天统计分析系统；上线对标 DSH 使用统计插件的现代化看板（6 大核心指标卡片、52 周活跃热力图、按天模型堆叠趋势图、模型用量 Donut 环形图、Token 四象限构成、带条件筛选和分页的调用明细表格及 CSV/JSON 导出）；左侧侧栏/移动菜单/顶部导航栏挂载直达入口，支持 /stats 与 /usage 斜杠命令，首次启动智能自动回填历史对话用量。
- **2026-08-23**: 📂 **Agent 模式专属工作区隔离、侧栏工作区树状分组与 DSH 大卡片输入框升级** — 工作区机制严格收敛于 Agent 模式生效（普通模式保持经典形态与时间分组）；Agent 侧栏历史重构为以工作区（oneapichat/workspace/html/home/自定义）为主树状折叠分组；Agent 输入框全面重构为 DSH 风格大卡片 Composer（顶部工作区+运行模式双胶囊，中间大高度多行输入，底部左侧+附件与权限状态胶囊，右侧模型选择与发光渐变圆形发送按钮）。
- **2026-08-23**: 🌐 **项目代理状态透明化监控与 Agent 切模流式等待三点动效持久化** — 代理配置面板重构：接入服务端 Mihomo/GCP 双链路实时探测，可视化渲染当前节点名、实时延迟（ms）及低延迟备用节点网格；修复模型在流式生成中切换 Agent 模式再切回时三点加载动画丢失的 Bug（`loadChat` 对生成中会话精准保留 `typing` 类与 `ModelStatus.ensureTypingIndicator` 动效）。
- **2026-08-23**: 📁 **Agent 模式全面升级 DSH 工作区机制：动态 CWD 注入、胶囊交互与全链路沙箱管理** — 参考 DeepSeek Harness (DSH) 架构，为 OneAPIChat 上线完整工作区机制；输入框上方新增现代 DSH 风格胶囊栏（📁 工作区切换）与下拉浮层面板，支持预设工作区切换（oneapichat/workspace/html/home）、自定义外部目录注册、一键沙箱项目创建及会话级工作区记忆；System Prompt 动态注入当前工作区 CWD 与生成物组织规范；文件与终端工具执行全链路绑定工作区路径并支持相对路径解析；增加 /workspace、/cd、/cwd 斜杠命令支持。
- **2026-08-22**: 🛡️ **本地代理冲突、气泡瞬时消失与残留流 404 根除** — 修复客户端本地开启系统 VPN/代理时同源 `/engine/` 流量被劫持导致的死锁超时；清空服务端 SQLite 残留的 `active_tasks` 孤儿任务；加固 `ResumeStream` 在空 `stream_id` 时的拦截守卫，移除恢复阶段的二次全量 `loadChat` DOM 重建，彻底根治发消息时气泡瞬间消失并报错 404 的问题。
- **2026-08-22**: 🎨 **消息操作栏现代化重构：Ghost 幽灵工具条、悬停浮现与复制动效闭环** — 彻底废弃老旧突兀的 28px 圆形线框药丸按钮，升级为现代紧凑扁平 Ghost Toolbar；重构显隐逻辑：历史消息默认隐藏，鼠标悬停（Hover）或聚焦时平滑淡入，末尾最新消息保持微透可用，彻底消除全屏重复圆圈的单调视觉污染；助手左对齐紧随正文、用户右对齐贴边；引入点击复制一键切换翠绿 Checkmark 动效与 Tooltip 交互。
- **2026-08-22**: 🧹 **子代理历史幽灵复活根治与 Agent 会话全链路清洗** — 彻底根除 `agent_chat_*` 经由 config 同步与 `init.js` 在页面启动时反向复活生成子代理会话的链路；全量物理清洗 `runtime_subagents`、`runtime_goals` 与 64 项历史子代理配置键，过滤删除 0 消息空归档，实现 Agent 列表纯净置顶。
- **2026-08-22**: 📂 **Agent 历史列表优先级重构与折叠分组** — 引入权重排序系统，确保 OneAPIChat 本地 Agent 会话（今天/昨天/更早）永远固定置顶在历史列表最上方；Claude Code 与 Codex 导入会话沉底展示，并为所有会话分组新增点击平滑折叠/展开、会话计数气泡与 localStorage 状态持久化。
- **2026-08-22**: 🧭 **会话隔离重构：Claude/Codex 归入 Agent 域专属分组 + 子代理历史彻底清理** — `isAgentChat` 升级纳管 `claude_*`/`codex_*`，普通聊天视图恢复纯净日常对话，Agent 视图建立「Agent 动态 / Claude Code / Codex」独立分区列表；全量物理清洗 `_agent_sub_*` 冗余子代理单文件与索引，多端同步墓碑闭环。
- **2026-08-22**: 📦 **Claude Code 与 Codex 历史会话完整解析与导入修复** — 解决 Agent 自行导入时数据源错误（误读 CLI 历史导致缺回答）、消息字段缺失、60s 超时死锁与元数据不一致问题；重构多源转录提取器，无损导入 151 个 Claude Code 与 30 个 Codex 富文本/思考/工具完整会话，优化渲染回退与 msgCount 索引。
- **2026-08-22**: 🤖 **OneAPIChat 子代理创建与路由全链路修复** — 解决子代理因提供商 Key 错配、LongCat/MiniMax/DeepSeek 跨提供商模型残留及双重启动竞态报 400 invalid_parameter/Unsupported model；前后端协同透传当前主模型与 Base URL，清空 tools 联动剥离 tool_choice，端到端创建/执行/完成 100% 验证通过。
- **2026-08-22**: 🐛 **发送消息 apiMessages 未定义异常修复** — 补齐回滚快通道时不慎漏调的 `let apiMessages = buildApiMessages(chatId);`，彻底消除 UnhandledRejection 与发消息阻塞。

# OneAPIChat 项目架构指南

> 每次修改项目后，Agent 必须更新此文件（特别是「最近变更」章节）。
> **规范**: 新变更只需在「最近变更」顶部追加**一行摘要**（日期+emoji+标题+核心要点），完整细节写入 `docs/CHANGELOG.md`（「OneAPIChat 最近变更全文」章节）。

- **2026-08-21**: 🧹 **持久化产物全链路清理闭环** — 修复两个缺口：磁盘流快照压缩原本仅启动时跑一次（现每 30 分钟执行，30 天过期删+压缩）；runtime prune 从未被调用且 runtime_events 无清理（现 90 天保留，终态会话旧事件删除）。全部持久化均有上限：streams 30 天、runtime 90 天、内存完成态 10 分钟、前端 _rs_* 30 分钟 TTL、备份每文件 30 份。

- **2026-08-21**: ♻️ **流式持久化全面对齐 DSH（磁盘快照权威 + 增量重放）** — chat_create 先落盘再注册任务，任何失败也保证磁盘有记录；chat_stream_offset 按 msg_id 从磁盘恢复（内存 _resumable 只是缓存），快照含 finished/producer_lost；token 即时落盘+since 增量重放；前端 snapshot 渲染、恢复以 active_tasks 权威、404/410 静默降级；引擎重启后按旧 msg 恢复 200+snapshot 实测通过。

- **2026-08-21**: 🧠 **OneAPIChat 子代理跟随主模型路由修复** — 子代理不再使用旧记录中的 LongCat endpoint 覆盖当前主模型 Luna；默认沿用当前主聊天 provider/base URL/model，只有显式独立路由才使用子代理专属配置。

- **2026-08-20**: 🧹 **消息队列残留与刷新续接断链修复** — 冷启动清理所有 `oc_queue_*` 持久键，避免旧队列污染/重复发送；活动任务恢复遇到引擎 502 时延后且静默；RAG 与引擎状态错误降噪；当前会话独立落盘并按需恢复，避免刷新丢消息。

- **2026-08-20**: 🦁 **Brave 搜索引擎官方接口与项目代理全链路优化修复** — 全面重构 Brave Search 为官方端点规范（支持 web/news/images、Accept-Encoding gzip、X-Subscription-Token、text_decorations=0、extra_snippets 丰富拼接）；`api/engine_api.php`（search_proxy）、`api/v1/search.php`、`api/v1/tools/call.php` 和 `python/engine_server.py` 统一接入项目出站代理（本地 Mihomo 1080 极速出口 + 8890 备用），并在 `api/proxy.php` blockedHosts 补齐 Brave 域名分流，彻底根除直连超时与 CORS/反爬阻断。

- **2026-08-20**: 🎯 **蕾米角色视觉中心与首行文字对齐** — 根据实际截图将桌面端头像偏移从 -12px 加深至 -30px，以角色主体而非 360px 透明画布几何中心对齐正文第一排；移动端位置保持不变。

- **2026-08-20**: ↗️ **蕾米头像与首行正文垂直对齐** — 针对 360×360 角色动画底部透明留白导致视觉重心偏下，桌面端头像容器上移 12px，并兼容头像入场/离场动画；移动端贴纸布局保持原位。

- **2026-08-20**: ✨ **蕾米真实三点等待器与完成状态闭环修复** — 废弃易受 CSS 冲突的伪元素省略号，改为真实 DOM 玻璃胶囊三圆点逐个跳动；流式收尾 finalizeBubbleUI 显式清理等待器并投递 turn/completed，完成后切庆祝动画并于 5 秒后回待机，不再滞留奋笔疾书。

- **2026-08-20**: 💾 **聊天消息刷新不丢失与 RAG/引擎 502 修复** — 16MB+ all.json 改为元数据首屏+当前会话按需 hydration；用户消息先写独立会话文件再异步汇总；RAG proxy 对齐内置 8766 引擎，验证 collections/knowledge/list_models/embed_config 全部 200。

- **2026-08-20**: 🧩 **DSH Vibe Coding 可信运行时一期升级** — 上线服务端签发/会话绑定/TTL/撤销的文件权限 grant，越界自动弹窗并仅重试一次；实现 read-before-write 观察铁律、修改后语法校验与失败回滚、前端资源自动 build-index；标准工具 Schema 去重、Todo 按聊天持久化、真实 Diff hunk，以及受限 VM + RPC 的 run_code 聚合编排。

- **2026-08-20**: ⚪ **蕾米等待三点彩色胶囊畸变修复** — 根除以 box-shadow 复制圆点导致的紫粉胶囊和残留小省略号，改用单一 46×14 径向渐变画布绘制三个清晰 8px 灰色圆点，明暗主题统一且无阴影、无额外装饰叠加。

- **2026-08-20**: 🫧 **蕾米头像蓝色底板彻底移除** — 修复浅色主题强制 `#2563eb !important` 覆盖透明头像背景的问题，并为 DSH/经典/极简及明暗主题增加最终透明守卫，角色现在直接悬浮显示且无圆形底板与阴影。

- **2026-08-20**: 📐 **蕾米完整角色与消息内容间距修复** — 桌面端头像列增加 18px 安全间距并清理旧 52px/圆形裁切覆盖规则，避免角色头发、翅膀紧贴 Agent 操作卡和正文；移动端继续采用贴纸布局不额外挤压内容。

- **2026-08-20**: 🌸 **蕾米高还原角色动画素材重构** — 撤下抽象 CSS 拼装头像，引入可核验来源的 360×360 蕾米埃尔六套动画，按思考/工作/创作/等待/完成/失败状态切换；头像放大至完整角色构图，小窗保持无损缩放，并补充来源与权利声明。

- **2026-08-20**: 🤖 **蕾米 DSH 事件状态机与陪伴行为升级** — 借鉴 Apache-2.0 的 remielle-dsh-plugin 状态投影设计，新增 working/waiting/celebrate/failed 结构化状态、审批等待联动、庆祝冷却、空闲彩蛋与双击互动；保持纯 CSS 绘制，不引入受限角色素材。

- **2026-08-20**: 🎀 **蕾米纯程序桌宠与等待动效升级** — 默认保持聊天头像模式，点击后才展开可拖拽小窗；移除 GIF 依赖，使用 HTML/CSS 矢量部件驱动待机/思考/创作/完成/异常表情动画，并将等待输出三点升级为大尺寸渐变波浪动效。

- **2026-08-20**: 🔓 **文件系统访问范围放宽与全盘权限动态授权升级** — 扩大 _allowed_path 默认覆盖核心系统目录（/var/www、/var/log、/etc、/home、/opt、/tmp）；支持 full_access 动态全盘权限提升与弹窗授权，普通聊天临时权限下自动同步开放全盘检索与编辑。

- **2026-08-20**: 🚀 **DSH 风格 Vibe Coding 全套底层工具与纯 SVG 状态看板落地** — 导入 read/write/edit/bash/grep/glob/todo_write 底层标准工具链与别名容错；全面禁用 Emoji 改用纯矢量 SVG 状态图标；上线代码修改可视化行级 Diff 视图与 Live Todo HUD 任务实时进度看板。

- **2026-08-20**: 🛡️ **DSH 风格文件安全防护策略落地** — 覆写前自动创建 `.bak` 安全备份防止数据丢失；重构工具定义强制引导 AI「先 `server_file_read` 观察再用 `server_file_edit` 局部精确修改」，严禁盲写全量覆盖。

- **2026-08-20**: ✅ **模型持久化真实浏览器验收与控制台错误清零** — 根因锁定为跨提供商 `/models` 迟到响应污染 + `getVal(modelSelect)` 隐式 DeepSeek 伪回退；加入请求代次/Abort 隔离、去除伪回退与双 Beacon，真实 CDP 验证切换/保存/刷新均保持所选模型，自定义列表无 DeepSeek，控制台 0 错误。 — `model_{provider}` 本机选择成为最高权威，服务端仅可补空绝不回灌覆盖；配置保存附模型时间戳，后端拒绝迟到旧请求反写最新模型。 — 根除 `fetchModels` 异步拉取完成时将当前有效选择重置为 `models[0]` 的覆盖 Bug；引入预选缓存保护与厂商专属模型权威锁定。 — `proxy.php` 为国内大模型厂商（DeepSeek/智谱/通义/Kimi/豆包/MiniMax/小米等）建立 0 延迟直连通道；`fetchModels` 探测超时从 15s 锁紧至 6s；彻底清除自定义列表中的异构模型残留。 — 彻底根除 `ModelsCatalog` 在渲染特定厂商（如小米 MiMo）时将历史/全局异构模型（如 `deepseek-v4-flash`）硬塞入列表的串扰 Bug；补齐 `mimo`、`doubao`、`nvidia` 预设。 — 根除切换提供商或重新拉取模型时，因大小写或 DOM 选项重构失败而触发 `selectedIndex=0` 并反向覆盖破坏 `model_{provider}` 的 Bug；`ModelsCatalog` 与选择器严格锁定已选模型。 — `fetchModels` 在 Key 额度用完（上游报 403）或网络异常时，自动回退渲染 `ModelsCatalog` 内置模型列表，防止下拉框永远停留在“加载中”。

- **2026-08-20**: 🌐 **xiaoxin.naujtrats.xyz DSH 新建对话 404 修复** — 补全 `/api/llm`、`/api/model`、`/api/provider`、`/api/chat` 等前缀分流规则，解决点击新对话时请求 `/api/llm.providers` 误入 3001 报 404。

- **2026-08-20**: 🌐 **xiaoxin.naujtrats.xyz DSH 全功能补全与 Origin/WS 根治** — default 补 commands/atFile 前缀路由（消除 401/404）、WS 增加 `Origin ""` 清空（彻底根治浏览器握手 closed 问题）、全部 39 条 API 开启 gzip 压缩加速会话历史加载。 — default 补 sub_filter 的 /api/ 改写与 base 注入、/api/ 前缀分流 39 条 DSH 方法名路由→3080（避开 CloudCLI 的 /api/→3001）、events.mux/events.host WebSocket 101、顶层路由补 Origin 清空防 403；本机 443 全端点 200/101。

- **2026-08-20**: 🌐 **xiaoxin.naujtrats.xyz DSH 资源 404 修复** — 用户内网 DNS 把 xiaoxin 指向 192.168.195.213:443，本机 default server 的 DSH 路由不完整（`location /oneapichat/dsh/` 缺 `^~` 被 js/css 正则抢占致 assets 404，且缺 /plugins/、/favicon.svg、/client.js 等顶层路由），已补全并加 ^~；边缘 176/226 新建 xiaoxin server 块（176 通配证书 + 226 复制通配证书），双边缘+内网全路径资源 200。

- **2026-08-20**: 🌙 **DSH 502/504 根治完成：ZeroTier moon 全链路部署** — 边缘 176 部署 moon（047f34d1cd）、226 与 Windows 宿主（08cf1e942b，经 ssh xiang@127.0.0.1 orbit + local.conf）全部加入：Windows→176 DIRECT 61ms、→226 DIRECT 60ms，RELAY 全部消除；公网压力 20/20 成功。注意：orbit 脚本中 Restart-Service 会把 ZeroTierOneService 停掉需 sc start 恢复。

- **2026-08-20**: 📈 **全球金融实时行情全覆盖与时区交易感知升级** — 彻底根除时区错乱（北京时间凌晨误判美股休市）与附会编造幻觉；`stock_*` 工具扩展全市场（美股股票/费半SOX/纳指/标普/道指+港股+全球外盘），`get_current_time` 注入 EDT/EST/JST 全球时区与开闭盘状态，系统提示词强化实事求是准则与金融 SPA 动态检测。

- **2026-08-16**: 🛡️ **续接空指针 undefined.length 根除与队列服务端幽灵复活清理** — 修复 `sendMessage(true)` 接续调用时 `files` 为 `undefined` 导致的 `Cannot read properties of undefined (reading 'length')`；将所有 `oc_queue_*` / `queued_message_*` 标记为临时运行时键并在前后端配置同步中彻底剔除，清洗数据库中历史残留的「自由发挥/素材」旧队列。

- **2026-08-16**: 🪵 **控制台日志全链路规范化、隐私脱敏与智能降噪** — 前端核心新增结构化安全日志器 `AppLogger` 与 `console` 兼容桥，生产环境默认静默调试杂讯并保留 200 条内存环形缓冲区；自动过滤 KaTeX 字体指标警告，将预期回退/保护性跳过自动归类降噪；全模块清洗剥离用户消息、模型正文、网盘参数、上游 400 完整错误与原始流 buffer，访客模式阻断 RAG 401 报错；支持 `?debug=1` 瞬时切入调试。

- **2026-08-16**: 🔕 **刷新后 SSE 历史通知回放风暴根治** — 引擎对全新页面连接不再从 0 盲目回放 256 条历史事件，仅重连带 `Last-Event-ID` 时补发差量；前端持久化 SSE `sourceId` 防误认本端，回放事件静默入库禁弹 Toast，模式防抖与全局气泡上限（最多 6 条）彻底消除刷屏。

- **2026-08-16**: 🔄 **更新提示按钮休眠竞态修复** — 更新提示的 RAF 动画改为绑定具体按钮实例，并校验实例身份与 DOM 连接状态；隐藏/移除定时器不再通过可变全局引用操作新按钮，消除页面休眠恢复后的 `null.style` 异常。

- **2026-08-16**: 🛡️ **消息队列持久化隔离修复与人格预设 429 降噪** — 修复队列在模式切换/会话切换与 unload 时的残留键误存和幽灵复活；为人格与记忆上下文加载增加安全 JSON 检查、TTL 缓存和并发去重，消除 SSE 频繁事件下的 429 报错与 HTML 解析异常。

- **2026-08-16**: 🌐 **123网盘直链解析与蓝奏云失效识别修复** — 新增 123Pan 官方分享列表/下载信息 API，支持提取码和动态 UserID API 域名；蓝奏云明确区分“分享已取消/失效”和反爬/签名失败，不再误报页面被反爬。

- **2026-08-16**: 🧭 **Agent 会话边界与历史筛选加载顺序修复** — `isAgentChat` 仅接受完整的 `_agent_old_`/`_agent_sub_` 前缀，避免把 `_agent_old` 等普通 ID 错归 Agent；历史过滤在测试/懒加载环境下不再依赖未定义的 `AGENT_CHAT_ID` 全局。

- **2026-08-16**: 🕷️ **网页抓取、Agent 聊天与下载工具可用性增强** — web_fetch 对重定向/403/429/JS 空壳增加安全 Chromium+正文提取兜底；Agent 面板关闭前移焦点并容错异常数据；B站/磁力下载返回真实 completed_files 路径，网盘蓝奏云增加浏览器解析与无关 JxPan 错误隔离。

- **2026-08-16**: 🔑 **B站扫码内联二维码与 web_fetch 401 修复** — B站二维码复用超星式前端 base64 独立展示，不再把本地 PNG 上传 Cloudreve 或生成 404 链接；同源 fetch.php 请求统一补主站 Bearer，恢复网页抓取。

- **2026-08-16**: 📐 **扫码二维码独立消息居中修复** — DSH 主题下独立二维码行之前按内容宽度贴在助手头像右侧，现让 QR 行占满消息区并将二维码卡片内容居中。

- **2026-08-16**: 🔐 **Server 工具鉴权与联网失败回退修复** — engineApiHandler 统一为 server_file_grep/server_exec 等请求补 Bearer Header，修复已登录页面被 engine_api.php 判定未登录；ask_agent 不再向模型注入可能不存在的工具清单，web_fetch 明确使用代理/中继/直连回退并在需要时请求 toggle_proxy。

- **2026-08-16**: 🖼️ **搜索图片链接直接渲染** — 流式、历史和非流式 Markdown 统一识别图片扩展名及“立绘/美图/壁纸/原图”等标签链接并渲染内嵌图片；视频等普通链接继续保持文本链接。

- **2026-08-16**: 🔁 **工具轮配对与刷新续接稳定性修复** — 统一清洗 assistant.tool_calls 与紧邻 tool 结果，前后端双重拦截半截/乱序工具历史；运行时事件投影补回有序 role=tool 消息，Anthropic 转换拒绝空 ID，补齐 ResumeStream 缺省 toolCalls 和 messages 防御，避免 DeepSeek 400 及恢复时 undefined.length。

- **2026-08-16**: ♿ **配置面板关闭焦点无障碍修复** — 关闭含有焦点按钮的设置面板前先将焦点移回外部设置触发按钮，再设置 aria-hidden/inert，消除关闭工具详情或保存配置时的浏览器焦点警告。

- **2026-08-16**: 🖼️ **生图结果、蕾米状态与重复状态卡修复** — 移除 generate_image 重复的「正在生成图片」状态行，生成/完成/失败联动蕾米悬浮窗，兼容 generatedImages 元数据对象并恢复完成后的图片渲染；用户头像继续隐藏但不影响助手蕾米头像。

- **2026-08-16**: ⚡ **斜杠命令全链路可用性重构、/clear 彻底清空与队列防复活优化** — 根因与修复：①/clear 后刷新复活根因系前端 `_saveChatsToServerOnce` 与后端 `chat.php` 的旧防截断逻辑在 `$oldMsgs > $newMsgs` 时强行覆盖，现以 `cleared` 标记与更新时间戳 `$newTs >= $oldTs` 为权威依据，前端与后端同步放行清空；②/clear 时联动全链路中止当前流（`stopGeneration`）、彻底排干并清空所有会话内存与 localStorage `oc_queue_*` 队列键、同步删除流缓存，防止刷新幽灵自发与队列复活；③修复 `/search`、`/news`、`/image` 在 `main.js` 中被普通命令拦截吞掉的致命 Bug，补齐无参数提示；重构所有 30+ 斜杠命令（`/mode`、`/model`、`/compact` 强制压缩、`/retry` 自动清旧气泡、`/copy` 降级剪贴板、`/stop` 全链路中止、`/doctor`、`/context` 等），全量 44 项命令单元测试与端到端清空保护通过。

- **2026-08-16**: 🛠️ **引擎鉴权 401 根治、队列死锁与 /clear 失效修复、排版滚动条消除** — 根因与修复：①`resume-stream.js` 在 fetch `/engine/chat/stream` 时未携带 `Authorization` 头与 `auth_token` query，且 `users/sessions.json` 权限被 0600 锁定导致跨用户 engine 无法读 token 报 401，现补齐双重鉴权与 0660 权限 + SQLite 双写；②`_smartSend` 与 Enter 监听在有队列时拦截所有输入（含 `/clear`）死锁入队，现命令优先直通且空闲自动排干、清空持久化键；③DSH 皮肤下外层 `#chatBox` 误加 `max-width: 900px` 致滚动条悬空且右侧大面积留白，现重置外层 100% 满宽并将居中限制下沉至内层消息容器，全链路 200 验证通过。

- **2026-08-15**: 📬 **消息队列与推入/插话（Steer）机制对齐 DSH 重构** — 修复队列主按钮在空输入时无效的问题，升级为智能状态按钮（输入时存入队列、空输入时发送下条/插话）、队列每项增加「⚡ 插话」与「▶ 发送」按钮，并全面重构 AI 绘图卡片为磨砂玻璃流光 Studio 风格。

- **2026-08-15**: 🎨 **主题/皮肤系统上线与 DSH 现代智能体工作台排版落地** — 推出全新主题模块系统（DSH 工作台/经典气泡/现代极简），支持无气泡自然流式输出、DSH 风格工具调用时间线（# Tool · Target + 运行/成功/失败状态胶囊 + 折叠详情）、Think·思维链折叠块与配置栏即时切换；全量回归通过并已同步构建。

- **2026-08-15**: 🧠 **多方言思维链（reasoning/thinking）流式提取补齐** — 修复引擎只识别 delta.reasoning_content 导致忽略 delta.reasoning/thinking/model_extra 的问题；前端与后端统一对齐 DSH 的多字段容错提取（reasoning_content/reasoning/reasoning_text/thinking），已热重启并验证单测。

- **2026-08-15**: ☁️ **用户菜单 DSH 伴随入口修正为 CloudCLI** — 根用户下拉菜单中 DSH 旁的原 Cloudreve 外链修正为指向 `/oneapichat/developer.html` 的 CloudCLI 入口，补齐项目根 `developer.html` 软链，并更新终端图标与构建资源。

- **2026-08-15**: 🤖 **自定义/中继 OpenAI 格式下的 Claude 模型报错修复** — 根因：detect_provider 仅凭模型名前缀为 claude 即强制归类为 anthropic 协议族，导致指向 CLIProxyAPI 等 OpenAI 兼容中继（/v1/chat/completions）的 Claude 请求被 prepare_openai_request 拦截报 400 provider requires Anthropic wire format；现仅官方 api.anthropic.com 或显式开启 anthropicFormat 时才使用 Anthropic 协议，中继下的 Claude 正常按 OpenAI 格式流式处理，单测通过已热重启引擎。

- **2026-08-15**: 🔒 **会话令牌与工具敏感参数请求头迁移** — 消除 chaoxing/netdisk/amap/memory_api/auth.php 在 URL 查询串中传递 auth_token、网盘提取码、高德 Key、地址坐标及登录密码；前端统一使用 Bearer Header 与 POST Body，后端使用 extractSessionToken 统一提取并保留旧客户端兼容，全量回归与实测 200 通过。

- **2026-08-15**: 🧯 **Gemini 3.7 长时间生成卡死与取消后继续重试根治** — 访问日志确认客户端已发 DELETE，但 SDK 内建 2 次重试与外层 5 次叠加且取消后仍续发；现 SDK 重试归零、单层最多 5 次且每阶段检查取消，取消立即持久化 CANCELLED 终态，空/仅思考响应不再 HTTP 重放，真实 Gemini 工具流返回 done+tool_call。

- **2026-08-15**: 🔑 **CLIProxyAPI 模型 404、Gemini 空输出与续接双加载条修复** — 双边缘补 `/v1/models` 精确代理，保留 custom endpoint 权威路由；CPA 添加 3.5/3.6 旧别名并切换 3.7-high，认证错误禁止重放，partial/ResumeStream 统一为单一 typing 指示器。

- **2026-08-15**: 🌐 **关闭网页代理后的跨域与 RAG 500 修复** — 外部提供商 API 即使关闭出站代理也始终通过同源 PHP relay，避免浏览器直连触发重复 CORS 头；RAG 响应增加 HTTP/空响应安全解析和结构化 502，重新构建前端资源。

- **2026-08-15**: 🛡️ **DSH 式 Agent 运行时与断线续接加固** — 新增 SQLite 持久事件/任务/目标/可续子代理运行时、统一错误与工具遥测；引擎/PHP 桥接改为签名内网认证+用户绑定，SRC/浏览器/RAG 分域隔离；聊天 namespace 禁止跨用户选择，Cloudreve 服务器文件导入移除公开共享令牌并改签名 loopback bridge；主聊天/Agent/RAG/上传请求迁至 Authorization 或同站 Cookie，所有重试统一最多 5 次；RS 保留窗口 30 分钟且 create ACK 超时不再误用提供商请求超时；日志去除用户内容，完成全量回归并已部署。

- **2026-08-14**: 🧠 **Gemini 思考显示修复（RS 链路断点补齐）** — 实测确认 `reasoning_effort` 唯一触发思考文本；再排查发现默认 RS 路径 main.js→ResumeStream.create→chat_create 请求体只传白名单字段，思考参数从未发到引擎；修复：main.js 传 reasoningEffort/thinkingLevel/extraBody，resume-stream.js 写入 chat_create 请求体；4 文件（models/engine/resume-stream/main）+PM2 重启

- **2026-08-14**: 🤖 **Gemini 模型 400 修复（工具 enum 空字符串）** — 根因：`tools.js` 中 `stock_kline`/`stock_chart` 的 `adjust` enum 含 `""`，Gemini FunctionDeclaration 校验禁止空 enum 值（`enum[2]: cannot be empty`）；修复：enum 改 `["qfq","hfq","none"]` + `stock_data.py` 映射表补 `"none"`，保留不复权能力；2 文件

- **2026-08-13**: 🐛 **analyze_image 默认分析旧截图修复（默认改为最新上传）** — 根因：imgIdx 默认为 0（第一张/最旧），图片池按消息时间正序排列，用户说"这张图片"时 AI 不传 image_index 导致分析最旧的而非最新上传的；修复：imgIdx 默认改为 -1（未指定），选择时 -1 映射到最后一张（最新上传），工具定义同步更新说明"不传则分析最新上传的图片"

- **2026-08-12**: 🔧 **MCP 端点间歇性 404 根因修复（双服务器 DNS 轮询）** — 根因：Cloudflare DNS 两条 A 记录（115.29.211.17/121.41.173.182）轮询分配请求，Server1 回源 WSL2:8080（xiaoxin-proxy-port 无 MCP 重写）→ 404，Server2 回源 WSL2:443（有重写）→ 200；修复：WSL2 `default` + `xiaoxin-proxy-port` 两台 nginx 均添加 `rewrite ^/oneapichat/api/v1/mcp$ .../mcp.php break;`，15/15 全绿

- **2026-08-12**: 🔧 **本地模型上下文过长 400 错误智能修复(v2)** — 根因：本地模型返回 "request (N tokens) exceeds the available context size (M tokens)" 不匹配现有检测模式；且系统提示词+106工具定义本身占 ~16000 tokens（远超 8192 限制），仅裁剪消息历史无效；修复：①增加 5 种正则匹配 ②trim_context 智能裁剪（按超限比例保留 20%~40% 消息）③★新增：当消息少但 token 仍超限（系统提示词占限制>60% 或消息≤2条）时，同时裁剪系统提示词至 1500 字符 + 减少工具数量至 30%（至少10个）④同时降低 max_tokens 为输出预留空间

- **2026-08-11**: 🎯 **超星 `rt_d` 心跳映射与兼容回退** — 受控对照确认同一任务由 `rt=0.9/isPassed=false` 改 `rt=1` 后通过；默认优先 `rt=1`，末尾未通过再试 0.9，兼容不同任务卡且不在每次心跳重复请求

- **2026-08-11**: ⛔ **超星永久资源失败停止空转** — 实跑确认 `unknown/failed/transfer` 资源和穷尽 `rt` 后的 HTTP 403 不会随章节重试恢复，现立即 blocked 并继续后续章节，保留未完成状态与具体原因

- **2026-08-11**: 🔁 **超星章节复核重试 3→8** — 任务卡解析失败与服务端未完成复核均最多重试 8 次，退避等待 5 秒递增并封顶 30 秒，仍保持当前章节不跳过

- **2026-08-11**: 🚧 **超星卡进度恢复 + 阻塞续刷 + 人脸误判纠正** — 不再把通用校验字段误判为人脸；首次续播失败后从 0 秒按任务卡周期重建观看会话，任务卡复核确认完成；8 次耗尽则 blocked 并继续后续章节

- **2026-08-11**: 🗃️ **超星题库缓存路径修复** — `cache.json` 从启动目录迁移到 `/tmp/AutomaticCB/cache_<user>.json`，按账号隔离、损坏自愈、写失败降级联网查询，避免 www-data 权限错误中断课程

- **2026-08-11**: 🔌 **MCP 双 ECS 入口一致性 + 超星任务完成可靠性修复** — ECS2 扩展名隐藏入口由 404/单工具副本统一反代主 MCP，双节点均稳定返回 153 工具；前端测试消除竞态并按真实结果计数；超星补齐视频校验字段、从服务端进度续播、不允许倍速时自动 1x，明确空任务卡不再误报解析失败；相关单测 6/6 通过

- **2026-08-11**: 🔄 **主账号资料与 Cloudreve 同账号联动** — 用户名、邮箱绑定/更换、密码修改和找回密码重置统一原地同步 Cloudreve；保持云盘用户 ID/文件/容量归属不变，拒绝重复邮箱；主登录自动补偿失败同步，缓存保留 Cloudreve user_id；资料页明确显示同步结果；隔离回归 18/18 通过

- **2026-08-11**: 🧭 **刷课复核失败跳章 + Cloudreve PWA 误拦截入口修复** — `study_video` 不再接受未到末尾的提前 `isPassed`; 服务端复核失败保持当前章节并退避重试3次，仍失败暂停课程不跳章；停止旧进程并清接续状态；云盘SSO延长至5分钟并由GET改POST绕过Workbox未知路由兜底；真实Chromium落地文件列表成功，相关18测试全绿

- **2026-08-09**: 🎛️ **子代理会话默认隐藏+配置栏开关** — 新增「子代理会话」开关(右侧配置栏→显示设置,默认关闭);renderChatHistory 增加 _showSubAgent 判断,普通模式下子代理会话(_agent_sub_*)仅在开关开启时显示;持久化到 localStorage.showSubAgentSessions;init.js 初始化开关状态+change 事件;移除了侧栏大按钮;3文件

- **2026-08-09**: 🐛 **EOF/连接中断自动重试修复(代理长任务500错误)** — 根因:_isRetriableError和isNetError未覆盖EOF/连接中断类错误,导致长任务通过代理时遇到EOF不会自动重试;修复:①resume-stream.js _isRetriableError增加EOF/ECONNRESET/ETIMEDOUT/socket hang up/aborted/network error检测,连接错误可重试5次(其他3次),初始延迟3s(其他2s);②main.js isNetError增加isConnectionError检测;2文件

- **2026-08-09**: 🐛 **Agent会话刷新丢失+子代理隐藏失效修复** — 根因:①renderChatHistory 缓存恢复逻辑(576-589行)未应用子代理隐藏过滤;②restoreUserData 合并逻辑中 Agent 聊天未始终保留本地完整数据;③DB模式下 Agent 聊天被降级为索引;修复:①缓存恢复增加 _showSubAgent 判断;②Agent 域聊天始终保留本地完整数据(不依赖服务器);③DB模式下 Agent 聊天仍保存完整数据;2文件

- **2026-08-09**: 🐛 **退出登录失效+缓慢根因修复 (clearAuthToken 缺失+session 未清除+reload 竞态)** — 根因链:①`clearAuthToken()` 函数从未定义→cookie 未清除;②`location.reload()` 在 `fetch(logout)` 完成前触发;③reload 后 `initAuth()`→`cross_domain_token` 从仍存活的 session/cookie 恢复登录态;④服务端 logout 只清 sessions.json 未清 session;修复:①core.js 新增 `clearAuthToken()` 清除 cookie+localStorage;②logout 改 `async/await` 等待服务端完成;③服务端 logout 增加 `session_destroy()`+清除 auth_token cookie;④注册接口错误提示修复(显示真实 error 而非"请检查代理设置");验证:logout 后 verify 返回 valid:false

- **2026-08-09**: 🐛 **邮箱验证码发送失效根因修复 (SMTP_PASSWORD 环境变量缺失)** — 根因:2026-06-06 提交 `fe68822` 把 `api/mailer.php` 硬编码 163 SMTP 密码改为 `getenv('SMTP_PASSWORD')`,但该环境变量从未配置到 PHP-FPM 环境,`getenv()` 返回空→`return false`;修复:①`/etc/oneapichat/smtp.env`(chmod 600) 隔离存储凭据②systemd drop-in `php8.3-fpm.service.d/smtp.conf` 加载 EnvironmentFile③pool config 添加 `env[SMTP_PASSWORD] = $SMTP_PASSWORD`;验证:sendVerificationCode 返回 OK + API 返回 success

- **2026-08-09**: 🐛 **刷课计数超计+错误标记完成+跳过已完成课程根因修复** — 根因:①`video_done/work_done`无限累加无上限;②完成判定 video OR work→completed（混合应AND）;③`video_count`不统计audio;④空章节不标记完成;⑤`status=running`降级completed;⑥main.py课程级`completed→skip`导致新增内容永远刷不到;⑦chapter状态保护阻止重刷;修复:计数器MIN上限、完成改AND、audio计入、空章节completed、completed不降级(除非计数增加→重置done+降级running)、移除课程级skip、start_course不跳过;3文件+DB全局修复

- **2026-08-09**: 🐛 **刷课计数超计+错误标记完成根因修复(完成判定/计数器保护/音频计数)** — 根因:①`tracker.py` video_done/work_done 无限累加无上限（单视频被看17次）;②完成判定 video OR work 达标即 completed（混合章节应 AND）;③`video_count` 不统计 audio 类型导致 done>count;④空章节不标记完成导致课程永远无法完成;⑤`status=running` 会降级已 completed 章节;修复:计数器加 MIN 上限、完成改 AND 条件、audio 计入 video_count、空章节显式 completed、completed 章节不降级;3 文件+DB 修复

- **2026-08-09**: 🐛 **课程误标已完成无法继续刷修复(完成判定逻辑+空章节处理)** — 根因:①`tracker.py` `is_chapter_completed()` 将 `status='running'` 且 `video_count=0,work_count=0` 的章节误判为完成,导致 total=0 的课程被标记 completed;②`main.py` 空 jobs 章节只 continue 不标记完成,导致课程永远无法真正完成;修复:完成判定只看 `status='completed'`,移除 0/0=完成推断;空 jobs 章节显式 `update_chapter(status='completed')`;并重置 9 门错误课程为 in_progress;2 文件+DB 修复

- **2026-08-09**: 🛡️ **learning_records.db 只读复发根治(取消git跟踪+ACL+systemd加固)** — 原"三重防护"均为事后修补,git checkout/pull/merge 重建文件仍会重置权限;根治:①`git rm --cached`+`.gitignore` 使 git 永不触碰 db 文件;②systemd path unit 改监控目录(`PathExistsGlob`+`DirectoryNotEmpty`)防 inode 替换漏检,并修复整个 db* 文件和目录权限;③目录级 default ACL(`default:group::rwx`)新文件自动继承;④保留 2min cron 兜底;2 文件+.gitignore+systemd units

- **2026-08-10**: 🐛 **generate_image_i2i 报错 `_isDirectVision is not defined` 修复** — 根因:tools-exec.js:1469 使用 `_isDirectVision` 变量但该变量从未定义(遗漏声明),图生图分析参考图时直接抛 ReferenceError;修复:在循环前新增 `_isDirectVision` 声明,逻辑与 image-gen.js analyzeImage 的 `isDirectApi` 一致(visionApiUrl 不含 /mcp 即为直连);tools-exec.js + index.html `?v=` bump
- **2026-08-10**: 🐛 **xAI/Grok 生图 400 全链路修复(前端+PHP+mcp.php+引擎+配置同步)** — 根因:①前端硬编码 `size` 参数,xAI 不支持返回 400;②call.php 硬编码 MiniMax;③config.php 过滤提供商专用密钥;④call.php 只读 JSON 备份不读 DB;⑤★**关键**:第三方 MCP 调用链 `客户端→mcp.php→Node.js MCP(18788)`,mcp.php 的 tools/call 只拦截 analyze_image,generate_image 直接转发到 Node.js MCP 的 execImageGen(硬编码 MiniMax CLI);修复:前端 image-gen.js `_isXai` 检测,call.php 多提供商+DB 优先,config.php 加 11 个密钥白名单,engine_server.py 本地处理,★mcp.php 新增 `generateImageServerSide()` 仿 analyze_image 模式拦截 generate_image/generate_image_i2i 并读 DB 多提供商分发;image-gen.js+call.php+config.php+mcp.php+engine_server.py+index.html `?v=` bump
- **2026-08-08**: 🐛 **死循环检测误触发修复(幂等工具排除 + 纯工具轮阈值提升 + RS续接同步)** — 根因:①server类只读工具(read/exec/python/grep等)正常迭代会反复调用,原累计计数 3 次即误触发 soft;②"连续纯工具轮"检测器阈值仅 6 轮,Agent 多轮工具调用频繁触发 hard 中止;③RS 续接后 feedText 未同步致 contentLen 过期误判;修复:新增 IDEMPOTENT_TOOLS 集合跳过幂等工具重复/振荡检测,纯工具轮阈值 6→12,feedText 空文本不再重置 contentLen,main.js RS 续接后同步 feedText(pendingMsg.content),maxSoftTriggers 3→2;4 文件+2 测试,index.html `?v=` bump

## 铁律（Agent 必读）

### 🚫 index.html script 标签 — 禁止手动编辑

**Agent 修改任何 JS/CSS 文件后，必须运行 `python3 tools/build-index.py`，严禁手动修改 index.html 中的 `<script>` / `<link>` 标签。**

原因: index.html 有 45 个资源标签，手动改必错。生成器会:
- 扫描 `js/*.js` / `css/*.css` / `lib/*`，按文件 mtime 自动生成 `?v=` 版本号
- 替换 `<!-- AUTO-GENERATED-START --> ... <!-- AUTO-GENERATED-END -->` 之间的内容
- 自动同步 `public/index.html` → 根 `index.html`

```bash
python3 tools/build-index.py            # 重建
python3 tools/build-index.py --check    # 检查是否过期
python3 tools/build-index.py --watch    # 监听变化自动重建
```

**错误示范（会导致版本不一致）**:
- ❌ 手动改 1 个 `?v=` 而忘记其他 44 个
- ❌ 改 `public/index.html` 但不同步到根（nginx serve 根文件）

**正确流程**:
1. 修改 `js/xxx.js` 或 `css/xxx.css`
2. 运行 `python3 tools/build-index.py`
3. 提交代码

### 项目文件结构

- **nginx serve 路径**: `/var/www/html/oneapichat/index.html`（根目录）
- **实际源文件**: `public/index.html`（generator 写入这里，然后同步到根）
- **symlink 结构**: 根 `js`→`public/js`, `css`→`public/css`, `lib`→`public/lib/lib`

## 最近变更

- **2026-08-16**: 📥 **夸克网盘大文件下载与动态会话修复** — 分享链接可直接下载，服务端自动保留 Cookie/Referer/UA；大于 512MB 改为后台队列并支持 `netdisk_status(job_id)` 查询，aria2 失败时使用 curl 断点续传兜底。

- **2026-08-16**: 🧰 **Skills 长消息 414 请求修复** — 技能匹配由超长 GET 查询改为 POST JSON，并增加 HTTP 状态检查，避免 414 后把 nginx HTML 错误页误解析成 JSON。

- **2026-08-16**: 🔄 **刷新时生成中聊天恢复修复** — ResumeStream 快照先注入聊天再渲染，刷新前优先保存当前会话并等待服务器快照，避免正在生成的回复完全消失。

- **2026-08-16**: 🧹 **过期子代理幂等删除与 404 降噪修复** — DELETE 已不存在的聊天现在返回成功，避免清理旧子代理时控制台持续出现 404。

- **2026-08-16**: 🧹 **Agent 历史恢复与过期子代理清理修复** — DB 索引模式下优先恢复服务器完整 Agent 消息；过期子代理改为限速串行删除，避免 429 和删除后被全量保存复活。

- **2026-08-16**: 🧠 **推理过程标题去除思考 Emoji** — 保留“推理过程/思考过程”文字与折叠箭头，移除标题旁的 🤔/💭 图标。

- **2026-08-16**: 🧩 **会话 404 回退与 Mermaid 空白预览修复** — 单会话文件不存在时回退从 `all` 快照恢复，Mermaid 灯箱改为直接挂载 SVG DOM，避免跨端同步误判和点击后空画布。

- **2026-08-16**: 🎛️ **Agent 完成操作卡片单行布局修复** — 隐藏 details 原生三角标，汇总图标、标题和完成状态改为同一 flex 行，避免图标与文字纵向错位。

- **2026-08-16**: 🔄 **多端会话同步与断线回放升级** — SSE 增加用户级有界事件游标回放与重连快照兜底；聊天同步改为单会话服务器权威快照，先持久化再广播，修复跨聊天流式状态误阻塞、消息顺序错乱和刷新后同步丢失。

- **2026-08-16**: 🧭 **无头浏览器鉴权转发修复** — PHP engine bridge 已将已验证用户绑定传给所有 browser_* 引擎端点，修复 FastAPI 内部 bridge 因缺少 user_id 返回 `authenticated user required`；Playwright Chromium 导航、正文、DOM 快照和截图 smoke test 全部通过。

- **2026-08-16**: 🧹 **预期 400 回退日志降噪** — ResumeStream 的上游安全过滤/未接受请求属于有意 HTTP 直连回退，不再用 console.warn 制造“报错”观感；真正异常仍保留错误路径。

- **2026-08-16**: 🧯 **ResumeStream 代理多行 JSON 与自描述工具接线修复** — 兼容中继将错误 JSON 拆成多行导致的孤立 `{`/`}` 解析告警，规范化 ResumeStream 对象错误；接通 `project_self_describe` 前端执行路由，并补充自描述/可恢复任务回归测试。

- **2026-08-16**: 🧠 **项目自描述、按需上下文与刷新续接加固** — 新增 agent_context 自描述文件和 project_self_describe 工具；流/任务快照区分 recoverable 与真正失败，注册持久化失败不再错误 ACK，多任务恢复按 chat/msg 隔离；统一文件工具路径 containment，并兼容代理多行 JSON。

- **2026-08-09**: 🎨 **画布功能全面修复 (参考图/变体/信息面板/移动端)** — 根因:①`_useAsReference`只存URL到全局变量,sendMessage从不读取→参考图从未附加;②`_regenerateImage`调用`generateImage`(文生图)而非`generateImageI2I`(图生图);③信息面板CSS有定义但JS未实现;④移动端4按钮溢出/浮层未适配触摸;修复:_useAsReference下载图片→base64→pendingFiles附加(与手动上传同等待遇),_regenerateImage改用generateImageI2I传参考图URL+指令,新增右侧信息面板(提示词/模型/比例/时间/可编辑备注+保存),移动端单列布局+触摸滑动切换+面板折叠按钮+全宽浮层,canvas CSS 28个新类; rendering.js + style.css + index.html `?v=` bump
- **2026-08-09**: 🏷️ **生图文件名人类可读化 (prompt → 文件名)** — 根因: `upload.php` 仅用 `sha256(imageData)` 前 12 字符命名 (`img_69ddab8a79c55.png`),模型无法引用自己生成的图片; 修复: 新增 `sanitizeFilenameHint()` 从 prompt 提取安全文件名片段,`upload.php` 接受 `name` 字段生成 `img_<prompt片段>_<hash>.ext` (如 `img_一只猫坐在月亮上_a1b2c3d4e5f6.png`); `upload.js` 的 `uploadImageToServer` 新增 `options.name` 参数; 全部 8 处生图上传调用点 (tools-exec/image-gen/main/stream-handler/files) 传入 prompt; index.html `?v=` bump
- **2026-08-10**: 🛡️ **learning_records.db 只读复发永久修复 (三重防护)** — 根因: git 重建文件后权重置为 naujtrats:naujtrats 644 → www-data 只读; 修复: ①chown www-data:www-data + chmod 664 ②systemd path unit (`chaoxing-db-perms.path`) 监控文件变化自动修复 ③root cron 每 2 分钟兜底 ④git hooks post-checkout/merge/rewrite 操作后自动修复
- **2026-08-10**: 🐛 **刷课 AI 答题全链路修复 (ai_sync key/model 错位 + 模型列表刷新失效 + 默认模型下线)** — 根因: ①`baseUrlProvider=longcat` 残留旧值而 `baseUrl=https://api.deepseek.com` 已改 DeepSeek, `ai_sync` 按 provider 选 `apiKeyLongCat`(过期) 而非 `apiKeyDeepseek`(有效) → 认证失败; ②DB 中 `model=LongCat-2.0` 但 DeepSeek 端点只接受 `deepseek-v4-flash/pro` → 404; ③代码 3 处 fallback 硬编码已失效的 `deepseek-chat`; 修复: ①`ai_sync` 改按 baseUrl 域名反推实际提供商选 key + 模型-提供商匹配校验(不匹配自动选默认); ②`chaoxing.html` 新增 `_defaultModelsForProvider` 按提供商智能 fallback(刷新失败不再只显示一个失效模型); ③`answer.py` 默认模型改按 baseUrl 智能选择; ④`base.py` `random_answer` 防空崩溃; ⑤手动修复 `/tmp/AutomaticCB/config_u_a418898cebde5e2b1e15d181.ini` 的 model+key
- **2026-08-08**: 🐛 **agent_list 429 限流崩溃修复 (统一防护 + nginx 扩容)** — 根因: agent.js 5 处调用 `agent_list` 仅 1 处有 429+content-type 校验,其余 4 处直接 `.json()` 遇 nginx 429 HTML 即崩溃; 多调用方无最小间隔保护 burst 打满; 修复: 新增 `_fetchAgentListJSON()` 公共获取器统一处理 429 退避+content-type+客户端去重(最小 3s 间隔),全部 5 处调用点改用该函数,nginx burst 20→40; index.html `?v=` bump
- **2026-08-10**: 🛡️ **聊天数据丢失五连环根因修复 (超时/合并/墓碑/beacon/重试)** — 根因链:①服务器`all.json`达6.1MB→前端GET超时(10s)→合并跳过→本地不完整数据保留;②`saveChatsToServer`合并逻辑只补缺聊天不比较消息数→本地0消息覆盖服务器195消息(永久丢失);③`beaconSaveChats`超60KB时发送ultraSlim(仅6条消息)→截断服务器完整数据;④服务器端合并保护只比聊天数不比消息数→不防消息截断;⑤"跨域名同步"逻辑服务器缺聊即删本地→服务器数据不完整时误删真实聊天;修复:①前端GET超时10s→30s;②前端合并比较消息数保留更长版本;③新增轻量`meta=1`端点(仅id/时间/消息数)用于合并检查避免传6MB;④服务器端新增消息数比较保护;⑤跨域名同步改为仅删服务器墓碑标记的聊天;⑥移除saveChatsToServer危险重试(10条×4消息);storage.js+chat.php+index.html `?v=` bump
- **2026-08-08**: 🐛 **LongCat 推理面板不显示修复 (thinking 参数格式错误)** — 根因: `getThinkingIntensityParams` 中 `isClaude = isAnthropicFormat && n.indexOf('claude')===0`, LongCat 在 Anthropic 格式下模型名以 `longcat` 开头不是 `claude`, 导致走到 OpenAI/DeepSeek 分支返回 `{reasoning_effort:'medium'}`, 但 LongCat Anthropic 端点只接受 `thinking:{type:'enabled'}`, thinking 从未开启, API 自然不返回 reasoning_content; 修复: 将 `isLongCat` 判断移到 `isClaude` 之前, 无论何种格式都返回 `{thinking:{type:'enabled'}}`; 同时修复 retry 路径 (RS/HTTP) 不再丢弃已有 reasoning; models.js + main.js + index.html `?v=` bump
- **2026-08-09**: 🛡️ **analyze_image 生成图 404 根因修复 (fire-and-forget + 全链路重试)** — 根因: ①`generate_image` 的 `uploadImageToServer` 是 fire-and-forget(.then不await), 模型紧接调 `analyze_image` 时 URL 仍是外部地址; ②外部 URL 走 `image_proxy.php` 必然 404(不在本地 uploads/); ③下载/API无重试; 修复: ①generate_image/i2i 上传改为同步 await + 3次重试(1.5s/3s退避); ②`uploadImageToServer` 下载外部URL加3次重试(400/401/403/404立即放弃); ③analyze_image 判断 `_isLocalImage` 跳过外部URL的无效proxy尝试; ④新增 `_retryWithBackoff()` 指数退避辅助函数; ⑤图片下载+视觉API+MiniMax回退全加重试; 2文件+index.html `?v=` bump
- **2026-08-09**: 🐛 **analyze_image 图片池不包含 AI 生成图根因修复** — 根因: 图片收集逻辑两段式: ①`if(currentFiles.length<2)` 只收集 `_msgsAll2[_hi].role==='user'` 的 files, 不看 generatedImages; ②`if(!currentFiles.length)` 才收集 assistant 的 generatedImages; 后果: 只要有用户上传图(currentFiles≥1), 第二段永远不执行, AI 生成图永远不进图片池; 修复: 合并为单次遍历, 同时收集用户上传图(_allHistoricalImages)和 AI 生成图(_allGeneratedImages), 正序拼接; index.html `?v=` bump
- **2026-08-09**: 🔧 **Server 工具写 uploads/ 权限修复 + 大文件云盘异步同步 + git hook 防复发** — 根因: `uploads/` 目录权限 `drwxr-sr-x` (组 r-x 无 write), 引擎以 naujtrats 通过 www-data 组访问, OS 层拒绝写入; 修复: `chmod g+rwxs` (setgid+组读写) 及其所有子目录; 同步机制: netdisk_api.php `download_file` 新增 >5GB 大文件异步同步路径 (PHP 立即返回 + Python 后台 `cloudreve_bg_upload.py` 分片上传); git hook (post-checkout/merge/rewrite) 用 sudo 自动修复权限防 git 重建后复发; 3文件+新脚本+hook
- **2026-08-09**: ⚡ **analyze_image 默认不再走 MiniMax MCP — 自动检测直连 API** — 根因: 默认 `visionProvider='minimax'` 导致未充值用户无法分析图片; 修复: ①`config.js` 默认 `visionProvider` 改空字符串; ②`tools-exec.js` analyze_image handler 新增自动检测逻辑: 当 provider 为空/minimax 时, 从服务器 `get_config` 拉取已配置的 xAI/OpenAI/自定义 key, 优先走直连 API (grok-4.5/gpt-4o), 仅当三者均未配置时才回退 MiniMax MCP; 2文件+index.html `?v=` bump
- **2026-08-09**: 🖼️ **analyze_image 三大修复 (生成图分析/iPhone 404/并行分析)** — ①根因: `generatedImages` 存对象 `{url,model,...}` 但 `.map(url => ...)` 把对象当字符串→`content:[object Object]`; 同批次并行 generate_image→analyze_image 时序竞态; 修复: 提取 `.url` 兼容新旧格式 + 轮询等待并行 generate_image 完成(≤120s) + 检查 `pendingMsg.generatedImages`; ②iPhone HEIC 404 根因: `upload.php` `$validMimes` 缺 `image/heic|heif` + `image_proxy.php` `$allowed` 缺扩展名; 修复: 双端加白名单 + upload.php 服务端 Imagick/GD HEIC→JPEG 转换(含 EXIF 方向校正) + files.js 前端 HEIC 检测提示; ③并行分析: 新增 `image_indexes:[0,1,2]` 参数 + 重构 handler 提取 `_analyzeOneImage()` 函数 + `Promise.all` 并行调用; 5文件+PHP, index.html `?v=` bump
- **2026-08-08**: 🎨 **引擎状态面板 UI 全面重构 (设计系统一致性)** — 原面板全内联样式+Tailwind工具类混用(按钮`px-3 py-1.5`、图标`label-icon`、边框`dark:border-gray-700`类失效); 重构: 新增`.engine-status-panel`(圆角卡片+双主题背景边框) / `.engine-status-header`(标题行+刷新按钮右对齐) / `.engine-refresh-btn`(独立按钮样式+loading旋转动画) / `.engine-health-card`(健康状态卡片) / `.engine-section-label`(带图标分区标签) / `.engine-empty-hint` / `.engine-cron-delete`; JS 刷新时按钮加 loading 类(spinner动画) + finally 移除; 健康文本去 emoji 改用圆点色标; 3文件+CSS, index.html `?v=` bump
- **2026-08-08**: 🐛 **刷新后接续气泡三点残留修复 (resume typing 类泄漏)** — 根因: resume 路径创建气泡时添加 `typing` 类但首个内容块到达时未移除(正常路径 main.js:2749 有移除); `cleanupStreamState()` 的 `if(!st) return;` 早退守卫导致 JSON 快径未创建 `_streamState` 时 `typing` 永不清除; 修复: `applyStreamRender()` 首次创建 state 时立即移除 `typing` + `cleanupStreamState()` 早退时仍检查 `activeBubbleMap` 清理; index.html `?v=` bump
- **2026-08-08**: 🚪 **关闭Agent模式时计划面板带入普通会话修复** — 根因: `#flowPanel` 位于输入区(`.input-clip`)而非消息区(`#chatBox`), `loadChat` 重绘消息不影响它, 必须主动 dismiss; 原逻辑仅在 `prevMode==='plan'` 时 dismiss(plan→off), 但 `createFlowPanel` 在 agent/yolo/plan 任一模式下都可被 `plan_update(action="create")` 触发, 导致 agent→off / yolo→off 时面板残留普通会话; 修复: 拆分为 plan 状态重置(保持仅 plan→off) + 面板 dismiss(统一 `mode==='off' && !tempAgentGranted` 时触发); agent.js + index.html `?v=` bump
- **2026-08-08**: 🔔 **子代理运行状态条 (Agent模式下子代理运行中实时可见)** — 此前Agent模式创建子代理后用户看不到运行进度(流程面板仅Plan模式显示,侧栏自动收起); 新增 `#subAgentStatusBar` 状态条: 旋转spinner+「子代理运行中」+实时工具/步骤+完成计数; 接线: addAgentToTask→显示 / pushAgentResultToTask→更新 / agent:step→实时工具步骤 / _checkTaskCompletion全部完成→「子代理已完成」2s后消失; 3文件+CSS, index.html `?v=` bump
- **2026-08-08**: 🧠 **LongCat/Anthropic 推理面板不可见修复 (三 bug 叠加 + OpenAI 路径统一)** — 根因: ①Anthropic 路径 `_parseAnthropicResponse` 的 `thinking_delta` 只存 `pendingMsg.reasoning` 不实时渲染; ②流结束后不补渲染; ③自动重试逻辑 `_retryLongCatWithoutThinking`/RS 路径主动删除推理面板+清空内容; 修复: stream-handler.js 新增 `window._ensureReasoningPanel` 公共辅助函数,统一 OpenAI 路径两处内联创建; main.js Anthropic 路径 `thinking_delta` 加实时渲染+流结束后补渲染; 三处自动重试逻辑(LongCat/RS/工具降级)停止清除推理; index.html `?v=` bump

- **更早变更 (2026-06 ~ 2026-08-05)** → 全部 147 条记录详见 `docs/CHANGELOG.md`

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
├── config/           # 服务与模型配置文件
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
| `api/engine_api.php` | ★ 引擎代理（Agent/工作流/SSE 广播/浏览器/文件） |
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
