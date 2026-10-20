# CLAUDE.md — instructions for Claude Code sessions in this repository

MobSimGame: browser-first mobility scenario sketch tool. Read
`docs/ARCHITECTURE.md` and `docs/IMPLEMENTATION_PLAN.md` before larger changes.

## Layout

- `frontend/` React + TS + Vite + Tailwind + MapLibre + `@sakuzu/maplibre-gl-draw` + Zustand + Zod
- `backend/` FastAPI + SQLAlchemy/GeoAlchemy2 + Alembic (PostGIS)
- `docs/` architecture, ADRs, methodology, provenance, providers, self-hosting

## Architecture boundaries

- `frontend/src/{domain,geo,validation,analysis,simulation,schematic}` are pure
  TypeScript: no React, MapLibre, DOM or store imports. Put logic here and test it.
- `map/` renders and forwards edits only. The project store is the source of
  truth; the draw library mirrors it via `map/drawSync.ts` (programmatic writes use
  `source: 'remote'` and are ignored by event handlers).
- Edits are pure `Scenario → Scenario` functions committed through
  `useStore().commitScenario` (this gives undo/redo).
- Stations and track are referenced entities; never duplicate geometry.
- Physical track (`scenario.trackNetwork`: nodes, tracks, double-track groups,
  permitted movements) is separate from services (lines). Tracks connect only
  through nodes along permitted movements; a geometric crossing is never a
  connection. Double track is two tracks. See `docs/TRACK_ARCHITECTURE.md`.
- Track geometry is lines and circular arcs from a PI polygon with radii, computed
  in the project metric frame (`geo/track/`); never compute radii or offsets in
  degrees, and never store display samples as the source.
- Rail services (`alignment.kind = 'track'`) are routed over tracks through their
  stops (`domain/serviceRouting.ts`); their coordinates and segments are derived.
  Bus/BRT stay street-routed and outside the track graph.
- Segments are stored as fractions of line length covering [0, 1].
- `line.coordinates` is the derived geometry; `line.alignment` holds what defines it
  (track path, route waypoints). Recompute via `domain/serviceRouting.ts` or
  `domain/alignment.ts`.
- Parameters (spacing, separation, search distances) live in
  `domain/trackParameters.ts` with default, range, status and source.
- Schema 3 has no migration from older formats (owner decision); see
  `docs/PROJECT_MIGRATION.md`.
- Lines imported from OSM (`origin.source = 'osm'`, not edited) report findings as
  information only.
- The simulation engine is a pure function of simulated time; never tie it to frame rate.
- Backend: providers live in `app/providers/`, every response carries `Provenance`
  and `Capability`; outbound HTTP only via `fetch_with_retry` (allowlist, SSRF guard).

## Commands

```sh
cd frontend && npm run format && npm run lint && npm run typecheck && npm test
cd frontend && npm run build && npm run check:secrets && npm run test:e2e
cd backend && ruff format . && ruff check . && mypy app && pytest
docker compose config -q
```

Run all relevant checks before committing. In this sandbox Playwright needs
`PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (do not run `playwright install`).

## Rules

- **No invented figures.** Never hard-code a benchmark, cost, ridership, emission
  factor or engineering limit without a source. Use ranges with status
  (`documented_default`, `user_override`, `calibrated`, `demonstration`) and say
  "placeholder" when uncited. Never let an LLM produce numbers; deterministic code
  computes them.
- **Data transparency.** New data must carry Provenance (provider, dataset,
  licence, attribution, dates, status, limitations, confidence). Real-place
  projects must not show synthetic data; report a capability state instead.
- **Saving to the server requires the login** (`app/auth.py`); never weaken it or log
  tokens/passwords. Shared links stay public.
- **No browser-side secrets.** Only whitelisted `VITE_*` variables
  (see `src/App.test.tsx`); credentials stay in backend `MOBSIM_*` env vars.
- **Mapping attribution** must stay visible (OSM/ODbL, OpenFreeMap/OpenMapTiles,
  terrain sources, the AGPL drawing library) in the map, exports and reports.
- **Accessibility (WCAG 2.2 AA where practical):** labelled inputs, visible focus,
  keyboard paths for every task (Table view, chainage inputs), status never by
  colour alone, chart data tables, reduced-motion support, logical CSS properties
  (`ms-`/`me-`/`start-`) for RTL readiness.
- **Logging:** use `get_logger(__name__)` (backend) or `createLogger(scope)`
  (frontend); never `print`/`console.*` in app code (ESLint `no-console`). Pick the
  level by meaning (debug detail / info milestone / warning recoverable anomaly /
  error failed operation), pass context as structured fields, and never log tokens,
  credentials, query strings, request bodies or user-entered search text. See
  `docs/LOGGING.md`.
- **Wording:** findings are advisory; never call an alignment safe or
  construction-ready; emissions are "estimated under the selected assumptions".
- **Licensing:** the project is AGPL-3.0-only. Do not edit `LICENSE` (verbatim GNU
  text) or change the licence without the owner's explicit decision. Only add
  dependencies whose licence may be combined with AGPL-3.0. Keep
  `THIRD_PARTY_NOTICES.md` (licence link + repository for every resource) and
  `docs/licenses/` current (`cd frontend && npm run licenses`;
  `cd backend && python scripts/license_report.py --runtime-python <runtime-only venv> --dev-python .venv/bin/python`).
- **Git:** never push directly to `main`; work on a branch and open a PR.
- **Docs:** update README/docs/CHANGELOG with every behaviour change; do not
  describe planned features as available.
