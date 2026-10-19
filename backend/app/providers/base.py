"""Provider contracts shared by every backend data provider.

Every response carries Provenance. Capability states mirror the frontend's
`CapabilityState` so the UI can show the same labels.
"""

from __future__ import annotations

import asyncio
import random
import time
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Generic, Literal, TypeVar

import httpx
from pydantic import BaseModel, Field

from ..config import Settings
from ..security import OutboundUrlError, check_outbound_url

T = TypeVar("T")


class CapabilityState(StrEnum):
    available = "available"
    authentication_required = "authentication_required"
    coverage_unavailable = "coverage_unavailable"
    rate_limited = "rate_limited"
    temporarily_unavailable = "temporarily_unavailable"
    using_cache = "using_cache"
    using_fallback = "using_fallback"
    manual_input_required = "manual_input_required"
    not_configured = "not_configured"
    demonstration = "demonstration"


class Capability(BaseModel):
    state: CapabilityState
    message: str
    checkedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


DataStatus = Literal["observed", "modelled", "assumed", "calculated", "demonstration"]


class Provenance(BaseModel):
    provider: str
    dataset: str
    sourceUrl: str | None
    license: str
    attribution: str
    retrievedAt: str | None
    coverage: str
    datasetDate: str | None
    spatialResolution: str | None
    status: DataStatus
    limitations: list[str]
    cacheExpiresAt: str | None
    confidence: Literal["high", "medium", "low", "unknown"]


class ProviderResponse(BaseModel, Generic[T]):
    data: T
    provenance: Provenance
    capability: Capability


class ProviderError(Exception):
    def __init__(self, message: str, state: CapabilityState, status_code: int = 503) -> None:
        super().__init__(message)
        self.state = state
        self.status_code = status_code


class TTLCache:
    """Small in-process cache. Replace with Redis when running several workers."""

    def __init__(self, max_items: int = 2000) -> None:
        self.max_items = max_items
        self._data: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        item = self._data.get(key)
        if not item:
            return None
        expires, value = item
        if expires < time.monotonic():
            self._data.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any, ttl_s: float) -> None:
        if len(self._data) >= self.max_items:
            # Drop the entry that expires soonest.
            oldest = min(self._data, key=lambda k: self._data[k][0])
            self._data.pop(oldest, None)
        self._data[key] = (time.monotonic() + ttl_s, value)


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def expires_iso(ttl_s: float) -> str:
    return (datetime.now(UTC) + timedelta(seconds=ttl_s)).isoformat()


async def fetch_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    settings: Settings,
    *,
    retries: int = 3,
    base_delay_s: float = 1.0,
    **kwargs: Any,
) -> httpx.Response:
    """Outbound request with allowlist check, timeout and exponential backoff.

    Retries on network errors, 429 and 5xx. 429 honours Retry-After (capped).
    """
    try:
        check_outbound_url(url, settings.outbound_allowlist, resolve=settings.outbound_dns_check)
    except OutboundUrlError as e:
        raise ProviderError(str(e), CapabilityState.not_configured, 502) from e
    headers = {"User-Agent": settings.user_agent, **kwargs.pop("headers", {})}
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            res = await client.request(method, url, headers=headers, **kwargs)
        except httpx.TimeoutException as e:
            last = e
        except httpx.TransportError as e:
            last = e
        else:
            if res.status_code == 429:
                if attempt == retries:
                    raise ProviderError("Upstream rate limit reached", CapabilityState.rate_limited, 429)
                retry_after = res.headers.get("retry-after", "")
                delay = min(30.0, float(retry_after)) if retry_after.isdigit() else base_delay_s * 2**attempt
                await asyncio.sleep(delay)
                continue
            if res.status_code in (401, 403):
                raise ProviderError("Upstream requires authentication", CapabilityState.authentication_required, 502)
            if res.status_code >= 500:
                last = ProviderError(f"Upstream error {res.status_code}", CapabilityState.temporarily_unavailable)
            else:
                return res
        if attempt < retries:
            await asyncio.sleep(base_delay_s * 2**attempt + random.uniform(0, base_delay_s / 2))  # noqa: S311
    raise ProviderError(
        f"Provider temporarily unavailable ({type(last).__name__ if last else 'error'})",
        CapabilityState.temporarily_unavailable,
    )
