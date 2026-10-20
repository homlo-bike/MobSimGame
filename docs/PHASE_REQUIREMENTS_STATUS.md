# Phase 1 and 2 requirement status

Reviewed 2026-10-20 on branch `claude/eloquent-edison-s2o70v` (PR #4, schema 3).
A requirement is **Complete** only when its behaviour, persistence, validation,
accessibility and tests all work. A visible control alone does not count.

Statuses:

- **Complete**
- **Partially complete**
- **Implemented but defective**
- **Not implemented**
- **Blocked**
- **Deferred with justification**

Priorities:

- **P1**: foundational, fix before Phase 3 work that depends on it.
- **P2**: important.
- **P3**: later.

Planned pull requests:

| PR | Branch suffix | Content |
| --- | --- | --- |
| **#4** | — | Track network (open) |
| **wp00** | `-wp00-plan` | This matrix and the Phase 3 plan |
| **wp01** | `-wp01-direction` | Direction display |
| **wp02** | `-wp02-validation` | Validation categories and map markers |
| **wp03** | `-wp03-vehicles` | Vehicle profiles and fleet |
| **wp04** | `-wp04-signals` | Manual traffic signals |
| **wp05** | `-wp05-stations` | Station and stop rules |
| **P3-xx** | — | Phase 3 work packages ([PHASE_3_PLAN.md](PHASE_3_PLAN.md)) |

## Phase 1 — map and network editor

| Requirement | Phase | Status | Current implementation | Relevant files | Test coverage | Known defects | Required changes | Priority | Planned PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Map, basemaps, terrain toggle, attribution | 1 | Complete | MapLibre, OpenFreeMap styles, offline plain/high-contrast, AWS terrain, attribution control | `map/MapView.tsx`, `providers/basemaps.ts` | e2e smoke | — | — | — | — |
| Draw and edit lines with snapping (bus, walking, cycling, custom) | 1 | Complete | Draw library, vertex editing, snapping, undo | `map/drawSync.ts`, `domain/network.ts` | network, e2e | — | Live route preview (Phase 3) | — | P3-08 |
| Rail drawn as physical track | 1→2b | Partially complete | Draw track (single or double), junctions, loops, connected node moves | `domain/tracks.ts`, `store/trackActions.ts` | tracks, e2e | No snapping preview while drawing; double track pairs not moved together | Pair constraints, preview | P2 | P3-03 |
| Stations on lines, shared stations, interchanges | 1 | Complete | Click or chainage; reuse within 60 m | `domain/network.ts`, `domain/serviceRouting.ts` | network, tracks | — | — | — | — |
| Rail stations require tracks; bus stops require a service | 1 | Implemented but defective | Rail stations are placed on tracks, but deleting tracks can leave stations without tracks that still look valid; bus stops can exist without a line | `domain/network.ts`, `domain/serviceRouting.ts` | partial | Orphan stations and stops not flagged | Rules, orphan findings, stop types | P1 | wp05 |
| Per-segment structure, right of way, track count | 1 | Complete | Lines: segment table; rail: per physical track | `geo/segments.ts`, `ui/TrackInspector.tsx` | segments, tracks | Same structure list for every mode | Mode-specific structures | P2 | P3-02 |
| Direction (one-way / both), running side | 1 | Complete | Arrows beside each track on the running side (no overlap), zoom-aware spacing, clear of stations; direction described in text in the inspector and Table view | `map/overlays.ts`, `map/layers.ts`, `domain/direction.ts` | arrows (one-way, bidirectional, paired, loop, reversed, shared), App | — | Keep clear of validation markers once they exist (wp02) | — | wp01 |
| Terminations: ends, ring, loop | 1 | Complete | Termination model and checks | `validation/validate.ts` | validate | — | — | — | — |
| Validation findings | 1 | Complete | Errors / Warnings / Recommendations / Information with symbols, definitions, counts, filters, sorting, links and zoom to the object | `validation/`, `ui/FindingsList.tsx`, `map/focus.ts` | validate, locate, App | — | Project-wide validation workspace (P3-12) | — | wp02 |
| Split/join lines, shared track | 1 | Complete | Lines split/join; rail services share tracks by reference | `domain/network.ts` | network, tracks | Imported rail lines not merged onto shared track | Merge overlaps on import | P3 | P3-02 |
| Undo/redo, autosave, JSON, GeoJSON, CSV, share links | 1 | Complete | Store history, project library, backend share with login | `store/`, `geo/geojson.ts`, `api/` | App, persistence, backend | GeoJSON export does not include tracks | Export tracks and nodes | P2 | P3-18 |
| Animation | 1 | Partially complete | Time-based trips; single-track occupancy; separation | `simulation/` | engine, occupancy | No curve/turnout/grade speed effects; vehicles as dots; no fleet limit | Speed model, vehicle symbols, fleet | P2 | P3-13, P3-14 |
| Schematic | 1 | Partially complete | Octilinear layout, offsets per station, SVG/PNG, text alternative | `schematic/`, `ui/SchematicView.tsx` | layout | Static; no zoom/pan; bus/BRT not distinguished; text alternative is a paragraph | Editor, modes, linear view | P2 | P3-11 |
| Dashboard | 1 | Partially complete | Geometry figures; "input required" for real places; demo ranges; labelled validation summary | `ui/Dashboard.tsx`, `analysis/` | calculations, e2e | — | Placeholder estimates (P3-15) | P2 | P3-15 |
| Provider interfaces with provenance and capability | 1 | Complete | Frontend and backend providers | `providers/`, `backend/app/providers/` | providers | — | — | — | — |
| Backend save/share behind login; reports | 1 | Complete | `app/auth.py`, schema 3 only | `backend/app/` | backend | — | — | — | — |
| Logging, licensing, notices | 1 | Complete | Structured logger, licence reports | `util/logger.ts`, `THIRD_PARTY_NOTICES.md` | logging | — | — | — | — |
| Accessibility basics (labels, keyboard, focus, text status) | 1 | Partially complete | Labelled inputs, Table view, chainage inputs, reduced motion | `ui/` | App, e2e | No automated axe check; some map-only actions (moving track points) lack keyboard paths | axe in e2e; keyboard point editing | P2 | P3-17, P3-19 |
| Internationalisation / RTL | 1 | Partially complete | `i18n/` dictionary and direction switch; logical CSS | `i18n/` | — | Most inspector strings not translated; only English | Move strings; second language for testing | P3 | P3-16 |

## Phase 2 — alignments, real networks, routing, minimal UI

| Requirement | Phase | Status | Current implementation | Relevant files | Test coverage | Known defects | Required changes | Priority | Planned PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rail as lines and circular arcs, radius input | 2 | Complete | PI alignment, exact arcs, metric frame | `geo/track/`, `domain/tracks.ts` | track, tracks | Arc length/angle not directly editable | Per-arc editing with constraints | P2 | P3-03 |
| Cited curve radii, inner/outer checks | 2 | Complete | Exact per arc | `validation/trackValidation.ts` | validate | — | — | — | — |
| Double track as two physical tracks | 2 | Complete | Group, spacing, opposite directions | `domain/tracks.ts` | tracks | — | — | — | — |
| Graph, permitted movements, crossing ≠ connection | 2 | Complete | Nodes with automatic or manual movements | `domain/trackGraph.ts` | tracks | — | Typed turnouts (Phase 3) | — | P3-04 |
| Services routed over tracks through ordered stations | 2 | Partially complete | New service tool, list, inspector; return on other track | `domain/serviceRouting.ts` | tracks, App, e2e | No path preview or alternative choice; unrouted pair not highlighted on the map | Preview, ambiguity, highlight | P2 | P3-05 |
| Deleting used track: cancel / reroute / break / delete | 2 | Complete | Dialog and domain function | `store/trackActions.ts` | tracks | — | — | — | — |
| Bus/BRT follow streets (Valhalla) | 2 | Partially complete | Waypoints, legs, manual sections, return path | `backend/app/providers/valhalla.py`, `routing/` | routing, alignment | "No suitable edges near location" reported, likely the extract coverage or search radius; no profiles or preferences; no live preview | Search radius, profiles, preview | P2 | P3-08 |
| Unrouted bus sections are errors | 2 | Complete | Blocking finding, dashed map style with label | `validation/validate.ts`, `map/overlays.ts` | validate, overlays | — | — | — | — |
| Single-track blocking, minimum separation (simulation) | 2 | Partially complete | Block reservations, separation as time gap | `simulation/occupancy.ts` | occupancy | A waiting train does not occupy the track behind it; no turnout reservations | Block model (Phase 3) | P2 | P3-13 |
| Crossovers before/after stations | 2 | Partially complete | Markers that drive the closure model | `domain/network.ts` | network, engine | Not track objects | Turnout objects | P2 | P3-04 |
| Disruption simulation (closures) | 2 | Complete (simplified) | Turn back or share remaining track | `simulation/engine.ts` | engine | — | — | — | — |
| Traffic signals (OSM discovery and manual) with simulated cycles, TSP | 2 | Complete | Manual add/move/delete, typed coordinates, type, controls, priority, approximate delay, attachment, metadata; discovered signals keep source, ID, date, confidence and confirmation | `domain/signals.ts`, `ui/SignalsPanel.tsx`, `simulation/engine.ts` | signals, signalsManual, App, e2e | Signal priority behaviour per signal is recorded but the simulation uses the per-line priority setting | Signal-level priority in the speed model (P3-13) | — | wp04 |
| Vehicle type per line | 2 | Complete | Mode-compatible list; profiles with dimensions, performance and compatibility; custom profiles; fleet size and consist with required-fleet errors | `domain/vehicles.ts`, `analysis/fleet.ts`, `ui/VehicleProfiles.tsx` | vehicles, App | The simulation does not yet cap departures at the fleet | Fleet in the simulation (P3-14) | — | wp03 |
| Real-city networks from OSM | 2 | Partially complete | Tram, metro and bus for six cities | `backend/app/providers/networks.py`, `domain/examples.ts` | networks, examples | Large bus networks slow; no progress or cancellation; imported rail overlaps not merged | Bounded loading | P2 | P3-18 |
| Station auto-naming | 2 | Complete | Bounded lookup, required order | `names/`, `overpass.py` | names | — | — | — | — |
| Connection status, update detection, notifications | 2 | Complete | PR #4 | `runtime/`, `store/notifications.ts` | runtime, App, e2e | — | — | — | — |
| Active project before drawing | 2 | Complete | Project gate and library | `ui/ProjectGate.tsx` | projectGate, e2e | — | — | — | — |
| Custom metadata on lines, stations, tracks, nodes | 2 | Partially complete | Key/value editor | `ui/MetadataEditor.tsx` | App | No project metadata editor | Project editor | P3 | P3-01 |
| Geometry errors shown as map symbols | 2 | Complete | Markers per category with distinct shapes, clustering, per-category visibility, click to open object and finding, arrows keep clear | `map/layers.ts`, `map/overlays.ts`, `map/MapView.tsx` | locate, e2e | — | — | — | wp02 |
| Parameters with source, default, range | 2 | Complete | Track parameter panel | `domain/trackParameters.ts` | tracks | Tram spacing and separations are placeholders | Cited values when found | P3 | P3-07 |
| Minimal UI: collapsible panels, on-map toolbar, command palette, responsive layout | 2 (C2) | Not implemented | — | — | — | — | Responsive editor | P2 | P3-17 |
| Geospatial validation (PostGIS, elevation, conflicts, entrances) | 2 (D) | Not implemented | Grade checks only with elevation input | `validation/validate.ts` | validate | — | Full workstream | P2 | P3-06 |
| Initial map location, schematic zoom, vehicle shapes, multi-car trains | 2 | Not implemented | — | — | — | — | — | P3 | P3-11, P3-14 |
| Migration of older projects | 2 | Deferred with justification | Owner decision: unpublished format, no migration | `docs/PROJECT_MIGRATION.md` | tracks | — | — | — | — |
