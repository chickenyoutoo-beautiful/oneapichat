#!/usr/bin/env python3
"""可恢复流聚合快照与旧缓冲迁移测试。"""

import inspect
import json
import queue
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))
import engine_server


class TestStreamBufferSnapshot(unittest.TestCase):

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.original_stream_dir = engine_server.STREAM_DIR
        engine_server.STREAM_DIR = Path(self.tempdir.name)

    def tearDown(self):
        engine_server.STREAM_DIR = self.original_stream_dir
        self.tempdir.cleanup()

    def test_snapshot_survives_reload(self):
        buffer = engine_server.StreamBuffer('msg_snapshot')
        buffer.set_meta('stream_1', 'chat_1', 'user_1')
        buffer.record(
            'content', {'delta': 'hello '},
            'event: content\ndata: {"delta":"hello "}\n\n'
        )
        tools = [{
            'id': 'call_1', 'type': 'function',
            'function': {'name': 'clock', 'arguments': '{}'}
        }]
        buffer.record(
            'tool_call', {'tools': tools},
            'event: tool_call\ndata: ' + json.dumps({'tools': tools}) + '\n\n'
        )

        loaded = engine_server.StreamBuffer('msg_snapshot').snapshot()
        self.assertEqual(loaded['full_text'], 'hello ')
        self.assertEqual(loaded['tool_calls'], tools)
        self.assertEqual(loaded['stream_id'], 'stream_1')
        self.assertEqual(loaded['offset'], 2)

    def test_cancelled_stream_persists_one_terminal_error(self):
        sid = 'stream_cancel'
        msg_id = 'msg_cancel'
        original_resumable = engine_server._resumable
        original_buffers = engine_server._stream_buffers
        engine_server._resumable = {sid: {
            'queue': queue.Queue(), 'chunks': [], 'finished': False, 'cancel': True,
            'msg_id': msg_id, 'chat_id': 'chat_1', 'user_id': 'user_1',
        }}
        engine_server._stream_buffers = {}
        try:
            with patch.object(engine_server, '_record_runtime_stream_event', side_effect=lambda _sid, _type, data: data), \
                 patch.object(engine_server, '_complete_task_from_stream') as complete:
                self.assertTrue(engine_server._finalize_cancelled_stream(sid))
                self.assertFalse(engine_server._finalize_cancelled_stream(sid))
                complete.assert_called_once_with(sid, 'failed')

            snapshot = engine_server.StreamBuffer(msg_id).snapshot()
            self.assertTrue(snapshot['finished'])
            self.assertIn('CANCELLED', snapshot['error'])
            self.assertEqual(snapshot['event_count'], 1)
            self.assertEqual(len(engine_server._resumable[sid]['chunks']), 1)
            self.assertIn('event: error', engine_server._resumable[sid]['chunks'][0])
        finally:
            engine_server._resumable = original_resumable
            engine_server._stream_buffers = original_buffers

    def test_resumable_provider_retry_budget_is_not_multiplied_by_sdk(self):
        source = inspect.getsource(engine_server._generate_resumable)
        self.assertIn('max_retries=0', source)
        self.assertIn('for _attempt in range(5)', source)
        self.assertIn('if _is_cancelled(stream_id):', source)
        self.assertIn('ErrorCode.EMPTY_RESPONSE', source)

    def test_premature_finish_reason_has_bounded_tool_tail_drain(self):
        """A gateway finish marker must not make the resumable stream self-cut."""
        source = inspect.getsource(engine_server._generate_resumable)
        self.assertIn('_saw_finish_reason = False', source)
        self.assertIn('_tool_calls_are_complete(_tc_by_index)', source)
        self.assertIn('_MAX_TRAILING_DRAIN = 50', source)
        self.assertIn("if usage is None and _trailing_drain_chunks < 1", source)

    def test_projection_merges_pre_tool_preamble_and_followup(self):
        from engine.chat_projection import _merge_stream_text
        self.assertEqual(
            _merge_stream_text('正在搜索公开资料', '根据搜索结果，结论如下'),
            '正在搜索公开资料\n\n根据搜索结果，结论如下',
        )
        self.assertEqual(_merge_stream_text('前置说明。', '前置说明。后续结论'), '前置说明。后续结论')

    def test_claude_model_on_openai_proxy_uses_openai_format(self):
        from engine.provider_runtime import detect_provider, prepare_openai_request
        info = detect_provider('https://gpt.naujtrats.xyz/v1', 'claude-3-5-sonnet-20241022')
        self.assertEqual(info.family, 'openai-compatible')
        provider, params = prepare_openai_request({
            'model': 'claude-3-5-sonnet-20241022',
            'base_url': 'https://gpt.naujtrats.xyz/v1',
            'messages': [{'role': 'user', 'content': 'hi'}]
        })
        self.assertEqual(provider.family, 'openai-compatible')
        self.assertEqual(params['model'], 'claude-3-5-sonnet-20241022')

    def test_legacy_chunk_file_builds_immediate_snapshot(self):
        chunks = [
            'event: content\ndata: {"delta":"old "}\n\n',
            'event: done\ndata: {"full_text":"old answer","reasoning_text":"",'
            '"tool_calls":[],"usage":{"total_tokens":2}}\n\n',
        ]
        path = Path(self.tempdir.name) / 'legacy.json'
        path.write_text(json.dumps({
            'chunks': chunks, 'finished': True, 'ts': 1
        }), encoding='utf-8')

        snapshot = engine_server.StreamBuffer('legacy').snapshot()
        self.assertEqual(snapshot['full_text'], 'old answer')
        self.assertTrue(snapshot['finished'])
        self.assertEqual(snapshot['usage']['total_tokens'], 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
