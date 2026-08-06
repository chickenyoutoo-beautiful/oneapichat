// utils.js — 工具函数 v1.0 (Phase 7 拆分自 main.js)
// onProviderChange / shouldUseVisionFormat / buildUserContent / checkStorage

// ==================== 工具函数 ====================

window.onProviderChange = async function() {
    var provider = getEl('baseUrlProvider')?.value || 'custom';
    var cfg = API_PROVIDERS[provider] || API_PROVIDERS.custom;

    // 1. 保存当前 Key 到旧厂商(永远存到独立 key,不碰 apiKey)
    var curKey = getVal('apiKey') || '';
    var oldP = localStorage.getItem('baseUrlProvider') || '';
    if (oldP && oldP !== provider && curKey) {
        var oldCfg = API_PROVIDERS[oldP] || {};
        // ★ 存到旧厂商的独立 key,不覆盖 apiKey
        if (oldCfg.keyLS) localStorage.setItem(oldCfg.keyLS, await encrypt(curKey));
    }

    // 2. Base URL
    if (provider === 'custom') setVal('baseUrl', localStorage.getItem('baseUrlCustom') || '');
    else setVal('baseUrl', cfg.baseUrl || '');

    // 3. API Key 从新厂商加载
    var savedKey = localStorage.getItem(cfg.keyLS);
    var cleanKey = '';
    if (savedKey) { var dk = await decrypt(savedKey); cleanKey = (dk && dk !== 'not-needed') ? dk : ''; }
    setVal('apiKey', cleanKey);
    localStorage.setItem('apiKey', cleanKey);
    localStorage.setItem('baseUrlProvider', provider);

    // 4. UI
    var label = getEl('apiKeyLabel'); if (label) label.textContent = 'API Key (' + cfg.label + ')';
    var input = getEl('apiKey'); if (input) {
        if (provider === 'llamacpp') {
            input.placeholder = '本地模型无需 Key (可选)';
            label.textContent = 'API Key (可选)';
        } else if (provider === 'custom') {
            input.placeholder = '自定 URL 和 Key';
        } else {
            input.placeholder = cfg.label + ' API Key';
        }
    }

    // 5. 模型
    // ★ 每个 Provider 的默认模型(切换 Provider 时立即生效,避免发送旧 Provider 的模型名)
    var PROVIDER_DEFAULT_MODELS = {
        deepseek: 'deepseek-chat', openai: 'gpt-4o', xai: 'grok-4-latest',
        antthropic: 'claude-sonnet-4-20250514', minimax: 'MiniMax-M3',
        gemini: 'gemini-2.0-flash', zhipu: 'glm-4-flash', qwen: 'qwen-turbo',
        moonshot: 'moonshot-v1-8k', doubao: 'doubao-lite-32k', mimo: 'mimo-v2-flash',
        openrouter: 'openai/gpt-4o', longcat: 'LongCat-2.0', llamacpp: ''
    };
    // ★ 有活动流式请求时, 仅更新 localStorage (下次发送生效), 不改 DOM 的 modelSelect.value
    //   — 防止 .value 变化触发 select 的 change 事件 → saveConfig → fetchModels → 替换 innerHTML → 中断正在输出的模型
    var _activeStreamChatId = window._activeStreamChatId;
    var sm = localStorage.getItem('model_' + provider) || '';
    if (sm) { if (!_activeStreamChatId) setVal('modelSelect', sm); localStorage.setItem('model', sm); }
    else {
        var _defModel = PROVIDER_DEFAULT_MODELS[provider] || '';
        if (!_activeStreamChatId) setVal('modelSelect', _defModel);
        localStorage.setItem('model', _defModel);
        // ★ 同时持久化默认模型到 model_{provider},确保切换回来时能记住 (即使未显式选择模型)
        if (_defModel) localStorage.setItem('model_' + provider, _defModel);
    }

    _currentProvider = provider;
    if (typeof _updateThinkingIntensityVisibility === 'function') _updateThinkingIntensityVisibility();
    console.log('[PROVIDER] ->' + provider + ' key:' + (cleanKey ? '***' : 'empty') + ' url:' + getVal('baseUrl'));
    console.log('[PROVIDER] localStorage apiKey:', localStorage.getItem('apiKey') ? 'SET' : 'EMPTY');
    console.log('[PROVIDER] input apiKey.value:', getEl('apiKey')?.value ? 'SET' : 'EMPTY');

    // ★ 切换厂商后立即同步到服务器
    window._scheduleConfigSync();
    // ★ 注意: 不再在此处调用 fetchModels — 模型列表刷新统一在 saveConfig 时执行,
    //   避免切换提供商时替换 modelSelect.innerHTML 中断正在生成的模型
};
function getCurrentApiKeyLSKey() {
    var p = getEl('baseUrlProvider')?.value || 'custom';
    return (API_PROVIDERS[p] || API_PROVIDERS.custom).keyLS;
}

// LongCat 统一识别：模型名、官方端点或 provider 任一命中即可。
window.isLongCat = function(model, baseUrl, provider) {
    if (model === undefined) model = typeof getVal === 'function' ? (getVal('modelSelect') || '') : '';
    if (baseUrl === undefined) baseUrl = typeof getVal === 'function' ? (getVal('baseUrl') || '') : '';
    if (provider === undefined) {
        provider = (typeof getEl === 'function' && getEl('baseUrlProvider')?.value)
            || localStorage.getItem('baseUrlProvider') || '';
    }
    return String(model || '').toLowerCase().includes('longcat')
        || String(baseUrl || '').toLowerCase().includes('api.longcat.chat')
        || String(provider || '').toLowerCase() === 'longcat';
};

// LongCat OpenAI 格式只接受纯文本 content，并且不接受历史消息中的
// reasoning_content/reasoning_details 等非标准字段。该清洗必须只对 LongCat 生效。
window.sanitizeForLongCat = function(apiMessages, options) {
    options = options || {};
    if (!Array.isArray(apiMessages)) return [];
    if (!options.force && !window.isLongCat()) return apiMessages;
    var _fixed = 0;
    for (var i = 0; i < apiMessages.length; i++) {
        var m = apiMessages[i];
        if (!m || typeof m !== 'object') continue;
        // 官方文档明确 LongCat-2.0 仅支持文本输入；图像块转为占位文本。
        if (Array.isArray(m.content)) {
            _fixed++;
            m.content = m.content.map(function(c) {
                if (typeof c === 'string') return c;
                if (c && typeof c === 'object') {
                    if (c.type === 'text') return c.text || '';
                    if (c.type === 'image_url' || c.type === 'image') return '[图片]';
                    if (c.type === 'video_url' || c.type === 'video') return '[视频]';
                    if (c.type === 'tool_result') {
                        return typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '');
                    }
                    return '';
                }
                return '';
            }).filter(Boolean).join('\n');
        }
        // 空内容替换为占位符
        if (m.content === '' || m.content === null || m.content === undefined) {
            m.content = '(empty)';
            _fixed++;
        }
        delete m.reasoning_content;
        delete m.reasoning;
        delete m.reasoning_details;
        delete m._srcIndex;
        delete m._useVisionModel;
        delete m._hadReasoning;
        delete m.partial;
        delete m._remove;
        delete m._removeOrphan;
        // 确保 tool_calls 中的 arguments 是字符串
        if (m.tool_calls && Array.isArray(m.tool_calls)) {
            m.tool_calls = m.tool_calls.map(function(tc) {
                if (tc && tc.function && typeof tc.function.arguments === 'object') {
                    tc.function.arguments = JSON.stringify(tc.function.arguments || {});
                }
                return tc;
            });
        }
    }
    if (_fixed > 0) console.log('[LongCat] 已将 ' + _fixed + ' 条非文本消息转为纯文本');
    return apiMessages;
};

function logDebug(...args) {
}

// ★ 视觉预分析: 用独立的视觉模型分析图片, 返回文本描述
// 当主模型不支持视觉或视觉分析失败时, 用此函数先分析图片
window._analyzeImagesWithVisionProvider = async function(files) {
    var provider = localStorage.getItem('visionProvider') || '';
    if (!provider) return null; // 未配置视觉提供商

    var apiKey, apiUrl, model;
    if (provider === 'xai') {
        apiKey = await decrypt(localStorage.getItem('visionApiKeyXAI') || '');
        apiUrl = localStorage.getItem('visionApiUrlXAI') || 'https://api.x.ai/v1';
        model = localStorage.getItem('visionModel') || 'grok-4.5';
    } else if (provider === 'openai') {
        apiKey = await decrypt(localStorage.getItem('visionApiKeyOpenAI') || '');
        apiUrl = localStorage.getItem('visionApiUrlOpenAI') || 'https://api.openai.com/v1';
        model = localStorage.getItem('visionModel') || 'gpt-4o';
    } else if (provider === 'custom') {
        apiKey = await decrypt(localStorage.getItem('visionApiKeyCustom') || '');
        apiUrl = localStorage.getItem('visionApiUrlCustom') || '';
        model = localStorage.getItem('visionModel') || '';
    } else if (provider === 'minimax') {
        apiKey = await decrypt(localStorage.getItem('visionApiKey') || '');
        apiUrl = localStorage.getItem('visionApiUrl') || 'https://api.minimaxi.com/v1/coding_plan/vlm';
        model = localStorage.getItem('visionModel') || 'MiniMax-VL-01';
    } else {
        return null;
    }

    if (!apiKey || !apiUrl) return null; // 没有 API Key 或地址

    // 提取图片文件
    var imageFiles = files.filter(function(f) { return f.isImage || (f.type && f.type.startsWith('image/')); });
    if (imageFiles.length === 0) return null;

    console.log('[VisionPreAnalysis] 使用 ' + provider + '/' + model + ' 分析 ' + imageFiles.length + ' 张图片');

    // ★ 构建视觉分析请求: 强制 base64 (xAI 无法下载外部 URL)
    var content = [];
    for (var i = 0; i < imageFiles.length; i++) {
        var f = imageFiles[i];
        var imgData = f.content || '';
        // 只用 base64 data URL, 不用外部 URL
        if (imgData && imgData.startsWith('data:')) {
            content.push({ type: 'image_url', image_url: { url: imgData, detail: 'auto' } });
        }
    }
    if (content.length === 0) {
        console.warn('[VisionPreAnalysis] 没有可用的 base64 图片数据 (图片可能已被剥离 content)');
        return null;
    }

    content.unshift({ type: 'text', text: '请详细描述这些图片的内容，包括可见的文字、物体、场景、颜色、布局等信息。每张图片用 [图片N] 标记开头。' });

    try {
        // ★ 使用 proxyFetch 走服务器代理 (避免 CORS + 走 Mihomo 代理)
        var apiEndpoint = apiUrl.replace(/\/$/, '') + '/chat/completions';
        var requestBody = JSON.stringify({ model: model, messages: [{ role: 'user', content: content }], max_tokens: 4096, stream: false });

        console.log('[VisionPreAnalysis] 请求 ' + apiEndpoint + ', 图片数: ' + content.length + ', 请求体大小: ' + (requestBody.length / 1024 / 1024).toFixed(1) + 'MB');

        // ★ proxyFetch 内置代理逻辑: 代理ON走proxy.php中继, 代理OFF直连+回退
        var resp = await window.proxyFetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
            body: requestBody
        });

        if (!resp.ok) {
            var errText = await resp.text().catch(function() { return ''; });
            console.warn('[VisionPreAnalysis] API 错误: HTTP ' + resp.status, errText.substring(0, 300));
            return null;
        }
        var data = await resp.json();
        var analysis = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (analysis) {
            console.log('[VisionPreAnalysis] 分析完成, 长度:', analysis.length);
            return analysis;
        }
    } catch(e) {
        console.warn('[VisionPreAnalysis] 失败:', e.message);
    }
    return null;
};

/** 获取某个模型的配置 */
function _getModelConfigObj(name) {
    name = name || _getCurModel();
    if (window.MODEL_CONFIGS) return window.MODEL_CONFIGS.getConfig(name);
    return {};
}

// 优先检查 _forceVisionFormat 标志(对话中有图片时由 buildApiMessages 设置)
function shouldUseVisionFormat() {
    // 强制视觉格式仅在当前模型支持视觉时生效
    if (window._forceVisionFormat) {
        var currentModel = getVal('modelSelect') || DEFAULT_CONFIG.model || '';
        // ★ 使用模型配置:检查模型是否支持视觉
        var _vm = _getModelCfg().supportsVision(currentModel);
        if (!_vm) return false; // 文本模型不支持视觉格式,由 analyze_image 工具处理
        return true;
    }

    var visionModel = localStorage.getItem('visionModel') || '';
    var model = getVal('modelSelect') || localStorage.getItem('model') || '';

    // 精确的视觉模型关键词(只包含真正的视觉模型)
    var visionKeywords = [
        'vl-',           // 视觉语言模型前缀
        '-vl',           // 视觉语言模型后缀
        'vision',        // 明确包含 vision
        'minimax-vl',    // MiniMax 视觉模型
        'minimax-m3',    // MiniMax M3 原生多模态
        'qwen-vl',       // Qwen 视觉模型
        'gemini-1.5',    // Gemini 1.5 支持多模态
        'claude-3'       // Claude 3 系列
    ];

    // 检查模型名称是否包含视觉关键词
    var modelLower = model.toLowerCase();
    var visionModelLower = visionModel.toLowerCase();

    var hasVisionKeyword = visionKeywords.some(k =>
        modelLower.includes(k.toLowerCase()) || visionModelLower.includes(k.toLowerCase())
    );

    // 额外的检查:排除误判的文本模型
    // ★ 使用模型配置:检查模型是否明确声明支持视觉
    var _visionSupported = false;
    try {
        if (window.MODEL_CONFIGS) {
            _visionSupported = window.MODEL_CONFIGS.supportsVision(modelLower);
        }
    } catch(e) {}
    // 如果不是视觉模型,且没有视觉关键词,返回 false
    if (!_visionSupported && !visionModel && !hasVisionKeyword) return false;
    if (_visionSupported) return true;
    // 后备:从本地存储读取自动添加的文本模型
    try {
        var autoTextModels = JSON.parse(localStorage.getItem('autoDetectedTextModels') || '[]');
        for (var _ati = 0; _ati < autoTextModels.length; _ati++) {
            if (modelLower.indexOf(autoTextModels[_ati]) !== -1) return false;
        }
    } catch (e) {}
    // 特定的非视觉模型黑名单(内置)
    var textModels = ['deepseek-reasoner', 'grok-3-reasoning'];
    var isTextModel = textModels.some(tm => modelLower.includes(tm));

    // 如果有视觉关键词且不是文本模型,返回 true
    return (visionModel || hasVisionKeyword) && !isTextModel;
}

function buildUserContent(text, files) {
    if (!files?.length) return text;

    // 检查是否包含图片
    var hasImages = files.some(f => f.isImage || f.type?.startsWith('image/'));

    if (hasImages && shouldUseVisionFormat()) {
        var _allImageFiles = files.filter(f => f.isImage || f.type?.startsWith('image/'));
        console.log('[Vision] shouldUseVisionFormat=true, 图片数:', _allImageFiles.length);
        // OpenAI 视觉模型格式:数组
        var content = [];
        var _baseUrl = (getVal?.('baseUrl') || localStorage.getItem('baseUrl') || '').toLowerCase();
        var _isLocalModel = _baseUrl.includes('localmodels') || _baseUrl.includes('localhost') || _baseUrl.includes('127.0.0.1') || _baseUrl.includes('192.168.');
        var _modelStr = (getVal?.('modelSelect') || localStorage.getItem('model') || '').toLowerCase();
        // ★ xAI 检测: 从 baseUrl 或模型名判断 (更可靠)
        var _isXai = _baseUrl.indexOf('api.x.ai') !== -1 || _modelStr.indexOf('grok') !== -1;
        // ★ 图片数量限制: 避免请求体过大导致连接断开
        var _maxImages = _isXai ? 10 : 20;  // xAI 限制更严格
        var _imageFiles = _allImageFiles;
        if (_allImageFiles.length > _maxImages) {
            console.warn('[Vision] ⚠️ 图片过多 (' + _allImageFiles.length + '), 限制为前 ' + _maxImages + ' 张');
            showToast('⚠️ 单次最多发送 ' + _maxImages + ' 张图片（当前 ' + _allImageFiles.length + ' 张），已截取前 ' + _maxImages + ' 张', 'warning', 5000);
            _imageFiles = _allImageFiles.slice(0, _maxImages);
        }
        for (var _fi = 0; _fi < _imageFiles.length; _fi++) {
            var f = _imageFiles[_fi];
            if (f.isImage || f.type?.startsWith('image/')) {
                // ★ xAI: 强制用 base64 data URL (xAI 无法下载外部 URL)
                // 其他模型: 优先用服务器 URL (节省请求体大小)
                var _imgUrl;
                if (f.content && f.content.startsWith('data:')) {
                    // 有 base64 数据, 直接用
                    _imgUrl = f.content;
                } else if (_isXai && f.serverUrl) {
                    // xAI 但没有 base64: 尝试从服务器获取并转为 base64
                    console.warn('[Vision] ⚠️ xAI 图片无 base64, 尝试从服务器获取:', f.name);
                    // 同步无法 fetch, 只能先用 URL (可能失败) 或跳过
                    _imgUrl = f.serverUrl.startsWith('http') ? f.serverUrl : window.location.origin + f.serverUrl;
                } else if (f.serverUrl) {
                    _imgUrl = f.serverUrl.startsWith('http') ? f.serverUrl : window.location.origin + f.serverUrl;
                } else if (f.content) {
                    _imgUrl = f.content;
                } else {
                    console.warn('[Vision] ⚠️ 跳过无数据图片:', f.name);
                    continue;
                }
                console.log('[Vision] 📷[' + (_fi+1) + '/' + _imageFiles.length + '] name:', f.name, 'mode:', (_imgUrl.startsWith('data:') ? 'BASE64' : 'URL'), 'len:', _imgUrl.length);
                content.push({
                    type: 'image_url',
                    image_url: { url: _imgUrl, detail: 'auto' }
                });
            } else if (f.isVideo || f.type?.startsWith('video/')) {
                // M3 原生视频理解
                var _vidUrl = f.serverUrl || f.content || '';
                if (_vidUrl && !_vidUrl.startsWith('http')) {
                    _vidUrl = window.location.origin + _vidUrl;
                }
                console.log('[Vision] 🎬 ' + _vidUrl.substring(0, 50) + '...');
                content.push({
                    type: 'video_url',
                    video_url: { url: _vidUrl }
                });
            } else if (f.hasEmbeddedImages && f.extractedImages && f.extractedImages.length > 0) {
                // ★ Office 文档内嵌图片：先推图片，再推文本
                for (var _eii = 0; _eii < f.extractedImages.length; _eii++) {
                    var _eimg = f.extractedImages[_eii];
                    console.log('[Vision] 🖼️ PPTX图片:', _eimg.name, 'size:', (_eimg.size / 1024).toFixed(0) + 'KB');
                    content.push({
                        type: 'image_url',
                        image_url: { url: _eimg.dataUrl, detail: 'auto' }
                    });
                }
                // 文本附后
                var _fText2 = f.content || '';
                if (_fText2.length > 80000) _fText2 = _fText2.substring(0, 80000) + '\n...(文件过长已截断)';
                content.push({ type: 'text', text: _fText2 || ('[PPTX 文档，含 ' + f.extractedImages.length + ' 张图片]') });
            } else {
                // 非图片文件: 注入服务器路径元信息
                var _isVid = f.isVideo || (f.type && f.type.startsWith('video/'));
                var _info = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;display:inline;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> 附件: ${f.name} (${(f.size/1024/1024).toFixed(1)}MB)`;
                // ★ v2.6.3: 告诉模型服务器上的真实文件路径, 可直接用于 cr_upload_file
                if (f.serverPath) {
                    _info += `\n服务器路径: ${f.serverPath}`;
                    _info += `\n💡 上传到云盘: cr_upload_file { file_path: "${f.serverPath}" }`;
                } else if (f.serverUrl) {
                    _info += `\nURL: ${f.serverUrl}`;
                }
                if (_isVid && f.serverPath) {
                    _info += `\n⚠️ video_edit: input_path="${f.serverPath}"`;
                }
                if (!_isVid && !f.isBinary) {
                    var _fText = f.content || '';
                    if (_fText.length > 80000) _fText = _fText.substring(0, 80000) + '\n...(文件过长已截断)';
                    if (_fText) _info += '\n' + _fText;
                }
                content.push({ type: 'text', text: _info });
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
        var imageFiles = files.filter(f => f.type?.startsWith('image/'));
        // 保存当前消息的图片数据到 chat 隔离变量,供 analyze_image 工具处理器使用
        if (!window._currentMessageImagesByChat) window._currentMessageImagesByChat = {};
        // ★ 也收集 Office 文档内嵌图片（供 analyze_image 工具使用）
        var _allImages = imageFiles.map(f => ({ name: f.name, content: f.content, type: f.type }));
        var _officeImages = [];
        files.forEach(function(f) {
            if (f.hasEmbeddedImages && f.extractedImages) {
                f.extractedImages.forEach(function(ei) {
                    _allImages.push({ name: ei.name, content: ei.dataUrl, type: ei.dataUrl.split(';')[0].replace('data:', '') || 'image/png' });
                    _officeImages.push(ei.name);
                });
            }
        });
        window._currentMessageImagesByChat[currentChatId] = _allImages;

        var imageDescs = imageFiles.map(f => {
            var _d = `[用户上传了图片: ${f.name}]`;
            if (f.serverPath) _d += `\n💡 文件路径: ${f.serverPath}`;
            else if (f.serverUrl) _d += `\n🌐 URL: ${f.serverUrl}`;
            return _d;
        });
        if (_officeImages.length > 0) {
            imageDescs.push('[PPTX内嵌图片: ' + _officeImages.join(', ') + ']');
        }
        var otherFiles = files.filter(f => !f.type?.startsWith('image/') && !f.hasEmbeddedImages);
        var otherContent = otherFiles.length
            ? otherFiles.map(f => {
                var _isV = f.isVideo || (f.type && f.type.startsWith('video/'));
                var _oi = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;display:inline;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> 附件: ${f.name} (${(f.size/1024/1024).toFixed(1)}MB)`;
                if (f.serverPath) {
                    _oi += `\n💡 服务器路径: ${f.serverPath}`;
                    if (_isV) _oi += `\n⚠️ video_edit: input_path="${f.serverPath}"`;
                } else if (f.serverUrl) {
                    _oi += `\n🌐 URL: ${f.serverUrl}`;
                }
                if (!_isV) {
                    var _fc = f.content || '';
                    if (_fc.length > 80000) _fc = _fc.substring(0, 80000) + '\n...(文件过长已截断)';
                    if (_fc) _oi += '\n' + _fc;
                }
                return _oi;
            }).join('\n\n')
            : '';
        // ★ 补充 Office 文档文本内容（即使有内嵌图片，文字也需传给文本模型）
        var _officeContent = '';
        files.forEach(function(f) {
            if (f.hasEmbeddedImages && f.content) {
                var _oc = f.content || '';
                if (_oc.length > 80000) _oc = _oc.substring(0, 80000) + '\n...(文件过长已截断)';
                _officeContent += (_officeContent ? '\n\n' : '') + _oc;
            }
        });
        var imagePart = imageDescs.join(', ');
        // 不强制要求调用工具,让AI自主决定是否分析图片
        // 工具 analyze_image 已在请求中提供,AI可以自主选择调用
        var textPart = text ? `\n用户指令: ${text}` : '';
        var _parts = [];
        if (imagePart) _parts.push(imagePart);
        if (otherContent) _parts.push(otherContent);
        if (_officeContent) _parts.push(_officeContent);
        if (textPart) _parts.push(textPart);
        return _parts.join('\n\n').trim();
    }

    // 非图片文件:保持原有文本格式,但截断超大附件避免超token
    var MAX_FILE_CHARS = 80000;
    var fileParts = files.map(f => {
        // ★ 视频/大文件: 不传 base64 内容到模型,而是注入服务器路径元信息
        var isVideo = f.isVideo || (f.type && f.type.startsWith('video/'));
        var c = f.content || '';
        var info = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;display:inline;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> 附件: ${f.name} (${(f.size/1024/1024).toFixed(1)}MB)`;
        if (f.serverUrl) {
            info += `\n服务器路径: ${f.serverUrl}`;
            if (isVideo) {
                info += `\n⚠️ 视频已上传到服务器,可直接用此路径调用 video_edit 工具。格式: video_edit action="info" input_path="${f.serverUrl}"`;
            }
        }
        if (!isVideo && c.length <= MAX_FILE_CHARS) {
            info += `\n${c}`;
        } else if (!isVideo && c.length > MAX_FILE_CHARS) {
            info += `\n${c.substring(0, MAX_FILE_CHARS)}\n...(文件过长已截断,原始长度${c.length}字符)`;
        }
        // 视频不传 base64,避免超 token
        return info;
    });
    return fileParts.join('\n\n') + (text ? `\n指令: ${text}` : '');
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
            var keysToCheck = ['imageCache', 'fileCache', 'tempData', 'uploadCache'];
            keysToCheck.forEach(key => {
                if (localStorage.getItem(key)) {
                    localStorage.removeItem(key);
                }
            });

            // 3. 清理过期的配置数据
            var configKeys = Object.keys(localStorage).filter(k =>
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
    // ★ Agent 域聊天(_agent_main/_agent_old_*)不参与清理: id 无时间戳解析成 NaN 会排最前被优先删除
    var ids = Object.keys(chats).filter(id => !isAgentChat(id));
    ids.sort((a, b) => (parseInt(a.split('_')[1]) || 0) - (parseInt(b.split('_')[1]) || 0));
    if (ids.length <= keep) return;
    ids.slice(0, ids.length - keep).forEach(id => delete chats[id]);
    saveChatsDebounced();
}

// ★ fetchWithRetry — 带重试的 fetch (HTTP 529 指数退避)
window.fetchWithRetry = async function(url, options, maxRetries, retryDelay) {
    maxRetries = maxRetries || 3;
    retryDelay = retryDelay || 1000;
    var lastError;
    // ★ 同步网络代理: 代理开启时使用 proxyFetch 路由
    var _fetchFn = window.proxyFetch;  // ★ 统一走 proxyFetch: 直连→回退

    for (var attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            var response = await _fetchFn(url, options);

            if (!response.ok) {
                var status = response.status;
                var statusText = response.statusText;

                if (status === 529) {
                    console.warn('[fetchWithRetry] HTTP 529 (attempt ' + attempt + '/' + maxRetries + ')');
                    if (attempt < maxRetries) {
                        var delay = retryDelay * Math.pow(2, attempt - 1);
                        await new Promise(function(resolve) { setTimeout(resolve, delay); });
                        continue;
                    } else {
                        throw new Error('服务过载,请稍后重试 (HTTP 529)');
                    }
                }
                throw new Error('HTTP ' + status + ': ' + statusText);
            }
            return response;
        } catch (error) {
            lastError = error;
            if (error.message.indexOf('529') !== -1 || error.message.indexOf('过载') !== -1) {
                if (attempt === maxRetries) {
                    throw new Error('请求失败,重试 ' + maxRetries + ' 次后仍然失败: ' + error.message);
                }
                var delay2 = retryDelay * Math.pow(2, attempt - 1);
                await new Promise(function(resolve) { setTimeout(resolve, delay2); });
                continue;
            }
            throw error;
        }
    }
    throw lastError;
};

// ═══════════════════════════════════════════════════════════════
// Diff 工具 — LCS 算法 + unified diff 生成
// ═══════════════════════════════════════════════════════════════
(function() {
    // LCS 表构建
    function _lcsTable(a, b) {
        var m = a.length, n = b.length;
        var dp = new Array(m + 1);
        for (var i = 0; i <= m; i++) { dp[i] = new Array(n + 1); for (var j = 0; j <= n; j++) dp[i][j] = 0; }
        for (var i = 1; i <= m; i++) {
            for (var j = 1; j <= n; j++) {
                if (a[i-1] === b[j-1]) dp[i][j] = dp[i-1][j-1] + 1;
                else dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
            }
        }
        return dp;
    }

    // 回溯生成 diff hunks
    function _backtrack(dp, a, b, i, j) {
        var hunks = [];
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
                hunks.unshift({type: 'equal', oldLine: a[i-1], newLine: b[j-1]});
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
                hunks.unshift({type: 'add', newLine: b[j-1]});
                j--;
            } else {
                hunks.unshift({type: 'del', oldLine: a[i-1]});
                i--;
            }
        }
        return hunks;
    }

    /**
     * 计算两个字符串的 diff
     * @returns {Array<{type:'equal'|'add'|'del', oldLine?:string, newLine?:string}>}
     */
    window.computeDiff = function(oldStr, newStr) {
        var oldLines = (oldStr || '').split('\n');
        var newLines = (newStr || '').split('\n');
        var dp = _lcsTable(oldLines, newLines);
        return _backtrack(dp, oldLines, newLines, oldLines.length, newLines.length);
    };

    /**
     * 生成 unified diff 文本
     */
    window.unifiedDiff = function(oldStr, newStr, filename) {
        filename = filename || 'file';
        var hunks = window.computeDiff(oldStr, newStr);
        var result = ['--- a/' + filename, '+++ b/' + filename, '@@ -0,0 +0,0 @@'];
        for (var i = 0; i < hunks.length; i++) {
            var h = hunks[i];
            if (h.type === 'equal') result.push(' ' + h.oldLine);
            else if (h.type === 'add') result.push('+' + h.newLine);
            else if (h.type === 'del') result.push('-' + h.oldLine);
        }
        return result.join('\n');
    };
})();

// ═══════════════════════════════════════════════════════════════
// 代码编辑 — Diff 视图 + Apply/Revert 按钮
// ═══════════════════════════════════════════════════════════════

/**
 * 在气泡中展示 diff 视图（代码编辑预览）
 * @param {string} filename - 文件路径
 * @param {string} oldCode - 原始代码
 * @param {string} newCode - 新代码
 * @param {Element} targetEl - 要附加到的 DOM 元素
 */
window.showDiffView = function(filename, oldCode, newCode, targetEl) {
    if (!targetEl) return;
    var hunks = window.computeDiff(oldCode, newCode);
    var addCount = 0, delCount = 0;
    hunks.forEach(function(h) {
        if (h.type === 'add') addCount++;
        if (h.type === 'del') delCount++;
    });

    var wrapper = document.createElement('div');
    wrapper.className = 'diff-view-wrapper';
    wrapper.style.cssText = 'margin:8px 0;border:1px solid var(--border-color,#e5e7eb);border-radius:8px;overflow:hidden;font-family:var(--font-mono);font-size:13px;';

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'background:var(--bg-secondary,#f9fafb);padding:8px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border-color,#e5e7eb);';
    header.innerHTML = '<span style="font-weight:600;color:var(--text-primary,#111);">📝 ' + (filename || '代码编辑') + '</span>' +
        '<span style="font-size:12px;">' +
        '<span style="color:#16a34a;margin-right:8px;">+' + addCount + '</span>' +
        '<span style="color:#dc2626;">-' + delCount + '</span></span>';
    wrapper.appendChild(header);

    // Diff content
    var content = document.createElement('div');
    content.style.cssText = 'max-height:400px;overflow-y:auto;padding:4px 0;';
    var linesHtml = '';
    for (var i = 0; i < hunks.length; i++) {
        var h = hunks[i];
        var escaped = (h.oldLine || h.newLine || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        if (h.type === 'add') {
            linesHtml += '<div style="background:#dcfce7;color:#166534;padding:1px 12px;white-space:pre-wrap;">+ ' + escaped + '</div>';
        } else if (h.type === 'del') {
            linesHtml += '<div style="background:#fee2e2;color:#991b1b;padding:1px 12px;white-space:pre-wrap;">- ' + escaped + '</div>';
        } else {
            linesHtml += '<div style="padding:1px 12px;white-space:pre-wrap;color:var(--text-secondary,#6b7280);">  ' + escaped + '</div>';
        }
    }
    content.innerHTML = linesHtml;
    wrapper.appendChild(content);

    // Action buttons
    var actions = document.createElement('div');
    actions.style.cssText = 'padding:6px 12px;border-top:1px solid var(--border-color,#e5e7eb);display:flex;gap:8px;background:var(--bg-secondary,#f9fafb);';
    var applyBtn = document.createElement('button');
    applyBtn.textContent = '✅ Apply';
    applyBtn.style.cssText = 'padding:4px 12px;border:1px solid #16a34a;background:#16a34a;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;';
    applyBtn.onclick = function() {
        window.applyCodeEdit(filename, oldCode, newCode, applyBtn);
    };
    var revertBtn = document.createElement('button');
    revertBtn.textContent = '↩ Revert';
    revertBtn.style.cssText = 'padding:4px 12px;border:1px solid #dc2626;background:transparent;color:#dc2626;border-radius:4px;cursor:pointer;font-size:12px;';
    revertBtn.onclick = function() {
        wrapper.remove();
    };
    actions.appendChild(applyBtn);
    actions.appendChild(revertBtn);
    wrapper.appendChild(actions);

    targetEl.appendChild(wrapper);
    wrapper.scrollIntoView({behavior:'smooth',block:'nearest'});
};

/**
 * 应用代码编辑 — 调用引擎 file_edit 端点
 */
window.applyCodeEdit = async function(filename, oldStr, newStr, btnEl) {
    if (!filename) {
        window.showToast?.('❌ 缺少文件路径', 'error');
        return;
    }
    if (btnEl) { btnEl.textContent = '⏳ 应用...'; btnEl.disabled = true; }
    try {
        var resp = await fetch('/engine/file_edit?path=' + encodeURIComponent(filename), {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({old_string: oldStr, new_string: newStr})
        });
        var result = await resp.json();
        if (result.ok) {
            window.showToast?.('✅ 已应用编辑到 ' + filename + ' (备份: ' + (result.backup || filename + '.bak') + ')', 'success', 4000);
        } else {
            window.showToast?.('❌ 编辑失败: ' + (result.error || '未知错误'), 'error', 5000);
        }
    } catch(e) {
        window.showToast?.('❌ 请求失败: ' + e.message, 'error');
    }
    if (btnEl) { btnEl.textContent = '✅ Apply'; btnEl.disabled = false; }
};

/**
 * 为代码块添加 Apply 按钮（postRender 后调用）
 */
window.addCodeBlockButtons = function(container) {
    if (!container) return;
    var _pres = container.querySelectorAll('pre');
    if (_pres.length > 100) return;  // 安全防护，超大页面跳过
    _pres.forEach(function(pre) {
        if (pre.querySelector('.code-apply-btn')) return; // 已添加
        var code = pre.querySelector('code');
        if (!code) return;
        var className = code.className || '';
        var langMatch = className.match(/language-(\w+)/);
        var lang = langMatch ? langMatch[1] : '';
        // 只在可编辑语言上显示按钮
        var editableLangs = ['python','js','javascript','ts','typescript','html','css','json','php','sh','bash','yaml','yml','toml','xml','sql','go','rust','java','c','cpp','rb','lua','swift','kt','md','markdown'];
        if (!lang || editableLangs.indexOf(lang) === -1) return;

        // ★ 修复: 不再绝对定位盖住复制按钮 — 整合进 .code-actions 容器
        //   (attachCodeCopyButtons 已注入复制/运行按钮, top:4px right:4px z-index:5;
        //    原 Apply 按钮同位置 z-index:10 会完全遮挡复制按钮)
        var actions = pre.querySelector('.code-actions');
        var btn = document.createElement('div');
        btn.className = 'code-copy-btn code-apply-btn'; // 复用图标按钮样式, 跟随容器悬停显隐
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
        btn.title = '预览并应用代码编辑';
        if (actions) {
            actions.appendChild(btn);
        } else {
            // 兜底: 老页面无容器时挂到 pre, 位置避开右上角(复制按钮下方)
            btn.style.cssText = 'position:absolute;top:36px;right:8px;z-index:10;';
            pre.style.position = pre.style.position || 'relative';
            pre.appendChild(btn);
        }

        btn.onclick = function() {
            var codeText = code.textContent || '';
            // 尝试从代码块前的注释中提取文件路径
            var filename = '';
            var prevEl = pre.previousElementSibling;
            if (prevEl && prevEl.tagName === 'P') {
                var fm = prevEl.textContent.match(/(?:文件|file|path)[：:]\s*(\S+)/i);
                if (fm) filename = fm[1];
            }
            if (!filename) {
                filename = prompt('输入文件路径（相对于 /var/www/html/oneapichat/）:', filename || '');
                if (!filename) return;
            }
            // 获取原始文件内容→生成 diff
            fetch('/engine/file_read?path=' + encodeURIComponent(filename))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var oldContent = data.content || '';
                    window.showDiffView(filename, oldContent, codeText, pre.parentElement);
                })
                .catch(function() {
                    window.showDiffView(filename, '', codeText, pre.parentElement);
                });
        };
    });
};

