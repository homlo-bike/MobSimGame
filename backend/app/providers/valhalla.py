"""Street routing for bus and BRT lines with a self-hosted Valhalla server.

Valhalla (MIT licence, https://github.com/valhalla/valhalla) runs as an
optional Compose service built from regional OpenStreetMap extracts. Each leg
between two consecutive waypoints is routed separately with the "bus" costing
model, so one unroutable leg does not hide the others. Waypoints go only to
this operator-run server, never to a third party.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any

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
    TTLCache,
    expires_iso,
    fetch_with_retry,
    now_iso,
)

log = get_logger(__name__)

# Valhalla error codes that mean "no route between these points" rather than a server fault.
NO_ROUTE_CODES = {170, 171, 442, 443}


class RoutedLeg(BaseModel):
    status: str  # "routed" or "failed"
    coordinates: list[tuple[float, float]]
    lengthM: float | None
    durationS: float | None
    message: str


def decode_polyline6(encoded: str) -> list[tuple[float, float]]:
    """Decode a Valhalla polyline (precision 6) into [lon, lat] pairs."""
    coords: list[tuple[float, float]] = []
    index = lat = lon = 0
    while index < len(encoded):
        for is_lat in (True, False):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lat:
                lat += delta
            else:
                lon += delta
        coords.append((lon / 1e6, lat / 1e6))
    return coords


class ValhallaRoutingProvider:
    id = "valhalla"
    kind = "routing"
    label = "Valhalla street routing (self-hosted)"
    sends_project_data_to_third_party = False

    def __init__(self, settings: Settings, client: httpx.AsyncClient, cache: TTLCache) -> None:
        self.settings = settings
        self.client = client
        self.cache = cache

    def capability(self) -> Capability:
        if not self.settings.valhalla_url:
            return Capability(
                state=CapabilityState.not_configured,
                message="Start the 'routing' Compose profile and set MOBSIM_VALHALLA_URL",
            )
        return Capability(state=CapabilityState.available, message="Self-hosted; coverage = loaded OSM extracts")

    def provenance(self) -> Provenance:
        return Provenance(
            provider="Valhalla (self-hosted)",
            dataset="OpenStreetMap regional extract loaded by the operator",
            sourceUrl="https://github.com/valhalla/valhalla",
            license="ODbL 1.0 (map data); Valhalla software MIT",
            attribution="© OpenStreetMap contributors",
            retrievedAt=now_iso(),
            coverage="Regions of the extracts loaded into this server",
            datasetDate=None,
            spatialResolution="Street network",
            status="calculated",
            limitations=[
                "Routes use Valhalla's bus costing on OSM tags; vehicle length, height and turning space"
                " are not checked.",
                "Bus lanes, bus gates and temporary closures are only reflected as far as they are tagged in OSM.",
                "The extract may be older than current OSM data.",
            ],
            cacheExpiresAt=expires_iso(self.settings.routing_cache_ttl_s),
            confidence="medium",
        )

    async def _leg(self, a: tuple[float, float], b: tuple[float, float], kerbside: bool = False) -> RoutedLeg:
        key = hashlib.sha256(json.dumps([a, b, kerbside]).encode()).hexdigest()
        cached = self.cache.get(key)
        if isinstance(cached, RoutedLeg):
            return cached
        locations: list[dict[str, Any]] = [
            {"lon": a[0], "lat": a[1], "type": "break"},
            {"lon": b[0], "lat": b[1], "type": "break"},
        ]
        if kerbside:
            # Stops sit at the kerb: leave and arrive with the stop on the side the vehicle drives on.
            for loc in locations:
                loc["preferred_side"] = "same"
        body: dict[str, Any] = {
            "locations": locations,
            "costing": "bus",
            "directions_type": "none",
            "units": "kilometers",
        }
        base = (self.settings.valhalla_url or "").rstrip("/")
        res = await fetch_with_retry(
            self.client,
            "POST",
            f"{base}/route",
            self.settings,
            json=body,
            timeout=self.settings.valhalla_timeout_s,
            retries=1,
            internal_base=base,
        )
        if res.status_code == 400:
            data = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
            code = data.get("error_code")
            if code in NO_ROUTE_CODES or code is None:
                leg = RoutedLeg(
                    status="failed",
                    coordinates=[a, b],
                    lengthM=None,
                    durationS=None,
                    message=str(data.get("error") or "No route found between these waypoints"),
                )
                self.cache.set(key, leg, 3600)
                return leg
        if res.status_code != 200:
            raise ProviderError(
                f"Routing server returned HTTP {res.status_code}", CapabilityState.temporarily_unavailable
            )
        trip = res.json().get("trip") or {}
        coords: list[tuple[float, float]] = []
        for leg_data in trip.get("legs") or []:
            shape = decode_polyline6(str(leg_data.get("shape", "")))
            coords.extend(shape if not coords else shape[1:])
        summary = trip.get("summary") or {}
        if len(coords) < 2:
            raise ProviderError("Routing server returned no geometry", CapabilityState.temporarily_unavailable)
        leg = RoutedLeg(
            status="routed",
            coordinates=coords,
            lengthM=float(summary.get("length", 0)) * 1000,
            durationS=float(summary.get("time", 0)),
            message="",
        )
        self.cache.set(key, leg, self.settings.routing_cache_ttl_s)
        return leg

    async def route_legs(
        self, waypoints: list[tuple[float, float]], kerbside: bool = False
    ) -> ProviderResponse[list[RoutedLeg]]:
        if not self.settings.valhalla_url:
            raise ProviderError("Street routing is not configured", CapabilityState.not_configured)
        if not 2 <= len(waypoints) <= self.settings.routing_max_waypoints:
            raise ProviderError(
                f"Between 2 and {self.settings.routing_max_waypoints} waypoints are needed",
                CapabilityState.manual_input_required,
                422,
            )
        # A few legs at a time: the router is shared by every user of this deployment.
        sem = asyncio.Semaphore(4)

        async def one(i: int) -> RoutedLeg:
            async with sem:
                return await self._leg(waypoints[i], waypoints[i + 1], kerbside)

        legs = await asyncio.gather(*(one(i) for i in range(len(waypoints) - 1)))
        log.info(
            "route computed",
            extra={"legs": len(legs), "failed": sum(1 for x in legs if x.status != "routed")},
        )
        return ProviderResponse(
            data=list(legs),
            provenance=self.provenance(),
            capability=Capability(state=CapabilityState.available, message="Routed on the street network"),
        )
