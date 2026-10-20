/**
 * Close a section of a line in the animation and see how service adapts:
 * trains turn back at the nearest crossovers, or share one track between them.
 * Closures are a what-if for the simulation only; they are not saved.
 */
import { useState } from 'react';
import type { Scenario, TransportLine } from '../domain/schema';
import { isRing, orderedStops } from '../domain/network';
import { MODES } from '../domain/modes';
import { buildLineModel } from '../simulation/engine';
import { simulationOptions } from '../simulation/runtime';
import { useStore } from '../store/projectStore';
import { Button, SelectField, Section } from './primitives';

export function DisruptionPanel({ line, scenario }: { line: TransportLine; scenario: Scenario }) {
  const closures = useStore((s) => s.closures);
  const addClosure = useStore((s) => s.addClosure);
  const removeClosure = useStore((s) => s.removeClosure);
  const stops = orderedStops(line, scenario.stations);
  const [from, setFrom] = useState(stops[0]?.station.id ?? '');
  const [to, setTo] = useState(stops[1]?.station.id ?? '');
  const [kind, setKind] = useState<'turnback' | 'single_track'>('turnback');
  if (!MODES[line.mode].guided || isRing(line) || line.direction !== 'bidirectional' || stops.length < 2)
    return null;
  const closure = closures.find((c) => c.lineId === line.id);
  const name = (id: string) => scenario.stations.find((s) => s.id === id)?.name ?? '?';
  const notes = closure
    ? (buildLineModel(line, scenario, simulationOptions(scenario, closures))?.notes ?? [])
    : [];
  const options = stops.map((s) => ({ value: s.station.id, label: s.station.name }));
  return (
    <Section title="Disruption (simulation)" id="line-disruption" collapsible defaultOpen={!!closure}>
      {closure ? (
        <div className="text-sm">
          <p className="mb-1">
            <strong>Closed:</strong> {name(closure.fromStationId)} – {name(closure.toStationId)} (
            {closure.kind === 'turnback' ? 'both tracks' : 'one track'})
          </p>
          <ul className="mb-2 list-disc ps-5 text-xs text-slate-700">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <Button onClick={() => removeClosure(closure.id)}>Reopen section</Button>
        </div>
      ) : (
        <>
          <p className="mb-1 text-xs text-slate-600">
            Close part of the line and watch the animation: trains turn back at crossovers (add them in the
            station list) or run on the remaining track.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="From station"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              options={options}
            />
            <SelectField
              label="To station"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              options={options}
            />
          </div>
          <fieldset className="mb-2">
            <legend className="text-xs font-medium text-slate-800">What is closed</legend>
            {(
              [
                ['turnback', 'Both tracks (trains turn back)'],
                ['single_track', 'One track (single-track working)'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="me-3 flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name={`closure-kind-${line.id}`}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <Button
            disabled={!from || !to}
            onClick={() => addClosure({ lineId: line.id, fromStationId: from, toStationId: to, kind })}
          >
            Close section
          </Button>
        </>
      )}
    </Section>
  );
}
