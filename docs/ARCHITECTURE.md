# Architecture

MobSimGame is a browser application. Everything a user edits, validates, animates
and analyses runs in the browser. The backend is optional for core editing; it
saves/shares projects, proxies data providers that need credentials, caching or a
fair-use policy, and renders reports.

```
┌────────────────────────── Browser ──────────────────────────┐
│ React UI (ui/)  ─ Zustand store (store/) ─ project document │
│      │                     │  undo/redo, localStorage       │
│      ▼                     ▼                                │
│ map/ MapLibre + maplibre-gl-draw   domain/ geo/ validation/ │
│      (rendering & editing only)    analysis/ simulation/    │
│                                    schematic/ (pure TS)     │
│ providers/ (interfaces, mocks, backend clients)             │
└───────────────┬─────────────────────────────────────────────┘
                │ /api (same origin via nginx or Vite proxy)
┌───────────────▼──────────── FastAPI (backend/app) ──────────┐
│ health · projects (share) · providers (Overpass, Nominatim, │
│ CAMARA, ArcGIS*, transport.rest*) · reports (HTML, PDF 501)  │
│ security: headers, CSP, CORS, size + rate limits, SSRF guard │
└───────────────┬─────────────────────────────────────────────┘
                │ SQLAlchemy / GeoAlchemy2 / Alembic
         PostgreSQL 16 + PostGIS 3.4 (shared projects, audit log)
* disabled unless configured
```

## Coordinates and units

- Interchange format: WGS84 / EPSG:4326, GeoJSON order **`[longitude, latitude]`**.
  Human-typed search coordinates are accepted as "latitude, longitude" (the common
  convention) and converted; typed line coordinates in the Table view are
  "longitude, latitude" (GeoJSON order) and labelled as such.
- Browser measures use Turf's spherical-earth formulas (sketch accuracy).
  Precise local measures will use a projected CRS in PostGIS (Phase 2); shared
  project extents are already stored as `geometry(POLYGON, 4326)` with a GiST index.
- Units: metres, km/h, seconds internally; metric display by default, imperial
  optional.

## Frontend modules (`frontend/src`)

| Module | Responsibility |
| --- | --- |
| `domain/` | Zod schema (Project, Scenario, TransportSystem, TransportLine, TrackSegment, Station, Platform, Interchange, Depot, SharedTrack, ServicePattern, VehicleType, AssumptionSet, DatasetReference, AnalysisResult, Provenance), mode metadata, placeholder mode profiles, network operations, fictional demo |
| `geo/` | Geometry (length, snapping, slicing, curvature, overlap), segment table operations, GeoJSON/CSV I/O |
| `validation/` | Findings engine (information / recommendation / warning / blocking) |
| `analysis/` | Range arithmetic, units, deterministic formulas, demonstration assumptions and analysis |
| `simulation/` | Time-based vehicle model and simulation clock |
| `schematic/` | Octilinear schematic layout and text alternative |
| `providers/` | Interfaces, provenance helpers, mock providers, backend clients, basemaps |
| `map/` | MapLibre map, draw adapter, layer definitions, overlay builders |
| `store/` | Zustand store with history; persistence helpers |
| `ui/` | Accessible components (inspectors, lists, dashboard, schematic, table view) |
| `i18n/` | Message dictionary and locale/direction switch |

Boundaries: `domain`, `geo`, `validation`, `analysis`, `simulation` and
`schematic` must not import React, MapLibre or the store. `map/` renders and
forwards edits; it does not decide domain rules.

## Backend modules (`backend/app`)

| Module | Responsibility |
| --- | --- |
| `config.py` | Validated settings from `MOBSIM_*` env vars (secrets as `SecretStr`) |
| `security.py` | Security headers/CSP, body-size limit, rate limiter, outbound URL guard |
| `providers/` | Provider base (provenance, capability, retry, cache) and adapters |
| `api/` | Routers: health, projects, providers, reports |
| `models.py`, `db.py`, `alembic/` | Persistence (JSONB document + PostGIS extent, audit log) |

## Data flow for sharing

1. User clicks **Share**. The browser POSTs the project JSON.
2. The API validates identity, geometry ranges and sizes (unknown fields are kept),
   stores it with an unguessable id and returns a separate edit token (only its
   SHA-256 hash is stored). An audit entry with a hashed client id is written.
3. `?share=<id>` loads it read-only into a new browser session; the edit token
   (kept in the sharer's localStorage) allows updates.

## Simulation

`simulation/engine.ts` builds, per line, a cyclic list of phases (run, dwell,
layover) from segment speeds and stop chainages. Vehicle positions are a pure
function of simulated time; the renderer samples it each animation frame (or
every 2 s with reduced motion). See `docs/METHODOLOGY.md`.

## Future: regional OSM extracts

For heavy or offline use, a planned importer will load a regional PBF extract
(e.g. from Geofabrik) into PostGIS with osm2pgsql and expose the same
`OsmFeatureProvider` contract from SQL, replacing Overpass for that region.
