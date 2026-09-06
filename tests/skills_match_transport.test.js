const assert = require('assert');
const fs = require('fs');

const skills = fs.readFileSync('public/js/skills.js', 'utf8');
const api = fs.readFileSync('api/skills_api.php', 'utf8');

assert(skills.includes("method: 'POST'"));
assert(skills.includes("body: JSON.stringify({ query: userText.slice(0, 12000) })"));
assert(skills.includes("if (!resp.ok) throw new Error('HTTP ' + resp.status)"));
assert(api.includes("json_decode(file_get_contents('php://input'), true)"));
assert(api.includes("$_POST['query'] ?? ($_GET['query'] ?? '')"));

console.log('skills_match_transport.test.js: all assertions passed');
