from __future__ import annotations

import copy
from typing import Any

from fastapi.testclient import TestClient


def test_html_report_contract(client: TestClient, demo_project: dict[str, Any]) -> None:
    res = client.post("/api/v1/reports/html", json={"project": demo_project})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/html")
    html = res.text
    for required in (
        demo_project["name"],
        "FICTIONAL",
        "Red Line (fictional)",
        "Assumptions",
        "Data sources",
        "OpenStreetMap contributors",
        "Limitations",
        "methodology",
        "[longitude, latitude]",
    ):
        assert required in html


def test_html_report_escapes_user_content(client: TestClient, demo_project: dict[str, Any]) -> None:
    p = copy.deepcopy(demo_project)
    p["name"] = "<script>alert(1)</script>"
    html = client.post("/api/v1/reports/html", json={"project": p}).text
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


def test_pdf_report_not_implemented_contract(client: TestClient, demo_project: dict[str, Any]) -> None:
    res = client.post("/api/v1/reports/pdf", json={"project": demo_project})
    assert res.status_code == 501
    assert res.json()["contract"]["response"] == "application/pdf"
