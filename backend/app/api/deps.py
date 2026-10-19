from __future__ import annotations

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy.orm import Session

from ..config import Settings
from ..providers.registry import Providers
from ..security import RateLimiter


def get_settings_dep(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_db(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        yield session


def get_providers(request: Request) -> Providers:
    providers: Providers = request.app.state.providers
    return providers


def get_provider_limiter(request: Request) -> RateLimiter:
    limiter: RateLimiter = request.app.state.provider_limiter
    return limiter
