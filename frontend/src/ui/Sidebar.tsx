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
import type { StructureType, TransportMode } from '../domain/schema';
import { STRUCTURE_LABELS } from '../domain/modes';
import { defaultRadiusM, isRailMode, trackGeometry } from '../domain/tracks';
import { trackSpacingM } from '../domain/trackParameters';
import { finishServiceDraft } from '../store/trackActions';
import { finishStopDraft } from '../store/stopActions';
import { isStopLineMode, stopNear } from '../domain/stopLines';
import { layoutError, MAX_PLATFORMS } from '../domain/stationLayout';
import { MODE_TABS, modeCounts, stationsForMode } from '../domain/modeSeparation';
import { CommitField } from './CommitField';
import { SEVERITY_ORDER, SEVERITY_PLURALS, SEVERITY_SYMBOLS, type Severity } from '../validation/validate';

const MARKER_SHAPES: Record<Severity, string> = {
  error: 'square',
  warning: 'triangle',
  recommendation: 'diamond',
  info: 'circle',
};

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
  const trackDraw = useStore((s) => s.trackDraw);
  const setTrackDraw = useStore((s) => s.setTrackDraw);
  const draft = useStore((s) => s.serviceDraft);
  const setDraft = useStore((s) => s.setServiceDraft);
  const rail = isRailMode(mode);
  const hasTracks = scenario.trackNetwork.tracks.length > 0;
  // A service of the active mode can only call at stations of that mode.
  const onTrackStations = stationsForMode(scenario, mode);
  const tools: { id: typeof tool; label: string; disabled?: boolean }[] = [
    { id: 'select', label: t('toolSelect') },
    { id: 'draw_line', label: rail ? 'Draw track' : t('toolDrawLine') },
    {
      id: 'add_station',
      label: t('toolAddStation'),
      // Rail stations are objects placed anywhere; bus stops go on a line.
      disabled: rail ? false : scenario.lines.length === 0 && !hasTracks,
    },
    { id: 'new_service', label: 'New service', disabled: onTrackStations.length < 2 },
  ];
  const defaultR = defaultRadiusM(mode);
  const spacing = trackSpacingM(scenario.trackNetwork, mode);
  return (
    <Section title={t('tools')} id="tools" hideTitle>
      <ModeTabs
        mode={mode}
        onChange={(m) => {
          setMode(m);
          setTool('select');
          setDraft([]);
        }}
      />
      <div
        className="mb-3 grid grid-cols-2 gap-0.5 rounded-md bg-slate-100 p-0.5"
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
      <p className="mb-2 text-xs text-slate-600">
        {rail
          ? `${MODES[mode].label}: draw track, place stations, then create services with “New service”. Other modes are shown faded and cannot be edited here.`
          : isStopLineMode(mode)
            ? `${MODES[mode].label}: draw a line by clicking its stops in order; it runs one way and returns to the first stop, routed on streets. Other modes are shown faded.`
            : MODES[mode].prefersStreetNetwork
              ? `${MODES[mode].label}: lines follow streets once routed. Other modes are shown faded.`
              : `${MODES[mode].label}. Other modes are shown faded.`}
      </p>
      {rail && (tool === 'draw_line' || tool === 'select') && (
        <fieldset className="mb-2 rounded border border-slate-200 p-2">
          <legend className="px-1 text-xs font-medium text-slate-800">New track</legend>
          <div className="mb-1 flex gap-3 text-sm">
            {([false, true] as const).map((d) => (
              <label key={String(d)} className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  name="track-count"
                  checked={trackDraw.double === d}
                  onChange={() => setTrackDraw({ double: d })}
                />
                {d ? `Double (${spacing} m apart)` : 'Single'}
              </label>
            ))}
          </div>
          <CommitField
            label="Curve radius at each point"
            unit={`m, empty = sharp corners; default ${defaultR ?? 'none'}`}
            type="number"
            min={1}
            max={100000}
            value={trackDraw.radius === 'default' ? (defaultR ?? null) : trackDraw.radius}
            onCommit={(v) =>
              setTrackDraw({ radius: v === '' ? null : Number(v) === defaultR ? 'default' : Number(v) })
            }
            hint={
              trackDraw.double
                ? 'For double track this is the inner track; the outer track gets the radius plus the spacing.'
                : undefined
            }
          />
          <label className="mb-1 flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={trackDraw.guides}
              onChange={(e) => setTrackDraw({ guides: e.target.checked })}
            />
            Drawing guides (straight on, 45°, 90° to the last leg; parallel to straight track within 100 m)
          </label>
          <SelectField
            label="Structure"
            value={trackDraw.structure}
            onChange={(e) => setTrackDraw({ structure: e.target.value as StructureType | 'default' })}
            options={[
              { value: 'default', label: `Mode default (${STRUCTURE_LABELS[MODES[mode].defaultStructure]})` },
              ...Object.entries(STRUCTURE_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
        </fieldset>
      )}
      {tool === 'draw_line' && isStopLineMode(mode) && <StopDraftPanel />}
      {tool === 'new_service' && (
        <fieldset className="mb-2 rounded border border-slate-200 p-2">
          <legend className="px-1 text-xs font-medium text-slate-800">
            New service: stations in calling order
          </legend>
          <ol className="mb-1 list-decimal ps-5 text-sm" aria-label="Picked stations">
            {draft.map((id, i) => (
              <li key={`${id}-${i}`}>
                {scenario.stations.find((x) => x.id === id)?.name ?? id}{' '}
                <button
                  type="button"
                  className="text-xs underline"
                  aria-label={`Remove stop ${i + 1}`}
                  onClick={() => setDraft(draft.filter((_, k) => k !== i))}
                >
                  remove
                </button>
              </li>
            ))}
          </ol>
          <SelectField
            label="Add a station"
            value=""
            onChange={(e) => e.target.value && setDraft([...draft, e.target.value])}
            options={[
              { value: '', label: `Choose a ${MODES[mode].label} station…` },
              ...onTrackStations.map((st) => ({ value: st.id, label: st.name })),
            ]}
            hint="Or click stations on the map."
          />
          <Button variant="primary" disabled={draft.length < 2} onClick={() => finishServiceDraft()}>
            Create service
          </Button>
        </fieldset>
      )}
      {tool === 'add_station' && rail && <StationDraftOptions />}
      {tool === 'add_station' && !rail && (
        <SelectField
          label="Add stations to"
          value={target ?? ''}
          onChange={(e) => setTarget(e.target.value || null)}
          options={[
            { value: '', label: 'Nearest line to the click' },
            ...scenario.lines
              .filter((l) => l.alignment.kind !== 'track')
              .map((l) => ({ value: l.id, label: l.name })),
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
  const markerVisibility = useStore((s) => s.markerVisibility);
  const setMarkerVisible = useStore((s) => s.setMarkerVisible);
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
      <fieldset className="mt-2">
        <legend className="text-xs font-medium text-slate-800">Validation markers on the map</legend>
        {SEVERITY_ORDER.map((sev) => (
          <Checkbox
            key={sev}
            label={`${SEVERITY_SYMBOLS[sev]} ${SEVERITY_PLURALS[sev]} (${MARKER_SHAPES[sev]})`}
            checked={markerVisibility[sev]}
            onChange={(v) => setMarkerVisible(sev, v)}
          />
        ))}
        <p className="text-xs text-slate-600">
          Click a marker to open its object and finding; nearby markers are grouped until you zoom in.
        </p>
      </fieldset>
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
          <p className="text-sm text-slate-600">
            No lines yet. Draw track and stations, then “New service”; or draw a bus line. The Table view
            works without the map.
          </p>
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
      <Section
        title={`Tracks (${scenario.trackNetwork.tracks.length})`}
        id="tracks"
        collapsible
        defaultOpen={false}
      >
        {scenario.trackNetwork.tracks.length === 0 && (
          <p className="text-sm text-slate-600">No track yet. Choose a track mode and “Draw track”.</p>
        )}
        <ul className="max-h-60 space-y-0.5 overflow-auto" aria-label="Tracks">
          {scenario.trackNetwork.tracks.map((tr, i) => (
            <li key={tr.id}>
              <button
                type="button"
                className={`w-full rounded px-1 py-0.5 text-start text-sm hover:bg-slate-100 ${
                  selection?.kind === 'track' && selection.id === tr.id ? 'bg-teal-100 font-semibold' : ''
                }`}
                aria-current={selection?.kind === 'track' && selection.id === tr.id ? 'true' : undefined}
                onClick={() => select({ kind: 'track', id: tr.id })}
              >
                {tr.name || `Track ${i + 1}`}
                <span className="block text-xs text-slate-600">
                  {formatDistance(trackGeometry(scenario.trackNetwork, tr).lengthM, unitSystem)} ·{' '}
                  {tr.groupId ? 'double track' : 'single track'} ·{' '}
                  {tr.direction === 'both' ? 'both ways' : 'one way'}
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

/** Platforms of the next rail station object. */
function StationDraftOptions() {
  const draft = useStore((s) => s.stationDraft);
  const setDraft = useStore((s) => s.setStationDraft);
  const error = layoutError(draft.sidePlatforms, draft.islandPlatforms);
  const field = (key: 'sidePlatforms' | 'islandPlatforms', label: string) => (
    <div>
      <label htmlFor={`draft-${key}`} className="block text-xs font-medium text-slate-800">
        {label}
      </label>
      <input
        id={`draft-${key}`}
        type="number"
        min={0}
        max={MAX_PLATFORMS}
        step={1}
        value={draft[key]}
        onChange={(e) =>
          setDraft({ [key]: Math.max(0, Math.min(MAX_PLATFORMS, Math.round(Number(e.target.value) || 0))) })
        }
        className="w-full rounded border border-slate-500 px-1 py-0.5 text-sm"
      />
    </div>
  );
  return (
    <fieldset className="mb-2 rounded border border-slate-200 p-2">
      <legend className="px-1 text-xs font-medium text-slate-800">New station</legend>
      <div className="grid grid-cols-2 gap-2">
        {field('sidePlatforms', 'Side platforms for new stations')}
        {field('islandPlatforms', 'Island platforms for new stations')}
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Each side platform has one track, each island one track on either side. Platform sizes are in the
        track parameters.
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-800">
          ⛔ {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * One tab per transport mode. Each mode has its own tracks, stations and lines; the tab
 * decides what the tools create and edit. Keyboard: arrow keys move between tabs.
 */
function ModeTabs({ mode, onChange }: { mode: TransportMode; onChange: (m: TransportMode) => void }) {
  const scenario = useScenario();
  const counts = modeCounts(scenario);
  const tabs = MODE_TABS;
  const others = MODE_LIST.filter((m) => !tabs.some((t) => t.mode === m));
  const inTabs = tabs.some((t) => t.mode === mode);
  const move = (dir: 1 | -1) => {
    const i = tabs.findIndex((t) => t.mode === mode);
    const next = tabs[(i + dir + tabs.length) % tabs.length]!;
    onChange(next.mode);
    document.getElementById(`mode-tab-${next.mode}`)?.focus();
  };
  return (
    <div className="mb-2">
      <div role="tablist" aria-label="Transport mode" className="flex flex-wrap gap-0.5">
        {tabs.map((t) => (
          <button
            key={t.mode}
            id={`mode-tab-${t.mode}`}
            type="button"
            role="tab"
            aria-selected={mode === t.mode}
            tabIndex={mode === t.mode || (!inTabs && t === tabs[0]) ? 0 : -1}
            onClick={() => onChange(t.mode)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') move(1);
              else if (e.key === 'ArrowLeft') move(-1);
            }}
            className={`rounded-t border-b-2 px-2 py-1 text-xs ${
              mode === t.mode
                ? 'border-current font-semibold text-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
            style={mode === t.mode ? { color: MODES[t.mode].color } : undefined}
          >
            {t.label}
            {counts[t.mode] ? <span className="ms-1 text-slate-500">({counts[t.mode]})</span> : null}
          </button>
        ))}
      </div>
      <SelectField
        label="Other modes"
        value={inTabs ? '' : mode}
        onChange={(e) => e.target.value && onChange(e.target.value as TransportMode)}
        options={[
          { value: '', label: 'Choose…' },
          ...others.map((m) => ({ value: m, label: MODES[m].label })),
        ]}
      />
    </div>
  );
}

/** The stops placed so far for a new street line, with a keyboard path to finish or undo. */
function StopDraftPanel() {
  const draft = useStore((s) => s.stopDraft);
  const setDraft = useStore((s) => s.setStopDraft);
  const mode = useStore((s) => s.newLineMode);
  const scenario = useScenario();
  return (
    <fieldset className="mb-2 rounded border border-slate-200 p-2">
      <legend className="px-1 text-xs font-medium text-slate-800">
        New {MODES[mode].label} line: stops in the order served
      </legend>
      {draft.length === 0 ? (
        <p className="mb-1 text-sm text-slate-600">
          Click the first stop on the map, at the kerb on the side the vehicle stops.
        </p>
      ) : (
        <ol className="mb-1 list-decimal ps-5 text-sm" aria-label="Placed stops">
          {draft.map((p, i) => (
            <li key={`${p[0]}-${p[1]}-${i}`}>
              {stopNear(scenario, mode, p)?.name ?? 'New stop'}{' '}
              <button
                type="button"
                className="text-xs underline"
                aria-label={`Remove stop ${i + 1}`}
                onClick={() => setDraft(draft.filter((_, k) => k !== i))}
              >
                remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="mb-1 text-xs text-slate-600">
        After the last stop the line returns to the first one. Esc, Enter or right-click finishes; Backspace
        removes the last stop.
      </p>
      <Button variant="primary" disabled={draft.length < 2} onClick={() => finishStopDraft()}>
        Finish line
      </Button>
    </fieldset>
  );
}
