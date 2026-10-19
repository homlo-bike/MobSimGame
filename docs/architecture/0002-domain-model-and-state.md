# ADR 0002 — Domain model, state and the draw library boundary

- Status: accepted
- Date: 2026-10-19

## Decision

1. **The project document is the source of truth.** It is a Zod-validated,
   versioned JSON document (`frontend/src/domain/schema.ts`, `SCHEMA_VERSION = 1`).
   Coordinates are GeoJSON `[longitude, latitude]` in WGS84.
2. **Pure operations.** Edits are pure functions `Scenario → Scenario`
   (`domain/network.ts`). The Zustand store keeps a bounded undo stack of
   immutable project snapshots (100 steps).
3. **Referenced entities.** Stations exist once per scenario; lines reference them
   by id in `stops`. Shared track is a `SharedTrack` record of line ranges, never a
   copy of geometry. Interchange status is derived (a station on ≥ 2 lines);
   out-of-station transfers use `Interchange` records.
4. **Segments by fraction.** A line's segments cover `[0, 1]` of its length.
   Fractions survive vertex edits; metres are derived for display.
5. **Draw library is an editing adapter.** `@sakuzu/maplibre-gl-draw` features
   mirror lines (feature id = line id). `map/drawSync.ts` writes the project into
   the drawing in transactions tagged `source: 'remote'`; handlers ignore remote
   events, so programmatic updates never loop. User edits arrive as non-remote
   events and become domain operations (with undo). The library has no
   document-level undo, so history lives in the store.
6. **Rendering is separate.** Structure styling, stations, catchments, overlays and
   vehicles are MapLibre GeoJSON layers built by pure functions
   (`map/overlays.ts`). The simulation engine never touches the map.

## Consequences

- A different drawing library could replace the adapter without touching the
  domain (see ADR 0003 for why this matters).
- Ring lines are stored open; the drawing shows them closed. Editing the
  duplicated closing vertex is ignored by design.
