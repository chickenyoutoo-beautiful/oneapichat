const assert = require('assert');
const fs = require('fs');

const api = fs.readFileSync('api/netdisk_api.php', 'utf8');
const parser = fs.readFileSync('python/netdisk/netdisk_parser.py', 'utf8');
const frontend = fs.readFileSync('public/js/netdisk.js', 'utf8');
const tools = fs.readFileSync('public/js/tools.js', 'utf8');

assert(api.includes("queue_download($url, $filename, $outputDir, $threads, $downloadHeaders, $fileSize)"));
assert(api.includes("$fileSize >= 512 * 1024 * 1024"));
assert(api.includes("$downloadType = identify_netdisk_type($url)"));
assert(api.includes("'Cookie', 'Referer', 'User-Agent', 'Accept', 'Origin'"));
assert(api.includes("function read_download_job($jobId)"));
assert(api.includes("$jobId = $_GET['job_id'] ?? $_POST['job_id'] ?? ''"));
assert(api.includes("function netdisk_public_result($value)"));
assert(parser.includes("'Cookie': fresh_cookie"));
assert(frontend.includes("action === 'parse_and_download' || action === 'parse' ? 180000 : 120000"));
assert(tools.includes("大于512MB的文件进入后台队列"));
assert(tools.includes("netdisk_status(job_id)"));

console.log('netdisk_quark_download.test.js: all assertions passed');
