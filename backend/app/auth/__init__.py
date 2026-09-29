"""
Clinical Authentication and Authorization Module.
Provides RFC 7519 HS256 JWT tokens, salted password hashing, and FastAPI dependencies.
"""

from app.auth.security import (
    JWT_SECRET,
    JWT_ALGORITHM,
    DEFAULT_EXPIRY_SECONDS,
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
)
from app.auth.dependencies import (
    get_current_user_required,
    get_current_user_optional,
)

__all__ = [
    "JWT_SECRET",
    "JWT_ALGORITHM",
    "DEFAULT_EXPIRY_SECONDS",
    "hash_password",
    "verify_password",
    "create_access_token",
    "decode_access_token",
    "get_current_user_required",
    "get_current_user_optional",
]
