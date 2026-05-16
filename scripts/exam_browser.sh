#!/bin/bash
# 超星考试浏览器自动化 — 处理 CLIENT_FORM_SIGN 等需要 JS 签名的考试
# 依赖: agent-browser CLI (npm i -g agent-browser)
# 用法: exam_browser.sh <exam_id> <course_id> <class_id> <cpi> <enc_task> [auto-submit]

set -e

EXAM_ID="$1"
COURSE_ID="$2"
CLASS_ID="$3"
CPI="$4"
ENC_TASK="$5"
AUTO_SUBMIT="${6:-true}"

START_URL="https://mooc1-api.chaoxing.com/exam-ans/exam/phone/task-exam?redo=1&taskrefId=$EXAM_ID&courseId=$COURSE_ID&classId=$CLASS_ID&cpi=$CPI&enc_task=$ENC_TASK&vx=0&examsignal=1"

echo "[$(date +%H:%M:%S)] 浏览器考试: exam=$EXAM_ID" >&2

# 1. 注入 cookies 并打开考试页面
echo "[INFO] 打开考试页面..." >&2
agent-browser open "$START_URL"
sleep 3

# 2. 查看页面内容
SNAP=$(agent-browser snapshot -i 2>/dev/null)
echo "$SNAP" >&2

# 3. 检查是否在开始页面
if echo "$SNAP" | grep -q "开始考试"; then
    echo "[INFO] 点击开始考试..." >&2
    START_REF=$(echo "$SNAP" | grep "开始考试" | grep -oP '@e\d+' | head -1)
    if [ -n "$START_REF" ]; then
        agent-browser click "$START_REF"
        sleep 3
    fi
fi

# 4. 检查是否需要确认
agent-browser snapshot -i >&2

# 5. 开始答题循环
Q=0
while true; do
    SNAP=$(agent-browser snapshot -i 2>/dev/null)
    echo "[INFO] 第$((Q+1))题..." >&2

    # 检查是否已经完成或交卷
    if echo "$SNAP" | grep -q "交卷成功\|已完成\|考试结束"; then
        echo "DONE: exam=$EXAM_ID questions=$Q" >&2
        break
    fi

    # 检查错误
    if echo "$SNAP" | grep -q "无权限\|时间已到\|已提交"; then
        echo "ERROR: $(echo "$SNAP" | grep "无权限\|时间已到\|已提交" | head -1)" >&2
        break
    fi

    # TODO: 提取题目文本，搜索答案，填写
    
    Q=$((Q+1))
    if [ $Q -gt 50 ]; then  # safety limit
        echo "LIMIT: max 50 questions" >&2
        break
    fi
done

# 6. 关闭浏览器
agent-browser close 2>/dev/null
echo "DONE" >&2
