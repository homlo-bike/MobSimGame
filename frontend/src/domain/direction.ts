/**
 * Plain-language description of a line's direction of travel, for inspectors,
 * tables and text alternatives (direction must never be shown by arrows alone).
 */
import type { LngLat, Scenario, TransportLine } from './schema';
import { isRing, orderedStops } from './network';

/** Signed area (shoelace, local equirectangular metres): positive = anticlockwise. */
function signedArea(coords: readonly LngLat[]): number {
  if (coords.length < 3) return 0;
  const lat0 = (coords[0]![1] * Math.PI) / 180;
  const k = Math.cos(lat0);
  let a = 0;
  for (let i = 0; i < coords.length; i++) {
    const p = coords[i]!;
    const q = coords[(i + 1) % coords.length]!;
    a += p[0] * k * q[1] - q[0] * k * p[1];
  }
  return a / 2;
}

/** Stops in calling order (track services keep the user's order; others follow the geometry). */
function stopNames(line: TransportLine, scenario: Scenario): string[] {
  if (line.alignment.kind === 'track') {
    const byId = new Map(scenario.stations.map((s) => [s.id, s.name]));
    return line.stops.map((s) => byId.get(s.stationId)).filter((n): n is string => !!n);
  }
  return orderedStops(line, scenario.stations).map((s) => s.station.name);
}

export function describeDirection(line: TransportLine, scenario: Scenario): string {
  const names = stopNames(line, scenario);
  const first = names[0];
  const last = names[names.length - 1];
  if (isRing(line)) {
    const sense = signedArea(line.coordinates) > 0 ? 'anticlockwise' : 'clockwise';
    if (line.direction === 'one_way') return `One-way ring, ${sense}${first ? `, from ${first}` : ''}.`;
    return `Ring in both directions (${sense} and the reverse).`;
  }
  const between = first && last && first !== last ? { first, last } : null;
  if (line.direction === 'one_way')
    return between ? `One-way from ${between.first} to ${between.last}.` : 'One-way, in the drawn direction.';
  const back =
    line.alignment.kind === 'track' && line.alignment.returnPath?.length
      ? ' The way back uses its own track where there is double track.'
      : '';
  return between
    ? `Both directions between ${between.first} and ${between.last}.${back}`
    : `Both directions.${back}`;
}
