<?php
// 调试端点：捕获 oneapichat 的原始 API 响应
// 访问: http://xiaoxin.naujtrats.xyz/oneapichat/debug_stream.php?chat_id=xxx

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-cache');

// 读取配置
$config_file = __DIR__ . '/config.php';
if (!file_exists($config_file)) {
    die("config.php not found");
}

$config = [];
require $config_file;

// 获取参数
$question = isset($_GET['q']) ? $_GET['q'] : 'Hello, explain [object Object] in one sentence';
$model = isset($_GET['model']) ? $_GET['model'] : 'deepseek-chat';
$api_key = $config['api_key'] ?? '';
$base_url = rtrim($config['base_url'] ?? 'https://api.deepseek.com', '/');

// 读取最近聊天记录
$chat_id = isset($_GET['chat_id']) ? intval($_GET['chat_id']) : 0;
$messages = [];
if ($chat_id > 0) {
    $chats_file = __DIR__ . '/data/chats.json';
    if (file_exists($chats_file)) {
        $all_chats = json_decode(file_get_contents($chats_file), true);
        foreach ($all_chats as $chat) {
            if ($chat['id'] == $chat_id) {
                $messages = $chat['messages'] ?? [];
                break;
            }
        }
    }
}

// 如果没有消息，用测试消息
if (empty($messages)) {
    $messages = [
        ['role' => 'system', 'content' => '你是有帮助的助手。'],
        ['role' => 'user', 'content' => $question]
    ];
}

echo "=== DEBUG API REQUEST ===\n";
echo "URL: $base_url/chat/completions\n";
echo "Model: $model\n";
echo "Messages:\n";
foreach ($messages as $m) {
    echo "  [{$m['role']}]: " . substr(json_encode($m['content']), 0, 200) . "\n";
}
echo "\n";

// 发送流式请求
$payload = json_encode([
    'model' => $model,
    'messages' => $messages,
    'stream' => true,
    'max_tokens' => 500,
]);

$ch = curl_init($base_url . '/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $api_key,
    ],
    CURLOPT_WRITEFUNCTION => function($ch, $data) use(&$all_deltas) {
        static $first = true;
        static $object_count = 0;
        
        // 解码 SSE 行
        if (preg_match('/^data: (.+)$/', $data, $m)) {
            $json = json_decode(trim($m[1]), true);
            if ($json && isset($json['choices'][0]['delta'])) {
                $delta = $json['choices'][0]['delta'];
                $content = $delta['content'] ?? null;
                
                if ($first) {
                    echo "=== FIRST DELTA ===\n";
                    echo "delta: " . json_encode($delta) . "\n";
                    echo "typeof delta.content: " . gettype($content) . "\n";
                    if (is_array($content)) {
                        echo "delta.content is ARRAY: " . json_encode($content) . "\n";
                    } elseif (is_string($content)) {
                        echo "delta.content is STRING: " . json_encode($content) . "\n";
                    } elseif (is_object($content)) {
                        echo "delta.content is OBJECT: " . json_encode($content) . "\n";
                    }
                    echo "\n";
                    $first = false;
                }
                
                // 检查是否有 [object Object]
                if (is_string($content) && strpos($content, '[object Object]') !== false) {
                    $object_count++;
                    echo "!!! FOUND [object Object] in content string (count=$object_count) !!!\n";
                    echo "Content: " . json_encode($content) . "\n\n";
                }
                if (is_array($content)) {
                    foreach ($content as $i => $item) {
                        if (is_object($item) || is_array($item)) {
                            $item_str = is_array($item) ? json_encode($item) : json_encode($item);
                            if (strpos($item_str, '[object Object]') !== false || strpos($item_str, '[object') !== false) {
                                echo "!!! FOUND [object] in content array item $i: $item_str !!!\n";
                            }
                            // 检查是否有 type 字段但没有 text
                            if (is_array($item) && isset($item['type']) && !isset($item['text']) && !isset($item['content'])) {
                                echo "!!! SUSPICIOUS: content array item $i has 'type' but no text/content: " . json_encode($item) . " !!!\n";
                            }
                        }
                    }
                }
                if (is_object($content)) {
                    echo "!!! delta.content is OBJECT: " . json_encode($content) . " !!!\n";
                }
            }
        }
        return strlen($data);
    },
    CURLOPT_TIMEOUT => 30,
]);

echo "Sending streaming request...\n\n";
$result = curl_exec($ch);

if ($result === false) {
    echo "CURL ERROR: " . curl_error($ch) . "\n";
}
curl_close($ch);

echo "\n=== END DEBUG ===\n";
