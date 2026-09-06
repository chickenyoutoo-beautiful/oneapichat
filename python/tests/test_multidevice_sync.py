#!/usr/bin/env python3
"""跨浏览器聊天同步契约回归测试。"""

from pathlib import Path
import queue
import unittest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import engine_server


ROOT = Path(__file__).resolve().parents[2]


class TestMultiDeviceSyncContract(unittest.TestCase):
    def test_frontend_sync_reads_one_authoritative_chat_and_persists_it(self):
        source = (ROOT / "public/js/agent-notify.js").read_text(encoding="utf-8")
        self.assertIn("chat.php?chat_id=' + encodeURIComponent(chatId)", source)
        self.assertIn("window.chats[chatId] = _mergeServerChatPreservingLive", source)
        self.assertIn("typeof isTypingMap !== 'undefined' && isTypingMap[chatId]", source)
        self.assertIn("typeof slimSaveChats === 'function'", source)
        self.assertIn("_sseCatchupTimer", source)

    def test_frontend_saves_before_broadcasting_message_updates(self):
        main = (ROOT / "public/js/main.js").read_text(encoding="utf-8")
        dialogs = (ROOT / "public/js/dialogs.js").read_text(encoding="utf-8")
        self.assertIn("window._saveAndBroadcast(chatId)", main)
        self.assertIn("var _broadcastChatId = targetChatId || currentChatId", dialogs)
        self.assertIn("_broadcastChatId", dialogs)

    def test_backend_sse_has_bounded_cursor_replay(self):
        source = (ROOT / "python/engine_server.py").read_text(encoding="utf-8")
        self.assertIn("_user_event_history", source)
        self.assertIn("_USER_EVENT_HISTORY_LIMIT = 256", source)
        self.assertIn("last-event-id", source)
        self.assertIn("seq > last_event_id", source)
        self.assertIn("id: {seq}", source)

    def test_broadcast_assigns_monotonic_id_and_keeps_payload_for_replay(self):
        original_queues = engine_server._user_event_queues
        original_history = engine_server._user_event_history
        original_seq = engine_server._user_event_seq

        class Loop:
            def is_closed(self):
                return False

            def call_soon_threadsafe(self, callback, payload):
                callback(payload)

        try:
            q = queue.Queue()
            engine_server._user_event_queues = {"sync-user": [(Loop(), q)]}
            engine_server._user_event_history = {}
            engine_server._user_event_seq = {}
            engine_server._broadcast_to_user("sync-user", "chat:updated", {"chat_id": "c1"})
            engine_server._broadcast_to_user("sync-user", "chat:stream_done", {"chat_id": "c1"})
            first = q.get_nowait()
            second = q.get_nowait()
            self.assertIn("id: 1\n", first)
            self.assertIn("id: 2\n", second)
            self.assertEqual(len(engine_server._user_event_history["sync-user"]), 2)
            replay = [payload for seq, payload in engine_server._user_event_history["sync-user"] if seq > 1]
            self.assertEqual(replay, [second])
        finally:
            engine_server._user_event_queues = original_queues
            engine_server._user_event_history = original_history
            engine_server._user_event_seq = original_seq


if __name__ == "__main__":
    unittest.main(verbosity=2)
