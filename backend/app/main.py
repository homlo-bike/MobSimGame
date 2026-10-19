"""Application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .api import health, projects, providers, reports
from .config import Settings, get_settings
from .db import Base, make_engine, session_factory
from .providers.registry import build_providers
from .security import BodySizeLimitMiddleware, RateLimiter, RateLimitMiddleware, SecurityHeadersMiddleware


def create_app(settings: Settings | None = None, http_client: httpx.AsyncClient | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = make_engine(settings.database_url)
    if settings.database_url.startswith("sqlite"):
        # Development/tests only: PostgreSQL schemas are managed by Alembic.
        Base.metadata.create_all(engine)

    client = http_client or httpx.AsyncClient(follow_redirects=False)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if http_client is None:
            await client.aclose()
        engine.dispose()

    app = FastAPI(
        title="MobSimGame API",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs" if settings.environment != "production" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.environment != "production" else None,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory(engine)
    app.state.providers = build_providers(settings, client)
    app.state.provider_limiter = RateLimiter(settings.provider_rate_limit_per_minute)

    # Order: last added runs first.
    app.add_middleware(RateLimitMiddleware, per_minute=settings.rate_limit_per_minute)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "X-Edit-Token"],
        allow_credentials=False,
    )
    app.add_middleware(SecurityHeadersMiddleware)

    app.include_router(health.router)
    app.include_router(projects.router)
    app.include_router(providers.router)
    app.include_router(reports.router)
    return app


def app_factory() -> FastAPI:
    return create_app()
