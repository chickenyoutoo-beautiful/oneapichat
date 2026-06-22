"""Constraint-based layout engine — math, not guessing"""
import os

class LayoutGrid:
    def __init__(self, page_w=10, page_h=7.5, title_h=0.85, nav_h=0.4):
        self.usable_x = 0.6
        self.usable_y = title_h + 0.15
        self.usable_w = page_w - 1.2
        self.usable_h = page_h - title_h - nav_h - 0.3

    def grid(self, rows, cols, row_ratios=None, col_ratios=None):
        if row_ratios is None: row_ratios = [1.0 / rows] * rows
        if col_ratios is None: col_ratios = [1.0 / cols] * cols
        gutter = 0.15
        cells = []
        y = self.usable_y
        for r in range(rows):
            row_h = (self.usable_h - gutter * (rows - 1)) * row_ratios[r]
            x = self.usable_x
            for c in range(cols):
                col_w = (self.usable_w - gutter * (cols - 1)) * col_ratios[c]
                cells.append((x, y, col_w, row_h))
                x += col_w + gutter
            y += row_h + gutter
        return cells


class CardLayout:
    MAX_BULLETS = 6
    IMG_MAX_RATIO = 0.38
    TITLE_H = 0.35
    SEP_H = 0.04
    GAP = 0.06
    PAD = 0.12

    def compute(self, x, y, w, h, title, bullets, img_path=None, img_url=None):
        self.card_x, self.card_y, self.card_w, self.card_h = x, y, w, h
        inner_x = x + self.PAD
        inner_w = w - 2 * self.PAD
        result = {'card_x': x, 'card_y': y, 'card_w': w, 'card_h': h,
                  'title_text': title}

        _img_src = img_path or img_url
        # Image area (0%~38% of card height)
        if _img_src:
            img_h = min(h * self.IMG_MAX_RATIO, 1.8)
            result['img'] = (inner_x, y + self.PAD, inner_w, img_h)
            result['img_src'] = _img_src
            content_y = y + self.PAD + img_h + self.GAP
        else:
            content_y = y + self.PAD

        # Title
        result['title'] = (inner_x + 0.04, content_y, inner_w - 0.08, self.TITLE_H)
        result['sep'] = (inner_x + 0.04, content_y + self.TITLE_H, 0.5, self.SEP_H)

        # Bullets — adaptive height
        bullet_y = content_y + self.TITLE_H + self.SEP_H + self.GAP
        bullet_h_avail = (y + h - self.PAD) - bullet_y
        bullet_count = min(len(bullets), self.MAX_BULLETS)
        line_h = min(0.17, bullet_h_avail / max(bullet_count, 1) - 0.02)
        line_h = max(line_h, 0.12)
        bullets = bullets[:bullet_count]
        result['bullets'] = (inner_x + 0.04, bullet_y, inner_w - 0.08, line_h * bullet_count)
        result['bullet_lines'] = bullets
        result['bullet_line_h'] = line_h

        self._validate(result)
        return result

    def _validate(self, result):
        for key, rect in result.items():
            if key in ('bullet_lines', 'bullet_line_h', 'title_text', 'img_path', 'card_x', 'card_y', 'card_w', 'card_h'):
                continue
            rx, ry, rw, rh = rect
            ok = (rx >= self.card_x - 0.5 and ry >= self.card_y - 0.5 and
                  rx + rw <= self.card_x + self.card_w + 0.5 and
                  ry + rh <= self.card_y + self.card_h + 0.5)
            if not ok:
                raise OverflowError(
                    f"CardLayout overflow: {key} ({rx:.2f},{ry:.2f},{rw:.2f},{rh:.2f}) "
                    f"outside card ({self.card_x:.2f},{self.card_y:.2f},{self.card_w:.2f},{self.card_h:.2f})"
                )
