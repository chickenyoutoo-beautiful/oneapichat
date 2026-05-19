(function() {
    'use strict';
    var answered = 0, total = 0;

    function log(msg, type) {
        var div = document.getElementById('_auto_answer_log');
        if (!div) {
            div = document.createElement('div');
            div.id = '_auto_answer_log';
            div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:rgba(0,0,0,0.85);color:#0f0;font-family:monospace;font-size:11px;padding:6px 10px;max-height:120px;overflow-y:auto';
            document.body.appendChild(div);
        }
        var line = document.createElement('div');
        line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + (type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warn' ? '⚠️' : 'ℹ️') + ' ' + msg;
        div.appendChild(line);
        div.scrollTop = div.scrollHeight;
    }
    function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

    function api(url, data) {
        return new Promise(function(r) {
            var x = new XMLHttpRequest();
            x.open('POST', url, true);
            x.setRequestHeader('Content-Type', 'application/json');
            x.onload = function() { try { r(JSON.parse(x.responseText)); } catch(e) { r({}); } };
            x.onerror = function() { r({}); };
            x.timeout = 30000;
            x.ontimeout = function() { r({}); };
            x.send(JSON.stringify(data));
        });
    }

    async function main() {
        log('启动', 'info');
        await sleep(2000);

        // 提取考试参数
        var enc = (document.getElementById('enc') || {}).value || '';
        var answerId = (document.getElementById('testUserRelationId') || {}).value || '';
        var courseId = (document.querySelector('[name=courseId]') || {}).value || '';
        var classId = (document.querySelector('[name=classId]') || {}).value || '';
        var examId = (document.querySelector('[name=testPaperId], #testPaperId') || {}).value || '';
        var cpi = (document.querySelector('[name=cpi]') || {}).value || '';
        var uid = '';
        try { uid = document.cookie.match(/_uid=([^;]+)/)[1]; } catch(e) {}

        log('参数: enc=' + (enc ? '✅' : '❌') + ' answerId=' + (answerId ? '✅' : '❌'), 'info');

        // 查找题目
        var questions = [];
        document.querySelectorAll('input[name="questionId"]').forEach(function(inp) {
            var qid = inp.value;
            if (!qid) return;
            var title = '', typeCode = '0';
            var container = inp.closest('[class]') || inp.parentElement;
            if (container) {
                title = (container.querySelector('.Zy_TItle') || container).textContent.trim().substring(0, 300);
                var tm = container.querySelector('.TiMu');
                if (tm) typeCode = tm.getAttribute('data') || '0';
            }
            questions.push({ id: qid, type: typeCode, title: title });
        });

        if (questions.length === 0) {
            var seen = new Set();
            document.querySelectorAll('input[type="radio"]').forEach(function(r) {
                if (!r.name || seen.has(r.name)) return;
                seen.add(r.name);
                var container = r.closest('[class]') || r.parentElement;
                var title = container ? (container.textContent || '').trim().substring(0, 300) : '';
                questions.push({ id: r.name, type: '0', title: title });
            });
        }

        total = questions.length;
        log('找到 ' + total + ' 题', total > 0 ? 'success' : 'error');
        if (total === 0) { log('未找到题目', 'error'); return; }

        // 逐题搜索答案，通过 API 提交
        for (var i = 0; i < questions.length; i++) {
            var q = questions[i];
            if (!q.title) continue;
            var types = ['single','multiple','completion','judgement'];
            var qtype = types[parseInt(q.type)] || 'single';

            // 搜答案
            var result = await api('https://115.29.211.17/oneapichat/chaoxing_api.php?action=search_answer', {
                title: q.title, options: '', type: qtype
            });

            if (result.answer) {
                // 通过服务器 API 提交答案（不操作页面 DOM）
                var submitResult = await api('https://115.29.211.17/oneapichat/exam_frame.php?action=submit_answer_by_api', {
                    enc: enc, examAnswerId: answerId,
                    courseId: courseId, classId: classId, examId: examId, cpi: cpi,
                    userId: uid,
                    questionId: q.id, answer: result.answer, qtype: qtype
                });
                if (submitResult.success) {
                    log('第' + (i+1) + '题 ✅ ' + String(result.answer).substring(0, 30), 'success');
                    answered++;
                } else {
                    log('第' + (i+1) + '题 ⚠️ 提交失败', 'warn');
                }
            } else {
                log('第' + (i+1) + '题 ⚠️ 未找到答案', 'warn');
            }
            await sleep(300);
        }

        log('完成 ' + answered + '/' + total, answered > 0 ? 'success' : 'warn');
        if (answered > 0 && confirm('✅ 已答 ' + answered + ' 题，提交？')) {
            if (window.finalSubmitTest) { try { finalSubmitTest(); log('✅ 已提交', 'success'); } catch(e) {} }
            else { log('请手动提交', 'warn'); }
        }
    }
    setTimeout(main, 1500);
})();
