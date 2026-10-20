/** Test helpers: rail services built the way the editor builds them (tracks → stations → service). */
import type { LngLat, Scenario, TransportLine, TransportMode } from '../../domain/schema';
import { createLine, emptyScenario } from '../../domain/network';
import { createTracks } from '../../domain/tracks';
import { createFrame } from '../../geo/track/projection';
import { addStationOnTracks, setServiceStops } from '../../domain/serviceRouting';

export interface RailLineOptions {
  double?: boolean;
  radiusM?: number | null;
  ring?: boolean;
  name?: string;
  scenario?: Scenario;
}

/** Draw track through `points`, place stations at `stations` and route a service through them in order. */
export function railLine(
  points: LngLat[],
  mode: TransportMode = 'tram',
  stations: LngLat[] = [],
  options: RailLineOptions = {},
): { s: Scenario; line: TransportLine; trackIds: string[] } {
  let s = options.scenario ?? emptyScenario();
  const created = createTracks(s, {
    points,
    mode,
    double: options.double ?? true,
    radiusM: options.radiusM,
  });
  if (created.error) throw new Error(created.error);
  s = created.scenario;
  const ids: string[] = [];
  for (const p of stations) {
    const r = addStationOnTracks(s, p, { mode });
    if (r.error) throw new Error(r.error);
    s = r.scenario;
    ids.push(r.station!.id);
  }
  const c = createLine(s, {
    coordinates: stations.length >= 2 ? stations : points,
    mode,
    ring: options.ring ?? false,
    name: options.name,
  });
  s = setServiceStops(c.scenario, c.line.id, ids);
  return { s, line: s.lines.find((l) => l.id === c.line.id)!, trackIds: created.trackIds };
}

const frame = createFrame([0, 0]);
/** A point x metres east and y metres north of 0°N 0°E (exact, via the project frame). */
export const xy = (x: number, y: number): LngLat => frame.toLngLat([x, y]);
