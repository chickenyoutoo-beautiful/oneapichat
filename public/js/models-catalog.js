// models-catalog.js — 现代专业级模型元数据库 (Pi-style Model Registry & Catalog)
// 采用克制、专业、高质感的排版体系，去除花哨 Emoji，融入精致的能力特征标识

(function(window) {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    // 1. 结构化模型元数据库 (按 Provider 分组)
    // ─────────────────────────────────────────────────────────────
    const MODEL_CATALOG = {
        // xAI (Grok 系列)
        xai: [
            { id: 'grok-4.6', name: 'Grok 4.6', contextWindow: 1000000, maxTokens: 384000, capabilities: ['thinking', 'vision', 'tools', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'grok-4.5', name: 'Grok 4.5', contextWindow: 1000000, maxTokens: 384000, capabilities: ['thinking', 'vision', 'tools'], category: 'Reasoning 深度推理' },
            { id: 'grok-4.3', name: 'Grok 4.3', contextWindow: 1000000, maxTokens: 384000, capabilities: ['thinking', 'tools'], category: 'Reasoning 深度推理' },
            { id: 'grok-4.20-0309-reasoning', name: 'Grok 4.20 Reasoning', contextWindow: 1000000, maxTokens: 384000, capabilities: ['thinking', 'tools'], category: 'Reasoning 深度推理' },
            { id: 'grok-4.20-0309-non-reasoning', name: 'Grok 4.20 Fast', contextWindow: 1000000, maxTokens: 384000, capabilities: ['tools', 'fast'], category: 'Fast 极速轻量' },
            { id: 'grok-4.20-multi-agent-0309', name: 'Grok 4.20 Multi-Agent', contextWindow: 1000000, maxTokens: 384000, capabilities: ['tools', 'agent'], category: 'Agent 智能体' },
            { id: 'grok-3-mini', name: 'Grok 3 Mini', contextWindow: 400000, maxTokens: 128000, capabilities: ['tools', 'fast'], category: 'Fast 极速轻量' },
            { id: 'grok-3-mini-fast', name: 'Grok 3 Mini Fast', contextWindow: 400000, maxTokens: 128000, capabilities: ['fast'], category: 'Fast 极速轻量' },
            { id: 'grok-build-0.1', name: 'Grok Build 0.1', contextWindow: 1000000, maxTokens: 256000, capabilities: ['tools', 'coding'], category: 'Code 编程开发' },
            { id: 'grok-composer-2.5-fast', name: 'Grok Composer 2.5', contextWindow: 1000000, maxTokens: 256000, capabilities: ['tools', 'coding'], category: 'Code 编程开发' }
        ],

        // Google Gemini & Claude (网关聚合通道)
        gemini: [
            { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', contextWindow: 1000000, maxTokens: 128000, capabilities: ['thinking', 'vision', 'tools', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', contextWindow: 1000000, maxTokens: 128000, capabilities: ['thinking', 'vision', 'tools', 'fast'], category: 'Fast 极速轻量' },
            { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash High', contextWindow: 1000000, maxTokens: 128000, capabilities: ['thinking', 'vision', 'tools'], category: 'Recommended 推荐旗舰' },
            { id: 'gemini-3.6-flash-high', name: 'Gemini 3.6 Flash High', contextWindow: 1000000, maxTokens: 128000, capabilities: ['thinking', 'vision', 'tools'], category: 'Recommended 推荐旗舰' },
            { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', contextWindow: 1000000, maxTokens: 64000, capabilities: ['vision', 'tools', 'fast'], category: 'Fast 极速轻量' },
            { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', contextWindow: 1000000, maxTokens: 64000, capabilities: ['vision', 'tools'], category: 'Fast 极速轻量' },
            { id: 'gemini-3.5-flash-low', name: 'Gemini 3.5 Flash Low', contextWindow: 1000000, maxTokens: 64000, capabilities: ['vision', 'fast'], category: 'Fast 极速轻量' },
            { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro Low', contextWindow: 1000000, maxTokens: 64000, capabilities: ['thinking', 'tools', 'vision'], category: 'Reasoning 深度推理' },
            { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', contextWindow: 1000000, maxTokens: 64000, capabilities: ['fast'], category: 'Fast 极速轻量' },
            { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 Thinking', contextWindow: 1000000, maxTokens: 128000, capabilities: ['thinking', 'vision', 'tools', 'recommend'], category: 'Reasoning 深度推理' },
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 1000000, maxTokens: 128000, capabilities: ['vision', 'tools', 'coding', 'recommend'], category: 'Code 编程开发' },
            { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B Medium', contextWindow: 128000, maxTokens: 16000, capabilities: ['tools'], category: 'OpenSource 开源' },
            { id: 'gemini-3-flash-agent', name: 'Gemini 3 Flash Agent', contextWindow: 1000000, maxTokens: 64000, capabilities: ['tools', 'agent'], category: 'Agent 智能体' },
            { id: 'gemini-pro-agent', name: 'Gemini Pro Agent', contextWindow: 1000000, maxTokens: 64000, capabilities: ['tools', 'agent'], category: 'Agent 智能体' }
        ],

        // OpenAI & Codex 系列
        openai: [
            { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', contextWindow: 1000000, maxTokens: 128000, capabilities: ['thinking', 'tools', 'vision', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', contextWindow: 1000000, maxTokens: 128000, capabilities: ['thinking', 'tools', 'vision'], category: 'Recommended 推荐旗舰' },
            { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 1000000, maxTokens: 128000, capabilities: ['thinking', 'tools', 'vision'], category: 'Reasoning 深度推理' },
            { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', contextWindow: 400000, maxTokens: 64000, capabilities: ['tools', 'fast'], category: 'Fast 极速轻量' },
            { id: 'codex-auto-review', name: 'Codex Auto Review', contextWindow: 400000, maxTokens: 64000, capabilities: ['coding', 'tools'], category: 'Code 编程开发' },
            { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384, capabilities: ['tools', 'vision'], category: 'Legacy 经典存档' },
            { id: 'o1', name: 'OpenAI o1', contextWindow: 200000, maxTokens: 100000, capabilities: ['thinking', 'vision'], category: 'Reasoning 深度推理' },
            { id: 'o3-mini', name: 'OpenAI o3-mini', contextWindow: 200000, maxTokens: 100000, capabilities: ['thinking', 'tools', 'fast'], category: 'Fast 极速轻量' }
        ],

        // DeepSeek 官方
        deepseek: [
            { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision Exp', contextWindow: 1000000, maxTokens: 128000, capabilities: ['vision', 'tools', 'fast', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'deepseek-chat', name: 'DeepSeek-V3 Chat', contextWindow: 64000, maxTokens: 8192, capabilities: ['tools', 'fast', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'deepseek-reasoner', name: 'DeepSeek-R1 Reasoner', contextWindow: 64000, maxTokens: 8192, capabilities: ['thinking', 'tools', 'recommend'], category: 'Reasoning 深度推理' },
            { id: 'deepseek-v4-flash', name: 'DeepSeek-V4 Flash', contextWindow: 1000000, maxTokens: 384000, capabilities: ['thinking', 'tools', 'fast', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'deepseek-v4-pro', name: 'DeepSeek-V4 Pro', contextWindow: 1000000, maxTokens: 384000, capabilities: ['thinking', 'tools', 'recommend'], category: 'Recommended 推荐旗舰' }
        ],

        // Anthropic Claude
        antthropic: [
            { id: 'claude-sonnet-4-6', name: 'Claude 4.6 Sonnet', contextWindow: 1000000, maxTokens: 128000, capabilities: ['vision', 'tools', 'coding', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'claude-opus-4-6-thinking', name: 'Claude 4.6 Opus Thinking', contextWindow: 1000000, maxTokens: 128000, capabilities: ['thinking', 'vision', 'tools'], category: 'Reasoning 深度推理' },
            { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', contextWindow: 200000, maxTokens: 64000, capabilities: ['thinking', 'vision', 'tools', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', contextWindow: 200000, maxTokens: 8192, capabilities: ['vision', 'tools', 'coding'], category: 'Code 编程开发' },
            { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200000, maxTokens: 8192, capabilities: ['vision', 'tools', 'fast'], category: 'Fast 极速轻量' }
        ],

        // MiniMax
        minimax: [
            { id: 'MiniMax-Text-01', name: 'MiniMax Text 01', contextWindow: 4000000, maxTokens: 8192, capabilities: ['tools', 'recommend'], category: 'LongContext 超长文本' },
            { id: 'abab6.5s-chat', name: 'MiniMax abab 6.5s', contextWindow: 245760, maxTokens: 8192, capabilities: ['tools', 'fast'], category: 'Fast 极速轻量' }
        ],

        // 智谱 (GLM)
        zhipu: [
            { id: 'glm-4-plus', name: 'GLM-4 Plus', contextWindow: 128000, maxTokens: 4096, capabilities: ['tools', 'vision', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000, maxTokens: 4096, capabilities: ['tools', 'fast'], category: 'Fast 极速轻量' },
            { id: 'glm-4-long', name: 'GLM-4 Long', contextWindow: 1000000, maxTokens: 4096, capabilities: ['tools'], category: 'LongContext 超长文本' }
        ],

        // 通义千问 (Qwen)
        qwen: [
            { id: 'qwen-max-latest', name: 'Qwen Max', contextWindow: 32768, maxTokens: 8192, capabilities: ['tools', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'qwen-plus-latest', name: 'Qwen Plus', contextWindow: 131072, maxTokens: 8192, capabilities: ['tools', 'vision'], category: 'Recommended 推荐旗舰' },
            { id: 'qwen-turbo-latest', name: 'Qwen Turbo', contextWindow: 1000000, maxTokens: 8192, capabilities: ['tools', 'fast'], category: 'Fast 极速轻量' },
            { id: 'qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B', contextWindow: 131072, maxTokens: 8192, capabilities: ['coding', 'tools'], category: 'Code 编程开发' }
        ],

        // 月之暗面 (Kimi)
        moonshot: [
            { id: 'moonshot-v1-128k', name: 'Kimi 128K', contextWindow: 128000, maxTokens: 4096, capabilities: ['tools', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'moonshot-v1-32k', name: 'Kimi 32K', contextWindow: 32000, maxTokens: 4096, capabilities: ['tools'], category: 'Fast 极速轻量' },
            { id: 'moonshot-v1-8k', name: 'Kimi 8K', contextWindow: 8000, maxTokens: 4096, capabilities: ['tools', 'fast'], category: 'Fast 极速轻量' }
        ],

        // 本地模型 / CPA 聚合通道
        llamacpp: [
            { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', contextWindow: 1000000, maxTokens: 128000, capabilities: ['thinking', 'tools', 'vision', 'recommend'], category: 'Gateway 聚合' },
            { id: 'grok-4.6', name: 'Grok 4.6', contextWindow: 1000000, maxTokens: 384000, capabilities: ['thinking', 'tools', 'recommend'], category: 'Gateway 聚合' },
            { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', contextWindow: 1000000, maxTokens: 128000, capabilities: ['thinking', 'vision', 'tools', 'recommend'], category: 'Gateway 聚合' },
            { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash High', contextWindow: 1000000, maxTokens: 128000, capabilities: ['thinking', 'vision', 'tools'], category: 'Gateway 聚合' },
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 1000000, maxTokens: 128000, capabilities: ['vision', 'tools', 'coding', 'recommend'], category: 'Gateway 聚合' }
        ],

        // LongCat
        longcat: [
            { id: 'LongCat-2.0', name: 'LongCat 2.0', contextWindow: 128000, maxTokens: 8192, capabilities: ['tools', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'gpt-4o', name: 'GPT-4o (LongCat)', contextWindow: 128000, maxTokens: 4096, capabilities: ['tools'], category: 'Compatible 兼容通道' }
        ],

        // 小米 MiMo
        mimo: [
            { id: 'mimo-v2-flash', name: 'MiMo V2 Flash', contextWindow: 1000000, maxTokens: 8192, capabilities: ['tools', 'fast', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'mimo-v2.5', name: 'MiMo V2.5', contextWindow: 1000000, maxTokens: 8192, capabilities: ['tools', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', contextWindow: 1000000, maxTokens: 8192, capabilities: ['thinking', 'tools', 'recommend'], category: 'Recommended 推荐旗舰' }
        ],

        // 字节豆包 (Doubao)
        doubao: [
            { id: 'doubao-pro-128k', name: 'Doubao Pro 128K', contextWindow: 128000, maxTokens: 4096, capabilities: ['tools', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'doubao-lite-128k', name: 'Doubao Lite 128K', contextWindow: 128000, maxTokens: 4096, capabilities: ['tools', 'fast'], category: 'Fast 极速轻量' }
        ],

        // NVIDIA NIM
        nvidia: [
            { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', contextWindow: 128000, maxTokens: 4096, capabilities: ['tools', 'recommend'], category: 'Recommended 推荐旗舰' },
            { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1 (NVIDIA)', contextWindow: 64000, maxTokens: 8192, capabilities: ['thinking', 'tools'], category: 'Reasoning 深度推理' }
        ],

        // 自定义提供商 (默认不硬塞任何单一厂商模型，仅靠动态拉取或纯净用户输入)
        custom: []
    };

    // ─────────────────────────────────────────────────────────────
    // 2. 现代专业级格式化工具方法
    // ─────────────────────────────────────────────────────────────

    /**
     * 格式化上下文长度 (例如 1000000 -> 1M, 131072 -> 128K)
     */
    function formatContextWindow(tokens) {
        if (!tokens || tokens <= 0) return '';
        if (tokens >= 1000000) {
            const m = tokens / 1000000;
            return (m % 1 === 0 ? m : m.toFixed(1)) + 'M';
        }
        if (tokens >= 1000) {
            return Math.round(tokens / 1024) + 'K';
        }
        return tokens + 'T';
    }

    /**
     * 优雅克制的专业能力标签格式化 (拒绝 Emoji，采用科技极简风格)
     */
    function formatCapabilitiesPills(caps) {
        if (!Array.isArray(caps) || caps.length === 0) return [];
        const pills = [];
        if (caps.includes('thinking')) pills.push('Thinking');
        if (caps.includes('vision'))   pills.push('Vision');
        if (caps.includes('coding'))   pills.push('Code');
        if (caps.includes('fast'))     pills.push('Fast');
        if (caps.includes('agent'))    pills.push('Agent');
        return pills;
    }

    /**
     * 根据模型 ID 智能推断模型能力与元数据
     */
    function inferModelCapabilities(modelId) {
        const id = String(modelId || '').toLowerCase();
        const caps = [];
        let context = 128000;
        let maxOut = 4096;
        let category = 'General 通用';

        if (id.includes('reason') || id.includes('think') || id.includes('o1') || id.includes('o3') || id.includes('r1') || id.includes('grok-4.6') || id.includes('grok-4.5') || id.includes('grok-4.20')) {
            caps.push('thinking');
            category = 'Reasoning 深度推理';
        }

        if (id.includes('vision') || id.includes('vl') || id.includes('4o') || id.includes('gemini') || id.includes('claude') || id.includes('terra') || id.includes('luna') || id.includes('flash') || id.includes('deepseek-v4')) {
            caps.push('vision');
        }

        if (id.includes('code') || id.includes('build') || id.includes('composer') || id.includes('sonnet') || id.includes('dev')) {
            caps.push('coding');
        }

        if (id.includes('flash') || id.includes('mini') || id.includes('turbo') || id.includes('lite') || id.includes('fast') || id.includes('quick')) {
            caps.push('fast');
            category = 'Fast 极速轻量';
        }

        if (id.includes('1m') || id.includes('grok-4') || id.includes('gemini-3') || id.includes('gpt-5') || id.includes('claude-4')) {
            context = 1000000;
            maxOut = 128000;
        } else if (id.includes('200k') || id.includes('claude-3')) {
            context = 200000;
            maxOut = 8192;
        } else if (id.includes('128k') || id.includes('4o') || id.includes('glm-4')) {
            context = 128000;
            maxOut = 4096;
        }

        caps.push('tools');

        return {
            id: modelId,
            name: modelId,
            contextWindow: context,
            maxTokens: maxOut,
            capabilities: caps,
            category: category
        };
    }

    /**
     * 智能丰富模型元数据
     */
    function enrichModel(modelObjOrId, provider) {
        const id = typeof modelObjOrId === 'string' ? modelObjOrId : (modelObjOrId.id || '');
        if (!id) return null;

        const pList = (provider && MODEL_CATALOG[provider]) ? MODEL_CATALOG[provider] : [];
        let matched = pList.find(m => m.id.toLowerCase() === id.toLowerCase());

        if (!matched) {
            for (const pKey in MODEL_CATALOG) {
                const found = MODEL_CATALOG[pKey].find(m => m.id.toLowerCase() === id.toLowerCase());
                if (found) { matched = found; break; }
            }
        }

        if (matched) {
            return {
                ...matched,
                ...(typeof modelObjOrId === 'object' ? modelObjOrId : {}),
                id: matched.id
            };
        }

        return {
            ...inferModelCapabilities(id),
            ...(typeof modelObjOrId === 'object' ? modelObjOrId : {})
        };
    }

    /**
     * 获取提供商预设目录
     */
    function getPresetModels(provider) {
        return (MODEL_CATALOG[provider] || []).slice();
    }

    /**
     * 生成高质感友好标签 (例: "Grok 4.6 · 1M · Thinking · Vision")
     */
    function formatOptionLabel(meta) {
        if (!meta) return '';
        const name = meta.name || meta.id;
        const ctxStr = formatContextWindow(meta.contextWindow);
        const pills = formatCapabilitiesPills(meta.capabilities);
        
        const tags = [];
        if (ctxStr) tags.push(ctxStr);
        if (pills.length > 0) tags.push(...pills);
        
        if (tags.length > 0) {
            return `${name}  (${tags.join(' · ')})`;
        }
        return name;
    }

    /**
     * 生成结构化且带 <optgroup> 的高质感 HTML
     */
    function renderModelOptionsHtml(rawModels, provider, currentSelected) {
        const presets = getPresetModels(provider);
        const modelMap = new Map();
        const cleanSelected = typeof currentSelected === 'string' ? currentSelected.trim() : '';
        const lowerSelected = cleanSelected.toLowerCase();

        // 1. 注入当前提供商的专属预设模型
        presets.forEach(m => modelMap.set(m.id.toLowerCase(), { ...m }));

        // 2. 融合动态拉取回来的模型列表
        if (Array.isArray(rawModels) && rawModels.length > 0) {
            rawModels.forEach(m => {
                const cleanId = (typeof m === 'string' ? m : (m.id || '')).replace(/^(models|publishers)\//, '');
                if (!cleanId) return;
                const enriched = enrichModel(cleanId, provider);
                modelMap.set(cleanId.toLowerCase(), enriched);
            });
        }

        // 3. 仅当自定义厂商(custom/llamacpp)或者该模型明确属于当前厂商时才追加。
        //    ★ 核心防护：如果模型列表已经是动态拉取成功的完整列表（rawModels.length > 0），
        //    则绝对不允许把历史残留模型（如 deepseek-v4-flash）强行塞到动态模型列表末尾！
        if (cleanSelected && !modelMap.has(lowerSelected)) {
            const hasDynamicModels = Array.isArray(rawModels) && rawModels.length > 0;
            const isModelBelongToProvider = (provider && MODEL_CATALOG[provider]) 
                ? MODEL_CATALOG[provider].some(m => m.id.toLowerCase() === lowerSelected)
                : false;
            if (!hasDynamicModels && (isModelBelongToProvider || provider === 'custom' || provider === 'llamacpp')) {
                const customEnriched = enrichModel(cleanSelected, provider);
                if (customEnriched) {
                    customEnriched.id = cleanSelected;
                    modelMap.set(lowerSelected, customEnriched);
                }
            }
        }

        const allModels = Array.from(modelMap.values());

        // 4. 按分类分组
        const groups = {};
        allModels.forEach(m => {
            const cat = m.category || (m.capabilities?.includes('recommend') ? 'Recommended 推荐旗舰' : 'All Models 全部模型');
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(m);
        });

        // 排序规则
        const priority = [
            'Recommended 推荐旗舰',
            'Reasoning 深度推理',
            'Code 编程开发',
            'Fast 极速轻量',
            'LongContext 超长文本',
            'Gateway 聚合',
            'Agent 智能体',
            'OpenSource 开源',
            'Legacy 经典存档',
            'Compatible 兼容通道',
            'All Models 全部模型',
            'General 通用'
        ];

        const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
            const ia = priority.indexOf(a);
            const ib = priority.indexOf(b);
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return a.localeCompare(b);
        });

        // 5. 生成 HTML
        let html = '';
        const hasMatchedAny = lowerSelected ? allModels.some(m => m.id && m.id.toLowerCase() === lowerSelected) : false;
        let isFirst = true;
        sortedGroupKeys.forEach(groupName => {
            const list = groups[groupName];
            if (!list || list.length === 0) return;
            html += `<optgroup label="── ${groupName} ──">`;
            list.forEach(m => {
                let isSelected = '';
                if (hasMatchedAny && m.id && m.id.toLowerCase() === lowerSelected) {
                    isSelected = ' selected';
                } else if (!hasMatchedAny && isFirst) {
                    isSelected = ' selected';
                }
                isFirst = false;
                const labelText = formatOptionLabel(m);
                const optVal = (hasMatchedAny && m.id && m.id.toLowerCase() === lowerSelected) ? cleanSelected : m.id;
                html += `<option value="${optVal}"${isSelected}>${labelText}</option>`;
            });
            html += '</optgroup>';
        });

        return html;
    }

    // ─────────────────────────────────────────────────────────────
    // 3. 挂载全局
    // ─────────────────────────────────────────────────────────────
    window.ModelsCatalog = {
        CATALOG: MODEL_CATALOG,
        getPresetModels: getPresetModels,
        enrichModel: enrichModel,
        inferModelCapabilities: inferModelCapabilities,
        formatContextWindow: formatContextWindow,
        formatCapabilitiesPills: formatCapabilitiesPills,
        formatOptionLabel: formatOptionLabel,
        renderModelOptionsHtml: renderModelOptionsHtml
    };

})(window);
