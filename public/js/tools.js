// ═══════════════════════════════════════════════════════════════
//  OneAPIChat — 工具定义 + 注册表 (从 main.js 拆分)
//  ~1090 行，包含所有 AI 工具常量和 toolRegistry
// ═══════════════════════════════════════════════════════════════

const BROWSER_NAVIGATE_TOOL = {
    type: "function",
    function: {
        name: "browser_navigate",
        description: "在无头浏览器中打开指定网址。用于访问网页、查看内容、抓取信息。返回页面内容摘要。",
        parameters: { type: "object", properties: { url: { type: "string", description: "要访问的网址(完整URL)" } }, required: ["url"] }
    }
};
const BROWSER_SCREENSHOT_TOOL = {
    type: "function",
    function: {
        name: "browser_screenshot",
        description: "对无头浏览器当前页面截图。截图会自动在聊天界面显示。用于查看网页外观、表单状态等。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}} }
    }
};
const BROWSER_CLICK_TOOL = {
    type: "function",
    function: {
        name: "browser_click",
        description: "在无头浏览器中点击页面元素。用于操作表单、按钮、链接等。",
        parameters: { type: "object", properties: { selector: { type: "string", description: "CSS选择器或文本匹配" } }, required: ["selector"] }
    }
};
const BROWSER_TYPE_TOOL = {
    type: "function",
    function: {
        name: "browser_type",
        description: "在无头浏览器的输入框中输入文字。用于填写表单、搜索框等。",
        parameters: { type: "object", properties: { selector: { type: "string", description: "目标输入框CSS选择器" }, text: { type: "string", description: "要输入的文字" } }, required: ["selector","text"] }
    }
};
const BROWSER_GET_CONTENT_TOOL = {
    type: "function",
    function: {
        name: "browser_get_content",
        description: "获取无头浏览器当前页面的纯文本内容。用于提取网页信息、分析页面。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}} }
    }
};
const BROWSER_GET_SNAPSHOT_TOOL = {
    type: "function",
    function: {
        name: "browser_get_snapshot",
        description: "获取无头浏览器当前页面的结构快照(元素/文本/aria)。用于理解页面布局、定位元素。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}} }
    }
};

// ═══════════════════════════════════════════════════════════════
//  DSH (DeepSeek Harness) 标准底层 Coding 工具定义
// ═══════════════════════════════════════════════════════════════
const BASH_TOOL = {
    type: "function",
    function: {
        name: "bash",
        description: "在终端执行 bash/shell 命令并返回 stdout 与 stderr。支持沙箱与超时控制。参数 command 为要执行的完整命令（兼容 cmd），workdir 为工作目录（兼容 cwd）。避免破坏性命令。",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "要执行的 bash shell 命令" },
                cmd: { type: "string", description: "command 别名" },
                workdir: { type: "string", description: "工作目录路径（可选，默认为当前工作空间）" },
                cwd: { type: "string", description: "workdir 别名" },
                timeoutMs: { type: "number", description: "超时毫秒数（默认60000）" },
                timeout: { type: "number", description: "超时秒数（可选）" }
            },
            required: ["command"]
        }
    }
};

const READ_TOOL = {
    type: "function",
    function: {
        name: "read",
        description: "读取 UTF-8 文本文件内容，返回带行号的文本内容与总行数。修改文件前必须先使用本工具阅读文件。支持 offset/limit 或 start_line/end_line 行范围截取。",
        parameters: {
            type: "object",
            properties: {
                file_path: { type: "string", description: "要读取的文件绝对路径" },
                path: { type: "string", description: "file_path 别名" },
                offset: { type: "number", description: "从第几行开始读取（1-based，默认1）" },
                limit: { type: "number", description: "读取的最大行数（默认2000）" },
                start_line: { type: "number", description: "起始行号（offset别名）" },
                end_line: { type: "number", description: "结束行号" }
            },
            required: ["file_path"]
        }
    }
};

const WRITE_TOOL = {
    type: "function",
    function: {
        name: "write",
        description: "创建全新文件或完全替换现有文件内容。系统会自动为被覆盖的文件创建 .bak 备份。⚠️修改已有文件时优先使用 edit 进行局部字面量精准替换，禁止直接盲写全量覆盖。",
        parameters: {
            type: "object",
            properties: {
                file_path: { type: "string", description: "目标文件绝对路径" },
                path: { type: "string", description: "file_path 别名" },
                content: { type: "string", description: "要写入的完整文本内容" }
            },
            required: ["file_path", "content"]
        }
    }
};

const EDIT_TOOL = {
    type: "function",
    function: {
        name: "edit",
        description: "精准编辑已有文件：在指定文件中将 old_string 字面量精确替换为 new_string。修改前必须先调用 read 确认精确内容和缩进。old_string 必须在文件中唯一（如有多处请提供更多上下文或指定 replace_all=true）。替换成功后将生成可视化 Diff。",
        parameters: {
            type: "object",
            properties: {
                file_path: { type: "string", description: "要编辑的文件绝对路径" },
                path: { type: "string", description: "file_path 别名" },
                old_string: { type: "string", description: "要替换的精确原文（必须完全匹配空格/缩进/换行）" },
                new_string: { type: "string", description: "替换后的新文本（空字符串表示删除）" },
                replace_all: { type: "boolean", description: "是否替换所有匹配项（默认 false）" }
            },
            required: ["file_path", "old_string", "new_string"]
        }
    }
};

const GREP_TOOL = {
    type: "function",
    function: {
        name: "grep",
        description: "在工作区或指定目录/文件中使用正则表达式或关键词搜索文本内容，返回匹配行号和上下文。支持 file_pattern/include 过滤文件类型。",
        parameters: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "搜索的正则表达式或关键字" },
                path: { type: "string", description: "搜索起始路径（默认项目根目录）" },
                include: { type: "string", description: "文件名过滤通配符（如 *.js 或 *.py）" },
                file_pattern: { type: "string", description: "include 别名" }
            },
            required: ["pattern"]
        }
    }
};

const GLOB_TOOL = {
    type: "function",
    function: {
        name: "glob",
        description: "使用 glob 模式查找并返回匹配的文件路径列表（如 **/*.ts, src/**/*.js, *.json）。按修改时间排序。",
        parameters: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "Glob 匹配模式（如 **/*.js）" },
                path: { type: "string", description: "搜索起始目录（默认项目工作区）" }
            },
            required: ["pattern"]
        }
    }
};

const TODO_WRITE_TOOL = {
    type: "function",
    function: {
        name: "todo_write",
        description: "记录并原子更新当前任务的多步待办清单。每次传入完整的 todos 数组替换旧状态。用于向用户清晰展示当前执行步骤、进度与状态转化（pending | in_progress | completed）。",
        parameters: {
            type: "object",
            properties: {
                todos: {
                    type: "array",
                    description: "完整的待办事项列表",
                    items: {
                        type: "object",
                        properties: {
                            content: { type: "string", description: "步骤描述（简明祈使句）" },
                            status: { type: "string", enum: ["pending", "in_progress", "completed"], description: "pending (待处理) | in_progress (进行中) | completed (已完成)" }
                        },
                        required: ["content", "status"]
                    }
                }
            },
            required: ["todos"]
        }
    }
};

const RUN_CODE_TOOL = {
    type: "function",
    function: {
        name: "run_code",
        description: "在受限 JavaScript 编排沙箱中执行异步代码。仅暴露 tools.read/write/edit/grep/glob/bash/todo_write，用于一次完成条件、并发只读查询与错误处理；禁止 require/process/fs/fetch。",
        parameters: { type: "object", properties: {
            code: { type: "string", description: "async 函数体代码，可 await tools.read(...) 并 return JSON 可序列化结果" },
            description: { type: "string", description: "5-10字执行摘要" },
            timeout_ms: { type: "number", description: "总超时毫秒，默认60000，最大120000" }
        }, required: ["code", "description"] }
    }
};

// ==================== 服务器操控工具定义 ====================
const SERVER_EXEC_TOOL = {
    type: "function",
    function: {
        name: "server_exec",
        description: "在服务器上执行终端命令。工具名是 server_exec（不存在 run_command），参数名必须是 cmd（不要用 command）。用于系统管理、文件操作、进程管理、服务控制等。输出有长度限制(5000字符),超长时间命令会超时。⚠️ 谨慎使用:避免执行破坏性命令(rm -rf, shutdown等)。命令内含双引号时请用 shell 单引号或反斜杠转义。",
        parameters: {
            type: "object",
            properties: {
                cmd: { type: "string", description: "要执行的 shell 命令" },
                timeout: { type: "number", description: "超时秒数(默认60,最大300)" },
                cwd: { type: "string", description: "工作目录(可选)" }
            },
            required: ["cmd"]
        }
    }
};

const SERVER_PYTHON_TOOL = {
    type: "function",
    function: {
        name: "server_python",
        description: "在服务器上执行 Python 脚本。用于数据处理、文件操作、API调用、自动化任务等。脚本通过临时文件执行,超时默认30秒。",
        parameters: {
            type: "object",
            properties: {
                script: { type: "string", description: "Python 脚本代码" },
                timeout: { type: "number", description: "超时秒数(默认30,最大120)" }
            },
            required: ["script"]
        }
    }
};

const PROJECT_SELF_DESCRIBE_TOOL = {
    type: "function",
    function: {
        name: "project_self_describe",
        description: "查询项目自身的身份、架构、当前能力、恢复机制和安全规则。按需返回有界上下文，不读取密钥。用户询问‘你是谁/项目怎么工作/为什么刷新会恢复’时优先调用。",
        parameters: { type: "object", properties: { query: { type: "string", description: "想了解的项目主题或问题" }, budget: { type: "integer", description: "上下文字符预算，默认14000，最大50000" } }, required: ["query"] }
    }
};

const SERVER_FILE_READ_TOOL = {
    type: "function",
    function: {
        name: "server_file_read",
        description: "读取服务器上的一个具体文件内容（不能把目录当文件读）。先用 server_file_search 查找下载文件，或用 server_exec 的 ls/find 列目录，再把返回的完整文件路径传给本工具。普通多行文件用 start_line/end_line/max_lines 按行分页；单行巨长文件用 offset/max_chars 分页。B站/磁力下载先轮询对应status工具，从completed_files.path读取，不能猜测/tmp路径。",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "文件或目录的绝对路径" },
                start_line: { type: "number", description: "起始行号（从1开始，不传则从开头读）" },
                end_line: { type: "number", description: "结束行号（不传则读到文件末尾）" },
                max_lines: { type: "number", description: "最大行数（默认200，目录列表时无效）" },
                offset: { type: "number", description: "字符偏移读取起点（0=开头；传此参数即切换为按字符读取，适合单行巨长文件）" },
                max_chars: { type: "number", description: "字符偏移模式下每次读取的最大字符数（默认5000）" }
            },
            required: ["path"]
        }
    }
};

// ★ 文档解析 — 提取 DOCX/PPTX/XLSX/PDF/DOC/TXT 等办公文档的文本内容
const PARSE_DOCUMENT_TOOL = {
    type: "function",
    function: {
        name: "parse_document",
        description: "解析办公文档(DOCX/PPTX/XLSX/PDF/DOC/TXT等)提取文本内容。当需要读取和分析服务器上的文档文件时使用此工具。支持格式: .docx .xlsx .xls .xlsm .pptx .pdf .doc .txt .md 等。返回提取的纯文本内容。常用于分析用户上传的文档、下载的Office文件等。",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "服务器上的文件绝对路径(如 /var/www/html/oneapichat/uploads/downloads/example.docx)" },
                max_chars: { type: "number", description: "最大返回字符数(默认50000,超出会截断)" }
            },
            required: ["path"]
        }
    }
};

const SERVER_FILE_WRITE_TOOL = {
    type: "function",
    function: {
        name: "server_file_write",
        description: "写入文件到服务器(仅允许 /tmp 和项目目录)。用于创建全新文件、生成报告或保存脚本。⚠️注意：修改已有文件时禁止直接盲写全量覆盖！已有文件必须先调用 server_file_read 确认内容，且优先使用 server_file_edit 进行局部精确修改；仅当确实需要全量重写时才使用本工具(系统会自动创建.bak备份)。",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "目标文件绝对路径" },
                content: { type: "string", description: "要写入的内容" },
                append: { type: "boolean", description: "是否追加(默认覆盖)" }
            },
            required: ["path", "content"]
        }
    }
};

// ★ 智能文件编辑 — 精确字符串替换（参考 Claude Code / DSH Edit 工具）
const SERVER_FILE_EDIT_TOOL = {
    type: "function",
    function: {
        name: "server_file_edit",
        description: "精确编辑已有文件：在文件中查找指定字符串并替换。比 server_file_write 更安全且高效——只需传递要修改的代码片段而非全量重写。\n强制规则：\n- 修改已有文件首选此工具，严禁随意全量覆盖破坏已有代码\n- 修改前必须先通过 server_file_read 确认当前精确内容和缩进\n- old_string 必须与文件中的内容完全一致\n- old_string 在文件中应保持唯一（如有多处请提供更多上下文或设 replace_all=true）\n- new_string 替换 old_string（空字符串表示删除）",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "要编辑的文件绝对路径" },
                old_string: { type: "string", description: "要替换的原文（必须精确匹配，包括空格缩进）" },
                new_string: { type: "string", description: "替换后的新文本（空字符串=删除）" },
                replace_all: { type: "boolean", description: "是否替换所有匹配项（默认只替换第一个）" }
            },
            required: ["path", "old_string", "new_string"]
        }
    }
};

// ★ 文件内容搜索 — 支持正则 + 上下文行（参考 grep -C）
const SERVER_FILE_GREP_TOOL = {
    type: "function",
    function: {
        name: "server_file_grep",
        description: "在文件中搜索匹配内容，返回匹配行及上下文。支持正则表达式。⚠️结果自动保护: 单行超2000字符截断、总返回上限200KB、自动跳过二进制文件(图片/数据库/压缩包)和超大文件; 扫描最多200个文件(按路径排序)。搜索范围尽量缩小: 用 path 指定具体目录、file_pattern 限定文件类型(如 *.py /*.js), 避免在 /var/www 等大目录全量搜 'cookie' 这类高频词导致结果超限。",
        parameters: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "搜索模式（支持正则表达式）" },
                path: { type: "string", description: "搜索路径：文件路径 或 目录路径（默认项目根目录）" },
                context_lines: { type: "number", description: "上下文行数（匹配行前后各N行，默认2）" },
                file_pattern: { type: "string", description: "文件名过滤模式，如 *.js 或 *.py" },
                max_results: { type: "number", description: "最大结果数（默认20）" },
                ignore_case: { type: "boolean", description: "是否忽略大小写（默认true）" }
            },
            required: ["pattern"]
        }
    }
};

const SERVER_SYS_INFO_TOOL = {
    type: "function",
    function: {
        name: "server_sys_info",
        description: "获取服务器系统信息:主机名、操作系统、CPU负载、内存使用、磁盘空间、进程数等。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] }
    }
};

const SERVER_PS_TOOL = {
    type: "function",
    function: {
        name: "server_ps",
        description: "列出服务器上的进程(按CPU使用率排序,显示前20个)。用于监控系统负载、查找运行中的服务等。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] }
    }
};

const SERVER_DISK_TOOL = {
    type: "function",
    function: {
        name: "server_disk",
        description: "查看服务器的磁盘使用情况(所有分区)。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] }
    }
};

const SERVER_NETWORK_TOOL = {
    type: "function",
    function: {
        name: "server_network",
        description: "网络诊断工具。支持ping(连通性测试)、curl(HTTP请求)和port(检查端口监听情况)。用于网络故障排除和验证服务可用性。",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "目标地址(域名、IP、端口号)" },
                action: { type: "string", enum: ["ping", "curl", "port"], description: "操作类型: ping(默认,ICMP连通测试), curl(HTTP请求), port(端口监听检查)" },
                timeout: { type: "number", description: "超时秒数(默认10)" }
            },
            required: ["target"]
        }
    }
};

const SERVER_DOCKER_TOOL = {
    type: "function",
    function: {
        name: "server_docker",
        description: "Docker 运维与一键部署工具。先用 doctor 检查 CLI/daemon/socket，再用 yatori_deploy 自动创建 ~/yatori/config、~/yatori/logs、config.json、拉取 yatoridev/yatori-go-console:latest 并启动容器。支持 ps/images/stats/logs/pull/stop/remove；禁止任意 Docker 参数拼接。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["doctor", "ps", "images", "stats", "logs", "pull", "yatori_deploy", "stop", "remove"], description: "doctor=环境预检；yatori_deploy=一键部署 Yatori；logs=查看日志；pull=拉取镜像；ps/images/stats=只读诊断；stop/remove=容器管理" },
                image: { type: "string", description: "镜像名，默认 yatoridev/yatori-go-console:latest，仅 pull/yatori_deploy 使用" },
                name: { type: "string", description: "容器名，默认 yatori-console" },
                deploy_dir: { type: "string", description: "数据目录，默认 ~/yatori；仅允许 Home/tmp/项目目录" },
                replace: { type: "boolean", description: "yatori_deploy 时是否删除同名旧容器后重建，默认 false" },
                tail: { type: "integer", description: "logs 返回行数，默认 200，最大 5000" },
                force: { type: "boolean", description: "remove 是否强制删除运行中容器" }
            },
            required: []
        }
    }
};

const SERVER_DB_QUERY_TOOL = {
    type: "function",
    function: {
        name: "server_db_query",
        description: "执行数据库查询(SQLite)。用于查询刷课记录、用户数据等。只读查询优先,写入操作谨慎使用。",
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
        description: "搜索服务器上的文件。支持通配符模式(如 *.log, config*)。默认搜索 /var/www 目录。",
        parameters: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "文件名匹配模式(支持 *, ? 通配符)" },
                path: { type: "string", description: "搜索起始目录(默认 /var/www)" },
                max_results: { type: "number", description: "返回结果数上限(默认30)" }
            },
            required: ["pattern"]
        }
    }
};

const SERVER_FILE_OP_TOOL = {
    type: "function",
    function: {
        name: "server_file_op",
        description: "文件操作:复制(cp)、移动(mv)、删除(rm)、创建目录(mkdir)。只允许操作 /tmp 和 /var/www/html 目录。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["cp", "mv", "rm", "mkdir"], description: "操作类型" },
                src: { type: "string", description: "源路径" },
                dst: { type: "string", description: "目标路径(cp/mv需要,rm/mkdir不需要)" }
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
        description: "超星学习通自动刷课。调用前必须:(1)先调用 chaoxing_auth 检查登录 (2)再调用 chaoxing_overview 检查是否正在刷课。如果正在刷课,先告知用户当前进度并询问是否停止后切换课程。然后再开始新刷课任务。",
        parameters: {
            type: "object",
            properties: {
                course_ids: { type: "string", description: "要学习的课程ID列表,逗号分隔。如果用户没指定具体课程,请先调用chaoxing_list_courses获取课程列表让用户选择" }
            },
            required: ["course_ids"]
        }
    }
};

const CHAOXING_LOGIN_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "chaoxing_login",
        description: "登录超星学习通账号。只在 chaoxing_auth 返回未登录时才调用。在用户提供了手机号和密码后调用,验证并登录学习通。",
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
        description: "获取超星学习通的课程列表(需要先登录)。调用后会返回所有课程的ID和名称,让用户选择要刷的课程。",
        parameters: {
            type: "object",
            properties: {"_dummy": {"type": "string", "description": "unused"}},
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
            properties: {"_dummy": {"type": "string", "description": "unused"}},
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
            properties: {"_dummy": {"type": "string", "description": "unused"}},
            required: []
        }
    }
};

const CHAOXING_STATS_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "chaoxing_stats",
        description: "查询刷课进度统计,包括总课程数、已完成课程数、视频完成数、答题完成数,以及每门课的详细进度。",
        parameters: {
            type: "object",
            properties: {"_dummy": {"type": "string", "description": "unused"}},
            required: []
        }
    }
};

const CHAOXING_OVERVIEW_TOOL = {
    type: "function",
    function: {
        name: "chaoxing_overview",
        description: "超星刷课总览:一次性返回登录状态、是否正在刷课、当前刷课课程、已完成课程数、总课程数、视频/答题进度。在用户询问刷课状态、'现在刷到哪了'、'进度如何'时调用此工具。调用前必须先调用 chaoxing_auth 检查登录。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] }
    }
};

const CHAOXING_EXAM_LIST_TOOL = {
    type: "function",
    function: {
        name: "chaoxing_exam_list",
        description: "列出超星学习通所有课程的考试列表,包含考试ID、课程、名称、状态、起止时间。调用后返回完整JSON供用户选择。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] }
    }
};

const CHAOXING_EXAM_START_TOOL = {
    type: "function",
    function: {
        name: "chaoxing_exam_start",
        description: "开考超星学习通考试。自动暂停刷课避免风控。调用前必须先调用 chaoxing_auth 确认登录状态。需要用户确认要开考的考试ID。",
        parameters: {
            type: "object",
            properties: {
                exam_ids: { type: "string", description: "要开考的考试ID,逗号分隔。如'9318653,9219915'。如果不传则开考全部待考。" }
            },
            required: []
        }
    }
};

const CHAOXING_EXAM_STATUS_TOOL = {
    type: "function",
    function: {
        name: "chaoxing_exam_status",
        description: "查询当前考试任务的运行状态、进度和后台日志。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] }
    }
};

const CHAOXING_EXAM_STOP_TOOL = {
    type: "function",
    function: {
        name: "chaoxing_exam_stop",
        description: "停止正在运行的考试任务。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] }
    }
};

const CHAOXING_AUTH_TOOL = {
    type: "function",
    function: {
        name: "chaoxing_auth",
        description: "【必须首先调用】检测超星学习通的登录状态。在调用任何 chaoxing 工具(考试列表、开考、刷课)之前,你必须先调用此工具。如果已登录,直接进行下一步操作;如果未登录,才向用户询问手机号和密码。绝对不要在未检查状态的情况下直接问用户要账号密码。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] }
    }
};

const CHAOXING_QR_LOGIN_TOOL = {
    type: "function",
    function: {
        name: "chaoxing_qr_login",
        description: "超星学习通扫码登录。①action=qr或auto→生成QR(立即返回,非阻塞,获得enc+uuid) ②拿到enc+uuid后立即调action=login(enc, uuid)→阻塞等待用户扫码。login会先用传入的enc/uuid轮询(与显示的QR一致);若QR过期则返回新QR→回到步骤①。不要跳过第①步!",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", description: "check=检查cookie / qr或auto=生成二维码(非阻塞) / login=等待扫码(阻塞,传入enc+uuid)" },
                enc: { type: "string", description: "login时传入(由qr/auto返回)" },
                uuid: { type: "string", description: "login时传入(由qr/auto返回)" },
                timeout: { type: "integer", description: "login超时秒数,默认300" }
            },
            required: ["action"]
        }
    }
};

// ==================== 引擎工具 (心跳/Cron/子代理) ====================
const ENGINE_CRON_LIST_TOOL = {
    type: "function",
    function: {
        name: "engine_cron_list",
        description: "查询所有正在运行的后台定时任务(Cron)。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] }
    }
};

const ENGINE_CRON_CREATE_TOOL = {
    type: "function",
    function: {
        name: "engine_cron_create",
        description: "创建一个后台定时任务(Cron),定期执行命令。适合定期检查刷课进度、推送通知、数据备份等场景。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "任务名称" },
                interval: { type: "number", description: "执行间隔(秒),最小60秒" },
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

const DELEGATE_WORKFLOW_TOOL = {
    type: "function",
    function: {
        name: "delegate_workflow",
        description: "【工作流】创建多步骤链式工作流，上一步结果自动注入下一步。steps为步骤数组，每步指定role(explorer/planner/developer/verifier/general)和prompt。适合有明确步骤依赖的复杂任务。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "工作流名称" },
                steps: { type: "array", items: { type: "object", properties: { role: { type: "string", description: "子代理角色: explorer/planner/developer/verifier/general" }, prompt: { type: "string", description: "该步骤的任务描述(可使用{step_N}引用前面步骤结果)" } }, required: ["role","prompt"] }, description: "步骤数组，按顺序执行" }
            },
            required: ["name", "steps"]
        }
    }
};

const DELEGATE_TASK_TOOL = {
    type: "function",
    function: {
        name: "delegate_task",
        description: "【推荐】创建一个子代理执行后台任务。子代理会根据角色获得不同工具权限。比 engine_agent_create 更稳定。可以创建多个并行子代理,多次调用即可。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "子代理名称,简短唯一" },
                task: { type: "string", description: "任务描述(尽量详细,包含要搜索的关键词/要分析的维度/输出格式要求)。字数不限,越详细子代理执行越精准" },
                role: { type: "string", description: "子代理角色:explorer(搜) planner(规) developer(开) verifier(验) general(全)。默认general", "default": "general" },
                prompt: { type: "string", description: "自定义系统提示词(可选)。如果提供,会和task合并成完整prompt;如果不传,系统会用task自动生成详细的系统提示词" }
            },
            required: ["name", "task"]
        }
    }
};

const ENGINE_AGENT_STATUS_TOOL = {
    type: "function",
    function: {
        name: "engine_agent_status",
        description: "【⚠️ 勿轮询!】查询子代理的运行状态和结果。仅在创建后超过2分钟未收到自动推送时调用一次，禁止反复轮询——子代理完成后会自动推送通知。",
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
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] }
    }
};

const ENGINE_AGENT_DELETE_TOOL = {
    type: "function",
    function: {
        name: "engine_agent_delete",
        description: "删除一个指定的子代理(不可撤销)。删除前应向用户确认。",
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
        description: "给一个已存在的子代理发送一条消息,等待它回复后返回结果。相当于跟子代理聊天。如果子代理不存在会报错。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "子代理名称(必须是已有子代理)" },
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
        description: "向用户交付通知或服务器文件下载链接。只在产物已生成并经你核验后调用；msg仅写简短、可验证的交付说明，不要自行估算字数、页数、测试结果或格式状态。每个文件默认只推送一次；详细分析统一放在最终回答中。传file参数指定服务器路径(如/tmp/video.mp4)，用户会收到下载按钮。",
        parameters: {
            type: "object",
            properties: {
                msg: { type: "string", description: "推送消息内容" },
                file: { type: "string", description: "可选,服务器上文件路径(如/tmp/video_output.mp4),会生成下载链接" },
                filename: { type: "string", description: "可选,用户下载时显示的文件名；未填时使用源文件 basename。应按用户要求填写完整文件名和扩展名。" }
            },
            required: ["msg"]
        }
    }
};
const TOGGLE_PROXY_TOOL = {
    type: "function",
    function: {
        name: "toggle_proxy",
        description: "【⚠️ 需用户确认】开启或关闭网络代理。当访问境外网站返回503/连接超时/服务器不可达时，调用此工具请求开启代理穿透网络限制。用户会看到弹窗确认。action: 'on'=开启代理, 'off'=关闭代理。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["on", "off"], description: "on=开启代理, off=关闭代理" }
            },
            required: ["action"]
        }
    }
};
const PLAN_UPDATE_TOOL = {
    type: "function",
    function: {
        name: "plan_update",
        description: "【计划管理】更新任务执行计划。在开始复杂/多步骤任务前，先用 action=create 创建计划列出所有步骤；执行中通过 action=update 更新单个任务状态；全部完成后用 action=complete 结束计划。\n计划创建指南：\n- 任务数量 3-8 个，每个有清晰的可交付成果\n- task id 用 task_1, task_2... 格式\n- 初始状态全部为 pending，执行时逐个改为 running→completed\n- 标题简洁（一行），描述可选补充细节",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["create", "update", "complete"],
                    description: "create=创建新计划(需提供tasks数组), update=更新单个任务状态(需提供task_id+status), complete=计划完成(自动关闭面板)"
                },
                tasks: {
                    type: "array",
                    description: "任务列表(action=create 时必填)",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string", description: "任务唯一ID，如 task_1" },
                            title: { type: "string", description: "任务标题，一行简短描述" },
                            description: { type: "string", description: "可选详细说明" },
                            status: { type: "string", enum: ["pending", "running", "completed", "failed", "skipped"], description: "初始状态，默认 pending" }
                        },
                        required: ["id", "title"]
                    }
                },
                task_id: { type: "string", description: "要更新的任务ID (action=update 时必填)" },
                status: { type: "string", enum: ["pending", "running", "completed", "failed", "skipped"], description: "新状态 (action=update 时必填)" },
                note: { type: "string", description: "可选备注，会显示在任务下方" }
            },
            required: ["action"]
        }
    }
};

// ===================== 网页/搜索/图像/AI Agent 工具定义 (从 main.js 迁入) ====================

const WEB_FETCH_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "web_fetch",
        description: "抓取并解析网页内容。当需要查看搜索结果的详细信息、阅读文章、核实事实、获取最新数据时调用此工具。支持单个URL和批量URL(最多5个并行)。返回网页的文本内容(已去除HTML标签、脚本等噪音)。工具内部会自动尝试当前代理、服务器中继和直连；全部失败后再调用 toggle_proxy 请求用户确认，不要自行臆造 ghproxy/gitclone 镜像地址。图片纪律：抓取页面只返回文本不代表其中提到的图片文件可按猜测路径访问；不得依据页面摘要中的 *.png/*.jpg 文件名自行拼接图片 URL。找不到服务端返回的真实图片 URL 时，只输出该页面作为来源链接。",
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

const RUN_SKILL_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "run_skill",
        description: "运行一个已保存的可复用技能。技能是预设的提示词模板+工具集。当用户的任务与已保存技能匹配时调用。",
        parameters: {
            type: "object",
            properties: {
                skill_name: { type: "string", description: "要运行的技能名称" },
                params: { type: "object", description: "技能参数, 用于填充提示词模板的 {param} 占位符" }
            },
            required: ["skill_name"]
        }
    }
};

const PLATFORM_EXTRACT_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "platform_extract",
        description: "从特定平台提取结构化内容。支持 Bilibili 视频/专栏信息(标题、UP主、播放量、弹幕数等)。当用户分享B站、YouTube等平台链接并想了解其内容时调用。",
        parameters: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: "要提取的平台URL(如B站视频链接 https://www.bilibili.com/video/BV...)"
                }
            },
            required: ["url"]
        }
    }
};

const RAG_SEARCH_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "rag_search",
        description: "搜索知识库(RAG)获取私有文档信息。仅在用户明确询问文档/知识库内容时使用。",
        parameters: {
            type: "object",
            properties: {
                q: { type: "string", description: "搜索查询" },
                collection: { type: "string", description: "知识库名称,默认default" },
                top_k: { type: "integer", description: "返回条数,默认5" }
            },
            required: ["q"]
        }
    }
};

const SEARCH_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "web_search",
        description: "执行网页搜索并返回最新网页结果。当用户问题涉及最新新闻、实时信息、当前事件、未知事实时调用此工具。调用纪律【重要】：调用此工具时不要在正文中预先输出任何回答、猜测或寒暄解释（例如“我为您搜索”、“正在为您查询”、“根据我的了解”等），请直接且仅发起工具调用；等待工具执行返回完整搜索结果后，在下一轮中综合工具结果给出最终回答。图片纪律：用户要求找/看已有图片时，优先使用图片搜索返回的真实 thumbnail/image_url；若只有网页链接，必须提供可访问的来源页面链接，绝对禁止臆造图片直链。",
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

const GET_CURRENT_TIME_TOOL = {
    type: "function",
    function: {
        name: "get_current_time",
        description: "获取当前精确时间和全球金融交易时区(北京时间/美东时间EDT/EST/伦敦时间/东京时间)及各证券市场实时交易状态(美股盘中/盘前/盘后/已收盘、A股/港股状态)。查询实时事件、美股开闭盘、计算时差时必须以此为准。",
        parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] }
    }
};

const IMAGE_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "generate_image",
        description: "【纯文生图；禁止用于搜图】仅在用户明确要求画、生成、创作、设计一张不存在的新图片时使用。用户说搜索、查找、收集、推荐或‘给我找几张图片/照片/梗图/壁纸’时，属于现有图片搜索，严禁调用本工具，即使句子含‘有趣插图’等描述也不是生图。只有同一句明确要求搜索后再创作新图，搜索完成后才可调用；若要参考搜索结果生成，应改用 generate_image_i2i(reference_source=search_results)。不要在文本回复中伪造生成结果。",
        parameters: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "★ 图片提示词,建议英文,≤1500字符。简洁描述主题、风格即可。例如:'A cute cat, anime style'"
                },
                model: {
                    type: "string",
                    description: "图像模型(可选,不传则使用用户在图像生成设置中配置的默认模型)。注意:不同提供商支持不同模型,不要跨提供商使用模型名。"
                },
                aspect_ratio: {
                    type: "string",
                    description: "宽高比:1:1(默认)/16:9/4:3/3:2/9:16"
                },
                image_size: {
                    type: "string",
                    description: "分辨率(仅GPT Image 2): 0.5K/1K(默认)/2K/4K"
                },
                n: {
                    type: "integer",
                    description: "生成图片数量,1-9张。★ 用户要求多张图片时务必使用此参数一次生成,不要多次调用生成。默认1张。★ 并行提示:如果需要多张不同提示词的图片,可以在一次响应中发起多个 generate_image 调用,它们会被并行执行以节省时间。"
                },
                seed: {
                    type: "integer",
                    description: "【严格规则 ⚠️】只有同时满足以下所有条件时才传入seed:\n1. n=1(只生成一张)\n2. 用户明确要求前后风格一致/一样/同款\n3. 上次也用这个seed\n\n⚠️ n>1(多张)时绝不要传seed--否则所有图片完全相同。\n⚠️ 提示词不一样时也不要传seed。\n⚠️ 通常情况下不要传seed,让系统自由发挥效果更好。"
                },
                prompt_optimizer: {
                    type: "boolean",
                    description: "是否开启prompt自动优化(MiniMax),默认false"
                },
                aigc_watermark: {
                    type: "boolean",
                    description: "是否添加水印(MiniMax),默认false"
                }
            },
            required: ["prompt"]
        }
    }
};

const IMAGE_I2I_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "generate_image_i2i",
        description: "【图生图】当用户明确要求参考已有图片生成/创作新图时使用。参考图既可以来自用户上传、聊天中最近生成图，也可以来自最近一次 /image 搜索结果；使用搜图结果时传 reference_source=search_results。适用:换颜色/风格/人物、参考多图合成、先搜素材再创作。禁止:用户只要求搜索或查看已有图片时不要调用。",
        parameters: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "【必填】生成要求描述。如果有多张参考图,明确说明哪张图用作风格参考、哪张图用作内容参考。如:'用第一张的【风格】(水墨风/飞白/留白)结合第二张的【内容】(英姿飒爽的武者姿态)来生成新图'"
                },
                aspect_ratio: {
                    type: "string",
                    description: "宽高比:1:1/16:9/4:3/3:2/2:3/3:4/9:16,默认1:1"
                },
                n: {
                    type: "integer",
                    description: "生成图片数量,1-9张。★ 需要多张变体时使用此参数一次生成。★ 并行提示:如果需要多张不同提示词的图片,可以在一次响应中发起多个 generate_image_i2i 调用,它们会被并行执行以节省时间。"
                },
                seed: {
                    type: "integer",
                    description: "随机种子。★ n>1时不要传seed,否则所有图一样。"
                },
                mask_image: {
                    type: "string",
                    description: "【可选,GPT Image原生支持】遮罩图URL或base64,用于精确指定要修改的区域。仅用于图生图模式。"
                },
                reference_source: {
                    type: "string",
                    enum: ["auto", "uploads", "search_results"],
                    description: "参考图来源。auto=优先本轮上传图、否则最近生成图；uploads=仅用户上传图；search_results=使用当前聊天最近一次 /image 搜索结果。复合‘先搜图再参考生成’必须传 search_results。"
                },
                reference_indexes: {
                    type: "array",
                    items: { type: "integer" },
                    description: "当 reference_source=search_results 时选择搜索结果序号，0=第一张。默认使用前3张，最多4张。"
                }
            },
            required: ["prompt"]
        }
    }
};

const GENERATE_PPT_TOOL = {
    type: "function",
    function: {
        name: "generate_ppt",
        description: "生成专业PPT演示文稿。支持封面页(cove)/分隔页(divider)/卡片网格(card_grid)布局。图片支持本地路径和HTTP URL(自动下载+等比裁切,零变形)。每页自动注入放映过渡动画。适合汇报、方案展示、项目总结等场景。",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string", description: "PPT标题" },
                filename: { type: "string", description: "输出文件名(不含扩展名)" },
                theme: { type: "string", enum: ["default","dark"], description: "配色主题" },
                pages: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            type: { type: "string", enum: ["cover","divider","card_grid"] },
                            title: { type: "string" },
                            subtitle: { type: "string" },
                            rows: { type: "integer", description: "卡片网格行数(默认2)" },
                            cols: { type: "integer", description: "卡片网格列数(默认2)" },
                            cards: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        title: { type: "string" },
                                        bullets: { type: "array", items: { type: "string" } },
                                        img: { type: "string", description: "本地图片路径" },
                                        img_url: { type: "string", description: "图片HTTP URL(自动下载+预处理)" }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            required: ["title", "pages"]
        }
    }
};

const ANALYZE_IMAGE_TOOL = {
    type: "function",
    function: {
        name: "analyze_image",
        description: "分析用户上传的图片内容,返回详细的图片描述。当用户发送图片并询问图片内容、要求描述图片、分析图片细节时调用此工具。支持多张图片(包括用户分多次上传的所有图片和AI生成的图片),系统会自动收集聊天中所有图片,按上传顺序排列。用 image_index 指定分析哪一张(0=第一张/最旧, 最后一张索引=最新上传),或用 image_indexes 同时分析多张 [0,1,2]。★ 不传则默认分析最新上传的图片(最后一张)。支持 JPEG、PNG、GIF、WebP、HEIC 格式。",
        parameters: {
            type: "object",
            properties: {
                focus: {
                    type: "string",
                    description: "分析重点,如:'人物特征'、'场景描述'、'文字识别'、'物体识别'等。不传则进行综合分析。"
                },
                image_index: {
                    type: "integer",
                    description: "要分析的图片索引(0=第一张/最旧, 1=第二张, ..., 最后一张=最新上传)。当用户上传了多张图片时使用此参数指定具体分析哪一张。默认不传=分析最新上传的图片(最后一张)。"
                },
                image_indexes: {
                    type: "array",
                    items: { type: "integer" },
                    description: "★ 并行分析多张图片: 传入索引数组 [0,1,2] 可同时分析多张图片,结果合并返回。适用于用户上传多张图片需要全部分析的场景。"
                }
            }
        }
    }
};

const VIDEO_UNDERSTANDING_TOOL = {
    type: "function",
    function: {
        name: "video_understanding",
        description: "分析用户上传的本地 MP4/视频。系统通过 ffmpeg 提取关键帧，再复用配置栏当前选择的视觉提供商与视觉模型进行理解；询问结尾、最后动作或定格时会密集提取最后两秒与最终帧。不要声称无法读取视频或要求用户另行截图，应优先调用本工具。",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "分析需求，如'描述视频内容''视频中有什么'等" },
                video_index: { type: "integer", description: "视频索引，0表示第一个视频" }
            }
        }
    }
};

const VIDEO_EDIT_TOOL = {
    type: "function",
    function: {
        name: "video_edit",
        description: "🎬 全能视频剪辑工厂。支持字幕+配音+滤镜+转场+弹幕一站式制作，也支持单一操作。剪辑流程：先 info 查看视频信息 → 选择操作 → 输出。🎤 新增 stt(语音转文字): 从视频提取音频后用 AI 转为文字字幕。\n\n🔥 推荐主操作 compose（一键生成带字幕配音的成品视频）：\n- 自动TTS逐句配音（支持多角色切换 voice_id）\n- 精确时间轴字幕（SRT烧录，支持中英文+emoji）\n- 6种预设字幕风格 style: bilibili(粉)/variety(综艺黄)/minimal(简约白)/bold(粗红)/neon(赛博绿)/typewriter(打字机灰)\n- 弹幕模式 danmaku（从右到左飞过，随机颜色/位置）\n- 保留原音频+配音混合\n- 视频滤镜 filter（sepia/vintage/bw/grain/vignette/hue/eq/boxblur）\n\n📐 其他操作：crop(画面裁剪,支持比例16:9/1:1等) reverse(倒放) mute(去原声) bgm(背景音乐) enhance(自动增强: vivid/cinematic/hdr预设) gif(视频转GIF) silent_cut(切静音) trim(裁剪时间段) concat(多段拼接) speed(调速) resize(缩放) overlay(画中画) text(字幕) rotate(旋转) audio(提取音频) tts(纯语音合成) voice(配音) frames(提取帧) info(查看视频信息)",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", description: "操作: compose(推荐) trim concat speed resize overlay text audio rotate filter video_filter transition video_transition tts voice frames info crop reverse mute bgm enhance gif silent_cut style stt(语音转文字)" },
                params: { type: "object", description: "operation params. See action list above for details." },
                input_path: { type: "string", description: "输入视频路径。用户上传视频后,消息中会标注「服务器路径: /oneapichat/uploads/...」,直接用这个路径即可" },
                output_path: { type: "string", description: "输出路径(可选)" }
            },
            required: ["action", "params", "input_path"]
        }
    }
};

const ASK_AGENT_TOOL = {
    type: "function",
    function: {
        name: "ask_agent",
        description: "单次请求启用高级工具权限。调用后本对话可临时使用文件操作、命令执行、子代理等工具，无需切换模式。完成本轮任务后权限自动回收。",
        parameters: {
            type: "object",
            properties: {
                reason: {
                    type: "string",
                    description: "启用Agent模式的理由,如'我需要执行系统命令来...'"
                }
            },
            required: ["reason"]
        }
    }
};

const AUTONOMOUS_MODE_TOOL = {
    type: "function",
    function: {
        name: "autonomous_mode",
        description: "在Agent模式下控制自主行为模式。启用后AI可以自主决定是否使用工具而无需每次都询问用户。",
        parameters: {
            type: "object",
            properties: {
                enabled: {
                    type: "boolean",
                    description: "true=启用自主模式,false=禁用自主模式"
                }
            },
            required: ["enabled"]
        }
    }
};

// ★ Agent 工具键列表（全局共享，消除 5 处重复定义）
const AGENT_TOOL_KEYS = ['SERVER_EXEC_TOOL','SERVER_PYTHON_TOOL','SERVER_FILE_READ_TOOL','SERVER_FILE_WRITE_TOOL','SERVER_FILE_OP_TOOL','SERVER_FILE_EDIT_TOOL','SERVER_FILE_GREP_TOOL','SERVER_FILE_SEARCH_TOOL','SERVER_DOCKER_TOOL','SERVER_DB_QUERY_TOOL','SERVER_SYS_INFO_TOOL','SERVER_PS_TOOL','SERVER_DISK_TOOL','SERVER_NETWORK_TOOL','ENGINE_CRON_LIST_TOOL','ENGINE_CRON_CREATE_TOOL','ENGINE_CRON_DELETE_TOOL','DELEGATE_TASK_TOOL','DELEGATE_WORKFLOW_TOOL','ENGINE_AGENT_STATUS_TOOL','ENGINE_AGENT_LIST_TOOL','ENGINE_AGENT_DELETE_TOOL','ENGINE_PUSH_TOOL','PLAN_UPDATE_TOOL','BROWSER_NAVIGATE_TOOL','BROWSER_SCREENSHOT_TOOL','BROWSER_CLICK_TOOL','BROWSER_TYPE_TOOL','BROWSER_GET_CONTENT_TOOL','BROWSER_GET_SNAPSHOT_TOOL'];
const AGENT_ONLY_KEYS = ['SERVER_EXEC_TOOL','SERVER_PYTHON_TOOL','SERVER_FILE_WRITE_TOOL','SERVER_FILE_OP_TOOL','SERVER_FILE_EDIT_TOOL','SERVER_DOCKER_TOOL','SERVER_DB_QUERY_TOOL','ENGINE_CRON_LIST_TOOL','ENGINE_CRON_CREATE_TOOL','ENGINE_CRON_DELETE_TOOL','DELEGATE_TASK_TOOL','DELEGATE_WORKFLOW_TOOL','ENGINE_AGENT_STATUS_TOOL','ENGINE_AGENT_LIST_TOOL','ENGINE_AGENT_DELETE_TOOL','ENGINE_PUSH_TOOL','PLAN_UPDATE_TOOL','BROWSER_NAVIGATE_TOOL','BROWSER_SCREENSHOT_TOOL','BROWSER_CLICK_TOOL','BROWSER_TYPE_TOOL','BROWSER_GET_CONTENT_TOOL','BROWSER_GET_SNAPSHOT_TOOL'];

// ==================== 统一工具注册表 (Tool Registry) ====================
// 参考 Claude Code 的 buildTool() 模式,每个工具自带元数据
// ToolCapability: 描述工具的权限和能力
const ToolCapability = {
  READS_FILES: 'reads_files',
  WRITES_FILES: 'writes_files',
  NETWORK: 'network',
  EXEC: 'exec',
  SYSTEM: 'system',
  AGENT_CREATE: 'agent_create',
  AGENT_LIST: 'agent_list',
  DATABASE: 'database',
  FILE_SEARCH: 'file_search',
  IMAGE_GENERATE: 'image_generate',
  IMAGE_ANALYZE: 'image_analyze',
  CHAOXING: 'chaoxing',
  CRON: 'cron',
  NONE: 'none'
};

// 审批级别
const ApprovalLevel = {
  AUTO: 'auto',      // 自动批准
  SUGGEST: 'suggest', // 建议但不需要强制审批
  REQUIRED: 'required' // 必须审批
};

/**
 * 构建工具元数据
 * 参考 Claude Code 的 buildTool() 模式
 */
function buildToolMeta(name, opts) {
  return {
    name: name,
    capabilities: opts.capabilities || [],
    approval: opts.approval || ApprovalLevel.AUTO,
    maxResultSizeChars: opts.maxResultSizeChars || 100000,
    searchHint: opts.searchHint || '',
    isReadOnly: opts.isReadOnly !== undefined ? opts.isReadOnly : true,
    isAgentOnly: opts.isAgentOnly || false,
    // 渲染工具调用消息 (纯 SVG 图标，禁用 Emoji)
    renderUseMessage: opts.renderUseMessage || function(input) {
      var summary = typeof input === 'object' ? JSON.stringify(input).substring(0, 80) : String(input).substring(0, 80);
      var svgIcon = (typeof window.getVibeSvg === 'function') ? window.getVibeSvg('bolt', { size: 14, className: 'text-blue-500' }) : '<span class="vibe-tool-bullet"></span>';
      return '<div class="tool-card"><div class="tool-card-header"><span class="tool-card-icon">' + svgIcon + '</span><span class="tool-card-name">' + escapeHtml(name) + '</span></div><div class="tool-card-body">' + escapeHtml(summary) + '</div></div>';
    },
    // 渲染工具结果 (纯 SVG 图标，禁用 Emoji)
    renderResultMessage: opts.renderResultMessage || function(output) {
      var text = typeof output === 'string' ? output : (output && output.result ? output.result : JSON.stringify(output));
      var truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;
      var checkSvg = (typeof window.getVibeSvg === 'function') ? window.getVibeSvg('checkCircle', { size: 14, className: 'text-emerald-500 inline-block mr-1' }) : '';
      return '<div class="tool-result"><div class="tool-result-header flex items-center">' + checkSvg + '<span>执行完成</span></div><pre class="tool-result-body">' + escapeHtml(truncated) + '</pre></div>';
    },
    // 获取简要摘要
    getSummary: opts.getSummary || function(input) {
      return name + ': ' + (typeof input === 'object' ? JSON.stringify(input).substring(0, 60) : String(input).substring(0, 60));
    }
  };
}

// ==================== 工具注册表 (全局) ====================
const toolRegistry = (function() {
  var _registry = {};

  function register(name, meta) {
    _registry[name] = meta;
  }

  function get(name) {
    return _registry[name] || null;
  }

  function has(name) {
    return !!_registry[name];
  }

  function getApprovalLevel(name) {
    var meta = _registry[name];
    if (!meta) return ApprovalLevel.REQUIRED; // 未知工具默认需要审批
    return meta.approval;
  }

  function isReadOnly(name) {
    var meta = _registry[name];
    if (!meta) return false;
    return meta.isReadOnly;
  }

  function isAgentOnly(name) {
    var meta = _registry[name];
    if (!meta) return false;
    return meta.isAgentOnly;
  }

  function getSearchHint(name) {
    var meta = _registry[name];
    return meta ? (meta.searchHint || '') : '';
  }

  function getCapabilities(name) {
    var meta = _registry[name];
    return meta ? (meta.capabilities || []) : [];
  }

  function getAllToolNames() {
    return Object.keys(_registry);
  }

  function getStats() {
    var names = Object.keys(_registry);
    var readOnly = names.filter(function(n) { return _registry[n].isReadOnly; }).length;
    var write = names.filter(function(n) { return !_registry[n].isReadOnly; }).length;
    var auto = names.filter(function(n) { return _registry[n].approval === 'auto'; }).length;
    var required = names.filter(function(n) { return _registry[n].approval === 'required'; }).length;
    return { total: names.length, readOnly: readOnly, write: write, autoApproval: auto, requiresApproval: required };
  }

  /**
   * 生成 AI 可读的工具选择提示
   */
  function getToolSelectionPrompt() {
    var names = Object.keys(_registry);
    var lines = names.map(function(n) {
      var m = _registry[n];
      var caps = m.capabilities.join(', ');
      var appLevel = m.approval === 'auto' ? '✅ 自动' : (m.approval === 'suggest' ? '💡 建议' : '🔐 需审批');
      return '- ' + n + ' [' + caps + '] ' + appLevel + (m.isReadOnly ? ' 📖只读' : ' ✏️写') + (m.searchHint ? ' → ' + m.searchHint : '');
    });
    return '可用工具:\n' + lines.join('\n');
  }

  // ★ 工具定义映射表 (工具名 → OpenAI格式工具定义)
  var _toolDefMap = {};

  function registerToolDefinition(name, toolDef) {
    _toolDefMap[name] = toolDef;
  }

  function getToolDefinition(name) {
    return _toolDefMap[name] || null;
  }

  function getAllToolDefinitions() {
    return Object.assign({}, _toolDefMap);
  }

  function unregister(name) {
    delete _registry[name];
    delete _toolDefMap[name];
  }

  return {
    register: register,
    get: get,
    has: has,
    unregister: unregister,
    getApprovalLevel: getApprovalLevel,
    isReadOnly: isReadOnly,
    isAgentOnly: isAgentOnly,
    getSearchHint: getSearchHint,
    getCapabilities: getCapabilities,
    getAllToolNames: getAllToolNames,
    getStats: getStats,
    getToolSelectionPrompt: getToolSelectionPrompt,
    registerToolDefinition: registerToolDefinition,
    getToolDefinition: getToolDefinition,
    getAllToolDefinitions: getAllToolDefinitions
  };
})();

// ★ 视频猎手标签映射 (全局, 供IIFI内外共用)
var _vhLabels = {
  'video_search':'磁力搜索','video_parse':'解析磁力','video_download':'BT/磁力下载',
  'video_download_status':'下载进度','video_list_downloads':'下载列表','video_cleanup':'清理残留下载',
  'video_upload_cloudreve':'上传云盘','video_cloudreve_list':'云盘浏览',
  'video_cloudreve_mkdir':'云盘建文件夹','video_cloudreve_search':'云盘搜索','video_cloudreve_url':'云盘链接',
  'bili_info':'B站视频信息','bili_streams':'B站流地址','bili_search_ex':'B站深度搜索',
  'bili_download':'B站下载','bili_download_status':'B站下载进度'
};

// ==================== 注册所有工具到注册表 ====================
(function _registerAllTools() {
  // ★ DSH 标准底层 Coding 工具注册
  toolRegistry.register('run_code', buildToolMeta('run_code', {
    capabilities: [ToolCapability.EXEC, ToolCapability.READS_FILES, ToolCapability.WRITES_FILES],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '聚合编排多个底层工具',
  }));
  toolRegistry.registerToolDefinition('run_code', RUN_CODE_TOOL);
  toolRegistry.register('read', buildToolMeta('read', {
    capabilities: [ToolCapability.READS_FILES],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '读取文件内容(DSH)',
  }));
  toolRegistry.registerToolDefinition('read', READ_TOOL);

  toolRegistry.register('edit', buildToolMeta('edit', {
    capabilities: [ToolCapability.WRITES_FILES],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '局部精确编辑文件(DSH)',
  }));
  toolRegistry.registerToolDefinition('edit', EDIT_TOOL);

  toolRegistry.register('write', buildToolMeta('write', {
    capabilities: [ToolCapability.WRITES_FILES],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '写入文件(DSH)',
  }));
  toolRegistry.registerToolDefinition('write', WRITE_TOOL);

  toolRegistry.register('bash', buildToolMeta('bash', {
    capabilities: [ToolCapability.EXEC],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '执行Shell命令(DSH)',
  }));
  toolRegistry.registerToolDefinition('bash', BASH_TOOL);

  toolRegistry.register('grep', buildToolMeta('grep', {
    capabilities: [ToolCapability.FILE_SEARCH],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '正则搜索文件内容(DSH)',
  }));
  toolRegistry.registerToolDefinition('grep', GREP_TOOL);

  toolRegistry.register('glob', buildToolMeta('glob', {
    capabilities: [ToolCapability.FILE_SEARCH],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '模式匹配查找文件(DSH)',
  }));
  toolRegistry.registerToolDefinition('glob', GLOB_TOOL);

  toolRegistry.register('todo_write', buildToolMeta('todo_write', {
    capabilities: [ToolCapability.NONE],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    isAgentOnly: false,
    searchHint: '更新任务清单(DSH)',
  }));
  toolRegistry.registerToolDefinition('todo_write', TODO_WRITE_TOOL);

  // 读操作 - 只读,自动审批
  toolRegistry.register('server_file_read', buildToolMeta('server_file_read', {
    capabilities: [ToolCapability.READS_FILES],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '读取服务器文件',
  }));
  toolRegistry.register('parse_document', buildToolMeta('parse_document', {
    capabilities: [ToolCapability.READS_FILES],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: false,
    searchHint: '解析办公文档提取文本',
  }));
  toolRegistry.register('server_file_search', buildToolMeta('server_file_search', {
    capabilities: [ToolCapability.FILE_SEARCH],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '搜索服务器文件',
  }));
  toolRegistry.register('server_sys_info', buildToolMeta('server_sys_info', {
    capabilities: [ToolCapability.SYSTEM],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '获取系统信息',
  }));
  toolRegistry.register('server_ps', buildToolMeta('server_ps', {
    capabilities: [ToolCapability.SYSTEM],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '查看进程列表',
  }));
  toolRegistry.register('server_disk', buildToolMeta('server_disk', {
    capabilities: [ToolCapability.SYSTEM],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '查看磁盘使用',
  }));
  toolRegistry.register('server_network', buildToolMeta('server_network', {
    capabilities: [ToolCapability.SYSTEM],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '查看网络状态',
  }));
  toolRegistry.register('server_db_query', buildToolMeta('server_db_query', {
    capabilities: [ToolCapability.DATABASE],
    approval: ApprovalLevel.SUGGEST,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '查询数据库',
  }));

  // 搜索/网络 - 只读,自动审批
  toolRegistry.register('web_search', buildToolMeta('web_search', {
    capabilities: [ToolCapability.NETWORK],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '搜索互联网',
  }));
  toolRegistry.register('get_current_time', buildToolMeta('get_current_time', {
    capabilities: [ToolCapability.NONE],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '获取当前精确时间',
  }));
  toolRegistry.register('web_fetch', buildToolMeta('web_fetch', {
    capabilities: [ToolCapability.NETWORK],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '抓取网页内容',
  }));
  toolRegistry.register('platform_extract', buildToolMeta('platform_extract', {
    capabilities: [ToolCapability.NETWORK],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '提取B站等平台视频/文章信息',
  }));
  toolRegistry.register('run_skill', buildToolMeta('run_skill', {
    capabilities: [ToolCapability.NONE],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    searchHint: '运行已保存的技能',
  }));
  toolRegistry.register('rag_search', buildToolMeta('rag_search', {
    capabilities: [ToolCapability.NETWORK],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '搜索本地知识库',
  }));

  // 图片 - 只读/自动
  toolRegistry.register('image_gen', buildToolMeta('image_gen', {
    capabilities: [ToolCapability.IMAGE_GENERATE],
    approval: ApprovalLevel.SUGGEST,
    isReadOnly: false,
    searchHint: '生成图片',
  }));
  toolRegistry.register('analyze_image', buildToolMeta('analyze_image', {
    capabilities: [ToolCapability.IMAGE_ANALYZE],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '分析图片',
  }));

  // 写操作 - 需要审批
  toolRegistry.register('server_exec', buildToolMeta('server_exec', {
    capabilities: [ToolCapability.EXEC],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '执行Shell命令',
  }));
  toolRegistry.register('server_python', buildToolMeta('server_python', {
    capabilities: [ToolCapability.EXEC],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '执行Python代码',
  }));
  toolRegistry.register('server_file_write', buildToolMeta('server_file_write', {
    capabilities: [ToolCapability.WRITES_FILES],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '写入文件',
  }));
  toolRegistry.register('server_file_op', buildToolMeta('server_file_op', {
    capabilities: [ToolCapability.WRITES_FILES],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '文件操作(复制/移动/删除)',
  }));
  // ★ 智能文件编辑
  toolRegistry.register('server_file_edit', buildToolMeta('server_file_edit', {
    capabilities: [ToolCapability.WRITES_FILES],
    approval: ApprovalLevel.SUGGEST,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '精确编辑文件内容',
  }));
  // ★ 文件内容搜索(带上下文)
  toolRegistry.register('server_file_grep', buildToolMeta('server_file_grep', {
    capabilities: [ToolCapability.READS_FILES],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '搜索文件内容(正则+上下文)',
  }));
  toolRegistry.register('server_docker', buildToolMeta('server_docker', {
    capabilities: [ToolCapability.EXEC],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '执行Docker命令',
  }));

  // Cron - 需要审批
  toolRegistry.register('engine_cron_create', buildToolMeta('engine_cron_create', {
    capabilities: [ToolCapability.CRON],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '创建定时任务',
  }));
  toolRegistry.register('engine_cron_delete', buildToolMeta('engine_cron_delete', {
    capabilities: [ToolCapability.CRON],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '删除定时任务',
  }));
  toolRegistry.register('engine_cron_list', buildToolMeta('engine_cron_list', {
    capabilities: [ToolCapability.CRON],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '列出定时任务',
  }));

  // 子代理 - 中等风险
  toolRegistry.register('delegate_task', buildToolMeta('delegate_task', {
    capabilities: [ToolCapability.AGENT_CREATE],
    approval: ApprovalLevel.SUGGEST,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '创建后台子代理执行任务',
  }));
  toolRegistry.register('engine_agent_create', buildToolMeta('engine_agent_create', {
    capabilities: [ToolCapability.AGENT_CREATE],
    approval: ApprovalLevel.SUGGEST,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '创建子代理',
  }));
  // 计划更新 - 客户端仅处理,自动批准
  toolRegistry.register('plan_update', buildToolMeta('plan_update', {
    capabilities: [ToolCapability.NONE],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '更新任务执行计划',
  }));
  // ===== 浏览器工具注册 =====
  toolRegistry.register('browser_navigate', buildToolMeta('browser_navigate', {
    capabilities: [ToolCapability.NETWORK],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '浏览器打开网页',
  }));
  toolRegistry.register('browser_screenshot', buildToolMeta('browser_screenshot', {
    capabilities: [ToolCapability.READ_ONLY],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '浏览器截图',
  }));
  toolRegistry.register('browser_click', buildToolMeta('browser_click', {
    capabilities: [ToolCapability.NETWORK],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '浏览器点击元素',
  }));
  toolRegistry.register('browser_type', buildToolMeta('browser_type', {
    capabilities: [ToolCapability.NETWORK],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '浏览器输入文字',
  }));
  toolRegistry.register('browser_get_content', buildToolMeta('browser_get_content', {
    capabilities: [ToolCapability.READ_ONLY],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '获取浏览器页面文本',
  }));
  toolRegistry.register('browser_get_snapshot', buildToolMeta('browser_get_snapshot', {
    capabilities: [ToolCapability.READ_ONLY],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '获取浏览器页面结构',
  }));
  toolRegistry.register('engine_agent_status', buildToolMeta('engine_agent_status', {
    capabilities: [ToolCapability.AGENT_LIST],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '查询子代理状态',
  }));
  toolRegistry.register('engine_agent_list', buildToolMeta('engine_agent_list', {
    capabilities: [ToolCapability.AGENT_LIST],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '列出所有子代理',
  }));
  toolRegistry.register('engine_agent_delete', buildToolMeta('engine_agent_delete', {
    capabilities: [ToolCapability.AGENT_CREATE],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '删除子代理(不可撤销)',
  }));
  toolRegistry.register('engine_agent_ask', buildToolMeta('engine_agent_ask', {
    capabilities: [ToolCapability.AGENT_LIST],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '与子代理对话',
  }));
  toolRegistry.register('engine_agent_stop', buildToolMeta('engine_agent_stop', {
    capabilities: [ToolCapability.AGENT_CREATE],
    approval: ApprovalLevel.SUGGEST,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '停止子代理',
  }));
  toolRegistry.register('engine_push', buildToolMeta('engine_push', {
    capabilities: [ToolCapability.NONE],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    searchHint: '推送通知给用户',
  }));

  // 模式控制
  toolRegistry.register('ask_agent', buildToolMeta('ask_agent', {
    capabilities: [ToolCapability.NONE],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    searchHint: '请求启用Agent模式',
  }));
  toolRegistry.register('autonomous_mode', buildToolMeta('autonomous_mode', {
    capabilities: [ToolCapability.NONE],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    searchHint: '切换自主模式',
  }));

  // 刷课工具
  toolRegistry.register('chaoxing_login', buildToolMeta('chaoxing_login', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    searchHint: '登录超星',
  }));
  toolRegistry.register('chaoxing_list_courses', buildToolMeta('chaoxing_list_courses', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '列出超星课程',
  }));
  toolRegistry.register('chaoxing_auto', buildToolMeta('chaoxing_auto', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    searchHint: '自动刷课',
  }));
  toolRegistry.register('chaoxing_status', buildToolMeta('chaoxing_status', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '查看刷课状态',
  }));
  toolRegistry.register('chaoxing_stop', buildToolMeta('chaoxing_stop', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.SUGGEST,
    isReadOnly: false,
    searchHint: '停止刷课',
  }));
  toolRegistry.register('chaoxing_stats', buildToolMeta('chaoxing_stats', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '查看刷课统计',
  }));
  toolRegistry.register('chaoxing_overview', buildToolMeta('chaoxing_overview', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '查看课程概览',
  }));
  toolRegistry.register('chaoxing_auth', buildToolMeta('chaoxing_auth', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '检测超星登录状态',
  }));
  toolRegistry.register('chaoxing_qr_login', buildToolMeta('chaoxing_qr_login', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    searchHint: '超星扫码登录',
  }));
  toolRegistry.register('chaoxing_exam_list', buildToolMeta('chaoxing_exam_list', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '列出超星考试',
  }));
  toolRegistry.register('chaoxing_exam_start', buildToolMeta('chaoxing_exam_start', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.REQUIRED,
    isReadOnly: false,
    searchHint: '开始超星考试',
  }));
  toolRegistry.register('chaoxing_exam_status', buildToolMeta('chaoxing_exam_status', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '查看考试状态',
  }));
  toolRegistry.register('chaoxing_exam_stop', buildToolMeta('chaoxing_exam_stop', {
    capabilities: [ToolCapability.CHAOXING],
    approval: ApprovalLevel.SUGGEST,
    isReadOnly: false,
    searchHint: '停止考试',
  }));

  // 自定义/impl工具 - 标记为中等风险
  toolRegistry.register('delegate_workflow', buildToolMeta('delegate_workflow', {
    capabilities: [ToolCapability.AGENT_CREATE],
    approval: ApprovalLevel.SUGGEST,
    isReadOnly: false,
    isAgentOnly: true,
    searchHint: '创建工作流代理',
  }));

  // ★ toggle_proxy — AI 自主控制代理开关(需弹窗确认)
  toolRegistry.register('toggle_proxy', buildToolMeta('toggle_proxy', {
    capabilities: [ToolCapability.SYSTEM],
    approval: ApprovalLevel.MUST_CONFIRM,  // ★ 始终弹窗确认
    isReadOnly: false,
    isAgentOnly: false,
    searchHint: '开启/关闭网络代理',
  }));

  // 图像
  toolRegistry.register('generate_image', buildToolMeta('generate_image', {
    capabilities: [ToolCapability.IMAGE_GENERATE],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    searchHint: 'AI图片生成',
  }));
  toolRegistry.register('generate_image_i2i', buildToolMeta('generate_image_i2i', {
    capabilities: [ToolCapability.IMAGE_GENERATE],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    searchHint: '图生图(参考图变体)',
  }));
  toolRegistry.register('analyze_image', buildToolMeta('analyze_image', {
    capabilities: [ToolCapability.IMAGE_ANALYZE],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '分析图片内容',
  }));
  // 视频
  toolRegistry.register('video_understanding', buildToolMeta('video_understanding', {
    capabilities: [],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '分析视频内容',
  }));
  toolRegistry.register('video_edit', buildToolMeta('video_edit', {
    capabilities: [],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    searchHint: '视频剪辑处理',
  }));
  // 🎬 视频猎手 Video Hunter — BT/磁力/云盘
  ['video_search','video_parse','video_download','video_download_status','video_list_downloads','video_cleanup',
   'video_upload_cloudreve','video_cloudreve_list','video_cloudreve_mkdir','video_cloudreve_search','video_cloudreve_url'
  ].forEach(function(name) {
    toolRegistry.register(name, buildToolMeta(name, {
      capabilities: ['media'],
      approval: name === 'video_cleanup' || name.includes('download') || name.includes('upload') ? ApprovalLevel.SUGGEST : ApprovalLevel.AUTO,
      isReadOnly: name !== 'video_cleanup' && (name.includes('status') || name.includes('list') || name.includes('search') || name.includes('url')),
      searchHint: _vhLabels[name] || name,
    }));
  });
  // 🎬 Bilibili 下载
  ['bili_info','bili_streams','bili_search_ex','bili_download','bili_download_status'].forEach(function(name) {
    toolRegistry.register(name, buildToolMeta(name, {
      capabilities: ['media', 'bilibili'],
      approval: name.includes('download') ? ApprovalLevel.SUGGEST : ApprovalLevel.AUTO,
      isReadOnly: name.includes('status') || name.includes('info') || name.includes('streams') || name.includes('search'),
      searchHint: _vhLabels[name] || name,
    }));
  });

  // ★ Video Hunter 工具定义已移到 IIFE 外部 (line ~1640)
  // 办公文档
  toolRegistry.register('generate_ppt', buildToolMeta('generate_ppt', {
    capabilities: [],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    searchHint: '生成PPT演示文稿',
  }));
  toolRegistry.register('generate_docx', buildToolMeta('generate_docx', {
    capabilities: [],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    searchHint: '生成Word文档',
  }));
  toolRegistry.register('generate_xlsx', buildToolMeta('generate_xlsx', {
    capabilities: [],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    searchHint: '生成Excel表格',
  }));
  toolRegistry.register('generate_pdf', buildToolMeta('generate_pdf', {
    capabilities: [],
    approval: ApprovalLevel.AUTO,
    isReadOnly: false,
    searchHint: '生成PDF文档',
  }));

  console.log('[ToolRegistry] 已注册', Object.keys(toolRegistry.getAllToolNames()).length, '个工具');
})();

// ★ Video Hunter 工具定义 (IIFE外部, window.前缀确保跨脚本可见)
window.VIDEO_HUNTER_TOOLS = [
    { type: "function", function: { name: "video_search", description: "搜索视频资源(磁力链接)。多站并发搜索BT种子/磁力聚合站。source=all|1337x|bt4g|eztv|zimeizi|ddg。注意: 部分BT站有反爬, 搜索失败时建议让Agent用web_search工具搜「关键词 magnet」作为补充。", parameters: { type: "object", properties: { query: { type: "string", description: "搜索关键词(如「庆余年 4K」「Ubuntu ISO」)" }, limit: { type: "integer", description: "每源最大结果数,默认10" }, source: { type: "string", description: "搜索源: all|1337x|bt4g|eztv|zimeizi|ddg, 默认all" } }, required: ["query"] } } },
    { type: "function", function: { name: "video_parse", description: "解析磁力链接或.torrent文件, 获取文件列表、大小、hash等元数据(无需下载内容)。返回: info_hash/name/files[{index,path,size}]。", parameters: { type: "object", properties: { uri: { type: "string", description: "磁力链接(magnet:?xt=urn:btih:...)或本地.torrent文件路径" } }, required: ["uri"] } } },
    { type: "function", function: { name: "video_download", description: "通过aria2下载磁力链接/torrent/URL。后台异步执行, 返回task_id, 用video_download_status查询进度。下载目录默认/tmp/video-hunter-downloads。⚠️重要: 同一个资源(uri)只需启动一次, 严禁重复启动; 启动后立即停止调用本工具, 改用video_download_status或video_list_downloads查看进度。", parameters: { type: "object", properties: { uri: { type: "string", description: "磁力链接、.torrent路径或HTTP URL" }, save_dir: { type: "string", description: "保存目录(可选,默认/tmp/video-hunter-downloads)" }, save_name: { type: "string", description: "保存文件名(可选)" }, connections: { type: "integer", description: "每服务器最大连接数,默认8" }, overwrite: { type: "boolean", description: "覆盖已存在文件,默认false" } }, required: ["uri"] } } },
    { type: "function", function: { name: "video_download_status", description: "查询video_download启动的下载任务进度。task_id为空时返回所有任务摘要(推荐, 一次看全部)。⚠️轮询纪律: BT/磁力任务连接tracker需要时间, 进度长时间为0属正常; 同一任务最多查询3次, 进度无明显变化就停止轮询并总结现状, 严禁反复调用或重复启动下载。", parameters: { type: "object", properties: { task_id: { type: "string", description: "下载任务ID(video_download返回的)" } }, required: [] } } },
    { type: "function", function: { name: "video_list_downloads", description: "列出本机所有视频下载任务(状态/进度/速度)。status_filter=all|downloading|completed|failed。", parameters: { type: "object", properties: { status_filter: { type: "string", description: "过滤: all|downloading|completed|failed" } }, required: [] } } },
    { type: "function", function: { name: "video_cleanup", description: "清理残留/卡死的视频下载任务。⚠️默认dry_run=true只预览不执行; 预览确认后再用dry_run=false真正清理。kill=true才会终止仍存活的aria2c进程(默认false, 还在下载的任务会跳过); remove_files=true删除任务目录下的0字节文件和.aria2控制文件(默认true, 有内容的文件永不删除); status=downloading|failed|all(默认downloading); 可按task_id精确清理。返回清理报告: 删除任务数/终止进程/删除文件/释放空间/重复任务分组。", parameters: { type: "object", properties: { task_id: { type: "string", description: "只清理指定task_id(可选)" }, status: { type: "string", description: "清理范围: downloading|failed|all, 默认downloading" }, kill: { type: "boolean", description: "是否终止仍存活的残留aria2c进程, 默认false" }, remove_files: { type: "boolean", description: "是否删除0字节文件+.aria2控制文件, 默认true" }, older_than_hours: { type: "number", description: "只清理started_at早于该小时数的任务(可选)" }, include_torrents: { type: "boolean", description: "是否连.torrent文件一起删, 默认false" }, dry_run: { type: "boolean", description: "true=只预览不执行(默认), false=真正执行清理" } }, required: [] } } },
    { type: "function", function: { name: "video_upload_cloudreve", description: "上传本地文件到Cloudreve云盘。大文件自动分片上传。file_path支持绝对路径或相对路径。", parameters: { type: "object", properties: { file_path: { type: "string", description: "服务器上的本地文件路径" }, remote_dir: { type: "string", description: "Cloudreve目标目录(如 /my/电影), 默认 /my" }, overwrite: { type: "boolean", description: "是否覆盖同名文件" } }, required: ["file_path"] } } },
    { type: "function", function: { name: "video_cloudreve_list", description: "浏览Cloudreve云盘目录内容。path支持「/my/电影」或「cloudreve://my/电影」。", parameters: { type: "object", properties: { path: { type: "string", description: "目录路径,默认根目录/" } }, required: [] } } },
    { type: "function", function: { name: "video_cloudreve_mkdir", description: "在Cloudreve创建文件夹。如「/我的电影/2026」。", parameters: { type: "object", properties: { path: { type: "string", description: "文件夹完整路径" } }, required: ["path"] } } },
    { type: "function", function: { name: "video_cloudreve_search", description: "在Cloudreve内按文件名搜索文件。", parameters: { type: "object", properties: { keyword: { type: "string", description: "搜索关键词" } }, required: ["keyword"] } } },
    { type: "function", function: { name: "video_cloudreve_url", description: "获取Cloudreve文件的临时下载链接/直链。", parameters: { type: "object", properties: { path: { type: "string", description: "文件路径,如 cloudreve://my/电影/file.mkv" } }, required: ["path"] } } },
    { type: "function", function: { name: "bili_info", description: "获取B站视频详情: 标题、UP主、播放量、简介、分P列表、封面。支持BV/AV号和b23.tv短链接。", parameters: { type: "object", properties: { bvid: { type: "string", description: "视频BV号(如BV1GJ411x7h7)或AV号或b23.tv短链接" } }, required: ["bvid"] } } },
    { type: "function", function: { name: "bili_streams", description: "获取B站视频的DASH流下载URL(视频+音频分离, 多画质可选)。返回各清晰度的直接下载链接, 可用于aria2下载。", parameters: { type: "object", properties: { bvid: { type: "string", description: "视频BV号" }, page_index: { type: "integer", description: "分P索引, 默认0(第一个P)" } }, required: ["bvid"] } } },
    { type: "function", function: { name: "bili_search_ex", description: "通过bilibili-api-python深度搜索B站(比bilibili_search更稳定)。search_type=video/user/article。", parameters: { type: "object", properties: { keyword: { type: "string", description: "搜索关键词" }, search_type: { type: "string", description: "video/user/article, 默认video" }, limit: { type: "integer", description: "返回条数, 默认10" } }, required: ["keyword"] } } },
    { type: "function", function: { name: "bili_download", description: "通过yt-dlp下载B站视频到本地。支持多画质(best/1080p/720p)。后台异步执行, 返回task_id。需要大会员的高画质需need_login=true。", parameters: { type: "object", properties: { url: { type: "string", description: "B站视频URL(如 https://www.bilibili.com/video/BV1xx411c7mD)" }, quality: { type: "string", description: "画质: best|1080p|720p, 默认best" }, save_dir: { type: "string", description: "保存目录(可选,默认/tmp/video-hunter-downloads/bilibili)" }, need_login: { type: "boolean", description: "是否需要登录Cookie获取高画质, 默认false" } }, required: ["url"] } } },
    { type: "function", function: { name: "bili_download_status", description: "查询bili_download任务的下载进度。", parameters: { type: "object", properties: { task_id: { type: "string", description: "bili_download返回的task_id" } }, required: ["task_id"] } } },
    { type: "function", function: { name: "bili_download_dash", description: "通过DASH流下载B站视频(aria2+ffmpeg, 比yt-dlp更可靠, 支持4K HDR)。后台异步执行, 返回task_id。", parameters: { type: "object", properties: { bvid: { type: "string", description: "视频BV号(如BV1GJ411x7h7)" }, quality: { type: "string", description: "画质: best|1080p|720p, 默认best" } }, required: ["bvid"] } } },
];
window.VIDEO_HUNTER_TOOLS.forEach(function(t) {
    toolRegistry.register(t.function.name, {
        name: t.function.name,
        description: t.function.description,
        capabilities: ['media', 'video-hunter'],
        approval: t.function.name === 'video_cleanup' || t.function.name.includes('download') || t.function.name.includes('upload') ? ApprovalLevel.SUGGEST : ApprovalLevel.AUTO,
        isReadOnly: t.function.name !== 'video_cleanup' && !t.function.name.includes('download') && !t.function.name.includes('upload') && !t.function.name.includes('mkdir'),
        searchHint: _vhLabels[t.function.name] || t.function.name,
    });
    toolRegistry.registerToolDefinition(t.function.name, t);
});

// ★ 高危工具(默认关闭) — 使用实际 toolName
const _DANGEROUS_TOOLS = [
    'server_exec', 'server_python', 'server_file_write',
    'browser_navigate', 'browser_screenshot', 'browser_click', 'browser_type', 'browser_get_content', 'browser_get_snapshot',
    'server_docker', 'server_db_query', 'server_file_op',
    'engine_cron_create', 'engine_cron_delete', 'engine_agent_delete'
];

// 工具默认启用状态
window.getToolDefaultEnabled = function(toolKey) {
    // 高危工具默认关闭
    if (_DANGEROUS_TOOLS.indexOf(toolKey) !== -1) return false;
    // 其他默认开启
    return true;
};

// 检查工具是否启用
window.isToolEnabled = function(toolKey) {
    // ★ YOLO 模式: 所有工具强制可用(用户已授权完全自主, 无视localStorage和危险列表)
    if (typeof getAgentMode === 'function' && getAgentMode() === 'yolo') return true;
    var stored = localStorage.getItem('tool_enabled_' + toolKey);
    if (stored !== null) return stored === 'true';
    // ★ 兼容: 检查旧大写 key (如 BILI_SEARCH_TOOL → bilibili_search)
    var _oldKey = (typeof window._toolToggleMap !== 'undefined' && window._toolToggleMap) ? null : null;
    if (!_oldKey) {
        var _oldStored = localStorage.getItem('tool_enabled_' + toolKey.toUpperCase() + '_TOOL');
        if (_oldStored !== null) return _oldStored === 'true';
    }
    return window.getToolDefaultEnabled(toolKey);
};

// 设置工具启用状态
window.setToolEnabled = function(toolKey, enabled) {
    localStorage.setItem('tool_enabled_' + toolKey, enabled ? 'true' : 'false');
};

// 加载工具开关配置到 UI
// ── 工具分类定义 ──
// ── 工具分类: match 函数自动匹配, 新增工具无需手动加 keys ──
// 渲染时从 toolRegistry.getAllToolNames() 动态拉取, 首个匹配的分类即为工具所属分类
const _TOOL_CATEGORIES = [
    { label: '🔍 搜索与获取', match: n => /^(web_search|web_fetch|platform_extract|rag_search|get_current_time)$/.test(n) },
    { label: '🎨 图像',       match: n => /^(generate_image|generate_image_i2i|analyze_image)/.test(n) },
    { label: '📺 B站',        match: n => n.startsWith('bilibili_') },
    { label: '📊 办公文档',    match: n => /^generate_(ppt|docx|xlsx|pdf)$/.test(n) },
    { label: '🎬 视频',       match: n => /^(video_understanding|video_edit|video_search|video_parse|video_download|video_download_status|video_list_downloads|video_cleanup|video_upload_cloudreve|video_cloudreve_list|video_cloudreve_mkdir|video_cloudreve_search|video_cloudreve_url|bili_info|bili_streams|bili_search_ex|bili_download|bili_download_status)$/.test(n) },
    { label: '📚 刷课',       match: n => n.startsWith('chaoxing_') && !n.includes('exam') },
    { label: '📝 考试',       match: n => n.startsWith('chaoxing_exam') },
    { label: '💻 服务器操控 ⚠️', match: n => n.startsWith('server_'), agentOnly: true },
    { label: '🤖 引擎/Agent', match: n => /^(engine_|delegate_|plan_update|run_skill)/.test(n), agentOnly: true },
    { label: '🧠 AI 自主控制', match: n => /^(ask_agent|autonomous_mode|toggle_proxy)$/.test(n) },
    { label: '🎮 SRC 星穹铁道', match: n => n.startsWith('src_') },
    { label: '🪟 Windows 本机', match: n => n.startsWith('win_'), agentOnly: true },
    { label: '☁️ Cloudreve 云盘', match: n => n.startsWith('cr_') },
    { label: '📂 网盘解析',    match: n => n.startsWith('netdisk_') && n !== 'netdisk_login' },
    { label: '🔑 网盘登录',    match: n => n === 'netdisk_login' },
    { label: '📈 股票行情',    match: n => n.startsWith('stock_') },
    { label: '🌐 浏览器',     match: n => n.startsWith('browser_'), agentOnly: true },
    { label: '📦 更多工具',    match: () => true },  // catch-all: 确保所有工具都有归属
];

// ★ 从 toolRegistry 动态获取每个分类的 tools
function getCategoryKeys(cat, _usedSet) {
    // 兼容旧格式 (keys 数组)
    if (cat.keys) return cat.keys;
    // 新格式: match 函数从 registry 过滤, 排除已分配给前面分类的工具
    var all = (typeof toolRegistry !== 'undefined' ? toolRegistry.getAllToolNames() : []);
    return all.filter(function(n) {
        if (_usedSet && _usedSet.has(n)) return false;  // 已归入前面的分类
        return cat.match(n);
    });
}

// ★ 供 renderToolPanel 使用: 确保每个工具只在一个分类出现
window.resolveToolCategories = function() {
    var cats = (typeof _TOOL_CATEGORIES !== 'undefined') ? _TOOL_CATEGORIES : [];
    var used = new Set();
    return cats.map(function(cat) {
        var keys = getCategoryKeys(cat, used);
        keys.forEach(function(k) { used.add(k); });
        return { label: cat.label, keys: keys, agentOnly: cat.agentOnly };
    }).filter(function(c) { return c.keys.length > 0; });  // 去掉空分类
};

// ── 工具中文标签 ──
const _TOOL_LABELS = {
    'web_search':'联网搜索','web_fetch':'网页抓取','platform_extract':'平台提取','run_skill':'运行技能','rag_search':'知识库搜索','get_current_time':'当前时间',
    'generate_image':'图片生成','generate_image_i2i':'图生图','analyze_image':'图片分析','video_understanding':'视频分析','video_edit':'视频剪辑','generate_ppt':'PPT生成','generate_docx':'Word文档','generate_xlsx':'Excel表格','generate_pdf':'PDF文档',
    'chaoxing_login':'超星登录','chaoxing_list_courses':'课程列表','chaoxing_auto':'刷课执行','chaoxing_status':'刷课状态','chaoxing_stop':'停止刷课','chaoxing_stats':'刷课统计','chaoxing_overview':'超星总览',
    'chaoxing_auth':'考试登录','chaoxing_qr_login':'超星扫码','chaoxing_exam_list':'考试列表','chaoxing_exam_start':'开始考试','chaoxing_exam_status':'考试状态','chaoxing_exam_stop':'停止考试',
    'server_exec':'命令执行','server_python':'Python执行','server_file_read':'文件读取','parse_document':'文档解析','server_file_write':'文件写入','server_file_edit':'精确编辑','server_file_grep':'内容搜索','server_sys_info':'系统信息','server_ps':'进程列表','server_disk':'磁盘信息','server_network':'网络状态','server_docker':'Docker','server_db_query':'数据库','server_file_search':'文件搜索','server_file_op':'文件操作',
    'engine_cron_list':'Cron列表','engine_cron_create':'创建Cron','engine_cron_delete':'删除Cron','delegate_task':'子代理任务','engine_agent_status':'子代理状态','engine_agent_list':'子代理列表','engine_agent_delete':'删除子代理','engine_agent_ask':'子代理对话','engine_agent_stop':'停止子代理','engine_push':'推送通知','plan_update':'计划更新','delegate_workflow':'工作流代理',
    'ask_agent':'请求Agent','autonomous_mode':'自主模式',
    // src_* 星穹铁道工具已移除
    'win_info':'系统信息','win_processes':'进程列表','win_kill':'结束进程','win_start':'启动程序','win_restart':'重启程序','win_file':'文件操作','win_screenshot':'屏幕截图',
    'cr_check_login':'登录检查','cr_login':'云盘登录','cr_register':'注册账号','cr_user_info':'用户信息','cr_list_files':'文件列表','cr_search_files':'搜索文件','cr_create_folder':'创建文件夹','cr_rename':'重命名','cr_move':'移动','cr_copy':'复制','cr_delete':'删除','cr_list_shares':'分享列表','cr_create_share':'创建分享','cr_delete_share':'删除分享','cr_storage_info':'存储空间','cr_overview':'云盘总览','cr_upload_file':'上传文件','cr_upload':'文本上传',
    'browser_navigate':'打开网页','browser_screenshot':'页面截图','browser_click':'点击元素','browser_type':'输入文字','browser_get_content':'提取文本','browser_get_snapshot':'DOM快照',
    'bilibili_search':'B站搜索','bilibili_video_info':'B站视频','bilibili_article_read':'B站专栏','bilibili_user_profile':'B站用户','bilibili_comment_list':'B站评论','bilibili_dynamic_list':'B站动态','bilibili_qr_login':'B站扫码登录',
    // 视频猎手 Video Hunter
    'video_search':'磁力搜索','video_parse':'解析磁力','video_download':'BT/磁力下载','video_download_status':'下载进度','video_list_downloads':'下载列表','video_cleanup':'清理残留下载','video_upload_cloudreve':'上传云盘','video_cloudreve_list':'云盘浏览','video_cloudreve_mkdir':'云盘建文件夹','video_cloudreve_search':'云盘搜索','video_cloudreve_url':'云盘链接',
    'bili_info':'B站视频信息','bili_streams':'B站流地址','bili_search_ex':'B站深度搜索','bili_download':'B站下载','bili_download_status':'B站下载进度',
    'amap_geo':'地理编码','amap_regeocode':'逆地理编码','amap_text_search':'POI搜索','amap_around_search':'周边搜索','amap_search_detail':'POI详情','amap_direction_walking':'步行路线','amap_direction_driving':'驾车路线','amap_direction_bicycling':'骑行路线','amap_direction_transit':'公交路线','amap_distance':'距离测量','amap_ip_location':'IP定位','amap_weather':'天气查询','amap_district':'行政区划','amap_schema_personal_map':'个人地图',
    // 网盘解析 Netdisk Parser
    'netdisk_parse':'解析链接','netdisk_download':'下载文件','netdisk_parse_and_download':'解析+下载','netdisk_status':'服务状态',
    // 网盘登录 Netdisk Login
    'netdisk_login':'扫码登录',
    // 股票数据 Stock Data (A股 — 东方财富)
    'stock_realtime':'实时行情','stock_kline':'历史K线','stock_sector_flow':'板块资金流',
    'stock_dragon_tiger':'龙虎榜','stock_north_flow':'北向资金','stock_diagnosis':'个股诊断',
    'stock_indicators':'技术指标','stock_chart':'K线图表','stock_market_overview':'市场概览',
};


// ==================== Windows 本机操控工具 ====================
const WIN_POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const WIN_TOOLS = [
    { type: "function", function: { name: "win_info", description: "【⚠️ 仅限Windows宿主】获取Windows宿主机系统信息。本项目运行在WSL Linux内，服务器信息用 server_sys_info / server_ps / server_disk。", parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] } } },
    { type: "function", function: { name: "win_processes", description: "【⚠️ 仅限Windows宿主】列出Windows宿主机进程。本项目进程用 server_ps 查看。", parameters: { type: "object", properties: { filter: { type: "string", description: "按进程名过滤,如 'chrome'" } }, required: [] } } },
    { type: "function", function: { name: "win_kill", description: "终止Windows宿主机上的进程。name=进程名(如StarRail.exe)或pid=进程ID,二选一", parameters: { type: "object", properties: { name: { type: "string", description: "进程名,如 'notepad.exe'" }, pid: { type: "integer", description: "进程ID" } }, required: [] } } },
    { type: "function", function: { name: "win_start", description: "启动Windows上的程序。path=可执行文件路径, app=开始菜单中的应用名(如'7-Zip File Manager')。二者任选其一。", parameters: { type: "object", properties: { path: { type: "string", description: "可执行文件路径,如 C:\\Program Files\\app.exe" }, app: { type: "string", description: "开始菜单应用名,如 '崩坏:星穹铁道' 或 '7-Zip File Manager'" } }, required: [] } } },
    { type: "function", function: { name: "win_restart", description: "重启Windows程序(先kill再start)。name=进程名(如StarRail.exe), path/app=重启后启动方式(二选一)", parameters: { type: "object", properties: { name: { type: "string", description: "要终止的进程名,如 'StarRail.exe'" }, path: { type: "string", description: "重启时启动的可执行文件路径(可选)" }, app: { type: "string", description: "重启时启动的开始菜单应用名(可选)" } }, required: ["name"] } } },
    { type: "function", function: { name: "win_file", description: "【⚠️ 仅限Windows宿主】列出/读取Windows宿主机文件(通过WSL /mnt/c/)。⚠️ 本项目运行在WSL Linux内，项目文件请用 server_file_read / server_file_search / server_file_grep，不要用此工具。", parameters: { type: "object", properties: { action: { type: "string", description: "list=列目录, read=读文件" }, path: { type: "string", description: "WSL路径如 /mnt/c/Users/AS/Desktop" } }, required: ["action","path"] } } },
    { type: "function", function: { name: "win_screenshot", description: "截取Windows桌面当前画面,返回base64图片。用于查看模拟器/游戏是否正常运行、确认操作结果。", parameters: { type: "object", properties: { format: { type: "string", description: "图片格式 png 或 jpg,默认png" } }, required: [] } } },
];

// 注册
(function() {
    WIN_TOOLS.forEach(function(t) {
        toolRegistry.register(t.function.name, {
            name: t.function.name,
            description: t.function.description,
        });
    });
})();

// ==================== Cloudreve 云盘工具 (v2.6.3: 17个工具) ====================
const CLOUDREVE_TOOLS = [
    // 认证
    { type: "function", function: { name: "cr_check_login", description: "检查Cloudreve云盘登录状态。优先调用此工具而非cr_login — 大多数情况已自动登录。返回logged_in状态和用户信息。", parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] } } },
    { type: "function", function: { name: "cr_login", description: "登录Cloudreve云盘。仅在cr_check_login返回false时需要。传入邮箱和密码获取访问令牌。", parameters: { type: "object", properties: { email: { type: "string", description: "Cloudreve注册邮箱" }, password: { type: "string", description: "Cloudreve密码" } }, required: ["email","password"] } } },
    { type: "function", function: { name: "cr_register", description: "注册新的Cloudreve云盘账号。需要邮箱和密码(至少6位)。注册后自动登录。", parameters: { type: "object", properties: { email: { type: "string", description: "邮箱" }, password: { type: "string", description: "密码(至少6位)" } }, required: ["email","password"] } } },
    { type: "function", function: { name: "cr_user_info", description: "获取当前Cloudreve用户信息（昵称、邮箱、用户组等）。", parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] } } },
    // 文件浏览
    { type: "function", function: { name: "cr_list_files", description: "列出Cloudreve云盘中的文件和文件夹。传入路径可浏览子目录，不传则显示根目录。", parameters: { type: "object", properties: { path: { type: "string", description: "目录路径, 如 'photos' 或 'photos/2024', 留空显示根目录" } }, required: [] } } },
    { type: "function", function: { name: "cr_search_files", description: "在Cloudreve云盘中搜索文件（按关键词）。", parameters: { type: "object", properties: { keyword: { type: "string", description: "搜索关键词" } }, required: ["keyword"] } } },
    // 文件操作
    { type: "function", function: { name: "cr_create_folder", description: "在Cloudreve云盘中创建文件夹。path支持顶层(aaa)或多级(aaa/bbb)路径。", parameters: { type: "object", properties: { path: { type: "string", description: "文件夹路径, 如 '视频备份' 或 'apitest/子目录'" } }, required: ["path"] } } },
    { type: "function", function: { name: "cr_rename", description: "重命名Cloudreve云盘中的文件或文件夹。", parameters: { type: "object", properties: { path: { type: "string", description: "当前路径" }, new_name: { type: "string", description: "新名称" } }, required: ["path","new_name"] } } },
    { type: "function", function: { name: "cr_move", description: "移动文件/夹到其他目录。支持批量移动（逗号分隔多个路径）。", parameters: { type: "object", properties: { paths: { type: "string", description: "源路径,逗号分隔" }, dst: { type: "string", description: "目标目录路径,根目录用空字符串" } }, required: ["paths","dst"] } } },
    { type: "function", function: { name: "cr_copy", description: "复制文件/夹。支持批量复制（逗号分隔多个路径）。", parameters: { type: "object", properties: { paths: { type: "string", description: "源路径,逗号分隔" }, dst: { type: "string", description: "目标目录路径" } }, required: ["paths","dst"] } } },
    { type: "function", function: { name: "cr_delete", description: "删除文件/夹。支持批量删除（逗号分隔多个路径）。", parameters: { type: "object", properties: { paths: { type: "string", description: "路径,逗号分隔多个" } }, required: ["paths"] } } },
    // 上传
    { type: "function", function: { name: "cr_upload_file", description: "上传服务器文件到Cloudreve云盘。支持绝对路径(/var/www/.../img.mp4)或相对路径(uploads/user_xxx/img.mp4)。大文件自动分片。视频/图片/文档均可。", parameters: { type: "object", properties: { file_path: { type: "string", description: "服务器文件路径" }, cloudreve_path: { type: "string", description: "Cloudreve目标目录" }, cloudreve_name: { type: "string", description: "上传后文件名(可选)" } }, required: ["file_path"] } } },
    { type: "function", function: { name: "cr_upload", description: "上传纯文本内容到Cloudreve。仅限小文本,大文件用cr_upload_file。", parameters: { type: "object", properties: { path: { type: "string", description: "父目录路径" }, name: { type: "string", description: "文件名" }, content: { type: "string", description: "文件内容" } }, required: ["name","content"] } } },
    // 分享
    { type: "function", function: { name: "cr_list_shares", description: "列出我创建的所有分享链接。", parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] } } },
    { type: "function", function: { name: "cr_create_share", description: "为文件/文件夹创建分享链接,可选设置密码和过期天数。", parameters: { type: "object", properties: { path: { type: "string", description: "文件/文件夹路径" }, password: { type: "string", description: "分享密码(可选)" }, expire: { type: "integer", description: "过期天数(0=永久)" } }, required: ["path"] } } },
    { type: "function", function: { name: "cr_delete_share", description: "删除分享链接。", parameters: { type: "object", properties: { id: { type: "string", description: "分享链接ID" } }, required: ["id"] } } },
    // 存储
    { type: "function", function: { name: "cr_storage_info", description: "查看Cloudreve存储使用情况（已用/总量/剩余空间）。", parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] } } },
    { type: "function", function: { name: "cr_overview", description: "Cloudreve总览：用户信息、存储空间、文件统计、分享数量、服务器版本。", parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "unused"}}, required: [] } } },
];

// ==================== SRC (StarRailCopilot) 操控工具 ====================
// ★ SRC_TOOLS 已移除 (星穹铁道功能弃用, 入口改为 Cloudreve 云盘)
console.log('[ToolRegistry] 全部注册完成, 共', Object.keys(toolRegistry.getAllToolNames()).length, '个工具');

// ==================== Cloudreve 工具注册 ====================
(function() {
    CLOUDREVE_TOOLS.forEach(function(t) {
        toolRegistry.register(t.function.name, {
            name: t.function.name,
            description: t.function.description,
        });
    });
})();
// ★ B站工具组
const BILIBILI_TOOLS_FE = [
    { name: "bilibili_video_info", description: "获取B站视频详情(标题/UP主/播放量/弹幕/分P)", capabilities: ["fetch"], approval: 0, isReadOnly: true, searchHint: '查B站视频信息' },
    { name: "bilibili_article_read", description: "阅读B站专栏文章全文", capabilities: ["fetch"], approval: 0, isReadOnly: true, searchHint: '读B站专栏' },
    { name: "bilibili_search", description: "综合搜索B站内容(视频/专栏/用户)", capabilities: ["fetch"], approval: 0, isReadOnly: true, searchHint: '搜索B站' },
    { name: "bilibili_user_profile", description: "获取B站用户主页(昵称/粉丝/投稿)", capabilities: ["fetch"], approval: 0, isReadOnly: true, searchHint: '查B站用户' },
    { name: "bilibili_comment_list", description: "获取B站视频/专栏评论", capabilities: ["fetch"], approval: 0, isReadOnly: true, searchHint: '看B站评论' },
    { name: "bilibili_dynamic_list", description: "获取B站关注动态流", capabilities: ["fetch"], approval: 0, isReadOnly: true, searchHint: 'B站动态' },
    { name: "bilibili_qr_login", description: "B站扫码登录(生成二维码/检测登录状态)", capabilities: ["fetch"], approval: 0, isReadOnly: false, searchHint: 'B站扫码' },
];
BILIBILI_TOOLS_FE.forEach(function(t) {
    if (!toolRegistry.has(t.name)) {
        toolRegistry.register(t.name, buildToolMeta(t.name, {
            capabilities: t.capabilities,
            approval: t.approval,
            isReadOnly: t.isReadOnly,
            searchHint: t.searchHint,
        }));
    }
});

// ★ 高德地图工具组 (基于 ClawHub @lbs-amap personal-map Skill 自动生成)
window.AMAP_MAPS_TOOLS = [
    { type: "function", function: { name: "amap_geo", description: "地理编码: 将结构化地址转换为经纬度坐标。支持地标性名胜景区、建筑物名称解析。参数: address(必填,地址), city(可选,城市名)。", parameters: { type: "object", properties: { address: { type: "string", description: "待解析的结构化地址, 如 '北京市朝阳区阜通东大街6号'" }, city: { type: "string", description: "指定查询的城市, 用于提高准确性" } }, required: ["address"] } } },
    { type: "function", function: { name: "amap_regeocode", description: "逆地理编码: 将经纬度坐标转换为行政区划地址信息。参数: location(必填,格式'经度,纬度')。", parameters: { type: "object", properties: { location: { type: "string", description: "经纬度坐标, 格式为 '经度,纬度', 如 '116.482384,39.998383'" } }, required: ["location"] } } },
    { type: "function", function: { name: "amap_text_search", description: "关键词POI搜索: 根据关键字搜索兴趣点(地点)。参数: keywords(必填,搜索词), city(可选,城市名), offset(可选,返回数量,默认20)。", parameters: { type: "object", properties: { keywords: { type: "string", description: "搜索关键词, 如 '麦当劳' 或 '烤鸭 北京'" }, city: { type: "string", description: "查询城市" }, offset: { type: "number", description: "每页记录数(默认20,最大100)" } }, required: ["keywords"] } } },
    { type: "function", function: { name: "amap_around_search", description: "周边POI搜索: 根据中心点坐标和关键词搜索附近的兴趣点。参数: location(必填,中心点'经度,纬度'), keywords(可选,搜索词), radius(可选,搜索半径米,默认1000), types(可选,POI类型)。", parameters: { type: "object", properties: { location: { type: "string", description: "中心点坐标, 格式 '经度,纬度'" }, keywords: { type: "string", description: "搜索关键词, 如 '餐厅' 或 '加油站'" }, radius: { type: "number", description: "搜索半径(米), 默认1000" }, types: { type: "string", description: "POI类型编码, 如 '050000' 代表餐饮服务" } }, required: ["location"] } } },
    { type: "function", function: { name: "amap_direction_bicycling", description: "骑行路径规划: 规划两点之间的骑行通勤方案(≤500km,考虑天桥/单行线/封路)。参数: origin(必填,起点'经度,纬度'), destination(必填,终点'经度,纬度')。", parameters: { type: "object", properties: { origin: { type: "string", description: "起点坐标, 格式 '经度,纬度'" }, destination: { type: "string", description: "终点坐标, 格式 '经度,纬度'" } }, required: ["origin","destination"] } } },
    { type: "function", function: { name: "amap_distance", description: "距离测量: 测量两个经纬度坐标之间的距离。支持驾车(1)/直线(0)/步行(3)。参数: origins(必填,起点'经度,纬度',可多个竖线分隔), destination(必填,终点'经度,纬度'), type(可选,测量类型0/1/3,默认1)。", parameters: { type: "object", properties: { origins: { type: "string", description: "起点坐标, 格式 '经度,纬度', 多个用竖线分隔" }, destination: { type: "string", description: "终点坐标, 格式 '经度,纬度'" }, type: { type: "string", description: "测量类型: 0=直线距离, 1=驾车距离(默认), 3=步行距离" } }, required: ["origins","destination"] } } },
    { type: "function", function: { name: "amap_search_detail", description: "POI详情查询: 根据POI ID查询详细信息(名称/地址/电话/类型/营业时间等)。参数: id(必填,POI ID,来自text_search或around_search结果)。", parameters: { type: "object", properties: { id: { type: "string", description: "POI ID, 来自搜索结果中的 id 字段" } }, required: ["id"] } } },
    { type: "function", function: { name: "amap_direction_walking", description: "步行路径规划: 规划两点之间的步行通勤方案(≤100km)。参数: origin(必填,起点'经度,纬度'), destination(必填,终点'经度,纬度')。", parameters: { type: "object", properties: { origin: { type: "string", description: "起点坐标, 格式 '经度,纬度'" }, destination: { type: "string", description: "终点坐标, 格式 '经度,纬度'" } }, required: ["origin","destination"] } } },
    { type: "function", function: { name: "amap_direction_driving", description: "驾车路径规划: 规划两点之间的驾车出行方案(考虑实时路况)。参数: origin(必填,起点'经度,纬度'), destination(必填,终点'经度,纬度')。", parameters: { type: "object", properties: { origin: { type: "string", description: "起点坐标, 格式 '经度,纬度'" }, destination: { type: "string", description: "终点坐标, 格式 '经度,纬度'" } }, required: ["origin","destination"] } } },
    { type: "function", function: { name: "amap_direction_transit", description: "公共交通路径规划: 规划综合公交/地铁/火车通勤方案。参数: origin(必填,起点'经度,纬度'), destination(必填,终点'经度,纬度'), city(可选,城市名,默认'北京')。", parameters: { type: "object", properties: { origin: { type: "string", description: "起点坐标, 格式 '经度,纬度'" }, destination: { type: "string", description: "终点坐标, 格式 '经度,纬度'" }, city: { type: "string", description: "城市名, 默认'北京'" } }, required: ["origin","destination"] } } },
    { type: "function", function: { name: "amap_ip_location", description: "IP定位: 根据IP地址获取所在地理位置(省份/城市/ISP)。参数: ip(必填,IP地址)。", parameters: { type: "object", properties: { ip: { type: "string", description: "IP地址, 如 '114.114.114.114'" } }, required: ["ip"] } } },
    { type: "function", function: { name: "amap_weather", description: "天气查询: 查询指定城市的实时天气或天气预报。参数: city(必填,城市名或adcode), extensions(可选,'base'=实时,'all'=预报,默认'base')。", parameters: { type: "object", properties: { city: { type: "string", description: "城市名称或adcode, 如 '北京' 或 '110000'" }, extensions: { type: "string", description: "'base'=实时天气, 'all'=天气预报, 默认'base'" } }, required: ["city"] } } },
    { type: "function", function: { name: "amap_district", description: "行政区划查询: 查询省/市/区/街道的行政区划信息(含adcode和边界)。用于获取城市adcode以支持天气查询等场景。参数: keywords(必填,城市或区域名), subdistrict(可选,下级行政区级数,默认0)。", parameters: { type: "object", properties: { keywords: { type: "string", description: "城市或区域名称, 如 '北京市' 或 '海淀区'" }, subdistrict: { type: "number", description: "返回下级行政区级数(0=不返回下级,默认0)" } }, required: ["keywords"] } } },
    { type: "function", function: { name: "amap_schema_personal_map", description: "生成高德个人地图小程序二维码: 将多个地点/路线合成为一张个人专属地图,生成可扫码打开的二维码。参数: orgName(必填,地图名称), lineList(必填,地点/路线数组[{title,pointInfoList:[{name,lon,lat,poiId}]}]), sceneType(可选,1=点+路线,2=仅点,3=仅路线,默认1)。", parameters: { type: "object", properties: { orgName: { type: "string", description: "地图/行程名称, 如 '北京一日游'" }, lineList: { type: "string", description: "行程列表JSON, 格式 [{title:'标题',pointInfoList:[{name:'地点名',lon:116.39,lat:39.90,poiId:'可选'}]}]" }, sceneType: { type: "number", description: "场景类型: 1=创建点+路线, 2=仅创建点(搜索类), 3=仅创建路线(路径规划类)" } }, required: ["orgName","lineList"] } } },
];
AMAP_MAPS_TOOLS.forEach(function(t) {
    toolRegistry.register(t.function.name, {
        name: t.function.name,
        description: t.function.description,
        capabilities: ['fetch', 'amap'],
        approval: ApprovalLevel.AUTO,
        isReadOnly: true,
        searchHint: '高德地图',
    });
    toolRegistry.registerToolDefinition(t.function.name, t);  // ★ 注册工具定义
});

// ★ 网盘解析工具组 (Netdisk Parser — 解析+下载主流网盘分享链接)
window.NETDISK_TOOLS = [
    { type: "function", function: { name: "netdisk_parse", description: "解析网盘分享链接,获取直链下载地址。支持百度网盘(pan.baidu.com)、夸克网盘(pan.quark.cn)、阿里云盘(alipan.com/aliyundrive.com)、天翼云盘(cloud.189.cn)、迅雷网盘、移动网盘(yun.139.com)、UC网盘(drive.uc.cn)、123网盘、蓝奏云(lanzou/ilanzou)、小飞机网盘(feijipan.com)、光鸭云盘(guangyapan.com)等。参数: url(必填,分享链接), password(可选,提取码)。", parameters: { type: "object", properties: { url: { type: "string", description: "网盘分享链接" }, password: { type: "string", description: "提取码/密码" } }, required: ["url"] } } },
    { type: "function", function: { name: "netdisk_download", description: "下载网盘文件到服务器。url可传分享链接(夸克/百度/阿里等，服务端自动解析并保留动态会话)或文件直链；大于512MB的文件会进入后台队列，返回job_id后调用netdisk_status(job_id)查询。下载完成后文件位于uploads/downloads/。参数: url(必填), password(可选,分享提取码), filename(可选), output_dir(可选), threads(可选,默认16)。", parameters: { type: "object", properties: { url: { type: "string", description: "分享链接或文件直链URL" }, password: { type: "string", description: "分享提取码" }, filename: { type: "string", description: "保存文件名" }, output_dir: { type: "string", description: "下载目录" }, threads: { type: "number", description: "下载线程数, 默认16" } }, required: ["url"] } } },
    { type: "function", function: { name: "netdisk_parse_and_download", description: "一键解析网盘链接并下载到服务器。夸克直链自动携带动态Cookie/Referer/UA；大于512MB的文件进入后台队列并返回job_id，必须继续调用netdisk_status(job_id)直到completed。参数: url(必填,分享链接), password(可选,提取码), filename(可选), output_dir(可选), threads(可选,默认16)。", parameters: { type: "object", properties: { url: { type: "string", description: "网盘分享链接" }, password: { type: "string", description: "提取码/密码" }, filename: { type: "string", description: "保存文件名" }, output_dir: { type: "string", description: "下载目录" }, threads: { type: "number", description: "下载线程数, 默认16" } }, required: ["url"] } } },
    { type: "function", function: { name: "netdisk_status", description: "查询网盘解析/下载服务状态；传job_id时查询后台大文件下载进度，status=completed后文件已保存到uploads/downloads/。", parameters: { type: "object", properties: { job_id: { type: "string", description: "netdisk_download或netdisk_parse_and_download返回的后台任务ID" } }, required: [] } } },
];
NETDISK_TOOLS.forEach(function(t) {
    toolRegistry.register(t.function.name, {
        name: t.function.name,
        description: t.function.description,
        capabilities: ['fetch', 'netdisk'],
        approval: ApprovalLevel.AUTO,
        isReadOnly: false,
        searchHint: '网盘解析',
    });
    toolRegistry.registerToolDefinition(t.function.name, t);  // ★ 注册工具定义
});

// ★ 网盘登录工具 (扫码登录获取Cookie)
window.NETDISK_LOGIN_TOOLS = [
    { type: "function", function: { name: "netdisk_login", description: "网盘扫码登录,获取Cookie/Token用于解析和下载。支持百度网盘(baidu)、夸克网盘(quark)、阿里云盘(aliyun)。action=check检查登录状态, action=qr生成二维码, action=poll轮询扫码状态。⚠️流程纪律: qr只调用一次; 二维码展示方式: 网页端由界面自动展示, 若工具返回中包含qr_image_base64或qr_image_url则说明需要你在回复中直接输出图片给用户(第三方API客户端场景); 然后反复调用poll等待扫码——poll返回status=waiting是正常状态(用户还没扫码), 必须继续poll而不是重新生成二维码; 严禁在等待扫码期间重复调用qr。", parameters: { type: "object", properties: { action: { type: "string", description: "动作: check=检查状态, qr=生成二维码(只调用一次), poll=轮询状态(反复调用直到logged_in)", enum: ["check", "qr", "poll"] }, service: { type: "string", description: "网盘类型: baidu|quark|aliyun", enum: ["baidu", "quark", "aliyun"] }, sign: { type: "string", description: "百度: poll时传入qr返回的sign" }, qr_token: { type: "string", description: "夸克: poll时传入qr返回的qr_token" }, ck_code: { type: "string", description: "阿里: poll时传入qr返回的ck_code" } }, required: ["action", "service"] } } },
];
window.NETDISK_LOGIN_TOOLS.forEach(function(t) {
    toolRegistry.register(t.function.name, {
        name: t.function.name,
        description: t.function.description,
        capabilities: ['fetch', 'netdisk-login'],
        approval: ApprovalLevel.AUTO,
        isReadOnly: false,
        searchHint: '网盘登录',
    });
    toolRegistry.registerToolDefinition(t.function.name, t);
});

// ★ 全球金融数据工具组 (A股/美股/港股/全球指数 — 东方财富+腾讯+新浪冗余数据源)
window.STOCK_TOOLS = [
    { type: "function", function: { name: "stock_realtime", description: "获取股票与指数实时行情。★ 全面支持 A股(如 000001, 600519), 美股股票(如 NVDA, AAPL, TSLA, AMD, TSM, MU, BABA), 美股主要指数(如 SOX 费城半导体, IXIC 纳斯达克, NDX 纳指100, SPX 标普500, DJI 道琼斯, RUT 罗素2000), 港股(如 00700, 09988), 全球股指(如 N225, HSI)。返回价格、涨跌幅、涨跌额、振幅、美东/北京时间戳、市场开闭盘状态。", parameters: { type: "object", properties: { symbol: { type: "string", description: "股票或指数代码, 如 SOX(费半), IXIC(纳指), SPX(标普), NVDA, AAPL, 000001, 600519, 00700" } }, required: ["symbol"] } } },
    { type: "function", function: { name: "stock_kline", description: "获取历史K线数据(OHLCV+涨跌幅)。支持 A股、美股、港股及全球主流指数。period=daily/weekly/monthly/5/15/30/60(分钟), adjust=qfq(前复权)/hfq(后复权)/none(不复权), count=条数(默认120)。也可指定start/end(YYYYMMDD格式日期范围)。", parameters: { type: "object", properties: { symbol: { type: "string", description: "股票或指数代码" }, period: { type: "string", description: "周期: daily(日K,默认)/weekly/monthly/5/15/30/60(分钟K)", enum: ["daily", "weekly", "monthly", "5", "15", "30", "60"] }, start: { type: "string", description: "起始日期 YYYYMMDD, 如 20260101" }, end: { type: "string", description: "结束日期 YYYYMMDD, 如 20260730" }, adjust: { type: "string", description: "复权: qfq(前复权)/hfq(后复权)/none(不复权), 不传默认qfq", enum: ["qfq", "hfq", "none"] }, count: { type: "integer", description: "获取条数, 默认120" } }, required: ["symbol"] } } },
    { type: "function", function: { name: "stock_sector_flow", description: "获取行业/概念板块资金流向(主力净流入/超大单/大单/中单/小单)。sector_type=2(行业板块,默认)或3(概念板块)。返回TOP30板块。", parameters: { type: "object", properties: { sector_type: { type: "string", description: "2=行业板块(默认), 3=概念板块", enum: ["2", "3"] } }, required: [] } } },
    { type: "function", function: { name: "stock_dragon_tiger", description: "获取龙虎榜数据(机构/游资买入卖出明细)。date=YYYYMMDD, 默认今天。返回上榜个股的净买入额/买入额/卖出额/上榜理由。", parameters: { type: "object", properties: { date: { type: "string", description: "日期 YYYYMMDD, 如 20260730, 默认今天" } }, required: [] } } },
    { type: "function", function: { name: "stock_north_flow", description: "获取北向资金(沪深股通)实时净流入数据。返回沪股通/深股通各自的净流入额和总额。", parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "无参数,保留字段"}}, required: [] } } },
    { type: "function", function: { name: "stock_diagnosis", description: "获取个股综合诊断(价格/涨跌幅/PE/PB/换手率/市值等关键指标一览)。支持A股/美股/港股。", parameters: { type: "object", properties: { symbol: { type: "string", description: "股票代码" } }, required: ["symbol"] } } },
    { type: "function", function: { name: "stock_indicators", description: "计算技术指标(MA5/10/20/60, MACD, KDJ, RSI6/12/24, 布林带)。支持A股/美股/港股/全球指数。返回最近5个周期的指标值, 可用于判断买卖信号。", parameters: { type: "object", properties: { symbol: { type: "string", description: "股票代码" }, count: { type: "integer", description: "计算所用K线条数, 默认120" } }, required: ["symbol"] } } },
    { type: "function", function: { name: "stock_chart", description: "生成K线技术分析图(PNG), 含K线+均线+成交量+MACD。支持 A股、美股股票、港股与全球指数。返回图片URL可直接在对话中展示。period=daily/weekly/monthly, count=条数(默认60), indicators=ma,macd,volume(可组合)。", parameters: { type: "object", properties: { symbol: { type: "string", description: "股票或指数代码, 如 SOX, NVDA, 000001, 600519" }, period: { type: "string", description: "周期: daily(默认)/weekly/monthly", enum: ["daily", "weekly", "monthly"] }, count: { type: "integer", description: "K线条数, 默认60" }, adjust: { type: "string", description: "复权: qfq(前复权,默认)/hfq(后复权)/none(不复权)", enum: ["qfq", "hfq", "none"] }, indicators: { type: "string", description: "显示指标: ma,macd,volume 组合(默认全部)", enum: ["ma,macd,volume", "ma,volume", "ma,macd", "ma"] } }, required: ["symbol"] } } },
    { type: "function", function: { name: "stock_market_overview", description: "获取全球主要指数实时全景行情看板。★ 一键返回美股核心指数(道琼斯/标普500/纳斯达克/纳指100/费城半导体SOX)、A股各大指数(上证/深证/创业板/科创50)、港股指数(恒生/恒科)及全球外盘实时涨跌幅与点位。回答宏观大盘或全球科技股动向时必须优先调用。", parameters: { type: "object", properties: {"_dummy": {"type": "string", "description": "无参数,保留字段"}}, required: [] } } },
];
window.STOCK_TOOLS.forEach(function(t) {
    toolRegistry.register(t.function.name, {
        name: t.function.name,
        description: t.function.description,
        capabilities: ['fetch', 'stock'],
        approval: ApprovalLevel.AUTO,
        isReadOnly: true,
        searchHint: '股票行情',
    });
    toolRegistry.registerToolDefinition(t.function.name, t);
});

// ★ 所有工具注册完毕后刷新分类和标签

// ==================== MCP 工具注册 ====================
// 批量注册来自 MCP 服务器的工具，标记来源服务器
window.registerMcpTools = function(serverId, serverName, tools) {
    if (!Array.isArray(tools) || tools.length === 0) return;
    tools.forEach(function(t) {
        var name = t.name || '';
        if (!name) return;
        // 如果已存在同名工具且不是来自该 MCP 服务器，则跳过 (本机原生工具优先)
        if (typeof toolRegistry !== 'undefined' && toolRegistry.has(name)) {
            var existingMeta = toolRegistry.get(name);
            if (!existingMeta || existingMeta.mcpServerId !== serverId) {
                return;
            }
        }
        var meta = {
            name: name,
            description: t.description || '',
            capabilities: ['mcp'],
            approval: ApprovalLevel.SUGGEST,  // MCP 工具默认建议审批 (外部来源)
            isReadOnly: false,
            isAgentOnly: false,
            searchHint: serverName + ': ' + name,
            mcpServer: serverName,      // ★ 标记来源服务器名
            mcpServerId: serverId,      // ★ 标记来源服务器 ID
        };
        toolRegistry.register(name, meta);
        // 注册工具定义 (OpenAI function 格式)
        toolRegistry.registerToolDefinition(name, {
            type: 'function',
            function: {
                name: name,
                description: t.description || '',
                parameters: t.inputSchema || { type: 'object', properties: {} },
            }
        });
    });
};

// ==================== 动态 MCP 分类 ====================
// resolveToolCategories() 末尾追加: 收集未归类的 MCP 工具，按服务器名分组
var _originalResolveToolCategories = window.resolveToolCategories;
window.resolveToolCategories = function() {
    var cats = _originalResolveToolCategories();
    var used = new Set();
    cats.forEach(function(c) { c.keys.forEach(function(k) { used.add(k); }); });

    // 收集所有带 mcpServer 标记但未归类的工具
    var mcpGroups = {};
    var allNames = (typeof toolRegistry !== 'undefined' ? toolRegistry.getAllToolNames() : []);
    allNames.forEach(function(n) {
        if (used.has(n)) return;
        var meta = toolRegistry.get(n);
        if (meta && meta.mcpServer && meta.mcpServerId) {
            var srv = meta.mcpServer;
            if (!mcpGroups[srv]) mcpGroups[srv] = { keys: [], serverId: meta.mcpServerId };
            mcpGroups[srv].keys.push(n);
        }
    });

    // 按服务器名排序，追加到分类列表末尾
    Object.keys(mcpGroups).sort().forEach(function(srv) {
        cats.push({
            label: '🔌 MCP: ' + srv,
            keys: mcpGroups[srv].keys,
            agentOnly: false,
            isMcp: true,            // ★ 标记为 MCP 分类
            mcpServerId: mcpGroups[srv].serverId,
        });
    });

    return cats;
};
