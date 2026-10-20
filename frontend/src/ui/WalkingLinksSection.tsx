/** Walking links of a station (domain/walkingLinks.ts): changing to another mode on foot. */
import type { Scenario, Station } from '../domain/schema';
import { MODES } from '../domain/modes';
import { stationMode } from '../domain/modeSeparation';
import {
  addWalkingLink,
  deleteWalkingLink,
  linkCandidates,
  linkDistanceM,
  linksOfStation,
  linkWalkMin,
  otherStation,
  updateWalkingLink,
} from '../domain/walkingLinks';
import { parameterValue } from '../domain/trackParameters';
import { useStore } from '../store/projectStore';
import { CommitField } from './CommitField';
import { Button, Section, SelectField } from './primitives';

export function WalkingLinksSection({ station, scenario }: { station: Station; scenario: Scenario }) {
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const links = linksOfStation(scenario, station.id);
  const linked = new Set(links.flatMap((l) => l.stationIds));
  const candidates = linkCandidates(scenario, station).filter((s) => !linked.has(s.id));
  const speed = parameterValue(scenario.trackNetwork, 'walkingSpeedKmh');
  const label = (s: Station) => {
    const m = stationMode(scenario, s);
    return `${s.name}${m ? ` (${MODES[m].label})` : ''}`;
  };
  return (
    <Section title={`Walking links (${links.length})`} id="station-walking-links">
      <p className="mb-1 text-xs text-slate-600">
        Passengers change to other modes on foot: every mode has its own stations. Times are calculated from
        the straight-line distance at {speed} km/h (placeholder) unless you enter one.
      </p>
      <ul className="space-y-1">
        {links.map((l) => {
          const other = otherStation(scenario, l, station.id);
          const d = linkDistanceM(scenario, l);
          const w = linkWalkMin(scenario, l);
          return (
            <li key={l.id} className="rounded border border-slate-200 p-1 text-sm">
              <button
                type="button"
                className="underline"
                onClick={() => other && select({ kind: 'station', id: other.id })}
              >
                {other ? label(other) : 'Missing station'}
              </button>
              <span className="text-xs text-slate-600">
                {' '}
                · {d !== null ? `${Math.round(d)} m straight line` : ''}
                {w.minutes !== null
                  ? ` · ${w.minutes.toFixed(1)} min${w.calculated ? ' (calculated)' : ''}`
                  : ''}
              </span>
              <CommitField
                label="Walking time"
                unit="min, empty = calculated"
                type="number"
                min={0}
                max={120}
                value={l.walkTimeMin}
                onCommit={(v) =>
                  commit(
                    updateWalkingLink(scenario, l.id, { walkTimeMin: v === '' ? null : Number(v) }),
                    'Walking time changed',
                  )
                }
              />
              <Button
                variant="danger"
                onClick={() => commit(deleteWalkingLink(scenario, l.id), 'Walking link removed')}
              >
                Remove link
              </Button>
            </li>
          );
        })}
      </ul>
      <SelectField
        label="Link to a station within 2 km"
        value=""
        onChange={(e) => {
          if (!e.target.value) return;
          const r = addWalkingLink(scenario, station.id, e.target.value);
          if (!r.error)
            commit(
              r.scenario,
              `Walking link to "${otherStation(r.scenario, r.link!, station.id)?.name}" added`,
            );
        }}
        options={[
          { value: '', label: candidates.length ? 'Choose a station…' : 'No other station within 2 km' },
          ...candidates.map((s) => ({ value: s.id, label: label(s) })),
        ]}
      />
    </Section>
  );
}
