from typing import Optional, Dict, Any
from fastapi import Request, HTTPException
from fastapi.concurrency import run_in_threadpool
from app.auth.security import COOKIE_NAME, decode_access_token
from app.auth.state import validate_session

async def get_current_user_optional(request: Request) -> Optional[Dict[str, Any]]:
    authorization = request.headers.get("authorization", "")
    token = authorization[7:] if authorization.startswith("Bearer ") else request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        claims = decode_access_token(token)
        return claims if await run_in_threadpool(validate_session, claims) else None
    except ValueError:
        return None

async def get_current_user_required(request: Request) -> Dict[str, Any]:
    claims = await get_current_user_optional(request)
    if claims is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session",
                            headers={"WWW-Authenticate": "Bearer"})
    return claims
