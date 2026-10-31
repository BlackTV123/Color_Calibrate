from typing import Tuple, Any
import cv2
import numpy as np
from skimage.color import rgb2lab, deltaE_ciede2000
from .calibration import ciede
from .colour import paired_pixels
from .reference import REF_LAB


def wound_mask(corrected: np.ndarray, wound_box: Tuple[int, int, int, int], skin_pixels: np.ndarray) -> Tuple[np.ndarray, float, np.ndarray]:
    x0, y0, x1, y1 = wound_box
    roi = corrected[y0:y1, x0:x1]
    skin_lab = np.median(rgb2lab(skin_pixels[None, :, :] / 255.0)[0], axis=0)
    lab = rgb2lab(roi / 255.0)
    de = deltaE_ciede2000(lab, np.broadcast_to(skin_lab, lab.shape))
    chroma = np.linalg.norm(lab[..., 1:] - skin_lab[1:], axis=2)
    darkness = skin_lab[0] - lab[..., 0]
    exposure = (roi.max(axis=2) > 8) & (roi.max(axis=2) < 251)
    proposed = ((de >= 12) & ((chroma >= 8) | (darkness >= 13))) & exposure
    mask = cv2.morphologyEx(proposed.astype(np.uint8), cv2.MORPH_OPEN,
                           cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE,
                          cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))).astype(bool)
    full = np.zeros(corrected.shape[:2], bool)
    full[y0:y1, x0:x1] = mask
    return full, float(mask.mean()), de


def estimate_wound_size(mask: np.ndarray, calibration_info: dict) -> dict:
    strips = calibration_info.get('strips', [])
    preferred = [part for part in strips if part[0] == 'bruise'] or strips
    if not preferred:
        return {'status': 'ยังวัดไม่ได้: ไม่ได้ระบุตำแหน่งไม้บรรทัดบนการ์ด'}
    quad = preferred[0][1]
    dst = np.array([[0, 0], [10, 0], [0, 1]], np.float32)
    affine = cv2.getAffineTransform(quad[[0, 1, 3]].astype(np.float32), dst)
    area_factor = abs(float(np.linalg.det(affine[:, :2])))
    if area_factor <= 0 or not np.isfinite(area_factor):
        return {'status': 'ยังวัดไม่ได้: พิกัดสเกลไม่ถูกต้อง'}

    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if n <= 1:
        return {'status': 'ยังวัดไม่ได้: ไม่พบ mask แผล'}
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, w, h, area = [int(v) for v in stats[k]]
    ys, xs = np.where(labels == k)
    points = np.column_stack([xs, ys]).astype(np.float32)
    if len(points) > 50000:
        points = points[::int(np.ceil(len(points) / 50000))]
    cm_points = points @ affine[:, :2].T + affine[:, 2]
    _, (side_a, side_b), _ = cv2.minAreaRect(cm_points.astype(np.float32))
    short, long = sorted([float(side_a), float(side_b)])
    return {
        'status': 'ประมาณจากรอยสีที่จับได้',
        'กว้าง ซม.': round(short, 2),
        'ยาว ซม.': round(long, 2),
        'พื้นที่ ซม.²': round(float(area * area_factor), 2),
        'พิกเซลของรอยสี': int(area),
        'หมายเหตุ': 'ค่าประมาณ: แผล/การ์ดต้องอยู่ระนาบใกล้กัน และกรอบกับ mask ต้องถูกตรวจด้วยตา'
    }


def card_exclusion_mask(photo_shape: Tuple[int, ...], small_shape: Tuple[int, ...],
                        card_H: np.ndarray | None = None, marker_card: bool = False) -> np.ndarray:
    h, w = photo_shape[:2]
    sh, sw = small_shape[:2]
    excluded = np.zeros((sh, sw), np.uint8)
    if card_H is None:
        return excluded
    for polygon in ([[0, 0], [1537, 0], [1537, 355], [0, 355]],
                    [[1537, 355], [1890, 355], [1890, 1890], [1537, 1890]]):
        quad = cv2.perspectiveTransform(np.float32(polygon).reshape(-1, 1, 2), card_H).reshape(-1, 2)
        quad *= np.array([sw / w, sh / h], np.float32)
        if np.isfinite(quad).all():
            cv2.fillPoly(excluded, [quad.astype(np.int32)], 255)

    top = cv2.perspectiveTransform(
        np.float32([[1537, 355], [1890, 355]]).reshape(-1, 1, 2), card_H).reshape(-1, 2)
    if np.isfinite(top).all():
        margin = 0.01 if marker_card else 0.03
        left = max(0, int((min(top[:, 0]) - margin * w) * sw / w))
        right = min(sw, int((max(top[:, 0]) + 0.08 * w) * sw / w))
        beginning = max(0, int((min(top[:, 1]) - 0.01 * h) * sh / h))
        if right > left:
            cv2.rectangle(excluded, (left, beginning), (right, sh - 1), 255, -1)
    return cv2.dilate(excluded, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))


def skin_region_proposal(raw: np.ndarray, excluded: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    sh, sw = raw.shape[:2]
    ycc = cv2.cvtColor(raw, cv2.COLOR_RGB2YCrCb)
    hsv = cv2.cvtColor(raw, cv2.COLOR_RGB2HSV)
    probable = ((ycc[..., 1] >= 135) & (ycc[..., 1] <= 175) &
                (ycc[..., 2] >= 80) & (ycc[..., 2] <= 125) & (hsv[..., 2] > 70) & (excluded == 0))
    probable = cv2.morphologyEx(probable.astype(np.uint8), cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(probable, 8)
    if count <= 1:
        raise ValueError('Cannot automatically detect skin: skin does not stand out from background')
    component = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    if stats[component, cv2.CC_STAT_AREA] < 0.04 * sw * sh:
        raise ValueError('Detected skin region is too small')
    skin = (labels == component).astype(np.uint8)
    skin_inner = cv2.erode(skin, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))).astype(bool)
    skin_inner &= (excluded == 0)
    contours, _ = cv2.findContours(skin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    largest = max(contours, key=cv2.contourArea)
    support = np.zeros((sh, sw), np.uint8)
    cv2.fillConvexPoly(support, cv2.convexHull(largest), 1)
    support = cv2.erode(support, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))).astype(bool)
    support &= (excluded == 0)
    if skin_inner.sum() < 400:
        raise ValueError('Normal skin pixels insufficient for color comparison')

    f = raw.astype(np.float32)
    R, G, B = f[..., 0], f[..., 1], f[..., 2]
    warm = ((R > 1.07 * G) & (G > 1.04 * B) & (R > 70) &
            (ycc[..., 1] >= 133) & (ycc[..., 1] <= 190) &
            (ycc[..., 2] >= 75) & (ycc[..., 2] <= 140) & (excluded == 0))
    warm = cv2.morphologyEx(warm.astype(np.uint8), cv2.MORPH_CLOSE,
                          cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)))
    wn, wl, ws, _ = cv2.connectedComponentsWithStats(warm, 8)
    overlap = np.bincount(wl[skin.astype(bool)], minlength=wn)
    overlap[0] = 0
    main = int(np.argmax(overlap))
    body = wl == main if main > 0 else skin.astype(bool)
    if main > 0:
        x0, y0, bw0, bh0 = ws[main, :4]
        for i in range(1, wn):
            if i == main or ws[i, cv2.CC_STAT_AREA] < 0.25 * ws[main, cv2.CC_STAT_AREA]:
                continue
            xi, yi, bwi, bhi = ws[i, :4]
            gap = max(yi - (y0 + bh0), y0 - (yi + bhi), 0)
            shared = max(0, min(x0 + bw0, xi + bwi) - max(x0, xi))
            if gap < 0.18 * sh and shared > 0.15 * min(bw0, bwi):
                body |= (wl == i)
    body = cv2.morphologyEx(body.astype(np.uint8), cv2.MORPH_OPEN,
                          cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
    body = cv2.morphologyEx(body, cv2.MORPH_CLOSE,
                          cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))).astype(bool)
    body &= (excluded == 0)
    if body.sum() < skin_inner.sum() * 0.7:
        body = skin_inner.copy()
    return skin_inner, support, body


def bruise_region_proposal(rgb: np.ndarray, support: np.ndarray,
                           skin_inner: np.ndarray, body: np.ndarray, excluded: np.ndarray) -> np.ndarray:
    'Find a bruise seed, grow nearby changed colors, and fill safe internal gaps.'
    sh, sw = rgb.shape[:2]
    lab = rgb2lab(rgb / 255)
    local = cv2.GaussianBlur(lab.astype(np.float32), (0, 0), sigmaX=18)
    local_de = deltaE_ciede2000(lab, local)
    local_chroma = np.linalg.norm(lab[..., 1:] - local[..., 1:], axis=2)
    distances = ciede(rgb.reshape(-1, 3), REF_LAB).reshape(sh, sw, 16)
    skin_de = distances[..., :10].min(axis=2)
    bruise_de = distances[..., 10:].min(axis=2)
    margin = skin_de - bruise_de
    normal_lab = np.median(lab[skin_inner], axis=0)
    relative_de = deltaE_ciede2000(lab, np.broadcast_to(normal_lab, lab.shape))
    purple_shift = (normal_lab[2] - lab[..., 2] > 10) & (lab[..., 1] > 8) & (rgb[..., 2] >= 0.83 * rgb[..., 1])
    red_shift = (lab[..., 1] - normal_lab[1] > 14) & (lab[..., 1] > 25) & (rgb[..., 2] >= 0.8 * rgb[..., 1])
    skin_anomaly = (relative_de > 18) & (normal_lab[0] - lab[..., 0] > 12) & (purple_shift | red_shift)
    exposure = (rgb.max(axis=2) > 8) & (rgb.max(axis=2) < 251)
    palette_match = (bruise_de < 16) & ((margin > 7) | (margin > 5) & (local_de > 8) & (local_chroma > 6))
    candidate = support & exposure & (palette_match | skin_anomaly)
    candidate = cv2.morphologyEx(candidate.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    n, parts, regions, _ = cv2.connectedComponentsWithStats(candidate, 8)
    lesion = np.zeros((sh, sw), bool)
    small_min = max(40, int(support.sum() * 0.00015))
    fallback_min = max(150, int(support.sum() * 0.002))
    border = max(3, int(round(0.01 * min(sh, sw))))
    palette_choices = []
    anomaly_choices = []
    for part_id in range(1, n):
        x, y, bw, bh, area = regions[part_id]
        if area < small_min or area > 0.12 * support.sum():
            continue
        if x <= border or y <= border or x + bw >= sw - border or (y + bh >= sh - border):
            continue
        region = parts == part_id
        palette_pixels = int(np.count_nonzero(palette_match & region))
        palette_fraction = palette_pixels / max(1, int(area))
        anomaly_fraction = float(np.mean(skin_anomaly[region]))
        if palette_pixels >= 20 and palette_fraction >= 0.12:
            palette_choices.append((palette_pixels, float(palette_fraction), int(area), part_id))
        elif area >= fallback_min and anomaly_fraction >= 0.5:
            anomaly_choices.append((int(area), float(anomaly_fraction), part_id))
    if palette_choices:
        k = max(palette_choices, key=lambda row: (row[0], row[1]))[3]
        lesion = parts == k
    elif anomaly_choices:
        k = max(anomaly_choices, key=lambda row: (row[0], row[1]))[2]
        lesion = parts == k
    if not lesion.any():
        return lesion
    seed = lesion.copy()
    bw = regions[k, cv2.CC_STAT_WIDTH]
    bh = regions[k, cv2.CC_STAT_HEIGHT]
    radius = max(24, min(36, int(round(0.55 * max(bw, bh)))))
    near = cv2.dilate(seed.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))).astype(bool)
    outer = cv2.dilate(seed.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (4 * radius + 1, 4 * radius + 1))).astype(bool)
    ring = outer & ~near & skin_inner
    normal = np.median(lab[ring], axis=0) if ring.sum() >= 400 else normal_lab
    edge_de = deltaE_ciede2000(lab, np.broadcast_to(normal, lab.shape))
    edge_colour = (normal[1] - lab[..., 1] > 5) | (normal[2] - lab[..., 2] > 7) | (lab[..., 1] - normal[1] > 3)
    body_near = cv2.dilate(body.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))).astype(bool)
    grown = near & body_near & (excluded == 0) & (lab[..., 1] > 5) & (edge_de > 5) & edge_colour | seed
    grown = cv2.morphologyEx(grown.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    total, parts, _, _ = cv2.connectedComponentsWithStats(grown, 8)
    core_overlap = np.bincount(parts[seed], minlength=total)
    core_overlap[0] = 0
    lesion = parts == int(np.argmax(core_overlap))
    contours, _ = cv2.findContours(lesion.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return lesion
    filled = np.zeros((sh, sw), np.uint8)
    cv2.drawContours(filled, contours, -1, 1, -1)
    main = max(contours, key=cv2.contourArea)
    hull = np.zeros((sh, sw), np.uint8)
    cv2.drawContours(hull, [cv2.convexHull(main)], -1, 1, -1)
    if hull.sum() <= filled.sum() * 1.25:
        filled = hull
    return filled.astype(bool)


def auto_skin_and_wound(photo: np.ndarray, corrected: np.ndarray,
                        card_H: np.ndarray | None = None, marker_card: bool = False):
    'Run the automatic skin and bruise detector and return full-resolution masks.'
    h, w = photo.shape[:2]
    scale = 720 / max(h, w)
    sw, sh = (max(40, round(w * scale)), max(40, round(h * scale)))
    raw = cv2.resize(photo, (sw, sh))
    rgb = cv2.resize(corrected, (sw, sh))
    excluded = card_exclusion_mask(photo.shape, raw.shape, card_H, marker_card)
    skin_inner, support, body = skin_region_proposal(raw, excluded)
    lesion = bruise_region_proposal(rgb, support, skin_inner, body, excluded)
    wound_guard = lesion.astype(bool)
    if lesion.any():
        ys, xs = np.where(lesion)
        lesion_span = max(int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))
        sample_radius = max(55, min(150, int(round(1.35 * lesion_span))))
        near = cv2.dilate(lesion.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * sample_radius + 1, 2 * sample_radius + 1))).astype(bool)
        seed = skin_inner & near & ~cv2.dilate(lesion.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))).astype(bool)
        raw_lab = rgb2lab(raw / 255)
        normal = np.median(raw_lab[seed], axis=0) if seed.sum() >= 400 else np.median(raw_lab[skin_inner], axis=0)
        skin_de = deltaE_ciede2000(raw_lab, np.broadcast_to(normal, raw_lab.shape))
        grown_skin = body & ~wound_guard & (excluded == 0) & (skin_de < 20)
        grown_skin = cv2.morphologyEx(grown_skin.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
        grown_skin = cv2.morphologyEx(grown_skin, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
        count, labels, stats, _ = cv2.connectedComponentsWithStats(grown_skin, 8)
        anchor = cv2.dilate(lesion.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (51, 51))).astype(bool) & ~wound_guard
        overlap = np.bincount(labels[anchor], minlength=count) if count > 1 else np.zeros(count, dtype=int)
        if len(overlap):
            overlap[0] = 0
        components = np.where((overlap >= 20) & (stats[:, cv2.CC_STAT_AREA] >= 800))[0] if count > 1 else np.array([], dtype=int)
        if len(components):
            skin_inner = np.isin(labels, components)
        else:
            skin_inner = body & near & ~wound_guard
    else:
        skin_inner = skin_inner & ~wound_guard
    skin_full = cv2.resize(skin_inner.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST).astype(bool)
    lesion_full = cv2.resize(lesion.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST).astype(bool)
    skin_before, skin_pixels = paired_pixels(photo, corrected, skin_full)
    x, y, bw, bh = cv2.boundingRect(np.column_stack(np.where(skin_inner)[::-1]).astype(np.int32))
    skin_box = (int(x * w / sw), int(y * h / sh), int((x + bw) * w / sw), int((y + bh) * h / sh))
    wound_box = None
    if lesion_full.any():
        ys, xs = np.where(lesion_full)
        wound_box = (int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1))
    return (skin_before, skin_pixels, skin_box, skin_full, lesion_full, wound_box, float(lesion.sum() / max(1, support.sum())))


def card_crop_box(shape: Tuple[int, ...], card: dict | None, wound_box: Tuple[int, int, int, int] | None = None) -> Tuple[int, int, int, int]:
    h, w = shape[:2]
    if not card or card.get('H') is None:
        return (0, 0, w, h)
    outline = np.float32([[0, 0], [1890, 0], [1890, 1890], [1537, 1890], [1537, 355], [0, 355]])
    projected = cv2.perspectiveTransform(outline.reshape(-1, 1, 2), card['H']).reshape(-1, 2)
    if not np.isfinite(projected).all():
        return (0, 0, w, h)
    x0, y0 = np.floor(projected.min(axis=0)).astype(int)
    x1, y1 = np.ceil(projected.max(axis=0)).astype(int)
    if wound_box is not None:
        wx0, wy0, wx1, wy1 = wound_box
        x0 = min(x0, wx0)
        y0 = min(y0, wy0)
        x1 = max(x1, wx1)
        y1 = max(y1, wy1)
    padding = max(8, int(round(0.012 * max(h, w))))
    x0 = max(0, x0 - padding)
    y0 = max(0, y0 - padding)
    x1 = min(w, x1 + padding)
    y1 = min(h, y1 + padding)
    if x1 - x0 < 50 or y1 - y0 < 50:
        return (0, 0, w, h)
    return (int(x0), int(y0), int(x1), int(y1))
