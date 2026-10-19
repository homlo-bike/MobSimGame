"""Persistence models: shared projects and an audit log of modifications."""

from __future__ import annotations

from datetime import UTC, datetime

from geoalchemy2 import Geometry
from sqlalchemy import JSON, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


# JSONB + PostGIS geometry on PostgreSQL; plain JSON/WKT text on SQLite (tests).
DocumentType = JSON().with_variant(JSONB(), "postgresql")
ExtentType = Text().with_variant(Geometry("POLYGON", srid=4326, spatial_index=True), "postgresql")


class SharedProject(Base):
    __tablename__ = "shared_projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    edit_token_hash: Mapped[str] = mapped_column(String(128))
    name: Mapped[str] = mapped_column(String(200))
    fictional: Mapped[bool] = mapped_column(default=False)
    schema_version: Mapped[int] = mapped_column(Integer)
    document: Mapped[dict[str, object]] = mapped_column(DocumentType)
    # Bounding box of the network in EPSG:4326 (EWKT on write), for future spatial queries.
    extent: Mapped[str | None] = mapped_column(ExtentType, nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # No foreign key: audit entries outlive deleted projects.
    project_id: Mapped[str] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(20))
    # Hashed client address (no raw IPs stored).
    client: Mapped[str] = mapped_column(String(32))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
