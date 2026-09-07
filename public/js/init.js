// init.js — 初始化系统 v1.0 (Phase 4 拆分自 main.js)
// cacheDOMElements / init / restoreDefaultConfig / initConfig

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
    var style = document.createElement('style');
    style.textContent = `
        /* ★ 等待中三点脉动 — :not(.streaming) 防止与流式光标同时命中:
           两个规则同时命中时 typing 的 width:1.5em 会泄漏给 streaming 光标 → 粗彩色光标块 */
        .bubble.assistant.typing:not(.streaming) .markdown-body::after { content:'...'; display:inline-block; animation:typing-dots 1.2s steps(4,end) infinite; width:1.5em; text-align:left; font-size:1.2em; line-height:1; opacity:0.7; background:none; }
        @keyframes typing-dots { 0%,20% { content:''; } 40% { content:'.'; } 60% { content:'..'; } 80%,100% { content:'...'; } }
        .bubble.assistant { padding:12px 16px; }
        .markdown-body img { max-width: 100%; max-height: 300px; object-fit: contain; border-radius: 8px; margin: 8px 0; }
        .markdown-body a { color: #0366d6; text-decoration: underline; text-underline-offset: 2px; }
        .markdown-body a:hover { color: #0056b3; text-decoration: none; background-color: #f0f6ff; }
        .search-placeholder { color: #666; font-style: italic; }
        /* ★ 流式输出光标 — 细线呼吸动画 (显式重置宽高, 防 typing 规则泄漏) */
        .bubble.streaming { transition: box-shadow 0.3s ease; }
        .bubble.streaming .markdown-body::after {
            content: '' !important; display: inline-block;
            width: 2px !important; height: 1em !important; margin-left: 2px;
            vertical-align: text-bottom;
            background: linear-gradient(180deg, #6366f1, #8b5cf6) !important;
            border-radius: 1px;
            animation: stream-cursor 1s ease-in-out infinite;
        }
        @keyframes stream-cursor { 0%, 100% { opacity: 1; } 50% { opacity: 0.15; } }
        .search-status { background: rgba(0,0,0,0.03); border-radius: 4px; padding: 4px 8px; margin-bottom: 8px; font-size: 0.9em; color: #666; max-height: 100px; overflow-y: auto; }
        .dark .search-status { background: rgba(255,255,255,0.1); color: #aaa; }
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
    var configKeys = [
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


// 将消息字段安全转换为可导出的纯文本，兼容 user.text / assistant.content 以及多模态数组。
function _exportTextValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map(function(part) {
            if (part === null || part === undefined) return '';
            if (typeof part === 'string') return part;
            if (typeof part === 'object') return part.text || part.content || part.value || '';
            return String(part);
        }).filter(Boolean).join('\n');
    }
    if (typeof value === 'object') {
        if (value.text || value.content || value.value) return value.text || value.content || value.value;
        try { return JSON.stringify(value); } catch (e) { return String(value); }
    }
    return String(value);
}

// 统一用 UTF-8 with BOM 下载文本，兼容 Windows 记事本/Word 等按本地编码猜测的程序。
function _downloadUtf8Text(filename, text, mime) {
    var normalized = String(text === null || text === undefined ? '' : text)
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
    var blob = new Blob(['\uFEFF', normalized], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 延迟释放 Blob URL，兼容仍在排队处理下载点击的旧版浏览器。
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}
window._downloadUtf8Text = _downloadUtf8Text;

// ★ 导出聊天记录
function exportChats() {
    if (!chats || Object.keys(chats).length === 0) {
        alert('没有聊天记录可导出');
        return;
    }
    var exportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        chats: chats
    };
    var json = JSON.stringify(exportData, null, 2);
    _downloadUtf8Text('oneapichat-chats-' + new Date().toISOString().slice(0,10) + '.json', json, 'application/json');
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

    var msgs = Array.isArray(chat.messages) ? chat.messages : [];
    var includeDebug = false;
    try { includeDebug = localStorage.getItem('exportChatDebug') === '1'; } catch (e) {}
    msgs.forEach(function(m) {
        if (!m || m.role === 'system' || m.temporary || m._internal || m.role === 'tool' || m.role === 'tool_card' || m._toolResult || m._toolCard) return;
        if (m.role !== 'user' && m.role !== 'assistant') return;
        var roleName = m.role === 'user' ? '👤 你' : '🤖 AI';
        var messageValue = m.text !== undefined ? m.text : m.content;
        var messageText = _exportTextValue(messageValue).trim();
        var imageLines = [];
        if (m.generatedImage) imageLines.push('[图片: ' + String(m.generatedImage).substring(0, 50) + '...]');
        if (m.generatedImages && m.generatedImages.length) {
            m.generatedImages.forEach(function(img) { imageLines.push('[图片: ' + String(img).substring(0, 50) + '...]'); });
        }
        if (!messageText && imageLines.length === 0 && !(includeDebug && (m.reasoning || (m.tool_calls && m.tool_calls.length)))) return;
        lines.push(roleName + ':');
        if (messageText) lines.push(messageText);
        imageLines.forEach(function(line) { lines.push(line); });
        // 默认导出只保留可分享的最终对话，避免把内部思考和工具轨迹再次喂给模型。
        // 需要诊断时可显式设置 localStorage.exportChatDebug=1。
        if (includeDebug && m.reasoning) {
            lines.push('思考过程:');
            lines.push(_exportTextValue(m.reasoning));
        }
        if (includeDebug && m.tool_calls && m.tool_calls.length) {
            m.tool_calls.forEach(function(tc) {
                if (tc && tc.function) lines.push('[工具调用: ' + (tc.function.name || '未知工具') + ']');
            });
        }
        lines.push('');
    });

    var filename = title.replace(/[\\/:*?"<>|]/g, '_') + '.txt';
    _downloadUtf8Text(filename, lines.join('\n'), 'text/plain');
}

// ★ 导入聊天记录
function importChats() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = function(e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
            try {
                var data = JSON.parse(ev.target.result);
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
/** 从 API_PROVIDERS 动态生成提供商下拉列表 */
function populateProviderSelect() {
    var sel = getEl('baseUrlProvider');
    if (!sel || typeof API_PROVIDERS === 'undefined') return;
    var keys = Object.keys(API_PROVIDERS);
    // custom 放最后, llamacpp 放倒数第二
    keys.sort(function(a, b) {
        if (a === 'llamacpp') return 1;
        if (b === 'llamacpp') return -1;
        if (a === 'custom') return 1;
        if (b === 'custom') return -1;
        return 0;
    });
    sel.innerHTML = keys.map(function(k) {
        var cfg = API_PROVIDERS[k];
        return '<option value="' + k + '">' + cfg.label + '</option>';
    }).join('');
    // 恢复已选值
    var saved = localStorage.getItem('baseUrlProvider') || 'deepseek';
    if (API_PROVIDERS[saved]) sel.value = saved;
}
async function initializeConfig() {
    var savedProvider = localStorage.getItem('baseUrlProvider') || 'deepseek';
    setVal('baseUrlProvider', savedProvider);
    var _provCfg = API_PROVIDERS[savedProvider] || API_PROVIDERS.custom;
    var _rawK = localStorage.getItem(_provCfg.keyLS);
    var _pk = '';
    if (_rawK) { _pk = await decrypt(_rawK) || ''; if (_pk === 'not-needed') _pk = ''; }
    // 兼容旧数据: DeepSeek 之前存 apiKey
    if (!_pk && _provCfg.keyLS === 'apiKeyDeepseek') { var _old = localStorage.getItem('apiKey'); if (_old) { _pk = await decrypt(_old) || ''; if (_pk === 'not-needed') _pk = ''; } }
    setVal('apiKey', _pk);
    var _lab = getEl('apiKeyLabel'); if (_lab) _lab.textContent = 'API Key (' + _provCfg.label + ')';
    if (savedProvider === 'custom') setVal('baseUrl', localStorage.getItem('baseUrlCustom') || '');
    else if (_provCfg.baseUrl) setVal('baseUrl', _provCfg.baseUrl);
    else setVal('baseUrl', localStorage.getItem('baseUrl') || DEFAULT_CONFIG.url);
    // 当前厂商专属模型拥有最高优先级；全局 model 仅允许作为新设备没有专属记录时的初始化回退。
    var _pm = localStorage.getItem('model_' + savedProvider) || localStorage.getItem('model') || DEFAULT_CONFIG.model;
    // ★ 初始化永远以持久化的 _pm 为权威；即使 ModelsCatalog 尚未加载，也要先建立一个真实 option，不能从空 DOM 反推 DEFAULT_CONFIG。
    var ms = getEl('modelSelect');
    if (ms) {
        var _initialHtml = '';
        if (window.ModelsCatalog && typeof window.ModelsCatalog.renderModelOptionsHtml === 'function') {
            _initialHtml = window.ModelsCatalog.renderModelOptionsHtml([], savedProvider, _pm);
        }
        if (_initialHtml) ms.innerHTML = _initialHtml;
        var _matchedInit = false;
        if (_pm && !/^(加载中|请输入|获取失败|loading)/i.test(_pm)) {
            for (var _oiInit = 0; _oiInit < ms.options.length; _oiInit++) {
                if (ms.options[_oiInit].value.toLowerCase() === _pm.toLowerCase()) {
                    ms.selectedIndex = _oiInit;
                    _matchedInit = true;
                    break;
                }
            }
            if (!_matchedInit) {
                var _optInit = document.createElement('option');
                _optInit.value = _pm;
                _optInit.textContent = _pm;
                _optInit.selected = true;
                ms.appendChild(_optInit);
            }
        }
    }
    if (_pm && !/^(加载中|请输入|获取失败|loading)/i.test(_pm)) {
        localStorage.setItem('model', _pm);
        localStorage.setItem('model_' + savedProvider, _pm);
    }
    setVal('visionModel', localStorage.getItem('visionModel') || DEFAULT_CONFIG.visionModel || '');
    setVal('visionApiUrl', localStorage.getItem('visionApiUrl') || DEFAULT_CONFIG.visionApiUrl || '');
    var storedVisionKey = await decrypt(localStorage.getItem('visionApiKey') || '');
    var cleanVisionKey = (storedVisionKey && storedVisionKey !== 'not-needed') ? storedVisionKey : '';
    setVal('visionApiKey', cleanVisionKey || '');
    // 视觉理解提供商
    var _visionProvider = localStorage.getItem('visionProvider') || 'minimax';
    if (getEl('visionProvider')) getEl('visionProvider').value = _visionProvider;
    window._lastVisionProvider = _visionProvider;
    // 加载 OpenAI Vision 的配置
    var storedOAKey = await decrypt(localStorage.getItem('visionApiKeyOpenAI') || '');
    setVal('visionApiKeyOpenAI', (storedOAKey && storedOAKey !== 'not-needed') ? storedOAKey : '');
    setVal('visionApiUrlOpenAI', localStorage.getItem('visionApiUrlOpenAI') || 'https://api.openai.com/v1');
    // ★ 加载 xAI Vision 的配置(刷新后恢复)
    var storedXAIKey = await decrypt(localStorage.getItem('visionApiKeyXAI') || '');
    setVal('visionApiKeyXAI', (storedXAIKey && storedXAIKey !== 'not-needed') ? storedXAIKey : '');
    setVal('visionApiUrlXAI', localStorage.getItem('visionApiUrlXAI') || 'https://api.x.ai/v1');
    // ★ 加载自定义 Vision 的配置(刷新后恢复)
    var storedCustomVisionKey = await decrypt(localStorage.getItem('visionApiKeyCustom') || '');
    setVal('visionApiKeyCustom', (storedCustomVisionKey && storedCustomVisionKey !== 'not-needed') ? storedCustomVisionKey : '');
    setVal('visionApiUrlCustom', localStorage.getItem('visionApiUrlCustom') || '');
    var storedImageKey = await decrypt(localStorage.getItem('imageApiKey') || '');
    var cleanImageKey = (storedImageKey && storedImageKey !== 'not-needed') ? storedImageKey : '';
    setVal('imageApiKey', cleanImageKey || '');
    // ★ 图像模型恢复: 优先用提供商独立键,回退到通用 imageModel 键
    var _imgProvInit4Model = localStorage.getItem('imageProvider') || DEFAULT_CONFIG.imageProvider || 'minimax';
    setVal('imageModel', localStorage.getItem('imageModel_' + _imgProvInit4Model) || localStorage.getItem('imageModel') || DEFAULT_CONFIG.imageModel || '');
    setVal('imageBaseUrl', localStorage.getItem('imageBaseUrl') || DEFAULT_CONFIG.imageBaseUrl || '');
    var storedOrKey_Final = await decrypt(localStorage.getItem('imageApiKeyOpenrouter') || '');
    var cleanOrKey_Final = (storedOrKey_Final && storedOrKey_Final !== 'not-needed') ? storedOrKey_Final : '';
    setVal('imageApiKeyOpenrouter', cleanOrKey_Final || '');
    setVal('imageBaseUrlOpenrouter', localStorage.getItem('imageBaseUrlOpenrouter') || 'https://openrouter.ai/api');
    // ★ OpenAI / 自定义 图像字段恢复
    var storedOaiKey_Final = await decrypt(localStorage.getItem('imageApiKeyOpenai') || '');
    var cleanOaiKey_Final = (storedOaiKey_Final && storedOaiKey_Final !== 'not-needed') ? storedOaiKey_Final : '';
    setVal('imageApiKeyOpenai', cleanOaiKey_Final || '');
    setVal('imageBaseUrlOpenai', localStorage.getItem('imageBaseUrlOpenai') || 'https://api.openai.com/v1');
    var storedCustomKey_Final = await decrypt(localStorage.getItem('imageApiKeyCustom') || '');
    var cleanCustomKey_Final = (storedCustomKey_Final && storedCustomKey_Final !== 'not-needed') ? storedCustomKey_Final : '';
    setVal('imageApiKeyCustom', cleanCustomKey_Final || '');
    setVal('imageBaseUrlCustom', localStorage.getItem('imageBaseUrlCustom') || '');
    setVal('imageProvider', localStorage.getItem('imageProvider') || DEFAULT_CONFIG.imageProvider || 'minimax');
    // ★ 根据当前视觉提供商切换字段可见性(刷新后恢复正确的字段显示)
    var _visProvInit = localStorage.getItem('visionProvider') || 'minimax';
    var _visFields = { minimax: ['visionKeyField', 'visionUrlField'], openai: ['visionOAKeyField', 'visionOAUrlField'], xai: ['visionXAIKeyField', 'visionXAIUrlField'], custom: ['visionCustomKeyField', 'visionCustomUrlField'] };
    Object.keys(_visFields).forEach(function(_vk) {
        _visFields[_vk].forEach(function(_fid) {
            var _el = getEl(_fid);
            if (_el) _el.style.display = _vk === _visProvInit ? '' : 'none';
        });
    });
    // ★ 搜索配置必须早于 toggleImageProviderFields(因为后者会触发 saveConfig)
    createSearchConfigSection();
    bindSearchEvents();
    await loadSearchConfig();
    createSearchToggleButton();
    await toggleImageProviderFields();
    setVal('systemPrompt', localStorage.getItem('systemPrompt') || DEFAULT_CONFIG.system);
    setVal('customParams', localStorage.getItem('customParams') || DEFAULT_CONFIG.customParams);
    setChecked('customParamsToggle', localStorage.getItem('customEnabled') === 'true');

    var temp = localStorage.getItem('temp') || '0.7';
    setVal('temperature', temp);
    var tempSpan = getEl('tempValue');
    if (tempSpan) tempSpan.innerText = temp;

    // ★ 完全按用户配置,不匹配模型，但上限跟随模型能力
    var _curModel2 = getVal('modelSelect') || '';
    var _modelMax2 = window._getModelMaxTokens ? window._getModelMaxTokens(_curModel2) : 200000;
    var _slider2 = getEl('maxTokens');
    var _input2 = getEl('maxTokensInput');
    if (_slider2) _slider2.max = _modelMax2;
    if (_input2) _input2.max = _modelMax2;
    // 如果保存的 token 值超过模型上限，自动修正
    var _savedTokens = parseInt(localStorage.getItem('tokens')) || parseInt(localStorage.getItem('maxTokens')) || 4096;
    if (_savedTokens > _modelMax2) _savedTokens = _modelMax2;
    if (_savedTokens < 256) _savedTokens = 256;
    setVal('maxTokens', _savedTokens);
    setVal('maxTokensInput', _savedTokens);
    localStorage.setItem('tokens', String(_savedTokens));

    setChecked('streamToggle', localStorage.getItem('stream') !== 'false');
    setVal('requestTimeout', localStorage.getItem('requestTimeout') || DEFAULT_CONFIG.requestTimeout);
    setChecked('compressToggle', localStorage.getItem('compress') === 'true');
    setVal('compressThreshold', localStorage.getItem('threshold') || '10');
    // ★ compressModel: 手动可选 + 默认自动
    var compressSel = getEl('compressModel');
    if (compressSel) {
        compressSel.disabled = false;
        var _savedCm = localStorage.getItem('compressModel') || 'auto';
        compressSel.innerHTML = '<option value="auto">自动选择</option>' +
            '<option value="deepseek-chat">deepseek-chat</option>' +
            '<option value="deepseek-v4-flash">deepseek-v4-flash</option>';
        compressSel.value = _savedCm;
    }

    var lh = parseFloat(localStorage.getItem('lineHeight') || DEFAULT_CONFIG.lineHeight);
    setVal('lineHeight', lh);
    var lhSpan = getEl('lineHeightValue');
    if (lhSpan) lhSpan.innerText = lh.toFixed(2);
    document.documentElement.style.setProperty('--chat-line-height', lh);
    document.body.style.setProperty('--chat-line-height', lh);
    if ($.chatMessagesContainer) {
        $.chatMessagesContainer.style.setProperty('--chat-line-height', lh);
        var applyReadingLineHeight = function(root) {
            var nodes = [];
            var isAssistantNode = function(el) {
                if (!el || !el.closest) return false;
                return !!el.closest('.message-row.assistant');
            };
            var sel = '.message-row.assistant .markdown-body, .message-row.assistant .markdown-body p, .message-row.assistant .markdown-body li, .message-row.assistant .markdown-body blockquote, .message-row.assistant .md-stable, .message-row.assistant .md-tail';
            if (root && root.matches) {
                if (root.matches(sel) || (root.matches('.markdown-body, p, li, blockquote, .md-stable, .md-tail') && isAssistantNode(root))) {
                    nodes.push(root);
                }
            }
            if (root && root.querySelectorAll) {
                nodes = nodes.concat(Array.from(root.querySelectorAll(sel)));
            }
            nodes.forEach(function(node) { node.style.setProperty('line-height', String(localStorage.getItem('lineHeight') || lh), 'important'); });
        };
        applyReadingLineHeight($.chatMessagesContainer);
        if (!window.__readingLineHeightObserver) {
            window.__readingLineHeightObserver = new MutationObserver(function(records) {
                records.forEach(function(record) { record.addedNodes.forEach(function(node) { if (node.nodeType === 1) applyReadingLineHeight(node); }); });
            });
            window.__readingLineHeightObserver.observe($.chatMessagesContainer, { childList: true, subtree: true });
        }
    }

    var pm = parseFloat(localStorage.getItem('paragraphMargin') || DEFAULT_CONFIG.paragraphMargin);
    setVal('paragraphMargin', pm);
    var pmSpan = getEl('paragraphMarginValue');
    if (pmSpan) pmSpan.innerText = pm.toFixed(2);
    document.documentElement.style.setProperty('--chat-paragraph-margin', pm + 'rem');

    var bg = parseFloat(localStorage.getItem('bubbleGap') || DEFAULT_CONFIG.bubbleGap);
    setVal('bubbleGap', bg);
    var bgSpan = getEl('bubbleGapValue');
    if (bgSpan) bgSpan.innerText = bg.toFixed(2);
    document.documentElement.style.setProperty('--chat-bubble-gap', bg + 'rem');
    setChecked('markdownGFM', localStorage.getItem('markdownGFM') !== 'false');
    setChecked('markdownBreaks', localStorage.getItem('markdownBreaks') !== 'false');
    // ★ 子代理会话显示开关（默认隐藏）— 右侧配置栏
    var _showSubAgent = localStorage.getItem('showSubAgentSessions') === 'true';
    var _subToggle = getEl('showSubAgentSessions_config');
    if (_subToggle) {
        _subToggle.checked = _showSubAgent;
        // ★ 使用 addEventListener 避免被其他代码覆盖 onchange 属性
        _subToggle.addEventListener('change', function() {
            localStorage.setItem('showSubAgentSessions', this.checked ? 'true' : 'false');
            if (typeof renderChatHistory === 'function') renderChatHistory();
        });
    }
    setChecked('toolCardToggle', localStorage.getItem('toolCards') !== '0');
    setChecked('anthropicFormatToggle', localStorage.getItem('useAnthropicFormat') === '1');
    var savedTheme = localStorage.getItem('chatThemeStyle') || 'dsh';
    setVal('chatThemeStyle', savedTheme);
    applyChatTheme(savedTheme);
    // ★ 隐藏推理过程: 恢复持久化状态
    if (typeof window.isHideReasoning === 'function' && window.isHideReasoning()) {
        document.body.classList.add('hide-reasoning');
        setChecked('hideReasoningToggle', true);
    }
    if (window.marked) {
        marked.setOptions({ gfm: getChecked('markdownGFM'), breaks: getChecked('markdownBreaks'), pedantic: false, sanitize: false });
        // 不再使用自定义 paragraph renderer(marked v15 默认已正确处理,自定义 renderer 会导致 [object Object])
    }

    // 只同步持久化主题；初始化/取消配置都不应反转当前主题。
    toggleDarkMode(true);

    createTitleModelSelector();
    initFontSize();
    if (window.initToolModeBtn) initToolModeBtn();
    // Agent 模式初始化
    await initAgentConfig();
    updateAgentUI();
    // ★ 思考强度分级初始化 (迁移旧配置 + 回填 + 显隐)
    if (typeof _migrateThinkingIntensity === 'function') _migrateThinkingIntensity();
    var _tiVal = localStorage.getItem('thinkingIntensity') || 'medium';
    var _tiEl = getEl('thinkingIntensity');
    if (_tiEl) _tiEl.value = _tiVal;
    if (typeof _updateThinkingIntensityVisibility === 'function') _updateThinkingIntensityVisibility();
    // modelSelect 变化时更新思考强度栏可见性并可靠双向同步当前提供商模型
    var _ms = getEl('modelSelect');
    if (_ms && !_ms._globalModelSelectBound) {
        _ms._globalModelSelectBound = true;
        _ms.addEventListener('change', function () {
            var val = this.value;
            var curP = (typeof getEl === 'function' && getEl('baseUrlProvider')?.value) || localStorage.getItem('baseUrlProvider') || 'custom';
            if (val && !/^(加载中|请输入|获取失败|loading)/i.test(val)) {
                localStorage.setItem('model', val);
                localStorage.setItem('model_' + curP, val);
                localStorage.setItem('_modelSelectionSavedAt', String(Date.now()));
                console.log('[modelSelect change] provider:', curP, '-> model:', val);
                if (typeof saveConfigToServer === 'function') {
                    saveConfigToServer().then(function() {
                        if (typeof window._broadcastEvent === 'function') {
                            window._broadcastEvent('config:changed', { ts: Date.now(), model: val, provider: curP });
                        }
                    }).catch(function(){});
                }
            }
            if (typeof _updateThinkingIntensityVisibility === 'function') _updateThinkingIntensityVisibility();
            if (typeof window._syncAgentModelCapsule === 'function') window._syncAgentModelCapsule();
        });
    }
    // baseUrlProvider 变化时也检查
    var _bp = getEl('baseUrlProvider');
    if (_bp && !_bp._thinkingBound) {
        _bp._thinkingBound = true;
        _bp.addEventListener('change', function () {
            if (typeof _updateThinkingIntensityVisibility === 'function') _updateThinkingIntensityVisibility();
        });
    }
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
            var header = document.querySelector('header');
            var left = header?.querySelector('.flex.items-center.gap-4');
            var right = header?.querySelector('.flex.items-center.gap-3');
            if (left && right) {
                var title = document.createElement('div');
                title.id = 'chatTitle';
                title.className = 'chat-title';
                title.textContent = '新对话';
                header.insertBefore(title, right);
                $.chatTitle = title;
            }
        }
    }
    if (typeof window._syncChatTitlePlacement === 'function') {
        window._syncChatTitlePlacement(isMobile());
    }

    // 移动端配置输入框聚焦时自动展开面板
    if (isMobile()) {
        var configInputs = $.configPanel?.querySelectorAll('input, textarea, select');
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

async function initAgentConfig() {
    var mode = getAgentMode();
    var isActive = mode === 'agent' || mode === 'yolo';
    setChecked('agentModeToggle', isActive);
    setChecked('agentAutoDecision', localStorage.getItem('agentAutoDecision') !== 'false');
    setChecked('agentProactive', localStorage.getItem('agentProactive') === 'true');
    setVal('agentMaxToolRounds', localStorage.getItem('agentMaxToolRounds') || '30');
    setVal('agentSystemPrompt', localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt);
    // ★ 死循环检测配置回填
    setChecked('loopGuardToggle', localStorage.getItem('loopGuardEnabled') !== 'false');
    setVal('loopGuardMaxRepeat', localStorage.getItem('loopGuardMaxRepeat') || '3');
    setVal('loopGuardMaxToolOnlyRounds', localStorage.getItem('loopGuardMaxToolOnlyRounds') || '6');
    setVal('ttsProvider', localStorage.getItem('ttsProvider') || 'minimax');
    var _ttsKey = ''; try { _ttsKey = await decrypt(localStorage.getItem('ttsApiKey')||''); } catch(e) {} setVal('ttsApiKey', _ttsKey || '');
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
    // Agent 权限胶囊也要在刷新/切换后按持久化值回填，不能依赖默认 Full access。
    if (typeof window._updatePermissionUI === 'function' && typeof window.getWorkspacePermission === 'function') {
        window._updatePermissionUI(window.getWorkspacePermission());
    }
    // 更新三模式选择器
    if (typeof updateModeSelector === 'function') {
        updateModeSelector(mode);
    } else if (typeof window.updateModeSelector === 'function') {
        window.updateModeSelector(mode);
    }
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
    if (!window.__shellEscapeBound) {
        window.__shellEscapeBound = true;
        document.addEventListener('keydown', function(e) {
            if (e.key !== 'Escape') return;
            var auth = getEl('authOverlay');
            if (auth && !auth.classList.contains('hidden')) return;
            if ($.sidebar?.classList.contains('mobile-open') || $.configPanel?.classList.contains('mobile-open')) {
                e.preventDefault();
                window.closeAllSidebars();
            }
        });
    }
    // ★ 队列浮窗:点击外部区域折叠
    document.addEventListener('click', window._handleQueueDocClick);

    if ($.chatBox) {
        // ★ 滚动跟随判定统一走 scroll-follow.js 的 handleChatScroll
        // (程序滚动三重防误判 + 滚回底部自动重新吸附)
        $.chatBox.addEventListener('scroll', throttle(() => {
            window.handleChatScroll($.chatBox);
        }, 50));
        // ★ 初始化滚动跟随: 触摸暂停 + ResizeObserver 兜底
        if (typeof window.initScrollFollow === 'function') window.initScrollFollow();
    }

    var wrapper = document.querySelector('.input-wrapper');
    var drop = getEl('dropOverlayInput');
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

    // ★ 文件夹上传输入
    var folderInput = document.getElementById('folderInput');
    if (folderInput) {
        folderInput.addEventListener('change', async e => {
            if (e.target.files.length) {
                showToast('📁 已选择 ' + e.target.files.length + ' 个文件 (文件夹上传)', 'info', 3000);
                await processSelectedFiles(e.target.files);
            }
            e.target.value = '';
        });
    }

    // 图片输入已移除,只保留文件输入

    if ($.userInput) {
        var _syncComposerState = function() {
            var compact = window.innerWidth <= MOBILE_BREAKPOINT;
            $.userInput.placeholder = compact ? '输入消息…' : '输入消息，键入 / 使用命令，@ 提及代理';
            document.querySelector('.input-wrapper')?.classList.toggle('composer-has-value', !!$.userInput.value.trim());
        };
        _syncComposerState();
        $.userInput.addEventListener('keydown', e => {
            var _p = getEl('slashPopup');
            var _vis = _p && window._slashVisible;
            var _mp = getEl('mentionPopup');
            var _mvis = _mp && window._mentionVisible;
            // ★ @ 提及导航
            if (e.key === 'ArrowDown' && _mvis) { e.preventDefault(); navigateMentionPopup(1); return; }
            if (e.key === 'ArrowUp' && _mvis) { e.preventDefault(); navigateMentionPopup(-1); return; }
            if (e.key === 'Escape' && _mvis) { e.preventDefault(); hideMentionPopup(); return; }
            if (e.key === 'Enter' && !e.shiftKey && _mvis) {
                e.preventDefault();
                var _msel = _mp.querySelector('.slash-item-highlight');
                if (_msel) { selectMentionCommand(_msel.dataset.type, _msel.dataset.cmd, parseInt(_msel.dataset.index || '-1', 10)); }
                return;
            }
            if (e.key === 'ArrowDown' && _vis) { e.preventDefault(); navigateSlashPopup(1); return; }
            if (e.key === 'ArrowUp' && _vis) { e.preventDefault(); navigateSlashPopup(-1); return; }
            if (e.key === 'Escape' && _vis) { e.preventDefault(); hideSlashPopup(); return; }
            if (e.key === 'Enter' && !e.shiftKey) {
                // ★ 中文输入法(IME)组合期间 Enter 用于确认候选词, 禁止触发发送
                if (e.isComposing || e.keyCode === 229) return;
                if (_vis) {
                    e.preventDefault();
                    var _sel = _p.querySelector('.slash-item-highlight');
                    if (_sel) { selectSlashCommand(_sel.dataset.cmd, _sel.dataset.args); }
                    return;
                }
                e.preventDefault();
                if (typeof window._smartSend === 'function') {
                    window._smartSend();
                } else {
                    sendMessage();
                }
            }
        });
        window.autoResize($.userInput);
        $.userInput.addEventListener('input', function () { _syncComposerState(); window.autoResize(this); try { handleSlashInput(this); } catch(e) { console.error('[Slash] error:', e); } try { handleMentionInput(this); } catch(e) { console.error('[Mention] error:', e); } });
        window.addEventListener('resize', debounce(() => { _syncComposerState(); window.autoResize($.userInput); }, 100));
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
                var _sresult = await loadChatsFromServer();
                // ★ loadChatsFromServer 返回 {chats, deleted}, 取 chats 部分
                var _schats = (_sresult && _sresult.chats) ? _sresult.chats : _sresult;
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

    // ★ 清理并销毁废弃子代理会话，禁止其进入侧边栏
    (function _purgeSubAgentChats() {
        try {
            var _keysToRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var _k = localStorage.key(i);
                if (_k && (_k.indexOf('agent_chat_') === 0 || _k.indexOf('_agent_sub_') === 0)) {
                    _keysToRemove.push(_k);
                }
            }
            _keysToRemove.forEach(function(k) {
                try { localStorage.removeItem(k); } catch(e) {}
            });
            // 从当前内存 chats 中彻底剔除任何 _agent_sub_
            var _changed = false;
            Object.keys(chats).forEach(function(cid) {
                if (cid.indexOf('_agent_sub_') === 0 || cid.indexOf('_sub_') === 0) {
                    delete chats[cid];
                    _changed = true;
                }
            });
            if (_changed) {
                try { slimSaveChats(); } catch(e) {}
            }
        } catch(e) {}
    })();

    // ★ 如果 Agent 模式激活,切换到 agent 独立聊天
    if (isAgentToolsActive()) {
        // 已在 setAgentMode/restoreUserData 中创建了 agent 聊天,直接加载
        if (currentChatId && isAgentChat(currentChatId)) {
            loadChat(currentChatId);
            $.sidebar?.classList.add('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'inline-flex';
            renderChatHistory();
        } else if (chats['_agent_main']) {
            // ★ 主会话存在但当前聊天不在 Agent 域 → 回到主会话
            //   (切勿调 createAgentChat: 它会无条件覆盖 _agent_main,毁掉当前会话)
            loadChat('_agent_main');
            $.sidebar?.classList.add('collapsed');
            if ($.sidebarToggle) $.sidebarToggle.style.display = 'inline-flex';
            renderChatHistory();
        } else {
            // 兜底: Agent 模式激活但没有 agent 主会话(刷新场景) → 创建
            createAgentChat([]).then(function(agentId) {
                loadChat(agentId);
                $.sidebar?.classList.add('collapsed');
                if ($.sidebarToggle) $.sidebarToggle.style.display = 'inline-flex';
                renderChatHistory();
            });
        }
    } else {
        // ★ 普通模式: 当前聊天已由 restoreUserData 按域恢复,仅当缺失或不在普通域时兜底
        if (!currentChatId || !chats[currentChatId] || isAgentChat(currentChatId)) {
            var last = localStorage.getItem('lastChatId');
            if (last && chats[last] && !isAgentChat(last)) {
                loadChat(last);
            } else {
                // ★ 优先复用已有的空新对话,避免登录后反复创建
                var emptyChatId = null;
                for (var _cid in chats) {
                    if (isAgentChat(_cid)) continue;
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
        }
        renderChatHistory();
    }

    prevWidth = window.innerWidth;
    // 初始化配置面板状态
    if (isMobile()) {
        $.sidebar?.classList.remove('mobile-open');
        $.configPanel?.classList.remove('mobile-open');
        $.configPanel?.classList.add('hidden-panel');
        $.sidebarMask?.classList.remove('active');
        $.sidebar && ($.sidebar.inert = true);
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'inline-flex';
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
    if (typeof window._syncConfigShellState === 'function') window._syncConfigShellState(false);
    // ★ 硬刷新确保侧边栏状态正确
    updateAgentUI();
}

async function loadAllResources() {
    // ★ mermaid 已通过 index.html <script defer> 加载，此处不再重复加载
    var resources = [
        { type: 'script', src: 'lib/marked.min.js' },
        { type: 'script', src: 'lib/highlight.min.js' },
        { type: 'script', src: 'lib/mammoth.browser.min.js' },
        { type: 'script', src: 'lib/xlsx.full.min.js' },
        { type: 'style', href: 'lib/atom-one-light.min.css', id: 'hljsTheme' }
    ];
    try {
        await Promise.all(resources.map(r => r.type === 'script' ? loadScript(r.src) : loadStyle(r.href, r.id)));
        // ★ mermaid 已通过 index.html 的 <script defer> 加载，此处只做初始化
        if (window.mermaid) {
            console.log('[Init] mermaid 已就绪，初始化...');
            mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose', suppressErrorRendering: true, maxEdges: 10000, maxTextSize: 100000 });
            setTimeout(function _renderPendingMermaid() {
                document.querySelectorAll('.markdown-body').forEach(function(el) {
                    MarkdownRenderer.renderMermaid(el);
                });
            }, 100);
        } else {
            console.error('[Init] mermaid 仍未加载！index.html 的 defer script 可能被阻止');
        }
    } catch (err) {
        console.warn('部分资源加载失败', err);
        if (localStorage.getItem('authToken')) showToast('部分资源加载失败', 'error');
    }
    initializeApp();
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        var s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

function loadStyle(href, id) {
    return new Promise((resolve, reject) => {
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        if (id) l.id = id;
        l.onload = resolve;
        l.onerror = reject;
        document.head.appendChild(l);
    });
}

function initializeApp() {
    // ★ 加载进度指示
    function _loaderProgress(pct, hint) {
        var bar = document.getElementById('loader-bar');
        var hintEl = document.getElementById('loader-hint');
        if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
        if (hintEl && hint) hintEl.textContent = hint;
    }
    function _hideLoader() {
        var el = document.getElementById('app-loader');
        if (el) { el.classList.add('hidden'); setTimeout(function(){ el && el.remove(); }, 500); }
    }

    // ★ 始终等待 DOMContentLoaded（确保 main.js 等所有模块加载完毕）
    if (document.readyState === 'complete') { init(); }
    else { document.addEventListener('DOMContentLoaded', init); }

    async function init() {
        try {
        // ★ 核心防御：页面初始化第一步彻底清理历史遗留的队列和过期运行态脏缓存，杜绝老设备冷启动自发消息与串会话！
        (function _purgeStaleTransientStorage() {
            try {
                var toRemove = [];
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (!k) continue;
                    // 1. 冷启动清理所有持久化队列 (队列仅对在线交互单次生命周期有效)
                    if (k.indexOf('oc_queue_') === 0 || k.indexOf('queued_message_') === 0) {
                        toRemove.push(k);
                    }
                    // 2. 清理遗留的 ws 流标记
                    if (k.indexOf('_wsStream') === 0) {
                        toRemove.push(k);
                    }
                    // 3. 清理已超时的流停止标记
                    if (k.indexOf('_streamStopped_') === 0) {
                        toRemove.push(k);
                    }
                }
                toRemove.forEach(function(k) {
                    try { localStorage.removeItem(k); } catch(e) {}
                });
                try { sessionStorage.removeItem('_messageQueue'); } catch(e) {}
                if (toRemove.length > 0) {
                    console.log('[Init] 已清理 ' + toRemove.length + ' 个历史脏缓存运行态键');
                }
            } catch(e) {}
        })();

        _loaderProgress(15, '正在初始化界面...');
        cacheDOMElements();
        injectStyles();
        _loaderProgress(25, '正在检查登录状态...');
        // ★ 恢复 ask_agent 临时授权状态(刷新不丢失指示灯)
        if (sessionStorage.getItem('_tempAgentGranted') === '1') {
            var _savedChatId = sessionStorage.getItem('_tempAgentChatId') || null;
            window._tempAgentGranted = true;
            window._tempAgentChatId = _savedChatId;
            var _grantId = sessionStorage.getItem('_fullFileAccessGrantId') || '';
            var _grantChat = sessionStorage.getItem('_fullFileAccessChatId') || '';
            var _grantExpires = Number(sessionStorage.getItem('_fullFileAccessExpiresAt') || 0);
            if (_grantId && _grantChat === _savedChatId && _grantExpires > Math.floor(Date.now() / 1000)) {
                window._fullFileAccessGrantId = _grantId;
                window._fullFileAccessChatId = _grantChat;
                window._fullFileAccessExpiresAt = _grantExpires;
            }
            // ★ 延迟恢复 banner: 等 loadChat 设置 currentChatId 后再判断
            // (loadChat 中会检查匹配并显示/隐藏 banner)
        }
        // ★ 尽早从服务端加载加密密钥(在 initializeConfig 解密之前)
        if (typeof _loadEncryptionKeyFromServer === 'function') await _loadEncryptionKeyFromServer();
        if (typeof setupKeyboardDetection === 'function') setupKeyboardDetection();
        if (typeof setupPasteImageSupport === 'function') setupPasteImageSupport();

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
                    var _ts = Date.now();
                    var resp = await fetch('/oneapichat/api/auth.php?action=verify&_=' + _ts, {
                        headers: getSessionAuthHeaders(),
                        cache: 'no-store'
                    });
                    if (!resp.ok) {
                        // ★ 429 限流或网络错误: 重试一次
                        await new Promise(function(r) { setTimeout(r, 2000); });
                        resp = await fetch('/oneapichat/api/auth.php?action=verify&_=' + Date.now(), {
                            headers: getSessionAuthHeaders(),
                            cache: 'no-store'
                        });
                    }
                    var data = await resp.json();
                    if (!data.valid) {
                        localStorage.removeItem('authToken');
                        localStorage.removeItem('authUsername');
                        localStorage.removeItem('authUserId');
                        if (typeof showAuthOverlay === 'function') showAuthOverlay();
                    } else {
                        // ★ 从 verify 响应同步登录状态到 localStorage（修复 authUsername 丢失导致 UI 显示未登录）
                        if (data.username) localStorage.setItem('authUsername', data.username);
                        if (data.user_id) localStorage.setItem('authUserId', data.user_id);
                        if (data.role) localStorage.setItem('authRole', data.role);
                        if (typeof updateAuthHeaderBtn === 'function') updateAuthHeaderBtn();
                        if (typeof window._loadCloudMemories === 'function') window._loadCloudMemories();
                        if (typeof window._loadCloudIdentity === 'function') window._loadCloudIdentity();
                        // ★ v2: 刷新统一记忆上下文 + 恢复人格选择
                        if (typeof window.refreshMemoryContext === 'function') window.refreshMemoryContext();
                        if (typeof window.restorePersonalityPreset === 'function') window.restorePersonalityPreset();
                        setTimeout(function() {
                            if (typeof window._autoAskIdentity === 'function') window._autoAskIdentity();
                        }, 3000);
                    }
                } catch(e) {
                    // ★ 网络异常/502 HTML: 延迟重试，先检查响应是否为JSON
                    console.warn('[Auth] 验证token失败,2s后重试:', e.message);
                    setTimeout(function() {
                        fetch('/oneapichat/api/auth.php?action=verify', {
                            headers: getSessionAuthHeaders(),
                            cache: 'no-store'
                        })
                            .then(function(r2) {
                                if (!r2.ok) throw new Error('HTTP ' + r2.status);
                                return r2.json();
                            })
                            .then(function(d2) {
                                if (!d2.valid) {
                                    localStorage.removeItem('authToken');
                                    showAuthOverlay && showAuthOverlay();
                                } else {
                                    if (d2.username) localStorage.setItem('authUsername', d2.username);
                                    if (d2.user_id) localStorage.setItem('authUserId', d2.user_id);
                                    if (d2.role) localStorage.setItem('authRole', d2.role);
                                    if (typeof updateAuthHeaderBtn === 'function') updateAuthHeaderBtn();
                                }
                            }).catch(function() {});
                    }, 2000);
                }
            })();
        }

        populateProviderSelect();  // ★ 动态生成提供商下拉(从 API_PROVIDERS)
        await initializeConfig();
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

        _loaderProgress(60, '正在同步数据...');
        // ★ 从服务器恢复当前账号的配置和聊天记录(登录用户专用)
        await restoreUserData();
        _loaderProgress(90, '正在准备界面...');

        // ★ 预加载技能列表
        if (typeof window.loadSkills === 'function') {
            window.loadSkills().catch(function() {});
        }

        // ★ 预加载并自动连接 MCP 服务器 (秒级缓存预热 + 后台并发静默自愈连接)
        if (typeof window.initMcpServers === 'function') {
            window.initMcpServers().catch(function(e) {
                console.warn('[Init] initMcpServers 异常:', e.message);
            });
        }

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
            // ★ 保留有图片/推理/工具调用的消息 (如 GPT Image 模型 content 为 null)
            Object.keys(chats).forEach(id => {
                if (chats[id].messages) {
                    chats[id].messages = chats[id].messages.filter(m => {
                        if (m.role === 'assistant' && (!m.content || m.content.trim() === '')) {
                            if (m.generatedImages && m.generatedImages.length > 0) return true;
                            if (m.generatedImage) return true;
                            if (m.reasoning) return true;
                            if (m.tool_calls && m.tool_calls.length > 0) return true;
                            return false;
                        }
                        return true;
                    });
                }
            });
            localStorage.setItem('chats', JSON.stringify(chats));
        } catch(e) {}

        try { loadInitialData(); } catch(e) { console.error('[Init] loadInitialData 失败:', e.message); }
        try { initRAGPanel(); } catch(e) {}
        // ★ 界面就绪 → 平滑隐藏加载动画
        _loaderProgress(100, '就绪');
        setTimeout(_hideLoader, 200);

        // ★ 执行孤立的 tool_calls (assistant有tool_calls但刷新时工具未执行)
        // 找出最后一个有tool_calls的assistant,执行缺结果的工具,追加到历史
        async function _executeOrphanedToolCalls(chatId, asstIdx) {
            var msgs = chats[chatId] && chats[chatId].messages;
            if (!msgs || asstIdx < 0 || asstIdx >= msgs.length) return;
            var asst = msgs[asstIdx];
            if (asst.role !== 'assistant' || !asst.tool_calls || !asst.tool_calls.length) return;
            // 收集已有结果的 tool_call_id
            var _haveResult = {};
            for (var _ri = asstIdx + 1; _ri < msgs.length; _ri++) {
                if (msgs[_ri].role === 'tool' && msgs[_ri].tool_call_id) _haveResult[msgs[_ri].tool_call_id] = true;
            }
            // 找出缺结果的工具调用
            var _missing = asst.tool_calls.filter(function(tc){ return tc && tc.id && !_haveResult[tc.id]; });
            if (!_missing.length) return;
            if (!window.executeToolCallForRetry) { console.warn('[AutoRecover] executeToolCallForRetry 未加载'); return; }
            console.log('[AutoRecover] Phase 3: 执行 ' + _missing.length + ' 个孤立工具调用');
            var _pm = { role: 'assistant', content: asst.content || '', reasoning: asst.reasoning || '', tool_calls: asst.tool_calls };
            var _body = { messages: [] };
            for (var _mi = 0; _mi < _missing.length; _mi++) {
                var tc = _missing[_mi];
                var toolRes = { error: null, result: null };
                try {
                    toolRes = await window.executeToolCallForRetry(tc, null, {
                        body: _body, pendingMsg: _pm, chatId: chatId,
                        currentChatId: currentChatId, activeBubbleMap: activeBubbleMap, chats: chats
                    }) || { error: null, result: null };
                } catch(_te) { toolRes = { error: String(_te.message || _te), result: null }; }
                var contentStr = toolRes.error || toolRes.result || '(empty)';
                contentStr = typeof contentStr === 'string' ? contentStr : JSON.stringify(contentStr);
                chats[chatId].messages.push({ role: 'tool', tool_call_id: tc.id || '', content: contentStr, _toolResult: true });
            }
            try { localStorage.removeItem('_savedPartial'); } catch(e) {}
            slimSaveChats();
            saveChats();
        }

        // ★ 自动续生: 优先从引擎恢复活跃流, 回退到 _savedPartial 再生
        try {
            (async function _autoRecover() {
                // ★ Phase 1: 先尝试从引擎恢复活跃任务（无感断点续传）
                if (window._recoverActiveTasks) {
                    try {
                        await window._recoverActiveTasks();
                        // 短暂等待恢复完成
                        await new Promise(function(r) { setTimeout(r, 1500); });
                    } catch(e) { console.warn('[AutoRecover] Engine recovery error:', e.message); }
                }
                // ★ Phase 3: 检测未完成的工具调用交互(刷新中断工具链)
                // 最后一条是tool_result或assistant有tool_calls但无后续响应→自动续接
                if (!window._backendRecovered && currentChatId && chats[currentChatId] && chats[currentChatId].messages) {
                    var _tmsgs = chats[currentChatId].messages;
                    var _lastToolIdx = -1, _lastAsstIdx = -1, _lastUserIdx = -1;
                    for (var _ti = _tmsgs.length - 1; _ti >= 0; _ti--) {
                        if (_tmsgs[_ti].role === 'tool' && _lastToolIdx === -1) _lastToolIdx = _ti;
                        if (_tmsgs[_ti].role === 'assistant' && _lastAsstIdx === -1) _lastAsstIdx = _ti;
                        if (_tmsgs[_ti].role === 'user' && !_tmsgs[_ti]._internal && _lastUserIdx === -1) _lastUserIdx = _ti;
                    }
                    // 工具结果在最后(无assistant响应) 或 assistant有tool_calls等待处理
                    var _needsContinue = false;
                    var _orphanedAsstIdx = -1;
                    if (_lastToolIdx > _lastAsstIdx && _lastToolIdx > _lastUserIdx) {
                        _needsContinue = true;  // 工具结果未被处理
                    } else if (_lastAsstIdx > _lastUserIdx && _tmsgs[_lastAsstIdx].tool_calls && _tmsgs[_lastAsstIdx].tool_calls.length > 0) {
                        // assistant有tool_calls但工具还未执行→需要先执行工具再续接
                        _needsContinue = true;
                        _orphanedAsstIdx = _lastAsstIdx;
                    }
                    if (_needsContinue) {
                        var _age2 = Date.now() - (chats[currentChatId].updated_at || 0);
                        if (_age2 < 300000) {  // 5分钟内
                            // 历史形状不足以证明后台仍在运行。过去这里会自动执行工具或
                            // 重发最后一条用户请求，导致刷新即“接续”、重复调用和重复扣费。
                            // 真正活跃的请求只由上面的 Engine active_tasks 恢复。
                            console.log('[AutoRecover] 检测到未完成工具历史，但 Engine 无活跃任务；保留历史，不自动重放');
                        }
                    }
                }

                // Phase 2: 如果引擎恢复成功, 跳过旧的 _pendingRecovery 再生
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
                    // ★ 冷启动不自动盲目重发旧用户消息，避免刷新产生死循环自发消息
                    console.log('[AutoRecover] 冷启动已恢复历史状态，不执行自动重发');
                }, 500);
            })();
        } catch(e) { console.warn('[AutoRecover] 出错:', e.message); }

        // ★ 冷启动不恢复旧队列：队列只服务于当前页面生命周期，避免残留队列在刷新后污染新会话/重复发送。
        try {
            window._messageQueue = [];
            if (typeof window._clearPersistedQueue === 'function') window._clearPersistedQueue(null, true);
            if (typeof window._updateQueueUI === 'function') window._updateQueueUI();
            console.log('[Queue] 冷启动已清理全部持久化队列');
        } catch(e) { console.warn('[Queue] 清理失败:', e); }

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

    // ★ 自动清理过期子代理和内部测试会话（保留最新 10 个且 48 小时内）
    setTimeout(function() {
        if (typeof window.cleanupSubAgentSessions === 'function') {
            window.cleanupSubAgentSessions(48, 10).catch(function() {});
        }
    }, 3000);

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

        // ★ 切账号后自动同步云盘登录（主项目同邮箱同密码 → 云盘，不存在则注册）
        try {
            if (localStorage.getItem('_syncCloudreveAfterLoad')) {
                localStorage.removeItem('_syncCloudreveAfterLoad');
                setTimeout(function() {
                    if (typeof window.syncCloudreveAccount === 'function') window.syncCloudreveAccount(false);
                }, 1500);
            }
        } catch(e) {}

        window.addEventListener('beforeunload', function() {
            // ★ 保存输入框文本,刷新后恢复 (绑定当前会话 + 用户 + 时间戳，防止跨会话/跨用户污染)
            try {
                var _inputEl = getEl('chatInput') || (window.$ && window.$.userInput);
                if (_inputEl && _inputEl.value.trim() && currentChatId) {
                    var _uid = localStorage.getItem('authUserId') || '';
                    localStorage.setItem('_savedInputText', JSON.stringify({
                        text: _inputEl.value.trim(),
                        chatId: currentChatId,
                        userId: _uid,
                        time: Date.now()
                    }));
                }
            } catch(e) {}
            // ★ If _skipUnloadSave is set, skip all saves (login/register/logout transitioning)
            // ★ 必须最先检查,避免 slimSaveChats 在切换账号时将旧数据写入 localStorage
            if (localStorage.getItem('_skipUnloadSave')) {
                localStorage.removeItem('_skipUnloadSave');
                return;
            }
            // ★ 保存当前正在生成的流式消息(刷新后恢复当前聊天，而不是随机取第一个聊天)
            try {
                var __partialIds = [];
                if (currentChatId && chats[currentChatId]) __partialIds.push(currentChatId);
                Object.keys(chats).forEach(function(__fallbackId) {
                    if (__partialIds.indexOf(__fallbackId) === -1) __partialIds.push(__fallbackId);
                });
                for (var __pi = 0; __pi < __partialIds.length; __pi++) {
                    var __cid = __partialIds[__pi];
                    var __msgs = chats[__cid] && chats[__cid].messages || [];
                    for (var __i = __msgs.length - 1; __i >= 0; __i--) {
                        if (__msgs[__i].partial) {
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
                                toolCalls: __msgs[__i].tool_calls || __msgs[__i]._rsToolCalls || [],
                                streamId: __msgs[__i]._rsStreamId || '',
                                msgId: __msgs[__i]._rsMsgId || '',
                                time: Date.now(),
                                userText: __userMsg ? __userMsg.text : '',
                                userFiles: __userMsg ? __userMsg.files : []
                            }));
                            __pi = __partialIds.length;
                            break;
                        }
                    }
                }
            } catch(e) {}
            // ★ 保存消息队列到 sessionStorage(刷新后恢复)
            window._saveQueue();
            slimSaveChats();
            try { localStorage.setItem('lastChatId', currentChatId || ''); } catch(e) {}
            try { sessionStorage.setItem('_oneapiLastChatId', currentChatId || ''); } catch(e) {}
            // ★ 保存聊天记录到服务器(使用 sendBeacon,保证页面关闭时请求送达)
            var token = localStorage.getItem('authToken');
            if (token && chats && Object.keys(chats).length > 0) {
                try { beaconSaveChats(); } catch(e) {}
            }
            // ★ 配置卸载保存只走唯一的 beaconSaveConfig，避免同一页面连续发两份快照并产生乱序覆盖。
            if (token) {
                try { beaconSaveConfig(); } catch(e) {}
            }
        });
        window.addEventListener('pagehide', function() {
            // ★ 切换账号时不保存旧 chats 到 localStorage
            if (localStorage.getItem('_skipUnloadSave')) return;
            window._saveQueue();
            slimSaveChats();
        });

        // ★ 全局图片错误兜底：正文图片交给 attachImageFallbacks 的代理重试/来源页卡片，
        // 禁止再统一 display:none；旧逻辑会抢先隐藏图片，使卡片即使生成也看不到。
        document.addEventListener('error', function(e) {
            if (!e.target || e.target.tagName !== 'IMG') return;
            if (e.target.closest && e.target.closest('.markdown-body')) {
                if (typeof window.attachImageFallbacks === 'function') window.attachImageFallbacks(e.target);
                return;
            }
            e.target.style.display = 'none';
            e.preventDefault();
        }, true);

        // ★ 聊天内图片/图表点击放大 (委托监听): markdown 渲染的图片(含 stock_chart K线图)
        //   与 mermaid SVG 图表统一走灯箱 (之前只有 generatedImages 绑定过灯箱)
        document.addEventListener('click', function(e) {
            var t = e.target;
            if (!t || !t.closest) return;
            try {
                // ── mermaid SVG 图表: 序列化为 data URL 进灯箱 ──
                if (t.closest('.mermaid') && (t.tagName === 'SVG' || t.closest('svg'))) {
                    var _mermaidDiv = t.closest('.mermaid');
                    var _svgEl = _mermaidDiv.querySelector('svg');
                    if (_svgEl && typeof showImageLightbox === 'function') {
                        e.preventDefault();
                        e.stopPropagation();
                        var _svgClone = _svgEl.cloneNode(true);
                        _svgClone.setAttribute('width', Math.max(_svgEl.viewBox.baseVal.width || 800, 800));
                        _svgClone.setAttribute('height', Math.max(_svgEl.viewBox.baseVal.height || 600, 600));
                        _svgClone.style.width = _svgClone.style.height = '';
                        // Mermaid 文本通常位于 foreignObject 中，交给 <img> 的 data URL 在部分浏览器会变成空白；
                        // 传递原始 SVG，让灯箱直接挂载 SVG DOM，确保图表和文字都可见。
                        _svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                        _svgClone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
                        var _svgData = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(_svgClone.outerHTML);
                        showImageLightbox([{ url: _svgData, __svgMarkup: _svgClone.outerHTML }], 0);
                    }
                    return;
                }
                // ── markdown 正文图片 (K线图/网络图片等): 整组灯箱翻页 ──
                var _mdImg = t.closest ? t.closest('.markdown-body img') : null;
                if (_mdImg) {
                    // 生成图容器自带灯箱绑定, 跳过避免双重打开
                    if (_mdImg.closest('.generated-images-container')) return;
                    // 图片外层是链接(带 <a>)时保持链接行为
                    if (_mdImg.closest('a')) return;
                    var _mdBox = _mdImg.closest('.markdown-body');
                    if (!_mdBox || typeof showImageLightbox !== 'function') return;
                    var _mdImgs = Array.prototype.slice.call(_mdBox.querySelectorAll('img')).filter(function(im) {
                        return im.src && !im.closest('.generated-images-container');
                    });
                    var _idx = _mdImgs.indexOf(_mdImg);
                    if (_idx >= 0 && _mdImgs.length > 0) {
                        e.preventDefault();
                        e.stopPropagation();
                        showImageLightbox(_mdImgs.map(function(im) { return im.src; }), _idx);
                    }
                }
            } catch(_err) { console.warn('[LightboxDelegate]', _err.message); }
        });

        // ★ PWA 独立窗口 (standalone) 链接处理: 聊天里的外链不弹到浏览器/app,
        //   改为当前窗口内打开, 用户可用返回键回到聊天 (iOS/Android 安装后体验一致)
        (function _initStandaloneLinks() {
            var _isStandalone = function() {
                return window.navigator.standalone === true ||
                    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
            };
            document.addEventListener('click', function(e) {
                if (!_isStandalone()) return;
                var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
                if (!a || !a.href) return;
                var href = a.getAttribute('href') || '';
                if (!/^https?:\/\//i.test(href)) return;          // 只拦 http(s) 外链
                if (/^#/.test(href)) return;
                if (a.hasAttribute('download') || a.target === '_self') return;
                var isSameOrigin = false;
                try { isSameOrigin = (new URL(a.href)).origin === location.origin; } catch(err) {}
                if (isSameOrigin) return;                          // 站内链接保持原行为
                e.preventDefault();
                e.stopPropagation();
                location.href = a.href;                            // 当前窗口内打开, 不弹到浏览器/app
            }, true);
        })();
        } catch(e) {
            console.error('[Init] 初始化崩溃:', e.message, e.stack);
            document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><div style="text-align:center;padding:40px;"><h2>⚠️ 加载失败</h2><p style="color:#666;">请尝试清除该账号的聊天记录</p><button onclick="localStorage.clear();location.reload();" style="margin:10px;padding:8px 20px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;">清除本地数据</button></div></div>';
        }
    }
}



// ★ Service Worker: 已禁用 (旧 SW 缓存 PHP 源码导致 API 请求失败)

// ★ 注册初始化 — 等待 DOMContentLoaded 确保 main.js 已加载
initializeApp();
