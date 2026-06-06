#!/usr/bin/env python3
"""OneAPIChat Engine — 工作流引擎单元测试"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from engine.workflow import (
    create_workflow, run_workflow, list_workflows,
    status_workflow, delete_workflow, get_roles
)
from engine.store import EngineStore
from engine.agent_roles import AGENT_ROLES, filter_tools_by_role


class TestWorkflow(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.engine_dir = Path(self.tmpdir)
        self._stores = {}

        def _mock_get_ns(suffix, user_id=""):
            key = f"{user_id}_{suffix}"
            if key not in self._stores:
                self._stores[key] = EngineStore(self.engine_dir / f"{suffix}.json", user_id=user_id)
            return self._stores[key]

        self._mock_get_ns = _mock_get_ns

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_create_workflow(self):
        """创建工作流"""
        steps = json.dumps([
            {"role": "explorer", "prompt": "搜索最新AI新闻"},
            {"role": "developer", "prompt": "整理成报告"}
        ])
        result = create_workflow("test_wf", steps, "test_user", self._mock_get_ns)
        self.assertTrue(result.get("ok"))
        self.assertEqual(result["steps"], 2)

    def test_create_empty_steps(self):
        """空步骤数组应返回错误"""
        result = create_workflow("bad_wf", "[]", "test_user", self._mock_get_ns)
        self.assertIn("error", result)

    def test_create_invalid_json(self):
        """无效 JSON 应返回错误"""
        result = create_workflow("bad_wf", "not json", "test_user", self._mock_get_ns)
        self.assertIn("error", result)

    def test_list_workflows(self):
        """列出工作流"""
        steps = json.dumps([{"role": "general", "prompt": "test"}])
        create_workflow("wf1", steps, "test_user", self._mock_get_ns)
        create_workflow("wf2", steps, "test_user", self._mock_get_ns)
        wfs = list_workflows("test_user", self._mock_get_ns)
        self.assertIn("wf1", wfs)
        self.assertIn("wf2", wfs)

    def test_status_workflow(self):
        """查询工作流状态"""
        steps = json.dumps([{"role": "general", "prompt": "test"}])
        create_workflow("wf_status", steps, "test_user", self._mock_get_ns)
        status = status_workflow("wf_status", "test_user", self._mock_get_ns)
        self.assertEqual(status["name"], "wf_status")
        self.assertEqual(status["status"], "created")

    def test_delete_workflow(self):
        """删除工作流"""
        steps = json.dumps([{"role": "general", "prompt": "test"}])
        create_workflow("wf_del", steps, "test_user", self._mock_get_ns)
        result = delete_workflow("wf_del", "test_user", self._mock_get_ns)
        self.assertTrue(result["ok"])
        wfs = list_workflows("test_user", self._mock_get_ns)
        self.assertNotIn("wf_del", wfs)

    def test_get_roles(self):
        """获取角色列表"""
        result = get_roles(AGENT_ROLES)
        self.assertIn("roles", result)
        self.assertGreaterEqual(len(result["roles"]), 5)

    def test_run_nonexistent(self):
        """运行不存在的工作流返回错误"""
        result = run_workflow("nonexistent", "test_user", self._mock_get_ns,
                              lambda uid: {}, AGENT_ROLES, filter_tools_by_role)
        self.assertIn("error", result)


class TestAgentMemory(unittest.TestCase):
    """测试 Agent 记忆持久化"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.memory_dir = Path(self.tmpdir)
        from engine.agent_memory import read_memory_json, write_memory_json
        self.read = read_memory_json
        self.write = write_memory_json
        self.memory_dir_obj = self.memory_dir

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_write_and_read(self):
        """写入并读取记忆"""
        data = {"key": "value", "list": [1, 2, 3]}
        ok = self.write(self.memory_dir_obj, "test_memory.json", data)
        self.assertTrue(ok)
        result = self.read(self.memory_dir_obj, "test_memory.json")
        self.assertEqual(result["key"], "value")

    def test_read_missing_file(self):
        """读取不存在的文件返回空 dict"""
        result = self.read(self.memory_dir_obj, "nonexistent.json")
        self.assertEqual(result, {})

    def test_user_isolation(self):
        """用户隔离"""
        self.write(self.memory_dir_obj, "prefs.json", {"theme": "light"}, "userA")
        self.write(self.memory_dir_obj, "prefs.json", {"theme": "dark"}, "userB")
        a = self.read(self.memory_dir_obj, "prefs.json", "userA")
        b = self.read(self.memory_dir_obj, "prefs.json", "userB")
        self.assertEqual(a["theme"], "light")
        self.assertEqual(b["theme"], "dark")


if __name__ == "__main__":
    unittest.main(verbosity=2)
