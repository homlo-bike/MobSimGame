# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Licence: the project is now GNU AGPL-3.0-only** (previously MIT), so that it fits
  the bundled `@sakuzu/maplibre-gl-draw` (AGPL-3.0-only) and all other dependencies
  without conflict. `LICENSE` holds the verbatim GNU text; `NOTICE` holds the copyright
  and licence notice and the licence history. Versions up to `20cce9e` remain MIT.
- `THIRD_PARTY_NOTICES.md` now lists every direct dependency, container image, CI
  action, map style, font, dataset and service with licence link and repository URL,
  plus a licence-compatibility table.
- Generated licence reports in `docs/licenses/` now include licence links and
  repository URLs for every production and development package
  (`npm run licenses`, `backend/scripts/license_report.py`).
- In-app "Data & licences" dialog and the server HTML report state the new licence.

## [0.1.0] — Phase 1 vertical slice

### Added

- Frontend (React, TypeScript, Vite, Tailwind, MapLibre 6.11, maplibre-gl-draw 2.2,
  Zustand, Zod): map editor, line drawing and vertex editing, stations with
  snapping and sharing, modes, direction, per-segment structure/right of
  way/tracks, terminations (ends, ring, loop), inspectors, validation findings,
  split/join, shared-track detection, scenarios, undo/redo, local autosave,
  project JSON, GeoJSON import/export, CSV export, table-based editing,
  illustrative vehicle animation, schematic map PoC with SVG/PNG export,
  demonstration dashboard, data-sources dialog, fictional demo project.
- Provider interfaces with provenance and capability states; mock providers;
  backend clients for Overpass and Nominatim.
- Backend (FastAPI, SQLAlchemy, GeoAlchemy2, Alembic, PostGIS): health, project
  share/load/update/delete with edit tokens and audit log, provider list,
  OSM features, geocoding, transport.rest (opt-in), CAMARA adapter (disabled until
  configured), ArcGIS traffic placeholder (disabled), HTML report, PDF contract (501).
- Security: CSP and security headers, CORS allow-list, body-size and rate limits,
  SSRF guard, settings validation, bundle secret scan.
- Docker Compose (PostGIS, API, nginx web; dev profile), GitHub Actions CI.
- Documentation: architecture, ADRs, methodology, provenance, providers,
  self-hosting, reference feature review, licensing options, third-party notices.
