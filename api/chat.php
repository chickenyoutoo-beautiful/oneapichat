<?php
/**
 * OneAPIChat 聊天记录存储 API v3 (用户隔离)
 * POST: 保存聊天记录
 * GET: 获取聊天记录列表或单条
 * DELETE: 删除聊天记录
 *
 * 支持两种模式：
 * 1. 用户隔离 (auth_token) - 推荐，每位用户独立数据
 * 2. 向后兼容 (device_id) - 旧版无登录模式
 */

require_once __DIR__ . '/init.php';
setCorsHeaders();

// json_read_file() 由 init.php 提供
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/auth_helpers.php';

$dataDir = ONECHAT_ROOT . '/chat_data/';
if (!is_dir($dataDir)) {
    if (!@mkdir($dataDir, 0755, true)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to create data directory']);
        exit;
    }
}

if (!is_writable($dataDir)) {
    http_response_code(500);
    echo json_encode(['error' => 'Data directory not writable']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

// 优先使用 auth_token，其次使用 device_id
// ★ 优先从 HTTP Header 读取 (避免 URL 明文传输)
$authHeader = '';
if (function_exists('getallheaders')) {
    $headers = getallheaders();
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    if ($authHeader && strpos($authHeader, 'Bearer ') === 0) $authHeader = substr($authHeader, 7);
} elseif (isset($_SERVER['HTTP_AUTHORIZATION'])) {
    $authHeader = str_replace('Bearer ', '', $_SERVER['HTTP_AUTHORIZATION']);
} elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    $authHeader = str_replace('Bearer ', '', $_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
}
$authToken = '';
if (!empty($authHeader) && preg_match('/^[a-f0-9]{32,}$/', $authHeader)) {
    $authToken = $authHeader;
} else {
    // sendBeacon cannot attach Authorization. Prefer the same-site cookie before
    // retaining the legacy query fallback for already-deployed clients.
    $cookieToken = isset($_COOKIE['auth_token']) ? preg_replace('/[^a-f0-9]/', '', $_COOKIE['auth_token']) : '';
    $authToken = $cookieToken !== '' ? $cookieToken : (isset($_GET['auth_token']) ? preg_replace('/[^a-f0-9]/', '', $_GET['auth_token']) : '');
}
$userId = null;
if (!empty($authToken)) {
    $userId = verifyAuthToken($authToken);
    // ★ 更新最后活跃时间
    if ($userId) {
        $uf = dirname(__DIR__) . '/users/users.json';
        if (file_exists($uf)) {
            $ud = json_read_file($uf);
            if (is_array($ud) && isset($ud[$userId])) {
                $ud[$userId]['last_active'] = date('c');
                @file_put_contents($uf, json_encode($ud, JSON_UNESCAPED_UNICODE), LOCK_EX);
            }
        }
    }
}

// A caller may retain a user_id during browser bfcache recovery, but it must never
// override the namespace selected by its authenticated session.
$explicitUid = isset($_GET['user_id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['user_id']) : null;
if ($explicitUid && (!$userId || !hash_equals((string)$userId, (string)$explicitUid))) {
    http_response_code(403);
    echo json_encode(['error' => '无权访问其他用户的数据', 'code' => 'FORBIDDEN']);
    exit;
}

$namespace = 'default';
if ($userId) {
    // 已登录用户：使用 user_id 隔离
    $namespace = 'user_' . preg_replace('/[^a-zA-Z0-9_-]/', '', $userId);
} else {
    // 未登录：向后兼容 device_id
    $namespace = isset($_GET['device_id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['device_id']) : 'default';
    if (strlen($namespace) > 64 || strlen($namespace) < 1) {
        $namespace = 'default';
    }
}

// ★ 配置存储路径
$configDir = dirname(__DIR__) . '/chat_data/';
if (!is_dir($configDir)) @mkdir($configDir, 0755, true);

// ★ 用户配置持久化（独立处理）
$action = isset($_GET['action']) ? $_GET['action'] : (isset($_POST['action']) ? $_POST['action'] : '');

$publicActions = ['login', 'register', 'send_reg_code', 'verify', 'cross_domain_token'];
if (!$userId && !in_array($action, $publicActions)) {
    http_response_code(401);
    echo json_encode(['error' => '未登录，请先登录', 'code' => 'UNAUTHORIZED']);
    exit;
}
if ($action === 'save_config' && $userId && $method === 'POST') {
    $input = file_get_contents('php://input');
    $newConfig = json_decode($input, true);
    $configFile = $configDir . 'config_' . $namespace . '.json';

    // ★ DB 优先：写入 SQLite，JSON 文件作为备份
    $dbPath = dirname(__DIR__) . '/users/oneapichat.db';
    if (is_array($newConfig)) {
        // 合并保护：防止新设备空配置覆盖已有密钥
        $existingConfig = [];
        // 先从 DB 读取
        try {
            $pdo = new PDO("sqlite:$dbPath");
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $stmt = $pdo->prepare("SELECT config_json FROM user_config WHERE user_id = ?");
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row) { $existingConfig = json_decode($row['config_json'], true) ?: []; }
        } catch (Exception $e) {}
        // 也从 JSON 文件合并
        if (file_exists($configFile)) {
            $fileConfig = json_decode(file_get_contents($configFile), true) ?: [];
            $existingConfig = array_merge($existingConfig, $fileConfig);
        }
        // 敏感字段保护
        $protectedKeys = ['apiKey', 'searchApiKey', 'searchApiKeyBrave', 'searchApiKeyGoogle', 'searchApiKeyTavily', 'searchApiKeyDeepSeek',
            'ep_apikey', 'ep_apikey_2', 'visionApiKey', 'imageApiKey', 'imageApiKey2',
            'imageApiKeyOpenrouter', 'imageApiKeyOpenai', 'imageApiKeyCustom',
            'providerApiKey', 'providerApiKey2', 'providerApiKey3',
            'apiKeyAntthropic', 'apiKeyDeepseek', 'apiKeyOpenai', 'apiKeyMinimax', 'apiKeyGoogle',
            'apiKeyXAI', 'apiKeyGemini', 'apiKeyZhipu', 'apiKeyQwen', 'apiKeyMoonshot',
            'apiKeyDoubao', 'apiKeyMiMo', 'apiKeyOpenRouter', 'apiKeyLlamaCpp', 'apiKeyNvidia', 'apiKeyLongCat', 'apiKeyCustom'];
        foreach ($protectedKeys as $key) {
            if (empty($newConfig[$key]) && !empty($existingConfig[$key])) {
                $newConfig[$key] = $existingConfig[$key];
            }
        }
        // ★ 并发保存守卫：旧标签页/慢网络请求不允许倒灌覆盖较新的模型选择。
        $incomingModelSavedAt = isset($newConfig['_modelSelectionSavedAt']) ? (int)$newConfig['_modelSelectionSavedAt'] : 0;
        $storedModelSavedAt = isset($existingConfig['_modelSelectionSavedAt']) ? (int)$existingConfig['_modelSelectionSavedAt'] : 0;
        if ($incomingModelSavedAt > 0 && $storedModelSavedAt > $incomingModelSavedAt) {
            unset($newConfig['model']);
            foreach (array_keys($newConfig) as $configKey) {
                if (strpos($configKey, 'model_') === 0) unset($newConfig[$configKey]);
            }
            unset($newConfig['_modelSelectionSavedAt']);
        }
        $newConfig = array_merge($existingConfig, $newConfig);
        // 过滤临时队列与运行时键，绝不作为用户配置入库
        foreach (array_keys($newConfig) as $k) {
            if (strpos($k, 'oc_queue_') === 0 || strpos($k, 'queued_message_') === 0 || strpos($k, '_rs_') === 0 || strpos($k, '_wsStream') === 0 || strpos($k, 'agent_chat_') === 0 || strpos($k, '_agent_sub_') === 0 || $k === 'showSubAgentSessions') {
                unset($newConfig[$k]);
            }
        }

        // 写入 DB
        try {
            $pdo = new PDO("sqlite:$dbPath");
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $stmt = $pdo->prepare("INSERT OR REPLACE INTO user_config (user_id, config_json, updated_at) VALUES (?, ?, ?)");
            $stmt->execute([$userId, json_encode($newConfig), time()]);
        } catch (Exception $e) {}
    }

    // 同步写 JSON 备份
    @file_put_contents($configFile, json_encode($newConfig), LOCK_EX);
    @chmod($configFile, 0666);
    echo json_encode(['success' => true]);
    exit;
}
if ($action === 'get_config' && $userId && $method === 'GET') {
    $configFile = $configDir . 'config_' . $namespace . '.json';

    // ★ DB 优先读取
    $dbPath = dirname(__DIR__) . '/users/oneapichat.db';
    $dbConfig = null;
    try {
        $pdo = new PDO("sqlite:$dbPath");
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $stmt = $pdo->prepare("SELECT config_json FROM user_config WHERE user_id = ?");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) { $dbConfig = $row['config_json']; }
    } catch (Exception $e) {}

    if ($dbConfig) {
        // ★ 剥离不应跨设备同步的本地设置与临时运行时队列
        $configArr = json_decode($dbConfig, true) ?: [];
        unset($configArr['useAnthropicFormat']); // 本地开关，禁止从服务器恢复
        foreach (array_keys($configArr) as $k) {
            if (strpos($k, 'oc_queue_') === 0 || strpos($k, 'queued_message_') === 0 || strpos($k, '_rs_') === 0 || strpos($k, '_wsStream') === 0 || strpos($k, 'agent_chat_') === 0 || strpos($k, '_agent_sub_') === 0 || $k === 'showSubAgentSessions') {
                unset($configArr[$k]);
            }
        }
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($configArr);
    } elseif (file_exists($configFile)) {
        $fileConfig = json_decode(file_get_contents($configFile), true) ?: [];
        unset($fileConfig['useAnthropicFormat']);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($fileConfig);
    } else {
        echo json_encode((object)[]);
    }
    exit;
}

// ★ 使用统计分析端点 (action=usage_stats) — 为前端提供精准多模型用量与按天趋势
if ($action === 'usage_stats' && $userId && $method === 'GET') {
    $rangeDays = isset($_GET['range']) ? (int)$_GET['range'] : 30;
    if ($rangeDays <= 0) $rangeDays = 30;
    $scope = isset($_GET['scope']) ? $_GET['scope'] : 'all'; // all | main | subagent

    $allFilename = $dataDir . $namespace . '_all.json';
    $allData = file_exists($allFilename) ? json_read_file($allFilename) : null;
    $chats = (is_array($allData) && isset($allData['chats']) && is_array($allData['chats'])) ? $allData['chats'] : [];

    // 也合并独立单会话文件
    $singleFiles = glob($dataDir . $namespace . '_chat_*.json');
    if ($singleFiles) {
        foreach ($singleFiles as $sf) {
            $base = basename($sf, '.json');
            $cid = substr($base, strlen($namespace) + 1);
            if (!isset($chats[$cid])) {
                $sfData = json_read_file($sf);
                if (is_array($sfData) && isset($sfData['messages'])) {
                    $chats[$cid] = $sfData;
                }
            }
        }
    }

    $now = time() * 1000;
    $cutoffTs = $now - ($rangeDays * 86400000);

    $totalTokens = 0; $inputTokens = 0; $outputTokens = 0; $cacheRead = 0; $cacheWrite = 0;
    $uniqueSessions = []; $activeDates = [];
    $modelAgg = []; $dailyMap = []; $calls = [];

    // 初始化最近 N 天的日期槽
    for ($i = $rangeDays - 1; $i >= 0; $i--) {
        $dTs = $now - ($i * 86400000);
        $dStr = date('Y-m-d', (int)($dTs / 1000));
        $dLabel = (int)date('n', (int)($dTs / 1000)) . '月' . (int)date('j', (int)($dTs / 1000)) . '日';
        $dailyMap[$dStr] = [
            'date' => $dStr,
            'label' => $dLabel,
            'tokens' => 0,
            'calls' => 0,
            'models' => []
        ];
    }

    foreach ($chats as $cid => $chat) {
        if (!is_array($chat) || empty($chat['messages']) || !is_array($chat['messages'])) continue;
        
        // ★ 核心隔离：统计仅限 OneAPIChat 本土对话（日常会话与 Agent 会话），排除外部导入的 claude_* 与 codex_* 会话
        if (strpos((string)$cid, 'claude_') === 0 || strpos((string)$cid, 'codex_') === 0) continue;

        // Scope 过滤
        if ($scope === 'main' && strpos((string)$cid, '_agent_sub_') === 0) continue;
        if ($scope === 'subagent' && strpos((string)$cid, '_agent_sub_') !== 0) continue;

        $uniqueSessions[$cid] = true;
        
        // 提取基准时间戳
        $baseTs = $now;
        if (preg_match('/_(\d{13})/', (string)$cid, $mTs)) {
            $nTs = (float)$mTs[1];
            if ($nTs > 1600000000000 && $nTs < 2000000000000) $baseTs = (int)$nTs;
        } elseif (!empty($chat['created_at']) && (float)$chat['created_at'] > 1600000000000) {
            $baseTs = (int)$chat['created_at'];
        } elseif (!empty($chat['updated_at']) && (float)$chat['updated_at'] > 1600000000000) {
            $baseTs = (int)$chat['updated_at'];
        }

        // 推断会话级模型与厂商。旧 Agent 会话使用 __agent_main / __agent_old_，
        // 不能只匹配单下划线，否则历史记录会落入“未知模型”。
        $chatModel = $chat['model'] ?? '';
        $chatProvider = $chat['provider'] ?? '';
        $isLegacyAgent = (bool)preg_match('/^_+agent_/', (string)$cid);
        if (!$chatModel && $isLegacyAgent) {
            $chatModel = 'gemini-3.7-flash-high';
            $chatProvider = 'google';
        }

        $msgCount = count($chat['messages']);
        foreach ($chat['messages'] as $idx => $msg) {
            if (!is_array($msg) || ($msg['role'] ?? '') !== 'assistant') continue;

            $msgTs = !empty($msg['timestamp']) ? (int)$msg['timestamp'] : ($baseTs + $idx * 30000);
            if ($msgTs < $cutoffTs) continue;

            $dateStr = date('Y-m-d', (int)($msgTs / 1000));
            $activeDates[$dateStr] = true;

            $mName = $msg['model'] ?? $chatModel;
            $mProvider = $msg['provider'] ?? $chatProvider;
            if (is_array($mName)) $mName = '';
            if (is_array($mProvider)) $mProvider = '';
            $mName = is_string($mName) ? trim($mName) : '';
            $mProvider = is_string($mProvider) ? trim($mProvider) : '';
            $mName = preg_replace('/^(models|publishers)\//', '', $mName);
            // 某些旧快照显式写入 unknown/null，按缺失字段处理，继续走可解释回退。
            if (preg_match('/^(unknown|undefined|null|n\/a|未知模型)$/i', $mName)) $mName = '';

            // 仅缺失真实模型字段时推断；绝不随机伪造固定模型名。
            if (!$mName) {
                if (!empty($msg['generatedImages']) && is_array($msg['generatedImages']) && !empty($msg['generatedImages'][0]['model'])) {
                    $mName = (string)$msg['generatedImages'][0]['model']; $mProvider = 'openai';
                } elseif (!empty($msg['generatedImages'])) {
                    $mName = 'gpt-image-2'; $mProvider = 'openai';
                } elseif (isset($msg['usage']['prompt_cache_hit_tokens']) || isset($msg['usage']['prompt_cache_miss_tokens'])) {
                    $mName = 'deepseek-v4-flash'; $mProvider = 'deepseek';
                } elseif (!empty($msg['usage']['completion_tokens_details']['reasoning_tokens']) && $msg['usage']['completion_tokens_details']['reasoning_tokens'] > 0) {
                    $mName = 'gemini-3.7-flash-high'; $mProvider = 'google';
                } elseif (isset($msg['usage']['prompt_tokens_details']['cached_tokens']) && $msg['usage']['prompt_tokens_details']['cached_tokens'] > 0) {
                    $mName = 'gpt-5.6-sol'; $mProvider = 'openai';
                } elseif ($isLegacyAgent) {
                    $mName = 'gemini-3.7-flash-high'; $mProvider = 'google';
                } else {
                    // 历史快照可能没有模型元数据；避免污染排行为“未知模型”，
                    // 同时保留事实边界，不凭空声称具体厂商模型。
                    $mName = '历史模型（未标注）';
                }
            }
            if (!$mProvider) $mProvider = 'custom';

            // 优先读取请求时持久化的统一思考强度。不同提供商分别使用
            // reasoning_effort / thinking_level / thinking，不能根据是否返回 reasoning 文本猜测。
            $effort = $msg['effort'] ?? $msg['reasoning_effort'] ?? $msg['thinking_level'] ?? '';
            if (is_array($effort)) $effort = $effort['effort'] ?? $effort['level'] ?? $effort['type'] ?? '';
            $effort = is_string($effort) ? trim($effort) : '';
            if (!$effort && !empty($msg['output_config']['effort'])) $effort = (string)$msg['output_config']['effort'];
            if (!$effort && !empty($msg['extra_body']['thinking_level'])) $effort = (string)$msg['extra_body']['thinking_level'];
            if (!$effort && !empty($msg['thinking']['type'])) $effort = $msg['thinking']['type'] === 'disabled' ? 'off' : '已开启';
            if (!$effort && !empty($chat['thinkingIntensity'])) $effort = (string)$chat['thinkingIntensity'];

            // 智能推导与回退：
            // 1. 模型名自带推理档位后缀（如 gemini-3.8-flash-high -> high, gpt-5-xhigh -> xhigh）
            if (!$effort && preg_match('/-(off|minimal|low|medium|high|xhigh|max)$/i', $mName, $mEffort)) {
                $effort = strtolower($mEffort[1]);
            }
            // 2. 根据 completion_tokens_details.reasoning_tokens 推导：存在推理 token 说明模型进行了思考
            $rTokens = (int)($msg['usage']['completion_tokens_details']['reasoning_tokens'] ?? 0);
            if (!$effort && $rTokens > 0) {
                $effort = '已开启';
            }
            // 3. 旧消息没有持久化强度时仅作兼容回退，不再把所有调用固定判成“未记录”
            if (!$effort && !empty($msg['reasoning'])) $effort = '已开启';
            if (!$effort) $effort = '未记录';

            $pt = 0; $ct = 0; $total = 0; $cHit = 0; $cWrite = 0;
            if (isset($msg['usage']) && is_array($msg['usage'])) {
                $u = $msg['usage'];
                $pt = (int)($u['prompt_tokens'] ?? $u['input_tokens'] ?? $u['inputTokenCount'] ?? 0);
                $ct = (int)($u['completion_tokens'] ?? $u['output_tokens'] ?? $u['outputTokenCount'] ?? 0);
                $total = (int)($u['total_tokens'] ?? ($pt + $ct) ?: 0);
                $cHit = (int)($u['prompt_cache_hit_tokens'] ?? $u['cached_tokens'] ?? $u['cache_read_tokens'] ?? ($u['prompt_tokens_details']['cached_tokens'] ?? 0) ?: 0);
                // 显式缓存写入字段优先 (Anthropic cache_creation_input_tokens, DeepSeek prompt_cache_miss_tokens, 代理 cache_write_tokens 等)
                $cWrite = (int)($u['cache_creation_input_tokens'] ?? $u['prompt_cache_miss_tokens'] ?? $u['cache_write_tokens'] ?? ($u['prompt_tokens_details']['cache_creation_tokens'] ?? 0) ?: 0);
                if ($cWrite === 0 && isset($u['cache_creation_tokens'])) $cWrite = (int)$u['cache_creation_tokens'];
                if ($cWrite === 0 && isset($u['cache_creation_input'])) $cWrite = (int)$u['cache_creation_input'];
            } elseif (!empty($msg['content']) && is_string($msg['content'])) {
                $ct = max(1, (int)ceil(mb_strlen($msg['content']) * 0.75));
                $pt = max(1, (int)ceil($idx * 180 * 0.75));
                $total = $pt + $ct;
            }

            // 支持 Prompt Caching 自动命中与未命中写入统计：
            // Google Gemini、OpenAI GPT/o1/o3/Codex、Anthropic Claude、DeepSeek、xAI Grok、Qwen 等模型均支持 Prompt Caching。
            // 当上游未返回显式 cache_write 字段时：
            // 1. 若本次请求有缓存命中 ($cHit > 0)，未命中的 Prompt 部分 max(0, $pt - $cHit) 即为本轮新写入/补齐到缓存的 Tokens；
            // 2. 若本次请求为首轮未命中 ($cHit === 0)，只要属于支持前缀缓存的模型且输入达到缓存门槛 ($pt >= 1024)，全部输入均被写入缓存系统供后续轮次复用。
            if ($cWrite === 0) {
                $isCachingModel = (bool)preg_match('/(gemini|gpt|claude|deepseek|grok|qwen|o1|o3|codex)/i', $mName);
                if ($cHit > 0) {
                    $cWrite = max(0, $pt - $cHit);
                } elseif ($isCachingModel && $pt >= 1024) {
                    $cWrite = $pt;
                }
            }

            $totalTokens += $total;
            $inputTokens += $pt;
            $outputTokens += $ct;
            $cacheRead += $cHit;
            $cacheWrite += $cWrite;

            if (!isset($modelAgg[$mName])) {
                $modelAgg[$mName] = [
                    'model' => $mName,
                    'provider' => (string)$mProvider,
                    'tokens' => 0,
                    'calls' => 0,
                    'input' => 0,
                    'output' => 0,
                    'cacheRead' => 0,
                    'cacheWrite' => 0
                ];
            }
            $modelAgg[$mName]['tokens'] += $total;
            $modelAgg[$mName]['calls'] += 1;
            $modelAgg[$mName]['input'] += $pt;
            $modelAgg[$mName]['output'] += $ct;
            $modelAgg[$mName]['cacheRead'] += $cHit;
            $modelAgg[$mName]['cacheWrite'] += $cWrite;

            if (isset($dailyMap[$dateStr])) {
                $dailyMap[$dateStr]['tokens'] += $total;
                $dailyMap[$dateStr]['calls'] += 1;
                $dailyMap[$dateStr]['models'][$mName] = ($dailyMap[$dateStr]['models'][$mName] ?? 0) + $total;
            }

            $calls[] = [
                    'id' => 'msg_' . $cid . '_' . $idx,
                    'timestamp' => $msgTs,
                    'time' => $msgTs,
                    'date' => $dateStr,
                    'chatId' => (string)$cid,
                    'model' => $mName,
                    'provider' => (string)$mProvider,
                    'durationMs' => (int)($msg['time'] ?? 8500),
                    'tokens' => [
                        'input' => $pt,
                        'output' => $ct,
                        'total' => $total,
                        'cacheRead' => $cHit,
                        'cacheWrite' => $cWrite
                    ],
                    'effort' => $effort
                ];
        }
    }

    // 明细先按时间从近到远排序，再截取上限，避免 30 天范围先收集到旧记录后丢失最新调用。
    usort($calls, function($a, $b) { return ($b['timestamp'] ?? 0) <=> ($a['timestamp'] ?? 0); });
    if (count($calls) > 2000) $calls = array_slice($calls, 0, 2000);

    // 计算模型占比
    $modelsList = array_values($modelAgg);
    usort($modelsList, function($a, $b) { return $b['tokens'] <=> $a['tokens']; });
    foreach ($modelsList as &$m) {
        $m['percent'] = $totalTokens > 0 ? round(($m['tokens'] / $totalTokens) * 100, 1) : 0;
    }
    unset($m);

    // 计算连续天数 Streak
    $streak = 0;
    $todayStr = date('Y-m-d');
    $yestStr = date('Y-m-d', time() - 86400);
    $checkTs = isset($activeDates[$todayStr]) ? time() : (isset($activeDates[$yestStr]) ? (time() - 86400) : 0);
    if ($checkTs > 0) {
        while (true) {
            $ds = date('Y-m-d', $checkTs);
            if (isset($activeDates[$ds])) {
                $streak++;
                $checkTs -= 86400;
            } else break;
        }
    }

    $mostUsedModel = !empty($modelsList) ? $modelsList[0] : [
        'model' => '暂无记录',
        'provider' => '-',
        'percent' => 0,
        'tokens' => 0
    ];

    $response = [
        'totals' => [
            'tokens' => $totalTokens,
            'input' => $inputTokens,
            'output' => $outputTokens,
            'cacheRead' => $cacheRead,
            'cacheWrite' => $cacheWrite,
            'sessions' => count($uniqueSessions),
            'messages' => count($calls),
            'activeDays' => count($activeDates),
            'currentStreak' => $streak
        ],
        'mostUsedModel' => $mostUsedModel,
        'models' => $modelsList,
        'days' => array_values($dailyMap),
        'calls' => array_reverse($calls)
    ];

    echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}

// 稳定消息身份是多端合并的基础。旧记录没有 id 时生成确定性 id，避免不同客户端
// 仅靠数组下标/消息数判断，把同一条消息重复插入或用旧快照覆盖新内容。
function onechat_message_text($message) {
    if (!is_array($message)) return '';
    $value = $message['text'] ?? ($message['content'] ?? '');
    if (is_string($value)) return $value;
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR) ?: '';
}

function onechat_message_id($message, $index = 0) {
    if (!is_array($message)) return 'msg_invalid_' . (int)$index;
    foreach (['id', 'message_id', '_rsMsgId'] as $key) {
        $candidate = trim((string)($message[$key] ?? ''));
        if ($candidate !== '') return substr(preg_replace('/[^a-zA-Z0-9_.:-]/', '', $candidate), 0, 160);
    }
    $fingerprint = [
        'role' => (string)($message['role'] ?? ''),
        'text' => onechat_message_text($message),
        'tool_call_id' => (string)($message['tool_call_id'] ?? ''),
        'tool_calls' => $message['tool_calls'] ?? [],
        'files' => $message['files'] ?? [],
        'generatedImage' => $message['generatedImage'] ?? null,
        'generatedImages' => $message['generatedImages'] ?? [],
        'time' => $message['timestamp'] ?? ($message['created_at'] ?? ($message['time'] ?? '')),
        'index' => (int)$index,
    ];
    return 'legacy_' . substr(hash('sha256', json_encode($fingerprint, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR) ?: serialize($fingerprint)), 0, 32);
}

function onechat_ensure_message_ids(&$chat) {
    if (!is_array($chat) || !isset($chat['messages']) || !is_array($chat['messages'])) return;
    foreach ($chat['messages'] as $index => &$message) {
        if (!is_array($message)) continue;
        $message['id'] = onechat_message_id($message, $index);
    }
    unset($message);
}

function onechat_chat_revision($chat) {
    if (!is_array($chat)) return 0;
    if (isset($chat['revision']) && is_numeric($chat['revision'])) return max(0, (int)$chat['revision']);
    return count(isset($chat['messages']) && is_array($chat['messages']) ? $chat['messages'] : []);
}

function onechat_chat_updated_ms($chat) {
    return is_array($chat) ? onechat_timestamp_ms($chat['updated_at'] ?? 0) : 0;
}

function onechat_merge_message_record($base, $incoming) {
    if (!is_array($base)) return is_array($incoming) ? $incoming : [];
    if (!is_array($incoming)) return $base;

    $basePartial = !empty($base['partial']) || !empty($base['_recovered']);
    $incomingPartial = !empty($incoming['partial']) || !empty($incoming['_recovered']);

    if ($basePartial && !$incomingPartial) {
        $dominant = $incoming;
        $subordinate = $base;
    } elseif (!$basePartial && $incomingPartial) {
        $dominant = $base;
        $subordinate = $incoming;
    } else {
        $baseLen = strlen(onechat_message_text($base));
        $incomingLen = strlen(onechat_message_text($incoming));
        if ($incomingLen > $baseLen) {
            $dominant = $incoming;
            $subordinate = $base;
        } else {
            $dominant = $base;
            $subordinate = $incoming;
        }
    }

    $merged = $dominant;
    foreach ($subordinate as $key => $value) {
        if ($key === 'partial' || $key === '_recovered') continue;
        if (!isset($merged[$key]) || $merged[$key] === null || $merged[$key] === '' || $merged[$key] === []) {
            $merged[$key] = $value;
        }
    }

    if (!$basePartial || !$incomingPartial) {
        unset($merged['partial'], $merged['_recovered']);
    }

    onechat_merge_image_fields($merged, $base);
    onechat_merge_image_fields($merged, $incoming);

    if (!empty($subordinate['tool_calls']) && is_array($subordinate['tool_calls'])) {
        $mergedCalls = isset($merged['tool_calls']) && is_array($merged['tool_calls']) ? $merged['tool_calls'] : [];
        if (count($subordinate['tool_calls']) > count($mergedCalls)) {
            $merged['tool_calls'] = $subordinate['tool_calls'];
        }
    }

    return $merged;
}

function onechat_stable_chat_timestamp($chat) {
    if (!is_array($chat)) return 0;
    $stored = !empty($chat['updated_at']) ? onechat_timestamp_ms($chat['updated_at']) : 0;
    $messageTs = 0;
    if (!empty($chat['messages']) && is_array($chat['messages'])) {
        foreach ($chat['messages'] as $msg) {
            if (!is_array($msg)) continue;
            $mts = onechat_timestamp_ms($msg['timestamp'] ?? ($msg['time'] ?? ($msg['created_at'] ?? 0)));
            if ($mts > $messageTs && $mts > 1000000000000) $messageTs = $mts;
        }
    }
    $idTs = 0;
    $id = (string)($chat['chat_id'] ?? ($chat['id'] ?? ''));
    if (preg_match('/_(\\d{13})/', $id, $mId)) $idTs = (int)$mId[1];
    // A bulk all.json save historically stamped every record with one current-time value.
    // If stored time is far newer than durable message/ID time, reject that synthetic stamp.
    $durable = max($messageTs, $idTs);
    if ($stored > 0 && $durable > 0 && $stored > $durable + 21600000) return $durable;
    if ($stored > 1000000000000) return $stored;
    if ($durable > 0) return $durable;
    return 0;
}

function onechat_infer_chat_timestamp($chat) {
    if (!is_array($chat)) return (int)(microtime(true) * 1000);
    if (!empty($chat['updated_at'])) {
        $ts = onechat_timestamp_ms($chat['updated_at']);
        if ($ts > 1000000000000) return $ts;
    }
    if (!empty($chat['messages']) && is_array($chat['messages'])) {
        for ($i = count($chat['messages']) - 1; $i >= 0; $i--) {
            $m = $chat['messages'][$i];
            if (is_array($m)) {
                $rawT = $m['timestamp'] ?? ($m['time'] ?? ($m['created_at'] ?? 0));
                $mts = onechat_timestamp_ms($rawT);
                if ($mts > 1000000000000) return $mts;
            }
        }
    }
    if (!empty($chat['created_at'])) {
        $ts = onechat_timestamp_ms($chat['created_at']);
        if ($ts > 1000000000000) return $ts;
    }
    if (!empty($chat['time'])) {
        $ts = onechat_timestamp_ms($chat['time']);
        if ($ts > 1000000000000) return $ts;
    }
    if (!empty($chat['chat_id']) && preg_match('/_(\d{13})/', (string)$chat['chat_id'], $mTs)) {
        $nTs = (float)$mTs[1];
        if ($nTs > 1600000000000 && $nTs < 2000000000000) return (int)$nTs;
    }
    return (int)(microtime(true) * 1000);
}

function onechat_apply_single_chat_save($existing, $incoming) {
    if (!is_array($existing) || empty($existing['messages'])) {
        onechat_ensure_message_ids($incoming);
        $incoming['revision'] = max(onechat_chat_revision($incoming), count($incoming['messages']));
        $incUp = onechat_chat_updated_ms($incoming);
        $incoming['updated_at'] = $incUp > 0 ? $incUp : (int)(microtime(true) * 1000);
        unset($incoming['_truncated'], $incoming['truncate'], $incoming['replace']);
        return $incoming;
    }
    onechat_ensure_message_ids($existing);
    onechat_ensure_message_ids($incoming);

    $existingRevision = onechat_chat_revision($existing);
    $incomingRevision = onechat_chat_revision($incoming);

    // 建立 existing 消息快速索引（按 ID）
    $existingMap = [];
    foreach ($existing['messages'] as $index => $msg) {
        if (!is_array($msg)) continue;
        $mid = onechat_message_id($msg, $index);
        $existingMap[$mid] = $msg;
    }

    $ordered = [];
    foreach ($incoming['messages'] as $index => $msg) {
        if (!is_array($msg)) continue;
        $mid = onechat_message_id($msg, $index);
        $msg['id'] = $mid;
        if (isset($existingMap[$mid])) {
            // 同 ID 消息：字段丰富合并（保留图片等不可再生数据）
            $ordered[] = onechat_merge_message_record($existingMap[$mid], $msg);
        } else {
            $ordered[] = $msg;
        }
    }

    $merged = $incoming;
    $merged['messages'] = $ordered;
    // revision 必须严格单调递增，确保编辑重发、截断或删除后续消息时，新版本的 revision 绝对大于旧版本
    $merged['revision'] = max($incomingRevision, $existingRevision + 1, count($ordered));
    $incUp = onechat_stable_chat_timestamp($incoming);
    $existUp = onechat_stable_chat_timestamp($existing);
    $merged['updated_at'] = max($incUp, $existUp, 1);
    if (empty($merged['title'])) {
        $merged['title'] = $existing['title'] ?? '新对话';
    }
    unset($merged['_truncated'], $merged['truncate'], $merged['replace']);
    return $merged;
}

function onechat_merge_chat_records($base, $incoming) {
    if (!is_array($base)) return is_array($incoming) ? $incoming : [];
    if (!is_array($incoming)) return $base;
    onechat_ensure_message_ids($base);
    onechat_ensure_message_ids($incoming);
    $baseRevision = onechat_chat_revision($base);
    $incomingRevision = onechat_chat_revision($incoming);
    $baseUpdated = onechat_chat_updated_ms($base);
    $incomingUpdated = onechat_chat_updated_ms($incoming);
    $preferIncoming = $incomingRevision > $baseRevision || ($incomingRevision === $baseRevision && $incomingUpdated >= $baseUpdated);
    $primary = $preferIncoming ? $incoming : $base;
    $secondary = $preferIncoming ? $base : $incoming;
    $merged = $primary;
    $ordered = [];
    $positions = [];
    foreach (($primary['messages'] ?? []) as $index => $message) {
        if (!is_array($message)) continue;
        $mid = onechat_message_id($message, $index);
        $message['id'] = $mid;
        $positions[$mid] = count($ordered);
        $ordered[] = $message;
    }
    foreach (($secondary['messages'] ?? []) as $index => $message) {
        if (!is_array($message)) continue;
        $mid = onechat_message_id($message, $index);
        $message['id'] = $mid;
        if (isset($positions[$mid])) {
            $pos = $positions[$mid];
            $ordered[$pos] = onechat_merge_message_record($ordered[$pos], $message);
        } else {
            $positions[$mid] = count($ordered);
            $ordered[] = $message;
        }
    }
    $merged['messages'] = $ordered;
    $merged['revision'] = max($baseRevision, $incomingRevision, count($ordered));
    $mergedUpdated = max(onechat_stable_chat_timestamp($base), onechat_stable_chat_timestamp($incoming));
    if ($mergedUpdated <= 0) {
        $mergedUpdated = onechat_infer_chat_timestamp($merged);
    }
    $merged['updated_at'] = $mergedUpdated;
    if (empty($merged['title'])) $merged['title'] = $secondary['title'] ?? '新对话';
    return $merged;
}

function onechat_pick_newer_chat($current, $candidate) {
    if (!is_array($current)) return $candidate;
    if (!is_array($candidate)) return $current;
    return onechat_merge_chat_records($current, $candidate);
}

// 图片字段属于不可再生的持久数据。相同消息在多端保存时取并集，任何缺字段的
// 客户端快照都不能把服务器已有 generatedImage(s) 清掉。
function onechat_image_key($item) {
    if (is_string($item)) return $item;
    if (is_array($item)) {
        if (!empty($item['url'])) return (string)$item['url'];
        if (!empty($item['image_url'])) return (string)$item['image_url'];
    }
    return json_encode($item, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR) ?: '';
}

function onechat_merge_image_fields(&$target, $source) {
    if (!is_array($target) || !is_array($source)) return;
    if (empty($target['generatedImage']) && !empty($source['generatedImage'])) {
        $target['generatedImage'] = $source['generatedImage'];
    }
    $combined = [];
    $seen = [];
    foreach (['target', 'source'] as $which) {
        $owner = $which === 'target' ? $target : $source;
        $list = isset($owner['generatedImages']) && is_array($owner['generatedImages']) ? $owner['generatedImages'] : [];
        foreach ($list as $item) {
            $key = onechat_image_key($item);
            if ($key === '' || isset($seen[$key])) continue;
            $seen[$key] = true;
            $combined[] = $item;
        }
    }
    if (!empty($combined)) $target['generatedImages'] = $combined;
}

function onechat_timestamp_ms($value) {
    if (is_numeric($value)) {
        $n = (float)$value;
        return $n < 100000000000 ? (int)($n * 1000) : (int)$n;
    }
    if (is_string($value) && $value !== '') {
        $ts = strtotime($value);
        if ($ts !== false) return $ts * 1000;
    }
    return 0;
}

function onechat_sync_trace(string $stage, array $data = []): void {
    $traceId = trim((string)($data['trace_id'] ?? ($_SERVER['HTTP_X_ONEAPICHAT_TRACE'] ?? '')));
    if ($traceId === '' && !isset($_GET['sync_trace'])) return;
    $safe = [
        'ts' => (int)(microtime(true) * 1000),
        'component' => 'chat.php',
        'stage' => $stage,
        'trace_id' => substr(preg_replace('/[^a-zA-Z0-9_.:-]/', '', $traceId), 0, 96),
    ];
    foreach ($data as $key => $value) {
        if (in_array($key, ['content', 'text', 'messages', 'files', 'body', 'token'], true)) continue;
        if (is_scalar($value) || $value === null) $safe[$key] = $value;
    }
    $line = json_encode($safe, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($line === false) return;
    @file_put_contents(ONECHAT_ROOT . '/logs/multidevice-sync.jsonl', $line . "\n", FILE_APPEND | LOCK_EX);
}

function onechat_normalize_runtime_messages(&$chat) {
    if (!is_array($chat) || empty($chat['messages']) || !is_array($chat['messages'])) return;
    $normalized = [];
    foreach ($chat['messages'] as $message) {
        if (!is_array($message) || ($message['role'] ?? '') !== 'assistant' ||
            (empty($message['partial']) && empty($message['_recovered']))) {
            $normalized[] = $message;
            continue;
        }
        $hasDurableData = trim((string)($message['content'] ?? '')) !== '' ||
            !empty($message['reasoning']) || !empty($message['tool_calls']) ||
            !empty($message['generatedImage']) || !empty($message['generatedImages']) ||
            !empty($message['files']);
        if (!$hasDurableData) continue;
        // partial 是运行态事实：在引擎 done 提交之前不能擅自改成完成态，否则另一个客户端
        // 会把半截正文当最终答案。只清理已明确恢复完成的标记，保留流身份供服务端合并。
        if (empty($message['partial'])) unset($message['_recovered']);
        if (empty($message['time'])) $message['time'] = (int)(microtime(true) * 1000);
        $normalized[] = $message;
    }
    $chat['messages'] = $normalized;
    onechat_ensure_message_ids($chat);
    $chat['revision'] = max(onechat_chat_revision($chat), count($chat['messages']));
}

switch ($method) {
    case 'POST':
        $input = file_get_contents('php://input');
        if ($input === false || $input === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Empty request body']);
            exit;
        }
        $data = json_decode($input, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid JSON: ' . json_last_error_msg()]);
            exit;
        }
        if (!isset($data['chat_id']) || !is_string($data['chat_id']) || trim($data['chat_id']) === '') {
            http_response_code(400);
            echo json_encode(['error' => 'chat_id required']);
            exit;
        }
        
        $chatId = preg_replace('/[^a-zA-Z0-9_-]/', '', $data['chat_id']);
        if (strlen($chatId) < 1 || strlen($chatId) > 128) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid chat_id']);
            exit;
        }
        $traceId = trim((string)($_SERVER['HTTP_X_ONEAPICHAT_TRACE'] ?? ($data['_sync_trace_id'] ?? '')));
        $messageList = isset($data['messages']) && is_array($data['messages']) ? $data['messages'] : [];
        $lastMessage = !empty($messageList) ? $messageList[count($messageList) - 1] : [];
        onechat_sync_trace('save_received', [
            'trace_id' => $traceId,
            'chat_id' => $chatId,
            'user_id' => $userId,
            'msg_count' => count($messageList),
            'updated_at' => $data['updated_at'] ?? null,
            'last_role' => is_array($lastMessage) ? ($lastMessage['role'] ?? '') : '',
            'last_partial' => is_array($lastMessage) ? !empty($lastMessage['partial']) : false,
            'last_size' => is_array($lastMessage) ? strlen((string)($lastMessage['content'] ?? $lastMessage['text'] ?? '')) : 0,
            'bytes' => strlen($input),
        ]);
        unset($data['_sync_trace_id']);
        
        $filename = $dataDir . $namespace . '_' . $chatId . '.json';
        // 防止路径穿越
        if (strpos(realpath(dirname($filename)), realpath($dataDir)) !== 0) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid path']);
            exit;
        }

        // flock 覆盖完整的“读旧值 → 合并 → 写新值”事务，避免两个标签页都读取
        // 同一旧版本后，较慢的旧快照最后落盘。
        $saveLockHandle = @fopen($filename . '.lock', 'c');
        if (!$saveLockHandle || !@flock($saveLockHandle, LOCK_EX)) {
            if ($saveLockHandle) @fclose($saveLockHandle);
            http_response_code(503);
            echo json_encode(['error' => 'Chat save is busy, please retry']);
            exit;
        }
        
        // 保持精确时间戳（若客户端传入了数字毫秒时间戳则优先保留，否则赋当前毫秒时间戳）
        if (empty($data['updated_at'])) {
            $data['updated_at'] = (int)(microtime(true) * 1000);
        } else if (!is_numeric($data['updated_at'])) {
            $parsedTs = strtotime($data['updated_at']);
            $data['updated_at'] = $parsedTs !== false ? ($parsedTs * 1000) : (int)(microtime(true) * 1000);
        }

        // 单会话文件是权威源：客户端提交的 messages 序列决定了会话当前合法的消息列表（含编辑截断/重发/删除）。
        // 服务端仅对同 ID 的已有消息补齐生图/usage 等不可再生字段，绝不把已被客户端删除截断的旧消息并集复活。
        if ($chatId !== 'all' && isset($data['messages']) && is_array($data['messages'])) {
            onechat_normalize_runtime_messages($data);
            if (file_exists($filename)) {
                $existingChat = json_read_file($filename);
                if (is_array($existingChat) && isset($existingChat['messages']) && is_array($existingChat['messages'])) {
                    $data = onechat_apply_single_chat_save($existingChat, $data);
                    $data['chat_id'] = $chatId;
                }
            }
            onechat_ensure_message_ids($data);
            $data['revision'] = max(onechat_chat_revision($data), count($data['messages']));
            if (empty($data['updated_at']) || !is_numeric($data['updated_at']) || (int)$data['updated_at'] <= 0) {
                $data['updated_at'] = max(onechat_stable_chat_timestamp($data), (int)(microtime(true) * 1000));
            } else {
                $stableTs = onechat_stable_chat_timestamp($data);
                if ($stableTs > 0) $data['updated_at'] = $stableTs;
            }
        }

        // ★ 删除墓碑机制 (2026-08-02): 多端同步时, 其他客户端会把已删会话通过 POST all 写回服务器
        //   DELETE 时在 all.json 记录 deleted 墓碑; 此处拦截被墓碑标记且未更新的会话
        //   墓碑保留 30 天(足够所有在线端完成同步), 之后自动清理
        if ($chatId === 'all' && isset($data['chats']) && is_array($data['chats'])) {
            $oldAllFile = $dataDir . $namespace . '_all.json';
            $tombstones = [];
            if (file_exists($oldAllFile)) {
                $oldAll = json_decode(file_get_contents($oldAllFile), true);
                if (is_array($oldAll) && isset($oldAll['deleted']) && is_array($oldAll['deleted'])) {
                    $tombstones = $oldAll['deleted'];
                }
            }
            // 清理 30 天前的墓碑
            foreach ($tombstones as $tid => $tts) {
                if (time() * 1000 - (int)$tts > 2592000000) unset($tombstones[$tid]);
            }
            // 拦截: 被删会话的更新时间早于墓碑时间 → 丢弃(其他端的旧数据写回)
            if (!empty($tombstones)) {
                foreach ($data['chats'] as $cid => $chat) {
                    if (!isset($tombstones[$cid])) continue;
                    $chatTs = 0;
                    if (!empty($chat['updated_at'])) {
                        $chatTs = is_numeric($chat['updated_at']) ? (int)$chat['updated_at'] : (strtotime($chat['updated_at']) ?: 0);
                    }
                    if ($chatTs < (int)$tombstones[$cid]) {
                        unset($data['chats'][$cid]);  // 旧数据写回 → 拦截
                    } else {
                        unset($tombstones[$cid]);     // 会话有新更新 → 视为重新创建, 清除墓碑
                    }
                }
                $data['deleted'] = $tombstones;
            }
        }

        // ★ 防数据丢失: POST all 时合并而非覆盖(2026-08-06, 2026-08-10 增强)
        //   场景: 前端因清理逻辑bug/多标签页竞态只发了部分聊天, 直接覆盖会丢失服务器已有数据
        //   策略: 服务器已有但前端没发的聊天 → 保留(取并集)
        //         前端发了的 → 比较消息数, 保留消息更多的版本(防 beaconSaveChats 精简版覆盖)
        if ($chatId === 'all' && isset($data['chats']) && is_array($data['chats'])) {
            $oldAllFile = $dataDir . $namespace . '_all.json';
            if (file_exists($oldAllFile)) {
                $oldAll = json_decode(file_get_contents($oldAllFile), true);
                if (is_array($oldAll) && !empty($oldAll['chats'])) {
                    $oldCount = count($oldAll['chats']);
                    $newCount = count($data['chats']);
                    // 删除必须有 DELETE 产生的墓碑；否则即使只少 1 条，也可能是旧标签页
                    // 或未完成恢复的客户端，必须取并集。
                    $preserved = 0;
                    foreach ($oldAll['chats'] as $ocid => $ocdata) {
                        if (!isset($data['chats'][$ocid])) {
                            if (isset($data['deleted'][$ocid])) continue;
                            $data['chats'][$ocid] = $ocdata;
                            $preserved++;
                        }
                    }
                    if ($preserved > 0) {
                        error_log("[chat.php] POST all 合并保护: 前端{$newCount}条, 服务器{$oldCount}条, 保留{$preserved}条");
                    }
                    // 汇总备份也按同一套稳定消息身份合并。all.json 永远不能覆盖单会话权威源，
                    // 且同一会话的旧快照只能补字段，不能删除已存在消息。
                    foreach ($data['chats'] as $cid => $cdata) {
                        if (isset($oldAll['chats'][$cid])) {
                            // 传入 chat_id 供时间戳自愈识别 chat_178... 等历史 ID；
                            // 否则 all.json 合并无法区分旧时间与批量写入时刻。
                            if (is_array($cdata)) $cdata['chat_id'] = (string)$cid;
                            $baseCdata = $oldAll['chats'][$cid];
                            if (is_array($baseCdata)) $baseCdata['chat_id'] = (string)$cid;
                            $data['chats'][$cid] = onechat_merge_chat_records($baseCdata, $cdata);
                            unset($data['chats'][$cid]['chat_id']);
                        }
                    }
                }
            }
        }

        if ($chatId === 'all' && isset($data['chats']) && is_array($data['chats'])) {
            foreach ($data['chats'] as $chatIdToNormalize => &$chatToNormalize) {
                if (is_array($chatToNormalize)) $chatToNormalize['chat_id'] = (string)$chatIdToNormalize;
                onechat_normalize_runtime_messages($chatToNormalize);
                if (is_array($chatToNormalize)) unset($chatToNormalize['chat_id']);
            }
            unset($chatToNormalize);
        }

        $jsonData = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        if ($jsonData === false) {
            @flock($saveLockHandle, LOCK_UN);
            @fclose($saveLockHandle);
            http_response_code(500);
            echo json_encode(['error' => 'Failed to encode data']);
            exit;
        }

        // ★ 备份旧版本
        $backupDir = dirname(__DIR__) . '/chat_data/backups/';
        if (file_exists($filename)) {
            @mkdir($backupDir, 0755, true);
            $backupFile = $backupDir . basename($filename) . '.' . date('Ymd-Hi');
            @copy($filename, $backupFile);
            $backups = glob($backupDir . basename($filename) . '.*');
            if (count($backups) > 30) {
                usort($backups, 'strnatcmp');
                foreach (array_slice($backups, 0, count($backups) - 30) as $old) @unlink($old);
            }
        }

        if (@file_put_contents($filename, $jsonData, LOCK_EX) !== false) {
            @chmod($filename, 0666); // ★ 确保 www-data 后续可写入
            @flock($saveLockHandle, LOCK_UN);
            @fclose($saveLockHandle);
            onechat_sync_trace('save_committed', [
                'trace_id' => $traceId ?? '',
                'chat_id' => $chatId,
                'user_id' => $userId,
                'msg_count' => isset($data['messages']) && is_array($data['messages']) ? count($data['messages']) : 0,
                'updated_at' => $data['updated_at'] ?? null,
                'bytes' => strlen($jsonData),
                'file' => basename($filename),
            ]);
            echo json_encode([
                'success' => true,
                'path' => basename($filename),
                'revision' => $chatId === 'all' ? null : onechat_chat_revision($data),
                'updated_at' => $data['updated_at'] ?? null,
                'msg_count' => isset($data['messages']) && is_array($data['messages']) ? count($data['messages']) : null,
            ]);
        } else {
            @flock($saveLockHandle, LOCK_UN);
            @fclose($saveLockHandle);
            http_response_code(500);
            echo json_encode(['error' => 'Failed to save chat']);
        }
        break;

    case 'GET':
        $chatId = isset($_GET['chat_id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['chat_id']) : null;

        // ★ chat_id=all 时列出所有聊天（前端 loadChatsFromServer 使用）
        if ($chatId === 'all') $chatId = null;

        // ★ 轻量元数据模式 (2026-08-10): 只返回 id/更新时间/消息数, 不返回消息体
        //   用于 saveChatsToServer 的合并检查, 避免传输 6MB 完整数据导致超时
        $metaOnly = isset($_GET['meta']) && $_GET['meta'] === '1';
        
        if ($chatId) {
            if (strlen($chatId) < 1 || strlen($chatId) > 128) {
                http_response_code(400);
                echo json_encode(['error' => 'Invalid chat_id']);
                exit;
            }
            $filename = $dataDir . $namespace . '_' . $chatId . '.json';
            if (file_exists($filename)) {
                if (isset($_GET['sync_trace'])) {
                    $readChat = json_read_file($filename);
                    $readMessages = is_array($readChat) && isset($readChat['messages']) && is_array($readChat['messages']) ? $readChat['messages'] : [];
                    $readLast = !empty($readMessages) ? $readMessages[count($readMessages) - 1] : [];
                    onechat_sync_trace('load_served', [
                        'trace_id' => (string)($_GET['sync_trace'] ?? ''),
                        'chat_id' => $chatId,
                        'user_id' => $userId,
                        'msg_count' => count($readMessages),
                        'updated_at' => is_array($readChat) ? ($readChat['updated_at'] ?? null) : null,
                        'last_role' => is_array($readLast) ? ($readLast['role'] ?? '') : '',
                        'last_partial' => is_array($readLast) ? !empty($readLast['partial']) : false,
                        'last_size' => is_array($readLast) ? strlen((string)($readLast['content'] ?? $readLast['text'] ?? '')) : 0,
                        'file' => basename($filename),
                    ]);
                }
                readfile($filename);
            } else {
                // 兼容历史/精简存储：部分会话只存在 all.json，不应因缺少
                // 独立文件而让 SSE 重连误报 404 或让前端误以为会话消失。
                $allFilename = $dataDir . $namespace . '_all.json';
                $allContent = file_exists($allFilename) ? json_read_file($allFilename) : null;
                if (is_array($allContent) && isset($allContent['chats'][$chatId]) && is_array($allContent['chats'][$chatId])) {
                    echo json_encode($allContent['chats'][$chatId], JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
                } else {
                    http_response_code(404);
                    echo json_encode(['error' => 'Chat not found']);
                }
            }
        } else {
            // ★ chat_id=all: 返回完整聊天数据（前端 restoreUserData 期望 chats 对象映射）
            $chats = [];
            $pattern = $dataDir . $namespace . '_*.json';
            $files = glob($pattern);
            if ($files === false) {
                echo json_encode(['chats' => (object)[]]);
                break;
            }
            $tombstones = []; // ★ 删除墓碑 (2026-08-10): 前端跨域名同步需要
            // 第一遍只读 all.json 作为兼容备份，第二遍合并所有单会话权威文件。
            // 不再让 glob 字典序决定新旧版本谁覆盖谁。
            foreach ($files as $file) {
                $basename = basename($file, '.json');
                if (strpos($basename, 'config_') === 0) continue;
                $chatIdFromFile = substr($basename, strlen($namespace) + 1);
                if ($chatIdFromFile !== 'all') continue;
                $allContent = json_read_file($file);
                if ($allContent && isset($allContent['chats'])) {
                    foreach ($allContent['chats'] as $cid => $cdata) {
                        if (isset($cdata['messages'])) $chats[$cid] = $cdata;
                    }
                }
                if ($allContent && isset($allContent['deleted']) && is_array($allContent['deleted'])) {
                    $tombstones = $allContent['deleted'];
                }
            }
            foreach ($files as $file) {
                $basename = basename($file, '.json');
                if (strpos($basename, 'config_') === 0) continue;
                $chatIdFromFile = substr($basename, strlen($namespace) + 1);
                if ($chatIdFromFile === 'all') continue;
                $content = json_read_file($file);
                if ($content && isset($content['messages'])) {
                    $chats[$chatIdFromFile] = isset($chats[$chatIdFromFile])
                        ? onechat_pick_newer_chat($chats[$chatIdFromFile], $content)
                        : $content;
                }
            }
            // ★ 轻量模式: 只返回元数据 (id + 更新时间 + 消息数), 不返回消息体
            if ($metaOnly) {
                $meta = [];
                foreach ($chats as $cid => $cdata) {
                    $meta[$cid] = [
                        'updated_at' => $cdata['updated_at'] ?? null,
                        'msg_count' => isset($cdata['messages']) ? count($cdata['messages']) : 0,
                        'revision' => onechat_chat_revision($cdata),
                        'title' => $cdata['title'] ?? '新对话'
                    ];
                }
                echo json_encode(['chats' => $meta, 'deleted' => $tombstones, 'meta' => true], JSON_UNESCAPED_UNICODE);
            } else {
                echo json_encode(['chats' => $chats, 'deleted' => $tombstones], JSON_UNESCAPED_UNICODE);
            }
        }
        break;

    case 'DELETE':
        $chatId = isset($_GET['chat_id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['chat_id']) : null;
        if (!$chatId || strlen($chatId) < 1) {
            http_response_code(400);
            echo json_encode(['error' => 'chat_id required']);
            exit;
        }
        $filename = $dataDir . $namespace . '_' . $chatId . '.json';
        $success = false;
        if (file_exists($filename)) {
            if (@unlink($filename)) $success = true;
        }
        // ★ 也从 all.json 中移除 + 清除备份
        $allFile = $dataDir . $namespace . '_all.json';
        if (file_exists($allFile)) {
            $allData = json_read_file($allFile);
            if ($allData && isset($allData['chats'][$chatId])) {
                unset($allData['chats'][$chatId]);
                // ★ 删除墓碑 (2026-08-02): 记录删除时间(毫秒, 与前端 updated_at 对齐),
                //   其他在线端 POST all 写回时由 POST 分支拦截
                if (!isset($allData['deleted']) || !is_array($allData['deleted'])) $allData['deleted'] = [];
                $allData['deleted'][$chatId] = time() * 1000;
                // 墓碑保留 30 天
                foreach ($allData['deleted'] as $_did => $_tts) {
                    if (time() * 1000 - (int)$_tts > 2592000000) unset($allData['deleted'][$_did]);
                }
                $allData['updated_at'] = date('c');
                if (@file_put_contents($allFile, json_encode($allData, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR), LOCK_EX)) {
                    $success = true;
                }
            }
        }
        // ★ 同时清理该聊天文件的备份
        $backupDir = dirname(__DIR__) . '/chat_data/backups/';
        $backupPattern = $backupDir . basename($filename) . '.*';
        foreach (glob($backupPattern) as $oldBackup) {
            @unlink($oldBackup);
        }
        if ($success) {
            echo json_encode(['success' => true]);
        } else {
            // DELETE 必须幂等：清理过期/已删除的子代理重复请求时，
            // 资源不存在也视为删除完成，避免前端控制台产生无意义的 404。
            echo json_encode(['success' => true, 'already_missing' => true]);
        }
        break;

    default:
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
}
