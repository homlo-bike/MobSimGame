# Phase 4 plan: owner requests of 21–23 October 2026

This plan records every request from the owner's feedback of 21–23 October 2026, the
answer to each question, the proposed approach and the open points. Work items get an
ID (P4-xx) used in PRs and the CHANGELOG. Nothing here is implemented yet unless the
item says so.

Rules that apply to every item: no invented figures (every default is cited or labelled
*placeholder*, with status `documented_default`, `user_override`, `calibrated` or
`demonstration`), provenance on all data, AGPL-compatible dependencies only, keyboard
paths and WCAG 2.2 AA, and docs/CHANGELOG with every change.

**Research status.** The background research on standards and on the linked
repositories stopped early because the research tool hit a usage limit. Statements below
marked *to verify* still need a primary source. Licences of the linked repositories have
**not** been checked yet. No code is taken from any of them before that check (see
P4-00).

---

## 0. Decisions already made (owner answers)

| Topic | Decision |
|---|---|
| File menu | "Project preferences…" (saved in the project) and "Settings…" (this browser / this server). |
| Spare vehicles | A spare ratio **per mode**, editable in Project preferences, with a cited default per mode. |
| Line vehicle types | Main type + accepted types (F8, merged). |
| Notifications | Pop-up and keep per severity (F8, merged). |
| Owner of an instance | The first user to log in becomes the owner (OIDC, see P4-40). |

---

## 1. Vehicles, energy and the vehicle catalogue

### P4-01 Vehicle catalogue (default library + custom library)

- **Data.** One JSON file per vehicle model under `frontend/src/data/vehicles/<mode>/<id>.json`,
  validated by a Zod schema built from the owner's field list:
  - identity
  - dimensions
  - consist (cars, articulations, bogie and pivot positions)
  - doors
  - capacity, with seated and standing capacity separate
  - performance
  - energy
  - infrastructure (gauge, platform heights, loading gauge)
  - operation
  - costs
  - visual
  - suitability scores
  - provenance, with a confidence per group and the data quality

  An index file lists the models so the app loads the details lazily.
- **Fields added for the simulation:**
  - `energy_supply_type` and `energy_storage_type`;
  - `maximum_range_km`, and the time to recharge or refuel (`recharge_time_min` / `refuel_time_min`);
  - axle positions for road vehicles (`axle_positions_m`, plus articulation joints) for the swept-path model in P4-05;
  - `seating_capacity` and `standing_capacity`, already in the template;
  - `standing_density_pers_m2`, the basis of the standing figure, for comparability;
  - platform compatibility as a list of `{ height_mm, standard }`.
- **Sources, in order of preference:**
  1. manufacturer data sheets (PDF, with a date);
  2. operator fleet pages;
  3. type-approval documents;
  4. Wikipedia, as a secondary source only, with lower confidence.

  Every figure carries its source URL. Cost fields stay empty unless a public source
  gives them; prices are rarely published, so most will be *not available*.
- **Categories.** The owner's list, 2–10 models each:
  - Bus
  - Tram
  - Light rail
  - Metro
  - Regional rail
  - Long distance
  - Intercity bus (P4-03)
- **Side-view drawings.** Public-domain or CC0 drawings are rare. Wikimedia Commons has many
  CC BY-SA side views; BY-SA is compatible with an AGPL project only if attribution and
  share-alike are kept for the image itself, and the licence stays per image. Default
  approach: **generate** a schematic side view (SVG) from the catalogue geometry (car
  lengths, doors, bogies, pantographs, windows). This needs no licence and always matches
  the data. A Commons photo link is optional, with its licence shown.
- **Libraries.** The default library ships with the app (read-only). The custom library is
  kept in Settings (this browser, or the server for logged-in users), with upload/import of
  JSON files validated by the same schema. A project file **embeds** every custom vehicle
  it uses, so it opens anywhere.
- **Vehicle creation UI:**
  - a step-by-step form (identity → dimensions → consist → doors/capacity → energy → infrastructure);
  - "start from a catalogue model";
  - a live side-view preview;
  - validation messages per field.

### P4-02 Electrification and power supply

Recommended approach: one **power supply** concept with inheritance (G1 pattern). This
makes the default and any override explicit at every level and gives one place to check
compatibility.

1. **Project preferences:** a default supply per mode. Every mode is electrified except bus
   and BRT (owner rule).
   - Supply system: overhead line, third rail, fourth rail, or none.
   - Nominal voltage: chosen from the standard list in EN 50163 (600 V DC, 750 V DC, 1500 V DC,
     3000 V DC, 15 kV 16.7 Hz AC, 25 kV 50 Hz AC; *to verify* against the standard's table).
   - Default per mode: *placeholder* until cited (typical: tram/LRT 750 V DC, metro
     750 V DC third rail or 1500 V DC overhead, mainline 15 kV or 25 kV AC by country).
2. **Track:** inherits the project default for its mode, or has its own supply. This
   extends the existing `track.electrification` field, which already inherits.
3. **Street lines:** bus/BRT are not electrified by default; trolleybus has an overhead
   line, 600 or 750 V DC.
4. **Service line:**
   - which supply its vehicles use where several exist (dual-system vehicles);
   - how a non-electrified section is run: battery, diesel, hydrogen, or "not allowed".
5. **Check:** every vehicle of a line must support the supply on every track it uses, or
   carry its own energy for the unelectrified distance (range). Otherwise it is an error,
   with a suggestion (electrify the section, choose a battery vehicle, change the line).

### P4-03 New modes: intercity bus, regional rail, long-distance rail

- **Intercity bus / coach: its own mode, recommended.** It differs from urban buses in
  vehicles (coaches, often double-deck), stop spacing, speed, timetable style, fares and
  terminals. It can still use the same streets and share stops or bus stations with urban
  buses (shared infrastructure class `street`). As its own mode it gets its own defaults,
  colours, tab and statistics.
- **Regional rail and long-distance rail: new modes** next to commuter rail. They share the
  mainline track class (same gauge, supply and signalling), so all three can run on the
  same tracks and stop at the same stations, as the owner asked.
- Schema change: `TransportMode` gains `intercity_bus`, `regional_rail` and
  `long_distance_rail`. The mode compatibility table is extended. Schema 3 has no migration
  (owner decision), so old files with these modes do not exist.

### P4-04 Range, recharging and refuelling in the simulation

- Every vehicle has an energy state. Battery vehicles track state of charge (kWh). Fuel
  vehicles track litres or kg.
  - Consumption comes from the existing energy model (R15b) for rail, and from the
    catalogue's kWh/km or l/km for road.
  - Vehicles running under a live overhead line do not use stored energy (trolleybus with
    in-motion charging recharges there).
- **Planning, not running dry.** Before each trip the blocking step checks whether the
  vehicle can finish the trip **plus** the run to the next charging/refuelling point with a
  reserve. The reserve is an editable percentage, *placeholder*. If not, it is sent to
  charge or refuel first, and a spare takes the trip.
  - Charging can happen at a depot (overnight, plug-in), at a terminal (opportunity
    charging, pantograph), or in motion (trolleybus/IMC).
  - Charging time comes from charger power and battery acceptance; the energy figures are
    the vehicle's, the charger power is the facility's.
- **Depots and terminals** get charging facilities (P4-12): the number of chargers and their
  power.
- The vehicle window shows battery or fuel level and the remaining range when the vehicle
  is not running on a contact line.
- This changes fleet size. Charging time is added to the cycle time where it cannot be
  hidden in layovers. The dashboard shows the extra vehicles needed.

### P4-05 Road vehicle kinematics (wheels simulated, not drawn)

- Buses, BRT and trolleybuses move with a **kinematic bicycle model**: steered front axle,
  fixed rear axle(s), and for articulated buses the joint and the trailer axle. Axle
  positions come from the catalogue. This is the standard swept-path method of tools such as
  AutoTURN and Vehicle Tracking (*to verify*; we implement the published kinematics, not
  their code).
- The vehicle body follows its axles. When zoomed in, the drawn body is where a real bus
  would be. The **swept path** of each turn is computed and compared with the street space,
  using OSM `width`/lanes or a default carriageway width, so tight turns are flagged
  ("turn at X needs about N m, the street gives M m").
- Two-way streets: vehicles keep to their side, offset half a lane from the centreline
  (P4-07).

### P4-06 Rail vehicle geometry: cars, bogies, couplings, articulated trams

- **Today.** A consist is a chain of units divided into sections drawn along the path. There
  are no bogies, so a car's body bends with the path.
- **Proposed.** Each car body is a rigid rectangle placed by its **two bogie centres**, both
  on the track (a chord between them). Couplings and gangways join the cars. This gives the
  correct overhang on curves (end and centre throw), which also drives the clearance checks.
- The owner's tram layout (bogie section, suspended section, short bogie section, suspended
  section, end section, all joined by gangways) is the **multi-articulated low-floor tram
  with suspended ("floating") modules**, as in Siemens Combino and Alstom Citadis
  (*to verify* per model).
  - Geometry: each module with running gear is placed by its bogie (one bogie per module,
    so the body is aligned with the track tangent at the bogie). Each suspended module hangs
    between the joints of its neighbours.
  - A longer vehicle repeats the pattern.
  - This is implementable with the catalogue fields `car_lengths_m`, `bogie_positions_m` and
    `pivot_points_m`.

### P4-07 Driving on the correct side

- Driving side comes from the project location: a country table, ISO 3166 → left/right,
  cited source. It can be overridden in Project preferences.
- On two-way streets each direction is offset by half a lane from the street centreline.
  Lane width comes from OSM tags or a *placeholder* default. Opposing vehicles never overlap.
- Rail: track sides are physical tracks already. Left/right running on double track follows
  the same setting per network, editable (many countries run rail on the left even with
  right-hand road traffic; *to verify* per country).

### P4-08 Platforms and vehicles

- **Platform standards.** A list of named standards, for example EU TSI PRM 550 mm and 760 mm
  (*to verify*), common tram low-floor heights, metro heights, and the US 8 in / 48 in
  heights. Each has a height and an edge distance from the track centre. The project
  default is per mode; each station or platform can override it.
- Choosing a standard **filters** the compatible vehicles: floor height and door threshold
  against platform height, and car width against edge distance.
- **Gap check.** For every vehicle on every platform it serves, the horizontal and vertical
  gaps are computed from vehicle width, floor height, platform edge position and height.
  - The thresholds are editable, with a cited default: EU TSI PRM, horizontal 75 mm
    (200 mm in special conditions) and vertical 50 mm, as the owner states (*to verify*
    against Regulation (EU) 1300/2014).
  - Above the threshold: a warning. Incompatible: an error, with recommendations (raise the
    platform, add a gap filler or bridging plate, choose another vehicle).
- The catalogue gives suitable platform dimensions per vehicle (height, minimum length,
  minimum width).

### P4-09 Seated and standing capacity

- Capacity is split into seated and standing everywhere (catalogue, profiles, loads, reports).
- Project preferences, per mode: "count standing places". Each line can override it, for
  example a seats-only express or a coach. Coaches and long-distance trains default to
  seats only (*placeholder* until cited).

### P4-10 Spare ratio per mode

Per the owner's decision, one ratio per mode in Project preferences. The current single
20 % value is the US FTA bus guideline for fleets of 50+ buses (FTA Circular 9030.1). Rail
values need their own sources (*to verify*). Until then they are labelled placeholder.

---

## 2. Depots

### P4-11 Street depots as dynamic polygons

A depot becomes an object you can move and rotate. Its exit faces the street.

- **Inputs:**
  - accepted vehicle types (slot size follows the largest accepted type);
  - the number of slots, or the length of one side;
  - optional sections: maintenance, reserve/spares (each on/off, with its number of slots);
  - charging facilities (P4-12).
- **Layout.** The owner's proposal is a row of 45° drive-through ("pit stop") bays, entered
  from one side and left from the other. This matches the common angled drive-through
  layout (*to verify* against depot design guidance such as TfL bus garage guidance and VDV
  depot recommendations).
  - Generated from cited vehicle dimensions, turning circles (EU: 12.5 m outer / 5.3 m inner
    swept circle, UNECE R107 / Directive 97/27/EC, *to verify*), and aisle and access-road
    widths.
  - Slots are not reserved for one type. Dispatch takes the first vehicle of a suitable type
    at the head of its lane (lane stacking), so any type can be requested without blocking.
  - The length/width ratio follows from the number of rows and bays. A formula keeps it
    within limits the user can set.
- **Movement inside the depot:**
  - one-way aisles;
  - a fixed in and out path per slot (precomputed from the bays' geometry with the bicycle
    model of P4-05);
  - an occupancy ledger like the rail one, so no two vehicles overlap or pass through each
    other.
  - The street-to-depot transition is a smooth curve from the street lane into the gate.
- **Linked repositories.** HAStar_ParkingPlanner (hybrid A* parking) and the depot/bus
  repositories listed by the owner will be checked for licence and usefulness before use. A
  hybrid-A* planner is only needed for free-form yards; fixed per-slot paths are simpler and
  deterministic, and are proposed first.

### P4-12 Charging and refuelling facilities

Each depot and terminal can have chargers (count, power) or a fuel station. The charging
schedule follows P4-04.

---

## 3. Simulation

### P4-20 Simulation panel (Map tab only) and statistics

- Simulation controls move to the left panel of the Map tab and are hidden elsewhere.
- Below the controls, live statistics:
  - vehicles in service, deadheading, parked, charging;
  - punctuality and average delay;
  - waits at junctions;
  - overcrowded vehicles;
  - energy.

### P4-21 Calendar simulation: days, weekends, holidays, seasons, years

- The simulation runs day cycles over a set number of **virtual years** (Simulation panel),
  not forever.
- Each day has a day type (workday, Saturday, Sunday, holiday) and a season. Holidays come
  from the project location through **Nager.Date** (free public-holiday API; licence and
  terms *to verify*), via the backend provider with Provenance.
- Project preferences gain the service windows:
  - service start/end on workdays, weekends and holidays;
  - morning and evening peaks;
  - optional reduced weekend/holiday service.

  These feed operating cost and ridership per year.
- Each simulated day can be computed independently, because the engine is a pure function
  of time. A year is then a set of day runs that can be cached, which keeps multi-year runs
  feasible.

### P4-22 Weather and climate

- Monthly average temperatures and the extremes for the project location come from a free
  climate source (candidates: Open-Meteo historical/climate API, NASA POWER, Meteostat;
  licences and attribution *to verify*), through a backend provider with Provenance.
- Each simulated day gets its month's averages. Cited effects are applied as advisory
  findings and optional simulation inputs:
  - heat speed restrictions for rail;
  - overhead line sag;
  - battery range loss in cold;
  - HVAC energy.

### P4-23 Failures and outages

- Inject failures at a time:
  - a track section closed;
  - a signal or power failure;
  - a station closed;
  - a vehicle breaking down;
  - a charger out of order.
- The system responds:
  - the failed vehicle goes to the depot or is towed;
  - a spare is sent from the nearest depot;
  - trains short-turn or reroute (P4-30);
  - replacement buses run where configured.
- All of it is recorded: delays, cancellations, passengers affected. This extends the
  existing disruption panel.

### P4-24 Timetables per stop

- **Today.** The engine generates departures from headways, and running times come from
  physics. Arrival times at each stop are implicit.
- **Proposed:**
  - an explicit **planned timetable** per trip and stop: undisturbed running time plus a
    recovery margin (editable, cited or placeholder), for peak and off-peak;
  - vehicles that are early **wait** until the scheduled departure (timing points: all stops
    for rail, chosen stops for buses);
  - delays are simulated against the plan.
- The timetable is not shown in the UI. It is downloadable as GTFS (`stop_times.txt` with
  real times; GTFS export exists, R9) and as CSV.
- **No warm-up needed.** Generating timetables "after x round trips" would make the plan
  depend on simulated noise. The plan comes from the deterministic running-time model, and
  the simulation measures the difference.

### P4-25 Stop and station windows (Map tab)

- The next 5 arrivals, with the time remaining and the platform for rail.
- Colours plus text (never colour alone):
  - delays in red, with "+3 min";
  - on time or early in green;
  - "Cancelled (failure)" when a failure cancelled the trip.

### P4-26 Recording

The simulator records:
- delays per stop, line and day;
- overcrowding (load above capacity);
- missed connections;
- cancellations;
- platform and track conflicts;
- charging waits;
- failures.

Reports and CSV export.

### P4-27 Street congestion

- OSM has no reliable hourly traffic tag. `traffic:hourly` is not an established key
  (*to verify* on taginfo). openrouteservice routes on OSM with typical speeds and has no
  historic congestion data (*to verify*). Free historic congestion data is scarce; the
  commercial sources (TomTom, HERE) need keys and have restrictive licences.
- **Proposed:**
  - editable **congestion profiles** per street class and hour, for workdays and weekends,
    as speed factors. These are *placeholder* until the user calibrates them. Priority lanes
    (BRT, bus lanes from OSM) are exempt.
  - Optional providers with keys later, behind the backend allowlist.

---

## 4. Rail operations (traffic management)

### P4-30 Rail traffic management system (TMS)

This needs a design document of its own before code. It will be written as
`docs/RAIL_TMS.md` and cover:

1. **Architecture**
   - layers: infrastructure graph (tracks, nodes, permitted movements; exists), block and
     route model, timetable planner, dispatcher, conflict detector/resolver;
   - the simulation engine stays a pure function of time and consumes the dispatcher's plan.
2. **Data model**
   - blocks and routes (sets of track spans with release points);
   - platform tracks;
   - train paths (the sequence of blocks with planned times);
   - circulations (vehicle blocks).
3. **Algorithms**
   - routing: Dijkstra / A* for single paths, Yen's K-shortest paths for alternatives;
   - conflict detection on the blocking-time model (the standard UIC 406 capacity method,
     *to verify*);
   - resolution: priority rules first, then retiming/reordering with a bounded local search;
   - platform assignment as an interval-graph colouring with preferences;
   - vehicle circulation as a minimum-fleet chaining problem (each trip to the next trip
     from the same terminal within the turnaround).
4. **Scheduling**
   - peak/off-peak patterns (exists);
   - integrated timetables, with clock-face patterns and connections at hubs.
5. **Dispatching**
   - at run time, when a train is late: re-run conflict resolution in a time window ahead;
   - hold a train for a connection only within limits.
6. **Rules**
   - fixed priority order by mode/line;
   - first-come-first-served with exceptions;
   - a late train is never given priority over an on-time train beyond a set delay.
7. **Performance**
   - block-time intervals in interval trees;
   - incremental re-planning;
   - a web worker for the simulation;
   - day runs cached.

   Thousands of trains per day is feasible in the browser. Tens of thousands needs the
   backend.
8. **Roadmap and pseudocode** in the document.

Existing parts reused: the occupancy ledger, junction route setting, platform exclusivity
and the signal overlaps already implemented.

The linked projects (OpenTrack, Open Rails, railway-manager, Rail-Network-Route-Finder)
will be checked for method notes and licences. OpenTrack is commercial software, a
reference for concepts only. Open Rails is GPL-3.0 (*to verify*), so its code could be
combined, but it is a C# train simulator and is useful mainly for vehicle physics references.

### P4-31 Linked stations and "any platform" stops

- Stations near each other with the same name (the existing inherit-name rule) can be
  **linked** into one station group.
- A service line can then pick:
  - a station group (new "⊕ any platform" symbol): the router chooses the best platform; or
  - a specific platform track (the existing "+").

### P4-32 Station editing behaviour

- Today, moving a station restores the elements the user moved or deleted. That irritates.
- Proposed:
  - station elements stay linked to the station;
  - individual edits are stored as **offsets/overrides** on the station layout (so moving
    the station keeps them);
  - deleting an element records "removed" in the layout instead of being re-created;
  - "Reset layout" restores the generated one.
- Tracks inside a station stay inspectable.

### P4-33 Curve speed

- When editing a rail curve, show the permitted speed from its radius, cant and
  cant-deficiency limits: the standard relation v = √(R · (cant + cant deficiency) / 11.8)
  in km/h with mm and m (EN 13803, *to verify*).
- The limits per mode are editable in Project preferences, with cited defaults.

---

## 5. Map display

### P4-40 Visual layers and zoom thresholds

In Project preferences, for vehicles, tracks, depots and stations separately:
- on/off;
- the zoom level from which they are drawn.

This lets the user switch off expensive layers.

### P4-41 Tracks to scale

- **Zoomed in:**
  - each track is drawn as two rails at its gauge (default 1435 mm, standard gauge, editable
    per network and per track);
  - bridges get edge lines;
  - tunnels get a distinct casing.
- **Merging structures (proposed, instead of distance rules).** Build each structure's
  footprint (track width plus margins) as a polygon, then **union** all footprints of the
  same level (turf `union`) and draw the outline of the union. Where two structures come
  close or overlap, their outlines merge automatically. This gives:
  - shared tunnels;
  - bridges that join;
  - crossings on the same level;
  - double track in one box.

  No special distance rule is needed. It applies to all tracks of a level, whatever their
  mode.
- **Ramps** between levels get a hatched or gradient band.
- **Difficulty.** Moderate. The footprints are cheap; the union over many tracks needs
  caching per edit, and the rails need MapLibre line-offset layers at high zoom. It is
  feasible.

### P4-42 Stations by level

Underground, street-level and elevated stations are drawn distinctly. Elevated and
underground stations get an outline around the station body, not around their tracks.

### P4-43 Bus routes in tunnels and under bridges

Use OSM `tunnel=*`, `bridge=*` and `layer=*` on the routed street ways, from the routing
server's edge attributes or an Overpass lookup. Draw tunnel sections dashed or shaded, and
mark passages under bridges.

### P4-44 Track drawing preview

While a track is being drawn, show a live preview of the final geometry (lines and arcs,
single or double) instead of the raw polyline. The geometry library already computes this,
so it only needs throttling.

---

## 6. Schematic

### P4-50 Schematic editor

- No side panels. A layer filter per mode.
- When a mode is hidden, symbols of its lines appear next to the connecting stations of
  the visible lines.
- **Top section (network diagram):**
  - auto-generated base (octilinear layout);
  - the user moves, adds and removes line nodes, and adds or removes curves at nodes;
  - stations stay linked to their lines;
  - labels can be moved and rotated;
  - stop pairs on opposite sides of a street are shown once;
  - optional water areas (lakes, rivers, sea) from OSM, simplified to the schematic.
- **Bottom section (line strips):**
  - each line as a straight strip in its colour, grouped by mode;
  - stations with accessibility symbols and connecting lines;
  - line statistics (ridership, length, vehicles).
- Shared stations are distinguished from single-line stations in both sections.
- Linked projects (legible-cities, transit-map-generator, route-diagram, transit-map,
  lilibuild) will be checked for licence before any use. transit-map (juliuste) uses an
  octilinear MILP layout (*to verify* licence).

---

## 7. Demand, land use and active modes

### P4-60 Walking and cycling tabs (Create)

- **Walking:** select OSM streets as pedestrian spaces.
- **Cycling:** select OSM streets as cycle streets, bike paths or streets with bike lanes.
- **Effects** (factors in Project preferences, *placeholder* until cited):
  - bike infrastructure near a stop enlarges its catchment (bike-and-ride);
  - pedestrian zones reduce parking and raise transit demand.
- The linked demand repositories will be checked for method and licence. Most are
  notebooks or student projects; methods may be cited, code is unlikely to be reused.

### P4-61 Points of interest and demand

Yes, they will be taken into account (part of E2 ridership). OSM POIs (schools,
universities, hospitals, offices, retail, tourist attractions) become trip attractors with
weights. The weights are cited or placeholder.

### P4-62 Region attributes from OSM and other sources

- Look for the owner's attribute list. OSM rarely has most of them: `population` is common
  on boundaries, but income, age groups and car ownership come from census or statistics
  sources.
- Values found are stored per region with Provenance.
- **Priority rule:** the most specific region with a value wins (neighbourhood → district →
  city → region → country). A parent's value is only used when a child has none, and never
  split by area without saying so. When a child is missing a value, the parent value is
  scaled by area or population share and marked *derived*.
- This follows the usual small-area estimation practice of using the finest available
  geography (*to verify* with a citation).

### P4-63 Urban-planning recommendations (Create tab)

- A side card with short, cited recommendations triggered by the design, for example:
  - a stop without a bike rack near cycle routes;
  - a street with many lines and no bus lane;
  - a station without step-free access.
- Sources: published guides, for example the Amsterdam "Amsterdam maakt ruimte"
  (Amsterdam makes space) document the owner mentioned, if its licence allows quoting.
  Only cited statements are used.

### P4-64 Solar energy

- Estimate the PV area needed to cover operating energy: annual energy from the energy
  model ÷ specific yield at the project location. The yield comes from PVGIS (EU JRC, free
  API; terms *to verify*).
- Shown as "estimated under the selected assumptions".

---

## 8. Platform, users and app

### P4-70 Help, About and renaming

- **File → Help:**
  - how to use the app, with the meaning of the symbols, what users can do and the goal;
  - links to GitHub and the demo, https://mobsimlab.homlo-bike.de.
- **About:**
  - all sources and libraries;
  - where and how each is used, generated from the provenance registry and
    `THIRD_PARTY_NOTICES.md`.
- **Rename** to **Mobility Simulator Lab (MobSimLab)** in the app, docs and package names.
  The GitHub repository rename is the very last step (owner).

### P4-71 Users, roles and sharing (with OIDC, #38)

- Roles: owner > admin > user > viewer > restricted. The first login becomes the owner.
- Groups come from the identity provider and are mapped automatically.
- Admin settings (File, visible to admins and the owner only):
  - users and groups;
  - promote or demote;
  - restrict or delete;
  - auto-registration on/off.
- Projects on the server: private, shared with users or groups (view or edit), or public
  read-only with chosen editors.
- **Co-operative editing.** Every object already has an id. Adding `createdBy` / `updatedBy`
  metadata is simple.
  - Concurrent editing step 1: a project version number with save conflicts detected and
    merged per object. Moderate effort.
  - Real-time co-editing: a CRDT such as Yjs (MIT). Larger effort; it fits because edits are
    already pure functions over ids.
- **WMS layers (GIS tab):** add or remove WMS layers. Credentials are stored on the server
  and the backend proxies the WMS, so no browser-side secrets; this follows the existing
  rules.

---

## 9. External repositories to check

Each needs a licence check (AGPL-compatible?) and a short assessment before any use:
- **Vehicles and depots:**
  - HAStar_ParkingPlanner
  - BusManagementSystem
  - M4_BusJob
  - depot_locator
  - ebus-depot-simulation
- **Demand:**
  - mobility-demand
  - BusDemand
  - pipeline_bus-stop_boarding-demand-prediction
  - Urban-Metro-Operations-Analytics
  - bike_demand_api
- **Rail:**
  - opentrack
  - openrails
  - railway-manager
  - Rail-Network-Route-Finder
  - A-Simple-Game-About-Scheduling-Trains
- **Schematic:**
  - legible-cities
  - transit-map-generator
  - route-diagram
  - transit-map
  - lilibuild
- **Planners and games:**
  - tinytrains
  - universal-transit-planner
  - rrrr (RAPTOR router)
  - transit-planner (both repositories)
  - subte
  - transit-operational-data-standard (MobilityData TODS)
- **Reference:** UIC (standards).

The results go into `docs/REFERENCE_FEATURE_REVIEW.md`.

---

## 10. Proposed order

1. P4-00 menu rename (Project preferences / Settings) and P4-10 spare ratio per mode. Small.
2. V1 view-only Map tab and P4-20 simulation panel with statistics. The two belong together.
3. P4-03 new modes, P4-02 power supply, P4-09 seated/standing. The data-model base for the
   catalogue.
4. P4-01 vehicle catalogue (schema, first models per category, generated side views,
   custom library).
5. P4-06 bogie-based rail geometry and P4-08 platforms and gaps.
6. P4-24 timetables per stop, P4-25 stop windows, P4-26 recording.
7. P4-21 calendar and holidays, P4-22 climate.
8. P4-04 energy, range and charging; P4-12 chargers.
9. P4-11 depot polygons, P4-05 road vehicle kinematics, P4-07 driving side.
10. P4-41/42/43/44 map display.
11. P4-30 rail TMS (design document first), P4-31, P4-32, P4-33.
12. P4-23 failures.
13. P4-50 schematic editor.
14. P4-60 to P4-64 demand and active modes.
15. P4-70 Help/About/rename, then P4-71 with OIDC.
16. The remaining older items: PR-B, PR-C, PR-D, translations, desktop, Docker.

---

## 11. Open questions for the owner

1. **Catalogue scope.** Which regions and markets matter most (EU, UK, North America,
   Asia)? Which gauges besides 1435 mm (1000, 1067, 1520, 1668 mm)? Should hydrogen vehicles
   be included? Is the catalogue meant to be sold or used commercially? Data sheets are
   often copyrighted, but facts (dimensions, capacities) are not; we store facts with
   links, not documents.
2. **Costs.** Purchase and maintenance prices are rarely public. Should cost fields stay
   empty, or use cited ranges from tenders and reports (with confidence)?
3. **Order.** Is the order in section 10 right, or should something come first?
