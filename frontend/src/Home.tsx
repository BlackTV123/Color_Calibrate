import { t, useLanguage } from './i18n';
import { lazy, Suspense } from 'react';
import Icon from './Icon';
import type { Page } from './navigation';

const CaptureIllustration = lazy(() => import('./CaptureIllustration'));

export default function Home({ authenticated, onNavigate }: { authenticated: boolean; onNavigate: (page: Page) => void }) {
  useLanguage();
  return (
    <div className="home-content">
      <section className="home-hero" aria-labelledby="page-title-home">
        <div className="hero-copy">
          <h1 className="page-title hero-title" id="page-title-home" tabIndex={-1}>{t("ปรับเทียบสีภาพ")}<br /><span>{t("ก่อนอ่านผลรอยฟกช้ำ")}</span></h1>
          <p className="hero-description">{t("พื้นที่ทำงานสำหรับภาพรอยฟกช้ำที่มีสเกลอ้างอิง เปรียบเทียบสีก่อนและหลังปรับเทียบ ตรวจผล และเก็บประวัติไว้ในบัญชีของคุณ")}</p>
          <div className="hero-actions">
            <button type="button" className="btn primary" onClick={() => onNavigate(authenticated ? 'analysis' : 'login')}>
              {authenticated ? t("เริ่มวิเคราะห์ภาพ") : t("เข้าสู่ระบบเพื่อเริ่มใช้งาน")}<Icon name="arrow-right" />
            </button>
            <button type="button" className="btn secondary" onClick={() => onNavigate(authenticated ? 'history' : 'register')}>
              {authenticated ? t("ดูประวัติการวิเคราะห์") : t("สร้างบัญชี")}
            </button>
          </div>
          <p className="hero-note">{t("ต้นแบบสำหรับงานวิจัย ยังไม่สามารถระบุอายุรอยฟกช้ำได้")}</p>
        </div>
        <Suspense fallback={<div className="capture-loading" role="status">{t("กำลังโหลดภาพประกอบ...")}</div>}>
          <CaptureIllustration />
        </Suspense>
      </section>
      <section className="home-details" aria-labelledby="home-details-title">
        <h2 id="home-details-title">{t("สิ่งที่ดูได้จากภาพหนึ่งใบ")}</h2>
        <div className="home-detail-columns">
          <div><h3>{t("สีที่ตรวจพบ")}</h3><p>{t("แยกสีผิวและสีรอยแผล พร้อมค่า RGB, HEX และ ΔE00 เทียบสเกล")}</p></div>
          <div><h3>{t("ขนาดโดยประมาณ")}</h3><p>{t("แสดงความกว้าง ความยาว และพื้นที่ โดยภาพแผลและการ์ดต้องอยู่ระนาบใกล้กัน")}</p></div>
          <div><h3>{t("ประวัติส่วนตัว")}</h3><p>{t("บันทึกผลตาม Case ID ค้นหารายการเดิม และเปิดรายงานของบัญชีคุณ")}</p></div>
        </div>
      </section>
      <footer className="home-footer"><span>Bruise Color Calibrate</span><span>{t("Research prototype · ตรวจภาพ Overlay และผลวิเคราะห์ก่อนนำไปใช้")}</span></footer>
    </div>
  );
}
