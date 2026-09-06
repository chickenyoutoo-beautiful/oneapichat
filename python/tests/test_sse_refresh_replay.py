#!/usr/bin/env python3
"""刷新页面时 SSE 历史回放与通知洪水回归测试。"""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import engine_server


ROOT = Path(__file__).resolve().parents[2]


class TestSSERefreshReplay(unittest.TestCase):
    def test_fresh_connection_starts_at_current_tail(self):
        self.assertEqual(
            engine_server._resolve_sse_replay_cursor(None, 37),
            (37, False),
        )
        self.assertEqual(
            engine_server._resolve_sse_replay_cursor("", 37),
            (37, False),
        )

    def test_reconnect_cursor_still_replays_only_the_gap(self):
        self.assertEqual(
            engine_server._resolve_sse_replay_cursor("12", 37),
            (12, True),
        )
        self.assertEqual(
            engine_server._resolve_sse_replay_cursor("0", 37),
            (0, True),
        )

    def test_malformed_cursor_does_not_replay_full_history(self):
        self.assertEqual(
            engine_server._resolve_sse_replay_cursor("invalid", 37),
            (37, False),
        )

    def test_frontend_suppresses_replayed_and_duplicate_notifications(self):
        notify = (ROOT / "public/js/agent-notify.js").read_text(encoding="utf-8")
        ui = (ROOT / "public/js/ui.js").read_text(encoding="utf-8")

        self.assertIn("sessionStorage.getItem('_oacSseSourceId')", notify)
        self.assertIn("_isReplayedSSEEvent(e)", notify)
        self.assertIn("_remoteAgentModePending", notify)
        self.assertIn("_remoteStreamToastAt", notify)
        self.assertIn("if (!ok) return;", notify)
        self.assertIn("JSON.stringify([String(type), String(msg)])", ui)
        self.assertIn("while (visibleToasts.length >= 6)", ui)


if __name__ == "__main__":
    unittest.main(verbosity=2)
