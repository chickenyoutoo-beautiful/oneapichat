"""Image preprocessor — crop/scale/compress before inserting into PPT"""
import os, uuid
from PIL import Image

class ImageProcessor:
    def __init__(self, target_dir='/tmp/ppt_images/'):
        self.target_dir = target_dir
        os.makedirs(target_dir, exist_ok=True)

    def process(self, src_path, target_w_inches, target_h_inches, dpi=150):
        """Center-crop + resize image to exact target dimensions, return path"""
        if not src_path or not os.path.exists(src_path):
            return None
        if os.path.getsize(src_path) < 100:
            return None

        target_w_px = int(target_w_inches * dpi)
        target_h_px = int(target_h_inches * dpi)
        target_ratio = target_w_px / target_h_px

        try:
            with Image.open(src_path) as img:
                img = img.convert('RGB')
                w, h = img.size
                if w < 50 or h < 50:
                    return None

                src_ratio = w / h
                if src_ratio > target_ratio:
                    new_w = int(h * target_ratio)
                    left = (w - new_w) // 2
                    img = img.crop((left, 0, left + new_w, h))
                elif src_ratio < target_ratio:
                    new_h = int(w / target_ratio)
                    top = (h - new_h) // 2
                    img = img.crop((0, top, w, top + new_h))

                img = img.resize((target_w_px, target_h_px), Image.LANCZOS)
                out_path = os.path.join(self.target_dir, f"{uuid.uuid4().hex[:8]}.jpg")
                img.save(out_path, 'JPEG', quality=85)
                return out_path
        except Exception as e:
            print(f"[ImageProcessor] Error: {e}")
            return None
