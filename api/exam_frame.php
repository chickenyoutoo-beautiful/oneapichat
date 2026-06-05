<?php
$exam_id = $_GET['exam_id'] ?? '9459820';
$course_id = $_GET['course_id'] ?? '263695114';
$class_id = $_GET['class_id'] ?? '146799509';
$cpi = $_GET['cpi'] ?? '488376903';
$enc_task = $_GET['enc_task'] ?? 'dfb69177e925652bc5cef2630350b1c1';

$action = $_GET['action'] ?? '';
$proxy_url = $_GET['url'] ?? '';

if ($action === 'fetch' && $proxy_url) {
    file_put_contents('/tmp/proxy_debug.log', date('H:i:s')." FETCH: $proxy_url\n", FILE_APPEND);
    
    $ext = strtolower(pathinfo(parse_url($proxy_url, PHP_URL_PATH), PATHINFO_EXTENSION));
    $ct_map = [
        'css' => 'text/css', 'js' => 'application/javascript',
        'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif', 'webp' => 'image/webp', 'svg' => 'image/svg+xml',
        'woff' => 'font/woff', 'woff2' => 'font/woff2', 'ttf' => 'font/ttf',
        'ico' => 'image/x-icon', 'json' => 'application/json',
    ];
    $ct = $ct_map[$ext] ?? 'text/html; charset=utf-8';
    header('Content-Type: ' . $ct);
    
    if ($ext !== '' && $ext !== 'html' && $ct !== 'text/html; charset=utf-8') {
        echo fetchUrl($proxy_url);
        exit;
    }
    
    // HTML 内容：代理 + 注入
    $html = fetchUrl($proxy_url);
    if ($html && strlen($html) > 10) {
        $proxy_base = '/oneapichat/exam_frame.php?action=fetch&url=';
        
        // 替换 _HOST_ 变量
        $html = preg_replace('|_HOST_\s*=\s*"//([^"]*chaoxing\.com)"|', '_HOST_ = "/oneapichat/exam_frame.php?action=fetch&url=' . urlencode('https://') . '$1"', $html);
        $html = preg_replace('|_HOST_CP1_\s*=\s*"//([^"]*chaoxing\.com[^"]*)"|', '_HOST_CP1_ = "/oneapichat/exam_frame.php?action=fetch&url=' . urlencode('https://') . '$1"', $html);
        
        // 替换 src/href/action 属性
        $html = preg_replace_callback(
            '#(src|href|action)=(["\'])((?:https?://(?:[a-z0-9-]+\.)?chaoxing\.com[^"\']*|//[a-z0-9-]+\.chaoxing\.com[^"\']*|/(?:exam-ans|mooc)[^"\']*))\2#i',
            function($m) use ($proxy_base) {
                $url = $m[3];
                if (strpos($url, 'captcha') !== false || strpos($url, 'validate') !== false || strpos($url, 'jsbridge') !== false) {
                    return $m[0];
                }
                if (preg_match('#^//([a-z0-9.-]+\.chaoxing\.com)#', $url)) {
                    $url = 'https:' . $url;
                } elseif (preg_match('#^/(exam-ans|mooc)#', $url)) {
                    $url = 'https://mooc1.chaoxing.com' . $url;
                }
                return $m[1] . '="' . $proxy_base . urlencode($url) . '"';
            },
            $html
        );
        
        // 替换 location.href / var url
        $html = preg_replace_callback(
            '#(location\.href|var url)\s*=\s*["\']((?:https?://[^"\']*chaoxing\.com[^"\']*|/[^"\']*(?:exam-ans|mooc)[^"\']*))["\']#i',
            function($m) use ($proxy_base) {
                $url = $m[2];
                if (preg_match('#^/(exam-ans|mooc)#', $url)) {
                    $url = 'https://mooc1.chaoxing.com' . $url;
                }
                return $m[1] . '="' . $proxy_base . urlencode($url) . '"';
            },
            $html
        );
        
        // 注入脚本
        $inject = '<script>'
            . 'window._proxyFetch=function(u){if(typeof u!="string")return u;if(u.indexOf("exam_frame.php")>=0||u.indexOf("captcha")>=0||u.indexOf("validate")>=0||u.indexOf("jsbridge")>=0)return u;if(u.indexOf("chaoxing.com")>=0||u.indexOf("passport2")>=0||u.indexOf("/exam-ans/")>=0||u.indexOf("/mooc")>=0){if(u.indexOf("//")==0)u="https:"+u;else if(u.indexOf("/")==0)u="https://mooc1.chaoxing.com"+u;return "/oneapichat/exam_frame.php?action=fetch&url="+encodeURIComponent(u);}return u;};'
            . 'var _f=window.fetch;window.fetch=function(u,o){arguments[0]=typeof u==="string"?window._proxyFetch(u):u;return _f.apply(this,arguments);};'
            . 'var _x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=typeof u==="string"?window._proxyFetch(u):u;return _x.apply(this,arguments);};'
            . 'window.CXJSBridge={postNotification:function(){}};'
            . '</script>'
            . '<script src="./auto_answer.js"></script>';
        $html = str_replace('</head>', $inject . '</head>', $html);
        echo $html;
    } else {
        http_response_code(502);
        echo "获取页面失败";
    }
    exit;
}

// 尝试服务端启动考试
$pyScript = dirname(__DIR__) . '/python/api/start_exam.py';
$cmd = 'cd ' . escapeshellarg(sys_get_temp_dir() . '/AutomaticCB')
    . ' && PYTHONPATH=' . escapeshellarg(dirname(__DIR__))
    . ' python3 ' . escapeshellarg($pyScript)
    . ' --exam-id ' . escapeshellarg($exam_id)
    . ' --course-id ' . escapeshellarg($course_id)
    . ' --class-id ' . escapeshellarg($class_id)
    . ' --cpi ' . escapeshellarg($cpi)
    . ' --enc-task ' . escapeshellarg($enc_task)
    . ' 2>&1';
$output = shell_exec($cmd);
$result = json_decode($output, true);

if ($result && !isset($result['error'])) {
    renderQuestions($result['title'] ?? '', $result['questions'] ?? []);
    exit;
}

$err = $result['error'] ?? '未知错误';
$proxy_url = "/oneapichat/exam_frame.php?action=fetch&url=" . urlencode("https://mooc1-api.chaoxing.com/exam-ans/exam/phone/task-exam?taskrefId={$exam_id}&courseId={$course_id}&classId={$class_id}&cpi={$cpi}&ut=s");
?>
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>考试</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:sans-serif;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#1e293b;border-radius:12px;padding:24px;max-width:400px;width:100%;border:1px solid #334155;text-align:center}
h2{font-size:18px;margin-bottom:12px;color:#818cf8}
p{color:#94a3b8;font-size:13px;margin:12px 0;line-height:1.6}
.btn{display:block;width:100%;padding:10px;border-radius:8px;border:none;cursor:pointer;font-size:14px;text-align:center;text-decoration:none;margin:8px 0}
.btn-primary{background:#6366f1;color:#fff}
.btn-secondary{background:#334155;color:#94a3b8}
.hint{font-size:11px;color:#64748b;margin-top:8px}
</style></head><body>
<div class="card">
  <h2>📝 需要安全验证</h2>
  <p>这场考试启用了拼图验证码，<br>无法自动跳过。</p>
  <a class="btn btn-primary" href="<?=htmlspecialchars($proxy_url)?>" target="_top">打开代理页面</a>
  <a class="btn btn-secondary" href="./ocs.user.js" target="_blank">📦 安装 OCS 助手</a>
  <div class="hint" style="font-size:10px;color:#475569;word-break:break-all"><?=htmlspecialchars($err)?></div>
</div>
</body></html>
<?php

function renderQuestions($title, $questions) {
    $typeNames = ['单选题','多选题','填空题','判断题']; ?>
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title><?=htmlspecialchars($title)?></title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:sans-serif;background:#f8fafc;color:#1e293b;padding:16px;padding-top:60px}
#topbar{position:fixed;top:0;left:0;right:0;z-index:100;background:#6366f1;color:#fff;padding:10px 16px;display:flex;font-size:14px;font-weight:600}
#topbar .count{font-size:12px;opacity:0.8;margin-left:auto}
.q{border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:10px;background:#fff}
.q-title{font-size:14px;font-weight:500;margin-bottom:8px}
.q-opt{font-size:13px;color:#475569;white-space:pre-wrap;background:#f1f5f9;padding:8px;border-radius:4px}
.q-ans{font-size:12px;padding:6px 10px;border-radius:6px;margin-top:6px}
.q-ans.found{background:#dcfce7;color:#166534}
.q-ans.wait{background:#fef3c7;color:#92400e}
</style></head><body>
<div id="topbar"><span>📝 <?=htmlspecialchars(mb_substr($title,0,30))?></span><span class="count" id="p">0/<?=count($questions)?></span></div>
<div id="qs">
<?php foreach ($questions as $i => $q): $qt = $q['type'] ?? 0; ?>
<div class="q"><div class="q-title"><?=htmlspecialchars(($i+1).'. '.($q['title']??''))?><span style="font-size:10px;padding:2px 5px;border-radius:3px;background:#e2e8f0;color:#475569;margin-left:6px"><?=$typeNames[$qt]??'?'?></span></div>
<?php if (!empty($q['options'])): ?><div class="q-opt"><?=htmlspecialchars($q['options'])?></div><?php endif; ?>
<div class="q-ans wait" id="a-<?=$i?>">⏳ 搜题中...</div></div>
<?php endforeach; ?></div>
<script>var qs=<?=json_encode($questions)?>;(async()=>{var t=localStorage.getItem('auth_token')||'';for(var i=0;i<qs.length;i++){var q=qs[i];try{var r=await fetch('../chaoxing_api.php?action=search_answer&auth_token='+encodeURIComponent(t),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:q.title,options:q.options||'',type:['single','multiple','completion','judgement'][q.type]||'single'})});var d=await r.json();var e=document.getElementById('a-'+i);if(d.answer){e.textContent='✅ '+d.answer;e.className='q-ans found';}else{e.textContent='⚠️ 未找到答案';}}catch(ex){document.getElementById('a-'+i).textContent='❌ 失败';}document.getElementById('p').textContent=(i+1)+'/'+qs.length;await new Promise(r=>setTimeout(r,300));}})();</script></body></html>
<?php
}

function fetchUrl($url) {
    $pyScript = dirname(__DIR__) . '/python/api/fetch_url.py';
    $cmd = 'cd ' . escapeshellarg(sys_get_temp_dir() . '/AutomaticCB')
        . ' && PYTHONPATH=' . escapeshellarg(dirname(__DIR__))
        . ' python3 ' . escapeshellarg($pyScript)
        . ' --url ' . escapeshellarg($url)
        . ' 2>&1';
    return shell_exec($cmd);
}
