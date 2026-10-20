/**
 * Fleet requirement of a line from its geometry, speeds, stops and headways.
 * cycle = 2 × (length / running speed + stops × dwell) + 2 × layover (two ends),
 * vehicles = ⌈cycle / headway⌉ (see calculations.ts). Speeds are placeholders
 * (simulation/speeds.ts), so the result is an estimate under those assumptions.
 */
import type { Scenario, TransportLine } from '../domain/schema';
import { isRing, lineLengthM, orderedStops } from '../domain/network';
import { segmentSpeedKmh } from '../simulation/speeds';
import { capacityPphpd, cycleTimeMin, vehiclesRequired } from './calculations';
import { consistCapacity } from '../domain/vehicles';

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
  peakRequired: number;
  offPeakRequired: number;
  /** Vehicles assigned by the user, or null. */
  assigned: number | null;
  /** Vehicles missing for the peak headway (0 when enough or not set). */
  shortfall: number;
  /** Passengers per hour per direction at peak, or null without a vehicle type. */
  peakCapacityPphpd: number | null;
}

export function lineFleet(line: TransportLine, scenario: Scenario): LineFleet | null {
  const lengthM = lineLengthM(line);
  const pattern = line.servicePatterns[0];
  if (!pattern || lengthM <= 0) return null;
  const stops =
    line.alignment.kind === 'track' ? line.stops.length : orderedStops(line, scenario.stations).length;
  const cycleMin = cycleTimeMin({
    lengthM,
    runningSpeedKmh: runningSpeedKmh(line),
    stops,
    dwellS: line.dwellTimeS,
    layoverMin: LAYOVER_MIN,
    ring: isRing(line),
  });
  const peakRequired = vehiclesRequired(cycleMin, pattern.peakHeadwayMin);
  const offPeakRequired = vehiclesRequired(cycleMin, pattern.offPeakHeadwayMin);
  const assigned = line.fleetSize;
  const vehicle = scenario.vehicleTypes.find((v) => v.id === line.vehicleTypeId);
  const perConsist = consistCapacity(line, vehicle);
  return {
    cycleMin,
    peakRequired,
    offPeakRequired,
    assigned,
    shortfall: assigned === null ? 0 : Math.max(0, peakRequired - assigned),
    peakCapacityPphpd: perConsist === null ? null : capacityPphpd(pattern.peakHeadwayMin, perConsist),
  };
}
