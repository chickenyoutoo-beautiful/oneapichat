// image-gen.js — 图像生成模块 v1.0 (Phase 1 拆分自 main.js)
// generateImage / generateImageI2I / OpenRouter GPT Image / MiniMax


// ==== 图片分析 (analyzeImage) ====
// 直接定义 analyzeImage 函数
window.analyzeImage = async function(imageInput, focus) {

    // 防御非法输入
    if (typeof imageInput !== 'string' || !imageInput) {
        imageInput = '';
    }
    // 获取配置 (★ 感知提供商: custom 使用独立存储的 Key/URL)
    var _visProvider = localStorage.getItem('visionProvider') || '';
    var storedVisionUrl, storedVisionKey;
    if (_visProvider === 'custom') {
        storedVisionUrl = localStorage.getItem('visionApiUrlCustom');
        storedVisionKey = localStorage.getItem('visionApiKeyCustom');
    } else if (_visProvider === 'openai') {
        // ★ 修复：openai 提供商应使用独立存储的 OpenAI 端点（如 gpt.naujtrats.xyz/v1 的 gemini/gpt），
        //   此前误读 minimax 默认端点导致识别慢/失败。
        storedVisionUrl = localStorage.getItem('visionApiUrlOpenAI') || '';
        storedVisionKey = localStorage.getItem('visionApiKeyOpenAI') || localStorage.getItem('visionApiKey');
    } else if (_visProvider === 'xai') {
        storedVisionUrl = localStorage.getItem('visionApiUrlXAI') || '';
        storedVisionKey = localStorage.getItem('visionApiKeyXAI') || localStorage.getItem('visionApiKey');
    } else {
        storedVisionUrl = localStorage.getItem('visionApiUrl');
        storedVisionKey = localStorage.getItem('visionApiKey');
    }
    var visionApiUrl = storedVisionUrl || DEFAULT_CONFIG.visionApiUrl || '/mcp';
    // ★ 限流保护: 如果 60 秒内遇到过 Token Plan 限流,直接抛错不请求
    if (window.__minimaxRateLimited && Date.now() - window.__minimaxRateLimited < 30000) {
        throw new Error('⚠️ MiniMax API 请求过频,请稍后再试(30秒冷却)');
    }

    // ★ 智能判断: 直连模式还是 MCP 代理模式
    var isDirectApi = visionApiUrl.toLowerCase().indexOf('/mcp') === -1;

    var requestBody;
    var isUrl = imageInput.startsWith('http');

    if (isUrl) {
        if (isDirectApi) {
            // 直连模式: URL 图片需要先下载为 base64,因为 MiniMax API 不接受外链
            var _downloadOk = false;
            try {
                var _fetchFn = window.proxyFetch;  // ★ 统一走 proxyFetch: 直连→回退
                var _dlResp = await _fetchFn(imageInput);
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
                _downloadOk = true;
            } catch(e) {
                // ★ 浏览器下载/压缩失败: 降级到服务端代理 (从磁盘读取, 不依赖静态文件访问)
                console.warn('[analyzeImage] 浏览器下载失败, 尝试服务端代理:', e.message);
                try {
                    var _proxyPath2 = imageInput.replace(/^https?:\/\/[^\/]+/, '');
                    var _proxyResp3 = await fetch('/oneapichat/api/image_proxy.php?action=get&path=' + encodeURIComponent(_proxyPath2), { headers: { Authorization: 'Bearer ' + (window.getAuthToken() || '') } });
                    if (_proxyResp3.ok) {
                        var _proxyData3 = await _proxyResp3.json();
                        if (_proxyData3.success && _proxyData3.dataUrl) {
                            var _compressed2 = await compressImage(_proxyData3.dataUrl);
                            requestBody = {
                                prompt: focus || '请详细描述这张图片的所有内容,包括物体、场景、文字等可见信息。',
                                image_url: _compressed2
                            };
                            _downloadOk = true;
                            console.log('[analyzeImage] 服务端代理兜底成功');
                        } else {
                            console.warn('[analyzeImage] 代理返回失败:', _proxyData3.error || '未知');
                        }
                    } else {
                        var _proxyErrText3 = await _proxyResp3.text().catch(function() { return ''; });
                        console.warn('[analyzeImage] 代理HTTP错误:', { status: _proxyResp3.status, responseLength: _proxyErrText3.length, contentType: _proxyResp3.headers.get('content-type') || '' });
                    }
                } catch(_proxyErr3) {
                    console.warn('[analyzeImage] 服务端代理也失败:', _proxyErr3.message);
                }
            }
            // ★ 两条路径都失败: 抛错让上层处理
            if (!_downloadOk) {
                throw new Error('图片下载失败,请重试或使用 MCP 代理模式: 浏览器下载和服务端代理均无法获取图片');
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
    // ★ 识别 OpenAI 兼容端点（以 /v1 结尾，如 gpt.naujtrats.xyz/v1 的 gemini/gpt）：
    //   直连时需拼 /chat/completions 且用 OpenAI messages 格式，否则请求打到 /v1 或 body 格式错误。
    var _isOpenAICompat = isDirectApi && (/\/v1$/.test(mcpEndpoint) || /gpt\.naujtrats|\.naujtrats\.xyz/.test(mcpEndpoint) || /api\.x\.ai/.test(mcpEndpoint));
    if (!isDirectApi) {
        // MCP 代理模式: 确保以 /analyze 结尾
        if (!mcpEndpoint.endsWith('/analyze')) {
            mcpEndpoint = mcpEndpoint + '/analyze';
        }
    } else if (_isOpenAICompat && !mcpEndpoint.endsWith('/chat/completions')) {
        mcpEndpoint = mcpEndpoint + '/chat/completions';
    }
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
            if (_isOpenAICompat) {
                // ★ OpenAI 兼容格式: messages content 数组 + image_url；GPT/Gemini 更快。
                var _promptOa = requestBody.prompt || focus || '请详细描述这张图片的所有内容,包括物体、场景、文字等可见信息。';
                var _imgOa = requestBody.image_url || requestBody.image || '';
                _reqWithModel = {
                    model: _visionModel,
                    messages: [{ role: 'user', content: [
                        { type: 'text', text: _promptOa },
                        { type: 'image_url', image_url: { url: _imgOa, detail: 'auto' } }
                    ]}],
                    max_tokens: 2048,
                    stream: false
                };
            }
            _reqWithModel.model = _visionModel;
            _fetchBody = JSON.stringify(_reqWithModel);
            var _rawVisionKey = storedVisionKey || '';
            var _visionKey = '';
            try { _visionKey = await decrypt(_rawVisionKey) || _rawVisionKey; } catch(e) { _visionKey = _rawVisionKey; }
            if (_visionKey) {
                _fetchHeaders['Authorization'] = 'Bearer ' + _visionKey;
            } else {
                // ★ 视觉 API Key 未配置: 回退到主模型 (DeepSeek等原生支持视觉)
                var _mainKey = localStorage.getItem('apiKey') || '';
                var _mainBaseUrl = localStorage.getItem('baseUrl') || '';
                var _mainModel = localStorage.getItem('modelSelect') || '';
                if (_mainKey && _mainBaseUrl && _mainModel) {
                    // 主模型 chat/completions 端点
                    var _mainEndpoint = _mainBaseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/v1$/, '');
                    _mainEndpoint = _mainEndpoint + '/chat/completions';
                    // 只有当主模型端点与视觉端点不同时才回退 (避免死循环)
                    var _visionHost = ''; try { _visionHost = new URL(mcpEndpoint).host; } catch(e) {}
                    var _mainHost = ''; try { _mainHost = new URL(_mainEndpoint).host; } catch(e) {}
                    if (_mainHost && _visionHost && _mainHost !== _visionHost) {
                        console.log('[analyzeImage] 视觉 Key 未配置, 回退到主模型:', _mainModel, '@', _mainEndpoint);
                        mcpEndpoint = _mainEndpoint;
                        // ★ 主模型用 OpenAI 视觉格式 (content 数组), 不是 MiniMax 的 prompt+image_url
                        var _b64Image = requestBody.image_url || '';
                        var _promptText = requestBody.prompt || focus || '请详细描述这张图片的所有内容';
                        var _openaiBody = {
                            model: _mainModel,
                            messages: [{ role: 'user', content: [
                                { type: 'text', text: _promptText },
                                { type: 'image_url', image_url: { url: _b64Image, detail: 'auto' } }
                            ]}],
                            max_tokens: 2048,
                            stream: false
                        };
                        _fetchBody = JSON.stringify(_openaiBody);
                        _fetchHeaders['Authorization'] = 'Bearer ' + _mainKey;
                    } else {
                        console.warn('[analyzeImage] 视觉 Key 未配置, 主模型与视觉端点相同或不可用, 无法回退');
                    }
                } else {
                    console.warn('[analyzeImage] 视觉 Key 未配置, 主模型信息不完整, 无法回退');
                }
            }
        }

        var _afn = window.proxyFetch;  // ★ 统一走 proxyFetch: 直连→回退
        var response = await _afn(mcpEndpoint, {
            method: 'POST',
            headers: _fetchHeaders,
            body: _fetchBody,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) {
            var errorText = await response.text();
            console.error('[analyzeImage] HTTP 错误:', { status: response.status, responseLength: errorText.length, contentType: response.headers.get('content-type') || '' });

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
            console.error('[analyzeImage] 请求失败:', {
                errorType: error?.constructor?.name || 'Error',
                errorCode: error?.code || '',
                messageLength: typeof error?.message === 'string' ? error.message.length : 0,
                hasCause: !!error?.cause
            });
        } catch(e) {}

        if (error && typeof error.name === 'string' && error.name === 'AbortError') {
            throw new Error('图片分析请求超时,请稍后重试');
        }

        var errMsg = (error && typeof error.message === 'string') ? error.message : '';
        if (errMsg && (errMsg.includes('Failed to fetch') || errMsg.includes('network'))) {
            throw new Error('网络连接失败。请检查:\n1. 网络是否正常\n2. MCP 服务是否运行\n3. visionApiUrl 配置: ' + visionApiUrl);
        }

        if (error && error instanceof Error) {
            // ★ 区分: 用量上限(不设冷却) vs 实际限流(设30s冷却)
            if (error.message && error.message.includes('用量上限')) {
                throw new Error('⚠️ MiniMax Token Plan 用量已耗尽。请升级套餐或购买积分: https://platform.minimaxi.com');
            }
            if (error.message && error.message.includes('Token Plan')) {
                window.__minimaxRateLimited = Date.now();
                throw new Error('⚠️ MiniMax API 请求过频。建议稍后再试或升级套餐提升 RPM');
            }
            throw error;
        } else {
            throw new Error('图片分析失败: ' + String(error));
        }
    }
}

window.analyzeVideo = async function(videoInput, query) {
    if (!videoInput || typeof videoInput !== 'string') throw new Error('无效视频');
    var enginePath = videoInput;
    if (videoInput.startsWith(window.location.origin)) enginePath = videoInput.slice(window.location.origin.length);
    var _endpoint = '/engine/video_edit';
    var _vHeaders = typeof getSessionAuthHeaders === 'function' ? getSessionAuthHeaders({'Content-Type':'application/json'}) : {'Content-Type':'application/json'};

    async function _videoEngineCall(action, params) {
        var response = await fetch(_endpoint, { method:'POST', headers:_vHeaders, body:JSON.stringify({action:action,params:params||{},input_path:enginePath}) });
        var raw = await response.text();
        var data;
        try { data = JSON.parse(raw); } catch(e) { throw new Error('视频解析服务返回了非 JSON 响应 (HTTP ' + response.status + ')'); }
        if (!response.ok || data.error) throw new Error(data.error || ('视频解析服务 HTTP ' + response.status));
        return data;
    }

    // 获取元信息。错误不再静默吞掉，避免模型误报“没有读取权限”。
    var infoData = await _videoEngineCall('info', {});
    var infoJson;
    try { infoJson = JSON.parse(infoData.result || '{}'); } catch(e) { throw new Error('无法解析视频元信息'); }
    var duration = parseFloat(infoJson.format?.duration || 0);
    if (!(duration > 0)) throw new Error('无法读取视频时长，请确认 MP4 文件完整且 ffprobe 可用');
    var vStream = (infoJson.streams || []).find(function(s){return s.codec_type==='video';}) || {};
    var width = vStream.width || 0, height = vStream.height || 0, codec = vStream.codec_name || '', fps = vStream.r_frame_rate || '';

    // 询问结尾时密集覆盖最后两秒与最终定格；其他问题做全片均匀采样。
    var _q = String(query || '描述视频内容');
    var _endingFocus = /(结尾|最后|末尾|收尾|定格|最后一两秒|last\s*(?:one|two|1|2)?\s*seconds?|ending|final\s*frame)/i.test(_q);
    var timestamps = [];
    if (_endingFocus) {
        [2, 1.25, 0.7, 0.3, 0.08].forEach(function(beforeEnd) { timestamps.push(Math.max(0, duration - beforeEnd)); });
    } else {
        var frameCount = Math.max(6, Math.min(18, Math.ceil(duration / 8) + 4));
        for (var ti = 0; ti < frameCount; ti++) timestamps.push((duration - 0.08) * ti / Math.max(1, frameCount - 1));
    }
    timestamps = timestamps.map(function(v){ return Math.round(v * 1000) / 1000; }).filter(function(v, i, arr){ return i === 0 || Math.abs(v - arr[i-1]) >= 0.03; });

    var frData = await _videoEngineCall('frames', {count:timestamps.length,duration:duration,scale:768,timestamps:timestamps});
    var frJson;
    try { frJson = JSON.parse(frData.result || '{}'); } catch(e) { throw new Error('无法解析视频画面帧'); }
    var frames = frJson.frames || [];
    var frameTimes = frJson.timestamps || timestamps.slice(0, frames.length);
    if (!frames.length) throw new Error('视频画面帧提取失败，请确认服务器已安装 ffmpeg 且上传文件仍然存在');

    // 逐帧复用配置栏当前选择的视觉提供商、视觉模型、端点与密钥。
    var provider = localStorage.getItem('visionProvider') || 'auto';
    var model = localStorage.getItem('visionModel') || DEFAULT_CONFIG.visionModel || '';
    var frameAnalyses = [];
    var failures = [];
    var concurrency = 3;
    for (var bi = 0; bi < frames.length; bi += concurrency) {
        var batch = frames.slice(bi, bi + concurrency);
        var batchResults = await Promise.all(batch.map(function(frame, offset) {
            var idx = bi + offset;
            var ts = Number(frameTimes[idx] || 0);
            var focus = '这是视频在 ' + ts.toFixed(2) + ' 秒处的画面（第' + (idx + 1) + '/' + frames.length + '帧）。请严格依据画面回答：' + _q + '。特别说明人物动作、物体变化、屏幕文字和是否为最终定格；不要猜测不可见内容。';
            return window.analyzeImage(frame, focus).then(function(text) {
                return {ok:true,text:'**' + ts.toFixed(2) + 's:** ' + (text || '分析完成')};
            }).catch(function(err) {
                return {ok:false,error:(err && err.message) || String(err),time:ts};
            });
        }));
        batchResults.forEach(function(item) { if (item.ok) frameAnalyses.push(item.text); else failures.push(item); });
    }
    if (!frameAnalyses.length) {
        var firstError = failures[0]?.error || '视觉模型未返回结果';
        throw new Error('关键帧已成功提取，但所选视觉模型分析失败：' + firstError + '。请检查配置栏中的视觉提供商、模型、API 地址与密钥。');
    }

    var result = '🎬 **视频分析结果**\n\n**解析链路:** ffmpeg 关键帧 → 配置栏视觉模型 ' + provider + '/' + (model || '默认模型') + '\n\n**元信息:**\n';
    result += '- 时长: ' + Math.floor(duration/60) + '分' + Math.round(duration%60) + '秒\n';
    if (width) result += '- 分辨率: ' + width + 'x' + height + '\n';
    if (fps) result += '- 帧率: ' + fps + '\n';
    if (codec) result += '- 编码: ' + codec + '\n';
    result += '- 采样模式: ' + (_endingFocus ? '结尾密集采样（最后两秒 + 最终定格）' : '全片均匀采样') + '\n';
    result += '\n**关键帧分析(' + frameAnalyses.length + '/' + frames.length + '帧成功):**\n';
    frameAnalyses.forEach(function(a) { result += '\n' + a + '\n'; });
    if (failures.length) result += '\n> 另有 ' + failures.length + ' 帧视觉分析失败，已保留成功帧结果。\n';

    try {
        if (currentChatId && chats[currentChatId]) {
            if (!chats[currentChatId].videoAnalyses) chats[currentChatId].videoAnalyses = {};
            chats[currentChatId].videoAnalyses[enginePath + '::' + _q] = {time:Date.now(),duration:duration,meta:{width:width,height:height,codec:codec,fps:fps,format:infoJson.format?.format_name,provider:provider,model:model,endingFocus:_endingFocus},frames:frameAnalyses};
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
    if (imageProvider === 'openai') {
        return generateImageOpenAI(prompt, options);
    }
    if (imageProvider === 'custom') {
        return generateImageCustom(prompt, options);
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

    var imageModel = localStorage.getItem('imageModel_minimax') || localStorage.getItem('imageModel') || 'image-01';
    // ★ 过滤 AI 传来的其他提供商模型名(如 openai/gpt-5.4-image-2),只使用 MiniMax 模型
    var actualModel = imageModel;
    if (options.model && options.model !== imageModel) {
        var _m = options.model.toLowerCase();
        var _isOtherProvider = (_m.indexOf('gpt-5.4-image') !== -1 || _m.indexOf('gpt-4o-image') !== -1 ||
            _m.indexOf('gpt-image') !== -1 || _m.indexOf('dall-e') !== -1);
        if (!_isOtherProvider) {
            actualModel = options.model;
        } else {
            console.warn('[generateImage MiniMax] 忽略 AI 传来的其他提供商模型:', options.model, '使用配置模型:', imageModel);
        }
    }
    var apiUrl = baseUrl + '/image_generation';
    try {
        var body = {
            model: actualModel,
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

// 生成图上传时携带聊天定位信息，upload.php 会在返回 URL 前原子绑定气泡。
// 普通用户上传不使用此选项，因此不会被误挂到助手消息。
function _generatedUploadOptions(prompt, options, model) {
    options = options || {};
    return {
        name: prompt || '',
        persistGenerated: !!options.chat_id,
        chatId: options.chat_id || '',
        messageIndex: Number.isInteger(options.message_index) ? options.message_index : undefined,
        prompt: prompt || '',
        model: model || options.model || '',
        aspect_ratio: options.aspect_ratio || '1:1',
        timestamp: Date.now()
    };
}

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

    // ★ 优先读取提供商独立键,回退到通用 imageModel 键(兼容旧配置)
    var configuredModel = localStorage.getItem('imageModel_openrouter') || localStorage.getItem('imageModel') || 'openai/gpt-5.4-image-2';
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
                var _srvUrl = await uploadImageToServer(images[_ui], _generatedUploadOptions(prompt, options, actualModel));
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

// ★ aspect_ratio → OpenAI size 映射
function _aspectRatioToOpenAISize(aspectRatio, options) {
    if (options.size) return options.size;
    var map = {
        '1:1': '1024x1024',
        '16:9': '1792x1024',
        '9:16': '1024x1792',
        '4:3': '1024x1024',
        '3:4': '1024x1024',
        '21:9': '1792x1024'
    };
    return map[aspectRatio] || '1024x1024';
}

// ===== OpenAI 原生生图 (gpt-image-1 / DALL-E) =====
// 端点: /v1/images/generations, 格式: {model, prompt, n, size, quality, response_format: 'b64_json'}
async function generateImageOpenAI(prompt, options = {}) {
    let baseUrl = (localStorage.getItem('imageBaseUrlOpenai') || 'https://api.openai.com/v1').replace(/\/$/, '');
    if (baseUrl && !baseUrl.endsWith('/v1')) baseUrl = baseUrl + '/v1';
    var rawKey = localStorage.getItem('imageApiKeyOpenai') || '';
    let apiKey = '';
    try { apiKey = await decrypt(rawKey) || ''; } catch(e) { console.error('[generateImageOpenAI] decrypt error:', e.message); }

    if (!apiKey) throw new Error('未配置 OpenAI API Key,请在设置-图像生成中填写');

    // ★ 过滤 AI 传来的其他提供商模型名,只使用 OpenAI 兼容模型
    var _openaiModel = localStorage.getItem('imageModel_openai') || 'gpt-image-1';
    var model = _openaiModel;
    if (options.model && options.model !== _openaiModel) {
        var _m = options.model.toLowerCase();
        var _isOtherProvider = (_m.indexOf('image-01') !== -1 || _m.indexOf('minimax') !== -1 ||
            _m.indexOf('gpt-5.4-image') !== -1 || _m.indexOf('gpt-4o-image') !== -1);
        if (!_isOtherProvider) {
            model = options.model;
        } else {
            console.warn('[generateImageOpenAI] 忽略 AI 传来的其他提供商模型:', options.model, '使用配置模型:', _openaiModel);
        }
    }
    var apiUrl = baseUrl + '/images/generations';
    var n = Math.min(options.n || 1, 10);
    var size = _aspectRatioToOpenAISize(options.aspect_ratio || '1:1', options);

    // ★ xAI (Grok) 不支持 size / quality 参数,需自动省略避免 400 错误
    //    用户可能将 xAI 配置在 OpenAI 提供商下(base URL 指向 api.x.ai)
    var _isXai = (baseUrl.indexOf('x.ai') !== -1) || (model.toLowerCase().indexOf('grok') !== -1);

    try {
        var body = {
            model: model,
            prompt: prompt,
            n: n,
            response_format: 'b64_json'
        };
        // xAI 不接受 size / quality,其他 OpenAI 兼容提供商(含 gpt-image-1)保留
        if (!_isXai) body.size = size;
        if (options.quality && !_isXai) body.quality = options.quality;
        if (options.background) body.background = options.background;
        if (options.moderation) body.moderation = options.moderation;

        var _sendImageRequest = function(key) {
            return window.proxyFetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(900000)
            });
        };
        var response = await _sendImageRequest(apiKey);

        if (!response.ok) {
            var errText = await response.text().catch(function() { return response.statusText; });
            throw new Error('OpenAI 生图请求失败 (' + response.status + '): ' + errText.substring(0, 300));
        }

        var data = await response.json();
        if (data.error) throw new Error('OpenAI 错误: ' + (data.error.message || JSON.stringify(data.error)));

        // 复用通用提取器 (支持 data.data[{b64_json, url}] 格式)
        var images = _extractImagesFromResponse(data);
        if (images.length === 0) throw new Error('OpenAI 未返回图片,响应: ' + JSON.stringify(data).substring(0, 500));

        // 上传到服务器获取持久 URL
        var _uploaded = [];
        for (var _ui = 0; _ui < images.length; _ui++) {
            var _srvUrl = await uploadImageToServer(images[_ui], _generatedUploadOptions(prompt, options, model));
            _uploaded.push(_srvUrl || images[_ui]);
        }
        return _uploaded.length === 1 ? _uploaded[0] : _uploaded;
    } catch (e) {
        console.error('[generateImageOpenAI] error:', e);
        throw e;
    }
}

// ===== 自定义提供商 (OpenAI 兼容 /v1/images/generations) =====
async function generateImageCustom(prompt, options = {}) {
    let baseUrl = (localStorage.getItem('imageBaseUrlCustom') || '').replace(/\/$/, '');
    if (baseUrl && !baseUrl.endsWith('/v1')) baseUrl = baseUrl + '/v1';
    var rawKey = localStorage.getItem('imageApiKeyCustom') || '';
    let apiKey = '';
    try { apiKey = await decrypt(rawKey) || ''; } catch(e) { console.error('[generateImageCustom] decrypt error:', e.message); }

    if (!baseUrl) throw new Error('未配置自定义 API 地址,请在设置-图像生成中填写');
    if (!apiKey) throw new Error('未配置自定义 API Key,请在设置-图像生成中填写');

    // ★ 过滤 AI 传来的其他提供商模型名,只使用配置的模型
    // 阻断范围: MiniMax(image-01/minimax) / OpenRouter(gpt-5.4-image/gpt-4o-image) / 所有 gpt-image-* 变体
    // 自定义提供商用户已显式配置模型,AI 不应覆盖为其他 gpt-image 变体
    var _customModel = localStorage.getItem('imageModel_custom') || '';
    var model = _customModel;
    if (options.model && options.model !== _customModel) {
        var _m = options.model.toLowerCase();
        var _isOtherProvider = (_m.indexOf('image-01') !== -1 || _m.indexOf('minimax') !== -1 ||
            _m.indexOf('gpt-5.4-image') !== -1 || _m.indexOf('gpt-4o-image') !== -1 ||
            _m.indexOf('gpt-image-') !== -1);
        if (!_isOtherProvider) {
            model = options.model;
        } else {
            console.warn('[generateImageCustom] 忽略 AI 传来的其他提供商模型:', options.model, '使用配置模型:', _customModel);
        }
    }
    if (!model) throw new Error('未配置自定义模型名,请在图像生成的模型字段填写');

    var apiUrl = baseUrl + '/images/generations';
    var n = Math.min(options.n || 1, 10);
    var size = _aspectRatioToOpenAISize(options.aspect_ratio || '1:1', options);

    // ★ xAI (Grok) 不支持 size / quality 参数,需自动省略避免 400 错误
    var _isXai = (baseUrl.indexOf('x.ai') !== -1) || (model.toLowerCase().indexOf('grok') !== -1);

    try {
        var body = { model: model, prompt: prompt, n: n, response_format: 'b64_json' };
        if (!_isXai) body.size = size; // xAI 不接受 size,其他 OpenAI 兼容提供商保留
        if (options.quality && !_isXai) body.quality = options.quality;

        var _sendImageRequest = function(key) {
            return window.proxyFetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(900000)
            });
        };
        var response = await _sendImageRequest(apiKey);

        // 图片专用 Key 可能因跨设备同步而滞后。仅当 Custom 主配置指向同一
        // Base URL 且上游明确返回认证失败时，安全地用已配置的主 Custom Key 重试一次。
        if (response.status === 401 || response.status === 403) {
            var _mainCustomBase = (localStorage.getItem('baseUrlCustom') || '').replace(/\/$/, '');
            if (_mainCustomBase && !_mainCustomBase.endsWith('/v1')) _mainCustomBase += '/v1';
            var _mainCustomRawKey = localStorage.getItem('apiKeyCustom') || '';
            if (_mainCustomBase === baseUrl && _mainCustomRawKey && _mainCustomRawKey !== rawKey) {
                var _mainCustomKey = '';
                try { _mainCustomKey = await decrypt(_mainCustomRawKey) || ''; } catch(e) {}
                if (_mainCustomKey) {
                    console.warn('[generateImageCustom] 图片专用凭据认证失败，使用同源 Custom 主凭据重试');
                    apiKey = _mainCustomKey;
                    response = await _sendImageRequest(apiKey);
                }
            }
        }

        if (!response.ok) {
            var errText = await response.text().catch(function() { return response.statusText; });
            // CLIProxy 连接生图上游、尚未拿到响应时偶发 EOF。仅对这类
            // 传输故障重试一次，不对普通 4xx/5xx 重复生图。
            var _isPreResponseTransportError = [500, 502, 503, 504].indexOf(response.status) !== -1 &&
                /(unexpected\s+EOF|connection\s+(?:reset|error)|upstream\s+connect)/i.test(errText || '');
            if (_isPreResponseTransportError) {
                console.warn('[generateImageCustom] 上游连接在响应前中断，1.5s 后重试一次');
                await new Promise(function(resolve) { setTimeout(resolve, 1500); });
                response = await _sendImageRequest(apiKey);
                errText = response.ok ? '' : await response.text().catch(function() { return response.statusText; });
            }
            if (!response.ok) {
                throw new Error('自定义生图请求失败 (' + response.status + '): ' + errText.substring(0, 300));
            }
        }

        var data = await response.json();
        if (data.error) throw new Error('自定义 API 错误: ' + (data.error.message || JSON.stringify(data.error)));

        var images = _extractImagesFromResponse(data);
        if (images.length === 0) throw new Error('自定义 API 未返回图片,响应: ' + JSON.stringify(data).substring(0, 500));

        var _uploaded = [];
        for (var _ui = 0; _ui < images.length; _ui++) {
            var _srvUrl = await uploadImageToServer(images[_ui], _generatedUploadOptions(prompt, options, model));
            _uploaded.push(_srvUrl || images[_ui]);
        }
        return _uploaded.length === 1 ? _uploaded[0] : _uploaded;
    } catch (e) {
        console.error('[generateImageCustom] error:', e);
        throw e;
    }
}

// ★ OpenRouter GPT Image 图生图 — chat/completions + 多图参考
async function _gptImageI2I(prompt, primaryImage, options = {}) {
    // ★ 优先使用用户当前配置的提供商(而非硬编码 OpenRouter)
    var _i2iCurProvider = localStorage.getItem('imageProvider') || 'openrouter';
    var _i2iIsCustom = (_i2iCurProvider === 'custom');
    var _i2iBaseKey = _i2iIsCustom ? 'imageBaseUrlCustom' : 'imageBaseUrlOpenrouter';
    var _i2iKeyKey  = _i2iIsCustom ? 'imageApiKeyCustom'  : 'imageApiKeyOpenrouter';
    var _i2iDefUrl  = _i2iIsCustom ? '' : 'https://openrouter.ai/api';

    let baseUrl = (localStorage.getItem(_i2iBaseKey) || _i2iDefUrl).replace(/\/$/, '');
    if (baseUrl && !baseUrl.endsWith('/v1')) baseUrl = baseUrl + '/v1';
    var rawKey = localStorage.getItem(_i2iKeyKey) || '';
    let apiKey = '';
    try { apiKey = await decrypt(rawKey) || ''; } catch(e) {}
    if (!apiKey) throw new Error('未配置 API Key(提供商: ' + _i2iCurProvider + ')');

    // 当前提供商专属模型是唯一权威来源；禁止通用 imageModel / OpenRouter 模型跨提供商串扰。
    var _i2iConfiguredModel = localStorage.getItem('imageModel_' + _i2iCurProvider) || '';
    var model = _i2iConfiguredModel || options.model || (_i2iIsCustom ? '' : 'openai/gpt-5.4-image-2');
    if (!model) throw new Error('未配置图生图模型(提供商: ' + _i2iCurProvider + ')');
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

        var _sendGptI2iRequest = function() {
            return window.proxyFetch(chatUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(900000)
            });
        };
        var response = await _sendGptI2iRequest();

        if (!response.ok) {
            var errText = await response.text().catch(function(){return response.statusText;});
            throw new Error('GPT Image i2i 请求失败 (' + response.status + '): ' + errText.substring(0, 300));
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
            var _srvUrl = await uploadImageToServer(images[_ui], _generatedUploadOptions(prompt, options, model));
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

    // GPT Image 1/2 在 OpenAI 与 CLIProxyAPI 兼容网关上必须走 /v1/images/edits。
    // 聊天主模型提供商（例如 xAI）与图片提供商完全正交，不参与这里的路由选择。
    if (_is_gpt_image && (_i2i_provider === 'openai' || _i2i_provider === 'custom')) {
        return await _openaiImageEdit(prompt, image, options);
    }

    // OpenRouter 的 GPT Image 扩展使用 chat/completions + modalities。
    if (_is_gpt_image && _i2i_provider === 'openrouter') {
        return await _gptImageI2I(prompt, image, options);
    }

    // OpenRouter / Custom 的其他模型如果没有原生编辑协议，只能走其文生图接口。
    if (_i2i_provider === 'openrouter' || _i2i_provider === 'custom') {
        return window.generateImage(prompt, options);
    }

    // OpenAI 其他编辑模型也使用 /v1/images/edits；失败应原样上报，禁止静默改成文生图。
    if (_i2i_provider === 'openai') {
        return await _openaiImageEdit(prompt, image, options);
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
            var _rfn = window.proxyFetch;  // ★ 统一走 proxyFetch: 直连→回退
            var retryResp = await _rfn(apiUrl, {
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
            var serverUrl = await uploadImageToServer(imageResult, _generatedUploadOptions(prompt, options, _i2i_model));
            if (serverUrl) {
                return serverUrl; // 返回服务器 URL 而不是 base64
            }
            return imageResult; // 上传失败则返回 base64
        } else {
            console.error('[I2I] 未识别的返回格式:', { responseType: Array.isArray(data) ? 'array' : typeof data, responseKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 20) : [] });
            throw new Error('图像生成 API 返回数据格式异常');
        }
    } catch (e) {
        console.error('Image i2i error:', e);
        throw e;
    }
};

// ★ OpenAI / 自定义 原生图生图 — /v1/images/edits (multipart form)
async function _openaiImageEdit(prompt, image, options = {}) {
    var provider = localStorage.getItem('imageProvider') || 'openai';
    var isCustom = provider === 'custom';
    let baseUrl = (localStorage.getItem(isCustom ? 'imageBaseUrlCustom' : 'imageBaseUrlOpenai') || (isCustom ? '' : 'https://api.openai.com/v1')).replace(/\/$/, '');
    if (baseUrl && !baseUrl.endsWith('/v1')) baseUrl = baseUrl + '/v1';
    var rawKey = localStorage.getItem(isCustom ? 'imageApiKeyCustom' : 'imageApiKeyOpenai') || '';
    let apiKey = '';
    try { apiKey = await decrypt(rawKey) || ''; } catch(e) {}

    if (!baseUrl) throw new Error('未配置 API 地址');
    if (!apiKey) throw new Error('未配置 API Key');

    // ★ 图生图: 优先使用提供商独立键,回退通用键;AI 传来的模型名仅在不匹配已知其他提供商模型时采纳
    var _editConfiguredModel = localStorage.getItem('imageModel_' + provider) || localStorage.getItem('imageModel') || 'gpt-image-1';
    var model = _editConfiguredModel;
    if (options.model && options.model !== _editConfiguredModel) {
        var _em = options.model.toLowerCase();
        var _isOtherProviderEdit = (_em.indexOf('image-01') !== -1 || _em.indexOf('minimax') !== -1 ||
            _em.indexOf('gpt-5.4-image') !== -1 || _em.indexOf('gpt-4o-image') !== -1 ||
            _em.indexOf('gpt-image-') !== -1);
        if (!_isOtherProviderEdit) {
            model = options.model;
        }
    }
    var apiUrl = baseUrl + '/images/edits';
    var size = _aspectRatioToOpenAISize(options.aspect_ratio || '1:1', options);
    var n = Math.min(options.n || 1, 10);

    // 将图片(data URL / URL / 相对路径)转为 Blob
    var imageBlob;
    if (image.startsWith('data:')) {
        var parts = image.split(',');
        var mimeMatch = parts[0].match(/:(.*?);/);
        var mime = mimeMatch ? mimeMatch[1] : 'image/png';
        var bstr = atob(parts[1]);
        var u8arr = new Uint8Array(bstr.length);
        for (var _bi = 0; _bi < bstr.length; _bi++) u8arr[_bi] = bstr.charCodeAt(_bi);
        imageBlob = new Blob([u8arr], { type: mime });
    } else {
        // URL 或相对路径 → 先 fetch 下载
        var imgUrl = image.startsWith('http') ? image : window.location.origin + image;
        var imgResp = await window.proxyFetch(imgUrl);
        if (!imgResp.ok) throw new Error('下载参考图失败: ' + imgResp.status);
        imageBlob = await imgResp.blob();
    }

    // 构建 multipart form data
    var formData = new FormData();
    formData.append('image', imageBlob, 'image.png');
    formData.append('model', model);
    formData.append('prompt', prompt || '基于参考图生成新图片');
    formData.append('n', String(n));
    formData.append('size', size);
    if (options.quality) formData.append('quality', options.quality);
    if (options.mask_image && (options.mask_image.startsWith('data:') || options.mask_image.startsWith('http'))) {
        formData.append('mask', options.mask_image.startsWith('data:') ? dataURLtoBlob(options.mask_image) : options.mask_image);
    }

    var response = await window.proxyFetch(apiUrl, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey },
        body: formData,
        signal: AbortSignal.timeout(900000)
    });

    if (!response.ok) {
        var errText = await response.text().catch(function() { return response.statusText; });
        throw new Error('图生图请求失败 (' + response.status + '): ' + errText.substring(0, 300));
    }

    var data = await response.json();
    if (data.error) throw new Error('图生图错误: ' + (data.error.message || JSON.stringify(data.error)));

    var images = _extractImagesFromResponse(data);
    if (images.length === 0) throw new Error('图生图未返回图片,响应: ' + JSON.stringify(data).substring(0, 500));

    var _uploaded = [];
    for (var _ui = 0; _ui < images.length; _ui++) {
        var _srvUrl = await uploadImageToServer(images[_ui], _generatedUploadOptions(prompt, options, model));
        _uploaded.push(_srvUrl || images[_ui]);
    }
    return _uploaded.length === 1 ? _uploaded[0] : _uploaded;
}

// ★ 辅助: data URL → Blob
function dataURLtoBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mimeMatch = parts[0].match(/:(.*?);/);
    var mime = mimeMatch ? mimeMatch[1] : 'image/png';
    var bstr = atob(parts[1]);
    var u8arr = new Uint8Array(bstr.length);
    for (var i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
    return new Blob([u8arr], { type: mime });
}

// ★ 构建带元数据的图片对象 — 统一存储格式
window.buildImageMeta = function(url, prompt, options) {
    return {
        url: url,
        prompt: prompt || '',
        model: (options && options.model) || localStorage.getItem('imageModel_' + (localStorage.getItem('imageProvider') || 'minimax')) || '',
        aspect_ratio: (options && options.aspect_ratio) || '1:1',
        timestamp: Date.now(),
        notes: (options && options.notes) || ''  // ★ 新增：用户备注
    };
};
