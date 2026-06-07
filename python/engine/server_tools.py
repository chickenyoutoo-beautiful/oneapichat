# server_tools.py — 服务器操控工具 v1.0 (提取自 engine_server.py)
# engine_exec / engine_python / engine_file_* / engine_sys_info / engine_ps / engine_disk
# engine_docker / engine_db_query / engine_network / engine_file_search / engine_file_grep / engine_file_edit / engine_file_op

import subprocess
import json
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from fastapi import Query, Request

PROJECT_ROOT = str(Path(__file__).parent.parent.resolve())
TEMP_DIR = Path(tempfile.gettempdir())

def register_server_tools(app):
    """注册所有服务器操控工具路由"""
    @app.get("/engine/exec")
    def engine_exec(
        cmd: str = Query(...),
        timeout: int = Query(60),
        cwd: str = Query(""),
        user_id: str = Query("")
    ):
        """执行 shell 命令,返回 stdout/stderr/exit_code"""
        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=True, text=True,
                timeout=min(timeout, 300),
                cwd=cwd or None,
                encoding='utf-8', errors='replace'
            )
            return {
                "ok": True,
                "exit_code": result.returncode,
                "stdout": result.stdout[:8000] if result.stdout else "",
                "stderr": result.stderr[:2000] if result.stderr else ""
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": f"命令超时({timeout}秒)", "exit_code": -1}
        except Exception as e:
            return {"ok": False, "error": str(e), "exit_code": -1}
    
    @app.api_route("/engine/python", methods=["GET","POST"])
    async def engine_python(request: Request):
        """执行 Python 脚本,返回输出"""
        # 优先从 body 读脚本(支持大脚本),其次从 query
        content_type = request.headers.get("content-type", "")
        if "text/plain" in content_type or request.method == "POST":
            script = (await request.body()).decode('utf-8', errors='replace')
            timeout = int(request.query_params.get("timeout", 30))
        else:
            script = request.query_params.get("script", "")
            timeout = int(request.query_params.get("timeout", 30))
        if not script:
            return JSONResponse({"ok": False, "error": "缺少script参数"}, status_code=400)
        import tempfile
        tf = tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, dir=str(TEMP_DIR))
        try:
            tf.write(script)
            tf.close()
            result = subprocess.run(
                ['python3', tf.name], capture_output=True, text=True,
                timeout=min(timeout, 120)
            )
            return {
                "ok": True,
                "exit_code": result.returncode,
                "stdout": result.stdout[:8000] if result.stdout else "",
                "stderr": result.stderr[:2000] if result.stderr else ""
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": f"脚本超时({timeout}秒)", "exit_code": -1}
        except Exception as e:
            return {"ok": False, "error": str(e), "exit_code": -1}
        finally:
            try: os.unlink(tf.name)
            except Exception: pass
    
    @app.get("/engine/file/read")
    def engine_file_read(
        path: str = Query(...),
        max_lines: int = Query(200),
        start_line: int = Query(0),
        end_line: int = Query(0),
        user_id: str = Query("")
    ):
        """读取服务器上的文件内容（支持行范围）"""
        try:
            p = Path(path).resolve()
            if not p.exists():
                return {"ok": False, "error": f"文件不存在: {path}"}
            if p.is_dir():
                items = []
                for item in sorted(p.iterdir()):
                    t = "[DIR]" if item.is_dir() else "[FILE]"
                    size = item.stat().st_size if item.is_file() else 0
                    items.append(f"{t} {item.name} ({size} bytes)")
                return {"ok": True, "content": "\n".join(items[:max_lines])}
            content = p.read_text(encoding='utf8', errors='replace')
            lines = content.split('\n')
            total = len(lines)
            # 行范围
            s = max(0, start_line - 1) if start_line > 0 else 0
            e = min(total, end_line) if end_line > 0 else min(total, s + max_lines)
            if start_line > 0 and end_line == 0:
                e = min(total, s + max_lines)
            shown = lines[s:e]
            text = '\n'.join(shown)
            if s > 0:
                text = f'... (从第 {start_line} 行开始)\n' + text
            if e < total:
                text += f'\n... (到第 {e} 行为止,共 {total} 行)'
            return {"ok": True, "content": text, "total_lines": total, "shown_range": f"{s+1}-{e}", "size": p.stat().st_size}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    
    @app.api_route("/engine/file/write", methods=["GET","POST"])
    async def engine_file_write(request: Request):
        """写入文件(默认覆盖,append=True 追加)"""
        try:
            path = request.query_params.get("path", "")
            append = request.query_params.get("append", "") in ("true", "1", True)
            # content 从 raw body 读(支持大文件)
            content = (await request.body()).decode('utf-8', errors='replace')
            if not path or not content:
                return JSONResponse({"ok": False, "error": "缺少path或content"}, status_code=400)
            # 安全检查:只允许写入 /tmp 和 /var/www/html/oneapichat
            resolved = Path(path).resolve()
            allowed = [TEMP_DIR.resolve(), Path(PROJECT_ROOT).resolve()]
            if not any(str(resolved).startswith(str(d)) for d in allowed):
                return {"ok": False, "error": f"写入权限受限,只允许 {[str(d) for d in allowed]}"}
            mode = 'a' if append else 'w'
            with open(resolved, mode, encoding='utf8') as f:
                f.write(content)
            return {"ok": True, "path": str(resolved), "written": len(content)}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    
    @app.get("/engine/sys/info")
    def engine_sys_info(user_id: str = Query("")):
        """获取系统信息"""
        try:
            import platform
            disk = os.popen("df -h / | tail -1").read().strip()
            mem = os.popen("free -h | grep Mem").read().strip()
            cpu = os.popen("uptime").read().strip()
            ps_count = len(os.popen("ps aux --no-headers").read().strip().split('\n'))
            return {
                "ok": True,
                "hostname": platform.node(),
                "os": f"{platform.system()} {platform.release()}",
                "python": platform.python_version(),
                "cpu_uptime": cpu,
                "memory": mem,
                "disk": disk,
                "processes": ps_count,
                "time": datetime.now().isoformat()
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}
    
    
    @app.get("/engine/ps")
    def engine_ps(user_id: str = Query("")):
        """列出服务器进程"""
        try:
            result = subprocess.run(["ps", "aux", "--sort=-%cpu"], capture_output=True, text=True, timeout=15)
            lines = result.stdout.split("\n")
            header = lines[:1]
            body = lines[1:21]
            return {"ok": True, "stdout": "\n".join(header + body), "total": len(lines) - 1}
        except Exception as e:
            return {"error": str(e)}
    
    
    @app.get("/engine/disk")
    def engine_disk():
        """磁盘使用情况"""
        try:
            result = subprocess.run(["df", "-h"], capture_output=True, text=True, timeout=10)
            return {"ok": True, "stdout": result.stdout}
        except Exception as e:
            return {"error": str(e)}
    
    
    @app.get("/engine/docker")
    def engine_docker(action: str = Query("ps"), user_id: str = Query("")):
        """Docker 操作"""
        try:
            if action == "ps":
                cmd = ["docker", "ps", "-a", "--format", "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"]
            elif action == "images":
                cmd = ["docker", "images"]
            elif action == "stats":
                cmd = ["docker", "stats", "--no-stream"]
            else:
                return {"error": f"Unknown action: {action}"}
            result = subprocess.run(["sudo"] + cmd, capture_output=True, text=True, timeout=15)
            return {"ok": True, "stdout": result.stdout, "stderr": result.stderr}
        except FileNotFoundError:
            return {"error": "Docker not available"}
        except Exception as e:
            return {"error": str(e)}
    
    
    @app.get("/engine/db_query")
    def engine_db_query(sql: str = Query(...), user_id: str = Query("")):
        """执行数据库查询"""
        import sqlite3
        try:
            db_path = str(Path(PROJECT_ROOT) / "chaoxing" / "learning_records.db")
            conn = sqlite3.connect(db_path)
            c = conn.cursor()
            c.execute(sql)
            rows = c.fetchall()
            cols = [desc[0] for desc in c.description] if c.description else []
            conn.close()
            return {"ok": True, "columns": cols, "rows": rows[:50], "total": len(rows)}
        except Exception as e:
            return {"error": str(e)}
    
    
    @app.get("/engine/network")
    def engine_network(target: str = Query(...), action: str = Query("ping"), timeout: int = Query(10)):
        """网络诊断"""
        try:
            if action == "ping":
                cmd = ["ping", "-c", "3", "-W", "3", target]
            elif action == "curl":
                cmd = ["curl", "-s", "--max-time", str(timeout), "-k", target]
            elif action == "port":
                result = subprocess.run(["ss", "-tlnp"], capture_output=True, text=True, timeout=10)
                lines = [l for l in result.stdout.split("\n") if target in l]
                return {"ok": True, "stdout": "\n".join(lines[:10])}
            else:
                return {"error": f"Unknown action: {action}"}
            result = subprocess.run(cmd, capture_output=True, timeout=timeout + 5)
            return {"ok": True, "stdout": result.stdout.decode('utf-8','replace')[:2000], "stderr": result.stderr.decode('utf-8','replace')[:500]}
        except Exception as e:
            return {"error": str(e)}
    
    
    @app.get("/engine/file_search")
    def engine_file_search(pattern: str = Query(...), path: str = Query(PROJECT_ROOT), max_results: int = Query(30)):
        """搜索文件"""
        try:
            cmd = ["find", path, "-name", pattern, "-type", "f", "!", "-path", "*/node_modules/*", "!", "-path", "*/.git/*", "!", "-path", "*/__pycache__/*"]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            files = [f for f in result.stdout.strip().split("\n") if f][:max_results]
            return {"ok": True, "files": files, "total": len(files)}
        except Exception as e:
            return {"error": str(e)}
    
    
    @app.get("/engine/file_grep")
    def engine_file_grep(pattern: str = Query(...), path: str = Query(PROJECT_ROOT),
                         context_lines: int = Query(2), max_results: int = Query(20),
                         ignore_case: bool = Query(True), file_pattern: str = Query("")):
        """在文件中搜索匹配内容，返回匹配行及上下文（类似 grep -C）"""
        import os as _os, re, fnmatch
        try:
            results = []
            flags = re.IGNORECASE if ignore_case else 0
            try:
                regex = re.compile(pattern, flags)
            except re.error:
                regex = re.compile(re.escape(pattern), flags)
    
            # 确定搜索范围
            if _os.path.isfile(path):
                files = [path]
            elif _os.path.isdir(path):
                files = []
                for root, dirs, filenames in _os.walk(path):
                    dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('node_modules', '__pycache__', '.git')]
                    for f in filenames:
                        if file_pattern and not fnmatch.fnmatch(f, file_pattern):
                            continue
                        files.append(_os.path.join(root, f))
                        if len(files) > 100:
                            break
                    if len(files) > 100:
                        break
            else:
                return {"error": "路径不存在"}
    
            for fpath in files[:50]:
                try:
                    with open(fpath, 'r', encoding='utf-8', errors='replace') as fh:
                        lines = fh.readlines()
                except Exception:
                    continue
                file_matches = []
                for i, line in enumerate(lines):
                    if regex.search(line):
                        start = max(0, i - context_lines)
                        end = min(len(lines), i + context_lines + 1)
                        ctx = []
                        for j in range(start, end):
                            prefix = ">" if j == i else " "
                            ctx.append(f"{prefix}{j+1:4d}| {lines[j].rstrip()}")
                        file_matches.append("\n".join(ctx))
                        if len(file_matches) >= max_results:
                            break
                if file_matches:
                    results.append({"file": fpath, "matches": file_matches})
                    if len(results) >= max_results:
                        break
            return {"ok": True, "results": results, "total_matches": sum(len(r["matches"]) for r in results)}
        except Exception as e:
            return {"error": str(e)}
    
    
    @app.post("/engine/file_edit")
    async def engine_file_edit(request: Request, path: str = Query(...), replace_all: bool = Query(False)):
        """精确编辑文件：查找并替换指定字符串"""
        import os as _os
        try:
            body = await request.json()
            old_string = body.get("old_string", "")
            new_string = body.get("new_string", "")
    
            if not old_string and old_string != "":
                return {"error": "old_string is required"}
    
            # 安全检查
            path = _os.path.realpath(path)
            allowed_roots = [PROJECT_ROOT, str(TEMP_DIR), "/var/www/html/oneapichat"]
            allowed = any(path.startswith(_os.path.realpath(r)) for r in allowed_roots)
            if not allowed:
                return {"error": "路径不在允许范围内"}
    
            if not _os.path.exists(path):
                return {"error": "文件不存在"}
    
            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
    
            if replace_all:
                count = content.count(old_string)
                if count == 0:
                    return {"error": f"未找到匹配内容", "old_string_preview": old_string[:80]}
                new_content = content.replace(old_string, new_string)
            else:
                count = content.count(old_string)
                if count == 0:
                    return {"error": f"未找到匹配内容（共搜索 {len(content)} 字符）", "old_string_preview": old_string[:80]}
                if count > 1:
                    return {"error": f"old_string 出现 {count} 次，不唯一。请用更长的上下文使其唯一，或设置 replace_all=true"}
                new_content = content.replace(old_string, new_string, 1)
    
            # 备份
            backup_path = path + ".bak"
            try:
                with open(backup_path, 'w', encoding='utf-8') as f:
                    f.write(content)
            except Exception:
                pass
    
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new_content)
    
            return {"ok": True, "replaced": count, "path": path, "backup": backup_path if _os.path.exists(backup_path) else None}
        except Exception as e:
            return {"error": str(e)}
    
    
    @app.get("/engine/file_op")
    def engine_file_op(action: str = Query(...), src: str = Query(...), dst: str = Query("")):
        """文件操作"""
        import os as _os, shutil
        try:
            allowed = [str(TEMP_DIR), PROJECT_ROOT, PROJECT_ROOT + '/uploads', PROJECT_ROOT + '/oneapichat']
            # 路径转换: /oneapichat/uploads/... → /var/www/html/oneapichat/uploads/...
            for path in ('src', 'dst'):
                p = locals().get(path, '')
                if p and p.startswith('/oneapichat/'):
                    locals()[path] = PROJECT_ROOT + '/' + p.replace('/oneapichat/', '', 1)
            def safe(p):
                return any(p.startswith(pre) for pre in allowed)
            if not safe(src) or (dst and not safe(dst)):
                return {"error": f"只允许操作 {TEMP_DIR}, {PROJECT_ROOT}, {PROJECT_ROOT}/uploads 目录"}
            if action in ("cp", "copy"):
                shutil.copy2(src, dst)
            elif action in ("mv", "move"):
                shutil.move(src, dst)
            elif action == "rm":
                if _os.path.isdir(src):
                    shutil.rmtree(src)
                else:
                    _os.remove(src)
            elif action == "mkdir":
                _os.makedirs(src, exist_ok=True)
            else:
                return {"error": f"Unknown action: {action}"}
            return {"ok": True, "action": action}
        except Exception as e:
            return {"error": str(e)}
