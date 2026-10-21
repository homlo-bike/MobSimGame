/**
 * Running time from train physics (R15a). Pure.
 *
 * The methods are taken from two published descriptions and written here from them (no
 * code of either project is used):
 *
 * - OSRD, "Running time calculation" (Open Rail Association / SNCF Réseau): Newton's law
 *   along the track, a(v, x) = [F(v) − R(v) − m·g·i(x)] / m with the Davis running
 *   resistance R(v) = A + B·v + C·v², the gradient i(x) plus the curve term 800 / r (per
 *   mille, r in metres), and the envelope pipeline: most restrictive speed profile (with
 *   the train length: a train speeds up only once its tail has left a slower section),
 *   braking curves built backwards from every stop and speed drop at a constant
 *   deceleration, acceleration curves integrated forward (Runge-Kutta 4), and the lower
 *   of all curves wins.
 * - NeTrainSim (Aredah, Fadhloun and Rakha, Railway Engineering Science 32(4), 2024,
 *   CC BY 4.0): tractive force F(v) = min(1000·P / v, μ·m·g) — power-limited at speed,
 *   adhesion-limited at start.
 *
 * The integration runs over distance in steps of a few metres, so the result is a pure
 * function of the inputs and never depends on the frame rate.
 */
import type { Scenario, TransportLine } from '../domain/schema';
import { parameterValue } from '../domain/trackParameters';
import { lineRates } from './kinematics';

export const OSRD_RUNNING_TIME_SOURCE =
  'OSRD documentation, "Running time calculation": physical modelling, numerical integration and envelope pipeline (Open Rail Association, osrd.fr/en/docs/explanation/running_time_calculation/, read 21 October 2026).';
export const NETRAINSIM_SOURCE =
  'Aredah A.S., Fadhloun K., Rakha H.A. (2024), NeTrainSim: a network-level simulator for modeling freight train longitudinal motion and energy consumption, Railway Engineering Science 32(4):480–498, doi:10.1007/s40534-024-00331-x (CC BY 4.0), Eq. 4.';

const G = 9.80665;

export interface TrainPhysics {
  /** Mass of the consist in service (kg). */
  massKg: number;
  /** Traction power at the wheel (W). */
  powerW: number;
  /** Highest tractive force (N): starting tractive effort, else adhesion μ·m·g. */
  maxForceN: number;
  /** Davis running resistance R(v) = A + B·v + C·v² (N, v in m/s). */
  davis: { a: number; b: number; c: number };
  /** Constant service deceleration used for braking curves (m/s²). */
  decelMs2: number;
  /** Comfort limit on acceleration from the vehicle profile (m/s²), if given. */
  accelCapMs2: number | null;
}

/** Tractive force at speed v (N): power-limited, never above the starting effort. */
export function tractiveForceN(p: TrainPhysics, v: number): number {
  return v > 0 ? Math.min(p.powerW / v, p.maxForceN) : p.maxForceN;
}

export function davisResistanceN(p: TrainPhysics, v: number): number {
  return p.davis.a + p.davis.b * v + p.davis.c * v * v;
}

/**
 * Equivalent gradient (per mille, uphill positive) of the line gradient plus the curve
 * term 800 / r (r in metres), as in OSRD's weight projection i(x) = s(x) + 800 / r(x).
 */
export function equivalentGradientPerMille(gradientPerMille: number, radiusM: number | null): number {
  return gradientPerMille + (radiusM && radiusM > 0 ? 800 / radiusM : 0);
}

/** Acceleration at full traction (m/s²) at speed v on an equivalent gradient (per mille). */
export function maxAcceleration(p: TrainPhysics, v: number, gradientPerMille: number): number {
  const i = gradientPerMille / 1000;
  const a = (tractiveForceN(p, v) - davisResistanceN(p, v) - p.massKg * G * i) / p.massKg;
  return p.accelCapMs2 !== null ? Math.min(a, p.accelCapMs2) : a;
}

/** What the track looks like along one run, measured from the start of the run. */
export interface RunTrack {
  lengthM: number;
  /** Speed limit at distance x (m/s). */
  limitAt: (x: number) => number;
  /** Equivalent gradient at x (per mille, positive uphill in the direction of travel). */
  gradientAt: (x: number) => number;
}

/** Speed over a run: distances from its start, speeds and times at those points. */
export interface Envelope {
  d: number;
  xs: number[];
  vs: number[];
  ts: number[];
  v0: number;
  v1: number;
  durationS: number;
  /** True when traction could not hold the train on an upgrade (it crawled). */
  stalled: boolean;
}

/** The slowest a train may crawl at in the integration (m/s), to keep times finite. */
const CRAWL = 0.5;

/**
 * Fastest run from speed `v0` to end speed `v1` (m/s) over the track: the most
 * restrictive speed profile (stretched by the train length where the limit rises),
 * braking curves backwards, the acceleration curve forwards; the lowest wins.
 */
export function runEnvelope(
  p: TrainPhysics,
  track: RunTrack,
  v0In: number,
  v1In: number,
  trainLengthM: number,
  stepM = 5,
): Envelope {
  const d = Math.max(0, track.lengthM);
  const n = Math.max(1, Math.min(4000, Math.ceil(d / stepM)));
  const dx = d / n;
  const xs = Array.from({ length: n + 1 }, (_, i) => i * dx);
  // Most restrictive speed profile, held until the train's tail clears a slower section.
  const raw = xs.map((x) => Math.max(0, track.limitAt(x)));
  const back = Math.max(0, Math.round(trainLengthM / Math.max(dx, 1e-9)));
  const mrsp = raw.map((_, i) => {
    let m = raw[i]!;
    for (let k = Math.max(0, i - back); k < i; k++) m = Math.min(m, raw[k]!);
    // The tail is still behind the start of the run: the limit at the start holds there too.
    if (i * dx < trainLengthM) m = Math.min(m, track.limitAt(0));
    return m;
  });
  // Braking curves backwards from the end speed and from every speed drop.
  const v1 = Math.min(Math.max(0, v1In), mrsp[n]!);
  const brake = new Array<number>(n + 1);
  brake[n] = v1;
  for (let i = n - 1; i >= 0; i--)
    brake[i] = Math.min(mrsp[i]!, Math.sqrt(brake[i + 1]! ** 2 + 2 * p.decelMs2 * dx));
  // Acceleration forwards (RK4 on kinetic energy per mass, E = v²/2, dE/dx = a(v, x)).
  const vs = new Array<number>(n + 1);
  vs[0] = Math.min(Math.max(0, v0In), brake[0]!);
  let stalled = false;
  const acc = (e: number, x: number) =>
    maxAcceleration(p, Math.sqrt(Math.max(0, 2 * e)), track.gradientAt(x));
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const e = (vs[i]! * vs[i]!) / 2;
    const k1 = acc(e, x);
    const k2 = acc(e + (k1 * dx) / 2, x + dx / 2);
    const k3 = acc(e + (k2 * dx) / 2, x + dx / 2);
    const k4 = acc(e + k3 * dx, x + dx);
    const eNext = e + ((k1 + 2 * k2 + 2 * k3 + k4) * dx) / 6;
    let v = Math.sqrt(Math.max(0, 2 * eNext));
    if (v < CRAWL && brake[i + 1]! > CRAWL) {
      stalled = stalled || eNext < e;
      v = CRAWL;
    }
    vs[i + 1] = Math.min(v, brake[i + 1]!);
  }
  // Time over each step at constant acceleration: dt = 2·dx / (v_i + v_{i+1}).
  const ts = [0];
  for (let i = 0; i < n; i++) {
    const sum = vs[i]! + vs[i + 1]!;
    ts.push(ts[i]! + (sum > 0 ? (2 * dx) / sum : 0));
  }
  return { d, xs, vs, ts, v0: vs[0]!, v1: vs[n]!, durationS: ts[n]!, stalled };
}

/** Distance from the start of the run after `tau` seconds (0…d). */
export function envelopeDistance(e: Envelope, tau: number): number {
  if (tau <= 0) return 0;
  if (tau >= e.durationS) return e.d;
  let lo = 0;
  let hi = e.ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (e.ts[mid]! <= tau) lo = mid;
    else hi = mid;
  }
  // Constant acceleration within the step.
  const dt = e.ts[hi]! - e.ts[lo]!;
  const dx = e.xs[hi]! - e.xs[lo]!;
  if (dt <= 0) return e.xs[lo]!;
  const v0 = e.vs[lo]!;
  const a = (e.vs[hi]! - v0) / dt;
  const s = tau - e.ts[lo]!;
  return e.xs[lo]! + Math.min(dx, v0 * s + 0.5 * a * s * s);
}

// --- From a vehicle profile -----------------------------------------------------------

/** Physics of a line's consist, or null when its vehicle profile lacks mass or power. */
export function linePhysics(
  line: TransportLine,
  scenario: Pick<Scenario, 'vehicleTypes' | 'trackNetwork'>,
): { physics: TrainPhysics; notes: string[] } | null {
  const v = scenario.vehicleTypes.find((x) => x.id === line.vehicleTypeId);
  if (!v?.massT || !v.tractionPowerKw) return null;
  const units = line.consistUnits ?? v.unitsPerConsist;
  const massKg = v.massT * 1000 * units;
  const notes: string[] = [];
  let maxForceN: number;
  if (v.startingTractiveEffortKn) maxForceN = v.startingTractiveEffortKn * 1000 * units;
  else {
    const mu = parameterValue(scenario.trackNetwork, 'adhesionCoefficient');
    maxForceN = mu * massKg * G;
    notes.push(`No starting tractive effort: adhesion limit μ = ${mu} on the whole mass (overstates it).`);
  }
  const davisGiven = v.davisAKn !== null || v.davisBKnPerMs !== null || v.davisCKnPerMs2 !== null;
  if (!davisGiven)
    notes.push('No running resistance (Davis A, B, C): ignored, which understates running times.');
  const rates = lineRates(line, scenario);
  return {
    physics: {
      massKg,
      powerW: v.tractionPowerKw * 1000 * units,
      maxForceN,
      davis: {
        a: (v.davisAKn ?? 0) * 1000 * units,
        b: (v.davisBKnPerMs ?? 0) * 1000 * units,
        c: (v.davisCKnPerMs2 ?? 0) * 1000 * units,
      },
      decelMs2: rates.decelMs2,
      accelCapMs2: v.accelerationMs2,
    },
    notes,
  };
}
