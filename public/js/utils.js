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
        openrouter: 'openai/gpt-4o', opencode: 'gpt-4o', llamacpp: ''
    };
    var sm = localStorage.getItem('model_' + provider) || '';
    if (sm) { setVal('modelSelect', sm); localStorage.setItem('model', sm); }
    else {
        var _defModel = PROVIDER_DEFAULT_MODELS[provider] || '';
        setVal('modelSelect', _defModel);
        localStorage.setItem('model', _defModel);
    }

    _currentProvider = provider;
    console.log('[PROVIDER] ->' + provider + ' key:' + (cleanKey ? '***' : 'empty') + ' url:' + getVal('baseUrl'));
    console.log('[PROVIDER] localStorage apiKey:', localStorage.getItem('apiKey') ? 'SET' : 'EMPTY');
    console.log('[PROVIDER] input apiKey.value:', getEl('apiKey')?.value ? 'SET' : 'EMPTY');

    // ★ 切换厂商后自动刷新模型列表(延迟让 UI 先更新)
    setTimeout(function() {
        if (typeof window.fetchModels === 'function') {
            window.fetchModels(true).catch(function(){});
        }
    }, 200);
};
function getCurrentApiKeyLSKey() {
    var p = getEl('baseUrlProvider')?.value || 'custom';
    return (API_PROVIDERS[p] || API_PROVIDERS.custom).keyLS;
}

function logDebug(...args) {
}




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
        console.log('[Vision] shouldUseVisionFormat=true, 图片数:', files.filter(f => f.isImage || f.type?.startsWith('image/')).length);
        // OpenAI 视觉模型格式:数组
        var content = [];
        var _baseUrl = (getVal?.('baseUrl') || localStorage.getItem('baseUrl') || '').toLowerCase();
        var _isLocalModel = _baseUrl.includes('localmodels') || _baseUrl.includes('localhost') || _baseUrl.includes('127.0.0.1') || _baseUrl.includes('192.168.');
        for (const f of files) {
            if (f.isImage || f.type?.startsWith('image/')) {
                var _imgUrl = f.content;
                if (!_isLocalModel && f.serverUrl) {
                    _imgUrl = f.serverUrl.startsWith('http') ? f.serverUrl : window.location.origin + f.serverUrl;
                }
                console.log('[Vision] 📷 name:', f.name, 'serverUrl:', f.serverUrl||'(none)', 'contentLen:', (f.content||'').length, 'finalUrl:', _imgUrl.substring(0, 80) + '...');
                content.push({
                    type: 'image_url',
                    image_url: { url: _imgUrl, detail: 'default' }
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
                        image_url: { url: _eimg.dataUrl, detail: 'default' }
                    });
                }
                // 文本附后
                var _fText2 = f.content || '';
                if (_fText2.length > 80000) _fText2 = _fText2.substring(0, 80000) + '\n...(文件过长已截断)';
                content.push({ type: 'text', text: _fText2 || ('[PPTX 文档，含 ' + f.extractedImages.length + ' 张图片]') });
            } else {
                // 非图片文件: 注入服务器路径元信息
                var _isVid = f.isVideo || (f.type && f.type.startsWith('video/'));
                var _info = `[📎 附件: ${f.name} (${(f.size/1024/1024).toFixed(1)}MB)]`;
                if (f.serverUrl) {
                    _info += `\n服务器路径: ${f.serverUrl}`;
                    if (_isVid) {
                        _info += `\n⚠️ 可直接用此路径调用 video_edit: input_path="${f.serverUrl}"`;
                    }
                }
                if (!_isVid) {
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

        var imageDescs = imageFiles.map(f => `[用户上传了图片: ${f.name}]`);
        if (_officeImages.length > 0) {
            imageDescs.push('[PPTX内嵌图片: ' + _officeImages.join(', ') + ']');
        }
        var otherFiles = files.filter(f => !f.type?.startsWith('image/') && !f.hasEmbeddedImages);
        var otherContent = otherFiles.length
            ? otherFiles.map(f => {
                var _isV = f.isVideo || (f.type && f.type.startsWith('video/'));
                var _oi = `[📎 附件: ${f.name} (${(f.size/1024/1024).toFixed(1)}MB)]`;
                if (f.serverUrl) {
                    _oi += `\n服务器路径: ${f.serverUrl}`;
                    if (_isV) _oi += `\n⚠️ 可直接用此路径调用 video_edit: input_path="${f.serverUrl}"`;
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
        var info = `[📎 附件: ${f.name} (${(f.size/1024/1024).toFixed(1)}MB)]`;
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
    var ids = Object.keys(chats).sort((a, b) => (parseInt(a.split('_')[1]) || 0) - (parseInt(b.split('_')[1]) || 0));
    if (ids.length <= keep) return;
    ids.slice(0, ids.length - keep).forEach(id => delete chats[id]);
    saveChatsDebounced();
}


