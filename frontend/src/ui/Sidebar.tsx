import { useState, type FormEvent } from 'react';
import { useStore, useScenario } from '../store/projectStore';
import { MODES, MODE_LIST } from '../domain/modes';
import { isInterchange, isRing, lineLengthM, linesServingStation } from '../domain/network';
import { formatDistance } from '../analysis/units';
import { basemapOptions, terrainSource } from '../providers/basemaps';
import { geocode } from '../providers/registry';
import { CAPABILITY_LABELS, type GeocodeResult } from '../providers/types';
import { getMapInstance } from '../map/mapInstance';
import { Badge, Button, Checkbox, Section, SelectField } from './primitives';
import { t } from '../i18n';
import type { TransportMode } from '../domain/schema';

export function SearchBox() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    const res = await geocode(q.trim());
    setBusy(false);
    setResults(res.data);
    const label = CAPABILITY_LABELS[res.capability.state as keyof typeof CAPABILITY_LABELS] ?? '';
    const detail =
      res.capability.message && res.capability.message !== label ? `: ${res.capability.message}` : '';
    setStatus(`${res.data.length} result(s). ${label}${detail}. Source: ${res.provenance.attribution}`);
  };
  const go = (r: GeocodeResult) => {
    const map = getMapInstance();
    if (!map) return;
    if (r.bbox)
      map.fitBounds(
        [
          [r.bbox[0], r.bbox[1]],
          [r.bbox[2], r.bbox[3]],
        ],
        { maxZoom: 15 },
      );
    else map.flyTo({ center: r.position, zoom: 14 });
  };
  return (
    <Section title={t('search')} id="search" hideTitle>
      <form role="search" onSubmit={submit} className="flex gap-1">
        <label htmlFor="search-input" className="sr-only">
          Place name or "latitude, longitude"
        </label>
        <input
          id="search-input"
          className="min-w-0 flex-1 rounded border border-slate-500 px-2 py-1 text-sm"
          placeholder='Place or "lat, lon"'
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </Button>
      </form>
      <p className="mt-1 text-xs text-slate-600" aria-live="polite">
        {status}
      </p>
      {results.length > 0 && (
        <ul className="mt-1 max-h-32 overflow-auto text-sm">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                className="w-full text-start underline hover:bg-slate-100"
                onClick={() => go(r)}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function ToolPanel() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const mode = useStore((s) => s.newLineMode);
  const setMode = useStore((s) => s.setNewLineMode);
  const target = useStore((s) => s.stationTargetLineId);
  const setTarget = useStore((s) => s.setStationTargetLine);
  const scenario = useScenario();
  const tools: { id: typeof tool; label: string; disabled?: boolean }[] = [
    { id: 'select', label: t('toolSelect') },
    { id: 'draw_line', label: t('toolDrawLine') },
    { id: 'add_station', label: t('toolAddStation'), disabled: scenario.lines.length === 0 },
  ];
  return (
    <Section title={t('tools')} id="tools" hideTitle>
      <div
        className="mb-3 grid grid-cols-3 rounded-md bg-slate-100 p-0.5"
        role="group"
        aria-label="Editing tool"
      >
        {tools.map((it) => (
          <button
            key={it.id}
            type="button"
            aria-pressed={tool === it.id}
            disabled={it.disabled}
            onClick={() => setTool(it.id)}
            className={`rounded px-1 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
              tool === it.id
                ? 'bg-white font-semibold text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>
      <SelectField
        label="Mode for new lines"
        value={mode}
        onChange={(e) => setMode(e.target.value as TransportMode)}
        options={MODE_LIST.map((m) => ({ value: m, label: MODES[m].label }))}
        hint={
          tool === 'draw_line' && MODES[mode].prefersStreetNetwork
            ? 'Road-based mode: street routing is planned for Phase 2; drawn lines are conceptual.'
            : undefined
        }
      />
      {tool === 'add_station' && (
        <SelectField
          label="Add stations to"
          value={target ?? ''}
          onChange={(e) => setTarget(e.target.value || null)}
          options={[
            { value: '', label: 'Nearest line to the click' },
            ...scenario.lines.map((l) => ({ value: l.id, label: l.name })),
          ]}
          hint="Clicking within ~60 m of an existing station reuses it, creating an interchange."
        />
      )}
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer select-none">Keyboard shortcuts</summary>
        <ul className="mt-1 space-y-0.5 ps-3">
          <li>Ctrl+Z undo · Ctrl+Shift+Z or Ctrl+Y redo</li>
          <li>Esc cancels the current tool</li>
          <li>Delete removes the selected line or station</li>
          <li>Enter or double-click finishes a line</li>
        </ul>
      </details>
    </Section>
  );
}

export function LayerPanel() {
  const basemapId = useStore((s) => s.basemapId);
  const setBasemap = useStore((s) => s.setBasemap);
  const layers = useStore((s) => s.layers);
  const toggle = useStore((s) => s.toggleLayer);
  const fictional = useStore((s) => s.project.fictional);
  const synthetic = fictional
    ? 'Synthetic demonstration data'
    : 'No provider configured for real places (Phase 3); hidden';
  return (
    <Section title={t('layers')} id="layers" collapsible defaultOpen={false}>
      <SelectField
        label="Basemap"
        value={basemapId}
        onChange={(e) => setBasemap(e.target.value)}
        options={basemapOptions().map((o) => ({ value: o.id, label: o.label }))}
      />
      <Checkbox
        label="Terrain (3D, visual only)"
        checked={layers.terrain}
        onChange={() => toggle('terrain')}
        hint={terrainSource() ? 'Tilt the map to see relief' : 'Terrain tiles not configured'}
      />
      <Checkbox label="Buildings (basemap)" checked={layers.buildings} onChange={() => toggle('buildings')} />
      <Checkbox
        label="Parking and land use (basemap, where mapped)"
        checked={layers.parkingLandUse}
        onChange={() => toggle('parkingLandUse')}
      />
      <Checkbox
        label="Existing public transport"
        checked={layers.existingTransit}
        onChange={() => toggle('existingTransit')}
        hint={synthetic}
      />
      <Checkbox
        label="Population density"
        checked={layers.population}
        onChange={() => toggle('population')}
        hint={synthetic}
      />
      <Checkbox
        label="Traffic"
        checked={layers.traffic}
        onChange={() => toggle('traffic')}
        hint={fictional ? 'Demonstration data, not live/historic/predicted' : synthetic}
      />
      <Checkbox
        label="Station catchments"
        checked={layers.catchments}
        onChange={() => toggle('catchments')}
      />
    </Section>
  );
}

export function ScenarioPanel() {
  const project = useStore((s) => s.project);
  const setActive = useStore((s) => s.setActiveScenario);
  const duplicate = useStore((s) => s.duplicateActiveScenario);
  const del = useStore((s) => s.deleteScenario);
  return (
    <Section title={t('scenario')} id="scenario" collapsible defaultOpen={project.scenarios.length > 1}>
      <SelectField
        label="Active scenario"
        value={project.activeScenarioId}
        onChange={(e) => setActive(e.target.value)}
        options={project.scenarios.map((s) => ({ value: s.id, label: s.name }))}
        hint="Duplicate a scenario to compare alternative alignments; the Dashboard compares all scenarios."
      />
      <div className="flex gap-1">
        <Button onClick={duplicate}>Duplicate</Button>
        <Button
          variant="danger"
          onClick={() => del(project.activeScenarioId)}
          disabled={project.scenarios.length < 2}
        >
          Delete
        </Button>
      </div>
    </Section>
  );
}

export function NetworkLists() {
  const scenario = useScenario();
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const unitSystem = useStore((s) => s.unitSystem);
  return (
    <>
      <Section title={`${t('lines')} (${scenario.lines.length})`} id="lines">
        {scenario.lines.length === 0 && (
          <p className="text-sm text-slate-600">No lines yet. Choose “Draw line” or use the Table view.</p>
        )}
        <ul className="max-h-72 space-y-0.5 overflow-auto" aria-label="Lines">
          {scenario.lines.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-start text-sm hover:bg-slate-100 ${
                  selection?.kind === 'line' && selection.id === l.id ? 'bg-teal-100 font-semibold' : ''
                }`}
                aria-current={selection?.kind === 'line' && selection.id === l.id ? 'true' : undefined}
                onClick={() => select({ kind: 'line', id: l.id })}
              >
                <span
                  aria-hidden
                  className="inline-block h-3 w-6 rounded-sm"
                  style={{ background: l.color }}
                />
                <span className="flex-1">
                  {l.name}
                  <span className="block text-xs font-normal text-slate-600">
                    {MODES[l.mode].label} · {formatDistance(lineLengthM(l), unitSystem)} · {l.stops.length}{' '}
                    stations
                    {isRing(l) ? ' · ring' : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={`${t('stations')} (${scenario.stations.length})`} id="stations">
        <ul className="max-h-60 space-y-0.5 overflow-auto" aria-label="Stations">
          {scenario.stations.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`w-full rounded px-1 py-0.5 text-start text-sm hover:bg-slate-100 ${
                  selection?.kind === 'station' && selection.id === s.id ? 'bg-teal-100 font-semibold' : ''
                }`}
                aria-current={selection?.kind === 'station' && selection.id === s.id ? 'true' : undefined}
                onClick={() => select({ kind: 'station', id: s.id })}
              >
                {s.name} {isInterchange(scenario, s.id) && <Badge>Interchange</Badge>}
                <span className="block text-xs text-slate-600">
                  {linesServingStation(scenario, s.id)
                    .map((l) => l.shortName)
                    .join(', ') || 'Not served by any line'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
