/** Street routing status of a bus/BRT line: route it, see each section, accept manual sketches. */
import { useEffect, useState } from 'react';
import type { Scenario, TransportLine } from '../domain/schema';
import { routeStatus, setLegManual } from '../domain/alignment';
import { isRing, updateLine } from '../domain/network';
import { routeLineOnStreets } from '../routing/routeLine';
import { useStore } from '../store/projectStore';
import { backendCapability } from '../providers/backend';
import type { Capability } from '../providers/types';
import { Button, Section } from './primitives';

const STATUS_TEXT = {
  routed: '✓ Follows streets',
  manual: '✎ Manual sketch',
  unrouted: '⛔ Not routed',
} as const;

export function RoutePanel({ line, scenario }: { line: TransportLine; scenario: Scenario }) {
  const commit = useStore((s) => s.commitScenario);
  const announce = useStore((s) => s.announce);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [routing, setRouting] = useState<Capability | null>(null);
  const isRouted = line.alignment.kind === 'routed';
  useEffect(() => {
    if (!isRouted) return;
    let cancelled = false;
    void backendCapability('valhalla').then((c) => !cancelled && setRouting(c));
    return () => {
      cancelled = true;
    };
  }, [isRouted]);
  if (line.alignment.kind !== 'routed') return null;
  const status = routeStatus(line)!;
  const legs = line.alignment.legs;
  const run = async () => {
    setBusy(true);
    const outcome = await routeLineOnStreets(scenario, line);
    setBusy(false);
    setMessage(outcome.message);
    if (outcome.routed + outcome.failed > 0) commit(outcome.scenario, outcome.message);
    else announce(outcome.message);
  };
  return (
    <Section title="Street route" id="line-route">
      <p className="mb-1 text-sm">
        {status.routed} of {status.total} section(s) follow streets
        {status.manual ? `, ${status.manual} manual` : ''}
        {status.unrouted ? `, ${status.unrouted} not routed` : ''}.
      </p>
      {line.alignment.returnCoordinates && (
        <p className="mb-1 text-xs text-slate-700">
          The return direction uses different streets (one-way streets); it is drawn as its own path.
        </p>
      )}
      {routing && routing.state !== 'available' && (
        <p
          role="note"
          className="mb-2 rounded border border-amber-600 bg-amber-50 p-2 text-xs text-amber-950"
        >
          ⚠ Street routing is not available on this server ({routing.message}). Sections stay straight (dashed
          “not routed” on the map) until the routing service runs; see docs/ROUTING.md. You can mark sections
          as manual sketches meanwhile.
        </p>
      )}
      <Button variant="primary" disabled={busy || status.total === 0} onClick={run}>
        {busy ? 'Routing…' : status.unrouted ? 'Route on streets' : 'Re-route'}
      </Button>
      {message && (
        <p role="status" className="mt-1 text-xs text-slate-700">
          {message}
        </p>
      )}
      <ol className="mt-2 space-y-1 text-sm">
        {legs.map((leg, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-6 text-xs text-slate-500">{i + 1}.</span>
            <span className="flex-1">
              {STATUS_TEXT[leg.status]}
              {leg.message && <span className="block text-xs text-slate-600">{leg.message}</span>}
            </span>
            {leg.status !== 'routed' && (
              <Button
                variant="ghost"
                aria-label={`${leg.status === 'manual' ? 'Unmark' : 'Mark'} section ${i + 1} as manual`}
                onClick={() =>
                  commit(
                    updateLine(
                      scenario,
                      line.id,
                      setLegManual(line, i, leg.status !== 'manual', isRing(line)),
                    ),
                    leg.status === 'manual'
                      ? 'Section needs routing again'
                      : 'Section accepted as manual sketch',
                  )
                }
              >
                {leg.status === 'manual' ? 'Undo manual' : 'Mark manual'}
              </Button>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-xs text-slate-600">
        Drag the waypoints on the map to change the route. Manual sections are accepted sketches (for example
        a bus-only link missing from the map data).
      </p>
    </Section>
  );
}
