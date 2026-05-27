<?php
$users = json_decode(file_get_contents(__DIR__ . '/users/users.json'), true);
$login = 'root';
$password = 'root';

echo "login=$login password=$password\n";

foreach ($users as $id => $u) {
    if ($u['username'] === $login) {
        echo "found: hash={$u['password_hash']} len=" . strlen($u['password_hash']) . "\n";
        echo "verify: " . (password_verify($password, $u['password_hash']) ? "YES" : "NO") . "\n";
        break;
    }
}
