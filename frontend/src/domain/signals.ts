/**
 * Road traffic signals that trams and buses obey in the simulation.
 * Positions come from OpenStreetMap; timings are assumptions (see SignalSettings).
 */
import type { LngLat, Scenario, TrafficSignal, TransportLine } from './schema';
import { isRing } from './network';
import { newId, nowIso } from '../util/id';

/** Modes that run on streets and stop at road traffic signals. */
export const SIGNAL_MODES: TransportLine['mode'][] = ['tram', 'bus', 'brt', 'light_rail'];

export function signalLines(scenario: Scenario): TransportLine[] {
  return scenario.lines.filter(
    (l) => SIGNAL_MODES.includes(l.mode) && l.segments.some((s) => s.structure === 'at_grade'),
  );
}

/** Paths to search along: at-grade lines only (signals do not apply in tunnels or on viaducts). */
export function signalSearchPaths(scenario: Scenario, maxPoints = 20000): LngLat[][] {
  const paths = signalLines(scenario).map((l) => {
    const c = l.coordinates;
    return isRing(l) && c.length > 2 ? [...c, c[0]!] : c;
  });
  const total = paths.reduce((n, p) => n + p.length, 0);
  // Thin very dense paths so the request stays within the server's limit.
  const step = Math.max(1, Math.ceil(total / maxPoints));
  return paths
    .map((p) => p.filter((_, i) => i % step === 0 || i === p.length - 1))
    .filter((p) => p.length >= 2);
}

/** Offsets are unknown: spread them deterministically from the signal's id so signals are not all in phase. */
export function offsetFor(id: string, cycleS: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % Math.max(1, Math.round(cycleS));
}

/** Add OSM signals not yet in the scenario, with the scenario's assumed timings. */
export function addSignals(scenario: Scenario, found: { id: string; position: LngLat }[]): Scenario {
  const known = new Set(scenario.trafficSignals.map((s) => s.ref));
  const { defaultCycleS, defaultGreenS, status } = scenario.signalSettings;
  const added: TrafficSignal[] = found
    .filter((f) => !known.has(f.id))
    .map((f) => ({
      id: newId('sig'),
      position: f.position,
      ref: f.id,
      cycleS: defaultCycleS,
      greenS: Math.min(defaultGreenS, defaultCycleS),
      offsetS: offsetFor(f.id, defaultCycleS),
      timingStatus: status,
    }));
  return { ...scenario, trafficSignals: [...scenario.trafficSignals, ...added], updatedAt: nowIso() };
}

export function updateSignal(scenario: Scenario, id: string, patch: Partial<TrafficSignal>): Scenario {
  return {
    ...scenario,
    trafficSignals: scenario.trafficSignals.map((s) =>
      s.id === id ? { ...s, ...patch, id: s.id, timingStatus: 'user_override' } : s,
    ),
    updatedAt: nowIso(),
  };
}

export function removeSignal(scenario: Scenario, id: string): Scenario {
  return {
    ...scenario,
    trafficSignals: scenario.trafficSignals.filter((s) => s.id !== id),
    updatedAt: nowIso(),
  };
}

/** Apply new default timings to every signal the user has not edited individually. */
export function applySignalDefaults(scenario: Scenario, settings: Scenario['signalSettings']): Scenario {
  return {
    ...scenario,
    signalSettings: settings,
    trafficSignals: scenario.trafficSignals.map((s) =>
      s.timingStatus === 'user_override'
        ? s
        : {
            ...s,
            cycleS: settings.defaultCycleS,
            greenS: Math.min(settings.defaultGreenS, settings.defaultCycleS),
            offsetS: offsetFor(s.ref ?? s.id, settings.defaultCycleS),
            timingStatus: settings.status,
          },
    ),
    updatedAt: nowIso(),
  };
}

/** Whether a signal shows green at simulated time t. */
export function isGreen(signal: Pick<TrafficSignal, 'cycleS' | 'greenS' | 'offsetS'>, tS: number): boolean {
  const inCycle = (((tS - signal.offsetS) % signal.cycleS) + signal.cycleS) % signal.cycleS;
  return inCycle < signal.greenS;
}
