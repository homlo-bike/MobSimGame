"""OpenStreetMap features via the Overpass API (bounded prototype queries).

Policy notes (see docs/PROVIDER_CONFIGURATION.md): the public instance asks for
modest use, an identifying User-Agent, declared timeouts, caching and no
parallel bulk scripts. Queries here are limited by radius/area, cached, and
issued only on explicit user action. For heavy use, self-host Overpass or
import a regional PBF extract (planned, Phase 3).
"""

from __future__ import annotations

import hashlib
import json
import math
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

OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"

log = get_logger(__name__)

# OSM tag filters per category. Order matters only for readability.
CATEGORY_FILTERS: dict[str, list[str]] = {
    "landmark": [
        '["tourism"="attraction"]["name"]',
        '["historic"]["name"]',
        '["amenity"="townhall"]["name"]',
    ],
    "transit_station": ['["railway"~"^(station|halt)$"]["name"]', '["public_transport"="station"]["name"]'],
    "district": ['["place"~"^(suburb|neighbourhood|quarter)$"]["name"]'],
    "major_street": ['["highway"~"^(trunk|primary|secondary)$"]["name"]'],
    "facility": [
        '["amenity"~"^(university|college|hospital|marketplace|library)$"]["name"]',
        '["leisure"="park"]["name"]',
    ],
    "street": ['["highway"~"^(tertiary|residential|unclassified|living_street|pedestrian)$"]["name"]'],
    # Local geographic names (squares, localities, hamlets, villages).
    "place": ['["place"~"^(square|locality|hamlet|village|town|isolated_dwelling|city_block|island)$"]["name"]'],
    "parking": ['["amenity"="parking"]'],
    "railway": ['["railway"~"^(rail|light_rail|tram|subway)$"]'],
    "water": ['["natural"="water"]', '["waterway"~"^(river|canal)$"]'],
    "building": ['["building"]'],
    "landuse": ['["landuse"]'],
}
NAME_CATEGORIES = ["landmark", "transit_station", "district", "major_street", "facility", "street", "place"]
MAJOR_HIGHWAYS = {"trunk", "primary", "secondary", "tertiary"}


class OsmFeature(BaseModel):
    id: str
    category: str
    name: str | None
    names: dict[str, str]
    position: tuple[float, float]
    tags: dict[str, str]


def classify(tags: dict[str, str]) -> str:
    if tags.get("tourism") == "attraction" or "historic" in tags or tags.get("amenity") == "townhall":
        return "landmark"
    if tags.get("railway") in ("station", "halt") or tags.get("public_transport") == "station":
        return "transit_station"
    if tags.get("place") in ("suburb", "neighbourhood", "quarter"):
        return "district"
    if "place" in tags:
        return "place"
    hw = tags.get("highway")
    if hw in ("trunk", "primary", "secondary"):
        return "major_street"
    if (
        tags.get("amenity") in ("university", "college", "hospital", "marketplace", "library")
        or tags.get("leisure") == "park"
    ):
        return "facility"
    if hw:
        return "street"
    if tags.get("amenity") == "parking":
        return "parking"
    if "railway" in tags:
        return "railway"
    if tags.get("natural") == "water" or "waterway" in tags:
        return "water"
    if "building" in tags:
        return "building"
    if "landuse" in tags:
        return "landuse"
    return "other"


def bbox_area_km2(w: float, s: float, e: float, n: float) -> float:
    km_lat = 111.195
    km_lng = km_lat * math.cos(math.radians((s + n) / 2))
    return abs(e - w) * km_lng * abs(n - s) * km_lat


def build_query(filters: list[str], area: str, timeout_s: int) -> str:
    parts = "".join(f"nwr{f}({area});" for f in filters)
    return f"[out:json][timeout:{timeout_s}][maxsize:33554432];({parts});out center tags 500;"


def build_near_query(filters: list[str], area: str, timeout_s: int) -> str:
    """Named features near a point; streets with their geometry, so intersections can be found."""
    parts = "".join(f"nwr{f}({area});" for f in filters)
    return (
        f"[out:json][timeout:{timeout_s}][maxsize:33554432];"
        f"({parts})->.all;"
        "way.all[highway]->.hw;"
        "(.all; - .hw;)->.other;"
        ".other out center tags 300;"
        ".hw out geom 300;"
    )


def _nearest_vertex(geometry: list[dict[str, float]], lon: float, lat: float) -> tuple[float, float]:
    k = math.cos(math.radians(lat))
    best = min(geometry, key=lambda g: ((g["lon"] - lon) * k) ** 2 + (g["lat"] - lat) ** 2)
    return float(best["lon"]), float(best["lat"])


def street_intersections(payload: dict[str, Any]) -> list[OsmFeature]:
    """Nodes shared by differently named streets where at least one street is a major road."""
    at: dict[tuple[float, float], dict[str, bool]] = {}
    for el in payload.get("elements", []):
        tags = el.get("tags") or {}
        name = tags.get("name")
        if el.get("type") != "way" or not name or not el.get("geometry") or "highway" not in tags:
            continue
        major = tags.get("highway") in MAJOR_HIGHWAYS
        for g in el["geometry"]:
            if not g:
                continue
            key = (round(float(g["lon"]), 7), round(float(g["lat"]), 7))
            names = at.setdefault(key, {})
            names[name] = names.get(name, False) or major
    out: list[OsmFeature] = []
    seen: set[str] = set()
    for (lon, lat), names in at.items():
        if len(names) < 2 or not any(names.values()):
            continue
        # Major roads first, then alphabetical, so "Main Street / Elm Street" is stable.
        ordered = sorted(names, key=lambda n: (not names[n], n))[:2]
        label = " / ".join(ordered)
        if label in seen:
            continue
        seen.add(label)
        out.append(
            OsmFeature(
                id=f"intersection/{lon:.6f},{lat:.6f}",
                category="intersection",
                name=label,
                names={},
                position=(lon, lat),
                tags={},
            )
        )
    return out


def parse_elements(payload: dict[str, Any], near: tuple[float, float] | None = None) -> list[OsmFeature]:
    out: list[OsmFeature] = []
    for el in payload.get("elements", []):
        tags = {str(k): str(v) for k, v in (el.get("tags") or {}).items()}
        if "lat" in el and "lon" in el:
            lon, lat = float(el["lon"]), float(el["lat"])
        elif el.get("geometry") and near is not None:
            # Streets: the closest point of the street, so the distance means something.
            lon, lat = _nearest_vertex([g for g in el["geometry"] if g], *near)
        elif "center" in el:
            lon, lat = float(el["center"]["lon"]), float(el["center"]["lat"])
        else:
            continue
        out.append(
            OsmFeature(
                id=f"{el.get('type', 'x')}/{el.get('id')}",
                category=classify(tags),
                name=tags.get("name"),
                names={k: v for k, v in tags.items() if k.startswith("name:")},
                # GeoJSON order: [longitude, latitude]
                position=(lon, lat),
                tags=tags,
            )
        )
    return out


class OverpassProvider:
    id = "overpass"
    kind = "osm_features"
    label = "OpenStreetMap via Overpass API"
    sends_project_data_to_third_party = True

    def __init__(self, settings: Settings, client: httpx.AsyncClient, cache: TTLCache | None = None) -> None:
        self.settings = settings
        self.client = client
        self.cache = cache or TTLCache()

    def capability(self) -> Capability:
        if not self.settings.overpass_enabled:
            return Capability(state=CapabilityState.not_configured, message="Overpass disabled by configuration")
        return Capability(
            state=CapabilityState.available,
            message=f"Bounded queries (≤ {self.settings.overpass_max_radius_m} m radius, "
            f"≤ {self.settings.overpass_max_bbox_km2} km²), cached",
        )

    def _provenance(self, cached: bool) -> Provenance:
        return Provenance(
            provider=f"Overpass API ({self.settings.overpass_url})",
            dataset="OpenStreetMap",
            sourceUrl="https://www.openstreetmap.org/copyright",
            license="ODbL-1.0",
            attribution=OSM_ATTRIBUTION,
            retrievedAt=None if cached else now_iso(),
            coverage="Global; completeness varies by area",
            datasetDate=None,
            spatialResolution=None,
            status="observed",
            limitations=[
                "Volunteered data: a missing tag does not mean a feature does not exist.",
                "Query limited in area and result count (500 elements).",
                *(["Served from the MobSimGame cache."] if cached else []),
            ],
            cacheExpiresAt=expires_iso(self.settings.overpass_cache_ttl_s),
            confidence="medium",
        )

    async def _run(
        self,
        query: str,
        cache_key: str,
        near: tuple[float, float] | None = None,
        retries: int = 3,
        timeout_s: int | None = None,
    ) -> ProviderResponse[list[OsmFeature]]:
        if not self.settings.overpass_enabled:
            raise ProviderError("Overpass disabled", CapabilityState.not_configured)
        cached = self.cache.get(cache_key)
        if cached is not None:
            log.debug("overpass cache hit", extra={"cache_key": cache_key, "features": len(cached)})
            return ProviderResponse[list[OsmFeature]](
                data=cached,
                provenance=self._provenance(True),
                capability=Capability(state=CapabilityState.using_cache, message="Using cached result"),
            )
        res = await fetch_with_retry(
            self.client,
            "POST",
            self.settings.overpass_url,
            self.settings,
            data={"data": query},
            timeout=(timeout_s or self.settings.overpass_timeout_s) + 5,
            retries=retries,
        )
        if res.status_code != 200:
            log.error("overpass query failed", extra={"status": res.status_code, "cache_key": cache_key})
            raise ProviderError(f"Overpass returned HTTP {res.status_code}", CapabilityState.temporarily_unavailable)
        payload = res.json()
        features = parse_elements(payload, near)
        if near is not None:
            features.extend(street_intersections(payload))
        log.info("overpass query completed", extra={"cache_key": cache_key, "features": len(features)})
        self.cache.set(cache_key, features, self.settings.overpass_cache_ttl_s)
        return ProviderResponse[list[OsmFeature]](
            data=features, provenance=self._provenance(False), capability=self.capability()
        )

    async def features_near(self, lon: float, lat: float, radius_m: int) -> ProviderResponse[list[OsmFeature]]:
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ProviderError("Coordinates out of range", CapabilityState.coverage_unavailable, 400)
        radius = max(10, min(radius_m, self.settings.overpass_max_radius_m))
        filters = [f for c in NAME_CATEGORIES for f in CATEGORY_FILTERS[c]]
        # Station naming is interactive: a short query without retries keeps the answer
        # (at most query timeout + 5 s) inside the browser's wait (NAME_LOOKUP_TIMEOUT_MS = 25 s).
        timeout = min(self.settings.overpass_timeout_s, 15)
        query = build_near_query(filters, f"around:{radius},{lat:.6f},{lon:.6f}", timeout)
        return await self._run(
            query, f"near:{lon:.4f}:{lat:.4f}:{radius}", near=(lon, lat), retries=0, timeout_s=timeout
        )

    async def features_in_bbox(
        self, w: float, s: float, e: float, n: float, categories: list[str]
    ) -> ProviderResponse[list[OsmFeature]]:
        if not (w < e and s < n):
            raise ProviderError("Invalid bounding box", CapabilityState.coverage_unavailable, 400)
        if bbox_area_km2(w, s, e, n) > self.settings.overpass_max_bbox_km2:
            raise ProviderError(
                f"Area too large (limit {self.settings.overpass_max_bbox_km2} km²); zoom in",
                CapabilityState.coverage_unavailable,
                400,
            )
        unknown = [c for c in categories if c not in CATEGORY_FILTERS]
        if unknown or not categories:
            raise ProviderError(f"Unknown categories: {unknown}", CapabilityState.coverage_unavailable, 400)
        filters = [f for c in categories for f in CATEGORY_FILTERS[c]]
        # Overpass bbox order is (south, west, north, east).
        query = build_query(filters, f"{s:.6f},{w:.6f},{n:.6f},{e:.6f}", self.settings.overpass_timeout_s)
        key = f"bbox:{w:.4f}:{s:.4f}:{e:.4f}:{n:.4f}:{','.join(sorted(categories))}"
        return await self._run(query, key)


class TrafficSignal(BaseModel):
    id: str
    position: tuple[float, float]


def signals_query(paths: list[list[tuple[float, float]]], radius_m: int, timeout_s: int) -> str:
    """Traffic signals within radius_m of polylines (Overpass "around" with a linestring)."""
    parts = []
    for path in paths:
        coords = ",".join(f"{lat:.6f},{lon:.6f}" for lon, lat in path)
        parts.append(f'node["highway"="traffic_signals"](around:{radius_m},{coords});')
    return f"[out:json][timeout:{timeout_s}];({''.join(parts)});out qt;"


async def traffic_signals_along(
    provider: OverpassProvider, paths: list[list[tuple[float, float]]], radius_m: int
) -> ProviderResponse[list[TrafficSignal]]:
    """Road traffic signals along the given lines (only on explicit user request)."""
    if not provider.settings.overpass_enabled:
        raise ProviderError("Overpass disabled", CapabilityState.not_configured)
    key = "signals:" + hashlib.sha256(json.dumps([paths, radius_m]).encode()).hexdigest()
    cached = provider.cache.get(key)
    if cached is not None:
        return ProviderResponse[list[TrafficSignal]](
            data=cached,
            provenance=_signals_provenance(provider, True),
            capability=Capability(state=CapabilityState.using_cache, message="Using cached result"),
        )
    res = await fetch_with_retry(
        provider.client,
        "POST",
        provider.settings.overpass_url,
        provider.settings,
        data={"data": signals_query(paths, radius_m, provider.settings.examples_timeout_s)},
        timeout=provider.settings.examples_timeout_s + 15,
        retries=0,
    )
    if res.status_code != 200:
        raise ProviderError(f"Overpass returned HTTP {res.status_code}", CapabilityState.temporarily_unavailable)
    signals = [
        TrafficSignal(id=f"node/{el['id']}", position=(float(el["lon"]), float(el["lat"])))
        for el in res.json().get("elements", [])
        if el.get("type") == "node" and "lat" in el
    ]
    log.info("traffic signals loaded", extra={"signals": len(signals), "paths": len(paths)})
    provider.cache.set(key, signals, provider.settings.examples_cache_ttl_s)
    return ProviderResponse[list[TrafficSignal]](
        data=signals, provenance=_signals_provenance(provider, False), capability=provider.capability()
    )


def _signals_provenance(provider: OverpassProvider, cached: bool) -> Provenance:
    p = provider._provenance(cached)
    return p.model_copy(
        update={
            "dataset": "OpenStreetMap highway=traffic_signals",
            "limitations": [
                "Signal positions only: OSM has no signal timings; the simulation uses assumed cycles.",
                "Volunteered data: a missing signal does not mean there is none.",
                *(["Served from the MobSimGame cache."] if cached else []),
            ],
            "cacheExpiresAt": expires_iso(provider.settings.examples_cache_ttl_s),
        }
    )
