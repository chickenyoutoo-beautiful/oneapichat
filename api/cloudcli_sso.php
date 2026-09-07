<?php
/**
 * CloudCLI 管理员免密登录 SSO（在 www.naujtrats.xyz 域执行）。
 * 校验 OneAPIChat 管理员（?ot=）→ 后台调 CloudCLI 登录 → 302 到
 * developer.naujtrats.xyz/?ctok=<ctoken>，由该域 sub_filter 注入的 JS 写入
 * localStorage['auth-token'] 完成免密进入。
 */
$ot = $_GET['ot'] ?? '';
function jsonFile($p){ if(!file_exists($p)) return []; $d=@json_decode(@file_get_contents($p),true); return is_array($d)?$d:[]; }
$ok = false;
if ($ot && strlen($ot) >= 20) {
    $usersDir = '/var/www/html/oneapichat/users/';
    $sessions = jsonFile($usersDir . 'sessions.json');
    $users = jsonFile($usersDir . 'users.json');
    $uid = $sessions[$ot]['user_id'] ?? null;
    if ($uid && isset($users[$uid]) && ($users[$uid]['role'] ?? 'user') === 'root') $ok = true;
}
if (!$ok) { header('Location: https://developer.naujtrats.xyz/'); exit; }

$ctoken = '';
$ch = curl_init('http://127.0.0.1:3001/api/auth/login');
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_TIMEOUT=>8, CURLOPT_POST=>true, CURLOPT_HTTPHEADER=>['Content-Type: application/json'], CURLOPT_POSTFIELDS=>json_encode(['username'=>'naujtrats','password'=>'Startjuan190139'])]);
$res = curl_exec($ch); curl_close($ch);
if ($res) { $j = json_decode($res, true); if (!empty($j['token'])) $ctoken = $j['token']; }
header('Location: https://developer.naujtrats.xyz/?ctok=' . urlencode($ctoken));
exit;
