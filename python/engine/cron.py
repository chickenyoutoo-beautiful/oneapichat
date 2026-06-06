"""
OneAPIChat Engine - Cron 后台任务管理
提取自 engine_server.py — 定时任务创建/运行/停止
"""
import subprocess
import time
import threading
from datetime import datetime


def _run_cron_job(name, interval, action, user_id, get_ns):
    """后台执行 cron 任务"""
    store = get_ns("cron", user_id)
    while True:
        job = store.get().get(name)
        if not job or not job.get("enabled"):
            break
        try:
            result = subprocess.run(
                action, shell=True, capture_output=True, text=True, timeout=300,
                encoding='utf-8', errors='replace'
            )
            log_entry = {
                "time": datetime.now().isoformat(),
                "exit_code": result.returncode,
                "stdout": result.stdout[-500:] if result.stdout else "",
                "stderr": result.stderr[-500:] if result.stderr else ""
            }
            # Cron完成后推送通知
            push_store = get_ns("heartbeat", user_id)
            push_data = push_store.get()
            pending = push_data.get("pending_messages", [])
            if result.stdout.strip():
                pending.append({"msg": f"[Cron] {name}: {result.stdout.strip()[-200:]}",
                              "time": datetime.now().isoformat()})
            elif result.stderr.strip():
                pending.append({"msg": f"[Cron] {name} 出错: {result.stderr.strip()[-200:]}",
                              "time": datetime.now().isoformat()})
            else:
                pending.append({"msg": f"[Cron] {name} 已完成 (exit: {result.returncode})",
                              "time": datetime.now().isoformat()})
            push_data["pending_messages"] = pending
            push_store.set(push_data)
            jobs = store.get()
            if name in jobs:
                jobs[name]["last_run"] = log_entry
                jobs[name]["next_run"] = time.time() + interval
                store.set(jobs)
        except subprocess.TimeoutExpired:
            jobs = store.get()
            if name in jobs:
                jobs[name]["last_run"] = {"time": datetime.now().isoformat(), "error": "timeout"}
                store.set(jobs)
        except Exception as e:
            jobs = store.get()
            if name in jobs:
                jobs[name]["last_run"] = {"time": datetime.now().isoformat(), "error": str(e)}
                store.set(jobs)

        # 等待下一轮
        for _ in range(interval):
            time.sleep(1)
            job = store.get().get(name)
            if not job or not job.get("enabled"):
                return


# 全局线程注册表
_cron_threads = {}


def _start_cron_job(name, user_id, get_ns):
    """启动 cron 后台线程"""
    store = get_ns("cron", user_id)
    key = f"{user_id}_{name}"
    job = store.get().get(name)
    if not job:
        return
    if key in _cron_threads and _cron_threads[key].is_alive():
        return
    t = threading.Thread(
        target=_run_cron_job,
        args=(name, job["interval"], job["action"], user_id, get_ns),
        daemon=True
    )
    t.start()
    _cron_threads[key] = t


def _stop_cron_job(name, user_id, get_ns):
    """停止 cron 任务"""
    store = get_ns("cron", user_id)
    key = f"{user_id}_{name}"
    jobs = store.get()
    if name in jobs:
        jobs[name]["enabled"] = False
        store.set(jobs)
    _cron_threads.pop(key, None)
