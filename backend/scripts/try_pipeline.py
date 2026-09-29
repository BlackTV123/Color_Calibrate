import sys
import time
from pathlib import Path

# Add backend directory to sys.path so scripts can run standalone
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from app.pipeline.analyse import analyse_photo_auto_bytes


def main():
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.try_pipeline <path_to_image>")
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"Error: File '{path}' does not exist.")
        sys.exit(1)

    print(f"Analyzing {path.name}...")
    start = time.time()
    result = analyse_photo_auto_bytes(path.read_bytes(), path.name)
    elapsed = time.time() - start

    print("------------------------------------------")
    print(f"Elapsed Time    : {elapsed:.2f} s")
    print(f"Calibration     : {result['calibration']['status']}")
    print(f"Detection       : {result.get('detection_note', 'N/A')}")
    print(f"Has Wound Mask  : {result['wound_box'] is not None}")
    print(f"Age Assessment  : {result['age_estimate']['status']}")
    if result['age_estimate'].get('ช่วงวัน'):
        print(f"Estimated Range : {result['age_estimate']['ช่วงวัน']}")
        print(f"Confidence      : {result['age_estimate']['ความเชื่อมั่น']}")
    print("------------------------------------------")


if __name__ == "__main__":
    main()
