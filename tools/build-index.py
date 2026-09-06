#!/usr/bin/env python3
"""
build-index.py — 自动生成 public/index.html 的 <script>/<link> 标签

解决的问题:
  - agent 手动改 41 个 ?v= 版本号容易漏改/错改
  - public/index.html 与根 index.html 双文件不同步

工作原理:
  - 扫描 js/*.js / css/*.css / lib/ 等目录，按文件 mtime 自动生成 ?v=
  - 解析 index.html 中的特殊占位标记，整体替换其中的资源标签块
  - 输出到 public/index.html，并同步拷贝到根 index.html（如果根不是 symlink）

占位标记（在 index.html 中保留）:
  <!-- AUTO-GENERATED-START -->
  ... 这之间的内容会被整体替换 ...
  <!-- AUTO-GENERATED-END -->

用法:
  python3 tools/build-index.py            # 生成并同步
  python3 tools/build-index.py --check    # 只检查是否过期（CI用）
  python3 tools/build-index.py --watch    # 监听文件变化自动重建（开发用）
"""

import os
import re
import sys
import glob
import shutil
import hashlib
import time
from pathlib import Path

# ── 路径 ──
# 注意: 项目使用 symlink 结构:
#   根 js -> public/js, 根 css -> public/css, 根 lib -> public/lib/lib
#   nginx serve 根路径，所以浏览器 ./js/xxx 解析到 public/js/xxx
#   ./lib/xxx 解析到 public/lib/lib/xxx (因为根 lib symlink 指向 public/lib/lib)
#   生成器从根目录扫描（跟随 symlink）以匹配浏览器真实路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_INDEX = PROJECT_ROOT / "public" / "index.html"
ROOT_INDEX = PROJECT_ROOT / "index.html"
# 扫描根目录（含 symlink 解析）
SCAN_ROOT = PROJECT_ROOT  # 根目录（js/css/lib 都是 symlink）

# ── 资源配置（路径, 是否defer, 额外属性） ──
# 顺序很重要：core.js 必须在最前，main.js 必须在最后
CORE_MODULES = [
    ("js/core.js", True, ""),
    # Theme Studio 初始化 data-theme-page/scope/density 等语义属性，必须早于 UI 渲染。
    ("js/theme-studio.js", True, ""),
    ("js/translations.js", True, ""),
    ("js/image-gen.js", True, ""),
    ("js/markdown.js", True, ""),
    ("js/agent.js", True, ""),
    ("js/workspace.js", True, ""),
    ("js/storage.js", True, ""),
    ("js/config.js", True, ""),
    ("js/dialogs.js", True, ""),
    ("js/cloudreve.js", True, ""),
    ("js/amap.js", True, ""),
    ("js/netdisk.js", True, ""),
    ("js/rag-system.js", True, ""),
    ("js/chaoxing-tools.js", True, ""),
    ("js/files.js", True, ""),
    ("js/rendering.js", True, ""),
    ("js/search.js", True, ""),
    ("js/ui.js", True, ""),
    ("js/scroll-follow.js", True, ""),
    ("js/model-status.js", True, ""),
    ("js/utils.js", True, ""),
    ("js/update-check.js", True, ""),
    ("js/skills.js", True, ""),
    ("js/tools-exec.js", True, ""),
    ("js/init.js", True, ""),
    ("js/agent-notify.js", True, ""),
    ("js/models.js", True, ""),
    ("js/tools.js", True, ""),
    ("js/upload.js", True, ""),
    ("js/queue.js", True, ""),
    ("js/commands.js", True, ""),
    ("js/resume-stream.js", True, ""),
    ("js/api-messages.js", True, ""),
    ("js/loop-guard.js", True, ""),
    ("js/stream-handler.js", True, ""),
    ("js/usage-stats.js", True, ""),
    ("js/main.js", True, ""),
]

CSS_MODULES = [
    ("lib/katex/katex.min.css", False, ""),
    ("css/tailwind-index.min.css", False, ""),
    ("css/style.css", False, ""),
    # Theme Studio 必须位于 style.css 之后，提供 chat theme 的最终覆盖层。
    ("css/theme-studio.css", False, ""),
    ("css/usage-stats.css", False, ""),
    ("css/src-console.css", False, ""),
]

# 路径说明:
#   浏览器请求 ./lib/xxx → 根 lib symlink → public/lib/lib/xxx
#   所以真实文件在 public/lib/lib/ 下, 但 src 按浏览器路径写
LIB_MODULES = [
    ("lib/katex/katex.min.js", False, ""),
    ("lib/katex/auto-render.min.js", False, ""),
    ("lib/highlight.min.js", False, ""),
    ("lib/marked.min.js", False, ""),
    ("lib/mermaid/mermaid.min.js", True, ""),
    ("lib/jszip.min.js", False, ""),
]

# 浏览器请求路径 → 真实文件路径 映射（因为根 lib symlink 指向 public/lib/lib）
SRC_TO_REAL = {
    "lib/katex/katex.min.js": "lib/lib/katex/katex.min.js",
    "lib/katex/auto-render.min.js": "lib/lib/katex/auto-render.min.js",
    "lib/highlight.min.js": "lib/lib/highlight.min.js",
    "lib/marked.min.js": "lib/lib/marked.min.js",
    "lib/mermaid/mermaid.min.js": "lib/lib/mermaid/mermaid.min.js",
    "lib/jszip.min.js": "lib/lib/jszip.min.js",
}


def file_mtime_version(filepath: Path) -> str:
    """取文件 mtime 作为版本号（Unix 时间戳 10 位），跟随符号链接"""
    try:
        # resolve() 跟随符号链接取真实文件; 链接断裂时 fallback 到 lexists
        real = filepath.resolve(strict=False)
        if real.exists():
            mtime = real.stat().st_mtime
        else:
            mtime = filepath.stat().st_mtime  # 可能抛 FileNotFoundError
        return str(int(mtime))
    except FileNotFoundError:
        return "0"


def file_md5_version(filepath: Path, length: int = 8) -> str:
    """取文件内容 md5 前 N 位作为版本号（备选方案）"""
    try:
        h = hashlib.md5(filepath.read_bytes()).hexdigest()[:length]
        return h
    except FileNotFoundError:
        return "missing"


def build_tag(src: str, defer: bool = False, extra: str = "") -> str:
    """生成单个 script/link 标签

    浏览器路径通过项目根 symlink 解析:
      ./js/foo.js    → public/js/foo.js      (根 js -> public/js)
      ./css/foo.css  → public/css/foo.css    (根 css -> public/css)
      ./lib/foo.js   → public/lib/lib/foo.js (根 lib -> public/lib/lib)

    直接用 PROJECT_ROOT / src 跟随 symlink 取 mtime
    """
    full_path = SCAN_ROOT / src
    ver = file_mtime_version(full_path)

    # CSS 用 link，JS 用 script
    ext = Path(src).suffix.lower()
    if ext == ".css":
        tag = f'<link rel="stylesheet" href="./{src}?v={ver}">'
    else:
        defer_attr = ' defer' if defer else ''
        tag = f'<script{defer_attr} src="./{src}?v={ver}"></script>'

    if extra:
        tag = tag.replace(">", f" {extra}>")
    return tag


def generate_all_tags() -> str:
    """生成完整的资源标签块"""
    lines = []
    lines.append("    <!-- ═══ 核心 JS 模块 (defer 按序加载, 版本号自动生成) ═══ -->")

    for src, defer, extra in CORE_MODULES:
        full_path = SCAN_ROOT / src  # 跟随 symlink
        if not full_path.exists():
            lines.append(f"    <!-- ⚠️ 缺失: {src} -->")
            continue
        lines.append("    " + build_tag(src, defer, extra))

    lines.append("")
    lines.append("    <!-- ═══ CSS 样式 ═══ -->")
    for src, defer, extra in CSS_MODULES:
        full_path = SCAN_ROOT / src
        if not full_path.exists():
            lines.append(f"    <!-- ⚠️ 缺失: {src} -->")
            continue
        lines.append("    " + build_tag(src, defer, extra))

    lines.append("")
    lines.append("    <!-- ═══ 第三方库 (lib/) ═══ -->")
    for src, defer, extra in LIB_MODULES:
        full_path = SCAN_ROOT / src
        if not full_path.exists():
            lines.append(f"    <!-- ⚠️ 缺失: {src} -->")
            continue
        lines.append("    " + build_tag(src, defer, extra))

    return "\n".join(lines)


def replace_auto_generation_block(html: str, new_content: str) -> str:
    """替换 AUTO-GENERATED-START/END 之间的内容（保留标记本身）"""
    # 严格匹配: 从 START 行到 END 行（含），保留两个标记
    # 使用锚定匹配避免跨行吃到其他注释
    pattern = re.compile(
        r'^[ \t]*<!--\s*AUTO-GENERATED-START\s*-->\n'
        r'.*?\n'  # 中间内容（非贪婪）
        r'[ \t]*<!--\s*AUTO-GENERATED-END\s*-->$',
        re.DOTALL | re.MULTILINE,
    )
    if not pattern.search(html):
        raise ValueError(
            "index.html 中未找到 AUTO-GENERATED-START/END 占位标记！\n"
            "请在 <head> 末尾的 script 标签前添加：\n"
            "  <!-- AUTO-GENERATED-START -->\n"
            "  <!-- AUTO-GENERATED-END -->"
        )
    # 保留 START/END 标记，只替换中间内容
    replacement = '<!-- AUTO-GENERATED-START -->\n' + new_content + '\n    <!-- AUTO-GENERATED-END -->'
    return pattern.sub(replacement, html, count=1)


def sync_to_root():
    """同步 public/index.html 到根 index.html"""
    if ROOT_INDEX.is_symlink():
        target = os.readlink(ROOT_INDEX)
        print(f"  ✓ 根 index.html 已是 symlink → {target}")
        return

    # 如果根文件存在且不是 symlink，拷贝过去
    if ROOT_INDEX.exists():
        shutil.copy2(PUBLIC_INDEX, ROOT_INDEX)
        print(f"  ✓ 已同步 public/index.html → 根 index.html")
    else:
        # 创建 symlink
        os.symlink(PUBLIC_INDEX.name, ROOT_INDEX)
        print(f"  ✓ 已创建 symlink 根 index.html → public/")


def check_mode() -> bool:
    """检查模式：验证当前 index.html 是否过期"""
    html = PUBLIC_INDEX.read_text(encoding="utf-8")
    pattern = re.compile(
        r'<!--\s*AUTO-GENERATED-START\s*-->(.*?)<!--\s*AUTO-GENERATED-END\s*-->',
        re.DOTALL,
    )
    match = pattern.search(html)
    if not match:
        print("❌ 未找到 AUTO-GENERATED 占位标记")
        return False

    current_block = match.group(1)
    new_block = generate_all_tags()

    if current_block.strip() == new_block.strip():
        print("✓ index.html 资源标签已是最新")
        return True
    else:
        print("❌ index.html 资源标签过期，请运行: python3 tools/build-index.py")
        return False


def watch_mode():
    """监听文件变化自动重建"""
    print("👀 监听 public/js/ 和 public/css/ 变化，Ctrl+C 退出...")
    last_mtime = 0
    while True:
        try:
            # 扫描所有 js/css 文件的最新 mtime
            latest = 0
            for pattern in ["js/*.js", "css/*.css", "lib/**/*.js", "lib/**/*.css"]:
                for f in (PROJECT_ROOT / "public").glob(pattern):
                    try:
                        m = f.stat().st_mtime
                        if m > latest:
                            latest = m
                    except:
                        pass

            if latest > last_mtime:
                last_mtime = latest
                print(f"\n🔄 检测到变化，重建中... ({time.strftime('%H:%M:%S')})")
                rebuild()
            time.sleep(2)
        except KeyboardInterrupt:
            print("\n👋 已退出")
            break


def rebuild():
    """执行重建"""
    print("📦 读取 index.html...")
    html = PUBLIC_INDEX.read_text(encoding="utf-8")

    print("🔧 生成资源标签...")
    new_tags = generate_all_tags()

    print("✏️  替换自动生成的块...")
    new_html = replace_auto_generation_block(html, new_tags)

    PUBLIC_INDEX.write_text(new_html, encoding="utf-8")
    print(f"  ✓ 已写入 {PUBLIC_INDEX}")

    sync_to_root()
    print("✅ 重建完成")


def main():
    if "--check" in sys.argv:
        sys.exit(0 if check_mode() else 1)
    elif "--watch" in sys.argv:
        watch_mode()
    else:
        rebuild()


if __name__ == "__main__":
    main()
