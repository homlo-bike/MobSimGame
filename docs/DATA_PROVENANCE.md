# Data provenance

## Principles

1. Every value shown has an origin: **calculated** from geometry, **entered** by
   the user, **observed/modelled** from a provider, or **assumed** from a labelled
   assumption set. Phase 1 assumptions are all **demonstration** values.
2. No silent defaults. Defaults are documented (`domain/modes.ts`,
   `domain/modeProfiles.ts`, `analysis/demoAssumptions.ts`), carry a `status` and a
   `source`, and are overridable in the inspectors.
3. Missing data is reported as a capability state ("manual input required", "not
   configured", "coverage unavailable"), never filled with synthetic data for a
   real place.
4. Missing OSM tags do not mean a feature does not exist.

## The Provenance record

```ts
{
  provider, dataset, sourceUrl, license, attribution,
  retrievedAt, coverage, datasetDate, spatialResolution,
  status: 'observed' | 'modelled' | 'assumed' | 'calculated' | 'demonstration',
  limitations: string[], cacheExpiresAt, confidence: 'high'|'medium'|'low'|'unknown'
}
```

Defined in `frontend/src/domain/schema.ts` and `backend/app/providers/base.py`.
Projects keep `datasetReferences` (a list of provenance records); analysis results
(`AnalysisResult`) carry provenance, method, formula and assumption ids.

## What is what in Phase 1

| Item | Status | Source |
| --- | --- | --- |
| Line length, station counts, chainages | calculated | Drawn geometry |
| Mode defaults (colour, dwell, max speed, catchment radius) | documented default / placeholder | `domain/modes.ts`; catchment radii cite a common rule of thumb (Guerra, Cervero & Tischler 2012) |
| Vehicle types and capacities | demonstration placeholder | `domain/modes.ts` |
| Mode validation profiles | uncited placeholder (v0.1.0) | `domain/modeProfiles.ts` |
| Right-of-way speed factors | placeholder | `simulation/speeds.ts` |
| All dashboard assumptions | demonstration | `analysis/demoAssumptions.ts` |
| Demo population, traffic, existing transit, elevation, OSM features | demonstration (synthetic) | `providers/mock.ts` |
| Station-name suggestions (real places) | observed (OSM) | Overpass via backend, ODbL |
| Geocoding | observed (OSM) | Nominatim via backend, ODbL |

## Population figures

Must be marked observed, estimated, projected or assumed (`PopulationCell.status`).
CAMARA densities are *estimated* aggregates with min/central/max; demo values are
*demonstration*.

## Traffic figures

Must be time-stamped and marked live, historic, predicted or demonstration
(`TrafficSegment.temporalType`, `observedAt`).

## Attribution

Map attribution is always visible (MapLibre attribution control, not collapsed):
OpenStreetMap contributors, OpenFreeMap/OpenMapTiles when used, terrain sources
when enabled, and the drawing library. Exports (schematic SVG/PNG, HTML report)
include attribution or a generation note. See `THIRD_PARTY_NOTICES.md`.
