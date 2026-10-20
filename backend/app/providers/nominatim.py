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


class GeocodeResult(BaseModel):
    label: str
    position: tuple[float, float]
    bbox: tuple[float, float, float, float] | None
    #: Nominatim's address type, e.g. "city", "suburb", "neighbourhood".
    kind: str | None = None
    category: str | None = None
    osmType: str | None = None
    osmId: int | None = None
    #: Enclosing places, nearest first (from Nominatim's address details).
    hierarchy: list[str] = []
    #: True when the result is an OSM relation, which may carry a boundary polygon.
    boundaryAvailable: bool = False


class BoundaryResult(BaseModel):
    label: str
    osmType: str
    osmId: int
    #: GeoJSON Polygon or MultiPolygon; None when OSM has no polygon for the object.
    geometry: dict[str, object] | None


#: Address keys Nominatim returns, from small to large, used for the admin hierarchy.
_HIERARCHY_KEYS = (
    "neighbourhood",
    "quarter",
    "suburb",
    "city_district",
    "borough",
    "district",
    "village",
    "town",
    "city",
    "municipality",
    "county",
    "state_district",
    "state",
    "region",
    "country",
)
#: Nominatim's polygon_threshold, in degrees (Nominatim's unit). It keeps responses small;
#: the value is a choice of this project, not a standard, and is reported in provenance.
BOUNDARY_SIMPLIFY_DEG = 0.00005
_OSM_TYPE_PREFIX = {"node": "N", "way": "W", "relation": "R"}


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

    async def _get(self, url: str, params: dict[str, str | int | float]) -> httpx.Response:
        """One upstream request, at most one per second process-wide."""
        async with self._lock:
            wait = 1.0 - (time.monotonic() - self._last)
            if wait > 0:
                await asyncio.sleep(wait)
            if self.settings.contact_email:
                params["email"] = self.settings.contact_email
            res = await fetch_with_retry(self.client, "GET", url, self.settings, params=params, timeout=15, retries=1)
            self._last = time.monotonic()
        if res.status_code != 200:
            log.error("geocoder request failed", extra={"status": res.status_code})
            raise ProviderError(f"Geocoder returned HTTP {res.status_code}", CapabilityState.temporarily_unavailable)
        return res

    async def search(self, q: str, places_only: bool = False) -> ProviderResponse[list[GeocodeResult]]:
        if not self.settings.geocoder_enabled:
            raise ProviderError("Geocoder disabled", CapabilityState.not_configured)
        query = " ".join(q.split())[:200]
        if len(query) < 2:
            raise ProviderError("Query too short", CapabilityState.manual_input_required, 400)
        key = f"{'places:' if places_only else ''}{query.lower()}"
        cached = self.cache.get(key)
        if cached is not None:
            # The query text is user input: only its length is logged, never the text.
            log.debug("geocoder cache hit", extra={"query_length": len(query), "results": len(cached)})
            return ProviderResponse[list[GeocodeResult]](
                data=cached,
                provenance=self._provenance(),
                capability=Capability(state=CapabilityState.using_cache, message="Using cached result"),
            )
        params: dict[str, str | int | float] = {"q": query, "format": "jsonv2", "limit": 5, "addressdetails": 1}
        if places_only:
            # Cities, towns, villages, suburbs and neighbourhoods only.
            params["featureType"] = "settlement"
        res = await self._get(self.settings.nominatim_url, params)
        results: list[GeocodeResult] = []
        for item in res.json():
            bb = item.get("boundingbox")
            # Nominatim bbox is [south, north, west, east] as strings.
            bbox = (float(bb[2]), float(bb[0]), float(bb[3]), float(bb[1])) if bb and len(bb) == 4 else None
            address = item.get("address") or {}
            kind = item.get("addresstype")
            # The result's own name is the first address entry; list only the places around it.
            hierarchy = [str(address[k]) for k in _HIERARCHY_KEYS if k in address and k != kind]
            osm_type = item.get("osm_type")
            osm_id = item.get("osm_id")
            results.append(
                GeocodeResult(
                    label=str(item.get("display_name", "")),
                    position=(float(item["lon"]), float(item["lat"])),
                    bbox=bbox,
                    kind=str(kind) if kind else None,
                    category=str(item.get("category") or item.get("class") or "") or None,
                    osmType=str(osm_type) if osm_type else None,
                    osmId=int(osm_id) if osm_id is not None else None,
                    hierarchy=hierarchy,
                    boundaryAvailable=osm_type == "relation",
                )
            )
        self.cache.set(key, results, self.settings.geocoder_cache_ttl_s)
        log.info("geocoder search completed", extra={"query_length": len(query), "results": len(results)})
        return ProviderResponse[list[GeocodeResult]](
            data=results, provenance=self._provenance(), capability=self.capability()
        )

    async def boundary(self, osm_type: str, osm_id: int) -> ProviderResponse[BoundaryResult]:
        """The polygon of one OSM object. Never invents a boundary: no polygon gives geometry None."""
        if not self.settings.geocoder_enabled:
            raise ProviderError("Geocoder disabled", CapabilityState.not_configured)
        prefix = _OSM_TYPE_PREFIX.get(osm_type)
        if prefix is None or osm_id <= 0:
            raise ProviderError("Unknown OSM object", CapabilityState.manual_input_required, 400)
        key = f"boundary:{prefix}{osm_id}"
        cached = self.cache.get(key)
        if cached is not None:
            return ProviderResponse[BoundaryResult](
                data=cached,
                provenance=self._boundary_provenance(),
                capability=Capability(state=CapabilityState.using_cache, message="Using cached result"),
            )
        res = await self._get(
            self.settings.nominatim_lookup_url,
            {
                "osm_ids": f"{prefix}{osm_id}",
                "format": "jsonv2",
                "polygon_geojson": 1,
                "polygon_threshold": BOUNDARY_SIMPLIFY_DEG,
            },
        )
        items = res.json()
        if not items:
            raise ProviderError("The place was not found", CapabilityState.coverage_unavailable, 404)
        item = items[0]
        geom = item.get("geojson")
        polygon = geom if isinstance(geom, dict) and geom.get("type") in ("Polygon", "MultiPolygon") else None
        result = BoundaryResult(
            label=str(item.get("display_name", "")), osmType=osm_type, osmId=osm_id, geometry=polygon
        )
        self.cache.set(key, result, self.settings.geocoder_cache_ttl_s)
        log.info("boundary lookup completed", extra={"osm_type": osm_type, "has_polygon": polygon is not None})
        capability = (
            self.capability()
            if polygon
            else Capability(
                state=CapabilityState.manual_input_required,
                message="OpenStreetMap has no boundary polygon for this place; draw the region by hand.",
            )
        )
        return ProviderResponse[BoundaryResult](
            data=result, provenance=self._boundary_provenance(), capability=capability
        )

    def _boundary_provenance(self) -> Provenance:
        p = self._provenance()
        p.limitations = [
            "Boundaries are as mapped in OpenStreetMap and may be outdated or differ from official ones.",
            f"Simplified by Nominatim with a tolerance of {BOUNDARY_SIMPLIFY_DEG} degrees.",
        ]
        return p
