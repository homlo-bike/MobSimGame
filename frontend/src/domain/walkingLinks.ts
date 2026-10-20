/**
 * Walking links between stations (`scenario.interchanges`): how passengers change
 * between modes, which never share stations (owner decision). Pure.
 *
 * The distance is the straight line between the two stations in the project frame; the
 * walking time is that distance at the walking-speed parameter (placeholder) unless the
 * user enters a time.
 */
import type { Interchange, Scenario, Station } from './schema';
import { networkFrame } from './tracks';
import { parameterValue } from './trackParameters';
import { stationMode } from './modeSeparation';
import { newId, nowIso } from '../util/id';

export function linkDistanceM(scenario: Scenario, link: Interchange): number | null {
  const [a, b] = link.stationIds.map((id) => scenario.stations.find((s) => s.id === id));
  if (!a || !b) return null;
  const frame = networkFrame(scenario.trackNetwork, a.position);
  const p = frame.toMetres(a.position);
  const q = frame.toMetres(b.position);
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

/** Walking time in minutes: the user's value, else the straight-line distance at walking speed. */
export function linkWalkMin(
  scenario: Scenario,
  link: Interchange,
): { minutes: number | null; calculated: boolean } {
  if (link.walkTimeMin !== null) return { minutes: link.walkTimeMin, calculated: false };
  const d = linkDistanceM(scenario, link);
  if (d === null) return { minutes: null, calculated: true };
  const kmh = parameterValue(scenario.trackNetwork, 'walkingSpeedKmh');
  return { minutes: d / ((kmh * 1000) / 60), calculated: true };
}

export function linksOfStation(scenario: Scenario, stationId: string): Interchange[] {
  return scenario.interchanges.filter((i) => i.stationIds.includes(stationId));
}

/** The other station of a link, seen from `stationId`. */
export function otherStation(scenario: Scenario, link: Interchange, stationId: string): Station | undefined {
  const id = link.stationIds.find((x) => x !== stationId);
  return scenario.stations.find((s) => s.id === id);
}

export function addWalkingLink(
  scenario: Scenario,
  aId: string,
  bId: string,
): { scenario: Scenario; link: Interchange | null; error: string | null } {
  if (aId === bId) return { scenario, link: null, error: 'Choose another station' };
  const a = scenario.stations.find((s) => s.id === aId);
  const b = scenario.stations.find((s) => s.id === bId);
  if (!a || !b) return { scenario, link: null, error: 'Station not found' };
  if (scenario.interchanges.some((i) => i.stationIds.includes(aId) && i.stationIds.includes(bId)))
    return { scenario, link: null, error: `"${a.name}" and "${b.name}" are already linked` };
  const link: Interchange = { id: newId('ic'), stationIds: [aId, bId], walkTimeMin: null, notes: '' };
  return {
    scenario: { ...scenario, updatedAt: nowIso(), interchanges: [...scenario.interchanges, link] },
    link,
    error: null,
  };
}

export function updateWalkingLink(scenario: Scenario, id: string, patch: Partial<Interchange>): Scenario {
  return {
    ...scenario,
    updatedAt: nowIso(),
    interchanges: scenario.interchanges.map((i) => (i.id === id ? { ...i, ...patch, id: i.id } : i)),
  };
}

export function deleteWalkingLink(scenario: Scenario, id: string): Scenario {
  return { ...scenario, updatedAt: nowIso(), interchanges: scenario.interchanges.filter((i) => i.id !== id) };
}

/** Stations worth offering for a link from `station`: other modes first, nearest first. */
export function linkCandidates(scenario: Scenario, station: Station, maxDistanceM = 2000): Station[] {
  const frame = networkFrame(scenario.trackNetwork, station.position);
  const p = frame.toMetres(station.position);
  const mode = stationMode(scenario, station);
  return scenario.stations
    .filter((s) => s.id !== station.id)
    .map((s) => {
      const q = frame.toMetres(s.position);
      return { s, d: Math.hypot(p[0] - q[0], p[1] - q[1]), other: stationMode(scenario, s) !== mode };
    })
    .filter((x) => x.d <= maxDistanceM)
    .sort((x, y) => Number(y.other) - Number(x.other) || x.d - y.d)
    .map((x) => x.s);
}
