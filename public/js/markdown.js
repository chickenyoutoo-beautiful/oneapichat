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
            // ★ 平滑帧率: 16ms对齐60fps, 积累8字符或超30ms即刷新
            var bytesPending = st2.text.length - st2.lastRenderLen;
            if (bytesPending < 8 && (now - st2.lastTime) < 30) {
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
            // 滚动跟随: 标准ChatGPT模式 — 仅当用户处于底部时自动滚动
            // ★ 位置匹配法: 记录程序化滚动目标, scroll事件中匹配则忽略(防自触发)
            if ($.chatBox && !userScrolled) {
                var _box = $.chatBox;
                var _target = _box.scrollHeight;
                _box.scrollTop = _target;
                window.__lastAutoScrollTarget = _target;  // scroll事件中用于识别
            }
            // 更新浮动按钮
            if ($.chatBox && $.scrollToBottomBtn) {
                var _dist2 = $.chatBox.scrollHeight - $.chatBox.scrollTop - $.chatBox.clientHeight;
                if (_dist2 > 200) $.scrollToBottomBtn.classList.add('visible');
                else $.scrollToBottomBtn.classList.remove('visible');
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
        // ★ 流式过程中不渲染 Mermaid — 保留为代码块，避免渲染中 SVG 突然撑大气泡导致页面抖动
        // 代码高亮正常执行，mermaid 块已被 :not([class*="language-mermaid"]):not([class*="language-gantt"]):not([class*="language-dot"]) 排除
        // 流结束后由 _triggerPostRender 统一批量渲染所有 Mermaid 图表
        // ★ 代码高亮（排除 mermaid — hljs 无此语言模块，会报 WARN）
        if (typeof hljs !== 'undefined') {
            try {
                var _blocks = mb.querySelectorAll('pre code[class*="language-"]:not(.hljs):not([class*="language-mermaid"]):not([class*="language-gantt"]):not([class*="language-dot"])');
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

// ★ 自动检测未加围栏的 mermaid 代码，补上 ```mermaid ``` 包裹
// 模型有时会输出 mermaid 语法但忘记加代码围栏（尤其是 gantt 图）
function _autoFenceMermaid(text) {
    if (!text) return text;
    // ★ 检测不在 ``` 围栏内的 mermaid 块：以 mermaid 关键字开头，缩进，多行
    // 匹配：gantt / pie / graph / flowchart / sequenceDiagram 等关键字开头的段落
    var _mermaidKeywords = 'gantt|pie|graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|mindmap|timeline|gitgraph|xychart-beta|xychart|sankey-beta|block-beta|dot';
    // 检测：title + dateFormat 组合（甘特图无 gantt 关键字开头时的特征）
    var _hasGanttPattern = /\btitle\s+.+\n\s+(dateFormat|axisFormat|section)\s+/i.test(text);
    // 构建正则：不在围栏内的 mermaid 块
    var _bareRe = new RegExp('(^|\\n\\n)(\\s{0,4})(' + _mermaidKeywords + ')\\b', 'i');
    var _match = _bareRe.exec(text);
    var _ganttMatch = _hasGanttPattern ? text.match(/(^|\n\n)(\s{0,4}title\s+[^\n]+\n(?:\s{2,}[^\n]+\n?)+)/i) : null;

    if (_match) {
        // ★ 找到裸 mermaid 块 → 提取整个缩进块并包裹
        var _startIdx = _match.index + _match[1].length;
        var _blockStart = _match[1] + _match[2] + _match[3];
        var _rest = text.substring(_startIdx + _match[2].length + _match[3].length);
        // 提取到下一个空行或文本结束
        var _endMatch = _rest.match(/\n\n(?!\s)/);
        var _blockBody = _endMatch ? _rest.substring(0, _endMatch.index) : _rest;
        var _after = _endMatch ? _rest.substring(_endMatch.index) : '';
        var _fenced = '\n\n```mermaid\n' + _match[3] + _blockBody.trimEnd() + '\n```\n' + _after;
        text = text.substring(0, _startIdx) + _fenced;
        console.log('[Mermaid] 自动包裹未加围栏的 ' + (_match[3] || 'mermaid') + ' 代码块');
    } else if (_ganttMatch) {
        var _gBody = _ganttMatch[2];
        var _gStart = _ganttMatch.index + _ganttMatch[1].length;
        var _fencedGantt = '\n\n```mermaid\ngantt\n' + _gBody.trimEnd() + '\n```';
        text = text.substring(0, _gStart) + _fencedGantt + text.substring(_gStart + _gBody.length);
        console.log('[Mermaid] 自动包裹未加围栏的 gantt 代码块 (title+section 特征)');
    }
    return text;
}

// ★ 隐藏未闭合的公式(流式时避免原始LaTeX闪烁 → 界面抖动)
// 从左到右扫描 $/$$ 配对, 截断末尾未闭合的公式
function _hideIncompleteMath(text) {
    var i = 0;
    var cutAt = -1;
    var inDisplay = false, displayOpenAt = -1;
    var inInline = false, inlineOpenAt = -1;

    while (i < text.length) {
        // 检测 $$ (优先, 因为包含两个$)
        if (i + 1 < text.length && text[i] === '$' && text[i+1] === '$') {
            if (inDisplay) {
                inDisplay = false;           // 闭合块公式
            } else if (!inInline) {
                inDisplay = true;            // 打开块公式
                displayOpenAt = i;
            }
            i += 2;
        } else if (text[i] === '$') {
            // 单个 $ (行内公式)
            if (inInline) {
                inInline = false;            // 闭合行内公式
            } else if (!inDisplay) {
                inInline = true;             // 打开行内公式
                inlineOpenAt = i;
            }
            i++;
        } else {
            i++;
        }
    }

    // 未闭合的公式 → 截断
    if (inInline && inlineOpenAt >= 0) {
        cutAt = inlineOpenAt;
    }
    if (inDisplay && displayOpenAt >= 0) {
        cutAt = (cutAt < 0) ? displayOpenAt : Math.min(cutAt, displayOpenAt);
    }

    if (cutAt >= 0) {
        text = text.substring(0, cutAt);
    }

    return text;
}

// ★ 流式期间: 实时 KaTeX 渲染 + 公式缓存, 避免重复渲染已闭合的公式
// 缓存 key = formula_text → rendered HTML, 只有新公式或变化才调用 katex
function _renderMarkdownWithMath_cached(text, st) {
    if (!text) return '';
    if (!window.marked) return escapeHtml(text).replace(/\n/g, '<br>');

    // ★ 预处理: 检测未加围栏的 mermaid 代码块，自动补上包裹
    text = _autoFenceMermaid(text);

    // ★ 隐藏未闭合公式: 流式时截断末尾不完整的 $...$ 避免 raw LaTeX 闪烁
    text = _hideIncompleteMath(text);

    // ★ 全局公式缓存: 跨流/跨消息共享，避免同一公式反复渲染
    if (!window.__globalMathCache) window.__globalMathCache = {};
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

    // ★ 按 ID 长度降序排列，防止 MATHB0 错误匹配 MATHB10 (前缀碰撞)
    formulas.sort(function(a, b) { return b.id.length - a.id.length; });

    // 渲染公式(带缓存)
    for (var i = 0; i < formulas.length; i++) {
        var fInfo = formulas[i];
        var cacheKey = fInfo.type + ':' + fInfo.formula;
        var rendered = window.__globalMathCache[cacheKey];
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
            window.__globalMathCache[cacheKey] = rendered;
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
    cacheSize: 200,
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
        // ★ mermaid 必须在 highlightCode 之前：先把 gantt/dot/mermaid 代码块转为 .mermaid div，
        // 否则 hljs 对不支持的语言报 WARN
        try { this.renderMermaid(container); } catch(e) {}
        try { this.highlightCode(container); } catch(e) {}
        try { this.optimizeImages(container); } catch(e) {}
    },

    /** 渲染 Mermaid 图表(支持流式实时渲染) */
    renderMermaid(container) {
        if (typeof mermaid === 'undefined') { console.log('[Mermaid] renderMermaid skipped — mermaid 库未加载，等待 _triggerPostRender 重试'); return; }

        // 步骤1: 将 marked 输出的 mermaid 代码块转换为 .mermaid div（含变体）+ 预留高度
        container.querySelectorAll('pre code[class*="language-mermaid"], pre code[class*="language-mer"], pre code[class="language-m"], pre code[class*="language-gantt"], pre code[class*="language-dot"]').forEach(function(codeBlock) {
            if (codeBlock.closest('.mermaid')) return;
            var pre = codeBlock.parentNode;
            var mermaidDiv = document.createElement('div');
            mermaidDiv.className = 'mermaid mermaid-rendering';
            var code = codeBlock.textContent;
            mermaidDiv.textContent = code;
            mermaidDiv.setAttribute('data-original-code', code);
            // ★ 预留高度防抖动：每行 ~24px，min 120px
            var _lineCount = (code.match(/\n/g) || []).length + 1;
            mermaidDiv.style.minHeight = Math.max(120, _lineCount * 24) + 'px';
            pre.parentNode.replaceChild(mermaidDiv, pre);
        });

        // 步骤2: 批量渲染所有 .mermaid div，全部完成后滚到底部
        var mermaidDivs = container.querySelectorAll('.mermaid');
        if (!mermaidDivs.length) return;
        var _pendingRenders = 0;
        console.log('[Mermaid] renderMermaid found', mermaidDivs.length, 'mermaid divs');
        mermaidDivs.forEach(function(div) {
            var code = div.getAttribute('data-original-code') || div.textContent;
            if (!code || div.querySelector('svg')) return;
            var prevCode = div.getAttribute('data-prev-code') || '';
            if (code === prevCode) return;
            div.setAttribute('data-prev-code', code);
            _pendingRenders++;
            window.ChartRenderer.render(code.trim()).then(function(result) {
                if (result.success) {
                    div.innerHTML = result.svg;
                    div.classList.remove('mermaid-rendering');
                    div.style.minHeight = '';
                    console.log('[Mermaid] render success, type:', result.type);
                } else {
                    console.warn('[Mermaid] render failed:', result.message || result.error, 'code preview:', code.substring(0, 60));
                }
            }).catch(function(e) {
                console.error('[Mermaid] render exception:', e.message || e);
            }).finally(function() {
                _pendingRenders--;
                // ★ 所有图渲染完成后，滚到底部（如果用户未手动上滑）
                if (_pendingRenders <= 0 && $.chatBox && !userScrolled && currentChatId) {
                    setTimeout(function() {
                        $.chatBox.scrollTop = $.chatBox.scrollHeight;
                        window.__lastAutoScrollTarget = $.chatBox.scrollHeight;
                    }, 50);
                }
            });
        });
    },

    /**
     * 代码高亮 - 只处理未高亮的代码块
     */
    highlightCode(container) {
        if (typeof hljs === 'undefined') return;
        var _blocks = container.querySelectorAll('pre code:not(.hljs):not([class*="mermaid"]):not([class*="gantt"]):not([class*="dot"])');
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
    // ★ 检查是否有 mermaid 代码块需要渲染（含缩写变体）
    var _hasMermaid = container.querySelector && (
        container.querySelector('pre code[class*="language-mermaid"]') ||
        container.querySelector('pre code[class*="language-mer"]') ||
        container.querySelector('pre code[class="language-m"]') ||
        container.querySelector('pre code[class*="language-gantt"]') ||
        container.querySelector('pre code[class*="language-dot"]') ||
        container.querySelector('.mermaid:not(svg)')
    );
    var _tryRender = function() {
        try {
            MarkdownRenderer.postRender(container);
            if (window.addCodeBlockButtons) window.addCodeBlockButtons(container);
        } catch(e) { /* 静默失败 */ }
    };
    // ★ 如果当前 mermaid 未加载但有 mermaid 块，延迟重试等待加载
    if (_hasMermaid && typeof mermaid === 'undefined') {
        var _retries = 0;
        var _retryTimer = setInterval(function() {
            _retries++;
            if (typeof mermaid !== 'undefined') {
                clearInterval(_retryTimer);
                console.log('[Mermaid] 库加载完成，延迟渲染 (retry=' + _retries + ')');
                _tryRender();
            } else if (_retries > 50) {
                clearInterval(_retryTimer);
                console.warn('[Mermaid] 等待超时，放弃渲染');
            }
        }, 200);
    } else {
        setTimeout(_tryRender, 0);
    }
}

// ==================== 图表绘制工具 (AI可调用) ====================
window.ChartRenderer = {
    async render(code) {
        if (!code) return { success: false, error: '代码为空' };
        if (typeof mermaid === 'undefined') return { success: false, error: 'Mermaid未加载' };
        var processed = this.preprocess(code);
        let id = 'chart-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        // ★ parse() 预检 — 语法错误提前拦截，避免 Mermaid 向 DOM 注入 error-icon CSS
        try {
            await mermaid.parse(processed);
        } catch(parseErr) {
            return this.handleError(parseErr, code);
        }
        try {
            var result = await mermaid.render(id, processed);
            // ★ 剥离 Mermaid 自带的 .error-icon / .error-text 残留
            var cleanSvg = this._stripErrorElements(result.svg);
            return { success: true, svg: cleanSvg, type: this.detectType(code) };
        } catch (e) {
            return this.handleError(e, code);
        }
    },

    _stripErrorElements(svg) {
        if (!svg) return svg;
        return svg
            .replace(/<g[^>]*class="[^"]*error[^"]*"[^>]*>[\s\S]*?<\/g>/gi, '')
            .replace(/<text[^>]*class="[^"]*error[^"]*"[^>]*>[\s\S]*?<\/text>/gi, '');
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
        // ★ Unicode 数学符号清洗 — Mermaid 10.x lexer 无法消化这些字符
        //   mindmap / sankey / class 三种图的 lexer 最严格，触之即崩
        var _type = this.detectType(c);
        if (_type === 'mindmap' || _type === 'sankey' || _type === 'unsupported') {
            var _symMap = [
                ['√','sqrt'],['²','^2'],['³','^3'],['⁴','^4'],['⁵','^5'],
                ['±','+/-'],['×','x'],['÷','/'],
                ['Σ','SUM'],['∫','INT'],['∂','d'],['∇','grad'],
                ['π','pi'],['∞','inf'],['Δ','Delta'],['Ω','Omega'],
                ['α','alpha'],['β','beta'],['γ','gamma'],['δ','delta'],
                ['ε','epsilon'],['ζ','zeta'],['η','eta'],['θ','theta'],
                ['λ','lambda'],['μ','mu'],['ν','nu'],['ξ','xi'],
                ['ρ','rho'],['σ','sigma'],['τ','tau'],['φ','phi'],
                ['ψ','psi'],['ω','omega'],['Ψ','Psi'],['Φ','Phi'],
                ['Γ','Gamma'],['Θ','Theta'],['Λ','Lambda'],
                ['⁻','-'],['⁺','+'],['→','->'],['⇒','=>'],
                ['⟨','<'],['⟩','>'],['⋅','*'],['…','...'],
                ['≤','<='],['≥','>='],['≠','!=']
            ];
            for (var _si = 0; _si < _symMap.length; _si++) {
                c = c.split(_symMap[_si][0]).join(_symMap[_si][1]);
            }
            // 去掉 undefined type 的 unicode 行内点号
            c = c.replace(/•/g, '-');
        }
        // sankey / class: 移除 $ 符号（lexer 会剥离导致语法错误）
        if (_type === 'sankey' || _type === 'class') {
            c = c.replace(/\$/g, '');
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

