/**
 * Energy of a run from train physics (R15b). Pure.
 *
 * Over each integration step the force at the wheel that produces the simulated motion is
 * F = m·a + R(v) + m·g·i (the equation of motion of trainPhysics.ts solved for the force).
 * Where F is positive the traction supplies F·Δx; where it is negative the brakes absorb
 * −F·Δx. NeTrainSim (Aredah, Fadhloun and Rakha 2024) computes energy from the same
 * forces; the efficiencies from the wheel to the supply, the share of braking energy fed
 * back and the auxiliary power are vehicle inputs here, never defaults: without them only
 * the energy at the wheel is reported.
 */
import type { Envelope, TrainPhysics } from './trainPhysics';
import type { Scenario, TransportLine, VehicleType } from '../domain/schema';
import { tripPhases, type LineSimulationModel } from './engine';

const G = 9.80665;
const J_PER_KWH = 3.6e6;

/** Energy at the wheel over one run (kWh): traction supplied and braking absorbed. */
export function runEnergyKwh(p: TrainPhysics, e: Envelope): { tractionKwh: number; brakingKwh: number } {
  let traction = 0;
  let braking = 0;
  for (let i = 0; i + 1 < e.xs.length; i++) {
    const dx = e.xs[i + 1]! - e.xs[i]!;
    if (dx <= 0) continue;
    const v0 = e.vs[i]!;
    const v1 = e.vs[i + 1]!;
    const v = (v0 + v1) / 2;
    const a = (v1 * v1 - v0 * v0) / (2 * dx);
    const grade = ((e.gs[i] ?? 0) + (e.gs[i + 1] ?? 0)) / 2000;
    const f = p.massKg * a + p.davis.a + p.davis.b * v + p.davis.c * v * v + p.massKg * G * grade;
    if (f > 0) traction += f * dx;
    else braking -= f * dx;
  }
  return { tractionKwh: traction / J_PER_KWH, brakingKwh: braking / J_PER_KWH };
}

export interface EnergyEstimate {
  /** Energy the traction delivers at the wheel (kWh). */
  tractionAtWheelKwh: number;
  /** Energy the brakes absorb (kWh). */
  brakingAtWheelKwh: number;
  /** Distance run (km). */
  distanceKm: number;
  /** Energy drawn from the supply, net of energy fed back (kWh); null without the efficiencies. */
  supplyKwh: number | null;
  /** What is missing for the supply figure, if anything. */
  missing: string[];
}

/** Supply-side energy from the wheel energy and the vehicle's efficiencies (all inputs, none assumed). */
export function supplyEnergy(
  wheel: { tractionKwh: number; brakingKwh: number },
  durationS: number,
  distanceKm: number,
  v: Pick<VehicleType, 'tractionEfficiency' | 'regenerationShare' | 'auxiliaryPowerKw'>,
  units: number,
): EnergyEstimate {
  const missing: string[] = [];
  if (v.tractionEfficiency === null) missing.push('efficiency from supply to wheel');
  if (v.regenerationShare === null) missing.push('share of braking energy fed back');
  if (v.auxiliaryPowerKw === null) missing.push('auxiliary power');
  const supplyKwh =
    missing.length || !v.tractionEfficiency
      ? null
      : wheel.tractionKwh / v.tractionEfficiency -
        wheel.brakingKwh * v.regenerationShare! +
        (v.auxiliaryPowerKw! * units * durationS) / 3600;
  return {
    tractionAtWheelKwh: wheel.tractionKwh,
    brakingAtWheelKwh: wheel.brakingKwh,
    distanceKm,
    supplyKwh,
    missing,
  };
}

/**
 * Energy of one round trip of a line (the first service's first trip), or null when the
 * line runs without train physics.
 */
export function lineRoundTripEnergy(
  model: LineSimulationModel,
  line: TransportLine,
  scenario: Pick<Scenario, 'vehicleTypes'>,
): EnergyEstimate | null {
  const svc = model.services[0];
  const ph = model.physics;
  const v = scenario.vehicleTypes.find((x) => x.id === line.vehicleTypeId);
  if (!svc || !ph || !v) return null;
  const phases = tripPhases(model, svc, 0);
  const wheel = { tractionKwh: 0, brakingKwh: 0 };
  let distanceM = 0;
  for (const p of phases) {
    if (p.kind !== 'run' || !p.envelope) continue;
    const e = runEnergyKwh(ph.train, p.envelope);
    wheel.tractionKwh += e.tractionKwh;
    wheel.brakingKwh += e.brakingKwh;
    distanceM += p.envelope.d;
  }
  const durationS = phases.reduce((t, p) => t + p.durationS, 0);
  return supplyEnergy(wheel, durationS, distanceM / 1000, v, line.consistUnits ?? v.unitsPerConsist);
}
