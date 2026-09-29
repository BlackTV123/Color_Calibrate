import os
import time
import json
import hmac
import hashlib
import base64
from typing import Dict, Any

JWT_SECRET = os.getenv("JWT_SECRET", "bcc_clinical_jwt_secret_key_2026_forensic_secure")
JWT_ALGORITHM = "HS256"
DEFAULT_EXPIRY_SECONDS = 86400 * 3  # 3 days token validity


def base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def base64url_decode(s: str) -> bytes:
    padding = "=" * (4 - (len(s) % 4)) if (len(s) % 4) != 0 else ""
    return base64.urlsafe_b64decode(s + padding)


def hash_password(pwd: str) -> str:
    """Hash password using SHA-256 with clinical cryptographic salt."""
    salt = "bcc_clinical_salt_2026"
    return hashlib.sha256((pwd + salt).encode("utf-8")).hexdigest()


def verify_password(plain_pwd: str, hashed_pwd: str) -> bool:
    """Safely compare password hashes in constant time."""
    return hmac.compare_digest(hash_password(plain_pwd), hashed_pwd)


def create_access_token(payload: Dict[str, Any], expires_in: int = DEFAULT_EXPIRY_SECONDS) -> str:
    """Generate an RFC 7519 HS256 JSON Web Token."""
    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}
    now = int(time.time())
    claims = {
        **payload,
        "iat": now,
        "exp": now + expires_in,
        "iss": "bruise-calibrate-api"
    }

    header_b64 = base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = base64url_encode(json.dumps(claims, separators=(",", ":")).encode("utf-8"))
    message = f"{header_b64}.{payload_b64}".encode("utf-8")

    signature = hmac.new(JWT_SECRET.encode("utf-8"), message, hashlib.sha256).digest()
    signature_b64 = base64url_encode(signature)

    return f"{header_b64}.{payload_b64}.{signature_b64}"


def decode_access_token(token: str) -> Dict[str, Any]:
    """Verify signature and expiration of an HS256 JWT."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT format")

    header_b64, payload_b64, signature_b64 = parts
    message = f"{header_b64}.{payload_b64}".encode("utf-8")
    expected_sig = hmac.new(JWT_SECRET.encode("utf-8"), message, hashlib.sha256).digest()
    expected_sig_b64 = base64url_encode(expected_sig)

    if not hmac.compare_digest(signature_b64, expected_sig_b64):
        raise ValueError("Invalid token signature")

    claims = json.loads(base64url_decode(payload_b64).decode("utf-8"))

    # Check expiration
    if "exp" in claims and time.time() > claims["exp"]:
        raise ValueError("Token has expired")

    return claims
