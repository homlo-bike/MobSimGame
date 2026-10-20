/** Move the map to a notification's target and select the related object. */
import { bbox, lineString } from '@turf/turf';
import type { Scenario } from '../domain/schema';
import type { NotificationTarget } from '../store/notifications';
import type { Selection, View } from '../store/projectStore';
import { getMapInstance } from './mapInstance';
import type { Finding } from '../validation/validate';
import { findingPosition, findingSubject } from '../validation/locate';

/**
 * Select the object a finding is about, highlight the finding and move the map to
 * it. Returns false when the finding has no object or position on the map.
 */
export function focusFinding(
  scenario: Scenario,
  f: Finding,
  select: (s: Selection) => void,
  setView: (v: View) => void,
  setFocused: (id: string | null) => void,
): boolean {
  const subject = findingSubject(f);
  const position = findingPosition(f, scenario);
  setFocused(f.id);
  if (subject) select(subject);
  if (!position) return !!subject;
  setView('map');
  const map = getMapInstance();
  map?.flyTo({ center: position, zoom: Math.max(map.getZoom(), 15) });
  return true;
}

/** Returns false when the target no longer exists in the scenario. */
export function focusTarget(
  scenario: Scenario,
  target: NotificationTarget,
  select: (s: Selection) => void,
  setView: (v: View) => void,
): boolean {
  const map = getMapInstance();
  const line = target.lineId ? scenario.lines.find((l) => l.id === target.lineId) : undefined;
  const station = target.stationId ? scenario.stations.find((s) => s.id === target.stationId) : undefined;
  if ((target.lineId && !line) || (target.stationId && !station)) return false;
  setView('map');
  if (station) select({ kind: 'station', id: station.id });
  else if (line && target.segmentId && line.segments.some((s) => s.id === target.segmentId))
    select({ kind: 'segment', lineId: line.id, id: target.segmentId });
  else if (line) select({ kind: 'line', id: line.id });
  if (!map) return true;
  const position = target.position ?? station?.position;
  if (position) map.flyTo({ center: position, zoom: Math.max(map.getZoom(), 15) });
  else if (line && line.coordinates.length >= 2) {
    const b = bbox(lineString(line.coordinates));
    map.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]],
      ],
      { padding: 60, maxZoom: 16 },
    );
  }
  return true;
}
