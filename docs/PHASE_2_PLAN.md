# Phase 2 plan — alignments, geospatial validation and a minimal UI

Status (2026-10-19): milestones **2.0–2.3 implemented**, plus the owner's additional
requirements (see "Owner decisions" below). Workstreams C2 (further UI) and D
(geospatial validation) remain planned and are not available yet.

Phase 1 delivered a working editor in which every line is a straight-segment
polyline. Phase 2 makes the drawn geometry fit its mode, validates it against real
geography, and simplifies the interface.

## Goals

1. **Bus and BRT lines follow streets.** A drawn bus line is routed on the street
   network; a straight unrouted leg is never presented as a drivable alignment.
2. **Metro, rail, light-rail and tram lines are smooth curves**, not polygons: the
   user places control points and the alignment is a spline through them.
3. **A minimal UI**: fewer always-visible controls, file actions in one menu,
   collapsible panels, no loss of keyboard or screen-reader access.
4. The geospatial validation items carried over from the original plan.

## Non-goals

- Engineering-grade railway geometry (designed straights, circular arcs and
  clothoid transitions with cant). Phase 2 offers sketch-quality smooth curves and
  reports their curvature; design geometry is a later option (see B6).
- Turn-by-turn bus operations (stop-level signal priority, lane-level routing).

---

## Workstream A — Bus and BRT lines follow streets

### A1. Routing provider (backend)

Add a `RoutingProvider` adapter in `backend/app/providers/` behind
`/api/v1/routing/route`, using the existing `fetch_with_retry` (allowlist, SSRF
guard, back-off) and returning `Provenance` + `Capability` like every provider.

| Option | Licence | Bus support | Notes |
| --- | --- | --- | --- |
| **Valhalla** (recommended) | MIT | `bus` costing model | Self-hosted from a regional OSM extract; also has `pedestrian` and `bicycle` costing for corridors. |
| OSRM | BSD-2-Clause | Car profile (Lua profiles are customisable) | Fast; bus behaviour needs a custom profile. |
| GraphHopper | Apache-2.0 | Custom models | Java; good customisation. |

Recommendation: an optional Compose profile `routing` that runs Valhalla built from a
regional PBF extract, configured with `MOBSIM_ROUTING_URL`. Public demo instances of
these engines are for light testing only under their operators' policies; they must
not be the default, and their terms must be verified before use. All three engines
run as separate services, so their licences do not combine with MobSimGame's.

Request contract: waypoints `[lng, lat][]`, profile (`bus`, `bicycle`, `foot`), and
options such as avoiding restricted roads. Response: geometry per leg, length,
duration, any warnings, and the snapped waypoints. Responses are cached by the
rounded waypoint pair.

### A2. Data model (schema v2)

A line gets an explicit **alignment** describing how its geometry is produced:

```ts
alignment:
  | { kind: 'polyline'; points: LngLat[] }                      // Phase 1 behaviour
  | { kind: 'spline'; controlPoints: LngLat[]; tension: number } // workstream B
  | { kind: 'routed'; waypoints: LngLat[]; profile: 'bus' | 'bicycle' | 'foot';
      legs: { status: 'routed' | 'manual' | 'failed'; routedAt: string | null;
              provenance: Provenance | null }[] }
```

`coordinates` stays as the **derived** geometry: routed legs joined, or the sampled
spline. Every existing consumer (stations, segments, simulation, analysis, export)
keeps working unchanged.

*As implemented* (`frontend/src/domain/schema.ts`): `polyline` has no points of its own
(the vertices are `coordinates`), `spline` has no tension parameter (centripetal,
α = 0.5), leg statuses are `routed | manual | unrouted` and each leg stores its
geometry; `routed` also keeps an optional `returnCoordinates`. Following the owner's
decision, migration converts track lines to curves and bus lines to routed lines.

### A3. Drawing and editing UX

- With a bus or BRT mode selected, each click places a **waypoint**. The routed
  path between consecutive waypoints is previewed while drawing: requests are
  debounced and cancelled when superseded.
- Dragging a waypoint re-routes only its adjacent legs.
- A leg can be switched to **manual** ("draw straight here", e.g. a planned
  bus-only link). Manual legs are drawn dashed, labelled "not routed", and raise a
  validation warning.
- If routing is unavailable (no provider, offline, coverage), legs are kept as
  `failed`. They are drawn in a distinct dashed style and the provider's capability
  state is shown. The project keeps working offline.

### A4. Validation

- **Blocking:** a bus or BRT line with a `failed` leg is not complete ("routing
  required").
- **Information** (as implemented; the plan said warning): a `manual` leg.
- Planned: a route that uses a road the router flags as restricted.
- **Information:** one-way streets used in one direction only, which means the return
  direction needs its own path.
- Phase 3: show dedicated bus lanes and busways from OSM (`busway`, `bus:lanes`)
  per segment, as observed data that suggests a `rightOfWay` value.

### A5. Tests

Leg routing with a mocked provider; re-routing only the affected legs on drag; the
offline fallback; schema migration; validation severities; caching.

---

## Workstream B — Smooth (spline) alignments for rail modes

### B1. Which modes

Default alignment kind per mode:

| Mode | Default |
| --- | --- |
| metro, elevated rail, commuter rail, light rail | `spline` |
| tram | `spline` (a tram on streets may switch to `routed` with a tram/rail-aware profile later) |
| bus, BRT | `routed` (workstream A) |
| cycling, pedestrian | `routed` (`bicycle` / `foot`), falling back to `polyline` |
| custom | `polyline` |

The inspector offers "Smooth curve / Straight segments / Follow streets" where it
makes sense for the mode.

### B2. Curve type

A **centripetal Catmull–Rom spline** (α = 0.5) through the control points:

- it passes through every control point, so stations and constraints stay where the
  user put them;
- the centripetal form avoids cusps and self-intersections within a segment
  (Yuksel, Schaefer & Keyser, 2011);
- it works for open lines and, with wrap-around control points, for rings.

Rejected alternatives: cubic B-splines (do not pass through the points) and Bézier
handles (more controls per point, harder by keyboard).

### B3. Sampling

The derived `coordinates` are sampled adaptively, in a local metric projection: points
are added until the chord deviation is ≤ 1 m or the turn angle per sample is ≤ 2°,
with a cap per segment. Lengths, chainages, segment fractions, station snapping and
the simulation all use the sampled curve.

### B4. Editing with the draw library

The draw feature becomes the **control polygon** (thin, with vertex handles, using the
library's existing vertex editing and snapping). The smoothed curve is rendered by
the existing MapLibre structure layers. `map/drawSync.ts` maps the draw feature to
`alignment.controlPoints` instead of `coordinates`. Vertex drags update the curve
live (intermediate events → preview only; the commit on drag end goes to the store
and history).

### B5. Curvature validation becomes meaningful

With a smooth curve, the radius at each sample is well defined.

- The existing curve-radius check uses the dense samples (minimum radius per
  segment, not per vertex).
- An optional curvature overlay colours the line where the radius drops below the
  profile's warning threshold, shown with pattern + text, not colour only.
- Station platform curvature: the radius over the platform length around each station
  is checked against the profile.
- The mode-profile values are still placeholders until cited (workstream D).

### B6. Later option — design geometry

Fit straights, circular arcs and clothoid transitions to the control points for
users who need geometry closer to railway practice. This is out of scope for
Phase 2, but the `alignment` union leaves room for a `designed` kind.

### B7. Tests

Interpolation passes through control points; no cusps on sharp inputs; ring
continuity; length convergence with sampling tolerance; segment fractions preserved
when control points move; GeoJSON export carries both the sampled geometry and the
control points.

---

## Workstream C — Minimal UI

### C1. Done

- Single-row header: app name, inline project name, fictional badge, segmented
  view switcher, icon undo/redo, one **File ▾** menu (Project · Import/export ·
  Share), and an ⓘ button for limitations, data and licences.
- Import/export, save/open, share and report live in the File menu (WAI-ARIA menu
  button: arrow keys, Home/End, Escape, focus return, click-outside to close).
- Status messages appear as a toast instead of a full-width bar.
- Segmented tool switcher. "Add stations to" is shown only while adding stations,
  and the keyboard shortcuts are behind a disclosure.
- Scenario, Map layers and Display are collapsible (native `<details>`); Scenario
  opens automatically once a project has several scenarios.
- A slimmer fictional-project notice, quieter borders, and a single-row footer.

### C2. Next

- Collapsible side panels (left and right) with a toggle, giving the map more room.
- An on-map floating toolbar for the drawing tools, so the left panel focuses on
  lists.
- A command palette (Ctrl+K) for every action, which is also a keyboard route to all
  menu items.
- Responsive layout: panels become drawers below ~1024 px.
- Dark mode (validated palettes for the charts).
- Move the remaining inline strings into `i18n/`.
- A shortcut help dialog (`?`).

---

## Workstream D — Geospatial validation (carried over)

- Projected-CRS measures in PostGIS (local UTM zone) and a validation endpoint.
- Conflict checks from OSM/PostGIS: buildings, water, existing railways, protected
  areas, barriers. These are warnings with provenance, never verdicts.
- Elevation profiles from a real `ElevationProvider` (uploaded DEM/COG, or a
  configurable API) feeding the existing grade checks.
- Cited mode profiles to replace the placeholders. Each value carries a source,
  standard context and date; `absoluteLimit` is set only from a cited standard.
- Entrances, platforms and portal points as editable map features; structure
  transition lengths.

---

## Milestones

| # | Milestone | Contents | Exit criteria |
| --- | --- | --- | --- |
| 2.0 ✓ | Minimal UI (C1) | Done | Tests and E2E green; keyboard paths unchanged |
| 2.1 ✓ | Schema v2 + spline alignments | A2 (model + migration), B1–B5, B7 | Rail lines drawn as smooth curves; old projects open unchanged; curvature checks per sample |
| 2.2 ✓ | Routing provider | A1, Compose `routing` profile, docs | `/api/v1/routing/route` with provenance; disabled cleanly when not configured |
| 2.3 ✓ | Street-following bus lines | A3–A5 | Bus/BRT lines routed while drawing; unrouted legs blocked or flagged; works offline with clear state |
| 2.4 | UI next (C2) | Collapsible panels, on-map toolbar, command palette, responsive | Lighthouse/axe checks pass; E2E covers the new paths |
| 2.5 | Geospatial validation (D) | PostGIS checks, elevation, cited profiles, entrances | Findings carry provenance; profiles cite sources |

2.1 needs no new services and can start immediately. 2.2–2.3 depend on choosing and
hosting a routing engine.

## Risks

- **Routing hosting.** Building Valhalla tiles for a large region needs CPU, RAM and
  disk; the plan uses regional extracts and an optional profile.
- **Geometry changes for existing projects.** This is mitigated by migrating to
  `polyline` and converting only on request.
- **Draw-library limits.** Live re-rendering of the smoothed curve during vertex drags
  must stay responsive; preview updates are throttled to animation frames.
- **Routing coverage gaps** (missing or wrong OSM data). Manual legs stay available
  and are clearly marked.

## Owner decisions (2026-10-19)

The open questions were answered by the project owner, and further requirements
were added. All of the following are implemented:

| Topic | Decision |
| --- | --- |
| Routing engine | Valhalla, self-hosted, optional Compose profile ([ROUTING.md](ROUTING.md)) |
| Trams | Run on tracks: smooth curves |
| Existing lines | Converted: rail and tram lines become curves through their old vertices |
| Unrouted bus sections | Blocking ("incomplete") until routed or marked manual |
| Curve radii | Published values researched with citations, reviewed by the owner before use ([CURVE_RADII.md](CURVE_RADII.md)); imported lines report information only |
| Direction | Each track carries one direction; double track drawn automatically in parallel; per-segment side swap; single track option |
| Crossovers | Before/after stations, on map and schematic, used by the disruption simulation |
| Default background | OpenStreetMap vector map (OpenFreeMap Liberty) |
| Examples | Real cities only (Berlin, Paris, London, New York City, Los Angeles, Bogotá), full networks loaded live from OSM, one city and network at a time; fictional demo removed |
| Saving | Server save/share behind a login (admin/admin by default, set in .env; refused in production) |
| Traffic signals | OSM signal positions with simulated cycles (assumed timings) and per-line transit signal priority |
