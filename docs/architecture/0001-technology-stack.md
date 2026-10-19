# ADR 0001 — Technology stack

- Status: accepted
- Date: 2026-10-19

## Context

The repository had no code. The brief names a default stack and requires a
browser-first application with a small backend for saving/sharing and for
proxying credentialed providers.

## Decision

- Frontend: React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, MapLibre GL JS 6.11
  (required by the draw library), `@sakuzu/maplibre-gl-draw` 2.2, Turf 7, Zustand 5,
  Zod 4.
- Charts: hand-written accessible SVG range charts instead of Recharts/ECharts.
  Low/central/high ranges are the core encoding, a small component gives full
  control over focus, tooltips and data-table alternatives, and avoids ~400 kB.
- Backend: Python 3.12, FastAPI, Pydantic 2, SQLAlchemy 2.1, GeoAlchemy2, Alembic,
  httpx. No job queue (no long-running jobs yet).
- Storage: PostgreSQL 16 + PostGIS 3.4. Redis and MinIO are deferred until caching
  across workers or file uploads need them.
- Tests: Vitest + Testing Library, Playwright, pytest. Lint/format: ESLint
  (with jsx-a11y) + Prettier, Ruff + strict mypy.
- Deployment: Docker Compose; nginx serves the static build and proxies `/api`.

Vitest 5 is used because Vitest 3 pulled a tinypool version with critical
advisories at the time of writing.

## Consequences

- Most logic (geometry, validation, analysis, simulation, schematic) is pure
  TypeScript, testable without a browser and usable offline.
- Unit tests use SQLite; a PostGIS integration test runs in CI.
