/**
 * Deterministic illustrative vehicle simulation.
 *
 * This is an operational animation, not a railway or traffic simulator:
 * vehicles run at constant speed per segment (no acceleration, no train
 * protection), dwell a fixed time at each stop, lay over at terminals, wait at
 * road traffic signals on red (simulated cycles with assumed timings) and
 * follow a simplified closure model (turn back at crossovers, or a worst-case
 * wait for single-track working).
 *
 * Track occupancy (simulation/occupancy.ts): a single-track block used in both
 * directions is reserved by one direction at a time, so opposing trains wait at
 * its entry until it is clear; vehicles following each other on a track (or on
 * the same bus route) keep a minimum separation. Trips are scheduled in a fixed
 * global order (departure time, line, service), so the result stays a pure,
 * deterministic function of simulated time.
 *
 * Vehicle state is a pure function of simulated time, so rendering frame rate
 * never affects where vehicles are. The map layer only samples `vehicleStates`.
 */
import type { LngLat, Scenario, TransportLine } from '../domain/schema';
import { findConflicts, modeRank } from './conflicts';
import { MODE_PRIORITY } from '../domain/modeSeparation';
import { isRing, orderedStops, placedCrossovers } from '../domain/network';
import { pathCoordinates, snapToPath } from '../geo/geometry';
import { segmentSpeedKmh } from './speeds';
import { SIGNAL_MODES } from '../domain/signals';
import { returnCoordinates } from '../domain/serviceRouting';
import { singleTrackBlocks, stepsLengthM } from '../domain/trackGraph';
import { minSeparationM, parameterValue } from '../domain/trackParameters';
import { consistLengthM } from '../domain/vehicles';
import { trackGeometry } from '../domain/tracks';
import { OccupancyLedger, type ResourceSpan } from './occupancy';
import { consistFootprint, consistShape, type ConsistShape } from './footprint';

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
  | {
      kind: 'dwell' | 'layover' | 'hold' | 'signal' | 'occupied';
      durationS: number;
      chainageM: number;
      direction: 1 | -1;
    }
  | { kind: 'run'; durationS: number; fromM: number; toM: number; direction: 1 | -1 };

/** Something a vehicle waits for at a chainage, in one or both directions. */
interface StopEvent {
  chainageM: number;
  kind: 'dwell' | 'hold' | 'signal' | 'enter';
  span?: ResourceSpan;
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
  /** Geometry of the way back when it differs (double track, one-way streets); chainage maps by fraction. */
  returnPath: MeasuredPath | null;
  /** Shared resources along the path per travel direction (line chainage, from < to). */
  spans: { forward: ResourceSpan[]; backward: ResourceSpan[] };
  /** Minimum distance to the vehicle ahead, metres (placeholder parameter). */
  separationM: number;
  /** Shared scheduling context (one per scenario, or private for a single line). */
  context: SimulationContext;
  /** Priority at crossings and merges: 0 = highest (mode order). Higher ranks are scheduled first. */
  rank: number;
  /** Size of one consist, for drawing vehicles to scale; null = not drawn to scale. */
  consist: ConsistShape | null;
  /** True for a ring line: the path closes on itself. */
  ring: boolean;
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
  /** Outline of each unit of the consist (closed rings), to scale; empty when unknown. */
  footprint: LngLat[][];
}

/**
 * Builds trips of all lines in one global order so that occupancy waits are
 * deterministic: trips are processed by departure time, then line, then service.
 */
export class SimulationContext {
  readonly models: LineSimulationModel[] = [];
  readonly ledger = new OccupancyLedger();
  private next = new Map<string, number>();
  private startS = 0;
  /** Messages about capacity problems found while scheduling. */
  readonly warnings = new Set<string>();

  add(model: LineSimulationModel) {
    this.models.push(model);
    const warm = Math.max(...this.models.map((m) => m.maxTripS), 0);
    // Earlier than the furthest look-back of vehicleStates (3 × the undisturbed trip time).
    this.startS = Math.min(this.startS, -4 * warm);
  }

  /** First trip index scheduled in order for a model (earlier ones are built standalone). */
  firstIndex(model: LineSimulationModel): number {
    return Math.floor(this.startS / model.headwayS);
  }

  /**
   * Build every trip, of every line, that departs at or before `departS`. Trips of
   * higher-priority lines (lower `rank`) are built further ahead, so a lower-priority
   * vehicle sees them and waits at crossings; within one rank, in departure order (the
   * one that arrives first goes first).
   */
  ensure(departS: number) {
    const ranks = [...new Set(this.models.map((m) => m.rank))].sort((a, b) => a - b);
    const level = new Map(ranks.map((r, i) => [r, i]));
    const top = ranks.length - 1;
    const w = Math.max(...this.models.map((m) => m.maxTripS), 0);
    for (;;) {
      let pick: {
        m: LineSimulationModel;
        svc: ServiceModel;
        j: number;
        t: number;
        k: string;
        key: number;
      } | null = null;
      this.models.forEach((m) => {
        const lv = level.get(m.rank) ?? 0;
        m.services.forEach((svc) => {
          const k = `${m.lineId}:${svc.id}`;
          const j = this.next.get(k) ?? this.firstIndex(m);
          const t = j * m.headwayS;
          const key = t + lv * w;
          if (key <= departS + top * w && (!pick || key < pick.key)) pick = { m, svc, j, t, k, key };
        });
      });
      if (!pick) return;
      const { m, svc, j, t, k } = pick as {
        m: LineSimulationModel;
        svc: ServiceModel;
        j: number;
        t: number;
        k: string;
      };
      this.ledger.prune(t - top * w);
      m.cache.set(`${svc.id}:${j}`, buildTrip(m, svc, t, true));
      this.next.set(k, j + 1);
    }
  }
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
  /** A fixed wait per passing vehicle instead of the cycle (seconds). */
  delayS?: number | null;
  /** Restricts the signal to some lines (attachment, controlled users). */
  appliesTo?: (line: TransportLine) => boolean;
  /** Attached signals apply to their line or track without the distance limit. */
  attached?: boolean;
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
  /** Crossings and shared sections between lines (set by buildScenarioModels). */
  conflicts?: ReturnType<typeof findConflicts>;
}

export function buildLineModel(
  line: TransportLine,
  scenario: Scenario,
  options: SimulationOptions = {},
): LineSimulationModel | null {
  const model = buildModel(line, scenario, options);
  if (model) {
    model.context = new SimulationContext();
    model.context.add(model);
  }
  return model;
}

function buildModel(
  line: TransportLine,
  scenario: Scenario,
  options: SimulationOptions,
): LineSimulationModel | null {
  const model = buildModelBody(line, scenario, options);
  if (model) {
    model.consist = consistShape(line, scenario);
    model.ring = isRing(line);
  }
  return model;
}

function buildModelBody(
  line: TransportLine,
  scenario: Scenario,
  options: SimulationOptions,
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
      if (sig.appliesTo && !sig.appliesTo(line)) continue;
      const snap = snapToPath(line.coordinates, ring, sig.position);
      if (!snap || (!sig.attached && snap.offsetM > tol)) continue;
      // Road signals apply on street-level track only, not in tunnels or on viaducts.
      const seg = line.segments.find((x) => snap.fraction >= x.fromFraction && snap.fraction <= x.toFraction);
      if (seg && seg.structure !== 'at_grade') continue;
      events.push(
        sig.delayS !== null && sig.delayS !== undefined
          ? { chainageM: snap.fraction * path.lengthM, kind: 'signal', direction: 0, durationS: sig.delayS }
          : { chainageM: snap.fraction * path.lengthM, kind: 'signal', direction: 0, signal: sig },
      );
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
  const extras = occupancyInputs(line, scenario, path);
  if (options.conflicts) {
    const more = conflictSpans(line, scenario, path, options.conflicts);
    extras.spans = {
      forward: [...extras.spans.forward, ...more.forward],
      backward: extras.spans.backward.length ? [...extras.spans.backward, ...more.backward] : [],
    };
  }
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
    ...extras,
    context: privateContext(),
    rank: modeRank(scenario.modePriority ?? MODE_PRIORITY, line.mode),
    consist: null,
    ring,
  };
}

/**
 * Crossing zones and shared street sections of a line (simulation/conflicts.ts) as
 * resources. A crossing zone reaches the clearance plus a vehicle length on either side
 * of the crossing point, so the whole vehicle is clear before the next one enters.
 */
function conflictSpans(
  line: TransportLine,
  scenario: Scenario,
  path: MeasuredPath,
  conflicts: ReturnType<typeof findConflicts>,
): { forward: ResourceSpan[]; backward: ResourceSpan[] } {
  const vehicle = scenario.vehicleTypes.find((v) => v.id === line.vehicleTypeId);
  const half =
    parameterValue(scenario.trackNetwork, 'crossingClearanceM') +
    (consistLengthM(line, vehicle) ?? parameterValue(scenario.trackNetwork, 'unknownVehicleLengthM'));
  const forward: ResourceSpan[] = [];
  const backward: ResourceSpan[] = [];
  for (const x of conflicts.crossings) {
    const k = x.lineIds.indexOf(line.id);
    if (k < 0) continue;
    const c = x.fractions[k]! * path.lengthM;
    const span = {
      fromM: Math.max(0, c - half),
      toM: Math.min(path.lengthM, c + half),
      resourceId: x.id,
      sign: 1 as const,
      opposing: false,
      exclusive: true,
    };
    forward.push(span);
    backward.push(span);
  }
  for (const sh of conflicts.shared) {
    const k = sh.lineIds.indexOf(line.id);
    if (k < 0) continue;
    const r = sh.ranges[k]!;
    // The resource's direction is that of the first line; the second runs with it or against it.
    const sign: 1 | -1 = k === 0 || sh.sameDirection ? 1 : -1;
    const fromM = r.from * path.lengthM;
    const toM = r.to * path.lengthM;
    forward.push({ fromM, toM, resourceId: sh.id, sign, opposing: false });
    backward.push({ fromM, toM, resourceId: sh.id, sign: -sign as 1 | -1, opposing: false });
  }
  return { forward, backward };
}

const privateContext = (): SimulationContext => new SimulationContext();

/** Resources a line occupies: track blocks and tracks for services on tracks, the route itself for others. */
function occupancyInputs(
  line: TransportLine,
  scenario: Scenario,
  path: MeasuredPath,
): Pick<LineSimulationModel, 'returnPath' | 'spans' | 'separationM'> {
  const back = line.direction === 'bidirectional' ? returnCoordinates(scenario, line) : null;
  const returnPath = back && back.length >= 2 ? measurePath(back, false) : null;
  const separationM = minSeparationM(scenario.trackNetwork, line.mode);
  if (line.alignment.kind !== 'track' || !line.alignment.path.length) {
    const whole = (sign: 1 | -1): ResourceSpan[] => [
      { fromM: 0, toM: path.lengthM, resourceId: `line:${line.id}:${sign}`, sign, opposing: false },
    ];
    return { returnPath, separationM, spans: { forward: whole(1), backward: whole(-1) } };
  }
  const net = scenario.trackNetwork;
  const blocks = singleTrackBlocks(net);
  const byId = new Map(net.tracks.map((t) => [t.id, t]));
  const toSpans = (steps: typeof line.alignment.path, reverseMap: boolean): ResourceSpan[] => {
    const total = stepsLengthM(net, steps);
    if (total <= 0) return [];
    const scale = path.lengthM / total;
    const out: ResourceSpan[] = [];
    let at = 0;
    for (const st of steps) {
      const t = byId.get(st.trackId);
      if (!t) continue;
      const len = Math.abs(st.to - st.from) * trackGeometry(net, t).lengthM * scale;
      const block = blocks.get(st.trackId);
      const resourceId = block ? block.blockId : `track:${st.trackId}`;
      const own: 1 | -1 = st.reversed ? -1 : 1;
      const sign = (block ? own * block.orientation : own) as 1 | -1;
      const a = at;
      at += len;
      // The way back runs from the end of the outbound chainage towards 0.
      const fromM = reverseMap ? path.lengthM - at : a;
      const toM = reverseMap ? path.lengthM - a : at;
      const last = out[out.length - 1];
      if (last && last.resourceId === resourceId && last.sign === sign) {
        if (reverseMap) last.fromM = fromM;
        else last.toM = toM;
      } else out.push({ fromM, toM, resourceId, sign, opposing: !!block });
    }
    return out;
  };
  const forward = toSpans(line.alignment.path, false);
  const backward = line.alignment.returnPath?.length ? toSpans(line.alignment.returnPath, true) : [];
  return { returnPath, separationM, spans: { forward, backward } };
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
    returnPath: null,
    spans: { forward: [], backward: [] },
    separationM: 0,
    context: privateContext(),
    rank: 0,
    consist: null,
    ring: false,
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
function buildTrip(
  model: LineSimulationModel,
  svc: ServiceModel,
  departS: number,
  scheduled = false,
): Phase[] {
  const phases: Phase[] = [];
  let t = departS;
  const ORDER = { dwell: 0, signal: 1, hold: 2, enter: 3 } as const;
  const leg = (dir: 1 | -1) => {
    const from = dir === 1 ? svc.startM : svc.endM;
    const to = dir === 1 ? svc.endM : svc.startM;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const dirEvents = svc.events.filter((e) => e.direction === 0 || e.direction === dir);
    // Spans of the way back fall back to the outbound spans (same track used both ways).
    const spans = dir === 1 || !model.spans.backward.length ? model.spans.forward : model.spans.backward;
    const enters: StopEvent[] = spans
      .filter((sp) => sp.toM > lo + 0.01 && sp.fromM < hi - 0.01)
      .map((sp) => {
        const a = Math.max(lo, sp.fromM);
        const b = Math.min(hi, sp.toM);
        const sign = (dir === 1 || model.spans.backward.length ? sp.sign : -sp.sign) as 1 | -1;
        return {
          chainageM: dir === 1 ? a : b,
          kind: 'enter' as const,
          direction: dir,
          span: { ...sp, fromM: a, toM: b, sign },
        };
      });
    const evs = [...dirEvents, ...enters].sort(
      (x, y) => (x.chainageM - y.chainageM) * dir || ORDER[x.kind] - ORDER[y.kind],
    );
    let pos = from;
    for (const e of evs) {
      if (e.chainageM !== pos) {
        const d = model.speedAt(pos, e.chainageM);
        phases.push({ kind: 'run', fromM: pos, toM: e.chainageM, direction: dir, durationS: d });
        t += d;
        pos = e.chainageM;
      }
      if (e.kind === 'enter' && !scheduled) continue;
      if (e.kind === 'enter') {
        const sp = e.span!;
        const runS = model.speedAt(sp.fromM, sp.toM);
        const dwellS = dirEvents
          .filter((x) => x.kind === 'dwell' && x.chainageM > sp.fromM + 0.01 && x.chainageM < sp.toM - 0.01)
          .reduce((sum, x) => sum + (x.durationS ?? 0), 0);
        const lengthM = Math.max(1e-6, sp.toM - sp.fromM);
        const separationS = (model.separationM * runS) / lengthM;
        const start = model.context.ledger.reserve(
          sp.resourceId,
          sp.sign,
          sp.opposing,
          t,
          runS + dwellS,
          sp.exclusive ? 0 : separationS,
          `${model.lineId}:${svc.id}:${dir}`,
          sp.exclusive ?? false,
        );
        const wait = start - t;
        if (wait > 1e-6) {
          phases.push({ kind: 'occupied', chainageM: pos, direction: dir, durationS: wait });
          t += wait;
          if (wait > model.headwayS)
            model.context.warnings.add(
              `${model.lineId}: vehicles wait longer than the headway for occupied track; the timetable exceeds the capacity of the section.`,
            );
        }
        continue;
      }
      const wait =
        e.kind === 'signal' && e.signal
          ? signalWaitS(e.signal, t, model.signalPriorityS)
          : (e.durationS ?? 0);
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
    // The way back starts after the layover (signal and occupancy times depend on it).
    t += svc.layoverS;
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
  if (phases) return phases;
  if (j >= model.context.firstIndex(model)) {
    // Scheduled in global order with every other line of the context.
    model.context.ensure(j * model.headwayS);
    phases = model.cache.get(key);
  }
  if (!phases) {
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
    // Occupancy waits can lengthen trips: look back further than the undisturbed trip time.
    const first = Math.floor((tS - 3 * model.maxTripS) / h);
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
          const back = p.direction === -1 && model.returnPath;
          const { position, bearingDeg } = back
            ? interpolate(model.returnPath!, (1 - chainageM / model.path.lengthM) * model.returnPath!.lengthM)
            : interpolate(model.path, chainageM);
          const heading = back ? bearingDeg : p.direction === 1 ? bearingDeg : (bearingDeg + 180) % 360;
          // On the separate return path the vehicle runs forward along that path.
          const footprint = model.consist
            ? back
              ? consistFootprint(
                  model.returnPath!,
                  (1 - chainageM / model.path.lengthM) * model.returnPath!.lengthM,
                  1,
                  model.consist,
                  false,
                )
              : consistFootprint(model.path, chainageM, p.direction, model.consist, model.ring)
            : [];
          out.push({
            id: `${model.lineId}-${svc.id}-t${j}`,
            lineId: model.lineId,
            color: model.color,
            chainageM,
            position,
            bearingDeg: heading,
            direction: p.direction,
            state,
            footprint,
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
  const context = new SimulationContext();
  // Crossings and shared streets between lines, any modes (owner rule): vehicles never collide.
  const conflicts = findConflicts(scenario);
  const models = scenario.lines
    .filter((l) => !['cycling', 'pedestrian'].includes(l.mode))
    .map((l) => buildModel(l, scenario, { ...(options ?? {}), conflicts }))
    .filter((m): m is LineSimulationModel => m !== null);
  for (const m of models) {
    m.context = context;
    context.add(m);
  }
  return models;
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
