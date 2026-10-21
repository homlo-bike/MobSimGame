/**
 * What the vehicle info window shows (F4): fleet number, line, state, next stop and how
 * full the vehicle is. Pure.
 *
 * How full: the expected demand the user entered for the line (peak or off-peak, by the
 * time of day) spread over the vehicles passing: passengers per vehicle = demand ×
 * headway / 3600, at the busiest point of the line, against the vehicle's capacity (its
 * own value, else the consist capacity of the profile). Without an entered demand the
 * window says so; no figure is invented.
 */
import type { Scenario } from '../domain/schema';
import { consistCapacity } from '../domain/vehicles';
import { periodAt } from '../domain/timetable';
import { departOf, lastTripAt, type LineSimulationModel, type VehicleState } from './engine';

export interface VehicleInfo {
  code: string;
  lineName: string;
  color: string;
  status: string;
  nextStop: string | null;
  load:
    | { kind: 'estimate'; passengers: number; capacity: number; percent: number; basis: 'peak' | 'off-peak' }
    | { kind: 'none'; reason: string };
}

const STATUS: Record<VehicleState['state'], string> = {
  running: 'Running',
  dwelling: 'At a stop',
  layover: 'Layover at the terminal',
  waiting: 'Waiting (signal or occupied track)',
  parked: 'Out of service',
  deadhead: 'Out of service, running to or from the depot',
};

/** Headway (s) around time tS: the gap between the departures around it. */
function headwayAt(model: LineSimulationModel, tS: number): number {
  const j = lastTripAt(model, tS);
  if (j === null || !model.timetable) return model.headwayS;
  const a = departOf(model, j);
  const b = departOf(model, j + 1);
  return Number.isFinite(b - a) && b > a ? b - a : model.headwayS;
}

export function vehicleInfo(
  scenario: Scenario,
  model: LineSimulationModel,
  v: VehicleState,
  tS: number,
): VehicleInfo {
  const line = scenario.lines.find((l) => l.id === model.lineId);
  const name = (id: string) => scenario.stations.find((s) => s.id === id)?.name ?? 'stop';
  const inService = v.state !== 'parked' && v.state !== 'deadhead';
  // Next stop ahead in the direction of travel (a ring continues past its end).
  let nextStop: string | null = null;
  if (inService && model.stops.length) {
    const eps = v.state === 'dwelling' ? 0.5 : 0;
    const ahead =
      v.direction === 1
        ? model.stops.find((s) => s.chainageM > v.chainageM + eps)
        : [...model.stops].reverse().find((s) => s.chainageM < v.chainageM - eps);
    const stop =
      ahead ??
      (model.ring ? (v.direction === 1 ? model.stops[0] : model.stops[model.stops.length - 1]) : undefined);
    if (stop) nextStop = name(stop.stationId);
  }
  const base = {
    code: v.id,
    lineName: line?.name ?? model.lineId,
    color: model.color,
    status: STATUS[v.state],
    nextStop,
  };
  if (!line) return { ...base, load: { kind: 'none', reason: 'Line not found.' } };
  if (!inService) return { ...base, load: { kind: 'none', reason: 'No passengers (out of service).' } };
  const record = scenario.fleet.find((r) => r.code === v.id);
  const vehicle = scenario.vehicleTypes.find((x) => x.id === line.vehicleTypeId);
  const capacity = record?.capacityOverride ?? consistCapacity(line, vehicle);
  const pattern = line.servicePatterns[0];
  const period = pattern ? periodAt(pattern, scenario.peakPeriods, tS) : 'peak';
  const peak = period !== 'off_peak';
  const demand = peak ? line.peakDemandPphpd : line.offPeakDemandPphpd;
  if (!capacity)
    return { ...base, load: { kind: 'none', reason: 'Capacity unknown: choose a vehicle profile.' } };
  if (demand == null)
    return {
      ...base,
      load: {
        kind: 'none',
        reason: `Not estimated: enter the expected ${peak ? 'peak' : 'off-peak'} demand in the line inspector.`,
      },
    };
  const passengers = (demand * headwayAt(model, tS)) / 3600;
  return {
    ...base,
    load: {
      kind: 'estimate',
      passengers: Math.round(passengers),
      capacity,
      percent: Math.round((100 * passengers) / capacity),
      basis: peak ? 'peak' : 'off-peak',
    },
  };
}
