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
- Curvature: radius of the circle through three consecutive vertices
  (local equirectangular projection). A sketched polyline has no transition
  curves, so this is an indication only.
- Grades: `(Δ elevation / Δ chainage) × 100` between samples of ground elevation.
  Not a vertical alignment.
- Shared track detection: sample one line every 25 m and test distance to the
  other line (≤ 15 m).

## Validation

Findings: *Information*, *Recommendation*, *Warning*, *Blocking geometry error*.
A line is **complete** only without blocking findings:

- valid geometry (≥ 2 distinct vertices; rings ≥ 3);
- at least two stations (transit modes);
- termination rule: with two ends, a station within 60 m of each end; a ring
  closes implicitly; a user-defined loop must return within 60 m to a part of the
  alignment at least 150 m earlier.

Threshold checks (curve radius, grade, stop spacing, short structure segments)
use versioned mode profiles in `domain/modeProfiles.ts`. **Phase 1 profiles are
uncited placeholders**; findings say so, and `absoluteLimit` is always `null`
(no blocking threshold without a cited standard). Bus/BRT alignments always carry
a warning that they are not routed on the street network.

## Operations

- Running speed per segment: `min(line max, segment limit, vehicle max) × f_ROW`
  with placeholder factors `f_ROW` = 0.40 (mixed traffic), 0.60 (dedicated lane),
  0.75 (dedicated track). Line running speed is the length-weighted harmonic mean.
- Cycle time: two-ended lines `2 × (L / v + n × dwell) + 2 × layover`;
  rings `L / v + n × dwell + layover`.
- Vehicles in service: `⌈cycle / peak headway⌉`.
- Capacity (pphpd): `60 / headway × vehicle capacity` (placeholder vehicle types).

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
2-minute layover at terminals, vehicles spaced by the peak headway, positions a
pure function of simulated time. Rings circulate; one-way lines return out of
service; bidirectional lines reverse at terminals.

## Schematic

Stations are scaled from geography so the median stop spacing is three grid
steps (40 px), snapped to the grid, collisions moved to the nearest free cell;
consecutive stations are joined with octilinear elbows. Manual offsets are stored
per station. Crossing minimisation is not implemented yet.
