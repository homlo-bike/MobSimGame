"""Small geometry helpers for server-side summaries (reports, extents)."""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence

EARTH_RADIUS_M = 6371008.8


def haversine_m(a: Sequence[float], b: Sequence[float]) -> float:
    """Great-circle distance between [lon, lat] points in metres."""
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def path_length_m(coords: Sequence[Sequence[float]], ring: bool = False) -> float:
    pts = list(coords)
    if ring and len(pts) >= 3:
        pts.append(pts[0])
    return sum(haversine_m(pts[i - 1], pts[i]) for i in range(1, len(pts)))


def extent_ewkt(points: Iterable[Sequence[float]]) -> str | None:
    pts = list(points)
    if not pts:
        return None
    w = min(p[0] for p in pts)
    e = max(p[0] for p in pts)
    s = min(p[1] for p in pts)
    n = max(p[1] for p in pts)
    if w == e:
        e += 1e-6
    if s == n:
        n += 1e-6
    return f"SRID=4326;POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"
