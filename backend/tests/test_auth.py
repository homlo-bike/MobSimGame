from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.auth import SessionSigner
from app.config import Settings


def test_saving_requires_login(client: TestClient, demo_project: dict[str, Any]) -> None:
    res = client.post("/api/v1/projects", json={"project": demo_project})
    assert res.status_code == 401
    assert res.headers["WWW-Authenticate"] == "Bearer"


def test_shared_links_stay_public(admin: TestClient, demo_project: dict[str, Any]) -> None:
    created = admin.post("/api/v1/projects", json={"project": demo_project}).json()
    del admin.headers["Authorization"]
    assert admin.get(f"/api/v1/projects/{created['id']}").status_code == 200
    # Updating needs both the login and the edit token.
    res = admin.put(
        f"/api/v1/projects/{created['id']}",
        json={"project": demo_project},
        headers={"X-Edit-Token": created["edit_token"]},
    )
    assert res.status_code == 401


def test_login_rejects_wrong_password(client: TestClient) -> None:
    res = client.post("/api/v1/auth/login", json={"username": "admin", "password": "nope"})
    assert res.status_code == 401
    assert "token" not in res.text


def test_me_reports_the_user(admin: TestClient) -> None:
    assert admin.get("/api/v1/auth/me").json()["username"] == "admin"


def test_tampered_or_expired_tokens_are_rejected(settings: Settings) -> None:
    signer = SessionSigner(settings)
    token, _ = signer.issue("admin", now=1000)
    assert signer.verify(token, now=1001) == "admin"
    assert signer.verify(token, now=1000 + settings.session_ttl_s + 1) is None
    payload, sig = token.split(".")
    assert signer.verify(f"{payload}.{sig[:-2]}xx", now=1001) is None
    assert signer.verify("garbage", now=1001) is None
    # A token from another key (e.g. before a restart without MOBSIM_SESSION_SECRET) is invalid.
    assert SessionSigner(settings).verify(token, now=1001) is None


def test_credentials_come_from_settings(make_client: Callable[[Settings], TestClient], settings: Settings) -> None:
    custom = settings.model_copy(update={"admin_username": "planner", "admin_password": SecretStr("s3cret-long")})
    c = make_client(custom)
    assert c.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"}).status_code == 401
    assert c.post("/api/v1/auth/login", json={"username": "planner", "password": "s3cret-long"}).status_code == 200


def test_login_attempts_are_rate_limited(make_client: Callable[[Settings], TestClient], settings: Settings) -> None:
    c = make_client(settings.model_copy(update={"login_attempts_per_minute": 2}))
    for _ in range(2):
        c.post("/api/v1/auth/login", json={"username": "admin", "password": "x"})
    assert c.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"}).status_code == 429


def test_production_refuses_default_password() -> None:
    with pytest.raises(ValidationError, match="MOBSIM_ADMIN_PASSWORD"):
        Settings(environment="production", database_url="sqlite+pysqlite:///:memory:", cors_origins=["https://x"])
    ok = Settings(
        environment="production",
        database_url="sqlite+pysqlite:///:memory:",
        cors_origins=["https://x"],
        admin_password=SecretStr("a-long-unique-password"),
    )
    assert ok.admin_username == "admin"
