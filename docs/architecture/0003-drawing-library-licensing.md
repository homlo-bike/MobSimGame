# ADR 0003 — Licensing with an AGPL-3.0 drawing library

- Status: accepted — revised 2026-10-19: project relicensed to AGPL-3.0-only
- Date: 2026-10-19

## Context

The brief requires `@sakuzu/maplibre-gl-draw`. Its npm package (2.2.0) declares
`AGPL-3.0-only`; a commercial licence is offered by its authors. MobSimGame was
initially MIT-licensed, which left the project's own files permissive but the built
web app bound by the AGPL — a mismatch for users and operators.

This is not legal advice; it records the maintainers' understanding.

## Decision

- The copyright holder relicensed MobSimGame under **AGPL-3.0-only** (`LICENSE` is the
  verbatim GNU text; notice in `NOTICE`). "Only" matches the library's own terms.
- Keep the library isolated behind `map/drawSync.ts` and `map/MapView.tsx`.
- The UI links to the source code (`VITE_SOURCE_URL`, default this repository) in
  "Data & licences" and credits the library in the map attribution. Operators of
  modified versions set it to their modified source.
- Record every dependency in `THIRD_PARTY_NOTICES.md` and the generated reports in
  `docs/licenses/`, and check licence compatibility before adding dependencies.

## Alternatives considered

- Staying MIT: rejected by the owner because the project licence would not match the
  bundled AGPL library.
- MIT-licensed drawing libraries (e.g. terra-draw): not chosen because the brief names
  `@sakuzu/maplibre-gl-draw`.
- AGPL-3.0-or-later: not chosen because the bundled library allows version 3 only.

See [docs/LICENSING_OPTIONS.md](../LICENSING_OPTIONS.md).
