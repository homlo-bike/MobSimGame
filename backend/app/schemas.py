"""Request validation for project documents.

The browser owns the full schema (frontend/src/domain/schema.ts). The backend
validates what it relies on (identity, geometry, sizes) and keeps unknown
fields, so newer clients can store richer documents.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

Lon = Annotated[float, Field(ge=-180, le=180)]
Lat = Annotated[float, Field(ge=-90, le=90)]
LngLat = tuple[Lon, Lat]

MAX_LINES = 500
MAX_STATIONS = 5000
MAX_VERTICES = 20000


class LineIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(max_length=64)
    name: str = Field(max_length=200)
    coordinates: list[LngLat] = Field(max_length=MAX_VERTICES)


class StationIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(max_length=64)
    name: str = Field(max_length=200)
    position: LngLat


class ScenarioIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(max_length=64)
    name: str = Field(max_length=200)
    lines: list[LineIn] = Field(max_length=MAX_LINES)
    stations: list[StationIn] = Field(max_length=MAX_STATIONS)


class ProjectIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    # 1 is still accepted: the browser migrates older documents when it opens them.
    schemaVersion: int = Field(ge=1, le=2)
    id: str = Field(max_length=64)
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    fictional: bool
    scenarios: list[ScenarioIn] = Field(min_length=1, max_length=50)
    activeScenarioId: str

    @field_validator("scenarios")
    @classmethod
    def _active_exists(cls, v: list[ScenarioIn]) -> list[ScenarioIn]:
        ids = [s.id for s in v]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate scenario ids")
        return v


class ProjectEnvelope(BaseModel):
    project: ProjectIn


class ShareCreated(BaseModel):
    id: str
    edit_token: str | None = None
    created_at: str
    updated_at: str


class SharedProjectOut(BaseModel):
    id: str
    project: dict[str, Any]
    created_at: str
    updated_at: str
