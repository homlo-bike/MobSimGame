/**
 * Non-map alternative for the main editing tasks: create lines from typed
 * coordinates, and review/select every line and station in tables.
 */
import { useId, useState, type FormEvent } from 'react';
import type { LngLat, TransportMode } from '../domain/schema';
import { createLine, isInterchange, lineLengthM, linesServingStation } from '../domain/network';
import { MODES, MODE_LIST } from '../domain/modes';
import { formatDistance } from '../analysis/units';
import { useStore, useScenario } from '../store/projectStore';
import { Button, Checkbox, SelectField, Section } from './primitives';

export function parseCoordinateList(text: string): { coords: LngLat[]; errors: string[] } {
  const coords: LngLat[] = [];
  const errors: string[] = [];
  text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((row, i) => {
      const parts = row.split(/[,;\s]+/).map(Number);
      const [lng, lat] = parts;
      if (parts.length !== 2 || !Number.isFinite(lng) || !Number.isFinite(lat))
        errors.push(`Row ${i + 1}: expected "longitude, latitude"`);
      else if (Math.abs(lng!) > 180 || Math.abs(lat!) > 90)
        errors.push(`Row ${i + 1}: [${lng}, ${lat}] is outside WGS84 bounds (order is longitude, latitude)`);
      else coords.push([lng!, lat!]);
    });
  if (!errors.length && coords.length < 2) errors.push('Enter at least two coordinates');
  return { coords, errors };
}

export function TableView() {
  const scenario = useScenario();
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const unitSystem = useStore((s) => s.unitSystem);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<TransportMode>('tram');
  const [ring, setRing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const ids = { text: useId(), name: useId(), err: useId() };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!useStore.getState().projectActive) {
      useStore.getState().openProjectGate('create');
      setErrors(['Create or open a project first, then create the line.']);
      return;
    }
    const { coords, errors: errs } = parseCoordinateList(text);
    setErrors(errs);
    if (errs.length) return;
    const res = createLine(scenario, {
      coordinates: coords,
      mode,
      name: name.trim() || undefined,
      ring: ring || undefined,
    });
    commit(res.scenario, `Line "${res.line.name}" created from ${coords.length} coordinates`);
    select({ kind: 'line', id: res.line.id });
    setText('');
    setName('');
  };

  return (
    <div className="h-full overflow-auto bg-white">
      <Section title="Create a line from coordinates" id="create-line">
        <form onSubmit={submit} aria-describedby={errors.length ? ids.err : undefined}>
          {errors.length > 0 && (
            <div
              id={ids.err}
              role="alert"
              className="mb-2 rounded border-2 border-red-700 bg-red-50 p-2 text-sm text-red-950"
            >
              <p className="font-semibold">⛔ Please fix {errors.length} problem(s):</p>
              <ul className="list-disc ps-5">
                {errors.map((er) => (
                  <li key={er}>{er}</li>
                ))}
              </ul>
            </div>
          )}
          <label htmlFor={ids.text} className="block text-xs font-medium">
            Coordinates, one “longitude, latitude” pair per row (WGS84, GeoJSON order)
          </label>
          <textarea
            id={ids.text}
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mb-2 w-full rounded border border-slate-500 p-1 font-mono text-sm"
            placeholder={'0.0000, 0.0100\n0.0200, 0.0100'}
          />
          <label htmlFor={ids.name} className="block text-xs font-medium">
            Line name (optional)
          </label>
          <input
            id={ids.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mb-2 w-full rounded border border-slate-500 px-2 py-1 text-sm"
          />
          <SelectField
            label="Mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as TransportMode)}
            options={MODE_LIST.map((m) => ({ value: m, label: MODES[m].label }))}
          />
          <Checkbox
            label="Ring line (closes back to the first coordinate)"
            checked={ring}
            onChange={setRing}
          />
          <Button type="submit" variant="primary">
            Create line
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-600">Then add stations by chainage in the line inspector.</p>
      </Section>
      <Section title="Lines" id="table-lines">
        <table className="w-full text-sm">
          <caption className="sr-only">Lines in {scenario.name}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-start">
                Name
              </th>
              <th scope="col" className="text-start">
                Mode
              </th>
              <th scope="col" className="text-end">
                Length
              </th>
              <th scope="col" className="text-end">
                Stations
              </th>
              <th scope="col" className="text-start ps-2">
                Direction
              </th>
            </tr>
          </thead>
          <tbody>
            {scenario.lines.map((l) => (
              <tr key={l.id}>
                <th scope="row" className="text-start font-normal">
                  <button
                    type="button"
                    className="underline"
                    onClick={() => select({ kind: 'line', id: l.id })}
                  >
                    {l.name}
                  </button>
                </th>
                <td>{MODES[l.mode].label}</td>
                <td className="text-end">{formatDistance(lineLengthM(l), unitSystem)}</td>
                <td className="text-end">{l.stops.length}</td>
                <td className="ps-2">{l.direction === 'one_way' ? 'One-way' : 'Bidirectional'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Stations" id="table-stations">
        <table className="w-full text-sm">
          <caption className="sr-only">Stations in {scenario.name}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-start">
                Name
              </th>
              <th scope="col" className="text-start">
                Lines
              </th>
              <th scope="col" className="text-start">
                Construction
              </th>
              <th scope="col" className="text-end">
                Longitude
              </th>
              <th scope="col" className="text-end">
                Latitude
              </th>
            </tr>
          </thead>
          <tbody>
            {scenario.stations.map((s) => (
              <tr key={s.id}>
                <th scope="row" className="text-start font-normal">
                  <button
                    type="button"
                    className="underline"
                    onClick={() => select({ kind: 'station', id: s.id })}
                  >
                    {s.name}
                  </button>
                  {isInterchange(scenario, s.id) ? ' (interchange)' : ''}
                </th>
                <td>
                  {linesServingStation(scenario, s.id)
                    .map((l) => l.shortName)
                    .join(', ')}
                </td>
                <td>{s.construction}</td>
                <td className="text-end font-mono">{s.position[0].toFixed(5)}</td>
                <td className="text-end font-mono">{s.position[1].toFixed(5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
