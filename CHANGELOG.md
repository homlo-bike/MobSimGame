# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
