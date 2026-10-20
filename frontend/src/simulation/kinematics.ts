/**
 * Acceleration and braking (R13). Pure.
 *
 * Vehicles accelerate at a constant rate after every stop, cruise, and brake at a
 * constant rate before every stop: the kinematics behind SUMO's vehicle model, written
 * here from the published equations (no SUMO code is used). The rates are the vehicle
 * profile's acceleration and service braking; where a profile gives none, the documented
 * SUMO defaults for the matching vehicle class apply. SUMO notes that these are the
 * comfortable service values, not the maximum a vehicle can achieve.
 */
import type { Scenario, TransportLine, TransportMode } from '../domain/schema';

export const SUMO_VTYPE_DEFAULTS_SOURCE =
  'Eclipse SUMO documentation, "Vehicle Type Parameter Defaults" (DLR and others, page edited 12 October 2026), https://sumo.dlr.de/docs/Vehicle_Type_Parameter_Defaults.html: accel and decel of the vehicle class; SUMO describes them as convenient, not maximum, values.';

export interface Rates {
  accelMs2: number;
  decelMs2: number;
  /** Where the values come from. */
  source: 'vehicle_profile' | 'documented_default';
  /** The SUMO vehicle class whose defaults apply, for the documented default. */
  sumoClass: string;
  note: string;
}

/**
 * SUMO vehicle class defaults per mode. SUMO has no light rail, trolleybus or BRT class
 * and gives no accel for "subway"; the closest documented class is used and named.
 */
const SUMO_CLASS: Record<TransportMode, { cls: string; accel: number; decel: number; note: string }> = {
  bus: { cls: 'bus', accel: 1.2, decel: 4.0, note: '' },
  brt: { cls: 'bus', accel: 1.2, decel: 4.0, note: 'SUMO has no BRT class; bus values.' },
  trolleybus: { cls: 'bus', accel: 1.2, decel: 4.0, note: 'SUMO has no trolleybus class; bus values.' },
  tram: { cls: 'tram', accel: 1.0, decel: 3.0, note: '' },
  light_rail: { cls: 'tram', accel: 1.0, decel: 3.0, note: 'SUMO has no light-rail class; tram values.' },
  metro: {
    cls: 'rail_urban',
    accel: 1.0,
    decel: 3.0,
    note: 'SUMO gives no accel for subway; urban rail (rail_urban) values.',
  },
  elevated_metro: {
    cls: 'rail_urban',
    accel: 1.0,
    decel: 3.0,
    note: 'SUMO gives no accel for subway; urban rail (rail_urban) values.',
  },
  commuter_rail: { cls: 'rail_urban', accel: 1.0, decel: 3.0, note: '' },
  cycling: { cls: 'passenger', accel: 2.6, decel: 4.5, note: 'Not simulated.' },
  pedestrian: { cls: 'passenger', accel: 2.6, decel: 4.5, note: 'Not simulated.' },
  custom: { cls: 'tram', accel: 1.0, decel: 3.0, note: 'Custom mode; tram values.' },
};

/** Acceleration and braking of the documented default for a mode. */
export function defaultRates(mode: TransportMode): Rates {
  const d = SUMO_CLASS[mode];
  return {
    accelMs2: d.accel,
    decelMs2: d.decel,
    source: 'documented_default',
    sumoClass: d.cls,
    note: d.note,
  };
}

/** Acceleration and braking a line's vehicles use: the vehicle profile's, else the mode default. */
export function lineRates(line: TransportLine, scenario: Pick<Scenario, 'vehicleTypes'>): Rates {
  const v = scenario.vehicleTypes.find((x) => x.id === line.vehicleTypeId);
  const d = defaultRates(line.mode);
  if (v?.accelerationMs2 && v.serviceBrakingMs2)
    return { ...d, accelMs2: v.accelerationMs2, decelMs2: v.serviceBrakingMs2, source: 'vehicle_profile' };
  if (v?.accelerationMs2) return { ...d, accelMs2: v.accelerationMs2, source: 'vehicle_profile' };
  if (v?.serviceBrakingMs2) return { ...d, decelMs2: v.serviceBrakingMs2, source: 'vehicle_profile' };
  return d;
}

/**
 * Speed profile over one run section: start at `v0`, accelerate at `a` up to at most the
 * cruise speed, brake at `b` to end at `v1` (m/s). Where the section is too short to
 * brake to `v1` at `b`, the braking is just strong enough to do it.
 */
export interface Profile {
  d: number;
  v0: number;
  vp: number;
  v1: number;
  a: number;
  b: number;
  /** Times of the three parts: accelerate, cruise, brake (s). */
  t1: number;
  t2: number;
  t3: number;
}

export function profile(
  d: number,
  cruise: number,
  v0In: number,
  v1In: number,
  a: number,
  b: number,
): Profile {
  const v = Math.max(cruise, 1e-6);
  const v0 = Math.min(Math.max(0, v0In), v);
  // The end speed cannot be above what the section allows reaching.
  let v1 = Math.min(Math.max(0, v1In), v, Math.sqrt(v0 * v0 + 2 * a * d));
  let bEff = b;
  if (v0 * v0 - v1 * v1 > 2 * b * d) bEff = (v0 * v0 - v1 * v1) / (2 * Math.max(d, 1e-6));
  v1 = Math.min(v1, v);
  const vpMax = Math.sqrt(Math.max(0, (2 * a * bEff * d + bEff * v0 * v0 + a * v1 * v1) / (a + bEff)));
  const vp = Math.max(Math.min(v, vpMax), v0, v1);
  const x1 = (vp * vp - v0 * v0) / (2 * a);
  const x3 = (vp * vp - v1 * v1) / (2 * bEff);
  const x2 = Math.max(0, d - x1 - x3);
  return {
    d,
    v0,
    vp,
    v1,
    a,
    b: bEff,
    t1: (vp - v0) / a,
    t2: vp > 0 ? x2 / vp : 0,
    t3: (vp - v1) / bEff,
  };
}

export function profileDuration(p: Profile): number {
  return p.t1 + p.t2 + p.t3;
}

/** Distance travelled after `tau` seconds of the profile (0…d). */
export function profileDistance(p: Profile, tau: number): number {
  const t = Math.max(0, tau);
  if (t <= p.t1) return p.v0 * t + 0.5 * p.a * t * t;
  const x1 = p.v0 * p.t1 + 0.5 * p.a * p.t1 * p.t1;
  if (t <= p.t1 + p.t2) return x1 + p.vp * (t - p.t1);
  const x2 = p.vp * p.t2;
  const s = Math.min(t - p.t1 - p.t2, p.t3);
  return Math.min(p.d, x1 + x2 + p.vp * s - 0.5 * p.b * s * s);
}

/** Time lost by stopping once from `v` and starting again, compared with passing at `v`. */
export function stopLossS(v: number, a: number, b: number): number {
  return v / (2 * a) + v / (2 * b);
}
