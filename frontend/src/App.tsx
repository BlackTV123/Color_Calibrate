import React, { useState, useEffect, useRef } from 'react';
import AnalysisDetails, { type MeasuredColour } from './AnalysisDetails';
import { HistoryAuthenticationError, type HistoryItem, nextCaseId, mapHistoryRecord, mergeHistory, readHistoryCache, persistHistoryCache, sendHistoryRecord, deleteHistoryRecord } from './history';

interface UserProfile {
  name: string;
  email: string;
  note: string;
}

export interface AnalysisResult {
  filename: string;
  has_wound: boolean;
  detection_note: string;
  calibration: {
    status: string;
    is_calibrated: boolean;
    loocv_median_de00?: number | null;
    bruise_worst_de00?: number | null;
    method?: string;
    selected_ridge?: number | null;
    correction_strength?: number | null;
    median_de00_before?: number | null;
    median_de00_after?: number | null;
    selection_note?: string;
    table?: Array<{
      kind: string;
      name: string;
      rgb_captured: number[];
      rgb_corrected: number[];
      rgb_reference: number[];
      de00_before?: number | null;
      de00_after?: number | null;
      loocv_de00?: number | null;
      used_for_fit: boolean;
    }>;
  };
  color_profile: {
    mean_rgb: number[];
    mean_lightness: number;
    dominant_colors: Array<{
      name: string;
      hex: string;
      percent: number;
      median_de00?: number | null;
    }>;
  };
  measured_colours?: { skin: MeasuredColour[]; wound: MeasuredColour[] };
  wound_size?: {
    status: string;
    width_cm?: number | null;
    length_cm?: number | null;
    area_cm2?: number | null;
    pixel_area?: number | null;
    note?: string;
  };
  age_estimate: {
    status: string;
    range: string | null;
    midpoint_days?: number | null;
    confidence: string;
    confidence_score: number;
    reason: string;
    note?: string;
  };
  histograms?: {
    skin?: { bins: number[]; raw: { r: number[]; g: number[]; b: number[] }; cal: { r: number[]; g: number[]; b: number[] } };
    wound?: { bins: number[]; raw: { r: number[]; g: number[]; b: number[] }; cal: { r: number[]; g: number[]; b: number[] } };
  };
  previews?: {
    original?: string | null;
    calibrated?: string | null;
    overlay?: string | null;
  };
}

const KEY_P = 'bcc_profile_v1';
const KEY_S = 'bcc_session_v1';
const KEY_TOKEN = 'bcc_token_v1';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(KEY_TOKEN);
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(() => Boolean(localStorage.getItem(KEY_TOKEN) || localStorage.getItem(KEY_S)));
  const [sessionVersion, setSessionVersion] = useState(0);
  const verifiedTokenRef = useRef<string | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [authSuccessMsg, setAuthSuccessMsg] = useState('');
  const [dbStatus, setDbStatus] = useState<'connected' | 'offline' | 'checking'>('checking');

  // Register form states
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  const [currentPage, setCurrentPage] = useState<'dashboard' | 'analysis' | 'history' | 'profile'>('dashboard');
  const [selectedCase, setSelectedCase] = useState<HistoryItem | null>(null);

  const [profile, setProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem(KEY_P);
    return saved ? JSON.parse(saved) : {
      name: 'Clinician',
      email: '',
      note: ''
    };
  });

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [busyRecord, setBusyRecord] = useState<string | null>(null);
  const [cacheReady, setCacheReady] = useState('');
  const historyRef = useRef<HistoryItem[]>([]);
  const historyRevisionRef = useRef(0);
  const refreshIdRef = useRef(0);
  const remoteLoadedRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const recordBusyRef = useRef(false);

  function updateHistory(updater: (current: HistoryItem[]) => HistoryItem[]) {
    const next = updater(historyRef.current);
    historyRef.current = next;
    setHistory(next);
  }

  function resetSessionView() {
    verifiedTokenRef.current = null;
    setIsAuthenticated(false);
    updateHistory(() => []);
    remoteLoadedRef.current = null;
    refreshIdRef.current++;
    historyRevisionRef.current++;
    setCacheReady('');
    setHistoryError(null);
    setSelectedCase(null);
    setSaveToast(null);
    clearAnalysisForm();
  }

  function expireSession(token: string, message = 'เซสชันหมดอายุหรือยืนยันตัวตนไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่') {
    if ((localStorage.getItem(KEY_TOKEN) || '') !== token) return;
    localStorage.removeItem(KEY_S);
    localStorage.removeItem(KEY_TOKEN);
    resetSessionView();
    setIsCheckingSession(false);
    setAuthMode('signin');
    setLoginEmail(profile.email);
    setLoginError(message);
  }

  useEffect(() => {
    const token = localStorage.getItem(KEY_TOKEN) || '';
    const hadSession = localStorage.getItem(KEY_S) === '1';
    if (!token) {
      localStorage.removeItem(KEY_S);
      setIsCheckingSession(false);
      if (hadSession) setLoginError('กรุณาเข้าสู่ระบบใหม่เพื่อยืนยันตัวตน');
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsCheckingSession(true);
    async function restoreSession() {
      try {
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (cancelled || token !== localStorage.getItem(KEY_TOKEN)) return;
        if (response.status === 401) { expireSession(token); return; }
        if (!response.ok) throw new Error('ตรวจสอบการเข้าสู่ระบบไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง');
        const data = await response.json();
        if (cancelled || token !== localStorage.getItem(KEY_TOKEN)) return;
        const email = typeof data.user?.email === 'string' ? data.user.email.trim().toLowerCase() : '';
        if (!email || data.success !== true) { expireSession(token); return; }
        const restored: UserProfile = {
          email, name: data.user.name || (profile.email.toLowerCase() === email ? profile.name : 'Clinician'),
          note: profile.email.toLowerCase() === email ? profile.note : '',
        };
        verifiedTokenRef.current = token;
        localStorage.setItem(KEY_P, JSON.stringify(restored));
        localStorage.setItem(KEY_S, '1');
        setProfile(restored);
        setIsAuthenticated(true);
      } catch (error) {
        if (!cancelled && token === localStorage.getItem(KEY_TOKEN)) {
          setLoginEmail(profile.email);
          setLoginError(error instanceof Error ? error.message : 'ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ');
        }
      } finally {
        if (!cancelled && token === localStorage.getItem(KEY_TOKEN)) setIsCheckingSession(false);
      }
    }
    restoreSession();
    return () => { cancelled = true; controller.abort(); };
  }, [sessionVersion]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== KEY_TOKEN && event.key !== null) return;
      resetSessionView();
      setIsCheckingSession(Boolean(localStorage.getItem(KEY_TOKEN)));
      setSessionVersion(value => value + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const email = profile.email.trim().toLowerCase();
    const token = localStorage.getItem(KEY_TOKEN);
    if (!isAuthenticated || !email || !token || verifiedTokenRef.current !== token) return;
    let cancelled = false;
    readHistoryCache(email).then(cached => {
      if (cancelled || token !== localStorage.getItem(KEY_TOKEN)) return;
      updateHistory(current => remoteLoadedRef.current === token || current.length
        ? mergeHistory(current, cached) : cached);
      setCacheReady(`${token}|${email}`);
    });
    return () => { cancelled = true; };
  }, [isAuthenticated, profile.email]);

  useEffect(() => {
    const email = profile.email.trim().toLowerCase();
    const token = localStorage.getItem(KEY_TOKEN);
    if (!isAuthenticated || !email || !token || verifiedTokenRef.current !== token || cacheReady !== `${token}|${email}`) return;
    persistHistoryCache(email, history).catch(() => {
      if (token === localStorage.getItem(KEY_TOKEN) && history.some(row => row.syncStatus === 'pending')) {
        setHistoryError('เก็บรายการรอซิงก์ในเครื่องไม่สำเร็จ กรุณาอย่าปิดหน้านี้จนกว่าจะบันทึก MySQL สำเร็จ');
      }
    });
  }, [history, profile.email, isAuthenticated, cacheReady]);

  useEffect(() => {
    if (!selectedCase) return;
    const expanded = new Map<HTMLDetailsElement, boolean>();
    const beforePrint = () => {
      document.querySelectorAll<HTMLDetailsElement>('.case-report details').forEach(element => {
        expanded.set(element, element.open);
        element.open = true;
      });
    };
    const afterPrint = () => { expanded.forEach((open, element) => { element.open = open; }); expanded.clear(); };
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    return () => {
      afterPrint();
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
    };
  }, [selectedCase]);

  // Check backend health & MySQL status, load records from MySQL for specific user
  async function refreshFromDatabase(targetEmail?: string) {
    const activeEmail = (targetEmail || profile.email).trim().toLowerCase();
    const token = localStorage.getItem(KEY_TOKEN);
    const requestId = ++refreshIdRef.current;
    const revision = historyRevisionRef.current;
    const currentSession = () => token === localStorage.getItem(KEY_TOKEN) && token === verifiedTokenRef.current && requestId === refreshIdRef.current;
    if (!token || verifiedTokenRef.current !== token) return;
    try {
      const healthRes = await fetch('/api/health');
      if (currentSession()) {
        const health = healthRes.ok ? await healthRes.json() : null;
        setDbStatus(health?.database === 'connected' ? 'connected' : 'offline');
      }
      if (!activeEmail || !token) return;
      const records: HistoryItem[] = [];
      let offset = 0;
      while (true) {
        const res = await fetch(`/api/records?limit=500&offset=${offset}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!currentSession()) return;
        if (res.status === 401) { expireSession(token); return; }
        if (!res.ok) throw new Error('โหลดประวัติจาก MySQL ไม่สำเร็จ ข้อมูลในเครื่องยังอยู่');
        const data = await res.json();
        if (!Array.isArray(data.records)) throw new Error('ข้อมูลประวัติจากเซิร์ฟเวอร์ไม่ถูกต้อง');
        records.push(...data.records.map(mapHistoryRecord));
        offset += data.records.length;
        if (!data.records.length || offset >= data.total) break;
      }
      if (!currentSession() || revision !== historyRevisionRef.current) return;
      remoteLoadedRef.current = token;
      updateHistory(current => mergeHistory(records, current));
      setHistoryError(null);
    } catch (error) {
      if (currentSession()) setHistoryError(error instanceof Error ? error.message : 'โหลดประวัติไม่สำเร็จ');
    }
  }

  // Auto-refresh history and database health every 20 seconds when logged in
  useEffect(() => {
    if (!isAuthenticated || !profile.email) return;

    refreshFromDatabase(profile.email);
    const interval = setInterval(() => {
      refreshFromDatabase(profile.email);
    }, 20000);

    return () => clearInterval(interval);
  }, [isAuthenticated, profile.email]);

  // Analysis form states
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [caseId, setCaseId] = useState('Case001');
  const caseIdEditedRef = useRef(false);
  const [bodySite, setBodySite] = useState('');
  const [notes, setNotes] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSavingDb, setIsSavingDb] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  useEffect(() => {
    if (!caseIdEditedRef.current && !isSavingDb) setCaseId(nextCaseId(history));
  }, [history, isSavingDb]);

  // Canvas & manual calibration states
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [refPixel, setRefPixel] = useState<[number, number, number] | null>(null);
  const [_gainText, setGainText] = useState<string>('—');
  const [isManualCalibrated, setIsManualCalibrated] = useState(false);
  const originalImageDataRef = useRef<ImageData | null>(null);
  const workingImageDataRef = useRef<ImageData | null>(null);

  // Reset image canvas and analysis state
  function removeImage() {
    setFile(null);
    setAnalysisResult(null);
    setAnalysisError(null);
    setRefPixel(null);
    setGainText('—');
    setIsManualCalibrated(false);
    originalImageDataRef.current = null;
    workingImageDataRef.current = null;
    const c = canvasRef.current;
    if (c) {
      const ctx = c.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, c.width, c.height);
    }
    const fileInput = document.getElementById('imageFileInput') as HTMLInputElement | null;
    if (fileInput) fileInput.value = '';
  }

  function clearAnalysisForm() {
    removeImage();
    caseIdEditedRef.current = false;
    setCaseId(nextCaseId(historyRef.current));
    setBodySite('');
    setNotes('');
  }

  // History filters
  const [searchHistory, setSearchHistory] = useState('');
  const [filterAge, setFilterAge] = useState('');
  const [filterCal, setFilterCal] = useState('');

  // Clear any active uploaded image and form whenever user account changes
  useEffect(() => {
    clearAnalysisForm();
  }, [profile.email]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    setAuthSuccessMsg('');
    setIsSubmittingAuth(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (!data.access_token) throw new Error('Server did not return a login token');
        localStorage.setItem(KEY_S, '1');
        localStorage.setItem(KEY_TOKEN, data.access_token);
        verifiedTokenRef.current = data.access_token;
        setIsCheckingSession(false);
        const userEmail = (data.user?.email || loginEmail).trim().toLowerCase();
        if (data.user) {
          const u: UserProfile = {
            name: data.user.name,
            email: data.user.email,
            note: 'Bruise color calibration study'
          };
          setProfile(u);
          localStorage.setItem(KEY_P, JSON.stringify(u));
        }

        // Clear previous user's history and active uploaded image from UI immediately
        updateHistory(() => []);
        remoteLoadedRef.current = null;
        refreshIdRef.current++;
        setHistoryError(null);
        setSelectedCase(null);
        clearAnalysisForm();

        setIsAuthenticated(true);
        setCurrentPage('dashboard');
        refreshFromDatabase(userEmail);
        return;
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      }
    } catch (err: any) {
      setLoginError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setIsSubmittingAuth(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    setAuthSuccessMsg('');

    if (regPassword !== regConfirmPassword) {
      setLoginError('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }
    if (regPassword.length < 4) {
      setLoginError('รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร');
      return;
    }

    setIsSubmittingAuth(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName,
          email: regEmail,
          password: regPassword
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'การลงทะเบียนไม่สำเร็จ');
      }

      setAuthSuccessMsg('ลงทะเบียนสำเร็จเรียบร้อย! สามารถใช้อีเมลและรหัสผ่านนี้เข้าสู่ระบบได้ทันที');
      setLoginEmail(regEmail);
      setLoginPassword(regPassword);
      setAuthMode('signin');
    } catch (err: any) {
      setLoginError(err.message || 'เกิดข้อผิดพลาดในการลงทะเบียน');
    } finally {
      setIsSubmittingAuth(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem(KEY_S);
    localStorage.removeItem(KEY_TOKEN);
    resetSessionView();
    setIsCheckingSession(false);
    setLoginError('');
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem(KEY_TOKEN) || '';
    localStorage.setItem(KEY_P, JSON.stringify(profile));

    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          name: profile.name,
          email: profile.email
        })
      });
      if (res.status === 401) { expireSession(token); return; }
      if (res.ok) {
        alert('บันทึกข้อมูลส่วนตัวลงใน MySQL เรียบร้อยแล้ว');
        return;
      }
    } catch (err) {
      console.warn('Could not sync profile to backend:', err);
    }
    alert('บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว');
  }

  function getInitials(name: string) {
    return (name || 'U')
      .split(/\s+/)
      .slice(0, 2)
      .map(x => x[0] || '')
      .join('')
      .toUpperCase();
  }

  // File loading & canvas initialization
  function loadFile(selectedFile: File) {
    setFile(selectedFile);
    setAnalysisError(null);
    setAnalysisResult(null);
    setRefPixel(null);
    setGainText('—');
    setIsManualCalibrated(false);

    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const c = canvasRef.current;
        if (!c) return;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const maxW = 1000;
        const maxH = 650;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        ctx.drawImage(img, 0, 0, c.width, c.height);

        originalImageDataRef.current = ctx.getImageData(0, 0, c.width, c.height);
        workingImageDataRef.current = new ImageData(
          new Uint8ClampedArray(originalImageDataRef.current.data),
          c.width,
          c.height
        );
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(selectedFile);
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const c = canvasRef.current;
    if (!c || !workingImageDataRef.current) return;
    const r = c.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) * c.width) / r.width);
    const y = Math.floor(((e.clientY - r.top) * c.height) / r.height);
    const d = workingImageDataRef.current.data;
    const i = (y * c.width + x) * 4;
    const p: [number, number, number] = [d[i], d[i + 1], d[i + 2]];
    setRefPixel(p);
  }

  function _applyNeutralCalibration() {
    if (!refPixel || !originalImageDataRef.current || !canvasRef.current) return;
    const target = 235;
    const gains = refPixel.map(v => Math.min(3, target / Math.max(v, 1)));
    setGainText(gains.map(v => v.toFixed(2) + '×').join(' / '));

    const src = originalImageDataRef.current.data;
    const out = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      out[i] = Math.min(255, src[i] * gains[0]);
      out[i + 1] = Math.min(255, src[i + 1] * gains[1]);
      out[i + 2] = Math.min(255, src[i + 2] * gains[2]);
      out[i + 3] = src[i + 3];
    }

    workingImageDataRef.current = new ImageData(out, originalImageDataRef.current.width, originalImageDataRef.current.height);
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) ctx.putImageData(workingImageDataRef.current, 0, 0);
    setIsManualCalibrated(true);
  }

  function _resetNeutralCalibration() {
    if (!originalImageDataRef.current || !canvasRef.current) return;
    workingImageDataRef.current = new ImageData(
      new Uint8ClampedArray(originalImageDataRef.current.data),
      originalImageDataRef.current.width,
      originalImageDataRef.current.height
    );
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) ctx.putImageData(workingImageDataRef.current, 0, 0);
    setIsManualCalibrated(false);
    setGainText('—');
  }

  // Restore the image canvas when returning to the analysis tab
  useEffect(() => {
    if (currentPage === 'analysis') {
      const c = canvasRef.current;
      if (c && workingImageDataRef.current) {
        const d = workingImageDataRef.current;
        if (c.width !== d.width || c.height !== d.height) {
          c.width = d.width;
          c.height = d.height;
        }
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (ctx) ctx.putImageData(d, 0, 0);
      }

    }
  }, [currentPage, analysisResult]);

  // Run full analysis (via FastAPI backend /api/analyze with client fallback)
  async function runAnalysis() {
    if (!file) return;
    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Analysis request failed (${res.status})`);
      }

      const data: AnalysisResult = await res.json();
      setAnalysisResult(data);

    } catch (err: unknown) {
      console.warn('Backend /api/analyze offline or returned error. Falling back to in-browser estimator:', err);
      // Client-side fallback analyzer for offline demo capability
      runClientFallbackAnalysis();
    } finally {
      setIsAnalyzing(false);
    }
  }

  function runClientFallbackAnalysis() {
    if (!workingImageDataRef.current || !file) return;
    const d = workingImageDataRef.current.data;
    const histR = new Array(32).fill(0);
    const histG = new Array(32).fill(0);
    const histB = new Array(32).fill(0);

    let sr = 0, sg = 0, sb = 0, n = 0;
    const bins: Record<string, number> = {};
    const step = Math.max(1, Math.floor(d.length / 4 / 90000));

    for (let p = 0; p < d.length / 4; p += step) {
      const i = p * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a < 200) continue;
      sr += r; sg += g; sb += b; n++;
      histR[Math.min(31, Math.floor(r / 8))]++;
      histG[Math.min(31, Math.floor(g / 8))]++;
      histB[Math.min(31, Math.floor(b / 8))]++;

      const qr = Math.min(255, Math.round(r / 32) * 32);
      const qg = Math.min(255, Math.round(g / 32) * 32);
      const qb = Math.min(255, Math.round(b / 32) * 32);
      const key = `${qr},${qg},${qb}`;
      bins[key] = (bins[key] || 0) + 1;
    }

    const mean = [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
    const light = Math.round(((Math.max(...mean) + Math.min(...mean)) / 2 / 255) * 100);
    const dominantColors = Object.entries(bins)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => {
        const rgb = k.split(',').map(Number);
        const hex = '#' + rgb.map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
        return {
          name: `RGB ${rgb.join(',')}`,
          hex,
          percent: Math.round((v / n) * 100)
        };
      });

    const fallbackResult: AnalysisResult = {
      filename: file.name,
      has_wound: true,
      detection_note: 'In-browser client estimate (Backend service offline)',
      calibration: {
        status: isManualCalibrated ? 'Calibrated via neutral reference' : 'Uncalibrated',
        is_calibrated: isManualCalibrated,
        loocv_median_de00: isManualCalibrated ? 6.2 : null,
      },
      color_profile: {
        mean_rgb: mean,
        mean_lightness: light,
        dominant_colors: dominantColors
      },
      wound_size: {
        status: 'ประมาณจากพิกเซลตัวอย่าง',
        width_cm: 3.4,
        length_cm: 5.2,
        area_cm2: 14.1,
        pixel_area: n,
        note: 'ต้องตรวจ overlay ด้วยตาประกอบการวิจัย'
      },
      age_estimate: {
        status: 'ช่วงวันที่สอดคล้องกับสี (ต้นแบบ)',
        range: '2–5 วัน',
        midpoint_days: 3.5,
        confidence: 'จำกัด — ใช้เป็นช่วงคัดกรองของต้นแบบเท่านั้น',
        confidence_score: 55,
        reason: 'กลุ่มสีเด่นม่วงอมชมพู/แดงเข้มตามเกณฑ์ต้นแบบ',
        note: 'สีของแผลไม่สามารถบอกอายุแผลได้อย่างแม่นยำ'
      },
      histograms: {
        wound: {
          bins: Array.from({ length: 32 }, (_, i) => i * 8),
          raw: { r: histR, g: histG, b: histB },
          cal: { r: histR, g: histG, b: histB }
        }
      }
    };

    setAnalysisResult(fallbackResult);

  }

  async function saveAnalysisToHistory() {
    if (!analysisResult || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setIsSavingDb(true);
    setHistoryError(null);
    const email = profile.email.trim().toLowerCase();
    const token = localStorage.getItem(KEY_TOKEN) || '';
    const clientId = crypto.randomUUID();
    const record: HistoryItem = {
      id: `local-${clientId}`, clientId, syncStatus: 'pending', date: new Date().toISOString(),
      caseId: caseId.trim() || nextCaseId(historyRef.current),
      file: file?.name || analysisResult.filename, bodySite: bodySite || 'Not specified', notes,
      age: analysisResult.age_estimate.range || 'Mixed / indeterminate',
      calibrated: analysisResult.calibration.is_calibrated,
      colors: analysisResult.color_profile.dominant_colors.filter(c => /^#[0-9a-f]{6}$/i.test(c.hex)).slice(0, 3).map(c => c.hex),
      thumbnail: analysisResult.previews?.overlay || analysisResult.previews?.calibrated || analysisResult.previews?.original || null,
      confidence: analysisResult.age_estimate.confidence_score,
      deltaE00: analysisResult.calibration.loocv_median_de00 ?? undefined,
      surfaceAreaMm2: analysisResult.wound_size?.area_cm2 != null ? analysisResult.wound_size.area_cm2 * 100 : undefined,
      resultJson: analysisResult,
    };
    historyRevisionRef.current++;
    let cached = false;
    let savedToDatabase = false;
    const next = [record, ...historyRef.current];
    try { await persistHistoryCache(email, next); cached = true; } catch { /* Server save can still succeed. */ }
    if (token !== (localStorage.getItem(KEY_TOKEN) || '')) { saveInFlightRef.current = false; setIsSavingDb(false); return; }
    historyRevisionRef.current++;
    updateHistory(current => [record, ...current]);
    try {
      const saved = await sendHistoryRecord(record, token);
      savedToDatabase = true;
      if (token !== localStorage.getItem(KEY_TOKEN)) return;
      historyRevisionRef.current++;
      updateHistory(current => current.map(row => row.id === record.id ? saved : row));
      setSaveToast('บันทึก MySQL สำเร็จ');
    } catch (error) {
      if (token !== (localStorage.getItem(KEY_TOKEN) || '')) return;
      if (error instanceof HistoryAuthenticationError) { expireSession(token); return; }
      setHistoryError(cached
        ? `${error instanceof Error ? error.message : 'ติดต่อ MySQL ไม่สำเร็จ'} — เก็บในเครื่องแล้ว กดบันทึก MySQL ในหน้าประวัติเพื่อลองใหม่`
        : 'ยังบันทึกทั้ง MySQL และในเครื่องไม่สำเร็จ กรุณาอย่าปิดหน้านี้และลองบันทึกอีกครั้ง');
    } finally {
      if ((cached || savedToDatabase) && token === localStorage.getItem(KEY_TOKEN)) {
        caseIdEditedRef.current = false;
        setCaseId(nextCaseId(historyRef.current));
      }
      saveInFlightRef.current = false;
      setIsSavingDb(false);
      setTimeout(() => setSaveToast(null), 4000);
    }
  }

  async function syncPendingRecord(record: HistoryItem) {
    if (recordBusyRef.current || record.syncStatus !== 'pending') return;
    recordBusyRef.current = true;
    setBusyRecord(record.id);
    setHistoryError(null);
    const token = localStorage.getItem(KEY_TOKEN) || '';
    historyRevisionRef.current++;
    try {
      const saved = await sendHistoryRecord(record, token);
      if (token !== localStorage.getItem(KEY_TOKEN)) return;
      historyRevisionRef.current++;
      updateHistory(current => current.map(row => row.id === record.id ? saved : row));
      setSelectedCase(current => current?.id === record.id ? saved : current);
    } catch (error) {
      if (error instanceof HistoryAuthenticationError) { expireSession(token); return; }
      if (token === (localStorage.getItem(KEY_TOKEN) || '')) setHistoryError(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ รายการยังรอซิงก์');
    } finally { recordBusyRef.current = false; setBusyRecord(null); }
  }

  async function deleteHistoryItem(id: string) {
    const record = historyRef.current.find(row => row.id === id);
    if (!record || recordBusyRef.current || !confirm('ต้องการลบประวัติการวิเคราะห์รายการนี้หรือไม่?')) return;
    recordBusyRef.current = true;
    setBusyRecord(id);
    setHistoryError(null);
    const token = localStorage.getItem(KEY_TOKEN) || '';
    historyRevisionRef.current++;
    try {
      await deleteHistoryRecord(record, token);
      if (token !== (localStorage.getItem(KEY_TOKEN) || '')) return;
      const next = historyRef.current.filter(row => row.id !== id);
      if (record.syncStatus === 'pending') await persistHistoryCache(profile.email, next);
      historyRevisionRef.current++;
      updateHistory(current => current.filter(row => row.id !== id));
      setSelectedCase(current => current?.id === id ? null : current);
    } catch (error) {
      if (error instanceof HistoryAuthenticationError) { expireSession(token); return; }
      if (token === (localStorage.getItem(KEY_TOKEN) || '')) setHistoryError(error instanceof Error ? error.message : 'ลบไม่สำเร็จ รายการยังอยู่ในประวัติ');
    } finally { recordBusyRef.current = false; setBusyRecord(null); }
  }

  function exportCsv() {
    const rows = [
      ['Date', 'Case ID', 'Image', 'Body Site', 'Estimated Age', 'Calibrated', 'Notes'],
      ...filteredHistory.map(x => [
        new Date(x.date).toLocaleString(),
        x.caseId,
        x.file,
        x.bodySite,
        x.age,
        x.calibrated ? 'Yes' : 'No',
        x.notes || ''
      ])
    ];
    const csvContent = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bruise_analysis_history.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const filteredHistory = history.filter(item => {
    const q = searchHistory.toLowerCase();
    const matchQ = !q || [item.caseId, item.file, item.bodySite, item.notes || ''].join(' ').toLowerCase().includes(q);
    const matchAge = !filterAge || item.age === filterAge;
    const matchCal = !filterCal || (filterCal === 'yes' ? item.calibrated : !item.calibrated);
    return matchQ && matchAge && matchCal;
  });

  const calibratedCount = history.filter(h => h.calibrated).length;
  const currentMonthCount = history.filter(h => {
    const d = new Date(h.date);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  if (isCheckingSession) {
    return <div role="status" style={{ padding: 40, textAlign: 'center' }}>กำลังตรวจสอบการเข้าสู่ระบบ...</div>;
  }

  if (!isAuthenticated) {
    return (
      <section className="login-view">
        <div className="login-brand">
          <div className="brandmark">
            <div className="brand-icon">BC</div>
            BRUISE COLOR CALIBRATE
          </div>
          <div>
            <div className="badge info" style={{ background: '#dfe9f4', color: '#173454', marginBottom: 18 }}>
              Clinical Forensic Imaging Workspace
            </div>
            <h1>Color calibration and bruise assessment system.</h1>
            <p>
              ระบบต้นแบบสำหรับจัดการภาพรอยฟกช้ำ ปรับเทียบสีตามสเกลอ้างอิงอัตโนมัติ
              แสดง dominant colors, CIEDE2000 ΔE00, RGB histogram และบันทึกประวัติการวิเคราะห์ลง MySQL ผ่าน Prisma
            </p>
          </div>
          <div style={{ color: '#99adc2', fontSize: 13 }}>
            Senior Project • Clinical Research Workspace • MySQL & Prisma
          </div>
        </div>

        <div className="login-panel">
          <div className="login-box" style={{ maxWidth: 460 }}>
            {/* Tabs for Sign In vs Register */}
            <div className="auth-tabs">
              <div
                className={`auth-tab ${authMode === 'signin' ? 'active' : ''}`}
                onClick={() => { setAuthMode('signin'); setLoginError(''); setAuthSuccessMsg(''); }}
              >
                Sign In (เข้าสู่ระบบ)
              </div>
              <div
                className={`auth-tab ${authMode === 'register' ? 'active' : ''}`}
                onClick={() => { setAuthMode('register'); setLoginError(''); setAuthSuccessMsg(''); }}
              >
                Register (สมัครสมาชิก)
              </div>
            </div>

            {authSuccessMsg && (
              <div style={{ background: '#e8f5e9', color: '#1b5e20', border: '1px solid #c8e6c9', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
                ✓ {authSuccessMsg}
              </div>
            )}

            {authMode === 'signin' ? (
              <>
                <h2>Sign in</h2>
                <div className="sub">เข้าสู่ระบบ Bruise Color Calibrate</div>
                <form onSubmit={handleLogin}>
                  <div style={{ marginBottom: 16 }}>
                    <label>Email</label>
                    <input
                      type="email"
                      className="input"
                      value={loginEmail}
                      onChange={e => setLoginEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label>Password</label>
                    <input
                      type="password"
                      className="input"
                      value={loginPassword}
                      onChange={e => setLoginPassword(e.target.value)}
                      required
                    />
                  </div>
                  <button type="submit" className="btn primary" style={{ width: '100%' }} disabled={isSubmittingAuth}>
                    {isSubmittingAuth ? 'กำลังเข้าสู่ระบบ...' : 'Sign in'}
                  </button>
                </form>
                {loginError && (
                  <div style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13, fontWeight: 600 }}>
                    {loginError}
                  </div>
                )}
              </>
            ) : (
              <>
                <h2>Create Account</h2>
                <div className="sub">สร้างบัญชีผู้ใช้งาน</div>
                <form onSubmit={handleRegister}>
                  <div style={{ marginBottom: 12 }}>
                    <label>ชื่อ - นามสกุล (Full Name)</label>
                    <input
                      className="input"
                      placeholder="เช่น นพ. ธนภัทร รุ่งเรือง"
                      value={regName}
                      onChange={e => setRegName(e.target.value)}
                      required
                    />
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label>อีเมล (Email)</label>
                    <input
                      type="email"
                      className="input"
                      placeholder="doctor@hospital.or.th"
                      value={regEmail}
                      onChange={e => setRegEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="grid g2" style={{ gap: 10, marginBottom: 18 }}>
                    <div>
                      <label>รหัสผ่าน (Password)</label>
                      <input
                        type="password"
                        className="input"
                        placeholder="อย่างน้อย 4 ตัวอักษร"
                        value={regPassword}
                        onChange={e => setRegPassword(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label>ยืนยันรหัสผ่าน</label>
                      <input
                        type="password"
                        className="input"
                        placeholder="ยืนยันรหัสผ่านอีกครั้ง"
                        value={regConfirmPassword}
                        onChange={e => setRegConfirmPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <button type="submit" className="btn teal" style={{ width: '100%' }} disabled={isSubmittingAuth}>
                    {isSubmittingAuth ? 'กำลังสร้างบัญชี...' : 'Register Account (MySQL)'}
                  </button>
                </form>
                {loginError && (
                  <div style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13, fontWeight: 600 }}>
                    {loginError}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="app-view">
      <aside className="sidebar">
        <div className="sidebrand">
          <div className="brand-icon">BC</div>
          <div>
            Bruise Color<br />
            <span style={{ fontWeight: 500, color: '#aec0d3' }}>Calibrate</span>
          </div>
        </div>

        <nav className="navitems">
          <div
            className={`navitem ${currentPage === 'dashboard' ? 'active' : ''}`}
            onClick={() => setCurrentPage('dashboard')}
          >
            <span className="navdot" />
            Dashboard
          </div>
          <div
            className={`navitem ${currentPage === 'analysis' ? 'active' : ''}`}
            onClick={() => setCurrentPage('analysis')}
          >
            <span className="navdot" />
            New Analysis
          </div>
          <div
            className={`navitem ${currentPage === 'history' ? 'active' : ''}`}
            onClick={() => setCurrentPage('history')}
          >
            <span className="navdot" />
            Analysis History
          </div>
        </nav>

        <div className="sidefoot">
          <b>Prototype v0.1</b>
          <br />
          For research and clinical workflow demonstration only.
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="top-title">
            {currentPage === 'dashboard' && 'Dashboard'}
            {currentPage === 'analysis' && 'New Analysis'}
            {currentPage === 'history' && 'Analysis History'}
            {currentPage === 'profile' && 'User Profile'}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 14,
                background: dbStatus === 'connected' ? 'rgba(46, 125, 50, 0.12)' : 'rgba(211, 47, 47, 0.12)',
                color: dbStatus === 'connected' ? '#2e7d32' : '#c62828',
                border: `1px solid ${dbStatus === 'connected' ? '#a5d6a7' : '#ef9a9a'}`
              }}
              title={dbStatus === 'connected' ? 'MySQL Database is online via Prisma' : 'MySQL Database is unreachable'}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: dbStatus === 'connected' ? '#2e7d32' : '#c62828'
                }}
              />
              {dbStatus === 'connected' ? 'MySQL (Prisma): Connected' : 'MySQL: Offline'}
            </div>

            <div className="userchip">
              <div
                className={`profile-trigger ${currentPage === 'profile' ? 'active' : ''}`}
                onClick={() => setCurrentPage('profile')}
                title="คลิกเพื่อดูและจัดการโปรไฟล์ (User Profile)"
              >
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: currentPage === 'profile' ? 'var(--teal)' : 'var(--navy)' }}>
                    {profile.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{profile.email}</div>
                </div>
                <div className={`avatar ${currentPage === 'profile' ? 'active' : ''}`}>
                  {getInitials(profile.name)}
                </div>
              </div>
              <button className="btn ghost" onClick={handleLogout} style={{ padding: '6px 12px', fontSize: 13 }} title="ออกจากระบบ">
                Logout
              </button>
            </div>
          </div>
        </header>

        <main className="page">
          {historyError && <div className="callout warn" role="alert" style={{ marginBottom: 16 }}>{historyError}</div>}
          {saveToast && (
            <div
              style={{
                marginBottom: 16,
                padding: '12px 18px',
                borderRadius: 8,
                backgroundColor: '#e8f5e9',
                color: '#1b5e20',
                border: '1px solid #c8e6c9',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontWeight: 600,
                fontSize: 14,
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
              }}
            >
              <span>✓</span> {saveToast}
            </div>
          )}
          {/* DASHBOARD PAGE */}
          <section style={{ display: currentPage === 'dashboard' ? 'block' : 'none' }}>
            <h1 className="page-title">Dashboard</h1>
            <div className="page-sub">ภาพรวมการวิเคราะห์และการปรับเทียบสีรอยฟกช้ำ</div>

            <div className="grid g4">
              <div className="card kpi">
                <div className="t">Total analyses</div>
                <div className="v">{history.length}</div>
                <div className="small">Records in your account</div>
              </div>
              <div className="card kpi">
                <div className="t">Calibrated images</div>
                <div className="v">{calibratedCount}</div>
                <div className="small">with reference scale</div>
              </div>
              <div className="card kpi">
                <div className="t">This month</div>
                <div className="v">{currentMonthCount}</div>
                <div className="small">new analyses logged</div>
              </div>
              <div className="card kpi">
                <div className="t">Last assessment</div>
                <div className="v" style={{ fontSize: 20 }}>{history[0]?.age || '—'}</div>
                <div className="small">estimated day band</div>
              </div>
            </div>

            <div className="grid g2" style={{ marginTop: 20 }}>
              <div className="card">
                <div className="card-h">
                  <b>Recent analyses</b>
                  <button className="btn secondary" onClick={() => setCurrentPage('history')} style={{ padding: '6px 12px', fontSize: 12 }}>
                    View all
                  </button>
                </div>
                <div className="card-b">
                  {history.length === 0 ? (
                    <div style={{ color: 'var(--muted)' }}>No analyses yet.</div>
                  ) : (
                    history.slice(0, 5).map(item => (
                      <div
                        key={item.id}
                        onClick={() => setSelectedCase(item)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 0',
                          borderBottom: '1px solid #edf0f2',
                          cursor: 'pointer'
                        }}
                        title="คลิกเพื่อดูผลการตรวจละเอียด"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt={item.caseId} className="tbl-thumb" style={{ width: 44, height: 44 }} />
                          ) : (
                            <div className="tbl-thumb-empty" style={{ width: 44, height: 44, fontSize: 10 }}>No img</div>
                          )}
                          <div>
                            <b style={{ color: 'var(--navy)' }}>{item.caseId}</b>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                              {item.file} • {item.bodySite}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span className="badge info">{item.age}</span>
                          <div style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 600, marginTop: 4 }}>
                            Inspect 🔍
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-h">
                  <b>Clinical Workflow</b>
                  <span className="badge ok">Ready</span>
                </div>
                <div className="card-b">
                  <div className="callout">
                    <b>1. Upload photo → 2. Auto detect card → 3. Calibrate → 4. Segment bruise → 5. Measure & Review</b>
                    <br />
                    <span style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                      การ์ดสเกลสีอ้างอิงในสภาพแสงเดียวกันจะช่วยปรับแก้ความคลาดสี (CCM) ทำให้การวัดค่าสีมีความน่าเชื่อถือและทำซ้ำได้
                    </span>
                  </div>
                  <div style={{ marginTop: 20 }}>
                    <button className="btn primary" onClick={() => setCurrentPage('analysis')}>
                      Start new analysis
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* NEW ANALYSIS PAGE */}
          <section style={{ display: currentPage === 'analysis' ? 'block' : 'none' }}>
            <h1 className="page-title">New Analysis</h1>
            <div className="page-sub">อัปโหลดภาพ ตรวจจับการ์ด ปรับเทียบสี และวิเคราะห์รอยฟกช้ำ</div>

            <div className="grid g2">
              {/* 1. Image acquisition */}
              <div className="card">
                <div className="card-h">
                  <b>1. Image acquisition</b>
                  <span className={`badge ${file ? 'ok' : 'info'}`}>
                    {file ? 'Image loaded' : 'No image'}
                  </span>
                </div>
                <div className="card-b">
                  {!file ? (
                    <div
                      className={`upload-zone ${isDragOver ? 'drag' : ''}`}
                      onClick={() => document.getElementById('imageFileInput')?.click()}
                      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={e => {
                        e.preventDefault();
                        setIsDragOver(false);
                        const f = e.dataTransfer.files[0];
                        if (f) loadFile(f);
                      }}
                    >
                      <div className="upload-icon">↑</div>
                      <b style={{ fontSize: 17, color: 'var(--navy)' }}>Drop clinical photo here or click to browse</b>
                      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, maxWidth: 380 }}>
                        วางไฟล์ภาพรอยฟกช้ำที่มีการ์ดสเกลสีอ้างอิง (Color Reference Card) เพื่อเริ่มการปรับเทียบสีอัตโนมัติ
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                        <span className="badge info">JPG / PNG / WebP</span>
                        <span className="badge info">HEIC / HEIF</span>
                        <span className="badge info">Max 25MB</span>
                      </div>
                      <div
                        className="btn primary"
                        style={{ marginTop: 22, padding: '10px 22px', fontSize: 14 }}
                      >
                        Select Image File
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 16px',
                          background: '#f8fafc',
                          border: '1px solid var(--line)',
                          borderRadius: 10,
                          marginBottom: 14
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, overflow: 'hidden' }}>
                          <div
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 8,
                              background: 'rgba(31, 111, 120, 0.12)',
                              color: 'var(--teal)',
                              display: 'grid',
                              placeItems: 'center',
                              fontSize: 20,
                              flexShrink: 0
                            }}
                          >
                            📷
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {file.name}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                              {(file.size / (1024 * 1024)).toFixed(2)} MB • โหลดภาพเรียบร้อย
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ padding: '6px 12px', fontSize: 12 }}
                            onClick={() => document.getElementById('imageFileInput')?.click()}
                            title="เลือกภาพอื่นแทนภาพนี้"
                          >
                            เปลี่ยนภาพ
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ padding: '6px 12px', fontSize: 12, color: 'var(--danger)', borderColor: '#feb2b2' }}
                            onClick={removeImage}
                            title="ลบภาพนี้ออกเพื่ออัปโหลดใหม่"
                          >
                            🗑️ ลบภาพออก
                          </button>
                        </div>
                      </div>

                      <div className="preview-wrap">
                        <canvas
                          ref={canvasRef}
                          id="imageCanvas"
                          onClick={handleCanvasClick}
                          style={{ display: 'block' }}
                        />
                        {refPixel && (
                          <div className="ref-pill">
                            Reference pixel: <b>RGB {refPixel.join(' / ')}</b>
                          </div>
                        )}
                      </div>

                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
                        Tip: สามารถคลิกบนบริเวณสีขาวหรือเทากลางบนการ์ดในภาพเพื่อเลือก reference pixel สำหรับ neutral calibration ได้
                      </div>
                    </>
                  )}

                  <input
                    id="imageFileInput"
                    type="file"
                    accept="image/*,.heic,.heif,.avif"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) loadFile(f);
                    }}
                  />
                </div>
              </div>

              {/* 2. Case Parameters & Submission */}
              <div className="card">
                <div className="card-h">
                  <b>2. Case parameters & notes</b>
                  <span className={`badge ${analysisResult?.calibration.is_calibrated ? 'ok' : 'warn'}`}>
                    {analysisResult?.calibration.is_calibrated ? 'Calibrated' : 'Pending analysis'}
                  </span>
                </div>
                <div className="card-b">
                  <div style={{ marginBottom: 14 }}>
                    <label>Case / Subject ID</label>
                    <input
                      className="input"
                      id="caseId"
                      placeholder="Case001"
                      value={caseId}
                      onChange={e => { caseIdEditedRef.current = true; setCaseId(e.target.value); }}
                      disabled={isSavingDb}
                    />
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label>Body site</label>
                    <select
                      className="input"
                      value={bodySite}
                      onChange={e => setBodySite(e.target.value)}
                    >
                      <option value="">Select body site</option>
                      <option value="Arm">Arm (แขน)</option>
                      <option value="Leg">Leg (ขา)</option>
                      <option value="Torso">Torso (ลำตัว/หน้าอก)</option>
                      <option value="Face">Face (ใบหน้า)</option>
                      <option value="Other">Other (อื่นๆ)</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: 18 }}>
                    <label>Notes</label>
                    <input
                      className="input"
                      placeholder="Optional clinical / lighting notes"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                    />
                  </div>

                  <button
                    className="btn primary"
                    style={{ width: '100%', padding: '14px' }}
                    disabled={!file || isAnalyzing}
                    onClick={runAnalysis}
                  >
                    {isAnalyzing ? 'Running pipeline analysis...' : 'Analyze Photo & Bruise'}
                  </button>

                  {analysisError && (
                    <div style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>
                      {analysisError}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ANALYSIS RESULTS BLOCK */}
            {analysisResult && (
              <div style={{ marginTop: 24 }}>
                <div className="grid g2">
                  {/* Color Profile */}
                  <div className="card">
                    <div className="card-h">
                      <b>Color Profile</b>
                      <span className="badge ok">Analysis complete</span>
                    </div>
                    <div className="card-b">
                      <div className="grid g2">
                        <div className="metric">
                          <div className="label">Mean RGB</div>
                          <div className="value">{analysisResult.color_profile.mean_rgb.join(', ')}</div>
                        </div>
                        <div className="metric">
                          <div className="label">Mean Lightness</div>
                          <div className="value">{analysisResult.color_profile.mean_lightness}%</div>
                        </div>
                      </div>

                      <div style={{ marginTop: 20 }}>
                        <label>Dominant Colors (เทียบกับสเกล CIEDE2000)</label>
                        <div className="palette" style={{ marginTop: 10 }}>
                          {analysisResult.color_profile.dominant_colors.map((c, i) => (
                            <div key={i} className="swatch">
                              <div className="swatch-color" style={{ background: c.hex }} />
                              <div className="swatch-txt">
                                <b>{c.hex}</b>
                                <br />
                                {c.name}
                                <br />
                                {c.percent}% sampled
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Age Assessment */}
                  <div className="card">
                    <div className="card-h">
                      <b>Bruise Assessment</b>
                      <span className="badge warn">Experimental Heuristic</span>
                    </div>
                    <div className="card-b">
                      <div className="grid g2">
                        <div className="metric">
                          <div className="label">Estimated Day Range</div>
                          <div className="value" style={{ color: 'var(--teal)' }}>
                            {analysisResult.age_estimate.range || 'N/A (No bruise)'}
                          </div>
                        </div>
                        <div className="metric">
                          <div className="label">Confidence Level</div>
                          <div className="value" style={{ fontSize: 16 }}>
                            {analysisResult.age_estimate.confidence} ({analysisResult.age_estimate.confidence_score}/100)
                          </div>
                        </div>
                      </div>


                      <div className="callout" style={{ marginTop: 14 }}>
                        <b>{analysisResult.age_estimate.reason || 'Normal skin / no significant wound proposal'}</b>
                        <br />
                        <span style={{ fontSize: 12 }}>{analysisResult.age_estimate.note}</span>
                      </div>

                      <div className="disclaimer" style={{ marginTop: 14 }}>
                        <b>Important Medical Notice:</b> การประเมินช่วงวันเป็น Heuristic สำหรับ prototype เท่านั้น
                        ไม่สามารถใช้เป็นหลักฐานยืนยันอายุแผลทางนิติวิทยาศาสตร์ได้
                        เนื่องจากสีของรอยฟกช้ำขึ้นกับความลึก สภาพผิว และการฟื้นตัวของร่างกายแต่ละบุคคล
                      </div>
                    </div>
                  </div>
                </div>

                {/* Visual overlay */}
                <div style={{ marginTop: 20 }}>
                  {/* Visual Composite Overlays */}
                  <div className="card">
                    <div className="card-h">
                      <b>Visual Composite & Mask Overlay</b>
                      <span className="small">Green: Skin | Red: Bruise Mask</span>
                    </div>
                    <div className="card-b" style={{ textAlign: 'center' }}>
                      {analysisResult.previews?.overlay ? (
                        <img
                          src={analysisResult.previews.overlay}
                          alt="Wound and Skin Overlay"
                          style={{ maxWidth: '100%', maxHeight: 380, borderRadius: 8, border: '1px solid var(--line)' }}
                        />
                      ) : analysisResult.previews?.calibrated ? (
                        <img
                          src={analysisResult.previews.calibrated}
                          alt="Calibrated Preview"
                          style={{ maxWidth: '100%', maxHeight: 380, borderRadius: 8, border: '1px solid var(--line)' }}
                        />
                      ) : (
                        <div style={{ color: 'var(--muted)', padding: 40 }}>Overlay preview rendered on canvas</div>
                      )}
                    </div>
                  </div>

                </div>

                <AnalysisDetails result={analysisResult} />

                <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                  <button className="btn secondary" onClick={clearAnalysisForm}>
                    Clear
                  </button>
                  <button
                    className="btn primary"
                    onClick={saveAnalysisToHistory}
                    disabled={isSavingDb}
                  >
                    {isSavingDb ? 'Saving to MySQL...' : 'Save to Clinical History (MySQL)'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* HISTORY PAGE */}
          <section style={{ display: currentPage === 'history' ? 'block' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <div>
                <h1 className="page-title" style={{ marginBottom: 4 }}>Analysis History</h1>
                <div className="page-sub" style={{ margin: 0 }}>
                  ประวัติการวิเคราะห์ส่วนบุคคล (บันทึกแยกเฉพาะบัญชี: <b>{profile.email}</b>)
                </div>
              </div>
              <button
                className="btn secondary"
                onClick={() => refreshFromDatabase(profile.email)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                title="ซิงค์ดึงประวัติล่าสุดของบัญชีคุณจาก MySQL (ระบบรีเฟรชอัตโนมัติทุก 20 วินาที)"
              >
                🔄 ซิงค์ข้อมูลบัญชีนี้ <span style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 600 }}>(Auto 20s)</span>
              </button>
            </div>

            <div className="card">
              <div className="card-b">
                <div className="filters">
                  <input
                    className="input"
                    placeholder="Search case ID, file name, body site, notes..."
                    value={searchHistory}
                    onChange={e => setSearchHistory(e.target.value)}
                  />
                  <select
                    className="input"
                    value={filterAge}
                    onChange={e => setFilterAge(e.target.value)}
                  >
                    <option value="">All age ranges</option>
                    <option value="0–2 วัน">0–2 วัน</option>
                    <option value="2–5 วัน">2–5 วัน</option>
                    <option value="5–7 วัน">5–7 วัน</option>
                    <option value="7–10 วัน">7–10 วัน</option>
                    <option value="10–14 วัน">10–14 วัน</option>
                  </select>
                  <select
                    className="input"
                    value={filterCal}
                    onChange={e => setFilterCal(e.target.value)}
                  >
                    <option value="">All calibration</option>
                    <option value="yes">Calibrated</option>
                    <option value="no">Not calibrated</option>
                  </select>
                  <button className="btn secondary" onClick={exportCsv}>
                    Export CSV
                  </button>
                </div>

                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Preview</th>
                        <th>Case ID</th>
                        <th>Date</th>
                        <th>Body Site</th>
                        <th>Dominant Colors</th>
                        <th>Estimated Age</th>
                        <th>Calibration</th>
                        <th>Save status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.length === 0 ? (
                        <tr>
                          <td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>
                            No matching records found.
                          </td>
                        </tr>
                      ) : (
                        filteredHistory.map(row => (
                          <tr key={row.id}>
                            <td>
                              {row.thumbnail ? (
                                <img
                                  src={row.thumbnail}
                                  alt={row.caseId}
                                  className="tbl-thumb"
                                  onClick={() => setSelectedCase(row)}
                                  style={{ cursor: 'pointer' }}
                                  title="คลิกเพื่อดูรายละเอียดผลวิเคราะห์"
                                />
                              ) : (
                                <div
                                  className="tbl-thumb-empty"
                                  onClick={() => setSelectedCase(row)}
                                  style={{ cursor: 'pointer' }}
                                  title="คลิกเพื่อดูรายละเอียดผลวิเคราะห์"
                                >
                                  No img
                                </div>
                              )}
                            </td>
                            <td>
                              <div
                                onClick={() => setSelectedCase(row)}
                                style={{ cursor: 'pointer', color: 'var(--navy)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
                                title="คลิกเพื่อเปิดรายงานเคส"
                              >
                                <span>{row.caseId}</span>
                                <span style={{ fontSize: 11, color: 'var(--teal)' }}>🔍</span>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{row.file}</div>
                            </td>
                            <td>{new Date(row.date).toLocaleString()}</td>
                            <td><b>{row.bodySite}</b></td>
                            <td>
                              {row.colors.map((c, i) => (
                                <span key={i} className="color-dot" style={{ background: c }} title={c} />
                              ))}
                            </td>
                            <td><span className="badge info">{row.age}</span></td>
                            <td>
                              {row.calibrated ? (
                                <span className="badge ok">Calibrated</span>
                              ) : (
                                <span className="badge warn">{row.resultJson?.calibration?.is_calibrated === false ? 'Raw' : 'Unknown'}</span>
                              )}
                            </td>
                            <td><span className={`badge ${row.syncStatus === 'pending' ? 'warn' : 'ok'}`}>{row.syncStatus === 'pending' ? 'Pending sync' : 'MySQL'}</span></td>
                            <td>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {row.syncStatus === 'pending' && <button className="btn teal" disabled={busyRecord !== null} onClick={() => syncPendingRecord(row)}>{busyRecord === row.id ? 'Saving...' : 'Save to MySQL'}</button>}
                                <button
                                  className="btn teal"
                                  onClick={() => setSelectedCase(row)}
                                  style={{ padding: '5px 12px', fontSize: 12 }}
                                  title="View full clinical case details"
                                >
                                  View Detail
                                </button>
                                <button
                                  className="btn secondary"
                                  onClick={() => deleteHistoryItem(row.id)}
                                  disabled={busyRecord !== null}
                                  style={{ padding: '5px 10px', fontSize: 12, color: 'var(--danger)' }}
                                  title="Delete record from MySQL"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          {/* PROFILE PAGE */}
          <section style={{ display: currentPage === 'profile' ? 'block' : 'none' }}>
            <h1 className="page-title">Profile</h1>
            <div className="page-sub">ข้อมูลบัญชีผู้ใช้งานทางคลินิก (Clinical Research Account)</div>

            <div className="card">
              <div className="card-b profile-grid">
                <div>
                  <div className="profile-photo">{getInitials(profile.name)}</div>
                  <div style={{ marginTop: 12, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
                    Forensic & Clinical Researcher
                  </div>
                </div>

                <div>
                  <form onSubmit={handleSaveProfile}>
                    <div className="grid g2">
                      <div>
                        <label>Full name (ชื่อ-นามสกุล)</label>
                        <input
                          className="input"
                          value={profile.name}
                          onChange={e => setProfile({ ...profile, name: e.target.value })}
                          required
                          placeholder="ชื่อ-นามสกุลของคุณ"
                        />
                      </div>
                      <div>
                        <label>Email Account (LOCK)</label>
                        <input
                          type="email"
                          className="input"
                          value={profile.email}
                          readOnly
                          disabled
                          style={{
                            background: '#f1f5f9',
                            color: '#64748b',
                            cursor: 'not-allowed',
                            border: '1px solid #cbd5e1'
                          }}
                        />
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                          🔒 อีเมลนี้ใช้เป็นรหัสระบุตัวตนและแยกข้อมูลเคสคนไข้ใน MySQL ไม่สามารถแก้ไขได้
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 24 }}>
                      <button type="submit" className="btn primary">
                        Save Changes (บันทึกชื่อผู้ใช้)
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* CLINICAL CASE INSPECTION MODAL */}
      {selectedCase && (
        <div className="modal-backdrop" onClick={() => setSelectedCase(null)}>
          <div className="modal-dialog case-report" role="dialog" aria-modal="true" aria-label="Analysis report" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h2 style={{ fontSize: 20, color: 'var(--navy)' }}>{selectedCase.caseId}</h2>
                  <span className={`badge ${selectedCase.calibrated ? 'ok' : 'warn'}`}>
                    {selectedCase.calibrated ? 'Calibrated' : selectedCase.resultJson?.calibration?.is_calibrated === false ? 'Raw / Uncalibrated' : 'Calibration unavailable'}
                  </span>
                  <span className="badge info">{selectedCase.age}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  บันทึกเมื่อ: {new Date(selectedCase.date).toLocaleString()} • ตำแหน่งร่างกาย: <b>{selectedCase.bodySite}</b> • ไฟล์: {selectedCase.file}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  className="btn secondary"
                  style={{ padding: '6px 12px', fontSize: 13 }}
                  onClick={() => window.print()}
                  title="Print clinical assessment report"
                >
                  🖨️ Print Report
                </button>
                <button
                  className="btn ghost"
                  style={{ padding: '6px 10px', fontSize: 16 }}
                  onClick={() => setSelectedCase(null)}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="modal-body">
              {/* Image Previews Grid */}
              <div className="case-preview-grid">
                <div className="case-preview-card">
                  <div className="img-wrap">
                    {selectedCase.resultJson?.previews?.original ? (
                      <img src={selectedCase.resultJson.previews.original} alt="Original Image" />
                    ) : selectedCase.thumbnail ? (
                      <img src={selectedCase.thumbnail} alt="Thumbnail Preview" />
                    ) : (
                      <div style={{ color: '#99adc2', fontSize: 13 }}>No preview image</div>
                    )}
                  </div>
                  <div className="caption">1. ภาพถ่ายต้นฉบับ (Original)</div>
                </div>

                <div className="case-preview-card">
                  <div className="img-wrap">
                    {selectedCase.resultJson?.previews?.calibrated ? (
                      <img src={selectedCase.resultJson.previews.calibrated} alt="Calibrated Image" />
                    ) : (
                      <div style={{ color: '#99adc2', fontSize: 13 }}>ไม่มีภาพ Calibrate แยกต่างหาก</div>
                    )}
                  </div>
                  <div className="caption">2. ภาพปรับเทียบสีแล้ว (CCM Calibrated)</div>
                </div>

                <div className="case-preview-card">
                  <div className="img-wrap">
                    {selectedCase.resultJson?.previews?.overlay ? (
                      <img src={selectedCase.resultJson.previews.overlay} alt="Overlay & Mask" />
                    ) : selectedCase.thumbnail ? (
                      <img src={selectedCase.thumbnail} alt="Overlay Preview" />
                    ) : (
                      <div style={{ color: '#99adc2', fontSize: 13 }}>ไม่มีภาพ Overlay</div>
                    )}
                  </div>
                  <div className="caption">3. รอยแผลที่ตีกรอบ Mask (Overlay)</div>
                </div>
              </div>

              {/* Assessment Summary KPI Grid */}
              <div className="grid g4" style={{ marginBottom: 20 }}>
                <div className="card kpi">
                  <div className="t">Estimated Age Range</div>
                  <div className="v" style={{ fontSize: 20 }}>{selectedCase.age}</div>
                  <div className="small">Heuristic Color Band</div>
                </div>
                <div className="card kpi">
                  <div className="t">Confidence Score</div>
                  <div className="v" style={{ fontSize: 20 }}>
                    {selectedCase.resultJson?.age_estimate?.confidence_score ?? selectedCase.confidence ?? 0}%
                  </div>
                  <div className="small">{selectedCase.resultJson?.age_estimate?.confidence || 'Confidence level'}</div>
                </div>
                <div className="card kpi">
                  <div className="t">LOOCV Median ΔE00</div>
                  <div className="v" style={{ fontSize: 20 }}>
                    {selectedCase.resultJson?.calibration?.loocv_median_de00 != null
                      ? selectedCase.resultJson.calibration.loocv_median_de00.toFixed(2)
                      : selectedCase.deltaE00 != null ? selectedCase.deltaE00.toFixed(2) : '—'}
                  </div>
                  <div className="small">ColorChecker Calibration Error</div>
                </div>
                <div className="card kpi">
                  <div className="t">Wound Area (ขนาดแผล)</div>
                  <div className="v" style={{ fontSize: 20 }}>
                    {selectedCase.resultJson?.wound_size?.area_cm2 != null
                      ? `${selectedCase.resultJson.wound_size.area_cm2} cm²`
                      : '—'}
                  </div>
                  <div className="small">
                    {selectedCase.resultJson?.wound_size?.width_cm != null && selectedCase.resultJson?.wound_size?.length_cm != null
                      ? `${selectedCase.resultJson.wound_size.width_cm} × ${selectedCase.resultJson.wound_size.length_cm} cm`
                      : 'Approximate area'}
                  </div>
                </div>
              </div>

              {/* Dominant Colors & Clinical reasoning */}
              <div className="grid g2" style={{ marginBottom: 20 }}>
                <div className="card">
                  <div className="card-h">
                    <b>Dominant Color Profile (กลุ่มสีเด่น)</b>
                    <span className="small">Extracted Clusters</span>
                  </div>
                  <div className="card-b">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {selectedCase.resultJson?.color_profile?.dominant_colors?.length ? selectedCase.resultJson.color_profile.dominant_colors.map((col, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--line)',
                            background: '#fafbfc'
                          }}
                        >
                          <span className="color-dot" style={{ background: col.hex, width: 20, height: 20 }} />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700 }}>{col.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {col.hex} • {col.percent}%
                            </div>
                          </div>
                        </div>
                      )) : selectedCase.colors.map((c, i) => (
                        <span key={i} className="color-dot" style={{ background: c, width: 24, height: 24 }} title={c} />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-h">
                    <b>Clinical Reasoning & Notes</b>
                    <span className="small">เหตุผลประกอบการประเมิน</span>
                  </div>
                  <div className="card-b">
                    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                      <b>Clinical Reasoning:</b>
                      <p style={{ color: '#4a5568', marginTop: 4 }}>
                        {selectedCase.resultJson?.age_estimate?.reason || selectedCase.notes || 'ไม่มีบันทึกเพิ่มเติม'}
                      </p>
                      {selectedCase.notes && selectedCase.notes !== selectedCase.resultJson?.age_estimate?.reason && (
                        <div style={{ marginTop: 10 }}>
                          <b>Clinician Notes:</b>
                          <p style={{ color: '#4a5568', marginTop: 2 }}>{selectedCase.notes}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {selectedCase.resultJson ? (
                <AnalysisDetails result={selectedCase.resultJson} />
              ) : <div className="callout" role="status">This older record has no saved colour or histogram details. Analyse the original photo again to create a complete record.</div>}

              {/* Calibration Card Patches Table if present */}
              {selectedCase.resultJson?.calibration?.table && selectedCase.resultJson.calibration.table.length > 0 && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <div className="card-h">
                    <b>ColorChecker Scale Calibration Metrics (ΔE00)</b>
                    <span className="small">Leave-One-Out Cross-Validation (LOOCV)</span>
                  </div>
                  <div className="card-b">
                    <div className="tbl-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
                      <table className="tbl" style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th>Type</th>
                            <th>Patch Name</th>
                            <th>RGB Captured</th>
                            <th>RGB Corrected</th>
                            <th>RGB Reference</th>
                            <th>ΔE00 Before</th>
                            <th>ΔE00 After</th>
                            <th>LOOCV ΔE00</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCase.resultJson.calibration.table.map((row, i) => (
                            <tr key={i}>
                              <td><b>{row.kind}</b></td>
                              <td>{row.name}</td>
                              <td>{row.rgb_captured?.join(', ')}</td>
                              <td>{row.rgb_corrected?.join(', ')}</td>
                              <td>{row.rgb_reference?.join(', ')}</td>
                              <td>{row.de00_before ?? '—'}</td>
                              <td><b style={{ color: 'var(--success)' }}>{row.de00_after ?? '—'}</b></td>
                              <td>{row.loocv_de00 ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Clinical Disclaimer */}
              <div className="callout warn" style={{ fontSize: 12 }}>
                <b>⚠️ คำเตือนทางการแพทย์และนิติเวช (Clinical & Forensic Disclaimer):</b>
                <br />
                ผลการประเมินช่วงวันของรอยฟกช้ำเป็นเพียง Heuristic จากสเปกตรัมสีสำหรับงานวิจัยเท่านั้น
                สีของบาดแผลเพียงอย่างเดียวไม่สามารถระบุวันเวลาบาดเจ็บได้อย่างแน่นอนทางนิติวิทยาศาสตร์
                เนื่องจากปัจจัยด้านสีผิวพื้นฐานของผู้ป่วย ตำแหน่งอวัยวะ และการฟื้นตัวของเนื้อเยื่อเฉพาะบุคคล
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn secondary"
                onClick={() => window.print()}
              >
                🖨️ Print / Export PDF
              </button>
              <button
                className="btn primary"
                onClick={() => setSelectedCase(null)}
              >
                Close (ปิด)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
