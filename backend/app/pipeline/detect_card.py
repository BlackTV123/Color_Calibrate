from typing import Tuple, Any
from itertools import permutations
import cv2
import numpy as np
from skimage.color import rgb2lab, deltaE_ciede2000
from .calibration import calibration, extract_strip
from .reference import SCALE_RGB, REF_LAB


def _get_marker_template() -> np.ndarray:
    """Returns a grayscale template of the checker-circle marker."""
    if SCALE_RGB is not None and SCALE_RGB.shape[0] >= 355 and SCALE_RGB.shape[1] >= 354:
        return cv2.cvtColor(SCALE_RGB[:355, :354], cv2.COLOR_RGB2GRAY)
    # Synthetic fallback: 355x354 image with a concentric crosshair / checker-circle
    tmpl = np.full((355, 354), 245, dtype=np.uint8)
    center = (177, 177)
    cv2.circle(tmpl, center, 140, 20, 4)
    cv2.circle(tmpl, center, 100, 20, -1)
    cv2.circle(tmpl, center, 60, 245, -1)
    cv2.circle(tmpl, center, 20, 20, -1)
    cv2.line(tmpl, (177, 10), (177, 344), 20, 3)
    cv2.line(tmpl, (10, 177), (344, 177), 20, 3)
    return tmpl


def auto_find_card_markers(photo: np.ndarray) -> Tuple[dict | None, str]:
    """Fallback when ruler features repeat: locate the three printed checker-circle squares."""
    h, w = photo.shape[:2]
    resize = 720.0 / max(h, w)
    small = cv2.resize(photo, None, fx=resize, fy=resize)
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    template = _get_marker_template()

    hits = []
    for factor in (0.18, 0.22, 0.26, 0.30, 0.34, 0.38):
        base = cv2.resize(template, None, fx=factor, fy=factor)
        for turn in range(4):
            target = np.rot90(base, turn).copy()
            correlation = cv2.matchTemplate(gray, target, cv2.TM_CCOEFF_NORMED)
            for _ in range(4):
                _, score, _, xy = cv2.minMaxLoc(correlation)
                if score > 0.58:
                    center = (np.asarray(xy, np.float32) + target.shape[0] / 2.0) / resize
                    hits.append((float(score), center, float(target.shape[0] / resize)))
                cv2.rectangle(correlation, (xy[0] - 30, xy[1] - 30),
                              (xy[0] + 30, xy[1] + 30), -1, -1)

    unique = []
    for hit in sorted(hits, key=lambda row: row[0], reverse=True):
        if all(np.linalg.norm(hit[1] - old[1]) > max(20.0 / resize, 0.30 * hit[2]) for old in unique):
            unique.append(hit)

    if len(unique) < 3:
        return None, 'ไม่พบวงกลมมุมการ์ดครบ 3 จุด'

    source = np.float32([[177, 177], [1713, 177], [1713, 1713]])
    choices = []
    for tl, tr, br in permutations(unique[:5], 3):
        across = tl[1] - tr[1]
        down = br[1] - tr[1]
        if min(np.linalg.norm(across), np.linalg.norm(down)) < 2.5 * max(tl[2], tr[2]):
            continue
        orth = abs(np.dot(across, down)) / (np.linalg.norm(across) * np.linalg.norm(down))
        if orth > 0.42 or not 0.65 < tl[2] / tr[2] < 1.5:
            continue
        base = cv2.getAffineTransform(source, np.float32([tl[1], tr[1], br[1]]))
        H = np.vstack([base, [0, 0, 1]])
        axis = H[:2, 1]
        axis = axis / max(1e-6, np.linalg.norm(axis))

        for offset in (0, 0.05, 0.10, 0.15, 0.20):
            trial = H.copy()
            trial[:2, 2] += axis * offset * np.median([tl[2], tr[2]])
            quads = []
            observed = []
            for y0, y1, n in ((0, 118, 10), (118, 235, 6)):
                q = cv2.perspectiveTransform(
                    np.float32([[354, y0], [1537, y0], [1537, y1], [354, y1]]).reshape(-1, 1, 2), trial).reshape(-1, 2)
                if ((q[:, 0] < 0) | (q[:, 0] >= w) | (q[:, 1] < 0) | (q[:, 1] >= h)).any():
                    break
                patch_out = extract_strip(photo, q, n)
                if patch_out is None:
                    break
                patch, _ = patch_out
                observed.extend(patch)
                quads.append('; '.join(f'{x / (w - 1):.5f},{y / (h - 1):.5f}' for x, y in q))

            if len(quads) != 2:
                continue

            raw = np.asarray(observed, np.uint8)
            raw_de = deltaE_ciede2000(rgb2lab(raw[None, :, :] / 255.0)[0], REF_LAB)
            if np.median(raw_de) > 18:
                continue

            try:
                _, check = calibration(photo, *quads)
            except (ValueError, np.linalg.LinAlgError):
                continue

            cv_error = check.get('LOOCV median ΔE00', np.inf)
            bruise_worst = check.get('bruise LOOCV worst ΔE00', np.inf)
            if (not np.isfinite(cv_error) or cv_error > 12 or
                    not np.isfinite(bruise_worst) or bruise_worst > 15):
                continue

            choices.append({
                'H': trial,
                'skin_quad': quads[0],
                'bruise_quad': quads[1],
                'inliers': 3,
                'cv_de': float(cv_error),
                'bruise_worst': float(bruise_worst),
                'score': float(cv_error) + 0.30 * float(bruise_worst) + 0.12 * float(np.median(raw_de)),
                'marker_score': min(tl[0], tr[0], br[0])
            })

    if not choices:
        return None, 'พบวงกลมการ์ด แต่ช่องสีไม่ผ่านการตรวจพิกัด/แสง'

    best = min(choices, key=lambda row: row['score'])
    return best, (f"จับสเกลจากวงกลม 3 จุด, median ΔE00={best['cv_de']:.1f}, "
                 f"สีแผลแย่สุด={best['bruise_worst']:.1f}")


def auto_find_card(photo: np.ndarray) -> Tuple[dict | None, str]:
    """Find the printed L-card using SIFT feature matching with fallback to marker correlation."""
    if not hasattr(cv2, 'SIFT_create') or SCALE_RGB is None:
        return auto_find_card_markers(photo)

    ref = SCALE_RGB[:355, :1537]
    sift = cv2.SIFT_create(nfeatures=6000)
    rk, rd = sift.detectAndCompute(cv2.cvtColor(ref, cv2.COLOR_RGB2GRAY), None)
    pk, photo_desc = sift.detectAndCompute(cv2.cvtColor(photo, cv2.COLOR_RGB2GRAY), None)
    if rd is None or photo_desc is None:
        return auto_find_card_markers(photo)

    pairs = cv2.BFMatcher().knnMatch(rd, photo_desc, k=2)
    h, w = photo.shape[:2]
    choices = []
    for ratio in (0.65, 0.70):
        good = [m for m, n in pairs if m.distance < ratio * n.distance]
        for subset in ('all', 'strip'):
            kept = [m for m in good if subset == 'all' or rk[m.queryIdx].pt[0] > 354]
            if len(kept) < 12:
                continue
            src = np.float32([rk[m.queryIdx].pt for m in kept])
            dst = np.float32([pk[m.trainIdx].pt for m in kept])
            H, inliers = cv2.findHomography(src, dst, cv2.RANSAC, 4)
            if H is None or inliers is None or int(inliers.sum()) < 12:
                continue
            overall = cv2.perspectiveTransform(
                np.float32([[354, 0], [1537, 0], [1537, 235], [354, 235]]).reshape(-1, 1, 2), H).reshape(-1, 2)
            if not np.isfinite(overall).all():
                continue
            if (overall[:, 0] < 0).any() or (overall[:, 0] >= w).any() or (overall[:, 1] < 0).any() or (overall[:, 1] >= h).any():
                continue
            area = abs(cv2.contourArea(overall.astype(np.float32))) / (w * h)
            if not 0.003 < area < 0.25:
                continue
            long = np.mean([np.linalg.norm(overall[1] - overall[0]), np.linalg.norm(overall[2] - overall[3])])
            short = np.mean([np.linalg.norm(overall[3] - overall[0]), np.linalg.norm(overall[2] - overall[1])])
            if short <= 0 or long / short < 3:
                continue
            quads = []
            for y0, y1 in [(0, 118), (118, 235)]:
                q = cv2.perspectiveTransform(
                    np.float32([[354, y0], [1537, y0], [1537, y1], [354, y1]]).reshape(-1, 1, 2), H).reshape(-1, 2)
                quads.append('; '.join(f'{x / (w - 1):.5f},{y / (h - 1):.5f}' for x, y in q))
            try:
                _, check = calibration(photo, *quads)
            except (ValueError, np.linalg.LinAlgError):
                continue
            error = check.get('LOOCV median ΔE00', np.inf)
            if not np.isfinite(error) or error > 15:
                continue
            choices.append({
                'H': H,
                'skin_quad': quads[0],
                'bruise_quad': quads[1],
                'inliers': int(inliers.sum()),
                'cv_de': float(error),
                'score': float(error) + 15.0 / max(1, int(inliers.sum()))
            })

    if not choices:
        return auto_find_card_markers(photo)
    best = min(choices, key=lambda x: x['score'])
    return best, f"จับสเกลอัตโนมัติ: {best['inliers']} จุดตรงกัน, ช่องทดสอบ ΔE00={best['cv_de']:.1f}"
