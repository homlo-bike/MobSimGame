"""Settings from environment variables, validated at start-up.

Secrets (database password, provider tokens) are read only here and never
returned by any endpoint. See docs/PROVIDER_CONFIGURATION.md.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from .logging_config import LogFormat, LogLevelName, parse_level


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MOBSIM_", env_file=".env", extra="ignore", populate_by_name=True)

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "sqlite+pysqlite:///./mobsim-dev.sqlite3"
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:5173"])
    public_base_url: str = "http://localhost:5173"

    # Logging (see app/logging_config.py). Debug is never enabled in production.
    log_level: LogLevelName = Field(
        default="info",
        validation_alias=AliasChoices("MOBSIM_LOG_LEVEL", "LOG_LEVEL"),
    )
    log_format: LogFormat = "auto"

    # Saving and sharing to the server requires this login. Change the password in .env;
    # the API refuses to start in production while it is still the default.
    admin_username: str = "admin"
    admin_password: SecretStr = SecretStr("admin")
    # Signs login sessions. Unset: a random key per process (sessions end on restart).
    session_secret: SecretStr | None = None
    session_ttl_s: int = 8 * 3600
    login_attempts_per_minute: int = 10

    # Request limits
    max_request_bytes: int = 5 * 1024 * 1024
    rate_limit_per_minute: int = 120
    provider_rate_limit_per_minute: int = 20

    # Outbound HTTP: only these hosts may be contacted (SSRF protection).
    outbound_allowlist: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "overpass-api.de",
            "overpass.kumi.systems",
            "nominatim.openstreetmap.org",
            "v6.db.transport.rest",
            "v6.vbb.transport.rest",
            "v6.bvg.transport.rest",
            "traffic.arcgis.com",
        ]
    )
    # Resolve outbound hosts and refuse private/loopback addresses (disable only behind a trusted egress proxy).
    outbound_dns_check: bool = True
    user_agent: str = "MobSimGame/0.1 (self-hosted; +https://github.com/homlo-bike/MobSimGame)"
    contact_email: str | None = None

    # OpenStreetMap / Overpass
    overpass_enabled: bool = True
    overpass_url: str = "https://overpass-api.de/api/interpreter"
    overpass_timeout_s: int = 25
    overpass_max_bbox_km2: float = 25.0
    overpass_max_radius_m: int = 1000
    overpass_cache_ttl_s: int = 24 * 3600
    # Example city networks (full tram/metro/bus networks) are large queries: cache them long.
    examples_timeout_s: int = 180
    examples_cache_ttl_s: int = 7 * 24 * 3600

    # Nominatim
    geocoder_enabled: bool = True
    nominatim_url: str = "https://nominatim.openstreetmap.org/search"
    geocoder_cache_ttl_s: int = 7 * 24 * 3600

    # ArcGIS traffic (disabled unless a token is configured)
    arcgis_traffic_url: str = "https://traffic.arcgis.com/arcgis/rest/services/World/Traffic/MapServer"
    arcgis_token: SecretStr | None = None

    # CAMARA population density (disabled unless fully configured)
    camara_population_url: str | None = None
    camara_token_url: str | None = None
    camara_client_id: str | None = None
    camara_client_secret: SecretStr | None = None

    # Street routing for bus and BRT: a self-hosted Valhalla on the private network
    # (Compose profile "routing"), e.g. http://valhalla:8002. Disabled when unset.
    valhalla_url: str | None = None
    valhalla_timeout_s: int = 20
    routing_max_waypoints: int = 50
    routing_cache_ttl_s: int = 7 * 24 * 3600

    # transport.rest (disabled by default; best-effort community service)
    transport_rest_enabled: bool = False
    transport_rest_url: str = "https://v6.db.transport.rest"

    @field_validator("log_level", mode="before")
    @classmethod
    def _level(cls, v: object) -> object:
        if v is None or (isinstance(v, str) and not v.strip()):
            return "info"
        parsed = parse_level(str(v))
        if parsed is None:
            raise ValueError(f"Unknown log level {v!r}; use debug, info (log), warning (warn) or error")
        return parsed

    @field_validator("cors_origins", "outbound_allowlist", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

    @field_validator(
        "contact_email",
        "session_secret",
        "valhalla_url",
        "arcgis_token",
        "camara_population_url",
        "camara_token_url",
        "camara_client_id",
        "camara_client_secret",
        mode="before",
    )
    @classmethod
    def _empty_is_none(cls, v: object) -> object:
        # Compose passes unset optional variables as empty strings; treat them as absent.
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @model_validator(mode="after")
    def _check(self) -> Settings:
        for name in ("overpass_url", "nominatim_url", "arcgis_traffic_url", "transport_rest_url"):
            url = getattr(self, name)
            parsed = urlparse(url)
            if parsed.scheme != "https":
                raise ValueError(f"{name} must use https")
            if parsed.hostname not in self.outbound_allowlist:
                raise ValueError(f"{name} host {parsed.hostname!r} is not in MOBSIM_OUTBOUND_ALLOWLIST")
        if self.valhalla_url and urlparse(self.valhalla_url).scheme not in ("http", "https"):
            raise ValueError("valhalla_url must be an http(s) URL")
        if self.environment == "production" and self.admin_password.get_secret_value() == "admin":
            raise ValueError("Set MOBSIM_ADMIN_PASSWORD: the default password is not allowed in production")
        if not self.admin_username.strip() or not self.admin_password.get_secret_value():
            raise ValueError("MOBSIM_ADMIN_USERNAME and MOBSIM_ADMIN_PASSWORD must not be empty")
        if self.environment == "production" and "*" in self.cors_origins:
            raise ValueError("Wildcard CORS origins are not allowed in production")
        if self.max_request_bytes > 50 * 1024 * 1024:
            raise ValueError("max_request_bytes is capped at 50 MB")
        return self

    @property
    def camara_configured(self) -> bool:
        return bool(
            self.camara_population_url and self.camara_token_url and self.camara_client_id and self.camara_client_secret
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
