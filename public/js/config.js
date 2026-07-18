// config.js — 配置管理 v1.0 (Phase 3 拆分自 main.js)
// 配置面板 / saveConfig / 用量追踪 / 工具技能开关 / 模型管理

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
        var el = getEl(id);
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

window.onSearchProviderChange = async function() {
    var provider = getVal('searchProvider') || 'duckduckgo';
    // 1. 保存当前 Key 到旧引擎
    var curKey = getVal('searchApiKey') || '';
    var oldProvider = localStorage.getItem('searchProvider') || 'duckduckgo';
    if (oldProvider && oldProvider !== provider && curKey) {
        var oldKeyId = SEARCH_PROVIDER_KEY_MAP[oldProvider];
        if (oldKeyId) localStorage.setItem(oldKeyId, await encrypt(curKey));
    }
    // 2. 切换到新引擎的 Key (优先独立 Key,其次通用 Key)
    var newKeyId = SEARCH_PROVIDER_KEY_MAP[provider];
    var savedProviderKey = newKeyId ? localStorage.getItem(newKeyId) : null;
    if (newKeyId && savedProviderKey) {
        var dk = await decrypt(savedProviderKey);
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

async function loadSearchConfig() {
    setChecked('searchToggle', localStorage.getItem('enableSearch') === 'true');
    setChecked('searchToolCallToggle', localStorage.getItem('searchToolCall') !== 'false');
    setChecked('aiSearchJudgeToggle', localStorage.getItem('aiSearchJudge') !== 'false');
    var ragChecked = localStorage.getItem('ragEnabled') !== 'false';
    setChecked('ragToggle', ragChecked);
    window.RAG_ENABLED = ragChecked;
    // ★ 与 main.js 默认行为一致：未设置/'1' 都视为启用
    setChecked('resumeStreamToggle', localStorage.getItem('__enableResumeStream') !== '0');
    setChecked('proxyToggle', localStorage.getItem('proxyEnabled') === '1');
    setChecked('toolCardToggle', localStorage.getItem('toolCards') !== '0');
    setChecked('anthropicFormatToggle', localStorage.getItem('useAnthropicFormat') === '1');
    setVal('proxyUrl', localStorage.getItem('proxyUrl') || '');
    var _proxyDetails = document.getElementById('proxyConfigDetails');
    if (_proxyDetails) _proxyDetails.style.display = localStorage.getItem('proxyEnabled') === '1' ? 'block' : 'none';
    setVal('aiSearchJudgeModel', localStorage.getItem('aiSearchJudgeModel') || 'deepseek-chat');
    setVal('aiSearchJudgePrompt', localStorage.getItem('aiSearchJudgePrompt') || DEFAULT_CONFIG.aiSearchJudgePrompt);
    setVal('searchProvider', localStorage.getItem('searchProvider') || 'duckduckgo');
    // 优先使用当前引擎的独立Key,否则用通用Key
    var provider = localStorage.getItem('searchProvider') || 'duckduckgo';
    var providerKey = SEARCH_PROVIDER_KEY_MAP[provider];
    var savedProviderKey = providerKey ? localStorage.getItem(providerKey) : null;
    var savedGeneralKey = localStorage.getItem('searchApiKey');
    if (providerKey && savedProviderKey) {
        setVal('searchApiKey', await decrypt(savedProviderKey));
    } else if (savedGeneralKey) {
        setVal('searchApiKey', await decrypt(savedGeneralKey));
    } else {
        setVal('searchApiKey', '');
    }
    // 加载各引擎独立Key
    setVal('searchApiKeyBrave', await decrypt(localStorage.getItem('searchApiKeyBrave') || ''));
    setVal('searchApiKeyGoogle', await decrypt(localStorage.getItem('searchApiKeyGoogle') || ''));
    setVal('searchApiKeyTavily', await decrypt(localStorage.getItem('searchApiKeyTavily') || ''));
    setVal('searchRegion', localStorage.getItem('searchRegion') || '');
    setVal('searchTimeout', localStorage.getItem('searchTimeout') || '30');
    setVal('maxSearchResults', localStorage.getItem('maxSearchResults') || '3');
    setVal('searchType', localStorage.getItem('searchType') || 'auto');
    setChecked('aiSearchTypeToggle', localStorage.getItem('aiSearchTypeToggle') !== 'false');
    setChecked('searchShowPromptToggle', localStorage.getItem('searchShowPrompt') === 'true');
    setChecked('searchAppendToSystem', localStorage.getItem('searchAppendToSystem') !== 'false');

    var timeoutSpan = getEl('searchTimeoutValue');
    if (timeoutSpan) timeoutSpan.textContent = getVal('searchTimeout');
    var resultsSpan = getEl('maxSearchResultsValue');
    if (resultsSpan) resultsSpan.textContent = getVal('maxSearchResults');

    getEl('searchConfigDetails').style.display = getChecked('searchToggle') ? 'block' : 'none';
    getEl('aiSearchJudgeDetails').style.display = getChecked('aiSearchJudgeToggle') ? 'block' : 'none';
    updateSearchButtonState(getChecked('searchToggle'));
}

window.updateSearchParam = (type, val) => {
    if (type === 'timeout') {
        var span = getEl('searchTimeoutValue');
        if (span) span.innerText = val;
    } else if (type === 'results') {
        var span = getEl('maxSearchResultsValue');
        if (span) span.innerText = val;
    }
    // ★ 不自动保存,由"保存配置"按钮统一控制
};

function initFontSize() {
    var sz = localStorage.getItem('fontSize') || '14';
    setVal('fontSize', sz);
    var span = getEl('fontSizeValue');
    if (span) span.innerText = sz;
    var range = getEl('fontSize');
    if (range) range.value = sz;
    document.documentElement.style.setProperty('--chat-font-size', sz + 'px');
}

window.updateFontSize = function(val) {
    var span = getEl('fontSizeValue');
    if (span) span.innerText = val;
    document.documentElement.style.setProperty('--chat-font-size', val + 'px');
    localStorage.setItem('fontSize', val);
    window._scheduleConfigSync();
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
let agentModeToolCallsMap = {};
let sessionUsage = { promptTokens: 0, completionTokens: 0, totalCost: 0, prefixCacheHits: 0, toolCalls: 0, approvalsGranted: 0, approvalsRejected: 0, cacheHitTokens: 0, cacheMissTokens: 0 };

// ==================== 增强用量追踪 ====================
/** 按工具分类统计调用次数 */
const toolCallStats = (function() {
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
const usageVisualizer = {
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

// ==================== 工具/技能启用开关管理 ====================
// 默认禁用列表(高危工具默认关)

// ★ SVG 图标工厂 (Feather-style 24x24 stroke)
function _icon(name, cls) {
    cls = cls || 'w-4 h-4';
    var icons = {
        brain: '<path d="M12 2a4 4 0 0 1 4 4c0 1.1-.4 2.1-1.2 2.8l-.8.8V12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V9.6l-.8-.8A4 4 0 0 1 12 2z"/><path d="M12 2c-2.2 0-4 1.8-4 4 0 .9.3 1.8.9 2.5"/><path d="M8 15v-1a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1"/><path d="M10 19v-2h4v2"/><circle cx="12" cy="6" r="1"/>',
        wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
        search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
        tv: '<rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>',
        book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
        server: '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
        cpu: '<rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
        cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>',
        edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
        monitor: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
        globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
        users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
        play: '<polygon points="5 3 19 12 5 21 5 3"/>',
        zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
        lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
        credit: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
        gamepad: '<line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><rect x="2" y="6" width="20" height="12" rx="2"/>',
        chevron: '<polyline points="9 18 15 12 9 6"/>',
        box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    };
    return '<svg class="' + cls + '" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (icons[name] || '') + '</svg>';
}

// Skill → icon mapping
function _skillIcon(skillName) {
    var map = {
        'bilibili-content-discovery': 'tv', 'game-redemption-codes': 'gamepad',
        'chaoxing-automation': 'book', 'web-research': 'globe', 'deep-search': 'search',
        'server-management': 'server', 'content-creation': 'image',
        'cloud-file-manager': 'cloud', 'multi-agent-orchestration': 'users',
        'windows-automation': 'monitor', 'browser-automation': 'globe',
    };
    return _icon(map[skillName] || 'box', 'skill-icon');
}

// ── 动态渲染工具面板 ──
window.renderToolPanel = function() {
    var container = document.getElementById('toolToggleContainer');
    if (!container) return;
    var existingRows = container.querySelectorAll('.skill-card, .tools-category-section.dynamic');
    existingRows.forEach(function(r) { r.remove(); });

    var customSkillsEl = document.getElementById('customSkillsList');
    var _agentOn = isAgentToolsActive();
    var _cats = (typeof window.resolveToolCategories === 'function')
        ? window.resolveToolCategories()
        : (typeof _TOOL_CATEGORIES !== 'undefined' ? _TOOL_CATEGORIES : []);

    var rendered = '';
    // Track used tool keys (already shown via categories)
    var _usedKeys = new Set();

    // ═══════════════════════════════════════
    // Section 1: Skills (突出显示)
    // ═══════════════════════════════════════
    rendered += '<div class="skills-section-header">' + _icon('brain', 'skill-section-icon') + ' 技能 (Skills)</div>';
    rendered += '<div class="skills-section-desc">AI 自动匹配并指导何时用何工具</div>';

    if (window._skillsCache && window._skillsCache.length > 0) {
        window._skillsCache.forEach(function(skill) {
            var desc = skill.description || '';
            var key = 'SKILL_' + skill.name;
            var checked = window.isToolEnabled(key) ? ' checked' : '';
            rendered += '<div class="skill-card">';
            rendered += '<div class="skill-card-left">' + _skillIcon(skill.name) + '</div>';
            rendered += '<div class="skill-card-body">';
            rendered += '<div class="skill-card-name">' + skill.name.replace(/-/g, ' ') + '</div>';
            rendered += '<div class="skill-card-desc">' + desc + '</div>';
            rendered += '</div>';
            rendered += '<label class="switch small"><input type="checkbox" id="skill_enabled_' + skill.name + '" data-toolkey="' + key + '"' + checked + '><span class="slider"></span></label>';
            rendered += '</div>';
        });
    } else {
        rendered += '<div class="skill-card muted">加载技能中...</div>';
    }

    // ═══════════════════════════════════════
    // Section 2: Tools (分类折叠)
    // ═══════════════════════════════════════
    rendered += '<div class="tools-section-header" style="margin-top:16px;">' + _icon('wrench', 'skill-section-icon') + ' 工具 (Tools)</div>';

    _cats.forEach(function(cat, catIdx) {
        var _keys = cat.keys;
        if (!_keys || _keys.length === 0) return;
        _keys.forEach(function(k) { _usedKeys.add(k); });

        var _disabled = cat.agentOnly && !_agentOn;
        var _enabledCount = _keys.filter(function(k) { return window.isToolEnabled(k); }).length;
        var catId = 'cat_' + catIdx;

        // Category header bar (collapsible)
        rendered += '<div class="tools-category-section dynamic' + (_disabled ? ' tool-disabled' : '') + '">';
        rendered += '<div class="tools-cat-header" onclick="var s=document.getElementById(\'' + catId + '\');var a=this.querySelector(\'.cat-arrow\');if(s){s.classList.toggle(\'collapsed\');a.classList.toggle(\'rotated\');}">';
        rendered += '<span class="cat-arrow">' + _icon('chevron', 'cat-chevron-icon') + '</span> ';
        rendered += '<span class="tools-cat-label">' + cat.label + '</span>';
        rendered += '<span class="tools-cat-count">' + _enabledCount + '/' + _keys.length + '</span>';
        if (_disabled) rendered += ' <span class="cat-lock-icon">' + _icon('lock', '') + '</span>';
        rendered += '</div>';

        // Tool rows (collapsed by default)
        rendered += '<div id="' + catId + '" class="tools-cat-body collapsed">';
        _keys.forEach(function(key) {
            var label = (typeof _TOOL_LABELS !== 'undefined' ? _TOOL_LABELS[key] : null)
                || (typeof toolRegistry !== 'undefined' && toolRegistry.getSearchHint ? toolRegistry.getSearchHint(key) : '')
                || key.replace(/_/g, ' ');
            var _meta = (typeof toolRegistry !== 'undefined' ? toolRegistry.get(key) : null);
            var isDanger = _meta ? !_meta.isReadOnly : false;
            var warnClass = isDanger ? ' tool-warn' : '';
            var checked = window.isToolEnabled(key) ? ' checked' : '';
            var disabledAttr = _disabled ? ' disabled' : '';
            rendered += '<div class="tool-toggle-row dynamic' + (_disabled ? ' tool-disabled' : '') + '" data-tool="' + key + '">';
            rendered += '<span class="tool-toggle-name' + warnClass + '" title="' + label + '">' + label + '</span>';
            rendered += '<label class="switch small"><input type="checkbox" id="tool_enabled_' + key + '" data-toolkey="' + key + '"' + checked + disabledAttr + '><span class="slider"></span></label>';
            rendered += '</div>';
        });
        rendered += '</div></div>';
    });

    // Insert
    if (customSkillsEl) {
        customSkillsEl.insertAdjacentHTML('beforebegin', rendered);
    } else {
        container.insertAdjacentHTML('beforeend', rendered);
    }

    if (typeof bindToolToggleEvents === 'function') bindToolToggleEvents();
    window.updateToolsActiveCount();
};

window.loadToolToggleStates = async function() {
    // ★ 预加载技能列表后再渲染面板
    if (typeof window.loadSkills === 'function') {
        try { await window.loadSkills(); } catch(e) {}
    }
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
    let html = ''
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
        var resp = await window.proxyFetch(baseUrl + '/chat/completions', {
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

async function saveConfig(showFeedback = false) {
    console.log('[saveConfig] apiKey:', (getVal('apiKey')||'') ? '✅' : '❌');
    try {
        var mainKey = getVal('apiKey') || '';
        var _provider = getEl('baseUrlProvider')?.value || 'custom';
        var _pCfg = API_PROVIDERS[_provider] || API_PROVIDERS.custom;
        // ★ 写独立厂商 key + 通用 apiKey(两者同步)
        localStorage.setItem(_pCfg.keyLS, mainKey === 'not-needed' ? '' : await encrypt(mainKey));
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
    localStorage.setItem('visionApiKey', await encrypt(getVal('visionApiKey') || ''));
    localStorage.setItem('visionProvider', getEl('visionProvider')?.value || 'minimax');
    localStorage.setItem('visionApiKeyOpenAI', await encrypt(getVal('visionApiKeyOpenAI') || ''));
    localStorage.setItem('visionApiUrlOpenAI', getVal('visionApiUrlOpenAI') || 'https://api.openai.com/v1');
    localStorage.setItem('imageModel', getEl('imageModel')?.value || '');
    localStorage.setItem('imageApiKey', await encrypt(getVal('imageApiKey') || ''));
    localStorage.setItem('imageBaseUrl', getVal('imageBaseUrl') || '');
    localStorage.setItem('imageApiKeyOpenrouter', await encrypt(getVal('imageApiKeyOpenrouter') || ''));
    localStorage.setItem('imageBaseUrlOpenrouter', getVal('imageBaseUrlOpenrouter') || '');
    localStorage.setItem('imageProvider', getVal('imageProvider') || 'minimax');
    localStorage.setItem('temp', getVal('temperature') || '0.7');
    localStorage.setItem('tokens', getVal('maxTokens') || '8192');
    localStorage.setItem('stream', getChecked('streamToggle'));
    localStorage.setItem('requestTimeout', getVal('requestTimeout') || '60');
    localStorage.setItem('proxyEnabled', getChecked('proxyToggle') ? '1' : '0');
    localStorage.setItem('proxyUrl', getVal('proxyUrl') || '');
    localStorage.setItem('compress', getChecked('compressToggle'));
    localStorage.setItem('threshold', getVal('compressThreshold') || '10');
    localStorage.setItem('compressModel', getVal('compressModel') || 'auto');
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
    localStorage.setItem('__enableResumeStream', getChecked('resumeStreamToggle') ? '1' : '0');
    localStorage.setItem('aiSearchJudgeModel', getVal('aiSearchJudgeModel') || 'deepseek-chat');
    localStorage.setItem('aiSearchJudgePrompt', getVal('aiSearchJudgePrompt') || DEFAULT_CONFIG.aiSearchJudgePrompt);
    localStorage.setItem('searchModel', getVal('searchModel') || '');
    localStorage.setItem('searchProvider', getVal('searchProvider') || 'duckduckgo');
    var _sak = getVal('searchApiKey') || '';
    localStorage.setItem('searchApiKey', await encrypt(_sak));
    localStorage.setItem('searchApiKeyBrave', await encrypt(getVal('searchApiKeyBrave') || ''));
    localStorage.setItem('searchApiKeyGoogle', await encrypt(getVal('searchApiKeyGoogle') || ''));
    localStorage.setItem('searchApiKeyTavily', await encrypt(getVal('searchApiKeyTavily') || ''));
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
    localStorage.setItem('agentMaxToolRounds', getVal('agentMaxToolRounds') || '1000');
    localStorage.setItem('agentThinkingDepth', getVal('agentThinkingDepth') || 'standard');
    localStorage.setItem('agentSystemPrompt', getVal('agentSystemPrompt') || DEFAULT_CONFIG.agentSystemPrompt);
    // ★ TTS 语音合成配置
    localStorage.setItem('ttsProvider', getVal('ttsProvider') || 'minimax');
    localStorage.setItem('ttsApiKey', await encrypt(getVal('ttsApiKey') || ''));
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
    // ★ 保存后延迟刷新模型列表(避免和保存 toast 冲突),去重重复调用
    if (getVal('baseUrl') && getVal('apiKey')) {
        if (window.__fetchModelsTimer) clearTimeout(window.__fetchModelsTimer);
        window.__fetchModelsTimer = setTimeout(function() { fetchModels(true).catch(function(){}); }, 1500);
    }
    // ★ 配置变更后立即同步到服务器(按用户隔离)
    if (localStorage.getItem('authToken')) {
        saveConfigToServer();  // 立即执行,不延时
        // Broadcast config change to other browsers via SSE
        window._broadcastEvent('config:changed', { ts: Date.now() });
    }
}

// ★ 代理设置
window.toggleProxy = function() {
    var enabled = getChecked('proxyToggle');
    localStorage.setItem('proxyEnabled', enabled ? '1' : '0');
    localStorage.setItem('proxyUrl', getVal('proxyUrl') || '');
    var details = document.getElementById('proxyConfigDetails');
    if (details) details.style.display = enabled ? 'block' : 'none';
    // ★ 清空 CORS 域名缓存: 代理开关变化后重新尝试直连
    window._corsBlockedDomains = {};
    window.saveConfig();
};

// ★ thinking 模式 — 仅在 MiniMax 模型时显示
function _updateThinkingVisibility() {
    var _tl = getEl('thinkingModeRow');
    if (!_tl) return;
    var _m = (getVal('modelSelect') || '').toLowerCase();
    var _bu = (getVal('baseUrl') || '').toLowerCase();
    _tl.style.display = (_m.includes('minimax') || _bu.includes('minimax')) ? '' : 'none';
}
window._saveThinkingMode = function() {
    localStorage.setItem('thinkingMode', getVal('thinkingMode') || 'adaptive');
    saveConfig(false);
};
window.isProxyEnabled = function() {
    return localStorage.getItem('proxyEnabled') === '1';
};
window.getProxyUrl = function() {
    return localStorage.getItem('proxyUrl') || '';
};

// ★ 代理 fetch — 通过 PHP 代理中继转发请求
window.proxyFetch = async function(targetUrl, options = {}) {
    // ★ 解析相对URL为绝对URL（proxy.php只接受http/https开头的URL）
    if (targetUrl.startsWith('/')) {
        targetUrl = window.location.origin + targetUrl;
    }
    var proxyUrl = window.getProxyUrl();
    var enabled = window.isProxyEnabled();
    var _isLocal = targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1') || targetUrl.includes('localmodels');
    // ★ 同源请求不需要走proxy.php中继
    if (_isLocal || targetUrl.startsWith(window.location.origin)) {
        return fetch(targetUrl, options);
    }

    // ★ 统一 429/5xx 重试(指数退避,最多3次) — 适用于直连和中继两条路径
    async function _fetchWithRetry(_fetchPromise, _label) {
        var _maxRetries = 3;
        var _retryable = [422, 429, 502, 503, 504];  // 参数错误/速率限制/临时服务端错误
        for (var _retry = 0; _retry <= _maxRetries; _retry++) {
            var _resp;
            try { _resp = await _fetchPromise; } catch(_e) {
                if (_retry >= _maxRetries) throw _e;
                await new Promise(function(r){setTimeout(r, 2000)}); continue;
            }
            if ((_retryable.indexOf(_resp.status) === -1) || _retry >= _maxRetries) {
                // ★ 503 重试耗尽: 弹窗询问是否开启代理(每会话仅一次)
                if (_resp.status === 503 && !window.__proxy503Prompted && !(window.isProxyEnabled && window.isProxyEnabled())) {
                    window.__proxy503Prompted = true;
                    setTimeout(function() {
                        if (confirm('🌐 网络请求失败 (503)\n\n服务器不可达,可能是网络限制。\n是否开启代理穿透?\n\n代理 URL: ' + (window.getProxyUrl ? window.getProxyUrl() : '未配置(需先在代理设置中填写)') + '\n\n提示: 模型也可以调用 "toggle_proxy" 工具来开启代理。')) {
                            if (typeof window.toggleProxy === 'function') {
                                setChecked('proxyToggle', true);
                                window.toggleProxy();
                            }
                        }
                    }, 500);
                }
                return _resp;
            }
            var _retryAfter = parseInt(_resp.headers.get('Retry-After') || _resp.headers.get('retry-after')) || (Math.pow(2, _retry) * 2);
            console.warn('[Proxy] ' + _resp.status + ' 错误(' + _label + '), ' + _retryAfter + 's 后重试 (' + (_retry+1) + '/' + _maxRetries + ')');
            await new Promise(function(r) { setTimeout(r, _retryAfter * 1000); });
        }
    }

    // ★ 代理未启用: 优先直连(走浏览器本地网络栈,支持系统代理/VPN)
    //    失败时 fallback 到 proxy.php 中继(绕过CORS)
    // ★ Google API 域名直接走中继 (GFW封锁, 直连必然失败, 节省重试时间)
    var _host = '';
    try { _host = new URL(targetUrl).host; } catch(e) {}
    var _isGoogleAPI = _host && (_host.indexOf('generativelanguage.googleapis.com') >= 0 || _host.indexOf('googleapis.com') >= 0);
    if (_isGoogleAPI && !enabled) {
        window._corsBlockedDomains = window._corsBlockedDomains || {};
        console.log('[Proxy] Google API 域名, 跳過直连走中继 (' + _host + ')');
        window._corsBlockedDomains[_host] = true;
        proxyUrl = '__relay_only__';
    } else if (!enabled || !proxyUrl) {
        // ★ 缓存已知的CORS拦截域名,避免重复直连失败(减少控制台红色错误)
        window._corsBlockedDomains = window._corsBlockedDomains || {};
        if (_host && window._corsBlockedDomains[_host]) {
            // 已知此域名不支持CORS,直接走中继
            proxyUrl = '__relay_only__';
        } else {
            console.log('[Proxy] →', targetUrl.substring(0, 80), '(direct, local proxy)');
            try {
                var _directResp = await _fetchWithRetry(fetch(targetUrl, options), 'direct');
                // ★ 503/502 服务不可达 → 不返回, 走 relay 重试
                if (_directResp.status === 503 || _directResp.status === 502) {
                    console.warn('[Proxy] 直连 ' + _directResp.status + ', 走服务器中继重试');
                    proxyUrl = '__relay_only__';
                    _host && (window._corsBlockedDomains[_host] = true);
                    // fall through to relay below
                } else {
                    return _directResp;
                }
            } catch(_directErr) {
                // ★ 静默处理: CORS/网络错误是预期行为,记录域名避免下次重试
                if (_host) window._corsBlockedDomains[_host] = true;
                console.log('[Proxy] 直连不可用(' + (_host || '?') + '), 走服务器中继');
                // fall through to proxy.php relay
            }
            proxyUrl = '__relay_only__';
        }
    } else if (!/^https?:\/\//.test(proxyUrl) && !/^socks[45]?:\/\//.test(proxyUrl)) {
        proxyUrl = 'http://' + proxyUrl;  // ★ 自动补全协议前缀
    }

    console.log('[Proxy] →', targetUrl.substring(0, 80), enabled ? '(via ' + proxyUrl + ')' : '(relay only)');

    var headers = {};
    if (options.headers) {
        if (options.headers instanceof Headers) {
            options.headers.forEach(function(v, k) { headers[k] = v; });
        } else if (Array.isArray(options.headers)) {
            options.headers.forEach(function(h) { headers[h[0]] = h[1]; });
        } else {
            headers = Object.assign({}, options.headers);
        }
    }

    var body = null;
    if (options.body) {
        body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    var relayBody = {
        url: targetUrl,
        method: options.method || (body ? 'POST' : 'GET'),
        headers: headers,
        body: body,
        proxy: proxyUrl
    };

    return _fetchWithRetry(fetch(SERVER_API_BASE + '/proxy.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(relayBody),
        signal: options.signal
    }), 'relay');
    return _resp;  // fallthrough
};

window.updateDisplayParam = (type, val) => {
    if (type === 'lineHeight') {
        var span = getEl('lineHeightValue');
        if (span) span.innerText = parseFloat(val).toFixed(2);
        document.documentElement.style.setProperty('--chat-line-height', val);
        localStorage.setItem('lineHeight', val);
    } else if (type === 'paragraphMargin') {
        var span = getEl('paragraphMarginValue');
        if (span) span.innerText = parseFloat(val).toFixed(2);
        document.documentElement.style.setProperty('--chat-paragraph-margin', val + 'rem');
        localStorage.setItem('paragraphMargin', val);
    }
    window._scheduleConfigSync();
};

function applyParagraphPrefix(prefix) {
    var container = $.chatMessagesContainer;
    if (!container) return;
    container.classList.remove('paragraph-prefix-dot', 'paragraph-prefix-dash');
    if (prefix === 'dot') container.classList.add('paragraph-prefix-dot');
    else if (prefix === 'dash') container.classList.add('paragraph-prefix-dash');
}

window.updateParagraphPrefix = () => {
};

window.updateMarkdownConfig = () => {
    localStorage.setItem('markdownGFM', getChecked('markdownGFM'));
    localStorage.setItem('markdownBreaks', getChecked('markdownBreaks'));
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
    window._scheduleConfigSync();
};

// ==================== 模型管理 ====================
window.fetchModels = async function (silent) {
    var key = getVal('apiKey');
    var url = getVal('baseUrl');
    var selects = ['modelSelect', 'titleModel', 'searchModel', 'aiSearchJudgeModel']

    selects.forEach(id => {
        var el = getEl(id);
        if (el) el.innerHTML = '<option>加载中...</option>';
    });

    // ★ llama.cpp 本地模型通常不需要 API Key,允许空 key 获取模型列表
    var _provider = getEl('baseUrlProvider')?.value || 'custom';
    var _isLocalModel = _provider === 'llamacpp';
    if (!key && !_isLocalModel) {
        selects.forEach(id => {
            var el = getEl(id);
            if (el) el.innerHTML = '<option>请输入API Key</option>';
        });
        return;
    }

    try {
        var _headers = _isLocalModel ? {} : { Authorization: `Bearer ${key}` };
        var _ctrl = new AbortController();
        var _tid = setTimeout(() => _ctrl.abort(), 8000);  // 8s 超时
        // ★ 非原生 Anthropic URL (如 api.deepseek.com/anthropic) 没有 /models, 用 OpenAI 端点
        var _modelsUrl = url.replace(/\/anthropic\/?$/, '') + '/models';
        var res = await window.proxyFetch(_modelsUrl, { headers: _headers, signal: _ctrl.signal });
        clearTimeout(_tid);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        var data = await res.json();
        var models = data.data || [];
        // ★ 过滤不可通过 REST /chat/completions 调用的模型
        var _badSuffixes = ['live-preview', '-preview', 'bidi', 'realtime', 'generateVideo', 'imagen',
            'embedding', 'text-embedding', 'aqa', 'chirp', 'speech',
            'tts-', '-tts', '-audio-', 'audio-', '-asr', '-stt',
            'music-', '-music', 'whisper', 'dall-e', '-latest', 'experimental'];
        var _badPrefixes = ['embedding-', 'text-embedding-', 'ft:'];
        var _badExact = ['gemini-3.1-flash-live-preview', 'gemini-3.1-pro-live-preview',
            'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'];
        function _isCallableModel(m) {
            var id = (m.id || '').toLowerCase();
            if (_badExact.indexOf(id) >= 0) return false;
            for (var si = 0; si < _badSuffixes.length; si++) {
                if (id.indexOf(_badSuffixes[si]) >= 0) return false;
            }
            for (var pi = 0; pi < _badPrefixes.length; pi++) {
                if (id.indexOf(_badPrefixes[pi]) === 0) return false;
            }
            // 过滤纯数字ID或空ID（通常不是有效聊天模型）
            if (!id || /^\d+$/.test(id)) return false;
            return true;
        }
        models = models.filter(_isCallableModel);
        // ★ 清理模型 ID: 去除 Google API 的 "models/" 前缀, 其他平台的 "publishers/" 等前缀
        models = models.map(function(m) {
            var cleanId = (m.id || '').replace(/^(models|publishers)\//, '');
            return { id: cleanId, label: m.id || cleanId, ...m };
        });
        var modelOptions = models.map(m => `<option value="${m.id}">${m.id}</option>`).join('');

        var mainSelect = getEl('modelSelect');
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
            var sel = getEl(id);
            if (!sel) return;
            var curMainModel = getVal('modelSelect') || 'deepseek-v4-flash';
            var mainLabel = models.find(m => m.id === curMainModel)?.label || curMainModel;
            var placeholder = '<option value="">同主模型 (' + mainLabel + ')</option>'
            sel.innerHTML = placeholder + modelOptions;
            var saved = localStorage.getItem(id);
            if (saved && models.some(m => m.id === saved)) sel.value = saved;
            else sel.value = '';  // 默认空=同步主模型
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
            var ctx = m.context_length || 1000000;
            var id = (m.id || '').toLowerCase();
            if (m.id && (m.id.startsWith('deepseek-v4') || m.id.includes('deepseek') && m.id.includes('v4'))) {
                ctx = 1000000;
            }
            // ★ MiniMax M3: 1M 上下文，API 可能返回保守值
            if (id.includes('minimax-m3')) {
                ctx = 1000000;
            }
            modelContextLength[m.id] = ctx;
            var maxOut = m.max_tokens || m.maxTokens || 0;
            // ★ MiniMax M3: 1M（API 不支持会自动回退）
            if (id.includes('minimax-m3')) {
                maxOut = 1000000;
            }
            if (!maxOut) {
                if (id.includes('deepseek-v4')) maxOut = 1000000;
                else if (id.includes('deepseek-chat')) maxOut = 1000000;
                else if (id.includes('deepseek-reasoner')) maxOut = 1000000;
                else if (id.includes('minimax-m2')) maxOut = 1000000;
                else if (id.includes('minimax')) maxOut = 1000000;
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
            var cur = parseInt(getVal('maxTokens')) || 8192;
            if (cur > max) {
                setVal('maxTokens', max);
                setVal('maxTokensInput', max);
                        }
        }
    } catch (e) {
        if (silent) throw e;
        var _e = e.message || '';
        // 超时不弹 toast（静默失败）
        if (e.name === 'AbortError' || _e.includes('timeout') || _e.includes('abort')) return;
        if (_e.includes('401') || _e.includes('403')) showToast('API Key 无效 (401)', 'error');
        else if (_e.includes('404')) showToast('URL 不正确 (404)', 'error');
        else if (_e.includes('Failed to fetch') || _e.includes('NetworkError')) return;  // 网络不通也静默
        else showToast('模型列表加载失败', 'error');
    }
};

window.refreshModels = async function (e) {
    var btn = e?.target.closest('button');
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

// ═══════════════════════════════════════════════════════
// API Key 管理
// ═══════════════════════════════════════════════════════

window._apiKeysServerBase = (typeof SERVER_API_BASE !== 'undefined') ? SERVER_API_BASE : '/oneapichat/api';

window.loadApiKeys = function() {
    var token = localStorage.getItem('authToken');
    var listEl = document.getElementById('apiKeysList');
    var countEl = document.getElementById('apiKeysCount');
    if (!listEl || !countEl) return;

    if (!token) {
        listEl.innerHTML = '<div style="font-size:11px;color:#9ca3af;padding:4px;">登录后可管理 API 密钥</div>';
        countEl.textContent = '';
        return;
    }

    fetch(window._apiKeysServerBase + '/api_keys.php?action=list&auth_token=' + encodeURIComponent(token))
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                listEl.innerHTML = '<div style="font-size:11px;color:#ef4444;padding:4px;">加载失败: ' + (data.error || '未知错误') + '</div>';
                return;
            }
            var keys = data.keys || [];
            countEl.textContent = keys.length ? '(' + keys.length + ')' : '';
            if (keys.length === 0) {
                listEl.innerHTML = '<div style="font-size:11px;color:#9ca3af;padding:4px;">暂无 API 密钥</div>';
                return;
            }
            var html = '';
            keys.forEach(function(k) {
                var lastUsed = k.last_used_at ? new Date(k.last_used_at).toLocaleString() : '从未使用';
                html += '<div class="api-key-item" style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;margin:4px 0;background:#f9fafb;border-radius:6px;font-size:12px;">' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div style="font-weight:500;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (k.name || '未命名') + '</div>' +
                        '<div style="color:#9ca3af;font-family:monospace;font-size:10px;">' + (k.key_prefix || '') + '...' + '</div>' +
                        '<div style="color:#9ca3af;font-size:10px;">创建: ' + new Date(k.created_at).toLocaleDateString() + ' | 最后使用: ' + lastUsed + '</div>' +
                    '</div>' +
                    '<button onclick="window.revokeApiKey(\'' + k.id + '\')" title="撤销此密钥" style="flex-shrink:0;margin-left:8px;padding:3px 8px;font-size:11px;color:#ef4444;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;cursor:pointer;white-space:nowrap;">撤销</button>' +
                '</div>';
            });
            listEl.innerHTML = html;
        })
        .catch(function(e) {
            listEl.innerHTML = '<div style="font-size:11px;color:#ef4444;padding:4px;">加载失败</div>';
        });
};

window.showCreateApiKeyDialog = function() {
    var token = localStorage.getItem('authToken');
    if (!token) { showToast('请先登录', 'error'); return; }

    var name = prompt('请输入 API 密钥名称（用于识别用途，如 "ChatBox" 或 "My App"）:', '');
    if (name === null) return;
    if (!name.trim()) { showToast('名称不能为空', 'error'); return; }

    fetch(window._apiKeysServerBase + '/api_keys.php?action=create&auth_token=' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (!data.success) {
            showToast('创建失败: ' + (data.error || '未知错误'), 'error');
            return;
        }
        window._pendingApiKey = data.key;
        window._showApiKeyModal(data.key);
        window.loadApiKeys();
    })
    .catch(function(e) {
        showToast('创建失败: 网络错误', 'error');
    });
};

// 动态创建 API Key 弹窗（附加到 body，类似工具审批弹窗）
window._showApiKeyModal = function(key) {
    // 移除旧弹窗
    var old = document.getElementById('apiKeyDialogOverlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'apiKeyDialogOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);';
    overlay.onclick = function(e) { if (e.target === overlay) window.closeApiKeyDialog(); };

    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:16px;box-shadow:0 25px 50px rgba(0,0,0,0.25);width:100%;max-width:420px;padding:24px;margin:16px;max-height:90vh;overflow-y:auto;border:1px solid #e5e7eb;';
    // 暗色模式检测
    if (document.documentElement.classList.contains('dark')) {
        card.style.background = '#1f2937';
        card.style.borderColor = '#374151';
    }

    card.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
            '<h3 style="font-size:18px;font-weight:700;margin:0;display:flex;align-items:center;gap:8px;color:' + (document.documentElement.classList.contains('dark') ? '#f3f4f6' : '#1f2937') + ';">' +
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>' +
                '🔑 API 密钥已创建' +
            '</h3>' +
            '<button id="apiKeyCloseBtn" style="background:none;border:none;cursor:pointer;padding:4px;border-radius:50%;display:flex;align-items:center;color:#9ca3af;">' +
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>' +
            '</button>' +
        '</div>' +
        '<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:12px 16px;margin-bottom:16px;">' +
            '<p style="font-size:13px;color:#92400e;font-weight:600;margin:0 0 4px;">⚠️ 请立即复制并保存此密钥</p>' +
            '<p style="font-size:12px;color:#b45309;margin:0;">关闭此窗口后将无法再次查看完整密钥。</p>' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
            '<label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">密钥名称</label>' +
            '<p style="font-size:14px;font-weight:500;margin:2px 0 0;color:' + (document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#374151') + ';">' + (key.name || '-') + '</p>' +
        '</div>' +
        '<div style="margin-bottom:16px;">' +
            '<label style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">完整密钥</label>' +
            '<div style="margin-top:4px;display:flex;align-items:center;gap:8px;background:#f9fafb;border:1px solid #d1d5db;border-radius:8px;padding:10px 12px;">' +
                '<code style="flex:1;font-size:12px;font-family:monospace;word-break:break-all;user-select:all;color:' + (document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#1f2937') + ';background:transparent;">' + key.full_key + '</code>' +
                '<button id="apiKeyCopyBtn" style="flex-shrink:0;padding:6px 12px;font-size:12px;font-weight:500;color:#fff;background:#6366f1;border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap;">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
                    '复制' +
                '</button>' +
            '</div>' +
        '</div>' +
        '<div style="font-size:11px;color:#9ca3af;margin-bottom:16px;">密钥前缀: <code style="font-family:monospace;">' + (key.key_prefix || '') + '...</code></div>' +
        '<button id="apiKeyDoneBtn" style="width:100%;padding:10px 16px;font-size:14px;font-weight:500;color:#374151;background:#f3f4f6;border:1px solid #d1d5db;border-radius:12px;cursor:pointer;">我已保存，关闭</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // 事件绑定
    document.getElementById('apiKeyCloseBtn').onclick = window.closeApiKeyDialog;
    document.getElementById('apiKeyDoneBtn').onclick = window.closeApiKeyDialog;
    document.getElementById('apiKeyCopyBtn').onclick = function() {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(key.full_key).then(function() {
                showToast('✅ 已复制到剪贴板', 'success');
            }).catch(function() {
                var ta = document.createElement('textarea'); ta.value = key.full_key;
                ta.style.position = 'fixed'; ta.style.left = '-9999px';
                document.body.appendChild(ta); ta.select();
                document.execCommand('copy'); document.body.removeChild(ta);
                showToast('✅ 已复制到剪贴板', 'success');
            });
        } else {
            var ta = document.createElement('textarea'); ta.value = key.full_key;
            ta.style.position = 'fixed'; ta.style.left = '-9999px';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
            showToast('✅ 已复制到剪贴板', 'success');
        }
    };
};

window.closeApiKeyDialog = function() {
    var overlay = document.getElementById('apiKeyDialogOverlay');
    if (overlay) overlay.remove();
    window._pendingApiKey = null;
};

window.copyApiKeyDialogKey = function() {
    var overlay = document.getElementById('apiKeyDialogOverlay');
    if (!overlay) return;
    var codeEl = overlay.querySelector('code');
    var key = codeEl ? codeEl.textContent : '';
    if (!key) return;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(key).then(function() {
            showToast('✅ 已复制到剪贴板', 'success');
        }).catch(function() { showToast('复制失败', 'error'); });
    } else {
        var ta = document.createElement('textarea'); ta.value = key;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        showToast('✅ 已复制到剪贴板', 'success');
    }
};

window.revokeApiKey = function(keyId) {
    var token = localStorage.getItem('authToken');
    if (!token) return;
    if (!confirm('确定要撤销此 API 密钥吗？使用该密钥的所有应用将立即无法连接。')) return;

    fetch(window._apiKeysServerBase + '/api_keys.php?action=revoke&auth_token=' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_id: keyId })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            showToast('API 密钥已撤销', 'success');
            window.loadApiKeys();
        } else {
            showToast('撤销失败: ' + (data.error || '未知错误'), 'error');
        }
    })
    .catch(function(e) {
        showToast('撤销失败: 网络错误', 'error');
    });
};

window.copyApiKeyToClipboard = function(key) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(key).then(function() {
            showToast('✅ 已复制到剪贴板', 'success');
        }).catch(function() {
            fallbackCopy(key);
        });
    } else {
        fallbackCopy(key);
    }
    function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showToast('✅ 已复制到剪贴板', 'success'); }
        catch(e) { showToast('复制失败，请手动复制', 'error'); }
        document.body.removeChild(ta);
    }
};

// 页面加载后自动加载 API Keys（延迟等待登录状态就绪）
setTimeout(function() { window.loadApiKeys(); }, 2000);

// 监控设置面板打开状态，刷新 API Keys
document.addEventListener('DOMContentLoaded', function() {
    var apiSection = document.getElementById('apiKeysSection');
    if (apiSection) {
        apiSection.addEventListener('toggle', function() {
            if (apiSection.open) window.loadApiKeys();
        });
    }
    // 也监听整个面板的显示
    var cp = document.getElementById('configPanel');
    if (cp) {
        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
                if (m.type === 'attributes' && m.attributeName === 'class') {
                    if (!cp.classList.contains('hidden-panel')) {
                        window.loadApiKeys();
                    }
                }
            });
        });
        observer.observe(cp, { attributes: true, attributeFilter: ['class'] });
    }
});


