# Phase 1 and 2 requirement status

Reviewed 2026-10-20 against branch `claude/eloquent-edison-s2o70v`. Status:
**done** (implemented and tested), **partial**, **broken**, **missing**.
Priority: P1 foundational / blocking Phase 3, P2 important, P3 later.

## Phase 1 — map and network editor

| Requirement | Status | Relevant files | Tests | Known defects | Required work | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Map, basemaps, terrain toggle | done | `map/MapView.tsx`, `providers/basemaps.ts` | e2e smoke | — | — | — |
| Draw/edit lines with snapping | done (rail geometry to be replaced) | `map/drawSync.ts`, `domain/network.ts` | network, e2e | Rail lines own their path (review A1) | Track editor | P1 |
| Stations snapped to lines, shared stations | done | `domain/network.ts` | network | Stations do not reference tracks or platforms (A6) | StationTrack model | P1 |
| Per-segment structure, right of way, tracks | done | `geo/segments.ts`, `ui/LineInspector.tsx` | segments | Double track is a pixel offset (A2) | Physical track pairs | P1 |
| Terminations: ends, ring, loop | done | `validation/validate.ts` | validate | — | Carry over to services | P1 |
| Validation findings | done | `validation/validate.ts` | validate | Findings are not drawn on the map | Map symbols | P2 |
| Split/join lines, shared-track detection | done | `domain/network.ts` | network | Shared track is detected, not modelled (A1) | Replaced by shared edges | P1 |
| Undo/redo, autosave, JSON, GeoJSON, CSV, share | done | `store/`, `geo/geojson.ts`, `api/projects.ts` | App, persistence, backend | — | GeoJSON for tracks | P2 |
| Animation | done | `simulation/engine.ts` | engine | No occupancy or separation (A7) | Track occupancy | P2 |
| Schematic | done | `schematic/`, `ui/SchematicView.tsx` | layout | No zoom/pan | Navigation | P3 |
| Dashboard (fictional demo data only) | done | `ui/Dashboard.tsx` | e2e | — | — | — |
| Provider interfaces, provenance | done | `providers/`, `backend/app/providers/` | providers | — | — | — |
| Backend save/share, reports | done | `backend/app/api/` | backend | — | — | — |
| Logging, licensing | done | `util/logger.ts`, `logging_config.py`, `THIRD_PARTY_NOTICES.md` | logging | — | — | — |

## Phase 2 — alignments, real networks, routing (owner requirements)

| Requirement | Status | Relevant files | Tests | Known defects | Required work | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Rail/tram as smooth curves | done as **splines**, to be **replaced** | `geo/spline.ts`, `domain/alignment.ts` | spline, migrate | Radius not a design input (A3) | Line-and-arc geometry | P1 |
| Cited curve radii (min/recommended) | done | `domain/modeProfiles.ts`, `docs/CURVE_RADII.md` | validate | Measured on spline samples | Measure on arcs | P1 |
| Bus/BRT follow streets (Valhalla) | partial | `backend/app/providers/valhalla.py`, `routing/` | routing, alignment | Reported "No suitable edges near location"; not reproducible without Valhalla; likely extract coverage (default Berlin only) or the default search radius; no routing preferences; BRT uses the bus profile | Search radius, profiles, preferences, provider interface | P2 |
| Unrouted bus sections are errors | done | `validation/validate.ts`, `map/overlays.ts` | validate, overlays | — | — | — |
| One direction per track; flip per segment | partial | `map/overlays.ts`, `geo/segments.ts` | network | Rendering only (A2) | Track direction on edges | P1 |
| Auto-parallel double track | partial (visual) | `map/layers.ts` | overlays | Pixel offset, no IDs (A2) | Paired edges, metric offset | P1 |
| Crossovers before/after stations | partial | `domain/network.ts` | network, engine | Markers, not connections (A5) | Crossover connection objects | P2 |
| Disruption simulation (closures) | done (simplified) | `simulation/engine.ts` | engine | Single-track wait is worst case | Occupancy-based | P2 |
| Traffic signals, priority | done | `domain/signals.ts`, `simulation/engine.ts` | signals, engine | Placeholder timings (labelled) | — | — |
| OSM vector default basemap | done | `providers/basemaps.ts` | e2e | — | — | — |
| Real-city networks from OSM | partial | `backend/app/providers/networks.py`, `domain/examples.ts` | networks, examples | Large bus networks may still be slow; no tiling, progress per tile or cancellation | Bounded loading | P2 |
| Login for saving | done | `backend/app/auth.py`, `ui/LoginDialog.tsx` | auth, App | — | — | — |
| Station auto-naming | **broken → fixed in this branch** | `names/`, `ui/StationInspector.tsx`, `backend/app/providers/overpass.py` | names, overpass | Hung, then coordinates (review A10) | — | P2 |
| Connection status, update detection | done (PR #4) | `runtime/`, `docs/CACHING.md` | runtime, e2e | — | — | — |
| Notification centre | done (PR #4) | `store/notifications.ts`, `ui/NotificationMenu.tsx` | notifications, App | — | — | — |
| Active project before drawing | done (PR #4) | `store/projectStore.ts`, `ui/ProjectGate.tsx` | projectGate, App, e2e | — | Project metadata fields | P2 |
| "Start a network" closes on draw | done (PR #4) | `App.tsx` | App | — | — | — |
| Project, line, station metadata | missing | — | — | — | Metadata model (shared with track metadata) | P1 |
| Geometry errors as map symbols | missing | — | — | — | Symbol layer, focus | P2 |
| Line extension, closed loops by click | partial | `domain/network.ts` (`joinLines`, ring detection at 5 m) | network | No endpoint snapping preview | Track editor | P1 |
| Initial location, schematic zoom, vehicle shapes, multi-car trains | missing | — | — | — | — | P3 |
