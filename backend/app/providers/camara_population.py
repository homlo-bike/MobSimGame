"""CAMARA Population Density Data adapter (GSMA Open Gateway).

Spec: https://github.com/camaraproject/PopulationDensityData (release r3.2,
API population-density-data v0.3, POST {apiRoot}/population-density-data/v0.3/retrieve).
Access is 2-legged OAuth client credentials, scope `population-density-data:read`.
There is no anonymous public endpoint: operators expose it under contract. The
adapter is disabled unless URL, token URL, client id and secret are configured.

Only aggregated, privacy-preserving cell densities are requested and returned.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import httpx
from pydantic import BaseModel

from ..config import Settings
from ..logging_config import get_logger
from .base import (
    Capability,
    CapabilityState,
    Provenance,
    ProviderError,
    ProviderResponse,
    fetch_with_retry,
    now_iso,
)

log = get_logger(__name__)

_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def geohash_bounds(gh: str) -> tuple[float, float, float, float]:
    """Decode a geohash to (west, south, east, north)."""
    lat = [-90.0, 90.0]
    lon = [-180.0, 180.0]
    even = True
    for ch in gh.lower():
        idx = _BASE32.index(ch)
        for bit in (16, 8, 4, 2, 1):
            rng = lon if even else lat
            mid = (rng[0] + rng[1]) / 2
            if idx & bit:
                rng[0] = mid
            else:
                rng[1] = mid
            even = not even
    return lon[0], lat[0], lon[1], lat[1]


class Density(BaseModel):
    low: float
    central: float
    high: float


class PopulationCell(BaseModel):
    cellId: str
    polygon: list[tuple[float, float]]
    density: Density | None
    dataType: Literal["no_data", "low_density", "density_estimation"]
    status: Literal["observed", "estimated", "projected", "assumed", "demonstration"]


def build_request(polygon: list[tuple[float, float]], start: datetime, end: datetime, precision: int) -> dict[str, Any]:
    if not 3 <= len(polygon) <= 15:
        raise ProviderError("CAMARA requires a polygon with 3 to 15 points", CapabilityState.manual_input_required, 400)
    if end - start > timedelta(days=7):
        raise ProviderError("CAMARA time window may not exceed 7 days", CapabilityState.manual_input_required, 400)
    if not 1 <= precision <= 12:
        raise ProviderError("precision must be 1..12", CapabilityState.manual_input_required, 400)
    return {
        "area": {
            "areaType": "POLYGON",
            # CAMARA uses {latitude, longitude} objects; our input is [lon, lat].
            "boundary": [{"latitude": lat, "longitude": lon} for lon, lat in polygon],
        },
        "startTime": start.astimezone(UTC).isoformat(),
        "endTime": end.astimezone(UTC).isoformat(),
        "precision": precision,
    }


def parse_response(body: dict[str, Any]) -> list[PopulationCell]:
    status = body.get("status")
    if status == "AREA_NOT_SUPPORTED":
        raise ProviderError("Area not covered by the operator", CapabilityState.coverage_unavailable, 404)
    if status == "OPERATION_NOT_COMPLETED":
        raise ProviderError("Operator could not complete the request", CapabilityState.temporarily_unavailable)
    cells: list[PopulationCell] = []
    for window in body.get("timedPopulationDensityData", [])[:1]:
        for c in window.get("cellPopulationDensityData", []):
            gh = str(c["geohash"])
            w, s, e, n = geohash_bounds(gh)
            dt = c.get("dataType")
            density = None
            if dt == "DENSITY_ESTIMATION":
                density = Density(
                    low=float(c["minPplDensity"]),
                    central=float(c["pplDensity"]),
                    high=float(c["maxPplDensity"]),
                )
            cells.append(
                PopulationCell(
                    cellId=gh,
                    polygon=[(w, s), (e, s), (e, n), (w, n), (w, s)],
                    density=density,
                    dataType="density_estimation"
                    if dt == "DENSITY_ESTIMATION"
                    else "low_density"
                    if dt == "LOW_DENSITY"
                    else "no_data",
                    status="estimated",
                )
            )
    return cells


class CamaraPopulationProvider:
    id = "camara-population"
    kind = "population"
    label = "CAMARA Population Density Data (operator API)"
    sends_project_data_to_third_party = True  # the query polygon is sent to the operator

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.client = client
        self._token: tuple[str, float] | None = None

    def capability(self) -> Capability:
        if not self.settings.camara_configured:
            return Capability(
                state=CapabilityState.not_configured,
                message="Requires an operator endpoint and OAuth client credentials (no public endpoint)",
            )
        return Capability(state=CapabilityState.available, message="Configured; coverage depends on the operator")

    async def _access_token(self) -> str:
        if self._token and self._token[1] > time.monotonic() + 30:
            return self._token[0]
        s = self.settings
        assert s.camara_token_url and s.camara_client_id and s.camara_client_secret
        res = await fetch_with_retry(
            self.client,
            "POST",
            s.camara_token_url,
            s,
            data={"grant_type": "client_credentials", "scope": "population-density-data:read"},
            auth=(s.camara_client_id, s.camara_client_secret.get_secret_value()),
            timeout=15,
            retries=1,
        )
        if res.status_code != 200:
            log.error("CAMARA token request failed", extra={"status": res.status_code})
            raise ProviderError("Token request failed", CapabilityState.authentication_required, 502)
        body = res.json()
        self._token = (str(body["access_token"]), time.monotonic() + float(body.get("expires_in", 300)))
        log.debug("CAMARA access token refreshed", extra={"expires_in_s": float(body.get("expires_in", 300))})
        return self._token[0]

    async def density(
        self, polygon: list[tuple[float, float]], start: datetime, end: datetime, precision: int = 7
    ) -> ProviderResponse[list[PopulationCell]]:
        if not self.settings.camara_configured:
            raise ProviderError("CAMARA provider not configured", CapabilityState.not_configured)
        payload = build_request(polygon, start, end, precision)
        token = await self._access_token()
        assert self.settings.camara_population_url
        res = await fetch_with_retry(
            self.client,
            "POST",
            f"{self.settings.camara_population_url.rstrip('/')}/retrieve",
            self.settings,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
            retries=1,
        )
        if res.status_code == 202:
            raise ProviderError(
                "Operator answered asynchronously (sink callbacks not supported yet)",
                CapabilityState.temporarily_unavailable,
            )
        if res.status_code != 200:
            raise ProviderError(f"Operator returned HTTP {res.status_code}", CapabilityState.temporarily_unavailable)
        cells = parse_response(res.json())
        log.info("CAMARA density retrieved", extra={"cells": len(cells), "precision": precision})
        partial = res.json().get("status") == "PART_OF_AREA_NOT_SUPPORTED"
        return ProviderResponse[list[PopulationCell]](
            data=cells,
            provenance=Provenance(
                provider=f"CAMARA Population Density Data ({self.settings.camara_population_url})",
                dataset="Operator population density estimate",
                sourceUrl="https://github.com/camaraproject/PopulationDensityData",
                license="Per operator contract",
                attribution="Population density: mobile network operator via CAMARA API",
                retrievedAt=now_iso(),
                coverage="Operator network coverage" + (" (part of the area not supported)" if partial else ""),
                datasetDate=f"{start.isoformat()} – {end.isoformat()}",
                spatialResolution=f"geohash precision {precision}",
                status="modelled",
                limitations=["Aggregated estimates (people/km²) with min/max bounds; not a census."],
                cacheExpiresAt=None,
                confidence="medium",
            ),
            capability=Capability(
                state=CapabilityState.using_fallback if partial else CapabilityState.available,
                message="Part of the area is not covered" if partial else "OK",
            ),
        )
