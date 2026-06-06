#!/usr/bin/env python3
"""
OneAPIChat Engine — 存储层单元测试
测试 EngineStore (JSON 存储) 和 ChatStore (SQLite 存储)
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent))
from engine.store import EngineStore, ChatStore, get_ns, get_chat_store


class TestEngineStore(unittest.TestCase):
    """JSON 文件存储测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.engine_dir = Path(self.tmpdir)
        self.store = EngineStore(self.engine_dir / "test.json")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_init_creates_file(self):
        """初始化应创建空 JSON 文件"""
        self.assertTrue((self.engine_dir / "test.json").exists())

    def test_get_empty(self):
        """空 store 返回空 dict"""
        self.assertEqual(self.store.get(), {})

    def test_set_and_get(self):
        """set 后 get 应返回相同数据"""
        data = {"key": "value", "list": [1, 2, 3]}
        self.store.set(data)
        self.assertEqual(self.store.get(), data)

    def test_update(self):
        """update 应修改单个 key"""
        self.store.set({"a": 1, "b": 2})
        self.store.update("a", 100)
        self.assertEqual(self.store.get()["a"], 100)
        self.assertEqual(self.store.get()["b"], 2)

    def test_delete(self):
        """delete 应移除 key"""
        self.store.set({"a": 1, "b": 2})
        self.store.delete("a")
        self.assertNotIn("a", self.store.get())
        self.assertIn("b", self.store.get())

    def test_user_isolation(self):
        """不同 user_id 应有独立文件"""
        store_a = EngineStore(self.engine_dir / "data.json", user_id="userA")
        store_b = EngineStore(self.engine_dir / "data.json", user_id="userB")
        store_a.set({"x": 1})
        store_b.set({"x": 2})
        self.assertEqual(store_a.get()["x"], 1)
        self.assertEqual(store_b.get()["x"], 2)

    def test_get_ns(self):
        """get_ns 工厂函数应返回正确的 EngineStore"""
        store = get_ns(self.engine_dir, "cron", user_id="test_user")
        self.assertIsInstance(store, EngineStore)
        store.set({"job": "test"})
        self.assertEqual(store.get()["job"], "test")


class TestChatStoreSQLite(unittest.TestCase):
    """SQLite 消息存储测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.engine_dir = Path(self.tmpdir)
        self.store = ChatStore(self.engine_dir, user_id="test_user")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_db_created(self):
        """初始化应创建 SQLite 数据库"""
        self.assertTrue(self.store.db_path.exists())

    def test_init_progress(self):
        """init_progress 应创建进度记录"""
        self.store.init_progress("msg_001", "chat_abc", "gpt-4")
        prog = self.store.get_progress("msg_001")
        self.assertFalse(prog.get("finished", True))

    def test_write_chunk_and_get_progress(self):
        """write_chunk 后 get_progress 应返回累积内容(flush每20字符触发)"""
        self.store.init_progress("msg_002", "chat_abc", "gpt-4")
        # ★ 需要超过20字符触发 flush; reasoning 类型总是立即 flush
        self.store.write_chunk("msg_002", "reasoning", "Thinking about the answer")
        self.store.write_chunk("msg_002", "content", "This is a long enough message to trigger the flush condition.")
        prog = self.store.get_progress("msg_002")
        self.assertIn("Thinking about the answer", prog.get("reasoning_text", ""))
        self.assertIn("long enough message", prog.get("full_text", ""))

    def test_finish_stream(self):
        """finish_stream 应标记完成并保留内容"""
        self.store.init_progress("msg_003", "chat_abc", "gpt-4")
        self.store.write_chunk("msg_003", "content", "Final answer")
        self.store.finish_stream(
            "msg_003", "Final answer", "thinking...",
            tool_calls=[], usage={"total_tokens": 100}, error=""
        )
        prog = self.store.get_progress("msg_003")
        self.assertTrue(prog.get("finished"))
        self.assertEqual(prog.get("full_text"), "Final answer")

    def test_register_and_get_active_tasks(self):
        """register_task 后 get_active_tasks 应返回任务"""
        self.store.register_task(
            "task_1", "stream_1", "chat_abc", "msg_004",
            "test_user", "gpt-4", {"model": "gpt-4"}
        )
        tasks = self.store.get_active_tasks("test_user")
        self.assertGreaterEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["task_id"], "task_1")

    def test_complete_task(self):
        """complete_task 后任务不应再出现在活跃列表中"""
        self.store.register_task(
            "task_done", "stream_x", "chat_abc", "msg_005",
            "test_user", "gpt-4", {}
        )
        self.store.complete_task("task_done", "completed")
        tasks = self.store.get_active_tasks("test_user")
        task_ids = [t["task_id"] for t in tasks]
        self.assertNotIn("task_done", task_ids)

    def test_get_chat_store_singleton(self):
        """get_chat_store 应返回单例"""
        s1 = get_chat_store(self.engine_dir, "user_single")
        s2 = get_chat_store(self.engine_dir, "user_single")
        self.assertIs(s1, s2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
