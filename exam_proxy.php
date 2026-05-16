<?php
// Exam page proxy - embeds exam with modified HTML
$exam_id = $_GET['exam_id'] ?? '9459820';
$course_id = $_GET['course_id'] ?? '263695114';
$class_id = $_GET['class_id'] ?? '146799509';
$cpi = $_GET['cpi'] ?? '488376903';

$url = "https://mooc1-api.chaoxing.com/exam-ans/exam/phone/task-exam?taskrefId=$exam_id&courseId=$course_id&classId=$class_id&cpi=$cpi&ut=s";

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_COOKIEFILE, '/tmp/chaoxing_cookies.txt');
curl_setopt($ch, CURLOPT_COOKIEJAR, '/tmp/chaoxing_cookies.txt');
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Linux; Android 10; K)');
$html = curl_exec($ch);
curl_close($ch);

if ($html === false) { echo "Failed to fetch exam page"; exit; }

// Modify HTML  
$html = preg_replace('/id="appExamClientSign"\s*value="[^"]*"/', 'id="appExamClientSign" value="false"', $html);
$html = preg_replace('/id="chaoXingAppSignVersion"\s*value="[^"]*"/', 'id="chaoXingAppSignVersion" value="0"', $html);
$html = preg_replace('/id="captchaCheck"\s*value="[^"]*"/', 'id="captchaCheck" value="0"', $html);

echo $html;
