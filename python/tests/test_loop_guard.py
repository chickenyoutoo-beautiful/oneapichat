"""loop_guard 死循环检测单测"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.loop_guard import LoopGuard, normalize_tool_args


class TestNormalize(unittest.TestCase):
    def test_strips_volatile(self):
        self.assertEqual(
            normalize_tool_args({'query': 'x', 'ts': 1234567890123, 'nonce': 'abc'}),
            normalize_tool_args({'query': 'x'}),
        )

    def test_key_order_independent(self):
        self.assertEqual(
            normalize_tool_args({'b': 2, 'a': 1}),
            normalize_tool_args({'a': 1, 'b': 2}),
        )

    def test_different_query(self):
        self.assertNotEqual(
            normalize_tool_args({'query': '电影'}),
            normalize_tool_args({'query': '音乐'}),
        )

    def test_str_accepts_json_string(self):
        self.assertEqual(
            normalize_tool_args('{"query": "x"}'),
            normalize_tool_args({'query': 'x'}),
        )

    def test_long_arg_hash_deterministic(self):
        big = 'x' * 3500
        self.assertEqual(
            normalize_tool_args({'script': big}),
            normalize_tool_args({'script': big}),
        )


class TestRepeat(unittest.TestCase):
    def test_repeat_3_times_skip(self):
        g = LoopGuard()
        self.assertEqual(g.record_tool_call('web_search', {'query': 'q'}), 'execute')
        self.assertEqual(g.record_tool_call('web_search', {'query': 'q'}), 'execute')
        self.assertEqual(g.record_tool_call('web_search', {'query': 'q'}), 'skip')
        self.assertIn('重复', g.last_reason)

    def test_repeat_threshold_custom(self):
        g = LoopGuard(max_repeat=5)
        for _ in range(4):
            self.assertEqual(g.record_tool_call('server_python', {'script': 'print(1)'}), 'execute')
        self.assertEqual(g.record_tool_call('server_python', {'script': 'print(1)'}), 'skip')


class TestOscillation(unittest.TestCase):
    def test_ababab_skip(self):
        g = LoopGuard()
        # 参数带序号避免重复检测干扰; 第 6 次调用后振荡窗口 [A,B,A,B,A,B] 成立 → skip
        seq = ['A', 'B', 'A', 'B', 'A', 'B']
        for i, n in enumerate(seq):
            r = g.record_tool_call(n, {'i': i})
            if i == len(seq) - 1:
                self.assertEqual(r, 'skip')
                self.assertIn('振荡', g.last_reason)
            else:
                self.assertEqual(r, 'execute')

    def test_three_tools_no_oscillation(self):
        g = LoopGuard()
        # 参数带序号避免重复检测干扰(振荡只看工具名)
        seq = ['A', 'B', 'C', 'A', 'B', 'C', 'A']
        for i, n in enumerate(seq):
            self.assertEqual(g.record_tool_call(n, {'i': i}), 'execute')

    def test_oscillation_with_content_growth_no_skip(self):
        g = LoopGuard()
        g.feed_text('搜索结果 1: 内容一')
        g.record_tool_call('A', {'q': 1})
        g.record_tool_call('B', {'q': 1})
        g.feed_text('搜索结果 2: 内容二,补充了更多细节信息。')
        g.record_tool_call('A', {'q': 2})
        g.record_tool_call('B', {'q': 2})
        g.record_tool_call('A', {'q': 3})
        self.assertEqual(g.record_tool_call('B', {'q': 3}), 'execute')


class TestToolOnlyRounds(unittest.TestCase):
    def test_6_rounds_abort(self):
        g = LoopGuard()
        for _ in range(5):
            self.assertEqual(g.record_round(had_content=False, tool_count=2), '')
        self.assertEqual(g.record_round(had_content=False, tool_count=2), 'abort')

    def test_content_resets(self):
        g = LoopGuard()
        for _ in range(3):
            g.record_round(had_content=False, tool_count=2)
        g.record_round(had_content=True, tool_count=2)
        self.assertEqual(g.record_round(had_content=False, tool_count=2), '')


class TestFeedText(unittest.TestCase):
    def test_repetition_detected(self):
        g = LoopGuard()
        block = '这是一段复读内容哦,用来测试死循环检测的。'
        rep = g.feed_text('正常开头: 用户的问题分析如下。' + block * 30)
        self.assertIn('复读', rep)

    def test_normal_text_ok(self):
        g = LoopGuard()
        normal = ''.join('第%d条不同内容的句子,涵盖各方面信息。' % i for i in range(50))
        self.assertEqual(g.feed_text(normal), '')

    def test_legit_multi_search_no_false_positive(self):
        g = LoopGuard()
        for i in range(8):
            g.record_tool_call('web_search', {'query': '搜索关键词%d' % i})
            g.record_round(had_content=True, tool_count=1)
            g.feed_text('搜索结果 %d: 这是第%d个关键词的完整结果内容。%s' % (i, i, '补充细节内容' * i))
        self.assertEqual(g.feed_text(g.content_text), '')


if __name__ == '__main__':
    unittest.main()
