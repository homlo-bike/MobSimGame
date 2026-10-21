# Service routing

Status: **implemented** for rail services on tracks. Bus and BRT routing on streets
is unchanged ([ROUTING.md](ROUTING.md)).

## Rail services on tracks

A service on tracks is a `TransportLine` with `alignment.kind = 'track'`. The user
chooses its stops in calling order:

- the **New service** tool: click stations, or, zoomed in (from zoom 15), click the
  **(+)** on one of a station's platform tracks to call at that platform; Enter
  creates the service. A station's (+) markers fan out across its tracks in the
  order of the tracks; a picked platform shows its stop number;
- the station list in the tool panel (keyboard), with a **Platform** choice per stop
  where the station has more than one track;
- the line inspector (add, remove, ▲ ▼, platform per stop).

Each stop (`line.stops[i]`) names its station and, optionally, its platform track
(`trackId`, R14a); without one the router picks the platform.

**After the last stop** (tool panel): *return to the first stop* (default) makes the
service run from its last stop back to its first stop's platform, as a loop with no
stops on the way back unless they are listed; *run back calling at the same
stations* keeps the earlier two-direction service.

`domain/serviceRouting.ts` then routes the service:

1. Every stop must be a station with at least one track reference, and a chosen
   platform track must still be one of the station's tracks. Otherwise the service
   is unrouted, with a message naming the station.
2. A stop with a platform track routes to and from that track only.
3. For each pair of consecutive stops, `trackGraph.shortestPath` finds the shortest
   permitted path between any track of the first station and any track of the
   second:
   - it uses Dijkstra over (track, direction);
   - it passes through nodes only along permitted movements;
   - it uses each track only in its permitted running direction.
4. A train does not reverse between stops: after the first leg, every leg departs in
   the direction it arrived. A dynamic programme over (station track, arrival
   direction) picks the combination with the shortest total length.
5. Services that return to the first stop (and ring services) add the leg from the
   last stop back to the first stop's platform. If that is impossible without
   reversing, the train reverses at the last stop (a turnback), and the route says
   so. If there is no permitted path at all (for example one-way double track with no
   crossover at the end), the service is unrouted and the message names the last and
   first stop and suggests a crossover or turning loop, or running back.
6. Services in both directions route the way back separately, from the last stop to
   the first, with the router choosing the platforms for that direction. On double
   track the return therefore uses the other track. When no return path exists, the
   outbound path is kept and a warning names the problem.
7. No route between two stops is an error naming both stops and their platforms.
8. The steps are merged, and `coordinates` (display and measurements) and
   `segments` (structure, right of way, single or double track, speed limit) are
   derived from the tracks.

Services are routed again automatically when any of these change:

- their stops;
- a station's tracks;
- the geometry of a track they use;
- a node's movements;
- a deletion with the *reroute* choice.

An unrouted service is an error. The line stays visible as a thin sketch
between its stops.

## Deleting track that services use

See the deletion choices in [TRACK_ARCHITECTURE.md](TRACK_ARCHITECTURE.md#editing-rules)
(cancel, reroute, break, delete services). `deleteTrackWithServices` implements
them, and unit tests cover each choice.

## Not implemented yet

- Routing preferences (avoid single track, prefer a track) and via points.
- Blocks and route reservation in the simulation, so trains never share a block and
  change track only through turnouts (R14b).
- Turnout-aware path costs. A diverging route costs the same as a straight one.
- A pluggable bus routing provider interface beyond the existing Valhalla adapter
  (Priority 2).
