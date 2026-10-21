/** The project's vehicles (F3): fleet number, type, line, status and own values. */
import { useState } from 'react';
import type { Scenario } from '../domain/schema';
import { MODES } from '../domain/modes';
import { deleteSurplus, updateVehicleRecord } from '../domain/fleetRegistry';
import { allocateDepots } from '../domain/depots';
import { depotTracks } from '../domain/stabling';
import { useStore } from '../store/projectStore';
import { Button, Section } from './primitives';

const date = (iso: string | null) => (iso ? iso.slice(0, 10) : '–');

export function FleetSection({ scenario }: { scenario: Scenario }) {
  const commit = useStore((s) => s.commitScenario);
  const showVehicle = useStore((s) => s.showVehicle);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const lineName = (id: string | null) => scenario.lines.find((l) => l.id === id)?.name ?? '–';
  const typeOf = (id: string | null) => scenario.vehicleTypes.find((v) => v.id === id);
  const surplus = scenario.fleet.filter((v) => v.status === 'surplus');
  const allocation = allocateDepots(scenario);
  const depotName = (code: string) => scenario.depots.find((d) => d.id === allocation.get(code))?.name;
  const rows = [...scenario.fleet].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  return (
    <Section title={`Vehicles (${scenario.fleet.length})`} id="dash-fleet">
      <p className="mb-1 text-xs text-slate-600">
        Every vehicle of the project. The fleet follows the lines: a line gets the vehicles it needs in
        service plus spares; vehicles no longer needed become surplus, stand in their depot and stay until you
        delete them (a line that needs vehicles of the same type takes them first). Capacity follows the
        vehicle profile unless a vehicle has its own value.
      </p>
      <div className="mb-2 flex flex-wrap gap-2">
        <Button onClick={() => commit(scenario, 'Fleet brought up to date with the lines')}>
          Update from lines
        </Button>
        {surplus.length > 0 && (
          <Button onClick={() => setConfirm(surplus.map((v) => v.id))}>
            Delete surplus vehicles ({surplus.length})…
          </Button>
        )}
      </div>
      {confirm && (
        <div
          role="alertdialog"
          aria-labelledby="fleet-confirm"
          className="mb-2 rounded border border-amber-500 p-2"
        >
          <p id="fleet-confirm" className="mb-1 text-sm">
            Delete {confirm.length} surplus vehicle(s)? This removes them from the project (undo is possible).
          </p>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                commit(deleteSurplus(scenario, confirm), `${confirm.length} surplus vehicle(s) deleted`);
                setConfirm(null);
              }}
            >
              Delete
            </Button>
            <Button onClick={() => setConfirm(null)}>Keep them</Button>
          </div>
        </div>
      )}
      {!rows.length ? (
        <p className="text-sm">No vehicles yet: they are added when lines need them.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="fleet-table">
            <caption className="sr-only">Vehicles of the project</caption>
            <thead>
              <tr className="text-xs text-slate-600">
                <th scope="col" className="text-start">
                  Vehicle
                </th>
                <th scope="col" className="text-start">
                  Mode, type
                </th>
                <th scope="col" className="text-start">
                  Line
                </th>
                <th scope="col" className="text-start">
                  Status
                </th>
                <th scope="col" className="text-start">
                  Added
                </th>
                <th scope="col" className="text-start">
                  Capacity
                </th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const type = typeOf(v.vehicleTypeId);
                return (
                  <tr key={v.id} className="border-t border-slate-200">
                    <th scope="row" className="pe-2 text-start font-mono">
                      {v.code}
                    </th>
                    <td className="pe-2">
                      {MODES[v.mode].label}
                      {type ? `, ${type.name}` : ''}
                    </td>
                    <td className="pe-2">{lineName(v.lineId)}</td>
                    <td className="pe-2">
                      {v.status === 'surplus'
                        ? `Surplus since ${date(v.surplusSince)}${depotName(v.code) ? `, at ${depotName(v.code)}` : ''}`
                        : 'Allocated'}
                    </td>
                    <td className="pe-2">{date(v.addedAt)}</td>
                    <td className="pe-2">
                      <input
                        type="number"
                        min={1}
                        className="w-20 rounded border border-slate-500 px-1"
                        aria-label={`${v.code}: own capacity (empty = profile ${type?.capacity ?? 'unknown'})`}
                        placeholder={type ? `${type.capacity} (profile)` : 'profile'}
                        key={`${v.id}-${v.capacityOverride ?? ''}`}
                        defaultValue={v.capacityOverride ?? ''}
                        onBlur={(e) => {
                          const n = e.target.value === '' ? null : Math.round(Number(e.target.value));
                          if (n === v.capacityOverride || (n !== null && !(n > 0))) return;
                          commit(
                            updateVehicleRecord(scenario, v.id, { capacityOverride: n }),
                            n === null ? `${v.code}: profile capacity` : `${v.code}: own capacity ${n}`,
                          );
                        }}
                      />
                    </td>
                    <td>
                      {(v.status === 'allocated' ||
                        depotName(v.code) ||
                        depotTracks(scenario, v.mode).length > 0) && (
                        <Button onClick={() => showVehicle(v.code)} aria-label={`Show ${v.code} on the map`}>
                          Show on map
                        </Button>
                      )}
                      {v.status === 'surplus' && (
                        <Button onClick={() => setConfirm([v.id])} aria-label={`Delete ${v.code}`}>
                          Delete…
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
