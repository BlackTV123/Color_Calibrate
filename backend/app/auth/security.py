import hashlib
import hmac
import os
import re
import secrets
from pathlib import Path
from typing import Any, Dict

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from dotenv import load_dotenv

from app.auth.state import register_session

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
JWT_SECRET = os.getenv("JWT_SECRET", "")
if len(JWT_SECRET.encode("utf-8")) < 32 or JWT_SECRET.startswith("REPLACE_"):
    raise RuntimeError("JWT_SECRET must be configured with at least 32 random bytes; see backend/.env.example")
JWT_ALGORITHM = "HS256"
JWT_ISSUER = "bruise-calibrate-api"
JWT_AUDIENCE = "bruise-web"
DEFAULT_EXPIRY_SECONDS = 8 * 3600
COOKIE_NAME = "bcc_session_v2"
AUTH_ENV = os.getenv("AUTH_ENV", "development")
if AUTH_ENV not in {"development", "production"}:
    raise RuntimeError("AUTH_ENV must be development or production")
COOKIE_SECURE = AUTH_ENV == "production"
PASSWORD_MAX_LENGTH = 128
_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
_dummy_hash = _hasher.hash(secrets.token_urlsafe(32))

def hash_password(pwd: str) -> str:
    if not isinstance(pwd, str) or not 1 <= len(pwd) <= PASSWORD_MAX_LENGTH:
        raise ValueError("Invalid password length")
    return _hasher.hash(pwd)

def verify_password(plain_pwd: str, hashed_pwd: str) -> bool:
    if not isinstance(plain_pwd, str) or not 1 <= len(plain_pwd) <= PASSWORD_MAX_LENGTH:
        return False
    if not isinstance(hashed_pwd, str) or not hashed_pwd:
        _dummy_verify(plain_pwd)
        return False
    # Read-only compatibility for existing hashes; successful login immediately upgrades them.
    if re.fullmatch(r"[0-9a-f]{64}", hashed_pwd):
        legacy = hashlib.sha256((plain_pwd + "bcc_clinical_salt_2026").encode("utf-8")).hexdigest()
        valid = hmac.compare_digest(legacy, hashed_pwd)
        _dummy_verify(plain_pwd)
        return valid
    try:
        return _hasher.verify(hashed_pwd, plain_pwd)
    except (VerificationError, InvalidHashError):
        if not hashed_pwd.startswith("$argon2id$"):
            _dummy_verify(plain_pwd)
        return False

def _dummy_verify(pwd):
    try:
        _hasher.verify(_dummy_hash, pwd)
    except VerificationError:
        pass

def password_needs_upgrade(hashed_pwd):
    return not hashed_pwd.startswith("$argon2id$") or _hasher.check_needs_rehash(hashed_pwd)

def create_access_token(payload: Dict[str, Any], expires_in: int = DEFAULT_EXPIRY_SECONDS) -> str:
    import time
    now = int(time.time())
    claims = {k: payload[k] for k in ("sub", "email", "name", "role") if k in payload}
    claims.update(iat=now, exp=now+min(expires_in, DEFAULT_EXPIRY_SECONDS), iss=JWT_ISSUER,
                  aud=JWT_AUDIENCE, jti=secrets.token_urlsafe(32))
    token = jwt.encode(claims, JWT_SECRET, algorithm=JWT_ALGORITHM)
    register_session(claims)
    return token

def decode_access_token(token: str) -> Dict[str, Any]:
    if not isinstance(token, str) or len(token) > 4096:
        raise ValueError("Invalid session")
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], issuer=JWT_ISSUER,
                            audience=JWT_AUDIENCE,
                            options={"require": ["exp", "iat", "iss", "aud", "sub", "email", "jti"]})
        if (not isinstance(claims["sub"], str) or not claims["sub"].isdigit()
            or int(claims["sub"]) < 1 or not isinstance(claims["email"], str)
            or not 1 <= len(claims["email"]) <= 254 or not isinstance(claims["jti"], str)
            or len(claims["jti"]) < 32 or type(claims["exp"]) is not int
            or type(claims["iat"]) is not int or claims["exp"]-claims["iat"] > DEFAULT_EXPIRY_SECONDS):
            raise ValueError("Invalid session")
        return claims
    except (jwt.PyJWTError, TypeError, KeyError, ValueError) as exc:
        raise ValueError("Invalid or expired session") from exc
