// markdown.js — Markdown 渲染引擎 v1.0 (Phase 1 拆分自 main.js)
// 流式渲染、MarkdownRenderer 缓存、ChartRenderer (Mermaid)

// ==== 流式渲染系统 ====
// ★★★★★ 流式渲染优化 v3: 增量渲染 — 稳定块只渲染一次, 仅尾部每帧更新 ★★★★★
// 相比 v2 (每帧全量 marked.parse + 整块 innerHTML 重写) 的改进:
//   1. 稳定前缀(以 \n\n 为界的完整块)只渲染一次并追加, 不再反复重解析 → O(n) 而非 O(n²)
//   2. 未闭合构造(代码围栏/$$ 数学块)状态跟踪: 闭合后整块固化, 期间以实时代码预览显示
//   3. 流式图片只创建一次(loading=lazy, decoding=async), 不再每帧销毁重建
//   4. 选区/滚动位置在稳定区不再被 innerHTML 重建破坏
//   5. 流结束 cleanupStreamState 收敛: 增量结构展开为常规 markdown-body 结构(最终态与旧版一致)
//   6. 滚动跟随统一走 scroll-follow.js 的 followToBottom (修复 CSS smooth 冲突)

let _streamState = {};  // { chatId: { text, rafId, lastRenderLen, lastTime, bubble, stableLen, fence, fenceLang, fenceStart, mathOpen, mathStart } }

function applyStreamRender(chatId, fullText) {
    var st = _streamState[chatId];
    if (!st) {
        st = _streamState[chatId] = {
            text: '',
            rafId: null,
            lastRenderLen: 0,
            lastTime: 0,
            bubble: activeBubbleMap[chatId],
            tickCount: 0,
            // ★ 增量渲染状态: 稳定前缀 + 未闭合构造跟踪
            stableLen: 0,       // 已固化渲染的字符数
            fence: null,        // 未闭合代码围栏标记 ('```' / '~~~'), null=无
            fenceLang: '',      // 未闭合围栏的语言
            fenceStart: 0,      // 围栏起始索引(用于闭合后整块固化)
            mathOpen: false,    // 未闭合 $$ 块
            mathStart: 0,       // 数学块起始索引
            autoFenceLogged: false  // 自动包裹 mermaid 日志去重
        };
        // ★ 修复: 流式渲染开始即移除 typing 三点动画 (保 resume 路径不残留)
        if (st.bubble) st.bubble.classList.remove('typing');
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
                // 气泡被移除或流已停止 → 收尾清理(增量→完整渲染收敛 + 移除 streaming 光标)
                cleanupStreamState(chatId);
                return;
            }
            // 执行一次渲染
            _flushStreamRender_batched(chatId, st2);
            // 滚动跟随: 标准ChatGPT模式 — 仅当用户处于底部时自动滚动
            // ★ 统一走 followToBottom (程序滚动三重防误判, 见 scroll-follow.js)
            if ($.chatBox && !userScrolled) {
                followToBottom($.chatBox);
            }
            // 跟随期间隐藏回到底部按钮(用户脱离时由 scroll 监听器显示)
            if ($.chatBox && $.scrollToBottomBtn && !userScrolled) {
                $.scrollToBottomBtn.classList.remove('visible');
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
    if (!bubble.classList.contains('streaming')) bubble.classList.add('streaming');
    var mb = bubble.querySelector('.markdown-body');
    if (!mb) return;
    var prevH = mb.offsetHeight;
    if (prevH > 40) mb.style.minHeight = prevH + 'px';
    try {
        // ★ v3 增量渲染: 稳定块追加一次, 仅尾部每帧更新
        _renderIncremental(mb, st);
    } catch(e) {
        // ★ 增量渲染异常 → 回退整块渲染(保证内容可见)
        try { mb.innerHTML = _renderMarkdownWithMath_cached(autoLinkURLs(text), st); }
        catch(e2) { mb.textContent = text; }
    }
    requestAnimationFrame(function() { mb.style.minHeight = ''; });
}

// ★ 增量渲染核心: markdown-body 拆为 [稳定区 md-stable] + [尾部 md-tail]
//   稳定区只追加不重建(保留 img 节点/选区); 尾部每帧整体替换(仅未完成块, 成本低)
function _renderIncremental(mb, st) {
    var text = st.text;
    var stableEl = mb._mdStableEl, tailEl = mb._mdTailEl;
    if (!stableEl) {
        mb.innerHTML = '';
        stableEl = mb._mdStableEl = document.createElement('div');
        stableEl.className = 'md-stable';
        tailEl = mb._mdTailEl = document.createElement('div');
        tailEl.className = 'md-tail';
        mb.appendChild(stableEl);
        mb.appendChild(tailEl);
    }
    // ★ 文本缩短(think 块闭合/MiniMax 去重会修剪文本) → 重置增量状态
    if (text.length < st.stableLen) {
        st.stableLen = 0;
        st.fence = null; st.fenceLang = ''; st.mathOpen = false;
        stableEl.innerHTML = '';
    }
    // 1) 推进稳定前缀: 新固化的完整块直接 append 到稳定区
    var chunksStart = stableEl.children.length;
    _advanceStable(st, text, stableEl);
    // 2) 尾部渲染(未完成块, 每帧替换)
    var tail = text.slice(st.stableLen);
    var tailHtml = _renderStreamTail(tail, st);
    if (tailEl.innerHTML !== tailHtml) tailEl.innerHTML = tailHtml;
    // 3) 新稳定块后处理: 代码高亮 + 图片懒加载/失败隐藏
    var children = stableEl.children;
    for (var _i = chunksStart; _i < children.length; _i++) {
        _postProcessChunk(children[_i]);
    }
}

// ★ 推进稳定前缀: 以 \n\n 为界、且不处于未闭合围栏/数学块中的完整段可直接固化
//   返回新增的稳定块数(供后处理定位)
function _advanceStable(st, text, stableEl) {
    var pos = st.stableLen;
    var guard = 0;
    while (pos < text.length && guard++ < 100) {
        if (st.fence) {
            // ===== 围栏模式: 找闭合标记, 闭合后整个围栏(含内容)作为单元固化 =====
            // ★ 从开头围栏之后开始搜: pos==stableLen==fenceStart 指向开头 ```,
            //   直接从 pos 搜会匹配到开头围栏本身 → 代码块退化成裸 ``` 文本
            var closeIdx = text.indexOf(st.fence, pos + st.fence.length);
            if (closeIdx === -1) break;                    // 未闭合 → 留在尾部实时预览
            var unitEnd = closeIdx + st.fence.length;
            _appendStableChunk(stableEl, text.slice(st.fenceStart, unitEnd), st);
            st.fence = null; st.fenceLang = '';
            pos = unitEnd;
            st.stableLen = pos;
            continue;
        }
        if (st.mathOpen) {
            // ===== 数学块模式: 找闭合 $$, 闭合后整块固化 =====
            // ★ 同样跳过开头的 $$ (pos 指向 mathStart)
            var closeMath = text.indexOf('$$', pos + 2);
            if (closeMath === -1) break;
            _appendStableChunk(stableEl, text.slice(st.mathStart, closeMath + 2), st);
            st.mathOpen = false;
            pos = closeMath + 2;
            st.stableLen = pos;
            continue;
        }
        // ===== 干净模式: 只消费以 \n\n 结尾的完整段(文本结尾的未完成段留在尾部) =====
        var nl = text.indexOf('\n\n', pos);
        if (nl === -1) break;
        var seg = text.slice(pos, nl);
        if (!seg.trim()) { pos = nl + 2; st.stableLen = pos; continue; }  // 空行跳过
        var scan = _scanSegmentMarkers(seg);
        if (scan.fenceOpen) {
            // 段内开了未闭合围栏 → 固化围栏之前的部分, 剩余交给围栏模式
            var pre = seg.slice(0, scan.fenceStart);
            if (pre.trim()) _appendStableChunk(stableEl, pre, st);
            st.fence = '```';
            st.fenceLang = scan.fenceLang;
            st.fenceStart = pos + scan.fenceStart;
            st.stableLen = st.fenceStart;
            break;
        }
        if (scan.mathOpen) {
            // 段内开了未闭合 $$ → 固化解密之前的干净部分, 剩余交给数学块模式
            var pre2 = seg.slice(0, scan.mathStart);
            if (pre2.trim()) _appendStableChunk(stableEl, pre2, st);
            st.mathOpen = true;
            st.mathStart = pos + scan.mathStart;
            st.stableLen = st.mathStart;
            break;
        }
        // 完整干净段 → 直接固化
        _appendStableChunk(stableEl, seg, st);
        pos = nl + 2;
        st.stableLen = pos;
    }
}

// ★ 段内标记扫描: 检测未闭合的代码围栏(```)和 $$ 数学块(围栏优先于数学)
//   返回: { fenceOpen, fenceStart, fenceLang, mathOpen, mathStart }
function _scanSegmentMarkers(seg) {
    var res = { fenceOpen: false, fenceStart: -1, fenceLang: '', mathOpen: false, mathStart: -1 };
    var i = 0, len = seg.length;
    var inFence = false;
    while (i < len) {
        if (inFence) {
            var close = seg.indexOf('```', i);
            if (close === -1) break;              // 未闭合 → 段末仍在围栏内
            inFence = false;
            i = close + 3;
            continue;
        }
        if (seg[i] === '`' && seg[i+1] === '`' && seg[i+2] === '`') {
            inFence = true;
            res.fenceStart = i;
            var nl = seg.indexOf('\n', i + 3);
            var langEnd = (nl === -1) ? len : nl;
            res.fenceLang = seg.slice(i + 3, langEnd).trim().split(/\s+/)[0] || '';
            i = (nl === -1) ? len : nl;           // 跳到语言行尾
            continue;
        }
        if (seg[i] === '$' && seg[i+1] === '$') {
            if (res.mathStart === -1) res.mathStart = i;
            else res.mathStart = -1;              // 段内闭合
            i += 2;
            continue;
        }
        i++;
    }
    res.fenceOpen = inFence;
    if (res.mathStart >= 0) { res.mathOpen = true; }
    else { res.mathStart = -1; }
    return res;
}

// ★ 尾部渲染: 未闭合围栏 → 实时代码块预览; 否则流式安全渲染(隐藏未闭合公式)
//   超长尾部截断显示(完整文本仍在 st.text, 流结束收敛时全量渲染)
function _renderStreamTail(tail, st) {
    if (!tail) return '';
    if (st.fence) {
        var langAttr = st.fenceLang ? ' class="language-' + escapeHtml(st.fenceLang) + '"' : '';
        return '<pre class="stream-fence"><code' + langAttr + '>' + escapeHtml(tail) + '</code></pre>';
    }
    if (tail.length > 4000) tail = tail.slice(0, 4000);
    var shown = _hideIncompleteMath(tail);
    if (!shown) return '';
    return _renderMarkdownWithMath_cached(shown, st);
}

// ★ 固化一个稳定单元: 渲染为 HTML 并追加到稳定区(块级元素直接成为稳定区子节点)
//   不引入包装 div — finalize 展开时节点直接上移, 结构与整块渲染完全一致
function _appendStableChunk(stableEl, text, st) {
    if (!text || !text.trim()) return null;
    var html = _renderMarkdownWithMath_cached(text, st);
    if (!html) return null;
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var frag = document.createDocumentFragment();
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
    stableEl.appendChild(frag);
    return stableEl.lastElementChild;
}

// ★ 稳定块后处理: 代码高亮(排除 mermaid) + 图片懒加载/失败隐藏
function _postProcessChunk(root) {
    if (!root) return;
    if (typeof hljs !== 'undefined') {
        try {
            var _blocks = root.querySelectorAll('pre code[class*="language-"]:not(.hljs):not([class*="language-mermaid"]):not([class*="language-gantt"]):not([class*="language-dot"])');
            for (var _bi = 0; _bi < _blocks.length && _bi < 20; _bi++) {
                try {
                    var _lang = (_blocks[_bi].className || '').match(/language-(\S+)/);
                    if (_lang && _lang[1] && typeof hljs.getLanguage === 'function' && !hljs.getLanguage(_lang[1])) continue;
                    hljs.highlightElement(_blocks[_bi]);
                } catch(e) {}
            }
        } catch(e) { /* 高亮失败不影响渲染 */ }
    }
    root.querySelectorAll('img').forEach(function(_img) {
        if (!_img.getAttribute('loading')) _img.setAttribute('loading', 'lazy');
        if (!_img.getAttribute('decoding')) _img.setAttribute('decoding', 'async');
        if (!_img._hasOnerror) {
            _img._hasOnerror = true;
            _img.addEventListener('error', function() { this.style.display = 'none'; });
        }
    });
}

// ★ 自动检测未加围栏的 mermaid 代码，补上 ```mermaid ``` 包裹
// 模型有时会输出 mermaid 语法但忘记加代码围栏（尤其是 gantt 图）
function _autoFenceMermaid(text, st) {
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
        // ★ 流式增量渲染下每帧都会触发, 日志只记一次(避免刷屏)
        if (!st || !st.autoFenceLogged) {
            console.log('[Mermaid] 自动包裹未加围栏的 ' + (_match[3] || 'mermaid') + ' 代码块');
            if (st) st.autoFenceLogged = true;
        }
    } else if (_ganttMatch) {
        var _gBody = _ganttMatch[2];
        var _gStart = _ganttMatch.index + _ganttMatch[1].length;
        var _fencedGantt = '\n\n```mermaid\ngantt\n' + _gBody.trimEnd() + '\n```';
        text = text.substring(0, _gStart) + _fencedGantt + text.substring(_gStart + _gBody.length);
        if (!st || !st.autoFenceLogged) {
            console.log('[Mermaid] 自动包裹未加围栏的 gantt 代码块 (title+section 特征)');
            if (st) st.autoFenceLogged = true;
        }
    }
    return text;
}

// ★ 隐藏未闭合的公式(流式时避免原始LaTeX闪烁 → 界面抖动)
// 从左到右扫描 $/$$ 配对, 截断末尾未闭合的公式
// ★ v3: 代码围栏(```)内的 $ 不参与配对 — 修复 bash 命令 $ 被误截断的历史问题
function _hideIncompleteMath(text) {
    var i = 0;
    var cutAt = -1;
    var inDisplay = false, displayOpenAt = -1;
    var inInline = false, inlineOpenAt = -1;
    var inFence = false;

    while (i < text.length) {
        // ★ 围栏优先: ``` 内的 $ 全部跳过
        if (inFence) {
            var _fc = text.indexOf('```', i);
            if (_fc === -1) break;           // 围栏未闭合 → 剩余内容原样保留
            inFence = false;
            i = _fc + 3;
            continue;
        }
        if (i + 2 < text.length && text[i] === '`' && text[i+1] === '`' && text[i+2] === '`') {
            inFence = true;
            i += 3;
            continue;
        }
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
    text = _autoFenceMermaid(text, st);

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

// ★ 流结束时清理RAF状态 + 收敛增量结构(外部调用)
// 收敛: 增量渲染的 [稳定区+尾部] 展开为常规 markdown-body 子节点,
//       保证最终 DOM 结构与整块渲染完全一致(样式/前缀/mermaid 后处理不受影响)
function cleanupStreamState(chatId) {
    var st = _streamState[chatId];
    // ★ 修复: 即使 stream state 已被提前清理, 也确保移除 bubble 上的 typing 类
    //   (resume 路径 JSON 快径可能未创建 _streamState, 但 bubble 仍带 typing)
    if (!st) {
        var _bub = activeBubbleMap[chatId];
        if (_bub && _bub.classList.contains('typing')) _bub.classList.remove('typing', 'gen-active', 'streaming');
        return;
    }
    if (st.rafId) {
        cancelAnimationFrame(st.rafId);
        st.rafId = null;
    }
    try {
        var bubble = st.bubble;
        if (bubble && document.body.contains(bubble)) {
            var mb = bubble.querySelector('.markdown-body');
            if (mb) {
                var stableEl = mb._mdStableEl;
                if (stableEl && st.text) {
                    // 剩余尾部也固化渲染(未以 \n\n 结尾的最后一个段落)
                    var tail = st.text.slice(st.stableLen);
                    if (tail && tail.trim()) _appendStableChunk(stableEl, tail, st);
                    // 展开: 稳定区子节点直接上移为 markdown-body 子节点(保留 DOM 节点, img 不重载)
                    var frag = document.createDocumentFragment();
                    while (stableEl.firstChild) frag.appendChild(stableEl.firstChild);
                    mb.innerHTML = '';
                    mb.appendChild(frag);
                    _postProcessChunk(mb);
                    delete mb._mdStableEl;
                    delete mb._mdTailEl;
                } else if (st.text) {
                    // 未进入增量模式(异常路径) → 整块渲染兜底
                    mb.innerHTML = _renderMarkdownWithMath_cached(autoLinkURLs(st.text), st);
                    _postProcessChunk(mb);
                }
            }
            // ★ 修复 .streaming 光标类泄漏(旧版只加不删) — typing 一并清除,
            //   否则 typing+streaming 同时命中会让等待三点(1.5em 宽)泄漏成粗彩色光标
            bubble.classList.remove('streaming');
            bubble.classList.remove('gen-active');
            bubble.classList.remove('typing');
        }
    } catch (e) { /* 收尾失败不影响主流程 */ }
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
                        followToBottom($.chatBox);
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
            try {
                var _lang = (_blocks[_i].className || '').match(/language-(\S+)/);
                if (_lang && _lang[1] && typeof hljs.getLanguage === 'function' && !hljs.getLanguage(_lang[1])) continue;
                hljs.highlightElement(_blocks[_i]);
            } catch (e) {}
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

