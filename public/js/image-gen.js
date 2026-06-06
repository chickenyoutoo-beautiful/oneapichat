// image-gen.js — 图像生成模块 v1.0 (Phase 1 拆分自 main.js)
// generateImage / generateImageI2I / OpenRouter GPT Image / MiniMax


// ==== 图片分析 (analyzeImage) ====
// 直接定义 analyzeImage 函数
window.analyzeImage = async function(imageInput, focus) {

    // 防御非法输入
    if (typeof imageInput !== 'string' || !imageInput) {
        imageInput = '';
    }
    // 获取配置
    var storedVisionUrl = localStorage.getItem('visionApiUrl');
    var visionApiUrl = storedVisionUrl || DEFAULT_CONFIG.visionApiUrl || '/mcp';
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
                // ★ 直连模式下载失败时,不能传 HTTP URL (MiniMax 会报 invalid image URL)
                // 直接抛错让上层降级处理
                console.warn('[analyzeImage] 下载/压缩失败:', e.message);
                throw new Error('图片下载失败,请重试或使用 MCP 代理模式: ' + e.message);
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
    var controller = new AbortController();
    var timeoutId = setTimeout(() => {
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
            try { _visionKey = await decrypt(_rawVisionKey) || _rawVisionKey; } catch(e) { _visionKey = _rawVisionKey; }
            if (_visionKey) {
                _fetchHeaders['Authorization'] = 'Bearer ' + _visionKey;
            }
        }

        var response = await fetch(mcpEndpoint, {
            method: 'POST',
            headers: _fetchHeaders,
            body: _fetchBody,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) {
            var errorText = await response.text();
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

        var data = await response.json();

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

        var errMsg = (error && typeof error.message === 'string') ? error.message : '';
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
    // ★ 缓存分析结果(30分钟内复用) - 只在成功提取到帧时才缓存
    try {
        if (currentChatId && chats[currentChatId] && frameAnalyses.length > 0) {
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

// ==== 图片压缩 (compressImage) ====
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

// ==================== 图像生成函数 ====================
window.generateImage = async (prompt, options = {}) => {
    var imageProvider = localStorage.getItem('imageProvider') || 'minimax';

    if (imageProvider === 'openrouter') {
        return generateImageOpenRouter(prompt, options);
    }

    // ===== MiniMax (原有实现) =====
    // ★ MiniMax API 限制 prompt ≤ 1500 字符,截断避免 2013 错误
    var MAX_PROMPT_LEN = 1400;
    if (prompt.length > MAX_PROMPT_LEN) prompt = prompt.slice(0, MAX_PROMPT_LEN);
    let baseUrl = (localStorage.getItem('imageBaseUrl') || DEFAULT_CONFIG.imageBaseUrl || '').replace(/\/$/, '');
    if (baseUrl && !baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl + '/v1';
    }
    var rawKey = localStorage.getItem('imageApiKey') || '';
    let apiKey = '';
    try { apiKey = await decrypt(rawKey) || ''; } catch(e) { console.error('[generateImage] decrypt error:', e.message); }

    if (!baseUrl) {
        console.error('[generateImage] 未配置API地址');
        throw new Error('未配置图像生成API地址,请在设置中填写');
    }
    if (!apiKey) {
        console.error('[generateImage] 未配置API密钥');
        throw new Error('未配置图像生成API密钥,请在设置中填写');
    }

    var imageModel = localStorage.getItem('imageModel') || 'image-01';
    var apiUrl = baseUrl + '/image_generation';
    try {
        var body = {
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
        var response = await window.proxyFetch(apiUrl, {
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

        var data = await response.json();
        var images = [];
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
// ★ 通用图片提取: 支持多种 API 返回格式 (chat/completions, images/generations 等)
function _extractImagesFromResponse(data) {
    var imgs = [];

    // 1. chat/completions 格式: choices[0].message.images
    if (data.choices && data.choices.length > 0) {
        var msg = data.choices[0].message;
        if (msg && msg.images && Array.isArray(msg.images)) {
            msg.images.forEach(function(img) {
                if (img.image_url && img.image_url.url) imgs.push(img.image_url.url);
                else if (img.url) imgs.push(img.url);
                else if (typeof img === 'string') imgs.push(img);
            });
        }
        // 2. chat/completions 格式: content 是数组(含 image_url 部分)
        if (imgs.length === 0 && msg && Array.isArray(msg.content)) {
            msg.content.forEach(function(c) {
                if (c && c.type === 'image_url' && c.image_url && c.image_url.url) {
                    imgs.push(c.image_url.url);
                }
            });
        }
        // 3. content 字符串中的 base64
        if (imgs.length === 0 && msg && typeof msg.content === 'string') {
            var _bm = msg.content.match(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]{100,}/g);
            if (_bm) imgs = _bm;
        }
    }

    // 4. OpenAI images/generations 格式: data.data[{url, b64_json}]
    if (imgs.length === 0 && data.data && Array.isArray(data.data)) {
        data.data.forEach(function(d) {
            if (d.url) imgs.push(d.url);
            else if (d.b64_json) imgs.push('data:image/png;base64,' + d.b64_json);
            else if (d.image_url) imgs.push(d.image_url);
            else if (typeof d === 'string') imgs.push(d);
        });
    }

    // 5. 顶层 images 数组
    if (imgs.length === 0 && data.images && Array.isArray(data.images)) {
        data.images.forEach(function(img) {
            if (img.image_url && img.image_url.url) imgs.push(img.image_url.url);
            else if (img.url) imgs.push(img.url);
            else if (typeof img === 'string') imgs.push(img);
        });
    }

    // 6. 顶层单图字段
    if (imgs.length === 0) {
        if (data.image_url) imgs.push(data.image_url);
        if (data.url && (data.url.startsWith('http') || data.url.startsWith('data:'))) imgs.push(data.url);
    }

    // 7. 深度遍历: 搜索所有以 http 开头或 data:image 开头的字符串字段
    if (imgs.length === 0) {
        function _deepSearch(obj, depth) {
            if (!obj || typeof obj !== 'object' || depth > 10) return;
            if (Array.isArray(obj)) {
                for (var i = 0; i < obj.length; i++) _deepSearch(obj[i], depth + 1);
            } else {
                for (var k in obj) {
                    if (!obj.hasOwnProperty(k)) continue;
                    var v = obj[k];
                    if (typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:image/'))) {
                        imgs.push(v);
                    } else if (typeof v === 'object') {
                        _deepSearch(v, depth + 1);
                    }
                }
            }
        }
        _deepSearch(data, 0);
    }

    return imgs;
}

async function generateImageOpenRouter(prompt, options = {}) {
    // 获取配置: 使用独立的 imageApiKeyOpenrouter 和 imageBaseUrlOpenrouter
    let baseUrl = (localStorage.getItem('imageBaseUrlOpenrouter') || 'https://openrouter.ai/api').replace(/\/$/, '');
    if (baseUrl && !baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl + '/v1';
    }
    var rawKey = localStorage.getItem('imageApiKeyOpenrouter') || '';
    let apiKey = '';
    try { apiKey = await decrypt(rawKey) || ''; } catch(e) { console.error('[generateImageOpenRouter] decrypt error:', e.message); }

    if (!apiKey) {
        throw new Error('未配置 OpenRouter API Key,请在设置-图像生成中填写');
    }

    var configuredModel = localStorage.getItem('imageModel') || 'openai/gpt-5.4-image-2';
    // ★ 当提供商为 OpenRouter 时,忽略 AI 传来的 MiniMax 模型名(如 image-01),强制使用配置的模型
    var actualModel = options.model || configuredModel;
    if (actualModel.indexOf('image-01') !== -1 || actualModel.indexOf('minimax') !== -1) {
        actualModel = configuredModel;
    }
    var chatUrl = baseUrl + '/chat/completions';
    var n = options.n || 1;
    var aspectRatio = options.aspect_ratio || '1:1';
    var imageSize = options.image_size || '1K';

    // 构建 image_config
    var imageConfig = {
        aspect_ratio: aspectRatio,
        image_size: imageSize
    };

    try {
        var body = {
            model: actualModel,
            messages: [
                { role: 'user', content: prompt }
            ],
            modalities: ['image', 'text'],
            image_config: imageConfig,
            n: n,
            stream: false
        };

        var response = await window.proxyFetch(chatUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(900000)
        });

        if (!response.ok) {
            var errText = await response.text().catch(function() { return response.statusText; });
            throw new Error('OpenRouter 请求失败 (' + response.status + '): ' + errText.substring(0, 200));
        }

        var data = await response.json();

        // 检查错误
        if (data.error) {
            throw new Error('OpenRouter 错误: ' + (data.error.message || JSON.stringify(data.error)));
        }

        // ★ 使用通用提取器支持多种 API 返回格式
        var images = _extractImagesFromResponse(data);

        if (images.length > 0) {
            // ★ 上传到服务器后再返回,确保返回的是持久化 URL (与 MiniMax i2i 路径行为一致)
            var _uploaded = [];
            for (var _ui = 0; _ui < images.length; _ui++) {
                var _srvUrl = await uploadImageToServer(images[_ui]);
                _uploaded.push(_srvUrl || images[_ui]); // 上传失败则保留原始 URL
            }
            return _uploaded.length === 1 ? _uploaded[0] : _uploaded;
        }

        throw new Error('GPT Image 2 未返回图片,响应: ' + JSON.stringify(data).substring(0, 500));
    } catch (e) {
        console.error('[generateImageOpenRouter] error:', e);
        throw e;
    }
}

// ★ GPT Image 2 原生图生图 — chat/completions + 多图参考
async function _gptImageI2I(prompt, primaryImage, options = {}) {
    let baseUrl = (localStorage.getItem('imageBaseUrlOpenrouter') || 'https://openrouter.ai/api').replace(/\/$/, '');
    if (baseUrl && !baseUrl.endsWith('/v1')) baseUrl = baseUrl + '/v1';
    var rawKey = localStorage.getItem('imageApiKeyOpenrouter') || '';
    let apiKey = '';
    try { apiKey = await decrypt(rawKey) || ''; } catch(e) {}
    if (!apiKey) throw new Error('未配置 OpenRouter API Key');

    var model = options.model || localStorage.getItem('imageModel') || 'openai/gpt-5.4-image-2';
    var chatUrl = baseUrl + '/chat/completions';
    var n = options.n || 1;
    var aspectRatio = options.aspect_ratio || '1:1';
    var imageSize = options.image_size || '1K';

    // 构建带参考图的消息
    var content = [];
    // 添加参考图片 (支持多张)
    var refImages = [];
    if (options.reference_images && Array.isArray(options.reference_images)) {
        refImages = options.reference_images;
    } else if (primaryImage) {
        refImages = [primaryImage];
    }
    for (var ri = 0; ri < refImages.length; ri++) {
        var img = refImages[ri];
        // ★ 修复: 将相对路径(如 /oneapichat/uploads/...) 转为完整 URL,否则不会被发送到 API
        if (img && !img.startsWith('data:') && !img.startsWith('http')) {
            img = window.location.origin + img;
        }
        if (img && (img.startsWith('data:') || img.startsWith('http'))) {
            content.push({ type: 'image_url', image_url: { url: img, detail: 'high' } });
        }
    }
    // 添加文本提示词 (描述如何编辑/变换参考图)
    var fullPrompt = prompt || '基于参考图生成新图片';
    if (refImages.length > 1) {
        fullPrompt = '参考以下' + refImages.length + '张图片，' + fullPrompt;
    }
    content.push({ type: 'text', text: fullPrompt });

    try {
        var body = {
            model: model,
            messages: [{ role: 'user', content: content }],
            modalities: ['image', 'text'],
            image_config: { aspect_ratio: aspectRatio, image_size: imageSize },
            n: n,
            stream: false
        };

        // 可选: 遮罩图 (mask)
        if (options.mask_image && (options.mask_image.startsWith('data:') || options.mask_image.startsWith('http'))) {
            body.mask_image_url = options.mask_image;
        }

        var response = await window.proxyFetch(chatUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(900000)
        });

        if (!response.ok) {
            var errText = await response.text().catch(function(){return response.statusText;});
            throw new Error('GPT Image i2i 请求失败 (' + response.status + '): ' + errText.substring(0, 200));
        }

        var data = await response.json();
        if (data.error) {
            throw new Error('GPT Image 错误: ' + (data.error.message || JSON.stringify(data.error)));
        }

        // ★ 使用通用提取器支持多种 API 返回格式
        var images = _extractImagesFromResponse(data);

        if (images.length === 0) throw new Error('GPT Image i2i 未返回图片,响应: ' + JSON.stringify(data).substring(0, 500));
        // ★ 上传到服务器后再返回,确保返回的是持久化 URL (与 MiniMax i2i 路径行为一致)
        var _uploadedI2i = [];
        for (var _ui = 0; _ui < images.length; _ui++) {
            var _srvUrl = await uploadImageToServer(images[_ui]);
            _uploadedI2i.push(_srvUrl || images[_ui]); // 上传失败则保留原始 URL
        }
        return _uploadedI2i.length === 1 ? _uploadedI2i[0] : _uploadedI2i;

    } catch(e) {
        console.error('[gptImageI2I] error:', e);
        throw e;
    }
}

// ==================== 图生图函数 ===================
window.generateImageI2I = async (prompt, image, options = {}) => {
    var _i2i_provider = localStorage.getItem('imageProvider') || 'minimax';
    var _i2i_model = options.model || localStorage.getItem('imageModel') || 'image-01';
    var _is_gpt_image = _i2i_model.includes('gpt-5.4-image') || _i2i_model.includes('gpt-4o-image') || _i2i_model.includes('gpt-image');

    // ★ GPT Image 2 原生支持图生图 — 用 chat/completions + 多图参考
    if (_is_gpt_image && _i2i_provider === 'openrouter') {
        return await _gptImageI2I(prompt, image, options);
    }

    // OpenRouter 其他模型降级为文生图
    if (_i2i_provider === 'openrouter') {
        return window.generateImage(prompt, options);
    }
    // ★ MiniMax API 限制 prompt ≤ 1500 字符,截断避免 2013 错误
    var MAX_PROMPT_LEN = 1400;
    if (prompt.length > MAX_PROMPT_LEN) prompt = prompt.slice(0, MAX_PROMPT_LEN);
    let baseUrl = (localStorage.getItem('imageBaseUrl') || DEFAULT_CONFIG.imageBaseUrl || '').replace(/\/$/, '');
    if (baseUrl && !baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl + '/v1';
    }
    var apiKey = await decrypt(localStorage.getItem('imageApiKey') || '') || '';

    if (!baseUrl) {
        throw new Error('未配置图像生成API地址,请在设置中填写');
    }
    if (!apiKey) {
        throw new Error('未配置图像生成API密钥,请在设置中填写');
    }

    var imageModel = localStorage.getItem('imageModel') || 'image-01';
    var apiUrl = baseUrl + '/image_generation';

    var requestBody = {
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
    // ★ 修复: 将相对路径转为完整 URL
    var _i2iRefImg = image;
    if (_i2iRefImg && !_i2iRefImg.startsWith('data:') && !_i2iRefImg.startsWith('http')) {
        _i2iRefImg = window.location.origin + _i2iRefImg;
    }
    if (_i2iRefImg && (_i2iRefImg.startsWith('data:') || _i2iRefImg.startsWith('http'))) {
        requestBody.subject_reference = [{
            type: 'character',
            image_file: _i2iRefImg
        }];
    }

    // 添加画风设置(仅 image-01-live 支持)
    if (options.style && options.model !== 'image-01') {
        requestBody.style = options.style;
    }

    try {
        var response = await window.proxyFetch(apiUrl, {
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

        var data = await response.json();

        // 检查 API 错误
        if (data.base_resp && data.base_resp.status_code !== 0) {
            var errMsg = data.base_resp.status_msg || 'API 错误';
            var errCode = data.base_resp.status_code;
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
            var images = data.data.image_base64.map(function(b64) { return 'data:image/png;base64,' + b64; });
            imageResult = images.length === 1 ? images[0] : images;
        } else if (data.data && data.data.image_url) {
            imageResult = data.data.image_url;
        } else if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            var images = data.data.map(function(d) {
                if (d.image_base64) return 'data:image/png;base64,' + d.image_base64;
                if (d.image_url) return d.image_url;
                return null;
            }).filter(Boolean);
            imageResult = images.length === 1 ? images[0] : images;
        }

        // ★ i2i失败(failed_count>0): 自动降级为文生图重试
        if (!imageResult && data.metadata && parseInt(data.metadata.failed_count) > 0 && requestBody.subject_reference) {
            delete requestBody.subject_reference;
            var retryResp = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
                body: JSON.stringify(requestBody)
            });
            if (retryResp.ok) {
                var retryData = await retryResp.json();
                if (retryData.data && retryData.data.image_base64 && Array.isArray(retryData.data.image_base64) && retryData.data.image_base64.length > 0) {
                    var images = retryData.data.image_base64.map(function(b64) { return 'data:image/png;base64,' + b64; });
                    imageResult = images.length === 1 ? images[0] : images;
                }
            }
        }

        if (imageResult) {
            // 尝试上传图片到服务器
            var serverUrl = await uploadImageToServer(imageResult);
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


