<?php
$h = password_hash('root', PASSWORD_DEFAULT);
echo "new hash: $h\n";
echo "verify: " . password_verify('root', $h) . "\n";

$users = json_decode(file_get_contents(__DIR__ . '/users/users.json'), true);
$hh = $users['u_a418898cebde5e2b1e15d181']['password_hash'];
echo "saved hash: $hh\n";
echo "verify: " . (password_verify('root', $hh) ? 'YES' : 'NO') . "\n";
echo "info: " . json_encode(password_get_info($hh)) . "\n";
