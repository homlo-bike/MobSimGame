# Licensing

**Decision (2026-10-19): MobSimGame is licensed under AGPL-3.0-only.** The copyright
holder (Homlo-Bike) relicensed the project from MIT so that the project licence fits
all bundled libraries without conflict. The licence text in `LICENSE` is the
unmodified GNU AGPL v3 text from <https://www.gnu.org/licenses/agpl-3.0.txt>
(byte-identical to the copy shipped with `@sakuzu/maplibre-gl-draw`); the copyright
and licence notice is in `NOTICE`. This is not legal advice.

## Why AGPL-3.0-only

- The required drawing library `@sakuzu/maplibre-gl-draw` is **AGPL-3.0-only** and is
  bundled into the web app. Under MIT the project's own files were permissive, but
  the built app was still bound by the AGPL; the mismatch was confusing for users and
  operators. With AGPL-3.0-only, the project and the bundle carry the same terms.
- *Only* (not "or later") because the bundled library is AGPL-3.0-only: the combined
  work can only be distributed under version 3.
- Every other dependency is under a licence that may be combined with AGPL-3.0
  (MIT, ISC, BSD, 0BSD, Unlicense, Apache-2.0, EDL-1.0, LGPL-3.0, MPL-2.0, PSF-2.0 …);
  see the compatibility table in `THIRD_PARTY_NOTICES.md`.
- MobSimGame is a self-hosted web application. AGPL §13 makes hosted modifications
  available to their users, which suits a public, open mobility tool.

## Options that were compared

| | MIT (previous) | GPL-3.0 | AGPL-3.0 (chosen) |
| --- | --- | --- | --- |
| Others may reuse in closed products | Yes | Not if distributed | Not if distributed or served |
| Network use triggers source offer | No | No | Yes (§13) |
| Fits the AGPL drawing library | Own files only; bundle still AGPL-bound | Bundle still AGPL-bound | Fully consistent |
| Fits a self-hosted public web app | Hosted forks may stay closed | Hosted forks need not share | Hosted forks must share |

## What this means

- **Users** of any deployment are entitled to its Corresponding Source. The app's
  "Data & licences" dialog links to it (`VITE_SOURCE_URL`, default this repository).
- **Operators of modified versions** must publish their modified source and point
  `VITE_SOURCE_URL` to it.
- **Contributors** license their contributions under AGPL-3.0-only (see CONTRIBUTING.md).
- **Earlier versions**: copies obtained from commits up to `20cce9e` remain available
  under MIT.
- **Data** (OpenStreetMap: ODbL; terrain sources; operator data) keeps its own terms.
- **Separate programs** reached over the network or run in their own containers
  (PostgreSQL/PostGIS, nginx, Overpass, Nominatim) are not combined with MobSimGame.

## Keeping it conflict-free

- Before adding a dependency, check that its licence may be combined with AGPL-3.0.
  Not acceptable for bundled code: proprietary/"all rights reserved", non-commercial
  (e.g. CC BY-NC), GPL-2.0-only, or licences with field-of-use restrictions.
- Regenerate `docs/licenses/` and update `THIRD_PARTY_NOTICES.md` in the same PR.
