from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.providers.base import CapabilityState, ProviderError, fetch_with_retry
from app.providers.camara_population import (
    CamaraPopulationProvider,
    build_request,
    geohash_bounds,
    parse_response,
)
from app.providers.overpass import bbox_area_km2, build_query, classify, parse_elements

from .conftest import Upstream

OVERPASS_PAYLOAD = {
    "elements": [
        {"type": "node", "id": 1, "lat": 52.52, "lon": 13.40, "tags": {"name": "Alexanderplatz", "railway": "station"}},
        {
            "type": "way",
            "id": 2,
            "center": {"lat": 52.521, "lon": 13.41},
            "tags": {"name": "Main St", "highway": "primary"},
        },
        {
            "type": "node",
            "id": 3,
            "lat": 52.5,
            "lon": 13.4,
            "tags": {"name": "Museum", "tourism": "attraction", "name:de": "Museum DE"},
        },
        {"type": "relation", "id": 4, "tags": {"name": "no position"}},
    ]
}


def test_overpass_parse_uses_lon_lat_order_and_classifies() -> None:
    feats = parse_elements(OVERPASS_PAYLOAD)
    assert len(feats) == 3
    assert feats[0].position == (13.40, 52.52)
    assert [f.category for f in feats] == ["transit_station", "major_street", "landmark"]
    assert feats[2].names == {"name:de": "Museum DE"}


def test_overpass_query_declares_timeout_and_limits() -> None:
    q = build_query(['["amenity"="parking"]'], "around:100,1,2", 25)
    assert q.startswith("[out:json][timeout:25][maxsize:")
    assert "out center tags 500" in q


def test_classify_unknown() -> None:
    assert classify({}) == "other"
    assert classify({"building": "yes"}) == "building"


def test_bbox_area() -> None:
    assert bbox_area_km2(0, 0, 0.01, 0.01) == pytest.approx(1.236, rel=0.01)


def test_features_near_endpoint_and_cache(client: TestClient, upstream: Upstream) -> None:
    upstream.handlers["overpass-api.de"] = lambda r: httpx.Response(200, json=OVERPASS_PAYLOAD)
    res = client.get("/api/v1/osm/features-near", params={"lon": 13.4, "lat": 52.52, "radius_m": 300})
    assert res.status_code == 200
    body = res.json()
    assert body["provenance"]["license"] == "ODbL-1.0"
    assert "OpenStreetMap" in body["provenance"]["attribution"]
    assert body["data"][0]["position"] == [13.4, 52.52]
    sent = parse_qs(upstream.requests[0].content.decode())["data"][0]
    assert "around:300,52.520000,13.400000" in sent
    assert upstream.requests[0].headers["user-agent"].startswith("MobSimGame")
    again = client.get("/api/v1/osm/features-near", params={"lon": 13.4, "lat": 52.52, "radius_m": 300}).json()
    assert again["capability"]["state"] == "using_cache"
    assert len(upstream.requests) == 1


def test_features_near_caps_radius(client: TestClient, upstream: Upstream) -> None:
    upstream.handlers["overpass-api.de"] = lambda r: httpx.Response(200, json={"elements": []})
    client.get("/api/v1/osm/features-near", params={"lon": 1, "lat": 1, "radius_m": 5000})
    assert "around:1000," in parse_qs(upstream.requests[0].content.decode())["data"][0]


def test_bbox_too_large_rejected(client: TestClient, upstream: Upstream) -> None:
    res = client.get("/api/v1/osm/features", params={"bbox": "0,0,1,1", "categories": "parking"})
    assert res.status_code == 400
    assert res.json()["capability"]["state"] == "coverage_unavailable"
    assert upstream.requests == []


def test_provider_unavailable_after_retries(
    make_client: Callable[[Settings], TestClient],
    settings: Settings,
    upstream: Upstream,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr("app.providers.base.asyncio.sleep", no_sleep)
    upstream.handlers["overpass-api.de"] = lambda r: httpx.Response(504, text="gateway timeout")
    c = make_client(settings)
    res = c.get("/api/v1/osm/features", params={"bbox": "0,0,0.01,0.01", "categories": "parking"})
    assert res.status_code == 503
    assert res.json()["capability"]["state"] == "temporarily_unavailable"
    assert len(upstream.requests) == 4  # initial + 3 retries


def test_name_lookup_does_not_retry(
    make_client: Callable[[Settings], TestClient], settings: Settings, upstream: Upstream
) -> None:
    # Interactive station naming must answer within the browser's wait: one attempt only.
    upstream.handlers["overpass-api.de"] = lambda r: httpx.Response(504, text="gateway timeout")
    res = make_client(settings).get("/api/v1/osm/features-near", params={"lon": 1, "lat": 1})
    assert res.status_code == 503
    assert len(upstream.requests) == 1


def test_street_intersections_and_nearest_street_point(client: TestClient, upstream: Upstream) -> None:
    payload = {
        "elements": [
            {
                "type": "way",
                "id": 1,
                "tags": {"highway": "primary", "name": "Main Street"},
                "geometry": [
                    {"lon": 13.400, "lat": 52.520},
                    {"lon": 13.402, "lat": 52.520},
                    {"lon": 13.404, "lat": 52.520},
                ],
            },
            {
                "type": "way",
                "id": 2,
                "tags": {"highway": "residential", "name": "Elm Street"},
                "geometry": [{"lon": 13.402, "lat": 52.519}, {"lon": 13.402, "lat": 52.520}],
            },
            {
                "type": "way",
                "id": 3,
                "tags": {"highway": "residential", "name": "Oak Lane"},
                "geometry": [
                    {"lon": 13.410, "lat": 52.519},
                    {"lon": 13.410, "lat": 52.520},
                    {"lon": 13.411, "lat": 52.521},
                ],
            },
            {
                "type": "way",
                "id": 4,
                "tags": {"highway": "residential", "name": "Ash Lane"},
                "geometry": [{"lon": 13.411, "lat": 52.521}, {"lon": 13.412, "lat": 52.522}],
            },
            {
                "type": "node",
                "id": 9,
                "lat": 52.5205,
                "lon": 13.4021,
                "tags": {"place": "square", "name": "Market Square"},
            },
        ]
    }
    upstream.handlers["overpass-api.de"] = lambda r: httpx.Response(200, json=payload)
    res = client.get("/api/v1/osm/features-near", params={"lon": 13.4041, "lat": 52.5201, "radius_m": 300})
    data = res.json()["data"]
    by_name = {f["name"]: f for f in data}
    # Major road meets a side street: an intersection; two minor streets do not count.
    assert by_name["Main Street / Elm Street"]["category"] == "intersection"
    assert by_name["Main Street / Elm Street"]["position"] == [13.402, 52.52]
    assert "Ash Lane / Oak Lane" not in by_name and "Oak Lane / Ash Lane" not in by_name
    # A street's position is its nearest vertex to the query point.
    assert by_name["Main Street"]["position"] == [13.404, 52.52]
    assert by_name["Market Square"]["category"] == "place"
    sent = parse_qs(upstream.requests[0].content.decode())["data"][0]
    assert ".hw out geom" in sent


async def test_retry_honours_429_then_succeeds(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    delays: list[float] = []

    async def fake_sleep(d: float) -> None:
        delays.append(d)

    monkeypatch.setattr("app.providers.base.asyncio.sleep", fake_sleep)
    calls = {"n": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(429, headers={"Retry-After": "2"}) if calls["n"] == 1 else httpx.Response(200, json={})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        res = await fetch_with_retry(c, "GET", "https://overpass-api.de/api/interpreter", settings)
    assert res.status_code == 200
    assert delays == [2.0]


def test_disabled_provider_reports_not_configured(
    make_client: Callable[[Settings], TestClient], settings: Settings
) -> None:
    c = make_client(settings.model_copy(update={"overpass_enabled": False}))
    res = c.get("/api/v1/osm/features-near", params={"lon": 1, "lat": 1})
    assert res.status_code == 503
    assert res.json()["capability"]["state"] == "not_configured"


def test_provider_list(client: TestClient) -> None:
    providers = {p["id"]: p for p in client.get("/api/v1/providers").json()["providers"]}
    assert providers["overpass"]["capability"]["state"] == "available"
    assert providers["arcgis-traffic"]["capability"]["state"] == "not_configured"
    assert providers["camara-population"]["capability"]["state"] == "not_configured"
    assert providers["transport-rest"]["capability"]["state"] == "not_configured"
    assert all(isinstance(p["sendsProjectDataToThirdParty"], bool) for p in providers.values())


def test_geocode(client: TestClient, upstream: Upstream) -> None:
    upstream.handlers["nominatim.openstreetmap.org"] = lambda r: httpx.Response(
        200,
        json=[
            {"display_name": "Somewhere", "lat": "48.1", "lon": "11.5", "boundingbox": ["48.0", "48.2", "11.4", "11.6"]}
        ],
    )
    body = client.get("/api/v1/geocode", params={"q": "somewhere"}).json()
    assert body["data"][0]["position"] == [11.5, 48.1]
    assert body["data"][0]["bbox"] == [11.4, 48.0, 11.6, 48.2]
    assert upstream.requests[0].url.params["format"] == "jsonv2"
    client.get("/api/v1/geocode", params={"q": "SOMEWHERE"})
    assert len(upstream.requests) == 1  # cached, case-insensitive


def test_provider_rate_limit(
    make_client: Callable[[Settings], TestClient], settings: Settings, upstream: Upstream
) -> None:
    upstream.handlers["nominatim.openstreetmap.org"] = lambda r: httpx.Response(200, json=[])
    c = make_client(settings.model_copy(update={"provider_rate_limit_per_minute": 1}))
    assert c.get("/api/v1/geocode", params={"q": "aa"}).status_code == 200
    assert c.get("/api/v1/geocode", params={"q": "bb"}).status_code == 429


# --- CAMARA ------------------------------------------------------------------


def test_geohash_decode() -> None:
    w, s, e, n = geohash_bounds("u33dc0")
    assert 13.3 < w < e < 13.5 and 52.4 < s < n < 52.6


def test_camara_request_shape_and_limits() -> None:
    start = datetime(2026, 10, 1, tzinfo=UTC)
    req = build_request([(13.4, 52.5), (13.5, 52.5), (13.5, 52.6)], start, start + timedelta(hours=1), 7)
    assert req["area"]["areaType"] == "POLYGON"
    assert req["area"]["boundary"][0] == {"latitude": 52.5, "longitude": 13.4}
    with pytest.raises(ProviderError):
        build_request([(0, 0), (1, 1)], start, start, 7)
    with pytest.raises(ProviderError):
        build_request([(0, 0), (1, 0), (1, 1)], start, start + timedelta(days=8), 7)


def test_camara_parse_low_central_high() -> None:
    cells = parse_response(
        {
            "status": "SUPPORTED_AREA",
            "timedPopulationDensityData": [
                {
                    "startTime": "x",
                    "endTime": "y",
                    "cellPopulationDensityData": [
                        {
                            "geohash": "u33dc0",
                            "dataType": "DENSITY_ESTIMATION",
                            "minPplDensity": 10,
                            "pplDensity": 20,
                            "maxPplDensity": 30,
                        },
                        {"geohash": "u33dc1", "dataType": "LOW_DENSITY"},
                        {"geohash": "u33dc2", "dataType": "NO_DATA"},
                    ],
                }
            ],
        }
    )
    assert cells[0].density is not None and cells[0].density.central == 20
    assert [c.dataType for c in cells] == ["density_estimation", "low_density", "no_data"]
    assert all(c.status == "estimated" for c in cells)
    with pytest.raises(ProviderError) as e:
        parse_response({"status": "AREA_NOT_SUPPORTED"})
    assert e.value.state == CapabilityState.coverage_unavailable


async def test_camara_client_credentials_flow(upstream: Upstream) -> None:
    s = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        outbound_dns_check=False,
        outbound_allowlist=[
            "overpass-api.de",
            "nominatim.openstreetmap.org",
            "v6.db.transport.rest",
            "traffic.arcgis.com",
            "op.example",
        ],
        camara_population_url="https://op.example/population-density-data/v0.3",
        camara_token_url="https://op.example/oauth/token",
        camara_client_id="client",
        camara_client_secret="secret",
    )

    def handler(r: httpx.Request) -> httpx.Response:
        if r.url.path == "/oauth/token":
            assert parse_qs(r.content.decode())["grant_type"] == ["client_credentials"]
            assert r.headers["authorization"].startswith("Basic ")
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        assert r.url.path.endswith("/retrieve")
        assert r.headers["authorization"] == "Bearer tok"
        assert json.loads(r.content)["precision"] == 7
        return httpx.Response(200, json={"status": "PART_OF_AREA_NOT_SUPPORTED", "timedPopulationDensityData": []})

    upstream.handlers["op.example"] = handler
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as c:
        p = CamaraPopulationProvider(s, c)
        assert p.capability().state == CapabilityState.available
        start = datetime(2026, 10, 1, tzinfo=UTC)
        res = await p.density([(13.4, 52.5), (13.5, 52.5), (13.5, 52.6)], start, start + timedelta(hours=1))
        await p.density([(13.4, 52.5), (13.5, 52.5), (13.5, 52.6)], start, start + timedelta(hours=1))
    assert res.capability.state == CapabilityState.using_fallback
    # Token is cached between calls.
    assert sum(1 for r in upstream.requests if r.url.path == "/oauth/token") == 1


def test_transit_disabled_by_default(client: TestClient, upstream: Upstream) -> None:
    res = client.get("/api/v1/transit/stops-near", params={"lon": 13.4, "lat": 52.5})
    assert res.status_code == 503
    assert upstream.requests == []


def test_transit_enabled_parses_stops(
    make_client: Callable[[Settings], TestClient], settings: Settings, upstream: Upstream
) -> None:
    upstream.handlers["v6.db.transport.rest"] = lambda r: httpx.Response(
        200,
        json=[
            {
                "id": "1",
                "name": "Hbf",
                "location": {"latitude": 52.5, "longitude": 13.37},
                "products": {"suburban": True, "bus": False},
            }
        ],
    )
    c = make_client(settings.model_copy(update={"transport_rest_enabled": True}))
    body = c.get("/api/v1/transit/stops-near", params={"lon": 13.4, "lat": 52.5}).json()
    assert body["data"][0]["position"] == [13.37, 52.5]
    assert body["data"][0]["modes"] == ["suburban"]
