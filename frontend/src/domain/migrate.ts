/**
 * Upgrades stored project documents to the current schema version before they
 * are validated. Works on plain JSON so old files never need the old types.
 *
 * v1 → v2: lines gain an explicit alignment. Existing track-guided lines (tram,
 * light rail, metro, rail) become smooth curves through their old vertices;
 * bus and BRT lines become street-routed lines whose legs are unrouted until
 * they are routed or marked manual; everything else keeps straight segments.
 */
import type { LngLat, TransportMode } from './schema';
import { SCHEMA_VERSION } from './schema';
import { buildAlignment, defaultAlignmentKind } from './alignment';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function migrateLineV1(line: Json): Json {
  if ('alignment' in line) return line;
  const coords = Array.isArray(line.coordinates) ? (line.coordinates as LngLat[]) : [];
  const ring = isObj(line.termination) && line.termination.kind === 'ring';
  const kind = defaultAlignmentKind(line.mode as TransportMode);
  const { alignment, coordinates } = buildAlignment(kind, coords, ring);
  return { ...line, alignment, coordinates };
}

export function migrateProjectData(data: unknown): unknown {
  if (!isObj(data)) return data;
  const version = data.schemaVersion;
  if (version === SCHEMA_VERSION || typeof version !== 'number' || version > SCHEMA_VERSION) return data;
  let out: Json = data;
  if (version === 1) {
    out = {
      ...out,
      schemaVersion: 2,
      scenarios: Array.isArray(out.scenarios)
        ? out.scenarios.map((sc) =>
            isObj(sc) && Array.isArray(sc.lines)
              ? { ...sc, lines: sc.lines.map((l) => (isObj(l) ? migrateLineV1(l) : l)) }
              : sc,
          )
        : out.scenarios,
    };
  }
  return out;
}
