# MobSimGame

MobSimGame is a self-hosted, open-source web application for sketching and
comparing sustainable urban mobility ideas on a real map — tram, light rail,
metro, BRT, bus, commuter rail, cycling and walking corridors — and for
communicating them with transparent, clearly labelled estimates.

The app runs in the browser. The optional backend saves and shares projects,
proxies data providers and renders reports.

> **Not a professional tool.** MobSimGame does not replace transport-demand
> modelling, civil or railway engineering, geotechnical investigation,
> environmental-impact assessment, financial appraisal or official ridership
> forecasts. Every estimate shows its assumptions, status and method.

![Screenshot placeholder: map editor with a tram network](docs/images/screenshot-placeholder.svg)

## Status

**Phase 2 in progress: realistic alignments, real networks, routing.**
Real places show no estimated ridership, cost or emission figures ("input
required"); only fictional projects use the synthetic demonstration assumption
set, labelled as such. See the [roadmap](#roadmap).

### Implemented

- MapLibre map with the OpenStreetMap vector basemap (OpenFreeMap Liberty) by
  default, other OpenFreeMap styles, offline plain and high-contrast styles, 3D
  terrain toggle, buildings and land-use toggles, pan/zoom/rotate/tilt.
- **Real networks:** File › Open real network loads today's tram, metro or bus network
  of Berlin, Paris, London, New York City, Los Angeles or Bogotá live from
  OpenStreetMap (real line and station names; Bogotá Metro Line 1 labelled as under
  construction; TransMilenio as BRT). Imported lines are existing infrastructure.
- **Physical track network** ([docs/TRACK_ARCHITECTURE.md](docs/TRACK_ARCHITECTURE.md)):
  for tram, light rail, metro and rail you draw track, place stations on it, then
  create services that run over it.
  - **Geometry:** track is straight lines and circular arcs with a radius you enter
    per point (the mode's cited value by default), tangent by construction, computed
    in metres in a per-project projection ([docs/TRACK_GEOMETRY.md](docs/TRACK_GEOMETRY.md)).
  - **Double track** is two physical tracks with their own IDs, the spacing between
    them and opposite running directions. Inner and outer radii are checked
    separately.
  - **Connections:** track connects only at nodes, along permitted movements
    (automatic, or set per node). Tracks that only cross on the map, such as a
    bridge or tunnel, are not connected.
  - **Turnouts and crossings:** a node where three or four tracks meet can be a
    turnout, a diamond crossing or a single or double slip; the switch toe, main and
    diverging routes come from the geometry and the permitted movements follow. A
    turnout takes a Deutsche Bahn standard design (radius, diverging speed; cited) or
    own values; a diverging track tighter than the turnout is reported
    ([docs/TURNOUTS_AND_CROSSINGS.md](docs/TURNOUTS_AND_CROSSINGS.md)).
  - **Joining:** ending a new track on another track creates a junction. A drawn
    loop closes tangentially.
  - **Editing:** drag a track end and every connected track follows. Split a track
    at a chainage. Deleting a track that services use asks whether to reroute,
    break or delete those services.
  - **Stations** serve the tracks within 20 m on their level (adjustable).
  - **Services** are lists of stops. Zoomed in, the New service tool shows a (+) on
    every platform track of a station; clicking it makes the service call at that
    platform (or pick a platform per stop in the panel). The route is found between
    the platforms; after the last stop the service returns to the first stop (or, if
    chosen, runs back calling at the same stations on the other track). A missing
    route names the two stops it fails between and why (a one-way track in the way,
    or tracks that are not connected); clicking a picked (+) again removes it
    ([docs/SERVICE_ROUTING.md](docs/SERVICE_ROUTING.md)).
  - Rail lines cannot use "Follows streets" or "Straight segments".
  - Rail stations are objects with their own tracks and side or island
    platforms, placed, moved and rotated freely and connected by drawing track to
    their ends; platforms shorter than the trains are an error.
  - Drawing guides (relative to the last leg, parallel to nearby straight track)
    and curve labels with drag handles and a radius editor on the map.
  - One editor tab per mode (Bus, BRT, Trolleybus, Tram, Light rail, Metro,
    Commuter rail): modes never share infrastructure, stations or lines; other
    modes are shown faded. Tracks record electrification and gauge. Passengers
    change between modes over walking links (distance and walking time).
  - Lines crossing or sharing a street are simulated without collisions: one
    vehicle at a time at a crossing, by an editable mode priority. Junctions,
    turnouts and crossings of tracks are held by one train route at a time, and the
    Dashboard reports one simulated hour of waits for occupied track per line and
    place.
- **Bus, BRT and trolleybus** lines are drawn by clicking their stops in order (at the
  kerb where the vehicle stops; Esc, Enter or right-click finishes). They run one way
  and return to the first stop, routed on streets by a self-hosted Valhalla server
  that approaches each stop on its side ([docs/ROUTING.md](docs/ROUTING.md)).
  Unrouted sections make a line incomplete until routed or marked manual. Cycling and walking corridors use straight
  segments.
- Drawing and point editing with snapping (`@sakuzu/maplibre-gl-draw`). The Table
  view creates track, stations on track, and lines from typed coordinates (no map
  needed).
- **Directions:** each physical track has a running direction. Arrows sit beside the
  track on the running side, so the two directions of a single track, or the two
  tracks of a double track, never overlap. Their spacing follows the zoom and they
  keep clear of stations. The line inspector and the Table view say the direction
  in words. Street-routed and straight lines keep per-segment track sides and can be
  reversed; services on tracks reverse their stop order.
- **Vehicle profiles** per mode (bus, BRT, tram, light rail, metro and train
  categories) with dimensions, performance and compatibility. A line lists only
  vehicles of its mode. You set the consist per line; the number of vehicles in
  service is calculated from the round trip, the headway and the expected peak demand
  with the vehicle capacity (plus spares), and can be set by hand: with fewer vehicles
  the line runs less often. Warnings flag a fleet too small, demand above capacity and
  curves too tight for the vehicle.
- **Project properties** (File menu or sidebar) show every default in one place with
  its source and status: parameters (track spacing, stop merge distance, minimum
  separation, placeholders for unknown vehicle size, …) with default, range and source,
  editable per project; per-mode defaults (cited curve radii, speed, dwell, catchment,
  platform length, and the gauge and electrification new track gets); vehicle profiles;
  crossing priority. Uncited values are marked placeholder.
- **Custom fields** (key/value) on lines, stations, tracks and nodes.
- **Crossovers** before or after each station (map and schematic).
- Stations snapped to lines (click or chainage); shared stations become
  interchanges; drag to move; delete; new stations named automatically from the
  basemap labels around them (station and stop labels first), plus name suggestions
  from nearby features (OSM via backend, synthetic in the demo); neither overwrites
  user-edited names.
- Station access: elevators, escalators, ramp, step-free and tactile paving; elevator,
  escalator and ramp symbols follow the station name on the map.
- Modes: bus, BRT, tram, light rail, metro, elevated rail, commuter rail, cycling,
  pedestrian, custom. One-way / bidirectional, left/right running.
- Per-segment structure (surface, underground, elevated, bridge, bored tunnel,
  cut and cover), right of way and single/double track; split/merge segments.
- Terminations: terminal/siding/turnback/depot ends, ring lines, user-defined loops.
- **Validation** in four labelled categories:
  - ⛔ Error: prevents a valid route, service or export;
  - ⚠ Warning;
  - ◇ Recommendation;
  - ℹ Information.

  Each category shows its meaning, a count and a filter, and findings can be
  sorted by line, station, segment, mode or severity. Every finding links to its
  object and zooms the map to it.

  **Markers on the map** have a distinct shape per category (square, triangle,
  diamond, circle). They are grouped when crowded, can be hidden per category, and
  open their object and finding when clicked. Direction arrows keep clear of them.

  Checks include: terminal or loop rule, geometry, stop spacing, **curve radius against cited minimum and
  recommended values per mode** ([docs/CURVE_RADII.md](docs/CURVE_RADII.md)), grades
  (with elevation data), structure transitions, unrouted bus sections. Other
  thresholds are uncited placeholders and say so.
- **Regions**: draw, cut holes, split, merge, lock, style and label polygons; give
  them a type and user-entered statistics, each with unit, year, source, status and
  confidence; GeoJSON import/export. Area is calculated in the project frame. Find a
  city, district or neighbourhood and import its OpenStreetMap boundary as a
  region; without a boundary the map centres there for drawing by hand.
- Split and join lines; shared-track detection; scenario duplication and comparison.
- Undo/redo, autosave in the browser, project JSON save/load, GeoJSON import/export,
  sampled-coordinate CSV export, share links (backend; saving needs the server login).
- **GTFS export** (File → Export GTFS timetable): a GTFS Schedule feed (zip) with one
  route per line, the stations as stops, one trip pattern per direction repeating at the
  peak headway between service start and end (`frequencies.txt`), times between stops
  from the simulation (running time with acceleration, dwell) and the line shapes.
  Readable by OpenTripPlanner, MATSim, SUMO's GTFS import and other tools.
- **SUMO export** (File → Export for SUMO): the rail track network (plain-XML nodes and
  edges, single track used both ways as a "bidi" pair), platforms as train stops and
  each rail service as a flow with its vehicle type (length, width, acceleration,
  braking, maximum speed), for Eclipse SUMO on your own machine
  (`netconvert … --proj.utm`, then `sumo-gui`; see the bundled README.txt). Street lines
  reach SUMO through the GTFS export and SUMO's OSM and GTFS import.
- **Export all data** (File menu): one JSON file with the project and every calculated
  value per scenario (line lengths, stops and chainages, fleet, simulated round trips,
  acceleration and following rules, ramps, crossings, overhead wire, walking links,
  findings, every parameter with value, status and source) plus metadata (versions,
  units, attribution, disclaimer). Synthetic demonstration figures are included only
  for the fictional demo, labelled.
- **Running time and energy from train physics**: when a vehicle profile gives mass and
  traction power (optionally starting tractive effort and Davis running resistance),
  runs follow the forces on the train (traction, resistance, gradient from levels and
  ramps, curve resistance) with OSRD's envelope method; otherwise constant acceleration
  and braking rates apply. Each line shows traction and braking energy per round trip at
  the wheel, and the energy from the supply when the vehicle gives its efficiencies
  (estimated under the selected assumptions). Methods of OSRD and NeTrainSim, cited in
  [docs/METHODOLOGY.md](docs/METHODOLOGY.md).
- Illustrative vehicle animation (play/pause/reset/speed; reduced-motion mode) over the
  service day: a clock with day and time, jumps to peak, midday or night, peak and
  off-peak headways from each line's service hours and the project's peak periods, and
  no service at night. Zoomed
  in (from zoom 15.5) every vehicle is drawn to scale: length and width from its vehicle
  profile, one outline per car or articulated section, bending through curves and
  keeping its full length at terminals; a waiting or dwelling vehicle has a thick dashed
  outline. Rail and bus lines run a fixed number of vehicles that circulate (they wait
  at the start for their next departure instead of vanishing); trains wait short of
  junctions and occupied platforms. Trams
  and buses stop at red **traffic signals**, found in OpenStreetMap or placed by hand
  (with type, controlled users, priority, delay and attachment), with simulated cycles
  (assumed, editable timings) and optional per-line **transit signal priority**.
  **Disruptions:** close a section and trains turn back at the nearest crossovers or
  share the remaining track. **Single track** used in both directions is occupied by
  one direction at a time (opposing trains wait), and following vehicles keep a
  minimum distance (placeholder values).
- Schematic map with a tab per rail mode (octilinear, interchange and terminal symbols, walking links between
  modes as dashed connectors with walking time, elevator/escalator/ramp symbols):
  select stations by click or Enter, move them by dragging or with the arrow keys, pan
  and zoom (wheel, background drag, + − and Fit), SVG/PNG export of the whole map, and a
  text view listing each line's stations with changes, walks and access.
- Dashboard: for real places, geometry-based figures and "input required" for
  estimates; for fictional projects, low/central/high range charts marked
  DEMONSTRATION DATA.
- Login (`MOBSIM_ADMIN_USERNAME` / `MOBSIM_ADMIN_PASSWORD`, default admin/admin,
  refused in production) for saving and sharing on the server.
- Print-friendly HTML report from the backend; PDF endpoint contract (returns 501).

### Planned (not available yet)

Crossover and scissors-crossover objects and turnout geometry generated from a design
([docs/TURNOUTS_AND_CROSSINGS.md](docs/TURNOUTS_AND_CROSSINGS.md)), moving a
double track as a pair, routing preferences, a pluggable bus routing provider, real
population/traffic/elevation providers, editable assumption sets for real places,
calibrated demand, cost/emissions/fare modules, timetables, user accounts beyond
the single administrator login, server-side PDF. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Important limitations

- Alignments are conceptual sketches; findings are advisory, never "safe" or
  "construction-ready".
- Line lengths use a spherical-earth approximation; track geometry uses a
  per-project transverse Mercator frame (sketch accuracy, no transition curves or
  cant).
- Projects saved before the track network (schema 1 or 2) cannot be opened; the
  format starts again at schema 3 ([docs/PROJECT_MIGRATION.md](docs/PROJECT_MIGRATION.md)).
- Imported rail lines get their own pair of tracks; lines sharing a street in
  OpenStreetMap are not merged onto shared track.
- Phase 1 estimates are exploratory, uncalibrated and use synthetic inputs.
- Synthetic overlays (population, traffic, existing transit) appear only in
  fictional projects, never over real places.
- Example networks are OpenStreetMap as mapped today: one direction per route, merged
  stations, no timetables, structures (tunnels, viaducts) not imported.
- Signal timings and vehicle separations are placeholders until you enter local
  values; the animation has no signalling, interlocking or braking model.
- Missing OSM tags do not mean a feature does not exist.

## Architecture

React + TypeScript + Vite + Tailwind + MapLibre + Zustand + Zod in the browser;
FastAPI + SQLAlchemy/GeoAlchemy2 + Alembic + PostgreSQL/PostGIS on the server;
Docker Compose for deployment. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
decisions: [docs/architecture/](docs/architecture/README.md).

GeoJSON coordinates are always **`[longitude, latitude]`** (WGS84).

## Quick start (Docker Compose)

```sh
cp .env.example .env     # set POSTGRES_PASSWORD and MOBSIM_ADMIN_PASSWORD
docker network create public   # once per host: the stack joins this external network
docker compose up -d --build
docker compose --profile routing up -d   # optional: bus/BRT street routing (docs/ROUTING.md)
open http://localhost:8080
```

Development with hot reload: `docker compose --profile dev up --build`
(app on http://localhost:5173).

## Ports

| Port | Service | What listens | When | Published to the host |
| --- | --- | --- | --- | --- |
| **8080** | `web` | nginx serving the **built** app (`npm run build` inside the image) and proxying `/api/` to `api:8000` | Always (production-like stack) | Yes, as `${MOBSIM_WEB_PORT:-8080}` |
| **5173** | `frontend-dev` (Compose profile `dev`) or `npm run dev` | Vite dev server with hot reload, serving the **source**; proxies `/api` to `MOBSIM_API_PROXY_TARGET` (`http://api:8000` in Compose, `http://localhost:8000` locally) | Development only | Yes, in the `dev` profile |
| 8000 | `api` | FastAPI (uvicorn) | Always | No (internal; nginx and Vite reach it) |
| 8002 | `valhalla` (profile `routing`) | Street routing | Optional | No (internal) |
| 5432 | `db` | PostgreSQL/PostGIS | Always | No (internal) |

Port 8080 does **not** proxy to 5173. They are two independent ways to serve the
same frontend, and both talk to the same API:

- **8080** is the application. It only changes when the image is rebuilt
  (`docker compose up -d --build`).
- **5173** is for editing frontend code. It shows source changes immediately.
  `docker compose --profile dev up` starts it *in addition to* 8080.

Both ports are needed: production uses only 8080, and you never need 5173 unless you
develop the frontend.

## Updating

`git pull` only changes the files on disk. The app on port 8080 is built into the
`web` image, so rebuild after every pull:

```sh
git pull
docker compose up -d --build                      # rebuilds web (8080) and api
docker compose --profile routing up -d --build    # if you use street routing
```

Open tabs notice a new deployment by themselves and offer **Update now**; the project
is saved before the page reloads (details: [docs/CACHING.md](docs/CACHING.md)). The
footer shows whether the server is reachable. To check which build is running, open
**ⓘ Data & licences**: it shows the version and the build time. If the build time is older than your pull, you are looking at an old
image (rebuild), or the browser cached an old page (reload with Ctrl+Shift+R).

## Troubleshooting: features not visible

| Symptom | Cause | Fix |
| --- | --- | --- |
| No "Open real network…" or start card; the old fictional demo appears | Old `web` image or cached page | `docker compose up -d --build`, then reload |
| `docker compose up` says `api` is unhealthy; log shows "the default password is not allowed in production" | `MOBSIM_ENVIRONMENT=production` (the Compose default) with `MOBSIM_ADMIN_PASSWORD=admin` | Set your own `MOBSIM_ADMIN_PASSWORD` in `.env`, or `MOBSIM_ENVIRONMENT=development` on a test machine |
| Bus lines stay straight, dashed and labelled "not routed" | Street routing is not running. Bus lines follow streets only through the self-hosted Valhalla service | `docker compose --profile routing up -d`, set `MOBSIM_VALHALLA_URL=http://valhalla:8002` in `.env`, restart `api` ([docs/ROUTING.md](docs/ROUTING.md)); or mark sections as manual |
| Lines look straight with only two points | A smooth curve needs at least three points to bend | Add points; tram, light rail, metro and rail always use smooth curves |
| "Open real network" fails or times out | The API cannot reach the Overpass API, or the network is very large | Check `docker compose logs api`; try a tram or metro network first (bus networks are the largest) |

## Local development

Requirements: Node.js ≥ 22, Python 3.12, (optionally) Docker for PostGIS.

```sh
# Frontend
cd frontend
npm ci
npm run dev                # http://localhost:5173, proxies /api to :8000

# Backend (SQLite for quick local use)
cd backend
python3.12 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app_factory --factory --reload
```

The frontend works without the backend (search falls back to an offline
coordinate parser; sharing and reports are unavailable).

## Environment variables

- Backend: `MOBSIM_*` — see [.env.example](.env.example) and
  [docs/PROVIDER_CONFIGURATION.md](docs/PROVIDER_CONFIGURATION.md).
- Frontend build: `VITE_API_BASE_URL`, `VITE_EXTRA_BASEMAPS`,
  `VITE_TERRAIN_TILES_URL`, `VITE_ESRI_IMAGERY`, `VITE_SOURCE_URL`, `VITE_LOG_LEVEL` — public values only
  ([frontend/.env.example](frontend/.env.example)).

## Logging

Set the minimum level with `MOBSIM_LOG_LEVEL` (or `LOG_LEVEL`) for the API and
`VITE_LOG_LEVEL` for the browser: `debug` < `info` (alias `log`) < `warning`
(alias `warn`) < `error`. Production output is structured JSON; development output
is readable and timestamped. Debug logging is always off in production, and
sensitive values are redacted. Details: [docs/LOGGING.md](docs/LOGGING.md).

## Database initialisation

With Compose, `alembic upgrade head` runs when the API starts. Manually:
`MOBSIM_DATABASE_URL=postgresql+psycopg://… alembic upgrade head` in `backend/`.

## Testing

```sh
cd frontend
npm run format:check && npm run lint && npm run typecheck && npm test
npm run test:e2e           # Playwright smoke test against the production build

cd backend
ruff format --check . && ruff check . && mypy app && pytest
MOBSIM_TEST_POSTGIS_URL=postgresql+psycopg://user:pw@localhost:5432/db pytest tests/test_postgis.py
```

## Production build

`cd frontend && npm run build && npm run check:secrets` (output in `frontend/dist`),
or `docker compose build`.

## Backup and restore

See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md#backup-and-restore).

## Providers, API keys and data provenance

- Provider setup and terms: [docs/PROVIDER_CONFIGURATION.md](docs/PROVIDER_CONFIGURATION.md)
- API keys live only in backend environment variables; nothing secret is ever
  placed in the browser bundle (enforced in CI).
- Provenance rules: [docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md)
- Formulas: [docs/METHODOLOGY.md](docs/METHODOLOGY.md)
- Phase 3 plan: [docs/PHASE_3_PLAN.md](docs/PHASE_3_PLAN.md)
- Rework plan from the owner's feedback: [docs/REWORK_PLAN.md](docs/REWORK_PLAN.md)
- Track network: [review](docs/TRACK_NETWORK_REVIEW.md), [architecture](docs/TRACK_ARCHITECTURE.md),
  [geometry](docs/TRACK_GEOMETRY.md), [turnouts and crossings](docs/TURNOUTS_AND_CROSSINGS.md),
  [service routing](docs/SERVICE_ROUTING.md), [project format](docs/PROJECT_MIGRATION.md),
  [requirement status](docs/PHASE_REQUIREMENTS_STATUS.md)

## Attribution

Map data © OpenStreetMap contributors (ODbL). Basemaps by OpenFreeMap
© OpenMapTiles. Terrain from AWS Terrain Tiles (USGS, NOAA and other sources).
Rendering by MapLibre GL JS. Drawing by `@sakuzu/maplibre-gl-draw`.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licensing

MobSimGame — Copyright (C) 2026 Homlo-Bike — is free software under the
[GNU Affero General Public License v3.0 only](https://www.gnu.org/licenses/agpl-3.0.html)
(`AGPL-3.0-only`, see [LICENSE](LICENSE) and [NOTICE](NOTICE)). This licence matches
the bundled `@sakuzu/maplibre-gl-draw` (AGPL-3.0-only) and is compatible with every
other dependency. If you run a modified version for others over a network, you
must offer them its source; set `VITE_SOURCE_URL` so the app links to it.
Releases up to commit `20cce9e` were MIT-licensed.

Every third-party component, image, dataset and service is listed with its
licence link and repository in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md);
complete per-package lists are in [docs/licenses/](docs/licenses/). Datasets keep
their own licences. Background: [docs/LICENSING_OPTIONS.md](docs/LICENSING_OPTIONS.md),
[ADR 0003](docs/architecture/0003-drawing-library-licensing.md).

## Contributing and security

- [CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security issues: please report privately, see [SECURITY.md](SECURITY.md).

## Roadmap

1. Phase 1 — map and network editor (v0.1.0)
2. **Phase 2 (in progress)** — street-following bus lines, physical track network
   with lines and arcs, double track as two tracks, stations and services on tracks,
   single-track occupancy, crossovers and disruptions, traffic signals, real-city
   networks, minimal UI, geospatial validation ([plan](docs/PHASE_2_PLAN.md),
   [track network](docs/IMPLEMENTATION_PLAN.md)); next: crossover objects,
   connected double-track editing, routing preferences
3. Phase 3 — data-provider integrations (population, transit, traffic, OSM extracts)
4. Phase 4 — analysis and estimates (editable assumptions, costs, emissions, fares)
5. Phase 5 — simulation and publishing (richer simulation, schematic optimisation, PDF, accounts)
