/**
 * The rest of the trip a vehicle is on when an edit makes it surplus (F8). Pure.
 *
 * Taken from the plan before the edit: from the simulated time of the edit, the vehicle's
 * positions every few seconds until its trip ends (it reaches the end of the line and
 * would lay over). Stored with the vehicle so the animation stays a function of time:
 * the vehicle finishes the trip, then drives to its depot.
 */
import type { Scenario, VehicleRecord } from '../domain/schema';
import {
  buildScenarioModels,
  vehicleStates,
  type LineSimulationModel,
  type SimulationOptions,
} from './engine';

/** Sampling step (s): fine enough for stops and curves at drawing scale. */
export const RELEASE_STEP_S = 5;
/** Longest trip followed (s): a guard against a vehicle that never reaches its end. */
const MAX_S = 6 * 3600;

const ON_TRIP = new Set(['running', 'dwelling', 'waiting']);

export function releaseOf(
  models: readonly LineSimulationModel[],
  code: string,
  atS: number,
): VehicleRecord['release'] {
  const m = models.find((x) => x.vehicleCodes.includes(code));
  if (!m) return null;
  const at = (t: number) => vehicleStates(m, t).find((v) => v.id === code);
  const first = at(atS);
  if (!first || !ON_TRIP.has(first.state)) {
    // Laying over at the line end: the trip is done, it leaves for the depot from there.
    return first && first.state === 'layover'
      ? { atS, samples: [[atS, first.position[0], first.position[1]]] }
      : null;
  }
  const samples: [number, number, number][] = [[atS, first.position[0], first.position[1]]];
  for (let t = atS + RELEASE_STEP_S; t <= atS + MAX_S; t += RELEASE_STEP_S) {
    const s = at(t);
    if (!s) break;
    samples.push([t, s.position[0], s.position[1]]);
    if (!ON_TRIP.has(s.state)) break;
  }
  return { atS, samples };
}

/** Release snapshots for vehicles that just became surplus, from the plan before the edit. */
export function releasesFor(
  before: Scenario,
  options: SimulationOptions,
  codes: readonly string[],
  atS: number,
): Map<string, NonNullable<VehicleRecord['release']>> {
  const out = new Map<string, NonNullable<VehicleRecord['release']>>();
  if (!codes.length) return out;
  const models = buildScenarioModels(before, options);
  for (const code of codes) {
    const r = releaseOf(models, code, atS);
    if (r) out.set(code, r);
  }
  return out;
}
