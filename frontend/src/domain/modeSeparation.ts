/**
 * Strict separation of transport modes (owner decision): every track, station and line
 * belongs to one mode, and nothing is shared between modes. Pure.
 */
import type { Scenario, Station, TransportMode } from './schema';

/** Mode of a station: its layout's mode, else the mode of its tracks, else of the lines calling there. */
export function stationMode(scenario: Scenario, station: Station): TransportMode | null {
  if (station.layout) return station.layout.mode;
  const ref = station.trackRefs[0];
  const track = ref ? scenario.trackNetwork.tracks.find((t) => t.id === ref.trackId) : undefined;
  if (track) return track.designMode;
  const line = scenario.lines.find((l) => l.stops.some((s) => s.stationId === station.id));
  return line?.mode ?? null;
}

/** Stations a service of this mode may call at (rail: on track of the mode). */
export function stationsForMode(scenario: Scenario, mode: TransportMode): Station[] {
  return scenario.stations.filter((s) => s.trackRefs.length > 0 && stationMode(scenario, s) === mode);
}

/**
 * Stations listed under a mode tab: those of the mode, plus stations whose mode is not
 * known yet (no layout, track or line), so nothing drops out of every list.
 */
export function stationsOfMode(scenario: Scenario, mode: TransportMode): Station[] {
  return scenario.stations.filter((s) => {
    const m = stationMode(scenario, s);
    return m === null || m === mode;
  });
}

/** The tabs of the editor, one per mode group shown to the user. */
export const MODE_TABS: { mode: TransportMode; label: string }[] = [
  { mode: 'bus', label: 'Bus' },
  { mode: 'brt', label: 'BRT' },
  { mode: 'trolleybus', label: 'Trolleybus' },
  { mode: 'tram', label: 'Tram' },
  { mode: 'light_rail', label: 'Light rail' },
  { mode: 'metro', label: 'Metro' },
  { mode: 'commuter_rail', label: 'Commuter rail' },
];

/** Number of objects of each mode (tracks, stations, lines), for tab badges. */
export function modeCounts(scenario: Scenario): Partial<Record<TransportMode, number>> {
  const out: Partial<Record<TransportMode, number>> = {};
  const inc = (m: TransportMode | null) => {
    if (m) out[m] = (out[m] ?? 0) + 1;
  };
  for (const t of scenario.trackNetwork.tracks) inc(t.designMode);
  for (const l of scenario.lines) inc(l.mode);
  for (const s of scenario.stations) inc(stationMode(scenario, s));
  return out;
}

/** Default priority, highest first (owner decision; editable per project: `scenario.modePriority`). */
export const MODE_PRIORITY: TransportMode[] = [
  'commuter_rail',
  'metro',
  'elevated_metro',
  'light_rail',
  'tram',
  'trolleybus',
  'brt',
  'bus',
  'custom',
];

/** Move a mode one place up (−1) or down (+1) in the project's crossing priority order. */
export function moveModePriority(scenario: Scenario, mode: TransportMode, dir: -1 | 1): Scenario {
  const order = [...(scenario.modePriority ?? MODE_PRIORITY)];
  const i = order.indexOf(mode);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return scenario;
  [order[i], order[j]] = [order[j]!, order[i]!];
  return { ...scenario, modePriority: order };
}
