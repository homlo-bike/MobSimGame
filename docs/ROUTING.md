# Street routing for bus, BRT and trolleybus lines

Bus, BRT and trolleybus lines follow streets.

**Drawing a line by its stops.** With the Bus, BRT or Trolleybus tab and **Draw
line**, every click on the map is a stop, in the order the line serves them. Click
at the kerb on the side of the street where the vehicle stops. Esc, Enter, a
right-click or **Finish line** ends the drawing; Backspace removes the last stop,
and fewer than two stops cancel. The line runs one way through the stops and then
returns to the first stop (a one-way loop), so every stop is served from one side
of the street. A click within 60 m of an existing stop of the same mode reuses
that stop; stops of other modes are never shared. A stop keeps its place in the
order even where the route passes it again on the way back.

For one-way lines the router is asked to arrive at and leave every stop with the
stop on the side the vehicle drives on (Valhalla `preferred_side: same`). Where the
stop lies too close to the street centre or to a junction for the side to be
known, Valhalla ignores this request, so check the route on the map.

The waypoints of a line are its stops; more waypoints can be added in the line's
editor to shape the route. Each section between two
waypoints is routed on the street network by a self-hosted
[Valhalla](https://github.com/valhalla/valhalla) server (MIT licence) with its
`bus` costing model.

- A section that is not routed makes the line **incomplete** (an error)
  until it is routed or you **mark it as manual** (an accepted sketch, for example a
  bus-only link missing from the map data).
- Moving a waypoint re-routes the sections next to it automatically when the routing
  service runs; sections whose waypoints did not move keep their route.
- Where one-way streets make the return trip use other streets, the return path is
  stored and drawn separately.
- Waypoints are sent only to your own Valhalla server, never to a third party.

## Enable the routing service

```sh
# .env
MOBSIM_VALHALLA_URL=http://valhalla:8002
# Space-separated OSM extracts for the regions you want to route (Geofabrik, BBBike, …)
VALHALLA_TILE_URLS=https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf
# Pin a release for reproducible deployments
VALHALLA_IMAGE=ghcr.io/valhalla/valhalla-scripted:latest

docker compose --profile routing up -d
docker compose logs -f valhalla   # first start builds routing tiles
```

On the first start Valhalla downloads the extracts and builds routing tiles into
the `valhalla-data` volume: minutes for a city, hours and many gigabytes of RAM for a
large country. Later starts reuse the tiles. To add a region, extend
`VALHALLA_TILE_URLS`, set `force_rebuild` to `True` once (in `docker-compose.yml`)
and restart.

The service is reachable only inside the Compose network. The API contacts exactly
the origin in `MOBSIM_VALHALLA_URL`; the outbound allow-list and private-address
checks for public providers stay in force for every other host.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOBSIM_VALHALLA_URL` | empty (disabled) | Internal Valhalla base URL |
| `MOBSIM_VALHALLA_TIMEOUT_S` | `20` | Per-section request timeout |
| `MOBSIM_ROUTING_MAX_WAYPOINTS` | `50` | Waypoints per request |
| `MOBSIM_ROUTING_CACHE_TTL_S` | `604800` | Cache for routed sections |

## API

`POST /api/v1/routing/route` with `{"waypoints": [[lon, lat], …], "mode": "bus" | "brt" | "trolleybus", "kerbside": false}`
(`kerbside: true` asks for the approach on the waypoint's side of the street; all modes use Valhalla's `bus` costing)
returns one result per section: `status` (`routed` or `failed`), `coordinates`,
`lengthM`, `durationS` and a message, plus provenance (OSM data, ODbL) and a
capability. Without `MOBSIM_VALHALLA_URL` it answers `503` with the capability
`not_configured`, and the editor keeps working: sections stay unrouted and can be
marked manual.

## Limitations

- Valhalla's bus costing uses OSM tags; vehicle length, height and turning space are
  not checked.
- Bus lanes, bus gates and closures count only as far as they are mapped in OSM, and
  the extract may be older than current OSM data.
- Trolleybus lines are routed like bus lines; the overhead-wire network and the
  check for missing wire are not available yet (planned, R4b part 2).
- The animation runs the return trip on the outbound geometry (reversed); the
  separate return path is drawn on the map only.
