"""Image preprocessor — URL download + crop/scale/compress before inserting into PPT"""
import os, uuid, hashlib
from io import BytesIO
from urllib.request import Request, urlopen
from urllib.parse import urlparse
from PIL import Image

class ImageProcessor:
    def __init__(self, target_dir='/tmp/ppt_images/'):
        self.target_dir = target_dir
        os.makedirs(target_dir, exist_ok=True)

    def _resolve(self, src):
        """Accept local path or URL, return file path (downloading if needed)"""
        if not src:
            return None
        if os.path.exists(src):
            return src if os.path.getsize(src) > 100 else None
        # URL → download to temp
        if src.startswith(('http://', 'https://')):
            try:
                req = Request(src, headers={'User-Agent': 'OneAPIChat/2.0'})
                with urlopen(req, timeout=15) as resp:
                    data = resp.read()
                    if len(data) < 100:
                        return None
                    # cache by URL hash
                    h = hashlib.md5(src.encode()).hexdigest()[:12]
                    ext = os.path.splitext(urlparse(src).path)[1] or '.jpg'
                    if ext.lower() not in ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'):
                        ext = '.jpg'
                    cache_path = os.path.join(self.target_dir, f"dl_{h}{ext}")
                    with open(cache_path, 'wb') as f:
                        f.write(data)
                    return cache_path
            except Exception as e:
                print(f"[ImageProcessor] Download failed for {src[:80]}: {e}")
        return None

    def process(self, src, target_w_inches, target_h_inches, dpi=150):
        """Center-crop + resize image to exact target dimensions, return path.
        src can be a local path or HTTP(S) URL."""
        src_path = self._resolve(src)
        if not src_path:
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
