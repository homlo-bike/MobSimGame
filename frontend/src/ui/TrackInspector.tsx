/**
 * Inspectors for physical track and track nodes, the deletion choice dialog and
 * the track parameter table. All edits are domain operations committed through
 * the store (undo/redo); every value is also editable without the map.
 */
import { useEffect, useRef } from 'react';
import { bbox, lineString } from '@turf/turf';
import type {
  PhysicalTrack,
  RightOfWay,
  Scenario,
  StructureType,
  TrackDirection,
  TrackNode,
  TransportMode,
} from '../domain/schema';
import { MODES, RIGHT_OF_WAY_LABELS, STRUCTURE_LABELS } from '../domain/modes';
import {
  angleBetween,
  groupMembers,
  levelOfStructure,
  nodeEnds,
  outwardHeading,
  RAIL_MODES,
  setMovement,
  setTrackRadius,
  splitTrack,
  trackGeometry,
  trackUsage,
  updateNode,
  updateTrack,
  movementHas,
} from '../domain/tracks';
import { afterTrackEdit } from '../domain/serviceRouting';
import { parameter, TRACK_PARAMETERS, type TrackParameterId } from '../domain/trackParameters';
import { CURVE_RADIUS_RULES } from '../domain/modeProfiles';
import { formatDistance } from '../analysis/units';
import { useStore } from '../store/projectStore';
import { requestTrackDeletion, resolveTrackDeletion } from '../store/trackActions';
import { getMapInstance } from '../map/mapInstance';
import { validateTrackNetwork } from '../validation/trackValidation';
import { CommitField } from './CommitField';
import { FindingsList } from './FindingsList';
import { MetadataEditor } from './MetadataEditor';
import { Badge, Button, SelectField, Section } from './primitives';

const DIRECTION_LABELS: Record<TrackDirection, string> = {
  both: 'Both directions (single track)',
  forward: 'Drawing direction only',
  backward: 'Against the drawing direction only',
};

function trackLabel(t: PhysicalTrack, i?: number) {
  return t.name || `Track ${i !== undefined ? i + 1 : t.id.slice(-4)}`;
}

export function TrackInspector({ track, scenario }: { track: PhysicalTrack; scenario: Scenario }) {
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const unitSystem = useStore((s) => s.unitSystem);
  const net = scenario.trackNetwork;
  const g = trackGeometry(net, track);
  const usage = trackUsage(scenario, track.id);
  const partner = groupMembers(net, track.groupId).filter((t) => t.id !== track.id);
  const group = net.groups.find((x) => x.id === track.groupId);
  const findings = validateTrackNetwork(scenario).filter((f) => f.trackId === track.id);
  const rule = CURVE_RADIUS_RULES[track.designMode];
  const patch = (p: Partial<PhysicalTrack>, label = 'Track updated') =>
    commit(afterTrackEdit(updateTrack(scenario, track.id, p), [track.id]), label);
  const existing = track.origin.source === 'osm' && !track.origin.edited;

  const zoomTo = () => {
    const map = getMapInstance();
    if (!map || g.coordinates.length < 2) return;
    const b = bbox(lineString(g.coordinates));
    map.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]],
      ],
      { padding: 60, maxZoom: 17 },
    );
  };

  return (
    <div>
      <Section title="Track" id="track-inspector">
        <div className="mb-2 flex flex-wrap gap-1">
          <Button onClick={zoomTo}>Zoom to track</Button>
          <Button variant="danger" onClick={() => requestTrackDeletion([track.id])}>
            Delete track
          </Button>
        </div>
        {existing && (
          <p className="mb-2 text-xs text-slate-700">
            <Badge>Existing (OpenStreetMap)</Badge> Findings are informational until you edit this track.
          </p>
        )}
        <CommitField label="Name" value={track.name} onCommit={(v) => patch({ name: v.trim() })} />
        <p className="mb-2 text-sm text-slate-800">
          Length <strong>{formatDistance(g.lengthM, unitSystem)}</strong> ·{' '}
          {g.primitives.filter((p) => p.kind === 'arc').length} curve(s) ·{' '}
          {usage.lineIds.length ? `used by ${usage.lineIds.length} service(s)` : 'no services'}
        </p>
        {group && (
          <p className="mb-2 text-sm">
            <Badge>Double track</Badge> {group.spacingM} m between track centres; other track:{' '}
            {partner.map((p) => (
              <button
                key={p.id}
                type="button"
                className="underline"
                onClick={() => select({ kind: 'track', id: p.id })}
              >
                {trackLabel(p)}
              </button>
            ))}
          </p>
        )}
        <SelectField
          label="Running direction"
          value={track.direction}
          onChange={(e) =>
            patch({ direction: e.target.value as TrackDirection }, 'Running direction changed')
          }
          options={Object.entries(DIRECTION_LABELS).map(([value, label]) => ({ value, label }))}
          hint={
            track.direction === 'both'
              ? 'Trains of both directions share this track: one direction waits while the other uses it.'
              : 'Arrows on the map show the permitted direction.'
          }
        />
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Structure"
            value={track.structure}
            onChange={(e) => {
              const structure = e.target.value as StructureType;
              patch({ structure, level: levelOfStructure(structure) }, 'Track structure changed');
            }}
            options={Object.entries(STRUCTURE_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <CommitField
            label="Level"
            unit="0 = ground"
            type="number"
            min={-9}
            max={9}
            step={1}
            value={track.level}
            onCommit={(v) =>
              Number.isInteger(Number(v)) ? patch({ level: Number(v) }) : 'Whole numbers only'
            }
          />
          <SelectField
            label="Right of way"
            value={track.rightOfWay}
            onChange={(e) => patch({ rightOfWay: e.target.value as RightOfWay })}
            options={Object.entries(RIGHT_OF_WAY_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <SelectField
            label="Design rules"
            value={track.designMode}
            onChange={(e) => patch({ designMode: e.target.value as TransportMode })}
            options={RAIL_MODES.map((m) => ({ value: m, label: MODES[m].label }))}
          />
          <CommitField
            label="Speed limit"
            unit="km/h, empty = none"
            type="number"
            min={1}
            max={400}
            value={track.speedLimitKmh}
            onCommit={(v) => patch({ speedLimitKmh: v === '' ? null : Number(v) })}
          />
        </div>
        <p className="text-xs text-slate-600">
          Tracks on different levels never connect where they cross (bridges, tunnels).
        </p>
      </Section>

      <Section title={`Curves (${track.points.length})`} id="track-curves">
        <p className="mb-1 text-xs text-slate-600">
          Each point of the track can carry a circular curve; straight track runs between the curves and meets
          them tangentially. Empty = a sharp corner (no curve).
          {rule &&
            ` ${MODES[track.designMode].label}: minimum ${rule.minimumM} m${rule.recommendedM ? `, recommended ${rule.recommendedM} m` : ''} (documented default).`}
        </p>
        {track.points.length === 0 && <p className="text-sm text-slate-700">Straight track.</p>}
        <ol className="space-y-1">
          {track.radii.map((r, i) => {
            const used = g.built.usedRadii[i + 1];
            return (
              <li key={i}>
                <CommitField
                  label={`Point ${i + 1} radius`}
                  unit="m"
                  type="number"
                  min={1}
                  max={100000}
                  value={r}
                  hint={
                    used !== null && used !== undefined && r !== null && Math.abs(used - r) > 0.5
                      ? `Does not fit: ${Math.round(used)} m is used. Move the points apart.`
                      : undefined
                  }
                  onCommit={(v) =>
                    commit(
                      afterTrackEdit(setTrackRadius(scenario, track.id, i, v === '' ? null : Number(v)), [
                        track.id,
                      ]),
                      v === '' ? `Curve at point ${i + 1} removed` : `Radius at point ${i + 1} set to ${v} m`,
                    )
                  }
                />
              </li>
            );
          })}
        </ol>
      </Section>

      <Section title="Edit" id="track-edit">
        <CommitField
          label="Split the track at"
          unit="m from its start"
          type="number"
          min={1}
          max={Math.max(1, Math.floor(g.lengthM) - 1)}
          value={null}
          onCommit={(v) => {
            const f = Number(v) / g.lengthM;
            if (!(f > 0 && f < 1)) return 'Choose a point inside the track';
            const res = splitTrack(scenario, track.id, f);
            if (!res.nodeId) return 'The track could not be split there';
            commit(res.scenario, 'Track split; a connection node was added');
            select({ kind: 'node', id: res.nodeId });
          }}
        />
        <p className="text-xs text-slate-600">
          To move a track end, drag it on the map: every track connected to that end follows. Services on the
          track are rerouted after each edit.
        </p>
      </Section>

      {usage.lineIds.length > 0 && (
        <Section title="Services on this track" id="track-services">
          <ul className="text-sm">
            {usage.lineIds.map((id) => {
              const l = scenario.lines.find((x) => x.id === id)!;
              return (
                <li key={id}>
                  <button type="button" className="underline" onClick={() => select({ kind: 'line', id })}>
                    {l.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="Details" id="track-metadata">
        <MetadataEditor
          value={track.metadata}
          onChange={(metadata) => patch({ metadata }, 'Track details changed')}
          idPrefix={`track-${track.id}`}
        />
        <CommitField label="Notes" value={track.notes} onCommit={(v) => patch({ notes: v })} />
      </Section>
      <Section title="Validation" id="track-findings">
        <FindingsList findings={findings} />
      </Section>
    </div>
  );
}

export function NodeInspector({ node, scenario }: { node: TrackNode; scenario: Scenario }) {
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const net = scenario.trackNetwork;
  const ends = nodeEnds(net, node.id);
  const byId = new Map(net.tracks.map((t, i) => [t.id, { t, i }]));
  const label = (trackId: string, end: string) => {
    const e = byId.get(trackId);
    return e ? `${trackLabel(e.t, e.i)} (${end})` : trackId;
  };
  const findings = validateTrackNetwork(scenario).filter((f) => f.nodeId === node.id);
  const pairs = ends.flatMap((a, i) => ends.slice(i + 1).map((b) => [a, b] as const));
  return (
    <div>
      <Section title="Track node" id="node-inspector">
        <p className="mb-2 text-sm">
          {ends.length} track end(s) meet here.{' '}
          {ends.length >= 3 && 'The turnout or crossing type is not specified yet (next phase).'}
        </p>
        <ul className="mb-2 text-sm">
          {ends.map((e) => (
            <li key={`${e.trackId}-${e.end}`}>
              <button
                type="button"
                className="underline"
                onClick={() => select({ kind: 'track', id: e.trackId })}
              >
                {label(e.trackId, e.end)}
              </button>
            </li>
          ))}
        </ul>
        <SelectField
          label="Node type"
          value={node.kind}
          onChange={(e) =>
            commit(
              updateNode(scenario, node.id, { kind: e.target.value as TrackNode['kind'] }),
              'Node type changed',
            )
          }
          options={[
            { value: 'connection', label: 'Connection' },
            { value: 'buffer_stop', label: 'Buffer stop (end of track)' },
          ]}
        />
      </Section>
      {pairs.length > 0 && (
        <Section title="Permitted movements" id="node-movements">
          <p className="mb-1 text-xs text-slate-600">
            {node.movementMode === 'auto'
              ? 'Automatic: trains may pass where they do not have to reverse. Changing a box switches to manual.'
              : 'Manual: only the ticked movements are permitted.'}
          </p>
          <ul className="space-y-1">
            {pairs.map(([a, b]) => {
              const on = node.movements.some((m) => movementHas(m, a, b));
              const ha = outwardHeading(net, a);
              const hb = outwardHeading(net, b);
              const angle =
                ha !== null && hb !== null ? Math.round((angleBetween(ha, hb) * 180) / Math.PI) : null;
              const id = `mv-${node.id}-${a.trackId}-${a.end}-${b.trackId}-${b.end}`;
              return (
                <li key={id} className="flex items-start gap-2 text-sm">
                  <input
                    id={id}
                    type="checkbox"
                    checked={on}
                    className="mt-1"
                    onChange={(e) =>
                      commit(
                        afterTrackEdit(setMovement(scenario, node.id, a, b, e.target.checked), [
                          a.trackId,
                          b.trackId,
                        ]),
                        e.target.checked ? 'Movement permitted' : 'Movement forbidden',
                      )
                    }
                  />
                  <label htmlFor={id}>
                    {label(a.trackId, a.end)} ↔ {label(b.trackId, b.end)}
                    {angle !== null && (
                      <span className="block text-xs text-slate-600">
                        {angle}° between the tracks (180° = straight)
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          {node.movementMode === 'manual' && (
            <Button
              className="mt-1"
              onClick={() =>
                commit(
                  afterTrackEdit(
                    updateNode(scenario, node.id, { movementMode: 'auto' }),
                    ends.map((e) => e.trackId),
                  ),
                  'Movements follow the geometry again',
                )
              }
            >
              Back to automatic
            </Button>
          )}
        </Section>
      )}
      <Section title="Details" id="node-metadata">
        <MetadataEditor
          value={node.metadata}
          onChange={(metadata) => commit(updateNode(scenario, node.id, { metadata }), 'Node details changed')}
          idPrefix={`node-${node.id}`}
        />
      </Section>
      <Section title="Validation" id="node-findings">
        <FindingsList findings={findings} />
      </Section>
    </div>
  );
}

/** Asks what to do with services that use a track before it is deleted. */
export function TrackDeletionDialog() {
  const pending = useStore((s) => s.pendingTrackDeletion);
  const scenario = useStore((s) => s.project.scenarios.find((x) => x.id === s.project.activeScenarioId));
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || !pending) return;
    if (typeof d.showModal === 'function' && !d.open) d.showModal();
    else d.setAttribute('open', '');
  }, [pending]);
  if (!pending || !scenario) return null;
  const names = pending.lineIds.map((id) => scenario.lines.find((l) => l.id === id)?.name ?? id);
  return (
    <dialog
      ref={ref}
      aria-labelledby="track-delete-title"
      className="max-w-md rounded-lg border border-slate-300 p-4 shadow-xl"
      onCancel={(e) => {
        e.preventDefault();
        resolveTrackDeletion('cancel');
      }}
    >
      <h2 id="track-delete-title" className="mb-2 text-base font-semibold">
        Delete a track that services use?
      </h2>
      <p className="mb-2 text-sm">
        {names.length === 1 ? 'This service uses' : `${names.length} services use`} the track:{' '}
        <strong>{names.join(', ')}</strong>.
      </p>
      <div className="flex flex-col gap-1">
        <Button variant="primary" onClick={() => resolveTrackDeletion('reroute')}>
          Delete and reroute the services (where another path exists)
        </Button>
        <Button onClick={() => resolveTrackDeletion('break')}>Delete and leave the services unrouted</Button>
        <Button variant="danger" onClick={() => resolveTrackDeletion('delete_services')}>
          Delete the track and these services
        </Button>
        <Button variant="ghost" onClick={() => resolveTrackDeletion('cancel')}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}

/** User-adjustable track parameters with default, range, status and source. */
export function TrackParametersPanel() {
  const project = useStore((s) => s.project);
  const commit = useStore((s) => s.commitScenario);
  const scenario = project.scenarios.find((x) => x.id === project.activeScenarioId)!;
  const net = scenario.trackNetwork;
  const setOverride = (id: TrackParameterId, value: number | null) => {
    const next = { ...net.parameterOverrides };
    if (value === null) delete next[id];
    else next[id] = value;
    commit({ ...scenario, trackNetwork: { ...net, parameterOverrides: next } }, 'Track parameter changed');
  };
  return (
    <Section title="Track parameters" id="track-parameters" collapsible defaultOpen={false}>
      <p className="mb-2 text-xs text-slate-600">
        Defaults are cited where a source exists; values marked placeholder are not from a source. Changes
        apply to new track and to the simulation.
      </p>
      <ul className="space-y-2">
        {(Object.keys(TRACK_PARAMETERS) as TrackParameterId[]).map((id) => {
          const p = parameter(net, id);
          const d = p.definition;
          return (
            <li key={id} className="rounded border border-slate-200 p-1.5">
              <CommitField
                label={d.label}
                unit={d.unit}
                type="number"
                min={d.min}
                max={d.max}
                step="any"
                value={p.value}
                onCommit={(v) => setOverride(id, v === '' ? null : Number(v))}
              />
              <p className="text-xs text-slate-700">
                <Badge>
                  {p.status === 'user_override'
                    ? 'Your value'
                    : p.status === 'documented_default'
                      ? 'Documented default'
                      : 'Placeholder'}
                </Badge>{' '}
                Default {d.defaultValue} {d.unit}, range {d.min}–{d.max} {d.unit}.
              </p>
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer">Source</summary>
                <p>{d.source}</p>
                {d.notes && <p>{d.notes}</p>}
              </details>
              {p.status === 'user_override' && (
                <Button variant="ghost" onClick={() => setOverride(id, null)}>
                  Reset to default
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <SelectField
        label="Running side for new double track"
        value={net.runningSide}
        onChange={(e) =>
          commit(
            { ...scenario, trackNetwork: { ...net, runningSide: e.target.value as 'left' | 'right' } },
            'Running side changed',
          )
        }
        options={[
          { value: 'right', label: 'Right-hand running' },
          { value: 'left', label: 'Left-hand running' },
        ]}
      />
    </Section>
  );
}
