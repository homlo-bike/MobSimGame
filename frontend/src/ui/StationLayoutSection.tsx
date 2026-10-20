/** Layout of a rail station object: platforms, length, bearing (keyboard path for move and rotate). */
import type { Scenario, Station } from '../domain/schema';
import { MODES } from '../domain/modes';
import {
  layoutError,
  MAX_PLATFORMS,
  updateStationLayout,
  type StationLayoutPatch,
} from '../domain/stationLayout';
import { platformLengthM } from '../domain/trackParameters';
import { useStore } from '../store/projectStore';
import { CommitField } from './CommitField';
import { Section } from './primitives';

export function StationLayoutSection({ station, scenario }: { station: Station; scenario: Scenario }) {
  const commit = useStore((s) => s.commitScenario);
  const layout = station.layout;
  if (!layout) return null;
  const apply = (p: StationLayoutPatch, label: string): string | void => {
    const res = updateStationLayout(scenario, station.id, p);
    if (res.error) return res.error;
    commit(res.scenario, label);
  };
  const count = (key: 'sidePlatforms' | 'islandPlatforms', label: string) => (
    <CommitField
      label={label}
      type="number"
      min={0}
      max={MAX_PLATFORMS}
      value={layout[key]}
      onCommit={(v) => {
        const n = Number(v);
        if (!Number.isInteger(n)) return 'Whole numbers only';
        const other = key === 'sidePlatforms' ? layout.islandPlatforms : layout.sidePlatforms;
        const err = layoutError(key === 'sidePlatforms' ? n : other, key === 'sidePlatforms' ? other : n);
        if (err) return err;
        return apply({ [key]: n }, `${label} at "${station.name}": ${n}`);
      }}
    />
  );
  const defaultLength = platformLengthM(scenario.trackNetwork, layout.mode);
  return (
    <Section title="Station layout" id="station-layout">
      <p className="mb-1 text-xs text-slate-600">
        {MODES[layout.mode].label} station with {layout.trackIds.length} track(s). Each side platform has one
        track, each island a track on either side. Connect track to the station ends; moving or rotating the
        station keeps those connections.
      </p>
      <div className="grid grid-cols-2 gap-x-2">
        {count('sidePlatforms', 'Side platforms')}
        {count('islandPlatforms', 'Island platforms')}
        <CommitField
          label="Platform length"
          unit={`m, empty = project default ${defaultLength} m`}
          type="number"
          min={5}
          max={1000}
          value={layout.platformLengthM}
          onCommit={(v) =>
            apply(
              { platformLengthM: v === '' ? null : Number(v) },
              `Platform length at "${station.name}": ${v === '' ? `default (${defaultLength} m)` : `${v} m`}`,
            )
          }
        />
        <CommitField
          label="Direction"
          unit="° from north"
          type="number"
          min={0}
          max={360}
          value={Math.round(layout.bearingDeg * 10) / 10}
          onCommit={(v) => apply({ bearingDeg: Number(v) }, `"${station.name}" rotated to ${v}°`)}
        />
      </div>
    </Section>
  );
}
