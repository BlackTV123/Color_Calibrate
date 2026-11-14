import { t, useLanguage } from './i18n';
import { useEffect, useRef } from 'react';
import Icon from './Icon';
import type { Page } from './navigation';

const items: { page: Page; label: string }[] = [
  { page: 'home', label: 'Home' },
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'analysis', label: 'New Analysis' },
  { page: 'history', label: 'Analysis History' },
];

export default function NavigationDrawer({ open, page, authenticated, onClose, onNavigate }: {
  open: boolean; page: Page; authenticated: boolean; onClose: () => void; onNavigate: (page: Page) => void;
}) {
  useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; };
  }, [open]);

  return (
    <dialog ref={ref} id="primary-navigation" className="navigation-drawer" aria-labelledby="navigation-title"
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.disabled);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClose={event => { if (!event.currentTarget.open) onClose(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <div className="drawer-heading">
        <div className="sidebrand">
          <span className="brand-icon" aria-hidden="true">BC</span>
          <span id="navigation-title">Bruise Color<br /><span className="brand-subtitle">Calibrate</span></span>
        </div>
        <button type="button" className="drawer-close" onClick={onClose} aria-label={t("ปิดเมนู")}><Icon name="close" /></button>
      </div>
      <nav className="navitems" aria-label={t("เมนูหลัก")}>
        {items.map(item => (
          <button key={item.page} data-page={item.page} type="button" className={'navitem ' + (page === item.page ? 'active' : '')}
            aria-current={page === item.page ? 'page' : undefined} onClick={() => onNavigate(item.page)}>
            <span className="navdot" aria-hidden="true" />{t(item.label)}
          </button>
        ))}
      </nav>
      {!authenticated && <p className="drawer-auth-note">{t("เข้าสู่ระบบเพื่อวิเคราะห์ภาพและดูประวัติส่วนตัว")}</p>}
      <div className="sidefoot"><b>{t("Prototype v0.1")}</b><p>{t("For research and clinical workflow demonstration only.")}</p></div>
    </dialog>
  );
}
