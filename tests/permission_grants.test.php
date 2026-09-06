<?php
require_once __DIR__ . '/../api/auth_helpers.php';
require_once __DIR__ . '/../api/permission_grants.php';

function assertTrue($condition, $message) { if (!$condition) { fwrite(STDERR, "FAIL: $message
"); exit(1); } }
$user = 'test-user';
$chat = '_runtime_permission_test';
$grant = issuePermissionGrant($user, $chat, ['filesystem.read','filesystem.search'], 60);
assertTrue(str_starts_with($grant['grant_id'], 'ocg_'), 'grant id format');
assertTrue(verifyPermissionGrant($grant['grant_id'], $user, $chat, 'filesystem.read'), 'read grant valid');
assertTrue(!verifyPermissionGrant($grant['grant_id'], $user, $chat, 'filesystem.write'), 'write not granted');
assertTrue(!verifyPermissionGrant($grant['grant_id'], 'other-user', $chat, 'filesystem.read'), 'owner isolation');
assertTrue(!verifyPermissionGrant($grant['grant_id'], $user, '_other_chat', 'filesystem.read'), 'chat isolation');
assertTrue(revokePermissionGrant($grant['grant_id'], $user, $chat), 'revoke succeeds');
assertTrue(!verifyPermissionGrant($grant['grant_id'], $user, $chat, 'filesystem.read'), 'revoked grant rejected');
echo "permission grants: PASS
";
