#!/usr/bin/env python3
"""可恢复流聚合快照与旧缓冲迁移测试。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

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
