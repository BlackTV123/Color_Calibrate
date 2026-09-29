import io
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

IMAGE_SUFFIXES = {
    '.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.webp', '.bmp', '.dib',
    '.tif', '.tiff', '.gif', '.avif', '.heic', '.heif'
}


def decode_rgb(payload: bytes, filename: str = "image") -> np.ndarray:
    """
    Decodes raw image bytes into an RGB NumPy array.
    Fixes EXIF orientation, converts transparency/RGBA to RGB on white background,
    and returns a uint8 array of shape (H, W, 3).
    """
    try:
        with Image.open(io.BytesIO(payload)) as image:
            image.seek(0)
            image = ImageOps.exif_transpose(image)
            if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
                canvas = Image.new('RGBA', image.size, (255, 255, 255, 255))
                canvas.alpha_composite(image.convert('RGBA'))
                image = canvas.convert('RGB')
            else:
                image = image.convert('RGB')
            return np.asarray(image).copy()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise ValueError(
            f"Cannot decode image '{filename}': Invalid image format or corrupted data. "
            "For HEIC/HEIF files, ensure pillow-heif is installed."
        ) from exc


def read_rgb(path: str | Path) -> np.ndarray:
    """Reads image from disk path and returns RGB NumPy array."""
    p = Path(path)
    return decode_rgb(p.read_bytes(), p.name)


def save_rgb(path: str | Path, rgb: np.ndarray) -> None:
    """Saves RGB NumPy array as PNG to path."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    ok, data = cv2.imencode('.png', cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    if not ok:
        raise ValueError(f"Failed to encode image to {path}")
    data.tofile(str(p))
