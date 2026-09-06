// loop-guard.js — 模型死循环检测与处理 (v1)
// 背景: 小参数模型(垃圾模型)易陷入死循环白白消耗 token。
//   真实案例: 模型单轮复读 76 个相同 video_download(同一磁力) → 79 个重复 aria2 任务。
// 检测维度: ①工具重复调用(跨轮同名称+同参数) ②工具振荡(A/B 反复切换)
//           ③连续纯工具轮(只调工具无正文) ④正文复读(流式输出无限重复)
//           ⑤推理死循环(推理无限增长正文为空) ⑥无进展输出(复读填充)
// 分级处理: soft(注入提示引导模型收敛) → hard(中止请求止损, 由调用方执行)
// 纯 JS 无 DOM 依赖, Node 可直接 vm 加载测试。
(function () {
    'use strict';

    var VOLATILE_KEY_RE = /^(time|now|timestamp|ts|nonce|random|seed|req_?id|request_?id|_ts|_t|sign|sig)$/i;
    var TS_VALUE_RE = /^\d{10,13}$/;
    var ISO_VALUE_RE = /^20\d{2}-\d{2}-\d{2}T/;

    // FNV-1a 32位(确定性, 长参数指纹用; 双字异或混合降低碰撞)
    function fnv1a(str) {
        var h1 = 0x811c9dc5, h2 = 0x811c9dc5 ^ 0x9e3779b9;
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            h1 ^= c; h1 = (h1 * 0x01000193) >>> 0;
            h2 ^= (c << 1) | (c >> 31); h2 = (h2 * 0x01000193) >>> 0;
        }
        return h1.toString(36) + h2.toString(36);
    }

    // 递归剥离 volatile 字段: 时间戳/随机数/请求ID等动态值, 使"语义相同"的参数判同
    function cleanValue(v) {
        if (v === null || v === undefined) return v;
        var t = typeof v;
        if (t === 'object') {
            if (Array.isArray(v)) {
                var arr = [];
                for (var i = 0; i < v.length; i++) {
                    var cv = cleanValue(v[i]);
                    if (cv !== undefined) arr.push(cv);
                }
                return arr;
            }
            var out = {};
            var keys = Object.keys(v).sort();  // 键排序: 键序不同的等价 JSON 判同
            for (var k = 0; k < keys.length; k++) {
                var key = keys[k];
                if (VOLATILE_KEY_RE.test(key)) continue;
                var val = v[key];
                if (typeof val === 'string' && (TS_VALUE_RE.test(val) || ISO_VALUE_RE.test(val))) continue;
                var cv2 = cleanValue(val);
                if (cv2 !== undefined) out[key] = cv2;
            }
            return out;
        }
        return v;
    }

    // 参数规范化 → 稳定指纹。数字与字符串不互转("5" ≠ 5), 宁可漏判不可误判。
    function normalizeToolCallArgs(args) {
        var parsed = args;
        if (typeof args === 'string') {
            try { parsed = JSON.parse(args); } catch (e) { return args; }
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            try { return JSON.stringify(parsed); } catch (e) { return String(parsed); }
        }
        var s;
        try { s = JSON.stringify(cleanValue(parsed)); } catch (e) { return String(parsed); }
        if (s.length > 2000) s = 'h:' + fnv1a(s);  // 超长参数(大段脚本)哈希截断
        return s;
    }

    // ★ 可安全重复的幂等/只读工具集合。
    // 这里只豁免真正不会产生外部副作用的读取/查询；exec/server_python/server_file_op
    // 可能写文件、启动任务或修改状态，不能因为名称宽泛就跳过重复保护。
    var IDEMPOTENT_TOOLS = {
        server_file_read: true, server_file_grep: true, server_file_search: true,
        db_query: true, web_search: true, web_fetch: true, analyze_image: true,
        memory_search: true, memory_get: true, memory_list: true,
        get_current_time: true, get_weather: true
    };

    var DEFAULT_CFG = {
        enabled: true,
        maxRepeat: 3,             // 非幂等工具:相同(名称+规范化参数)计数阈值 → soft
        maxOscillationWindow: 6,  // 振荡窗口
        maxToolOnlyRounds: 12,    // 连续纯工具轮阈值 → hard(Agent 模式需要多轮工具调用,从 6 提高到 12)
        maxSoftTriggers: 2,       // 软触发升级阈值 → hard(模型无视提示时更快止损)
        minTextLen: 400,          // 正文复读起检长度
        repeatWindow: 200,        // 复读滑动窗口
        repeatOverlap: 0.97,      // 复读重叠率阈值(真复读≈100%; 模板文本≈95% 不误报)
        minReasoning: 2000,       // 推理死循环起检长度
        reasoningCap: 8000,       // 推理兜底上限(不依赖复读检测)
        minTotal: 2000,           // 无进展起检长度
        uniqueRatio: 0.30,        // 有效唯一内容比例阈值
        checkCharStep: 150,       // feed 节流: 增量字符
        checkMsStep: 300          // feed 节流: 毫秒
    };

    function LoopGuard(cfg) {
        this.cfg = {};
        var self = this;
        Object.keys(DEFAULT_CFG).forEach(function (k) {
            self.cfg[k] = (cfg && cfg[k] !== undefined) ? cfg[k] : DEFAULT_CFG[k];
        });
        this.reset();
    }

    LoopGuard.prototype.reset = function () {
        this.toolKeys = {};               // key(name|规范化参数) → 计数
        this.toolSeq = [];                // 最近工具调用 [{name, contentLen}]
        this.contentText = '';
        this.contentLen = 0;
        this.reasoningText = '';
        this.reasoningLen = 0;
        this.consecutiveToolRounds = 0;   // 连续纯工具轮
        this._contentLenAtLastRound = 0;
        this.softTriggers = 0;
        this._lastSoftReason = '';
        this._lastHard = null;
        this._lastCheckLen = 0;
        this._lastCheckTime = 0;
    };

    // ===== 正文/推理喂入(流式路径每 chunk 调用, 内部节流检测) =====
    // ★ 修复:空文本不重置 contentLen,避免 RS 续接或纯工具轮时误判为"无正文增长"
    LoopGuard.prototype.feedText = function (text) {
        if (text) {
            this.contentText = text;
            this.contentLen = this.contentText.length;
        }
    };

    LoopGuard.prototype.feedReasoning = function (text) {
        this.reasoningText = text || '';
        this.reasoningLen = this.reasoningText.length;
    };

    // ===== 工具调用记录(每轮 normalizedToolCalls 构建后逐个调用) =====
    LoopGuard.prototype._toolKey = function (name, args) {
        return name + '|' + normalizeToolCallArgs(args);
    };

    LoopGuard.prototype.recordToolCall = function (name, args) {
        if (!name || !this.cfg.enabled) return;
        var key = this._toolKey(name, args);
        this.toolKeys[key] = (this.toolKeys[key] || 0) + 1;
        this.toolSeq.push({ name: name, contentLen: this.contentLen });
        if (this.toolSeq.length > 12) this.toolSeq.shift();
        // ★ 幂等 server 工具不计入重复/振荡软触发(正常迭代会反复调用),仍由其他检测器保护
        if (IDEMPOTENT_TOOLS[name]) return;
        // 检测器 a: 工具重复(≥阈值后每次再犯都计数, 模型无视提示会快速升级)
        if (this.toolKeys[key] >= this.cfg.maxRepeat) {
            this.softTriggers++;
            this._lastSoftReason = '相同工具调用重复 ' + this.toolKeys[key] + ' 次(' + name + ')';
        }
        // 检测器 b: 工具振荡(最近 6 次仅 2 种工具交替且窗口内正文零增长)
        if (this._oscillationActive()) {
            this.softTriggers++;
            this._lastSoftReason = '工具在 ' + this._oscillationNames() + ' 间反复切换(振荡模式)';
        }
    };

    // 每轮收尾: 有正文(本次 recordRound 期间 feedText 有增长)则清零纯工具轮计数
    // ★ 修复:contentLen 未变化但 toolCount==0(模型未要求工具调用)时不递增,避免 RS 续接误判
    LoopGuard.prototype.recordRound = function (toolCount) {
        if (this.contentLen > this._contentLenAtLastRound) {
            this.consecutiveToolRounds = 0;
        } else if (toolCount > 0) {
            this.consecutiveToolRounds++;
        }
        // toolCount==0 时(模型未要求工具调用,本轮是总结轮)不递增,但更新基线
        this._contentLenAtLastRound = this.contentLen;
    };

    // ===== 软跳过查询(工具执行循环内逐调用查询) =====
    // 本次调用前计数 ≥ maxRepeat-1 → 即第 maxRepeat 次调用 → 应跳过
    // ★ 幂等 server 工具永不因"重复"被软跳过(正常迭代会反复调用)
    LoopGuard.prototype.isDuplicateTool = function (name, args) {
        if (IDEMPOTENT_TOOLS[name]) return false;
        var key = this._toolKey(name, args);
        return (this.toolKeys[key] || 0) >= this.cfg.maxRepeat - 1;
    };

    LoopGuard.prototype.oscillationActive = function () {
        return this._oscillationActive();
    };

    // ===== 硬检测: 返回 {level:'hard', type, reason} 或 null =====
    LoopGuard.prototype.check = function () {
        if (!this.cfg.enabled) return null;
        var now = Date.now();
        var totalLen = this.contentLen + this.reasoningLen;
        var deltaLen = totalLen - this._lastCheckLen;
        // 节流: 仅当文本有增长且增量小且间隔短时复用上次结论
        // (文本零增长时每次重算 — 工具类检测(纯工具轮/软升级)不依赖文本增长)
        if (deltaLen > 0 && deltaLen < this.cfg.checkCharStep && now - this._lastCheckTime < this.cfg.checkMsStep) {
            return this._lastHard;
        }
        this._lastCheckLen = totalLen;
        this._lastCheckTime = now;

        var hard = null;
        // 检测器 d: 正文复读
        if (this.contentLen >= this.cfg.minTextLen) {
            if (this._hasRepetition(this.contentText, this.cfg.repeatWindow)) {
                hard = { level: 'hard', type: 'repeat-text', reason: '正文复读同一文本块(连续输出相同内容)' };
            }
        }
        // 检测器 e: 推理死循环(正文为 0 + 推理自身复读; 或兜底上限)
        if (!hard && this.contentLen === 0) {
            if (this.reasoningLen >= this.cfg.minReasoning && this._hasRepetition(this.reasoningText, this.cfg.repeatWindow)) {
                hard = { level: 'hard', type: 'reasoning-loop', reason: '推理内容复读且正文始终为空' };
            } else if (this.reasoningLen >= this.cfg.reasoningCap) {
                hard = { level: 'hard', type: 'reasoning-loop', reason: '推理内容超过 ' + this.cfg.reasoningCap + ' 字符且正文始终为空' };
            }
        }
        // 检测器 f: 无进展(8 字符块唯一率过低 = 复读填充)
        if (!hard && totalLen >= this.cfg.minTotal) {
            if (this._uniqueBlocks((this.contentText || '') + (this.reasoningText || ''), 8) < this.cfg.uniqueRatio) {
                hard = { level: 'hard', type: 'no-progress', reason: '输出超过 ' + this.cfg.minTotal + ' 字符但有效内容不足 ' + Math.round(this.cfg.uniqueRatio * 100) + '%' };
            }
        }
        // 检测器 c: 连续纯工具轮(阈值已从 6 提高到 12,给 Agent 模式更多空间)
        if (!hard && this.consecutiveToolRounds >= this.cfg.maxToolOnlyRounds) {
            hard = { level: 'hard', type: 'tool-only', reason: '连续 ' + this.consecutiveToolRounds + ' 轮只调用工具未输出正文' };
        }
        // 软升级: 模型无视软提示 → 硬中断
        if (!hard && this.softTriggers >= this.cfg.maxSoftTriggers) {
            hard = { level: 'hard', type: 'soft-escalate', reason: '连续 ' + this.softTriggers + ' 次软触发未收敛(模型无视停止提示)' };
        }
        this._lastHard = hard;
        return hard;
    };

    // ===== 查询/辅助 =====
    LoopGuard.prototype.lastSoftTrigger = function () {
        return this._lastSoftReason ? { reason: this._lastSoftReason } : null;
    };

    LoopGuard.prototype.softTriggerCount = function () {
        return this.softTriggers;
    };

    LoopGuard.prototype.stats = function () {
        return {
            toolCalls: this.toolSeq.length,
            contentLen: this.contentLen,
            reasoningLen: this.reasoningLen,
            softTriggers: this.softTriggers,
            consecutiveToolRounds: this.consecutiveToolRounds
        };
    };

    // 周期检测: 尾窗口中存在 8~100 字符的重复周期(同相位相同率 ≥ cfg.repeatOverlap) → 复读。
    // (窗口定位法受 windowSize mod 周期 相位错位影响漏检, 周期检测对任意相位鲁棒)
    LoopGuard.prototype._hasRepetition = function (text, windowSize) {
        if (!text || text.length < windowSize + 8) return false;
        var tail = text.slice(-windowSize);
        var maxP = Math.min(100, Math.floor(tail.length / 2));
        var need = this.cfg.repeatOverlap;
        for (var p = 8; p <= maxP; p++) {
            var same = 0, total = 0, fail = false;
            for (var i = 0; i + p < tail.length; i++) {
                if (tail[i] === tail[i + p]) same++;
                total++;
                if (total > 40 && same / total < need - 0.05) { fail = true; break; }  // 快速失败(留 5% 余量)
            }
            if (!fail && same / total >= need) return true;
        }
        return false;
    };

    // 8 字符块唯一率
    LoopGuard.prototype._uniqueBlocks = function (text, blockSize) {
        if (!text) return 1;
        var set = {}, n = 0, uniq = 0;
        for (var i = 0; i + blockSize <= text.length; i += blockSize) {
            var b = text.substr(i, blockSize);
            n++;
            if (!set[b]) { set[b] = true; uniq++; }
        }
        return n === 0 ? 1 : uniq / n;
    };

    // 最近 maxOscillationWindow 次调用: 恰好 2 种工具各 ≥2 且窗口内正文零增长
    LoopGuard.prototype._oscillationActive = function () {
        var w = this.cfg.maxOscillationWindow;
        if (this.toolSeq.length < w) return false;
        var win = this.toolSeq.slice(-w);
        if (this.contentLen !== win[0].contentLen) return false;
        var names = {}, nameArr = [];
        win.forEach(function (t) {
            if (!names[t.name]) { names[t.name] = 0; nameArr.push(t.name); }
            names[t.name]++;
        });
        if (nameArr.length !== 2) return false;
        return names[nameArr[0]] >= 2 && names[nameArr[1]] >= 2;
    };

    LoopGuard.prototype._oscillationNames = function () {
        var names = [];
        this.toolSeq.slice(-this.cfg.maxOscillationWindow).forEach(function (t) {
            if (names.indexOf(t.name) === -1) names.push(t.name);
        });
        return names.join('/');
    };

    window.LoopGuard = LoopGuard;
    window.normalizeToolCallArgs = normalizeToolCallArgs;
    window.__loopGuardMap = window.__loopGuardMap || {};
})();
