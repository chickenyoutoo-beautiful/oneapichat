// usage-stats.js — OneAPIChat 使用统计与 Token 用量分析模块 v3.2
// 100% 深度绑定 OneAPIChat 本地权威会话库与实时消息，多模型精准识别，无 emoji 纯净矢量设计

(function() {
    'use strict';

    const STORAGE_KEY = 'oac_local_usage_records_v3';
    const API_URL = (typeof SERVER_API_BASE !== 'undefined' ? SERVER_API_BASE : '/oneapichat/api') + '/chat.php';

    // 专属调色盘 (优雅明亮，现代质感)
    const MODEL_PALETTE = [
        '#f59e0b', // 橙 (gemini-3.7-flash-high)
        '#8b5cf6', // 紫 (deepseek-v4-flash)
        '#2563eb', // 蓝 (gpt-5.6-sol / gpt-4o)
        '#10b981', // 绿 (gemini-3.7-flash)
        '#ec4899', // 粉 (gpt-5.6-luna)
        '#06b6d4', // 青 (gpt-image-2 / grok-4.5)
        '#6366f1', // 靛青
        '#14b8a6', // 蓝绿 (minimax)
        '#f43f5e', // 玫红
        '#84cc16', // 青柠
        '#a855f7', // 亮紫
        '#3b82f6'  // 天蓝
    ];

    let _modelColorMap = {
        'gemini-3.8-flash-high': '#f59e0b',
        'gemini-3.8-flash': '#10b981',
        'gemini-3.7-flash-high': '#d97706',
        'deepseek-v4-flash': '#8b5cf6',
        'deepseek-v4-flash-vision-exp': '#a855f7',
        'gpt-5.6-sol': '#2563eb',
        'gpt-4o': '#2563eb',
        'gemini-3.7-flash': '#059669',
        'gpt-image-2': '#06b6d4',
        'gpt-5.6-luna': '#ec4899',
        'claude-3-7-sonnet': '#6366f1'
    };
    let _colorIdx = 0;

    function getModelColor(modelName) {
        if (!modelName) return MODEL_PALETTE[0];
        const cleanName = String(modelName).replace(/^(openai|google|deepseek-official|cpa|anthropic|minimax|xai)\//, '');
        if (_modelColorMap[cleanName]) return _modelColorMap[cleanName];
        if (_modelColorMap[modelName]) return _modelColorMap[modelName];
        // 每个新模型自动分配一个尚未使用的颜色；模型消失/重排不改变既有颜色。
        const used = new Set(Object.values(_modelColorMap));
        let color = MODEL_PALETTE.find(c => !used.has(c));
        if (!color) {
            color = MODEL_PALETTE[_colorIdx % MODEL_PALETTE.length];
            _colorIdx++;
        }
        _modelColorMap[cleanName] = color;
        return color;
    }

    // 格式化数字 (自适应亿/万/k单位)
    function formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '0';
        const n = Number(num);
        if (n >= 100000000) {
            return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
        }
        if (n >= 10000) {
            return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
        }
        if (n >= 1000) {
            return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        }
        return n.toLocaleString();
    }

    // 格式化精确带逗号数字
    function formatExact(num) {
        if (num === null || num === undefined || isNaN(num)) return '0';
        return Number(num).toLocaleString();
    }

    // 格式化耗时
    function formatDuration(ms) {
        if (!ms || ms <= 0) return '<1s';
        if (ms < 1000) return '<1s';
        return (ms / 1000).toFixed(1) + 's';
    }

    // 格式化短时间 MM-DD HH:mm
    function formatShortDateTime(ts) {
        if (!ts) return '-';
        const d = new Date(ts);
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return m + '-' + day + ' ' + h + ':' + min;
    }

    // 格式化日期 YYYY-MM-DD
    function formatDate(ts) {
        const d = new Date(ts);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    // 格式化思考程度胶囊徽章
    function formatEffortBadge(effort) {
        if (!effort || effort === '未记录') {
            return '<span style="color:var(--us-muted);opacity:0.6;">未记录</span>';
        }
        const eff = String(effort).trim();
        const effLower = eff.toLowerCase();
        let label = eff;
        let color = 'var(--us-muted)';
        let bg = 'rgba(148, 163, 184, 0.12)';
        let border = 'rgba(148, 163, 184, 0.2)';

        if (effLower === 'high') {
            label = 'High (高)';
            color = '#f59e0b';
            bg = 'rgba(245, 158, 11, 0.12)';
            border = 'rgba(245, 158, 11, 0.3)';
        } else if (effLower === 'xhigh') {
            label = 'XHigh (极高)';
            color = '#ef4444';
            bg = 'rgba(239, 68, 68, 0.12)';
            border = 'rgba(239, 68, 68, 0.3)';
        } else if (effLower === 'max') {
            label = 'Max (最大)';
            color = '#dc2626';
            bg = 'rgba(220, 38, 38, 0.14)';
            border = 'rgba(220, 38, 38, 0.35)';
        } else if (effLower === 'medium') {
            label = 'Medium (中)';
            color = '#3b82f6';
            bg = 'rgba(59, 130, 246, 0.12)';
            border = 'rgba(59, 130, 246, 0.25)';
        } else if (effLower === 'low') {
            label = 'Low (低)';
            color = '#10b981';
            bg = 'rgba(16, 185, 129, 0.12)';
            border = 'rgba(16, 185, 129, 0.25)';
        } else if (effLower === 'minimal') {
            label = 'Minimal (微弱)';
            color = '#06b6d4';
            bg = 'rgba(6, 182, 212, 0.12)';
            border = 'rgba(6, 182, 212, 0.25)';
        } else if (effLower === 'off' || effLower === 'disabled') {
            label = '已关闭';
            color = 'var(--us-muted)';
            bg = 'rgba(148, 163, 184, 0.08)';
            border = 'rgba(148, 163, 184, 0.15)';
        } else if (eff === '已开启') {
            label = '已开启';
            color = '#8b5cf6';
            bg = 'rgba(139, 92, 246, 0.12)';
            border = 'rgba(139, 92, 246, 0.25)';
        }
        return '<span style="display:inline-block;padding:2px 8px;font-size:11px;font-weight:500;border-radius:9999px;line-height:1.3;color:' + color + ';background:' + bg + ';border:1px solid ' + border + ';">' + label + '</span>';
    }

    // =========================================================================
    // OneAPIChat 使用统计管理器
    // =========================================================================
    const UsageStats = {
        _currentRange: '30d', // '7d' | '30d' | 'all'
        _currentScope: 'all',  // 'all' | 'main' | 'subagent'
        _serverData: null,
        _isLoading: false,
        _filters: {
            model: '',
            provider: '',
            minInput: 0,
            minOutput: 0,
            maxRecords: 1000,
            pageSize: 20,
            currentPage: 1
        },

        init() {
            this.fetchServerStats();
        },

        async fetchServerStats() {
            if (this._isLoading) return;
            this._isLoading = true;
            try {
                const rangeDays = this._currentRange === '7d' ? 7 : (this._currentRange === '30d' ? 30 : 3650);
                const token = localStorage.getItem('authToken') || (typeof getCookie === 'function' ? getCookie('auth_token') : '');
                const headers = token ? { 'Authorization': 'Bearer ' + token } : {};

                const resp = await fetch(`${API_URL}?action=usage_stats&range=${rangeDays}&scope=${this._currentScope}`, {
                    headers: headers,
                    cache: 'no-cache'
                });

                if (resp.ok) {
                    this._serverData = await resp.json();
                }
            } catch (e) {
                console.warn('[UsageStats] 从服务端拉取使用统计失败:', e);
            } finally {
                this._isLoading = false;
                if (this.isModalOpen()) {
                    this.renderDashboard();
                }
            }
        },

        // 记录单次前端本地调用
        record(entry) {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                let list = raw ? JSON.parse(raw) : [];
                if (!Array.isArray(list)) list = [];

                const usage = entry.usage || {};
                const pt = Number(usage.prompt_tokens || usage.input_tokens || usage.inputTokenCount || 0);
                const ct = Number(usage.completion_tokens || usage.output_tokens || usage.outputTokenCount || 0);
                const total = Number(usage.total_tokens || (pt + ct) || 0);

                const cHit = typeof window._extractCacheHit === 'function' ? window._extractCacheHit(usage) : 0;
                const mName = entry.model || (typeof currentModel !== 'undefined' ? currentModel : '未知模型');
                const cWrite = typeof window._extractCacheWrite === 'function' ? window._extractCacheWrite(usage, mName, pt, cHit) : 0;

                let effortVal = entry.effort || '';
                if (!effortVal && mName) {
                    const mMatch = String(mName).match(/-(off|minimal|low|medium|high|xhigh|max)$/i);
                    if (mMatch) effortVal = mMatch[1].toLowerCase();
                }
                if (!effortVal) effortVal = localStorage.getItem('thinkingIntensity') || '未记录';

                const ts = entry.timestamp || Date.now();
                list.push({
                    id: 'oac_' + ts + '_' + Math.random().toString(36).slice(2, 7),
                    timestamp: ts,
                    time: ts,
                    date: formatDate(ts),
                    chatId: entry.chatId || (typeof currentChatId !== 'undefined' ? currentChatId : ''),
                    model: mName,
                    provider: entry.provider || (typeof baseUrlProvider !== 'undefined' ? baseUrlProvider : 'custom'),
                    durationMs: Number(entry.durationMs || entry.time || 0),
                    tokens: { input: pt, output: ct, total: total, cacheRead: cHit, cacheWrite: cWrite },
                    effort: effortVal
                });

                if (list.length > 2000) list = list.slice(list.length - 2000);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
            } catch (e) {
                console.warn('[UsageStats] record error:', e);
            }

            // 重新刷新服务端统计
            setTimeout(() => {
                this.fetchServerStats();
            }, 500);
        },

        // =====================================================================
        // 数据聚合与状态获取
        // =====================================================================
        getAggregatedData() {
            if (this._serverData && this._serverData.totals) {
                const data = JSON.parse(JSON.stringify(this._serverData));
                
                // 确保模型色彩
                if (Array.isArray(data.models)) {
                    data.models.forEach(m => {
                        m.name = m.model || m.name || '未知模型';
                        m.color = getModelColor(m.name);
                    });
                }

                // 确保按天趋势
                if (Array.isArray(data.days)) {
                    data.days.forEach(d => {
                        d.totalTokens = d.tokens || 0;
                        d.byModel = d.models || {};
                    });
                }

                data.records = Array.isArray(data.calls) ? data.calls : [];
                return data;
            }

            // 兜底空结构
            return {
                totals: { tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, sessions: 0, messages: 0, activeDays: 0, currentStreak: 0 },
                mostUsedModel: { name: '暂无记录', provider: '-', percent: 0, tokens: 0 },
                models: [],
                days: [],
                records: []
            };
        },

        // =====================================================================
        // UI 渲染与弹窗控制 (无任何 Emoji，纯净矢量)
        // =====================================================================
        isModalOpen() {
            const el = document.getElementById('usageStatsModal');
            return el && el.classList.contains('is-active');
        },

        openModal() {
            let modal = document.getElementById('usageStatsModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'usageStatsModal';
                modal.className = 'us-modal-overlay';
                modal.setAttribute('role', 'dialog');
                modal.setAttribute('aria-modal', 'true');
                modal.setAttribute('aria-label', '使用统计');
                modal.innerHTML = '<div class="us-shell" id="usageStatsShell"></div>';
                document.body.appendChild(modal);

                modal.addEventListener('click', (e) => {
                    if (e.target === modal) this.closeModal();
                });

                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && this.isModalOpen()) {
                        this.closeModal();
                    }
                });
            }

            this.renderDashboard();
            this.fetchServerStats();

            requestAnimationFrame(() => {
                modal.classList.add('is-active');
            });
            document.body.style.overflow = 'hidden';
        },

        closeModal() {
            const modal = document.getElementById('usageStatsModal');
            if (modal) {
                modal.classList.remove('is-active');
            }
            document.body.style.overflow = '';
        },

        renderDashboard() {
            const shell = document.getElementById('usageStatsShell');
            if (!shell) return;

            const analytics = this.getAggregatedData();
            const f = this._filters;
            const totals = analytics.totals;
            const mostUsed = analytics.mostUsedModel;
            const models = analytics.models || [];
            const days = analytics.days || [];

            // 过滤明细记录
            let filteredCalls = (analytics.records || []).slice();
            // 调用详情始终按时间倒序展示，确保 7 天、30 天和全部范围均最新优先。
            filteredCalls.sort((a, b) => Number(b.timestamp || b.time || 0) - Number(a.timestamp || a.time || 0));
            if (f.model) filteredCalls = filteredCalls.filter(c => c.model === f.model);
            if (f.provider) filteredCalls = filteredCalls.filter(c => c.provider === f.provider);
            if (f.minInput > 0) filteredCalls = filteredCalls.filter(c => (c.tokens ? c.tokens.input : 0) >= f.minInput);
            if (f.minOutput > 0) filteredCalls = filteredCalls.filter(c => (c.tokens ? c.tokens.output : 0) >= f.minOutput);

            const totalFiltered = filteredCalls.length;
            const maxRec = f.maxRecords || 1000;
            const cappedCalls = filteredCalls.slice(0, maxRec);
            const pageSize = f.pageSize || 20;
            const totalPages = Math.max(1, Math.ceil(cappedCalls.length / pageSize));
            const curPage = Math.min(Math.max(1, f.currentPage), totalPages);
            const pagedCalls = cappedCalls.slice((curPage - 1) * pageSize, curPage * pageSize);

            // 提取已知模型与提供商
            const allModelsSet = new Set();
            const allProvidersSet = new Set();
            models.forEach(m => {
                if (m.name) allModelsSet.add(m.name);
                if (m.provider) allProvidersSet.add(m.provider);
            });

            // 1. 构造按天趋势堆叠柱状图 (优化最小可见度与非线性高度)
            let maxDailyTokens = 1;
            days.forEach(d => {
                const tk = d.totalTokens || d.tokens || 0;
                if (tk > maxDailyTokens) maxDailyTokens = tk;
            });

            let trendBarsHtml = '';
            days.forEach((d, idx) => {
                const dayTk = d.totalTokens || d.tokens || 0;
                let totalH = 0;
                if (dayTk > 0) {
                    totalH = Math.min(100, Math.max(6, (dayTk / maxDailyTokens) * 100));
                }

                let segsHtml = '';
                const segModels = Object.keys(d.byModel || {}).map(k => ({ key: k, tokens: d.byModel[k] }));

                segModels.forEach(m => {
                    const mTokens = m.tokens || 0;
                    if (mTokens <= 0) return;
                    const segPct = dayTk > 0 ? (mTokens / dayTk) * 100 : 0;
                    const col = getModelColor(m.key);
                    segsHtml += '<div class="us-bar-seg" style="height:' + Math.max(2, segPct) + '%;background:' + col + ';" title="' + m.key + ': ' + formatNumber(mTokens) + ' tokens"></div>';
                });

                const showDate = (days.length <= 10) || (idx % Math.ceil(days.length / 7) === 0) || (idx === days.length - 1);

                trendBarsHtml += '<div class="us-bar-col">' +
                    '<div class="us-bar-wrap">' +
                        '<div class="us-bar-stack" style="height:' + totalH + '%;" data-date="' + d.date + '" data-tokens="' + dayTk + '" onmouseenter="UsageStats.showBarTip(event, \'' + d.date + '\', ' + dayTk + ', \'' + encodeURIComponent(JSON.stringify(d.byModel || {})) + '\')" onmouseleave="UsageStats.hideTip()">' +
                            segsHtml +
                        '</div>' +
                    '</div>' +
                    (showDate ? '<div class="us-bar-date">' + d.label + '</div>' : '<div class="us-bar-date" style="visibility:hidden;">-</div>') +
                '</div>';
            });

            // 2. 构造活跃热力图 (52 周)
            let maxHeatToken = 1;
            days.forEach(d => {
                const tk = d.totalTokens || d.tokens || 0;
                if (tk > maxHeatToken) maxHeatToken = tk;
            });

            let heatCellsHtml = '';
            const now = Date.now();
            const heatStart = new Date(now - (52 * 7 * 86400000));
            const dayOffset = (heatStart.getDay() + 6) % 7;
            heatStart.setDate(heatStart.getDate() - dayOffset);

            const dayTokensMap = {};
            const dayCallsMap = {};
            days.forEach(d => {
                dayTokensMap[d.date] = d.totalTokens || d.tokens || 0;
                dayCallsMap[d.date] = d.calls || 1;
            });

            const curIter = new Date(heatStart);
            while (curIter.getTime() <= now + 86400000) {
                const ds = formatDate(curIter.getTime());
                const tk = dayTokensMap[ds] || 0;
                const calls = dayCallsMap[ds] || 0;
                let level = 0;
                if (tk > 0) {
                    const ratio = tk / maxHeatToken;
                    if (ratio <= 0.15) level = 1;
                    else if (ratio <= 0.35) level = 2;
                    else if (ratio <= 0.60) level = 3;
                    else if (ratio <= 0.85) level = 4;
                    else level = 5;
                }
                heatCellsHtml += '<div class="us-cell" data-level="' + level + '" data-date="' + ds + '" onmouseenter="UsageStats.showHeatTip(event, \'' + ds + '\', ' + tk + ', ' + calls + ')" onmouseleave="UsageStats.hideTip()"></div>';
                curIter.setDate(curIter.getDate() + 1);
            }

            // 3. 构造 Conic Gradient 环形 Donut
            let conicGrad = '';
            let curDeg = 0;
            if (models.length > 0 && totals.tokens > 0) {
                const parts = [];
                models.forEach(m => {
                    const deg = (m.tokens / totals.tokens) * 360;
                    parts.push((m.color || getModelColor(m.name)) + ' ' + curDeg.toFixed(1) + 'deg ' + (curDeg + deg).toFixed(1) + 'deg');
                    curDeg += deg;
                });
                conicGrad = 'conic-gradient(' + parts.join(', ') + ')';
            } else {
                conicGrad = 'conic-gradient(#6366f1 0deg 360deg)';
            }

            // 4. 构造模型排行列表
            let modelRowsHtml = '';
            models.slice(0, 6).forEach(m => {
                const col = m.color || getModelColor(m.name);
                modelRowsHtml += '<div class="us-model-item">' +
                    '<div class="us-model-left">' +
                        '<span class="us-legend-dot" style="background:' + col + ';"></span>' +
                        '<div style="min-width:0;">' +
                            '<div class="us-model-title" title="' + m.name + '">' + m.name + '</div>' +
                            '<div class="us-model-sub">' + m.provider + ' · ' + formatNumber(m.tokens) + ' tokens · ' + m.calls + ' 次调用</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="us-model-pct">' + m.percent + '%</div>' +
                '</div>';
            });
            if (models.length === 0) {
                modelRowsHtml = '<div class="text-sm text-gray-400 py-4 text-center">暂无模型用量记录</div>';
            }

            // 5. 构造表格 Rows
            let tableRowsHtml = '';
            pagedCalls.forEach(c => {
                const tks = c.tokens || {};
                const inp = tks.input || 0;
                const out = tks.output || 0;
                const cacheR = tks.cacheRead || 0;
                const cacheRate = (cacheR > 0 && (cacheR + inp) > 0)
                    ? ((cacheR / (cacheR + inp)) * 100).toFixed(0) + '%'
                    : '-';
                tableRowsHtml += '<tr>' +
                    '<td style="color:var(--us-muted);">' + formatShortDateTime(c.timestamp || c.time) + '</td>' +
                    '<td>' + formatDuration(c.durationMs) + '</td>' +
                    '<td>' + formatNumber(inp) + '</td>' +
                    '<td>' + formatNumber(out) + '</td>' +
                    '<td>' + cacheRate + '</td>' +
                    '<td class="font-medium" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="' + c.model + '">' + c.model + '</td>' +
                    '<td>' + formatEffortBadge(c.effort) + '</td>' +
                '</tr>';
            });
            if (pagedCalls.length === 0) {
                tableRowsHtml = '<tr><td colspan="7" class="text-center py-8 text-gray-400">暂无调用明细数据</td></tr>';
            }

            // 6. 完整 HTML (无任何 Emoji)
            shell.innerHTML = 
                '<!-- 顶部导航栏 -->' +
                '<div class="us-top">' +
                    '<div class="us-heading">' +
                        '<span class="us-title">使用统计</span>' +
                        '<span class="us-tab">应用用量</span>' +
                    '</div>' +
                    '<div class="us-top-actions">' +
                        '<button type="button" class="us-back-btn" onclick="UsageStats.closeModal()">' +
                            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
                            '返回对话' +
                        '</button>' +
                        '<button type="button" class="us-close-btn" onclick="UsageStats.closeModal()" title="关闭 (Esc)">' +
                            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                        '</button>' +
                    '</div>' +
                '</div>' +

                '<!-- 滚动主体 -->' +
                '<div class="us-scroll">' +
                    '<div class="us-content">' +
                        '<!-- 控制工具栏 -->' +
                        '<div class="us-toolbar">' +
                            '<div class="us-toolbar-left">' +
                                '<span class="us-range-label">趋势范围</span>' +
                                '<select class="us-select-filter" onchange="UsageStats.setScope(this.value)">' +
                                    '<option value="all"' + (this._currentScope === 'all' ? ' selected' : '') + '>全部任务</option>' +
                                    '<option value="main"' + (this._currentScope === 'main' ? ' selected' : '') + '>仅主任务</option>' +
                                    '<option value="subagent"' + (this._currentScope === 'subagent' ? ' selected' : '') + '>仅子任务</option>' +
                                '</select>' +
                            '</div>' +
                            '<div class="us-toolbar-right">' +
                                '<div class="us-segment">' +
                                    '<button type="button" class="us-segment-btn' + (this._currentRange === '7d' ? ' is-active' : '') + '" onclick="UsageStats.setRange(\'7d\')">最近 7 天</button>' +
                                    '<button type="button" class="us-segment-btn' + (this._currentRange === '30d' ? ' is-active' : '') + '" onclick="UsageStats.setRange(\'30d\')">最近 30 天</button>' +
                                    '<button type="button" class="us-segment-btn' + (this._currentRange === 'all' ? ' is-active' : '') + '" onclick="UsageStats.setRange(\'all\')">全部</button>' +
                                '</div>' +
                                '<button type="button" class="us-export-btn" onclick="UsageStats.exportCSV()" title="导出 CSV">' +
                                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
                                    'CSV' +
                                '</button>' +
                                '<button type="button" class="us-export-btn" onclick="UsageStats.exportJSON()" title="导出 JSON">' +
                                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
                                    'JSON' +
                                '</button>' +
                            '</div>' +
                        '</div>' +

                        '<!-- 6大核心指标卡片 (3x2 栅格) -->' +
                        '<div class="us-cards">' +
                            '<!-- 1. Tokens 用量 -->' +
                            '<div class="us-card">' +
                                '<div class="us-card-label">' +
                                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' +
                                    'Tokens 用量' +
                                '</div>' +
                                '<div class="us-card-value">' + formatNumber(totals.tokens) + '</div>' +
                                '<div class="us-card-detail">输入 ' + formatNumber(totals.input) + ' · 输出 ' + formatNumber(totals.output) + '</div>' +
                            '</div>' +

                            '<!-- 2. 会话数量 -->' +
                            '<div class="us-card">' +
                                '<div class="us-card-label">' +
                                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
                                    '会话数量' +
                                '</div>' +
                                '<div class="us-card-value">' + formatExact(totals.sessions) + '</div>' +
                                '<div class="us-card-detail">累计活跃会话总数</div>' +
                            '</div>' +

                            '<!-- 3. 消息数量 -->' +
                            '<div class="us-card">' +
                                '<div class="us-card-label">' +
                                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
                                    '消息数量' +
                                '</div>' +
                                '<div class="us-card-value">' + formatExact(totals.messages) + '</div>' +
                                '<div class="us-card-detail">累计模型交互轮次</div>' +
                            '</div>' +

                            '<!-- 4. 活跃天数 -->' +
                            '<div class="us-card">' +
                                '<div class="us-card-label">' +
                                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
                                    '活跃天数' +
                                '</div>' +
                                '<div class="us-card-value">' + totals.activeDays + '</div>' +
                                '<div class="us-card-detail">发生调用的独立天数</div>' +
                            '</div>' +

                            '<!-- 5. 当前连续天数 -->' +
                            '<div class="us-card">' +
                                '<div class="us-card-label">' +
                                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
                                    '当前连续天数' +
                                '</div>' +
                                '<div class="us-card-value">' + totals.currentStreak + '</div>' +
                                '<div class="us-card-detail">连续活跃 Streak 记录</div>' +
                            '</div>' +

                            '<!-- 6. 最常用模型 -->' +
                            '<div class="us-card">' +
                                '<div class="us-card-label">' +
                                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' +
                                    '最常用模型' +
                                '</div>' +
                                '<div class="us-card-value" style="font-size:clamp(17px,1.6vw,22px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (mostUsed.name || mostUsed.model) + '">' + (mostUsed.name || mostUsed.model) + '</div>' +
                                '<div class="us-card-detail">' + mostUsed.percent + '% · ' + mostUsed.provider + '</div>' +
                            '</div>' +
                        '</div>' +

                        '<!-- 活跃热力图 Panel -->' +
                        '<div class="us-panel">' +
                            '<div class="us-panel-head">' +
                                '<span class="us-panel-title">活跃热力图</span>' +
                                '<div class="us-heat-legend">' +
                                    '<span>较少</span>' +
                                    '<span class="us-cell" data-level="0"></span>' +
                                    '<span class="us-cell" data-level="1"></span>' +
                                    '<span class="us-cell" data-level="2"></span>' +
                                    '<span class="us-cell" data-level="3"></span>' +
                                    '<span class="us-cell" data-level="4"></span>' +
                                    '<span class="us-cell" data-level="5"></span>' +
                                    '<span>较多</span>' +
                                '</div>' +
                            '</div>' +
                            '<div class="us-heat-container">' +
                                '<div class="us-heat-wrap">' +
                                    '<div class="us-heat-days">' +
                                        '<span>一</span>' +
                                        '<span></span>' +
                                        '<span>三</span>' +
                                        '<span></span>' +
                                        '<span>五</span>' +
                                        '<span></span>' +
                                        '<span></span>' +
                                    '</div>' +
                                    '<div class="us-heat-grid">' +
                                        heatCellsHtml +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +

                        '<!-- 按天 Token 趋势 Panel -->' +
                        '<div class="us-panel">' +
                            '<div class="us-panel-head">' +
                                '<span class="us-panel-title">按天 Token 趋势</span>' +
                                '<span class="us-panel-note">模型堆叠柱状图 · 悬停查看单日用量</span>' +
                            '</div>' +
                            '<div class="us-chart-frame">' +
                                '<div class="us-grid-lines">' +
                                    '<i></i><i></i><i></i><i></i>' +
                                '</div>' +
                                '<div class="us-chart-bars">' +
                                    trendBarsHtml +
                                '</div>' +
                            '</div>' +
                            '<!-- 图例 -->' +
                            '<div class="us-legend">' +
                                models.slice(0, 8).map(m => 
                                    '<div class="us-legend-item">' +
                                        '<span class="us-legend-dot" style="background:' + (m.color || getModelColor(m.name)) + ';"></span>' +
                                        '<span>' + m.name + '</span>' +
                                    '</div>'
                                ).join('') +
                            '</div>' +
                        '</div>' +

                        '<!-- 模型用量与占比 Panel -->' +
                        '<div class="us-panel">' +
                            '<div class="us-panel-head">' +
                                '<span class="us-panel-title">模型用量</span>' +
                                '<span class="us-panel-note">输入、输出与缓存合计</span>' +
                            '</div>' +
                            '<div class="us-model-layout">' +
                                '<div class="us-donut-box" style="background:' + conicGrad + ';">' +
                                    '<div class="us-donut-hole">' +
                                        '<strong>' + formatNumber(totals.tokens) + '</strong>' +
                                        '<small>tokens</small>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="us-model-list">' +
                                    modelRowsHtml +
                                '</div>' +
                            '</div>' +
                        '</div>' +

                        '<!-- Token 构成 (4卡片) Panel -->' +
                        '<div class="us-panel">' +
                            '<div class="us-panel-head">' +
                                '<span class="us-panel-title">Token 构成</span>' +
                                '<span class="us-panel-note">支持 Prompt Caching 自动命中与显式写入统计</span>' +
                            '</div>' +
                            '<div class="us-breakdown-grid">' +
                                '<div class="us-break-card">' +
                                    '<span>输入 (Prompt)</span>' +
                                    '<strong>' + formatNumber(totals.input) + '</strong>' +
                                '</div>' +
                                '<div class="us-break-card">' +
                                    '<span>输出 (Completion)</span>' +
                                    '<strong>' + formatNumber(totals.output) + '</strong>' +
                                '</div>' +
                                '<div class="us-break-card">' +
                                    '<span>缓存读取 (Cache Read)</span>' +
                                    '<strong>' + formatNumber(totals.cacheRead) + '</strong>' +
                                '</div>' +
                                '<div class="us-break-card">' +
                                    '<span>缓存写入 (Cache Write)</span>' +
                                    '<strong>' + formatNumber(totals.cacheWrite) + '</strong>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +

                        '<!-- 调用明细 Panel -->' +
                        '<div class="us-panel">' +
                            '<div class="us-panel-head">' +
                                '<div>' +
                                    '<span class="us-panel-title">调用明细</span>' +
                                    '<div class="us-panel-note" style="margin-top:2px;">每次模型调用 · 最新在前</div>' +
                                '</div>' +
                            '</div>' +

                            '<!-- 筛选器 -->' +
                            '<div class="us-table-toolbar">' +
                                '<select class="us-select-filter" onchange="UsageStats.setFilter(\'model\', this.value)">' +
                                    '<option value="">全部模型</option>' +
                                    Array.from(allModelsSet).map(m => '<option value="' + m + '"' + (f.model === m ? ' selected' : '') + '>' + m + '</option>').join('') +
                                '</select>' +

                                '<select class="us-select-filter" onchange="UsageStats.setFilter(\'provider\', this.value)">' +
                                    '<option value="">全部提供商</option>' +
                                    Array.from(allProvidersSet).map(p => '<option value="' + p + '"' + (f.provider === p ? ' selected' : '') + '>' + p + '</option>').join('') +
                                '</select>' +

                                '<div class="flex items-center gap-1 text-xs text-gray-500">' +
                                    '<span>输入 ≥</span>' +
                                    '<input type="number" class="us-input-num" placeholder="Token" value="' + (f.minInput || '') + '" onchange="UsageStats.setFilter(\'minInput\', Number(this.value) || 0)">' +
                                '</div>' +

                                '<div class="flex items-center gap-1 text-xs text-gray-500">' +
                                    '<span>输出 ≥</span>' +
                                    '<input type="number" class="us-input-num" placeholder="Token" value="' + (f.minOutput || '') + '" onchange="UsageStats.setFilter(\'minOutput\', Number(this.value) || 0)">' +
                                '</div>' +

                                '<select class="us-select-filter" onchange="UsageStats.setFilter(\'maxRecords\', Number(this.value))">' +
                                    '<option value="100"' + (f.maxRecords === 100 ? ' selected' : '') + '>明细上限 100 条</option>' +
                                    '<option value="500"' + (f.maxRecords === 500 ? ' selected' : '') + '>明细上限 500 条</option>' +
                                    '<option value="1000"' + (f.maxRecords === 1000 ? ' selected' : '') + '>明细上限 1,000 条</option>' +
                                    '<option value="5000"' + (f.maxRecords === 5000 ? ' selected' : '') + '>明细上限 5,000 条</option>' +
                                '</select>' +

                                '<select class="us-select-filter" onchange="UsageStats.setFilter(\'pageSize\', Number(this.value))">' +
                                    '<option value="10"' + (f.pageSize === 10 ? ' selected' : '') + '>10 条/页</option>' +
                                    '<option value="20"' + (f.pageSize === 20 ? ' selected' : '') + '>20 条/页</option>' +
                                    '<option value="50"' + (f.pageSize === 50 ? ' selected' : '') + '>50 条/页</option>' +
                                '</select>' +

                                '<button type="button" class="us-clear-btn" onclick="UsageStats.clearFilters()">清除筛选</button>' +
                            '</div>' +

                            '<!-- 表格 -->' +
                            '<div class="us-table-wrap">' +
                                '<table class="us-table">' +
                                    '<thead>' +
                                        '<tr>' +
                                            '<th>时间</th>' +
                                            '<th>响应耗时</th>' +
                                            '<th>输入</th>' +
                                            '<th>输出</th>' +
                                            '<th>缓存率</th>' +
                                            '<th>模型</th>' +
                                            '<th>思考程度</th>' +
                                        '</tr>' +
                                    '</thead>' +
                                    '<tbody>' +
                                        tableRowsHtml +
                                    '</tbody>' +
                                '</table>' +
                            '</div>' +

                            '<!-- 分页器 -->' +
                            '<div class="us-pager">' +
                                '<div>第 ' + curPage + ' / ' + totalPages + ' 页 · 共 ' + totalFiltered + ' 条记录</div>' +
                                '<div class="us-page-btns">' +
                                    '<button type="button" class="us-page-btn" onclick="UsageStats.setPage(' + (curPage - 1) + ')"' + (curPage <= 1 ? ' disabled' : '') + '>上一页</button>' +
                                    '<button type="button" class="us-page-btn" onclick="UsageStats.setPage(' + (curPage + 1) + ')"' + (curPage >= totalPages ? ' disabled' : '') + '>下一页</button>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
        },

        setRange(range) {
            this._currentRange = range;
            this._filters.currentPage = 1;
            this.fetchServerStats();
        },

        setScope(scope) {
            this._currentScope = scope;
            this._filters.currentPage = 1;
            this.fetchServerStats();
        },

        setFilter(key, val) {
            this._filters[key] = val;
            this._filters.currentPage = 1;
            this.renderDashboard();
        },

        clearFilters() {
            this._filters.model = '';
            this._filters.provider = '';
            this._filters.minInput = 0;
            this._filters.minOutput = 0;
            this._filters.currentPage = 1;
            this.renderDashboard();
        },

        setPage(page) {
            this._filters.currentPage = page;
            this.renderDashboard();
        },

        // Tooltip 浮动提示
        _getTipEl() {
            let tip = document.getElementById('usGlobalTooltip');
            if (!tip) {
                tip = document.createElement('div');
                tip.id = 'usGlobalTooltip';
                tip.className = 'us-tooltip';
                document.body.appendChild(tip);
            }
            return tip;
        },

        showHeatTip(e, date, tokens, calls) {
            const tip = this._getTipEl();
            tip.innerHTML = '<strong>' + date + '</strong><br>Token 用量: ' + formatExact(tokens) + '<br>调用轮次: ' + calls + ' 轮';
            tip.style.left = e.clientX + 'px';
            tip.style.top = e.clientY + 'px';
            tip.classList.add('is-visible');
        },

        showBarTip(e, date, totalTokens, byModelEnc) {
            const tip = this._getTipEl();
            let details = '';
            try {
                const parsed = JSON.parse(decodeURIComponent(byModelEnc));
                let list = [];
                if (Array.isArray(parsed)) {
                    list = parsed.map(m => '<div>' + (m.key || m.model) + ': ' + formatNumber(m.tokens || 0) + '</div>');
                } else if (parsed && typeof parsed === 'object') {
                    list = Object.keys(parsed).map(k => '<div>' + k.replace(/^(openai|google|deepseek-official|cpa|anthropic|minimax|xai)\//, '') + ': ' + formatNumber(parsed[k] || 0) + '</div>');
                }
                details = list.join('');
            } catch (err) {}

            tip.innerHTML = '<strong>' + date + '</strong><br>总计: ' + formatExact(totalTokens) + ' tokens<hr style="margin:4px 0;border-color:var(--us-border);">' + (details || '无调用');
            tip.style.left = e.clientX + 'px';
            tip.style.top = e.clientY + 'px';
            tip.classList.add('is-visible');
        },

        hideTip() {
            const tip = document.getElementById('usGlobalTooltip');
            if (tip) tip.classList.remove('is-visible');
        },

        // 导出 CSV
        exportCSV() {
            const analytics = this.getAggregatedData();
            const records = analytics ? analytics.records : [];

            if (!records || !records.length) {
                if (typeof showToast === 'function') showToast('暂无可导出的使用统计数据', 'warning');
                return;
            }

            const headers = ['ID', '时间', '日期', '会话ID', '模型', '提供商', '响应耗时(ms)', '输入Tokens', '输出Tokens', '总Tokens', '缓存读取', '缓存写入', '思考程度'];
            const rows = records.map(r => {
                const tks = r.tokens || {};
                return [
                    r.id || '',
                    new Date(r.timestamp || r.time || Date.now()).toISOString(),
                    r.date || formatDate(r.timestamp || r.time || Date.now()),
                    '"' + (r.chatId || '').replace(/"/g, '""') + '"',
                    '"' + (r.model || '').replace(/"/g, '""') + '"',
                    r.provider || '',
                    r.durationMs || 0,
                    tks.input || 0,
                    tks.output || 0,
                    tks.total || 0,
                    tks.cacheRead || 0,
                    tks.cacheWrite || 0,
                    '"' + (r.effort || '').replace(/"/g, '""') + '"'
                ];
            });

            const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'oneapichat_usage_stats_' + formatDate(Date.now()) + '.csv';
            a.click();
            URL.revokeObjectURL(url);
            if (typeof showToast === 'function') showToast('使用统计 CSV 导出成功', 'success');
        },

        // 导出 JSON
        exportJSON() {
            const analytics = this.getAggregatedData();
            const records = analytics ? analytics.records : [];

            if (!records || !records.length) {
                if (typeof showToast === 'function') showToast('暂无可导出的使用统计数据', 'warning');
                return;
            }

            const jsonStr = JSON.stringify({
                app: 'OneAPIChat',
                exportedAt: new Date().toISOString(),
                totalRecords: records.length,
                records: records
            }, null, 2);

            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'oneapichat_usage_stats_' + formatDate(Date.now()) + '.json';
            a.click();
            URL.revokeObjectURL(url);
            if (typeof showToast === 'function') showToast('使用统计 JSON 导出成功', 'success');
        }
    };

    // 全局暴露
    window.UsageStats = UsageStats;
    window.openUsageStatsModal = () => UsageStats.openModal();
    window.closeUsageStatsModal = () => UsageStats.closeModal();
    window.recordUsageStats = (entry) => UsageStats.record(entry);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => UsageStats.init());
    } else {
        UsageStats.init();
    }
})();
