const assert = require('assert');
const fs = require('fs');

const js = fs.readFileSync('public/js/update-check.js', 'utf8');
const php = fs.readFileSync('api/version.php', 'utf8');

assert(js.includes('navigator.serviceWorker.getRegistrations'), 'hard refresh must unregister legacy service workers');
assert(js.includes("url.searchParams.set('_oacv'"), 'hard refresh must navigate with a cache-busting URL');
assert(js.includes('location.replace(url.toString())'), 'hard refresh must perform a real navigation');
assert(js.includes('d.style_v'), 'initial update check must compare the loaded style version');
assert(js.includes('link[href*="/css/style.css"]'), 'update check must inspect the active style link');
assert(php.includes("'style_v'"), 'version endpoint must expose style.css mtime');
assert(php.includes("public/css/style.css"), 'version endpoint must inspect the served stylesheet');

console.log('✅ update_style_version_refresh.test.js: all assertions passed');
