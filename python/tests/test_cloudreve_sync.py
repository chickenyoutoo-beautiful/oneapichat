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
        self.sso_path = Path(__file__).parent.parent.parent / "api" / "cloudreve_sso.php"
        self.sso_login_path = Path(__file__).parent.parent.parent / "api" / "cloudreve_login.php"
        self.cloudreve_js_path = Path(__file__).parent.parent.parent / "public" / "js" / "cloudreve.js"
        self.lib_src = self.lib_path.read_text(encoding="utf-8")
        self.api_src = self.api_path.read_text(encoding="utf-8")
        self.auth_src = self.auth_path.read_text(encoding="utf-8")
        self.sso_src = self.sso_path.read_text(encoding="utf-8")
        self.sso_login_src = self.sso_login_path.read_text(encoding="utf-8")
        self.cloudreve_js_src = self.cloudreve_js_path.read_text(encoding="utf-8")

    # ── auth.php: 登录/注册时缓存明文密码 ──

    def test_login_caches_plaintext_password(self):
        """登录成功后必须把明文 email+password 写入 /tmp/cloudreve_login_{md5(userId)}.json"""
        self.assertIn("cloudreve_login_' . md5($userId)", self.auth_src)
        self.assertIn("'password' => $password", self.auth_src)
        self.assertIn("'source' => 'main_auth'", self.auth_src)

    def test_register_caches_plaintext_password(self):
        """注册成功后必须缓存明文密码"""
        # 公共缓存函数定义一次，注册/登录/改密/重置密码都复用它。
        self.assertIn("function cacheVerifiedCloudreveCredentials", self.auth_src)
        count = self.auth_src.count("cacheVerifiedCloudreveCredentials(")
        self.assertGreaterEqual(count, 5, "定义 + 注册/登录/改密/重置密码都应刷新云盘凭据")

    def test_password_sync_only_after_main_auth(self):
        """已有云盘账号只能在主项目密码验证成功后同步，自动探测不得改密码"""
        self.assertIn("syncVerifiedCloudrevePassword", self.auth_src)
        self.assertIn("cr_syncVerifiedMainPassword", self.auth_src)
        self.assertNotIn("cr_resetExistingAccountPassword", self.lib_src)

        ensure_start = self.lib_src.find("function cr_ensureAccount")
        self.assertGreater(ensure_start, 0)
        ensure_block = self.lib_src[ensure_start:ensure_start + 9000]
        self.assertNotIn("cr_syncVerifiedMainPassword", ensure_block)

    def test_profile_mutations_sync_to_cloudreve(self):
        """用户名、密码重置和邮箱绑定入口都必须返回 Cloudreve 联动结果"""
        self.assertIn("function cr_syncVerifiedMainProfile", self.lib_src)
        self.assertIn("function syncVerifiedCloudreveProfile", self.auth_src)
        self.assertGreaterEqual(
            self.auth_src.count("syncVerifiedCloudreveProfile("),
            6,
            "定义 + 登录自愈 + 重置密码 + 资料修改 + 绑定/解绑邮箱均应接入联动",
        )
        self.assertIn("'cloudreve_synced'", self.auth_src)
        self.assertIn("'cloudreve_email_retained'", self.auth_src)

    def test_login_cache_preserves_cloudreve_user_mapping(self):
        """主账号再次登录时不能再用空 user_id 覆盖已绑定云盘映射"""
        self.assertIn("array_merge($existing", self.auth_src)
        self.assertNotIn("'user_id' => '',\n                'nickname'", self.auth_src)

    def test_reset_failure_never_exposes_reset_link(self):
        """邮件失败时不得把主项目重置链接或 token 回传给请求者"""
        self.assertNotIn("jsonSuccess(['message' => '重置链接: ' . $resetLink])", self.auth_src)
        self.assertIn("unset($users[$userId]['reset_token']", self.auth_src)
        self.assertIn("jsonError(502, '重置邮件发送失败", self.auth_src)

    def test_sso_ticket_is_authenticated_short_lived_and_complete(self):
        """SSO 只能用主项目 token 换取短效票据，且必须签发完整 refresh 会话"""
        self.assertIn("extractBearerToken()", self.sso_src)
        self.assertIn("verifyAuthToken($authToken)", self.sso_src)
        self.assertIn("time() + 300", self.sso_src)
        self.assertIn("['token']['access_token']", self.sso_src)
        self.assertIn("['token']['refresh_token']", self.sso_src)
        self.assertIn("'action_url' => 'https://cloudreve.naujtrats.xyz/api/oneapichat-sso'", self.sso_src)
        self.assertIn("'ticket' => $ticket", self.sso_src)
        ticket_start = self.sso_src.find("$written = cr_writeCredentialFile")
        self.assertGreater(ticket_start, 0)
        self.assertNotIn("'password'", self.sso_src[ticket_start:ticket_start + 500])

    def test_sso_consumer_uses_current_v4_session_store_and_single_use_ticket(self):
        """Cloudreve 同源消费端必须写 cloudreve_session，并原子消费票据"""
        self.assertIn("cloudreve_session", self.sso_login_src)
        self.assertIn("@rename($path, $claimed)", self.sso_login_src)
        self.assertIn("$_POST['t']", self.sso_login_src)
        self.assertIn("location.replace('/home')", self.sso_login_src)
        self.assertIn("Content-Security-Policy", self.sso_login_src)

    def test_sso_navigation_uses_post_to_bypass_cloudreve_service_worker(self):
        """Cloudreve Workbox 会拦截未知 GET 导航，前端必须用 POST 到 PHP"""
        self.assertIn("form.method = 'POST'", self.cloudreve_js_src)
        self.assertIn("input.name = 't'", self.cloudreve_js_src)
        self.assertIn("data.action_url", self.cloudreve_js_src)

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

    def test_profile_sync_updates_same_cloudreve_row_and_cache(self):
        """资料联动必须原地更新同一 Cloudreve ID，并刷新邮箱/昵称/密码缓存"""
        db_path = os.path.join(self.tmpdir, "cloudreve-profile.db")
        uid = "profile_sync_test_user"
        stdout, stderr, rc = self._write_php_script(f"""<?php
define('CLOUDREVE_DB_PATH', '{db_path}');
require_once '{self.api_dir}/cloudreve_lib.php';
$db = new SQLite3(CLOUDREVE_DB_PATH);
$db->exec("CREATE TABLE users (id INTEGER PRIMARY KEY, created_at datetime NOT NULL, updated_at datetime NOT NULL, deleted_at datetime NULL, email text NOT NULL UNIQUE, nick text NOT NULL, password text NULL, status text NOT NULL, storage integer NOT NULL, two_factor_secret text NULL, avatar text NULL, settings json NULL, group_users integer NOT NULL)");
$db->exec("INSERT INTO users VALUES (7,datetime('now'),datetime('now'),NULL,'old@example.com','oldname','oldhash','active',0,NULL,NULL,NULL,2)");
$db->close();
$cachePath = '/tmp/cloudreve_login_' . md5('{uid}') . '.json';
cr_writeCredentialFile($cachePath, ['email'=>'old@example.com','password'=>'oldpass','user_id'=>'hash7','nickname'=>'oldname','oneapichat_user'=>'{uid}']);
$result = cr_syncVerifiedMainProfile('{uid}', ['username'=>'oldname','email'=>'old@example.com'], ['username'=>'newname','email'=>'new@example.com'], 'newpass123');
$db = new SQLite3(CLOUDREVE_DB_PATH);
$row = $db->querySingle('SELECT id,email,nick,password FROM users WHERE id=7', true);
[$salt,$digest] = explode(':', $row['password'], 2);
$db->exec("INSERT INTO users VALUES (8,datetime('now'),datetime('now'),NULL,'taken@example.com','other','hash','active',0,NULL,NULL,NULL,2)");
$db->close();
$duplicate = cr_syncVerifiedMainProfile('{uid}', ['username'=>'newname','email'=>'new@example.com'], ['username'=>'wrongname','email'=>'taken@example.com']);
$db = new SQLite3(CLOUDREVE_DB_PATH);
$afterDuplicate = $db->querySingle('SELECT email,nick FROM users WHERE id=7', true);
$cache = json_read_file($cachePath);
echo json_encode(['result'=>$result,'duplicate'=>$duplicate,'after_duplicate'=>$afterDuplicate,'row'=>['id'=>$row['id'],'email'=>$row['email'],'nick'=>$row['nick'],'password_ok'=>hash('sha256','newpass123'.$salt)===$digest],'cache'=>['email'=>$cache['email']??null,'nickname'=>$cache['nickname']??null,'user_id'=>$cache['user_id']??null,'password_ok'=>($cache['password']??'')==='newpass123']]);
@unlink($cachePath);
""")
        self.assertEqual(rc, 0, f"PHP 执行失败: {stderr}")
        payload = json.loads(stdout)
        self.assertTrue(payload["result"]["synced"])
        self.assertEqual(payload["row"]["id"], 7)
        self.assertEqual(payload["row"]["email"], "new@example.com")
        self.assertEqual(payload["row"]["nick"], "newname")
        self.assertTrue(payload["row"]["password_ok"])
        self.assertEqual(payload["cache"]["user_id"], "hash7")
        self.assertEqual(payload["cache"]["email"], "new@example.com")
        self.assertTrue(payload["cache"]["password_ok"])
        self.assertFalse(payload["duplicate"]["synced"])
        self.assertIn("已被另一个", payload["duplicate"]["error"])
        self.assertEqual(payload["after_duplicate"], {"email": "new@example.com", "nick": "newname"})


if __name__ == "__main__":
    unittest.main()
