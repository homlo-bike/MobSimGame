from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.providers.valhalla import decode_polyline6
from app.security import OutboundUrlError, check_internal_url
from tests.conftest import Upstream


def encode_polyline6(coords: list[tuple[float, float]]) -> str:
    out: list[str] = []
    prev = (0, 0)
    for lon, lat in coords:
        cur = (round(lat * 1e6), round(lon * 1e6))
        for value, before in zip(cur, prev, strict=True):
            v = value - before
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        prev = cur
    return "".join(out)


@pytest.fixture
def routing_client(make_client: Callable[[Settings], TestClient], settings: Settings) -> TestClient:
    return make_client(settings.model_copy(update={"valhalla_url": "http://valhalla:8002"}))


def test_polyline6_roundtrip() -> None:
    coords = [(13.404954, 52.520008), (13.41, 52.5212), (-74.006, 40.7128)]
    assert decode_polyline6(encode_polyline6(coords)) == pytest.approx(coords)


def test_routing_not_configured(client: TestClient) -> None:
    res = client.post("/api/v1/routing/route", json={"waypoints": [[13.4, 52.5], [13.41, 52.51]]})
    assert res.status_code == 503
    assert res.json()["capability"]["state"] == "not_configured"


def test_routes_each_leg_and_reports_failures(routing_client: TestClient, upstream: Upstream) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["costing"] == "bus"
        a, b = body["locations"]
        if a["lon"] > 13.405:
            return httpx.Response(400, json={"error_code": 442, "error": "No path could be found for input"})
        shape = encode_polyline6([(a["lon"], a["lat"]), (a["lon"], b["lat"]), (b["lon"], b["lat"])])
        return httpx.Response(
            200, json={"trip": {"status": 0, "legs": [{"shape": shape}], "summary": {"length": 1.2, "time": 240}}}
        )

    upstream.handlers["valhalla"] = handler
    res = routing_client.post(
        "/api/v1/routing/route", json={"waypoints": [[13.40, 52.50], [13.41, 52.51], [13.42, 52.52]]}
    )
    assert res.status_code == 200
    data = res.json()
    legs = data["data"]
    assert [leg["status"] for leg in legs] == ["routed", "failed"]
    assert legs[0]["coordinates"][1] == pytest.approx([13.40, 52.51])
    assert legs[0]["lengthM"] == pytest.approx(1200)
    assert legs[1]["coordinates"] == [[13.41, 52.51], [13.42, 52.52]]
    assert data["provenance"]["license"].startswith("ODbL")
    assert all(r.url.host == "valhalla" for r in upstream.requests)


def test_kerbside_asks_for_the_stop_side(routing_client: TestClient, upstream: Upstream) -> None:
    sides: list[list[str | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        sides.append([loc.get("preferred_side") for loc in body["locations"]])
        a, b = body["locations"]
        shape = encode_polyline6([(a["lon"], a["lat"]), (b["lon"], b["lat"])])
        return httpx.Response(200, json={"trip": {"legs": [{"shape": shape}], "summary": {"length": 1, "time": 60}}})

    upstream.handlers["valhalla"] = handler
    waypoints = [[13.40, 52.50], [13.41, 52.51]]
    assert routing_client.post("/api/v1/routing/route", json={"waypoints": waypoints}).status_code == 200
    res = routing_client.post(
        "/api/v1/routing/route", json={"waypoints": waypoints, "mode": "trolleybus", "kerbside": True}
    )
    assert res.status_code == 200
    assert sides == [[None, None], ["same", "same"]]


def test_rejects_invalid_waypoints(routing_client: TestClient) -> None:
    assert routing_client.post("/api/v1/routing/route", json={"waypoints": [[200, 0], [0, 0]]}).status_code == 422
    assert routing_client.post("/api/v1/routing/route", json={"waypoints": [[0, 0]]}).status_code == 422


def test_internal_url_guard() -> None:
    check_internal_url("http://valhalla:8002/route", "http://valhalla:8002")
    for bad in ("http://valhalla:8003/route", "http://evil:8002/route", "https://valhalla:8002/route", "file:///x"):
        with pytest.raises(OutboundUrlError):
            check_internal_url(bad, "http://valhalla:8002")
