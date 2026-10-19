"""transport.rest adapter (community-run HAFAS wrappers, e.g. v6.db.transport.rest).

transport.rest describes itself as publicly available and run by volunteers;
rate limits, SLA and coverage beyond each listed network were not verified, so
the adapter is opt-in (MOBSIM_TRANSPORT_REST_ENABLED) and coverage is limited to
the configured network (e.g. Deutsche Bahn for v6.db).
"""

from __future__ import annotations

import httpx
from pydantic import BaseModel

from ..config import Settings
from .base import (
    Capability,
    CapabilityState,
    Provenance,
    ProviderError,
    ProviderResponse,
    fetch_with_retry,
    now_iso,
)


class TransitStop(BaseModel):
    id: str
    name: str
    position: tuple[float, float]
    modes: list[str]


class TransportRestProvider:
    id = "transport-rest"
    kind = "transit"
    label = "transport.rest (HAFAS)"
    sends_project_data_to_third_party = True

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.client = client

    def capability(self) -> Capability:
        if not self.settings.transport_rest_enabled:
            return Capability(state=CapabilityState.not_configured, message="Opt-in; coverage limited to one network")
        return Capability(
            state=CapabilityState.available,
            message=f"Coverage: network of {self.settings.transport_rest_url}",
        )

    async def stops_near(self, lon: float, lat: float, results: int = 10) -> ProviderResponse[list[TransitStop]]:
        if not self.settings.transport_rest_enabled:
            raise ProviderError("transport.rest disabled", CapabilityState.not_configured)
        res = await fetch_with_retry(
            self.client,
            "GET",
            f"{self.settings.transport_rest_url.rstrip('/')}/locations/nearby",
            self.settings,
            params={"latitude": lat, "longitude": lon, "results": max(1, min(results, 30))},
            timeout=15,
            retries=1,
        )
        if res.status_code != 200:
            raise ProviderError(
                f"transport.rest returned HTTP {res.status_code}", CapabilityState.temporarily_unavailable
            )
        stops = []
        for item in res.json():
            loc = item.get("location") or {}
            if "longitude" not in loc:
                continue
            products = item.get("products") or {}
            stops.append(
                TransitStop(
                    id=str(item.get("id")),
                    name=str(item.get("name")),
                    position=(float(loc["longitude"]), float(loc["latitude"])),
                    modes=[k for k, v in products.items() if v],
                )
            )
        return ProviderResponse[list[TransitStop]](
            data=stops,
            provenance=Provenance(
                provider=f"transport.rest ({self.settings.transport_rest_url})",
                dataset="Operator timetable data via HAFAS",
                sourceUrl="https://transport.rest/",
                license="See transport.rest and the operator's terms",
                attribution="Public transport data via transport.rest",
                retrievedAt=now_iso(),
                coverage="The configured network only",
                datasetDate=None,
                spatialResolution=None,
                status="observed",
                limitations=["Community-run service without SLA; do not assume global coverage."],
                cacheExpiresAt=None,
                confidence="medium",
            ),
            capability=self.capability(),
        )
