import type { AnalysisResult } from './App';

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export function validatePhotoFile(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (!file.size) return 'ไฟล์ภาพว่าง กรุณาเลือกภาพอื่น';
  if (file.size > MAX_PHOTO_BYTES) return 'ไฟล์ภาพเกิน 25 MB กรุณาลดขนาดภาพแล้วเลือกใหม่';
  const extension = /\.(jpe?g|jpe|jfif|png|webp|bmp|dib|tiff?|gif|avif|heic|heif)$/i.test(file.name);
  const mime = /^image\/(jpeg|jpg|png|webp|bmp|x-ms-bmp|tiff|gif|avif|heic|heif)$/i.test(file.type);
  return extension || mime ? null : 'รูปแบบไฟล์ไม่รองรับ กรุณาเลือก JPG, PNG, WebP, BMP, TIFF, GIF, AVIF หรือ HEIC/HEIF';
}

export function formatAgeEstimate(result: Pick<AnalysisResult, 'has_wound' | 'age_estimate'>): string {
  return result.age_estimate?.range || (result.has_wound ? 'ยังประเมินช่วงวันไม่ได้' : 'ไม่พบรอยสีแผล');
}

export function isLegacyDemo(result?: AnalysisResult | null): boolean {
  return result?.detection_note === 'In-browser client estimate (Backend service offline)';
}

/** Accept the legacy Python JSON 0/1 flags without accepting arbitrary truthy values. */
export function parseAnalysisResponse(value: unknown): AnalysisResult {
  const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const flag = (v: unknown) => v === 0 ? false : v === 1 ? true : v;
  const data = record(value) ? value : {};
  const calibration = record(data.calibration) ? data.calibration : {};
  const profile = record(data.color_profile) ? data.color_profile : {};
  const hasWound = flag(data.has_wound);
  const isCalibrated = flag(calibration.is_calibrated);
  if (typeof hasWound !== 'boolean' || typeof isCalibrated !== 'boolean' ||
      !Array.isArray(profile.mean_rgb) || !Array.isArray(profile.dominant_colors) || !record(data.age_estimate)) {
    throw new Error('\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e1c\u0e25\u0e27\u0e34\u0e40\u0e04\u0e23\u0e32\u0e30\u0e2b\u0e4c\u0e08\u0e32\u0e01\u0e40\u0e0b\u0e34\u0e23\u0e4c\u0e1f\u0e40\u0e27\u0e2d\u0e23\u0e4c\u0e44\u0e21\u0e48\u0e04\u0e23\u0e1a \u0e01\u0e23\u0e38\u0e13\u0e32\u0e25\u0e2d\u0e07\u0e2d\u0e35\u0e01\u0e04\u0e23\u0e31\u0e49\u0e07');
  }
  return { ...data, has_wound: hasWound, calibration: { ...calibration, is_calibrated: isCalibrated } } as AnalysisResult;
}
