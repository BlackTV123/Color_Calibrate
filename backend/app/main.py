import json
import asyncio
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
    clientRecordId: Optional[str] = Field(default=None, min_length=1, max_length=80)
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
    """Validate signed claims and the account before restoring a browser session."""
    await record_owner(user_claims)
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

async def record_owner(auth_user: dict):
    """Resolve the account from signed claims; request email never selects an owner."""
    if not db.is_connected():
        raise HTTPException(status_code=503, detail="Database service unavailable.")
    try:
        user_id = int(auth_user["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid account identity.")
    user = await db.user.find_unique(where={"id": user_id})
    if not user or user.email.strip().lower() != str(auth_user.get("email", "")).strip().lower():
        raise HTTPException(status_code=401, detail="Account is no longer available.")
    return user


def record_response(record) -> dict:
    result = {}
    if record.resultJson:
        try:
            parsed = json.loads(record.resultJson)
            if isinstance(parsed, dict):
                result = parsed
        except (ValueError, TypeError):
            pass
    previews = result.get("previews") or {}
    thumbnail = record.thumbnail or previews.get("overlay") or previews.get("calibrated") or previews.get("original")
    return {
        "id": str(record.id), "patientId": record.patientId,
        "woundLocation": record.woundLocation, "imageFilename": record.imageFilename,
        "estimatedAge": record.estimatedAge, "confidence": record.confidence,
        "deltaE00": record.deltaE00, "surfaceAreaMm2": record.surfaceAreaMm2,
        "dominantHex": record.dominantHex, "summary": record.summary,
        "thumbnail": thumbnail,
        "createdAt": record.createdAt.isoformat() if record.createdAt else "",
        "resultJson": result,
    }


@app.get("/api/records")
async def list_records(
    userEmail: Optional[str] = Query(None, description="Deprecated; owner comes from authentication"),
    auth_user: dict = Depends(get_current_user_required),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: Optional[str] = None,
):
    user = await record_owner(auth_user)
    where_filter = {"userId": user.id}
    if search:
        where_filter = {"AND": [
            {"userId": user.id},
            {"OR": [
                {"patientId": {"contains": search}},
                {"woundLocation": {"contains": search}},
                {"summary": {"contains": search}},
            ]},
        ]}
    try:
        records = await db.record.find_many(
            where=where_filter, order={"createdAt": "desc"}, take=limit, skip=offset
        )
        total = await db.record.count(where=where_filter)
        return {"total": total, "records": [record_response(record) for record in records]}
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load records.")


@app.get("/api/records/{record_id}")
async def get_record(record_id: int, auth_user: dict = Depends(get_current_user_required)):
    user = await record_owner(auth_user)
    record = await db.record.find_first(where={"id": record_id, "userId": user.id})
    if not record:
        raise HTTPException(status_code=404, detail="Record not found.")
    return record_response(record)


_record_create_lock = asyncio.Lock()


@app.post("/api/records", status_code=status.HTTP_201_CREATED)
async def create_record(
    body: RecordCreateRequest,
    auth_user: dict = Depends(get_current_user_required),
):
    user = await record_owner(auth_user)
    result_payload = body.resultJson
    if isinstance(result_payload, str):
        try:
            result_payload = json.loads(result_payload)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid analysis result JSON.")
    if not isinstance(result_payload, dict):
        raise HTTPException(status_code=422, detail="Analysis result must be an object.")
    result_payload = dict(result_payload)
    if body.clientRecordId:
        result_payload["_client_record_id"] = body.clientRecordId
    else:
        result_payload.pop("_client_record_id", None)
    previews = result_payload.get("previews") or {}
    thumb = body.thumbnail or previews.get("overlay") or previews.get("calibrated") or previews.get("original")
    try:
        # Retrying an offline save reuses its client ID, including after a lost response.
        async with _record_create_lock:
            existing = None
            if body.clientRecordId:
                marker = '"_client_record_id": ' + json.dumps(body.clientRecordId)
                existing = await db.record.find_first(where={
                    "userId": user.id, "resultJson": {"contains": marker}
                })
            record = existing or await db.record.create(data={
                "userId": user.id, "patientId": body.patientId or "",
                "woundLocation": body.woundLocation or "",
                "imageFilename": body.imageFilename or "",
                "estimatedAge": body.estimatedAge or "",
                "confidence": float(body.confidence or 0),
                "deltaE00": float(body.deltaE00 or 0),
                "surfaceAreaMm2": float(body.surfaceAreaMm2 or 0),
                "dominantHex": body.dominantHex or "",
                "summary": body.summary or "", "thumbnail": thumb or "",
                "resultJson": json.dumps(result_payload, ensure_ascii=False, allow_nan=False),
            })
        return {
            "success": True, "id": str(record.id),
            "createdAt": record.createdAt.isoformat() if record.createdAt else "",
        }
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to persist record.")


@app.delete("/api/records/{record_id}")
async def delete_record(record_id: int, auth_user: dict = Depends(get_current_user_required)):
    user = await record_owner(auth_user)
    try:
        count = await db.record.delete_many(where={"id": record_id, "userId": user.id})
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to delete record.")
    if not count:
        raise HTTPException(status_code=404, detail="Record not found.")
    return {"success": True, "id": str(record_id)}


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
