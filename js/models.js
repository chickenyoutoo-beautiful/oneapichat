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

    // DeepSeek V4 Flash — 2026年最新
    // 推理方式: reasoning_effort (low/medium/high/max) + 通过 extra_body 传 thinking type
    // 工具调用格式: <｜DSML｜tool_calls> XML (但API也兼容 OpenAI format)
    cfg({
        match: ['deepseek-v4-flash'],
        supports: [S.TOOLS, S.REASON_EFFORT, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.LOGPROBS, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['logit_bias', 'user', 'max_completion_tokens', 'parallel_tool_calls'],
        contextWindow: 1000000,
        maxOutputTokens: 384000,
        safetyMargin: 8192,
        defaultMaxTokens: 8192,
        alias: ['deepseek', 'ds-v4-flash'],
    }),

    // DeepSeek V4 Pro — 推理方式同上
    cfg({
        match: ['deepseek-v4-pro'],
        supports: [S.TOOLS, S.REASON_EFFORT, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.LOGPROBS, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['logit_bias', 'user', 'max_completion_tokens', 'parallel_tool_calls'],
        contextWindow: 1000000,
        maxOutputTokens: 384000,
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
        maxOutputTokens: 8192,
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
        maxOutputTokens: 65536,
        safetyMargin: 4096,
        defaultMaxTokens: 4096,
        defaultTemp: 0.6,
        reasoningMode: 'thinking',
        // 禁用 tools — 在无工具列表中预置
        noToolsBuiltin: true,
    }),

    // ──────────── OpenAI 系列 ────────────

    // GPT-4o / GPT-4o-mini
    cfg({
        match: ['gpt-4o', 'gpt-4o-mini', 'gpt-4o-', 'chatgpt-4o'],
        supports: [S.TOOLS, S.VISION, S.REASON_EFFORT, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.RESP_FORMAT, S.LOGPROBS, S.SEED, S.PARALLEL_TOOL],
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

    // o1 / o3 (推理系列) — 使用 max_completion_tokens 而非 max_tokens
    // 注意: tool 定义中参数必须都在 required 数组中(strict:true 兼容问题)
    cfg({
        match: ['o1-', 'o1', 'o3-', 'o3'],
        supports: [S.TOOLS, S.REASONING, S.STOP, S.MAX_COMP_TOKENS],
        bannedParams: ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'stream', 'response_format', 'max_tokens'],
        bannedBodyKeys: ['stream', 'max_tokens'],
        contextWindow: 200000,
        maxOutputTokens: 100000,
        safetyMargin: 4096,
        defaultMaxTokens: 4096,
        reasoningMode: 'thinking',
        alias: ['openai-o'],
    }),

    // GPT-5 系列 — 支持 reasoning_effort: none | minimal | low | medium | high | xhigh
    // GPT-5.1 默认 reasoning_effort=none
    // GPT-5-Pro 仅支持 reasoning_effort=high
    cfg({
        match: ['gpt-5', 'gpt-5.1', 'gpt-5.2', 'gpt-5-pro'],
        supports: [S.TOOLS, S.VISION, S.REASON_EFFORT, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL, S.MAX_COMP_TOKENS],
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

    cfg({
        match: ['claude-opus-4.7', 'claude-opus-4-7', 'claude-4-opus'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.STOP, S.MAX_TOKENS_BUDGET, S.PARALLEL_TOOL],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort', 'temperature'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'temperature', 'reasoning_effort'],
        contextWindow: 200000,
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
        alias: ['claude-opus'],
    }),

    cfg({
        match: ['claude-sonnet-4', 'claude-sonnet-4.5', 'claude-sonnet-4-5'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.STOP, S.MAX_TOKENS_BUDGET, S.PARALLEL_TOOL],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'reasoning_effort'],
        contextWindow: 200000,
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
        alias: ['claude-sonnet'],
    }),

    cfg({
        match: ['claude-3.5-haiku', 'claude-3-haiku'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.STOP, S.MAX_TOKENS_BUDGET],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'reasoning_effort'],
        contextWindow: 200000,
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
        alias: ['claude-haiku'],
    }),

    cfg({
        match: ['claude-3.5-sonnet', 'claude-3-sonnet', 'claude-3-opus', 'claude-3.5', 'claude-3'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.STOP, S.MAX_TOKENS_BUDGET],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'reasoning_effort'],
        contextWindow: 200000,
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
        alias: ['claude'],
    }),

    // Claude 4 通用匹配 (op|opus|sonnet 不匹配时的后备)
    cfg({
        match: ['claude-4', 'claude-4-', 'claude-4.6', 'claude-4.7', 'claude-opus'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.STOP, S.MAX_TOKENS_BUDGET, S.PARALLEL_TOOL],
        bannedParams: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'user', 'response_format', 'logprobs', 'reasoning_effort'],
        bannedBodyKeys: ['top_p', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'seed', 'reasoning_effort'],
        contextWindow: 200000,
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
        alias: ['claude-4'],
    }),

    // ──────────── MiniMax 系列 ────────────

    // M2.7 — 不支持 tool_choice, 使用XML格式工具调用
    cfg({
        match: ['minimax-m2.7', 'minimax-m2', 'minimax-max'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['tool_choice', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'seed', 'response_format', 'logprobs', 'reasoning_effort', 'parallel_tool_calls'],
        bannedBodyKeys: ['tool_choice', 'reasoning_effort', 'top_logprobs', 'logprobs', 'parallel_tool_calls'],
        contextWindow: 204800,
        maxOutputTokens: 131072,
        safetyMargin: 4096,
        defaultMaxTokens: 8192,
        toolCallFormat: 'minimax_xml',
        alias: ['minimax'],
        extraBody: {
            // MiniMax 不需要特殊 body,但工具调用格式特殊
        },
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

    cfg({
        match: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5', 'qwen2'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.SEED, S.PARALLEL_TOOL, S.RESP_FORMAT],
        bannedParams: ['logit_bias', 'user', 'logprobs', 'top_logprobs'],
        contextWindow: 131072,
        maxOutputTokens: 8192,
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
        match: ['grok-4.3', 'grok-4-3', 'grok-4.20'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'user', 'logit_bias', 'presence_penalty', 'frequency_penalty', 'reasoning_effort'],
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
        alias: ['grok-4', 'xai-grok-4'],
    }),

    cfg({
        match: ['grok-4.1-fast', 'grok-4.1-reasoning', 'grok-4-fast'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'user', 'logit_bias', 'presence_penalty', 'frequency_penalty', 'reasoning_effort'],
        contextWindow: 2000000,  // 2M tokens
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
        alias: ['grok-fast'],
    }),

    cfg({
        match: ['grok-3', 'grok-3-', 'grok-2', 'grok-beta', 'grok-4'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED, S.PARALLEL_TOOL],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'reasoning_effort', 'user', 'logit_bias', 'presence_penalty', 'frequency_penalty'],
        contextWindow: 1000000,  // 1M tokens
        maxOutputTokens: 8192,
        defaultMaxTokens: 4096,
        alias: ['grok', 'xai'],
    }),

    cfg({
        match: ['grok-3-reasoning', 'grok-3-thinking', 'grok-3-reasoner'],
        supports: [S.REASONING, S.TOOLS, S.STREAM, S.TEMP, S.TOP_P],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'reasoning_effort', 'user', 'logit_bias', 'presence_penalty', 'frequency_penalty'],
        contextWindow: 1000000,
        maxOutputTokens: 8192,
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

    cfg({
        match: ['moonshot', 'kimi'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.PRES_PENALTY, S.FREQ_PENALTY, S.STOP, S.SEED],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'logit_bias', 'user', 'reasoning_effort'],
        contextWindow: 131072,
        maxOutputTokens: 4096,
        defaultMaxTokens: 4096,
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

    cfg({
        match: ['glm-4', 'glm-4v', 'glm-3', 'chatglm', 'zhipu'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'reasoning_effort'],
        contextWindow: 128000,
        maxOutputTokens: 4096,
        defaultMaxTokens: 4096,
    }),

    // GLM-4V (视觉)
    cfg({
        match: ['glm-4v'],
        supports: [S.VISION, S.TOOLS, S.STREAM, S.TEMP, S.TOP_P],
        bannedParams: ['logprobs', 'top_logprobs', 'response_format', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'reasoning_effort'],
        contextWindow: 128000,
        maxOutputTokens: 4096,
        defaultMaxTokens: 2048,
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
        supports: [S.TOOLS, S.VISION, S.REASON_EFFORT, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'response_format'],
        contextWindow: 1048576,  // 1M tokens
        maxOutputTokens: 16384,
        safetyMargin: 8192,
        defaultMaxTokens: 4096,
        alias: ['gemini-3'],
    }),

    cfg({
        match: ['gemini-2.5', 'gemini-2.0', 'gemini-1.5', 'gemini-pro', 'gemini-flash'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'response_format', 'reasoning_effort'],
        contextWindow: 1048576,  // 1M tokens
        maxOutputTokens: 8192,
        safetyMargin: 8192,
        defaultMaxTokens: 4096,
        alias: ['gemini', 'google'],
    }),

    cfg({
        match: ['gemini-2.0-flash', 'gemini-flash'],
        supports: [S.TOOLS, S.VISION, S.STREAM, S.TEMP, S.TOP_P, S.STOP, S.SEED],
        bannedParams: ['presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias', 'user', 'response_format', 'reasoning_effort'],
        contextWindow: 1048576,
        maxOutputTokens: 8192,
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
        maxOutputTokens: 8192,
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

    // ──────────── 通用配置 (fallback) ────────────
    // 匹配所有 OpenAI 兼容模型
    cfg({
        match: ['*'],
        supports: [S.TOOLS, S.STREAM, S.TEMP, S.TOP_P, S.STOP],
        bannedParams: ['logprobs', 'top_logprobs', 'user', 'reasoning_effort'],
        contextWindow: 131072,
        maxOutputTokens: 4096,
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

    /** 获取最大输出 tokens */
    getMaxOutputTokens: function(name) {
        return _matchConfig(name).maxOutputTokens || _matchConfig(name).contextWindow;
    },

    /** 获取安全余量 */
    getSafetyMargin: function(name) {
        return _matchConfig(name).safetyMargin;
    },

    /** 获取默认 temperature */
    getDefaultTemp: function(name) {
        return _matchConfig(name).defaultTemp;
    },

    /** 获取默认 max_tokens */
    getDefaultMaxTokens: function(name) {
        return _matchConfig(name).defaultMaxTokens;
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
        return this.supports(name, 'vision');
    },

    /** 检查模型是否支持 reasoning_effort */
    supportsReasonEffort: function(name) {
        return this.supports(name, 'reasonEffort');
    },
};

})();
