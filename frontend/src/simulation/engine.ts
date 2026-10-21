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
import type { LngLat, Scenario, ServicePeriod, TransportLine } from '../domain/schema';
import { findConflicts, modeRank } from './conflicts';
import { MODE_PRIORITY } from '../domain/modeSeparation';
import { isRing, orderedStops, placedCrossovers } from '../domain/network';
import { pathCoordinates, snapToPath } from '../geo/geometry';
import { segmentSpeedKmh } from './speeds';
import { SIGNAL_MODES } from '../domain/signals';
import { returnCoordinates, stepsCoordinates } from '../domain/serviceRouting';
import { assignStabling } from '../domain/stabling';
import { lineVehicles } from '../domain/fleetRegistry';
import { allocateDepots, isDepotMode, parkingSpot } from '../domain/depots';
import { singleTrackBlocks, stepsLengthM } from '../domain/trackGraph';
import { following, parameterValue, signalOverlapM, type Following } from '../domain/trackParameters';
import { clearanceDistanceM } from '../domain/clearancePoints';
import { DAY_S, dayDepartures } from '../domain/timetable';
import { consistCapacity, consistLengthM } from '../domain/vehicles';
import { nodeEnds, trackGeometry } from '../domain/tracks';
import { OccupancyLedger, type Reservation, type ResourceSpan } from './occupancy';
import { consistFootprint, consistShape, type ConsistShape } from './footprint';
import { heightAtFraction, lineHeightProfile, type HeightProfile } from '../domain/ramps';
import {
  lineRates,
  profile as speedProfile,
  profileDistance,
  profileDuration,
  stopLossS,
  type Profile,
} from './kinematics';
import { envelopeDistance, equivalentGradientPerMille, linePhysics, runEnvelope } from './trainPhysics';
import type { Envelope, TrainPhysics } from './trainPhysics';
import { lineCurveProfile, radiusAtFraction } from '../domain/lineCurvature';
import { physicsSpeedKmh } from './speeds';
import { divergingRestrictions } from '../domain/turnouts';

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
      /** For 'layover': the vehicle came back late from its previous trip and leaves late. */
      late?: boolean;
      chainageM: number;
      direction: 1 | -1;
      /** For 'occupied': the resource waited for, and where it is. */
      resourceId?: string;
      resourceLabel?: string;
    }
  | {
      kind: 'run';
      durationS: number;
      fromM: number;
      toM: number;
      direction: 1 | -1;
      /** Speed profile (acceleration, cruise, braking); without it the speed is constant. */
      profile?: Profile;
      /** Speed over the run from train physics (takes precedence over `profile`). */
      envelope?: Envelope;
    };

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
  /** How vehicles keep their distance to the one ahead (on sight or signalled). */
  following: Following;
  /** Length of one consist (m): the vehicle ahead occupies this much before the gap starts. */
  vehicleLengthM: number;
  /** Shared scheduling context (one per scenario, or private for a single line). */
  context: SimulationContext;
  /** Priority at crossings and merges: 0 = highest (mode order). Higher ranks are scheduled first. */
  rank: number;
  /** Size of one consist, for drawing vehicles to scale; null = not drawn to scale. */
  consist: ConsistShape | null;
  /** True for a ring line: the path closes on itself. */
  ring: boolean;
  /** Acceleration and braking (m/s²); null = constant speed between stops. */
  rates: { accelMs2: number; decelMs2: number } | null;
  /** Height of the line (m, relative to the street) along its length, for drawing vehicles underground. */
  heightProfile: HeightProfile;
  /** Running time from train physics (R15a); null = constant rates. */
  physics: LinePhysicsModel | null;
  /**
   * Vehicles in service per service (ring and two-direction services): each runs every
   * `fleet`-th trip and lays over at the start until its next departure, so the same
   * vehicles circulate and never vanish. 0 = trips are not tied to vehicles.
   */
  fleet: number;
  /**
   * Departures of one service day (s after midnight), repeated every day; null = a trip
   * every headway around the clock (steady-state analyses, tests).
   */
  timetable: number[] | null;
  /** Vehicle (0 … fleet − 1) running each trip, by `${service}:${trip}`. */
  vehicleOf: Map<string, number>;
  /** Trips of each vehicle in departure order, by `${service}:${vehicle}`. */
  tripsOf: Map<string, number[]>;
  /** When each vehicle of a service is free again, by service. */
  ready: Map<string, number[]>;
  /** Depot slot of each vehicle and the empty runs there and back (F6); null = none. */
  stabling: Map<number, DepotRun> | null;
  /**
   * Fleet numbers of the line's vehicles (F3), vehicle 1, 2, … in order; vehicles beyond
   * the ones in service are spares and wait in their depot slots.
   */
  vehicleCodes: string[];
  /** Stops along the line's path (station, chainage), in chainage order. */
  stops: { stationId: string; chainageM: number }[];
}

/** A vehicle's empty runs between the start of its line and its depot slot. */
export interface DepotRun {
  out: MeasuredPath;
  back: MeasuredPath;
  outS: number;
  backS: number;
}

/** Departure time (s) of trip `j`. */
export function departOf(model: LineSimulationModel, j: number): number {
  const tt = model.timetable;
  if (!tt) return j * model.headwayS;
  if (!tt.length || j < 0) return -Infinity;
  const day = Math.floor(j / tt.length);
  return day * DAY_S + tt[j - day * tt.length]!;
}

/** The last trip departing at or before `tS`, or null when none has departed yet. */
export function lastTripAt(model: LineSimulationModel, tS: number): number | null {
  const tt = model.timetable;
  if (!tt) return Math.floor(tS / model.headwayS);
  if (!tt.length) return null;
  /** Last index with tt[k] ≤ x, or -1. */
  const lastAtOrBefore = (x: number) => {
    let lo = -1;
    let hi = tt.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tt[mid]! <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const day = Math.floor(tS / DAY_S);
  const k = lastAtOrBefore(tS - day * DAY_S);
  if (k >= 0) return day * tt.length + k;
  // Before the first departure of the day: the previous day's service (it may run past midnight).
  if (day < 1) return null;
  const kp = lastAtOrBefore(tS - (day - 1) * DAY_S);
  return kp >= 0 ? (day - 1) * tt.length + kp : null;
}

/** Train physics of a line and the track it runs on, in line chainage. */
export interface LinePhysicsModel {
  train: TrainPhysics;
  /** Length of the consist (m). */
  lengthM: number;
  /** Speed limit at a chainage (m/s). */
  limitAt: (m: number) => number;
  /** Equivalent gradient (per mille) at a chainage, uphill positive in the line's direction. */
  gradientAt: (m: number) => number;
  notes: string[];
  /** Memoised envelopes per run. */
  cache: Map<string, Envelope>;
}

/** Envelope of a run from `fromM` to `toM` (line chainage) starting at `v0`, ending at most at `v1`. */
function physicsRun(ph: LinePhysicsModel, fromM: number, toM: number, v0: number, v1: number): Envelope {
  const key = `${fromM.toFixed(2)}|${toM.toFixed(2)}|${v0.toFixed(3)}|${v1.toFixed(3)}`;
  const hit = ph.cache.get(key);
  if (hit) return hit;
  const dir = toM >= fromM ? 1 : -1;
  const env = runEnvelope(
    ph.train,
    {
      lengthM: Math.abs(toM - fromM),
      limitAt: (x) => ph.limitAt(fromM + dir * x),
      gradientAt: (x) => dir * ph.gradientAt(fromM + dir * x),
    },
    v0,
    v1,
    ph.lengthM,
  );
  ph.cache.set(key, env);
  return env;
}

export interface VehicleState {
  id: string;
  lineId: string;
  color: string;
  chainageM: number;
  position: LngLat;
  bearingDeg: number;
  direction: 1 | -1;
  state: 'running' | 'dwelling' | 'layover' | 'waiting' | 'parked' | 'deadhead';
  /** Outline of each unit of the consist (closed rings), to scale; empty when unknown. */
  footprint: LngLat[][];
  /** Height (m) relative to the street: negative underground, positive elevated. */
  heightM: number;
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
    return model.timetable ? 0 : Math.floor(this.startS / model.headwayS);
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
          const t = departOf(m, j);
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
      if (!Number.isFinite(t)) {
        this.next.set(k, j + 1);
        continue;
      }
      let delayS = 0;
      let vehicle = -1;
      if (m.fleet > 0) {
        // Vehicle blocking: of the vehicles free at the departure, the one that came back
        // last (the others stay out of service while fewer are needed); if none is free,
        // the first one back, which leaves late.
        const ready = m.ready.get(svc.id) ?? new Array<number>(m.fleet).fill(-Infinity);
        m.ready.set(svc.id, ready);
        let best = -1;
        for (let v = 0; v < ready.length; v++)
          if (ready[v]! <= t && (best < 0 || ready[v]! > ready[best]!)) best = v;
        if (best < 0)
          for (let v = 0; v < ready.length; v++) if (best < 0 || ready[v]! < ready[best]!) best = v;
        vehicle = best;
        delayS = Math.max(0, ready[best]! - t);
      }
      const phases = buildTrip(m, svc, t, true, delayS);
      m.cache.set(`${svc.id}:${j}`, phases);
      if (vehicle >= 0) {
        m.ready.get(svc.id)![vehicle] = t + phases.reduce((x, p) => x + p.durationS, 0);
        m.vehicleOf.set(`${svc.id}:${j}`, vehicle);
        const list = m.tripsOf.get(`${svc.id}:${vehicle}`) ?? [];
        list.push(j);
        m.tripsOf.set(`${svc.id}:${vehicle}`, list);
      }
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
  /** Constant speed between stops, no acceleration or braking (for comparisons and tests). */
  constantSpeed?: boolean;
  /**
   * Run the service day: departures from each line's service start to its end, at peak
   * headways inside these periods and off-peak headways outside them, every day. Without
   * it, a trip departs every peak headway around the clock (steady-state analyses).
   */
  timetable?: { peakPeriods: readonly ServicePeriod[] };
  /**
   * Only animate street lines whose every leg follows the street network (or a path the
   * user drew and accepted): a vehicle never cuts across on a straight placeholder.
   */
  routedOnly?: boolean;
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
    applyFleetHeadway(model, line, scenario);
    const pattern = line.servicePatterns[0];
    if (options.timetable && pattern) {
      // With fewer vehicles set than the peak needs, no headway is shorter than they allow.
      model.timetable = dayDepartures(pattern, options.timetable.peakPeriods, {
        peak: model.headwayS,
        offPeak: Math.max(pattern.offPeakHeadwayMin * 60, line.fleetSize ? model.headwayS : 0),
      });
      model.cache.clear();
    }
  }
  return model;
}

/**
 * Headway the line actually runs (R16): the timetable headway, shorter where the expected
 * demand needs more vehicles to pass (60 × consist capacity / demand), and longer when the
 * user sets fewer vehicles than that needs (cycle / vehicles). Pure.
 */
function applyFleetHeadway(model: LineSimulationModel, line: TransportLine, scenario: Scenario) {
  const vehicle = scenario.vehicleTypes.find((v) => v.id === line.vehicleTypeId);
  const perConsist = consistCapacity(line, vehicle);
  let headwayS = model.headwayS;
  if (line.peakDemandPphpd && perConsist)
    headwayS = Math.min(headwayS, (3600 * perConsist) / line.peakDemandPphpd);
  if (line.fleetSize && line.fleetSize > 0 && model.services[0]) {
    // One undisturbed round trip at the design headway gives the cycle.
    model.headwayS = headwayS;
    model.cache.clear();
    const cycleS = roundTripS(model);
    model.cache.clear();
    headwayS = Math.max(headwayS, cycleS / line.fleetSize);
  }
  if (headwayS !== model.headwayS) {
    model.headwayS = Math.max(1, headwayS);
    model.cache.clear();
  }
  // The vehicles that circulate: enough for one undisturbed cycle at this headway (more
  // set by the user than that stay out of service; fewer lengthened the headway above).
  const svc = model.services[0];
  if (svc && svc.pattern !== 'one_way') {
    const cycleS = roundTripS(model);
    model.cache.clear();
    model.fleet = Math.max(1, Math.ceil(cycleS / model.headwayS - 1e-6));
  }
}

function buildModelBody(
  line: TransportLine,
  scenario: Scenario,
  options: SimulationOptions,
): LineSimulationModel | null {
  const ring = isRing(line);
  const path = measurePath(line.coordinates, ring);
  if (path.lengthM <= 0) return null;
  if (
    options.routedOnly &&
    line.alignment.kind === 'routed' &&
    line.alignment.legs.some((l) => l.status === 'unrouted')
  ) {
    const empty = emptyModel(line, path, 600, () => 0);
    empty.notes.push(
      'Not animated: part of the route is not routed on streets yet (vehicles never cut across on a straight placeholder). Route it or accept the drawn legs.',
    );
    return empty;
  }
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
  const extras = occupancyInputs(
    line,
    scenario,
    path,
    [...stopAt].map(([stationId, chainageM]) => ({ stationId, chainageM })),
  );
  if (options.conflicts) {
    const more = conflictSpans(line, scenario, path, options.conflicts);
    extras.spans = {
      forward: [...extras.spans.forward, ...more.forward],
      backward: extras.spans.backward.length ? [...extras.spans.backward, ...more.backward] : [],
    };
  }
  // Every stop, signal and entry into a shared section can cost a stop and a start.
  const rates = lineRates(line, scenario);
  const stopsUpper =
    (events.length + extras.spans.forward.length + extras.spans.backward.length + 2) *
    stopLossS(line.maxSpeedKmh / 3.6, rates.accelMs2, rates.decelMs2);
  const physics = options.constantSpeed ? null : physicsModel(line, scenario, path.lengthM);
  // Physics can be slower than the placeholder speeds (upgrades, low power): bound by both.
  const fullRunS = Math.max(
    speedAt(0, longest),
    physics ? physicsRun(physics, 0, longest, 0, 0).durationS : 0,
  );
  const maxTripS =
    2 * (fullRunS + layoverS) +
    2 * events.reduce((t, e) => t + (e.durationS ?? 0), 0) +
    2 * signalCount * maxSignalWait +
    2 * stopsUpper +
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
    rates: options.constantSpeed ? null : lineRates(line, scenario),
    heightProfile: lineHeightProfile(scenario, line),
    physics,
    stops: [...stopAt]
      .map(([stationId, chainageM]) => ({ stationId, chainageM }))
      .sort((a, b) => a.chainageM - b.chainageM),
    fleet: 0,
    timetable: null,
    vehicleOf: new Map(),
    tripsOf: new Map(),
    ready: new Map(),
    stabling: null,
    vehicleCodes: [],
  };
}

/** Train physics for a line whose vehicle profile gives mass and traction power. */
export function physicsModel(
  line: TransportLine,
  scenario: Scenario,
  lengthM: number,
): LinePhysicsModel | null {
  const lp = linePhysics(line, scenario);
  if (!lp) return null;
  const vehicle = scenario.vehicleTypes.find((x) => x.id === line.vehicleTypeId);
  const segs = [...line.segments].sort((a, b) => a.fromFraction - b.fromFraction);
  const heights = lineHeightProfile(scenario, line);
  const curves = lineCurveProfile(scenario, line);
  const L = Math.max(lengthM, 1e-9);
  // Diverging routes of turnouts with a known speed (R5).
  const turnouts =
    line.alignment.kind === 'track' ? divergingRestrictions(scenario.trackNetwork, line.alignment.path) : [];
  const limitAt = (m: number) => {
    const f = Math.min(1, Math.max(0, m / L));
    const t = turnouts.find((r) => f >= r.fromFraction && f <= r.toFraction);
    if (t) return Math.min(baseLimit(f), t.speedKmh / 3.6);
    return baseLimit(f);
  };
  const baseLimit = (f: number) => {
    const seg = segs.find((x) => f >= x.fromFraction && f <= x.toFraction) ?? segs[segs.length - 1];
    const kmh = seg
      ? physicsSpeedKmh(line, seg, vehicle?.maxSpeedKmh)
      : Math.min(line.maxSpeedKmh, vehicle?.maxSpeedKmh ?? Infinity);
    return kmh / 3.6;
  };
  const gradientAt = (m: number) => {
    const f = Math.min(1, Math.max(0, m / L));
    let perMille = 0;
    for (let i = 1; i < heights.length; i++) {
      const a = heights[i - 1]!;
      const b = heights[i]!;
      if (f >= a.fraction && f <= b.fraction && b.fraction > a.fraction) {
        perMille = ((b.heightM - a.heightM) / ((b.fraction - a.fraction) * L)) * 1000;
        break;
      }
    }
    return equivalentGradientPerMille(perMille, radiusAtFraction(curves, f));
  };
  return {
    train: lp.physics,
    lengthM: consistLengthM(line, vehicle) ?? 0,
    limitAt,
    gradientAt,
    notes: lp.notes,
    cache: new Map(),
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
  stops: readonly { stationId: string; chainageM: number }[] = [],
): Pick<LineSimulationModel, 'returnPath' | 'spans' | 'following' | 'vehicleLengthM'> {
  const back = line.direction === 'bidirectional' ? returnCoordinates(scenario, line) : null;
  const returnPath = back && back.length >= 2 ? measurePath(back, false) : null;
  const separation = {
    following: following(scenario.trackNetwork, line.mode),
    vehicleLengthM:
      consistLengthM(
        line,
        scenario.vehicleTypes.find((v) => v.id === line.vehicleTypeId),
      ) ?? parameterValue(scenario.trackNetwork, 'unknownVehicleLengthM'),
  };
  if (line.alignment.kind !== 'track' || !line.alignment.path.length) {
    const whole = (sign: 1 | -1): ResourceSpan[] => [
      { fromM: 0, toM: path.lengthM, resourceId: `line:${line.id}:${sign}`, sign, opposing: false },
    ];
    return { returnPath, ...separation, spans: { forward: whole(1), backward: whole(-1) } };
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
    // Chainage is the middle of the consist: a single-track block is held from the head
    // reaching it until the tail has left it, so it reaches half a train beyond both ends.
    const halfTrain = separation.vehicleLengthM / 2;
    for (const sp of out)
      if (sp.opposing) {
        sp.fromM = Math.max(0, sp.fromM - halfTrain);
        sp.toM = Math.min(path.lengthM, sp.toM + halfTrain);
      }
    return out;
  };
  // Junction, turnout and crossing nodes are zones: one route at a time (R14b).
  const clearance = parameterValue(net, 'crossingClearanceM');
  const spacing = parameterValue(net, 'clearanceMarkerSpacingM');
  const signalled = separation.following.kind === 'signalled';
  const hasReturnPath = line.alignment.kind === 'track' && !!line.alignment.returnPath?.length;
  const speedAtFraction = (f: number) => {
    const seg = line.segments.find((x) => f >= x.fromFraction - 1e-9 && f <= x.toFraction + 1e-9);
    return seg ? segmentSpeedKmh(line, seg) : line.maxSpeedKmh;
  };
  const nodes = new Map(net.nodes.map((n) => [n.id, n]));
  const zones = (steps: typeof line.alignment.path, reverseMap: boolean): ResourceSpan[] => {
    const total = stepsLengthM(net, steps);
    if (total <= 0) return [];
    const scale = path.lengthM / total;
    const out: ResourceSpan[] = [];
    let at = 0;
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i]!;
      const t = byId.get(st.trackId);
      if (!t) continue;
      at += Math.abs(st.to - st.from) * trackGeometry(net, t).lengthM * scale;
      const nx = steps[i + 1];
      if (!nx) continue;
      const exitEnd = st.to >= st.from ? 'end' : 'start';
      const nodeId = exitEnd === 'end' ? t.toNodeId : t.fromNodeId;
      const node = nodes.get(nodeId);
      if (!node || (nodeEnds(net, nodeId).length < 3 && !node.turnout)) continue;
      const entryEnd = nx.to >= nx.from ? 'start' : 'end';
      const route = `${st.trackId}:${exitEnd}>${nx.trackId}:${entryEnd}`;
      // The zone is held from the head reaching the clearance point before the node (for
      // signalled modes, the signal overlap further back) until the tail has passed the
      // clearance point after it. Chainage is the middle of the consist, so the zone
      // reaches half a train further on both sides.
      const half = separation.vehicleLengthM / 2;
      const approachM =
        clearanceDistanceM(net, nodeId, { trackId: st.trackId, end: exitEnd }, spacing) +
        (signalled ? signalOverlapM(net, speedAtFraction(at / path.lengthM)) : 0);
      const departM = clearanceDistanceM(net, nodeId, { trackId: nx.trackId, end: entryEnd }, spacing);
      // Run both ways on the same spans (no separate way back): the larger reach on both sides.
      const both = !reverseMap && line.direction === 'bidirectional' && !hasReturnPath;
      const before = (both ? Math.max(approachM, departM) : approachM) + half;
      const after = (both ? Math.max(approachM, departM) : departM) + half;
      const atM = reverseMap ? path.lengthM - at : at;
      out.push({
        fromM: Math.max(0, reverseMap ? atM - after : atM - before),
        toM: Math.min(path.lengthM, reverseMap ? atM + before : atM + after),
        resourceId: `zone:${nodeId}`,
        sign: 1,
        opposing: false,
        exclusive: true,
        route,
        label: nodeId,
      });
    }
    return out;
  };
  // A platform track holds one train at a time (any line, either direction): a train
  // waits with its head behind the tail of the one standing there.
  const platforms = (steps: typeof line.alignment.path, reverseMap: boolean): ResourceSpan[] => {
    const total = stepsLengthM(net, steps);
    if (total <= 0) return [];
    const scale = path.lengthM / total;
    const ranges: { trackId: string; a: number; b: number }[] = [];
    let at = 0;
    for (const st of steps) {
      const t = byId.get(st.trackId);
      if (!t) continue;
      const len = Math.abs(st.to - st.from) * trackGeometry(net, t).lengthM * scale;
      ranges.push({
        trackId: st.trackId,
        a: reverseMap ? path.lengthM - at - len : at,
        b: reverseMap ? path.lengthM - at : at + len,
      });
      at += len;
    }
    const reach = separation.vehicleLengthM + clearance;
    return stops.flatMap((stop) => {
      const r = ranges.find((x) => stop.chainageM >= x.a - 0.01 && stop.chainageM <= x.b + 0.01);
      if (!r) return [];
      return [
        {
          fromM: Math.max(0, stop.chainageM - reach),
          toM: Math.min(path.lengthM, stop.chainageM + reach),
          resourceId: `platform:${stop.stationId}:${r.trackId}`,
          sign: 1 as const,
          opposing: false,
          exclusive: true,
          label: stop.stationId,
        },
      ];
    });
  };
  const forward = [
    ...toSpans(line.alignment.path, false),
    ...zones(line.alignment.path, false),
    ...platforms(line.alignment.path, false),
  ];
  const backward = line.alignment.returnPath?.length
    ? [
        ...toSpans(line.alignment.returnPath, true),
        ...zones(line.alignment.returnPath, true),
        ...platforms(line.alignment.returnPath, true),
      ]
    : [];
  return { returnPath, ...separation, spans: { forward, backward } };
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
    following: { kind: 'signalled', distanceM: 0 },
    vehicleLengthM: 0,
    context: privateContext(),
    rank: 0,
    consist: null,
    ring: false,
    rates: null,
    heightProfile: [],
    physics: null,
    fleet: 0,
    timetable: null,
    vehicleOf: new Map(),
    tripsOf: new Map(),
    ready: new Map(),
    stabling: null,
    vehicleCodes: [],
    stops: [],
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
  delayS = 0,
): Phase[] {
  const phases: Phase[] = [];
  /** Sections reserved on this trip, to be released when the train has actually left them. */
  const bookings: { r: Reservation; span: ResourceSpan; dir: 1 | -1; from: number; atEnd: boolean }[] = [];
  /** Section entries already reserved together with a junction ahead of them. */
  const claimed = new Set<StopEvent>();
  let t = departS;
  if (delayS > 0) {
    // Late back from its previous trip: the vehicle leaves as soon as it is ready.
    phases.push({ kind: 'layover', chainageM: svc.startM, direction: 1, durationS: delayS, late: true });
    t += delayS;
  }
  // A section is entered before the stop at its start, so the platform is held while the
  // vehicle stands there.
  const ORDER = { enter: 0, dwell: 1, signal: 2, hold: 3 } as const;
  /** Fixed layover at the end of a leg (none on a ring: it runs straight on). */
  const layoverAfter = () => (svc.pattern === 'ring' ? 0 : svc.layoverS);
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
          // Running the outbound spans backwards takes the opposite route through a zone.
          span: {
            ...sp,
            fromM: a,
            toM: b,
            sign,
            route: sp.route && dir === -1 && !model.spans.backward.length ? `${sp.route}<` : sp.route,
          },
        };
      });
    const evs = [...dirEvents, ...enters].sort(
      (x, y) => (x.chainageM - y.chainageM) * dir || ORDER[x.kind] - ORDER[y.kind],
    );
    let pos = from;
    // Speed at `pos` (m/s): every leg starts from standstill.
    let speed = 0;
    // Places the vehicle certainly stops at (stops with a dwell, fixed holds, the end of the leg).
    const certainStops = [
      ...dirEvents.filter((x) => (x.kind === 'dwell' || x.kind === 'hold') && (x.durationS ?? 0) > 0),
      { chainageM: to },
    ].map((x) => x.chainageM);
    const nextStopFrom = (c: number) =>
      Math.min(...certainStops.map((x) => (x - c) * dir).filter((dx) => dx >= -1e-9), Infinity);
    /** Run from `pos` to `target`; with `stop`, brake to standstill there. */
    const run = (target: number, stop: boolean) => {
      const cruiseS = model.speedAt(pos, target);
      const d = Math.abs(target - pos);
      const rates = model.rates;
      const ph = model.physics;
      if (ph && rates && d > 0) {
        const env = physicsRun(ph, pos, target, speed, stop ? 0 : aheadCap(ph, target, rates.decelMs2));
        if (env.stalled)
          model.context.warnings.add(
            `${model.lineId}: the train cannot hold its speed on an upgrade and crawls; check power, mass and gradient.`,
          );
        phases.push({
          kind: 'run',
          fromM: pos,
          toM: target,
          direction: dir,
          durationS: env.durationS,
          envelope: env,
        });
        t += env.durationS;
        speed = env.v1;
      } else if (!rates || cruiseS <= 0 || d <= 0) {
        phases.push({ kind: 'run', fromM: pos, toM: target, direction: dir, durationS: cruiseS });
        t += cruiseS;
        speed = 0;
      } else {
        // Never so fast that the next certain stop cannot be reached with service braking.
        const capEnd = Math.sqrt(2 * rates.decelMs2 * Math.max(0, nextStopFrom(target)));
        const prof = speedProfile(d, d / cruiseS, speed, stop ? 0 : capEnd, rates.accelMs2, rates.decelMs2);
        const durationS = profileDuration(prof);
        phases.push({ kind: 'run', fromM: pos, toM: target, direction: dir, durationS, profile: prof });
        t += durationS;
        speed = prof.v1;
      }
      pos = target;
    };
    /**
     * Highest speed at `target` from which every speed limit ahead, and the next certain
     * stop, can still be met with service braking.
     */
    const aheadCap = (ph: LinePhysicsModel, target: number, b: number) => {
      const stopAt = nextStopFrom(target);
      const span = Math.min(stopAt, 3000);
      let cap = Number.isFinite(stopAt) ? Math.sqrt(2 * b * stopAt) : Infinity;
      for (let x = 0; x <= span; x += 10)
        cap = Math.min(cap, Math.sqrt(ph.limitAt(target + dir * x) ** 2 + 2 * b * x));
      return cap;
    };
    /** The vehicle has to stop where it is: re-time the run just before to brake into it. */
    const brakeHere = () => {
      const last = phases[phases.length - 1];
      if (speed > 0 && last?.kind === 'run' && last.envelope && model.physics) {
        const env = physicsRun(model.physics, last.fromM, last.toM, last.envelope.v0, 0);
        t += env.durationS - last.durationS;
        phases[phases.length - 1] = { ...last, durationS: env.durationS, envelope: env };
        speed = 0;
        return;
      }
      if (speed <= 0 || !last || last.kind !== 'run' || !last.profile || !model.rates) {
        speed = 0;
        return;
      }
      const p0 = last.profile;
      const prof = speedProfile(p0.d, Math.max(p0.vp, p0.v0, 1e-6), p0.v0, 0, p0.a, model.rates.decelMs2);
      const durationS = profileDuration(prof);
      t += durationS - last.durationS;
      phases[phases.length - 1] = { ...last, durationS, profile: prof };
      speed = 0;
    };
    /** What a vehicle asks of the ledger for a section, from here. */
    const request = (sp: ResourceSpan) => {
      const cruiseS = model.speedAt(sp.fromM, sp.toM);
      // Stops in the section, its ends included: the vehicle stands in it while it dwells.
      const inside = dirEvents.filter(
        (x) => x.kind === 'dwell' && x.chainageM >= sp.fromM - 0.01 && x.chainageM <= sp.toM + 0.01,
      );
      let dwellS = inside.reduce((sum, x) => sum + (x.durationS ?? 0), 0);
      // Starting from a stop and stopping inside take longer than cruising through.
      const vSpan = (sp.toM - sp.fromM) / Math.max(cruiseS, 1e-6);
      const runS = model.rates
        ? cruiseS + (inside.length + 1) * stopLossS(vSpan, model.rates.accelMs2, model.rates.decelMs2)
        : cruiseS;
      // A section that reaches the end of the leg is held through the fixed layover there
      // too. (The wait for the vehicle's next departure beyond it is spent clear of the
      // platform, as at a turnback siding: with the fleet sized to the cycle, the next
      // vehicle arrives only after it has left.)
      const atEnd = dir === 1 ? sp.toM >= to - 0.01 : sp.fromM <= to + 0.01;
      if (atEnd && svc.pattern !== 'ring') dwellS += svc.layoverS;
      const lengthM = Math.max(1e-6, sp.toM - sp.fromM);
      // Time to keep behind the vehicle ahead: on sight, the steady-state gap of the
      // Intelligent Driver Model (minimum gap + speed × time gap) plus that vehicle's length.
      const vAvg = lengthM / Math.max(cruiseS, 1e-6);
      const f = model.following;
      const separationS =
        f.kind === 'on_sight'
          ? f.timeGapS + (f.minGapM + model.vehicleLengthM) / Math.max(vAvg, 0.1)
          : (f.distanceM * runS) / lengthM;
      return {
        resourceId: sp.resourceId,
        sign: sp.sign,
        opposing: sp.opposing,
        durationS: runS + dwellS,
        separationS: sp.exclusive ? 0 : separationS,
        queue: `${model.lineId}:${svc.id}:${dir}`,
        exclusive: sp.exclusive ?? false,
        // A train turning at a terminal platform does not wait for itself.
        route: sp.resourceId.startsWith('platform:') ? `trip:${model.lineId}:${svc.id}:${departS}` : sp.route,
        atEnd,
      };
    };
    for (const e of evs) {
      if (e.chainageM !== pos)
        run(e.chainageM, (e.kind === 'dwell' || e.kind === 'hold') && (e.durationS ?? 0) > 0);
      if (e.kind === 'enter' && !scheduled) continue;
      if (e.kind === 'enter') {
        if (claimed.has(e)) continue;
        // Route setting: at a junction the train asks for the junction and the sections
        // just beyond it together, and goes only when all are free (or held by a train
        // ahead running the same way at a safe distance); otherwise it waits clear of
        // the junction.
        const sp = e.span!;
        const group: { ev: StopEvent; leadS: number }[] = [{ ev: e, leadS: 0 }];
        if (sp.resourceId.startsWith('zone:')) {
          const exitM = dir === 1 ? sp.toM : sp.fromM;
          for (const x of evs)
            if (
              x !== e &&
              x.kind === 'enter' &&
              !claimed.has(x) &&
              (x.chainageM - e.chainageM) * dir > 1e-6 &&
              (exitM - x.chainageM) * dir >= -1e-6
            )
              group.push({
                ev: x,
                leadS: model.speedAt(Math.min(pos, x.chainageM), Math.max(pos, x.chainageM)),
              });
        }
        const reqs = group.map(({ ev, leadS }) => ({ ...request(ev.span!), leadS, ev }));
        let start = t;
        for (let guard = 0; guard < 100; guard++) {
          const next = Math.max(
            ...reqs.map((q) =>
              model.context.ledger.earliest(
                q.resourceId,
                q.sign,
                q.opposing,
                start,
                q.leadS + q.durationS,
                q.separationS,
                q.queue,
                q.exclusive,
                q.route,
              ),
            ),
          );
          if (next <= start + 1e-9) break;
          start = next;
        }
        for (const q of reqs) {
          const r = model.context.ledger.book(
            q.resourceId,
            q.sign,
            start,
            q.leadS + q.durationS,
            q.queue,
            q.route,
          );
          bookings.push({ r, span: q.ev.span!, dir, from: phases.length, atEnd: q.atEnd });
          claimed.add(q.ev);
        }
        let wait = start - t;
        if (wait > 1e-6) {
          // The vehicle brakes to wait before the occupied section.
          brakeHere();
          wait = Math.max(0, start - t);
        }
        if (wait > 1e-6) {
          phases.push({
            kind: 'occupied',
            chainageM: pos,
            direction: dir,
            durationS: wait,
            resourceId: sp.resourceId,
            resourceLabel: sp.label,
          });
          t += wait;
          if (wait > model.headwayS)
            model.context.warnings.add(
              `${model.lineId}: vehicles wait longer than the headway for occupied track; the timetable exceeds the capacity of the section.`,
            );
        }
        continue;
      }
      let wait =
        e.kind === 'signal' && e.signal
          ? signalWaitS(e.signal, t, model.signalPriorityS)
          : (e.durationS ?? 0);
      if (wait > 0 && e.kind === 'signal' && e.signal) {
        // Red: brake to the stop line, then wait for green from the later arrival.
        brakeHere();
        wait = signalWaitS(e.signal, t, model.signalPriorityS);
      }
      if (wait > 0) {
        phases.push({ kind: e.kind, chainageM: pos, direction: dir, durationS: wait });
        t += wait;
        speed = 0;
      }
    }
    if (pos !== to) run(to, true);
  };
  leg(1);
  if (svc.pattern === 'shuttle') {
    phases.push({ kind: 'layover', chainageM: svc.endM, direction: 1, durationS: svc.layoverS });
    // The way back starts after the layover (signal and occupancy times depend on it).
    t += svc.layoverS;
    leg(-1);
    phases.push({ kind: 'layover', chainageM: svc.startM, direction: -1, durationS: layoverAfter() });
  } else if (svc.pattern === 'one_way') {
    phases.push({ kind: 'layover', chainageM: svc.endM, direction: 1, durationS: svc.layoverS });
  }
  releaseAtExit(phases, departS, bookings);
  return phases.filter((p) => p.durationS > 0);
}

/**
 * Set each reservation of a trip to end when the train actually left the section: the
 * middle of the train passing the section's far end (which already reaches half a train
 * beyond the track), or turning back. A section at the end of a leg is never held longer
 * than reserved (the wait beyond the fixed layover is spent clear of it).
 */
function releaseAtExit(
  phases: readonly Phase[],
  departS: number,
  bookings: readonly { r: Reservation; span: ResourceSpan; dir: 1 | -1; from: number; atEnd: boolean }[],
) {
  const starts: number[] = [];
  let t = departS;
  for (const p of phases) {
    starts.push(t);
    t += p.durationS;
  }
  const endS = t;
  for (const b of bookings) {
    const exitM = b.dir === 1 ? b.span.toM : b.span.fromM;
    let left = endS;
    for (let i = b.from; i < phases.length; i++) {
      const p = phases[i]!;
      if (p.direction !== b.dir) {
        left = starts[i]!;
        break;
      }
      if (b.atEnd || p.kind !== 'run') continue;
      if ((p.toM - exitM) * b.dir >= -1e-6) {
        const span = Math.abs(p.toM - p.fromM);
        const f = span > 0 ? Math.min(1, Math.max(0, Math.abs(exitM - p.fromM) / span)) : 1;
        left = starts[i]! + p.durationS * f;
        break;
      }
    }
    b.r.exit = b.atEnd ? Math.min(b.r.exit, left) : Math.max(b.r.enter, left);
  }
}

export function tripPhases(model: LineSimulationModel, svc: ServiceModel, j: number): Phase[] {
  const key = `${svc.id}:${j}`;
  let phases = model.cache.get(key);
  if (phases) return phases;
  if (j >= model.context.firstIndex(model)) {
    // Scheduled in global order with every other line of the context.
    model.context.ensure(departOf(model, j));
    phases = model.cache.get(key);
  }
  if (!phases) {
    phases = buildTrip(model, svc, departOf(model, j));
    model.cache.set(key, phases);
  }
  return phases;
}

/** Duration of trip 0 of the first service (a full round trip without signal waits beyond trip 0's). */
export function roundTripS(model: LineSimulationModel): number {
  const svc = model.services[0];
  if (!svc) return 0;
  return tripPhases(model, svc, 0).reduce((s, p) => s + p.durationS, 0);
}

/**
 * Where every vehicle of a line is at simulated time `tS` (seconds since start).
 * A trip departs every headway from the start of each service (also before
 * t = 0, so the line is already populated); a trip is one vehicle's round trip.
 */
/** A vehicle on its empty run to or from its depot slot, or stabled there. */
function depotState(
  model: LineSimulationModel,
  run: DepotRun,
  tS: number,
  endS: number,
  startS: number,
  id: string,
): VehicleState {
  let path = run.out;
  let d = run.out.lengthM;
  let state: VehicleState['state'] = 'parked';
  if (Number.isFinite(endS) && tS < endS + run.outS) {
    d = ((tS - endS) / Math.max(run.outS, 1e-9)) * run.out.lengthM;
    state = 'deadhead';
  } else if (Number.isFinite(startS) && tS >= startS - run.backS) {
    path = run.back;
    d = ((tS - (startS - run.backS)) / Math.max(run.backS, 1e-9)) * run.back.lengthM;
    state = 'deadhead';
  }
  const { position, bearingDeg } = interpolate(path, d);
  return {
    id,
    lineId: model.lineId,
    color: model.color,
    chainageM: 0,
    position,
    bearingDeg,
    direction: 1,
    state,
    footprint: model.consist ? consistFootprint(path, d, 1, model.consist, false) : [],
    heightM: 0,
  };
}

/** Where a vehicle is `local` seconds into a trip (clamped to the trip's end). */
function stateOnTrip(
  model: LineSimulationModel,
  phases: readonly Phase[],
  localIn: number,
  id: string,
): VehicleState | null {
  let local = localIn;
  const total = phases.reduce((x, p) => x + p.durationS, 0);
  if (local >= total) local = total - 1e-6;
  for (const p of phases) {
    if (local < p.durationS) {
      let chainageM: number;
      let state: VehicleState['state'];
      if (p.kind === 'run') {
        const f = p.envelope
          ? envelopeDistance(p.envelope, local) / Math.max(p.envelope.d, 1e-9)
          : p.profile
            ? profileDistance(p.profile, local) / Math.max(p.profile.d, 1e-9)
            : local / p.durationS;
        chainageM = p.fromM + (p.toM - p.fromM) * Math.min(1, f);
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
      return {
        id,
        lineId: model.lineId,
        color: model.color,
        chainageM,
        position,
        bearingDeg: heading,
        direction: p.direction,
        state,
        footprint,
        heightM: heightAtFraction(model.heightProfile, chainageM / Math.max(model.path.lengthM, 1e-9)),
      };
    }
    local -= p.durationS;
  }
  return null;
}

/**
 * Where every vehicle of a line is at simulated time `tS` (seconds since midnight of the
 * first day with a timetable, else since start). With a fleet, every vehicle is always
 * somewhere: on its latest trip, at the end of it until its next one, or, before its
 * first trip, out of service at the start of the line. Without a fleet (one-way lines),
 * every trip that may still run.
 */
export function vehicleStates(model: LineSimulationModel, tS: number): VehicleState[] {
  const out: VehicleState[] = [];
  for (const svc of model.services) {
    const last = lastTripAt(model, tS);
    // Schedule every trip up to now (in global order with the other lines).
    if (last !== null) tripPhases(model, svc, last);
    if (model.fleet > 0) {
      // Vehicles may leave a depot before their next trip: know the trips just ahead.
      const look = model.stabling ? Math.max(0, ...[...model.stabling.values()].map((r) => r.backS)) : 0;
      if (look > 0) {
        const ahead = lastTripAt(model, tS + look);
        if (ahead !== null) tripPhases(model, svc, ahead);
      }
      for (let k = 0; k < model.fleet; k++) {
        const id = model.vehicleCodes[k] ?? `${model.lineId}-${svc.id}-v${k + 1}`;
        const list = model.tripsOf.get(`${svc.id}:${k}`) ?? [];
        let i = list.length - 1;
        while (i >= 0 && departOf(model, list[i]!) > tS) i--;
        // Out of service long enough to run to its depot slot and back: it stables there.
        const run = model.stabling?.get(k);
        if (run) {
          const endS =
            i >= 0
              ? departOf(model, list[i]!) +
                tripPhases(model, svc, list[i]!).reduce((x, p) => x + p.durationS, 0)
              : -Infinity;
          const next = list[i + 1];
          const startS = next !== undefined ? departOf(model, next) : Infinity;
          if (tS >= endS && startS - endS >= run.outS + run.backS) {
            out.push(depotState(model, run, tS, endS, startS, id));
            continue;
          }
        }
        if (i >= 0) {
          let j = list[i]!;
          let phases = tripPhases(model, svc, j);
          // Late back from its previous trip: still on that one.
          const lead = phases[0];
          if (lead?.kind === 'layover' && lead.late && tS - departOf(model, j) < lead.durationS && i > 0) {
            j = list[i - 1]!;
            phases = tripPhases(model, svc, j);
          }
          const st = stateOnTrip(model, phases, tS - departOf(model, j), id);
          if (st) out.push(st);
        } else {
          // Not out yet today: waiting out of service at the start of the line.
          const st = stateOnTrip(
            model,
            [{ kind: 'layover', chainageM: svc.startM, direction: 1, durationS: 1 }],
            0,
            id,
          );
          if (st) out.push({ ...st, state: 'parked' });
        }
      }
      // Spares: not needed in service, they wait in their depot slots.
      for (let k = model.fleet; k < model.vehicleCodes.length; k++) {
        const run = model.stabling?.get(k);
        if (run) out.push(depotState(model, run, tS, -Infinity, Infinity, model.vehicleCodes[k]!));
      }
      continue;
    }
    if (last === null) continue;
    const first = Math.max(lastTripAt(model, tS - 3 * model.maxTripS) ?? 0, model.timetable ? 0 : -Infinity);
    for (let j = last; j >= first; j--) {
      const local = tS - departOf(model, j);
      if (local < 0) continue;
      const phases = tripPhases(model, svc, j);
      if (local >= phases.reduce((x, p) => x + p.durationS, 0)) continue;
      const st = stateOnTrip(model, phases, local, `${model.lineId}-${svc.id}-t${j}`);
      if (st) out.push(st);
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
    m.vehicleCodes = lineVehicles(scenario, m.lineId).map((v) => v.code);
  }
  // Depot tracks (F6): with the service day, vehicles out of service wait in depot slots.
  if (options?.timetable) {
    const speedMs = parameterValue(scenario.trackNetwork, 'depotRunSpeedKmh') / 3.6;
    const byId = new Map(models.map((m) => [m.lineId, m]));
    const modes = new Set(scenario.lines.filter((l) => l.alignment.kind === 'track').map((l) => l.mode));
    for (const mode of modes) {
      const vehicles = new Map(
        scenario.lines
          .filter((l) => l.mode === mode && (byId.get(l.id)?.fleet ?? 0) > 0)
          .map((l) => [l.id, Math.max(byId.get(l.id)!.fleet, byId.get(l.id)!.vehicleCodes.length)]),
      );
      const { slots } = assignStabling(scenario, mode, vehicles);
      for (const [key, slot] of slots) {
        const [lineId, k] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))];
        const m = byId.get(lineId);
        const outC = stepsCoordinates(scenario, slot.out);
        const backC = stepsCoordinates(scenario, slot.back);
        if (!m || outC.length < 2 || backC.length < 2) continue;
        const out = measurePath(outC, false);
        const back = measurePath(backC, false);
        m.stabling ??= new Map();
        m.stabling.set(k, { out, back, outS: out.lengthM / speedMs, backS: back.lengthM / speedMs });
      }
    }
    // Street modes (F5): vehicles drive to their depot and back on the stored street routes
    // only; a line without a routed link keeps its vehicles at the line end.
    const allocation = allocateDepots(scenario);
    const parkedAt = new Map<string, number>();
    for (const m of models) {
      const line = scenario.lines.find((l) => l.id === m.lineId);
      if (!line || !isDepotMode(line.mode) || m.fleet <= 0) continue;
      const shape = m.consist;
      m.vehicleCodes.forEach((code, k) => {
        const depot = scenario.depots.find((d) => d.id === allocation.get(code));
        const link = depot?.links[line.id];
        if (!depot || !link || link.toLine.status !== 'routed' || link.fromLine.status !== 'routed') return;
        const n = parkedAt.get(depot.id) ?? 0;
        parkedAt.set(depot.id, n + 1);
        const net = scenario.trackNetwork;
        const spot = parkingSpot(
          depot,
          n,
          shape ? shape.unitLengthM * shape.units : parameterValue(net, 'unknownVehicleLengthM'),
          shape ? shape.widthM : parameterValue(net, 'unknownVehicleWidthM'),
        );
        const out = measurePath([...link.fromLine.coordinates, spot], false);
        const back = measurePath([spot, ...link.toLine.coordinates], false);
        const speed = Math.max(1, line.maxSpeedKmh / 3.6);
        m.stabling ??= new Map();
        m.stabling.set(k, {
          out,
          back,
          outS: link.fromLine.durationS ?? out.lengthM / speed,
          backS: link.toLine.durationS ?? back.lengthM / speed,
        });
      });
    }
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
  reset(toS = 0) {
    this.seek(toS);
  }
  /** Jump to a simulated time (seconds). */
  seek(toS: number) {
    this.simS = Math.max(0, toS);
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
