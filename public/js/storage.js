// storage.js — 数据持久化 v1.0 (Phase 5 拆分自 main.js)
// beaconSave / serverSync / restoreUserData / getDefaultConfig

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
        // ★ 有待删除的聊天时，跳过频率限制（必须立即同步）
        var _hasPendingDeletes = Object.keys(_deletedChatIds).length > 0;
        if (!_hasPendingDeletes && now - _lastServerBackup < SERVER_BACKUP_INTERVAL) return false;
        _lastServerBackup = now;

        var token = localStorage.getItem('authToken');
        if (!token) return false;
        var url = SERVER_API_BASE + '/chat.php';
        url += '?auth_token=' + token;

        // ★ 合并:先读服务器已有数据,再合并本地聊天,防止多窗口覆盖
        // ★ 防丢失:如果本地聊天数过少,视为异常,不强制覆盖服务器
        // ★ Agent 主聊(_agent_main)同步到服务器(含 system prompt,供第三方设备恢复)
        var _localCount = 0;
        var mergedChats = {};
        for (var _cid in chats) {
            // ★ 跳过已标记删除的聊天（防止复活）
            if (_deletedChatIds[_cid]) continue;
            if (_cid === AGENT_CHAT_ID || _cid === '_agent_main') {
                // Agent 主聊:只同步轻量数据(system prompt),不同步消息内容
                mergedChats[_cid] = {
                    title: 'Agent',
                    userId: chats[_cid].userId || '',
                    updated_at: chats[_cid].updated_at || Date.now(),
                    messages: chats[_cid].messages ? [{ role: 'system', content: chats[_cid].messages[0]?.content || '' }] : []
                };
                continue;
            }
            mergedChats[_cid] = JSON.parse(JSON.stringify(chats[_cid]));
            _localCount++;
        }
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
                var resp2 = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config), keepalive: true });
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
            // model 字段写入前额外校验:不接受提示语或过短的值
            if (k === 'model' && _invalidModel(config[k])) {
                console.log('[loadConfigFromServer] 跳过无效 model:', config[k]);
                continue;
            }
            if (config[k] !== null && config[k] !== undefined && k !== 'dark' && k !== 'agentMode') {
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
        var token = localStorage.getItem('authToken') || getCookie('auth_token');
        var deviceId = localStorage.getItem('deviceId');
        if (!token && !deviceId) return null;
        var url = SERVER_API_BASE + '/chat.php?chat_id=all';
        if (token) {
            url += '&auth_token=' + token;
        } else {
            url += '&device_id=' + deviceId;
        }
        var response = await fetch(url);
        if (response.ok) {
            var result = await response.json();
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

    // ★ 安全隔离: 检查本地 chats 是否有不属于当前用户的数据
    //     (修复 bfcache/竞态条件导致切换账号后旧数据残留)
    if (uid) {
        var foreignChatIds = [];
        for (var _cid in chats) {
            var _cUid = chats[_cid].userId;
            // 如果有 userId 标记且不等于当前用户 → 标记为外来数据
            if (_cUid && _cUid !== uid) {
                foreignChatIds.push(_cid);
            }
        }
        if (foreignChatIds.length > 0) {
            console.warn('[restoreUserData] 发现', foreignChatIds.length, '个不属于当前用户的对话,清除:', foreignChatIds);
            for (var _fi = 0; _fi < foreignChatIds.length; _fi++) {
                delete chats[foreignChatIds[_fi]];
            }
            slimSaveChats();
        }
    }

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
                    // ★ 排除 Agent 聊天(但保留 Agent 主聊的 system prompt)
                    var merged = {};
                    for (var _cid2 in chats) {
                        if (_cid2 === AGENT_CHAT_ID || _cid2 === '_agent_main') {
                            // Agent 主聊:只保留 system prompt,不合并到普通聊天
                            if (!merged[_cid2]) {
                                merged[_cid2] = JSON.parse(JSON.stringify(chats[_cid2]));
                            }
                            continue;
                        }
                        merged[_cid2] = JSON.parse(JSON.stringify(chats[_cid2]));
                    }
                    var added = 0;
                    // ★ 跨域名同步: 服务器上不存在的本地聊天 → 从其他域名删除了 → 移除
                    if (_serverChats && Object.keys(_serverChats).length > 0) {
                        for (var _lcid in merged) {
                            if (_lcid === AGENT_CHAT_ID || _lcid === '_agent_main') continue;
                            if (_deletedChatIds && _deletedChatIds[_lcid]) continue;
                            if (!_serverChats[_lcid]) {
                                // 本地有但服务器没有 → 可能在其他域名被删了
                                // ★ 只移除旧的（>5分钟前更新过），保留刚创建的新聊天
                                var _lc = merged[_lcid];
                                var _age = Date.now() - (_lc.updated_at || 0);
                                if (_age > 300000) {
                                    console.log('[restoreUserData] 移除本地残留聊天(服务器已不存在):', _lcid, _lc.title);
                                    delete merged[_lcid];
                                    delete chats[_lcid];
                                }
                            }
                        }
                    }
                    for (var _scid in _serverChats) {
                        if (_scid === AGENT_CHAT_ID || _scid === '_agent_main') {
                            // Agent 主聊:从服务器补充(如果本地没有或本地没有 system)
                            if (!merged[_scid] || !merged[_scid].messages || merged[_scid].messages.length === 0) {
                                merged[_scid] = JSON.parse(JSON.stringify(_serverChats[_scid]));
                            }
                            continue;
                        }
                        if (_deletedChatIds && _deletedChatIds[_scid]) continue; // 跳过已删除
                        var _sc = _serverChats[_scid];
                        if (!merged[_scid]) {
                            merged[_scid] = _sc;
                            added++;
                        } else {
                            var _mc = merged[_scid];
                            // ★ 修复: 服务器有更多消息时,优先保留本地消息的图片数据
                            if (_sc.messages && _mc.messages) {
                                // 如果服务器消息更多,说明有新消息,用服务器数据补充
                                // 但要保留本地消息中的 generatedImages (服务器备份可能丢失图片数据)
                                if (_sc.messages.length > _mc.messages.length) {
                                    // 先保存本地消息中的图片数据
                                    var _localImages = {};
                                    for (var _li = 0; _li < _mc.messages.length; _li++) {
                                        var _lm = _mc.messages[_li];
                                        if (_lm.generatedImages && _lm.generatedImages.length > 0) {
                                            _localImages[_li] = _lm.generatedImages.slice();
                                        }
                                        if (_lm.generatedImage) {
                                            _localImages['_single_' + _li] = _lm.generatedImage;
                                        }
                                    }
                                    // 使用服务器消息
                                    _mc.messages = _sc.messages;
                                    // 恢复本地图片数据到对应位置
                                    for (var _li2 = 0; _li2 < Math.min(_mc.messages.length, Object.keys(_localImages).length); _li2++) {
                                        if (_localImages[_li2]) {
                                            _mc.messages[_li2].generatedImages = _localImages[_li2];
                                        }
                                        if (_localImages['_single_' + _li2]) {
                                            _mc.messages[_li2].generatedImage = _localImages['_single_' + _li2];
                                        }
                                    }
                                } else if (_sc.messages.length === _mc.messages.length) {
                                    // 消息数相同 — 保留本地图片数据,不从服务器覆盖
                                }
                            } else if (_sc.messages && !_mc.messages) {
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
            'grok-3-reasoning', 'grok-3-reasoner',
            // 图像生成模型不支持工具调用
            'gpt-5.4-image', 'gpt-4o-image', 'image-01', 'image-02',
            'dall-e', 'dalle', 'imagen', 'flux', 'midjourney',
            'stable-diffusion', 'stable-diffusion-xl', 'sdxl'
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
    // ★ 恢复 Agent 主聊:即使服务器合并时排除了 _agent_main,也要确保加载前存在
    var _agentMainId = '_agent_main';
    if (!chats[_agentMainId]) {
        // 看看 localStorage 是否有缓存的 agent system prompt (表示之前是 agent 模式)
        var _agentWasActive = localStorage.getItem('agentMode') && localStorage.getItem('agentMode') !== 'off';
        // 看看服务器数据里有没有 agent 主聊
        if (_serverChats && _serverChats[_agentMainId]) {
            chats[_agentMainId] = JSON.parse(JSON.stringify(_serverChats[_agentMainId]));
            console.log('[restoreUserData] 从服务器恢复了 Agent 主聊');
        } else if (_agentWasActive) {
            // 之前是 agent 模式但数据丢了,重新创建 (用缓存的 system prompt)
            var _agentSys = localStorage.getItem('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt;
            var _uid = localStorage.getItem('authUserId') || '';
            chats[_agentMainId] = {
                title: 'Agent',
                userId: _uid,
                updated_at: Date.now(),
                messages: [
                    { role: 'system', content: _agentSys }
                ]
            };
            console.log('[restoreUserData] 恢复了 Agent 主聊(system prompt)');
        }
        // 保存一下
        try { slimSaveChats(); } catch(e) {}
    }
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
        // ★ 如果是 agent 聊天但当前模式不是 agent,跳过,恢复上一个普通聊天
        if (lastId === '_agent_main') {
            var _currentAgentMode = getAgentMode();
            if (_currentAgentMode === 'off') {
                // agent 模式关闭时自动切到上一个普通聊天
                lastId = localStorage.getItem('lastNormalChatId') || null;
            }
        }
        if (lastId && (chats[lastId] || lastId === _agentMainId)) {
            // 即使 agent 主聊被合并排除了,我们也在上面补回了
            if (chats[lastId]) {
                loadChat(lastId);
            }
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
    // ★ 启动引擎状态自动刷新
    if (typeof window._startEngineAutoRefresh === 'function') {
        setTimeout(function() { window._startEngineAutoRefresh(); }, 2000);
    }
    // ★ 清理空的视频分析缓存（之前因权限/内存问题写入的空缓存）
    try {
        for (var _cid in chats) {
            if (chats[_cid].videoAnalyses) {
                var _cleaned = false;
                for (var _ck in chats[_cid].videoAnalyses) {
                    if (!chats[_cid].videoAnalyses[_ck].frames || chats[_cid].videoAnalyses[_ck].frames.length === 0) {
                        delete chats[_cid].videoAnalyses[_ck];
                        _cleaned = true;
                    }
                }
                if (_cleaned) slimSaveChats();
            }
        }
    } catch(e) {}
    // ★ 延迟启动 Agent 通知轮询, 避免和主数据加载竞争 abort
    setTimeout(function() { window.startAgentNotificationPolling(); }, 2000);
    // Connect SSE real-time channel for cross-browser sync
    // ★ WebSocket 先连接（让 resume 可用）
    window._wsInit();
    setTimeout(function() { window.connectSSEChannel(); }, 1000);

    // ★ 恢复引擎侧活跃任务（跨浏览器/刷新后继续接收流）
    setTimeout(function() { window._recoverActiveTasks(); }, 1500);

    // ★ Agent 模式恢复:如果刷新前 agentMode 是激活的,自动恢复
    var _agentModeSaved = localStorage.getItem('agentMode');
    if (_agentModeSaved && _agentModeSaved !== 'off') {
        var _currentMode = getAgentMode();
        if (_currentMode !== _agentModeSaved) {
            // 直接写 localStorage 和恢复，绕过 setAgentMode 的同模式退出逻辑
            localStorage.setItem('agentMode', _agentModeSaved);
            // 启用工具
            AGENT_TOOL_KEYS.forEach(function(k) { window.setToolEnabled(k, true); });
            updateAgentUI();
            if (typeof renderToolPanel === 'function') renderToolPanel();
            console.log('[Agent] 刷新后恢复模式:', _agentModeSaved);
        }
    }
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



