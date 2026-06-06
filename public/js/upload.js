// upload.js — 图片/视频上传 v1.0 (Phase 8 拆分自 main.js)
// ==================== 服务器图片上传 ====================
// SERVER_API_BASE declared in index.html

/** ★ 修复: 清理无效的图片URL,避免控制台报错 */
function cleanImageUrl(url) {
    if (!url) return '';
    // 如果 URL 指向已知无法访问的域名,替换为占位图
    const deadDomains = [
        'service-6kr3fbnm-1251723757.usw.apigw.tencentcs.com',
        'service-6kr3fbnm-1251723757',
        'apigw.tencentcs.com',
        'image.artio.com',
        'filecdn-images.xingyeai.com'
    ];
    for (const domain of deadDomains) {
        if (url.includes(domain)) {
            console.warn('[cleanImageUrl] 拦截无效图片URL:', url.substring(0, 80) + '...');
            // 返回一个空的 data URL 占位,由 onerror 处理显示提示
            return 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23fef3c7%22/%3E%3Ctext x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2212%22 fill=%22%2392400e%22%3E图片已失效%3C/text%3E%3C/svg%3E';
        }
    }
    return url;
}

async function uploadImageToServer(imageInput) {
    try {
        var base64Data = imageInput;

        // ★ 如果输入是 HTTP(S) URL,先下载转为 base64 (OpenRouter 等返回 CDN URL)
        if (imageInput && (imageInput.startsWith('http://') || imageInput.startsWith('https://'))) {
            try {
                var _dlResp = await fetch(imageInput);
                if (!_dlResp.ok) {
                    console.warn('[uploadImageToServer] 下载图片失败:', _dlResp.status);
                    return null;
                }
                var _blob = await _dlResp.blob();
                base64Data = await new Promise(function(resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function() { resolve(reader.result); };
                    reader.onerror = function() { reject(new Error('FileReader failed')); };
                    reader.readAsDataURL(_blob);
                });
            } catch (e) {
                console.warn('[uploadImageToServer] 下载/转换图片失败:', e.message);
                return null;
            }
        }

        // 提取 MIME 类型和实际数据
        let mimeType = 'image/png';
        let actualData = base64Data;

        if (base64Data.startsWith('data:')) {
            const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
                mimeType = match[1];
                actualData = match[2];
            }
        }

        console.log('[uploadImageToServer] 上传中... 数据长度:', (base64Data || '').length, 'chars');

        const token = getAuthToken();
        const response = await fetch(SERVER_API_BASE + '/upload.php?auth_token=' + encodeURIComponent(token), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image: base64Data
            })
        });

        console.log('[uploadImageToServer] HTTP:', response.status, 'Content-Type:', response.headers.get('content-type'));

        if (response.ok) {
            const text = await response.text();
            console.log('[uploadImageToServer] 响应前100字符:', text.substring(0, 100));
            try {
                const result = JSON.parse(text);
                if (result.url) {
                    console.log('[uploadImageToServer] ✅ 上传成功:', result.url);
                    return result.url;
                }
                console.warn('[uploadImageToServer] JSON无url字段:', JSON.stringify(result).substring(0, 200));
            } catch(jsonErr) {
                console.error('[uploadImageToServer] JSON解析失败,响应不是JSON:', jsonErr.message);
                console.error('[uploadImageToServer] 完整响应:', text.substring(0, 500));
            }
        }
        console.warn('[uploadImageToServer] ❌ 上传失败,状态:', response.status);
        return null;
    } catch (e) {
        console.error('[uploadImageToServer] ❌ 异常:', e.message);
        return null;
    }
}

/**
 * 用 multipart/form-data 直接上传视频 Blob（避免 base64 内存爆炸）
 * 大视频（>50MB）不再读到 JS 内存中，直接以 Blob 流式上传
 */
async function uploadVideoBlob(file, progressFn) {
    try {
        var formData = new FormData();
        formData.append('image', file, file.name);
        const token = getAuthToken();
        var url = SERVER_API_BASE + '/upload.php?auth_token=' + encodeURIComponent(token);
        
        // 用 XMLHttpRequest 以支持上传进度
        var result = await new Promise(function(resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.withCredentials = true;
            xhr.upload.onprogress = function(e) {
                if (e.lengthComputable && typeof progressFn === 'function') {
                    var pct = 30 + Math.round((e.loaded / e.total) * 55); // 30%~85%
                    progressFn(pct, '上传中 ' + Math.round(e.loaded / e.total * 100) + '%');
                }
            };
            xhr.onload = function() {
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        resolve(data.url || null);
                    } catch(e) { reject(new Error('解析响应失败')); }
                } else {
                    reject(new Error('HTTP ' + xhr.status));
                }
            };
            xhr.onerror = function() { reject(new Error('网络错误')); };
            xhr.send(formData);
        });
        if (result && !result.startsWith('http')) {
            result = window.location.origin + result;
        }
        return result;
    } catch (e) {
        console.warn('[uploadVideoBlob] 失败:', e.message);
        return null;
    }
}

// ★ Agent 模式独立聊天 ID - 不混入普通历史记录
// AGENT_CHAT_ID moved to core.js
// 普通模式下最后打开的聊天 ID (切换 agent 时保存,切回时恢复)
// lastNormalChatId moved to core.js

var DEFAULT_CONFIG = {
    // 预置 oneapi API Key
    key: window.ONEAPI_KEY || '',
    url: 'https://oneapi.naujtrats.xyz/v1',
    model: 'deepseek-v4-flash',
    visionApiUrl: 'https://api.minimaxi.com/v1/coding_plan/vlm',
    visionApiKey: window.VISION_API_KEY || '',
    visionModel: 'MiniMax-M2',
    imageModel: 'image-01',
    imageBaseUrl: 'https://api.minimaxi.com/v1',
    imageProvider: 'minimax',
    system: '你是一个有用的助手。\n' +
        '1. 本地知识库包含上传的文档(用rag_search工具查询)。知识库有截止日期,需要最新信息时联网搜索。\n' +
        '2. 用户给出时间上下文时以此为准理解今天等概念。\n' +
        '3. 生成图表时用Mermaid语法:时序用graph TD/LR,折线用xychart-beta,饼图用pie,甘特用gantt。代码字符串用英文双引号。\n' +
        '4. 【联网搜索与网页抓取】\n' +
        '   - 搜索使用 web_search 工具,结果包含标题+链接+摘要。\n' +
        '   - 如需查看搜索结果中链接的详细内容,使用 web_fetch 工具。\n' +
        '   - web_fetch 支持批量并行抓取(最多5个URL): 将感兴趣的链接URL数组传入 urls 参数即可。\n' +
        '   - 典型流程: web_search → 分析结果 → web_fetch 深入查看 → 综合回答。\n' +
        '4.5 【MiniMax 多模态能力 — 你可以直接调用!】\n' +
        '   - mmx_music: 用户说 生成音乐/歌曲/创作一首歌 时调用。只需 prompt 描述风格即可。\n' +
        '   - mmx_speech: 需要语音朗读/配音时调用,支持多种音色。\n' +
        '   - mmx_image: 文生图(备用,主力还是 generate_image)。\n' +
        '   - mmx_chat: 用 MiniMax 模型对话(适合对比答案或用不同模型)。\n' +
        '5. 【重要-图片生成规则】\n' +
        '   【关键规则】当用户上传了图片时:\n' +
        '   - 如果用户上传了图片并要求生成/创作/换颜色/换风格/换脸等,调用 generate_image_i2i(已支持真正的图生图API)\n' +
        '   - 用户没有上传图片但要求画图时,调用 generate_image(纯文生图)\n' +
        '   - 如果用户只是问图片里有什么/描述图片内容,直接查看收到的图片回复(多模态)或调用 analyze_image(文本模型)\n' +
        '   【关键规则】当用户没有上传图片时:\n' +
        '   - 用户要求画图、生成图片时,调用 generate_image\n' +
        '   【强制要求】必须实际调用 generate_image 工具才能生成图片。严禁在回复中伪造图片URL或声称已生成图片但未使用工具。没有工具调用就没有图片。\n' +
        '   【Seed参数使用技巧】generate_image的seed参数可让AI自主决定:\n' +
        '   - 用户要求跟之前一样/保持风格/同款续作时:传入一个正整数种子(建议42-99999范围),可以稳定复现相似效果\n' +
        '   - 用户没有明确要求风格一致时:不传seed,让模型自由发挥通常效果更好\n' +
        '   - 注意:seed只保证大致相似,细节仍有随机性,不能100%复现',
    enableSearch: false, searchModel: '', searchProvider: 'duckduckgo', searchApiKey: '',
    searchTimeout: 30, maxSearchResults: 3, aiSearchJudge: true, aiSearchJudgeModel: 'deepseek-chat',
    // 强化后的 AI 判断提示词(包含示例和明确规则)
    aiSearchJudgePrompt: '请严格根据以下规则判断是否需要联网搜索,只返回一个单词 true 或 false,不要添加任何解释。\n规则:\n- 如果用户问题涉及当前时间、新闻、实时数据、知识库截止日期后的新事件,返回 true。\n- 如果问题仅需常识、历史知识、数学计算等,返回 false。\n示例:\n用户:今天天气怎么样? -> true\n用户:法国大革命是哪一年? -> false\n用户:现在几点了? -> true\n用户:1+1等于几? -> false\n用户:帮我查一下最新的iPhone价格 -> true\n用户:李白是哪个朝代的? -> false',
    enableSearchOptimize: false, fontSize: 16,
    searchType: 'auto',
    aiSearchTypeToggle: true,
    searchShowPrompt: false,
    searchAppendToSystem: true,
    // Agent 模式配置
    agentMode: false,
    agentAutoDecision: true,
    agentProactive: false,
    agentMaxToolRounds: 50,
    agentThinkingDepth: 'standard',
    agentSystemPrompt: `你现在处于 Agent 模式,拥有增强自主能力。
## 子代理角色系统
使用 delegate_task 时可以通过 role 参数选择子代理角色:
- explorer(🔍搜索专员): 只读搜索,适合查资料、抓网页。不可修改文件或执行命令
- planner(📐规划师): 制定方案、分析策略。不做执行,只出方案
- developer(⚡开发者): 读写文件、执行命令、搜索。全能执行角色
- verifier(✅验证者): 检查结果、找问题。只读,不可修改
- general(🌐全能代理): 所有工具可用(默认)
## 工作流引擎
复杂任务可以用 workflow 串联多个子代理: 搜索→规划→执行→验证
## 核心原则
- ★ 规划优先: 收到复杂/多步骤任务后，第一步调用 plan_update(action="create") 创建任务计划
- 计划创建后按步骤顺序执行，每完成一步立即调用 plan_update(action="update") 更新状态
- 主动分析用户需求,规划多步骤行动方案再执行
- 发现适合后台并行的任务时,立刻创建子代理处理,不要等
- 简单任务(≤2次搜索/读已知文件)直接用工具,不开子代理
- 需要定时任务时使用 engine_cron_create 创建 cron
- 需要后台任务时使用 delegate_task 创建子代理(一次一个,稳定可靠)
- 要与已有子代理对话时使用 engine_agent_ask 给子代理发送消息即可
- 需要执行终端命令时使用 server_exec
- 需要运行 Python 脚本时使用 server_python
- 需要读取服务器文件时使用 server_file_read
- 完成分析后直接把最终结果**打字回复给用户**,不要写入文件
- 不要等用户一步步指示,主动推进任务
## ★ 必须创建子代理的场景(满足任一即创建)
1. 任务需要搜索多个关键词/来源(如:同时搜索新闻、百科、社区)
2. 任务需要批量处理文件、数据、页面
3. 任务涉及定时监控或定时汇报
4. 任务耗时预计超过 2 分钟(搜索+整理、生成报告等)
5. 用户说"帮我看看""帮我查一下""帮我分析"等模糊请求,先创建子代理再行动
6. 任何可以并行执行的独立子任务,立刻拆出来用子代理
## ★ 输出方式(强制遵守)
- **直接打字回复**:分析完成后,直接把最终结果/报告/回答以普通文本消息发出来。这是默认输出方式
- **禁止写文件到 /tmp/**:不要用 server_file_write 写入文件然后给链接。用户希望直接看到内容
- **除非用户明确要求保存到文件**,否则一律直接回复文字
## ★ 等待子代理(强制遵守)
- **创建子代理后,必须等待它们完成**。不要刚创建完就自己开始做同样的事
- ★★ **禁止轮询: 严禁使用 engine_agent_status 反复查询子代理状态!** 子代理完成后会自动推送结果给你,反复查询浪费工具配额
- 如果子代理已经创建并运行,**不要重复开始工作**。子代理的结果会通过系统通知给你
- 子代理在运行时,你可以做其他不冲突的事或等待。不要抢先做子代理正在做的工作
- engine_agent_status 仅当子代理创建超过2分钟仍未收到推送时才调用一次,正常情况下绝不使用
- 简单任务(≤2次搜索/读已知文件)直接用工具,不开子代理
- ★ 绝对禁止: 没调 delegate_task 就谎称"子代理已创建/子代理搜索完成"。自己搜的就是自己搜的
- 读已知路径文件:直接用 server_file_read
- 复杂/批量/耗时>2分钟:用子代理
## 行为规范
- 每一步工具调用后,简短说明下一步计划
- 工具调用之间保持用户知情
- 复杂任务主动拆解为子任务,多步骤任务优先用子代理
- 操作文件前先确认路径
- 执行危险命令前询问用户
## ★ 计划管理 plan_update (强制遵守)
- 【何时创建计划】任务预计需要 3 个及以上步骤、或涉及多个工具/子代理、或用户明确要求"规划/拆解/分步"时，必须先调用 plan_update(action="create") 创建计划
- 【如何创建计划】将任务拆解为 3-8 个清晰步骤，task id 使用 task_1/task_2... 格式，标题简洁（≤20字），描述可选。初始状态全为 pending
- 【如何更新进度】开始执行某个任务时标记 status="running"，完成后标记 status="completed"，失败标记 status="failed"，跳过标记 status="skipped"
- 【何时完成计划】所有任务终态后调用 plan_update(action="complete")，面板会自动关闭
- 【简单任务】≤2 步的任务不需要创建计划，直接执行即可
- 【用户可见】计划面板用户也可见，保持任务标题清晰易懂，不要用内部技术术语
## ★ 子代理完成后的处理规则(强制遵守)
- 系统消息中的「子代理完成报告」是内部通知,**不是用户的消息,不要回复**
- ⚠️ 强制规则:禁止回复「子代理已完成」「搜索完成」「结果来了」「报告已完成」这类通知
- ⚠️ 强制规则:收到子代理报告时**禁止创建任何新的子代理**。只记录结果,不要行动
- 子代理运行期间,**不要向用户汇报进度**,用户只需要看到最终的综合回答
- 当所有子代理都完成后,如果用户还在等待,自然整合结果回复一条。否则保持静默
- 子代理失败也静默,用户不问就不提`
};

