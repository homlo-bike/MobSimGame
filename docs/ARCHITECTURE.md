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
│ health · auth · projects (share, login) · providers         │
│ (Overpass, examples, signals, Nominatim, Valhalla*, CAMARA*, │
│ ArcGIS*, transport.rest*) · reports (HTML, PDF 501)          │
│ security: headers, CSP, CORS, size + rate limits, SSRF guard │
└───────────────┬─────────────────────────────────────────────┘
                │ SQLAlchemy / GeoAlchemy2 / Alembic
         PostgreSQL 16 + PostGIS 3.4 (shared projects, audit log)
* disabled unless configured; Valhalla runs as an optional internal service
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
| `domain/` | Zod schema 3 (Project, Scenario with `trackNetwork` (nodes, physical tracks, double-track groups, movements), TransportLine with `alignment` (track / routed / polyline), Station with track references, metadata, …), track operations (`tracks.ts`), track graph (`trackGraph.ts`), services on tracks (`serviceRouting.ts`), parameters with sources (`trackParameters.ts`), mode metadata and cited curve radii, network operations, signals, example-network conversion |
| `routing/` | Street-routing requests for bus/BRT lines (backend client + store glue) |
| `api/` | Backend clients: sharing (with login), auth session, example networks |
| `geo/` | Geometry (length, snapping, slicing, curvature, overlap), `geo/track/` (project metric frame, lines and circular arcs, PI alignments, fitting), segment table operations, GeoJSON/CSV I/O |
| `validation/` | Findings engine (information / recommendation / warning / blocking) |
| `analysis/` | Range arithmetic, units, deterministic formulas, demonstration assumptions and analysis |
| `simulation/` | Trip-based vehicle model (signals, closures, crossovers, track occupancy and separation) and simulation clock |
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

## Line geometry

Physical track and services are separate ([TRACK_ARCHITECTURE.md](TRACK_ARCHITECTURE.md)).
Tracks live in `scenario.trackNetwork`; each is one physical track between two nodes,
edited as points with radii; lines and arcs are derived. Double track is two tracks.
`TransportLine.coordinates` is always the resulting geometry used by every
measurement, renderer and the simulation. `alignment` keeps what defines it: the
track path of a rail service (derived from its stops), route waypoints with
per-section status and geometry (bus/BRT), or nothing for straight segments. The
draw library edits track points and bus/straight-line handles; `domain/tracks.ts`,
`domain/serviceRouting.ts` and `domain/alignment.ts` recompute the geometry.

## Data flow for sharing

1. User signs in (`POST /api/v1/auth/login`, signed expiring bearer token kept for the
   tab) and chooses **File › Save to server and share**. The browser POSTs the project
   JSON with the token.
2. The API validates identity, geometry ranges and sizes (unknown fields are kept),
   stores it with an unguessable id and returns a separate edit token (only its
   SHA-256 hash is stored). An audit entry with a hashed client id is written.
3. `?share=<id>` loads it read-only into a new browser session; the edit token
   (kept in the sharer's localStorage) allows updates.

## Browser state

The project is the persistent document (Zustand store, undo/redo, autosaved to the
browser project library). Everything else is UI or runtime state and never enters the
project: selection, tools, closures, the connection/update status
(`store/connection.ts`, `runtime/`), and the notification centre
(`store/notifications.ts`). Caching and updates: [CACHING.md](CACHING.md).

## Logging

One logger per side, configured at start-up: `backend/app/logging_config.py`
(`MOBSIM_LOG_LEVEL`, `MOBSIM_LOG_FORMAT`) and `frontend/src/util/logger.ts`
(`VITE_LOG_LEVEL`). JSON in production, readable text in development, debug always
off in production, sensitive keys redacted, request logs without query strings.
See [LOGGING.md](LOGGING.md).

## Simulation

`simulation/engine.ts` builds, per line, a cyclic list of phases (run, dwell,
layover) from segment speeds and stop chainages. Vehicle positions are a pure
function of simulated time; the renderer samples it each animation frame (or
every 2 s with reduced motion). See `docs/METHODOLOGY.md`.

## Future: regional OSM extracts

For heavy or offline use, a planned importer will load a regional PBF extract
(e.g. from Geofabrik) into PostGIS with osm2pgsql and expose the same
`OsmFeatureProvider` contract from SQL, replacing Overpass for that region.
