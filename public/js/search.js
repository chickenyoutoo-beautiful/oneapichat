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
    const provider = getVal('searchProvider') || 'duckduckgo';
    const timeout = parseInt(getVal('searchTimeout')) * 1000;
    const max = parseInt(getVal('maxSearchResults')) || 3;
    const region = getVal('searchRegion') || '';
    var t = Date.now();

    // 获取对应引擎的API Key
    const providerKeyId = SEARCH_PROVIDER_KEY_MAP[provider];
    var apiKey = '';
    if (providerKeyId) {
        apiKey = getVal(providerKeyId) || getVal('searchApiKey') || '';
    } else {
        apiKey = getVal('searchApiKey') || '';
    }

    var country = region && region.length === 2 ? region : '';

    var url = '';
    const headers = { 'Accept': 'application/json' };

    if (provider === 'brave') {
        const params = `q=${encodeURIComponent(query)}&count=${max}&_t=${t}`;
        if (country) params += `&country=${country}`;
        params += '&safesearch=off';
        if (SEARCH_PROXY) {
            url = `${SEARCH_PROXY}?engine=brave&${params}&type=${type}&key=${encodeURIComponent(apiKey)}`;
        } else {
            var endpoint = '';
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
            var controller = new AbortController();
            var timeoutId = setTimeout(() => controller.abort(), timeout);
            var combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
            var res = await fetchWithRetry(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body,
                signal: combinedSignal
            });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`搜索失败: ${res.status}`);
            var data = await res.json();
            return parseSearchResults(data, provider, type);
        } catch (e) {
            throw e;
        }
    } else if (provider === 'minimax') {
        // MiniMax 搜索通过服务器端 CLI 调用
        // MiniMax 搜索通过服务器端 CLI 调用,传 API Key(从聊天模型配置复用)
        const _k = localStorage.getItem('apiKeyMiniMax') || localStorage.getItem('baseApiKey') || '';
        var _mmxApiKey = _k; try { _mmxApiKey = await decrypt(_k) || _k; } catch(e) {}
        url = SERVER_API_BASE + '/engine_api.php?action=minimax_search&q=' + encodeURIComponent(query) + '&limit=' + max + '&api_key=' + encodeURIComponent(_mmxApiKey);
    } else {
        url = SEARCH_PROXY
            ? `${SEARCH_PROXY}?engine=duckduckgo&q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&_t=${t}${country ? '&kl=' + country : ''}`
            : `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&_t=${t}${country ? '&kl=' + country : ''}`;
    }

    var controller = new AbortController();
    var timeoutId = setTimeout(() => controller.abort(), timeout);
    var combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

    try {
        var res = await fetchWithRetry(url, { method: 'GET', headers, signal: combinedSignal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`搜索失败: ${res.status}`);
        var data = await res.json();
        return parseSearchResults(data, provider, type);
    } catch (e) {
        clearTimeout(timeoutId);
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

    var results = await Promise.all(validUrls.map(async function(url) {
        try {
            const ctrl = new AbortController();
            const tid = setTimeout(function() { ctrl.abort(); }, TIMEOUT_MS);
            var r = await fetch(
                FETCH_PROXY + '?url=' + encodeURIComponent(url) + '&extract=1',
                { signal: ctrl.signal }
            );
            clearTimeout(tid);
            if (!r.ok) {
                const errMap = { 502: '抓取失败(可能反爬)', 403: '网站反爬保护', 404: '页面不存在', 429: '请求过于频繁' };
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
        const ans = data.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
        // 增强正则提取 true/false
        const match = ans.match(/\b(true|false)\b/);
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
        const _rsn = bubble.querySelector('details.reasoning-details');
        const _md = bubble.querySelector('.markdown-body');
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

