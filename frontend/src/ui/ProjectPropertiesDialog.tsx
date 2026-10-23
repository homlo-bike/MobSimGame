/**
 * Project preferences: every default the project uses, with its source and status, in one
 * place (parameters, per-mode defaults, vehicles, crossing priority).
 */
import { useEffect, useRef } from 'react';
import type { Electrification } from '../domain/schema';
import { useScenario, useStore, type PropertiesTab } from '../store/projectStore';
import { applyModeDefaultsToTracks, modeDefaultRows, setModeTrackDefault } from '../domain/projectProperties';
import { ELECTRIFICATION_LABELS } from '../domain/compatibility';
import { RIGHT_OF_WAY_LABELS, STRUCTURE_LABELS } from '../domain/modes';
import type { RightOfWay, ServicePeriod, StructureType } from '../domain/schema';
import { newId } from '../util/id';
import { setModeSetting } from '../domain/inheritance';
import { TrackParametersPanel } from './TrackInspector';
import { PriorityPanel } from './PriorityPanel';
import { VehicleProfilesPanel } from './VehicleProfiles';
import { Badge, Button } from './primitives';

const TABS: { id: PropertiesTab; label: string }[] = [
  { id: 'parameters', label: 'Parameters' },
  { id: 'modes', label: 'Modes' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'priority', label: 'Crossing priority' },
  { id: 'service_day', label: 'Service day' },
];

export function ProjectPropertiesDialog() {
  const tab = useStore((s) => s.propertiesTab);
  // Mounted only while open, so the page holds no hidden dialog.
  return tab ? <PropertiesDialog tab={tab} /> : null;
}

function PropertiesDialog({ tab }: { tab: PropertiesTab }) {
  const open = useStore((s) => s.openProperties);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={() => open(null)}
      aria-labelledby="pp-title"
      className="m-auto max-h-[90vh] w-[min(64rem,95vw)] overflow-auto rounded border border-slate-400 p-0 backdrop:bg-black/40"
    >
      <div className="p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h2 id="pp-title" className="text-lg font-semibold">
            Project preferences
          </h2>
          <Button onClick={() => open(null)} aria-label="Close project properties">
            Close
          </Button>
        </div>
        <p className="mb-2 text-xs text-slate-600">
          Every default this project uses, with where it comes from. Values marked placeholder are not from a
          source: enter local values. Changes apply to this scenario.
        </p>
        <div role="tablist" aria-label="Project preferences" className="mb-2 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`pp-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="pp-panel"
              onClick={() => open(t.id)}
              className={`rounded px-2 py-1 text-sm ${tab === t.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="pp-panel" aria-labelledby={`pp-tab-${tab}`}>
          {tab === 'parameters' && <TrackParametersPanel defaultOpen />}
          {tab === 'modes' && <ModeDefaults />}
          {tab === 'vehicles' && <VehicleProfilesPanel defaultOpen />}
          {tab === 'priority' && <PriorityPanel defaultOpen />}
          {tab === 'service_day' && <ServiceDay />}
        </div>
      </div>
    </dialog>
  );
}

/** Peak periods of the service day; each line's headways and service hours are in its inspector. */
function ServiceDay() {
  const scenario = useScenario();
  const commit = useStore((s) => s.commitScenario);
  const periods = scenario.peakPeriods;
  const save = (next: ServicePeriod[], label: string) => commit({ ...scenario, peakPeriods: next }, label);
  const patch = (i: number, p: Partial<ServicePeriod>) =>
    save(
      periods.map((x, k) => (k === i ? { ...x, ...p } : x)),
      'Peak period changed',
    );
  return (
    <div className="px-3 text-sm">
      <p className="mb-2 text-xs text-slate-600">
        Inside these periods every line runs its peak headway, outside them its off-peak headway, between its
        service start and end (line inspector → service). The default periods are placeholders: enter the
        local peak hours. The animation clock runs the service day.
      </p>
      <table className="mb-2 text-start">
        <caption className="sr-only">Peak periods</caption>
        <thead>
          <tr className="text-xs text-slate-600">
            <th scope="col" className="pe-2 text-start">
              Name
            </th>
            <th scope="col" className="pe-2 text-start">
              From
            </th>
            <th scope="col" className="pe-2 text-start">
              To
            </th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {periods.map((p, i) => (
            <tr key={p.id}>
              <td className="pe-2">
                <input
                  aria-label={`Name of peak period ${i + 1}`}
                  className="rounded border border-slate-400 px-1"
                  defaultValue={p.name}
                  onBlur={(e) => e.target.value !== p.name && patch(i, { name: e.target.value })}
                />
              </td>
              <td className="pe-2">
                <input
                  type="time"
                  aria-label={`Start of ${p.name}`}
                  className="rounded border border-slate-400 px-1"
                  value={p.start}
                  onChange={(e) => e.target.value && patch(i, { start: e.target.value })}
                />
              </td>
              <td className="pe-2">
                <input
                  type="time"
                  aria-label={`End of ${p.name}`}
                  className="rounded border border-slate-400 px-1"
                  value={p.end}
                  onChange={(e) => e.target.value && patch(i, { end: e.target.value })}
                />
              </td>
              <td>
                <Button
                  onClick={() =>
                    save(
                      periods.filter((_, k) => k !== i),
                      'Peak period removed',
                    )
                  }
                  aria-label={`Remove ${p.name}`}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        onClick={() =>
          save(
            [
              ...periods,
              { id: newId('peak'), name: `Peak ${periods.length + 1}`, start: '07:00', end: '09:00' },
            ],
            'Peak period added',
          )
        }
      >
        Add peak period
      </Button>
    </div>
  );
}

const ELECTRIFICATIONS: Electrification[] = ['unknown', 'overhead', 'third_rail', 'none'];

/** Defaults per mode; gauge and electrification of new track are editable. */
function ModeDefaults() {
  const scenario = useScenario();
  const commit = useStore((s) => s.commitScenario);
  const announce = useStore((s) => s.announce);
  const rows = modeDefaultRows(scenario);
  return (
    <div className="overflow-x-auto px-3">
      <table className="w-full text-start text-sm">
        <caption className="mb-1 text-start text-xs text-slate-600">
          Project settings per mode: the global values. Lines and tracks follow them unless they set their own
          value (the “Project setting” box in their inspector). Curve radii are cited; speeds, dwell times and
          catchments are placeholders unless noted. Platform length and following distance are set under
          Parameters.
        </caption>
        <thead>
          <tr className="border-b border-slate-300 text-xs text-slate-600">
            <th scope="col" className="py-1 pe-2 text-start">
              Mode
            </th>
            <th scope="col" className="pe-2 text-start">
              Curve radius min / recommended
            </th>
            <th scope="col" className="pe-2 text-start">
              Max speed
            </th>
            <th scope="col" className="pe-2 text-start">
              Dwell
            </th>
            <th scope="col" className="pe-2 text-start">
              Spares
            </th>
            <th scope="col" className="pe-2 text-start">
              Catchment
            </th>
            <th scope="col" className="pe-2 text-start">
              Structure, right of way
            </th>
            <th scope="col" className="pe-2 text-start">
              Platform
            </th>
            <th scope="col" className="pe-2 text-start">
              Following distance
            </th>
            <th scope="col" className="pe-2 text-start">
              Acceleration / braking
            </th>
            <th scope="col" className="pe-2 text-start">
              New track: gauge, electrification
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mode} className="border-b border-slate-100 align-top">
              <th scope="row" className="py-1 pe-2 text-start font-medium">
                {r.label}
              </th>
              <td className="pe-2">
                {r.curve ? (
                  <>
                    {r.curve.minimumM} m / {r.curve.recommendedM != null ? `${r.curve.recommendedM} m` : '—'}{' '}
                    <Badge>Cited</Badge>
                    <div className="text-xs text-slate-600">{r.curve.source}</div>
                  </>
                ) : (
                  <span className="text-slate-500">Not checked (street-routed)</span>
                )}
              </td>
              {(
                [
                  ['maxSpeedKmh', 'km/h', 1, 400],
                  ['dwellTimeS', 's', 0, 600],
                ] as const
              ).map(([key, unit, min, max]) => (
                <td className="pe-2" key={key}>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    className="w-16 rounded border border-slate-500 px-1"
                    aria-label={`${r.label}: ${key === 'maxSpeedKmh' ? 'maximum speed' : 'dwell time'}, ${unit}`}
                    key={`${r.mode}-${key}-${r[key]}`}
                    defaultValue={r[key]}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (e.target.value === '' || v === r[key] || !(v >= min && v <= max)) return;
                      commit(
                        setModeSetting(scenario, r.mode, { [key]: v }),
                        `${r.label}: ${key === 'maxSpeedKmh' ? 'maximum speed' : 'dwell time'} changed for lines that follow the project`,
                      );
                    }}
                  />{' '}
                  {unit}
                </td>
              ))}
              <td className="pe-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="w-14 rounded border border-slate-500 px-1"
                  aria-label={`${r.label}: spare vehicles, % of peak vehicles in service`}
                  key={`${r.mode}-spare-${r.spare.value}`}
                  defaultValue={Math.round(r.spare.value * 100)}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (e.target.value === '' || !(v >= 0 && v <= 100) || v / 100 === r.spare.value) return;
                    commit(
                      setModeSetting(scenario, r.mode, { spareRatio: v / 100 }),
                      `${r.label}: spare vehicles ${v}%`,
                    );
                  }}
                />{' '}
                %{' '}
                <Badge>
                  {r.spare.status === 'user_override'
                    ? 'Project value'
                    : r.spare.status === 'documented_default'
                      ? 'Documented'
                      : 'Placeholder'}
                </Badge>
                <div className="text-xs text-slate-600">
                  {r.spare.status === 'placeholder'
                    ? 'Bus fleet guideline (US FTA, 20 %) used until a source for this mode is set'
                    : r.spare.status === 'documented_default'
                      ? 'US FTA guideline for bus fleets (≤ 20 % of peak vehicles)'
                      : 'Own value for this project'}
                </div>
              </td>
              <td className="pe-2">{r.catchmentRadiusM} m</td>
              <td className="pe-2">
                {STRUCTURE_LABELS[r.structure as StructureType]},{' '}
                {RIGHT_OF_WAY_LABELS[r.rightOfWay as RightOfWay].toLowerCase()}
              </td>
              <td className="pe-2">{r.platformLengthM != null ? `${r.platformLengthM} m` : '—'}</td>
              <td className="pe-2">
                {r.following.kind === 'on_sight'
                  ? `${r.following.minGapM} m + speed × ${r.following.timeGapS} s`
                  : `${r.following.distanceM} m (signalled)`}
              </td>
              <td className="pe-2">
                {r.rates.accelMs2} / {r.rates.decelMs2} m/s² <Badge>Documented</Badge>
                <div className="text-xs text-slate-600">
                  SUMO class {r.rates.sumoClass}
                  {r.rates.note ? ` (${r.rates.note})` : ''}; a vehicle profile overrides it
                </div>
              </td>
              <td className="pe-2">
                {r.rail ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs">
                      Gauge (mm)
                      <input
                        type="number"
                        min={300}
                        max={3000}
                        className="ms-1 w-20 rounded border border-slate-500 px-1"
                        aria-label={`${r.label}: gauge of new track, mm`}
                        key={`${r.mode}-${r.gaugeMm ?? ''}`}
                        defaultValue={r.gaugeMm ?? ''}
                        placeholder="not set"
                        onBlur={(e) => {
                          const v = e.target.value === '' ? null : Math.round(Number(e.target.value));
                          if (v === r.gaugeMm || (v !== null && !(v >= 300 && v <= 3000))) return;
                          commit(
                            setModeTrackDefault(scenario, r.mode, { gaugeMm: v }),
                            `${r.label}: gauge default changed`,
                          );
                        }}
                      />
                    </label>
                    <label className="text-xs">
                      Electrification
                      <select
                        className="ms-1 rounded border border-slate-500"
                        aria-label={`${r.label}: electrification of new track`}
                        value={r.electrification}
                        onChange={(e) =>
                          commit(
                            setModeTrackDefault(scenario, r.mode, {
                              electrification: e.target.value as Electrification,
                            }),
                            `${r.label}: electrification default changed`,
                          )
                        }
                      >
                        {ELECTRIFICATIONS.map((x) => (
                          <option key={x} value={x}>
                            {ELECTRIFICATION_LABELS[x]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const res = applyModeDefaultsToTracks(scenario, r.mode);
                        if (res.changed)
                          commit(res.scenario, `${r.label}: defaults applied to ${res.changed} track(s)`);
                        else announce(`${r.label}: no track without a value`);
                      }}
                    >
                      Apply to existing track without a value
                    </Button>
                  </div>
                ) : r.mode === 'trolleybus' ? (
                  <span className="text-xs text-slate-600">Overhead wire along every line</span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
