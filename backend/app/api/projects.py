"""Save and share projects. A project is stored only when the user shares it.

Writing (create, update, delete) requires a login (app/auth.py). Creating
returns an unguessable id (view link) and a separate edit token; only the
token's hash is stored. Anyone with the link can view a shared project.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..auth import LoggedIn
from ..geo import extent_ewkt
from ..logging_config import get_logger
from ..models import AuditLog, SharedProject
from ..schemas import ProjectEnvelope, ShareCreated, SharedProjectOut
from ..security import client_key
from .deps import get_db

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])
log = get_logger(__name__)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _points(envelope: ProjectEnvelope) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for sc in envelope.project.scenarios:
        for line in sc.lines:
            pts.extend(line.coordinates)
        pts.extend(st.position for st in sc.stations)
    return pts


def _audit(db: Session, project_id: str, action: str, request: Request) -> None:
    db.add(AuditLog(project_id=project_id, action=action, client=client_key(request)))


def _out(row: SharedProject) -> SharedProjectOut:
    return SharedProjectOut(
        id=row.id,
        project=row.document,
        created_at=row.created_at.isoformat(),
        updated_at=row.updated_at.isoformat(),
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(
    envelope: ProjectEnvelope, request: Request, db: Annotated[Session, Depends(get_db)], _user: LoggedIn
) -> ShareCreated:
    document = envelope.project.model_dump(mode="json")
    pid = secrets.token_urlsafe(12)
    token = secrets.token_urlsafe(24)
    row = SharedProject(
        id=pid,
        edit_token_hash=_hash(token),
        name=envelope.project.name,
        fictional=envelope.project.fictional,
        schema_version=envelope.project.schemaVersion,
        document=document,
        extent=extent_ewkt(_points(envelope)),
        size_bytes=len(json.dumps(document)),
    )
    db.add(row)
    db.flush()
    _audit(db, pid, "create", request)
    db.commit()
    log.info(
        "project shared",
        extra={"project_id": pid, "size_bytes": row.size_bytes, "scenarios": len(envelope.project.scenarios)},
    )
    return ShareCreated(
        id=pid, edit_token=token, created_at=row.created_at.isoformat(), updated_at=row.updated_at.isoformat()
    )


@router.get("/{project_id}")
def get_project(project_id: str, db: Annotated[Session, Depends(get_db)]) -> SharedProjectOut:
    row = db.get(SharedProject, project_id[:32])
    if row is None:
        log.debug("shared project not found", extra={"project_id": project_id[:32]})
        raise HTTPException(status_code=404, detail="Not found")
    return _out(row)


def _authorise(row: SharedProject | None, token: str | None) -> SharedProject:
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    if not token or not hmac.compare_digest(row.edit_token_hash, _hash(token)):
        # Never log the token itself; only whether one was supplied.
        log.warning("project edit refused", extra={"project_id": row.id, "token_supplied": bool(token)})
        raise HTTPException(status_code=403, detail="Edit token missing or invalid")
    return row


@router.put("/{project_id}")
def update_project(
    project_id: str,
    envelope: ProjectEnvelope,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    _user: LoggedIn,
    x_edit_token: Annotated[str | None, Header()] = None,
) -> ShareCreated:
    row = _authorise(db.get(SharedProject, project_id[:32]), x_edit_token)
    document = envelope.project.model_dump(mode="json")
    row.document = document
    row.name = envelope.project.name
    row.fictional = envelope.project.fictional
    row.extent = extent_ewkt(_points(envelope))
    row.size_bytes = len(json.dumps(document))
    _audit(db, row.id, "update", request)
    db.commit()
    log.info("shared project updated", extra={"project_id": row.id, "size_bytes": row.size_bytes})
    return ShareCreated(id=row.id, created_at=row.created_at.isoformat(), updated_at=row.updated_at.isoformat())


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    _user: LoggedIn,
    x_edit_token: Annotated[str | None, Header()] = None,
) -> None:
    row = _authorise(db.get(SharedProject, project_id[:32]), x_edit_token)
    _audit(db, row.id, "delete", request)
    db.flush()
    db.delete(row)
    db.commit()
    log.info("shared project deleted", extra={"project_id": project_id[:32]})
