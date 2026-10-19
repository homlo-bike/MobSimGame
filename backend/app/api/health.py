from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import __version__
from .deps import get_db

router = APIRouter(tags=["health"])


@router.get("/api/health")
def health(db: Annotated[Session, Depends(get_db)]) -> dict[str, object]:
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception:  # pragma: no cover - reported, not raised
        database = "unavailable"
    return {"status": "ok" if database == "ok" else "degraded", "version": __version__, "database": database}
