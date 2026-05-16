#!/usr/bin/env node
/**
 * 超星考试浏览器自动化 (Node.js + agent-browser)
 * 用法: node exam_browser.js <exam_id> <course_id> <class_id> <cpi>
 */
const { execSync } = require('child_process');

const AB = 'agent-browser';
const [examId, courseId, classId, cpi, encTask] = process.argv.slice(2);
const autoSubmit = process.argv[6] !== 'false';

const START_URL = `https://mooc1-api.chaoxing.com/exam-ans/exam/phone/start?courseId=${courseId}&classId=${classId}&examId=${examId}&source=0&cpi=${cpi}&keyboardDisplayRequiresUserAction=1&faceDetection=0&jt=0&code=&vx=0&examsignal=1`;

function cmd(c) {
    try { return execSync(`${AB} ${c}`, {timeout: 30000, encoding:'utf8'}); }
    catch(e) { return e.stdout || ''; }
}

function sleep(ms) { execSync(`sleep ${ms/1000}`); }

async function main() {
    console.error(`[$(date +%T)] Browser exam: ${examId}`);

    // 1. Open exam page
    console.error('[INFO] Opening exam...');
    cmd(`open "${START_URL}"`);
    sleep(3000);

    // 2. Snapshot to check state  
    let snap = cmd('snapshot -i');
    console.error(snap);

    // 3. Click "开始考试" if visible
    if (snap.includes('开始考试')) {
        const ref = snap.match(/@e\d+/g)?.find(r => {
            const line = snap.split('\n').find(l => l.includes(r));
            return line && line.includes('开始考试');
        });
        if (ref) {
            console.error(`[INFO] Clicking start: ${ref}`);
            cmd(`click ${ref}`);
            sleep(3000);
            // Check for confirmation dialog
            try { cmd('dialog accept'); } catch(e) {}
            sleep(2000);
        }
    }

    // 4. Get current question
    snap = cmd('snapshot -i');
    console.error(snap);

    let qCount = 0;
    const maxQ = 50;

    while (qCount < maxQ) {
        snap = cmd('snapshot -i');
        
        // Check for completion
        if (snap.includes('交卷成功') || snap.includes('考试结束')) {
            console.error(`[DONE] ${qCount} questions answered`);
            break;
        }
        if (snap.includes('无权限') || snap.includes('时间已到')) {
            console.error(`[ERROR] ${snap.match(/无权限.*|时间已到.*/)?.[0]}`);
            break;
        }

        // Try to find next button and click it
        const nextRef = snap.match(/@e\d+/g)?.find(r => {
            const line = snap.split('\n').find(l => l.includes(r));
            return line && /下一题|next/i.test(line);
        });
        if (nextRef) {
            cmd(`click ${nextRef}`);
            sleep(2000);
            qCount++;
        } else {
            // Maybe last question? Try submit
            const submitRef = snap.match(/@e\d+/g)?.find(r => {
                const line = snap.split('\n').find(l => l.includes(r));
                return line && /交卷|submit/i.test(line);
            });
            if (submitRef && autoSubmit) {
                console.error('[INFO] Submitting exam...');
                cmd(`click ${submitRef}`);
                sleep(2000);
                try { cmd('dialog accept'); } catch(e) {}
                sleep(3000);
                break;
            }
            break;
        }
    }

    cmd('close');
    console.log(JSON.stringify({exam_id: examId, questions: qCount, submitted: autoSubmit}));
}

main().catch(e => {
    console.error(`[ERROR] ${e.message}`);
    cmd('close 2>/dev/null');
    process.exit(1);
});
