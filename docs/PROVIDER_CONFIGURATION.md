# Provider configuration

Providers are configured with `MOBSIM_*` environment variables on the **backend**
(see `.env.example`). Browser build variables (`VITE_*`) are public and must never
contain secrets; the build fails if a `VITE_*` variable name looks secret, and CI
scans the bundle for credential patterns.

Outbound requests are allowed only to hosts in `MOBSIM_OUTBOUND_ALLOWLIST`
(comma-separated), only over https, and (by default) only when the host resolves
to public addresses (`MOBSIM_OUTBOUND_DNS_CHECK`). Add the host of any custom
endpoint (self-hosted Overpass, CAMARA operator) to the allowlist.

Terms below were read on 2026-10-19. Re-check them before relying on a provider;
nothing here asserts that a service is free, global or unrestricted.

## Basemap (browser)

| Option | Notes |
| --- | --- |
| OpenFreeMap Liberty / Positron / Bright | `https://tiles.openfreemap.org/styles/<name>`. Its site states no API keys or registration and no view/request limits for the public instance, without an SLA. Attribution required: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (shown in the map). |
| Plain / High contrast | Offline styles without tiles (labels need the glyph server). |
| Aerial: Sentinel-2 cloudless 2016 (EOX) | `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg`, keyless. Licence [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) for the 2016 layer (EOX's capabilities and licence page; later years are CC BY-NC-SA and are not used). Attribution: "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)". Resolution 10 m: streets are visible, tracks and platforms are not. |
| Aerial: Esri World Imagery (opt-in) | Offered only with `VITE_ESRI_IMAGERY=1`. Sub-metre imagery worldwide from `server.arcgisonline.com`. Governed by the Esri Master License Agreement; keyless use outside Esri software is not clearly permitted, so the deployment that enables it accepts Esri's terms. Attribution "Esri, Vantor, Earthstar Geographics, and the GIS User Community" is shown in the map. Not for offline tile export. |
| Terrain relief | Hillshading from the terrain tiles below; with this background the map shows 3D relief when tilted. |
| Extra styles | `VITE_EXTRA_BASEMAPS="Label|https://…/style.json,…"`. Only keyless URLs. Update the CSP in `frontend/nginx.conf` for new hosts. |

Only one background is shown at a time (map, aerial or terrain), so only the visible one
is downloaded.

## Terrain (browser, visual only)

`VITE_TERRAIN_TILES_URL` (default AWS Terrain Tiles, Terrarium encoding:
`https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png`).
Attribution per the Tilezen/joerd attribution document (SRTM, GMTED2010 and 3DEP
courtesy of USGS; ETOPO1 courtesy of NOAA, among others). Used by the "Terrain relief"
background; empty removes that background.

## OpenStreetMap features (Overpass)

| Variable | Default |
| --- | --- |
| `MOBSIM_OVERPASS_ENABLED` | `true` |
| `MOBSIM_OVERPASS_URL` | `https://overpass-api.de/api/interpreter` |
| `MOBSIM_OVERPASS_TIMEOUT_S` | `25` (declared in the query) |
| `MOBSIM_OVERPASS_MAX_RADIUS_M` | `1000` |
| `MOBSIM_OVERPASS_MAX_BBOX_KM2` | `25` |
| `MOBSIM_OVERPASS_CACHE_TTL_S` | `86400` |

The Overpass usage policy asks for modest volumes (the wiki gives < 10 000
queries and < 1 GB per day, and much less for regular use), an identifying
User-Agent, no parallel bulk scripts and pausing on HTTP 429. MobSimGame only
queries on explicit user action (station-name suggestions), caps area and result
count, caches results and retries with exponential backoff honouring
`Retry-After`. For regular or heavy use, self-host Overpass or wait for the PBF
import (Phase 3). The main OSM editing API is never used for reads.

### Example city networks

`GET /api/v1/examples` lists the cities; `GET /api/v1/examples/{city}/{tram|metro|bus}`
loads one network from Overpass: public-transport route relations with their ways
(`out geom`) and stop nodes, in the city's query extent. Full bus networks are large
(London has several hundred routes): a first load can take minutes and may hit the
public instance's limits; results are cached for a week. Only the city and network
are sent. Please keep this to occasional use on the public instance, or self-host
Overpass.

| Variable | Default |
| --- | --- |
| `MOBSIM_EXAMPLES_TIMEOUT_S` | `180` (declared in the query) |
| `MOBSIM_EXAMPLES_CACHE_TTL_S` | `604800` |

### Traffic signals

`POST /api/v1/osm/traffic-signals` with `{"paths": [[[lon, lat], …]], "radius_m": 15}`
returns `highway=traffic_signals` nodes near the paths (Overpass `around` a
linestring). It runs only when the user presses *Find signals*, sends the
street-level tram and bus line geometry to Overpass (disclosed in the panel), and
caches results like the example networks. OSM has no signal timings.

## Street routing (Valhalla, self-hosted)

See [ROUTING.md](ROUTING.md). Disabled unless `MOBSIM_VALHALLA_URL` is set.

## Geocoding (Nominatim)

`MOBSIM_GEOCODER_ENABLED`, `MOBSIM_NOMINATIM_URL`, `MOBSIM_NOMINATIM_LOOKUP_URL` (boundaries), `MOBSIM_CONTACT_EMAIL`.
The OSMF policy allows at most 1 request/second per application, requires an
identifying User-Agent, caching, and forbids client-side autocomplete. The backend
serialises requests to ≤ 1/s per process, caches for 7 days, and the UI searches
only on submit. Without the backend, the offline parser accepts "latitude,
longitude" and demo place names.

**Place lookup for regions** (`GET /api/v1/geocode?q=…&places=true`) restricts
results to settlements (cities, towns, districts, neighbourhoods) and returns the
address type, the enclosing places and whether the result is an OSM relation.
`GET /api/v1/geocode/boundary/{node|way|relation}/{id}` returns that object's
polygon from Nominatim's `/lookup` (`polygon_geojson=1`, simplified by Nominatim
with a tolerance of 0.00005°, a project choice reported in provenance), cached for
7 days. When OSM has no polygon, `geometry` is `null` and the capability is
`manual_input_required`; the app then centres the map on the place and offers
drawing the region by hand. A boundary is never generated.

## Population (CAMARA Population Density Data)

There is no anonymous public endpoint: operators expose the API under contract.
The adapter (spec r3.2, API v0.3, `POST …/retrieve`, 2-legged OAuth client
credentials, scope `population-density-data:read`) stays disabled until all of:

```
MOBSIM_CAMARA_POPULATION_URL=https://<operator>/population-density-data/v0.3
MOBSIM_CAMARA_TOKEN_URL=https://<operator>/oauth/token
MOBSIM_CAMARA_CLIENT_ID=…
MOBSIM_CAMARA_CLIENT_SECRET=…
MOBSIM_OUTBOUND_ALLOWLIST=<defaults>,<operator host>
```

Requests send a polygon of 3–15 points and a ≤ 7-day window; responses are
geohash cells with `minPplDensity / pplDensity / maxPplDensity` mapped to
low/central/high, status *estimated*. Only aggregated densities are handled.
The GSMA documentation page could not be read (HTTP 403) when this was written;
the CAMARA repository was used. No HTTP route exposes this adapter yet (Phase 3).

Planned fallbacks: WorldPop, GHSL GHS-POP, user-uploaded GeoTIFF, GeoJSON
polygons, CSV points/grids.

## Traffic (ArcGIS Traffic service)

`MOBSIM_ARCGIS_TOKEN`. The documented service is a dynamic MapServer
(`traffic.arcgis.com/…/World/Traffic/MapServer`) with five-minute speed updates.
Authentication, credit consumption, caching and redistribution terms were **not
verified**, so the adapter performs no requests: without a token it reports
*not configured*, with one *manual input required*. A maintainer must verify the
terms before implementing it. Never commit a token. Traffic data must be labelled
live / historic / predicted / demonstration; the Phase 1 demo traffic is
*demonstration*.

## Existing transit (transport.rest)

`MOBSIM_TRANSPORT_REST_ENABLED=false`, `MOBSIM_TRANSPORT_REST_URL`
(default `https://v6.db.transport.rest`). transport.rest lists per-network
community APIs (e.g. DB, VBB, BVG) without a stated SLA or published rate
limits, so the adapter is opt-in and coverage is limited to the configured
network. Route: `GET /api/v1/transit/stops-near`.

Planned: GTFS Schedule and Realtime, NeTEx, SIRI, GBFS, user GTFS ZIP uploads,
manually entered routes and frequencies. The app stays usable without any of them.

## Elevation

Interface only in Phase 1; the fictional demo uses a synthetic surface. Planned:
configurable public elevation API, self-hosted terrain service, uploaded DEM/COG,
SRTM/Copernicus where licensing permits.
