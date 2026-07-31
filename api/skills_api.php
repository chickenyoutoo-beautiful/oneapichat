<?php
/**
 * Skills API — ClawHub 兼容的技能系统
 *
 * GET  /api/skills_api.php?action=list                   列出所有技能
 * GET  /api/skills_api.php?action=get&name=<skill-name>  获取单个技能
 * GET  /api/skills_api.php?action=match&query=<text>     匹配用户问题相关的技能
 */

require_once __DIR__ . '/init.php';
require_once __DIR__ . '/auth_helpers.php';
header('Content-Type: application/json; charset=utf-8');

// 认证
$bearerToken = extractBearerToken();
$userId = $bearerToken ? (verifyApiKey($bearerToken) ?: verifyAuthToken($bearerToken)) : null;
if (!$userId) {
    // 技能读取允许未认证（公开资源）
    // 但写入/管理操作需要认证
}

$action = $_GET['action'] ?? 'list';
$skillsDir = dirname(__DIR__) . '/skills';

if (!is_dir($skillsDir)) {
    echo json_encode(['skills' => [], 'count' => 0]);
    exit;
}

/**
 * 解析 SKILL.md 的 YAML frontmatter + Markdown body
 * v2: 支持3层嵌套 (metadata.oneapichat.tools/emoji/triggers/priority)
 */
function parseSkillFile(string $path): ?array {
    if (!file_exists($path)) return null;
    $content = file_get_contents($path);
    if ($content === false) return null;

    $skill = ['content' => '', 'meta' => []];

    // 解析 YAML frontmatter (--- ... ---)
    if (preg_match('/^---\s*\n(.*?)\n---\s*\n(.*)$/s', $content, $m)) {
        $yamlStr = $m[1];
        $skill['content'] = trim($m[2]);

        // 简易 YAML 解析（支持3层嵌套）
        $lines = explode("\n", $yamlStr);
        $currentKey = '';
        $currentSubKey = '';  // 2层嵌套当前key (如 oneapichat)

        foreach ($lines as $line) {
            if (trim($line) === '' || trim($line)[0] === '#') continue;

            // 顶级字段 (0缩进)
            if (preg_match('/^(\w[\w-]*):\s*(.*)$/', $line, $lm)) {
                $currentKey = $lm[1];
                $currentSubKey = '';
                $val = trim($lm[2]);
                if ($val !== '') {
                    $skill['meta'][$currentKey] = $val;
                } else {
                    $skill['meta'][$currentKey] = [];
                }
                continue;
            }

            // 缩进2空格: 第2层嵌套 (如 metadata: → oneapichat:)
            if (preg_match('/^  (\w[\w-]*):\s*(.*)$/', $line, $lm)) {
                $subKey = $lm[1];
                $subVal = trim($lm[2]);

                if ($currentKey === 'metadata') {
                    if (!isset($skill['meta']['metadata'])) $skill['meta']['metadata'] = [];
                    if ($subVal !== '') {
                        $skill['meta']['metadata'][$subKey] = $subVal;
                    } else {
                        $skill['meta']['metadata'][$subKey] = [];
                    }
                    $currentSubKey = $subKey;  // 记录当前2层key
                }
                continue;
            }

            // 缩进4空格: 第3层嵌套 (如 oneapichat: → tools: / emoji: / triggers:)
            if (preg_match('/^    (\w[\w-]*):\s*(.*)$/', $line, $lm) && $currentSubKey !== '') {
                $deepKey = $lm[1];
                $deepVal = trim($lm[2]);

                // 确保路径存在: meta.metadata.{oneapichat}
                if (!isset($skill['meta']['metadata'][$currentSubKey])) {
                    $skill['meta']['metadata'][$currentSubKey] = [];
                }

                if ($deepVal !== '') {
                    // 行内数组: tools: [a, b, c]
                    if (preg_match('/^\[(.*)\]$/', $deepVal, $arrMatch)) {
                        $items = array_values(array_filter(array_map('trim', explode(',', $arrMatch[1])), function($t) { return $t !== ''; }));
                        $skill['meta']['metadata'][$currentSubKey][$deepKey] = $items;
                    } else {
                        $skill['meta']['metadata'][$currentSubKey][$deepKey] = $deepVal;
                    }
                } else {
                    $skill['meta']['metadata'][$currentSubKey][$deepKey] = [];
                }
                continue;
            }

            // 缩进6空格: 第3层列表项 (如 triggers 的 - item)
            if (preg_match('/^      -\s*(.*)$/', $line, $lm) && $currentSubKey !== '') {
                $itemVal = trim($lm[1]);
                if ($itemVal === '') continue;

                // 找到最后一个赋值的3层key作为列表目标
                $target = &$skill['meta']['metadata'][$currentSubKey];
                if (is_array($target)) {
                    // 找最后一个值为空数组的key作为列表容器
                    $lastKey = '';
                    foreach ($target as $k => $v) {
                        if (is_array($v) && empty($v)) $lastKey = $k;
                    }
                    if ($lastKey) {
                        if (!isset($target[$lastKey]) || !is_array($target[$lastKey])) $target[$lastKey] = [];
                        $target[$lastKey][] = $itemVal;
                    }
                }
                unset($target);
            }
        }
    } else {
        $skill['content'] = $content;
    }

    return $skill;
}

switch ($action) {
    case 'list':
        $skills = [];
        $dirs = glob($skillsDir . '/*', GLOB_ONLYDIR);
        if ($dirs === false) $dirs = [];
        foreach ($dirs as $dir) {
            $name = basename($dir);
            $skillFile = $dir . '/SKILL.md';
            if (!file_exists($skillFile)) continue;
            $parsed = parseSkillFile($skillFile);
            if (!$parsed) continue;
            // 提取 oneapichat 元数据 (与 match action 一致)
            $oneapichat = $parsed['meta']['metadata']['oneapichat'] ?? [];
            // 提取 emoji
            $emoji = $oneapichat['emoji'] ?? '📦';
            if (!is_string($emoji) || empty($emoji)) $emoji = '📦';
            $skills[] = [
                'name' => $name,
                'description' => $parsed['meta']['description'] ?? '',
                'version' => $parsed['meta']['version'] ?? '0.1.0',
                'meta' => [
                    'oneapichat' => [
                        'tools' => is_array($oneapichat['tools'] ?? null) ? $oneapichat['tools'] : [],
                        'emoji' => $emoji,
                        'triggers' => is_array($oneapichat['triggers'] ?? null) ? $oneapichat['triggers'] : [],
                        'priority' => $oneapichat['priority'] ?? 'medium',
                    ],
                ],
                'size' => strlen($parsed['content']),
            ];
        }
        echo json_encode(['skills' => $skills, 'count' => count($skills)], JSON_UNESCAPED_UNICODE);
        break;

    case 'get':
        $name = preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['name'] ?? '');
        if (!$name) { echo json_encode(['error' => '缺少 name 参数']); exit; }
        $skillFile = $skillsDir . '/' . $name . '/SKILL.md';
        if (!file_exists($skillFile)) {
            http_response_code(404);
            echo json_encode(['error' => 'Skill not found']);
            exit;
        }
        $parsed = parseSkillFile($skillFile);
        echo json_encode([
            'name' => $name,
            'description' => $parsed['meta']['description'] ?? '',
            'version' => $parsed['meta']['version'] ?? '0.1.0',
            'meta' => $parsed['meta']['metadata'] ?? [],
            'content' => $parsed['content'],
        ], JSON_UNESCAPED_UNICODE);
        break;

    case 'match':
        // ★ 根据用户查询匹配相关技能
        $query = mb_strtolower($_GET['query'] ?? '', 'UTF-8');
        if (!$query) { echo json_encode(['matched' => []]); exit; }

        $matched = [];
        $dirs = glob($skillsDir . '/*', GLOB_ONLYDIR);
        if ($dirs === false) $dirs = [];
        foreach ($dirs as $dir) {
            $name = basename($dir);
            $skillFile = $dir . '/SKILL.md';
            if (!file_exists($skillFile)) continue;
            $parsed = parseSkillFile($skillFile);
            if (!$parsed) continue;

            // ★ 匹配策略: 搜索全文(描述+content)中出现的 trigger 关键词
            $desc = $parsed['meta']['description'] ?? '';
            $fullText = $desc . ' ' . $parsed['content'];
            $skillRaw = file_get_contents($skillFile);

            // 提取 triggers (支持 YAML 列表和 JSON 数组)
            $triggers = [];
            if (preg_match('/triggers:\s*\[(.*?)\]/', $skillRaw, $tm)) {
                $triggers = array_values(array_filter(array_map('trim', explode(',', $tm[1])), function($t) { return $t && $t !== '--' && $t !== '---'; }));
            } elseif (preg_match('/triggers:\s*\n((?:\s*-\s*.+\n?)*)/', file_get_contents($skillFile), $tm)) {
                $triggerLines = explode("\n", $tm[1]);
                foreach ($triggerLines as $tl) {
                    $tv = trim(preg_replace('/^\s*-\s*/', '', $tl));
                    if ($tv) $triggers[] = $tv;
                }
            }

            // 提取 tools (支持 YAML 列表 `- x` 和 JSON 数组 `[a, b]`)
            $tools = [];
            if (preg_match('/tools:\s*\[(.*?)\]/', $skillRaw, $tlm)) {
                // JSON 数组格式: [a, b, c]
                $tools = array_values(array_filter(array_map('trim', explode(',', $tlm[1])), function($t) { return $t && $t !== '--' && $t !== '---'; }));
            } elseif (preg_match('/tools:\s*\n((?:\s*-\s*.+\n?)*)/', $skillRaw, $tlm)) {
                // YAML 列表格式
                $toolLines = explode("\n", $tlm[1]);
                foreach ($toolLines as $tl) {
                    $tv = trim(preg_replace('/^\s*-\s*/', '', $tl));
                    if ($tv) $tools[] = $tv;
                }
            }

            // 提取 emoji
            $emoji = '📦';
            if (preg_match('/emoji:\s*"?(.{1,4})"?\s*$/', file_get_contents($skillFile), $em)) {
                $emoji = trim($em[1], '"\'');
            }

            // 匹配: query 包含任意 trigger
            $score = 0;
            foreach ($triggers as $t) {
                if (mb_stripos($query, $t) !== false) { $score += 10; }
            }
            // 描述文本匹配
            $descWords = preg_split('/[\s,，、\n]+/u', mb_strtolower($desc));
            foreach ($descWords as $w) {
                $w = trim($w);
                if (mb_strlen($w) > 1 && mb_stripos($query, $w) !== false) { $score += 2; }
            }
            // name 匹配
            if (mb_stripos($query, $name) !== false) { $score += 5; }

            if ($score > 0) {
                $matched[] = [
                    'name' => $name,
                    'description' => $desc,
                    'score' => $score,
                    'content' => mb_substr($parsed['content'], 0, 1000),
                    'tools' => $tools,
                    'triggers' => $triggers,
                    'emoji' => $emoji,
                ];
            }
        }

        // 按分数排序
        usort($matched, function($a, $b) { return $b['score'] - $a['score']; });

        // 返回TOP5匹配技能(前端getMatchedSkillsPrompt只取TOP3注入)
        echo json_encode(['matched' => array_slice($matched, 0, 5), 'query' => $query], JSON_UNESCAPED_UNICODE);
        break;

    default:
        echo json_encode(['error' => '未知 action: ' . $action]);
}
