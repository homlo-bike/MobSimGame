# MobSimGame

MobSimGame is a self-hosted, open-source web application for sketching and
comparing sustainable urban mobility ideas on a real map — tram, light rail,
metro, BRT, bus, commuter rail, cycling and walking corridors — and for
communicating them with transparent, clearly labelled estimates.

The app runs in the browser. The optional backend saves and shares projects,
proxies data providers and renders reports.

> **Not a professional tool.** MobSimGame does not replace transport-demand
> modelling, civil or railway engineering, geotechnical investigation,
> environmental-impact assessment, financial appraisal or official ridership
> forecasts. Every estimate shows its assumptions, status and method.

![Screenshot placeholder: map editor with the fictional demo network](docs/images/screenshot-placeholder.svg)

## Status

**Phase 1 (v0.1.0): map and network editor — working vertical slice.**
All analysis figures in this release come from a **synthetic demonstration
assumption set** and are labelled as such. See the [roadmap](#roadmap).

### Implemented

- MapLibre map with OpenFreeMap basemaps, offline plain and high-contrast styles,
  3D terrain toggle, buildings and land-use toggles, pan/zoom/rotate/tilt.
- Line drawing and vertex editing with snapping (`@sakuzu/maplibre-gl-draw`);
  lines from typed coordinates (Table view, no map needed).
- Stations snapped to lines (click or chainage); shared stations become
  interchanges; drag to move; delete; name suggestions from nearby features
  (OSM via backend, synthetic in the demo) that never overwrite user-edited names.
- Modes: bus, BRT, tram, light rail, metro, elevated rail, commuter rail, cycling,
  pedestrian, custom. One-way / bidirectional, left/right running.
- Per-segment structure (surface, underground, elevated, bridge, bored tunnel,
  cut and cover), right of way and single/double track; split/merge segments.
- Terminations: terminal/siding/turnback/depot ends, ring lines, user-defined loops.
- Validation findings (information / recommendation / warning / blocking): terminal
  or loop rule, geometry, stop spacing, curve radius, grades (with elevation data),
  structure transitions, unrouted bus alignments. Thresholds are uncited
  placeholders in Phase 1 and say so.
- Split and join lines; shared-track detection; scenario duplication and comparison.
- Undo/redo, autosave in the browser, project JSON save/load, GeoJSON import/export,
  sampled-coordinate CSV export, share links (backend).
- Illustrative vehicle animation (play/pause/reset/speed; reduced-motion mode).
- Schematic map proof of concept (octilinear, interchange and terminal symbols,
  keyboard corrections, SVG/PNG export, text alternative).
- Dashboard with low/central/high range charts, data tables, assumptions table —
  all marked DEMONSTRATION DATA.
- Print-friendly HTML report from the backend; PDF endpoint contract (returns 501).
- Fictional demonstration project (two-plus lines, interchanges, surface, tunnel and
  elevated segments, terminals, a ring line).

### Planned (not available yet)

Street routing for bus/BRT, real population/traffic/transit/elevation providers,
editable assumption sets, calibrated demand, cost/emissions/fare modules,
authentication, server-side PDF. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Important limitations

- Alignments are conceptual sketches; findings are advisory, never "safe" or
  "construction-ready".
- Distances use a spherical-earth approximation (sketch accuracy).
- Phase 1 estimates are exploratory, uncalibrated and use synthetic inputs.
- Synthetic overlays (population, traffic, existing transit) appear only in the
  fictional demo, never over real places.
- Missing OSM tags do not mean a feature does not exist.

## Architecture

React + TypeScript + Vite + Tailwind + MapLibre + Zustand + Zod in the browser;
FastAPI + SQLAlchemy/GeoAlchemy2 + Alembic + PostgreSQL/PostGIS on the server;
Docker Compose for deployment. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
decisions: [docs/architecture/](docs/architecture/README.md).

GeoJSON coordinates are always **`[longitude, latitude]`** (WGS84).

## Quick start (Docker Compose)

```sh
cp .env.example .env     # set POSTGRES_PASSWORD
docker compose up -d --build
open http://localhost:8080
```

Development with hot reload: `docker compose --profile dev up --build`
(app on http://localhost:5173).

## Local development

Requirements: Node.js ≥ 22, Python 3.12, (optionally) Docker for PostGIS.

```sh
# Frontend
cd frontend
npm ci
npm run dev                # http://localhost:5173, proxies /api to :8000

# Backend (SQLite for quick local use)
cd backend
python3.12 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app_factory --factory --reload
```

The frontend works without the backend (search falls back to an offline
coordinate parser; sharing and reports are unavailable).

## Environment variables

- Backend: `MOBSIM_*` — see [.env.example](.env.example) and
  [docs/PROVIDER_CONFIGURATION.md](docs/PROVIDER_CONFIGURATION.md).
- Frontend build: `VITE_API_BASE_URL`, `VITE_EXTRA_BASEMAPS`,
  `VITE_TERRAIN_TILES_URL`, `VITE_SOURCE_URL`, `VITE_LOG_LEVEL` — public values only
  ([frontend/.env.example](frontend/.env.example)).

## Logging

Set the minimum level with `MOBSIM_LOG_LEVEL` (or `LOG_LEVEL`) for the API and
`VITE_LOG_LEVEL` for the browser: `debug` < `info` (alias `log`) < `warning`
(alias `warn`) < `error`. Production output is structured JSON; development output
is readable and timestamped. Debug logging is always off in production, and
sensitive values are redacted. Details: [docs/LOGGING.md](docs/LOGGING.md).

## Database initialisation

With Compose, `alembic upgrade head` runs when the API starts. Manually:
`MOBSIM_DATABASE_URL=postgresql+psycopg://… alembic upgrade head` in `backend/`.

## Testing

```sh
cd frontend
npm run format:check && npm run lint && npm run typecheck && npm test
npm run test:e2e           # Playwright smoke test against the production build

cd backend
ruff format --check . && ruff check . && mypy app && pytest
MOBSIM_TEST_POSTGIS_URL=postgresql+psycopg://user:pw@localhost:5432/db pytest tests/test_postgis.py
```

## Production build

`cd frontend && npm run build && npm run check:secrets` (output in `frontend/dist`),
or `docker compose build`.

## Backup and restore

See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md#backup-and-restore).

## Providers, API keys and data provenance

- Provider setup and terms: [docs/PROVIDER_CONFIGURATION.md](docs/PROVIDER_CONFIGURATION.md)
- API keys live only in backend environment variables; nothing secret is ever
  placed in the browser bundle (enforced in CI).
- Provenance rules: [docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md)
- Formulas: [docs/METHODOLOGY.md](docs/METHODOLOGY.md)

## Attribution

Map data © OpenStreetMap contributors (ODbL). Basemaps by OpenFreeMap
© OpenMapTiles. Terrain from AWS Terrain Tiles (USGS, NOAA and other sources).
Rendering by MapLibre GL JS. Drawing by `@sakuzu/maplibre-gl-draw`.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licensing

MobSimGame — Copyright (C) 2026 Homlo-Bike — is free software under the
[GNU Affero General Public License v3.0 only](https://www.gnu.org/licenses/agpl-3.0.html)
(`AGPL-3.0-only`, see [LICENSE](LICENSE) and [NOTICE](NOTICE)). This licence matches
the bundled `@sakuzu/maplibre-gl-draw` (AGPL-3.0-only) and is compatible with every
other dependency. If you run a modified version for others over a network, you
must offer them its source; set `VITE_SOURCE_URL` so the app links to it.
Releases up to commit `20cce9e` were MIT-licensed.

Every third-party component, image, dataset and service is listed with its
licence link and repository in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md);
complete per-package lists are in [docs/licenses/](docs/licenses/). Datasets keep
their own licences. Background: [docs/LICENSING_OPTIONS.md](docs/LICENSING_OPTIONS.md),
[ADR 0003](docs/architecture/0003-drawing-library-licensing.md).

## Contributing and security

- [CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security issues: please report privately, see [SECURITY.md](SECURITY.md).

## Roadmap

1. **Phase 1 — map and network editor** (this release)
2. Phase 2 — geospatial validation (routing, PostGIS checks, real elevation, cited profiles)
3. Phase 3 — data-provider integrations (population, transit, traffic, OSM extracts)
4. Phase 4 — analysis and estimates (editable assumptions, costs, emissions, fares)
5. Phase 5 — simulation and publishing (richer simulation, schematic optimisation, PDF, accounts)
