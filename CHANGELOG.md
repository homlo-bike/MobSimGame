# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

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
