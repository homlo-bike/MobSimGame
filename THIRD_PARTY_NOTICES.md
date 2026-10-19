# Third-party notices

MobSimGame's own source code is licensed under the MIT licence (see `LICENSE`).
It uses third-party software and data under their own licences. Full dependency
lists with licences are generated into:

- [docs/licenses/frontend-dependencies.md](docs/licenses/frontend-dependencies.md) (`cd frontend && npm run licenses`)
- [docs/licenses/backend-dependencies.md](docs/licenses/backend-dependencies.md) (`pip-licenses` in a runtime-only environment)

Licence texts of npm and Python packages are shipped inside each package
(`node_modules/<pkg>/LICENSE*`, `site-packages/*.dist-info`).

## Software with notable obligations

| Component | Licence | Obligation / note |
| --- | --- | --- |
| [@sakuzu/maplibre-gl-draw](https://github.com/sakuzu/maplibre-gl-draw) 2.2.0 © 2026 SAKAIDA Atsushi | **AGPL-3.0-only** | Bundled into the frontend. Users of a deployment must be offered the Corresponding Source of the built app; the app links to it ("Data & licences", `VITE_SOURCE_URL`). It contains ported code from deck.gl and math.gl (MIT), maplibre-gl (BSD-3-Clause) and earcut (ISC); see its `THIRD_PARTY_NOTICES.md`. A commercial licence is offered by its authors. See ADR 0003. |
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) 6.11.1 | BSD-3-Clause | Keep copyright notice; includes code from mapbox-gl-js ≤ 1.13 (BSD-3-Clause). |
| [Turf](https://turfjs.org/) 7.4 | MIT | Includes `arc` (BSD-style licence text, also crediting GDAL/OGR) via `@turf/great-circle`. |
| React, Zustand, Zod, Tailwind CSS | MIT | — |
| psycopg 3 | LGPL-3.0-only | Used unmodified as a dynamically loaded library. |
| certifi | MPL-2.0 | Used unmodified. |
| FastAPI, Starlette, Pydantic, SQLAlchemy, GeoAlchemy2, Alembic, httpx, uvicorn | MIT / BSD | — |
| PostGIS (container image) | GPL-2.0-or-later | Runs as a separate service; not linked into MobSimGame. |
| PostgreSQL (container image) | PostgreSQL Licence | Separate service. |
| nginx (container image) | BSD-2-Clause | Separate service. |

## Data and services

| Source | Licence / terms (as stated by each project; verify for your use) | Required attribution |
| --- | --- | --- |
| OpenStreetMap (basemap data, Overpass, Nominatim) | ODbL 1.0 | "© OpenStreetMap contributors", linked to <https://www.openstreetmap.org/copyright>, visible on the map. Follow the Overpass and Nominatim usage policies. |
| OpenFreeMap tiles | Service terms on <https://openfreemap.org/> | "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (shown by the map). |
| OpenMapTiles schema/styles | BSD-3-Clause (code) / CC-BY 4.0 (design) per OpenMapTiles | "© OpenMapTiles". |
| AWS Terrain Tiles (Mapzen/Tilezen) | Per source, see <https://github.com/tilezen/joerd/blob/master/docs/attribution.md> | e.g. SRTM, GMTED2010, 3DEP courtesy of the U.S. Geological Survey; ETOPO1 courtesy of NOAA (shown when terrain is enabled). |
| CAMARA population density (if configured) | Operator contract | Operator-specified attribution; aggregated estimates only. |
| transport.rest (if enabled) | See <https://transport.rest/> and operator terms | Credit transport.rest and the operator. |
| ArcGIS Traffic (not enabled) | Esri terms (to be verified) | To be determined before enabling. |
| Population fallbacks (WorldPop, GHSL) — planned | WorldPop: CC BY 4.0; GHSL: per JRC terms | Cite dataset name, year and producer. Verify terms when implemented. |

Different datasets may carry licences that differ from the application code.
