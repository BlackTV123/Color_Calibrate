from typing import Optional, Dict, Any
from fastapi import Header, HTTPException, status
from app.auth.security import decode_access_token


async def get_current_user_optional(authorization: Optional[str] = Header(None)) -> Optional[Dict[str, Any]]:
    """Optional auth dependency: returns user claims if valid Bearer token provided, else None."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:].strip()
    try:
        claims = decode_access_token(token)
        return claims
    except Exception:
        return None


async def get_current_user_required(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Strict auth dependency: raises 401 Unauthorized if Bearer token is missing or invalid."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header (Bearer token required)",
            headers={"WWW-Authenticate": "Bearer"}
        )
    token = authorization[7:].strip()
    try:
        claims = decode_access_token(token)
        return claims
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"}
        )
