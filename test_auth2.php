<?php
session_start();
$users = json_decode(file_get_contents(__DIR__ . '/users/users.json'), true);
$login = 'root'; $password = 'root';
foreach ($users as $id => $u) {
    if ($u['username'] === $login) {
        echo "verify: " . (hash_equals($u['password_hash'], hash('sha256', $password)) ? "YES" : "NO") . "\n";
        break;
    }
}
