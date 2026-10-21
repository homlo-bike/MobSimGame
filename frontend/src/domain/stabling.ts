/**
 * Depot (stabling) tracks for rail vehicles out of service (F6). Pure.
 *
 * The user marks tracks not used by any service as depot tracks. Vehicles of a mode
 * that are not needed wait there: each vehicle gets the nearest free slot (along the
 * tracks, from the start of its line) on a depot track of its mode, slots filled from
 * one end with the minimum gap between consists. The length needed is the sum of the
 * lengths of all consists the mode's lines run; with less depot track, a warning asks
 * for more.
 */
import type { PhysicalTrack, Scenario, TrackStep, TransportLine, TransportMode } from './schema';
import { trackGeometry } from './tracks';
import { shortestPath, type TrackPosition } from './trackGraph';
import { consistLengthM } from './vehicles';
import { parameterValue } from './trackParameters';

export function depotTracks(scenario: Pick<Scenario, 'trackNetwork'>, mode: TransportMode): PhysicalTrack[] {
  return scenario.trackNetwork.tracks.filter((t) => t.usage === 'depot' && t.designMode === mode);
}

/** Length of one consist of a line (m), or the placeholder length without a vehicle type. */
export function lineConsistM(scenario: Scenario, line: TransportLine): number {
  const v = scenario.vehicleTypes.find((x) => x.id === line.vehicleTypeId);
  return consistLengthM(line, v) ?? parameterValue(scenario.trackNetwork, 'unknownVehicleLengthM');
}

export interface StablingNeed {
  mode: TransportMode;
  /** Sum of the lengths of all consists of the mode's lines, gaps included (m). */
  neededM: number;
  /** Length of the mode's depot tracks (m). */
  availableM: number;
  vehicles: number;
  depotTrackCount: number;
}

/** Depot track needed and available for a mode; `vehiclesOf` gives each line's vehicle count. */
export function stablingNeed(
  scenario: Scenario,
  mode: TransportMode,
  vehiclesOf: (line: TransportLine) => number,
): StablingNeed {
  const gap = parameterValue(scenario.trackNetwork, 'followingMinGapM');
  let neededM = 0;
  let vehicles = 0;
  for (const l of scenario.lines) {
    if (l.mode !== mode || l.alignment.kind !== 'track') continue;
    const n = Math.max(0, vehiclesOf(l));
    vehicles += n;
    neededM += n * (lineConsistM(scenario, l) + gap);
  }
  const depots = depotTracks(scenario, mode);
  const availableM = depots.reduce((s, t) => s + trackGeometry(scenario.trackNetwork, t).lengthM, 0);
  return { mode, neededM, availableM, vehicles, depotTrackCount: depots.length };
}

/** A vehicle's place on a depot track and the ways there and back from the start of its line. */
export interface StablingSlot {
  trackId: string;
  /** Middle of the consist on the depot track (fraction of the track). */
  fraction: number;
  out: TrackStep[];
  outM: number;
  back: TrackStep[];
  backM: number;
}

/**
 * Give every vehicle of the mode's track lines (`vehicles` per line id) the nearest free
 * slot, line by line in project order. Vehicles without room or without a way to a
 * depot track get no slot (they wait at the line end) and are counted in `unplaced`.
 */
export function assignStabling(
  scenario: Scenario,
  mode: TransportMode,
  vehicles: ReadonlyMap<string, number>,
): { slots: Map<string, StablingSlot>; unplaced: number } {
  const net = scenario.trackNetwork;
  const depots = depotTracks(scenario, mode);
  const slots = new Map<string, StablingSlot>();
  let unplaced = 0;
  if (!depots.length) {
    for (const n of vehicles.values()) unplaced += n;
    return { slots, unplaced };
  }
  const gap = parameterValue(net, 'followingMinGapM');
  const used = new Map(depots.map((t) => [t.id, 0]));
  const lengths = new Map(depots.map((t) => [t.id, trackGeometry(net, t).lengthM]));
  const sameMode = (t: PhysicalTrack) => t.designMode === mode;
  for (const line of scenario.lines) {
    const n = vehicles.get(line.id) ?? 0;
    if (!n || line.mode !== mode || line.alignment.kind !== 'track') continue;
    const first = line.alignment.path[0];
    if (!first) {
      unplaced += n;
      continue;
    }
    const start: TrackPosition = { trackId: first.trackId, fraction: first.from };
    const consist = lineConsistM(scenario, line);
    for (let k = 0; k < n; k++) {
      let best: StablingSlot | null = null;
      for (const d of depots) {
        const len = lengths.get(d.id)!;
        const u = used.get(d.id)!;
        if (u + consist > len + 1e-6) continue;
        const target: TrackPosition = { trackId: d.id, fraction: (u + consist / 2) / len };
        const out = shortestPath(net, start, target, undefined, sameMode);
        const back = out && shortestPath(net, target, start, undefined, sameMode);
        if (!out || !back) continue;
        if (!best || out.lengthM < best.outM)
          best = {
            trackId: d.id,
            fraction: target.fraction,
            out: out.steps,
            outM: out.lengthM,
            back: back.steps,
            backM: back.lengthM,
          };
      }
      if (!best) {
        unplaced++;
        continue;
      }
      used.set(best.trackId, used.get(best.trackId)! + consist + gap);
      slots.set(`${line.id}:${k}`, best);
    }
  }
  return { slots, unplaced };
}
