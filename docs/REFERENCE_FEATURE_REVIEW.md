# Reference feature review

Reviewed on 2026-10-19 from the public pages only:

- **MetroSystem** — <https://metrosystemgame.com/>. A JavaScript app; the static page
  exposes little text (UI labels in Portuguese/English). No licence, terms or
  source-code link was found on the page.
- **CartoMaps / Mapeando** — <https://mapeandometro.vercel.app/en.html> (plus its
  About and Terms pages). Terms (updated September 2026) state "© 2026 CartoMaps …
  All rights reserved" and prohibit reproducing the platform's source code; no
  open-source licence was found.

**Legal position:** neither app is open source. MobSimGame copies no code, assets,
text, branding, data, styles or distinctive interface from them. Only general,
unprotectable feature *ideas* common to map editors are evaluated below and
implemented independently. No feature parity is claimed.

Legend — Seen: *UI* = visible in UI text, *Stated* = described in page text,
*Not found* = not visible in what could be read (it may still exist in the app).

| Feature (concept) | Seen in | MobSimGame? | Legal notes | Independent implementation | Phase |
| --- | --- | --- | --- | --- | --- |
| Multiple systems / layers | MetroSystem (UI: add layer) | Yes | Generic concept | `TransportSystem` entities in the schema; layer UI later | 1 (model), 2 (UI) |
| Drawing multiple lines | CartoMaps (UI) | Yes | Generic | maplibre-gl-draw line tool | 1 ✔ |
| Line names and colours | CartoMaps (UI) | Yes | Generic | Line inspector | 1 ✔ |
| Transit-mode line styles | CartoMaps (UI) | Yes | Do not copy their style table | Own mode list and structure dash patterns | 1 ✔ |
| Adding stations | CartoMaps (UI) | Yes | Generic | Click-to-snap and chainage entry | 1 ✔ |
| Interchanges / transfers | CartoMaps (UI) | Yes | Do not copy "capsule" artwork | Shared station entities; own schematic symbols | 1 ✔ |
| Branches / forks | CartoMaps (UI) | Yes | Generic | Separate lines sharing stations; shared-track records | 1 (basic) |
| Circular / ring lines | Not found | Yes | — | `termination: ring`, validation and animation | 1 ✔ |
| Single / double track | Not found | Yes | — | Per-segment `tracks` | 1 ✔ |
| Left/right-hand running | Not found | Yes | — | `runningSide` (stored; rendering offsets Phase 5) | 1 (data) |
| Animated trains with speed controls | MetroSystem (UI: trains, 1×–25×) | Yes | Generic | Time-based engine, 1×–300× | 1 ✔ |
| Multiple map styles | MetroSystem (UI: map/light/dark/satellite) | Yes | Use only licensed tile sources | OpenFreeMap styles, offline plain and high-contrast | 1 ✔ (no satellite) |
| Fit to network | MetroSystem (UI) | Yes | Generic | "Zoom to line" now; whole network later | 1 (per line) |
| Network statistics (length, stations, transfers) | Not found | Yes | — | Lists and dashboard tiles | 1 ✔ |
| Cost estimate / cost parameters | MetroSystem (UI) | Yes, transparent | Do not reuse their parameters | Demo assumptions now; editable versioned sets later | 1 (demo), 4 |
| Import/export JSON, GeoJSON | MetroSystem (UI) | Yes | Own formats | Project JSON (Zod schema), GeoJSON, CSV | 1 ✔ |
| Example network | MetroSystem (UI: real-city example) | Yes, fictional only | Do not reuse their data | Synthetic fictional city | 1 ✔ |
| Undo / redo | CartoMaps (UI) | Yes | Generic | Store history | 1 ✔ |
| Grid snapping (0/45/90°) | CartoMaps (UI) | Yes (schematic) | Generic | Octilinear schematic layout | 1 (PoC) |
| Label styling, symbols, fonts | CartoMaps (UI) | Partly | Must not copy typography/branding | Original minimal schematic style | 5 |
| Hydrography drawing | CartoMaps (UI) | No (use OSM data) | — | Water from basemap/OSM | — |
| Timeline / opening years | CartoMaps (UI) | Later | Generic | Scenario dates or line opening year field | 4–5 |
| High-resolution vector export | CartoMaps (Stated) | Yes | Generic | SVG/PNG schematic export | 1 ✔ |
| Line / station inspectors | CartoMaps (UI) | Yes | Generic | Own inspector panels | 1 ✔ |
| Search | Not found | Yes | Respect Nominatim policy | Submit-only search via backend | 1 ✔ |
| Save / load / sharing | Both (UI: import/export, save) | Yes | — | Local storage, files, share links | 1 ✔ |
| Paid downloads / print orders | CartoMaps (UI) | No | — | Not planned (open-source tool) | — |
| Accounts | Not found | Later | — | Authentication-ready backend | 5 |

## Areas where MobSimGame deliberately differs

- Real geography first, with validation findings, provenance and ranges.
- Every estimate is labelled with assumptions and status; the demo is fictional.
