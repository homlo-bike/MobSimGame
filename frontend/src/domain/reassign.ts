/**
 * Can a vehicle get from its depot to a line's first stop (F8)? Pure.
 *
 * Street modes: the depot the vehicle is allocated to must have a routed street link to
 * and from the line (never a straight line). Rail modes: a path over the mode's tracks
 * from a depot track to the start of the line and back. The distance ranks depots when a
 * surplus vehicle is reassigned: reachable first, then the nearest.
 */
import type { LngLat, Scenario, TransportLine, VehicleRecord } from './schema';
import { returnCoordinates, stepsCoordinates } from './serviceRouting';
import { allocateDepots, isDepotMode, parkingSpot } from './depots';
import { assignStabling, depotTracks } from './stabling';
import { lineVehicles } from './fleetRegistry';
import { parameterValue } from './trackParameters';
import { shortestPath, type TrackPosition } from './trackGraph';
import { distanceM } from '../geo/geometry';
import type { SpareRank, SpareRanker } from './fleetRegistry';

/** Rail: the nearest depot track of the line's mode with a way to the line start and back. */
export function railDepotReach(scenario: Scenario, line: TransportLine): SpareRank & { depotTracks: number } {
  const net = scenario.trackNetwork;
  const depots = depotTracks(scenario, line.mode);
  const first = line.alignment.kind === 'track' ? line.alignment.path[0] : undefined;
  if (!depots.length || !first) return { reachable: false, distanceM: Infinity, depotTracks: depots.length };
  const start: TrackPosition = { trackId: first.trackId, fraction: first.from };
  let best = Infinity;
  for (const d of depots) {
    const at: TrackPosition = { trackId: d.id, fraction: 0.5 };
    const sameMode = (t: { designMode: string }) => t.designMode === line.mode;
    const out = shortestPath(net, at, start, undefined, sameMode);
    if (!out || !shortestPath(net, start, at, undefined, sameMode)) continue;
    best = Math.min(best, out.lengthM);
  }
  return { reachable: Number.isFinite(best), distanceM: best, depotTracks: depots.length };
}

/** Ranker for syncFleet: where each surplus vehicle stands now and whether it can reach the line. */
export function spareRanker(scenario: Scenario): SpareRanker {
  const allocation = allocateDepots(scenario);
  const rail = new Map<string, SpareRank>();
  return (v: VehicleRecord, line: TransportLine): SpareRank => {
    if (isDepotMode(v.mode)) {
      const depot = scenario.depots.find((d) => d.id === allocation.get(v.code));
      const start = line.coordinates[0];
      if (!depot || !start) return { reachable: false, distanceM: Infinity };
      const link = depot.links[line.id];
      return {
        reachable: link?.toLine.status === 'routed' && link.fromLine.status === 'routed',
        distanceM: distanceM(depot.position, start),
      };
    }
    if (!rail.has(line.id)) rail.set(line.id, railDepotReach(scenario, line));
    return rail.get(line.id)!;
  };
}

export type SurplusPlace =
  | { kind: 'street'; depotId: string; index: number }
  | { kind: 'rail'; trackId: string; fraction: number }
  | null;

/** Length of one vehicle of a type (m), the placeholder without a type. */
export function recordLengthM(scenario: Scenario, v: Pick<VehicleRecord, 'vehicleTypeId'>): number {
  const t = scenario.vehicleTypes.find((x) => x.id === v.vehicleTypeId);
  return t
    ? t.lengthM * Math.max(1, t.unitsPerConsist)
    : parameterValue(scenario.trackNetwork, 'unknownVehicleLengthM');
}

/**
 * Where each surplus vehicle stands (fleet number → place): street modes at their depot
 * after the vehicles allocated before them, rail modes in the depot-track room the line
 * vehicles leave. null = no depot with room: it stays at the end of the line it last served.
 */
export function surplusPlaces(scenario: Scenario): Map<string, SurplusPlace> {
  const out = new Map<string, SurplusPlace>();
  const surplus = scenario.fleet.filter((v) => v.status === 'surplus');
  if (!surplus.length) return out;
  const allocation = allocateDepots(scenario);
  const index = new Map<string, number>();
  const spot = new Map<string, number>();
  for (const [code, depotId] of allocation) {
    const n = index.get(depotId) ?? 0;
    index.set(depotId, n + 1);
    spot.set(code, n);
  }
  const railModes = new Set(surplus.filter((v) => !isDepotMode(v.mode)).map((v) => v.mode));
  const rail = new Map<string, { trackId: string; fraction: number }>();
  for (const mode of railModes) {
    const vehicles = new Map(
      scenario.lines.filter((l) => l.mode === mode).map((l) => [l.id, lineVehicles(scenario, l.id).length]),
    );
    const extra = surplus
      .filter((v) => v.mode === mode)
      .map((v) => ({ key: v.code, lengthM: recordLengthM(scenario, v) }));
    const { slots } = assignStabling(scenario, mode, vehicles, extra);
    for (const e of extra) {
      const s = slots.get(e.key);
      if (s) rail.set(e.key, { trackId: s.trackId, fraction: s.fraction });
    }
  }
  for (const v of surplus) {
    if (isDepotMode(v.mode)) {
      const depotId = allocation.get(v.code);
      out.set(v.code, depotId ? { kind: 'street', depotId, index: spot.get(v.code) ?? 0 } : null);
    } else {
      const r = rail.get(v.code);
      out.set(v.code, r ? { kind: 'rail', ...r } : null);
    }
  }
  return out;
}

/** A surplus vehicle's way from the end of its last trip to its depot place (F8). */
export interface ReleaseRun {
  coords: LngLat[];
  /** From the routing server for street links; null = from the length and a speed. */
  durationS: number | null;
}

/**
 * How a released vehicle gets from where its trip ended (`at`) to its depot place, along
 * paths of movement only. Street modes: back along the line to its start if the trip ended
 * at the far end (the line's return geometry where it has one), then the routed street
 * link to the depot. Rail: a path over the mode's tracks from the line end it stands at to
 * the depot-track slot. null = no such way (the vehicle stays at the line end; error).
 */
export function releaseRun(scenario: Scenario, v: VehicleRecord, at: LngLat): ReleaseRun | null {
  const line = scenario.lines.find((l) => l.id === v.lastLineId);
  const place = surplusPlaces(scenario).get(v.code) ?? null;
  if (!line || !place || line.coordinates.length < 2) return null;
  const first = line.coordinates[0]!;
  const last = line.coordinates[line.coordinates.length - 1]!;
  const atEnd = distanceM(at, last) < distanceM(at, first);
  if (place.kind === 'street') {
    const depot = scenario.depots.find((d) => d.id === place.depotId);
    const link = depot?.links[line.id]?.fromLine;
    if (!depot || link?.status !== 'routed' || link.coordinates.length < 2) return null;
    const back = atEnd ? (returnCoordinates(scenario, line) ?? [...line.coordinates].reverse()) : [];
    const lengthM = recordLengthM(scenario, v);
    const t = scenario.vehicleTypes.find((x) => x.id === v.vehicleTypeId);
    const widthM = t?.widthM ?? parameterValue(scenario.trackNetwork, 'unknownVehicleWidthM');
    return {
      coords: [...back, ...link.coordinates, parkingSpot(depot, place.index, lengthM, widthM)],
      durationS: atEnd ? null : link.durationS,
    };
  }
  if (line.alignment.kind !== 'track' || !line.alignment.path.length) return null;
  const steps = line.alignment.path;
  const from: TrackPosition = atEnd
    ? { trackId: steps[steps.length - 1]!.trackId, fraction: steps[steps.length - 1]!.to }
    : { trackId: steps[0]!.trackId, fraction: steps[0]!.from };
  const sameMode = (t: { designMode: string }) => t.designMode === v.mode;
  const path = shortestPath(scenario.trackNetwork, from, place, undefined, sameMode);
  if (!path) return null;
  return { coords: stepsCoordinates(scenario, path.steps), durationS: null };
}
