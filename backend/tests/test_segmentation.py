import numpy as np
import pytest

from app.pipeline.segment import bruise_region_proposal


@pytest.mark.parametrize(
    "bounds, detected",
    [
        ((145, 155, 145, 155), True),
        ((0, 20, 140, 160), False),
        ((70, 230, 70, 230), False),
        (None, False),
    ],
)
def test_bruise_candidate_selection(bounds, detected):
    """Retain a small interior patch; reject edge, oversized, and absent patches."""
    rgb = np.full((300, 300, 3), (205, 160, 115), dtype=np.uint8)
    support = np.ones(rgb.shape[:2], dtype=bool)
    normal_skin = support.copy()
    if bounds is not None:
        y0, y1, x0, x1 = bounds
        rgb[y0:y1, x0:x1] = (167, 44, 50)
        normal_skin[y0:y1, x0:x1] = False
    mask = bruise_region_proposal(
        rgb, support, normal_skin, support, np.zeros(rgb.shape[:2], dtype=np.uint8)
    )
    assert bool(mask.any()) is detected
    if detected:
        assert mask[150, 150]
        assert mask.sum() < 200
