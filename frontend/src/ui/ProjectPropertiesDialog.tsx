/**
 * Project properties: every default the project uses, with its source and status, in one
 * place (parameters, per-mode defaults, vehicles, crossing priority).
 */
import { useEffect, useRef } from 'react';
import type { Electrification } from '../domain/schema';
import { useScenario, useStore, type PropertiesTab } from '../store/projectStore';
import { applyModeDefaultsToTracks, modeDefaultRows, setModeTrackDefault } from '../domain/projectProperties';
import { ELECTRIFICATION_LABELS } from '../domain/compatibility';
import { RIGHT_OF_WAY_LABELS, STRUCTURE_LABELS } from '../domain/modes';
import type { RightOfWay, StructureType } from '../domain/schema';
import { TrackParametersPanel } from './TrackInspector';
import { PriorityPanel } from './PriorityPanel';
import { VehicleProfilesPanel } from './VehicleProfiles';
import { Badge, Button } from './primitives';

const TABS: { id: PropertiesTab; label: string }[] = [
  { id: 'parameters', label: 'Parameters' },
  { id: 'modes', label: 'Modes' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'priority', label: 'Crossing priority' },
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
            Project properties
          </h2>
          <Button onClick={() => open(null)} aria-label="Close project properties">
            Close
          </Button>
        </div>
        <p className="mb-2 text-xs text-slate-600">
          Every default this project uses, with where it comes from. Values marked placeholder are not from a
          source: enter local values. Changes apply to this scenario.
        </p>
        <div role="tablist" aria-label="Project properties" className="mb-2 flex flex-wrap gap-1">
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
        </div>
      </div>
    </dialog>
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
          Editor defaults per mode. Curve radii are cited; speeds, dwell times and catchments are placeholders
          unless noted, and each line can override them. Platform length and following distance are set under
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
              <td className="pe-2">{r.maxSpeedKmh} km/h</td>
              <td className="pe-2">{r.dwellTimeS} s</td>
              <td className="pe-2">{r.catchmentRadiusM} m</td>
              <td className="pe-2">
                {STRUCTURE_LABELS[r.structure as StructureType]},{' '}
                {RIGHT_OF_WAY_LABELS[r.rightOfWay as RightOfWay].toLowerCase()}
              </td>
              <td className="pe-2">{r.platformLengthM != null ? `${r.platformLengthM} m` : '—'}</td>
              <td className="pe-2">{r.separationM} m</td>
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
