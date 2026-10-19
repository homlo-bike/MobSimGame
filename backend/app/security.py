"""HTTP hardening: security headers, request-size limit, rate limiting, SSRF guard."""

from __future__ import annotations

import hashlib
import ipaddress
import socket
import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from urllib.parse import urlparse

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

# The API serves JSON (and one self-contained HTML report); nothing needs scripts.
API_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'"

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": API_CSP,
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        return response


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        length = request.headers.get("content-length")
        if length is not None:
            try:
                if int(length) > self.max_bytes:
                    return JSONResponse({"detail": "Request body too large"}, status_code=413)
            except ValueError:
                return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
        elif request.method in ("POST", "PUT", "PATCH"):
            body = await request.body()
            if len(body) > self.max_bytes:
                return JSONResponse({"detail": "Request body too large"}, status_code=413)
        return await call_next(request)


class RateLimiter:
    """Sliding-window limiter keyed by client. In-memory: one process only.

    For multi-worker deployments put a shared limiter (reverse proxy or Redis) in
    front; documented in docs/SELF_HOSTING.md.
    """

    def __init__(self, per_minute: int) -> None:
        self.per_minute = per_minute
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, now: float | None = None) -> bool:
        t = time.monotonic() if now is None else now
        q = self.hits[key]
        while q and t - q[0] > 60:
            q.popleft()
        if len(q) >= self.per_minute:
            return False
        q.append(t)
        return True


def client_key(request: Request) -> str:
    """Hashed client address: rate limiting and audit logs never store raw IPs."""
    host = request.client.host if request.client else "unknown"
    return hashlib.sha256(host.encode()).hexdigest()[:16]


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, per_minute: int) -> None:
        super().__init__(app)
        self.limiter = RateLimiter(per_minute)

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if request.url.path.startswith("/api/health"):
            return await call_next(request)
        if not self.limiter.allow(client_key(request)):
            return JSONResponse({"detail": "Rate limit reached"}, status_code=429, headers={"Retry-After": "60"})
        return await call_next(request)


class OutboundUrlError(ValueError):
    pass


def check_outbound_url(url: str, allowlist: list[str], resolve: bool = True) -> None:
    """Reject URLs that are not https, not allowlisted, or resolve to private addresses."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise OutboundUrlError("Only https URLs are allowed")
    host = parsed.hostname
    if not host or host not in allowlist:
        raise OutboundUrlError(f"Host {host!r} is not allowlisted")
    if parsed.username or parsed.password:
        raise OutboundUrlError("Credentials in URLs are not allowed")
    if resolve:
        try:
            infos = socket.getaddrinfo(host, parsed.port or 443, proto=socket.IPPROTO_TCP)
        except socket.gaierror as e:
            raise OutboundUrlError(f"Cannot resolve {host}") from e
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                raise OutboundUrlError(f"{host} resolves to a non-public address")
