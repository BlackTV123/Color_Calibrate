# Bruise Color Calibrate (BCC) — Clinical Imaging Web Application

ระบบเว็บแอปพลิเคชันสำหรับตรวจจับ ปรับเทียบสี (Color Calibration) และวิเคราะห์รอยฟกช้ำจากภาพถ่ายทางคลินิกและนิติวิทยาศาสตร์เบื้องต้น (Clinical Forensic Imaging Prototype) แปลงและพัฒนาจากงานวิจัยสู่ระบบ Full-Stack Web Application ที่สมบูรณ์แบบ ทำงานร่วมกับฐานข้อมูล **MySQL ผ่าน Prisma ORM**, ระบบประมวลผลภาพ **OpenCV / SciPy / Scikit-Image**, สถาปัตยกรรม **FastAPI Backend**, และส่วนต่อประสานผู้ใช้ **React + TypeScript (Vite)** ภายใต้แนวคิดการออกแบบ **Clinical Imaging Workspace**

---

## 📋 สารบัญ (Table of Contents)
1. [ภาพรวมโครงการ (Project Overview)](#-ภาพรวมโครงการ-project-overview)
2. [เทคโนโลยีและไลบรารีที่ใช้ (Comprehensive Tech Stack)](#-เทคโนโลยีและไลบรารีที่ใช้-comprehensive-tech-stack)
3. [สถาปัตยกรรมระบบและ Image Processing Pipeline](#-สถาปัตยกรรมระบบและ-image-processing-pipeline)
4. [โครงสร้างฐานข้อมูล (Database Schema & Prisma Models)](#-โครงสร้างฐานข้อมูล-database-schema--prisma-models)
5. [ฟีเจอร์เด่นของระบบ (Key Features & UI/UX)](#-ฟีเจอร์เด่นของระบบ-key-features--uiux)
6. [โครงสร้างไดเรกทอรี (Directory Structure)](#-โครงสร้างไดเรกทอรี-directory-structure)
7. [รายละเอียด REST API Endpoints](#-รายละเอียด-rest-api-endpoints)
8. [ขั้นตอนการติดตั้งและรันระบบ (Setup & Running Guide)](#-ขั้นตอนการติดตั้งและรันระบบ-setup--running-guide)
9. [การ Deploy สู่ Production (Docker & Cloud Server)](#-การ-deploy-สู่-production-docker--cloud-server)
10. [ข้อจำกัดและคำเตือนทางการแพทย์ (Clinical Disclaimer)](#-ข้อจำกัดและคำเตือนทางการแพทย์-clinical-disclaimer)

---

## 🔬 ภาพรวมโครงการ (Project Overview)

การวิเคราะห์สีและอายุของรอยฟกช้ำจากภาพถ่ายมักเผชิญปัญหาความคลาดเคลื่อนอันเนื่องมาจาก **สภาพแสงที่ไม่คงที่** และ **คุณลักษณะของเซนเซอร์กล้อง (Camera Response Curve)** โครงการนี้จึงนำ **Color Reference Scale Card** (การ์ดสเกลสีอ้างอิงมาตรฐาน ประกอบด้วยแถบสีผิวปกติ 10 ช่อง และแถบสีแผลฟกช้ำ 6 ช่อง พร้อมสเกลไม้บรรทัดหน่วยเซนติเมตร) มาวางข้างรอยแผลขณะถ่ายภาพ เพื่อทำการปรับเทียบสีแบบอัตโนมัติ

### วัตถุประสงค์หลัก:
1. **Auto Detect Reference Card**: ค้นหาตำแหน่งการ์ดสีในภาพอัตโนมัติโดยใช้ Feature Matching (SIFT) หรือ Marker Template Correlation (วงกลมมาร์กเกอร์มุมการ์ด 3 จุด) พร้อมคำนวณ Homography เพื่อดัดมุมมอง (Perspective Correction)
2. **Color Calibration (CCM)**: ปรับเทียบค่าสีทั่วทั้งภาพด้วย Color Correction Matrix (CCM) ร่วมกับ Local Radial Basis Correction ตรวจสอบคุณภาพด้วย Leave-One-Out Cross-Validation (LOOCV) โดยคุมค่าความต่างสี $\Delta E_{00}$ ของสีแผลไม่ให้เกินเกณฑ์
3. **Bruise & Skin Segmentation**: ตัดส่วนการ์ดอ้างอิงออก แยกบริเวณผิวหนังปกติ (Normal Skin) และตรวจจับขอบเขตของรอยฟกช้ำ (Bruise Region Proposal) พร้อมสร้าง Mask
4. **Color Distribution & Cluster Analysis**: วิเคราะห์ร้อยละของสีแผล เทียบกับช่องสเกลมาตรฐาน CIEDE2000 และจัดกลุ่มสีจริงด้วย k-Means Clustering
5. **Physical Size Estimation**: คำนวณความกว้าง ความยาว (ซม.) และพื้นที่ผิวของรอยแผล (ซม.²) โดยเทียบอัตราส่วนกับสเกลไม้บรรทัดบนการ์ด
6. **Heuristic Age Banding**: ให้ข้อมูลช่วงวันของแผลตามทฤษฎีการสลายตัวของฮีโมโกลบิน (Hemoglobin Catabolism) พร้อมระดับความเชื่อมั่น (Confidence Score)
7. **Personalized Record Management**: บันทึก จัดเก็บ และตรวจสอบเคสย้อนหลัง โดยระบบจะแยกประวัติและรูปภาพของแต่ละบัญชีผู้ใช้ออกจากกันอย่างปลอดภัยใน MySQL

---

## 🛠️ เทคโนโลยีและไลบรารีที่ใช้ (Comprehensive Tech Stack)

### 1. Frontend (Client-side Application)
* **React 18**: ไลบรารีหลักในการสร้างส่วนต่อประสานผู้ใช้แบบ Single Page Application (SPA)
* **TypeScript 5**: กำหนด Type ความปลอดภัยของข้อมูล ลดข้อผิดพลาดในระดับ Compile-time
* **Vite 5**: Next-generation Build Tool และ Bundler ให้ความเร็วสูงในการ Hot Module Replacement (HMR) และ Optimize Production Bundle
* **HTML5 Canvas API (`2D Context`)**: 
  - ประมวลผลและแสดงผลภาพความละเอียดสูงแบบ Interactive
  - รองรับการคลิกเลือกพิกเซลอ้างอิง (Neutral Gray/White Pixel Picker)
  - พลอตกราฟเส้นการกระจายตัวของฮิสโตแกรมสีแบบเรียลไทม์ 3 แชนเนล (Red, Green, Blue)
  - กลไก **Persistent DOM & Auto-Restoration** ป้องกันปัญหาภาพดำหรือกราฟหายขณะสลับแท็บเมนู
* **Clinical Design System (Pure Vanilla CSS)**:
  - ออกแบบตามหลัก Medical UI โดยไม่พึ่งพา CSS Framework ขนาดใหญ่ เพื่อประสิทธิภาพสูงสุดและการควบคุมที่ยืดหยุ่น
  - **Color Tokens**: Deep Navy (`#10233d`), Slate Blue (`#1a3557`), Muted Teal (`#1f6f78`), Light Gray Background (`#f5f7f9`)
  - **CSS Custom Properties**: กำหนดตัวแปรกลางสำหรับระยะห่าง, ความโค้งมน, และเงา
  - **Print Media Queries (`@media print`)**: ปรับแต่งการสั่งพิมพ์รายงานชันสูตรแผลและ Export PDF ให้ออกมาเป็นเอกสารทางการแพทย์ที่สะอาด สวยงาม และไม่มีแถบเมนูรบกวน

### 2. Backend & Server Engine
* **Python 3.11 / 3.12**: ภาษาหลักสำหรับประมวลผลอัลกอริทึมและ API
* **FastAPI**: เว็บเฟรมเวิร์กประสิทธิภาพสูงแบบ Asynchronous (ASGI) พร้อมรองรับ Automatic Swagger / OpenAPI Documentation
* **Uvicorn**: Lightning-fast ASGI Server สำหรับรัน FastAPI ทั้งในโหมด Development และ Production
* **Pydantic v2**: ตรวจสอบความถูกต้องของข้อมูล (Data Validation) ทั้งฝั่ง Request และ Response
* **Authentication & Ownership-based Authorization**:
  - **RFC 7519 HS256 JWT Bearer Token**: ระบบออก Access Token ที่ลงลายมือชื่อดิจิทัลและกำหนดวันหมดอายุ สำหรับยืนยันตัวตนของแพทย์ในทุก Request (`Authorization: Bearer <token>`)
  - **Salted SHA-256 Hashing**: แฮชรหัสผ่านด้วยเกลือเฉพาะของระบบ ป้องกันการรั่วไหล ไม่เก็บ Plaintext ลงใน Database
  - **Ownership Data Isolation**: แยกสิทธิ์การดู แก้ไข และลบประวัติการตรวจตามบัญชีของแพทย์ผู้บันทึกแต่ละท่าน (`Record.userId`) ข้อมูลคนไข้ไม่ปะปนกัน
* **REST API Performance Tuning, Caching & Rate Limiting**:
  - **In-Memory Sliding-Window Rate Limiter**: ควบคุมความถี่การยิง API ต่อ IP ป้องกันการ Brute-force รหัสผ่าน (`/api/auth/login` สูงสุด 15 ครั้ง/นาที) และป้องกันเซิร์ฟเวอร์ล่มจากการส่งภาพคำนวณถี่เกินไป (`/api/analyze` สูงสุด 30 ครั้ง/นาที) โดยส่งกลับ HTTP 429 Too Many Requests พร้อม `Retry-After` Header
  - **Medical-Grade HTTP Caching**: ตั้งค่า Header `Cache-Control: no-store, no-cache, must-revalidate` สำหรับข้อมูลประวัติคนไข้เพื่อความปลอดภัย และใช้ `Cache-Control: public, max-age=86400` สำหรับไฟล์ CSS/JS/Image ช่วยให้โหลดหน้าเว็บได้ทันที
  - **GZip Payload Compression**: เปิดใช้งาน `GZipMiddleware` บีบอัดข้อมูลผลวิเคราะห์และภาพพรีวิวขนาดใหญ่กว่า 1KB ลดขนาดข้อมูลที่ส่งผ่านเน็ตได้มากกว่า 60-80%
  - **Non-blocking Threadpool Offloading**: ใช้ `run_in_threadpool` แยกงาน Image Processing หนักๆ ของ OpenCV/SIFT/CCM ออกจาก Asynchronous Event Loop ของ FastAPI
* **Starlette & Python-Multipart**: จัดการการอัปโหลดไฟล์ภาพขนาดใหญ่ (รองรับสูงสุด 25MB) และการ Mount Static Files

### 3. Database & Object-Relational Mapping (ORM)
* **MySQL 8.0**: ระบบจัดการฐานข้อมูลเชิงสัมพันธ์ (Relational Database) สำหรับจัดเก็บข้อมูลผู้ใช้และประวัติการตรวจ
* **Prisma ORM (`prisma-client-py`)**: 
  - Type-safe Database Client สำหรับ Python
  - บริหารจัดการโครงสร้างตารางด้วยไฟล์ `schema.prisma`
  - รองรับคำสั่ง `prisma db push` สำหรับซิงค์โครงสร้างตารางเข้าสู่ MySQL อัตโนมัติ
* **PyMySQL & Cryptography**: ไลบรารีไดรเวอร์เชื่อมต่อ MySQL และรองรับการเข้ารหัสข้อมูลที่ปลอดภัย

### 4. Computer Vision, Scientific & Image Processing
* **OpenCV (`opencv-python-headless`)**:
  - การจับคู่จุดเด่นด้วย **SIFT (Scale-Invariant Feature Transform)**
  - การหาเมทริกซ์แปลงภาพ (Homography Estimation via RANSAC)
  - การแปลงระบบสี (Color Space Conversions: BGR ↔ RGB, BGR ↔ Lab, BGR ↔ HSV)
  - การประมวลผลสัณฐานวิทยา (Morphological Operations: Dilation, Erosion, Closing)
  - การตรวจจับขอบเขตและเส้นรอบรูป (Contour Detection & Bounding Box)
* **NumPy**: จัดการการคำนวณเมทริกซ์หลายมิติ, เวกเตอร์สี RGB/Lab, และความเร็วในการประมวลผลพิกเซล
* **SciPy**:
  - **Ridge Regression (L2 Regularization)** สำหรับสร้าง Color Correction Matrix ป้องกันปัญหา Overfitting
  - การคำนวณ Optimization และ Held-out Error
* **Scikit-Image**:
  - การคำนวณค่าความต่างสีตามมาตรฐานสากล **CIEDE2000 ($\Delta E_{00}$)**
  - การแบ่งส่วนภาพด้วยเทคนิค Adaptive Thresholding
* **Scikit-Learn**:
  - อัลกอริทึม **k-Means Clustering** สำหรับจัดกลุ่มและสกัดกลุ่มสีเด่น (Dominant Colors) ของรอยแผล
* **Pillow (PIL) & Pillow-HEIF**:
  - รองรับการอ่านและแปลงไฟล์ภาพทุกฟอร์แมต: JPEG, PNG, WebP, BMP
  - รองรับไฟล์ **HEIC / HEIF** จากสมาร์ทโฟน (iPhone / Samsung)
  - จัดการหมุนภาพตามเซนเซอร์ความเอียงอัตโนมัติ (EXIF Orientation Auto-transposition)
* **Pandas**: จัดเก็บและแมปปิ้งค่าสีมาตรฐานสากลของการ์ดอ้างอิง 16 สี

### 5. DevOps, Container & Deployment
* **Production Docker Compose**: ควบคุมและเชื่อมต่อบริการด้วย [`docker-compose.yml`](docker-compose.yml) รัน MySQL 8.0 พร้อม Persistent Volume (`mysql_data`) และ Healthcheck คู่กับแอปพลิเคชันอย่างสมบูรณ์แบบ
* **Docker Multi-Stage Build**:
  - Stage 1 (`node:20-slim`): คอมไพล์ TypeScript และ Build React เป็น Static Assets
  - Stage 2 (`python:3.11-slim`): ติดตั้ง Dependency, รัน `prisma py generate`, และเตรียมระบบรัน Production
* **Unified Single-Port Deployment**: FastAPI ทำหน้าที่เสิร์ฟทั้ง REST API (`/api/*`) และ Static Web (`/`) ในพอร์ตเดียว ไม่ต้องกังวลเรื่อง CORS
* **Graceful Offline Fallback**: ออกแบบระบบให้ทำงานต่อได้ในโหมด Offline หากฐานข้อมูลยังไม่พร้อมใช้งานชั่วคราว

---

## 🔄 สถาปัตยกรรมระบบและ Image Processing Pipeline

```mermaid
flowchart TD
    A[อัปโหลดภาพทางคลินิก JPG/PNG/HEIC] --> B[อ่านไฟล์ & แก้ไข EXIF Orientation]
    B --> C{ตรวจจับการ์ดสีอ้างอิง}
    C -->|วิธีที่ 1: SIFT Feature Matching| D[จับคู่จุดเด่นกับการ์ดต้นแบบ]
    C -->|วิธีที่ 2: Corner Markers Detection| E[ตรวจจับวงกลมมุมการ์ด 3 จุด]
    D & E --> F[คำนวณ Homography & Perspective Transform]
    F --> G[สกัดค่าสี RGB จากช่องการ์ดทั้ง 16 ช่อง]
    G --> H[สร้าง Color Correction Matrix CCM ผ่าน Ridge Regression]
    H --> I[ประเมินคุณภาพด้วย LOOCV CIEDE2000]
    I --> J[ปรับเทียบสีทั่วทั้งภาพ Calibrated Image]
    J --> K[ตัดขอบเขตการ์ดออก Mask Out Card]
    K --> L[ตรวจจับบริเวณผิวปกติ Normal Skin Segmentation]
    L --> M[ตรวจจับขอบเขตรอยฟกช้ำ Bruise Segmentation]
    M --> N[วัดขนาดแผล กว้าง x ยาว x พื้นที่ ซม.²]
    M --> O[วิเคราะห์กลุ่มสีเด่น k-Means & CIEDE2000]
    M --> P[สร้าง RGB Histogram 32 Bins]
    O --> Q[ประเมินช่วงวันของแผล Heuristic Age Estimate]
    N & O & P & Q --> R[บันทึกลงฐานข้อมูล MySQL เฉพาะบัญชีผู้ใช้]
```

---

## 🗄️ โครงสร้างฐานข้อมูล (Database Schema & Prisma Models)

ระบบใช้ Prisma ORM เชื่อมต่อกับ MySQL โดยมีโครงสร้างตารางดังนี้:

```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

generator client {
  provider             = "prisma-client-py"
  recursive_type_depth = 5
}

// ตารางข้อมูลผู้ใช้งาน
model User {
  id           Int      @id @default(autoincrement())
  email        String   @unique
  name         String
  role         String   @default("Clinician")
  org          String   @default("Clinical Forensic Lab")
  passwordHash String   @default("")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  records      Record[]

  @@map("users")
}

// ตารางบันทึกประวัติการวิเคราะห์รอยฟกช้ำ (แยกตามผู้ใช้)
model Record {
  id             Int      @id @default(autoincrement())
  userId         Int?
  user           User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  patientId      String   @default("")
  woundLocation  String   @default("")
  imageFilename  String   @default("")
  estimatedAge   String   @default("")
  confidence     Float    @default(0.0)
  deltaE00       Float    @default(0.0)
  surfaceAreaMm2 Float    @default(0.0)
  dominantHex    String   @default("")
  summary        String   @default("")
  thumbnail      String?  @db.LongText
  resultJson     String   @db.LongText
  createdAt      DateTime @default(now())

  @@map("records")
}
```

---

## ⭐ ฟีเจอร์เด่นของระบบ (Key Features & UI/UX)

1. **User Authentication & Personal Account Isolation**:
   - หน้า Sign In / Register ที่ตัดช่องที่ไม่จำเป็นออก เหลือเพียง Name, Email, Password
   - **แยกประวัติและภาพออกจากกันโดยสมบูรณ์**: ผู้ใช้ A จะไม่เห็นภาพหรือเคสของผู้ใช้ B
   - มีบัญชี **Demo Account (`demo@bruise.local` / `demo123`)** พร้อมปุ่มกรอกอัตโนมัติสำหรับการทดสอบทันที
2. **Modern Dropzone & Compact File Bar**:
   - เมื่อยังไม่มีรูปภาพ: แสดง Dropzone ขนาดใหญ่เต็มพื้นที่ รองรับการลากวางไฟล์
   - เมื่อเลือกรูปภาพแล้ว: Dropzone จะหายไป และเปลี่ยนเป็นแถบข้อมูลไฟล์ขนาดกะทัดรัด พร้อมปุ่ม **«เปลี่ยนภาพ»** และ **«🗑️ ลบภาพออก»**
3. **Persistent Canvas Navigation**:
   - สามารถคลิกสลับแท็บไปมาระหว่าง *Dashboard*, *New Analysis*, *Analysis History*, และ *Profile* ได้อย่างอิสระ โดยที่ภาพถ่ายบน Canvas และกราฟฮิสโตแกรม **ไม่ดำและไม่สูญหาย**
4. **Clinical Case Inspection Modal**:
   - คลิกที่เคสในประวัติเพื่อเปิดหน้าต่างตรวจสอบอย่างละเอียด
   - แสดงภาพเปรียบเทียบขนาดใหญ่ 3 รูปแบบ: **1. ภาพต้นฉบับ**, **2. ภาพที่ปรับเทียบสีแล้ว**, และ **3. ภาพ Mask รอยแผล**
   - แสดงตารางค่าความคลาดสี $\Delta E_{00}$ ของแต่ละช่องบนการ์ดสีแบบ Leave-One-Out Cross-Validation (LOOCV)
   - แสดงขนาดแผล (กว้าง × ยาว ซม. และพื้นที่ ซม.²)
   - รองรับปุ่ม **«🖨️ Print / Export PDF»** สำหรับสั่งพิมพ์รายงานชันสูตรทางการแพทย์
5. **Interactive Neutral Calibration**:
   - ผู้ใช้สามารถคลิกเลือกจุดอ้างอิงสีขาวหรือเทากลางบนภาพด้วยเมาส์ เพื่อสั่งคำนวณเกนและปรับสมดุลแสงสีขาว (White Balance) บนหน้าเว็บได้ทันที

---

## 📂 โครงสร้างไดเรกทอรี (Directory Structure)

```text
SeniorProjectWeb/
├── backend/
│   ├── .env                    # DATABASE_URL เชื่อมต่อ MySQL
│   ├── prisma/
│   │   └── schema.prisma       # สกีมาตาราง User และ Record
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py             # FastAPI App, Auth Endpoints & Static Mount
│   │   ├── middleware.py       # ระบบ Rate Limiting, HTTP Caching และ Security Headers
│   │   ├── serialize.py        # จัดการแปลงข้อมูล NumPy / Base64 / JSON
│   │   ├── auth/               # โฟลเดอร์แพ็กเกจระบบ Authentication & Authorization
│   │   │   ├── __init__.py     # Export โมดูลหลัก
│   │   │   ├── security.py     # RFC 7519 HS256 JWT & Salted SHA-256 Hashing
│   │   │   └── dependencies.py # FastAPI Auth Guards (ตรวจ Bearer Token)
│   │   └── pipeline/
│   │       ├── __init__.py
│   │       ├── io.py           # ระบบอ่าน/แปลงไฟล์ภาพ EXIF, Pillow, HEIC
│   │       ├── reference.py    # ค่าสีอ้างอิงของการ์ดสเกล (Lab/RGB)
│   │       ├── calibration.py  # อัลกอริทึม CCM, LOOCV, CIEDE2000
│   │       ├── colour.py       # เปอร์เซ็นต์สี, k-Means Clustering, Heuristic Age
│   │       ├── detect_card.py  # ตรวจจับการ์ดอัตโนมัติ (SIFT & 3 Markers)
│   │       ├── segment.py      # แยกผิวหนัง, ตัดการ์ด, สร้าง Mask, วัดขนาด ซม.
│   │       └── analyse.py      # Pipeline ควบคุมขั้นตอนการวิเคราะห์ทั้งหมด
│   ├── assets/
│   │   └── Color_refercene_card.png # การ์ดสเกลสีอ้างอิงต้นแบบ
│   ├── tests/                  # ชุดทดสอบอัตโนมัติ Pytest
│   └── requirements.txt        # รายการไลบรารี Python สำหรับ Backend
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # เมนคอมโพเนนต์ ควบคุม State, Auth, และ Views
│   │   ├── index.css           # สไตล์ชีต Clinical Design System & Print Layout
│   │   └── main.tsx            # จุดเริ่มต้น React DOM
│   ├── package.json
│   ├── vite.config.ts          # การตั้งค่า Vite และ Reverse Proxy
│   └── tsconfig.json
├── Dockerfile                  # Multi-Stage Build สำหรับ Deploy บน Cloud
├── .dockerignore
├── .gitignore
└── readme.md                   # เอกสารประกอบโครงการ
```

---

## 🌐 รายละเอียด REST API Endpoints

| Method | Endpoint | Description | Query / Body Payload |
|---|---|---|---|
| `GET` | `/api/health` | ตรวจสอบสถานะ Backend และสถานะเชื่อมต่อ MySQL | - |
| `POST` | `/api/auth/register` | สมัครสมาชิกสร้างบัญชีใหม่ลง MySQL | `{ name, email, password }` |
| `POST` | `/api/auth/login` | เข้าสู่ระบบตรวจสอบรหัสผ่าน (มี Demo Bypass) | `{ email, password }` |
| `POST` | `/api/analyze` | วิเคราะห์ภาพถ่ายรอยฟกช้ำผ่าน Computer Vision Pipeline | Multipart Form-data (`file`) |
| `GET` | `/api/records` | ดึงรายการประวัติการวิเคราะห์ (กรองเฉพาะของ User) | `?userEmail=...&search=...&limit=100` |
| `POST` | `/api/records` | บันทึกผลการวิเคราะห์ลง MySQL ผูกกับ User ID | `{ userEmail, patientId, resultJson, ... }` |
| `GET` | `/api/records/{id}` | ดึงข้อมูลผลการตรวจละเอียดของเคสตาม ID | - |
| `DELETE` | `/api/records/{id}` | ลบเคสการตรวจออกจากฐานข้อมูล MySQL | - |
| `GET` | `/api/profile` | ดึงข้อมูลส่วนตัวของผู้ใช้งาน | `?email=...` |
| `PUT` | `/api/profile` | อัปเดตข้อมูลส่วนตัวของผู้ใช้งาน | `{ name, email }` |

---

## 🚀 ขั้นตอนการติดตั้งและรันระบบ (Setup & Running Guide)

### 1. ความต้องการเบื้องต้น (Prerequisites)
- **Node.js**: เวอร์ชั่น 18 หรือ 20 LTS
- **Python**: เวอร์ชั่น 3.11 หรือ 3.12
- **MySQL Server**: เวอร์ชั่น 8.0 ขึ้นไป (รันอยู่ที่พอร์ต `3306`)

### 2. ติดตั้งและตั้งค่า Backend
```powershell
# 1. เข้าสู่โฟลเดอร์ backend
cd backend

# 2. สร้างและเปิดใช้งาน Virtual Environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 3. ติดตั้ง Dependencies
pip install -r requirements.txt

# 4. ตั้งค่าไฟล์ .env (แก้ไขรหัสผ่าน MySQL ให้ตรงกับเครื่องของคุณ)
# ตัวอย่าง: DATABASE_URL="mysql://root:Pai123456789@127.0.0.1:3306/bruise_db"

# 5. สั่งสร้าง Prisma Client และซิงค์โครงสร้างตารางสู่ MySQL
prisma py generate
prisma db push

# 6. เริ่มต้นรันเซิร์ฟเวอร์ Backend
uvicorn app.main:app --port 8000 --host 127.0.0.1 --reload
```

### 3. ติดตั้งและรัน Frontend
```powershell
# 1. เข้าสู่โฟลเดอร์ frontend
cd frontend

# 2. ติดตั้ง Node Dependencies
npm install

# 3. รันในโหมด Development
npm run dev
# เข้าใช้งานที่: http://localhost:5173
```

### 4. การ Build Frontend เพื่อให้ Backend เสิร์ฟแบบ All-in-One
```powershell
# ในโฟลเดอร์ frontend
npm run build

# คัดลอกผลลัพธ์โฟลเดอร์ dist ไปยัง backend/static
Copy-Item -Path "dist\*" -Destination "..\backend\static" -Recurse -Force

# สามารถเปิดเข้าใช้งานระบบทั้งหมดได้โดยตรงที่: http://127.0.0.1:8000/
```

---

## ☁️ การ Deploy สู่ Production (Docker & Cloud Server)

### วิธีที่ 1: Deploy ผ่าน Docker Compose (แนะนำที่สุดสำหรับ Production)
สั่งการทั้ง **MySQL 8.0 ฐานข้อมูล** (พร้อม Persistent Volume `mysql_data` และ Healthcheck ตรวจสอบความพร้อม) และ **FastAPI + React Application Container** ให้เริ่มทำงานพร้อมกันด้วยคำสั่งเดียว:

```bash
# 1. รันระบบทั้งหมดแบบ Background Daemon
docker compose up -d

# 2. ดู Log การทำงานของระบบ
docker compose logs -f app

# 3. สั่งหยุดการทำงาน (ข้อมูลคนไข้และฐานข้อมูลไม่สูญหาย เก็บไว้ใน volume mysql_data)
docker compose down
```

### วิธีที่ 2: Deploy ผ่าน Standalone Docker Container (สำหรับ Render / Railway / Cloud Run)
โปรเจกต์มี `Dockerfile` แบบ Multi-Stage Build ที่จัดการคอมไพล์ Frontend, ติดตั้ง Python, รัน `prisma py generate` และสั่ง `prisma db push` ให้อัตโนมัติ:

```bash
# 1. Build Docker Image
docker build -t bruise-web .

# 2. Run Container โดยส่งค่าตัวแปร DATABASE_URL ของ Cloud MySQL
docker run -d -p 8000:8000 -e DATABASE_URL="mysql://username:password@remote-host:3306/database_name" bruise-web
```

### วิธีที่ 3: Deploy บน Linux Server (Ubuntu VPS)
```bash
# ติดตั้ง Frontend
cd frontend && npm install && npm run build
cp -r dist/* ../backend/static/

# ติดตั้ง Backend
cd ../backend
pip install -r requirements.txt
prisma py generate
prisma db push

# รัน Production ด้วย Uvicorn Workers
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

---

## ⚠️ ข้อจำกัดและคำเตือนทางการแพทย์ (Clinical Disclaimer)

- **Heuristic Research Prototype**: การประเมินช่วงวันของรอยฟกช้ำในระบบนี้พัฒนาขึ้นเพื่อการศึกษาวิจัยและสาธิตขั้นตอนการทำงาน (Workflow Demonstration) ทางคลินิกและนิติวิทยาศาสตร์เบื้องต้นเท่านั้น
- **Scientific Limitation**: อิงตามหลักวิชาการแพทย์ระดับสากล **สีของรอยฟกช้ำเพียงอย่างเดียวไม่สามารถระบุอายุของบาดแผลได้อย่างแน่นอนทางนิติวิทยาศาสตร์** เนื่องจากปัจจัยด้านสภาพแสง, สีผิวพื้นฐานของผู้ป่วย, ความลึกของชั้นเนื้อเยื่อที่เกิดการบาดเจ็บ, ตำแหน่งทางกายวิภาค และอัตราการฟื้นตัวของร่างกายในแต่ละบุคคล
- **Usage Warning**: **ห้ามนำผลลัพธ์จากระบบนี้ไปใช้เป็นหลักฐานสรุปผลคดี หรือใช้แทนการวินิจฉัยทางการแพทย์โดยปราศจากการตรวจสอบโดยแพทย์ผู้เชี่ยวชาญ**
