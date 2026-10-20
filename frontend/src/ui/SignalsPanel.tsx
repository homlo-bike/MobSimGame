/**
 * Road traffic signals for trams and buses: find them along the lines in
 * OpenStreetMap, set assumed timings, and inspect single signals.
 */
import { useState, type FormEvent } from 'react';
import type { Scenario, TrafficSignal } from '../domain/schema';
import {
  addManualSignal,
  describeSignal,
  SIGNAL_KIND_LABELS,
  addSignals,
  applySignalDefaults,
  removeSignal,
  signalLines,
  signalSearchPaths,
  updateSignal,
} from '../domain/signals';
import { fetchTrafficSignals, ProviderError } from '../providers/backend';
import { useStore, useScenario } from '../store/projectStore';
import { CommitField } from './CommitField';
import { Badge, Button, SelectField, Section } from './primitives';
import { MetadataEditor } from './MetadataEditor';
import { notify } from '../store/notifications';

const STATUS_LABEL: Record<TrafficSignal['timingStatus'], string> = {
  demonstration: 'Placeholder timing (assumed, uncited)',
  documented_default: 'Documented default',
  user_override: 'Your values',
  calibrated: 'Calibrated',
};

export function SignalsPanel() {
  const scenario = useScenario();
  const project = useStore((s) => s.project);
  const commit = useStore((s) => s.commitScenario);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const select = useStore((s) => s.select);
  const [at, setAt] = useState('');
  const [atError, setAtError] = useState<string | null>(null);
  const lines = signalLines(scenario);
  const settings = scenario.signalSettings;
  const imported = scenario.trafficSignals.filter((x) => x.confirmation === 'imported').length;
  const placeAt = (e: FormEvent) => {
    e.preventDefault();
    const parts = at
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map(Number);
    const [lng, lat] = parts;
    if (
      parts.length !== 2 ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      Math.abs(lng!) > 180 ||
      Math.abs(lat!) > 90
    )
      return setAtError('Enter "longitude, latitude" in WGS84');
    setAtError(null);
    const res = addManualSignal(scenario, [lng!, lat!]);
    commit(res.scenario, 'Traffic signal added');
    select({ kind: 'signal', id: res.signal.id });
    setAt('');
  };

  const find = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetchTrafficSignals(signalSearchPaths(scenario));
      const before = scenario.trafficSignals.length;
      const next = addSignals(scenario, res.data, res.provenance.retrievedAt ?? new Date().toISOString());
      const added = next.trafficSignals.length - before;
      commit(
        {
          ...next,
        },
        `${added} traffic signal(s) added from OpenStreetMap`,
      );
      setMessage(`${added} new signal(s) found within 15 m of tram and bus lines (OpenStreetMap, ODbL).`);
      notify({
        severity: 'success',
        kind: 'network',
        title: `${added} traffic signal(s) added`,
        toast: false,
      });
    } catch (e) {
      const msg =
        e instanceof ProviderError ? `Not loaded: ${e.message}` : 'Not loaded: the server did not answer';
      setMessage(msg);
      notify({
        severity: 'error',
        kind: 'network',
        title: 'Traffic signals not loaded',
        message: msg,
        toast: false,
      });
    } finally {
      setBusy(false);
    }
  };

  const setDefaults = (patch: Partial<Scenario['signalSettings']>) =>
    commit(
      applySignalDefaults(scenario, { ...settings, ...patch, status: 'user_override' }),
      'Signal timings updated',
    );

  return (
    <Section
      title={`Traffic signals (${scenario.trafficSignals.length})`}
      id="signals"
      collapsible
      defaultOpen={false}
    >
      <p className="mb-2 text-xs text-slate-600">
        Trams and buses stop at red in the animation. Place signals by hand or find them in OpenStreetMap;
        real signal plans are not published there, so the timings are assumptions you can edit. A place
        without a mapped signal may still have one.
      </p>
      <Button
        pressed={tool === 'add_signal'}
        onClick={() => setTool(tool === 'add_signal' ? 'select' : 'add_signal')}
      >
        {tool === 'add_signal' ? 'Placing signals… (Esc to stop)' : 'Place signals on the map'}
      </Button>
      <form onSubmit={placeAt} className="mt-1 flex items-end gap-1">
        <div className="flex-1">
          <label htmlFor="signal-at" className="block text-xs font-medium text-slate-800">
            Add a signal at “longitude, latitude”
          </label>
          <input
            id="signal-at"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="w-full rounded border border-slate-500 px-1 py-0.5 font-mono text-sm"
            aria-describedby={atError ? 'signal-at-err' : undefined}
          />
        </div>
        <Button type="submit">Add</Button>
      </form>
      {atError && (
        <p id="signal-at-err" role="alert" className="text-xs text-red-800">
          ⛔ {atError}
        </p>
      )}
      <ul className="mt-2 max-h-40 overflow-auto text-sm" aria-label="Traffic signals">
        {scenario.trafficSignals.map((sig, i) => (
          <li key={sig.id}>
            <button
              type="button"
              className="w-full text-start underline"
              onClick={() => select({ kind: 'signal', id: sig.id })}
            >
              {sig.label || `Signal ${i + 1}`} · {SIGNAL_KIND_LABELS[sig.kind]} ·{' '}
              {sig.source === 'osm'
                ? sig.confirmation === 'confirmed'
                  ? 'OSM, confirmed'
                  : 'OSM, not confirmed'
                : 'placed by hand'}
            </button>
          </li>
        ))}
      </ul>
      {imported > 0 && (
        <Button
          className="mt-1"
          onClick={() =>
            commit(
              {
                ...scenario,
                trafficSignals: scenario.trafficSignals.map((x) => ({
                  ...x,
                  confirmation: 'confirmed' as const,
                })),
              },
              `${imported} imported signal(s) confirmed`,
            )
          }
        >
          Confirm all {imported} imported signal(s)
        </Button>
      )}
      <Button onClick={find} disabled={busy || !lines.length || project.fictional}>
        {busy ? 'Searching…' : 'Find signals along tram and bus lines'}
      </Button>
      <p className="mt-1 text-xs text-slate-600">Sends the street-level line geometry to the Overpass API.</p>
      {message && (
        <p role="status" className="mt-1 text-xs">
          {message}
        </p>
      )}
      <div className="mt-2">
        <Badge tone={settings.status === 'user_override' ? 'ok' : 'warn'}>
          {STATUS_LABEL[settings.status]}
        </Badge>
        <div className="mt-1 grid grid-cols-3 gap-1">
          <CommitField
            label="Cycle"
            unit="s"
            type="number"
            min={20}
            max={300}
            value={settings.defaultCycleS}
            onCommit={(v) => setDefaults({ defaultCycleS: Number(v) })}
          />
          <CommitField
            label="Green"
            unit="s"
            type="number"
            min={5}
            max={300}
            value={settings.defaultGreenS}
            onCommit={(v) =>
              Number(v) < settings.defaultCycleS
                ? setDefaults({ defaultGreenS: Number(v) })
                : 'Must be shorter than the cycle'
            }
          />
          <CommitField
            label="Priority"
            unit="s"
            type="number"
            min={0}
            max={60}
            value={settings.priorityAdjustmentS}
            onCommit={(v) => setDefaults({ priorityAdjustmentS: Number(v) })}
          />
        </div>
        <p className="text-xs text-slate-600">
          Priority: seconds by which transit signal priority (switched on per line) extends green or shortens
          red. Individually edited signals keep their own values.
        </p>
      </div>
      {scenario.trafficSignals.length > 0 && (
        <Button
          variant="danger"
          className="mt-2"
          onClick={() => commit({ ...scenario, trafficSignals: [] }, 'All traffic signals removed')}
        >
          Remove all signals
        </Button>
      )}
    </Section>
  );
}

export function SignalInspector({ signal, scenario }: { signal: TrafficSignal; scenario: Scenario }) {
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const patch = (p: Partial<TrafficSignal>) =>
    commit(updateSignal(scenario, signal.id, p), 'Signal timing updated');
  const describe = (p: Partial<TrafficSignal>, label = 'Signal updated') =>
    commit(describeSignal(scenario, signal.id, p), label);
  const net = scenario.trackNetwork;
  const attachOptions = [
    { value: '', label: 'Nearby tram and bus lines (within 20 m)' },
    ...scenario.lines.map((l) => ({ value: `line:${l.id}`, label: `Line: ${l.name}` })),
    ...net.tracks.map((t, i) => ({ value: `track:${t.id}`, label: `Track: ${t.name || `Track ${i + 1}`}` })),
  ];
  return (
    <Section title="Traffic signal" id="signal-inspector">
      <p className="mb-2 text-sm">
        {signal.ref ? (
          <>
            OpenStreetMap{' '}
            <a
              className="underline"
              href={`https://www.openstreetmap.org/${signal.ref}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {signal.ref}
            </a>
          </>
        ) : (
          'Placed manually'
        )}{' '}
        ·{' '}
        <Badge tone={signal.timingStatus === 'user_override' ? 'ok' : 'warn'}>
          {STATUS_LABEL[signal.timingStatus]}
        </Badge>
      </p>
      {signal.source === 'osm' && (
        <p className="mb-2 text-xs text-slate-700">
          Found in OpenStreetMap{signal.retrievedAt ? ` on ${signal.retrievedAt.slice(0, 10)}` : ''} ·
          confidence {signal.confidence} ·{' '}
          <Badge tone={signal.confirmation === 'confirmed' ? 'ok' : 'warn'}>
            {signal.confirmation === 'confirmed' ? 'Confirmed by you' : 'Imported, not confirmed'}
          </Badge>{' '}
          {signal.confirmation === 'imported' && (
            <Button
              variant="ghost"
              onClick={() => describe({ confirmation: 'confirmed' }, 'Signal confirmed')}
            >
              Confirm
            </Button>
          )}
        </p>
      )}
      <CommitField label="Label" value={signal.label} onCommit={(v) => describe({ label: v.trim() })} />
      <SelectField
        label="Signal type"
        value={signal.kind}
        onChange={(e) => describe({ kind: e.target.value as TrafficSignal['kind'] }, 'Signal type changed')}
        options={Object.entries(SIGNAL_KIND_LABELS).map(([value, label]) => ({ value, label }))}
      />
      <fieldset className="mb-2">
        <legend className="text-xs font-medium text-slate-800">Controls (none ticked = not specified)</legend>
        {(['cars', 'buses', 'trams', 'bicycles', 'pedestrians'] as const).map((c) => (
          <label key={c} className="me-2 inline-flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={signal.controls.includes(c)}
              onChange={(e) =>
                describe({
                  controls: e.target.checked
                    ? [...signal.controls, c]
                    : signal.controls.filter((x) => x !== c),
                })
              }
            />
            {c}
          </label>
        ))}
        <p className="text-xs text-slate-600">
          In the animation the signal stops trams and buses unless controls are set and exclude them.
        </p>
      </fieldset>
      <SelectField
        label="Transit priority at this signal"
        value={signal.priority}
        onChange={(e) => describe({ priority: e.target.value as TrafficSignal['priority'] })}
        options={[
          { value: 'unknown', label: 'Unknown' },
          { value: 'none', label: 'None' },
          { value: 'extend_green', label: 'Green extension' },
          { value: 'early_green', label: 'Early green (red truncation)' },
          { value: 'pre_emption', label: 'Pre-emption' },
        ]}
        hint="Recorded for the project; the animation applies priority where a line has it switched on."
      />
      <SelectField
        label="Applies to"
        value={signal.attachedTo ? `${signal.attachedTo.kind}:${signal.attachedTo.id}` : ''}
        onChange={(e) => {
          const [kind, id] = e.target.value.split(':');
          describe(
            { attachedTo: kind && id ? { kind: kind as 'line' | 'track', id } : null },
            'Signal attachment changed',
          );
        }}
        options={attachOptions}
      />
      <CommitField
        label="Approximate delay"
        unit="s per vehicle; empty = simulate the cycle"
        type="number"
        min={0}
        max={600}
        value={signal.approxDelayS}
        onCommit={(v) => describe({ approxDelayS: v === '' ? null : Number(v) }, 'Signal delay changed')}
      />
      <div className="grid grid-cols-3 gap-1">
        <CommitField
          label="Cycle"
          unit="s"
          type="number"
          min={20}
          max={300}
          value={signal.cycleS}
          onCommit={(v) =>
            Number(v) > signal.greenS ? patch({ cycleS: Number(v) }) : 'Must be longer than green'
          }
        />
        <CommitField
          label="Green"
          unit="s"
          type="number"
          min={5}
          max={300}
          value={signal.greenS}
          onCommit={(v) =>
            Number(v) < signal.cycleS ? patch({ greenS: Number(v) }) : 'Must be shorter than the cycle'
          }
        />
        <CommitField
          label="Offset"
          unit="s"
          type="number"
          min={0}
          max={300}
          value={signal.offsetS}
          onCommit={(v) => patch({ offsetS: Number(v) % signal.cycleS })}
        />
      </div>
      <p className="mb-2 text-xs text-slate-600">
        Green applies to the tram or bus approach; the rest of the cycle counts as red. Offsets are unknown
        and spread automatically until you set them.
      </p>
      <MetadataEditor
        value={signal.metadata}
        onChange={(metadata) => describe({ metadata }, 'Signal details changed')}
        idPrefix={`signal-${signal.id}`}
      />
      <p className="text-xs text-slate-600">Drag the signal on the map to move it.</p>
      <Button
        variant="danger"
        onClick={() => {
          commit(removeSignal(scenario, signal.id), 'Traffic signal removed');
          select(null);
        }}
      >
        Remove signal
      </Button>
    </Section>
  );
}
