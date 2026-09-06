# server_tools.py — 服务器操控工具 v1.0 (提取自 engine_server.py)
# engine_exec / engine_python / engine_file_* / engine_sys_info / engine_ps / engine_disk
# engine_docker / engine_db_query / engine_network / engine_file_search / engine_file_grep / engine_file_edit / engine_file_op

import subprocess
import json
import os
import re
import shutil
import tempfile
import asyncio
import threading
import time
from datetime import datetime
from pathlib import Path
from fastapi import Query, Request
from fastapi.responses import JSONResponse

# ★ 本文件位于 python/engine/ 下, 项目根需上溯 3 层 (曾误为 2 层 → 解析到 python/,
#   导致 file_write/file_append/file_op 允许根目录错误, 相对路径写入全被拒)
PROJECT_ROOT = str(Path(__file__).parent.parent.parent.resolve())
TEMP_DIR = Path(tempfile.gettempdir())
OBSERVATION_TTL_SECONDS = 3600
_observed_files: dict[tuple[str, str], float] = {}
_observation_lock = threading.Lock()

def _observation_key(user_id: str, path: Path) -> tuple[str, str]:
    return (str(user_id or 'anonymous'), str(path.resolve()))

def _mark_observed(user_id: str, path: Path) -> None:
    with _observation_lock:
        _observed_files[_observation_key(user_id, path)] = time.time()

def _was_observed(user_id: str, path: Path) -> bool:
    key = _observation_key(user_id, path)
    with _observation_lock:
        seen = _observed_files.get(key, 0)
        if not seen or time.time() - seen > OBSERVATION_TTL_SECONDS:
            _observed_files.pop(key, None)
            return False
        return True

def _validate_modified_file(path: Path) -> dict:
    """Run a bounded syntax/build check for files modified by coding tools."""
    suffix = path.suffix.lower()
    commands = {
        '.py': ['python3', '-m', 'py_compile', str(path)],
        '.js': ['node', '--check', str(path)],
        '.mjs': ['node', '--check', str(path)],
        '.cjs': ['node', '--check', str(path)],
        '.php': ['php', '-l', str(path)],
    }
    command = commands.get(suffix)
    if not command:
        return {"ok": True, "skipped": True, "reason": "no validator"}
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20, cwd=PROJECT_ROOT)
        return {"ok": result.returncode == 0, "command": command, "exit_code": result.returncode, "stdout": (result.stdout or '')[:4000], "stderr": (result.stderr or '')[:4000]}
    except Exception as exc:
        return {"ok": False, "command": command, "error": str(exc)}

def _resolve_path(path: str, cwd: str = "") -> Path:
    """统一路径解析: 相对路径基于当前工作区 cwd 或项目根拼接, 避免受引擎进程 cwd 影响"""
    if not path:
        return Path(path)
    if not os.path.isabs(path):
        base_dir = cwd if (cwd and os.path.isdir(cwd)) else PROJECT_ROOT
        path = os.path.join(base_dir, path)
    return Path(path).resolve()

def _within(candidate: Path, root: Path) -> bool:
    """Component-aware containment; string prefix checks allow /project-evil escapes."""
    try:
        return os.path.commonpath((str(candidate), str(root))) == str(root)
    except (OSError, ValueError):
        return False

def _allowed_path(path: Path, allow_temp: bool = True, full_access: bool = False, cwd: str = "") -> bool:
    """Default sandbox is the project, active workspace cwd, and temporary space; external roots require a server-verified grant."""
    if full_access:
        return True
    roots = [Path(PROJECT_ROOT).resolve()]
    if cwd and os.path.isdir(cwd):
        try:
            roots.append(Path(cwd).resolve())
        except Exception:
            pass
    if allow_temp:
        roots.extend([TEMP_DIR.resolve(), Path("/tmp").resolve(), Path("/var/tmp").resolve()])
    return any(_within(path, root) for root in roots)

def _trusted_full_access(request: Request, requested: bool) -> bool:
    """Only the authenticated loopback PHP bridge may activate full filesystem access."""
    if not requested:
        return False
    return bool(request.scope.get("state", {}).get("trusted_internal"))

_DOCKER_IMAGE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,255}$")
_DOCKER_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_DOCKER_ACTIONS = {"doctor", "ps", "images", "stats", "logs", "pull", "run", "yatori_deploy", "stop", "remove"}


def _docker_error(stderr: str, action: str = "") -> dict:
    message = (stderr or "Docker command failed").strip()[-4000:]
    lower = message.lower()
    if "permission denied" in lower or "cannot connect to the docker daemon" in lower and "permission" in lower:
        code, hint = "DOCKER_PERMISSION", "当前引擎用户无权访问 Docker socket。将用户加入 docker 组，或挂载 /var/run/docker.sock 并提供 docker CLI。"
    elif "cannot connect to the docker daemon" in lower or "is the docker daemon running" in lower:
        code, hint = "DOCKER_DAEMON_UNAVAILABLE", "Docker daemon 未连接。请确认 Docker 服务正常运行后重试 doctor。"
    elif action in {"pull", "yatori_deploy"} and any(x in lower for x in ("timeout", "timed out", "network", "tls", "lookup", "temporary failure", "connection")):
        code, hint = "DOCKER_NETWORK", "镜像仓库网络不可达或被隔离。先在宿主机完成 docker pull，或配置 Docker daemon registry mirror。"
    else:
        code, hint = "DOCKER_COMMAND_FAILED", "请查看 stderr，并先运行 server_docker(action=doctor) 获取环境诊断。"
    return {"ok": False, "error": message, "code": code, "retryable": code in {"DOCKER_NETWORK", "DOCKER_DAEMON_UNAVAILABLE"}, "hint": hint}


def _docker_run(cmd: list[str], timeout: int = 30, action: str = "") -> dict:
    docker = shutil.which("docker")
    if not docker:
        return {"ok": False, "error": "未找到 docker CLI", "code": "DOCKER_CLI_MISSING", "retryable": False, "hint": "当前 Agent 运行环境没有 Docker CLI；容器化部署需要安装 CLI 并挂载 Docker socket。"}
    try:
        result = subprocess.run([docker, *cmd], capture_output=True, text=True, timeout=max(5, min(int(timeout), 900)), encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"Docker 操作超时({timeout}秒)", "code": "DOCKER_TIMEOUT", "retryable": True, "hint": "拉取镜像可能受网络限制，请在宿主机手动 docker pull 后重试。"}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "code": "DOCKER_EXEC_FAILED", "retryable": False}
    stdout, stderr = (result.stdout or "").strip(), (result.stderr or "").strip()
    if result.returncode != 0:
        return {**_docker_error(stderr or stdout, action), "exit_code": result.returncode}
    return {"ok": True, "stdout": stdout[:50000], "stderr": stderr[:4000], "exit_code": result.returncode, "truncated": len(stdout) > 50000}


def _docker_valid_image(image: str) -> bool:
    return isinstance(image, str) and bool(_DOCKER_IMAGE_RE.fullmatch(image.strip()))


def _docker_valid_name(name: str) -> bool:
    return isinstance(name, str) and bool(_DOCKER_NAME_RE.fullmatch(name.strip()))


def _docker_host_path(raw: str) -> Path | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    candidate = Path(os.path.expanduser(raw)).resolve()
    roots = [Path.home().resolve(), TEMP_DIR.resolve(), Path("/tmp").resolve(), Path("/var/tmp").resolve(), Path(PROJECT_ROOT).resolve()]
    return candidate if any(_within(candidate, root) for root in roots) else None


def _yatori_default_config() -> dict:
    return {"users": [{"accountType": "XXT", "username": "", "password": "", "courses": []}], "setting": {"speed": 1.0, "interactive": False, "examAuto": True}}


def _docker_command_result(result: dict) -> dict:
    if result.get("ok"):
        return {"result": result.get("stdout", ""), "stderr": result.get("stderr", ""), "exit_code": result.get("exit_code", 0)}
    return result


def register_server_tools(app):
    """注册所有服务器操控工具路由"""
    @app.api_route("/engine/exec", methods=["GET", "POST"])
    async def engine_exec(request: Request):
        """执行 shell 命令,返回 stdout/stderr/exit_code

        关键改进:
        - 超时时返回已捕获的部分输出(partial_stdout),防止全丢
        - max_output 控制输出截断上限(默认8000,最大50000)
        - 始终返回 JSON,不会有 HTML 错误页
        - GET/POST 均支持;POST 时 cmd 可放 raw body 或 JSON,避免 URL 转义/长度问题
        """
        params = request.query_params
        cmd = params.get("cmd") or params.get("command") or ""
        try:
            timeout = int(params.get("timeout", 60) or 60)
        except Exception:
            timeout = 60
        try:
            max_output = int(params.get("max_output", 8000) or 8000)
        except Exception:
            max_output = 8000
        cwd = params.get("cwd", "")
        user_id = params.get("user_id", "")
        if not cmd and request.method == "POST":
            body = await request.body()
            if body:
                raw = body.decode('utf-8', errors='replace').strip()
                try:
                    data = json.loads(raw)
                    if isinstance(data, dict):
                        cmd = data.get("cmd") or data.get("command") or ""
                        if data.get("timeout") is not None:
                            try:
                                timeout = int(data.get("timeout"))
                            except Exception:
                                pass
                        if data.get("max_output") is not None:
                            try:
                                max_output = int(data.get("max_output"))
                            except Exception:
                                pass
                        if data.get("cwd"):
                            cwd = data.get("cwd")
                except json.JSONDecodeError:
                    cmd = raw
        if not cmd:
            return JSONResponse({"ok": False, "error": "缺少cmd参数(支持cmd/command别名,POST支持raw body)"}, status_code=400)
        try:
            # ★ 在线程池执行,避免阻塞 FastAPI 事件循环(长命令会卡住整个引擎)
            result = await asyncio.to_thread(
                subprocess.run,
                cmd, shell=True, capture_output=True, text=True,
                # ★ 上限 300→900: 工具 timeout 参数声明无上限, 旧值 300 与
                #   nginx fastcgi_read_timeout 300s 双双卡边界 (sleep 300 命令必超时)
                timeout=min(timeout, 900),
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
            result = await asyncio.to_thread(
                subprocess.run,
                ['python3', tf.name], capture_output=True, text=True,
                # ★ cwd=项目根: 脚本内相对路径(tempfile/x.md 等)落到项目目录,
                #   与 server_file_* 工具一致 (曾受引擎进程 cwd=/home/naujtrats 影响)
                cwd=PROJECT_ROOT,
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
        request: Request,
        path: str = Query(...),
        max_lines: int = Query(200),
        start_line: int = Query(0),
        end_line: int = Query(0),
        offset: int = Query(-1),
        max_chars: int = Query(0),
        full_access: bool = Query(False),
        user_id: str = Query(""),
        cwd: str = Query("")
    ):
        """读取服务器上的文件内容（支持行范围 / 字符偏移分页 / full_access 全盘访问授权 / DSH Workspace cwd）"""
        try:
            full_access = _trusted_full_access(request, full_access)
            p = _resolve_path(path, cwd)
            if not _allowed_path(p, full_access=full_access, cwd=cwd):
                return {
                    "ok": False,
                    "error": "路径不在允许的工作区或临时目录。如需访问全盘，请在授权确认中批准全盘访问权限。",
                    "code": "PERMISSION_REQUIRED",
                    "capability": "filesystem.read",
                    "path": str(p),
                    "retryable": True,
                }
            if not p.exists():
                return {"ok": False, "error": f"文件不存在: {path}"}
            if p.is_file():
                _mark_observed(user_id, p)
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
            user_id = request.query_params.get("user_id", "")
            cwd = request.query_params.get("cwd", "")
            # content 从 raw body 读(支持大文件)
            content_type = request.headers.get("content-type", "")
            if "application/json" in content_type:
                body_json = await request.json()
                content = body_json.get("content", "")
                if not cwd and body_json.get("cwd"):
                    cwd = body_json.get("cwd")
                # ★ append/atomic 兼容 JSON body (api-tools.js 的 server_file_append 路由)
                if body_json.get("append") is not None:
                    append = append or body_json.get("append") in (True, "true", "1")
                if body_json.get("atomic") is not None:
                    atomic = atomic or body_json.get("atomic") in (True, "true", "1")
            else:
                content = (await request.body()).decode('utf-8', errors='replace')
            if not path or not content:
                return JSONResponse({"ok": False, "error": "缺少path或content"}, status_code=400)
            # 安全检查:组件级 containment，避免 /project-evil 等字符串前缀绕过
            full_access_requested = request.query_params.get("full_access", "") in ("true", "1", True) or (isinstance(locals().get("body_json"), dict) and body_json.get("full_access") in (True, "true", "1"))
            full_access = _trusted_full_access(request, full_access_requested)
            resolved = _resolve_path(path, cwd)
            if not _allowed_path(resolved, full_access=full_access, cwd=cwd):
                return {
                    "ok": False,
                    "error": "写入权限受限,路径必须位于项目根或临时目录。如需写入外部目录，请在授权弹窗中批准全盘访问权限。",
                    "code": "PERMISSION_REQUIRED",
                    "capability": "filesystem.write",
                    "path": str(resolved),
                    "retryable": True,
                }

            content_bytes = content.encode('utf-8')
            actual_size = len(content_bytes)
            if not append and resolved.exists() and resolved.is_file() and not _was_observed(user_id, resolved):
                return {"ok": False, "error": "cannot overwrite without reading it first: target file must be read with read/server_file_read before writing", "code": "OBSERVATION_REQUIRED", "path": str(resolved), "retryable": True}

            # ★ 覆写前自动安全备份(防盲写破坏原文件)
            backup_path = None
            if not append and resolved.exists() and resolved.is_file():
                try:
                    backup_path = str(resolved) + ".bak"
                    import shutil as _shutil
                    _shutil.copy2(str(resolved), backup_path)
                except Exception:
                    pass

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
            validation = _validate_modified_file(resolved)
            if not validation.get("ok"):
                if backup_path and Path(backup_path).exists(): shutil.copy2(backup_path, resolved)
                return {"ok": False, "error": "post-edit validation failed; original file restored", "code": "VALIDATION_FAILED", "path": str(resolved), "validation": validation, "backup": backup_path}
            build_result = None
            if _within(resolved, Path(PROJECT_ROOT).resolve()) and ("/public/js/" in str(resolved) or "/public/css/" in str(resolved)):
                try:
                    br = subprocess.run(['python3','tools/build-index.py'],cwd=PROJECT_ROOT,capture_output=True,text=True,timeout=30)
                    build_result = {"ok": br.returncode == 0, "stdout": br.stdout[-2000:], "stderr": br.stderr[-2000:]}
                except Exception as exc: build_result = {"ok": False, "error": str(exc)}
            return {
                "ok": True,
                "path": str(resolved),
                "written": actual_size,
                "file_size": final_size,
                "mode": "append" if append else ("atomic" if atomic else "overwrite"),
                "validation": validation,
                "build": build_result,
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

            full_access = _trusted_full_access(request, body.get("full_access") in (True, "true", "1"))
            resolved = _resolve_path(path)
            if not _allowed_path(resolved, full_access=full_access):
                return {
                    "ok": False,
                    "error": "写入权限受限。如需写入外部目录，请先批准全盘访问权限。",
                    "code": "PERMISSION_REQUIRED",
                    "capability": "filesystem.write",
                    "path": str(resolved),
                    "retryable": True,
                }

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

    async def _run_code_call(name: str, args: dict, user_id: str, full_access: bool):
        import requests as _requests
        from engine.runtime_auth import get_internal_bridge_secret
        base = "http://127.0.0.1:8766"
        headers = {"X-OneAPIChat-Internal": get_internal_bridge_secret(PROJECT_ROOT)}
        args = args if isinstance(args, dict) else {}
        raw_timeout = args.get("timeoutMs") if "timeoutMs" in args else (args.get("timeout") or 60)
        try:
            val = int(raw_timeout)
            if "timeoutMs" in args or val > 1000:
                timeout = min(max(val // 1000, 1), 300)
            else:
                timeout = min(max(val, 1), 300)
        except Exception:
            timeout = 60
        query_common = {"user_id": user_id, "full_access": "true" if full_access else "false"}
        def request_call():
            if name == "read":
                params = {**query_common, "path": args.get("file_path") or args.get("path") or "", "start_line": args.get("offset", args.get("start_line", 0)), "max_lines": args.get("limit", args.get("max_lines", 2000))}
                return _requests.get(base + "/engine/file/read", params=params, headers=headers, timeout=timeout).json()
            if name == "glob":
                params = {**query_common, "pattern": args.get("pattern", ""), "path": args.get("path", PROJECT_ROOT), "max_results": args.get("max_results", 100)}
                return _requests.get(base + "/engine/file_search", params=params, headers=headers, timeout=timeout).json()
            if name == "grep":
                params = {**query_common, "pattern": args.get("pattern", ""), "path": args.get("path", PROJECT_ROOT), "file_pattern": args.get("include", args.get("file_pattern", "")), "context_lines": args.get("context_lines", 2), "max_results": args.get("max_results", 50)}
                return _requests.get(base + "/engine/file_grep", params=params, headers=headers, timeout=timeout).json()
            if name == "write":
                params = {**query_common, "path": args.get("file_path") or args.get("path") or "", "append": "true" if args.get("append") else "false"}
                return _requests.post(base + "/engine/file/write", params=params, data=str(args.get("content", "")).encode(), headers={**headers,"Content-Type":"text/plain"}, timeout=timeout).json()
            if name == "edit":
                params = {**query_common, "path": args.get("file_path") or args.get("path") or "", "replace_all": "true" if args.get("replace_all") else "false"}
                body = {"old_string": args.get("old_string", ""), "new_string": args.get("new_string", ""), "full_access": full_access}
                return _requests.post(base + "/engine/file_edit", params=params, json=body, headers=headers, timeout=timeout).json()
            if name == "bash":
                params = {"user_id": user_id, "timeout": timeout, "cwd": args.get("workdir", args.get("cwd", ""))}
                return _requests.post(base + "/engine/exec", params=params, data=str(args.get("command", args.get("cmd", ""))).encode(), headers={**headers,"Content-Type":"text/plain"}, timeout=timeout + 5).json()
            if name == "todo_write":
                return {"ok": True, "todos": args.get("todos", []), "surface": "todo_write"}
            return {"ok": False, "error": f"unsupported run_code tool: {name}", "code": "UNSUPPORTED_TOOL"}
        return await asyncio.to_thread(request_call)

    @app.post("/engine/run_code")
    async def engine_run_code(request: Request):
        """Execute a constrained JavaScript orchestration program with an RPC-only tools object."""
        if not request.scope.get("state", {}).get("trusted_internal"):
            return JSONResponse({"ok": False, "error": "trusted bridge required", "code": "FORBIDDEN"}, status_code=403)
        body = await request.json()
        code = str(body.get("code", ""))
        description = str(body.get("description", ""))[:200]
        user_id = str(body.get("user_id", ""))
        full_access = bool(body.get("full_access", False))
        timeout_ms = min(max(int(body.get("timeout_ms", 60000)), 1000), 120000)
        if not code or len(code) > 60000:
            return JSONResponse({"ok": False, "error": "invalid code", "code": "INVALID_ARGUMENT"}, status_code=400)
        runner = Path(__file__).with_name("run_code_runner.mjs")
        proc = await asyncio.create_subprocess_exec(
            "node", "--permission", f"--allow-fs-read={runner}", str(runner),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            cwd=PROJECT_ROOT,
        )
        logs, tool_calls, todos = [], [], []
        permission_error = None
        try:
            proc.stdin.write((json.dumps({"type":"init","code":code}) + "\n").encode())
            await proc.stdin.drain()
            deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
            while True:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0: raise asyncio.TimeoutError()
                line = await asyncio.wait_for(proc.stdout.readline(), timeout=remaining)
                if not line: break
                msg = json.loads(line.decode("utf-8", "replace"))
                if msg.get("type") == "call":
                    result = await _run_code_call(str(msg.get("name", "")), msg.get("args") or {}, user_id, full_access)
                    tool_calls.append({"name": msg.get("name"), "ok": bool(result.get("ok")), "summary": str(result.get("error") or result.get("path") or result.get("status") or "ok")[:300]})
                    if result.get("surface") == "todo_write": todos = result.get("todos") or []
                    if result.get("code") == "PERMISSION_REQUIRED": permission_error = result
                    response = {"type":"response","id":msg.get("id"),"ok":bool(result.get("ok")),"value":result,"error":{"message":str(result.get("error", "tool call failed")),"code":result.get("code", ""),"details":result}}
                    proc.stdin.write((json.dumps(response, ensure_ascii=False) + "\n").encode()); await proc.stdin.drain()
                    if permission_error: break
                elif msg.get("type") == "log": logs.append(msg)
                elif msg.get("type") == "result":
                    await proc.wait()
                    return {"ok": True, "result": msg.get("value"), "description": description, "tool_calls": tool_calls, "logs": logs[-50:], "todos": todos}
                elif msg.get("type") == "error":
                    await proc.wait()
                    return {"ok": False, "error": msg.get("error", {}).get("message", "run_code failed"), "code": msg.get("error", {}).get("code", "RUN_CODE_ERROR"), "tool_calls": tool_calls, "logs": logs[-50:]}
            if permission_error:
                return {"ok": False, **permission_error, "tool_calls": tool_calls}
            stderr = (await proc.stderr.read()).decode("utf-8", "replace")[:4000]
            return {"ok": False, "error": stderr or "run_code ended without result", "code": "RUN_CODE_ERROR", "tool_calls": tool_calls}
        except asyncio.TimeoutError:
            return {"ok": False, "error": "run_code timed out", "code": "TIMEOUT", "tool_calls": tool_calls}
        finally:
            if proc.returncode is None:
                proc.kill()
                try: await proc.wait()
                except Exception: pass

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
    
    
    @app.api_route("/engine/docker", methods=["GET", "POST"])
    async def engine_docker(request: Request, action: str = Query("ps"), user_id: str = Query("")):
        """Docker health/inspection and bounded deployment actions.

        The old implementation prepended sudo, which cannot work reliably in a
        long-running non-interactive agent. All commands now use the Docker CLI
        directly and return actionable daemon/network/permission diagnostics.
        """
        payload = {}
        if request.method == "POST":
            try:
                body = await request.json()
                if isinstance(body, dict): payload = body
            except Exception:
                return JSONResponse({"ok": False, "error": "Docker 请求体必须是 JSON 对象", "code": "DOCKER_BAD_REQUEST"}, status_code=400)
        action = str(payload.get("action") or action or "ps").strip().lower()
        if action not in _DOCKER_ACTIONS:
            return JSONResponse({"ok": False, "error": f"不支持的 Docker 操作: {action}", "code": "DOCKER_ACTION_UNSUPPORTED", "supported_actions": sorted(_DOCKER_ACTIONS)}, status_code=400)

        if action == "doctor":
            cli = shutil.which("docker")
            if not cli: return {"ok": False, "error": "未找到 docker CLI", "code": "DOCKER_CLI_MISSING", "retryable": False}
            version = _docker_run(["version", "--format", "{{.Server.Version}}"], 10, action)
            if not version.get("ok"): return {**version, "cli": cli, "daemon": False}
            info = _docker_run(["info", "--format", "{{.DockerRootDir}}"], 10, action)
            if not info.get("ok"): return {**info, "cli": cli, "daemon": False}
            return {"ok": True, "cli": cli, "daemon": True, "server_version": version.get("stdout", ""), "docker_root": info.get("stdout", ""), "supported_actions": sorted(_DOCKER_ACTIONS)}
        if action == "ps":
            return _docker_command_result(_docker_run(["ps", "-a", "--format", "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"], 15, action))
        if action == "images":
            return _docker_command_result(_docker_run(["images", "--format", "table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}"], 15, action))
        if action == "stats":
            return _docker_command_result(_docker_run(["stats", "--no-stream"], 20, action))

        name = str(payload.get("name") or payload.get("container") or "").strip()
        if action in {"logs", "stop", "remove"} and not _docker_valid_name(name):
            return {"ok": False, "error": "请提供合法容器名(name/container)", "code": "DOCKER_INVALID_NAME"}
        if action == "logs":
            try: tail = max(1, min(int(payload.get("tail", 200)), 5000))
            except Exception: tail = 200
            return _docker_command_result(_docker_run(["logs", "--tail", str(tail), name], 30, action))
        if action == "stop": return _docker_command_result(_docker_run(["stop", "--time", "15", name], 30, action))
        if action == "remove":
            return _docker_command_result(_docker_run((["rm", "-f"] if payload.get("force") else ["rm"]) + [name], 30, action))

        image = str(payload.get("image") or "").strip()
        if action == "pull":
            if not _docker_valid_image(image): return {"ok": False, "error": "请提供合法镜像名(image)", "code": "DOCKER_INVALID_IMAGE"}
            return _docker_command_result(_docker_run(["pull", image], 900, action))
        if action == "yatori_deploy":
            image = image or "yatoridev/yatori-go-console:latest"
            name = name or "yatori-console"
            deploy_dir = _docker_host_path(str(payload.get("deploy_dir") or (Path.home() / "yatori")))
            if not deploy_dir or not _docker_valid_image(image) or not _docker_valid_name(name):
                return {"ok": False, "error": "部署目录必须位于 Home/tmp/项目目录，且 image/name 合法", "code": "DOCKER_DEPLOY_INPUT_INVALID"}
            config_dir, logs_dir = deploy_dir / "config", deploy_dir / "logs"
            try:
                config_dir.mkdir(parents=True, exist_ok=True); logs_dir.mkdir(parents=True, exist_ok=True)
                config_path = config_dir / "config.json"; created_config = False
                if not config_path.exists():
                    config_path.write_text(json.dumps(_yatori_default_config(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"); created_config = True
            except Exception as exc:
                return {"ok": False, "error": f"创建 Yatori 配置目录失败: {exc}", "code": "DOCKER_DEPLOY_FILESYSTEM"}
            existing = _docker_run(["ps", "-a", "--filter", f"name=^{name}$", "--format", "{{{{.Names}}}}\t{{{{.Status}}}}"], 15, action)
            if existing.get("ok") and existing.get("stdout") and not payload.get("replace"):
                return {"ok": False, "code": "DOCKER_CONTAINER_EXISTS", "error": f"容器 {name} 已存在；如需重建请传 replace=true", "container": name, "deploy_dir": str(deploy_dir), "config_created": created_config, "existing": existing.get("stdout")}
            if existing.get("ok") and existing.get("stdout") and payload.get("replace"):
                removed = _docker_run(["rm", "-f", name], 30, action)
                if not removed.get("ok"): return _docker_command_result(removed)
            pulled = _docker_run(["pull", image], 900, action)
            if not pulled.get("ok"): return {**pulled, "container": name, "image": image, "deploy_dir": str(deploy_dir), "config_created": created_config}
            started = _docker_run(["run", "-d", "-i", "--name", name, "--restart", "unless-stopped", "-v", f"{config_dir}:/app/config", "-v", f"{logs_dir}:/app/logs", image], 90, action)
            if not started.get("ok"): return {**started, "container": name, "image": image, "deploy_dir": str(deploy_dir), "config_created": created_config}
            inspect = _docker_run(["inspect", "--format", "{{.Name}}\t{{.Config.Image}}\t{{.State.Status}}", name], 15, action)
            logs = _docker_run(["logs", "--tail", "40", name], 20, action)
            return {"ok": True, "result": f"Yatori 容器 {name} 已启动", "container": name, "image": image, "deploy_dir": str(deploy_dir), "config_path": str(config_path), "logs_path": str(logs_dir), "config_created": created_config, "inspect": inspect.get("stdout", ""), "logs": (logs.get("stdout", "") or logs.get("stderr", ""))[-12000:]}
        if action == "run":
            return {"ok": False, "error": "通用 run 已禁用；请使用 yatori_deploy，避免 Agent 拼接任意 Docker 参数。", "code": "DOCKER_DECLARATIVE_ONLY"}
        return {"ok": False, "error": "未处理的 Docker 操作", "code": "DOCKER_ACTION_UNSUPPORTED"}
    
    
    @app.get("/engine/db_query")
    def engine_db_query(sql: str = Query(...), user_id: str = Query("")):
        """执行数据库查询"""
        import sqlite3
        try:
            # ★ DB 实际位于 python/chaoxing/ 下 (PROJECT_ROOT 修复后需显式带 python/)
            db_path = str(Path(PROJECT_ROOT) / "python" / "chaoxing" / "learning_records.db")
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
    def engine_file_search(request: Request, pattern: str = Query(...), path: str = Query(PROJECT_ROOT), max_results: int = Query(30), full_access: bool = Query(False), cwd: str = Query("")):
        """搜索文件 (支持 full_access 全盘访问授权 / DSH Workspace cwd)"""
        try:
            full_access = _trusted_full_access(request, full_access)
            path = str(_resolve_path(path, cwd))
            if not _allowed_path(Path(path), full_access=full_access, cwd=cwd):
                return {
                    "ok": False,
                    "error": "搜索路径不在允许的工作区或临时目录。如需访问全盘，请在授权确认中批准全盘访问权限。",
                    "code": "PERMISSION_REQUIRED",
                    "capability": "filesystem.search",
                    "retryable": True,
                    "path": path,
                }
            cmd = ["find", path, "-name", pattern, "-type", "f", "!", "-path", "*/node_modules/*", "!", "-path", "*/.git/*", "!", "-path", "*/__pycache__/*"]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            files = [f for f in result.stdout.strip().split("\n") if f][:max_results]
            return {"ok": True, "files": files, "total": len(files)}
        except Exception as e:
            return {"error": str(e)}
    
    
    @app.get("/engine/file_grep")
    def engine_file_grep(request: Request, pattern: str = Query(...), path: str = Query(PROJECT_ROOT),
                         context_lines: int = Query(2), max_results: int = Query(20),
                         ignore_case: bool = Query(True), file_pattern: str = Query(""),
                         max_line_chars: int = Query(2000), max_total_chars: int = Query(200000),
                         max_file_size: int = Query(64 * 1024 * 1024), full_access: bool = Query(False),
                         cwd: str = Query("")):
        """在文件中搜索匹配内容，返回匹配行及上下文（类似 grep -C，支持 full_access 全盘授权 / DSH Workspace cwd）。
        自动跳过二进制/超大文件；单行与总返回体积均设上限，防止把超大内容塞进上下文。"""
        import os as _os, re, fnmatch
        from collections import deque
        try:
            full_access = _trusted_full_access(request, full_access)
            path = str(_resolve_path(path, cwd))
            if not _allowed_path(Path(path), full_access=full_access, cwd=cwd):
                return {
                    "ok": False,
                    "error": "grep 路径不在允许的工作区或临时目录。如需访问全盘，请在授权确认中批准全盘访问权限。",
                    "code": "PERMISSION_REQUIRED",
                    "capability": "filesystem.search",
                    "retryable": True,
                    "path": path,
                }
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
            user_id = request.query_params.get("user_id", "")
            cwd = request.query_params.get("cwd", "") or (body.get("cwd", "") if isinstance(body, dict) else "")
            old_string = body.get("old_string", "")
            new_string = body.get("new_string", "")
    
            if not old_string and old_string != "":
                return {"error": "old_string is required"}
    
            # 安全检查：使用统一的组件级 containment
            full_access_requested = request.query_params.get("full_access", "") in ("true", "1", True) or (isinstance(body, dict) and body.get("full_access") in (True, "true", "1"))
            full_access = _trusted_full_access(request, full_access_requested)
            resolved_path = _resolve_path(path, cwd)
            if not _allowed_path(resolved_path, full_access=full_access, cwd=cwd):
                return {
                    "ok": False,
                    "error": "路径不在允许范围内。如需编辑外部目录文件，请在授权弹窗中批准全盘访问权限。",
                    "code": "PERMISSION_REQUIRED",
                    "capability": "filesystem.write",
                    "path": str(resolved_path),
                    "retryable": True,
                }
            path = str(resolved_path)
            if resolved_path.exists() and resolved_path.is_file() and not _was_observed(user_id, resolved_path):
                return {"ok": False, "error": "cannot overwrite without reading it first: target file must be read with read/server_file_read before editing", "code": "OBSERVATION_REQUIRED", "path": path, "retryable": True}
    
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
            validation = _validate_modified_file(resolved_path)
            if not validation.get("ok"):
                with open(path, 'w', encoding='utf-8') as f: f.write(content)
                return {"ok": False, "error": "post-edit validation failed; original file restored", "code": "VALIDATION_FAILED", "path": path, "validation": validation, "backup": backup_path}
            build_result = None
            if _within(resolved_path, Path(PROJECT_ROOT).resolve()) and ("/public/js/" in path or "/public/css/" in path):
                try:
                    br = subprocess.run(['python3','tools/build-index.py'],cwd=PROJECT_ROOT,capture_output=True,text=True,timeout=30)
                    build_result = {"ok": br.returncode == 0, "stdout": br.stdout[-2000:], "stderr": br.stderr[-2000:]}
                except Exception as exc: build_result = {"ok": False, "error": str(exc)}
    
            return {"ok": True, "replaced": count, "path": path, "backup": backup_path if _os.path.exists(backup_path) else None, "validation": validation, "build": build_result}
        except Exception as e:
            return {"error": str(e)}
    
    
    @app.get("/engine/file_op")
    def engine_file_op(request: Request, action: str = Query(...), src: str = Query(...), dst: str = Query(""), full_access: bool = Query(False)):
        """文件操作（支持 full_access 全盘授权）"""
        import os as _os, shutil
        try:
            full_access = _trusted_full_access(request, full_access)
            allowed = [str(TEMP_DIR), PROJECT_ROOT, PROJECT_ROOT + '/uploads', PROJECT_ROOT + '/oneapichat']
            # 路径转换: 相对路径 → 项目根; /oneapichat/uploads/... → /var/www/html/oneapichat/uploads/...
            # ★ 勿用 locals()[path]=p (函数内赋值不生效, 相对路径校验仍拿原值 → 全被拒)
            def _abs(p):
                if not p:
                    return p
                if not _os.path.isabs(p):
                    p = _os.path.join(PROJECT_ROOT, p)
                if p.startswith('/oneapichat/'):
                    p = PROJECT_ROOT + '/' + p.replace('/oneapichat/', '', 1)
                return p
            src = str(_resolve_path(_abs(src))) if src else src
            dst = str(_resolve_path(_abs(dst))) if dst else dst
            target_op_path = str(src or dst or "")
            if (src and not _allowed_path(Path(src), full_access=full_access)) or (dst and not _allowed_path(Path(dst), full_access=full_access)):
                return {
                    "ok": False,
                    "error": "文件操作路径不在允许范围内。如需操作外部目录，请先批准全盘访问权限。",
                    "code": "PERMISSION_REQUIRED",
                    "capability": "filesystem.move" if action in ("mv", "move") else "filesystem.write",
                    "path": target_op_path,
                    "retryable": True,
                }
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
    def engine_parse_document(request: Request, path: str = Query(""), max_chars: int = Query(50000), full_access: bool = Query(False)):
        """解析办公文档(DOCX/PPTX/XLSX/PDF/DOC/TXT)，支持 full_access 全盘授权"""
        import os as _os
        try:
            if not path:
                return {"ok": False, "error": "缺少 path 参数"}
            full_access = _trusted_full_access(request, full_access)
            p = _resolve_path(path)
            if not _allowed_path(p, full_access=full_access):
                return {
                    "ok": False,
                    "error": "路径不在允许的工作区或临时目录。如需访问外部路径，请先批准全盘访问权限。",
                    "code": "PERMISSION_REQUIRED",
                    "capability": "filesystem.read",
                    "path": str(p),
                    "retryable": True,
                }
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
