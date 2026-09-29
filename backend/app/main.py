import json
import hashlib
from pathlib import Path
from typing import Optional, Any
from contextlib import asynccontextmanager
from pydantic import BaseModel, Field
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, status, Depends
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from prisma import Prisma

from app.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user_optional,
    get_current_user_required
)
from app.middleware import RateLimiterMiddleware, CacheControlAndSecurityMiddleware
from app.pipeline.analyse import analyse_photo_auto_bytes
from app.serialize import to_json_safe, build_response

db = Prisma()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await db.connect()
        print("[Prisma] Connected to MySQL database (bruise_db) successfully.")
    except Exception as e:
        print(f"[Prisma] Warning: Could not connect to MySQL: {e}")
    yield
    if db.is_connected():
        await db.disconnect()
        print("[Prisma] Disconnected cleanly from MySQL.")


app = FastAPI(
    title="Bruise Color Calibrate API",
    description="Clinical imaging pipeline for reference-card color calibration and bruise analysis with JWT Authentication, Rate Limiting, and GZip Compression.",
    version="1.1.0",
    lifespan=lifespan
)

# -------------------------------------------------------------
# Middlewares: Performance Tuning, Caching, Rate Limiting & CORS
# -------------------------------------------------------------

# 1. Rate Limiting: Prevent Brute-Force & CPU Exhaustion
app.add_middleware(RateLimiterMiddleware)

# 2. HTTP Caching & Security Headers: Fast static loads & No-Store for clinical data
app.add_middleware(CacheControlAndSecurityMiddleware)

# 3. Payload Compression: GZip responses > 1KB for faster transfer
app.add_middleware(GZipMiddleware, minimum_size=1000)

# 4. CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_BYTES = 25 * 1024 * 1024  # 25 MB


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str
    role: str = "Clinician"
    org: str = "Clinical Forensic Lab"


class RecordCreateRequest(BaseModel):
    userEmail: Optional[str] = Field(default="", description="Owner user email for account isolation")
    patientId: Optional[str] = Field(default="", description="Patient or Case ID")
    woundLocation: Optional[str] = Field(default="", description="Anatomical site")
    imageFilename: Optional[str] = Field(default="", description="Original image filename")
    estimatedAge: Optional[str] = Field(default="", description="Estimated age range string")
    confidence: Optional[float] = Field(default=0.0, description="Confidence score 0-100")
    deltaE00: Optional[float] = Field(default=0.0, description="Median ΔE00 calibration error")
    surfaceAreaMm2: Optional[float] = Field(default=0.0, description="Surface area in mm2 or cm2")
    dominantHex: Optional[str] = Field(default="", description="Hex code of dominant bruise color")
    summary: Optional[str] = Field(default="", description="Clinical findings summary / clinician notes")
    thumbnail: Optional[str] = Field(default=None, description="Base64 thumbnail preview")
    resultJson: Any = Field(default_factory=dict, description="Full analysis response payload")


class ProfileUpdateRequest(BaseModel):
    name: str
    email: str
    role: str = "Clinician"
    org: str = "Clinical Forensic Lab"


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "Bruise Color Calibrate Backend",
        "version": "1.1.0",
        "database": "connected" if db.is_connected() else "disconnected",
        "security": {
            "jwt_auth": "enabled",
            "rate_limiting": "active",
            "gzip_compression": "enabled",
            "caching_headers": "active"
        }
    }


# -------------------------------------------------------------
# Authentication & Authorization (JWT Token-based + Password Hashing)
# -------------------------------------------------------------

@app.post("/api/auth/register")
async def register(body: RegisterRequest):
    if not db.is_connected():
        raise HTTPException(status_code=503, detail="Database service unavailable.")

    email_clean = body.email.strip().lower()
    if not email_clean or "@" not in email_clean:
        raise HTTPException(status_code=400, detail="รูปแบบอีเมลไม่ถูกต้อง")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="รหัสผ่านต้องมีความยาวอย่างน้อย 4 ตัวอักษร")

    existing = await db.user.find_unique(where={"email": email_clean})
    if existing:
        raise HTTPException(status_code=400, detail="อีเมลนี้มีอยู่ในระบบแล้ว กรุณาเข้าสู่ระบบ (Sign In)")

    user = await db.user.create(
        data={
            "email": email_clean,
            "name": body.name.strip() or "Clinician",
            "role": body.role or "Clinician",
            "org": body.org or "Clinical Forensic Lab",
            "passwordHash": hash_password(body.password)
        }
    )

    # Issue signed JWT Bearer Token
    token = create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": user.role
    })

    return {
        "success": True,
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "org": user.org
        }
    }


@app.post("/api/auth/login")
async def login(body: LoginRequest):
    if not db.is_connected():
        raise HTTPException(status_code=503, detail="Database service unavailable.")

    email_clean = body.email.strip().lower()
    pwd = body.password

    user = await db.user.find_unique(where={"email": email_clean})
    if not user:
        raise HTTPException(status_code=401, detail="ไม่พบบัญชีผู้ใช้นี้ในระบบ กรุณาสมัครสมาชิกใหม่")

    if user.passwordHash and not verify_password(pwd, user.passwordHash):
        raise HTTPException(status_code=401, detail="รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง")

    # Issue signed JWT Bearer Token
    token = create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": user.role
    })

    return {
        "success": True,
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "org": user.org
        }
    }


@app.get("/api/auth/me")
async def get_current_user_profile(user_claims: dict = Depends(get_current_user_required)):
    """Protected endpoint validating JWT Bearer token claims."""
    return {
        "success": True,
        "user": user_claims
    }


# -------------------------------------------------------------
# Image Analysis Pipeline (SIFT + CCM + Color Segmentation)
# -------------------------------------------------------------

@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    payload = await file.read()
    if len(payload) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large. Maximum size is {MAX_BYTES // (1024 * 1024)}MB.")
    if len(payload) == 0:
        raise HTTPException(status_code=400, detail="Empty file submitted.")

    try:
        result = await run_in_threadpool(
            analyse_photo_auto_bytes,
            payload,
            file.filename or "uploaded_image"
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis pipeline error: {str(e)}")

    response_data = build_response(result)
    return to_json_safe(response_data)


# -------------------------------------------------------------
# Clinical Records (CRUD backed by MySQL with JWT Auth Isolation)
# -------------------------------------------------------------

@app.get("/api/records")
async def list_records(
    userEmail: Optional[str] = Query(None, description="User email for per-account isolated records"),
    auth_user: Optional[dict] = Depends(get_current_user_optional),
    limit: int = Query(100, ge=1, le=500),
    search: Optional[str] = None
):
    if not db.is_connected():
        raise HTTPException(status_code=503, detail="Database service unavailable.")

    # Prioritize authenticated JWT user email over query parameter
    effective_email = (auth_user.get("email") if auth_user else None) or (userEmail.strip().lower() if userEmail else None)

    where_filter = {}
    if effective_email:
        user = await db.user.find_unique(where={"email": effective_email})
        if not user:
            return {"total": 0, "records": []}
        where_filter["userId"] = user.id

    if search:
        search_filter = [
            {"patientId": {"contains": search}},
            {"woundLocation": {"contains": search}},
            {"summary": {"contains": search}},
        ]
        if "userId" in where_filter:
            where_filter = {
                "AND": [
                    {"userId": where_filter["userId"]},
                    {"OR": search_filter}
                ]
            }
        else:
            where_filter = {"OR": search_filter}

    try:
        records = await db.record.find_many(
            where=where_filter if where_filter else None,
            order={"createdAt": "desc"},
            take=limit
        )
        items = []
        for r in records:
            res = {}
            if r.resultJson:
                try:
                    res = json.loads(r.resultJson)
                except Exception:
                    res = {}

            # Thumbnail resolution
            thumb = r.thumbnail
            if not thumb and isinstance(res, dict):
                prev = res.get("previews", {})
                thumb = prev.get("overlay") or prev.get("calibrated") or prev.get("original")

            items.append({
                "id": str(r.id),
                "patientId": r.patientId,
                "woundLocation": r.woundLocation,
                "imageFilename": r.imageFilename,
                "estimatedAge": r.estimatedAge,
                "confidence": r.confidence,
                "deltaE00": r.deltaE00,
                "surfaceAreaMm2": r.surfaceAreaMm2,
                "dominantHex": r.dominantHex,
                "summary": r.summary,
                "thumbnail": thumb,
                "createdAt": r.createdAt.isoformat() if r.createdAt else "",
                "resultJson": res
            })
        return {"total": len(items), "records": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query records: {str(e)}")


@app.get("/api/records/{record_id}")
async def get_record(record_id: int):
    if not db.is_connected():
        raise HTTPException(status_code=503, detail="Database service unavailable.")

    record = await db.record.find_unique(where={"id": record_id})
    if not record:
        raise HTTPException(status_code=404, detail="Record not found.")

    res = {}
    if record.resultJson:
        try:
            res = json.loads(record.resultJson)
        except Exception:
            res = {}

    thumb = record.thumbnail
    if not thumb and isinstance(res, dict):
        prev = res.get("previews", {})
        thumb = prev.get("overlay") or prev.get("calibrated") or prev.get("original")

    return {
        "id": str(record.id),
        "patientId": record.patientId,
        "woundLocation": record.woundLocation,
        "imageFilename": record.imageFilename,
        "estimatedAge": record.estimatedAge,
        "confidence": record.confidence,
        "deltaE00": record.deltaE00,
        "surfaceAreaMm2": record.surfaceAreaMm2,
        "dominantHex": record.dominantHex,
        "summary": record.summary,
        "thumbnail": thumb,
        "createdAt": record.createdAt.isoformat() if record.createdAt else "",
        "resultJson": res
    }


@app.post("/api/records", status_code=status.HTTP_201_CREATED)
async def create_record(
    body: RecordCreateRequest,
    auth_user: Optional[dict] = Depends(get_current_user_optional)
):
    if not db.is_connected():
        raise HTTPException(status_code=503, detail="Database service unavailable.")

    # Associate record with logged-in user (from JWT claims if available, else body)
    effective_email = (auth_user.get("email") if auth_user else None) or (body.userEmail.strip().lower() if body.userEmail else None)
    user = None
    if effective_email:
        user = await db.user.find_unique(where={"email": effective_email})
    if not user:
        user = await db.user.find_first()
    user_id = user.id if user else None

    # Determine thumbnail
    thumb = body.thumbnail
    if not thumb and isinstance(body.resultJson, dict):
        prev = body.resultJson.get("previews", {})
        thumb = prev.get("overlay") or prev.get("calibrated") or prev.get("original")

    # Serialize resultJson cleanly
    result_str = ""
    if isinstance(body.resultJson, (dict, list)):
        result_str = json.dumps(body.resultJson)
    elif isinstance(body.resultJson, str):
        result_str = body.resultJson

    try:
        new_record = await db.record.create(
            data={
                "userId": user_id,
                "patientId": body.patientId or "",
                "woundLocation": body.woundLocation or "",
                "imageFilename": body.imageFilename or "",
                "estimatedAge": body.estimatedAge or "",
                "confidence": float(body.confidence or 0.0),
                "deltaE00": float(body.deltaE00 or 0.0),
                "surfaceAreaMm2": float(body.surfaceAreaMm2 or 0.0),
                "dominantHex": body.dominantHex or "",
                "summary": body.summary or "",
                "thumbnail": thumb or "",
                "resultJson": result_str
            }
        )
        return {
            "success": True,
            "id": str(new_record.id),
            "createdAt": new_record.createdAt.isoformat() if new_record.createdAt else ""
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to persist record: {str(e)}")


@app.delete("/api/records/{record_id}")
async def delete_record(record_id: int):
    if not db.is_connected():
        raise HTTPException(status_code=503, detail="Database service unavailable.")

    try:
        deleted = await db.record.delete(where={"id": record_id})
        return {"success": True, "id": str(deleted.id)}
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Record not found or delete failed: {str(e)}")


# -------------------------------------------------------------
# Profile & Clinician Information
# -------------------------------------------------------------

@app.get("/api/profile")
async def get_profile(
    email: Optional[str] = None,
    auth_user: Optional[dict] = Depends(get_current_user_optional)
):
    if not db.is_connected():
        raise HTTPException(status_code=503, detail="Database service unavailable.")

    lookup_email = (auth_user.get("email") if auth_user else None) or email or "demo@bruise.local"
    user = await db.user.find_unique(where={"email": lookup_email})
    if not user:
        user = await db.user.find_first()

    if not user:
        return {
            "name": "Demo Clinician",
            "email": "demo@bruise.local",
            "role": "Forensic Medical Specialist",
            "org": "Clinical Forensic Lab"
        }
    return {
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "org": user.org
    }


@app.put("/api/profile")
async def update_profile(
    body: ProfileUpdateRequest,
    auth_user: Optional[dict] = Depends(get_current_user_optional)
):
    if not db.is_connected():
        raise HTTPException(status_code=503, detail="Database service unavailable.")

    target_email = (auth_user.get("email") if auth_user else None) or body.email

    user = await db.user.upsert(
        where={"email": target_email},
        data={
            "create": {
                "name": body.name,
                "email": target_email,
                "role": body.role,
                "org": body.org
            },
            "update": {
                "name": body.name,
                "role": body.role,
                "org": body.org
            }
        }
    )
    return {"success": True, "user": {"name": user.name, "email": user.email, "role": user.role, "org": user.org}}


# Serve React production build
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
