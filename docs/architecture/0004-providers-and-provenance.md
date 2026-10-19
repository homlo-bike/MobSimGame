# ADR 0004 — Provider interfaces, provenance and capability states

- Status: accepted
- Date: 2026-10-19

## Decision

- All external data goes through provider interfaces (frontend
  `providers/types.ts`; backend `app/providers/`). Thirteen kinds are defined:
  basemap, OSM features, geocoder, traffic, population, elevation, terrain,
  transit, routing, air quality, emission factors, cost benchmarks, property value.
- Every response carries `Provenance` (provider, dataset, source URL, licence,
  attribution, retrieval time, coverage, dataset date, resolution, status
  observed/modelled/assumed/calculated/demonstration, limitations, cache expiry,
  confidence) and a `Capability` (available, authentication required, coverage
  unavailable, rate limited, temporarily unavailable, using cache, using fallback,
  manual input required, not configured, demonstration).
- Credentialed or policy-sensitive providers run on the backend only; browser
  code may read only whitelisted public `VITE_*` variables (enforced by a unit test
  and a bundle scan).
- Synthetic mock providers are used **only for fictional projects**. Real-place
  projects never show synthetic population/traffic/transit overlays; they report
  "manual input required" instead.
- Outbound requests: https only, host allowlist, private-address rejection,
  timeouts, retry with exponential backoff (honouring `Retry-After`), caching.
