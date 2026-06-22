"""Theme system — single-file color scheme definition"""
from pptx.util import Pt
from pptx.dml.color import RGBColor

class Theme:
    def __init__(self, name="default"):
        themes = {
            "default": {
                "bg":           RGBColor(0xFA, 0xFA, 0xFA),
                "card_bg":      RGBColor(0xFF, 0xFF, 0xFF),
                "dark_bg":      RGBColor(0x1A, 0x1A, 0x2E),
                "accent":       RGBColor(0x63, 0x66, 0xF1),
                "accent2":      RGBColor(0x8B, 0x5C, 0xF6),
                "text":         RGBColor(0x1F, 0x29, 0x37),
                "text_light":   RGBColor(0x6B, 0x72, 0x80),
                "text_inverse":  RGBColor(0xFF, 0xFF, 0xFF),
                "border":       RGBColor(0xE5, 0xE7, 0xEB),
                "success":      RGBColor(0x10, 0xB9, 0x81),
                "warning":      RGBColor(0xF5, 0x9E, 0x0B),
                "danger":       RGBColor(0xEF, 0x44, 0x44),
            },
            "dark": {
                "bg":           RGBColor(0x0F, 0x0F, 0x1A),
                "card_bg":      RGBColor(0x1F, 0x1F, 0x35),
                "dark_bg":      RGBColor(0x0A, 0x0A, 0x14),
                "accent":       RGBColor(0x81, 0x8C, 0xF8),
                "accent2":      RGBColor(0xA7, 0x8B, 0xFA),
                "text":         RGBColor(0xE5, 0xE7, 0xEB),
                "text_light":   RGBColor(0x9C, 0xA3, 0xAF),
                "text_inverse":  RGBColor(0xFF, 0xFF, 0xFF),
                "border":       RGBColor(0x37, 0x41, 0x51),
                "success":      RGBColor(0x34, 0xD3, 0x99),
                "warning":      RGBColor(0xFB, 0xB6, 0x23),
                "danger":       RGBColor(0xF8, 0x71, 0x71),
            },
        }
        self.name = name
        cfg = themes.get(name, themes["default"])
        for k, v in cfg.items():
            setattr(self, k, v)

    @property
    def title_size(self): return Pt(28)
    @property
    def subtitle_size(self): return Pt(14)
    @property
    def body_size(self): return Pt(11)
    @property
    def small_size(self): return Pt(9)
