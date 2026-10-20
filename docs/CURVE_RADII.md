# Horizontal curve radii

Track-guided lines (tram, light rail, metro, commuter rail) are checked against
**documented default** minimum and recommended curve radii, reviewed and approved by
the project owner on 2026-10-19. Below the minimum is a **blocking** finding;
below the recommended value a **warning**. Lines imported from OpenStreetMap and not
edited are existing infrastructure: their findings are **information** only.

Values are defined in `frontend/src/domain/modeProfiles.ts` (`CURVE_RADIUS_RULES`).

| Mode | Minimum (blocking) | Recommended (warning) | Source |
| --- | --- | --- | --- |
| Tram / streetcar | 25 m | none cited (not checked) | TCRP Report 155, 2nd ed. (2012), §3.2.3.2, p. 3-11 |
| Light rail | 90 m ballasted; 25 m on street sections (embedded or direct-fixation track) | 150 m | TCRP Report 155 (2012), §3.2.3.2, p. 3-13 |
| Metro and elevated metro | 120 m | 200 m; 1000 m at stations | Mumbai Metro Line 12 DPR (MMRDA / DMRC, 2019), Table 4.1, p. 123 |
| Commuter rail | 150 m | 300 m | RSSB GCRT5021 Issue 6 (2023) §2.5.1.1 Table 1 (exceptional limit, passenger lines); EBO §6(1) (target for new main lines) |
| Bus, BRT, cycling, walking, custom | not checked | not checked | — |

"Street sections" for light rail are surface segments whose right of way is not a
dedicated track.

## Quotes

- **TCRP 155 §3.2.3.2 p. 3-11:** "the most common absolute minimum radius is 82 feet
  [25 meters]… The use of curves tighter than 82 feet [25 meters] is therefore strongly
  discouraged."
- **TCRP 155 §3.2.3.2 p. 3-13:** "At-Grade Acceptable Minimum. Greater of • 500 feet
  [150 meters]… Ballasted At-Grade Track, Absolute Minimum. • 300 feet [90 meters]…
  Embedded Track or Direct Fixation Track, Absolute Minimum. Lesser of • 82 feet
  [25 meters]"
- **Mumbai Metro Line 12 DPR, Table 4.1:** "Desirable Minimum radius 200m … Absolute
  minimum radius 120m* … Minimum curve radius at stations 1000m"
- **RSSB GCRT5021 Issue 6, Table 1:** "Passenger lines 200 150" (normal / exceptional
  minimum radius, metres)
- **EBO §6(1):** "Der Bogenradius in durchgehenden Hauptgleisen soll bei Neubauten nicht
  weniger als 300 m | 180 m betragen." (Hauptbahnen | Nebenbahnen)

## Sources

- Transportation Research Board, *TCRP Report 155: Track Design Handbook for Light Rail
  Transit*, 2nd ed., 2012. <https://nap.nationalacademies.org/22800>
- MMRDA (prepared by DMRC), *Detailed Project Report, Mumbai Metro Line 12
  (Kalyan–Taloja)*, April 2019.
  <https://images.assettype.com/publicpressjournal/2023-01/97e367b3-1860-4de9-b048-ed973272c4ae/Metro_Line_12.pdf>
- RSSB, *GCRT5021 Track System Requirements*, Issue 6, December 2023 (read from the RSSB
  consultation portal copy).
- *Eisenbahn-Bau- und Betriebsordnung (EBO)* §6. <https://www.gesetze-im-internet.de/ebo/__6.html>

## Caveats

- The metro values come from one project's design basis (an elevated metro in India),
  not from a national standard; no free national metro standard was found.
- The commuter-rail values combine a British exceptional limit with a German target for
  new construction.
- No cited recommended value was found for street-running trams (UK ORR guidance and
  BOStrab §15 give none), so only the tram minimum is checked.
- Radii are design inputs on the physical tracks (circular arcs, see
  [TRACK_GEOMETRY.md](TRACK_GEOMETRY.md)) and are checked exactly on every arc. On
  double track the inner track is checked on its own: the radius entered when drawing
  double track is the inner track's, and new double track uses the cited value for the
  inner track by default. There are no transition curves or cant.
- Real networks (Paris Métro, London Underground, historic tram networks) have curves
  well below these values; that is why imported lines are reported as information.
