# Methodology

Methodology version: **0.1.0-phase1**. Code: `frontend/src/analysis/`,
`frontend/src/validation/`, `frontend/src/simulation/`.

> Every Phase 1 estimate uses the **demonstration** assumption set
> (`analysis/demoAssumptions.ts`). Its values are synthetic, uncited and are not
> benchmarks. Results are exploratory and uncalibrated, and the UI labels them so.
> Costs are in fictional demo units (DU), not currency.

All calculations are deterministic code. No language model produces numbers.

## Ranges

Inputs and outputs are `{low, central, high}`. Combination is case-wise:
low with low, high with high (`add`, `mul`); for subtraction and division the
opposite bound is used (`sub: low = a.low − b.high`, `div: low = a.low / b.high`)
so results bracket every combination of monotonic inputs. This is a bounding
convention, **not** a probabilistic confidence interval. The relative spread
`(high − low) / central` is a crude sensitivity indicator.

## Geometry

- Length: sum of haversine segment lengths (Turf, spherical earth radius
  6 371 008.8 m).
- Station snapping: nearest point on the polyline; a click within 60 m of an
  existing station reuses it (shared station).
- Track geometry: physical tracks are **straight lines and circular arcs** with a
  radius entered per point, tangent to each other by construction, computed in a
  per-project transverse Mercator frame (Krüger series as given by Karney 2011);
  see [TRACK_GEOMETRY.md](TRACK_GEOMETRY.md). Radii are exact design inputs, not
  estimates. There are no transition curves or cant. Rail services run over the
  tracks ([SERVICE_ROUTING.md](SERVICE_ROUTING.md)); bus/BRT lines are
  street-routed sections ([ROUTING.md](ROUTING.md)); other modes use straight
  segments.
- Curvature of straight-segment lines: radius of the circle through three
  consecutive vertices (local equirectangular projection), an estimate.
- Imported OpenStreetMap track: lines and arcs fitted to the mapped geometry
  (resampled every 10 m; straights where the local radius is at least 3000 m, a
  fitting heuristic; arcs from the median local radius between straights). The
  largest deviation is noted on the line.
- Stations on tracks: tracks within 20 m (owner requirement, adjustable) of the
  station on the same level, measured in the projected frame.
- Grades: `(Δ elevation / Δ chainage) × 100` between samples of ground elevation.
  Not a vertical alignment.
- Shared track detection: sample one line every 25 m and test distance to the
  other line (≤ 15 m).

## Validation

Findings have four categories, shown with a text label and a symbol (never colour alone):

| Category | Meaning |
| --- | --- |
| ⛔ **Error** | Prevents a valid route, service, simulation or export; requires your action. |
| ⚠ **Warning** | The project can continue, but the condition may be unrealistic, unsafe, incomplete or outside the configured preferred range. |
| ◇ **Recommendation** | An optional improvement; it does not make the project invalid. |
| ℹ **Information** | A neutral observation or calculated status. |

A line is **complete** only without errors:

- valid geometry (≥ 2 distinct vertices; rings ≥ 3);
- at least two stations (transit modes);
- termination rule: with two ends, a station within 60 m of each end; a ring
  closes implicitly; a user-defined loop must return within 60 m to a part of the
  alignment at least 150 m earlier.

Threshold checks use versioned mode profiles in `domain/modeProfiles.ts`:

- **Curve radius**: cited documented defaults per mode, checked on every arc of
  every physical track (inner and outer track of a double track separately; below
  the minimum blocks, below the recommended value warns). Values, quotes and caveats:
  [CURVE_RADII.md](CURVE_RADII.md).
- Grade, stop spacing and short structure segments: still **uncited placeholders**;
  findings say so and never block.
- Street routing: an unrouted bus/BRT section blocks completion until it is routed or
  marked manual; manual sections are reported as information.
- Lines imported from OpenStreetMap and not edited describe existing
  infrastructure: all their findings are reported as information.

## Operations

- Running speed per segment: `min(line max, segment limit, vehicle max) × f_ROW`
  with placeholder factors `f_ROW` = 0.40 (mixed traffic), 0.60 (dedicated lane),
  0.75 (dedicated track). Line running speed is the length-weighted harmonic mean.
- Cycle time: two-ended lines `2 × (L / v + n × dwell) + 2 × layover`;
  rings `L / v + n × dwell + layover`.
- Vehicles in service: `⌈cycle / peak headway⌉` (also off-peak). A line's assigned
  fleet below the peak figure is an error. The simulation does not yet limit
  departures to the assigned fleet; that comes in work package P3-14.
- Consist length = vehicle length × units per consist; consist capacity = vehicle
  capacity × units. Capacity (pphpd) uses the consist.
- Capacity (pphpd): `60 / headway × consist capacity` (placeholder vehicle types unless the user enters a profile).

## Exploratory demand (Phase 1, synthetic inputs)

- Catchments: circles of each station's catchment radius; the area is sampled on
  a 100 m grid and **each cell is assigned only to its nearest station**, so
  overlapping catchments are not double-counted.
- Population: synthetic density surface (mock provider), ±30 % range.
- Weekday boardings per station:
  `(residents × trips/resident + jobs × trips/job) × transit share`,
  jobs = residents × jobs/resident.
- Interchange stations: boardings split equally between serving lines
  (simplification; transfer demand is not modelled yet).
- Annual boardings = weekday × weekday-equivalent days per year.
- Passenger-km = boardings × average trip length.
- Peak load = weekday boardings × 10 % (peak hour) × 60 % (peak direction) —
  synthetic factors; utilisation = peak load / capacity.

Boardings are trips, not unique people.

## Costs

`(Σ route-km by structure × unit cost + Σ stations × unit cost) × (1 + contingency)`.
Shared stations are costed once. `aggregateCosts` refuses to add items with
different currencies or price years; conversion must be explicit
(`convertCost` with a price-index ratio and exchange rate).
Operating cost: `vehicle-km × cost/vehicle-km + vehicle-hours × cost/vehicle-hour`.
Annualised capital uses the capital recovery factor `r(1+r)^n / ((1+r)^n − 1)`.
Break-even fare = annual cost / annual boardings — a policy scenario, not a
recommended fare.

## Car reduction, space, emissions

- Car person-trips shifted = boardings × share who previously drove (not all
  riders previously drove); vehicle trips = person-trips / car occupancy.
- Vehicle-km avoided = vehicle trips × average replaced trip length.
- Parking area equivalent = cars no longer parked × area per space: a
  **theoretical equivalent**, not reclaimable or redesigned space.
- Net operational CO₂e = transit energy × grid intensity − avoided car km × car
  factor. Construction (embodied) emissions are excluded. Wording: "estimated
  change under the selected assumptions". No air-quality concentration claims are
  made (no dispersion model).

## Simulation

Illustrative only: constant speed per segment (no acceleration), fixed dwell,
2-minute layover at terminals, one trip departing per peak headway, positions a
pure function of simulated time (each trip is built in time order from its
departure time). Rings circulate; one-way lines return out of service;
bidirectional lines reverse at terminals. Services on double track return on the
other track.

- **Traffic signals** (tram, light rail, bus, BRT; street-level segments only): a
  vehicle reaching a signal on red waits until the next green. Signals come from
  OSM (`highway=traffic_signals` within 15 m of the line); timings are assumptions
  (placeholder cycle 90 s, green 45 s, uncited) and offsets are spread
  deterministically from the signal id. **Transit signal priority** per line: green
  extended or red shortened by an editable number of seconds (placeholder 10 s).
- **Closures**: closing a section between two stations either splits the service at
  the nearest crossovers outside it (trains turn back; a side without a crossover has
  no service), or, for a one-track closure with crossovers on both sides, keeps the
  through service and holds each train at the first crossover for the time to run the
  single-track section (a worst-case wait for an opposing train). There is no train
  protection or vehicle interaction model.
- Crossovers are drawn up to 80 m before or after their station (a display position,
  not a design).
- **Track occupancy** (services on tracks): a single-track block, meaning a chain of
  bidirectional tracks with nowhere to pass, is reserved by one direction at a time.
  Trains of the other direction wait at its entry. Following vehicles on any track
  or bus route keep a **minimum separation**, applied as a time gap at entry and
  exit (distance ÷ running speed). The values are placeholders: 200 m for metro and
  rail, 50 m for tram and light rail, 20 m for buses (`domain/trackParameters.ts`).
  Trips are scheduled in a fixed order (departure, line, service), so results are
  deterministic.
  - Limitations: a waiting train does not block the track behind it, signals inside
    a block do not extend the reservation, and there is no interlocking, signalling
    or braking model.
  - Waits longer than the headway mean the timetable exceeds the section's capacity.

## Schematic

Stations are scaled from geography so the median stop spacing is three grid
steps (40 px), snapped to the grid, collisions moved to the nearest free cell;
consecutive stations are joined with octilinear elbows. Manual offsets are stored
per station. Crossing minimisation is not implemented yet.
