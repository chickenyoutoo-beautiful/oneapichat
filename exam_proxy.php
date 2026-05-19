<?php
/**
 * 考试代理 — 简化包装器
 */
$exam_id = $_GET['exam_id'] ?? '9459820';
$course_id = $_GET['course_id'] ?? '263695114';
$class_id = $_GET['class_id'] ?? '146799509';
$cpi = $_GET['cpi'] ?? '488376903';
$auth_token = $_GET['auth_token'] ?? '';
?>
<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>考试代理</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f172a;font-family:sans-serif}
#exam-frame{width:100%;height:100vh;border:none;display:block}
#topbar{position:fixed;top:0;left:0;right:0;z-index:9999;background:rgba(15,23,42,0.95);backdrop-filter:blur(8px);color:#fff;padding:8px 16px;font-size:13px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;backdrop-filter:blur(8px)}
#topbar .status{flex:1;text-align:center;color:#94a3b8;font-size:12px}
.btn{padding:4px 12px;border-radius:6px;border:1px solid #334155;color:#e2e8f0;cursor:pointer;font-size:11px;background:transparent;text-decoration:none}
.btn:hover{background:#1e293b}
</style>
</head>
<body>
<div id="topbar">
  <span style="font-weight:600;color:#818cf8">📚 考试代理</span>
  <span class="status" id="statusText">加载中...</span>
  <a class="btn" href="./ocs.user.js" target="_blank">OCS</a>
</div>
<iframe id="exam-frame" src="exam_frame.php?auth_token=<?= urlencode($auth_token) ?>&exam_id=<?=urlencode($exam_id)?>&course_id=<?=urlencode($course_id)?>&class_id=<?=urlencode($class_id)?>&cpi=<?=urlencode($cpi)?>"></iframe>
<script>
document.getElementById('exam-frame').onload = function() {
    document.getElementById('statusText').textContent = '已加载';
};
</script>
</body></html>
