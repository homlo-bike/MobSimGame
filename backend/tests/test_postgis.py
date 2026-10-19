"""Integration test against a real PostGIS database.

Runs only when MOBSIM_TEST_POSTGIS_URL is set (CI service container, or
`docker compose up db`). Applies Alembic migrations, then exercises the API.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.config import Settings

URL = os.environ.get("MOBSIM_TEST_POSTGIS_URL")
pytestmark = pytest.mark.skipif(not URL, reason="MOBSIM_TEST_POSTGIS_URL not set")


@pytest.fixture
def pg_settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    assert URL
    from alembic import command
    from alembic.config import Config

    monkeypatch.setenv("MOBSIM_DATABASE_URL", URL)
    from app.config import get_settings

    get_settings.cache_clear()
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    get_settings.cache_clear()
    return Settings(environment="test", database_url=URL, outbound_dns_check=False)


def test_share_roundtrip_with_postgis_extent(
    make_client: Callable[[Settings], TestClient], pg_settings: Settings, demo_project: dict[str, Any]
) -> None:
    c = make_client(pg_settings)
    assert c.get("/api/health").json()["database"] == "ok"
    created = c.post("/api/v1/projects", json={"project": demo_project}).json()
    assert c.get(f"/api/v1/projects/{created['id']}").json()["project"]["name"] == demo_project["name"]
    engine = create_engine(pg_settings.database_url)
    with engine.connect() as conn:
        srid, contains = conn.execute(
            text(
                "SELECT ST_SRID(extent), ST_Contains(extent, ST_SetSRID(ST_MakePoint(0.035, 0.02), 4326)) "
                "FROM shared_projects WHERE id = :id"
            ),
            {"id": created["id"]},
        ).one()
    engine.dispose()
    assert srid == 4326
    assert contains is True
