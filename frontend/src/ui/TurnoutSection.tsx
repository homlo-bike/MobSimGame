/** Turnout or crossing at a track node (R5): kind, standard design or own values, and the roles found. */
import type { Scenario, TrackEndRef, TrackNode } from '../domain/schema';
import { useStore } from '../store/projectStore';
import { afterTrackEdit } from '../domain/serviceRouting';
import { nodeEnds, sameEnd } from '../domain/tracks';
import {
  divergingRadiusM,
  setTurnout,
  slipCandidates,
  TURNOUT_DESIGNS,
  TURNOUT_ENDS,
  TURNOUT_KIND_LABELS,
  turnoutDesign,
  turnoutRoles,
  type TurnoutKind,
} from '../domain/turnouts';
import { CommitField } from './CommitField';
import { Section, SelectField } from './primitives';

export function TurnoutSection({
  node,
  scenario,
  label,
}: {
  node: TrackNode;
  scenario: Scenario;
  label: (e: TrackEndRef) => string;
}) {
  const commit = useStore((s) => s.commitScenario);
  const net = scenario.trackNetwork;
  const ends = nodeEnds(net, node.id);
  if (ends.length < 3) return null;
  const t = node.turnout;
  const apply = (next: TrackNode['turnout'], what: string) =>
    commit(
      afterTrackEdit(
        setTurnout(scenario, node.id, next),
        ends.map((e) => e.trackId),
      ),
      what,
    );
  const kinds = (Object.keys(TURNOUT_KIND_LABELS) as TurnoutKind[]).filter(
    (k) => TURNOUT_ENDS[k] === ends.length,
  );
  const roles = t?.kind === 'simple' ? turnoutRoles(net, node.id) : null;
  const design = turnoutDesign(t?.designId);
  const drawnRadius = roles ? divergingRadiusM(net, roles) : null;
  const slips = t?.kind === 'single_slip' ? slipCandidates(net, node.id) : [];
  const slipKey = (m: { a: TrackEndRef; b: TrackEndRef }) =>
    `${m.a.trackId}:${m.a.end}|${m.b.trackId}:${m.b.end}`;
  const chosenSlip = t?.slip
    ? slips.find(
        (m) =>
          (sameEnd(m.a, t.slip!.a) && sameEnd(m.b, t.slip!.b)) ||
          (sameEnd(m.a, t.slip!.b) && sameEnd(m.b, t.slip!.a)),
      )
    : slips[0];
  return (
    <Section title="Turnout or crossing" id="node-turnout">
      <SelectField
        label="Type"
        value={t?.kind ?? ''}
        onChange={(e) => {
          const kind = e.target.value as TurnoutKind | '';
          apply(
            kind ? { kind, designId: null, slip: null, radiusM: null, divergingSpeedKmh: null } : null,
            kind ? `${TURNOUT_KIND_LABELS[kind]} set` : 'Turnout removed',
          );
        }}
        options={[
          { value: '', label: 'Not specified (movements follow the geometry)' },
          ...kinds.map((k) => ({ value: k, label: TURNOUT_KIND_LABELS[k] })),
        ]}
      />
      {t?.kind === 'simple' && (
        <>
          {roles ? (
            <ul className="mb-2 text-xs text-slate-700">
              <li>Switch toe: {label(roles.toe)}</li>
              <li>Main route: {label(roles.main)}</li>
              <li>
                Diverging route: {label(roles.diverging)}
                {drawnRadius !== null
                  ? ` (drawn with ${Math.round(drawnRadius)} m)`
                  : ' (drawn straight at the node)'}
              </li>
            </ul>
          ) : (
            <p className="mb-2 text-sm text-red-900">
              ⛔ No track end leads to both others without reversing: the tracks do not form a turnout.
            </p>
          )}
          <SelectField
            label="Design"
            value={t.designId ?? ''}
            onChange={(e) => apply({ ...t, designId: e.target.value || null }, 'Turnout design changed')}
            options={[
              { value: '', label: 'Own values (enter below)' },
              ...TURNOUT_DESIGNS.map((d) => ({ value: d.id, label: d.label })),
            ]}
            hint="Standard designs of Deutsche Bahn for railways. For trams and metros enter the manufacturer's values."
          />
          {design ? (
            <p className="mb-2 text-xs text-slate-700">
              Radius {design.radiusM} m, inclination 1:{String(design.inclination).replace('.', ',')}
              {design.angleDeg !== null && `, angle ${design.angleDeg}°`}, {design.frog} frog,{' '}
              {design.divergingSpeedKmh} km/h on the diverging route. Source: {design.source}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-2">
              <CommitField
                label="Radius of the diverging route"
                unit="m"
                type="number"
                min={1}
                value={t.radiusM}
                onCommit={(v) =>
                  apply({ ...t, radiusM: v === '' ? null : Number(v) }, 'Turnout radius changed')
                }
              />
              <CommitField
                label="Speed on the diverging route"
                unit="km/h"
                type="number"
                min={1}
                value={t.divergingSpeedKmh}
                onCommit={(v) =>
                  apply({ ...t, divergingSpeedKmh: v === '' ? null : Number(v) }, 'Turnout speed changed')
                }
              />
            </div>
          )}
          <p className="text-xs text-slate-600">
            Trains on the diverging route keep to its speed over the first curve of the diverging track
            (running time from train physics).
          </p>
        </>
      )}
      {t?.kind === 'single_slip' && slips.length > 0 && (
        <SelectField
          label="Slip connects"
          value={chosenSlip ? slipKey(chosenSlip) : ''}
          onChange={(e) => {
            const m = slips.find((x) => slipKey(x) === e.target.value) ?? null;
            apply({ ...t, slip: m }, 'Slip changed');
          }}
          options={slips.map((m) => ({ value: slipKey(m), label: `${label(m.a)} ↔ ${label(m.b)}` }))}
        />
      )}
      {t && t.kind !== 'simple' && (
        <p className="text-xs text-slate-600">
          {t.kind === 'diamond'
            ? 'The two routes cross; trains cannot change between them here.'
            : 'The two routes cross; the slip lets trains change between them without reversing.'}
        </p>
      )}
    </Section>
  );
}
