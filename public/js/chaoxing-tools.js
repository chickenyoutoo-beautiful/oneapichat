// chaoxing-tools.js — 超星工具处理器 v1.0 (Phase 3)
// chaoxingToolHandler / 刷课进度追踪

// ==================== 刷课工具处理器 ====================
async function chaoxingToolHandler(action, ids, username, password) {
    // ★ 优先 authToken，fallback deviceId（与 chaoxing.html 行为一致）
    var token = localStorage.getItem('authToken') || localStorage.getItem('deviceId') || '';
    var authSuffix = token ? '&auth_token=' + encodeURIComponent(token) : '';
    try {
        if (action === 'login') {
            var r = await fetch('/oneapichat/api/chaoxing_api.php?action=login&username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password) + authSuffix, { method: 'POST' });
            var d = await r.json();
            if (d.success) return { result: '登录成功: ' + d.username };
            var _msg = d.error || '登录失败,请检查账号密码';
            // ★ 如果是验证码问题，引导用户浏览器登录
            if (_msg.indexOf('验证码') >= 0 || _msg.indexOf('手动登录') >= 0) {
                _msg += '\n\n💡 解决方法：请先在电脑浏览器打开 https://i.chaoxing.com 用手机号+密码登录一次（可能需要滑块验证），超星会记住你的设备。登录成功后回到这里，不需要重新输入密码，直接调用 chaoxing_auth 即可。';
            }
            return { error: _msg };
        }
        if (action === 'courses') {
            var _force = ids === 'force' ? '&force=true' : '';
            var r = await fetch('/oneapichat/api/chaoxing_api.php?action=courses' + _force + authSuffix);
            var d = await r.json();
            if (d.courses) {
                var _list = d.courses.map(function(c) { return c.courseId + ': ' + c.title; }).join('\n');
                return { result: '课程列表:\n' + _list };
            }
            var _err = d.error || '获取失败';
            // ★ 如果是风控/网络问题，提示重试
            if (_err.includes('获取失败') || _err.includes('风控') || _err.includes('timeout')) {
                _err += '。可能是网络波动或超星风控，请稍后重试，或用 chaoxing_auth 先确认登录状态。';
            }
            return { error: _err };
        }
        if (action === 'start' && ids) {
            var r = await fetch('/oneapichat/api/chaoxing_api.php?action=start&ids=' + encodeURIComponent(ids) + authSuffix);
            var d = await r.json();
            if (d.success) return { result: '刷课任务已启动 (PID: ' + d.pid + ')' };
            return { error: d.error || '启动失败' };
        }
        if (action === 'status') {
            var r = await fetch('/oneapichat/api/chaoxing_api.php?action=status' + authSuffix);
            var d = await r.json();
            var logPreview = d.log ? d.log.slice(-2000) : '(无日志)';
            if (d.running) return { result: '刷课任务运行中\n\n' + logPreview };
            else return { result: '刷课任务未运行\n\n最后日志:\n' + logPreview };
        }
        if (action === 'stop') {
            await fetch('/oneapichat/api/chaoxing_api.php?action=stop' + authSuffix, { method: 'POST' });
            return { result: '刷课任务已停止' };
        }
        if (action === 'stats') {
            var r = await fetch('/oneapichat/api/chaoxing_api.php?action=stats' + authSuffix);
            var d = await r.json();
            if (d.total_courses !== undefined) {
                var msg = '📊 刷课进度统计\n';
                msg += '总课程: ' + d.total_courses + ' | 已完成: ' + d.completed + '\n';
                msg += '视频完成: ' + d.videos_done + ' | 答题完成: ' + d.works_done;
                return { result: msg };
            }
            return { error: '获取统计失败' };
        }
        if (action === 'overview') {
            // 综合总览:登录+运行状态+进度（★ 先验证登录）
            var [authR, sR, stR] = await Promise.all([
                fetch('/oneapichat/api/chaoxing_api.php?action=courses' + authSuffix),
                fetch('/oneapichat/api/chaoxing_api.php?action=status' + authSuffix),
                fetch('/oneapichat/api/chaoxing_api.php?action=stats' + authSuffix)
            ]);
            var sD = await sR.json();
            var stD = await stR.json();
            // ★ 真正检查登录状态
            var _loggedIn = false;
            try {
                var _authD = await authR.json();
                _loggedIn = !!(_authD.success || (_authD.courses !== undefined));
            } catch(e) {}
            var running = !!sD.running;
            var msg = '📋 超星刷课总览\n';
            msg += '登录状态: ' + (_loggedIn ? '✅ 已登录' : '❌ 凭证过期，需重新登录') + '\n';
            msg += '刷课状态: ' + (running ? '🟢 运行中' : '⚪ 空闲') + '\n';
            if (running && sD.log) {
                var lastLine = sD.log.split('\n').filter(function(l) { return l.indexOf('开始学习课程') >= 0; }).pop();
                if (lastLine) msg += '当前课程: ' + lastLine.replace(/.*开始学习课程: /, '') + '\n';
            }
            if (stD.total_courses !== undefined) {
                msg += '总课程: ' + stD.total_courses + ' | 已完成: ' + stD.completed + '\n';
                msg += '视频: ' + stD.videos_done + ' | 答题: ' + stD.works_done + '\n';
            }
            if (running) {
                msg += '\n💡 刷课正在运行。如需停止请调用 chaoxing_stop,如需切换课程请先停止。';
            }
            return { result: msg };
        }
        if (action === 'auth_check') {
            var r = await fetch('/oneapichat/api/chaoxing_api.php?action=courses' + authSuffix);
            if (!r.ok) return { error: '❌ 未登录,需要提供学习通手机号和密码' };
            // ★ 必须检查响应内容: HTTP 200 但 success=false 说明凭证过期
            var d = await r.json();
            if (d.success || (d.courses && d.courses.length >= 0)) {
                return { result: '✅ 学习通已登录,可直接操作' };
            }
            var _msg = d.error || '凭证失效';
            return { error: '❌ 登录凭证已过期: ' + _msg + '。请用 chaoxing_login 重新登录，需要手机号和密码。' };
        }
        if (action === 'exam_list') {
            var r = await fetch('/oneapichat/api/chaoxing_api.php?action=exam_list' + authSuffix);
            var d = await r.json();
            if (d.exams) {
                var msg = '📋 考试列表 (' + d.total + ' 场):\n';
                d.exams.forEach(function(e) {
                    var timeStr = (e.start_time && e.end_time) ? (' | ' + e.start_time + ' ~ ' + e.end_time) : '';
                    msg += '- [' + e.exam_id + '] ' + (e.course_title || '') + ' / ' + e.title + ' (' + e.status + ')' + timeStr + '\n';
                });
                return { result: msg };
            }
            return { error: d.error || '获取考试列表失败' };
        }
        if (action === 'exam_start') {
            var selectedExams = [];
            if (ids) {
                // 先用 exam_list 获取所有考试
                var elR = await fetch('/oneapichat/api/chaoxing_api.php?action=exam_list' + authSuffix);
                var elD = await elR.json();
                var targetIds = ids.split(',').map(function(s) { return parseInt(s.trim()); });
                var exams = elD.exams || [];
                exams.forEach(function(e) {
                    if (targetIds.indexOf(e.exam_id) >= 0 && e.status !== '已完成' && e.status !== '已交' && e.status !== '已交卷') {
                        selectedExams.push({ exam_id: e.exam_id, course_id: e.course_id + '', class_id: e.class_id + '', cpi: e.cpi, enc_task: e.enc_task + '' });
                    }
                });
            } else {
                // 全选
                var elR = await fetch('/oneapichat/api/chaoxing_api.php?action=exam_list' + authSuffix);
                var elD = await elR.json();
                var exams = elD.exams || [];
                exams.forEach(function(e) {
                    if (e.status !== '已完成' && e.status !== '已交' && e.status !== '已交卷') {
                        selectedExams.push({ exam_id: e.exam_id, course_id: e.course_id + '', class_id: e.class_id + '', cpi: e.cpi, enc_task: e.enc_task + '' });
                    }
                });
            }
            if (selectedExams.length === 0) return { error: '没有可开考的考试' };
            var r = await fetch('/oneapichat/api/chaoxing_api.php?action=exam_start' + authSuffix, {
                method: 'POST',
                body: JSON.stringify({ exams: selectedExams })
            });
            var d = await r.json();
            if (d.success) return { result: '✅ 考试已启动 (PID: ' + d.pid + '), 共 ' + selectedExams.length + ' 场' + (d.study_running ? '。刷课已自动暂停。' : '') };
            return { error: d.error || '启动失败' };
        }
        if (action === 'exam_status') {
            var r = await fetch('/oneapichat/api/chaoxing_api.php?action=exam_status' + authSuffix);
            var d = await r.json();
            var logPreview = d.log ? d.log.slice(-2000) : '(无日志)';
            return { result: '考试任务' + (d.running ? '运行中' : '未运行') + '\n\n日志:\n' + logPreview };
        }
        if (action === 'exam_stop') {
            await fetch('/oneapichat/api/chaoxing_api.php?action=exam_stop' + authSuffix, { method: 'POST' });
            return { result: '考试任务已停止' };
        }
        return { error: '未知操作' };
    } catch(e) {
        return { error: '刷课API错误: ' + e.message };
    }
}

// ==================== 刷课进度自动追踪 ====================
let CHAOXING_MONITOR_INTERVAL = null;
let CHAOXING_LAST_WORKS = null;
let CHAOXING_LAST_VIDEOS = null;
let CHAOXING_LAST_COURSES = null;
var CHAOXING_AUTO_REPORT_ENABLED = false;

function initChaoxingMonitor() {
    CHAOXING_AUTO_REPORT_ENABLED = localStorage.getItem('chaoxingAutoReport') === 'true';
    if (CHAOXING_AUTO_REPORT_ENABLED) startChaoxingMonitor();
}

function toggleChaoxingMonitor() {
    CHAOXING_AUTO_REPORT_ENABLED = !CHAOXING_AUTO_REPORT_ENABLED;
    localStorage.setItem('chaoxingAutoReport', CHAOXING_AUTO_REPORT_ENABLED);
    if (CHAOXING_AUTO_REPORT_ENABLED) {
        startChaoxingMonitor();
        showToast('刷课自动汇报已开启', 'success');
    } else {
        stopChaoxingMonitor();
        showToast('刷课自动汇报已关闭', 'info');
    }
}

function startChaoxingMonitor() {
    if (CHAOXING_MONITOR_INTERVAL) return;
    // 每30秒检查一次进度
    CHAOXING_MONITOR_INTERVAL = setInterval(checkChaoxingProgress, 30000);
    checkChaoxingProgress(); // 立即查一次建立基线
}

function stopChaoxingMonitor() {
    if (CHAOXING_MONITOR_INTERVAL) {
        clearInterval(CHAOXING_MONITOR_INTERVAL);
        CHAOXING_MONITOR_INTERVAL = null;
    }
}

function checkChaoxingProgress() {
    fetch('/oneapichat/api/chaoxing_api.php?action=stats&auth_token=' + getAuthToken())
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.total_courses === undefined) return;
            var now_works = d.works_done || 0;
            var now_videos = d.videos_done || 0;
            var now_completed = d.completed || 0;

            // 首次运行,建立基线
            if (CHAOXING_LAST_WORKS === null) {
                CHAOXING_LAST_WORKS = now_works;
                CHAOXING_LAST_VIDEOS = now_videos;
                CHAOXING_LAST_COURSES = now_completed;
                return;
            }

            var diff_works = now_works - CHAOXING_LAST_WORKS;
            var diff_videos = now_videos - CHAOXING_LAST_VIDEOS;
            var diff_courses = now_completed - CHAOXING_LAST_COURSES;

            if (diff_works > 0 || diff_videos > 0 || diff_courses > 0) {
                var msg = '📊 刷课进度更新';
                if (diff_works > 0) msg += ' 答题+' + diff_works;
                if (diff_videos > 0) msg += ' 视频+' + diff_videos;
                if (diff_courses > 0) msg += ' 课程+' + diff_courses;
                msg += '(答题' + now_works + ' 视频' + now_videos + ' 完成' + now_completed + '课)';

                CHAOXING_LAST_WORKS = now_works;
                CHAOXING_LAST_VIDEOS = now_videos;
                CHAOXING_LAST_COURSES = now_completed;

                // 作为系统消息插入到当前对话
                if (window.currentChatId && window.chatHistory && window.chatHistory[window.currentChatId]) {
                    window.chatHistory[window.currentChatId].push({
                        role: 'system',
                        content: '【刷课自动汇报】' + msg
                    });
                }
            }
        })
        .catch(function() {});
}



