# Track geometry: lines and circular arcs

Status: **implemented and used by the editor** (`frontend/src/geo/track/`, used by
`domain/tracks.ts`). Every physical track is stored as interior PIs with radii; its
ends are its nodes. See [TRACK_ARCHITECTURE.md](TRACK_ARCHITECTURE.md).

Each project fixes its frame origin (`trackNetwork.frameOrigin`) with the first
track, so all tracks share one frame.

## Metric frame (`projection.ts`)

All radii, offsets, lengths and tangents are computed in metres, never in degrees.
Each project gets a fixed frame: a transverse Mercator projection on the WGS84
ellipsoid with:

- the central meridian at the origin longitude,
- scale factor 1,
- the origin mapped to (0, 0),
- x pointing east and y pointing north.

The series is Krüger's, as given by Karney (2011), *Transverse Mercator with an
accuracy of a few nanometers*, J. Geodesy 85. It is implemented without a
dependency.

Distances in the frame equal ground distance times the point scale factor
k ≈ 1 + x²/2R². That is +0.012 % at 10 km from the origin and +0.12 % at 30 km.
This is sketch accuracy, not survey accuracy.

## Primitives (`primitives.ts`)

- `LinePrimitive {start, end}`
- `ArcPrimitive {start, end, center, radius, direction: 'left' | 'right'}`
  - The direction is the turn seen in the direction of travel.

Pure functions:

| Function | Purpose |
| --- | --- |
| `lineLength`, `arcLength`, `arcSweep`, `totalLength` | lengths, signed sweep |
| `arcCenter(start, heading, r, dir)` | centre of a tangent arc |
| `tangentArc(start, heading, end)` | the arc leaving `start` on `heading` and reaching `end` (a line when collinear) |
| `arcFromCenter` | arc from centre, radius, start angle, sweep |
| `headingAt`, `pointAt` | position and tangent by distance along |
| `nearest` | nearest point, distance along, signed offset (positive = left of travel) |
| `split`, `join` | split at a distance; join two collinear lines or two co-circular arcs |
| `tangentDeviation`, `continuity` | position gaps (default tolerance 0.01 m) and tangent kinks (0.1°) between consecutive primitives |
| `offset(p, d)` | parallel primitive; a left arc offset to the left gets radius r − d; `null` when it collapses |
| `sample(ps, step)` | display coordinates (samples are derived, never stored as the source) |
| `radiusViolations(ps, minRadius)` | arcs below a minimum radius |

## Editable alignment (`alignment.ts`)

The stored, editable form is a polygon of points of intersection (PIs), with a
radius at each interior PI. This is how railway horizontal alignments are
usually laid out.

- `buildPrimitives` fits at each PI a circular arc tangent to both legs, with
  tangent length T = R·tan(Δ/2). The result is line → arc → line with position
  and tangent continuity by construction.
- A radius that does not fit the leg lengths is reduced to the largest radius
  that fits. A `radius_reduced` warning names the vertex, the requested radius
  and the radius used. The stored radius is not changed.
- Edits:
  - `moveVertex` rebuilds the connected arcs.
  - `setRadius`, `insertVertex`, `removeVertex` and `reverse` edit the PI list.
- `parallel(a, d)` offsets the legs exactly. Arcs become concentric, with radius
  R − d on the inside and R + d on the outside. Collapsed vertices are reported.
  This is the basis for double track as two physical tracks.
- `innerOuterRadii(R, spacing)` gives the inner and outer radii of a pair of
  tracks.
- `splitAlignment(a, along)` splits an alignment into two that reproduce the same
  lines and arcs. Inside an arc, both halves get a new PI where the tangent at the
  split point meets the neighbouring leg.

## Editor conventions (`domain/tracks.ts`)

- **Default radius.** Each new interior point gets the cited recommended minimum
  of the mode, or the cited minimum where no recommended value exists.
- **Double track** is the centre line offset by ± spacing / 2. The radius entered
  for double track, default included, is the **inner** track's radius. The centre
  line gets that radius plus half the spacing, so the inner track meets the cited
  value and the outer track is wider.
- **Closed loops.** A drawn loop (last point within the snap distance of the
  first) is reordered so it starts and ends in the middle of its first straight.
  Every corner then carries a curve and the loop closes tangentially. `parallel`
  keeps the two ends of a closed alignment together.
- **Display samples** are derived: straights by their endpoints, arcs every 5 m.
- `serializeAlignment` / `deserializeAlignment` round-trip the alignment and are
  validated with Zod.

## Converting old splines (`fit.ts`)

`fitPiAlignment(points, toleranceM)` approximates sampled geometry, such as old
spline output, with lines and arcs:

1. Straight runs are detected by local curvature: a run is straight where the
   circumradius over neighbouring samples is ≥ 3000 m.
2. Consecutive straights are intersected to get the true PI.
3. The radius at that PI is the median circumradius of the curve samples between
   the straights.
4. Where no straight separates two curves, as in reverse curves, Douglas–Peucker
   turning points are used instead.

The result reports `maxDeviationM` from the original samples, so the migration
can warn when the approximation differs noticeably. The 3000 m straight
threshold is a fitting heuristic, not an engineering limit.

## Tests

`frontend/src/geo/track/track.test.ts` covers:

- projection round trip and distance accuracy,
- line and arc lengths, centres and tangent arcs,
- nearest point with signed offset,
- split and join,
- offsets and collapse,
- continuity checks,
- PI alignments with radius reduction,
- vertex moves keeping tangency,
- parallel tracks with concentric radii,
- radius violations,
- serialization,
- spline fitting that recovers a 150 m curve.
