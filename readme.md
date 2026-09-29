# Bruise Color Calibrate (BCC) — Clinical & Forensic Imaging Web Application

[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688.svg?style=flat&logo=FastAPI&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18.x-61DAFB.svg?style=flat&logo=React&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?style=flat&logo=TypeScript&logoColor=white)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748.svg?style=flat&logo=Prisma&logoColor=white)](https://www.prisma.io)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1.svg?style=flat&logo=MySQL&logoColor=white)](https://www.mysql.com)
[![OpenCV](https://img.shields.io/badge/OpenCV-Computer%20Vision-5C3EE8.svg?style=flat&logo=OpenCV&logoColor=white)](https://opencv.org)
[![Docker](https://img.shields.io/badge/Docker-Production%20Ready-2496ED.svg?style=flat&logo=Docker&logoColor=white)](https://www.docker.com)

> **Languages / ภาษา:**  
> [🇬🇧 English](README.md) &bull; [🇹🇭 ภาษาไทย](README_TH.md)

A full-stack, research-grade clinical web application designed for **automated detection, color calibration, physical dimension measurement, and chromatic analysis of cutaneous bruises (contusions)** from clinical and forensic photographs. Built from computer vision research notebooks into an enterprise-ready, unified web platform powered by **FastAPI**, **MySQL via Prisma ORM**, and **React + TypeScript (Vite)** adhering to modern **Clinical Imaging Workspace** design standards.

---

## 📋 Table of Contents
1. [Project Overview & Scientific Background](#-project-overview--scientific-background)
2. [Comprehensive Tech Stack](#-comprehensive-tech-stack)
3. [System Architecture & Processing Pipeline](#-system-architecture--processing-pipeline)
4. [Database Schema & Prisma ORM Models](#-database-schema--prisma-orm-models)
5. [Key Features & UI/UX Design](#-key-features--uiux-design)
6. [Directory Structure](#-directory-structure)
7. [REST API Documentation](#-rest-api-documentation)
8. [Local Installation & Setup Guide](#-local-installation--setup-guide)
9. [Production Deployment (Docker & Cloud)](#-production-deployment-docker--cloud)
10. [Clinical & Forensic Disclaimer](#-clinical--forensic-disclaimer)

---

## 🔬 Project Overview & Scientific Background

The visual assessment of cutaneous wounds and bruises in forensic medicine, pediatric care, and emergency departments is routinely confounded by **ambient illumination variance**, **camera sensor non-linearities**, and **variable white balancing**.

To address this challenge, this system utilizes a standardized **Color Reference Scale Card** (featuring **16 color calibration patches** — 10 skin-tone gradations and 6 bruise-tone gradations — along with an optical centimeter ruler) captured in the same frame as the injury.

### Core Objectives:
1. **Automated Card Detection**: Locates the calibration card using **SIFT (Scale-Invariant Feature Transform)** feature matching or **Corner Marker Template Correlation** (3 circular orientation markers) and computes a Homography matrix for perspective correction.
2. **Color Correction Matrix (CCM)**: Applies an $L_2$-regularized Ridge Regression model with local radial basis function corrections to map camera RGB signals to standardized colorimetric targets. Rigorously cross-validated using **Leave-One-Out Cross-Validation (LOOCV)** to strictly control held-out $\Delta E_{00}$ color error.
3. **Automated Lesion Segmentation**: Excludes the calibration card, segments healthy baseline skin, and proposes bruise lesion boundaries via adaptive thresholding and morphological filters.
4. **Color Distribution & Cluster Extraction**: Quantifies color cluster percentages using **k-Means clustering** and matches dominant clusters against standard CIEDE2000 reference palettes.
5. **Physical Wound Measurement**: Converts pixel dimensions into calibrated physical units (**width (cm)**, **length (cm)**, and **surface area ($\text{cm}^2$)**) using the detected millimeter/centimeter scale.
6. **Heuristic Day Banding**: Provides research-oriented chronological band estimates based on hemoglobin catabolism kinetics (biliverdin, bilirubin, and hemosiderin transition phases).
7. **Personalized Account Data Isolation**: Automatically isolates patient case records, calibrated image previews, and forensic metrics per user account in a dedicated MySQL database.

---

## 🛠️ Comprehensive Tech Stack

### 1. Frontend Architecture
* **React 18**: Component-driven Single-Page Application (SPA) architecture utilizing functional components and specialized hooks.
* **TypeScript 5**: Strict type-safety across all data contracts, analysis schemas, and user state models.
* **Vite 5**: Next-generation frontend build tooling and bundler providing rapid HMR and optimized production asset minification.
* **HTML5 Canvas 2D API (`willReadFrequently`)**:
  - High-performance, pixel-level manipulation for high-resolution clinical images.
  - Interactive mouse pixel picker for **Manual Neutral Gray/White Point Calibration**.
  - Dynamic 3-channel (Red, Green, Blue) 32-bin distribution histogram rendering.
  - **Persistent DOM Mounting**: Retains canvas buffers in memory across tab navigation, eliminating canvas blanking or black screen artifacts.
* **Clinical Design System (Pure Vanilla CSS)**:
  - Custom tokenized design architecture tailored for medical workflows without bloated external CSS frameworks.
  - **Curated Palette**: Deep Navy (`#10233d`), Slate Blue (`#1a3557`), Muted Clinical Teal (`#1f6f78`), High-contrast Surface Gray (`#f5f7f9`).
  - **Dedicated Print Stylesheet (`@media print`)**: Formats case inspection modal into clean, header-free, medical forensic report printouts and PDF exports.

### 2. Backend & Server Engine
* **Python 3.11 / 3.12**: Core runtime environment for scientific calculations and asynchronous server execution.
* **FastAPI**: Modern, high-performance asynchronous (ASGI) web framework with automatic OpenAPI / Swagger interactive documentation.
* **Uvicorn**: High-throughput ASGI production server with worker process management.
* **Pydantic v2**: Deep request/response data validation, type enforcement, and serialization.
* **Authentication & Ownership-based Authorization**:
  - **RFC 7519 HS256 JWT Bearer Tokens**: Cryptographically signed access tokens with configurable expiration for stateful API sessions.
  - **Salted SHA-256 Credential Hashing**: Passwords stored as irreversible cryptographic hashes with clinical application salt.
  - **Ownership Data Isolation**: Patient case records, calibrated image previews, and forensic metrics are isolated per clinician user account (`Record.userId`).
* **REST API Performance Tuning, Caching & Rate Limiting**:
  - **In-Memory Sliding-Window Rate Limiter**: Throttles request rates per IP (`/api/auth/login`: 15 req/min to prevent brute force; `/api/analyze`: 30 req/min to prevent CPU exhaustion; general `/api/*`: 150 req/min). Emits standard HTTP 429 Too Many Requests with `Retry-After` headers.
  - **Medical-Grade HTTP Caching**: Enforces `Cache-Control: no-store, no-cache, must-revalidate` on clinical patient records while serving static assets with `Cache-Control: public, max-age=86400, stale-while-revalidate=3600`.
  - **Payload Compression (`GZipMiddleware`)**: Compresses JSON payloads and preview image responses exceeding 1KB, significantly lowering bandwidth consumption.
  - **Non-blocking Threadpool Offloading**: Employs `run_in_threadpool` for CPU-intensive SIFT feature matching and CCM matrix regression without blocking FastAPI's async event loop.
* **Starlette & Python-Multipart**: Robust file streaming pipeline supporting clinical images up to 25 MB.

### 3. Database & Object-Relational Mapping (ORM)
* **MySQL 8.0**: Industrial-standard relational database management system.
* **Prisma Client Python (`prisma-client-py`)**:
  - Declarative, type-safe database access layer configured via `schema.prisma`.
  - Zero-drift schema synchronization via `prisma db push`.
* **PyMySQL & Cryptography**: Native binary drivers for secure MySQL transport.

### 4. Computer Vision, Scientific & Image Processing
* **OpenCV (`opencv-python-headless`)**:
  - SIFT (Scale-Invariant Feature Transform) keypoint detection and descriptor extraction.
  - Robust RANSAC-based Homography estimation and four-point perspective warp.
  - Multidimensional color space transformations (BGR ↔ RGB, BGR ↔ CIE $L^*a^*b^*$, BGR ↔ HSV).
  - Morphological operations (dilation, erosion, opening, closing) for biological mask refinement.
  - Contour analysis and minimum-area bounding rectangle computation.
* **NumPy**: High-performance vectorized linear algebra, matrix operations, and pixel buffer manipulation.
* **SciPy**:
  - **Ridge Regression (L2 Regularization)** for Color Correction Matrix optimization.
  - Objective function minimization for LOOCV cross-validation error reduction.
* **Scikit-Image**:
  - Standardized **CIEDE2000 ($\Delta E_{00}$)** color difference metric computation.
  - Adaptive Otsu thresholding and watershed segmentation algorithms.
* **Scikit-Learn**:
  - **k-Means Clustering** for dominant chromatic cluster extraction from segmented bruise tissue.
* **Pillow (PIL) & Pillow-HEIF**:
  - Extensive image codec support: JPEG, PNG, WebP, BMP.
  - Native support for **Apple iPhone HEIC / HEIF** formats.
  - Automated EXIF orientation tag transposition.
* **Pandas**: Tabular storage and retrieval of ColorChecker reference patch chromatic coordinates.

### 5. DevOps, Container & Infrastructure
* **Production Docker Compose**: Multi-container orchestration ([`docker-compose.yml`](docker-compose.yml)) linking the MySQL 8.0 service with persistent named volumes and healthcheck to the FastAPI application.
* **Docker Multi-Stage Build**:
  - Stage 1 (`node:20-slim`): Builds and minifies the React production bundle.
  - Stage 2 (`python:3.11-slim`): Configures Linux runtime, installs OpenCV dependencies, runs `prisma py generate`, and sets up the server.
* **Unified Single-Port Deployment**: FastAPI serves both REST API endpoints (`/api/*`) and production static web assets (`/`) simultaneously from port `8000`, completely eliminating CORS overhead.
* **Graceful Database Fallback**: Resilient offline mode ensures image analysis remains fully functional even during transient database maintenance.

---

## 🔄 System Architecture & Processing Pipeline

```mermaid
flowchart TD
    A[Clinical Photo Ingestion JPG/PNG/HEIC] --> B[EXIF Auto-Rotation & Buffer Normalization]
    B --> C{Reference Card Detection}
    C -->|Method 1: SIFT Feature Matching| D[Point-set Matching vs Reference Template]
    C -->|Method 2: Marker Correlation| E[3 Corner Circle Fiducial Detection]
    D & E --> F[RANSAC Homography & Perspective Rectification]
    F --> G[Sample RGB from 16 Calibration Patches]
    G --> H[Optimize Color Correction Matrix CCM via Ridge Regression]
    H --> I[Leave-One-Out Cross-Validation LOOCV Delta E00]
    I --> J[Apply CCM Calibration to Entire Image]
    J --> K[Card Region Masking]
    K --> L[Normal Baseline Skin Segmentation]
    L --> M[Bruise Tissue Segmentation & Masking]
    M --> N[Physical Scale Conversion: Width, Length, Area cm²]
    M --> O[k-Means Dominant Chromatic Clusters & CIEDE2000]
    M --> P[32-Bin RGB Pixel Distribution Histogram]
    O --> Q[Heuristic Day Band Estimation with Confidence Score]
    N & O & P & Q --> R[Store in MySQL Isolated by User Account]
```

---

## 🗄️ Database Schema & Prisma ORM Models

Data persistence is managed via Prisma ORM connected to MySQL:

```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

generator client {
  provider             = "prisma-client-py"
  recursive_type_depth = 5
}

// User credentials and researcher profiles
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

// Case analysis records isolated per user account
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

## ⭐ Key Features & UI/UX Design

1. **User Authentication & Personal Account Isolation**:
   - Streamlined registration requiring only **Name**, **Email**, and **Password**.
   - **Per-Account Isolation**: Each clinician or researcher accesses strictly their own cases and uploaded photos.
   - Built-in **Demo Account (`demo@bruise.local` / `demo123`)** with single-click auto-fill for instant trial.
2. **Adaptive File Acquisition Bar**:
   - Initial State: Full-height drag-and-drop zone.
   - Post-Upload State: Dropzone seamlessly collapses into a compact file bar featuring **"Change Photo"** and **"🗑️ Remove Photo"** buttons.
3. **Persistent Canvas Navigation**:
   - Allows clinicians to navigate freely between *Dashboard*, *New Analysis*, *Analysis History*, and *Profile* without unmounting the canvas or losing RGB histograms and calibration data.
4. **Clinical Case Inspection Modal**:
   - Detailed inspection window displaying **3 side-by-side comparative views**:
     1. Original Captured Photograph
     2. CCM-Calibrated Color Image
     3. Wound Segmentation Overlay & Mask
   - LOOCV $\Delta E_{00}$ calibration error tables for every card patch.
   - Physical dimensions (width × length in cm, area in $\text{cm}^2$).
   - One-click **"🖨️ Print / Export PDF"** button formatted for medical records.
5. **Interactive Neutral Calibration**:
   - Clinicians can click directly on any neutral gray or white target on the canvas to calculate gain multipliers and correct white balance in real time.

---

## 📂 Directory Structure

```text
SeniorProjectWeb/
├── backend/
│   ├── .env                    # Database connection string (DATABASE_URL)
│   ├── prisma/
│   │   └── schema.prisma       # Prisma ORM models for MySQL
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py             # FastAPI entrypoint, lifespan, auth & CRUD routes
│   │   ├── middleware.py       # Rate limiting, HTTP caching, and security headers
│   │   ├── serialize.py        # NumPy/Base64/JSON serializers
│   │   ├── auth/               # Dedicated Authentication & Authorization package
│   │   │   ├── __init__.py     # Module exports
│   │   │   ├── security.py     # RFC 7519 HS256 JWT & salted password hashing
│   │   │   └── dependencies.py # FastAPI auth guard dependencies
│   │   └── pipeline/
│   │       ├── __init__.py
│   │       ├── io.py           # EXIF transposition, Pillow, HEIC decoder
│   │       ├── reference.py    # Reference scale card colorimetric constants
│   │       ├── calibration.py  # Ridge CCM, LOOCV, and CIEDE2000 math
│   │       ├── colour.py       # k-Means clustering, age heuristic rules
│   │       ├── detect_card.py  # SIFT & 3-marker auto card detectors
│   │       ├── segment.py      # Skin & bruise segmentation, physical sizing
│   │       └── analyse.py      # Master analysis pipeline controller
│   ├── assets/
│   │   └── Color_refercene_card.png # Standard reference scale card asset
│   ├── tests/                  # Automated pytest test suites
│   └── requirements.txt        # Backend Python dependencies
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Main React application, state & views
│   │   ├── index.css           # Clinical design system & print stylesheet
│   │   └── main.tsx            # DOM initialization
│   ├── package.json            # Node.js dependencies
│   ├── vite.config.ts          # Vite build & reverse proxy configuration
│   └── tsconfig.json           # TypeScript compilation settings
├── Dockerfile                  # Production Multi-Stage Dockerfile
├── .dockerignore
├── .gitignore
├── README.md                   # English Documentation
└── README_TH.md                # Thai Documentation
```

---

## 🌐 REST API Documentation

| Method | Endpoint | Description | Payload / Query Parameters |
|---|---|---|---|
| `GET` | `/api/health` | Service health & MySQL connection status | None |
| `POST` | `/api/auth/register` | Register new user account in MySQL | `{ name, email, password }` |
| `POST` | `/api/auth/login` | Authenticate credentials (Demo bypass supported) | `{ email, password }` |
| `POST` | `/api/analyze` | Process photograph through CV pipeline | Multipart Form-data (`file`) |
| `GET` | `/api/records` | List analysis history (filtered per user account) | `?userEmail=...&search=...&limit=100` |
| `POST` | `/api/records` | Save case analysis record to MySQL linked to User | `{ userEmail, patientId, resultJson, ... }` |
| `GET` | `/api/records/{id}` | Retrieve comprehensive case details by ID | None |
| `DELETE` | `/api/records/{id}` | Delete case record from MySQL database | None |
| `GET` | `/api/profile` | Retrieve researcher profile details | `?email=...` |
| `PUT` | `/api/profile` | Update researcher profile in MySQL | `{ name, email }` |

---

## 🚀 Local Installation & Setup Guide

### Prerequisites
- **Node.js**: v18.x or v20.x LTS
- **Python**: v3.11 or v3.12
- **MySQL Server**: v8.0 or higher (listening on port `3306`)

### 1. Backend Setup
```powershell
# Navigate to backend directory
cd backend

# Create and activate virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install Python dependencies
pip install -r requirements.txt

# Configure database connection in backend/.env
# Example: DATABASE_URL="mysql://root:YourPassword@127.0.0.1:3306/bruise_db"

# Generate Prisma Client and synchronize schema with MySQL
prisma py generate
prisma db push

# Start FastAPI development server
uvicorn app.main:app --port 8000 --host 127.0.0.1 --reload
```

### 2. Frontend Setup
```powershell
# Navigate to frontend directory
cd frontend

# Install Node dependencies
npm install

# Start development server
npm run dev
# Access development UI at: http://localhost:5173
```

### 3. Production Build (Single-Port Hosting)
```powershell
# In frontend directory
npm run build

# Copy production bundle to backend static directory
Copy-Item -Path "dist\*" -Destination "..\backend\static" -Recurse -Force

# The entire full-stack application is now served unified at: http://127.0.0.1:8000/
```

---

## ☁️ Production Deployment (Docker & Cloud)

### Deployment Option 1: Docker Compose (Recommended Production Setup)
Orchestrates both the **MySQL 8.0 database** (with persistent named volumes and healthcheck) and the **FastAPI + React application container** seamlessly:

```bash
# 1. Start MySQL and Application together in background
docker compose up -d

# 2. View unified application and database logs
docker compose logs -f app

# 3. Stop containers (patient records and database are safely preserved in mysql_data volume)
docker compose down
```

### Deployment Option 2: Standalone Multi-Stage Docker Container
The included `Dockerfile` uses a multi-stage build that compiles the frontend, installs Python libraries, generates Prisma code, and synchronizes the MySQL database schema automatically on boot:

```bash
# 1. Build Docker image
docker build -t bruise-web .

# 2. Run container with cloud MySQL connection string
docker run -d -p 8000:8000 -e DATABASE_URL="mysql://username:password@remote-mysql-host:3306/database_name" bruise-web
```

### Deployment Option 3: Linux Server (Ubuntu VPS / Dedicated Server)
```bash
# 1. Build frontend assets
cd frontend && npm install && npm run build
cp -r dist/* ../backend/static/

# 2. Configure backend runtime
cd ../backend
pip install -r requirements.txt
prisma py generate
prisma db push

# 3. Launch with multi-worker Uvicorn
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

---

## ⚠️ Clinical & Forensic Disclaimer

- **Heuristic Research Prototype**: The bruise age band estimations generated by this system are heuristic approximations intended strictly for clinical research, methodology exploration, and algorithmic demonstration.
- **Scientific Limitations**: In accordance with international forensic pathology consensus, **the chromatic appearance of a bruise alone cannot reliably determine its exact age in judicial or legal proceedings**. Bruise color evolution is heavily influenced by ambient illumination, baseline epidermal pigmentation, depth of vascular injury, anatomical tissue laxity, and individual metabolic catabolism rates.
- **Legal Warning**: **Results from this application must NOT be used as conclusive evidence in court or as a standalone clinical diagnosis without direct evaluation by a certified forensic medical specialist.**
