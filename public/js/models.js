// ═══════════════════════════════════════════════════════════════
//  OneAPIChat — 模型专属适配配置
//  每个模型单独一个配置对象，按模型名称前缀匹配
//  未匹配到任何配置的模型使用 DEFAULT_CONFIG
// ═══════════════════════════════════════════════════════════════

window.MODEL_CONFIGS = (function() {

// ===== 特殊参数支持标记 =====
const S = {
    TOOLS:        'tools',         // 支持工具/函数调用
    VISION:       'vision',        // 支持图片输入(image_url)
    REASONING:    'reasoning',     // 有 reasoning_content
    REASON_EFFORT:'reasonEffort',  // 支持 reasoning_effort 参数
    STREAM:       'stream',        // 支持流式输出
    PARALLEL_TOOL:'parallelTool',  // 支持 parallel_tool_calls
    TEMP:         'temperature',   // 支持 temperature
    TOP_P:        'topP',          // 支持 top_p
    PRES_PENALTY: 'presPenalty',   // 支持 presence_penalty
    FREQ_PENALTY: 'freqPenalty',   // 支持 frequency_penalty
    STOP:         'stop',          // 支持 stop 参数
    RESP_FORMAT:  'respFormat',    // 支持 response_format (JSON mode)
    LOGPROBS:     'logProbs',      // 支持 logprobs
    SEED:         'seed',          // 支持 seed
    USER:         'user',          // 支持 user
    MAX_TOKENS_BUDGET: 'maxTokensBudget', // 支持 max_tokens 作为总预算(如Claude)
    MAX_COMP_TOKENS: 'maxCompletionTokens', // 使用 max_completion_tokens 而非 max_tokens (o1/o3)
    THINKING_LEVEL:  'thinkingLevel',  // 支持思考强度分级 (off~ultra)
};

// ═══════════════════════════════════════════════════════════════
// 思考强度分级映射 (统一 6 档 → 各提供商原生参数)
// ═══════════════════════════════════════════════════════════════
// 各提供商映射值：OpenAI=reasoning_effort, Claude=output_config.effort,
// Gemini=thinking_level, DeepSeek=reasoning_effort, LongCat/MiniMax=thinking.type
var THINKING_INTENSITY_MAP = {
    off:    { openai: null,      claude: null,      gemini: null,      binary: 'disabled' },
    low:    { openai: 'low',     claude: 'low',     gemini: 'low',     binary: 'enabled' },
    medium: { openai: 'medium',  claude: 'medium',  gemini: 'medium',  binary: 'enabled' },
    high:   { openai: 'high',    claude: 'high',    gemini: 'high',    binary: 'enabled' },
    max:    { openai: 'high',    claude: 'xhigh',   gemini: 'high',    binary: 'enabled' },
    // ultra: OpenAI/Gemini 上限为 high (映射到其天花板), Claude→max, DeepSeek→max
    ultra:  { openai: 'high',    claude: 'max',     gemini: 'high',    binary: 'enabled' },
};

// ===== 模型配置构建器 =====
function cfg(opts) {
    return Object.assign({
        supports: [],
        // 需要特殊处理的参数黑名单(API不支持时自动移除)
        bannedParams: [],
        // 需要特殊处理的 body 键黑名单
        bannedBodyKeys: [],
        // 额外的 body 参数(合并到请求体)
        extraBody: {},
        // 消息格式化(custom 表示需要特殊处理)
        messageFormat: 'openai',
        // 工具调用格式
        toolCallFormat: 'openai',
        // 最大上下文长度
        contextWindow: 131072,
        // 最大输出 tokens(0表示使用 contextWindow)
        maxOutputTokens: 0,
        // 安全的 max_tokens 估算余量
        safetyMargin: 1024,
        // 默认 temperature
        defaultTemp: 0.7,
        // 默认 max_tokens
        defaultMaxTokens: 4096,
        // 默认 top_p
        defaultTopP: 1,
        // 禁止的参数列表(这些参数在请求中会被删除)
        bannedFromBody: [],
        // 需要从 messages 中清理的字段
        cleanMsgFields: [],
        // 是否使用特殊的 reasoning 处理
        reasoningMode: null,
        // 默认搜索模型
        defaultSearchModel: null,
        // 用于帮助模型理解的别名字段
        alias: [],
    }, opts);
}

// ===== 模型配置列表 =====
// 按优先级排序: 精确匹配优先于通配匹配
const configs = [

    // ──────────── DeepSeek 系列 ────────────

    // DeepSeek V4 Flash — 2026年最新 (1M 上下文, 384K 输出)
    // 推理方式: reasoning_effort (low/medium/high/max) + 通过 extra_body 传 thinking type
    // 工具调用格式: <｜DSML｜tool_calls> XML (但API也兼容 OpenAI format)
    cfg({
        match: ['deepseek-v4-flash'],
        supports: [S.TOOLS, S.REASON_EFFORT, S.THINKING_LEVEL, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.LOGPROBS, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['logit_bias', 'user', 'max_completion_tokens', 'parallel_tool_calls'],
        contextWindow: 1000000,
        maxOutputTokens: 384000,  // ★ DeepSeek V4 官方上限 384K
        safetyMargin: 8192,
        defaultMaxTokens: 8192,
        alias: ['deepseek', 'ds-v4-flash'],
    }),

    // DeepSeek V4 Pro — 推理方式同上 (1M 上下文, 384K 输出)
    cfg({
        match: ['deepseek-v4-pro'],
        supports: [S.TOOLS, S.REASON_EFFORT, S.THINKING_LEVEL, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.LOGPROBS, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['logit_bias', 'user', 'max_completion_tokens', 'parallel_tool_calls'],
        contextWindow: 1000000,
        maxOutputTokens: 384000,  // ★ DeepSeek V4 官方上限 384K
        safetyMargin: 8192,
        defaultMaxTokens: 8192,
        alias: ['deepseek-v4'],
    }),

    // DeepSeek Chat (V3)
    cfg({
        match: ['deepseek-chat', 'deepseek-v3'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.SEED],
        bannedParams: ['logit_bias', 'user', 'reasoning_effort', 'max_completion_tokens'],
        contextWindow: 131072,
        maxOutputTokens: 131072,  // ★ DeepSeek V3 实际支持 131072 输出
        defaultMaxTokens: 4096,
        alias: ['ds-chat', 'deepseek-v3'],
    }),

    // DeepSeek Reasoner (R1) — 不支持工具调用，有 reasoning
    cfg({
        match: ['deepseek-reasoner', 'deepseek-r1', 'deepseek-r1-'],
        supports: [S.REASONING, S.STREAM, S.TEMP, S.STOP],
        bannedParams: ['tools', 'tool_choice', 'top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'response_format', 'reasoning_effort'],
        bannedBodyKeys: ['tools', 'tool_choice'],
        contextWindow: 131072,
        // ★ DeepSeek API max_tokens 上限 131072
        maxOutputTokens: 131072,
        safetyMargin: 4096,
        defaultMaxTokens: 4096,
        defaultTemp: 0.6,
        reasoningMode: 'thinking',
        // 禁用 tools — 在无工具列表中预置
        noToolsBuiltin: true,
    }),

    // ──────────── OpenAI 系列 ────────────

    // GPT-4o / GPT-4o-mini — 原生多模态 (官方确认支持 image_url)
    cfg({
        match: ['gpt-4o', 'gpt-4o-mini', 'gpt-4o-', 'chatgpt-4o'],
        supports: [S.TOOLS, S.VISION, S.REASON_EFFORT, S.THINKING_LEVEL, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.RESP_FORMAT, S.LOGPROBS, S.SEED, S.PARALLEL_TOOL],
        contextWindow: 128000,
        maxOutputTokens: 16384,
        defaultMaxTokens: 4096,
        alias: ['gpt-4'],
    }),

    // GPT-4 Turbo / GPT-4
    cfg({
        match: ['gpt-4-turbo', 'gpt-4-', 'gpt-4'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.RESP_FORMAT, S.LOGPROBS, S.SEED],
        contextWindow: 128000,
        maxOutputTokens: 4096,
        defaultMaxTokens: 4096,
        alias: ['gpt-4'],
    }),

    // GPT-3.5 Turbo
    cfg({
        match: ['gpt-3.5', 'gpt-3'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.RESP_FORMAT, S.SEED],
        contextWindow: 16385,
        maxOutputTokens: 4096,
        defaultMaxTokens: 2048,
    }),

    // o3 — 支持 vision (官方确认 text+image 输入), 使用 max_completion_tokens
    cfg({
        match: ['o3-', 'o3'],
        supports: [S.TOOLS, S.VISION, S.REASONING, S.THINKING_LEVEL, S.STOP, S.MAX_COMP_TOKENS],
        bannedParams: ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'stream', 'response_format', 'max_tokens'],
        bannedBodyKeys: ['stream', 'max_tokens'],
        contextWindow: 200000,
        maxOutputTokens: 100000,
        safetyMargin: 4096,
        defaultMaxTokens: 8192,
        reasoningMode: 'thinking',
        alias: ['openai-o3'],
    }),

    // o1 / o1-mini (推理系列) — 不支持 vision, 使用 max_completion_tokens
    // 注意: tool 定义中参数必须都在 required 数组中(strict:true 兼容问题)
    cfg({
        match: ['o1-', 'o1'],
        supports: [S.TOOLS, S.REASONING, S.THINKING_LEVEL, S.STOP, S.MAX_COMP_TOKENS],
        bannedParams: ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'stream', 'response_format', 'max_tokens'],
        bannedBodyKeys: ['stream', 'max_tokens'],
        contextWindow: 200000,
        maxOutputTokens: 100000,
        safetyMargin: 4096,
        defaultMaxTokens: 4096,
        reasoningMode: 'thinking',
        alias: ['openai-o'],
    }),

    // GPT Image 模型 (OpenRouter) — 不支持工具调用，图片输出需要大量 token
    cfg({
        match: ['gpt-5.4-image', 'gpt-4o-image', 'gpt-image'],
        supports: [S.VISION, S.STREAM],
        bannedParams: ['tools', 'tool_choice', 'parallel_tool_calls', 'reasoning_effort',
            'presence_penalty', 'frequency_penalty', 'logit_bias', 'response_format',
            'logprobs', 'top_logprobs', 'seed', 'user', 'stop'],
        bannedBodyKeys: ['tools', 'tool_choice'],
        contextWindow: 256000,
        maxOutputTokens: 256000,
        safetyMargin: 8192,
        defaultMaxTokens: 256000,
        noToolsBuiltin: true,
    }),

    // GPT-5 系列 — 原生多模态 (官方确认全部支持 image_url)
    // GPT-5.4/5.5/5.6 上下文 1.05M, 输出 128K; GPT-5/5.1/5.2 上下文 200K, 输出 100K
    // GPT-5.1 默认 reasoning_effort=none; GPT-5-Pro 仅支持 reasoning_effort=high
    cfg({
        match: ['gpt-5.4', 'gpt-5.5', 'gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
        supports: [S.TOOLS, S.VISION, S.REASON_EFFORT, S.THINKING_LEVEL, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL, S.MAX_COMP_TOKENS],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logit_bias', 'response_format', 'max_tokens'],
        bannedBodyKeys: ['max_tokens'],
        contextWindow: 1050000,
        maxOutputTokens: 128000,
        safetyMargin: 4096,
        defaultMaxTokens: 8192,
        alias: ['gpt-5.6', 'openai-gpt-5'],
    }),

    // GPT-5 / GPT-5.1 / GPT-5.2 / GPT-5-pro
    cfg({
        match: ['gpt-5', 'gpt-5.1', 'gpt-5.2', 'gpt-5-pro'],
        supports: [S.TOOLS, S.VISION, S.REASON_EFFORT, S.THINKING_LEVEL, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL, S.MAX_COMP_TOKENS],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logit_bias', 'response_format', 'max_tokens'],
        bannedBodyKeys: ['max_tokens'],
        contextWindow: 200000,
        maxOutputTokens: 100000,
        safetyMargin: 4096,
        defaultMaxTokens: 8192,
        alias: ['gpt-5', 'openai-gpt-5'],
    }),

    // ──────────── Anthropic Claude (通过代理 OpenAI 兼容) ────────────
    // 通过 one-api 等中转的 Claude 通常走 messages API 转 OpenAI 格式
    // 原生 Claude API 不支持: top_p, presence_penalty, frequency_penalty, logprobs, logit_bias, seed, user
    // Claude 原生使用 thinking: {type: "enabled", budget_tokens: N} 而非 reasoning_effort
    // Claude Opus 4.7/Opus 4.6/Sonnet 4.6 支持 extended thinking (300k via batch)

    // Claude 5 系列 (2026最新) — 1M 上下文, 128K 输出
    cfg({
        match: ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.THINKING_LEVEL, S.STOP, S.MAX_TOKENS_BUDGET, S.PARALLEL_TOOL],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort', 'temperature'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'temperature', 'reasoning_effort'],
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        defaultMaxTokens: 8192,
        alias: ['claude-5'],
    }),

    // Claude Haiku 4.5 — 200K 上下文, 64K 输出
    cfg({
        match: ['claude-haiku-4-5', 'claude-haiku-4.5', 'claude-haiku-4'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.THINKING_LEVEL, S.STOP, S.MAX_TOKENS_BUDGET],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'reasoning_effort'],
        contextWindow: 200000,
        maxOutputTokens: 64000,
        defaultMaxTokens: 4096,
        alias: ['claude-haiku'],
    }),

    // Claude Opus 4.8/4.7/4.6 — 1M 上下文, 128K 输出
    cfg({
        match: ['claude-opus-4.8', 'claude-opus-4.7', 'claude-opus-4-7', 'claude-opus-4.6', 'claude-opus-4-6', 'claude-4-opus'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.THINKING_LEVEL, S.STOP, S.MAX_TOKENS_BUDGET, S.PARALLEL_TOOL],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort', 'temperature'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'temperature', 'reasoning_effort'],
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        defaultMaxTokens: 8192,
        alias: ['claude-opus'],
    }),

    // Claude Sonnet 4.6 — 1M 上下文, 128K 输出; Sonnet 4.5 — 200K, 64K
    cfg({
        match: ['claude-sonnet-4.6', 'claude-sonnet-4-6'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.THINKING_LEVEL, S.STOP, S.MAX_TOKENS_BUDGET, S.PARALLEL_TOOL],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'reasoning_effort'],
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        defaultMaxTokens: 8192,
        alias: ['claude-sonnet'],
    }),

    // Claude Sonnet 4.5 / Sonnet 4 — 200K 上下文, 64K 输出
    cfg({
        match: ['claude-sonnet-4.5', 'claude-sonnet-4-5', 'claude-sonnet-4'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.THINKING_LEVEL, S.STOP, S.MAX_TOKENS_BUDGET, S.PARALLEL_TOOL],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'reasoning_effort'],
        contextWindow: 200000,
        maxOutputTokens: 64000,
        defaultMaxTokens: 4096,
        alias: ['claude-sonnet'],
    }),

    cfg({
        match: ['claude-3.5-haiku', 'claude-3-haiku'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.THINKING_LEVEL, S.STOP, S.MAX_TOKENS_BUDGET],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'reasoning_effort'],
        contextWindow: 200000,
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
        alias: ['claude-haiku'],
    }),

    cfg({
        match: ['claude-3.5-sonnet', 'claude-3-sonnet', 'claude-3-opus', 'claude-3.5', 'claude-3'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.THINKING_LEVEL, S.STOP, S.MAX_TOKENS_BUDGET],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'reasoning_effort'],
        contextWindow: 200000,
        maxOutputTokens: 8192,  // Claude 3.x 上限 8192
        defaultMaxTokens: 4096,
        alias: ['claude'],
    }),

    // Claude 4 通用匹配 (op|opus|sonnet 不匹配时的后备)
    cfg({
        match: ['claude-4', 'claude-4-', 'claude-4.6', 'claude-4.7', 'claude-opus'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.THINKING_LEVEL, S.STOP, S.MAX_TOKENS_BUDGET, S.PARALLEL_TOOL],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'reasoning_effort'],
        contextWindow: 200000,
        maxOutputTokens: 64000,  // ★ Claude 4 通用上限 64000
        defaultMaxTokens: 4096,
        alias: ['claude-4'],
    }),

    // ──────────── MiniMax 系列 ────────────

    // M2.7 — 不支持 tool_choice, 使用XML格式工具调用
    // M2.7 不支持原生 image_url, 图片通过 analyze_image 工具间接识别
    cfg({
        match: ['minimax-m2.7', 'minimax-m2', 'minimax-max'],
        supports: [S.VISION, S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['tool_choice', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'seed', 'response_format', 'logprobs', 'reasoning_effort', 'parallel_tool_calls'],
        bannedBodyKeys: ['tool_choice', 'reasoning_effort', 'top_logprobs', 'logprobs', 'parallel_tool_calls'],
        contextWindow: 1048576,  // 1M tokens
        maxOutputTokens: 131072,
        safetyMargin: 4096,
        defaultMaxTokens: 8192,
        toolCallFormat: 'minimax_xml',
        alias: ['minimax'],
        extraBody: {},
    }),

    // MiniMax M1 — 新一代文本模型
    cfg({
        match: ['minimax-m1', 'MiniMax-M1'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['tool_choice', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'seed', 'response_format', 'logprobs', 'reasoning_effort', 'parallel_tool_calls'],
        bannedBodyKeys: ['tool_choice', 'reasoning_effort', 'top_logprobs', 'logprobs', 'parallel_tool_calls'],
        contextWindow: 131072,
        maxOutputTokens: 16384,
        safetyMargin: 4096,
        defaultMaxTokens: 4096,
        toolCallFormat: 'minimax_xml',
        alias: ['minimax-m1'],
    }),

    // MiniMax M3 — 原生多模态，支持 image_url/video_url，标准 OpenAI function calling
    cfg({
        match: ['minimax-m3', 'minimax-M3', 'MiniMax-M3'],
        supports: [S.VISION, S.TOOLS, S.STREAM, S.TEMP, S.TOP_P],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'seed', 'parallel_tool_calls'],
        contextWindow: 1000000,
        maxOutputTokens: 0,  // 0=自动回退，API 报错时自动提取限制值
        safetyMargin: 16384,
        alias: ['m3'],
    }),

    // Hailuo / MiniMax 文字模型旧版
    cfg({
        match: ['minimax-hailuo', 'abab'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['tool_choice', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'seed', 'response_format', 'reasoning_effort', 'parallel_tool_calls'],
        bannedBodyKeys: ['tool_choice', 'reasoning_effort', 'top_logprobs', 'logprobs', 'parallel_tool_calls'],
        contextWindow: 131072,
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
        toolCallFormat: 'minimax_xml',
        alias: ['hailuo'],
    }),

    // MiniMax VL (视觉模型)
    cfg({
        match: ['minimax-vl'],
        supports: [S.VISION, S.TOOLS, S.STREAM],
        bannedParams: ['tool_choice', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'seed', 'reasoning_effort'],
        bannedBodyKeys: ['tool_choice', 'reasoning_effort'],
        contextWindow: 131072,
        maxOutputTokens: 4096,
        toolCallFormat: 'minimax_xml',
    }),

    // ──────────── 通义千问 Qwen 系列 ────────────

    // Qwen3 系列 (2025-2026) — 最大 1M 上下文
    cfg({
        match: ['qwen3-max', 'qwen3-plus', 'qwen3-turbo', 'qwen3-'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.SEED, S.PARALLEL_TOOL, S.RESP_FORMAT],
        bannedParams: ['logit_bias', 'user', 'logprobs', 'top_logprobs', 'reasoning_effort'],
        contextWindow: 1000000,
        maxOutputTokens: 16384,
        defaultMaxTokens: 4096,
        alias: ['qwen3'],
    }),

    cfg({
        match: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5', 'qwen2'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.SEED, S.PARALLEL_TOOL, S.RESP_FORMAT],
        bannedParams: ['logit_bias', 'user', 'logprobs', 'top_logprobs'],
        contextWindow: 131072,
        maxOutputTokens: 16384,
        defaultMaxTokens: 4096,
        alias: ['qwen', 'tongyi'],
    }),

    // Qwen VL (视觉)
    cfg({
        match: ['qwen-vl', 'qwen-vl-max'],
        supports: [S.VISION, S.TOOLS, S.STREAM, S.TEMP, S.TOP_P],
        bannedParams: ['logit_bias', 'user', 'logprobs'],
        contextWindow: 131072,
        maxOutputTokens: 4096,
        defaultMaxTokens: 2048,
    }),

    // ──────────── xAI Grok 系列 ────────────
    // Grok 4.3: 2026年最新,支持 reasoning_effort: low/medium/high, 1M context
    // Grok 4.1 Fast: 2M context window, 非推理推荐用 grok-4.20-non-reasoning
    // Grok 最终兼容: OpenAI 格式,支持 tools/stream/tool_choice

    cfg({
        match: ['grok-4.5', 'grok-4-5'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'user', 'logit_bias', 'presence_penalty', 'frequency_penalty', 'reasoning_effort'],
        contextWindow: 1048576,
        maxOutputTokens: 131072,  // ★ Grok 4.5 实际支持 131072 输出
        defaultMaxTokens: 4096,
        alias: ['grok-4.5', 'xai-grok-4.5'],
    }),

    cfg({
        match: ['grok-4.3', 'grok-4-3', 'grok-4.20'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'user', 'logit_bias', 'presence_penalty', 'frequency_penalty', 'reasoning_effort'],
        contextWindow: 1048576,
        maxOutputTokens: 131072,  // ★ Grok 4.3 实际支持 131072 输出
        defaultMaxTokens: 4096,
        alias: ['grok-4', 'xai-grok-4'],
    }),

    cfg({
        match: ['grok-4.1-fast', 'grok-4.1-reasoning', 'grok-4-fast'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'user', 'logit_bias', 'presence_penalty', 'frequency_penalty', 'reasoning_effort'],
        contextWindow: 2000000,  // 2M tokens
        maxOutputTokens: 131072,  // ★ Grok 4.1 Fast 实际支持 131072 输出
        defaultMaxTokens: 4096,
        alias: ['grok-fast'],
    }),

    cfg({
        match: ['grok-3', 'grok-3-', 'grok-2', 'grok-beta', 'grok-4'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'reasoning_effort', 'user', 'logit_bias', 'presence_penalty', 'frequency_penalty'],
        contextWindow: 1000000,  // 1M tokens
        maxOutputTokens: 131072,  // ★ Grok 3/4 实际支持 131072 输出
        defaultMaxTokens: 4096,
        alias: ['grok', 'xai'],
    }),

    cfg({
        match: ['grok-3-reasoning', 'grok-3-thinking', 'grok-3-reasoner'],
        supports: [S.REASONING, S.TOOLS, S.STREAM, S.TEMP, S.TOP_P],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'reasoning_effort', 'user', 'logit_bias', 'presence_penalty', 'frequency_penalty'],
        contextWindow: 1000000,
        maxOutputTokens: 131072,  // ★ Grok 3 reasoning 实际支持 131072 输出
        defaultMaxTokens: 4096,
        reasoningMode: 'thinking',
        alias: ['grok-reasoning'],
    }),

    // ──────────── Mistral 系列 ────────────

    cfg({
        match: ['mistral-large', 'mistral-medium', 'mistral-small', 'mistral-', 'open-mistral'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user'],
        contextWindow: 131072,
        maxOutputTokens: 4096,
        defaultMaxTokens: 4096,
        alias: ['mistral', 'le-chat'],
    }),

    cfg({
        match: ['mistral-moderation', 'mistral-embed', 'mistral-'],
        contextWindow: 8192,
        maxOutputTokens: null,
    }),

    // ──────────── 月之暗面 Kimi 系列 ────────────

    // Kimi K3 — 旗舰模型 (1M 上下文, 131K-1M 输出, 原生多模态)
    cfg({
        match: ['kimi-k3'],
        supports: [S.TOOLS, S.VISION, S.REASONING, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'logit_bias', 'user', 'reasoning_effort', 'presence_penalty', 'frequency_penalty'],
        contextWindow: 1048576,
        maxOutputTokens: 131072,
        safetyMargin: 8192,
        defaultMaxTokens: 8192,
        reasoningMode: 'thinking',
        alias: ['kimi-k3', 'kimi'],
    }),

    // Kimi K2.7 Code — 编程模型 (256K 上下文, 思考模式常驻)
    cfg({
        match: ['kimi-k2.7-code-highspeed', 'kimi-k2.7-code'],
        supports: [S.TOOLS, S.REASONING, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'logit_bias', 'user', 'reasoning_effort', 'presence_penalty', 'frequency_penalty'],
        contextWindow: 262144,
        maxOutputTokens: 131072,
        safetyMargin: 8192,
        defaultMaxTokens: 8192,
        reasoningMode: 'thinking',
        alias: ['kimi-k2.7-code', 'kimi-code'],
    }),

    // Kimi K2.6 / K2.5 — 多模态 (256K 上下文, 支持视觉)
    cfg({
        match: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2'],
        supports: [S.TOOLS, S.VISION, S.REASONING, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'logit_bias', 'user', 'reasoning_effort', 'presence_penalty', 'frequency_penalty'],
        contextWindow: 262144,
        maxOutputTokens: 131072,
        safetyMargin: 8192,
        defaultMaxTokens: 8192,
        alias: ['kimi-k2'],
    }),

    // Moonshot V1 Vision 系列 (旧版视觉) — 必须在纯文本 V1 之前匹配
    cfg({
        match: ['moonshot-v1-128k-vision', 'moonshot-v1-32k-vision', 'moonshot-v1-8k-vision', 'moonshot-v1-vision'],
        supports: [S.VISION, S.TOOLS, S.STREAM, S.TEMP, S.TOP_P],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'logit_bias', 'user', 'reasoning_effort', 'presence_penalty', 'frequency_penalty'],
        contextWindow: 131072,
        maxOutputTokens: 4096,
        defaultMaxTokens: 2048,
        alias: ['moonshot-vision'],
    }),

    // Moonshot V1 系列 (旧版文本)
    cfg({
        match: ['moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k', 'moonshot-v1-auto'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.SEED],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'logit_bias', 'user', 'reasoning_effort'],
        contextWindow: 131072,
        maxOutputTokens: 4096,
        defaultMaxTokens: 4096,
        alias: ['moonshot'],
    }),

    // ──────────── 零一万物 Yi 系列 ────────────

    cfg({
        match: ['yi-', 'yi-large', 'yi-medium', 'yi-spark'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'reasoning_effort'],
        contextWindow: 32000,
        maxOutputTokens: 4096,
        defaultMaxTokens: 2048,
    }),

    // ──────────── 智谱 GLM 系列 ────────────

    // GLM-5.2 (2026最新) — 1M 上下文, 128K 输出 (文本模型)
    cfg({
        match: ['glm-5', 'glm-5.2', 'glm-5.1'],
        supports: [S.TOOLS, S.REASONING, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL, S.RESP_FORMAT],
        bannedParams: ['logprobs', 'top_logprobs', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'reasoning_effort'],
        contextWindow: 1048576,  // 1M
        maxOutputTokens: 128000,  // 128K
        safetyMargin: 8192,
        defaultMaxTokens: 8192,
        reasoningMode: 'thinking',
        alias: ['glm-5'],
    }),

    // GLM-4V / GLM-4V-Plus (视觉模型) — 必须在 glm-4 之前匹配
    cfg({
        match: ['glm-4v-plus', 'glm-4v', 'glm-4-v'],
        supports: [S.VISION, S.TOOLS, S.STREAM, S.TEMP, S.TOP_P],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'reasoning_effort'],
        contextWindow: 128000,
        maxOutputTokens: 4096,
        defaultMaxTokens: 2048,
        alias: ['glm-4v'],
    }),

    // GLM-4 系列 (文本: Plus/Air/Flash/4-0107)
    cfg({
        match: ['glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4-01', 'glm-4'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'reasoning_effort'],
        contextWindow: 128000,
        maxOutputTokens: 4096,
        defaultMaxTokens: 4096,
        alias: ['glm-4'],
    }),

    // GLM-3 Turbo / GLM-Zero / GLM-Think
    cfg({
        match: ['glm-3', 'glm-zero', 'glm-think', 'chatglm', 'zhipu'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'reasoning_effort'],
        contextWindow: 128000,
        maxOutputTokens: 4096,
        defaultMaxTokens: 4096,
        alias: ['glm-3'],
    }),

    // GLM-Z1 推理模型
    cfg({
        match: ['glm-z1', 'glm-z1-', 'glm-4-plus-z1'],
        supports: [S.TOOLS, S.REASONING, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'reasoning_effort'],
        contextWindow: 128000,
        maxOutputTokens: 4096,
        defaultMaxTokens: 4096,
        reasoningMode: 'thinking',
        alias: ['glm-z1'],
    }),

    // ──────────── 百度文心一言 ────────────

    cfg({
        match: ['ernie', 'wenxin', 'baidu'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logit_bias', 'logprobs', 'top_logprobs', 'user', 'seed', 'response_format', 'reasoning_effort'],
        contextWindow: 131072,
        maxOutputTokens: 4096,
        defaultMaxTokens: 2048,
        alias: ['ernie'],
    }),

    // ──────────── 字节豆包 ────────────

    cfg({
        match: ['doubao', 'bytedance', 'volc', 'ark'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.PRES_PENALTY, S.FREQ_PENALTY],
        bannedParams: ['logprobs', 'top_logprobs', 'seed', 'user', 'response_format', 'reasoning_effort'],
        contextWindow: 131072,
        maxOutputTokens: 4096,
        defaultMaxTokens: 4096,
        alias: ['doubao', 'volc'],
    }),

    // ──────────── 百川 Baichuan ────────────

    cfg({
        match: ['baichuan', 'baichuan2', 'baichuan3'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'seed', 'reasoning_effort'],
        contextWindow: 131072,
        maxOutputTokens: 4096,
        defaultMaxTokens: 2048,
    }),

    // ──────────── Google Gemini (via OpenAI compat) ────────────
    // Gemini 通过 OpenAI 兼容端点: apiKey+baseUrl 指向 Google AI Studio / Vertex AI
    // 原生: 多模态(文本/图像/音频/视频),100万token上下文
    // Gemini 3 系列已通过 OpenAI 兼容API发布

    cfg({
        match: ['gemini-3', 'gemini-3.0', 'gemini-3-'],
        supports: [S.TOOLS, S.VISION, S.REASON_EFFORT, S.THINKING_LEVEL, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'response_format'],
        contextWindow: 1048576,  // 1M tokens
        maxOutputTokens: 65536,
        safetyMargin: 8192,
        defaultMaxTokens: 4096,
        alias: ['gemini-3'],
    }),

    cfg({
        match: ['gemini-2.5', 'gemini-2.0', 'gemini-1.5', 'gemini-pro', 'gemini-flash'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'response_format', 'reasoning_effort'],
        contextWindow: 1048576,  // 1M tokens
        maxOutputTokens: 65536,  // ★ Gemini 2.x 实际支持 65536 输出
        safetyMargin: 8192,
        defaultMaxTokens: 4096,
        alias: ['gemini', 'google'],
    }),

    cfg({
        match: ['gemini-2.0-flash', 'gemini-flash'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'response_format', 'reasoning_effort'],
        contextWindow: 1048576,
        maxOutputTokens: 65536,  // ★ Gemini 2.0 Flash 实际支持 65536 输出
        defaultMaxTokens: 4096,
    }),

    // ──────────── Ollama 本地模型 ────────────
    // 通用 Ollama 配置 - 不预判工具支持,出错时自动降级

    cfg({
        match: ['ollama/', 'localhost', '127.0.0.1'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'seed', 'response_format', 'reasoning_effort', 'parallel_tool_calls'],
        contextWindow: 8192,
        maxOutputTokens: 4096,
        defaultMaxTokens: 2048,
    }),

    // 特定 Ollama 模型 — 已知不支持工具

    // DeepSeek R1 推理模型 — 不支持工具
    cfg({
        match: ['deepseek-r1'],
        supports: [S.REASONING, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['tools', 'tool_choice', 'presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'response_format', 'reasoning_effort', 'parallel_tool_calls'],
        bannedBodyKeys: ['tools', 'tool_choice'],
        contextWindow: 131072,
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
        reasoningMode: 'thinking',
        noToolsBuiltin: true,
    }),

    // Llama 3/4/3.x 系列 — 多数支持工具
    cfg({
        match: ['llama4', 'llama-4', 'llama3.3', 'llama3.2', 'llama3.1', 'llama3', 'llama2', 'llama-3', 'llama-2'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'seed', 'parallel_tool_calls'],
        contextWindow: 131072,
        maxOutputTokens: 32768,  // ★ Llama 3/4 实际支持 32768+ 输出
        defaultMaxTokens: 4096,
    }),

    // Llama 通用匹配(非 3B/8B 等已知限制模型)
    cfg({
        match: ['llama', 'llama-'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'seed', 'parallel_tool_calls'],
        contextWindow: 8192,
        maxOutputTokens: 4096,
        defaultMaxTokens: 2048,
    }),

    // ──────────── Qwen 多模态 (本地 llama.cpp) ────────────
    // Qwen3.6-35B-A3B 等带 mmproj 的模型原生支持 vision
    // ★ 必须放在通用 qwen fallback 之前,否则 'qwen' 会抢先匹配 Qwen3.6
    cfg({
        match: ['Qwen3.6', 'Qwen3', 'Qwen2-VL', 'Qwen2.5-VL', 'qwenvl', 'Qwen-VL', 'Qwen2-VL-', 'Qwen2.5-VL-', 'mmproj', '.gguf'],
        supports: [S.VISION, S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['logprobs', 'top_logprobs', 'logit_bias', 'user', 'frequency_penalty', 'presence_penalty'],
        contextWindow: 32768,
        maxOutputTokens: 16384,
        defaultMaxTokens: 4096,
    }),

    cfg({
        match: ['qwen', 'qwen2.5', 'qwen2'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'seed'],
        contextWindow: 131072,
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
    }),

    // QwQ (思考模型) — 不支持工具
    cfg({
        match: ['qwq-', 'qwq:'],
        supports: [S.REASONING, S.STREAM, S.TEMP, S.TOP_P],
        bannedParams: ['tools', 'tool_choice', 'presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'seed', 'parallel_tool_calls'],
        bannedBodyKeys: ['tools', 'tool_choice'],
        contextWindow: 32768,
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
        reasoningMode: 'thinking',
        noToolsBuiltin: true,
    }),

    cfg({
        match: ['phi-', 'phi3', 'phi4'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'seed'],
        contextWindow: 131072,
        maxOutputTokens: 4096,
        defaultMaxTokens: 2048,
    }),

    cfg({
        match: ['codestral', 'starcoder', 'codeqwen', 'deepseek-coder'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'seed'],
        contextWindow: 16384,
        maxOutputTokens: 4096,
        defaultMaxTokens: 2048,
    }),

    // ──────────── LongCat 系列 (美图) ────────────
    // LongCat-Flash-Chat: 560B 总参(18.6B-31.3B 激活), MoE 动态计算
    // LongCat 2.0 (官方文档确认: 1M 上下文, 128K 输出, OpenAI/Anthropic 双格式)
    // ★ 注意: LongCat 视觉由 analyze_image 工具处理, 非原生 image_url
    cfg({
        match: ['longcat-2', 'LongCat-2', 'longcat_2'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'response_format', 'reasoning_effort'],
        contextWindow: 1000000,
        maxOutputTokens: 128000,  // ★ 官方文档确认 128K
        safetyMargin: 8192,
        defaultMaxTokens: 8192,
        alias: ['longcat-2', 'longcat'],
    }),

    // LongCat 1.0 / Flash-Chat (560B MoE, 1M 上下文)
    cfg({
        match: ['longcat-', 'LongCat-', 'longcat_'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'response_format', 'reasoning_effort'],
        contextWindow: 1000000,
        maxOutputTokens: 131072,
        safetyMargin: 8192,
        defaultMaxTokens: 4096,
        alias: ['longcat'],
    }),

    // ──────────── MiMo 系列 (小米) ────────────
    // MiMo-VL (视觉语言模型) — 必须在通用 mimo 之前匹配
    cfg({
        match: ['mimo-vl', 'mimo-vl-', 'MiMo-VL'],
        supports: [S.VISION, S.TOOLS, S.STREAM, S.TEMP, S.TOP_P],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'response_format', 'reasoning_effort'],
        contextWindow: 131072,
        maxOutputTokens: 16384,
        defaultMaxTokens: 4096,
        alias: ['mimo-vl'],
    }),

    // MiMo-V2.5-Pro: 1.02T 总参(42B 激活), MoE+Hybrid Attention, 1M 上下文
    cfg({
        match: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2-flash', 'mimo-v2', 'mimo-'],
        supports: [S.TOOLS, S.VISION, S.REASONING, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'response_format', 'reasoning_effort'],
        contextWindow: 1048576,  // 1M
        maxOutputTokens: 131072,
        safetyMargin: 8192,
        defaultMaxTokens: 8192,
        alias: ['mimo', 'xiaomi-mimo'],
    }),

    // ──────────── 通用配置 (fallback) ────────────
    // 匹配所有 OpenAI 兼容模型
    // ★ maxOutputTokens 与 contextWindow 一致 (131072)：自定义导入的模型名通常
    //   不含已知前缀 (gpt-4o/gpt-4-/...) 而落回此通配配置。若硬编码 4096 会
    //   把 max_tokens 上限死死钳住 (config.js 钳制输入框 + getMaxOutputTokens
    //   Math.min 双重压制)，即使 /models 返回真实上限也不生效。
    //   默认发送值 defaultMaxTokens 保持 4096 不变；若模型真实上限更低，
    //   AutoAdjust 学习值会在 getMaxOutputTokens 中自动收紧 (Math.min)。
    cfg({
        match: ['*'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.REASON_EFFORT, S.THINKING_LEVEL],
        bannedParams: ['logprobs', 'top_logprobs', 'user'],
        contextWindow: 131072,
        maxOutputTokens: 131072,
        defaultMaxTokens: 4096,
    }),

];

// ===== 内部工具函数 =====

function _normalize(name) {
    return (name || '').toLowerCase().trim();
}

function _matchConfig(name) {
    var n = _normalize(name);
    // 先精确匹配
    for (var i = 0; i < configs.length; i++) {
        var c = configs[i];
        if (!c.match || c.match[0] === '*') continue; // 跳过通配在最后处理
        for (var j = 0; j < c.match.length; j++) {
            var pattern = _normalize(c.match[j]);
            // 精确匹配或包含匹配
            if (n === pattern || n.indexOf(pattern) !== -1) {
                return c;
            }
        }
    }
    // 最后匹配通配符 *
    for (var i = 0; i < configs.length; i++) {
        var c = configs[i];
        if (c.match && c.match[0] === '*') return c;
    }
    return configs[configs.length - 1]; // fallback
}

// ===== 公开 API =====

return {
    /** 获取模型完整配置对象 */
    getConfig: function(name) {
        return _matchConfig(name);
    },

    /** 检查模型是否支持某项能力 */
    supports: function(name, feature) {
        var c = _matchConfig(name);
        return c.supports.indexOf(feature) !== -1;
    },

    /** 获取模型中 banned 参数列表 */
    getBannedParams: function(name) {
        return _matchConfig(name).bannedParams || [];
    },

    /** 获取模型中 banned body keys */
    getBannedBodyKeys: function(name) {
        return _matchConfig(name).bannedBodyKeys || [];
    },

    /** 获取上下文窗口长度 */
    getContextWindow: function(name) {
        return _matchConfig(name).contextWindow;
    },

    /** 获取最大输出 tokens (AutoAdjust 学习值不得越过静态配置上限) */
    getMaxOutputTokens: function(name) {
        var _static = _matchConfig(name).maxOutputTokens || _matchConfig(name).contextWindow;
        // ★ 学习值(模型列表元数据/API错误提取)可能虚高 — 如 LongCat /models 报
        //   409600 context, 但 API 硬性限制 max_tokens ≤ 131072。必须与静态配置
        //   取最小, 否则 ModelCap 失效导致 400。学习值只会"收紧"不会"放宽"。
        try {
            var _overrides = JSON.parse(localStorage.getItem('modelMaxOutputTokens') || '{}');
            if (_overrides[name]) return Math.min(_overrides[name], _static);
        } catch(e) {}
        return _static;
    },

    /** 获取安全余量 */
    getSafetyMargin: function(name) {
        return _matchConfig(name).safetyMargin;
    },

    /** 获取默认 temperature */
    getDefaultTemp: function(name) {
        return _matchConfig(name).defaultTemp;
    },

    /** 获取默认 max_tokens（优先使用模型最大输出） */
    getDefaultMaxTokens: function(name) {
        var c = _matchConfig(name);
        return c.maxOutputTokens || c.contextWindow || c.defaultMaxTokens || 4096;
    },

    /** 获取工具调用格式 ('openai' | 'minimax_xml') */
    getToolCallFormat: function(name) {
        return _matchConfig(name).toolCallFormat || 'openai';
    },

    /** 获取推理模式 */
    getReasoningMode: function(name) {
        return _matchConfig(name).reasoningMode || null;
    },

    /** 是否内置不支持工具(no-tool list 预置) */
    isNoToolsBuiltin: function(name) {
        return !!_matchConfig(name).noToolsBuiltin;
    },

    /** 从 body 中移除模型不支持的参数 */
    sanitizeBody: function(name, body) {
        var cfg = _matchConfig(name);
        var n = _normalize(name);

        // 移除 banned body keys
        if (cfg.bannedBodyKeys) {
            for (var i = 0; i < cfg.bannedBodyKeys.length; i++) {
                delete body[cfg.bannedBodyKeys[i]];
            }
        }

        // 移除 banned params (可能只作为 body 顶层 key)
        if (cfg.bannedParams) {
            for (var i = 0; i < cfg.bannedParams.length; i++) {
                var key = cfg.bannedParams[i];
                if (body[key] !== undefined) {
                    delete body[key];
                }
            }
        }

        // 移除 extra_body (如果模型不需要)
        if (cfg.bannedParams.indexOf('extra_body') !== -1) {
            delete body.extra_body;
        }

        // 对于支持 max_completion_tokens 的模型(o1/o3),将 max_tokens 转为 max_completion_tokens
        if (this.supports(name, 'maxCompletionTokens')) {
            if (body.max_tokens !== undefined) {
                body.max_completion_tokens = body.max_tokens;
                delete body.max_tokens;
            }
        }

        return body;
    },

    /** 获取默认搜索模型 (在工具不支持时使用) */
    getDefaultSearchModel: function(name) {
        return _matchConfig(name).defaultSearchModel;
    },

    /** 获取模型别名列表 */
    getAliases: function(name) {
        return _matchConfig(name).alias || [];
    },

    /** 获取所有配置名称(用于调试) */
    getAllConfigs: function() {
        return configs.map(function(c) { return c.match; });
    },

    /** 检查模型是否支持流式 */
    supportsStream: function(name) {
        return this.supports(name, 'stream');
    },

    /** 检查模型是否支持工具 */
    supportsTools: function(name) {
        return this.supports(name, 'tools');
    },

    /** 检查模型是否支持视觉 */
    supportsVision: function(name) {
        var result = this.supports(name, 'vision');
        return result;
    },

    /** 检查模型是否支持 reasoning_effort */
    supportsReasonEffort: function(name) {
        return this.supports(name, 'reasonEffort');
    },

    /** 检查模型是否支持思考强度分级 */
    supportsThinkingIntensity: function(name) {
        if (!name) return false;
        var n = _normalize(name);
        // LongCat / MiniMax 走 binary thinking 也纳入统一控制
        if (n.indexOf('longcat') === 0) return true;
        if (n.indexOf('minimax') === 0) return true;
        if (n.indexOf('mimo') === 0) return true;
        return this.supports(name, 'thinkingLevel');
    },

    /** 检查模型是否支持 ultra 级别 (仅 Claude / DeepSeek V4) */
    supportsThinkingUltra: function(name) {
        if (!name) return false;
        var n = _normalize(name);
        if (n.indexOf('claude') === 0) return true;
        if (n.indexOf('deepseek-v4') === 0) return true;
        return false;
    },

    /**
     * 获取思考强度分级参数 — 返回合并到请求体的参数对象
     * @param {string} level - off/low/medium/high/max/ultra
     * @param {string} modelName - 模型名
     * @param {bool} isAnthropicFormat - 是否 Anthropic 格式
     * @returns {object} 合并到 body 的参数 (undefined 值表示删除该 key)
     */
    getThinkingIntensityParams: function(level, modelName, isAnthropicFormat) {
        var n = _normalize(modelName);
        var isClaude = isAnthropicFormat && n.indexOf('claude') === 0;
        // Claude effort 支持: Opus 4.6+/Sonnet 4.6+/Sonnet 5+/Opus 5+/Fable 5
        var isEffortClaude = isClaude && /claude-(opus-(4\.[6-9]|5)|sonnet-(4\.[6-9]|5)|fable-5)/.test(n);
        var isGemini = n.indexOf('gemini-3') === 0;
        var isDeepSeekV4 = n.indexOf('deepseek-v4') === 0;
        var isLongCat = n.indexOf('longcat') === 0;
        var isMiniMax = n.indexOf('minimax') === 0 || n.indexOf('mimo') === 0;

        var v = THINKING_INTENSITY_MAP[level] || THINKING_INTENSITY_MAP.medium;

        // ── LongCat (binary thinking, 优先于 Claude 判断 — LongCat 也支持 Anthropic 格式) ──
        // LongCat 在 OpenAI 和 Anthropic 格式下都使用 thinking.type (enabled/disabled)
        if (isLongCat) {
            if (v.binary === 'disabled') {
                return { thinking: { type: 'disabled' } };
            }
            return { thinking: { type: 'enabled' } };
        }

        // ── Claude ──
        if (isClaude) {
            if (v.claude === null) {
                // off: 关闭思考
                return { thinking: { type: 'disabled' }, output_config: undefined };
            }
            if (isEffortClaude) {
                // effort 模式: thinking.adaptive + output_config.effort
                return { thinking: { type: 'adaptive' }, output_config: { effort: v.claude } };
            }
            // 仅 extended thinking 模型: budget_tokens 映射
            var budgetMap = { low: 2000, medium: 8000, high: 16000, max: 32000, ultra: 64000 };
            var bt = budgetMap[level] || 8000;
            return { thinking: { type: 'enabled', budget_tokens: bt } };
        }

        // ── MiniMax (binary thinking, LongCat 已在上方处理) ──
        if (isMiniMax) {
            if (v.binary === 'disabled') {
                return { thinking: { type: 'disabled' } };
            }
            return { thinking: { type: 'adaptive' } };
        }

        // ── Gemini 3 (thinking_level via extra_body) ──
        if (isGemini) {
            if (v.gemini === null) {
                return { extra_body: { thinking_level: undefined } };
            }
            return { extra_body: { thinking_level: v.gemini } };
        }

        // ── OpenAI / DeepSeek V4 (reasoning_effort) ──
        if (v.openai === null) {
            return { reasoning_effort: undefined };
        }
        // DeepSeek V4 的 max/ultra 映射为 max
        var effort = v.openai;
        if (isDeepSeekV4 && (level === 'max' || level === 'ultra')) effort = 'max';
        return { reasoning_effort: effort };
    },
};

})();
