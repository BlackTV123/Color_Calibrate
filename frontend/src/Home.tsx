import { lazy, Suspense } from 'react';
import Icon from './Icon';
import type { Page } from './navigation';

const CaptureIllustration = lazy(() => import('./CaptureIllustration'));

export default function Home({ authenticated, onNavigate }: { authenticated: boolean; onNavigate: (page: Page) => void }) {
  return (
    <div className="home-content">
      <section className="home-hero" aria-labelledby="page-title-home">
        <div className="hero-copy">
          <h1 className="page-title hero-title" id="page-title-home" tabIndex={-1}>ปรับเทียบสีภาพ<br /><span>ก่อนอ่านผลรอยฟกช้ำ</span></h1>
          <p className="hero-description">พื้นที่ทำงานสำหรับภาพรอยฟกช้ำที่มีสเกลอ้างอิง เปรียบเทียบสีก่อนและหลังปรับเทียบ ตรวจผล และเก็บประวัติไว้ในบัญชีของคุณ</p>
          <div className="hero-actions">
            <button type="button" className="btn primary" onClick={() => onNavigate(authenticated ? 'analysis' : 'login')}>
              {authenticated ? 'เริ่มวิเคราะห์ภาพ' : 'เข้าสู่ระบบเพื่อเริ่มใช้งาน'}<Icon name="arrow-right" />
            </button>
            <button type="button" className="btn secondary" onClick={() => onNavigate(authenticated ? 'history' : 'register')}>
              {authenticated ? 'ดูประวัติการวิเคราะห์' : 'สร้างบัญชี'}
            </button>
          </div>
          <p className="hero-note">ต้นแบบสำหรับงานวิจัย ผลประเมินช่วงวันเป็นเกณฑ์สีทดลองและต้องตรวจสอบโดยผู้ใช้</p>
        </div>
        <Suspense fallback={<div className="capture-loading" role="status">กำลังโหลดภาพประกอบ...</div>}>
          <CaptureIllustration />
        </Suspense>
      </section>
      <section className="home-details" aria-labelledby="home-details-title">
        <h2 id="home-details-title">สิ่งที่ดูได้จากภาพหนึ่งใบ</h2>
        <div className="home-detail-columns">
          <div><h3>สีที่ตรวจพบ</h3><p>แยกสีผิวและสีรอยแผล พร้อมค่า RGB, HEX และ ΔE00 เทียบสเกล</p></div>
          <div><h3>ขนาดโดยประมาณ</h3><p>แสดงความกว้าง ความยาว และพื้นที่ โดยภาพแผลและการ์ดต้องอยู่ระนาบใกล้กัน</p></div>
          <div><h3>ประวัติส่วนตัว</h3><p>บันทึกผลตาม Case ID ค้นหารายการเดิม และเปิดรายงานของบัญชีคุณ</p></div>
        </div>
      </section>
      <footer className="home-footer"><span>Bruise Color Calibrate</span><span>Research prototype · ตรวจภาพ Overlay และผลวิเคราะห์ก่อนนำไปใช้</span></footer>
    </div>
  );
}
