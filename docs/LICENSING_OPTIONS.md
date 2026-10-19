# Licensing options

The repository is licensed under **MIT** (`LICENSE`, © 2026 Homlo-Bike). That text
is unchanged and no licence change has been made. This note exists because the
required drawing library, `@sakuzu/maplibre-gl-draw`, is **AGPL-3.0-only**, and
explains the options so the project owner can decide. It is not legal advice.

## What applies today

- MobSimGame's own source files: MIT.
- The built frontend bundle contains AGPL-3.0 code. Distributing it, or letting
  users interact with it over a network, brings AGPL-3.0 obligations for the
  combined work: offer the Corresponding Source to users. The UI links to the
  source (`VITE_SOURCE_URL`); operators of modified versions should point it to
  their modified source.
- The backend contains no AGPL code. It depends on LGPL-3.0 `psycopg` (dynamic
  use, unmodified) and MPL-2.0 `certifi`.
- Data (OSM: ODbL; terrain sources; operator data) has its own licences,
  independent of the code licence.

## Comparison

| | MIT | GPL-3.0 | AGPL-3.0 |
| --- | --- | --- | --- |
| Others may reuse in closed products | Yes | Not if distributed | Not if distributed or served |
| Network use triggers source offer | No | No | Yes (§13) |
| Consistent with the AGPL drawing library | Own files yes; built bundle still AGPL-bound | Bundle still AGPL-bound (GPL-3.0 and AGPL-3.0 may be combined, §13) | Fully consistent |
| Contributor friction | Lowest | Medium | Medium |
| Fits a self-hosted public web app | Yes, but forks can stay closed except for the AGPL part | Weak: SaaS forks need not share | Strong: hosted forks must share |

## Recommendation

Keep MIT for now (no change without the owner's decision). If the owner wants
hosted modifications of MobSimGame itself to stay open, **AGPL-3.0** is the
coherent choice, matching the drawing library and the self-hosted web-app use
case. If maximum reuse matters more, stay MIT and keep the draw adapter
(`frontend/src/map/drawSync.ts`) small so an MIT-licensed drawing library could
replace the AGPL one later (ADR 0003).

A licence change requires the consent of all copyright holders of contributed
code; decide before accepting many external contributions.
