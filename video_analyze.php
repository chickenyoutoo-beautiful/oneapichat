<?php
/**
 * video_analyze.php - 视频分析后端API (v2 修复版)
 * 
 * 接收用户上传的视频(base64或URL),使用ffmpeg提取关键帧,
 * 然后通过视觉AI分析每一帧,汇总结果返回文本描述。
 * 
 * 兼容 MiniMax VLM API (直连) 和 MCP 代理模式。
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Content-Type: application/json; charset=utf-8');

ob_end_clean(); ob_start();
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => '仅支持POST']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    http_response_code(400);
    echo json_encode(['error' => '无效的请求JSON']);
    exit;
}

$videoUrl = $input['video_url'] ?? '';
$videoBase64 = $input['video_base64'] ?? '';
$query = $input['query'] ?? '请详细描述这个视频的内容';
$framesCount = min(intval($input['frames_count'] ?? 5), 20); // 最多20帧

if (empty($videoUrl) && empty($videoBase64)) {
    http_response_code(400);
    echo json_encode(['error' => '请提供 video_url 或 video_base64']);
    exit;
}

// === 步骤0: 读取用户配置(用于视觉API) ===
$visionConfig = loadVisionConfig();
$useDirectApi = $visionConfig['direct_api'];
$visionUrl = $visionConfig['api_url'];
$visionKey = $visionConfig['api_key'];
$visionModel = $visionConfig['model'];

// === 步骤1: 将视频保存为临时文件 ===
$tmpDir = sys_get_temp_dir() . '/video_analyze_' . uniqid();
@mkdir($tmpDir, 0755, true);
$videoPath = $tmpDir . '/input_video.mp4';

try {
    if (!empty($videoUrl)) {
        // 从URL下载视频
        $ch = curl_init($videoUrl);
        $fp = fopen($videoPath, 'wb');
        curl_setopt($ch, CURLOPT_FILE, $fp);
        curl_setopt($ch, CURLOPT_TIMEOUT, 120);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        fclose($fp);
        if ($httpCode !== 200 || !file_exists($videoPath) || filesize($videoPath) === 0) {
            throw new Exception('下载视频失败, HTTP状态: ' . $httpCode);
        }
    } else {
        // base64解码
        $bin = base64_decode(preg_replace('#^data:video/[^;]+;base64,#i', '', $videoBase64));
        if ($bin === false || strlen($bin) === 0) {
            throw new Exception('base64解码失败或为空');
        }
        file_put_contents($videoPath, $bin);
    }

    // === 步骤2: 使用ffprobe获取视频信息 ===
    $videoInfo = getVideoInfo($videoPath);

    // === 步骤3: 提取关键帧 ===
    $frames = extractKeyFrames($videoPath, $tmpDir, $framesCount);

    if (empty($frames)) {
        throw new Exception('无法从视频中提取任何帧');
    }

    // === 步骤4: 并行分析所有帧 ===
    $frameAnalyses = [];
    $totalFrames = count($frames);
    @set_time_limit(300); // 允许最长5分钟
    if ($useDirectApi && function_exists('curl_multi_init')) {
        // ★ 并行请求: 多帧同时调用 VLM API
        $mh = curl_multi_init();
        $handles = [];
        for ($i = 0; $i < $totalFrames; $i++) {
            $url = rtrim($visionUrl, '/');
            $prompt = '这是视频的第' . ($i + 1) . '/' . $totalFrames . '帧。分析需求: ' . $query . '。请详细描述这一帧画面的内容,包括可见的物体、人物、场景、文字、动作等。';
            $body = json_encode([
                'model' => $visionModel,
                'prompt' => $prompt,
                'image_url' => $frames[$i]
            ]);
            $ch = curl_init($url);
            $headers = ['Content-Type: application/json'];
            if ($visionKey) $headers[] = 'Authorization: Bearer ' . $visionKey;
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $body,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 90,
                CURLOPT_CONNECTTIMEOUT => 15,
                CURLOPT_SSL_VERIFYPEER => false,
            ]);
            curl_multi_add_handle($mh, $ch);
            $handles[$i] = $ch;
        }
        // 执行并行请求(总超时120秒)
        $running = null;
        $startTime = time();
        do {
            curl_multi_exec($mh, $running);
            if ($running > 0) {
                curl_multi_select($mh, 0.5);
                if (time() - $startTime > 120) break; // 120秒总超时
            }
        } while ($running > 0);
        // 收集结果
        for ($i = 0; $i < $totalFrames; $i++) {
            $ch = $handles[$i];
            $response = @curl_multi_getcontent($ch);
            $httpCode = @curl_getinfo($ch, CURLINFO_HTTP_CODE);
            if ($httpCode === 200 && $response && strlen($response) > 0) {
                $data = @json_decode($response, true);
                if ($data) {
                    $frameAnalyses[] = $data['choices'][0]['message']['content'] ?? $data['content'] ?? $data['result'] ?? '帧' . ($i+1) . ': 分析完成';
                } else {
                    $frameAnalyses[] = '帧' . ($i+1) . ': ' . substr($response, 0, 300);
                }
            } else {
                $frameAnalyses[] = '帧' . ($i+1) . ': 分析失败(HTTP ' . intval($httpCode) . ')';
            }
            @curl_multi_remove_handle($mh, $ch);
            @curl_close($ch);
        }
        @curl_multi_close($mh);
    } else {
        // 降级: 串行分析
        for ($i = 0; $i < $totalFrames; $i++) {
            $frameAnalysis = analyzeFrame($frames[$i], $query, $i, $totalFrames, $useDirectApi, $visionUrl, $visionKey, $visionModel);
            $frameAnalyses[] = $frameAnalysis;
            gc_collect_cycles();
        }
    }

    // === 步骤5: 汇总结果 ===
    $result = buildSummary($videoInfo, $frameAnalyses, $query);

    // 清理
    cleanupTempDir($tmpDir);

    echo json_encode(['result' => $result, 'frames_analyzed' => $totalFrames], JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    cleanupTempDir($tmpDir);
    http_response_code(500);
    echo json_encode(['error' => '视频分析失败: ' . $e->getMessage()]);
}

// ============================================================
// 配置读取
// ============================================================
function loadVisionConfig() {
    // 默认: 直连 MiniMax VLM
    $config = [
        'direct_api' => true,
        'api_url' => 'https://api.minimaxi.com/v1/coding_plan/vlm',
        'api_key' => '',
        'model' => 'MiniMax-VL-01',
    ];

    // 1. 从 chat_data/config_*.json 读取
    $configFiles = glob(__DIR__ . '/chat_data/config_*.json');
    foreach ($configFiles as $cf) {
        $cfg = @json_decode(@file_get_contents($cf), true);
        if ($cfg && isset($cfg['visionApiUrl'])) {
            $config['api_url'] = $cfg['visionApiUrl'];
            $config['api_key'] = decryptXor($cfg['visionApiKey'] ?? '');
            $config['model'] = $cfg['visionModel'] ?? 'MiniMax-VL-01';
            $config['direct_api'] = (strpos($config['api_url'], '/mcp') === false);
            break;
        }
    }

    // 2. 从 config.ini 读取
    if (file_exists(__DIR__ . '/config.ini')) {
        $ini = parse_ini_file(__DIR__ . '/config.ini', true);
        $section = $ini['vision'] ?? $ini['mcp'] ?? [];
        if (!empty($section['model'])) {
            $config['model'] = $section['model'];
        }
    }

    return $config;
}

/**
 * 解密 XOR 加密的 API key (与前端 decrypt 函数一致)
 * key = 'naujtrats-secret'
 */
function decryptXor($encoded) {
    if (empty($encoded)) return '';
    $bin = base64_decode($encoded);
    if ($bin === false || strlen($bin) === 0) return $encoded;
    $key = 'naujtrats-secret';
    $keyLen = strlen($key);
    $result = '';
    for ($i = 0; $i < strlen($bin); $i++) {
        $result .= chr(ord($bin[$i]) ^ ord($key[$i % $keyLen]));
    }
    return $result;
}

// ============================================================
// 视频元信息提取
// ============================================================
function getVideoInfo($videoPath) {
    $info = [];
    $cmd = sprintf(
        'ffprobe -v quiet -print_format json -show_format -show_streams %s 2>&1',
        escapeshellarg($videoPath)
    );
    $output = shell_exec($cmd);
    if ($output) {
        $data = json_decode($output, true);
        if ($data) {
            $info['format'] = $data['format']['format_name'] ?? '';
            $info['duration'] = round(floatval($data['format']['duration'] ?? 0), 1);
            $info['size'] = intval($data['format']['size'] ?? 0);
            foreach (($data['streams'] ?? []) as $stream) {
                if ($stream['codec_type'] === 'video') {
                    $info['width'] = $stream['width'] ?? 0;
                    $info['height'] = $stream['height'] ?? 0;
                    $info['fps'] = evalFps($stream['r_frame_rate'] ?? '');
                    $info['codec'] = $stream['codec_name'] ?? '';
                    break;
                }
            }
        }
    }
    return $info;
}

function evalFps($rFrameRate) {
    if (!$rFrameRate) return 0;
    $parts = explode('/', $rFrameRate);
    if (count($parts) === 2 && intval($parts[1]) > 0) {
        return round(intval($parts[0]) / intval($parts[1]), 1);
    }
    return floatval($rFrameRate);
}

// ============================================================
// 关键帧提取
// ============================================================
function extractKeyFrames($videoPath, $tmpDir, $count) {
    $framesDir = $tmpDir . '/frames';
    @mkdir($framesDir, 0755, true);

    // 获取视频时长
    $duration = 0;
    $cmd = sprintf(
        'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 %s 2>&1',
        escapeshellarg($videoPath)
    );
    $output = shell_exec($cmd);
    if ($output) {
        $duration = floatval(trim($output));
    }

    if ($duration <= 0) $duration = 10; // fallback

    // 每秒取1帧,最多count帧
    $interval = max(1, intval($duration / $count));
    $framePattern = $framesDir . '/frame_%03d.jpg';

    $cmd = sprintf(
        'ffmpeg -i %s -vf "fps=1/%d" -q:v 2 -y %s 2>&1',
        escapeshellarg($videoPath),
        $interval,
        escapeshellarg($framePattern)
    );
    shell_exec($cmd);

    // 收集生成的帧文件
    $frameFiles = glob($framesDir . '/frame_*.jpg');
    sort($frameFiles);

    // 如果帧数不够,回退到均匀采样
    if (count($frameFiles) < min($count, 3)) {
        // 尝试间隔1秒
        $cmd = sprintf(
            'ffmpeg -i %s -vf "fps=1" -q:v 2 -y %s 2>&1',
            escapeshellarg($videoPath),
            escapeshellarg($framePattern)
        );
        shell_exec($cmd);
        $frameFiles = glob($framesDir . '/frame_*.jpg');
        sort($frameFiles);

        // 如果还少,取固定时间点
        if (count($frameFiles) < min($count, 3)) {
            $frameFiles = [];
            $step = $duration / $count;
            for ($i = 0; $i < $count; $i++) {
                $ts = intval($i * $step);
                $outFile = sprintf('%s/frame_ts_%03d.jpg', $framesDir, $i);
                $cmd = sprintf(
                    'ffmpeg -ss %d -i %s -vframes 1 -q:v 2 -y %s 2>&1',
                    $ts,
                    escapeshellarg($videoPath),
                    escapeshellarg($outFile)
                );
                shell_exec($cmd);
                if (file_exists($outFile) && filesize($outFile) > 0) {
                    $frameFiles[] = $outFile;
                }
            }
        }
    }

    // 限制最多count帧,均匀选取
    if (count($frameFiles) > $count) {
        $selected = [];
        $step = count($frameFiles) / $count;
        for ($i = 0; $i < $count; $i++) {
            $idx = intval($i * $step);
            if ($idx < count($frameFiles)) {
                $selected[] = $frameFiles[$idx];
            }
        }
        $frameFiles = $selected;
    }

    // 转为base64
    $result = [];
    foreach ($frameFiles as $f) {
        $bin = @file_get_contents($f);
        if ($bin !== false) {
            $result[] = 'data:image/jpeg;base64,' . base64_encode($bin);
        }
        @unlink($f); // 删除帧文件
    }

    return $result;
}

// ============================================================
// 单帧分析
// ============================================================
function analyzeFrame($frameBase64, $query, $index, $total, $useDirectApi, $visionUrl, $visionKey, $visionModel) {
    $prompt = '这是视频的第' . ($index + 1) . '/' . $total . '帧。分析需求: ' . $query . '。请详细描述这一帧画面的内容,包括可见的物体、人物、场景、文字、动作等。';

    if ($useDirectApi) {
        return analyzeFrameDirect($frameBase64, $prompt, $visionUrl, $visionKey, $visionModel, $index);
    } else {
        return analyzeFrameMcp($frameBase64, $prompt, $visionUrl, $index);
    }
}

/**
 * MiniMax VLM 直连模式
 */
function analyzeFrameDirect($frameBase64, $prompt, $url, $apiKey, $model, $index) {
    $url = rtrim($url, '/');

    $body = json_encode([
        'model' => $model,
        'prompt' => $prompt,
        'image_url' => $frameBase64
    ]);

    $headers = ['Content-Type: application/json'];
    if ($apiKey) {
        $headers[] = 'Authorization: Bearer ' . $apiKey;
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($httpCode === 200 && $response) {
        $data = json_decode($response, true);
        if ($data) {
            // MiniMax VLM 响应格式: { id, model, choices: [{ index, message: { role, content } }] }
            if (isset($data['choices'][0]['message']['content'])) {
                return $data['choices'][0]['message']['content'];
            }
            // 其他常见格式
            return $data['content'] ?? $data['result'] ?? $data['description'] ?? 
                   (is_string($data) ? substr($data, 0, 500) : '帧' . ($index+1) . ': 分析完成');
        }
        return substr($response, 0, 500);
    }

    $errStr = $curlError ? " (cURL: $curlError)" : '';
    return "帧" . ($index+1) . ": 分析请求失败(HTTP $httpCode$errStr)";
}

/**
 * MCP 代理模式
 */
function analyzeFrameMcp($frameBase64, $prompt, $url, $index) {
    $url = rtrim($url, '/');
    if (!str_ends_with($url, '/analyze')) {
        $url = $url . '/analyze';
    }

    $body = json_encode([
        'prompt' => $prompt,
        'image_url' => $frameBase64
    ]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && $response) {
        $data = json_decode($response, true);
        if ($data) {
            return $data['result'] ?? $data['description'] ?? $data['content'] ?? '帧' . ($index+1) . ': 分析完成';
        }
        return substr($response, 0, 500);
    }
    return "帧" . ($index+1) . ": 分析请求失败(HTTP $httpCode)";
}

// ============================================================
// 汇总结果
// ============================================================
function buildSummary($videoInfo, $frameAnalyses, $query) {
    $duration = $videoInfo['duration'] ?? 0;
    $width = $videoInfo['width'] ?? 0;
    $height = $videoInfo['height'] ?? 0;
    $fps = $videoInfo['fps'] ?? 0;
    $codec = $videoInfo['codec'] ?? '';
    $format = $videoInfo['format'] ?? '';

    $summary = "🎬 **视频分析结果**\n\n";
    $summary .= "**视频信息:**\n";
    $summary .= "- 时长: " . gmdate('i:s', intval($duration)) . " (约{$duration}秒)\n";
    if ($width && $height) {
        $summary .= "- 分辨率: {$width}x{$height}\n";
    }
    if ($fps) $summary .= "- 帧率: {$fps}fps\n";
    if ($codec) $summary .= "- 编码: {$codec}\n";
    if ($format) $summary .= "- 格式: {$format}\n";
    $summary .= "- 分析帧数: " . count($frameAnalyses) . "帧\n";
    $summary .= "\n";

    if (!empty($frameAnalyses)) {
        $summary .= "**逐帧分析 (" . count($frameAnalyses) . "帧):**\n";
        foreach ($frameAnalyses as $i => $analysis) {
            $summary .= "\n**帧 " . ($i + 1) . ":**\n";
            $summary .= $analysis . "\n";
        }
    }

    $summary .= "\n**综合结论:**\n";
    if (count($frameAnalyses) > 0) {
        $summary .= "已分析视频的" . count($frameAnalyses) . "个关键帧画面。" . 
                     "从画面内容来看," . implode('; ', array_map(function($a) { return substr($a, 0, 100); }, $frameAnalyses)) . "\n";
    }

    return $summary;
}

/**
 * 清理临时目录
 */
function cleanupTempDir($dir) {
    if (!is_dir($dir)) return;
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($files as $file) {
        if ($file->isDir()) {
            @rmdir($file->getRealPath());
        } else {
            @unlink($file->getPathname());
        }
    }
    @rmdir($dir);
}
