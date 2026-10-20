# Track network review

Review date: 2026-10-20. Scope: the transport-line, track, station, routing,
geometry and simulation model as of branch `claude/eloquent-edison-s2o70v`
(main `9e9dab4` plus PR #4). Status of every Phase 1 and Phase 2 requirement:
[PHASE_REQUIREMENTS_STATUS.md](PHASE_REQUIREMENTS_STATUS.md). Plan:
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

Baseline when the review started: frontend 191 unit tests and 7 end-to-end tests
pass, backend 93 tests pass, lint, type checks and production build are clean.

## 1. Current model in one picture

```
Project ─ Scenario ─┬─ TransportLine (one per line)
                    │    coordinates  ← the physical path, owned by the line
                    │    alignment    ← spline control points | routed waypoints | polyline
                    │    segments[]   ← fractions 0..1: structure, right of way, tracks: single|double
                    │    stops[]      ← station references, ordered by chainage
                    │    crossovers[] ← "before/after station X" markers
                    │    termination, direction, runningSide, servicePatterns[0]
                    ├─ Station (free position, snapped to lines)
                    ├─ SharedTrack (detected geometric overlaps between lines)
                    ├─ Platform (schema only, unused), Interchange, Depot
                    ├─ TrafficSignal, SignalSettings, VehicleType
```

Key files: `frontend/src/domain/schema.ts` (Zod schema, version 2),
`domain/network.ts` (operations), `domain/alignment.ts`, `geo/spline.ts`,
`geo/geometry.ts`, `map/overlays.ts` + `map/layers.ts` (rendering),
`simulation/engine.ts`, `validation/validate.ts`, `domain/migrate.ts`.

## 2. Architectural problems found

| # | Problem | Where | Consequence |
| --- | --- | --- | --- |
| A1 | **A line owns its physical path.** There is no track entity: `TransportLine.coordinates` is both infrastructure and service. | `schema.ts` `TransportLineSchema` | Two lines on the same street or tunnel are two overlapping geometries. Shared track is only *detected* afterwards by sampling distance (`detectSharedTracks`, 15 m tolerance) and is not authoritative. Deleting a line deletes "its" track. A track without a service cannot exist. |
| A2 | **Double track is a rendering trick.** `segment.tracks = 'double'` draws the same geometry twice with a MapLibre pixel `line-offset`. | `map/overlays.ts`, `map/layers.ts` | The two tracks have no IDs, no metre-based offset, no inner/outer radii, no independent direction; the offset changes with zoom. Requirement 4 cannot be met by extending this. |
| A3 | **Smooth geometry is a spline**, a centripetal Catmull–Rom curve through control points, sampled every 10 m; radii are estimated from samples. | `geo/spline.ts`, `domain/alignment.ts` | Radius is a by-product, not a design input; it cannot be entered; tangent continuity between straights and curves is not guaranteed; radius readings dip at curve ends (documented in `CURVE_RADII.md`). Requirement 2 replaces it. |
| A4 | **No connectivity graph.** Lines touch only by coincidence of coordinates; there are no nodes, turnouts, crossings or permitted movements. | — | No pathfinding, no rerouting after deletion, no distinction between a bridge over a track and a junction. |
| A5 | **Crossovers are station-relative markers**, placed at a display distance (`CROSSOVER_DISPLAY_OFFSET_M = 80`). | `domain/network.ts` `placedCrossovers` | Good enough for the closure animation, not a physical object with ports and movements. |
| A6 | **Stations are points snapped to lines**; tracks and platforms at a station are not modelled (`PlatformSchema` exists but is unused). | `schema.ts`, `network.ts` `addStationOnLine` | A station cannot say which tracks or platforms it serves; tracks on different levels are not distinguished. |
| A7 | **Simulation is per line with independent vehicles.** No occupancy, no single-track blocking, no minimum separation; single-track working in closures is a fixed worst-case wait. | `simulation/engine.ts` | Requirements "single-track sections are blocked while occupied" and "vehicles keep a minimum distance" need a track-occupancy model. |
| A8 | **Metre calculations use a local equirectangular projection** around a reference point (`geometry.ts toLocalMetres`, `spline.ts projector`). | `geo/` | Adequate within a few kilometres, but the reference point changes per call, so the frame is not stable across a network, and the projection is not documented as a contract. |
| A9 | **Bus routing and rail geometry share one `alignment` union.** Rail lines can be switched to "Follows streets" or "Straight segments". | `domain/alignment.ts`, `LineInspector` | Requirement 3 removes those options for rail; bus routing stays street-based. |
| A10 | **Station auto-naming can hang and fall back to coordinates.** The browser aborts after 20 s, while the backend's Overpass call has a 25 s query timeout plus 3 retries with back-off; the inspector then silently offers the coordinate name. The candidate order differs from the required order and intersections are never computed. | `ui/StationInspector.tsx`, `names/suggest.ts`, `backend/app/providers/overpass.py` | The reported "Looking up nearby features…" then latitude/longitude. Fixed in this branch (see §5). |

What is sound and should be kept: stable string IDs everywhere; stations as
referenced entities; segment fractions with a contiguous-cover invariant; the
pure-domain / store / map split; provenance on every dataset; the trip-based
simulation that is a pure function of time; schema versioning with a migration
function before validation (`migrate.ts`).

## 3. Target model (implemented in schema 3; see [TRACK_ARCHITECTURE.md](TRACK_ARCHITECTURE.md))

Physical infrastructure and passenger services become separate collections in a
scenario. Names below are adapted to the repository (the existing `TrackSegment`
is the per-line *structure segment* and is renamed in the new model to avoid two
meanings of one name).

| Concept | Entity | Notes |
| --- | --- | --- |
| Track graph | `TrackNode`, `TrackEdge` | A node is a shared position (endpoint, junction, buffer stop, portal, structure transition). An edge is one physical single track between two nodes, with its own ID. |
| Geometry | `TrackAlignment` = ordered `line` / `arc` primitives in a project metric frame | Source of truth; display coordinates are derived. |
| Paired tracks | `trackGroupId` on edges | Double track = two edges with a shared group, spacing and default opposite directions. |
| Connections | Implemented: `TrackNode.movements` (permitted movements, automatic or manual). Planned: `TrackConnection` with ports for turnout, crossover, scissors crossover, diamond, single/double slip ([TURNOUTS_AND_CROSSINGS.md](TURNOUTS_AND_CROSSINGS.md)) | A geometric crossing without a node is not traversable. |
| Stations | `Station` (kept) + `StationTrack` (station ↔ edge, side, level) + `Platform` (existing schema, extended) | |
| Services | `ServiceLine` (public name, colour, mode, vehicle type) with `ServicePattern`s; each pattern has a `ServicePath` (ordered edge references with direction) and `ScheduledStop`s | Occupancy is derived from service paths, never stored. |
| Bus services | Existing street-routed alignment (waypoints, legs, return path) | Kept separate from the track graph. |
| Simulation | `VehicleRun` (runtime only) | Not persisted. |

Names as implemented:

| Proposal | Code |
| --- | --- |
| `TrackEdge` | `PhysicalTrack` |
| `ServiceLine` | `TransportLine` with `alignment.kind = 'track'` |
| `ServicePath` | `alignment.path` / `alignment.returnPath` (`TrackStep[]`) |
| `ScheduledStop` | `line.stops`, in calling order |
| `StationTrack` | `station.trackRefs` |
| `VehicleRun` | the simulation's trips (runtime only) |

`Platform` objects and turnout connection objects are not implemented yet.

## 4. Migrations

**Owner decision (2026-10-20): no migration.** The project is not yet published,
so schema 3 starts from scratch. A v1 or v2 project is rejected on load with a clear
message ("saved with an older, unpublished format"), and the bundled examples are
regenerated in the new format. The table below records what an automatic migration
would have needed, in case it is wanted later.

| From | To | Approach (not implemented) |
| --- | --- | --- |
| v2 rail lines (spline, line-owned `coordinates`) | Tracks plus one service per line | `geo/track/fit.ts` fits lines and arcs to the samples (already implemented and tested) |
| v2 `segments[]` | Track properties | Copy per track |
| Stations, stops, crossovers | Station track references; crossovers as track connections | Keep IDs |
| Bus/BRT routed lines | Unchanged | — |

## 5. Fixed in this branch during the review

- **Station auto-naming** (A10): bounded lookup with its own timeout and
  cancellation, the required candidate order, intersections from street geometry,
  local place names, localisation from the app language, duplicate qualifiers, a
  loading state that always ends, and a clear message instead of silently returning
  coordinates. Details in the CHANGELOG.

## 6. Owner decisions

| Question | Decision |
| --- | --- |
| Migration of v2 projects | None: start from scratch (not yet published) |
| Default values (spacing, separation, blocking) | Cited sources; anything uncited is labelled placeholder and is editable |
| Bus/BRT in the track graph | No: buses stay street-routed and separate |
| Scope of this session | Priority 1 in full; Priority 2 documented as next |
| Metric projection | Transverse Mercator per project (implemented, `TRACK_GEOMETRY.md`) |
