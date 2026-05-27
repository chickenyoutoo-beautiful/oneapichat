
// main.js 优化版 v18.0 (三模式系统 + 审批门 + 成本追踪)
// 抑制 KaTeX 字体指标警告(中文字符如123不影响渲染)
(function(){
    var _origWarn = console.warn;
    console.warn = function() {
        if (arguments[0] && typeof arguments[0] === 'string' && arguments[0].indexOf('No character metrics') >= 0) return;
        return _origWarn.apply(console, arguments);
    };
})();
// ==================== 全局常量 ====================

// ==================== 已知不支持工具调用的模型(硬编码,不依赖 models.js) ====================
(function() {
    try {
        var _existing = JSON.parse(localStorage.getItem('noToolModels') || '[]');
        var _add = ['deepseek-r1', 'deepseek-reasoner', 'qwq', 'qwq-'];
        var _changed = false;
        for (var _i = 0; _i < _add.length; _i++) {
            if (_existing.indexOf(_add[_i]) === -1) {
                _existing.push(_add[_i]);
                _changed = true;
            }
        }
        if (_changed) {
            localStorage.setItem('noToolModels', JSON.stringify(_existing));
        }
    } catch(e) {}
})();

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
    // ★ 所有链接打开新标签页
    var result = _restoreMath(html);
    result = result.replace(/<a /g, '<a target="_blank" rel="noopener" ');
    return result;
}

// 一键修复配置
window.fixImageAnalysisConfig = function() {

    // 清除可能的问题配置
    localStorage.removeItem('visionApiUrl');
    localStorage.removeItem('visionApiKey');
    localStorage.removeItem('visionModel');

    // 设置简单的 MCP 配置
    localStorage.setItem('visionApiUrl', 'https://api.minimaxi.com/v1/coding_plan/vlm');
    localStorage.setItem('visionApiKey', '');
    localStorage.setItem('visionModel', 'MiniMax-M2');
    return {
        visionApiUrl: 'https://api.minimaxi.com/v1/coding_plan/vlm',
        visionModel: 'MiniMax-M2',
        message: '配置已重置,请刷新页面'
    };
};
// 直接定义 analyzeImage 函数
window.analyzeImage = async function(imageInput, focus) {

    // 防御非法输入
    if (typeof imageInput !== 'string' || !imageInput) {
        imageInput = '';
    }
    // 获取配置
    const storedVisionUrl = localStorage.getItem('visionApiUrl');
    const visionApiUrl = storedVisionUrl || DEFAULT_CONFIG.visionApiUrl || '/mcp';
    // ★ 限流保护: 如果 60 秒内遇到过 Token Plan 限流,直接抛错不请求
    if (window.__minimaxRateLimited && Date.now() - window.__minimaxRateLimited < 60000) {
        throw new Error('⚠️ MiniMax API 限流保护中,请 60 秒后再试');
    }

    // ★ 智能判断: 直连模式还是 MCP 代理模式
    var isDirectApi = visionApiUrl.toLowerCase().indexOf('/mcp') === -1;

    var requestBody;
    var isUrl = imageInput.startsWith('http');

    if (isUrl) {
        if (isDirectApi) {
            // 直连模式: URL 图片需要先下载为 base64,因为 MiniMax API 不接受外链
            try {
                var _dlResp = await fetch(imageInput);
                var _dlBlob = await _dlResp.blob();
                var _dlB64 = await new Promise(function(r) {
                    var fr = new FileReader();
                    fr.onload = function() { r(fr.result); };
                    fr.readAsDataURL(_dlBlob);
                });
                var _compressed = await compressImage(_dlB64);
                requestBody = {
                    prompt: focus || '请详细描述这张图片的所有内容,包括物体、场景、文字等可见信息。',
                    image_url: _compressed
                };
            } catch(e) {
                console.warn('[analyzeImage] 下载/压缩失败:', e.message);
                requestBody = {
                    prompt: focus || '请详细描述这张图片的所有内容,包括物体、场景、文字等可见信息。',
                    image_url: imageInput
                };
            }
        } else {
            // MCP 代理模式: 直接传 URL,服务端下载
            requestBody = {
                prompt: focus || '请详细描述这张图片的所有内容,包括物体、场景、文字等可见信息。',
                image_url: imageInput
            };
        }
    } else {
        // base64 模式: 先压缩
        var _compressedBase64 = imageInput;
        try {
            if (imageInput.startsWith('data:image/')) {
                _compressedBase64 = await compressImage(imageInput);
            }
        } catch(e) {
            console.warn('[analyzeImage] 压缩失败:', e.message);
            _compressedBase64 = imageInput;
        }
        if (isDirectApi) {
            // 直连模式: 直接用 base64 数据(不经过上传),MiniMax 要求 image_url 为 data URL
            requestBody = {
                prompt: focus || '请详细描述这张图片的所有内容,包括物体、场景、文字等可见信息。',
                image_url: _compressedBase64
            };
        } else {
            // MCP 代理模式: 上传到服务器获取可访问 URL
            var uploadedUrl = null;
            try {
                uploadedUrl = await uploadImageToServer(_compressedBase64);
            } catch(e) {
                console.warn('[analyzeImage] 预上传失败:', e.message);
            }
            if (uploadedUrl) {
                requestBody = {
                    prompt: focus || '请详细描述这张图片的所有内容,包括物体、场景、文字等可见信息。',
                    image_url: uploadedUrl.startsWith('http') ? uploadedUrl : window.location.origin + uploadedUrl
                };
            } else {
                var cleanBase64 = _compressedBase64;
                if (!cleanBase64.startsWith('data:image/')) {
                    cleanBase64 = 'data:image/png;base64,' + cleanBase64;
                }
                cleanBase64 = cleanBase64.replace(/\s/g, '');
                requestBody = {
                    prompt: focus || '请详细描述这张图片的所有内容,包括物体、场景、文字等可见信息。',
                    image: cleanBase64
                };
            }
        }
    }
    var mcpEndpoint = visionApiUrl.replace(/\/$/, '');
    if (!isDirectApi) {
        // MCP 代理模式: 确保以 /analyze 结尾
        if (!mcpEndpoint.endsWith('/analyze')) {
            mcpEndpoint = mcpEndpoint + '/analyze';
        }
    }
    // 直连模式: 直接使用 visionApiUrl,不做路径修改
    // 创建 AbortController 用于超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort('请求超时(120秒)');
    }, 120000);

    try {
        // ★ 直连模式: requestBody 需要补充 model 字段,添加认证头
        var _fetchHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        var _fetchBody = JSON.stringify(requestBody);
        if (isDirectApi) {
            // 直连 API 需要 model 字段和 API Key
            var _visionModel = localStorage.getItem('visionModel') || DEFAULT_CONFIG.visionModel || 'MiniMax-M2';
            var _reqWithModel = JSON.parse(JSON.stringify(requestBody));
            _reqWithModel.model = _visionModel;
            _fetchBody = JSON.stringify(_reqWithModel);
            var _rawVisionKey = localStorage.getItem('visionApiKey') || '';
            var _visionKey = '';
            try { _visionKey = decrypt(_rawVisionKey) || _rawVisionKey; } catch(e) { _visionKey = _rawVisionKey; }
            if (_visionKey) {
                _fetchHeaders['Authorization'] = 'Bearer ' + _visionKey;
            }
        }

        const response = await fetch(mcpEndpoint, {
            method: 'POST',
            headers: _fetchHeaders,
            body: _fetchBody,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[analyzeImage] HTTP 错误:', response.status, errorText);

            if (isDirectApi) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error('API 认证失败,请检查 visionApiKey 配置');
                } else {
                    throw new Error('API 请求失败 (' + response.status + '): ' + errorText.substring(0, 200));
                }
            } else {
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
        }

        const data = await response.json();

        if (data.error) {
            throw new Error((isDirectApi ? 'API' : 'MCP') + ' 返回错误: ' + (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)));
        }

        // ★ 直连模式: MiniMax API 返回格式是 {content, base_resp},需要提取 content
        var result = '';
        if (isDirectApi) {
            result = data.content || data.result || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || JSON.stringify(data);
            if (data.base_resp && data.base_resp.status_code !== 0) {
                throw new Error('API 错误: ' + (data.base_resp.status_msg || '未知错误'));
            }
        } else {
            result = data.result || data.description || data.content || JSON.stringify(data);
        }

        return result;

    } catch (error) {
        clearTimeout(timeoutId);

        try {
            console.error('[analyzeImage] 捕获异常:');
            console.error('  类型:', error?.constructor?.name);
            console.error('  消息:', error?.message);
            console.error('  原因:', error?.cause);
        } catch(e) {}

        if (error && typeof error.name === 'string' && error.name === 'AbortError') {
            throw new Error('图片分析请求超时,请稍后重试');
        }

        const errMsg = (error && typeof error.message === 'string') ? error.message : '';
        if (errMsg && (errMsg.includes('Failed to fetch') || errMsg.includes('network'))) {
            throw new Error('网络连接失败。请检查:\n1. 网络是否正常\n2. MCP 服务是否运行\n3. visionApiUrl 配置: ' + visionApiUrl);
        }

        if (error && error instanceof Error) {
            // ★ MiniMax Token Plan 限流: 设置限流标记 + 友好提示
            if (error.message && error.message.includes('Token Plan')) {
                window.__minimaxRateLimited = Date.now();
                throw new Error('⚠️ MiniMax API 限流（Token Plan）。建议: 1) 升级 MiniMax 套餐 2) 切换其他模型 3) 稍后再试');
            }
            throw error;
        } else {
            throw new Error('图片分析失败: ' + String(error));
        }
    }
}

window.analyzeVideo = async function(videoInput, query) {
    if (!videoInput) throw new Error('无效视频');
    var enginePath = videoInput;
    if (videoInput.startsWith('http')) enginePath = videoInput.replace(window.location.origin, '');
    
    // 1. 获取视频元信息
    var infoRes = await fetch('/engine/video_edit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'info',params:{},input_path:enginePath}) });
    var infoData = await infoRes.json();
    if (infoData.error) throw new Error(infoData.error);
    var infoJson = JSON.parse(infoData.result || '{}');
    var duration = parseFloat(infoJson.format?.duration || 0);
    var vStream = (infoJson.streams || []).find(function(s){return s.codec_type==='video';}) || {};
    var width = vStream.width || 0, height = vStream.height || 0, codec = vStream.codec_name || '', fps = vStream.r_frame_rate || '';
    
    // 2. 智能帧数 + 关键帧
    var frameCount = Math.max(8, Math.min(120, Math.ceil(duration) + Math.floor((query||'').length / 3)));
    var frameAnalyses = [];
    try {
        var frRes = await fetch('/engine/video_edit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'frames',params:{count:frameCount,duration:duration||10,scale:640},input_path:enginePath}) });
        var frData = await frRes.json();
        if (!frData.error && frData.result) {
            var frJson = JSON.parse(frData.result);
            var frames = frJson.frames || [];
            // ★ 智能分批并发: 每批最多 N 个并行请求,适配 MiniMax Token Plan 限流(RPM=20)
            //    免费用户 20 RPM, 预留 5 给其他调用, 每批最多 15 个并行
            var _batchSize = Math.min(15, Math.max(1, Math.floor(frames.length / 2)));
            // 动态调整: 如果之前遇到过限流(60秒内), 用更保守的批次
            if (window.__minimaxRateLimited && Date.now() - window.__minimaxRateLimited < 30000) {
                _batchSize = 5;
            } else if (window.__minimaxRateLimited && Date.now() - window.__minimaxRateLimited < 60000) {
                _batchSize = 10;
            }
            for (var _bi = 0; _bi < frames.length; _bi += _batchSize) {
                var _batch = frames.slice(_bi, _bi + _batchSize);
                var _batchPromises = _batch.map(function(f, fi) {
                    var _absIdx = _bi + fi;
                    return window.analyzeImage(f, '第' + (_absIdx + 1) + '/' + frames.length + '帧。' + (query || '描述画面内容'))
                        .then(function(d) { return '**第' + (_absIdx + 1) + '帧:** ' + (d || '分析完成'); })
                        .catch(function() { return '第' + (_absIdx + 1) + '帧: 分析失败'; });
                });
                var _batchResults = await Promise.all(_batchPromises);
                frameAnalyses = frameAnalyses.concat(_batchResults);
                // ★ 限流保护: 如果检测到限流标记(某帧触发了), 当前批完成后等待 5 秒再发下一批
                if (window.__minimaxRateLimited && _bi + _batchSize < frames.length) {
                    console.warn('[analyzeVideo] 限流标记检测到,等待 5 秒再发下一批');
                    await new Promise(function(r) { setTimeout(r, 5000); });
                }
            }
        }
    } catch(e) {}
    
    // 3. 构建结果
    var result = '🎬 **视频分析结果**\n\n**元信息:**\n';
    result += '- 时长: ' + Math.floor(duration/60) + '分' + Math.round(duration%60) + '秒\n';
    if (width) result += '- 分辨率: ' + width + 'x' + height + '\n';
    if (fps) result += '- 帧率: ' + fps + '\n';
    if (codec) result += '- 编码: ' + codec + '\n';
    if (frameAnalyses.length > 0) {
        result += '\n**关键帧分析(' + frameAnalyses.length + '帧):**\n';
        frameAnalyses.forEach(function(a) { result += '\n' + a + '\n'; });
    }
    // ★ 缓存分析结果(30分钟内复用)
    try {
        if (currentChatId && chats[currentChatId]) {
            if (!chats[currentChatId].videoAnalyses) chats[currentChatId].videoAnalyses = {};
            chats[currentChatId].videoAnalyses[enginePath] = {
                time: Date.now(), duration: duration,
                meta: { width: width, height: height, codec: codec, fps: fps, format: infoJson.format?.format_name },
                frames: frameAnalyses
            };
            slimSaveChats();
        }
    } catch(e3) {}
    return result;
};

// 测试 MCP 端点

// 一键配置
window.quickSetupOneAPIChat = function() {

    const config = {
        key: window.ONEAPI_KEY || '',
        url: 'https://oneapi.naujtrats.xyz/v1',
        model: 'deepseek-v4-flash',
        visionApiUrl: window.location.origin + '/mcp',
        visionApiKey: 'test-key',
        visionModel: 'MiniMax-VL-01'
    };

    Object.keys(config).forEach(key => {
        localStorage.setItem(key, config[key]);
    });

    return config;
};

// ★ 跨域登录状态同步(naujtrats.xyz / www 共享登录)
function getCookie(name) {
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : '';
}
function setCookie(name, value, days) {
    var expires = days ? ';max-age=' + (days * 86400) : '';
    document.cookie = name + '=' + encodeURIComponent(value) + ';path=/;domain=.naujtrats.xyz;Secure' + expires;
}
function removeCookie(name) {
    document.cookie = name + '=;path=/;domain=.naujtrats.xyz;max-age=0;Secure';
}

// ★ 获取 auth_token(兼容 deviceId fallback),优先读跨域 cookie
function getAuthToken() {
    return getCookie('auth_token') || localStorage.getItem('authToken') || localStorage.getItem('deviceId') || '';
}

// ★ 安全 fetch (token 走 Authorization header, 不暴露在 URL)
function fetchWithAuth(url, options) {
    var token = getAuthToken();
    if (!token) token = localStorage.getItem('authToken') || '';
    var opts = Object.assign({}, options || {});
    if (token) {
        opts.headers = Object.assign({}, opts.headers || {}, { 'Authorization': 'Bearer ' + token });
    }
    return fetch(url, opts);
}

// 登录成功后同步到跨域 cookie
function syncAuthToken(token) {
    if (token) {
        localStorage.setItem('authToken', token);
        setCookie('auth_token', token, 30);
    }
}

// 退出时清除跨域 cookie
function clearAuthToken() {
    localStorage.removeItem('authToken');
    removeCookie('auth_token');
}

const MOBILE_BREAKPOINT = 786;
const MAX_FILE_SIZE = 4096 * 1024 * 1024;

// ★ 图片压缩配置: 最大宽/高和压缩质量
const IMAGE_COMPRESS_MAX_DIM = 2048;      // 最大边 2048px
const IMAGE_COMPRESS_QUALITY = 0.7;       // JPEG/WebP 压缩质量
const IMAGE_COMPRESS_MAX_SIZE_MB = 3;     // 压缩后上限(超过则再降质量)

/**
 * 客户端压缩图片 - 大幅减小 base64 体积避免 SSL packet 溢出
 * @param {string} dataUrl - 原始图片 data URL
 * @param {number} maxDim - 最大边长(默认2048)
 * @param {number} quality - 压缩质量(默认0.7)
 * @returns {Promise<string>} 压缩后的 data URL
 */
function compressImage(dataUrl, maxDim, quality) {
    return new Promise(function(resolve, reject) {
        maxDim = maxDim || IMAGE_COMPRESS_MAX_DIM;
        quality = quality || IMAGE_COMPRESS_QUALITY;
        // ★ 提取原始图片 MIME 类型,保持格式不转为 webp
        // 因为 llama.cpp 等本地 vision encoder 可能不支持 webp
        var _mimeMatch = (dataUrl || '').match(/^data:(image\/[\w+]+);/);
        var _outMime = (_mimeMatch && _mimeMatch[1]) || 'image/jpeg';
        var img = new Image();
        img.onload = function() {
            var w = img.width, h = img.height;
            // ★ canvas.toDataURL 不支持 'image/png' 质量参数以外的格式带质量
            // PNG 无损, JPEG 带质量, 其他格式统一用 JPEG
            var _useMime = 'image/jpeg';
            var _useQ = quality;
            if (_outMime === 'image/png') { _useMime = 'image/png'; _useQ = undefined; }
            // 等比例缩小
            if (w > maxDim || h > maxDim) {
                var ratio = Math.min(maxDim / w, maxDim / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            var result = _useMime === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
            var bytes = atob(result.split(',')[1]).length;
            if (bytes > IMAGE_COMPRESS_MAX_SIZE_MB * 1024 * 1024) {
                result = canvas.toDataURL('image/jpeg', 0.4);
            }
            resolve(result);
        };
        img.onerror = function() {
            reject(new Error('图片加载失败'));
        };
        img.src = dataUrl;
    });
}
const SEARCH_PROXY = 'https://search.naujtrats.xyz'; // GCP代理(国内绕过GFW)
const FETCH_PROXY = '/oneapichat/fetch.php';  // ★ 网页内容抓取代理
const ENCRYPTION_KEY = 'naujtrats-secret';

window.onProviderChange = function(){};

const API_PROVIDERS = {
    deepseek:  { label: 'DeepSeek',       baseUrl: 'https://api.deepseek.com',                      keyLS: 'apiKeyDeepseek', baseKey: 'apiKeyDeepseek' },
    openai:    { label: 'OpenAI',         baseUrl: 'https://api.openai.com/v1',                      keyLS: 'apiKeyOpenAI',   baseKey: 'apiKeyOpenAI' },
    xai:       { label: 'xAI (Grok)',     baseUrl: 'https://api.x.ai/v1',                            keyLS: 'apiKeyXAI',      baseKey: 'apiKeyXAI' },
    antthropic:{ label: 'Anthropic',      baseUrl: 'https://api.anthropic.com/v1',                   keyLS: 'apiKeyAnth',     baseKey: 'apiKeyAnth' },
    minimax:   { label: 'MiniMax',        baseUrl: 'https://api.minimaxi.com/v1',                    keyLS: 'apiKeyMiniMax',  baseKey: 'apiKeyMiniMax' },
    gemini:    { label: 'Google Gemini',  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyLS: 'apiKeyGemini', baseKey: 'apiKeyGemini' },
    zhipu:     { label: '智谱 (GLM)',    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',            keyLS: 'apiKeyZhipu',    baseKey: 'apiKeyZhipu' },
    qwen:      { label: '通义千问',       baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyLS: 'apiKeyQwen',  baseKey: 'apiKeyQwen' },
    moonshot:  { label: '月之暗面 (Kimi)', baseUrl: 'https://api.moonshot.cn/v1',                    keyLS: 'apiKeyMoonshot', baseKey: 'apiKeyMoonshot' },
    doubao:    { label: '字节豆包',       baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',        keyLS: 'apiKeyDoubao',   baseKey: 'apiKeyDoubao' },
    openrouter:{ label: 'OpenRouter',     baseUrl: 'https://openrouter.ai/api/v1',                  keyLS: 'apiKeyOpenRouter', baseKey: 'apiKeyOpenRouter' },
    opencode:  { label: 'OpenCode',       baseUrl: 'https://api.opencode.ai/v1',                      keyLS: 'apiKeyOpenCode',  baseKey: 'apiKeyOpenCode' },
    llamacpp:  { label: '本地模型 (llama.cpp)', baseUrl: 'https://localmodels.naujtrats.xyz/v1',   keyLS: 'apiKeyLlamaCpp',  baseKey: 'apiKeyLlamaCpp' },
    custom:    { label: '自定义',         baseUrl: '',                                                 keyLS: 'apiKeyCustom',  baseKey: 'apiKeyCustom' },
};
let _currentProvider = '';

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


// ==================== 浏览器操控工具定义 ====================
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
        parameters: { type: "object", properties: {} }
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
        parameters: { type: "object", properties: {} }
    }
};
const BROWSER_GET_SNAPSHOT_TOOL = {
    type: "function",
    function: {
        name: "browser_get_snapshot",
        description: "获取无头浏览器当前页面的结构快照(元素/文本/aria)。用于理解页面布局、定位元素。",
        parameters: { type: "object", properties: {} }
    }
};

// ==================== 服务器操控工具定义 ====================
const SERVER_EXEC_TOOL = {
    type: "function",
    function: {
        name: "server_exec",
        description: "在服务器上执行终端命令。用于系统管理、文件操作、进程管理、服务控制等。输出有长度限制(5000字符),超长时间命令会超时。⚠️ 谨慎使用:避免执行破坏性命令(rm -rf, shutdown等)。",
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

const SERVER_FILE_READ_TOOL = {
    type: "function",
    function: {
        name: "server_file_read",
        description: "读取服务器上的文件内容。可用于查看日志、配置文件、脚本输出等。支持目录列表。",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "文件或目录的绝对路径" },
                max_lines: { type: "number", description: "最大行数(默认200)" }
            },
            required: ["path"]
        }
    }
};

const SERVER_FILE_WRITE_TOOL = {
    type: "function",
    function: {
        name: "server_file_write",
        description: "写入文件到服务器(仅允许 /tmp 和项目目录)。用于保存脚本输出、生成报告、创建配置等。",
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

const SERVER_SYS_INFO_TOOL = {
    type: "function",
    function: {
        name: "server_sys_info",
        description: "获取服务器系统信息:主机名、操作系统、CPU负载、内存使用、磁盘空间、进程数等。",
        parameters: { type: "object", properties: {}, required: [] }
    }
};

const SERVER_PS_TOOL = {
    type: "function",
    function: {
        name: "server_ps",
        description: "列出服务器上的进程(按CPU使用率排序,显示前20个)。用于监控系统负载、查找运行中的服务等。",
        parameters: { type: "object", properties: { }, required: [] }
    }
};

const SERVER_DISK_TOOL = {
    type: "function",
    function: {
        name: "server_disk",
        description: "查看服务器的磁盘使用情况(所有分区)。",
        parameters: { type: "object", properties: {}, required: [] }
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
        description: "查询刷课进度统计,包括总课程数、已完成课程数、视频完成数、答题完成数,以及每门课的详细进度。",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    }
};

const CHAOXING_OVERVIEW_TOOL = {
    type: "function",
    function: {
        name: "chaoxing_overview",
        description: "超星刷课总览:一次性返回登录状态、是否正在刷课、当前刷课课程、已完成课程数、总课程数、视频/答题进度。在用户询问刷课状态、'现在刷到哪了'、'进度如何'时调用此工具。调用前必须先调用 chaoxing_auth 检查登录。",
        parameters: { type: "object", properties: {}, required: [] }
    }
};

const CHAOXING_EXAM_LIST_TOOL = {
    type: "function",
    function: {
        name: "chaoxing_exam_list",
        description: "列出超星学习通所有课程的考试列表,包含考试ID、课程、名称、状态、起止时间。调用后返回完整JSON供用户选择。",
        parameters: { type: "object", properties: {}, required: [] }
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
        parameters: { type: "object", properties: {}, required: [] }
    }
};

const CHAOXING_EXAM_STOP_TOOL = {
    type: "function",
    function: {
        name: "chaoxing_exam_stop",
        description: "停止正在运行的考试任务。",
        parameters: { type: "object", properties: {}, required: [] }
    }
};

const CHAOXING_AUTH_TOOL = {
    type: "function",
    function: {
        name: "chaoxing_auth",
        description: "【必须首先调用】检测超星学习通的登录状态。在调用任何 chaoxing 工具(考试列表、开考、刷课)之前,你必须先调用此工具。如果已登录,直接进行下一步操作;如果未登录,才向用户询问手机号和密码。绝对不要在未检查状态的情况下直接问用户要账号密码。",
        parameters: { type: "object", properties: {}, required: [] }
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

const DELEGATE_TASK_TOOL = {
    type: "function",
    function: {
        name: "delegate_task",
        description: "【推荐】创建一个子代理执行后台任务。子代理会根据角色获得不同工具权限。比 engine_agent_create 更稳定。可以创建多个并行子代理,多次调用即可。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "子代理名称,简短唯一" },
                task: { type: "string", description: "任务描述(100字以内),如'搜索2024年AI最新新闻并总结'" },
                role: { type: "string", description: "子代理角色:explorer(搜) planner(规) developer(开) verifier(验) general(全)。默认general", "default": "general" },
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
        description: "向用户推送通知消息,可附带服务器文件作为下载链接。当视频剪辑/文件处理完成后,调用此工具把结果文件发送给用户。传file参数指定服务器上文件路径(如/tmp/video.mp4),用户会收到紫色下载按钮。",
        parameters: {
            type: "object",
            properties: {
                msg: { type: "string", description: "推送消息内容" },
                file: { type: "string", description: "可选,服务器上文件路径(如/tmp/video_output.mp4),会生成下载链接" }
            },
            required: ["msg"]
        }
    }
};
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
    // 渲染工具调用消息 (可覆写)
    renderUseMessage: opts.renderUseMessage || function(input) {
      var summary = typeof input === 'object' ? JSON.stringify(input).substring(0, 80) : String(input).substring(0, 80);
      return '<div class="tool-card"><div class="tool-card-header"><span class="tool-card-icon">🔧</span><span class="tool-card-name">' + escapeHtml(name) + '</span></div><div class="tool-card-body">' + escapeHtml(summary) + '</div></div>';
    },
    // 渲染工具结果 (可覆写)
    renderResultMessage: opts.renderResultMessage || function(output) {
      var text = typeof output === 'string' ? output : (output && output.result ? output.result : JSON.stringify(output));
      var truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;
      return '<div class="tool-result"><div class="tool-result-header">✅ 结果</div><pre class="tool-result-body">' + escapeHtml(truncated) + '</pre></div>';
    },
    // 获取简要摘要
    getSummary: opts.getSummary || function(input) {
      return name + ': ' + (typeof input === 'object' ? JSON.stringify(input).substring(0, 60) : String(input).substring(0, 60));
    }
  };
}

// ==================== 工具注册表 (全局) ====================
var toolRegistry = (function() {
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

  return {
    register: register,
    get: get,
    has: has,
    getApprovalLevel: getApprovalLevel,
    isReadOnly: isReadOnly,
    isAgentOnly: isAgentOnly,
    getSearchHint: getSearchHint,
    getCapabilities: getCapabilities,
    getAllToolNames: getAllToolNames,
    getStats: getStats,
    getToolSelectionPrompt: getToolSelectionPrompt
  };
})();

// ==================== 注册所有工具到注册表 ====================
(function _registerAllTools() {
  // 读操作 - 只读,自动审批
  toolRegistry.register('server_file_read', buildToolMeta('server_file_read', {
    capabilities: [ToolCapability.READS_FILES],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    isAgentOnly: true,
    searchHint: '读取服务器文件',
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
  toolRegistry.register('web_fetch', buildToolMeta('web_fetch', {
    capabilities: [ToolCapability.NETWORK],
    approval: ApprovalLevel.AUTO,
    isReadOnly: true,
    searchHint: '抓取网页内容',
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

  console.log('[ToolRegistry] 已注册', Object.keys(toolRegistry.getAllToolNames()).length, '个工具');
})();

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
        description: "【纯文生图】用于从零开始生成图片。★ 这是唯一的生图方式,不要在文本回复中伪造图片链接。适用场景:画一幅画、生成一张图片、创作插画。没有参考图片时必须用这个。",
        parameters: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "★ 图片提示词,建议英文,≤1500字符。简洁描述主题、风格即可。例如:'A cute cat, anime style'"
                },
                model: {
                    type: "string",
                    description: "图像模型(可选,不传则使用用户配置的默认模型): image-01(MiniMax)/openai/gpt-5.4-image-2(OpenRouter GPT Image 2)"
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
                    description: "生成图片数量,1-9张。★ 用户要求多张图片时务必使用此参数一次生成,不要多次调用生成。默认1张。"
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

// ==================== 图生图工具定义 ====================
const IMAGE_I2I_TOOL_DEFINITION = {
    type: "function",
    function: {
        name: "generate_image_i2i",
        description: "【图生图】用户上传了多张参考图并要求据此生成/创作图片时用这个。适用场景:换颜色、换风格、换脸/换发型、以图为基础创作新图、参考多张图合成等。这个工具会先分析所有参考图获取详细描述,再调用图生图API生成新图。系统会自动使用用户上传的第一张图作为主参考图。禁止:用户只是问'图片里有什么'时不要用这个,用analyze_image。",
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
                    description: "生成图片数量,1-9张。★ 需要多张变体时使用此参数一次生成。"
                },
                seed: {
                    type: "integer",
                    description: "随机种子。★ n>1时不要传seed,否则所有图一样。"
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
        description: "分析用户上传的图片内容,返回详细的图片描述。当用户发送图片并询问图片内容、要求描述图片、分析图片细节时调用此工具。支持多张参考图,用 image_index 指定分析哪一张(0=第一张,1=第二张...)。不传则分析第一张。支持 JPEG、PNG、GIF、WebP 格式。",
        parameters: {
            type: "object",
            properties: {
                focus: {
                    type: "string",
                    description: "分析重点,如:'人物特征'、'场景描述'、'文字识别'、'物体识别'等。不传则进行综合分析。"
                },
                image_index: {
                    type: "integer",
                    description: "要分析的图片索引(0=第一张,1=第二张...)。当用户上传了多张图片时使用此参数指定具体分析哪一张,避免每次都分析第一张。默认0。"
                }
            }
        }
    }
};

const VIDEO_UNDERSTANDING_TOOL = {
    type: "function",
    function: {
        name: "video_understanding",
        description: "分析上传的视频内容。提取关键帧并进行全面理解。",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "分析需求，如'描述视频内容''视频中有什么'等" },
                video_index: { type: "integer", description: "视频索引，0表示第一个视频" }
            }
        }
    }
};

// ==================== 视频剪辑工具 ====================
const VIDEO_EDIT_TOOL = {
    type: "function",
    function: {
        name: "video_edit",
        description: "视频剪辑+字幕+配音工具。支持精确时间轴字幕(timeline数组)、滤镜(video_filter:sepia|eq|vignette|bw|vintage|grain)、转场(video_transition:fade|dissolve|wipeleft)、配音(voice:含tts)、纯语音(tts)、裁剪(trim)、拼接(concat)、调速(speed)、缩放(resize)、画中画(overlay)、旋转(rotate)、音频提取(audio)。TTS默认MiniMax,可选OpenAI。字幕用timeline数组按时间轴精确显示,每条有start/end/text。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", description: "操作: compose trim concat speed resize overlay text audio rotate filter video_filter transition video_transition tts voice frames info。compose=字幕+逐句TTS配音+视频精确对齐, 推荐用于配音场景" },
                params: { type: "object", description: "compose:{timeline:[{start:0,end:2.5,text:'你好',voice_id:'female-yujie',danmaku:false}],voice_id:'female-yujie',fontsize:28,font:'noto-sans-bold',bg_opacity:0.5,bg_color:'#1a1a2e',bg_radius:12,bg_volume:0.3,filter:'sepia'|'vintage'|'bw'|'grain'|'vignette'|'hue'|'eq'|'boxblur',auto_fix_ratio:true,danmaku:true,danmaku_rows:2,danmaku_speed:300,danmaku_fontsize:28,danmaku_color:'#ffffff',danmaku_opacity:0.85,danmaku_random_color:true,danmaku_random_y:true} 一次完成字幕+逐句配音+滤镜+原音频保留。每条字幕可单独指定voice_id实现多角色切换。默认音色:male-qn-qingse/male-qn-jingying/female-shaonv/female-yujie/presenter_male/presenter_female等。auto_fix_ratio=true时自动修复非标准分辨率(如1920x1280)。danmaku=true开启弹幕模式,每条字幕的danmaku:true标记为弹幕从右到左飞过,danmaku_rows控制同时显示行数,danmaku_random_color每条随机颜色,danmaku_random_y随机行位置" },
                input_path: { type: "string", description: "输入视频路径。用户上传视频后,消息中会标注「服务器路径: /oneapichat/uploads/...」,直接用这个路径即可,无需搜索。" },
                output_path: { type: "string", description: "输出路径(可选)" }
            },
            required: ["action", "params", "input_path"]
        }
    }
};

// ==================== Agent 模式控制工具 ====================
const ASK_AGENT_TOOL = {
    type: "function",
    function: {
        name: "ask_agent",
        description: "向用户请求启用Agent模式。当需要执行文件操作、运行命令、管理定时任务或使用子代理时调用此工具。用户确认后才可执行这些操作。",
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

// ==================== SRC (StarRailCopilot) 操控工具 ====================
const SRC_API_BASE = '/src';

async function _srcApi(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    try {
        var r = await fetch(SRC_API_BASE + path, opts);
        return await r.json();
    } catch(e) {
        return { ok: false, error: e.message };
    }
}

const SRC_TOOLS = [
    // ── 状态与健康 ──
    { type: "function", function: { name: "src_status", description: "查询SRC服务存活状态、运行模式、state_label(stopped/running/error)", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "src_dashboard", description: "获取星穹铁道游戏资源面板(体力/星琼/信用点/燃料/沉浸器/大月卡进度等实时数据)", parameters: { type: "object", properties: {}, required: [] } } },
    // ── 生命周期 ──
    { type: "function", function: { name: "src_start", description: "启动SRC任务。task=任务名(Alas=完整调度器, Weekly=周本, Dungeon=副本, Ornament=遗器, Rogue=模拟宇宙, DailyQuest=日常)。默认Alas。", parameters: { type: "object", properties: { task: { type: "string", description: "任务名: Alas/Weekly/Dungeon/Ornament/Rogue/DailyQuest/Freebies/Assignment/BattlePass/Restart/Daemon/PlannerScan, 默认Alas" } }, required: [] } } },
    { type: "function", function: { name: "src_stop", description: "安全停止SRC所有运行中的任务", parameters: { type: "object", properties: {}, required: [] } } },
    // ── 任务管理 ──
    { type: "function", function: { name: "src_get_tasks", description: "获取所有任务列表(含分组:日常/周本/副本/工具,各任务的启用状态和下次运行时间)", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "src_toggle_task", description: "启用/禁用单个任务(副本/周本/模拟宇宙/派遣等),enable=true启用false禁用", parameters: { type: "object", properties: { name: { type: "string", description: "任务名,如 Dungeon/Weekly/Rogue/Ornament/Daemon" }, enable: { type: "boolean", description: "true=启用,false=禁用" } }, required: ["name","enable"] } } },
    // ── 配置 ──
    { type: "function", function: { name: "src_get_config", description: "读取SRC完整运行配置(模拟器/游戏/副本/遗器/周本/委托/优化等全部配置项)", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "src_set_config", description: "修改SRC一项配置。可改模拟器类型、刷取副本名、队伍编号、是否用燃料、截图方式等。path用点分隔。", parameters: { type: "object", properties: { path: { type: "string", description: "配置路径,如 Dungeon.Dungeon.Name / Alas.Emulator.Serial / Rogue.RogueWorld.World" }, value: { type: "string", description: "新值" } }, required: ["path","value"] } } },
    // ── 日志与诊断 ──
    { type: "function", function: { name: "src_get_logs", description: "获取SRC运行日志(用于诊断启动失败/运行错误)", parameters: { type: "object", properties: { lines: { type: "number", description: "行数,默认50" } }, required: [] } } },
    // ── 升级维护 ──
    { type: "function", function: { name: "src_check_upgrade", description: "检查SRC代码是否有更新(git behind数)", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "src_do_upgrade", description: "执行SRC升级(git pull+pip install+重启,需确认)", parameters: { type: "object", properties: {}, required: [] } } },
];

// ==================== Windows 本机操控工具 (通过WSL2 PowerShell) ====================
const WIN_POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

async function _winCmd(cmd) {
    try {
        var result = await window._agentExecForChat ? window._agentExecForChat(WIN_POWERSHELL + ' -Command "' + cmd.replace(/"/g, '\\"') + '"') : null;
        if (!result) {
            // fallback: 通过 exec 执行
            return { ok: false, error: '需要使用 server_exec 工具执行 PowerShell 命令' };
        }
        return { ok: true, output: result };
    } catch(e) { return { ok: false, error: e.message }; }
}

const WIN_TOOLS = [
    { type: "function", function: { name: "win_info", description: "获取Windows宿主机系统信息(Windows版本/内存/CPU/磁盘等)", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "win_processes", description: "列出Windows运行的进程,可按名称筛选", parameters: { type: "object", properties: { filter: { type: "string", description: "进程名关键词筛选,如 'StarRail'" } }, required: [] } } },
    { type: "function", function: { name: "win_kill", description: "结束Windows上的指定进程(按名称或PID)", parameters: { type: "object", properties: { target: { type: "string", description: "进程名或PID" } }, required: ["target"] } } },
    { type: "function", function: { name: "win_start", description: "启动Windows上的程序。path=可执行文件路径, app=开始菜单中的应用名(如'7-Zip File Manager')。二者任选其一。", parameters: { type: "object", properties: { path: { type: "string", description: "可执行文件路径,如 C:\\Program Files\\app.exe" }, app: { type: "string", description: "开始菜单应用名,如 '崩坏:星穹铁道' 或 '7-Zip File Manager'" } }, required: [] } } },
    { type: "function", function: { name: "win_restart", description: "重启Windows程序(先kill再start)。name=进程名(如StarRail.exe), path/app=重启后启动方式(二选一)", parameters: { type: "object", properties: { name: { type: "string", description: "要终止的进程名,如 'StarRail.exe'" }, path: { type: "string", description: "重启时启动的可执行文件路径(可选)" }, app: { type: "string", description: "重启时启动的开始菜单应用名(可选)" } }, required: ["name"] } } },
    { type: "function", function: { name: "win_file", description: "列出Windows上的目录或读取文件内容(通过WSL /mnt/c/路径)", parameters: { type: "object", properties: { action: { type: "string", description: "list=列目录, read=读文件" }, path: { type: "string", description: "WSL路径如 /mnt/c/Users/AS/Desktop" } }, required: ["action","path"] } } },
    { type: "function", function: { name: "win_screenshot", description: "截取Windows桌面当前画面,返回base64图片。用于查看模拟器/游戏是否正常运行、确认操作结果。", parameters: { type: "object", properties: { format: { type: "string", description: "图片格式 png 或 jpg,默认png" } }, required: [] } } },
];

// ==================== MiniMax CLI 工具 ====================
const MMX_TOOLS = [
    { type: "function", function: { name: "mmx_chat", description: "通过 MiniMax 语言模型对话。用 MiniMax 模型回答用户问题，支持流式输出。适用于与主线模型不同的场景或需要多模型对比。", parameters: { type: "object", properties: { message: { type: "string", description: "用户消息" }, system: { type: "string", description: "系统提示词(可选)" }, max_tokens: { type: "integer", description: "最大生成token数,默认4096" } }, required: ["message"] } } },
    { type: "function", function: { name: "mmx_image", description: "使用 MiniMax image-01 生成图片。支持自定义宽高比和批量生成。", parameters: { type: "object", properties: { prompt: { type: "string", description: "图片描述" }, aspect_ratio: { type: "string", description: "宽高比，如 16:9, 1:1, 9:16，默认1:1" }, n: { type: "integer", description: "生成数量，默认1，最大4" } }, required: ["prompt"] } } },
    { type: "function", function: { name: "mmx_video", description: "使用 MiniMax Hailuo 生成视频。异步任务，返回任务ID。", parameters: { type: "object", properties: { prompt: { type: "string", description: "视频描述，如'夕阳下，一只猫坐在窗边望向远方'" } }, required: ["prompt"] } } },
    { type: "function", function: { name: "mmx_speech", description: "使用 MiniMax 语音合成，将文字转为语音。", parameters: { type: "object", properties: { text: { type: "string", description: "要朗读的文字" }, voice: { type: "string", description: "音色ID，可选: female-yujie(默认)/female-shaonv/male-qn-qingse/male-qn-jingying/female-chengshu/female-tianmei/male-qn-badao/male-qn-daxuesheng" } }, required: ["text"] } } },
    { type: "function", function: { name: "mmx_voices", description: "列出 MiniMax 语音合成可用的所有音色列表。", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "mmx_music", description: "用户说'生成/创作/创作一首歌/音乐/歌曲'时,必须调用此工具！★ 使用 MiniMax 生成音乐，会自动根据 prompt 创作歌词并生成完整歌曲。★ 纯旋律: instrumental=true。★ 提供歌词: lyrics=歌词。★ 默认(推荐): 只传 prompt,自动创作歌词+音乐。", parameters: { type: "object", properties: { prompt: { type: "string", description: "音乐风格描述，如 '轻快爵士风格，主题是夏天的海边'。必须描述风格/主题/情绪" }, lyrics: { type: "string", description: "歌词(可选)。支持 [Verse][Chorus][Bridge] 等结构标签。不传则自动生成歌词。" }, instrumental: { type: "boolean", description: "纯音乐无歌词，默认false" } }, required: ["prompt"] } } },
    { type: "function", function: { name: "mmx_vision", description: "使用 MiniMax VLM 分析图片内容。", parameters: { type: "object", properties: { image: { type: "string", description: "图片URL或base64" }, prompt: { type: "string", description: "关于图片的问题，默认'描述这张图片'" } }, required: ["image"] } } },
    { type: "function", function: { name: "mmx_quota", description: "查看 MiniMax Token Plan 的剩余用量和配额信息。", parameters: { type: "object", properties: {}, required: [] } } },
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

// ==================== MiniMax CLI 工具注册 ====================
(function() {
    MMX_TOOLS.forEach(function(t) {
        toolRegistry.register(t.function.name, {
            name: t.function.name,
            description: t.function.description,
        });
    });
})();

// ==================== 工具注册 ====================
// 在工具注册表注册
(function() {
    SRC_TOOLS.forEach(function(t) {
        toolRegistry.register(t.function.name, {
            name: t.function.name,
            description: t.function.description,
        });
    });
})();

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
                // result.url 已经以 /oneapichat 开头,无需再加 SERVER_API_BASE
                return result.url;
            }
        }
        console.warn('[uploadImageToServer] 上传失败,状态:', response.status);
        return null;
    } catch (e) {
        console.warn('[uploadImageToServer] 上传失败:', e.message);
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

let _lastServerBackup = 0;
const SERVER_BACKUP_INTERVAL = 2000; // ★ 2秒即可再次备份,平板确保不丢
let _deletedChatIds = {}; // ★ 跟踪已删除的聊天ID,合并时排除
// 从 localStorage 恢复(刷新后不丢失)
try { var _savedDel = JSON.parse(localStorage.getItem('_deletedChatIds') || '{}'); _deletedChatIds = _savedDel; } catch(e) {}

// ★ sendBeacon 版本: 页面关闭时可靠地保存聊天记录到服务器
//   使用 navigator.sendBeacon,浏览器保证请求在页面关闭后继续发送
function beaconSaveChats() {
    try {
        var token = localStorage.getItem('authToken');
        if (!token) return;
        var url = SERVER_API_BASE + '/chat.php?auth_token=' + token;
        // ★ 精简数据:只保留消息骨架(去掉大体积 base64 图片),确保 sendBeacon 不超 64KB 限制
        var slimData = compressChatsForStorage(chats);
        var payload = JSON.stringify({ chat_id: 'all', chats: slimData, title: '聊天备份' });
        // 如果 payload 仍然过大(>60KB),进一步压缩
        if (payload.length > 60000) {
            var ultraSlim = {};
            var ids = Object.keys(slimData);
            for (var si = 0; si < ids.length; si++) {
                var id = ids[si];
                var c = slimData[id];
                ultraSlim[id] = {
                    title: c.title || '新对话',
                    updated_at: c.updated_at || '',
                    messages: (c.messages || []).slice(-6).map(function(m) {
                        return { role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 3000) : '[消息内容已精简]', time: m.time };
                    })
                };
            }
            payload = JSON.stringify({ chat_id: 'all', chats: ultraSlim, title: '聊天备份' });
        }
        var blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
    } catch(e) {
        console.warn('[beaconSaveChats] 失败:', e.message);
    }
}

// ★ sendBeacon 版本: 页面关闭时可靠地保存配置到服务器
function beaconSaveConfig() {
    try {
        var token = localStorage.getItem('authToken');
        if (!token) return;
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
        var url = SERVER_API_BASE + '/chat.php?auth_token=' + token + '&action=save_config';
        var blob = new Blob([JSON.stringify(config)], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
    } catch(e) {}
}

async function saveChatsToServer() {
    try {
        var now = Date.now();
        if (now - _lastServerBackup < SERVER_BACKUP_INTERVAL) return false;
        _lastServerBackup = now;

        var token = localStorage.getItem('authToken');
        if (!token) return false;
        var url = SERVER_API_BASE + '/chat.php';
        url += '?auth_token=' + token;

        // ★ 合并:先读服务器已有数据,再合并本地聊天,防止多窗口覆盖
        // ★ 防丢失:如果本地聊天数过少,视为异常,不强制覆盖服务器
        var _localCount = Object.keys(chats).length;
        var mergedChats = JSON.parse(JSON.stringify(chats));
        // ★ 保留完整图片数据(不压缩,服务器备份需要完整 base64)
        console.log('[save] 本地聊天数:', Object.keys(mergedChats).length);
        var _serverChats = {};  // 用于防误覆盖检查
        var _getOk = false;    // GET是否成功
        try {
            var getUrl = url + '&chat_id=all';
            console.log('[save] GET:', getUrl.substring(0,80));
            var getResp = await fetch(getUrl);
            console.log('[save] GET响应:', getResp.status);
            _getOk = getResp.ok;
            if (getResp.ok) {
                var serverData = await getResp.json();
                _serverChats = serverData.chats || {};
                console.log('[save] 已删IDs:', Object.keys(_deletedChatIds).join(','));
                console.log('[save] 服务器聊天数:', Object.keys(_serverChats).length);
                var added = 0;
                for (var scid in _serverChats) {
                    if (!mergedChats[scid] && !_deletedChatIds[scid]) {
                        mergedChats[scid] = _serverChats[scid];
                        added++;
                    }
                }
                console.log('[save] 合并新增:', added);
            }
        } catch(e) {
            console.warn('[save] GET合并失败:', e.message);
        }

        // ★ 防误覆盖:GET失败或服务器数据远多于本地时,跳过保存
        if (!_getOk) {
            console.warn('[save] GET失败,跳过保存防止覆盖');
            return false;
        }
        if (Object.keys(_serverChats).length >= 3 && _localCount <= 2) {
            console.warn('[save] 本地仅'+_localCount+'条,服务器有'+Object.keys(_serverChats).length+'条,跳过保存');
            return false;
        }

        var response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: 'all', chats: mergedChats, title: '聊天备份' }),
            keepalive: false
        });

        if (response.ok) {
            _deletedChatIds = {}; // 清除已同步的删除标记
            try { localStorage.removeItem('_deletedChatIds'); } catch(e) {}
            return true;
        }
        return false;
    } catch (e) {
        console.warn('[saveChatsToServer] 备份失败:', e.message);
        // ★ 重试一次:进一步压缩后重发
        try {
            var retrySlim = {};
            var ids = Object.keys(mergedChats || chats || {});
            var recentIds = ids.slice(-10);
            for (var _si2 = 0; _si2 < recentIds.length; _si2++) {
                var _id2 = recentIds[_si2];
                var _c2 = (mergedChats || chats)[_id2];
                retrySlim[_id2] = { title: _c2.title || '新对话', updated_at: _c2.updated_at || '', messages: (_c2.messages || []).slice(-4) };
            }
            var retryResp = await fetch(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: 'all', chats: retrySlim, title: '聊天备份(精简)' }),
                keepalive: false
            });
            if (retryResp.ok) { _deletedChatIds = {}; try { localStorage.removeItem('_deletedChatIds'); } catch(e) {} return true; }
        } catch(e2) {}
        return false;
    }
}

// ★ 将完整配置保存到服务器(按用户隔离)
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
            var resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config), keepalive: false });
            if (resp.ok) saved = true;
        } catch(e1) { console.warn('[save] 保存失败:', e1.message); }
        if (!saved) {
            try {
                var resp2 = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config), keepalive: false });
                if (resp2.ok) saved = true;
            } catch(e2) { console.warn('[save] 重试保存也失败:', e2.message); }
        }
        console.log(saved ? '[save] 配置保存完成' : '[save] 配置保存失败(已重试)');

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
        visionApiUrl: window.location.origin + '/mcp',
        visionApiKey: '',
        imageModel: 'image-01',
        imageBaseUrl: 'https://api.minimaxi.com/v1',
        imageApiKey: '',
        imageProvider: 'minimax',
        apiKey: '',
        temp: '0.7',
        tokens: '8192',
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
    console.log('[loadConfigFromServer] token有效,请求配置');
    try {
        var resp = await fetch(SERVER_API_BASE + '/chat.php?auth_token=' + token + '&action=get_config');
        console.log('[loadConfigFromServer] 响应状态:', resp.status);
        if (!resp.ok) { console.log('[loadConfigFromServer] 响应异常,跳过'); return; }
        var config = await resp.json();
        console.log('[loadConfigFromServer] 服务器配置键数:', config ? Object.keys(config).length : 0);
        if (!config || Object.keys(config).length === 0) {
            console.log('[loadConfigFromServer] 服务器无配置数据');
            return;
        }
        // 静默写入所有键,只在出错时记录
        // ★ 跳过无效值:含中文/英文提示语的模型名、明显错误数据
        var _invalidModel = function(v) {
            if (!v || typeof v !== 'string') return true;
            // 过滤提示语(加载中、请输入API Key、空字符串、未设置)
            if (/^[\s\S]*(加载|请输入|请先|未设置|默认|选择|请选择)/.test(v)) return true;
            // 过滤纯 placeholder
            if (v.length < 2) return true;
            return false;
        };
        for (var k in config) {
            var _skipKeys = ['baseUrlProvider','apiKey','baseUrl'];
            // ★ model 字段写入前额外校验:不接受提示语或过短的值
            if (k === 'model' && _invalidModel(config[k])) {
                console.log('[loadConfigFromServer] 跳过无效 model:', config[k]);
                continue;
            }
            if (config[k] !== null && config[k] !== undefined && k !== 'dark' && k !== 'agentMode' && _skipKeys.indexOf(k) === -1) {
                try { localStorage.setItem(k, config[k]); } catch(e) { console.warn('[loadConfigFromServer] 写入失败:', k); }
            }
        }
        console.log('[loadConfigFromServer] 写入完成,共', Object.keys(config).length, '项');
        // ★ 服务器配置写入 localStorage 后,重新填充 UI 表单(确保服务器值正确显示)
        if (typeof initializeConfig === 'function') initializeConfig();
        if (typeof loadSearchConfig === 'function') loadSearchConfig();
    } catch(e) {
        console.warn('[loadConfigFromServer] 失败:', e.message);
    }
}

async function loadChatsFromServer() {
    try {
        // ★ 兼容跨域 cookie(从 www 过来时 localStorage 暂无 token)
        const token = localStorage.getItem('authToken') || getCookie('auth_token');
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

// ★ 登录后的数据恢复:从服务器加载当前账号的配置和聊天记录
async function restoreUserData() {
    console.log('[restoreUserData] 开始恢复用户数据');
    // ★ 优先读 localStorage,其次跨域 cookie(从其他域名过来时)
    var token = localStorage.getItem('authToken') || getCookie('auth_token');
    if (!token && typeof getAuthToken === 'function') token = getAuthToken();
    console.log('[restoreUserData] token:', token ? token.substring(0,20)+'...' : 'null');
    if (!token) { console.log('[restoreUserData] 无token,跳过'); return; }

    var uid = localStorage.getItem('authUserId') || '';

    // 0. 迁移旧聊天记录:给没有 userId 的打上当前用户标签
    if (uid) {
        var migrated = 0;
        for (var _cid in chats) {
            if (!chats[_cid].userId) {
                chats[_cid].userId = uid;
                migrated++;
            }
        }
        if (migrated > 0) {
            slimSaveChats();
            console.log('[restoreUserData] 迁移了', migrated, '个旧聊天记录');
        }
    }

    // ★ 并行加载配置和聊天记录
    console.log('[restoreUserData] 并行加载配置和聊天记录...');
    var _serverChats = null;
    await Promise.all([
        (async function() {
            try { await Promise.race([loadConfigFromServer(), new Promise(function(resolve){setTimeout(resolve, 8000)})]); } catch(e) { console.warn('[restoreUserData] 配置加载失败:', e.message); }
        })(),
        (async function() {
            try {
                _serverChats = await Promise.race([
                    loadChatsFromServer(),
                    new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, 10000); })
                ]);
                if (_serverChats && typeof _serverChats === 'object' && Object.keys(_serverChats).length > 0) {
                    // ★ 合并:本地优先(最新数据),服务器补充缺失项
                    var merged = JSON.parse(JSON.stringify(chats));
                    var added = 0;
                    for (var _scid in _serverChats) {
                        if (_deletedChatIds && _deletedChatIds[_scid]) continue; // 跳过已删除
                        var _sc = _serverChats[_scid];
                        if (!merged[_scid]) {
                            merged[_scid] = _sc;
                            added++;
                        } else {
                            var _mc = merged[_scid];
                            // ★ 修复: 服务器有更多消息时用服务器数据补充本地
                            if (_sc.messages && (!_mc.messages || _sc.messages.length > _mc.messages.length)) {
                                _mc.messages = _sc.messages;
                            }
                            // 图片数据恢复
                            if (_sc.messages && _mc.messages) {
                                var _minLen = Math.min(_sc.messages.length, _mc.messages.length);
                                for (var _smi = 0; _smi < _minLen; _smi++) {
                                    var _sm = _sc.messages[_smi];
                                    var _mm = _mc.messages[_smi];
                                    if (_sm && _mm) {
                                        if (_sm.generatedImage && (!_mm.generatedImage || _mm.generatedImage.indexOf('data:') !== 0)) {
                                            _mm.generatedImage = _sm.generatedImage;
                                        }
                                        if (_sm.generatedImages && _sm.generatedImages.length > 0 && (!_mm.generatedImages || _mm.generatedImages.length === 0 || _mm.generatedImages[0].indexOf('data:') !== 0)) {
                                            _mm.generatedImages = _sm.generatedImages;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    chats = merged;
                    // ★ 避免 quota exceeded:使用 slimSaveChats 写入(自动压缩+截断大图片)
                    try { slimSaveChats(); } catch(e) {
                        console.warn('[restoreUserData] 写入localStorage失败,尝试精简:', e.message);
                        // 极简模式:只保留标题骨架
                        try {
                            var mini = {};
                            Object.keys(chats).slice(-5).forEach(function(id) {
                                mini[id] = { title: chats[id].title || '新对话', updated_at: chats[id].updated_at || '', messages: [] };
                            });
                            localStorage.setItem('chats', JSON.stringify(mini));
                        } catch(e2) {
                            console.error('[restoreUserData] 极简保存也失败');
                        }
                    }
                    renderChatHistory();
                    console.log('[restoreUserData] 合并: 本地', Object.keys(chats).length - added, '个, 服务器补充', added, '个');
                } else {
                    console.log('[restoreUserData] 服务器无聊天记录,保留本地');
                }
            } catch(e) { console.warn('[restoreUserData] 聊天加载失败:', e.message); }
        })()
    ]);

    // ★ 配置和聊天都加载完后初始化
    console.log('[restoreUserData] 初始化配置');
    initializeConfig();
    // ★ 模型配置:预填充已知不支持工具的模型到 noToolModels 列表
    try {
        var _existingNoTool = JSON.parse(localStorage.getItem('noToolModels') || '[]');
        // 硬编码已知不支持工具的模型(即使 models.js 未加载也能生效)
        var _builtinNoTools = [
            'deepseek-reasoner', 'deepseek-r1', 'qwq', 'qwq-',
            'grok-3-reasoning', 'grok-3-reasoner'
        ];
        for (var _bni = 0; _bni < _builtinNoTools.length; _bni++) {
            var _bn = _builtinNoTools[_bni].toLowerCase();
            if (_existingNoTool.indexOf(_bn) === -1) {
                _existingNoTool.push(_bn);
            }
        }
        // 从 models.js 自动加载更多
        if (window.MODEL_CONFIGS) {
            var _allConfigs = window.MODEL_CONFIGS.getAllConfigs();
            for (var _ci = 0; _ci < _allConfigs.length; _ci++) {
                var _m = _allConfigs[_ci];
                if (_m && _m[0] && _m[0] !== '*' && window.MODEL_CONFIGS.isNoToolsBuiltin(_m[0])) {
                    for (var _mj = 0; _mj < _m.length; _mj++) {
                        var _n = _m[_mj].toLowerCase();
                        if (_existingNoTool.indexOf(_n) === -1 && _n !== '*') {
                            _existingNoTool.push(_n);
                        }
                    }
                }
            }
        }
        localStorage.setItem('noToolModels', JSON.stringify(_existingNoTool));
    } catch(e) { console.warn('[ModelCfg] 初始化 no-tool 列表失败:', e.message); }
    // ★ 核心逻辑: 只在真正没有任何对话时才新建
    var chatKeys = Object.keys(chats);
    if (chatKeys.length === 0 && _serverChats && typeof _serverChats === 'object' && Object.keys(_serverChats).length > 0) {
        // 服务器有数据但本地被清空了,用服务器数据恢复
        console.log('[restoreUserData] 本地无记录,从服务器恢复', Object.keys(_serverChats).length, '个对话');
        chats = JSON.parse(JSON.stringify(_serverChats));
        try { slimSaveChats(); } catch(e) {}
        renderChatHistory();
        chatKeys = Object.keys(chats);
    }
    // ★ 双重检查: 合并后仍然为空才新建
    if (chatKeys.length === 0) {
        console.log('[restoreUserData] 无聊天记录,自动新建');
        createNewChat();
    } else {
        // 恢复上次打开的对话
        var lastId = localStorage.getItem('lastChatId');
        if (lastId && chats[lastId]) {
            loadChat(lastId);
        } else {
            var firstKey = chatKeys.sort(function(a,b) { return (chats[b].updated_at||0) - (chats[a].updated_at||0); })[0];
            loadChat(firstKey || chatKeys[0]);
        }
    }
    // ★ 恢复刷新前输入框中的文本
    try {
        var _savedText = localStorage.getItem('_savedInputText');
        if (_savedText) {
            var _input = getEl('chatInput');
            if (_input) {
                _input.value = _savedText;
                // 自动聚焦并移动光标到末尾
                _input.focus();
                _input.selectionStart = _input.selectionEnd = _savedText.length;
                // 触发输入事件,让UI更新发送按钮状态
                _input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            localStorage.removeItem('_savedInputText');
        }
    } catch(e) {}


    console.log('[restoreUserData] 恢复完成');
    // ★ 延迟启动 Agent 通知轮询, 避免和主数据加载竞争 abort
    setTimeout(function() { window.startAgentNotificationPolling(); }, 2000);
}

// ★ 登出前保存:确保当前账号的配置和聊天存到服务器
function saveUserDataBeforeLogout() {
    console.log('[logout] 开始保存用户数据');
    // 配置保存(keepalive 确保页面关闭后请求完成)
    var token = localStorage.getItem('authToken');
    if (!token) { console.log('[logout] 无token,跳过'); return; }

    // 直接构建并发送配置(同步读取localStorage,异步发送,keepalive保证送达)
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
        // ★ 使用 sendBeacon 确保页面卸载前请求送达(比 fetch 可靠)
        var _saveBlob = new Blob([JSON.stringify(config)], { type: 'application/json' });
        var _saveUrl = SERVER_API_BASE + '/chat.php?auth_token=' + token + '&action=save_config';
        navigator.sendBeacon(_saveUrl, _saveBlob);
        console.log('[logout] sendBeacon 已发送');
    } catch(e) { console.warn('[logout] 配置保存错误:', e.message); }

    // 聊天保存(使用 sendBeacon,保证页面关闭时请求送达)
    if (typeof chats !== 'undefined' && chats && Object.keys(chats).length > 0) {
        try {
            console.log('[logout] 保存聊天:', Object.keys(chats).length, '个');
            beaconSaveChats();
        } catch(e) { console.warn('[logout] 聊天保存错误:', e.message); }
    }
    console.log('[logout] 保存已触发');
}

const AI_JUDGE_TIMEOUT = 5000;
const MAX_HISTORY_LENGTH = 2000;
const TITLE_MAX_LENGTH = 20;
const MAX_TOKENS_SAFETY_MARGIN = 1000;
const STREAM_DELAY = 2;


// ★ Agent 模式独立聊天 ID - 不混入普通历史记录
const AGENT_CHAT_ID = '_agent_main';
// 普通模式下最后打开的聊天 ID (切换 agent 时保存,切回时恢复)
let lastNormalChatId = localStorage.getItem('lastNormalChatId') || null;

const DEFAULT_CONFIG = {
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
- 如果子代理已经创建并运行,**不要重复开始工作**。子代理的结果会通过系统通知给你
- 子代理在运行时,你可以做其他不冲突的事或等待。不要抢先做子代理正在做的工作
- 简单任务(≤2次搜索/读已知文件)直接用工具,不开子代理
- 读已知路径文件:直接用 server_file_read
- 复杂/批量/耗时>2分钟:用子代理
## 行为规范
- 每一步工具调用后,简短说明下一步计划
- 工具调用之间保持用户知情
- 复杂任务主动拆解为子任务,多步骤任务优先用子代理
- 操作文件前先确认路径
- 执行危险命令前询问用户
## ★ 子代理完成后的处理规则(强制遵守)
- 系统消息中的「子代理完成报告」是内部通知,**不是用户的消息,不要回复**
- ⚠️ 强制规则:禁止回复「子代理已完成」「搜索完成」「结果来了」「报告已完成」这类通知
- ⚠️ 强制规则:收到子代理报告时**禁止创建任何新的子代理**。只记录结果,不要行动
- 子代理运行期间,**不要向用户汇报进度**,用户只需要看到最终的综合回答
- 当所有子代理都完成后,如果用户还在等待,自然整合结果回复一条。否则保持静默
- 子代理失败也静默,用户不问就不提`
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
let streamingScrollLock = false;

// ★★★★★ 流式渲染优化 v2: 基于 RAF 的批量渲染 + 平滑滚动系统 ★★★★★
// 参考: ChatGPT UI, Upstash smooth-streaming, Open WebUI rendering patterns
// 核心优化:
//   1. 数据层(textBuffer)与渲染层(DOM)分离
//   2. RAF 批量渲染(16ms对齐显示刷新率),不再是每token触发innerHTML
//   3. 滚动跟随与渲染统一到RAF循环,不再独立setInterval
//   4. marked.parse仅在实际渲染时调用,流式期间保护KaTeX原文

var _streamState = {};  // { chatId: { text, rafId, lastRenderLen, lastTime, bubble } }

function applyStreamRender(chatId, fullText) {
    var st = _streamState[chatId];
    if (!st) {
        st = _streamState[chatId] = {
            text: '',
            rafId: null,
            lastRenderLen: 0,
            lastTime: 0,
            bubble: activeBubbleMap[chatId],
            tickCount: 0
        };
    }
    st.text = fullText;
    st.bubble = activeBubbleMap[chatId] || st.bubble;
    if (!st.rafId) {
        st.lastTime = performance.now();
        st.rafId = requestAnimationFrame(function _streamLoop(now) {
            var st2 = _streamState[chatId];
            if (!st2) return;
            // ★ 自适应帧率: 快速阶段(前100 tokens) 16ms/帧, 稳定后 33ms/帧
            var interval = st2.tickCount < 100 ? 16 : 33;
            if (now - st2.lastTime < interval && st2.text.length - st2.lastRenderLen < 40) {
                // 数据量不够一帧,继续等待
                st2.rafId = requestAnimationFrame(_streamLoop);
                return;
            }
            st2.lastTime = now;
            st2.tickCount++;
            var bubble = st2.bubble;
            var isAlive = bubble && document.body.contains(bubble);
            var isTyping = isTypingMap[chatId];
            if (!isAlive || !isTyping) {
                // 气泡被移除或流已停止,清除状态
                cancelAnimationFrame(st2.rafId);
                delete _streamState[chatId];
                return;
            }
            // 执行一次渲染
            _flushStreamRender_batched(chatId, st2);
            // 滚动跟随
            if (!userScrolled && $.chatBox) {
                $.chatBox.scrollTop = $.chatBox.scrollHeight;
            }
            if (isTyping) {
                st2.rafId = requestAnimationFrame(_streamLoop);
            } else {
                cancelAnimationFrame(st2.rafId);
                st2.rafId = null;
            }
        });
    }
}

function _flushStreamRender_batched(chatId, st) {
    var text = st.text;
    if (!text || text.length === st.lastRenderLen) return;
    st.lastRenderLen = text.length;
    var bubble = st.bubble;
    if (!bubble) return;
    var mb = bubble.querySelector('.markdown-body');
    if (!mb) return;
    var prevH = mb.offsetHeight;
    if (prevH > 40) mb.style.minHeight = prevH + 'px';
    try {
        mb.innerHTML = _renderMarkdownWithMath_cached(autoLinkURLs(text), st);
    } catch(e) {
        mb.textContent = text;
    }
    requestAnimationFrame(function() { mb.style.minHeight = ''; });
}

// ★ 流式期间: 实时 KaTeX 渲染 + 公式缓存, 避免重复渲染已闭合的公式
// 缓存 key = formula_text → rendered HTML, 只有新公式或变化才调用 katex
function _renderMarkdownWithMath_cached(text, st) {
    if (!text) return '';
    if (!window.marked) return escapeHtml(text).replace(/\n/g, '<br>');

    // ★ 增量公式缓存: st._mathCache = { formulaText: renderedHtml }
    if (!st._mathCache) st._mathCache = {};
    if (!st._lastFormulaCount) st._lastFormulaCount = 0;

    // 提取所有公式及其位置
    var formulas = [];
    var protected_ = text;
    var _mathCounter = 0;

    // 块公式 $$...$$
    protected_ = protected_.replace(/\$\$([\s\S]*?)\$\$/g, function(_, f) {
        var id = 'MATHB' + (_mathCounter++);
        formulas.push({ id: id, type: 'block', formula: f.trim() });
        return id;
    });
    // 块公式 \[...\]
    protected_ = protected_.replace(/\\\[([\s\S]*?)\\\]/g, function(_, f) {
        var id = 'MATHB' + (_mathCounter++);
        formulas.push({ id: id, type: 'block', formula: f.trim() });
        return id;
    });
    // 行内公式 $...$
    protected_ = protected_.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, function(_, f) {
        var id = 'MATHI' + (_mathCounter++);
        formulas.push({ id: id, type: 'inline', formula: f.trim() });
        return id;
    });
    // 行内公式 \(...\)
    protected_ = protected_.replace(/\\\(([^)]+?)\\\)/g, function(_, f) {
        var id = 'MATHI' + (_mathCounter++);
        formulas.push({ id: id, type: 'inline', formula: f.trim() });
        return id;
    });

    var html = window.marked.parse(protected_);

    // 渲染公式(带缓存)
    for (var i = 0; i < formulas.length; i++) {
        var fInfo = formulas[i];
        var cacheKey = fInfo.type + ':' + fInfo.formula;
        var rendered = st._mathCache[cacheKey];
        if (!rendered) {
            try {
                if (window.katex) {
                    rendered = katex.renderToString(fInfo.formula, {
                        throwOnError: false,
                        displayMode: fInfo.type === 'block',
                        strict: false
                    });
                } else {
                    rendered = fInfo.type === 'block'
                        ? '<p style="text-align:center">$$' + fInfo.formula + '$$</p>'
                        : '$' + fInfo.formula + '$';
                }
            } catch(e) {
                rendered = fInfo.type === 'block'
                    ? '<p style="text-align:center">$$' + fInfo.formula + '$$</p>'
                    : '$' + fInfo.formula + '$';
            }
            st._mathCache[cacheKey] = rendered;
        }
        html = html.split(fInfo.id).join(rendered);
    }
    st._lastFormulaCount = formulas.length;

    return html;
}

// ★ 旧函数保留兼容(流结束后一次性完整渲染用)
function _renderStreamMarkdown(text) {
    return _renderMarkdownWithMath(text);
}

// ★ 流结束时清理RAF状态(外部调用)
function cleanupStreamState(chatId) {
    var st = _streamState[chatId];
    if (st && st.rafId) {
        cancelAnimationFrame(st.rafId);
        st.rafId = null;
    }
    delete _streamState[chatId];
}
  // 流式期间锁定滚动跟随
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
     * 流式输出时自动应用动态延迟(文本越长延迟越大)
     */
    smartRender(text, container, force = false) {
        if (!text || !container) return;
        if (!force && text === this.lastText && container === this.lastContainer) return;

        // 清理之前的定时器
        if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }

        this.lastText = text;
        this.lastContainer = container;

        // 动态延迟:短文本快速响应,长文本适当延迟减少闪烁
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
        // 如果在渲染期间有新的 pending,继续处理
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
     * 执行渲染(核心方法)
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

        // 后处理(代码高亮、Mermaid 等)使用微任务避免阻塞
        this.postRender(container);

        const elapsed = performance.now() - startTime;
        if (elapsed > 50) console.log(`[Markdown] Render: ${elapsed.toFixed(1)}ms`);
    },

    /**
     * 后处理:代码高亮 + Mermaid + 图片优化
     */
    postRender(container) {
        // 代码高亮
        this.highlightCode(container);
        // Mermaid 图表(异步,不阻塞)
        this.renderMermaid(container);
        // 图片优化(懒加载)
        this.optimizeImages(container);
    },

    /** 渲染 Mermaid 图表(支持流式实时渲染) */
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

        // 步骤2: 渲染所有尚未渲染的 .mermaid div(流式渲染时每帧重建,会自动重试)
        var mermaidDivs = container.querySelectorAll('.mermaid');
        if (!mermaidDivs.length) return;
        mermaidDivs.forEach(function(div) {
            var code = div.getAttribute('data-original-code') || div.textContent;
            if (!code || div.querySelector('svg')) return;
            // 流式渲染: 如果 mermaid 代码还在不断变化,跳过本次渲染避免闪烁
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

    /** 图片优化:懒加载 + 异步解码 */
    optimizeImages(container) {
        container.querySelectorAll('img').forEach(img => {
            img.loading = 'lazy';
            img.decoding = 'async';
        });
    },

    /** 强制立即渲染(跳过防抖) */
    forceRender(text, container) {
        if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
        if (this._pending) this._pending = null;
        this.doRender(text, container);
    },

    /** 清空缓存 */
    clearCache() { this.cache.clear(); }
};

// 后处理辅助:渲染完 HTML 后触发代码高亮 + Mermaid 图表
function _triggerPostRender(container) {
    if (!container || !MarkdownRenderer) return;
    setTimeout(function() {
        MarkdownRenderer.postRender(container);
    }, 0);
}

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
        // ★ 修复 x-axis 标签数量与数据点不匹配的问题
        var xMatch = c.match(/x-axis[^[]*\[([^\]]*)\]/);
        var lineMatches = c.match(/line\s+"[^"]*"\s+([\d.,\s]+)/g);
        if (xMatch && lineMatches && lineMatches.length > 0) {
            var xLabels = xMatch[1].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
            var lastLine = lineMatches[lineMatches.length - 1];
            var dataPoints = lastLine.replace(/line\s+"[^"]*"\s+/, '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
            if (xLabels.length > 0 && dataPoints.length > 0 && xLabels.length < dataPoints.length) {
                var newLabels = [];
                for (var li = 0; li < dataPoints.length; li++) {
                    newLabels.push(xLabels[li % xLabels.length]);
                }
                c = c.replace(/x-axis[^[]*\[([^\]]*)\]/, xMatch[0].replace(xMatch[1], newLabels.join(', ')));
            }
        }
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
    // 输入框为空时用 DEFAULT_CONFIG 的默认值(仅非敏感配置)
    if (!val && id === 'baseUrl' && DEFAULT_CONFIG.url) return DEFAULT_CONFIG.url;
    if (!val && id === 'modelSelect' && DEFAULT_CONFIG.model) return DEFAULT_CONFIG.model;
    return val;
};
const getChecked = id => getEl(id)?.checked || false;
const setVal = (id, val) => { const el = getEl(id); if (el) el.value = (val === undefined || val === null) ? '' : val; };
const setChecked = (id, val) => { const el = getEl(id); if (el) el.checked = val; };

window.onProviderChange = function() {
    var provider = getEl('baseUrlProvider')?.value || 'custom';
    var cfg = API_PROVIDERS[provider] || API_PROVIDERS.custom;

    // 1. 保存当前 Key 到旧厂商(永远存到独立 key,不碰 apiKey)
    var curKey = getVal('apiKey') || '';
    var oldP = localStorage.getItem('baseUrlProvider') || '';
    if (oldP && oldP !== provider && curKey) {
        var oldCfg = API_PROVIDERS[oldP] || {};
        // ★ 存到旧厂商的独立 key,不覆盖 apiKey
        if (oldCfg.keyLS) localStorage.setItem(oldCfg.keyLS, encrypt(curKey));
    }

    // 2. Base URL
    if (provider === 'custom') setVal('baseUrl', localStorage.getItem('baseUrlCustom') || '');
    else setVal('baseUrl', cfg.baseUrl || '');

    // 3. API Key 从新厂商加载
    var savedKey = localStorage.getItem(cfg.keyLS);
    var cleanKey = '';
    if (savedKey) { var dk = decrypt(savedKey); cleanKey = (dk && dk !== 'not-needed') ? dk : ''; }
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
    var sm = localStorage.getItem('model_' + provider) || '';
    if (sm) { setVal('modelSelect', sm); localStorage.setItem('model', sm); }
    else { setVal('modelSelect', ''); localStorage.setItem('model', ''); }

    _currentProvider = provider;
    console.log('[PROVIDER] ->' + provider + ' key:' + (cleanKey ? '***' : 'empty') + ' url:' + getVal('baseUrl'));
    console.log('[PROVIDER] localStorage apiKey:', localStorage.getItem('apiKey') ? 'SET' : 'EMPTY');
    console.log('[PROVIDER] input apiKey.value:', getEl('apiKey')?.value ? 'SET' : 'EMPTY');
};
function getCurrentApiKeyLSKey() {
    var p = getEl('baseUrlProvider')?.value || 'custom';
    return (API_PROVIDERS[p] || API_PROVIDERS.custom).keyLS;
}

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
// ════════════════════════════════════════════════════
//  模型配置适配层 - 通过 js/models.js 加载
//  为每个模型提供专属参数、能力、格式支持
// ════════════════════════════════════════════════════

/** 获取当前选中模型的名称(小写) */
function _getCurModel() {
    return (getVal('modelSelect') || DEFAULT_CONFIG.model || '').toLowerCase();
}

/** 获取当前模型的专属配置 */
function _getModelCfg(modelName) {
    var name = modelName || _getCurModel();
    if (window.MODEL_CONFIGS) return window.MODEL_CONFIGS;
    // 降级:返回一个空对象(不影响现有逻辑)
    return {
        getConfig: function(){return {};},
        supports: function(){return false;},
        getBannedParams: function(){return [];},
        getBannedBodyKeys: function(){return [];},
        getContextWindow: function(){return 131072;},
        getMaxOutputTokens: function(){return 4096;},
        getToolCallFormat: function(){return 'openai';},
        getReasoningMode: function(){return null;},
        isNoToolsBuiltin: function(){return false;},
        sanitizeBody: function(n,b){return b;},
        supportsStream: function(){return true;},
        supportsTools: function(){return true;},
        supportsVision: function(){return false;},
        supportsReasonEffort: function(){return false;},
    };
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
        const currentModel = getVal('modelSelect') || DEFAULT_CONFIG.model || '';
        // ★ 使用模型配置:检查模型是否支持视觉
        const _vm = _getModelCfg().supportsVision(currentModel);
        if (!_vm) return false; // 文本模型不支持视觉格式,由 analyze_image 工具处理
        return true;
    }

    const visionModel = localStorage.getItem('visionModel') || '';
    const model = getVal('modelSelect') || localStorage.getItem('model') || '';

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
        const autoTextModels = JSON.parse(localStorage.getItem('autoDetectedTextModels') || '[]');
        for (var _ati = 0; _ati < autoTextModels.length; _ati++) {
            if (modelLower.indexOf(autoTextModels[_ati]) !== -1) return false;
        }
    } catch (e) {}
    // 特定的非视觉模型黑名单(内置)
    const textModels = ['deepseek-reasoner', 'grok-3-reasoning'];
    const isTextModel = textModels.some(tm => modelLower.includes(tm));

    // 如果有视觉关键词且不是文本模型,返回 true
    return (visionModel || hasVisionKeyword) && !isTextModel;
}

function buildUserContent(text, files) {
    if (!files?.length) return text;

    // 检查是否包含图片
    const hasImages = files.some(f => f.isImage || f.type?.startsWith('image/'));

    if (hasImages && shouldUseVisionFormat()) {
        // OpenAI 视觉模型格式:数组
        const content = [];
        // 添加图片(优先使用服务器URL避免base64过大导致SSL错误)
        // ★ 本地/自建模型: 检测 baseUrl 是否为本地地址,强制用 base64 data URL
        // 因为 localhost/内网服务器可能无法访问公网 serverUrl
        var _baseUrl = (getVal?.('baseUrl') || localStorage.getItem('baseUrl') || '').toLowerCase();
        var _isLocalModel = _baseUrl.includes('localmodels') || _baseUrl.includes('localhost') || _baseUrl.includes('127.0.0.1') || _baseUrl.includes('192.168.');
        for (const f of files) {
            if (f.isImage || f.type?.startsWith('image/')) {
                var _imgUrl = f.content;
                // 非本地模型且有服务器URL时,优先使用服务器URL(大幅减小请求体大小)
                if (!_isLocalModel && f.serverUrl) {
                    _imgUrl = f.serverUrl.startsWith('http') ? f.serverUrl : window.location.origin + f.serverUrl;
                }
                console.log('[Vision] 📷 ' + _imgUrl.substring(0, 50) + '...');
                content.push({
                    type: 'image_url',
                    image_url: { url: _imgUrl }
                });
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
        const imageFiles = files.filter(f => f.type?.startsWith('image/'));
        // 保存当前消息的图片数据到 chat 隔离变量,供 analyze_image 工具处理器使用
        if (!window._currentMessageImagesByChat) window._currentMessageImagesByChat = {};
        window._currentMessageImagesByChat[currentChatId] = imageFiles.map(f => ({ name: f.name, content: f.content, type: f.type }));

        const imageDescs = imageFiles.map(f => `[用户上传了图片: ${f.name}]`);
        const otherFiles = files.filter(f => !f.type?.startsWith('image/'));
        const otherContent = otherFiles.length
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
        const imagePart = imageDescs.join(', ');
        // 不强制要求调用工具,让AI自主决定是否分析图片
        // 工具 analyze_image 已在请求中提供,AI可以自主选择调用
        const textPart = text ? `\n用户指令: ${text}` : '';
        return (imagePart + (imagePart && otherContent ? '\n\n' : '') + otherContent + textPart).trim();
    }

    // 非图片文件:保持原有文本格式,但截断超大附件避免超token
    const MAX_FILE_CHARS = 80000;
    const fileParts = files.map(f => {
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
    if (ext === 'pptx' || ext === 'ppt') {
        if (!window.JSZip) throw new Error('JSZip 未加载');
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        // PPTX 中幻灯片在 ppt/slides/slideN.xml 中
        const slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f)).sort();
        if (!slideFiles.length) {
            // 也检查 ppt/slides/_rels/ 或老格式
            return '[PPT] 未找到幻灯片内容,请确认文件格式正确。';
        }
        var slideTexts = [];
        var MAX_SLIDE_CHARS = 5000;  // 每张幻灯片最多取前5000字符
        var MAX_TOTAL_CHARS = 80000; // 整个PPT最多取80000字符
        var totalChars = 0;
        for (let i = 0; i < slideFiles.length; i++) {
            if (totalChars >= MAX_TOTAL_CHARS) {
                slideTexts.push('...(后续' + (slideFiles.length - i) + '张幻灯片因内容过长已截断)');
                break;
            }
            var xmlStr = await zip.files[slideFiles[i]].async('text');
            // 提取 a:t 标签内的文本(PPTX 文本存放在 <a:t>text</a:t>)
            var texts = [];
            var regex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
            var match;
            while ((match = regex.exec(xmlStr)) !== null) {
                if (match[1].trim()) texts.push(match[1].trim());
            }
            var slideText = texts.join(' ');
            if (slideText.trim()) {
                // 单张幻灯片截断
                if (slideText.length > MAX_SLIDE_CHARS) {
                    slideText = slideText.substring(0, MAX_SLIDE_CHARS) + '...(本页过长已截断)';
                }
                var slideEntry = '【幻灯片 ' + (i + 1) + '】' + slideText;
                totalChars += slideEntry.length;
                slideTexts.push(slideEntry);
            }
        }
        var result = slideTexts.length ? slideTexts.join('\n\n') : '[PPT] 解析完成,未提取到文字内容。';
        // 如果整体仍过大,在最外层再截断一次
        if (result.length > MAX_TOTAL_CHARS + 200) {
            result = result.substring(0, MAX_TOTAL_CHARS) + '\n\n...(内容过长已截断)';
        }
        return result;
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
        // ★ 文件名 + 大小放在可收缩的 span 中,删除按钮独立不隐藏
        tag.innerHTML = `<span class="file-tag-name">${escapeHtml(f.name)} (${(f.size / 1024).toFixed(1)}KB)</span><span class="file-tag-remove" onclick="window.removeFile(${i});event.stopPropagation();">✕</span>`;
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

// ★ 粘贴图片支持: 监听输入框 paste 事件,自动将剪贴板图片转为 pendingFiles
function setupPasteImageSupport() {
    if (!$.userInput) return;
    $.userInput.addEventListener('paste', async function(e) {
        var items = (e.clipboardData || window.clipboardData)?.items;
        if (!items) return;
        var imageItems = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                imageItems.push(items[i]);
            }
        }
        if (!imageItems.length) return; // 没有图片,正常粘贴文字
        e.preventDefault(); // 阻止默认粘贴(避免 base64 出现在输入框)
        for (var j = 0; j < imageItems.length; j++) {
            var blob = imageItems[j].getAsFile();
            if (!blob) continue;
            var reader = new FileReader();
            await new Promise(function(resolve) {
                reader.onload = function() {
                    var dataUrl = reader.result;
                    // 压缩大图
                    if (dataUrl.length > 500 * 1024) {
                        var img = new Image();
                        img.onload = function() {
                            var canvas = document.createElement('canvas');
                            var maxW = 1920, maxH = 1920;
                            var scale = Math.min(maxW / img.width, maxH / img.height, 1);
                            canvas.width = img.width * scale;
                            canvas.height = img.height * scale;
                            var ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                            dataUrl = canvas.toDataURL('image/webp', 0.85);
                            addPastedImage(dataUrl, blob.name || 'clipboard.png', dataUrl.length);
                            resolve();
                        };
                        img.src = dataUrl;
                    } else {
                        addPastedImage(dataUrl, blob.name || 'clipboard.png', dataUrl.length);
                        resolve();
                    }
                };
                reader.readAsDataURL(blob);
            });
        }
        updateFilePreviewUI();
    });
}

function addPastedImage(dataUrl, name, size) {
    pendingFiles.push({
        name: name,
        content: dataUrl,
        size: size,
        isImage: true,
        type: 'image/png'
    });
}

// ★ 在光标位置插入文字(支持拖拽文字)
function insertTextAtCursor(input, text) {
    if (!input || !text) return;
    var start = input.selectionStart || 0;
    var end = input.selectionEnd || 0;
    var before = input.value.substring(0, start);
    var after = input.value.substring(end);
    input.value = before + text + after;
    var newPos = start + text.length;
    input.setSelectionRange(newPos, newPos);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
}

async function processSelectedFiles(fileList) {
    for (const file of Array.from(fileList)) {
        if (file.size > MAX_FILE_SIZE) {
            showToast('文件 ' + file.name + ' 超过300MB', 'warning');
            continue;
        }

        // 检查是否是图片文件
        var isImage = file.type.startsWith('image/');
        var isVideo = file.type.startsWith('video/');

        // ★ 创建进度条容器(文件预览区域内)
        var progressContainer = document.createElement('div');
        progressContainer.className = 'file-upload-progress';
        progressContainer.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:4px 8px;margin:2px 0;';
        // 文件名行
        var nameRow = document.createElement('div');
        nameRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:11px;';
        var nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'color:var(--text-secondary,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;';
        nameSpan.textContent = file.name;
        var statusSpan = document.createElement('span');
        statusSpan.textContent = isImage ? '读取中...' : '解析中...';
        statusSpan.style.cssText = 'color:#3b82f6;font-weight:500;font-size:10px;';
        nameRow.appendChild(nameSpan);
        nameRow.appendChild(statusSpan);
        progressContainer.appendChild(nameRow);
        // 进度条
        var barWrap = document.createElement('div');
        barWrap.style.cssText = 'height:3px;background:#e5e7eb;border-radius:2px;overflow:hidden;';
        var bar = document.createElement('div');
        bar.style.cssText = 'height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:2px;width:10%;transition:width 0.4s ease;';
        barWrap.appendChild(bar);
        progressContainer.appendChild(barWrap);
        // ★ 确保容器可见(移除 hidden 类,否则进度条加进去也看不见)
        if ($.filePreviewContainer) {
            $.filePreviewContainer.classList.remove('hidden');
            $.filePreviewContainer.appendChild(progressContainer);
        }

        function _setProgress(pct, label) {
            bar.style.width = pct + '%';
            statusSpan.textContent = label;
        }
        function _setError(label) {
            bar.style.background = 'linear-gradient(90deg,#ef4444,#f97316)';
            bar.style.width = '100%';
            statusSpan.textContent = label;
            statusSpan.style.color = '#ef4444';
        }
        function _setDone() {
            bar.style.width = '100%';
            bar.style.background = 'linear-gradient(90deg,#22c55e,#10b981)';
            statusSpan.textContent = '✅ 完成';
            statusSpan.style.color = '#22c55e';
        }

        try {
            if (isImage) {
                _setProgress(5, '读取中...');
                var base64 = await fileToBase64(file);
                var rawDataUrl = 'data:' + file.type + ';base64,' + base64;

                // ★ 客户端压缩图片
                _setProgress(20, '压缩中...');
                var compressedUrl;
                try {
                    compressedUrl = await compressImage(rawDataUrl);
                } catch(e) {
                    console.warn('[compressImage] 压缩失败,使用原始图片:', e.message);
                    compressedUrl = rawDataUrl;
                }
                var dataUrl = compressedUrl || rawDataUrl;
                var compressedBytes = atob(dataUrl.split(',')[1] || '').length;
                var compressedSizeKB = Math.round(compressedBytes / 1024);
                console.log('[Image]', file.name, '压缩:', (file.size/1024).toFixed(0), 'KB →', compressedSizeKB, 'KB');

                // ★ 上传到本地服务器(用压缩后的字节数,UI显示正确的实际大小)
                // type 从压缩后 dataUrl 提取,保持原始格式(JPEG/PNG),避免 webp 不被本地模型支持
                var _compType = (dataUrl.match(/^data:(image\/[\w+]+);/) || [])[1] || 'image/jpeg';
                var fileObj = { name: file.name, content: dataUrl, size: compressedBytes, isImage: true, type: _compType };
                _setProgress(60, '上传中...');
                try {
                    var srvUrl = await uploadImageToServer(dataUrl);
                    if (srvUrl) {
                        fileObj.serverUrl = srvUrl;
                        _setProgress(95, '上传完成');
                    } else {
                        _setProgress(95, '上传失败(用缓存)');
                    }
                } catch(e) {
                    console.warn('[upload] 上传失败:', e.message);
                    _setProgress(95, '上传异常(用缓存)');
                }
                pendingFiles.push(fileObj);
                _setDone();
                // 短暂展示完成状态后替换为文件tag
                setTimeout(function() {
                    if (progressContainer.parentNode) progressContainer.remove();
                    updateFilePreviewUI();
                }, 600);
            } else if (isVideo) {
                _setProgress(5, '准备上传...');
                // ★ 直接 Blob 上传: 避免 FileReader.readAsDataURL 将大视频全部读入内存
                //    30MB+ 视频用 base64 会导致浏览器内存溢出崩溃
                var fileObj = { name: file.name, isVideo: true, type: file.type, size: file.size };
                _setProgress(30, '上传视频中...');
                try {
                    var srvUrl = await uploadVideoBlob(file, _setProgress);
                    if (srvUrl) {
                        fileObj.serverUrl = srvUrl;
                        fileObj.content = srvUrl; // 存 URL 而非 base64,节省内存
                        _setProgress(95, '上传完成');
                    } else {
                        // 降级: 小视频走 base64
                        _setProgress(40, '降级读取...');
                        var base64 = await fileToBase64(file);
                        var dataUrl = 'data:' + file.type + ';base64,' + base64;
                        fileObj.content = dataUrl;
                        _setProgress(80, '上传(base64)...');
                        srvUrl = await uploadImageToServer(dataUrl);
                        if (srvUrl) fileObj.serverUrl = srvUrl;
                    }
                } catch(e) {
                    console.warn('[video] Blob上传失败,走base64:', e.message);
                    _setProgress(40, '降级读取...');
                    var base64 = await fileToBase64(file);
                    var dataUrl = 'data:' + file.type + ';base64,' + base64;
                    fileObj.content = dataUrl;
                    _setProgress(80, '上传(base64)...');
                    srvUrl = await uploadImageToServer(dataUrl);
                    if (srvUrl) fileObj.serverUrl = srvUrl;
                }
                pendingFiles.push(fileObj);
                _setDone();
                setTimeout(function() {
                    if (progressContainer.parentNode) progressContainer.remove();
                    updateFilePreviewUI();
                }, 600);
            } else {
                _setProgress(20, '解析中...');
                var content = await extractFileContent(file);
                pendingFiles.push({ name: file.name, content: content, size: file.size, isImage: false, type: file.type });
                _setDone();
                setTimeout(function() {
                    if (progressContainer.parentNode) progressContainer.remove();
                    updateFilePreviewUI();
                }, 400);
            }
        } catch (err) {
            console.warn('[processFile] 出错:', err.message);
            _setError('失败: ' + err.message);
            setTimeout(function() {
                if (progressContainer.parentNode) progressContainer.remove();
                updateFilePreviewUI();
            }, 2000);
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

// ==================== 🧠 Thinking Indicator API ====================
// 参考 DeepSeek-TUI 的思考进度指示器
window.showThinking = function(step, todoItems) {
    var el = getEl('thinkingIndicator');
    if (!el) return;
    el.classList.add('active');
    var stepEl = getEl('thinkingStep');
    var todoEl = getEl('thinkingTodo');
    if (stepEl && step) stepEl.textContent = step;
    if (todoEl && todoItems) {
        todoEl.innerHTML = todoItems.map(function(item) {
            var cls = item.done ? 'done' : item.active ? 'active' : 'pending';
            var icon = item.done ? '✅' : item.active ? '🔄' : '⏳';
            return '<div class="thinking-todo-item ' + cls + '">' + icon + ' ' + escapeHtml(item.text) + '</div>';
        }).join('');
    }
};
window.updateThinkingStep = function(step) {
    var stepEl = getEl('thinkingStep');
    if (stepEl) stepEl.textContent = step;
};
window.updateThinkingTodo = function(items) {
    var todoEl = getEl('thinkingTodo');
    if (!todoEl) return;
    todoEl.innerHTML = items.map(function(item) {
        var cls = item.done ? 'done' : item.active ? 'active' : 'pending';
        var icon = item.done ? '✅' : item.active ? '🔄' : '⏳';
        return '<div class="thinking-todo-item ' + cls + '">' + icon + ' ' + escapeHtml(item.text) + '</div>';
    }).join('');
};
window.hideThinking = function() {
    var el = getEl('thinkingIndicator');
    if (el) el.classList.remove('active');
};

// ==================== 🔄 工具调用滚动卡片 ====================
// 每个工具调用在回复气泡底部追加一条,调用完后保留显示
// 下一个工具调用时自动追加新行,旧行向上滚动(单向滚动,不闪烁)
window._toolCallLines = [];

// ==================== 原生多模态处理状态提示 ====================
// 参考工具调用状态行样式,正文出现后自动淡出
window.showImageProcessingHint = function(chatId, files) {
    if (!chatId || !activeBubbleMap[chatId]) return;
    var bubble = activeBubbleMap[chatId];
    // 避免重复创建
    if (bubble.querySelector('.native-vision-hint')) return;

    var imgCount = files.filter(function(f) { return f.isImage || (f.type && f.type.startsWith('image/')); }).length;
    var hintEl = document.createElement('div');
    hintEl.className = 'native-vision-hint';
    hintEl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 12px;margin:4px 0;border-radius:8px;background:linear-gradient(135deg,#667eea0a,#764ba20a);border:1px solid #667eea18;font-size:12px;color:#a78bfa;animation:visionPulse 1.8s ease-in-out infinite;';
    hintEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
        '<span>原生视觉分析中 · ' + imgCount + ' 张图片</span>';

    var reasoning = bubble.querySelector('details.reasoning-details');
    var md = bubble.querySelector('.markdown-body');
    if (reasoning) {
        reasoning.after(hintEl);
    } else if (md) {
        md.before(hintEl);
    } else {
        bubble.appendChild(hintEl);
    }

    // ★ 正文出现后自动移除 (用 MutationObserver 监听)
    var observer = new MutationObserver(function() {
        var _md = bubble.querySelector('.markdown-body');
        if (_md && _md.textContent && _md.textContent.trim().length > 5) {
            _fadeOut();
        }
    });
    function _fadeOut() {
        observer.disconnect();
        hintEl.style.transition = 'opacity 0.25s, transform 0.25s';
        hintEl.style.opacity = '0';
        hintEl.style.transform = 'translateY(-4px)';
        setTimeout(function() { if (hintEl.parentNode) hintEl.remove(); }, 260);
    }
    if (md) observer.observe(md, { childList: true, subtree: true, characterData: true });
    // 超时 60 秒自动移除
    setTimeout(function() {
        if (hintEl.parentNode) { _fadeOut(); }
    }, 60000);
};

// ==================== 工具调用状态行 (独立, 完成后3秒淡出) ====================
window.showToolStatus = function(toolName, argPreview, status) {
    if (!currentChatId) return;
    var bubble = activeBubbleMap[currentChatId];
    if (!bubble) return;

    var tcContainer = bubble.querySelector('.tool-call-lines');
    if (!tcContainer) {
        tcContainer = document.createElement('div');
        tcContainer.className = 'tool-call-lines';
        var reasoning = bubble.querySelector('details');
        var md = bubble.querySelector('.markdown-body');
        if (reasoning && md) reasoning.after(tcContainer);
        else if (md) md.before(tcContainer);
        else bubble.appendChild(tcContainer);
    }

    if (status === null) return;

    // ★ 旧行推出 - 用 opacity + margin-top 压缩
    tcContainer.querySelectorAll('.tool-call-line').forEach(function(old) {
        old.style.transition = 'all 0.15s ease';
        old.style.opacity = '0';
        old.style.marginTop = '-28px';
        setTimeout(function() { if (old.parentNode) old.remove(); }, 180);
    });

    var line = document.createElement('div');

    var iconHtml = '';
    if (status === 'running') {
        iconHtml = '<svg class=tool-call-spin width=18 height=18 viewBox="0 0 24 24" fill=none stroke=#6366f1 stroke-width=3 stroke-linecap=round><path d="M12 2a10 10 0 0 1 0 20"/></svg>';
    } else if (status === 'success') {
        iconHtml = '<svg class=tool-call-check width=18 height=18 viewBox="0 0 24 24" fill=none stroke=#22c55e stroke-width=3 stroke-linecap=round stroke-linejoin=round><path d="M4 12l6 6L20 6"/></svg>';
    } else if (status === 'error') {
        iconHtml = '<svg class=tool-call-x width=16 height=16 viewBox="0 0 24 24" fill=none stroke=#dc2626 stroke-width=3 stroke-linecap=round><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
    }

    line.innerHTML = '<span class=tool-c...wrap>' + iconHtml + '</span>' +
        '<span class="tool-call-name">' + escapeHtml(toolName) + '</span>' +
        (argPreview ? '<span class="tool-call-arg">' + escapeHtml((argPreview||'').substring(0, 40)) + '</span>' : '');

    var cls = 'tool-call-line';
    if (status === 'running') cls += ' tool-call-running';
    else if (status === 'success') { cls += ' tool-call-success'; try { navigator.vibrate && navigator.vibrate([15]); } catch(e){} }
    else if (status === 'error') { cls += ' tool-call-error'; try { navigator.vibrate && navigator.vibrate([30,50,30]); } catch(e){} }
    line.className = cls;
    line.dataset.tcStatus = status;
    line.dataset.tcName = toolName;
    tcContainer.appendChild(line);

    // 完成后 3 秒淡出
    if (status === 'success' || status === 'error') {
        var self = line;
        setTimeout(function() {
            if (!self.parentNode) return;
            self.style.transition = 'all 0.35s ease';
            self.style.maxHeight = '0'; self.style.opacity = '0'; self.style.padding = '0'; self.style.margin = '0'; self.style.borderWidth = '0';
            setTimeout(function() { if (self.parentNode) self.remove(); }, 400);
        }, 3000);
    }
};

function showToast(msg, type = 'info', dur = 3000) {
    var container = getEl('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    var toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${ { success: '✓', error: '✕', warning: '⚠', info: 'i' }[type] }</div>
        <div class="toast-message">${escapeHtml(msg)}</div>
        <button class="toast-close">&times;</button>
    `;
    toast.querySelector('.toast-close').onclick = () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(function() { toast.remove(); }, 200);
    };
    setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(function() { toast.remove(); }, 200);
    }, dur);
    container.appendChild(toast);
}

// ============================================================
// ⌨️ Slash Command Popup
// ============================================================
var SLASH_COMMANDS = [
    { cmd: 'search', hint: '强制联网搜索', args: '[query]', icon: 'search', group: '搜索' },
    { cmd: 'news', hint: '搜索新闻', args: '[query]', icon: 'news', group: '搜索' },
    { cmd: 'image', hint: '搜索图片', args: '[query]', icon: 'image', group: '搜索' },
    { cmd: 'mode', hint: '切换工作模式', args: '[plan|agent|yolo|off]', icon: 'mode', group: 'Agent' },
    { cmd: 'model', hint: '切换 AI 模型', args: '[name]', icon: 'model', group: 'Agent' },
    { cmd: 'retry', hint: '重新生成上一条回复', icon: 'retry', group: '对话' },
    { cmd: 'clear', hint: '清空当前对话', icon: 'clear', group: '对话' },
    { cmd: 'compact', hint: '压缩对话上下文', icon: 'compact', group: '对话' },
    { cmd: 'new', hint: '新建对话', icon: 'new', group: '对话' },
    { cmd: 'export', hint: '导出聊天记录', icon: 'export', group: '对话' },
    { cmd: 'remember', hint: '保存/查看记忆', args: '[key: content]', icon: 'config', group: '对话' },
    { cmd: 'config', hint: '打开配置面板', icon: 'config', group: '系统' },
    { cmd: 'logout', hint: '退出登录', icon: 'logout', group: '系统' },
    { cmd: 'help', hint: '显示所有命令', icon: 'help', group: '帮助' }
];

window._slashIdx = -1;
window._slashVisible = false;

function handleSlashInput(el) {
    var val = el.value;
    if (!val.startsWith('/')) { hideSlashPopup(); return; }
    var query = val.slice(1);
    if (query.includes(' ')) { hideSlashPopup(); return; }
    updateSlashPopup(query.toLowerCase());
}

function updateSlashPopup(query) {
    var popup = getEl('slashPopup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'slashPopup';
        popup.className = 'slash-popup';
        popup.style.opacity = '0';
        popup.style.transform = 'translateY(8px)';
        var wrap = document.getElementById('userInput')?.closest('.input-wrapper') || document.querySelector('.input-wrapper');
        if (wrap) wrap.appendChild(popup);
        else document.body.appendChild(popup);
    }
    var matches = SLASH_COMMANDS.filter(function(c) { return !query || c.cmd.indexOf(query) >= 0 || c.hint.indexOf(query) >= 0; });
    if (matches.length === 0) { hideSlashPopup(); return; }
    var groups = {};
    matches.forEach(function(m) { if (!groups[m.group]) groups[m.group] = []; groups[m.group].push(m); });
    var html = '';
    var idx = 0;
    Object.keys(groups).forEach(function(g) {
        html += '<div class=slash-popup-group>' + escapeHtml(g) + '</div>';
        groups[g].forEach(function(m) {
            var iconSvg = m.icon ? '<svg class="slash-item-icon-svg"><use href="#cmd-icon-' + m.icon + '"/></svg>' : '';
            var argTag = m.args ? '<span class=slash-item-args>' + m.args + '</span>' : '';
            var disabledClass = m._disabled ? ' slash-item-disabled' : '';
            html += '<div class="slash-popup-item' + (idx === 0 ? ' slash-item-highlight' : '') + disabledClass + '" data-cmd="' + escapeHtml(m.cmd) + '" data-args="' + escapeHtml(m.args||'') + '"' + (m._disabled ? ' style="pointer-events:none;opacity:0.4"' : '') + '>' +
                iconSvg +
                '<span class=slash-item-cmd>/' + m.cmd + '</span>' + argTag +
                '<span class=slash-item-hint>' + (m._disabled ? '(Agent模式可用) ' : '') + m.hint + '</span>' +
            '</div>';
            idx++;
        });
    });
    html += '<div class=slash-popup-footer>↑↓ 选择 · Enter 确认 · Esc 关闭</div>';
    popup.innerHTML = html;
    window._slashIdx = 0;
    window._slashVisible = true;
    popup.style.pointerEvents = 'auto';
    popup.querySelectorAll('.slash-popup-item').forEach(function(item) {
        var _touchStartY = 0;
        item.addEventListener('click', function() { selectSlashCommand(this.dataset.cmd, this.dataset.args); });
        item.addEventListener('touchstart', function(e) { _touchStartY = e.touches[0].clientY; });
        item.addEventListener('touchend', function(e) {
            var _dy = Math.abs(e.changedTouches[0].clientY - _touchStartY);
            // ★ 仅当滑动距离<8px时视为点击,否则是滚动
            if (_dy < 8) {
                e.preventDefault();
                selectSlashCommand(this.dataset.cmd, this.dataset.args);
            }
        });
    });
    requestAnimationFrame(function() {
        popup.style.opacity = '1';
        popup.style.transform = 'translateY(0)';
    });
}

function navigateSlashPopup(dir) {
    var popup = getEl('slashPopup');
    if (!popup || !window._slashVisible) return;
    var items = popup.querySelectorAll('.slash-popup-item');
    if (items.length === 0) return;
    var cur = popup.querySelector('.slash-item-highlight');
    if (cur) cur.classList.remove('slash-item-highlight');
    window._slashIdx = (window._slashIdx + dir + items.length) % items.length;
    var target = items[window._slashIdx];
    target.classList.add('slash-item-highlight');
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function selectSlashCommand(cmd, args) {
    var input = $.userInput;
    if (!input) return;
    if (args) {
        input.value = '/' + cmd + ' ';
        input.setSelectionRange(input.value.length, input.value.length);
    } else {
        input.value = '/' + cmd + ' ';
        input.dispatchEvent(new Event('input', {bubbles:true}));
        sendMessage();
        input.value = '';
        return;
    }
    hideSlashPopup();
    window.autoResize(input);
    input.focus();
}

function hideSlashPopup() {
    var popup = getEl('slashPopup');
    if (popup) {
        window._slashVisible = false;
        popup.style.opacity = '0';
        popup.style.transform = 'translateY(8px)';
        popup.style.pointerEvents = 'none';
    }
}

// 自动滚动到底部(用于AI回复等场景)

// 自动滚动到底部(用于AI回复等场景)
function autoScrollToBottom(reason) {
    if (!$.chatBox) return;
    // 如果用户已经主动滚动离开底部,不要强制拉回(streaming 时由外部控制)
    // 只有明显在底部时才滚动
    const { scrollTop, scrollHeight, clientHeight } = $.chatBox;
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    // 距离底部超过一屏就不跟随了(用户在看上面的内容)
    // 但如果用户没有手动滚动(streaming),强制跟随
    if (distFromBottom > clientHeight * 1.5 && reason !== 'loadChat') {
        if (reason !== 'streaming' || userScrolled) return;
    }
    isAutoScrolling = true;
    // 流式期间加锁,防止短暂滚动触发 userScrolled 导致中断
    if (reason === 'streaming') streamingScrollLock = true;
    // 大幅滚动用 smooth,正常小增长用 instant(避免抖动)
    if (distFromBottom > 200) {
        $.chatBox.scrollTo({ top: $.chatBox.scrollHeight, behavior: 'smooth' });
    } else {
        $.chatBox.scrollTop = $.chatBox.scrollHeight;
    }
    // streaming 时不清除锁定,等待流结束统一释放
    if (reason !== 'streaming') {
        isAutoScrolling = false;
        streamingScrollLock = false;
    } else {
        setTimeout(() => { isAutoScrolling = false; }, 300);
    }
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
    // ★ Agent 模式: 禁止展开侧边栏
    if (isAgentToolsActive()) {
        showToast('Agent 模式下侧边栏已折叠', 'info', 2000);
        return;
    }
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
        // Close SRC panel when opening config panel
        if (isOpening) {
            var sp = document.getElementById("srcPanel");
            if (sp && !sp.classList.contains("hidden-panel")) {
                sp.classList.add("hidden-panel");
            }
        }
        $.configPanel?.classList.toggle('hidden-panel');
        document.querySelector(".flex-1.flex-col")?.classList.toggle("config-open", isOpening);
        // 打开时保存配置快照,关闭时清除
        if (isOpening) {
            configSnapshot = snapshotConfig();
            configPanelWasOpen = true;
            // ★ 加载工具开关状态、自定义技能列表、记忆系统
            if (window.loadToolToggleStates) window.loadToolToggleStates();
            if (window.renderCustomSkillsList) window.renderCustomSkillsList();
            if (window.refreshMemoryList) window.refreshMemoryList();
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

// 切换图像提供商(MiniMax / OpenRouter)时更新字段:可见性、密钥、提示
function toggleImageProviderFields() {
    var provider = getVal('imageProvider') || 'minimax';
    var keyInput = getEl('imageApiKey');       // MiniMax Key 输入框
    var urlInput = getEl('imageBaseUrl');       // MiniMax URL 输入框
    var orKeyInput = getEl('imageApiKeyOpenrouter');  // OpenRouter Key 输入框
    var orUrlInput = getEl('imageBaseUrlOpenrouter'); // OpenRouter URL 输入框
    var modelInput = getEl('imageModel');
    var hintEl = getEl('imageProviderHint');

    // 切换前保存当前值到对应提供商的 localStorage 键
    if (window._lastImageProvider && window._lastImageProvider !== provider) {
        var _prevFinal = window._lastImageProvider;
        if (_prevFinal === 'minimax') {
            localStorage.setItem('imageApiKey', encrypt(getVal('imageApiKey') || ''));
            localStorage.setItem('imageBaseUrl', getVal('imageBaseUrl') || '');
        } else {
            localStorage.setItem('imageApiKeyOpenrouter', encrypt(getVal('imageApiKeyOpenrouter') || ''));
            localStorage.setItem('imageBaseUrlOpenrouter', getVal('imageBaseUrlOpenrouter') || '');
        }
    }
    window._lastImageProvider = provider;

    // 切换字段可见性
    var _miniFields = ['imageKeyField', 'imageUrlField'];
    var _orFields = ['orKeyField', 'orUrlField'];
    _miniFields.forEach(function(id) {
        var el = getEl(id); if (el) el.style.display = provider === 'minimax' ? '' : 'none';
    });
    _orFields.forEach(function(id) {
        var el = getEl(id); if (el) el.style.display = provider === 'openrouter' ? '' : 'none';
    });

    if (provider === 'openrouter') {
        // 从 localStorage 恢复 OpenRouter 密钥
        var _storedOrKeyFinal = decrypt(localStorage.getItem('imageApiKeyOpenrouter') || '') || '';
        var _storedOrUrlFinal = localStorage.getItem('imageBaseUrlOpenrouter') || 'https://openrouter.ai/api';
        if (orKeyInput) orKeyInput.value = _storedOrKeyFinal !== 'not-needed' ? _storedOrKeyFinal : '';
        if (orUrlInput) orUrlInput.value = _storedOrUrlFinal;
        if (modelInput) {
            modelInput.placeholder = 'openai/gpt-5.4-image-2';
            var curModel = modelInput.value;
            if (!curModel || curModel === 'image-01') modelInput.value = 'openai/gpt-5.4-image-2';
        }
        if (hintEl) hintEl.textContent = 'OpenRouter: 使用 GPT Image 2。使用独立的 API Key,不影响频道聊天用的主 API Key。';
    } else {
        // 从 localStorage 恢复 MiniMax 密钥
        var _storedMxKeyFinal = decrypt(localStorage.getItem('imageApiKey') || '') || '';
        var _storedMxUrlFinal = localStorage.getItem('imageBaseUrl') || 'https://api.minimaxi.com';
        if (keyInput) keyInput.value = _storedMxKeyFinal !== 'not-needed' ? _storedMxKeyFinal : '';
        if (urlInput) urlInput.value = _storedMxUrlFinal;
        if (modelInput) {
            modelInput.placeholder = 'image-01';
            var curModel = modelInput.value;
            if (!curModel || curModel === 'openai/gpt-5.4-image-2') modelInput.value = 'image-01';
        }
        if (hintEl) hintEl.textContent = 'MiniMax: 使用 image-01 模型,写实风格。使用独立 API Key,不影响主 API Key。';
    }

    // ★ 仅在用户切换提供商时保存(页面初始化时不触发saveConfig,避免覆盖服务器配置)
    if (window._isUserChangingProvider) {
        saveConfig();
        window._isUserChangingProvider = false;
    }
}

// ===== 视觉理解提供商切换 =====
window.onVisionProviderChange = function() {
    var provider = getEl('visionProvider')?.value || 'minimax';
    var keyInput = getEl('visionApiKey');
    var urlInput = getEl('visionApiUrl');
    var oaKeyInput = getEl('visionApiKeyOpenAI');
    var oaUrlInput = getEl('visionApiUrlOpenAI');
    var modelInput = getEl('visionModel');
    var hintEl = getEl('visionProviderHint');
    
    // 切换前保存当前值到对应提供商的 localStorage
    if (window._lastVisionProvider && window._lastVisionProvider !== provider) {
        if (window._lastVisionProvider === 'minimax') {
            localStorage.setItem('visionApiKey', encrypt(getVal('visionApiKey') || ''));
            localStorage.setItem('visionApiUrl', getVal('visionApiUrl') || '');
        } else if (window._lastVisionProvider === 'openai') {
            localStorage.setItem('visionApiKeyOpenAI', encrypt(getVal('visionApiKeyOpenAI') || ''));
            localStorage.setItem('visionApiUrlOpenAI', getVal('visionApiUrlOpenAI') || '');
        }
    }
    window._lastVisionProvider = provider;
    localStorage.setItem('visionProvider', provider);
    
    // 切换字段可见性
    var fields = { minimax: ['visionKeyField', 'visionUrlField'], openai: ['visionOAKeyField', 'visionOAUrlField'] };
    Object.keys(fields).forEach(function(k) {
        fields[k].forEach(function(id) {
            var el = getEl(id); if (el) el.style.display = k === provider ? '' : 'none';
        });
    });
    
    // 恢复对应提供商的配置值
    if (provider === 'openai') {
        var _storedKey = decrypt(localStorage.getItem('visionApiKeyOpenAI') || '') || '';
        var _storedUrl = localStorage.getItem('visionApiUrlOpenAI') || 'https://api.openai.com/v1';
        if (oaKeyInput) oaKeyInput.value = _storedKey;
        if (oaUrlInput) oaUrlInput.value = _storedUrl;
        if (modelInput) modelInput.value = 'gpt-4o';
        if (hintEl) hintEl.textContent = 'OpenAI: 使用 GPT-4o 等视觉模型。使用独立的 API Key。';
    } else if (provider === 'minimax') {
        var _storedKey = decrypt(localStorage.getItem('visionApiKey') || '') || '';
        var _storedUrl = localStorage.getItem('visionApiUrl') || 'https://api.minimaxi.com/v1/coding_plan/vlm';
        if (keyInput) keyInput.value = _storedKey;
        if (urlInput) urlInput.value = _storedUrl;
        if (modelInput) modelInput.value = 'MiniMax-VL-01';
        if (hintEl) hintEl.textContent = 'MiniMax: 使用 coding-plan-vlm 端点的视觉理解能力。';
    } else {
        // 自定义
        if (hintEl) hintEl.textContent = '自定义: 设置自己的 API 地址和模型。';
    }
    window.saveConfig();
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
    // 已迁移至 HTML 静态渲染
}

function createSearchConfigSection() {
    if (getEl('searchConfigItem')) return;
    // 已迁移至 HTML 静态渲染
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
    // ★ 搜索引擎切换: 参照主模型 onProviderChange,自动切换对应 Key
    getEl('searchProvider')?.addEventListener('change', onSearchProviderChange);
    ['aiSearchJudgeModel', 'aiSearchJudgePrompt', 'searchRegion', 'searchTimeout', 'maxSearchResults', 'searchType', 'aiSearchTypeToggle', 'searchShowPromptToggle', 'searchAppendToSystem', 'searchToolCallToggle'].forEach(id => {
        const el = getEl(id);
        if (el) {
            el.addEventListener('change', function() { saveConfig(); });
        }
    });
    // ★ 搜索 API Key 变更时自动保存(密码框 input 事件)
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

// ★ 搜索引擎提供商切换 (参照主模型 onProviderChange)
const SEARCH_PROVIDER_KEY_MAP = { brave: 'searchApiKeyBrave', google: 'searchApiKeyGoogle', tavily: 'searchApiKeyTavily', minimax: 'searchApiKeyMiniMax' };

window.onSearchProviderChange = function() {
    var provider = getVal('searchProvider') || 'duckduckgo';
    // 1. 保存当前 Key 到旧引擎
    var curKey = getVal('searchApiKey') || '';
    var oldProvider = localStorage.getItem('searchProvider') || 'duckduckgo';
    if (oldProvider && oldProvider !== provider && curKey) {
        var oldKeyId = SEARCH_PROVIDER_KEY_MAP[oldProvider];
        if (oldKeyId) localStorage.setItem(oldKeyId, encrypt(curKey));
    }
    // 2. 切换到新引擎的 Key (优先独立 Key,其次通用 Key)
    var newKeyId = SEARCH_PROVIDER_KEY_MAP[provider];
    var savedProviderKey = newKeyId ? localStorage.getItem(newKeyId) : null;
    if (newKeyId && savedProviderKey) {
        var dk = decrypt(savedProviderKey);
        setVal('searchApiKey', (dk && dk !== 'not-needed') ? dk : '');
    } else if (provider === 'duckduckgo') {
        // DuckDuckGo 无需 Key,清空
        setVal('searchApiKey', '');
    } else {
        // 没有独立 Key,保留当前值(可能是之前手动输入的通用 Key)
    }
    // 3. 持久化
    localStorage.setItem('searchProvider', provider);
    saveConfig();
};

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
    const providerKey = SEARCH_PROVIDER_KEY_MAP[provider];
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
    // ★ 不自动保存,由"保存配置"按钮统一控制
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


// ★ 工具模式切换(输入框旁快捷按钮)
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
var sessionUsage = { promptTokens: 0, completionTokens: 0, totalCost: 0, prefixCacheHits: 0, toolCalls: 0, approvalsGranted: 0, approvalsRejected: 0, cacheHitTokens: 0, cacheMissTokens: 0 };

// ==================== 增强用量追踪 ====================
/** 按工具分类统计调用次数 */
var toolCallStats = (function() {
  var _stats = {}; // { toolName: { total: n, success: n, error: n, errors: [{msg,time}] } }
  return {
    record: function(toolName, isError, errorMsg) {
      if (!_stats[toolName]) _stats[toolName] = { total: 0, success: 0, error: 0, errors: [] };
      _stats[toolName].total++;
      if (isError) {
        _stats[toolName].error++;
        if (errorMsg) _stats[toolName].errors.push({ msg: errorMsg, time: Date.now() });
      } else {
        _stats[toolName].success++;
      }
    },
    get: function(toolName) { var s = _stats[toolName]; return s ? s.total : 0; },
    getAll: function() { return JSON.parse(JSON.stringify(_stats)); },
    reset: function() { _stats = {}; },
    getSummary: function() {
      var total = 0, success = 0, error = 0, failedTools = [];
      Object.keys(_stats).forEach(function(k) {
        total += _stats[k].total;
        success += _stats[k].success;
        error += _stats[k].error;
        if (_stats[k].error > 0) {
          failedTools.push({ name: k, errors: _stats[k].errors.slice(-3) });
        }
      });
      return { total: total, success: success, error: error, failedTools: failedTools };
    }
  };
})();

/** 费用/用量可视化组件 */
var usageVisualizer = {
  /** 渲染费用进度条 */
  costBar: function(maxCost) {
    maxCost = maxCost || 0.1; // 默认0.1刀
    var ratio = Math.min(sessionUsage.totalCost / maxCost, 1);
    var pct = (ratio * 100).toFixed(1);
    return '<div class="usage-bar-container"><div class="usage-bar-label">💰 费用: $' + sessionUsage.totalCost.toFixed(4) + ' / $' + maxCost.toFixed(2) + '</div><div class="usage-bar-track"><div class="usage-bar-fill cost-bar" style="width:' + pct + '%"></div></div></div>';
  },
  /** 渲染 Token 进度条 */
  tokenBar: function(maxTokens) {
    maxTokens = maxTokens || 500000;
    var total = sessionUsage.promptTokens + sessionUsage.completionTokens;
    var ratio = Math.min(total / maxTokens, 1);
    var pct = (ratio * 100).toFixed(1);
    return '<div class="usage-bar-container"><div class="usage-bar-label">🔤 Tokens: ' + total.toLocaleString() + ' / ' + maxTokens.toLocaleString() + '</div><div class="usage-bar-track"><div class="usage-bar-fill token-bar" style="width:' + pct + '%"></div></div></div>';
  },
  /** 缓存命中提示 */
  cacheHint: function() {
    var totalCache = sessionUsage.cacheHitTokens + sessionUsage.cacheMissTokens;
    if (totalCache === 0) return '';
    var rate = (sessionUsage.cacheHitTokens / totalCache * 100).toFixed(1);
    var color = rate > 50 ? '#10b981' : (rate > 20 ? '#f59e0b' : '#ef4444');
    return '<div class="usage-cache-hint" style="color:' + color + '">💾 缓存命中率: ' + rate + '% (' + sessionUsage.cacheHitTokens.toLocaleString() + '/' + totalCache.toLocaleString() + ')</div>';
  },
  /** 工具调用统计 */
  toolStatsDisplay: function() {
    var top = toolCallStats.getTopTools(5);
    if (top.length === 0) return '';
    return '<div class="usage-tool-stats">🔧 常用工具:<br>' + top.map(function(e, i) {
      return '<span class="tool-stat-item">#' + (i+1) + ' ' + e[0] + ' ✕' + e[1] + '</span>';
    }).join(' ') + '</div>';
  },
  /** 完整用量面板 */
  fullDisplay: function() {
    var total = sessionUsage.promptTokens + sessionUsage.completionTokens;
    return '<div class="usage-panel">' +
      this.costBar() +
      this.tokenBar() +
      '<div style="font-size:11px;line-height:1.8;margin-top:4px;">' +
      '📤 输入: ' + sessionUsage.promptTokens.toLocaleString() + ' tokens<br>' +
      '📥 输出: ' + sessionUsage.completionTokens.toLocaleString() + ' tokens<br>' +
      (sessionUsage.prefixCacheHits > 0 ? '💾 缓存命中: ' + sessionUsage.prefixCacheHits.toLocaleString() + ' tokens<br>' : '') +
      this.cacheHint() +
      '🔧 工具调用: ' + sessionUsage.toolCalls + ' 次<br>' +
      '✅ 已批准: ' + sessionUsage.approvalsGranted + ' ❌ 已拒绝: ' + sessionUsage.approvalsRejected +
      '</div>' +
      this.toolStatsDisplay() +
      '</div>';
  }
};

// ==================== 三模式系统 (Plan / Agent / YOLO) ====================

/** 获取当前 Agent 模式: 'off' | 'plan' | 'agent' | 'yolo' */
function getAgentMode() {
    var val = localStorage.getItem('agentMode');
    // 从旧版布尔格式迁移
    if (val === 'true') { localStorage.setItem('agentMode', 'agent'); return 'agent'; }
    if (val === 'false' || val === null || val === undefined) { localStorage.setItem('agentMode', 'off'); return 'off'; }
    if (['off','plan','agent','yolo'].indexOf(val) === -1) { localStorage.setItem('agentMode', 'off'); return 'off'; }
    return val;
}

/** 设置 Agent 模式并更新 UI */
function setAgentMode(mode) {
    if (['off','plan','agent','yolo'].indexOf(mode) === -1) mode = 'off';
    var prevMode = getAgentMode();
    
    // ★ 同模式再次点击 = 退出到 off
    if (mode !== 'off' && mode === prevMode) {
        mode = 'off';
    }

    // ★ 动画互斥锁: 如果有动画正在播放,立即清除
    if (window._agentAnimLock) {
        _clearAllAgentOverlays();
        clearTimeout(window._agentAnimLock);
    }

    localStorage.setItem('agentMode', mode);

    // ★ 整页转场动效(先判断目标模式,再判断来源模式)
    if (mode === 'agent' || mode === 'yolo') {
        playAgentEnterEffect(mode);
        window._agentAnimLock = setTimeout(function() { window._agentAnimLock = null; }, 950);
    } else if (mode === 'plan') {
        // ★ Plan: 蓝色进入特效
        playAgentEnterEffect('plan');
        window._agentAnimLock = setTimeout(function() { window._agentAnimLock = null; }, 700);
    } else if (mode === 'off' && (prevMode === 'agent' || prevMode === 'yolo' || prevMode === 'plan')) {
        // ★ 切回 off: 退出特效(仅当从非 off 模式切换时)
        playAgentExitEffect(prevMode);
        window._agentAnimLock = setTimeout(function() { window._agentAnimLock = null; }, 700);
    }

    updateAgentUI();
    if (mode === 'agent' || mode === 'yolo') {
        // Agent/YOLO 模式开启时自动启用 Agent 专属工具
        var _agentKeys = ['SERVER_EXEC_TOOL','SERVER_PYTHON_TOOL','SERVER_FILE_READ_TOOL','SERVER_FILE_WRITE_TOOL','SERVER_FILE_OP_TOOL','SERVER_FILE_SEARCH_TOOL','SERVER_DOCKER_TOOL','SERVER_DB_QUERY_TOOL','SERVER_SYS_INFO_TOOL','SERVER_PS_TOOL','SERVER_DISK_TOOL','SERVER_NETWORK_TOOL','ENGINE_CRON_LIST_TOOL','ENGINE_CRON_CREATE_TOOL','ENGINE_CRON_DELETE_TOOL','DELEGATE_TASK_TOOL','ENGINE_AGENT_STATUS_TOOL','ENGINE_AGENT_LIST_TOOL','ENGINE_AGENT_DELETE_TOOL','ENGINE_PUSH_TOOL','BROWSER_NAVIGATE_TOOL','BROWSER_SCREENSHOT_TOOL','BROWSER_CLICK_TOOL','BROWSER_TYPE_TOOL','BROWSER_GET_CONTENT_TOOL','BROWSER_GET_SNAPSHOT_TOOL'];
        _agentKeys.forEach(function(k) { window.setToolEnabled(k, true); });

        // ★ Agent 模式: 自动收起左侧栏, 切换到新 agent 聊天
        var wasCollapsed = $.sidebar?.classList.contains('collapsed');
        if (!wasCollapsed) {
            $.sidebar?.classList.add('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'block';
        }
        // 保存当前普通聊天 ID
        if (currentChatId && currentChatId !== '_agent_main') {
            lastNormalChatId = currentChatId;
            localStorage.setItem('lastNormalChatId', lastNormalChatId);
        }
        // ★ 始终复用同一个主代理聊天,不复用旧的随机ID
        var agentId = '_agent_main';
        if (!chats[agentId]) {
            createAgentChat().then(function() {
                loadChat(agentId);
            });
        } else {
            loadChat(agentId);
        }
    } else if (mode === 'off') {
        // ★ 普通模式: 关闭所有 Agent 专属工具
        var _agentKeys = ['SERVER_EXEC_TOOL','SERVER_PYTHON_TOOL','SERVER_FILE_READ_TOOL','SERVER_FILE_WRITE_TOOL','SERVER_FILE_OP_TOOL','SERVER_FILE_SEARCH_TOOL','SERVER_DOCKER_TOOL','SERVER_DB_QUERY_TOOL','SERVER_SYS_INFO_TOOL','SERVER_PS_TOOL','SERVER_DISK_TOOL','SERVER_NETWORK_TOOL','ENGINE_CRON_LIST_TOOL','ENGINE_CRON_CREATE_TOOL','ENGINE_CRON_DELETE_TOOL','DELEGATE_TASK_TOOL','ENGINE_AGENT_STATUS_TOOL','ENGINE_AGENT_LIST_TOOL','ENGINE_AGENT_DELETE_TOOL','ENGINE_PUSH_TOOL','BROWSER_NAVIGATE_TOOL','BROWSER_SCREENSHOT_TOOL','BROWSER_CLICK_TOOL','BROWSER_TYPE_TOOL','BROWSER_GET_CONTENT_TOOL','BROWSER_GET_SNAPSHOT_TOOL'];
        _agentKeys.forEach(function(k) { window.setToolEnabled(k, false); });
        // 恢复侧边栏
        var wasCollapsed = $.sidebar?.classList.contains('collapsed');
        if (wasCollapsed) {
            $.sidebar?.classList.remove('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
        }
        // 切换到 agent 聊天时切回普通模式,恢复上次普通聊天
        if (currentChatId && currentChatId === '_agent_main') {
            var restoreId = lastNormalChatId || Object.keys(chats).filter(function(id) { return id !== '_agent_main'; }).sort(function(a,b) { return (chats[b].updated_at||0) - (chats[a].updated_at||0); })[0];
            if (restoreId && chats[restoreId]) {
                loadChat(restoreId);
            }
        }
    }
    // plan 模式: 不碰侧边栏和聊天切换, 消息注入普通聊天
    if (mode === 'plan') {
        var _agentKeys2 = ['SERVER_EXEC_TOOL','SERVER_PYTHON_TOOL','SERVER_FILE_READ_TOOL','SERVER_FILE_WRITE_TOOL','SERVER_FILE_OP_TOOL','SERVER_FILE_SEARCH_TOOL','SERVER_DOCKER_TOOL','SERVER_DB_QUERY_TOOL','SERVER_SYS_INFO_TOOL','SERVER_PS_TOOL','SERVER_DISK_TOOL','SERVER_NETWORK_TOOL','ENGINE_CRON_LIST_TOOL','ENGINE_CRON_CREATE_TOOL','ENGINE_CRON_DELETE_TOOL','DELEGATE_TASK_TOOL','ENGINE_AGENT_STATUS_TOOL','ENGINE_AGENT_LIST_TOOL','ENGINE_AGENT_DELETE_TOOL','ENGINE_PUSH_TOOL','BROWSER_NAVIGATE_TOOL','BROWSER_SCREENSHOT_TOOL','BROWSER_CLICK_TOOL','BROWSER_TYPE_TOOL','BROWSER_GET_CONTENT_TOOL','BROWSER_GET_SNAPSHOT_TOOL'];
        _agentKeys2.forEach(function(k) { window.setToolEnabled(k, false); });
    }
    // 模式切换不弹 toast(已有横幅和绿点提示)
    if (typeof renderToolPanel === 'function') renderToolPanel();
}

/** 循环切换模式: off → plan → agent → yolo → off */
function cycleAgentMode() {
    var modes = ['off', 'plan', 'agent', 'yolo'];
    var current = getAgentMode();
    var idx = modes.indexOf(current);
    if (idx === -1 || idx >= modes.length - 1) idx = 0;
    else idx++;
    setAgentMode(modes[idx]);
}

/** 判断 Agent 工具是否激活 (agent 或 yolo 模式) */
function isAgentToolsActive() {
    var mode = getAgentMode();
    return mode === 'agent' || mode === 'yolo';
}

/** 判断是否审批模式 (plan 或 agent 模式) */
function isApprovalMode() {
    var mode = getAgentMode();
    return mode === 'plan' || mode === 'agent';
}

/** 判断是否 YOLO 自动批准模式 */
function isYoloMode() {
    return getAgentMode() === 'yolo';
}

/** 判断是否 Plan 只读模式 */
function isPlanMode() {
    return getAgentMode() === 'plan';
}

// ★ Agent 模式整页转场动效
// overlay 管理:防止快速切换时动画叠加
var _agentOverlayMap = {}; // mode -> { el, timer }

function _clearAgentOverlay(mode) {
    var entry = _agentOverlayMap[mode];
    if (!entry) return;
    clearTimeout(entry.timer);
    if (entry.el && entry.el.parentNode) {
        entry.el.remove();
    }
    delete _agentOverlayMap[mode];
}

function _clearAllAgentOverlays() {
    Object.keys(_agentOverlayMap).forEach(function(m) { _clearAgentOverlay(m); });
    // 清除所有遗留的 agent-transition-overlay(兜底)
    document.querySelectorAll('.agent-transition-overlay').forEach(function(el) { el.remove(); });
}

function playAgentEnterEffect(mode) {
    _clearAllAgentOverlays();
    var isPlan = mode === 'plan';
    var isYolo = mode === 'yolo';
    var c1 = isYolo ? [239,68,68] : isPlan ? [59,130,246] : [99,102,241];
    var c2 = isYolo ? [245,158,11] : isPlan ? [96,165,250] : [168,85,247];
    var glow = 'rgba(' + c1.join(',') + ',';
    var glow2 = 'rgba(' + c2.join(',') + ',';
    var titleGrad = isYolo ? '#ef4444,#f97316,#eab308' : isPlan ? '#3b82f6,#60a5fa,#93c5fd' : '#6366f1,#a855f7,#ec4899';
    var titleWord = isYolo ? 'YOLO' : isPlan ? 'PLAN' : 'AGENT';
    var subtitle = isYolo ? 'AUTONOMOUS' : isPlan ? 'READ-ONLY' : 'ENHANCED';
    var hexStroke = 'rgba(' + c1.join(',') + ',0.12)';

    // 预载艺术字
    if (!document.getElementById('agent-font-link')) {
        var fl = document.createElement('link');
        fl.id = 'agent-font-link';
        fl.rel = 'stylesheet';
        fl.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800;900&display=swap';
        document.head.appendChild(fl);
    }
    var overlay = document.createElement('div');
    overlay.className = 'agent-transition-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;pointer-events:none;';
    overlay.innerHTML = '' +
        // 1. 背景模糊(跟随模式颜色)
        '<div style="position:absolute;inset:0;backdrop-filter:blur(12px) saturate(100%);-webkit-backdrop-filter:blur(12px) saturate(100%);background:' + (isYolo ? 'rgba(254,242,242,0.22)' : isPlan ? 'rgba(239,246,255,0.22)' : 'rgba(238,242,255,0.22)') + ';opacity:0;animation:agent-mask-in 0.25s ease forwards;will-change:opacity;transform:translateZ(0);"></div>' +
        // 2. 六边形网格(加速)
        '<div style="position:absolute;inset:0;opacity:0;background-image:url(\'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="52"><path d="M30 0L60 15v22L30 52 0 37V15z" fill="none" stroke="' + hexStroke + '" stroke-width="1"/></svg>') + '\');background-size:60px 52px;animation:agent-hex-in 0.6s 0.08s ease forwards;will-change:transform;"></div>' +
        // 3. 多层光环(加速)
        '<div style="position:absolute;top:50%;left:50%;width:0;height:0;border-radius:50%;box-shadow:0 0 0 0 ' + glow + '0.3),0 0 0 0 ' + glow + '0.1);animation:agent-pulse-rings 0.6s cubic-bezier(0.16,1,0.3,1) forwards;will-change:transform;"></div>' +
        // 4. 光线(减少数量+加速)
        '<div style="position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;">' +
            Array.from({length: 3}, function(_, i) {
                return '<div style="position:absolute;top:' + (15 + i*30) + '%;left:-100%;width:200%;height:1px;background:linear-gradient(90deg,transparent,' + glow + '0.3),' + glow2 + '0.15),transparent);animation:agent-line-' + (i%2===0?'right':'left') + ' 0.4s ' + (0.05+i*0.04) + 's ease forwards;"></div>';
            }).join('') +
        '</div>' +
        // 5. 中心文字(缩小+去内层模糊)
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;pointer-events:none;">' +
            '<div style="opacity:0;animation:agent-mask-in 0.3s 0.08s ease forwards;will-change:opacity;">' +
                '<div style="font-family:\'Orbitron\',\'Inter\',system-ui,sans-serif;font-size:64px;font-weight:900;letter-spacing:4px;line-height:1;text-align:center;opacity:0;animation:agent-title-in 0.5s 0.1s cubic-bezier(0.16,1,0.3,1) forwards;">' +
                    titleWord.split('').map(function(letter, i) {
                        var grad = 'background:linear-gradient(135deg,' + titleGrad + ');-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;';
                        var shadow = 'filter:drop-shadow(0 0 ' + (12+i*2) + 'px ' + glow + '0.3));';
                        return '<span style="' + grad + shadow + '">' + letter + '</span>';
                    }).join('') +
                '</div>' +
                '<div style="font-family:\'Orbitron\',\'Inter\',system-ui,sans-serif;font-size:14px;font-weight:600;letter-spacing:12px;color:' + glow2 + '0.35);opacity:0;animation:agent-subtitle-in 0.4s 0.2s ease forwards;margin-top:8px;text-align:center;width:100%;">' + subtitle + '</div>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);
    var enterTimer = setTimeout(function() { overlay.style.opacity = '0'; overlay.style.transition = 'opacity 0.25s ease'; var fadeTimer = setTimeout(function() { overlay.remove(); delete _agentOverlayMap[mode]; }, 250); _agentOverlayMap[mode] = { el: overlay, timer: fadeTimer }; }, 900);
    _agentOverlayMap[mode] = { el: overlay, timer: enterTimer };
}

function playAgentExitEffect(mode) {
    _clearAgentOverlay('exit:' + mode);
    // ★ 退出: 暗色淡出,柔和醒目
    var exitWord = 'OFF';

    var overlay = document.createElement('div');
    overlay.className = 'agent-transition-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;pointer-events:none;';
    overlay.innerHTML = '' +
        '<div style="position:absolute;inset:0;backdrop-filter:blur(6px) brightness(0.85);-webkit-backdrop-filter:blur(6px) brightness(0.85);background:rgba(0,0,0,0.15);animation:agent-exit-mask 0.5s ease forwards;will-change:opacity;transform:translateZ(0);"></div>' +
        '<div style="position:absolute;top:50%;left:50%;width:250vw;height:250vw;border-radius:50%;border:2px solid rgba(255,255,255,0.1);transform:translate(-50%,-50%);animation:agent-ring-collapse 0.5s cubic-bezier(0.5,0,0.8,0.4) forwards;"></div>' +
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">' +
            '<div style="font-family:system-ui,sans-serif;font-size:42px;font-weight:600;letter-spacing:5px;color:rgba(255,255,255,0.7);opacity:0;animation:agent-exit-text 0.5s ease forwards;">' + exitWord + '</div>' +
        '</div>';
    document.body.appendChild(overlay);
    var exitKey = 'exit:' + mode;
    var exitTimer = setTimeout(function() { overlay.style.opacity = '0'; overlay.style.transition = 'opacity 0.2s'; var fadeTimer = setTimeout(function() { overlay.remove(); delete _agentOverlayMap[exitKey]; }, 200); _agentOverlayMap[exitKey] = { el: overlay, timer: fadeTimer }; }, 650);
    _agentOverlayMap[exitKey] = { el: overlay, timer: exitTimer };
}

// 兼容旧版 toggleAgentMode
window.toggleAgentMode = function() {
    var curMode = getAgentMode();
    // 只切换 on/off:off → agent, agent/plan/yolo → off
    var newMode = (curMode === 'off' || !curMode) ? 'agent' : 'off';
    setAgentMode(newMode);
};

/**
 * 创建主代理聊天 (始终复用 _agent_main,不新建)
 * @returns {Promise}
 */
function createAgentChat() {
    return new Promise(function(resolve) {
        var uid = localStorage.getItem('authUserId') || '';
        var agentSys = localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt;
        var agentId = '_agent_main';
        chats[agentId] = {
            title: 'Agent',
            userId: uid,
            updated_at: Date.now(),
            messages: [
                { role: 'system', content: agentSys || 'You are an AI assistant in Agent mode.' }
            ]
        };
        resolve();
    });
}

// ==================== 代理面板控制 ====================
// ==================== Agent 记忆/人格/身份/心跳 系统 ====================

/** 获取引擎 API 基础 URL */
function _agentEngineUrl() {
    return window.location.origin + '/oneapichat/';
}

/** 获取当前 auth token */
function _agentGetAuthToken() {
    try { return localStorage.getItem('authToken') || ''; } catch(e) { return ''; }
}

/** 向引擎发送 POST 请求 */
async function _agentApiPost(action, data) {
    var token = _agentGetAuthToken();
    var url = _agentEngineUrl() + 'engine_api.php?action=' + action;
    if (token) url += '&auth_token=' + encodeURIComponent(token);
    try {
        var resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await resp.json();
    } catch(e) {
        console.warn('[AgentMemory] POST ' + action + ' failed:', e);
        return { ok: false };
    }
}

/** 向引擎发送 GET 请求 */
async function _agentApiGet(action, params) {
    var token = _agentGetAuthToken();
    var url = _agentEngineUrl() + 'engine_api.php?action=' + action;
    if (params) {
        for (var k in params) {
            url += '&' + k + '=' + encodeURIComponent(params[k]);
        }
    }
    if (token) url += '&auth_token=' + encodeURIComponent(token);
    try {
        var resp = await fetch(url);
        return await resp.json();
    } catch(e) {
        console.warn('[AgentMemory] GET ' + action + ' failed:', e);
        return { ok: false };
    }
}

// ── 人格 ──────────────────────────────────────────

/** 保存 Agent 人格 */
window.saveAgentPersona = async function(persona) {
    if (!persona || typeof persona !== 'object') return { ok: false };
    return await _agentApiPost('agent_persona_save', persona);
};

/** 加载 Agent 人格 */
window.loadAgentPersona = async function() {
    return await _agentApiGet('agent_persona_load');
};

// ── 记忆 ──────────────────────────────────────────

/** 保存一条记忆 */
window.saveAgentMemory = async function(key, content, tags) {
    if (!key || !content) return { ok: false };
    return await _agentApiPost('agent_memory_save', { key: key, content: content, tags: tags || [] });
};

/** 加载记忆(支持关键词搜索) */
window.loadAgentMemory = async function(query) {
    var params = {};
    if (query) params.query = query;
    return await _agentApiGet('agent_memory_load', params);
};

/** 删除记忆 */
window.deleteAgentMemory = async function(key) {
    return await _agentApiGet('agent_memory_delete', { key: key });
};

// ── 用户身份 ──────────────────────────────────────

/** 保存用户身份 */
window.saveAgentIdentity = async function(identity) {
    if (!identity || typeof identity !== 'object') return { ok: false };
    return await _agentApiPost('agent_identity_save', identity);
};

/** 加载用户身份 */
window.loadAgentIdentity = async function() {
    return await _agentApiGet('agent_identity_load');
};

// ── 心跳 ──────────────────────────────────────────

/** 更新 Agent 心跳 */
window.agentHeartbeat = async function(state, mood, chatId) {
    var data = { state: state || 'active', mood: mood || 'neutral' };
    if (chatId) data.chat_id = chatId;
    return await _agentApiPost('agent_heartbeat', data);
};

/** 读取心跳状态 */
window.agentHeartbeatStatus = async function() {
    return await _agentApiGet('agent_heartbeat_status');
};

// ── System Prompt 注入 ────────────────────────────

// ── 云端记忆/身份加载 (memory_api.php) ─────────────

/** 从 memory_api.php 加载用户记忆缓存 */
window._loadCloudMemories = async function() {
    var token = localStorage.getItem('authToken');
    if (!token) return null;
    try {
        var resp = await fetch('/oneapichat/memory_api.php?action=smart_context&limit=15&token=' + encodeURIComponent(token));
        var data = await resp.json();
        if (data && data.context) {
            window.__cloudMemories = data.context;
            window.__cloudMemoryCount = data.total || 0;
            return data;
        }
    } catch(e) {}
    window.__cloudMemories = '';
    return null;
};

/** 从 memory_api.php 加载身份信息 (与SOUL/USER/IDENTITY对应) */
window._loadCloudIdentity = async function() {
    var token = localStorage.getItem('authToken');
    if (!token) return null;
    try {
        var resp = await fetch('/oneapichat/memory_api.php?action=search_memories&q=身份&token=' + encodeURIComponent(token));
        var data = await resp.json();
        if (data && data.memories) {
            // 查找 identity_ 前缀的记忆
            var identity = {};
            var persona = {};
            var user = {};
            data.memories.forEach(function(m) {
                if (m.key === 'identity_ai_name') identity.name = m.content;
                else if (m.key === 'identity_ai_style') identity.style = m.content;
                else if (m.key === 'identity_ai_emoji') identity.emoji = m.content;
                else if (m.key === 'identity_user_name') user.name = m.content;
                else if (m.key === 'identity_user_notes') user.notes = m.content;
                else if (m.key === 'persona_name') persona.name = m.content;
                else if (m.key === 'persona_style') persona.style = m.content;
            });
            window.__cloudPersona = Object.keys(persona).length > 0 ? persona : null;
            window.__cloudIdentity = Object.keys(identity).length > 0 ? identity : null;
            window.__cloudUser = Object.keys(user).length > 0 ? user : null;
        }
    } catch(e) {}
};

// ── 记忆管理 UI ─────────────────────────────────

window.refreshMemoryList = async function() {
    var token = localStorage.getItem('authToken');
    var listEl = document.getElementById('memoryList');
    if (!listEl || !token) return;
    try {
        var resp = await fetch('/oneapichat/memory_api.php?action=get_memories&token=' + encodeURIComponent(token));
        var data = await resp.json();
        var memories = data.memories || [];
        if (memories.length === 0) {
            listEl.innerHTML = '<div style="font-size:11px;color:#9ca3af;text-align:center;padding:12px;">暂无记忆</div>';
        } else {
            listEl.innerHTML = memories.map(function(m) {
                var k = escapeHtml(m.key || '');
                var c = escapeHtml((m.content || '').substring(0, 60));
                return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;font-size:11px;border-bottom:1px solid #f3f4f6;" class="dark:border-gray-700">' +
                    '<span><b>' + k + '</b>: ' + c + '</span>' +
                    '<button onclick="window.deleteMemoryEntry(\'' + k.replace(/'/g, "\\'") + '\')" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:11px;">✕</button>' +
                '</div>';
            }).join('');
        }
    } catch(e) {
        listEl.innerHTML = '<div style="font-size:11px;color:#ef4444;text-align:center;padding:12px;">加载失败</div>';
    }
    window._loadCloudMemories();
    window._loadCloudIdentity();
};

window.addMemoryEntry = async function() {
    var keyEl = document.getElementById('memoryKeyInput');
    var contentEl = document.getElementById('memoryContentInput');
    var key = (keyEl?.value || '').trim();
    var content = (contentEl?.value || '').trim();
    if (!key || !content) { showToast('请输入键和内容', 'warning'); return; }
    var token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        var resp = await fetch('/oneapichat/memory_api.php?action=save_memory&token=' + encodeURIComponent(token), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key, content: content })
        });
        var data = await resp.json();
        if (data.success) {
            keyEl.value = ''; contentEl.value = '';
            showToast('记忆已保存', 'success');
            window.refreshMemoryList();
        } else {
            showToast(data.error || '保存失败', 'error');
        }
    } catch(e) { showToast('保存失败', 'error'); }
};

window.deleteMemoryEntry = async function(key) {
    if (!confirm('删除记忆: ' + key + '?')) return;
    var token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        var resp = await fetch('/oneapichat/memory_api.php?action=delete_memory&token=' + encodeURIComponent(token), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key })
        });
        var data = await resp.json();
        if (data.success) {
            showToast('已删除', 'success');
            window.refreshMemoryList();
        }
    } catch(e) { showToast('删除失败', 'error'); }
};

window.clearAllMemories = async function() {
    if (!confirm('确定清空所有记忆?此操作不可撤销!')) return;
    var token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        var resp = await fetch('/oneapichat/memory_api.php?action=get_memories&token=' + encodeURIComponent(token));
        var data = await resp.json();
        var memories = data.memories || [];
        for (var i = 0; i < memories.length; i++) {
            await fetch('/oneapichat/memory_api.php?action=delete_memory&token=' + encodeURIComponent(token), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: memories[i].key })
            });
        }
        showToast('已清空 ' + memories.length + ' 条记忆', 'success');
        window.refreshMemoryList();
    } catch(e) { showToast('清空失败', 'error'); }
};

// ── AI 自主记忆保存 ───────────────────────────

/** 对话结束后自动提取重要信息保存为记忆 */
window._autoSaveMemoriesFromChat = async function(chatId) {
    var token = localStorage.getItem('authToken');
    if (!token || !chatId || !chats[chatId]) return;
    var msgs = chats[chatId].messages;
    if (msgs.length < 3) return; // 太短的对话不提取

    // 取最后5条非system消息作为分析素材
    var recent = msgs.filter(function(m) { return m.role !== 'system' && !m.temporary && !m._internal; }).slice(-6);
    if (recent.length < 2) return;

    var conversation = recent.map(function(m) {
        return (m.role === 'user' ? '用户: ' : 'AI: ') + (m.text || m.content || '').substring(0, 200);
    }).join('\n');

    // 用廉价模型,但必须用 DeepSeek API(不能走 MiniMax)
    var key = localStorage.getItem('apiKey') || '';
    var baseUrl = localStorage.getItem('baseUrl') || 'https://api.deepseek.com';
    if (baseUrl.includes('minimaxi.com')) {
        // MiniMax 不兼容,用免费/廉价后备
        return;
    }
    var model = 'deepseek-chat';
    if (!key) return;

    try {
        var resp = await fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: '你是记忆提取助手。分析对话,提取值得长期记住的信息。\n\n规则:\n1. 只提取用户明确告知的偏好、个人信息、决策、计划\n2. 忽略闲聊、问时间天气、临时问答\n3. 用JSON格式输出: [{"key":"简短英文键","content":"中文内容"}]\n4. 如果没有任何值得记住的,输出空数组 []\n5. 每个content不超过80字\n6. 最多提取3条' },
                    { role: 'user', content: '请从以下对话提取值得长期记住的信息:\n' + conversation }
                ],
                temperature: 0.1,
                max_tokens: 300
            })
        });
        if (!resp.ok) return;
        var data = await resp.json();
        var text = data.choices?.[0]?.message?.content || '';
        // 提取JSON
        var jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return;
        var items = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(items) || items.length === 0) return;

        // 保存每条记忆
        var saved = 0;
        for (var i = 0; i < items.length; i++) {
            if (!items[i].key || !items[i].content) continue;
            await fetch('/oneapichat/memory_api.php?action=save_memory&token=' + encodeURIComponent(token), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: items[i].key, content: items[i].content })
            });
            saved++;
        }
        if (saved > 0) {
            console.log('[自动记忆] 已保存 ' + saved + ' 条');
            window._loadCloudMemories();
        }
    } catch(e) { console.warn('[自动记忆] 失败:', e.message); }
};

// ── AI 自主询问身份 ───────────────────────────

/** 检查并自动在Agent聊天中询问身份 */
window._autoAskIdentity = async function() {
    var token = localStorage.getItem('authToken');
    if (!token) return;
    // 检查是否已有身份信息
    try {
        var resp = await fetch('/oneapichat/memory_api.php?action=search_memories&q=identity_user_name&token=' + encodeURIComponent(token));
        var data = await resp.json();
        var hasIdentity = data.memories && data.memories.some(function(m) { return m.key === 'identity_user_name'; });
        if (hasIdentity) return; // 已有身份,不需要问
    } catch(e) { return; }

    // 在Agent聊天中注入身份询问消息
    if (isAgentToolsActive() && currentChatId === AGENT_CHAT_ID) {
        window.__autoIdentityAsked = true;
        setTimeout(function() {
            showIdentityCard();
        }, 1000);
    }
};

// ★ 身份卡片 - 漂亮弹窗代替丑陋系统消息
window.showIdentityCard = function() {
    var container = document.querySelector('.chat-messages') || document.getElementById('chat-messages');
    if (!container) return;

    // 移除已有的
    var old = container.querySelector('.identity-card-wrapper');
    if (old) old.remove();

    var wrapper = document.createElement('div');
    wrapper.className = 'identity-card-wrapper';
    wrapper.style.cssText = 'display:flex;justify-content:center;padding:16px 0;animation:identitySlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1);';
    wrapper.innerHTML = '<div class="identity-card" style="max-width:420px;width:100%;background:linear-gradient(135deg,#667eea0e,#764ba20e);border:1px solid #667eea22;border-radius:16px;padding:20px 24px;box-shadow:0 4px 24px rgba(102,126,234,0.08);">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">' +
        '<span style="font-size:24px;">👋</span>' +
        '<div style="font-weight:600;font-size:15px;color:#667eea;">你好! 设置身份信息</div>' +
        '</div>' +
        '<div style="color:#6b7280;font-size:13px;line-height:1.6;margin-bottom:16px;">' +
        '告诉我你希望我怎么称呼你、以及我该以什么风格和你对话。' +
        '<br>例如:<span style="color:#667eea;font-weight:500;">"叫我奕侨,回复简洁直接"</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button onclick="var e=event.target.closest(\'.identity-card-wrapper\');e.style.transition=\'all 0.25s\';e.style.opacity=\'0\';e.style.transform=\'translateY(-10px)\';setTimeout(function(){e.remove()},250)" style="flex:1;padding:8px 12px;border-radius:10px;border:1px solid #e5e7eb;background:transparent;color:#6b7280;cursor:pointer;font-size:13px;transition:all 0.15s;" onmouseover="this.style.background=\'#f3f4f6\'" onmouseout="this.style.background=\'transparent\'">稍后再说</button>' +
        '<button onclick="window._handleIdentityQuick(\'调用我Ai助手\');var e=event.target.closest(\'.identity-card-wrapper\');e.style.transition=\'all 0.25s\';e.style.opacity=\'0\';e.style.transform=\'translateY(-10px)\';setTimeout(function(){e.remove()},250)" style="flex:1;padding:8px 12px;border-radius:10px;border:none;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.15s;" onmouseover="this.style.opacity=\'0.9\'" onmouseout="this.style.opacity=\'1\'">快速跳过</button>' +
        '</div></div>';
    container.appendChild(wrapper);
    // 滚动到底部
    setTimeout(function() { wrapper.scrollIntoView({behavior:'smooth',block:'nearest'}); }, 100);
};

// 身份快捷设置
window._handleIdentityQuick = function(name) {
    var input = document.querySelector('#agent-chat-input, .chat-input') || document.querySelector('textarea');
    if (input && typeof window.sendMessage === 'function') {
        // 作为内部消息静默发送
        var msgs = chats[currentChatId]?.messages;
        if (msgs) {
            msgs.push({role:'user',text:'请称呼我' + name + '。我已经设置好了,从现在开始按这个身份对话。',_internal:true});
        }
    }
};

/**
 * 在 Agent 聊天加载时,从引擎加载记忆/人格/身份并注入 system prompt
 */
async function _injectAgentMemoryIntoSystem(chatId) {
    if (chatId !== AGENT_CHAT_ID) return;
    var chat = chats[chatId];
    if (!chat || !chat.messages) return;

    try {
        // 并行加载记忆、人格、身份
        var [personaRes, identityRes, memoryRes] = await Promise.all([
            window.loadAgentPersona(),
            window.loadAgentIdentity(),
            window.loadAgentMemory()
        ]);

        // ★ 缓存到内存,供 API 调用时注入
        window.__agentPersonaCache = null;
        window.__agentIdentityCache = null;
        window.__agentMemoryCache = null;

        var sysIdx = chat.messages.findIndex(function(m) { return m.role === 'system'; });
        var baseSys = '';

        // 构建记忆注入块
        var memoryBlock = '';

        if (personaRes && personaRes.ok && personaRes.persona) {
            window.__agentPersonaCache = personaRes.persona;
            var p = personaRes.persona;
            if (p.name) {
                memoryBlock += '\n\n## 人格设定\n';
                memoryBlock += '- AI名称: ' + (p.name || 'AI助手') + '\n';
                if (p.style) memoryBlock += '- 风格: ' + p.style + '\n';
                if (p.preferences) {
                    var prefs = p.preferences;
                    if (prefs.language) memoryBlock += '- 语言: ' + prefs.language + '\n';
                    if (prefs.response_style) memoryBlock += '- 回复风格: ' + prefs.response_style + '\n';
                }
            }
        }

        if (identityRes && identityRes.ok && identityRes.identity) {
            window.__agentIdentityCache = identityRes.identity;
            var id = identityRes.identity;
            if (id.name || id.notes) {
                memoryBlock += '\n## 用户信息\n';
                if (id.name) memoryBlock += '- 称呼: ' + id.name + '\n';
                if (id.notes) memoryBlock += '- 备注: ' + id.notes + '\n';
                memoryBlock += '- 时区: ' + (id.timezone || 'Asia/Shanghai') + '\n';
                memoryBlock += '- 语言: ' + (id.language || 'zh-CN') + '\n';
            }
        }

        if (memoryRes && memoryRes.ok && memoryRes.entries && memoryRes.entries.length > 0) {
            window.__agentMemoryCache = memoryRes.entries;
            memoryBlock += '\n## 长期记忆\n';
            memoryBlock += '以下是你与用户的长期记忆(记住这些信息以便后续对话):\n';
            var count = 0;
            for (var i = 0; i < memoryRes.entries.length && count < 20; i++) {
                var e = memoryRes.entries[i];
                memoryBlock += '- [' + e.key + '] ' + e.content + '\n';
                count++;
            }
            if (memoryRes.entries.length > 20) {
                memoryBlock += '- ...(还有 ' + (memoryRes.entries.length - 20) + ' 条记忆)\n';
            }
        }

        // 注入:替换或追加到第一条 system 消息
        if (sysIdx !== -1) {
            var existingContent = chat.messages[sysIdx].content;
            // 移除旧的记忆注入块(如果有)
            existingContent = existingContent.replace(/\n*## 人格设定[\s\S]*?## 用户信息[\s\S]*?## 长期记忆[\s\S]*?(?=\n## |$)/, '');
            existingContent = existingContent.replace(/\n*## 人格设定[\s\S]*?## 长期记忆[\s\S]*?(?=\n## |$)/, '');
            existingContent = existingContent.replace(/\n*## 人格设定[\s\S]*?(?=\n## |$)/, '');
            existingContent = existingContent.trim();
            if (memoryBlock) {
                chat.messages[sysIdx].content = existingContent + memoryBlock;
            }
        }
    } catch(e) {
        console.warn('[AgentMemory] 注入失败:', e);
    }
}

// ── Agent 心跳定时器 ────────────────────────────

/** 启动 Agent 心跳定时器(每30秒上报一次) */
var _agentHeartbeatTimer = null;

function _startAgentHeartbeatIfNeeded() {
    if (!isAgentToolsActive()) {
        if (_agentHeartbeatTimer) {
            clearInterval(_agentHeartbeatTimer);
            _agentHeartbeatTimer = null;
        }
        return;
    }
    if (_agentHeartbeatTimer) return; // 已启动

    // 首次立即上报
    window.agentHeartbeat('active', 'neutral', currentChatId);

    _agentHeartbeatTimer = setInterval(function() {
        if (!isAgentToolsActive()) {
            clearInterval(_agentHeartbeatTimer);
            _agentHeartbeatTimer = null;
            return;
        }
        window.agentHeartbeat('active', 'neutral', currentChatId);
    }, 30000);
}

// 在 setAgentMode 后启动心跳 + 关闭popup
(function() {
    var origSetAgentMode = window.setAgentMode;
    window.setAgentMode = function(mode) {
        origSetAgentMode(mode);
        // ★ 选完关闭 popup(桌面端hover也适用)
        var popup = getEl('agentModePopup');
        if (popup) popup.classList.remove('show');
        _startAgentHeartbeatIfNeeded();
    };
})();


window.openAgentPanel = function() {
    var ap = $.agentPanel || getEl('agentPanel');
    var cp = $.configPanel || getEl('configPanel');
    if (!ap) return;

    if (isMobile()) {
        // 移动端:关配置面板,用遮罩
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

    // 桌面端:先关配置面板
    if (cp && !cp.classList.contains('hidden-panel')) {
        cp.classList.add('hidden-panel');
    }
    // 确保 display 可见,然后移除隐藏类
    ap.style.display = '';
    // 使用 requestAnimationFrame 确保布局正确
    requestAnimationFrame(function() {
        ap.classList.remove('hidden-panel');
    });
    // 清除非通知红点
    var dot = getEl('agentNotifDot');
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
    // 过渡结束后隐藏 display(否则 CSS transition 不生效)
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
        // 如果选中了代理,同步刷新聊天内容
        if (_selectedAgentName) {
            // ★ 保持选中状态,只更新内容(不覆盖已渲染的聊天历史)
            var token = getAuthToken();
            if (token) {
                fetch('/oneapichat/engine_api.php?action=agent_list&auth_token=' + token, { signal: AbortSignal.timeout(300000) })
                    .then(function(r) { return r.json(); })
                    .then(function(agents) {
                        var a = agents[_selectedAgentName];
                        var msgArea = getEl('agentChatMessages');
                        if (!msgArea) return;
                        if (!a) { return; }
                        // ★ 只在 agent 状态变化时更新,避免闪烁
                        var prevStatus = msgArea.getAttribute('data-status') || '';
                        if (a.status === prevStatus && prevStatus === 'completed') return;
                        msgArea.setAttribute('data-status', a.status || '');
                        if (a.status === 'running') {
                            var partial = a.result || '';
                            if (partial) {
                                msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant">' +
                                    '<div class="text-xs text-green-500 font-medium mb-1">运行中</div>' +
                                    '<div class="text-xs whitespace-pre-wrap text-gray-600 dark:text-gray-300" style="font-size:11px;max-height:200px;overflow-y:auto;">' + escapeHtml(partial.substring(0, 2000)) + '</div></div>';
                            } else {
                                msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant"><div class="text-xs text-green-500 font-medium">运行中...</div></div>';
                            }
                        } else if (a.result) {
                            if (prevStatus !== 'completed') {
                                msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant">' +
                                    '<div class="text-xs text-gray-400 mb-1">' + escapeHtml(_selectedAgentName) + '</div>' +
                                    '<div class="text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300">' + escapeHtml(a.result.substring(0, 3000)) + '</div></div>';
                                var key = 'agent_chat_' + _selectedAgentName;
                                localStorage.setItem(key, JSON.stringify([{ role: 'assistant', content: a.result, time: Date.now() }]));
                            }
                        }
                    }).catch(function() { /* 静默 */ });
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
                '<button onclick="event.stopPropagation();window.deleteAgent(\'' + safeName + '\');" class="p-1 text-gray-400 hover:text-red-500 transition" title="删除子代理"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>' +
            '</div>' +
        '</div>';
    }).join('');
};

window._refreshAllAgentLists = async function() {
    var token = getAuthToken();
    if (!token) return;
    try {
        var r = await fetch('/oneapichat/engine_api.php?action=agent_list&auth_token=' + token, { signal: AbortSignal.timeout(300000) });
        var agents = await r.json();
        // 验证返回的数据是有效对象
        if (typeof agents !== 'object' || agents === null || Array.isArray(agents)) {
            throw new Error('引擎返回无效数据');
        }
        window._agentListCache = agents;
        window._agentListCacheTime = Date.now();
        window._renderAgentList(agents, getEl('agentSubList'));
        window._renderAgentList(agents, getEl('engineAgentList'));
        var dptuiContainer = getEl('agentSubListDptui');
        if (dptuiContainer && dptuiContainer !== getEl('agentSubList')) window._renderAgentList(agents, dptuiContainer);
    } catch(e) {
        // 显示错误但不中断,保留上次缓存
        var msg = '加载失败: ' + e.message;
        var lists = ['agentSubList', 'agentSubListDptui', 'engineAgentList'];
        lists.forEach(function(id) {
            var el = getEl(id);
            if (el) el.innerHTML = '<div class="text-xs text-gray-500 p-2" style="font-size:10px;">' + escapeHtml(msg) + '</div>';
        });
        // 如果缓存超过30秒,清除缓存避免展示过时数据
        if (window._agentListCacheTime && Date.now() - window._agentListCacheTime > 30000) {
            window._agentListCache = {};
        }
        console.warn('[AgentPanel] 刷新失败:', e.message);
    }
};

window.refreshAgentPanel = window._refreshAllAgentLists;

/** 更新 Agent 面板中的费用/用量显示 */
function updateAgentUsageDisplay() {
    var usageEl = getEl('agentUsageDisplay');
    if (!usageEl) return;
    var cost = sessionUsage.totalCost.toFixed(4);
    var pt = sessionUsage.promptTokens;
    var ct = sessionUsage.completionTokens;
    var cacheHits = sessionUsage.prefixCacheHits;
    var toolCalls = sessionUsage.toolCalls;
    // 使用增强可视化
    usageEl.innerHTML = usageVisualizer.fullDisplay();
}

/** 实时用量更新 (轻量级,仅更新数字不刷新全组件) */
function updateUsageLive() {
    // 保留给未来实时更新使用
}

/** 重置会话用量统计 */
function resetSessionUsage() {
    sessionUsage = { promptTokens: 0, completionTokens: 0, totalCost: 0, prefixCacheHits: 0, toolCalls: 0, approvalsGranted: 0, approvalsRejected: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
    toolCallStats.reset();
    // 清除会话级别审批记忆
    sessionStorage.removeItem('approvalRemembered');
    updateAgentUsageDisplay();
}

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
        fetch('/oneapichat/engine_api.php?action=agent_list&auth_token=' + token, { signal: AbortSignal.timeout(300000) })
            .then(function(r) { return r.json(); })
            .then(function(agents) {
                var a = agents[agentName];
                if (!a) { msgArea.innerHTML = '<div class="text-xs text-gray-400">代理不存在(可能已被删除)</div>'; return; }
                if (a.status === 'running') {
                    var partial = a.result || '';
                    if (partial) {
                        msgArea.innerHTML = '<div class="agent-chat-bubble role-assistant">' +
                            '<div class="text-xs text-green-500 font-medium mb-1">🟡 运行中,已生成内容:</div>' +
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
    var token = getAuthToken();
    if (!token) { if (statusEl) statusEl.textContent = '❌ 未登录'; return; }
    fetch('/oneapichat/engine_api.php?action=agent_notifications&auth_token=' + token, { signal: AbortSignal.timeout(300000) })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || data.count === 0) {
                if (statusEl) statusEl.textContent = '没有新的子代理结果';
                return;
            }
            // ★ 保存结果数据并通过标准流程处理(由 triggerAgentAutoReplyForSubAgent 统一管理队列和 mark)
            (data.notifications || []).forEach(function(n) {
                if (!window._pendingSubAgentResultsData) window._pendingSubAgentResultsData = {};
                window._pendingSubAgentResultsData[n.agent] = {
                    status: n.status || 'completed',
                    result: n.result || '',
                    error: n.error || ''
                };
                if (isAgentToolsActive()) {
                    window.triggerAgentAutoReplyForSubAgent(n.agent);
                }
            });
            if (statusEl) statusEl.textContent = '✅ ' + data.count + ' 条结果已转发给主代理';
        }).catch(function() {
            if (statusEl) statusEl.textContent = '❌ 请求失败';
        });
};

function updateAgentUI() {
    var mode = getAgentMode();
    var isActive = mode !== 'off';  // ★ plan/agent/yolo 都算激活
    // 更新三模式选择器按钮
    updateModeSelector(mode);
    // Header Agent 按钮圆点
    var splitBtn = getEl('agentSplitBtn');
    if (splitBtn) {
        splitBtn.classList.toggle('active', isActive);
    }
    // 圆点颜色
    var dot = splitBtn ? splitBtn.querySelector('.agent-dot') : null;
    if (dot) {
        var dotColors = { 'off': 'rgba(255,255,255,0.5)', 'plan': '#3b82f6', 'agent': '#22c55e', 'yolo': '#ef4444' };
        dot.style.setProperty('background', dotColors[mode] || dotColors['off'], 'important');
        var dotShadow = { 'plan': '0 0 6px rgba(59,130,246,0.6)', 'agent': '0 0 6px rgba(34,197,94,0.6)', 'yolo': '0 0 6px rgba(239,68,68,0.6)' };
        dot.style.setProperty('box-shadow', dotShadow[mode] || 'none', 'important');
    }
    // 配置面板开关
    var configToggle = getEl('agentModeToggle');
    if (configToggle) {
        configToggle.checked = isActive;
    }
    // SVG 图标定义(不依赖 emoji)
    var _svgIcons = {
        'off': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
        'plan': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
        'agent': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="3"/></svg>',
        'yolo': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L4 21h16L12 3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };
    // 聊天区 Agent 模式标签
    var agentLabel = getEl('agentModeLabel');
    if (agentLabel) {
        var labelTexts = { 'off': 'Agent', 'plan': 'Plan', 'agent': 'Agent', 'yolo': 'YOLO' };
        agentLabel.innerHTML = _svgIcons[mode] + ' ' + (labelTexts[mode] || 'Agent');
    }
    // 输入框上方模式提示
    var banner = getEl('agentBanner');
    if (banner) {
        if (mode === 'off') {
            banner.classList.add('hidden');
        } else {
            banner.classList.remove('hidden');
            var tips = { 'plan': 'Plan 只读 · 仅搜索和读取', 'agent': 'Agent 交互 · AI可操作需审批', 'yolo': 'YOLO 自动 · 所有操作自动批准' };
            var bannerClasses = { 'plan': 'banner-plan', 'agent': 'banner-agent', 'yolo': 'banner-yolo' };
            banner.className = 'agent-banner ' + (bannerClasses[mode] || '');
            banner.innerHTML = '<span class="agent-banner-icon">' + _svgIcons[mode] + '</span>' +
                '<span class="agent-banner-text">' + (tips[mode] || '') + '</span>';
        }
    }
    // 更新 Agent 面板中的模式标识
    var modeDisplay = getEl('agentModeDisplay');
    if (modeDisplay) {
        var modeSymbolSvg = _svgIcons[mode] || _svgIcons['off'];
        modeDisplay.innerHTML = modeSymbolSvg + ' ' + mode.charAt(0).toUpperCase() + mode.slice(1);
    }
    // ★ Agent/YOLO 模式下自动启用工具调用,隐藏工具调用开关
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
        // 启动心跳轮询 + 实时更新
        window.startAgentRealtimeUpdates();
    } else {
        if (toolCallRow) {
            toolCallRow.style.opacity = '1';
            toolCallRow.style.pointerEvents = 'auto';
            toolCallRow.title = '';
        }
    }
    // 更新 body class 用于 CSS 控制
    // ★ 统一侧边栏：Agent/Plan/YOLO 收起, Off 展开
    if (mode === 'off') {
        if ($.sidebar?.classList.contains('collapsed')) {
            $.sidebar.classList.remove('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
        }
    } else {
        if ($.sidebar && !$.sidebar.classList.contains('collapsed')) {
            $.sidebar.classList.add('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'block';
        }
    }
    document.body.classList.toggle('agent-active', isActive);

    // ★ 普通模式: 改输入框提示文字,过滤Agent命令
    var input = $.userInput || getEl('userInput');
    if (input) {
        input.placeholder = mode === 'off' ? '发送消息... / 开头用斜杠命令' : '发送消息给 Agent... / 开头用斜杠命令';
    }
    // 过滤命令列表
    _updateCommandFilter(mode);
}

// ★ 根据模式过滤命令 (普通模式禁用 Agent 命令)
function _updateCommandFilter(mode) {
    var agentCmds = ['mode', 'model'];
    var isAgent = mode !== 'off';
    SLASH_COMMANDS.forEach(function(c) {
        if (agentCmds.indexOf(c.cmd) !== -1) {
            c._disabled = !isAgent;
        }
    });
}

/** 更新三模式选择器的 UI 状态 */
// ★ 悬停模式菜单定位
function _positionModePopup() {
    var popup = getEl('agentModePopup');
    var wrapper = document.querySelector('.agent-mode-wrapper');
    if (!popup || !wrapper) return;

    var rect = wrapper.getBoundingClientRect();

    if (window.matchMedia('(max-width: 640px)').matches) {
        // ★ 移动端: 紧贴按钮下方弹出
        popup.style.top = (rect.bottom + 4) + 'px';
        popup.style.left = rect.left + 'px';
        popup.style.right = 'auto';
        popup.style.bottom = 'auto';
        return;
    }
    var popupRect = popup.getBoundingClientRect();
    var POPUP_HEIGHT = popupRect.height || 40;
    var spaceBelow = window.innerHeight - rect.bottom;

    // 下方空间够就向下弹,否则向上
    if (spaceBelow >= POPUP_HEIGHT + 8) {
        popup.style.top = (rect.bottom + 4) + 'px';
    } else {
        popup.style.top = (rect.top - POPUP_HEIGHT - 4) + 'px';
    }
    popup.style.left = rect.left + 'px';
    popup.style.right = 'auto';
    popup.style.bottom = 'auto';
}

// 页面加载时预定位模式菜单
setTimeout(_positionModePopup, 500);
window.addEventListener('resize', _positionModePopup);
// ★ Agent 模式弹出菜单(鼠标延迟隐藏 + 移动端点击切换)
window._agentPopupTimer = null;
window._setupAgentPopup = function() {
    var wrapper = document.querySelector('.agent-mode-wrapper');
    var popup = getEl('agentModePopup');
    var mainBtn = document.getElementById('agentMainBtn');
    if (!wrapper || !popup || !mainBtn) return;

    function updateBtnLabel() {
        var el = mainBtn.querySelector('.agent-btn-label');
        if (!el) return;
        var mode = getAgentMode();
        var texts = { 'off': 'Agent', 'plan': 'Plan', 'agent': 'Agent', 'yolo': 'YOLO' };
        el.style.transition = 'opacity 0.15s';
        el.style.opacity = '0';
        setTimeout(function() {
            el.textContent = texts[mode] || 'Agent';
            el.style.opacity = '1';
        }, 120);
    }
    updateBtnLabel();

    var isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia('(pointer:coarse)').matches;

    if (isTouch) {
        var tapTimer = null, lastTap = 0;
        mainBtn.addEventListener('click', function(e) {
            e.preventDefault();
            var now = Date.now();
            if (now - lastTap < 400) {
                clearTimeout(tapTimer); lastTap = 0;
                popup.classList.remove('show');
                var curMode = getAgentMode();
                setAgentMode(curMode !== 'off' ? 'off' : 'agent');
                // ★ 双击后立即刷新按钮文字
                var lbl = mainBtn.querySelector('.agent-btn-label');
                if (lbl) {
                    var m = getAgentMode();
                    var ts = { 'off': 'Agent', 'plan': 'Plan', 'agent': 'Agent', 'yolo': 'YOLO' };
                    lbl.textContent = ts[m] || 'Agent';
                    lbl.style.opacity = '1';
                }
                return;
            }
            lastTap = now;
            if (popup.classList.contains('show')) {
                popup.classList.remove('show');
            } else {
                _positionModePopup();
                popup.classList.add('show');
                if (getAgentMode() !== 'off') {
                    var label = mainBtn.querySelector('.agent-btn-label');
                    if (label) {
                        label.style.opacity = '0';
                        setTimeout(function() {
                            label.textContent = '双击关闭';
                            label.style.opacity = '1';
                            setTimeout(function() {
                                label.style.opacity = '0';
                                setTimeout(function() {
                                    var m = getAgentMode();
                                    var ts = { 'off': 'Agent', 'plan': 'Plan', 'agent': 'Agent', 'yolo': 'YOLO' };
                                    label.textContent = ts[m] || 'Agent';
                                    label.style.opacity = '1';
                                }, 100);
                            }, 800);
                        }, 120);
                    }
                }
            }
            tapTimer = setTimeout(function() { lastTap = 0; }, 450);
        });
    } else {
        mainBtn.addEventListener('click', function() {
            window.toggleAgentMode();
        });
        wrapper.addEventListener('mouseenter', function() {
            if (window._agentPopupTimer) clearTimeout(window._agentPopupTimer);
            _positionModePopup();
            popup.classList.add('show');
        });
        wrapper.addEventListener('mouseleave', function() {
            window._agentPopupTimer = setTimeout(function() { popup.classList.remove('show'); }, 200);
        });
        popup.addEventListener('mouseenter', function() { if (window._agentPopupTimer) clearTimeout(window._agentPopupTimer); });
        popup.addEventListener('mouseleave', function() { popup.classList.remove('show'); });
    }

    document.addEventListener('click', function(e) {
        if (!popup.classList.contains('show')) return;
        if (!wrapper.contains(e.target) && !popup.contains(e.target)) popup.classList.remove('show');
    });
    document.addEventListener('touchmove', function() { popup.classList.remove('show'); }, { passive: true });
};


function updateModeSelector(mode) {
    mode = mode || getAgentMode();
    // 更新下拉菜单中的模式按钮
    var dropdown = getEl('agentModeDropdown');
    if (dropdown) {
        var opts = dropdown.querySelectorAll('.agent-mode-opt');
        opts.forEach(function(opt) {
            var optMode = opt.getAttribute('data-mode');
            opt.classList.toggle('active', optMode === mode);
        });
    }
    // 也更新旧模式选择器(兼容)
    var selector = getEl('agentModeSelector');
    if (selector) {
        var btns = selector.querySelectorAll('.mode-btn');
        btns.forEach(function(btn) {
            var btnMode = btn.getAttribute('data-mode');
            btn.classList.toggle('active', btnMode === mode);
        });
    }
}

// ==================== 审批门 (Approval Gate v2) ====================
// 参考 DeepSeek-TUI 的 execpolicy 设计

/**
 * 获取工具的审批级别 (优先使用注册表,回退旧逻辑)
 */
function getToolApprovalLevel(toolName) {
  // 优先从注册表获取
  if (window.toolRegistry && toolRegistry.has(toolName)) {
    return toolRegistry.getApprovalLevel(toolName);
  }
  // 回退: 检查是否在旧的高危列表中
  var oldHighRisk = ['server_file_write','server_file_op','server_exec','server_python','server_docker','engine_cron_create','engine_cron_delete'];
  var oldMediumRisk = ['delegate_task','engine_agent_create','server_db_query','autonomous_mode'];
  if (oldHighRisk.indexOf(toolName) !== -1) return 'required';
  if (oldMediumRisk.indexOf(toolName) !== -1) return 'suggest';
  return 'auto';
}

/** 判断是否是高危工具(需要审批) */
function isHighRiskTool(toolName) {
    return getToolApprovalLevel(toolName) === 'required';
}

/** 判断是否是只读工具 (无需审批) */
function isReadOnlyTool(toolName) {
  if (window.toolRegistry && toolRegistry.has(toolName)) {
    return toolRegistry.isReadOnly(toolName);
  }
  // 回退旧逻辑
  var readOnlyTools = ['web_search','web_fetch','rag_search','server_file_read','server_file_search','server_sys_info','server_ps','server_disk','server_network','server_db_query','engine_agent_status','engine_agent_list','engine_cron_list','engine_push','ask_agent','autonomous_mode'];
  return readOnlyTools.indexOf(toolName) !== -1;
}

/** 判断命令是否危险(需要审批) */
function isDangerousCommand(cmd) {
    if (!cmd || typeof cmd !== 'string') return false;
    var dangerPatterns = ['rm ', 'dd ', 'mkfs', 'shutdown', 'reboot', 'kill ', '>:'];
    var lower = cmd.toLowerCase();
    for (var i = 0; i < dangerPatterns.length; i++) {
        if (lower.indexOf(dangerPatterns[i]) !== -1) return true;
    }
    return false;
}

/**
 * 请求用户批准高危操作
 * @param {string} toolName - 工具名称
 * @param {object} args - 工具参数
 * @returns {Promise<boolean>} true=批准, false=拒绝
 */
/**
 * 检查是否有 '始终允许此工具' 规则
 */
function getAlwaysAllowRules() {
  try { return JSON.parse(localStorage.getItem('approvalAlwaysAllowRules') || '{}'); } catch(e) { return {}; }
}

/**
 * 检查工具是否在 '始终允许' 规则中
 */
function isAlwaysAllowed(toolName) {
  var rules = getAlwaysAllowRules();
  return !!rules[toolName];
}

/**
 * 添加 '始终允许此工具' 规则
 */
function addAlwaysAllowRule(toolName) {
  var rules = getAlwaysAllowRules();
  rules[toolName] = true;
  try { localStorage.setItem('approvalAlwaysAllowRules', JSON.stringify(rules)); } catch(e) {}
}

/**
 * 移除 '始终允许此工具' 规则
 */
function removeAlwaysAllowRule(toolName) {
  var rules = getAlwaysAllowRules();
  delete rules[toolName];
  try { localStorage.setItem('approvalAlwaysAllowRules', JSON.stringify(rules)); } catch(e) {}
}

/**
 * 请求用户批准高危操作 (增强版)
 * 参考 DeepSeek-TUI execpolicy 设计模式
 * @param {string} toolName - 工具名称
 * @param {object} args - 工具参数
 * @returns {Promise<boolean>} true=批准, false=拒绝
 */
function requestToolApproval(toolName, args) {
    return new Promise(function(resolve) {
        var mode = getAgentMode();

        // ★ 超时保护: 30秒内未响应则自动拒绝
        var _approvalTimer = setTimeout(function() {
            console.warn('[审批] 超时未响应,自动拒绝:', toolName);
            sessionUsage.approvalsRejected++;
            resolve(false);
        }, 30000);

        function _cleanup() {
            clearTimeout(_approvalTimer);
        }

        // YOLO 模式: 自动批准所有操作
        if (mode === 'yolo') {
            _cleanup();
            sessionUsage.approvalsGranted++;
            resolve(true);
            return;
        }

        // Plan 模式: 拒绝所有写操作
        if (mode === 'plan') {
            _cleanup();
            sessionUsage.approvalsRejected++;
            resolve(false);
            return;
        }

        // Agent 模式: 检查 '始终允许此工具' 规则
        if (isAlwaysAllowed(toolName)) {
            _cleanup();
            sessionUsage.approvalsGranted++;
            resolve(true);
            return;
        }

        // 只读工具自动批准 (Feature 6)
        if (isReadOnlyTool(toolName)) {
            _cleanup();
            sessionUsage.approvalsGranted++;
            resolve(true);
            return;
        }

        // 检查是否已记住此工具(会话级别)
        var remembered = {};
        try { remembered = JSON.parse(sessionStorage.getItem('approvalRemembered') || '{}'); } catch(e) {}
        var cmdPart = (args && args.cmd) ? args.cmd.substring(0, 50) : '';
        if (args && args.name && !cmdPart) cmdPart = args.name.substring(0, 50);
        var rememberKey = toolName + '_' + (cmdPart || '');
        if (remembered[rememberKey] !== undefined) {
            _cleanup();
            var approved = remembered[rememberKey];
            if (approved) { sessionUsage.approvalsGranted++; } else { sessionUsage.approvalsRejected++; }
            resolve(approved);
            return;
        }

        // Agent 模式: 显示审批弹窗
        // 参数预览(截断避免过长)
        var argsPreview = '';
        try {
            if (typeof args === 'object' && args !== null) {
                var previewParts = [];
                for (var k in args) {
                    var v = typeof args[k] === 'string' ? args[k].substring(0, 100) : JSON.stringify(args[k]).substring(0, 100);
                    previewParts.push(k + ': ' + v);
                }
                argsPreview = previewParts.join('\n');
            } else {
                argsPreview = String(args).substring(0, 200);
            }
        } catch(e) {
            argsPreview = '无法预览参数';
        }

        // 检测是否需要额外的危险警告
        var extraWarning = '';
        if (toolName === 'server_exec') {
            var cmd = (args && args.cmd) || '';
            if (isDangerousCommand(cmd)) {
                extraWarning = '⚠️ 此命令包含危险操作,请谨慎确认!';
            }
        }
        // 从注册表获取工具描述
        var toolHint = '';
        if (window.toolRegistry && toolRegistry.has(toolName)) {
          toolHint = toolRegistry.getSearchHint(toolName);
        }

        // 创建审批弹窗 (现代化居中弹出 + SVG 图标)
        var overlay = document.createElement('div');
        overlay.className = 'approval-overlay';
        overlay.innerHTML = '<div class="approval-modal-v2">' +
            '<div class="approval-modal-header">' +
                '<div class="approval-modal-icon">' +
                    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
                '</div>' +
                '<div class="approval-modal-title">操作审批</div>' +
                '<div class="approval-modal-subtitle">确认允许执行此操作</div>' +
            '</div>' +
            '<div class="approval-modal-body">' +
                (extraWarning ? '<div class="approval-warning"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ' + extraWarning + '</div>' : '') +
                '<div class="approval-tool-row">' +
                    '<span class="approval-tool-tag">' + escapeHtml(toolName) + '</span>' +
                    (toolHint ? '<span class="approval-tool-hint">' + escapeHtml(toolHint) + '</span>' : '') +
                '</div>' +
                '<details class="approval-args-details">' +
                    '<summary class="approval-args-summary">' +
                        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><circle cx="12" cy="12" r="3"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/></svg> 参数详情' +
                    '</summary>' +
                    '<pre class="approval-args-pre">' + escapeHtml(argsPreview) + '</pre>' +
                '</details>' +
            '</div>' +
            '<div class="approval-modal-options">' +
                '<label class="approval-option"><input type="checkbox" id="approvalRememberCheck"><span class="approval-checkmark"></span> 本次会话记住</label>' +
                '<label class="approval-option"><input type="checkbox" id="approvalAlwaysAllowCheck"><span class="approval-checkmark"></span> 始终允许此类型</label>' +
            '</div>' +
            '<div class="approval-modal-actions">' +
                '<button class="approval-btn-deny" id="approvalRejectBtn">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> 拒绝' +
                '</button>' +
                '<button class="approval-btn-allow" id="approvalConfirmBtn">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> 批准' +
                '</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        // 弹窗动画: 先出场再交互
        requestAnimationFrame(function() { overlay.classList.add('active'); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) { _cleanup(); overlay.remove(); resolve(false); } });


        // 按钮事件
        var confirmBtn = overlay.querySelector('#approvalConfirmBtn');
        var rejectBtn = overlay.querySelector('#approvalRejectBtn');

        confirmBtn.onclick = function() {
            _cleanup();
            var remember = overlay.querySelector('#approvalRememberCheck');
            if (remember && remember.checked) {
                remembered[rememberKey] = true;
                try { sessionStorage.setItem('approvalRemembered', JSON.stringify(remembered)); } catch(e) {}
            }
            // Feature 2: 始终允许此类型
            var alwaysAllow = overlay.querySelector('#approvalAlwaysAllowCheck');
            if (alwaysAllow && alwaysAllow.checked) {
                addAlwaysAllowRule(toolName);
            }
            sessionUsage.approvalsGranted++;
            overlay.remove();
            resolve(true);
        };

        rejectBtn.onclick = function() {
            _cleanup();
            var remember = overlay.querySelector('#approvalRememberCheck');
            if (remember && remember.checked) {
                remembered[rememberKey] = false;
                try { sessionStorage.setItem('approvalRemembered', JSON.stringify(remembered)); } catch(e) {}
            }
            sessionUsage.approvalsRejected++;
            overlay.remove();
            resolve(false);
        };
    });
}

// ★ Agent 主动建议功能
async function generateProactiveSuggestions(chatId, lastResponse) {
    if (!chatId || !lastResponse) return;
    var isActive = isAgentToolsActive();
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
    if (!confirm('确定要删除 cron 任务 "' + name + '" 吗?')) return;
    try {
        var r = await fetch('/oneapichat/engine_api.php?action=cron_delete&auth_token=' + getAuthToken() + '&name=' + encodeURIComponent(name), { signal: AbortSignal.timeout(300000) });
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
    if (!confirm('确定要删除 cron 任务 "' + name + '" 吗?')) return;
    try {
        var r = await fetch('/oneapichat/engine_api.php?action=cron_delete&auth_token=' + getAuthToken() + '&name=' + encodeURIComponent(name), { signal: AbortSignal.timeout(300000) });
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

// ★ 主代理通知系统:子代理完成后通知主代理
// 防重复 + 冷却 + 预处理结果 + 禁止创建新子代理,杜绝无限循环
window._agentNotifyQueue = [];
window._activeNotifyExecId = 0;
window._pendingNotifyExecId = null;
window._agentNotifyProcessing = false;
window._hasPendingSubAgentNotify = false;
window._currentGroupId = 0;
window._activeSubAgentGroup = [];
window._pendingSubAgentResults = [];
window._pendingSubAgentResultsData = {};  // {agentName: {status, result, error}} 原始数据
window._subAgentCooldownActive = false;
window._lastSubAgentReportTime = 0;

// 10秒冷却,防止子代理完成→创建新子代理的无限循环
const SUB_AGENT_COOLDOWN_MS = 10000;

window._processAgentNotifyQueue = async function() {
    // ★ 防御性初始化
    if (!Array.isArray(window._agentNotifyQueue)) { window._agentNotifyQueue = []; }
    if (window._agentNotifyQueue.length === 0) return;

    // 冷却检查
    var now = Date.now();
    if (now - window._lastSubAgentReportTime < SUB_AGENT_COOLDOWN_MS) {
        // 还处于冷却期,但通知已在上方被收集(因为 queue 不为空)
        // 延迟后再处理
        setTimeout(function() { window._processAgentNotifyQueue(); }, SUB_AGENT_COOLDOWN_MS);
        return;
    }

    var execId = ++window._activeNotifyExecId;

    // 如果主代理正在生成回复(sendMessage 已激活),则暂不处理
    // 等 sendMessage 完成后 sendMessage 本身会调用 processAgentNotifyQueue
    if (window._agentNotifyProcessing) {
        // 标记:有新通知在等待,等主代理空闲后统一处理
        window._hasPendingSubAgentNotify = true;
        // 记录等上一批完成后要执行的批次ID
        window._pendingNotifyExecId = execId;
        return;
    }
    window._pendingNotifyExecId = execId;
    window._agentNotifyProcessing = true;
    // ★ 超时保护: 30s 后强制解锁,防止锁死
    setTimeout(function() {
        if (window._agentNotifyProcessing && window._pendingNotifyExecId === execId) {
            console.warn('[AgentNotify] 锁超时,强制释放');
            window._agentNotifyProcessing = false;
        }
    }, 30000);

    // ★ 收集属于当前批次的子代理(所有在 _activeSubAgentGroup 里的都算)
    // 但必须等 ALL active 代理都完成才能通知主代理
    var activeGroup = window._activeSubAgentGroup || [];
    if (activeGroup.length === 0) {
        window._agentNotifyProcessing = false;
        return;  // 没有活跃组
    }

    // 检查是否所有 active 代理都完成了
    var activeNames = activeGroup.map(function(item) { return item.name; });
    var allDone = activeNames.every(function(name) {
        var stored = (window._pendingSubAgentResultsData || {})[name];
        if (!stored) return false;  // 还没收到通知
        return stored.status === 'completed' || stored.status === 'failed';
    });

    if (!allDone) {
        // ★ 还有子代理在跑,暂不触发主代理,把通知放回队列等待
        console.log('[AgentNotify] 还有活跃子代理未完成, 延迟处理', activeNames.length, '个');
        // 放回队列
        agents.forEach(function(n) { window._agentNotifyQueue.push({ agentName: n }); });
        window._agentNotifyProcessing = false;
        return;
    }

    var agents = [];
    while (window._agentNotifyQueue.length > 0) {
        var item = window._agentNotifyQueue.shift();
        if (item && item.agentName && agents.indexOf(item.agentName) === -1 && activeNames.indexOf(item.agentName) !== -1) {
            agents.push(item.agentName);
        }
    }
    if (agents.length === 0) {
        window._agentNotifyQueue = [];
        window._agentNotifyProcessing = false;
        return;
    }

    window._lastSubAgentReportTime = now;
    window._hasPendingSubAgentNotify = false;

    // ★ 直接从通知数据中提取结果,不依赖 agent_list(通知已含 result/error)
    var results = [];
    if (agents && agents.length > 0) {
        // agents 数组来自通知队列,每个 item 是 {agentName, result, error} 的原始对象
        // 但 processAgentNotifyQueue 没有直接访问原始通知数据
        // 改为从 _pendingSubAgentResults 中还原(通知时已保存)
        agents.forEach(function(name) {
            var stored = (window._pendingSubAgentResultsData || {})[name];
            if (stored) {
                var status = stored.status || 'completed';
                var statusLabel = status === 'completed' ? '✅完成' : (status === 'failed' ? '❌失败' : '🔄运行中');
                var detail = (stored.error || stored.result || '').substring(0, 1500);
                results.push(statusLabel + ' ' + name + '\n' + detail);
            } else {
                // 降级:用 agent_list 查询
                results.push('「' + name + '」状态未知(尝试查询...)');
            }
        });
        if (results.length === 0) {
            results.push('所有子代理结果获取失败,请检查引擎状态');
        }
    } else {
        results.push('无有效子代理完成通知');
    }

    var agentCount = agents.length;
    var summaryLine = agentCount === 1 ? '1 个子代理已完成' : agentCount + ' 个子代理已完成';

    // ★ 核心:子代理结果不推送到聊天界面,仅注入为系统上下文
    // 参考 Claude Code: 用 <task-notification> XML 通知主代理
    // 参考 DeepSeek-TUI: 父代理发 eval 查询子代理结果
    var ctx = '<task-notification>\n' +
        '<summary>' + summaryLine + '</summary>\n';
    for (var _ri = 0; _ri < results.length; _ri++) {
        ctx += '  <result agent="' + agents[_ri] + '">' + (results[_ri] || '(empty)') + '</result>\n';
    }
    ctx += '</task-notification>\n\n' +
        '### 🔒 规则\n' +
        '1. 【禁止】调用 delegate_task / agent_create / agent_run 等任何创建新子代理的工具\n' +
        '2. 仔细阅读 <task-notification> 中的子代理结果,用简洁的语言告知用户进展和结论\n' +
        '3. 如果子代理结果是错误/空的,诚实告知用户并建议重试\n' +
        '4. 【重要】你现在正在和用户对话,请直接回复用户,不要调用任何工具\n' +
        '5. 这是系统级通知,不要在回复中提及"系统通知""task-notification"等内部术语';

    window._pendingNotifyExecId = null;

    if (typeof window.sendMessage === 'function') {
        // ★ 直接用已有的聊天 messages 追加 user hint,触发模型总结
        // 不再用 sendMessage(true, '') 空字符串,改为追加一条 user 消息并触发 re-send
        var chatId = currentChatId;
        if (chatId && chats[chatId]) {
            // 追加系统上下文到消息历史
            chats[chatId].messages.push({
                role: 'system',
                content: ctx,
                _internal: false,
                temporary: true
            });
            saveChats();
            // ★ 用真实 user 消息激活主代理总结
            window.__internalAgentContext = null;
            window.sendMessage(true, '请整合子代理结果并告知用户进展');
        }

        // 异步清理:标记已处理并解锁
        setTimeout(function() {
            window._agentNotifyProcessing = false;
            var nextExecId = window._pendingNotifyExecId;
            if (agents && agents.length > 0 && typeof window._pendingSubAgentResultsData === 'object') {
                agents.forEach(function(name) { delete window._pendingSubAgentResultsData[name]; });
            }
            if (agents && Array.isArray(window._pendingSubAgentResults)) {
                agents.forEach(function(name) {
                    var idx = window._pendingSubAgentResults.indexOf(name);
                    if (idx !== -1) window._pendingSubAgentResults.splice(idx, 1);
                });
            }
            var token = getAuthToken();
            if (token) {
                fetch('/oneapichat/engine_api.php?action=agent_notifications_mark&auth_token=' + token, { signal: AbortSignal.timeout(300000) }).catch(function() {});
            }
            if (nextExecId !== null && nextExecId !== execId) {
                window._pendingNotifyExecId = null;
                setTimeout(function() { window._processAgentNotifyQueue(); }, 200);
            } else if (window._hasPendingSubAgentNotify || (Array.isArray(window._agentNotifyQueue) && window._agentNotifyQueue.length > 0)) {
                window._hasPendingSubAgentNotify = false;
                setTimeout(function() { window._processAgentNotifyQueue(); }, 200);
            }
        }, 2000);
    } else {
        // sendMessage 不可用,直接解锁
        window._agentNotifyProcessing = false;
        if (window._hasPendingSubAgentNotify || (Array.isArray(window._agentNotifyQueue) && window._agentNotifyQueue.length > 0)) {
            window._hasPendingSubAgentNotify = false;
            setTimeout(function() { window._processAgentNotifyQueue(); }, 200);
        }
    }
};

window.triggerAgentAutoReplyForSubAgent = function(agentName) {
    if (!agentName) return;
    if (!Array.isArray(window._agentNotifyQueue)) { window._agentNotifyQueue = []; }

    // 冷却期内收到通知,直接合并到队列但不触发新请求
    var now = Date.now();
    if (now - window._lastSubAgentReportTime < SUB_AGENT_COOLDOWN_MS) {
        // 如果队列中没有这个代理,加入队列
        var exists = window._agentNotifyQueue.some(function(item) { return item.agentName === agentName; });
        if (!exists) {
            window._agentNotifyQueue.push({ agentName: agentName });
        }
        // ★ 冷却期也设置延迟触发
        if (!window._cooldownTimer) {
            window._cooldownTimer = setTimeout(function() {
                window._cooldownTimer = null;
                window._processAgentNotifyQueue();
            }, SUB_AGENT_COOLDOWN_MS);
        }
        return;
    }

    // 记录待处理的子代理结果,避免重复触发
    if (!Array.isArray(window._pendingSubAgentResults)) { window._pendingSubAgentResults = []; }
    if (window._pendingSubAgentResults.indexOf(agentName) !== -1) {
        return;
    }
    window._pendingSubAgentResults.push(agentName);

    // 如果主代理正在生成,排队
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
    // ★ 检查这个代理是否还存在 (可能已被删除)
    var _agentList = window._agentListCache || {};
    if (Object.keys(_agentList).length === 0 || !_agentList[agentName]) {
        // 代理不存在或已被删除, 清理其通知
        var _rIdx = window._pendingSubAgentResults.indexOf(agentName);
        if (_rIdx !== -1) window._pendingSubAgentResults.splice(_rIdx, 1);
        if (window._pendingSubAgentResultsData) delete window._pendingSubAgentResultsData[agentName];
        return;
    }
    window._agentNotifyQueue.push({ agentName: agentName });
    window._processAgentNotifyQueue();
};

window.triggerAgentAutoReply = function(summary, chatId) {
    // 旧接口,保留兼容但不再使用
};

// ==================== Session 管理 (Feature 5) ====================

/**
 * 增强的 fetch 包装: 自动重试 + 指数退避
 * @param {string} url - 请求URL
 * @param {object} options - fetch 选项
 * @param {number} maxRetries - 最大重试次数(默认3)
 * @returns {Promise<Response>}
 */
function fetchWithRetry(url, options, maxRetries) {
    maxRetries = maxRetries || 3;
    return new Promise(function(resolve, reject) {
        var attempt = 0;
        var timeoutMs = (options && options.timeout) || 300000;
        function tryFetch() {
            attempt++;
            var ctrl = new AbortController();
            var timeoutId = setTimeout(function() { ctrl.abort(); }, timeoutMs);
            var opts = Object.assign({}, options || {}, { signal: ctrl.signal });
            delete opts.timeout;

            fetch(url, opts).then(function(resp) {
                clearTimeout(timeoutId);
                resolve(resp);
            }).catch(function(err) {
                clearTimeout(timeoutId);
                if (attempt >= maxRetries || err.name === 'AbortError') {
                    reject(err);
                    return;
                }
                var delay = Math.pow(2, attempt) * 500;
                console.log('[fetchWithRetry] 重试', attempt, '/', maxRetries, '延迟', delay + 'ms:', err.message);
                setTimeout(tryFetch, delay);
            });
        }
        tryFetch();
    });
}

/**
 * 清理确认对话框 (替代原生 confirm)
 * @param {string} title - 标题
 * @param {string} message - 消息
 * @param {string} confirmText - 确认按钮文字
 * @returns {Promise<boolean>}
 */
function showConfirmDialog(title, message, confirmText) {
    return new Promise(function(resolve) {
        var overlay = document.createElement('div');
        overlay.className = 'approval-overlay';
        // ★ 点击遮罩关闭 = 取消
        overlay.addEventListener('click', function(e) { if (e.target === overlay) { overlay.remove(); resolve(false); } });
        overlay.innerHTML = '<div class="approval-modal confirm-dialog">' +
            '<div class="approval-title">' + escapeHtml(title) + '</div>' +
            '<div class="confirm-message">' + escapeHtml(message) + '</div>' +
            '<div class="approval-buttons">' +
            '<button class="approval-reject" id="confirmCancelBtn">取消</button>' +
            '<button class="approval-confirm" id="confirmOkBtn">' + (confirmText || '确认') + '</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        // ★ ESC 关闭
        var escHandler = function(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); resolve(false); } };
        document.addEventListener('keydown', escHandler);

        overlay.querySelector('#confirmOkBtn').onclick = function() {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
            resolve(true);
        };
        overlay.querySelector('#confirmCancelBtn').onclick = function() {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
            resolve(false);
        };
    });
}

/**
 * 清理确认对话框 + 子代理聊天记录清理
 */
window.deleteAgent = async function(name) {
    if (!name) return;
    // ★ 先清缓存避免瞬间闪烁
    if (_selectedAgentName === name) { _selectedAgentName = null; }
    // 立即从本地列表移除
    if (window._agentListCache && window._agentListCache[name]) {
        delete window._agentListCache[name];
    }
    // 清理所有相关状态
    var key = 'agent_chat_' + name;
    localStorage.removeItem(key);
    ['_agentNotifyQueue','_pendingSubAgentResults'].forEach(function(arr) {
        if (window[arr] && Array.isArray(window[arr])) {
            window[arr] = window[arr].filter(function(item) { return (item.agentName || item) !== name; });
        }
    });
    if (window._pendingSubAgentResultsData) { delete window._pendingSubAgentResultsData[name]; }
    // 立即更新 UI
    window._renderAgentList(window._agentListCache || {}, getEl('agentSubList'));
    window._renderAgentList(window._agentListCache || {}, getEl('engineAgentList'));
    // 异步删除 (不阻塞 UI)
    var token = getAuthToken();
    if (!token) return;
    fetch('/oneapichat/engine_api.php?action=agent_delete&name=' + encodeURIComponent(name) + '&auth_token=' + token, { signal: AbortSignal.timeout(300000) })
        .then(function() {
            return fetch('/oneapichat/engine_api.php?action=agent_notifications_mark&auth_token=' + token, { signal: AbortSignal.timeout(300000) });
        })
        .then(function() { window._refreshAllAgentLists(); })
        .catch(function(e) { console.warn('[deleteAgent] 异步清理失败:', e.message); });
};

/**
 * 清理所有子代理
 */
window.clearAllAgents = async function() {
    var confirmed = await showConfirmDialog('清理所有子代理', '确定要删除所有子代理吗?\n\n此操作不可撤销,同时会删除所有子代理的聊天记录。', '全部删除');
    if (!confirmed) return;
    try {
        var r = await fetchWithRetry('/oneapichat/engine_api.php?action=agent_list&auth_token=' + getAuthToken());
        var agents = await r.json();
        var names = Object.keys(agents);
        var deleted = 0;
        for (var i = 0; i < names.length; i++) {
            try {
                await fetchWithRetry('/oneapichat/engine_api.php?action=agent_delete&auth_token=' + getAuthToken() + '&name=' + encodeURIComponent(names[i]));
                var key = 'agent_chat_' + names[i];
                localStorage.removeItem(key);
                deleted++;
            } catch(e) {
                console.warn('[clearAllAgents] 删除失败:', names[i], e.message);
            }
        }
        window.refreshEngineStatus();
        window._refreshAllAgentLists();
        alert('已清理 ' + deleted + ' 个子代理');
    } catch(e) {
        alert('清理失败: ' + e.message);
    }
};

window.refreshEngineStatus = async function() {
    var dot = getEl('engineHealthDot');
    var text = getEl('engineHealthText');
    if (!dot || !text) return;

    dot.className = 'engine-status-dot offline';
    text.textContent = '检查中...';

    try {
        var resp = await fetch('/oneapichat/engine_api.php?action=health&auth_token=' + getAuthToken(), { signal: AbortSignal.timeout(300000) });
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
            var cronResp = await fetch('/oneapichat/engine_api.php?action=cron_list&auth_token=' + getAuthToken(), { signal: AbortSignal.timeout(300000) });
            var cronData = await cronResp.json();
            // 引擎返回 {job_name: {...}} 格式,转换为数组
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

    // 加载子代理列表(统一使用 _renderAgentList)
    var agentList = getEl('engineAgentList');
    if (agentList && Object.keys(window._agentListCache || {}).length > 0) {
        window._renderAgentList(window._agentListCache, agentList);
    } else if (agentList) {
        try {
            var agentResp = await fetch('/oneapichat/engine_api.php?action=agent_list&auth_token=' + getAuthToken(), { signal: AbortSignal.timeout(300000) });
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
    // ★ 立即保存到 localStorage + 服务器
    localStorage.setItem('tokens', String(v));
    if (localStorage.getItem('authToken')) saveConfigToServer();
};

window.updateParam = (type, val) => {
    if (type === 'temp') {
        const span = getEl('tempValue');
        if (span) span.innerText = val;
    }
    // 不自动保存,滑动时只更新显示
};

// ==================== 工具/技能启用开关管理 ====================
// 默认禁用列表(高危工具默认关)
var _DANGEROUS_TOOLS = [
    'SERVER_EXEC_TOOL', 'SERVER_PYTHON_TOOL', 'SERVER_FILE_READ_TOOL', 'SERVER_FILE_WRITE_TOOL',
    'BROWSER_NAVIGATE_TOOL', 'BROWSER_SCREENSHOT_TOOL', 'BROWSER_CLICK_TOOL', 'BROWSER_TYPE_TOOL', 'BROWSER_GET_CONTENT_TOOL', 'BROWSER_GET_SNAPSHOT_TOOL',
    'SERVER_DOCKER_TOOL', 'SERVER_DB_QUERY_TOOL', 'SERVER_FILE_OP_TOOL',
    'ENGINE_CRON_CREATE_TOOL', 'ENGINE_CRON_DELETE_TOOL', 'ENGINE_AGENT_DELETE_TOOL'
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
    var stored = localStorage.getItem('tool_enabled_' + toolKey);
    if (stored !== null) return stored === 'true';
    return window.getToolDefaultEnabled(toolKey);
};

// 设置工具启用状态
window.setToolEnabled = function(toolKey, enabled) {
    localStorage.setItem('tool_enabled_' + toolKey, enabled ? 'true' : 'false');
};

// 加载工具开关配置到 UI
// ── 工具分类定义 (key: 显示名) ──
const _TOOL_CATEGORIES = [
    { label: '🔍 搜索与获取', keys: ['SEARCH_TOOL_DEFINITION','RAG_SEARCH_TOOL_DEFINITION','WEB_FETCH_TOOL_DEFINITION'] },
    { label: '🎨 图像', keys: ['IMAGE_TOOL_DEFINITION','ANALYZE_IMAGE_TOOL'] },
    { label: '🎬 视频', keys: ['VIDEO_UNDERSTANDING_TOOL','VIDEO_EDIT_TOOL'] },
    { label: '📚 刷课', keys: ['CHAXING_LOGIN_TOOL_DEFINITION','CHAXING_LIST_TOOL_DEFINITION','CHAXING_TOOL_DEFINITION','CHAXING_STATUS_TOOL_DEFINITION','CHAXING_STOP_TOOL_DEFINITION','CHAXING_STATS_TOOL_DEFINITION','CHAXING_OVERVIEW_TOOL'] },
    { label: '📝 考试', keys: ['CHAXING_AUTH_TOOL','CHAXING_EXAM_LIST_TOOL','CHAXING_EXAM_START_TOOL','CHAXING_EXAM_STATUS_TOOL','CHAXING_EXAM_STOP_TOOL'] },
    { label: '💻 服务器操控 ⚠️', keys: ['SERVER_EXEC_TOOL','SERVER_PYTHON_TOOL','SERVER_FILE_READ_TOOL','SERVER_FILE_WRITE_TOOL','SERVER_SYS_INFO_TOOL','SERVER_PS_TOOL','SERVER_DISK_TOOL','SERVER_NETWORK_TOOL','SERVER_DOCKER_TOOL','SERVER_DB_QUERY_TOOL','SERVER_FILE_SEARCH_TOOL','SERVER_FILE_OP_TOOL'], agentOnly: true },
    { label: '🤖 引擎/Agent', keys: ['ENGINE_CRON_LIST_TOOL','ENGINE_CRON_CREATE_TOOL','ENGINE_CRON_DELETE_TOOL','DELEGATE_TASK_TOOL','ENGINE_AGENT_STATUS_TOOL','ENGINE_AGENT_LIST_TOOL','ENGINE_AGENT_DELETE_TOOL','ENGINE_PUSH_TOOL'], agentOnly: true },
    { label: '🧠 AI 自主控制', keys: ['ASK_AGENT_TOOL','AUTONOMOUS_MODE_TOOL'] },
    { label: '🎮 SRC 星穹铁道', keys: ['SRC_STATUS_TOOL','SRC_DASHBOARD_TOOL','SRC_START_TOOL','SRC_STOP_TOOL','SRC_GET_TASKS_TOOL','SRC_TOGGLE_TASK_TOOL','SRC_GET_CONFIG_TOOL','SRC_SET_CONFIG_TOOL','SRC_GET_LOGS_TOOL','SRC_CHECK_UPGRADE_TOOL','SRC_DO_UPGRADE_TOOL'] },
    { label: '🪟 Windows 本机', keys: ['WIN_INFO_TOOL','WIN_PROCESSES_TOOL','WIN_KILL_TOOL','WIN_START_TOOL','WIN_RESTART_TOOL','WIN_FILE_TOOL','WIN_SCREENSHOT_TOOL'], agentOnly: true }
];

// ── 工具显示名映射 ──
const _TOOL_LABELS = {
    'SEARCH_TOOL_DEFINITION': '联网搜索', 'RAG_SEARCH_TOOL_DEFINITION': '知识库搜索', 'WEB_FETCH_TOOL_DEFINITION': '网页抓取',
    'IMAGE_TOOL_DEFINITION': '图片生成', 'ANALYZE_IMAGE_TOOL': '图片分析', 'VIDEO_UNDERSTANDING_TOOL': '视频分析', 'VIDEO_EDIT_TOOL': '视频剪辑',
    'CHAXING_LOGIN_TOOL_DEFINITION': '登录', 'CHAXING_LIST_TOOL_DEFINITION': '课程列表', 'CHAXING_TOOL_DEFINITION': '刷课执行',
    'CHAXING_STATUS_TOOL_DEFINITION': '状态', 'CHAXING_STOP_TOOL_DEFINITION': '停止', 'CHAXING_STATS_TOOL_DEFINITION': '统计',
    'CHAXING_OVERVIEW_TOOL': '总览',
    'CHAXING_AUTH_TOOL': '登录检测', 'CHAXING_EXAM_LIST_TOOL': '考试列表', 'CHAXING_EXAM_START_TOOL': '开始考试',
    'CHAXING_EXAM_STATUS_TOOL': '考试状态', 'CHAXING_EXAM_STOP_TOOL': '停止考试',
    'SERVER_EXEC_TOOL': '命令执行', 'SERVER_PYTHON_TOOL': 'Python 执行', 'SERVER_FILE_READ_TOOL': '文件读取',
    'SERVER_FILE_WRITE_TOOL': '文件写入', 'SERVER_SYS_INFO_TOOL': '系统信息', 'SERVER_PS_TOOL': '进程列表',
    'SERVER_DISK_TOOL': '磁盘信息', 'SERVER_NETWORK_TOOL': '网络状态', 'SERVER_DOCKER_TOOL': 'Docker',
    'SERVER_DB_QUERY_TOOL': '数据库', 'SERVER_FILE_SEARCH_TOOL': '文件搜索', 'SERVER_FILE_OP_TOOL': '文件操作',
    'ENGINE_CRON_LIST_TOOL': 'Cron 列表', 'ENGINE_CRON_CREATE_TOOL': '创建 Cron', 'ENGINE_CRON_DELETE_TOOL': '删除 Cron',
    'DELEGATE_TASK_TOOL': '子代理任务', 'ENGINE_AGENT_STATUS_TOOL': '子代理状态', 'ENGINE_AGENT_LIST_TOOL': '子代理列表',
    'ENGINE_AGENT_DELETE_TOOL': '删除子代理', 'ENGINE_PUSH_TOOL': '推送通知',
    'ASK_AGENT_TOOL': '请求 Agent 模式', 'AUTONOMOUS_MODE_TOOL': '自主模式开关',
    'SRC_STATUS_TOOL': 'SRC状态', 'SRC_DASHBOARD_TOOL': 'SRC资源面板', 'SRC_START_TOOL': 'SRC启动', 'SRC_STOP_TOOL': 'SRC停止',
    'SRC_GET_CONFIG_TOOL': 'SRC读配置', 'SRC_SET_CONFIG_TOOL': 'SRC改配置',
    'SRC_GET_LOGS_TOOL': 'SRC日志', 'SRC_GET_TASKS_TOOL': 'SRC任务', 'SRC_TOGGLE_TASK_TOOL': 'SRC开关任务',
    'SRC_CHECK_UPGRADE_TOOL': 'SRC检查更新', 'SRC_DO_UPGRADE_TOOL': 'SRC执行升级',
    'WIN_INFO_TOOL': 'Win系统信息', 'WIN_PROCESSES_TOOL': 'Win进程列表', 'WIN_KILL_TOOL': 'Win结束进程',
    'WIN_START_TOOL': 'Win启动程序', 'WIN_RESTART_TOOL': 'Win重启程序', 'WIN_FILE_TOOL': 'Win文件操作',
    'WIN_SCREENSHOT_TOOL': 'Win截图'
};

// ── 动态渲染工具面板 ──
window.renderToolPanel = function() {
    var container = document.getElementById('toolToggleContainer');
    if (!container) return;
    // 移除已有的动态工具行(保留自定义技能区域)
    var existingRows = container.querySelectorAll('.tool-toggle-row.dynamic, .tools-category-label.dynamic');
    existingRows.forEach(function(r) { r.remove(); });

    var customSkillsEl = document.getElementById('customSkillsList');
    var rendered = '';

    var _agentOn = isAgentToolsActive();
    _TOOL_CATEGORIES.forEach(function(cat) {
        var _disabled = cat.agentOnly && !_agentOn;
        if (_disabled) {
            rendered += '<div class="tools-category-label dynamic" style="opacity:0.4;">' + cat.label + ' <span style="font-size:10px;color:#f59e0b;">🔒Agent</span></div>';
        } else {
            rendered += '<div class="tools-category-label dynamic">' + cat.label + '</div>';
        }
        cat.keys.forEach(function(key) {
            var label = _TOOL_LABELS[key] || key;
            var isDanger = (key.indexOf('SERVER_EXEC') >= 0 || key.indexOf('SERVER_PYTHON') >= 0 || key.indexOf('SERVER_FILE_WRITE') >= 0 || key.indexOf('SERVER_DOCKER') >= 0 || key.indexOf('SERVER_DB') >= 0 || key.indexOf('SERVER_FILE_OP') >= 0 || key.indexOf('CRON_CREATE') >= 0 || key.indexOf('CRON_DELETE') >= 0 || key.indexOf('AGENT_DELETE') >= 0);
            var warnClass = isDanger ? ' tool-warn' : '';
            var checked = window.isToolEnabled(key) ? ' checked' : '';
            var disabledAttr = _disabled ? ' disabled' : '';
            rendered += '<div class="tool-toggle-row dynamic' + (_disabled ? ' tool-disabled' : '') + '" data-tool="' + key + '">';
            rendered += '<span class="tool-toggle-name' + warnClass + '" title="' + label + '">' + label + '</span>';
            rendered += '<label class="switch small"><input type="checkbox" id="tool_enabled_' + key + '" data-toolkey="' + key + '"' + checked + disabledAttr + '><span class="slider"></span></label>';
            rendered += '</div>';
        });
    });

    // 插入到自定义技能区域之前
    if (customSkillsEl) {
        customSkillsEl.insertAdjacentHTML('beforebegin', rendered);
    } else {
        container.insertAdjacentHTML('beforeend', rendered);
    }

    // 绑定事件
    if (typeof bindToolToggleEvents === 'function') bindToolToggleEvents();
    window.updateToolsActiveCount();
};

window.loadToolToggleStates = function() {
    // 动态渲染工具面板
    window.renderToolPanel();
    // 自定义技能绑定
    if (typeof bindCustomSkillEvents === 'function') bindCustomSkillEvents();
    window.updateToolsActiveCount();
};

// 保存工具开关到 localStorage (由 saveConfig 调用)
window.saveToolToggleStates = function() {
    var inputs = document.querySelectorAll('[data-toolkey]');
    inputs.forEach(function(el) {
        var key = el.getAttribute('data-toolkey');
        if (key) {
            window.setToolEnabled(key, el.checked);
        }
    });
};

// 更新工具计数
window.updateToolsActiveCount = function() {
    var countEl = document.getElementById('toolsActiveCount');
    if (!countEl) return;
    var enabled = 0;
    var total = 0;
    var inputs = document.querySelectorAll('[data-toolkey]');
    inputs.forEach(function(el) {
        total++;
        if (el.checked) enabled++;
    });
    // 加上自定义技能
    var customSkills = window.getCustomSkills();
    customSkills.forEach(function(skill) {
        total++;
        if (window.isToolEnabled('CUSTOM_SKILL_' + skill.name)) enabled++;
    });
    countEl.textContent = '(' + enabled + '/' + total + ' 启用)';
};

// 工具开关变更监听
function bindToolToggleEvents() {
    var inputs = document.querySelectorAll('[data-toolkey]');
    for (var _tti = 0; _tti < inputs.length; _tti++) {
        inputs[_tti].onchange = function() {
            var key = this.getAttribute('data-toolkey');
            if (key) {
                window.setToolEnabled(key, this.checked);
                window.updateToolsActiveCount();
            }
        };
    }
}

window.enableAllTools = function() {
    var inputs = document.querySelectorAll('[data-toolkey]');
    inputs.forEach(function(el) {
        el.checked = true;
        var key = el.getAttribute('data-toolkey');
        if (key) window.setToolEnabled(key, true);
    });
    window.updateToolsActiveCount();
    showToast('全部工具已启用', 'success');
};

window.disableAllTools = function() {
    var inputs = document.querySelectorAll('[data-toolkey]');
    inputs.forEach(function(el) {
        el.checked = false;
        var key = el.getAttribute('data-toolkey');
        if (key) window.setToolEnabled(key, false);
    });
    window.updateToolsActiveCount();
    showToast('全部工具已禁用', 'info');
};

window.toggleAllDangerousTools = function(enabled) {
    _DANGEROUS_TOOLS.forEach(function(key) {
        var el = document.getElementById('tool_enabled_' + key);
        if (el) {
            el.checked = enabled;
            window.setToolEnabled(key, enabled);
        }
    });
    window.updateToolsActiveCount();
    showToast('高危工具已' + (enabled ? '启用' : '关闭'), enabled ? 'warning' : 'info');
};

// ==================== 自定义技能管理 ====================
// 从 localStorage 获取自定义技能列表
window.getCustomSkills = function() {
    try {
        return JSON.parse(localStorage.getItem('customSkills') || '[]');
    } catch(e) { return []; }
};

// 保存自定义技能列表到 localStorage
window.saveCustomSkills = function(skills) {
    localStorage.setItem('customSkills', JSON.stringify(skills));
};

// 渲染自定义技能列表到 UI
window.renderCustomSkillsList = function() {
    var container = document.getElementById('customSkillsList');
    if (!container) return;
    var skills = window.getCustomSkills();
    if (skills.length === 0) {
        container.innerHTML = '<div style="font-size:11px;color:#9ca3af;padding:4px;">暂无自定义技能</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < skills.length; i++) {
        var skill = skills[i];
        var enabled = window.isToolEnabled('CUSTOM_SKILL_' + skill.name);
        html += '<div class="custom-skill-item" style="display:flex;align-items:center;justify-content:space-between;padding:6px 4px;border-bottom:1px solid #f3f4f6;font-size:12px;" class="dark:border-gray-700">' +
            '<div style="flex:1;overflow:hidden;">' +
                '<div style="font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(skill.name) + '</div>' +
                '<div style="font-size:10px;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(skill.description || '') + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
                '<label class="switch small"><input type="checkbox" data-custom-skill="' + escapeHtml(skill.name) + '" ' + (enabled ? 'checked' : '') + '><span class="slider"></span></label>' +
                '<button onclick="window.deleteCustomSkill(\'' + escapeHtml(skill.name) + '\')" class="text-red-400 hover:text-red-600 p-1" title="删除"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>' +
            '</div>' +
        '</div>';
    }
    container.innerHTML = html;

    // 为自定义技能 checkbox 绑定事件
    container.querySelectorAll('[data-custom-skill]').forEach(function(el) {
        el.addEventListener('change', function() {
            var skillName = this.getAttribute('data-custom-skill');
            if (skillName) {
                window.setToolEnabled('CUSTOM_SKILL_' + skillName, this.checked);
                window.updateToolsActiveCount();
            }
        });
    });

    // 更新 tool keys 以包含自定义技能
    window.updateToolsActiveCount();
};

// 显示创建技能对话框
window.showCreateSkillDialog = function() {
    var overlay = document.getElementById('createSkillOverlay');
    if (!overlay) {
        showToast('创建技能面板未加载,请刷新页面', 'error');
        return;
    }
    overlay.classList.remove('hidden');
    // 清空输入
    document.getElementById('skillDescriptionInput').value = '';
    document.getElementById('skillPreviewArea').classList.add('hidden');
    document.getElementById('skillDefinitionPreview').value = '';
    document.getElementById('skillGenerateStatus').textContent = '';
    document.getElementById('generateSkillBtn').disabled = false;
    document.getElementById('generateSkillBtn').textContent = '🤖 AI 生成';
};

window.closeCreateSkillDialog = function() {
    var overlay = document.getElementById('createSkillOverlay');
    if (overlay) overlay.classList.add('hidden');
};

// 调用 AI 生成工具定义
window.generateSkillDefinition = async function() {
    var desc = document.getElementById('skillDescriptionInput').value.trim();
    if (!desc) {
        showToast('请先描述你需要的工具功能', 'warning');
        return;
    }
    var btn = document.getElementById('generateSkillBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 生成中...';
    document.getElementById('skillGenerateStatus').textContent = 'AI 正在生成工具定义...';

    // 检测当前模型是否支持工具调用
    var currentModel = getVal('modelSelect') || 'deepseek-v4-flash';
    var isNoTool = false;
    try {
        var noToolModels = JSON.parse(localStorage.getItem('noToolModels') || '[]');
        for (var i = 0; i < noToolModels.length; i++) {
            if (currentModel.toLowerCase().indexOf(noToolModels[i]) !== -1) {
                isNoTool = true;
                break;
            }
        }
    } catch(e) {}

    var apiKey = getVal('apiKey');
    var baseUrl = getVal('baseUrl');
    if (!apiKey || !baseUrl) {
        showToast('请先配置 API Key 和 Base URL', 'error');
        btn.disabled = false;
        btn.textContent = '🤖 AI 生成';
        document.getElementById('skillGenerateStatus').textContent = '';
        return;
    }

    var systemPrompt = '你是一个工具定义生成器。根据用户的描述,生成一个符合 OpenAI function calling 格式的 tool definition JSON。\n\n' +
        '格式要求(只返回 JSON,不要额外解释):\n' +
        '{\n  "name": "工具名(小写英文和下划线)",\n  "description": "工具详细描述(中文)",\n  "parameters": {\n    "type": "object",\n    "properties": { ... },\n    "required": [...]\n  },\n  "implementation": "impl_" + name  // 前端函数名前缀\n}\n\n' +
        '注意:\n- 参数名用小写英文\n- description 要清晰,让AI知道何时调用\n- required列表只放必填参数\n- implementation 是前端 JS 函数名,按 impl_xxx 格式';

    try {
        var resp = await fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: currentModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: '请生成一个工具定义,用户需求: ' + desc }
                ],
                temperature: 0.3,
                max_tokens: 4096
            })
        });

        if (!resp.ok) {
            throw new Error('API 请求失败 (' + resp.status + ')');
        }

        var data = await resp.json();
        var content = data.choices?.[0]?.message?.content || '';

        // 提取 JSON
        var jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            content = jsonMatch[0];
        }

        // 尝试验证
        try {
            var parsed = JSON.parse(content);
            // 补充默认字段
            if (!parsed.type) parsed.type = 'function';
            if (!parsed.function) {
                parsed.function = {
                    name: parsed.name || 'custom_tool',
                    description: parsed.description || '',
                    parameters: parsed.parameters || { type: 'object', properties: {} }
                };
            }
            content = JSON.stringify(parsed, null, 2);
        } catch(e) {
            // JSON 可能不完整,尝试修复
            showToast('AI 生成的 JSON 格式有误,请手动编辑', 'warning');
        }

        document.getElementById('skillDefinitionPreview').value = content;
        document.getElementById('skillPreviewArea').classList.remove('hidden');
        document.getElementById('skillGenerateStatus').textContent = '✅ 生成完成,请检查并编辑后保存';
    } catch(e) {
        showToast('生成失败: ' + e.message, 'error');
        document.getElementById('skillGenerateStatus').textContent = '❌ 生成失败: ' + e.message;
    }

    btn.disabled = false;
    btn.textContent = '🤖 AI 生成';
};

// 保存自定义技能
window.saveCustomSkill = function() {
    var jsonStr = document.getElementById('skillDefinitionPreview').value.trim();
    if (!jsonStr) {
        showToast('请输入有效的工具定义 JSON', 'warning');
        return;
    }

    var parsed;
    try {
        parsed = JSON.parse(jsonStr);
    } catch(e) {
        showToast('JSON 格式错误: ' + e.message, 'error');
        return;
    }

    // 提取名称
    var name = parsed.function?.name || parsed.name || '';
    if (!name) {
        showToast('工具定义中必须包含 name', 'error');
        return;
    }

    // 构建标准的 tool definition
    var toolDef = {
        type: 'function',
        function: {
            name: name,
            description: parsed.function?.description || parsed.description || '',
            parameters: parsed.function?.parameters || parsed.parameters || { type: 'object', properties: {} }
        },
        implementation: parsed.implementation || ('impl_' + name)
    };

    // 读取已有技能列表
    var skills = window.getCustomSkills();

    // 检查是否已存在同名技能
    var existing = -1;
    for (var i = 0; i < skills.length; i++) {
        if (skills[i].name === name) {
            existing = i;
            break;
        }
    }

    if (existing !== -1) {
        if (!confirm('技能 "' + name + '" 已存在,是否覆盖?')) {
            return;
        }
        skills[existing] = toolDef;
    } else {
        skills.push(toolDef);
    }

    window.saveCustomSkills(skills);
    window.renderCustomSkillsList();
    window.loadToolToggleStates();
    window.closeCreateSkillDialog();
    showToast('技能 "' + name + '" 已保存 ✅', 'success');

    // 如果有登录,同步到服务器
    if (localStorage.getItem('authToken')) {
        saveConfigToServer();
    }
};

// 删除自定义技能
window.deleteCustomSkill = function(name) {
    if (!confirm('确定删除技能 "' + name + '"?')) return;
    var skills = window.getCustomSkills();
    skills = skills.filter(function(s) { return s.name !== name; });
    window.saveCustomSkills(skills);
    localStorage.removeItem('tool_enabled_CUSTOM_SKILL_' + name);
    window.renderCustomSkillsList();
    window.updateToolsActiveCount();
    showToast('技能 "' + name + '" 已删除', 'info');
    if (localStorage.getItem('authToken')) {
        saveConfigToServer();
    }
};

window.clearSkillPreview = function() {
    document.getElementById('skillDefinitionPreview').value = '';
    document.getElementById('skillPreviewArea').classList.add('hidden');
    document.getElementById('skillGenerateStatus').textContent = '';
};

// ==================== END 工具/技能管理 ====================

function saveConfig(showFeedback = false) {
    console.log('[saveConfig] apiKey:', (getVal('apiKey')||'') ? '✅' : '❌');
    try {
        const mainKey = getVal('apiKey') || '';
        var _provider = getEl('baseUrlProvider')?.value || 'custom';
        var _pCfg = API_PROVIDERS[_provider] || API_PROVIDERS.custom;
        // ★ 写独立厂商 key + 通用 apiKey(两者同步)
        localStorage.setItem(_pCfg.keyLS, mainKey === 'not-needed' ? '' : encrypt(mainKey));
        localStorage.setItem('apiKey', mainKey);
        localStorage.setItem('baseUrl', getVal('baseUrl') || '');
        if (_provider === 'custom') localStorage.setItem('baseUrlCustom', getVal('baseUrl') || '');
        localStorage.setItem('baseUrlProvider', _provider);
        var _curModel = getVal('modelSelect') || '';
        if (_curModel) localStorage.setItem('model_' + _provider, _curModel);
        localStorage.setItem('baseUrl', getVal('baseUrl') || '');
        localStorage.setItem('systemPrompt', getVal('systemPrompt') || '');
        localStorage.setItem('model', getVal('modelSelect') || '');
        localStorage.setItem('visionModel', getVal('visionModel') || '');
    localStorage.setItem('visionApiUrl', getVal('visionApiUrl') || DEFAULT_CONFIG.visionApiUrl || '');
    localStorage.setItem('visionApiKey', encrypt(getVal('visionApiKey') || ''));
    localStorage.setItem('visionProvider', getEl('visionProvider')?.value || 'minimax');
    localStorage.setItem('visionApiKeyOpenAI', encrypt(getVal('visionApiKeyOpenAI') || ''));
    localStorage.setItem('visionApiUrlOpenAI', getVal('visionApiUrlOpenAI') || 'https://api.openai.com/v1');
    localStorage.setItem('imageModel', getEl('imageModel')?.value || '');
    localStorage.setItem('imageApiKey', encrypt(getVal('imageApiKey') || ''));
    localStorage.setItem('imageBaseUrl', getVal('imageBaseUrl') || '');
    localStorage.setItem('imageApiKeyOpenrouter', encrypt(getVal('imageApiKeyOpenrouter') || ''));
    localStorage.setItem('imageBaseUrlOpenrouter', getVal('imageBaseUrlOpenrouter') || '');
    localStorage.setItem('imageProvider', getVal('imageProvider') || 'minimax');
    localStorage.setItem('temp', getVal('temperature') || '0.7');
    localStorage.setItem('tokens', getVal('maxTokens') || '8192');
    localStorage.setItem('stream', getChecked('streamToggle'));
    localStorage.setItem('requestTimeout', getVal('requestTimeout') || '60');
    localStorage.setItem('compress', getChecked('compressToggle'));
    localStorage.setItem('threshold', getVal('compressThreshold') || '10');
    // compressModel 自动选择,不再手动设置
    localStorage.removeItem('compressModel');
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
    localStorage.setItem('searchApiKey', encrypt(_sak));
    localStorage.setItem('searchApiKeyBrave', encrypt(getVal('searchApiKeyBrave') || ''));
    localStorage.setItem('searchApiKeyGoogle', encrypt(getVal('searchApiKeyGoogle') || ''));
    localStorage.setItem('searchApiKeyTavily', encrypt(getVal('searchApiKeyTavily') || ''));
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
    // ★ TTS 语音合成配置
    localStorage.setItem('ttsProvider', getVal('ttsProvider') || 'minimax');
    localStorage.setItem('ttsApiKey', encrypt(getVal('ttsApiKey') || ''));
    localStorage.setItem('ttsVoiceId', getVal('ttsVoiceId') || '');
    localStorage.setItem('ttsSpeed', getVal('ttsSpeed') || '1.0');
    // ★ 保存工具开关状态
    if (window.saveToolToggleStates) window.saveToolToggleStates();
    } catch(e) {
        console.warn('[saveConfig] localStorage写入失败(已忽略):', e.message);
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
            // ★ 同步隐藏遮罩
            if ($.sidebarMask) $.sidebarMask.classList.remove('active');
            lockBodyScroll(false);
        }
        configSnapshot = null;
        configPanelWasOpen = false;
    }
    // ★ 保存后延迟刷新模型列表(避免和保存 toast 冲突)
    if (getVal('baseUrl') && getVal('apiKey')) {
        setTimeout(function() { fetchModels(true).catch(function(){}); }, 1500);
    }
    // ★ 配置变更后立即同步到服务器(按用户隔离)
    if (localStorage.getItem('authToken')) {
        saveConfigToServer();  // 立即执行,不延时
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
        // 不再使用自定义 paragraph renderer(marked v15 默认已正确处理)
    }
    // 清空 Markdown 缓存使新配置生效
    if (MarkdownRenderer) MarkdownRenderer.clearCache();
    if (currentChatId) loadChat(currentChatId);
};

// ==================== 模型管理 ====================
window.fetchModels = async function (silent) {
    const key = getVal('apiKey');
    const url = getVal('baseUrl');
    const selects = ['modelSelect', 'titleModel', 'searchModel', 'aiSearchJudgeModel'];

    selects.forEach(id => {
        const el = getEl(id);
        if (el) el.innerHTML = '<option>加载中...</option>';
    });

    // ★ llama.cpp 本地模型通常不需要 API Key,允许空 key 获取模型列表
    var _provider = getEl('baseUrlProvider')?.value || 'custom';
    var _isLocalModel = _provider === 'llamacpp';
    if (!key && !_isLocalModel) {
        selects.forEach(id => {
            const el = getEl(id);
            if (el) el.innerHTML = '<option>请输入API Key</option>';
        });
        return;
    }

    try {
        var _headers = _isLocalModel ? {} : { Authorization: `Bearer ${key}` };
        const res = await fetch(`${url}/models`, { headers: _headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const models = data.data || [];
        const modelOptions = models.map(m => `<option value="${m.id}">${m.id}</option>`).join('');

        const mainSelect = getEl('modelSelect');
        if (mainSelect) {
            mainSelect.innerHTML = modelOptions;
            var _p = getEl('baseUrlProvider')?.value || 'custom';
            var _storedModel = localStorage.getItem('model_' + _p) || localStorage.getItem('model') || '';
            mainSelect.value = (_storedModel && models.some(function(m) { return m.id === _storedModel; })) ? _storedModel : (models.length ? models[0].id : '');
            // ★ 更新后立即失焦,防止 select 展开触发视觉变化
            mainSelect.blur();
            // 避免重复绑定 change 事件
            if (!mainSelect._modelChangeBound) {
                mainSelect._modelChangeBound = true;
                mainSelect.addEventListener('change', function() {
                    var val = this.value;
                    localStorage.setItem('model', val);
                    var _p2 = getEl('baseUrlProvider')?.value || 'custom';
                    localStorage.setItem('model_' + _p2, val);
                    saveConfigToServer();
                });
            }
        }

        ['titleModel', 'searchModel', 'aiSearchJudgeModel'].forEach(id => {
            const sel = getEl(id);
            if (!sel) return;
            const placeholder = '<option value="">同主模型</option>';
            sel.innerHTML = placeholder + modelOptions;
            const saved = localStorage.getItem(id);
            if (saved && models.some(m => m.id === saved)) sel.value = saved;
            else if (models.length) sel.value = 'deepseek-v4-flash';
        });
        // ★ compressModel 设为自动选择只读
        var compressSel = getEl('compressModel');
        if (compressSel) {
            compressSel.innerHTML = '<option value="auto">自动选择</option>';
            compressSel.value = 'auto';
            compressSel.disabled = true;
            compressSel.title = '自动选择: 当前模型 context ≥ 128K 用自身, 否则用 deepseek-chat';
        }

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
            // ★ 完全按用户配置,不按模型调整
            let cur = parseInt(getVal('maxTokens')) || 8192;
            if (cur > max) {
                setVal('maxTokens', max);
                setVal('maxTokensInput', max);
                        }
        }
    } catch (e) {
        if (silent) throw e;
        var _e = e.message || '';
        if (_e.includes('401') || _e.includes('403')) showToast('API Key 无效 (401)', 'error');
        else if (_e.includes('404')) showToast('URL 不正确 (404)', 'error');
        else if (_e.includes('Failed to fetch')) showToast('无法连接', 'error');
        else showToast('模型列表加载失败', 'error');
    }
};

window.refreshModels = async function (e) {
    const btn = e?.target.closest('button');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
    }
    // ★ 最低显示旋转动画 600ms,避免一闪而过
    var _spinStart = Date.now();
    try {
        await window.fetchModels(true);
        // ★ 延迟显示 toast,避免与模型列表更新同时触发视觉变化
        setTimeout(function() { showToast('模型列表已刷新', 'success'); }, 100);
    } catch (e) {
        var _em = (e && e.message) ? e.message : '';
        if (_em.includes('401') || _em.includes('403')) showToast('API Key 无效 (401)', 'error');
        else if (_em.includes('404')) showToast('URL 不正确 (404)', 'error');
        else if (_em.includes('timeout') || _em.includes('Failed to fetch')) showToast('无法连接', 'error');
        else showToast('刷新失败', 'error');
    } finally {
        // ★ 确保旋转动画至少显示了 600ms
        var _elapsed = Date.now() - _spinStart;
        var _minDelay = Math.max(0, 600 - _elapsed);
        setTimeout(function() {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
            }
        }, _minDelay);
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

// ★ 流式响应完成后重新生成最后一条回复
window.regenLastAssistant = async function(text) {
    if (!currentChatId || !chats[currentChatId]) return;
    var msgs = chats[currentChatId].messages;
    var idx = -1;
    for (var ri = msgs.length - 1; ri >= 0; ri--) {
        if (msgs[ri].role === 'assistant') { idx = ri; break; }
    }
    if (idx === -1) return;
    var sys = msgs.filter(function(m) { return m.role === 'system' && !m.temporary && !m.timestamp; });
    var timestamp = null;
    for (var ti = 0; ti < msgs.length; ti++) {
        if (msgs[ti].timestamp) { timestamp = msgs[ti]; break; }
    }
    var others = msgs.slice(0, idx).filter(function(m) { return m.role !== 'system' || m.temporary || m.timestamp; });
    chats[currentChatId].messages = sys.concat(others).concat(timestamp ? [timestamp] : []);
    saveChatsDebounced();
    loadChat(currentChatId);
    var lastUser = null;
    for (var ui = idx - 1; ui >= 0; ui--) {
        if (msgs[ui].role === 'user') { lastUser = msgs[ui]; break; }
    }
    if (lastUser) await sendMessage(true, lastUser.text, lastUser.files);
};


function autoLinkURLs(markdownText) {
    // ★ 统一将所有裸 URL 转为可点击的 markdown 链接,不再区分图片
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
    img.style.cssText = 'max-width:90vw;max-height:80vh;object-fit:contain;border-radius:4px;cursor:grab;transition:transform 0.15s ease;';

    var counter = document.createElement('div');
    counter.style.cssText = 'color:#fff;margin-bottom:12px;font-size:14px;';

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:12px;margin-top:12px;';

    // ════ 缩放状态 ════
    var scale = 1;
    var minScale = 1;
    var maxScale = 5;
    // 拖拽平移状态
    var isDragging = false;
    var dragStartX = 0, dragStartY = 0;
    var offsetX = 0, offsetY = 0;

    function applyTransform() {
        img.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
        if (scale > 1) {
            img.style.cursor = 'grabbing';
            img.style.maxWidth = 'none';
            img.style.maxHeight = 'none';
            img.style.width = 'auto';
            img.style.height = 'auto';
        } else {
            img.style.cursor = 'grab';
            img.style.maxWidth = '90vw';
            img.style.maxHeight = '80vh';
        }
    }

    function updateView() {
        scale = 1;
        offsetX = 0;
        offsetY = 0;
        img.src = cleanImageUrl(images[idx]);
        counter.textContent = (idx + 1) + ' / ' + images.length;
        applyTransform();
    }

    // ════ 鼠标滚轮缩放 ════
    img.addEventListener('wheel', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var delta = e.deltaY > 0 ? -0.1 : 0.1;
        var newScale = Math.max(minScale, Math.min(maxScale, scale + delta));
        newScale = Math.round(newScale * 10) / 10;
        scale = newScale;
        applyTransform();
    }, { passive: false });

    // ════ 拖拽平移 ════
    img.addEventListener('mousedown', function(e) {
        if (scale <= 1) return;
        e.preventDefault();
        isDragging = true;
        dragStartX = e.clientX - offsetX;
        dragStartY = e.clientY - offsetY;
        img.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        offsetX = e.clientX - dragStartX;
        offsetY = e.clientY - dragStartY;
        applyTransform();
    });
    document.addEventListener('mouseup', function() {
        isDragging = false;
        if (scale > 1) img.style.cursor = 'grabbing';
    });

    // 左右切换
    if (images.length > 1) {
        var prev = document.createElement('button');
        prev.textContent = '\u25c0';
        prev.style.cssText = 'position:absolute;left:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer;z-index:10000;';
        prev.addEventListener('click', function(e) { e.stopPropagation(); idx = (idx - 1 + images.length) % images.length; updateView(); });
        overlay.appendChild(prev);

        var next = document.createElement('button');
        next.textContent = '\u25b6';
        next.style.cssText = 'position:absolute;right:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer;z-index:10000;';
        next.addEventListener('click', function(e) { e.stopPropagation(); idx = (idx + 1) % images.length; updateView(); });
        overlay.appendChild(next);
    }

    // ════ 缩放按钮 ════
    var zoomInBtn = document.createElement('button');
    zoomInBtn.innerHTML = '+'; zoomInBtn.title = '放大';
    zoomInBtn.style.cssText = 'background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:4px 12px;font-size:16px;font-weight:bold;cursor:pointer;line-height:1;';
    zoomInBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        scale = Math.min(maxScale, Math.round((scale + 0.2) * 10) / 10);
        applyTransform();
    });
    actions.appendChild(zoomInBtn);

    var zoomOutBtn = document.createElement('button');
    zoomOutBtn.innerHTML = '\u2212'; zoomOutBtn.title = '缩小';
    zoomOutBtn.style.cssText = 'background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:4px 12px;font-size:16px;font-weight:bold;cursor:pointer;line-height:1;';
    zoomOutBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        scale = Math.max(minScale, Math.round((scale - 0.2) * 10) / 10);
        applyTransform();
    });
    actions.appendChild(zoomOutBtn);

    var resetBtn = document.createElement('button');
    resetBtn.textContent = '1:1'; resetBtn.title = '重置缩放';
    resetBtn.style.cssText = 'background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;';
    resetBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        scale = 1; offsetX = 0; offsetY = 0;
        applyTransform();
    });
    actions.appendChild(resetBtn);

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
    close.style.cssText = 'position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:36px;height:36px;font-size:18px;cursor:pointer;z-index:10000;';
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
        if (e.key === '+' || e.key === '=') { scale = Math.min(maxScale, Math.round((scale + 0.2) * 10) / 10); applyTransform(); }
        if (e.key === '-') { scale = Math.max(minScale, Math.round((scale - 0.2) * 10) / 10); applyTransform(); }
        if (e.key === '0') { scale = 1; offsetX = 0; offsetY = 0; applyTransform(); }
    }
    document.addEventListener('keydown', keyHandler);

    updateView();
    document.body.appendChild(overlay);
}

// ==================== 工具调用渲染 (Feature 3) ====================
/**
 * 创建可折叠的工具调用卡片
 * @param {string} toolName - 工具名称
 * @param {object} args - 调用参数
 * @param {object} result - 调用结果
 * @param {number} durationMs - 执行耗时(毫秒)
 * @returns {HTMLElement}
 */
function createToolCallCard(toolName, args, result, durationMs, execDetails) {
    var card = document.createElement('div');
    card.className = 'tool-call-card';

    var meta = (window.toolRegistry && toolRegistry.has(toolName)) ? toolRegistry.get(toolName) : null;
    var capHint = meta ? meta.capabilities.slice(0, 2).join(', ') : '';
    var toolHint = meta ? meta.searchHint : '';

    var typeIcons = {
        'web_search': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8a3 3 0 0 0-3 3"/></svg>',
        'web_fetch': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
        'server_exec': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
        'delegate_task': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
    };
    var iconHtml = typeIcons[toolName] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/></svg>';

    var summary = (meta && meta.getSummary) ? meta.getSummary(args) : (toolName + ': ' + JSON.stringify(args).substring(0, 60));

    var resultText = '';
    if (result) {
        if (typeof result === 'string') resultText = result;
        else if (result.result) resultText = result.result;
        else if (result.error) resultText = result.error;
        else if (result.output) resultText = result.output;
        else resultText = JSON.stringify(result).substring(0, 300);
    }

    var durationStr = '';
    if (durationMs !== undefined && durationMs !== null) {
        if (durationMs < 1000) durationStr = durationMs + 'ms';
        else if (durationMs < 60000) durationStr = (durationMs / 1000).toFixed(1) + 's';
        else durationStr = Math.floor(durationMs / 60000) + 'm ' + Math.floor((durationMs % 60000) / 1000) + 's';
    }

    var isError = result && result.error;
    var statusColor = isError ? '#ef4444' : (durationStr ? '#059669' : '#6366f1');
    var statusText = isError ? '失败' : '成功';

    var html = '<details class="tool-call-details">' +
        '<summary class="tool-call-summary" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 0;">' +
            '<span class="tool-call-icon" style="color:' + statusColor + ';flex-shrink:0;">' + iconHtml + '</span>' +
            '<span class="tool-call-name" style="font-weight:600;font-size:12px;">' + escapeHtml(toolName) + '</span>' +
            '<span style="font-size:11px;color:#9ca3af;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(summary) + '</span>' +
            (durationStr ? '<span style="font-size:10px;color:#6b7280;flex-shrink:0;">' + durationStr + '</span>' : '') +
            '<span style="font-size:10px;color:' + statusColor + ';flex-shrink:0;font-weight:500;">' + statusText + '</span>' +
            '<span class="tool-call-chevron" style="margin-left:4px;color:#9ca3af;flex-shrink:0;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></span>' +
        '</summary>' +
        '<div class="tool-call-body" style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:8px;font-size:11px;">';

    if (execDetails && execDetails.command) {
        html += '<details class="tool-exec-details" open>' +
            '<summary class="tool-exec-summary" style="cursor:pointer;font-weight:500;color:#374151;margin-bottom:4px;">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" style="vertical-align:middle;">' +
                '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg> ' + escapeHtml(execDetails.command) +
            '</summary>' +
            '<pre class="tool-exec-output" style="margin:4px 0 0 16px;padding:6px 8px;background:#1e1e2e;color:#cdd6f4;border-radius:6px;font-family:monospace;font-size:10px;line-height:1.5;max-height:200px;overflow-y:auto;">' +
            escapeHtml((execDetails.output || execDetails.error || '').substring(0, 5000)) + '</pre>' +
            (execDetails.exitCode !== undefined ? '<div style="margin:4px 0 0 16px;font-size:10px;color:' + (execDetails.exitCode === 0 ? '#059669' : '#ef4444') + ';">退出码: ' + execDetails.exitCode + '</div>' : '') +
            '</details>';
    }

    html += '<details class="tool-args-details" style="margin-top:4px;">' +
        '<summary class="tool-args-summary" style="cursor:pointer;font-size:10px;color:#9ca3af;">参数</summary>' +
        '<pre class="tool-call-args" style="margin:4px 0 0 16px;padding:6px;background:#f3f4f6;border-radius:4px;font-size:10px;max-height:120px;overflow:auto;">' + escapeHtml(JSON.stringify(args, null, 2).substring(0, 2000)) + '</pre>' +
        '</details>';

    if (resultText) {
        var displayResult = resultText.length > 500 ? resultText.substring(0, 500) : resultText;
        var isLongResult = resultText.length > 500;
        html += '<details class="tool-result-details" style="margin-top:4px;" ' + (isError ? 'open' : '') + '>' +
            '<summary class="tool-result-summary" style="cursor:pointer;font-size:10px;color:' + (isError ? '#ef4444' : '#059669') + ';">' + (isError ? '错误' : '结果') + (isLongResult ? ' (' + resultText.length + ' 字符)' : '') + '</summary>' +
            '<pre class="tool-call-result" style="margin:4px 0 0 16px;padding:6px;background:' + (isError ? '#fef2f2' : '#f0fdf4') + ';border-radius:4px;font-size:10px;max-height:200px;overflow:auto;white-space:pre-wrap;color:' + (isError ? '#dc2626' : '#374151') + ';">' + escapeHtml(displayResult) + '</pre>' +
            (isLongResult ? '<button onclick="this.previousElementSibling.textContent=' + JSON.stringify(escapeHtml(resultText.substring(0, 10000))) + ';this.remove()" style="margin:4px 0 0 16px;font-size:10px;color:#6366f1;border:none;background:none;cursor:pointer;">展开全部</button>' : '') +
            '</details>';
    }

    html += '</div></details>';
    card.innerHTML = html;
    return card;
}
function appendToolCallMessage(toolName, args, result, durationMs, chatId) {
    var card = createToolCallCard(toolName, args, result, durationMs);
    var container = $.chatMessagesContainer;
    if (!container) return;

    var row = document.createElement('div');
    row.className = 'message-row assistant tool-call-row';

    var avatar = document.createElement('div');
    avatar.className = 'avatar assistant';
    avatar.textContent = 'N';

    var wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';

    var bubble = document.createElement('div');
    bubble.className = 'bubble assistant tool-call-bubble';
    bubble.appendChild(card);

    wrapper.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(wrapper);
    container.appendChild(row);

    // 自动滚动
    if (isAutoScrolling) scrollToBottom();

    return row;
}

// ★ 渲染 web_fetch 访问的链接列表 - 放在气泡底部
function _renderWebFetchUrls(bubble, urls) {
    if (!bubble || !urls || !urls.length) return;
    if (bubble.querySelector('.webfetch-urls-container')) return;

    var container = document.createElement('div');
    container.className = 'webfetch-urls-container';
    container.style.cssText = 'margin-top:8px;border-top:1px solid #e5e7eb;padding-top:6px;';

    var summary = document.createElement('summary');
    summary.style.cssText = 'cursor:pointer;font-size:11px;color:#6b7280;user-select:none;';
    summary.textContent = '🌐 已抓取网页 (' + urls.length + ')';

    var details = document.createElement('details');
    details.style.cssText = 'font-size:11px;';
    details.appendChild(summary);

    var list = document.createElement('ol');
    list.style.cssText = 'margin:4px 0 0 0;padding-left:18px;list-style-position:outside;';

    urls.forEach(function(u, i) {
        var li = document.createElement('li');
        li.style.cssText = 'margin-bottom:2px;line-height:1.3;';
        var link = document.createElement('a');
        link.href = u;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.cssText = 'color:#3b82f6;text-decoration:none;font-size:11px;word-break:break-all;';
        link.textContent = u;
        li.appendChild(link);
        list.appendChild(li);
    });

    details.appendChild(list);
    container.appendChild(details);
    bubble.appendChild(container);
}

function appendMessage(role, text, files = null, reasoning = null, usage = null, time = 0, isLast = false, generatedImage = null, generatedImages = null) {
    // ★ 防御性清理:确保参数都是字符串且不含 [object Object]
    const safeStr = (val) => {
        if (val === null || val === undefined) return '';
        if (typeof val !== 'string') val = String(val);
        return val.replace(/\[object Object\]/gi, '');
    };
    text = safeStr(text);
    reasoning = typeof reasoning === 'string' ? reasoning.replace(/\[object Object\]/gi, '') : '';
    // ★ 如果已有独立显示的生成图片,去除回复文本中对应的图片链接(避免重复和点击跳转报错)
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

    // 思考过程 (Feature 3: 可折叠推理过程)
    if (role === 'assistant' && reasoning) {
        const details = document.createElement('details');
        details.className = 'reasoning-details';
        // 默认折叠,如果推理内容较短(<200字)则展开
        var reasoningLen = (reasoning || '').length;
        details.open = reasoningLen < 200;
        var summaryText = '🤔 推理过程' + (reasoningLen >= 200 ? ' (' + reasoningLen + '字符)' : '');
        details.innerHTML = `<summary>${summaryText}</summary><div class="reasoning-content">${compressNewlines(reasoning, 2)}</div>`;
        bubble.appendChild(details);
    }

    // 用户文件
    if (role === 'user' && files?.length) {
        const fileList = document.createElement('div');
        fileList.className = 'file-list';
        files.forEach(f => {
            if (f.isVideo || (f.type && f.type.startsWith('video/')))  {
                var _vsrc = f.serverUrl || f.content || '';
                if (_vsrc && _vsrc.startsWith('/')) _vsrc = window.location.origin + _vsrc;
                if (_vsrc) {
                    var vid = document.createElement('video');
                    vid.controls = true;
                    vid.preload = 'metadata';
                    vid.style.cssText = 'max-width:100%;max-height:300px;border-radius:8px;margin-top:4px';
                    var src = document.createElement('source');
                    src.src = _vsrc;
                    src.type = f.type || 'video/mp4';
                    vid.appendChild(src);
                    fileList.appendChild(vid);
                }
            } else if (f.isImage || f.type?.startsWith('image/')) {
                var _isrc = f.serverUrl || f.content || '';
                if (_isrc && _isrc.startsWith('/')) _isrc = window.location.origin + _isrc;
                var img = document.createElement('img');
                img.className = 'file-image-preview';
                img.src = _isrc;
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
        // 将 Markdown 图片语法 ![]() 转为可点击链接(避免加载失效图片)
        display = display.replace(/!\[(.*?)\]\((.*?)\)/g, '[图片 $1]($2)');
        if (window.marked) {
            display = autoLinkURLs(display);
            // ★ 使用保护渲染: _protectMath → marked → _restoreMath (含 KaTeX)
            contentDiv.innerHTML = _renderMarkdownWithMath(display);
            // ★ 延迟Mermaid渲染(appendMessage自身有内联处理,不与_triggerPostRender冲突)
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
                var _toRender = contentDiv.querySelectorAll('.mermaid');
                // ★ 过滤已渲染的(.mermaid 内已有 svg 的跳过)
                _toRender = Array.from(_toRender).filter(function(d) { return !d.querySelector('svg'); });
                if (window.mermaid && _toRender.length > 0) {
                    requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                    // 检查容器是否仍在DOM中
                    if (!contentDiv.isConnected || !contentDiv.parentElement) return;
                    mermaid.run({
                        nodes: _toRender,
                        suppressErrors: true
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
        // ★ 修复: 动态读取气泡当前文本,而非闭包里初始的 text 变量
        var _bubbleText = bubble.querySelector('.markdown-body')?.textContent || bubble.textContent || text;
        copyMessageContent(_bubbleText);
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

    // 底部统计(改用SVG图标)
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
            // ★ 统一提取缓存命中信息,兼容多模型格式
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

    // 不在这里滚动,streaming 时会自然跟随

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
        // 静默 highlight.js 的安全警告(代码块中含 HTML 标签时触发,非真安全问题)
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
    const providerKeyId = SEARCH_PROVIDER_KEY_MAP[provider];
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
            url = `${SEARCH_PROXY}?engine=brave&${params}&type=${type}&key=${encodeURIComponent(apiKey)}`;
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
    } else if (provider === 'minimax') {
        // MiniMax 搜索通过服务器端 CLI 调用
        // MiniMax 搜索通过服务器端 CLI 调用,传 API Key(从聊天模型配置复用)
        var _mmxApiKey = (function(){
            var _k = localStorage.getItem('apiKeyMiniMax') || localStorage.getItem('baseApiKey') || '';
            try { return decrypt(_k) || _k; } catch(e) { return _k; }
        })();
        url = SERVER_API_BASE + '/engine_api.php?action=minimax_search&q=' + encodeURIComponent(query) + '&limit=' + max + '&api_key=' + encodeURIComponent(_mmxApiKey);
    } else {
        url = SEARCH_PROXY
            ? `${SEARCH_PROXY}?engine=duckduckgo&q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&_t=${t}${country ? '&kl=' + country : ''}`
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
    } else if (provider === 'minimax') {
        // MiniMax Search: { results: [{ title, link, snippet, date }] }
        if (data.results && Array.isArray(data.results)) {
            results.push(...data.results.slice(0, 5).map(r => ({
                title: r.title || '无标题',
                url: r.link || '',
                snippet: r.snippet || ''
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

    const TIMEOUT_MS = 300000;

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
    cleanupStreamState(chatId);  // ★ 清理RAF渲染循环
    delete isTypingMap[chatId];
    delete activeBubbleMap[chatId];
    // ★ 主代理空闲了,处理子代理通知队列
    if (window._agentNotifyQueue && window._agentNotifyQueue.length > 0 && typeof window._processAgentNotifyQueue === 'function') {
        setTimeout(function() { window._processAgentNotifyQueue(); }, 500);
    }
}

// 用户主动停止,设置用户停止标记
function stopGenerationForChat(chatId) {
    userAbortMap[chatId] = true; // 标记用户主动停止,不再重试
    cleanupStreamState(chatId);  // ★ 清理RAF渲染循环
    abortExistingRequest(chatId);
    // ★ 中断所有正在运行的工具调用
    if (window.__toolAbortControllers) {
        Object.keys(window.__toolAbortControllers).forEach(function(k) {
            if (k.startsWith(chatId)) {
                try { window.__toolAbortControllers[k].abort(); } catch(e) {}
                delete window.__toolAbortControllers[k];
            }
        });
    }
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
        var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];var pad=function(n){return n<10?'0'+n:n};var off=-Math.round(now.getTimezoneOffset()/60);var tz='GMT'+(off>=0?'+':'')+off;var ts=days[now.getDay()]+' '+now.getFullYear()+'-'+months[now.getMonth()]+'-'+pad(now.getDate())+' '+pad(now.getHours())+':'+pad(now.getMinutes())+':'+pad(now.getSeconds())+' '+tz;
        var timeContent = '[' + ts + '] 系统当前时间,回答时间相关问题时请以此为准。';
        return { role: 'system', content: timeContent, temporary: true };
    }
    return null;
}

function parseCommand(text) {
    if (!text) return null;
    var parts = text.split(/\s+/);
    var cmd = parts[0].toLowerCase();
    var rest = parts.slice(1).join(' ').trim();
    // 搜索类
    if (cmd === '/search' || cmd === '/s') return { type: 'command', cmd: 'force_search', query: rest, kind: 'web' };
    if (cmd === '/news') return { type: 'command', cmd: 'force_search', query: rest, kind: 'news' };
    if (cmd === '/image') return { type: 'command', cmd: 'force_search', query: rest, kind: 'images' };
    // 模式切换
    if (cmd === '/mode' || cmd === '/agent') {
        var m = (rest || 'agent').toLowerCase();
        if (['off','plan','agent','yolo'].indexOf(m) === -1) m = 'agent';
        return { type: 'command', cmd: 'set_mode', mode: m };
    }
    // 模型切换
    if (cmd === '/model') return { type: 'command', cmd: 'set_model', model: rest };
    // 对话管理
    if (cmd === '/clear') return { type: 'command', cmd: 'clear_chat' };
    if (cmd === '/compact') return { type: 'command', cmd: 'compact' };
    if (cmd === '/new') return { type: 'command', cmd: 'new_chat' };
    // 帮助
    if (cmd === '/help' || cmd === '/?') return { type: 'command', cmd: 'show_help' };
    // 系统
    if (cmd === '/config') return { type: 'command', cmd: 'open_config' };
    if (cmd === '/logout') return { type: 'command', cmd: 'logout' };
    // 重试
    if (cmd === '/retry') return { type: 'command', cmd: 'retry' };
    // 导出
    if (cmd === '/export') return { type: 'command', cmd: 'export_chat' };
    // 记忆
    if (cmd === '/remember') return { type: 'command', cmd: 'remember', content: rest };
    return null;
}

// ★ 处理 /slash 命令
function handleSlashCommand(cmd) {
    var modeLabels = { off:'已关闭', plan:'Plan 只读模式', agent:'Agent 交互模式', yolo:'YOLO 自动模式' };
    // ★ 异步包装 async 分支
    var _async = (async function() {
    if (cmd.cmd === 'set_mode') {
        setAgentMode(cmd.mode);
        showToast('已切换到 ' + (modeLabels[cmd.mode] || cmd.mode), 'success', 3000);
    } else if (cmd.cmd === 'set_model') {
        var sel = document.getElementById('modelSelect');
        if (!sel) return;
        var models = Array.from(sel.options).filter(function(o) { return o.value; });
        if (!cmd.model) {
            // 无参数: 显示模型列表供选择
            var list = models.slice(0, 15).map(function(o) { return o.value; }).join('\n');
            appendMessage('system', '📋 可用模型 (输入 /model <名称> 切换):\n' + list);
            return;
        }
        // 有参数: 模糊匹配
        var q = cmd.model.toLowerCase();
        var best = null; var bestScore = 0;
        models.forEach(function(o) {
            var v = o.value.toLowerCase();
            if (v === q) { best = o; bestScore = 999; }
            else if (v.indexOf(q) >= 0 && bestScore < 100) { var s = q.length / v.length; if (s > bestScore) { best = o; bestScore = s; } }
        });
        if (best) {
            sel.value = best.value;
            localStorage.setItem('model', best.value);
            var _p = getEl('baseUrlProvider')?.value || 'custom';
            localStorage.setItem('model_' + _p, best.value);
            var toast = showToast('已切换: ' + best.text, 'success', 3000);
        } else {
            var partials = models.filter(function(o) { return o.value.toLowerCase().indexOf(q) >= 0; });
            if (partials.length > 0) {
                appendMessage('system', '🔍 匹配结果 (输入完整名称切换):\n' + partials.map(function(o) { return o.value; }).join('\n'));
            } else {
                appendMessage('system', '❌ 未找到模型: ' + cmd.model);
            }
        }
    } else if (cmd.cmd === 'clear_chat') {
        var cid = currentChatId;
        if (cid && chats[cid]) {
            chats[cid].messages = [{ role: 'system', content: getVal('systemPrompt') || DEFAULT_CONFIG.system }];
            saveChats();
            // ★ 直接渲染欢迎页,不重新加载空消息列表
            var container = $.chatMessagesContainer;
            if (container) {
                container.innerHTML = '';
                showWelcome();
            }
            renderChatHistory();
        }
    } else if (cmd.cmd === 'new_chat') {
        createNewChat();
    } else if (cmd.cmd === 'compact') {
        compressContextIfNeeded();
    } else if (cmd.cmd === 'show_help') {
        var helpText = SLASH_COMMANDS.map(function(c) {
            return ' `/' + c.cmd + '`' + (c.args ? ' *' + c.args + '*' : '') + ' - ' + c.hint;
        }).join('\n');
        appendMessage('system', '## ⌨️ 命令列表\n' + helpText + '\n\n> 输入 `/` 可随时唤出命令面板');
    } else if (cmd.cmd === 'open_config') {
        toggleConfigPanel();
        showToast('已打开配置面板', 'info', 2000);
    } else if (cmd.cmd === 'logout') {
        if (confirm('确定退出登录?')) { logout(); }
    } else if (cmd.cmd === 'retry') {
        var cid = currentChatId;
        if (!cid || !chats[cid]) return;
        var msgs = chats[cid].messages;
        // 找到最后一条 assistant 消息,删除它,然后重新发送上一条 user 消息
        var lastAssistIdx = -1;
        for (var i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant' && !msgs[i].partial) { lastAssistIdx = i; break; }
        }
        if (lastAssistIdx >= 0) {
            // 找到这条 assistant 前面的最后一条 user
            var lastUserIdx = -1;
            for (var i = lastAssistIdx - 1; i >= 0; i--) {
                if (msgs[i].role === 'user') { lastUserIdx = i; break; }
            }
            if (lastUserIdx >= 0) {
                var userMsg = msgs[lastUserIdx];
                msgs.splice(lastAssistIdx);
                saveChats();
                renderChatHistory();
                sendMessage(true, userMsg.text, userMsg.files);
            }
        }
    } else if (cmd.cmd === 'export_chat') {
        var cid = currentChatId;
        if (!cid || !chats[cid]) return;
        var msgs = chats[cid].messages;
        var md = '# ' + (chats[cid].title || '对话') + '\n\n' + msgs.filter(function(m) { return m.role !== 'system' && !m.temporary && !m._internal; }).map(function(m) {
            var role = m.role === 'user' ? '🧑 用户' : '🤖 AI';
            return '## ' + role + '\n' + (m.text || m.content || '');
        }).join('\n\n---\n\n');
        var blob = new Blob([md], { type: 'text/markdown' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = (chats[cid].title || 'chat') + '.md';
        a.click();
        URL.revokeObjectURL(url);
        showToast('已导出为 Markdown', 'success', 2000);
    } else if (cmd.cmd === 'remember') {
        // /remember key: content
        var parts = (cmd.content || '').split(':');
        if (parts.length >= 2) {
            var key = parts[0].trim();
            var content = parts.slice(1).join(':').trim();
            if (key && content) {
                var token = localStorage.getItem('authToken');
                try {
                    var resp = await fetch('/oneapichat/memory_api.php?action=save_memory&token=' + encodeURIComponent(token), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: key, content: content })
                    });
                    var data = await resp.json();
                    if (data.success) {
                        window._loadCloudMemories();
                        showToast('已记住: ' + key, 'success', 2000);
                    } else {
                        showToast('保存失败', 'error');
                    }
                } catch(e) { showToast('保存失败', 'error'); }
            } else {
                appendMessage('system', '用法: /remember 键: 内容\n例: /remember user_name: 向奕侨');
            }
        } else {
            // 无参数: 显示已保存的记忆
            window.refreshMemoryList?.();
            var token2 = localStorage.getItem('authToken');
            try {
                var resp2 = await fetch('/oneapichat/memory_api.php?action=get_memories&token=' + encodeURIComponent(token2));
                var data2 = await resp2.json();
                if (data2.success && data2.memories.length > 0) {
                    var list = data2.memories.map(function(m) { return '- `' + m.key + '`: ' + m.content; }).join('\n');
                    appendMessage('system', '📝 已保存的记忆:\n' + list);
                } else {
                    appendMessage('system', '📝 暂无保存的记忆');
                }
            } catch(e) {}
            showToast('用法: /remember 键: 内容', 'info', 3000);
        }
    }
    })(); // end async wrapper
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

// ★ 缓存的结果注入: 在 buildApiMessages 后调用,将历史图片分析结果注入上下文
function injectCachedImageAnalyses(chatId, apiMessages) {
    try {
        if (!chatId || !chats[chatId] || !apiMessages || !apiMessages.length) return;
        var cache = chats[chatId].imageAnalyses;
        if (!cache || !cache.length) return;
        // 检查最近几条消息是否已经有图片分析上下文(避免重复注入)
        var recentContent = apiMessages.slice(-3).map(function(m) { return m.content || ''; }).join(' ');
        var pattern = /【图片\d+分析结果】|以下是对用户上传图片的自动分析结果|图片分析缓存/g;
        if (pattern.test(recentContent)) return;
        // 注入缓存
        var analysisText = '\n\n【图片分析缓存(历史)】以下是对用户之前上传图片的描述,如需引用请直接使用,无需重新分析:\n\n' +
            cache.map(function(a, idx) { return '【图片' + (idx + 1) + '】\n' + a; }).join('\n\n---\n\n');
        var sysIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
        if (sysIdx !== -1) {
            apiMessages[sysIdx].content += analysisText;
        } else {
            apiMessages.unshift({ role: 'system', content: analysisText });
        }
    } catch(e) {
        console.warn('[injectCachedImageAnalyses] 失败:', e.message);
    }
}

function buildApiMessages(chatId) {
    const apiMessagesUnfiltered = [];
    // ★ 提前声明,供后续原生视觉判断使用
    var _curModelName = (getVal('modelSelect') || '').toLowerCase();
    // 只检查当前消息是否包含图片,避免历史图片触发视觉模型
    const currentHasImage = pendingFiles.length > 0 && pendingFiles.some(f => f.isImage || f.type?.startsWith('image/')) || !!window.__currentMessageHasImages;

    // ★ 模型配置:根据模型类型决定 system 消息处理方式
    // MiniMax/部分模型不支持多条 system 消息,需要合并为一条
    var _needMergeSystem = false;
    var _curModelLower = (getVal('modelSelect') || '').toLowerCase();
    // MiniMax 系列:合并 system 消息
    if (_curModelLower.indexOf('minimax') !== -1) _needMergeSystem = true;
    // QwQ 等思考模型:合并 system 消息
    if (_curModelLower.indexOf('qwq') !== -1) _needMergeSystem = true;
    if (_needMergeSystem) {
        const sysMsgs = [];
        for (const msg of chats[chatId].messages) {
            if (msg.role === 'system' && !msg.temporary) {
                sysMsgs.push(msg.content);
            }
        }
        const merged = sysMsgs.length > 0 ? sysMsgs.join('\n\n') : (getVal('systemPrompt') || DEFAULT_CONFIG.system);
        apiMessagesUnfiltered.push({ role: 'system', content: merged });
    } else {
        for (const msg of chats[chatId].messages) {
            if (msg.role === 'system' && !msg.temporary) {
                apiMessagesUnfiltered.push({ role: 'system', content: msg.content });
            }
        }

        if (apiMessagesUnfiltered.length === 0) {
            var defaultSystemContent = getVal('systemPrompt') || DEFAULT_CONFIG.system;
            apiMessagesUnfiltered.push({ role: 'system', content: defaultSystemContent });
            if (!chats[chatId].messages.some(m => m.role === 'system' && !m.temporary)) {
                chats[chatId].messages.unshift({ role: 'system', content: defaultSystemContent });
            }
        }

        // ★ 注入子代理推送消息到 system context (不显示在聊天界面)
        if (chats[chatId]._agentMessages && chats[chatId]._agentMessages.length > 0) {
            var _agentCtx = '## 子代理推送消息\n' + chats[chatId]._agentMessages.slice(-10).map(function(m) {
                return '[' + new Date(m.time).toLocaleTimeString('zh-CN') + '] ' + (m.source ? '(' + m.source + ') ' : '') + m.text;
            }).join('\n');
            var sysIdx = apiMessagesUnfiltered.findIndex(function(m) { return m.role === 'system'; });
            if (sysIdx >= 0) {
                apiMessagesUnfiltered[sysIdx].content = apiMessagesUnfiltered[sysIdx].content + '\n\n' + _agentCtx;
            }
        }
    }

    // ★ 修复: 统一清理消息内容中的 [object Object] 残留
    // ★ 注入工具调用上限到 system prompt
    var _maxRoundsAll = parseInt(localStorage.getItem('agentMaxToolRounds')) || 50;
    var _toolLimitHint = '\n\n## 工具调用限制\n本轮对话最多调用 ' + _maxRoundsAll + ' 次工具。请合理规划调用次数。如果接近上限,请优先给出已有结果而不是继续调用。';
    var _sysIdx = apiMessagesUnfiltered.findIndex(function(m) { return m.role === 'system'; });
    if (_sysIdx >= 0) {
        apiMessagesUnfiltered[_sysIdx].content += _toolLimitHint;
    }



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
        // ★ 跳过内部消息(不发送给 API,仅用于内部逻辑)
        if (msg._internal) continue;
        if (msg.role === 'system') continue;
        if (msg.role === 'user') {
            const files = msg.files;
            // ★ 所有带图片的用户消息都传递 image_url,确保后续追问也能看到图片
            var msgHasImage = files && files.length > 0 && files.some(function(f) { return f.isImage || (f.type && f.type.startsWith('image/')); });
            var prev = window._forceVisionFormat;
            if (msgHasImage || (i === msgs.length - 1 && currentHasImage)) {
                window._forceVisionFormat = true;
            }
            apiMessagesUnfiltered.push({ role: 'user', content: buildUserContent(msg.text, files) });
            window._forceVisionFormat = prev;
        } else if (msg.role === 'assistant' && !msg.partial) {
            apiMessagesUnfiltered.push({ role: 'assistant', content: cleanObjectObject(msg.content) || '(empty)' });
        } else if (msg.temporary) {
            // ★ 模型适配: 部分模型不支持过多 system 消息,将临时消息合并到最近的非 system 消息
            // MiniMax/QwQ 等:系统消息支持有限
            var _needMergeTemp = _needMergeSystem;
            if (_needMergeTemp) {
                // 找到前面最近的非 system 消息,追加内容
                let lastIdx = apiMessagesUnfiltered.length - 1;
                if (lastIdx >= 0 && apiMessagesUnfiltered[lastIdx].role !== 'system') {
                    apiMessagesUnfiltered[lastIdx].content += '\n\n' + (cleanObjectObject(msg.content) || '');
                } else {
                    apiMessagesUnfiltered.push({ role: 'user', content: cleanObjectObject(msg.content) || '(empty)' });
                }
            } else {
                apiMessagesUnfiltered.push({ role: msg.role, content: cleanObjectObject(msg.content) || '(empty)' });
            }
        }
    }

    // 只有当前消息有图片时才使用视觉模型
    if (currentHasImage) {
        apiMessagesUnfiltered._useVisionModel = true;
    }

    // ★ 最终安全过滤: 移除任何 content 为空/null/undefined/非字符串 的消息
    var filtered = {};
    var apiMessages = [];
    for (var _fi = 0; _fi < apiMessagesUnfiltered.length; _fi++) {
        var _m = apiMessagesUnfiltered[_fi];
        if (!_m || !_m.role) { console.log('[buildApiMessages] 跳过无效消息', _fi, _m); continue; }
        if (_m.content === undefined || _m.content === null) { console.log('[buildApiMessages] 跳过空content', _fi, _m.role); continue; }
        // content 可能是字符串或数组 (多模态)
        if (typeof _m.content === 'string' && _m.content.length === 0) { console.log('[buildApiMessages] 跳过空字符串', _fi, _m.role); continue; }
        apiMessages.push(_m);
    }
    return apiMessages;
}

function adjustMaxTokens(model, requestedTokens, estimated) {
    // ★ 优先使用模型配置中的上下文长度和安全余量
    var _cfgSafety = _getModelCfg().getSafetyMargin(model);
    var _safetyMargin = _cfgSafety || MAX_TOKENS_SAFETY_MARGIN;
    var _cfgCtx = _getModelCfg().getContextWindow(model);
    var maxContext = modelContextLength[model] || _cfgCtx || 131072;
    var _cfgMaxOut = _getModelCfg().getMaxOutputTokens(model);
    var maxOutput = modelMaxOutputTokens[model] || _cfgMaxOut || maxContext;
    var maxAllowed = maxContext - estimated - _safetyMargin;
    if (maxAllowed < 256) return null;
    return Math.min(requestedTokens, maxAllowed, maxOutput);
}


// ★ 后端 SSE 处理器:接收 SSE 流式事件,转换为 streamResponse 兼容格式
// SSE 格式: "event: TYPE\ndata: JSON\n\n"
// 解析时需要识别 "event:" 行来确定事件类型
window._backendSSEHandler = async function(sseResponse, chatId, pendingMsg, msgId) {
    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType = 'chunk';
    let fullText = '';
    let reasoningText = '';
    let toolCalls = [];
    let usage = null;
    let finished = false;

    // 定期保存到 localStorage._savedPartial(防刷新丢失)
    if (pendingMsg._streamSaveTimer) clearInterval(pendingMsg._streamSaveTimer);
    pendingMsg._streamSaveTimer = setInterval(function() {
        if (fullText || reasoningText) {
            try {
                localStorage.setItem('_savedPartial', JSON.stringify({
                    chatId: chatId, msgId: msgId,
                    content: fullText, reasoning: reasoningText,
                    time: Date.now()
                }));
            } catch(e) {}
        }
    }, 2000);

    while (!finished) {
        let readResult;
        try {
            readResult = await reader.read();
        } catch(e) { break; }
        const { done, value } = readResult;
        if (value) buffer += decoder.decode(value, { stream: true });
        if (done) { finished = true; }

        // 处理 SSE 数据:SSE 格式为 "event: TYPE\ndata: JSON\n\n"
        // 每条消息由 "event:xxx\ndata:xxx\n\n" 组成,lines 会包含多行
        const lines = buffer.split('\n');
        // 最后一行是可能不完整的下一条消息,保留在 buffer
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;

            // 检测 "event: TYPE" 行 - 设置当前事件类型
            if (line.startsWith('event: ')) {
                currentEventType = line.substring(6).trim();
                continue;
            }

            // 检测 "data: JSON" 行 - 用当前事件类型解析
            if (!line.startsWith('data: ')) continue;
            const dataStr = line.substring(6).trim();
            if (!dataStr || dataStr === '[DONE]') continue;

            try {
                const event = JSON.parse(dataStr);

                if (currentEventType === 'content' || event.type === 'content') {
                    const delta = event.delta || event.content || '';
                    if (delta) {
                        fullText += delta;
                        applyStreamRender(chatId, fullText);
                    }
                } else if (currentEventType === 'reasoning' || event.type === 'reasoning') {
                    const rd = event.delta || event.reasoning || '';
                    if (rd) {
                        reasoningText += rd;
                        var cb = activeBubbleMap[chatId];
                        if (cb) {
                            var det = cb.querySelector('details.reasoning-details');
                            if (!det) {
                                det = document.createElement('details');
                                det.className = 'reasoning-details';
                                det.open = true;
                                det.innerHTML = '<summary>深度思考</summary><div class="reasoning-content"></div>';
                                var mb2 = cb.querySelector('.markdown-body');
                                if (mb2) cb.insertBefore(det, mb2);
                            }
                            det.querySelector('.reasoning-content').textContent = reasoningText;
                            // 思考增长直接强制跟底(绕过 autoScrollToBottom 的距离阈值)
                            requestAnimationFrame(function() {
                                if ($.chatBox && !userScrolled) {
                                    $.chatBox.scrollTop = $.chatBox.scrollHeight;
                                }
                            });
                        }
                    }
                } else if (currentEventType === 'tool_call' || event.type === 'tool_call') {
                    if (event.delta && event.delta.function) {
                        // ★ 修复: 增量合并 tool_calls delta
                        var _tcFunc = event.delta.function;
                        var _existingTC = null;
                        if (event.delta.index !== undefined) {
                            _existingTC = toolCalls.find(function(t) { return t.index === event.delta.index; });
                        }
                        if (_existingTC) {
                            if (_tcFunc.name) _existingTC.function.name = _tcFunc.name;
                            if (_tcFunc.arguments) _existingTC.function.arguments += _tcFunc.arguments;
                        } else {
                            toolCalls.push(event.delta);
                        }
                    } else if (event.function || event.name) {
                        // 完整工具调用格式
                        toolCalls.push(event);
                    }
                    // 工具调用出现时直接强制跟底
                    requestAnimationFrame(function() {
                        if ($.chatBox && !userScrolled) {
                            $.chatBox.scrollTop = $.chatBox.scrollHeight;
                        }
                    });
                } else if (currentEventType === 'done' || event.type === 'done') {
                    if (event.tool_calls) toolCalls = event.tool_calls;
                    if (event.usage) usage = event.usage;
                    finished = true;
                } else if (currentEventType === 'error' || event.type === 'error') {
                    console.error('[SSE] error:', event.error);
                    finished = true;
                    // ★ 错误时也保留已输出的内容,不要留空气泡
                    if (fullText && pendingMsg) {
                        pendingMsg.content = fullText;
                        pendingMsg.reasoning = reasoningText;
                        delete pendingMsg.partial;
                    }
                } else if (currentEventType === 'start') {
                    console.log('[SSE] stream started, msg_id:', event.msg_id);
                }
            } catch(e) { console.warn('[SSE] parse error:', e.message, 'line:', line.slice(0, 80)); }
        }
        if (done) {
            // 处理 buffer 中剩余的不完整数据(理论上应该为空)
            if (buffer.trim()) {
                console.log('[SSE] done, buffer remains:', buffer.slice(0, 100));
            }
            break;
        }
    }

    // 清理 timer + RAF 流渲染状态
    if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
    cleanupStreamState(chatId);

    // 清理 savedPartial 和 msg_id 标记
    try { localStorage.removeItem('_savedPartial'); } catch(e) {}
    try { localStorage.removeItem('_lastStreamMsgId_' + chatId); } catch(e) {}

    return { fullText, reasoningText, usage, toolCalls };
};

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
    // ★ 流式内容定期保存到 localStorage(防止刷新丢失)
    // 把 timer 挂在 pendingMsg 上,方便外部清理
    if (pendingMsg._streamSaveTimer) clearInterval(pendingMsg._streamSaveTimer);
    pendingMsg._streamSaveTimer = setInterval(function() {
        if (pendingMsg.content || pendingMsg.reasoning) {
            try {
                localStorage.setItem('_savedPartial', JSON.stringify({
                    chatId: chatId,
                    content: pendingMsg.content || '',
                    reasoning: pendingMsg.reasoning || '',
                    time: Date.now()
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
                        // content为空但reasoning有内容时,使用reasoning作为显示内容
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
            // Done分支: 对fullText做最后一次思考标签清理(避免流式结束后的残留)
            if (fullText) {
                var _dAllThink = '';
                var _dTmp = fullText;
                // 格式1: <think>...</think> (Ollama deepseek-r1 等)
                var _dThink = fullText;
                var _dMt = _dThink.match(/<think>([\s\S]*?)<\/think>/g);
                if (_dMt) {
                    for (var _di = 0; _di < _dMt.length; _di++) {
                        _dAllThink += _dMt[_di].replace(/<\/?think>/g, '');
                    }
                    fullText = fullText.replace(/<think>[\s\S]*?<\/think>/g, '');
                }
                // 格式2: MiniMax (think)...(endthink)
                var _dMatchThink2 = _dTmp.match(/\(think\)([\s\S]*?)(?:\(endthink\)|$)/g);
                if (_dMatchThink2) {
                    for (var _dmi = 0; _dmi < _dMatchThink2.length; _dmi++) {
                        _dAllThink += _dMatchThink2[_dmi].replace(/\(endthink\)/g, '').replace(/\(think\)/g, '');
                    }
                    fullText = fullText.replace(/\(think\)[\s\S]*?(?:\(endthink\)|$)/g, '').replace(/\(think\)\s*/g, '');
                }
                if (_dAllThink.trim() && !reasoningText) {
                    reasoningText = _dAllThink.trim();
                }
                // ★ 确保 pendingMsg.reasoning 与最终 reasoningText 同步
                if (reasoningText && reasoningText !== pendingMsg.reasoning) {
                    pendingMsg.reasoning = reasoningText;
                }
            }
            console.log('[STREAM] Done, final fullText:', fullText?.length, 'bytes');
            // 残留buffer原始内容(前200字节)
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
                    // MiniMax 返回 { role: "", reasoning_content: "" } 的空chunk,不包含有效内容
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
                                // ★ 重置 toolCallCompleted 标志,以支持多工具调用
                                toolCallCompleted = false;
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
                                }
                                currentToolCall = null;
                            }
                            if (!currentToolCall) {
                                // ★ 重点: 新的tool_call开始时重置 completed 标志
                                // 因为同一个流中可能有多个连续的 tool_call 序列(DS V4 重放后跟新tool_call)
                                var _prevTCId = currentToolCall ? currentToolCall.id : null;
                                if (tc.id && _prevTCId && tc.id !== _prevTCId) {
                                    toolCallCompleted = false;
                                }
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

                        // ★ 修复: 同一个 chunk 中可能同时包含 tool_calls 和 reasoning_content
                        // 不要直接 continue,先检查是否有 reasoning_content 需要处理
                        var _tcHasReasoning = (delta.reasoning_content !== undefined && delta.reasoning_content !== null && delta.reasoning_content !== '');
                        var _tcHasReasoningDetails = delta.reasoning_details && Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0;
                        if (!_tcHasReasoning && !_tcHasReasoningDetails) {
                            continue;
                        }
                    }

                    // 工具调用中的content(如果有)
                    if (inToolCall && delta.content !== undefined && delta.content !== null) {
                        toolCallContent += delta.content;
                        continue;
                    }

                    // 工具调用结束 - 只在明确没有tool_calls且没有reasoning时结束
                    if (inToolCall && !(delta.tool_calls && delta.tool_calls.length > 0) && currentToolCall && delta.content === undefined && delta.reasoning_content === undefined && !(delta.reasoning_details && delta.reasoning_details.length)) {
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
                        // ★ 思考内容滚动追踪 - RAF节流,避免每token都触发scroll
                        if (!userScrolled) {
                            var _now2 = performance.now();
                            if (!window._lastThinkingScroll || _now2 - window._lastThinkingScroll > 32) {
                                window._lastThinkingScroll = _now2;
                                $.chatBox.scrollTop = $.chatBox.scrollHeight;
                            }
                        }
                        // 无延迟: 立即渲染
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
                        // ★ 思考内容滚动追踪 - RAF节流
                        if (!userScrolled) {
                            var _now3 = performance.now();
                            if (!window._lastThinkingScroll || _now3 - window._lastThinkingScroll > 32) {
                                window._lastThinkingScroll = _now3;
                                $.chatBox.scrollTop = $.chatBox.scrollHeight;
                            }
                        }
                    }

                    const rawContent = delta.content ?? delta.text ?? delta.message?.content;
                    // 处理各种可能的数据类型,避免对象被错误地转为 [object Object]
                    let textContent = null;
                    if (rawContent !== undefined && rawContent !== null) {
                        if (typeof rawContent === 'string') {
                            textContent = rawContent;
                        } else if (typeof rawContent === 'object' && rawContent !== null) {
                            // ★ 修复: 不用 || 链式取值(空字符串 "" 是 falsy,会让 || 跳到下一项对象)
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
                        // ★ 如果模型已经通过 reasoning_content 提供了思考(如 llama.cpp deepseek format),
                        //   则 content 中不应再包含 <think> 标签,将它们剥离避免重复显示
                        if (reasoningText && textContent.includes('<think>')) {
                            textContent = textContent.replace(/<think>([\s\S]*?)(?:<\/think>|$)/g, '').replace(/<\/think>/g, '').trim();
                            if (!textContent) continue;
                        }
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
                        // ★ 如果正文为空但思考有内容,不显示原始 (think) 标签
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
                                // 流式渲染正文: 统一走节流管道
                                var _renderText = typeof _t !== 'undefined' ? _t : fullText;
                                applyStreamRender(chatId, _renderText);
                                // AI流式回复时,如果用户没有主动滚动上查,则跟随滚动
                                var _isFirstContent = !window._streamContentRendered;
                                if (_isFirstContent) {
                                    window._streamContentRendered = true;
                                }
                                if (!userScrolled) {
                                    $.chatBox.scrollTop = $.chatBox.scrollHeight;
                                }
                            }
                        }
                    // 无延迟: 立即渲染
                    }

                    if (data.usage) usage = data.usage;
                } catch (e) {
                    parseErrors++;
                    console.warn('[流式解析错误]', line?.slice(0, 100), e.message);
                }
            }
        }
    }

    // ★ 修复: 保存最后一个tool_call(去重)
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
            } else {
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
                    var quoteCount = (fixedStr.match(/"/g) || []).length;
                    if (quoteCount % 2 !== 0) fixedStr += '"';
                    var openBraces = (fixedStr.match(/\{/g) || []).length;
                    var closeBraces = (fixedStr.match(/\}/g) || []).length;
                    while (closeBraces < openBraces) { fixedStr += '}'; closeBraces++; }

                    try {
                        currentToolCall.function.arguments = JSON.parse(fixedStr);
                    } catch (e2) {
                        var firstBrace = argsStr.indexOf('{');
                        var lastBrace = argsStr.lastIndexOf('}');
                        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                            var firstJson = argsStr.substring(firstBrace, lastBrace + 1);
                            try {
                                currentToolCall.function.arguments = JSON.parse(firstJson);
                            } catch (e3) {
                                currentToolCall.function.arguments = { query: argsStr };
                            }
                        } else {
                            currentToolCall.function.arguments = { query: argsStr };
                        }
                    }
                }
                // ★ 去重: 检查是否已存在于 toolCalls 中
                var _tcName = currentToolCall.function?.name;
                var _tcArgs = typeof currentToolCall.function?.arguments === 'object' ? JSON.stringify(currentToolCall.function.arguments) : String(currentToolCall.function?.arguments || '');
                var _isDuplicate = toolCalls.some(function(existingTc) {
                    return existingTc.function?.name === _tcName &&
                           JSON.stringify(existingTc.function?.arguments) === _tcArgs;
                });
                if (!_isDuplicate) {
                    toolCalls.push(currentToolCall);
                }
            }
        }
    }

    // ★ 全局去重: 移除同名同参数的重复 tool_calls
    if (toolCalls.length > 1) {
        var _uniqueTCs = [];
        var _seen = {};
        for (var _tci = 0; _tci < toolCalls.length; _tci++) {
            var _tcItem = toolCalls[_tci];
            var _tcKey = (_tcItem.function?.name || '') + '|' + JSON.stringify(_tcItem.function?.arguments || {});
            if (!_seen[_tcKey]) {
                _seen[_tcKey] = true;
                _uniqueTCs.push(_tcItem);
            }
        }
        if (_uniqueTCs.length < toolCalls.length) {
            console.log('[去重]', 'toolCalls', toolCalls.length, '→', _uniqueTCs.length);
            toolCalls = _uniqueTCs;
        }
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
    // ★ 流式已经实时渲染了数学公式,不需要再次渲染
    // ★ 流结束时,如果 pendingMsg 中有生成的图片,渲染到气泡
    if (currentChatId === chatId) {
        var _streamBubble = activeBubbleMap[chatId];
        if (_streamBubble && pendingMsg.generatedImages && pendingMsg.generatedImages.length > 0) {
            if (!_streamBubble.querySelector('.generated-images-container')) {
                var _imgContStream = document.createElement('div');
                _imgContStream.className = 'generated-images-container';
                _imgContStream.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
                _streamBubble.appendChild(_imgContStream);
                // ★ 异步渲染每张图片,避免大批 base64 阻塞主线程
                pendingMsg.generatedImages.forEach(function(_imgData, _idx) {
                    setTimeout(function() {
                        var _wrapStream = document.createElement('div');
                        _wrapStream.style.cssText = 'position:relative;cursor:pointer;';
                        var _imgElStream = document.createElement('img');
                        _imgElStream.src = _imgData;
                        _imgElStream.decoding = 'async';
                        _imgElStream.style.cssText = 'max-width:' + (pendingMsg.generatedImages.length > 1 ? '160px' : '320px') + ';width:100%;border-radius:8px;display:block;';
                        _imgElStream.setAttribute('loading', 'lazy');
                        _imgElStream.addEventListener('click', function() { showImageLightbox(pendingMsg.generatedImages, _idx); });
                        _wrapStream.appendChild(_imgElStream);
                        _imgContStream.appendChild(_wrapStream);
                    }, _idx * 50); // 每张间隔50ms,给主线程喘息
                });
            }
        }
    }
    // 有思考但无正文:确保气泡有内容显示(思考已在折叠框,这里只确保气泡不空)
    if (!fullText && reasoningText) {
        pendingMsg.content = reasoningText;
    }

    // ★ MiniMax/模型兼容: 从 content 中解析文本格式的工具调用
    // 支持三种格式: <minimax:tool_call> XML, [TOOL_CALL] 括号格式
    if (!toolCalls.length && fullText && (fullText.includes('<minimax:tool_call>') || fullText.includes('[TOOL_CALL]'))) {
        console.log('[ToolCall] 检测到文本格式工具调用,开始解析...');

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
        console.log('[ToolCall非流式] 检测到文本格式工具调用,开始解析...');

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
    // 兜底确保 reasoningText 是字符串(不再覆盖上面的提取结果)
    if (!reasoningText) {
        const rc = msg.reasoning_content ?? msg.reasoning;
        if (rc !== null && rc !== undefined) reasoningText = String(rc);
    }
    if (typeof reasoningText !== 'string') reasoningText = '';

    // ★ 从 fullText 中提取思考和推理内容
    var _ht = fullText;
    var _htAllThink = '';
    // 格式1: 标准HTML <think>...</think> 标签 (Ollama deepseek-r1/qwq 等本地模型)
    var _htMatchesThink = _ht.match(/<think>([\s\S]*?)<\/think>/g);
    if (_htMatchesThink) {
        for (var _hti1 = 0; _hti1 < _htMatchesThink.length; _hti1++) {
            _htAllThink += _htMatchesThink[_hti1].replace(/<\/?think>/g, '');
        }
        fullText = fullText.replace(/<think>[\s\S]*?<\/think>/g, '');
    }
    // 格式2: MiniMax (think)...(endthink)
    var _htMatches2 = _ht.match(/\(think\)([\s\S]*?)(?:\(endthink\)|$)/g);
    if (_htMatches2) {
        for (var _hti2 = 0; _hti2 < _htMatches2.length; _hti2++) {
            _htAllThink += _htMatches2[_hti2].replace(/\(endthink\)/g, '').replace(/\(think\)/g, '');
        }
        fullText = fullText.replace(/\(think\)[\s\S]*?(?:\(endthink\)|$)/g, '').replace(/\(think\)\s*/g, '');
    }
    if (_htAllThink.trim() && !reasoningText) {
        reasoningText = _htAllThink.trim();
    }
    // ★ 流结束: 取消未执行的节流渲染,直接用最终内容
    if (_streamRenderTimer[chatId]) { clearTimeout(_streamRenderTimer[chatId]); _streamRenderTimer[chatId] = null; }

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
                _triggerPostRender(contentEl);
            }
            // ★ 流式完成:添加操作按钮(复制+重新生成)
            if (!currentBubble.querySelector('.msg-actions')) {
                var _aDiv = document.createElement('div');
                _aDiv.className = 'msg-actions';
                // 复制按钮
                var _copyB = document.createElement('div');
                _copyB.className = 'msg-action-btn copy-msg-btn';
                _copyB.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
                _copyB.onclick = function(e2) { e2.stopPropagation(); copyMessageContent(fullText); };
                _aDiv.appendChild(_copyB);
                // 重新生成按钮
                var _rB = document.createElement('div');
                _rB.className = 'msg-action-btn regenerate-btn';
                _rB.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
                _rB.onclick = function(e2) { e2.stopPropagation(); window.regenLastAssistant(fullText); };
                _aDiv.appendChild(_rB);
                currentBubble.appendChild(_aDiv);
            }
            // ★ 流式完成:滚到底部(图表可能已延迟渲染导致高度变化)
            setTimeout(function _scrollAfterRender() {
                if (!userScrolled) $.chatBox.scrollTop = $.chatBox.scrollHeight;
            }, 200);
            // ★ 非流式响应完成:如果有生成的图片,渲染到气泡
            if (pendingMsg.generatedImages && pendingMsg.generatedImages.length > 0 && !currentBubble.querySelector('.generated-images-container')) {
                var _imgContNs = document.createElement('div');
                _imgContNs.className = 'generated-images-container';
                _imgContNs.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
                currentBubble.appendChild(_imgContNs);
                // ★ 异步渲染每张图片
                pendingMsg.generatedImages.forEach(function(_imgData, _idx) {
                    setTimeout(function() {
                        var _wrapNs = document.createElement('div');
                        _wrapNs.style.cssText = 'position:relative;cursor:pointer;';
                        var _imgElNs = document.createElement('img');
                        _imgElNs.src = _imgData;
                        _imgElNs.decoding = 'async';
                        _imgElNs.style.cssText = 'max-width:' + (pendingMsg.generatedImages.length > 1 ? '160px' : '320px') + ';width:100%;border-radius:8px;display:block;';
                        _imgElNs.setAttribute('loading', 'lazy');
                        _wrapNs.appendChild(_imgElNs);
                        _imgContNs.appendChild(_wrapNs);
                    }, _idx * 50);
                });
            }
        }
    }

    return { fullText, reasoningText, usage, toolCalls };
}

function handleError(e, chatId, pendingMsg, currentBubble) {
    // ★ 清除流式保存定时器 + RAF渲染循环
    if (pendingMsg && pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
    cleanupStreamState(chatId);
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
                    // ★ 自动重发(图片已由文本模型列表屏蔽,走 analyze_image 工具)
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
    // ★ 任务批次隔离:用户消息开启新批次,内部通知复用当前批次
    if (!skipUserAdd) {
        // 用户发起的消息 → 新任务批次开始,清空旧的子代理追踪
        window._currentGroupId = (window._currentGroupId || 0) + 1;
        window._activeSubAgentGroup = [];  // {name, groupId} 列表
        console.log('[Agent] 新任务批次开始,groupId=' + window._currentGroupId);
    }

    if (!rateLimit.allowed()) {
        showToast('请求过于频繁', 'warning');
        return;
    }

    // 检查模型是否还在加载
    var modelVal = getVal('modelSelect');
    if (!modelVal || modelVal === '加载中...') {
        // ★ 等待模型列表加载完成,最多等6秒
        var _waitModelStart = Date.now();
        var _modelLoaded = false;
        await new Promise(function(resolve) {
            var _check = function() {
                var _mv = getVal('modelSelect');
                if (_mv && _mv !== '加载中...') {
                    _modelLoaded = true;
                    resolve();
                    return;
                }
                if (Date.now() - _waitModelStart > 6000) {
                    resolve();
                    return;
                }
                setTimeout(_check, 200);
            };
            _check();
        });
        if (!_modelLoaded) {
            showToast('模型列表加载超时,请检查网络或API Key后重试', 'error', 5000);
            return;
        }
        modelVal = getVal('modelSelect');
    }

    const chatId = currentChatId;
    if (!chatId) return;
    if (isTypingMap[chatId]) {
        showToast('⏳ 正在生成中...', 'warning');
        return;
    }

    const input = $.userInput;
    let text = skipUserAdd ? userTextForRegen : input?.value.trim() || '';
    var files = skipUserAdd ? userFilesForRegen : pendingFiles;

    // ★ 新消息: 重置滚动状态 + 滚动到底部
    if (!skipUserAdd) { userScrolled = false; setTimeout(function() { if ($.chatBox) $.chatBox.scrollTop = $.chatBox.scrollHeight; }, 30); }

    // ★ 内部触发时 (skipUserAdd=true): text 可能为 null/undefined, 统一降级
    if (!text && skipUserAdd) { text = ''; }
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
    // ★ 发送消息时重置滚动状态,并锁定流式跟随
    userScrolled = false;
    streamingScrollLock = false;
    window._streamContentRendered = false;
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
    var command = parseCommand(text);
    if (command && command.type === 'command') {
        isTypingMap[chatId] = false;
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
        handleSlashCommand(command);
        input.value = '';
        return;
    }
    var forceSearch = !!command;
    var queryText = command ? command.query : text;
    var forcedType = command ? command.kind : null;

    // 构建历史摘要
    const historySummary = buildHistorySummary(chatId);

    // 添加用户消息
    // 保存当前消息是否包含图片(在 clearAllFiles 之前)
    const currentMessageHasImages = files && files.length > 0 && files.some(f => f.isImage || f.type?.startsWith('image/'));
    // ★ 保存标记供 buildApiMessages 使用(pendingFiles 即将被清空)
    window.__currentMessageHasImages = currentMessageHasImages;

    // 立即清空输入框,让用户知道消息已发送
    if (input) {
        input.value = '';
        window.autoResize(input);
    }

    // 如果有图片,不自动分析,让AI自主决定是否调用分析工具
    // 图片会作为附件发送给AI,AI可以自主选择是否使用 analyze_image 工具

    if (!skipUserAdd) {
        chats[chatId].messages.push({ role: 'user', text, files: files.map(f => ({ name: f.name, content: f.content, serverUrl: f.serverUrl || '', size: f.size, type: f.type || (f.isImage ? 'image/' : '') })) });
        // ★ 用户消息发出后立即保存,确保未开新会话时数据不丢
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
        // ★ 立即滚动到底部,让用户看到即将生成的回复位置
        setTimeout(function() { autoScrollToBottom('sendMessage'); }, 50);
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

    // ★ 非工具调用模式下:自动分析上传的图片并告诉模型
    // 当使用不支持工具的模型(如deepseek-r1)时,AI无法调用 analyze_image 工具
    // 因此需要在上游自动完成图片分析,将结果注入上下文
    if (currentMessageHasImages && !useToolCall) {
        var _allImageAnalyses = [];
        var _imageFiles = files ? files.filter(function(f) { return f.isImage || (f.type && f.type.startsWith('image/')); }) : [];
        // 也检查聊天记录中的图片
        if (!_imageFiles.length && chats[chatId]) {
            var _lastMsgs = chats[chatId].messages;
            for (var _imi = _lastMsgs.length - 1; _imi >= 0; _imi--) {
                var _m = _lastMsgs[_imi];
                if (_m.role === 'user' && _m.files && _m.files.length) {
                    _imageFiles = _m.files.filter(function(f) { return f.isImage || (f.type && f.type.startsWith('image/')); });
                    if (_imageFiles.length) break;
                }
            }
        }
        if (_imageFiles.length) {
            showToast('🔍 正在自动分析' + _imageFiles.length + '张图片...', 'info', 5000);
            if (currentBubble) {
                var _imgStatus = document.createElement('div');
                _imgStatus.className = 'search-status';
                _imgStatus.textContent = '🔍 自动分析' + _imageFiles.length + '张图片...';
                var _mb = currentBubble.querySelector('.markdown-body');
                if (_mb) _mb.appendChild(_imgStatus);
            }
            for (var _iai = 0; _iai < _imageFiles.length; _iai++) {
                var _imgFile = _imageFiles[_iai];
                var _imgInput = '';
                if (_imgFile.serverUrl && typeof _imgFile.serverUrl === 'string' && _imgFile.serverUrl.length > 0) {
                    _imgInput = _imgFile.serverUrl.startsWith('http') ? _imgFile.serverUrl : window.location.origin + _imgFile.serverUrl;
                } else {
                    _imgInput = _imgFile.content || '';
                }
                if (_imgInput) {
                    try {
                        var _analysis = await window.analyzeImage(_imgInput, '请详细描述这张图片的内容,包括物体、场景、文字等所有可见信息。');
                        if (_analysis && typeof _analysis === 'string' && _analysis.length > 10) {
                            _allImageAnalyses.push('【图片' + (_iai + 1) + '分析结果】\n' + _analysis);
                        }
                        if (currentBubble) {
                            var _st = currentBubble.querySelector('.search-status');
                            if (_st) _st.textContent = '✅ 已分析' + (_iai + 1) + '/' + _imageFiles.length + '张图片';
                        }
                    } catch(e) {
                        console.warn('[AutoAnalyze] 图片', _iai + 1, '分析失败:', e.message);
                        _allImageAnalyses.push('【图片' + (_iai + 1) + '】[分析失败: ' + e.message + ']');
                    }
                }
            }
            if (_allImageAnalyses.length) {
                var _analysisText = '\n\n以下是对用户上传图片的自动分析结果(AI无法直接看到图片,请根据以下描述回答):\n\n' + _allImageAnalyses.join('\n\n---\n\n');
                // 注入到最近的非 system 消息中
                var _sysIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
                if (_sysIdx !== -1) {
                    apiMessages[_sysIdx].content += _analysisText;
                } else {
                    apiMessages.unshift({ role: 'system', content: _analysisText });
                }
                // ★ 缓存到 chat 中,后续追问无需重新分析
                try {
                    if (!chats[chatId].imageAnalyses) chats[chatId].imageAnalyses = [];
                    for (var _cai = 0; _cai < _allImageAnalyses.length; _cai++) {
                        var _cacheEntry = _allImageAnalyses[_cai];
                        // 去重:检查是否已缓存过相同内容
                        if (chats[chatId].imageAnalyses.indexOf(_cacheEntry) === -1) {
                            chats[chatId].imageAnalyses.push(_cacheEntry);
                        }
                    }
                    if (chats[chatId].imageAnalyses.length > 50) {
                        chats[chatId].imageAnalyses = chats[chatId].imageAnalyses.slice(-30);
                    }
                    slimSaveChats();
                } catch(e) {
                    console.warn('[CacheImage] 缓存失败:', e.message);
                }
                if (currentBubble) {
                    var _st = currentBubble.querySelector('.search-status');
                    if (_st) _st.textContent = '✅ 图片分析完成(' + _imageFiles.length + '张)';
                }
                showToast('✅ 图片自动分析完成', 'success', 2000);
            }
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

    // ★ 注入历史图片分析缓存,避免模型重复调用 analyze_image 工具
    if (chats[chatId] && chats[chatId].imageAnalyses && chats[chatId].imageAnalyses.length > 0) {
        injectCachedImageAnalyses(chatId, apiMessages);
    }

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

    // ★ Agent 模式: 合并 agent 系统提示词 + 记忆/人格/身份信息
    if (isAgentToolsActive()) {
        var agentPrompt = localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt;
        // ★ 注入工具调用上限(模型一开始就知道最多调用几次)
        var _maxRounds = parseInt(localStorage.getItem('agentMaxToolRounds')) || 50;
        agentPrompt += '\n\n## 工具调用限制\n本轮对话最多调用 ' + _maxRounds + ' 次工具。请合理规划,避免浪费配额。如果接近上限,优先给出已有结果而不是继续调用。';
        if (agentPrompt) {
            // 追加到第一条 system 消息
            var sysIdx = apiMessages.findIndex(function(m) { return m.role === 'system'; });
            var sysContent = agentPrompt;
            // 尝试从内存缓存获取人格/身份/记忆并注入
            try {
                var _cachedPersona = window.__agentPersonaCache || window.__cloudPersona;
                var _cachedIdentity = window.__agentIdentityCache || window.__cloudIdentity;
                var _cachedUser = window.__cloudUser;
                var _cachedMemories = window.__agentMemoryCache;
                var _cloudMemories = window.__cloudMemories;
                var _inject = '';
                // 人格
                if (_cachedPersona && _cachedPersona.name) {
                    _inject += '\n\n## 人格设定\n- AI名称: ' + _cachedPersona.name + '\n';
                    if (_cachedPersona.style) _inject += '- 风格: ' + _cachedPersona.style + '\n';
                    if (_cachedPersona.emoji) _inject += '- 标志: ' + _cachedPersona.emoji + '\n';
                }
                // AI 身份
                if (_cachedIdentity) {
                    _inject += '\n## AI身份\n';
                    if (_cachedIdentity.name) _inject += '- 名称: ' + _cachedIdentity.name + '\n';
                    if (_cachedIdentity.style) _inject += '- 风格: ' + _cachedIdentity.style + '\n';
                    if (_cachedIdentity.emoji) _inject += '- 标志: ' + _cachedIdentity.emoji + '\n';
                }
                // 用户信息
                if (_cachedUser && (_cachedUser.name || _cachedUser.notes)) {
                    _inject += '\n## 用户信息\n';
                    if (_cachedUser.name) _inject += '- 称呼: ' + _cachedUser.name + '\n';
                    if (_cachedUser.notes) _inject += '- 备注: ' + _cachedUser.notes + '\n';
                }
                // 引擎记忆
                if (_cachedMemories && _cachedMemories.length > 0) {
                    _inject += '\n## 长期记忆\n';
                    var _mc = 0;
                    for (var _mi = 0; _mi < _cachedMemories.length && _mc < 15; _mi++) {
                        var _me = _cachedMemories[_mi];
                        if (_me && _me.key) {
                            _inject += '- [' + _me.key + '] ' + (_me.content || '') + '\n';
                            _mc++;
                        }
                    }
                }
                // 云端记忆 (memory_api.php)
                if (_cloudMemories && !_cachedMemories) {
                    _inject += '\n' + _cloudMemories;
                }
                if (_inject) sysContent += _inject;
            } catch(e) {
                console.warn('[AgentMemory] 注入缓存失败:', e);
            }
            if (sysIdx !== -1) {
                apiMessages[sysIdx].content = apiMessages[sysIdx].content + '\n\n' + sysContent;
            } else {
                apiMessages.unshift({ role: 'system', content: sysContent });
            }
        }
    }

    // ★ 内部 Agent 上下文注入(必须在 agent 提示词之后,确保覆盖创建子代理指令)
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
    // ★ 完全按用户配置,不按模型自动调整
    const requestedTokens = parseInt(getVal('maxTokens')) || 4096;

    // 构建请求体
    const body = {
        model,
        messages: apiMessages,
        stream: getChecked('streamToggle'),
        temperature: parseFloat(getVal('temperature')) || 0.7,
        max_tokens: requestedTokens
    };

    // 统一获取模型选择并转小写
    const currentModel = getVal('modelSelect') || '';
    const modelLower = currentModel.toLowerCase();

    // MiniMax M2: 启用 reasoning_split 以分离思考内容
    const isMiniMaxModel = modelLower.includes('minimax');
    // MiniMax M2: 默认使用<think>标签模式(不传reasoning_split以避免参数错误)

    // ★ Agent 模式: 始终启用工具调用
    var agentModeActive = isAgentToolsActive();
    var effectiveToolCall = useToolCall || currentMessageHasImages || agentModeActive;

    // ★ 终极检查: 模型在 no-tool 列表中就直接跳过整个工具注册
    var _noToolCheckList = JSON.parse(localStorage.getItem('noToolModels') || '[]');
    var _modelNameLC = modelLower;
    for (var _ntci = 0; _ntci < _noToolCheckList.length; _ntci++) {
        if (_modelNameLC.indexOf(_noToolCheckList[_ntci]) !== -1) {
            effectiveToolCall = false;
            console.log('[NoTool] 模型', model, '匹配 no-tool 列表,强制关闭工具调用');
            break;
        }
    }

    // 添加工具定义(使用提前保存的当前消息图片状态)
    if (effectiveToolCall) {
        // 只对支持视觉的模型添加图生图工具,文本模型无法处理图片参数
    // 图生图工具:所有模型都可使用,因为系统会自动获取用户上传的图片
    // 注意:generate_image_i2i 工具的参数 image 会由系统自动填充,不需要AI处理
    const i2iTool = IMAGE_I2I_TOOL_DEFINITION;

    // 构建工具列表
    const imageTools = [IMAGE_TOOL_DEFINITION, ANALYZE_IMAGE_TOOL];
    if (i2iTool) imageTools.push(i2iTool);
    imageTools.push(VIDEO_UNDERSTANDING_TOOL);
    imageTools.push(VIDEO_EDIT_TOOL);

    // 构建工具列表:根据搜索开关和工具模式动态选择
    const searchOn = getChecked('searchToggle');
    const toolMode = effectiveToolCall;
    if (toolMode) {
        // ★ 工具分类: A类(始终可用) | B类(Agent模式启用后额外可用) | C类(始终在列表中)
        var tools = [];

        // ===== A 类工具: 始终可用(无论是否 Agent 模式) =====
        // 搜索工具(受搜索开关控制)
        if (searchOn) {
            tools.push(SEARCH_TOOL_DEFINITION);
            tools.push(WEB_FETCH_TOOL_DEFINITION);
            if (window.RAG_ENABLED) tools.push(RAG_SEARCH_TOOL_DEFINITION);
        }
        // 图片工具: 原生多模态模型有图片时不注册 analyze_image,避免重复分析
        if (currentMessageHasImages && window.MODEL_CONFIGS && window.MODEL_CONFIGS.supportsVision(modelLower)) {
            tools.push(IMAGE_TOOL_DEFINITION);
            if (i2iTool) tools.push(i2iTool);
        } else {
            tools = tools.concat(imageTools);
        }
        // 文件读取/搜索(基础操作,不限制)
        tools.push(SERVER_FILE_READ_TOOL);
        tools.push(SERVER_FILE_SEARCH_TOOL);
        // ask_agent: 仅在普通模式下注册,AI通过此工具请求用户启用Agent模式
        // Agent模式/yolo模式下无需此工具
        if (!agentModeActive) {
            tools.push(ASK_AGENT_TOOL);
        }

        // ===== B 类工具: Agent 模式启用后额外可用 =====
        if (agentModeActive) {
            // RAG 搜索(仅当搜索关闭时加入,避免重复)
            if (!searchOn || !window.RAG_ENABLED) {
                if (window.RAG_ENABLED) tools.push(RAG_SEARCH_TOOL_DEFINITION);
                else if (!searchOn) tools.push(RAG_SEARCH_TOOL_DEFINITION);
            }
            // 服务器操控工具
            tools.push(SERVER_EXEC_TOOL);
            tools.push(SERVER_PYTHON_TOOL);
            tools.push(SERVER_FILE_WRITE_TOOL);
            tools.push(SERVER_FILE_OP_TOOL);
            tools.push(SERVER_SYS_INFO_TOOL);
            tools.push(SERVER_PS_TOOL);
            tools.push(SERVER_DISK_TOOL);
            tools.push(SERVER_NETWORK_TOOL);
            tools.push(SERVER_DOCKER_TOOL);
            tools.push(SERVER_DB_QUERY_TOOL);
            // 引擎/Agent工具
            tools.push(ENGINE_CRON_LIST_TOOL);
            tools.push(ENGINE_CRON_CREATE_TOOL);
            tools.push(ENGINE_CRON_DELETE_TOOL);
            tools.push(DELEGATE_TASK_TOOL);
            tools.push(ENGINE_AGENT_STATUS_TOOL);
            tools.push(ENGINE_AGENT_LIST_TOOL);
            tools.push(ENGINE_AGENT_DELETE_TOOL);
            tools.push(ENGINE_AGENT_ASK_TOOL);
            tools.push(ENGINE_PUSH_TOOL);
            // ===== 浏览器工具(Agent模式) =====
            tools.push(BROWSER_NAVIGATE_TOOL);
            tools.push(BROWSER_SCREENSHOT_TOOL);
            tools.push(BROWSER_CLICK_TOOL);
            tools.push(BROWSER_TYPE_TOOL);
            tools.push(BROWSER_GET_CONTENT_TOOL);
            tools.push(BROWSER_GET_SNAPSHOT_TOOL);
            // web_fetch 已在 searchOn 分支添加,此处不再重复
        }

        // ===== 刷课工具(始终注册,不受Agent模式影响) =====
        tools.push(CHAOXING_LOGIN_TOOL_DEFINITION);
        tools.push(CHAOXING_LIST_TOOL_DEFINITION);
        tools.push(CHAOXING_TOOL_DEFINITION);
        tools.push(CHAOXING_STATUS_TOOL_DEFINITION);
        tools.push(CHAOXING_STOP_TOOL_DEFINITION);
        tools.push(CHAOXING_STATS_TOOL_DEFINITION);
        tools.push(CHAOXING_OVERVIEW_TOOL);
        tools.push(CHAOXING_AUTH_TOOL);
        tools.push(CHAOXING_EXAM_LIST_TOOL);
        tools.push(CHAOXING_EXAM_START_TOOL);
        tools.push(CHAOXING_EXAM_STATUS_TOOL);
        tools.push(CHAOXING_EXAM_STOP_TOOL);

        // ===== autonomous_mode: 仅 Agent 模式可用 =====
        if (agentModeActive) {
            tools.push(AUTONOMOUS_MODE_TOOL);
        }
        // ===== SRC 工具: 始终注册,方便AI管理星穹铁道 =====
        if (agentModeActive) {
            SRC_TOOLS.forEach(function(t) { tools.push(t); });
            WIN_TOOLS.forEach(function(t) { tools.push(t); });
        }
        // ===== MiniMax CLI 工具(始终注册,不受Agent模式影响) =====
        if (typeof MMX_TOOLS !== 'undefined') {
            MMX_TOOLS.forEach(function(t) { tools.push(t); });
        }
        // ★ 添加自定义技能到工具列表
        (function() {
            var _customSkills = [];
            try { _customSkills = JSON.parse(localStorage.getItem('customSkills') || '[]'); } catch(e) {}
            for (var _csi = 0; _csi < _customSkills.length; _csi++) {
                var _cs = _customSkills[_csi];
                if (typeof _cs === 'object' && _cs.function && _cs.function.name) {
                    tools.push(_cs);
                }
            }
        })();
        // ★ 工具启用开关过滤
        (function() {
            var _filteredTools = [];
            var _toolFuncNameToToggleKey = {
                'web_search': 'SEARCH_TOOL_DEFINITION',
                'rag_search': 'RAG_SEARCH_TOOL_DEFINITION',
                'web_fetch': 'WEB_FETCH_TOOL_DEFINITION',
                'generate_image': 'IMAGE_TOOL_DEFINITION',
                'generate_image_i2i': 'IMAGE_TOOL_DEFINITION',
                'analyze_image': 'ANALYZE_IMAGE_TOOL',
                'video_understanding': 'VIDEO_UNDERSTANDING_TOOL',
                'video_edit': 'VIDEO_EDIT_TOOL',
                'chaoxing_login': 'CHAXING_LOGIN_TOOL_DEFINITION',
                'chaoxing_list_courses': 'CHAXING_LIST_TOOL_DEFINITION',
                'chaoxing_auto': 'CHAXING_TOOL_DEFINITION',
                'chaoxing_status': 'CHAXING_STATUS_TOOL_DEFINITION',
                'chaoxing_stop': 'CHAXING_STOP_TOOL_DEFINITION',
                'chaoxing_stats': 'CHAXING_STATS_TOOL_DEFINITION',
                'chaoxing_overview': 'CHAXING_OVERVIEW_TOOL',
                'chaoxing_auth': 'CHAXING_AUTH_TOOL',
                'chaoxing_exam_list': 'CHAXING_EXAM_LIST_TOOL',
                'chaoxing_exam_start': 'CHAXING_EXAM_START_TOOL',
                'chaoxing_exam_status': 'CHAXING_EXAM_STATUS_TOOL',
                'chaoxing_exam_stop': 'CHAXING_EXAM_STOP_TOOL',
                'server_exec': 'SERVER_EXEC_TOOL',
                'server_python': 'SERVER_PYTHON_TOOL',
                'server_file_read': 'SERVER_FILE_READ_TOOL',
                'server_file_write': 'SERVER_FILE_WRITE_TOOL',
                'server_sys_info': 'SERVER_SYS_INFO_TOOL',
                'server_ps': 'SERVER_PS_TOOL',
                'server_disk': 'SERVER_DISK_TOOL',
                'server_network': 'SERVER_NETWORK_TOOL',
                'server_docker': 'SERVER_DOCKER_TOOL',
                'server_db_query': 'SERVER_DB_QUERY_TOOL',
                'server_file_search': 'SERVER_FILE_SEARCH_TOOL',
                'server_file_op': 'SERVER_FILE_OP_TOOL',
                'engine_cron_list': 'ENGINE_CRON_LIST_TOOL',
                'engine_cron_create': 'ENGINE_CRON_CREATE_TOOL',
                'engine_cron_delete': 'ENGINE_CRON_DELETE_TOOL',
                'delegate_task': 'DELEGATE_TASK_TOOL',
                'engine_agent_status': 'ENGINE_AGENT_STATUS_TOOL',
                'engine_agent_list': 'ENGINE_AGENT_LIST_TOOL',
                'engine_agent_delete': 'ENGINE_AGENT_DELETE_TOOL',
                'engine_agent_ask': 'ENGINE_AGENT_DELETE_TOOL',
                'engine_push': 'ENGINE_PUSH_TOOL',
                'ask_agent': 'ASK_AGENT_TOOL',
                'autonomous_mode': 'AUTONOMOUS_MODE_TOOL',
                'src_status': 'SRC_STATUS_TOOL',
                'src_dashboard': 'SRC_DASHBOARD_TOOL',
                'src_start': 'SRC_START_TOOL',
                'src_stop': 'SRC_STOP_TOOL',
                'src_get_config': 'SRC_GET_CONFIG_TOOL',
                'src_set_config': 'SRC_SET_CONFIG_TOOL',
                'src_get_logs': 'SRC_GET_LOGS_TOOL',
                'src_get_tasks': 'SRC_GET_TASKS_TOOL',
                'src_toggle_task': 'SRC_TOGGLE_TASK_TOOL',
                'src_check_upgrade': 'SRC_CHECK_UPGRADE_TOOL',
                'src_do_upgrade': 'SRC_DO_UPGRADE_TOOL',
                'win_info': 'WIN_INFO_TOOL',
                'win_processes': 'WIN_PROCESSES_TOOL',
                'win_kill': 'WIN_KILL_TOOL',
                'win_start': 'WIN_START_TOOL',
                'win_restart': 'WIN_RESTART_TOOL',
                'win_file': 'WIN_FILE_TOOL',
                'win_screenshot': 'WIN_SCREENSHOT_TOOL'
            };
            for (var _fti = 0; _fti < tools.length; _fti++) {
                var _ft = tools[_fti];
                var _ftName = _ft.function?.name || '';
                var _toggleKey = _toolFuncNameToToggleKey[_ftName];
                if (_toggleKey) {
                    if (window.isToolEnabled(_toggleKey)) {
                        // ★ Agent 模式关闭时,过滤掉 Agent 专属工具
                        var _agentOn = isAgentToolsActive();
                        var _agentOnlyKeys = ['SERVER_EXEC_TOOL','SERVER_PYTHON_TOOL','SERVER_FILE_WRITE_TOOL','SERVER_FILE_OP_TOOL','SERVER_DOCKER_TOOL','SERVER_DB_QUERY_TOOL','ENGINE_CRON_LIST_TOOL','ENGINE_CRON_CREATE_TOOL','ENGINE_CRON_DELETE_TOOL','DELEGATE_TASK_TOOL','ENGINE_AGENT_STATUS_TOOL','ENGINE_AGENT_LIST_TOOL','ENGINE_AGENT_DELETE_TOOL','ENGINE_PUSH_TOOL','BROWSER_NAVIGATE_TOOL','BROWSER_SCREENSHOT_TOOL','BROWSER_CLICK_TOOL','BROWSER_TYPE_TOOL','BROWSER_GET_CONTENT_TOOL','BROWSER_GET_SNAPSHOT_TOOL'];
                        if (!_agentOn && _agentOnlyKeys.indexOf(_toggleKey) >= 0) {
                            // Agent 未启用,跳过此工具
                        } else {
                            _filteredTools.push(_ft);
                        }
                    }
                } else if (_ftName.startsWith('impl_') || _ftName.startsWith('custom_')) {
                    // 自定义技能: 用 CUSTOM_SKILL_ 前缀检查
                    if (window.isToolEnabled('CUSTOM_SKILL_' + _ftName)) {
                        _filteredTools.push(_ft);
                    }
                } else {
                    // 未知工具默认启用
                    _filteredTools.push(_ft);
                }
            }
            if (_filteredTools.length < tools.length) {
                console.log('[ToolToggle] 过滤掉', tools.length - _filteredTools.length, '个工具');
                tools = _filteredTools;
                if (tools.length === 0) {
                    console.log('[ToolToggle] 所有工具均被禁用,跳过工具注册');
                    delete body.tools;
                    delete body.tool_choice;
                }
            }
        })();
        // ★ 检查模型是否已在"不支持工具"列表中(自动降级 + 模型配置内置)
        var _noToolModels = JSON.parse(localStorage.getItem('noToolModels') || '[]');
        // 匹配方式: 列表中的模式如果出现在模型名中就算匹配
        var _matchedLocal = false;
        for (var _nti = 0; _nti < _noToolModels.length; _nti++) {
            if (modelLower.indexOf(_noToolModels[_nti]) !== -1) {
                _matchedLocal = true;
                break;
            }
        }
        // 同时检查模型配置中是否内置为 no-tool
        var _cfgBuiltinNoTool = false;
        try { _cfgBuiltinNoTool = _getModelCfg().isNoToolsBuiltin(currentModel); } catch(e) {}
        var _isInNoToolList = _matchedLocal || _cfgBuiltinNoTool;
        if (!_isInNoToolList) {
            body.tools = tools;
            // Agent 模式: 始终设置 tool_choice = "auto"
            if (agentModeActive || !isMiniMaxModel) body.tool_choice = "auto";
        } else {
            console.log('[Model]', model, '在 no-tool 列表中,跳过工具注册');
        }
    }
    }

    // ★ modelName 提升到函数作用域,以便后续 sanitizeBody 和 agent 代码使用
    var modelName = currentModel || getVal('modelSelect') || '';

    if (getChecked('customParamsToggle')) {
        try {
            // MiniMax 不支持部分 OpenAI 参数,过滤掉以避免 2013 错误
            // ★ 模型配置:使用模型专属约束过滤 custom params
            var _mcParamsBanned = _getModelCfg().getBannedParams(modelName);
            let customParams = {};
            try { customParams = JSON.parse(getVal('customParams') || '{}'); } catch(e) {}
            if (_mcParamsBanned.length) {
                _mcParamsBanned.forEach(function(p) { delete customParams[p]; delete body[p]; });
            }
            Object.assign(body, customParams);
        } catch { /* 忽略 */ }
    }

    // ★ Agent 模式: 如果本轮创建了子代理,禁止模型继续说话
    var _hasCreatedSubAgent = false;

    // ★ Agent 模式: 思考深度处理 - 使用模型配置判断是否支持 reasoning_effort
    if (agentModeActive) {
        var _mcSupportsReasonEffort = _getModelCfg().supportsReasonEffort(modelName);
        var thinkingDepth = localStorage.getItem('agentThinkingDepth') || 'standard';
        if (thinkingDepth === 'deep' && _mcSupportsReasonEffort) {
            body.reasoning_effort = 'high';
        } else if (thinkingDepth === 'shallow' && _mcSupportsReasonEffort) {
            body.reasoning_effort = 'low';
        } else if (thinkingDepth === 'standard') {
            delete body.reasoning_effort;
        }
    }

    // ★ 模型配置:集中清理 body 中模型不支持的参数
    _getModelCfg().sanitizeBody(modelName, body);

    const timeout = parseInt(getVal('requestTimeout')) * 1000;
    const timeoutId = setTimeout(() => abortMain.abort(), timeout);
    const startTime = Date.now();

    // 网络错误重试配置
    const maxRetries = 3;
    // Agent 模式使用自定义最大工具调用轮次
    var maxToolCalls = parseInt(localStorage.getItem('agentMaxToolRounds')) || 50;
    let toolCallCount = 0;

    // 离线检测
    if (!navigator.onLine) {
        clearTimeout(timeoutId);
        handleError(new Error('网络已断开,请检查网络连接后重试。'), chatId, pendingMsg, currentBubble);
        return;
    }

    // 初始调用使用 abortMain,后续重试使用新的 AbortController
    // ★ 全局工具调用参数修复:发送前确保所有 arguments 是合法 JSON
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
                                // 彻底放弃,用空对象
                                raw = '{}';
                            }
                            tc.function.arguments = raw;
                        }
                    }
                }
            }
        }
    }
    // ★ 终极修复:在发送前对 body 中所有 tool_calls 的 arguments 做 parse+stringify 重编码
    _fixAllToolCalls(body.messages);
    // 附加:对 MiniMax 流式产生的 arguments 做深度重编码
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
            // ★ 终极防护: 每次发送前检查 no-tool 列表,确保不发送 tools
            var _curSendModel = getVal('modelSelect') || '';
            var _curSendLower = _curSendModel.toLowerCase();
            var _noToolSend = JSON.parse(localStorage.getItem('noToolModels') || '[]');
            // 匹配方式: 列表中的模式如果出现在模型名中就算匹配(如 'deepseek-r1' 匹配 'deepseek-r1:latest')
            var _matchedNoTool = false;
            for (var _noi = 0; _noi < _noToolSend.length; _noi++) {
                if (_curSendLower.indexOf(_noToolSend[_noi]) !== -1) {
                    _matchedNoTool = true;
                    break;
                }
            }
            // 也检查模型配置
            if (!_matchedNoTool) {
                try { _matchedNoTool = _getModelCfg().isNoToolsBuiltin(_curSendModel); } catch(e) {}
            }
            if (_matchedNoTool) {
                if (body.tools) {
                    console.log('[SafeSend] 模型', _curSendModel, '在 no-tool 列表,剥离 tools');
                    delete body.tools;
                    delete body.tool_choice;
                    // 同时清理消息中的 tool_calls
                    if (body.messages) {
                        for (var _ssi = 0; _ssi < body.messages.length; _ssi++) {
                            if (body.messages[_ssi].role === 'assistant') {
                                delete body.messages[_ssi].tool_calls;
                            }
                        }
                    }
                }
            }

            // ★ MiniMax 直连: 自定义 URL 和 API Key
            var _reqUrl = getVal('baseUrl') + '/chat/completions';
            var _reqBody = JSON.parse(JSON.stringify(body));
            // 统一声明,后续两个分支都会赋值
            let usage = null;
            let toolCalls = [];
            // 清理日志中的敏感信息
            if (_reqBody.messages) _reqBody.messages = _reqBody.messages.length + ' messages';
            console.log('[API-REQ]', _reqUrl, 'model:', body.model, 'stream:', !!_reqBody.stream, 'tools:', (_reqBody.tools||[]).map(function(t){return t.function?t.function.name:t.name;}), 'messages:', body.messages.length);

            // ★ 硬编码终极防护: 已知不支持工具的模型直接剥离 tools
            var _modelStr = (body.model || '').toLowerCase();
            var _noToolKeywords = ['deepseek-r1', 'deepseek-reasoner', 'qwq'];
            if (body.tools && _noToolKeywords.some(function(k){return _modelStr.indexOf(k) !== -1;})) {
                console.log('[HARD-SAFE] 模型', body.model, '禁止工具,硬编码移除');
                delete body.tools;
                delete body.tool_choice;
                if (body.messages) {
                    for (var _hsi = 0; _hsi < body.messages.length; _hsi++) {
                        if (body.messages[_hsi].role === 'assistant') {
                            delete body.messages[_hsi].tool_calls;
                        }
                    }
                }
            }

            // ★ 发送前验证所有消息 content 字段
            if (body.messages) {
                for (var _viFix = 0; _viFix < body.messages.length; _viFix++) {
                    var _mFix = body.messages[_viFix];
                    if (!_mFix.content && _mFix.content !== 0) {
                        console.warn('[FIX] messages[' + _viFix + '] missing content, role=' + _mFix.role);
                        _mFix.content = '(empty)';
                    }
                    if (_mFix.role === 'tool' && !_mFix.tool_call_id) {
                        _mFix.tool_call_id = 'tc_' + Date.now();
                    }
                }
            }

            const res = await fetch(_reqUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getVal('apiKey')}` },
                body: JSON.stringify(body),
                signal: abortCtrl.signal
            });
            clearTimeout(timeoutIdVal);
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

            const model = getVal('modelSelect') || '';
            const isMiniMax = model.toLowerCase().includes('minimax');
            const useStream = getChecked('streamToggle');

            if (useStream) {
                try {
                    const result = await streamResponse(res, chatId, pendingMsg, 3, 2);
                    usage = result.usage;
                    toolCalls = result.toolCalls || [];
                    // ★ 成本追踪: 累加 token 用量
                    if (usage) {
                        var _pt = usage.prompt_tokens || usage.input_tokens || 0;
                        var _ct = usage.completion_tokens || usage.output_tokens || 0;
                        sessionUsage.promptTokens += _pt;
                        sessionUsage.completionTokens += _ct;
                        sessionUsage.prefixCacheHits += usage.prompt_cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
                        // Feature 7: 增强缓存追踪
                        var _cHit = usage.prompt_cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
                        var _totalCache = (_pt || _ct);
                        if (_cHit > 0) {
                            sessionUsage.cacheHitTokens += _cHit;
                            sessionUsage.cacheMissTokens += (_totalCache > _cHit) ? (_totalCache - _cHit) : 0;
                        }
                        // 估算费用 (基于 DeepSeek V4 定价: $0.5/M input, $2/M output)
                        var pt = _pt / 1000000;
                        var ct = _ct / 1000000;
                        sessionUsage.totalCost += pt * 0.5 + ct * 2;
                    }
                    // ★ 确保 reasoning 从结果同步到 pendingMsg(流式期间可能未完全同步)
                    if (result.reasoningText && !pendingMsg.reasoning) {
                        pendingMsg.reasoning = result.reasoningText;
                    }
                } catch (streamErr) {
                    // ★ HTTP2/网络错误降级: 非流式重试一次
                    const isStreamNetErr = streamErr.name === 'TypeError' ||
                        (streamErr.message && (streamErr.message.includes('fetch') || streamErr.message.includes('net::') || streamErr.message.includes('ERR_') || streamErr.message.includes('network')));
                    if (isStreamNetErr) {
                        console.warn('[STREAM] 流式读取失败,尝试非流式降级:', streamErr.message);
                        showToast('流式中断,切换非流式重试...', 'warning', 2000);
                        // 重新构造非流式请求体(清除stream标记)
                        var _nsBody = JSON.parse(JSON.stringify(body));
                        if (_nsBody.stream !== undefined) _nsBody.stream = false;
                        const _nsRes = await fetch(_reqUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getVal('apiKey')}` },
                            body: JSON.stringify(_nsBody),
                            signal: abortCtrl.signal
                        });
                        clearTimeout(timeoutIdVal);
                        if (!_nsRes.ok) throw new Error(`HTTP ${_nsRes.status}: ${await _nsRes.text()}`);
                        const _nsResult = await handleNonStream(_nsRes, chatId, pendingMsg, currentBubble);
                        usage = _nsResult.usage;
                        if (usage) {
                            var _pt2 = usage.prompt_tokens || usage.input_tokens || 0;
                            var _ct2 = usage.completion_tokens || usage.output_tokens || 0;
                            sessionUsage.promptTokens += _pt2;
                            sessionUsage.completionTokens += _ct2;
                            sessionUsage.prefixCacheHits += usage.prompt_cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
                            var _cHit2 = usage.prompt_cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
                            if (_cHit2 > 0) {
                                sessionUsage.cacheHitTokens += _cHit2;
                                sessionUsage.cacheMissTokens += (_pt2 + _ct2 > _cHit2) ? (_pt2 + _ct2 - _cHit2) : 0;
                            }
                            var pt2 = _pt2 / 1000000;
                            var ct2 = _ct2 / 1000000;
                            sessionUsage.totalCost += pt2 * 0.5 + ct2 * 2;
                        }
                        toolCalls = _nsResult.toolCalls || [];
                    } else {
                        throw streamErr;
                    }
                }
            } else {
                const result = await handleNonStream(res, chatId, pendingMsg, currentBubble);
                usage = result.usage;
                if (usage) {
                    var _pt3 = usage.prompt_tokens || usage.input_tokens || 0;
                    var _ct3 = usage.completion_tokens || usage.output_tokens || 0;
                    sessionUsage.promptTokens += _pt3;
                    sessionUsage.completionTokens += _ct3;
                    sessionUsage.prefixCacheHits += usage.prompt_cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
                    var _cHit3 = usage.prompt_cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
                    if (_cHit3 > 0) {
                        sessionUsage.cacheHitTokens += _cHit3;
                        sessionUsage.cacheMissTokens += (_pt3 + _ct3 > _cHit3) ? (_pt3 + _ct3 - _cHit3) : 0;
                    }
                    var pt3 = _pt3 / 1000000;
                    var ct3 = _ct3 / 1000000;
                    sessionUsage.totalCost += pt3 * 0.5 + ct3 * 2;
                }
                toolCalls = result.toolCalls || [];
            }
            // 处理工具调用
            if (toolCalls.length > 0) {
                toolCallCount++;
                setTimeout(function() {
                    var _tEl = getEl("agentToolCount"); if (_tEl) _tEl.textContent = toolCallCount;
                    var _rEl = getEl("agentRoundCount"); if (_rEl) _rEl.textContent = toolCallCount;
                    var _s = toolCallStats.getSummary();
                    var _sEl = getEl("agentSuccessCount"); if (_sEl) _sEl.textContent = _s.success;
                    var _eEl = getEl("agentErrorCount"); if (_eEl) _eEl.textContent = _s.error;
                    var _dEl = getEl("agentTaskDetail");
                    if (_dEl && _s.failedTools.length > 0) {
                        var _lines = _s.failedTools.map(function(ft) {
                            var _last = ft.errors[ft.errors.length - 1] || {};
                            return '<span style=color:#ef4444>❌ ' + ft.name + '</span>: ' + (_last.msg || '未知错误').substring(0,60);
                        });
                        _dEl.innerHTML = _lines.join('<br>');
                    }
                    var _mEl = getEl("agentMaxCount"); if (_mEl) _mEl.textContent = maxToolCalls;
                    var _pBar = getEl("agentProgressBar");
                    var _pFill = getEl("agentProgressFill");
                    if (_pBar && _pFill) {
                        var _pct = Math.min(100, Math.round((toolCallCount / Math.max(maxToolCalls, 1)) * 100));
                        _pBar.style.display = 'block';
                        _pFill.setAttribute('width', _pct + '%');
                    }
                }, 100);
                sessionUsage.toolCalls += toolCalls.length;
                // Feature 6: 工具调用预判 - 标记所有调用的工具为已记录
                toolCalls.forEach(function(tc) {
                    if (tc && tc.function && tc.function.name) {
                        toolCallStats.record(tc.function.name);
                    }
                });

                if (toolCallCount > maxToolCalls) {
                    throw new Error('工具调用已达上限(' + maxToolCalls + '次),已停止。可在配置面板调整上限。');
                }

                // 将助手消息添加到历史(包含tool_calls)
                // 确保tool_calls中的arguments是字符串(API要求)
                // 过滤掉没有有效function.arguments的碎片
                const validToolCalls = toolCalls.filter(tc => tc && tc.function && tc.function.name && (typeof tc.function.arguments === 'object' || (typeof tc.function.arguments === 'string' && tc.function.arguments.length > 2)));
                const normalizedToolCalls = validToolCalls.map(tc => {
                    var argStr = typeof tc.function.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function.arguments || {});
                    // ★ 修复: 确保 arguments 是合法 JSON 字符串(和 executeToolCallForRetry 相同的修复)
                    var qc = (argStr.match(/"/g) || []).length;
                    if (qc % 2 !== 0) argStr += '"';
                    var ob = (argStr.match(/\{/g) || []).length;
                    var cb = (argStr.match(/\}/g) || []).length;
                    while (cb < ob) { argStr += '}'; cb++; }
                    // 清理非法控制字符和未转义换行
                    argStr = argStr.replace(/[\x00-\x1f]/g, ' ').replace(/\n(?![^"\\]*(?:\\.[^"\\]*)*")/g, '\\n');
                    // 针对 engine_agent_create 的 prompt 做特殊处理:截断过长内容
                    if (tc.function.name === 'engine_agent_create' && argStr.length > 2000) {
                        try {
                            var parsed = JSON.parse(argStr);
                            if (parsed.prompt && parsed.prompt.length > 500) {
                                parsed.prompt = parsed.prompt.substring(0, 500) + '...(截断)请完成后用 engine_push 推送结果给用户';
                                argStr = JSON.stringify(parsed);
                            }
                        } catch(e) {}
                    }
                    // ★ 修复: 清理 tool_call_id(避免非法字符导致 400)
                    var tcId = tc.id || '';
                    // 移除所有非安全字符(只保留 ASCII 字母数字和下划线短横)
                    tcId = tcId.replace(/[^a-zA-Z0-9_\-]/g, '');
                    if (!tcId || tcId.length > 64) tcId = 'tc_' + Date.now();

                    return {
                        id: tcId,
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
                async function executeToolCallForRetry(tc, abortSignal) {
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
                                    toolResult = { result: parts.join('\n\n---\n\n'), _webFetchUrls: urls };
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
                     else if (func.name === 'chaoxing_overview') {
                        toolResult = await chaoxingToolHandler('overview');
                    }
                     else if (func.name === 'chaoxing_auth') {
                        toolResult = await chaoxingToolHandler('auth_check');
                    }
                     else if (func.name === 'chaoxing_exam_list') {
                        toolResult = await chaoxingToolHandler('exam_list');
                    }
                     else if (func.name === 'chaoxing_exam_start') {
                        toolResult = await chaoxingToolHandler('exam_start', args.exam_ids || '');
                    }
                     else if (func.name === 'chaoxing_exam_status') {
                        toolResult = await chaoxingToolHandler('exam_status');
                    }
                     else if (func.name === 'chaoxing_exam_stop') {
                        toolResult = await chaoxingToolHandler('exam_stop');
                    }
                     else if (func.name === 'engine_cron_list') {
                        toolResult = await engineApiHandler('cron_list');
                    }
                     else if (func.name === 'engine_cron_create') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('cron_create', args); }
                        } else { toolResult = await engineApiHandler('cron_create', args); }
                    }
                     else if (func.name === 'engine_cron_delete') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('cron_delete', args); }
                        } else { toolResult = await engineApiHandler('cron_delete', args); }
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
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('cron_delete', args); }
                        } else { toolResult = await engineApiHandler('cron_delete', args); }
                    }
                     else if (func.name === 'server_exec') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('exec', args); }
                        } else { toolResult = await engineApiHandler('exec', args); }
                    }
                     else if (func.name === 'server_python') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('python', args); }
                        } else { toolResult = await engineApiHandler('python', args); }
                    }
                     else if (func.name === 'server_file_read') {
                        toolResult = await engineApiHandler('file_read', args);
                    }
                     else if (func.name === 'server_file_write') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('file_write', args); }
                        } else { toolResult = await engineApiHandler('file_write', args); }
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
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('docker', args); }
                        } else { toolResult = await engineApiHandler('docker', args); }
                    }
                     else if (func.name === 'server_db_query') {
                        toolResult = await engineApiHandler('db_query', args);
                    }
                     else if (func.name === 'server_file_search') {
                        toolResult = await engineApiHandler('file_search', args);
                    }
                     else if (func.name === 'server_file_op') {
                        if (isHighRiskTool(func.name) && isApprovalMode()) {
                            var approved = await requestToolApproval(func.name, args);
                            if (!approved) { toolResult = { error: '用户拒绝了此操作' }; } else { toolResult = await engineApiHandler('file_op', args); }
                        } else { toolResult = await engineApiHandler('file_op', args); }
                    }
                     else if (func.name === 'ask_agent') {
                        if (isYoloMode()) {
                            toolResult = { result: '✅ 当前已是 YOLO 自主模式,无需再次请求。' };
                        } else {
                            var reason = args.reason || '执行高级操作';
                            if (confirm('🧠 AI 请求启用 Agent 模式\n\n原因: ' + reason + '\n\n是否允许?')) {
                                abortExistingRequest(chatId);
                                if (searchAbortControllerMap[chatId]) { searchAbortControllerMap[chatId].abort(); delete searchAbortControllerMap[chatId]; }
                                delete isTypingMap[chatId];
                                setAgentMode('agent');
                                toolResult = { result: '✅ Agent 模式已启用,现在可以执行文件操作和命令了。' };
                            } else {
                                toolResult = { result: '❌ 用户拒绝了 Agent 模式请求,继续普通模式。' };
                            }
                        }
                    }
                     else if (func.name === 'autonomous_mode') {
                        // ★ 必须在 Agent 或 YOLO 模式下才能切换
                        if (getAgentMode() === 'off') {
                            toolResult = { result: '⚠️ 请先启用 Agent 模式，再启用 YOLO 自主模式。' };
                        } else if (isYoloMode()) {
                            toolResult = { result: '✅ 当前已是 YOLO 自主模式。' };
                        } else {
                            var enabled = args.enabled !== false;
                            if (enabled) {
                                if (confirm('⚠️ 确定启用 YOLO 自主模式？\n\n所有工具操作将自动批准，不再逐一确认。\n此操作需由你亲自点击"确定"。')) {
                                    setAgentMode('yolo');
                                    toolResult = { result: '✅ 已切换到 YOLO 自主模式。' };
                                } else {
                                    toolResult = { result: '❌ 用户取消了 YOLO 模式切换。' };
                                }
                            } else {
                                setAgentMode('agent');
                                toolResult = { result: '🔒 已退出自主模式，恢复为 Agent 交互模式。' };
                            }
                        }
                    }
                     else if (func.name === 'engine_agent_ask') {
                        toolResult = await engineApiHandler('agent_ask', args);
                    }
                     else if (func.name === 'engine_agent_stop') {
                        toolResult = await engineApiHandler('agent_stop', args);
                    }
                     else if (func.name === 'engine_push') {
                        var _pushMsg = args.msg || '';
                        var _pushFile = args.file || '';
                        if (_pushFile) {
                            try {
                                var _pRes = await fetch('/oneapichat/engine_api.php?action=push_file&path=' + encodeURIComponent(_pushFile) + '&auth_token=' + (localStorage.getItem('authToken')||''));
                                var _pData = await _pRes.json();
                                if (_pData.ok && _pData.url) {
                                    // ★ 直接追加在 tool_result 中, 并注入到 pendingMsg.content
                                    _pushMsg += '\n📥 ' + _pData.url;
                                    if (pendingMsg) {
                                        pendingMsg.content = (pendingMsg.content || '') + '\n📥 ' + _pData.url;
                                    }
                                } else {
                                    _pushMsg += '\n⚠️ 文件无法分享: ' + (_pData.error || '文件不存在');
                                }
                            } catch(e) { _pushMsg += '\n⚠️ 文件分享异常: ' + e.message; }
                        }
                        toolResult = { result: '✅ ' + _pushMsg };
                    }
                    // ===== SRC 星穹铁道工具 (完整版) =====
                     else if (func.name === 'src_status') {
                        var r = await _srcApi('/status?config_name=src');
                        toolResult = r.ok ? { result: (r.alive ? '✅ 运行中' : '❌ ' + (r.state_label || '已停止')) + ' | state=' + (r.state||'') } : { error: r.error || '获取状态失败' };
                    }
                     else if (func.name === 'src_dashboard') {
                        var r = await _srcApi('/dashboard?config_name=src');
                        if (r.ok && r.resources) {
                            var res = r.resources;
                            var lines = [];
                            var fmts = { trailblaze_power: '⚡体力', reserved_power: '💾后备体力', fuel: '⛽燃料', stellar_jade: '💎星琼', credit: '💰信用点', immersifier: '📿沉浸器', battle_pass_level: '📊大月卡', daily_activity: '📋活跃度', simulated_universe: '🌌模拟宇宙分', echo_of_war: '⚔️历战余响', relic: '📦遗器碎片' };
                            Object.keys(fmts).forEach(function(k) {
                                if (res[k]) lines.push(fmts[k] + ': ' + (res[k].value||0) + '/' + (res[k].total||'∞') + (res[k].time ? ' (' + res[k].time + ')' : ''));
                            });
                            toolResult = { result: '📊 资源面板:\n' + lines.join('\n') + '\n\n更新: ' + (r.updated_at || '') };
                        } else { toolResult = { error: r.error || '获取失败' }; }
                    }
                     else if (func.name === 'src_start') {
                        var task = args.task || 'Alas';
                        var r = await _srcApi('/run', { method: 'POST', body: JSON.stringify({ config_name: 'src', task: task }) });
                        toolResult = r.ok ? { result: '✅ ' + task + ' 已启动' } : { error: r.error || '启动失败(可能已在运行,需先停止)' };
                    }
                     else if (func.name === 'src_stop') {
                        var r = await _srcApi('/stop', { method: 'POST', body: JSON.stringify({ config_name: 'src' }) });
                        toolResult = r.ok ? { result: '✅ SRC 已停止' } : { error: r.error || '停止失败' };
                    }
                     else if (func.name === 'src_get_tasks') {
                        var r = await _srcApi('/tasks?config_name=src');
                        if (r.ok && r.tasks) {
                            var lines = r.tasks.map(function(t) {
                                return (t.enable ? '✅' : '⏸️') + ' ' + t.name + ': ' + (t.description||'') + (t.next_run ? ' → ' + t.next_run : '');
                            });
                            toolResult = { result: '📋 任务列表:\n' + lines.join('\n') };
                        } else { toolResult = { error: r.error || '获取失败' }; }
                    }
                     else if (func.name === 'src_toggle_task') {
                        // 通过配置路径修改任务启用状态
                        var taskName = args.name;
                        var taskPathMap = { Dungeon: 'Dungeon.Scheduler.Enable', Weekly: 'Weekly.Scheduler.Enable', Rogue: 'Rogue.Scheduler.Enable', Ornament: 'Ornament.Scheduler.Enable', Daemon: 'Daemon.Scheduler.Enable', DailyQuest: 'DailyQuest.Scheduler.Enable', BattlePass: 'BattlePass.Scheduler.Enable', Assignment: 'Assignment.Scheduler.Enable', Freebies: 'Freebies.Scheduler.Enable', PlannerScan: 'PlannerScan.Scheduler.Enable' };
                        var path = taskPathMap[taskName];
                        if (!path) { toolResult = { error: '未知任务: ' + taskName + ', 可选: ' + Object.keys(taskPathMap).join(', ') }; }
                        else {
                            var r = await _srcApi('/config/src', { method: 'PUT', body: JSON.stringify({ path: path, value: !!args.enable }) });
                            toolResult = r.ok ? { result: (args.enable ? '✅' : '⏸️') + ' ' + taskName + '已' + (args.enable ? '启用' : '禁用') } : { error: r.error || '操作失败' };
                        }
                    }
                     else if (func.name === 'src_get_config') {
                        var r = await _srcApi('/config/src');
                        toolResult = r.ok ? { result: JSON.stringify(r.data, null, 2) } : { error: r.error || '获取配置失败' };
                    }
                     else if (func.name === 'src_set_config') {
                        var path = args.path, val = args.value;
                        if (val === 'true' || val === 'True') val = true;
                        else if (val === 'false' || val === 'False') val = false;
                        else if (/^\d+$/.test(val)) val = parseInt(val);
                        else if (/^\d+\.\d+$/.test(val)) val = parseFloat(val);
                        var r = await _srcApi('/config/src', { method: 'PUT', body: JSON.stringify({ path: path, value: val }) });
                        toolResult = r.ok ? { result: '✅ ' + path + ' = ' + JSON.stringify(val) } : { error: r.error || '保存失败' };
                    }
                     else if (func.name === 'src_get_logs') {
                        var lines = Math.min(args.lines || 50, 200);
                        var r = await _srcApi('/logs?config_name=src&limit=' + lines);
                        var logLines = r.lines || r.logs || [];
                        // 过滤掉 rich.table.Table 对象
                        var filtered = logLines.filter(function(l) { return typeof l === 'string' && l.indexOf('<rich.table.Table') === -1; });
                        toolResult = r.ok ? { result: filtered.join('\n') || '(日志为空)' } : { error: r.error || '获取失败' };
                    }
                     else if (func.name === 'src_check_upgrade') {
                        var r = await fetch('/oneapichat/src_upgrade.php?action=check');
                        var d = await r.json();
                        toolResult = d.ok ? { result: '当前: ' + d.current + ', 落后 ' + d.behind + ' commit, ' + (d.need_update ? '🔔需要更新' : '✅已是最新') } : { error: d.error || '检查失败' };
                    }
                     else if (func.name === 'src_do_upgrade') {
                        if (!confirm('⚠️ AI请求SRC升级\n\ngit pull + pip install + 重启\n\n确认?')) {
                            toolResult = { result: '❌ 取消升级' };
                        } else {
                            var r = await fetch('/oneapichat/src_upgrade.php?action=upgrade');
                            var d = await r.json();
                            toolResult = d.ok ? { result: '✅ ' + (d.message || '升级完成') + '\n' + (d.output || '') } : { error: d.error || '升级失败' };
                        }
                    }
                    // ===== Windows 本机工具 =====
                     else if (func.name === 'win_info') {
                        var cmd = WIN_POWERSHELL + ' -Command "systeminfo | Select-String OS,Physical,Processor | ForEach-Object { $_.Line.Trim() }"';
                        toolResult = await engineApiHandler('exec', { cmd: cmd, timeout: 15 });
                    }
                     else if (func.name === 'win_processes') {
                        var filter = (args.filter || '').replace(/[^a-zA-Z0-9._-]/g, '');
                        var psCmd = filter
                            ? WIN_POWERSHELL + ' -Command "Get-Process ' + filter + ' -ErrorAction SilentlyContinue | Format-Table Name,Id,CPU,WorkingSet -AutoSize | Out-String -Width 200"'
                            : WIN_POWERSHELL + ' -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 | Format-Table Name,Id,CPU,WorkingSet -AutoSize | Out-String -Width 200"';
                        toolResult = await engineApiHandler('exec', { cmd: psCmd, timeout: 10 });
                    }
                     else if (func.name === 'win_kill') {
                        var target = (args.target || '').replace(/[^a-zA-Z0-9._-]/g, '');
                        var killCmd = WIN_POWERSHELL + ' -Command "Stop-Process -Name ' + target + ' -Force -ErrorAction SilentlyContinue; Stop-Process -Id ' + target + ' -Force -ErrorAction SilentlyContinue; Write-Output done"';
                        toolResult = await engineApiHandler('exec', { cmd: killCmd, timeout: 10 });
                    }
                     else if (func.name === 'win_start') {
                        var path = (args.path || '').replace(/'/g, '');
                        var app = (args.app || '').replace(/['"\\]/g, '');
                        var startCmd;
                        if (app) {
                            // ★ 中文应用名用 base64 编码防止编码问题
                            var _encodedApp = btoa(unescape(encodeURIComponent(app)));
                            startCmd = WIN_POWERSHELL + ' -Command "$n=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(\'' + _encodedApp + '\')); Start-Process \"shell:AppsFolder\\$n\"; Write-Output started"';
                        } else if (path) {
                            startCmd = WIN_POWERSHELL + ' -Command "Start-Process \"' + path + '\"; Write-Output started"';
                        } else {
                            toolResult = { error: '请提供 path(程序路径) 或 app(应用名)' };
                        }
                        if (startCmd) toolResult = await engineApiHandler('exec', { cmd: startCmd, timeout: 10 });
                    }
                     else if (func.name === 'win_restart') {
                        var name = (args.name || '').replace(/[^a-zA-Z0-9._-]/g, '');
                        var path2 = (args.path || '').replace(/'/g, '');
                        var app2 = (args.app || '').replace(/['"\\]/g, '');
                        var restartCmd = WIN_POWERSHELL + ' -Command "Stop-Process -Name ' + name + ' -Force -ErrorAction SilentlyContinue; Start-Sleep 2';
                        if (app2) {
                            var _encodedApp2 = btoa(unescape(encodeURIComponent(app2)));
                            restartCmd += '; $n=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(\'' + _encodedApp2 + '\')); Start-Process \"shell:AppsFolder\\$n\"';
                        }
                        else if (path2) restartCmd += '; Start-Process \"' + path2 + '\"';
                        restartCmd += '; Write-Output restarted"';
                        toolResult = await engineApiHandler('exec', { cmd: restartCmd, timeout: 15 });
                    }
                     else if (func.name === 'win_file') {
                        var action = args.action || 'list';
                        var wslPath = (args.path || '/mnt/c/').replace(/\\/g, '/');
                        if (!wslPath.startsWith('/mnt/')) { toolResult = { error: '请使用WSL路径如 /mnt/c/Users/AS/Desktop' }; }
                        else if (action === 'list') {
                            toolResult = await engineApiHandler('exec', { cmd: 'ls -la "' + wslPath + '" 2>&1 | head -50', timeout: 5 });
                        } else if (action === 'read') {
                            toolResult = await engineApiHandler('exec', { cmd: 'cat "' + wslPath + '" 2>&1 | head -200', timeout: 5 });
                        } else { toolResult = { error: 'action 仅支持 list/read' }; }
                    }
                     else if (func.name === 'win_screenshot') {
                        var fmt = (args.format || 'png').replace(/[^a-z]/g, '');
                        if (fmt !== 'png' && fmt !== 'jpg') fmt = 'png';
                        var _ts = Date.now();
                        var _outPath = '/mnt/c/Windows/Temp/screenshot_' + _ts + '.' + fmt;
                        // ★ 截图保存到 WSL2 可访问路径,不通过 base64 传输(避免截断)
                        var ssCmd = WIN_POWERSHELL + ' -Command "Add-Type -AssemblyName System.Windows.Forms; $b = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size); $b.Save(\"' + _outPath.replace(/\\/g, '\\\\') + '\", [System.Drawing.Imaging.ImageFormat]::' + (fmt === 'png' ? 'Png' : 'Jpeg') + '); $b.Dispose(); $g.Dispose(); Write-Output done"';
                        var r = await engineApiHandler('exec', { cmd: ssCmd, timeout: 15 });
                        // 返回可访问的 URL
                        toolResult = { result: '✅ 截图已保存: ' + _outPath + '\n可通过 server_file_read 读取或直接在浏览器打开: /file?path=' + encodeURIComponent(_outPath) };
                    }
// ===== 浏览器工具 =====
                     else if (func.name === 'browser_navigate') {
                        toolResult = await engineApiHandler('browser_navigate', args);
                    }
                     else if (func.name === 'browser_screenshot') {
                        toolResult = await engineApiHandler('browser_screenshot', args);
                        // ★ 截图自动追加为图片
                        if (toolResult && toolResult.image && currentChatId === chatId) {
                            var _img = document.createElement('img');
                            _img.src = toolResult.image;
                            _img.style.cssText = 'max-width:100%;border-radius:8px;margin-top:8px;cursor:pointer;';
                            _img.onclick = function() { window.open(this.src, '_blank'); };
                            var _b = activeBubbleMap[chatId];
                            if (_b) { var _md = _b.querySelector('.markdown-body'); if (_md) _md.appendChild(_img); else _b.appendChild(_img); }
                        }
                    }
                     else if (func.name === 'browser_click') {
                        toolResult = await engineApiHandler('browser_click', args);
                    }
                     else if (func.name === 'browser_type') {
                        toolResult = await engineApiHandler('browser_type', args);
                    }
                     else if (func.name === 'browser_get_content') {
                        toolResult = await engineApiHandler('browser_get_content', args);
                    }
                     else if (func.name === 'browser_get_snapshot') {
                        toolResult = await engineApiHandler('browser_get_snapshot', args);
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
                        var fullPrompt = tPrompt || '你的任务是: ' + tTask + '。\n\n【重要】任务完成后必须调用 engine_push 工具向用户推送结果摘要(中文,不超过200字)。不要只返回文本,必须使用 engine_push!';
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
                                toolResult = { result: '✅ 已创建并启动子代理「' + tName + '」(角色:' + tRole + '),任务: ' + (tTask || tPrompt).substring(0, 50) };
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
            // ★ 安全规则: n>1(多张)时自动丢弃 seed,防止所有图一模一样
            var _safeSeed = args.seed;
            var _safeN = args.n || 1;
            if (_safeN > 1 && _safeSeed !== undefined) {
                _safeSeed = undefined;
            }
            const imageResult = await window.generateImage(prompt, {
                model: args.model,
                style: args.style,
                aspect_ratio: args.aspect_ratio,
                image_size: args.image_size,
                seed: _safeSeed,
                n: _safeN,
                prompt_optimizer: args.prompt_optimizer,
                aigc_watermark: args.aigc_watermark
            });

            if (imageResult) {
                // ★ 累积所有图片(支持多次调用)
                if (!pendingMsg.generatedImages) pendingMsg.generatedImages = [];
                var _imgUrlsFinal = typeof imageResult === 'string' ? [imageResult] : imageResult;
                for (var _giF = 0; _giF < _imgUrlsFinal.length; _giF++) {
                    var _imgF = _imgUrlsFinal[_giF];
                    pendingMsg.generatedImages.push(_imgF);
                    if (_giF === 0) pendingMsg.generatedImage = _imgF;
                    // 异步上传到服务器(不阻塞)
                    if (_imgF && !_imgF.startsWith(window.location.origin)) {
                        uploadImageToServer(_imgF).then(function(srvUrl) {
                            if (srvUrl) console.log('[Image] 已上传生成图片:', srvUrl);
                        }).catch(function(e) {
                            console.warn('[Image] 上传生成图片失败:', e.message);
                        });
                    }
                }
                toolResult = { result: '\u2705 ' + _imgUrlsFinal.length + '\u5f20\u56fe\u7247\u5df2\u751f\u6210' };
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
                        let primaryImage = args.image;

                        // ★ 找出当前聊天中用户上传的图片(支持多张参考图)
                        var _allImages = [];
                        // 优先从 chat 级变量获取(当前聊天专属)
                        var _chatImages = window._currentMessageImagesByChat && window._currentMessageImagesByChat[chatId];
                        if (_chatImages && _chatImages.length > 0) {
                            _allImages = _chatImages.filter(function(f) {
                                return f.isImage || (f.type && f.type.startsWith('image/'));
                            });
                        }
                        // 其次从 pendingFiles 获取
                        if (!_allImages.length && pendingFiles && pendingFiles.length > 0) {
                            _allImages = pendingFiles.filter(function(f) {
                                return f.isImage || (f.type && f.type.startsWith('image/'));
                            });
                        }
                        // 最后从聊天历史中获取(用户上传或AI生成的图片)
                        if (!_allImages.length && chatId && chats[chatId]) {
                            var msgs = chats[chatId].messages;
                            for (var _miI2i = msgs.length - 1; _miI2i >= 0; _miI2i--) {
                                // 用户上传的图片
                                if (msgs[_miI2i].role === 'user' && msgs[_miI2i].files && msgs[_miI2i].files.length > 0) {
                                    _allImages = msgs[_miI2i].files.filter(function(f) {
                                        return f.isImage || (f.type && f.type.startsWith('image/'));
                                    });
                                    if (_allImages.length > 0) break;
                                }
                                // AI 生成的图片
                                if (msgs[_miI2i].role === 'assistant' && msgs[_miI2i].generatedImages && msgs[_miI2i].generatedImages.length > 0) {
                                    _allImages = msgs[_miI2i].generatedImages.map(function(imgUrl) {
                                        return { name: 'AI生成的图片', content: imgUrl, isImage: true, type: 'image/png' };
                                    });
                                    if (_allImages.length > 0) break;
                                }
                                if (msgs[_miI2i].role === 'assistant' && msgs[_miI2i].generatedImage) {
                                    _allImages = [{ name: 'AI生成的图片', content: msgs[_miI2i].generatedImage, isImage: true, type: 'image/png' }];
                                    break;
                                }
                            }
                        }

                        if (!userPrompt) {
                            toolResult = { error: 'Missing prompt parameter' };
                        } else if (!_allImages.length) {
                            toolResult = { error: '缺少参考图片。请上传至少一张参考图片后再使用图生图功能。' };
                        } else {
                            // 使用第一张图作为主参考图
                            primaryImage = _allImages[0].serverUrl || _allImages[0].content || '';

                            if (currentChatId === chatId) {
                                const currentBubble = activeBubbleMap[chatId];
                                if (currentBubble) {
                                    let status = currentBubble.querySelector('.search-status');
                                    if (!status) {
                                        status = document.createElement('div');
                                        status.className = 'search-status';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(status);
                                    }
                                    status.textContent = '🔍 正在分析参考图片(' + _allImages.length + '张)...';
                                }
                            }

                            try {
                                // ★ 逐张分析所有参考图,构建完整描述
                                var _allDescs = [];
                                for (var _ai = 0; _ai < _allImages.length; _ai++) {
                                    var _imgSrc = _allImages[_ai].serverUrl || _allImages[_ai].content || '';
                                    if (!_imgSrc) continue;
                                    if (currentChatId === chatId) {
                                        var _cbI2i = activeBubbleMap[chatId];
                                        if (_cbI2i) {
                                            var _stI2i = _cbI2i.querySelector('.search-status');
                                            if (_stI2i) _stI2i.textContent = '🔍 正在分析第' + (_ai + 1) + '/' + _allImages.length + '张参考图...';
                                        }
                                    }
                                    try {
                                        var _descPromise = window.analyzeImage(_imgSrc, 'Describe this image in detail: style, subject, colors, composition, mood. Under 150 words.');
                                        var _descResult = await _descPromise;
                                        if (_descResult && typeof _descResult === 'string') {
                                            _allDescs.push('参考图' + (_ai + 1) + ': ' + _descResult.slice(0, 300));
                                        }
                                    } catch(_e) {
                                        console.warn('[i2i] 分析第' + (_ai + 1) + '张图片失败:', _e.message);
                                        _allDescs.push('参考图' + (_ai + 1) + ': (分析失败)');
                                    }
                                }

                                // 构建完整 prompt: 用户原始需求 + 所有图片描述
                                var _allDescsText = _allDescs.join('\n');
                                var fullPrompt = userPrompt + '\n\n【参考图分析】\n' + _allDescsText.slice(0, 2000);

                                if (currentChatId === chatId) {
                                    const currentBubble = activeBubbleMap[chatId];
                                    if (currentBubble) {
                                        let status = currentBubble.querySelector('.search-status');
                                        if (status) status.textContent = '🎨 正在图生图(' + _allImages.length + '张参考图)...';
                                        const placeholder = document.createElement('div');
                                        placeholder.id = 'image-placeholder';
                                        placeholder.style = 'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:12px;padding:40px 20px;text-align:center;margin:12px 0;color:white;animation:pulse 2s infinite;';
                                        placeholder.innerHTML = '<div style="font-size:24px;margin-bottom:8px;">🎨</div><div style="font-size:14px;">图生图中' + ((args.n || 1) > 1 ? ' (' + (args.n || 1) + '张)' : '') + ',请稍候...</div><div style="font-size:12px;margin-top:8px;opacity:0.8;">' + escapeHtml(userPrompt.substring(0, 30)) + '...</div>';
                                        currentBubble.querySelector('.markdown-body')?.appendChild(placeholder);
                                    }
                                }

                                // ★ 调用图生图 API(用第一张图作为主参考,所有描述写入 prompt)
                                const i2iResult = await window.generateImageI2I(fullPrompt, primaryImage, {
                                    model: args.model || localStorage.getItem('imageModel') || 'image-01',
                                    aspect_ratio: args.aspect_ratio,
                                    seed: args.seed,
                                    n: args.n
                                });
                                if (i2iResult) {
                                    if (!pendingMsg.generatedImages) pendingMsg.generatedImages = [];
                                    var _imgUrlsI2i = typeof i2iResult === 'string' ? [i2iResult] : i2iResult;
                                    for (var _giI2i = 0; _giI2i < _imgUrlsI2i.length; _giI2i++) {
                                        var _imgI2i = _imgUrlsI2i[_giI2i];
                                        pendingMsg.generatedImages.push(_imgI2i);
                                        if (_giI2i === 0) pendingMsg.generatedImage = _imgI2i;
                                        if (_imgI2i && !_imgI2i.startsWith(window.location.origin)) {
                                            uploadImageToServer(_imgI2i).then(function(srvUrl) {
                                                if (srvUrl) console.log('[Image] i2i已上传:', srvUrl);
                                            }).catch(function(e) {
                                                console.warn('[Image] i2i上传失败:', e.message);
                                            });
                                        }
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
                        const imgIdx = (typeof args.image_index === 'number' && args.image_index >= 0) ? args.image_index : 0;

                        // 获取当前消息中的所有图片(优先从全局变量获取)
                        var _imgsForChat = window._currentMessageImagesByChat && window._currentMessageImagesByChat[chatId];
                        let currentFiles = _imgsForChat || [];
                        if (!currentFiles.length) {
                            currentFiles = pendingFiles.length > 0 ? pendingFiles : (chats[chatId]?.messages?.slice(-1)[0]?.files || []);
                        }

                        // 如果仍然没有找到图片,尝试从聊天历史中查找(用户上传或AI生成的图片)
                        if (!currentFiles.length && chats[chatId]) {
                            const msgs = chats[chatId].messages;
                            for (let i = msgs.length - 1; i >= 0; i--) {
                                if (msgs[i].role === 'user' && msgs[i].files && msgs[i].files.length > 0) {
                                    currentFiles = msgs[i].files.filter(f => f.isImage || f.type?.startsWith('image/'));
                                    if (currentFiles.length > 0) break;
                                }
                                // AI 生成的图片
                                if (msgs[i].role === 'assistant' && msgs[i].generatedImages && msgs[i].generatedImages.length > 0) {
                                    currentFiles = msgs[i].generatedImages.map(url => ({ name: 'AI生成的图片', content: url, isImage: true, type: 'image/png' }));
                                    if (currentFiles.length > 0) break;
                                }
                                if (msgs[i].role === 'assistant' && msgs[i].generatedImage) {
                                    currentFiles = [{ name: 'AI生成的图片', content: msgs[i].generatedImage, isImage: true, type: 'image/png' }];
                                    break;
                                }
                            }
                        }

                        // 按索引选择图片
                        const imageFiles = currentFiles.filter(f => f.isImage || f.type?.startsWith('image/'));
                        const imageFile = (imageFiles.length > imgIdx) ? imageFiles[imgIdx] : imageFiles[0];

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
                                // ★ 更新状态提示(显示第几张)
                                if (currentChatId === chatId) {
                                    var _cbImg = activeBubbleMap[chatId];
                                    if (_cbImg) {
                                        var _stImg = _cbImg.querySelector('.search-status');
                                        if (_stImg) _stImg.textContent = '🖼️ 正在分析第' + (imgIdx + 1) + '/' + imageFiles.length + '张图片...';
                                    }
                                }
                                // ★ 优先使用服务器URL(已预上传),减小跨代理传输
                                var analyzeInput = imageFile.content;
                                if (imageFile.serverUrl && typeof imageFile.serverUrl === 'string') {
                                    // 将相对URL转为完整URL
                                    var fullUrl = imageFile.serverUrl.startsWith('http') ? imageFile.serverUrl : window.location.origin + imageFile.serverUrl;
                                    analyzeInput = fullUrl;
                                }
                                const analyzeResult = await window.analyzeImage(analyzeInput, focus);
                                toolResult = { result: analyzeResult };
                                // ★ 缓存工具调用的分析结果,后续追问无需重新分析
                                try {
                                    if (chatId && chats[chatId]) {
                                        if (!chats[chatId].imageAnalyses) chats[chatId].imageAnalyses = [];
                                        var _cacheStr = '【' + (imageFile.name || '图片' + imgIdx) + '】\n' + analyzeResult;
                                        if (chats[chatId].imageAnalyses.indexOf(_cacheStr) === -1) {
                                            chats[chatId].imageAnalyses.push(_cacheStr);
                                        }
                                        if (chats[chatId].imageAnalyses.length > 50) {
                                            chats[chatId].imageAnalyses = chats[chatId].imageAnalyses.slice(-30);
                                        }
                                        slimSaveChats();
                                    }
                                } catch(e2) {}
                            } catch (e) {
                                console.error('[analyze_image error]', e);
                                const errorMsg = e?.message || e?.toString() || String(e) || '图片分析失败';
                                toolResult = { error: errorMsg };
                            }
                        }
                    } else if (func.name === 'video_understanding') {
                        var query = args.query || '描述视频内容';
                        var vidIdx = args.video_index || 0;
                        var vids = [];
                        if (chats[chatId]) {
                            var msgs = chats[chatId].messages;
                            for (var vi = msgs.length-1; vi >= 0; vi--) {
                                if (msgs[vi].files) {
                                    var vf2 = msgs[vi].files.filter(function(f){ return f.isVideo || (f.type && f.type.startsWith('video/')); });
                                    vids = vids.concat(vf2);
                                }
                            }
                        }
                        var vf = vids[vidIdx];
                        if (!vf) { toolResult = { error: '未找到视频' }; }
                        else {
                            var input = vf.serverUrl || vf.content;
                            if (input && !input.startsWith('http') && !input.startsWith('data:')) {
                                input = window.location.origin + input;
                            }
                            // ★ 检查缓存: 30分钟内已分析过的视频直接复用
                            var _cacheKey = vf.serverUrl || input;
                            var _cached = chats[chatId]?.videoAnalyses?.[_cacheKey];
                            if (_cached && _cached.time && (Date.now() - _cached.time < 1800000) && _cached.frames && _cached.frames.length > 0) {
                                var _cr = '🎬 **视频分析结果(缓存)**\n\n**元信息:**\n';
                                _cr += '- 时长: ' + Math.floor(_cached.duration/60) + '分' + Math.round(_cached.duration%60) + '秒\n';
                                if (_cached.meta?.width) _cr += '- 分辨率: ' + _cached.meta.width + 'x' + _cached.meta.height + '\n';
                                _cr += '\n**关键帧分析(' + _cached.frames.length + '帧):**\n';
                                _cached.frames.forEach(function(a){ _cr += '\n' + a + '\n'; });
                                toolResult = { result: _cr };
                            } else {
                                var r = await window.analyzeVideo(input, query);
                                toolResult = { result: r };
                            }
                        }
                    } else if (func.name.startsWith('mmx_')) {
                        // MiniMax CLI 工具：mmx_chat/mmx_image/mmx_video/mmx_speech/mmx_voices/mmx_music/mmx_vision/mmx_quota
                        var _mmxCmd = func.name.replace('mmx_', '');
                        
                        // ★ 定义 appendAudioToChat（如尚未定义）
                        if (typeof window.appendAudioToChat !== 'function') {
                            window.appendAudioToChat = function(url, label) {
                                var cid2 = currentChatId;
                                if (!cid2 || !chats[cid2]) return;
                                var audioTag = '<audio controls style="width:100%%;max-width:400px;margin:8px 0;"><source src="' + url + '" type="audio/mpeg"></audio><br><a href="' + url + '" target="_blank" download>⬇️ 下载</a>';
                                appendMessage('assistant', '### ' + label + '\n' + audioTag);
                            };
                        }
                        var _mmxKey2 = (function(){
                            var _k = localStorage.getItem('apiKeyMiniMax') || localStorage.getItem('baseApiKey') || '';
                            try { return decrypt(_k) || _k; } catch(e) { return _k; }
                        })();
                        var _mmxUrl = SERVER_API_BASE + '/engine_api.php?action=mmx&resource=' + _mmxCmd + '&cmd=' + _mmxCmd + '&api_key=' + encodeURIComponent(_mmxKey2);
                        if (args.message) _mmxUrl += '&message=' + encodeURIComponent(args.message);
                        if (args.system) _mmxUrl += '&system=' + encodeURIComponent(args.system);
                        if (args.prompt) _mmxUrl += '&prompt=' + encodeURIComponent(args.prompt);
                        if (args.text) _mmxUrl += '&text=' + encodeURIComponent(args.text);
                        if (args.voice) _mmxUrl += '&voice=' + encodeURIComponent(args.voice);
                        if (args.image) _mmxUrl += '&image=' + encodeURIComponent(args.image);
                        if (args.lyrics) _mmxUrl += '&lyrics=' + encodeURIComponent(args.lyrics);
                        if (args.aspect_ratio) _mmxUrl += '&aspect_ratio=' + encodeURIComponent(args.aspect_ratio);
                        if (args.n) _mmxUrl += '&n=' + parseInt(args.n);
                        if (args.instrumental === true) _mmxUrl += '&instrumental=true';
                        if (args.max_tokens) _mmxUrl += '&max_tokens=' + parseInt(args.max_tokens);
                        try {
                            var _mmxCtrl = new AbortController();
                            if (abortSignal) {
                                abortSignal.addEventListener('abort', function() { _mmxCtrl.abort(); }, { once: true });
                            }
                            var _to = setTimeout(function() { _mmxCtrl.abort(); }, 300000); // 5分钟超时
                            var _mmxResp = await fetch(_mmxUrl, { signal: _mmxCtrl.signal });
                            clearTimeout(_to);
                            // speech 和 music: 生成后自动返回音频 URL
                            if (_mmxCmd === 'speech' || _mmxCmd === 'music') {
                                var _mmxText = await _mmxResp.text();
                                try {
                                    var _mmxJson = JSON.parse(_mmxText);
                                    var _audioUrl = _mmxJson?.result?.url || '';
                                    if (_audioUrl) {
                                        toolResult = { result: '✅ ' + (_mmxCmd === 'speech' ? '语音' : '音乐') + '已生成: ' + _audioUrl };
                                        // ★ 附加文件到当前对话,让用户直接看到播放器
                                        if (typeof window.appendAudioToChat === 'function') {
                                            window.appendAudioToChat(_mmxJson.result.url, (_mmxCmd === 'music' ? '🎵 生成的音乐' : '🔊 生成的语音'));
                                        }
                                    } else {
                                        toolResult = { result: _mmxJson.result || JSON.stringify(_mmxJson) };
                                    }
                                } catch(e) {
                                    toolResult = { result: _mmxText };
                                }
                            } else {
                                var _mmxData = await _mmxResp.json();
                                var _mmxRes = _mmxData.result || _mmxData;
                                var _formatted = typeof _mmxRes === 'object' ? JSON.stringify(_mmxRes, null, 2) : String(_mmxRes);
                                toolResult = { result: _formatted };
                            }
                        } catch (_mmxErr) {
                            console.error('[mmx] 请求失败:', _mmxErr.message);
                            toolResult = { error: 'MiniMax CLI 调用失败: ' + (_mmxErr.message || '未知错误') };
                        }
                    } else if (func.name === 'video_edit') {
                        var _srcEnginePath = args.input_path || '';
                        // ★ 智能补全: 如果没传 input_path,从当前聊天的上传文件里找
                        if (!_srcEnginePath && chats[chatId]) {
                            var _msgs2 = chats[chatId].messages;
                            for (var _vi2 = _msgs2.length-1; _vi2 >= 0; _vi2--) {
                                if (_msgs2[_vi2].files) {
                                    var _vf2 = _msgs2[_vi2].files.find(function(f){ return f.isVideo || (f.type && f.type.startsWith('video/')); });
                                    if (_vf2) { _srcEnginePath = _vf2.serverUrl || _vf2.content || ''; break; }
                                }
                            }
                        }
                        if (_srcEnginePath.startsWith('http')) _srcEnginePath = _srcEnginePath.replace(window.location.origin, '');
                        if (args.params && args.params.files && Array.isArray(args.params.files)) {
                            for (var _fi=0; _fi<args.params.files.length; _fi++) {
                                if (args.params.files[_fi].startsWith('http')) args.params.files[_fi] = args.params.files[_fi].replace(window.location.origin, '');
                            }
                        }
                        var _veditBody = { action: args.action || 'info', params: args.params || {}, input_path: _srcEnginePath };
                        if (args.output_path) _veditBody.output_path = args.output_path;
                        if (args.action === 'tts') {
                            _veditBody.params.api_key = decrypt(localStorage.getItem('ttsApiKey')||'')||decrypt(localStorage.getItem('visionApiKey')||'')||'';
                            _veditBody.params.provider = args.params?.provider || localStorage.getItem('ttsProvider') || 'minimax';
                            _veditBody.params.group_id = args.params?.group_id || '';
                        }
                        if (args.action === 'voice' && !_veditBody.params.api_key) {
                            _veditBody.params.api_key = decrypt(localStorage.getItem('ttsApiKey')||'')||decrypt(localStorage.getItem('visionApiKey')||'')||'';
                            _veditBody.params.provider = args.params?.provider || localStorage.getItem('ttsProvider') || 'minimax';
                            _veditBody.params.group_id = args.params?.group_id || '';
                        }
                        try {
                            var _ctlr = new AbortController();
                            var _to = setTimeout(function() { _ctlr.abort(); }, 600000); // 10分钟超时
                            // ★ 如果用户停止,同时 abort 这个 fetch
                            if (abortSignal) {
                                abortSignal.addEventListener('abort', function() { _ctlr.abort(); }, { once: true });
                            }
                            var _veditResp = await fetch('/engine/video_edit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(_veditBody), signal: _ctlr.signal });
                            clearTimeout(_to);
                            var _veditData = await _veditResp.json();
                            if (_veditData.error) { toolResult = { error: _veditData.error }; }
                            else { toolResult = { result: _veditData.result || '操作完成' }; }
                        } catch (_veditErr) {
                            console.error('[video_edit] 请求失败:', _veditErr.message);
                            toolResult = { error: '视频剪辑请求超时或失败: ' + (_veditErr.message || '未知错误') + '。请尝试缩小视频或降低分辨率后重试。' };
                        }
                    }
                    return toolResult;
                }
// ==================== 图像生成函数 ====================
window.generateImage = async (prompt, options = {}) => {
    const imageProvider = localStorage.getItem('imageProvider') || 'minimax';

    if (imageProvider === 'openrouter') {
        return generateImageOpenRouter(prompt, options);
    }

    // ===== MiniMax (原有实现) =====
    // ★ MiniMax API 限制 prompt ≤ 1500 字符,截断避免 2013 错误
    const MAX_PROMPT_LEN = 1400;
    if (prompt.length > MAX_PROMPT_LEN) prompt = prompt.slice(0, MAX_PROMPT_LEN);
    let baseUrl = (localStorage.getItem('imageBaseUrl') || DEFAULT_CONFIG.imageBaseUrl || '').replace(/\/$/, '');
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

    const imageModel = localStorage.getItem('imageModel') || 'image-01';
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
        const images = [];
        if (data.data && Array.isArray(data.data)) {
            data.data.forEach(function(d) {
                if (d.image_base64) images.push('data:image/png;base64,' + d.image_base64);
                else if (d.image_url) images.push(d.image_url);
            });
        } else if (data.data && data.data.image_base64 && Array.isArray(data.data.image_base64)) {
            data.data.image_base64.forEach(function(b64) {
                images.push('data:image/png;base64,' + b64);
            });
        } else if (data.data && data.data.image_url) {
            images.push(data.data.image_url);
        }
        if (images.length > 0) return images.length === 1 ? images[0] : images;
        if (data.code || data.msg || data.error) {
            throw new Error('API错误: ' + (data.msg || data.error || JSON.stringify(data)));
        }
        throw new Error('图像生成 API 返回数据格式异常: ' + JSON.stringify(data).substring(0, 200));
    } catch (e) {
        console.error('Image generation error:', e);
        throw e;
    }
};

// ===== OpenRouter GPT Image 2 图像生成 =====
async function generateImageOpenRouter(prompt, options = {}) {
    // 获取配置: 使用独立的 imageApiKeyOpenrouter 和 imageBaseUrlOpenrouter
    let baseUrl = (localStorage.getItem('imageBaseUrlOpenrouter') || 'https://openrouter.ai/api').replace(/\/$/, '');
    if (baseUrl && !baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl + '/v1';
    }
    const rawKey = localStorage.getItem('imageApiKeyOpenrouter') || '';
    let apiKey = '';
    try { apiKey = decrypt(rawKey) || ''; } catch(e) { console.error('[generateImageOpenRouter] decrypt error:', e.message); }

    if (!apiKey) {
        throw new Error('未配置 OpenRouter API Key,请在设置-图像生成中填写');
    }

    const configuredModel = localStorage.getItem('imageModel') || 'openai/gpt-5.4-image-2';
    // ★ 当提供商为 OpenRouter 时,忽略 AI 传来的 MiniMax 模型名(如 image-01),强制使用配置的模型
    var actualModel = options.model || configuredModel;
    if (actualModel.indexOf('image-01') !== -1 || actualModel.indexOf('minimax') !== -1) {
        actualModel = configuredModel;
    }
    const chatUrl = baseUrl + '/chat/completions';
    const n = options.n || 1;
    const aspectRatio = options.aspect_ratio || '1:1';
    const imageSize = options.image_size || '1K';

    // 构建 image_config
    const imageConfig = {
        aspect_ratio: aspectRatio,
        image_size: imageSize
    };

    try {
        const body = {
            model: actualModel,
            messages: [
                { role: 'user', content: prompt }
            ],
            modalities: ['image', 'text'],
            image_config: imageConfig,
            n: n
        };

        const response = await fetch(chatUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text().catch(function() { return response.statusText; });
            throw new Error('OpenRouter 请求失败 (' + response.status + '): ' + errText.substring(0, 200));
        }

        const data = await response.json();

        // 检查错误
        if (data.error) {
            throw new Error('OpenRouter 错误: ' + (data.error.message || JSON.stringify(data.error)));
        }

        // 从 message.images 提取图片(base64 data URLs)
        const images = [];
        if (data.choices && data.choices.length > 0) {
            const msg = data.choices[0].message;
            if (msg && msg.images && Array.isArray(msg.images)) {
                msg.images.forEach(function(img) {
                    if (img.image_url && img.image_url.url) {
                        images.push(img.image_url.url);
                    }
                });
            }
        }

        // 备用: 检查 content 中是否包含图片 URL
        if (images.length === 0 && data.choices && data.choices.length > 0) {
            const content = data.choices[0].message.content;
            if (content) {
                const dataUrlMatch = content.match(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/);
                if (dataUrlMatch) {
                    images.push(dataUrlMatch[0]);
                }
            }
        }

        if (images.length > 0) {
            return images.length === 1 ? images[0] : images;
        }

        throw new Error('GPT Image 2 未返回图片,响应: ' + JSON.stringify(data).substring(0, 300));
    } catch (e) {
        console.error('[generateImageOpenRouter] error:', e);
        throw e;
    }
}

// ==================== 图生图函数 ===================
window.generateImageI2I = async (prompt, image, options = {}) => {
    // ★ 图生图: 仅 MiniMax 原生支持,OpenRouter 降级为文生图
    var _i2i_provider = localStorage.getItem('imageProvider') || 'minimax';
    if (_i2i_provider === 'openrouter') {
        // OpenRouter 不支持图生图,降级为文生图
        return window.generateImage(prompt, options);
    }
    // ★ MiniMax API 限制 prompt ≤ 1500 字符,截断避免 2013 错误
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
                throw new Error('抱歉,您的账号不支持 image-01-live 模型,请联系管理员升级');
            }
            // 内容安全
            if (errCode === 1026) {
                throw new Error('图片内容涉及敏感信息,请尝试其他描述');
            }
            // 账号问题
            if (errCode === 1008) {
                throw new Error('账号余额不足,请充值后重试');
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
                var _allWebFetchUrls = [];
                for (const tc of validToolCalls) {
                    // ★ 实时显示工具执行状态
                    var _argPreview = '';
                    try {
                        if (tc.function && tc.function.arguments) {
                            var _a = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
                            var _keys = Object.keys(_a || {});
                            _argPreview = _keys.length > 0 ? (_a[_keys[0]] || '').toString().substring(0, 40) : '';
                        }
                    } catch(e) {}
                    // ★ 用户停止检测: 每次工具调用前检查
                    if (userAbortMap[chatId]) {
                        console.log('[ToolAbort] 用户已停止,跳过工具:', tc.function?.name);
                        if (typeof showToolStatus === 'function') showToolStatus(tc.function?.name || '...', '', 'aborted');
                        body.messages.push({
                            role: 'tool',
                            tool_call_id: tc.id || 'tc_' + Date.now(),
                            content: '[用户已中断操作]'
                        });
                        continue;
                    }

                    if (typeof showToolStatus === 'function') showToolStatus(tc.function?.name || '...', _argPreview, 'running');

                    // ★ 传递工具调用的 abort 信号,让 fetch 也能被中断
                    var _toolAbortCtrl = new AbortController();
                    var _toolAbortKey = chatId + '_tool_' + Date.now();
                    window.__toolAbortControllers = window.__toolAbortControllers || {};
                    window.__toolAbortControllers[_toolAbortKey] = _toolAbortCtrl;
                    
                    // 如果用户中止,同时 abort 工具请求
                    if (userAbortMap[chatId]) {
                        _toolAbortCtrl.abort();
                    }
                    
                    const toolResult = await executeToolCallForRetry(tc, _toolAbortCtrl.signal);
                    
                    // 清理控制器
                    delete window.__toolAbortControllers[_toolAbortKey];
                    if (typeof showToolStatus === 'function') showToolStatus(tc.function?.name || '...', '', toolResult.error ? 'error' : 'success');
                    // ★ 记录统计
                    if (tc.function && tc.function.name) toolCallStats.record(tc.function.name, !!toolResult.error, toolResult.error || '');
                    // ★ 收集 web_fetch 访问的 URL
                    if (tc.function && tc.function.name === 'web_fetch' && toolResult._webFetchUrls && toolResult._webFetchUrls.length > 0) {
                        _allWebFetchUrls = _allWebFetchUrls.concat(toolResult._webFetchUrls);
                        // 去重
                        var _seenUrls = new Set();
                        _allWebFetchUrls = _allWebFetchUrls.filter(function(u) {
                            if (_seenUrls.has(u)) return false;
                            _seenUrls.add(u);
                            return true;
                        });
                    }
                    const resultContent = toolResult.error || toolResult.result || '(empty)';

                    // 确保content是字符串
                    var contentStr = typeof resultContent === 'string'
                        ? resultContent
                        : (resultContent ? JSON.stringify(resultContent) : '(empty)');

                    body.messages.push({
                        role: 'tool',
                        tool_call_id: tc.id || 'tc_' + Date.now(),
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

                // ★ 工具执行循环结束,隐藏状态浮条
                if (typeof showToolStatus === 'function') showToolStatus(null, null, null);
                // ★ 保存 web_fetch 访问的 URL 列表到 pendingMsg
                if (_allWebFetchUrls.length > 0) {
                    pendingMsg._webFetchUrls = _allWebFetchUrls;
                }

                // ★ Agent 模式下:创建子代理后引导模型自主总结,自然结束本轮
                if (_hasCreatedSubAgent) {
                    if (!validToolCalls || !Array.isArray(validToolCalls)) {
                        console.log('[Agent] 已创建子代理,跳过等待逻辑');
                    } else {
                    var onlyCreatedSubAgents = validToolCalls.every(function(tc) {
                        return tc.function && (tc.function.name === 'delegate_task' || tc.function.name === 'engine_agent_create');
                    });
                    if (onlyCreatedSubAgents) {
                        // 本轮只创建了子代理,允许模型继续规划(可能还要创建更多)
                        console.log('[Agent] 本轮只创建了子代理(' + validToolCalls.length + '个),允许继续');
                    } else {
                        // ★ 优雅方式: 不暴力截断,而是给模型注入一个"总结提示"让它自己在下一轮自然结束
                        // 通过修改 pendingMsg.content 末尾追加提示,让模型在下一轮 API 调用时自主收尾
                        var _createdNames = [];
                        validToolCalls.forEach(function(tc) {
                            if (tc.function && (tc.function.name === 'delegate_task' || tc.function.name === 'engine_agent_create')) {
                                try {
                                    var _args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function.arguments || {});
                                    var _n = _args.name || _args.agent_name || _args.role || 'worker';
                                    if (_createdNames.indexOf(_n) === -1) _createdNames.push(_n);
                                } catch(e) {}
                            }
                        });
                        // ★ 给模型注入"请总结"的隐式信号,让它在下一轮自己结束
                        // 实际做法: 不强制 stop,而是在 assistant 消息末尾附加一条 user-role hint
                        // 模型会在下次 API 调用时看到这条 hint 并自动总结
                        console.log('[Agent] 子代理已创建(' + _createdNames.length + '个),允许模型在下一轮自然总结');
                        // 保存当前消息
                        delete pendingMsg.partial;
                        streamingScrollLock = false;
                        try { localStorage.removeItem('_savedPartial'); } catch(e) {}
                        if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
                        pendingMsg.time = Date.now() - startTime;
                        pendingMsg.usage = usage;
                        saveChats();
                        // ★ 追加一条 user hint 到消息历史,作为模型的"自然引导"
                        // 模型下一次 API 调用时会读到这条,然后自主决定: 继续操作 / 总结等待
                        var _namesStr = _createdNames.join(', ');
                        var _hintMsg = '已委派子代理: ' + _namesStr + '。' +
                            '请用一句话总结当前进度,告知用户已委派的任务,然后等待子代理完成。' +
                            '子代理完成后系统会自动通知你整合结果。';
                        chats[chatId].messages.push({
                            role: 'user',
                            text: _hintMsg,
                            _internal: true  // 标记为内部消息,不渲染到界面
                        });
                        // ★ 继续递归,让模型看到 hint 后自主总结
                        // 不 return,继续 attemptRequestWithFreshAbort
                    }
                    }
                }

                // ★ 重置前先杀死旧的 AbortController
                try { abortMain.abort(); } catch(e) {}
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
            // ★ 流结束释放滚动锁定
            streamingScrollLock = false;
            // ★ 清除保存的 partial 标记(已完成,刷新不会丢失)
            try { localStorage.removeItem('_savedPartial'); } catch(e) {}
            // ★ 清除流式保存定时器
            if (pendingMsg._streamSaveTimer) { clearInterval(pendingMsg._streamSaveTimer); pendingMsg._streamSaveTimer = null; }
            pendingMsg.time = Date.now() - startTime;
            pendingMsg.usage = usage;
            saveChats();  // 立即保存,不用 debounce
            // ★ 修复: 不使用 loadChat(全量重渲染),仅更新现有气泡内容
            if (currentChatId === chatId) {
                var _bubble = activeBubbleMap[chatId];
                if (_bubble) {
                    var _md = _bubble.querySelector('.markdown-body');
                    if (_md && pendingMsg.content) {
                        _md.innerHTML = _renderMarkdownWithMath(pendingMsg.content);
                        _triggerPostRender(_md);
                        _bubble.classList.remove('typing');
                    }
                    // ★ 追加生成的图片到气泡(如果有)
                    if (pendingMsg.generatedImages && pendingMsg.generatedImages.length > 0) {
                        var _existingImg = _bubble.querySelector('.generated-images-container');
                        if (!_existingImg) {
                            var _imgCont = document.createElement('div');
                            _imgCont.className = 'generated-images-container';
                            _imgCont.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
                            _bubble.appendChild(_imgCont);
                            // ★ 异步渲染每张图片,避免卡死
                            pendingMsg.generatedImages.forEach(function(_imgData, _idx) {
                                setTimeout(function() {
                                    var _wrap = document.createElement('div');
                                    _wrap.style.cssText = 'position:relative;cursor:pointer;';
                                    var _imgEl = document.createElement('img');
                                    _imgEl.src = _imgData.startsWith('data:') ? _imgData : _imgData;
                                    _imgEl.decoding = 'async';
                                    var _maxW = pendingMsg.generatedImages.length > 1 ? '160px' : '320px';
                                    _imgEl.style.cssText = 'max-width:' + _maxW + ';width:100%;border-radius:8px;display:block;';
                                    _imgEl.setAttribute('loading', 'lazy');
                                    _wrap.appendChild(_imgEl);
                                    _imgCont.appendChild(_wrap);
                                }, _idx * 50);
                            });
                        }
                    }
                    // ★ 渲染 web_fetch 访问的链接列表
                    if (pendingMsg._webFetchUrls && pendingMsg._webFetchUrls.length > 0) {
                        _renderWebFetchUrls(_bubble, pendingMsg._webFetchUrls);
                    }
                }
            }
            // ★ 子代理完成报告处理:触发队列中的下一个通知
            if (window._agentNotifyQueue && window._agentNotifyQueue.length > 0) {
                setTimeout(function() { window._processAgentNotifyQueue(); }, 1000);
            }
            const defaultTitle = text ? text.slice(0, 10) : (files.length ? '文件消息' : '新对话');
            if (!skipUserAdd && chats[chatId].title === defaultTitle) {
                autoGenerateTitle(chatId);
            }
            // ★ Agent 模式: 主动建议(不阻塞主流程)
            if (getAgentMode() === 'agent' && localStorage.getItem('agentProactive') === 'true') {
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

            // ★ 智能降级: 模型不支持工具调用 → 移除 tools 重试
            if (e.message && e.message.includes('does not support tools')) {
                console.warn('[AutoDowngrade] 模型不支持工具调用,降级为普通模式');
                var _curModel = getVal('modelSelect') || '';
                var _noToolList = JSON.parse(localStorage.getItem('noToolModels') || '[]');
                // 提取核心模型名(去掉 :tag 后缀),存储为通用模式
                var _coreModel = (_curModel || '').replace(/:.*$/, '').toLowerCase();
                if (_noToolList.indexOf(_coreModel) === -1 && _coreModel) {
                    _noToolList.push(_coreModel);
                    localStorage.setItem('noToolModels', JSON.stringify(_noToolList));
                }
                // 从 body 中移除 tools/tool_choice(无论是否有,都清理掉)
                delete body.tools;
                delete body.tool_choice;
                // 清理消息历史中的 tool_calls(若之前有成功执行过工具)
                for (var _mi = 0; _mi < body.messages.length; _mi++) {
                    var _mm = body.messages[_mi];
                    if (_mm.role === 'assistant') {
                        delete _mm.tool_calls;
                    }
                }
                // 清理 pendingMsg
                if (pendingMsg) {
                    pendingMsg.content = '';
                    pendingMsg.reasoning = '';
                }
                showToast('⚠️ 模型不支持工具调用,已切换为普通问答模式', 'warning', 4000);
                try { abortMain.abort(); } catch(e) {}
                var _downgradeCtrl = new AbortController();
                abortControllerMap[chatId] = _downgradeCtrl;
                clearTimeout(timeoutId);
                var _downgradeTimeout = parseInt(getVal('requestTimeout')) * 1000;
                var _downgradeTimer = setTimeout(function() { _downgradeCtrl.abort(); }, _downgradeTimeout);
                return attemptRequestWithFreshAbort(attempt, _downgradeCtrl, _downgradeTimer);
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
                    try { abortMain.abort(); } catch(e) {}
                    const retryCtrl = new AbortController();
                    abortControllerMap[chatId] = retryCtrl;
                    clearTimeout(timeoutId);
                    const retryTimeoutId = setTimeout(function() { retryCtrl.abort(); }, parseInt(getVal('requestTimeout')) * 1000);
                    return attemptRequestWithFreshAbort(attempt, retryCtrl, retryTimeoutId);
                }
            }

            const isUpstreamError = e.message === 'UPSTREAM_ERROR' || e.message.includes('upstream') || e.message.includes('bad response');
            const isHTTP2Error = (e.name === 'TypeError' && (e.message.includes('fetch') || e.message.includes('Failed to') || e.message.includes('net::') || e.message.includes('ERR_')))
                || e.message.includes('HTTP2') || e.message.includes('h2') || e.message.includes('protocol error') || e.message.includes('protocol_error');
            const isNetError = e.name === 'AbortError' || e.message.includes('timeout') || e.message.includes('aborted') || isUpstreamError || isHTTP2Error;
            if (isNetError && attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
                showToast(`网络超时,${attempt + 1}/${maxRetries},${(delay/1000).toFixed(0)}s后重试...`, 'warning', 3000);
                await new Promise(r => setTimeout(r, delay));
                // ★ 重试前先杀死旧请求,避免新旧请求并发
                try { abortCtrl.abort(); } catch(e) {}
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
            if (retried) return;
        }
        // ★ 智能降级(外层兜底): 模型不支持工具调用
        if (e.message && e.message.includes('does not support tools')) {
            var _ocModel = getVal('modelSelect') || '';
            var _ocList = JSON.parse(localStorage.getItem('noToolModels') || '[]');
            var _ocCore = (_ocModel || '').replace(/:.*$/, '').toLowerCase();
            if (_ocList.indexOf(_ocCore) === -1 && _ocCore) {
                _ocList.push(_ocCore);
                localStorage.setItem('noToolModels', JSON.stringify(_ocList));
            }
            // 删掉失败的助手消息,重新发送
            if (chatId && chats[chatId]) {
                var _ocMsgs = chats[chatId].messages;
                for (var _oci = _ocMsgs.length - 1; _oci >= 0; _oci--) {
                    if (_ocMsgs[_oci].role === 'assistant' && _ocMsgs[_oci].partial) {
                        _ocMsgs.splice(_oci, 1);
                        break;
                    }
                }
                saveChats();
            }
            showToast('⚠️ 模型不支持工具调用,已切换模式,请重新发送', 'warning', 3000);
            // 不清除 pendingMsg,让用户看到气泡
            if (currentBubble) {
                currentBubble.classList.remove('typing');
                var _ocMb = currentBubble.querySelector('.markdown-body');
                if (_ocMb) _ocMb.innerHTML = '⚠️ 该模型不支持工具调用,已自动降级为普通模式。请重新发送。';
            }
            if (pendingMsg) {
                delete pendingMsg.partial;
                pendingMsg.content = '⚠️ 该模型不支持工具调用,已自动降级为普通模式。请重新发送。';
            }
            return; // 不走到 handleError
        }
        handleError(e, chatId, pendingMsg, currentBubble);
    } finally {
        // 清理临时消息
        chats[chatId].messages = chats[chatId].messages.filter(m => !m.temporary);
        delete isTypingMap[chatId];
        // ★ 停止流渲染 RAF 循环
        cleanupStreamState(chatId);
        delete abortControllerMap[chatId];
        delete searchAbortControllerMap[chatId];
        delete activeBubbleMap[chatId];
        delete userAbortMap[chatId];  // 清理用户中止标记
        window._agentNotifyProcessing = false;
        // ★ 主动检查是否有积压的子代理通知需要处理
        if (window._hasPendingSubAgentNotify || (Array.isArray(window._agentNotifyQueue) && window._agentNotifyQueue.length > 0)) {
            window._hasPendingSubAgentNotify = false;
            setTimeout(function() { window._processAgentNotifyQueue(); }, 500);
        }
        if (currentChatId === chatId) {
            if ($.sendBtn) $.sendBtn.classList.remove('hidden');
            if ($.stopBtn) $.stopBtn.classList.remove('visible');
        }
        if (currentChatId === chatId) loadChat(chatId);
        // ★ AI 自主记忆: 对话结束后自动提取重要信息
        if (!window.__autoMemoryPending) {
            window.__autoMemoryPending = true;
            setTimeout(function() {
                window._autoSaveMemoriesFromChat(chatId);
                window.__autoMemoryPending = false;
            }, 2000);
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

/** 获取当前模型的 context 长度 */
function getModelContextLength(modelName) {
    if (!modelName) modelName = getVal('modelSelect') || DEFAULT_CONFIG.model;
    var key = modelName.toLowerCase().trim();
    var fromLocal = modelContextLength[key];
    if (fromLocal && !isNaN(fromLocal)) return parseInt(fromLocal);
    // 尝试从 models.js / MODEL_CONFIGS 获取
    if (window.MODEL_CONFIGS && typeof window.MODEL_CONFIGS.getContext === 'function') {
        try {
            var ctx = window.MODEL_CONFIGS.getContext(modelName);
            if (ctx && !isNaN(ctx)) return parseInt(ctx);
        } catch(e) {}
    }
    // 默认 128K
    return 131072;
}

/** 估算消息 token 数 (粗略,7bit/char) */
function estimateTokenCount(text) {
    if (!text) return 0;
    // 英文 ~1 token/4 chars, 中文 ~1 token/2 chars
    var en = (text.match(/[a-zA-Z0-9\s.,!?;:'"()\[\]{}\/\\@#$%^&*+=<>~`\-|_]/g) || []).length;
    var cn = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
    return Math.ceil(en / 4) + Math.ceil(cn / 1.5);
}

/** 计算消息数组的总 token 估算 */
function estimateMessagesTokenCount(msgs) {
    if (!msgs || !msgs.length) return 0;
    var total = 0;
    for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        total += estimateTokenCount(m.content || m.text || '');
        // 角色标记开销
        total += 4;
        // system message 额外开销
        if (m.role === 'system') total += 16;
    }
    // 格式开销 (role + metadata 等)
    total += msgs.length * 8;
    return total;
}

/**
 * 智能选择压缩模型
 * 如果当前模型 context >= 128K, 用模型自身压缩
 * 否则使用 deepseek-chat
 */
function selectCompressModel() {
    var currentModel = getVal('modelSelect') || DEFAULT_CONFIG.model;
    var ctxLen = getModelContextLength(currentModel);
    if (ctxLen >= 131072) {
        return currentModel;
    }
    return 'deepseek-chat';
}

/**
 * 显示/隐藏压缩进度 SVG spinner
 */
function showCompressSpinner() {
    var el = document.getElementById('compressSpinner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'compressSpinner';
        el.className = 'compress-spinner';
        var container = $.chatMessagesContainer || document.getElementById('chatMessagesContainer');
        if (container) {
            container.appendChild(el);
        }
    }
    el.innerHTML = '<div class="compress-spinner-inner">' +
        '<svg class="compress-spinner-svg" viewBox="0 0 50 50" width="24" height="24">' +
        '<circle cx="25" cy="25" r="20" fill="none" stroke="#e5e7eb" stroke-width="4"/>' +
        '<circle cx="25" cy="25" r="20" fill="none" stroke="#6366f1" stroke-width="4" stroke-dasharray="90 150" stroke-linecap="round">' +
        '<animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="0.8s" repeatCount="indefinite"/>' +
        '</circle></svg>' +
        '<span>压缩上下文中...</span></div>';
    el.style.display = '';
}

function hideCompressSpinner() {
    var el = document.getElementById('compressSpinner');
    if (el) el.style.display = 'none';
}

/**
 * ★ 智能上下文压缩 (替换旧版):
 * 1. 检测是否达到 context 80%
 * 2. 自动选择压缩模型
 * 3. 保留 system prompt + 第一条用户消息 + 最近 N 条消息
 * 4. 显示 SVG spinner
 */
async function compressContextIfNeeded(chatId) {
    if (chats[chatId]?._compressFailed) return;
    if (!getChecked('compressToggle')) return;

    const msgs = chats[chatId].messages;
    var currentModel = getVal('modelSelect') || DEFAULT_CONFIG.model;
    var contextLimit = getModelContextLength(currentModel);
    var estimatedTokens = estimateMessagesTokenCount(msgs);
    var thresholdPct = parseInt(getVal('compressThreshold')) || 10;

    // 检测是否达到 context 的 80%
    var limit80 = Math.floor(contextLimit * 0.8);
    if (estimatedTokens < limit80) {
        // 还没到 80%, 按原消息数量阈值检查
        var sysMessages = msgs.filter(function(m) { return m.role === 'system' && !m.temporary; });
        var partial = msgs.filter(function(m) { return m.partial; });
        var nonPartial = msgs.filter(function(m) { return m.role !== 'system' && !m.partial && !m.temporary; });
        if (nonPartial.length <= thresholdPct) return;
    }

    showCompressSpinner();

    try {
        var sysMessages = msgs.filter(function(m) { return m.role === 'system' && !m.temporary; });
        var partial = msgs.filter(function(m) { return m.partial; });
        var nonPartial = msgs.filter(function(m) { return m.role !== 'system' && !m.partial && !m.temporary; });

        if (nonPartial.length <= thresholdPct && estimatedTokens < limit80) {
            hideCompressSpinner();
            return;
        }

        // ★ 智能压缩策略:
        // 保留: system prompt + 第一条用户消息 + 最近 N 条消息
        var firstUserIndex = -1;
        for (var i = 0; i < nonPartial.length; i++) {
            if (nonPartial[i].role === 'user') {
                firstUserIndex = i;
                break;
            }
        }

        var keep = Math.max(4, Math.floor(thresholdPct / 2));
        var toSummarize = [];
        var toKeepNonPartial = [];

        if (firstUserIndex >= 0) {
            // 保留第一条用户消息
            toKeepNonPartial.push(nonPartial[firstUserIndex]);
            // 保留最近 keep 条
            var recentStart = Math.max(firstUserIndex + 1, nonPartial.length - keep);
            for (var j = recentStart; j < nonPartial.length; j++) {
                toKeepNonPartial.push(nonPartial[j]);
            }
            // 中间的摘录
            for (var k = firstUserIndex + 1; k < recentStart; k++) {
                toSummarize.push(nonPartial[k]);
            }
        } else {
            // 没有用户消息,保留最近 keep 条
            toKeepNonPartial = nonPartial.slice(-keep);
            toSummarize = nonPartial.slice(0, nonPartial.length - keep);
        }

        if (toSummarize.length === 0 && estimatedTokens < limit80) {
            hideCompressSpinner();
            return;
        }

        // 构建摘要
        var conv = '';
        for (var si = 0; si < toSummarize.length; si++) {
            var m = toSummarize[si];
            if (m.role === 'user') {
                conv += '用户: ' + (m.text || m.content || '').substring(0, 2000) + '\n';
            } else {
                conv += '助手: ' + (m.content || '').substring(0, 2000) + '\n';
            }
        }

        var compressPrompt = '总结以下对话的核心内容,保留关键信息和你作为助手的推理结论:\n' + conv;

        // ★ 自动选择压缩模型
        var compressModel = selectCompressModel();

        var compressBody = {
            model: compressModel,
            messages: [{ role: 'user', content: compressPrompt }],
            temperature: 0.3,
            max_tokens: 800
        };
        compressBody.extra_body = { thinking: { type: 'disabled' } };

        var res = await fetch(getVal('baseUrl') + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + getVal('apiKey')
            },
            body: JSON.stringify(compressBody)
        });
        var data = await res.json();
        var summary = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '';

        if (!summary) {
            hideCompressSpinner();
            if (chats[chatId]) chats[chatId]._compressFailed = true;
            return;
        }

        var summaryMsg = { role: 'system', content: '[智能摘要] ' + summary, temporary: true };
        var newMessages = sysMessages.concat([summaryMsg]).concat(toKeepNonPartial).concat(partial);
        chats[chatId].messages = newMessages;
        saveChats();
        if (currentChatId === chatId) loadChat(chatId);

        showToast('\u2705 \u5df2\u538b\u7f29\u4e0a\u4e0b\u6587 (\u4f7f\u7528 ' + compressModel + ')', 'success', 3000);
    } catch (e) {
        console.warn('[compressContext] \u538b\u7f29\u5931\u8d25:', e.message);
        if (chats[chatId]) chats[chatId]._compressFailed = true;
        showToast('\u4e0a\u4e0b\u6587\u538b\u7f29\u5931\u8d25,\u5df2\u8df3\u8fc7\u3002', 'error', 4000);
    } finally {
        hideCompressSpinner();
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
    // ★ 标题生成: 优先用 titleModel, 没设置就用当前主模型, 实在没有再 fallback
    const model = getVal('titleModel') || getVal('modelSelect') || 'deepseek-v4-flash';
    // ★ 用当前 API 生成标题,对不兼容的 API 做参数清理
    var _titleBaseUrl = getVal('baseUrl');
    var _titleApiKey = getVal('apiKey');
    var _isLocalTitle = _titleBaseUrl.includes('localmodels') || _titleBaseUrl.includes('localhost') || _titleBaseUrl.includes('127.0.0.1');
    var _isMiniMax = _titleBaseUrl.includes('minimaxi.com');
    if (!model) return;
    if (!_titleApiKey && !_isLocalTitle) return;
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
        // 关闭思考模式(DeepSeek/OpenAI 兼容),MiniMax/llamacpp 不支持这些参数
        if (!_isMiniMax && !_isLocalTitle) {
            body.extra_body = body.extra_body || {};
            body.extra_body.thinking = { type: "disabled" };
        }
        body.reasoning_split = false;
        const res = await fetch(_titleBaseUrl + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(_isLocalTitle ? {} : { Authorization: 'Bearer ' + _titleApiKey }) },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        let rawTitle = (data.choices[0].message.content || data.choices[0].message.reasoning_content || '').trim();
        if (!rawTitle || rawTitle.length < 2) {
            rawTitle = (data.choices[0].message.reasoning_content || '').trim();
        }
        // ★ 如果 content 太长(>200字),说明可能包含了思考/废话,取最后一句
        if (rawTitle.length > 200) {
            var _lines = rawTitle.split(/\n/);
            var _last = _lines[_lines.length - 1] || rawTitle.slice(-50);
            rawTitle = _last.trim();
        }
        // 清理 think 标签
        rawTitle = rawTitle.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        // 清理星号包裹(MiniMax 等模型喜欢加 **粗体**)
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
            .replace(/^(标题[::]?\s*|我.*?[,,]\s*|根据.*?[,,]\s*|对话标题[::]?\s*|好的?\s*[,,]?\s*)/i, '')
            .replace(/[。,、!?!?,;;\n].*$/s, '')
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
        if (!chats[chatId]) return;
        chats[chatId].title = finalTitle;
        saveChatsDebounced();
        renderChatHistory();
        updateHeaderTitle();
        return;
    }
    if (index === 0) {
        if (!chats[chatId]) return;
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
    // ★ 立即保存到服务器(不延迟,异步不阻塞)
    saveChatsToServer();

    // ★ 本地压缩:用 requestIdleCallback 在空闲时执行,不阻塞 UI
    var _saveSlim = function() { slimSaveChats(); };
    if (window.requestIdleCallback) {
        requestIdleCallback(_saveSlim, { timeout: 3000 });
    } else {
        setTimeout(_saveSlim, 500);
    }
}

// 压缩聊天记录(现在只做浅拷贝,不删除任何图片数据)
function compressChatsForStorage(chatsObj) {
    // ★ 精简副本:保留图片等完整数据,仅在 localStorage 超出配额时降级
    const slim = {};
    const chatIds = Object.keys(chatsObj).sort((a, b) => {
        const ta = chatsObj[a].updated_at || '';
        const tb = chatsObj[b].updated_at || '';
        return tb.localeCompare(ta); // 最新的排前面
    });

    // 保留最近 N 个聊天的完整数据
    const MAX_CHATS = 50;
    chatIds.forEach((id, idx) => {
        const chat = chatsObj[id];
        // 保留所有聊天的完整消息,不做截断
        slim[id] = JSON.parse(JSON.stringify(chat));
        if (slim[id].messages) {
            slim[id].messages = slim[id].messages.map(function(msg) {
                // 截断超长消息内容
                if (msg.content && msg.content.length > 10000) {
                    msg.content = msg.content.slice(0, 10000) + '...(内容已截断)';
                }
                // ★ 截断 web_fetch URL 列表 (最多保留10条)
                if (msg._webFetchUrls && msg._webFetchUrls.length > 10) {
                    msg._webFetchUrls = msg._webFetchUrls.slice(0, 10);
                }
                return msg;
            });
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
        // localStorage 配额不足,去掉图片后重试
        try {
            const fallback = {};
            Object.keys(chats).slice(-15).forEach(function(id) {
                var c = JSON.parse(JSON.stringify(chats[id]));
                if (c.messages) {
                    c.messages = c.messages.map(function(msg) {
                        if (msg.files) {
                            msg.files = msg.files.map(function(f) {
                                if (f.content && (f.isImage || f.isVideo || (f.type && (f.type.startsWith('image/') || f.type.startsWith('video/'))))) {
                                    return { name: f.name, type: f.type || (f.isImage ? 'image/png' : 'video/mp4'), size: f.size, isImage: f.isImage, isVideo: f.isVideo, content: '', serverUrl: f.serverUrl || '' };
                                }
                                if (f.content && f.content.length > 5000) {
                                    return { name: f.name, type: f.type, size: f.size, isImage: f.isImage, isVideo: f.isVideo, content: '', serverUrl: f.serverUrl || '' };
                                }
                                return f;
                            });
                        }
                        return msg;
                    });
                }
                fallback[id] = c;
            });
            localStorage.setItem('chats', JSON.stringify(fallback));
            return true;
        } catch(e2) {
            // 还不行,只保留最近5个聊天的骨架
            try {
                const mini = {};
                Object.keys(chats).slice(-5).forEach(function(id) {
                    mini[id] = { title: chats[id].title || '新对话', updated_at: chats[id].updated_at || '', messages: (chats[id].messages || []).slice(-2) };
                });
                localStorage.setItem('chats', JSON.stringify(mini));
                return true;
            } catch(e3) {
                return false;
            }
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
        // ★ 过滤: 排除 agent 独立聊天
        if (id === AGENT_CHAT_ID || id === '_agent_main') return false;
        return !_uid || !chats[id].userId || chats[id].userId === _uid;
    });
    // ★ 兜底: 如果过滤后为空但有userId,从 localStorage 重新加载
    if (_chatIds.length === 0 && _uid) {
        var _cached = localStorage.getItem('chats');
        if (_cached) {
            try {
                var _parsed = JSON.parse(_cached);
                if (_parsed && Object.keys(_parsed).length > 0) {
                    chats = _parsed;
                    _chatIds = Object.keys(chats).filter(function(id) {
                        if (id === AGENT_CHAT_ID || id === '_agent_main') return false;
                        return !_uid || !chats[id].userId || chats[id].userId === _uid;
                    });
                }
            } catch(e) {}
        }
    }
    // ★ 按更新时间排序,最新的在最上面
    _chatIds.sort(function(a, b) {
        var ta = chats[a].updated_at || chats[a].time || 0;
        var tb = chats[b].updated_at || chats[b].time || 0;
        if (ta !== tb) return tb - ta;
        // ★ 时间相同时按聊天ID降序稳定排序,避免刷新后乱跳
        return a < b ? 1 : (a > b ? -1 : 0);
    });
    list.innerHTML = _chatIds.map(id => `
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
    _deletedChatIds[id] = true; // 标记删除,合并时排除
    delete chats[id];
    try { localStorage.setItem('_deletedChatIds', JSON.stringify(_deletedChatIds)); } catch(e) {}

    // ★ 保存聊天记录(自动通过 saveChatsToServer 合并时排除已删除聊天)
    saveChats();
    // ★ 只检查当前用户的聊天数量,忽略其他用户的残留
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
        updated_at: Date.now(),
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
    if (!chats[id]) { console.warn('[loadChat] 聊天不存在:', id); return; }
    currentChatId = id;
    localStorage.setItem('lastChatId', id);
    const container = $.chatMessagesContainer;
    if (!container) return;

    const prefix = container.classList.contains('paragraph-prefix-dot') ? 'dot' : (container.classList.contains('paragraph-prefix-dash') ? 'dash' : 'none');
    container.innerHTML = '';
    applyParagraphPrefix(prefix);

    // ★ 恢复刷新前未完成的流式消息(先清理旧pendingMsg,再恢复)
    try {
        var savedPartial = JSON.parse(localStorage.getItem('_savedPartial') || 'null');
        if (savedPartial && savedPartial.chatId === id && (savedPartial.content || savedPartial.reasoning)) {
            // ★ 在恢复前先清理旧的 partial 消息(避免重复)
            chats[id].messages = chats[id].messages.filter(function(m) {
                return !m.partial;
            });
            var _recTime = savedPartial.time || Date.now();
            chats[id].messages.push({
                role: 'assistant',
                content: savedPartial.content || '',
                reasoning: savedPartial.reasoning || '',
                partial: true,
                time: _recTime,
                _recovered: true
            });
        }
    } catch(e) {}
    // ★ 标记待恢复:仅当流式确实在进行中(有内容且最近)才触发自动续生
    if (savedPartial && savedPartial.chatId === id && (savedPartial.content || savedPartial.reasoning)) {
        var _age = Date.now() - (savedPartial.time || 0);
        var _hasContent = (savedPartial.content && savedPartial.content.length > 0) || (savedPartial.reasoning && savedPartial.reasoning.length > 0);
        if (_hasContent && _age < 120000) {
            window._pendingRecovery = savedPartial;
        } else {
            console.log('[loadChat] 跳过过期或不完整的partial恢复, age=' + (_age/1000).toFixed(1) + 's');
        }
    }
    // ★ 清理 localStorage,避免下次重复恢复
    try { localStorage.removeItem('_savedPartial'); } catch(e) {}

    // ★ Agent 模式: 加载记忆/人格/身份,注入 system prompt
    if (id === AGENT_CHAT_ID) {
        _injectAgentMemoryIntoSystem(id);
    }

    // ★ 过滤显示:system 消息和内部消息不显示给用户
    const displayMsgs = chats[id].messages.filter(function(m) {
        if (m._internal) return false;
        return m.role !== 'system';
    });
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
                var _bubble = appendMessage('assistant', displayText, null, m.reasoning, m.usage, m.time, i === displayMsgs.length - 1, m.generatedImage || null, m.generatedImages || null);
                // ★ 恢复时也渲染 web_fetch 链接列表
                if (_bubble && m._webFetchUrls && m._webFetchUrls.length > 0) {
                    _renderWebFetchUrls(_bubble, m._webFetchUrls);
                }
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

    // 加载完成后自动滚动(loadChat 模式不受距离限制)
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
    // 已迁移至 HTML 静态渲染(知识库按钮现位于数据管理区域内)
}

function createResetButton() {
    if (!getEl('resetConfigBtn')) return;
    // 按钮已迁移至 HTML 静态渲染,只需绑定事件
    getEl('resetConfigBtn').addEventListener('click', resetConfig);
}

function resetConfig() {
    if (!confirm('确定恢复所有设置为默认值吗?此操作将刷新页面。')) return;
    // 配置相关的 localStorage 键列表(与 saveConfig 中存储的键保持一致)
    const configKeys = [
        'apiKey', 'baseUrl', 'systemPrompt', 'model', 'temp', 'tokens',
        'stream', 'requestTimeout',
        'compress', 'threshold', 'customParams', 'customEnabled',
        'lineHeight', 'paragraphMargin',
        'markdownGFM', 'markdownBreaks', 'titleModel',
        'enableSearch', 'aiSearchJudge', 'aiSearchJudgeModel', 'aiSearchJudgePrompt',
        'searchModel', 'searchProvider', 'searchApiKey', 'searchRegion',
        'searchTimeout', 'maxSearchResults', 'fontSize',
        'searchType', 'aiSearchTypeToggle', 'searchShowPrompt', 'searchAppendToSystem',
        'visionModel', 'visionApiUrl', 'visionApiKey',
        'imageProvider', 'imageModel', 'imageBaseUrl', 'imageApiKey',
        'imageApiKeyOpenrouter', 'imageBaseUrlOpenrouter'
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
                    alert('无效的导入文件:缺少 "chats" 字段');
                    return;
                }
                                var imported = 0;
                for (var id in data.chats) {
                    var newId = id;
                    if (chats[id]) {
                        newId = 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                    }
                    chats[newId] = JSON.parse(JSON.stringify(data.chats[id]));
                    // 清除用户隔离标记,确保当前账号能看到
                    delete chats[newId].userId;
                    if (!chats[newId].messages) chats[newId].messages = [];
                    imported++;
                }
                renderChatHistory();
                alert('导入完成:新增 ' + imported + ' 个聊天');
                console.log('[import] 导入:', imported);
                // 保存到服务器
                saveChats();
                // 保存到服务器
                saveChatsToServer();
            } catch(err) {
                alert('导入失败:' + err.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ★ 创建数据管理区域
function createDataManagementSection() {
    if (!getEl('dataManagementSection')) return;
    // 事件绑定(HTML已静态渲染)
    getEl('exportChatsBtn')?.addEventListener('click', exportChats);
    getEl('exportCurrentChatBtn')?.addEventListener('click', exportCurrentChat);
    getEl('importChatsBtn')?.addEventListener('click', importChats);
}
// ==================== 初始化配置 ====================
function initializeConfig() {
    var savedProvider = localStorage.getItem('baseUrlProvider') || 'deepseek';
    setVal('baseUrlProvider', savedProvider);
    var _provCfg = API_PROVIDERS[savedProvider] || API_PROVIDERS.custom;
    var _rawK = localStorage.getItem(_provCfg.keyLS);
    var _pk = '';
    if (_rawK) { _pk = decrypt(_rawK) || ''; if (_pk === 'not-needed') _pk = ''; }
    // 兼容旧数据: DeepSeek 之前存 apiKey
    if (!_pk && _provCfg.keyLS === 'apiKeyDeepseek') { var _old = localStorage.getItem('apiKey'); if (_old) { _pk = decrypt(_old) || ''; if (_pk === 'not-needed') _pk = ''; } }
    setVal('apiKey', _pk);
    var _lab = getEl('apiKeyLabel'); if (_lab) _lab.textContent = 'API Key (' + _provCfg.label + ')';
    if (savedProvider === 'custom') setVal('baseUrl', localStorage.getItem('baseUrlCustom') || '');
    else if (_provCfg.baseUrl) setVal('baseUrl', _provCfg.baseUrl);
    else setVal('baseUrl', localStorage.getItem('baseUrl') || DEFAULT_CONFIG.url);
    var _pm = localStorage.getItem('model_' + savedProvider) || localStorage.getItem('model') || DEFAULT_CONFIG.model;
    setVal('modelSelect', _pm);
    setVal('visionModel', localStorage.getItem('visionModel') || DEFAULT_CONFIG.visionModel || '');
    setVal('visionApiUrl', localStorage.getItem('visionApiUrl') || DEFAULT_CONFIG.visionApiUrl || '');
    const storedVisionKey = decrypt(localStorage.getItem('visionApiKey') || '');
    const cleanVisionKey = (storedVisionKey && storedVisionKey !== 'not-needed') ? storedVisionKey : '';
    setVal('visionApiKey', cleanVisionKey || '');
    // 视觉理解提供商
    var _visionProvider = localStorage.getItem('visionProvider') || 'minimax';
    if (getEl('visionProvider')) getEl('visionProvider').value = _visionProvider;
    window._lastVisionProvider = _visionProvider;
    // 加载 OpenAI Vision 的配置
    const storedOAKey = decrypt(localStorage.getItem('visionApiKeyOpenAI') || '');
    setVal('visionApiKeyOpenAI', (storedOAKey && storedOAKey !== 'not-needed') ? storedOAKey : '');
    setVal('visionApiUrlOpenAI', localStorage.getItem('visionApiUrlOpenAI') || 'https://api.openai.com/v1');
    const storedImageKey = decrypt(localStorage.getItem('imageApiKey') || '');
    const cleanImageKey = (storedImageKey && storedImageKey !== 'not-needed') ? storedImageKey : '';
    setVal('imageApiKey', cleanImageKey || '');
    setVal('imageModel', localStorage.getItem('imageModel') || DEFAULT_CONFIG.imageModel || '');
    setVal('imageBaseUrl', localStorage.getItem('imageBaseUrl') || DEFAULT_CONFIG.imageBaseUrl || '');
    const storedOrKey_Final = decrypt(localStorage.getItem('imageApiKeyOpenrouter') || '');
    const cleanOrKey_Final = (storedOrKey_Final && storedOrKey_Final !== 'not-needed') ? storedOrKey_Final : '';
    setVal('imageApiKeyOpenrouter', cleanOrKey_Final || '');
    setVal('imageBaseUrlOpenrouter', localStorage.getItem('imageBaseUrlOpenrouter') || 'https://openrouter.ai/api');
    setVal('imageProvider', localStorage.getItem('imageProvider') || DEFAULT_CONFIG.imageProvider || 'minimax');
    // ★ 搜索配置必须早于 toggleImageProviderFields(因为后者会触发 saveConfig)
    createSearchConfigSection();
    bindSearchEvents();
    loadSearchConfig();
    createSearchToggleButton();
    toggleImageProviderFields();
    setVal('systemPrompt', localStorage.getItem('systemPrompt') || DEFAULT_CONFIG.system);
    setVal('customParams', localStorage.getItem('customParams') || DEFAULT_CONFIG.customParams);
    setChecked('customParamsToggle', localStorage.getItem('customEnabled') === 'true');

    const temp = localStorage.getItem('temp') || '0.7';
    setVal('temperature', temp);
    const tempSpan = getEl('tempValue');
    if (tempSpan) tempSpan.innerText = temp;

    // ★ 完全按用户配置,不匹配模型
    const tokens = localStorage.getItem('tokens') || '4096';
    setVal('maxTokens', tokens);
    setVal('maxTokensInput', tokens);

    setChecked('streamToggle', localStorage.getItem('stream') !== 'false');
    setVal('requestTimeout', localStorage.getItem('requestTimeout') || DEFAULT_CONFIG.requestTimeout);
    setChecked('compressToggle', localStorage.getItem('compress') === 'true');
    setVal('compressThreshold', localStorage.getItem('threshold') || '10');
    // ★ compressModel 改为只读显示自动选择的模型
    var compressSel = getEl('compressModel');
    if (compressSel) {
        compressSel.value = 'auto';
        compressSel.disabled = true;
        compressSel.title = '自动选择: 当前模型 context ≥ 128K 用自身, 否则用 deepseek-chat';
    }

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
        // 不再使用自定义 paragraph renderer(marked v15 默认已正确处理,自定义 renderer 会导致 [object Object])
    }

    if (localStorage.getItem('dark') === 'true') toggleDarkMode(true);
    else {
        const theme = getEl('hljsTheme');
        if (theme) theme.href = 'lib/atom-one-light.min.css';
    }

    createTitleModelSelector();
    initFontSize();
    if (window.initToolModeBtn) initToolModeBtn();
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
            // ★ 移动端:聊天标题不放入 header(避免撑爆布局),改用浮动标签放在聊天区域顶部
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
    var mode = getAgentMode();
    var isActive = mode === 'agent' || mode === 'yolo';
    setChecked('agentModeToggle', isActive);
    setChecked('agentAutoDecision', localStorage.getItem('agentAutoDecision') !== 'false');
    setChecked('agentProactive', localStorage.getItem('agentProactive') === 'true');
    setVal('agentMaxToolRounds', localStorage.getItem('agentMaxToolRounds') || '30');
    setVal('agentThinkingDepth', localStorage.getItem('agentThinkingDepth') || 'standard');
    setVal('agentSystemPrompt', localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt);
    setVal('ttsProvider', localStorage.getItem('ttsProvider') || 'minimax');
    setVal('ttsApiKey', (function(){try{return decrypt(localStorage.getItem('ttsApiKey')||'')||'';}catch(e){return '';}})());
    // TTS 音色: 如果存储的值不在下拉选项中, 追加 custom option
    (function(){
        var voiceSel = getEl('ttsVoiceId');
        if (voiceSel) {
            var savedVoice = localStorage.getItem('ttsVoiceId') || 'male-qn-qingse';
            var found = false;
            for (var i = 0; i < voiceSel.options.length; i++) {
                if (voiceSel.options[i].value === savedVoice) { found = true; break; }
            }
            if (!found && savedVoice) {
                var opt = document.createElement('option');
                opt.value = savedVoice;
                opt.textContent = savedVoice + ' (已保存)';
                voiceSel.insertBefore(opt, voiceSel.lastElementChild);
            }
            voiceSel.value = savedVoice;
        }
    })();
    setVal('ttsSpeed', localStorage.getItem('ttsSpeed') || '1.0');
    // 更新三模式选择器
    updateModeSelector(mode);
    // ★ Agent/YOLO 模式下强制启用工具调用
    if (isActive) {
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
            if (streamingScrollLock) return;  // 流式期间锁定滚动跟随
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
            // ★ 优先处理文件,其次处理拖拽文字
            if (e.dataTransfer.files.length) {
                await processSelectedFiles(e.dataTransfer.files);
            } else {
                // 拖拽进来的纯文本:插入到光标位置
                var _dropText = e.dataTransfer.getData('text/plain');
                if (_dropText && $.userInput) {
                    insertTextAtCursor($.userInput, _dropText);
                }
            }
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
            var _p = getEl('slashPopup');
            var _vis = _p && window._slashVisible;
            if (e.key === 'ArrowDown' && _vis) { e.preventDefault(); navigateSlashPopup(1); return; }
            if (e.key === 'ArrowUp' && _vis) { e.preventDefault(); navigateSlashPopup(-1); return; }
            if (e.key === 'Escape' && _vis) { e.preventDefault(); hideSlashPopup(); return; }
            if (e.key === 'Enter' && !e.shiftKey) {
                if (_vis) {
                    e.preventDefault();
                    var _sel = _p.querySelector('.slash-item-highlight');
                    if (_sel) { selectSlashCommand(_sel.dataset.cmd, _sel.dataset.args); }
                    return;
                }
                e.preventDefault();
                sendMessage();
            }
        });
        window.autoResize($.userInput);
        $.userInput.addEventListener('input', function () { window.autoResize(this); handleSlashInput(this); });
        window.addEventListener('resize', debounce(() => window.autoResize($.userInput), 100));
    }

    // ★ 配置自动保存:配置面板内任意输入框/选择框/开关变更时自动保存到 localStorage + 服务器
    // ★ 主模型API Key/地址: 仅change(失焦)时触发,避免打字过程中反复报错
    var _panel = $.configPanel || getEl('configPanel');
    if (_panel) {
        _panel.querySelectorAll('input, select, textarea').forEach(function(el) {
            // ★ baseUrlProvider 有独立的 onProviderChange handler,不在此触发 saveConfig
            if (el.id === 'baseUrlProvider') return;
            el.addEventListener('change', function() { saveConfig(); });
            if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio') {
                // API Key 和 Base URL 只在失焦时保存,打字过程不触发
                if (el.id === 'apiKey' || el.id === 'baseUrl') return;
                el.addEventListener('input', debounce(function() { saveConfig(); }, 500));
            }
        });
    }

    // ★ 图像提供商切换:更新字段提示
    var _imgProvider = getEl('imageProvider');
    if (_imgProvider) {
        _imgProvider.addEventListener('change', function() {
            window._isUserChangingProvider = true;
            toggleImageProviderFields();
        });
    }
    // ★ 绑定 provider change
    var _urlSel = getEl('baseUrlProvider');
    if (_urlSel && !_urlSel._providerBound) {
        _urlSel._providerBound = true;
        _urlSel.addEventListener('change', window.onProviderChange);
    }
}

function loadInitialData() {
    // ★ 延迟加载模型列表,不阻塞首次渲染
    setTimeout(fetchModels, 500);

    // ★ 如果聊天列表为空但已登录,延迟重试(可能 restoreUserData 还没完成)
    var _uid = localStorage.getItem('authUserId') || '';
    if (_uid && Object.keys(chats).filter(function(id) {
        if (id === AGENT_CHAT_ID || id === '_agent_main') return false;
        return !chats[id].userId || chats[id].userId === _uid;
    }).length === 0) {
        // 延迟 2s 再次尝试从服务器加载
        setTimeout(async function() {
            try {
                var _schats = await loadChatsFromServer();
                if (_schats && typeof _schats === 'object' && Object.keys(_schats).length > 0) {
                    var _added = 0;
                    for (var _scid in _schats) {
                        if (!chats[_scid]) {
                            chats[_scid] = _schats[_scid];
                            _added++;
                        }
                    }
                    if (_added > 0) {
                        console.log('[loadInitialData] 延迟补充了', _added, '个聊天');
                        try { slimSaveChats(); } catch(e) {}
                        renderChatHistory();
                    }
                }
            } catch(e) {}
        }, 2000);
    }

    // ★ 如果 Agent 模式激活,切换到 agent 独立聊天
    if (isAgentToolsActive()) {
        // 已在 setAgentMode 中创建了带上下文的 agent 聊天,直接加载
        if (currentChatId && currentChatId === '_agent_main') {
            loadChat(currentChatId);
            $.sidebar?.classList.add('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'block';
            renderChatHistory();
        } else {
            // 兜底:页面加载时 agent 模式激活,但没有 agent 聊天(刷新场景)
            createAgentChat([]).then(function(agentId) {
                loadChat(agentId);
                $.sidebar?.classList.add('collapsed');
                if ($.sidebarToggle) $.sidebarToggle.style.display = 'block';
                renderChatHistory();
            });
        }
    } else {
        const last = localStorage.getItem('lastChatId');
        if (last && chats[last]) {
            loadChat(last);
        } else {
            // ★ 优先复用已有的空新对话,避免登录后反复创建
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
    }

    prevWidth = window.innerWidth;
    // 初始化配置面板状态
    if (isMobile()) {
        $.sidebar?.classList.remove('mobile-open');
        $.configPanel?.classList.remove('mobile-open', 'hidden-panel');
        $.sidebarMask?.classList.remove('active');
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'block';
        configPanelWasOpen = false; // 移动端默认不打开
    } else {
        $.sidebar?.classList.remove('mobile-open');
        // 桌面端默认隐藏配置面板
        $.configPanel?.classList.add('hidden-panel');
        $.sidebarMask?.classList.remove('active');
        if (!isAgentToolsActive()) {
            $.sidebar?.classList.remove('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
        }
        configPanelWasOpen = false;
    }
    // ★ 硬刷新确保侧边栏状态正确
    updateAgentUI();
}

async function loadAllResources() {
    const resources = [
        { type: 'script', src: 'lib/marked.min.js' },
        { type: 'script', src: 'lib/highlight.min.js' },
        { type: 'script', src: 'lib/mammoth.browser.min.js' },
        { type: 'script', src: 'lib/xlsx.full.min.js' },
        { type: 'style', href: 'lib/atom-one-light.min.css', id: 'hljsTheme' },
        { type: 'script', src: 'lib/mermaid/mermaid.min.js' } // Mermaid 图表渲染(本地加载避免境外CDN慢)
    ];
    try {
        await Promise.all(resources.map(r => r.type === 'script' ? loadScript(r.src) : loadStyle(r.href, r.id)));
        if (window.mermaid) {
            mermaid.initialize({ startOnLoad: false, theme: 'default' }); // 初始化 Mermaid
            // ★ Mermaid 加载完成后,重新渲染所有已有气泡中的图表
            setTimeout(function _renderPendingMermaid() {
                document.querySelectorAll('.markdown-body').forEach(function(el) {
                    if (el.querySelector('pre code[class*="language-mermaid"]') || el.querySelector('.mermaid:not(svg)')) {
                        MarkdownRenderer.renderMermaid(el);
                    }
                });
            }, 100);
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
        setupPasteImageSupport(); // ★ 支持粘贴剪贴板图片

        // ★ 登录门禁:未登录则弹出登录框,token无效也弹出
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
                    } else {
                        // ★ 登录成功,预加载云端记忆和身份
                        if (typeof window._loadCloudMemories === 'function') window._loadCloudMemories();
                        if (typeof window._loadCloudIdentity === 'function') window._loadCloudIdentity();
                        // ★ AI 自主询问身份: 如果没有身份信息,自动在 Agent 聊天中询问
                        setTimeout(function() {
                            if (typeof window._autoAskIdentity === 'function') window._autoAskIdentity();
                        }, 3000);
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
            slimSaveChats(); // 使用压缩保存避免 quota exceeded
        } catch(e) {}

        // ★ 旧版 /mcp 迁移为直连 MiniMax Vision API
        var _oldVision = localStorage.getItem('visionApiUrl');
        if (_oldVision && (_oldVision.indexOf('/mcp') >= 0 || _oldVision === '')) {
            localStorage.setItem('visionApiUrl', 'https://api.minimaxi.com/v1/coding_plan/vlm');
            localStorage.setItem('visionModel', 'MiniMax-M2');
            console.log('[migrate] visionApiUrl: /mcp → MiniMax 直连');
        }

        // ★ 从服务器恢复当前账号的配置和聊天记录(登录用户专用)
        await restoreUserData();

        // ★ 初始化 _currentProvider (页面加载时不会触发 onProviderChange)
        _currentProvider = localStorage.getItem('baseUrlProvider') || 'custom';

        // ★ 服务器同步后再次深度清理(防止服务器数据也有污染)
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

        // ★ 自动续生:检测到刷新前未完成的流式(仅当后端 SSE 未恢复时才触发)
        try {
            (function _autoRecover() {
                if (!window._pendingRecovery) return;
                // ★ 后端 SSE 恢复过就不再从头重发
                if (window._backendRecovered) { window._pendingRecovery = null; return; }
                var _rec = window._pendingRecovery;
                window._pendingRecovery = null;
                // ★ 仅当流式确实被打断时才续生(有实际内容且距离保存时间<120秒)
                var _age = Date.now() - (_rec.time || 0);
                var _hasRealContent = (_rec.content && _rec.content.length > 0) || (_rec.reasoning && _rec.reasoning.length > 0);
                if (!_hasRealContent || _age > 120000) {
                    console.log('[AutoRecover] 跳过: 内容不足或超120秒, age=' + (_age/1000).toFixed(1) + 's');
                    return;
                }
                setTimeout(function() {
                    if (!chats[_rec.chatId]) return;
                    // 找到用户最后一条消息
                    var _msgs = chats[_rec.chatId].messages;
                    var _userText = '', _userFiles = [];
                    var _prevPartialContent = '', _prevPartialReasoning = '';
                    for (var _ri = _msgs.length - 1; _ri >= 0; _ri--) {
                        if (_msgs[_ri].role === 'user') {
                            _userText = _msgs[_ri].text || '';
                            _userFiles = _msgs[_ri].files || [];
                            break;
                        }
                        if (_msgs[_ri]._recovered) {
                            _prevPartialContent = _msgs[_ri].content || '';
                            _prevPartialReasoning = _msgs[_ri].reasoning || '';
                        }
                    }
                    if (!_userText && !_userFiles.length && !_prevPartialContent) return;
                    // ★ 关键:在重新生成前,移除旧的 _recovered 消息(避免新旧混合)
                    chats[_rec.chatId].messages = _msgs.filter(function(m) { return !m._recovered; });
                    // ★ 将已流出的部分内容注入为系统上下文,让AI从停下的地方继续
                    if (_prevPartialContent) {
                        var _ctxMsg = '以下是之前已生成但未完成的内容,请在此基础上继续,不要重新开始:\n\n' + _prevPartialContent.substring(-1000);
                        if (_prevPartialReasoning) {
                            _ctxMsg = '之前的思考过程:\n' + _prevPartialReasoning.substring(-800) + '\n\n已生成但未完成的内容:\n' + _prevPartialContent.substring(-1000) + '\n\n请继续。不要重复前面已有的内容。';
                        }
                        window.__internalAgentContext = _ctxMsg;
                    }
                    showToast('🔄 正在继续生成...', 'info', 4000);
                    sendMessage(true, _userText, _userFiles).catch(function(e) {
                        console.warn('[AutoRecover] 续生失败:', e.message);
                    });
                }, 500);
            })();
        } catch(e) { console.warn('[AutoRecover] 出错:', e.message); }

        // ★ 周期自动保存:每30秒保存一次聊天(确保未开新会话时数据不丢)
        setInterval(function() {
            if (currentChatId && chats[currentChatId] && chats[currentChatId].messages && chats[currentChatId].messages.length > 1) {
                slimSaveChats();
            }
        }, 30000);
        // ★ 页面关闭/刷新前强制保存到localStorage + 服务器
        // ★ 强制定时重试:如果数据还没加载(跨域cookie可能延迟到达)
        setTimeout(function _retryRestore() {
            if (Object.keys(chats).length <= 2 && localStorage.getItem('authToken')) {
                console.log('[retry] 聊天数极少,尝试重新加载...');
                restoreUserData().catch(function(){});
            }
        }, 2000);

        // ★ 初始化 Agent 模式悬停菜单
    setTimeout(function() { if (typeof _setupAgentPopup === 'function') _setupAgentPopup(); }, 1000);

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
            // ★ 保存输入框文本,刷新后恢复
            try {
                var _inputEl = getEl('chatInput');
                if (_inputEl && _inputEl.value.trim()) {
                    localStorage.setItem('_savedInputText', _inputEl.value.trim());
                }
            } catch(e) {}
            // ★ 保存未完成的流式消息(包含用户消息,用于刷新后继续生成)
            try {
                for (var __cid in chats) {
                    var __msgs = chats[__cid].messages;
                    for (var __i = __msgs.length - 1; __i >= 0; __i--) {
                        if (__msgs[__i].partial) {
                            // 找到前一条用户消息
                            var __userMsg = null;
                            for (var __j = __i - 1; __j >= 0; __j--) {
                                if (__msgs[__j].role === 'user') {
                                    __userMsg = { text: __msgs[__j].text, files: __msgs[__j].files };
                                    break;
                                }
                            }
                            localStorage.setItem('_savedPartial', JSON.stringify({
                                chatId: __cid,
                                content: __msgs[__i].content || '',
                                reasoning: __msgs[__i].reasoning || '',
                                userText: __userMsg ? __userMsg.text : '',
                                userFiles: __userMsg ? __userMsg.files : []
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
            // ★ 保存聊天记录到服务器(使用 sendBeacon,保证页面关闭时请求送达)
            var token = localStorage.getItem('authToken');
            if (token && chats && Object.keys(chats).length > 0) {
                try { beaconSaveChats(); } catch(e) {}
            }
            // ★ 保存配置到服务器(使用 sendBeacon)
            if (token) {
                try { beaconSaveConfig(); } catch(e) {}
            }
        });
        window.addEventListener('pagehide', function() {
            slimSaveChats();
        });

        // ★ 全局拦截图片加载错误,静默处理避免控制台刷屏
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
        '<div id="ragEmbedStatus" style="font-size:10px;color:#9ca3af;margin-top:2px;">未启用(纯词法检索)</div>' +
        '</details>' +
        '<div class="rag-helper-text">拖拽或点击上传文档,AI可搜索知识库内容</div>' +
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
        if (!confirm('删除知识库「' + cur + '」?')) return;
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

// 上传队列:一次只传一个文件,避免并发搞崩 RAG 后端
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
    // 完成回调:继续下一个
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
            showToast('导入失败: 服务器无响应,请重试', 'error');
            console.error('[RAG] upload error:', e.message, 'response:', xhr.responseText);
        }
        doneFn();
    };
    xhr.onerror = function() { if (pb) pb.style.display = 'none'; showToast('网络错误', 'error'); doneFn(); };
    xhr.ontimeout = function() { if (pb) pb.style.display = 'none'; showToast('上传超时,请重试', 'error'); doneFn(); };
    xhr.timeout = 300000; // 5分钟超时
    xhr.send(formData);
}

// ==================== 刷课工具处理器 ====================
async function chaoxingToolHandler(action, ids, username, password) {
    var token = localStorage.getItem('authToken') || '';
    var authSuffix = token ? '&auth_token=' + encodeURIComponent(token) : '';
    try {
        if (action === 'login') {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=login&username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password) + authSuffix, { method: 'POST' });
            var d = await r.json();
            if (d.success) return { result: '登录成功: ' + d.username };
            return { error: d.error || '登录失败,请检查账号密码' };
        }
        if (action === 'courses') {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=courses' + authSuffix);
            var d = await r.json();
            if (d.courses) {
                return { result: '课程列表:\n' + d.courses.map(function(c) { return c.courseId + ': ' + c.title; }).join('\n') };
            }
            return { error: d.error || '获取失败' };
        }
        if (action === 'start' && ids) {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=start&ids=' + encodeURIComponent(ids) + authSuffix);
            var d = await r.json();
            if (d.success) return { result: '刷课任务已启动 (PID: ' + d.pid + ')' };
            return { error: d.error || '启动失败' };
        }
        if (action === 'status') {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=status' + authSuffix);
            var d = await r.json();
            var logPreview = d.log ? d.log.slice(-2000) : '(无日志)';
            if (d.running) return { result: '刷课任务运行中\n\n' + logPreview };
            else return { result: '刷课任务未运行\n\n最后日志:\n' + logPreview };
        }
        if (action === 'stop') {
            await fetch('/oneapichat/chaoxing_api.php?action=stop' + authSuffix, { method: 'POST' });
            return { result: '刷课任务已停止' };
        }
        if (action === 'stats') {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=stats' + authSuffix);
            var d = await r.json();
            if (d.total_courses !== undefined) {
                var msg = '📊 刷课进度统计\n';
                msg += '总课程: ' + d.total_courses + ' | 已完成: ' + d.completed + '\n';
                msg += '视频完成: ' + d.videos_done + ' | 答题完成: ' + d.works_done;
                return { result: msg };
            }
            return { error: '获取统计失败' };
        }
        if (action === 'overview') {
            // 综合总览:登录+运行状态+进度
            var [sR, stR] = await Promise.all([
                fetch('/oneapichat/chaoxing_api.php?action=status' + authSuffix),
                fetch('/oneapichat/chaoxing_api.php?action=stats' + authSuffix)
            ]);
            var sD = await sR.json();
            var stD = await stR.json();
            var running = !!sD.running;
            var msg = '📋 超星刷课总览\n';
            msg += '登录状态: ✅ 已登录\n';
            msg += '刷课状态: ' + (running ? '🟢 运行中' : '⚪ 空闲') + '\n';
            if (running && sD.log) {
                var lastLine = sD.log.split('\n').filter(function(l) { return l.indexOf('开始学习课程') >= 0; }).pop();
                if (lastLine) msg += '当前课程: ' + lastLine.replace(/.*开始学习课程: /, '') + '\n';
            }
            if (stD.total_courses !== undefined) {
                msg += '总课程: ' + stD.total_courses + ' | 已完成: ' + stD.completed + '\n';
                msg += '视频: ' + stD.videos_done + ' | 答题: ' + stD.works_done + '\n';
            }
            if (running) {
                msg += '\n💡 刷课正在运行。如需停止请调用 chaoxing_stop,如需切换课程请先停止。';
            }
            return { result: msg };
        }
        if (action === 'auth_check') {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=courses' + authSuffix);
            if (r.ok) return { result: '✅ 学习通已登录,可直接操作' };
            return { error: '❌ 未登录,需要提供学习通手机号和密码' };
        }
        if (action === 'exam_list') {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=exam_list' + authSuffix);
            var d = await r.json();
            if (d.exams) {
                var msg = '📋 考试列表 (' + d.total + ' 场):\n';
                d.exams.forEach(function(e) {
                    var timeStr = (e.start_time && e.end_time) ? (' | ' + e.start_time + ' ~ ' + e.end_time) : '';
                    msg += '- [' + e.exam_id + '] ' + (e.course_title || '') + ' / ' + e.title + ' (' + e.status + ')' + timeStr + '\n';
                });
                return { result: msg };
            }
            return { error: d.error || '获取考试列表失败' };
        }
        if (action === 'exam_start') {
            var selectedExams = [];
            if (ids) {
                // 先用 exam_list 获取所有考试
                var elR = await fetch('/oneapichat/chaoxing_api.php?action=exam_list' + authSuffix);
                var elD = await elR.json();
                var targetIds = ids.split(',').map(function(s) { return parseInt(s.trim()); });
                var exams = elD.exams || [];
                exams.forEach(function(e) {
                    if (targetIds.indexOf(e.exam_id) >= 0 && e.status !== '已完成' && e.status !== '已交' && e.status !== '已交卷') {
                        selectedExams.push({ exam_id: e.exam_id, course_id: e.course_id + '', class_id: e.class_id + '', cpi: e.cpi, enc_task: e.enc_task + '' });
                    }
                });
            } else {
                // 全选
                var elR = await fetch('/oneapichat/chaoxing_api.php?action=exam_list' + authSuffix);
                var elD = await elR.json();
                var exams = elD.exams || [];
                exams.forEach(function(e) {
                    if (e.status !== '已完成' && e.status !== '已交' && e.status !== '已交卷') {
                        selectedExams.push({ exam_id: e.exam_id, course_id: e.course_id + '', class_id: e.class_id + '', cpi: e.cpi, enc_task: e.enc_task + '' });
                    }
                });
            }
            if (selectedExams.length === 0) return { error: '没有可开考的考试' };
            var r = await fetch('/oneapichat/chaoxing_api.php?action=exam_start' + authSuffix, {
                method: 'POST',
                body: JSON.stringify({ exams: selectedExams })
            });
            var d = await r.json();
            if (d.success) return { result: '✅ 考试已启动 (PID: ' + d.pid + '), 共 ' + selectedExams.length + ' 场' + (d.study_running ? '。刷课已自动暂停。' : '') };
            return { error: d.error || '启动失败' };
        }
        if (action === 'exam_status') {
            var r = await fetch('/oneapichat/chaoxing_api.php?action=exam_status' + authSuffix);
            var d = await r.json();
            var logPreview = d.log ? d.log.slice(-2000) : '(无日志)';
            return { result: '考试任务' + (d.running ? '运行中' : '未运行') + '\n\n日志:\n' + logPreview };
        }
        if (action === 'exam_stop') {
            await fetch('/oneapichat/chaoxing_api.php?action=exam_stop' + authSuffix, { method: 'POST' });
            return { result: '考试任务已停止' };
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
                    // 创建后自动运行(不等待完成,避免阻塞并行工具调用)
                    fetch('/oneapichat/engine_api.php?action=agent_run&name=' + encodeURIComponent(args.name) + authSuffix).catch(function(){});
                    return { result: '✅ 子代理 ' + args.name + ' 已创建并启动(角色:' + agentRole + ')' };
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
            // 运行子代理(直接触发一次)
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
            if (d.ok) { window.showAgentNotification('info', '📤 已推送通知'); return { result: '消息已推送,将在下次心跳时送达' }; }
            return { error: d.error || '推送失败' };
        }
        // ===== PS / DISK: 无需参数的工具,直接用明确 URL =====
        if (action === 'ps') {
            var _r = await fetch('/oneapichat/engine_api.php?action=ps' + authSuffix);
            var _d = await _r.json();
            if (_d.ok) return { result: _d.stdout, total: _d.total };
            console.warn('[ps] failed:', JSON.stringify(_d).substring(0,200));
            return { error: _d.error || 'unreachable' };
        }
        if (action === 'disk') {
            var _r = await fetch('/oneapichat/engine_api.php?action=disk' + authSuffix);
            var _d = await _r.json();
            if (_d.ok) return { result: _d.stdout };
            return { error: _d.error || 'unreachable' };
        }
        // ===== 浏览��工具 (无头浏览器操控) =====
        var browserActions = ['browser_navigate', 'browser_screenshot', 'browser_click', 'browser_type', 'browser_get_content', 'browser_get_snapshot'];
        if (browserActions.indexOf(action) >= 0) {
            // ★ PHP 期望的 action 名 (去掉 browser_ 前缀的变化)
            var _phpAction = action.replace('browser_', 'browser_');  // keep as-is
            var _burl = '/oneapichat/engine_api.php?action=' + encodeURIComponent(action) + authSuffix;
            // POST body 用于 navigate/click/type
            var _bmethod = (action === 'browser_navigate' || action === 'browser_click' || action === 'browser_type') ? 'POST' : 'GET';
            if (_bmethod === 'POST') {
                var _r = await fetch(_burl, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(args || {}) });
                var _d = await _r.json();
                return _d.error ? { error: _d.error } : (_d.content || _d.snapshot || _d.result || _d.ok ? '操作完成' : _d);
            } else {
                // GET: 拼参数到 URL
                Object.keys(args || {}).forEach(function(k) {
                    var v = args[k];
                    if (k !== 'action' && k !== 'auth_token' && v !== undefined && v !== null) {
                        _burl += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(String(v));
                    }
                });
                var _r = await fetch(_burl);
                var _d = await _r.json();
                if (_d.error) return { error: _d.error };
                // screenshot: 带 image base64
                if (_d.image) return { result: '截图完成', image: _d.image };
                if (_d.content) return { result: _d.content, url: _d.url };
                if (_d.snapshot) return { result: typeof _d.snapshot === 'string' ? _d.snapshot : JSON.stringify(_d.snapshot) };
                if (_d.ok) return { result: JSON.stringify(_d) };
                return _d;
            }
        }
        // ===== 引擎直通工具 (通过 engine_api.php 的 security_checks + 转发到 engine_server) =====
        var directActions = ['sys_info', 'ps', 'disk', 'network', 'docker', 'db_query', 'file_search', 'file_op', 'file_read', 'file_write'];
        if (directActions.indexOf(action) >= 0) {
            var _url = (typeof SERVER_API_BASE !== 'undefined' ? SERVER_API_BASE : '/oneapichat') + '/engine_api.php?action=' + encodeURIComponent(action) + authSuffix;
            // 把 args 里的参数都拼到 URL (跳过与路径冲突的 action 和 php 保留字)
            var _skipKeys = ['action_cmd', 'auth_token'];
            Object.keys(args || {}).forEach(function(k) {
                var v = args[k];
                if (_skipKeys.indexOf(k) >= 0) return;
                // file_op/network/docker 的 action 参数名冲突, 重命名
                var _pk = k;
                if (k === 'action') {
                    if (action === 'file_op') _pk = 'file_action';
                    else if (action === 'network') _pk = 'net_action';
                    else if (action === 'docker') _pk = 'docker_action';
                }
                if (v !== undefined && v !== null) {
                    _url += '&' + encodeURIComponent(_pk) + '=' + encodeURIComponent(String(v));
                }
            });
            try {
                var _r = await fetch(_url);
                var _d = await _r.json();
                if (_d.error) return { error: _d.error };
                // 引擎返回的是对象 (如 {ok:true, stdout:"..."}), 直接返回
                if (_d.ok) return _d.stdout ? { result: _d.stdout, stderr: _d.stderr } : { result: JSON.stringify(_d) };
                if (_d.result) return _d;
                // stdout 格式: 提取关键输出
                if (_d.stdout) return { result: _d.stdout, stderr: _d.stderr, exitCode: _d.exit_code };
                // files 格式
                if (_d.files) return { result: _d.files.join('\n'), files: _d.files, total: _d.total };
                return _d;
            } catch(_e) {
                console.error('[engineApiHandler] action=' + action + ' url=' + _url + ' error:', _e.message, _e.stack);
                return { error: '引擎工具执行失败: ' + _e.message };
            }
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

    // 先获取本地模型列表,更新下拉框
    var _token = getAuthToken();
    fetch(RAG_API + '?action=list_models&auth_token=' + encodeURIComponent(_token))
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var sm = getEl('ragEmbedModel');
            if (!sm) return;
            // 保留当前选中值
            var curVal = sm.value;
            // 构建选项:API模型 + 本地模型
            var html = '<option value="">TF-IDF(纯词法)</option>';
            html += '<option value="text-embedding-3-small">text-embedding-3-small(OpenAI)</option>';
            html += '<option value="text-embedding-3-large">text-embedding-3-large(OpenAI)</option>';
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
                    st.innerHTML = '嵌入: 未启用(纯TF-IDF词法检索)';
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

            // 首次运行,建立基线
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
                msg += '(答题' + now_works + ' 视频' + now_videos + ' 完成' + now_completed + '课)';

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
// ==================== 代理聊天室实时更新 (Feature 4) ====================
var _agentPollTimer = null;
var _agentPanelRefreshTimer = null;
var _agentChatPollTimer = null;
var _selectedAgentName = null;
var _lastAgentListJson = '';

/**
 * 开始代理聊天室实时更新
 * - 代理列表每3秒轮询
 * - 选中代理的聊天内容自动同步
 * - 新消息通知红点
 * - 代理运行中脉冲动画
 */
window.startAgentRealtimeUpdates = function() {
    // 启动现有轮询(15s)
    // 延迟到 restoreUserData 完成后启动

    // 新增: 3秒快速轮询代理列表
    if (!_agentPanelRefreshTimer) {
        _agentPanelRefreshTimer = setInterval(function() {
            if (!getAuthToken()) return;
            window._refreshAllAgentLists();
            // 如果有选中代理,自动同步聊天内容
            if (_selectedAgentName) {
                window.syncAgentChat(_selectedAgentName);
            }
        }, 3000);
    }

    // 红点通知脉冲
    var dot = getEl('agentNotifDot');
    if (dot) {
        dot.classList.add('pulse');
    }

    // 给所有运行中的代理添加脉冲动画
    _applyRunningAgentAnimation();
};

window.stopAgentRealtimeUpdates = function() {
    window.stopAgentNotificationPolling();
    if (_agentPanelRefreshTimer) {
        clearInterval(_agentPanelRefreshTimer);
        _agentPanelRefreshTimer = null;
    }
};

/**
 * 同步选中代理的聊天内容
 */
window.syncAgentChat = function(agentName) {
    if (!agentName || !_selectedAgentName) return;
    if (agentName !== _selectedAgentName) return;

    var msgArea = getEl('agentChatMessages');
    if (!msgArea) return;

    var key = 'agent_chat_' + agentName;
    var msgs = JSON.parse(localStorage.getItem(key) || '[]');
    if (msgs.length > 0) {
        var html = msgs.map(function(m) {
            var roleClass = m.role === 'user' ? 'role-user' : 'role-assistant';
            var timeStr = m.time ? new Date(m.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) : '';
            var contentPreview = (m.content || '').substring(0, 3000);
            return '<div class="agent-chat-bubble ' + roleClass + '">' +
                '<div class="text-xs text-gray-400 mb-1">' + (m.role === 'user' ? '你' : escapeHtml(agentName)) + (timeStr ? ' · ' + timeStr : '') + '</div>' +
                '<div class="text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300">' + escapeHtml(contentPreview) + '</div>' +
                '</div>';
        }).join('');

        if (msgArea.innerHTML !== html) {
            msgArea.innerHTML = html;
            msgArea.scrollTop = msgArea.scrollHeight;
        }
    }
};

/**
 * 为运行中的代理应用脉冲动画
 */
function _applyRunningAgentAnimation() {
    var runningDots = document.querySelectorAll('.agent-sub-dot.running');
    runningDots.forEach(function(dot) {
        if (!dot.style.animation) {
            dot.style.animation = 'agent-pulse 1.5s ease-in-out infinite';
        }
    });
}

// 在 _renderAgentList 后触发动画
(function() {
    var _origRender = window._renderAgentList;
    if (_origRender) {
        var _wrapped = function(agents, container) {
            _origRender(agents, container);
            setTimeout(_applyRunningAgentAnimation, 100);
        };
        window._renderAgentList = _wrapped;
    }
})();

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
        // 还没登录,延迟重试
        setTimeout(window.checkAgentNotifications, 3000);
        return;
    }

    // 先获取引擎心跳(cron通知等)
    fetch('/oneapichat/engine_api.php?action=heartbeat&auth_token=' + token + '&t=' + Date.now(), { signal: AbortSignal.timeout(300000) })
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

    // ★ 同时获取子代理完成通知(新功能)
    fetch('/oneapichat/engine_api.php?action=agent_notifications&auth_token=' + token + '&t=' + Date.now(), { signal: AbortSignal.timeout(300000) })
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

                // ★ 保存原始结果数据,供 processAgentNotifyQueue 直接使用
                if (!window._pendingSubAgentResultsData) window._pendingSubAgentResultsData = {};
                window._pendingSubAgentResultsData[agentName] = {
                    status: n.status || 'completed',
                    result: n.result || '',
                    error: n.error || ''
                };

                // 保存到代理专属聊天(供面板查看)
                var fullResult = n.result || n.error || '';
                if (fullResult) {
                    var agentKey = 'agent_chat_' + agentName;
                    var agentMsgs = JSON.parse(localStorage.getItem(agentKey) || '[]');
                    agentMsgs.push({ role: 'assistant', content: fullResult, time: Date.now() });
                    if (agentMsgs.length > 50) agentMsgs = agentMsgs.slice(-50);
                    localStorage.setItem(agentKey, JSON.stringify(agentMsgs));
                }

                // 触发主代理处理(会自行管理队列)
                if (isAgentToolsActive()) {
                    window.triggerAgentAutoReplyForSubAgent(agentName);
                } else {
                    console.log('[AgentNotify] 非 Agent 模式,静默处理子代理', agentName);
                }
            });

            // ★ 注意:不再在这里立即 mark
            // ★ processAgentNotifyQueue 会在处理完成后自行调用 agent_notifications_mark
        }).catch(function() {});
};

window.showAgentNotification = function(type, message) {
    // 右上角通知已禁用(冗余且太频繁)
};

window.appendAgentSystemMessage = function(text, source) {
    if (!text || !currentChatId) return;
    // ★ 只注入主代理上下文,不显示在聊天界面
    // 保存到主代理聊天数据中供 system prompt 读取
    var chatId = currentChatId;
    if (chats[chatId]) {
        if (!chats[chatId]._agentMessages) chats[chatId]._agentMessages = [];
        chats[chatId]._agentMessages.push({ text: text, time: Date.now(), source: source });
        if (chats[chatId]._agentMessages.length > 20) chats[chatId]._agentMessages = chats[chatId]._agentMessages.slice(-20);
    }
    // ★ 不再调用 appendMessage 显示在聊天界面
};

// 已移至 restoreUserData 完成后延迟启动

