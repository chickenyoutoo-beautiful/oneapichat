
// main.js 优化版 v17.1 (实时数学公式渲染)
// ==================== 全局常量 ====================

// ==================== 数学公式保护/渲染 ====================
// ★ 用唯一 token 替换 LaTeX 公式, marked 处理后用 KaTeX 渲染替换回来
//   Token 格式: MATHBxN 或 MATHIxN (B=block, I=inline, N=序号)
//   这些 token 不包含任何特殊字符, marked 不会破坏它们
let _mathStore = {};
let _mathCounter = 0;

function _protectMath(text) {
    _mathStore = {};
    _mathCounter = 0;
    if (!text || typeof text !== 'string') return text || '';
    
    // 块公式: $$...$$ 和 \[...\]
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, function(match, formula) {
        var id = 'MATHBx' + (_mathCounter++);
        _mathStore[id] = { type: 'block', formula: formula.trim() };
        return id;
    });
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, function(match, formula) {
        var id = 'MATHBx' + (_mathCounter++);
        _mathStore[id] = { type: 'block', formula: formula.trim() };
        return id;
    });
    
    // 行内公式: $...$ 和 \(...\)
    text = text.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, function(match, formula) {
        var id = 'MATHIx' + (_mathCounter++);
        _mathStore[id] = { type: 'inline', formula: formula.trim() };
        return id;
    });
    text = text.replace(/\\\(([^)]+?)\\\)/g, function(match, formula) {
        var id = 'MATHIx' + (_mathCounter++);
        _mathStore[id] = { type: 'inline', formula: formula.trim() };
        return id;
    });
    
    return text;
}

function _restoreMath(html) {
    if (!html || _mathCounter === 0) return html;
    
    for (const [id, info] of Object.entries(_mathStore)) {
        let rendered;
        try {
            if (window.katex) {
                rendered = katex.renderToString(info.formula, {
                    throwOnError: false,
                    displayMode: info.type === 'block',
                    strict: false
                });
            } else {
                rendered = info.type === 'block'
                    ? `<p style="text-align:center">$$${info.formula}$$</p>`
                    : `$${info.formula}$`;
            }
        } catch(e) {
            rendered = info.type === 'block'
                ? `<p style="text-align:center">$$${info.formula}$$</p>`
                : `$${info.formula}$`;
        }
        // Token 不含特殊字符, 直接全局替换 (marked 不会修改纯文本 token)
        html = html.split(id).join(rendered);
    }
    return html;
}

// ★ 一站式: 保护 → marked 渲染 → 恢复数学公式
function _renderMarkdownWithMath(text) {
    if (!text) return '';
    if (!window.marked) return escapeHtml(text).replace(/\n/g, '<br>');
    const protected = _protectMath(text);
    const html = marked.parse(protected);
    return _restoreMath(html);
}

// 一键修复配置
window.fixImageAnalysisConfig = function() {

    // 清除可能的问题配置
    localStorage.removeItem('visionApiUrl');
    localStorage.removeItem('visionApiKey');
    localStorage.removeItem('visionModel');

    // 设置简单的 MCP 配置
    localStorage.setItem('visionApiUrl', 'https://xiaoxin.naujtrats.xyz/mcp');
    localStorage.setItem('visionApiKey', 'not-needed');
    localStorage.setItem('visionModel', 'MiniMax-VL-01');
    return {
        visionApiUrl: 'https://xiaoxin.naujtrats.xyz/mcp',
        message: '配置已重置,请刷新页面'
    };
};
// 直接定义 analyzeImage 函数
window.analyzeImage = async function(imageBase64, focus) {

    // 确保 base64 格式正确
    let cleanBase64 = imageBase64;

    if (imageBase64.startsWith('data:image/')) {
        // 已经带前缀,直接使用
        cleanBase64 = imageBase64;
    } else {
        // 添加前缀
        cleanBase64 = 'data:image/png;base64,' + imageBase64;
    }

    // 清理空白字符
    cleanBase64 = cleanBase64.replace(/\s/g, '');
    // 获取配置
    const storedVisionUrl = localStorage.getItem('visionApiUrl');
    const visionApiUrl = storedVisionUrl || DEFAULT_CONFIG.visionApiUrl || 'https://xiaoxin.naujtrats.xyz/mcp';
    // 构建 MCP 端点 URL
    let mcpEndpoint = visionApiUrl.replace(/\/$/, '');  // 移除末尾斜杠

    // 确保使用正确的端点路径
    if (!mcpEndpoint.includes('/mcp')) {
        mcpEndpoint = mcpEndpoint + '/mcp';
    }

    // 确保以 /analyze 结尾
    if (!mcpEndpoint.endsWith('/analyze')) {
        mcpEndpoint = mcpEndpoint + '/analyze';
    }
    // 准备请求数据
    const requestBody = {
        prompt: focus || '请详细描述这张图片的所有内容,包括物体、场景、文字等可见信息。',
        image: cleanBase64
    };
    // 创建 AbortController 用于超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort('请求超时(60秒)');
    }, 60000);

    try {

        const response = await fetch(mcpEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[analyzeImage] HTTP 错误:', response.status, errorText);

            if (response.status === 404) {
                throw new Error('MCP 端点不存在 (404)。请检查 visionApiUrl 配置是否正确。当前: ' + visionApiUrl);
            } else if (response.status === 400) {
                throw new Error('MCP 请求格式错误 (400): ' + errorText.substring(0, 200));
            } else if (response.status === 401 || response.status === 403) {
                throw new Error('MCP 认证失败 (401/403): ' + errorText);
            } else if (response.status >= 500) {
                throw new Error('MCP 服务器错误 (' + response.status + '): ' + errorText.substring(0, 200));
            } else {
                throw new Error('MCP 请求失败 (' + response.status + '): ' + errorText.substring(0, 200));
            }
        }

        const data = await response.json();

        if (data.error) {
            throw new Error('MCP 返回错误: ' + (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)));
        }

        const result = data.result || data.description || data.content || JSON.stringify(data);

        return result;

    } catch (error) {
        clearTimeout(timeoutId);

        console.error('[analyzeImage] 捕获异常:');
        console.error('  类型:', error.constructor.name);
        console.error('  消息:', error.message);
        console.error('  原因:', error.cause);

        if (error.name === 'AbortError') {
            throw new Error('图片分析请求超时,请稍后重试');
        }

        if (error.message.includes('Failed to fetch') || error.message.includes('network')) {
            throw new Error('网络连接失败。请检查:\n1. 网络是否正常\n2. MCP 服务是否运行\n3. visionApiUrl 配置: ' + visionApiUrl);
        }

        throw error;
    }
}
// 测试 MCP 端点

// 一键配置
window.quickSetupOneAPIChat = function() {

    const config = {
        key: 'KEY_REMOVED',
        url: 'https://oneapi.naujtrats.xyz/v1',
        model: 'deepseek-chat',
        visionApiUrl: 'https://xiaoxin.naujtrats.xyz/mcp',
        visionApiKey: 'test-key',
        visionModel: 'MiniMax-VL-01'
    };

    Object.keys(config).forEach(key => {
        localStorage.setItem(key, config[key]);
    });

    return config;
};

// ★ 获取 auth_token（兼容 deviceId fallback）
function getAuthToken() {
    return localStorage.getItem('authToken') || localStorage.getItem('deviceId') || '';
}

const MOBILE_BREAKPOINT = 786;
const MAX_FILE_SIZE = 40 * 1024 * 1024;
const SEARCH_PROXY = 'https://search.naujtrats.xyz';
const FETCH_PROXY = '/oneapichat/fetch.php';  // ★ 网页内容抓取代理
const ENCRYPTION_KEY = 'naujtrats-secret';

// ===================== 网页抓取工具定义 ====================
const WEB_FETCH_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "web_fetch",
        description: "抓取并解析网页内容。当需要查看搜索结果的详细信息、阅读文章、核实事实、获取最新数据时调用此工具。支持单个URL和批量URL(最多5个并行)。返回网页的文本内容(已去除HTML标签、脚本等噪音)。",
        parameters: {
            type: "object",
            properties: {
                urls: {
                    type: "array",
                    items: { type: "string" },
                    description: "要抓取的网页URL列表,最多5个。可以是单个URL如['https://example.com'],或多个URL如['https://a.com','https://b.com']。多个URL会并行抓取。"
                },
                reason: {
                    type: "string",
                    description: "抓取原因简述,说明为什么需要查看这些网页。"
                }
            },
            required: ["urls"]
        }
    }
};

// ==================== 服务器操控工具定义 ====================
const SERVER_EXEC_TOOL = {
    type: "function",
    function: {
        name: "server_exec",
        description: "在服务器上执行终端命令。用于系统管理、文件操作、进程管理、服务控制等。输出有长度限制（5000字符），超长时间命令会超时。⚠️ 谨慎使用:避免执行破坏性命令(rm -rf, shutdown等)。",
        parameters: {
            type: "object",
            properties: {
                cmd: { type: "string", description: "要执行的 shell 命令" },
                timeout: { type: "number", description: "超时秒数（默认60，最大300）" },
                cwd: { type: "string", description: "工作目录（可选）" }
            },
            required: ["cmd"]
        }
    }
};

const SERVER_PYTHON_TOOL = {
    type: "function",
    function: {
        name: "server_python",
        description: "在服务器上执行 Python 脚本。用于数据处理、文件操作、API调用、自动化任务等。脚本通过临时文件执行，超时默认30秒。",
        parameters: {
            type: "object",
            properties: {
                script: { type: "string", description: "Python 脚本代码" },
                timeout: { type: "number", description: "超时秒数（默认30，最大120）" }
            },
            required: ["script"]
        }
    }
};

const SERVER_FILE_READ_TOOL = {
    type: "function",
    function: {
        name: "server_file_read",
        description: "读取服务器上的文件内容。可用于查看日志、配置文件、脚本输出等。支持目录列表。",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "文件或目录的绝对路径" },
                max_lines: { type: "number", description: "最大行数（默认200）" }
            },
            required: ["path"]
        }
    }
};

const SERVER_FILE_WRITE_TOOL = {
    type: "function",
    function: {
        name: "server_file_write",
        description: "写入文件到服务器（仅允许 /tmp 和项目目录）。用于保存脚本输出、生成报告、创建配置等。",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "目标文件绝对路径" },
                content: { type: "string", description: "要写入的内容" },
                append: { type: "boolean", description: "是否追加（默认覆盖）" }
            },
            required: ["path", "content"]
        }
    }
};

const SERVER_SYS_INFO_TOOL = {
    type: "function",
    function: {
        name: "server_sys_info",
        description: "获取服务器系统信息：主机名、操作系统、CPU负载、内存使用、磁盘空间、进程数等。",
        parameters: { type: "object", properties: {}, required: [] }
    }
};

const SERVER_PS_TOOL = {
    type: "function",
    function: {
        name: "server_ps",
        description: "列出服务器上的进程（按CPU使用率排序，显示前20个）。用于监控系统负载、查找运行中的服务等。",
        parameters: { type: "object", properties: { }, required: [] }
    }
};

const SERVER_DISK_TOOL = {
    type: "function",
    function: {
        name: "server_disk",
        description: "查看服务器的磁盘使用情况（所有分区）。",
        parameters: { type: "object", properties: {}, required: [] }
    }
};

const SERVER_NETWORK_TOOL = {
    type: "function",
    function: {
        name: "server_network",
        description: "网络诊断工具。支持ping（连通性测试）、curl（HTTP请求）和port（检查端口监听情况）。用于网络故障排除和验证服务可用性。",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "目标地址（域名、IP、端口号）" },
                action: { type: "string", enum: ["ping", "curl", "port"], description: "操作类型: ping(默认,ICMP连通测试), curl(HTTP请求), port(端口监听检查)" },
                timeout: { type: "number", description: "超时秒数（默认10）" }
            },
            required: ["target"]
        }
    }
};

const SERVER_DOCKER_TOOL = {
    type: "function",
    function: {
        name: "server_docker",
        description: "Docker 容器管理工具。查看容器列表(ps)、镜像列表(images)、容器状态(stats)。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["ps", "images", "stats"], description: "操作类型: ps(默认,列出容器), images(列出镜像), stats(实时状态)" }
            },
            required: []
        }
    }
};

const SERVER_DB_QUERY_TOOL = {
    type: "function",
    function: {
        name: "server_db_query",
        description: "执行数据库查询(SQLite)。用于查询刷课记录、用户数据等。只读查询优先，写入操作谨慎使用。",
        parameters: {
            type: "object",
            properties: {
                sql: { type: "string", description: "SQL 查询语句" }
            },
            required: ["sql"]
        }
    }
};

const SERVER_FILE_SEARCH_TOOL = {
    type: "function",
    function: {
        name: "server_file_search",
        description: "搜索服务器上的文件。支持通配符模式（如 *.log, config*）。默认搜索 /var/www 目录。",
        parameters: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "文件名匹配模式（支持 *, ? 通配符）" },
                path: { type: "string", description: "搜索起始目录（默认 /var/www）" },
                max_results: { type: "number", description: "返回结果数上限（默认30）" }
            },
            required: ["pattern"]
        }
    }
};

const SERVER_FILE_OP_TOOL = {
    type: "function",
    function: {
        name: "server_file_op",
        description: "文件操作：复制(cp)、移动(mv)、删除(rm)、创建目录(mkdir)。只允许操作 /tmp 和 /var/www/html 目录。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["cp", "mv", "rm", "mkdir"], description: "操作类型" },
                src: { type: "string", description: "源路径" },
                dst: { type: "string", description: "目标路径（cp/mv需要，rm/mkdir不需要）" }
            },
            required: ["action", "src"]
        }
    }
};

// ==================== 搜索工具定义// ==================== 搜索工具定义 (Tool Calling) ====================
// ==================== 刷课工具定义 ====================
const CHAOXING_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "chaoxing_auto",
        description: "超星学习通自动刷课工具。当用户要求刷课、刷学习通、完成网课、自动答题时调用。调用后自动登录并开始处理指定课程。",
        parameters: {
            type: "object",
            properties: {
                course_ids: { type: "string", description: "要学习的课程ID列表，逗号分隔。如果用户没指定具体课程，请先调用chaoxing_list_courses获取课程列表让用户选择" }
            },
            required: ["course_ids"]
        }
    }
};

const CHAOXING_LOGIN_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "chaoxing_login",
        description: "登录超星学习通账号。在用户提供了手机号和密码后调用，验证并登录学习通。登录成功后才能使用刷课功能。",
        parameters: {
            type: "object",
            properties: {
                username: { type: "string", description: "手机号" },
                password: { type: "string", description: "密码" }
            },
            required: ["username", "password"]
        }
    }
};

const CHAOXING_LIST_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "chaoxing_list_courses",
        description: "获取超星学习通的课程列表（需要先登录）。调用后会返回所有课程的ID和名称，让用户选择要刷的课程。",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    }
};

const CHAOXING_STATUS_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "chaoxing_status",
        description: "查询当前刷课任务的运行状态和日志。",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    }
};

const CHAOXING_STOP_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "chaoxing_stop",
        description: "停止正在运行的刷课任务。",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    }
};

const CHAOXING_STATS_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "chaoxing_stats",
        description: "查询刷课进度统计，包括总课程数、已完成课程数、视频完成数、答题完成数，以及每门课的详细进度。",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    }
};

// ==================== 引擎工具 (心跳/Cron/子代理) ====================
const ENGINE_CRON_LIST_TOOL = {
    type: "function",
    function: {
        name: "engine_cron_list",
        description: "查询所有正在运行的后台定时任务(Cron)。",
        parameters: { type: "object", properties: {}, required: [] }
    }
};

const ENGINE_CRON_CREATE_TOOL = {
    type: "function",
    function: {
        name: "engine_cron_create",
        description: "创建一个后台定时任务(Cron)，定期执行命令。适合定期检查刷课进度、推送通知、数据备份等场景。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "任务名称" },
                interval: { type: "number", description: "执行间隔（秒），最小60秒" },
                action_cmd: { type: "string", description: "要执行的shell命令" }
            },
            required: ["name", "interval", "action_cmd"]
        }
    }
};

const ENGINE_CRON_DELETE_TOOL = {
    type: "function",
    function: {
        name: "engine_cron_delete",
        description: "删除一个后台定时任务(Cron)。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "任务名称" }
            },
            required: ["name"]
        }
    }
};

const DELEGATE_TASK_TOOL = {
    type: "function",
    function: {
        name: "delegate_task",
        description: "【推荐】创建一个子代理执行后台任务。子代理会根据角色获得不同工具权限。比 engine_agent_create 更稳定。可以创建多个并行子代理，多次调用即可。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "子代理名称，简短唯一" },
                task: { type: "string", description: "任务描述（100字以内），如'搜索2024年AI最新新闻并总结'" },
                role: { type: "string", description: "子代理角色：explorer(搜) planner(规) developer(开) verifier(验) general(全)。默认general", "default": "general" },
                prompt: { type: "string", description: "自定义系统提示词。不传则基于task自动生成" }
            },
            required: ["name", "task"]
        }
    }
};

const ENGINE_AGENT_STATUS_TOOL = {
    type: "function",
    function: {
        name: "engine_agent_status",
        description: "查询子代理的运行状态和结果。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "子代理名称" }
            },
            required: ["name"]
        }
    }
};

const ENGINE_AGENT_LIST_TOOL = {
    type: "function",
    function: {
        name: "engine_agent_list",
        description: "列出所有已创建的子代理。",
        parameters: { type: "object", properties: {}, required: [] }
    }
};

const ENGINE_AGENT_DELETE_TOOL = {
    type: "function",
    function: {
        name: "engine_agent_delete",
        description: "删除一个指定的子代理（不可撤销）。删除前应向用户确认。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "要删除的子代理名称" }
            },
            required: ["name"]
        }
    }
};

const ENGINE_AGENT_ASK_TOOL = {
    type: "function",
    function: {
        name: "engine_agent_ask",
        description: "给一个已存在的子代理发送一条消息，等待它回复后返回结果。相当于跟子代理聊天。如果子代理不存在会报错。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "子代理名称（必须是已有子代理）" },
                message: { type: "string", description: "要发送给子代理的消息内容" }
            },
            required: ["name", "message"]
        }
    }
};

const ENGINE_PUSH_TOOL = {
    type: "function",
    function: {
        name: "engine_push",
        description: "向用户推送一条通知消息，消息会通过心跳机制在下次心跳时到达前端。适合Cron任务或子代理完成后通知用户。",
        parameters: {
            type: "object",
            properties: {
                msg: { type: "string", description: "推送消息内容" }
            },
            required: ["msg"]
        }
    }
};
// ==================== 搜索工具定义 (Tool Calling) ====================
const RAG_SEARCH_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "rag_search",
        description: "仅在用户明确询问文档/知识库内容时搜索本地知识库。不要对一般性问题调用此工具。",
        parameters: {
            type: "object",
            properties: {
                question: { type: "string", description: "要查询的问题或关键词" }
            },
            required: ["question"]
        }
    }
};

const SEARCH_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "web_search",
        description: "执行网页搜索并返回结果。当用户问题涉及最新新闻、实时信息、当前事件、专业知识库之外的内容时,应主动调用此工具。搜索结果会包含网页标题、链接和摘要。",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "搜索查询关键词,建议简洁明确,涵盖问题核心。"
                },
                reason: {
                    type: "string",
                    description: "调用搜索的原因简述,说明为什么需要搜索这个问题。"
                }
            },
            required: ["query"]
        }
    }
};

// ==================== 图像生成工具定义 ====================
const IMAGE_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "generate_image",
        description: "【纯文生图】用于从零开始生成图片。★ 这是唯一的生图方式，不要在文本回复中伪造图片链接。适用场景:画一幅画、生成一张图片、创作插画。没有参考图片时必须用这个。",
        parameters: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "★ 图片提示词，必须英文，≤1500字符。超出会被截断导致效果差。简洁描述主题、风格即可，不要长篇大论。例如:'A cute cat, anime style'"
                },
                model: {
                    type: "string",
                    description: "图像模型: image-01(默认,写实风格)"
                },
                aspect_ratio: {
                    type: "string",
                    description: "宽高比:1:1(1024×1024)/16:9(1280×720)/4:3(1152×864)/3:2(1248×832)/2:3(832×1248)/3:4(864×1152)/9:16(720×1280)/21:9"
                },
                n: {
                    type: "integer",
                    description: "生成图片数量,1-9张。★ 用户要求多张图片时务必使用此参数一次生成，不要多次调用生成。默认1张。"
                },
                seed: {
                    type: "integer",
                    description: "【严格规则 ⚠️】只有同时满足以下所有条件时才传入seed:\n1. n=1（只生成一张）\n2. 用户明确要求前后风格一致/一样/同款\n3. 上次也用这个seed\n\n⚠️ n>1（多张）时绝不要传seed——否则所有图片完全相同。\n⚠️ 提示词不一样时也不要传seed。\n⚠️ 通常情况下不要传seed，让系统自由发挥效果更好。"
                },
                prompt_optimizer: {
                    type: "boolean",
                    description: "是否开启prompt自动优化,默认false"
                },
                aigc_watermark: {
                    type: "boolean",
                    description: "是否添加水印,默认false"
                }
            },
            required: ["prompt"]
        }
    }
};

// ==================== 图生图工具定义 ====================
const IMAGE_I2I_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "generate_image_i2i",
        description: "【图生图】用户上传了参考图并要求生成/创作图片时用这个。适用场景:换颜色、换风格、换脸/换发型、以图为基础创作新图等。这个工具会先分析参考图获取详细描述,再调用真正的图生图API生成符合要求的新图。禁止:用户只是问'图片里有什么'时不要用这个,用analyze_image。",
        parameters: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "【必填】生成要求描述,如:'保持原貌只把头发改成粉红色'/'二次元风格蓝色眼睛'/'把这张图改成油画风格'"
                },
                aspect_ratio: {
                    type: "string",
                    description: "宽高比:1:1/16:9/4:3/3:2/2:3/3:4/9:16,默认1:1"
                },
                n: {
                    type: "integer",
                    description: "生成图片数量,1-9张。★ 需要多张变体时使用此参数一次生成。"
                },
                seed: {
                    type: "integer",
                    description: "随机种子。★ n>1时不要传seed，否则所有图一样。"
                }
            },
            required: ["prompt"]
        }
    }
};

// ==================== 图片理解工具定义 ====================
const ANALYZE_IMAGE_TOOL = {
    type: "function",
    function: {
        name: "analyze_image",
        description: "分析用户上传的图片内容,返回详细的图片描述。当用户发送图片并询问图片内容、要求描述图片、分析图片细节时调用此工具。支持 JPEG、PNG、GIF、WebP 格式。",
        parameters: {
            type: "object",
            properties: {
                focus: {
                    type: "string",
                    description: "分析重点,如:'人物特征'、'场景描述'、'文字识别'、'物体识别'等。不传则进行综合分析。"
                }
            }
        }
    }
};

// ==================== 服务器图片上传 ====================
// SERVER_API_BASE declared in index.html

/** ★ 修复: 清理无效的图片URL，避免控制台报错 */
function cleanImageUrl(url) {
    if (!url) return '';
    // 如果 URL 指向已知无法访问的域名，替换为占位图
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
            // 返回一个空的 data URL 占位，由 onerror 处理显示提示
            return 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23fef3c7%22/%3E%3Ctext x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2212%22 fill=%22%2392400e%22%3E图片已失效%3C/text%3E%3C/svg%3E';
        }
    }
    return url;
}

async function uploadImageToServer(base64Data) {
    try {
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
        
        if (response.ok) {
            const result = await response.json();
            if (result.url) {
                return SERVER_API_BASE + result.url;
            }
        }
        console.warn('[uploadImageToServer] 上传失败,状态:', response.status);
        return null;
    } catch (e) {
        console.warn('[uploadImageToServer] 上传失败:', e.message);
        return null;
    }
}

let _lastServerBackup = 0;
const SERVER_BACKUP_INTERVAL = 2000; // ★ 2秒即可再次备份，平板确保不丢
let _deletedChatIds = {}; // ★ 跟踪已删除的聊天ID，合并时排除

async function saveChatsToServer() {
    try {
        var now = Date.now();
        if (now - _lastServerBackup < SERVER_BACKUP_INTERVAL) return false;
        _lastServerBackup = now;
        
        var token = localStorage.getItem('authToken');
        if (!token) return false;
        var url = SERVER_API_BASE + '/chat.php';
        url += '?auth_token=' + token;
        
        // ★ 合并：先读服务器已有数据，再合并本地聊天，防止多窗口覆盖
        var mergedChats = JSON.parse(JSON.stringify(chats));
        console.log('[save] 本地聊天数:', Object.keys(mergedChats).length);
        try {
            var getUrl = url + '&chat_id=all';
            console.log('[save] GET:', getUrl.substring(0,80));
            var getResp = await fetch(getUrl);
            console.log('[save] GET响应:', getResp.status);
            if (getResp.ok) {
                var serverData = await getResp.json();
                var serverChats = serverData.chats || {};
                console.log('[save] 服务器聊天数:', Object.keys(serverChats).length);
                var added = 0;
                for (var scid in serverChats) {
                    if (!mergedChats[scid] && !_deletedChatIds[scid]) {
                        mergedChats[scid] = serverChats[scid];
                        added++;
                    }
                }
                console.log('[save] 合并新增:', added);
            }
        } catch(e) {
            console.warn('[save] GET合并失败:', e.message);
        }
        
        var response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: 'all', chats: mergedChats, title: '聊天备份' })
        });
        
        if (response.ok) {
            _deletedChatIds = {}; // 清除已同步的删除标记
            return true;
        }
        return false;
    } catch (e) {
        console.warn('[saveChatsToServer] 备份失败:', e.message);
        return false;
    }
}

// ★ 将完整配置保存到服务器（按用户隔离）
async function saveConfigToServer() {
    var token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        var config = {};
        var allKeys = [];
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k || k === 'chats' || k === 'lastChatId' || k === 'deviceId' ||
                k === 'ongoingChats' || k === 'authToken' || k === 'authUsername' ||
                k === 'authUserId' || k === 'dark' || k === 'modelContextLength' ||
                k === 'modelMaxOutputTokens' || k === 'autoDetectedTextModels' ||
                k === '_test') continue;
            allKeys.push(k);
        }
        allKeys.forEach(function(k) {
            var v = localStorage.getItem(k);
            if (v !== null && v !== undefined) config[k] = v;
        });
        console.log('[save] 保存', Object.keys(config).length, '个配置项到服务器');
        var url = SERVER_API_BASE + '/chat.php?auth_token=' + token + '&action=save_config';
        var saved = false;
        try {
            var resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
            if (resp.ok) saved = true;
        } catch(e1) { console.warn('[save] 保存失败:', e1.message); }
        if (!saved) {
            try {
                var resp2 = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
                if (resp2.ok) saved = true;
            } catch(e2) { console.warn('[save] 重试保存也失败:', e2.message); }
        }
        console.log(saved ? '[save] 配置保存完成' : '[save] 配置保存失败（已重试）');

    } catch(e) {
        console.warn('[save] 配置保存失败:', e.message);
    }
}

// ★ 从服务器加载配置
// ★ 新用户默认配置
function getDefaultConfig() {
    return {
        baseUrl: 'https://oneapi.naujtrats.xyz/v1',
        model: 'deepseek-v4-flash',
        visionModel: 'MiniMax-VL-01',
        visionApiUrl: 'https://xiaoxin.naujtrats.xyz/mcp',
        visionApiKey: '',
        imageModel: 'image-01',
        imageBaseUrl: 'https://api.minimaxi.com/v1',
        imageApiKey: '',
        apiKey: '',
        temp: '0.7',
        tokens: '4096',
        stream: 'true',
        requestTimeout: '120',
        markdownGFM: 'true',
        markdownBreaks: 'false',
        lineHeight: '1.1',
        fontSize: '14',
        enableSearch: 'false',
        searchProvider: 'duckduckgo',
        searchTimeout: '30',
        maxSearchResults: '3',
        aiSearchJudge: 'true',
        aiSearchJudgeModel: 'deepseek-chat',
        searchAppendToSystem: 'true'
    };
}

async function loadConfigFromServer() {
    console.log('[loadConfigFromServer] 开始加载');
    var token = localStorage.getItem('authToken');
    if (!token) { console.log('[loadConfigFromServer] 无token'); return; }
    console.log('[loadConfigFromServer] token有效，请求配置');
    try {
        var resp = await fetch(SERVER_API_BASE + '/chat.php?auth_token=' + token + '&action=get_config');
        console.log('[loadConfigFromServer] 响应状态:', resp.status);
        if (!resp.ok) { console.log('[loadConfigFromServer] 响应异常,跳过'); return; }
        var config = await resp.json();
        console.log('[loadConfigFromServer] 配置数据键数:', config ? Object.keys(config).length : 0);
        if (!config || Object.keys(config).length === 0) {
            console.log('[loadConfigFromServer] 服务器无配置数据');
            return;
        }
        var keys = Object.keys(config);
        console.log('[loadConfigFromServer] 写入localStorage的键:', keys.slice(0,10).join(','));
        for (var k in config) {
            // ★ 防止服务器配置覆盖本地暗色模式设置（避免闪色）
            // ★ 跳过暗色模式和Agent模式（防止服务器覆盖用户本地设置）
            if (config[k] !== null && config[k] !== undefined && k !== 'dark' && k !== 'agentMode') localStorage.setItem(k, config[k]);
        }
        console.log('[loadConfigFromServer] 写入完成');
    } catch(e) {
        console.warn('[loadConfigFromServer] 失败:', e.message);
    }
}

async function loadChatsFromServer() {
    try {
        const token = localStorage.getItem('authToken');
        // ★ 没登录且没 deviceId 时跳过同步（避免 fallback 'default' 导致 404）
        var deviceId = localStorage.getItem('deviceId');
        if (!token && !deviceId) return null;
        let url = SERVER_API_BASE + '/chat.php?chat_id=all';
        if (token) {
            url += '&auth_token=' + token;
        } else {
            url += '&device_id=' + deviceId;
        }
        const response = await fetch(url);
        if (response.ok) {
            const result = await response.json();
            if (result.chats) return result.chats;
        }
        return null;
    } catch (e) {
        console.warn('[loadChatsFromServer] 恢复失败:', e.message);
        return null;
    }
}

// ★ 登录后的数据恢复：从服务器加载当前账号的配置和聊天记录
async function restoreUserData() {
    console.log('[restoreUserData] 开始恢复用户数据');
    var token = localStorage.getItem('authToken');
    console.log('[restoreUserData] token:', token ? token.substring(0,20)+'...' : 'null');
    if (!token) { console.log('[restoreUserData] 无token，跳过'); return; }
    
    var uid = localStorage.getItem('authUserId') || '';
    
    // 0. 迁移旧聊天记录：给没有 userId 的打上当前用户标签
    if (uid) {
        var migrated = 0;
        for (var _cid in chats) {
            if (!chats[_cid].userId) {
                chats[_cid].userId = uid;
                migrated++;
            }
        }
        if (migrated > 0) {
            localStorage.setItem('chats', JSON.stringify(chats));
            console.log('[restoreUserData] 迁移了', migrated, '个旧聊天记录');
        }
    }
    
    // ★ 并行加载配置和聊天记录
    console.log('[restoreUserData] 并行加载配置和聊天记录...');
    await Promise.all([
        (async function() {
            try { await loadConfigFromServer(); } catch(e) { console.warn('[restoreUserData] 配置加载失败:', e.message); }
        })(),
        (async function() {
            try {
                var serverChats = await loadChatsFromServer();
                if (serverChats && typeof serverChats === 'object') {
                    chats = JSON.parse(JSON.stringify(serverChats));
                    localStorage.setItem('chats', JSON.stringify(chats));
                    renderChatHistory();
                    console.log('[restoreUserData] 加载了', Object.keys(serverChats).length, '个聊天');
                }
            } catch(e) { console.warn('[restoreUserData] 聊天加载失败:', e.message); }
        })()
    ]);
    
    // ★ 配置和聊天都加载完后初始化
    console.log('[restoreUserData] 初始化配置');
    initializeConfig();
    // ★ 如果没有任何聊天记录，自动新建一个对话
    var chatKeys = Object.keys(chats);
    if (chatKeys.length === 0) {
        console.log('[restoreUserData] 无聊天记录，自动新建');
        createNewChat();
    } else {
        // 恢复上次打开的对话
        var lastId = localStorage.getItem('lastChatId');
        if (lastId && chats[lastId]) {
            loadChat(lastId);
        } else {
            loadChat(chatKeys[chatKeys.length - 1]);
        }
    }
    console.log('[restoreUserData] 恢复完成');
}

// ★ 登出前保存：确保当前账号的配置和聊天存到服务器
function saveUserDataBeforeLogout() {
    console.log('[logout] 开始保存用户数据');
    // 配置保存（keepalive 确保页面关闭后请求完成）
    var token = localStorage.getItem('authToken');
    if (!token) { console.log('[logout] 无token,跳过'); return; }
    
    // 直接构建并发送配置（同步读取localStorage，异步发送，keepalive保证送达）
    try {
        var config = {};
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k || k === 'chats' || k === 'lastChatId' || k === 'deviceId' ||
                k === 'ongoingChats' || k === 'authToken' || k === 'authUsername' ||
                k === 'authUserId' || k === 'dark' || k === 'modelContextLength' ||
                k === 'modelMaxOutputTokens' || k === 'autoDetectedTextModels' ||
                k === '_test') continue;
            var v = localStorage.getItem(k);
            if (v !== null && v !== undefined) config[k] = v;
        }
        console.log('[logout] 配置项:', Object.keys(config).length);
        fetch(SERVER_API_BASE + '/chat.php?auth_token=' + token + '&action=save_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        }).catch(function(e) { console.warn('[logout] 配置保存失败:', e.message); });
    } catch(e) { console.warn('[logout] 配置保存错误:', e.message); }
    
    // 聊天保存（通过 saveChatsToServer 合并后再保存）
    if (typeof chats !== 'undefined' && chats && Object.keys(chats).length > 0) {
        try {
            console.log('[logout] 保存聊天:', Object.keys(chats).length, '个');
            saveChatsToServer();
        } catch(e) { console.warn('[logout] 聊天保存错误:', e.message); }
    }
    console.log('[logout] 保存已触发');
}

const AI_JUDGE_TIMEOUT = 5000;
const MAX_HISTORY_LENGTH = 2000;
const TITLE_MAX_LENGTH = 20;
const MAX_TOKENS_SAFETY_MARGIN = 1000;
const STREAM_DELAY = 2;

const DEFAULT_CONFIG = {
    // 预置 oneapi API Key
    key: 'KEY_REMOVED',
    url: 'https://oneapi.naujtrats.xyz/v1',
    model: 'deepseek-chat',
    visionApiUrl: 'https://xiaoxin.naujtrats.xyz/mcp',
    visionApiKey: 'KEY_REMOVED',
    visionModel: 'MiniMax-VL-01',
    imageModel: 'image-01',
    imageBaseUrl: 'https://api.minimaxi.com/v1',
    system: '你是一个有用的助手。\n' +
        '1. 本地知识库包含上传的文档(用rag_search工具查询)。知识库有截止日期,需要最新信息时联网搜索。\n' +
        '2. 用户给出时间上下文时以此为准理解今天等概念。\n' +
        '3. 生成图表时用Mermaid语法：时序用graph TD/LR，折线用xychart-beta，饼图用pie，甘特用gantt。代码字符串用英文双引号。\n' +
        '4. 【联网搜索与网页抓取】\n' +
        '   - 搜索使用 web_search 工具,结果包含标题+链接+摘要。\n' +
        '   - 如需查看搜索结果中链接的详细内容,使用 web_fetch 工具。\n' +
        '   - web_fetch 支持批量并行抓取(最多5个URL): 将感兴趣的链接URL数组传入 urls 参数即可。\n' +
        '   - 典型流程: web_search → 分析结果 → web_fetch 深入查看 → 综合回答。\n' +
        '5. 【重要-图片生成规则】\n' +
        '   【关键规则】当用户上传了图片时:\n' +
        '   - 如果用户上传了图片并要求生成/创作/换颜色/换风格/换脸等，调用 generate_image_i2i（已支持真正的图生图API）\n' +
        '   - 用户没有上传图片但要求画图时，调用 generate_image（纯文生图）\n' +
        '   - 如果用户只是问图片里有什么/描述图片内容,可以直接回答或调用 analyze_image\n' +
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
    agentMaxToolRounds: 30,
    agentThinkingDepth: 'standard',
    agentSystemPrompt: `你现在处于 Agent 模式，拥有增强自主能力。
## 子代理角色系统
使用 delegate_task 时可以通过 role 参数选择子代理角色:
- explorer(🔍搜索专员): 只读搜索，适合查资料、抓网页。不可修改文件或执行命令
- planner(📐规划师): 制定方案、分析策略。不做执行，只出方案
- developer(⚡开发者): 读写文件、执行命令、搜索。全能执行角色
- verifier(✅验证者): 检查结果、找问题。只读，不可修改
- general(🌐全能代理): 所有工具可用（默认）
## 工作流引擎
复杂任务可以用 workflow 串联多个子代理: 搜索→规划→执行→验证
## 核心原则
- 主动分析用户需求,规划多步骤行动方案再执行
- 发现适合后台并行的任务时，立刻创建子代理处理，不要等
- 简单任务（≤2次搜索/读已知文件）直接用工具，不开子代理
- 需要定时任务时使用 engine_cron_create 创建 cron
- 需要后台任务时使用 delegate_task 创建子代理（一次一个，稳定可靠）
- 要与已有子代理对话时使用 engine_agent_ask 给子代理发送消息即可
- 需要执行终端命令时使用 server_exec
- 需要运行 Python 脚本时使用 server_python
- 需要读取服务器文件时使用 server_file_read
- 完成分析后直接把最终结果**打字回复给用户**，不要写入文件
- 不要等用户一步步指示，主动推进任务
## ★ 必须创建子代理的场景（满足任一即创建）
1. 任务需要搜索多个关键词/来源（如：同时搜索新闻、百科、社区）
2. 任务需要批量处理文件、数据、页面
3. 任务涉及定时监控或定时汇报
4. 任务耗时预计超过 2 分钟（搜索+整理、生成报告等）
5. 用户说"帮我看看""帮我查一下""帮我分析"等模糊请求，先创建子代理再行动
6. 任何可以并行执行的独立子任务，立刻拆出来用子代理
## ★ 输出方式（强制遵守）
- **直接打字回复**：分析完成后，直接把最终结果/报告/回答以普通文本消息发出来。这是默认输出方式
- **禁止写文件到 /tmp/**：不要用 server_file_write 写入文件然后给链接。用户希望直接看到内容
- **除非用户明确要求保存到文件**，否则一律直接回复文字
## ★ 等待子代理（强制遵守）
- **创建子代理后，必须等待它们完成**。不要刚创建完就自己开始做同样的事
- 如果子代理已经创建并运行，**不要重复开始工作**。子代理的结果会通过系统通知给你
- 子代理在运行时，你可以做其他不冲突的事或等待。不要抢先做子代理正在做的工作
- 简单任务（≤2次搜索/读已知文件）直接用工具，不开子代理
- 读已知路径文件：直接用 server_file_read
- 复杂/批量/耗时>2分钟：用子代理
## 行为规范
- 每一步工具调用后，简短说明下一步计划
- 工具调用之间保持用户知情
- 复杂任务主动拆解为子任务，多步骤任务优先用子代理
- 操作文件前先确认路径
- 执行危险命令前询问用户
## ★ 子代理完成后的处理规则（强制遵守）
- 系统消息中的「子代理完成报告」是内部通知，**不是用户的消息，不要回复**
- ⚠️ 强制规则：禁止回复「子代理已完成」「搜索完成」「结果来了」「报告已完成」这类通知
- ⚠️ 强制规则：收到子代理报告时**禁止创建任何新的子代理**。只记录结果，不要行动
- 子代理运行期间，**不要向用户汇报进度**，用户只需要看到最终的综合回答
- 当所有子代理都完成后，如果用户还在等待，自然整合结果回复一条。否则保持静默
- 子代理失败也静默，用户不问就不提`
};

// ==================== 全局变量 ====================
let keyboardActive = false;
let lastInnerHeight = window.innerHeight;
let lastInnerWidth = window.innerWidth;
let configPanelInteracting = false; // 标记是否正在与配置面板交互

// 使用 visualViewport API 检测键盘弹出(支持平板和手机)

// 带重试的 fetch 函数
async function fetchWithRetry(url, options, maxRetries = 3, retryDelay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);

            // 检查响应状态
            if (!response.ok) {
                // 永远不要尝试读取响应体,因为可能已经被 streamResponse 读取
                // 根据 MiniMax API 文档,直接使用状态码信息
                const status = response.status;
                const statusText = response.statusText;

                // 特殊处理 529 错误(服务过载)
                if (status === 529) {
                    console.warn(`HTTP 529 服务过载 (尝试 ${attempt}/${maxRetries})`);

                    if (attempt < maxRetries) {
                        // 计算退避延迟(指数退避)
                        const delay = retryDelay * Math.pow(2, attempt - 1);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    } else {
                        throw new Error(`服务过载,请稍后重试 (HTTP 529)`);
                    }
                }

                // 其他错误直接抛出
                throw new Error(`HTTP ${status}: ${statusText}`);
            }

            return response;

        } catch (error) {
            lastError = error;

            // 特殊处理 529 错误的重试
            if (error.message.includes('529') || error.message.includes('过载')) {
                if (attempt === maxRetries) {
                    throw new Error(`请求失败,重试 ${maxRetries} 次后仍然失败: ${error.message}`);
                }

                // 计算退避延迟
                const delay = retryDelay * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            // 非 529 错误直接抛出
            throw error;
        }
    }

    throw lastError;
}
function setupKeyboardDetection() {
    // 优先使用 visualViewport API
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            const viewport = window.visualViewport;
            // 如果视口宽度没变但高度减少了,说明键盘弹出了
            const heightDiff = lastInnerHeight - viewport.height;
            keyboardActive = heightDiff > 50; // 高度减少超过50px认为是键盘
            lastInnerHeight = viewport.height;
        });
        window.visualViewport.addEventListener('scroll', () => {
            // 滚动时也可能伴随键盘操作
        });
    } else {
        // 回退方案:监听 window 的 resize 事件
        window.addEventListener('resize', () => {
            const heightDiff = lastInnerHeight - window.innerHeight;
            keyboardActive = heightDiff > 50;
            lastInnerHeight = window.innerHeight;
        });
    }

    // 监听输入框聚焦/失焦事件(通用)- 特别针对配置面板
    document.addEventListener('focusin', (e) => {
        if (e.target.matches('input, textarea, select')) {
            keyboardActive = true;
            // 检查是否是配置面板内的元素
            if ($.configPanel?.contains(e.target)) {
                configPanelInteracting = true;
                configPanelWasOpen = true; // 标记配置面板处于使用中
            }
        }
    });
    document.addEventListener('focusout', (e) => {
        setTimeout(() => {
            // 检查是否还有其他输入框聚焦
            const focused = document.querySelector('input:focus, textarea:focus, select:focus');
            if (!focused) {
                keyboardActive = false;
            }
            // 检查配置面板内是否还有聚焦
            if (!focused || !$.configPanel?.contains(focused)) {
                configPanelInteracting = false;
            }
        }, 150);
    });
}
let currentChatId = null;
let chats = JSON.parse(localStorage.getItem('chats') || '{}');
let pendingFiles = [];
let isTypingMap = {};
let abortControllerMap = {};
let searchAbortControllerMap = {};
let userAbortMap = {};
let activeBubbleMap = {};
let userScrolled = false;
let isAutoScrolling = false;  // 防止自动滚动时干扰 userScrolled
let modelContextLength = JSON.parse(localStorage.getItem('modelContextLength') || '{}');
let modelMaxOutputTokens = JSON.parse(localStorage.getItem('modelMaxOutputTokens') || '{}');
let prevWidth = window.innerWidth;
let configSnapshot = null;  // 配置面板打开时的配置快照,用于取消功能

const $ = {
    chatBox: null,
    chatMessagesContainer: null,
    userInput: null,
    sendBtn: null,
    stopBtn: null,
    filePreviewContainer: null,
    fileInput: null,
    scrollToBottomBtn: null,
    chatTitle: null,
    sidebar: null,
    configPanel: null,
    sidebarMask: null,
    sidebarToggle: null,
    searchQuickToggle: null
};

// ==================== 安全工具函数 ====================
const Safe = {
    get(obj, path, defaultValue = undefined) {
        if (obj == null) return defaultValue;
        const keys = Array.isArray(path) ? path : path.split('.');
        let result = obj;
        for (const key of keys) {
            if (result == null) return defaultValue;
            result = result[key];
        }
        return result ?? defaultValue;
    },
    call(fn, ...args) {
        try { return fn(...args); } catch (e) { console.warn('[Safe.call]', e.message); return undefined; }
    },
    parseJSON(str, fallback = null) {
        try { return JSON.parse(str); } catch (e) { console.warn('[Safe.parseJSON]', e.message); return fallback; }
    },
    arrayGet(arr, index, defaultValue = undefined) {
        return Array.isArray(arr) ? (arr[index] ?? defaultValue) : defaultValue;
    },
    string(val, fallback = '') { return val == null ? fallback : String(val); },
    number(val, fallback = 0) { const n = Number(val); return isNaN(n) ? fallback : n; }
};

// ==================== 统一错误处理 ====================
class AppError extends Error {
    constructor(message, code = 'UNKNOWN', details = null) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.details = details;
    }
}

const ErrorHandler = {
    categorize(error) {
        if (error instanceof AppError) return error;
        const msg = Safe.string(error?.message).toLowerCase();
        if (msg.includes('network') || msg.includes('fetch')) return new AppError('网络错误', 'NETWORK', error);
        if (msg.includes('timeout') || msg.includes('aborted')) return new AppError('请求超时', 'TIMEOUT', error);
        if (msg.includes(' unauthorized') || msg.includes('401') || msg.includes('403')) return new AppError('API Key无效', 'AUTH', error);
        if (msg.includes('429')) return new AppError('请求过于频繁', 'RATE_LIMIT', error);
        if (msg.includes('500') || msg.includes('502')) return new AppError('服务器错误', 'SERVER', error);
        return new AppError(Safe.string(error?.message, '未知错误'), 'UNKNOWN', error);
    },
    show(error, bubble = null) {
        const appError = this.categorize(error);
        console.error('[Error]', appError.code, appError.message);
        showToast(appError.message, 'error', 4000);
        if (bubble) {
            bubble.classList.remove('typing');
            const div = document.createElement('div');
            div.className = 'error-message';
            div.innerHTML = `<span class="error-icon">❌</span> ${escapeHtml(appError.message)}`;
            bubble.querySelector('.message-content')?.appendChild(div);
        }
        return appError;
    }
};

// ==================== Markdown 实时渲染优化 (v2 - 增强版) ====================
const MarkdownRenderer = {
    cache: new Map(),
    cacheSize: 30,
    renderTimer: null,
    lastText: '',
    lastContainer: null,
    /** 流式渲染时是否正在渲染中 */
    _rendering: false,
    /** 等待渲染的队列 */
    _pending: null,

    /**
     * 智能渲染 - 使用 requestAnimationFrame 避免阻塞 UI
     * 流式输出时自动应用动态延迟（文本越长延迟越大）
     */
    smartRender(text, container, force = false) {
        if (!text || !container) return;
        if (!force && text === this.lastText && container === this.lastContainer) return;

        // 清理之前的定时器
        if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }

        this.lastText = text;
        this.lastContainer = container;

        // 动态延迟：短文本快速响应，长文本适当延迟减少闪烁
        const delay = text.length < 200 ? 50 : text.length < 1000 ? 80 : 120;

        this.renderTimer = setTimeout(() => {
            this.renderTimer = null;
            // 使用 requestAnimationFrame 让浏览器在渲染帧空闲时执行
            this._pending = { text, container };
            if (!this._rendering) {
                requestAnimationFrame(() => this._processRender());
            }
        }, delay);
    },

    /** requestAnimationFrame 回调中真正执行渲染 */
    _processRender() {
        this._rendering = true;
        const pending = this._pending;
        this._pending = null;

        if (pending) {
            this.doRender(pending.text, pending.container);
        }

        this._rendering = false;
        // 如果在渲染期间有新的 pending，继续处理
        if (this._pending) {
            requestAnimationFrame(() => this._processRender());
        }
    },

    /**
     * 计算文本的快速指纹 (用于缓存匹配)
     */
    _getFingerprint(text, maxLen = 300) {
        let hash = 0;
        const slice = text.slice(0, maxLen);
        for (let i = 0; i < slice.length; i++) {
            const char = slice.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return `${text.length}:${hash}`;
    },

    /**
     * 执行渲染（核心方法）
     * 标记解析 + 缓存 + 后处理
     */
    doRender(text, container) {
        const startTime = performance.now();
        const cacheKey = this._getFingerprint(text);
        let html;

        if (this.cache.has(cacheKey)) {
            html = this.cache.get(cacheKey);
        } else {
            try {
                // ★ 数学公式保护渲染
                html = _renderMarkdownWithMath(text);
                // 管理缓存大小
                if (this.cache.size >= this.cacheSize) {
                    const firstKey = this.cache.keys().next().value;
                    this.cache.delete(firstKey);
                }
                this.cache.set(cacheKey, html);
            } catch (e) {
                console.warn('[Markdown] Parse error:', e.message);
                html = `<pre>${escapeHtml(text)}</pre>`;
            }
        }

        // 批量设置 innerHTML (一次重排)
        container.innerHTML = html;

        // 后处理（代码高亮、Mermaid 等）使用微任务避免阻塞
        this.postRender(container);

        const elapsed = performance.now() - startTime;
        if (elapsed > 50) console.log(`[Markdown] Render: ${elapsed.toFixed(1)}ms`);
    },

    /**
     * 后处理：代码高亮 + Mermaid + 图片优化
     */
    postRender(container) {
        // 代码高亮
        this.highlightCode(container);
        // Mermaid 图表（异步，不阻塞）
        this.renderMermaid(container);
        // 图片优化（懒加载）
        this.optimizeImages(container);
    },

    /** 渲染 Mermaid 图表（支持流式实时渲染） */
    renderMermaid(container) {
        if (typeof mermaid === 'undefined') return;
        
        // 步骤1: 将 marked 输出的 language-mermaid 代码块转换为 .mermaid div
        container.querySelectorAll('pre code[class*="language-mermaid"]').forEach(function(codeBlock) {
            if (codeBlock.closest('.mermaid')) return;
            var pre = codeBlock.parentNode;
            var mermaidDiv = document.createElement('div');
            mermaidDiv.className = 'mermaid';
            var code = codeBlock.textContent;
            mermaidDiv.textContent = code;
            mermaidDiv.setAttribute('data-original-code', code);
            pre.parentNode.replaceChild(mermaidDiv, pre);
        });
        
        // 步骤2: 渲染所有尚未渲染的 .mermaid div（流式渲染时每帧重建，会自动重试）
        var mermaidDivs = container.querySelectorAll('.mermaid');
        if (!mermaidDivs.length) return;
        mermaidDivs.forEach(function(div) {
            var code = div.getAttribute('data-original-code') || div.textContent;
            if (!code || div.querySelector('svg')) return;
            // 流式渲染: 如果 mermaid 代码还在不断变化，跳过本次渲染避免闪烁
            var prevCode = div.getAttribute('data-prev-code') || '';
            if (code === prevCode) return;
            div.setAttribute('data-prev-code', code);
            window.ChartRenderer.render(code.trim()).then(function(result) {
                if (result.success) {
                    div.innerHTML = result.svg;
                }
            }).catch(function() {});
        });
    },

    /**
     * 代码高亮 - 只处理未高亮的代码块
     */
    highlightCode(container) {
        if (typeof hljs === 'undefined') return;
        var _warn = console.warn; console.warn = function() {};
        container.querySelectorAll('pre code:not(.hljs):not([class*="mermaid"])').forEach(block => {
            try { hljs.highlightElement(block); } catch (e) {}
        });
        console.warn = _warn;
    },

    /** 图片优化：懒加载 + 异步解码 */
    optimizeImages(container) {
        container.querySelectorAll('img').forEach(img => {
            img.loading = 'lazy';
            img.decoding = 'async';
        });
    },

    /** 强制立即渲染（跳过防抖） */
    forceRender(text, container) {
        if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
        if (this._pending) this._pending = null;
        this.doRender(text, container);
    },

    /** 清空缓存 */
    clearCache() { this.cache.clear(); }
};

// ==================== 图表绘制工具 (AI可调用) ====================
window.ChartRenderer = {
    async render(code) {
        if (!code) return { success: false, error: '代码为空' };
        if (typeof mermaid === 'undefined') return { success: false, error: 'Mermaid未加载' };
        const processed = this.preprocess(code);
        const id = 'chart-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        try {
            const result = await mermaid.render(id, processed);
            return { success: true, svg: result.svg, type: this.detectType(code) };
        } catch (e) {
            return this.handleError(e, code);
        }
    },

    handleError(e, code) {
        const msg = e.message || String(e);
        if (msg.includes('No diagram type detected') || msg.includes('UnsupportedDiagramError') ||
            msg.includes('UnknownDiagramError') || msg.includes('Diagram definition not found')) {
            return { success: false, type: 'unsupported', message: '不支持的图表类型', code,
                hint: '支持的类型: flowchart, sequence, class, state, er, gantt, pie, xychart, mindmap, timeline' };
        }
        if (msg.includes('Parse error') || msg.includes('Syntax')) {
            return { success: false, type: 'syntax', message: 'Mermaid 语法错误', code, error: msg };
        }
        return { success: false, type: 'error', message: msg, code: code };
    },

    detectType(code) {
        if (!code) return 'unknown';
        const c = code.trim().toLowerCase();
        const types = [
            { key: 'flowchart', pattern: /flowchart|graph\s*[TDLR]?/ },
            { key: 'sequence', pattern: /sequencediagram/i },
            { key: 'class', pattern: /classdiagram/i },
            { key: 'state', pattern: /statediagram/i },
            { key: 'er', pattern: /erdiagram/i },
            { key: 'gantt', pattern: /gantt/i },
            { key: 'pie', pattern: /pie/i },
            { key: 'xychart', pattern: /xychart/i },
            { key: 'mindmap', pattern: /mindmap/i },
            { key: 'timeline', pattern: /timeline/i },
            { key: 'journey', pattern: /journey/i }
        ];
        for (const t of types) { if (t.pattern.test(c)) return t.key; }
        return 'unknown';
    },

    preprocess(code) {
        if (!code) return '';
        let c = code.trim()
            .replace(/[""]/g, '"').replace(/['']/g, "'")
            .replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (c.includes('xychart')) {
            c = c.replace(/y-axis\s+([\d.]+)\s*-->-?\s*([\d.]+)\s+"[^"]*"/g, 'y-axis $1 --> $2');
            c = c.replace(/line\s+"([^"]+)"\s+([\d.\s,]+)/g, (m, label, nums) => {
                const formatted = nums.trim().split(/\s+/).filter(n => n).join(', ');
                return `line "${label}" ${formatted}`;
            });
        }
        return c;
    },

    async call(text, containerId) {
        const match = text.match(/```mermaid\n?([\s\S]*?)```/) || text.match(/```\n?([\s\S]*?)```/);
        if (!match) return { success: false, error: '未找到Mermaid代码,请使用 ```mermaid 代码块 ``` 包裹图表代码' };
        const code = match[1].trim();
        const result = await this.render(code);
        if (containerId && result.success) {
            const container = document.getElementById(containerId);
            if (container) container.innerHTML = result.svg;
        }
        return result;
    },

    async renderTo(code, container) {
        if (!container) return { success: false, error: '容器不存在' };
        const result = await this.render(code);
        if (result.success) container.innerHTML = result.svg;
        else container.innerHTML = this.renderError(result);
        return result;
    },

    renderError(result) {
        const typeIcons = { unsupported: '⚠️', syntax: '❌', error: '🚫' };
        const icon = typeIcons[result.type] || '❌';
        let hint = '';
        if (result.hint) hint = `<div style="font-size:0.85rem;color:#92400e;margin-top:6px">💡 ${result.hint}</div>`;
        return `<div style="padding:12px;border-radius:8px;background:#fef3c7;border:1px solid #f59e0b;margin:8px 0;color:#92400e;">
            <strong>${icon} ${result.message}</strong>
            ${result.error ? `<div style="font-size:0.8rem;margin-top:4px">${escapeHtml(result.error)}</div>` : ''}
            ${hint}
        </div>`;
    }
};

window.renderChart = (text, containerId) => window.ChartRenderer.call(text, containerId);
window.renderMermaid = (code, container) => window.ChartRenderer.renderTo(code, container);
// ==================== 工具函数 ====================
const getEl = id => document.getElementById(id);
const getVal = id => {
    const el = getEl(id);
    if (!el) return undefined;
    const val = el.value;
    // 输入框为空时用 DEFAULT_CONFIG 的默认值（仅非敏感配置）
    if (!val && id === 'baseUrl' && DEFAULT_CONFIG.url) return DEFAULT_CONFIG.url;
    if (!val && id === 'modelSelect' && DEFAULT_CONFIG.model) return DEFAULT_CONFIG.model;
    return val;
};
const getChecked = id => getEl(id)?.checked || false;
const setVal = (id, val) => { const el = getEl(id); if (el) el.value = (val === undefined || val === null) ? '' : val; };
const setChecked = (id, val) => { const el = getEl(id); if (el) el.checked = val; };

function logDebug(...args) {
}

function encrypt(text) {
    if (!text) return text;
    const key = new TextEncoder().encode(ENCRYPTION_KEY);
    const data = new TextEncoder().encode(text);
    const res = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) res[i] = data[i] ^ key[i % key.length];
    return btoa(String.fromCharCode(...res));
}

function decrypt(encoded) {
    if (!encoded) return encoded;
    try {
        const bin = atob(encoded);
        const bytes = new Uint8Array([...bin].map(c => c.charCodeAt(0)));
        const key = new TextEncoder().encode(ENCRYPTION_KEY);
        const res = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) res[i] = bytes[i] ^ key[i % key.length];
        return new TextDecoder().decode(res);
    } catch {
        return encoded;
    }
}

function compressNewlines(text, max = 1) {
    return text ? text.replace(/\r\n/g, '\n').replace(new RegExp(`\n{${max + 1},}`, 'g'), '\n'.repeat(max)) : text;
}

function estimateTokens(text) {
    if (!text) return 0;
    const ch = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const other = text.length - ch;
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.ceil(ch * 2 + other * 0.25 + words * 1.3);
}

const debounce = (fn, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), wait);
    };
};

const throttle = (fn, limit) => {
    let inThrottle;
    return (...args) => {
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 判断是否应该使用视觉模型格式
// 优先检查 _forceVisionFormat 标志(对话中有图片时由 buildApiMessages 设置)
function shouldUseVisionFormat() {
    // 强制视觉格式仅在当前模型支持视觉时生效
    if (window._forceVisionFormat) {
        const currentModel = getVal('modelSelect') || DEFAULT_CONFIG.model || '';
        // 更精确的视觉模型检测
        const visionModels = [
            'MiniMax-VL-01',      // MiniMax 视觉模型
            'minimax-vl',         // MiniMax 视觉模型(小写)
            'gpt-4-vision',       // OpenAI 视觉模型
            'gpt-4o',            // OpenAI 多模态模型
            'qwen-vl',           // Qwen 视觉模型
            'gemini',            // Google Gemini 模型
            'claude-3',          // Anthropic Claude 3 系列
            'deepseek-vl'        // DeepSeek 视觉模型
        ];
        // 检查是否是已知的视觉模型
        const isVisionModel = visionModels.some(vm =>
            currentModel.toLowerCase().includes(vm.toLowerCase())
        );
        if (!isVisionModel) return false; // 文本模型不支持视觉格式,由 analyze_image 工具处理
        return true;
    }

    const visionModel = localStorage.getItem('visionModel') || '';
    const model = localStorage.getItem('model') || '';

    // 精确的视觉模型关键词(只包含真正的视觉模型)
    const visionKeywords = [
        'vl-',           // 视觉语言模型前缀
        '-vl',           // 视觉语言模型后缀
        'vision',        // 明确包含 vision
        'minimax-vl',    // MiniMax 视觉模型
        'qwen-vl',       // Qwen 视觉模型
        'gemini-1.5',    // Gemini 1.5 支持多模态
        'claude-3'       // Claude 3 系列
    ];

    // 检查模型名称是否包含视觉关键词
    const modelLower = model.toLowerCase();
    const visionModelLower = visionModel.toLowerCase();

    const hasVisionKeyword = visionKeywords.some(k =>
        modelLower.includes(k.toLowerCase()) || visionModelLower.includes(k.toLowerCase())
    );

    // 额外的检查:排除误判的文本模型
    const textModels = ['minimax-m2.7', 'minimax-hailuo', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-v3', 'deepseek-v4', 'grok', 'kimi'];
    // 从本地存储读取自动添加的文本模型
    try {
        const autoTextModels = JSON.parse(localStorage.getItem('autoDetectedTextModels') || '[]');
        textModels.push(...autoTextModels);
    } catch (e) {}
    const isTextModel = textModels.some(tm => modelLower.includes(tm));

    // 如果有视觉关键词且不是文本模型,返回 true
    return (visionModel || hasVisionKeyword) && !isTextModel;
}

function buildUserContent(text, files) {
    if (!files?.length) return text;

    // 检查是否包含图片
    const hasImages = files.some(f => f.type?.startsWith('image/'));

    if (hasImages && shouldUseVisionFormat()) {
        // OpenAI 视觉模型格式:数组
        const content = [];
        // 添加图片
        for (const f of files) {
            if (f.type?.startsWith('image/')) {
                content.push({
                    type: 'image_url',
                    image_url: { url: f.content }
                });
            } else {
                // 非图片文件转为文本
                content.push({
                    type: 'text',
                    text: `[附件: ${f.name}]\n${f.content}`
                });
            }
        }
        // 添加用户文本指令
        if (text) {
            content.push({ type: 'text', text });
        }
        return content;
    }

    // 非视觉模型:图片转为文本描述(不传base64,避免token爆炸)
    if (hasImages) {
        const imageFiles = files.filter(f => f.type?.startsWith('image/'));
        // 保存当前消息的图片数据到全局变量,供 analyze_image 工具处理器使用
        window._currentMessageImages = imageFiles.map(f => ({ name: f.name, content: f.content, type: f.type }));

        const imageDescs = imageFiles.map(f => `[用户上传了图片: ${f.name}]`);
        const otherFiles = files.filter(f => !f.type?.startsWith('image/'));
        const otherContent = otherFiles.length
            ? otherFiles.map(f => `[附件: ${f.name}]\n${f.content}`).join('\n\n')
            : '';
        const imagePart = imageDescs.join(', ');
        // 不强制要求调用工具,让AI自主决定是否分析图片
        // 工具 analyze_image 已在请求中提供,AI可以自主选择调用
        const textPart = text ? `\n用户指令: ${text}` : '';
        return (imagePart + (imagePart && otherContent ? '\n\n' : '') + otherContent + textPart).trim();
    }

    // 非图片文件:保持原有文本格式
    return files.map(f => `[附件: ${f.name}]\n${f.content}`).join('\n\n') + (text ? `\n指令: ${text}` : '');
}

function checkStorageSpace() {
    try {
        localStorage.setItem('_test', 'x'.repeat(10000));
        localStorage.removeItem('_test');
        return true;
    } catch (e) {
        console.warn('存储空间不足,尝试自动清理...');
        // 尝试清理
        try {
            // 1. 清理旧的聊天记录(只保留最新的3个)
            cleanupOldChats(3);

            // 2. 清理其他可能的大数据
            const keysToCheck = ['imageCache', 'fileCache', 'tempData', 'uploadCache'];
            keysToCheck.forEach(key => {
                if (localStorage.getItem(key)) {
                    localStorage.removeItem(key);
                }
            });

            // 3. 清理过期的配置数据
            const configKeys = Object.keys(localStorage).filter(k =>
                k.startsWith('config_') || k.includes('_cache') || k.includes('temp_')
            );
            configKeys.forEach(key => {
                localStorage.removeItem(key);
            });

            // 4. 再次尝试
            localStorage.setItem('_test', 'x'.repeat(1e6));
            localStorage.removeItem('_test');
            return true;
        } catch (cleanupError) {
            console.error('自动清理失败:', cleanupError.message);
            // 显示用户友好的提示
            showToast('存储空间不足,请手动清理一些聊天记录或刷新页面', 'error');
            return false;
        }
    }
}

function cleanupOldChats(keep = 10) {
    const ids = Object.keys(chats).sort((a, b) => (parseInt(a.split('_')[1]) || 0) - (parseInt(b.split('_')[1]) || 0));
    if (ids.length <= keep) return;
    ids.slice(0, ids.length - keep).forEach(id => delete chats[id]);
    saveChatsDebounced();
}

// ==================== 文件处理 ====================
async function extractFileContent(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (file.type.startsWith('text/') || ['txt', 'md', 'js', 'py', 'json', 'html', 'css', 'xml', 'csv', 'log', 'sh', 'bat', 'conf', 'ini'].includes(ext)) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = e => resolve(e.target.result);
            fr.onerror = reject;
            fr.readAsText(file);
        });
    }
    if (ext === 'docx' || file.type.includes('word')) {
        if (!window.mammoth) throw new Error('mammoth 未加载');
        const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        return value;
    }
    if (['xlsx', 'xls', 'xlsm'].includes(ext) || file.type.includes('spreadsheet')) {
        if (!window.XLSX) throw new Error('SheetJS 未加载');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        return wb.SheetNames.map((name, i) => `【工作表 ${i + 1}: ${name}】\n` + XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: '\t', RS: '\n' })).join('\n\n');
    }
    // fallback
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = e => resolve(e.target.result);
        fr.onerror = reject;
        fr.readAsText(file);
    });
}

function updateFilePreviewUI() {
    const container = $.filePreviewContainer;
    if (!container) return;
    container.innerHTML = '';
    if (!pendingFiles.length) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    pendingFiles.forEach((f, i) => {
        const tag = document.createElement('span');
        tag.className = 'file-tag';
        tag.innerHTML = `<svg class="file-icon" viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M2 1.5C2 0.67 2.67 0 3.5 0h5.88c.4 0 .78.16 1.06.44l3.12 3.12c.28.28.44.66.44 1.06V14.5c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5v-13zM3.5 1c-.28 0-.5.22-.5.5v13c0 .28.22.5.5.5h9c.28 0 .5-.22.5-.5V4.62L10.38 1H3.5z"/><path d="M9 1v3.5c0 .28.22.5.5.5H13v1H9.5C8.67 6 8 5.33 8 4.5V1h1z"/></svg> ${escapeHtml(f.name)} (${(f.size / 1024).toFixed(1)}KB) <span class="remove-file" onclick="window.removeFile(${i})">✕</span>`;
        container.appendChild(tag);
    });
}

window.removeFile = i => {
    pendingFiles.splice(i, 1);
    updateFilePreviewUI();
    if ($.fileInput) $.fileInput.value = '';
};

function clearAllFiles() {
    pendingFiles = [];
    updateFilePreviewUI();
    if ($.fileInput) $.fileInput.value = '';
}

async function processSelectedFiles(fileList) {
    for (const file of Array.from(fileList)) {
        if (file.size > MAX_FILE_SIZE) {
            showToast('文件 ' + file.name + ' 超过10MB', 'warning');
            continue;
        }

        // 检查是否是图片文件
        var isImage = file.type.startsWith('image/');

        // 显示解析中提示
        var tempEl = document.createElement('span');
        tempEl.className = 'file-tag';
        tempEl.textContent = (isImage ? '读取' : '解析') + ' ' + file.name + '...';
        $.filePreviewContainer && $.filePreviewContainer.appendChild(tempEl);

        try {
            if (isImage) {
                // 图片文件转为 base64
                var base64 = await fileToBase64(file);
                var dataUrl = 'data:' + file.type + ';base64,' + base64;
                pendingFiles.push({ name: file.name, content: dataUrl, size: file.size, isImage: true, type: file.type });
                showToast('图片 ' + file.name + ' 已添加', 'success');
            } else {
                // 普通文件解析内容
                var content = await extractFileContent(file);
                pendingFiles.push({ name: file.name, content: content, size: file.size, isImage: false, type: file.type });
                showToast('文件 ' + file.name + ' 解析完成', 'success');
            }
        } catch (err) {
            showToast((isImage ? '读取' : '解析') + ' ' + file.name + ' 失败: ' + err.message, 'error');
        } finally {
            tempEl.remove();
        }
    }
    updateFilePreviewUI();
    if ($.fileInput) $.fileInput.value = '';
}

// 文件转为 base64
function fileToBase64(file) {
    return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() { resolve(reader.result.split(',')[1]); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
// ==================== UI 工具 ====================
window.autoResize = function (el) {
    el.style.height = 'auto';
    // ★ 限制最大高度避免 rounded-full 背景溢出
    const max = window.innerWidth <= 480 ? 80 : 100;
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
};

function showToast(msg, type = 'info', dur = 3000) {
    let container = getEl('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${ { success: '✓', error: '✕', warning: '⚠', info: 'i' }[type] }</div>
        <div class="toast-message">${escapeHtml(msg)}</div>
        <button class="toast-close">&times;</button>
    `;
    toast.querySelector('.toast-close').onclick = () => toast.remove();
    setTimeout(() => toast.remove(), dur);
    container.appendChild(toast);
}

// 自动滚动到底部(用于AI回复等场景)
function autoScrollToBottom(reason) {
    if (!$.chatBox) return;
    // 如果用户已经主动滚动离开底部，不要强制拉回（streaming 时由外部控制）
    // 只有明显在底部时才滚动
    const { scrollTop, scrollHeight, clientHeight } = $.chatBox;
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    // 距离底部超过一屏就不跟随了（用户在看上面的内容）
    if (distFromBottom > clientHeight * 1.5 && reason !== 'loadChat') return;
    isAutoScrolling = true;
    // 大幅滚动用 smooth，正常小增长用 instant（避免抖动）
    if (distFromBottom > 200) {
        $.chatBox.scrollTo({ top: $.chatBox.scrollHeight, behavior: 'smooth' });
    } else {
        $.chatBox.scrollTop = $.chatBox.scrollHeight;
    }
    setTimeout(() => { isAutoScrolling = false; }, 300);
}

window.scrollToBottom = () => {
    $.chatBox?.scrollTo({ top: $.chatBox.scrollHeight, behavior: 'smooth' });
    userScrolled = false;
};

window.toggleDarkMode = function (init = false) {
    const html = document.documentElement;
    const dark = html.classList.toggle('dark');
    if (!init) localStorage.setItem('dark', dark);
    const moon = getEl('moonPath');
    const sun = getEl('sunPath');
    moon?.classList.toggle('hidden', dark);
    sun?.classList.toggle('hidden', !dark);
    const theme = getEl('hljsTheme');
    if (theme) theme.href = dark ? 'lib/atom-one-dark.min.css' : 'lib/atom-one-light.min.css';
};

function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
}

window.closeMobileSidebars = () => {
    if (!isMobile()) return;
    $.sidebar?.classList.remove('mobile-open');
    $.configPanel?.classList.remove('mobile-open');
    $.sidebarMask?.classList.remove('active');
};

function lockBodyScroll(lock) {
    if (lock) {
        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';
    } else {
        document.body.style.overflow = '';
        document.body.style.touchAction = '';
    }
}

window.closeAllSidebars = function () {
    $.sidebar?.classList.remove('mobile-open');
    $.configPanel?.classList.remove('mobile-open');
    $.agentPanel?.classList.add('hidden-panel');
    $.sidebarMask?.classList.remove('active');
    lockBodyScroll(false);
};

window.toggleSidebar = () => {
    if (isMobile()) {
        if ($.sidebar?.classList.contains('mobile-open')) {
            $.sidebar.classList.remove('mobile-open');
            $.sidebarMask?.classList.remove('active');
            lockBodyScroll(false);
        } else {
            $.sidebar?.classList.add('mobile-open');
            $.configPanel?.classList.remove('mobile-open');
            $.sidebarMask?.classList.add('active');
            lockBodyScroll(true);
        }
    } else {
        $.sidebar?.classList.toggle('collapsed');
        if ($.sidebarToggle) $.sidebarToggle.style.display = $.sidebar?.classList.contains('collapsed') ? 'block' : 'none';
    }
};

window.toggleConfigPanel = () => {
    // 如果当前正在与配置面板交互(输入框聚焦),不允许关闭
    const activeEl = document.activeElement;
    if (configPanelInteracting && activeEl && $.configPanel?.contains(activeEl) && activeEl.matches('input, textarea, select')) {
        return; // 输入框聚焦时禁止关闭
    }
    if (isMobile()) {
        if ($.configPanel?.classList.contains('mobile-open')) {
            $.configPanel.classList.remove('mobile-open');
            $.sidebarMask?.classList.remove('active');
            configPanelWasOpen = false;
            lockBodyScroll(false);
        } else {
            $.configPanel?.classList.remove('hidden-panel');
            $.configPanel?.classList.add('mobile-open');
            $.sidebar?.classList.remove('mobile-open');
            $.sidebarMask?.classList.add('active');
            configPanelWasOpen = true;
            lockBodyScroll(true);
        }
    } else {
        const isOpening = $.configPanel?.classList.contains('hidden-panel');
        $.configPanel?.classList.toggle('hidden-panel');
        // 打开时保存配置快照,关闭时清除
        if (isOpening) {
            configSnapshot = snapshotConfig();
            configPanelWasOpen = true;
        } else {
            configSnapshot = null;
            configPanelWasOpen = false;
        }
    }
};
// 图像按钮点击 - 触发图片上传(通用文件)
window.toggleImageConfig = () => {
    $.fileInput?.click();
};

// 图片上传按钮 - 触发图片选择(仅图片,移动端友好)
// 图片上传功能已整合到文件上传中

// 保存配置快照(localStorage 中的配置值)
function snapshotConfig() {
    const keys = ['apiKey', 'baseUrl', 'systemPrompt', 'model', 'temp', 'tokens', 'stream',
        'requestTimeout', 'customParams', 'customEnabled',
        'lineHeight', 'paragraphMargin', 'markdownGFM', 'markdownBreaks',
        'compress', 'threshold', 'compressModel', 'enableSearch', 'searchModel', 'searchProvider',
        'searchApiKey', 'searchRegion', 'searchTimeout', 'maxSearchResults', 'aiSearchJudge',
        'aiSearchJudgeModel', 'aiSearchJudgePrompt', 'enableSearchOptimize', 'fontSize',
        'searchType', 'aiSearchTypeToggle', 'searchShowPrompt', 'searchAppendToSystem'];
    const snapshot = {};
    keys.forEach(key => {
        const val = localStorage.getItem(key);
        if (val !== null) snapshot[key] = val;
    });
    return snapshot;
}

// 恢复配置快照
function restoreConfigSnapshot(snapshot) {
    if (!snapshot) return;
    // 先清除可能不存在于快照中的配置项
    const allKeys = ['apiKey', 'baseUrl', 'systemPrompt', 'model', 'temp', 'tokens', 'stream',
        'requestTimeout', 'customParams', 'customEnabled',
        'lineHeight', 'paragraphMargin', 'markdownGFM', 'markdownBreaks',
        'compress', 'threshold', 'compressModel', 'enableSearch', 'searchModel', 'searchProvider',
        'searchApiKey', 'searchRegion', 'searchTimeout', 'maxSearchResults', 'aiSearchJudge',
        'aiSearchJudgeModel', 'aiSearchJudgePrompt', 'enableSearchOptimize', 'fontSize',
        'searchType', 'aiSearchTypeToggle', 'searchShowPrompt', 'searchAppendToSystem'];
    allKeys.forEach(key => {
        if (snapshot.hasOwnProperty(key)) {
            localStorage.setItem(key, snapshot[key]);
        } else {
            localStorage.removeItem(key);
        }
    });
    // 重新加载配置到 UI
    initializeConfig();
    loadSearchConfig();
}

// 取消配置,恢复到打开面板时的状态
window.cancelConfig = () => {
    if (!configSnapshot) {
        // 没有快照,直接关闭面板
        $.configPanel?.classList.add('hidden-panel');
        configSnapshot = null;
        configPanelWasOpen = false;
        return;
    }
    // 恢复配置
    restoreConfigSnapshot(configSnapshot);
    // 关闭面板
    $.configPanel?.classList.add('hidden-panel');
    configSnapshot = null;
    configPanelWasOpen = false;
    showToast('已取消修改', 'info');
};

// 配置面板状态 - 用于防止键盘弹出时关闭面板
let configPanelWasOpen = false;

const handleResize = debounce(() => {
    const newWidth = window.innerWidth;
    const wasMobile = prevWidth <= MOBILE_BREAKPOINT;
    const nowMobile = newWidth <= MOBILE_BREAKPOINT;
    prevWidth = newWidth;

    if (wasMobile === nowMobile) return;

    // 只处理侧边栏,配置面板完全由用户手动控制,不自动关闭
    if (nowMobile) {
        $.sidebar?.classList.remove('mobile-open', 'collapsed');
        $.sidebarMask?.classList.remove('active');
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'block';
    } else {
        $.sidebar?.classList.remove('mobile-open', 'collapsed');
        $.sidebarMask?.classList.remove('active');
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
    }
}, 100);

// ==================== 配置管理 ====================
function createTitleModelSelector() {
    if (getEl('titleModel')) return;
    const sidebar = getEl('sidebar');
    const target = sidebar?.querySelector('.mt-6.pt-4');
    if (!target) return;
    const div = document.createElement('div');
    div.className = 'mt-4 pt-4 border-t border-gray-200 dark:border-gray-800 space-y-3';
    div.innerHTML = `
        <h3 class="text-xs font-bold text-gray-400 uppercase">标题生成</h3>
        <div class="flex items-center gap-2 text-xs">
            <span>标题模型:</span>
            <select id="titleModel" class="w-32 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full px-2 py-1 text-xs outline-none">
                <option value="">默认</option>
            </select>
        </div>
    `;
    sidebar.insertBefore(div, target);
    getEl('titleModel')?.addEventListener('change', e => localStorage.setItem('titleModel', e.target.value));
}

function createSearchConfigSection() {
    if (getEl('searchConfigItem')) return;
    const customParamsEl = getEl('customParams');
    const target = customParamsEl?.closest('div');
    if (!target) return;
    const section = document.createElement('div');
    section.id = 'searchConfigItem';
    section.className = 'config-item';
    section.innerHTML = `
        <div class="flex items-center justify-between py-3">
            <span class="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-[5px] whitespace-nowrap">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>联网搜索
            </span>
            <label class="switch small"><input type="checkbox" id="searchToggle"><span class="slider"></span></label>
        </div>
        <div class="flex items-center justify-between py-3">
            <span class="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-[5px] whitespace-nowrap">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>本地知识库
            </span>
            <label class="switch small"><input type="checkbox" id="ragToggle" checked><span class="slider"></span></label>
        </div>
        <div class="mt-4 pt-2 border-t border-gray-100 dark:border-gray-700" id="searchConfigDetails" style="display:none;">
            <div class="space-y-[18px]">
                <div class="flex items-center justify-between py-2">
                    <span class="text-xs text-gray-500 whitespace-nowrap">AI 判断</span>
                    <label class="switch small"><input type="checkbox" id="aiSearchJudgeToggle"><span class="slider"></span></label>
                </div>
                <div id="aiSearchJudgeDetails" style="display:none;">
                    <select id="aiSearchJudgeModel" class="config-input text-xs w-full py-[6px]" style="font-size:11px;"><option value="">同主模型</option></select>
                    <textarea id="aiSearchJudgePrompt" rows="2" class="config-input w-full text-xs mt-[8px]" style="font-size:11px;line-height:1.5;" placeholder="AI 判断提示词（启用 AI 判断后可见）"></textarea>
                </div>
                <div class="flex items-center justify-between py-2">
                    <span class="text-xs text-gray-500 whitespace-nowrap">引擎</span>
                    <select id="searchProvider" class="config-input text-xs" style="width:auto;min-width:80px;font-size:11px;padding:4px 8px;"><option value="duckduckgo">DuckDuckGo</option><option value="brave">Brave</option><option value="google">Google</option><option value="tavily">Tavily</option></select>
                </div>
                <div class="flex items-center gap-[10px] py-2">
                    <span class="text-xs text-gray-500 whitespace-nowrap" style="width:48px;flex-shrink:0;">API Key</span>
                    <input type="password" id="searchApiKey" class="config-input flex-1 text-xs" style="font-size:11px;padding:4px 8px;" placeholder="当前引擎 Key">
                </div>
                <details class="text-xs py-2">
                    <summary class="cursor-pointer text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xs">各引擎 Key</summary>
                    <div class="mt-[10px] space-y-[8px] pl-[4px]">
                        <div class="flex items-center gap-[10px]"><span class="text-xs text-gray-500 whitespace-nowrap" style="width:48px;flex-shrink:0;">Brave</span><input type="password" id="searchApiKeyBrave" class="config-input flex-1 text-xs" style="font-size:11px;padding:4px 8px;" placeholder="Key"></div>
                        <div class="flex items-center gap-[10px]"><span class="text-xs text-gray-500 whitespace-nowrap" style="width:48px;flex-shrink:0;">Google</span><input type="password" id="searchApiKeyGoogle" class="config-input flex-1 text-xs" style="font-size:11px;padding:4px 8px;" placeholder="Key"></div>
                        <div class="flex items-center gap-[10px]"><span class="text-xs text-gray-500 whitespace-nowrap" style="width:48px;flex-shrink:0;">Tavily</span><input type="password" id="searchApiKeyTavily" class="config-input flex-1 text-xs" style="font-size:11px;padding:4px 8px;" placeholder="Key"></div>
                    </div>
                </details>
                <div class="flex items-center justify-between py-2">
                    <span class="text-xs text-gray-500 whitespace-nowrap">地区</span>
                    <input type="text" id="searchRegion" class="config-input text-xs" style="font-size:11px;width:60px;padding:4px 8px;" placeholder="cn">
                </div>
                <div class="flex items-center justify-between py-2">
                    <span class="text-xs text-gray-500 whitespace-nowrap">类型</span>
                    <select id="searchType" class="config-input text-xs" style="width:auto;min-width:65px;font-size:11px;padding:4px 8px;"><option value="auto">自动</option><option value="web">网页</option><option value="news">新闻</option></select>
                </div>
                <div class="flex items-center justify-between py-2">
                    <span class="text-xs text-gray-500 whitespace-nowrap">自动判断类型</span>
                    <label class="switch small"><input type="checkbox" id="aiSearchTypeToggle"><span class="slider"></span></label>
                </div>
                <div class="flex items-center justify-between py-2">
                    <span class="text-xs text-gray-500 whitespace-nowrap">搜索提示</span>
                    <label class="switch small"><input type="checkbox" id="searchShowPromptToggle"><span class="slider"></span></label>
                </div>
                <div class="flex items-center justify-between py-2">
                    <span class="text-xs text-gray-500 whitespace-nowrap">保存到系统</span>
                    <label class="switch small"><input type="checkbox" id="searchAppendToSystem"><span class="slider"></span></label>
                </div>
                <div class="py-2">
                    <div class="flex items-center justify-between mb-[6px]"><span class="text-xs text-gray-500 whitespace-nowrap">超时 <span id="searchTimeoutValue">30</span>s</span></div>
                    <input type="range" id="searchTimeout" min="5" max="120" step="5" class="w-full" oninput="updateSearchParam('timeout',this.value)">
                </div>
                <div class="py-2">
                    <div class="flex items-center justify-between mb-[6px]"><span class="text-xs text-gray-500 whitespace-nowrap">结果数 <span id="maxSearchResultsValue">3</span></span></div>
                    <input type="range" id="maxSearchResults" min="1" max="10" step="1" class="w-full" oninput="updateSearchParam('results',this.value)">
                </div>
            </div>
        </div>`;
    target.parentNode.insertBefore(section, target.nextSibling);
    loadSearchConfig();
    bindSearchEvents();
}

function bindSearchEvents() {
    getEl('searchToggle')?.addEventListener('change', function (e) {
        getEl('searchConfigDetails').style.display = this.checked ? 'block' : 'none';
        updateSearchButtonState(this.checked);
    });
    getEl('ragToggle')?.addEventListener('change', function() {
        localStorage.setItem('ragEnabled', this.checked);
        window.RAG_ENABLED = this.checked;
    });
    getEl('aiSearchJudgeToggle')?.addEventListener('change', function () {
        getEl('aiSearchJudgeDetails').style.display = this.checked ? 'block' : 'none';
    });
    ['aiSearchJudgeModel', 'aiSearchJudgePrompt', 'searchProvider', 'searchRegion', 'searchTimeout', 'maxSearchResults', 'searchType', 'aiSearchTypeToggle', 'searchShowPromptToggle', 'searchAppendToSystem', 'searchToolCallToggle'].forEach(id => {
        const el = getEl(id);
        if (el) {
            el.addEventListener('change', function() { saveConfig(); });
        }
    });
    // ★ 搜索 API Key 变更时自动保存（密码框 input 事件）
    ['searchApiKey', 'searchApiKeyBrave', 'searchApiKeyGoogle', 'searchApiKeyTavily'].forEach(function(id) {
        var el = getEl(id);
        if (el) {
            el.addEventListener('change', function() { saveConfig(); });
            el.addEventListener('input', function() { saveConfig(); });
        }
    });
    // 工具调用模式切换时显示/隐藏提示和AI判断选项
    getEl("searchToolCallToggle")?.addEventListener("change", function() {
        updateToolModeBtn();
    });
}

function loadSearchConfig() {
    setChecked('searchToggle', localStorage.getItem('enableSearch') === 'true');
    setChecked('searchToolCallToggle', localStorage.getItem('searchToolCall') !== 'false');
    setChecked('aiSearchJudgeToggle', localStorage.getItem('aiSearchJudge') !== 'false');
    var ragChecked = localStorage.getItem('ragEnabled') !== 'false';
    setChecked('ragToggle', ragChecked);
    window.RAG_ENABLED = ragChecked;
    setVal('aiSearchJudgeModel', localStorage.getItem('aiSearchJudgeModel') || 'deepseek-chat');
    setVal('aiSearchJudgePrompt', localStorage.getItem('aiSearchJudgePrompt') || DEFAULT_CONFIG.aiSearchJudgePrompt);
    setVal('searchProvider', localStorage.getItem('searchProvider') || 'duckduckgo');
    // 优先使用当前引擎的独立Key,否则用通用Key
    const provider = localStorage.getItem('searchProvider') || 'duckduckgo';
    const providerKeyMap = { brave: 'searchApiKeyBrave', google: 'searchApiKeyGoogle', tavily: 'searchApiKeyTavily' };
    const providerKey = providerKeyMap[provider];
    const savedProviderKey = providerKey ? localStorage.getItem(providerKey) : null;
    const savedGeneralKey = localStorage.getItem('searchApiKey');
    if (providerKey && savedProviderKey) {
        setVal('searchApiKey', decrypt(savedProviderKey));
    } else if (savedGeneralKey) {
        setVal('searchApiKey', decrypt(savedGeneralKey));
    } else {
        setVal('searchApiKey', '');
    }
    // 加载各引擎独立Key
    setVal('searchApiKeyBrave', decrypt(localStorage.getItem('searchApiKeyBrave') || ''));
    setVal('searchApiKeyGoogle', decrypt(localStorage.getItem('searchApiKeyGoogle') || ''));
    setVal('searchApiKeyTavily', decrypt(localStorage.getItem('searchApiKeyTavily') || ''));
    setVal('searchRegion', localStorage.getItem('searchRegion') || '');
    setVal('searchTimeout', localStorage.getItem('searchTimeout') || '30');
    setVal('maxSearchResults', localStorage.getItem('maxSearchResults') || '3');
    setVal('searchType', localStorage.getItem('searchType') || 'auto');
    setChecked('aiSearchTypeToggle', localStorage.getItem('aiSearchTypeToggle') !== 'false');
    setChecked('searchShowPromptToggle', localStorage.getItem('searchShowPrompt') === 'true');
    setChecked('searchAppendToSystem', localStorage.getItem('searchAppendToSystem') !== 'false');

    const timeoutSpan = getEl('searchTimeoutValue');
    if (timeoutSpan) timeoutSpan.textContent = getVal('searchTimeout');
    const resultsSpan = getEl('maxSearchResultsValue');
    if (resultsSpan) resultsSpan.textContent = getVal('maxSearchResults');

    getEl('searchConfigDetails').style.display = getChecked('searchToggle') ? 'block' : 'none';
    getEl('aiSearchJudgeDetails').style.display = getChecked('aiSearchJudgeToggle') ? 'block' : 'none';
    updateSearchButtonState(getChecked('searchToggle'));
}

window.updateSearchParam = (type, val) => {
    if (type === 'timeout') {
        const span = getEl('searchTimeoutValue');
        if (span) span.innerText = val;
    } else if (type === 'results') {
        const span = getEl('maxSearchResultsValue');
        if (span) span.innerText = val;
    }
    // ★ 不自动保存，由"保存配置"按钮统一控制
};

function initFontSize() {
    const sz = localStorage.getItem('fontSize') || '14';
    setVal('fontSize', sz);
    const span = getEl('fontSizeValue');
    if (span) span.innerText = sz;
    const range = getEl('fontSize');
    if (range) range.value = sz;
    document.documentElement.style.setProperty('--chat-font-size', sz + 'px');
}

window.updateFontSize = function(val) {
    const span = getEl('fontSizeValue');
    if (span) span.innerText = val;
    document.documentElement.style.setProperty('--chat-font-size', val + 'px');
    localStorage.setItem('fontSize', val);
};


// ★ 工具模式切换（输入框旁快捷按钮）
window.toggleToolMode = function() {
    var cur = getChecked("searchToolCallToggle");
    setChecked("searchToolCallToggle", !cur);
    localStorage.setItem("searchToolCall", !cur);
    updateToolModeBtn();
    showToast(!cur ? "🔧 工具模式已开启" : "🔧 工具模式已关闭", "info", 1500);
};

window.updateToolModeBtn = function() {
    var btn = getEl("toolModeBtn");
    if (!btn) return;
    if (getChecked("searchToolCallToggle")) {
        btn.className = "p-2 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 transition";
        btn.title = "工具模式: 开";
    } else {
        btn.className = "p-2 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-400 transition";
        btn.title = "工具模式: 关";
    }
};

window.initToolModeBtn = function() { updateToolModeBtn(); };

// ★ Agent 模式切换
var agentModeToolCallsMap = {};

window.toggleAgentMode = function() {
    var isActive = localStorage.getItem('agentMode') === 'true';
    var newVal = !isActive;
    localStorage.setItem('agentMode', newVal);
    updateAgentUI();
    if (newVal) {
        // 开启 Agent 模式时自动打开代理面板
        window.openAgentPanel();
    }
    showToast(newVal ? '🧠 Agent 模式已开启' : '🧠 Agent 模式已关闭', 'info', 1500);
};

// ==================== 代理面板控制 ====================
window.openAgentPanel = function() {
    var ap = $.agentPanel || getEl('agentPanel');
    var cp = $.configPanel || getEl('configPanel');
    if (!ap) return;

    if (isMobile()) {
        // 移动端：关配置面板，用遮罩
        if (cp) cp.classList.remove('mobile-open');
        ap.style.display = '';
        ap.classList.remove('hidden-panel');
        $.sidebarMask?.classList.add('active');
        lockBodyScroll(true);
        window.refreshAgentPanel();
        // 启动定时刷新
        startAgentPanelRefresh();
        return;
    }

    // 桌面端：先关配置面板
    if (cp && !cp.classList.contains('hidden-panel')) {
        cp.classList.add('hidden-panel');
    }
    // 确保 display 可见，然后移除隐藏类
    ap.style.display = '';
    // 使用 requestAnimationFrame 确保布局正确
    requestAnimationFrame(function() {
        ap.classList.remove('hidden-panel');
    });
    // 清除非通知红点
    var dot = getEl('agentNotifDot');
    if (dot) dot.classList.remove('show');
    window.refreshAgentPanel();
    startAgentPanelRefresh();
};

window.closeAgentPanel = function() {
    var ap = $.agentPanel || getEl('agentPanel');
    if (!ap) return;

    if (isMobile()) {
        ap.classList.add('hidden-panel');
        $.sidebarMask?.classList.remove('active');
        lockBodyScroll(false);
        if (_agentPanelRefreshTimer) {
            clearInterval(_agentPanelRefreshTimer);
            _agentPanelRefreshTimer = null;
        }
        return;
    }

    ap.classList.add('hidden-panel');
    if (_agentPanelRefreshTimer) {
        clearInterval(_agentPanelRefreshTimer);
        _agentPanelRefreshTimer = null;
    }
    // 过渡结束后隐藏 display（否则 CSS transition 不生效）
    setTimeout(function() {
        if (ap.classList.contains('hidden-panel')) {
            ap.style.display = 'none';
        }
    }, 350);
};

// 启动代理面板定时刷新
function startAgentPanelRefresh() {
    if (_agentPanelRefreshTimer) clearInterval(_agentPanelRefreshTimer);
    _agentPanelRefreshTimer = setInterval(function() {
        var ap = $.agentPanel || getEl('agentPanel');
        if (!ap || ap.classList.contains('hidden-panel')) {
            clearInterval(_agentPanelRefreshTimer);
            _agentPanelRefreshTimer = null;
            return;
        }
        // 刷新代理列表
        window.refreshAgentPanel();
        // 如果选中了代理，同步刷新聊天内容
        if (_selectedAgentName) {
            // 实时拉取引擎数据，不依赖 localStorage
            var token = getAuthToken();
            if (token) {
                fetch('/oneapichat/engine_api.php?action=agent_list&auth_token=' + token, { signal: AbortSignal.timeout(5000) })
                    .then(function(r) { return r.json(); })
                    .then(function(agents) {
                        var a = agents[_selectedAgentName];
                        var msgArea = getEl('agentChatMessages');
                        if (!msgArea) return;
                        if (!a) { msgArea.innerHTML = '<div class="text-xs text-gray-400 p-2">代理不存在</div>'; return; }
                        if (a.status === 'running') {
                            msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant"><div class="text-xs text-green-500 font-medium">🟢 正在运行中...</div></div>';
                            return;
                        }
                        if (a.result) {
                            msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant">' +
                                '<div class="text-xs text-gray-400 mb-1">' + escapeHtml(_selectedAgentName) + '</div>' +
                                '<div class="text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300">' + escapeHtml(a.result.substring(0, 3000)) + '</div></div>';
                            // 保存到 localStorage
                            var key = 'agent_chat_' + _selectedAgentName;
                            localStorage.setItem(key, JSON.stringify([{ role: 'assistant', content: a.result, time: Date.now() }]));
                        } else if (a.error) {
                            msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant"><div class="text-xs text-red-500">❌ ' + escapeHtml(a.error) + '</div></div>';
                        }
                    }).catch(function(err) {
                        var msgArea = getEl('agentChatMessages');
                        if (msgArea && _selectedAgentName) {
                            msgArea.innerHTML = '<div class="text-xs text-orange-400 p-2">连接引擎失败: ' + escapeHtml(err.message) + '</div>';
                        }
                    });
            }
        }
    }, 5000);
}

window.toggleAgentPanel = function() {
    var ap = $.agentPanel || getEl('agentPanel');
    if (!ap) return;
    if (ap.classList.contains('hidden-panel')) {
        window.openAgentPanel();
    } else {
        window.closeAgentPanel();
    }
};

window._agentListCache = {};

window._renderAgentList = function(agents, container) {
    if (!container) return;
    var names = Object.keys(agents);
    if (names.length === 0) {
        container.innerHTML = '<div class="text-xs text-gray-400 p-2">暂无子代理</div>';
        return;
    }
    // ★ 角色颜色映射
    var roleColors = {'explorer':'#27AE60','planner':'#F39C12','developer':'#E74C3C','verifier':'#9B59B6','general':'#4A90D9'};
    var roleLabels = {'explorer':'🔍搜','planner':'📐规','developer':'⚡开','verifier':'✅验','general':'🌐全'};
    container.innerHTML = names.map(function(name) {
        var a = agents[name];
        var dotClass = a.status === 'running' ? 'running' : a.status === 'completed' ? 'completed' : a.status === 'failed' ? 'offline' : 'idle';
        var preview = '';
        if (a.result) {
            preview = '<div class="text-xs text-gray-400 truncate mt-0.5" style="font-size:10px;">' + escapeHtml(a.result.substring(0, 50)) + '</div>';
        } else if (a.error) {
            preview = '<div class="text-xs text-red-400 truncate mt-0.5" style="font-size:10px;">' + escapeHtml(a.error.substring(0, 50)) + '</div>';
        }
        var safeName = escapeHtml(name);
        var statusColor = a.status==='completed'?'#6366f1' : a.status==='failed'?'#ef4444' : a.status==='running'?'#10b981' : '#9ca3af';
        var role = a.role || 'general';
        var roleColor = roleColors[role] || '#9ca3af';
        var roleLabel = roleLabels[role] || role;
        return '<div class="agent-sub-item" onclick="window.selectAgentChat(\'' + safeName + '\')">' +
            '<div class="flex items-center gap-2 min-w-0 flex-1">' +
                '<span class="agent-sub-dot ' + dotClass + '"></span>' +
                '<div class="min-w-0 flex-1">' +
                    '<span class="text-xs font-medium truncate block">' + safeName + '</span>' +
                    '<div class="flex gap-1 items-center mt-0.5">' +
                        '<span class="text-xs" style="color:' + roleColor + ';font-weight:500;">' + roleLabel + '</span>' +
                        (preview || '<span class="text-xs text-gray-400" style="font-size:10px;">' + (a.status || 'idle') + '</span>') +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="flex items-center gap-1 flex-shrink-0">' +
                '<span class="text-xs" style="color:' + statusColor + ';font-weight:500;font-size:10px;">' + (a.status || 'idle') + '</span>' +
                '<button onclick="event.stopPropagation();window.deleteAgent(\'' + safeName + '\');window._refreshAllAgentLists();" class="p-1 text-gray-400 hover:text-red-500 transition" title="删除子代理"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>' +
            '</div>' +
        '</div>';
    }).join('');
};

window._refreshAllAgentLists = async function() {
    var token = getAuthToken();
    if (!token) return;
    try {
        var r = await fetch('/oneapichat/engine_api.php?action=agent_list&auth_token=' + token, { signal: AbortSignal.timeout(5000) });
        var agents = await r.json();
        // 验证返回的数据是有效对象
        if (typeof agents !== 'object' || agents === null || Array.isArray(agents)) {
            throw new Error('引擎返回无效数据');
        }
        window._agentListCache = agents;
        window._agentListCacheTime = Date.now();
        window._renderAgentList(agents, getEl('agentSubList'));
        window._renderAgentList(agents, getEl('engineAgentList'));
    } catch(e) {
        // 显示错误但不中断，保留上次缓存
        var msg = '加载失败: ' + e.message;
        var lists = ['agentSubList', 'engineAgentList'];
        lists.forEach(function(id) {
            var el = getEl(id);
            if (el) el.innerHTML = '<div class="text-xs text-gray-500 p-2" style="font-size:10px;">' + escapeHtml(msg) + '</div>';
        });
        // 如果缓存超过30秒，清除缓存避免展示过时数据
        if (window._agentListCacheTime && Date.now() - window._agentListCacheTime > 30000) {
            window._agentListCache = {};
        }
        console.warn('[AgentPanel] 刷新失败:', e.message);
    }
};

window.refreshAgentPanel = window._refreshAllAgentLists;

window.selectAgentChat = function(agentName) {
    _selectedAgentName = agentName;
    getEl('agentChatTitle').innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg> ' + escapeHtml(agentName);
    var msgArea = getEl('agentChatMessages');
    // 从 localStorage 读取该代理的聊天记录
    var key = 'agent_chat_' + agentName;
    var msgs = JSON.parse(localStorage.getItem(key) || '[]');
    if (msgs.length === 0) {
        var token = getAuthToken();
        if (!token) { msgArea.innerHTML = '<div class="text-xs text-gray-400">请先登录</div>'; return; }
        msgArea.innerHTML = '<div class="text-xs text-gray-400">获取中...</div>';
        fetch('/oneapichat/engine_api.php?action=agent_list&auth_token=' + token, { signal: AbortSignal.timeout(5000) })
            .then(function(r) { return r.json(); })
            .then(function(agents) {
                var a = agents[agentName];
                if (!a) { msgArea.innerHTML = '<div class="text-xs text-gray-400">代理不存在（可能已被删除）</div>'; return; }
                if (a.status === 'running') {
                    var partial = a.result || '';
                    if (partial) {
                        msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant">' +
                            '<div class="text-xs text-green-500 font-medium mb-1">🟡 运行中，已生成内容：</div>' +
                            '<div class="text-xs whitespace-pre-wrap text-gray-600 dark:text-gray-300" style="font-size:11px;max-height:300px;overflow-y:auto;">' + escapeHtml(partial.substring(0, 2000)) + '</div>' +
                            '<div class="text-xs text-gray-400 mt-1">轮询刷新中...</div></div>';
                    } else {
                        msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant"><div class="text-xs text-green-500 font-medium">🟢 正在运行中...</div></div>';
                    }
                    return;
                }
                if (a.result) {
                        var rEl = getEl('agentChatMessages');
                        if (rEl) {
                            rEl.innerHTML = '<div class="agent-chat-bubble role-assistant">' +
                                '<div class="text-xs text-gray-400 mb-1">' + escapeHtml(agentName) + '</div>' +
                                '<div class="text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300">' + escapeHtml(a.result.substring(0, 3000)) + '</div>' +
                                '</div>';
                        }
                        var ms = [{ role: 'assistant', content: a.result, time: Date.now() }];
                        localStorage.setItem(key, JSON.stringify(ms));
                    }
                }).catch(function(err) {
                    msgArea.innerHTML = '<div class="text-xs text-red-400 p-2">加载失败: ' + escapeHtml(err.message) + '</div>';
                });
        return;
    } else {
        msgArea.innerHTML = msgs.map(function(m) {
            var roleClass = m.role === 'user' ? 'role-user' : 'role-assistant';
            return '<div class="agent-chat-bubble ' + roleClass + '">' +
                '<div class="text-xs text-gray-400 mb-1">' + (m.role === 'user' ? '你' : escapeHtml(agentName)) + ' · ' + new Date(m.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) + '</div>' +
                '<div class="text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300">' + escapeHtml(m.content || '') + '</div>' +
                '</div>';
        }).join('');
    }
};

window.mainAgentReply = function() {
    var statusEl = getEl('agentReplyStatus');
    if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.textContent = '正在触发主代理思考...';
    }
    // 收集所有子代理的最新结果
    var token = getAuthToken();
    fetch('/oneapichat/engine_api.php?action=agent_notifications&auth_token=' + token, { signal: AbortSignal.timeout(5000) })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.count === 0) {
                if (statusEl) statusEl.textContent = '没有新的子代理结果';
                return;
            }
            var summary = data.notifications.map(function(n) {
                return '「' + n.agent + '」' + (n.status === 'completed' ? '完成' : '失败') + ': ' + (n.result || n.error || '').substring(0, 120);
            }).join('\n');
            // 标记已处理
            fetch('/oneapichat/engine_api.php?action=agent_notifications_mark&auth_token=' + token);
            if (statusEl) statusEl.textContent = '✅ ' + data.count + ' 条新结果(已在聊天框中)';
        }).catch(function() {
            if (statusEl) statusEl.textContent = '❌ 请求失败';
        });
};

function updateAgentUI() {
    var isActive = localStorage.getItem('agentMode') === 'true';
    // Header 按钮（分离按钮：左边Agent模式，右边代理聊天室）
    var splitBtn = getEl('agentSplitBtn');
    if (splitBtn) {
        splitBtn.classList.toggle('active', isActive);
    }
    // 配置面板开关
    var configToggle = getEl('agentModeToggle');
    if (configToggle) {
        configToggle.checked = isActive;
    }
    // 输入区横幅
    var banner = getEl('agentBanner');
    if (banner) {
        banner.classList.toggle('visible', isActive);
    }
    // ★ Agent 模式下自动启用工具调用，隐藏工具调用开关
    var toolCallToggle = getEl('searchToolCallToggle');
    var toolCallRow = toolCallToggle ? toolCallToggle.closest('.config-toggle-row') : null;
    if (isActive) {
        if (toolCallToggle && !toolCallToggle.checked) {
            toolCallToggle.checked = true;
            localStorage.setItem('searchToolCall', 'true');
        }
        if (toolCallRow) {
            toolCallRow.style.opacity = '0.5';
            toolCallRow.style.pointerEvents = 'none';
            toolCallRow.title = 'Agent 模式下自动启用工具调用';
        }
        // 启动心跳轮询
        window.startAgentNotificationPolling();
    } else {
        if (toolCallRow) {
            toolCallRow.style.opacity = '1';
            toolCallRow.style.pointerEvents = 'auto';
            toolCallRow.title = '';
        }
    }
}

// ★ Agent 主动建议功能
async function generateProactiveSuggestions(chatId, lastResponse) {
    if (!chatId || !lastResponse) return;
    var isActive = localStorage.getItem('agentMode') === 'true';
    var proactive = localStorage.getItem('agentProactive') === 'true';  // default false
    if (!isActive || !proactive) return;
    
    var bubble = activeBubbleMap[chatId];
    if (!bubble) return;
    
    try {
        var recentHistory = chats[chatId].messages.slice(-4).map(function(m) {
            return (m.role === 'user' ? '用户: ' : 'AI: ') + (typeof m.content === 'string' ? m.content.substring(0, 200) : '');
        }).join('\n');
        
        var suggestionPrompt = {
            role: 'user',
            content: '基于最近对话:\n' + recentHistory + '\n\n请给出2-3个简短、具体的后续行动建议(每行一个,用-开头,每个不超过50字)。只返回建议列表。'
        };
        
        var model = getVal('modelSelect') || DEFAULT_CONFIG.model;
        var resp = await fetch((localStorage.getItem('baseUrl') || DEFAULT_CONFIG.url) + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (localStorage.getItem('apiKey') || DEFAULT_CONFIG.key)
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: '你是一个AI助手的建议模块。基于最近对话,给出后续行动的简短建议。简洁,每条不超过50字。' },
                    suggestionPrompt
                ],
                stream: false,
                temperature: 0.7,
                max_tokens: 300
            })
        });
        
        if (!resp.ok) return;
        var data = await resp.json();
        var content = data.choices?.[0]?.message?.content || '';
        var suggestions = content.split('\n').filter(function(l) {
            return l.trim().startsWith('-') || l.trim().match(/^\d+\./);
        }).map(function(l) {
            return l.replace(/^[-\s\d.]+/, '').trim();
        }).filter(function(s) { return s.length > 3; }).slice(0, 3);
        
        if (suggestions.length === 0) return;
        
        var markdownBody = bubble.querySelector('.markdown-body');
        if (!markdownBody) return;
        
        var suggestionsDiv = document.createElement('div');
        suggestionsDiv.className = 'agent-suggestions';
        var label = document.createElement('div');
        label.className = 'agent-suggestions-label';
        label.textContent = '💡 后续建议:';
        suggestionsDiv.appendChild(label);
        
        suggestions.forEach(function(s) {
            var btn = document.createElement('button');
            btn.className = 'agent-suggestion-btn';
            btn.textContent = s.substring(0, 40);
            btn.onclick = function() {
                var input = $.userInput;
                if (input) {
                    input.value = s;
                    window.autoResize(input);
                    input.focus();
                }
            };
            suggestionsDiv.appendChild(btn);
        });
        
        markdownBody.appendChild(suggestionsDiv);
    } catch(e) {
        // 静默失败,不干扰主对话
    }
}

// ★ 引擎健康检查
window.deleteCron = async function(name) {
    if (!confirm('确定要删除 cron 任务 "' + name + '" 吗？')) return;
    try {
        var r = await fetch('/oneapichat/engine_api.php?action=cron_delete&auth_token=' + getAuthToken() + '&name=' + encodeURIComponent(name), { signal: AbortSignal.timeout(5000) });
        var d = await r.json();
        if (d.ok) {
            window.refreshEngineStatus();
        } else {
            alert('删除失败: ' + (d.error || '未知错误'));
        }
    } catch(e) {
        alert('删除请求失败: ' + e.message);
    }
};

window.deleteCron = async function(name) {
    if (!confirm('确定要删除 cron 任务 "' + name + '" 吗？')) return;
    try {
        var r = await fetch('/oneapichat/engine_api.php?action=cron_delete&auth_token=' + getAuthToken() + '&name=' + encodeURIComponent(name), { signal: AbortSignal.timeout(5000) });
        var d = await r.json();
        if (d.ok) {
            window.refreshEngineStatus();
        } else {
            alert('删除失败: ' + (d.error || '未知错误'));
        }
    } catch(e) {
        alert('删除请求失败: ' + e.message);
    }
};

// ★ 主代理通知系统：子代理完成后通知主代理
// 防重复 + 冷却 + 预处理结果 + 禁止创建新子代理，杜绝无限循环
window._agentNotifyQueue = [];
window._agentNotifyProcessing = false;
window._hasPendingSubAgentNotify = false;
window._currentGroupId = 0;
window._activeSubAgentGroup = [];
window._pendingSubAgentResults = [];
window._subAgentCooldownActive = false;
window._lastSubAgentReportTime = 0;

// 30秒冷却，防止子代理完成→创建新子代理的无限循环
const SUB_AGENT_COOLDOWN_MS = 30000;

window._processAgentNotifyQueue = async function() {
    // ★ 防御性初始化
    if (!Array.isArray(window._agentNotifyQueue)) { window._agentNotifyQueue = []; }
    if (window._agentNotifyQueue.length === 0) return;
    
    // 冷却检查
    var now = Date.now();
    if (now - window._lastSubAgentReportTime < SUB_AGENT_COOLDOWN_MS) {
        // 还处于冷却期，但通知已在上方被收集（因为 queue 不为空）
        // 延迟后再处理
        setTimeout(function() { window._processAgentNotifyQueue(); }, SUB_AGENT_COOLDOWN_MS);
        return;
    }
    
    // 如果主代理正在生成回复（sendMessage 已激活），则暂不处理
    // 等 sendMessage 完成后 sendMessage 本身会调用 processAgentNotifyQueue
    if (window._agentNotifyProcessing) {
        // 标记：有新通知在等待，等主代理空闲后统一处理
        window._hasPendingSubAgentNotify = true;
        return;
    }
    
    // ★ 批量合并队列中的所有通知（不论几个子代理同时完成，只生成一条上下文）
    // ★ 只收集属于当前批次的子代理（同一任务创建的才算，过期的忽略）
    var currentGroupId = window._currentGroupId || 0;
    var activeGroup = window._activeSubAgentGroup || [];
    var activeNames = activeGroup.filter(function(item) { return item.groupId === currentGroupId; }).map(function(item) { return item.name; });
    
    var agents = [];
    while (window._agentNotifyQueue.length > 0) {
        var item = window._agentNotifyQueue.shift();
        // 只收录属于当前活跃批次的子代理通知
        if (item && item.agentName && agents.indexOf(item.agentName) === -1 && activeNames.indexOf(item.agentName) !== -1) {
            agents.push(item.agentName);
        }
    }
    if (agents.length === 0) {
        // 没有同批次通知，但队列可能还有旧批次的通知，直接丢弃它们防止累积
        window._agentNotifyQueue = [];
        return;
    }
    
    window._agentNotifyProcessing = true;
    window._lastSubAgentReportTime = now;
    window._hasPendingSubAgentNotify = false;
    
    // 获取所有子代理的完成结果
    var results = [];
    var token = getAuthToken();
    if (token) {
        try {
            var r = await fetch('/oneapichat/engine_api.php?action=agent_list&auth_token=' + token, { signal: AbortSignal.timeout(5000) });
            var allAgents = await r.json();
            agents.forEach(function(name) {
                var a = allAgents[name];
                if (a) {
                    var preview = (a.result || a.error || '').substring(0, 1000);
                    results.push('「' + name + '」状态=' + a.status + (preview ? '\n结果预览: ' + preview : ''));
                } else {
                    results.push('「' + name + '」未找到');
                }
            });
        } catch(e) {
            results.push('获取子代理结果失败: ' + e.message);
        }
    }
    
    var agentCount = agents.length;
    var summaryLine = agentCount === 1 ? '1 个子代理已完成' : agentCount + ' 个子代理已完成';
    
    // ★ 核心：合并后的上下文，一次注入
    var ctx = '## ⚡ 子代理完成报告（' + summaryLine + '）\n' +
        '以下子代理已完成，请整合这些信息备用：\n' + results.join('\n---\n') + '\n\n' +
        '### 🔒 硬性规则\n' +
        '1. 绝对禁止调用 agent_create / agent_run / delegate_task 等任何创建子代理的工具。\n' +
        '2. 这条消息是系统通知，不需要回复用户，只需要静默记录结果。\n' +
        '3. 如用户提问涉及这些子代理的结果，可以直接引用回答，无需重复调用子代理。';
    
    if (typeof window.sendMessage === 'function') {
        window.__internalAgentContext = ctx;
        window.sendMessage(true, '');  // 传空字符串，主代理识别后静默处理
    }
    
    // 解锁（等 sendMessage 完全结束后再解锁）
    setTimeout(function() {
        window._agentNotifyProcessing = false;
        // 如果期间有新通知进来，继续处理
        if (window._hasPendingSubAgentNotify || (Array.isArray(window._agentNotifyQueue) && window._agentNotifyQueue.length > 0)) {
            window._hasPendingSubAgentNotify = false;
            setTimeout(function() { window._processAgentNotifyQueue(); }, 500);
        }
    }, 8000);
};

window.triggerAgentAutoReplyForSubAgent = function(agentName) {
    if (!agentName) return;
    if (!Array.isArray(window._agentNotifyQueue)) { window._agentNotifyQueue = []; }
    
    // 冷却期内收到通知，直接合并到队列但不触发新请求
    var now = Date.now();
    if (now - window._lastSubAgentReportTime < SUB_AGENT_COOLDOWN_MS) {
        // 如果队列中没有这个代理，加入队列
        var exists = window._agentNotifyQueue.some(function(item) { return item.agentName === agentName; });
        if (!exists) {
            window._agentNotifyQueue.push({ agentName: agentName });
        }
        return;
    }
    
    // 记录待处理的子代理结果，避免重复触发
    if (!Array.isArray(window._pendingSubAgentResults)) { window._pendingSubAgentResults = []; }
    if (window._pendingSubAgentResults.indexOf(agentName) !== -1) {
        return;
    }
    window._pendingSubAgentResults.push(agentName);
    
    // 如果主代理正在生成，排队
    var chatId = currentChatId;
    if (!chatId || !chats[chatId]) {
        createNewChat();
        chatId = currentChatId;
        if (!chatId) return;
    }
    
    if (isTypingMap[chatId]) {
        window._agentNotifyQueue.push({ agentName: agentName });
        return;
    }
    
    // 添加到队列并处理
    window._agentNotifyQueue.push({ agentName: agentName });
    window._processAgentNotifyQueue();
};

window.triggerAgentAutoReply = function(summary, chatId) {
    // 旧接口，保留兼容但不再使用
};

window.deleteAgent = async function(name) {
    if (!confirm('确定要删除子代理 "' + name + '" 吗？此操作不可撤销。')) return;
    try {
        var r = await fetch('/oneapichat/engine_api.php?action=agent_delete&auth_token=' + getAuthToken() + '&name=' + encodeURIComponent(name), { signal: AbortSignal.timeout(5000) });
        var d = await r.json();
        if (d.ok) {
            window.refreshEngineStatus();
        } else {
            alert('删除失败: ' + (d.error || '未知错误'));
        }
    } catch(e) {
        alert('删除请求失败: ' + e.message);
    }
};

window.refreshEngineStatus = async function() {
    var dot = getEl('engineHealthDot');
    var text = getEl('engineHealthText');
    if (!dot || !text) return;
    
    dot.className = 'engine-status-dot offline';
    text.textContent = '检查中...';
    
    try {
        var resp = await fetch('/oneapichat/engine_api.php?action=health&auth_token=' + getAuthToken(), { signal: AbortSignal.timeout(5000) });
        var data = await resp.json();
        
        if (data.ok || data.status === 'ok' || data.status === 'running') {
            dot.className = 'engine-status-dot online';
            text.textContent = '🟢 引擎在线';
        } else {
            dot.className = 'engine-status-dot offline';
            text.textContent = '🔴 引擎异常: ' + (data.message || '未知');
        }
    } catch(e) {
        dot.className = 'engine-status-dot offline';
        text.textContent = '🔴 引擎离线 (' + e.message + ')';
    }
    
    // 加载 cron 列表
    var cronList = getEl('engineCronList');
    if (cronList) {
        try {
            var cronResp = await fetch('/oneapichat/engine_api.php?action=cron_list&auth_token=' + getAuthToken(), { signal: AbortSignal.timeout(5000) });
            var cronData = await cronResp.json();
            // 引擎返回 {job_name: {...}} 格式，转换为数组
            var cronJobs = Object.keys(cronData).map(function(k) { return cronData[k]; });
            var runningJobs = cronJobs.filter(function(j) { return j.enabled; });
            if (runningJobs.length > 0) {
                cronList.innerHTML = runningJobs.map(function(j) {
                    var next = j.next_run ? new Date(j.next_run * 1000).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '--';
                    var name = escapeHtml(j.name);
                    return '<div class="engine-status-item" style="display:flex;align-items:center;justify-content:space-between;"><div><span class="engine-status-dot running"></span><span style="font-size:11px;">' + name + '<br><span style="color:#9ca3af;">下次 ' + next + ' · 每' + j.interval + 's</span></span></div>' +
                    '<button onclick="deleteCron(\'' + name + '\')" class="text-xs text-red-400 hover:text-red-600 transition px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20" title="删除">✕</button></div>';
                }).join('');
            } else {
                cronList.innerHTML = '<div style="font-size:11px;color:#9ca3af;padding:4px;">暂无活跃 cron 任务</div>';
            }
        } catch(e) {
            cronList.innerHTML = '<div style="font-size:11px;color:#9ca3af;padding:4px;">加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    }
    
    // 加载子代理列表（统一使用 _renderAgentList）
    var agentList = getEl('engineAgentList');
    if (agentList && Object.keys(window._agentListCache || {}).length > 0) {
        window._renderAgentList(window._agentListCache, agentList);
    } else if (agentList) {
        try {
            var agentResp = await fetch('/oneapichat/engine_api.php?action=agent_list&auth_token=' + getAuthToken(), { signal: AbortSignal.timeout(5000) });
            var agentData = await agentResp.json();
            window._agentListCache = agentData;
            window._renderAgentList(agentData, agentList);
        } catch(e) {
            agentList.innerHTML = '<div style="font-size:11px;color:#9ca3af;padding:4px;">加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    }
};

function createSearchToggleButton() {
    if (getEl('searchQuickToggle')) return;
    const wrapper = document.querySelector('.input-wrapper .flex');
    if (!wrapper) return;
    const btn = document.createElement('button');
    btn.id = 'searchQuickToggle';
    btn.type = 'button';
    btn.className = 'p-2 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition';
    btn.innerHTML = getSearchButtonIcon(false);
    btn.onclick = e => {
        e.preventDefault();
        const toggle = getEl('searchToggle');
        if (toggle) {
            toggle.checked = !toggle.checked;
            toggle.dispatchEvent(new Event('change'));
        }
    };
    const fileLabel = wrapper.querySelector('label[for="fileInput"]');
    if (fileLabel) {
        fileLabel.insertAdjacentElement('afterend', btn);
    } else {
        wrapper.prepend(btn);
    }
    updateSearchButtonState(getChecked('searchToggle'));
}

function updateSearchButtonState(checked) {
    const btn = getEl('searchQuickToggle');
    if (!btn) return;
    btn.innerHTML = getSearchButtonIcon(checked);
    btn.classList.toggle('text-blue-600', checked);
    btn.classList.toggle('dark:text-blue-400', checked);
}

function getSearchButtonIcon(checked) {
    return checked
        ? '<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 10l-4 4m0-4l4 4"/></svg>'
        : '<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>';
}

window.syncTokenFromRange = function () {
    setVal('maxTokensInput', getVal('maxTokens'));
    // 不自动保存,滑动时只同步数值
};

window.syncTokenFromInput = function () {
    let v = parseInt(getVal('maxTokensInput')) || 4096;
    v = Math.min(65536, Math.max(256, v));
    setVal('maxTokensInput', v);
    setVal('maxTokens', v);
    // 不自动保存
};

window.updateParam = (type, val) => {
    if (type === 'temp') {
        const span = getEl('tempValue');
        if (span) span.innerText = val;
    }
    // 不自动保存,滑动时只更新显示
};

function saveConfig(showFeedback = false) {
    console.log('[saveConfig] 被触发, apiKey输入框值:', (getVal('apiKey')||'').substring(0,10));
    const oldApiKey = localStorage.getItem('apiKey');
    const oldBaseUrl = localStorage.getItem('baseUrl');
    try {
        // ★ 不保存 "not-needed" 占位值
        const mainKey = getVal('apiKey') || '';
        localStorage.setItem('apiKey', mainKey === 'not-needed' ? '' : encrypt(mainKey));
        localStorage.setItem('baseUrl', getVal('baseUrl') || '');
        localStorage.setItem('systemPrompt', getVal('systemPrompt') || '');
        localStorage.setItem('model', getVal('modelSelect') || '');
        localStorage.setItem('visionModel', getVal('visionModel') || '');
    localStorage.setItem('visionApiUrl', getVal('visionApiUrl') || '');
    localStorage.setItem('visionApiKey', encrypt(getVal('visionApiKey') || ''));
    localStorage.setItem('imageModel', getVal('imageModel') || '');
    localStorage.setItem('imageApiKey', encrypt(getVal('imageApiKey') || ''));
    localStorage.setItem('imageBaseUrl', getVal('imageBaseUrl') || '');
    localStorage.setItem('temp', getVal('temperature') || '0.7');
    localStorage.setItem('tokens', getVal('maxTokens') || '4096');
    localStorage.setItem('stream', getChecked('streamToggle'));
    localStorage.setItem('requestTimeout', getVal('requestTimeout') || '60');
    localStorage.setItem('compress', getChecked('compressToggle'));
    localStorage.setItem('threshold', getVal('compressThreshold') || '10');
    localStorage.setItem('compressModel', getVal('compressModel') || '');
    localStorage.setItem('customParams', getVal('customParams') || '');
    localStorage.setItem('customEnabled', getChecked('customParamsToggle'));
    localStorage.setItem('lineHeight', getVal('lineHeight') || '1.1');
    localStorage.setItem('paragraphMargin', getVal('paragraphMargin') || '0');
    localStorage.setItem('markdownGFM', getChecked('markdownGFM'));
    localStorage.setItem('markdownBreaks', getChecked('markdownBreaks'));
    localStorage.setItem('titleModel', getVal('titleModel') || '');
    localStorage.setItem('enableSearch', getChecked('searchToggle'));
    localStorage.setItem('searchToolCall', getChecked('searchToolCallToggle'));
    localStorage.setItem('aiSearchJudge', getChecked('aiSearchJudgeToggle'));
    localStorage.setItem('aiSearchJudgeModel', getVal('aiSearchJudgeModel') || 'deepseek-chat');
    localStorage.setItem('aiSearchJudgePrompt', getVal('aiSearchJudgePrompt') || DEFAULT_CONFIG.aiSearchJudgePrompt);
    localStorage.setItem('searchModel', getVal('searchModel') || '');
    localStorage.setItem('searchProvider', getVal('searchProvider') || 'duckduckgo');
    var _sak = getVal('searchApiKey') || '';
    console.log('[saveConfig] searchApiKey 输入框值:', _sak.substring(0,8));
    localStorage.setItem('searchApiKey', encrypt(_sak));
    localStorage.setItem('searchApiKeyBrave', encrypt(getVal('searchApiKeyBrave') || ''));
    localStorage.setItem('searchApiKeyGoogle', encrypt(getVal('searchApiKeyGoogle') || ''));
    localStorage.setItem('searchApiKeyTavily', encrypt(getVal('searchApiKeyTavily') || ''));
    console.log('[saveConfig] localStorage中 searchApiKey:', (localStorage.getItem('searchApiKey')||'').substring(0,15));
    localStorage.setItem('searchRegion', getVal('searchRegion') || '');
    localStorage.setItem('searchTimeout', getVal('searchTimeout') || '30');
    localStorage.setItem('maxSearchResults', getVal('maxSearchResults') || '3');
    localStorage.setItem('fontSize', getVal('fontSize') || DEFAULT_CONFIG.fontSize);
    localStorage.setItem('searchType', getVal('searchType') || 'auto');
    localStorage.setItem('aiSearchTypeToggle', getChecked('aiSearchTypeToggle'));
    localStorage.setItem('searchShowPrompt', getChecked('searchShowPromptToggle'));
    localStorage.setItem('searchAppendToSystem', getChecked('searchAppendToSystem'));
    // Agent 模式配置
    localStorage.setItem('agentAutoDecision', getChecked('agentAutoDecision'));
    localStorage.setItem('agentProactive', getChecked('agentProactive'));
    localStorage.setItem('agentMaxToolRounds', getVal('agentMaxToolRounds') || '30');
    localStorage.setItem('agentThinkingDepth', getVal('agentThinkingDepth') || 'standard');
    localStorage.setItem('agentSystemPrompt', getVal('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt);
    } catch(e) {
        console.warn('[saveConfig] localStorage写入失败(已忽略):', e.message);
    }
    const newApiKey = localStorage.getItem('apiKey');
    const newBaseUrl = localStorage.getItem('baseUrl');
    // ★ 修复: API Key 或 Base URL 变更时自动刷新模型列表
    const apiKeyChanged = oldApiKey !== newApiKey;
    const baseUrlChanged = oldBaseUrl !== newBaseUrl;
    if ((apiKeyChanged || baseUrlChanged) && getVal('baseUrl') && getVal('apiKey')) {
        fetchModels();
    }
    if (showFeedback) {
        showToast('配置已保存 ✅', 'success');
        // ★ 修复: 保存后自动收起配置栏
        if ($.configPanel) {
            if ($.configPanel.classList.contains('mobile-open')) {
                $.configPanel.classList.remove('mobile-open');
            } else if (!$.configPanel.classList.contains('hidden-panel')) {
                $.configPanel.classList.add('hidden-panel');
            }
        }
        configSnapshot = null;
        configPanelWasOpen = false;
    }
    // ★ 配置变更后自动同步到服务器（按用户隔离）
    if (localStorage.getItem('authToken')) {
        setTimeout(saveConfigToServer, 200);
    }
}

window.updateDisplayParam = (type, val) => {
    if (type === 'lineHeight') {
        const span = getEl('lineHeightValue');
        if (span) span.innerText = parseFloat(val).toFixed(2);
        document.documentElement.style.setProperty('--chat-line-height', val);
    } else if (type === 'paragraphMargin') {
        const span = getEl('paragraphMarginValue');
        if (span) span.innerText = parseFloat(val).toFixed(2);
        document.documentElement.style.setProperty('--chat-paragraph-margin', val + 'rem');
    }
    // 不自动保存,滑动时只更新显示
};

function applyParagraphPrefix(prefix) {
    const container = $.chatMessagesContainer;
    if (!container) return;
    container.classList.remove('paragraph-prefix-dot', 'paragraph-prefix-dash');
    if (prefix === 'dot') container.classList.add('paragraph-prefix-dot');
    else if (prefix === 'dash') container.classList.add('paragraph-prefix-dash');
}

window.updateParagraphPrefix = () => {
};

window.updateMarkdownConfig = () => {
    if (window.marked) {
        marked.setOptions({
            gfm: getChecked('markdownGFM'),
            breaks: getChecked('markdownBreaks'),
            pedantic: false,
        });
        // 不再使用自定义 paragraph renderer（marked v15 默认已正确处理）
    }
    // 清空 Markdown 缓存使新配置生效
    if (window.MarkdownRenderer) MarkdownRenderer.clearCache();
    if (currentChatId) loadChat(currentChatId);
};

// ==================== 模型管理 ====================
window.fetchModels = async function () {
    const key = getVal('apiKey');
    const url = getVal('baseUrl');
    const selects = ['modelSelect', 'compressModel', 'titleModel', 'searchModel', 'aiSearchJudgeModel'];

    selects.forEach(id => {
        const el = getEl(id);
        if (el) el.innerHTML = '<option>加载中...</option>';
    });

    if (!key) {
        selects.forEach(id => {
            const el = getEl(id);
            if (el) el.innerHTML = '<option>请输入API Key</option>';
        });
        return;
    }

    try {
        const res = await fetch(`${url}/models`, { headers: { Authorization: `Bearer ${key}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const models = data.data || [];
        const modelOptions = models.map(m => `<option value="${m.id}">${m.id}</option>`).join('');

        const mainSelect = getEl('modelSelect');
        if (mainSelect) {
            mainSelect.innerHTML = modelOptions;
            mainSelect.value = localStorage.getItem('model') || DEFAULT_CONFIG.model;
        }

        ['compressModel', 'titleModel', 'searchModel', 'aiSearchJudgeModel'].forEach(id => {
            const sel = getEl(id);
            if (!sel) return;
            const placeholder = id === 'compressModel' ? '<option value="">默认</option>' : '<option value="">同主模型</option>';
            sel.innerHTML = placeholder + modelOptions;
            const saved = localStorage.getItem(id);
            if (saved && models.some(m => m.id === saved)) sel.value = saved;
            else if (models.length) sel.value = id === 'compressModel' ? models[0].id : 'deepseek-chat'; // 默认 deepseek-chat
        });

        models.forEach(function(m) {
            var ctx = m.context_length || 131072;
            if (m.id && (m.id.startsWith('deepseek-v4') || m.id.includes('deepseek') && m.id.includes('v4'))) {
                ctx = 1048576;
            }
            modelContextLength[m.id] = ctx;
            var maxOut = m.max_tokens || m.maxTokens || 0;
            if (!maxOut) {
                var id = (m.id || '').toLowerCase();
                if (id.includes('deepseek-v4')) maxOut = 1048576;
                else if (id.includes('deepseek-chat')) maxOut = 8192;
                else if (id.includes('deepseek-reasoner')) maxOut = 65536;
                else if (id.includes('minimax-m2')) maxOut = 131072;
                else if (id.includes('minimax')) maxOut = 131072;
                else maxOut = ctx;
            }
            modelMaxOutputTokens[m.id] = maxOut;
        });
        localStorage.setItem('modelContextLength', JSON.stringify(modelContextLength));
        localStorage.setItem('modelMaxOutputTokens', JSON.stringify(modelMaxOutputTokens));

        var curModel = getVal('modelSelect');
        if (curModel && modelContextLength[curModel]) {
            var ctxMax = modelContextLength[curModel] - MAX_TOKENS_SAFETY_MARGIN;
            var outMax = modelMaxOutputTokens[curModel] || ctxMax;
            var max = Math.min(ctxMax, outMax);
            const maxTokensInput = getEl('maxTokens');
            const maxTokensInput2 = getEl('maxTokensInput');
            if (maxTokensInput) maxTokensInput.max = max;
            if (maxTokensInput2) maxTokensInput2.max = max;
            let cur = parseInt(getVal('maxTokens'));
            if (cur > max) {
                setVal('maxTokens', max);
                setVal('maxTokensInput', max);
                        }
        }
    } catch (e) {
        if (getVal('apiKey')) showToast('获取模型列表失败', 'error');
    }
};

window.refreshModels = async function (e) {
    const btn = e?.target.closest('button');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
    }
    try {
        await window.fetchModels();
        showToast('模型列表已刷新', 'success');
    } catch {
        showToast('刷新失败', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
        }
    }
};

// ==================== 消息渲染 ====================
function showWelcome() {
    const container = $.chatMessagesContainer;
    if (!container) return;
    var letters = 'Hi, Nice to meet you!'.split('');
    var html = '<div class="welcome-container"><div class="brand">';
    for (var i = 0; i < letters.length; i++) {
        var cls = (letters[i] === ',' || letters[i] === '!') ? 'wl-dot' : 'wl';
        html += '<span class="' + cls + '" style="--d:' + (i * 0.06) + 's">' + letters[i] + '</span>';
    }
    html += '</div><p class="text-sm">开始新的对话 · NAUJTRATS</p></div>';
    container.innerHTML = html;
}

function copyMessageContent(content) {
    navigator.clipboard.writeText(compressNewlines(content, 2));
}

function autoLinkURLs(markdownText) {
    // ★ 统一将所有裸 URL 转为可点击的 markdown 链接，不再区分图片
    return markdownText.replace(/(^|\s)(https?:\/\/[^\s<>]+)($|\s)/g, (match, before, url, after) => {
        if (/!\[.*?\]\(/.test(match) || /\[.*?\]\(/.test(match)) return match;
        try {
            const u = new URL(url);
            let label = u.hostname;
            if (u.pathname && u.pathname !== '/') {
                label += u.pathname.slice(0, 20) + (u.pathname.length > 20 ? '...' : '');
            }
            return before + `[${label}](${url})` + after;
        } catch {
            return match;
        }
    });
}

function showImageLightbox(images, startIdx) {
    // 移除已有灯箱
    var existing = document.querySelector('.img-lightbox');
    if (existing) existing.remove();
    
    var idx = startIdx || 0;
    var overlay = document.createElement('div');
    overlay.className = 'img-lightbox';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;';
    
    var img = document.createElement('img');
    img.style.cssText = 'max-width:90vw;max-height:80vh;object-fit:contain;border-radius:4px;';
    
    var counter = document.createElement('div');
    counter.style.cssText = 'color:#fff;margin-bottom:12px;font-size:14px;';
    
    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:12px;margin-top:12px;';
    
    function updateView() {
        img.src = cleanImageUrl(images[idx]);
        counter.textContent = (idx + 1) + ' / ' + images.length;
    }
    
    // 左右切换
    if (images.length > 1) {
        var prev = document.createElement('button');
        prev.textContent = '\u25c0';
        prev.style.cssText = 'position:absolute;left:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer;';
        prev.addEventListener('click', function(e) { e.stopPropagation(); idx = (idx - 1 + images.length) % images.length; updateView(); });
        overlay.appendChild(prev);
        
        var next = document.createElement('button');
        next.textContent = '\u25b6';
        next.style.cssText = 'position:absolute;right:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer;';
        next.addEventListener('click', function(e) { e.stopPropagation(); idx = (idx + 1) % images.length; updateView(); });
        overlay.appendChild(next);
    }
    
    // 下载按钮
    var download = document.createElement('a');
    download.textContent = '\u2b07 \u4e0b\u8f7d';
    download.style.cssText = 'background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:6px 16px;font-size:13px;cursor:pointer;text-decoration:none;';
    download.addEventListener('click', function(e) {
        e.stopPropagation();
        var a = document.createElement('a');
        a.href = images[idx];
        a.download = 'image_' + (idx + 1) + '.png';
        a.click();
    });
    actions.appendChild(download);
    
    // 关闭
    var close = document.createElement('button');
    close.textContent = '\u2715';
    close.style.cssText = 'position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:36px;height:36px;font-size:18px;cursor:pointer;';
    close.addEventListener('click', function() { overlay.remove(); });
    overlay.appendChild(close);
    
    overlay.appendChild(counter);
    overlay.appendChild(img);
    overlay.appendChild(actions);
    
    // 点击背景关闭
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.remove();
    });
    
    // 键盘导航
    function keyHandler(e) {
        if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); }
        if (images.length > 1 && e.key === 'ArrowLeft') { idx = (idx - 1 + images.length) % images.length; updateView(); }
        if (images.length > 1 && e.key === 'ArrowRight') { idx = (idx + 1) % images.length; updateView(); }
    }
    document.addEventListener('keydown', keyHandler);
    
    updateView();
    document.body.appendChild(overlay);
}

function appendMessage(role, text, files = null, reasoning = null, usage = null, time = 0, isLast = false, generatedImage = null, generatedImages = null) {
    // ★ 防御性清理：确保参数都是字符串且不含 [object Object]
    const safeStr = (val) => {
        if (val === null || val === undefined) return '';
        if (typeof val !== 'string') val = String(val);
        return val.replace(/\[object Object\]/gi, '');
    };
    text = safeStr(text);
    reasoning = typeof reasoning === 'string' ? reasoning.replace(/\[object Object\]/gi, '') : '';
    // ★ 如果已有独立显示的生成图片，去除回复文本中对应的图片链接（避免重复和点击跳转报错）
    var _urls = (generatedImages || []).concat(generatedImage ? [generatedImage] : []).filter(Boolean);
    if (_urls.length > 0 && text) {
        _urls.forEach(function(u) {
            if (!u) return;
            text = text.split(u).join('');
        });
    }
    
    const container = $.chatMessagesContainer;
    if (!container) return null;

    // ★ 欢迎页淡出过渡
    if (container.children.length === 1 && container.children[0].classList.contains('welcome-container')) {
        var welcome = container.children[0];
        welcome.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        welcome.style.opacity = '0';
        welcome.style.transform = 'scale(0.95)';
        setTimeout(function() { welcome.remove(); }, 300);
    }

    const row = document.createElement('div');
    row.className = `message-row ${role}`;

    const avatar = document.createElement('div');
    avatar.className = `avatar ${role}`;
    avatar.textContent = role === 'user' ? '我' : 'N';

    const wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';

    const bubble = document.createElement('div');
    bubble.className = `bubble ${role}`;

    // 思考过程
    if (role === 'assistant' && reasoning) {
        const details = document.createElement('details');
        details.className = 'reasoning-details';
        details.open = true;
        details.innerHTML = `<summary>深度思考</summary><div class="reasoning-content">${compressNewlines(reasoning, 2)}</div>`;
        bubble.appendChild(details);
    }

    // 用户文件
    if (role === 'user' && files?.length) {
        const fileList = document.createElement('div');
        fileList.className = 'file-list';
        files.forEach(f => {
            if (f.isImage || f.type?.startsWith('image/')) {
                // 图片文件:显示预览
                const img = document.createElement('img');
                img.className = 'file-image-preview';
                img.src = f.content; // base64 data URL
                img.alt = f.name;
                img.title = f.name;
                img.loading = 'lazy';
                // 点击放大
                img.style.cursor = 'pointer';
                img.onclick = () => {
                    const modal = document.createElement('div');
                    modal.className = 'image-modal';
                    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:1000;display:flex;align-items:center;justify-content:center;';
                    const modalImg = document.createElement('img');
                    modalImg.src = f.content;
                    modalImg.style.maxWidth = '90%';
                    modalImg.style.maxHeight = '90%';
                    modalImg.style.objectFit = 'contain';
                    modal.appendChild(modalImg);
                    modal.onclick = (e) => {
                        if (e.target === modal) modal.remove();
                    };
                    document.body.appendChild(modal);
                };
                fileList.appendChild(img);
            } else {
                // 非图片文件:显示下载链接
                const url = URL.createObjectURL(new Blob([f.content], { type: 'text/plain' }));
                const fileItem = document.createElement('span');
                fileItem.className = 'file-item';
                fileItem.innerHTML = `<svg class="file-icon" viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M2 1.5C2 0.67 2.67 0 3.5 0h5.88c.4 0 .78.16 1.06.44l3.12 3.12c.28.28.44.66.44 1.06V14.5c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5v-13zM3.5 1c-.28 0-.5.22-.5.5v13c0 .28.22.5.5.5h9c.28 0 .5-.22.5-.5V4.62L10.38 1H3.5z"/><path d="M9 1v3.5c0 .28.22.5.5.5H13v1H9.5C8.67 6 8 5.33 8 4.5V1h1z"/></svg><a href="${url}" download="${escapeHtml(f.name)}">${escapeHtml(f.name)}</a>`;
                fileList.appendChild(fileItem);
            }
        });
        bubble.appendChild(fileList);
    }

    // 主要内容
    const contentDiv = document.createElement('div');
    contentDiv.className = 'markdown-body';

    if (role === 'user') {
        contentDiv.innerHTML = escapeHtml((typeof text === 'string' ? text.replace(/\[object Object\]/g, '') : '') || '').replace(/\n/g, '<br>');
    } else {
        let display = compressNewlines(typeof text === 'string' ? text.replace(/\[object Object\]/g, '') : '', 2);
        // 将 Markdown 图片语法 ![]() 转为可点击链接（避免加载失效图片）
        display = display.replace(/!\[(.*?)\]\((.*?)\)/g, '[图片 $1]($2)');
        if (window.marked) {
            display = autoLinkURLs(display);
            // ★ 使用保护渲染: _protectMath → marked → _restoreMath (含 KaTeX)
            contentDiv.innerHTML = _renderMarkdownWithMath(display);
            setTimeout(() => {
                // 查找所有 language-mermaid 的代码块(来自 ```mermaid)
                const mermaidCodes = contentDiv.querySelectorAll('pre code[class*="mermaid"]');
                mermaidCodes.forEach(codeBlock => {
                    const pre = codeBlock.parentNode;
                    const mermaidDiv = document.createElement('div');
                    mermaidDiv.className = 'mermaid';
                    // 修复中文引号(常见导致 Mermaid 语法错误的原因)
                    let code = codeBlock.textContent;
                    // 0. Auto-convert "line" diagram type to "xychart-beta"
                    if (/^line\b/.test(code.trim())) {
                        code = 'xychart-beta' + code.trim().slice(4);
                    }
                    // 1. Fix Chinese quotes
                    code = code.replace(/[""]/g, '"');
                    // 2. Fix xychart-beta y-axis label issue
                    code = code.replace(/y-axis\s+([\d.]+)\s*-->\s*([\d.]+)\s+"[^"]*"/g, 'y-axis $1 --> $2');
                    // 3. Normalize line data (comma separated)
                    if (code.includes('xychart-beta')) {
                        code = code.replace(/line\s+"([^"]+)"\s+([\d.\s,]+)/g, (m, label, nums) => {
                            const formatted = nums.trim().split(/\s+/).join(', ');
                            return `line "${label}" ${formatted}`;
                        });
                    }
                    mermaidDiv.textContent = code;
                    mermaidDiv.setAttribute('data-original-code', code);
                    pre.parentNode.replaceChild(mermaidDiv, pre);
                });
                if (window.mermaid && contentDiv.querySelectorAll('.mermaid').length > 0) {
                    requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                    // 检查容器是否仍在DOM中
                    if (!contentDiv.isConnected || !contentDiv.parentElement) return;
                    mermaid.run({
                        nodes: contentDiv.querySelectorAll('.mermaid'),
                        suppressErrors: false
                    }).then(() => {
                        // 渲染成功后检查:是否产生了有效的SVG而非CSS文本
                        contentDiv.querySelectorAll('.mermaid').forEach(div => {
                            if (!div.isConnected) return;
                            const hasSVG = div.querySelector('svg');
                            const hasBadOutput = div.textContent.includes('#mermaid') && div.textContent.includes('font-family');
                            if (hasBadOutput && !hasSVG) {
                                // Mermaid输出了CSS而非SVG,说明渲染失败
                                const originalCode = div.getAttribute('data-original-code') || div.textContent;
                                div.style.cssText = 'padding:12px;border-radius:8px;background:#fef3c7;border:1px solid #f59e0b;margin:8px 0;color:#92400e;font-size:0.85rem;overflow-x:auto;';
                                div.innerHTML = `<strong>⚠️ 图表渲染失败(Mermaid 可能不支持此语法):</strong><br>
                                    <pre style="white-space:pre-wrap;word-break:break-all;background:#fff3cd;padding:8px;border-radius:4px;margin:8px 0;font-size:0.8rem;">${escapeHtml(originalCode.slice(0, 500))}</pre>
                                    <span style="font-size:0.8rem">提示:Mermaid line/gantt 等图表可能需要不同语法,请尝试使用其他图表类型</span>`;
                            }
                        });
                    }).catch(err => {
                        console.warn('Mermaid 渲染失败', err);
                        contentDiv.querySelectorAll('.mermaid').forEach(div => {
                            if (!div.isConnected) return;
                            const originalCode = div.getAttribute('data-original-code') || div.textContent;
                            // 检查是否是 UnsupportedDiagramError / UnknownDiagramError
                            const isUnsupported = err && (err.message?.includes('No diagram type detected') || err.message?.includes('UnsupportedDiagramError'));

                            if (isUnsupported) {
                                // 对于不支持的图表类型,静默降级为代码块,不显示错误提示
                                const pre = document.createElement('pre');
                                pre.className = 'mermaid-code';
                                pre.style.cssText = 'background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:8px;overflow-x:auto;font-size:0.85rem;';
                                pre.textContent = originalCode;
                                div.parentNode.replaceChild(pre, div);
                            } else {
                                // 其他错误显示简洁提示
                                div.style.cssText = 'padding:10px;border-radius:8px;background:#fef3c7;border:1px solid #f59e0b;margin:8px 0;color:#92400e;font-size:0.85rem;';
                                div.innerHTML = `<strong>⚠️ 图表渲染失败</strong><br>
                                    <pre style="white-space:pre-wrap;word-break:break-all;background:#fff3cd;padding:6px;border-radius:4px;margin:6px 0;font-size:0.8rem;">${escapeHtml(originalCode.slice(0, 300))}</pre>`;
                            }
                        });
                    });
                    });
                    });
                }
                // 原有功能:代码复制和高亮
                attachCodeCopyButtons(bubble);
                applySyntaxHighlighting(bubble);
            }, 0);
        } else {
            // 未加载 marked 时降级为纯文本
            contentDiv.innerHTML = `<pre>${escapeHtml(display)}</pre>`;
            setTimeout(() => {
                attachCodeCopyButtons(bubble);
                applySyntaxHighlighting(bubble);
            }, 0);
        }
    }
    bubble.appendChild(contentDiv);

    // 如果有生成的图片,显示在内容下方
    const allImages = generatedImages || (generatedImage ? [generatedImage] : []);
    if (allImages.length > 0) {
        const imgContainer = document.createElement('div');
        imgContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
        allImages.forEach(function(imgData, idx) {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'position:relative;cursor:pointer;';
            const img = document.createElement('img');
            const cleanUrl = cleanImageUrl(imgData);
            img.src = cleanUrl;
            const maxW = allImages.length > 1 ? '160px' : '320px';
            img.style.cssText = 'max-width:' + maxW + ';width:100%;border-radius:8px;display:block;';
            img.setAttribute('loading', 'lazy');
            // ★ 点击放大预览
            img.addEventListener('click', function() { showImageLightbox(allImages, idx); });
            img.onerror = function() {
                this.style.display = 'none';
                const fallback = document.createElement('div');
                fallback.style.cssText = 'padding:10px;border-radius:8px;background:#fef3c7;border:1px solid #f59e0b;margin:4px 0;color:#92400e;font-size:0.75rem;text-align:center;';
                fallback.textContent = '\u26a0\ufe0f \u56fe\u7247\u52a0\u8f7d\u5931\u8d25';
                wrapper.appendChild(fallback);
            };
            wrapper.appendChild(img);
            // 悬停显示放大图标
            var hint = document.createElement('div');
            hint.style.cssText = 'position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.5);color:#fff;border-radius:4px;padding:2px 6px;font-size:11px;opacity:0;transition:opacity 0.2s;pointer-events:none;';
            hint.textContent = '\ud83d\udd0d';
            wrapper.addEventListener('mouseenter', function() { hint.style.opacity = '1'; });
            wrapper.addEventListener('mouseleave', function() { hint.style.opacity = '0'; });
            wrapper.appendChild(hint);
            imgContainer.appendChild(wrapper);
        });
        bubble.appendChild(imgContainer);
    }

    wrapper.appendChild(bubble);

    // 操作按钮
    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    // 复制按钮
    const copyBtn = document.createElement('div');
    copyBtn.className = 'msg-action-btn copy-msg-btn';
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.onclick = (e) => {
        e.stopPropagation();
        copyMessageContent(text);
        copyBtn.style.background = '#bbf7d0';
        setTimeout(() => copyBtn.style.background = '', 300);
    };
    actions.appendChild(copyBtn);

    if (isLast) {
        if (role === 'user') {
            // 编辑按钮
            const editBtn = document.createElement('div');
            editBtn.className = 'msg-action-btn edit-btn';
            editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3l4 4L7 21H3v-4L17 3z"/><path d="M15 5l4 4"/></svg>';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                const msgs = chats[currentChatId].messages;
                const idx = msgs.findIndex(m => m.role === 'user' && m.text === text && JSON.stringify(m.files) === JSON.stringify(files));
                if (idx === -1) return;
                const sys = msgs.filter(m => m.role === 'system' && !m.temporary && !m.timestamp);
                const timestamp = msgs.find(m => m.timestamp);
                const others = msgs.slice(0, idx).filter(m => m.role !== 'system' || m.temporary || m.timestamp);
                chats[currentChatId].messages = [...sys, ...others, ...(timestamp ? [timestamp] : [])];
                saveChatsDebounced();
                loadChat(currentChatId);
                if ($.userInput) {
                    $.userInput.value = text || '';
                    window.autoResize($.userInput);
                }
                pendingFiles = files ? files.map(f => ({ ...f })) : [];
                updateFilePreviewUI();
            };
            actions.appendChild(editBtn);
        } else {
            // 重新生成按钮
            const regenBtn = document.createElement('div');
            regenBtn.className = 'msg-action-btn regenerate-btn';
            regenBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
            regenBtn.onclick = async (e) => {
                e.stopPropagation();
                const msgs = chats[currentChatId].messages;
                const idx = msgs.findIndex(m => m.role === 'assistant' && m.content === text);
                if (idx === -1) return;
                const sys = msgs.filter(m => m.role === 'system' && !m.temporary && !m.timestamp);
                const timestamp = msgs.find(m => m.timestamp);
                const others = msgs.slice(0, idx).filter(m => m.role !== 'system' || m.temporary || m.timestamp);
                chats[currentChatId].messages = [...sys, ...others, ...(timestamp ? [timestamp] : [])];
                saveChatsDebounced();
                loadChat(currentChatId);
                const lastUser = msgs.slice(0, idx).filter(m => m.role === 'user').pop();
                if (lastUser) await sendMessage(true, lastUser.text, lastUser.files);
            };
            actions.appendChild(regenBtn);
        }
    }

    if (actions.children.length) wrapper.appendChild(actions);

    // 底部统计（改用SVG图标）
    if (role === 'assistant' && (usage || time > 0)) {
        const footer = document.createElement('div');
        footer.className = 'message-footer';
        var foot = '<svg class="msg-foot-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/></svg> ' + (time / 1000).toFixed(1) + 's';
        if (usage) {
            var ct = Number(usage.completion_tokens) || 0; var pt = Number(usage.prompt_tokens) || 0; var tokens = Number(usage.total_tokens) || (ct + pt) || 0;
            // ★ 兜底: 从其他命名字段提取 token 数
            if (!tokens && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
                tokens = (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0);
            }
            if (!tokens && usage.inputTokenCount) tokens = Number(usage.inputTokenCount) + (Number(usage.outputTokenCount) || 0) || 0;
            if (tokens > 0) {
                foot += ' <span class="msg-foot-sep"></span> <svg class="msg-foot-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="9.5,2 4,9 7.5,9 6.5,14 12,7 8.5,7"/></svg> ' + tokens;
            }
            // ★ 统一提取缓存命中信息，兼容多模型格式
            var cacheHit = null, cacheMiss = null;
            // DeepSeek 原生: prompt_cache_hit/miss_tokens
            if (usage.prompt_cache_hit_tokens !== undefined) {
                cacheHit = Number(usage.prompt_cache_hit_tokens) || 0;
                cacheMiss = Number(usage.prompt_cache_miss_tokens) || 0;
            }
            // OpenAI / oneapi 标准: prompt_tokens_details.cached_tokens
            if (!cacheHit && usage.prompt_tokens_details) {
                var _cached = Number(usage.prompt_tokens_details.cached_tokens) || Number(usage.prompt_tokens_details.cached) || 0;
                if (_cached > 0) { cacheHit = _cached; cacheMiss = (pt || ct) - cacheHit; if (cacheMiss < 0) cacheMiss = 0; }
            }
            // Anthropic Claude: cache_read_input_tokens / cache_creation_input_tokens
            if (!cacheHit && (usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined)) {
                cacheHit = Number(usage.cache_read_input_tokens) || 0;
                cacheMiss = Number(usage.cache_creation_input_tokens) || 0;
            }
            // Grok/xAI 及其他: cached_tokens 直接在 usage 顶层
            if (!cacheHit && Number(usage.cached_tokens) > 0) {
                cacheHit = Number(usage.cached_tokens) || 0;
                cacheMiss = (pt || ct) - cacheHit;
                if (cacheMiss < 0) cacheMiss = 0;
            }
            if (cacheHit !== null && cacheHit > 0) {
                var cacheTotal = cacheHit + cacheMiss;
                foot += ' <span class="msg-foot-sep"></span> <svg class="msg-foot-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5 6h6M5 9h4M5 12h6"/></svg> ';
                foot += cacheTotal > 0 ? ((cacheHit / cacheTotal) * 100).toFixed(1) + '%缓存命中(' + cacheHit + '/' + cacheTotal + ')' : '缓存未启用';
            }
        }
        footer.innerHTML = foot;
        bubble.appendChild(footer);
    }

    row.appendChild(avatar);
    row.appendChild(wrapper);
    // ★ 淡入动画
    row.style.opacity = '0';
    row.style.transform = 'translateY(10px)';
    row.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    container.appendChild(row);
    requestAnimationFrame(function() {
        row.style.opacity = '1';
        row.style.transform = 'translateY(0)';
    });

    // 不在这里滚动，streaming 时会自然跟随

    return bubble;
}

function attachCodeCopyButtons(container) {
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.code-actions')) return;
        var code = pre.innerText.trim();
        var isHtml = /^(<!DOCTYPE|<html|<HTML|<svg[\s>])/.test(code) || (code.indexOf('<') >= 0 && code.indexOf('>') >= 0 && (code.indexOf('style') >= 0 || code.indexOf('script') >= 0 || code.indexOf('div') >= 0 || code.indexOf('body') >= 0 || code.indexOf('h1') >= 0 || code.indexOf('p>') >= 0));
        
        var actions = document.createElement('div');
        actions.className = 'code-actions';
        
        if (isHtml) {
            var runBtn = document.createElement('div');
            runBtn.className = 'code-run-btn';
            runBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
            runBtn.title = '\u8fd0\u884c\u6b64HTML';
            runBtn.onclick = function(e) {
                e.stopPropagation();
                try { var win = window.open('', '_blank'); win.document.write(code); win.document.close(); }
                catch(err) { alert('\u65e0\u6cd5\u6253\u5f00\u65b0\u7a97\u53e3'); }
            };
            actions.appendChild(runBtn);
        }
        
        var copyBtn = document.createElement('div');
        copyBtn.className = 'code-copy-btn';
        copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        copyBtn.onclick = function(e) {
            e.stopPropagation();
            navigator.clipboard.writeText(code);
            copyBtn.style.background = '#bbf7d0';
            setTimeout(function() { copyBtn.style.background = ''; }, 300);
        };
        actions.appendChild(copyBtn);
        
        pre.insertBefore(actions, pre.firstChild);
    });
}
function applySyntaxHighlighting(container) {
    if (window.hljs) {
        // 静默 highlight.js 的安全警告（代码块中含 HTML 标签时触发，非真安全问题）
        var _warn = console.warn;
        console.warn = function() {};
        container.querySelectorAll('pre code:not([class*="mermaid"])').forEach(function(block) {
            try { hljs.highlightElement(block); } catch(e) {}
        });
        console.warn = _warn;
    }
}

// ==================== 联网搜索 ====================
async function aiChooseSearchType(text, historySummary, signal) {
    const truncated = historySummary.length > MAX_HISTORY_LENGTH ? historySummary.slice(0, MAX_HISTORY_LENGTH) + '...(截断)' : historySummary;
    const now = new Date();
    const timeInfo = `当前真实时间:${now.toLocaleDateString()} ${now.toLocaleTimeString()}(时区:${Intl.DateTimeFormat().resolvedOptions().timeZone})。`;
    const prompt = `${timeInfo}\n请根据用户问题,判断最适合的搜索类型。只返回以下单词之一:web, news, images。不要解释。\n\n对话历史:${truncated}\n\n用户问题:${text}\n\n搜索类型:`;
    const model = getVal('aiSearchJudgeModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;
    const url = getVal('baseUrl');
    const key = getVal('apiKey');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_JUDGE_TIMEOUT);
    const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

    try {
        const res = await fetchWithRetry(`${url}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 10,
                extra_body: { thinking: { type: "disabled" } }
            }),
            signal: combinedSignal
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error();
        const data = await res.json();
        let type = data.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
        if (['web', 'news', 'images'].includes(type)) return type;
        return 'web';
    } catch {
        clearTimeout(timeoutId);
        return 'web';
    }
}

async function performWebSearch(query, signal, type = 'web') {
    const provider = getVal('searchProvider') || 'duckduckgo';
    const timeout = parseInt(getVal('searchTimeout')) * 1000;
    const max = parseInt(getVal('maxSearchResults')) || 3;
    const region = getVal('searchRegion') || '';
    const t = Date.now();

    // 获取对应引擎的API Key
    const providerKeyMap = { brave: 'searchApiKeyBrave', google: 'searchApiKeyGoogle', tavily: 'searchApiKeyTavily' };
    const providerKeyId = providerKeyMap[provider];
    let apiKey = '';
    if (providerKeyId) {
        apiKey = getVal(providerKeyId) || getVal('searchApiKey') || '';
    } else {
        apiKey = getVal('searchApiKey') || '';
    }

    const country = region && region.length === 2 ? region : '';

    let url = '';
    const headers = { 'Accept': 'application/json' };

    if (provider === 'brave') {
        let params = `q=${encodeURIComponent(query)}&count=${max}&_t=${t}`;
        if (country) params += `&country=${country}`;
        params += '&safesearch=off';
        if (SEARCH_PROXY) {
            url = `${SEARCH_PROXY}/brave?${params}&type=${type}`;
        } else {
            let endpoint = '';
            switch (type) {
                case 'news': endpoint = '/news/search'; break;
                case 'images': endpoint = '/images/search'; break;
                default: endpoint = '/web/search';
            }
            url = `https://api.search.brave.com/res/v1${endpoint}?${params}`;
        }
        headers['X-Subscription-Token'] = apiKey;
    } else if (provider === 'google') {
        url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=017576662512468239146:omuauf_lfve&q=${encodeURIComponent(query)}&num=${max}&_t=${t}${country ? '&gl=' + country : ''}`;
    } else if (provider === 'tavily') {
        // Tavily AI Search API - POST JSON
        url = 'https://api.tavily.com/search';
        const body = JSON.stringify({
            api_key: apiKey,
            query: query,
            search_depth: 'basic',
            max_results: max
        });
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
            const res = await fetchWithRetry(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body,
                signal: combinedSignal
            });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`搜索失败: ${res.status}`);
            const data = await res.json();
            return parseSearchResults(data, provider, type);
        } catch (e) {
            throw e;
        }
    } else {
        url = SEARCH_PROXY
            ? `${SEARCH_PROXY}/duckduckgo?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&_t=${t}${country ? '&kl=' + country : ''}`
            : `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&_t=${t}${country ? '&kl=' + country : ''}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

    try {
        const res = await fetchWithRetry(url, { method: 'GET', headers, signal: combinedSignal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`搜索失败: ${res.status}`);
        const data = await res.json();
        return parseSearchResults(data, provider, type);
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

function parseSearchResults(data, provider, type = 'web') {
    const results = [];
    if (provider === 'brave') {
        if (type === 'news' && data.news?.results) {
            results.push(...data.news.results.slice(0, 5).map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.description || r.content
            })));
        } else if (type === 'images' && data.images?.results) {
            results.push(...data.images.results.slice(0, 5).map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.description || '',
                thumbnail: r.thumbnail?.src || ''
            })));
        } else if (data.web?.results) {
            results.push(...data.web.results.slice(0, 5).map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.description
            })));
        }
    } else if (provider === 'google' && data.items) {
        results.push(...data.items.slice(0, 5).map(r => ({ title: r.title, url: r.link, snippet: r.snippet })));
    } else if (provider === 'duckduckgo') {
        if (data.AbstractText) results.push({ title: data.Heading || '摘要', url: data.AbstractURL || '', snippet: data.AbstractText });
        if (data.RelatedTopics) data.RelatedTopics.slice(0, 4).forEach(t => {
            if (t.Text) results.push({ title: t.Text.split('.')[0] || '相关', url: '', snippet: t.Text });
        });
    } else if (provider === 'tavily') {
        // Tavily response: { results: [{ title, url, raw_content }] }
        if (data.results) {
            results.push(...data.results.slice(0, 5).map(r => ({
                title: r.title || '无标题',
                url: r.url || '',
                snippet: r.raw_content || r.content || ''
            })));
        }
    }
    return results;
}

function formatRawResults(results) {
    if (!results.length) return '未找到相关搜索结果。';
    return '【原始联网搜索结果】\n\n' + results.map((r, i) => {
        let line = `${i + 1}. ${r.title}\n   链接: ${r.url}\n   摘要: ${r.snippet}`;
        if (r.thumbnail) {
            line += `\n   ![图片](${r.thumbnail})`;
        }
        return line;
    }).join('\n\n');
}

// ★ 网页内容抓取: 支持单URL和多URL并行
async function performWebFetch(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return { results: [], error: 'No URLs provided' };

    const BLOCKED_HOSTS = [];
    const isBlocked = function(u) {
        try { return BLOCKED_HOSTS.some(function(h) { return new URL(u).hostname.includes(h); }); } catch { return false; }
    };

    const seen = new Set();
    const validUrls = urls.filter(function(u) {
        if (seen.has(u)) return false;
        seen.add(u);
        if (isBlocked(u)) return false;
        try { return new URL(u).protocol.startsWith('http'); } catch { return false; }
    }).slice(0, 5);
    if (validUrls.length === 0) return { results: [], error: 'No valid HTTP URLs (或全部被反爬保护)' };

    const TIMEOUT_MS = 12000;

    const results = await Promise.all(validUrls.map(async function(url) {
        try {
            const ctrl = new AbortController();
            const tid = setTimeout(function() { ctrl.abort(); }, TIMEOUT_MS);
            const r = await fetch(
                FETCH_PROXY + '?url=' + encodeURIComponent(url) + '&extract=1',
                { signal: ctrl.signal }
            );
            clearTimeout(tid);
            if (!r.ok) {
                var errMap = { 502: '抓取失败(可能反爬)', 403: '网站反爬保护', 404: '页面不存在', 429: '请求过于频繁' };
                const msg = errMap[r.status] || 'HTTP ' + r.status;
                return { url: url, content: '', error: msg };
            }
            const d = await r.json();
            return { url: url, content: d.content || '', error: d.error || '' };
        } catch (e) {
            return { url: url, content: '', error: e.name === 'AbortError' ? '请求超时' : e.message };
        }
    }));

    return { results: results };
}

async function generateSearchQuery(text, history, signal) {
    const model = getVal('aiSearchJudgeModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;
    const url = getVal('baseUrl');
    const key = getVal('apiKey');
    const truncated = history.length > MAX_HISTORY_LENGTH ? history.slice(0, MAX_HISTORY_LENGTH) + '...(截断)' : history;
    const now = new Date();
    const timeInfo = `当前真实时间:${now.toLocaleDateString()} ${now.toLocaleTimeString()}(时区:${Intl.DateTimeFormat().resolvedOptions().timeZone})。`;
    const prompt = `${timeInfo}\n你是一个搜索词优化助手。请结合以下对话历史,理解用户问题中的代词具体指代什么,然后生成一个简短(10个词以内)、精准的搜索引擎查询词。只返回查询词本身,不要有任何解释、标点或额外内容。\n\n对话历史:\n${truncated}\n\n用户问题:${text}\n\n优化后的搜索查询词:`;

    try {
        const res = await fetchWithRetry(`${url}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 30,
                extra_body: { thinking: { type: "disabled" } }
            }),
            signal
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        let query = data.choices?.[0]?.message?.content?.trim() || '';
        if (!query && data.choices?.[0]?.message?.reasoning_content) {
            query = data.choices[0].message.reasoning_content.split(/[。\n]/)[0]?.trim() || '';
        }
        return query.replace(/^[.,/#!$%^&*;:{}=\-_`~()"'\s]+|[.,/#!$%^&*;:{}=\-_`~()"'\s]+$/g, '') || text;
    } catch {
        return text;
    }
}

// 改进后的 AI 搜索判断函数(增强正则 + 关键词 fallback)
async function aiShouldSearch(text, history, signal) {
    if (!getChecked('aiSearchJudgeToggle')) return null;
    const truncated = history.length > MAX_HISTORY_LENGTH ? history.slice(0, MAX_HISTORY_LENGTH) + '...(截断)' : history;
    const now = new Date();
    const timeInfo = `当前真实时间:${now.toLocaleDateString()} ${now.toLocaleTimeString()}(时区:${Intl.DateTimeFormat().resolvedOptions().timeZone})。`;
    let prompt = (getVal('aiSearchJudgePrompt') || DEFAULT_CONFIG.aiSearchJudgePrompt).replace('{history}', truncated).replace('{text}', text);
    if (!prompt.includes('{history}')) prompt = `以下是对话历史:\n${truncated}\n\n用户问题:${text}\n\n请判断是否需要联网搜索。`;
    prompt = timeInfo + '\n' + prompt;

    const model = getVal('aiSearchJudgeModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;
    const url = getVal('baseUrl');
    const key = getVal('apiKey');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_JUDGE_TIMEOUT);
    const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

    try {
        const res = await fetchWithRetry(`${url}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: '你是一个判断是否需要联网搜索的助手。请严格根据用户问题判断,只返回一个单词 true 或 false,不要添加任何解释、标点或空格。' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 20,
                extra_body: { thinking: { type: "disabled" } }
            }),
            signal: combinedSignal
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error();
        const data = await res.json();
        let ans = data.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
        // 增强正则提取 true/false
        const match = ans.match(/\b(true|false)\b/);
        if (match) return match[0] === 'true';
        // 如果包含中文关键词也尝试理解
        if (ans.includes('需要') || ans.includes('应该') || ans.includes('true')) return true;
        if (ans.includes('不需要') || ans.includes('false')) return false;
        // fallback: 关键词匹配
        const smartKeywords = getSmartSearchKeywords();
        return smartKeywords.some(k => text.includes(k));
    } catch {
        clearTimeout(timeoutId);
        // 出错时也 fallback 到关键词匹配
        const smartKeywords = getSmartSearchKeywords();
        return smartKeywords.some(k => text.includes(k));
    }
}

function updateBubbleSearchStatus(bubble, status, isError = false) {
    if (!bubble || !bubble.querySelector || !currentChatId) return;
    if (!document.body.contains(bubble)) return;

    let statusDiv = bubble.querySelector('.search-status');
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.className = 'search-status';
        const markdownBody = bubble.querySelector('.markdown-body');
        if (markdownBody) {
            bubble.insertBefore(statusDiv, markdownBody);
        } else {
            bubble.appendChild(statusDiv);
        }
    } else {
        statusDiv.innerHTML = ''; // 清空旧内容
    }
    const line = document.createElement('div');
    line.textContent = status;
    if (isError) line.style.color = '#ef4444';
    statusDiv.appendChild(line);
}

// ==================== 消息发送核心 ====================
const rateLimit = {
    last: 0,
    min: 1000,
    allowed() {
        const now = Date.now();
        if (now - this.last < this.min) return false;
        this.last = now;
        return true;
    }
};

// 仅中止现有请求,不设置用户停止标记(用于开始新请求时停止旧请求)
function abortExistingRequest(chatId) {
    if (abortControllerMap[chatId]) {
        abortControllerMap[chatId].abort();
        delete abortControllerMap[chatId];
    }
    if (searchAbortControllerMap[chatId]) {
        searchAbortControllerMap[chatId].abort();
        delete searchAbortControllerMap[chatId];
    }
    delete isTypingMap[chatId];
    delete activeBubbleMap[chatId];
    // ★ 主代理空闲了，处理子代理通知队列
    if (window._agentNotifyQueue && window._agentNotifyQueue.length > 0 && typeof window._processAgentNotifyQueue === 'function') {
        setTimeout(function() { window._processAgentNotifyQueue(); }, 500);
    }
}

// 用户主动停止,设置用户停止标记
function stopGenerationForChat(chatId) {
    userAbortMap[chatId] = true; // 标记用户主动停止,不再重试
    abortExistingRequest(chatId);
    // ★ 用户停止后也要处理队列
    if (window._agentNotifyQueue && window._agentNotifyQueue.length > 0 && typeof window._processAgentNotifyQueue === 'function') {
        setTimeout(function() { window._processAgentNotifyQueue(); }, 500);
    }
}

window.stopGeneration = function () {
    if (currentChatId) {
        stopGenerationForChat(currentChatId);
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
    }
};

function buildHistorySummary(chatId, maxLength = MAX_HISTORY_LENGTH) {
    const messages = chats[chatId]?.messages || [];
    const recent = messages.slice(-10);
    const summary = recent.map(m => {
        if (m.role === 'user') return `用户: ${(m.text || '').slice(0, 300)}`;
        if (m.role === 'assistant') return `助手: ${(m.content || '').slice(0, 300)}`;
        return '';
    }).filter(Boolean).join('\n');
    return summary.slice(0, maxLength) || '无历史记录';
}

// 改进:更全面的时间关键词检测,按需返回时间消息(不保存)
function createTemporaryTimestampIfNeeded(text) {
    // 扩展时间关键词列表,覆盖常见时间相关表达
    const timeKeywords = [
        '现在时间', '当前时间', '现在几点', '几点钟', '时间', 'date', 'time', 'now',
        '今天', '明天', '昨天', '星期', '周', '几号', '几月', '哪年', '今年', '去年', '明年',
        'weather', '天气', '新闻', 'news', '实时', '最新', '动态'
    ];
    const lowerText = text.toLowerCase();
    if (timeKeywords.some(kw => lowerText.includes(kw))) {
        const now = new Date();
        const timeContent = `当前时间戳:${now.toLocaleDateString()} ${now.toLocaleTimeString()} 时区:${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
        return { role: 'system', content: timeContent, temporary: true };
    }
    return null;
}

function parseCommand(text) {
    const parts = text.split(' ');
    const cmd = parts[0].toLowerCase();
    if (cmd === '/search' || cmd === '/s') {
        return { force: true, type: 'web', query: parts.slice(1).join(' ').trim() };
    }
    if (cmd === '/news') {
        return { force: true, type: 'news', query: parts.slice(1).join(' ').trim() };
    }
    if (cmd === '/image') {
        return { force: true, type: 'images', query: parts.slice(1).join(' ').trim() };
    }
    return null;
}

function getSmartSearchKeywords() {
    return [
        // 明确要求搜索的词
        '搜索', '搜一下', '搜一搜', '帮我搜', '网上搜',
        // 新闻/实时类
        '最新', '新闻', '实时', '今日', '今天天气', '当前天气',
        // 明确需要查信息的
        '帮我查', '查一下', '帮我找', '帮我看看',
        // 非常具体的搜索意图词
        '怎么选购', '哪款好', '哪个值得', '多少钱', '价格多少',
        '最新消息', '最新动态', '最新资讯', '刚出的', '刚发布',
        // 下载/安装类的需要看最新版本
        '最新版', '最新版本', '下载安装',
        // 强烈暗示需要外部信息的
        '排行榜', '排名', '评测', '对比评测',
        '现在几点', '现在时间', '今日日期',
        // 百科类
        '百科', '维基'
    ];
}

function getImageKeywords() {
    return ['图片', '照片', '截图', '图', '壁纸', 'gif', 'image', 'photo', 'picture', 'pic'];
}

async function determineSearchType(text, history, signal, forcedType) {
    if (forcedType) return forcedType;
    const hasImageIntent = getImageKeywords().some(kw => text.toLowerCase().includes(kw));
    const baseType = getVal('searchType') || 'auto';
    if (baseType === 'auto') {
        if (hasImageIntent || getChecked('aiSearchTypeToggle')) {
            return hasImageIntent ? 'images' : await aiChooseSearchType(text, history, signal);
        }
        return 'web';
    }
    return baseType;
}

async function handleSearchFlow(chatId, text, forceSearch, queryText, history, signal, bubble, forcedType) {
    let shouldSearch = false;
    let aiDecision = null;
    let finalType = forcedType;
    let searchResults = null;
    let searchError = null;

    const smartKeywords = getSmartSearchKeywords();

    if (forceSearch) {
        shouldSearch = true;
        if (!finalType) finalType = forcedType || 'web';
        updateBubbleSearchStatus(bubble, `🔍 强制搜索 (${finalType})`);
        if (getChecked('searchShowPromptToggle')) showToast(`🔍 强制搜索 (${finalType})`, 'info');
    } else if (getChecked('searchToggle')) {
        const aiJudge = getChecked('aiSearchJudgeToggle');
        if (aiJudge) {
            updateBubbleSearchStatus(bubble, '🤖 AI 判断是否需要搜索...');
            if (getChecked('searchShowPromptToggle')) showToast('🤖 AI智能判断是否需要搜索...', 'info', 2000);
            aiDecision = await aiShouldSearch(text, history, signal);
            if (aiDecision === true) {
                shouldSearch = true;
                updateBubbleSearchStatus(bubble, '🤖 AI 判断:需要联网搜索');
                if (getChecked('searchShowPromptToggle')) showToast('🤖 AI判断:需要联网搜索', 'info');
                if (getChecked('aiSearchTypeToggle')) {
                    updateBubbleSearchStatus(bubble, '🤖 AI 正在判断搜索类型...');
                    if (getChecked('searchShowPromptToggle')) showToast('🤖 AI正在判断搜索类型...', 'info', 2000);
                    finalType = await aiChooseSearchType(text, history, signal);
                    updateBubbleSearchStatus(bubble, `🤖 AI 选择:${finalType}搜索`);
                    if (getChecked('searchShowPromptToggle')) showToast(`🤖 AI选择:${finalType}搜索`, 'info');
                }
            } else if (aiDecision === false) {
                shouldSearch = false;
                updateBubbleSearchStatus(bubble, '🤖 AI 判断:无需联网搜索');
                if (getChecked('searchShowPromptToggle')) showToast('🤖 AI判断:无需联网搜索', 'info');
            } else {
                updateBubbleSearchStatus(bubble, '🤖 AI 判断:无法确定,使用关键词匹配');
                if (getChecked('searchShowPromptToggle')) showToast('🤖 AI判断:无法确定,使用关键词匹配', 'warning');
            }
        }
        if (!aiJudge || aiDecision === null) {
            shouldSearch = smartKeywords.some(k => text.includes(k));
        }
        if (shouldSearch && !finalType) {
            finalType = await determineSearchType(text, history, signal, null);
            const hasImageIntent = getImageKeywords().some(kw => text.toLowerCase().includes(kw));
            if (finalType === 'web' && hasImageIntent && getChecked('searchShowPromptToggle')) {
                showToast('💡 检测到您可能需要图片,可尝试使用 /image 命令', 'info', 5000);
            }
        }
    }

    if (shouldSearch && finalType) {
        const typeIcons = { web: '🔍', news: '📰', images: '🖼️' };
        const typeNames = { web: '网页', news: '新闻', images: '图片' };
        updateBubbleSearchStatus(bubble, `${typeIcons[finalType] || '🔍'} 正在搜索${typeNames[finalType] || ''}中...`);
        if (getChecked('searchShowPromptToggle')) showToast(`🔍 正在搜索${typeNames[finalType] || ''}中...`, 'info');

        const searchQuery = forceSearch ? queryText : (aiDecision === true ? await generateSearchQuery(text, history, signal) : text);
        try {
            searchResults = await performWebSearch(searchQuery, signal, finalType);
            // 直接使用原始结果,不再优化
            const optimized = formatRawResults(searchResults);
            updateBubbleSearchStatus(bubble, '📝 搜索完成,正在生成回答...');
            if (getChecked('searchShowPromptToggle')) showToast('📝 搜索完成,正在生成回答...', 'info');
            return { searchPerformed: true, searchResults, optimized, searchError: null, searchType: finalType };
        } catch (e) {
            searchError = e.message;
            updateBubbleSearchStatus(bubble, `❌ 搜索失败:${e.message}`, true);
            if (getChecked('searchShowPromptToggle')) showToast(`❌ 联网搜索失败: ${e.message}`, 'error', 5000);
            return { searchPerformed: true, searchResults: null, optimized: null, searchError, searchType: finalType };
        }
    }

    return { searchPerformed: false, searchResults: null, optimized: null, searchError: null, searchType: finalType };
}

// 检查对话历史中是否有图片(用于自动切换到 VL-01 视觉模型)
// 注意:这里只检查历史中是否有图片,不影响当前消息的发送
function hasImagesInChat(chatId) {
    const msgs = chats[chatId]?.messages || [];
    return msgs.some(m => m.files?.some(f => f.isImage || f.type?.startsWith('image/')));
}

// 检查最新一条用户消息是否包含图片
function currentMessageHasImage(chatId) {
    const msgs = chats[chatId]?.messages || [];
    // 找到最后一条用户消息
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.role === 'user') {
            return m.files?.some(f => f.isImage || f.type?.startsWith('image/')) || false;
        }
    }
    return false;
}

function buildApiMessages(chatId) {
    const apiMessages = [];
    // 只检查当前消息(pendingFiles)是否包含图片,避免历史图片触发视觉模型
    const currentHasImage = pendingFiles.length > 0 && pendingFiles.some(f => f.isImage || f.type?.startsWith('image/'));

    // ★ MiniMax 兼容: 合并所有非临时 system 消息为一条
    const _isMiniMax = (getVal('modelSelect') || '').toLowerCase().includes('minimax');
    if (_isMiniMax) {
        const sysMsgs = [];
        for (const msg of chats[chatId].messages) {
            if (msg.role === 'system' && !msg.temporary) {
                sysMsgs.push(msg.content);
            }
        }
        const merged = sysMsgs.length > 0 ? sysMsgs.join('\n\n') : (getVal('systemPrompt') || DEFAULT_CONFIG.system);
        apiMessages.push({ role: 'system', content: merged });
    } else {
        for (const msg of chats[chatId].messages) {
            if (msg.role === 'system' && !msg.temporary) {
                apiMessages.push({ role: 'system', content: msg.content });
            }
        }

        if (apiMessages.length === 0) {
            const defaultSystemContent = getVal('systemPrompt') || DEFAULT_CONFIG.system;
            apiMessages.push({ role: 'system', content: defaultSystemContent });
            if (!chats[chatId].messages.some(m => m.role === 'system' && !m.temporary)) {
                chats[chatId].messages.unshift({ role: 'system', content: defaultSystemContent });
            }
        }
    }

    // ★ 修复: 统一清理消息内容中的 [object Object] 残留
    function cleanObjectObject(val) {
        if (typeof val === 'string') {
            if (val === '[object Object]') return '';
            return val.replace(/\[object Object\]/g, '');
        }
        if (val && typeof val === 'object') {
            const extracted = val.text || val.content || val.value || '';
            if (extracted) return '' + extracted;
            if (Array.isArray(val)) {
                return val.map(c => typeof c === 'object' ? (c.text || c.content || '') : String(c)).filter(Boolean).join('');
            }
            try { return JSON.stringify(val); } catch(e) { return ''; }
        }
        return val === undefined || val === null ? '' : String(val);
    }

    const msgs = chats[chatId].messages;
    for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        if (msg.role === 'system') continue;
        if (msg.role === 'user') {
            const files = msg.files;
            // ★ 所有带图片的用户消息都传递 image_url，确保后续追问也能看到图片
            var msgHasImage = files && files.length > 0 && files.some(function(f) { return f.isImage || (f.type && f.type.startsWith('image/')); });
            var prev = window._forceVisionFormat;
            if (msgHasImage || (i === msgs.length - 1 && currentHasImage)) {
                window._forceVisionFormat = true;
            }
            apiMessages.push({ role: 'user', content: buildUserContent(msg.text, files) });
            window._forceVisionFormat = prev;
        } else if (msg.role === 'assistant' && !msg.partial) {
            apiMessages.push({ role: 'assistant', content: cleanObjectObject(msg.content) });
        } else if (msg.temporary) {
            // ★ MiniMax 兼容: 将临时 system 消息合并到最近一条 user/assistant 消息
            // 避免 MiniMax 因过多 system 消息导致无响应
            if (window.__isMiniMaxModel) {
                // 找到前面最近的非 system 消息,追加内容
                let lastIdx = apiMessages.length - 1;
                if (lastIdx >= 0 && apiMessages[lastIdx].role !== 'system') {
                    apiMessages[lastIdx].content += '\n\n' + cleanObjectObject(msg.content);
                } else {
                    // 没找到合适位置,作为 user 消息追加(不存 system role)
                    apiMessages.push({ role: 'user', content: cleanObjectObject(msg.content) });
                }
            } else {
                apiMessages.push({ role: msg.role, content: cleanObjectObject(msg.content) });
            }
        }
    }

    // 只有当前消息有图片时才使用视觉模型
    if (currentHasImage) {
        apiMessages._useVisionModel = true;
    }

    return apiMessages;
}

function adjustMaxTokens(model, requestedTokens, estimated) {
    var maxContext = modelContextLength[model] || 131072;
    var maxOutput = modelMaxOutputTokens[model] || maxContext;
    var maxAllowed = maxContext - estimated - MAX_TOKENS_SAFETY_MARGIN;
    if (maxAllowed < 256) return null;
    return Math.min(requestedTokens, maxAllowed, maxOutput);
}

async function streamResponse(res, chatId, pendingMsg, reasoningDelay, contentDelay) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let reasoningText = '';
    let hasContent = false;
    let usage = null;
    let placeholderCleared = false;
    let parseErrors = 0;
    // ★ 流式内容定期保存到 localStorage（防止刷新丢失）
    // 把 timer 挂在 pendingMsg 上，方便外部清理
    if (pendingMsg._streamSaveTimer) clearInterval(pendingMsg._streamSaveTimer);
    pendingMsg._streamSaveTimer = setInterval(function() {
        if (pendingMsg.content || pendingMsg.reasoning) {
            try {
                localStorage.setItem('_savedPartial', JSON.stringify({
                    chatId: chatId,
                    content: pendingMsg.content || '',
                    reasoning: pendingMsg.reasoning || ''
                }));
            } catch(e) {}
        }
    }, 2000);
    // 工具调用相关
    let toolCalls = [];
    let currentToolCall = null;
    let toolCallContent = '';
    let inToolCall = false;
    let toolCallCompleted = false; // ★ 标记:是否已保存完成的tool call,阻止重放覆盖

    while (true) {
        let readResult;
        try {
            readResult = await reader.read();
        } catch (readErr) {
            // 读取流数据异常,尝试用 buffer 中已有内容
            console.warn('[STREAM] 流读取异常:', readErr.message);
            break;
        }
        const { done, value } = readResult;
        if (done) {
            // 流结束:处理 buffer 中剩余的数据
            if (value) { buffer += decoder.decode(value, { stream: true }); }
            if (buffer.trim()) {
                var lastLines = buffer.split('\n');
                for (var li = 0; li < lastLines.length; li++) {
                    var l = lastLines[li].trim();
                    if (!l) continue;
                    var ljson = '';
                    if (l.startsWith('data: ') && l !== 'data: [DONE]') ljson = l.substring(6);
                    else if (l.startsWith('{')) ljson = l;
                    if (!ljson) continue;
                    try {
                        var jd = JSON.parse(ljson);
                        var dd = jd.choices?.[0]?.delta || jd.choices?.[0]?.message;
                        // content为空但reasoning有内容时，使用reasoning作为显示内容
                        if (dd && dd.content && String(dd.content).trim()) {
                            fullText += dd.content;
                        } else if (dd && dd.reasoning_content && String(dd.reasoning_content).trim()) {
                            fullText += String(dd.reasoning_content);
                        }
                        if (dd && dd.reasoning_content && String(dd.reasoning_content).trim()) reasoningText += String(dd.reasoning_content);
                        if (dd && dd.reasoning_details) { 
                            if (!pendingMsg._reasoningDetails) pendingMsg._reasoningDetails = [];
                            for (var rdi=0;rdi<dd.reasoning_details.length;rdi++) { 
                                if (dd.reasoning_details[rdi].text) {
                                    reasoningText += dd.reasoning_details[rdi].text;
                                    pendingMsg._reasoningDetails.push({type: 'reasoning.text', text: dd.reasoning_details[rdi].text});
                                }
                            }
                        }
                        if (jd.usage) usage = jd.usage;
                    } catch(e2) {}
                }
            }
            // Done分支: 对fullText做最后一次(think)标签清理(避免流式结束后的残留)
            if (fullText) {
                var _dThink = fullText;
                var _dMatchesThink = _dThink.match(/\(think\)([\s\S]*?)(?:\(endthink\)|$)/g);
                if (_dMatchesThink) {
                    var _dAllThink = '';
                    for (var _dmi = 0; _dmi < _dMatchesThink.length; _dmi++) {
                        _dAllThink += _dMatchesThink[_dmi].replace(/\(endthink\)/g, '').replace(/\(think\)/g, '');
                    }
                    fullText = fullText.replace(/\(think\)[\s\S]*?(?:\(endthink\)|$)/g, '').replace(/\(think\)\s*/g, '');
                    if (_dAllThink.trim() && !reasoningText) {
                        reasoningText = _dAllThink.trim();
                    }
                }
            }
            console.log('[STREAM] Done, final fullText:', fullText?.length, 'bytes');
            // 残留buffer原始内容（前200字节）
            if (buffer && buffer.trim()) {
                var bufPreview = buffer.substring(0, 200);
                console.log('[BUF-HEX] buffer start:', bufPreview);
                console.log('[BUF-HEX] starts with {?', buffer.trim().startsWith('{'), '| data:?', buffer.trim().startsWith('data:'), '| first char:', buffer.trim().charCodeAt(0));
            }
            break;
        }
        const decoded = decoder.decode(value, { stream: true });
        buffer += decoded;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            // 支持两种格式: SSE (data: {...}) 和 裸JSON ({...})
            var jsonStr = '';
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                jsonStr = line.substring(6);
            } else if (line.trim().startsWith('{')) {
                jsonStr = line.trim();
            }
            if (jsonStr) {
                try {
                    // 跳过空行或无效JSON
                    if (!jsonStr.trim()) continue;

                    // 尝试解析JSON,如果失败则跳过这行
                    let data;
                    try {
                        data = JSON.parse(jsonStr);
                    } catch (parseErr) {
                        // 如果解析失败,尝试找到有效的JSON部分
                        const match = jsonStr.match(/\{[\s\S]*\}/);
                        if (match) {
                            try {
                                data = JSON.parse(match[0]);
                            } catch {
                                parseErrors++;
                                console.warn('[JSON解析错误]', parseErr.message, '原文:', jsonStr.slice(0, 100));
                                continue;
                            }
                        } else {
                            parseErrors++;
                            console.warn('[JSON解析错误]', parseErr.message, '原文:', jsonStr.slice(0, 100));
                            continue;
                        }
                    }

                    const delta = data.choices?.[0]?.delta;
                    // 如果 delta 为空,跳过此条数据
                    if (!delta) {
                        console.warn('[流式解析] delta 为空,跳过');
                        continue;
                    }

                    // ★ MiniMax 兼容: 当 delta 中只有空的 role/reasoning_content 时跳过
                    // MiniMax 返回 { role: "", reasoning_content: "" } 的空chunk，不包含有效内容
                    if ((delta.content === undefined || delta.content === null) &&
                        delta.role !== undefined &&
                        (delta.role === '' || delta.role === 'assistant') &&
                        (delta.reasoning_content === '' || (delta.reasoning_content !== undefined && delta.reasoning_content !== null && delta.reasoning_content === '')) &&
                        !(delta.reasoning_details && delta.reasoning_details.length) &&
                        !(delta.tool_calls && delta.tool_calls.length)) {
                        console.log('[流式解析] MiniMax 空chunk,跳过');
                        continue;
                    }

                    // 处理工具调用
                    if (delta.tool_calls && delta.tool_calls.length > 0) {
                        for (const tc of delta.tool_calls) {
                            if (tc.index !== undefined && tc.index > 0 && currentToolCall) {
                                // 新的tool_call开始,保存之前的(仅当有有效内容时)
                                if (typeof currentToolCall.function.arguments === 'object') {
                                    currentToolCall.function.arguments = JSON.stringify(currentToolCall.function.arguments);
                                }
                                const currentArgs = typeof currentToolCall.function.arguments === 'string'
                                    ? currentToolCall.function.arguments
                                    : JSON.stringify(currentToolCall.function.arguments || '');
                                // 只保存有实际内容的tool call(跳过空/碎片)
                                const hasValidContent = currentArgs.length > 2 &&
                                    (currentArgs.includes('query') || currentArgs.includes('prompt') || currentToolCall.function?.name);
                                if (hasValidContent) {
                                    toolCalls.push(currentToolCall);
                                } else {
                                }
                                currentToolCall = null;
                            }
                            if (!currentToolCall) {
                                currentToolCall = {
                                    id: tc.id || `call_${Date.now()}_${toolCalls.length}`,
                                    type: 'function',
                                    function: {
                                        name: tc.function?.name || '',
                                        // arguments初始化:严格判断undefined/null,保留空字符串和其他所有值
                                        arguments: tc.function?.arguments === undefined ? '' : tc.function.arguments
                                    }
                                };
                            } else if (tc.function?.name) {
                                currentToolCall.function.name = tc.function.name;
                            }
                            // 如果有新的arguments,更新它
                            if (tc.function?.arguments !== undefined) {
                                if (typeof tc.function.arguments === 'object') {
                                    // 对象是完整的arguments,直接替换
                                    currentToolCall.function.arguments = tc.function.arguments;
                                } else if (typeof tc.function.arguments === 'string') {
                                    const newArg = tc.function.arguments;
                                    const isCompleteJSON = (newArg.trim().startsWith('{') && newArg.trim().endsWith('}')) ||
                                                           (newArg.trim().startsWith('[') && newArg.trim().endsWith(']'));

                                    if (typeof currentToolCall.function.arguments === 'string') {
                                        // 检查是否完全相同(避免Grok重复发送完整JSON)
                                        if (newArg === currentToolCall.function.arguments) {
                                        } else if (isCompleteJSON && currentToolCall.function.arguments.trim() !== '') {
                                            // 当前有内容且新来的是完整JSON,应该是替换而非拼接
                                            // ★ 修复: 如果已有完成的tool call,忽略这个完整JSON替换
                                            if (toolCallCompleted) {
                                            } else {
                                                currentToolCall.function.arguments = newArg;
                                            }
                                        } else {
                                            // ★ 修复: DeepSeek V4 Pro/Flash 在增量拼接完完整JSON后,
                                            // 会再发一遍同样的字符作为单独delta,导致无效累积
                                            // 检查 current 是否已经是闭合的有效JSON,如果是则跳过所有后续追加
                                            const curTrimmed = currentToolCall.function.arguments.trim();
                                            const looksComplete = (curTrimmed.startsWith('{') && curTrimmed.endsWith('}')) ||
                                                                  (curTrimmed.startsWith('[') && curTrimmed.endsWith(']'));
                                            if (looksComplete) {
                                                // 已闭合成完整JSON,验证有效性
                                                let isValid = false;
                                                try { JSON.parse(curTrimmed); isValid = true; } catch(e) {}
                                                if (isValid) {
                                                    // ★ 修复: 立即保存到toolCalls并标记完成,防止后续重放覆盖
                                                    if (!toolCallCompleted) {
                                                        const savedCall = JSON.parse(JSON.stringify(currentToolCall));
                                                        savedCall.function.arguments = JSON.parse(curTrimmed);
                                                        toolCalls.push(savedCall);
                                                        toolCallCompleted = true;
                                                        currentToolCall = null;
                                                    }
                                                } else {
                                                    currentToolCall.function.arguments += newArg;
                                                }
                                            } else {
                                                // 否则是增量片段,累加
                                                currentToolCall.function.arguments += newArg;
                                                // ★ 事后检查: 累加后如果变成完整有效JSON,立即保存
                                                if (!toolCallCompleted) {
                                                    const afterTrim = currentToolCall.function.arguments.trim();
                                                    if ((afterTrim.startsWith('{') && afterTrim.endsWith('}')) ||
                                                        (afterTrim.startsWith('[') && afterTrim.endsWith(']'))) {
                                                        try {
                                                            const parsed = JSON.parse(afterTrim);
                                                            const savedCall = JSON.parse(JSON.stringify(currentToolCall));
                                                            savedCall.function.arguments = parsed;
                                                            toolCalls.push(savedCall);
                                                            toolCallCompleted = true;
                                                            currentToolCall = null;
                                                        } catch(e) {}
                                                    }
                                                }
                                            }
                                        }
                                    } else {
                                        // 原来是对象(初始化时的 {}),新来的是字符串片段
                                        currentToolCall.function.arguments = newArg;
                                    }
                                }
                            }
                        }
                        inToolCall = true;
                        continue;
                    }

                    // 工具调用中的content(如果有)
                    if (inToolCall && delta.content !== undefined && delta.content !== null) {
                        toolCallContent += delta.content;
                        continue;
                    }

                    // 工具调用结束
                    if (inToolCall && currentToolCall && delta.content === undefined && delta.reasoning_content === undefined && !(delta.reasoning_details && delta.reasoning_details.length)) {
                        // 工具调用结束,清除placeholder
                        inToolCall = false;
                    }

                    // MiniMax reasoning_split 模式下,思考内容在 reasoning_details 数组中
                    const hasReasoningDetails = delta.reasoning_details && Array.isArray(delta.reasoning_details);
                    // 普通 reasoning_content (排除空字符串MiniMax空chunk)
                    const hasReasoningContent = delta.reasoning_content !== undefined && delta.reasoning_content !== null && delta.reasoning_content !== '';

                    if (!placeholderCleared && (hasReasoningContent || hasReasoningDetails || delta.content !== undefined)) {
                        const currentBubble = activeBubbleMap[chatId];
                        if (currentBubble && document.body.contains(currentBubble)) {
                            currentBubble.querySelector('.search-status')?.remove();
                        }
                        placeholderCleared = true;
                    }

                    // reasoning_details 数组格式 (MiniMax reasoning_split 模式)
                    if (hasReasoningDetails) {
                        for (const detail of delta.reasoning_details) {
                            if (detail && typeof detail.text === 'string') {
                                reasoningText += detail.text;
                            }
                        }
                        pendingMsg.reasoning = reasoningText;
                        if (currentChatId === chatId) {
                            const currentBubble = activeBubbleMap[chatId];
                            if (currentBubble) {
                                let details = currentBubble.querySelector('details.reasoning-details');
                                if (!details) {
                                    details = document.createElement('details');
                                    details.className = 'reasoning-details';
                                    details.open = true;
                                    details.innerHTML = `<summary>深度思考</summary><div class="reasoning-content"></div>`;
                                    const markdownBody = currentBubble.querySelector('.markdown-body');
                                    currentBubble.insertBefore(details, markdownBody);
                                }
                                details.querySelector('.reasoning-content').textContent = reasoningText;
                            }
                        }
                        const delay = document.hidden ? 0 : reasoningDelay;
                        await new Promise(r => setTimeout(r, delay));
                    } else if (hasReasoningContent) {
                        // 普通字符串格式 reasoning_content
                        reasoningText += String(delta.reasoning_content);
                        pendingMsg.reasoning = reasoningText;
                        if (currentChatId === chatId) {
                            const currentBubble = activeBubbleMap[chatId];
                            if (currentBubble) {
                                let details = currentBubble.querySelector('details.reasoning-details');
                                if (!details) {
                                    details = document.createElement('details');
                                    details.className = 'reasoning-details';
                                    details.open = true;
                                    details.innerHTML = `<summary>深度思考</summary><div class="reasoning-content"></div>`;
                                    const markdownBody = currentBubble.querySelector('.markdown-body');
                                    currentBubble.insertBefore(details, markdownBody);
                                }
                                details.querySelector('.reasoning-content').textContent = reasoningText;
                            }
                        }
                        const delay = document.hidden ? 0 : reasoningDelay;
                        await new Promise(r => setTimeout(r, delay));
                    }

                    const rawContent = delta.content ?? delta.text ?? delta.message?.content;
                    // 处理各种可能的数据类型，避免对象被错误地转为 [object Object]
                    let textContent = null;
                    if (rawContent !== undefined && rawContent !== null) {
                        if (typeof rawContent === 'string') {
                            textContent = rawContent;
                        } else if (typeof rawContent === 'object' && rawContent !== null) {
                            // ★ 修复: 不用 || 链式取值（空字符串 "" 是 falsy，会让 || 跳到下一项对象）
                            const st = (v) => (v !== null && v !== undefined && typeof v === 'string') ? v : null;
                            const ex = st(rawContent.text) || st(rawContent.content) || st(rawContent.value);
                            if (ex !== null) {
                                textContent = ex;
                            } else if (Array.isArray(rawContent)) {
                                textContent = rawContent.map(c =>
                                    typeof c === 'object' ? (st(c.text) || st(c.content) || st(c.value) || '') : String(c)
                                ).filter(Boolean).join('');
                            } else {
                                textContent = Object.values(rawContent).find(v => typeof v === 'string' && v) || '';
                            }
                        } else {
                            textContent = String(rawContent);
                        }
                    }

                    if (textContent && textContent.length > 0) {
                        fullText += textContent;
                        fullText = fullText.replace(/\[object Object\]/g, '');
                        
                        // ★ 实时提取所有<think>和(think)块到思考区
                        var _t = fullText;
                        var _allThink = '';
                        // 提取 <think>...</think> 标签
                        var _matches = _t.match(/<think>([\s\S]*?)(?:<\/think>|$)/g);
                        if (_matches) {
                            for (var _mi = 0; _mi < _matches.length; _mi++) {
                                _allThink += _matches[_mi].replace(/<\/?think>/g, '');
                            }
                            _t = _t.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '');
                        }
                        // 提取 MiniMax (think) 和 (endthink) 格式 (MiniMax M2.7)
                        var _t2 = _t;
                        var _matches2 = _t2.match(/\(think\)([\s\S]*?)(?:\(endthink\)|$)/g);
                        if (_matches2) {
                            for (var _mi2 = 0; _mi2 < _matches2.length; _mi2++) {
                                _allThink += _matches2[_mi2].replace(/\(endthink\)/g, '').replace(/\(think\)/g, '');
                            }
                            _t = _t.replace(/\(think\)[\s\S]*?(?:\(endthink\)|$)/g, '');
                        }
                        // 也处理只有开头的 (think) 后面没有关闭标签的情况
                        _t = _t.replace(/\(think\)\s*/g, '');
                        if (_allThink.trim()) {
                            reasoningText = _allThink.trim();
                            pendingMsg.reasoning = reasoningText;
                        }
                        pendingMsg.content = _t.trim() || (_allThink.trim() ? '' : fullText);
                        var _displayText = _t.trim();
                        // ★ 如果正文为空但思考有内容，不显示原始 (think) 标签
                        if (!_displayText && _allThink.trim()) {
                            _displayText = '';
                        } else if (!_displayText) {
                            _displayText = '';
                        }
                        
                        if (currentChatId === chatId) {
                            var currentBubble = activeBubbleMap[chatId];
                            if (currentBubble) {
                                if (!hasContent) {
                                    currentBubble.classList.remove('typing');
                                    hasContent = true;
                                }
                                // 实时更新思考区
                                if (reasoningText) {
                                    var _det3 = currentBubble.querySelector('details.reasoning-details');
                                    if (!_det3) {
                                        _det3 = document.createElement('details');
                                        _det3.className = 'reasoning-details';
                                        _det3.open = true;
                                        _det3.innerHTML = '<summary>深度思考</summary><div class="reasoning-content"></div>';
                                        var _mb2 = currentBubble.querySelector('.markdown-body');
                                        if (_mb2) currentBubble.insertBefore(_det3, _mb2);
                                    }
                                    _det3.querySelector('.reasoning-content').textContent = reasoningText;
                                }
                                // 流式渲染正文
                                var markdownBody = currentBubble.querySelector('.markdown-body');
                                if (markdownBody && window.marked) {
                                    try {
                                        // ★ 使用已清理 (think) 标签的 _t，而非原始 fullText
                                        var _renderText = typeof _t !== 'undefined' ? _t : fullText;
                                        const segments = _renderText.split('```');
                                        let html = '';
                                        for (let s = 0; s < segments.length; s++) {
                                            if (s % 2 === 0) {
                                                if (segments[s]) html += _renderMarkdownWithMath(autoLinkURLs(segments[s].replace(/!\[(.*?)\]\((.*?)\)/g, '[图片 $1]($2)')));
                                            } else {
                                                const seg = segments[s];
                                                const nlIdx = seg.indexOf('\n');
                                                const lang = nlIdx > 0 ? seg.slice(0, nlIdx).trim() : '';
                                                const code = nlIdx > 0 ? seg.slice(nlIdx + 1) : seg;
                                                const langAttr = lang ? ' class="language-' + lang + '"' : '';
                                                html += '<pre><code' + langAttr + '>' + escapeHtml(code) + '</code></pre>';
                                            }
                                        }
                                        markdownBody.innerHTML = html;
                                        if (window.hljs) {
                                            markdownBody.querySelectorAll('pre code:not(.hljs):not([class*="mermaid"])').forEach(function(block) {
                                                try { hljs.highlightElement(block); } catch(e) {}
                                            });
                                        }
                                    } catch (mdErr) {
                                        console.warn('[流式MD渲染失败]', mdErr.message);
                                        markdownBody.textContent = typeof _t !== 'undefined' ? _t : fullText;
                                    }
                                } else if (markdownBody) {
                                    markdownBody.textContent = typeof _t !== 'undefined' ? _t : fullText;
                                }
                                // AI流式回复时,如果用户没有主动滚动上查,则跟随滚动
                                const { scrollTop, scrollHeight, clientHeight } = $.chatBox;
                                if (!userScrolled && scrollHeight - scrollTop - clientHeight < 100) {
                                    autoScrollToBottom('streaming');
                                }
                            }
                        }
                        const delay = document.hidden ? 0 : contentDelay;
                        await new Promise(r => setTimeout(r, delay));
                    }

                    if (data.usage) usage = data.usage;
                } catch (e) {
                    parseErrors++;
                    console.warn('[流式解析错误]', line?.slice(0, 100), e.message);
                }
            }
        }
    }

    // ★ 修复: 保存最后一个tool_call
    // DeepSeek V4 会在第一次增量拼接完整JSON后,再逐字符发一遍重放,
    // 重放会触发新INIT覆盖currentToolCall,所以流结束时可能只剩碎片字符(如"}")
    if (currentToolCall && !toolCallCompleted) {
        // 如果是对象,先转为JSON字符串
        if (typeof currentToolCall.function.arguments === 'object') {
            currentToolCall.function.arguments = JSON.stringify(currentToolCall.function.arguments);
        }
        // 如果是字符串,尝试解析为对象
        if (typeof currentToolCall.function.arguments === 'string') {
            let argsStr = currentToolCall.function.arguments.trim();
            
            // ★ 修复: 忽略单字符/碎片(DeepSeek V4重放产物)
            if (argsStr.length <= 2 && (argsStr === '}' || argsStr === ']' || argsStr === '')) {
                currentToolCall = null;
                return { fullText, reasoningText, usage, toolCalls };
            }
            
            // 检查是否包含[object Object]前缀
            if (argsStr.startsWith('[object Object]')) {
                argsStr = argsStr.substring('[object Object]'.length);
            }

            // 尝试解析,如果失败可能是多个JSON拼接或截断,提取第一个
            try {
                currentToolCall.function.arguments = JSON.parse(argsStr);
            } catch (e) {
                // 尝试修复截断的JSON:补全缺失的引号和括号
                var fixedStr = argsStr;
                // 计数引号,如果是奇数则补一个
                var quoteCount = (fixedStr.match(/"/g) || []).length;
                if (quoteCount % 2 !== 0) fixedStr += '"';
                // 补全缺失的闭合括号
                var openBraces = (fixedStr.match(/\{/g) || []).length;
                var closeBraces = (fixedStr.match(/\}/g) || []).length;
                while (closeBraces < openBraces) { fixedStr += '}'; closeBraces++; }
                
                try {
                    currentToolCall.function.arguments = JSON.parse(fixedStr);
                } catch (e2) {
                    // 提取第一个JSON对象
                    var firstBrace = argsStr.indexOf('{');
                    var lastBrace = argsStr.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                        var firstJson = argsStr.substring(firstBrace, lastBrace + 1);
                        try {
                            currentToolCall.function.arguments = JSON.parse(firstJson);
                        } catch (e3) {
                            // 最终兜底:使用原始文本作为query
                            currentToolCall.function.arguments = { query: argsStr };
                        }
                    } else {
                        currentToolCall.function.arguments = { query: argsStr };
                    }
                }
            }
        }
        toolCalls.push(currentToolCall);
    }

    // 如果全部解析失败且无任何内容,给用户提示
    if (!fullText && !reasoningText && !toolCalls.length && parseErrors > 0) {
        const currentBubble = activeBubbleMap[chatId];
        if (currentBubble && document.body.contains(currentBubble)) {
            currentBubble.querySelector('.markdown-body').innerHTML = `<span style="color:#ef4444">⚠️ 部分响应解析失败,可能是 API 返回格式不兼容。</span>`;
            currentBubble.classList.remove('typing');
        }
    }
    if (toolCalls.length > 0) {
    }
    // MiniMax <think>标签:提取到思考区,正文只显示正文
    // 保存原始内容给API重试
    if (fullText && fullText.includes('<think>')) {
        pendingMsg._rawContent = fullText;
    }
    // 流结束时关闭思考区折叠
    if (reasoningText && currentChatId === chatId) {
        var _cb2 = activeBubbleMap[chatId];
        if (_cb2) {
            var _det4 = _cb2.querySelector('details.reasoning-details');
            if (_det4) _det4.open = true;
        }
    }
    // ★ 流式已经实时渲染了数学公式，不需要再次渲染
    if (toolCalls.length > 0) {
    }
    // 有思考但无正文:确保气泡有内容显示(思考已在折叠框,这里只确保气泡不空)
    if (!fullText && reasoningText) {
        pendingMsg.content = reasoningText;
    }

    // ★ MiniMax/模型兼容: 从 content 中解析文本格式的工具调用
    // 支持三种格式: <minimax:tool_call> XML, [TOOL_CALL] 括号格式
    if (!toolCalls.length && fullText && (fullText.includes('<minimax:tool_call>') || fullText.includes('[TOOL_CALL]'))) {
        console.log('[ToolCall] 检测到文本格式工具调用，开始解析...');

        // 格式1: <minimax:tool_call><invoke name="xxx"><parameter name="x">v</parameter></invoke></minimax:tool_call>
        const xmlRegex = /<minimax:tool_call>([\s\S]*?)<\/minimax:tool_call>/g;
        let xmlMatch;
        while ((xmlMatch = xmlRegex.exec(fullText)) !== null) {
            const invokeMatch = xmlMatch[1].match(/<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/);
            if (invokeMatch) {
                const funcName = invokeMatch[1];
                const args = {};
                const paramRegex = /<parameter name="([^"]+)">([^<]*)<\/parameter>/g;
                let pMatch;
                while ((pMatch = paramRegex.exec(invokeMatch[2])) !== null) {
                    const paramName = pMatch[1];
                    let paramValue = pMatch[2].trim();
                    try { paramValue = JSON.parse(paramValue); } catch(e) {}
                    args[paramName] = paramValue;
                }
                toolCalls.push({ id: 'call_mm_' + Date.now() + '_' + toolCalls.length, type: 'function', function: { name: funcName, arguments: JSON.stringify(args) } });
                console.log('[ToolCall] XML格式 提取:', funcName, args);
            }
        }

        // 格式2: [TOOL_CALL]\n{tool => "web_search", args => {--query "xxx"}}\n[/TOOL_CALL]
        const tcRegex = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"([^"]+)"[^}]*args\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\}[\s\S]*?\[\/TOOL_CALL\]/g;
        let tcMatch;
        while ((tcMatch = tcRegex.exec(fullText)) !== null) {
            const funcName = tcMatch[1];
            const argsBlock = tcMatch[2];
            const args = {};
            const paramRegex = /--(\w+)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/g;
            let pMatch;
            while ((pMatch = paramRegex.exec(argsBlock)) !== null) {
                const paramName = pMatch[1];
                const paramValue = pMatch[2] !== undefined ? pMatch[2] : (pMatch[3] !== undefined ? pMatch[3] : pMatch[4]);
                args[paramName] = paramValue;
            }
            toolCalls.push({ id: 'call_mm_' + Date.now() + '_' + toolCalls.length, type: 'function', function: { name: funcName, arguments: JSON.stringify(args) } });
            console.log('[ToolCall] TOOL_CALL格式 提取:', funcName, args);
        }

        // 清理: 移除所有工具调用标记,保留前面的思考文本
        fullText = fullText.replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, '').trim();
        fullText = fullText.replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g, '').trim();
        if (!fullText && reasoningText) { fullText = reasoningText; }
    }

    return { fullText, reasoningText, usage, toolCalls };
}

async function handleNonStream(res, chatId, pendingMsg, currentBubble) {
    // 首先检查响应状态
    if (!res.ok) {
        // 对于错误响应,不要尝试读取 body
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    let data;
    try {
        let rawText = await res.text();
        if (rawText.startsWith('data: ') || rawText.includes('\ndata: ')) {
            // SSE格式非流式响应:提取所有data:行内容
            let allContent = '';
            let lines = rawText.split('\n');
            for (let l of lines) {
                if (l.startsWith('data: ') && l !== 'data: [DONE]') {
                    try {
                        let chunk = JSON.parse(l.substring(6));
                        let c = chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content;
                        if (c) allContent += c;
                    } catch(e2) {}
                }
            }
            data = { choices: [{ message: { content: allContent } }] };
        } else {
            try {
                data = JSON.parse(rawText);
            } catch(e3) { throw new Error('响应格式错误: ' + e3.message); }
        }

    } catch (e) {
        // 如果 JSON 解析失败,可能是响应格式问题
        // 注意:我们不能再读取 .text(),因为 body 可能已经被消耗
        console.error('[非流式响应JSON解析失败]', e.message);
        throw new Error(`响应格式错误: ${e.message}`);
    }

    // 检查 API 错误信息
    if (data.error) {
        throw new Error(`API 错误: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const choice = data.choices?.[0];
    if (!choice) {
        throw new Error('API 返回无有效 choices');
    }

    const msg = choice.message || {};
    const st = (v) => (v !== null && v !== undefined && typeof v === 'string') ? v : null;
    let fullText = '';
    if (msg.content !== undefined && msg.content !== null) {
        if (typeof msg.content === 'string') {
            fullText = msg.content;
        } else if (typeof msg.content === 'object') {
            const ex = st(msg.content.text) || st(msg.content.content) || st(msg.content.value);
            if (ex !== null) {
                fullText = ex;
            } else if (Array.isArray(msg.content)) {
                fullText = msg.content.map(c =>
                    typeof c === 'object' ? (st(c.text) || st(c.content) || st(c.value) || '') : String(c)
                ).filter(Boolean).join('');
            } else {
                fullText = Object.values(msg.content).find(v => typeof v === 'string' && v) || '';
            }
        } else {
            fullText = String(msg.content);
        }
    }
    fullText = (fullText || '').replace(/\[object Object\]/g, '');
    let reasoningText = '';
    let toolCalls = msg.tool_calls || [];

    // ★ MiniMax/模型兼容: 从 content 中解析文本格式的工具调用
    // 支持三种格式: <minimax:tool_call> XML, [TOOL_CALL] 括号格式
    if (!toolCalls.length && fullText && (fullText.includes('<minimax:tool_call>') || fullText.includes('[TOOL_CALL]'))) {
        console.log('[ToolCall非流式] 检测到文本格式工具调用，开始解析...');

        // 格式1: <minimax:tool_call><invoke name="xxx"><parameter name="x">v</parameter></invoke></minimax:tool_call>
        const xmlRegex = /<minimax:tool_call>([\s\S]*?)<\/minimax:tool_call>/g;
        let xmlMatch;
        while ((xmlMatch = xmlRegex.exec(fullText)) !== null) {
            const invokeMatch = xmlMatch[1].match(/<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/);
            if (invokeMatch) {
                const funcName = invokeMatch[1];
                const args = {};
                const paramRegex = /<parameter name="([^"]+)">([^<]*)<\/parameter>/g;
                let pMatch;
                while ((pMatch = paramRegex.exec(invokeMatch[2])) !== null) {
                    const paramName = pMatch[1];
                    let paramValue = pMatch[2].trim();
                    try { paramValue = JSON.parse(paramValue); } catch(e) {}
                    args[paramName] = paramValue;
                }
                toolCalls.push({ id: 'call_mm_' + Date.now() + '_' + toolCalls.length, type: 'function', function: { name: funcName, arguments: JSON.stringify(args) } });
                console.log('[ToolCall非流式] XML格式 提取:', funcName, args);
            }
        }

        // 格式2: [TOOL_CALL]\n{tool => "web_search", args => {--query "xxx"}}\n[/TOOL_CALL]
        const tcRegex = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"([^"]+)"[^}]*args\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\}[\s\S]*?\[\/TOOL_CALL\]/g;
        let tcMatch;
        while ((tcMatch = tcRegex.exec(fullText)) !== null) {
            const funcName = tcMatch[1];
            const argsBlock = tcMatch[2];
            const args = {};
            const paramRegex = /--(\w+)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/g;
            let pMatch;
            while ((pMatch = paramRegex.exec(argsBlock)) !== null) {
                const paramName = pMatch[1];
                const paramValue = pMatch[2] !== undefined ? pMatch[2] : (pMatch[3] !== undefined ? pMatch[3] : pMatch[4]);
                args[paramName] = paramValue;
            }
            toolCalls.push({ id: 'call_mm_' + Date.now() + '_' + toolCalls.length, type: 'function', function: { name: funcName, arguments: JSON.stringify(args) } });
            console.log('[ToolCall非流式] TOOL_CALL格式 提取:', funcName, args);
        }

        fullText = fullText.replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, '').trim();
        fullText = fullText.replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g, '').trim();
    }

    const usage = data.usage;

    // 处理 reasoning_details(MiniMax 特有格式)
    if (msg.reasoning_details && Array.isArray(msg.reasoning_details)) {
        reasoningText = msg.reasoning_details.map(d => d.text || '').join('');
    } else if (msg.reasoning_content) {
        reasoningText = msg.reasoning_content;
    } else if (msg.reasoning) {
        reasoningText = msg.reasoning;
    }
    // 兜底确保 reasoningText 是字符串（不再覆盖上面的提取结果）
    if (!reasoningText) {
        const rc = msg.reasoning_content ?? msg.reasoning;
        if (rc !== null && rc !== undefined) reasoningText = String(rc);
    }
    if (typeof reasoningText !== 'string') reasoningText = '';

    // ★ MiniMax (think)标签提取到思考区
    var _ht = fullText;
    var _htAllThink = '';
    var _htMatches = _ht.match(/\(think\)([\s\S]*?)(?:\(endthink\)|$)/g);
    if (_htMatches) {
        for (var _hti = 0; _hti < _htMatches.length; _hti++) {
            _htAllThink += _htMatches[_hti].replace(/\(endthink\)/g, '').replace(/\(think\)/g, '');
        }
        fullText = fullText.replace(/\(think\)[\s\S]*?(?:\(endthink\)|$)/g, '').replace(/\(think\)\s*/g, '');
    }
    if (_htAllThink.trim() && !reasoningText) {
        reasoningText = _htAllThink.trim();
    }
    pendingMsg.content = fullText.replace(/\[object Object\]/g, '');
    pendingMsg.reasoning = reasoningText;

    if (currentChatId === chatId && currentBubble) {
        currentBubble.classList.remove('typing');
        const markdownBody = currentBubble.querySelector('.markdown-body');
        if (markdownBody) {
            markdownBody.innerHTML = '';
            if (reasoningText) {
                const reasoningEl = document.createElement('div');
                reasoningEl.className = 'reasoning';
                reasoningEl.textContent = reasoningText;
                markdownBody.appendChild(reasoningEl);
            }
            if (fullText) {
                const contentEl = document.createElement('div');
                contentEl.innerHTML = _renderMarkdownWithMath(fullText);
                markdownBody.appendChild(contentEl);
            }
        }
    }

    return { fullText, reasoningText, usage, toolCalls };
}

function handleError(e, chatId, pendingMsg, currentBubble) {
    // ★ 清除流式保存定时器
    if (pendingMsg && pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
    // ★ 通知模式解锁
    window._agentNotifyProcessing = false;
    const hasContent = pendingMsg && pendingMsg.content && typeof pendingMsg.content === 'string' && pendingMsg.content.trim() !== '';
    const hasReasoning = pendingMsg && pendingMsg.reasoning && typeof pendingMsg.reasoning === 'string' && pendingMsg.reasoning.trim() !== '';
    if (!hasContent && !hasReasoning) {
        const chatMessages = (chats && chats[chatId]) ? chats[chatId].messages : null;
        if (chatMessages) {
            const idx = chatMessages.findIndex(m => m.partial);
            if (idx !== -1) chatMessages.splice(idx, 1);
        }
    } else {
        if (pendingMsg) {
            delete pendingMsg.partial;
            try { localStorage.removeItem('_savedPartial'); } catch(e) {}
            pendingMsg.content = pendingMsg.content || '';
            pendingMsg.reasoning = pendingMsg.reasoning || '';
        }
    }
    saveChats();
    if (currentChatId === chatId && currentBubble) {
        currentBubble.classList.remove('typing');
        // 配置面板编辑时不显示错误,避免频繁报错
        if (!configPanelInteracting) {
            var errorMsg = e.name === 'AbortError' ? '⚠️ 请求已停止或超时。' : `❌ 错误: ${e.message}`;
            currentBubble.querySelector('.markdown-body').innerHTML = errorMsg;
        } else {
            currentBubble.querySelector('.markdown-body').innerHTML = '';
        }
    } else if (currentChatId === chatId) {
        loadChat(chatId);
    }
    if (!configPanelInteracting) {
        showToast(`请求失败: ${e.message}`, 'error');
    }
}

// ==================== 自动错误恢复功能 ====================
// 当检测到模型不支持 image_url 格式时,自动将其标记为文本模型并重试
window.autoDetectAndRetryImageUrlError = async function(errorMessage, chatId, pendingMsg, currentBubble) {
    // 检测是否是 image_url 格式错误
    if (!errorMessage.includes("unknown variant") && !errorMessage.includes("image_url")) {
        return false;
    }
    // 获取当前模型
    const currentModel = getVal('modelSelect') || '';

    if (!currentModel) {
        return false;
    }

    // 将模型添加到文本模型列表
    try {
        const autoTextModels = JSON.parse(localStorage.getItem('autoDetectedTextModels') || '[]');
        if (!autoTextModels.includes(currentModel)) {
            autoTextModels.push(currentModel);
            localStorage.setItem('autoDetectedTextModels', JSON.stringify(autoTextModels));
        }
    } catch (e) {
        console.error('[AutoRecovery] 保存文本模型列表失败:', e);
    }

    // 显示提示
    showToast('模型 ' + currentModel + ' 不支持图片格式,已自动切换到工具调用模式', 'warning', 3000);

    // 清理当前错误消息
    if (currentBubble) {
        currentBubble.classList.remove('typing');
        currentBubble.querySelector('.markdown-body').innerHTML = '⚠️ 模型不支持图片格式,正在重新发送...';
    }

    // 从聊天历史中移除最后的助手消息
    if (chatId && chats[chatId]) {
        const msgs = chats[chatId].messages;
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant' && msgs[i].partial) {
                msgs.splice(i, 1);
                break;
            }
        }
        saveChats();
    }

    // 重新发送之前的用户消息
    if (chatId && chats[chatId]) {
        const lastUser = [...chats[chatId].messages].reverse().find(m => m.role === 'user' && !m.temporary);
        if (lastUser) {

            setTimeout(async () => {
                try {
                    // ★ 自动重发（图片已由文本模型列表屏蔽，走 analyze_image 工具）
                    await sendMessage(true, lastUser.text, lastUser.files);
                } catch (e) {
                    console.error('[AutoRecovery] 重发失败:', e);
                }
            }, 1000);

            return true;
        }
    }

    return false;
};

window.sendMessage = async function (skipUserAdd = false, userTextForRegen = null, userFilesForRegen = null) {
    // ★ 任务批次隔离：用户消息开启新批次，内部通知复用当前批次
    if (!skipUserAdd) {
        // 用户发起的消息 → 新任务批次开始，清空旧的子代理追踪
        window._currentGroupId = (window._currentGroupId || 0) + 1;
        window._activeSubAgentGroup = [];  // {name, groupId} 列表
        console.log('[Agent] 新任务批次开始，groupId=' + window._currentGroupId);
    }
    
    if (!rateLimit.allowed()) {
        showToast('请求过于频繁', 'warning');
        return;
    }

    // 检查模型是否还在加载
    const modelVal = getVal('modelSelect');
    if (!modelVal || modelVal === '加载中...') {
        showToast('模型列表加载中,请稍后再试', 'warning');
        return;
    }

    const chatId = currentChatId;
    if (!chatId) return;
    if (isTypingMap[chatId]) {
        showToast('⏳ 正在生成中...', 'warning');
        return;
    }

    const input = $.userInput;
    let text = skipUserAdd ? userTextForRegen : input?.value.trim() || '';
    let files = skipUserAdd ? userFilesForRegen : pendingFiles;

    if (!skipUserAdd && !text && !files.length) {
        stopGenerationForChat(chatId);
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
        return;
    }

    // 按需生成临时时间戳消息(基于关键词)
    const temporaryTimestamp = createTemporaryTimestampIfNeeded(text);

    // 移除旧的临时消息
    chats[chatId].messages = chats[chatId].messages.filter(m => !m.temporary);
    const partialIdx = chats[chatId].messages.findIndex(m => m.partial);
    if (partialIdx !== -1) chats[chatId].messages.splice(partialIdx, 1);

    // 停止旧请求(不设置用户停止标记,以便新请求可以正常重试)
    abortExistingRequest(chatId);

    const abortMain = new AbortController();
    abortControllerMap[chatId] = abortMain;
    const abortSearch = new AbortController();
    searchAbortControllerMap[chatId] = abortSearch;

    isTypingMap[chatId] = true;
    if ($.sendBtn) $.sendBtn.classList.add('hidden');
    if ($.stopBtn) $.stopBtn.classList.add('visible');

    // 处理命令
    const command = parseCommand(text);
    const forceSearch = !!command;
    let queryText = command ? command.query : text;
    const forcedType = command ? command.type : null;

    // 构建历史摘要
    const historySummary = buildHistorySummary(chatId);

    // 添加用户消息
    // 保存当前消息是否包含图片(在 clearAllFiles 之前)
    const currentMessageHasImages = files && files.length > 0 && files.some(f => f.isImage || f.type?.startsWith('image/'));

    // 立即清空输入框,让用户知道消息已发送
    if (input) {
        input.value = '';
        window.autoResize(input);
    }

    // 如果有图片,不自动分析,让AI自主决定是否调用分析工具
    // 图片会作为附件发送给AI,AI可以自主选择是否使用 analyze_image 工具

    if (!skipUserAdd) {
        chats[chatId].messages.push({ role: 'user', text, files: files.map(f => ({ name: f.name, content: f.content, size: f.size, type: f.type || (f.isImage ? 'image/' : '') })) });
        // ★ 用户消息发出后立即保存，确保未开新会话时数据不丢
        slimSaveChats();
        if (chats[chatId].title === '新对话') {
            chats[chatId].title = text ? text.slice(0, 10) : (files.length ? '文件消息' : '新对话');
        }
        if (currentChatId === chatId) loadChat(chatId);
        // 输入框已在前面清空
        clearAllFiles();
    }

    // 创建占位气泡
    const pendingMsg = { role: 'assistant', content: '', reasoning: '', partial: true };
    chats[chatId].messages.push(pendingMsg);
    let currentBubble = null;
    if (currentChatId === chatId) {
        currentBubble = appendMessage('assistant', '', null, null, null, 0, false);
        if (currentBubble) currentBubble.classList.add('typing');
        activeBubbleMap[chatId] = currentBubble;
    }

    // 执行搜索
    const _modelMiniMax2 = (getVal('modelSelect') || '').toLowerCase().includes('minimax');
    // ★ 修复: MiniMax 也启用工具调用模式,让模型通过 tool_calls 决定何时搜索
    const useToolCall = getChecked('searchToolCallToggle') || (files.length > 0 && files.some(f => f.isImage || f.type?.startsWith('image/')));
    let searchResult = { searchPerformed: false, searchResults: null, optimized: null, searchError: null };
    // 工具调用模式下不主动搜索,让模型通过tool_calls决定何时搜索
    if (!useToolCall && (getChecked('searchToggle') || forceSearch)) {
        searchResult = await handleSearchFlow(chatId, text, forceSearch, queryText, historySummary, abortSearch.signal, currentBubble, forcedType);
    }

    // 保存搜索结果
    if (searchResult.searchPerformed && searchResult.optimized) {
        if (getChecked('searchAppendToSystem')) {
            chats[chatId].messages.push({ role: 'system', content: searchResult.optimized });
        } else {
            chats[chatId].messages.push({ role: 'system', content: searchResult.optimized, temporary: true });
        }
    }

    // 可选:上下文压缩
    if (!skipUserAdd && getChecked('compressToggle')) {
        const threshold = parseInt(getVal('compressThreshold')) || 10;
        const nonSys = chats[chatId].messages.filter(m => m.role !== 'system' && !m.partial && !m.temporary).length;
        if (nonSys > threshold) await compressContextIfNeeded(chatId);
    }

    // 构建API消息
    // ★ 提前设置 MiniMax 标记,供 buildApiMessages 使用
    window.__isMiniMaxModel = (getVal('modelSelect') || '').toLowerCase().includes('minimax');
    let apiMessages = buildApiMessages(chatId);
    
    // 如果有临时时间戳,插入到系统消息之后
    // ★ MiniMax 合并: 时间戳合并到 system 消息,避免 extra system message
    if (temporaryTimestamp) {
        const _isMm = (getVal('modelSelect') || '').toLowerCase().includes('minimax');
        if (_isMm) {
            const sysIdx = apiMessages.findIndex(m => m.role === 'system');
            if (sysIdx !== -1) {
                apiMessages[sysIdx].content += '\n\n' + temporaryTimestamp.content;
            } else {
                // 没有 system 消息,找到 user 消息前面插入
                const userIdx = apiMessages.findIndex(m => m.role === 'user');
                if (userIdx !== -1) {
                    apiMessages[userIdx].content = temporaryTimestamp.content + '\n\n' + apiMessages[userIdx].content;
                } else {
                    apiMessages.unshift(temporaryTimestamp);
                }
            }
        } else {
            const sysIndex = apiMessages.findIndex(m => m.role === 'system');
            if (sysIndex !== -1) {
                apiMessages.splice(sysIndex + 1, 0, temporaryTimestamp);
            } else {
                apiMessages.unshift(temporaryTimestamp);
            }
        }
    }

    // ★ MiniMax: 追加工具调用强提示(简洁版,不引用(think)标签避免XML格式冲突)
    const __isMiniMaxModel = (getVal('modelSelect') || '').toLowerCase().includes('minimax');
    if (__isMiniMaxModel && getChecked('searchToggle')) {
        const toolHint = '你可以使用 web_search 搜索最新信息,使用 web_fetch 抓取网页详情。需要最新信息时请主动调用工具。';
        // ★ MiniMax 合并: 追加到最后一条非 system 消息,避免 extra system message 导致无响应
        let lastNonSysIdx = apiMessages.length - 1;
        while (lastNonSysIdx >= 0 && apiMessages[lastNonSysIdx].role === 'system') lastNonSysIdx--;
        if (lastNonSysIdx >= 0) {
            apiMessages[lastNonSysIdx].content += '\n\n' + toolHint;
        } else {
            apiMessages.push({ role: 'user', content: toolHint });
        }
    }

    // ★ Agent 模式: 合并 agent 系统提示词
    if (localStorage.getItem('agentMode') === 'true') {
        var agentPrompt = localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt;
        if (agentPrompt) {
            // 追加到第一条 system 消息
            var sysIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
            if (sysIdx !== -1) {
                apiMessages[sysIdx].content = apiMessages[sysIdx].content + '\n\n' + agentPrompt;
            } else {
                // 没有 system 消息,在最前面插入
                apiMessages.unshift({ role: 'system', content: agentPrompt });
            }
        }
    }
    
    // ★ 内部 Agent 上下文注入（必须在 agent 提示词之后，确保覆盖创建子代理指令）
    if (window.__internalAgentContext) {
        var ctx = window.__internalAgentContext;
        delete window.__internalAgentContext;
        var sysIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
        if (sysIdx !== -1) {
            apiMessages[sysIdx].content += '\n\n' + ctx;
        } else {
            apiMessages.unshift({ role: 'system', content: ctx });
        }
    }

    // 选择模型
    let model = getVal('modelSelect') || DEFAULT_CONFIG.model;
    // 图片由 analyze_image 工具处理,不切换模型(analyze_image 会调用 MCP 桥接)
    // 保持使用当前文本模型即可
    if (searchResult.searchPerformed && searchResult.searchResults?.length) {
        const searchModel = getVal('searchModel');
        if (searchModel && searchModel !== '加载中...') model = searchModel;
    }

    // 估算tokens(排除base64图片数据,处理数组格式)
    const totalText = apiMessages.map(m => {
        if (Array.isArray(m.content)) {
            // 数组格式(视觉模型):提取所有文本部分
            return m.content.map(item => {
                if (item.type === 'text') {
                    return item.text || '';
                }
                return '[图片]';
            }).join(' ');
        } else if (typeof m.content === 'string') {
            // 字符串格式:移除base64图片数据
            return m.content.replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/g, '[图片]');
        }
        return '';
    }).join(' ');
    const estimated = estimateTokens(totalText);
    const requestedTokens = parseInt(getVal('maxTokens')) || 4096;
    const adjustedTokens = adjustMaxTokens(model, requestedTokens, estimated);
    if (adjustedTokens === null) {
        handleError(new Error('消息过长,请压缩或减少历史'), chatId, pendingMsg, currentBubble);
        return;
    }
    if (adjustedTokens < requestedTokens) {
        console.warn(`max_tokens 从 ${requestedTokens} 调整为 ${adjustedTokens}`);
        setVal('maxTokens', adjustedTokens);
        setVal('maxTokensInput', adjustedTokens);
    }

    // 构建请求体
    const body = {
        model,
        messages: apiMessages,
        stream: getChecked('streamToggle'),
        temperature: parseFloat(getVal('temperature')) || 0.7,
        max_tokens: adjustedTokens
    };

    // 统一获取模型选择并转小写
    const currentModel = getVal('modelSelect') || '';
    const modelLower = currentModel.toLowerCase();

    // MiniMax M2: 启用 reasoning_split 以分离思考内容
    const isMiniMaxModel = modelLower.includes('minimax');
    // MiniMax M2: 默认使用<think>标签模式(不传reasoning_split以避免参数错误)

    // ★ Agent 模式: 始终启用工具调用
    var agentModeActive = localStorage.getItem('agentMode') === 'true';
    var effectiveToolCall = useToolCall || currentMessageHasImages || agentModeActive;
    
    // 添加工具定义(使用提前保存的当前消息图片状态)
    if (effectiveToolCall) {
        // 只对支持视觉的模型添加图生图工具,文本模型无法处理图片参数
    // 图生图工具:所有模型都可使用,因为系统会自动获取用户上传的图片
    // 注意:generate_image_i2i 工具的参数 image 会由系统自动填充,不需要AI处理
    const i2iTool = IMAGE_I2I_TOOL_DEFINITION;

    // 构建工具列表
    const imageTools = [IMAGE_TOOL_DEFINITION, ANALYZE_IMAGE_TOOL];
    if (i2iTool) imageTools.push(i2iTool);

    // 构建工具列表：根据搜索开关和工具模式动态选择
    const searchOn = getChecked('searchToggle');
    const toolMode = effectiveToolCall;
    if (toolMode) {
        var tools = [];
        if (searchOn || agentModeActive) {
            tools.push(SEARCH_TOOL_DEFINITION);
        if (window.RAG_ENABLED || agentModeActive) {
            tools.push(RAG_SEARCH_TOOL_DEFINITION);
        }
            tools.push(WEB_FETCH_TOOL_DEFINITION);
        }
        tools = tools.concat(imageTools);
        // 刷课工具（登录后可用，始终注册让AI知道可以引导用户登录）
        tools.push(CHAOXING_LOGIN_TOOL_DEFINITION);
        tools.push(CHAOXING_LIST_TOOL_DEFINITION);
        tools.push(CHAOXING_TOOL_DEFINITION);
        tools.push(CHAOXING_STATUS_TOOL_DEFINITION);
        tools.push(CHAOXING_STOP_TOOL_DEFINITION);
        tools.push(CHAOXING_STATS_TOOL_DEFINITION);
        // 引擎工具
        // ★ 引擎工具（子代理/Cron等）只在 Agent 模式下可用
        if (agentModeActive) {
            tools.push(ENGINE_CRON_LIST_TOOL);
            tools.push(ENGINE_CRON_CREATE_TOOL);
            tools.push(ENGINE_CRON_DELETE_TOOL);
            tools.push(DELEGATE_TASK_TOOL);
            tools.push(ENGINE_AGENT_STATUS_TOOL);
            tools.push(ENGINE_AGENT_LIST_TOOL);
            tools.push(ENGINE_AGENT_DELETE_TOOL);
            tools.push(ENGINE_PUSH_TOOL);
        }
        
                    tools.push(SERVER_EXEC_TOOL);
                    tools.push(SERVER_PYTHON_TOOL);
                    tools.push(SERVER_FILE_READ_TOOL);
                    tools.push(SERVER_FILE_WRITE_TOOL);
                    tools.push(SERVER_SYS_INFO_TOOL);
                    tools.push(SERVER_PS_TOOL);
                    tools.push(SERVER_DISK_TOOL);
                    tools.push(SERVER_NETWORK_TOOL);
                    tools.push(SERVER_DOCKER_TOOL);
                    tools.push(SERVER_DB_QUERY_TOOL);
                    tools.push(SERVER_FILE_SEARCH_TOOL);
                    tools.push(SERVER_FILE_OP_TOOL);
        body.tools = tools;
        // Agent 模式: 始终设置 tool_choice = "auto"
        if (agentModeActive || !isMiniMaxModel) body.tool_choice = "auto";
    }
    }

    if (getChecked('customParamsToggle')) {
        try {
            // MiniMax 不支持部分 OpenAI 参数,过滤掉以避免 2013 错误
            const modelName = getVal('modelSelect') || '';
            const isMiniMaxModel = modelName.toLowerCase().includes('minimax');
            let customParams = {};
            try { customParams = JSON.parse(getVal('customParams') || '{}'); } catch(e) {}
            if (isMiniMaxModel) {
                const bannedParams = ['presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'seed', 'extra_body', 'reasoning_split', 'reasoning_effort'];
                bannedParams.forEach(p => delete customParams[p]);
                delete body.extra_body;
            }
            Object.assign(body, customParams);
        } catch { /* 忽略 */ }
    }

    // ★ Agent 模式: 如果本轮创建了子代理，禁止模型继续说话
    var _hasCreatedSubAgent = false;

    // ★ Agent 模式: 思考深度处理
    if (agentModeActive) {
        var thinkingDepth = localStorage.getItem('agentThinkingDepth') || 'standard';
        if (thinkingDepth === 'deep' && !isMiniMaxModel) {
            body.reasoning_effort = 'high';
        } else if (thinkingDepth === 'shallow' && !isMiniMaxModel) {
            body.reasoning_effort = 'low';
        } else if (thinkingDepth === 'standard' && !isMiniMaxModel && body.reasoning_effort) {
            delete body.reasoning_effort;
        }
    }

    if (isMiniMaxModel) {
        delete body.reasoning_effort;
        delete body.tool_choice;
        delete body.top_logprobs;
        delete body.logprobs;
    }

    const timeout = parseInt(getVal('requestTimeout')) * 1000;
    const timeoutId = setTimeout(() => abortMain.abort(), timeout);
    const startTime = Date.now();

    // 网络错误重试配置
    const maxRetries = 3;
    // Agent 模式使用自定义最大工具调用轮次
    var maxToolCalls = agentModeActive ? (parseInt(localStorage.getItem('agentMaxToolRounds')) || 30) : 30;
    let toolCallCount = 0;

    // 离线检测
    if (!navigator.onLine) {
        clearTimeout(timeoutId);
        handleError(new Error('网络已断开,请检查网络连接后重试。'), chatId, pendingMsg, currentBubble);
        return;
    }

    // 初始调用使用 abortMain,后续重试使用新的 AbortController
    // ★ 全局工具调用参数修复：发送前确保所有 arguments 是合法 JSON
    function _fixAllToolCalls(msgs) {
        for (var i = 0; i < msgs.length; i++) {
            var m = msgs[i];
            if (m.role === 'assistant' && m.tool_calls) {
                for (var j = 0; j < m.tool_calls.length; j++) {
                    var tc = m.tool_calls[j];
                    if (tc.function && typeof tc.function.arguments === 'string') {
                        var raw = tc.function.arguments;
                        try { JSON.parse(raw); } catch(e) {
                            // 修复非法 JSON
                            raw = raw.replace(/[\x00-\x1f]/g, ' ');
                            var qc = (raw.match(/"/g) || []).length;
                            if (qc % 2 !== 0) raw += '"';
                            var ob = (raw.match(/\{/g) || []).length;
                            var cb = (raw.match(/\}/g) || []).length;
                            while (cb < ob) { raw += '}'; cb++; }
                            try { JSON.parse(raw); } catch(e2) {
                                // 彻底放弃，用空对象
                                raw = '{}';
                            }
                            tc.function.arguments = raw;
                        }
                    }
                }
            }
        }
    }
    // ★ 终极修复：在发送前对 body 中所有 tool_calls 的 arguments 做 parse+stringify 重编码
    _fixAllToolCalls(body.messages);
    // 附加：对 MiniMax 流式产生的 arguments 做深度重编码
    for (var _mi = 0; _mi < body.messages.length; _mi++) {
        var _mm = body.messages[_mi];
        if (_mm.role === 'assistant' && _mm.tool_calls) {
            for (var _tj = 0; _tj < _mm.tool_calls.length; _tj++) {
                var _tc = _mm.tool_calls[_tj];
                if (_tc.function && typeof _tc.function.arguments === 'string') {
                    try {
                        var _parsed = JSON.parse(_tc.function.arguments);
                        _tc.function.arguments = JSON.stringify(_parsed);
                    } catch(e) {
                        _tc.function.arguments = '{}';
                    }
                }
            }
        }
    }

    async function attemptRequestWithFreshAbort(attempt, abortCtrl, timeoutIdVal) {
        try {
            // ★ MiniMax 直连: 自定义 URL 和 API Key
            var _reqUrl = getVal('baseUrl') + '/chat/completions';
            var _reqBody = JSON.parse(JSON.stringify(body));
            // 清理日志中的敏感信息
            if (_reqBody.messages) _reqBody.messages = _reqBody.messages.length + ' messages';
            console.log('[API-REQ]', _reqUrl, 'model:', body.model, 'stream:', !!_reqBody.stream, 'tools:', (_reqBody.tools||[]).map(function(t){return t.function?t.function.name:t.name;}), 'messages:', body.messages.length);
            const res = await fetch(_reqUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getVal('apiKey')}` },
                body: JSON.stringify(body),
                signal: abortCtrl.signal
            });
            clearTimeout(timeoutIdVal);
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

            let usage = null;
            let toolCalls = [];
            const model = getVal('modelSelect') || '';
            const isMiniMax = model.toLowerCase().includes('minimax');
            const useStream = getChecked('streamToggle');

            if (useStream) {
                const result = await streamResponse(res, chatId, pendingMsg, 25, 12);
                usage = result.usage;
                toolCalls = result.toolCalls || [];
            } else {
                const result = await handleNonStream(res, chatId, pendingMsg, currentBubble);
                usage = result.usage;
                toolCalls = result.toolCalls || [];
            }

            // 处理工具调用
            if (toolCalls.length > 0) {
                toolCallCount++;
                if (toolCallCount > maxToolCalls) {
                    throw new Error('工具调用次数过多,可能存在循环,已停止');
                }

                // 将助手消息添加到历史(包含tool_calls)
                // 确保tool_calls中的arguments是字符串(API要求)
                // 过滤掉没有有效function.arguments的碎片
                const validToolCalls = toolCalls.filter(tc => tc && tc.function && tc.function.name && (typeof tc.function.arguments === 'object' || (typeof tc.function.arguments === 'string' && tc.function.arguments.length > 2)));
                const normalizedToolCalls = validToolCalls.map(tc => {
                    var argStr = typeof tc.function.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function.arguments || {});
                    // ★ 修复: 确保 arguments 是合法 JSON 字符串
                    // 清理非法控制字符
                    argStr = argStr.replace(/[\x00-\x1f]/g, ' ');
                    // 针对 engine_agent_create 的 prompt 做特殊处理：截断过长内容
                    if (tc.function.name === 'engine_agent_create' && argStr.length > 2000) {
                        try {
                            var parsed = JSON.parse(argStr);
                            if (parsed.prompt && parsed.prompt.length > 500) {
                                parsed.prompt = parsed.prompt.substring(0, 500) + '...(截断)请完成后用 engine_push 推送结果给用户';
                                argStr = JSON.stringify(parsed);
                            }
                        } catch(e) {}
                    }
                    return {
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.function.name,
                            arguments: argStr
                        }
                    };
                });
                const assistantMsg = {
                    role: 'assistant',
                    content: (typeof pendingMsg.content === 'string' && pendingMsg.content.trim())
                        ? pendingMsg.content
                        : (pendingMsg.reasoning || ' '),
                    tool_calls: normalizedToolCalls
                };
                if (pendingMsg.reasoning && typeof pendingMsg.reasoning === 'string') {
                    assistantMsg.reasoning_content = pendingMsg.reasoning;
                }
                // MiniMax reasoning_split:回传reasoning_details
                if (pendingMsg._reasoningDetails && Array.isArray(pendingMsg._reasoningDetails)) {
                    assistantMsg.reasoning_details = pendingMsg._reasoningDetails;
                }
                body.messages.push(assistantMsg);

                // 工具调用函数(使用独立的AbortController)
                async function executeToolCallForRetry(tc) {
                    const func = tc.function;
                    let args;
                    try {
                        if (typeof func.arguments === 'string') {
                            // 尝试修复截断的JSON
                            var raw = func.arguments;
                            var qc = (raw.match(/"/g) || []).length;
                            if (qc % 2 !== 0) raw += '"';
                            var ob = (raw.match(/\{/g) || []).length;
                            var cb = (raw.match(/\}/g) || []).length;
                            while (cb < ob) { raw += '}'; cb++; }
                            // ★ 修复: 清理 JSON 字符串中的非法控制字符和未转义换行
                            raw = raw.replace(/[\x00-\x1f]/g, ' ').replace(/\n(?![^"\\]*(?:\\.[^"\\]*)*")/g, '\\n');
                            args = JSON.parse(raw || '{}');
                        } else {
                            args = func.arguments || {};
                        }
                    } catch (parseErr) {
                        // ★ 尝试更激进的修复: 直接按名称提取参数
                        if (func.name === 'engine_agent_create') {
                            var argStr2 = typeof func.arguments === 'string' ? func.arguments : '';
                            var nameMatch = argStr2.match(/"name"\s*:\s*"([^"]+)"/);
                            var promptMatch = argStr2.match(/"prompt"\s*:\s*"([\s\S]*?)"(?=\s*[,\}])/);
                            var modelMatch = argStr2.match(/"model"\s*:\s*"([^"]+)"/);
                            args = {
                                name: nameMatch ? nameMatch[1] : 'agent_' + Date.now(),
                                prompt: promptMatch ? promptMatch[1].replace(/\\n/g, '\n') : '搜索并整理相关信息',
                                model: modelMatch ? modelMatch[1] : ''
                            };
                        } else {
                            args = { query: typeof func.arguments === 'string' ? func.arguments : (func.arguments?.query || '') };
                        }
                    }
                    let toolResult = { error: `Unknown tool: ${func.name}` };

                    if (func.name === 'web_search') {
                        const query = args.query;
                        if (query) {
                            if (currentChatId === chatId) {
                                const currentBubble = activeBubbleMap[chatId];
                                if (currentBubble) {
                                    let status = currentBubble.querySelector('.search-status');
                                    if (!status) {
                                        status = document.createElement('div');
                                        status.className = 'search-status';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(status);
                                    }
                                    status.textContent = `🔧 工具调用: web_search("${query}")`;
                                }
                            }
                            try {
                                // 不传递外部signal,让performWebSearch使用自己的超时控制器
                                const searchResult = await performWebSearch(query, null, 'web');
                                const optimized = formatRawResults(searchResult);
                                toolResult = { result: optimized || '搜索完成' };
                            } catch (e) {
                                toolResult = { error: e.message };
                            }
                        } else {
                            toolResult = { error: 'Missing query parameter' };
                        }
                    }
                    else if (func.name === 'web_fetch') {
                        let urls = [];
                        // 支持 urls 数组 或 单个 url 字符串
                        if (Array.isArray(args.urls)) {
                            urls = args.urls.slice(0, 5); // 最多5个
                        } else if (typeof args.urls === 'string') {
                            urls = [args.urls];
                        } else if (typeof args.url === 'string') {
                            urls = [args.url];
                        }
                        if (urls.length > 0) {
                            if (currentChatId === chatId) {
                                const currentBubble = activeBubbleMap[chatId];
                                if (currentBubble) {
                                    let status = currentBubble.querySelector('.search-status');
                                    if (!status) {
                                        status = document.createElement('div');
                                        status.className = 'search-status';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(status);
                                    }
                                    status.textContent = `🌐 正在抓取网页 (${urls.length}个)...`;
                                }
                            }
                            try {
                                const fetched = await performWebFetch(urls);
                                if (fetched.error) {
                                    toolResult = { error: fetched.error };
                                } else {
                                    // 格式化为可读的文本
                                    const parts = fetched.results.map((r, i) => {
                                        const label = urls.length > 1 ? `【网页${i + 1}】` : '';
                                        if (r.error) {
                                            return `${label}${r.url}\n⚠️ 抓取失败: ${r.error}`;
                                        }
                                        // 截断过长内容
                                        const content = r.content && r.content.length > 8000
                                            ? r.content.slice(0, 8000) + '...(内容过长已截断)'
                                            : (r.content || '(无内容)');
                                        return `${label}${r.url}\n${content}`;
                                    });
                                    toolResult = { result: parts.join('\n\n---\n\n') };
                                    if (currentChatId === chatId) {
                                        const currentBubble = activeBubbleMap[chatId];
                                        const status = currentBubble?.querySelector('.search-status');
                                        if (status) status.textContent = `✅ 抓取完成 (${urls.length}个网页)`;
                                    }
                                }
                            } catch (e) {
                                toolResult = { error: e.message };
                            }
                        } else {
                            toolResult = { error: 'Missing urls parameter. Provide a URL or array of URLs.' };
                        }
                    }
                    else if (func.name === 'rag_search') {
                        var question = args.question || args.query || '';
                        if (question) {
                            if (currentChatId === chatId) {
                                var _b = activeBubbleMap[chatId];
                                if (_b) {
                                    var _st = _b.querySelector('.search-status');
                                    if (!_st) { _st = document.createElement('div'); _st.className = 'search-status'; _b.querySelector('.markdown-body')?.appendChild(_st); }
                                    _st.textContent = '📚 搜索知识库: ' + question;
                                }
                            }
                            try {
                                var _uid = localStorage.getItem('authUserId') || '';
                                var _coll = localStorage.getItem('ragCurrentCollection') || 'default';
                                var _ns = _uid ? _uid + '_' + _coll : _coll;
                                var _token = getAuthToken();
                                var _resp = await fetch('/oneapichat/rag_proxy.php?action=search&collection=' + encodeURIComponent(_ns) + '&auth_token=' + encodeURIComponent(_token), {
                                    method: 'POST', headers: {'Content-Type': 'application/json'},
                                    body: JSON.stringify({question: question})
                                });
                                var _data = await _resp.json();
                                if (_data && _data.hits && _data.hits.length > 0) {
                                    var _parts = _data.hits.map(function(h, i) {
                                        return '[\u7247\u6bb5' + (i+1) + ' \u6765\u6e90:' + h.source + '] ' + h.full_content;
                                    });
                                    toolResult = { result: _parts.join('\n\n') };
                                } else {
                                    toolResult = { result: 'empty' };
                                }
                            } catch(e) {
                                toolResult = { error: 'rag fail: ' + e.message };
                            }
                        } else {
                            toolResult = { error: 'no question' };
                        }
                    }
                     else if (func.name === 'chaoxing_login') {
                        var u = args.username, p = args.password;
                        if (u && p) {
                            toolResult = await chaoxingToolHandler('login', null, u, p);
                        } else {
                            toolResult = { error: '请提供手机号和密码' };
                        }
                    }
                     else if (func.name === 'chaoxing_list_courses') {
                        toolResult = await chaoxingToolHandler('courses');
                    }
                     else if (func.name === 'chaoxing_auto') {
                        var ids = args.course_ids;
                        if (ids) toolResult = await chaoxingToolHandler('start', ids);
                        else toolResult = { error: '请指定课程ID' };
                    }
                     else if (func.name === 'chaoxing_status') {
                        toolResult = await chaoxingToolHandler('status');
                    }
                     else if (func.name === 'chaoxing_stop') {
                        toolResult = await chaoxingToolHandler('stop');
                    }
                     else if (func.name === 'chaoxing_stats') {
                        toolResult = await chaoxingToolHandler('stats');
                    }
                     else if (func.name === 'engine_cron_list') {
                        toolResult = await engineApiHandler('cron_list');
                    }
                     else if (func.name === 'engine_cron_create') {
                        toolResult = await engineApiHandler('cron_create', args);
                    }
                     else if (func.name === 'engine_cron_delete') {
                        toolResult = await engineApiHandler('cron_delete', args);
                    }
                     else if (func.name === 'engine_agent_create') {
                        _hasCreatedSubAgent = true;
                        var _aName = (args && args.name) ? args.name : ('agent_' + Date.now());
                        if (window._activeSubAgentGroup && window._currentGroupId) {
                            window._activeSubAgentGroup.push({name: _aName, groupId: window._currentGroupId});
                        }
                        toolResult = await engineApiHandler('agent_create', args);
                    }
                     else if (func.name === 'engine_agent_status') {
                        toolResult = await engineApiHandler('agent_status', args);
                    }
                     else if (func.name === 'engine_agent_list') {
                        toolResult = await engineApiHandler('agent_list');
                    }
                     else if (func.name === 'engine_agent_delete') {
                        toolResult = await engineApiHandler('agent_delete', args);
                    }
                     else if (func.name === 'engine_cron_delete') {
                        toolResult = await engineApiHandler('cron_delete', args);
                    }
                     else if (func.name === 'server_exec') {
                        toolResult = await engineApiHandler('exec', args);
                    }
                     else if (func.name === 'server_python') {
                        toolResult = await engineApiHandler('python', args);
                    }
                     else if (func.name === 'server_file_read') {
                        toolResult = await engineApiHandler('file_read', args);
                    }
                     else if (func.name === 'server_file_write') {
                        toolResult = await engineApiHandler('file_write', args);
                    }
                     else if (func.name === 'server_sys_info') {
                        toolResult = await engineApiHandler('sys_info', args);
                    }
                     else if (func.name === 'server_ps') {
                        toolResult = await engineApiHandler('ps', args);
                    }
                     else if (func.name === 'server_disk') {
                        toolResult = await engineApiHandler('disk', args);
                    }
                     else if (func.name === 'server_network') {
                        toolResult = await engineApiHandler('network', args);
                    }
                     else if (func.name === 'server_docker') {
                        toolResult = await engineApiHandler('docker', args);
                    }
                     else if (func.name === 'server_db_query') {
                        toolResult = await engineApiHandler('db_query', args);
                    }
                     else if (func.name === 'server_file_search') {
                        toolResult = await engineApiHandler('file_search', args);
                    }
                     else if (func.name === 'server_file_op') {
                        toolResult = await engineApiHandler('file_op', args);
                    }
                     else if (func.name === 'engine_agent_ask') {
                        toolResult = await engineApiHandler('agent_ask', args);
                    }
                     else if (func.name === 'engine_agent_stop') {
                        toolResult = await engineApiHandler('agent_stop', args);
                    }
                     else if (func.name === 'engine_push') {
                        toolResult = await engineApiHandler('push', args);
                    }
                     else if (func.name === 'delegate_task') {
                        _hasCreatedSubAgent = true;
                        var taskArgs = args || {};
                        var tName = taskArgs.name || 'agent_' + Date.now();
                        var tTask = taskArgs.task || '';
                        var tRole = taskArgs.role || 'general';
                        var tPrompt = taskArgs.prompt || '';
                        if (window._activeSubAgentGroup && window._currentGroupId) {
                            window._activeSubAgentGroup.push({name: tName, groupId: window._currentGroupId});
                        }
                        var tTask = taskArgs.task || '';
                        var tRole = taskArgs.role || 'general';
                        var tPrompt = taskArgs.prompt || '';
                        var fullPrompt = tPrompt || '你的任务是: ' + tTask + '。完成后用 engine_push 推送结果摘要给用户。';
                        if (fullPrompt) {
                            if (typeof window.engineApiHandler === 'function') {
                                var _cr = await window.engineApiHandler('agent_create', {
                                    name: tName,
                                    prompt: fullPrompt,
                                    role: tRole
                                });
                                await window.engineApiHandler('agent_run', {
                                    name: tName
                                });
                                toolResult = { result: '✅ 已创建并启动子代理「' + tName + '」(角色:' + tRole + ')，任务: ' + (tTask || tPrompt).substring(0, 50) };
                            } else {
                                toolResult = { error: '引擎不可用' };
                            }
                        } else {
                            toolResult = { error: '请提供任务描述' };
                        }
                    } else if (func.name === 'delegate_workflow') {
                        task = args.task;
                        if (task) {
                            if (currentChatId === chatId) {
                                const currentBubble = activeBubbleMap[chatId];
                                if (currentBubble) {
                                    let status = currentBubble.querySelector('.search-status');
                                    if (!status) {
                                        status = document.createElement('div');
                                        status.className = 'search-status';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(status);
                                    }
                                    status.textContent = '\u{1F916} 工作流执行中: ' + task.substring(0, 50) + '...';
                                }
                            }
                            try {
                                var createResp = await engineApiHandler('agent_create', {
                                    name: 'wf_' + Date.now(),
                                    prompt: task,
                                    model: localStorage.getItem('model') || 'deepseek-chat'
                                });
                                toolResult = { result: createResp.result || '工作流已完成' };
                            } catch (e) {
                                toolResult = { error: e.message };
                            }
                        } else {
                            toolResult = { error: '请提供任务描述' };
                        }
                    }
                     else if (func.name === 'generate_image') {
    const prompt = args.prompt;
    if (prompt) {
        if (currentChatId === chatId) {
            const currentBubble = activeBubbleMap[chatId];
            if (currentBubble) {
                let status = currentBubble.querySelector('.search-status');
                if (!status) {
                    status = document.createElement('div');
                    status.className = 'search-status';
                    currentBubble.querySelector('.markdown-body')?.appendChild(status);
                }
                status.textContent = '🎨 正在生成图片...';

                // 添加图片占位符(紫色渐变+脉冲动画)
                const placeholder = document.createElement('div');
                placeholder.id = 'image-placeholder';
                placeholder.style = 'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:12px;padding:40px 20px;text-align:center;margin:12px 0;color:white;animation:pulse 2s infinite;';
                placeholder.innerHTML = '<div style="font-size:24px;margin-bottom:8px;">🎨</div><div style="font-size:14px;">图片生成中' + ((args.n || 1) > 1 ? ' (' + (args.n || 1) + '张)' : '') + ',请稍候...</div><div style="font-size:12px;margin-top:8px;opacity:0.8;">' + escapeHtml(prompt.substring(0, 30)) + '...</div>';
                currentBubble.querySelector('.markdown-body')?.appendChild(placeholder);
            }
        }

        try {
            // ★ 安全规则: n>1（多张）时自动丢弃 seed，防止所有图一模一样
            var _safeSeed = args.seed;
            var _safeN = args.n || 1;
            if (_safeN > 1 && _safeSeed !== undefined) {
                _safeSeed = undefined;
            }
            const imageResult = await window.generateImage(prompt, {
                model: args.model,
                style: args.style,
                aspect_ratio: args.aspect_ratio,
                seed: _safeSeed,
                n: _safeN,
                prompt_optimizer: args.prompt_optimizer,
                aigc_watermark: args.aigc_watermark
            });

            if (imageResult) {
                // ★ 累积所有图片（支持多次调用）
                if (!pendingMsg.generatedImages) pendingMsg.generatedImages = [];
                if (typeof imageResult === 'string') {
                    pendingMsg.generatedImages.push(imageResult);
                    pendingMsg.generatedImage = imageResult; // 向后兼容
                } else if (Array.isArray(imageResult)) {
                    pendingMsg.generatedImages = pendingMsg.generatedImages.concat(imageResult);
                }
                toolResult = { result: '\u2705 ' + (Array.isArray(imageResult) ? imageResult.length : 1) + '\u5f20\u56fe\u7247\u5df2\u751f\u6210' };
            } else {
                toolResult = { result: '[\u56fe\u7247\u751f\u6210\u5931\u8d25]' };
            }   
        } catch (e) {
            console.error('[generate_image error]', e.message);
            toolResult = { error: e.message };
            // 替换占位符为错误提示
            if (currentChatId === chatId) {
                const currentBubble = activeBubbleMap[chatId];
                if (currentBubble) {
                    const ph = currentBubble.querySelector('#image-placeholder');
                    if (ph) {
                        ph.innerHTML = '<div style="font-size:24px;margin-bottom:8px;">❌</div><div style="font-size:14px;font-weight:bold;">图片生成失败</div><div style="font-size:12px;color:#666;margin-top:8px;">' + escapeHtml(e.message) + '</div>';
                        ph.style.background = '#fee2e2';
                        ph.style.color = '#dc2626';
                    }
                    const status = currentBubble.querySelector('.search-status');
                    if (status) status.textContent = '❌ 图片生成失败';
                }
            }
        }
    } else {
        toolResult = { error: 'Missing prompt parameter' };
    }
                    } else if (func.name === 'generate_image_i2i') {
                        const userPrompt = args.prompt;
                        let image = args.image;

                        // 检查 image 是否有效(必须是 data: 或 http URL 开头)
                        const isValidImage = image && (typeof image === 'string') &&
                                           (image.startsWith('data:') || image.startsWith('http') || image.startsWith('/'));

                        // 如果 image 无效(空值、文件名、或无效格式),自动从用户最近上传的图片中获取
                        if (!isValidImage && chatId && chats[chatId]) {
                            const msgs = chats[chatId].messages;
                            for (let i = msgs.length - 1; i >= 0; i--) {
                                if (msgs[i].role === 'user' && msgs[i].files && msgs[i].files.length > 0) {
                                    const imgFile = msgs[i].files.find(f => f.isImage || (f.type && f.type.startsWith('image/')));
                                    if (imgFile && imgFile.content) {
                                        image = imgFile.content;
                                        break;
                                    }
                                }
                            }
                        }

                        if (!userPrompt) {
                            toolResult = { error: 'Missing prompt parameter' };
                        } else if (!image) {
                            toolResult = { error: '缺少参考图片。请上传一张参考图片后再使用图生图功能。' };
                        } else {
                            // Analysis
                            if (currentChatId === chatId) {
                                const currentBubble = activeBubbleMap[chatId];
                                if (currentBubble) {
                                    let status = currentBubble.querySelector('.search-status');
                                    if (!status) {
                                        status = document.createElement('div');
                                        status.className = 'search-status';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(status);
                                    }
                                    status.textContent = '🔍 正在分析参考图片...';
                                }
                            }
                            
                            try {
                                // 分析图片获取描述（辅助 prompt 优化）
                                const description = await window.analyzeImage(image, 'Briefly describe key features: hair, eyes, clothes, pose, background. Under 200 words.');
                                const fullPrompt = userPrompt + '. Reference: ' + description.slice(0, 500);
                                
                                if (currentChatId === chatId) {
                                    const currentBubble = activeBubbleMap[chatId];
                                    if (currentBubble) {
                                        let status = currentBubble.querySelector('.search-status');
                                        if (status) status.textContent = '🎨 正在图生图...';
                                        const placeholder = document.createElement('div');
                                        placeholder.id = 'image-placeholder';
                                        placeholder.style = 'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:12px;padding:40px 20px;text-align:center;margin:12px 0;color:white;animation:pulse 2s infinite;';
                                        placeholder.innerHTML = '<div style="font-size:24px;margin-bottom:8px;">🎨</div><div style="font-size:14px;">图生图中' + ((args.n || 1) > 1 ? ' (' + (args.n || 1) + '张)' : '') + ',请稍候...</div><div style="font-size:12px;margin-top:8px;opacity:0.8;">' + escapeHtml(userPrompt.substring(0, 30)) + '...</div>';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(placeholder);
                                    }
                                }
                                
                                // ★ 调用真正的图生图 API（带参考图片）
                                const i2iResult = await window.generateImageI2I(fullPrompt, image, {
                                    model: args.model || 'image-01',
                                    aspect_ratio: args.aspect_ratio,
                                    seed: args.seed,
                                    n: args.n
                                });
                                if (i2iResult) {
                                    // ★ 累积到 generatedImages（与 generate_image 一致）
                                    if (!pendingMsg.generatedImages) pendingMsg.generatedImages = [];
                                    if (typeof i2iResult === 'string') {
                                        pendingMsg.generatedImages.push(i2iResult);
                                        pendingMsg.generatedImage = i2iResult;
                                    } else if (Array.isArray(i2iResult)) {
                                        pendingMsg.generatedImages = pendingMsg.generatedImages.concat(i2iResult);
                                    }
                                    toolResult = { result: '\u2705 \u56fe\u7247\u5df2\u751f\u6210' };
                                } else {
                                    toolResult = { result: i2iResult };
                                }
                            } catch (e) {
                                console.error('[generate_image_i2i error]', e.message);
                                toolResult = { error: e.message };
                                if (currentChatId === chatId) {
                                    const currentBubble = activeBubbleMap[chatId];
                                    if (currentBubble) {
                                        const ph = currentBubble.querySelector('#image-placeholder');
                                        if (ph) {
                                            ph.innerHTML = '<div style="font-size:24px;margin-bottom:8px;">❌</div><div style="font-size:14px;font-weight:bold;">图生图失败</div><div style="font-size:12px;color:#666;margin-top:8px;">' + escapeHtml(e.message) + '</div>';
                                            ph.style.background = '#fee2e2';
                                            ph.style.color = '#dc2626';
                                        }
                                        const status = currentBubble.querySelector('.search-status');
                                        if (status) status.textContent = '❌ 图生图失败';
                                    }
                                }
                            }
                        }
                    } else if (func.name === 'analyze_image') {
                        // 图片理解工具 - 调用 MiniMax 图片理解 API
                        const focus = args.focus || '请详细描述这张图片的内容,包括其中的物体、场景、文字等所有可见信息。';

                        // 获取当前消息中的图片(优先从全局变量获取,因为 pendingFiles 可能已被清空)
                        let currentFiles = window._currentMessageImages || [];
                        if (!currentFiles.length) {
                            currentFiles = pendingFiles.length > 0 ? pendingFiles : (chats[chatId]?.messages?.slice(-1)[0]?.files || []);
                        }

                        // 如果仍然没有找到图片,尝试从聊天历史中查找最近的用户上传图片
                        if (!currentFiles.length && chats[chatId]) {
                            const msgs = chats[chatId].messages;
                            for (let i = msgs.length - 1; i >= 0; i--) {
                                if (msgs[i].role === 'user' && msgs[i].files && msgs[i].files.length > 0) {
                                    const imgFile = msgs[i].files.find(f => f.isImage || f.type?.startsWith('image/'));
                                    if (imgFile) {
                                        currentFiles = [imgFile];
                                        break;
                                    }
                                }
                            }
                        }

                        const imageFile = currentFiles.find(f => f.isImage || f.type?.startsWith('image/'));

                        if (!imageFile) {
                            toolResult = { error: '未找到可分析的图片,请确保用户已上传图片。' };
                        } else {
                            if (currentChatId === chatId) {
                                const currentBubble = activeBubbleMap[chatId];
                                if (currentBubble) {
                                    let status = currentBubble.querySelector('.search-status');
                                    if (!status) {
                                        status = document.createElement('div');
                                        status.className = 'search-status';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(status);
                                    }
                                    status.textContent = '🖼️ 正在分析图片...';
                                }
                            }
                            try {
                                const analyzeResult = await window.analyzeImage(imageFile.content, focus);
                                toolResult = { result: analyzeResult };
                            } catch (e) {
                                console.error('[analyze_image error]', e);
                                const errorMsg = e?.message || e?.toString() || String(e) || '图片分析失败';
                                toolResult = { error: errorMsg };
                            }
                        }
                    }
                    return toolResult;
                }
// ==================== 图像生成函数 ====================
window.generateImage = async (prompt, options = {}) => {
    // ★ MiniMax API 限制 prompt ≤ 1500 字符，截断避免 2013 错误
    const MAX_PROMPT_LEN = 1400;
    if (prompt.length > MAX_PROMPT_LEN) prompt = prompt.slice(0, MAX_PROMPT_LEN);
    // 使用独立的图像生成配置
    // 使用独立的图像生成配置
    let baseUrl = (localStorage.getItem('imageBaseUrl') || DEFAULT_CONFIG.imageBaseUrl || '').replace(/\/$/, '');
    // 自动添加 /v1 后缀(如果还没有)
    if (baseUrl && !baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl + '/v1';
    }
    const rawKey = localStorage.getItem('imageApiKey') || '';
    let apiKey = '';
    try { apiKey = decrypt(rawKey) || ''; } catch(e) { console.error('[generateImage] decrypt error:', e.message); }

    if (!baseUrl) {
        console.error('[generateImage] 未配置API地址');
        throw new Error('未配置图像生成API地址,请在设置中填写');
    }
    if (!apiKey) {
        console.error('[generateImage] 未配置API密钥');
        throw new Error('未配置图像生成API密钥,请在设置中填写');
    }

    // 获取配置的图像生成模型
    const imageModel = localStorage.getItem('imageModel') || 'image-01';

    // MiniMax 图像生成 API
    const apiUrl = baseUrl + '/image_generation';
    try {
        const body = {
            model: options.model || imageModel,
            prompt: prompt,
            aspect_ratio: options.aspect_ratio || '1:1',
            seed: options.seed,
            response_format: 'base64',
            n: options.n || 1,
            prompt_optimizer: options.prompt_optimizer || false,
            aigc_watermark: options.aigc_watermark
        };
        // 如果 style 是字符串才加入
        if (options.style && typeof options.style === 'string') {
            body.style = options.style;
        }
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error('图像生成 API 请求失败: ' + response.status);
        }

        const data = await response.json();
        // MiniMax API 两种返回格式:
        // 格式1 (单图/n=1): data: { image_base64: ["..."] } 或 data: { image_url: "..." }
        // 格式2 (多图): data: [{ image_base64: "..." }, ...]
        const images = [];
        if (data.data && Array.isArray(data.data)) {
            // 格式2: data: [{image_base64}, {image_url}]
            data.data.forEach(function(d) {
                if (d.image_base64) images.push('data:image/png;base64,' + d.image_base64);
                else if (d.image_url) images.push(d.image_url);
            });
        } else if (data.data && data.data.image_base64 && Array.isArray(data.data.image_base64)) {
            // 格式1: data: { image_base64: ["..."] }
            data.data.image_base64.forEach(function(b64) {
                images.push('data:image/png;base64,' + b64);
            });
        } else if (data.data && data.data.image_url) {
            images.push(data.data.image_url);
        }
        if (images.length > 0) return images.length === 1 ? images[0] : images;
        // 如果有错误信息，打印出来方便调试
        if (data.code || data.msg || data.error) {
            throw new Error('API错误: ' + (data.msg || data.error || JSON.stringify(data)));
        }
        throw new Error('图像生成 API 返回数据格式异常: ' + JSON.stringify(data).substring(0, 200));
    } catch (e) {
        console.error('Image generation error:', e);
        throw e;
    }
};

// ==================== 图生图函数 ====================
window.generateImageI2I = async (prompt, image, options = {}) => {
    // ★ MiniMax API 限制 prompt ≤ 1500 字符，截断避免 2013 错误
    const MAX_PROMPT_LEN = 1400;
    if (prompt.length > MAX_PROMPT_LEN) prompt = prompt.slice(0, MAX_PROMPT_LEN);
    let baseUrl = (localStorage.getItem('imageBaseUrl') || DEFAULT_CONFIG.imageBaseUrl || '').replace(/\/$/, '');
    if (baseUrl && !baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl + '/v1';
    }
    const apiKey = decrypt(localStorage.getItem('imageApiKey') || '') || '';

    if (!baseUrl) {
        throw new Error('未配置图像生成API地址,请在设置中填写');
    }
    if (!apiKey) {
        throw new Error('未配置图像生成API密钥,请在设置中填写');
    }

    const imageModel = localStorage.getItem('imageModel') || 'image-01';
    const apiUrl = baseUrl + '/image_generation';

    const requestBody = {
        model: options.model || imageModel,
        prompt: prompt,
        aspect_ratio: options.aspect_ratio || '1:1',
        seed: options.seed,
        response_format: 'base64',
        n: options.n || 1,
        prompt_optimizer: options.prompt_optimizer || false,
        aigc_watermark: options.aigc_watermark
    };

    // 添加图生图参考图 - MiniMax API 格式
    // image 可以是 data:image/...;base64,... 或 http://... URL
    if (image && (image.startsWith('data:') || image.startsWith('http'))) {
        requestBody.subject_reference = [{
            type: 'character',
            image_file: image
        }];
    }

    // 添加画风设置(仅 image-01-live 支持)
    if (options.style && options.model !== 'image-01') {
        requestBody.style = options.style;
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error('图像生成 API 请求失败: ' + response.status);
        }

        const data = await response.json();
        
        // 检查 API 错误
        if (data.base_resp && data.base_resp.status_code !== 0) {
            const errMsg = data.base_resp.status_msg || 'API 错误';
            const errCode = data.base_resp.status_code;
            // 如果是模型不支持错误
            if (errMsg.includes('not support model') || errMsg.includes('image-01-live')) {
                throw new Error('抱歉，您的账号不支持 image-01-live 模型，请联系管理员升级');
            }
            // 内容安全
            if (errCode === 1026) {
                throw new Error('图片内容涉及敏感信息，请尝试其他描述');
            }
            // 账号问题
            if (errCode === 1008) {
                throw new Error('账号余额不足，请充值后重试');
            }
            throw new Error('API 错误 (' + errCode + '): ' + errMsg);
        }
        
        // MiniMax 图生图返回: data: { image_base64: ["..."] }
        let imageResult = null;
        if (data.data && data.data.image_base64 && Array.isArray(data.data.image_base64) && data.data.image_base64.length > 0) {
            const images = data.data.image_base64.map(function(b64) { return 'data:image/png;base64,' + b64; });
            imageResult = images.length === 1 ? images[0] : images;
        } else if (data.data && data.data.image_url) {
            imageResult = data.data.image_url;
        } else if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            const images = data.data.map(function(d) {
                if (d.image_base64) return 'data:image/png;base64,' + d.image_base64;
                if (d.image_url) return d.image_url;
                return null;
            }).filter(Boolean);
            imageResult = images.length === 1 ? images[0] : images;
        }
        
        // ★ i2i失败(failed_count>0): 自动降级为文生图重试
        if (!imageResult && data.metadata && parseInt(data.metadata.failed_count) > 0 && requestBody.subject_reference) {
            delete requestBody.subject_reference;
            const retryResp = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
                body: JSON.stringify(requestBody)
            });
            if (retryResp.ok) {
                const retryData = await retryResp.json();
                if (retryData.data && retryData.data.image_base64 && Array.isArray(retryData.data.image_base64) && retryData.data.image_base64.length > 0) {
                    const images = retryData.data.image_base64.map(function(b64) { return 'data:image/png;base64,' + b64; });
                    imageResult = images.length === 1 ? images[0] : images;
                }
            }
        }
        
        if (imageResult) {
            // 尝试上传图片到服务器
            const serverUrl = await uploadImageToServer(imageResult);
            if (serverUrl) {
                return serverUrl; // 返回服务器 URL 而不是 base64
            }
            return imageResult; // 上传失败则返回 base64
        } else {
            console.error('[I2I] 未识别的返回格式:', JSON.stringify(data).substring(0, 500));
            throw new Error('图像生成 API 返回数据格式异常');
        }
    } catch (e) {
        console.error('Image i2i error:', e);
        throw e;
    }
};

// ==================== 图片理解函数 ====================
// 测试直接 MiniMax API

// 一键切换方案

// 研究 MiniMax API 格式

// 临时解决方案:使用其他支持 image_url 的模型
window.useAlternativeVisionModel = function() {

    // 方案1:使用支持 image_url 的其他模型
    // 方案2:使用其他视觉 API 服务
    // 方案3:回退到 MCP(如果修复了)
    return {
        message: '需要研究 MiniMax-VL-01 的正确 API 格式或使用替代方案',
        options: [
            'GPT-4-vision',
            '修复 MCP',
            '其他视觉 API'
        ]
    };
};

// 快速测试 MCP
;

// 执行每个工具调用并添加结果(只对有有效内容的tool call执行)
                for (const tc of validToolCalls) {
                    const toolResult = await executeToolCallForRetry(tc);
                    const resultContent = toolResult.error || toolResult.result;

                    // 确保content是字符串
                    const contentStr = typeof resultContent === 'string'
                        ? resultContent
                        : JSON.stringify(resultContent);

                    body.messages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: contentStr
                    });

                    // 更新UI
                    if (currentChatId === chatId) {
                        const currentBubble = activeBubbleMap[chatId];
                        if (currentBubble) {
                            let status = currentBubble.querySelector('.search-status');
                            if (status) {
                                if (tc.function.name === 'web_search') {
                                    status.textContent = `✅ 搜索完成: ${resultContent.substring(0, 100)}...`;
                                } else if (tc.function.name === 'analyze_image') {
                                    status.textContent = toolResult.error
                                        ? `❌ 图片分析失败: ${toolResult.error}`
                                        : `✅ 图片分析完成`;
                                } else if (toolResult.error) {
                                    status.textContent = `❌ 工具错误: ${toolResult.error}`;
                                    status.style.color = '#ef4444';
                                } else {
                                    status.textContent = `✅ 工具完成: ${tc.function.name}`;
                                }
                            }
                            // 如果生成了图片,确保存入消息对象
                            if (tc.function.name === 'generate_image' && (pendingMsg.generatedImage || pendingMsg.generatedImages)) {
                                const msgIdx = chats[chatId].messages.findIndex(m => m === pendingMsg);
                                if (msgIdx !== -1) {
                                    if (pendingMsg.generatedImage) chats[chatId].messages[msgIdx].generatedImage = pendingMsg.generatedImage;
                                    if (pendingMsg.generatedImages) chats[chatId].messages[msgIdx].generatedImages = pendingMsg.generatedImages;
                                }
                            }
                        }
                    }
                }

                // ★ Agent 模式下：如果本轮创建了子代理，立即停止递归循环
                // ★ Agent 模式下：检测是否创建了子代理
                if (_hasCreatedSubAgent) {
                    // ★ 防御性检查 validToolCalls 是否存在
                    if (!validToolCalls || !Array.isArray(validToolCalls)) {
                        console.log('[Agent] 已创建子代理，但validToolCalls不可用，直接继续');
                    } else {
                    // 检查本轮是否只有 delegate_task/agent_create 工具调用（没有搜索、fetch等）
                    var onlyCreatedSubAgents = validToolCalls.every(function(tc) {
                        return tc.function && (tc.function.name === 'delegate_task' || tc.function.name === 'engine_agent_create');
                    });
                    if (onlyCreatedSubAgents) {
                        // 本轮只创建了子代理，模型还没开始搜索/分析
                        // 给模型一次机会继续思考：是否需要创建更多子代理，或开始实际工作
                        console.log('[Agent] 本轮只创建了子代理(' + validToolCalls.length + '个)，允许继续');
                    } else {
                        // 本轮既有子代理创建又有实际工作（搜索/分析）
                        // 停止递归，等待子代理完成
                        console.log('[Agent] 已创建子代理+执行任务，停止递归等待完成');
                        delete pendingMsg.partial;
                        try { localStorage.removeItem('_savedPartial'); } catch(e) {}
                        if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
                        pendingMsg.time = Date.now() - startTime;
                        pendingMsg.usage = usage;
                        saveChats();
                        if (currentChatId === chatId) loadChat(chatId);
                        return;
                    }
                    }
                    }

                // 重置 AbortController 和 timeout 以便下一个请求使用
                const newAbortCtrl = new AbortController();
                abortControllerMap[chatId] = newAbortCtrl;
                clearTimeout(timeoutId);
                const newTimeoutVal = parseInt(getVal('requestTimeout')) * 1000;
                const newTimeoutId = setTimeout(() => newAbortCtrl.abort(), newTimeoutVal);

                // 继续循环获取下一个响应
                return attemptRequestWithFreshAbort(attempt, newAbortCtrl, newTimeoutId);
            }

            // 无工具调用,正常完成
            delete pendingMsg.partial;
            // ★ 清除保存的 partial 标记（已完成，刷新不会丢失）
            try { localStorage.removeItem('_savedPartial'); } catch(e) {}
            // ★ 清除流式保存定时器
            if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
            pendingMsg.time = Date.now() - startTime;
            pendingMsg.usage = usage;
            // ★ 子代理完成报告处理：触发队列中的下一个通知
            if (window._agentNotifyQueue && window._agentNotifyQueue.length > 0) {
                setTimeout(function() { window._processAgentNotifyQueue(); }, 1000);
            }
            saveChats();  // 立即保存，不用 debounce
            if (currentChatId === chatId) loadChat(chatId);
            if (currentChatId === chatId) loadChat(chatId);
            const defaultTitle = text ? text.slice(0, 10) : (files.length ? '文件消息' : '新对话');
            if (!skipUserAdd && chats[chatId].title === defaultTitle) {
                autoGenerateTitle(chatId);
            }
            // ★ Agent 模式: 主动建议(不阻塞主流程)
            if (localStorage.getItem('agentMode') === 'true' && localStorage.getItem('agentProactive') === 'true') {
                var lastContent = typeof pendingMsg.content === 'string' ? pendingMsg.content : '';
                if (lastContent) {
                    // 延迟执行,让 UI 先完成渲染
                    setTimeout(function() {
                        generateProactiveSuggestions(chatId, lastContent);
                    }, 1500);
                }
            }
        } catch (e) {
            clearTimeout(timeoutId);
            const isUserAbort = userAbortMap[chatId];  // 检查是否用户主动停止
            if (isUserAbort) {
                delete userAbortMap[chatId];  // 清理标记
                throw new Error('用户停止');  // 不重试,直接结束
            }

            // ★ 智能调整 max_tokens: 从 API 错误信息中提取有效范围并自动修正
            const maxTokensMatch = e.message?.match(/max_tokens.*?\[(\d+),\s*(\d+)\]/);
            if (maxTokensMatch) {
                const maxVal = parseInt(maxTokensMatch[2]);
                const curMaxTokens = parseInt(getVal('maxTokens')) || 4096;
                if (curMaxTokens > maxVal) {
                    console.warn('[AutoAdjust] max_tokens ' + curMaxTokens + ' -> ' + maxVal);
                    const m = getVal('modelSelect') || '';
                    modelMaxOutputTokens[m] = maxVal;
                    localStorage.setItem('modelMaxOutputTokens', JSON.stringify(modelMaxOutputTokens));
                    setVal('maxTokens', maxVal);
                    setVal('maxTokensInput', maxVal);
                    body.max_tokens = maxVal;
                    showToast('max_tokens 自动调整为 ' + maxVal, 'warning', 3000);
                    const retryCtrl = new AbortController();
                    abortControllerMap[chatId] = retryCtrl;
                    clearTimeout(timeoutId);
                    const retryTimeoutId = setTimeout(function() { retryCtrl.abort(); }, parseInt(getVal('requestTimeout')) * 1000);
                    return attemptRequestWithFreshAbort(attempt, retryCtrl, retryTimeoutId);
                }
            }

            const isUpstreamError = e.message === 'UPSTREAM_ERROR' || e.message.includes('upstream') || e.message.includes('bad response');
            const isNetError = e.name === 'AbortError' || e.message.includes('timeout') || e.message.includes('aborted') || isUpstreamError;
            if (isNetError && attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
                showToast(`网络超时,${attempt + 1}/${maxRetries},${(delay/1000).toFixed(0)}s后重试...`, 'warning', 3000);
                await new Promise(r => setTimeout(r, delay));
                const newAbortCtrl = new AbortController();
                abortControllerMap[chatId] = newAbortCtrl;
                clearTimeout(timeoutIdVal);
                const newTimeoutVal = parseInt(getVal('requestTimeout')) * 1000;
                const newTimeoutId = setTimeout(() => newAbortCtrl.abort(), newTimeoutVal);
                return attemptRequestWithFreshAbort(attempt + 1, newAbortCtrl, newTimeoutId);
            }
            throw e;
        }
    }

    try {
        await attemptRequestWithFreshAbort(0, abortMain, timeoutId);
    } catch (e) {
        // ★ 智能错误恢复: image_url 格式错误 → 自动切换为分析工具模式重试
        if (e.message && (e.message.includes('unknown variant') || e.message.includes('image_url'))) {
            const retried = await autoDetectAndRetryImageUrlError(e.message, chatId, pendingMsg, currentBubble);
            if (retried) return; // 自动重试成功
        }
        handleError(e, chatId, pendingMsg, currentBubble);
    } finally {
        // 清理临时消息
        chats[chatId].messages = chats[chatId].messages.filter(m => !m.temporary);
        delete isTypingMap[chatId];
        delete abortControllerMap[chatId];
        delete searchAbortControllerMap[chatId];
        delete activeBubbleMap[chatId];
        delete userAbortMap[chatId];  // 清理用户中止标记
        window._agentNotifyProcessing = false;
        if (currentChatId === chatId) {
            if ($.sendBtn) $.sendBtn.classList.remove('hidden');
            if ($.stopBtn) $.stopBtn.classList.remove('visible');
        }
        if (Object.keys(isTypingMap).length === 0) localStorage.removeItem('ongoingChats');
        else saveOngoingChatsSnapshot();
    }
};

// ==================== 对话管理 ====================
function saveOngoingChatsSnapshot() {
    localStorage.setItem('ongoingChats', JSON.stringify(Object.keys(isTypingMap).filter(id => isTypingMap[id])));
}

async function restoreOngoingChats() {
    const ongoing = JSON.parse(localStorage.getItem('ongoingChats') || '[]');
    for (const id of ongoing) {
        if (chats[id]) {
            const lastUser = [...chats[id].messages].reverse().find(m => m.role === 'user');
            if (lastUser) await sendMessage(true, lastUser.text, lastUser.files);
        }
    }
    localStorage.removeItem('ongoingChats');
}

async function compressContextIfNeeded(chatId) {
    if (chats[chatId]?._compressFailed) return;
    const msgs = chats[chatId].messages;
    const threshold = parseInt(getVal('compressThreshold')) || 10;

    const sysMessages = msgs.filter(m => m.role === 'system' && !m.temporary);
    const partial = msgs.filter(m => m.partial);
    const nonPartial = msgs.filter(m => m.role !== 'system' && !m.partial && !m.temporary);

    if (nonPartial.length <= threshold) return;

    const keep = Math.max(2, Math.floor(threshold / 2));
    const toSummarize = nonPartial.slice(0, nonPartial.length - keep);
    const toKeepNonPartial = nonPartial.slice(-keep);

    let conv = '';
    for (const m of toSummarize) {
        if (m.role === 'user') {
            conv += `用户: ${buildUserContent(m.text, m.files)}\n`;
        } else {
            conv += `助手: ${m.content}\n`;
        }
    }
    const prompt = `总结以下对话的核心内容:\n${conv}`;
    const model = getVal('compressModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;

    try {
        const compressBody = { model, messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 500 };
        compressBody.extra_body = { thinking: { type: "disabled" } };
        const res = await fetch(`${getVal('baseUrl')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getVal('apiKey')}` },
            body: JSON.stringify(compressBody)
        });
        const data = await res.json();
        const summary = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '';

        const summaryMsg = { role: 'system', content: '[历史摘要] ' + summary };
        const newMessages = [...sysMessages, summaryMsg, ...toKeepNonPartial, ...partial];
        chats[chatId].messages = newMessages;
        saveChats();
        if (currentChatId === chatId) loadChat(chatId);
    } catch {
        if (chats[chatId]) chats[chatId]._compressFailed = true;
        showToast('上下文压缩失败,已跳过。可尝试清理对话历史或增加阈值。', 'error', 5000);
    }
}

async function autoGenerateTitle(chatId) {
    const msgs = chats[chatId].messages.filter(m => m.role !== 'system' && !m.partial);
    if (msgs.length < 2) return;
    let recent = '';
    for (const m of msgs.slice(0, 4)) {
        if (m.role === 'user') recent += '用户: ' + buildUserContent(m.text, m.files) + '\n';
        else recent += '助手: ' + m.content + '\n';
    }
    const model = getVal('titleModel') || 'deepseek-v4-flash';
    if (!model) return;
    try {
        const body = {
            model,
            messages: [{
                role: 'user',
                content: recent + '\n---\n给这段对话起一个标题(不超过' + TITLE_MAX_LENGTH + '字):'
            }],
            temperature: 0,
            max_tokens: 500
        };
        // 尝试关闭思考模式，多个 API 兼容
        body.extra_body = body.extra_body || {};
        body.extra_body.thinking = { type: "disabled" };
        // MiniMax 兼容
        body.reasoning_split = false;
        const res = await fetch(getVal('baseUrl') + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getVal('apiKey') },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        let rawTitle = data.choices[0].message.content || '';
        // 清理 think 标签（某些模型即使禁用了 thinking 还是会输出）
        rawTitle = rawTitle.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        // 清理星号包裹（MiniMax 等模型喜欢加 **粗体**）
        rawTitle = rawTitle.replace(/^\*+\s*|\s*\*+$/g, '').trim();
        let finalTitle = rawTitle;
        if (!finalTitle) {
            const reasoning = data.choices[0].message.reasoning_content || '';
            // 从 reasoning 里提取最后一句作为标题
            const cleanReasoning = reasoning.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            const lines = cleanReasoning.split(/\n|。/);
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim().replace(/^\*+\s*|\s*\*+$/g, '').trim();
                if (line.length >= 2 && line.length <= TITLE_MAX_LENGTH + 5 &&
                    !/^(我们|只|你|输出|生成|返回|请|需要|应该|可以|内容|对话|标题|用户|助手|根据|这段|好的)/.test(line)) {
                    finalTitle = line;
                    break;
                }
            }
            if (!finalTitle) finalTitle = cleanReasoning.replace(/^\*+\s*|\s*\*+$/g, '').trim();
        }
        finalTitle = finalTitle
            .replace(/[""''《》「」]/g, '')
            .replace(/^(标题[:：]?\s*|我.*?[,，]\s*|根据.*?[,，]\s*|对话标题[:：]?\s*|好的?\s*[,，]?\s*)/i, '')
            .replace(/[。，、！？!?,;；\n].*$/s, '')
            .trim();
        if (!finalTitle || finalTitle.length < 1 || /^(我们|只|你|输出|生成|返回|请|需要|应该)/.test(finalTitle)) {
            const firstUserMsg = msgs.find(m => m.role === 'user');
            finalTitle = firstUserMsg ? firstUserMsg.text.slice(0, TITLE_MAX_LENGTH) : '新对话';
        }
        if (finalTitle.length > TITLE_MAX_LENGTH) finalTitle = finalTitle.slice(0, TITLE_MAX_LENGTH);
        typeTitle(chatId, finalTitle);
    } catch (e) { /* 静默失败 */ }
}

async function typeTitle(chatId, finalTitle, index = 0) {
    if (currentChatId !== chatId) {
        chats[chatId].title = finalTitle;
        saveChatsDebounced();
        renderChatHistory();
        updateHeaderTitle();
        return;
    }
    if (index === 0) {
        chats[chatId].title = '';
        saveChatsDebounced();
        renderChatHistory();
        updateHeaderTitle();
    }
    if (index < finalTitle.length) {
        chats[chatId].title = finalTitle.substring(0, index + 1);
        saveChatsDebounced(100);
        renderChatHistory();
        updateHeaderTitle();
        await new Promise(r => setTimeout(r, 10));
        typeTitle(chatId, finalTitle, index + 1);
    } else {
        chats[chatId].title = finalTitle;
        saveChatsDebounced();
        renderChatHistory();
        updateHeaderTitle();
    }
}

function saveChats() {
    // 优先保存到服务器(异步,不阻塞)
    setTimeout(() => saveChatsToServer(), 100);
    
    // ★ 本地精简保存（去掉图片base64等大体积数据）
    slimSaveChats();
    // ★ 保存当前 partial 消息到 localStorage（防止刷新丢失）
    // ★ 只在 beforeunload 时保存（由 beforeunload handler 触发 slimSaveChats）
    // ★ 避免频繁写入导致性能问题
}

// 压缩聊天记录（现在只做浅拷贝，不删除任何图片数据）
function compressChatsForStorage(chatsObj) {
    // ★ 精简副本：去掉大体积数据，只保留摘要信息给 localStorage
    const slim = {};
    const chatIds = Object.keys(chatsObj).sort((a, b) => {
        const ta = chatsObj[a].updated_at || '';
        const tb = chatsObj[b].updated_at || '';
        return tb.localeCompare(ta); // 最新的排前面
    });
    
    // 只保留最近 N 个聊天的完整数据，其余的只保留标题和时间
    const MAX_CHATS = 30;
    chatIds.forEach((id, idx) => {
        const chat = chatsObj[id];
        if (idx < MAX_CHATS) {
            // 保留完整数据但去除大字段
            slim[id] = JSON.parse(JSON.stringify(chat));
            if (slim[id].messages) {
                slim[id].messages = slim[id].messages.map(function(msg) {
                    // 移除图片 base64 数据（服务器有备份）
                    if (msg.generatedImage) delete msg.generatedImage;
                    if (msg.generatedImages) delete msg.generatedImages;
                    if (msg.files) {
                        msg.files = msg.files.map(function(f) {
                            if (f.content && (f.isImage || (f.type && f.type.startsWith('image/')))) {
                                // ★ 用1x1透明图占位，避免浏览器把中文文本当URL请求
                                return { name: f.name, type: f.type || 'image/png', size: f.size, isImage: true, content: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' };
                            }
                            if (f.content && f.content.length > 5000) {
                                return { name: f.name, type: f.type, size: f.size, isImage: f.isImage, content: '' };
                            }
                            return f;
                        });
                    }
                    // 截断超长消息内容
                    if (msg.content && msg.content.length > 10000) {
                        msg.content = msg.content.slice(0, 10000) + '...(内容已截断)';
                    }
                    return msg;
                });
            }
        } else {
            // 旧聊天只保留骨架
            slim[id] = {
                title: chat.title || '新对话',
                updated_at: chat.updated_at || '',
                messages: chat.messages ? chat.messages.slice(-2) : []
            };
        }
    });
    return slim;
}

function slimSaveChats() {
    try {
        const slim = compressChatsForStorage(chats);
        localStorage.setItem('chats', JSON.stringify(slim));
        return true;
    } catch (e) {
        // 还是太大，只保留最近5个聊天
        try {
            const mini = {};
            const ids = Object.keys(chats).slice(-5);
            ids.forEach(function(id) {
                mini[id] = { title: chats[id].title || '新对话', updated_at: chats[id].updated_at || '', messages: (chats[id].messages || []).slice(-4) };
            });
            localStorage.setItem('chats', JSON.stringify(mini));
            return true;
        } catch(e2) {
            return false;
        }
    }
}

let _saveDebounceTimer = null;
function saveChatsDebounced(wait = 300) {
    if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = setTimeout(() => {
        _saveDebounceTimer = null;
        saveChats();
    }, wait);
}

function renderChatHistory() {
    const list = getEl('chatHistoryList');
    if (!list) return;
    // ★ 登录用户只显示自己账号的聊天记录
    var _uid = localStorage.getItem('authUserId') || '';
    var _chatIds = Object.keys(chats).filter(function(id) {
        return !_uid || !chats[id].userId || chats[id].userId === _uid;
    });
    list.innerHTML = _chatIds.reverse().map(id => `
        <div onclick="window.loadChat('${id}')" class="group flex items-center justify-between p-2 rounded-xl cursor-pointer transition ${id === currentChatId ? 'bg-white dark:bg-gray-800 shadow-sm text-blue-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'}">
            <span class="truncate text-sm">${escapeHtml(chats[id].title)}</span>
            <button onclick="window.deleteChat(event, '${id}')" class="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500"><svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
        </div>
    `).join('');
}

var RAG_ENABLED = localStorage.getItem('ragEnabled') !== 'false';
var RAG_API = '/oneapichat/rag_proxy.php';
window.RAG_ENABLED = RAG_ENABLED;

window.deleteChat = function (e, id) {
    e.stopPropagation();
    if (!confirm('删除对话?')) return;
    if (abortControllerMap[id]) abortControllerMap[id].abort();
    if (searchAbortControllerMap[id]) searchAbortControllerMap[id].abort();
    delete abortControllerMap[id];
    delete searchAbortControllerMap[id];
    delete isTypingMap[id];
    delete activeBubbleMap[id];
    delete userAbortMap[id];  // 清理用户中止标记
    _deletedChatIds[id] = true; // 标记删除，合并时排除
    delete chats[id];
    saveChats();
    // ★ 只检查当前用户的聊天数量，忽略其他用户的残留
    var _uid = localStorage.getItem('authUserId') || '';
    var myKeys = Object.keys(chats).filter(function(k) {
        return !_uid || !chats[k].userId || chats[k].userId === _uid;
    });
    if (myKeys.length) loadChat(myKeys[myKeys.length - 1]);
    else createNewChat();
    renderChatHistory();
};

window.createNewChat = function () {
    const id = 'chat_' + Date.now();
    var uid = localStorage.getItem('authUserId') || '';
    chats[id] = {
        title: '新对话',
        userId: uid,
        messages: [
            { role: 'system', content: getVal('systemPrompt') || DEFAULT_CONFIG.system }
        ]
    };
    saveChats();
    loadChat(id);
    renderChatHistory();
    updateHeaderTitle();
};

window.loadChat = function (id) {
    currentChatId = id;
    localStorage.setItem('lastChatId', id);
    const container = $.chatMessagesContainer;
    if (!container) return;

    const prefix = container.classList.contains('paragraph-prefix-dot') ? 'dot' : (container.classList.contains('paragraph-prefix-dash') ? 'dash' : 'none');
    container.innerHTML = '';
    applyParagraphPrefix(prefix);

    // ★ 恢复刷新前未完成的流式消息
    try {
        var savedPartial = JSON.parse(localStorage.getItem('_savedPartial') || 'null');
        if (savedPartial && savedPartial.chatId === id && (savedPartial.content || savedPartial.reasoning)) {
            chats[id].messages.push({
                role: 'assistant',
                content: savedPartial.content,
                reasoning: savedPartial.reasoning,
                partial: false,
                time: Date.now(),
                _recovered: true
            });
        }
    } catch(e) {}
    localStorage.removeItem('_savedPartial');

    const displayMsgs = chats[id].messages.filter(m => m.role !== 'system');
    if (!displayMsgs.length) {
        showWelcome();
    } else {
        displayMsgs.forEach((m, i) => {
            // ★ 修复: 清理已保存的 [object Object] 残留
            if (typeof m.content === 'string') {
                if (m.content === '[object Object]') {
                    m.content = '';
                } else {
                    m.content = m.content.replace(/\[object Object\]/g, '');
                }
            } else if (m.content && typeof m.content === 'object') {
                const extracted = m.content.text || m.content.content || m.content.value || '';
                if (extracted) {
                    m.content = '' + extracted;
                } else if (Array.isArray(m.content)) {
                    m.content = m.content.map(c => typeof c === 'object' ? (c.text || c.content || '') : String(c)).filter(Boolean).join('');
                } else {
                    m.content = JSON.stringify(m.content);
                }
            } else if (m.content === undefined || m.content === null) {
                m.content = '';
            }
            if (m.role === 'user') {
                appendMessage('user', m.text || '', m.files || null, null, null, null, i === displayMsgs.length - 1);
            } else {
                // ★ 修复: 对带工具调用的消息,在文本前追加工具调用可视化说明
                var toolDisplayHtml = '';
                if (m.tool_calls && m.tool_calls.length > 0) {
                    toolDisplayHtml = '<div class="tool-calls-history" style="font-size:12px;padding:8px 10px;margin-bottom:8px;background:#f0f4ff;border-radius:8px;border-left:3px solid #6366f1;">';
                    m.tool_calls.forEach(function(tc) {
                        var toolIcon = '🔧';
                        if (tc.function && tc.function.name) {
                            if (tc.function.name === 'web_search') toolIcon = '🔍';
                            else if (tc.function.name === 'web_fetch') toolIcon = '🌐';
                            else if (tc.function.name === 'generate_image' || tc.function.name === 'generate_image_i2i') toolIcon = '🎨';
                            else if (tc.function.name.indexOf('agent') !== -1) toolIcon = '🤖';
                            else if (tc.function.name.indexOf('cron') !== -1) toolIcon = '⏰';
                            else if (tc.function.name.indexOf('server_') !== -1) toolIcon = '🖥️';
                            toolDisplayHtml += '<div class="tool-call-item" style="padding:2px 0;">' + toolIcon + ' ' + escapeHtml(tc.function.name) + '</div>';
                        }
                    });
                    // 如果有工具结果,显示简短结果
                    if (m.tool_results && m.tool_results.length > 0) {
                        m.tool_results.forEach(function(tr, ti) {
                            var resultText = typeof tr === 'string' ? tr : (tr.content || tr.result || '');
                            if (resultText && resultText.length > 120) resultText = resultText.slice(0, 120) + '...';
                            if (resultText && toolDisplayHtml) {
                                toolDisplayHtml += '<div class="tool-result-item" style="padding:1px 0 1px 16px;color:#666;font-size:11px;">→ ' + escapeHtml(resultText).replace(/\n/g, '<br>') + '</div>';
                            }
                        });
                    }
                    toolDisplayHtml += '</div>';
                }
                var displayText = compressNewlines(m.content, 2);
                // 工具调用 + 文本 + 图片
                if (toolDisplayHtml) {
                    // 插入工具调用html到文本之前
                    displayText = toolDisplayHtml + displayText;
                }
                appendMessage('assistant', displayText, null, m.reasoning, m.usage, m.time, i === displayMsgs.length - 1, m.generatedImage || null, m.generatedImages || null);
            }
        });
    }

    if (isTypingMap[id] && displayMsgs.length) {
        activeBubbleMap[id] = container.lastElementChild?.querySelector('.bubble.assistant');
    } else {
        delete activeBubbleMap[id];
    }

    renderChatHistory();
    updateHeaderTitle();

    if (isTypingMap[id]) {
        if ($.sendBtn) $.sendBtn.classList.add('hidden');
        if ($.stopBtn) {
            $.stopBtn.classList.remove('hidden');
            $.stopBtn.classList.add('visible');
        }
    } else {
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
    }

    if (isMobile()) {
        $.sidebar?.classList.remove('mobile-open');
        $.configPanel?.classList.remove('mobile-open');
        $.sidebarMask?.classList.remove('active');
    }

    // 加载完成后自动滚动（loadChat 模式不受距离限制）
    autoScrollToBottom('loadChat');
};

function updateHeaderTitle() {
    if ($.chatTitle && currentChatId && chats[currentChatId]) {
        $.chatTitle.textContent = chats[currentChatId].title || '新对话';
    }
}

// ==================== 初始化 ====================
function cacheDOMElements() {
    $.chatBox = getEl('chatBox');
    $.chatMessagesContainer = getEl('chatMessagesContainer');
    $.userInput = getEl('userInput');
    $.sendBtn = getEl('sendBtn');
    if ($.sendBtn) {
        $.sendBtn.addEventListener('click', function(e) { e.stopPropagation(); });
    }
    $.stopBtn = getEl('stopBtn');
    $.filePreviewContainer = getEl('filePreviewContainer');
    $.fileInput = getEl('fileInput');
    $.imageInput = getEl('imageInput');
    $.scrollToBottomBtn = getEl('scrollToBottomBtn');
    $.chatTitle = getEl('chatTitle');
    $.sidebar = getEl('sidebar');
    $.configPanel = getEl('configPanel');
    $.sidebarMask = getEl('sidebarMask');
    $.sidebarToggle = getEl('sidebarToggle');
    $.searchQuickToggle = getEl('searchQuickToggle');
}

function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .bubble.assistant.typing .markdown-body { min-height:1.5em; position:relative; }
        .bubble.assistant.typing .markdown-body::after { content:'...'; display:inline-block; animation:typing-dots 1.2s steps(4,end) infinite; width:1.5em; text-align:left; font-size:1.2em; line-height:1; opacity:0.7; }
        @keyframes typing-dots { 0%,20% { content:''; } 40% { content:'.'; } 60% { content:'..'; } 80%,100% { content:'...'; } }
        .bubble.assistant { padding:12px 16px; }
        .toast-container { position:fixed; top:20px; right:20px; z-index:9999; }
        .toast { display:flex; align-items:center; padding:12px 16px; margin-bottom:10px; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15); animation:slideIn 0.3s ease-out; max-width:350px; min-width:200px; }
        .toast-success { background:#d1fae5; color:#065f46; border-left:4px solid #10b981; }
        .toast-error { background:#fee2e2; color:#991b1b; border-left:4px solid #ef4444; }
        .toast-warning { background:#fef3c7; color:#92400e; border-left:4px solid #f59e0b; }
        .toast-info { background:#dbeafe; color:#1e40af; border-left:4px solid #3b82f6; }
        .toast-icon { margin-right:10px; font-weight:bold; }
        .toast-message { flex:1; font-size:14px; }
        .toast-close { background:none; border:none; font-size:18px; cursor:pointer; color:inherit; opacity:0.7; margin-left:10px; }
        .toast-close:hover { opacity:1; }
        @keyframes slideIn { from { transform:translateX(100%); opacity:0; } to { transform:translateX(0); opacity:1; } }

        .markdown-body img { max-width: 100%; max-height: 300px; object-fit: contain; border-radius: 8px; margin: 8px 0; }
        .markdown-body a { color: #0366d6; text-decoration: underline; text-underline-offset: 2px; }
        .markdown-body a:hover { color: #0056b3; text-decoration: none; background-color: #f0f6ff; }
        .search-placeholder { color: #666; font-style: italic; }
        .search-status { background: rgba(0,0,0,0.03); border-radius: 4px; padding: 4px 8px; margin-bottom: 8px; font-size: 0.9em; color: #666; max-height: 100px; overflow-y: auto; }
        .dark .search-status { background: rgba(255,255,255,0.1); color: #aaa; }
        .code-actions { position: absolute; top: 4px; right: 4px; z-index: 5; display: flex; gap: 4px; pointer-events: none; opacity: 0; transition: opacity 0.2s; min-width: 0; width: auto; }
        .markdown-body pre { overflow-x: auto; overflow-y: visible; }
        .markdown-body pre:hover .code-actions { opacity: 1; }
        .code-actions > * { pointer-events: auto; }
        .code-actions .code-run-btn, .code-actions .code-copy-btn { position: static !important; top: auto !important; right: auto !important; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 20px; cursor: pointer; flex-shrink: 0; opacity: 1 !important; z-index: auto !important; }
        .code-actions .code-copy-btn { background: rgba(255,255,255,0.8); backdrop-filter: blur(4px); border: 1px solid #e5e7eb; color: #4b5563; }
        .dark .code-actions .code-copy-btn { background: #374151; border-color: #4b5563; color: #d1d5db; }
        .code-actions .code-run-btn { background: rgba(34,197,94,0.85); border: 1px solid #22c55e; color: #fff; }
        .dark .code-actions .code-run-btn { background: rgba(34,197,94,0.7); border-color: #22c55e; color: #fff; }
        .code-actions svg { width: 14px; height: 14px; display: block; }
        .rag-panel { margin:0 12px 12px; border:1px solid #e5e7eb; border-radius:12px; background:#fff; overflow:hidden; display:none; }
        .dark .rag-panel { background:#1f2937; border-color:#374151; }
        .rag-panel.open { display:block; }
        .rag-panel-header { display:flex; justify-content:space-between; align-items:center; padding:8px 14px; background:#f9fafb; border-bottom:1px solid #e5e7eb; font-size:13px; font-weight:600; gap:6px; }
        .dark .rag-panel-header { background:#111827; border-color:#374151; }
        .rag-close-btn { cursor:pointer; padding:0 6px; font-size:18px; opacity:0.6; border:none; background:none; color:inherit; }
        .rag-close-btn:hover { opacity:1; }
        .rag-panel-body { padding:8px 12px; }
        .rag-upload-area { border:2px dashed #d1d5db; border-radius:8px; padding:10px; text-align:center; cursor:pointer; margin:4px 0; font-size:12px; }
        .dark .rag-upload-area { border-color:#4b5563; }
        .rag-upload-area:hover, .rag-upload-area.dragover { border-color:#3b82f6; background:rgba(59,130,246,0.05); }
        .rag-doc-list { max-height:120px; overflow-y:auto; }
        .rag-doc-item { display:flex; align-items:center; padding:3px 6px; border-radius:4px; font-size:11px; gap:4px; }
        .rag-doc-item:hover { background:rgba(59,130,246,0.05); }
        .rag-doc-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:1.6; }
        .rag-doc-chunks { font-size:10px; color:#9ca3af; white-space:nowrap; }
        .rag-doc-delete { cursor:pointer; border:none; background:none; color:#9ca3af; padding:0 4px; font-size:13px; line-height:1; border-radius:4px; flex-shrink:0; opacity:0.5; transition:opacity .15s; }
        .rag-doc-delete:hover { opacity:1; color:#ef4444; }
        .rag-empty { text-align:center; padding:12px; color:#9ca3af; font-size:11px; }
        .rag-query-area { display:flex; gap:4px; margin-top:6px; }
        .rag-query-input { flex:1; padding:4px 8px; border:1px solid #d1d5db; border-radius:6px; font-size:11px; }
        .dark .rag-query-input { background:#374151; border-color:#4b5563; color:#d1d5db; }
        .rag-query-btn { padding:4px 12px; background:#3b82f6; color:#fff; border:none; border-radius:6px; font-size:11px; cursor:pointer; }
        .rag-helper-text { font-size:10px; color:#9ca3af; margin-top:4px; text-align:center; }
        .rag-progress { margin:4px 0; }
        .rag-progress-track { height:4px; background:#e5e7eb; border-radius:4px; overflow:hidden; }
        .rag-progress-fill { height:100%; background:linear-gradient(90deg,#3b82f6,#06b6d4); border-radius:4px; transition:width .3s; }
        .rag-progress-text { font-size:10px; color:#6b7280; margin-top:2px; text-align:center; }
    `;
    document.head.appendChild(style);
}

// ==================== 恢复默认配置 ====================
function createRAGEntry() {
    if (getEl('ragConfigEntry')) return;
    var panel = $.configPanel || getEl('configPanel');
    if (!panel) return;
    var div = document.createElement('div');
    div.id = 'ragConfigEntry';
    div.className = 'config-item mt-4 pt-4 border-t border-gray-200 dark:border-gray-800';
    div.innerHTML = '<button onclick="var p=document.getElementById(\'ragPanel\');if(p){p.classList.toggle(\'open\');p.scrollIntoView({behavior:\'smooth\'});if(typeof loadKnowledgeList===\'function\')loadKnowledgeList();}" class="w-full px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors flex items-center justify-center gap-2"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> 知识库管理</button>';
    panel.appendChild(div);
}

function createResetButton() {
    if (getEl('resetConfigBtn')) return; // 已存在
    const panel = $.configPanel || getEl('configPanel');
    if (!panel) return;
    const div = document.createElement('div');
    div.className = 'config-item mt-4 pt-4 border-t border-gray-200 dark:border-gray-800';
    div.innerHTML = `
        <button id="resetConfigBtn" class="w-full px-3 py-2 text-sm font-medium text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors flex items-center justify-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            恢复默认设置
        </button>
    `;
    panel.appendChild(div);
    getEl('resetConfigBtn').addEventListener('click', resetConfig);
}

function resetConfig() {
    if (!confirm('确定恢复所有设置为默认值吗?此操作将刷新页面。')) return;
    // 配置相关的 localStorage 键列表(与 saveConfig 中存储的键保持一致)
    const configKeys = [
        'apiKey', 'baseUrl', 'systemPrompt', 'model', 'temp', 'tokens',
        'stream', 'requestTimeout',
        'compress', 'threshold', 'compressModel', 'customParams', 'customEnabled',
        'lineHeight', 'paragraphMargin',
        'markdownGFM', 'markdownBreaks', 'titleModel',
        'enableSearch', 'aiSearchJudge', 'aiSearchJudgeModel', 'aiSearchJudgePrompt',
        'searchModel', 'searchProvider', 'searchApiKey', 'searchRegion',
        'searchTimeout', 'maxSearchResults', 'fontSize',
        'searchType', 'aiSearchTypeToggle', 'searchShowPrompt', 'searchAppendToSystem'
    ];
    configKeys.forEach(key => localStorage.removeItem(key));
    // 刷新页面使所有配置生效
    window.location.reload();
}


// ★ 导出聊天记录
function exportChats() {
    if (!chats || Object.keys(chats).length === 0) {
        alert('没有聊天记录可导出');
        return;
    }
    const exportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        chats: chats
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oneapichat-chats-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log('[export] 导出聊天记录:', Object.keys(chats).length, '个');
}

// ★ 导出当前对话为文本
function exportCurrentChat() {
    if (!currentChatId || !chats[currentChatId]) {
        alert('没有当前对话可导出');
        return;
    }
    var chat = chats[currentChatId];
    var title = chat.title || '当前对话';
    var lines = [];
    lines.push('标题: ' + title);
    lines.push('导出时间: ' + new Date().toLocaleString('zh-CN'));
    lines.push('='.repeat(50));
    lines.push('');
    
    var msgs = chat.messages || [];
    msgs.forEach(function(m) {
        if (m.role === 'system') return;
        var roleName = m.role === 'user' ? '👤 你' : '🤖 AI';
        var text = m.content || '';
        lines.push(roleName + ':');
        lines.push(text);
        // 如果有generatedImages
        if (m.generatedImage) lines.push('[图片: ' + m.generatedImage.substring(0, 50) + '...]');
        if (m.generatedImages && m.generatedImages.length) {
            m.generatedImages.forEach(function(img) {
                lines.push('[图片: ' + img.substring(0, 50) + '...]');
            });
        }
        // 工具调用
        if (m.tool_calls && m.tool_calls.length) {
            m.tool_calls.forEach(function(tc) {
                if (tc.function) lines.push('[工具调用: ' + tc.function.name + ']');
            });
        }
        lines.push('');
    });
    
    var text = lines.join('\n');
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = title.replace(/[\\/:*?"<>|]/g, '_') + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ★ 导入聊天记录
function importChats() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                const data = JSON.parse(ev.target.result);
                if (!data.chats || typeof data.chats !== 'object') {
                    alert('无效的导入文件：缺少 "chats" 字段');
                    return;
                }
                                var imported = 0;
                for (var id in data.chats) {
                    var newId = id;
                    if (chats[id]) {
                        newId = 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                    }
                    chats[newId] = JSON.parse(JSON.stringify(data.chats[id]));
                    // 清除用户隔离标记，确保当前账号能看到
                    delete chats[newId].userId;
                    if (!chats[newId].messages) chats[newId].messages = [];
                    imported++;
                }
                renderChatHistory();
                alert('导入完成：新增 ' + imported + ' 个聊天');
                console.log('[import] 导入:', imported);
                // 保存到服务器
                saveChats();
                // 保存到服务器
                saveChatsToServer();
            } catch(err) {
                alert('导入失败：' + err.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ★ 创建数据管理区域
function createDataManagementSection() {
    if (getEl('dataManagementSection')) return;
    const panel = $.configPanel || getEl('configPanel');
    if (!panel) return;
    const div = document.createElement('div');
    div.id = 'dataManagementSection';
    div.className = 'config-item mt-4 pt-4 border-t border-gray-200 dark:border-gray-800';
    div.innerHTML = '<h3 class="text-xs font-bold text-gray-400 uppercase mb-3">数据管理</h3>\n' +
        '<div class="space-y-2">\n' +
        '<button id="exportChatsBtn" class="w-full px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors flex items-center justify-center gap-2">\n' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>\n' +
        '导出聊天记录\n' +
        '</button>\n' +
        '<button id="importChatsBtn" class="w-full px-3 py-2 text-sm font-medium text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors flex items-center justify-center gap-2">\n' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>\n' +
        '导入聊天记录\n' +
        '</button>\n' +
        '<button id="exportCurrentChatBtn" class="w-full px-3 py-2 text-sm font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors flex items-center justify-center gap-2">\n' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>\n' +
        '导出当前对话\n' +
        '</button>\n' +
        '</div>';
    panel.appendChild(div);
    getEl('exportChatsBtn').addEventListener('click', exportChats);
    var _exportBtn = getEl('exportCurrentChatBtn');
    if (_exportBtn) _exportBtn.addEventListener('click', exportCurrentChat);
    getEl('importChatsBtn').addEventListener('click', importChats);
}
// ==================== 初始化配置 ====================
function initializeConfig() {
    // ★ API Key: 过滤掉无效的"not-needed"占位值
    const storedApiKey = decrypt(localStorage.getItem('apiKey') || '');
    const cleanApiKey = (storedApiKey && storedApiKey !== 'not-needed') ? storedApiKey : '';
    setVal('apiKey', cleanApiKey || '');
    setVal('baseUrl', localStorage.getItem('baseUrl') || DEFAULT_CONFIG.url);
    setVal('modelSelect', localStorage.getItem('model') || DEFAULT_CONFIG.model);
    setVal('visionModel', localStorage.getItem('visionModel') || DEFAULT_CONFIG.visionModel || '');
    setVal('visionApiUrl', localStorage.getItem('visionApiUrl') || DEFAULT_CONFIG.visionApiUrl || '');
    const storedVisionKey = decrypt(localStorage.getItem('visionApiKey') || '');
    const cleanVisionKey = (storedVisionKey && storedVisionKey !== 'not-needed') ? storedVisionKey : '';
    setVal('visionApiKey', cleanVisionKey || '');
    const storedImageKey = decrypt(localStorage.getItem('imageApiKey') || '');
    const cleanImageKey = (storedImageKey && storedImageKey !== 'not-needed') ? storedImageKey : '';
    setVal('imageApiKey', cleanImageKey || '');
    setVal('imageModel', localStorage.getItem('imageModel') || DEFAULT_CONFIG.imageModel || '');
    setVal('imageBaseUrl', localStorage.getItem('imageBaseUrl') || DEFAULT_CONFIG.imageBaseUrl || '');
    setVal('systemPrompt', localStorage.getItem('systemPrompt') || DEFAULT_CONFIG.system);
    setVal('customParams', localStorage.getItem('customParams') || DEFAULT_CONFIG.customParams);
    setChecked('customParamsToggle', localStorage.getItem('customEnabled') === 'true');

    const temp = localStorage.getItem('temp') || '0.7';
    setVal('temperature', temp);
    const tempSpan = getEl('tempValue');
    if (tempSpan) tempSpan.innerText = temp;

    const tokens = localStorage.getItem('tokens') || '4096';
    setVal('maxTokens', tokens);
    setVal('maxTokensInput', tokens);

    setChecked('streamToggle', localStorage.getItem('stream') !== 'false');
    setVal('requestTimeout', localStorage.getItem('requestTimeout') || DEFAULT_CONFIG.requestTimeout);
    setChecked('compressToggle', localStorage.getItem('compress') === 'true');
    setVal('compressThreshold', localStorage.getItem('threshold') || '10');
    setVal('compressModel', localStorage.getItem('compressModel') || '');

    const lh = parseFloat(localStorage.getItem('lineHeight') || DEFAULT_CONFIG.lineHeight);
    setVal('lineHeight', lh);
    const lhSpan = getEl('lineHeightValue');
    if (lhSpan) lhSpan.innerText = lh.toFixed(2);
    document.documentElement.style.setProperty('--chat-line-height', lh);

    const pm = parseFloat(localStorage.getItem('paragraphMargin') || DEFAULT_CONFIG.paragraphMargin);
    setVal('paragraphMargin', pm);
    const pmSpan = getEl('paragraphMarginValue');
    if (pmSpan) pmSpan.innerText = pm.toFixed(2);
    document.documentElement.style.setProperty('--chat-paragraph-margin', pm + 'rem');
    setChecked('markdownGFM', localStorage.getItem('markdownGFM') !== 'false');
    setChecked('markdownBreaks', localStorage.getItem('markdownBreaks') !== 'false');
    if (window.marked) {
        marked.setOptions({ gfm: getChecked('markdownGFM'), breaks: getChecked('markdownBreaks'), pedantic: false });
        // 不再使用自定义 paragraph renderer（marked v15 默认已正确处理，自定义 renderer 会导致 [object Object]）
    }

    if (localStorage.getItem('dark') === 'true') toggleDarkMode(true);
    else {
        const theme = getEl('hljsTheme');
        if (theme) theme.href = 'lib/atom-one-light.min.css';
    }

    createTitleModelSelector();
    createSearchConfigSection();
    loadSearchConfig();  // ★ 确保第二次 initializeConfig（服务器同步后）也重新加载搜索配置
    initFontSize();
    if (window.initToolModeBtn) initToolModeBtn();
    createSearchToggleButton();
    // Agent 模式初始化
    initAgentConfig();
    updateAgentUI();
    // 配置面板打开时自动刷新引擎状态
    var configToggleBtn = document.querySelector('button[onclick*="toggleConfigPanel"]');
    if (configToggleBtn) {
        configToggleBtn.addEventListener('click', function() {
            setTimeout(function() {
                var cp = $.configPanel;
                if (cp && !cp.classList.contains('hidden-panel')) {
                    window.refreshEngineStatus();
                }
            }, 600);
        });
    }
    if (window.initChaoxingMonitor) {
        initChaoxingMonitor();
        var toggle = document.getElementById('chaoxingMonitorToggle');
        if (toggle) toggle.checked = localStorage.getItem('chaoxingAutoReport') === 'true';
    }

    if (!$.chatTitle) {
        if (isMobile()) {
            // ★ 移动端：聊天标题不放入 header（避免撑爆布局），改用浮动标签放在聊天区域顶部
            $.chatTitle = document.createElement('div');
            $.chatTitle.id = 'chatTitle';
            $.chatTitle.dataset.mobile = '1';
            $.chatTitle.textContent = '新对话';
            document.getElementById('chatBox')?.prepend($.chatTitle);
        } else {
            const header = document.querySelector('header');
            const left = header?.querySelector('.flex.items-center.gap-4');
            const right = header?.querySelector('.flex.items-center.gap-3');
            if (left && right) {
                const title = document.createElement('div');
                title.id = 'chatTitle';
                title.className = 'chat-title';
                title.textContent = '新对话';
                header.insertBefore(title, right);
                $.chatTitle = title;
            }
        }
    }

    // 移动端配置输入框聚焦时自动展开面板
    if (isMobile()) {
        const configInputs = $.configPanel?.querySelectorAll('input, textarea, select');
        configInputs?.forEach(el => {
            el.addEventListener('focus', () => {
                keyboardActive = true;
                if ($.configPanel && !$.configPanel.classList.contains('mobile-open')) {
                    $.configPanel.classList.add('mobile-open');
                    $.sidebarMask?.classList.add('active');
                }
                setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
            });
            el.addEventListener('blur', () => {
                keyboardActive = false;
            });
        });
    }

    // 添加恢复默认按钮
    createResetButton();
    createRAGEntry();
    // 添加数据管理区域
    createDataManagementSection();
}

function initAgentConfig() {
    var agentMode = localStorage.getItem('agentMode') === 'true';
    setChecked('agentModeToggle', agentMode);
    setChecked('agentAutoDecision', localStorage.getItem('agentAutoDecision') !== 'false');
    setChecked('agentProactive', localStorage.getItem('agentProactive') === 'true');
    setVal('agentMaxToolRounds', localStorage.getItem('agentMaxToolRounds') || '30');
    setVal('agentThinkingDepth', localStorage.getItem('agentThinkingDepth') || 'standard');
    setVal('agentSystemPrompt', localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt);
    // ★ Agent 模式下强制启用工具调用
    if (agentMode) {
        setChecked('searchToolCallToggle', true);
        localStorage.setItem('searchToolCall', 'true');
        var tcToggle = getEl('searchToolCallToggle');
        if (tcToggle) {
            var row = tcToggle.closest('.config-toggle-row');
            if (row) { row.style.opacity = '0.5'; row.style.pointerEvents = 'none'; row.title = 'Agent 模式下自动启用工具调用'; }
        }
    }
}

function setupEventListeners() {
    window.addEventListener('resize', handleResize);

    if ($.chatBox) {
        $.chatBox.addEventListener('scroll', throttle(() => {
            if (isAutoScrolling) return;  // 自动滚动时不更新 userScrolled
            const { scrollTop, scrollHeight, clientHeight } = $.chatBox;
            const atBottom = scrollHeight - scrollTop - clientHeight < 80;
            if ($.scrollToBottomBtn) {
                if (!atBottom) {
                    $.scrollToBottomBtn.classList.add('visible');
                    userScrolled = true;
                } else {
                    $.scrollToBottomBtn.classList.remove('visible');
                    userScrolled = false;
                }
            }
        }, 50));
    }

    const wrapper = document.querySelector('.input-wrapper');
    const drop = getEl('dropOverlayInput');
    if (wrapper && drop) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
            document.body.addEventListener(ev, e => e.preventDefault());
        });
        wrapper.addEventListener('dragenter', e => { e.preventDefault(); drop.classList.add('show'); });
        wrapper.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('show'); });
        wrapper.addEventListener('dragleave', e => {
            e.preventDefault();
            if (!wrapper.contains(e.relatedTarget)) drop.classList.remove('show');
        });
        wrapper.addEventListener('drop', async e => {
            e.preventDefault();
            drop.classList.remove('show');
            if (e.dataTransfer.files.length) await processSelectedFiles(e.dataTransfer.files);
        });
    }

    if ($.fileInput) {
        $.fileInput.addEventListener('change', async e => {
            if (e.target.files.length) await processSelectedFiles(e.target.files);
            e.target.value = '';
        });
    }

    // 图片输入已移除,只保留文件输入

    if ($.userInput) {
        $.userInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        window.autoResize($.userInput);
        $.userInput.addEventListener('input', function () { window.autoResize(this); });
        window.addEventListener('resize', debounce(() => window.autoResize($.userInput), 100));
    }
    
    // ★ 配置自动保存：配置面板内任意输入框/选择框/开关变更时自动保存到 localStorage + 服务器
    var _panel = $.configPanel || getEl('configPanel');
    if (_panel) {
        _panel.querySelectorAll('input, select, textarea').forEach(function(el) {
            el.addEventListener('change', function() { saveConfig(); });
            if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio') {
                el.addEventListener('input', debounce(function() { saveConfig(); }, 500));
            }
        });
    }
}

function loadInitialData() {
    // ★ 延迟加载模型列表，不阻塞首次渲染
    setTimeout(fetchModels, 500);
    const last = localStorage.getItem('lastChatId');
    if (last && chats[last]) {
        loadChat(last);
    } else {
        // ★ 优先复用已有的空新对话，避免登录后反复创建
        var emptyChatId = null;
        for (var _cid in chats) {
            var _chat = chats[_cid];
            if (_chat.title === '新对话' && (!_chat.messages || _chat.messages.length <= 1)) {
                emptyChatId = _cid;
                break;
            }
        }
        if (emptyChatId) {
            loadChat(emptyChatId);
        } else {
            createNewChat();
        }
    }
    renderChatHistory();
    prevWidth = window.innerWidth;
    // 初始化配置面板状态
    if (isMobile()) {
        $.sidebar?.classList.remove('mobile-open', 'collapsed');
        $.configPanel?.classList.remove('mobile-open', 'hidden-panel');
        $.sidebarMask?.classList.remove('active');
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'block';
        configPanelWasOpen = false; // 移动端默认不打开
    } else {
        $.sidebar?.classList.remove('mobile-open', 'collapsed');
        // 桌面端默认隐藏配置面板
        $.configPanel?.classList.add('hidden-panel');
        $.sidebarMask?.classList.remove('active');
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
        configPanelWasOpen = false;
    }
}

async function loadAllResources() {
    const resources = [
        { type: 'script', src: 'lib/marked.min.js' },
        { type: 'script', src: 'lib/highlight.min.js' },
        { type: 'script', src: 'lib/mammoth.browser.min.js' },
        { type: 'script', src: 'lib/xlsx.full.min.js' },
        { type: 'style', href: 'lib/atom-one-light.min.css', id: 'hljsTheme' },
        { type: 'script', src: 'lib/mermaid/mermaid.min.js' } // Mermaid 图表渲染（本地加载避免境外CDN慢）
    ];
    try {
        await Promise.all(resources.map(r => r.type === 'script' ? loadScript(r.src) : loadStyle(r.href, r.id)));
        if (window.mermaid) {
            mermaid.initialize({ startOnLoad: false, theme: 'default' }); // 初始化 Mermaid
        }
    } catch (err) {
        console.warn('部分资源加载失败', err);
        if (localStorage.getItem('authToken')) showToast('部分资源加载失败', 'error');
    }
    initializeApp();
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

function loadStyle(href, id) {
    return new Promise((resolve, reject) => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        if (id) l.id = id;
        l.onload = resolve;
        l.onerror = reject;
        document.head.appendChild(l);
    });
}

function initializeApp() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    async function init() {
        cacheDOMElements();
        injectStyles();
        setupKeyboardDetection(); // 初始化键盘检测(支持平板和手机)
        
        // ★ 登录门禁：未登录则弹出登录框，token无效也弹出
        var token = localStorage.getItem('authToken');
        if (!token) {
            try { 
                if (typeof showAuthOverlay === 'function') showAuthOverlay(); 
            } catch(e) {}
        } else {
            // 异步验证token有效性
            (async function() {
                try {
                    var resp = await fetch('/oneapichat/auth.php?action=verify&token=' + encodeURIComponent(token));
                    var data = await resp.json();
                    if (!data.valid) {
                        localStorage.removeItem('authToken');
                        localStorage.removeItem('authUsername');
                        localStorage.removeItem('authUserId');
                        if (typeof showAuthOverlay === 'function') showAuthOverlay();
                    }
                } catch(e) {}
            })();
        }
        
        initializeConfig();
        setupEventListeners();
        
        // ★ 启动时深度清理所有历史消息中的 [object Object] 残留
        try {
            (function deepClean(obj) {
                if (!obj || typeof obj !== 'object') return;
                if (Array.isArray(obj)) { obj.forEach(deepClean); return; }
                Object.keys(obj).forEach(k => {
                    if (['content','text','reasoning'].includes(k) && typeof obj[k] === 'string') {
                        obj[k] = obj[k].replace(/\[object Object\]/g, '');
                        if (obj[k] === '[object Object]') obj[k] = '';
                    }
                    if (typeof obj[k] === 'object' && obj[k] !== null) deepClean(obj[k]);
                });
            })(chats);
            localStorage.setItem('chats', JSON.stringify(chats));
        } catch(e) {}
        
        // ★ 从服务器恢复当前账号的配置和聊天记录（登录用户专用）
        await restoreUserData();
        
        // ★ 服务器同步后再次深度清理（防止服务器数据也有污染）
        try {
            (function deepClean(obj) {
                if (!obj || typeof obj !== 'object') return;
                if (Array.isArray(obj)) { obj.forEach(deepClean); return; }
                Object.keys(obj).forEach(k => {
                    if (['content','text','reasoning'].includes(k) && typeof obj[k] === 'string') {
                        obj[k] = obj[k].replace(/\[object Object\]/g, '');
                        if (obj[k] === '[object Object]') obj[k] = '';
                    }
                    if (typeof obj[k] === 'object' && obj[k] !== null) deepClean(obj[k]);
                });
            })(chats);
            // 同时清理 messages 数组中 content 为空字符串的空消息
            Object.keys(chats).forEach(id => {
                if (chats[id].messages) {
                    chats[id].messages = chats[id].messages.filter(m => {
                        if (m.role === 'assistant' && (!m.content || m.content.trim() === '')) return false;
                        return true;
                    });
                }
            });
            localStorage.setItem('chats', JSON.stringify(chats));
        } catch(e) {}
        
        loadInitialData();
        initRAGPanel();
        // ★ 已禁用: restoreOngoingChats 每次刷新自动重发消息
        // restoreOngoingChats();
        
        // ★ 周期自动保存：每30秒保存一次聊天（确保未开新会话时数据不丢）
        setInterval(function() {
            if (currentChatId && chats[currentChatId] && chats[currentChatId].messages && chats[currentChatId].messages.length > 1) {
                slimSaveChats();
            }
        }, 30000);
        // ★ 页面关闭/刷新前强制保存到localStorage + 服务器
        // ★ 登录/注册成功提示
        try {
            var loginMsg = localStorage.getItem('_loginSuccess');
            if (loginMsg) {
                localStorage.removeItem('_loginSuccess');
                setTimeout(function() {
                    if (typeof showToast === 'function') showToast(loginMsg, 'success', 3000);
                }, 500);
            }
        } catch(e) {}

        window.addEventListener('beforeunload', function() {
            // ★ 保存未完成的流式消息
            try {
                for (var __cid in chats) {
                    var __msgs = chats[__cid].messages;
                    for (var __i = __msgs.length - 1; __i >= 0; __i--) {
                        if (__msgs[__i].partial) {
                            localStorage.setItem('_savedPartial', JSON.stringify({
                                chatId: __cid,
                                content: __msgs[__i].content || '',
                                reasoning: __msgs[__i].reasoning || ''
                            }));
                            break;
                        }
                    }
                    break;
                }
            } catch(e) {}
            slimSaveChats();
            try { localStorage.setItem('lastChatId', currentChatId || ''); } catch(e) {}
            // ★ If _skipUnloadSave is set, skip all server saves (login/register/logout transitioning)
            if (localStorage.getItem('_skipUnloadSave')) {
                localStorage.removeItem('_skipUnloadSave');
                return;
            }
            // ★ 保存聊天记录（通过 saveChatsToServer 合并保存，slimSaveChats localStrorage 保底）
            var token = localStorage.getItem('authToken');
            // 聊天保存（通过 saveChatsToServer 合并后再保存）
            if (token && chats && Object.keys(chats).length > 0) {
                try { saveChatsToServer(); } catch(e) {}
            }
            // ★ 配置不再在 beforeunload 中保存（避免登录时 localStorage.clear 后存空值覆盖服务器数据）
            //   配置由 saveConfigToServer() 在修改时自动保存，logout 时由 saveUserDataBeforeLogout() 保存
        });
        window.addEventListener('pagehide', function() {
            slimSaveChats();
        });
        
        // ★ 全局拦截图片加载错误，静默处理避免控制台刷屏
        document.addEventListener('error', function(e) {
            if (e.target && e.target.tagName === 'IMG') {
                e.target.style.display = 'none';
                e.preventDefault();
            }
        }, true);
    }
}

// ==================== RAG 知识库系统 ====================

function initRAGPanel() {
    if (getEl('ragPanel')) return;
    var inputArea = getEl('inputWrapper') || document.querySelector('.input-wrapper');
    if (!inputArea || !inputArea.parentNode) return;
    
    var panel = document.createElement('div');
    panel.id = 'ragPanel';
    panel.className = 'rag-panel';
    panel.innerHTML = '<div class="rag-panel-header"><span style="display:inline-flex;align-items:center;gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>知识库</span><button class="rag-close-btn" id="ragCloseBtn">×</button></div>' +
        '<div class="rag-panel-body">' +
        '<div class="rag-upload-area" id="ragUploadArea"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 4px;opacity:0.5;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg> 点击或拖拽上传文档</div>' +
        '<div id="ragProgressBar" class="rag-progress" style="display:none;"><div class="rag-progress-track"><div class="rag-progress-fill" id="ragProgressFill" style="width:0%;"></div></div><div class="rag-progress-text" id="ragProgressText"></div></div>' +
        '<div style="display:flex;align-items:center;gap:4px;margin:6px 0;">' +
        '<span style="font-size:10px;font-weight:600;white-space:nowrap;color:#6b7280;">当前合集</span>' +
        '<select id="ragCollectionSelect" style="flex:1;padding:2px 4px;border:1px solid #d1d5db;border-radius:4px;font-size:11px;background:var(--bg,#fff);"></select>' +
        '<button id="ragAddColl" style="padding:2px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;cursor:pointer;background:var(--bg,#fff);" title="新建知识库">+</button>' +
        '<button id="ragDelColl" style="padding:2px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;cursor:pointer;background:var(--bg,#fff);" title="删除当前知识库">-</button>' +
        '</div>' +
        '<div style="font-size:10px;color:#9ca3af;margin:2px 0 4px;"><span id="ragDocCount">0</span> 个文档 · <span id="ragChunkCount">0</span> 个片段</div>' +
        '<div class="rag-doc-list" id="ragDocList"><div class="rag-empty">加载中...</div></div>' +
        '<div class="rag-query-area"><input type="text" id="ragQueryInput" class="rag-query-input" placeholder="搜索知识库..."><button id="ragQueryBtn" class="rag-query-btn">搜索</button></div>' +
        '<details class="rag-embed-config" style="margin-top:6px;padding-top:6px;border-top:1px solid #e5e7eb;font-size:11px;">' +
        '<summary style="cursor:pointer;font-weight:600;outline:none;">嵌入模型设置</summary>' +
        '<div style="margin-top:4px;display:flex;gap:2px;flex-wrap:wrap;align-items:center;">' +
        '<select id="ragEmbedModel" style="flex:1;min-width:60px;padding:1px 3px;border:1px solid #d1d5db;border-radius:4px;font-size:10px;"></select>' +
        '<select id="ragSearchMode" style="flex:0 0 auto;padding:1px 3px;border:1px solid #d1d5db;border-radius:4px;font-size:10px;"><option value="hybrid">混合</option><option value="embedding">语义</option><option value="tfidf">词法</option></select>' +
        '<button id="ragApplyEmbed" style="padding:2px 8px;border:1px solid #3b82f6;border-radius:4px;font-size:10px;cursor:pointer;background:#3b82f6;color:#fff;">应用</button></div>' +
        '<div id="ragEmbedStatus" style="font-size:10px;color:#9ca3af;margin-top:2px;">未启用（纯词法检索）</div>' +
        '</details>' +
        '<div class="rag-helper-text">拖拽或点击上传文档，AI可搜索知识库内容</div>' +
        '</div>';
    inputArea.parentNode.insertBefore(panel, inputArea.nextSibling);
    
    getEl('ragCloseBtn').addEventListener('click', function(e) { e.stopPropagation(); panel.classList.toggle('open'); });
    panel.querySelector('.rag-panel-header').addEventListener('click', function(e) {
        if (e.target.tagName === 'BUTTON') return;
        panel.classList.toggle('open');
    });
    
    var ua = getEl('ragUploadArea');
    ua.addEventListener('click', function() { var f = document.createElement('input'); f.type = 'file'; f.multiple = true; f.accept = '.pdf,.txt,.md,.docx,.xlsx,.json,.html'; f.onchange = function() { enqueueUploads(f.files); }; f.click(); });
    ua.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('dragover'); });
    ua.addEventListener('dragleave', function() { this.classList.remove('dragover'); });
    ua.addEventListener('drop', function(e) { e.preventDefault(); this.classList.remove('dragover'); enqueueUploads(e.dataTransfer.files); });
    
    // 集合选择器
    var collSel = getEl('ragCollectionSelect');
    loadCollections();
    collSel.onchange = function() {
        localStorage.setItem('ragCurrentCollection', this.value);
        loadKnowledgeList();
    };
    getEl('ragAddColl').addEventListener('click', function() {
        var name = prompt('请输入新知识库名称:');
        if (!name) return;
        var uid = localStorage.getItem('authUserId') || '';
        var nsName = encodeURIComponent(uid ? uid + '_' + name : name);
        var _token = getAuthToken();
        fetch(RAG_API + '?action=create_collection&name=' + nsName + '&auth_token=' + encodeURIComponent(_token))
            .then(function(r) { return r.json(); })
            .then(function(d) { if (d && d.success) { loadCollections(); showToast('创建成功', 'success'); } });
    });
    getEl('ragDelColl').addEventListener('click', function() {
        var cur = localStorage.getItem('ragCurrentCollection') || 'default';
        if (cur === 'default') { showToast('不能删除默认知识库', 'warning'); return; }
        if (!confirm('删除知识库「' + cur + '」？')) return;
        var uid = localStorage.getItem('authUserId') || '';
        var nsName = encodeURIComponent(uid ? uid + '_' + cur : cur);
        var _token = getAuthToken();
        fetch(RAG_API + '?action=delete_collection&name=' + nsName + '&auth_token=' + encodeURIComponent(_token))
            .then(function(r) { return r.json(); })
            .then(function(d) { if (d && d.success) { localStorage.setItem('ragCurrentCollection', 'default'); loadCollections(); showToast('已删除', 'success'); } });
    });
    getEl('ragQueryBtn').addEventListener('click', queryRAG);
    getEl('ragQueryInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') queryRAG(); });
    
    loadKnowledgeList();

    // 嵌入配置初始化
    loadEmbedConfig();
    var ragApplyBtn = getEl('ragApplyEmbed');
    if (ragApplyBtn) {
        ragApplyBtn.addEventListener('click', function() {
            var model = getEl('ragEmbedModel').value;
            var mode = getEl('ragSearchMode').value;
            var coll = localStorage.getItem('ragCurrentCollection') || 'default';
            var uid = localStorage.getItem('authUserId') || '';
            var ns = uid ? encodeURIComponent(uid + '_' + coll) : encodeURIComponent(coll);
            var btn = this; btn.disabled = true; btn.textContent = '生成中...';
            var _token = getAuthToken();
            fetch(RAG_API + '?action=embed_config&collection=' + ns + '&embed_model=' + encodeURIComponent(model) + '&mode=' + encodeURIComponent(mode) + '&auth_token=' + encodeURIComponent(_token), {method: 'POST'})
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    if (d && d.success) { showToast('嵌入配置已更新 (' + (d.embedded || 0) + ' 个向量)', d.embedded ? 'success' : 'warning'); loadEmbedConfig(); }
                    else showToast('配置失败', 'error');
                }).catch(function(e) { showToast('错误: ' + e.message, 'error'); })
                .finally(function() { btn.disabled = false; btn.textContent = '\u5e94\u7528'; });
        });
    }
}

function loadCollections() {
    var sel = getEl('ragCollectionSelect');
    if (!sel) return;
    var prev = localStorage.getItem('ragCurrentCollection') || 'default';
    var uid = localStorage.getItem('authUserId') || '';
    var _token = getAuthToken();
    var ns = encodeURIComponent(uid);
    fetch(RAG_API + '?action=collections&collection=' + ns + '&auth_token=' + encodeURIComponent(_token))
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var cols = d && d.collections ? d.collections : ['default'];
            if (cols.indexOf('default') === -1) cols.unshift('default');
            sel.innerHTML = cols.map(function(c) {
                return '<option value="' + escapeHtml(c) + '">' + (c === 'default' ? '默认知识库' : escapeHtml(c)) + '</option>';
            }).join('');
            sel.value = cols.indexOf(prev) !== -1 ? prev : 'default';
            localStorage.setItem('ragCurrentCollection', sel.value);
            loadKnowledgeList();
        });
}

function loadKnowledgeList() {
    var list = getEl('ragDocList');
    if (!list) return;
    list.innerHTML = '<div class="rag-empty">加载中...</div>';
    var dcEl = getEl('ragDocCount'), ccEl = getEl('ragChunkCount');
    var uid = localStorage.getItem('authUserId') || '';
    var coll = localStorage.getItem('ragCurrentCollection') || 'default';
    var ns = uid ? uid + '_' + coll : coll;
    var _token = getAuthToken();
    fetch(RAG_API + '?action=knowledge&collection=' + encodeURIComponent(ns) + '&auth_token=' + encodeURIComponent(_token))
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!list) return;
            if (data && data.documents && data.documents.length > 0) {
                var totalChunks = 0;
                list.innerHTML = data.documents.map(function(d) {
                    var docId = d.id || d.doc_id || '';
                    var safeDocId = (docId || '').replace(/'/g, "\\'");
                    totalChunks += d.chunks || 0;
                    return '<div class="rag-doc-item"><span class="rag-doc-name" title="' + escapeHtml(d.source) + '">' + escapeHtml(d.source) + '</span><span class="rag-doc-chunks">' + (d.chunks || 0) + '块</span><button class="rag-doc-delete" onclick="deleteDocument(\'' + safeDocId + '\')" title="删除此文档">✕</button></div>';
                }).join('');
                if (dcEl) dcEl.textContent = data.documents.length;
                if (ccEl) ccEl.textContent = totalChunks;
            } else {
                list.innerHTML = '<div class="rag-empty">暂无文档</div>';
                if (dcEl) dcEl.textContent = '0';
                if (ccEl) ccEl.textContent = '0';
            }
        })
        .catch(function() { if (list) list.innerHTML = '<div class="rag-empty">无法连接</div>'; });
}

// 上传队列：一次只传一个文件，避免并发搞崩 RAG 后端
var _ragUploadQueue = [];
var _ragUploadBusy = false;

function enqueueUploads(fileList) {
    for (var i = 0; i < fileList.length; i++) {
        _ragUploadQueue.push(fileList[i]);
    }
    processNextUpload();
}

function processNextUpload() {
    if (_ragUploadBusy || _ragUploadQueue.length === 0) return;
    _ragUploadBusy = true;
    var file = _ragUploadQueue.shift();
    // 完成回调：继续下一个
    uploadToRAG(file, function() {
        _ragUploadBusy = false;
        processNextUpload();
    });
}

function appendDocToList(docId, source, chunks) {
    var list = getEl('ragDocList');
    if (!list) return;
    // 移除占位符
    var emptyEl = list.querySelector('.rag-empty');
    if (emptyEl) emptyEl.remove();
    // 构造新文档条目并插入最前面
    var safeDocId = (docId || '').replace(/'/g, "\\'");
    var item = document.createElement('div');
    item.className = 'rag-doc-item';
    item.innerHTML = '<span class="rag-doc-name" title="' + escapeHtml(source) + '">' + escapeHtml(source) + '</span>' +
        '<span class="rag-doc-chunks">' + (chunks || 0) + '块</span>' +
        '<button class="rag-doc-delete" onclick="deleteDocument(\'' + safeDocId + '\')" title="删除此文档">✕</button>';
    list.insertBefore(item, list.firstChild);
    // 更新统计
    var dcEl = getEl('ragDocCount'), ccEl = getEl('ragChunkCount');
    if (dcEl) dcEl.textContent = parseInt(dcEl.textContent || '0') + 1;
    if (ccEl) ccEl.textContent = parseInt(ccEl.textContent || '0') + (chunks || 0);
}

function uploadToRAG(file, onDone) {
    if (!file) { if (onDone) onDone(); return; }
    var formData = new FormData();
    formData.append('file', file);
    var uid = localStorage.getItem('authUserId') || '';
    var coll = localStorage.getItem('ragCurrentCollection') || 'default';
    var ns = uid ? uid + '_' + coll : coll;
    
    var pb = getEl('ragProgressBar');
    var pf = getEl('ragProgressFill');
    var pt = getEl('ragProgressText');
    if (pb) pb.style.display = 'block';
    if (pf) pf.style.width = '0%';
    if (pt) pt.textContent = '上传中: ' + file.name;
    
    var _token = getAuthToken();
    var xhr = new XMLHttpRequest();
    xhr.open('POST', RAG_API + '?action=upload&collection=' + encodeURIComponent(ns) + '&mode=tfidf&auth_token=' + encodeURIComponent(_token), true);
    xhr.upload.onprogress = function(e) {
        if (e.lengthComputable && pf) { var pct = Math.round(e.loaded/e.total*60); pf.style.width = pct + '%'; if (pt) pt.textContent = '上传中 ' + pct + '% - ' + file.name; }
    };
    var doneFn = function() { if (onDone) onDone(); };
    xhr.onload = function() {
        if (pb) pb.style.display = 'none';
        try {
            var d = JSON.parse(xhr.responseText);
            if (d && d.success) {
                var chunks = d.chunks || 0;
                var sourceName = d.source || file.name;
                showToast('✓ 导入完成: ' + sourceName + ' (' + chunks + ' 片段)', 'success', 3000);
                // 直接插入新文档到列表
                appendDocToList(d.doc_id || d.source || file.name, sourceName, chunks);
                // 等后端落盘后再拉一次全量列表保证同步
                setTimeout(loadKnowledgeList, 1500);
            } else {
                showToast('导入失败: 服务器返回异常', 'error');
            }
        } catch(e) {
            showToast('导入失败: 服务器无响应，请重试', 'error');
            console.error('[RAG] upload error:', e.message, 'response:', xhr.responseText);
        }
        doneFn();
    };
    xhr.onerror = function() { if (pb) pb.style.display = 'none'; showToast('网络错误', 'error'); doneFn(); };
    xhr.ontimeout = function() { if (pb) pb.style.display = 'none'; showToast('上传超时，请重试', 'error'); doneFn(); };
    xhr.timeout = 120000;
    xhr.send(formData);
}

// ==================== 刷课工具处理器 ====================
async function chaoxingToolHandler(action, ids, username, password) {
    try {
        if (action === 'login') {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=login&username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password));
            var d = await r.json();
            if (d.success) return { result: '登录成功: ' + d.username };
            return { error: d.error || '登录失败，请检查账号密码' };
        }
        if (action === 'courses') {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=courses');
            var d = await r.json();
            if (d.courses) {
                return { result: '课程列表:\n' + d.courses.map(function(c) { return c.courseId + ': ' + c.title; }).join('\n') };
            }
            return { error: d.error || '获取失败' };
        }
        if (action === 'start' && ids) {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=start&ids=' + encodeURIComponent(ids));
            var d = await r.json();
            if (d.success) return { result: '刷课任务已启动 (PID: ' + d.pid + ')' };
            return { error: d.error || '启动失败' };
        }
        if (action === 'status') {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=status');
            var d = await r.json();
            var logPreview = d.log ? d.log.slice(-2000) : '(无日志)';
            if (d.running) return { result: '刷课任务运行中\n\n' + logPreview };
            else return { result: '刷课任务未运行\n\n最后日志:\n' + logPreview };
        }
        if (action === 'stop') {
            await fetch('/oneapichat/chaoxing_api.php?action=stop');
            return { result: '刷课任务已停止' };
        }
        if (action === 'stats') {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=stats&auth_token=' + getAuthToken());
            var d = await r.json();
            if (d.total_courses !== undefined) {
                var msg = '📊 刷课进度统计\n';
                msg += '总课程: ' + d.total_courses + ' | 已完成: ' + d.completed + '\n';
                msg += '视频完成: ' + d.videos_done + ' | 答题完成: ' + d.works_done;
                return { result: msg };
            }
            return { error: '获取统计失败' };
        }
        return { error: '未知操作' };
    } catch(e) {
        return { error: '刷课API错误: ' + e.message };
    }
}

async function engineApiHandler(action, args) {
    // 所有引擎 API 调用带上 auth_token 实现用户隔离
    var token = localStorage.getItem('authToken') || '';
    var authSuffix = token ? '&auth_token=' + encodeURIComponent(token) : '';

    try {
        if (action === 'cron_list') {
            var r = await fetch('/oneapichat/engine_api.php?action=cron_list' + authSuffix);
            var d = await r.json();
            var names = Object.keys(d);
            if (names.length === 0) return { result: '暂无后台任务' };
            var msg = '📋 后台任务列表:\n';
            names.forEach(function(n) {
                var j = d[n];
                msg += '- ' + n + ' (每' + j.interval + '秒, ' + (j.enabled ? '运行中' : '已停止') + ')';
                if (j.last_run) msg += ' 上次: ' + (j.last_run.time || '') + ' 状态: ' + (j.last_run.exit_code === 0 ? '✅' : '❌');
                msg += '\n';
            });
            return { result: msg };
        }
        if (action === 'cron_create') {
            var url = '/oneapichat/engine_api.php?action=cron_create&name=' + encodeURIComponent(args.name);
            url += '&interval=' + encodeURIComponent(args.interval);
            url += '&action_cmd=' + encodeURIComponent(args.action_cmd);
            url += authSuffix;
            var r = await fetch(url);
            var d = await r.json();
            if (d.ok) return { result: '✅ Cron任务已创建: ' + args.name + ' (每' + args.interval + '秒)' };
            return { error: d.error || '创建失败' };
        }
        if (action === 'cron_delete') {
            var r = await fetch('/oneapichat/engine_api.php?action=cron_delete&name=' + encodeURIComponent(args.name) + authSuffix);
            var d = await r.json();
            if (d.ok) return { result: '已删除任务: ' + args.name };
            return { error: d.error || '删除失败' };
        }
        if (action === 'agent_create') {
            // 继承当前用户的 API Key 和 baseUrl
            var currentKey = localStorage.getItem('apiKey') || '';
            var currentUrl = localStorage.getItem('baseUrl') || 'https://api.deepseek.com/v1';
            var currentModel = args.model || localStorage.getItem('model') || 'deepseek-chat';
            var agentRole = args.role || 'general';
            var url = '/oneapichat/engine_api.php?action=agent_create&name=' + encodeURIComponent(args.name);
            url += '&prompt=' + encodeURIComponent(args.prompt || args.task || '');
            url += '&role=' + encodeURIComponent(agentRole);
            url += '&model=' + encodeURIComponent(currentModel);
            url += '&api_key=' + encodeURIComponent(currentKey);
            url += '&base_url=' + encodeURIComponent(currentUrl);
            url += authSuffix;
            try {
                var r = await fetch(url);
                var d = await r.json();
                if (d.ok) {
                    // 创建后自动运行（不等待完成，避免阻塞并行工具调用）
                    fetch('/oneapichat/engine_api.php?action=agent_run&name=' + encodeURIComponent(args.name) + authSuffix).catch(function(){});
                    return { result: '✅ 子代理 ' + args.name + ' 已创建并启动（角色:' + agentRole + '）' };
                }
                return { error: d.error || '创建失败' };
            } catch(e) {
                return { error: '引擎服务异常: ' + e.message };
            }
        }
        if (action === 'agent_status') {
            var r = await fetch('/oneapichat/engine_api.php?action=agent_status&name=' + encodeURIComponent(args.name) + authSuffix);
            var d = await r.json();
            if (d.name) {
                var msg = '🤖 子代理: ' + d.name + '\n状态: ' + d.status + '\n模型: ' + d.model;
                if (d.result) msg += '\n结果: ' + d.result;
                if (d.error) msg += '\n错误: ' + d.error;
                window.showAgentNotification(d.error ? 'error' : 'success', '🤖 ' + d.name + ': ' + d.status);
                return { result: msg };
            }
            return { error: '未找到子代理' };
        }
        if (action === 'agent_list') {
            var r = await fetch('/oneapichat/engine_api.php?action=agent_list' + authSuffix);
            var d = await r.json();
            var names = Object.keys(d);
            if (names.length === 0) return { result: '暂无子代理' };
            var msg = '🤖 子代理列表:\n';
            names.forEach(function(n) {
                msg += '- ' + n + ' (' + d[n].status + ')';
                if (d[n].result) msg += ' 结果: ' + d[n].result.slice(0, 100);
                msg += '\n';
            });
            return { result: msg };
        }
        if (action === 'agent_ask') {
            var name = args.name;
            var message = args.message;
            if (!name || !message) return { error: '请提供子代理名称和消息' };
            // 先查子代理是否存在
            var sr = await fetch('/oneapichat/engine_api.php?action=agent_status&name=' + encodeURIComponent(name) + authSuffix);
            var sd = await sr.json();
            if (!sd.name) return { error: '子代理 ' + name + ' 不存在' };
            // 运行子代理（直接触发一次）
            await fetch('/oneapichat/engine_api.php?action=agent_run&name=' + encodeURIComponent(name) + '&message=' + encodeURIComponent(message) + '&from_ask=1' + authSuffix);
            // 等待完成
            var waitStart = Date.now();
            var resultMsg = '';
            while (Date.now() - waitStart < 120000) {
                await new Promise(r2 => setTimeout(r2, 2000));
                sr = await fetch('/oneapichat/engine_api.php?action=agent_status&name=' + encodeURIComponent(name) + authSuffix);
                sd = await sr.json();
                if (sd.status === 'completed' || sd.status === 'error' || sd.status === 'failed') {
                    if (sd.result) resultMsg = sd.result.slice(0, 1000);
                    if (sd.error) resultMsg = resultMsg ? resultMsg + '\n❌ ' + sd.error : '❌ ' + sd.error;
                    break;
                }
            }
            if (resultMsg) {
                return { result: '\u{1F916} ' + name + ' 回复: ' + resultMsg };
            } else {
                return { result: name + ' 仍在运行中(已超时120秒), 请稍后查询' };
            }
        }
        if (action === 'agent_delete') {
            var r = await fetch('/oneapichat/engine_api.php?action=agent_delete&name=' + encodeURIComponent(args.name) + authSuffix);
            var d = await r.json();
            if (d.ok) return { result: '✅ 子代理已删除: ' + args.name };
            return { error: d.error || '删除失败' };
        }
        if (action === 'cron_delete') {
            var r = await fetch('/oneapichat/engine_api.php?action=cron_delete&name=' + encodeURIComponent(args.name) + authSuffix);
            var d = await r.json();
            if (d.ok) return { result: '✅ Cron任务已删除: ' + args.name };
            return { error: d.error || '删除失败' };
        }
        if (action === 'sys_info') {
            var r = await fetch('/oneapichat/engine_api.php?action=sys_info' + authSuffix);
            var d = await r.json();
            if (d.ok) {
                var info = '🖥️ 系统信息:\n' +
                    '主机: ' + d.hostname + '\n' +
                    '系统: ' + d.os + '\n' +
                    'Python: ' + d.python + '\n' +
                    '负载: ' + (d.cpu_uptime || d.cpu || 'N/A') + '\n' +
                    '内存: ' + (d.memory || 'N/A') + '\n' +
                    '磁盘: ' + (d.disk || 'N/A') + '\n' +
                    '进程数: ' + d.processes + '\n' +
                    '时间: ' + d.time;
                return { result: info };
            }
            return { error: d.error || '获取系统信息失败' };
        }
        if (action === 'exec') {
            var r = await fetch('/oneapichat/engine_api.php?action=exec&cmd=' + encodeURIComponent(args.cmd) + '&timeout=' + (args.timeout || 60) + '&cwd=' + encodeURIComponent(args.cwd || '') + authSuffix);
            var d = await r.json();
            if (d.ok) {
                var out = '💻 命令: ' + args.cmd + '\n退出码: ' + d.exit_code + '\n';
                if (d.stdout) out += '输出:\n' + d.stdout + '\n';
                if (d.stderr) out += '错误:\n' + d.stderr + '\n';
                if (d.error) out += '异常: ' + d.error;
                return { result: out };
            }
            return { error: d.error || '命令执行失败' };
        }
        if (action === 'python') {
            var r = await fetch('/oneapichat/engine_api.php?action=python&script=' + encodeURIComponent(args.script) + '&timeout=' + (args.timeout || 30) + authSuffix);
            var d = await r.json();
            if (d.ok) {
                var out = '🐍 Python 脚本执行结果:\n退出码: ' + d.exit_code + '\n';
                if (d.stdout) out += '输出:\n' + d.stdout + '\n';
                if (d.stderr) out += '错误:\n' + d.stderr + '\n';
                return { result: out };
            }
            return { error: d.error || 'Python 脚本执行失败' };
        }
        if (action === 'file_read') {
            var r = await fetch('/oneapichat/engine_api.php?action=file_read&path=' + encodeURIComponent(args.path) + '&max_lines=' + (args.max_lines || 200) + authSuffix);
            var d = await r.json();
            if (d.ok) {
                var out = '📄 ' + args.path + ' (' + (d.size || 0) + ' bytes)\n' + d.content;
                return { result: out };
            }
            return { error: d.error || '读取失败' };
        }
        if (action === 'file_write') {
            var appendParam = args.append ? '&append=true' : '';
            var r = await fetch('/oneapichat/engine_api.php?action=file_write&path=' + encodeURIComponent(args.path) + '&content=' + encodeURIComponent(args.content) + appendParam + authSuffix);
            var d = await r.json();
            if (d.ok) return { result: '✅ 已写入 ' + args.path + ' (' + d.written + ' 字符)' };
            return { error: d.error || '写入失败' };
        }
        if (action === 'agent_stop') {
            var r = await fetch('/oneapichat/engine_api.php?action=agent_stop&name=' + encodeURIComponent(args.name) + authSuffix);
            var d = await r.json();
            if (d.ok) return { result: '✅ 已停止子代理: ' + args.name };
            return { error: d.error || '停止失败' };
        }
        if (action === 'push') {
            var r = await fetch('/oneapichat/engine_api.php?action=push&msg=' + encodeURIComponent(args.msg) + authSuffix);
            var d = await r.json();
            if (d.ok) { window.showAgentNotification('info', '📤 已推送通知'); return { result: '消息已推送，将在下次心跳时送达' }; }
            return { error: d.error || '推送失败' };
        }
        return { error: '未知操作: ' + action };
    } catch(e) {
        return { error: '引擎API错误: ' + e.message };
    }
}

function queryRAG() {
    var input = getEl('ragQueryInput');
    if (!input || !input.value.trim()) return;
    var q = input.value.trim();
    var btn = getEl('ragQueryBtn');
    if (btn) { btn.textContent = '...'; btn.disabled = true; }
    var uid = localStorage.getItem('authUserId') || '';
    var coll = localStorage.getItem('ragCurrentCollection') || 'default';
    var ns = uid ? uid + '_' + coll : coll;
    var _token = getAuthToken();
    fetch(RAG_API + '?action=search&collection=' + encodeURIComponent(ns) + '&auth_token=' + encodeURIComponent(_token), {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({question: q})
    }).then(function(r) { return r.json(); })
      .then(function(d) {
          if (btn) { btn.textContent = '查询'; btn.disabled = false; }
          if (d && d.hits && d.hits.length > 0) showToast('找到' + d.hits.length + '条结果', 'success');
          else showToast('未找到', 'warning');
      }).catch(function(e) {
          if (btn) { btn.textContent = '查询'; btn.disabled = false; }
          showToast('查询失败', 'error');
      });
}

// 启动
loadAllResources();

function deleteDocument(docId) {
    if (!docId || !confirm('确认删除此文档?')) return;
    var uid = localStorage.getItem('authUserId') || '';
    var coll = localStorage.getItem('ragCurrentCollection') || 'default';
    var ns = uid ? uid + '_' + coll : coll;
    var _token = getAuthToken();
    showToast('删除中...', 'info');
    fetch(RAG_API + '?action=delete_document&collection=' + encodeURIComponent(ns) + '&doc_id=' + encodeURIComponent(docId) + '&auth_token=' + encodeURIComponent(_token))
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d && d.success) {
                showToast('已删除', 'success');
                loadKnowledgeList();
            } else {
                showToast('删除失败', 'error');
            }
        })
        .catch(function() { showToast('删除失败', 'error'); });
}


function loadEmbedConfig() {
    var coll = localStorage.getItem('ragCurrentCollection') || 'default';
    var uid = localStorage.getItem('authUserId') || '';
    var ns = uid ? encodeURIComponent(uid + '_' + coll) : encodeURIComponent(coll);
    
    // 先获取本地模型列表，更新下拉框
    var _token = getAuthToken();
    fetch(RAG_API + '?action=list_models&auth_token=' + encodeURIComponent(_token))
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var sm = getEl('ragEmbedModel');
            if (!sm) return;
            // 保留当前选中值
            var curVal = sm.value;
            // 构建选项：API模型 + 本地模型
            var html = '<option value="">TF-IDF（纯词法）</option>';
            html += '<option value="text-embedding-3-small">text-embedding-3-small（OpenAI）</option>';
            html += '<option value="text-embedding-3-large">text-embedding-3-large（OpenAI）</option>';
            if (data && data.models) {
                data.models.forEach(function(m) {
                    if (m.model.includes('zh') || m.model.includes('jina')) {
                        html += '<option value="' + m.model + '">' + m.model + ' (本地, ' + m.dim + '维)</option>';
                    }
                });
            }
            sm.innerHTML = html;
            if (curVal) sm.value = curVal;
        }).catch(function() {});
    
    // 加载当前配置
    var _token = getAuthToken();
    fetch(RAG_API + '?action=embed_config&collection=' + ns + '&auth_token=' + encodeURIComponent(_token))
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (!d) return;
            var sm = getEl('ragEmbedModel');
            var sm2 = getEl('ragSearchMode');
            var st = getEl('ragEmbedStatus');
            if (sm && d.embed_model) sm.value = d.embed_model;
            if (sm2) sm2.value = d.mode || 'hybrid';
            if (st) {
                if (d.embed_model) {
                    var modeLabel = {hybrid:'混合模式',embedding:'语义搜索',tfidf:'纯词法'}[d.mode] || d.mode;
                    st.innerHTML = '嵌入: ' + d.embed_model + ' (' + modeLabel + ')';
                } else {
                    st.innerHTML = '嵌入: 未启用（纯TF-IDF词法检索）';
                }
            }
        }).catch(function() {});
}

// ==================== 刷课进度自动追踪 ====================
var CHAOXING_MONITOR_INTERVAL = null;
var CHAOXING_LAST_WORKS = null;
var CHAOXING_LAST_VIDEOS = null;
var CHAOXING_LAST_COURSES = null;
var CHAOXING_AUTO_REPORT_ENABLED = false;

function initChaoxingMonitor() {
    CHAOXING_AUTO_REPORT_ENABLED = localStorage.getItem('chaoxingAutoReport') === 'true';
    if (CHAOXING_AUTO_REPORT_ENABLED) startChaoxingMonitor();
}

function toggleChaoxingMonitor() {
    CHAOXING_AUTO_REPORT_ENABLED = !CHAOXING_AUTO_REPORT_ENABLED;
    localStorage.setItem('chaoxingAutoReport', CHAOXING_AUTO_REPORT_ENABLED);
    if (CHAOXING_AUTO_REPORT_ENABLED) {
        startChaoxingMonitor();
        showToast('刷课自动汇报已开启', 'success');
    } else {
        stopChaoxingMonitor();
        showToast('刷课自动汇报已关闭', 'info');
    }
}

function startChaoxingMonitor() {
    if (CHAOXING_MONITOR_INTERVAL) return;
    // 每30秒检查一次进度
    CHAOXING_MONITOR_INTERVAL = setInterval(checkChaoxingProgress, 30000);
    checkChaoxingProgress(); // 立即查一次建立基线
}

function stopChaoxingMonitor() {
    if (CHAOXING_MONITOR_INTERVAL) {
        clearInterval(CHAOXING_MONITOR_INTERVAL);
        CHAOXING_MONITOR_INTERVAL = null;
    }
}

function checkChaoxingProgress() {
    fetch('/oneapichat/chaoxing_api.php?action=stats&auth_token=' + getAuthToken())
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.total_courses === undefined) return;
            var now_works = d.works_done || 0;
            var now_videos = d.videos_done || 0;
            var now_completed = d.completed || 0;

            // 首次运行，建立基线
            if (CHAOXING_LAST_WORKS === null) {
                CHAOXING_LAST_WORKS = now_works;
                CHAOXING_LAST_VIDEOS = now_videos;
                CHAOXING_LAST_COURSES = now_completed;
                return;
            }

            var diff_works = now_works - CHAOXING_LAST_WORKS;
            var diff_videos = now_videos - CHAOXING_LAST_VIDEOS;
            var diff_courses = now_completed - CHAOXING_LAST_COURSES;

            if (diff_works > 0 || diff_videos > 0 || diff_courses > 0) {
                var msg = '📊 刷课进度更新';
                if (diff_works > 0) msg += ' 答题+' + diff_works;
                if (diff_videos > 0) msg += ' 视频+' + diff_videos;
                if (diff_courses > 0) msg += ' 课程+' + diff_courses;
                msg += '（答题' + now_works + ' 视频' + now_videos + ' 完成' + now_completed + '课）';

                CHAOXING_LAST_WORKS = now_works;
                CHAOXING_LAST_VIDEOS = now_videos;
                CHAOXING_LAST_COURSES = now_completed;

                // 作为系统消息插入到当前对话
                if (window.currentChatId && window.chatHistory && window.chatHistory[window.currentChatId]) {
                    window.chatHistory[window.currentChatId].push({
                        role: 'system',
                        content: '【刷课自动汇报】' + msg
                    });
                }
            }
        })
        .catch(function() {});
}


// ==================== Agent 通知与轮询系统 ====================
var _agentPollTimer = null;
var _agentPanelRefreshTimer = null;
var _selectedAgentName = null;

function ensureChatExists() {
    if (!currentChatId || !chats[currentChatId]) {
        var keys = Object.keys(chats);
        if (keys.length > 0) {
            loadChat(keys[keys.length - 1]);
        } else {
            createNewChat();
        }
    }
}

window.startAgentNotificationPolling = function() {
    if (_agentPollTimer) return;
    ensureChatExists();
    _agentPollTimer = setInterval(window.checkAgentNotifications, 15000);
    window.checkAgentNotifications();
};

window.stopAgentNotificationPolling = function() {
    if (_agentPollTimer) { clearInterval(_agentPollTimer); _agentPollTimer = null; }
};

window.checkAgentNotifications = function() {
    var token = getAuthToken();
    if (!token) {
        // 还没登录，延迟重试
        setTimeout(window.checkAgentNotifications, 3000);
        return;
    }
    
    // 先获取引擎心跳（cron通知等）
    fetch('/oneapichat/engine_api.php?action=heartbeat&auth_token=' + token + '&t=' + Date.now(), { signal: AbortSignal.timeout(8000) })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || data.error) return;
            if (data.cron_results && Array.isArray(data.cron_results)) {
                data.cron_results.forEach(function(r) {
                    var msg = (r.name || 'Cron任务') + ': ' + (r.result || r.error || '');
                    window.showAgentNotification(r.error ? 'error' : 'success', r.error ? '❌ ' + msg : '✅ ' + msg);
                    if (r.result) window.appendAgentSystemMessage(r.result, 'Cron: ' + (r.name || '任务'));
                });
            }
            if (data.pending && Array.isArray(data.pending)) {
                data.pending.forEach(function(m) {
                    var msg = m.msg || m.text || '';
                    if (msg) {
                        window.showAgentNotification('info', '🔔 ' + msg.substring(0, 100));
                        window.appendAgentSystemMessage(msg, 'Heartbeat');
                    }
                });
            }
        }).catch(function() {});
    
    // ★ 同时获取子代理完成通知（新功能）
    fetch('/oneapichat/engine_api.php?action=agent_notifications&auth_token=' + token + '&t=' + Date.now(), { signal: AbortSignal.timeout(8000) })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || data.count === 0) return;
            var notifs = data.notifications || [];
            console.log('[AgentNotify] 收到', data.count, '条未处理通知:', notifs.map(function(n) { return n.agent; }));
            
            // 红点提示
            var dot = getEl('agentNotifDot');
            if (dot) {
                if (data.count > 0) dot.classList.add('show');
                else dot.classList.remove('show');
            }
            
            notifs.forEach(function(n) {
                var agentName = n.agent || '未知代理';
                var isSuccess = n.status === 'completed';
                
                // 保存到代理专属聊天（供面板查看）
                var fullResult = n.result || n.error || '';
                if (fullResult) {
                    var agentKey = 'agent_chat_' + agentName;
                    var agentMsgs = JSON.parse(localStorage.getItem(agentKey) || '[]');
                    agentMsgs.push({ role: 'assistant', content: fullResult, time: Date.now() });
                    if (agentMsgs.length > 50) agentMsgs = agentMsgs.slice(-50);
                    localStorage.setItem(agentKey, JSON.stringify(agentMsgs));
                }
                
                // ★ 不再直接显示子代理通知，改为触发主代理自主处理
                // ★ 只在 Agent 模式下触发主代理，非 Agent 模式保持静默
                if (localStorage.getItem('agentMode') === 'true') {
                    window.triggerAgentAutoReplyForSubAgent(agentName);
                } else {
                    console.log('[AgentNotify] 非 Agent 模式，静默处理子代理', agentName);
                }
            });
            
            // 标记为已处理
            fetch('/oneapichat/engine_api.php?action=agent_notifications_mark&auth_token=' + token, { signal: AbortSignal.timeout(5000) })
                .catch(function() {});
        }).catch(function() {});
};

window.showAgentNotification = function(type, message) {
    // ★ 静默模式：不显示弹窗，仅刷新代理面板状态
    window.refreshAgentPanel();
    window.refreshEngineStatus();
};

window.appendAgentSystemMessage = function(text, source) {
    if (!text) return;
    // ★ 如果没有活跃对话，自动创建一个
    if (!currentChatId) {
        createNewChat();
        if (!currentChatId) return;
    }
    var chatId = currentChatId;
    chats[chatId].messages.push({ role: 'assistant', content: text, agent: source || 'Agent' });
    appendMessage('assistant', text, null, null, null, 0, true, null, null);
    if (!isAutoScrolling) {
        var b = getEl('agent-new-msg-badge') || (function() {
            var el = document.createElement('div');
            el.id = 'agent-new-msg-badge';
            el.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);padding:8px 16px;background:#3b82f6;color:#fff;border-radius:9999px;font-size:12px;cursor:pointer;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
            el.onclick = function() { scrollToBottom(); b.remove(); };
            document.body.appendChild(el);
            return el;
        })();
        b.textContent = '📩 Agent 新消息 - 点击查看';
        clearTimeout(b._t);
        b._t = setTimeout(function() { var x = getEl('agent-new-msg-badge'); if (x) x.remove(); }, 15000);
    }
};

window.startAgentNotificationPolling();

