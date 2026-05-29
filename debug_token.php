<?php
header('Content-Type: text/plain');
echo "GET:\n";
print_r($_GET);
echo "RAW token: " . ($_GET['auth_token'] ?? 'none') . "\n";
echo "Cleaned: " . preg_replace('/[^a-f0-9]/', '', $_GET['auth_token'] ?? '') . "\n";
$sessions = json_decode(file_get_contents(__DIR__ . '/users/sessions.json'), true);
$cleaned = preg_replace('/[^a-f0-9]/', '', $_GET['auth_token'] ?? '');
echo "Token found: " . (isset($sessions[$cleaned]) ? 'yes' : 'no') . "\n";
