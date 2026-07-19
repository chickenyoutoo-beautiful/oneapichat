<?php
/**
 * OneAPIChat API v1 — Skills List
 *
 * GET /oneapichat/api/v1/skills
 *
 * 返回全部可用技能定义（OpenAI function calling 格式），
 * 第三方客户端可直接注入到 tools 数组中让模型发现和调用。
 */

require_once __DIR__ . '/../init.php';
require_once __DIR__ . '/../auth_helpers.php';
setApiCorsHeaders();
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204); exit;
}

$bearerToken = extractBearerToken();
$userId = null;
if ($bearerToken) {
    $userId = verifyApiKey($bearerToken) ?: verifyAuthToken($bearerToken);
}
if (!$userId) {
    http_response_code(401);
    echo json_encode(['error' => ['message' => 'Invalid API key', 'type' => 'authentication_error', 'code' => 'INVALID_API_KEY']]);
    exit;
}

$skillsDir = dirname(__DIR__, 2) . '/skills';
$skills = [];

if (is_dir($skillsDir)) {
    foreach (scandir($skillsDir) as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $skillPath = $skillsDir . '/' . $entry;
        if (!is_dir($skillPath)) continue;

        $mdFile = $skillPath . '/SKILL.md';
        if (!file_exists($mdFile)) continue;

        $content = @file_get_contents($mdFile);
        if ($content === false) continue;

        // 解析 YAML frontmatter
        $name = $entry;
        $description = '';
        $triggers = [];
        $tools = [];

        if (preg_match('/^---\s*\n(.*?)\n---/s', $content, $m)) {
            $yaml = $m[1];
            foreach (explode("\n", $yaml) as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#') continue;

                if (preg_match('/^name:\s*(.+)$/', $line, $lm)) {
                    $name = trim($lm[1], '"\' ');
                } elseif (preg_match('/^description:\s*(.+)$/', $line, $lm)) {
                    $description = trim($lm[1], '"\' ');
                } elseif (preg_match('/^trigger_keywords:/', $line)) {
                    // List follows on next lines
                } elseif (preg_match('/^\s+-\s*(.+)$/', $line, $lm)) {
                    $triggers[] = trim($lm[1], '"\' ');
                }
            }
        }

        // Fallback: 从目录名推断
        if (empty($description)) {
            $description = '技能: ' . $name;
        }

        $skills[] = [
            'type' => 'function',
            'function' => [
                'name' => 'run_skill',
                'description' => "运行技能「{$name}」: {$description}" . (empty($triggers) ? '' : ' 触发场景: ' . implode(', ', array_slice($triggers, 0, 5))),
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'skill_name' => [
                            'type' => 'string',
                            'description' => "技能名称: {$name}",
                            'enum' => [$name],
                        ],
                        'query' => [
                            'type' => 'string',
                            'description' => '传递给技能的原始用户问题',
                        ],
                    ],
                    'required' => ['skill_name', 'query'],
                ],
            ],
        ];
    }
}

// 添加通用 run_skill（让模型知道可以运行任意技能）
$skillNames = array_column(array_map(function($s) { return $s['function']['parameters']['properties']['skill_name']['enum'][0]; }, $skills), 0);

$skills[] = [
    'type' => 'function',
    'function' => [
        'name' => 'run_skill',
        'description' => '运行系统中已注册的AI技能。可用技能: ' . implode(', ', $skillNames) . '。根据用户需求自动匹配并运行最合适的技能。',
        'parameters' => [
            'type' => 'object',
            'properties' => [
                'skill_name' => [
                    'type' => 'string',
                    'description' => '要运行的技能名称',
                    'enum' => $skillNames,
                ],
                'query' => [
                    'type' => 'string',
                    'description' => '传递给技能的原始用户问题',
                ],
            ],
            'required' => ['skill_name', 'query'],
        ],
    ],
];

echo json_encode([
    'object' => 'list',
    'count' => count($skills),
    'data' => $skills,
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
