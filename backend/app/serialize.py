import base64
import io
import math
from typing import Any
import cv2
import numpy as np
import pandas as pd
from PIL import Image


def to_json_safe(obj: Any) -> Any:
    """Recursively converts NumPy and Pandas objects to JSON-serializable types."""
    if isinstance(obj, dict):
        return {str(k): to_json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_json_safe(v) for v in obj]
    if isinstance(obj, pd.DataFrame):
        return to_json_safe(obj.to_dict(orient="records"))
    if isinstance(obj, pd.Series):
        return to_json_safe(obj.to_dict())
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(obj, (np.integer, int)):
        return int(obj)
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return None  # Never send raw large ndarrays in main JSON
    if obj is None or isinstance(obj, (str, int)):
        return obj
    return str(obj)


def encode_image_base64(img_rgb: np.ndarray, max_dim: int = 1200, quality: int = 85) -> str:
    """Resizes RGB image if needed and encodes to base64 JPEG string."""
    h, w = img_rgb.shape[:2]
    scale = min(1.0, max_dim / max(h, w))
    if scale < 1.0:
        new_w, new_h = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
        resized = cv2.resize(img_rgb, (new_w, new_h), interpolation=cv2.INTER_AREA)
    else:
        resized = img_rgb

    pil_img = Image.fromarray(resized)
    buf = io.BytesIO()
    pil_img.save(buf, format="JPEG", quality=quality)
    encoded = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{encoded}"


def create_overlay_image(original_rgb: np.ndarray, corrected_rgb: np.ndarray,
                         skin_mask: np.ndarray | None, wound_mask: np.ndarray | None,
                         wound_box: tuple | None, crop_box: tuple | None) -> str:
    """Creates a visual composite overlay matching the notebook review display."""
    vis = corrected_rgb.copy()
    if skin_mask is not None and skin_mask.any():
        # Green tint for normal skin region
        green_overlay = np.zeros_like(vis)
        green_overlay[:] = [0, 220, 0]
        mask_idx = skin_mask.astype(bool)
        vis[mask_idx] = cv2.addWeighted(vis[mask_idx], 0.82, green_overlay[mask_idx], 0.18, 0)

    if wound_mask is not None and wound_mask.any():
        # Red tint for detected wound region
        red_overlay = np.zeros_like(vis)
        red_overlay[:] = [230, 40, 40]
        mask_idx = wound_mask.astype(bool)
        vis[mask_idx] = cv2.addWeighted(vis[mask_idx], 0.68, red_overlay[mask_idx], 0.32, 0)

    if wound_box is not None:
        x0, y0, x1, y1 = wound_box
        cv2.rectangle(vis, (x0, y0), (x1, y1), (255, 30, 30), 2)

    if crop_box is not None:
        cx0, cy0, cx1, cy1 = crop_box
        if cx1 > cx0 and cy1 > cy0:
            vis = vis[cy0:cy1, cx0:cx1]

    return encode_image_base64(vis, max_dim=1000)


def compute_histograms(raw_pixels: np.ndarray | None,
                       cal_pixels: np.ndarray | None) -> dict[str, Any]:
    """Computes normalized 32-bin histograms (0..256 in steps of 8) for R, G, B channels."""
    bins = list(range(0, 257, 8))
    out: dict[str, Any] = {
        "bins": [int(b) for b in bins[:-1]],
        "raw": {"r": [], "g": [], "b": []},
        "cal": {"r": [], "g": [], "b": []}
    }
    if raw_pixels is not None and len(raw_pixels) > 0:
        out["raw"]["r"] = [int(v) for v in np.histogram(raw_pixels[:, 0], bins=bins)[0]]
        out["raw"]["g"] = [int(v) for v in np.histogram(raw_pixels[:, 1], bins=bins)[0]]
        out["raw"]["b"] = [int(v) for v in np.histogram(raw_pixels[:, 2], bins=bins)[0]]

    if cal_pixels is not None and len(cal_pixels) > 0:
        out["cal"]["r"] = [int(v) for v in np.histogram(cal_pixels[:, 0], bins=bins)[0]]
        out["cal"]["g"] = [int(v) for v in np.histogram(cal_pixels[:, 1], bins=bins)[0]]
        out["cal"]["b"] = [int(v) for v in np.histogram(cal_pixels[:, 2], bins=bins)[0]]

    return out


def build_response(result: dict) -> dict:
    """Transforms raw pipeline dictionary into a clean, typed JSON-ready API response."""
    cal = result.get('calibration', {})
    has_wound = result.get('wound_table') is not None
    age_est = result.get('age_estimate', {})
    wound_sz = result.get('wound_size', {})

    # Dominant color swatches (from wound if available, else skin)
    dominant_table = result.get('wound_table') if has_wound else result.get('skin_table')
    dominant_colors = []
    if dominant_table is not None and isinstance(dominant_table, pd.DataFrame):
        for _, row in dominant_table.head(6).iterrows():
            pct = float(row.get('เปอร์เซ็นต์', 0))
            if pct > 0.5:
                dominant_colors.append({
                    "name": str(row.get('ชื่อสี', '')),
                    "hex": str(row.get('HEX', '—')),
                    "percent": round(pct, 1),
                    "median_de00": round(float(row.get('median ΔE00', 0)), 1) if pd.notna(row.get('median ΔE00')) else None
                })

    # Mean RGB calculation on pixels
    working_pixels = result.get('wound_pixels') if has_wound else result.get('skin_pixels')
    mean_rgb = [128, 128, 128]
    mean_lightness = 50
    if working_pixels is not None and len(working_pixels) > 0:
        m = np.mean(working_pixels, axis=0)
        mean_rgb = [int(round(m[0])), int(round(m[1])), int(round(m[2]))]
        mean_lightness = int(round((max(mean_rgb) + min(mean_rgb)) / 2 / 255.0 * 100))

    # Base64 Preview Images
    orig_img = result.get('original')
    corr_img = result.get('corrected')
    preview_original = encode_image_base64(orig_img, max_dim=800) if orig_img is not None else None
    preview_calibrated = encode_image_base64(corr_img, max_dim=800) if corr_img is not None else None
    preview_overlay = None
    if orig_img is not None and corr_img is not None:
        preview_overlay = create_overlay_image(
            orig_img, corr_img,
            result.get('skin_mask'),
            result.get('wound_mask'),
            result.get('wound_box'),
            result.get('crop_box')
        )

    # Histograms
    skin_hist = compute_histograms(result.get('skin_original_pixels'), result.get('skin_pixels'))
    wound_hist = compute_histograms(result.get('wound_original_pixels'), result.get('wound_pixels'))

    # Format calibration table if present
    cal_table_list = []
    if 'table' in cal and isinstance(cal['table'], pd.DataFrame):
        for _, r in cal['table'].iterrows():
            cal_table_list.append({
                "kind": str(r.get('ประเภท', '')),
                "name": str(r.get('ชื่อสี', '')),
                "rgb_captured": list(r.get('RGB ที่ถ่าย', ())),
                "rgb_corrected": list(r.get('RGB หลังปรับ', ())),
                "rgb_reference": list(r.get('RGB ต้นฉบับ', ())),
                "de00_before": round(float(r.get('ΔE00 ก่อน', 0)), 2) if pd.notna(r.get('ΔE00 ก่อน')) else None,
                "de00_after": round(float(r.get('ΔE00 หลัง', 0)), 2) if pd.notna(r.get('ΔE00 หลัง')) else None,
                "de00_improvement": round(float(r.get('ΔE00 ดีขึ้น', 0)), 2) if pd.notna(r.get('ΔE00 ดีขึ้น')) else None,
                "loocv_de00": round(float(r.get('held-out ΔE00', 0)), 2) if pd.notna(r.get('held-out ΔE00')) else None,
                "used_for_fit": bool(r.get('ใช้สร้างโมเดล', False))
            })

    return {
        "filename": result.get('filename', 'image'),
        "has_wound": has_wound,
        "detection_note": result.get('detection_note', ''),
        "calibration": {
            "status": cal.get('status', 'Uncalibrated'),
            "is_calibrated": cal.get('status') == 'พอใช้สำหรับต้นแบบ',
            "loocv_median_de00": cal.get('LOOCV median ΔE00'),
            "bruise_worst_de00": cal.get('bruise LOOCV worst ΔE00'),
            "method": cal.get('method', 'global'),
            "selected_ridge": cal.get('selected ridge'),
            "correction_strength": cal.get('correction strength'),
            "median_de00_before": cal.get('median ΔE00 before'),
            "median_de00_after": cal.get('median ΔE00 after'),
            "selection_note": cal.get('selection note', ''),
            "table": cal_table_list
        },
        "color_profile": {
            "mean_rgb": mean_rgb,
            "mean_lightness": mean_lightness,
            "dominant_colors": dominant_colors
        },
        "wound_size": {
            "status": wound_sz.get('status', ''),
            "width_cm": wound_sz.get('กว้าง ซม.'),
            "length_cm": wound_sz.get('ยาว ซม.'),
            "area_cm2": wound_sz.get('พื้นที่ ซม.²'),
            "pixel_area": wound_sz.get('พิกเซลของรอยสี'),
            "note": wound_sz.get('หมายเหตุ', '')
        },
        "age_estimate": {
            "status": age_est.get('status', ''),
            "range": age_est.get('ช่วงวัน'),
            "midpoint_days": age_est.get('ค่ากลางช่วง'),
            "confidence": age_est.get('ความเชื่อมั่น', 'ต่ำ'),
            "confidence_score": age_est.get('คะแนนความเชื่อมั่น', 0),
            "reason": age_est.get('เหตุผล', ''),
            "note": result.get('age_note', '')
        },
        "histograms": {
            "skin": skin_hist,
            "wound": wound_hist
        },
        "previews": {
            "original": preview_original,
            "calibrated": preview_calibrated,
            "overlay": preview_overlay
        }
    }
