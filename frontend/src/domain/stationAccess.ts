/**
 * Access facilities of a station (R8): elevators, escalators and ramps, shown as symbols
 * next to the station name on the map and as labelled badges in lists. Pure.
 */
import type { Station } from './schema';

export type AccessFacility = 'elevator' | 'escalator' | 'ramp';

export const ACCESS_FACILITY_LABELS: Record<AccessFacility, string> = {
  elevator: 'Elevator',
  escalator: 'Escalator',
  ramp: 'Ramp',
};

/** The facilities a station is known to have, in a fixed order (unknown counts as absent). */
export function accessFacilities(a: Station['accessibility']): AccessFacility[] {
  const out: AccessFacility[] = [];
  if ((a.elevators ?? 0) > 0) out.push('elevator');
  if ((a.escalators ?? 0) > 0) out.push('escalator');
  if (a.ramp === true) out.push('ramp');
  return out;
}

/** Every non-empty combination of facilities, in the order accessFacilities lists them. */
export const ACCESS_COMBINATIONS: AccessFacility[][] = (() => {
  const all: AccessFacility[] = ['elevator', 'escalator', 'ramp'];
  const out: AccessFacility[][] = [];
  for (let mask = 1; mask < 1 << all.length; mask++) out.push(all.filter((_, i) => mask & (1 << i)));
  return out;
})();

/** Name of the map image showing these facilities side by side, or null when there are none. */
export function accessIconId(facilities: readonly AccessFacility[]): string | null {
  return facilities.length ? `msg-access-${facilities.join('+')}` : null;
}

/** Facilities named by an image id made by accessIconId, or null for other images. */
export function facilitiesOfIconId(id: string): AccessFacility[] | null {
  if (!id.startsWith('msg-access-')) return null;
  const parts = id.slice('msg-access-'.length).split('+');
  return parts.every((p): p is AccessFacility => p in ACCESS_FACILITY_LABELS) ? parts : null;
}

/** Text for screen readers and lists, e.g. "2 elevators, ramp"; "" when nothing is known. */
export function accessSummary(a: Station['accessibility']): string {
  const parts: string[] = [];
  if (a.elevators) parts.push(`${a.elevators} elevator${a.elevators === 1 ? '' : 's'}`);
  if (a.escalators) parts.push(`${a.escalators} escalator${a.escalators === 1 ? '' : 's'}`);
  if (a.ramp) parts.push('ramp');
  if (a.stepFree === true) parts.push('step-free');
  if (a.stepFree === false) parts.push('not step-free');
  return parts.join(', ');
}
