/**
 * Road traffic signals for trams and buses: find them along the lines in
 * OpenStreetMap, set assumed timings, and inspect single signals.
 */
import { useState } from 'react';
import type { Scenario, TrafficSignal } from '../domain/schema';
import {
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
import { Badge, Button, Section } from './primitives';

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
  const lines = signalLines(scenario);
  if (!lines.length && !scenario.trafficSignals.length) return null;
  const settings = scenario.signalSettings;

  const find = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetchTrafficSignals(signalSearchPaths(scenario));
      const before = scenario.trafficSignals.length;
      const next = addSignals(scenario, res.data);
      const added = next.trafficSignals.length - before;
      commit(
        {
          ...next,
        },
        `${added} traffic signal(s) added from OpenStreetMap`,
      );
      setMessage(`${added} new signal(s) found within 15 m of tram and bus lines (OpenStreetMap, ODbL).`);
    } catch (e) {
      setMessage(
        e instanceof ProviderError ? `Not loaded: ${e.message}` : 'Not loaded: the server did not answer',
      );
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
        Trams and buses stop at red in the animation. Positions come from OpenStreetMap; real signal plans are
        not published there, so the timings are assumptions you can edit.
      </p>
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
