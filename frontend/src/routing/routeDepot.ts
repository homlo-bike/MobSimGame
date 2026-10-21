/**
 * Route the connections between a depot and the lines it serves on the street network
 * (F5) and store them with the depot. Lives outside domain/ because it performs network
 * requests; without the routing server the links stay unrouted and vehicles wait at
 * the line ends (they never cut across in a straight line).
 */
import type { DepotLink, Scenario } from '../domain/schema';
import { allocateDepots, depotLines, setDepotLinks } from '../domain/depots';
import { backendCapability, ProviderError, routeLegs } from '../providers/backend';
import { nowIso } from '../util/id';
import { createLogger } from '../util/logger';

const log = createLogger('routing');

export async function routeDepotLinks(
  scenario: Scenario,
  depotId: string,
): Promise<{ scenario: Scenario; message: string }> {
  const depot = scenario.depots.find((d) => d.id === depotId);
  if (!depot) return { scenario, message: 'Depot not found.' };
  const mode = depot.mode === 'brt' || depot.mode === 'trolleybus' ? depot.mode : 'bus';
  const lineIds = depotLines(scenario, depot, allocateDepots(scenario));
  if (!lineIds.length) return { scenario, message: 'No vehicles are allocated to this depot yet.' };
  let sc = scenario;
  let failed = 0;
  try {
    for (const lineId of lineIds) {
      const line = sc.lines.find((l) => l.id === lineId);
      const start = line?.coordinates[0];
      if (!line || !start) continue;
      const leg = async (a: typeof start, b: typeof start): Promise<DepotLink> => {
        const res = await routeLegs([a, b], mode);
        const r = res.data[0];
        if (!r || r.status !== 'routed' || r.coordinates.length < 2) {
          failed++;
          return {
            status: 'unrouted',
            coordinates: [],
            lengthM: null,
            durationS: null,
            provider: res.provenance.provider,
            routedAt: nowIso(),
            message: r?.message || 'No street route found.',
          };
        }
        return {
          status: 'routed',
          coordinates: r.coordinates,
          lengthM: r.lengthM,
          durationS: r.durationS,
          provider: res.provenance.provider,
          routedAt: nowIso(),
          message: '',
        };
      };
      const toLine = await leg(depot.position, start);
      const fromLine = await leg(start, depot.position);
      sc = setDepotLinks(sc, depot.id, lineId, { toLine, fromLine });
    }
    log.info('depot routed', { depotId, lines: lineIds.length, failed });
    return {
      scenario: sc,
      message: failed
        ? `${failed} depot route(s) could not be found on the street network: move the depot next to a street the vehicles can use.`
        : `Depot routes follow streets for ${lineIds.length} line(s).`,
    };
  } catch (e) {
    const cap = await backendCapability('valhalla');
    log.warn('depot routing unavailable', { depotId, state: cap.state });
    const reason =
      cap.state === 'not_configured'
        ? 'Street routing is not set up on this server (see docs/ROUTING.md).'
        : e instanceof ProviderError
          ? e.message
          : 'The routing server did not answer.';
    return {
      scenario,
      message: `Not routed: ${reason} Vehicles wait at the line ends until the depot is routed.`,
    };
  }
}
