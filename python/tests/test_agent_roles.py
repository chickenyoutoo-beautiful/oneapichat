#!/usr/bin/env python3
"""OneAPIChat Engine — Agent 角色系统单元测试"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from engine.agent_roles import (
    AGENT_ROLES, ALL_TOOLS_DEF,
    filter_tools_by_role, cleanup_old_agents
)


class TestAgentRoles(unittest.TestCase):

    def test_roles_exist(self):
        """所有5个角色已定义"""
        self.assertIn("explorer", AGENT_ROLES)
        self.assertIn("planner", AGENT_ROLES)
        self.assertIn("developer", AGENT_ROLES)
        self.assertIn("verifier", AGENT_ROLES)
        self.assertIn("general", AGENT_ROLES)

    def test_explorer_readonly(self):
        """explorer 角色无写权限"""
        tools = filter_tools_by_role("explorer")
        names = {t["function"]["name"] for t in tools}
        self.assertIn("web_search", names)
        self.assertNotIn("server_exec", names)
        self.assertNotIn("server_file_write", names)

    def test_developer_full(self):
        """developer 角色有执行权限"""
        tools = filter_tools_by_role("developer")
        names = {t["function"]["name"] for t in tools}
        self.assertIn("server_exec", names)
        self.assertIn("server_file_write", names)

    def test_unknown_role_fallback(self):
        """未知角色回退到 general"""
        tools = filter_tools_by_role("nonexistent")
        general_tools = filter_tools_by_role("general")
        self.assertEqual(len(tools), len(general_tools))

    def test_cleanup_old_agents(self):
        """清理过期代理"""
        from datetime import datetime, timedelta
        old_time = (datetime.now() - timedelta(hours=13)).isoformat()
        agents = {
            "old_completed": {"status": "completed", "created": old_time},
            "old_failed": {"status": "failed", "created": old_time},
            "recent_completed": {"status": "completed", "created": datetime.now().isoformat()},
            "running": {"status": "running", "created": old_time},
        }
        count = cleanup_old_agents(agents)
        self.assertEqual(count, 2)
        self.assertIn("recent_completed", agents)
        self.assertIn("running", agents)
        self.assertNotIn("old_completed", agents)
        self.assertNotIn("old_failed", agents)

    def test_all_tools_have_defs(self):
        """所有角色引用的工具都有定义"""
        all_names = {t["function"]["name"] for t in ALL_TOOLS_DEF}
        for role_name, role_config in AGENT_ROLES.items():
            for tool_name in role_config["tools"]:
                self.assertIn(tool_name, all_names,
                    f"角色 {role_name} 引用了未定义的工具: {tool_name}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
