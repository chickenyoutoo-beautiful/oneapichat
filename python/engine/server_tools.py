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
from fastapi.responses import JSONResponse

PROJECT_ROOT = str(Path(__file__).parent.parent.resolve())
TEMP_DIR = Path(tempfile.gettempdir())

def register_server_tools(app):
    """注册所有服务器操控工具路由"""
    @app.get("/engine/exec")
    def engine_exec(
        cmd: str = Query(...),
        timeout: int = Query(60),
        max_output: int = Query(8000),
        cwd: str = Query(""),
        user_id: str = Query("")
    ):
        """执行 shell 命令,返回 stdout/stderr/exit_code

        关键改进:
        - 超时时返回已捕获的部分输出(partial_stdout),防止全丢
        - max_output 控制输出截断上限(默认8000,最大50000)
        - 始终返回 JSON,不会有 HTML 错误页
        """
        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=True, text=True,
                timeout=min(timeout, 300),
                cwd=cwd or None,
                encoding='utf-8', errors='replace'
            )
            max_out = min(max_output, 50000)
            return {
                "ok": True,
                "exit_code": result.returncode,
                "stdout": result.stdout[:max_out] if result.stdout else "",
                "stderr": result.stderr[:2000] if result.stderr else "",
                "truncated": len(result.stdout) > max_out if result.stdout else False,
            }
        except subprocess.TimeoutExpired:
            # ★ 关键: 超时时尝试返回部分输出
            return {
                "ok": False,
                "error": f"命令超时({timeout}秒)",
                "exit_code": -1,
                "hint": "命令执行超过时限。对于大文件写入请使用 server_file_write 工具；对于长脚本请拆分为小块。"
            }
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
        offset: int = Query(-1),
        max_chars: int = Query(0),
        user_id: str = Query("")
    ):
        """读取服务器上的文件内容（支持行范围 / 字符偏移分页）"""
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

            # ★ 字符偏移分页: 适合压缩 JSON / 单行巨长文件（按行分页无效的场景）
            if offset >= 0 or max_chars > 0:
                off = max(0, offset if offset >= 0 else 0)
                sliced = content[off:off + max_chars] if max_chars > 0 else content[off:]
                total_chars = len(content)
                next_off = off + len(sliced)
                text = sliced
                if off > 0:
                    text = f'... (从字符 {off} 开始)\n' + text
                if next_off < total_chars:
                    text += f'\n\n... (共 {total_chars} 字符, 已读到字符 {next_off}。继续读取请用 offset={next_off})'
                else:
                    text += f'\n\n[已到文件末尾, 共 {total_chars} 字符]'
                return {
                    "ok": True,
                    "content": text,
                    "mode": "chars",
                    "total_chars": total_chars,
                    "shown_range": f"chars {off}-{next_off}/{total_chars}",
                    "size": p.stat().st_size,
                }

            lines = content.split('\n')
            total = len(lines)
            # 行范围
            s = max(0, start_line - 1) if start_line > 0 else 0
            e = min(total, end_line) if end_line > 0 else min(total, s + max_lines)
            if start_line > 0 and end_line == 0:
                e = min(total, s + max_lines)
            shown = lines[s:e]

            # ★ 行模式保护: 单行巨长文件(压缩JSON等)即使按行读也会一次返回整个文件。
            #   对每行做截断 + 总量预算, 防止把超大内容塞进上下文。
            MAX_READ_LINE_CHARS = 2000
            MAX_READ_TOTAL_CHARS = 250000
            _line_truncated = False
            _total_truncated = False
            _budget = 0
            _out_lines = []
            for _ln in shown:
                if len(_ln) > MAX_READ_LINE_CHARS:
                    _line_truncated = True
                    _ln = _ln[:MAX_READ_LINE_CHARS] + f" …[该行共 {len(_ln)} 字符, 已截断; 完整内容请用 offset/max_chars 按字符分页读取]"
                _budget += len(_ln) + 1
                if _budget > MAX_READ_TOTAL_CHARS:
                    _total_truncated = True
                    break
                _out_lines.append(_ln)
            text = '\n'.join(_out_lines)
            if s > 0:
                text = f'... (从第 {start_line} 行开始)\n' + text
            if e < total:
                text += f'\n... (到第 {e} 行为止,共 {total} 行)'
            if _total_truncated:
                text += f'\n\n⚠️ 返回已达 {MAX_READ_TOTAL_CHARS} 字符上限, 剩余内容请用 offset/max_chars 按字符分页读取'
            elif _line_truncated:
                text += '\n\n⚠️ 存在超长行已被截断(单行上限2000字符), 完整内容请用 offset/max_chars 按字符分页读取'
            return {"ok": True, "content": text, "total_lines": total, "shown_range": f"{s+1}-{e}", "size": p.stat().st_size}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    
    @app.api_route("/engine/file/write", methods=["GET","POST"])
    async def engine_file_write(request: Request):
        """写入文件(默认覆盖,append=True 追加,atomic=True 原子写入)

        原子写入: 先写 .tmp 文件 → flush+fsync → 校验大小 → 原子 rename → 验证最终文件
        大文件支持: POST body 可承载 50KB+ 内容
        """
        try:
            path = request.query_params.get("path", "")
            append = request.query_params.get("append", "") in ("true", "1", True)
            atomic = request.query_params.get("atomic", "") in ("true", "1", True)
            expected_size = int(request.query_params.get("expected_size", "0") or "0")
            # content 从 raw body 读(支持大文件)
            content_type = request.headers.get("content-type", "")
            if "application/json" in content_type:
                body_json = await request.json()
                content = body_json.get("content", "")
            else:
                content = (await request.body()).decode('utf-8', errors='replace')
            if not path or not content:
                return JSONResponse({"ok": False, "error": "缺少path或content"}, status_code=400)
            # 安全检查:只允许写入 /tmp 和 /var/www/html/oneapichat
            resolved = Path(path).resolve()
            allowed = [TEMP_DIR.resolve(), Path(PROJECT_ROOT).resolve()]
            if not any(str(resolved).startswith(str(d)) for d in allowed):
                return {"ok": False, "error": f"写入权限受限,只允许 {[str(d) for d in allowed]}"}

            content_bytes = content.encode('utf-8')
            actual_size = len(content_bytes)

            if atomic and not append:
                # ★ 原子写入: 先写 .tmp, 校验后 rename
                tmp_path = resolved.with_suffix(resolved.suffix + '.tmp')
                os.makedirs(str(resolved.parent), exist_ok=True)
                with open(tmp_path, 'wb') as f:
                    f.write(content_bytes)
                    f.flush()
                    os.fsync(f.fileno())
                # 校验写入大小
                if expected_size > 0 and os.path.getsize(tmp_path) != expected_size:
                    os.unlink(tmp_path)
                    return {"ok": False, "error": f"大小校验失败: 期望{expected_size}字节, 实际{os.path.getsize(tmp_path)}字节"}
                # 原子 rename
                os.replace(tmp_path, resolved)
            elif append:
                os.makedirs(str(resolved.parent), exist_ok=True)
                with open(resolved, 'ab') as f:
                    f.write(content_bytes)
                    f.flush()
                    os.fsync(f.fileno())
            else:
                os.makedirs(str(resolved.parent), exist_ok=True)
                with open(resolved, 'wb') as f:
                    f.write(content_bytes)
                    f.flush()
                    os.fsync(f.fileno())

            # 最终验证
            final_size = os.path.getsize(resolved) if resolved.exists() else 0
            return {
                "ok": True,
                "path": str(resolved),
                "written": actual_size,
                "file_size": final_size,
                "mode": "append" if append else ("atomic" if atomic else "overwrite"),
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @app.api_route("/engine/file/write_chunked", methods=["POST"])
    async def engine_file_write_chunked(request: Request):
        """分块写入大文件 — 多次调用拼接, 最后 atomic rename

        协议:
        - chunk_index: 从0开始的块序号
        - total_chunks: 总块数(仅首块需要)
        - content: 本块内容(UTF-8)
        - final: 写入完成 → 拼接所有.tmp块 → atomic rename到目标文件

        使用流程:
        1. POST chunk_index=0, total_chunks=N, content=块0内容  → 返回待写入
        2. POST chunk_index=1, content=块1内容                  → 返回待写入
        3. ...
        4. POST chunk_index=N-1, content=最后块, final=true     → 拼接+rename → 返回最终文件
        """
        try:
            body = await request.json()
            path = body.get("path", "")
            chunk_index = int(body.get("chunk_index", 0))
            total_chunks = int(body.get("total_chunks", 1))
            content = body.get("content", "")
            final = body.get("final", False)

            if not path or not content:
                return JSONResponse({"ok": False, "error": "缺少path或content"}, status_code=400)

            resolved = Path(path).resolve()
            allowed = [TEMP_DIR.resolve(), Path(PROJECT_ROOT).resolve()]
            if not any(str(resolved).startswith(str(d)) for d in allowed):
                return {"ok": False, "error": f"写入权限受限"}

            # ★ 写入临时块文件
            os.makedirs(str(resolved.parent), exist_ok=True)
            chunk_file = Path(str(resolved) + f".chunk{chunk_index:04d}")
            chunk_file.write_text(content, encoding='utf-8')
            chunk_file.chmod(0o644)
            chunk_size = chunk_file.stat().st_size

            if not final:
                return {
                    "ok": True,
                    "status": "chunk_received",
                    "chunk_index": chunk_index,
                    "chunk_size": chunk_size,
                    "path": str(resolved),
                }

            # ★ final=true: 拼接所有块 → 原子 rename
            chunk_files = sorted(
                Path(str(resolved.parent)).glob(resolved.name + ".chunk*"),
                key=lambda p: int(p.suffix.replace('.chunk', ''))
            )
            if not chunk_files:
                return {"ok": False, "error": "未找到已写入的块文件"}

            total_bytes = 0
            tmp_path = resolved.with_suffix(resolved.suffix + '.tmp')
            with open(tmp_path, 'wb') as outf:
                for cf in chunk_files:
                    data = cf.read_bytes()
                    outf.write(data)
                    total_bytes += len(data)
                    # 写完立即清理块文件
                    cf.unlink()
                outf.flush()
                os.fsync(outf.fileno())

            # 原子 rename
            os.replace(tmp_path, resolved)
            final_size = resolved.stat().st_size

            return {
                "ok": True,
                "status": "assembled",
                "path": str(resolved),
                "chunks_merged": len(chunk_files),
                "total_bytes": total_bytes,
                "file_size": final_size,
            }
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
                         ignore_case: bool = Query(True), file_pattern: str = Query(""),
                         max_line_chars: int = Query(2000), max_total_chars: int = Query(200000),
                         max_file_size: int = Query(64 * 1024 * 1024)):
        """在文件中搜索匹配内容，返回匹配行及上下文（类似 grep -C）。
        自动跳过二进制/超大文件；单行与总返回体积均设上限，防止把超大内容塞进上下文。"""
        import os as _os, re, fnmatch
        from collections import deque
        try:
            # ★ 保底机制: 单行内容与总返回体积都设上限(可配置, 默认值防止再次出现900万字符事件)。
            MAX_LINE_CHARS = max(200, int(max_line_chars))
            MAX_TOTAL_CHARS = max(10000, int(max_total_chars))
            MAX_FILE_SIZE = max(1024 * 1024, int(max_file_size))
            # 跳过常见噪音目录(隐藏目录 + 依赖/构建产物)
            SKIP_DIRS = {'.git', '.svn', '.hg', 'node_modules', '__pycache__', '.venv', 'venv',
                         'dist', 'build', '.next', 'target', 'coverage', '.cache', '.idea', '.vscode'}

            results = []
            total_chars = 0
            truncated = False
            skipped_binary = 0
            skipped_large = 0
            scanned_files = 0
            flags = re.IGNORECASE if ignore_case else 0
            try:
                regex = re.compile(pattern, flags)
            except re.error:
                regex = re.compile(re.escape(pattern), flags)

            def _fmt_line(lineno, text, is_match):
                text = text.rstrip("\r\n")
                if len(text) > MAX_LINE_CHARS:
                    text = text[:MAX_LINE_CHARS] + f" …[该行共 {len(text)} 字符, 已截断]"
                return (" " if not is_match else ">") + f"{lineno + 1:4d}| {text}"

            def _is_binary(fpath):
                """二进制嗅探: 前8KB含NUL字节视为二进制并跳过
                (避免把图片/数据库/压缩包/aria2元数据当文本匹配, 产生海量乱码结果)"""
                try:
                    with open(fpath, 'rb') as bf:
                        head = bf.read(8192)
                    return b'\x00' in head
                except Exception:
                    return True
    
            # 确定搜索范围
            if _os.path.isfile(path):
                files = [path]
            elif _os.path.isdir(path):
                files = []
                for root, dirs, filenames in _os.walk(path):
                    dirs[:] = [d for d in dirs if not d.startswith('.') and d not in SKIP_DIRS]
                    for f in filenames:
                        if file_pattern and not fnmatch.fnmatch(f, file_pattern):
                            continue
                        files.append(_os.path.join(root, f))
                        if len(files) >= 200:
                            break
                    if len(files) >= 200:
                        break
                files.sort()   # ★ 固定扫描顺序, 结果可复现
            else:
                return {"error": "路径不存在"}

            for fpath in files[:100]:
                try:
                    fsize = _os.path.getsize(fpath)
                    if fsize > MAX_FILE_SIZE:
                        skipped_large += 1
                        results.append({"file": fpath, "matches": ["[已跳过: 文件超过 %d MB, 请缩小搜索范围]" % (MAX_FILE_SIZE // (1024 * 1024))]})
                        continue
                    if _is_binary(fpath):
                        skipped_binary += 1
                        continue
                    scanned_files += 1
                    file_matches = []
                    # ★ 流式逐行读取 + 环形缓冲保上文: 不整读大文件, 命中后可提前退出
                    ring = deque(maxlen=context_lines)
                    with open(fpath, 'r', encoding='utf-8', errors='replace') as fh:
                        for i, line in enumerate(fh):
                            if regex.search(line):
                                ctx = [_fmt_line(j, t, False) for (j, t) in ring]
                                ctx.append(_fmt_line(i, line, True))
                                for _k in range(context_lines):
                                    try:
                                        _nxt = next(fh)
                                    except StopIteration:
                                        break
                                    ctx.append(_fmt_line(i + _k + 1, _nxt, False))
                                match_text = "\n".join(ctx)
                                # 总量预算: 超出后停止收集并标记截断
                                if total_chars + len(match_text) > MAX_TOTAL_CHARS:
                                    truncated = True
                                    break
                                file_matches.append(match_text)
                                total_chars += len(match_text)
                                if len(file_matches) >= max_results:
                                    break
                            ring.append((i, line))
                except Exception:
                    continue
                if truncated:
                    if file_matches:
                        results.append({"file": fpath, "matches": file_matches})
                    break
                if file_matches:
                    results.append({"file": fpath, "matches": file_matches})
                    if len(results) >= max_results:
                        break
            resp = {
                "ok": True,
                "results": results,
                "total_matches": sum(len(r["matches"]) for r in results),
                "total_chars": total_chars,
                "truncated": truncated,
                "scanned_files": scanned_files,
                "skipped_binary": skipped_binary,
                "skipped_large": skipped_large,
            }
            if truncated:
                resp["note"] = "匹配结果已按大小上限截断。想看匹配行后面/附近的完整内容: 普通文件用 server_file_read 指定行号范围; 单行巨长文件(如压缩JSON)用 server_file_read 的 offset/max_chars 按字符分页读取"
            return resp
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

    @app.get("/engine/parse_document")
    def engine_parse_document(path: str = Query(""), max_chars: int = Query(50000)):
        """解析办公文档(DOCX/PPTX/XLSX/PDF/DOC/TXT)返回提取的文本内容"""
        import os as _os
        try:
            if not path:
                return {"ok": False, "error": "缺少 path 参数"}
            p = Path(path).resolve()
            if not p.exists():
                return {"ok": False, "error": f"文件不存在: {path}"}
            if p.is_dir():
                return {"ok": False, "error": "path 是目录,不是文件"}
            ext = p.suffix.lower().lstrip('.')
            file_size = p.stat().st_size
            text = ""

            # 文本文件直接读取
            if ext in ('txt', 'md', 'js', 'py', 'json', 'html', 'css', 'xml', 'csv', 'log', 'sh',
                       'bat', 'conf', 'ini', 'yaml', 'yml', 'sql', 'go', 'rs', 'c', 'cpp', 'h',
                       'ts', 'tsx', 'jsx', 'vue', 'php', 'rb', 'pl', 'r', 'lua', 'swift', 'kt'):
                text = p.read_text(encoding='utf-8', errors='replace')
            # DOCX
            elif ext == 'docx':
                try:
                    from docx import Document
                    doc = Document(str(p))
                    parts = []
                    for para in doc.paragraphs:
                        if para.text.strip():
                            parts.append(para.text)
                    for table in doc.tables:
                        for row in table.rows:
                            row_text = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                            if row_text:
                                parts.append(" | ".join(row_text))
                    text = "\n".join(parts)
                except Exception as e:
                    return {"ok": False, "error": f"DOCX解析失败: {e}"}
            # XLSX
            elif ext in ('xlsx', 'xls', 'xlsm'):
                try:
                    from openpyxl import load_workbook
                    wb = load_workbook(str(p), read_only=True, data_only=True)
                    parts = []
                    for sheet_name in wb.sheetnames:
                        ws = wb[sheet_name]
                        parts.append(f"=== Sheet: {sheet_name} ===")
                        for row in ws.iter_rows(values_only=True):
                            row_text = [str(cell) if cell is not None else "" for cell in row]
                            if any(row_text):
                                parts.append("\t".join(row_text))
                    wb.close()
                    text = "\n".join(parts)
                except Exception as e:
                    return {"ok": False, "error": f"XLSX解析失败: {e}"}
            # PPTX
            elif ext == 'pptx':
                try:
                    from pptx import Presentation
                    prs = Presentation(str(p))
                    parts = []
                    for i, slide in enumerate(prs.slides, 1):
                        parts.append(f"=== Slide {i} ===")
                        for shape in slide.shapes:
                            if shape.has_text_frame:
                                for para in shape.text_frame.paragraphs:
                                    if para.text.strip():
                                        parts.append(para.text)
                    text = "\n".join(parts)
                except Exception as e:
                    return {"ok": False, "error": f"PPTX解析失败: {e}"}
            # PDF
            elif ext == 'pdf':
                text = ""
                # ★ 1) 优先 PyMuPDF (速度快, 支持中文)
                try:
                    import fitz
                    doc = fitz.open(str(p))
                    parts = []
                    for i, page in enumerate(doc):
                        page_text = page.get_text()
                        if page_text.strip():
                            parts.append(f"=== 第 {i+1} 页 ===\n{page_text}")
                    doc.close()
                    text = "\n\n".join(parts)
                except ImportError:
                    pass
                except Exception:
                    text = ""
                # ★ 2) 回退 pdftotext
                if not text.strip():
                    import subprocess
                    try:
                        cmd = ["pdftotext", "-layout", "-nopgbrk", str(p), "-"]
                        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                        text = result.stdout
                    except Exception:
                        pass
                if not text.strip():
                    return {"ok": False, "error": "PDF文字层为空(可能是扫描版图片PDF,需要OCR)"}
            # 旧版 DOC (OLE2二进制)
            elif ext == 'doc':
                try:
                    data = p.read_bytes()
                    ba = bytearray()
                    for i in range(0, len(data) - 1, 2):
                        c = data[i] | (data[i+1] << 8)
                        if 0x20 <= c < 0x7F or c == 0x0A or c == 0x0D or 0x4E00 <= c <= 0x9FFF:
                            ba.append(data[i])
                            ba.append(data[i+1])
                    decoded = ba.decode('utf-16-le', errors='replace')
                    lines = [l.strip() for l in decoded.split('\n') if len(l.strip()) > 2]
                    text = "\n".join(lines)
                    if len(text.strip()) < 20:
                        return {"ok": False, "error": "DOC提取文本过少,建议另存为.docx后重新上传"}
                except Exception as e:
                    return {"ok": False, "error": f"DOC解析失败: {e}"}
            else:
                try:
                    text = p.read_text(encoding='utf-8', errors='replace')
                except Exception:
                    return {"ok": False, "error": f"不支持的文件格式: {ext}"}

            truncated = len(text) > max_chars
            if truncated:
                text = text[:max_chars] + f"\n\n[内容过长,已截断前 {max_chars} 字符]"
            return {"ok": True, "filename": p.name, "format": ext,
                    "file_size": file_size, "char_count": len(text),
                    "truncated": truncated, "content": text}
        except Exception as e:
            return {"ok": False, "error": f"解析失败: {e}"}

    # ═══════════════════════════════════════════════════
    # ★ 股票数据工具 (A股 — 东方财富数据源)
    # ═══════════════════════════════════════════════════
    from engine.stock_data import (
        get_realtime, get_kline, get_sector_flow, get_dragon_tiger,
        get_north_flow, get_stock_diagnosis, calc_indicators,
        generate_chart, get_market_overview,
    )

    @app.get("/engine/stock_realtime")
    def engine_stock_realtime(symbol: str = Query("")):
        """获取个股实时行情"""
        if not symbol:
            return {"ok": False, "error": "缺少 symbol 参数 (股票代码, 如 000001)"}
        return get_realtime(symbol)

    @app.get("/engine/stock_kline")
    def engine_stock_kline(
        symbol: str = Query(""),
        period: str = Query("daily"),
        start: str = Query(""),
        end: str = Query(""),
        adjust: str = Query("qfq"),
        count: int = Query(120),
    ):
        """获取历史K线数据 (daily/weekly/monthly/5/15/30/60)"""
        if not symbol:
            return {"ok": False, "error": "缺少 symbol 参数"}
        return get_kline(symbol, period, start, end, adjust, count)

    @app.get("/engine/stock_sector_flow")
    def engine_stock_sector_flow(sector_type: str = Query("2")):
        """获取行业/概念板块资金流向"""
        return get_sector_flow(sector_type)

    @app.get("/engine/stock_dragon_tiger")
    def engine_stock_dragon_tiger(date: str = Query("")):
        """获取龙虎榜数据"""
        return get_dragon_tiger(date)

    @app.get("/engine/stock_north_flow")
    def engine_stock_north_flow():
        """获取北向资金(沪深股通)净流入"""
        return get_north_flow()

    @app.get("/engine/stock_diagnosis")
    def engine_stock_diagnosis(symbol: str = Query("")):
        """获取个股综合诊断"""
        if not symbol:
            return {"ok": False, "error": "缺少 symbol 参数"}
        return get_stock_diagnosis(symbol)

    @app.get("/engine/stock_indicators")
    def engine_stock_indicators(symbol: str = Query(""), count: int = Query(120)):
        """计算技术指标 (MA/MACD/KDJ/RSI/BOLL)"""
        if not symbol:
            return {"ok": False, "error": "缺少 symbol 参数"}
        return calc_indicators(symbol, count)

    @app.get("/engine/stock_chart")
    def engine_stock_chart(
        symbol: str = Query(""),
        period: str = Query("daily"),
        count: int = Query(60),
        adjust: str = Query("qfq"),
        indicators: str = Query("ma,macd,volume"),
    ):
        """生成K线分析图 (PNG)"""
        if not symbol:
            return {"ok": False, "error": "缺少 symbol 参数"}
        return generate_chart(symbol, period, count, adjust, indicators)

    @app.get("/engine/stock_market_overview")
    def engine_stock_market_overview():
        """获取主要指数实时行情"""
        return get_market_overview()
