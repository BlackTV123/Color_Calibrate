import { t, useLanguage, getLocale } from './i18n';
import React, { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import LanguageSwitcher from './LanguageSwitcher';
import PasswordInput from './PasswordInput';
import Home from './Home';
import NavigationDrawer from './NavigationDrawer';
import { readPage, isWorkspacePage, type Page, type WorkspacePage } from './navigation';
import { validateRegistrationPassword, validatePhotoFile, AGE_UNAVAILABLE, formatAgeEstimate, isLegacyDemo, parseAnalysisResponse } from './ui';
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
// This marker coordinates tabs; authentication is only in the HttpOnly cookie.
const KEY_SESSION = 'bcc_session_marker_v2';

function getAuthHeaders(): Record<string, string> {
  return { 'X-Requested-With': 'BruiseWeb' };
}

export default function App() {
  useLanguage();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(() => Boolean(localStorage.getItem(KEY_SESSION) || localStorage.getItem(KEY_S)));
  const [sessionVersion, setSessionVersion] = useState(0);
  const verifiedTokenRef = useRef<string | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'register'>(() => readPage(window.location.hash) === 'register' ? 'register' : 'signin');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [authSuccessMsg, setAuthSuccessMsg] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [dbStatus, setDbStatus] = useState<'connected' | 'offline' | 'checking'>('checking');

  // Register form states
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  const [currentPage, setRoute] = useState<Page>(() => readPage(window.location.hash));
  const [menuOpen, setMenuOpen] = useState(false);
  const pendingPageRef = useRef<WorkspacePage>(isWorkspacePage(readPage(window.location.hash)) ? readPage(window.location.hash) as WorkspacePage : 'dashboard');
  function setCurrentPage(page: Page, replace = false) {
    if (isWorkspacePage(page) && !isAuthenticated && !isCheckingSession) {
      pendingPageRef.current = page;
      page = 'login';
    }
    setMenuOpen(false);
    if (page === 'login' || page === 'register') { setAuthMode(page === 'login' ? 'signin' : 'register'); setLoginError(''); }
    if (page === 'register') setAuthSuccessMsg('');
    setRoute(page);
    if (replace) window.history.replaceState(null, '', '#' + page);
    else if (window.location.hash !== '#' + page) window.location.hash = page;
  }

  useEffect(() => {
    const onHashChange = () => {
      const page = readPage(window.location.hash);
      setRoute(page);
      setMenuOpen(false);
      if (page === 'login' || page === 'register') setAuthMode(page === 'login' ? 'signin' : 'register');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (isCheckingSession) return;
    if (!isAuthenticated && isWorkspacePage(currentPage)) setCurrentPage(currentPage, true);
    if (isAuthenticated && (currentPage === 'login' || currentPage === 'register')) setCurrentPage(pendingPageRef.current, true);
  }, [isAuthenticated, isCheckingSession, currentPage]);

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
  const [historyError, setHistoryError] = useState<string | string[] | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
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
    setIsSavingProfile(false);
    setProfileFeedback(null);
  }

  function expireSession(token: string, message = 'เซสชันหมดอายุหรือยืนยันตัวตนไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่') {
    if ((localStorage.getItem(KEY_SESSION) || '') !== token) return;
    localStorage.removeItem(KEY_S);
    localStorage.removeItem(KEY_SESSION);
    resetSessionView();
    setIsCheckingSession(false);
    setAuthMode('signin');
    setCurrentPage('login');
    setLoginEmail(profile.email);
    setLoginError(message);
  }

  useEffect(() => {
    localStorage.removeItem('bcc_token_v1'); // Remove credentials left by older builds.
    const token = localStorage.getItem(KEY_SESSION) || '';
    const hadSession = localStorage.getItem(KEY_S) === '1';
    if (!token) {
      localStorage.removeItem(KEY_S);
      setIsCheckingSession(false);
      if (hadSession) { setCurrentPage('login'); setLoginError('กรุณาเข้าสู่ระบบใหม่เพื่อยืนยันตัวตน'); }
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsCheckingSession(true);
    async function restoreSession() {
      try {
        const response = await fetch('/api/auth/me', {
          headers: getAuthHeaders(), signal: controller.signal,
        });
        if (cancelled || token !== localStorage.getItem(KEY_SESSION)) return;
        if (response.status === 401) { expireSession(token); return; }
        if (!response.ok) throw new Error('ตรวจสอบการเข้าสู่ระบบไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง');
        const data = await response.json();
        if (cancelled || token !== localStorage.getItem(KEY_SESSION)) return;
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
        if (!cancelled && token === localStorage.getItem(KEY_SESSION)) {
          setCurrentPage('login');
          setLoginEmail(profile.email);
          setLoginError(error instanceof Error ? error.message : 'ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ');
        }
      } finally {
        if (!cancelled && token === localStorage.getItem(KEY_SESSION)) setIsCheckingSession(false);
      }
    }
    restoreSession();
    return () => { cancelled = true; controller.abort(); };
  }, [sessionVersion]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== KEY_SESSION && event.key !== null) return;
      resetSessionView();
      setIsCheckingSession(Boolean(localStorage.getItem(KEY_SESSION)));
      setSessionVersion(value => value + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const email = profile.email.trim().toLowerCase();
    const token = localStorage.getItem(KEY_SESSION);
    if (!isAuthenticated || !email || !token || verifiedTokenRef.current !== token) return;
    let cancelled = false;
    readHistoryCache(email).then(cached => {
      if (cancelled || token !== localStorage.getItem(KEY_SESSION)) return;
      updateHistory(current => remoteLoadedRef.current === token || current.length
        ? mergeHistory(current, cached) : cached);
      setCacheReady(`${token}|${email}`);
    });
    return () => { cancelled = true; };
  }, [isAuthenticated, profile.email]);

  useEffect(() => {
    const email = profile.email.trim().toLowerCase();
    const token = localStorage.getItem(KEY_SESSION);
    if (!isAuthenticated || !email || !token || verifiedTokenRef.current !== token || cacheReady !== `${token}|${email}`) return;
    persistHistoryCache(email, history).catch(() => {
      if (token === localStorage.getItem(KEY_SESSION) && history.some(row => row.syncStatus === 'pending')) {
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
    const token = localStorage.getItem(KEY_SESSION);
    const requestId = ++refreshIdRef.current;
    const revision = historyRevisionRef.current;
    const currentSession = () => token === localStorage.getItem(KEY_SESSION) && token === verifiedTokenRef.current && requestId === refreshIdRef.current;
    if (!token || verifiedTokenRef.current !== token) return;
    setIsLoadingHistory(true);
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
        const res = await fetch(`/api/records?limit=500&offset=${offset}`, { headers: getAuthHeaders() });
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
    } finally { if (currentSession()) setIsLoadingHistory(false); }
  }

  // Auto-refresh history and database health every 20 seconds when logged in
  useEffect(() => {
    if (!isAuthenticated || !profile.email) return;

    refreshFromDatabase(profile.email);
    const refreshVisible = () => { if (document.visibilityState === 'visible') refreshFromDatabase(profile.email); };
    const interval = setInterval(refreshVisible, 20000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', refreshVisible); };
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
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [referencePoint, setReferencePoint] = useState<[number, number] | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewVersionRef = useRef(0);
  const reportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedCase || !reportRef.current) return;
    const report = reportRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const background = [...document.querySelectorAll<HTMLElement>('.app-view > :not(.modal-backdrop)')];
    const inertStates = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    const focusable = () => [...report.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])'
    )].filter(element => element.getClientRects().length > 0);
    const close = report.querySelector<HTMLElement>('[data-close-report]');
    (close || report).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSelectedCase(null); return; }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); report.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !report.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !report.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      background.forEach((element, i) => { element.inert = inertStates[i]; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [selectedCase]);

  useEffect(() => {
    if (isCheckingSession) return;
    const frame = requestAnimationFrame(() => document.getElementById('page-title-' + currentPage)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [currentPage, isAuthenticated, isCheckingSession]);



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
  useEffect(() => () => {
    analysisAbortRef.current?.abort();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  function removeImage() {
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    previewVersionRef.current++;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setIsAnalyzing(false);
    setPreviewStatus('idle');
    setPreviewMessage(null);
    setReferencePoint(null);
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

  // Clear any active uploaded image and form whenever user account changes
  useEffect(() => {
    clearAnalysisForm();
  }, [profile.email]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    setAuthSuccessMsg('');
    if ([...loginPassword].length > 128) { setLoginError('รหัสผ่านต้องมีความยาวไม่เกิน 128 ตัวอักษร'); return; }
    setIsSubmittingAuth(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.session_authenticated !== true) throw new Error('Server did not establish a session');
        const marker = crypto.randomUUID();
        localStorage.setItem(KEY_S, '1');
        localStorage.setItem(KEY_SESSION, marker);
        verifiedTokenRef.current = marker;
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

        setLoginPassword('');
        setRegPassword('');
        setRegConfirmPassword('');
        setLogoutError('');
        setIsAuthenticated(true);
        setCurrentPage(pendingPageRef.current);
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

    const registrationEmail = regEmail.trim().toLowerCase();
    if (!/^[^\s@]+@gmail\.com$/.test(registrationEmail)) {
      setLoginError("กรุณาใช้อีเมลที่ลงท้ายด้วย @gmail.com เท่านั้น");
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setLoginError('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }
    const passwordError = validateRegistrationPassword(regPassword);
    if (passwordError) {
      setLoginError(passwordError);
      return;
    }

    setIsSubmittingAuth(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          name: regName,
          email: registrationEmail,
          password: regPassword
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'การลงทะเบียนไม่สำเร็จ');
      }

      setAuthSuccessMsg("รับคำขอสมัครสมาชิกแล้ว หากมีบัญชีอยู่แล้วให้เข้าสู่ระบบด้วยรหัสผ่านเดิม");
      setLoginEmail(registrationEmail);
      setLoginPassword('');
      setRegPassword('');
      setRegConfirmPassword('');
      setCurrentPage('login');
    } catch (err: any) {
      setLoginError(err.message || 'เกิดข้อผิดพลาดในการลงทะเบียน');
    } finally {
      setIsSubmittingAuth(false);
    }
  }

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setLogoutError('');
    const marker = localStorage.getItem(KEY_SESSION);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: getAuthHeaders() });
      if (!response.ok) throw new Error('ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง');
      if (marker !== localStorage.getItem(KEY_SESSION)) return;
      localStorage.removeItem(KEY_S);
      localStorage.removeItem(KEY_SESSION);
      resetSessionView();
      setIsCheckingSession(false);
      setLoginPassword('');
      setRegPassword('');
      setRegConfirmPassword('');
      setLoginError('');
      setCurrentPage('home');
    } catch {
      setLogoutError('ติดต่อเซิร์ฟเวอร์เพื่อออกจากระบบไม่ได้ กรุณาลองอีกครั้ง');
    } finally { setIsLoggingOut(false); }
  }

  async function handleSaveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (isSavingProfile) return;
    const token = localStorage.getItem(KEY_SESSION) || '';
    const next = { ...profile, name: profile.name.trim() };
    if (!next.name) { setProfileFeedback({ kind: 'error', message: 'กรุณากรอกชื่อผู้ใช้' }); return; }
    setIsSavingProfile(true);
    setProfileFeedback(null);
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ name: next.name, email: next.email }),
      });
      if (token !== localStorage.getItem(KEY_SESSION)) return;
      if (response.status === 401) { expireSession(token); return; }
      if (!response.ok) throw new Error('บันทึกชื่อบนเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองอีกครั้ง');
      localStorage.setItem(KEY_P, JSON.stringify(next));
      setProfile(next);
      setProfileFeedback({ kind: 'success', message: 'บันทึกชื่อผู้ใช้ใน MySQL แล้ว' });
    } catch (error) {
      if (token === localStorage.getItem(KEY_SESSION)) {
        setProfileFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'ติดต่อเซิร์ฟเวอร์ไม่ได้ ข้อความที่กรอกยังอยู่ กรุณาลองอีกครั้ง' });
      }
    } finally { if (token === localStorage.getItem(KEY_SESSION)) setIsSavingProfile(false); }
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
    const error = validatePhotoFile(selectedFile);
    if (error) { setAnalysisError(error); return; }
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setIsAnalyzing(false);
    const version = ++previewVersionRef.current;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    setFile(selectedFile);
    setAnalysisError(null);
    setAnalysisResult(null);
    setRefPixel(null);
    setReferencePoint(null);
    setGainText('—');
    setIsManualCalibrated(false);
    originalImageDataRef.current = null;
    workingImageDataRef.current = null;
    setPreviewStatus('loading');
    setPreviewMessage(null);
    const url = URL.createObjectURL(selectedFile);
    previewUrlRef.current = url;
    const image = new Image();
    const release = () => {
      URL.revokeObjectURL(url);
      if (previewUrlRef.current === url) previewUrlRef.current = null;
    };
    const unavailable = () => {
      if (version !== previewVersionRef.current) { release(); return; }
      setPreviewStatus('unavailable');
      setPreviewMessage('เบราว์เซอร์แสดงตัวอย่างไฟล์นี้ไม่ได้ คุณยังส่งภาพไปวิเคราะห์กับ backend ได้');
      release();
    };
    image.onload = () => {
      if (version !== previewVersionRef.current) { release(); return; }
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d', { willReadFrequently: true });
      if (!canvas || !context) { unavailable(); return; }
      try {
        const scale = Math.min(1000 / image.width, 650 / image.height, 1);
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        originalImageDataRef.current = context.getImageData(0, 0, canvas.width, canvas.height);
        workingImageDataRef.current = new ImageData(
          new Uint8ClampedArray(originalImageDataRef.current.data), canvas.width, canvas.height
        );
        setPreviewStatus('ready');
      } catch { unavailable(); }
      release();
    };
    image.onerror = unavailable;
    image.src = url;
  }

  function inspectReferencePoint(x: number, y: number) {
    const canvas = canvasRef.current;
    const pixels = workingImageDataRef.current;
    if (!canvas || !pixels) return;
    x = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
    y = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
    const index = (y * canvas.width + x) * 4;
    setReferencePoint([x, y]);
    setRefPixel([pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]]);
  }

  function handleCanvasClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    inspectReferencePoint((event.clientX - bounds.left) * canvas.width / bounds.width,
      (event.clientY - bounds.top) * canvas.height / bounds.height);
  }

  function handleCanvasKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !workingImageDataRef.current) return;
    let [x, y] = referencePoint || [Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)];
    const step = event.shiftKey ? 10 : 1;
    switch (event.key) {
      case 'ArrowLeft': x -= step; break;
      case 'ArrowRight': x += step; break;
      case 'ArrowUp': y -= step; break;
      case 'ArrowDown': y += step; break;
      case 'Home': x = Math.floor(canvas.width / 2); y = Math.floor(canvas.height / 2); break;
      case 'Enter': case ' ': break;
      default: return;
    }
    event.preventDefault();
    inspectReferencePoint(x, y);
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

  // Report only validated backend analysis results; keep input available on errors.
  async function runAnalysis() {
    if (!file || isAnalyzing) return;
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 120000);
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/analyze', { method: 'POST', headers: getAuthHeaders(), body: formData, signal: controller.signal });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(typeof error.detail === 'string' ? error.detail : 'เซิร์ฟเวอร์วิเคราะห์ภาพไม่สำเร็จ กรุณาลองอีกครั้ง');
      }
      const data = parseAnalysisResponse(await response.json().catch(() => { throw new Error('รูปแบบผลวิเคราะห์จากเซิร์ฟเวอร์ไม่ถูกต้อง กรุณาลองอีกครั้ง'); }));
      if (analysisAbortRef.current === controller) setAnalysisResult(data);
    } catch (error) {
      if (analysisAbortRef.current !== controller) return;
      setAnalysisError(timedOut ? 'การวิเคราะห์ใช้เวลานานเกินไป กรุณาลองอีกครั้งหรือลดขนาดภาพ'
        : error instanceof TypeError ? 'ติดต่อเซิร์ฟเวอร์วิเคราะห์ไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง' : error instanceof Error && error.name !== 'AbortError' ? error.message
        : 'ติดต่อเซิร์ฟเวอร์วิเคราะห์ไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง');
    } finally {
      window.clearTimeout(timeout);
      if (analysisAbortRef.current === controller) { analysisAbortRef.current = null; setIsAnalyzing(false); }
    }
  }

  async function saveAnalysisToHistory() {
    if (!analysisResult || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setIsSavingDb(true);
    setHistoryError(null);
    const email = profile.email.trim().toLowerCase();
    const token = localStorage.getItem(KEY_SESSION) || '';
    const clientId = crypto.randomUUID();
    const record: HistoryItem = {
      id: `local-${clientId}`, clientId, syncStatus: 'pending', date: new Date().toISOString(),
      caseId: caseId.trim() || nextCaseId(historyRef.current),
      file: file?.name || analysisResult.filename, bodySite: bodySite || 'Not specified', notes,
      age: formatAgeEstimate(analysisResult),
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
    if (token !== (localStorage.getItem(KEY_SESSION) || '')) { saveInFlightRef.current = false; setIsSavingDb(false); return; }
    historyRevisionRef.current++;
    updateHistory(current => [record, ...current]);
    try {
      const saved = await sendHistoryRecord(record, token);
      savedToDatabase = true;
      if (token !== localStorage.getItem(KEY_SESSION)) return;
      historyRevisionRef.current++;
      updateHistory(current => current.map(row => row.id === record.id ? saved : row));
      setSaveToast('บันทึก MySQL สำเร็จ');
    } catch (error) {
      if (token !== (localStorage.getItem(KEY_SESSION) || '')) return;
      if (error instanceof HistoryAuthenticationError) { expireSession(token); return; }
      setHistoryError(cached
        ? [error instanceof Error ? error.message : 'ติดต่อ MySQL ไม่สำเร็จ', 'Saved locally. Open history to retry saving to the server.']
        : 'ยังบันทึกทั้ง MySQL และในเครื่องไม่สำเร็จ กรุณาอย่าปิดหน้านี้และลองบันทึกอีกครั้ง');
    } finally {
      if ((cached || savedToDatabase) && token === localStorage.getItem(KEY_SESSION)) {
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
    const token = localStorage.getItem(KEY_SESSION) || '';
    historyRevisionRef.current++;
    try {
      const saved = await sendHistoryRecord(record, token);
      if (token !== localStorage.getItem(KEY_SESSION)) return;
      historyRevisionRef.current++;
      updateHistory(current => current.map(row => row.id === record.id ? saved : row));
      setSelectedCase(current => current?.id === record.id ? saved : current);
    } catch (error) {
      if (error instanceof HistoryAuthenticationError) { expireSession(token); return; }
      if (token === (localStorage.getItem(KEY_SESSION) || '')) setHistoryError(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ รายการยังรอซิงก์');
    } finally { recordBusyRef.current = false; setBusyRecord(null); }
  }

  async function deleteHistoryItem(id: string) {
    const record = historyRef.current.find(row => row.id === id);
    if (!record || recordBusyRef.current || !confirm(t('ต้องการลบประวัติการวิเคราะห์รายการนี้หรือไม่?'))) return;
    recordBusyRef.current = true;
    setBusyRecord(id);
    setHistoryError(null);
    const token = localStorage.getItem(KEY_SESSION) || '';
    historyRevisionRef.current++;
    try {
      await deleteHistoryRecord(record, token);
      if (token !== (localStorage.getItem(KEY_SESSION) || '')) return;
      const next = historyRef.current.filter(row => row.id !== id);
      if (record.syncStatus === 'pending') await persistHistoryCache(profile.email, next);
      historyRevisionRef.current++;
      updateHistory(current => current.filter(row => row.id !== id));
      setSelectedCase(current => current?.id === id ? null : current);
    } catch (error) {
      if (error instanceof HistoryAuthenticationError) { expireSession(token); return; }
      if (token === (localStorage.getItem(KEY_SESSION) || '')) setHistoryError(error instanceof Error ? error.message : 'ลบไม่สำเร็จ รายการยังอยู่ในประวัติ');
    } finally { recordBusyRef.current = false; setBusyRecord(null); }
  }

  const filteredHistory = history.filter(item => {
    const q = searchHistory.toLowerCase();
    const matchQ = !q || [item.caseId, item.file, item.bodySite, item.notes || ''].join(' ').toLowerCase().includes(q);
    const matchAge = !filterAge || item.age === filterAge;
    return matchQ && matchAge;
  });

  const calibratedCount = history.filter(h => h.calibrated).length;
  const currentMonthCount = history.filter(h => {
    const d = new Date(h.date);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  if (isCheckingSession) {
    return <div role="status" style={{ padding: 40, textAlign: 'center' }}>{t("กำลังตรวจสอบการเข้าสู่ระบบ...")}</div>;
  }

  if (!isAuthenticated && (currentPage === 'login' || currentPage === 'register')) {
    return (
      <section className="login-view">
        <header className="auth-header">
          <button type="button" className="auth-brand" onClick={() => setCurrentPage('home')}><span className="brand-icon">BC</span><span>Bruise Color<br />Calibrate</span></button>
          <div className="auth-actions"><LanguageSwitcher /><button type="button" className="btn secondary" onClick={() => setCurrentPage('home')}><Icon name="home" />{t("Home")}</button></div>
        </header>

        <div className="login-panel">
          <div className="login-box" style={{ maxWidth: 460 }}>
            {/* Tabs for Sign In vs Register */}
            <div className="auth-tabs" role="group" aria-label={t("เลือกเข้าสู่ระบบหรือสมัครสมาชิก")}>
              <button
                className={`auth-tab ${authMode === 'signin' ? 'active' : ''}`}
                onClick={() => { setCurrentPage('login'); setLoginError(''); setAuthSuccessMsg(''); }}
               type="button" aria-pressed={authMode === "signin"}>{t("Sign In (เข้าสู่ระบบ)")}</button>
              <button
                className={`auth-tab ${authMode === 'register' ? 'active' : ''}`}
                onClick={() => { setCurrentPage('register'); setLoginError(''); setAuthSuccessMsg(''); }}
               type="button" aria-pressed={authMode === "register"}>{t("Register (สมัครสมาชิก)")}</button>
            </div>

            {authSuccessMsg && (
              <div style={{ background: '#e8f5e9', color: '#1b5e20', border: '1px solid #c8e6c9', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 16 }} role="status" aria-live="polite">
                <Icon name="check" /> {t(authSuccessMsg)}
              </div>
            )}

            {authMode === 'signin' ? (
              <>
                <h1 className="page-title" id="page-title-login" tabIndex={-1}>{t("Sign in")}</h1>
                <div className="sub">{t("เข้าสู่ระบบ Bruise Color Calibrate")}</div>
                <form onSubmit={handleLogin} aria-busy={isSubmittingAuth} aria-describedby={loginError ? "login-error" : undefined}>
                  <div style={{ marginBottom: 16 }}>
                    <label htmlFor="login-email">{t("Email")}</label>
                    <input
                      type="email"
                      className="input"
                      value={loginEmail}
                      onChange={e => setLoginEmail(e.target.value)}
                      required
                     id="login-email" name="login-email" autoComplete="username" />
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label htmlFor="login-password">{t("Password")}</label>
                    <PasswordInput
                      className="input"
                      value={loginPassword}
                      onChange={e => setLoginPassword(e.target.value)}
                      required
                     key="login-password" id="login-password" name="login-password" autoComplete="current-password" />
                  </div>
                  <button type="submit" className="btn primary" style={{ width: '100%' }} disabled={isSubmittingAuth}>
                    {isSubmittingAuth ? t("กำลังเข้าสู่ระบบ...") : t("Sign in")}
                  </button>
                </form>
                {loginError && (
                  <div style={{ color: 'var(--danger)', marginTop: 12, fontSize: 14, fontWeight: 600 }} role="alert" id="login-error">
                    {t(loginError)}
                  </div>
                )}
              </>
            ) : (
              <>
                <h1 className="page-title" id="page-title-register" tabIndex={-1}>{t("Create Account")}</h1>

                <form className="registration-form" onSubmit={handleRegister} aria-busy={isSubmittingAuth} aria-describedby={loginError ? "register-error" : undefined}>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="register-name">{t("ชื่อ - นามสกุล (Full Name)")}</label>
                    <input
                      className="input"
                      placeholder={t("เช่น นพ. ธนภัทร รุ่งเรือง")}
                      value={regName}
                      onChange={e => setRegName(e.target.value)}
                      required
                     id="register-name" name="register-name" autoComplete="name" />
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="register-email">{t("อีเมล (Gmail เท่านั้น)")}</label>
                    <input
                      type="email"
                      className="input"
                      placeholder="yourname@gmail.com"
                      value={regEmail}
                      onChange={e => setRegEmail(e.target.value)}
                      required
                     id="register-email" name="register-email" autoComplete="email"
                     aria-describedby="register-email-hint" pattern={"[^\\s@]+@[gG][mM][aA][iI][lL]\\.[cC][oO][mM]"} />
                    <p id="register-email-hint" className="registration-email-hint">{t("ใช้ที่อยู่อีเมลที่ลงท้ายด้วย @gmail.com เท่านั้น")}</p>
                  </div>
                  <div className="grid g2" style={{ gap: 10, marginBottom: 18 }}>
                    <div>
                      <label htmlFor="register-password">{t("รหัสผ่าน (Password)")}</label>
                      <PasswordInput
                        className="input"
                        placeholder={t("อย่างน้อย 15 ตัวอักษร")}
                        value={regPassword}
                        onChange={e => { e.currentTarget.setCustomValidity(''); setRegPassword(e.target.value); }}
                        pattern={"[\\x20-\\x7E]+"}
                        onInvalid={e => { if (e.currentTarget.validity.patternMismatch) e.currentTarget.setCustomValidity("Use only English letters (A-Z, a-z), numbers, symbols, and spaces."); }}
                        required
                       key="register-password" id="register-password" aria-describedby="register-password-policy" name="register-password" autoComplete="new-password" minLength={15} />
                    </div>
                    <div>
                      <label htmlFor="register-password-confirm">{t("ยืนยันรหัสผ่าน")}</label>
                      <PasswordInput
                        className="input"
                        placeholder={t("ยืนยันรหัสผ่านอีกครั้ง")}
                        value={regConfirmPassword}
                        onChange={e => { e.currentTarget.setCustomValidity(''); setRegConfirmPassword(e.target.value); }}
                        pattern={"[\\x20-\\x7E]+"}
                        onInvalid={e => { if (e.currentTarget.validity.patternMismatch) e.currentTarget.setCustomValidity("Use only English letters (A-Z, a-z), numbers, symbols, and spaces."); }}
                        required
                       key="register-password-confirm" id="register-password-confirm" aria-describedby="register-password-policy" name="register-password-confirm" autoComplete="new-password" minLength={15} />
                    </div>
                  </div>
                  <div className="password-policy">
                    <p className="password-policy-name">{t("Bruise Color Calibrate Password Policy")}</p>
                    <ul id="register-password-policy">
                      <li>{t("Use ")}<strong>{t("15-128 characters")}</strong>.</li>
                      <li>{t("Use only English letters (A-Z, a-z), numbers, symbols, and spaces.")}</li>
                      <li>{t("Uppercase letters, numbers, and symbols are not mandatory.")}</li>
                      <li>{t("Confirm your password exactly and use a unique password for this system.")}</li>
                      <li>{t("Passwords found in known data breaches are not accepted.")}</li>
                    </ul>
                  </div>
                  <button type="submit" className="btn teal" style={{ width: '100%' }} disabled={isSubmittingAuth}>
                    {isSubmittingAuth ? t("กำลังสร้างบัญชี...") : t("Register Account (MySQL)")}
                  </button>
                </form>
                {loginError && (
                  <div style={{ color: 'var(--danger)', marginTop: 12, fontSize: 14, fontWeight: 600 }} role="alert" id="register-error">
                    {t(loginError)}
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
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>{t("ข้ามไปเนื้อหา")}</a>
      <NavigationDrawer open={menuOpen} page={currentPage} authenticated={isAuthenticated} onClose={() => setMenuOpen(false)} onNavigate={setCurrentPage} />

      <div className="main">
        <header className={"topbar" + (!isAuthenticated ? " public-topbar" : "")}>
          <div className="topbar-start">
            <button type="button" id="navigation-toggle" className="btn secondary menu-toggle" aria-label={t("เปิดเมนูหลัก")} aria-haspopup="dialog"
              aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
            <div className="top-title">
              <span className="site-name">Bruise Color Calibrate</span>
              {currentPage === 'home' && t("Home")}
              {currentPage === 'dashboard' && t("Dashboard")}
              {currentPage === 'analysis' && t("New Analysis")}
              {currentPage === 'history' && t("Analysis History")}
              {currentPage === 'profile' && t("User Profile")}
            </div>
          </div>

          <div className="topbar-actions">
            <LanguageSwitcher />
            {isAuthenticated && <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 14,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 14,
                background: dbStatus === 'connected' ? 'rgba(46, 125, 50, 0.12)' : 'rgba(211, 47, 47, 0.12)',
                color: dbStatus === 'connected' ? '#2e7d32' : '#c62828',
                border: `1px solid ${dbStatus === 'connected' ? '#a5d6a7' : '#ef9a9a'}`
              }}
              title={dbStatus === 'connected' ? t("MySQL Database is online via Prisma") : t("MySQL Database is unreachable")}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: dbStatus === 'connected' ? '#2e7d32' : '#c62828'
                }}
              />
              {dbStatus === 'connected' ? t("MySQL (Prisma): Connected") : t("MySQL: Offline")}
            </div>}

            {isAuthenticated ? (<div className="userchip">
              <button type="button" className={"profile-trigger "+(currentPage === "profile" ? "active" : "")} onClick={() => setCurrentPage("profile")} aria-label={t("เปิดโปรไฟล์")} aria-pressed={currentPage === "profile"}><span className="profile-meta"><strong>{profile.name}</strong><span>{profile.email}</span></span><span className={"avatar "+(currentPage === "profile" ? "active" : "")} aria-hidden="true">{getInitials(profile.name)}</span></button>
              <button className="btn ghost" disabled={isLoggingOut} onClick={handleLogout} style={{ padding: '6px 12px', fontSize: 14 }} title={t("ออกจากระบบ")}>{t("Logout")}</button>
            </div>) : (
              <div className="guest-actions"><button type="button" className="btn secondary" onClick={() => setCurrentPage('login')}>{t("Sign In")}</button><button type="button" className="btn primary" onClick={() => setCurrentPage('register')}>{t("Register")}</button></div>
            )}
          </div>
        </header>

        <main className="page" id="main-content" tabIndex={-1}>
          {logoutError && <div className="callout warn" role="alert">{t(logoutError)}</div>}
          {historyError && <div className="callout warn" role="alert" style={{ marginBottom: 16 }}>{t(historyError)}</div>}
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
             role="status" aria-live="polite">
              <Icon name="check" /> {t(saveToast)}
            </div>
          )}
          {(!isAuthenticated || currentPage === 'home') && <Home authenticated={isAuthenticated} onNavigate={setCurrentPage} />}
          {isAuthenticated && <>
          {/* DASHBOARD PAGE */}
          <section style={{ display: isAuthenticated && currentPage === 'dashboard' ? 'block' : 'none' }}>
            <h1 className="page-title" id="page-title-dashboard" tabIndex={-1}>{t("Dashboard")}</h1>
            <div className="page-sub">{t("ภาพรวมการวิเคราะห์และการปรับเทียบสีรอยฟกช้ำ")}</div>

            <div className="grid g4">
              <div className="card kpi">
                <div className="t">{t("Total analyses")}</div>
                <div className="v">{isLoadingHistory && !history.length ? '?' : history.length}</div>
                <div className="small">{t("Records in your account")}</div>
              </div>
              <div className="card kpi">
                <div className="t">{t("Calibrated images")}</div>
                <div className="v">{isLoadingHistory && !history.length ? '?' : calibratedCount}</div>
                <div className="small">{t("with reference scale")}</div>
              </div>
              <div className="card kpi">
                <div className="t">{t("This month")}</div>
                <div className="v">{isLoadingHistory && !history.length ? '?' : currentMonthCount}</div>
                <div className="small">{t("new analyses logged")}</div>
              </div>
              <div className="card kpi">
                <div className="t">{t("Last assessment")}</div>
                <div className="v" style={{ fontSize: 20 }}>{t(AGE_UNAVAILABLE)}</div>
                <div className="small">{t("estimated day band")}</div>
              </div>
            </div>

            <div className="grid g2" style={{ marginTop: 20 }}>
              <div className="card">
                <div className="card-h">
                  <h2 className="section-title">{t("Recent analyses")}</h2>
                  <button className="btn secondary" onClick={() => setCurrentPage('history')} style={{ padding: '6px 12px', fontSize: 14 }}>{t("View all")}</button>
                </div>
                <div className="card-b">
                  {history.length === 0 ? (
                    <div className="empty-state"><p>{isLoadingHistory ? t("กำลังโหลดประวัติ...") : t("ยังไม่มีรายการวิเคราะห์ เริ่มจากเลือกภาพแรกของคุณ")}</p>{!isLoadingHistory && <button className="btn secondary" onClick={() => setCurrentPage('analysis')}>{t("เริ่มวิเคราะห์ภาพ")}</button>}</div>
                  ) : (
                    history.slice(0, 5).map(item => (
                      <button
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
                        title={t("คลิกเพื่อดูผลการตรวจละเอียด")}
                       type="button" className="recent-analysis" aria-label={t("ดูผลวิเคราะห์ ")+item.caseId}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt={item.caseId} className="tbl-thumb" style={{ width: 44, height: 44 }}  loading="lazy" decoding="async" />
                          ) : (
                            <div className="tbl-thumb-empty" style={{ width: 44, height: 44, fontSize: 14 }}><Icon name="image" /></div>
                          )}
                          <div>
                            <b style={{ color: 'var(--navy)' }}>{item.caseId}</b>
                            <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                              {item.file} • {t(item.bodySite)}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span className="badge info">{t(AGE_UNAVAILABLE)}</span>
                          <div style={{ fontSize: 14, color: 'var(--teal)', fontWeight: 600, marginTop: 4 }}>{t("Inspect ")}<Icon name="search" />
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-h">
                  <h2 className="section-title">{t("Clinical Workflow")}</h2>
                  <span className="badge ok">{t("Ready")}</span>
                </div>
                <div className="card-b">
                  <div className="callout">
                    <b>{t("1. Upload photo → 2. Auto detect card → 3. Calibrate → 4. Segment bruise → 5. Measure & Review")}</b>
                    <br />
                    <span style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4, display: 'block' }}>{t("การ์ดสเกลสีอ้างอิงในสภาพแสงเดียวกันจะช่วยปรับแก้ความคลาดสี (CCM) ทำให้การวัดค่าสีมีความน่าเชื่อถือและทำซ้ำได้")}</span>
                  </div>
                  <div style={{ marginTop: 20 }}>
                    <button className="btn primary" onClick={() => setCurrentPage('analysis')}>{t("Start new analysis")}</button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* NEW ANALYSIS PAGE */}
          <section style={{ display: isAuthenticated && currentPage === 'analysis' ? 'block' : 'none' }}>
            <h1 className="page-title" id="page-title-analysis" tabIndex={-1}>{t("New Analysis")}</h1>
            <div className="page-sub">{t("อัปโหลดภาพ ตรวจจับการ์ด ปรับเทียบสี และวิเคราะห์รอยฟกช้ำ")}</div>

            <div className="grid g2">
              {/* 1. Image acquisition */}
              <div className="card">
                <div className="card-h">
                  <h2 className="section-title">{t("1. Image acquisition")}</h2>
                  <span className={`badge ${file ? 'ok' : 'info'}`}>
                    {file ? t("Image loaded") : t("No image")}
                  </span>
                </div>
                <div className="card-b">
                  {!file ? (
                    <div
                      className={`upload-zone ${isDragOver ? 'drag' : ''}`}

                      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={e => {
                        e.preventDefault();
                        setIsDragOver(false);
                        const f = e.dataTransfer.files[0];
                        if (f) loadFile(f);
                      }}
                    >
                      <div className="upload-icon"><Icon name="upload" /></div>
                      <b style={{ fontSize: 17, color: 'var(--navy)' }}>{t("Drop clinical photo here or click to browse")}</b>
                      <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 8, maxWidth: 380 }}>{t("วางไฟล์ภาพรอยฟกช้ำที่มีการ์ดสเกลสีอ้างอิง (Color Reference Card) เพื่อเริ่มการปรับเทียบสีอัตโนมัติ")}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                        <span className="badge info">JPG / PNG / WebP</span>
                        <span className="badge info">HEIC / HEIF</span>
                        <span className="badge info">{t("Max 25MB")}</span>
                      </div>
                      <button
                        className="btn primary"
                        style={{ marginTop: 22, padding: '10px 22px', fontSize: 14 }}
                       type="button" onClick={() => document.getElementById("imageFileInput")?.click()}>{t("Select Image File")}</button>
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
                       className="file-summary">
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
                            <Icon name="image" />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {file.name}
                            </div>
                            <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 2 }}>
                              {(file.size / (1024 * 1024)).toFixed(2)}{t(" MB • โหลดภาพเรียบร้อย")}</div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} className="file-actions">
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ padding: '6px 12px', fontSize: 14 }}
                            onClick={() => document.getElementById('imageFileInput')?.click()}
                            title={t("เลือกภาพอื่นแทนภาพนี้")}
                          >{t("เปลี่ยนภาพ")}</button>
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ padding: '6px 12px', fontSize: 14, color: 'var(--danger)', borderColor: '#feb2b2' }}
                            onClick={removeImage}
                            title={t("ลบภาพนี้ออกเพื่ออัปโหลดใหม่")}
                          >
                            <Icon name="trash" />{t(" ลบภาพออก")}</button>
                        </div>
                      </div>

                      <div className="preview-wrap">
                      {previewStatus !== 'ready' && <p className="preview-message" role="status">{previewStatus === 'loading' ? t("กำลังโหลดภาพตัวอย่าง...") : t(previewMessage) || t("ยังไม่มีภาพตัวอย่าง")}</p>}

                        <canvas
                          ref={canvasRef}
                          id="imageCanvas"
                          onClick={handleCanvasClick}
                          style={{ display: previewStatus === "ready" ? "block" : "none" }}
                         tabIndex={0} role="button" aria-label={t("ตรวจค่าสี RGB ในภาพ")} aria-describedby="reference-pixel-help" onKeyDown={handleCanvasKeyDown}/>
                        {refPixel && (
                          <div className="ref-pill" role="status">{t("Reference pixel: ")}<b>RGB {refPixel.join(' / ')}</b>
                          </div>
                        )}
                      </div>

                                            <p id="reference-pixel-help" className="small" style={{ marginTop: 10 }}>{t("คลิกภาพหรือใช้ Tab โฟกัสภาพ แล้วกด Enter เพื่อตรวจค่า RGB ใช้ปุ่มลูกศรเลื่อนทีละพิกเซล หรือ Shift + ลูกศรเลื่อนทีละ 10 พิกเซล")}</p>
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
                  <h2 className="section-title">{t("2. Case parameters & notes")}</h2>
                  <span className={`badge ${analysisResult?.calibration.is_calibrated ? 'ok' : 'warn'}`}>
                    {analysisResult?.calibration.is_calibrated ? t("Calibrated") : t("Pending analysis")}
                  </span>
                </div>
                <div className="card-b">
                  <div style={{ marginBottom: 14 }}>
                    <label htmlFor="caseId">{t("Case / Subject ID")}</label>
                    <input
                      className="input"
                      id="caseId"
                      placeholder="Case001"
                      value={caseId}
                      onChange={e => { caseIdEditedRef.current = true; setCaseId(e.target.value); }}
                      disabled={isSavingDb}
                     name="caseId" autoComplete="off" />
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label htmlFor="body-site">{t("Body site")}</label>
                    <select
                      className="input"
                      value={bodySite}
                      onChange={e => setBodySite(e.target.value)}
                     id="body-site" name="body-site">
                      <option value="">{t("Select body site")}</option>
                      <option value="Arm">{t("Arm (แขน)")}</option>
                      <option value="Leg">{t("Leg (ขา)")}</option>
                      <option value="Torso">{t("Torso (ลำตัว/หน้าอก)")}</option>
                      <option value="Face">{t("Face (ใบหน้า)")}</option>
                      <option value="Other">{t("Other (อื่นๆ)")}</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: 18 }}>
                    <label htmlFor="analysis-notes">{t("Notes")}</label>
                    <input
                      className="input"
                      placeholder={t("Optional clinical / lighting notes")}
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                     id="analysis-notes" name="analysis-notes" autoComplete="off" />
                  </div>

                  <button
                    className="btn primary"
                    style={{ width: '100%', padding: '14px' }}
                    disabled={!file || isAnalyzing}
                    id="analysis-submit" onClick={runAnalysis}
                  >
                    {isAnalyzing ? t("Running pipeline analysis...") : t("Analyze Photo & Bruise")}
                  </button>

                  {isAnalyzing && <p role="status" className="small" style={{ marginTop: 12 }}>{t("กำลังวิเคราะห์ภาพ กรุณารอ คุณไม่ต้องอัปโหลดภาพซ้ำ")}</p>}
                  {analysisError && (
                    <div className="analysis-error" style={{ color: 'var(--danger)', marginTop: 12, fontSize: 14 }} role="alert" id="analysis-error">
                      <p className="analysis-error-message">{t(analysisError)}</p>
                    {file && <button type="button" className="btn secondary" onClick={runAnalysis} disabled={isAnalyzing}>{t("ลองวิเคราะห์อีกครั้ง")}</button>}
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
                      <h2 className="section-title">{t("Color Profile")}</h2>
                      <span className="badge ok">{t("Analysis complete")}</span>
                    </div>
                    <div className="card-b">
                      <div className="grid g2">
                        <div className="metric">
                          <div className="label">{t("Mean RGB")}</div>
                          <div className="value">{analysisResult.color_profile.mean_rgb.join(', ')}</div>
                        </div>
                        <div className="metric">
                          <div className="label">{t("Mean Lightness")}</div>
                          <div className="value">{analysisResult.color_profile.mean_lightness}%</div>
                        </div>
                      </div>

                      <div style={{ marginTop: 20 }}>
                        <h3 className="field-heading">{t("Dominant Colors (เทียบกับสเกล CIEDE2000)")}</h3>
                        <div className="palette" style={{ marginTop: 10 }}>
                          {analysisResult.color_profile.dominant_colors.map((c, i) => (
                            <div key={i} className="swatch">
                              <div className="swatch-color" style={{ background: c.hex }} />
                              <div className="swatch-txt">
                                <b>{c.hex}</b>
                                <br />
                                {t(c.name)}
                                <br />
                                {c.percent}{t("% sampled")}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Age estimation is not enabled yet. */}
                  <div className="card">
                    <div className="card-h"><h2 className="section-title">{t("Estimated Age Range")}</h2></div>
                    <div className="card-b">
                      <div className="value" style={{ color: 'var(--teal)', fontSize: 20, fontWeight: 700 }}>{t(AGE_UNAVAILABLE)}</div>
                    </div>
                  </div>
                </div>

                {/* Visual overlay */}
                <div style={{ marginTop: 20 }}>
                  {/* Visual Composite Overlays */}
                  <div className="card">
                    <div className="card-h">
                      <h2 className="section-title">{t("Visual Composite & Mask Overlay")}</h2>
                      <span className="small">{t("Green: Skin | Red: Bruise Mask")}</span>
                    </div>
                    <div className="card-b" style={{ textAlign: 'center' }}>
                      {analysisResult.previews?.overlay ? (
                        <img
                          src={analysisResult.previews.overlay}
                          alt="Wound and Skin Overlay"
                          style={{ maxWidth: '100%', maxHeight: 380, borderRadius: 8, border: '1px solid var(--line)' }}
                         loading="lazy" decoding="async" />
                      ) : analysisResult.previews?.calibrated ? (
                        <img
                          src={analysisResult.previews.calibrated}
                          alt="Calibrated Preview"
                          style={{ maxWidth: '100%', maxHeight: 380, borderRadius: 8, border: '1px solid var(--line)' }}
                         loading="lazy" decoding="async" />
                      ) : (
                        <div style={{ color: 'var(--muted)', padding: 40 }}>{t("ผลลัพธ์นี้ไม่มีภาพ Overlay ให้แสดง")}</div>
                      )}
                    </div>
                  </div>

                </div>

                <AnalysisDetails result={analysisResult} />

                <div className="result-actions">
                  <button className="btn secondary" onClick={clearAnalysisForm}>{t("Clear")}</button>
                  <button
                    className="btn primary"
                    onClick={saveAnalysisToHistory}
                    disabled={isSavingDb}
                  >
                    {isSavingDb ? t("Saving to MySQL...") : t("Save to Clinical History (MySQL)")}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* HISTORY PAGE */}
          <section style={{ display: isAuthenticated && currentPage === 'history' ? 'block' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <div>
                <h1 className="page-title" style={{ marginBottom: 4 }} id="page-title-history" tabIndex={-1}>{t("Analysis History")}</h1>
                <div className="page-sub" style={{ margin: 0 }}>{t("ประวัติการวิเคราะห์ส่วนบุคคล (บันทึกแยกเฉพาะบัญชี: ")}<b>{profile.email}</b>)
                </div>
              </div>
              <button
                className="btn secondary"
                onClick={() => refreshFromDatabase(profile.email)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14 }}
                title={t("ซิงค์ดึงประวัติล่าสุดของบัญชีคุณจาก MySQL (ระบบรีเฟรชอัตโนมัติทุก 20 วินาที)")}
              >
                <Icon name="refresh" />{t(" ซิงค์ข้อมูลบัญชีนี้ ")}<span style={{ fontSize: 14, color: 'var(--teal)', fontWeight: 600 }}>{t("(Auto 20s)")}</span>
              </button>
            </div>

            <div className="card">
              <div className="card-b">
                <div className="filters">
                  <input
                    className="input"
                    placeholder={t("Search case ID, file name, body site, notes...")}
                    value={searchHistory}
                    onChange={e => setSearchHistory(e.target.value)}
                   id="history-search" name="history-search" autoComplete="off" aria-label={t("ค้นหาประวัติ")} />
                  <select
                    className="input"
                    value={filterAge}
                    onChange={e => setFilterAge(e.target.value)}
                   id="history-age" name="history-age" aria-label={t("กรองช่วงวันตามสี")}>
                    <option value="">{t("All age ranges")}</option>
                    <option value="0–2 วัน">{t("0–2 วัน")}</option>
                    <option value="2–5 วัน">{t("2–5 วัน")}</option>
                    <option value="5–7 วัน">{t("5–7 วัน")}</option>
                    <option value="7–10 วัน">{t("7–10 วัน")}</option>
                    <option value="10–14 วัน">{t("10–14 วัน")}</option>
                  </select>
                </div>

                <p className="history-scroll-hint">{t("Scroll across the table to see all details.")}</p>
                <div className="tbl-wrap" role="region" aria-label={t("ประวัติการวิเคราะห์")} tabIndex={0}>
                  <table className="tbl history-table">
                    <thead>
                      <tr>
                        <th scope="col">{t("Preview")}</th>
                        <th scope="col">{t("Case ID")}</th>
                        <th scope="col">{t("Date")}</th>
                        <th scope="col">{t("Body Site")}</th>
                        <th scope="col">{t("Dominant Colors")}</th>
                        <th scope="col">{t("Estimated Age")}</th>
                        <th scope="col">{t("Calibration")}</th>
                        <th scope="col">{t("Save status")}</th>
                        <th scope="col">{t("Action")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.length === 0 ? (
                        <tr>
                          <td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>
{isLoadingHistory ? t("กำลังโหลดประวัติ...") : history.length ? t("ไม่พบรายการที่ตรงกับตัวกรอง") : t("ยังไม่มีประวัติการวิเคราะห์")}
                            {!isLoadingHistory && <div style={{ marginTop: 12 }}>{history.length ? <button className="btn secondary" onClick={() => { setSearchHistory(''); setFilterAge(''); }}>{t("ล้างตัวกรอง")}</button> : <button className="btn primary" onClick={() => setCurrentPage('analysis')}>{t("เริ่มวิเคราะห์ภาพ")}</button>}</div>}
                          </td>
                        </tr>
                      ) : (
                        filteredHistory.map(row => (
                          <tr key={row.id}>
                            <td><button type="button" className="thumbnail-trigger" onClick={() => setSelectedCase(row)} aria-label={t("ดูภาพและรายงาน ")+row.caseId}>{row.thumbnail ? <img src={row.thumbnail} alt={t("ภาพตัวอย่าง ")+row.caseId} className="tbl-thumb" width={52} height={52} loading="lazy" decoding="async" /> : <span className="tbl-thumb-empty"><Icon name="image" /></span>}</button></td>
                            <td>
                              <button
                                onClick={() => setSelectedCase(row)}
                                style={{ cursor: 'pointer', color: 'var(--navy)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
                                title={t("คลิกเพื่อเปิดรายงานเคส")}
                               type="button" className="case-link">
                                <span>{row.caseId}</span>
                                <span style={{ fontSize: 14, color: 'var(--teal)' }}><Icon name="search" /></span>
                              </button>
                              <div style={{ fontSize: 14, color: 'var(--muted)' }}>{row.file}</div>
                            </td>
                            <td>{new Date(row.date).toLocaleString(getLocale())}</td>
                            <td><b>{t(row.bodySite)}</b></td>
                            <td>
                              {row.colors.map((c, i) => (
                                <span key={i} className="color-dot" style={{ background: c }} title={c} />
                              ))}
                            </td>
                            <td><span className="badge info">{t(AGE_UNAVAILABLE)}</span></td>
                            <td>
                              {row.calibrated ? (
                                <span className="badge ok">{t("Calibrated")}</span>
                              ) : (
                                <span className="badge warn">{row.resultJson?.calibration?.is_calibrated === false ? t("Raw") : t("Unknown")}</span>
                              )}
                            </td>
                            <td><span className={`badge ${row.syncStatus === 'pending' ? 'warn' : 'ok'}`}>{row.syncStatus === 'pending' ? t("Pending sync") : 'MySQL'}</span></td>
                            <td>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {row.syncStatus === 'pending' && <button className="btn teal" disabled={busyRecord !== null} onClick={() => syncPendingRecord(row)}>{busyRecord === row.id ? t("Saving...") : t("Save to MySQL")}</button>}
                                <button
                                  className="btn teal"
                                  onClick={() => setSelectedCase(row)}
                                  style={{ padding: '5px 12px', fontSize: 14 }}
                                  title={t("View full clinical case details")}
                                >{t("View Detail")}</button>
                                <button
                                  className="btn secondary"
                                  onClick={() => deleteHistoryItem(row.id)}
                                  disabled={busyRecord !== null}
                                  style={{ padding: '5px 10px', fontSize: 14, color: 'var(--danger)' }}
                                  title={t("Delete record from MySQL")}
                                >{t("Delete")}</button>
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
          <section style={{ display: isAuthenticated && currentPage === 'profile' ? 'block' : 'none' }}>
            <h1 className="page-title" id="page-title-profile" tabIndex={-1}>{t("Profile")}</h1>
            <div className="page-sub">{t("ข้อมูลบัญชีผู้ใช้งานทางคลินิก (Clinical Research Account)")}</div>

            <div className="card">
              <div className="card-b profile-grid">
                <div>
                  <div className="profile-photo">{getInitials(profile.name)}</div>
                  <div style={{ marginTop: 12, textAlign: 'center', fontSize: 14, color: 'var(--muted)' }}>{t("Forensic & Clinical Researcher")}</div>
                </div>

                <div>
                  <form onSubmit={handleSaveProfile} aria-busy={isSavingProfile}>
                    <div className="grid g2">
                      <div>
                        <label htmlFor="profile-name">{t("Full name (ชื่อ-นามสกุล)")}</label>
                        <input
                          className="input"
                          value={profile.name}
                          onChange={e => { setProfile({ ...profile, name: e.target.value }); setProfileFeedback(null); }}
                          required
                          placeholder={t("ชื่อ-นามสกุลของคุณ")}
                         id="profile-name" aria-describedby={profileFeedback ? "profile-feedback" : undefined} name="profile-name" autoComplete="name" />
                      </div>
                      <div>
                        <label htmlFor="profile-email">{t("Email Account (LOCK)")}</label>
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
                         id="profile-email" name="profile-email" autoComplete="email" />
                        <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
                          <Icon name="lock" />{t(" อีเมลนี้ใช้เป็นรหัสระบุตัวตนและแยกข้อมูลเคสคนไข้ใน MySQL ไม่สามารถแก้ไขได้")}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 24 }}>
                      <button type="submit" className="btn primary" disabled={isSavingProfile}>{t("Save Changes (บันทึกชื่อผู้ใช้)")}</button>
                    </div>
                      {profileFeedback && <p id="profile-feedback" className={"form-feedback " + profileFeedback.kind} role={profileFeedback.kind === 'error' ? 'alert' : 'status'}>{t(profileFeedback.message)}</p>}
                  </form>
                </div>
              </div>
            </div>
          </section>
          </>}
        </main>
      </div>

      {/* CLINICAL CASE INSPECTION MODAL */}
      {selectedCase && (
        <div className="modal-backdrop" onClick={() => setSelectedCase(null)}>
          <div className="modal-dialog case-report" role="dialog" aria-modal="true"  onClick={e => e.stopPropagation()} ref={reportRef} tabIndex={-1} aria-labelledby="case-report-title" aria-describedby="case-report-meta">
            <div className="modal-header">
              <div>
                <div className="report-heading">
                  <h2 style={{ fontSize: 20, color: 'var(--navy)' }} id="case-report-title">{selectedCase.caseId}</h2>
                  <span className={`badge ${selectedCase.calibrated ? 'ok' : 'warn'}`}>
                    {selectedCase.calibrated ? t("Calibrated") : selectedCase.resultJson?.calibration?.is_calibrated === false ? t("Raw / Uncalibrated") : t("Calibration unavailable")}
                  </span>
                  <span className="badge info">{t(AGE_UNAVAILABLE)}</span>
                </div>
                <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }} id="case-report-meta">{t("บันทึกเมื่อ: ")}{new Date(selectedCase.date).toLocaleString(getLocale())}{t(" • ตำแหน่งร่างกาย: ")}<b>{t(selectedCase.bodySite)}</b>{t(" • ไฟล์: ")}{selectedCase.file}
                </div>
              </div>
              <div className="report-actions">
                <LanguageSwitcher />
              <button
                  className="btn secondary"
                  style={{ padding: '6px 12px', fontSize: 14 }}
                  onClick={() => window.print()}
                  title={t("Print clinical assessment report")}
                >
                  <Icon name="print" />{t(" Print Report")}</button>
                <button
                  className="btn ghost"
                  style={{ padding: '6px 10px', fontSize: 16 }}
                  onClick={() => setSelectedCase(null)}
                 aria-label={t("ปิดรายงาน")} data-close-report>
                  <Icon name="close" />
                </button>
              </div>
            </div>

            <div className="modal-body">
              {isLegacyDemo(selectedCase.resultJson) && <div className="callout warn" role="status">{t("รายการนี้บันทึกจากโหมดตัวอย่างในเบราว์เซอร์ ค่าขนาดและช่วงวันไม่ใช่ผลวิเคราะห์จาก backend กรุณาวิเคราะห์ภาพต้นฉบับใหม่")}</div>}

              {/* Image Previews Grid */}
              <div className="case-preview-grid">
                <div className="case-preview-card">
                  <div className="img-wrap">
                    {selectedCase.resultJson?.previews?.original ? (
                      <img src={selectedCase.resultJson.previews.original} alt="Original Image"  loading="lazy" decoding="async" />
                    ) : selectedCase.thumbnail ? (
                      <img src={selectedCase.thumbnail} alt="Thumbnail Preview"  loading="lazy" decoding="async" />
                    ) : (
                      <div style={{ color: '#99adc2', fontSize: 14 }}>{t("No preview image")}</div>
                    )}
                  </div>
                  <div className="caption">{t("1. ภาพถ่ายต้นฉบับ (Original)")}</div>
                </div>

                <div className="case-preview-card">
                  <div className="img-wrap">
                    {selectedCase.resultJson?.previews?.calibrated ? (
                      <img src={selectedCase.resultJson.previews.calibrated} alt="Calibrated Image"  loading="lazy" decoding="async" />
                    ) : (
                      <div style={{ color: '#99adc2', fontSize: 14 }}>{t("ไม่มีภาพ Calibrate แยกต่างหาก")}</div>
                    )}
                  </div>
                  <div className="caption">{t("2. ภาพปรับเทียบสีแล้ว (CCM Calibrated)")}</div>
                </div>

                <div className="case-preview-card">
                  <div className="img-wrap">
                    {selectedCase.resultJson?.previews?.overlay ? (
                      <img src={selectedCase.resultJson.previews.overlay} alt="Overlay & Mask"  loading="lazy" decoding="async" />
                    ) : selectedCase.thumbnail ? (
                      <img src={selectedCase.thumbnail} alt="Overlay Preview"  loading="lazy" decoding="async" />
                    ) : (
                      <div style={{ color: '#99adc2', fontSize: 14 }}>{t("ไม่มีภาพ Overlay")}</div>
                    )}
                  </div>
                  <div className="caption">{t("3. รอยแผลที่ตีกรอบ Mask (Overlay)")}</div>
                </div>
              </div>

              {/* Assessment Summary KPI Grid */}
              <div className="grid g3" style={{ marginBottom: 20 }}>
                <div className="card kpi">
                  <div className="t">{t("Estimated Age Range")}</div>
                  <div className="v" style={{ fontSize: 20 }}>{t(AGE_UNAVAILABLE)}</div>
                </div>
                <div className="card kpi">
                  <div className="t">{t("LOOCV Median ΔE00")}</div>
                  <div className="v" style={{ fontSize: 20 }}>
                    {selectedCase.resultJson?.calibration?.loocv_median_de00 != null
                      ? selectedCase.resultJson.calibration.loocv_median_de00.toFixed(2)
                      : selectedCase.deltaE00 != null ? selectedCase.deltaE00.toFixed(2) : '—'}
                  </div>
                  <div className="small">{t("ColorChecker Calibration Error")}</div>
                </div>
                <div className="card kpi">
                  <div className="t">{t("Wound Area (ขนาดแผล)")}</div>
                  <div className="v" style={{ fontSize: 20 }}>
                    {selectedCase.resultJson?.wound_size?.area_cm2 != null
                      ? `${selectedCase.resultJson.wound_size.area_cm2} cm²`
                      : '—'}
                  </div>
                  <div className="small">
                    {selectedCase.resultJson?.wound_size?.width_cm != null && selectedCase.resultJson?.wound_size?.length_cm != null
                      ? `${selectedCase.resultJson.wound_size.width_cm} × ${selectedCase.resultJson.wound_size.length_cm} cm`
                      : t("Approximate area")}
                  </div>
                </div>
              </div>

              {/* Dominant Colors & Clinical reasoning */}
              <div className="grid g2" style={{ marginBottom: 20 }}>
                <div className="card">
                  <div className="card-h">
                    <h2 className="section-title">{t("Dominant Color Profile (กลุ่มสีเด่น)")}</h2>
                    <span className="small">{t("Extracted Clusters")}</span>
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
                            <div style={{ fontSize: 14, fontWeight: 700 }}>{t(col.name)}</div>
                            <div style={{ fontSize: 14, color: 'var(--muted)' }}>
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
                    <h2 className="section-title">{t("Clinical Reasoning & Notes")}</h2>

                  </div>
                  <div className="card-b">
                    <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                      <b>{t("Estimated Age:")}</b>
                      <p style={{ color: '#4a5568', marginTop: 4 }}>
                        {t(AGE_UNAVAILABLE)}
                      </p>
                      {selectedCase.notes && (
                        <div style={{ marginTop: 10 }}>
                          <b>{t("Clinician Notes:")}</b>
                          <p style={{ color: '#4a5568', marginTop: 2 }}>{selectedCase.notes}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {selectedCase.resultJson ? (
                <AnalysisDetails result={selectedCase.resultJson} />
              ) : <div className="callout" role="status">{t("This older record has no saved colour or histogram details. Analyse the original photo again to create a complete record.")}</div>}

              {/* Calibration Card Patches Table if present */}
              {selectedCase.resultJson?.calibration?.table && selectedCase.resultJson.calibration.table.length > 0 && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <div className="card-h">
                    <h2 className="section-title">{t("ColorChecker Scale Calibration Metrics (ΔE00)")}</h2>
                    <span className="small">{t("Leave-One-Out Cross-Validation (LOOCV)")}</span>
                  </div>
                  <div className="card-b">
                    <div className="tbl-wrap" style={{ maxHeight: 240, overflowY: 'auto' }} role="region" aria-label={t("รายละเอียดการปรับเทียบสี")} tabIndex={0}>
                      <table className="tbl calibration-table" style={{ fontSize: 14 }}>
                        <thead>
                          <tr>
                            <th scope="col">{t("Type")}</th>
                            <th scope="col">{t("Patch Name")}</th>
                            <th scope="col">{t("RGB Captured")}</th>
                            <th scope="col">{t("RGB Corrected")}</th>
                            <th scope="col">{t("RGB Reference")}</th>
                            <th scope="col">{t("ΔE00 Before")}</th>
                            <th scope="col">{t("ΔE00 After")}</th>
                            <th scope="col">{t("LOOCV ΔE00")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCase.resultJson.calibration.table.map((row, i) => (
                            <tr key={i}>
                              <td><b>{t(row.kind)}</b></td>
                              <td>{t(row.name)}</td>
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
              <div className="callout warn" style={{ fontSize: 14 }}>
                <b><Icon name="alert" />{t(" คำเตือนทางการแพทย์และนิติเวช (Clinical & Forensic Disclaimer):")}</b>
                <br />{t("ระบบยังไม่สามารถระบุอายุรอยฟกช้ำได้ ผลสีและขนาดเป็นข้อมูลต้นแบบที่ต้องตรวจสอบร่วมกับภาพต้นฉบับ")}</div>
            </div>

            <div className="modal-footer">
              <button
                className="btn secondary"
                onClick={() => window.print()}
              >
                <Icon name="print" />{t(" Print / Export PDF")}</button>
              <button
                className="btn primary"
                onClick={() => setSelectedCase(null)}
              >{t("Close (ปิด)")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
