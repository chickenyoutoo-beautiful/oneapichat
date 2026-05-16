<?php
// PHP Built-in Server Router
// Maps /oneapichat/* to root files (for Windows PHP built-in server)
$uri = $_SERVER['REQUEST_URI'];
$path = parse_url($uri, PHP_URL_PATH);

// Redirect / to /oneapichat/index.html
if ($path === '/' || $path === '') {
    header('Location: /index.html');
    exit;
}

// Serve /oneapichat/xxx as /xxx
if (strpos($path, '/oneapichat/') === 0) {
    $mapped = substr($path, strlen('/oneapichat'));
    $file = __DIR__ . $mapped;
    if (file_exists($file) && !is_dir($file)) {
        return false; // PHP will serve it
    }
}

// Default: serve file if exists
$file = __DIR__ . $path;
if (file_exists($file) && !is_dir($file)) {
    return false;
}

// 404
http_response_code(404);
echo 'Not Found';
