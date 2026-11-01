import { useSyncExternalStore } from 'react';
import messages from './locales/messages.json';

export type Language = 'th' | 'en';
export const LANGUAGE_KEY = 'bcc_language_v1';
type Message = { th: string; en: string };
const catalog: Record<string, Message> = messages;
const index = new Map<string, Message>();
for (const [source, message] of Object.entries(catalog)) index.set(source.trim(), message);
for (const message of Object.values(catalog)) {
  if (!index.has(message.th.trim())) index.set(message.th.trim(), message);
  if (!index.has(message.en.trim())) index.set(message.en.trim(), message);
}
function readPreference(): Language {
  try { return localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'th'; }
  catch { return 'th'; }
}
let language: Language = readPreference();
const listeners = new Set<() => void>();
function applyLanguage() {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
  listeners.forEach(listener => listener());
}
export function setLanguage(value: Language) {
  if (value !== 'th' && value !== 'en') return;
  language = value;
  try { localStorage.setItem(LANGUAGE_KEY, value); } catch { /* Keep the choice for this tab. */ }
  applyLanguage();
}
if (typeof window !== 'undefined') {
  applyLanguage();
  window.addEventListener('storage', event => {
    if (event.key !== LANGUAGE_KEY && event.key !== null) return;
    language = readPreference();
    applyLanguage();
  });
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useLanguage() {
  const current = useSyncExternalStore(subscribe, () => language, () => language);
  return { language: current, setLanguage };
}
export function getLocale() { return language === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB'; }

/** Translate interface text only. User names, case IDs, notes and file names must not pass through this function. */
export function t(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(t).join(' ');
  const text = String(value);
  const clean = text.trim();
  const message = index.get(clean);
  if (message) return text.slice(0, text.length-text.trimStart().length) + message[language].trim() + text.slice(text.trimEnd().length);
  const patch = /^(?:สีเนื้อช่อง|Skin patch)\s*(\d+)$/i.exec(clean);
  if (patch) return language === 'th' ? 'สีเนื้อช่อง ' + patch[1] : 'Skin patch ' + patch[1];
  const match = /^ไม่ตรงสเกล \(ใกล้ (.+)\)$/.exec(clean);
  if (match) return language === 'th' ? clean : 'No reference match (closest: ' + t(match[1]) + ')';
  return text;
}
