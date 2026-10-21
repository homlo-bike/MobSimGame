/**
 * Depots of the street modes (bus, BRT, trolleybus; F5). Pure.
 *
 * A depot is a point with a capacity. Its default capacity shares the mode's vehicles out
 * over the mode's depots (all vehicles, surplus included, need a place); the user can set
 * an own value (G1). Vehicles are allocated to the nearest depot of their mode with room,
 * line by line. They drive between depot and line only on streets: the routes come from
 * the routing server and are stored per line; without a route the vehicle waits at the
 * line end instead of cutting across.
 */
import type { Depot, DepotLink, LngLat, Scenario, TransportMode } from './schema';
import { lineVehicles } from './fleetRegistry';
import { newId } from '../util/id';
import { distanceM } from '../geo/geometry';

export const DEPOT_MODES: readonly TransportMode[] = ['bus', 'brt', 'trolleybus'];
export const isDepotMode = (m: TransportMode) => DEPOT_MODES.includes(m);

export function addDepot(
  scenario: Scenario,
  mode: TransportMode,
  position: LngLat,
): { scenario: Scenario; depot: Depot } {
  const n = scenario.depots.filter((d) => d.mode === mode).length + 1;
  const depot: Depot = {
    id: newId('depot'),
    name: `Depot ${n}`,
    mode,
    position,
    capacityOverride: null,
    links: {},
    notes: '',
  };
  return { scenario: { ...scenario, depots: [...scenario.depots, depot] }, depot };
}

export function updateDepot(scenario: Scenario, id: string, patch: Partial<Depot>): Scenario {
  return {
    ...scenario,
    depots: scenario.depots.map((d) => (d.id === id ? { ...d, ...patch, id: d.id } : d)),
  };
}

export function removeDepot(scenario: Scenario, id: string): Scenario {
  return { ...scenario, depots: scenario.depots.filter((d) => d.id !== id) };
}

/** Capacity in force: the depot's own value, else the mode's vehicles shared over its depots. */
export function depotCapacity(scenario: Pick<Scenario, 'depots' | 'fleet'>, depot: Depot): number {
  if (depot.capacityOverride !== null) return depot.capacityOverride;
  const depots = scenario.depots.filter((d) => d.mode === depot.mode).length || 1;
  const vehicles = scenario.fleet.filter((v) => v.mode === depot.mode).length;
  return Math.ceil(vehicles / depots);
}

/**
 * Depot of every vehicle of the street modes (fleet number → depot id): line by line,
 * each vehicle to the nearest depot of its mode that still has room; surplus vehicles
 * afterwards to any depot with room. Vehicles without room are not allocated.
 */
export function allocateDepots(scenario: Scenario): Map<string, string> {
  const out = new Map<string, string>();
  const left = new Map(scenario.depots.map((d) => [d.id, depotCapacity(scenario, d)]));
  const take = (code: string, mode: TransportMode, near: LngLat | null) => {
    const options = scenario.depots
      .filter((d) => d.mode === mode && (left.get(d.id) ?? 0) > 0)
      .sort((a, b) => (near ? distanceM(near, a.position) - distanceM(near, b.position) : 0));
    const d = options[0];
    if (!d) return;
    out.set(code, d.id);
    left.set(d.id, left.get(d.id)! - 1);
  };
  for (const line of scenario.lines) {
    if (!isDepotMode(line.mode)) continue;
    const start = line.coordinates[0] ?? null;
    for (const v of lineVehicles(scenario, line.id)) take(v.code, line.mode, start);
  }
  for (const v of scenario.fleet)
    if (v.status === 'surplus' && isDepotMode(v.mode) && !out.has(v.code)) take(v.code, v.mode, null);
  return out;
}

/** Store the routes between a depot and a line. */
export function setDepotLinks(
  scenario: Scenario,
  depotId: string,
  lineId: string,
  links: { toLine: DepotLink; fromLine: DepotLink },
): Scenario {
  return {
    ...scenario,
    depots: scenario.depots.map((d) =>
      d.id === depotId ? { ...d, links: { ...d.links, [lineId]: links } } : d,
    ),
  };
}

/** Lines of a depot's mode whose vehicles are allocated to it. */
export function depotLines(
  scenario: Scenario,
  depot: Depot,
  allocation = allocateDepots(scenario),
): string[] {
  return scenario.lines
    .filter(
      (l) =>
        l.mode === depot.mode &&
        lineVehicles(scenario, l.id).some((v) => allocation.get(v.code) === depot.id),
    )
    .map((l) => l.id);
}

/**
 * Place of the k-th vehicle parked at a depot: rows beside the depot point (6 across,
 * vehicle width plus a metre apart, vehicle length plus two metres between rows). A
 * drawing aid: the depot's real layout is not modelled.
 */
export function parkingSpot(depot: Depot, k: number, lengthM: number, widthM: number): LngLat {
  const col = k % 6;
  const row = Math.floor(k / 6);
  const east = 10 + row * (lengthM + 2);
  const north = (col - 2.5) * (widthM + 1);
  const R = 6371008.8;
  const lat = depot.position[1];
  return [
    depot.position[0] + (east * 180) / (Math.PI * R * Math.cos((lat * Math.PI) / 180)),
    depot.position[1] + (north * 180) / (Math.PI * R),
  ];
}
