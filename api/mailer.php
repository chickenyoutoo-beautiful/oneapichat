<?php
function sendVerificationCode($toEmail, $code) {
    $from = 'es5fov1bioy58erv@163.com';
    $pwd  = 'EKjbhaFd2AZH4Wtp';

    $s = @fsockopen('ssl://smtp.163.com', 465, $e, $m, 10);
    if (!$s) return false;

    $rd = function() use ($s) {
        $o = '';
        while ($l = fgets($s, 512)) { $o .= $l; if (isset($l[3]) && $l[3] === ' ') break; }
        return $o;
    };
    $wr = function($c) use ($s) { fwrite($s, $c . "\r\n"); };

    $rd(); $wr("EHLO x"); $rd();
    $wr("AUTH LOGIN"); $rd();
    $wr(base64_encode($from)); $rd();
    $wr(base64_encode($pwd));
    if (strpos($rd(), '235') === false) { $wr("QUIT"); fclose($s); return false; }

    $wr("MAIL FROM:<{$from}>"); $rd();
    $wr("RCPT TO:<{$toEmail}>"); $rd();
    $wr("DATA"); $rd();

    $subject = "=?UTF-8?B?" . base64_encode("NAUJTRATS 邮箱验证") . "?=";
    $body = <<<BODY
【NAUJTRATS】邮箱验证

验证码：{$code}

该验证码 10 分钟内有效，请勿泄露给他人。

如非本人操作，请忽略此邮件。

— NAUJTRATS
BODY;
    $wr("From: NAUJTRATS <{$from}>");
    $wr("To: <{$toEmail}>");
    $wr("Subject: {$subject}");
    $wr("MIME-Version: 1.0");
    $wr("Content-Type: text/plain; charset=utf-8");
    $wr("");
    $wr($body);
    $wr(".");
    $ok = strpos($rd(), '250') === 0;

    $wr("QUIT"); fclose($s);
    return $ok;
}

function sendResetMail($toEmail, $resetLink) {
    $from = 'es5fov1bioy58erv@163.com';
    $pwd  = 'EKjbhaFd2AZH4Wtp';

    $s = @fsockopen('ssl://smtp.163.com', 465, $e, $m, 10);
    if (!$s) return false;

    $rd = function() use ($s) {
        $o = '';
        while ($l = fgets($s, 512)) { $o .= $l; if (isset($l[3]) && $l[3] === ' ') break; }
        return $o;
    };
    $wr = function($c) use ($s) { fwrite($s, $c . "\r\n"); };

    $rd(); $wr("EHLO x"); $rd();
    $wr("AUTH LOGIN"); $rd();
    $wr(base64_encode($from)); $rd();
    $wr(base64_encode($pwd));
    if (strpos($rd(), '235') === false) { $wr("QUIT"); fclose($s); return false; }

    $wr("MAIL FROM:<{$from}>"); $rd();
    $wr("RCPT TO:<{$toEmail}>"); $rd();
    $wr("DATA"); $rd();

    $subject = "=?UTF-8?B?" . base64_encode("NAUJTRATS 重置密码") . "?=";
    $body = <<<BODY
【NAUJTRATS】重置密码

点击以下链接重置密码（1小时内有效）：

{$resetLink}

如非本人操作，请忽略此邮件。

— NAUJTRATS
BODY;
    $wr("From: NAUJTRATS <{$from}>");
    $wr("To: <{$toEmail}>");
    $wr("Subject: {$subject}");
    $wr("MIME-Version: 1.0");
    $wr("Content-Type: text/plain; charset=utf-8");
    $wr("");
    $wr($body);
    $wr(".");
    $ok = strpos($rd(), '250') === 0;

    $wr("QUIT"); fclose($s);
    return $ok;
}
