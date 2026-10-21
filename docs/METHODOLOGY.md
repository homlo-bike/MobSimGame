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
- Station snapping: nearest point on the polyline; a click within the stop merge distance (Project properties → Parameters, default 20 m) of an
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
- Region area: the polygon (minus holes) projected into the project frame and
  measured there with the shoelace formula; never entered. "Calculated density"
  is a stored population divided by this area and is labelled as calculated.
  Splitting a region does not divide its statistics: numeric values are dropped
  from the parts and text values kept, with a note. Merging does not add them up:
  the first region's values are kept and a note asks the user to check them for the
  merged area. No figure is invented.
- Walking links: straight-line distance between the two stations in the project
  frame, at the walking-speed parameter (4.5 km/h, placeholder) unless a time is
  entered. Real walking paths are longer.
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

### Ramps between levels

Every track node has a level (0 street, −1, −2 … underground, +1, +2 … elevated). A
track whose two ends are on different levels is a **ramp**: it rises or falls the
height difference between the levels over its own length, so its gradient is
`|h(to) − h(from)| ÷ length`.

- Level heights are system defaults (owner decision), editable per project: 10 m per
  underground level and 7 m per elevated level (top of rail relative to the street).
- Steepest ramp: for commuter rail and railways, 12.5 per mille (EBO § 7 (1), new
  main lines); for the other modes, the placeholder warning grade of the mode's
  validation profile. A steeper ramp is an error (cited) or a warning (placeholder)
  that states the length it needs.
- A station platform on a ramp is reported when the ramp is steeper than the station
  limit: 2.5 per mille for railways (EBO § 7 (2)), else the placeholder project
  parameter (0.5 %).
- The portal is marked where a ramp meets street level.
- Stations on different levels may stand on top of each other (for example a metro
  station underground, a tram stop at street level and an elevated station above);
  their tracks never connect, and the map lists them in one label, top level first.
- Vehicles carry their height along the line: on tracks from the track heights
  (rising and falling along ramps); on street lines from the structure of each
  segment, changing over the ramp length the mode's gradient needs, centred on the
  change. Underground vehicles are drawn fainter the deeper they are, with a dotted
  white outline, so a vehicle entering a tunnel fades out gradually along the ramp.
- Limitations: the street is taken as flat (terrain follows, from the map's terrain
  tiles); vertical curves at gradient changes are not modelled; crossing checks use
  each track's own level, not the height along a ramp; the simulation does not slow
  vehicles on gradients.

## Operations

- Running speed per segment: `min(line max, segment limit, vehicle max) × f_ROW`
  with placeholder factors `f_ROW` = 0.40 (mixed traffic), 0.60 (dedicated lane),
  0.75 (dedicated track). Line running speed is the length-weighted harmonic mean.
- Cycle time: two-ended lines `2 × (L / v + n × dwell) + 2 × layover`;
  rings `L / v + n × dwell + layover`.
- **Fleet (R16)**: the design headway is the shorter of the timetable headway and the
  headway the expected demand needs, `h = 60 × C / D` (C passengers per consist at the
  planning load, D the expected peak demand at the busiest point in passengers per hour
  per direction): enough consists pass to carry the demand. Vehicles in service
  `N = ⌈cycle / h⌉`, with the cycle from one simulated round trip in the line inspector
  (the speed estimate above in validation and exports); spares `⌈N × spare ratio⌉`
  (project parameter, 20 %: the US FTA guideline for bus fleets of 50 or more vehicles,
  Circular 9030.1C ch. V §9.a.5 as reported in TCRP Synthesis 109, 2014; a ceiling for US
  buses, used as a planning allowance for every mode). The user may set the vehicles in
  service; with fewer than needed the simulation and the GTFS export run the line every
  `cycle / N` minutes, and validation warns. Demand above the capacity offered is
  warned. These are standard definitions (vehicles = cycle / headway; capacity = 60 / h ×
  C); no open library implementing demand-based fleet sizing was found (the GTFS libraries
  checked analyse existing service). Expected demand is user input until the ridership
  estimate (docs/EVALUATION_PLAN.md, E2) provides it.
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

Illustrative only: cruise speed per segment with constant acceleration after and
constant braking before every stop (see "Acceleration and braking" below), fixed dwell,
2-minute layover at terminals, one trip departing per peak headway, positions a
pure function of simulated time (each trip is built in time order from its
departure time). Rings circulate; one-way lines return out of service;
bidirectional lines reverse at terminals.

**Service day (F2)**: the animation runs a timetable. Each line departs from its service
start to its service end (past midnight when the end is earlier), every peak headway
inside the project's peak periods (Project properties → Service day; the defaults
07:00–09:00 and 16:00–19:00 are placeholders) and every off-peak headway outside them;
no trips outside the service span. The timetable repeats every day. Trips are assigned
to vehicles as they depart (vehicle blocking): of the vehicles free at the start, the one
that came back last runs it, so off-peak fewer vehicles circulate and the others stand
out of service; if none is free, the first one back leaves late. Until depots exist
(F5, F6), vehicles out of service stand at the end of their last trip (before their
first trip: at the start of the line). The clock shows day and time; it starts at the
first peak. Steady-state analyses (round trip, energy, operations report, GTFS) still
use a trip every peak headway. Street lines with a leg not yet routed on streets are not
animated (a vehicle never cuts across on a straight placeholder).

**Fleet register (F3)**: the project stores every vehicle (fleet number by mode, type,
line, status, date added, optional own capacity). After every edit each transit line's
need is its vehicles in service plus spares (R16); missing vehicles are added (surplus
vehicles of the same type first), extra ones and those of deleted lines become surplus.
Only the user deletes vehicles. The simulation's vehicle 1, 2, … of a line are its
allocated vehicles in fleet-number order; spares beyond those in service wait in their
depot slots (F6).

**Vehicle info window (F4)**: next stop = the next stop ahead in the direction of travel
(a ring continues past its end); load = expected demand (peak inside the peak periods,
off-peak outside, as entered for the line, passengers/hour/direction at the busiest
point) × the headway in force / 3600, against the vehicle's own capacity or the
consist capacity of its profile. Without an entered demand or capacity no figure is
shown, only what is missing.

**Street depots (F5)**: a depot of bus, BRT or trolleybus is a point with a capacity
(default: the mode's vehicles, surplus included, shared over its depots; or an own
value). Vehicles are allocated line by line to the nearest depot of their mode with
room (straight-line distance from the line start, only for the choice), surplus vehicles
to any with room. The runs between depot and line follow street routes from the routing
server (stored with the depot, with provider and date); their durations come from the
router. Without a routed link a vehicle waits at its line end: it never cuts across.
Parked vehicles are drawn in rows beside the depot point (a drawing aid; the yard layout
is not modelled).

**Surplus vehicles (F7)**: a vehicle no line needs any more has no trips, so it stands in
its depot the whole day: at a street depot in the places after the line vehicles, on rail
in the depot track room left after the line vehicles (same minimum gap). The model does
A vehicle the edit makes surplus while it is on a trip first finishes that trip: at the
edit its positions until the trip's end are taken from the plan before the edit (every
5 s, at the current simulated time) and stored with the vehicle, so the animation stays
a pure function of time. It then drives to its depot place out of service: street modes
back along the line (its return geometry where it has one) to the line start and on the
routed street link; rail over the mode's tracks to its depot-track slot (at the depot-run
speed). Without such a way it stays at the end of its trip and an error is raised. The
user is notified and decides whether to delete them.

**Vehicle types and reassignment (F8)**: a line has a main vehicle type, which sets how
many vehicles it needs (headway, cycle time, demand), and may accept other types of its
mode. A line short of vehicles takes surplus vehicles of its mode and of an accepted type
first. Among them it prefers vehicles that can reach the line's first stop (street modes:
their depot has a routed street link to and from the line; rail: a path over the mode's
tracks from a depot track to the line's start and back), then the shortest way
(straight-line depot distance for street modes, path length for rail). If none can reach
it, the nearest is still assigned and an error is raised. Capacity and vehicle shape
follow each vehicle's own type. A vehicle without a depot place (no depot, or no room)
is drawn waiting before the start of the line it serves or last served (the line extended
straight backwards: a drawing aid) and a warning is raised; it is never removed from the
map.

**Depot tracks (F6)**: tracks no service uses can be marked as depot (stabling) tracks
(track inspector → Use); services are routed around them. Each rail mode needs as much
depot track as all its consists are long, with the minimum gap (`followingMinGapM`)
between them (vehicles in service plus spares, R16); with less, a warning asks for more
track. Each vehicle gets the nearest free slot (shortest path along the tracks from the
start of its line, slots filled from one end of each depot track). In the service day,
a vehicle whose next trip is far enough away to run to its slot and back does so, at
`depotRunSpeedKmh` (25 km/h, a placeholder: shunting speeds are operator rules, e.g. DB
Ril 408, not public), waits there (at night too) and runs back just before its next
trip. Vehicles without a slot wait at the line end. Limitation: the empty runs are not
yet checked against other trains' occupancy.

**Vehicles in service** (rings and two-direction lines): the line runs a fixed fleet,
N = ⌈cycle / headway⌉ (the cycle is one undisturbed round trip; R16). Vehicle k runs
every N-th trip; between trips it waits at the start of the service until its next
departure, so the same N vehicles circulate and never vanish. A vehicle that comes back
late (occupancy waits) leaves late on its next trip. Vehicles set by the user beyond N
stay out of service (fewer than N lengthen the headway, R16). One-way lines without a
ring still end their trips out of service.

**Drawing**: vehicles are drawn to scale from zoom 15.5. Each car or articulated section
of each unit of the consist (`units per consist` of the line, else of the vehicle
profile; sections per unit from the profile, else round(unit length /
`vehicleSectionLengthM`), a 20 m drawing placeholder) is a rectangle of the profile's
width from its front to its rear point on the path, so the train bends through curves
section by section. The position is the middle of the train (a stopped train stands
centred on the platform); beyond the ends of a line the path continues straight, so a
train at a terminal keeps its full length. Without a vehicle type the length is the placeholder
`unknownVehicleLengthM` (20 m); without a width, the placeholder
`unknownVehicleWidthM` (2.5 m), both editable in Project properties → Parameters. Services on double track return on the
other track.

- **Traffic signals** (tram, light rail, bus, BRT; street-level segments only): a
  vehicle reaching a signal on red waits until the next green. A signal with an
  approximate delay holds each vehicle for that fixed time instead. A signal
  attached to a line or track applies only there; one whose controls are set
  applies only to the vehicles it controls (trams, buses). Signals are placed by
  hand or found in OSM; the absence of a mapped signal does not mean there is none. Signals come from
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
- **Crossings and shared streets** (`simulation/conflicts.ts`): where two lines'
  paths intersect on the same level without sharing track, of any modes (also two
  bus lines or two tram lines on unconnected track), the crossing is a zone from the
  clearance plus one vehicle length before it to the same distance after it
  (placeholders: clearance 5 m, 20 m for a line without a vehicle type). Only one
  vehicle is in a zone at a time. Street-routed lines (bus, BRT, trolleybus) on the
  same street (paths within 4 m for at least 30 m) share it: in the same direction
  they keep the minimum separation and wait where they merge; opposite directions
  use their own lanes. Rail lines that merge onto the same track already share the
  track. **Priority**: the mode order (default commuter rail, metro, elevated
  metro, light rail, tram, trolleybus, BRT, bus; editable per project); the lower
  mode waits until the crossing is clear. Within one mode the vehicle that arrives
  first goes first. Trips of higher-priority lines are scheduled first (up to one
  trip length ahead), so a lower-priority vehicle that arrives first can still be
  held for one that arrives just after it; a higher-priority vehicle waits only when
  a lower one is already inside the zone. Positions stay a pure function of
  simulated time. Lane-level geometry, turning conflicts inside junctions and
  signal-controlled priority are not modelled.
- Crossovers are drawn up to 80 m before or after their station (a display position,
  not a design).
- **Track occupancy** (services on tracks): a single-track block, meaning a chain of
  bidirectional tracks with nowhere to pass, is reserved by one direction at a time.
  Trains of the other direction wait at its entry. Following vehicles on any track
  or bus route keep their distance, applied as a time gap at entry and exit (see
  "Following the vehicle ahead" below).
  Trips are scheduled in a fixed order (departure, line, service), so results are
  deterministic.
  - Limitations: a waiting train does not block the track behind it, signals inside
    a block do not extend the reservation, and there is no interlocking, signalling
    or braking model.
  - Waits longer than the headway mean the timetable exceeds the section's capacity.
- **Junction zones** (R14b): every track node where three or more track ends meet
  (junctions, turnouts, crossings of tracks) is a zone held by one route at a time,
  after OSRD's routing requirements (documentation, "Conflict detection",
  osrd.fr/en/docs/reference/design-docs/conflict-detection/, read 21 October 2026): two
  trains on different routes through the node never hold it together; trains on the
  same route (same entry and exit track end) only keep their following separation.
  - **Where a train waits**: at the clearance point of its track, the point where the
    converging tracks are `clearanceMarkerSpacingM` (3.50 m) apart, measured from the
    drawn geometry. The clearance marker's meaning is in the German signal rules (ESO
    signal Ra 12; BOStrab signal Sh 6 for trams), which give no distance; the 3.50 m
    comes from German Wikipedia, "Grenzzeichen" (secondary, uncited there). Signalled
    modes (metro, commuter rail) stop a further signal overlap back, by line speed:
    none up to 30 km/h, 50 m up to 40, 100 m up to 60, 200 m above (German Wikipedia,
    "Durchrutschweg", after Jochim & Lademann 2008; UK practice about 180 m). All are
    parameters in Project properties.
  - A train holds the zone from its head reaching that point until its tail has passed
    the clearance point beyond the node. The simulated position is the middle of the
    train, so the zone reaches half a train further on both sides.
  - **Route setting**: before a junction, the train asks for the junction and the
    sections just beyond it together, and goes only when all are free, or held by a
    train ahead running the same way at the following distance. Otherwise it waits
    clear of the junction. A section is released when the train has actually left it
    (the middle of the train past its far end, which reaches half a train beyond the
    track), not at the estimate made on entry.
  - Single-track blocks reach half a train beyond their ends. The time to reset a
    turnout between routes is not modelled (no cited value).
- **Platform tracks**: a platform track of a station holds one train at a time, of any
  line and direction, through its dwell and, at a terminal, its layover; the next
  train waits with its head behind the tail of the standing one.
- **Operations report** (Dashboard): one hour of service at the peak headways is
  scheduled in the same order as the animation; the waits for occupied track are summed
  per line and per place (single-track section, junction zone, crossing with another
  line, shared street or track ahead), with the capacity warnings of the scheduling.
- **Changing track at the ends**: a two-direction service whose way back starts on
  another track than the way out ends on, with no permitted track path between them, is
  reported (the animation would show a jump); a crossover, a turning loop or a service
  that returns to its first stop resolves it.
- Not modelled yet: signalled block sections with their spacing requirements (signalled
  modes keep a fixed placeholder distance, see "Following the vehicle ahead").

## Schematic

Stations are scaled from geography so the median stop spacing is three grid
steps (40 px), snapped to the grid, collisions moved to the nearest free cell;
consecutive stations are joined with octilinear elbows. Manual offsets are stored
per station. Crossing minimisation is not implemented yet.

### Energy from train physics

With train physics, each round trip also gives an energy estimate (line inspector, full
export). Over every integration step the force at the wheel that produces the simulated
motion is `F = m·a + R(v) + m·g·i` (the equation of motion above solved for the force);
where `F > 0` the traction delivers `F·Δx`, where `F < 0` the brakes absorb `−F·Δx`.
NeTrainSim (Aredah, Fadhloun & Rakha 2024, section 4.4) derives energy from the same
forces.

- Reported at the wheel: traction energy and braking energy per round trip of one
  vehicle, and traction energy per kilometre.
- From the supply: `E = E_traction / η − E_braking · r + P_aux · t`, with the vehicle's
  efficiency from supply to wheel `η`, the share of braking energy fed back `r`
  (regeneration and the receptivity of the supply together) and the auxiliary power
  `P_aux` over the round-trip time `t`. These are vehicle inputs without defaults; while
  any is missing, the supply figure is not estimated and the panel says which input is
  missing.
- Estimated under the selected assumptions for the line's first round trip; not a
  measured value. Not included: efficiency varying with load and speed, line losses in
  the supply, and the energy of waiting with the doors open beyond the auxiliary power.

### Acceleration and braking

Each run between two events is a speed profile: accelerate at the rate `a` from the
speed the vehicle has, cruise at the segment speed, brake at the rate `b` to the
speed it must have at the end. The equations are those of uniformly accelerated
motion, as in SUMO's vehicle model (written from the published equations; no SUMO
code is used): `x = v₀t + ½at²`; the peak speed of a section of length `d` is
`v_p = min(v, √((2abd + b·v₀² + a·v₁²)/(a + b)))`.

- A vehicle starts every leg from standstill and stops at every station dwell,
  fixed hold and at the end of its leg. It never runs faster than allows stopping at
  the next such stop at the rate `b`.
- At a red signal or an occupied section it brakes to a stop where it waits (the run
  before is re-timed, and the wait is computed from the later arrival); on green it
  passes at speed.
- Where a section is too short to stop at `b`, the braking in that section is just
  strong enough; speed changes between segments with different limits are
  immediate.
- An occupied section is reserved for the cruise time plus one stop loss
  `v/(2a) + v/(2b)` per stop inside it and for the start, so reservations do not
  overlap.
- Rates: the vehicle profile's acceleration and service braking; where none is given,
  the documented defaults of the matching SUMO vehicle class (Eclipse SUMO
  documentation, "Vehicle Type Parameter Defaults", DLR and others, edited 12 October
  2026, https://sumo.dlr.de/docs/Vehicle_Type_Parameter_Defaults.html): bus, BRT and
  trolleybus 1.2 / 4.0 m/s² (class bus), tram, light rail and custom 1.0 / 3.0 m/s²
  (class tram), metro and commuter rail 1.0 / 3.0 m/s² (class rail_urban; SUMO gives
  no rate for subway). SUMO has no BRT, trolleybus or light-rail class; the closest
  class is used. SUMO describes these as comfortable service values, not the maximum
  a vehicle can reach.

### Running time from train physics

When a line's vehicle profile gives **mass in service** and **traction power at the
wheel**, each run is computed from the forces on the train instead of constant rates.
The methods are taken from two published descriptions and written here from them; no
code of either project is used.

- **Equation of motion** (OSRD documentation, "Running time calculation: physical
  modelling", Open Rail Association, osrd.fr/en/docs/explanation/running_time_calculation/,
  read 21 October 2026): `a(v, x) = [F(v) − R(v) − m·g·i(x)] / m`, with the Davis running
  resistance `R(v) = A + B·v + C·v²` and the equivalent gradient `i(x) = s(x) + 800 / r(x)`
  (per mille; `s` the line gradient from the levels and ramps, `r` the curve radius in
  metres from the track geometry).
- **Tractive force** (Aredah, Fadhloun & Rakha 2024, "NeTrainSim: a network-level
  simulator for modeling freight train longitudinal motion and energy consumption",
  Railway Engineering Science 32(4):480–498, doi:10.1007/s40534-024-00331-x, CC BY 4.0,
  Eq. 4): `F(v) = min(P / v, F_max)`, power-limited at speed. `F_max` is the vehicle's
  starting tractive effort; where it is not given, the adhesion limit `μ·m·g` with the
  project parameter μ (default 0.4, the value of NeTrainSim's validation scenarios on dry
  rail; applied to the whole mass, which overstates the starting force of vehicles with
  unpowered axles).
- **Envelopes** (OSRD, "Running time calculation: pipeline" and "envelopes system"): the
  most restrictive speed profile from the line, segment and vehicle speed limits, held
  until the tail of the train has left a slower section; braking curves built backwards
  at the constant service deceleration (OSRD's "hourly" braking) from every stop and every
  lower limit ahead; the acceleration curve integrated forwards (fourth-order Runge-Kutta
  over distance, steps of about 5 m, also over constant-speed parts so that a train slows
  on steep upgrades); the lowest curve applies. Time over each step assumes constant
  acceleration within it: `Δt = 2·Δx / (v_i + v_{i+1})`.
- The vehicle profile's acceleration, if given, caps the acceleration (comfort limit).
- Where a train takes the diverging route of a turnout with a known speed, that speed
  limits it over the first element of the diverging track (docs/TURNOUTS_AND_CROSSINGS.md).
- On dedicated track the speed limit applies as it is; on streets (mixed traffic or a
  dedicated lane) the right-of-way factor still stands in for traffic.
- A train that cannot hold its speed on an upgrade crawls at 0.5 m/s and the
  simulation reports it.
- Not modelled: discrete throttle notches, jerk limits and exponential smoothing
  (NeTrainSim), allowances and economical driving (OSRD's linear and MARECO
  allowances), and the gradient's effect on braking.
- Without mass or power, the constant-rate model below applies.

### Following the vehicle ahead

- Buses, BRT, trolleybuses, trams and light rail drive **on sight**: they keep the
  steady-state gap of the Intelligent Driver Model (Treiber, Hennecke & Helbing 2000,
  "Congested traffic states in empirical observations and microscopic simulations",
  Physical Review E 62, 1805), `s* = s₀ + v·T`, behind the rear of the vehicle ahead
  (whose consist length is added). Defaults: minimum gap `s₀` = 2.5 m (SUMO minGap for
  bus and tram, "Vehicle Type Parameter Defaults") and time gap `T` = 1.0 s (SUMO
  default tau). In the occupancy rules this is the time gap `T + (s₀ + L) / v` at the
  entry of each section, with `v` the section's average speed.
- Metro and commuter rail run under **signalling**: they keep a fixed minimum distance
  (placeholder 200 m; the real value follows from braking distance and the
  signalling system).
- Limitations: this is the steady state of the model, applied where vehicles enter a
  section; a vehicle does not slow down gradually behind a slower one between two
  sections, and the IDM's approach term (`v·Δv / (2√(ab))`) is not used.

## GTFS export

The GTFS Schedule feed describes the sketch, not a published timetable:

- `routes.txt`: one route per line; `route_type` by mode (tram and light rail 0, metro 1,
  commuter rail 2, bus and BRT 3, trolleybus 11).
- `stops.txt`: the stations served by an exported line.
- `trips.txt`, `stop_times.txt`: one trip per direction (one for rings and one-way lines;
  a loop ends at its first stop again). Times are offsets of the simulation's first,
  undisturbed trip (running time with acceleration and braking, dwell), starting at the
  pattern's service start; signal and crossing waits are not included.
- `frequencies.txt`: the trip repeats at the peak headway from service start to end
  (`exact_times = 0`); off-peak headways are not exported yet.
- `calendar.txt`: every day, valid one year from the export date. `shapes.txt`: the
  line geometry (the return path where it differs). `agency.txt` and `feed_info.txt` use
  the project name, this deployment's address and the browser's time zone.

## SUMO export

Files for Eclipse SUMO (owner decision: interoperate through files; no SUMO code is
used or bundled):

- `network.nod.xml`, `network.edg.xml`: track nodes and tracks as plain XML with
  longitude/latitude coordinates (build with `netconvert --proj.utm`, as SUMO's
  "Networks/PlainXML" documentation describes). Each track is an edge in its permitted
  direction; a track used both ways is two edges joined by `bidi`. `allow` is the SUMO
  vehicle class of the track's mode (tram → tram, light rail and commuter rail →
  rail_urban, metro → subway); speed is the track's limit, else the mode default.
- `stops.add.xml`: each station's platform on the route's track as a `trainStop`
  (platform length centred on the station).
- `routes.rou.xml`: per rail service a `vType` (consist length, width, acceleration,
  braking, maximum speed) and per direction a `flow` repeating at the peak headway
  between service start and end, stopping for the line's dwell time.
- Street lines are not exported here: the project has no street network. They reach
  SUMO through the GTFS export (SUMO's `gtfs2pt` with an OSM network).
- Checked with SUMO 1.28.0: `netconvert` builds the network and `sumo` runs the flows
  with their stops.

