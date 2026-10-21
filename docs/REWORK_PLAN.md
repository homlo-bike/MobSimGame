# Rework plan (owner feedback, October 2026)

Status: **in progress**. Each item is its own pull request against `main`. An item
is only available once its pull request is merged; the README and CHANGELOG change
with each one.

## Owner decisions

| Question | Decision |
| --- | --- |
| Changing between modes | Walking links between stations of different modes; stations stay strictly per mode |
| Placing a rail station | Place freely (and move or rotate), then connect track to its ends |
| Standards for curves, junctions, platforms | German: BOStrab and VDV (tram, light rail, metro), EBO (railway). Uncited values stay placeholders |
| Order | Tracks and routing first, then stations, then mode tabs, then the rest |
| Station names | From map labels in the loaded tiles first, then the server lookup, then "Station N" |
| Demo site | A separate small read-only viewer for Cloudflare Pages, reading `projects/<city>/<project>/` |
| Ramps between levels | Maximum gradient cited per mode; tunnel depth and viaduct height as placeholder settings; ground from terrain data |
| Merging | One PR into `main` for the old stack (#14); every new PR targets `main` |
| Trolleybus | Separate mode with its own overhead-wire network; a line without wire is an error |
| Traffic in the simulation | Transit vehicles, signals, track occupancy, following distance and road speeds by time of day; no individual cars |
| Drawing guides | Relative to the last leg; parallel to straight **track** within 100 m of the cursor (no streets); can be switched off |
| Modes | Every mode keeps to its own infrastructure; nothing is shared (tram and light rail included) |
| Same-level intersections | Allowed between any lines, of different or the same mode (crossing or merging into the same street or track); created automatically; the lower-priority vehicle waits until the crossing is clear. Different modes: mode order (commuter rail > metro > light rail > tram > trolleybus > BRT > bus, editable). Same mode: the one closest to the intersection goes first. Buses sharing a street keep the following distance |
| UI conventions | Web GIS style (Felt, Google My Maps, Mapbox Studio): tools in a bar, side panels, right-click menu, Esc cancels, Enter or right-click finishes, Delete removes |

## Items

| # | Item | Status |
| --- | --- | --- |
| R1 | Track drawing: tangent connections (drawing and dragging), loop confirmation, draw mode stays on, connect to track ends and along a track, no jump on click; unrouted services shown as gaps; missing return path is an error | merged (#15) |
| R2 | Drawing guides (relative, parallel to track ≤ 100 m, toggle); curve handles and labels on the map, radius editor with slider; double track edited as a pair | merged (#16) |
| R3 | Station objects: tracks and platforms (side and island platforms, counts ≥ 1), free placement, move and rotate (with guides), platform dimensions, gradient and radius in project settings, platform shorter than the train is an error, station symbols by layout | merged (#17; gradient and curve checks for platforms, and elevator/escalator symbols, follow with R6/R8) |
| R4a | Mode tabs, strict separation, trolleybus mode | merged (#18) |
| R4c | Automatic same-level crossings and merges between any lines (also the same mode) with priority; lower priority waits; buses on a shared street keep their distance | merged (#19; per-crossing priority overrides follow with the project properties page) |
| R4d | Walking links between stations of different modes | merged (#20; shown in the schematic and text view with R11) |
| R4b | Bus, BRT and trolleybus lines by clicking stops in order (one direction, kerb side matters), routed between them, Esc or right-click finishes and the route returns to the first stop; trolleybus wire network | merged (#21, #23: trolleybus wire follows the lines; warning where it crosses rail overhead line) |
| R5 | Turnouts and smooth junctions to VDV/BOStrab | merged (#36: turnouts, diamonds and slips at nodes with Deutsche Bahn standard designs or own values; VDV/BOStrab texts not readable, tram and metro values are user input; crossover objects follow) |
| R6 | Ramps between underground, street level and elevated: length from the gradient and the terrain | merged (#28: ramps from level heights, gradient and station checks, portals; terrain follows) |
| R7 | Trains drawn to scale (length, width, units per consist) | merged (#24) |
| R8 | Station naming from map labels; elevator, escalator and ramp symbols next to station names | merged (#33) |
| R9 | `.env` examples for development, test and production (including `MOBSIM_VALHALLA_URL=http://valhalla:8002`); full export with every calculated value and all metadata; **GTFS export** and **SUMO network/route export** (owner decision: interoperate with SUMO through files, no extra container); later optional import of SUMO vehicle output for playback | merged (#31 environment files and full export; #32 GTFS and SUMO export) |
| R10 | Read-only demo viewer (Cloudflare Pages) | planned |
| R11 | Schematic: select, move, pan and zoom; text alternative as the line with its stations and their symbols | this PR |
| R12 | Project properties listing every default (radii per rail mode, vehicle dimensions, gauge, electrification, platforms, …) with source and status | merged (#25) |
| R13 | Realistic vehicle movement from SUMO's **published models, not its code** (owner decision): acceleration and braking from the vehicle profiles, then car following (Intelligent Driver Model / Krauss, cited); parameters in Project properties; per-crossing priority overrides | merged (#26 acceleration and braking, #27 following); per-crossing overrides not needed (owner) |
| R14a | Rail services stop at **platforms**: (+) on a station track while creating a service, stops list station and track, routes found between platforms, the service returns to its first stop, an error names each pair without a route | merged (#37) |
| R14b | Blocks and route reservation in the simulation (OSRD spacing and routing requirements, blocking-time method): no two trains in one block, track changes only through turnouts, conflict and deadlock findings | this PR (junction zones held by one route at a time, operations report of waits per line and place, track-jump check; signalled block sections follow; merged #38) |
| R15a | Running time from **train physics** (methods of OSRD and NeTrainSim, no code): traction, running resistance, gradient and curves; envelopes with braking curves | merged (#34) |
| R15b | Energy estimate per run (NeTrainSim method: traction energy, regenerative braking, efficiencies), estimated under the selected assumptions | merged (#35) |

Order (owner, 2026-10-21): R15a, R15b, then R5 turnouts, R14a, R14b, R11, R10, then app
settings with OIDC, then the desktop apps.

Order after R4b (owner, 2026-10-20): stop merge distance setting, R4b wire, **R7 next**,
then R12 project properties, R13 vehicle movement, R9 environment files and export (GTFS, SUMO), then R8, R5, R6, R11, R10.

Known limitation: a loop or curve too tight for double track is refused with a
message saying how large it must be (owner: drawing a bigger loop fixes it).
