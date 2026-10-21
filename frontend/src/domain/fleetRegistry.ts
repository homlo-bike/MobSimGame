/**
 * The project's fleet (F3): every vehicle is a record with a fleet number, type, mode,
 * allocated line and dates. Pure.
 *
 * The fleet follows the lines: a line that needs more vehicles than it has gets new ones
 * (they start at a depot, F5/F6); vehicles no longer needed, or of a deleted line, become
 * surplus: they drive to (stand in) their depot and the user is told and asked to delete
 * them. Nothing is deleted here: only the user deletes surplus vehicles (F7).
 */
import type { Scenario, TransportMode, VehicleRecord } from './schema';
import { newId, nowIso } from '../util/id';

const PREFIX: Record<TransportMode, string> = {
  bus: 'BUS',
  brt: 'BRT',
  trolleybus: 'TRB',
  tram: 'TRM',
  light_rail: 'LRV',
  metro: 'MET',
  elevated_metro: 'MET',
  commuter_rail: 'RAIL',
  cycling: 'CYC',
  pedestrian: 'PED',
  custom: 'VEH',
};

/** Next free fleet number of a mode, e.g. "TRM-007". */
export function nextCode(fleet: readonly VehicleRecord[], mode: TransportMode): string {
  const prefix = PREFIX[mode];
  const used = fleet
    .map((v) => v.code.match(new RegExp(`^${prefix}-(\\d+)$`)))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => Number(m[1]));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

/** Vehicles allocated to a line, in fleet-number order (the simulation's vehicle 1, 2, …). */
export function lineVehicles(scenario: Pick<Scenario, 'fleet'>, lineId: string): VehicleRecord[] {
  return scenario.fleet
    .filter((v) => v.lineId === lineId && v.status === 'allocated')
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/**
 * Bring the fleet in line with what each line needs (`needed` by line id): add vehicles
 * where a line has too few (taking surplus vehicles of the same type first), and make
 * extra vehicles and vehicles of deleted lines surplus. Returns the same scenario when
 * nothing changes.
 */
export function syncFleet(scenario: Scenario, needed: ReadonlyMap<string, number>): Scenario {
  let fleet = [...scenario.fleet];
  let changed = false;
  const now = nowIso();
  const lineIds = new Set(scenario.lines.map((l) => l.id));
  fleet = fleet.map((v) => {
    if (v.status === 'allocated' && (!v.lineId || !lineIds.has(v.lineId))) {
      changed = true;
      return { ...v, status: 'surplus' as const, lineId: null, surplusSince: now };
    }
    return v;
  });
  for (const line of scenario.lines) {
    const want = Math.max(0, Math.floor(needed.get(line.id) ?? 0));
    const mine = fleet
      .filter((v) => v.lineId === line.id && v.status === 'allocated')
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    if (mine.length > want) {
      const extra = new Set(mine.slice(want).map((v) => v.id));
      fleet = fleet.map((v) =>
        extra.has(v.id) ? { ...v, status: 'surplus' as const, lineId: null, surplusSince: now } : v,
      );
      changed = true;
      continue;
    }
    for (let k = mine.length; k < want; k++) {
      // A surplus vehicle of the same type and mode is used again before a new one is added.
      const spare = fleet.find(
        (v) => v.status === 'surplus' && v.mode === line.mode && v.vehicleTypeId === line.vehicleTypeId,
      );
      if (spare) {
        fleet = fleet.map((v) =>
          v.id === spare.id ? { ...v, status: 'allocated' as const, lineId: line.id, surplusSince: null } : v,
        );
      } else {
        fleet.push({
          id: newId('veh'),
          code: nextCode(fleet, line.mode),
          vehicleTypeId: line.vehicleTypeId,
          mode: line.mode,
          lineId: line.id,
          status: 'allocated',
          addedAt: now,
          surplusSince: null,
          capacityOverride: null,
          notes: '',
        });
      }
      changed = true;
    }
  }
  return changed ? { ...scenario, fleet } : scenario;
}

/** Vehicles that are surplus in `after` but were allocated (or absent) in `before` (F7). */
export function newlySurplus(
  before: Pick<Scenario, 'fleet'>,
  after: Pick<Scenario, 'fleet'>,
): VehicleRecord[] {
  if (before.fleet === after.fleet) return [];
  const was = new Set(before.fleet.filter((v) => v.status === 'surplus').map((v) => v.id));
  return after.fleet.filter((v) => v.status === 'surplus' && !was.has(v.id));
}

/** Delete surplus vehicles (only surplus ones; the user confirms first). */
export function deleteSurplus(scenario: Scenario, ids: readonly string[]): Scenario {
  const drop = new Set(ids);
  const fleet = scenario.fleet.filter((v) => !(drop.has(v.id) && v.status === 'surplus'));
  return fleet.length === scenario.fleet.length ? scenario : { ...scenario, fleet };
}

export function updateVehicleRecord(scenario: Scenario, id: string, patch: Partial<VehicleRecord>): Scenario {
  return { ...scenario, fleet: scenario.fleet.map((v) => (v.id === id ? { ...v, ...patch, id: v.id } : v)) };
}
