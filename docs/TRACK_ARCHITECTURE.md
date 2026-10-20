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
- A **station** that track services call at must be on at least one track; otherwise it
  is an error (for example after its track was deleted). A stop that no line serves
  is a warning. A station can be both a rail station and a bus stop; the two are
  linked only through the station, never by shared infrastructure.
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

## Station objects

A rail station is an object with its own tracks and platforms
(`domain/stationLayout.ts`, `station.layout`), placed anywhere and connected
afterwards:

- **Layout**: side and island platforms, at least one in total (at most 8 of
  each). Across the station, left to right facing its direction: half the side
  platforms (rounded up), the islands, the other side platforms. Each track is
  served by exactly one platform face: one side = 1 track, two sides = 2, one
  island = 2, one side + one island = 3.
- **Sizes**: platform length per mode, side and island platform width, and the
  track centre distance are track parameters (placeholders; see the Track
  parameters panel). A station can set its own platform length.
- **Tracks**: straight along the platforms. Beyond them each track bends with two
  curves of the mode's default radius back to the normal track spacing, centred on
  the station (approach length about 3·√(R·d) for a lateral shift d), so single or
  double track drawn to a station end connects directly. Station tracks carry
  `stationId`.
- **Connecting**: a track drawn into a station joins the station end that faces
  the rest of the drawing (both tracks of a double track at once), never the
  middle of a platform track. A double track drawn near two open ends the spacing
  apart joins both.
- **Moving and rotating**: drag the station (or its platforms) to move it, drag
  the round handle at either end to rotate it; it lines up with straight track
  within 100 m (Alt rotates freely). The inspector has number fields for the
  platforms, length and direction (keyboard path). Track ends are nodes, so track
  connected to the station follows; services are routed again.
- **Rules**: a service of another mode cannot call at the station (error), and
  platforms shorter than a calling line's trains (vehicle length × units per
  consist) are an error.
- Stops on existing track without a layout (imported OpenStreetMap networks)
  keep working as before.

## Infrastructure classes and compatibility

- Each track has one primary **infrastructure class**: tram, light rail, metro or
  railway (`PhysicalTrack.infrastructureClass`). When it is not set, it is derived
  from the design mode (`domain/compatibility.ts` `DEFAULT_CLASS_FOR_MODE`; an
  elevated metro builds metro track, commuter rail builds railway track). Bus,
  BRT, cycling and walking classes exist for the matrix, but those modes are not
  part of the track graph.
- **Every mode keeps to its own infrastructure** (owner decision: modes need
  different track, power supply, sensors and speeds). A service uses only track of
  its own mode; tram and light rail do not share. Track drawing and dragging join
  only track of the same mode, stations snap only to track of their mode, and a
  track's or a line's mode cannot be changed after creation. Where different modes
  meet on the same level they cross; crossings with priority are planned (R4c).
- **Vehicle ↔ track**: a known vehicle gauge must match a known track gauge, and
  a vehicle with an overhead or third-rail supply needs that electrification.
  Unknown values never conflict. Violations are errors.

## Editing rules

- **Draw track**: with a track mode selected, *Draw track* places PIs. The first and
  last click become nodes. An end within the snap distance of a node on the same
  level, or of an open track end on any level (a portal into a tunnel, say), attaches
  to it. An end on the middle of a track on the same level splits that track into a
  junction.
- **No kinks at connections**: when a new end continues an open track end, or joins
  the middle of a track, an extra curve point is added on the extension of that
  track (halfway along the last leg, in the project frame) with the drawing radius,
  so the new track arrives tangentially. Ends that turn back by 90° or more are left
  as drawn. Turnout geometry from VDV/BOStrab is planned.
- **Loops**: when the last point is back at the first, the editor asks whether to
  close the loop (tangentially, in the middle of the first straight), keep two
  separate ends, or discard the track. A loop never closes without that answer.
- **Drawing stays on**: after a track is finished the tool keeps drawing; Esc stops.
- **Guides** (`geo/track/guides.ts`, `domain/trackGuides.ts`): rays from the last
  point at 0°, ±45°, ±90° and ±135° to the last leg (or continuing the track end the
  drawing starts from), and parallel or perpendicular to straight track within 100 m
  of the cursor. There are no north-based guides. They can be switched off.
- **Curve handles** (`domain/curveHandles.ts`): the middle of an arc of radius R
  and deflection Δ lies on the corner's bisector at E = R (1/cos(Δ/2) − 1) from
  the PI; dragging the handle along the bisector sets R = E / (1/cos(Δ/2) − 1),
  limited to what fits between the neighbouring curves, rounded to 1 m (5 m above
  100 m). On double track the partner curve gets R ± the spacing so both stay
  concentric.
- **Moving an end** onto another node or onto the middle of a track (within the
  snap distance) connects it there, tangentially in the same way. The other end of the same track is never a
  target, and a click on an end without dragging does not move it.
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

A service that cannot be routed is not drawn as a service: its stops are linked by
red dashed "not routed" lines. A two-way service with no track path back is an
error (missing return track, crossover or turning loop).

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
