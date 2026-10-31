import json

import numpy as np
import pandas as pd
import pytest

from app.pipeline.colour import measured_colour_clusters
from app.serialize import build_response, serialize_measured_colours


def test_measured_colours_preserve_actual_pipeline_columns():
    rng = np.random.default_rng(42)
    pixels = np.clip(rng.normal((170, 120, 90), 15, (1200, 3)), 0, 255).astype(np.uint8)
    table = measured_colour_clusters(pixels, "skin")
    assert table is not None and len(table) > 0
    assert "\u0e0a\u0e37\u0e48\u0e2d\u0e2a\u0e35\u0e17\u0e35\u0e48\u0e1e\u0e1a" in table.columns
    assert "RGB \u0e17\u0e35\u0e48\u0e1e\u0e1a" in table.columns
    assert "\u0e40\u0e1b\u0e2d\u0e23\u0e4c\u0e40\u0e0b\u0e47\u0e19\u0e15\u0e4c" in table.columns
    assert "\u0e1c\u0e25\u0e40\u0e17\u0e35\u0e22\u0e1a\u0e2a\u0e40\u0e01\u0e25" in table.columns
    assert "\u0394E00 \u0e16\u0e36\u0e07\u0e2a\u0e40\u0e01\u0e25" in table.columns

    rows = serialize_measured_colours(table)
    for actual, (_, expected) in zip(rows, table.iterrows()):
        assert actual["name"] == expected["\u0e0a\u0e37\u0e48\u0e2d\u0e2a\u0e35\u0e17\u0e35\u0e48\u0e1e\u0e1a"] != ""
        assert actual["rgb"] == list(expected["RGB \u0e17\u0e35\u0e48\u0e1e\u0e1a"])
        assert len(actual["rgb"]) == 3
        assert actual["percent"] == pytest.approx(expected["\u0e40\u0e1b\u0e2d\u0e23\u0e4c\u0e40\u0e0b\u0e47\u0e19\u0e15\u0e4c"])
        assert actual["percent"] > 0
        assert actual["scale_match"] == expected["\u0e1c\u0e25\u0e40\u0e17\u0e35\u0e22\u0e1a\u0e2a\u0e40\u0e01\u0e25"] != ""
        assert actual["de00"] == pytest.approx(expected["\u0394E00 \u0e16\u0e36\u0e07\u0e2a\u0e40\u0e01\u0e25"])
    assert sum(row["percent"] for row in rows) == pytest.approx(100)
    response = build_response({"skin_measured_colours": table, "wound_measured_colours": table})
    assert response["measured_colours"] == {"skin": rows, "wound": rows}
    json.dumps(response["measured_colours"], ensure_ascii=False, allow_nan=False)


def test_measured_colours_missing_and_nonfinite_values():
    assert serialize_measured_colours(None) == []
    table = pd.DataFrame([{
        "\u0e0a\u0e37\u0e48\u0e2d\u0e2a\u0e35\u0e17\u0e35\u0e48\u0e1e\u0e1a": "\u0e19\u0e49\u0e33\u0e15\u0e32\u0e25\u0e40\u0e02\u0e49\u0e21", "HEX": "#652C0B", "RGB \u0e17\u0e35\u0e48\u0e1e\u0e1a": (101, 44, 11),
        "\u0e40\u0e1b\u0e2d\u0e23\u0e4c\u0e40\u0e0b\u0e47\u0e19\u0e15\u0e4c": 100.0, "\u0e1c\u0e25\u0e40\u0e17\u0e35\u0e22\u0e1a\u0e2a\u0e40\u0e01\u0e25": "\u0e44\u0e21\u0e48\u0e15\u0e23\u0e07\u0e2a\u0e40\u0e01\u0e25", "\u0394E00 \u0e16\u0e36\u0e07\u0e2a\u0e40\u0e01\u0e25": np.nan,
    }])
    row = serialize_measured_colours(table)[0]
    assert row["name"] == "\u0e19\u0e49\u0e33\u0e15\u0e32\u0e25\u0e40\u0e02\u0e49\u0e21"
    assert row["rgb"] == [101, 44, 11]
    assert row["de00"] is None
    json.dumps(row, ensure_ascii=False, allow_nan=False)
