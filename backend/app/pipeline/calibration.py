from typing import Any, Tuple
import cv2
import numpy as np
import pandas as pd
from skimage.color import rgb2lab, deltaE_ciede2000
from .reference import REF, REF_LAB


def parse_quad(value: str | None, shape: Tuple[int, ...]) -> np.ndarray | None:
    if value is None or not str(value).strip():
        return None
    pts = []
    for pair in str(value).split(';'):
        xy = [float(v.strip()) for v in pair.split(',') if v.strip()]
        if len(xy) != 2:
            raise ValueError('Quad points must be formatted as x,y; x,y; x,y; x,y')
        pts.append(xy)
    if len(pts) != 4:
        raise ValueError('Must provide 4 points (top-left, top-right, bottom-right, bottom-left)')
    arr = np.asarray(pts, np.float32)
    if not np.isfinite(arr).all() or (arr < 0).any() or (arr > 1).any():
        raise ValueError('Scale quad coordinates must be normalized between 0 and 1')
    h, w = shape[:2]
    arr *= np.array([w - 1, h - 1], np.float32)
    if abs(cv2.contourArea(arr)) < 0.0003 * w * h:
        raise ValueError('Scale quad area is too small')
    return arr


def extract_strip(photo: np.ndarray, quad: np.ndarray | None, n: int) -> Tuple[np.ndarray, np.ndarray] | None:
    if quad is None:
        return None
    width, height = n * 100, 100
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], np.float32)
    M = cv2.getPerspectiveTransform(quad.astype(np.float32), dst)
    strip = cv2.warpPerspective(photo, M, (width, height))
    patches = []
    for i in range(n):
        patch = strip[35:65, i * 100 + 35:i * 100 + 65]
        patches.append(np.median(patch.reshape(-1, 3), axis=0).astype(np.uint8))
    return np.asarray(patches, dtype=np.uint8), strip


def srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    x = np.asarray(rgb, np.float64) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(x: np.ndarray) -> np.ndarray:
    x = np.clip(np.asarray(x, np.float64), 0, 1)
    y = np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return np.rint(np.clip(y, 0, 1) * 255).astype(np.uint8)


def fit_ccm(photo_patches: np.ndarray, ref_patches: np.ndarray, ridge: float = 0.5) -> np.ndarray:
    X = np.column_stack([srgb_to_linear(photo_patches), np.ones(len(photo_patches))])
    Y = srgb_to_linear(ref_patches)
    anchor = np.zeros((4, 3))
    anchor[:3] = np.eye(3)
    reg = np.diag([ridge, ridge, ridge, ridge * 4])
    weights = np.ones(len(X))
    for _ in range(8):
        A = (X.T * weights) @ X + reg
        B = (X.T * weights) @ Y + reg @ anchor
        matrix = np.linalg.solve(A, B)
        residual = np.linalg.norm(X @ matrix - Y, axis=1)
        scale = max(0.01, float(np.median(residual)) * 1.7)
        weights = np.minimum(1.0, scale / np.maximum(residual, 1e-6))
    return matrix


def fit_local_ccm(photo_patches: np.ndarray, ref_patches: np.ndarray,
                  ridge: float = 0.2, sigma: float = 0.12, local_ridge: float = 0.1) -> dict:
    base = fit_ccm(photo_patches, ref_patches, ridge=ridge)
    anchors = srgb_to_linear(photo_patches)
    X = np.column_stack([anchors, np.ones(len(anchors))])
    residual = srgb_to_linear(ref_patches) - X @ base
    d2 = np.sum((anchors[:, None, :] - anchors[None, :, :]) ** 2, axis=2)
    kernel = np.exp(-d2 / (2 * sigma * sigma))
    coef = np.linalg.solve(kernel + local_ridge * np.eye(len(anchors)), residual)
    return {'base': base, 'anchors': anchors, 'coef': coef, 'sigma': sigma}


def scale_ccm(model: Any, strength: float) -> Any:
    identity = np.zeros((4, 3))
    identity[:3] = np.eye(3)
    if isinstance(model, dict):
        scaled = model.copy()
        scaled['base'] = identity + strength * (model['base'] - identity)
        scaled['coef'] = strength * model['coef']
        return scaled
    return identity + strength * (model - identity)


def apply_ccm(rgb: np.ndarray, matrix: Any) -> np.ndarray:
    if matrix is None:
        return rgb.copy()
    h, w = rgb.shape[:2]
    lin = srgb_to_linear(rgb).reshape(-1, 3)
    if isinstance(matrix, dict):
        out = np.empty_like(lin)
        anchors = matrix['anchors']
        coef = matrix['coef']
        sigma = matrix['sigma']
        for start in range(0, len(lin), 50000):
            part = lin[start:start + 50000]
            base = part @ matrix['base'][:3] + matrix['base'][3]
            d2 = np.sum((part[:, None, :] - anchors[None, :, :]) ** 2, axis=2)
            kernel = np.exp(-d2 / (2 * sigma * sigma))
            out[start:start + len(part)] = base + kernel @ coef
        return linear_to_srgb(out.reshape(h, w, 3))
    X = np.column_stack([lin, np.ones(len(lin))])
    return linear_to_srgb((X @ matrix).reshape(h, w, 3))


def ciede(rgb: np.ndarray, ref_lab: np.ndarray) -> np.ndarray:
    pixels = np.asarray(rgb, np.uint8).reshape(-1, 3)
    lab = rgb2lab(pixels[None, :, :] / 255.0)[0]
    return np.column_stack([deltaE_ciede2000(lab, np.broadcast_to(r, lab.shape)) for r in ref_lab])


def calibration(photo: np.ndarray, skin_quad_text: str | None, bruise_quad_text: str | None) -> Tuple[Any, dict]:
    strips = []
    obs = []
    tgt = []
    names = []
    kinds = []
    for value, kind, n in [(skin_quad_text, 'skin', 10), (bruise_quad_text, 'bruise', 6)]:
        quad = parse_quad(value, photo.shape)
        out = extract_strip(photo, quad, n)
        if out is None:
            continue
        measured, strip = out
        strips.append((kind, quad, strip))
        ref = REF[REF['kind'] == kind]
        obs.extend(measured)
        tgt.extend(ref['RGB'].tolist())
        names.extend(ref['ชื่อสี'].tolist())
        kinds.extend([kind] * n)

    if len(obs) < 6:
        return None, {'status': 'ไม่มีพิกัดสเกลที่ใช้ได้', 'strips': strips}

    obs = np.asarray(obs, np.uint8)
    tgt = np.asarray(tgt, np.uint8)
    usable = (obs.min(axis=1) > 3) & (obs.max(axis=1) < 255)
    if usable.sum() < 6:
        return None, {'status': 'ช่องสเกลแสงล้นหรือมืดจนข้อมูลหาย', 'strips': strips}

    idx = np.flatnonzero(usable)
    bruise_selector = np.asarray(kinds) == 'bruise'
    target_lab = rgb2lab(tgt[None, :, :] / 255.0)[0]
    raw_de = deltaE_ciede2000(rgb2lab(obs[None, :, :] / 255.0)[0], target_lab)

    options = []
    candidates = [('global', 0.5, None, 0.0)]
    candidates += [('global', ridge, None, strength)
                   for ridge in (0.5, 0.2, 0.1)
                   for strength in (0.25, 0.5, 0.75, 1.0)]
    if usable.sum() >= 8 and (usable & bruise_selector).sum() >= 4:
        candidates += [('local', 0.2, (0.12, 0.1), strength)
                       for strength in (0.25, 0.5, 0.75, 1.0)]

    for kind, ridge, local_params, strength in candidates:
        held = []
        for k in idx:
            train = usable.copy()
            train[k] = False
            fold = (fit_local_ccm(obs[train], tgt[train], ridge=ridge,
                                  sigma=local_params[0], local_ridge=local_params[1])
                    if kind == 'local' else fit_ccm(obs[train], tgt[train], ridge=ridge))
            pred = apply_ccm(obs[k].reshape(1, 1, 3), scale_ccm(fold, strength)).reshape(1, 3)
            held.append(float(ciede(pred, target_lab[k:k + 1])[0, 0]))
        held = np.asarray(held)
        bruise_held = held[bruise_selector[idx]]
        regression = np.maximum(held - raw_de[idx], 0)
        objective = (np.median(held) + 0.15 * np.median(bruise_held) if len(bruise_held)
                     else np.median(held)) + 0.10 * np.percentile(held, 90)
        objective += 0.25 * np.median(regression) + 0.10 * np.percentile(regression, 90)
        options.append((float(objective), kind, ridge, local_params, strength, held))

    safe = []
    for option in options:
        held = option[-1]
        bruise_held = held[bruise_selector[idx]]
        if len(bruise_held) and np.max(bruise_held) <= 10:
            safe.append(option)
    pool = safe if safe else [option for option in options
                            if len(option[-1][bruise_selector[idx]]) and
                            np.max(option[-1][bruise_selector[idx]]) <= 12]
    if not pool:
        pool = options

    _, selected_kind, selected_ridge, selected_local, selected_strength, cv = min(
        pool, key=lambda entry: entry[0])

    fitted = (fit_local_ccm(obs[usable], tgt[usable], ridge=selected_ridge,
                            sigma=selected_local[0], local_ridge=selected_local[1])
              if selected_kind == 'local' else fit_ccm(obs[usable], tgt[usable], ridge=selected_ridge))
    model = scale_ccm(fitted, selected_strength)

    cv_median = float(np.median(cv))
    bruise_cv = cv[bruise_selector[idx]]
    bruise_worst = float(bruise_cv.max()) if len(bruise_cv) else np.inf
    status = ('พอใช้สำหรับต้นแบบ' if cv_median <= 8 and bruise_worst <= 10 else
              ('ควรตรวจแสง/พิกัดสเกล' if cv_median <= 12 and bruise_worst <= 15
               else 'ไม่ผ่าน: ห้ามตีความสีแผลหรือช่วงวัน'))

    corrected_patches = apply_ccm(obs.reshape(-1, 1, 3), model).reshape(-1, 3)
    before_de = raw_de
    after_de = deltaE_ciede2000(rgb2lab(corrected_patches[None, :, :] / 255.0)[0], target_lab)
    cv_by_patch = np.full(len(obs), np.nan)
    cv_by_patch[idx] = cv

    table = pd.DataFrame({
        'ประเภท': kinds,
        'ชื่อสี': names,
        'RGB ที่ถ่าย': [tuple(int(v) for v in row) for row in obs],
        'RGB หลังปรับ': [tuple(int(v) for v in row) for row in corrected_patches],
        'RGB ต้นฉบับ': [tuple(int(v) for v in row) for row in tgt],
        'ΔE00 ก่อน': before_de,
        'ΔE00 หลัง': after_de,
        'ΔE00 ดีขึ้น': before_de - after_de,
        'held-out ΔE00': cv_by_patch,
        'ใช้สร้างโมเดล': usable
    })

    return model, {
        'status': status,
        'LOOCV median ΔE00': cv_median,
        'bruise LOOCV worst ΔE00': bruise_worst if np.isfinite(bruise_worst) else None,
        'selection note': 'จำกัดความคลาดเคลื่อนของช่องสีแผลไม่เกิน 10 ΔE00' if safe else 'ไม่พบโมเดลที่ทุกช่องสีแผลต่ำกว่า 10 ΔE00',
        'selected ridge': selected_ridge,
        'method': selected_kind,
        'correction strength': selected_strength,
        'median ΔE00 before': float(np.median(before_de[usable])),
        'median ΔE00 after': float(np.median(after_de[usable])),
        'strips': strips,
        'table': table
    }
