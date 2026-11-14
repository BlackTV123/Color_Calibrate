import json

import numpy as np
import pandas as pd

from app.serialize import build_response, to_json_safe


def test_json_safe_preserves_boolean_types_and_numeric_values():
    source = {"has_wound": True, "calibration": {"is_calibrated": False},
              "nested": [np.bool_(True), np.bool_(False), 0, 1, np.int64(3), np.float64(1.5)]}
    wire = json.loads(json.dumps(to_json_safe(source), allow_nan=False))
    assert wire["has_wound"] is True
    assert wire["calibration"]["is_calibrated"] is False
    assert wire["nested"][0] is True
    assert wire["nested"][1] is False
    assert type(wire["nested"][2]) is int
    assert type(wire["nested"][3]) is int
    assert wire["nested"][4:] == [3, 1.5]


def test_analysis_response_flags_are_json_booleans_with_or_without_wound():
    for wound in (None, pd.DataFrame()):
        result = {"wound_table": wound, "calibration": {"status": "Uncalibrated"}}
        wire = json.loads(json.dumps(to_json_safe(build_response(result)), allow_nan=False))
        assert wire["has_wound"] is (wound is not None)
        assert wire["calibration"]["is_calibrated"] is False
        assert isinstance(wire["color_profile"]["mean_rgb"], list)
        assert isinstance(wire["age_estimate"], dict)
