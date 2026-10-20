# Service routing

Status: **implemented** for rail services on tracks. Bus and BRT routing on streets
is unchanged ([ROUTING.md](ROUTING.md)).

## Rail services on tracks

A service on tracks is a `TransportLine` with `alignment.kind = 'track'`. The user
chooses its stops in calling order:

- the **New service** tool (click stations, Enter);
- the station list in the tool panel (keyboard);
- the line inspector (add, remove, ▲ ▼).

`domain/serviceRouting.ts` then routes the service:

1. Every stop must be a station with at least one track reference. Otherwise the
   service is unrouted, with a message naming the station.
2. For each pair of consecutive stops, `trackGraph.shortestPath` finds the shortest
   permitted path between any track of the first station and any track of the
   second:
   - it uses Dijkstra over (track, direction);
   - it passes through nodes only along permitted movements;
   - it uses each track only in its permitted running direction.
3. A train does not reverse between stops: after the first leg, every leg departs in
   the direction it arrived. A dynamic programme over (station track, arrival
   direction) picks the combination with the shortest total length.
4. Ring services add the leg from the last stop back to the first.
5. Services in both directions route the way back separately, from the last stop to
   the first. On double track the return therefore uses the other track. When no
   return path exists, the outbound path is kept and a warning names the problem.
6. The steps are merged, and `coordinates` (display and measurements) and
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
- Turnout-aware path costs. A diverging route costs the same as a straight one.
- A pluggable bus routing provider interface beyond the existing Valhalla adapter
  (Priority 2).
