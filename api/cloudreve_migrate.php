<?php
/**
 * Cloudreve 存量文件一次性迁移 — CLI 运行
 *
 * 用法:
 *   php api/cloudreve_migrate.php                      # 迁移所有 uploads/user_* 到各自账号 OneAPIChat/uploads
 *   php api/cloudreve_migrate.php --user u_xxx         # 只迁移指定用户
 *   php api/cloudreve_migrate.php --category downloads # 同时迁移 uploads/downloads 到主账号
 *
 * 2026-08-03 云盘全面结合: 历史聊天上传文件补导入到各用户绑定的 Cloudreve 账号
 */

require_once __DIR__ . '/cloudreve_lib.php';

set_time_limit(0);
ini_set('memory_limit', '512M');

$args = getopt('', ['user:', 'category:']);
$onlyUser = $args['user'] ?? '';
$category = $args['category'] ?? 'uploads';

$uploadsDir = ONECHAT_ROOT . '/uploads';
$total = 0; $ok = 0; $fail = 0; $skipped = 0;

function migrateDir(string $dir, string $userId, string $category): array {
    global $total, $ok, $fail, $skipped;
    $result = ['ok' => 0, 'fail' => 0];
    foreach (glob($dir . '/*') ?: [] as $f) {
        if (!is_file($f)) continue;
        $total++;
        $res = cr_importFile($userId, $f, $category);
        if (!empty($res['success'])) {
            $ok++; $result['ok']++;
            echo "  ✓ " . basename($f) . " → " . $res['cloudreve_path'] . "\n";
        } else {
            $fail++; $result['fail']++;
            echo "  ✗ " . basename($f) . " : " . ($res['error'] ?? '未知错误') . "\n";
        }
    }
    return $result;
}

echo "═══ Cloudreve 存量文件迁移 (category=$category) ═══\n";

// 1. uploads/user_* → 对应账号 OneAPIChat/uploads
foreach (glob($uploadsDir . '/user_*') ?: [] as $userDir) {
    if (!is_dir($userDir)) continue;
    $userId = substr(basename($userDir), 5); // 去掉 user_ 前缀
    if ($onlyUser && $onlyUser !== $userId) continue;
    echo "\n[$userId] " . basename($userDir) . " (" . count(glob($userDir . '/*') ?: []) . " 文件)\n";
    migrateDir($userDir, $userId, 'uploads');
}

// 2. uploads/downloads → 主账号 OneAPIChat/downloads (无用户归属的历史下载)
if ($category === 'downloads' && !$onlyUser) {
    echo "\n[主账号] uploads/downloads 历史下载\n";
    migrateDir($uploadsDir . '/downloads', '', 'downloads');
}

echo "\n═══ 迁移完成: 共 $total 个文件, 成功 $ok, 失败 $fail ═══\n";
