#!/usr/bin/env python3
"""Background stream completion must durably project into the authoritative chat file."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.chat_projection import ChatProjectionStore


class TestChatProjectionStore(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        (self.root / "chat_data").mkdir()
        self.store = ChatProjectionStore(self.root)
        self.user_id = "u_test"
        self.chat_id = "chat_1"
        self.path = self.root / "chat_data" / "user_u_test_chat_1.json"

    def tearDown(self):
        self.tempdir.cleanup()

    def _seed(self, messages, revision=None):
        payload = {
            "title": "hello",
            "userId": self.user_id,
            "updated_at": 1000,
            "revision": len(messages) if revision is None else revision,
            "messages": messages,
        }
        self.path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def test_completion_replaces_partial_with_same_message_id(self):
        self._seed([
            {"id": "usr_1", "role": "user", "text": "question"},
            {"id": "asst_1", "_rsMsgId": "asst_1", "role": "assistant", "content": "part", "partial": True},
        ])
        result = self.store.commit_assistant(
            user_id=self.user_id, chat_id=self.chat_id, msg_id="asst_1",
            request_data={"model": "test"}, content="complete answer", model="test",
        )
        self.assertTrue(result["ok"])
        saved = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(len(saved["messages"]), 2)
        self.assertEqual(saved["messages"][-1]["content"], "complete answer")
        self.assertNotIn("partial", saved["messages"][-1])

    def test_completion_appends_when_browser_never_saved_placeholder(self):
        self._seed([{"id": "usr_1", "role": "user", "text": "question"}])
        self.store.commit_assistant(
            user_id=self.user_id, chat_id=self.chat_id, msg_id="asst_2",
            request_data={"model": "test"}, content="background answer", model="test",
        )
        saved = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual([m["role"] for m in saved["messages"]], ["user", "assistant"])
        self.assertEqual(saved["messages"][-1]["id"], "asst_2")
        self.assertEqual(saved["messages"][-1]["content"], "background answer")

    def test_repeated_completion_is_idempotent(self):
        self._seed([{"id": "usr_1", "role": "user", "text": "question"}])
        kwargs = dict(
            user_id=self.user_id, chat_id=self.chat_id, msg_id="asst_same",
            request_data={"model": "test"}, content="same answer", model="test",
        )
        self.store.commit_assistant(**kwargs)
        self.store.commit_assistant(**kwargs)
        saved = json.loads(self.path.read_text(encoding="utf-8"))
        assistants = [m for m in saved["messages"] if m.get("role") == "assistant"]
        self.assertEqual(len(assistants), 1)
        self.assertEqual(assistants[0]["id"], "asst_same")

    def test_pre_tool_preamble_is_preserved_when_continuation_commits(self):
        # Turn 1: Assistant emits preamble and calls web_search
        call = {"id": "call_search_1", "type": "function", "function": {"name": "web_search", "arguments": '{"query":"test"}'}}
        self._seed([
            {"id": "usr_1", "role": "user", "text": "浙江机电教务系统有对外api吗"},
            {"id": "asst_preamble", "_rsMsgId": "asst_preamble", "role": "assistant",
             "content": "结论：浙江机电职业技术大学教务系统不会提供面向公众的对外 API。",
             "tool_calls": [call]},
            {"id": "tool_1", "role": "tool", "tool_call_id": "call_search_1", "content": "搜索结果摘要"},
        ])
        # Turn 2: Follow-up stream commits continuation answer with a new message ID
        res = self.store.commit_assistant(
            user_id=self.user_id, chat_id=self.chat_id, msg_id="asst_continuation",
            request_data={"model": "test"},
            content="具体原因和如果你需要开发相关应用的可行途径如下：一、为什么没有公开API...",
            model="test",
        )
        self.assertTrue(res["ok"])
        saved = json.loads(self.path.read_text(encoding="utf-8"))
        assistants = [m for m in saved["messages"] if m.get("role") == "assistant"]
        self.assertEqual(len(assistants), 1, "同一用户轮次的工具前言与后续收尾必须融合成单条助手回复")
        merged_content = assistants[0]["content"]
        self.assertIn("结论：浙江机电职业技术大学", merged_content, "前置输出绝不能被工具返回后的后置输出覆盖截断")
        self.assertIn("具体原因和如果你需要开发", merged_content, "后置收尾内容必须完整追加")
        self.assertEqual(assistants[0]["tool_calls"], [call], "工具调用记录必须保留")

    def test_subagent_persists_without_browser(self):
        res = self.store.commit_subagent(
            user_id=self.user_id,
            agent_name="researcher",
            prompt="investigate quantum computing",
            result="quantum computing report",
        )
        self.assertTrue(res["ok"])
        sub_path = self.root / "chat_data" / f"user_{self.user_id}__agent_sub_researcher.json"
        self.assertTrue(sub_path.exists())
        data = json.loads(sub_path.read_text(encoding="utf-8"))
        self.assertEqual(data["title"], "🤖 researcher")
        self.assertEqual(len(data["messages"]), 2)
        self.assertEqual(data["messages"][0]["role"], "user")
        self.assertEqual(data["messages"][1]["role"], "assistant")
        self.assertEqual(data["messages"][1]["content"], "quantum computing report")


if __name__ == "__main__":
    unittest.main(verbosity=2)
