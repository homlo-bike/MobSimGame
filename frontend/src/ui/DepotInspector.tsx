/** A bus, BRT or trolleybus depot (F5): name, capacity, the lines it serves and their street routes. */
import { useState } from 'react';
import type { Depot, Scenario } from '../domain/schema';
import { MODES } from '../domain/modes';
import { allocateDepots, depotCapacity, depotLines, removeDepot, updateDepot } from '../domain/depots';
import { routeDepotLinks } from '../routing/routeDepot';
import { useStore } from '../store/projectStore';
import { Button, Checkbox, Section } from './primitives';

export function DepotInspector({ depot, scenario }: { depot: Depot; scenario: Scenario }) {
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const announce = useStore((s) => s.announce);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const allocation = allocateDepots(scenario);
  const lines = depotLines(scenario, depot, allocation);
  const vehicles = [...allocation.values()].filter((id) => id === depot.id).length;
  const capacity = depotCapacity(scenario, depot);
  const shared = depotCapacity(scenario, { ...depot, capacityOverride: null });
  const patch = (p: Partial<Depot>, label: string) => commit(updateDepot(scenario, depot.id, p), label);
  return (
    <Section title={`Depot: ${depot.name}`} id="depot-inspector">
      <label className="mb-2 block text-sm">
        Name
        <input
          className="mt-0.5 block w-full rounded border border-slate-500 px-1"
          defaultValue={depot.name}
          key={depot.name}
          onBlur={(e) =>
            e.target.value.trim() &&
            e.target.value !== depot.name &&
            patch({ name: e.target.value.trim() }, 'Depot renamed')
          }
        />
      </label>
      <p className="mb-1 text-sm">
        {MODES[depot.mode].label} depot · {vehicles} of {capacity} places used
      </p>
      <label className="block text-sm">
        Capacity (vehicles)
        <input
          type="number"
          min={0}
          disabled={depot.capacityOverride === null}
          className="ms-1 w-20 rounded border border-slate-500 px-1 disabled:bg-slate-100"
          key={`${depot.id}-${capacity}`}
          defaultValue={capacity}
          onBlur={(e) => {
            const n = Math.round(Number(e.target.value));
            if (depot.capacityOverride !== null && n >= 0 && n !== depot.capacityOverride)
              patch({ capacityOverride: n }, `Depot capacity ${n}`);
          }}
        />
      </label>
      <Checkbox
        label={`Project setting: the ${MODES[depot.mode].label.toLowerCase()} vehicles shared over the mode's depots (${shared})`}
        checked={depot.capacityOverride === null}
        onChange={(v) =>
          patch(
            { capacityOverride: v ? null : capacity },
            v ? 'Depot capacity: shared' : 'Depot capacity: own value',
          )
        }
      />
      <h3 className="mt-2 text-sm font-semibold">Lines and street routes</h3>
      {!lines.length ? (
        <p className="text-sm text-slate-600">
          No vehicles are allocated here yet (the nearest depot with room is used).
        </p>
      ) : (
        <ul className="mb-1 text-sm">
          {lines.map((id) => {
            const l = scenario.lines.find((x) => x.id === id)!;
            const link = depot.links[id];
            const ok = link?.toLine.status === 'routed' && link.fromLine.status === 'routed';
            return (
              <li key={id}>
                {l.name}: {ok ? '✓ routed on streets' : '✗ not routed: vehicles wait at the line end'}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !lines.length}
          onClick={async () => {
            setBusy(true);
            const res = await routeDepotLinks(scenario, depot.id);
            setBusy(false);
            setMessage(res.message);
            announce(res.message);
            if (res.scenario !== scenario) commit(res.scenario, 'Depot routes updated');
          }}
        >
          {busy ? 'Routing…' : 'Route to and from the lines'}
        </Button>
        <Button
          onClick={() => {
            commit(removeDepot(scenario, depot.id), `${depot.name} deleted`);
            select(null);
          }}
        >
          Delete depot
        </Button>
      </div>
      {message && (
        <p className="mt-1 text-xs text-slate-700" role="status">
          {message}
        </p>
      )}
    </Section>
  );
}
