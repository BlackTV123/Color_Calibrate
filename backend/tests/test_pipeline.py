from pathlib import Path
import pytest
from app.pipeline.analyse import analyse_photo_auto_bytes

IMG = Path(__file__).parent / "images"


def test_health_check_payload():
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new('RGB', (100, 100), color=(128, 128, 128)).save(buf, format='PNG')
    synthetic_png = buf.getvalue()

    try:
        r = analyse_photo_auto_bytes(synthetic_png, "test.png")
        assert r["calibration"]["status"] in ("ไม่มีพิกัดสเกลที่ใช้ได้", "ไม่ผ่าน: ห้ามตีความสีแผลหรือช่วงวัน")
    except ValueError:
        pass


@pytest.mark.skipif(not (IMG / "01.jpg").exists(), reason="01.jpg test image not placed in tests/images/")
def test_no_bruise_image_has_no_wound_or_age():
    r = analyse_photo_auto_bytes((IMG / "01.jpg").read_bytes(), "01.jpg")
    assert r["wound_table"] is None
    assert r["age_estimate"]["ช่วงวัน"] is None


@pytest.mark.skipif(not (IMG / "02.jpg").exists(), reason="02.jpg test image not placed in tests/images/")
def test_bruise_image_finds_card():
    r = analyse_photo_auto_bytes((IMG / "02.jpg").read_bytes(), "02.jpg")
    assert "LOOCV median ΔE00" in r["calibration"]
