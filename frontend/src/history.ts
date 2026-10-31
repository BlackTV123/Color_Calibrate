import type { AnalysisResult } from './App';

export interface HistoryItem {
  id: string;
  date: string;
  caseId: string;
  file: string;
  bodySite: string;
  notes?: string;
  age: string;
  calibrated: boolean;
  colors: string[];
  thumbnail?: string | null;
  confidence?: number;
  deltaE00?: number;
  surfaceAreaMm2?: number;
  resultJson?: AnalysisResult | null;
  syncStatus?: 'synced' | 'pending';
  clientId?: string;
}


export function nextCaseId(items: Pick<HistoryItem, 'caseId'>[]): string {
  const highest = items.reduce((max, item) => {
    const value = item.caseId.trim();
    const match = /^(?:Case)?(\d+)$/i.exec(value);
    if (!match) return max;
    const numeric = Number(match[1]);
    return Number.isSafeInteger(numeric) && numeric < Number.MAX_SAFE_INTEGER ? Math.max(max, numeric) : max;
  }, 0);
  return 'Case' + String(highest + 1).padStart(3, '0');
}

export function normalizeHistoryItem(item: HistoryItem): HistoryItem {
  return {
    ...item,
    calibrated: item.resultJson?.calibration?.is_calibrated === true,
    syncStatus: item.syncStatus ?? (/^local-|^\d{12,}$/.test(item.id) ? 'pending' : 'synced'),
    clientId: item.clientId || (item.resultJson as any)?._client_record_id || `legacy-${item.id}`,
  };
}

export function mapHistoryRecord(record: any): HistoryItem {
  const result = record.resultJson as AnalysisResult | null;
  const colours = result?.color_profile?.dominant_colors?.filter(c => /^#[0-9a-f]{6}$/i.test(c.hex)).slice(0, 3).map(c => c.hex) ?? [];
  return normalizeHistoryItem({
    id: String(record.id), date: record.createdAt || '', caseId: record.patientId || `CASE-${record.id}`,
    file: record.imageFilename || 'image.jpg', bodySite: record.woundLocation || 'Unspecified',
    notes: record.summary || '', age: record.estimatedAge || 'N/A', calibrated: false,
    colors: colours.length ? colours : record.dominantHex ? [record.dominantHex] : [],
    thumbnail: record.thumbnail || result?.previews?.overlay || result?.previews?.calibrated || result?.previews?.original || null,
    confidence: record.confidence, deltaE00: record.deltaE00, surfaceAreaMm2: record.surfaceAreaMm2,
    resultJson: result, syncStatus: 'synced', clientId: record.resultJson?._client_record_id,
  });
}

export function mergeHistory(remote: HistoryItem[], local: HistoryItem[]): HistoryItem[] {
  const server = remote.map(normalizeHistoryItem);
  const ids = new Set(server.map(row => row.id));
  const clients = new Set(server.map(row => row.clientId));
  const pending = local.map(normalizeHistoryItem).filter(row =>
    row.syncStatus === 'pending' && !ids.has(row.id) && !clients.has(row.clientId));
  return [...server, ...pending].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

export function recordPayload(record: HistoryItem) {
  return {
    clientRecordId: record.clientId || `legacy-${record.id}`, patientId: record.caseId,
    woundLocation: record.bodySite, imageFilename: record.file, estimatedAge: record.age,
    confidence: record.confidence ?? 0, deltaE00: record.deltaE00 ?? 0,
    surfaceAreaMm2: record.surfaceAreaMm2 ?? 0, dominantHex: record.colors[0] || '',
    summary: record.notes || '', thumbnail: record.thumbnail, resultJson: record.resultJson || {},
  };
}

export class HistoryAuthenticationError extends Error {
  constructor(message = 'กรุณาเข้าสู่ระบบใหม่เพื่อยืนยันตัวตน') {
    super(message);
    this.name = 'HistoryAuthenticationError';
  }
}

export async function sendHistoryRecord(record: HistoryItem, token: string, request = fetch): Promise<HistoryItem> {
  const response = await request('/api/records', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(recordPayload(record)),
  });
  if (response.status === 401) throw new HistoryAuthenticationError();
  if (!response.ok) throw new Error('บันทึก MySQL ไม่สำเร็จ รายการยังรอซิงก์');
  const data = await response.json();
  if (!data.success || !data.id) throw new Error('เซิร์ฟเวอร์ยังไม่ยืนยันการบันทึก');
  return { ...record, id: String(data.id), date: data.createdAt || record.date, syncStatus: 'synced' };
}

export async function deleteHistoryRecord(record: HistoryItem, token: string, request = fetch): Promise<void> {
  if (normalizeHistoryItem(record).syncStatus === 'pending') return;
  const response = await request(`/api/records/${encodeURIComponent(record.id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) throw new HistoryAuthenticationError();
  if (!response.ok) throw new Error('ลบไม่สำเร็จ รายการยังอยู่ในประวัติ');
  const data = await response.json();
  if (data.success !== true) throw new Error('เซิร์ฟเวอร์ยังไม่ยืนยันการลบ');
}

function cacheKey(email: string) { return `bcc_history_${email.trim().toLowerCase()}`; }

function legacyHistory(email: string): HistoryItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(email)) || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizeHistoryItem) : [];
  } catch { return []; }
}

async function cacheTransaction(email: string, items?: HistoryItem[]): Promise<HistoryItem[] | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('bcc_history_v2', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('accounts');
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('History cache unavailable'));
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('accounts', items === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('accounts');
      const request = items === undefined ? store.get(cacheKey(email)) : store.put(items, cacheKey(email));
      transaction.oncomplete = () => { db.close(); resolve(items === undefined ? request.result : items); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}

export async function readHistoryCache(email: string): Promise<HistoryItem[]> {
  try {
    const saved = await cacheTransaction(email);
    return Array.isArray(saved) ? saved.map(normalizeHistoryItem) : legacyHistory(email);
  } catch { return legacyHistory(email); }
}

// Serialize writes per account so an older write cannot replace a newer snapshot.
const cacheWrites = new Map<string, Promise<void>>();
export function persistHistoryCache(email: string, items: HistoryItem[]): Promise<void> {
  const key = cacheKey(email);
  const previous = cacheWrites.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    try {
      await cacheTransaction(email, items);
      try { localStorage.removeItem(key); } catch { /* IndexedDB already committed. */ }
    } catch {
      localStorage.setItem(key, JSON.stringify(items));
    }
  });
  cacheWrites.set(key, next);
  return next;
}
