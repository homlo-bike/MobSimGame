# Implementation plan

Status: Phase 1 implemented (this document reflects the repository as of v0.1.0).

## Starting point

The repository contained only `README.md` (a short vision statement) and `LICENSE`
(MIT, © 2026 Homlo-Bike). No technology stack existed, so the default stack from
the project brief was adopted (see [ADR 0001](architecture/0001-technology-stack.md)).
The project was later relicensed by its owner to AGPL-3.0-only to match the bundled
drawing library (see [ADR 0003](architecture/0003-drawing-library-licensing.md)).

## Guiding constraints

- The app lives in the browser. The backend only saves/shares projects, proxies
  providers that need credentials or caching, and renders reports.
- No invented figures: every number is calculated from geometry, entered by the
  user, or comes from a labelled assumption set with status and source.
- Phase 1 must work without paid or authenticated APIs.

## Phases

### Phase 1 — Map and network editor (done)

Vertical slice:

| Item | Where |
| --- | --- |
| Docker Compose (PostGIS, API, web; dev profile) | `docker-compose.yml` |
| Frontend shell (React, TS, Vite, Tailwind) | `frontend/src/App.tsx` |
| Backend health endpoint | `backend/app/api/health.py` |
| PostgreSQL/PostGIS + Alembic | `backend/alembic/` |
| MapLibre map + `@sakuzu/maplibre-gl-draw` | `frontend/src/map/` |
| Line drawing, vertex editing, snapping | `map/MapView.tsx`, `map/drawSync.ts` |
| Stations snapped to lines; shared stations | `domain/network.ts` |
| Direction, running side, termination | `domain/schema.ts`, `ui/LineInspector.tsx` |
| Per-segment structure, right of way, tracks | `geo/segments.ts` |
| Mode selection with documented placeholders | `domain/modes.ts` |
| Line and station inspectors | `ui/LineInspector.tsx`, `ui/StationInspector.tsx` |
| Terminal / loop / ring validation | `validation/validate.ts` |
| GeoJSON import/export, CSV export | `geo/geojson.ts` |
| Project JSON save/load, local persistence, sharing | `store/persistence.ts`, `api/projects.ts` |
| Undo/redo, scenario duplication | `store/projectStore.ts` |
| Length and station counts | `domain/network.ts`, dashboard |
| Demonstration analysis (labelled) | `analysis/` |
| Vehicle animation (time-based, not frame-based) | `simulation/engine.ts` |
| Schematic map proof of concept (SVG/PNG export) | `schematic/`, `ui/SchematicView.tsx` |
| Accessible lists, table view, keyboard shortcuts | `ui/` |
| Provider interfaces, mocks, capability states | `frontend/src/providers/`, `backend/app/providers/` |
| HTML report endpoint; PDF contract (501) | `backend/app/api/reports.py` |
| Tests and CI | `**/*.test.ts(x)`, `e2e/`, `backend/tests/`, `.github/workflows/ci.yml` |

### Phase 2 — Alignments, real networks, geospatial validation, minimal UI (in progress)

Detailed plan and owner decisions: [PHASE_2_PLAN.md](PHASE_2_PLAN.md).

Done:

- Bus and BRT lines follow streets (self-hosted Valhalla, `docs/ROUTING.md`).
- Track lines as smooth centripetal Catmull–Rom splines; cited curve radii
  (`docs/CURVE_RADII.md`).
- Schema v2 with an explicit `alignment` (polyline / spline / routed); v1 projects
  migrate (track lines become curves, bus lines become routed with unrouted sections).
- Directional double track, crossovers, disruption simulation, traffic signals with
  transit signal priority, real-city networks from OSM, login for server saving.
- Minimal header with a File menu.

Open:

- UI next steps (C2): collapsible side panels, on-map toolbar, command palette,
  responsive layout, dark mode, shortcut help.
- Geospatial validation (D): projected-CRS measures in PostGIS, conflict checks
  (buildings, water, railways, protected areas), real elevation, cited grade and
  stop-spacing values, editable entrances, platforms and portals.
- Routing extras: live route preview while drawing, distinct map style for manual and
  unrouted sections, cycling/walking routing profiles.

### Phase 2b — Track network (Priority 1, in progress)

Review: [TRACK_NETWORK_REVIEW.md](TRACK_NETWORK_REVIEW.md). Geometry:
[TRACK_GEOMETRY.md](TRACK_GEOMETRY.md). Architecture:
[TRACK_ARCHITECTURE.md](TRACK_ARCHITECTURE.md). Schema 3 replaces schema 2 without
migration (owner decision).

| Step | Content | Where |
| --- | --- | --- |
| 1 | Line-and-arc geometry, project metric frame (done) | `geo/track/` |
| 2 | Schema 3: `scenario.trackNetwork` with nodes, tracks, double-track groups, permitted movements, metadata, parameters with source and range | `domain/schema.ts`, `domain/trackParameters.ts` |
| 3 | Pure track operations: draw a track (single or double), join to nodes, split, move a node (connected tracks follow), set a radius, delete with impact report | `domain/tracks.ts` |
| 4 | Graph: adjacency through permitted movements only, connectivity, single-track blocks, validation (dangling ends, kinks, radius, unconnected level crossings) | `domain/trackGraph.ts`, `validation/trackValidation.ts` |
| 5 | Stations on tracks: nearby tracks within 20 m (configurable), same level only | `domain/stationTracks.ts` |
| 6 | Services routed over tracks (shortest permitted path between stops, both directions); line coordinates and structure segments derived from the path | `domain/serviceRouting.ts` |
| 7 | Simulation: occupancy of single-track blocks (opposite directions wait), minimum separation for following vehicles | `simulation/occupancy.ts`, `simulation/engine.ts` |
| 8 | Editor: track tool (single/double, radius), node and track inspectors, station track assignment, "New service" by clicking stations; rail lines lose "Follow streets" and "Straight segments" | `map/`, `ui/` |
| 9 | Docs, tests, examples in schema 3 | `docs/`, `domain/examples.ts` |

Priority 2, next: turnout and crossing objects with ports (single, left, right,
curved, crossover, scissors, diamond, single and double slip), connected editing
with constraints, delete with rerouting choices, bus routing preferences and a
provider interface.

### Phase 3 — Data-provider integrations

- Backend-proxied population (CAMARA adapter enabled per deployment; WorldPop, GHSL,
  user GeoTIFF/GeoJSON/CSV fallbacks).
- Existing transit: GTFS ZIP import, GTFS-RT, NeTEx/SIRI, GBFS; transport.rest opt-in.
- Traffic: ArcGIS adapter only after auth/cost/caching terms are verified.
- Regional OSM PBF import into PostGIS (osm2pgsql) as an alternative to Overpass.
- Redis-backed cache and rate limiting for multi-worker deployments.

### Phase 4 — Analysis and estimates

- Editable, versioned assumption sets with sources; sensitivity analysis UI.
- Calibration against uploaded observed counts.
- Cost model with currency/price-year conversion tables and benchmark uploads.
- Emissions (lifecycle split), car reduction, space reallocation, fares.
- Optional property-value module (disabled by default).

### Phase 5 — Simulation and publishing

- Richer simulation (acceleration, signalling headway constraints, depots).
- Schematic layout optimisation (crossing minimisation, parallel shared lines).
- Server-side PDF (headless browser) with embedded map and schematic.
- Authentication, project ownership, object storage (MinIO) for uploads.

## Known Phase 1 gaps (tracked)

- Many inspector strings are not yet routed through `i18n/` (UI chrome is).
- Station entrances and images are stored but not editable on the map.
- Station-name suggestions use only feature points; "major intersection" candidates
  are not generated yet.
- Dark mode is not implemented; high-contrast offline basemap is.
