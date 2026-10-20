/**
 * Project properties: every default the editor and the simulation use, per mode, with
 * where it comes from, plus the per-project defaults for new track. Pure.
 */
import type { Electrification, Scenario, TransportMode } from './schema';
import { MODES } from './modes';
import { CURVE_RADIUS_RULES } from './modeProfiles';
import { isRailMode, newTrackDefaults } from './tracks';
import { following, platformLengthM, type Following } from './trackParameters';
import { MODE_TABS } from './modeSeparation';
import { defaultRates, type Rates } from '../simulation/kinematics';

export interface ModeDefaultRow {
  mode: TransportMode;
  label: string;
  rail: boolean;
  /** Minimum and recommended curve radius (m), with the cited source; null where none is cited. */
  curve: { minimumM: number; recommendedM: number | null; source: string } | null;
  maxSpeedKmh: number;
  dwellTimeS: number;
  catchmentRadiusM: number;
  structure: string;
  rightOfWay: string;
  /** Default platform length (rail), from Project settings. */
  platformLengthM: number | null;
  /** How vehicles keep their distance to the one ahead in the simulation (Parameters). */
  following: Following;
  gaugeMm: number | null;
  electrification: Electrification;
  /** Default acceleration and service braking (m/s²) when a vehicle profile gives none. */
  rates: Rates;
}

/** One row per mode tab (Bus … Commuter rail). */
export function modeDefaultRows(scenario: Scenario): ModeDefaultRow[] {
  const net = scenario.trackNetwork;
  return MODE_TABS.map(({ mode }) => {
    const m = MODES[mode];
    const rule = CURVE_RADIUS_RULES[mode];
    const rail = isRailMode(mode);
    const src = rule?.sources[0];
    return {
      mode,
      label: m.label,
      rail,
      curve: rule
        ? {
            minimumM: rule.minimumM,
            recommendedM: rule.recommendedM,
            source: src ? `${src.title}${src.section ? `, ${src.section}` : ''}` : rule.context,
          }
        : null,
      maxSpeedKmh: m.defaultMaxSpeedKmh,
      dwellTimeS: m.defaultDwellTimeS,
      catchmentRadiusM: m.defaultCatchmentRadiusM,
      structure: m.defaultStructure,
      rightOfWay: m.defaultRightOfWay,
      platformLengthM: rail ? platformLengthM(net, mode) : null,
      following: following(net, mode),
      ...newTrackDefaults(net, mode),
      rates: defaultRates(mode),
    };
  });
}

/** Set the gauge or electrification new track of a mode gets. */
export function setModeTrackDefault(
  scenario: Scenario,
  mode: TransportMode,
  patch: Partial<{ gaugeMm: number | null; electrification: Electrification }>,
): Scenario {
  const net = scenario.trackNetwork;
  const current = newTrackDefaults(net, mode);
  return {
    ...scenario,
    trackNetwork: { ...net, modeDefaults: { ...net.modeDefaults, [mode]: { ...current, ...patch } } },
  };
}

/**
 * Give existing track of a mode the project default where its own value is not specified
 * (values the user set on a track are kept). Returns the scenario and the number of tracks changed.
 */
export function applyModeDefaultsToTracks(
  scenario: Scenario,
  mode: TransportMode,
): { scenario: Scenario; changed: number } {
  const net = scenario.trackNetwork;
  const d = newTrackDefaults(net, mode);
  let changed = 0;
  const tracks = net.tracks.map((t) => {
    if (t.designMode !== mode) return t;
    const gaugeMm = t.gaugeMm ?? d.gaugeMm;
    const electrification = t.electrification === 'unknown' ? d.electrification : t.electrification;
    if (gaugeMm === t.gaugeMm && electrification === t.electrification) return t;
    changed++;
    return { ...t, gaugeMm, electrification };
  });
  return changed
    ? { scenario: { ...scenario, trackNetwork: { ...net, tracks } }, changed }
    : { scenario, changed };
}
