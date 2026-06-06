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


def _apply_subtitle(input_path, output_path, params):
    """
    应用字幕到视频。支持两种模式:
    1. timeline 模式(推荐): 精确时间轴字幕, 用 ffmpeg subtitles 滤镜烧录
       params: { timeline: [{start:0, end:2.5, text:"你好"}, ...], fontsize, color, bg, ... }
    2. 降级模式(Pillow渲染): 仅有 text 时, 覆盖整段视频
       params: { text: "你好世界", fontsize, color, bg, ... }
    """
    # ★ 路径转换
    if input_path.startswith("/oneapichat/"):
        input_path = os.path.join(_project_root, input_path.replace("/oneapichat/", "", 1))

    fs = int(params.get("fontsize", 42))
    tc = params.get("color", "white")
    ft = params.get("font", "noto-sans-bold")
    bg_enabled = params.get("bg", True)
    bg_opacity = float(params.get("bg_opacity", 0.6))
    bg_color = params.get("bg_color", "black").strip()
    stroke_color = params.get("stroke_color", "black")
    stroke_width = int(params.get("stroke_width", 2))
    y_pos = params.get("y", "bottom")  # bottom | top | middle | 像素值
    timeline = params.get("timeline", None)

    is_timeline = timeline and isinstance(timeline, list) and len(timeline) > 0

    if is_timeline:
        # ── 精确时间轴模式: SRT + ffmpeg subtitles 滤镜 ──
        srt_path = tempfile.mktemp(suffix='.srt')
        _videogenerate_srt(timeline, srt_path)

        # 构建 force_style 字符串
        font_name = "Noto Sans CJK SC"  # ffmpeg libass 识别的字体名
        styles = [
            f"FontName={font_name}",
            f"FontSize={fs}",
            f"PrimaryColour=&H{color_to_ass(tc)}",
            f"OutlineColour=&H{color_to_ass(stroke_color)}",
            f"Outline={stroke_width}",
            f"BorderStyle=1",  # 1=outline+shadow, 3=opaque box
            f"Alignment={ypos_to_alignment(y_pos)}",
            f"MarginV=30",
        ]
        if bg_enabled:
            styles.append("BorderStyle=3")  # 不透明背景框
            styles.append(f"BackColour=&H{color_to_ass(bg_color)}")
        force_style = ",".join(styles)

        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-vf", f"subtitles={srt_path}:force_style='{force_style}'",
            "-c:v", "libx264", "-preset", "fast",
            "-c:a", "aac",
            output_path
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        try: os.unlink(srt_path)
        except Exception: pass

        if r.returncode != 0:
            err = r.stderr[-500:] if r.stderr else "unknown"
            return f"字幕烧录失败: {err}"
        return f"字幕完成 (timeline {len(timeline)}条): {output_path} (字体:{ft}, 大小:{fs})"

    # ── 降级模式: 单字幕 full-duration Pillow 渲染 ──
    txt = params.get("text", "Hello")
    font_path = SUBTITLE_FONTS.get(ft, DEFAULT_FONT)

    from moviepy import VideoFileClip, CompositeVideoClip, ImageClip
    from PIL import Image, ImageDraw, ImageFont
    clip = VideoFileClip(input_path)

    try:
        pil_font = ImageFont.truetype(font_path, fs)
    except Exception:
        pil_font = ImageFont.truetype(DEFAULT_FONT, fs)

    lines = txt.split('\n')
    line_imgs = []
    max_w = 0; total_h = 0
    for line in lines:
        line = line.strip()
        if not line: line = ' '
        bbox = pil_font.getbbox(line)
        lw = bbox[2] - bbox[0]
        lh = bbox[3] - bbox[1]
        lh += int(fs * 0.25)
        img = Image.new('RGBA', (lw + 30, lh + 10), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        draw.text((15, 5), line, font=pil_font, fill=tc,
                  stroke_width=stroke_width, stroke_fill=stroke_color)
        line_imgs.append(img)
        max_w = max(max_w, lw + 30)
        total_h += lh + 10

    final_img = Image.new('RGBA', (max_w + 50, total_h + 12), (0, 0, 0, 0))
    cy = 6
    for img in line_imgs:
        final_img.paste(img, (25, cy), img)
        cy += img.height

    sub_path = tempfile.mktemp(suffix='.png')
    final_img.save(sub_path)

    sub_clip = ImageClip(sub_path).with_duration(clip.duration)
    # Y 位置解析
    if isinstance(y_pos, str):
        y_px = clip.h - 80 - final_img.height  # bottom
    else:
        y_px = clip.h - int(y_pos) - final_img.height
    sub_clip = sub_clip.with_position(("center", y_px))

    layers = [clip, sub_clip]
    if bg_enabled:
        from moviepy import ColorClip
        bg_h = final_img.height + 24
        try:
            bg = ColorClip(size=(clip.w, bg_h), color=str_to_rgb(bg_color)).with_opacity(bg_opacity).with_position((0, clip.h - bg_h)).with_duration(clip.duration)
        except Exception:
            bg = ColorClip(size=(clip.w, bg_h), color=(0, 0, 0)).with_opacity(bg_opacity).with_position((0, clip.h - bg_h)).with_duration(clip.duration)
        layers.insert(1, bg)

    final = CompositeVideoClip(layers)
    final.write_videofile(output_path, codec="libx264", audio_codec="aac")
    clip.close(); sub_clip.close(); final.close()
    try: os.unlink(sub_path)
    except Exception: pass
    # 自动复制到 shared
    try:
        import shutil
        fn = 'push_' + __import__('hashlib').md5(output_path.encode()).hexdigest()[:8] + '.mp4'
        dest_dir = os.path.join(_project_root, 'uploads', 'shared')
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, fn)
        shutil.copy2(output_path, dest)
        os.chmod(dest, 0o644)
        url = f"https://naujtrats.xyz/oneapichat/uploads/shared/{fn}"
        return f"字幕完成: {url} (字体:{ft}, 大小:{fs})"
    except Exception:
        return f"字幕完成: {output_path} (字体:{ft}, 大小:{fs})"



def _apply_filter(input_path, output_path, params):
    """视频滤镜特效"""
    ftype = params.get("type", "bw")
    from moviepy import VideoFileClip, vfx
    clip = VideoFileClip(input_path)
    filters_map = {
        "bw": vfx.BlackAndWhite,
        "invert": vfx.InvertColors,
        "brightness": lambda: vfx.LumContrast(lum=int(params.get("brightness",30)), contrast=int(params.get("contrast",0))),
        "fade_in": lambda: vfx.FadeIn(int(params.get("duration",1))),
        "fade_out": lambda: vfx.FadeOut(int(params.get("duration",1))),
        "mirror_x": vfx.MirrorX,
        "mirror_y": vfx.MirrorY,
        "painting": lambda: vfx.Painting(saturation=float(params.get("saturation",1.3))),
        "gamma": lambda: vfx.GammaCorrection(gamma=float(params.get("gamma",1.2))),
        "slide_in": lambda: vfx.SlideIn(int(params.get("side",1)), int(params.get("duration",1))),
        "slide_out": lambda: vfx.SlideOut(int(params.get("side",1)), int(params.get("duration",1))),
        "freeze": lambda: vfx.Freeze(t=float(params.get("time",0)), d=int(params.get("duration",2))),
        "blur": lambda: vfx.HeadBlur(r_blur=int(params.get("radius",10))),
    }
    f = filters_map.get(ftype, lambda: vfx.BlackAndWhite())()
    clip = clip.with_effects([f])
    clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
    clip.close()
    return f"滤镜完成 ({ftype}): {output_path}"



def _apply_transition(input_path, output_path, params):
    """视频转场效果"""
    files = params.get("files", [])
    if not files or len(files) < 1:
        return "错误: transition 需要 params.files[0] 为第二个视频路径"
    ttype = params.get("type", "crossfade")
    duration = int(params.get("duration", 1))
    from moviepy import VideoFileClip, CompositeVideoClip, vfx
    clip1 = VideoFileClip(input_path)
    clip2 = VideoFileClip(files[0])
    if clip1.duration < duration or clip2.duration < duration:
        clip1.close(); clip2.close()
        return f"错误: 视频太短 (需 >= {duration}s)"
    if ttype == "crossfade":
        clip1e = clip1.subclipped(0, clip1.duration - duration/2).with_effects([vfx.CrossFadeOut(duration/2)])
        clip2e = clip2.subclipped(duration/2).with_effects([vfx.CrossFadeIn(duration/2)])
    elif ttype == "fade":
        clip1e = clip1.subclipped(0, clip1.duration - duration).with_effects([vfx.FadeOut(duration)])
        clip2e = clip2.subclipped(duration).with_effects([vfx.FadeIn(duration)])
    elif ttype == "slide_left":
        clip1e = clip1.subclipped(0, clip1.duration - duration).with_effects([vfx.SlideOut(1, duration)])
        clip2e = clip2.subclipped(duration).with_effects([vfx.SlideIn(3, duration)])
    elif ttype == "slide_right":
        clip1e = clip1.subclipped(0, clip1.duration - duration).with_effects([vfx.SlideOut(3, duration)])
        clip2e = clip2.subclipped(duration).with_effects([vfx.SlideIn(1, duration)])
    elif ttype == "wipe":
        clip1e = clip1.subclipped(0, clip1.duration - duration).with_effects([vfx.FadeOut(duration)])
        clip2e = clip2
    else:
        clip1e = clip1; clip2e = clip2
    final = CompositeVideoClip([clip1e, clip2e.with_start(clip1e.duration)])
    final.write_videofile(output_path, codec="libx264", audio_codec="aac")
    clip1.close(); clip2.close()
    return f"转场完成 ({ttype}): {output_path}"



def _apply_tts(params):
    """多提供商 TTS 语音合成"""
    text = params.get("text", "")
    if not text: return "错误: 缺少 text 参数"
    provider = params.get("provider", "minimax")
    tts_key = params.get("api_key", "")
    tts_url = params.get("api_url", "")
    voice_id = params.get("voice_id", "male-qn-qingse")
    speed = float(params.get("speed", 1.0))
    volume = float(params.get("volume", 1.0))
    pitch = int(params.get("pitch", 0))
    model = params.get("model", "speech-2.8-hd")
    output_path = params.get("output_path", "/tmp/tts_output.mp3")
    if not tts_key:
        # ★ api_key 为空: 让 mmx CLI 使用自己配置文件中的凭证(不传 --api-key)
        tts_key = None
    
    if provider == "openai":
        url = tts_url or "https://api.openai.com/v1/audio/speech"
        body = {"model": "tts-1", "voice": voice_id or "alloy", "input": text, "speed": speed}
        try:
            resp = _http_session.post(url, headers={"Authorization":f"Bearer {tts_key}","Content-Type":"application/json"}, json=body, timeout=60)
            if resp.status_code == 200:
                with open(output_path, "wb") as f: f.write(resp.content)
                return f"语音合成完成 (OpenAI): {output_path} ({len(resp.content)} bytes)"
            return f"TTS 失败 (OpenAI): {resp.status_code} {resp.text[:200]}"
        except Exception as e: return f"TTS 异常 (OpenAI): {str(e)}"
    
    # Minimax — 通过 mmx-cli 调用 Token Plan TTS
    output_path = params.get("output_path", "/tmp/tts_output.mp3")
    # ★ mmx 绝对路径(引擎进程 PATH 可能不包含 npm global bin)
    mmx_bin = "/home/naujtrats/.npm-global/bin/mmx"
    if not os.path.exists(mmx_bin):
        mmx_bin = "mmx"  # fallback
    try:
        cmd = [mmx_bin, "--region", "cn", "speech", "synthesize", "--text", text, "--voice", voice_id, "--output", output_path]
        # 只有 params 显式传了 api_key 时才用, 否则让 mmx 读自己的配置文件
        if tts_key:
            cmd = [mmx_bin, "--api-key", tts_key, "--region", "cn", "speech", "synthesize", "--text", text, "--voice", voice_id, "--output", output_path]
        if speed != 1.0: cmd += ["--speed", str(speed)]
        if volume != 1.0: cmd += ["--vol", str(volume)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120, cwd=_project_root)
        if r.returncode == 0:
            mp3_files = glob.glob(os.path.join(_project_root, "speech_*.mp3"))
            if mp3_files:
                newest = max(mp3_files, key=os.path.getmtime)
                os.rename(newest, output_path)
            return f"语音合成完成 (mmx): {output_path} (音色:{voice_id})"
        else:
            err = (r.stderr or r.stdout)[:300]
            return f"TTS 失败 (mmx): {err}"
    except Exception as e:
        return f"TTS 异常 (mmx): {str(e)}"



def _apply_voice_to_video(video_path, audio_path, output_path, params):
    """将音频混入视频(FFmpeg),保持原视频速度不变"""
    volume = float(params.get("volume", 1.0))
    mix = params.get("mix", "replace")
    import json as _json
    va = subprocess.run(["ffprobe","-v","quiet","-print_format","json","-show_format",video_path], capture_output=True, text=True, timeout=10)
    aa = subprocess.run(["ffprobe","-v","quiet","-print_format","json","-show_format",audio_path], capture_output=True, text=True, timeout=10)
    vd = float(_json.loads(va.stdout).get("format",{}).get("duration",0))
    ad = float(_json.loads(aa.stdout).get("format",{}).get("duration",0))
    if mix == "replace":
        if ad > vd:
            # 配音比视频长: 循环视频以匹配配音时长 (保持原速不变)
            cmd = ["ffmpeg","-y","-stream_loop","-1","-i",video_path,"-i",audio_path,
                   "-c:v","libx264","-c:a","aac","-shortest","-map","0:v:0","-map","1:a:0",output_path]
        else:
            # 视频比配音长: 截断视频到配音结束
            cmd = ["ffmpeg","-y","-i",video_path,"-i",audio_path,
                   "-c:v","copy","-map","0:v:0","-map","1:a:0","-shortest",output_path]
    else:
        cmd = ["ffmpeg","-y","-i",video_path,"-i",audio_path,"-filter_complex",
               f"[1:a]volume={volume}[a1];[0:a][a1]amix=inputs=2:duration=first:dropout_transition=2",
               "-c:v","copy","-shortest",output_path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        return f"配音失败: {r.stderr[-300:]}"
    try:
        import shutil
        fn = 'push_' + __import__('hashlib').md5(output_path.encode()).hexdigest()[:8] + os.path.splitext(output_path)[1]
        dest_dir = os.path.join(_project_root, 'uploads', 'shared')
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, fn)
        shutil.copy2(output_path, dest)
        os.chmod(dest, 0o644)
        url = f"https://naujtrats.xyz/oneapichat/uploads/shared/{fn}"
        return f"配音完成: {url} (视频{vd:.1f}s, 配音{ad:.1f}s)"
    except Exception:
        return f"配音完成: {output_path} (视频{vd:.1f}s, 配音{ad:.1f}s)"



def _apply_crop(input_path, output_path, params):
    """画面裁剪 - 指定区域或比例"""
    x = int(params.get("x", 0))
    y = int(params.get("y", 0))
    w = params.get("w", params.get("width", 0))
    h = params.get("h", params.get("height", 0))
    ratio = params.get("ratio", "")  # "16:9", "1:1", "9:16"
    probe = json.loads(subprocess.run(["ffprobe","-v","quiet","-print_format","json","-show_streams",input_path],
                        capture_output=True, text=True).stdout)
    vw = int(probe['streams'][0]['width'])
    vh = int(probe['streams'][0]['height'])
    if ratio:
        rw, rh = map(int, ratio.split(":"))
        target_ratio = rw / rh
        current_ratio = vw / vh
        if current_ratio > target_ratio:
            new_w = int(vh * target_ratio)
            x = (vw - new_w) // 2
            w = new_w; h = vh
        else:
            new_h = int(vw / target_ratio)
            y = (vh - new_h) // 2
            w = vw; h = new_h
    if not w or not h:
        return "错误: 需要 width/height 或 ratio 参数"
    cmd = ["ffmpeg","-y","-i",input_path,"-vf",f"crop={w}:{h}:{x}:{y}",
           "-c:v","libx264","-preset","fast","-c:a","aac",output_path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        return f"裁剪失败: {r.stderr[-300:]}"
    return f"裁剪完成 ({w}x{h}): {output_path}"



def _apply_reverse(input_path, output_path, params):
    """视频倒放"""
    cmd = ["ffmpeg","-y","-i",input_path,"-vf","reverse","-af","areverse",
           "-c:v","libx264","-preset","fast","-c:a","aac",output_path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        return f"倒放失败: {r.stderr[-300:]}"
    return f"倒放完成: {output_path}"



def _apply_mute(input_path, output_path, params):
    """去除音频（静音）"""
    cmd = ["ffmpeg","-y","-i",input_path,"-an","-c:v","libx264","-preset","fast",output_path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        return f"静音失败: {r.stderr[-300:]}"
    return f"静音完成: {output_path}"



def _apply_bgm(input_path, output_path, params):
    """添加背景音乐"""
    bgm_path = params.get("bgm_path", "")
    volume = float(params.get("volume", 0.3))
    orig_volume = float(params.get("orig_volume", 1.0))
    fade_out = float(params.get("fade_out", 2))
    if not bgm_path or not os.path.exists(bgm_path):
        return f"错误: BGM 文件不存在: {bgm_path}"
    probe = json.loads(subprocess.run(["ffprobe","-v","quiet","-print_format","json","-show_format",input_path],
                        capture_output=True, text=True).stdout)
    video_dur = float(probe['format']['duration'])
    filter_line = f"[1:a]aloop=loop=-1:size=2e9,atrim=0:{video_dur}[bgm]"
    if fade_out > 0:
        filter_line += f";[bgm]afade=t=out:st={video_dur-fade_out}:d={fade_out}[bgmf]"
        bgm_lbl = "[bgmf]"
    else:
        bgm_lbl = "[bgm]"
    full = filter_line + f";[0:a]volume={orig_volume}[orig];[orig]{bgm_lbl}amix=inputs=2:duration=first:weights=1 {volume}"
    cmd = ["ffmpeg","-y","-i",input_path,"-i",bgm_path,"-filter_complex",full,
           "-c:v","libx264","-preset","fast","-c:a","aac",output_path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        return f"BGM添加失败: {r.stderr[-300:]}"
    return f"BGM添加完成 (音量{volume}): {output_path}"



def _apply_enhance(input_path, output_path, params):
    """自动增强 - 亮度/对比度/饱和度/锐化 + 预设"""
    brightness = float(params.get("brightness", 0))
    contrast = float(params.get("contrast", 1.0))
    saturation = float(params.get("saturation", 1.0))
    sharpen = float(params.get("sharpen", 0))
    preset = params.get("preset", "")
    if preset:
        presets = {
            "vivid": {"contrast": 1.2, "saturation": 1.3, "sharpen": 1.0},
            "cinematic": {"contrast": 1.15, "saturation": 1.1, "sharpen": 0.5},
            "warm": {"saturation": 1.2, "brightness": 0.05},
            "cool": {"saturation": 1.1, "brightness": -0.03},
            "hdr": {"contrast": 1.3, "saturation": 1.4, "sharpen": 2.0},
        }
        p = presets.get(preset, {})
        brightness = p.get("brightness", brightness)
        contrast = p.get("contrast", contrast)
        saturation = p.get("saturation", saturation)
        sharpen = p.get("sharpen", sharpen)
    filters = []
    if brightness != 0 or contrast != 1.0 or saturation != 1.0:
        filters.append(f"eq=brightness={brightness}:contrast={contrast}:saturation={saturation}")
    if sharpen > 0:
        filters.append(f"unsharp=5:5:{sharpen}:5:5:0")
    if not filters:
        return "错误: 无增强参数"
    vf = ",".join(filters)
    cmd = ["ffmpeg","-y","-i",input_path,"-vf",vf,"-c:v","libx264","-preset","fast","-c:a","aac",output_path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        return f"增强失败: {r.stderr[-300:]}"
    return f"增强完成 ({preset or '自定义'}): {output_path}"



def _apply_gif(input_path, output_path, params):
    """视频转 GIF"""
    start = float(params.get("start", 0))
    duration = float(params.get("duration", 5))
    fps = int(params.get("fps", 10))
    width = int(params.get("width", 480))
    cmd = ["ffmpeg","-y","-ss",str(start),"-t",str(duration),"-i",input_path,
           "-vf",f"fps={fps},scale={width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
           "-loop","0",output_path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        return f"GIF失败: {r.stderr[-300:]}"
    try:
        fn = 'gif_' + hashlib.md5(output_path.encode()).hexdigest()[:8] + '.gif'
        dest_dir = os.path.join(_project_root, 'uploads', 'shared')
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, fn)
        shutil.copy2(output_path, dest)
        os.chmod(dest, 0o644)
        return f"GIF完成: https://naujtrats.xyz/oneapichat/uploads/shared/{fn}"
    except Exception:
        return f"GIF完成: {output_path}"



def _apply_silent_cut(input_path, output_path, params):
    """智能切除静音片段"""
    threshold = params.get("threshold", "-30dB")
    min_silence = float(params.get("min_silence", 1.0))
    cmd = ["ffmpeg","-y","-i",input_path,
           "-af",f"silenceremove=stop_periods=-1:stop_duration={min_silence}:stop_threshold={threshold}",
           "-c:v","libx264","-preset","fast","-c:a","aac",output_path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        return f"静音切除失败: {r.stderr[-300:]}"
    return f"静音切除完成: {output_path}"



def _apply_subtitle_style(input_path, output_path, params):
    """
    字幕风格预设 — bilibili/variety/minimal/bold/neon/typewriter
    内部调用 compose 实现
    """
    timeline = params.get("timeline", [])
    style = params.get("style", "bilibili")
    styles = {
        "bilibili": {"fontsize":36,"color":"white","bg":True,"bg_color":"#fb7299","bg_opacity":0.75,"bg_radius":14,"stroke_width":0,"font":"noto-sans-bold"},
        "variety": {"fontsize":42,"color":"#ffe066","bg":True,"bg_color":"#000000","bg_opacity":0.65,"bg_radius":8,"stroke_width":2,"stroke_color":"#f59e0b","font":"noto-sans-bold"},
        "minimal": {"fontsize":32,"color":"white","bg":False,"stroke_width":1,"stroke_color":"#00000080","font":"noto-sans-regular"},
        "bold": {"fontsize":48,"color":"#ff4444","bg":True,"bg_color":"#000000","bg_opacity":0.8,"bg_radius":6,"stroke_width":3,"stroke_color":"black","font":"noto-sans-bold"},
        "neon": {"fontsize":38,"color":"#00ff88","bg":True,"bg_color":"#0a0a1a","bg_opacity":0.7,"bg_radius":20,"stroke_width":2,"stroke_color":"#00cc66","font":"noto-sans-bold"},
        "typewriter": {"fontsize":28,"color":"#cccccc","bg":True,"bg_color":"#1a1a1a","bg_opacity":0.85,"bg_radius":4,"stroke_width":0,"font":"noto-sans-regular"},
    }
    s = styles.get(style, styles["bilibili"])
    for k in ["fontsize","color","bg","bg_color","bg_opacity","bg_radius","stroke_width","stroke_color","font"]:
        if k in params:
            s[k] = params[k]
    compose_params = dict(params)
    compose_params.update(s)
    return _apply_compose(input_path, output_path, compose_params)


def _apply_stt(input_path, output_path, params):
    """
    语音转文字 (Speech-to-Text)
    调用 OpenAI Whisper API 或 MiniMax STT 将音频/视频转换为文字

    参数:
        input_path: 输入音频/视频文件路径
        output_path: 输出 SRT 字幕文件路径（如提供）
        params:
            engine: "whisper" | "minimax" (默认: minimax)
            api_key: API key（如不提供则从 config 读取）
            language: 音频语言 (默认: zh)
            response_format: "srt" | "vtt" | "text" | "json" (默认: srt)
            prompt: Whisper 提示词（可选）
    """
    engine = params.get("engine", "minimax")
    api_key = params.get("api_key", "")
    language = params.get("language", "zh")
    response_format = params.get("response_format", "srt")
    prompt = params.get("prompt", "")

    # 读取 API key
    if not api_key:
        try:
            import json as _json
            config_path = os.path.join(os.path.dirname(__file__), "..", "config", ".mmx_config.json")
            if os.path.exists(config_path):
                with open(config_path) as f:
                    cfg = _json.load(f)
                api_key = cfg.get("api_key", "") or cfg.get("mmx_api_key", "") or cfg.get("openai_api_key", "")
        except Exception:
            pass

    if not api_key:
        return "❌ STT 失败: 未配置 API key"

    if engine == "whisper":
        # OpenAI Whisper API
        import requests as _req
        url = "https://api.openai.com/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {api_key}"}
        try:
            with open(input_path, "rb") as f:
                files = {"file": (os.path.basename(input_path), f)}
                data = {"model": "whisper-1", "language": language,
                        "response_format": response_format}
                if prompt:
                    data["prompt"] = prompt
                resp = _req.post(url, headers=headers, files=files, data=data, timeout=120)
                if resp.status_code == 200:
                    result = resp.text
                    if output_path:
                        with open(output_path, "w", encoding="utf-8") as of:
                            of.write(result)
                        return f"STT 完成(srt): {output_path}"
                    return result
                else:
                    return f"❌ Whisper API 错误: {resp.status_code} {resp.text[:200]}"
        except Exception as e:
            return f"❌ STT 失败: {str(e)}"

    elif engine == "minimax":
        # MiniMax STT — 使用 ffmpeg 提取音频后调用 mmx-cli
        import tempfile as _tmp
        audio_file = input_path
        is_video = input_path.lower().endswith(('.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.wmv'))
        tmp_audio = None
        if is_video:
            # 提取音频为 wav
            tmp_audio = _tmp.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_audio.close()
            extract_cmd = ["ffmpeg", "-y", "-i", input_path, "-vn", "-acodec", "pcm_s16le",
                          "-ar", "16000", "-ac", "1", tmp_audio.name]
            r = subprocess.run(extract_cmd, capture_output=True, text=True, timeout=60)
            if r.returncode != 0:
                if tmp_audio and os.path.exists(tmp_audio.name):
                    os.unlink(tmp_audio.name)
                return f"❌ 音频提取失败: {r.stderr[-200:]}"
            audio_file = tmp_audio.name

        try:
            # 使用 mmx-cli 进行 STT
            mmx_bin = os.path.expanduser("~/.npm-global/bin/mmx")
            if not os.path.exists(mmx_bin):
                mmx_bin = "mmx-cli"

            lang_map = {"zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean"}
            lang_name = lang_map.get(language, "Chinese")

            cmd = [mmx_bin, "stt", audio_file, "--language", lang_name,
                   "--format", response_format, "--api-key", api_key]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if r.returncode == 0 and r.stdout.strip():
                result = r.stdout.strip()
                if output_path:
                    with open(output_path, "w", encoding="utf-8") as of:
                        of.write(result)
                    return f"STT 完成: {output_path}"
                return result
            else:
                err = r.stderr or r.stdout or "未知错误"
                return f"❌ MiniMax STT 失败: {err[:300]}"
        finally:
            if tmp_audio and os.path.exists(tmp_audio.name):
                try:
                    os.unlink(tmp_audio.name)
                except Exception:
                    pass

    else:
        return f"❌ 不支持的 STT 引擎: {engine}（可选: whisper, minimax）"


def _apply_stt_to_timeline(input_path, output_path, params):
    """
    STT → 自动生成时间轴字幕
    先做语音识别，再将识别结果转换为时间轴格式供 compose 使用
    """
    style = params.get("style", "bilibili")
    engine = params.get("stt_engine", "minimax")
    language = params.get("language", "zh")

    # 提取视频帧率信息
    fps = 30.0
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                           "-show_entries", "stream=r_frame_rate",
                           "-of", "csv=p=0", input_path],
                          capture_output=True, text=True, timeout=10)
        if r.stdout.strip():
            parts = r.stdout.strip().split("/")
            if len(parts) == 2:
                fps = float(parts[0]) / float(parts[1])
            else:
                fps = float(parts[0])
    except Exception:
        pass

    # 获取视频时长
    duration = 0
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                           "-of", "csv=p=0", input_path],
                          capture_output=True, text=True, timeout=10)
        if r.stdout.strip():
            duration = float(r.stdout.strip())
    except Exception:
        pass

    # 调用 STT 获取 SRT
    stt_params = dict(params)
    stt_params["engine"] = engine
    stt_params["language"] = language
    stt_params["response_format"] = "srt"
    srt_result = _apply_stt(input_path, None, stt_params)

    if srt_result.startswith("❌"):
        return srt_result

    # 解析 SRT → timeline
    timeline = []
    try:
        import re as _re
        blocks = srt_result.strip().split("\n\n")
        for block in blocks:
            lines = block.strip().split("\n")
            if len(lines) < 3:
                continue
            # 格式: index, time, text...
            time_line = lines[1] if len(lines) > 1 else ""
            text = " ".join(lines[2:]) if len(lines) > 2 else ""
            time_match = _re.match(r"(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)", time_line)
            if time_match:
                h1, m1, s1, ms1 = [int(x) for x in time_match.groups()[:4]]
                h2, m2, s2, ms2 = [int(x) for x in time_match.groups()[4:]]
                start_sec = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000.0
                end_sec = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000.0
                # 转换为帧
                start_frame = max(0, int(start_sec * fps))
                end_frame = max(start_frame + 1, int(end_sec * fps))
                if text.strip():
                    timeline.append({
                        "start_frame": start_frame,
                        "end_frame": end_frame,
                        "text": text.strip(),
                        "start_sec": round(start_sec, 3),
                        "end_sec": round(end_sec, 3)
                    })
    except Exception as e:
        return f"❌ SRT 解析失败: {str(e)}"

    if not timeline:
        return "❌ 未从 STT 结果中提取到字幕"

    # 使用 compose 合成
    compose_params = dict(params)
    compose_params["timeline"] = timeline
    compose_params["style"] = style
    return _apply_compose(input_path, output_path, compose_params)
