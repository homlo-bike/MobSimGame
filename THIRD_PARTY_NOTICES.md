# Third-party notices

**MobSimGame** — Copyright (C) 2026 Homlo-Bike — is licensed under the
[GNU Affero General Public License v3.0 only](https://www.gnu.org/licenses/agpl-3.0.html)
(SPDX `AGPL-3.0-only`, full text in [`LICENSE`](LICENSE), notice in [`NOTICE`](NOTICE)).
Source: <https://github.com/homlo-bike/MobSimGame>.

This file lists every third-party component, image, tool, dataset and service the
project uses, with a link to its licence and to its source repository or terms.
The complete transitive dependency lists (every npm and Python package, with
licence link and repository URL) are generated into:

- [docs/licenses/frontend-dependencies.md](docs/licenses/frontend-dependencies.md) — `cd frontend && npm run licenses`
- [docs/licenses/backend-dependencies.md](docs/licenses/backend-dependencies.md) — `backend/scripts/license_report.py`

Each package also ships its own licence file (`frontend/node_modules/<pkg>/`,
`site-packages/<pkg>.dist-info/`). Datasets and services keep their own licences
and terms, independent of the code licence.

## Licence compatibility

The project licence was chosen so every component fits without conflict
(see [docs/LICENSING_OPTIONS.md](docs/LICENSING_OPTIONS.md)):

| Licence found in dependencies | Compatible with AGPL-3.0-only? | Why |
| --- | --- | --- |
| [AGPL-3.0-only](https://spdx.org/licenses/AGPL-3.0-only.html) (`@sakuzu/maplibre-gl-draw`) | Yes | Same licence and version. |
| [MIT](https://spdx.org/licenses/MIT.html), [MIT-0](https://spdx.org/licenses/MIT-0.html), [ISC](https://spdx.org/licenses/ISC.html), [0BSD](https://spdx.org/licenses/0BSD.html), [BSD-2-Clause](https://spdx.org/licenses/BSD-2-Clause.html), [BSD-3-Clause](https://spdx.org/licenses/BSD-3-Clause.html), [Unlicense](https://spdx.org/licenses/Unlicense.html), [BlueOak-1.0.0](https://spdx.org/licenses/BlueOak-1.0.0.html), [CC0-1.0](https://spdx.org/licenses/CC0-1.0.html) | Yes | Permissive; keep the copyright notices (shipped in each package). |
| [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html) | Yes | GPL-3.0-family licences are compatible with Apache-2.0. |
| [EDL-1.0](https://spdx.org/licenses/EDL-1.0.html) OR [EPL-1.0](https://spdx.org/licenses/EPL-1.0.html) (`jsts`, `@turf/jsts`) | Yes | Used under EDL-1.0 (a BSD-3-Clause-style licence). |
| [LGPL-3.0-only](https://spdx.org/licenses/LGPL-3.0-only.html) (`psycopg`) | Yes | LGPL-3.0 code may be combined with (A)GPL-3.0 code. |
| [MPL-2.0](https://spdx.org/licenses/MPL-2.0.html) (`certifi`; dev tools) | Yes | MPL-2.0 §3.3 allows combination with GPL-family licences. |
| [PSF-2.0](https://spdx.org/licenses/PSF-2.0.html), [Python-2.0](https://spdx.org/licenses/Python-2.0.html) | Yes | Permissive, GPL-compatible. |
| [CC-BY-4.0](https://spdx.org/licenses/CC-BY-4.0.html) (`caniuse-lite`, dev only; map style designs) | Data/design, not code | Attribution given; not linked into the program. |
| [GPL-2.0-or-later](https://spdx.org/licenses/GPL-2.0-or-later.html) (PostGIS), [GPL-3.0-only](https://spdx.org/licenses/GPL-3.0-only.html) (Nominatim), [AGPL-3.0-only](https://spdx.org/licenses/AGPL-3.0-only.html) (Overpass) | Not combined | Separate programs/services reached over the network or run as a separate container. |

## Frontend — runtime dependencies (bundled into the web app)

| Package | Version | Licence | Repository |
| --- | --- | --- | --- |
| @sakuzu/maplibre-gl-draw | 2.2.0 | [AGPL-3.0-only](https://spdx.org/licenses/AGPL-3.0-only.html) | <https://github.com/sakuzu/maplibre-gl-draw> |
| @turf/turf | 7.4.0 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/Turfjs/turf> |
| maplibre-gl | 6.11.1 | [BSD-3-Clause](https://spdx.org/licenses/BSD-3-Clause.html) | <https://github.com/maplibre/maplibre-gl-js> |
| react | 19.3.1 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/react/react> |
| react-dom | 19.3.1 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/react/react> |
| zod | 4.6.7 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/colinhacks/zod> |
| zustand | 5.0.15 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/pmndrs/zustand> |

Notable code inside the bundle via those packages (full list in the generated report):

| Component | Licence | Repository | Note |
| --- | --- | --- | --- |
| deck.gl (ported GLSL in maplibre-gl-draw) | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/visgl/deck.gl> | Ported by maplibre-gl-draw; see its `THIRD_PARTY_NOTICES.md`. |
| math.gl (ported formula in maplibre-gl-draw) | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/visgl/math.gl> | As above. |
| earcut | [ISC](https://spdx.org/licenses/ISC.html) | <https://github.com/mapbox/earcut> | Dependency and ported code of maplibre-gl-draw. |
| polygon-clipping | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/mfogel/polygon-clipping> | maplibre-gl-draw dependency. |
| rbush | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/mourner/rbush> | maplibre-gl-draw dependency. |
| ulid | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/ulid/javascript> | maplibre-gl-draw dependency. |
| jsts / @turf/jsts | [EDL-1.0](https://spdx.org/licenses/EDL-1.0.html) OR [EPL-1.0](https://spdx.org/licenses/EPL-1.0.html) | <https://github.com/bjornharrtell/jsts>, <https://github.com/turfjs/turf-jsts> | Via Turf. |
| arc | [BSD-2-Clause](https://spdx.org/licenses/BSD-2-Clause.html) | <https://github.com/springmeyer/arc.js> | Via Turf; no SPDX field, licence read from its LICENSE.md (includes MIT-licensed GDAL/OGR code). |

## Frontend — development dependencies (build and test only, not shipped)

| Package | Version | Licence | Repository |
| --- | --- | --- | --- |
| @eslint/js | 9.39.5 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/eslint/eslint> |
| @playwright/test | 1.64.1 | [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html) | <https://github.com/microsoft/playwright> |
| @tailwindcss/vite | 4.3.3 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/tailwindlabs/tailwindcss> |
| @testing-library/jest-dom | 6.9.1 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/testing-library/jest-dom> |
| @testing-library/react | 16.3.3 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/testing-library/react-testing-library> |
| @testing-library/user-event | 14.6.8 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/testing-library/user-event> |
| @types/geojson | 7946.0.16 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| @types/node | 22.20.5 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| @types/react | 19.3.0 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| @types/react-dom | 19.3.0 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| @vitejs/plugin-react | 5.2.0 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/vitejs/vite-plugin-react> |
| eslint | 9.39.5 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/eslint/eslint> |
| eslint-plugin-jsx-a11y | 6.10.2 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/jsx-eslint/eslint-plugin-jsx-a11y> |
| eslint-plugin-react-hooks | 7.1.1 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/facebook/react> |
| globals | 17.13.0 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/sindresorhus/globals> |
| jsdom | 26.1.0 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/jsdom/jsdom> |
| prettier | 3.9.10 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/prettier/prettier> |
| tailwindcss | 4.3.3 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/tailwindlabs/tailwindcss> |
| typescript | 5.9.3 | [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html) | <https://github.com/microsoft/TypeScript> |
| typescript-eslint | 8.71.2 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/typescript-eslint/typescript-eslint> |
| vite | 7.3.7 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/vitejs/vite> |
| vitest | 5.0.5 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/vitest-dev/vitest> |

## Backend — runtime dependencies (shipped in the API image)

| Package | Version | Licence | Repository |
| --- | --- | --- | --- |
| alembic | 1.20.0 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/sqlalchemy/alembic/> |
| fastapi | 0.148.0 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/fastapi/fastapi> |
| geoalchemy2 | 0.20.0 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/geoalchemy/geoalchemy2> |
| httpx | 0.28.1 | [BSD-3-Clause](https://spdx.org/licenses/BSD-3-Clause.html) | <https://github.com/encode/httpx> |
| psycopg | 3.3.6 | [LGPL-3.0-only](https://spdx.org/licenses/LGPL-3.0-only.html) | <https://github.com/psycopg/psycopg> |
| pydantic | 2.14.1 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/pydantic/pydantic> |
| pydantic-settings | 2.16.0 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/pydantic/pydantic-settings> |
| sqlalchemy | 2.1.5 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/sqlalchemy/sqlalchemy> |
| uvicorn | 0.54.0 | [BSD-3-Clause](https://spdx.org/licenses/BSD-3-Clause.html) | <https://github.com/Kludex/uvicorn> |

## Backend — development dependencies (not shipped)

| Package | Version | Licence | Repository |
| --- | --- | --- | --- |
| mypy | 2.4.0 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/python/mypy> |
| pip-audit | 2.10.1 | [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html) | <https://github.com/pypa/pip-audit> |
| pip-licenses | 5.5.5 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/raimon49/pip-licenses> |
| pytest | 9.1.1 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/pytest-dev/pytest> |
| pytest-asyncio | 1.4.0 | [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html) | <https://github.com/pytest-dev/pytest-asyncio> |
| ruff | 0.17.1 | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/astral-sh/ruff> |

## Container images (Docker Compose)

| Image | Software licence | Image/source repository | Software repository |
| --- | --- | --- | --- |
| `postgis/postgis:16-3.4` | PostGIS [GPL-2.0-or-later](https://spdx.org/licenses/GPL-2.0-or-later.html) ([LICENSE.TXT](https://github.com/postgis/postgis/blob/master/LICENSE.TXT), includes PROJ, GEOS, GDAL notices); PostgreSQL [PostgreSQL](https://spdx.org/licenses/PostgreSQL.html); image build files [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/postgis/docker-postgis> | <https://github.com/postgis/postgis>, <https://github.com/postgres/postgres> |
| `python:3.12-slim` (API base) | CPython [PSF-2.0](https://spdx.org/licenses/PSF-2.0.html); Debian packages under their own licences; image build files [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/docker-library/python> | <https://github.com/python/cpython> |
| `node:22-alpine` (build stage, dev profile) | Node.js [MIT](https://spdx.org/licenses/MIT.html); Alpine packages under their own licences; image build files [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/nodejs/docker-node> | <https://github.com/nodejs/node> |
| `nginx:1.27-alpine` (web) | nginx [BSD-2-Clause](https://spdx.org/licenses/BSD-2-Clause.html); image build files [BSD-2-Clause](https://spdx.org/licenses/BSD-2-Clause.html) | <https://github.com/nginxinc/docker-nginx> | <https://github.com/nginx/nginx> |

Images are pulled, not redistributed, by this repository. If you redistribute
built images, include the licence information of the packages inside them.

## CI (GitHub Actions)

| Action | Licence | Repository |
| --- | --- | --- |
| actions/checkout | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/actions/checkout> |
| actions/setup-node | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/actions/setup-node> |
| actions/setup-python | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/actions/setup-python> |
| actions/upload-artifact | [MIT](https://spdx.org/licenses/MIT.html) | <https://github.com/actions/upload-artifact> |

## Map styles, fonts and icons (loaded at runtime from OpenFreeMap)

| Resource | Licence | Source | Required attribution |
| --- | --- | --- | --- |
| OpenFreeMap (tile service, styles) | [MIT](https://spdx.org/licenses/MIT.html) (project code) | <https://github.com/hyperknot/openfreemap>, <https://github.com/hyperknot/openfreemap-styles>, terms: <https://openfreemap.org/> | "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (shown in the map) |
| OpenMapTiles schema | Code [BSD-3-Clause](https://spdx.org/licenses/BSD-3-Clause.html), design [CC-BY-4.0](https://spdx.org/licenses/CC-BY-4.0.html) | <https://github.com/openmaptiles/openmaptiles> ([LICENSE.md](https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md)) | "© OpenMapTiles" (shown) |
| Liberty style (OSM Liberty ← OSM Bright ← Mapbox Open Styles) | Code [BSD-3-Clause](https://spdx.org/licenses/BSD-3-Clause.html), design [CC-BY-4.0](https://spdx.org/licenses/CC-BY-4.0.html) | <https://github.com/maputnik/osm-liberty>, <https://github.com/openmaptiles/osm-bright-gl-style> | via "© OpenMapTiles" |
| Bright style (OSM Bright) | Code [BSD-3-Clause](https://spdx.org/licenses/BSD-3-Clause.html), design [CC-BY-4.0](https://spdx.org/licenses/CC-BY-4.0.html) | <https://github.com/openmaptiles/osm-bright-gl-style> | via "© OpenMapTiles" |
| Positron style (from CartoDB Basemaps by Stamen and Paul Norman, [CC-BY-3.0](https://spdx.org/licenses/CC-BY-3.0.html)) | Code [BSD-3-Clause](https://spdx.org/licenses/BSD-3-Clause.html), design [CC-BY-4.0](https://spdx.org/licenses/CC-BY-4.0.html) | <https://github.com/openmaptiles/positron-gl-style>, <https://github.com/CartoDB/CartoDB-basemaps> | via "© OpenMapTiles" |
| Noto Sans glyphs (station labels) | [OFL-1.1](https://spdx.org/licenses/OFL-1.1.html) | <https://github.com/notofonts>, <https://openfontlicense.org/> | — |
| Maki POI icons (in OpenFreeMap styles) | [CC0-1.0](https://spdx.org/licenses/CC0-1.0.html) | <https://github.com/mapbox/maki> | — |
| Natural Earth shaded relief (low zooms of Liberty) | Public domain | <https://github.com/nvkelso/natural-earth-vector>, terms: <https://www.naturalearthdata.com/about/terms-of-use/> | Not required |

## Data and services

| Source | Licence / terms | Repository / terms URL | Required attribution |
| --- | --- | --- | --- |
| OpenStreetMap data (basemap, Overpass, Nominatim) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | <https://www.openstreetmap.org/copyright> | "© OpenStreetMap contributors" linked to the copyright page, visible on the map (done) |
| Overpass API (public instance, backend proxy) | Service policy; software [AGPL-3.0-only](https://spdx.org/licenses/AGPL-3.0-only.html) | Software: <https://github.com/drolbr/Overpass-API>; policy: <https://wiki.openstreetmap.org/wiki/Overpass_API> | OSM attribution; follow the usage policy (limits, caching, User-Agent) |
| Nominatim (backend proxy) | [OSMF usage policy](https://operations.osmfoundation.org/policies/nominatim/); software [GPL-3.0-only](https://spdx.org/licenses/GPL-3.0-only.html) | <https://github.com/osm-search/Nominatim> | OSM attribution; max 1 request/s, no autocomplete, caching (done) |
| AWS Terrain Tiles (Mapzen/Tilezen) | Per source dataset | Registry: <https://registry.opendata.aws/terrain-tiles/>; attribution: <https://github.com/tilezen/joerd/blob/master/docs/attribution.md> | e.g. SRTM, GMTED2010, 3DEP courtesy of the U.S. Geological Survey; ETOPO1 courtesy of NOAA (shown when terrain is on) |
| CAMARA Population Density Data API (disabled until configured) | API specification [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html); data per operator contract | <https://github.com/camaraproject/PopulationDensityData> | Operator-specified |
| transport.rest / db-rest (opt-in) | db-rest software [ISC](https://spdx.org/licenses/ISC.html); data per operator terms | <https://transport.rest/>, <https://github.com/derhuerst/db-rest> | Credit transport.rest and the operator |
| ArcGIS Traffic service (not enabled) | Esri terms — not yet verified | <https://developers.arcgis.com/rest/routing/traffic-service/> | To be determined before enabling |
| WorldPop, GHSL GHS-POP (planned) | To be verified when implemented | <https://www.worldpop.org/>, <https://human-settlement.emergency.copernicus.eu/> | Dataset name, year, producer |

## Reference applications (no code or assets used)

MetroSystem (<https://metrosystemgame.com/>) and CartoMaps (<https://mapeandometro.vercel.app/>)
were reviewed for feature ideas only; no code, text, data, assets or branding were
copied. See [docs/REFERENCE_FEATURE_REVIEW.md](docs/REFERENCE_FEATURE_REVIEW.md).
