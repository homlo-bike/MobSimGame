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
