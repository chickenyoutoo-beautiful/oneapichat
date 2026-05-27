#!/usr/bin/env python3
"""
OneAPIChat 后台引擎 - 心跳 / Cron / 子代理
"""
import asyncio
import json
import os
import sys
import time
import threading
import subprocess
import requests
import re
from datetime import datetime, timedelta
from pathlib import Path
import sqlite3
import tempfile
import glob

# Cross-platform: fcntl is Unix-only
try:
    import fcntl
    HAS_FCNTL = True
except ImportError:
    HAS_FCNTL = False

# ── Project root detection ────────────────────────────
PROJECT_ROOT = str(Path(__file__).parent.resolve())
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, os.path.join(tempfile.gettempdir(), 'pylib'))

try:
    from fastapi import FastAPI, Query, HTTPException, Request
    from fastapi.responses import StreamingResponse, JSONResponse
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except:
    print("[引擎] 需要安装 fastapi/uvicorn: pip install fastapi uvicorn --break-system-packages")
    sys.exit(1)

# ── 引擎层模块 ────────────────────────────────────────────
from engine.exec_policy import ExecPolicy, ExecDecision, Priority
from engine.speculation import SpeculationEngine, SpeculationState
from engine.retry import RetryEngine, RetryStatus
from engine.tool_registry import ToolRegistry, ToolDef, Capability, ApprovalKind, get_global_registry
from engine.event_frame import EventFlowBuilder, EventType, EventLog


app = FastAPI(title="OneAPIChat Engine")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

ENGINE_DIR = Path(PROJECT_ROOT) / ".engine"
ENGINE_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR = Path(tempfile.gettempdir())

# ── 引擎层全局实例 ──────────────────────────────────────────
exec_policy = ExecPolicy(rules_file=str(ENGINE_DIR / "exec_policy.json"))
speculation_engine = SpeculationEngine()
retry_engine = RetryEngine(max_attempts=3, backoff_base_ms=500)
tool_registry = get_global_registry()
event_log = EventLog()

if exec_policy._rules_file and not exec_policy._rules_file.exists():
    exec_policy.save()

# ==================== 存储 ====================
class EngineStore:
    """JSON文件存储(带文件锁防止并发写入冲突)"""
    def __init__(self, path, user_id=""):
        self.path = Path(path)
        if user_id:
            self.path = self.path.parent / f"user_{user_id}_{self.path.name}"
        if not self.path.exists():
            self.path.write_text('{}', encoding='utf8')

    def get(self):
        return json.loads(self.path.read_text(encoding='utf8'))

    def set(self, data):
        """带文件锁的原子写入,防止并发写冲突"""
        tmp = self.path.with_suffix('.tmp')
        import tempfile
        fd, tmp_path = tempfile.mkstemp(dir=str(self.path.parent), suffix='.tmp')
        try:
            os.write(fd, json.dumps(data, ensure_ascii=False, indent=2).encode('utf8'))
            os.close(fd)
            # 原子替换
            os.replace(tmp_path, str(self.path))
        except:
            os.close(fd)
            try: os.unlink(tmp_path)
            except: pass
            raise

    def update(self, key, value):
        d = self.get()
        d[key] = value
        self.set(d)

    def delete(self, key):
        d = self.get()
        d.pop(key, None)
        self.set(d)

cron_store = EngineStore(ENGINE_DIR / "cron.json")
agent_store = EngineStore(ENGINE_DIR / "agents.json")
heartbeat_store = EngineStore(ENGINE_DIR / "heartbeat.json")

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

def _generate_srt(subtitles, output_srt_path):
    """
    根据字幕数组生成 SRT 文件
    subtitles: [{"start": 0.5, "end": 2.0, "text": "你好"}, ...]
    返回: SRT 文件路径
    """
    with open(output_srt_path, 'w', encoding='utf-8') as f:
        for i, sub in enumerate(subtitles, 1):
            start = sub.get("start", 0)
            end = sub.get("end", start + 3)
            text = sub.get("text", "")
            # 格式化为 SRT 时间戳: HH:MM:SS,mmm
            def _fmt_ts(t):
                h = int(t // 3600)
                m = int((t % 3600) // 60)
                s = int(t % 60)
                ms = int((t % 1) * 1000)
                return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
            f.write(f"{i}\n{_fmt_ts(start)} --> {_fmt_ts(end)}\n{text}\n\n")
    return output_srt_path


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
        input_path = os.path.join(PROJECT_ROOT, input_path.replace("/oneapichat/", "", 1))

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
        _generate_srt(timeline, srt_path)

        # 构建 force_style 字符串
        font_name = "Noto Sans CJK SC"  # ffmpeg libass 识别的字体名
        styles = [
            f"FontName={font_name}",
            f"FontSize={fs}",
            f"PrimaryColour=&H{_color_to_ass(tc)}",
            f"OutlineColour=&H{_color_to_ass(stroke_color)}",
            f"Outline={stroke_width}",
            f"BorderStyle=1",  # 1=outline+shadow, 3=opaque box
            f"Alignment={_ypos_to_alignment(y_pos)}",
            f"MarginV=30",
        ]
        if bg_enabled:
            styles.append("BorderStyle=3")  # 不透明背景框
            styles.append(f"BackColour=&H{_color_to_ass(bg_color)}")
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
        except: pass

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
            bg = ColorClip(size=(clip.w, bg_h), color=_str_to_rgb(bg_color)).with_opacity(bg_opacity).with_position((0, clip.h - bg_h)).with_duration(clip.duration)
        except:
            bg = ColorClip(size=(clip.w, bg_h), color=(0, 0, 0)).with_opacity(bg_opacity).with_position((0, clip.h - bg_h)).with_duration(clip.duration)
        layers.insert(1, bg)

    final = CompositeVideoClip(layers)
    final.write_videofile(output_path, codec="libx264", audio_codec="aac")
    clip.close(); sub_clip.close(); final.close()
    try: os.unlink(sub_path)
    except: pass
    # 自动复制到 shared
    try:
        import shutil
        fn = 'push_' + __import__('hashlib').md5(output_path.encode()).hexdigest()[:8] + '.mp4'
        dest_dir = os.path.join(PROJECT_ROOT, 'uploads', 'shared')
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, fn)
        shutil.copy2(output_path, dest)
        os.chmod(dest, 0o644)
        url = f"https://naujtrats.xyz/oneapichat/uploads/shared/{fn}"
        return f"字幕完成: {url} (字体:{ft}, 大小:{fs})"
    except:
        return f"字幕完成: {output_path} (字体:{ft}, 大小:{fs})"


def _str_to_rgb(s):
    """颜色字符串转 RGB 元组"""
    color_map = {"black": (0,0,0), "white": (255,255,255), "red": (255,0,0),
                 "green": (0,255,0), "blue": (0,0,255), "gray": (128,128,128)}
    return color_map.get(s.lower().strip(), (0, 0, 0))


def _color_to_ass(color_name):
    """颜色名转 ASS 格式 (BBGGRR 十六进制, 不含 alpha)"""
    rgb = _str_to_rgb(color_name)
    # ASS 格式: &HBBGGRR&
    return f"{rgb[2]:02X}{rgb[1]:02X}{rgb[0]:02X}"


def _ypos_to_alignment(y_pos):
    """Y 位置转 ASS alignment 值 (1-9, 数字小键盘布局)"""
    if isinstance(y_pos, str):
        y_pos = y_pos.lower().strip()
        if y_pos == "top": return 8    # 顶部居中
        if y_pos == "middle": return 5  # 正中
        return 2  # 底部居中 (默认)
    try:
        py = int(y_pos)
        if py < 150: return 8   # 靠近顶部
        if py > 400: return 2   # 靠近底部
        return 5
    except:
        return 2

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
            resp = requests.post(url, headers={"Authorization":f"Bearer {tts_key}","Content-Type":"application/json"}, json=body, timeout=60)
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
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120, cwd=PROJECT_ROOT)
        if r.returncode == 0:
            mp3_files = glob.glob(os.path.join(PROJECT_ROOT, "speech_*.mp3"))
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
        dest_dir = os.path.join(PROJECT_ROOT, 'uploads', 'shared')
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, fn)
        shutil.copy2(output_path, dest)
        os.chmod(dest, 0o644)
        url = f"https://naujtrats.xyz/oneapichat/uploads/shared/{fn}"
        return f"配音完成: {url} (视频{vd:.1f}s, 配音{ad:.1f}s)"
    except:
        return f"配音完成: {output_path} (视频{vd:.1f}s, 配音{ad:.1f}s)"


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
    except:
        pil_font = ImageFont.truetype(DEFAULT_FONT, default_fs)
    # ★ emoji 回退字体: Symbola 支持所有 Unicode emoji (Pillow 兼容)
    _emoji_font_path = "/usr/share/fonts/truetype/ancient-scripts/Symbola_hint.ttf"
    _emoji_font = None
    if os.path.exists(_emoji_font_path):
        try:
            _emoji_font = ImageFont.truetype(_emoji_font_path, default_fs)
        except:
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
        except:
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
                _rgba = _hex_to_rgba(seg_bg_color, seg_bg_opacity)
                _draw_rounded_rect(draw, (0,0,iw,ih), seg_bg_r, _rgba)
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
        _before = set(glob.glob(os.path.join(PROJECT_ROOT, "speech_*.mp3")))
        cmd = [mmx_bin, "--region","cn","speech","synthesize",
               "--text",t,"--voice",seg_voice,"--speed",str(speed),"--output",audio_out]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60, cwd=PROJECT_ROOT)
        if r.returncode != 0:
            continue
        _after = set(glob.glob(os.path.join(PROJECT_ROOT, "speech_*.mp3")))
        _new = list(_after - _before)
        if _new:
            shutil.move(max(_new, key=os.path.getmtime), audio_out)
        else:
            _sf = glob.glob(os.path.join(PROJECT_ROOT, "speech_*.mp3"))
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
            except: pass
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
    except:
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
            except:
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
        except: pass
    for _dp in _dmk_pngs_to_clean:
        try: os.unlink(_dp)
        except: pass
    for ap,_ in tts_segments:
        try: os.unlink(ap)
        except: pass

    fn = 'push_' + hashlib.md5(output_path.encode()).hexdigest()[:8] + '.mp4'
    dest_dir = os.path.join(PROJECT_ROOT, 'uploads', 'shared')
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, fn)
    try:
        shutil.copy2(output_path, dest)
        os.chmod(dest, 0o644)
        url = f"https://naujtrats.xyz/oneapichat/uploads/shared/{fn}"
    except Exception:
        url = output_path

    return f"✅ 视频已生成并发布: {url}\n(字幕{len(subtitle_overlays)}条 + {len(tts_segments)}段配音, 原音保留{bg_volume*100:.0f}%)"


# ═══════════════════════════════════════════════════════
# 新增视频处理功能 (2026-05-28)
# ═══════════════════════════════════════════════════════

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
        dest_dir = os.path.join(PROJECT_ROOT, 'uploads', 'shared')
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, fn)
        shutil.copy2(output_path, dest)
        os.chmod(dest, 0o644)
        return f"GIF完成: https://naujtrats.xyz/oneapichat/uploads/shared/{fn}"
    except:
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


def _hex_to_rgba(hex_color, alpha):
    """#RRGGBB 或 #RRGGBBAA → (R,G,B,A)"""
    h = hex_color.lstrip('#')
    if len(h) == 6:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(alpha * 255))
    elif len(h) == 8:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16))
    return (0, 0, 0, int(alpha * 255))


def _draw_rounded_rect(draw, rect, radius, fill):
    """画圆角矩形到 Pillow draw 对象"""
    x1, y1, x2, y2 = rect
    r = min(radius, (x2 - x1) // 2, (y2 - y1) // 2)
    # 四个角扇形
    draw.pieslice([x1, y1, x1 + r*2, y1 + r*2], 180, 270, fill=fill)
    draw.pieslice([x2 - r*2, y1, x2, y1 + r*2], 270, 360, fill=fill)
    draw.pieslice([x1, y2 - r*2, x1 + r*2, y2], 90, 180, fill=fill)
    draw.pieslice([x2 - r*2, y2 - r*2, x2, y2], 0, 90, fill=fill)
    # 填充矩形
    draw.rectangle([x1 + r, y1, x2 - r, y1 + r], fill=fill)
    draw.rectangle([x1 + r, y2 - r, x2 - r, y2], fill=fill)
    draw.rectangle([x1, y1 + r, x1 + r, y2 - r], fill=fill)
    draw.rectangle([x2 - r, y1 + r, x2, y2 - r], fill=fill)
    draw.rectangle([x1 + r, y1 + r, x2 - r, y2 - r], fill=fill)

def get_ns(suffix: str, user_id: str = "") -> EngineStore:
    """获取用户隔离的 store 实例"""
    return EngineStore(ENGINE_DIR / f"{suffix}.json", user_id=user_id)



# ==================== ChatStore (SQLite 消息持久化) ====================

class ChatStore:
    """SQLite 消息存储，支持流式进度保存"""
    def __init__(self, user_id: str = ""):
        self.user_id = user_id
        db_name = f"chat_{user_id}.db" if user_id else "chat.db"
        self.db_path = ENGINE_DIR / db_name
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self._progress_cache = {}  # msg_id -> latest progress (in-memory)

    def _conn(self):
        return sqlite3.connect(str(self.db_path), timeout=30)

    def _init_db(self):
        conn = self._conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL, msg_id TEXT UNIQUE NOT NULL,
                role TEXT NOT NULL, content TEXT, reasoning TEXT,
                tool_calls TEXT, model TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_stream_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                msg_id TEXT UNIQUE NOT NULL, chat_id TEXT NOT NULL, model TEXT,
                full_text TEXT DEFAULT '', reasoning_text TEXT DEFAULT '',
                tool_calls TEXT DEFAULT '[]', usage TEXT, finished INTEGER DEFAULT 0,
                error TEXT DEFAULT '', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_msg_chat ON chat_messages(chat_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_progress_msg ON chat_stream_progress(msg_id)")
        conn.commit()
        conn.close()

    def init_progress(self, msg_id: str, chat_id: str, model: str):
        try:
            conn = self._conn()
            conn.execute("""
                INSERT OR REPLACE INTO chat_stream_progress (msg_id, chat_id, model, finished, updated_at)
                VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
            """, (msg_id, chat_id, model))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ChatStore] init error: {e}")

    def write_chunk(self, msg_id: str, chunk_type: str, chunk_text: str):
        if msg_id not in self._progress_cache:
            self._progress_cache[msg_id] = {'full_text': '', 'reasoning_text': ''}
        cache = self._progress_cache[msg_id]
        if chunk_type == 'content':
            cache['full_text'] += chunk_text
        elif chunk_type == 'reasoning':
            cache['reasoning_text'] += chunk_text
        # 每 20 个字符写一次 DB
        if len(cache['full_text']) % 20 < len(chunk_text) or chunk_type == 'reasoning':
            self._flush(msg_id, cache['full_text'], cache['reasoning_text'])

    def _flush(self, msg_id: str, full_text: str, reasoning_text: str):
        try:
            conn = self._conn()
            conn.execute("""
                UPDATE chat_stream_progress SET full_text=?, reasoning_text=?, updated_at=CURRENT_TIMESTAMP
                WHERE msg_id=?
            """, (full_text, reasoning_text, msg_id))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ChatStore] flush error: {e}")

    def finish_stream(self, msg_id: str, full_text: str, reasoning_text: str,
                      tool_calls: list, usage: dict, error: str = ""):
        try:
            conn = self._conn()
            conn.execute("""
                UPDATE chat_stream_progress SET
                    full_text=?, reasoning_text=?,
                    tool_calls=?, usage=?, finished=1, error=?, updated_at=CURRENT_TIMESTAMP
                WHERE msg_id=?
            """, (full_text, reasoning_text, json.dumps(tool_calls, ensure_ascii=False),
                  json.dumps(usage or {}, ensure_ascii=False), error, msg_id))
            conn.commit()
            conn.close()
            self._progress_cache.pop(msg_id, None)
        except Exception as e:
            print(f"[ChatStore] finish error: {e}")

    def get_progress(self, msg_id: str) -> dict:
        try:
            conn = self._conn()
            row = conn.execute("""
                SELECT full_text, reasoning_text, tool_calls, usage, finished, error
                FROM chat_stream_progress WHERE msg_id=?
            """, (msg_id,)).fetchone()
            conn.close()
            if row:
                return {'full_text': row[0] or '', 'reasoning_text': row[1] or '',
                        'tool_calls': json.loads(row[2] or '[]'), 'usage': json.loads(row[3] or '{}'),
                        'finished': bool(row[4]), 'error': row[5] or ''}
            return {}
        except:
            return {}

_chat_stores = {}
def get_chat_store(user_id: str = "") -> ChatStore:
    if user_id not in _chat_stores:
        _chat_stores[user_id] = ChatStore(user_id)
    return _chat_stores[user_id]

# ==================== 心跳 ====================
@app.get("/engine/health")
def engine_health():
    return {"status": "ok", "time": datetime.now().isoformat()}

@app.get("/engine/heartbeat")
def heartbeat(user_id: str = Query("")):
    """客户端心跳上报"""
    store = get_ns("heartbeat", user_id)
    client = "web"
    data = store.get()
    data[client] = {
        "last_seen": time.time(),
        "time": datetime.now().isoformat()
    }
    store.set(data)
    # 返回待处理的消息
    pending = data.get("pending_messages", [])
    result = {"ok": True, "pending": pending}
    if pending:
        data["pending_messages"] = []
        store.set(data)
    return result

@app.get("/engine/heartbeat/push")
def heartbeat_push(msg: str = Query(...), user_id: str = Query("")):
    """向客户端推送消息(通过心跳带回)"""
    store = get_ns("heartbeat", user_id)
    data = store.get()
    pending = data.get("pending_messages", [])
    pending.append({"msg": msg, "time": datetime.now().isoformat()})
    data["pending_messages"] = pending
    store.set(data)
    return {"ok": True}

# ==================== 子代理并发锁 ====================
# per-user 的写锁,防止并行子代理写入冲突
_agent_store_locks: dict = {}
_agent_store_lock_lock = threading.Lock()

def _get_agent_store_lock(user_id: str) -> threading.Lock:
    """获取用户级别的写锁(线程安全)"""
    with _agent_store_lock_lock:
        if user_id not in _agent_store_locks:
            _agent_store_locks[user_id] = threading.Lock()
        return _agent_store_locks[user_id]

# ==================== Cron 任务 ====================
_cron_threads = {}

@app.get("/engine/cron/list")
def cron_list(user_id: str = Query("")):
    store = get_ns("cron", user_id)
    return store.get()

@app.get("/engine/cron/create")
def cron_create(
    name: str = Query(...),
    interval: int = Query(...),  # 秒
    action: str = Query(...),     # 要执行的 shell 命令
    user_id: str = Query("")
):
    store = get_ns("cron", user_id)
    jobs = store.get()
    jobs[name] = {
        "name": name,
        "interval": interval,
        "action": action,
        "enabled": True,
        "created": datetime.now().isoformat()
    }
    store.set(jobs)
    _start_cron_job(name, user_id)
    return {"ok": True, "job": name}

@app.get("/engine/cron/delete")
def cron_delete(name: str = Query(...), user_id: str = Query("")):
    _stop_cron_job(name, user_id)
    store = get_ns("cron", user_id)
    store.delete(name)
    return {"ok": True}

def _run_cron_job(name, interval, action, user_id):
    """后台执行 cron 任务"""
    key = f"{user_id}_{name}"
    store = get_ns("cron", user_id)
    while True:
        job = store.get().get(name)
        if not job or not job.get("enabled"):
            break
        try:
            result = subprocess.run(
                action, shell=True, capture_output=True, text=True, timeout=300, encoding='utf-8', errors='replace'
            )
            log_entry = {
                "time": datetime.now().isoformat(),
                "exit_code": result.returncode,
                "stdout": result.stdout[-500:] if result.stdout else "",
                "stderr": result.stderr[-500:] if result.stderr else ""
            }
            # Cron完成后推送通知(优先 stdout,其次 stderr,兜底推送完成消息)
            push_store = get_ns("heartbeat", user_id)
            push_data = push_store.get()
            pending = push_data.get("pending_messages", [])
            if result.stdout.strip():
                pending.append({"msg": f"[Cron] {name}: {result.stdout.strip()[-200:]}", "time": datetime.now().isoformat()})
            elif result.stderr.strip():
                pending.append({"msg": f"[Cron] {name} 出错: {result.stderr.strip()[-200:]}", "time": datetime.now().isoformat()})
            else:
                pending.append({"msg": f"[Cron] {name} 已完成 (exit: {result.returncode})", "time": datetime.now().isoformat()})
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

def _start_cron_job(name, user_id=""):
    store = get_ns("cron", user_id)
    key = f"{user_id}_{name}"
    job = store.get().get(name)
    if not job:
        return
    if key in _cron_threads and _cron_threads[key].is_alive():
        return
    t = threading.Thread(target=_run_cron_job, args=(name, job["interval"], job["action"], user_id), daemon=True)
    t.start()
    _cron_threads[key] = t

def _stop_cron_job(name, user_id=""):
    store = get_ns("cron", user_id)
    key = f"{user_id}_{name}"
    jobs = store.get()
    if name in jobs:
        jobs[name]["enabled"] = False
        store.set(jobs)
    _cron_threads.pop(key, None)

# ==================== Agent 角色系统 ====================
# 每个角色有不同工具权限,实现最小权限原则
AGENT_ROLES = {
    "explorer": {
        "label": "🔍 搜索专员",
        "desc": "只读搜索,适合查资料、抓网页。不可修改文件或执行命令",
        "tools": ["web_search", "web_fetch", "engine_push", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "cheap",
        "max_rounds": 10
    },
    "planner": {
        "label": "📐 规划师",
        "desc": "制定方案、分析策略。不做执行,只出方案",
        "tools": ["web_search", "engine_push", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "smart",
        "max_rounds": 8
    },
    "developer": {
        "label": "⚡ 开发者",
        "desc": "读写文件、执行命令、搜索、浏览器操控。全能执行角色",
        "tools": ["web_search", "web_fetch", "engine_push", "server_exec", "server_python", "server_file_read", "server_file_write", "server_file_append", "video_edit", "browser_navigate", "browser_screenshot", "browser_click", "browser_type", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "smart",
        "max_rounds": 30
    },
    "verifier": {
        "label": "✅ 验证者",
        "desc": "检查结果、找问题。只读,不可修改",
        "tools": ["web_search", "web_fetch", "server_file_read", "engine_push", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "smart",
        "max_rounds": 15
    },
    "general": {
        "label": "🌐 全能代理",
        "desc": "所有工具可用(默认角色)",
        "tools": ["web_search", "web_fetch", "engine_push", "server_exec", "server_python", "server_file_read", "server_file_write", "server_file_append", "server_sys_info", "video_edit", "browser_navigate", "browser_screenshot", "browser_click", "browser_type", "browser_get_content", "browser_get_snapshot"],
        "model_tier": "smart",
        "max_rounds": 30
    }
}

def _filter_tools_by_role(role: str) -> list:
    """根据角色过滤工具列表,实现最小权限"""
    ALL_TOOLS_DEF = [
        {
            "type": "function",
            "function": {
                "name": "web_fetch",
                "description": "抓取一个网页URL的内容,返回提取后的文本。支持批量抓取(最多3个URL同时)。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "要抓取的URL"},
                        "urls": {"type": "array", "items": {"type": "string"}, "description": "批量抓取多个URL(最多3个)"}
                    },
                    "required": []
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "engine_push",
                "description": "向用户推送一条通知消息,消息会通过心跳机制到达前端。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "msg": {"type": "string", "description": "推送消息内容"}
                    },
                    "required": ["msg"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "server_sys_info",
                "description": "获取服务器系统信息(内存、磁盘、CPU等)。",
                "parameters": {"type": "object", "properties": {}, "required": []}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "server_file_write",
                "description": "将内容写入服务器文件。除非用户要求保存文件，否则不要用这个工具，直接用文字回复即可。路径限制在临时目录开头。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "文件路径，如 tempfile/myfile.md"},
                        "content": {"type": "string", "description": "写入的文件内容"}
                    },
                    "required": ["path", "content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "搜索互联网,返回标题+链接+摘要。用于查找最新信息、攻略等。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "搜索关键词"}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "server_file_append",
                "description": "向已存在的文件追加内容(末尾换行追加)。如果文件不存在则自动创建。用于边搜索边写入攻略,不用等到最后一次性保存。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "文件路径,如 tempfile/外卖省钱攻略.md"},
                        "content": {"type": "string", "description": "要追加的内容"}
                    },
                    "required": ["path", "content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "server_file_read",
                "description": "读取服务器文件内容。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "文件路径"}
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "server_exec",
                "description": "在服务器上执行 shell 命令并返回输出。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "cmd": {"type": "string", "description": "要执行的 shell 命令"},
                        "timeout": {"type": "number", "description": "超时时间(秒),默认60"}
                    },
                    "required": ["cmd"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "server_python",
                "description": "执行 Python 脚本代码,返回输出。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "script": {"type": "string", "description": "Python 代码"},
                        "timeout": {"type": "number", "description": "超时时间(秒),默认30"}
                    },
                    "required": ["script"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_navigate",
                "description": "在浏览器中打开一个网页。会替换当前页面内容。用于查看网页、登录页面、查看实时内容等。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "要打开的完整 URL"}
                    },
                    "required": ["url"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_screenshot",
                "description": "对当前浏览器页面截图，返回一张图片。用于查看页面视觉状态。",
                "parameters": {"type": "object", "properties": {}}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_click",
                "description": "在浏览器页面中点击指定选择器的元素。必须先 browser_navigate 打开页面再操作。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "selector": {"type": "string", "description": "CSS 选择器"}
                    },
                    "required": ["selector"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_type",
                "description": "在浏览器页面的输入框中输入文字。会清空再输入。必须先 browser_navigate 打开页面再操作。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "selector": {"type": "string", "description": "输入框的 CSS 选择器"},
                        "text": {"type": "string", "description": "要输入的文字内容"}
                    },
                    "required": ["selector", "text"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_get_content",
                "description": "获取当前浏览器页面的可见文本内容。用于阅读文章、查看搜索结果等。最多返回50000字符。",
                "parameters": {"type": "object", "properties": {}}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "browser_get_snapshot",
                "description": "获取当前浏览器页面的可访问性结构树(类似于页面元素大纲)。用于理解页面布局、按钮位置等。",
                "parameters": {"type": "object", "properties": {}}
            }
        }
    ]
    role_config = AGENT_ROLES.get(role, AGENT_ROLES["general"])
    allowed = set(role_config["tools"])
    return [t for t in ALL_TOOLS_DEF if t["function"]["name"] in allowed]

# ==================== 子代理 ====================

def _cleanup_old_agents(agents: dict) -> int:
    """清理过时/失败/已完成的子代理,返回清理数量"""
    now = datetime.now()
    cutoff = now - timedelta(hours=12)  # 超过12小时的completed/failed清理
    to_delete = []
    for name, agent in list(agents.items()):
        created_str = agent.get("created", "")
        if not created_str:
            continue
        try:
            created = datetime.fromisoformat(created_str)
        except:
            continue
        status = agent.get("status", "")
        age = now - created
        # completed/failed 超过12小时
        if status in ("completed", "failed") and age > timedelta(hours=12):
            to_delete.append(name)
        # idle 超过1小时(创建了但从未运行)
        elif status == "idle" and age > timedelta(hours=1):
            to_delete.append(name)
    for name in to_delete:
        del agents[name]
    return len(to_delete)

@app.get("/engine/agent/list")
def agent_list(user_id: str = Query("")):
    store = get_ns("agents", user_id)
    agents = store.get()
    cleaned = _cleanup_old_agents(agents)
    if cleaned:
        store.set(agents)
    return agents

@app.get("/engine/agent/create")
def agent_create(
    name: str = Query(...),
    prompt: str = Query(...),
    role: str = Query("general"),
    model: str = Query(""),
    api_key: str = Query(""),
    base_url: str = Query(""),
    user_id: str = Query("")
):
    store = get_ns("agents", user_id)
    agents = store.get()
    # 自动清理过时子代理
    _cleanup_old_agents(agents)
    # 验证角色名
    if role not in AGENT_ROLES:
        role = "general"
    agent_data = {
        "name": name,
        "prompt": prompt,
        "role": role,
        "status": "idle",
        "created": datetime.now().isoformat()
    }
    agents[name] = agent_data
    store.set(agents)
    return {"ok": True, "agent": name, "role": role}

@app.get("/engine/agent/run")
def agent_run(name: str = Query(...), user_id: str = Query(""), message: str = Query(""), from_ask: str = Query("")):
    """运行子代理(调用AI完成指定任务)
    message - 追加的消息内容(用于agent_ask)
    from_ask - 如果是agent_ask触发,消息追加到prompt后"""
    store = get_ns("agents", user_id)
    agents = store.get()
    agent = agents.get(name)
    if not agent:
        raise HTTPException(404, f"Agent {name} not found")
    # 如果from_ask,把消息追加到agent的prompt
    if from_ask and message:
        agent["prompt"] = agent.get("prompt", "") + f"\n\n用户消息: {message}"

    from openai import OpenAI
    # ★ 所有 agent 统一从主聊天配置同步
    main_config = _get_main_chat_config(user_id)
    api_key = main_config.get("api_key", "") or os.getenv("OPENAI_API_KEY", "")
    base_url = main_config.get("base_url", "") or os.getenv("OPENAI_BASE_URL", "") or "https://api.minimaxi.com/v1"
    model = main_config.get("model", "") or "MiniMax-M2.7"
    if "api.minimaxi.com" in base_url and "minimax" not in model.lower():
        model = "MiniMax-M2.7"
    if not api_key:
        return {"error": "未配置API Key,请在聊天设置中配置后重试"}

    # ★ 根据角色选择工具集(最小权限原则)
    agent_role = agent.get("role", "general")
    role_config = AGENT_ROLES.get(agent_role, AGENT_ROLES["general"])
    TOOLS = _filter_tools_by_role(agent_role)

    # ★ 角色级别模型选择:cheap 角色用轻量模型节省开销
    if role_config["model_tier"] == "cheap":
        # 尝试用 deepseek-chat 或站内最便宜的模型
        cheap_model = main_config.get("cheap_model", "") or os.getenv("CHEAP_MODEL", "")
        if cheap_model:
            model = cheap_model
        elif "minimaxi" in model.lower():
            model = "MiniMax-M2.7"  # MiniMax 本身已经是便宜模型
        # 对于 explorer/planner 减少 max_tokens 节省token
    max_agent_rounds = role_config["max_rounds"]

    def _execute_tool(tool_name, args):
        """执行子代理工具调用"""
        if tool_name == "web_search":
            query = args.get("query", "")
            if not query:
                return "错误:缺少 query 参数"
            try:
                # 用主聊配置的 Tavily API Key
                tavily_key = ""
                try:
                    main_cfg = _get_main_chat_config(user_id)
                    # 从原始 JSON 中读取存储的 Tavily key
                    config_path = f"chat_data/config_user_{user_id}.json"
                    with open(config_path) as f:
                        raw_cfg = json.load(f)
                    stored = raw_cfg.get("searchApiKeyTavily", "") or raw_cfg.get("searchApiKey", "") or ""
                    if stored:
                        decrypted = _decrypt_xor(stored)
                        if decrypted:
                            tavily_key = decrypted
                except:
                    pass

                if not tavily_key:
                    return f"搜索出错: 未找到 Tavily API Key (请先在设置中配置搜索API Key)"

                r = requests.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": tavily_key,
                        "query": query,
                        "search_depth": "basic",
                        "max_results": 8,
                        "include_answer": False
                    },
                    timeout=15
                )
                data = r.json()
                results = data.get("results", [])
                if not results:
                    return f'搜索 "{query}" 无结果。请更换关键词重试。'

                lines = []
                for res in results[:8]:
                    title = res.get("title", "")
                    url = res.get("url", "")
                    content = res.get("content", "")[:200].replace("\n", " ")
                    content = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', content)
                    lines.append(f"- [{title}]({url})\n  {content}")
                return f"搜索结果 (query: {query}):\n" + "\n\n".join(lines) + "\n\n注: 如需查看详情请使用 web_fetch 工具抓取网页内容。"
            except Exception as e:
                return f"搜索出错: {str(e)}\n请稍后重试或更换关键词。"
        elif tool_name == "web_fetch":
            urls = []
            if args.get("url"): urls.append(args["url"])
            if args.get("urls"): urls.extend(args["urls"][:3])
            results = []
            for url in urls:
                try:
                    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
                    # ★ 修复:过滤控制字符+null字节,防止JSON序列化崩溃
                    raw = r.text
                    # 移除控制字符(保留换行和制表符)
                    raw = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', raw)
                    # 移除HTML标签,只保留文本
                    raw = re.sub(r'<[^>]+>', ' ', raw)
                    # 合并空白
                    raw = re.sub(r'\s+', ' ', raw).strip()
                    text = raw[:3000]  # 限制长度
                    results.append(f"[{url}]: {text}")
                except Exception as e:
                    results.append(f"[{url}]: 错误 - {str(e)}")
            return "\n\n".join(results) if results else "未提供URL"
        elif tool_name == "engine_push":
            msg = args.get("msg", "")
            if msg:
                push_store = get_ns("heartbeat", user_id)
                data = push_store.get()
                pending = data.get("pending_messages", [])
                pending.append({"msg": msg, "time": datetime.now().isoformat()})
                data["pending_messages"] = pending
                push_store.set(data)
            return "消息已推送到用户"
        elif tool_name == "server_sys_info":
            import shutil
            mem = subprocess.run("free -h | head -2", shell=True, capture_output=True, text=True).stdout
            disk = subprocess.run("df -h / | tail -1", shell=True, capture_output=True, text=True).stdout
            return f"内存:\n{mem}\n磁盘:\n{disk}"
        elif tool_name == "server_file_append":
            path = args.get("path", "")
            content = args.get("content", "")
            if not path or not content:
                return "错误:缺少 path 或 content 参数"
            try:
                allowed_prefix = str(TEMP_DIR) + "/"
                if not path.startswith(allowed_prefix):
                    return f"错误:只允许写入 {allowed_prefix} 目录"
                safe_path = os.path.normpath(path)
                if not safe_path.startswith(allowed_prefix):
                    return "错误:路径不合法"
                os.makedirs(os.path.dirname(safe_path), exist_ok=True)
                mode = "a"  # 追加模式
                with open(safe_path, mode, encoding="utf-8") as f:
                    f.write(content + "\n\n")
                fname = os.path.basename(safe_path)
                dl_url = "/oneapichat/download.php?file=" + fname
                # 读取当前文件总大小
                total = len(open(safe_path, encoding="utf-8").read())
                return f"内容已追加到: {safe_path}\n下载链接: {dl_url}\n当前文件大小: {total} 字符"
            except Exception as e:
                return f"追加失败: {str(e)}"
        elif tool_name == "server_file_write":
            path = args.get("path", "")
            content = args.get("content", "")
            if not path or not content:
                return "错误:缺少 path 或 content 参数"
            try:
                allowed_prefix = str(TEMP_DIR) + "/"
                if not path.startswith(allowed_prefix):
                    return f"错误:只允许写入 {allowed_prefix} 目录"
                safe_path = os.path.normpath(path)
                if not safe_path.startswith(allowed_prefix):
                    return "错误:路径不合法"
                os.makedirs(os.path.dirname(safe_path), exist_ok=True)
                with open(safe_path, "w", encoding="utf-8") as f:
                    f.write(content)
                fname = os.path.basename(safe_path)
                dl_url = "/oneapichat/download.php?file=" + fname
                return f"文件已保存: {safe_path}\n下载链接: {dl_url}\n大小: {len(content)} 字符"
            except Exception as e:
                return f"写入失败: {str(e)}"
        elif tool_name == "server_file_read":
            path = args.get("path", "")
            if not path:
                return "错误:缺少 path 参数"
            try:
                if not os.path.isfile(path):
                    return f"文件不存在: {path}"
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read(10000)
                return f"{path} 的内容 ({len(content)} 字符):\n\n{content}"
            except Exception as e:
                return f"读取失败: {str(e)}"
        elif tool_name == "browser_navigate":
            try:
                import asyncio
                from engine.browser import ensure_browser_connected
                bm = asyncio.run(ensure_browser_connected())
                result = asyncio.run(bm.navigate(args.get("url", "")))
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                return f"浏览器导航失败: {str(e)}"
        elif tool_name == "browser_screenshot":
            try:
                import asyncio
                from engine.browser import ensure_browser_connected
                bm = asyncio.run(ensure_browser_connected())
                result = asyncio.run(bm.screenshot())
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                return f"浏览器截图失败: {str(e)}"
        elif tool_name == "browser_click":
            try:
                import asyncio
                from engine.browser import ensure_browser_connected
                bm = asyncio.run(ensure_browser_connected())
                result = asyncio.run(bm.click(args.get("selector", "")))
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                return f"浏览器点击失败: {str(e)}"
        elif tool_name == "browser_type":
            try:
                import asyncio
                from engine.browser import ensure_browser_connected
                bm = asyncio.run(ensure_browser_connected())
                result = asyncio.run(bm.type_text(args.get("selector", ""), args.get("text", "")))
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                return f"浏览器输入失败: {str(e)}"
        elif tool_name == "browser_get_content":
            try:
                import asyncio
                from engine.browser import ensure_browser_connected
                bm = asyncio.run(ensure_browser_connected())
                result = asyncio.run(bm.get_content())
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                return f"浏览器获取内容失败: {str(e)}"
        elif tool_name == "browser_get_snapshot":
            try:
                import asyncio
                from engine.browser import ensure_browser_connected
                bm = asyncio.run(ensure_browser_connected())
                result = asyncio.run(bm.get_snapshot())
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                return f"浏览器获取结构失败: {str(e)}"
        elif tool_name == "video_edit":
            try:
                import json as _json
                action = args.get("action", "")
                params = args.get("params", {})
                input_path = args.get("input_path", "")
                output_path = args.get("output_path", "/tmp/video_output.mp4")
                if not input_path:
                    return "错误: 未提供输入视频路径"
                if not os.path.exists(input_path):
                    return f"错误: 输入文件不存在: {input_path}"
                if action == "info":
                    import subprocess
                    cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", input_path]
                    r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                    return r.stdout
                elif action == "trim":
                    start = params.get("start", 0)
                    end = params.get("end", None)
                    from moviepy import VideoFileClip
                    clip = VideoFileClip(input_path)
                    if end:
                        clip = clip.subclipped(start, end)
                    else:
                        clip = clip.subclipped(start)
                    clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
                    clip.close()
                    return f"裁剪完成: {output_path}"
                elif action == "speed":
                    factor = float(params.get("factor", 1.0))
                    from moviepy import VideoFileClip
                    from moviepy import vfx
                    clip = VideoFileClip(input_path)
                    clip = clip.with_effects([vfx.MultiplySpeed(factor)])
                    clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
                    clip.close()
                    return f"调速完成 (x{factor}): {output_path}"
                elif action == "resize":
                    width = params.get("width", 0)
                    height = params.get("height", 0)
                    from moviepy import VideoFileClip
                    from moviepy import vfx
                    clip = VideoFileClip(input_path)
                    if width and height:
                        clip = clip.resized((width, height))
                    elif width:
                        clip = clip.resized(width=width)
                    elif height:
                        clip = clip.resized(height=height)
                    clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
                    clip.close()
                    return f"缩放完成: {output_path}"
                elif action == "audio":
                    from moviepy import VideoFileClip
                    clip = VideoFileClip(input_path)
                    audio_output = output_path or input_path + ".mp3"
                    if clip.audio:
                        clip.audio.write_audiofile(audio_output)
                    clip.close()
                    return f"音频提取完成: {audio_output}"
                elif action == "concat":
                    files = params.get("files", [])
                    if not files:
                        return "错误: concat 需要 files 数组参数"
                    from moviepy import concatenate_videoclips
                    clips = [VideoFileClip(f) for f in files]
                    final = concatenate_videoclips(clips, method="compose")
                    final.write_videofile(output_path, codec="libx264", audio_codec="aac")
                    for c in clips: c.close()
                    final.close()
                    return f"拼接完成 ({len(files)}个视频): {output_path}"
                elif action == "overlay":
                    overlay_path = params.get("overlay_path", "")
                    if not overlay_path or not os.path.exists(overlay_path):
                        return "错误: overlay 需要 overlay_path 参数指向存在的文件"
                    x = params.get("x", 10)
                    y = params.get("y", 10)
                    scale = params.get("scale", 0.3)
                    from moviepy import CompositeVideoClip
                    clip = VideoFileClip(input_path)
                    ov = VideoFileClip(overlay_path).resized(scale)
                    ov = ov.with_position((x, y))
                    final = CompositeVideoClip([clip, ov])
                    final.write_videofile(output_path, codec="libx264", audio_codec="aac")
                    clip.close(); ov.close(); final.close()
                    return f"画中画完成: {output_path}"
                elif action == "text":
                    return _apply_subtitle(input_path, output_path, params)
                elif action == "rotate":
                    angle = float(params.get("angle", 90))
                    from moviepy import vfx
                    clip = VideoFileClip(input_path)
                    clip = clip.with_effects([vfx.Rotate(angle)])
                    clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
                    clip.close()
                    return f"旋转完成 ({angle}°): {output_path}"
                elif action in ("filter", "video_filter"):
                    return _apply_ffmpeg_filter(input_path, output_path, params)
                elif action in ("transition", "video_transition"):
                    return _apply_ffmpeg_transition(input_path, output_path, params)
                elif action == "crop":
                    return _apply_crop(input_path, output_path, params)
                elif action == "reverse":
                    return _apply_reverse(input_path, output_path, params)
                elif action == "mute":
                    return _apply_mute(input_path, output_path, params)
                elif action == "bgm":
                    return _apply_bgm(input_path, output_path, params)
                elif action == "enhance":
                    return _apply_enhance(input_path, output_path, params)
                elif action == "gif":
                    return _apply_gif(input_path, output_path, params)
                elif action == "silent_cut":
                    return _apply_silent_cut(input_path, output_path, params)
                elif action == "style":
                    return _apply_subtitle_style(input_path, output_path, params)
                elif action == "tts":
                    return _apply_tts(params)
                elif action == "voice":
                    # voice: 将 TTS 生成的音频混入视频
                    audio_path = params.get("audio_path", "")
                    if not audio_path:
                        # 如果没有 audio_path,先调 TTS 生成
                        tts_result = _apply_tts(params)
                        if "失败" in tts_result or "异常" in tts_result:
                            return tts_result
                        audio_path = tts_result.split(": ")[1].split(" ")[0] if ": " in tts_result else "/tmp/tts_output.mp3"
                    return _apply_voice_to_video(input_path, audio_path, output_path, params)
                elif action == "compose":
                    return _apply_compose(input_path, output_path, params)
                else:
                    return f"未知操作: {action}, 支持: compose/crop/reverse/mute/bgm/enhance/gif/silent_cut/style/trim/concat/speed/resize/overlay/text/rotate/audio/filter/video_filter/transition/video_transition/tts/voice/frames/info"
            except ImportError as _e:
                return f"缺少依赖: {str(_e)}, 请先安装: pip install moviepy --break-system-packages"
            except Exception as _e:
                return f"视频剪辑失败: {str(_e)}"

        # ★ 通用转发: 子代理调用未知工具时自动转发到主引擎 API
        elif tool_name.startswith("server_") or tool_name == "engine_cron_list" or tool_name == "engine_cron_create" or tool_name == "engine_cron_delete":
            try:
                _engine_url = "http://127.0.0.1:8766/engine/" + {
                    "server_exec": "exec", "server_python": "python", "server_file_read": "file/read",
                    "server_file_write": "file/write", "server_file_search": "file_search",
                    "server_sys_info": "sys/info", "server_ps": "ps", "server_disk": "disk",
                    "server_network": "network", "server_docker": "docker", "server_db_query": "db_query",
                    "server_file_op": "file_op", "server_file_append": "file_append",
                    "engine_push": "agent/heartbeat"
                }.get(tool_name, tool_name)
                _params = {};
                for _k, _v in args.items(): _params[_k] = str(_v);
                _r = requests.get(_engine_url, params=_params, timeout=30);
                _d = _r.json();
                return json.dumps(_d, ensure_ascii=False)
            except Exception as _e:
                return f"工具执行失败: {str(_e)}"
        return "未知工具"

    def _run():
        _lock = _get_agent_store_lock(user_id)
        _lock.acquire()
        try:
            current_agents = store.get()
            if name not in current_agents:
                current_agents[name] = agent
            current_agents[name]["status"] = "running"
            current_agents[name]["result"] = ""
            current_agents[name]["_started_at"] = time.time()
            store.set(current_agents)
        finally:
            _lock.release()

        MAX_EXECUTION_SECONDS = 600  # 30分钟强制超时
        try:
            client = OpenAI(api_key=api_key, base_url=base_url, timeout=120)
            messages = [{"role": "user", "content": agent.get("prompt", "")}]
            max_rounds = max_agent_rounds
            result_parts = []
            start_time = time.time()

            for round_num in range(max_rounds):
                # 检查总执行时间
                if time.time() - start_time > MAX_EXECUTION_SECONDS:
                    raise TimeoutError(f"子代理执行超过{MAX_EXECUTION_SECONDS//60}分钟,自动终止")

                resp = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=TOOLS,
                    tool_choice="auto",
                    temperature=0.3,
                    max_tokens=2048,
                    timeout=120
                )
                msg = resp.choices[0].message
                # 用 model_dump 获取所有字段(包括 reasoning_content)
                msg_dict = msg.model_dump()
                if msg.content:
                    cleaned = msg.content
                    # 剔除 <think>...</think> 思考块
                    if '<think>' in cleaned or '</think>' in cleaned:
                        cleaned = re.sub(r'<think>.*?</think>', '', cleaned, flags=re.DOTALL).strip()
                    result_parts.append(cleaned)
                if not msg.tool_calls:
                    break  # 模型完成了

                # 获取 reasoning_content(DeepSeek 需要传回)
                asst_msg = {"role": "assistant", "content": msg.content}
                rc_val = msg_dict.get('reasoning_content', '') or msg_dict.get('reasoning', '')
                if not rc_val:
                    rc_val = (getattr(msg, 'model_extra', None) or {}).get('reasoning_content', '')
                if rc_val:
                    # DeepSeek 要求传回 reasoning_content(但不显示给用户)
                    asst_msg["reasoning_content"] = rc_val
                # 构建 tool_calls
                if hasattr(msg.tool_calls, 'model_dump'):
                    asst_msg["tool_calls"] = msg.tool_calls.model_dump()
                else:
                    asst_msg["tool_calls"] = [{"id": tc.id, "type": tc.type, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in msg.tool_calls]
                messages.append(asst_msg)

                for tc in msg.tool_calls:
                    tool_name = tc.function.name
                    tool_args = json.loads(tc.function.arguments)
                    result = _execute_tool(tool_name, tool_args)
                    # ★ 全局净化：移除所有控制字符和 unicode surrogate
                    if isinstance(result, str):
                        result = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', result)
                        if len(result) > 8000:
                            result = result[:8000] + '...(截断)'
                    result_parts.append(f"[工具: {tool_name}] {str(result)[:500]}")
                    # ★ put 结果时再做一次安全包装
                    safe_content = str(result) if result else '(empty)'
                    messages.append({"role": "tool", "tool_call_id": tc.id, "content": safe_content})
                    # ★ 实时写入 partial result(带锁+重读,防止覆盖其他代理)
                    _lock.acquire()
                    try:
                        current = store.get()
                        current[name] = current.get(name, {})
                        current[name]["result"] = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', "\n".join(result_parts))
                        current[name]["status"] = "running"
                        current[name]["_started_at"] = current.get(name, {}).get("_started_at", time.time())
                        store.set(current)
                    finally:
                        _lock.release()

                # ★ 最终保存(带锁+重读)
            _lock.acquire()
            try:
                current = store.get()
                current[name] = current.get(name, {})
                final_result = "\n".join(result_parts)
                current[name]["result"] = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', final_result)
                current[name]["status"] = "completed"
                store.set(current)
            finally:
                _lock.release()
        except Exception as e:
            _lock.acquire()
            try:
                current = store.get()
                current[name] = current.get(name, {})
                current[name]["error"] = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', str(e))
                current[name]["status"] = "failed"
                store.set(current)
            finally:
                _lock.release()
        # ★ 通知引擎:此代理已完成,需要主代理处理
        notify_store = get_ns("agent_notifications", user_id)
        notifs = notify_store.get()
        if not isinstance(notifs, list):
            notifs = []
        notifs.append({
            "agent": name,
            "status": agents[name]["status"],
            "result": agents[name].get("result", ""),
            "error": agents[name].get("error", ""),
            "time": datetime.now().isoformat(),
            "processed": False
        })
        # 裁剪超过50条的历史通知(防止内存泄漏)
        if len(notifs) > 50:
            notifs = notifs[-50:]
        notify_store.set(notifs)

    t = threading.Thread(target=_run, name=f"agent_{user_id}_{name}", daemon=True)
    t.start()
    return {"ok": True, "agent": name, "status": "running"}

@app.get("/engine/agent/status")
def agent_status(name: str = Query(...), user_id: str = Query("")):
    store = get_ns("agents", user_id)
    agents = store.get()
    agent = agents.get(name)
    if not agent:
        raise HTTPException(404, f"Agent {name} not found")
    return agent

# ==================== 主聊配置读取(所有 agent 同步主聊)====================
import base64

ENCRYPTION_KEY = 'naujtrats-secret'

def _decrypt_xor(encoded: str) -> str:
    """XOR 解密(复刻前端 decrypt 函数)"""
    if not encoded:
        return ""
    try:
        bin_bytes = base64.b64decode(encoded)
        key_bytes = ENCRYPTION_KEY.encode('utf-8')
        result = bytearray(len(bin_bytes))
        for i in range(len(bin_bytes)):
            result[i] = bin_bytes[i] ^ key_bytes[i % len(key_bytes)]
        return result.decode('utf-8')
    except Exception:
        return None

def _get_main_chat_config(user_id: str) -> dict:
    """从主聊天配置读取 api_key / base_url / model
    自动 XOR 解密 apiKey,优先主聊配置,无值则返回空字符串。
    """
    result = {"api_key": "", "base_url": "", "model": ""}
    if not user_id:
        return result
    config_path = f"chat_data/config_user_{user_id}.json"
    try:
        with open(config_path) as f:
            cfg = json.load(f)
        stored_key = cfg.get("apiKey", "") or ""
        # 优先 XOR 解密,解密失败则用原始值
        if stored_key:
            decrypted = _decrypt_xor(stored_key)
            result["api_key"] = decrypted if decrypted else stored_key
        result["base_url"] = cfg.get("baseUrl", "") or ""
        result["model"] = cfg.get("model", "") or ""
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    except Exception as e:
        print(f"[引擎] 读取主聊配置失败: {e}")
    return result



# ==================== 服务器操控工具 ====================
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

@app.get("/engine/python")
def engine_python(
    script: str = Query(...),
    timeout: int = Query(30),
    user_id: str = Query("")
):
    """执行 Python 脚本,返回输出"""
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
        except: pass

@app.get("/engine/file/read")
def engine_file_read(
    path: str = Query(...),
    max_lines: int = Query(200),
    user_id: str = Query("")
):
    """读取服务器上的文件内容"""
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
        shown = lines[:max_lines]
        text = '\n'.join(shown)
        if total > max_lines:
            text += f'\n\n... (共 {total} 行,仅显示前 {max_lines} 行)'
        return {"ok": True, "content": text, "total_lines": total, "size": p.stat().st_size}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/engine/file/write")
def engine_file_write(
    path: str = Query(...),
    content: str = Query(...),
    append: bool = Query(False),
    user_id: str = Query("")
):
    """写入文件(默认覆盖,append=True 追加)"""
    try:
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
        db_path = str(Path(PROJECT_ROOT) / "api" / "learning_records.db")
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


@app.get("/engine/agent/stop")
def agent_stop(name: str = Query(...), user_id: str = Query("")):
    """停止子代理(标记为 stopped)"""
    store = get_ns("agents", user_id)
    agents = store.get()
    agent = agents.get(name)
    if not agent:
        return {"ok": False, "error": "Agent not found"}
    agents[name]["status"] = "stopped"
    store.set(agents)
    return {"ok": True, "agent": name, "status": "stopped"}

@app.get("/engine/agent/delete")
def agent_delete(name: str = Query(...), user_id: str = Query("")):
    """删除子代理(从列表中移除)"""
    store = get_ns("agents", user_id)
    agents = store.get()
    if name not in agents:
        return {"ok": False, "error": "Agent not found"}
    del agents[name]
    store.set(agents)
    return {"ok": True, "agent": name, "deleted": True}

@app.get("/engine/agent/notifications")
def agent_notifications(user_id: str = Query("")):
    """获取未处理的子代理完成通知(主代理调用)"""
    store = get_ns("agent_notifications", user_id)
    notifs = store.get()
    if not isinstance(notifs, list):
        store.set([])
        notifs = []
    unprocessed = [n for n in notifs if not n.get("processed", False)]
    return {"notifications": unprocessed, "count": len(unprocessed)}

@app.get("/engine/agent/notifications/mark")
def agent_notifications_mark(user_id: str = Query("")):
    """标记所有通知为已处理"""
    store = get_ns("agent_notifications", user_id)
    notifs = store.get()
    if not isinstance(notifs, list):
        store.set([])
        return {"ok": True}
    for n in notifs:
        n["processed"] = True
    store.set(notifs)
    return {"ok": True}

# ==================== 工作流引擎 ====================
# 工作流 = 有向无环图,子代理按顺序执行,前一步的输出可传给后一步

@app.get("/engine/workflow/create")
def workflow_create(
    name: str = Query(...),
    steps: str = Query(...),  # JSON数组: [{"role":"explorer","prompt":"搜索xx"},...]
    user_id: str = Query("")
):
    """创建工作流
    steps 示例: [{"role":"explorer","prompt":"搜索2026年AI新闻","output_key":"news"},{"role":"planner","prompt":"基于上一步结果制定方案","output_key":"plan"}]
    """
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    try:
        parsed_steps = json.loads(steps)
    except:
        return {"error": "steps 必须为有效 JSON 数组"}
    if not isinstance(parsed_steps, list) or len(parsed_steps) == 0:
        return {"error": "steps 必须为非空数组"}
    for i, step in enumerate(parsed_steps):
        if "role" not in step or "prompt" not in step:
            return {"error": f"第{i+1}步缺少 role 或 prompt"}
        if step["role"] not in AGENT_ROLES:
            step["role"] = "general"
        step.setdefault("output_key", f"step_{i}")

    workflows[name] = {
        "name": name,
        "steps": parsed_steps,
        "status": "created",
        "current_step": 0,
        "results": {},
        "errors": [],
        "created": datetime.now().isoformat()
    }
    wf_store.set(workflows)
    return {"ok": True, "workflow": name, "steps": len(parsed_steps)}

@app.get("/engine/workflow/run")
def workflow_run(
    name: str = Query(...),
    user_id: str = Query("")
):
    """运行工作流(异步后台执行)"""
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    wf = workflows.get(name)
    if not wf:
        return {"error": "工作流不存在"}
    if wf["status"] == "running":
        return {"error": "工作流正在运行中"}

    def _run_workflow():
        wf_store = get_ns("workflows", user_id)
        workflows = wf_store.get()
        wf = workflows.get(name)
        if not wf:
            return
        wf["status"] = "running"
        wf["current_step"] = 0
        wf["results"] = {}
        wf["errors"] = []
        wf_store.set(workflows)

        for i, step in enumerate(wf["steps"]):
            wf_store = get_ns("workflows", user_id)
            workflows = wf_store.get()
            wf = workflows.get(name)
            if not wf or wf["status"] == "cancelled":
                return

            # 替换 prompt 中的变量引用 {prev_output_key}
            prompt = step["prompt"]
            for key, val in wf["results"].items():
                prompt = prompt.replace("{" + key + "}", str(val)[:2000])

            # 创建临时子代理执行当前步骤
            step_agent_name = f"wf_{name}_step{i}_{datetime.now().strftime('%H%M%S')}"
            step_role = step.get("role", "general")

            # 用主配置创建子代理
            main_config = _get_main_chat_config(user_id)
            step_api_key = main_config.get("api_key", "") or os.getenv("OPENAI_API_KEY", "")
            if not step_api_key:
                wf["status"] = "failed"
                wf["errors"].append({"step": i, "error": "未配置API Key"})
                wf_store.set(workflows)
                return

            try:
                from openai import OpenAI
                client = OpenAI(api_key=step_api_key, timeout=120)
                step_tools = _filter_tools_by_role(step_role)
                messages = [{"role": "user", "content": prompt}]
                step_max_rounds = AGENT_ROLES.get(step_role, AGENT_ROLES["general"])["max_rounds"]
                step_result_parts = []
                step_model = main_config.get("model", "") or "MiniMax-M2.7"
                if "api.minimaxi.com" in step_model and "minimax" not in step_model.lower():
                    step_model = "MiniMax-M2.7"
                if AGENT_ROLES.get(step_role, {}).get("model_tier") == "cheap":
                    cheap_m = main_config.get("cheap_model", "")
                    if cheap_m:
                        step_model = cheap_m

                for round_num in range(step_max_rounds):
                    resp = client.chat.completions.create(
                        model=step_model,
                        messages=messages,
                        tools=step_tools if step_tools else None,
                        tool_choice="auto" if step_tools else None,
                        temperature=0.3,
                        max_tokens=2048,
                        timeout=120
                    )
                    msg = resp.choices[0].message
                    if msg.content:
                        cleaned = msg.content
                        if '<think>' in cleaned:
                            cleaned = re.sub(r'<think>.*?</think>', '', cleaned, flags=re.DOTALL).strip()
                        step_result_parts.append(cleaned)
                    if not msg.tool_calls:
                        break
                    asst_msg = {"role": "assistant", "content": msg.content}
                    msg_dict = msg.model_dump()
                    if hasattr(msg.tool_calls, 'model_dump'):
                        asst_msg["tool_calls"] = msg.tool_calls.model_dump()
                    else:
                        asst_msg["tool_calls"] = [{"id": tc.id, "type": tc.type, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in msg.tool_calls]
                    messages.append(asst_msg)
                    for tc in msg.tool_calls:
                        tool_name = tc.function.name
                        tool_args = json.loads(tc.function.arguments)
                        result_text = f"[步骤{i}:{step_role}] 调用 {tool_name}"
                        step_result_parts.append(f"[工具: {tool_name}]")
                        messages.append({"role": "tool", "tool_call_id": tc.id, "content": "工具已调用"})
                    # 保存中间进度
                    wf_store = get_ns("workflows", user_id)
                    workflows = wf_store.get()
                    wf = workflows.get(name, {})
                    wf["results"][step.get("output_key", f"step_{i}")] = "\n".join(step_result_parts)
                    wf["current_step"] = i
                    workflows[name] = wf
                    wf_store.set(workflows)

                step_output = "\n".join(step_result_parts)
            except Exception as e:
                step_output = f"[错误] 步骤{i}执行失败: {str(e)}"
                wf_store = get_ns("workflows", user_id)
                workflows = wf_store.get()
                wf = workflows.get(name, {})
                wf["errors"].append({"step": i, "error": str(e)})
                workflows[name] = wf
                wf_store.set(workflows)

            # 保存步骤结果
            wf_store = get_ns("workflows", user_id)
            workflows = wf_store.get()
            wf = workflows.get(name, {})
            wf["results"][step.get("output_key", f"step_{i}")] = step_output
            wf["current_step"] = i + 1
            workflows[name] = wf
            wf_store.set(workflows)

            # 工具调用通知
            push_store = get_ns("heartbeat", user_id)
            push_data = push_store.get()
            pending = push_data.get("pending_messages", [])
            pending.append({"msg": f"[工作流 {name}] 步骤{i+1}/{len(wf['steps'])} 完成 ({step_role})", "time": datetime.now().isoformat()})
            push_data["pending_messages"] = pending
            push_store.set(push_data)

        # 全部完成
        wf_store = get_ns("workflows", user_id)
        workflows = wf_store.get()
        wf = workflows.get(name, {})
        has_errors = len(wf.get("errors", [])) > 0
        wf["status"] = "failed" if has_errors else "completed"
        workflows[name] = wf
        wf_store.set(workflows)

        # 推送完成通知
        push_store = get_ns("heartbeat", user_id)
        push_data = push_store.get()
        pending = push_data.get("pending_messages", [])
        status = "完成" if wf["status"] == "completed" else "失败"
        pending.append({"msg": f"[工作流] {name} 执行{status}({len(wf['steps'])}步)", "time": datetime.now().isoformat()})
        push_data["pending_messages"] = pending
        push_store.set(push_data)

    t = threading.Thread(target=_run_workflow, name=f"wf_{user_id}_{name}", daemon=True)
    t.start()
    return {"ok": True, "workflow": name, "status": "running"}

@app.get("/engine/workflow/list")
def workflow_list(user_id: str = Query("")):
    wf_store = get_ns("workflows", user_id)
    return wf_store.get()

@app.get("/engine/workflow/status")
def workflow_status(name: str = Query(...), user_id: str = Query("")):
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    wf = workflows.get(name)
    if not wf:
        return {"error": "工作流不存在"}
    return wf

@app.get("/engine/workflow/delete")
def workflow_delete(name: str = Query(...), user_id: str = Query("")):
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    if name not in workflows:
        return {"ok": False, "error": "不存在"}
    del workflows[name]
    wf_store.set(workflows)
    return {"ok": True}

@app.get("/engine/workflow/roles")
def workflow_roles(user_id: str = Query("")):
    """返回可用角色列表(供前端下拉选择)"""
    return {"roles": [{"id": k, "label": v["label"], "desc": v["desc"]} for k, v in AGENT_ROLES.items()]}


# ==================== 引擎层 API ====================

@app.get("/engine/v2/exec-policy/evaluate")
def exec_policy_evaluate(
    domain: str = Query("exec"),
    target: str = Query(...),
    user_id: str = Query("")
):
    """评估一个操作是否需要审批"""
    policy = exec_policy
    decision = policy.evaluate(domain, target)
    return {
        "ok": True,
        "domain": domain,
        "target": target,
        "decision": decision.kind,
        "reason": decision.reason,
        "matched_rule": decision.matched_rule,
        "matched_priority": decision.matched_priority,
    }


@app.get("/engine/v2/exec-policy/rules")
def exec_policy_rules(
    domain: str = Query(""),
    user_id: str = Query("")
):
    """获取策略规则列表"""
    return {"ok": True, "rules": exec_policy.list_rules(domain), "count": len(exec_policy.rules)}


@app.get("/engine/v2/exec-policy/add")
def exec_policy_add(
    domain: str = Query("exec"),
    pattern: str = Query(...),
    decision_kind: str = Query("skip"),
    reason: str = Query(""),
    priority: int = Query(2),
    description: str = Query(""),
    user_id: str = Query("")
):
    """添加策略规则"""
    if decision_kind == "skip":
        decision = ExecDecision.skip()
    elif decision_kind == "forbidden":
        decision = ExecDecision.forbidden(reason or "禁止操作")
    else:
        decision = ExecDecision.needs_approval(reason or "需要审批")
    rule = exec_policy.add_rule(domain, pattern, decision, priority=priority, description=description)
    return {"ok": True, "rule": rule.to_dict()}


@app.get("/engine/v2/exec-policy/remove")
def exec_policy_remove(
    domain: str = Query("exec"),
    pattern: str = Query(...),
    priority: int = Query(-1),
    user_id: str = Query("")
):
    """移除策略规则"""
    p = Priority(priority) if priority >= 0 else None
    removed = exec_policy.remove_rule(domain, pattern, p)
    return {"ok": removed}


@app.get("/engine/v2/exec-policy/reset")
def exec_policy_reset(user_id: str = Query("")):
    """重置为默认规则"""
    exec_policy.reset_to_defaults()
    return {"ok": True, "rules": len(exec_policy.rules)}


# ── 推测执行 API ─────────────────────────────────────

@app.get("/engine/v2/speculate")
def speculate(
    prompt: str = Query(...),
    user_id: str = Query("")
):
    """推测指令需要的工具调用"""
    result = speculation_engine.predict(prompt)
    return {
        "ok": True,
        "suggested_tools": [
            {"tool_name": t.tool_name, "confidence": t.confidence,
             "estimated_duration_ms": t.estimated_duration_ms}
            for t in result.suggested_tools
        ],
        "estimated_savings_ms": result.estimated_savings_ms,
    }


@app.get("/engine/v2/speculate/confirm")
def speculate_confirm(user_id: str = Query("")):
    """确认推测结果（命中）"""
    speculation_engine.confirm()
    return {"ok": True, "state": speculation_engine.state.value}


@app.get("/engine/v2/speculate/abort")
def speculate_abort(
    reason: str = Query("用户中止"),
    user_id: str = Query("")
):
    """中止推测"""
    speculation_engine.abort(reason=reason)
    return {"ok": True, "state": speculation_engine.state.value}


@app.get("/engine/v2/speculate/status")
def speculate_status(user_id: str = Query("")):
    """推测引擎状态"""
    return {"ok": True, **speculation_engine.summary()}


@app.get("/engine/v2/speculate/toggle")
def speculate_toggle(
    enabled: bool = Query(True),
    yolo: bool = Query(False),
    user_id: str = Query("")
):
    """切换推测引擎"""
    if enabled:
        speculation_engine.enable(yolo_mode=yolo)
    else:
        speculation_engine.disable()
    return {"ok": True, "enabled": enabled, "yolo_mode": yolo}


# ── 重试机制 API ─────────────────────────────────────

@app.get("/engine/v2/retry/status")
def retry_status(
    task_id: str = Query(""),
    user_id: str = Query("")
):
    """查询重试任务状态"""
    if task_id:
        meta = retry_engine.get_status(task_id)
        if not meta:
            return {"ok": False, "error": "Task not found (may have completed)"}
        return {"ok": True, "task": meta.to_dict()}
    return {"ok": True, **retry_engine.summary()}


@app.get("/engine/v2/retry/list")
def retry_list(
    status: str = Query(""),
    user_id: str = Query("")
):
    """列出重试任务"""
    if status:
        try:
            s = RetryStatus(status)
            tasks = retry_engine.list_tasks(s)
        except ValueError:
            tasks = retry_engine.list_active()
    else:
        tasks = retry_engine.list_active()
    return {"ok": True, "tasks": [t.to_dict() for t in tasks], "count": len(tasks)}


@app.get("/engine/v2/retry/config")
def retry_config(
    max_attempts: int = Query(3),
    backoff_base_ms: int = Query(500),
    user_id: str = Query("")
):
    """配置重试参数"""
    retry_engine.max_attempts = max_attempts
    retry_engine._default_backoff_base_ms = backoff_base_ms
    return {"ok": True, "max_attempts": max_attempts, "backoff_base_ms": backoff_base_ms}


# ── 工具注册表 API ───────────────────────────────────

@app.get("/engine/v2/tools/list")
def tools_list(
    capability: str = Query(""),
    approval: str = Query(""),
    tag: str = Query(""),
    role: str = Query(""),
    user_id: str = Query("")
):
    """列出工具（支持按能力/审批要求/标签/角色过滤）"""
    if role:
        tools = tool_registry.to_openai_tools(role=role)
        return {"ok": True, "tools": tools, "count": len(tools), "format": "openai"}

    filters = {}
    if capability:
        try:
            filters["capabilities"] = [Capability[capability]]
        except KeyError:
            pass
    if approval:
        try:
            filters["approval"] = ApprovalKind(approval)
        except ValueError:
            pass
    if tag:
        tools = tool_registry.list_by_tag(tag)
    elif filters:
        tools = tool_registry.filter(**filters)
    else:
        tools = tool_registry.list_enabled()
    return {"ok": True, "tools": [t.to_dict() for t in tools], "count": len(tools)}


@app.get("/engine/v2/tools/openai")
def tools_openai(
    role: str = Query(""),
    user_id: str = Query("")
):
    """导出工具为 OpenAI tool format"""
    return {"ok": True, "tools": tool_registry.to_openai_tools(role=role)}


@app.get("/engine/v2/tools/summary")
def tools_summary(user_id: str = Query("")):
    """工具注册表摘要"""
    return {"ok": True, **tool_registry.summary()}


# ── 事件帧 API ───────────────────────────────────────

_session_flows: dict = {}


@app.get("/engine/v2/events/create")
def events_create(
    session_id: str = Query(""),
    user_id: str = Query("")
):
    """创建新的事件流会话"""
    builder = EventFlowBuilder(session_id=session_id)
    _session_flows[builder.session_id] = builder
    return {"ok": True, "session_id": builder.session_id}


@app.get("/engine/v2/events/emit")
def events_emit(
    event_type: str = Query(...),
    data: str = Query("{}"),
    session_id: str = Query(""),
    user_id: str = Query("")
):
    """发送一个事件帧"""
    try:
        etype = EventType(event_type)
        parsed = json.loads(data)
    except (ValueError, json.JSONDecodeError) as e:
        return {"ok": False, "error": str(e)}

    builder = _session_flows.get(session_id)
    if not builder:
        builder = EventFlowBuilder(session_id=session_id)
        _session_flows[session_id] = builder

    frame = builder.emit(etype, parsed)
    event_log.record(frame)
    return {"ok": True, "event_id": frame.event_id, "sequence": frame.sequence}


@app.get("/engine/v2/events/stream")
def events_stream(
    session_id: str = Query(""),
    user_id: str = Query("")
):
    """获取事件流（JSON Lines）"""
    builder = _session_flows.get(session_id)
    if not builder:
        return {"ok": False, "error": "Session not found"}
    return {"ok": True, "events": builder.to_events_list(), "summary": builder.summary()}


@app.get("/engine/v2/events/log")
def events_log(
    event_type: str = Query(""),
    session_id: str = Query(""),
    limit: int = Query(50),
    user_id: str = Query("")
):
    """查询事件日志"""
    etype = EventType(event_type) if event_type else None
    results = event_log.query(event_type=etype, session_id=session_id, limit=limit)
    return {"ok": True, "events": [e.to_dict() for e in results], "count": len(results)}


# ==================== 启动时恢复Cron + 修复Stuck代理 ====================
@app.on_event("startup")
async def startup():
    # 恢复全局 cron (无user_id)
    jobs = cron_store.get()
    for name, job in jobs.items():
        if job.get("enabled"):
            _start_cron_job(name, "")
            print(f"[引擎] Cron 已恢复(全局): {name}")
    # 恢复各用户的 cron
    for f in ENGINE_DIR.glob("user_*_cron.json"):
        try:
            uid = f.stem.split("_", 1)[1].rsplit("_", 1)[0]
            user_jobs = json.loads(f.read_text(encoding="utf8"))
            for name, job in user_jobs.items():
                if job.get("enabled"):
                    _start_cron_job(name, uid)
                    print(f"[引擎] Cron 已恢复(用户{uid}): {name}")
        except:
            pass

    # ★ 修复引擎重启后遗留的 "running" 状态子代理
    from pathlib import Path as _Path
    for f in ENGINE_DIR.glob("*_agents.json"):
        try:
            data = json.loads(f.read_text(encoding="utf8"))
            changed = False
            for name, agent in data.items():
                if agent.get("status") == "running":
                    agent["status"] = "failed"
                    agent["error"] = "引擎重启,正在运行的子代理已终止"
                    changed = True
                    print(f"[引擎] 修复stuck代理: {f.stem}/{name} (running→failed)")
            if changed:
                f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf8")
        except:
            pass

    # ★ 启动定期清理任务(每5分钟检查stuck代理)
    def _periodic_cleanup():
        while True:
            time.sleep(300)  # 5分钟
            try:
                now = time.time()
                for f in ENGINE_DIR.glob("*_agents.json"):
                    try:
                        data = json.loads(f.read_text(encoding="utf8"))
                        changed = False
                        for name, agent in list(data.items()):
                            started = agent.get("_started_at", 0)
                            status = agent.get("status", "")
                            # running超30分钟 → failed
                            if status == "running" and started and (now - started) > 1800:
                                agent["status"] = "failed"
                                agent["error"] = "子代理执行超时(超过30分钟)"
                                changed = True
                                print(f"[引擎] 超时清理: {f.stem}/{name}")
                            # completed/failed超24小时 → 删除
                            if status in ("completed", "failed"):
                                created_str = agent.get("created", "")
                                if not created_str:
                                    continue
                                try:
                                    created = datetime.fromisoformat(created_str).timestamp()
                                    if (now - created) > 86400:  # 24小时
                                        if "result" in agent and len(agent.get("result", "")) > 10000:
                                            # 结果很大的,只保留摘要
                                            agent["result"] = agent["result"][:500] + f"\n\n[自动截断: 原结果共{len(agent['result'])}字符]"
                                            changed = True
                                        else:
                                            del data[name]
                                            changed = True
                                            print(f"[引擎] 自动删除过期代理: {f.stem}/{name}")
                                except:
                                    pass
                        if changed:
                            f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf8")
                    except:
                        pass
            except:
                pass

    t = threading.Thread(target=_periodic_cleanup, name="periodic_cleanup", daemon=True)
    t.start()
    print("[引擎] 定期清理线程已启动(每5分钟)")

# ==================== 前端心跳注入 ====================
_heartbeat_html = """
<script>
// OneAPIChat Engine 心跳
(function(){
    var ENGINE_URL = window.location.origin + '/oneapichat/';
    var HEARTBEAT_INTERVAL = 15000; // 15秒
    var CUSTOM_PROMPT = '';
    var token = (typeof localStorage !== 'undefined') ? localStorage.getItem('authToken') : '';

    setInterval(function(){
        var token = (typeof localStorage !== 'undefined') ? localStorage.getItem('authToken') : '';
        var authSuffix = token ? '&auth_token=' + encodeURIComponent(token) : '';
        fetch(ENGINE_URL + 'engine_api.php?action=heartbeat' + authSuffix)
            .then(function(r){ return r.json(); })
            .then(function(d){
                if(d.pending && d.pending.length > 0){
                    for(var i=0; i<d.pending.length; i++){
                        var msg = d.pending[i].msg || d.pending[i];
                        // 插入为system消息
                        if(window.chatHistory && window.currentChatId){
                            window.chatHistory[window.currentChatId].push({
                                role: 'system',
                                content: '【引擎通知】' + msg
                            });
                        }
                    }
                }
            })
            .catch(function(){});
    }, HEARTBEAT_INTERVAL);
})();
</script>
"""

# ==================== 启动 ====================
# ==================== 流式聊天后端 (SSE) ====================
import threading
import queue

def _stream_openai_to_sse(request_data: dict, chat_id: str, msg_id: str, user_id: str):
    """在后台线程中将 OpenAI 流式响应转为 SSE，实时保存进度到 SQLite"""
    from openai import OpenAI
    store = get_chat_store(user_id)
    store.init_progress(msg_id, chat_id, request_data.get('model', ''))
    full_text = ''
    reasoning_text = ''
    tool_calls = []
    usage = None
    error = ''
    seq = 0

    def sse_event(data_str: str, event_type: str = 'chunk'):
        return f"event: {event_type}\ndata: {data_str}\n\n"

    try:
        client = OpenAI(api_key=request_data.get('api_key', ''),
                        base_url=request_data.get('base_url', '').strip().rstrip('/') or None)
        model = request_data.get('model', 'deepseek-chat')
        messages = request_data.get('messages', [])
        tools = request_data.get('tools', None)
        stream_params = {'model': model, 'messages': messages, 'stream': True}
        if tools:
            stream_params['tools'] = tools
        if request_data.get('reasoning'):
            stream_params['reasoning'] = request_data.get('reasoning')
        # 发送初始事件
        yield sse_event(json.dumps({'type': 'start', 'msg_id': msg_id}))

        stream = client.chat.completions.create(**stream_params)
        for chunk in stream:
            delta = chunk.choices[0].delta
            seq += 1

            # 内容增量
            content_delta = delta.content or ''
            if content_delta:
                full_text += content_delta
                store.write_chunk(msg_id, 'content', content_delta)
                yield sse_event(json.dumps({'type': 'content', 'delta': content_delta, 'seq': seq}))

            # 思考增量
            reasoning_delta = delta.reasoning_content or ''
            if reasoning_delta:
                reasoning_text += reasoning_delta
                store.write_chunk(msg_id, 'reasoning', reasoning_delta)
                yield sse_event(json.dumps({'type': 'reasoning', 'delta': reasoning_delta, 'seq': seq}))

            # Tool calls
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    tc_dict = {'id': tc.id, 'type': tc.type,
                                'function': {'name': tc.function.name,
                                             'arguments': tc.function.arguments or ''}}
                    tool_calls.append(tc_dict)
                    yield sse_event(json.dumps({'type': 'tool_call', 'delta': tc_dict, 'seq': seq}))

            # Usage
            if chunk.usage:
                try:
                    usage = chunk.usage.model_dump()
                except:
                    try:
                        usage = json.loads(chunk.usage.model_dump_json())
                    except:
                        usage = dict(chunk.usage)

        # 流结束
        store.finish_stream(msg_id, full_text, reasoning_text, tool_calls, usage)
        yield sse_event(json.dumps({'type': 'done', 'full_text': full_text, 'reasoning_text': reasoning_text,
                                     'tool_calls': tool_calls, 'usage': usage}))

    except Exception as e:
        error = str(e)
        print(f"[stream] error: {error}")
        store.finish_stream(msg_id, full_text, reasoning_text, tool_calls, usage, error)
        yield sse_event(json.dumps({'type': 'error', 'error': error}))

def _run_stream(request_data: dict, chat_id: str, msg_id: str, user_id: str, result_queue):
    """后台线程运行器,逐块转发SSE事件,不缓存"""
    try:
        for chunk in _stream_openai_to_sse(request_data, chat_id, msg_id, user_id):
            result_queue.put(('chunk', chunk))
        result_queue.put(('done', None))
    except Exception as e:
        result_queue.put(('error', str(e)))

@app.post("/engine/chat/stream")
async def chat_stream(request: Request, user_id: str = Query("")):
    """
    后端流式聊天端点:
    - 接收消息，转发给 OpenAI，流式返回 SSE
    - 实时将进度保存到 SQLite（刷新恢复）
    """
    try:
        body = await request.json()
    except:
        return {"error": "invalid JSON body"}

    chat_id = body.get('chat_id') or ''
    msg_id = body.get('msg_id') or f"msg_{int(time.time()*1000)}"
    request_data = body.get('request', {})

    if not request_data.get('api_key'):
        return {"error": "api_key required"}

    # 启动后台线程执行流式请求（避免 FastAPI 线程阻塞）
    result_queue = queue.Queue()
    t = threading.Thread(target=_run_stream, args=(request_data, chat_id, msg_id, user_id, result_queue), daemon=True)
    t.start()

    async def event_generator():
        # 前端通过 EventSource 接收 SSE
        while True:
            try:
                status, data = result_queue.get(timeout=60)
                if status == 'error':
                    yield f"event: error\ndata: {json.dumps({'error': data})}\n\n"
                    break
                elif status == 'done':
                    break
                elif status == 'chunk':
                    yield data
                    await asyncio.sleep(0.001)
            except queue.Empty:
                yield f"event: timeout\ndata: {json.dumps({'error': 'stream timeout'})}\n\n"
                break

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/engine/chat/progress/{msg_id}")
async def chat_progress(msg_id: str, user_id: str = Query("")):
    """查询流式进度（用于刷新恢复）"""
    store = get_chat_store(user_id)
    return store.get_progress(msg_id)


# ==================== Agent 记忆/人格/身份/心跳 系统 ====================

MEMORY_DIR = ENGINE_DIR / "memory"
MEMORY_DIR.mkdir(parents=True, exist_ok=True)

def _get_memory_file(filename: str, user_id: str = "") -> Path:
    """获取用户隔离的记忆文件路径"""
    if user_id:
        return MEMORY_DIR / f"user_{user_id}_{filename}"
    return MEMORY_DIR / filename


def _read_memory_json(filename: str, user_id: str = "") -> dict:
    """读取记忆文件,返回 dict"""
    fp = _get_memory_file(filename, user_id)
    try:
        return json.loads(fp.read_text(encoding="utf8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write_memory_json(filename: str, data: dict, user_id: str = "") -> bool:
    """原子写入记忆文件"""
    fp = _get_memory_file(filename, user_id)
    tmp = fp.with_suffix('.tmp')
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf8")
        tmp.replace(fp)
        return True
    except Exception as e:
        print(f"[AgentMemory] 写入失败 {filename}: {e}")
        return False


# ── 人格 API ──────────────────────────────────────

@app.post("/engine/agent/persona/save")
async def agent_persona_save(request: Request, user_id: str = Query("")):
    """保存 Agent 人格定义"""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "无效的 JSON 请求体")
    if not body or not isinstance(body, dict):
        raise HTTPException(400, "body 必须为非空 JSON 对象")
    body["updated_at"] = datetime.now().isoformat()
    if not body.get("created_at"):
        body["created_at"] = body["updated_at"]
    ok = _write_memory_json("agent_persona.json", body, user_id)
    return {"ok": ok, "updated_at": body["updated_at"]}


@app.get("/engine/agent/persona/load")
def agent_persona_load(user_id: str = Query("")):
    """加载 Agent 人格定义"""
    data = _read_memory_json("agent_persona.json", user_id)
    if not data:
        data = {"name": "AI助手", "style": "简洁、直接、实用", "preferences": {"language": "zh-CN", "response_style": "concise"}, "updated_at": ""}
    return {"ok": True, "persona": data}


# ── 记忆 API ──────────────────────────────────────

@app.post("/engine/agent/memory/save")
async def agent_memory_save(request: Request, user_id: str = Query("")):
    """保存一条记忆条目"""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "无效的 JSON 请求体")
    if not body or not isinstance(body, dict):
        raise HTTPException(400, "body 必须为非空 JSON 对象")
    key = body.get("key", "")
    content = body.get("content", "")
    tags = body.get("tags", [])
    if not key or not content:
        raise HTTPException(400, "key 和 content 不能为空")
    data = _read_memory_json("agent_memory.json", user_id)
    if "entries" not in data:
        data["entries"] = []
    found = False
    for entry in data["entries"]:
        if entry.get("key") == key:
            entry["content"] = content
            entry["tags"] = tags if isinstance(tags, list) else []
            entry["updated_at"] = datetime.now().isoformat()
            found = True
            break
    if not found:
        data["entries"].append({"key": key, "content": content, "tags": tags if isinstance(tags, list) else [], "created_at": datetime.now().isoformat(), "updated_at": datetime.now().isoformat()})
    data["updated_at"] = datetime.now().isoformat()
    if not data.get("created_at"):
        data["created_at"] = data["updated_at"]
    data["version"] = data.get("version", 1)
    ok = _write_memory_json("agent_memory.json", data, user_id)
    return {"ok": ok, "key": key, "entries_count": len(data["entries"])}


@app.get("/engine/agent/memory/load")
def agent_memory_load(query: str = Query(""), user_id: str = Query("")):
    """加载记忆,支持关键词模糊匹配"""
    data = _read_memory_json("agent_memory.json", user_id)
    entries = data.get("entries", [])
    if query:
        q = query.lower()
        matched = [e for e in entries if q in e.get("key", "").lower() or q in e.get("content", "").lower() or any(q in (tag or "").lower() for tag in e.get("tags", []))]
        return {"ok": True, "entries": matched, "total": len(matched), "query": query}
    return {"ok": True, "entries": entries, "total": len(entries)}


# ── 用户身份 API ──────────────────────────────────

@app.post("/engine/agent/identity/save")
async def agent_identity_save(request: Request, user_id: str = Query("")):
    """保存用户身份信息"""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "无效的 JSON 请求体")
    if not body or not isinstance(body, dict):
        raise HTTPException(400, "body 必须为非空 JSON 对象")
    body["updated_at"] = datetime.now().isoformat()
    if not body.get("created_at"):
        body["created_at"] = body["updated_at"]
    if not body.get("name") and user_id:
        body["name"] = f"User({user_id[:12]})"
    ok = _write_memory_json("agent_identity.json", body, user_id)
    return {"ok": ok, "updated_at": body["updated_at"]}


@app.get("/engine/agent/identity/load")
def agent_identity_load(user_id: str = Query("")):
    """加载用户身份信息"""
    data = _read_memory_json("agent_identity.json", user_id)
    if not data:
        data = {"name": "", "timezone": "Asia/Shanghai", "language": "zh-CN", "notes": ""}
    return {"ok": True, "identity": data}


# ── 心跳 API ──────────────────────────────────────

@app.post("/engine/agent/heartbeat")
async def agent_heartbeat(request: Request, user_id: str = Query("")):
    """更新 Agent 心跳状态"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    state = body.get("state", "active")
    mood = body.get("mood", "neutral")
    data = _read_memory_json("agent_heartbeat.json", user_id)
    data["state"] = state
    data["mood"] = mood
    data["last_seen"] = time.time()
    data["updated_at"] = datetime.now().isoformat()
    data["conversation_count"] = data.get("conversation_count", 0) + (1 if state == "active" else 0)
    if body.get("chat_id"):
        data["last_active_chat"] = body["chat_id"]
    if body.get("pending_tasks"):
        data["pending_tasks"] = body["pending_tasks"]
    ok = _write_memory_json("agent_heartbeat.json", data, user_id)
    return {"ok": ok, "state": state, "last_seen": data["last_seen"]}


@app.get("/engine/agent/heartbeat/status")
def agent_heartbeat_status(user_id: str = Query("")):
    """读取 Agent 心跳状态"""
    data = _read_memory_json("agent_heartbeat.json", user_id)
    if not data:
        data = {"state": "idle", "last_seen": 0, "conversation_count": 0}
    now = time.time()
    last_seen = data.get("last_seen", 0)
    if last_seen and (now - last_seen) > 300:
        data["state"] = "idle"
    data["_age_seconds"] = int(now - last_seen) if last_seen else -1
    return {"ok": True, "heartbeat": data}


@app.get("/engine/agent/memory/delete")
def agent_memory_delete(key: str = Query(...), user_id: str = Query("")):
    """删除一条记忆条目"""
    data = _read_memory_json("agent_memory.json", user_id)
    entries = data.get("entries", [])
    before = len(entries)
    data["entries"] = [e for e in entries if e.get("key") != key]
    removed = before - len(data["entries"])
    if removed > 0:
        data["updated_at"] = datetime.now().isoformat()
        _write_memory_json("agent_memory.json", data, user_id)
    return {"ok": True, "removed": removed}


# ==================== 浏览器工具 ====================

@app.on_event("startup")
async def _startup_browser():
    """启动时初始化浏览器连接并注册浏览器工具"""
    # 注册浏览器工具到全局注册表
    try:
        from engine.tool_registry import register_browser_tools
        register_browser_tools(tool_registry)
        print("[引擎] 浏览器工具已注册")
    except Exception as e:
        print(f"[引擎] 浏览器工具注册失败: {e}")
    # 连接浏览器
    try:
        from engine.browser import get_browser_manager
        bm = get_browser_manager()
        await bm.connect()
        print("[引擎] 浏览器管理器已初始化")
    except Exception as e:
        print(f"[引擎] 浏览器管理器初始化失败(可忽略): {e}")


@app.get("/engine/browser/status")
async def browser_status():
    """浏览器连接状态"""
    from engine.browser import get_browser_manager
    bm = get_browser_manager()
    try:
        if not bm._connected:
            await bm.connect()
        return {"ok": True, "connected": True, "cdp": bm.cdp_url}
    except Exception as e:
        return {"ok": False, "connected": False, "error": str(e)}


@app.post("/engine/browser/navigate")
async def browser_navigate(request: Request):
    body = await request.json()
    url = body.get("url", "")
    if not url:
        return {"ok": False, "error": "缺少 url 参数"}
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.navigate(url)
    return result


@app.get("/engine/browser/screenshot")
async def browser_screenshot():
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.screenshot()
    return result


@app.post("/engine/browser/click")
async def browser_click(request: Request):
    body = await request.json()
    selector = body.get("selector", "")
    if not selector:
        return {"ok": False, "error": "缺少 selector 参数"}
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.click(selector)
    return result


@app.post("/engine/browser/type")
async def browser_type(request: Request):
    body = await request.json()
    selector = body.get("selector", "")
    text = body.get("text", "")
    if not selector:
        return {"ok": False, "error": "缺少 selector 参数"}
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.type_text(selector, text)
    return result


@app.get("/engine/browser/content")
async def browser_content():
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.get_content()
    return result


@app.get("/engine/browser/snapshot")
async def browser_snapshot():
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.get_snapshot()
    return result


@app.post("/engine/browser/js")
async def browser_js(request: Request):
    body = await request.json()
    code = body.get("code", "")
    if not code:
        return {"ok": False, "error": "缺少 code 参数"}
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.execute_js(code)
    return result


@app.post("/engine/browser/page/new")
async def browser_page_new():
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.new_page()
    return result


@app.post("/engine/browser/page/close")
async def browser_page_close():
    from engine.browser import ensure_browser_connected
    bm = await ensure_browser_connected()
    result = await bm.close_page()
    return result


@app.post("/engine/video_edit")
async def video_edit_endpoint(request: Request):
    """视频剪辑 HTTP 端点"""
    try:
        body = await request.json()
        action = body.get("action", "")
        params = body.get("params", {})
        input_path = body.get("input_path", "")
        output_path = body.get("output_path", "/tmp/video_output.mp4")
        if not input_path:
            return JSONResponse({"error": "未提供 input_path"}, status_code=400)
        # ★ 自动转换相对路径为绝对路径(支持上传文件的 URL 格式)
        if not os.path.exists(input_path) and input_path.startswith("/"):
            # 处理 /oneapichat/uploads/... 格式
            if input_path.startswith("/oneapichat/"):
                input_path = PROJECT_ROOT + "/" + input_path.replace("/oneapichat/", "", 1)
            elif input_path.startswith("/uploads/"):
                input_path = PROJECT_ROOT + input_path
            elif input_path.startswith("http"):
                return JSONResponse({"error": "不支持远程URL,请先用 server_exec + curl 下载到服务器"}, status_code=400)
            else:
                input_path = PROJECT_ROOT + input_path
        if not os.path.exists(input_path) and action not in ("tts", "voice"):
            return JSONResponse({"error": f"文件不存在: {input_path}"}, status_code=404)
        if action == "info":
            cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", input_path]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            return {"result": r.stdout}
        elif action == "trim":
            start = params.get("start", 0)
            end = params.get("end", None)
            from moviepy import VideoFileClip
            clip = VideoFileClip(input_path)
            if end: clip = clip.subclipped(start, end)
            else: clip = clip.subclipped(start)
            clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
            clip.close()
            return {"result": f"裁剪完成: {output_path}"}
        elif action == "speed":
            factor = float(params.get("factor", 1.0))
            from moviepy import VideoFileClip, vfx
            clip = VideoFileClip(input_path)
            clip = clip.with_effects([vfx.MultiplySpeed(factor)])
            clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
            clip.close()
            return {"result": f"调速完成 (x{factor}): {output_path}"}
        elif action == "resize":
            width = params.get("width", 0); height = params.get("height", 0)
            from moviepy import VideoFileClip
            clip = VideoFileClip(input_path)
            if width and height: clip = clip.resized((width, height))
            elif width: clip = clip.resized(width=width)
            elif height: clip = clip.resized(height=height)
            clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
            clip.close()
            return {"result": f"缩放完成: {output_path}"}
        elif action == "audio":
            from moviepy import VideoFileClip
            clip = VideoFileClip(input_path)
            audio_output = output_path + ".mp3" if not output_path.endswith(".mp3") else output_path
            if clip.audio: clip.audio.write_audiofile(audio_output)
            clip.close()
            return {"result": f"音频提取完成: {audio_output}"}
        elif action == "concat":
            files = params.get("files", [])
            if not files: return JSONResponse({"error": "concat 需要 files 数组"}, status_code=400)
            from moviepy import VideoFileClip, concatenate_videoclips
            clips = [VideoFileClip(f) for f in files]
            final = concatenate_videoclips(clips, method="compose")
            final.write_videofile(output_path, codec="libx264", audio_codec="aac")
            for c in clips: c.close()
            final.close()
            return {"result": f"拼接完成: {output_path}"}
        elif action == "overlay":
            overlay_path = params.get("overlay_path", "")
            if not overlay_path or not os.path.exists(overlay_path):
                return JSONResponse({"error": "overlay_path 无效"}, status_code=400)
            x, y = params.get("x", 10), params.get("y", 10)
            scale = params.get("scale", 0.3)
            from moviepy import VideoFileClip, CompositeVideoClip
            clip = VideoFileClip(input_path)
            ov = VideoFileClip(overlay_path).resized(scale).with_position((x, y))
            final = CompositeVideoClip([clip, ov])
            final.write_videofile(output_path, codec="libx264", audio_codec="aac")
            clip.close(); ov.close(); final.close()
            return {"result": f"画中画完成: {output_path}"}
        elif action == "text":
            result = _apply_subtitle(input_path, output_path, params)
            return {"result": result}
        elif action == "rotate":
            angle = float(params.get("angle", 90))
            from moviepy import VideoFileClip, vfx
            clip = VideoFileClip(input_path)
            clip = clip.with_effects([vfx.Rotate(angle)])
            clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
            clip.close()
            return {"result": f"旋转完成 ({angle}°): {output_path}"}
        elif action in ("filter", "video_filter"):
            return {"result": _apply_ffmpeg_filter(input_path, output_path, params)}
        elif action in ("transition", "video_transition"):
            return {"result": _apply_ffmpeg_transition(input_path, output_path, params)}
        elif action == "tts":
            return {"result": _apply_tts(params)}
        elif action == "voice":
            audio_path2 = params.get("audio_path", "")
            if not audio_path2:
                tts_result2 = _apply_tts(params)
                if "失败" in tts_result2 or "异常" in tts_result2:
                    return {"error": tts_result2}
                audio_path2 = tts_result2.split(": ")[1].split(" ")[0] if ": " in tts_result2 else "/tmp/tts_output.mp3"
            return {"result": _apply_voice_to_video(input_path, audio_path2, output_path, params)}
        elif action == "compose":
            return {"result": _apply_compose(input_path, output_path, params)}
        elif action == "crop":
            return {"result": _apply_crop(input_path, output_path, params)}
        elif action == "reverse":
            return {"result": _apply_reverse(input_path, output_path, params)}
        elif action == "mute":
            return {"result": _apply_mute(input_path, output_path, params)}
        elif action == "bgm":
            return {"result": _apply_bgm(input_path, output_path, params)}
        elif action == "enhance":
            return {"result": _apply_enhance(input_path, output_path, params)}
        elif action == "gif":
            return {"result": _apply_gif(input_path, output_path, params)}
        elif action == "silent_cut":
            return {"result": _apply_silent_cut(input_path, output_path, params)}
        elif action == "style":
            return {"result": _apply_subtitle_style(input_path, output_path, params)}
        elif action == "frames":
            # 提取关键帧并返回 base64 数组
            count = int(params.get("count", 3))
            duration = float(params.get("duration", 10))
            scale = int(params.get("scale", 640))
            interval = max(1, int(duration / count))
            import base64 as b64
            cmd = ["ffmpeg", "-y", "-i", input_path, "-vframes", str(count),
                   "-vf", f"fps=1/{interval},scale={scale}:-1",
                   "-f", "image2pipe", "-q:v", "3", "-vcodec", "mjpeg", "-"]
            r = subprocess.run(cmd, capture_output=True, timeout=60)
            if r.returncode != 0 or len(r.stdout) < 100:
                return JSONResponse({"error": f"截图失败: {r.stderr.decode()[:200]}"}, status_code=500)
            from moviepy import VideoFileClip
            clip = VideoFileClip(input_path)
            frame_count = 0
            frames = []
            pos = 0; buf = r.stdout
            clips_total = []
            while pos < len(buf) - 4:
                soi = buf.find(b'\xff\xd8', pos)
                if soi < 0: break
                eoi = buf.find(b'\xff\xd9', soi)
                if eoi < 0: break
                jpg = buf[soi:eoi+2]
                frames.append("data:image/jpeg;base64," + b64.b64encode(jpg).decode())
                pos = eoi + 2
            clip.close()
            return {"result": json.dumps({"frames": frames, "count": len(frames)})}
        else:
            return JSONResponse({"error": f"未知操作: {action}"}, status_code=400)
    except ImportError as e:
        return JSONResponse({"error": f"缺少依赖: {str(e)}"}, status_code=503)
    except Exception as e:
        return JSONResponse({"error": f"视频剪辑失败: {str(e)}"}, status_code=500)


if __name__ == "__main__":
    port = int(os.getenv("ENGINE_PORT", "8766"))
    print(f"[引擎] 启动 http://0.0.0.0:{port}")
    print(f"[引擎] Cron 任务: {list(cron_store.get().keys())}")
    print(f"[引擎] 子代理: {list(agent_store.get().keys())}")
    uvicorn.run(app, host="0.0.0.0", port=port)
