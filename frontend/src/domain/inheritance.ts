/**
 * Project settings are the global values; each line and track either follows them or
 * keeps its own value (G1). Pure.
 *
 * An item lists the fields it inherits (`inherits`); its stored value is kept in step
 * with the project setting, so every reader sees the value in force. Changing a project
 * setting updates every item that inherits it; overriding a field removes it from the
 * list and keeps the value the user enters.
 */
import type { Electrification, PhysicalTrack, Scenario, TransportLine, TransportMode } from './schema';
import { MODES } from './modes';
import { newTrackDefaults } from './tracks';

export type LineSetting = TransportLine['inherits'][number];
export type TrackSetting = PhysicalTrack['inherits'][number];

/** Project value of a line setting for a mode: the project's entry, else the built-in default. */
export function modeSetting(
  scenario: Pick<Scenario, 'trackNetwork'>,
  mode: TransportMode,
  key: LineSetting,
): number {
  const d = scenario.trackNetwork.modeDefaults?.[mode];
  if (key === 'dwellTimeS') return d?.dwellTimeS ?? MODES[mode].defaultDwellTimeS;
  return d?.maxSpeedKmh ?? MODES[mode].defaultMaxSpeedKmh;
}

/** Project value of a track setting for a mode. */
export function trackSetting(
  scenario: Pick<Scenario, 'trackNetwork'>,
  mode: TransportMode,
  key: TrackSetting,
): number | null | Electrification {
  return newTrackDefaults(scenario.trackNetwork, mode)[key];
}

/** Every inheriting field of every line and track set to the project value. */
export function syncInherited(scenario: Scenario): Scenario {
  let changed = false;
  const lines = scenario.lines.map((l) => {
    if (!l.inherits.length) return l;
    const next = { ...l };
    for (const k of l.inherits) next[k] = modeSetting(scenario, l.mode, k);
    if (l.inherits.every((k) => next[k] === l[k])) return l;
    changed = true;
    return next;
  });
  const net = scenario.trackNetwork;
  const tracks = net.tracks.map((t) => {
    if (!t.inherits.length) return t;
    const d = newTrackDefaults(net, t.designMode);
    const next = { ...t, ...Object.fromEntries(t.inherits.map((k) => [k, d[k]])) } as PhysicalTrack;
    if (t.inherits.every((k) => next[k] === t[k])) return t;
    changed = true;
    return next;
  });
  return changed ? { ...scenario, lines, trackNetwork: { ...net, tracks } } : scenario;
}

/** Set a project setting of a mode and update everything that inherits it. */
export function setModeSetting(
  scenario: Scenario,
  mode: TransportMode,
  patch: Partial<{ maxSpeedKmh: number | null; dwellTimeS: number | null }>,
): Scenario {
  const net = scenario.trackNetwork;
  const cur = net.modeDefaults[mode] ?? {
    ...newTrackDefaults(net, mode),
    maxSpeedKmh: null,
    dwellTimeS: null,
  };
  return syncInherited({
    ...scenario,
    trackNetwork: { ...net, modeDefaults: { ...net.modeDefaults, [mode]: { ...cur, ...patch } } },
  });
}

/** A line follows the project for `key` again (true) or keeps its current value as its own (false). */
export function setLineInherits(
  scenario: Scenario,
  lineId: string,
  key: LineSetting,
  inherit: boolean,
): Scenario {
  const lines = scenario.lines.map((l) => {
    if (l.id !== lineId) return l;
    const inherits = inherit ? [...new Set([...l.inherits, key])] : l.inherits.filter((k) => k !== key);
    return { ...l, inherits };
  });
  return syncInherited({ ...scenario, lines });
}

/** A track follows the project for `key` again (true) or keeps its value as its own (false). */
export function setTrackInherits(
  scenario: Scenario,
  trackId: string,
  key: TrackSetting,
  inherit: boolean,
): Scenario {
  const net = scenario.trackNetwork;
  const tracks = net.tracks.map((t) => {
    if (t.id !== trackId) return t;
    const inherits = inherit ? [...new Set([...t.inherits, key])] : t.inherits.filter((k) => k !== key);
    return { ...t, inherits };
  });
  return syncInherited({ ...scenario, trackNetwork: { ...net, tracks } });
}
