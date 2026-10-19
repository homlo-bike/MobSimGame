/**
 * Deterministic illustrative vehicle simulation.
 *
 * This is an operational animation, not a railway or traffic simulator:
 * vehicles run at constant speed per segment (no acceleration, no train
 * protection, no conflicts between vehicles), dwell a fixed time at each stop,
 * lay over at terminals, wait at road traffic signals on red (simulated cycles
 * with assumed timings) and follow a simplified closure model (turn back at
 * crossovers, or a worst-case wait for single-track working).
 *
 * Vehicle state is a pure function of simulated time, so rendering frame rate
 * never affects where vehicles are. The map layer only samples `vehicleStates`.
 */
import type { LngLat, Scenario, TransportLine } from '../domain/schema';
import { isRing, orderedStops, placedCrossovers } from '../domain/network';
import { pathCoordinates, snapToPath } from '../geo/geometry';
import { segmentSpeedKmh } from './speeds';
import { SIGNAL_MODES } from '../domain/signals';

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

function haversineM(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Path with cumulative chainage for fast interpolation. */
export interface MeasuredPath {
  coords: LngLat[];
  cumulative: number[];
  lengthM: number;
}

export function measurePath(coords: readonly LngLat[], ring: boolean): MeasuredPath {
  const path = pathCoordinates(coords, ring);
  const cumulative = [0];
  for (let i = 1; i < path.length; i++)
    cumulative.push(cumulative[i - 1]! + haversineM(path[i - 1]!, path[i]!));
  return { coords: path, cumulative, lengthM: cumulative[cumulative.length - 1] ?? 0 };
}

export function interpolate(path: MeasuredPath, chainageM: number): { position: LngLat; bearingDeg: number } {
  const c = Math.min(path.lengthM, Math.max(0, chainageM));
  let lo = 0;
  let hi = path.cumulative.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.cumulative[mid]! <= c) lo = mid;
    else hi = mid;
  }
  const a = path.coords[lo]!;
  const b = path.coords[hi] ?? a;
  const segLen = path.cumulative[hi]! - path.cumulative[lo]!;
  const t = segLen > 0 ? (c - path.cumulative[lo]!) / segLen : 0;
  const bearing = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  return { position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearingDeg: bearing };
}

export type Phase =
  | { kind: 'dwell' | 'layover' | 'hold' | 'signal'; durationS: number; chainageM: number; direction: 1 | -1 }
  | { kind: 'run'; durationS: number; fromM: number; toM: number; direction: 1 | -1 };

/** Something a vehicle waits for at a chainage, in one or both directions. */
interface StopEvent {
  chainageM: number;
  kind: 'dwell' | 'hold' | 'signal';
  /** Direction it applies to; 0 = both. */
  direction: 1 | -1 | 0;
  durationS?: number;
  signal?: SignalTiming;
}

/** Signal timing used by the simulation (seconds). */
export interface SignalTiming {
  cycleS: number;
  greenS: number;
  offsetS: number;
}

/**
 * One service of a line: vehicles run between `startM` and `endM` of the line's
 * path. A line normally has one service; a closure splits it into the parts
 * that can still turn back at a crossover.
 */
export interface ServiceModel {
  id: string;
  startM: number;
  endM: number;
  /** ring: circulate; shuttle: out and back; one_way: forward, then out of service. */
  pattern: 'ring' | 'shuttle' | 'one_way';
  events: StopEvent[];
  layoverS: number;
}

export interface LineSimulationModel {
  lineId: string;
  color: string;
  path: MeasuredPath;
  headwayS: number;
  services: ServiceModel[];
  /** Transit signal priority: reduces each red wait by this many seconds (0 = off). */
  signalPriorityS: number;
  speedAt: (fromM: number, toM: number) => number;
  /** Explanations for the UI, e.g. why part of a closed line has no service. */
  notes: string[];
  /** Upper bound of a trip's duration, for finding active trips. */
  maxTripS: number;
  /** Memoised trip phases per service and trip index. */
  cache: Map<string, Phase[]>;
}

export interface VehicleState {
  id: string;
  lineId: string;
  color: string;
  chainageM: number;
  position: LngLat;
  bearingDeg: number;
  direction: 1 | -1;
  state: 'running' | 'dwelling' | 'layover' | 'waiting';
}

/** Running time over [fromM, toM] using piecewise-constant segment speeds. */
function runTimeS(line: TransportLine, lengthM: number, fromM: number, toM: number): number {
  const lo = Math.min(fromM, toM);
  const hi = Math.max(fromM, toM);
  let t = 0;
  for (const seg of line.segments) {
    const a = Math.max(lo, seg.fromFraction * lengthM);
    const b = Math.min(hi, seg.toFraction * lengthM);
    if (b > a) t += (b - a) / (segmentSpeedKmh(line, seg) / 3.6);
  }
  return t;
}

/** A closed section between two stations of a line. */
export interface ClosureInput {
  lineId: string;
  fromStationId: string;
  toStationId: string;
  kind: 'turnback' | 'single_track';
}

export interface SignalInput extends SignalTiming {
  position: LngLat;
}

export interface SimulationOptions {
  layoverS?: number;
  /** Use off-peak headways instead of peak. */
  offPeak?: boolean;
  closures?: readonly ClosureInput[];
  signals?: readonly SignalInput[];
  /** Seconds by which transit signal priority shortens a red wait (placeholder assumption). */
  signalPriorityS?: number;
  /** Signals within this distance of a tram or bus line apply to it. */
  signalMatchToleranceM?: number;
}

export function buildLineModel(
  line: TransportLine,
  scenario: Scenario,
  options: SimulationOptions = {},
): LineSimulationModel | null {
  const ring = isRing(line);
  const path = measurePath(line.coordinates, ring);
  if (path.lengthM <= 0) return null;
  const layoverS = options.layoverS ?? 120;
  const ordered = orderedStops(line, scenario.stations);
  const stopAt = new Map(
    ordered.map((s) => [s.station.id, Math.min(path.lengthM, Math.max(0, s.fraction * path.lengthM))]),
  );
  const pattern = line.servicePatterns[0];
  const headwayS = ((options.offPeak ? pattern?.offPeakHeadwayMin : pattern?.peakHeadwayMin) ?? 10) * 60;
  const speedAt = (a: number, b: number) => runTimeS(line, path.lengthM, a, b);

  const events: StopEvent[] = [];
  if (line.dwellTimeS > 0)
    for (const c of stopAt.values())
      events.push({ chainageM: c, kind: 'dwell', direction: 0, durationS: line.dwellTimeS });
  if (SIGNAL_MODES.includes(line.mode)) {
    const tol = options.signalMatchToleranceM ?? 20;
    for (const sig of options.signals ?? []) {
      const snap = snapToPath(line.coordinates, ring, sig.position);
      if (!snap || snap.offsetM > tol) continue;
      // Road signals apply on street-level track only, not in tunnels or on viaducts.
      const seg = line.segments.find((x) => snap.fraction >= x.fromFraction && snap.fraction <= x.toFraction);
      if (seg && seg.structure !== 'at_grade') continue;
      events.push({ chainageM: snap.fraction * path.lengthM, kind: 'signal', direction: 0, signal: sig });
    }
  }
  const signalCount = events.filter((e) => e.kind === 'signal').length;
  const maxSignalWait = (options.signals ?? []).reduce((m, s) => Math.max(m, s.cycleS), 0);

  const notes: string[] = [];
  const services: ServiceModel[] = [];
  const closure = (options.closures ?? []).find((c) => c.lineId === line.id);
  const crossovers = placedCrossovers(line, scenario.stations).map((c) => c.chainageM);
  const base = (startM: number, endM: number, id: string, extra: StopEvent[] = []): ServiceModel => ({
    id,
    startM,
    endM,
    pattern: ring ? 'ring' : line.direction === 'one_way' ? 'one_way' : 'shuttle',
    events: [...events.filter((e) => e.chainageM >= startM - 0.01 && e.chainageM <= endM + 0.01), ...extra],
    layoverS,
  });

  const a = closure ? stopAt.get(closure.fromStationId) : undefined;
  const b = closure ? stopAt.get(closure.toStationId) : undefined;
  if (closure && a !== undefined && b !== undefined && !ring && line.direction === 'bidirectional') {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    // Trains can reverse at the line ends and at crossovers outside the closed section.
    const westTurn = Math.max(...[0, ...crossovers].filter((c) => c <= lo));
    const eastTurn = Math.min(...[path.lengthM, ...crossovers].filter((c) => c >= hi));
    const westHasCrossover = crossovers.some((c) => c <= lo);
    const eastHasCrossover = crossovers.some((c) => c >= hi);
    if (closure.kind === 'single_track' && westHasCrossover && eastHasCrossover) {
      // Both directions share the open track between the crossovers: each train waits,
      // in the worst case, for one train from the other direction to clear the section.
      const clearS = speedAt(westTurn, eastTurn);
      services.push(
        base(0, path.lengthM, 'single-track', [
          { chainageM: westTurn, kind: 'hold', direction: 1, durationS: clearS },
          { chainageM: eastTurn, kind: 'hold', direction: -1, durationS: clearS },
        ]),
      );
      notes.push(
        `Single-track working between the crossovers (${Math.round(eastTurn - westTurn)} m): each train may wait up to ${Math.round(clearS)} s for the opposite direction.`,
      );
    } else {
      if (closure.kind === 'single_track')
        notes.push(
          'Single-track working needs a crossover on both sides of the closure; trains turn back instead.',
        );
      if (westHasCrossover && westTurn > 1) services.push(base(0, westTurn, 'west'));
      else if (lo > 0) notes.push('No crossover before the closed section: no service on that side.');
      if (path.lengthM - eastTurn > 1) services.push(base(eastTurn, path.lengthM, 'east'));
      else if (hi < path.lengthM)
        notes.push('No crossover after the closed section: no service on that side.');
      if (westHasCrossover || eastHasCrossover)
        notes.push('Trains turn back at the nearest crossover outside the closed section.');
    }
  } else {
    if (closure && (ring || line.direction !== 'bidirectional'))
      notes.push('Closures are simulated for bidirectional lines with two ends only.');
    services.push(base(0, path.lengthM, 'main'));
  }
  if (!services.length) return { ...emptyModel(line, path, headwayS, speedAt), notes };

  const longest = Math.max(...services.map((s) => s.endM - s.startM));
  const maxTripS =
    2 * (speedAt(0, longest) + layoverS) +
    2 * events.reduce((t, e) => t + (e.durationS ?? 0), 0) +
    2 * signalCount * maxSignalWait +
    1;
  return {
    lineId: line.id,
    color: line.color,
    path,
    headwayS,
    services,
    signalPriorityS: line.transitSignalPriority ? (options.signalPriorityS ?? 0) : 0,
    speedAt,
    notes,
    maxTripS,
    cache: new Map(),
  };
}

function emptyModel(
  line: TransportLine,
  path: MeasuredPath,
  headwayS: number,
  speedAt: (a: number, b: number) => number,
): LineSimulationModel {
  return {
    lineId: line.id,
    color: line.color,
    path,
    headwayS,
    services: [],
    signalPriorityS: 0,
    speedAt,
    notes: [],
    maxTripS: 0,
    cache: new Map(),
  };
}

/** Seconds a vehicle arriving at `t` waits at a signal (0 on green). */
export function signalWaitS(sig: SignalTiming, t: number, priorityS = 0): number {
  const inCycle = (((t - sig.offsetS) % sig.cycleS) + sig.cycleS) % sig.cycleS;
  if (inCycle < sig.greenS) return 0;
  // Priority extends green for a vehicle just behind the end of green, or shortens the red.
  if (inCycle < sig.greenS + priorityS) return 0;
  return Math.max(0, sig.cycleS - inCycle - priorityS);
}

/**
 * Phases of one trip departing at `departS`. Signal waits depend on the arrival
 * time, so each trip is built by walking the route in time order.
 */
function buildTrip(model: LineSimulationModel, svc: ServiceModel, departS: number): Phase[] {
  const phases: Phase[] = [];
  let t = departS;
  const leg = (dir: 1 | -1) => {
    const from = dir === 1 ? svc.startM : svc.endM;
    const to = dir === 1 ? svc.endM : svc.startM;
    const evs = svc.events
      .filter((e) => e.direction === 0 || e.direction === dir)
      .sort((x, y) => (x.chainageM - y.chainageM) * dir);
    let pos = from;
    for (const e of evs) {
      if (e.chainageM !== pos) {
        const d = model.speedAt(pos, e.chainageM);
        phases.push({ kind: 'run', fromM: pos, toM: e.chainageM, direction: dir, durationS: d });
        t += d;
        pos = e.chainageM;
      }
      const wait =
        e.kind === 'signal' ? signalWaitS(e.signal!, t, model.signalPriorityS) : (e.durationS ?? 0);
      if (wait > 0) {
        phases.push({ kind: e.kind, chainageM: pos, direction: dir, durationS: wait });
        t += wait;
      }
    }
    if (pos !== to) {
      const d = model.speedAt(pos, to);
      phases.push({ kind: 'run', fromM: pos, toM: to, direction: dir, durationS: d });
      t += d;
    }
  };
  leg(1);
  if (svc.pattern === 'shuttle') {
    phases.push({ kind: 'layover', chainageM: svc.endM, direction: 1, durationS: svc.layoverS });
    leg(-1);
    phases.push({ kind: 'layover', chainageM: svc.startM, direction: -1, durationS: svc.layoverS });
  } else if (svc.pattern === 'one_way') {
    phases.push({ kind: 'layover', chainageM: svc.endM, direction: 1, durationS: svc.layoverS });
  }
  return phases.filter((p) => p.durationS > 0);
}

export function tripPhases(model: LineSimulationModel, svc: ServiceModel, j: number): Phase[] {
  const key = `${svc.id}:${j}`;
  let phases = model.cache.get(key);
  if (!phases) {
    if (model.cache.size > 2000) model.cache.clear();
    phases = buildTrip(model, svc, j * model.headwayS);
    model.cache.set(key, phases);
  }
  return phases;
}

/** Duration of trip 0 of the first service (a full round trip without signal waits beyond trip 0's). */
export function roundTripS(model: LineSimulationModel): number {
  const svc = model.services[0];
  return svc ? tripPhases(model, svc, 0).reduce((s, p) => s + p.durationS, 0) : 0;
}

/**
 * Where every vehicle of a line is at simulated time `tS` (seconds since start).
 * A trip departs every headway from the start of each service (also before
 * t = 0, so the line is already populated); a trip is one vehicle's round trip.
 */
export function vehicleStates(model: LineSimulationModel, tS: number): VehicleState[] {
  const out: VehicleState[] = [];
  const h = model.headwayS;
  for (const svc of model.services) {
    const first = Math.floor((tS - model.maxTripS) / h);
    const last = Math.floor(tS / h);
    for (let j = first; j <= last; j++) {
      let local = tS - j * h;
      if (local < 0) continue;
      for (const p of tripPhases(model, svc, j)) {
        if (local < p.durationS) {
          let chainageM: number;
          let state: VehicleState['state'];
          if (p.kind === 'run') {
            chainageM = p.fromM + (p.toM - p.fromM) * (local / p.durationS);
            state = 'running';
          } else {
            chainageM = p.chainageM;
            state = p.kind === 'dwell' ? 'dwelling' : p.kind === 'layover' ? 'layover' : 'waiting';
          }
          const { position, bearingDeg } = interpolate(model.path, chainageM);
          out.push({
            id: `${model.lineId}-${svc.id}-t${j}`,
            lineId: model.lineId,
            color: model.color,
            chainageM,
            position,
            bearingDeg: p.direction === 1 ? bearingDeg : (bearingDeg + 180) % 360,
            direction: p.direction,
            state,
          });
          break;
        }
        local -= p.durationS;
      }
    }
  }
  return out;
}

export function buildScenarioModels(scenario: Scenario, options?: SimulationOptions): LineSimulationModel[] {
  return scenario.lines
    .filter((l) => !['cycling', 'pedestrian'].includes(l.mode))
    .map((l) => buildLineModel(l, scenario, options))
    .filter((m): m is LineSimulationModel => m !== null);
}

/** Simulation clock: converts real elapsed time into simulated time with a multiplier. */
export class SimulationClock {
  private simS = 0;
  private lastReal: number | null = null;
  running = false;
  multiplier = 30;

  constructor(private now: () => number = () => performance.now()) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.lastReal = this.now();
  }
  pause() {
    this.tick();
    this.running = false;
    this.lastReal = null;
  }
  reset() {
    this.simS = 0;
    this.lastReal = this.running ? this.now() : null;
  }
  setMultiplier(m: number) {
    this.tick();
    this.multiplier = m;
  }
  /** Advance by real elapsed time and return simulated seconds. */
  tick(): number {
    if (this.running && this.lastReal !== null) {
      const now = this.now();
      this.simS += ((now - this.lastReal) / 1000) * this.multiplier;
      this.lastReal = now;
    }
    return this.simS;
  }
  get timeS() {
    return this.simS;
  }
}
