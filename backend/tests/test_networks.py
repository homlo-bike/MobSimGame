"""Example networks from OpenStreetMap: parsing a recorded-format Overpass response.

The payload below is a hand-written miniature in Overpass JSON format (test data only).
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.providers.networks import CITIES, build_network, build_query, chain_ways, simplify, stitch
from tests.conftest import Upstream


def node(i: int, lon: float, lat: float, **tags: str) -> dict[str, Any]:
    return {"type": "node", "id": i, "lon": lon, "lat": lat, "tags": tags}


def way(i: int, *coords: tuple[float, float], **tags: str) -> dict[str, Any]:
    return {"type": "way", "id": i, "geometry": [{"lon": x, "lat": y} for x, y in coords], "tags": tags}


def member(t: str, ref: int, role: str = "") -> dict[str, Any]:
    return {"type": t, "ref": ref, "role": role}


def payload() -> dict[str, Any]:
    return {
        "elements": [
            # Tram 1: two directions grouped by a route master; the second way is stored reversed.
            {
                "type": "relation",
                "id": 100,
                "tags": {"type": "route", "route": "tram", "ref": "1", "name": "Tram 1: A => C", "colour": "#C00"},
                "members": [
                    member("node", 1, "stop"),
                    member("node", 11, "platform"),
                    member("way", 10),
                    member("way", 20),
                    member("node", 2, "stop"),
                    member("node", 12, "platform"),
                    member("node", 3, "stop_exit_only"),
                    member("node", 13, "platform"),
                ],
            },
            {
                "type": "relation",
                "id": 101,
                "tags": {"type": "route", "route": "tram", "ref": "1", "name": "Tram 1: C => A"},
                "members": [member("way", 20), member("way", 10), member("node", 3, "stop")],
            },
            {
                "type": "relation",
                "id": 900,
                "tags": {"type": "route_master", "route_master": "tram"},
                "members": [member("relation", 100), member("relation", 101)],
            },
            # Tram 2 shares the stop "Alpha Square" (a different node 150 m away).
            {
                "type": "relation",
                "id": 200,
                "tags": {"type": "route", "route": "tram", "ref": "2", "name": "Tram 2"},
                "members": [member("node", 4, "stop"), member("way", 30), member("node", 5, "stop")],
            },
            way(10, (13.40, 52.50), (13.41, 52.50)),
            way(20, (13.42, 52.50), (13.41, 52.50)),
            way(30, (13.402, 52.50), (13.402, 52.51)),
            node(1, 13.40, 52.50, name="Alpha Square"),
            node(2, 13.41, 52.50),
            node(3, 13.42, 52.50, name="Gamma"),
            node(11, 13.40, 52.5001, name="Alpha Square"),
            node(12, 13.41, 52.5001, name="Beta Street"),
            node(13, 13.42, 52.5001, name="Gamma"),
            node(4, 13.402, 52.50, name="Alpha Square"),
            node(5, 13.402, 52.51, name="Delta"),
        ]
    }


def test_builds_lines_and_shared_stations() -> None:
    city = CITIES["berlin"]
    net = build_network(payload(), city, city.networks[0])
    assert [line.ref for line in net.lines] == ["1", "2"]
    tram1 = net.lines[0]
    # One line per route master; the variant with the most stops is kept.
    assert tram1.id == "relation/100"
    assert tram1.colour == "#cc0000"
    assert tram1.coordinates[0] == (13.40, 52.50) and tram1.coordinates[-1] == (13.42, 52.50)
    assert tram1.gaps == 0
    names = {s.key: s.name for s in net.stations}
    # The unnamed stop position takes the name of its platform.
    assert [names[k] for k in tram1.stops] == ["Alpha Square", "Beta Street", "Gamma"]
    # "Alpha Square" of tram 2 is 136 m away: one shared station.
    assert net.lines[1].stops[0] == tram1.stops[0]
    assert len(net.stations) == 4


def test_stitch_flips_ways_and_counts_gaps() -> None:
    path, gaps = stitch([[(0, 0), (1, 0)], [(2, 0), (1, 0)], [(3, 0), (4, 0)]])
    assert path == [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0)]
    assert gaps == 1
    path, _ = stitch([[(1, 0), (0, 0)], [(1, 0), (2, 0)]])
    assert path == [(0, 0), (1, 0), (2, 0)]


def test_chain_ways_joins_unordered_pieces() -> None:
    chains = chain_ways([[(2, 0), (3, 0)], [(0, 0), (1, 0)], [(2, 0), (1, 0)], [(9, 9), (9, 8)]])
    assert chains[0] == [(3, 0), (2, 0), (1, 0), (0, 0)] or chains[0] == [(0, 0), (1, 0), (2, 0), (3, 0)]
    assert len(chains) == 2


def test_simplify_keeps_corners() -> None:
    line = [(13.4 + i * 1e-5, 52.5) for i in range(50)] + [(13.4005, 52.5 + i * 1e-5) for i in range(1, 50)]
    out = simplify(line, 2.0)
    assert len(out) == 3


def test_under_construction_metro_from_construction_ways() -> None:
    city = CITIES["bogota"]
    metro = next(n for n in city.networks if n.kind == "metro")
    data = {
        "elements": [
            way(1, (-74.20, 4.60), (-74.15, 4.62), railway="construction", construction="subway"),
            way(2, (-74.10, 4.65), (-74.15, 4.62), railway="construction", construction="subway"),
        ]
    }
    net = build_network(data, city, metro)
    assert len(net.lines) == 1
    assert net.lines[0].status == "Under construction"
    assert len(net.lines[0].coordinates) == 3
    assert "construction" in build_query(city, metro, 60)


def test_transmilenio_is_brt_with_return_path() -> None:
    city = CITIES["bogota"]
    bus = next(n for n in city.networks if n.kind == "bus")
    data = {
        "elements": [
            {
                "type": "relation",
                "id": 1,
                "tags": {"type": "route", "route": "bus", "ref": "B1", "network": "TransMilenio"},
                "members": [member("node", 1, "stop"), member("way", 10), member("node", 2, "stop")],
            },
            {
                "type": "relation",
                "id": 2,
                "tags": {"type": "route", "route": "bus", "ref": "B1", "network": "TransMilenio"},
                "members": [member("way", 11)],
            },
            way(10, (-74.10, 4.60), (-74.10, 4.61)),
            way(11, (-74.099, 4.61), (-74.099, 4.60)),
            node(1, -74.10, 4.60, name="Portal Norte"),
            node(2, -74.10, 4.61, name="Calle 100"),
        ]
    }
    net = build_network(data, city, bus)
    assert net.lines[0].mode == "brt"
    assert net.lines[0].returnCoordinates == [(-74.099, 4.61), (-74.099, 4.60)]


def test_example_endpoints(client: TestClient, upstream: Upstream) -> None:
    cities = client.get("/api/v1/examples").json()["cities"]
    assert {c["id"] for c in cities} == {"berlin", "paris", "london", "new-york", "los-angeles", "bogota"}
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=payload())

    upstream.handlers["overpass-api.de"] = handler
    res = client.get("/api/v1/examples/berlin/tram")
    assert res.status_code == 200
    body = res.json()
    assert body["provenance"]["license"] == "ODbL-1.0"
    assert len(body["data"]["lines"]) == 2
    # Cached: a second load does not query Overpass again.
    again = client.get("/api/v1/examples/berlin/tram").json()
    assert again["capability"]["state"] == "using_cache"
    assert len(calls) == 1
    assert client.get("/api/v1/examples/atlantis/tram").status_code == 404


@pytest.mark.parametrize("city", list(CITIES))
def test_every_city_has_a_metro_or_bus_network(city: str) -> None:
    kinds = {n.kind for n in CITIES[city].networks}
    assert "bus" in kinds and "metro" in kinds
