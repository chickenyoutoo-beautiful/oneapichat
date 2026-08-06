#!/usr/bin/env python3
"""
OneAPIChat — Cloudreve 云盘账号同步测试
验证核心逻辑：
  1. 新用户 → cr_ensureAccount 用真实邮箱+密码自动注册云盘
  2. 已存在用户 → cr_ensureAccount 用真实邮箱+密码登录云盘
  3. cr_getAccessToken 不跨用户串号（userId 专属文件找不到返回空）
  4. 切账号后云盘跟随切换
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "api"))

# 模拟 PHP 全局函数，让 cloudreve_lib 可被 Python 测试逻辑验证
# 注：直接 import PHP 不可行，这里通过 reimport 纯逻辑太复杂；
# 改为：读取 PHP 源码做结构性断言 + mock 调用验证行为


class TestCloudreveSyncLogic(unittest.TestCase):
    """通过读取 PHP 源码做结构性断言，确保关键逻辑存在且正确"""

    def setUp(self):
        self.lib_path = Path(__file__).parent.parent.parent / "api" / "cloudreve_lib.php"
        self.api_path = Path(__file__).parent.parent.parent / "api" / "cloudreve_api.php"
        self.auth_path = Path(__file__).parent.parent.parent / "api" / "auth.php"
        self.lib_src = self.lib_path.read_text(encoding="utf-8")
        self.api_src = self.api_path.read_text(encoding="utf-8")
        self.auth_src = self.auth_path.read_text(encoding="utf-8")

    # ── auth.php: 登录/注册时缓存明文密码 ──

    def test_login_caches_plaintext_password(self):
        """登录成功后必须把明文 email+password 写入 /tmp/cloudreve_login_{md5(userId)}.json"""
        self.assertIn("cloudreve_login_' . md5($userId)", self.auth_src)
        self.assertIn("'password' => $password", self.auth_src)
        self.assertIn("'source' => 'main_auth'", self.auth_src)

    def test_register_caches_plaintext_password(self):
        """注册成功后必须缓存明文密码"""
        # register 处理器也写入了 cloudreve_login 缓存
        count = self.auth_src.count("'source' => 'main_auth'")
        self.assertGreaterEqual(count, 2, "login 和 register 都应该缓存密码（至少 2 处）")

    # ── cloudreve_lib.php: cr_ensureAccount 用真实邮箱+密码 ──

    def test_ensure_account_prioritizes_real_email(self):
        """cr_ensureAccount 必须优先用主项目同步的真实邮箱+密码（而非桥接账号）"""
        # 新逻辑：跳过 @oneapichat.local 桥接格式，用真实邮箱
        self.assertIn("strpos($syncEmail, '@oneapichat.local') === false", self.lib_src)
        self.assertIn("'source' => 'main_sync'", self.lib_src)
        # 自动注册路径存在
        self.assertIn("'source' => 'main_sync_registered'", self.lib_src)

    def test_ensure_account_auto_registers(self):
        """真实邮箱登录失败时必须自动注册云盘账号"""
        self.assertIn("main_sync_registered", self.lib_src)
        # 注册 API 调用
        self.assertIn("'/user'", self.lib_src)

    def test_get_access_token_no_cross_user_fallback(self):
        """cr_getAccessToken 在 userId 专属文件找不到时禁止跨用户 glob 回退"""
        # 关键修复：uid 存在但文件找不到 → return ''（不再 glob 所有文件）
        self.assertIn("return '';", self.lib_src)
        # 确认在 $uid 块内有提前 return（不再落到后面的 glob）
        # 找到 if ($uid) 块，确认其后紧跟 return ''
        idx = self.lib_src.find("if ($uid) {")
        self.assertGreater(idx, 0)
        # 在 $uid 块作用域内应有 return ''
        uid_block = self.lib_src[idx:idx + 1500]
        self.assertIn("return '';", uid_block)

    # ── cloudreve_api.php: check_login 自动同步 ──

    def test_check_login_auto_sync(self):
        """check_login 无有效 token 时必须调用 cr_ensureAccount 自动同步"""
        self.assertIn("cr_ensureAccount($userId)", self.api_src)
        self.assertIn("'synced' => true", self.api_src)

    def test_auto_login_uses_real_email(self):
        """auto_login 必须用真实邮箱+密码（委托 cr_ensureAccount），不再硬编码桥接邮箱"""
        # 新 auto_login 不再自己拼 @oneapichat.local，而是调用 cr_ensureAccount
        self.assertIn("cr_ensureAccount($oaUserId)", self.api_src)

    def test_register_auto_login_after_register(self):
        """云盘 register 成功后必须自动登录获取 token"""
        self.assertIn("cr_cacheToken($email, $token, 3500)", self.api_src)


class TestCloudreveCrossUserIsolation(unittest.TestCase):
    """模拟多用户场景，验证串号修复（通过 PHP 子进程执行真实逻辑）"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.api_dir = str(Path(__file__).parent.parent.parent / "api")

    def _write_php_script(self, code):
        """写入临时 PHP 脚本并执行，返回 stdout"""
        script = os.path.join(self.tmpdir, "_test.php")
        with open(script, "w") as f:
            f.write(code)
        import subprocess
        env = os.environ.copy()
        result = subprocess.run(
            ["php", script], capture_output=True, text=True, cwd=self.api_dir, env=env
        )
        return result.stdout.strip(), result.stderr.strip(), result.returncode

    def test_get_access_token_returns_empty_for_unknown_uid(self):
        """userId 无专属缓存文件时，cr_getAccessToken 应返回空串（不串号）"""
        # 清理可能存在的测试文件
        for f in Path("/tmp").glob("cloudreve_login_test_*.json"):
            f.unlink(missing_ok=True)
        stdout, stderr, rc = self._write_php_script(f"""<?php
require_once '{self.api_dir}/cloudreve_lib.php';
// 用一个不存在的 userId 调用
$token = cr_getAccessToken('nonexistent_user_id_xyz');
echo "token=[$token]";\n""")
        self.assertEqual(rc, 0, f"PHP 执行失败: {stderr}")
        self.assertIn("token=[]", stdout, "未知 userId 应返回空串，不串号")

    def test_switch_user_cloudreve_isolation(self):
        """切账号后，新用户 B 的 cr_getAccessToken 不应返回旧用户 A 的 token"""
        import hashlib
        # 模拟旧用户 A 的缓存文件（真实场景：A 登录过云盘）
        uid_a = "user_old_account_a"
        uid_b = "user_new_account_b"
        file_a = f"/tmp/cloudreve_login_{hashlib.md5(uid_a.encode()).hexdigest()}.json"
        # 清理 B 的文件确保不存在
        file_b = f"/tmp/cloudreve_login_{hashlib.md5(uid_b.encode()).hexdigest()}.json"
        Path(file_b).unlink(missing_ok=True)
        with open(file_a, "w") as f:
            json.dump({"email": "a@example.com", "password": "passA", "user_id": "cr_a", "oneapichat_user": uid_a}, f)
        try:
            # 注：B 的专属文件不存在 → cr_getAccessToken 在读取文件阶段就 return ''，
            # 不会调到 cr_post，因此无需 mock cr_post（避免函数重定义冲突）
            stdout, stderr, rc = self._write_php_script(f"""<?php
require_once '{self.api_dir}/cloudreve_lib.php';
$GLOBALS['apiBase'] = 'http://127.0.0.1:5212/api/v4';
// 新用户 B 调用 → 专属文件不存在 → 应返回空，绝不返回 A 的 token
$tokenB = cr_getAccessToken('{uid_b}');
echo "tokenB=[$tokenB]";\n""")
            self.assertEqual(rc, 0, f"PHP 执行失败: {stderr}")
            self.assertIn("tokenB=[]", stdout, "新用户 B 不应拿到旧用户 A 的 token（串号修复）")
        finally:
            Path(file_a).unlink(missing_ok=True)
            Path(file_b).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
