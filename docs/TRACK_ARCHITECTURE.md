# Track architecture

Status: **implemented** (schema 3). This document covers the physical track
network, how services use it, and how the simulation shares it. Related:
[TRACK_GEOMETRY.md](TRACK_GEOMETRY.md) (lines, arcs, projection),
[SERVICE_ROUTING.md](SERVICE_ROUTING.md) (routing services over tracks),
[TURNOUTS_AND_CROSSINGS.md](TURNOUTS_AND_CROSSINGS.md) (what nodes do now and
what is planned), [PROJECT_MIGRATION.md](PROJECT_MIGRATION.md) (schema 3).

## Separation of infrastructure and service

```
Scenario
├─ trackNetwork                       physical infrastructure
│   ├─ frameOrigin                    fixed origin of the project metric frame
│   ├─ nodes[]  TrackNode             where track ends meet; permitted movements
│   ├─ tracks[] PhysicalTrack         one track between two nodes; PI polygon + radii
│   ├─ groups[] TrackGroup            double track: spacing; members carry groupId
│   ├─ runningSide                    default for new double track
│   └─ parameterOverrides             user values for domain/trackParameters.ts
├─ stations[]  Station.trackRefs[]    the tracks a station serves (fraction along each)
└─ lines[]     TransportLine          passenger services
    └─ alignment.kind = 'track'       path[] and returnPath[] of TrackSteps
       (bus/BRT: 'routed'; others: 'polyline')
```

- A **track** (`PhysicalTrack`) is one physical track with its own ID between a
  `fromNodeId` and a `toNodeId`. Its geometry is stored as the interior points of
  intersection (PIs, `[lng, lat]`) with one radius per PI. Lines and circular arcs
  are derived from it (`domain/tracks.ts` `trackGeometry`), never stored.
- **Double track** is two tracks with a shared `groupId`. They are drawn together
  as exact parallels (offset legs, concentric arcs), get opposite default running
  directions from the running side, and each has its own radius. The inner track is
  checked against the rules on its own.
- A **node** (`TrackNode`) has a level and a list of **permitted movements**
  (`{a, b}` pairs of track ends). Tracks are connected only through nodes and only
  along permitted movements. Two tracks that merely cross on the map are never
  connected: a bridge, a tunnel, or a crossing that has not been modelled.
  Validation reports same-level crossings without a node.
- A **station** keeps its own position and lists the tracks it serves
  (`trackRefs`, with a fraction along each track). Tracks within 20 m (projected
  distance, adjustable) on the station's level are suggested. Tracks on other
  levels can be added by hand, for example for an interchange between a tunnel
  and a street-level tram.
- A **service** (a `TransportLine` on tracks) lists its stops. Its `path` and
  `returnPath` are ordered `TrackStep`s `{trackId, reversed, from, to}`. The
  service's `coordinates` and structure `segments` are derived from the steps; they
  are read-only for track services.

## Modules

| Module | Pure? | Responsibility |
| --- | --- | --- |
| `geo/track/projection.ts` | yes | Project metric frame (transverse Mercator) |
| `geo/track/primitives.ts` | yes | Lines and arcs: length, nearest point, split, join, offset, sampling |
| `geo/track/alignment.ts` | yes | PI alignment → tangent lines and arcs; parallel; split; serialization |
| `geo/track/fit.ts` | yes | Lines and arcs fitted to sampled geometry (OSM import) |
| `domain/trackParameters.ts` | yes | Parameters with default, range, status and source |
| `domain/tracks.ts` | yes | Create (single/double), attach ends, split, move node, set radius, movements, usage, remove |
| `domain/trackGraph.ts` | yes | Successors through permitted movements, shortest path, single-track blocks, components |
| `domain/serviceRouting.ts` | yes | Stations on tracks, routing services, derived geometry and segments, deletion choices |
| `validation/trackValidation.ts` | yes | Radius, radius reduced, kinks, open ends, junctions, crossings, single-track use |
| `simulation/occupancy.ts` | yes | Reservation ledger for track occupancy |
| `store/trackActions.ts` | store | Draw, delete with confirmation, finish a new service |
| `ui/TrackInspector.tsx` | UI | Track and node inspectors, deletion dialog, parameter panel |
| `map/overlays.ts`, `map/layers.ts`, `map/MapView.tsx`, `map/drawSync.ts` | map | Rendering and forwarding edits |

## Editing rules

- **Draw track**: with a track mode selected, *Draw track* places PIs. The first and
  last click become nodes. An end within the snap distance of a node on the same
  level, or of an open track end on any level (a portal into a tunnel, say), attaches
  to it. An end on the middle of a track on the same level splits that track into a
  junction. A drawn loop (last point back at the first) closes tangentially in the
  middle of its first straight.
- **Radius**: every interior PI gets the mode's cited default (recommended minimum,
  else minimum), or the value set in the tool. For double track the value is the
  inner track's radius. A radius too large for its legs is reduced for the geometry
  and reported; the stored value is kept.
- **Connected editing**: a track end is a node, so dragging it moves every connected
  track. Interior PIs keep their radii. After each edit, stations stay on their
  tracks and affected services are routed again. Moving a double track as a pair
  with its spacing kept is planned (Priority 2).
- **Split**: at a chainage. Geometry is kept exactly, also inside an arc: both halves
  get a new PI where the tangent at the split point meets the neighbouring leg.
  Stations, movements and service paths move to the parts.
- **Delete**: a track no service uses is deleted at once. Otherwise a dialog offers:
  - **Cancel**.
  - **Reroute**: route the affected services again; they become unrouted when no
    permitted path remains.
  - **Break**: keep the services, marked unrouted.
  - **Delete the services** that use the track.
- **Permitted movements**: automatic by default. A train may pass from one end to
  another where it does not have to reverse, i.e. where the tracks leave the node
  more than 90° apart. This is a geometric rule, not a design limit. Ticking a
  movement in the node inspector switches the node to manual movements.
- Rail services cannot use "Follows streets" or "Straight segments". Bus and BRT
  stay street-routed and are not part of the track graph (owner decision).

## Simulation

`simulation/engine.ts` keeps the trip-based model, a pure function of simulated time.
For services on tracks, each line model knows the resources along its path:

- **Single-track blocks** (`trackGraph.singleTrackBlocks`) are maximal chains of
  bidirectional tracks joined at nodes where exactly two track ends meet with a
  through movement. A train reserves the whole block for its direction; trains of
  the other direction wait at the block entry (state "waiting", phase `occupied`)
  until it is clear.
- **Every track** (and every bus route) keeps vehicles in one direction at least the
  **minimum separation** apart. This is enforced at entry and exit as a time gap
  (distance ÷ running speed). Vehicles of one line and direction never overtake.
  The separation values are placeholders (`trackParameters.ts`).
- Trips of all lines are built in one fixed order (departure time, line, service)
  by `SimulationContext`. Waiting therefore does not depend on frame rate or on
  query order. A test checks this.

Limitations, also listed in [METHODOLOGY.md](METHODOLOGY.md):

- A waiting train is not modelled as occupying the track behind it.
- Signals inside a block do not extend the reservation.
- Interlocking, signalling and braking are not modelled.

Waits longer than the headway are reported as a capacity problem.

## Validation

`validation/trackValidation.ts` checks:

- **Radius** of every arc, inner and outer track separately, against the cited rule
  of the track's design mode. Street-running at grade uses the embedded minimum
  where one is cited.
- **Radii reduced** because they did not fit between their legs.
- **Kinks** inside a track or at a connection, using a 0.1° geometric tolerance.
- **Open track ends** that are not buffer stops.
- **Nodes with three or more ends**, whose turnout type is not specified yet.
- **Same-level crossings** without a connection.
- **Single track** used in both directions by a service.

Imported, unedited tracks (`origin.source = 'osm'`) report all of this as
information. Findings are advisory.
