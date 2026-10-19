import { useState } from 'react';
import { bbox, lineString } from '@turf/turf';
import type {
  EndType,
  LineTermination,
  RightOfWay,
  Scenario,
  StructureType,
  TrackCount,
  TransportLine,
  TransportMode,
} from '../domain/schema';
import { MODES, MODE_LIST, RIGHT_OF_WAY_LABELS, STRUCTURE_LABELS } from '../domain/modes';
import {
  addExistingStationToLine,
  addStationAtChainage,
  deleteLine,
  detectSharedTracks,
  isRing,
  joinLines,
  lineLengthM,
  orderedStops,
  removeStopFromLine,
  splitLine,
  updateLine,
} from '../domain/network';
import { mergeWithNext, splitSegmentsAt, updateSegment } from '../geo/segments';
import { pathCoordinates } from '../geo/geometry';
import { formatDistance } from '../analysis/units';
import { useStore } from '../store/projectStore';
import { getMapInstance } from '../map/mapInstance';
import { Badge, Button, SelectField, Section } from './primitives';
import { CommitField } from './CommitField';
import { FindingsList } from './FindingsList';
import { validateLine } from '../validation/validate';

const END_LABELS: Record<EndType, string> = {
  terminal_station: 'Terminal station',
  reversing_siding: 'Reversing siding',
  turnback: 'Turnback',
  depot: 'Depot',
};

export function LineInspector({ line, scenario }: { line: TransportLine; scenario: Scenario }) {
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const announce = useStore((s) => s.announce);
  const unitSystem = useStore((s) => s.unitSystem);
  const [joinTarget, setJoinTarget] = useState('');
  const total = lineLengthM(line);
  const stops = orderedStops(line, scenario.stations);
  const patch = (p: Partial<TransportLine>, label = 'Line updated') =>
    commit(updateLine(scenario, line.id, p), label);
  const pattern = line.servicePatterns[0]!;
  const patchPattern = (p: Partial<typeof pattern>) =>
    patch({ servicePatterns: [{ ...pattern, ...p }, ...line.servicePatterns.slice(1)] }, 'Service updated');
  const vehicle = scenario.vehicleTypes.find((v) => v.id === line.vehicleTypeId);
  const notServed = scenario.stations.filter((s) => !line.stops.some((x) => x.stationId === s.id));
  const findings = validateLine(line, scenario);

  const zoomTo = () => {
    const map = getMapInstance();
    const coords = pathCoordinates(line.coordinates, isRing(line));
    if (!map || coords.length < 2) return;
    const b = bbox(lineString(coords));
    map.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]],
      ],
      { padding: 60, maxZoom: 16 },
    );
  };

  const setTermination = (kind: LineTermination['kind']) => {
    if (kind === 'ends')
      patch({ termination: { kind: 'ends', start: 'terminal_station', end: 'terminal_station' } });
    else if (kind === 'ring') patch({ termination: { kind: 'ring' } });
    else patch({ termination: { kind: 'loop', note: '' } });
  };

  return (
    <div>
      <Section title="Line" id="line-inspector">
        <div className="mb-2 flex flex-wrap gap-1">
          <Button onClick={zoomTo}>Zoom to line</Button>
          <Button
            variant="danger"
            onClick={() => {
              commit(deleteLine(scenario, line.id), `Line "${line.name}" deleted`);
              select(null);
            }}
          >
            Delete line
          </Button>
        </div>
        <CommitField
          label="Name"
          value={line.name}
          onCommit={(v) => (v.trim() ? patch({ name: v.trim() }) : 'Name is required')}
        />
        <CommitField
          label="Short name (≤ 8 characters)"
          value={line.shortName}
          onCommit={(v) => (v.length <= 8 ? patch({ shortName: v }) : 'At most 8 characters')}
        />
        <div className="mb-2">
          <label htmlFor="line-color" className="block text-xs font-medium text-slate-800">
            Colour
          </label>
          <input
            id="line-color"
            type="color"
            value={line.color}
            onChange={(e) => patch({ color: e.target.value }, 'Colour changed')}
            className="h-8 w-16 rounded border border-slate-500"
          />
        </div>
        <SelectField
          label="Transport mode"
          value={line.mode}
          onChange={(e) => patch({ mode: e.target.value as TransportMode }, 'Mode changed')}
          options={MODE_LIST.map((m) => ({ value: m, label: MODES[m].label }))}
        />
        {line.mode === 'custom' && (
          <CommitField
            label="Custom mode label"
            value={line.customModeLabel}
            onCommit={(v) => patch({ customModeLabel: v })}
          />
        )}
        <fieldset className="mb-2">
          <legend className="text-xs font-medium text-slate-800">Direction</legend>
          {(['bidirectional', 'one_way'] as const).map((d) => (
            <label key={d} className="me-3 inline-flex items-center gap-1 text-sm">
              <input
                type="radio"
                name={`dir-${line.id}`}
                checked={line.direction === d}
                onChange={() => patch({ direction: d }, 'Direction changed')}
              />
              {d === 'one_way' ? 'One-way (drawn direction)' : 'Bidirectional'}
            </label>
          ))}
        </fieldset>
        <SelectField
          label="Running side"
          value={line.runningSide}
          onChange={(e) => patch({ runningSide: e.target.value as 'left' | 'right' })}
          options={[
            { value: 'right', label: 'Right-hand running' },
            { value: 'left', label: 'Left-hand running' },
          ]}
        />
        <SelectField
          label="Line ends"
          value={line.termination.kind}
          onChange={(e) => setTermination(e.target.value as LineTermination['kind'])}
          options={[
            { value: 'ends', label: 'Two ends (terminal, siding, turnback or depot)' },
            { value: 'ring', label: 'Circular / ring line' },
            { value: 'loop', label: 'User-defined turning loop' },
          ]}
          hint="A line is complete only when it ends at terminal stations or closes as a loop or ring."
        />
        {line.termination.kind === 'ends' && (
          <div className="grid grid-cols-2 gap-2">
            {(['start', 'end'] as const).map((k) => (
              <SelectField
                key={k}
                label={k === 'start' ? 'Start configuration' : 'End configuration'}
                value={line.termination.kind === 'ends' ? line.termination[k] : 'terminal_station'}
                onChange={(e) =>
                  line.termination.kind === 'ends' &&
                  patch({ termination: { ...line.termination, [k]: e.target.value as EndType } })
                }
                options={Object.entries(END_LABELS).map(([value, label]) => ({ value, label }))}
              />
            ))}
          </div>
        )}
        <p className="text-sm text-slate-800">
          Length: <strong>{formatDistance(total, unitSystem)}</strong> · Stations:{' '}
          <strong>{stops.length}</strong>
        </p>
      </Section>

      <Section title="Service (illustrative)" id="line-service">
        <div className="grid grid-cols-2 gap-2">
          <CommitField
            label="Peak headway"
            unit="min"
            type="number"
            min={0.5}
            max={240}
            step="any"
            value={pattern.peakHeadwayMin}
            onCommit={(v) => patchPattern({ peakHeadwayMin: Number(v) })}
          />
          <CommitField
            label="Off-peak headway"
            unit="min"
            type="number"
            min={0.5}
            max={240}
            step="any"
            value={pattern.offPeakHeadwayMin}
            onCommit={(v) => patchPattern({ offPeakHeadwayMin: Number(v) })}
          />
          <CommitField
            label="Service start"
            type="time"
            value={pattern.serviceStart}
            onCommit={(v) => (/^\d{2}:\d{2}$/.test(v) ? patchPattern({ serviceStart: v }) : 'Use HH:MM')}
          />
          <CommitField
            label="Service end"
            type="time"
            value={pattern.serviceEnd}
            onCommit={(v) => (/^\d{2}:\d{2}$/.test(v) ? patchPattern({ serviceEnd: v }) : 'Use HH:MM')}
          />
          <CommitField
            label="Dwell time per stop"
            unit="s"
            type="number"
            min={0}
            max={600}
            value={line.dwellTimeS}
            onCommit={(v) => patch({ dwellTimeS: Number(v) })}
          />
          <CommitField
            label="Maximum speed"
            unit="km/h"
            type="number"
            min={1}
            max={400}
            value={line.maxSpeedKmh}
            onCommit={(v) => patch({ maxSpeedKmh: Number(v) })}
          />
        </div>
        <SelectField
          label="Vehicle type"
          value={line.vehicleTypeId ?? ''}
          onChange={(e) => patch({ vehicleTypeId: e.target.value || null })}
          options={[
            { value: '', label: 'None selected' },
            ...scenario.vehicleTypes.map((v) => ({ value: v.id, label: `${v.name} · ${v.capacity} pax` })),
          ]}
          hint={vehicle ? `${vehicle.source}` : 'Capacity results need a vehicle type.'}
        />
      </Section>

      <Section title={`Segments (${line.segments.length})`} id="line-segments">
        <p className="mb-1 text-xs text-slate-600">
          Each segment sets the structure, right of way and track count for part of the line. Map pattern:
          solid = surface, dashed = underground/tunnel, dotted = elevated, long dash = bridge.
        </p>
        <ol className="space-y-2">
          {line.segments.map((seg, i) => (
            <li key={seg.id} className="rounded border border-slate-300 p-2">
              <p className="text-xs font-semibold text-slate-800">
                Segment {i + 1}: {formatDistance(seg.fromFraction * total, unitSystem)} –{' '}
                {formatDistance(seg.toFraction * total, unitSystem)}
              </p>
              <div className="grid grid-cols-3 gap-1">
                <SelectField
                  label="Structure"
                  value={seg.structure}
                  onChange={(e) =>
                    patch(
                      {
                        segments: updateSegment(line.segments, seg.id, {
                          structure: e.target.value as StructureType,
                        }),
                      },
                      'Segment structure changed',
                    )
                  }
                  options={Object.entries(STRUCTURE_LABELS).map(([value, label]) => ({ value, label }))}
                />
                <SelectField
                  label="Right of way"
                  value={seg.rightOfWay}
                  onChange={(e) =>
                    patch({
                      segments: updateSegment(line.segments, seg.id, {
                        rightOfWay: e.target.value as RightOfWay,
                      }),
                    })
                  }
                  options={Object.entries(RIGHT_OF_WAY_LABELS).map(([value, label]) => ({ value, label }))}
                />
                <SelectField
                  label="Tracks / lanes"
                  value={seg.tracks}
                  onChange={(e) =>
                    patch({
                      segments: updateSegment(line.segments, seg.id, {
                        tracks: e.target.value as TrackCount,
                      }),
                    })
                  }
                  options={[
                    { value: 'double', label: 'Double' },
                    { value: 'single', label: 'Single' },
                  ]}
                />
              </div>
              <CommitField
                label="Speed limit"
                unit="km/h, empty = line maximum"
                type="number"
                min={1}
                max={400}
                value={seg.speedLimitKmh}
                onCommit={(v) =>
                  patch({
                    segments: updateSegment(line.segments, seg.id, {
                      speedLimitKmh: v === '' ? null : Number(v),
                    }),
                  })
                }
              />
              <CommitField
                label="Notes (portal, ramp, transition)"
                value={seg.notes}
                onCommit={(v) => patch({ segments: updateSegment(line.segments, seg.id, { notes: v }) })}
              />
              <div className="flex flex-wrap gap-1">
                <Button
                  onClick={() =>
                    patch(
                      { segments: splitSegmentsAt(line.segments, (seg.fromFraction + seg.toFraction) / 2) },
                      'Segment split',
                    )
                  }
                >
                  Split in half
                </Button>
                {i < line.segments.length - 1 && (
                  <Button
                    onClick={() =>
                      patch({ segments: mergeWithNext(line.segments, seg.id) }, 'Segments merged')
                    }
                  >
                    Merge with next
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
        <CommitField
          label="Split a segment at chainage"
          unit="m from line start"
          type="number"
          min={0}
          max={Math.floor(total)}
          value={null}
          onCommit={(v) => {
            const f = Number(v) / total;
            if (!(f > 0 && f < 1)) return 'Chainage must be inside the line';
            patch({ segments: splitSegmentsAt(line.segments, f) }, 'Segment split');
          }}
        />
      </Section>

      <Section title={`Stations on this line (${stops.length})`} id="line-stops">
        <ol className="mb-2 space-y-0.5 text-sm">
          {stops.map((s, i) => (
            <li key={s.station.id} className="flex items-center gap-1">
              <button
                type="button"
                className="flex-1 text-start underline"
                onClick={() => select({ kind: 'station', id: s.station.id })}
              >
                {i + 1}. {s.station.name}
              </button>
              <span className="text-xs text-slate-600">{formatDistance(s.chainageM, unitSystem)}</span>
              <Button
                variant="ghost"
                aria-label={`Remove ${s.station.name} from ${line.name}`}
                onClick={() => commit(removeStopFromLine(scenario, line.id, s.station.id), 'Stop removed')}
              >
                ✕
              </Button>
            </li>
          ))}
        </ol>
        <CommitField
          label="Add a station at chainage"
          unit="m from line start"
          type="number"
          min={0}
          max={Math.floor(total)}
          value={null}
          onCommit={(v) => {
            const res = addStationAtChainage(scenario, line.id, Number(v));
            if (res.error) return res.error;
            commit(res.scenario, res.reused ? 'Existing station shared' : 'Station added');
          }}
        />
        {notServed.length > 0 && (
          <SelectField
            label="Add an existing station (shared / interchange)"
            value=""
            onChange={(e) =>
              e.target.value &&
              commit(addExistingStationToLine(scenario, line.id, e.target.value), 'Station shared with line')
            }
            options={[
              { value: '', label: 'Choose a station…' },
              ...notServed.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        )}
      </Section>

      <Section title="Edit operations" id="line-ops">
        {!isRing(line) && (
          <CommitField
            label="Split line at chainage"
            unit="m"
            type="number"
            min={1}
            max={Math.floor(total) - 1}
            value={null}
            onCommit={(v) => {
              const f = Number(v) / total;
              if (!(f > 0.01 && f < 0.99)) return 'Choose a point inside the line';
              commit(splitLine(scenario, line.id, f), 'Line split into two');
            }}
          />
        )}
        {scenario.lines.length > 1 && !isRing(line) && (
          <div className="flex items-end gap-1">
            <div className="flex-1">
              <SelectField
                label="Join with line"
                value={joinTarget}
                onChange={(e) => setJoinTarget(e.target.value)}
                options={[
                  { value: '', label: 'Choose…' },
                  ...scenario.lines
                    .filter((l) => l.id !== line.id && !isRing(l))
                    .map((l) => ({ value: l.id, label: l.name })),
                ]}
              />
            </div>
            <Button
              className="mb-2"
              disabled={!joinTarget}
              onClick={() => {
                const res = joinLines(scenario, line.id, joinTarget);
                if (res.error) announce(res.error);
                else commit(res.scenario, 'Lines joined');
                setJoinTarget('');
              }}
            >
              Join
            </Button>
          </div>
        )}
        <Button
          onClick={() => {
            const shared = detectSharedTracks(scenario);
            commit(
              { ...scenario, sharedTracks: shared },
              `${shared.length} shared track section(s) recorded`,
            );
          }}
        >
          Detect shared track
        </Button>
        {scenario.sharedTracks.some((st) => st.members.some((m) => m.lineId === line.id)) && (
          <p className="mt-1 text-sm">
            <Badge>Shared track</Badge> This line shares track with{' '}
            {scenario.sharedTracks
              .filter((st) => st.members.some((m) => m.lineId === line.id))
              .flatMap((st) =>
                st.members
                  .filter((m) => m.lineId !== line.id)
                  .map((m) => scenario.lines.find((l) => l.id === m.lineId)?.name),
              )
              .join(', ')}
            .
          </p>
        )}
      </Section>
      <Section title="Validation" id="line-findings">
        <FindingsList findings={findings} />
      </Section>
    </div>
  );
}
