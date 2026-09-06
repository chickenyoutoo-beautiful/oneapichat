"""loop_guard.py — 子代理死循环检测 (与前端 loop-guard.js 同策略)

小参数模型易陷入工具复读/振荡死循环白白消耗 token。
检测维度: ①工具重复调用(跨轮同名称+同参数) ②工具振荡(A/B 反复切换)
          ③连续纯工具轮(只调工具无正文) ④文本复读(输出无限重复) ⑤无进展输出
处理: record_tool_call 返回 'skip' → 调用方注入提示并强制总结轮;
      record_round 返回 'abort' → 调用方直接终止;
      feed_text 返回原因文案 → 调用方追加并压缩轮次。
"""
import json
import re

_VOLATILE_KEY = re.compile(r'^(time|now|timestamp|ts|nonce|random|seed|req_?id|request_?id|_ts|_t|sign|sig)$', re.I)
_TS_VALUE = re.compile(r'^\d{10,13}$')
_ISO_VALUE = re.compile(r'^20\d{2}-\d{2}-\d{2}T')

# ★ 可安全重复的幂等/只读工具集合。
# exec/server_python/server_file_op 可能写文件、启动任务或修改状态，不得按名称宽泛豁免。
_IDEMPOTENT_TOOLS = {
    'server_file_read', 'server_file_grep', 'server_file_search',
    'db_query', 'web_search', 'web_fetch', 'analyze_image',
    'memory_search', 'memory_get', 'memory_list', 'get_current_time', 'get_weather',
}


def _clean(v):
    """递归剥离 volatile 字段(时间戳/随机数/请求ID), 键排序。"""
    if isinstance(v, dict):
        out = {}
        for k in sorted(v.keys()):
            if _VOLATILE_KEY.match(k):
                continue
            val = v[k]
            if isinstance(val, str) and (_TS_VALUE.match(val) or _ISO_VALUE.match(val)):
                continue
            cv = _clean(val)
            if cv is not None:
                out[k] = cv
        return out
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def normalize_tool_args(args):
    """规范化参数 → 稳定指纹。args 为 dict 或 str。数字与字符串不互转。"""
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            return args
    if not isinstance(args, dict):
        try:
            return json.dumps(args)
        except Exception:
            return str(args)
    try:
        s = json.dumps(_clean(args), sort_keys=True, ensure_ascii=False)
    except Exception:
        return str(args)
    if len(s) > 2000:
        # FNV-1a 64位(双32位混合), 确定性指纹
        h1 = 0x811c9dc5
        h2 = 0x811c9dc5 ^ 0x9e3779b9
        for ch in s:
            c = ord(ch)
            h1 = ((h1 ^ c) * 0x01000193) & 0xFFFFFFFF
            h2 = ((h2 ^ ((c << 1) | (c >> 31))) * 0x01000193) & 0xFFFFFFFF
        s = 'h:%x%x' % (h1, h2)
    return s


class LoopGuard:
    def __init__(self, max_repeat=3, osc_window=6, max_tool_only=12,
                 min_text=400, repeat_window=200, repeat_overlap=0.97,
                 min_total=2000, unique_ratio=0.30):
        self.cfg = {
            'max_repeat': max_repeat,
            'osc_window': osc_window,
            'max_tool_only': max_tool_only,
            'min_text': min_text,
            'repeat_window': repeat_window,
            'repeat_overlap': repeat_overlap,
            'min_total': min_total,
            'unique_ratio': unique_ratio,
        }
        self.reset()

    def reset(self):
        self.tool_keys = {}
        self.tool_seq = []
        self.content_text = ''
        self.content_len = 0
        self.consecutive_tool_rounds = 0
        self._content_len_at_last_round = 0
        self.soft_triggers = 0
        self.last_reason = ''

    def record_tool_call(self, name, args):
        """返回 'execute' | 'skip'(重复≥阈值 或 振荡)。skip 时 last_reason 给出原因。"""
        if not name:
            return 'execute'
        key = name + '|' + normalize_tool_args(args)
        self.tool_keys[key] = self.tool_keys.get(key, 0) + 1
        self.tool_seq.append({'name': name, 'content_len': self.content_len})
        if len(self.tool_seq) > 12:
            self.tool_seq = self.tool_seq[-12:]
        # ★ 幂等 server 工具不计入重复/振荡软触发(正常迭代会反复调用),仍由其他检测器保护
        if name in _IDEMPOTENT_TOOLS:
            # 仍记录到 tool_seq(供振荡检测结构使用),但不触发 soft
            return 'execute'
        # 检测器 a: 工具重复
        if self.tool_keys[key] >= self.cfg['max_repeat']:
            self.soft_triggers += 1
            self.last_reason = '相同工具调用重复 %d 次(%s)' % (self.tool_keys[key], name)
            return 'skip'
        # 检测器 b: 工具振荡
        if self._oscillation_active():
            self.soft_triggers += 1
            self.last_reason = '工具在 %s 间反复切换(振荡模式)' % self._oscillation_names()
            return 'skip'
        return 'execute'

    def record_round(self, had_content, tool_count):
        """每轮收尾。返回 '' 或 'abort'(连续纯工具轮≥阈值)。"""
        if had_content or self.content_len > self._content_len_at_last_round:
            self.consecutive_tool_rounds = 0
        elif tool_count > 0:
            self.consecutive_tool_rounds += 1
        # tool_count==0 时(总结轮)不递增,但更新基线
        self._content_len_at_last_round = self.content_len
        if self.consecutive_tool_rounds >= self.cfg['max_tool_only']:
            self.last_reason = '连续 %d 轮只调用工具未输出正文' % self.consecutive_tool_rounds
            return 'abort'
        return ''

    def feed_text(self, text):
        """累积正文 + 复读/无进展检测。返回 '' 或中止原因文案。"""
        # ★ 修复:空文本不重置 content_len,避免续接或纯工具轮时误判
        if text:
            self.content_text = text
            self.content_len = len(self.content_text)
        if self.content_len >= self.cfg['min_text'] and self._has_repetition(self.cfg['repeat_window']):
            self.last_reason = '输出复读同一文本块(连续输出相同内容)'
            return self.last_reason
        if self.content_len >= self.cfg['min_total']:
            uniq = self._unique_blocks(8)
            if uniq < self.cfg['unique_ratio']:
                self.last_reason = '输出超过 %d 字符但有效内容不足 %d%%' % (self.cfg['min_total'], int(self.cfg['unique_ratio'] * 100))
                return self.last_reason
        return ''

    # ---- 内部 ----

    def _has_repetition(self, window_size):
        """周期检测: 尾窗口中存在 8~100 字符重复周期(同相位相同率≥阈值)。"""
        if self.content_len < window_size + 8:
            return False
        tail = self.content_text[-window_size:]
        max_p = min(100, len(tail) // 2)
        need = self.cfg['repeat_overlap']
        for p in range(8, max_p + 1):
            same = total = 0
            fail = False
            for i in range(len(tail) - p):
                if tail[i] == tail[i + p]:
                    same += 1
                total += 1
                if total > 40 and same / total < need - 0.05:
                    fail = True
                    break
            if not fail and total > 0 and same / total >= need:
                return True
        return False

    def _unique_blocks(self, block_size):
        if not self.content_text:
            return 1.0
        seen = set()
        n = 0
        for i in range(0, len(self.content_text) - block_size + 1, block_size):
            seen.add(self.content_text[i:i + block_size])
            n += 1
        return len(seen) / n if n else 1.0

    def _oscillation_active(self):
        w = self.cfg['osc_window']
        if len(self.tool_seq) < w:
            return False
        win = self.tool_seq[-w:]
        if self.content_len != win[0]['content_len']:
            return False
        names = {}
        for t in win:
            names[t['name']] = names.get(t['name'], 0) + 1
        if len(names) != 2:
            return False
        return all(c >= 2 for c in names.values())

    def _oscillation_names(self):
        names = []
        for t in self.tool_seq[-self.cfg['osc_window']:]:
            if t['name'] not in names:
                names.append(t['name'])
        return '/'.join(names)
