# Phase 3 plan

Status: **planned**. Nothing below is available until its pull request is
merged; README and docs change with each pull request. Requirement status:
[PHASE_REQUIREMENTS_STATUS.md](PHASE_REQUIREMENTS_STATUS.md).

## Ground rules

- Each work package is one or more focused pull requests, never one Phase 3 PR.
- Each PR is on its own branch `claude/eloquent-edison-s2o70v-<id>` and is stacked
  on the previous one.
- **Foundations first.** Before anything that depends on them, these must land:
  - direction display (wp01);
  - validation categories and markers (wp02);
  - vehicle profiles (wp03);
  - manual signals (wp04);
  - station/stop rules (wp05).
- Pure logic goes in `domain/`, `geo/`, `validation/`, `analysis/`, `simulation/`
  and `schematic/`, and is tested there. `map/` and `ui/` only render and forward
  edits.
- No invented figures. Every default (grade, radius, spacing, platform size, speed,
  cost, emission) has:
  - mode, vehicle profile, unit and context or jurisdiction;
  - source and source date;
  - preferred and warning ranges;
  - a user override.

  Uncited values are marked placeholder. Cited guidance is never presented as a
  universal legal requirement.
- Every new dataset carries provenance and a capability state. Real places never
  show synthetic data.
- Accessibility: every task has a keyboard path, status is never shown by colour
  alone, and every icon has a text label.
- The simulation stays a conceptual, deterministic function of simulated time. It
  is not a safety-certified signalling or microscopic traffic model.

## Order

```
wp00 → wp01 → wp02 → wp03 → wp04 → wp05            (Phase 1/2 gaps, P1)
P3-02 → P3-03 → P3-04 → P3-05                      (infrastructure core)
P3-01, P3-07, P3-09, P3-12                         (regions, settings, stations, validation UI)
P3-06, P3-08, P3-10                                (geospatial, routing, interchange)
P3-13 → P3-14 → P3-15                              (operations, capacity, dashboard)
P3-11, P3-16, P3-17                                (schematic, i18n, responsive)
P3-18, P3-19, P3-20                                (migration, tests, release)
```

Each work package below lists its objective, dependencies, data-model changes, API
changes, UI changes, migration, tests, risks, definition of done and planned PR.
Schema changes after schema 3 are additive (defaults in Zod). P3-18 decides whether
a schema 4 needs migration once projects are published.

---

## P3-01 Geographic regions and demographic metadata

- **Objective.**
  - Users draw, edit and lock regions: polygons with holes where the draw library
    supports them, split and merge where practical.
  - Regions are typed:
    - neighbourhood, district, municipality;
    - commercial, industrial or residential area;
    - campus, hospital district;
    - development area, transit-oriented development area;
    - user-defined area.
  - Structured metadata (all from the brief):
    - name, type;
    - population, density and their year and source;
    - area (computed);
    - housing type and density;
    - median household income (currency, price year);
    - employment count and density;
    - car-ownership rate, modal split;
    - household size, rent, property value;
    - land-use mix, school enrolment, major destinations;
    - notes, confidence, source, URL, date;
    - status: observed, imported, assumed, estimated or synthetic.
  - Users also add custom key/value fields.
  - GeoJSON import and export.
  - Layer styling: fill, outline, opacity, labels, visibility.
  - City, municipality, district and neighbourhood lookup (brief §4).
- **Dependencies:** wp02 (findings model). The lookup needs a geocoding provider
  with boundaries (Nominatim/Photon via the backend, configurable).
- **Data model:**
  - `scenario.regions[]`: `{id, name, type, geometry (Polygon/MultiPolygon), style, locked, attributes: {[key]: SourcedValue}, metadata, provenance}`.
  - `SourcedValue`: `{value, unit, currency?, priceYear?, datasetYear?, source, sourceUrl?, sourceDate?, resolution, status, confidence, note}`.
  - Area is computed in a projected CRS and never entered.
- **API:**
  - `GET /api/v1/geocode?q=&kinds=`: candidates with type, admin hierarchy, bbox, boundary availability and provenance.
  - `GET /api/v1/geocode/boundary/{source}/{id}`: polygon with provenance.
  - Results cached within provider policy; timeouts and errors reported as a capability.
- **UI:**
  - Region tool and region inspector, with every sourced value showing its unit,
    year, source, resolution and status.
  - Layer panel group.
  - Lookup dialog with candidates.
  - "Create region from boundary", or "draw manually" when no boundary exists. A
    boundary is never invented.
- **Migration:** additive (`regions` defaults to `[]`).
- **Tests:**
  - area in projected metres;
  - holes;
  - GeoJSON round trip;
  - lock prevents edits;
  - lookup states: none, timeout, error, no boundary;
  - user values are never overwritten;
  - no individual-level inference anywhere.
- **Risks:** sensitive data; inconsistent sources; boundary licences (ODbL attribution).
- **Done when:** regions persist, export and import; every attribute shows unit, year, source and status; the lookup works offline-safe; keyboard paths exist.
- **PRs:** P3-01a (regions and editor, **implemented** in its PR), P3-01b (lookup and boundaries).

## P3-02 Mode-specific infrastructure architecture

- **Objective.** Every infrastructure segment has exactly one primary class:
  - tram, light rail, metro, railway;
  - bus, BRT;
  - cycling, walking.

  Explicit, configurable compatibility matrices cover:
  - service mode ↔ infrastructure;
  - vehicle ↔ infrastructure;
  - track gauge, electrification, loading gauge;
  - platform dimensions, minimum radius, maximum grade;
  - signalling assumptions.

  Mode-specific structure types (brief §6):
  - street level, ground level, exclusive surface, median;
  - underground, cut and cover, bored tunnel;
  - elevated, bridge, trench, embankment;
  - station segment, portal transition, user-defined.

  Each mode × structure combination has its own constraints and its own speed,
  cost, maintenance, noise, emission, right-of-way and clearance assumptions, plus
  metadata.

  Interchange between modes happens only through stations and walking connections.
- **Dependencies:** wp03 (vehicle profiles).
- **Data model:**
  - `PhysicalTrack.infrastructureClass`.
  - `structure` gets the extended list, keeping mode-specific semantics.
  - `infrastructureProfiles[class][structure]`: sourced values.
  - Compatibility tables in `domain/compatibility.ts`, with user overrides in the project.
- **API:** none.
- **UI:** an infrastructure class picker, structure lists filtered by class, and a compatibility panel.
- **Migration:** schema 3 tracks derive their class from `designMode`, with a default mapping.
- **Tests:**
  - incompatible services cannot be routed, joined or through-routed;
  - rail never uses bus infrastructure and the reverse;
  - matrices are applied in routing and validation.
- **Risks:** combinatorial settings (keep defaults sparse, placeholder-marked).
- **Done when:** routing, validation and stations check compatibility, and the matrices are editable and source-aware.
- **PRs:** P3-02a (classes and compatibility), P3-02b (mode × structure profiles).

## P3-03 Line-and-arc track geometry improvements

- **Objective.** Each arc can be edited by:
  - radius, length, angle, direction;
  - start and end tangent;
  - lock state.

  Constraint choices:
  - fixed radius, length or angle;
  - fixed start or end point;
  - fixed start or end tangent;
  - preserve neighbouring geometry.

  Edits keep connectivity and tangency where possible. There is a live preview
  showing radius, length, angle and the speed implication. No silent disconnection.

  Also: double-track pairs move together, and a snapping preview appears while
  drawing.
- **Dependencies:** P3-02 (profile per class), wp03 (speed by vehicle).
- **Data model:** per-PI `lock` and constraint fields; arc parameters stay derived from PI + radius.
- **API:** none.
- **UI:**
  - an arc list in the track inspector with numeric inputs (keyboard path);
  - on-map arc handles;
  - a constraint chooser when several solutions exist.
- **Migration:** additive.
- **Tests:**
  - every constraint combination keeps the tangent and the connection, or reports why not;
  - all calculations are in the projected frame;
  - pair moves keep the spacing.
- **Risks:** over-constrained cases; UX complexity.
- **Done when:** every arc parameter is editable by keyboard and on the map, with a preview and validation.
- **PR:** P3-03.

## P3-04 Junctions, mergers, crossings and turnouts

- **Objective.**
  - Typed connections:
    - turnouts: left, right, curved;
    - crossovers, scissors crossovers;
    - diamond crossings;
    - single and double slips.
  - Ports, movements, facing and trailing ends, main and diverging route,
    diverging radius, level, metadata and validation status
    ([TURNOUTS_AND_CROSSINGS.md](TURNOUTS_AND_CROSSINGS.md)).
  - Automatic mergers (brief §9):
    - **Endpoint to interior:** split, junction node, and directional curves for
      each valid direction. A bidirectional track gets both curves; a one-way track
      gets only the curve with traffic.
    - **Endpoint to endpoint:** a smooth connecting arc when needed, and no extra
      geometry when the ends are already tangent.
    - **Grade-separated or incompatible crossings:** no connection.
  - A preview shows the movements, radii and warnings with accept, modify and
    cancel. If no valid connection exists, the original geometry is kept and the
    reason is shown.
- **Dependencies:** P3-02, P3-03.
- **Data model:** `trackNetwork.connections[]`: `{id, nodeId, kind, ports, movements, main, diverging, radiusM, level, metadata, status}`. Movements stay derived from connections where one exists.
- **API:** none.
- **UI:** a merger preview dialog and a connection inspector.
- **Migration:** nodes with three or more ends stay "unspecified" until typed.
- **Tests:**
  - each case A, B and C;
  - direction rules;
  - radius validation;
  - the preview cancel path;
  - diamonds permit no turning movement.
- **Risks:** geometric edge cases; uncited turnout geometry (placeholders only).
- **Done when:** every kind can be created, previewed, validated and routed through.
- **PRs:** P3-04a (connection objects), P3-04b (automatic mergers with preview).

## P3-05 Service creation from ordered stations

- **Objective.** A wizard:
  1. mode;
  2. name and colour;
  3. stations in order;
  4. computed path;
  5. preview, choosing between alternatives when the path is ambiguous;
  6. confirm;
  7. frequency, fleet, stopping pattern and hours.

  Supports different paths per direction, loops, branches, express patterns and
  short workings.

  When no path exists:
  - the disconnected pair is named and highlighted;
  - an "open infrastructure editor" action is offered;
  - no straight-line service is ever created.

  Bus/BRT use the same wizard with street routing.
- **Dependencies:** P3-02, P3-04, wp03.
- **Data model:**
  - `servicePatterns[]` gains a stop list, a path per direction, and a kind
    (all-stops, express, short working);
  - `alternatives` is preview-only.
- **API:** routing alternatives for bus (Valhalla `alternates`).
- **UI:** the wizard with a keyboard path, the preview layer and a gap highlight.
- **Migration:** existing services become one all-stops pattern.
- **Tests:** ambiguity resolution, gap detection, branches, loops, express patterns, compatibility filtering.
- **Risks:** performance of k-shortest paths (bounded k).
- **Done when:** the e2e test creates rail and bus services with the wizard, and the gap case is handled.
- **PR:** P3-05.

## P3-06 Geospatial validation

- **Objective.** PostGIS checks in a projected CRS:
  - against buildings, water, railways, roads, protected areas, land use, barriers;
  - against existing tunnels, bridges and stations;
  - steep terrain;
  - portal placement;
  - station footprint and platform conflicts;
  - unconnected entrances.

  Elevation comes from a real provider, giving:
  - segment, average and maximum grade;
  - the elevation profile;
  - gain and loss;
  - portal grade transitions and approximate structure transitions.

  Sourced defaults with context cover grade, radius, stop and station spacing, and
  platform length and width.
- **Dependencies:** P3-02, P3-09 (platforms, entrances); an `ElevationProvider` (DEM/COG upload or a configured API).
- **Data model:** findings carry provenance; `profiles[mode][vehicle]` holds sourced ranges.
- **API:** `POST /api/v1/validate/geospatial` (geometry and checks, with findings and provenance); `GET /api/v1/elevation/profile`.
- **UI:** an elevation profile chart (with a data table); findings on the map (wp02 markers).
- **Migration:** none.
- **Tests:** PostGIS integration tests in CI (service container); grade maths; never computed in degrees.
- **Risks:** data volume; licences; OSM incompleteness (findings say a missing tag does not mean absence).
- **Done when:** checks run for real places with provenance, and offline mode reports a capability state.
- **PRs:** P3-06a (PostGIS checks), P3-06b (elevation and grade).

## P3-07 Mode-specific settings and assumptions

- **Objective.** One settings model for every mode-dependent default:
  - speeds, dwell, layover;
  - spacing, platform sizes;
  - separation, costs, emissions.

  Each carries status, source, range and override. This extends
  `trackParameters.ts` into `domain/assumptions/`.
- **Dependencies:** P3-02.
- **Data model:** `assumptionSets` per project, versioned; values are `SourcedValue` ranges.
- **API:** optional export and import.
- **UI:** a settings page per mode with a "show sources" view.
- **Migration:** current parameters map into the default set.
- **Tests:** overrides are applied everywhere they are used, and placeholder labels appear.
- **Risks:** scope creep.
- **Done when:** no hard-coded mode figure remains outside the sets.
- **PR:** P3-07.

## P3-08 Bus, BRT, walking and cycling routing

- **Objective.**
  - Live route preview while drawing, with distinct patterns:
    - solid: confirmed;
    - dashed: candidate;
    - dotted: manual;
    - warning pattern: invalid or unrouted, restricted, direction conflict.
  - Profiles:
    - bus, BRT;
    - walking, wheelchair-accessible walking;
    - cycling, cargo cycling.
  - Cycling preferences:
    - prefer protected infrastructure or cycleways;
    - avoid high-speed roads or stairs;
    - minimise elevation;
    - fastest, quietest or shortest.
  - Walking accounts for crossings, stairs, barriers, bridges, tunnels and entrances.
  - Bus lanes and BRT corridors as infrastructure (P3-02); turn restrictions.
  - A pluggable routing-provider interface.
  - The "No suitable edges" diagnosis: search radius and extract coverage.
- **Dependencies:** P3-02.
- **Data model:** `routed.profile` and `preferences`; leg status adds `candidate`, `restricted` and `direction_conflict`.
- **API:** `/api/v1/routing/route` with a profile and costing options; provider registry.
- **UI:** a profile and preference picker and the preview layer.
- **Migration:** existing legs keep their statuses.
- **Tests:** mocked provider for each profile, preview cancellation, patterns not distinguished by colour alone.
- **Risks:** Valhalla tile coverage; wheelchair routing data quality.
- **Done when:** each profile routes with a mocked provider in CI and with Valhalla when configured.
- **PRs:** P3-08a (preview and provider interface), P3-08b (profiles and preferences).

## P3-09 Stations, stops, platforms, entrances and portals

- **Objective.**
  - Layouts:
    - one or two side platforms, island platform, several islands;
    - single-track platform, terminal platform;
    - bus curb stop, bus bay, BRT median platform;
    - custom.
  - Platforms reference the tracks or lanes they serve and are drawn on the map.
  - Each station or stop has length, width, height or depth, capacity, platform
    count, accessibility features and metadata.
  - Editable entrances, platform edges, portals, walking connections, vertical
    circulation and interchange corridors.
  - Validation:
    - **errors:** platform shorter than the consist; incompatible mode;
    - **warnings:** width below the recommended value; no entrance;
    - **error or warning by severity:** platform connectivity missing.
  - Station symbols (brief §15), each with a verified, imported, assumed or unknown
    status.
  - Moving or deleting tracks updates or invalidates the platforms on them.
- **Dependencies:** wp05 (rules), P3-02, wp03.
- **Data model:** `platforms[]` (existing schema extended with geometry, served tracks or lanes, length, width, edges); `entrances[]`, `portals[]`, `connections[]` (walking, vertical); `facilities[]` (symbol, status, source).
- **API:** OSM lookup for nearby facilities and entrances (suggestions only).
- **UI:** a layout picker, platform drawing, symbol editor, and a suggestions list with confirm and reject.
- **Migration:** additive.
- **Tests:** each layout's geometry, track edits invalidating platforms, validation severities, confirming and rejecting suggestions.
- **Risks:** geometry complexity of island and multi-platform layouts.
- **Done when:** platforms are visible and validated, and symbols show on the map, in inspectors, in the schematic, in reports and in text.
- **PRs:** P3-09a (platforms and layouts), P3-09b (entrances, portals, connections), P3-09c (facility symbols).

## P3-10 Multimodal interchange discovery

- **Objective.** Suggest nearby mobility features:
  - other modes, existing stations, bus stops;
  - airports;
  - accessibility features, entrances;
  - bicycle facilities.

  A nearby station is never treated as a connected interchange. An interchange is
  verified only with a confirmed walking or vertical transfer connection.
- **Dependencies:** P3-09.
- **Data model:** `interchanges[]` gains connections, a walking time source and a status.
- **API:** `GET /api/v1/osm/mobility-near`.
- **UI:** an interchange panel with suggestions and a confirmation flow.
- **Tests:** suggestions are never auto-confirmed; verified status needs a connection.
- **Risks:** OSM data quality.
- **Done when:** interchange availability shown anywhere is backed by a confirmed connection.
- **PR:** P3-10.

## P3-11 Schematic-map editor

- **Objective.**
  - Bus and BRT on the schematic, with mode styles, filters and layer order. No
    implied shared infrastructure.
  - An editable workspace:
    - select and multi-select, zoom and fit, pan;
    - move station, move or rotate label;
    - edit line, move segment, add or remove bend;
    - colour, order;
    - undo and redo, reset layout;
    - lock, hide, grid and snap.
  - Label placement heuristics with manual correction.
  - Manual edits are preserved across regeneration, and affected elements are
    flagged for review.
  - A linear accessible network view (brief §22) replaces the text paragraph.
- **Dependencies:** P3-09c (symbols), wp01 (direction text).
- **Data model:** `schematicLayout`, with per-element overrides (position, label offset and angle, bends, lock, hidden) and a version stamp for change detection.
- **UI:** a schematic toolbar with keyboard alternatives for each tool, and the linear view.
- **Migration:** existing `schematicOffsets` become overrides.
- **Tests:**
  - layout determinism;
  - overrides preserved and flagged;
  - label overlap heuristics;
  - linear view content: order, terminals, interchanges, symbols with text.
- **Risks:** layout quality.
- **Done when:** the schematic is editable by mouse and keyboard and its edits persist.
- **PRs:** P3-11a (modes and linear view), P3-11b (editor tools), P3-11c (labels).

## P3-12 Validation interface

- **Objective.** Builds on wp02 (categories, filter, sort, links, markers):
  - a project-wide validation workspace;
  - grouping by object and mode;
  - export of findings;
  - "show only blocking for export".
- **Dependencies:** wp02.
- **UI:** a validation view tab.
- **Tests:** filters, sorting, export.
- **Done when:** every finding is reachable from the panel and the map.
- **PR:** P3-12.

## P3-13 Vehicle operations and collision avoidance

- **Objective.** Speed depends on:
  - mode, infrastructure, segment limit;
  - curve radius, grade;
  - junction and turnout route, station approach;
  - the vehicle ahead, an occupied platform or stop;
  - signals, manual restrictions.

  Rail block occupancy:
  - route reservations through turnouts;
  - conflicting junction movements prevented;
  - release after clearing;
  - stop at a safe point.

  Buses:
  - stop bays;
  - queueing without overlap;
  - simplified traffic delay (assumption-based);
  - signal delay with priority.

  Vehicles never overlap logically or visually. Documented as conceptual.
- **Dependencies:** P3-04, wp03, P3-07.
- **Data model:** none persisted (runtime blocks).
- **Tests:**
  - no overlap over long runs;
  - conflicting movements serialised;
  - speed limits applied;
  - determinism.
- **Risks:** deadlocks (detect, report, release by rule); performance.
- **Done when:** property tests show no overlap or deadlock in the sample networks.
- **PRs:** P3-13a (speed model), P3-13b (block and route reservation), P3-13c (bus queues).

## P3-14 Capacity, fleet and service simulation

- **Objective.**
  - Fleet per line: count, type, consist, frequency, hours, layover, turnaround,
    spare ratio, peak and off-peak, initial positions.
  - Reflected in capacity, frequency, spacing, the simulation, the dashboard, the
    inspector and reports.
  - Conflicts flagged:
    - fleet too small;
    - more departures than vehicles;
    - consist too long for a platform;
    - incompatible vehicle;
    - capacity below peak load.
  - Mode-appropriate vehicle symbols.
- **Dependencies:** wp03, P3-13.
- **Tests:** fleet maths and validation, the simulation respecting fleet limits.
- **Done when:** fleet settings change the simulation and the figures consistently.
- **PR:** P3-14 (wp03 delivers profiles and basic fleet).

## P3-15 Dashboard calculations and placeholder estimates

- **Objective.** Dashboard figures from P3-07 sets and P3-14:
  - route-km by mode and structure;
  - fleet, capacity;
  - cost and emission ranges, labelled placeholder or sourced.

  Real places show "input required" until values are entered.
- **Dependencies:** P3-07, P3-14.
- **Tests:** formulas, labels, no synthetic figures for real places.
- **Done when:** every figure shows its inputs and status.
- **PR:** P3-15.

## P3-16 Internationalisation and right-to-left support

- **Objective.** All strings in `i18n/`, with a second language and an RTL
  pseudo-locale for testing. Logical CSS is audited, and number, unit and date
  formatting is locale-aware.
- **Tests:** missing-key check in CI, RTL snapshot e2e.
- **Done when:** no hard-coded UI strings remain.
- **PR:** P3-16.

## P3-17 Responsive editor UI

- **Objective.**
  - Collapsible side panels; on-map toolbar; command palette (Ctrl+K).
  - Drawers below ~1024 px; dark mode; a shortcut help dialog.
  - Separate mode editor workflows (brief §7) sharing components: bus/BRT, tram,
    light rail and railway, metro, cycling, walking.
    - Each has its own tools, defaults and validation.
    - The bus editor has no rail join controls.
- **Dependencies:** P3-02, P3-08.
- **Tests:** axe checks in e2e, mobile-viewport e2e, keyboard paths.
- **Done when:** the editor works from 360 px to desktop with keyboard paths.
- **PRs:** P3-17a (layout and toolbar), P3-17b (mode editors).

## P3-18 Data migration

- **Objective.**
  - Decide schema 4 policy with the owner (migrate once projects are published).
  - Implement versioned migrations with backup and warnings when needed.
  - GeoJSON export of tracks, nodes, platforms and regions.
  - Bounded loading of large OSM networks, with progress and cancellation.
- **Tests:** migration fixtures, round trips.
- **Done when:** every schema change has a tested migration or a documented decision.
- **PR:** P3-18.

## P3-19 Automated test coverage

- **Objective.**
  - Coverage thresholds in CI for the pure modules.
  - axe accessibility checks.
  - PostGIS integration tests.
  - Property tests for geometry and simulation.
  - Visual regression for direction arrows and markers.
- **PR:** P3-19, with tests also added in every PR.

## P3-20 Documentation and release preparation

- **Objective.**
  - User guide per mode editor.
  - Methodology updates, CHANGELOG, licence reports, self-hosting.
  - Release notes for v0.3.0.
- **PR:** P3-20.

---

## Phase 1/2 gap PRs before Phase 3

| PR | Brief section | Content |
| --- | --- | --- |
| wp01 | §17 | Direction arrows: no overlap for paired, both-way and one-way tracks; zoom-aware spacing; kept clear of stations; direction in accessible text; regression tests (one-way, bidirectional, paired, loop, reversed, shared) |
| wp02 | §23, §24 | Errors / Warnings / Recommendations / Information with definitions, icons, help, counts; filter and sort; links and zoom; markers on the map with distinct shapes, clustering, per-category visibility, two-way highlight |
| wp03 | §16, §18 (part) | Vehicle types limited to the line's mode; profiles with dimensions, performance, compatibility; custom profiles; fleet count with a "fleet too small" check |
| wp04 | §12 | Manual signals: add, move, delete; type; controlled modes; priority; delay; metadata; discovered signals keep source, ID, date, confidence and confirmation status |
| wp05 | §14 (core) | Rail stations need compatible tracks; orphan stations after track deletion flagged; bus stops need a passing service; orphan warnings when a line is removed; stop types |
