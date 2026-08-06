"""
OneAPIChat Engine - Cron 后台任务管理
提取自 engine_server.py — 定时任务创建/运行/停止
"""
import os
import signal
import subprocess
import time
import threading
from datetime import datetime


# 全局线程注册表。停止事件与线程分开保存，保持 _cron_threads 的兼容接口。
_cron_threads = {}
_cron_stop_events = {}
_cron_lock = threading.Lock()


def _terminate_process(process):
    """终止 cron 启动的整个进程组，避免 shell 子进程残留。"""
    if process.poll() is None:
        try:
            if os.name == "posix":
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            else:
                process.terminate()
            process.wait(timeout=1)
        except (ProcessLookupError, PermissionError):
            pass
        except subprocess.TimeoutExpired:
            try:
                if os.name == "posix":
                    os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                else:
                    process.kill()
            except (ProcessLookupError, PermissionError):
                pass
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass

    # wait() 不会回收 PIPE 对象；communicate/close 防止取消分支泄漏描述符。
    try:
        process.communicate(timeout=0.2)
    except subprocess.TimeoutExpired:
        pass
    finally:
        for stream in (process.stdout, process.stderr):
            if stream and not stream.closed:
                stream.close()


def _run_action(action, stop_event, timeout=300):
    """执行命令并轮询停止事件；返回 None 表示任务被主动取消。"""
    process = subprocess.Popen(
        action,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        start_new_session=(os.name == "posix"),
    )
    deadline = time.monotonic() + timeout
    while True:
        if stop_event.is_set():
            _terminate_process(process)
            return None
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            _terminate_process(process)
            raise subprocess.TimeoutExpired(action, timeout)
        try:
            stdout, stderr = process.communicate(timeout=min(0.2, remaining))
            return subprocess.CompletedProcess(
                action, process.returncode, stdout=stdout, stderr=stderr
            )
        except subprocess.TimeoutExpired:
            continue


def _run_cron_job(name, interval, action, user_id, get_ns,
                  stop_event=None, thread_key=None):
    """后台执行 cron 任务"""
    stop_event = stop_event or threading.Event()
    try:
        store = get_ns("cron", user_id)
        wait_seconds = max(0.1, float(interval))
        while not stop_event.is_set():
            try:
                job = store.get().get(name)
            except (OSError, ValueError):
                break
            if not job or not job.get("enabled"):
                break
            try:
                result = _run_action(action, stop_event)
                if result is None or stop_event.is_set():
                    break
                log_entry = {
                    "time": datetime.now().isoformat(),
                    "exit_code": result.returncode,
                    "stdout": result.stdout[-500:] if result.stdout else "",
                    "stderr": result.stderr[-500:] if result.stderr else ""
                }
                # Cron 完成后推送通知。
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
                    jobs[name]["next_run"] = time.time() + wait_seconds
                    store.set(jobs)
            except subprocess.TimeoutExpired:
                if stop_event.is_set():
                    break
                try:
                    jobs = store.get()
                    if name in jobs:
                        jobs[name]["last_run"] = {
                            "time": datetime.now().isoformat(), "error": "timeout"
                        }
                        store.set(jobs)
                except (OSError, ValueError):
                    break
            except Exception as exc:
                if stop_event.is_set():
                    break
                try:
                    jobs = store.get()
                    if name in jobs:
                        jobs[name]["last_run"] = {
                            "time": datetime.now().isoformat(), "error": str(exc)
                        }
                        store.set(jobs)
                except (OSError, ValueError):
                    break

            # Event.wait 可即时响应停止，无需逐秒轮询存储文件。
            if stop_event.wait(wait_seconds):
                break
    finally:
        if thread_key:
            with _cron_lock:
                if _cron_threads.get(thread_key) is threading.current_thread():
                    _cron_threads.pop(thread_key, None)
                    _cron_stop_events.pop(thread_key, None)


def _start_cron_job(name, user_id, get_ns):
    """启动 cron 后台线程"""
    store = get_ns("cron", user_id)
    key = f"{user_id}_{name}"
    job = store.get().get(name)
    if not job:
        return
    with _cron_lock:
        existing = _cron_threads.get(key)
        if existing and existing.is_alive():
            return
        stop_event = threading.Event()
        t = threading.Thread(
            target=_run_cron_job,
            args=(name, job["interval"], job["action"], user_id, get_ns,
                  stop_event, key),
            daemon=True,
            name=f"cron:{key}",
        )
        _cron_threads[key] = t
        _cron_stop_events[key] = stop_event
        try:
            t.start()
        except Exception:
            _cron_threads.pop(key, None)
            _cron_stop_events.pop(key, None)
            raise


def _stop_cron_job(name, user_id, get_ns):
    """停止 cron 任务"""
    key = f"{user_id}_{name}"
    with _cron_lock:
        thread = _cron_threads.get(key)
        stop_event = _cron_stop_events.get(key)
        if stop_event:
            stop_event.set()

    # 持久化禁用状态；即使存储已不可用，内存停止事件仍能终止线程。
    try:
        store = get_ns("cron", user_id)
        jobs = store.get()
        if name in jobs:
            jobs[name]["enabled"] = False
            store.set(jobs)
    except (OSError, ValueError):
        pass

    if thread and thread is not threading.current_thread():
        thread.join(timeout=2)
    if not thread or not thread.is_alive():
        with _cron_lock:
            if _cron_threads.get(key) is thread:
                _cron_threads.pop(key, None)
                _cron_stop_events.pop(key, None)
