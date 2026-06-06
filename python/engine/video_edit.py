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

# ── 模块级共享状态 (由 engine_server 初始化) ──
_project_root = None
_temp_dir = None
_http_session = None

def init_video_context(project_root, temp_dir=None, http_session=None):
    """由 engine_server 在启动时调用,初始化视频模块的共享状态"""
    global _project_root, _temp_dir, _http_session
    _project_root = str(project_root) if project_root else None
    _temp_dir = str(temp_dir) if temp_dir else None
    _http_session = http_session


# ── 视频合成 (迁移自 engine_server.py) ──
def _apply_compose(input_path, output_path, params):
    """
    compose v3 — 纯 ffmpeg 管线: 字幕烧录 + 逐句配音 + 原音保留 + 零帧率变化
    """
    import tempfile as _tmp, json as _json, shutil, hashlib
    timeline = params.get("timeline", [])
    if not timeline or not isinstance(timeline, list):
        return "错误: compose 需要 timeline 数组"

    # 全局默认值
    default_fs = int(params.get("fontsize", 28))
    default_font = params.get("font", "noto-sans-bold")
    default_color = params.get("color", "white")
    default_bg_enabled = params.get("bg", True)
    default_bg_opacity = float(params.get("bg_opacity", 0.5))
    default_bg_color = params.get("bg_color", "#1a1a2e")
    default_bg_radius = int(params.get("bg_radius", 12))
    default_stroke_w = int(params.get("stroke_width", 1))
    default_stroke_c = params.get("stroke_color", "#00000080")
    default_y_margin = int(params.get("y_margin", 40))
    global_voice_id = params.get("voice_id", "female-yujie")
    bg_volume = float(params.get("bg_volume", 0.3))

    # ── 弹幕参数 ──
    _dmk_pngs_to_clean = []
    danmaku_enabled = params.get("danmaku", False)
    danmaku_rows = int(params.get("danmaku_rows", 2))       # 同时显示几行弹幕
    danmaku_speed = float(params.get("danmaku_speed", 300))  # 像素/秒
    danmaku_fontsize = int(params.get("danmaku_fontsize", default_fs))
    danmaku_color = params.get("danmaku_color", "#ffffff")
    danmaku_stroke_w = int(params.get("danmaku_stroke_w", 1))
    danmaku_stroke_c = params.get("danmaku_stroke_c", "#000000")
    danmaku_opacity = float(params.get("danmaku_opacity", 0.85))
    danmaku_random_color = params.get("danmaku_random_color", False)  # 每条弹幕随机颜色
    danmaku_random_y = params.get("danmaku_random_y", False)          # 随机行位置
    
    # 弹幕随机颜色池
    _danmaku_colors = [
        "#ffffff", "#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff",
        "#ff7eb3", "#7bed9f", "#e056fd", "#f0932b", "#22a6b3",
        "#eb4d4b", "#6ab04c", "#e84118", "#fbc531", "#58b19f",
        "#c44569", "#cf6a87", "#786fa6", "#f19066", "#e66767"
    ]
    import random as _random

    # ── 滤镜: compose 支持直接应用滤镜再叠加字幕 ──
    filter_type = params.get("filter", params.get("filter_type", ""))
    if filter_type and filter_type != "none":
        # 对输入视频先应用滤镜, 结果作为后续字幕叠加的输入
        _filtered_path = _tmp.mktemp(suffix='_filtered.mp4')
        _filter_params = dict(params)
        _filter_params["type"] = filter_type
        _fr = _apply_ffmpeg_filter(input_path, _filtered_path, _filter_params)
        if "失败" in _fr:
            return _fr
        input_path = _filtered_path
        _filtered_input = True
    else:
        _filtered_input = False

    # Step 1: 逐条渲染字幕为带时间戳的 PNG 图片
    from PIL import Image, ImageDraw, ImageFont
    font_path = SUBTITLE_FONTS.get(default_font, DEFAULT_FONT)
    try:
        pil_font = ImageFont.truetype(font_path, default_fs)
    except Exception:
        pil_font = ImageFont.truetype(DEFAULT_FONT, default_fs)
    # ★ emoji 回退字体: Symbola 支持所有 Unicode emoji (Pillow 兼容)
    _emoji_font_path = "/usr/share/fonts/truetype/ancient-scripts/Symbola_hint.ttf"
    _emoji_font = None
    if os.path.exists(_emoji_font_path):
        try:
            _emoji_font = ImageFont.truetype(_emoji_font_path, default_fs)
        except Exception:
            pass

    def _is_emoji(ch):
        """判断字符是否为 emoji (Unicode emoji 范围)"""
        cp = ord(ch)
        # Emoticons, Dingbats, Misc Symbols, Supplemental Symbols, Transport, etc
        return (0x1F300 <= cp <= 0x1F9FF or  # Emoticons, Misc, Supplemental, Symbols&Pictographs, etc
                0x2600 <= cp <= 0x27BF or   # Misc Symbols, Dingbats
                0x2300 <= cp <= 0x23FF or   # Misc Technical
                0x2B50 <= cp <= 0x2B55 or   # Star, etc
                0x2702 <= cp <= 0x27B0 or   # Dingbats
                0x200D == cp or cp == 0xFE0F)  # ZWJ, Variation Selector

    def _render_text_emoji(draw, xy, text, main_font, color, sw, sf):
        """逐字渲染: emoji 用 Symbola 回退"""
        x0, y0 = xy
        for ch in text:
            if _is_emoji(ch) and _emoji_font:
                ch_font = _emoji_font
            elif main_font.getmask(ch):
                ch_font = main_font
            else:
                ch_font = _emoji_font or main_font
            draw.text((x0, y0), ch, font=ch_font, fill=color,
                      stroke_width=sw if sw > 0 else 0, stroke_fill=sf)
            x0 += ch_font.getlength(ch)

    subtitle_overlays = []  # [(png_path, start_sec, end_sec), ...]
    danmaku_overlays = []  # [(text, start, end, fontsize, sw, sc), ...] 延迟到 Step 3 渲染
    for i, seg in enumerate(timeline):
        t = seg.get("text", "").strip()
        if not t:
            continue
        seg_fs = int(seg.get("fontsize", default_fs))
        seg_color = seg.get("color", default_color)
        seg_bg = seg.get("bg", default_bg_enabled)
        seg_bg_color = seg.get("bg_color", default_bg_color)
        seg_bg_opacity = float(seg.get("bg_opacity", default_bg_opacity))
        seg_bg_r = int(seg.get("bg_radius", default_bg_radius))
        seg_sw = int(seg.get("stroke_width", default_stroke_w))
        seg_sc = seg.get("stroke_color", default_stroke_c)
        seg_ym = int(seg.get("y_margin", default_y_margin))

        # 每句可用不同字号→需要新字体对象
        try:
            _font = ImageFont.truetype(font_path, seg_fs)
        except Exception:
            _font = pil_font

        lines = t.split('\n')
        line_imgs = []
        max_w = 0; total_h = 0
        px = 24; py = 14
        for line in lines:
            line = line.strip()
            if not line: line = ' '
            # 混合 bbox: emoji 用 Symbola, 其他用主字体
            _lw = 0; _lh = 0
            for ch in line:
                _cf = _emoji_font if (_is_emoji(ch) and _emoji_font) else _font
                _cb = _cf.getbbox(ch)
                _lw += _cb[2] - _cb[0] + 1
                _lh = max(_lh, _cb[3] - _cb[1] + 4)
            iw = _lw + px * 2
            ih = _lh + py
            img = Image.new('RGBA', (iw, ih), (0,0,0,0))
            draw = ImageDraw.Draw(img)
            if seg_bg:
                _rgba = hex_to_rgba(seg_bg_color, seg_bg_opacity)
                draw_rounded_rect(draw, (0,0,iw,ih), seg_bg_r, _rgba)
            _render_text_emoji(draw, (px, py//2-2), line, _font, seg_color, seg_sw, seg_sc)
            line_imgs.append(img)
            max_w = max(max_w, iw)
            total_h += ih

        final_img = Image.new('RGBA', (max_w, total_h+4), (0,0,0,0))
        cy = 2
        for img in line_imgs:
            final_img.paste(img, ((max_w-img.width)//2, cy), img)
            cy += img.height

        png_path = _tmp.mktemp(suffix=f'_sub{i}.png')
        final_img.save(png_path)
        start_t = float(seg.get("start", 0))
        end_t = float(seg.get("end", start_t + 3))
        
        # 检查是否为弹幕模式
        is_danmaku = danmaku_enabled and seg.get("danmaku", False)
        if is_danmaku:
            danmaku_overlays.append((t, start_t, end_t, seg_fs, seg_sw, seg_sc))
        else:
            subtitle_overlays.append((png_path, start_t, end_t, seg_ym, final_img.height))

    # Step 2: 逐句 TTS
    mmx_bin = "/home/naujtrats/.npm-global/bin/mmx"
    if not os.path.exists(mmx_bin):
        mmx_bin = "mmx"
    tts_segments = []
    for i, seg in enumerate(timeline):
        t = seg.get("text", "").strip()
        if not t:
            continue
        start = seg.get("start", 0)
        end = seg.get("end", start + 3)
        window_dur = end - start
        char_count = len(t.replace(' ', '').replace('\n', ''))
        est_speed = round(char_count/(window_dur*4), 1) if window_dur > 0 else 1.0
        speed = max(0.7, min(1.5, est_speed))
        seg_voice = seg.get("voice_id", global_voice_id)

        audio_out = _tmp.mktemp(suffix=f'_seg{i}.m4a')
        _before = set(glob.glob(os.path.join(_project_root, "speech_*.mp3")))
        cmd = [mmx_bin, "--region","cn","speech","synthesize",
               "--text",t,"--voice",seg_voice,"--speed",str(speed),"--output",audio_out]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60, cwd=_project_root)
        if r.returncode != 0:
            continue
        _after = set(glob.glob(os.path.join(_project_root, "speech_*.mp3")))
        _new = list(_after - _before)
        if _new:
            shutil.move(max(_new, key=os.path.getmtime), audio_out)
        else:
            _sf = glob.glob(os.path.join(_project_root, "speech_*.mp3"))
            if _sf:
                shutil.copy(max(_sf, key=os.path.getmtime), audio_out)

        r_info = subprocess.run(["ffprobe","-v","quiet","-print_format","json","-show_format",audio_out],
                               capture_output=True, text=True, timeout=10)
        actual_dur = float(_json.loads(r_info.stdout).get("format",{}).get("duration",1))
        if actual_dur > window_dur:
            trimmed = _tmp.mktemp(suffix=f'_seg{i}_trim.m4a')
            subprocess.run(["ffmpeg","-y","-i",audio_out,"-ss","0","-t",str(window_dur),
                           "-c:a","aac",trimmed], capture_output=True, timeout=15)
            try: os.unlink(audio_out)
            except Exception: pass
            audio_out = trimmed
        tts_segments.append((audio_out, float(start)))

    # Step 3: ffmpeg 混合 — overlay 字幕 + amix 音频(原音+TTS)
    import ffmpeg as _fm

    # 获取视频信息
    probe = _fm.probe(input_path)
    vw = int(probe['streams'][0]['width'])
    vh = int(probe['streams'][0]['height'])

    # ── 分辨率兼容处理: 确保宽高为偶数(编码器要求), 非标准比例自动扩边 ──
    _needs_resize = False
    _target_w, _target_h = vw, vh
    
    # 检查是否为偶数
    if vw % 2 != 0 or vh % 2 != 0:
        _target_w = vw + (vw % 2)
        _target_h = vh + (vh % 2)
        _needs_resize = True
    
    # 检查是否超过编码器常见上限(1080p以上用 high profile)
    _high_res = _target_w > 1920 or _target_h > 1080
    
    # 检查宽高比是否标准(16:9, 4:3, 1:1, 9:16, 3:4, 3:2 等常见比例)
    _ratio = _target_w / _target_h if _target_h > 0 else 1
    _standard_ratios = [16/9, 9/16, 4/3, 3/4, 1/1, 3/2, 2/3, 21/9, 9/21, 1.91/1, 1/1.91]
    _is_standard = any(abs(_ratio - r) / r < 0.02 for r in _standard_ratios)
    
    # 非标准比例 → 自动缩放到最近的标准 16:9 或保持宽高比但确保兼容
    if not _is_standard and params.get("auto_fix_ratio", True):
        # 保持原比例,只做 pad 到标准分辨率(加黑边)
        _pad_w = _target_w
        _pad_h = _target_h
        if abs(_ratio - 16/9) < abs(_ratio - 4/3):
            # 接近16:9 →  pad 到精确 16:9
            _pad_w = _target_w
            _pad_h = int(_target_w * 9 / 16)
            if _pad_h < _target_h: _pad_w, _pad_h = int(_target_h * 16 / 9), _target_h
        else:
            # 接近4:3 → pad 到精确 4:3
            _pad_w = _target_w
            _pad_h = int(_target_w * 3 / 4)
            if _pad_h < _target_h: _pad_w, _pad_h = int(_target_h * 4 / 3), _target_h
        # 确保偶数
        _pad_w += _pad_w % 2
        _pad_h += _pad_h % 2
        if _pad_w != _target_w or _pad_h != _target_h:
            _needs_resize = True
            _pad_w, _pad_h = _target_w, _target_h  # 保持原始分辨率,只确保偶数
    
    vid = _fm.input(input_path)
    video_stream = vid.video
    
    # ★ 如果没有音频流,提前创建空音轨防止 amix 报错
    has_audio = False
    try:
        has_audio = vid.audio is not None
    except Exception:
        pass
    
    audio_streams = []
    if has_audio:
        audio_streams.append(vid.audio.filter('volume', bg_volume))
    
    # 非偶数分辨率 → 先 scale
    if _needs_resize and params.get("auto_fix_ratio", True):
        from math import ceil
        _fix_w = int(ceil(vw / 2) * 2)
        _fix_h = int(ceil(vh / 2) * 2)
        if _fix_w != vw or _fix_h != vh:
            video_stream = video_stream.filter('scale', _fix_w, _fix_h)

    # ── 字幕 overlay 链 ──
    current_v = video_stream
    for png_path, st, et, ym, imgh in subtitle_overlays:
        dur = max(0.05, et - st)
        # overlay: PNG → 半透明叠加, 仅在时间窗口内显示
        overlay_img = _fm.input(png_path)
        y_pos = f"{vh - ym - imgh}"
        x_pos = f"(main_w-overlay_w)/2"
        current_v = current_v.overlay(
            overlay_img,
            x=x_pos,
            y=y_pos,
            enable=f"between(t,{st},{et})",
            format='auto'
        )
    
    # ── 弹幕 overlay: 从右到左飞过 ──
    if danmaku_overlays:
        _danmaku_height = danmaku_fontsize + 16  # 每行弹幕高度
        _danmaku_row_h = _danmaku_height + 8      # 行间距
        _danmaku_top_margin = int(vh * 0.05)       # 顶部留白 5%
        # 每行弹幕用不同的 y 偏移, 自动分配行号
        _dmk_row_counter = 0
        _dmk_y_offset_pool = list(range(danmaku_rows)) * 100  # 循环分配行号
        for idx, (dtext, dst, det, dfs, dsw, dsc) in enumerate(danmaku_overlays):
            # 渲染弹幕文字到定宽 PNG
            try:
                _dmk_font = ImageFont.truetype(font_path, dfs)
            except Exception:
                _dmk_font = pil_font
            # 计算文字渲染宽度
            _dmk_tw = 0
            for ch in dtext:
                _cf = _emoji_font if (_is_emoji(ch) and _emoji_font) else _dmk_font
                _dmk_tw += _cf.getbbox(ch)[2] - _cf.getbbox(ch)[0] + 1
            _dmk_tw += 20  # padding
            # 弹幕 PNG: 宽度=视频宽度(方便右到左滑动), 高度=文字行高
            _dmk_pad = int(vw * 0.12)  # 额外右边空白让文字滑入
            _dmk_pw = vw + _dmk_tw + _dmk_pad
            _dmk_ph = _danmaku_height
            
            dmg = Image.new('RGBA', (_dmk_pw, _dmk_ph), (0,0,0,0))
            dd = ImageDraw.Draw(dmg)
            
            # 弹幕颜色: 随机 or 固定
            if danmaku_random_color:
                _dmkc = _random.choice(_danmaku_colors)
            else:
                _dmkc = danmaku_color
            
            # 渲染带描边的文字（无背景,弹幕是纯文字浮在画面上）
            _render_text_emoji(dd, (8, 4), dtext, _dmk_font, _dmkc, dsw, dsc)
            
            # 透明度调整: 对整个 PNG 应用 alpha
            if danmaku_opacity < 0.99:
                _ra = dmg.split()[-1].point(lambda x: int(x * danmaku_opacity))
                dmg.putalpha(_ra)
            
            _dmk_png = _tmp.mktemp(suffix=f'_dmk{idx}.png')
            dmg.save(_dmk_png)
            
            # 分配行号
            if danmaku_random_y:
                _row = _random.randint(0, danmaku_rows - 1)
            else:
                _row = _dmk_y_offset_pool[_dmk_row_counter % len(_dmk_y_offset_pool)]
                _dmk_row_counter += 1
            
            _dy = _danmaku_top_margin + _row * _danmaku_row_h
            _ddur = max(0.1, det - dst)
            
            # 弹幕速度: 从右边缘外 (+vw 位置) 到左边缘外 (-文字宽度位置)
            # x = W - (t - dst) * speed  其中 speed = (vw + _dmk_tw + 50) / _ddur
            _travel_dist = vw + _dmk_tw + 50  # 总行程(从右侧外到左侧外)
            _spd = _travel_dist / _ddur if _ddur > 0 else danmaku_speed
            
            _dmk_inp = _fm.input(_dmk_png)
            current_v = current_v.overlay(
                _dmk_inp,
                x=f"(W) - (t-{dst})*{_spd} - 0",
                y=f"{_dy}",
                enable=f"between(t,{dst},{det})",
                format='auto',
                shortest=1
            )
            _dmk_pngs_to_clean.append(_dmk_png)

    # 音频处理: 各段 TTS 按 start 对齐 + 原音
    for ap, offset in tts_segments:
        seg_input = _fm.input(ap).audio
        # adelay 延迟到对应时间点
        delayed = seg_input.filter('adelay', f"{int(offset*1000)}|{int(offset*1000)}")
        audio_streams.append(delayed)

    if len(audio_streams) > 1:
        aud = _fm.filter(audio_streams, 'amix', inputs=len(audio_streams), duration='longest',
                        dropout_transition=2, normalize=False)
    elif len(audio_streams) == 1:
        aud = audio_streams[0]
    else:
        aud = None

    # ── 兼容性编码参数: 支持高分辨率 + 非标准比例 ──
    output_args = {
        'c:v': 'libx264', 'preset': 'fast', 'crf': 23,
        'pix_fmt': 'yuv420p',               # 保证全平台兼容
        'max_muxing_queue_size': 2048,       # 防止大分辨率卡住
        'vsync': 'cfr',                       # 固定帧率
    }
    # 高分辨率(超过1080p)用 high profile + level 4.1+
    if _high_res:
        output_args['profile:v'] = 'high'
        if max(_target_w, _target_h) > 1920:
            output_args['level'] = '4.2'
        if max(_target_w, _target_h) > 2560:
            output_args['level'] = '5.0'
        if max(_target_w, _target_h) > 3840:
            output_args['level'] = '5.2'
    else:
        output_args['profile:v'] = 'main'
        output_args['level'] = '4.0'
    
    if aud is not None:
        output_args['c:a'] = 'aac'
        out = _fm.output(current_v, aud, output_path, **output_args)
    else:
        out = _fm.output(current_v, output_path, **output_args)

    out = out.overwrite_output()
    out.run(capture_stderr=True, quiet=True)

    # Step 4: 清理 + 自动复制到 shared 目录 + 返回 URL
    for png,_,_,_,_ in subtitle_overlays:
        try: os.unlink(png)
        except Exception: pass
    for _dp in _dmk_pngs_to_clean:
        try: os.unlink(_dp)
        except Exception: pass
    for ap,_ in tts_segments:
        try: os.unlink(ap)
        except Exception: pass

    fn = 'push_' + hashlib.md5(output_path.encode()).hexdigest()[:8] + '.mp4'
    dest_dir = os.path.join(_project_root, 'uploads', 'shared')
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, fn)
    try:
        shutil.copy2(output_path, dest)
        os.chmod(dest, 0o644)
        url = f"https://naujtrats.xyz/oneapichat/uploads/shared/{fn}"
    except Exception:
        url = output_path

    return f"✅ 视频已生成并发布: {url}\n(字幕{len(subtitle_overlays)}条 + {len(tts_segments)}段配音, 原音保留{bg_volume*100:.0f}%)"

def _apply_ffmpeg_filter(input_path, output_path, params):
    """FFmpeg 高性能滤镜: hue, eq, boxblur, vignette, unsharp, colorbalance, drawtext"""
    ftype = params.get("type", "none")
    filters = {
        "hue": f"hue=s={params.get('saturation',1.2)}",
        "eq": f"eq=brightness={float(params.get('brightness',0)):.2f}:contrast={float(params.get('contrast',1)):.2f}",
        "boxblur": f"boxblur={params.get('radius',5)}",
        "vignette": "vignette=PI/4",
        "unsharp": "unsharp=5:5:1.0",
        "colorbalance": f"colorbalance=rs={float(params.get('r',0)):.2f}:gs={float(params.get('g',0)):.2f}:bs={float(params.get('b',0)):.2f}",
        "sepia": "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
        "vintage": "curves=vintage",
        "grain": "noise=alls=20:allf=t+u",
        "bw": "colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3",
    }
    vf = filters.get(ftype)
    if not vf: return f"未知滤镜: {ftype}, 支持: " + ", ".join(filters.keys())
    cmd = ["ffmpeg", "-y", "-i", input_path, "-vf", vf, "-c:v", "libx264", "-c:a", "aac", output_path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0: return f"滤镜失败: {r.stderr[-300:]}"
    return f"滤镜完成 ({ftype}): {output_path}"


def _apply_ffmpeg_transition(input_path, output_path, params):
    """FFmpeg xfade 高性能转场: fade, wipeleft, slideright, dissolve, pixelize, circlecrop, radial, squeeze"""
    files = params.get("files", [])
    if not files: return "错误: transition 需要 params.files[0] 为第二个视频路径"
    ttype = params.get("type", "fade")
    duration = float(params.get("duration", 1))
    offset = float(params.get("offset", 2)) - duration
    extra = params.get("extra", "")
    # 先取两个视频的时长
    import json as _json
    r1 = subprocess.run(["ffprobe","-v","quiet","-print_format","json","-show_format",input_path], capture_output=True, text=True, timeout=10)
    r2 = subprocess.run(["ffprobe","-v","quiet","-print_format","json","-show_format",files[0]], capture_output=True, text=True, timeout=10)
    d1 = float(_json.loads(r1.stdout).get("format",{}).get("duration",0))
    d2 = float(_json.loads(r2.stdout).get("format",{}).get("duration",0))
    offset = min(offset, d1 - duration)
    if offset < 0: offset = max(0, d1 - duration)
    cmd = [
        "ffmpeg","-y",
        "-i", input_path,
        "-i", files[0],
        "-filter_complex",
        f"[0:v][1:v]xfade=transition={ttype}:duration={duration}:offset={offset}{extra}[v];"
        f"[0:a][1:a]acrossfade=d={duration}[a]",
        "-map","[v]","-map","[a]",
        "-c:v","libx264","-c:a","aac",
        output_path
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if r.returncode != 0: return f"转场失败: {r.stderr[-300:]}"
    return f"转场完成 ({ttype}): {output_path}"
