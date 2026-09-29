from pathlib import Path
import numpy as np
import pandas as pd
from skimage.color import rgb2lab
from .io import read_rgb

ASSETS_DIR = Path(__file__).resolve().parent.parent.parent / "assets"
ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
SCALE_FILE = ASSETS_DIR / "Color_refercene_card.png"
if not SCALE_FILE.exists():
    SCALE_FILE = ROOT_DIR / "Color_refercene_card.png"

SCALE_NAMES_SKIN = [f"สีเนื้อช่อง {i}" for i in range(1, 11)]
SCALE_NAMES_BRUISE = [
    "แดงเข้ม", "น้ำเงินเข้ม", "ม่วงอมชมพู", "เขียวอมเหลือง", "เหลืองอ่อน", "น้ำตาลอมส้ม"
]
BRUISE_AGE_EXAMPLES = ["0–2 วัน", "2–5 วัน", "2–5 วัน", "5–7 วัน", "7–10 วัน", "10–14 วัน"]

COLOUR_DAY_BANDS = {
    "แดงเข้ม": (0, 2),
    "น้ำเงินเข้ม": (2, 5),
    "ม่วงอมชมพู": (2, 5),
    "เขียวอมเหลือง": (5, 7),
    "เหลืองอ่อน": (7, 10),
    "น้ำตาลอมส้ม": (10, 14),
}

# Ground truth values extracted from the reference card PNG (1890x1890)
FALLBACK_REF_DATA = [
    {"kind": "skin", "index": 0, "ชื่อสี": "สีเนื้อช่อง 1", "RGB": (244, 233, 223), "HEX": "#F4E9DF"},
    {"kind": "skin", "index": 1, "ชื่อสี": "สีเนื้อช่อง 2", "RGB": (241, 228, 214), "HEX": "#F1E4D6"},
    {"kind": "skin", "index": 2, "ชื่อสี": "สีเนื้อช่อง 3", "RGB": (246, 231, 207), "HEX": "#F6E7CF"},
    {"kind": "skin", "index": 3, "ชื่อสี": "สีเนื้อช่อง 4", "RGB": (236, 218, 189), "HEX": "#ECDABD"},
    {"kind": "skin", "index": 4, "ชื่อสี": "สีเนื้อช่อง 5", "RGB": (218, 193, 159), "HEX": "#DAC19F"},
    {"kind": "skin", "index": 5, "ชื่อสี": "สีเนื้อช่อง 6", "RGB": (173, 142, 103), "HEX": "#AD8E67"},
    {"kind": "skin", "index": 6, "ชื่อสี": "สีเนื้อช่อง 7", "RGB": (148, 113, 81), "HEX": "#947151"},
    {"kind": "skin", "index": 7, "ชื่อสี": "สีเนื้อช่อง 8", "RGB": (123, 90, 67), "HEX": "#7B5A43"},
    {"kind": "skin", "index": 8, "ชื่อสี": "สีเนื้อช่อง 9", "RGB": (95, 80, 68), "HEX": "#5F5044"},
    {"kind": "skin", "index": 9, "ชื่อสี": "สีเนื้อช่อง 10", "RGB": (79, 69, 60), "HEX": "#4F453C"},
    {"kind": "bruise", "index": 0, "ชื่อสี": "แดงเข้ม", "RGB": (167, 44, 50), "HEX": "#A72C32"},
    {"kind": "bruise", "index": 1, "ชื่อสี": "น้ำเงินเข้ม", "RGB": (0, 90, 137), "HEX": "#005A89"},
    {"kind": "bruise", "index": 2, "ชื่อสี": "ม่วงอมชมพู", "RGB": (211, 145, 176), "HEX": "#D391B0"},
    {"kind": "bruise", "index": 3, "ชื่อสี": "เขียวอมเหลือง", "RGB": (187, 168, 105), "HEX": "#BBA869"},
    {"kind": "bruise", "index": 4, "ชื่อสี": "เหลืองอ่อน", "RGB": (236, 223, 167), "HEX": "#ECDFA7"},
    {"kind": "bruise", "index": 5, "ชื่อสี": "น้ำตาลอมส้ม", "RGB": (194, 87, 46), "HEX": "#C2572E"},
]

COMMON_COLOURS = [
    ('ดำ', (20, 20, 20)), ('เทาเข้ม', (65, 65, 65)), ('เทา', (125, 125, 125)), ('เทาอ่อน', (190, 190, 190)),
    ('น้ำตาลเข้ม', (78, 52, 46)), ('น้ำตาล', (121, 85, 72)), ('น้ำตาลแดง', (139, 70, 62)),
    ('น้ำตาลอมส้ม', (194, 87, 46)), ('แดงเข้ม', (139, 30, 45)), ('แดง', (198, 40, 40)),
    ('ม่วงเข้ม', (74, 37, 69)), ('ม่วง', (106, 61, 112)), ('ม่วงอมแดง', (126, 63, 91)),
    ('ม่วงอมชมพู', (181, 109, 140)), ('ชมพู', (211, 145, 176)), ('น้ำเงินเข้ม', (0, 90, 137)),
    ('เขียวเข้ม', (85, 107, 47)), ('เขียวมะกอก', (128, 128, 64)),
    ('เขียวอมเหลือง', (187, 168, 105)), ('เหลืองน้ำตาล', (184, 155, 84)),
    ('เหลืองอ่อน', (236, 223, 167)), ('ส้ม', (210, 105, 46)),
    ('สีเนื้ออ่อน', (238, 210, 180)), ('สีเนื้อกลาง', (205, 160, 115)),
    ('สีเนื้อเข้ม', (145, 100, 72))
]

COMMON_LAB = rgb2lab(np.asarray([rgb for _, rgb in COMMON_COLOURS], np.uint8)[None, :, :] / 255)[0]


def reference_swatches(scale_rgb: np.ndarray | None = None) -> pd.DataFrame:
    """Extracts reference swatches from scale_rgb or returns curated standard reference data."""
    if scale_rgb is None:
        return pd.DataFrame(FALLBACK_REF_DATA)
    h, w = scale_rgb.shape[:2]
    x0, x1 = 354 * w / 1890, 1537 * w / 1890
    rows = []
    for kind, n, y, names in [
        ('skin', 10, 59 * h / 1890, SCALE_NAMES_SKIN),
        ('bruise', 6, 176 * h / 1890, SCALE_NAMES_BRUISE),
    ]:
        for i in range(n):
            x = x0 + (i + 0.5) * (x1 - x0) / n
            xpix, ypix = int(round(x)), int(round(y))
            r = max(3, int((x1 - x0) / n * 0.12))
            patch = scale_rgb[ypix - r:ypix + r + 1, xpix - r:xpix + r + 1]
            rgb = np.median(patch.reshape(-1, 3), axis=0).astype(np.uint8)
            rows.append({
                'kind': kind,
                'index': i,
                'ชื่อสี': names[i],
                'RGB': tuple(int(v) for v in rgb),
                'HEX': '#%02X%02X%02X' % tuple(rgb)
            })
    return pd.DataFrame(rows)


# Initialize reference datasets
if SCALE_FILE.exists():
    SCALE_RGB = read_rgb(SCALE_FILE)
    REF = reference_swatches(SCALE_RGB)
else:
    SCALE_RGB = None
    REF = pd.DataFrame(FALLBACK_REF_DATA)

REF_RGB = np.asarray(REF['RGB'].tolist(), dtype=np.uint8)
REF_LAB = rgb2lab(REF_RGB[None, :, :] / 255)[0]
