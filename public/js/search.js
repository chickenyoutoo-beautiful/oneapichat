// search.js — 联网搜索 v1.0 (Phase 6)
// aiChooseSearchType / 搜索执行 / web_search 处理器

// ==================== 联网搜索 ====================
async function aiChooseSearchType(text, historySummary, signal) {
    var truncated = historySummary.length > MAX_HISTORY_LENGTH ? historySummary.slice(0, MAX_HISTORY_LENGTH) + '...(截断)' : historySummary;
    var now = new Date();
    var timeInfo = `当前真实时间:${now.toLocaleDateString()} ${now.toLocaleTimeString()}(时区:${Intl.DateTimeFormat().resolvedOptions().timeZone})。`;
    var prompt = `${timeInfo}\n请根据用户问题,判断最适合的搜索类型。只返回以下单词之一:web, news, images。不要解释。\n\n对话历史:${truncated}\n\n用户问题:${text}\n\n搜索类型:`;
    var model = getVal('aiSearchJudgeModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;
    var url = getVal('baseUrl');
    var key = getVal('apiKey');

    var controller = new AbortController();
    var timeoutId = setTimeout(() => controller.abort(), AI_JUDGE_TIMEOUT);
    var combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

    try {
        var res = await fetchWithRetry(`${url}/chat/completions`, {
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
        var data = await res.json();
        var type = data.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
        if (['web', 'news', 'images'].includes(type)) return type;
        return 'web';
    } catch {
        clearTimeout(timeoutId);
        return 'web';
    }
}

async function performWebSearch(query, signal, type = 'web') {
    var provider = getVal('searchProvider') || 'duckduckgo';
    var timeout = parseInt(getVal('searchTimeout')) * 1000;
    var max = parseInt(getVal('maxSearchResults')) || 3;
    var region = getVal('searchRegion') || '';
    var t = Date.now();

    // 获取对应引擎的API Key
    var providerKeyId = SEARCH_PROVIDER_KEY_MAP[provider];
    var apiKey = '';
    if (providerKeyId) {
        apiKey = getVal(providerKeyId) || getVal('searchApiKey') || '';
    } else {
        apiKey = getVal('searchApiKey') || '';
    }

    var country = region && region.length === 2 ? region : '';

    var url = '';
    var headers = { 'Accept': 'application/json' };

    if (provider === 'brave') {
        let params = `q=${encodeURIComponent(query)}&count=${max}&_t=${t}`;
        if (country) params += `&country=${country}`;
        params += '&safesearch=off';
        var endpoint = type === 'news' ? '/news/search' : (type === 'images' ? '/images/search' : '/web/search');
        url = `https://api.search.brave.com/res/v1${endpoint}?${params}`;
        // ★ 通过服务器代理避免浏览器CORS
        url = SERVER_API_BASE + '/engine_api.php?action=search_proxy&url=' + encodeURIComponent(url) + '&header_key=X-Subscription-Token&header_val=' + encodeURIComponent(apiKey);
    } else if (provider === 'google') {
        url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=017576662512468239146:omuauf_lfve&q=${encodeURIComponent(query)}&num=${max}&_t=${t}${country ? '&gl=' + country : ''}`;
        url = SERVER_API_BASE + '/engine_api.php?action=search_proxy&url=' + encodeURIComponent(url);
    } else if (provider === 'tavily') {
        // Tavily 搜索通过服务器端代理（绕过浏览器CORS）
        url = SERVER_API_BASE + '/engine_api.php?action=tavily_search&q=' + encodeURIComponent(query) + '&limit=' + max + '&api_key=' + encodeURIComponent(apiKey);
        console.log('[Search-Tavily] provider=tavily apiKey_len=' + (apiKey ? apiKey.length : 0) + ' url=' + url.substring(0, 100));
    } else if (provider === 'minimax') {
        // MiniMax 搜索通过服务器端 CLI 调用
        // MiniMax 搜索通过服务器端 CLI 调用,传 API Key(从聊天模型配置复用)
        var _k = localStorage.getItem('apiKeyMiniMax') || localStorage.getItem('baseApiKey') || '';
        var _mmxApiKey = _k; try { _mmxApiKey = await decrypt(_k) || _k; } catch(e) {}
        url = SERVER_API_BASE + '/engine_api.php?action=minimax_search&q=' + encodeURIComponent(query) + '&limit=' + max + '&api_key=' + encodeURIComponent(_mmxApiKey);
    } else {
        url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&_t=${t}${country ? '&kl=' + country : ''}`;
        url = SERVER_API_BASE + '/engine_api.php?action=search_proxy&url=' + encodeURIComponent(url);
    }

    var controller = new AbortController();
    var timeoutId = setTimeout(() => controller.abort(), timeout);
    var combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

    try {
        var res = await fetchWithRetry(url, { method: 'GET', headers, signal: combinedSignal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`搜索失败: ${res.status}`);
        var rawText = await res.text();
        // DuckDuckGo 直接API 可能返回HTML而非JSON(限流/反爬)
        if (rawText.trim().startsWith('<')) {
            throw new Error('搜索API返回HTML(可能被限流), 尝试回退...');
        }
        var data = JSON.parse(rawText);
        var results = parseSearchResults(data, provider, type);
        // ★ Tavily 无结果时自动回退 MiniMax CLI
        if (provider === 'tavily' && (!results || results.length === 0)) {
            console.warn('[Search-Tavily] 无结果, 回退 MiniMax CLI...');
            try {
                var _tvFbRes = await fetchWithRetry(
                    SERVER_API_BASE + '/engine_api.php?action=minimax_search&q=' + encodeURIComponent(query) + '&limit=' + max,
                    { method: 'GET', signal: combinedSignal }
                );
                if (_tvFbRes.ok) {
                    var _tvFbData = await _tvFbRes.json();
                    if (_tvFbData.results && _tvFbData.results.length > 0) {
                        return _tvFbData.results.map(function(r) { return { title: r.title || '', url: r.url || r.link || '', snippet: r.snippet || r.body || '' }; });
                    }
                }
            } catch (_tvFbErr) {
                console.warn('[Search-Tavily] 回退也失败:', _tvFbErr.message);
            }
        }
        return results;
    } catch (e) {
        clearTimeout(timeoutId);
        // 回退: 通过服务器端引擎搜索
        if (provider === 'duckduckgo' || provider === 'brave' || provider === 'tavily' || e.message.includes('HTML')) {
            try {
                console.warn('[Search] 直接API失败(' + e.message + '), 回退到服务端搜索...');
                var fbRes = await fetchWithRetry(
                    SERVER_API_BASE + '/engine_api.php?action=minimax_search&q=' + encodeURIComponent(query) + '&limit=' + max,
                    { method: 'GET', signal: combinedSignal }
                );
                if (fbRes.ok) {
                    var fbData = await fbRes.json();
                    if (fbData.results) {
                        return fbData.results.map(function(r) { return { title: r.title || '', url: r.url || '', snippet: r.snippet || r.body || '' }; });
                    }
                }
            } catch (fbErr) {
                console.warn('[Search] 服务端回退也失败:', fbErr.message);
            }
        }
        throw e;
    }
}

function parseSearchResults(data, provider, type = 'web') {
    var results = [];
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
        // Tavily response: { results: [{ title, url, content }] }
        // ★ 检测 Tavily 错误响应 (detail.error 格式, 而不是直接的 error 字段)
        if (data.detail && data.detail.error) {
            console.warn('[Search-Tavily] API错误:', data.detail.error);
            return results;  // 返回空 → 触发 fallback
        }
        if (data.error) {
            console.warn('[Search-Tavily] 错误:', data.error);
            return results;
        }
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
        var line = `${i + 1}. ${r.title}\n   链接: ${r.url}\n   摘要: ${r.snippet}`;
        if (r.thumbnail) {
            line += `\n   ![图片](${r.thumbnail})`;
        }
        return line;
    }).join('\n\n');
}

// ★ 网页内容抓取: 支持单URL和多URL并行
async function performWebFetch(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return { results: [], error: 'No URLs provided' };

    var BLOCKED_HOSTS = [];
    var isBlocked = function(u) {
        try { return BLOCKED_HOSTS.some(function(h) { return new URL(u).hostname.includes(h); }); } catch { return false; }
    };

    var seen = new Set();
    var validUrls = urls.filter(function(u) {
        if (seen.has(u)) return false;
        seen.add(u);
        if (isBlocked(u)) return false;
        try { return new URL(u).protocol.startsWith('http'); } catch { return false; }
    }).slice(0, 5);
    if (validUrls.length === 0) return { results: [], error: 'No valid HTTP URLs (或全部被反爬保护)' };

    var TIMEOUT_MS = 300000;

    var results = await Promise.all(validUrls.map(async function(url) {
        try {
            var ctrl = new AbortController();
            var tid = setTimeout(function() { ctrl.abort(); }, TIMEOUT_MS);
            var r, d;
            // ★ 优先尝试浏览器直连(走系统代理), 已知CORS拦截的域名直接走服务器
            var _host2 = '';
            try { _host2 = new URL(url).host; } catch(e) {}
            var _corsBlocked = window._corsBlockedDomains && window._corsBlockedDomains[_host2];
            if (!_corsBlocked) {
                try {
                    var _directCtrl = new AbortController();
                    var _directTid = setTimeout(function() { _directCtrl.abort(); }, 5000);  // 5s 超时
                    r = await fetch(url, { signal: _directCtrl.signal });
                    clearTimeout(_directTid);
                    if (r.ok) {
                        var _text = await r.text();
                        d = { content: _text.substring(0, 50000), error: '' };
                        return { url: url, content: d.content, error: '' };
                    }
                } catch(_directErr) {
                    // ★ CORS/网络错误 → 记录域名, 下次直接走 fetch.php
                    if (_host2) {
                        window._corsBlockedDomains = window._corsBlockedDomains || {};
                        window._corsBlockedDomains[_host2] = true;
                    }
                }
            }
            // ★ 传递代理配置到 fetch.php
            async function _tryFetchWithProxy(_proxyUrl) {
                var _pp = _proxyUrl ? '&proxy=' + encodeURIComponent(_proxyUrl) : '';
                var _ffn = window.proxyFetch;
                var _r = await _ffn(
                    FETCH_PROXY + '?url=' + encodeURIComponent(url) + '&extract=1' + _pp,
                    { signal: ctrl.signal }
                );
                if (_r.ok) {
                    var _d = await _r.json();
                    return { url: url, content: _d.content || '', error: '' };
                }
                return null;  // 失败
            }
            // 第一优先: 当前代理设置
            var _curProxy = '';
            if (window.isProxyEnabled && window.isProxyEnabled()) {
                _curProxy = (window.getProxyUrl && window.getProxyUrl()) || '';
            }
            var _result = await _tryFetchWithProxy(_curProxy);
            // ★ 失败时自动尝试系统代理(如果配置了代理URL但未开启)
            if (!_result && !_curProxy) {
                var _savedProxy = localStorage.getItem('proxyUrl') || '';
                if (_savedProxy) {
                    _result = await _tryFetchWithProxy(_savedProxy);
                }
            }
            if (_result) { clearTimeout(tid); return _result; }

            clearTimeout(tid);
            var errMap = { 502: '抓取失败(可能反爬)', 403: '网站反爬保护', 404: '页面不存在', 429: '请求过于频繁', 503: '服务器不可达(境外网站需开代理)' };
            var msg = errMap[r ? r.status : 502] || (r ? 'HTTP ' + r.status : '网络错误');
            return { url: url, content: '', error: msg };
        } catch (e) {
            return { url: url, content: '', error: e.name === 'AbortError' ? '请求超时' : e.message };
        }
    }));

    return { results: results };
}

async function generateSearchQuery(text, history, signal) {
    var model = getVal('aiSearchJudgeModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;
    var url = getVal('baseUrl');
    var key = getVal('apiKey');
    var truncated = history.length > MAX_HISTORY_LENGTH ? history.slice(0, MAX_HISTORY_LENGTH) + '...(截断)' : history;
    var now = new Date();
    var timeInfo = `当前真实时间:${now.toLocaleDateString()} ${now.toLocaleTimeString()}(时区:${Intl.DateTimeFormat().resolvedOptions().timeZone})。`;
    var prompt = `${timeInfo}\n你是一个搜索词优化助手。请结合以下对话历史,理解用户问题中的代词具体指代什么,然后生成一个简短(10个词以内)、精准的搜索引擎查询词。只返回查询词本身,不要有任何解释、标点或额外内容。\n\n对话历史:\n${truncated}\n\n用户问题:${text}\n\n优化后的搜索查询词:`;

    try {
        var res = await fetchWithRetry(`${url}/chat/completions`, {
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
        var data = await res.json();
        var query = data.choices?.[0]?.message?.content?.trim() || '';
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
    var truncated = history.length > MAX_HISTORY_LENGTH ? history.slice(0, MAX_HISTORY_LENGTH) + '...(截断)' : history;
    var now = new Date();
    var timeInfo = `当前真实时间:${now.toLocaleDateString()} ${now.toLocaleTimeString()}(时区:${Intl.DateTimeFormat().resolvedOptions().timeZone})。`;
    var prompt = (getVal('aiSearchJudgePrompt') || DEFAULT_CONFIG.aiSearchJudgePrompt).replace('{history}', truncated).replace('{text}', text);
    if (!prompt.includes('{history}')) prompt = `以下是对话历史:\n${truncated}\n\n用户问题:${text}\n\n请判断是否需要联网搜索。`;
    prompt = timeInfo + '\n' + prompt;

    var model = getVal('aiSearchJudgeModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;
    var url = getVal('baseUrl');
    var key = getVal('apiKey');

    var controller = new AbortController();
    var timeoutId = setTimeout(() => controller.abort(), AI_JUDGE_TIMEOUT);
    var combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

    try {
        var res = await fetchWithRetry(`${url}/chat/completions`, {
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
        var data = await res.json();
        var ans = data.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
        // 增强正则提取 true/false
        var match = ans.match(/\b(true|false)\b/);
        if (match) return match[0] === 'true';
        // 如果包含中文关键词也尝试理解
        if (ans.includes('需要') || ans.includes('应该') || ans.includes('true')) return true;
        if (ans.includes('不需要') || ans.includes('false')) return false;
        // fallback: 关键词匹配
        var smartKeywords = getSmartSearchKeywords();
        return smartKeywords.some(k => text.includes(k));
    } catch {
        clearTimeout(timeoutId);
        // 出错时也 fallback 到关键词匹配
        var smartKeywords = getSmartSearchKeywords();
        return smartKeywords.some(k => text.includes(k));
    }
}

function updateBubbleSearchStatus(bubble, status, isError = false) {
    if (!bubble || !bubble.querySelector || !currentChatId) return;
    if (!document.body.contains(bubble)) return;

    var statusDiv = bubble.querySelector('.search-status');
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.className = 'search-status';
        // 放在 reasoning details 下方、markdown-body 上方
        var _rsn = bubble.querySelector('details.reasoning-details');
        var _md = bubble.querySelector('.markdown-body');
        if (_rsn && _md) {
            _rsn.after(statusDiv);
        } else if (_md) {
            bubble.insertBefore(statusDiv, _md);
        } else {
            bubble.appendChild(statusDiv);
        }
    } else {
        statusDiv.innerHTML = ''; // 清空旧内容
    }
    var line = document.createElement('div');
    line.textContent = status;
    if (isError) line.style.color = '#ef4444';
    statusDiv.appendChild(line);
}

