"""Report endpoints.

Phase 1 provides a print-friendly HTML report generated on the server from the
submitted project (nothing is stored). The PDF endpoint defines its contract and
returns 501 until the Phase 5 rendering pipeline (headless browser) exists.
"""

from __future__ import annotations

from datetime import UTC, datetime
from html import escape
from typing import Any

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, JSONResponse

from .. import METHODOLOGY_VERSION, __version__
from ..geo import path_length_m
from ..logging_config import get_logger
from ..schemas import ProjectEnvelope

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])
log = get_logger(__name__)

DISCLAIMER = (
    "MobSimGame is an exploratory sketch tool. This report is not transport-demand modelling, civil or railway "
    "engineering design, geotechnical investigation, environmental-impact assessment, financial appraisal or an "
    "official ridership forecast. Alignments are conceptual; validation findings are advisory."
)

ATTRIBUTION = [
    "Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL 1.0).",
    "Basemap tiles: OpenFreeMap © OpenMapTiles (when used).",
    "Map rendering: MapLibre GL JS (BSD-3-Clause). Drawing: @sakuzu/maplibre-gl-draw (AGPL-3.0-only).",
    "MobSimGame © 2026 Homlo-Bike: GNU AGPL-3.0-only, source at https://github.com/homlo-bike/MobSimGame. "
    "Datasets keep their own licences.",
]


def _e(v: Any) -> str:
    return escape(str(v), quote=True)


def render_html(doc: dict[str, Any]) -> str:
    now = datetime.now(UTC).isoformat(timespec="seconds")
    fictional = bool(doc.get("fictional"))
    parts: list[str] = [
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>",
        f"<title>{_e(doc.get('name', 'Project'))} – MobSimGame report</title>",
        "<style>body{font:14px/1.45 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#111}"
        "table{border-collapse:collapse;width:100%;margin:.5rem 0 1rem}"
        "th,td{border:1px solid #999;padding:.25rem .4rem;"
        "text-align:left}th{background:#eee}.note{border:2px solid #86198f;background:#fdf4ff;padding:.5rem}"
        "@media print{.noprint{display:none}}</style></head><body>",
        f"<h1>{_e(doc.get('name', 'Project'))}</h1>",
    ]
    if fictional:
        parts.append(
            "<p class='note'><strong>FICTIONAL demonstration project.</strong> The network, names and all figures "
            "are synthetic and describe no real place.</p>"
        )
    if doc.get("description"):
        parts.append(f"<p>{_e(doc['description'])}</p>")
    parts.append(
        "<p class='noprint'><em>Map and schematic images are not yet embedded server-side (planned for Phase 5); "
        "export them from the app (Schematic → Export SVG/PNG).</em></p>"
    )
    for sc in doc.get("scenarios", []):
        stations = {s["id"]: s for s in sc.get("stations", [])}
        parts.append(f"<h2>Scenario: {_e(sc.get('name'))}</h2>")
        if sc.get("description"):
            parts.append(f"<p>{_e(sc['description'])}</p>")
        parts.append(
            "<h3>Lines</h3><table><thead><tr><th>Line</th><th>Mode</th><th>Direction</th><th>Ends</th>"
            "<th>Length (km)</th><th>Stations</th><th>Structures</th></tr></thead><tbody>"
        )
        for line in sc.get("lines", []):
            ring = (line.get("termination") or {}).get("kind") == "ring"
            length_km = path_length_m(line.get("coordinates", []), ring) / 1000
            structures = sorted({seg.get("structure", "?") for seg in line.get("segments", [])})
            parts.append(
                f"<tr><td>{_e(line.get('name'))}</td><td>{_e(line.get('mode'))}</td>"
                f"<td>{_e(line.get('direction'))}</td><td>{_e((line.get('termination') or {}).get('kind'))}</td>"
                f"<td>{length_km:.2f}</td><td>{len(line.get('stops', []))}</td>"
                f"<td>{_e(', '.join(structures))}</td></tr>"
            )
        parts.append("</tbody></table>")
        parts.append(
            "<h3>Stations</h3><table><thead><tr><th>Station</th><th>Lines</th><th>Construction</th>"
            "<th>Longitude</th><th>Latitude</th></tr></thead><tbody>"
        )
        for sid, st in stations.items():
            served = [
                ln.get("name")
                for ln in sc.get("lines", [])
                if any(x.get("stationId") == sid for x in ln.get("stops", []))
            ]
            pos = st.get("position", [0, 0])
            parts.append(
                f"<tr><td>{_e(st.get('name'))}</td><td>{_e(', '.join(map(str, served)))}</td>"
                f"<td>{_e(st.get('construction'))}</td><td>{float(pos[0]):.6f}</td><td>{float(pos[1]):.6f}</td></tr>"
            )
        parts.append("</tbody></table>")
    parts.append("<h2>Assumptions</h2>")
    sets = doc.get("assumptionSets", [])
    if not sets:
        parts.append("<p>No assumption set recorded with the project.</p>")
    for aset in sets:
        parts.append(
            f"<h3>{_e(aset.get('name'))} (v{_e(aset.get('version'))})</h3><table><thead><tr><th>Assumption</th>"
            "<th>Low</th><th>Central</th><th>High</th><th>Unit</th><th>Status</th><th>Source</th></tr></thead><tbody>"
        )
        for a in aset.get("assumptions", []):
            v = a.get("value", {})
            parts.append(
                f"<tr><td>{_e(a.get('label'))}</td><td>{_e(v.get('low'))}</td><td>{_e(v.get('central'))}</td>"
                f"<td>{_e(v.get('high'))}</td><td>{_e(a.get('unit'))}</td><td>{_e(a.get('status'))}</td>"
                f"<td>{_e(a.get('source'))}</td></tr>"
            )
        parts.append("</tbody></table>")
    parts.append(
        "<h2>Estimates and uncertainty</h2><p>Phase 1 estimates (dashboard) use a synthetic demonstration "
        "assumption set and are not reproduced as findings here. See docs/METHODOLOGY.md.</p>"
    )
    parts.append("<h2>Data sources</h2><ul>")
    for d in doc.get("datasetReferences", []):
        p = d.get("provenance", {})
        parts.append(
            f"<li>{_e(p.get('dataset'))} — {_e(p.get('provider'))}; status: {_e(p.get('status'))}; "
            f"licence: {_e(p.get('license'))}; {_e(' '.join(p.get('limitations', [])))}</li>"
        )
    parts.append("</ul><h2>Licences and attribution</h2><ul>")
    parts.extend(f"<li>{_e(a)}</li>" for a in ATTRIBUTION)
    parts.append(
        f"</ul><h2>Limitations</h2><p>{_e(DISCLAIMER)}</p>"
        f"<p><small>Generated {now} by MobSimGame {__version__}, methodology {METHODOLOGY_VERSION}. "
        "Coordinates are WGS84 [longitude, latitude].</small></p></body></html>"
    )
    return "".join(parts)


@router.post("/html", response_class=HTMLResponse)
def html_report(envelope: ProjectEnvelope) -> HTMLResponse:
    html = render_html(envelope.project.model_dump(mode="json"))
    log.info("HTML report generated", extra={"scenarios": len(envelope.project.scenarios), "bytes": len(html)})
    return HTMLResponse(html)


@router.post("/pdf")
def pdf_report(envelope: ProjectEnvelope) -> JSONResponse:
    """Contract: POST {project} → application/pdf. Not implemented until Phase 5."""
    log.info("PDF report requested but not implemented (Phase 5)")
    return JSONResponse(
        {
            "detail": "PDF rendering is not implemented yet (Phase 5). Use /api/v1/reports/html and print to PDF.",
            "contract": {"request": "application/json {project}", "response": "application/pdf"},
            "project": envelope.project.name,
        },
        status_code=501,
    )
