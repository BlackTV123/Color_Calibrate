import time
from collections import defaultdict
from typing import Dict, List
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse

# In-memory IP tracking: ip -> list of timestamps
_request_records: Dict[str, List[float]] = defaultdict(list)

# Rate limit policies (max_requests, window_seconds)
RATE_LIMITS = {
    "/api/auth/login": (15, 60),      # Max 15 login attempts per minute per IP (prevents brute-force)
    "/api/auth/register": (10, 60),   # Max 10 account creations per minute per IP
    "/api/analyze": (30, 60),         # Max 30 image computations per minute per IP (prevents CPU exhaustion)
    "default_api": (150, 60),         # Max 150 general API requests per minute per IP
}


class RateLimiterMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only rate limit /api endpoints
        path = request.url.path
        if not path.startswith("/api"):
            return await call_next(request)

        # Get client IP (support reverse-proxy headers like X-Forwarded-For)
        forwarded = request.headers.get("x-forwarded-for")
        client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "127.0.0.1")

        # Determine rate limit bucket
        limit, window = RATE_LIMITS.get(path, RATE_LIMITS["default_api"])
        bucket_key = f"{client_ip}:{path if path in RATE_LIMITS else 'default_api'}"

        now = time.time()
        # Clean older requests outside the sliding window
        window_start = now - window
        _request_records[bucket_key] = [t for t in _request_records[bucket_key] if t > window_start]

        if len(_request_records[bucket_key]) >= limit:
            retry_after = int(window - (now - _request_records[bucket_key][0]))
            return JSONResponse(
                status_code=429,
                content={
                    "error": "Too Many Requests",
                    "detail": f"Rate limit exceeded ({limit} req/{window}s). Please slow down.",
                    "retry_after_seconds": max(1, retry_after)
                },
                headers={
                    "Retry-After": str(max(1, retry_after)),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0"
                }
            )

        _request_records[bucket_key].append(now)
        response: Response = await call_next(request)

        # Attach rate limit remaining headers
        remaining = max(0, limit - len(_request_records[bucket_key]))
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response


class CacheControlAndSecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        path = request.url.path

        # 1. API routes: Sensitive medical & clinical data must never be cached on shared proxies
        if path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
        # 2. Static assets (JS, CSS, SVGs, Fonts): aggressive caching for ultra-fast page load
        elif any(path.endswith(ext) for ext in [".js", ".css", ".svg", ".png", ".jpg", ".webp", ".woff2", ".ico"]):
            response.headers["Cache-Control"] = "public, max-age=86400, stale-while-revalidate=3600"
        # 3. HTML pages: revalidate to ensure latest version is picked up
        else:
            response.headers["Cache-Control"] = "no-cache"

        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"

        return response
