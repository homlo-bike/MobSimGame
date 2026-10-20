# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

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
