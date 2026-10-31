from pathlib import Path
from typing import Tuple, Any
import numpy as np
from .io import decode_rgb, read_rgb
from .calibration import calibration, apply_ccm
from .colour import (
    paired_pixels, colour_percentages, measured_colour_clusters,
    palette_comparison, estimate_colour_age
)
from .detect_card import auto_find_card
from .segment import (
    wound_mask, estimate_wound_size, auto_skin_and_wound, card_crop_box
)


def analyse_photo_auto_bytes(payload: bytes, filename: str = "image") -> dict:
    """
    Executes the full automatic analysis pipeline directly on image bytes.
    Used by the FastAPI web service to avoid writing temporary files to disk.
    """
    photo = decode_rgb(payload, filename)
    card, card_note = auto_find_card(photo)
    skin_quad = card['skin_quad'] if card else ''
    bruise_quad = card['bruise_quad'] if card else ''

    matrix, cal = calibration(photo, skin_quad, bruise_quad)
    corrected = apply_ccm(photo, matrix)

    skin_before, skin_pixels, skin_box, skin_mask, lesion_mask, wound_box, fraction = auto_skin_and_wound(
        photo, corrected, card['H'] if card else None,
        bool(card and card['inliers'] == 3)
    )

    out = {
        'filename': filename,
        'original': photo,
        'corrected': corrected,
        'calibration': cal,
        'skin_box': skin_box,
        'skin_mask': skin_mask,
        'skin_pixels': skin_pixels,
        'skin_original_pixels': skin_before,
        'skin_comparison': palette_comparison(skin_before, skin_pixels, 'skin'),
        'skin_table': colour_percentages(skin_pixels, 'skin'),
        'skin_measured_colours': measured_colour_clusters(skin_pixels, 'skin'),
        'wound_box': wound_box,
        'wound_table': None,
        'wound_measured_colours': None,
        'wound_pixels': None,
        'wound_original_pixels': None,
        'wound_comparison': None,
        'wound_mask': lesion_mask,
        'wound_fraction': fraction,
        'wound_size': {'status': 'ยังวัดไม่ได้: ไม่พบแผล'},
        'age_estimate': estimate_colour_age(None, cal['status'], cal),
        'age_note': 'ยังไม่พบสีแผลที่ต่างจากสีเนื้ออย่างพอเพียง',
        'detection_note': card_note,
        'crop_box': card_crop_box(photo.shape, card, wound_box)
    }

    if wound_box is not None:
        original_pixels, pixels = paired_pixels(photo, corrected, lesion_mask)
        out['wound_original_pixels'] = original_pixels
        out['wound_pixels'] = pixels
        out['wound_table'] = colour_percentages(pixels, 'bruise')
        out['wound_measured_colours'] = measured_colour_clusters(pixels, 'bruise')
        out['wound_comparison'] = palette_comparison(original_pixels, pixels, 'bruise')
        out['wound_size'] = estimate_wound_size(lesion_mask, cal)
        out['age_estimate'] = estimate_colour_age(out['wound_table'], cal['status'], cal)
        out['age_note'] = 'ระบบเสนอ mask แผลอัตโนมัติ: ต้องตรวจ overlay ว่าจับแผลจริง ไม่ใช่เงา/สเกล'

    return out


def analyse_photo_auto(path: str | Path) -> dict:
    """Convenience helper to analyse an image from file path."""
    p = Path(path)
    res = analyse_photo_auto_bytes(p.read_bytes(), p.name)
    res['path'] = p
    return res


def analyse_photo(path: str | Path, skin_box: Tuple[int, int, int, int],
                  wound_box: Tuple[int, int, int, int] | None = None,
                  skin_quad: str = '', bruise_quad: str = '') -> dict:
    """Manual fallback analysis route."""
    p = Path(path)
    photo = read_rgb(p)
    matrix, cal = calibration(photo, skin_quad, bruise_quad)
    corrected = apply_ccm(photo, matrix)
    x0, y0, x1, y1 = skin_box
    skin_area = np.zeros(photo.shape[:2], bool)
    skin_area[y0:y1, x0:x1] = True
    skin_before, skin_pixels = paired_pixels(photo, corrected, skin_area)
    skin_table = colour_percentages(skin_pixels, 'skin')

    out = {
        'path': p,
        'filename': p.name,
        'original': photo,
        'corrected': corrected,
        'calibration': cal,
        'skin_box': skin_box,
        'skin_table': skin_table,
        'skin_pixels': skin_pixels,
        'skin_measured_colours': measured_colour_clusters(skin_pixels, 'skin'),
        'skin_original_pixels': skin_before,
        'skin_comparison': palette_comparison(skin_before, skin_pixels, 'skin'),
        'wound_box': wound_box,
        'wound_pixels': None,
        'wound_original_pixels': None,
        'wound_comparison': None,
        'wound_table': None,
        'wound_measured_colours': None,
        'wound_mask': None,
        'wound_fraction': 0.0,
        'wound_size': {'status': 'ยังวัดไม่ได้: ไม่มีภาพแผล'},
        'age_estimate': estimate_colour_age(None, cal['status'], cal),
        'age_note': 'ไม่มีภาพแผลที่ให้วิเคราะห์ จึงยังประเมินไม่ได้',
        'skin_mask': None,
        'detection_note': 'เลือกกรอบเอง'
    }

    if wound_box is not None:
        mask, fraction, _ = wound_mask(corrected, wound_box, skin_pixels)
        out['wound_mask'] = mask
        out['wound_fraction'] = fraction
        if mask.sum() >= 200 and fraction >= 0.03:
            original_pixels, pixels = paired_pixels(photo, corrected, mask)
            out['wound_original_pixels'] = original_pixels
            out['wound_pixels'] = pixels
            out['wound_table'] = colour_percentages(pixels, 'bruise')
            out['wound_measured_colours'] = measured_colour_clusters(pixels, 'bruise')
            out['wound_comparison'] = palette_comparison(original_pixels, pixels, 'bruise')
            out['wound_size'] = estimate_wound_size(mask, cal)
            out['age_estimate'] = estimate_colour_age(out['wound_table'], cal['status'], cal)
            out['age_note'] = 'สีแผลใช้เทียบช่วงวันแบบต้นแบบได้เมื่อผ่านเกณฑ์ แต่ไม่ใช่อายุแผลที่ยืนยันได้'
        else:
            out['wound_size'] = {'status': 'ยังวัดไม่ได้: ไม่พบ mask แผลที่มากพอ'}
            out['age_note'] = 'ไม่พบบริเวณสีแผลที่ต่างจากสีเนื้อเพียงพอ ตรวจกรอบและภาพก่อน; ยังประเมินไม่ได้'

    return out
