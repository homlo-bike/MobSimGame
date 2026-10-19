from __future__ import annotations

import copy
from typing import Any

from fastapi.testclient import TestClient


def test_share_and_load_roundtrip(client: TestClient, demo_project: dict[str, Any]) -> None:
    res = client.post("/api/v1/projects", json={"project": demo_project})
    assert res.status_code == 201
    body = res.json()
    assert len(body["id"]) >= 12 and body["edit_token"]
    loaded = client.get(f"/api/v1/projects/{body['id']}")
    assert loaded.status_code == 200
    project = loaded.json()["project"]
    assert project["name"] == demo_project["name"]
    # Unknown fields are preserved for the browser schema.
    assert project["scenarios"][0]["lines"][0]["segments"] == demo_project["scenarios"][0]["lines"][0]["segments"]


def test_update_requires_edit_token(client: TestClient, demo_project: dict[str, Any]) -> None:
    created = client.post("/api/v1/projects", json={"project": demo_project}).json()
    changed = copy.deepcopy(demo_project)
    changed["name"] = "Renamed"
    assert client.put(f"/api/v1/projects/{created['id']}", json={"project": changed}).status_code == 403
    bad = client.put(f"/api/v1/projects/{created['id']}", json={"project": changed}, headers={"X-Edit-Token": "wrong"})
    assert bad.status_code == 403
    ok = client.put(
        f"/api/v1/projects/{created['id']}", json={"project": changed}, headers={"X-Edit-Token": created["edit_token"]}
    )
    assert ok.status_code == 200
    assert client.get(f"/api/v1/projects/{created['id']}").json()["project"]["name"] == "Renamed"


def test_delete_project_and_audit_log(client: TestClient, demo_project: dict[str, Any]) -> None:
    from app.models import AuditLog

    created = client.post("/api/v1/projects", json={"project": demo_project}).json()
    assert (
        client.delete(f"/api/v1/projects/{created['id']}", headers={"X-Edit-Token": created["edit_token"]}).status_code
        == 204
    )
    assert client.get(f"/api/v1/projects/{created['id']}").status_code == 404
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        actions = [a.action for a in db.query(AuditLog).filter_by(project_id=created["id"]).order_by(AuditLog.id)]
    assert actions == ["create", "delete"]


def test_unknown_project_404(client: TestClient) -> None:
    assert client.get("/api/v1/projects/doesnotexist").status_code == 404


def test_rejects_invalid_geometry(client: TestClient, demo_project: dict[str, Any]) -> None:
    bad = copy.deepcopy(demo_project)
    # Latitude out of range: a typical [lat, lon] mix-up.
    bad["scenarios"][0]["lines"][0]["coordinates"][0] = [10.0, 95.0]
    res = client.post("/api/v1/projects", json={"project": bad})
    assert res.status_code == 422


def test_rejects_wrong_schema_version(client: TestClient, demo_project: dict[str, Any]) -> None:
    bad = copy.deepcopy(demo_project)
    bad["schemaVersion"] = 99
    assert client.post("/api/v1/projects", json={"project": bad}).status_code == 422


def test_rejects_non_json(client: TestClient) -> None:
    res = client.post("/api/v1/projects", content=b"not json", headers={"Content-Type": "application/json"})
    assert res.status_code == 422
