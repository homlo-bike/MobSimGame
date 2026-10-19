"""Geocoding with Nominatim, following the OSMF usage policy:
at most one request per second (enforced process-wide here), an identifying
User-Agent, cached results, and no autocomplete (search on submit only).
"""

from __future__ import annotations

import asyncio
import time

import httpx
from pydantic import BaseModel

from ..config import Settings
from .base import (
    Capability,
    CapabilityState,
    Provenance,
    ProviderError,
    ProviderResponse,
    TTLCache,
    expires_iso,
    fetch_with_retry,
    now_iso,
)


class GeocodeResult(BaseModel):
    label: str
    position: tuple[float, float]
    bbox: tuple[float, float, float, float] | None


class NominatimProvider:
    id = "nominatim"
    kind = "geocoder"
    label = "Nominatim (OpenStreetMap)"
    sends_project_data_to_third_party = True

    def __init__(self, settings: Settings, client: httpx.AsyncClient, cache: TTLCache | None = None) -> None:
        self.settings = settings
        self.client = client
        self.cache = cache or TTLCache()
        self._lock = asyncio.Lock()
        self._last = 0.0

    def capability(self) -> Capability:
        if not self.settings.geocoder_enabled:
            return Capability(state=CapabilityState.not_configured, message="Geocoder disabled by configuration")
        return Capability(state=CapabilityState.available, message="Search on submit; max 1 request/s; cached")

    def _provenance(self) -> Provenance:
        return Provenance(
            provider="Nominatim",
            dataset="OpenStreetMap",
            sourceUrl="https://operations.osmfoundation.org/policies/nominatim/",
            license="ODbL-1.0",
            attribution="© OpenStreetMap contributors (ODbL)",
            retrievedAt=now_iso(),
            coverage="Global",
            datasetDate=None,
            spatialResolution=None,
            status="observed",
            limitations=["Geocoding quality varies; verify the location on the map."],
            cacheExpiresAt=expires_iso(self.settings.geocoder_cache_ttl_s),
            confidence="medium",
        )

    async def search(self, q: str) -> ProviderResponse[list[GeocodeResult]]:
        if not self.settings.geocoder_enabled:
            raise ProviderError("Geocoder disabled", CapabilityState.not_configured)
        query = " ".join(q.split())[:200]
        if len(query) < 2:
            raise ProviderError("Query too short", CapabilityState.manual_input_required, 400)
        key = query.lower()
        cached = self.cache.get(key)
        if cached is not None:
            return ProviderResponse[list[GeocodeResult]](
                data=cached,
                provenance=self._provenance(),
                capability=Capability(state=CapabilityState.using_cache, message="Using cached result"),
            )
        async with self._lock:
            wait = 1.0 - (time.monotonic() - self._last)
            if wait > 0:
                await asyncio.sleep(wait)
            params: dict[str, str | int] = {"q": query, "format": "jsonv2", "limit": 5}
            if self.settings.contact_email:
                params["email"] = self.settings.contact_email
            res = await fetch_with_retry(
                self.client,
                "GET",
                self.settings.nominatim_url,
                self.settings,
                params=params,
                timeout=15,
                retries=1,
            )
            self._last = time.monotonic()
        if res.status_code != 200:
            raise ProviderError(f"Geocoder returned HTTP {res.status_code}", CapabilityState.temporarily_unavailable)
        results: list[GeocodeResult] = []
        for item in res.json():
            bb = item.get("boundingbox")
            # Nominatim bbox is [south, north, west, east] as strings.
            bbox = (float(bb[2]), float(bb[0]), float(bb[3]), float(bb[1])) if bb and len(bb) == 4 else None
            results.append(
                GeocodeResult(
                    label=str(item.get("display_name", "")),
                    position=(float(item["lon"]), float(item["lat"])),
                    bbox=bbox,
                )
            )
        self.cache.set(key, results, self.settings.geocoder_cache_ttl_s)
        return ProviderResponse[list[GeocodeResult]](
            data=results, provenance=self._provenance(), capability=self.capability()
        )
