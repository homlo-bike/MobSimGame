/**
 * Deterministic illustrative vehicle simulation.
 *
 * This is an operational animation, not a railway or traffic simulator:
 * vehicles run at constant speed per segment (no acceleration, no signalling,
 * no conflicts), dwell a fixed time at each stop and lay over at terminals.
 *
 * Vehicle state is a pure function of simulated time, so rendering frame rate
 * never affects where vehicles are. The map layer only samples `vehicleStates`.
 */
import type { LngLat, Scenario, TransportLine } from '../domain/schema';
import { isRing, orderedStops } from '../domain/network';
import { pathCoordinates } from '../geo/geometry';
import { segmentSpeedKmh } from './speeds';

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

type Phase =
  | { kind: 'dwell' | 'layover'; durationS: number; chainageM: number; direction: 1 | -1 }
  | { kind: 'run'; durationS: number; fromM: number; toM: number; direction: 1 | -1 };

export interface LineSimulationModel {
  lineId: string;
  color: string;
  path: MeasuredPath;
  phases: Phase[];
  cycleS: number;
  headwayS: number;
  vehicleCount: number;
  /** Ends-type one-way lines return out of service; those vehicles are hidden on return. */
  oneWay: boolean;
}

export interface VehicleState {
  id: string;
  lineId: string;
  color: string;
  chainageM: number;
  position: LngLat;
  bearingDeg: number;
  direction: 1 | -1;
  state: 'running' | 'dwelling' | 'layover';
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

export interface SimulationOptions {
  layoverS?: number;
  /** Use off-peak headways instead of peak. */
  offPeak?: boolean;
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
  const stops = orderedStops(line, scenario.stations).map((s) =>
    // Project station fraction onto the measured path to keep both consistent.
    Math.min(path.lengthM, Math.max(0, s.fraction * path.lengthM)),
  );
  const pattern = line.servicePatterns[0];
  const headwayS = ((options.offPeak ? pattern?.offPeakHeadwayMin : pattern?.peakHeadwayMin) ?? 10) * 60;
  const dwell = line.dwellTimeS;

  const forward = (): Phase[] => {
    const phases: Phase[] = [];
    const points = stops.length ? stops : [0];
    let pos = 0;
    for (const s of points) {
      if (s > pos)
        phases.push({
          kind: 'run',
          fromM: pos,
          toM: s,
          direction: 1,
          durationS: runTimeS(line, path.lengthM, pos, s),
        });
      if (dwell > 0 && stops.length)
        phases.push({ kind: 'dwell', chainageM: s, direction: 1, durationS: dwell });
      pos = s;
    }
    if (path.lengthM > pos) {
      phases.push({
        kind: 'run',
        fromM: pos,
        toM: path.lengthM,
        direction: 1,
        durationS: runTimeS(line, path.lengthM, pos, path.lengthM),
      });
    }
    return phases;
  };

  let phases: Phase[];
  const oneWay = line.direction === 'one_way';
  if (ring) {
    phases = forward();
  } else if (oneWay) {
    phases = [...forward(), { kind: 'layover', chainageM: path.lengthM, direction: 1, durationS: layoverS }];
  } else {
    const fwd = forward();
    // The return trip reverses the forward phases (vehicles reverse at terminals).
    const back: Phase[] = [...fwd]
      .reverse()
      .map((p) =>
        p.kind === 'run'
          ? { kind: 'run', fromM: p.toM, toM: p.fromM, direction: -1, durationS: p.durationS }
          : { ...p, direction: -1 },
      );
    phases = [
      ...fwd,
      { kind: 'layover', chainageM: path.lengthM, direction: 1, durationS: layoverS },
      ...back,
      { kind: 'layover', chainageM: 0, direction: -1, durationS: layoverS },
    ];
  }
  phases = phases.filter((p) => p.durationS > 0);
  const cycleS = phases.reduce((s, p) => s + p.durationS, 0);
  if (cycleS <= 0) return null;
  return {
    lineId: line.id,
    color: line.color,
    path,
    phases,
    cycleS,
    headwayS,
    vehicleCount: Math.max(1, Math.ceil(cycleS / headwayS)),
    oneWay,
  };
}

/** Where every vehicle of a line is at simulated time `tS` (seconds since start). */
export function vehicleStates(model: LineSimulationModel, tS: number): VehicleState[] {
  const out: VehicleState[] = [];
  for (let k = 0; k < model.vehicleCount; k++) {
    let local = (((tS - k * model.headwayS) % model.cycleS) + model.cycleS) % model.cycleS;
    for (const p of model.phases) {
      if (local <= p.durationS) {
        let chainageM: number;
        let state: VehicleState['state'];
        if (p.kind === 'run') {
          chainageM = p.fromM + (p.toM - p.fromM) * (local / p.durationS);
          state = 'running';
        } else {
          chainageM = p.chainageM;
          state = p.kind === 'dwell' ? 'dwelling' : 'layover';
        }
        const { position, bearingDeg } = interpolate(model.path, chainageM);
        out.push({
          id: `${model.lineId}-v${k + 1}`,
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
