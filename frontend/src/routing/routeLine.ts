/**
 * Route a street-following line through the backend router and commit the
 * result. Lives outside domain/ because it performs network requests; the
 * geometry changes themselves are pure functions in domain/alignment.ts.
 */
import type { Scenario, TransportLine } from '../domain/schema';
import { applyReturnRoute, applyRouteResults } from '../domain/alignment';
import { isRing, reorderStops, updateLine } from '../domain/network';
import { backendCapability, ProviderError, routeLegs } from '../providers/backend';
import { createLogger } from '../util/logger';

const log = createLogger('routing');

export interface RouteOutcome {
  scenario: Scenario;
  routed: number;
  failed: number;
  message: string;
}

export async function routeLineOnStreets(scenario: Scenario, line: TransportLine): Promise<RouteOutcome> {
  if (line.alignment.kind !== 'routed') return { scenario, routed: 0, failed: 0, message: '' };
  const ring = isRing(line);
  const wps = line.alignment.waypoints;
  const points = ring ? [...wps, wps[0]!] : wps;
  const mode = line.mode === 'brt' || line.mode === 'trolleybus' ? line.mode : 'bus';
  // One-way lines serve each stop from one side: arrive with the stop at the kerb.
  const kerbside = line.direction === 'one_way';
  try {
    const res = await routeLegs(points, mode, kerbside);
    let next = applyRouteResults(line, res.data, res.provenance.provider, ring);
    if (line.direction === 'bidirectional' && !ring) {
      const back = await routeLegs([...points].reverse(), mode);
      next = applyReturnRoute(next, back.data);
    }
    const failed = res.data.filter((l) => l.status !== 'routed').length;
    const routed = res.data.length - failed;
    log.info('line routed', { lineId: line.id, legs: res.data.length, failed });
    return {
      scenario: reorderStops(updateLine(scenario, line.id, next), line.id),
      routed,
      failed,
      message: failed
        ? `${failed} section(s) could not be routed: move the waypoints onto streets buses can use, or mark them as manual.`
        : `Route follows streets (${routed} section${routed === 1 ? '' : 's'}).`,
    };
  } catch (e) {
    const cap = await backendCapability('valhalla');
    const reason =
      cap.state === 'not_configured'
        ? 'Street routing is not set up on this server (see docs/ROUTING.md).'
        : e instanceof ProviderError
          ? e.message
          : 'The routing server did not answer.';
    log.warn('routing unavailable', { lineId: line.id, state: cap.state });
    return { scenario, routed: 0, failed: 0, message: `Not routed: ${reason}` };
  }
}
