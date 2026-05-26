# 🎬 视频剪辑技能库 (Video Editing Skill Pack)

> 从 ClawHub 生态学习整合，基于 FFmpeg + MoviePy + Python 实现

---

## 📦 依赖清单

| 依赖 | 用途 | 状态 |
|------|------|:----:|
| FFmpeg 6.1.1 | 视频编解码核心引擎 | ✅ 已安装 |
| ffprobe | 视频元信息探测 | ✅ 已安装 |
| MoviePy 2.1.2 | Python 视频剪辑编程 | ✅ 已安装 |
| Python3 + OpenCV 4.13 | 帧级分析/场景检测 | ✅ 已安装 |
| Pillow 11.3.0 | 图像处理 | ✅ 已安装 |

---

## 🎯 技能体系

### 一、基础剪辑（10项）

1. 视频裁剪 - trim/atrim / VideoFileClip.subclip()
2. 缩放裁切 - scale/crop / fx.resize/fx.crop
3. 拼接合并 - concat / concatenate_videoclips()
4. 格式转换 - -c copy / write_videofile()
5. 加黑边填充 - pad / fx.margin()
6. 旋转翻转 - transpose/hflip/vflip / rotate()
7. 视频调速 - setpts / fx.speedx()
8. 帧率控制 - fps / set_fps()
9. 提取音频 - -vn -acodec copy / audio.write_audiofile()
10. 音视频分离 - -map / .audio .without_audio()

### 二、高级转场特效（58种）

xfade滤镜内置57种预设+1自定义：
fade/fadeblack/fadewhite/fadegrays/fadefast/fadeslow
slideleft/right/up/down
wipeleft/right/up/down, wipetl/tr/bl/br
circleopen/close/circlecrop, rectcrop
vertopen/close, horzopen/close
smoothleft/right/up/down
hlslice/hrslice/vuslice/vdslice
hlwind/hrwind/vuwind/vdwind
coverleft/right/up/down
revealleft/right/up/down
dissolve/pixelize/distance/radial/zoomin
squeezev/squeezeh, hblur

### 三、视觉特效滤镜（15项）

绿幕抠像、画面叠加、透明通道、颜色曲线、色相调整
通道混合、白平衡、颜色对比度、颜色平衡、负片效果
纯色叠加、高斯模糊、边缘检测、直方图均衡、缩放平移

### 四、音频处理（12项）

音量调整、淡入淡出、交叉淡化、多轨混音
变速不变调、均衡器、低音增强、高音增强
人声增强、降噪滤波、环绕声、声道重映射

### 五、字幕与文字（4项）

ASS字幕渲染、动态文字绘制、绘制几何图形、提取视频字幕

### 六、AI增强工作流（6项）

1. 视频编辑策略策划 - Hook(0-3s)->Content->Ending(25-30s)
2. 六层AI剪辑流水线 - 采集->AI策划->FFmpeg->叠加->AI资产->终剪
3. 云API剪辑 - 上传->AI处理->下载成片
4. 自然语言剪辑 - 描述需求->自动生成FFmpeg命令
5. ASR语音转字幕 - faster-whisper自动识别
6. AI语音/音效生成 - TTS+音效+背景音乐

---

## ⚡ 常用命令速查

### 裁剪视频
ffmpeg -i input.mp4 -ss 00:00:10 -to 00:00:30 -c copy output.mp4

### 拼接视频（同编码）
echo "file '1.mp4'\nfile '2.mp4'" > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4

### 转场效果（xfade）
ffmpeg -i clip1.mp4 -i clip2.mp4 -filter_complex \
  "[0]settb=AVTB,fps=30[v0];[1]settb=AVTB,fps=30[v1];\
   [v0][v1]xfade=transition=fade:duration=1:offset=9" output.mp4

### 画中画
ffmpeg -i main.mp4 -i overlay.mp4 -filter_complex \
  "[1]scale=iw/4:ih/4[pip];[0][pip]overlay=W-w-10:H-h-10" output.mp4

### MoviePy裁剪+拼接
from moviepy import VideoFileClip, concatenate_videoclips
clip1 = VideoFileClip("1.mp4").subclip(0, 10)
clip2 = VideoFileClip("2.mp4").subclip(5, 15)
final = concatenate_videoclips([clip1, clip2])
final.write_videofile("output.mp4")

---

## 🚀 工具注册

本技能库通过 video_edit 工具在 tool_registry.py 中注册，
handler 实现在 engine_server.py 的 _execute_tool() 中。
