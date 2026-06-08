// markdown.js — Markdown 渲染引擎 v1.0 (Phase 1 拆分自 main.js)
// 流式渲染、MarkdownRenderer 缓存、ChartRenderer (Mermaid)

// ==== 流式渲染系统 ====
// ★★★★★ 流式渲染优化 v2: 基于 RAF 的批量渲染 + 平滑滚动系统 ★★★★★
// 参考: ChatGPT UI, Upstash smooth-streaming, Open WebUI rendering patterns
// 核心优化:
//   1. 数据层(textBuffer)与渲染层(DOM)分离
//   2. RAF 批量渲染(16ms对齐显示刷新率),不再是每token触发innerHTML
//   3. 滚动跟随与渲染统一到RAF循环,不再独立setInterval
//   4. marked.parse仅在实际渲染时调用,流式期间保护KaTeX原文

let _streamState = {};  // { chatId: { text, rafId, lastRenderLen, lastTime, bubble } }

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
                isAutoScrolling = false;
                streamingScrollLock = false;
                cancelAnimationFrame(st2.rafId);
                delete _streamState[chatId];
                return;
            }
            // 执行一次渲染
            _flushStreamRender_batched(chatId, st2);
            // 滚动跟随: 用isAutoScrolling锁住程序化滚动(自动释放, 不阻止用户手动滚动)
            if ($.chatBox) {
                isAutoScrolling = true;
                $.chatBox.scrollTop = $.chatBox.scrollHeight;
                userScrolled = false;
                setTimeout(function() { isAutoScrolling = false; }, 200);
            }
            if (isTyping) {
                st2.rafId = requestAnimationFrame(_streamLoop);
            } else {
                // ★ 流结束释放所有锁定
                streamingScrollLock = false;
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
        // ★ 渲染 + 高亮: hljs.highlight() 字符串 API 不受 detached DOM 影响
        var _html = _renderMarkdownWithMath_cached(autoLinkURLs(text), st);
        // ★ 链式输出：前置拼接已保存的 HTML（含分隔线）
        var _chainMsg = chats[chatId] && chats[chatId].messages.find(function(m) { return m.partial && m._chainSavedHtml; });
        if (_chainMsg && _chainMsg._chainSavedHtml) {
            _html = _chainMsg._chainSavedHtml + _html;
            if (st.lastRenderLen > 0 && _chainMsg._chainSegment > (st._chainRenderedSegment || 0)) {
                st._chainRenderedSegment = _chainMsg._chainSegment;
                st.lastRenderLen = 0;
            }
        }
        mb.innerHTML = _html;
        // ★ 代码高亮（DOM方式，只处理新增的未高亮块）
        if (typeof hljs !== 'undefined') {
            try {
                var _blocks = mb.querySelectorAll('pre code[class*="language-"]:not(.hljs)');
                for (var _bi = 0; _bi < _blocks.length && _bi < 20; _bi++) {
                    try { hljs.highlightElement(_blocks[_bi]); } catch(e) {}
                }
            } catch(e) { /* 高亮失败不影响渲染 */ }
        }
        // ★ 隐藏流式渲染中加载失败的图片(模型可能在文本中引用过期的CDN URL)
        mb.querySelectorAll('img').forEach(function(_img) {
            if (!_img._hasOnerror) {
                _img._hasOnerror = true;
                _img.addEventListener('error', function() { this.style.display = 'none'; });
            }
        });
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

// ==== MarkdownRenderer + ChartRenderer ====
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
        var delay = text.length < 200 ? 50 : text.length < 1000 ? 80 : 120;

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
        var pending = this._pending;
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
        var slice = text.slice(0, maxLen);
        for (let i = 0; i < slice.length; i++) {
            var char = slice.charCodeAt(i);
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
        var startTime = performance.now();
        let cacheKey = this._getFingerprint(text);
        let html;

        if (this.cache.has(cacheKey)) {
            html = this.cache.get(cacheKey);
        } else {
            try {
                // ★ 数学公式保护渲染
                html = _renderMarkdownWithMath(text);
                // 管理缓存大小
                if (this.cache.size >= this.cacheSize) {
                    var firstKey = this.cache.keys().next().value;
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

        var elapsed = performance.now() - startTime;
        if (elapsed > 50) console.log(`[Markdown] Render: ${elapsed.toFixed(1)}ms`);
    },

    /**
     * 后处理:代码高亮 + Mermaid + 图片优化
     */
    postRender(container) {
        try { this.highlightCode(container); } catch(e) {}
        try { this.renderMermaid(container); } catch(e) {}
        try { this.optimizeImages(container); } catch(e) {}
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
        var _blocks = container.querySelectorAll('pre code:not(.hljs):not([class*="mermaid"])');
        for (var _i = 0; _i < _blocks.length && _i < 30; _i++) {
            try { hljs.highlightElement(_blocks[_i]); } catch (e) {}
        }
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

// 后处理辅助:渲染完 HTML 后触发代码高亮 + Mermaid 图表 + Code Apply 按钮
function _triggerPostRender(container) {
    if (!container || !MarkdownRenderer) return;
    setTimeout(function() {
        try {
            MarkdownRenderer.postRender(container);
            // ★ 添加代码块 Apply 按钮 (diff viewer)
            if (window.addCodeBlockButtons) window.addCodeBlockButtons(container);
        } catch(e) { /* 静默失败 */ }
    }, 0);
}

// ==================== 图表绘制工具 (AI可调用) ====================
window.ChartRenderer = {
    async render(code) {
        if (!code) return { success: false, error: '代码为空' };
        if (typeof mermaid === 'undefined') return { success: false, error: 'Mermaid未加载' };
        var processed = this.preprocess(code);
        let id = 'chart-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        try {
            var result = await mermaid.render(id, processed);
            return { success: true, svg: result.svg, type: this.detectType(code) };
        } catch (e) {
            return this.handleError(e, code);
        }
    },

    handleError(e, code) {
        var msg = e.message || String(e);
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
        let c = code.trim().toLowerCase();
        var types = [
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
                var formatted = nums.trim().split(/\s+/).filter(n => n).join(', ');
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
        var match = text.match(/```mermaid\n?([\s\S]*?)```/) || text.match(/```\n?([\s\S]*?)```/);
        if (!match) return { success: false, error: '未找到Mermaid代码,请使用 ```mermaid 代码块 ``` 包裹图表代码' };
        let code = match[1].trim();
        var result = await this.render(code);
        if (containerId && result.success) {
            var container = document.getElementById(containerId);
            if (container) container.innerHTML = result.svg;
        }
        return result;
    },

    async renderTo(code, container) {
        if (!container) return { success: false, error: '容器不存在' };
        var result = await this.render(code);
        if (result.success) container.innerHTML = result.svg;
        else container.innerHTML = this.renderError(result);
        return result;
    },

    renderError(result) {
        var typeIcons = { unsupported: '⚠️', syntax: '❌', error: '🚫' };
        var icon = typeIcons[result.type] || '❌';
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

