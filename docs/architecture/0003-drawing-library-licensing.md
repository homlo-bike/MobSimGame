# ADR 0003 — Use of an AGPL-3.0 drawing library in an MIT project

- Status: accepted (with obligations documented); revisit if the licence model changes
- Date: 2026-10-19

## Context

The brief requires `@sakuzu/maplibre-gl-draw`. Its npm package (2.2.0) declares
`AGPL-3.0-only`; a commercial licence is offered by its authors. MobSimGame is
MIT-licensed and the MIT text must not be altered.

This is not legal advice; it records the maintainers' understanding.

## Decision

- Keep MobSimGame's own source files under MIT (unchanged `LICENSE`).
- Use the library as an npm dependency, isolated behind `map/drawSync.ts` and
  `map/MapView.tsx`.
- Treat the **built frontend bundle** (which contains the library) as subject to
  AGPL-3.0 obligations when distributed or served to users:
  - The UI links to the source code (`VITE_SOURCE_URL`, default: this repository)
    in "Data & licences" and credits the library in the map attribution.
  - Operators who modify and deploy MobSimGame should publish their modified
    source (set `VITE_SOURCE_URL` accordingly).
- Record the dependency in `THIRD_PARTY_NOTICES.md` and the generated licence
  report (`docs/licenses/frontend-dependencies.md`).

## Alternatives considered

- MIT-licensed drawing libraries (e.g. terra-draw, mapbox-gl-draw forks): not chosen
  because the brief names `@sakuzu/maplibre-gl-draw`; the adapter boundary keeps a
  later switch cheap.
- Relicensing MobSimGame under AGPL-3.0: a project-owner decision, not taken here.
  `docs/LICENSING_OPTIONS.md` compares the options.
