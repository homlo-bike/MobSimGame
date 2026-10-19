from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures"

Handler = Callable[[httpx.Request], httpx.Response]


class Upstream:
    """Routes outbound requests to per-host handlers and records them."""

    def __init__(self) -> None:
        self.handlers: dict[str, Handler] = {}
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        handler = self.handlers.get(request.url.host)
        if handler is None:
            return httpx.Response(599, text="no handler")
        return handler(request)


@pytest.fixture
def upstream() -> Upstream:
    return Upstream()


@pytest.fixture
def settings() -> Settings:
    return Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        outbound_dns_check=False,
        rate_limit_per_minute=1000,
        provider_rate_limit_per_minute=1000,
    )


@pytest.fixture
def make_client(upstream: Upstream) -> Iterator[Callable[[Settings], TestClient]]:
    clients: list[TestClient] = []

    def factory(s: Settings) -> TestClient:
        http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        c = TestClient(create_app(s, http_client=http))
        clients.append(c)
        return c

    yield factory
    for c in clients:
        c.close()


@pytest.fixture
def client(make_client: Callable[[Settings], TestClient], settings: Settings) -> TestClient:
    return make_client(settings)


@pytest.fixture
def demo_project() -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / "demo-project.json").read_text())
    return data
