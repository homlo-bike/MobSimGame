/**
 * The project's fleet (F3): every vehicle is a record with a fleet number, type, mode,
 * allocated line and dates. Pure.
 *
 * The fleet follows the lines: a line that needs more vehicles than it has gets new ones
 * (they start at a depot, F5/F6); vehicles no longer needed, or of a deleted line, become
 * surplus: they drive to (stand in) their depot and the user is told and asked to delete
 * them. Nothing is deleted here: only the user deletes surplus vehicles (F7).
 */
import type { LngLat, Scenario, TransportLine, TransportMode, VehicleRecord } from './schema';
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

/** Whether a line takes vehicles of this type: its main type or one of its accepted types. */
export function lineAcceptsType(
  line: Pick<TransportLine, 'vehicleTypeId' | 'acceptedVehicleTypeIds'>,
  typeId: string | null,
): boolean {
  return typeId === line.vehicleTypeId || (typeId !== null && line.acceptedVehicleTypeIds.includes(typeId));
}

/** How well a surplus vehicle suits a line: reachable first, then the shorter way (F8). */
export interface SpareRank {
  reachable: boolean;
  distanceM: number;
}
export type SpareRanker = (vehicle: VehicleRecord, line: TransportLine) => SpareRank;

/** What changed in the fleet: vehicles reassigned from surplus, added new, made surplus. */
export interface FleetChanges {
  reassigned: { vehicle: VehicleRecord; lineId: string; reachable: boolean }[];
  added: VehicleRecord[];
}

/**
 * Bring the fleet in line with what each line needs (`needed` by line id): add vehicles
 * where a line has too few, and make extra vehicles, vehicles of deleted lines and vehicles
 * of a type their line no longer takes surplus.
 * A surplus vehicle of the line's mode and of its main or an accepted type is used again
 * before a new one is added: the one that can reach the line, from the nearest depot
 * first (`rank`; without it, register order). A surplus vehicle remembers the line it
 * last served (`before` gives the start of a line deleted by the edit). Returns the same
 * scenario when nothing changes.
 */
export function syncFleet(
  scenario: Scenario,
  needed: ReadonlyMap<string, number>,
  options: { rank?: SpareRanker; before?: Pick<Scenario, 'lines'>; changes?: FleetChanges } = {},
): Scenario {
  let fleet = [...scenario.fleet];
  let changed = false;
  const now = nowIso();
  const startOf = (lineId: string | null): LngLat | null =>
    (scenario.lines.find((l) => l.id === lineId) ?? options.before?.lines.find((l) => l.id === lineId))
      ?.coordinates[0] ?? null;
  const release = (v: VehicleRecord): VehicleRecord => ({
    ...v,
    status: 'surplus',
    lineId: null,
    surplusSince: now,
    lastLineId: v.lineId,
    lastPosition: startOf(v.lineId) ?? v.lastPosition,
  });
  const lineOf = new Map(scenario.lines.map((l) => [l.id, l]));
  fleet = fleet.map((v) => {
    const line = v.lineId ? lineOf.get(v.lineId) : undefined;
    // Its line is gone, or no longer takes its type (main type changed, accepted type removed).
    if (
      v.status === 'allocated' &&
      (!line || (line.mode === v.mode && !lineAcceptsType(line, v.vehicleTypeId)))
    ) {
      changed = true;
      return release(v);
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
      fleet = fleet.map((v) => (extra.has(v.id) ? release(v) : v));
      changed = true;
      continue;
    }
    for (let k = mine.length; k < want; k++) {
      const spares = fleet
        .filter(
          (v) => v.status === 'surplus' && v.mode === line.mode && lineAcceptsType(line, v.vehicleTypeId),
        )
        .map((v, i) => ({ v, i, r: options.rank?.(v, line) ?? { reachable: true, distanceM: 0 } }))
        .sort(
          (a, b) =>
            Number(b.r.reachable) - Number(a.r.reachable) || a.r.distanceM - b.r.distanceM || a.i - b.i,
        );
      const spare = spares[0];
      if (spare) {
        const back: VehicleRecord = {
          ...spare.v,
          status: 'allocated',
          lineId: line.id,
          surplusSince: null,
          lastLineId: null,
          lastPosition: null,
        };
        fleet = fleet.map((v) => (v.id === spare.v.id ? back : v));
        options.changes?.reassigned.push({ vehicle: back, lineId: line.id, reachable: spare.r.reachable });
      } else {
        const fresh: VehicleRecord = {
          id: newId('veh'),
          code: nextCode(fleet, line.mode),
          vehicleTypeId: line.vehicleTypeId,
          mode: line.mode,
          lineId: line.id,
          status: 'allocated',
          addedAt: now,
          surplusSince: null,
          lastLineId: null,
          lastPosition: null,
          capacityOverride: null,
          notes: '',
        };
        fleet.push(fresh);
        options.changes?.added.push(fresh);
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
