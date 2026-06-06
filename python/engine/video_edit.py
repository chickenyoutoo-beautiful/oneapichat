"""
OneAPIChat Engine - 视频编辑工具函数
提取自 engine_server.py — 字幕/滤镜/合成/TTS
"""
import os
import json
import glob
import subprocess
import tempfile
from pathlib import Path


# ── 字幕字体配置 ──
SUBTITLE_FONTS = {
    "noto-sans": "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "noto-sans-bold": "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "noto-serif": "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "noto-serif-bold": "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
    "wqy-zenhei": "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "droid": "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    "nimbus-sans": "/usr/share/fonts/X11/Type1/NimbusSans-Regular.pfb",
    "nimbus-mono": "/usr/share/fonts/opentype/urw-base35/NimbusMonoPS-Regular.otf",
}
DEFAULT_FONT = SUBTITLE_FONTS.get("noto-sans", list(SUBTITLE_FONTS.values())[0])


def generate_srt(subtitles, output_srt_path):
    """根据字幕数组生成 SRT 文件"""
    with open(output_srt_path, 'w', encoding='utf-8') as f:
        for i, sub in enumerate(subtitles, 1):
            start = sub.get("start", 0)
            end = sub.get("end", start + 3)
            text = sub.get("text", "")
            def _fmt_ts(t):
                h = int(t // 3600)
                m = int((t % 3600) // 60)
                s = int(t % 60)
                ms = int((t % 1) * 1000)
                return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
            f.write(f"{i}\n{_fmt_ts(start)} --> {_fmt_ts(end)}\n{text}\n\n")
    return output_srt_path


def str_to_rgb(s):
    """颜色字符串转 RGB 元组"""
    color_map = {"black": (0,0,0), "white": (255,255,255), "red": (255,0,0),
                 "green": (0,255,0), "blue": (0,0,255), "gray": (128,128,128)}
    return color_map.get(s.lower().strip(), (0, 0, 0))


def color_to_ass(color_name):
    """颜色名转 ASS 格式 (BBGGRR 十六进制)"""
    rgb = str_to_rgb(color_name)
    return f"{rgb[2]:02X}{rgb[1]:02X}{rgb[0]:02X}"


def ypos_to_alignment(y_pos):
    """Y 位置转 ASS alignment 值 (1-9, 数字小键盘布局)"""
    if isinstance(y_pos, str):
        y_pos = y_pos.lower().strip()
        if y_pos == "top": return 8
        if y_pos == "middle": return 5
        return 2
    try:
        return int(y_pos)
    except (ValueError, TypeError):
        return 2


def hex_to_rgba(hex_color, alpha):
    """十六进制颜色转 RGBA 元组"""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 3:
        hex_color = ''.join([c*2 for c in hex_color])
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    return (r, g, b, int(alpha))


def draw_rounded_rect(draw, rect, radius, fill):
    """在 Pillow ImageDraw 上绘制圆角矩形"""
    from PIL import ImageDraw
    x1, y1, x2, y2 = rect
    r = min(radius, (x2-x1)//2, (y2-y1)//2)
    draw.rectangle([x1+r, y1, x2-r, y2], fill=fill)
    draw.rectangle([x1, y1+r, x2, y2-r], fill=fill)
    draw.pieslice([x1, y1, x1+2*r, y1+2*r], 180, 270, fill=fill)
    draw.pieslice([x2-2*r, y1, x2, y1+2*r], 270, 360, fill=fill)
    draw.pieslice([x1, y2-2*r, x1+2*r, y2], 90, 180, fill=fill)
    draw.pieslice([x2-2*r, y2-2*r, x2, y2], 0, 90, fill=fill)
