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

### Phase 2 — Geospatial validation

- Street routing for bus/BRT (RoutingProvider; self-hosted OSRM/Valhalla or GraphHopper).
- Projected-CRS measures in PostGIS (local UTM) and a validation endpoint.
- Building, water, railway and protected-area conflict checks from OSM/PostGIS.
- Elevation profiles from a real ElevationProvider (DEM / COG upload, configurable API).
- Cited mode profiles (replace placeholders with standards-backed values).
- Entrances, platforms and portals as editable map features.
- Station-platform curvature check; structure transition lengths.

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
