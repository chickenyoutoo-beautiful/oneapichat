#!/bin/bash
# 引擎守护进程
ENGINE_LOG="/tmp/engine_server.log"
ENGINE_SCRIPT="/var/www/html/oneapichat/engine_server.py"
[ -f "$ENGINE_SCRIPT" ] || ENGINE_SCRIPT="/var/www/html/engine_server.py"

if ! curl -sf http://127.0.0.1:8766/engine/health >/dev/null 2>&1; then
    echo "[$(date)] 引擎挂了，重启..." >> "$ENGINE_LOG"
    nohup python3 "$ENGINE_SCRIPT" >> "$ENGINE_LOG" 2>&1 &
    disown
fi
