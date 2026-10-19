from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.security import OutboundUrlError, RateLimiter, check_outbound_url


def test_health(client: TestClient) -> None:
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"


def test_security_headers(client: TestClient) -> None:
    res = client.get("/api/health")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert "default-src 'none'" in res.headers["content-security-policy"]
    assert res.headers["referrer-policy"] == "no-referrer"


def test_cors_allows_configured_origin_only(client: TestClient) -> None:
    ok = client.options(
        "/api/v1/providers", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"}
    )
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options(
        "/api/v1/providers", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"}
    )
    assert "access-control-allow-origin" not in bad.headers


def test_request_size_limit(make_client: Callable[[Settings], TestClient], settings: Settings) -> None:
    c = make_client(settings.model_copy(update={"max_request_bytes": 100}))
    res = c.post("/api/v1/projects", content=b"x" * 500, headers={"Content-Type": "application/json"})
    assert res.status_code == 413


def test_global_rate_limit(make_client: Callable[[Settings], TestClient], settings: Settings) -> None:
    c = make_client(settings.model_copy(update={"rate_limit_per_minute": 3}))
    codes = [c.get("/api/v1/providers").status_code for _ in range(5)]
    assert codes[:3] == [200, 200, 200]
    assert codes[3] == 429
    # Health checks are never rate limited.
    assert c.get("/api/health").status_code == 200


def test_rate_limiter_window() -> None:
    rl = RateLimiter(2)
    assert rl.allow("a", 0) and rl.allow("a", 1)
    assert not rl.allow("a", 2)
    assert rl.allow("a", 61.5)
    assert rl.allow("b", 2)


@pytest.mark.parametrize(
    "url",
    [
        "http://overpass-api.de/api/interpreter",
        "https://evil.example/x",
        "https://user:pw@overpass-api.de/api/interpreter",
        "file:///etc/passwd",
    ],
)
def test_ssrf_guard_rejects(url: str) -> None:
    with pytest.raises(OutboundUrlError):
        check_outbound_url(url, ["overpass-api.de"], resolve=False)


def test_ssrf_guard_rejects_private_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    import socket

    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(0, 0, 0, "", ("127.0.0.1", 443))])
    with pytest.raises(OutboundUrlError, match="non-public"):
        check_outbound_url("https://overpass-api.de/api/interpreter", ["overpass-api.de"])


def test_settings_validation_rejects_unlisted_provider_host() -> None:
    with pytest.raises(ValidationError, match="ALLOWLIST"):
        Settings(overpass_url="https://example.org/api/interpreter")
    with pytest.raises(ValidationError, match="https"):
        Settings(overpass_url="http://overpass-api.de/api/interpreter")


def test_settings_reject_wildcard_cors_in_production() -> None:
    with pytest.raises(ValidationError):
        Settings(environment="production", cors_origins=["*"])


def test_no_secrets_exposed(make_client: Callable[[Settings], TestClient], settings: Settings) -> None:
    secret = "super-secret-token-value"
    s = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        outbound_dns_check=False,
        arcgis_token=secret,
        camara_client_secret=secret,
        camara_client_id="id",
        camara_population_url="https://operator.example/population-density-data/v0.3",
        camara_token_url="https://operator.example/token",
    )
    c = make_client(s)
    for path in ("/api/v1/providers", "/api/health", "/api/openapi.json", "/api/v1/traffic/capability"):
        assert secret not in c.get(path).text
    assert secret not in repr(s)


def test_settings_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOBSIM_CORS_ORIGINS", "http://a.example, http://b.example")
    monkeypatch.setenv("MOBSIM_ARCGIS_TOKEN", "")
    monkeypatch.setenv("MOBSIM_CAMARA_CLIENT_SECRET", "  ")
    s = Settings()
    assert s.cors_origins == ["http://a.example", "http://b.example"]
    assert s.arcgis_token is None
    assert s.camara_client_secret is None
    assert not s.camara_configured
