#!/usr/bin/env python3
"""OneAPIChat Engine — Cron 任务系统单元测试"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from engine.cron import _start_cron_job, _stop_cron_job, _cron_threads
from engine.store import EngineStore


class TestCronJobs(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.engine_dir = Path(self.tmpdir)
        # Create mock store factory
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

    def test_start_stop_cron(self):
        """创建和停止 cron 任务"""
        # Create a job
        store = self._mock_get_ns("cron", "test_user")
        jobs = store.get()
        jobs["test_cron"] = {
            "name": "test_cron",
            "interval": 3600,
            "action": "echo hello",
            "enabled": True,
            "created": "2026-01-01T00:00:00"
        }
        store.set(jobs)

        # Start
        _start_cron_job("test_cron", "test_user", self._mock_get_ns)
        key = "test_user_test_cron"
        self.assertIn(key, _cron_threads)

        # Stop
        _stop_cron_job("test_cron", "test_user", self._mock_get_ns)
        # After stop, thread may still exist briefly but job is disabled
        updated = store.get()
        self.assertFalse(updated["test_cron"]["enabled"])

    def test_start_nonexistent(self):
        """启动不存在的任务不抛异常"""
        _start_cron_job("nonexistent", "test_user", self._mock_get_ns)

    def test_stop_nonexistent(self):
        """停止不存在的任务不抛异常"""
        _stop_cron_job("nonexistent", "test_user", self._mock_get_ns)


if __name__ == "__main__":
    unittest.main(verbosity=2)
