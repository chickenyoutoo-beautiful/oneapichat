#!/usr/bin/env python3
"""
OneAPIChat Engine — 视频编辑工具函数单元测试
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from engine.video_edit import (
    generate_srt, str_to_rgb, color_to_ass,
    ypos_to_alignment, hex_to_rgba, draw_rounded_rect,
    SUBTITLE_FONTS, DEFAULT_FONT
)


class TestVideoEditUtils(unittest.TestCase):

    def test_generate_srt(self):
        """生成 SRT 文件"""
        subs = [
            {"start": 0.5, "end": 2.0, "text": "你好"},
            {"start": 2.5, "end": 5.0, "text": "世界"},
        ]
        with tempfile.NamedTemporaryFile(suffix='.srt', delete=False, mode='w', encoding='utf-8') as f:
            path = f.name
        try:
            result = generate_srt(subs, path)
            self.assertEqual(result, path)
            with open(path, encoding='utf-8') as f:
                content = f.read()
            self.assertIn('你好', content)
            self.assertIn('世界', content)
            self.assertIn('00:00:00,500', content)
            self.assertIn('00:00:02,000', content)
        finally:
            os.unlink(path)

    def test_str_to_rgb_known(self):
        """已知颜色名转 RGB"""
        self.assertEqual(str_to_rgb("black"), (0, 0, 0))
        self.assertEqual(str_to_rgb("white"), (255, 255, 255))
        self.assertEqual(str_to_rgb("red"), (255, 0, 0))
        self.assertEqual(str_to_rgb("green"), (0, 255, 0))
        self.assertEqual(str_to_rgb("blue"), (0, 0, 255))

    def test_str_to_rgb_unknown(self):
        """未知颜色名返回黑色"""
        self.assertEqual(str_to_rgb("nonexistent"), (0, 0, 0))

    def test_color_to_ass(self):
        """颜色名转 ASS 格式"""
        ass_white = color_to_ass("white")
        self.assertEqual(ass_white, "FFFFFF")
        ass_red = color_to_ass("red")
        self.assertEqual(ass_red, "0000FF")  # ASS 是 BBGGRR

    def test_ypos_top(self):
        """Y 位置 top → alignment 8"""
        self.assertEqual(ypos_to_alignment("top"), 8)

    def test_ypos_middle(self):
        """Y 位置 middle → alignment 5"""
        self.assertEqual(ypos_to_alignment("middle"), 5)

    def test_ypos_bottom(self):
        """Y 位置 bottom → alignment 2"""
        self.assertEqual(ypos_to_alignment("bottom"), 2)

    def test_hex_to_rgba(self):
        """十六进制颜色转 RGBA"""
        r, g, b, a = hex_to_rgba("#FF0000", 255)
        self.assertEqual((r, g, b), (255, 0, 0))
        self.assertEqual(a, 255)

    def test_fonts_config(self):
        """字体配置存在"""
        self.assertIn("noto-sans", SUBTITLE_FONTS)
        self.assertIsNotNone(DEFAULT_FONT)

    def test_draw_rounded_rect(self):
        """绘制圆角矩形不抛异常"""
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            self.skipTest("Pillow not installed")
        img = Image.new("RGBA", (100, 50), (255, 255, 255, 255))
        draw = ImageDraw.Draw(img)
        draw_rounded_rect(draw, (10, 5, 90, 45), 10, (0, 0, 0, 128))
        # 验证图像有变化
        pixels = list(img.getdata())
        non_white = sum(1 for p in pixels if p != (255, 255, 255, 255))
        self.assertGreater(non_white, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
