# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **GTFS export** (File menu): a GTFS Schedule feed with routes, stops, trips, stop
  times from the simulation, peak-headway frequencies, calendar and shapes.

- **Stacked stations on different levels**: new rail stations get a level
  (underground −2/−1, street, elevated +1/+2; "Level of new stations"), and the
  station inspector moves a station object to another level with its tracks.
  Stations on different levels can stand on top of each other; the map lists them in
  one label, top level first.
- **Underground vehicles are drawn distinctly**: fainter with depth and with a dotted
  outline; the change follows the height along ramps, so vehicles fade gradually when
  entering or leaving a tunnel.

- **Ramps between levels** (R6). A track whose ends are on different levels is a
  ramp; the track inspector sets the level of each end and shows the gradient, the
  maximum and the length needed. Too steep ramps and platforms on ramps are reported
  (cited EBO limits for railways, placeholders otherwise); the map labels ramps and
  marks portals. Level heights are system defaults (owner decision): 10 m per
  underground level and 7 m per elevated level, editable per project. The street is taken
  as flat for now; terrain follows.
- **Following the vehicle ahead** (R13 part 2). Buses, BRT, trolleybuses, trams and
  light rail keep the Intelligent Driver Model's steady-state gap (2.5 m + speed ×
  1.0 s, SUMO defaults, plus the length of the vehicle ahead) instead of a fixed
  placeholder distance; both values are editable in Project properties. Metro and
  commuter rail keep the signalled minimum distance. The placeholder parameters for
  bus and tram separation are removed.

- **Acceleration and braking in the simulation** (R13 part 1). Vehicles accelerate
  after every stop and brake before stations, red signals and occupied sections
  instead of running at constant speed. Rates come from the vehicle profile or,
  where it has none, from the documented SUMO vehicle-class defaults (cited in
  Methodology; SUMO's published model, not its code). Round trips are longer by
  the time lost at each stop.
- **Project properties** (File menu or the sidebar): every default in one dialog with
  its source and status. Tabs: Parameters (formerly "Project settings"), Modes
  (curve radii, speed, dwell, catchment, structure, platform length, following
  distance per mode, and the gauge and electrification new track of a rail mode gets,
  with a button to fill them into existing track without a value), Vehicles (vehicle
  profiles) and Crossing priority. The three sidebar panels are replaced by one entry.

- **Vehicles drawn to scale** in the animation when zoomed in (from zoom 15.5):
  one outline per unit of the consist, with the vehicle profile's length and width,
  following curves. Waiting and dwelling vehicles have a thick dashed outline. A new
  placeholder parameter gives the width when a vehicle profile has none.
- **Trolleybus overhead wire** follows every trolleybus line (owner decision: not
  drawn separately). It is shown on the map, shared where trolleybus lines use the
  same street, and summarised in the line inspector. A trolleybus line crossing rail
  track with an overhead line on the same level gets a warning; a crossing with
  track whose electrification is not specified gets an information note.

### Changed

- **Stop merge distance is 20 m (was 60 m) and editable** in the renamed
  "Project settings" section (formerly "Track parameters"). A new stop or station
  within this distance of an existing one of the same mode reuses it.
- Trolleybuses keep the bus following distance in the simulation (they used the
  rail value).

- **Bus, BRT and trolleybus lines are drawn by clicking their stops in order.**
  Each click is a stop at the kerb where the vehicle stops; Esc, Enter, a
  right-click or "Finish line" ends the drawing and Backspace removes the last
  stop. The line runs one way and returns to the first stop. One-way lines ask the
  router to approach every stop on its side of the street. Clicks near an existing
  stop of the same mode reuse it. Trolleybus lines are now street-routed too.

- **Every transport mode is kept separate** (owner decision). The editor has one
  tab per mode (Bus, BRT, Trolleybus, Tram, Light rail, Metro, Commuter rail, and
  other modes in a list). The tab decides what the tools create; other modes are
  drawn faded and get no editing handles. Selecting an object switches to its tab;
  an object of another tab is shown read-only with a button to switch. Track joins
  only track of its own mode, services only call at stations of their mode, and a
  line's or track's mode can no longer be changed. Tram and light rail no longer
  share track, and the infrastructure compatibility panel is gone.
- **Trolleybus is its own mode** (street-routed, its own vehicle categories). Its
  overhead-wire network follows with the click-stop bus lines (R4b).

- **Vehicle type** in the line inspector lists only vehicles compatible with the
  line's mode; changing the mode replaces an incompatible vehicle.
- **Validation categories are now Errors, Warnings, Recommendations and
  Information.** "Blocking geometry error" is now "Error". Each category has a
  definition shown as help, a count and a filter. The dashboard's unclear
  "4 ⛔ · 3 ⚠" summary is replaced by labelled categories.
- **Project format schema 3: physical track network.** Track (nodes, tracks,
  double-track groups, permitted movements) is now separate from services. Rail
  lines run over tracks instead of owning a spline. Projects in schema 1 or 2 are
  not migrated (owner decision; the format was unpublished). They are refused with a
  message, and the server accepts only schema 3. See `docs/PROJECT_MIGRATION.md`.
- Rail and tram geometry is **straight lines and circular arcs** with a radius per
  point, computed in a per-project transverse Mercator frame. This replaces
  Catmull–Rom splines. Curve radii are checked exactly on every arc, including the
  inner and outer track of a double track.
- Rail lines no longer offer "Follows streets" or "Straight segments".
- Imported OpenStreetMap rail lines become a double track fitted with lines and arcs,
  with stations on both tracks and a service routed over them.

### Added

- **Walking links between stations** (R4d): modes never share stations, so
  passengers change on foot. Link a station to another one within 2 km (other modes
  are offered first) in the station inspector; the link shows the straight-line
  distance and a walking time calculated at the walking-speed parameter (4.5 km/h,
  placeholder) or a time you enter. Links are drawn dotted on the map.

- **Crossings and merges in the simulation** (R4c): wherever two lines cross on
  the same level (any modes, also two lines of the same mode on unconnected track
  or streets), only one vehicle at a time uses the crossing. The lower mode in the
  priority order waits until it is clear; within a mode, the first to arrive goes
  first. Bus, BRT and trolleybus lines on the same street keep the following
  distance in the same direction and wait where they merge. Crossings are marked on
  the map (click one to see who has priority) and the order is editable under
  *Crossing priority*. Two tracks crossing on the same level are now reported as
  information (a level crossing), not as a warning.

- **Rail stations are objects with tracks and platforms** (R3): choose the number
  of side and island platforms (at least one), click to place the station, drag it
  to move, drag the handle at either end to rotate (it lines up with nearby
  straight track). The station's tracks bend back to the normal track spacing at
  both ends, so track drawn to the station joins it; a track drawn into a station
  joins its end. Platforms are drawn to scale. Platform length, side and island
  platform widths are project parameters (placeholders). Errors when platforms are
  shorter than the trains or when a service of another mode calls at the station.
  "Add station" no longer needs existing track for rail modes.

- **Drawing guides for track**: while drawing, the next point snaps to rays from the
  last point: straight on, 45°, 90° and 135° to the last leg (or continuing the
  track end the drawing starts from), and parallel or perpendicular to straight track
  within 100 m of the cursor. The guide is shown with its name. The built-in
  north-based guides are off. Guides can be switched off in the track options.
- **Curve radius on the map**: every curve of the selected track is labelled
  ("C1 · R 250 m"). Drag the curve's handle along the corner to change the radius
  (towards the corner is tighter), or click the label for a radius editor with a
  slider and a number field. The side panel uses the same names (Curve C1 …). On
  double track, both tracks change together and stay concentric.

### Fixed

- **Track drawing:**
  - new track joins existing track tangentially, so there is no kink at an open
    end or at a junction in the middle of a track;
  - a track closes into a loop only after you confirm it in a dialog;
  - the drawing tool stays on after each track (Esc stops);
  - dragging an end onto another track end or onto a track connects them, again
    without a kink;
  - a loop or curve too tight for double track now says so and how big it must be;
  - clicking an end without dragging no longer makes it jump to a nearby point or
    close a loop.
- **Rail services:**
  - an unrouted service is no longer drawn as straight lines that look like trains
    jumping between tracks; red dashed "not routed" links show the gaps;
  - a two-way service without a track path back is now an error.

### Added

- **Infrastructure classes and compatibility** (P3-02a):
  - every track has a primary class (tram, light rail, metro, railway), set in the
    track inspector or derived from its design rules;
  - tracks also record electrification and gauge;
  - rail services are routed only over track their mode may use. By default each
    mode uses its own class, and tram and light rail may use each other's track;
    the matrix is a modelling convention, not a cited rule, and is editable per
    project in *Infrastructure compatibility*;
  - errors are reported for a service on track its mode may not use, and for a
    vehicle whose gauge or electrification does not match the track; unknown
    values never conflict;
  - vehicle profiles have a gauge;
  - lines of different modes cannot be joined.

  Loading gauge, platform dimensions, signalling and mode × structure profiles
  follow in P3-02b.

- **Find a city, district or neighbourhood** in the Regions panel (P3-01b). The
  results show the place type and the places around it. *Go to* zooms to the place.
  *Create region from boundary* imports its OpenStreetMap boundary as a region typed
  from the place (neighbourhood, district or municipality), with source, link,
  retrieval date and status "imported", and with no statistics. If the place
  already has a region from the same OSM object, that region is selected and left
  unchanged. When there is no boundary, or the lookup fails, the map is centred on
  the place and *Draw the region by hand* is offered; a boundary is never
  generated. Backend: `places=true` on `/api/v1/geocode` and the new
  `/api/v1/geocode/boundary/{type}/{id}`, both cached.

- **Regions** (Phase 3, P3-01a): draw polygons on the map or type their corners,
  cut holes, split with a line, merge, lock, show/hide, and style them (fill,
  outline, opacity, label). Each region has a name and a type (neighbourhood,
  district, municipality, commercial/industrial/residential area, campus, hospital
  district, development area, transit-oriented development area, user-defined).
  Statistics such as population, income or car ownership are entered by the user,
  each with unit, currency, price year, dataset year, source, URL, date,
  resolution, status and confidence. Custom fields and notes are kept. Area is
  calculated in the projected project frame and never entered. Regions are
  imported and exported as GeoJSON. A split does not divide statistics (numeric
  values are dropped from the parts, with a note); a merge does not add them up
  (the first region's values are kept, with a note to check them).
  Nothing is inferred about individuals.

- **Station and stop rules**:
  - a station that track services call at but that is on no track (for example
    after its track was deleted) is an error, so it never looks valid;
  - the deletion dialog lists stations that would lose all their tracks;
  - a stop without any line is a warning that says what to do;
  - deleting a line reports the stops it leaves without service;
  - bus stops have a type (roadside, in-lane, bay, island, BRT platform);
  - the inspector shows whether a station is a rail station, a bus stop, both, or
    unserved;
  - on the map, bus stops are smaller and unserved stops have a grey ring.
- **Traffic signals by hand**:
  - place signals on the map or at typed coordinates, drag to move, delete;
  - type: intersection, pedestrian, tram, BRT or railway crossing, station
    approach, user-defined;
  - controlled users, transit priority behaviour, an optional fixed approximate
    delay, attachment to one line or track, label and custom fields.
  - Discovered OpenStreetMap signals keep their source ID, retrieval date and
    confidence, and stay "imported" until confirmed (one by one or all).
  - The animation applies a signal only to its attached line or track, and not to
    vehicles its controls exclude.
- **Vehicle profiles** (sidebar):
  - fields: category per mode (for example double-decker bus, low-floor tram,
    automated metro, EMU), capacity, seats, length, width, units per consist,
    doors, maximum speed, acceleration, braking, minimum curve radius, maximum
    grade, energy, compatible platforms, compatible modes, source and notes;
  - add custom profiles, edit them, and delete unused ones;
  - unknown values stay empty, never guessed.
- **Fleet per line**:
  - vehicles assigned and units per consist;
  - the inspector shows the vehicles needed at peak and off-peak, the consist
    length and the peak capacity (placeholder speeds).
- Validation errors for:
  - a fleet too small for the peak headway;
  - an incompatible or missing vehicle;
  - curves tighter than the vehicle's minimum radius.
- Findings can be sorted by severity, line, station, segment or mode. Each finding
  links to its object: it is selected, the map zooms to it and the finding is
  highlighted.
- **Validation markers on the map**:
  - one shape per category (square, triangle, diamond, circle) in addition to
    colour;
  - clustered when they overlap (the cluster ring shows the worst category);
  - click a marker to select its object and highlight its finding, or a cluster to
    zoom in;
  - categories can be hidden under Map layers (information is hidden by default).
- **Draw track** for track modes:
  - single or double track, with radius and structure options;
  - ends attach to nodes or open ends, and an end on a track creates a junction;
  - loops close tangentially;
  - dragging a track end moves every connected track;
  - split a track at a chainage.
- **Track and node inspectors**:
  - running direction, structure, level, right of way, design rules, speed limit
    and the radius per point;
  - permitted movements per node (automatic or manual);
  - buffer stops;
  - custom key/value fields.
- **Stations on tracks**:
  - placing a station serves every track within 20 m on its level (adjustable);
  - tracks can be added or removed in the station inspector;
  - moving a station keeps it on its tracks.
- **New service** tool: pick stations in calling order on the map, from a list or in
  the Table view. The service is routed over the tracks, and on double track the
  way back uses the other track. Services are routed again after track, station or
  movement edits.
- **Deleting a used track** asks: cancel, reroute the services, leave them unrouted,
  or delete them.
- **Track occupancy in the simulation**:
  - single track used in both directions is reserved by one direction at a time,
    and opposing trains wait;
  - following vehicles keep a minimum distance (placeholder values);
  - the result stays deterministic.
- **Track validation**:
  - radius below the cited minimum or recommended value;
  - radius reduced to fit its legs;
  - kinks inside tracks and at connections;
  - open track ends;
  - unspecified junction types;
  - same-level crossings without a connection;
  - single track used both ways.
- **Track parameters** panel: track spacing (EBO § 10 for heavy rail; tram value a
  placeholder), station search distance, snap distance and minimum separations, each
  with default, range, status and source.
- Table view: create track, add a station on track, and see a track table, all
  without the map.
- Custom key/value fields on lines, stations, tracks and nodes (projects store them too; no project editor yet).

### Fixed

- **Direction arrows** sat on top of each other:
  - the two directions of a single track used both ways;
  - the two tracks of a double track at normal zoom levels;
  - a one-way service on double track, which looked like two opposite arrows.

  Now:
  - each arrow sits beside its own track, on the running side, so opposite
    directions never overlap;
  - spacing follows the zoom (about 120 px);
  - arrows keep clear of stations;
  - lines' direction is described in words in the line inspector and the Table
    view (for example "One-way from A to B");
  - services on tracks can reverse their stop order.

  Regression tests cover one-way, bidirectional, paired tracks, loops, reversed
  geometry and shared track.
- Simulation: the return trip of a two-ended line started its timing before the
  terminal layover had passed, so traffic-signal waits on the way back were computed
  for the wrong time. The way back now starts after the layover.

- **Station auto-naming** could stay on "Looking up nearby features…" and then offer
  latitude/longitude: the browser gave up after 20 s while the server's map lookup
  could take minutes with retries. The lookup is now bounded (server: 15 s query, no
  retry; browser: 25 s), cancellable, cached per place, and always ends with
  suggestions, "nothing named nearby" or a clear error. Candidates follow the order
  transport station, landmark, district, facility, major-road intersection (computed
  from street geometry), major street, street, local place name; a coordinate name
  is offered only as a marked last resort. Names prefer the app language, and names
  already used in the project show the qualified name they will get.
- "Start a network" stayed open after "Draw a line"; it now closes, drawing starts and
  focus moves to the map; it can also be closed, and returns after Escape.
- nginx (port 8080) waited only 60 s for the API, so large example networks (bus
  networks) failed with a gateway timeout; it now waits up to 300 s, and the API no
  longer retries a timed-out network query (which exceeded the browser's limit).
- `index.html` is now revalidated by browsers (`Cache-Control: no-cache`), so a
  rebuilt image is picked up without a stale page.

### Added

- **Connection status** (connected / offline / server unreachable / server problem /
  updating) from `/api/health`, checked at start, when back online, when the tab is
  shown again and every 30 s; never "connected" without a healthy answer.
- **Update detection**: builds publish `/version.json`; open tabs offer an update,
  check for unsaved work first, save the project, and guard against reload loops.
  Stale service workers and Cache Storage on the origin are removed
  (`docs/CACHING.md`).
- **Notification centre** (🔔): every toast is recorded with severity, time and the
  related object; repeats are grouped; filter, mark read, dismiss, clear all;
  selecting one focuses and selects the line or station. Session-only.
- **Active project required for drawing**: drawing without one opens a create/select
  dialog and resumes drawing afterwards. Projects are kept in a browser **project
  library** (File › Switch project); the single stored project of earlier versions
  migrates automatically.
- Bus sections that do not follow streets are drawn dashed and labelled
  ("not routed" / "manual"); the Street route panel says when routing is not
  available on the server.
- Version and build time under Data & licences, to recognise an old build.
- README: port overview, updating, and troubleshooting.
- **Smooth track alignments:** tram, light rail, metro and rail lines are centripetal
  Catmull–Rom curves through the points you place (schema v2 `alignment`).
- **Cited curve radii** per mode (TCRP 155; Mumbai Metro Line 12 DPR; RSSB GCRT5021;
  EBO §6): below the minimum blocks, below the recommended value warns
  (`docs/CURVE_RADII.md`).
- **Street routing for bus and BRT** through waypoints with a self-hosted Valhalla
  server (optional Compose profile `routing`, `POST /api/v1/routing/route`); unrouted
  sections block completion until routed or marked manual; separate return paths
  where one-way streets differ (`docs/ROUTING.md`).
- **Directional tracks:** double-track segments drawn as two parallel tracks with
  direction arrows; swap track sides per segment; reverse a line.
- **Crossovers** before/after stations (map, schematic, text alternative) and a
  **disruption simulation** (close a section: turn back at crossovers or single-track
  working).
- **Traffic signals** from OpenStreetMap with simulated cycles (placeholder timings,
  editable) and per-line **transit signal priority**.
- **Real-city networks** (Berlin, Paris, London, New York City, Los Angeles, Bogotá;
  tram, metro, bus where they exist) loaded live from OpenStreetMap
  (`/api/v1/examples`), cached for a week; Bogotá Metro Line 1 labelled under
  construction.
- **Login for saving and sharing** (`MOBSIM_ADMIN_USERNAME`, `MOBSIM_ADMIN_PASSWORD`,
  default admin/admin; production refuses the default password).
- Start card for empty projects; "input required" dashboard for real places.
- Phase 2 plan (`docs/PHASE_2_PLAN.md`).

### Changed

- **Schema v2.** v1 projects migrate on open: track lines become curves through their
  old vertices; bus/BRT lines become street-routed lines with unrouted sections.
- The OpenStreetMap vector map (OpenFreeMap Liberty) is the default background.
- Findings on unedited lines imported from OpenStreetMap are informational.
- The simulation builds each trip in time order (needed for signal waits); still a
  pure function of simulated time.
- File menu: "Save to server and share…", "Sign in…/Sign out", "Open real network…".
- Minimal interface: single-row header with an inline project name, a segmented view
  switcher, icon undo/redo and one **File** menu holding project, import/export and
  share actions; toast messages; segmented tool switcher; collapsible Scenario,
  Map layers and Display panels; slimmer notices and footer.

### Removed

- The fictional demo project is no longer offered in the app (kept as a test fixture).

### Fixed

- CI creates the external `public` Docker network now declared in `docker-compose.yml`;
  setup documented in README and SELF_HOSTING.


### Added

- Centralised logging (`docs/LOGGING.md`). Backend: `app/logging_config.py` configured
  from `MOBSIM_LOG_LEVEL` (fallback `LOG_LEVEL`) and `MOBSIM_LOG_FORMAT`, JSON lines in
  production and readable text in development, request logging with `X-Request-ID`,
  contextual logs for provider calls, retries, caching and project changes. Frontend:
  `src/util/logger.ts` configured from `VITE_LOG_LEVEL`. Levels debug < info (`log`) <
  warning (`warn`) < error. Debug is always off in production; sensitive values are
  redacted; query strings and user search text are never logged.
- ESLint `no-console` rule for application code.

### Fixed

- The map no longer reloads the basemap style right after start-up (removes a MapLibre
  "Unable to perform style diff" warning).

### Changed

- **Licence: the project is now GNU AGPL-3.0-only** (previously MIT), so that it fits
  the bundled `@sakuzu/maplibre-gl-draw` (AGPL-3.0-only) and all other dependencies
  without conflict. `LICENSE` holds the verbatim GNU text; `NOTICE` holds the copyright
  and licence notice and the licence history. Versions up to `20cce9e` remain MIT.
- `THIRD_PARTY_NOTICES.md` now lists every direct dependency, container image, CI
  action, map style, font, dataset and service with licence link and repository URL,
  plus a licence-compatibility table.
- Generated licence reports in `docs/licenses/` now include licence links and
  repository URLs for every production and development package
  (`npm run licenses`, `backend/scripts/license_report.py`).
- In-app "Data & licences" dialog and the server HTML report state the new licence.

## [0.1.0] — Phase 1 vertical slice

### Added

- Frontend (React, TypeScript, Vite, Tailwind, MapLibre 6.11, maplibre-gl-draw 2.2,
  Zustand, Zod): map editor, line drawing and vertex editing, stations with
  snapping and sharing, modes, direction, per-segment structure/right of
  way/tracks, terminations (ends, ring, loop), inspectors, validation findings,
  split/join, shared-track detection, scenarios, undo/redo, local autosave,
  project JSON, GeoJSON import/export, CSV export, table-based editing,
  illustrative vehicle animation, schematic map PoC with SVG/PNG export,
  demonstration dashboard, data-sources dialog, fictional demo project.
- Provider interfaces with provenance and capability states; mock providers;
  backend clients for Overpass and Nominatim.
- Backend (FastAPI, SQLAlchemy, GeoAlchemy2, Alembic, PostGIS): health, project
  share/load/update/delete with edit tokens and audit log, provider list,
  OSM features, geocoding, transport.rest (opt-in), CAMARA adapter (disabled until
  configured), ArcGIS traffic placeholder (disabled), HTML report, PDF contract (501).
- Security: CSP and security headers, CORS allow-list, body-size and rate limits,
  SSRF guard, settings validation, bundle secret scan.
- Docker Compose (PostGIS, API, nginx web; dev profile), GitHub Actions CI.
- Documentation: architecture, ADRs, methodology, provenance, providers,
  self-hosting, reference feature review, licensing options, third-party notices.
