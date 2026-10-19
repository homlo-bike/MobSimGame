"""Real-city example networks loaded live from OpenStreetMap (Overpass API).

One city and one network (tram, metro or bus) per request. Public-transport
route relations are turned into lines: member ways are stitched into one path,
stop members become stations (merged across lines by name and distance), and
only one direction of each route is kept as the line (the other becomes the
bus return path where it uses different streets). Results are cached for a
long time because full networks are large queries; please respect the public
Overpass instance's usage policy or self-host Overpass for regular use.

All names and positions come from OSM at request time; nothing is bundled.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
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
    TTLCache,
    expires_iso,
    fetch_with_retry,
    now_iso,
)
from .overpass import OSM_ATTRIBUTION

log = get_logger(__name__)

NetworkKind = Literal["tram", "metro", "bus"]
LineMode = Literal["tram", "light_rail", "metro", "bus", "brt"]


@dataclass(frozen=True)
class CityNetwork:
    kind: NetworkKind
    label: str
    # Overpass filters for the route relations of this network.
    routes: tuple[str, ...]
    note: str = ""
    # Also load railway ways under construction (e.g. a metro line being built).
    construction: str | None = None


@dataclass(frozen=True)
class City:
    id: str
    name: str
    country: str
    # Query extent (west, south, east, north), WGS84. Roughly the city's built-up area.
    bbox: tuple[float, float, float, float]
    center: tuple[float, float]
    zoom: float
    networks: tuple[CityNetwork, ...] = field(default_factory=tuple)


BUS = CityNetwork(
    "bus", "Bus", ('["route"="bus"]', '["route"="trolleybus"]'), "Large network: loading can take minutes"
)

CITIES: dict[str, City] = {
    c.id: c
    for c in (
        City(
            "berlin",
            "Berlin",
            "Germany",
            (13.08, 52.33, 13.77, 52.68),
            (13.405, 52.52),
            11.0,
            (
                CityNetwork("tram", "Tram", ('["route"="tram"]',)),
                CityNetwork("metro", "U-Bahn (metro)", ('["route"="subway"]',)),
                BUS,
            ),
        ),
        City(
            "paris",
            "Paris",
            "France",
            (2.15, 48.75, 2.55, 48.95),
            (2.3522, 48.8566),
            11.5,
            (
                CityNetwork("tram", "Tramway", ('["route"="tram"]',)),
                CityNetwork("metro", "Métro", ('["route"="subway"]',)),
                BUS,
            ),
        ),
        City(
            "london",
            "London",
            "United Kingdom",
            (-0.51, 51.28, 0.33, 51.69),
            (-0.1276, 51.5072),
            10.5,
            (
                CityNetwork("tram", "Tram (Tramlink)", ('["route"="tram"]',)),
                CityNetwork("metro", "Underground (metro)", ('["route"="subway"]',)),
                BUS,
            ),
        ),
        City(
            "new-york",
            "New York City",
            "United States",
            (-74.26, 40.49, -73.70, 40.92),
            (-73.9855, 40.758),
            10.5,
            (
                CityNetwork("metro", "Subway", ('["route"="subway"]',)),
                BUS,
            ),
        ),
        City(
            "los-angeles",
            "Los Angeles",
            "United States",
            (-118.67, 33.70, -118.15, 34.34),
            (-118.2437, 34.0522),
            10.0,
            (
                CityNetwork(
                    "metro",
                    "Metro Rail (subway and light rail)",
                    ('["route"="subway"]', '["route"="light_rail"]'),
                ),
                BUS,
            ),
        ),
        City(
            "bogota",
            "Bogotá",
            "Colombia",
            (-74.23, 4.47, -74.00, 4.84),
            (-74.0721, 4.711),
            11.0,
            (
                CityNetwork(
                    "metro",
                    "Metro Line 1 (under construction)",
                    ('["route"="subway"]',),
                    "Under construction: not in service",
                    construction="subway",
                ),
                CityNetwork(
                    "bus",
                    "TransMilenio (BRT) and SITP buses",
                    ('["route"="bus"]',),
                    "Large network: loading can take minutes",
                ),
            ),
        ),
    )
}


class NetworkStation(BaseModel):
    key: str
    name: str
    position: tuple[float, float]


class NetworkLine(BaseModel):
    id: str
    ref: str
    name: str
    colour: str | None
    mode: LineMode
    coordinates: list[tuple[float, float]]
    returnCoordinates: list[tuple[float, float]] | None
    stops: list[str]
    status: str
    gaps: int


class Network(BaseModel):
    city: str
    cityName: str
    kind: NetworkKind
    label: str
    center: tuple[float, float]
    zoom: float
    lines: list[NetworkLine]
    stations: list[NetworkStation]
    notes: list[str]


# --- Geometry helpers -----------------------------------------------------------

Coord = tuple[float, float]


def _metres(a: Coord, b: Coord) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    dx = (b[0] - a[0]) * 111_320 * math.cos(lat)
    dy = (b[1] - a[1]) * 110_540
    return math.hypot(dx, dy)


def simplify(coords: list[Coord], tolerance_m: float) -> list[Coord]:
    """Douglas–Peucker in a local metric frame (iterative)."""
    if len(coords) <= 2:
        return coords
    lat0 = math.radians(coords[0][1])
    pts = [(c[0] * 111_320 * math.cos(lat0), c[1] * 110_540) for c in coords]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = pts[i]
        bx, by = pts[j]
        seg = math.hypot(bx - ax, by - ay)
        best, idx = 0.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if seg == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / seg
            if d > best:
                best, idx = d, k
        if idx >= 0 and best > tolerance_m:
            keep[idx] = True
            stack.extend([(i, idx), (idx, j)])
    return [c for c, k in zip(coords, keep, strict=True) if k]


def stitch(ways: list[list[Coord]]) -> tuple[list[Coord], int]:
    """Join ordered member ways into one path, flipping ways as needed. Returns the path and the gap count."""
    ws = [w for w in ways if len(w) >= 2]
    if not ws:
        return [], 0
    path = list(ws[0])
    if len(ws) > 1:
        nxt = ws[1]
        # Orient the first way so that it ends where the second one touches it.
        if path[0] in (nxt[0], nxt[-1]) and path[-1] not in (nxt[0], nxt[-1]):
            path.reverse()
    gaps = 0
    for w in ws[1:]:
        end = path[-1]
        if w[0] == end:
            path.extend(w[1:])
        elif w[-1] == end:
            path.extend(reversed(w[:-1]))
        else:
            # A gap in the mapped route: continue from the nearer end of the next way.
            gaps += 1
            path.extend(w if _metres(end, w[0]) <= _metres(end, w[-1]) else list(reversed(w)))
    return path, gaps


_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
_SHORT_COLOUR = re.compile(r"^#[0-9a-fA-F]{3}$")


def _colour(tags: dict[str, str]) -> str | None:
    c = tags.get("colour", "").strip()
    if _COLOUR.match(c):
        return c.lower()
    if _SHORT_COLOUR.match(c):
        return "#" + "".join(ch * 2 for ch in c[1:]).lower()
    return None


def _norm(name: str) -> str:
    return re.sub(r"[^\w]+", " ", name.casefold()).strip()


# --- Building the network -----------------------------------------------------------


@dataclass
class _Route:
    id: int
    tags: dict[str, str]
    ways: list[list[Coord]]
    stops: list[tuple[str, Coord]]
    master: int | None = None


def _mode_of(tags: dict[str, str]) -> LineMode:
    route = tags.get("route", "")
    if route == "tram":
        return "tram"
    if route == "light_rail":
        return "light_rail"
    if route == "subway":
        return "metro"
    network = f"{tags.get('network', '')} {tags.get('name', '')}"
    if "transmilenio" in network.casefold() or tags.get("bus") == "brt":
        return "brt"
    return "bus"


def parse_routes(payload: dict[str, Any]) -> list[_Route]:
    nodes: dict[int, tuple[Coord, dict[str, str]]] = {}
    ways: dict[int, list[Coord]] = {}
    way_tags: dict[int, dict[str, str]] = {}
    relations: list[dict[str, Any]] = []
    masters: dict[int, int] = {}
    for el in payload.get("elements", []):
        t = el.get("type")
        if t == "node" and "lat" in el:
            nodes[el["id"]] = ((float(el["lon"]), float(el["lat"])), el.get("tags") or {})
        elif t == "way" and el.get("geometry"):
            ways[el["id"]] = [(float(g["lon"]), float(g["lat"])) for g in el["geometry"] if g]
            way_tags[el["id"]] = el.get("tags") or {}
        elif t == "relation":
            tags = el.get("tags") or {}
            if tags.get("type") == "route_master":
                for m in el.get("members", []):
                    if m.get("type") == "relation":
                        masters[m["ref"]] = el["id"]
            elif tags.get("type") == "route":
                relations.append(el)
    routes: list[_Route] = []
    for rel in relations:
        tags = {str(k): str(v) for k, v in (rel.get("tags") or {}).items()}
        path_ways: list[list[Coord]] = []
        stops: list[tuple[str, Coord]] = []
        pending_platform_names: list[str] = []
        for m in rel.get("members", []):
            role = m.get("role", "")
            if m.get("type") == "way" and role in ("", "forward", "backward") and m["ref"] in ways:
                path_ways.append(ways[m["ref"]])
            elif m.get("type") == "node" and role.startswith("stop") and m["ref"] in nodes:
                pos, ntags = nodes[m["ref"]]
                stops.append((ntags.get("name", ""), pos))
            elif role.startswith("platform"):
                ptags = (
                    nodes[m["ref"]][1] if m.get("type") == "node" and m["ref"] in nodes else way_tags.get(m["ref"], {})
                )
                pending_platform_names.append(ptags.get("name", ""))
        # Stop positions without a name take the name of the platform listed with them.
        if any(not n for n, _ in stops) and len(pending_platform_names) == len(stops):
            stops = [(n or p, pos) for (n, pos), p in zip(stops, pending_platform_names, strict=True)]
        routes.append(_Route(rel["id"], tags, path_ways, stops, masters.get(rel["id"])))
    return routes


def build_network(payload: dict[str, Any], city: City, network: CityNetwork) -> Network:
    routes = parse_routes(payload)
    groups: dict[str, list[_Route]] = {}
    for r in routes:
        key = (
            f"master/{r.master}"
            if r.master is not None
            else f"{r.tags.get('route')}|{r.tags.get('network', '')}|{r.tags.get('ref') or r.tags.get('name', r.id)}"
        )
        groups.setdefault(key, []).append(r)

    stations: list[NetworkStation] = []
    by_name: dict[str, list[int]] = {}

    def station_for(name: str, pos: Coord, fallback: str) -> str:
        label = name.strip() or fallback
        norm = _norm(label)
        for i in by_name.get(norm, []):
            # Same name nearby: the same station (platforms of one station can be a few hundred metres apart).
            if _metres(stations[i].position, pos) <= 400:
                return stations[i].key
        key = f"s{len(stations) + 1}"
        stations.append(NetworkStation(key=key, name=label, position=pos))
        by_name.setdefault(norm, []).append(len(stations) - 1)
        return key

    lines: list[NetworkLine] = []
    for group in groups.values():
        # One direction becomes the line: the variant with the most stops (then the longest path).
        group.sort(key=lambda r: (len(r.stops), sum(len(w) for w in r.ways)), reverse=True)
        main = group[0]
        path, gaps = stitch(main.ways)
        if len(path) < 2:
            continue
        mode = _mode_of(main.tags)
        ret: list[Coord] | None = None
        if mode in ("bus", "brt") and len(group) > 1:
            back, _ = stitch(group[1].ways)
            if len(back) >= 2:
                ret = simplify(back, 2.0)
        stop_keys: list[str] = []
        for i, (name, pos) in enumerate(main.stops):
            key = station_for(name, pos, f"Stop {i + 1}")
            if not stop_keys or stop_keys[-1] != key:
                stop_keys.append(key)
        ref = main.tags.get("ref", "")
        name = main.tags.get("name") or (f"{network.label} {ref}".strip())
        lines.append(
            NetworkLine(
                id=f"relation/{main.id}",
                ref=ref,
                name=name,
                colour=_colour(main.tags),
                mode=mode,
                coordinates=simplify(path, 2.0),
                returnCoordinates=ret,
                stops=stop_keys,
                status="",
                gaps=gaps,
            )
        )

    notes: list[str] = []
    if network.construction:
        built = _construction_lines(payload, network, len(lines))
        lines.extend(built)
        if not lines:
            notes.append("No route or construction geometry for this line is mapped in OpenStreetMap yet.")
    for line in lines:
        if network.construction and not line.status:
            line.status = "Under construction"
    lines.sort(key=lambda x: (_natural(x.ref), x.name))
    if network.note:
        notes.append(network.note)
    return Network(
        city=city.id,
        cityName=city.name,
        kind=network.kind,
        label=network.label,
        center=city.center,
        zoom=city.zoom,
        lines=lines,
        stations=stations,
        notes=notes,
    )


def _natural(ref: str) -> tuple[int, str]:
    m = re.match(r"\D*(\d+)", ref)
    return (int(m.group(1)) if m else 10_000, ref)


def chain_ways(ways: list[list[Coord]]) -> list[list[Coord]]:
    """Join unordered ways that share end nodes into chains (longest first)."""
    remaining = [list(w) for w in ways if len(w) >= 2]
    chains: list[list[Coord]] = []
    while remaining:
        chain = remaining.pop(0)
        grown = True
        while grown:
            grown = False
            for i, w in enumerate(remaining):
                if w[0] == chain[-1]:
                    chain.extend(w[1:])
                elif w[-1] == chain[-1]:
                    chain.extend(reversed(w[:-1]))
                elif w[-1] == chain[0]:
                    chain[:0] = w[:-1]
                elif w[0] == chain[0]:
                    chain[:0] = list(reversed(w[1:]))
                else:
                    continue
                remaining.pop(i)
                grown = True
                break
        chains.append(chain)
    return sorted(chains, key=len, reverse=True)


def _construction_lines(payload: dict[str, Any], network: CityNetwork, existing: int) -> list[NetworkLine]:
    """A line under construction from railway=construction ways (when no route relation exists yet)."""
    if existing:
        return []
    ways = [
        [(float(g["lon"]), float(g["lat"])) for g in el["geometry"] if g]
        for el in payload.get("elements", [])
        if el.get("type") == "way" and el.get("geometry") and (el.get("tags") or {}).get("railway") == "construction"
    ]
    chains = [c for c in chain_ways(ways) if len(c) >= 2]
    if not chains:
        return []
    path = chains[0]
    return [
        NetworkLine(
            id="construction",
            ref="1",
            name=network.label,
            colour=None,
            mode="metro",
            coordinates=simplify(path, 2.0),
            returnCoordinates=None,
            stops=[],
            status="Under construction",
            gaps=len(chains) - 1,
        )
    ]


def build_query(city: City, network: CityNetwork, timeout_s: int) -> str:
    w, s, e, n = city.bbox
    area = f"({s:.4f},{w:.4f},{n:.4f},{e:.4f})"
    rels = "".join(f'rel["type"="route"]{f}{area};' for f in network.routes)
    parts = [
        f"[out:json][timeout:{timeout_s}][maxsize:1073741824];",
        f"({rels})->.routes;",
        ".routes out body;",
        # Route masters group the two directions of one line.
        "rel(br.routes);out body;",
        "way(r.routes);out geom qt;",
        "node(r.routes);out qt;",
    ]
    if network.construction:
        c = network.construction
        parts.append(
            f'(way["railway"="construction"]["construction"="{c}"]{area};'
            f'way["railway"="construction"]["construction:railway"="{c}"]{area};);out geom qt;'
        )
    return "".join(parts)


class OsmNetworkProvider:
    id = "osm-networks"
    kind = "transit"
    label = "Example networks from OpenStreetMap (Overpass)"
    # Only the city and network name are sent, never project data.
    sends_project_data_to_third_party = False

    def __init__(self, settings: Settings, client: httpx.AsyncClient, cache: TTLCache) -> None:
        self.settings = settings
        self.client = client
        self.cache = cache

    def capability(self) -> Capability:
        if not self.settings.overpass_enabled:
            return Capability(state=CapabilityState.not_configured, message="Overpass disabled by configuration")
        return Capability(state=CapabilityState.available, message="Loaded live from OpenStreetMap, cached")

    def provenance(self, city: City, network: CityNetwork, cached: bool) -> Provenance:
        return Provenance(
            provider=f"Overpass API ({self.settings.overpass_url})",
            dataset=f"OpenStreetMap public-transport routes: {city.name}, {network.label}",
            sourceUrl="https://www.openstreetmap.org/copyright",
            license="ODbL-1.0",
            attribution=OSM_ATTRIBUTION,
            retrievedAt=None if cached else now_iso(),
            coverage=f"{city.name} query extent {city.bbox}",
            datasetDate=None,
            spatialResolution=None,
            status="observed",
            limitations=[
                "Volunteered data: routes, names and stops are as mapped in OpenStreetMap"
                " and may be incomplete or outdated.",
                "One direction per route is kept; stations are merged across lines by name within 400 m.",
                "Geometry simplified to about 2 m.",
                *(["Served from the MobSimGame cache."] if cached else []),
            ],
            cacheExpiresAt=expires_iso(self.settings.examples_cache_ttl_s),
            confidence="medium",
        )

    async def load(self, city_id: str, kind: str) -> ProviderResponse[Network]:
        if not self.settings.overpass_enabled:
            raise ProviderError("Overpass disabled", CapabilityState.not_configured)
        city = CITIES.get(city_id)
        network = next((n for n in city.networks if n.kind == kind), None) if city else None
        if city is None or network is None:
            raise ProviderError("Unknown city or network", CapabilityState.coverage_unavailable, 404)
        key = f"network:{city.id}:{kind}"
        cached = self.cache.get(key)
        if isinstance(cached, Network):
            return ProviderResponse[Network](
                data=cached,
                provenance=self.provenance(city, network, True),
                capability=Capability(state=CapabilityState.using_cache, message="Using cached network"),
            )
        timeout = self.settings.examples_timeout_s
        res = await fetch_with_retry(
            self.client,
            "POST",
            self.settings.overpass_url,
            self.settings,
            data={"data": build_query(city, network, timeout)},
            timeout=timeout + 15,
            retries=1,
            base_delay_s=5.0,
        )
        if res.status_code != 200:
            log.error("network query failed", extra={"city": city.id, "kind": kind, "status": res.status_code})
            raise ProviderError(
                f"OpenStreetMap query failed (HTTP {res.status_code}); try again later",
                CapabilityState.temporarily_unavailable,
            )
        net = build_network(res.json(), city, network)
        log.info(
            "example network loaded",
            extra={"city": city.id, "kind": kind, "lines": len(net.lines), "stations": len(net.stations)},
        )
        self.cache.set(key, net, self.settings.examples_cache_ttl_s)
        return ProviderResponse[Network](
            data=net, provenance=self.provenance(city, network, False), capability=self.capability()
        )
