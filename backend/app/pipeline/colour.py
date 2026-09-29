from typing import Tuple, Any
import cv2
import numpy as np
import pandas as pd
from skimage.color import rgb2lab, lab2rgb, deltaE_ciede2000
from .calibration import ciede
from .reference import REF, REF_LAB, COMMON_COLOURS, COMMON_LAB, COLOUR_DAY_BANDS


def norm_box(x_range: Tuple[float, float], y_range: Tuple[float, float], shape: Tuple[int, ...]) -> Tuple[int, int, int, int]:
    h, w = shape[:2]
    x0, x1 = [int(round(v * w)) for v in x_range]
    y0, y1 = [int(round(v * h)) for v in y_range]
    x0, x1 = np.clip([x0, x1], 0, w)
    y0, y1 = np.clip([y0, y1], 0, h)
    if x1 - x0 < 20 or y1 - y0 < 20:
        raise ValueError('Bounding box is too small')
    return (int(x0), int(y0), int(x1), int(y1))


def paired_pixels(before: np.ndarray, after: np.ndarray, mask: np.ndarray, max_pixels: int = 35000) -> Tuple[np.ndarray, np.ndarray]:
    """Sample matching pixel locations before and after calibration."""
    raw = before[mask]
    fixed = after[mask]
    good = ((raw.max(axis=1) > 8) & (raw.max(axis=1) < 251) &
            (fixed.max(axis=1) > 8) & (fixed.max(axis=1) < 251))
    raw, fixed = raw[good], fixed[good]
    if len(raw) > max_pixels:
        rng = np.random.default_rng(42)
        ids = rng.choice(len(raw), max_pixels, replace=False)
        raw, fixed = raw[ids], fixed[ids]
    if len(raw) < 100:
        raise ValueError('Not enough valid pixels in this region for reliable analysis')
    return raw, fixed


def sample_pixels(rgb: np.ndarray, box: Tuple[int, int, int, int], max_pixels: int = 35000) -> np.ndarray:
    x0, y0, x1, y1 = box
    roi = rgb[y0:y1, x0:x1].reshape(-1, 3)
    good = (roi.min(axis=1) > 4) & (roi.max(axis=1) < 251)
    roi = roi[good]
    if len(roi) > max_pixels:
        rng = np.random.default_rng(42)
        roi = roi[rng.choice(len(roi), max_pixels, replace=False)]
    if len(roi) < 100:
        raise ValueError('Not enough valid pixels in the specified box')
    return roi


def colour_percentages(pixels: np.ndarray, kind: str, max_de: float | None = None) -> pd.DataFrame:
    ref = REF[REF['kind'] == kind].reset_index(drop=True)
    start = 0 if kind == 'skin' else 10
    distances = ciede(pixels, REF_LAB[start:start + len(ref)])
    label = distances.argmin(axis=1)
    nearest = distances.min(axis=1)
    ordered = np.partition(distances, 1, axis=1)[:, :2]
    margin = ordered[:, 1] - ordered[:, 0]
    if max_de is None:
        max_de = 14.0 if kind == 'skin' else 15.0
    min_margin = 0.75 if kind == 'skin' else 1.5

    # Mark ambiguous or distant colors as unmatched
    label[(nearest > max_de) | (margin < min_margin)] = -1
    rows = []
    for i, row in ref.iterrows():
        rows.append({
            'ชื่อสี': row['ชื่อสี'],
            'HEX': row['HEX'],
            'เปอร์เซ็นต์': 100.0 * float(np.mean(label == i)),
            'median ΔE00': float(np.median(nearest[label == i])) if np.any(label == i) else np.nan
        })
    rows.append({
        'ชื่อสี': 'สีอื่น/ไม่ตรงช่องสเกล',
        'HEX': '—',
        'เปอร์เซ็นต์': 100.0 * float(np.mean(label == -1)),
        'median ΔE00': np.nan
    })
    return pd.DataFrame(rows).sort_values('เปอร์เซ็นต์', ascending=False).reset_index(drop=True)


def measured_colour_clusters(pixels: np.ndarray, kind: str, max_clusters: int | None = None) -> pd.DataFrame | None:
    """Clusters actual observed colors without forcing scale patch labels."""
    pixels = np.asarray(pixels, np.uint8)
    if len(pixels) < 100:
        return None
    rng = np.random.default_rng(42)
    sample = pixels[rng.choice(len(pixels), min(len(pixels), 18000), replace=False)]
    sample_lab = rgb2lab(sample[None, :, :] / 255.0)[0].astype(np.float32)

    # Trim extreme highlights and shadows
    low, high = np.percentile(sample_lab[:, 0], [2, 98])
    keep = (sample_lab[:, 0] >= low) & (sample_lab[:, 0] <= high)
    sample = sample[keep]
    sample_lab = sample_lab[keep]
    if len(sample_lab) < 100:
        return None

    k = max_clusters or (3 if kind == 'skin' else 4)
    k = max(1, min(k, len(sample_lab) // 100))
    cv2.setRNGSeed(42)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 80, 0.15)
    _, labels, centres = cv2.kmeans(sample_lab, k, None, criteria, 8, cv2.KMEANS_PP_CENTERS)
    labels = labels.ravel()
    counts = np.bincount(labels, minlength=k)
    ref = REF[REF['kind'] == kind].reset_index(drop=True)
    start = 0 if kind == 'skin' else 10
    rows = []
    for cluster_id in np.argsort(counts)[::-1]:
        centre = centres[cluster_id]
        rgb = np.rint(np.clip(lab2rgb(centre[None, None, :])[0, 0], 0, 1) * 255).astype(np.uint8)
        distances = deltaE_ciede2000(centre[None, :], REF_LAB[start:start + len(ref)])
        nearest = int(np.argmin(distances))
        de = float(distances[nearest])
        nearest_name = ref.iloc[nearest]['ชื่อสี']
        common_ids = [i for i, (name, _) in enumerate(COMMON_COLOURS)
                      if kind == 'skin' or not name.startswith('สีเนื้อ')]
        common_distance = deltaE_ciede2000(centre[None, :], COMMON_LAB[common_ids])
        actual_name = COMMON_COLOURS[common_ids[int(np.argmin(common_distance))]][0]
        match = nearest_name if de <= 15 else f'ไม่ตรงสเกล (ใกล้ {nearest_name})'
        rows.append({
            'ชื่อสีที่พบ': actual_name,
            'HEX': '#%02X%02X%02X' % tuple(rgb),
            'RGB ที่พบ': tuple(int(v) for v in rgb),
            'เปอร์เซ็นต์': 100.0 * float(counts[cluster_id] / counts.sum()),
            'ผลเทียบสเกล': match,
            'ΔE00 ถึงสเกล': de
        })
    return pd.DataFrame(rows)


def palette_comparison(before: np.ndarray, after: np.ndarray, kind: str) -> pd.DataFrame:
    a = colour_percentages(before, kind)
    b = colour_percentages(after, kind)
    table = a[['ชื่อสี', 'HEX', 'เปอร์เซ็นต์', 'median ΔE00']].merge(
        b[['ชื่อสี', 'เปอร์เซ็นต์', 'median ΔE00']], on='ชื่อสี', suffixes=(' ก่อน', ' หลัง')
    )
    return table.sort_values('เปอร์เซ็นต์ หลัง', ascending=False).reset_index(drop=True)


def nearest_scale_distance(pixels: np.ndarray | None, kind: str) -> float | None:
    if pixels is None or len(pixels) == 0:
        return None
    start, n = (0, 10) if kind == 'skin' else (10, 6)
    return float(np.median(ciede(pixels, REF_LAB[start:start + n]).min(axis=1)))


def estimate_colour_age(wound_table: pd.DataFrame | None, cal_status: str, calibration_info: dict | None = None) -> dict:
    """Heuristic day range derived from dominant bruise color bands. Prototype only."""
    empty = {
        'status': 'ยังประเมินไม่ได้',
        'ช่วงวัน': None,
        'ค่ากลางช่วง': None,
        'ความเชื่อมั่น': 'ต่ำ',
        'คะแนนความเชื่อมั่น': 0,
        'หลักฐานสี': None,
        'เหตุผล': 'ยังไม่มีสีแผล/สเกลที่ใช้ได้'
    }
    if wound_table is None:
        return empty
    if cal_status != 'พอใช้สำหรับต้นแบบ':
        return {**empty, 'เหตุผล': 'คุณภาพ calibration ของสเกลไม่ผ่านเกณฑ์ต้นแบบ'}

    counts = {name: float(wound_table.loc[wound_table['ชื่อสี'] == name, 'เปอร์เซ็นต์'].sum())
              for name in COLOUR_DAY_BANDS}
    coverage = sum(counts.values())
    if coverage < 60:
        return {**empty, 'เหตุผล': f'สีที่ตรง 6 ช่องสเกลมีเพียง {coverage:.1f}%'}

    dominant = max(counts, key=counts.get)
    held = np.nan
    if calibration_info is not None and 'table' in calibration_info:
        check = calibration_info['table']
        row = check.loc[check['ชื่อสี'] == dominant]
        if len(row):
            held = float(row.iloc[0]['held-out ΔE00'])
            if not np.isfinite(held) or held > 12:
                return {**empty, 'เหตุผล': f'สีแผลเด่น {dominant} ยังไม่ผ่านการตรวจปรับเทียบรายสี (held-out ΔE00={held:.1f})'}

    groups = {}
    for name, pct in counts.items():
        band = COLOUR_DAY_BANDS[name]
        groups[band] = groups.get(band, 0.0) + pct

    ordered = sorted(groups.items(), key=lambda pair: pair[1], reverse=True)
    top_band, top_pct = ordered[0]
    evidence = pd.DataFrame([
        {'ช่วงวันตามสี': f'{lo}–{hi} วัน', 'สีรวมในกลุ่ม %': round(pct, 1)}
        for (lo, hi), pct in ordered
    ])

    if top_pct < 40:
        return {**empty, 'หลักฐานสี': evidence, 'เหตุผล': 'ไม่มีกลุ่มสีเด่นอย่างน้อย 40%; สีหลายช่วงปะปนกัน'}

    relevant = [band for band, pct in ordered if pct >= 15]
    lo = min(band[0] for band in relevant)
    hi = max(band[1] for band in relevant)
    if hi - lo > 8:
        return {**empty, 'หลักฐานสี': evidence, 'เหตุผล': f'สีหลายช่วงขัดกัน ({lo}–{hi} วันตามตาราง); ไม่ควรให้ตัวเลขเดียว'}

    midpoint = (lo + hi) / 2.0 if len(relevant) == 1 and top_pct >= 65 else None
    cv = float(calibration_info.get('LOOCV median ΔE00', 15)) if calibration_info else 15
    colour_quality = max(0.0, 1.0 - min(cv, 15.0) / 15.0)
    patch_quality = max(0.0, 1.0 - min(held if np.isfinite(held) else 15.0, 15.0) / 15.0)
    evidence_strength = min(1.0, coverage / 90.0) * 0.35 + min(1.0, top_pct / 70.0) * 0.35
    confidence_score = int(round(100.0 * min(0.65, evidence_strength + 0.15 * colour_quality + 0.15 * patch_quality)))

    confidence = ('จำกัด — ใช้เป็นช่วงคัดกรองของต้นแบบเท่านั้น' if confidence_score >= 50
                  else 'ต่ำ — สีและภาพถ่ายยังไม่พอสำหรับระบุอายุแผล')
    reason = (f'กลุ่มสีเด่น {top_pct:.1f}% ของพิกเซลแผล; ไม่มีกลุ่มช่วงอื่น ≥15%'
              if len(relevant) == 1 else
              f'กลุ่มสีเด่น {top_pct:.1f}% แต่มีสีกลุ่มช่วงอื่น ≥15% จึงขยายช่วง')

    return {
        'status': 'ช่วงวันที่สอดคล้องกับสี (ต้นแบบ)',
        'ช่วงวัน': f'{lo}–{hi} วัน',
        'ค่ากลางช่วง': midpoint,
        'ความเชื่อมั่น': confidence,
        'คะแนนความเชื่อมั่น': confidence_score,
        'หลักฐานสี': evidence,
        'เหตุผล': reason
    }
