/** Waits for occupied track in a simulated hour (R14b): per line and per place, with a link to the map. */
import { useMemo } from 'react';
import type { Scenario } from '../domain/schema';
import { operationsReport, WAIT_PLACE_LABELS } from '../simulation/report';
import { simulationOptions } from '../simulation/runtime';
import { getMapInstance } from '../map/mapInstance';
import { Section } from './primitives';

const min = (s: number) => (s / 60).toFixed(1);

export function OperationsReportSection({ scenario }: { scenario: Scenario }) {
  const report = useMemo(() => operationsReport(scenario, simulationOptions(scenario, []), 3600), [scenario]);
  const name = (id: string) => scenario.lines.find((l) => l.id === id)?.name ?? id;
  const anyWaits = report.lines.some((l) => l.waits > 0);
  return (
    <Section title="Operations: waits for occupied track (simulated hour)" id="dash-operations">
      <p className="mb-1 text-xs text-slate-600">
        One hour of service at the peak headways, scheduled the way the animation runs it: vehicles wait
        before single-track sections, junctions and crossings of tracks (one route at a time), crossings with
        other lines and shared streets until they are clear. Illustrative; no timetable optimisation.
      </p>
      {!report.lines.length ? (
        <p className="text-sm">No line is simulated yet.</p>
      ) : (
        <table className="w-full text-sm" data-testid="operations-report">
          <caption className="sr-only">Waits for occupied track per line in one simulated hour</caption>
          <thead>
            <tr>
              <th scope="col" className="text-start">
                Line
              </th>
              <th scope="col" className="text-end">
                Trips
              </th>
              <th scope="col" className="text-end">
                Waits
              </th>
              <th scope="col" className="text-end">
                Total wait (min)
              </th>
              <th scope="col" className="text-end">
                Longest (min)
              </th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((l) => (
              <tr key={l.lineId}>
                <th scope="row" className="text-start font-normal">
                  {name(l.lineId)}
                  {l.places.length > 0 && (
                    <ul className="ps-3 text-xs text-slate-700">
                      {l.places.slice(0, 3).map((p) => (
                        <li key={p.resourceId}>
                          {p.count}× at a {WAIT_PLACE_LABELS[p.kind]} ({min(p.totalS)} min){' '}
                          <button
                            type="button"
                            className="underline"
                            onClick={() => getMapInstance()?.flyTo({ center: p.position, zoom: 16 })}
                          >
                            show on map
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </th>
                <td className="text-end align-top">{l.trips}</td>
                <td className="text-end align-top">{l.waits}</td>
                <td className="text-end align-top">{min(l.totalS)}</td>
                <td className="text-end align-top">{min(l.maxS)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {report.lines.length > 0 && !anyWaits && (
        <p className="mt-1 text-sm">✓ No vehicle waits for occupied track in this hour.</p>
      )}
      {report.warnings.length > 0 && (
        <ul className="mt-1 list-disc ps-5 text-sm text-amber-900" aria-label="Capacity warnings">
          {report.warnings.map((w) => (
            <li key={w}>⚠ {scenario.lines.reduce((t, l) => t.replaceAll(l.id, l.name), w)}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}
