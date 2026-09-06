<?php
/** Server-trusted, session-bound permission grants for Agent filesystem access. */

function permissionGrantDb(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    $path = ONECHAT_ROOT . '/.engine/permission_grants.db';
    $dir = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0770, true);
    $pdo = new PDO('sqlite:' . $path);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    @chmod($path, 0660);
    $pdo->exec('CREATE TABLE IF NOT EXISTS permission_grants (
        grant_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER DEFAULT 0
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_permission_grants_owner ON permission_grants(user_id, chat_id, expires_at)');
    return $pdo;
}

function normalizeGrantChatId(string $chatId): string {
    $chatId = trim($chatId);
    if ($chatId === '' || strlen($chatId) > 180 || !preg_match('/^[A-Za-z0-9_.:-]+$/', $chatId)) return '';
    return $chatId;
}

function normalizeGrantCapabilities($raw): array {
    $allowed = ['filesystem.read', 'filesystem.search', 'filesystem.write', 'filesystem.move', 'terminal.exec'];
    $items = is_array($raw) ? $raw : [];
    $out = [];
    foreach ($items as $item) {
        $value = trim((string)$item);
        if (in_array($value, $allowed, true) && !in_array($value, $out, true)) $out[] = $value;
    }
    return $out;
}

function issuePermissionGrant(string $userId, string $chatId, array $capabilities, int $ttlSeconds = 1800): array {
    $chatId = normalizeGrantChatId($chatId);
    $capabilities = normalizeGrantCapabilities($capabilities);
    if ($userId === '' || $chatId === '' || !$capabilities) throw new InvalidArgumentException('invalid permission grant request');
    $ttlSeconds = max(60, min(3600, $ttlSeconds));
    $raw = 'ocg_' . bin2hex(random_bytes(32));
    $hash = hash('sha256', $raw);
    $now = time();
    $stmt = permissionGrantDb()->prepare('INSERT INTO permission_grants (grant_hash,user_id,chat_id,scope,capabilities,expires_at,created_at,revoked_at) VALUES (?,?,?,?,?,?,?,0)');
    $stmt->execute([$hash, $userId, $chatId, 'filesystem', json_encode($capabilities), $now + $ttlSeconds, $now]);
    return ['grant_id' => $raw, 'chat_id' => $chatId, 'capabilities' => $capabilities, 'expires_at' => $now + $ttlSeconds];
}

function verifyPermissionGrant(string $raw, string $userId, string $chatId, string $capability): bool {
    if ($raw === '' || $userId === '' || $chatId === '' || $capability === '') return false;
    if (!preg_match('/^ocg_[a-f0-9]{64}$/', $raw)) return false;
    $stmt = permissionGrantDb()->prepare('SELECT capabilities,expires_at,revoked_at FROM permission_grants WHERE grant_hash=? AND user_id=? AND chat_id=? LIMIT 1');
    $stmt->execute([hash('sha256', $raw), $userId, normalizeGrantChatId($chatId)]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || (int)$row['revoked_at'] > 0 || (int)$row['expires_at'] < time()) return false;
    $caps = json_decode((string)$row['capabilities'], true);
    return is_array($caps) && in_array($capability, $caps, true);
}

function revokePermissionGrant(string $raw, string $userId, string $chatId): bool {
    if (!preg_match('/^ocg_[a-f0-9]{64}$/', $raw)) return false;
    $stmt = permissionGrantDb()->prepare('UPDATE permission_grants SET revoked_at=? WHERE grant_hash=? AND user_id=? AND chat_id=? AND revoked_at=0');
    $stmt->execute([time(), hash('sha256', $raw), $userId, normalizeGrantChatId($chatId)]);
    return $stmt->rowCount() > 0;
}

function purgeExpiredPermissionGrants(): void {
    try { permissionGrantDb()->prepare('DELETE FROM permission_grants WHERE expires_at < ? OR revoked_at > 0')->execute([time() - 86400]); } catch (Throwable $e) {}
}
