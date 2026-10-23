/**
 * Fleet requirement of a line from its cycle time, headway, vehicle capacity and
 * expected demand. Without a simulated cycle the estimate
 * cycle = 2 × (length / running speed + stops × dwell) + 2 × layover (two ends) is used;
 * its speeds are placeholders (simulation/speeds.ts), so the result is an estimate under
 * those assumptions.
 */
import type { Scenario, TransportLine } from '../domain/schema';
import { isRing, lineLengthM, orderedStops } from '../domain/network';
import { segmentSpeedKmh } from '../simulation/speeds';
import { capacityPphpd, cycleTimeMin, vehiclesRequired } from './calculations';
import { consistCapacity } from '../domain/vehicles';
import { spareRatioOf } from '../domain/trackParameters';

/** Layover at each terminal, minutes (the simulation's 2-minute editor default). */
export const LAYOVER_MIN = 2;

/** Length-weighted harmonic mean of the segment speeds, km/h. */
export function runningSpeedKmh(line: TransportLine): number {
  let t = 0;
  for (const seg of line.segments) t += (seg.toFraction - seg.fromFraction) / segmentSpeedKmh(line, seg);
  return t > 0 ? 1 / t : line.maxSpeedKmh;
}

export interface LineFleet {
  cycleMin: number;
  /** Where the cycle time comes from: the simulation (one round trip) or the speed estimate. */
  cycleSource: 'simulation' | 'estimate';
  /** The line's peak headway (the operator's policy), minutes. */
  policyHeadwayMin: number;
  /** Headway the expected demand needs (consist capacity / demand), minutes; null without demand or capacity. */
  demandHeadwayMin: number | null;
  /** The shorter of the two: the headway the fleet is sized for. */
  designHeadwayMin: number;
  /** Vehicles in service at the peak for the design headway. */
  peakRequired: number;
  offPeakRequired: number;
  /** Spare vehicles on top (spare-ratio parameter). */
  spares: number;
  /** Vehicles in service set by the user, or null (the calculated default applies). */
  assigned: number | null;
  /** Vehicles in service used: the user's value or the calculated default. */
  inService: number;
  /** Headway the vehicles in service can run, minutes (never shorter than the design headway). */
  effectiveHeadwayMin: number;
  /** Vehicles missing for the design headway (0 when enough or not set). */
  shortfall: number;
  /** Passengers per hour per direction offered at the effective headway, or null without a vehicle type. */
  peakCapacityPphpd: number | null;
  /** Expected demand / capacity offered, or null. Above 1: crowded beyond the planning load. */
  loadRatio: number | null;
}

/**
 * Fleet of a line.
 *
 * - design headway h = min(policy headway, 60 × C / D), with C the passengers per consist
 *   at the planning load and D the expected peak demand at the busiest point
 *   (passengers per hour per direction): enough vehicles pass to carry the demand;
 * - vehicles in service N = ⌈cycle / h⌉, cycle = one simulated round trip (or the
 *   speed estimate);
 * - spares = ⌈N × spare ratio⌉ (project parameter);
 * - with fewer vehicles set by the user, the line runs every cycle / N minutes.
 */
export function lineFleet(
  line: TransportLine,
  scenario: Scenario,
  options: { cycleMin?: number } = {},
): LineFleet | null {
  const lengthM = lineLengthM(line);
  const pattern = line.servicePatterns[0];
  if (!pattern || lengthM <= 0) return null;
  const stops =
    line.alignment.kind === 'track' ? line.stops.length : orderedStops(line, scenario.stations).length;
  const estimated = cycleTimeMin({
    lengthM,
    runningSpeedKmh: runningSpeedKmh(line),
    stops,
    dwellS: line.dwellTimeS,
    layoverMin: LAYOVER_MIN,
    ring: isRing(line),
  });
  const cycleMin = options.cycleMin && options.cycleMin > 0 ? options.cycleMin : estimated;
  const vehicle = scenario.vehicleTypes.find((v) => v.id === line.vehicleTypeId);
  const perConsist = consistCapacity(line, vehicle);
  const demand = line.peakDemandPphpd;
  const demandHeadwayMin = demand && perConsist ? (60 * perConsist) / demand : null;
  const policyHeadwayMin = pattern.peakHeadwayMin;
  const designHeadwayMin =
    demandHeadwayMin !== null ? Math.min(policyHeadwayMin, demandHeadwayMin) : policyHeadwayMin;
  const peakRequired = vehiclesRequired(cycleMin, designHeadwayMin);
  const offPeakRequired = vehiclesRequired(cycleMin, pattern.offPeakHeadwayMin);
  const spares = Math.ceil(peakRequired * spareRatioOf(scenario.trackNetwork, line.mode).value);
  const assigned = line.fleetSize;
  const inService = assigned ?? peakRequired;
  const effectiveHeadwayMin = inService > 0 ? Math.max(designHeadwayMin, cycleMin / inService) : Infinity;
  const peakCapacityPphpd =
    perConsist === null || !Number.isFinite(effectiveHeadwayMin)
      ? null
      : capacityPphpd(effectiveHeadwayMin, perConsist);
  return {
    cycleMin,
    cycleSource: options.cycleMin && options.cycleMin > 0 ? 'simulation' : 'estimate',
    policyHeadwayMin,
    demandHeadwayMin,
    designHeadwayMin,
    peakRequired,
    offPeakRequired,
    spares,
    assigned,
    inService,
    effectiveHeadwayMin,
    shortfall: assigned === null ? 0 : Math.max(0, peakRequired - assigned),
    peakCapacityPphpd,
    loadRatio: demand !== null && peakCapacityPphpd ? demand / peakCapacityPphpd : null,
  };
}
