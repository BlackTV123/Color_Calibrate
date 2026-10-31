# UI audit — UIdesignVersion2

วันที่ตรวจ: 31 ตุลาคม 2026

ตรวจด้วย Impeccable audit แล้วแก้เป็นส่วน ๆ โดยรักษาสี navy/teal และโครงสร้างเดิม งานนี้ไม่ได้เพิ่มโมเดลทำนายวันหรือเปลี่ยนสูตรวิเคราะห์ของ backend

## ผลตรวจและสิ่งที่แก้

| ส่วน | ปัญหาที่พบ | สิ่งที่แก้ |
|---|---|---|
| Sign in / Register | ช่องกรอกไม่มี label เชื่อม และใช้ div สลับโหมด | เชื่อม label, autocomplete, ใช้ native buttons และประกาศข้อผิดพลาดให้เทคโนโลยีช่วยเหลืออ่านได้ |
| เมนู / Header / Dashboard | ใช้คีย์บอร์ดได้ไม่ครบและล้นจอมือถือ | ใช้ปุ่มจริง, aria-current, skip link, จัด focus หลังเปลี่ยนหน้า และปรับ header/รายการล่าสุดตามขนาดจอ |
| New Analysis | เมื่อ backend ล้มเหลว เว็บสร้างค่าตัวอย่างแผลและช่วงวันแทนผลจริง | นำ fallback ออก แสดงข้อผิดพลาดพร้อม retry โดยเก็บภาพไว้ พร้อมยกเลิก request เก่าและกำหนด timeout |
| อัปโหลด / RGB | ขาดการตรวจไฟล์และเลือกพิกเซลได้เฉพาะเมาส์ | ตรวจไฟล์ว่าง ขนาดเกิน 25 MB และชนิดไม่รองรับ ใช้ object URL พร้อมคืนทรัพยากร ป้องกัน preview เก่า และรองรับลูกศร/Enter/Space |
| ผลสี / ขนาด / Histogram | หัวข้อ ตาราง และตัวอักษรเล็กไม่สม่ำเสมอ | ปรับ semantic headings, scope ของตาราง, พื้นที่เลื่อนตาราง, ขนาดข้อความ และ surface tokens |
| History | สถานะกำลังโหลดและผลค้นหาว่างไม่ชัดเจน | แยก loading / ไม่มีประวัติ / ไม่พบผลค้นหา เพิ่มปุ่มล้างตัวกรอง และหยุด polling เมื่อแท็บไม่แสดง |
| รายงาน / Print | ไม่มี focus trap, Escape หรือการคืน focus | ตั้ง focus ใน dialog, ใช้ inert กับพื้นหลัง, วน Tab ในรายงาน, Escape ปิดและคืน focus พร้อมปรับ header/footer บนมือถือ |
| Profile | API บันทึกผิดพลาดแต่ยังแจ้งสำเร็จ | แจ้งสำเร็จเมื่อ API สำเร็จจริง พร้อมสถานะกำลังบันทึกและข้อผิดพลาดแบบ inline |
| คำอธิบายช่วงวัน | แผลที่ยังไม่มีช่วงวันถูกแสดงเป็น No bruise | แยก “ยังประเมินช่วงวันไม่ได้” จาก “ไม่พบรอยสีแผล” คงช่วงวันที่ backend ส่งมา และระบุว่าใช้เกณฑ์สีทดลอง |

ข้อมูล demo เก่าที่สร้างจาก fallback เดิมไม่ได้ถูกลบ แต่มีคำเตือนแหล่งที่มาเมื่อเปิดรายงาน ไม่ควรนำไปใช้เป็นผลวิเคราะห์จริง

## ลำดับความสำคัญ

- **P0 / integrity:** สร้างผลตัวอย่างแทนผลจริงเมื่อ backend ล้มเหลว — แก้แล้ว พร้อมทดสอบว่า failure ไม่สร้างกราฟหรือผลวิเคราะห์
- **P1:** หน้าเว็บล้นจอมือถือ, form labels, native navigation และ dialog keyboard/focus — แก้แล้ว
- **P1:** Profile แจ้งสำเร็จแม้บันทึกไม่สำเร็จ — แก้แล้วและทดสอบ API ทั้ง failure/success
- **P2:** ตรวจไฟล์, preview/request เก่า, loading/empty/error states และคำอธิบาย No bruise ที่ไม่ตรงข้อมูล — แก้แล้ว
- **P2:** focus/control styles, ข้อความรอง, reduced motion และไอคอน — ปรับแล้ว โดยยังไม่ใช่การรับรอง WCAG

ใช้แนวทาง harden/adapt/clarify/polish ให้เหมาะกับแต่ละปัญหา

## หลักฐานการตรวจ

ก่อนแก้ ที่ viewport 390px พบ document width ดังนี้:

| หน้า | ก่อนแก้ | หลังแก้ |
|---|---:|---:|
| Dashboard | 485px | 390px |
| Analysis | 465px | 390px |
| History | 465px | 390px |
| Report | 465px | 390px |
| Profile | 444px | 390px |

หลังแก้ไม่มี overflow ของทั้งหน้าในชุดภาพตรวจ ตารางเลื่อนภายในพื้นที่ของตัวเองได้

ก่อนแก้พบช่องกรอกไม่มีชื่อเชื่อมใน Login 2 ช่อง, Register 4 ช่อง, Analysis 3 ช่อง, History 3 ช่อง และ Profile 2 ช่อง หลังแก้ตัวตรวจ visible controls ไม่พบช่องลักษณะดังกล่าว

ตรวจด้วย **Edge Chromium headless และ API จำลอง** แยกจากฐานข้อมูลจริง:

- `npm test`: ผ่าน 15 tests ครอบคลุม UTF-8/ข้อมูลสี ประวัติแยกบัญชี การบันทึก/ลบ การตรวจไฟล์ และความหมายของข้อความช่วงวัน
- `npm run test:browser`: ผ่าน รวม IndexedDB, session expiry/relogin, รายงาน, Histogram 6 กราฟ, print และ delete failure/success
- Browser regression เพิ่ม: Dashboard/Analysis/History/Profile ที่ 320, 390, 768, 1024 และ 1440px ไม่มี document overflow และช่องกรอกมีชื่อ
- Tab อยู่ภายในรายงาน, Escape ปิด, คืน focus และกันพื้นหลังด้วย inert — ผ่าน
- ไฟล์ไม่รองรับ, keyboard RGB inspection, analysis failure/retry และ profile failure/success — ผ่าน
- `npm run build`: ผ่าน TypeScript และ Vite; JS gzip ประมาณ 65.90 kB และ CSS gzip 5.35 kB
- ตรวจภาพก่อน/หลังของ Dashboard, Analysis, History, Report, Profile และ Auth

Bundled source detector พบก่อนแก้ 2 findings หลังแก้เหลือ 1 finding:

- **side-tab accent border:** ตรวจพบจริงและแก้แล้ว
- **Inter / overused-font:** คงไว้โดยตั้งใจ เพราะงานนี้ปรับระบบเดิม ไม่ได้ออกแบบอัตลักษณ์ใหม่ และไม่ได้เพิ่ม ignore เพื่อซ่อน finding

## คะแนนประเมิน 0–4

| มิติ | ก่อน | หลัง | เหตุผลและข้อจำกัด |
|---|---:|---:|---|
| Accessibility | 1 | 3 | ปรับ controls/forms/focus; ยังไม่ได้ทดสอบ screen reader จริงหรือรับรอง AA |
| Performance | 2 | 2 | ลด data URL, เพิ่ม lazy images และหยุด background polling; ยังไม่ได้ profiling ภาพใหญ่บนเครื่องจริง |
| Theming | 2 | 3 | เพิ่ม surface/control/focus tokens และคงสีข้อมูลจริง; ยังมี inline styles และยังไม่ได้ตรวจ dark theme ครบ |
| Responsive | 1 | 3 | ผ่าน 5 viewport widths; ยังไม่ได้ตรวจ physical touch, Safari หรือ text zoom 200% จริง |
| Implementation integrity | 1 | 3 | นำผลที่สร้างขึ้นแทนผลจริงและ false-success ออก; ยังต้องพิจารณาแหล่งข้อมูลของ legacy records |
| **รวม** | **7/20** | **14/20** | คะแนนเชิงคุณภาพ ไม่ใช่ automated certification |

## สิ่งที่ทำได้ดีเดิมและคงไว้

- ตารางสีจริง, ΔE00, ขนาดแผล และ Histogram ก่อน/หลังยังอิงข้อมูล API
- แสดง calibration status แยกจากผลประเมิน
- มี regression tests สำหรับประวัติแยกบัญชีและการหมดอายุเซสชัน
- คงโครงสร้างรายงานพิมพ์และสี navy/teal ของผลิตภัณฑ์

## งานตรวจต่อที่ยังไม่อ้างว่าผ่าน

1. Safari/iOS/Android และ gesture บนเครื่องจริง รวมชนิดไฟล์ที่ browser preview ไม่ได้
2. NVDA/VoiceOver, contrast แบบเต็มหน้า และ zoom/text scaling 200%
3. เวลา render และ memory เมื่อใช้ภาพใหญ่หรือประวัติจำนวนมาก ก่อนตัดสินใจแยก bundle หรือทำ virtualization
4. หากขยายระบบ design ให้ตกลงขอบเขต PRODUCT.md/DESIGN.md ก่อน งานนี้ไม่ได้สร้างอัตลักษณ์ใหม่จากข้อสันนิษฐาน

UI audit นี้ไม่ได้ยืนยันความถูกต้องทางการแพทย์ของช่วงวัน และไม่ได้เปลี่ยน heuristic ให้เป็นโมเดลที่ผ่านการฝึกหรือ validation
