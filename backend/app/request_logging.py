"""Per-request logging with a request id.

Each request is logged once when it completes: method, path (never the query
string, which can hold search text or coordinates), status, duration and client
hash. The id is returned in ``X-Request-ID`` and accepted from a trusted proxy if
it looks like an id. Severity: 5xx and unhandled exceptions → error; 413/429 →
warning; health checks → debug; everything else → info.
"""

from __future__ import annotations

import re
import secrets
import time
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from .logging_config import get_logger
from .security import client_key

log = get_logger("request")

_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if _REQUEST_ID.match(incoming) else secrets.token_hex(8)
        request.state.request_id = request_id
        start = time.perf_counter()
        fields: dict[str, object] = {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "client": client_key(request),
        }
        try:
            response = await call_next(request)
        except Exception:
            log.error(
                "request failed with an unhandled exception",
                exc_info=True,
                extra={**fields, "duration_ms": round((time.perf_counter() - start) * 1000, 1)},
            )
            raise
        fields.update(status=response.status_code, duration_ms=round((time.perf_counter() - start) * 1000, 1))
        response.headers["X-Request-ID"] = request_id
        if response.status_code >= 500:
            log.error("request handled", extra=fields)
        elif response.status_code in (413, 429):
            log.warning("request rejected", extra=fields)
        elif request.url.path.startswith("/api/health"):
            log.debug("request handled", extra=fields)
        else:
            log.info("request handled", extra=fields)
        return response
