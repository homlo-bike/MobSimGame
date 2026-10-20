# Phase 1 and 2 requirement status

Reviewed 2026-10-20 against branch `claude/eloquent-edison-s2o70v`; updated after
the track network (schema 3) was implemented. Status:
**done** (implemented and tested), **partial**, **broken**, **missing**.
Priority: P1 foundational / blocking Phase 3, P2 important, P3 later.

## Phase 1 — map and network editor

| Requirement | Status | Relevant files | Tests | Known defects | Required work | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Map, basemaps, terrain toggle | done | `map/MapView.tsx`, `providers/basemaps.ts` | e2e smoke | — | — | — |
| Draw/edit lines with snapping | done; rail now draws **physical track** | `map/drawSync.ts`, `domain/tracks.ts`, `store/trackActions.ts` | tracks, network, e2e | — | Pair-aware double-track dragging | P2 |
| Stations snapped to lines, shared stations | done; rail stations **on tracks** (20 m, same level) | `domain/serviceRouting.ts`, `ui/StationInspector.tsx` | tracks, App | Platforms not modelled | Platform objects | P2 |
| Per-segment structure, right of way, tracks | done; for rail on the **physical tracks** (two tracks for double) | `domain/tracks.ts`, `ui/TrackInspector.tsx` | tracks, overlays | — | — | — |
| Terminations: ends, ring, loop | done | `validation/validate.ts` | validate | — | Carry over to services | P1 |
| Validation findings | done | `validation/validate.ts` | validate | Findings are not drawn on the map | Map symbols | P2 |
| Split/join lines, shared-track detection | done; rail services share **tracks** by reference | `domain/network.ts`, `domain/serviceRouting.ts` | network, tracks | Imported lines get separate track pairs | Merge imported overlaps | P3 |
| Undo/redo, autosave, JSON, GeoJSON, CSV, share | done | `store/`, `geo/geojson.ts`, `api/projects.ts` | App, persistence, backend | — | GeoJSON for tracks | P2 |
| Animation | done, with **single-track occupancy** and **minimum separation** | `simulation/engine.ts`, `simulation/occupancy.ts` | engine, occupancy | Waiting trains do not occupy the track behind them | Block signalling model | P3 |
| Schematic | done | `schematic/`, `ui/SchematicView.tsx` | layout | No zoom/pan | Navigation | P3 |
| Dashboard (fictional demo data only) | done | `ui/Dashboard.tsx` | e2e | — | — | — |
| Provider interfaces, provenance | done | `providers/`, `backend/app/providers/` | providers | — | — | — |
| Backend save/share, reports | done | `backend/app/api/` | backend | — | — | — |
| Logging, licensing | done | `util/logger.ts`, `logging_config.py`, `THIRD_PARTY_NOTICES.md` | logging | — | — | — |

## Phase 2 — alignments, real networks, routing (owner requirements)

| Requirement | Status | Relevant files | Tests | Known defects | Required work | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Rail/tram as smooth curves | done as **lines and circular arcs** with radius input | `geo/track/`, `domain/tracks.ts` | track, tracks | No transition curves or cant | — | P3 |
| Cited curve radii (min/recommended) | done, checked **exactly on every arc**, inner/outer separately | `validation/trackValidation.ts` | validate, tracks | — | — | — |
| Bus/BRT follow streets (Valhalla) | partial | `backend/app/providers/valhalla.py`, `routing/` | routing, alignment | Reported "No suitable edges near location"; not reproducible without Valhalla; likely extract coverage (default Berlin only) or the default search radius; no routing preferences; BRT uses the bus profile | Search radius, profiles, preferences, provider interface | P2 |
| Unrouted bus sections are errors | done | `validation/validate.ts`, `map/overlays.ts` | validate, overlays | — | — | — |
| One direction per track; flip per segment | done: running direction **per physical track** | `domain/tracks.ts`, `domain/trackGraph.ts` | tracks | — | — | — |
| Auto-parallel double track | done: **two tracks**, metric offset, group id, spacing | `domain/tracks.ts`, `geo/track/alignment.ts` | tracks, track | — | Edit as a pair | P2 |
| Crossovers before/after stations | partial | `domain/network.ts` | network, engine | Markers, not track connections (A5); nodes with movements exist | Turnout/crossing objects ([TURNOUTS_AND_CROSSINGS.md](TURNOUTS_AND_CROSSINGS.md)) | P2 |
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
| Project, line, station metadata | done (custom key/value; project metadata has no editor yet) | `domain/schema.ts`, `ui/MetadataEditor.tsx` | App | — | Project metadata editor | P2 |
| Geometry errors as map symbols | missing | — | — | — | Symbol layer, focus | P2 |
| Line extension, closed loops by click | done for track (attach to ends, junction on a track, tangential loops) | `domain/tracks.ts` | tracks, validate | No snapping preview while drawing | Snapping preview | P2 |
| Initial location, schematic zoom, vehicle shapes, multi-car trains | missing | — | — | — | — | P3 |

## Track network (this change)

| Requirement | Status | Relevant files | Tests | Known defects | Required work | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Infrastructure separate from services | done | `domain/schema.ts` (`trackNetwork`) | tracks | — | — | — |
| Lines and arcs, radius input, tangent continuity, projected metres | done | `geo/track/` | track | — | Transition curves | P3 |
| Geometry functions (length, centre, tangent, nearest, split, join, offset, parallel, minimum radius, serialization) | done | `geo/track/primitives.ts`, `alignment.ts` | track | — | — | — |
| No "Follow street"/"Straight segments" for rail | done | `domain/network.ts`, `ui/LineInspector.tsx` | alignment | — | — | — |
| Double track as two tracks, group, spacing, opposite directions, inner/outer checks | done | `domain/tracks.ts` | tracks, validate | — | — | — |
| Graph: movements, crossing ≠ connection, validation | done | `domain/trackGraph.ts`, `validation/trackValidation.ts` | tracks | — | — | — |
| Single track blocked for the opposite direction | done (simulation) | `simulation/occupancy.ts` | occupancy | See METHODOLOGY limitations | — | — |
| Minimum distance between vehicles | done (placeholder values) | `simulation/engine.ts`, `domain/trackParameters.ts` | occupancy | Bus–bus separation across different lines on shared streets is not modelled | — | P3 |
| Turnouts and crossings (typed objects with ports) | **missing** (nodes with movements only) | — | — | — | Connection objects | P2 |
| Segment properties and custom metadata | done | `ui/TrackInspector.tsx` | — | — | — | — |
| Connected-segment editing with constraints | partial (nodes move connected tracks) | `domain/tracks.ts` | tracks | Double-track pairs are not moved together | Pair constraints | P2 |
| Stations attached to tracks, 20 m, same level | done | `domain/serviceRouting.ts` | tracks | — | — | — |
| Services routed over tracks | done | `domain/serviceRouting.ts` | tracks, App, e2e | — | Routing preferences | P2 |
| Delete used track: cancel / reroute / break / delete | done | `store/trackActions.ts`, `ui/TrackInspector.tsx` | tracks | — | — | — |
| Bus routing preferences, pluggable provider | missing | — | — | — | — | P2 |
| Station naming fix | done | `names/` | names | — | — | — |
| Parameters with source, default, range | done | `domain/trackParameters.ts` | tracks | Tram spacing and separations are placeholders | Cited values | P3 |
| Migration | not done (owner decision: no migration) | `docs/PROJECT_MIGRATION.md` | tracks (older formats rejected) | — | — | — |
