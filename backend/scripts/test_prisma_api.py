import urllib.request
import json
from pathlib import Path

BASE_URL = "http://127.0.0.1:8000"

# 1. Health check
req = urllib.request.Request(f"{BASE_URL}/api/health")
with urllib.request.urlopen(req) as resp:
    health = json.loads(resp.read().decode("utf-8"))
    print("1. HEALTH:", health)

# 2. Get records count before
req = urllib.request.Request(f"{BASE_URL}/api/records")
with urllib.request.urlopen(req) as resp:
    records_before = json.loads(resp.read().decode("utf-8"))
    print("2. EXISTING RECORDS IN MYSQL:", records_before["total"])

# 3. Analyze image 01.jpg
img_path = Path("D:/SeniorProjectWeb/Bruise_test_set/01.jpg")
with open(img_path, "rb") as f:
    img_bytes = f.read()

boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="file"; filename="01.jpg"\r\n'
    f"Content-Type: image/jpeg\r\n\r\n"
).encode("utf-8") + img_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

req = urllib.request.Request(
    f"{BASE_URL}/api/analyze",
    data=body,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    method="POST"
)
with urllib.request.urlopen(req) as resp:
    analysis = json.loads(resp.read().decode("utf-8"))
    print("3. ANALYZE SUCCESS:")
    print("   - is_calibrated:", analysis.get("calibration", {}).get("is_calibrated"))
    print("   - age range:", analysis.get("age_estimate", {}).get("range"))
    print("   - dominant colors:", len(analysis.get("color_profile", {}).get("dominant_colors", [])))

# 4. Save record to MySQL via Prisma
rec_payload = {
    "patientId": "CASE-PRISMA-TEST-001",
    "woundLocation": "Forearm",
    "imageFilename": "01.jpg",
    "estimatedAge": analysis.get("age_estimate", {}).get("range", "Unknown"),
    "confidence": float(analysis.get("age_estimate", {}).get("confidence_score", 0)),
    "deltaE00": float(analysis.get("calibration", {}).get("loocv_median_de00", 0) or 0),
    "surfaceAreaMm2": float(analysis.get("wound_size", {}).get("pixel_area", 0) or 0),
    "dominantHex": analysis.get("color_profile", {}).get("dominant_colors", [{}])[0].get("hex", "#000000"),
    "summary": "Clinical verification test on MySQL with Prisma Client Python",
    "resultJson": analysis
}
rec_data = json.dumps(rec_payload).encode("utf-8")
req = urllib.request.Request(
    f"{BASE_URL}/api/records",
    data=rec_data,
    headers={"Content-Type": "application/json"},
    method="POST"
)
with urllib.request.urlopen(req) as resp:
    saved = json.loads(resp.read().decode("utf-8"))
    print("4. SAVED TO MYSQL VIA PRISMA:", saved)

# 5. Get records count after
req = urllib.request.Request(f"{BASE_URL}/api/records")
with urllib.request.urlopen(req) as resp:
    records_after = json.loads(resp.read().decode("utf-8"))
    print("5. NEW RECORDS TOTAL IN MYSQL:", records_after["total"])
    latest = records_after["records"][0]
    print("   - Latest Case ID:", latest["patientId"])
    print("   - Latest dominantHex:", latest["dominantHex"])
    print("   - Latest estimatedAge:", latest["estimatedAge"])

print("\n--- ALL TESTS PASSED SUCCESSFULLY! ---")
